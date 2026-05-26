import { createClient } from '@/lib/supabase/server';
import ProfilePage from '@/components/ProfilePage';

export default async function Profile() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  const now = new Date();
  const monthYear = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const { data: usage } = await supabase
    .from('usage')
    .select('scan_count, insight_count')
    .eq('user_id', user.id)
    .eq('month_year', monthYear)
    .maybeSingle();

  const { count: deckCount } = await supabase
    .from('decks')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id);

  return (
    <ProfilePage
      profile={profile || { email: user.email, tier: 'free' }}
      usage={usage || { scan_count: 0, insight_count: 0 }}
      deckCount={deckCount || 0}
    />
  );
}
