import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';

export function useExpenses(user) {
    const [expenses, setExpenses] = useState([]);
    const [loading, setLoading] = useState(false);

    const fetchExpenses = useCallback(async () => {
        if (!user) return;
        setLoading(true);
        const { data, error } = await supabase
            .from('expenses')
            .select('*')
            .eq('user_id', user.id)
            .order('date', { ascending: false })
            .limit(100);
        if (!error && data) setExpenses(data);
        setLoading(false);
    }, [user]);

    useEffect(() => {
        fetchExpenses();
    }, [fetchExpenses]);

    const addExpense = async (amount, description, category) => {
        const num = Number(amount);
        if (!num || num <= 0 || !user) return null;
        const { data, error } = await supabase
            .from('expenses')
            .insert({
                user_id: user.id,
                amount: num,
                description: description || category,
                category: category || 'Other',
                date: new Date().toISOString(),
            })
            .select()
            .single();
        if (!error && data) {
            setExpenses((prev) => [data, ...prev]);
        }
        return { data, error };
    };

    const deleteExpense = async (id) => {
        const { error } = await supabase
            .from('expenses')
            .delete()
            .eq('id', id)
            .eq('user_id', user?.id);
        if (!error) {
            setExpenses((prev) => prev.filter((e) => e.id !== id));
        }
        return { error };
    };

    return { expenses, loading, addExpense, deleteExpense, refetch: fetchExpenses };
}
