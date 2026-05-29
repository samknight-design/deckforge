import { createClient } from '@/lib/supabase/server';
import ProfilePage from '@/components/ProfilePage';
import { weekKey, monthKey } from '@/lib/tiers';

export const dynamic = 'force-dynamic';

export default async function Profile() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const monthYear = monthKey();
  const wk = weekKey();

  const [{ data: profile }, { data: usage }, { data: decks }, { data: ach }, { data: tasks }] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', user.id).single(),
    supabase.from('usage').select('scan_count, insight_count').eq('user_id', user.id).eq('month_year', monthYear).maybeSingle(),
    supabase.from('decks')
      .select('id, name, format, commander_name, commander_image_url, bracket, like_count, is_public, card_count')
      .eq('user_id', user.id)
      .order('like_count', { ascending: false }),
    supabase.from('user_achievements').select('achievement_key').eq('user_id', user.id),
    supabase.from('user_tasks').select('task_key, period_key, progress, claimed').eq('user_id', user.id).in('period_key', [wk, monthYear]),
  ]);

  const allDecks = decks || [];
  const publicDecks = allDecks.filter((d) => d.is_public);
  const totalLikes = allDecks.reduce((s, d) => s + (d.like_count || 0), 0);

  return (
    <ProfilePage
      profile={profile || { email: user.email, tier: 'free', xp: 0 }}
      usage={usage || { scan_count: 0, insight_count: 0 }}
      deckCount={allDecks.length}
      publicDecks={publicDecks}
      totalLikes={totalLikes}
      achievementKeys={(ach || []).map((a) => a.achievement_key)}
      tasks={tasks || []}
      weekKeyStr={wk}
      monthKeyStr={monthYear}
    />
  );
}
