'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import UpgradeModal from './UpgradeModal';

const APP_VERSION = '1.0.0';

export default function ProfilePage({ profile, usage, deckCount }) {
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  const tier = profile?.tier || 'free';
  const isPro = tier === 'pro';
  const scanCount = usage?.scan_count || 0;
  const scanLimit = isPro ? '∞' : 100;
  const scanPct = isPro ? 0 : Math.min(100, (scanCount / 100) * 100);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  };

  const handleManageSubscription = async () => {
    setCancelling(true);
    try {
      const res = await fetch('/api/stripe/portal', { method: 'POST' });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
    } catch {
      alert('Failed to open subscription portal');
    } finally {
      setCancelling(false);
    }
  };

  const avatarLetter = (profile?.display_name || profile?.email || 'U')[0].toUpperCase();

  return (
    <div className="h-full overflow-y-auto scroll-y" style={{ background: '#0a0e1a' }}>
      {/* Header */}
      <div
        className="px-4 pt-8 pb-6"
        style={{ background: '#111827', borderBottom: '1px solid #1e2d47' }}
      >
        <div className="flex items-center gap-4">
          {/* Avatar */}
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center text-2xl font-bold flex-shrink-0"
            style={{
              background: 'linear-gradient(135deg, #7c3aed, #f59e0b)',
              color: '#fff',
            }}
          >
            {profile?.avatar_url ? (
              <img src={profile.avatar_url} alt="avatar" className="w-full h-full rounded-full object-cover" />
            ) : avatarLetter}
          </div>

          <div className="flex-1 min-w-0">
            <h2 className="font-bold text-text-primary text-lg truncate">
              {profile?.display_name || 'Player'}
            </h2>
            <p className="text-text-secondary text-sm truncate">{profile?.email}</p>
            <div className="mt-1">
              <span
                className="text-xs font-bold rounded-full px-2.5 py-1"
                style={{
                  background: isPro ? 'rgba(124,58,237,0.2)' : 'rgba(245,158,11,0.15)',
                  color: isPro ? '#a78bfa' : '#f59e0b',
                  border: `1px solid ${isPro ? 'rgba(124,58,237,0.4)' : 'rgba(245,158,11,0.3)'}`,
                }}
              >
                {isPro ? '⚡ Pro' : '🆓 Free'}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="px-4 py-4 space-y-4">
        {/* Usage stats */}
        <div
          className="rounded-2xl p-4"
          style={{ background: '#111827', border: '1px solid #1e2d47' }}
        >
          <h3 className="text-sm font-semibold text-text-primary mb-3">This Month</h3>

          <div className="space-y-3">
            {/* Scans */}
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-text-secondary">Card Scans</span>
                <span className="font-semibold text-text-primary">{scanCount} / {scanLimit}</span>
              </div>
              {!isPro && (
                <div className="h-2 rounded-full overflow-hidden" style={{ background: '#1e2d47' }}>
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${scanPct}%`,
                      background: scanPct >= 80 ? '#ef4444' : '#f59e0b',
                    }}
                  />
                </div>
              )}
            </div>

            {/* Decks */}
            <div className="flex justify-between text-xs">
              <span className="text-text-secondary">Decks</span>
              <span className="font-semibold text-text-primary">
                {deckCount}{!isPro && ` / 3`}
              </span>
            </div>

            {/* Insights */}
            {isPro && (
              <div className="flex justify-between text-xs">
                <span className="text-text-secondary">AI Insights</span>
                <span className="font-semibold text-text-primary">{usage?.insight_count || 0}</span>
              </div>
            )}
          </div>
        </div>

        {/* Pro card / manage subscription */}
        {!isPro ? (
          <div
            className="rounded-2xl p-4"
            style={{
              background: 'linear-gradient(135deg, rgba(124,58,237,0.15), rgba(245,158,11,0.1))',
              border: '1px solid rgba(124,58,237,0.3)',
            }}
          >
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className="font-bold text-text-primary">Upgrade to Pro</h3>
                <p className="text-text-secondary text-xs mt-0.5">Unlock everything DeckForge has to offer</p>
              </div>
              <div className="text-right">
                <div className="font-bold text-lg" style={{ color: '#f59e0b' }}>£3.99</div>
                <div className="text-xs text-text-dim">/ month</div>
              </div>
            </div>

            <div className="space-y-1.5 mb-4">
              {[
                'Unlimited card scans',
                'Unlimited decks',
                'AI deck insights (Claude)',
                'Public deck sharing',
              ].map((f) => (
                <div key={f} className="flex items-center gap-2 text-sm">
                  <span style={{ color: '#10b981' }}>✓</span>
                  <span style={{ color: '#cbd5e1' }}>{f}</span>
                </div>
              ))}
            </div>

            <button
              onClick={() => setShowUpgrade(true)}
              className="w-full rounded-xl py-3 text-sm font-bold"
              style={{ background: 'linear-gradient(135deg, #7c3aed, #f59e0b)', color: '#fff', minHeight: 44 }}
            >
              ⚡ Upgrade Now
            </button>
          </div>
        ) : (
          <div
            className="rounded-2xl p-4"
            style={{ background: '#111827', border: '1px solid rgba(124,58,237,0.3)' }}
          >
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="font-bold text-text-primary">Pro Subscription</h3>
                {profile?.subscription_ends_at && (
                  <p className="text-text-secondary text-xs mt-0.5">
                    Renews {new Date(profile.subscription_ends_at).toLocaleDateString()}
                  </p>
                )}
              </div>
              <span
                className="text-xs font-bold rounded-full px-2.5 py-1"
                style={{ background: 'rgba(16,185,129,0.2)', color: '#10b981' }}
              >
                Active
              </span>
            </div>
            <button
              onClick={handleManageSubscription}
              disabled={cancelling}
              className="w-full rounded-xl py-2.5 text-sm font-medium disabled:opacity-60"
              style={{ background: '#1a2235', border: '1px solid #1e2d47', color: '#94a3b8', minHeight: 44 }}
            >
              {cancelling ? 'Loading…' : 'Manage Subscription'}
            </button>
          </div>
        )}

        {/* Sign out */}
        <div
          className="rounded-2xl p-4"
          style={{ background: '#111827', border: '1px solid #1e2d47' }}
        >
          <button
            onClick={handleSignOut}
            className="w-full text-left text-sm font-medium flex items-center justify-between"
            style={{ color: '#ef4444', minHeight: 44 }}
          >
            Sign Out
            <span>→</span>
          </button>
        </div>

        {/* App version */}
        <div className="text-center py-4">
          <p className="text-xs text-text-dim">DeckForge v{APP_VERSION}</p>
          <p className="text-xs text-text-dim mt-0.5">Powered by Scryfall, Claude & Gemini</p>
        </div>
      </div>

      {showUpgrade && <UpgradeModal onClose={() => setShowUpgrade(false)} />}
    </div>
  );
}
