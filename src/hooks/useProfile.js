import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';
import { todayStr, yesterdayStr } from '../utils/constants';

export function useProfile(user) {
    const [profile, setProfile] = useState({ xp: 0, streak: 0, last_activity_date: null, name: '' });
    const [loading, setLoading] = useState(false);

    const fetchProfile = useCallback(async () => {
        if (!user) return;
        setLoading(true);
        const { data, error } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', user.id)
            .single();
        if (!error && data) {
            setProfile({
                xp: Number(data.xp) || 0,
                streak: Number(data.streak) || 0,
                last_activity_date: data.last_activity_date,
                name: data.name || '',
            });
        }
        setLoading(false);
    }, [user]);

    useEffect(() => {
        fetchProfile();
    }, [fetchProfile]);

    const addXpAndUpdateStreak = async () => {
        if (!user) return;
        const today = todayStr();
        const yesterday = yesterdayStr();

        let newStreak = profile.streak;
        if (!profile.last_activity_date) {
            newStreak = 1;
        } else if (profile.last_activity_date === today) {
            // Already logged today, keep streak
        } else if (profile.last_activity_date === yesterday) {
            newStreak = profile.streak + 1;
        } else {
            newStreak = 1;
        }

        const newXp = profile.xp + 10;

        const { error } = await supabase
            .from('profiles')
            .update({
                xp: newXp,
                streak: newStreak,
                last_activity_date: today,
            })
            .eq('id', user.id);

        if (!error) {
            setProfile((prev) => ({
                ...prev,
                xp: newXp,
                streak: newStreak,
                last_activity_date: today,
            }));
        }
    };

    return { profile, loading, addXpAndUpdateStreak, refetch: fetchProfile };
}
