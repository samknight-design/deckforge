import { scanQuota, insightQuota } from './tiers';

export function getCurrentMonthYear() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

async function getUsageRow(supabase, userId) {
  const monthYear = getCurrentMonthYear();
  const { data } = await supabase
    .from('usage')
    .select('id, scan_count, insight_count')
    .eq('user_id', userId)
    .eq('month_year', monthYear)
    .maybeSingle();
  return { monthYear, row: data };
}

// ── Scans ───────────────────────────────────────────────────────────────────
// Allowed if the monthly quota isn't used up OR the user has scan credits.
export async function checkScanLimit(supabase, userId, tier) {
  const quota = scanQuota(tier);
  const { row } = await getUsageRow(supabase, userId);
  const used = row?.scan_count || 0;
  const { data: p } = await supabase.from('profiles').select('scan_credits').eq('id', userId).maybeSingle();
  const credits = p?.scan_credits || 0;
  return { allowed: used < quota || credits > 0, used, quota, credits };
}

// Consume one scan: monthly quota first, then a credit. Returns the bucket used.
export async function consumeScan(supabase, userId, tier) {
  const quota = scanQuota(tier);
  const { monthYear, row } = await getUsageRow(supabase, userId);
  const used = row?.scan_count || 0;

  if (used < quota) {
    if (row) await supabase.from('usage').update({ scan_count: used + 1 }).eq('id', row.id);
    else await supabase.from('usage').insert({ user_id: userId, month_year: monthYear, scan_count: 1, insight_count: 0 });
    return { bucket: 'quota' };
  }

  const { data: p } = await supabase.from('profiles').select('scan_credits').eq('id', userId).maybeSingle();
  const credits = p?.scan_credits || 0;
  if (credits > 0) {
    await supabase.from('profiles').update({ scan_credits: credits - 1 }).eq('id', userId);
    await supabase.from('credit_ledger').insert({ user_id: userId, kind: 'scan', amount: -1, reason: 'consume' });
    return { bucket: 'credit' };
  }
  return { bucket: null };
}

// ── Insights ─────────────────────────────────────────────────────────────────
export async function checkInsightLimit(supabase, userId, tier) {
  const quota = insightQuota(tier);
  const { row } = await getUsageRow(supabase, userId);
  const used = row?.insight_count || 0;
  const { data: p } = await supabase.from('profiles').select('insight_credits').eq('id', userId).maybeSingle();
  const credits = p?.insight_credits || 0;
  return { allowed: used < quota || credits > 0, used, quota, credits };
}

export async function consumeInsight(supabase, userId, tier) {
  const quota = insightQuota(tier);
  const { monthYear, row } = await getUsageRow(supabase, userId);
  const used = row?.insight_count || 0;

  if (used < quota) {
    if (row) await supabase.from('usage').update({ insight_count: used + 1 }).eq('id', row.id);
    else await supabase.from('usage').insert({ user_id: userId, month_year: monthYear, scan_count: 0, insight_count: 1 });
    return { bucket: 'quota' };
  }

  const { data: p } = await supabase.from('profiles').select('insight_credits').eq('id', userId).maybeSingle();
  const credits = p?.insight_credits || 0;
  if (credits > 0) {
    await supabase.from('profiles').update({ insight_credits: credits - 1 }).eq('id', userId);
    await supabase.from('credit_ledger').insert({ user_id: userId, kind: 'insight', amount: -1, reason: 'consume' });
    return { bucket: 'credit' };
  }
  return { bucket: null };
}
