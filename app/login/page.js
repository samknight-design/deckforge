'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

// ─── Icons (module-level, never remount) ───────────────────────────────────

const GoogleIcon = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
  </svg>
);

const DiscordIcon = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="#5865F2">
    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057c.002.022.015.043.032.054a19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
  </svg>
);

const AppleIcon = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="#f1f5f9">
    <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.7 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.56-1.33 3.1-2.53 4.08zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
  </svg>
);

// ─── Reusable primitives (module-level — NEVER define these inside a component) ──

function PageShell({ children }) {
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-6 py-12"
      style={{ background: 'linear-gradient(180deg, #0a0e1a 0%, #111827 100%)' }}
    >
      <div className="mb-8 text-center">
        <div className="text-5xl mb-3">⚔️</div>
        <h1 className="text-2xl font-bold" style={{ color: '#f1f5f9' }}>DeckForge</h1>
        <p className="mt-1 text-sm" style={{ color: '#64748b' }}>Your MTG companion</p>
      </div>
      <div
        className="w-full max-w-sm rounded-2xl p-6"
        style={{ background: '#111827', border: '1px solid #1e2d47' }}
      >
        {children}
      </div>
      <p className="mt-6 text-xs text-center max-w-xs" style={{ color: '#374151' }}>
        By continuing you agree to our Terms of Service and Privacy Policy.
      </p>
    </div>
  );
}

function InputField({ type, value, onChange, placeholder, autoComplete }) {
  return (
    <input
      type={type}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      required
      autoComplete={autoComplete}
      className="w-full rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 ring-amber-400 transition-all"
      style={{ background: '#1a2235', border: '1px solid #1e2d47', color: '#f1f5f9', minHeight: 44 }}
    />
  );
}

function PrimaryButton({ type = 'button', disabled, onClick, children }) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className="w-full rounded-xl py-3 px-4 font-semibold text-sm transition-all disabled:opacity-50 active:scale-95"
      style={{ background: '#f59e0b', color: '#0a0e1a', minHeight: 44 }}
    >
      {children}
    </button>
  );
}

function SocialButton({ provider, icon, label, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!!active}
      className="w-full flex items-center justify-center gap-3 rounded-xl py-3 px-4 font-medium text-sm transition-all disabled:opacity-60 active:scale-95"
      style={{ background: '#1a2235', border: '1px solid #1e2d47', color: '#f1f5f9', minHeight: 44 }}
    >
      {active === provider ? <span className="animate-spin">⟳</span> : icon}
      {label}
    </button>
  );
}

function OrDivider() {
  return (
    <div className="flex items-center gap-3 my-5">
      <div className="flex-1 h-px" style={{ background: '#1e2d47' }} />
      <span className="text-xs" style={{ color: '#374151' }}>or</span>
      <div className="flex-1 h-px" style={{ background: '#1e2d47' }} />
    </div>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────

export default function LoginPage() {
  const [view, setView] = useState('login'); // login | signup | forgot | sent | verify | magic | magic_sent
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState(null);
  const [error, setError] = useState('');
  const [isConverting, setIsConverting] = useState(false); // anonymous → real account

  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();

  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL ||
    (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000');

  // Detect if this is an anonymous user converting to a real account
  useEffect(() => {
    const convert = searchParams?.get('convert');
    if (convert === 'true') {
      setIsConverting(true);
      setView('signup'); // Start on sign-up view for conversion
    }
  }, [searchParams]);

  const go = (v) => { setError(''); setView(v); };

  // ── OAuth / Link identity ──
  const handleOAuth = async (provider) => {
    setOauthLoading(provider);
    setError('');
    if (isConverting) {
      // Link OAuth to existing anonymous session (preserves their decks)
      const { error } = await supabase.auth.linkIdentity({ provider, options: { redirectTo: `${siteUrl}/auth/callback` } });
      if (error) { setError(error.message); setOauthLoading(null); }
    } else {
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo: `${siteUrl}/auth/callback` },
      });
      if (error) { setError(error.message); setOauthLoading(null); }
    }
  };

  // ── Email sign-in ──
  const handleSignIn = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(error.message);
    setLoading(false);
  };

  // ── Email sign-up (also handles anon → real conversion) ──
  const handleSignUp = async (e) => {
    e.preventDefault();
    if (password !== confirmPassword) { setError('Passwords do not match'); return; }
    if (password.length < 6) { setError('Password must be at least 6 characters'); return; }
    setLoading(true);
    setError('');

    if (isConverting) {
      // updateUser keeps the same user_id → decks are preserved
      const { error } = await supabase.auth.updateUser({ email, password });
      if (error) { setError(error.message); setLoading(false); return; }
      go('verify');
    } else {
      const { error } = await supabase.auth.signUp({
        email, password,
        options: { emailRedirectTo: `${siteUrl}/auth/callback` },
      });
      if (error) { setError(error.message); } else { go('verify'); }
    }
    setLoading(false);
  };

  // ── Forgot password ──
  const handleForgotPassword = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${siteUrl}/auth/callback?next=/update-password`,
    });
    if (error) { setError(error.message); } else { go('sent'); }
    setLoading(false);
  };

  // ── Magic link ──
  const handleMagicLink = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    const { error } = await supabase.auth.signInWithOtp({
      email, options: { emailRedirectTo: `${siteUrl}/auth/callback` },
    });
    if (error) { setError(error.message); } else { go('magic_sent'); }
    setLoading(false);
  };

  // ── Social buttons block ──
  const socialBlock = (
    <div className="space-y-2">
      <SocialButton provider="google"  icon={GoogleIcon}  label="Continue with Google"  active={oauthLoading} onClick={() => handleOAuth('google')} />
      <SocialButton provider="discord" icon={DiscordIcon} label="Continue with Discord" active={oauthLoading} onClick={() => handleOAuth('discord')} />
      <SocialButton provider="apple"   icon={AppleIcon}   label="Continue with Apple"   active={oauthLoading} onClick={() => handleOAuth('apple')} />
    </div>
  );

  // ─── Views ───────────────────────────────────────────────────────────────

  if (view === 'sent') return (
    <PageShell>
      <div className="text-center py-2">
        <div className="text-4xl mb-4">📧</div>
        <h2 className="text-lg font-semibold mb-2" style={{ color: '#f1f5f9' }}>Check your email</h2>
        <p className="text-sm mb-4" style={{ color: '#94a3b8' }}>
          A password reset link was sent to <strong style={{ color: '#f1f5f9' }}>{email}</strong>
        </p>
        <button onClick={() => go('login')} className="text-sm underline" style={{ color: '#f59e0b' }}>Back to sign in</button>
      </div>
    </PageShell>
  );

  if (view === 'verify') return (
    <PageShell>
      <div className="text-center py-2">
        <div className="text-4xl mb-4">✉️</div>
        <h2 className="text-lg font-semibold mb-2" style={{ color: '#f1f5f9' }}>
          {isConverting ? 'Confirm your email' : 'Verify your email'}
        </h2>
        <p className="text-sm mb-4" style={{ color: '#94a3b8' }}>
          {isConverting
            ? <>A confirmation link was sent to <strong style={{ color: '#f1f5f9' }}>{email}</strong>. Click it to save your account — your decks will be kept.</>
            : <>A confirmation link was sent to <strong style={{ color: '#f1f5f9' }}>{email}</strong>. Click it to activate your account.</>
          }
        </p>
        <button onClick={() => router.push('/decks')} className="text-sm underline" style={{ color: '#f59e0b' }}>
          {isConverting ? 'Back to my decks' : 'Back to sign in'}
        </button>
      </div>
    </PageShell>
  );

  if (view === 'magic_sent') return (
    <PageShell>
      <div className="text-center py-2">
        <div className="text-4xl mb-4">🔮</div>
        <h2 className="text-lg font-semibold mb-2" style={{ color: '#f1f5f9' }}>Magic link sent</h2>
        <p className="text-sm mb-4" style={{ color: '#94a3b8' }}>
          Check <strong style={{ color: '#f1f5f9' }}>{email}</strong> for your sign-in link.
        </p>
        <button onClick={() => go('login')} className="text-sm underline" style={{ color: '#f59e0b' }}>Back to sign in</button>
      </div>
    </PageShell>
  );

  if (view === 'forgot') return (
    <PageShell>
      <button onClick={() => go('login')} className="flex items-center gap-1 text-sm mb-5 transition-colors" style={{ color: '#64748b' }}>← Back</button>
      <h2 className="text-lg font-semibold mb-1" style={{ color: '#f1f5f9' }}>Reset password</h2>
      <p className="text-sm mb-5" style={{ color: '#94a3b8' }}>Enter your email and we'll send a reset link.</p>
      <form onSubmit={handleForgotPassword} className="space-y-3">
        <InputField type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email address" autoComplete="email" />
        <PrimaryButton type="submit" disabled={loading || !email}>{loading ? 'Sending…' : 'Send Reset Link'}</PrimaryButton>
      </form>
      {error && <p className="mt-4 text-center text-red-400 text-sm">{error}</p>}
    </PageShell>
  );

  if (view === 'magic') return (
    <PageShell>
      <button onClick={() => go('login')} className="flex items-center gap-1 text-sm mb-5 transition-colors" style={{ color: '#64748b' }}>← Back</button>
      <h2 className="text-lg font-semibold mb-1" style={{ color: '#f1f5f9' }}>Magic link</h2>
      <p className="text-sm mb-5" style={{ color: '#94a3b8' }}>We'll email you a one-click sign-in link — no password needed.</p>
      <form onSubmit={handleMagicLink} className="space-y-3">
        <InputField type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email address" autoComplete="email" />
        <PrimaryButton type="submit" disabled={loading || !email}>{loading ? 'Sending…' : 'Send Magic Link'}</PrimaryButton>
      </form>
      {error && <p className="mt-4 text-center text-red-400 text-sm">{error}</p>}
    </PageShell>
  );

  // ── Login / Sign-up ──
  const isSignUp = view === 'signup';

  return (
    <PageShell>
      {isConverting && (
        <div className="mb-4 rounded-xl px-4 py-3 text-sm text-center" style={{ background: 'rgba(124,58,237,0.12)', border: '1px solid rgba(124,58,237,0.3)', color: '#c4b5fd' }}>
          💾 Save your decks by creating a free account
        </div>
      )}

      {socialBlock}
      <OrDivider />

      <form onSubmit={isSignUp ? handleSignUp : handleSignIn} className="space-y-3">
        <InputField type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email address" autoComplete="email" />
        <InputField type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" autoComplete={isSignUp ? 'new-password' : 'current-password'} />
        {isSignUp && (
          <InputField type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Confirm password" autoComplete="new-password" />
        )}
        <PrimaryButton type="submit" disabled={loading}>
          {loading
            ? (isSignUp ? 'Creating…' : 'Signing in…')
            : (isSignUp ? (isConverting ? 'Save My Decks' : 'Create Account') : 'Sign In')}
        </PrimaryButton>
      </form>

      {!isSignUp && (
        <button onClick={() => go('forgot')} className="w-full mt-2 text-center text-xs transition-colors" style={{ color: '#4b5563' }}>
          Forgot password?
        </button>
      )}

      {error && <p className="mt-3 text-center text-red-400 text-sm">{error}</p>}

      {!isConverting && (
        <div className="mt-5 pt-4 text-center" style={{ borderTop: '1px solid #1e2d47' }}>
          <span className="text-sm" style={{ color: '#94a3b8' }}>
            {isSignUp ? 'Already have an account? ' : "Don't have an account? "}
          </span>
          <button
            onClick={() => { setError(''); setPassword(''); setConfirmPassword(''); setView(isSignUp ? 'login' : 'signup'); }}
            className="text-sm font-medium"
            style={{ color: '#f59e0b' }}
          >
            {isSignUp ? 'Sign in' : 'Sign up'}
          </button>
        </div>
      )}

      <div className="mt-2 text-center">
        <button onClick={() => go('magic')} className="text-xs transition-colors" style={{ color: '#374151' }}>
          Prefer a magic link? →
        </button>
      </div>
    </PageShell>
  );
}
