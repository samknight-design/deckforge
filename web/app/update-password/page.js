'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export default function UpdatePasswordPage() {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  const fieldStyle = {
    background: '#1a2235',
    border: '1px solid #1e2d47',
    color: '#f1f5f9',
    minHeight: 44,
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (password !== confirmPassword) { setError('Passwords do not match'); return; }
    if (password.length < 6) { setError('Password must be at least 6 characters'); return; }
    setLoading(true);
    setError('');
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      setDone(true);
      setTimeout(() => router.push('/decks'), 2000);
    }
  };

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-6 py-12"
      style={{ background: 'linear-gradient(180deg, #0a0e1a 0%, #111827 100%)' }}
    >
      <div className="mb-8 text-center">
        <div className="text-5xl mb-3">⚔️</div>
        <h1 className="text-2xl font-bold text-text-primary">DeckForge</h1>
      </div>

      <div className="w-full max-w-sm rounded-2xl p-6" style={{ background: '#111827', border: '1px solid #1e2d47' }}>
        {done ? (
          <div className="text-center py-2">
            <div className="text-4xl mb-4">✅</div>
            <h2 className="text-lg font-semibold text-text-primary mb-2">Password updated</h2>
            <p className="text-sm" style={{ color: '#94a3b8' }}>Redirecting you to the app…</p>
          </div>
        ) : (
          <>
            <h2 className="text-lg font-semibold text-text-primary mb-1">Set new password</h2>
            <p className="text-sm mb-5" style={{ color: '#94a3b8' }}>Choose a strong password for your account.</p>

            <form onSubmit={handleSubmit} className="space-y-3">
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="New password"
                required
                autoComplete="new-password"
                className="w-full rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 ring-gold"
                style={fieldStyle}
              />
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm new password"
                required
                autoComplete="new-password"
                className="w-full rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 ring-gold"
                style={fieldStyle}
              />
              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-xl py-3 px-4 font-semibold text-sm transition-all disabled:opacity-50"
                style={{ background: '#f59e0b', color: '#0a0e1a', minHeight: 44 }}
              >
                {loading ? 'Updating…' : 'Update Password'}
              </button>
            </form>

            {error && <p className="mt-4 text-center text-red-400 text-sm">{error}</p>}
          </>
        )}
      </div>
    </div>
  );
}
