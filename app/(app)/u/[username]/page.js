import { createServiceClient } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';
import PublicProfileView from '@/components/PublicProfileView';

export const dynamic = 'force-dynamic';

export default async function UserProfilePage({ params }) {
  const svc = createServiceClient();
  const raw = decodeURIComponent(params.username || '');
  // Escape ilike wildcards so the lookup is a literal, case-insensitive match.
  const safe = raw.replace(/[\\%_]/g, '\\$&');

  const { data: profile } = await svc
    .from('profiles')
    .select('id, username, avatar_key, tier, xp, likes_received, lifetime_scans, decks_published, created_at')
    .ilike('username', safe)
    .maybeSingle();

  if (!profile || !profile.username) notFound();

  const [{ data: decks }, { data: ach }] = await Promise.all([
    svc.from('decks')
      .select('id, name, format, commander_name, commander_image_url, bracket, like_count, card_count')
      .eq('user_id', profile.id)
      .eq('is_public', true)
      .order('like_count', { ascending: false }),
    svc.from('user_achievements').select('achievement_key').eq('user_id', profile.id),
  ]);

  const publicDecks = decks || [];
  const totalLikes = publicDecks.reduce((s, d) => s + (d.like_count || 0), 0);

  return (
    <PublicProfileView
      profile={profile}
      publicDecks={publicDecks}
      totalLikes={totalLikes}
      achievementKeys={(ach || []).map((a) => a.achievement_key)}
    />
  );
}
