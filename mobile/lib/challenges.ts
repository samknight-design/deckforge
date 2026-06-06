// Daily challenge system.
//
// Each challenge can be completed once per calendar day (UTC). Progress is
// stored in the challenge_progress table. XP is awarded atomically via the
// award_xp Postgres function when a challenge completes.
//
// Call tryCompleteChallenge() whenever a relevant action occurs — it's safe
// to call multiple times (idempotent once completed for the day).

import { supabase } from './supabase';

// ── Definitions ──────────────────────────────────────────────────────────────

export type ChallengeKey =
  | 'daily_login'
  | 'scan_cards'
  | 'like_decks'
  | 'add_to_deck'
  | 'share_deck'
  | 'run_insights';

export type Challenge = {
  key: ChallengeKey;
  label: string;
  description: string;
  icon: string;
  xp: number;
  /** How many increments needed to complete */
  target: number;
};

export const DAILY_CHALLENGES: Challenge[] = [
  {
    key: 'daily_login',
    label: 'Daily Check-in',
    description: 'Open the app today',
    icon: '🌅',
    xp: 10,
    target: 1,
  },
  {
    key: 'scan_cards',
    label: 'Card Scanner',
    description: 'Scan 3 cards',
    icon: '📷',
    xp: 30,
    target: 3,
  },
  {
    key: 'like_decks',
    label: 'Community Spirit',
    description: 'Like 3 community decks',
    icon: '♥',
    xp: 30,
    target: 3,
  },
  {
    key: 'add_to_deck',
    label: 'Deck Builder',
    description: 'Add 5 cards to any deck',
    icon: '🗂️',
    xp: 25,
    target: 5,
  },
  {
    key: 'share_deck',
    label: 'Community Share',
    description: 'Share a deck publicly',
    icon: '🌐',
    xp: 50,
    target: 1,
  },
  {
    key: 'run_insights',
    label: 'AI Analyst',
    description: 'Run AI Insights on a deck',
    icon: '🧠',
    xp: 40,
    target: 1,
  },
];

// Max possible XP per day = sum of all challenge XP values (185 XP)
export const MAX_DAILY_XP = DAILY_CHALLENGES.reduce((s, c) => s + c.xp, 0);

// ── Progress type returned to UI ──────────────────────────────────────────────

export type ChallengeProgress = Challenge & {
  progress: number;
  completed: boolean;
  xp_earned: number;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayUTC(): string {
  return new Date().toISOString().split('T')[0]; // YYYY-MM-DD
}

/**
 * Fetch today's progress for all challenges for a given user.
 * Returns every challenge definition merged with its DB row (if any).
 */
export async function getDailyChallenges(userId: string): Promise<ChallengeProgress[]> {
  const today = todayUTC();
  const { data } = await supabase
    .from('challenge_progress')
    .select('challenge_key, progress, completed, xp_earned')
    .eq('user_id', userId)
    .eq('completed_date', today);

  const byKey = Object.fromEntries((data || []).map((r: any) => [r.challenge_key, r]));

  return DAILY_CHALLENGES.map((c) => ({
    ...c,
    progress: byKey[c.key]?.progress ?? 0,
    completed: byKey[c.key]?.completed ?? false,
    xp_earned: byKey[c.key]?.xp_earned ?? 0,
  }));
}

/**
 * Get total XP earned from challenges today.
 */
export async function getDailyXpEarned(userId: string): Promise<number> {
  const today = todayUTC();
  const { data } = await supabase
    .from('challenge_progress')
    .select('xp_earned')
    .eq('user_id', userId)
    .eq('completed_date', today);
  return (data || []).reduce((s: number, r: any) => s + (r.xp_earned || 0), 0);
}

/**
 * Try to advance progress on a challenge. Call this whenever the relevant
 * action occurs. Returns the XP earned (0 if already completed or not yet done).
 *
 * progressIncrement — how many units this action contributes (default 1).
 *
 * Safe to call multiple times — once completed for the day it's a no-op.
 */
export async function tryCompleteChallenge(
  userId: string,
  key: ChallengeKey,
  progressIncrement = 1,
): Promise<{ justCompleted: boolean; xpEarned: number; newProgress: number; total: number }> {
  const def = DAILY_CHALLENGES.find((c) => c.key === key);
  if (!def) return { justCompleted: false, xpEarned: 0, newProgress: 0, total: 0 };

  const today = todayUTC();

  // Read existing row
  const { data: existing } = await supabase
    .from('challenge_progress')
    .select('id, progress, completed, xp_earned')
    .eq('user_id', userId)
    .eq('challenge_key', key)
    .eq('completed_date', today)
    .maybeSingle();

  // Already completed today — no-op
  if (existing?.completed) {
    return { justCompleted: false, xpEarned: 0, newProgress: existing.progress, total: existing.xp_earned };
  }

  const prevProgress = existing?.progress ?? 0;
  const newProgress = Math.min(prevProgress + progressIncrement, def.target);
  const justCompleted = newProgress >= def.target;
  const xpEarned = justCompleted ? def.xp : 0;

  if (existing) {
    await supabase
      .from('challenge_progress')
      .update({
        progress: newProgress,
        completed: justCompleted,
        xp_earned: justCompleted ? def.xp : 0,
      })
      .eq('id', existing.id);
  } else {
    await supabase.from('challenge_progress').insert({
      user_id: userId,
      challenge_key: key,
      completed_date: today,
      progress: newProgress,
      completed: justCompleted,
      xp_earned: xpEarned,
    });
  }

  // Award XP atomically via Postgres function
  let newTotalXp = 0;
  if (justCompleted && xpEarned > 0) {
    const { data } = await supabase.rpc('award_xp', { p_user_id: userId, p_amount: xpEarned });
    newTotalXp = (data as number) ?? 0;
  }

  return { justCompleted, xpEarned, newProgress, total: newTotalXp };
}
