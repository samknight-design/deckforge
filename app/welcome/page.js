'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import Link from 'next/link';

const FEATURES = [
  { icon: '📷', title: 'Scan cards instantly', desc: 'Point your camera at any MTG card and it identifies itself.' },
  { icon: '🗂️', title: 'Build & manage decks', desc: 'Commander, Standard, Modern — full deck building with validation.' },
  { icon: '✨', title: 'AI deck insights', desc: 'Get strategy tips and improvement suggestions powered by AI.' },
];

export default function WelcomePage() {
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const router = useRouter();
  const supabase = createClient();

  // If already logged in, skip to the app
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        router.replace('/decks');
      } else {
        setCheckingSession(false);
      }
    });
  }, []);

  const handleTryFree = async () => {
    setLoading(true);
    const { error } = await supabase.auth.signInAnonymously();
    if (error) {
      // Anonymous auth not enabled — fall back to login
      router.push('/login');
    } else {
      router.push('/decks');
    }
  };

  if (checkingSession) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#0a0e1a' }}>
        <div className="w-6 h-6 border-2 rounded-full animate-spin" style={{ borderColor: '#f59e0b', borderTopColor: 'transparent' }} />
      </div>
    );
  }

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-6 py-12"
      style={{ background: 'linear-gradient(180deg, #0a0e1a 0%, #0f172a 60%, #111827 100%)' }}
    >
      {/* Logo */}
      <div className="text-center mb-10">
        <div className="text-6xl mb-4">⚔️</div>
        <h1 className="text-4xl font-bold mb-2" style={{ color: '#f1f5f9' }}>DeckForge</h1>
        <p className="text-base" style={{ color: '#64748b' }}>The MTG companion built for players</p>
      </div>

      {/* Feature highlights */}
      <div className="w-full max-w-sm space-y-3 mb-10">
        {FEATURES.map((f) => (
          <div
            key={f.title}
            className="flex items-start gap-4 rounded-2xl px-4 py-3"
            style={{ background: '#111827', border: '1px solid #1e2d47' }}
          >
            <span className="text-2xl mt-0.5 flex-shrink-0">{f.icon}</span>
            <div>
              <p className="text-sm font-semibold" style={{ color: '#f1f5f9' }}>{f.title}</p>
              <p className="text-xs mt-0.5" style={{ color: '#64748b' }}>{f.desc}</p>
            </div>
          </div>
        ))}
      </div>

      {/* CTAs */}
      <div className="w-full max-w-sm space-y-3">
        <button
          onClick={handleTryFree}
          disabled={loading}
          className="w-full rounded-2xl py-4 font-bold text-base transition-all disabled:opacity-60 active:scale-95"
          style={{
            background: 'linear-gradient(135deg, #f59e0b, #d97706)',
            color: '#0a0e1a',
            minHeight: 56,
            boxShadow: '0 4px 24px rgba(245,158,11,0.35)',
          }}
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-4 h-4 border-2 rounded-full animate-spin" style={{ borderColor: '#0a0e1a', borderTopColor: 'transparent' }} />
              Starting…
            </span>
          ) : (
            '⚡ Try it free — no sign-up needed'
          )}
        </button>

        <Link
          href="/login"
          className="w-full flex items-center justify-center rounded-2xl py-3.5 font-medium text-sm transition-all active:scale-95"
          style={{
            background: 'transparent',
            border: '1px solid #1e2d47',
            color: '#94a3b8',
            minHeight: 48,
          }}
        >
          Sign in to existing account
        </Link>
      </div>

      <p className="mt-8 text-xs text-center max-w-xs" style={{ color: '#374151' }}>
        Free tier: 1 deck · 25 scans/month · No card required
      </p>
    </div>
  );
}
