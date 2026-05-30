'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { showToast } from './Toast';
import Avatar from './Avatar';
import SettingsSection from './SettingsSection';
import {
  TIERS, TIER_ORDER, BOLT_ONS, AVATARS, CURRENCY,
  scanQuota, insightQuota, deckLimit, levelProgress,
  ACHIEVEMENTS,
} from '@/lib/tiers';

const APP_VERSION = '1.1.0';
const fmtPrice = (p) => `${CURRENCY}${p.toFixed(2)}`;

function StatTile({ label, value, sub, color }) {
  return (
    <div className="rounded-xl p-3" style={{ background: '#0d1424', border: '1px solid #1e2d47' }}>
      <div className="text-xs" style={{ color: '#64748b' }}>{label}</div>
      <div className="text-lg font-bold" style={{ color: color || '#f1f5f9' }}>{value}</div>
      {sub && <div className="text-xs" style={{ color: '#475569' }}>{sub}</div>}
    </div>
  );
}

export default function ProfilePage({ profile, usage, deckCount, publicDecks, totalLikes, achievementKeys, tasks, challenges, weekKeyStr, monthKeyStr }) {
  const router = useRouter();
  const supabase = createClient();

  // Pull fresh server data on open so XP/credits/challenge progress reflect
  // recent activity (Next's router cache can otherwise show a stale view).
  useEffect(() => { router.refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [avatarKey, setAvatarKey] = useState(profile?.avatar_key || null);
  const [showAvatars, setShowAvatars] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [username, setUsername] = useState(profile?.username || '');
  const [nameInput, setNameInput] = useState(profile?.username || '');
  const [savingName, setSavingName] = useState(false);
  const [busy, setBusy] = useState(false);

  const tier = profile?.tier || 'free';
  const tierCfg = TIERS[tier] || TIERS.free;
  const isPaid = tier !== 'free';

  const scanUsed = usage?.scan_count || 0;
  const insightUsed = usage?.insight_count || 0;
  const scanCredits = profile?.scan_credits || 0;
  const insightCredits = profile?.insight_credits || 0;

  const xp = profile?.xp || 0;
  const lvl = levelProgress(xp);
  const haveAch = new Set(achievementKeys || []);
  const achCount = haveAch.size;

  // Map current-period task rows by task_key
  const taskRow = {};
  (tasks || []).forEach((t) => { taskRow[t.task_key] = t; });

  const saveUsername = async () => {
    const v = nameInput.trim();
    if (!v) { setEditingName(false); setNameInput(username); return; }
    if (!/^[A-Za-z0-9_]{3,20}$/.test(v)) { showToast('Nickname: 3–20 letters, numbers or _', 'error'); return; }
    setSavingName(true);
    const { error } = await supabase.from('profiles').update({ username: v }).eq('id', profile.id);
    setSavingName(false);
    if (error) {
      showToast(error.code === '23505' ? 'That nickname is taken' : 'Failed to save nickname', 'error');
      return;
    }
    setUsername(v);
    setEditingName(false);
    showToast('✓ Nickname saved', 'success');
  };

  const pickAvatar = async (key) => {
    setAvatarKey(key);
    setShowAvatars(false);
    await supabase.from('profiles').update({ avatar_key: key }).eq('id', profile.id);
  };

  // ── Stripe seam ──────────────────────────────────────────────────────────
  // Single place to wire real checkout once Stripe is live. `item` is
  // 'tier:pro' | 'tier:legendary' | 'bolton:<key>'.
  const handlePurchase = (item) => {
    showToast('💳 Payments aren’t connected yet — coming soon!', 'success');
    // TODO(stripe): POST /api/stripe/checkout { item } → redirect to session.url
  };

  const handleManageSubscription = async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/stripe/portal', { method: 'POST' });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
      else showToast('Subscription portal not available yet', 'error');
    } catch {
      showToast('Failed to open subscription portal', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  };

  return (
    <div className="h-full overflow-y-auto scroll-y" style={{ background: '#0a0e1a' }}>
      {/* Header */}
      <div className="px-4 pt-8 pb-5" style={{ background: '#111827', borderBottom: '1px solid #1e2d47' }}>
        <div className="flex items-center gap-4">
          <button onClick={() => setShowAvatars((s) => !s)} className="relative flex-shrink-0" title="Change avatar">
            <Avatar avatarKey={avatarKey} size={68} ring={tierCfg.color} />
            <span className="absolute -bottom-1 -right-1 rounded-full text-xs" style={{ background: '#1a2235', border: '1px solid #1e2d47', width: 22, height: 22, lineHeight: '20px' }}>✏️</span>
          </button>

          <div className="flex-1 min-w-0">
            {editingName ? (
              <div className="flex items-center gap-2">
                <input
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  autoFocus
                  maxLength={20}
                  placeholder="nickname"
                  className="flex-1 min-w-0 rounded-lg px-2 py-1 text-sm outline-none"
                  style={{ background: '#1a2235', border: '1px solid #f59e0b', color: '#f1f5f9' }}
                />
                <button onClick={saveUsername} disabled={savingName} className="text-xs font-semibold rounded-lg px-2 py-1" style={{ background: '#f59e0b', color: '#0a0e1a' }}>
                  {savingName ? '…' : 'Save'}
                </button>
              </div>
            ) : (
              <h2 className="font-bold text-text-primary text-lg truncate flex items-center gap-2">
                {username || 'Set a nickname'}
                <button onClick={() => { setNameInput(username); setEditingName(true); }} className="text-xs" style={{ color: '#64748b' }}>✏️</button>
              </h2>
            )}
            <p className="text-text-secondary text-xs truncate">{profile?.email}</p>
            <div className="mt-1.5 flex items-center gap-2">
              <span className="text-xs font-bold rounded-full px-2.5 py-1" style={{ background: `${tierCfg.color}22`, color: tierCfg.color, border: `1px solid ${tierCfg.color}55` }}>
                {tierCfg.icon} {tierCfg.name}
              </span>
              <span className="text-xs font-bold" style={{ color: '#a78bfa' }}>Level {lvl.level}</span>
            </div>
          </div>
        </div>

        {/* Avatar picker */}
        {showAvatars && (
          <div className="mt-4 grid grid-cols-6 gap-2">
            {AVATARS.map((a) => (
              <button key={a.key} onClick={() => pickAvatar(a.key)} className="flex items-center justify-center rounded-full" style={{ outline: avatarKey === a.key ? '2px solid #f59e0b' : 'none' }}>
                <Avatar avatarKey={a.key} size={40} />
              </button>
            ))}
          </div>
        )}

        {/* XP bar */}
        <Link href="/rewards" className="block mt-4">
          <div className="flex justify-between text-xs mb-1">
            <span style={{ color: '#94a3b8' }}>Level {lvl.level}</span>
            <span style={{ color: '#f59e0b' }}>Rewards track →</span>
          </div>
          <div className="h-2 rounded-full overflow-hidden" style={{ background: '#1e2d47' }}>
            <div className="h-full rounded-full" style={{ width: `${Math.min(100, (lvl.into / lvl.span) * 100)}%`, background: 'linear-gradient(90deg,#7c3aed,#f59e0b)' }} />
          </div>
          <div className="text-xs mt-1" style={{ color: '#64748b' }}>{lvl.into} / {lvl.span} XP to level {lvl.level + 1}</div>
        </Link>
      </div>

      <div className="px-4 py-4 space-y-5">
        {/* This month */}
        <div>
          <h3 className="text-sm font-semibold text-text-primary mb-2">This month</h3>
          <div className="grid grid-cols-2 gap-2">
            <StatTile label="Scans" value={`${scanUsed} / ${scanQuota(tier)}`} sub={scanCredits ? `+${scanCredits} credits` : null} color="#f59e0b" />
            <StatTile label="Insights" value={`${insightUsed} / ${insightQuota(tier)}`} sub={insightCredits ? `+${insightCredits} credits` : null} color="#a78bfa" />
            <StatTile label="Decks" value={deckLimit(tier) == null ? `${deckCount}` : `${deckCount} / ${deckLimit(tier)}`} />
            <StatTile label="Total likes" value={totalLikes} sub="on your decks" color="#10b981" />
          </div>
        </div>

        {/* Tasks */}
        <div>
          <h3 className="text-sm font-semibold text-text-primary mb-2">Challenges</h3>
          <div className="rounded-2xl overflow-hidden" style={{ background: '#111827', border: '1px solid #1e2d47' }}>
            {(challenges || []).length === 0 && (
              <div className="px-3 py-4 text-center text-xs" style={{ color: '#64748b' }}>No active challenges right now — check back soon.</div>
            )}
            {(challenges || []).map((t, i) => {
              const row = taskRow[t.key];
              const progress = Math.min(row?.progress || 0, t.target);
              const done = row?.claimed || progress >= t.target;
              return (
                <div key={t.key} className="px-3 py-2.5" style={{ borderBottom: i < challenges.length - 1 ? '1px solid #1e2d47' : 'none' }}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm" style={{ color: '#f1f5f9' }}>{t.icon} {t.name}</span>
                    <span className="text-xs font-semibold" style={{ color: done ? '#10b981' : '#64748b' }}>
                      {done ? `✓ +${t.xp} XP` : `${progress}/${t.target}`}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs uppercase tracking-wide" style={{ color: '#475569', minWidth: 44 }}>{t.period}</span>
                    <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: '#1e2d47' }}>
                      <div className="h-full rounded-full" style={{ width: `${(progress / t.target) * 100}%`, background: done ? '#10b981' : '#f59e0b' }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Achievements */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-text-primary">Achievements</h3>
            <span className="text-xs" style={{ color: '#64748b' }}>{achCount} / {ACHIEVEMENTS.length}</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {ACHIEVEMENTS.map((a) => {
              const got = haveAch.has(a.key);
              return (
                <div key={a.key} className="rounded-xl p-2.5 text-center" style={{ background: got ? 'rgba(245,158,11,0.1)' : '#0d1424', border: `1px solid ${got ? 'rgba(245,158,11,0.35)' : '#1e2d47'}`, opacity: got ? 1 : 0.55 }}>
                  <div className="text-2xl mb-1" style={{ filter: got ? 'none' : 'grayscale(1)' }}>{a.icon}</div>
                  <div className="text-xs font-semibold" style={{ color: got ? '#f1f5f9' : '#64748b' }}>{a.name}</div>
                  <div className="text-xs mt-0.5" style={{ color: '#475569' }}>{got ? `+${a.xp} XP` : a.desc}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Public decks */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-text-primary">Public decks</h3>
            <span className="text-xs" style={{ color: '#64748b' }}>{publicDecks.length}</span>
          </div>
          {publicDecks.length === 0 ? (
            <div className="rounded-xl p-4 text-center" style={{ background: '#111827', border: '1px solid #1e2d47' }}>
              <p className="text-xs" style={{ color: '#64748b' }}>No public decks yet. Publish one from its page to show it here.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {publicDecks.map((d) => (
                <Link key={d.id} href={`/community/${d.id}`} className="flex items-center gap-3 rounded-xl p-2.5" style={{ background: '#111827', border: '1px solid #1e2d47' }}>
                  {d.commander_image_url ? (
                    <img src={d.commander_image_url} alt="" className="rounded-lg flex-shrink-0" style={{ width: 36, height: 36, objectFit: 'cover', objectPosition: 'center 20%' }} />
                  ) : <div className="rounded-lg flex-shrink-0" style={{ width: 36, height: 36, background: '#1a2235' }} />}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-white truncate">{d.name}</div>
                    <div className="text-xs" style={{ color: '#64748b' }}>{d.format === 'commander' ? 'Commander' : '60-Card'}{d.bracket ? ` · B${d.bracket}` : ''}</div>
                  </div>
                  <span className="text-xs font-semibold flex-shrink-0" style={{ color: '#fbbf24' }}>👍 {d.like_count || 0}</span>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Plans */}
        <div>
          <h3 className="text-sm font-semibold text-text-primary mb-2">Plans</h3>
          <div className="space-y-2">
            {TIER_ORDER.map((key) => {
              const t = TIERS[key];
              const current = key === tier;
              return (
                <div key={key} className="rounded-2xl p-4" style={{ background: '#111827', border: `1px solid ${current ? `${t.color}66` : '#1e2d47'}` }}>
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <div className="font-bold text-text-primary">{t.icon} {t.name}</div>
                      <div className="text-xs" style={{ color: '#64748b' }}>{t.blurb}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-lg" style={{ color: t.color }}>{t.price === 0 ? 'Free' : fmtPrice(t.price)}</div>
                      {t.price > 0 && <div className="text-xs" style={{ color: '#475569' }}>/ month</div>}
                      {t.priceYear > 0 && <div className="text-xs" style={{ color: '#64748b' }}>or {fmtPrice(t.priceYear)}/yr</div>}
                    </div>
                  </div>
                  <div className="flex gap-3 text-xs mb-3" style={{ color: '#cbd5e1' }}>
                    <span>🃏 {t.scans.toLocaleString()} scans</span>
                    <span>✨ {t.insights} insights</span>
                    <span>📦 {t.decks == null ? '∞' : t.decks} deck{t.decks === 1 ? '' : 's'}</span>
                  </div>
                  {current ? (
                    <div className="w-full rounded-xl py-2.5 text-sm font-semibold text-center" style={{ background: '#1a2235', color: t.color, border: `1px solid ${t.color}55` }}>
                      Current plan
                    </div>
                  ) : key === 'free' ? null : (
                    <button onClick={() => handlePurchase(`tier:${key}`)} className="w-full rounded-xl py-2.5 text-sm font-bold" style={{ background: t.color, color: '#0a0e1a', minHeight: 44 }}>
                      Choose {t.name}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Bolt-ons */}
        <div>
          <h3 className="text-sm font-semibold text-text-primary mb-1">Top-ups</h3>
          <p className="text-xs mb-2" style={{ color: '#64748b' }}>One-off credit packs — never expire, used after your monthly quota.</p>
          <div className="grid grid-cols-2 gap-2">
            {BOLT_ONS.map((b) => (
              <button key={b.key} onClick={() => handlePurchase(`bolton:${b.key}`)} className="rounded-xl p-3 text-left" style={{ background: '#111827', border: '1px solid #1e2d47', minHeight: 64 }}>
                <div className="text-sm font-semibold text-white">{b.label}</div>
                <div className="text-xs mt-0.5" style={{ color: '#10b981' }}>{fmtPrice(b.price)}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Manage subscription */}
        {isPaid && (
          <button
            onClick={handleManageSubscription}
            disabled={busy}
            className="w-full rounded-xl py-2.5 text-sm font-medium disabled:opacity-60"
            style={{ background: '#111827', border: '1px solid #1e2d47', color: '#94a3b8', minHeight: 44 }}
          >
            {busy ? 'Loading…' : 'Manage subscription'}
          </button>
        )}

        {/* Settings & About — tucked-away section */}
        <SettingsSection userId={profile?.id} savedCurrency={profile?.currency} savedTheme={profile?.theme} />

        {/* Sign out */}
        <button onClick={handleSignOut} className="w-full rounded-xl py-3 text-sm font-medium flex items-center justify-between px-4" style={{ background: '#111827', border: '1px solid #1e2d47', color: '#ef4444', minHeight: 44 }}>
          Sign Out <span>→</span>
        </button>

      </div>
    </div>
  );
}
