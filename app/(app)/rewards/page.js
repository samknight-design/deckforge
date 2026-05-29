import { createClient } from '@/lib/supabase/server';
import RewardsTrack from '@/components/RewardsTrack';

export const dynamic = 'force-dynamic';

export default async function RewardsPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = await supabase.from('profiles').select('xp').eq('id', user.id).single();
  return <RewardsTrack xp={profile?.xp || 0} />;
}
