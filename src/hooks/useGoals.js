import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';

export function useGoals(user) {
    const [goals, setGoals] = useState([]);
    const [loading, setLoading] = useState(false);

    const fetchGoals = useCallback(async () => {
        if (!user) return;
        setLoading(true);
        const { data, error } = await supabase
            .from('goals')
            .select('*')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false });
        if (!error && data) setGoals(data);
        setLoading(false);
    }, [user]);

    useEffect(() => {
        fetchGoals();
    }, [fetchGoals]);

    const addGoal = async (name, target) => {
        const t = Number(target);
        if (!name?.trim() || !t || t <= 0 || !user) return null;
        const { data, error } = await supabase
            .from('goals')
            .insert({
                user_id: user.id,
                name: name.trim(),
                target: t,
                current: 0,
            })
            .select()
            .single();
        if (!error && data) {
            setGoals((prev) => [data, ...prev]);
        }
        return { data, error };
    };

    const deleteGoal = async (id) => {
        const { error } = await supabase
            .from('goals')
            .delete()
            .eq('id', id)
            .eq('user_id', user?.id);
        if (!error) {
            setGoals((prev) => prev.filter((g) => g.id !== id));
        }
        return { error };
    };

    const depositToGoal = async (goalId, amount) => {
        const num = Number(amount);
        if (!num || num <= 0) return null;

        const goal = goals.find((g) => g.id === goalId);
        if (!goal) return null;

        const newCurrent = Math.min(goal.target, goal.current + num);
        const { data, error } = await supabase
            .from('goals')
            .update({ current: newCurrent })
            .eq('id', goalId)
            .eq('user_id', user?.id)
            .select()
            .single();
        if (!error && data) {
            setGoals((prev) => prev.map((g) => (g.id === goalId ? data : g)));
        }
        return { data, error };
    };

    return { goals, loading, addGoal, deleteGoal, depositToGoal, refetch: fetchGoals };
}
