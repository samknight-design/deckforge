'use client';

import { useInitialData, LoadingScreen } from '@/lib/useInitialData';
import RewardsTrack from '@/components/RewardsTrack';

export default function RewardsPage() {
  const { loading, data } = useInitialData(async (supabase, user) => {
    const { data: profile } = await supabase.from('profiles').select('xp').eq('id', user.id).single();
    return { xp: profile?.xp || 0 };
  });
  if (loading || !data) return <LoadingScreen />;
  return <RewardsTrack xp={data.xp} />;
}
