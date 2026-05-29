// Server-only gamification logic. Pass a Supabase SERVICE client (bypasses RLS).
// recordEvent is best-effort and never throws into the caller's hot path.
import { ACHIEVEMENTS, TASKS, levelFromXp, levelRewards, periodKeyFor } from './tiers';

// event type → lifetime counter column on profiles
const EVENT_METRIC = {
  scan: 'lifetime_scans',
  insight: 'lifetime_insights',
  like_given: 'likes_given',
  like_received: 'likes_received',
  publish: 'decks_published',
};

// base XP per event (publish handled via task/achievement to avoid farming)
const EVENT_XP = {
  scan: 2,
  insight: 5,
  like_given: 1,
  like_received: 3,
  publish: 0,
  clone_received: 5,
};

async function progressTasks(svc, userId, type, n) {
  const tasks = TASKS.filter((t) => t.metric === type);
  if (!tasks.length) return 0;
  let xp = 0;
  for (const t of tasks) {
    const period_key = periodKeyFor(t.period);
    const { data: row } = await svc
      .from('user_tasks')
      .select('id, progress, claimed')
      .eq('user_id', userId)
      .eq('task_key', t.key)
      .eq('period_key', period_key)
      .maybeSingle();

    const progress = (row?.progress || 0) + n;
    let claimed = row?.claimed || false;
    if (!claimed && progress >= t.target) { claimed = true; xp += t.xp; }

    if (row) {
      await svc.from('user_tasks').update({ progress, claimed, updated_at: new Date().toISOString() }).eq('id', row.id);
    } else {
      await svc.from('user_tasks').insert({ user_id: userId, task_key: t.key, period_key, progress, claimed });
    }
  }
  return xp;
}

async function evalAchievements(svc, userId, metrics) {
  const { data: have } = await svc.from('user_achievements').select('achievement_key').eq('user_id', userId);
  const haveSet = new Set((have || []).map((r) => r.achievement_key));
  let xp = 0;
  const toInsert = [];
  for (const a of ACHIEVEMENTS) {
    if (haveSet.has(a.key)) continue;
    if ((metrics[a.metric] || 0) >= a.threshold) {
      toInsert.push({ user_id: userId, achievement_key: a.key });
      xp += a.xp;
    }
  }
  if (toInsert.length) await svc.from('user_achievements').insert(toInsert);
  return xp;
}

// Record a gamified event: bumps lifetime counters, progresses tasks, unlocks
// achievements, awards XP and grants level-up credit rewards.
export async function recordEvent(svc, userId, type, n = 1) {
  if (!userId) return;
  try {
    const { data: p } = await svc
      .from('profiles')
      .select('xp, scan_credits, insight_credits, lifetime_scans, lifetime_insights, likes_given, likes_received, decks_published')
      .eq('id', userId)
      .single();
    if (!p) return;

    const updates = {};
    const col = EVENT_METRIC[type];
    if (col) updates[col] = (p[col] || 0) + n;

    let xpGain = (EVENT_XP[type] || 0) * n;
    xpGain += await progressTasks(svc, userId, type, n);
    xpGain += await evalAchievements(svc, userId, { ...p, ...updates });

    const beforeXp = p.xp || 0;
    const afterXp = beforeXp + xpGain;
    updates.xp = afterXp;

    let scanReward = 0;
    let insightReward = 0;
    for (let L = levelFromXp(beforeXp) + 1; L <= levelFromXp(afterXp); L++) {
      const r = levelRewards(L);
      scanReward += r.scan;
      insightReward += r.insight;
    }
    if (scanReward) updates.scan_credits = (p.scan_credits || 0) + scanReward;
    if (insightReward) updates.insight_credits = (p.insight_credits || 0) + insightReward;

    await svc.from('profiles').update(updates).eq('id', userId);

    if (scanReward) await svc.from('credit_ledger').insert({ user_id: userId, kind: 'scan', amount: scanReward, reason: 'xp_reward' });
    if (insightReward) await svc.from('credit_ledger').insert({ user_id: userId, kind: 'insight', amount: insightReward, reason: 'xp_reward' });
  } catch (e) {
    console.error('recordEvent error:', e);
  }
}

// Grant credits (bolt-on purchase or manual). kind: 'scan' | 'insight'.
export async function addCredits(svc, userId, kind, amount, reason = 'bolton') {
  const colMap = { scan: 'scan_credits', insight: 'insight_credits' };
  const col = colMap[kind] || 'scan_credits';
  const { data: p } = await svc.from('profiles').select(col).eq('id', userId).single();
  await svc.from('profiles').update({ [col]: (p?.[col] || 0) + amount }).eq('id', userId);
  await svc.from('credit_ledger').insert({ user_id: userId, kind, amount, reason });
}
