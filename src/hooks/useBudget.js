import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';

export function useBudget(user) {
    const [budget, setBudget] = useState({ income: 0, fixed: 0, savings: 0 });
    const [loading, setLoading] = useState(false);

    const fetchBudget = useCallback(async () => {
        if (!user) return;
        setLoading(true);
        const { data, error } = await supabase
            .from('budgets')
            .select('*')
            .eq('user_id', user.id)
            .single();

        if (!error && data) {
            setBudget({
                income: Number(data.income) || 0,
                fixed: Number(data.fixed) || 0,
                savings: Number(data.savings) || 0,
            });
        } else if (error?.code === 'PGRST116') {
            // No budget row yet — create one
            const { data: newBudget } = await supabase
                .from('budgets')
                .insert({ user_id: user.id, income: 0, fixed: 0, savings: 0 })
                .select()
                .single();
            if (newBudget) {
                setBudget({ income: 0, fixed: 0, savings: 0 });
            }
        }
        setLoading(false);
    }, [user]);

    useEffect(() => {
        fetchBudget();
    }, [fetchBudget]);

    const updateBudgetField = async (field, value) => {
        const numValue = Number(value) || 0;
        // Optimistic update
        setBudget((prev) => ({ ...prev, [field]: numValue }));

        const { error } = await supabase
            .from('budgets')
            .update({ [field]: numValue, updated_at: new Date().toISOString() })
            .eq('user_id', user?.id);

        if (error) {
            // Revert on error
            fetchBudget();
        }
    };

    return { budget, loading, updateBudgetField, refetch: fetchBudget };
}
