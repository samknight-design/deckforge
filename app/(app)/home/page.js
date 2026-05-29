import { createServiceClient } from '@/lib/supabase/server';
import HomePage from '@/components/HomePage';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const svc = createServiceClient();

  // Rank public decks by likes in the last 7 days, tie-broken by all-time likes.
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const [{ data: recentLikes }, { data: publicDecks }] = await Promise.all([
    svc.from('deck_likes').select('deck_id').gte('created_at', weekAgo),
    svc
      .from('decks')
      .select('id, name, format, commander_name, commander_image_url, bracket, like_count, card_count')
      .eq('is_public', true)
      .order('like_count', { ascending: false })
      .limit(50),
  ]);

  const weeklyCounts = {};
  (recentLikes || []).forEach((r) => { weeklyCounts[r.deck_id] = (weeklyCounts[r.deck_id] || 0) + 1; });
  const byId = Object.fromEntries((publicDecks || []).map((d) => [d.id, d]));

  const seen = new Set();
  const topDecks = [];
  // Weekly-liked public decks first (most weekly likes)
  Object.entries(weeklyCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([id, n]) => {
      if (byId[id] && !seen.has(id)) { topDecks.push({ ...byId[id], weekly: n }); seen.add(id); }
    });
  // Backfill with top all-time public decks
  (publicDecks || []).forEach((d) => { if (!seen.has(d.id)) { topDecks.push(d); seen.add(d.id); } });

  return <HomePage topDecks={topDecks.slice(0, 8)} />;
}
