'use client';

import { useInitialData, LoadingScreen } from '@/lib/useInitialData';
import DeckListPage from '@/components/DeckListPage';

export default function DecksPage() {
  const { loading, data, user } = useInitialData(async (supabase, user) => {
    const [decksResult, profileResult] = await Promise.all([
      supabase.from('decks').select('*').eq('user_id', user.id).order('updated_at', { ascending: false }),
      supabase.from('profiles').select('tier').eq('id', user.id).single(),
    ]);
    return {
      decks: decksResult.data || [],
      tier: profileResult.data?.tier || 'free',
    };
  });
  if (loading || !data) return <LoadingScreen />;
  return <DeckListPage decks={data.decks} tier={data.tier} userId={user.id} />;
}
