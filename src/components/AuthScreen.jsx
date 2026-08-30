import { useState } from 'react';
import './AuthScreen.css';

export function AuthScreen({ onAuth, signUp, signIn }) {
    const [mode, setMode] = useState('login'); // 'login' or 'register'
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [name, setName] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [success, setSuccess] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setSuccess('');
        setLoading(true);

        if (mode === 'register') {
            if (!name.trim()) {
                setError('Name is required');
                setLoading(false);
                return;
            }
            const { error: err } = await signUp(email, password, name);
            if (err) {
                setError(err.message);
            } else {
                setSuccess('Account created! Check your email to confirm, or try logging in.');
                setMode('login');
            }
        } else {
            const { error: err } = await signIn(email, password);
            if (err) {
                setError(err.message);
            }
        }
        setLoading(false);
    };

    return (
        <div className="auth-screen">
            <div className="auth-glow" />
            <div className="auth-container">
                <div className="auth-logo">
                    <span className="auth-rupee">₹</span>
                </div>
                <h1 className="auth-title">Money Matters</h1>
                <p className="auth-subtitle">Track smart. Save smarter.</p>

                <form className="auth-form" onSubmit={handleSubmit}>
                    {mode === 'register' && (
                        <input
                            type="text"
                            placeholder="Full name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            className="auth-input"
                            autoComplete="name"
                        />
                    )}
                    <input
                        type="email"
                        placeholder="Email address"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="auth-input"
                        autoComplete="email"
                        required
                    />
                    <input
                        type="password"
                        placeholder="Password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="auth-input"
                        autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                        minLength={6}
                        required
                    />

                    {error && <p className="auth-error">{error}</p>}
                    {success && <p className="auth-success">{success}</p>}

                    <button type="submit" className="auth-btn" disabled={loading}>
                        {loading ? '...' : mode === 'login' ? 'Sign In' : 'Create Account'}
                    </button>
                </form>

                <p className="auth-switch">
                    {mode === 'login' ? (
                        <>
                            Don&apos;t have an account?{' '}
                            <button type="button" onClick={() => { setMode('register'); setError(''); setSuccess(''); }}>
                                Sign up
                            </button>
                        </>
                    ) : (
                        <>
                            Already have an account?{' '}
                            <button type="button" onClick={() => { setMode('login'); setError(''); setSuccess(''); }}>
                                Sign in
                            </button>
                        </>
                    )}
                </p>
            </div>
        </div>
    );
}
