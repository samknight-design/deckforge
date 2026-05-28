export function getCurrentMonthYear() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export async function checkScanLimit(supabase, userId, tier) {
  if (tier === 'pro') return { allowed: true, current: null, limit: null };

  const monthYear = getCurrentMonthYear();
  const { data, error } = await supabase
    .from('usage')
    .select('scan_count')
    .eq('user_id', userId)
    .eq('month_year', monthYear)
    .single();

  if (error && error.code !== 'PGRST116') {
    return { allowed: false, error: 'Failed to check usage' };
  }

  const current = data?.scan_count || 0;
  const limit = 25;

  return { allowed: current < limit, current, limit };
}

export async function incrementScanCount(supabase, userId) {
  const monthYear = getCurrentMonthYear();

  const { data: existing } = await supabase
    .from('usage')
    .select('id, scan_count')
    .eq('user_id', userId)
    .eq('month_year', monthYear)
    .single();

  if (existing) {
    await supabase
      .from('usage')
      .update({ scan_count: (existing.scan_count || 0) + 1 })
      .eq('id', existing.id);
  } else {
    await supabase
      .from('usage')
      .insert({ user_id: userId, month_year: monthYear, scan_count: 1, insight_count: 0 });
  }
}

export async function checkInsightLimit(supabase, userId, tier) {
  // Insights are free for all users
  return { allowed: true };
}

export async function incrementInsightCount(supabase, userId) {
  const monthYear = getCurrentMonthYear();

  const { data: existing } = await supabase
    .from('usage')
    .select('id, insight_count')
    .eq('user_id', userId)
    .eq('month_year', monthYear)
    .single();

  if (existing) {
    await supabase
      .from('usage')
      .update({ insight_count: (existing.insight_count || 0) + 1 })
      .eq('id', existing.id);
  } else {
    await supabase
      .from('usage')
      .insert({ user_id: userId, month_year: monthYear, scan_count: 0, insight_count: 1 });
  }
}
