'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const supabase = createClient();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || window?.location?.origin || 'http://localhost:3000';

  const handleGoogle = async () => {
    setGoogleLoading(true);
    setError('');
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${siteUrl}/auth/callback` },
    });
    if (error) {
      setError(error.message);
      setGoogleLoading(false);
    }
  };

  const handleMagicLink = async (e) => {
    e.preventDefault();
    if (!email) return;
    setLoading(true);
    setError('');

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${siteUrl}/auth/callback` },
    });

    if (error) {
      setError(error.message);
    } else {
      setSent(true);
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 py-12"
      style={{ background: 'linear-gradient(180deg, #0a0e1a 0%, #111827 100%)' }}>
      {/* Logo */}
      <div className="mb-10 text-center">
        <div className="text-6xl mb-4">⚔️</div>
        <h1 className="text-3xl font-bold text-text-primary">DeckForge</h1>
        <p className="text-text-secondary mt-2 text-sm">Your MTG companion</p>
      </div>

      {/* Card */}
      <div className="w-full max-w-sm rounded-2xl p-6"
        style={{ background: '#111827', border: '1px solid #1e2d47' }}>

        {sent ? (
          <div className="text-center py-4">
            <div className="text-4xl mb-4">📧</div>
            <h2 className="text-lg font-semibold text-text-primary mb-2">Check your email</h2>
            <p className="text-text-secondary text-sm">
              We sent a magic link to <strong className="text-text-primary">{email}</strong>
            </p>
            <button
              onClick={() => setSent(false)}
              className="mt-4 text-gold text-sm underline"
            >
              Use a different email
            </button>
          </div>
        ) : (
          <>
            {/* Google Sign In */}
            <button
              onClick={handleGoogle}
              disabled={googleLoading}
              className="w-full flex items-center justify-center gap-3 rounded-xl py-3 px-4 font-medium text-sm transition-all"
              style={{
                background: '#1a2235',
                border: '1px solid #1e2d47',
                color: '#f1f5f9',
                minHeight: '44px',
              }}
            >
              {googleLoading ? (
                <span className="animate-spin">⟳</span>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
              )}
              Continue with Google
            </button>

            {/* Divider */}
            <div className="flex items-center gap-3 my-5">
              <div className="flex-1 h-px" style={{ background: '#1e2d47' }} />
              <span className="text-text-dim text-xs">or</span>
              <div className="flex-1 h-px" style={{ background: '#1e2d47' }} />
            </div>

            {/* Magic Link */}
            <form onSubmit={handleMagicLink} className="space-y-3">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter your email"
                required
                className="w-full rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 ring-gold transition-all"
                style={{
                  background: '#1a2235',
                  border: '1px solid #1e2d47',
                  color: '#f1f5f9',
                  minHeight: '44px',
                }}
              />
              <button
                type="submit"
                disabled={loading || !email}
                className="w-full rounded-xl py-3 px-4 font-semibold text-sm transition-all disabled:opacity-50"
                style={{
                  background: '#f59e0b',
                  color: '#0a0e1a',
                  minHeight: '44px',
                }}
              >
                {loading ? 'Sending…' : 'Send Magic Link'}
              </button>
            </form>
          </>
        )}

        {error && (
          <p className="mt-4 text-center text-red-400 text-sm">{error}</p>
        )}
      </div>

      <p className="mt-8 text-text-dim text-xs text-center max-w-xs">
        By continuing you agree to our Terms of Service and Privacy Policy.
      </p>
    </div>
  );
}
