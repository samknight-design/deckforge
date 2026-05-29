// Central config for tiers, bolt-ons, avatars, XP levels, achievements and
// tasks. Pure data + pure helpers only — safe to import from client or server.

export const CURRENCY = '£';

// decks: null = unlimited. scans/insights are monthly quotas.
export const TIERS = {
  free:      { key: 'free',      name: 'Free',      price: 0,     scans: 30,   insights: 2,  decks: 1,    color: '#64748b', icon: '🆓', blurb: 'Get started' },
  pro:       { key: 'pro',       name: 'Pro',       price: 6.99,  scans: 1200, insights: 25, decks: null, color: '#f59e0b', icon: '⚡', blurb: 'For regular players' },
  legendary: { key: 'legendary', name: 'Legendary', price: 14.99, scans: 4000, insights: 60, decks: null, color: '#a855f7', icon: '👑', blurb: 'For the hardcore' },
};
export const TIER_ORDER = ['free', 'pro', 'legendary'];

// One-off credit packs. Priced so a subscription is always better value/scan.
export const BOLT_ONS = [
  { key: 'scans_100', label: '100 scans', kind: 'scan', amount: 100, price: 1.99 },
  { key: 'scans_300', label: '300 scans', kind: 'scan', amount: 300, price: 2.99 },
];

// Preset avatar pack (emoji on a coloured disc — no uploads/storage).
export const AVATARS = [
  { key: 'flame',   emoji: '🔥', bg: '#dc2626' },
  { key: 'isle',    emoji: '💧', bg: '#2563eb' },
  { key: 'grave',   emoji: '💀', bg: '#374151' },
  { key: 'forest',  emoji: '🌿', bg: '#16a34a' },
  { key: 'sun',     emoji: '☀️', bg: '#eab308' },
  { key: 'dragon',  emoji: '🐉', bg: '#b91c1c' },
  { key: 'wizard',  emoji: '🧙', bg: '#7c3aed' },
  { key: 'crown',   emoji: '👑', bg: '#a855f7' },
  { key: 'sword',   emoji: '⚔️', bg: '#0ea5e9' },
  { key: 'skull',   emoji: '☠️', bg: '#111827' },
  { key: 'gem',     emoji: '💎', bg: '#06b6d4' },
  { key: 'star',    emoji: '⭐', bg: '#f59e0b' },
];
export const DEFAULT_AVATAR = AVATARS[6]; // wizard

export function getAvatar(key) {
  return AVATARS.find((a) => a.key === key) || DEFAULT_AVATAR;
}

export function tierConfig(tier) {
  return TIERS[tier] || TIERS.free;
}
export function scanQuota(tier) {
  return tierConfig(tier).scans;
}
export function insightQuota(tier) {
  return tierConfig(tier).insights;
}
// null = unlimited
export function deckLimit(tier) {
  return tierConfig(tier).decks;
}

// ── XP / levels ───────────────────────────────────────────────────────────
// Cumulative XP required to reach a level (level 1 = 0 XP).
export function xpForLevel(level) {
  if (level <= 1) return 0;
  return Math.round(50 * Math.pow(level - 1, 1.5));
}

export function levelFromXp(xp) {
  let lvl = 1;
  while (xpForLevel(lvl + 1) <= (xp || 0)) lvl++;
  return lvl;
}

export function levelProgress(xp) {
  const level = levelFromXp(xp);
  const base = xpForLevel(level);
  const next = xpForLevel(level + 1);
  return { level, into: (xp || 0) - base, span: next - base, nextAt: next };
}

// Credits granted on REACHING a given level (the "free gifts"). Funded mostly
// by cheap scan credits; an insight credit every 5 levels.
export function levelRewards(level) {
  const scan = 20;
  const insight = level % 5 === 0 ? 5 : 0;
  return { scan, insight };
}

// ── Achievements (metric-threshold based; evaluated from profile counters) ──
export const ACHIEVEMENTS = [
  { key: 'first_scan',     icon: '📷', name: 'First Scan',     desc: 'Scan your first card',            xp: 20,  metric: 'lifetime_scans',    threshold: 1 },
  { key: 'scan_100',       icon: '🃏', name: 'Centurion',      desc: 'Scan 100 cards',                  xp: 50,  metric: 'lifetime_scans',    threshold: 100 },
  { key: 'scan_1000',      icon: '🏛️', name: 'Archivist',      desc: 'Scan 1,000 cards',                xp: 200, metric: 'lifetime_scans',    threshold: 1000 },
  { key: 'first_insight',  icon: '✨', name: 'Strategist',     desc: 'Generate your first insight',     xp: 20,  metric: 'lifetime_insights', threshold: 1 },
  { key: 'insight_25',     icon: '🧠', name: 'Mastermind',     desc: 'Generate 25 insights',            xp: 100, metric: 'lifetime_insights', threshold: 25 },
  { key: 'first_publish',  icon: '🌐', name: 'Going Public',   desc: 'Publish a deck to the community',  xp: 30,  metric: 'decks_published',   threshold: 1 },
  { key: 'likes_given_25', icon: '👍', name: 'Tastemaker',     desc: 'Like 25 community decks',          xp: 50,  metric: 'likes_given',       threshold: 25 },
  { key: 'likes_recv_10',  icon: '⭐', name: 'Crowd Pleaser',  desc: 'Receive 10 likes',                 xp: 60,  metric: 'likes_received',    threshold: 10 },
  { key: 'likes_recv_100', icon: '🏆', name: 'Fan Favourite',  desc: 'Receive 100 likes',                xp: 250, metric: 'likes_received',    threshold: 100 },
];

// ── Tasks (weekly/monthly). metric maps to a recordEvent type. ──────────────
export const TASKS = [
  { key: 'w_scan_20',   period: 'week',  icon: '📷', name: 'Scan 20 cards',  metric: 'scan',       target: 20,  xp: 40 },
  { key: 'w_like_5',    period: 'week',  icon: '👍', name: 'Like 5 decks',   metric: 'like_given', target: 5,   xp: 30 },
  { key: 'w_insight_1', period: 'week',  icon: '✨', name: 'Run an insight', metric: 'insight',    target: 1,   xp: 25 },
  { key: 'm_scan_100',  period: 'month', icon: '🃏', name: 'Scan 100 cards', metric: 'scan',       target: 100, xp: 120 },
  { key: 'm_publish_1', period: 'month', icon: '🌐', name: 'Publish a deck', metric: 'publish',    target: 1,   xp: 80 },
];

// Period keys: ISO-ish week ("2026-W22") and month ("2026-05").
export function weekKey(d = new Date()) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (date.getUTCDay() + 6) % 7; // Mon=0
  date.setUTCDate(date.getUTCDate() - dayNum + 3); // nearest Thursday
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((date - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
export function monthKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
export function periodKeyFor(period) {
  return period === 'week' ? weekKey() : monthKey();
}
