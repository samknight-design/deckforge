'use client';

// Was a server component using notFound() to throw a 404. In static export the
// route exists as a dynamic page; we resolve and render an inline 'not found'
// state when the deck isn't visible to the current user.

import { useParams, useRouter } from 'next/navigation';
import { useInitialData, LoadingScreen } from '@/lib/useInitialData';
import DeckDetail from '@/components/DeckDetail';

export default function DeckDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id;
  const { loading, data, user } = useInitialData(async (supabase, user) => {
    const [deckResult, deckCardsResult, profileResult] = await Promise.all([
      supabase.from('decks').select('*').eq('id', id).eq('user_id', user.id).single(),
      supabase.from('deck_cards')
        .select('id, deck_id, scryfall_id, card_name, quantity, is_commander, is_partner, is_foil, added_at')
        .eq('deck_id', id)
        .order('card_name'),
      supabase.from('profiles').select('tier').eq('id', user.id).single(),
    ]);
    if (deckResult.error || !deckResult.data) return { notFound: true };

    const scryfallIds = (deckCardsResult.data || []).map((dc) => dc.scryfall_id).filter(Boolean);
    const cacheResult = scryfallIds.length > 0
      ? await supabase.from('card_cache').select('*').in('scryfall_id', scryfallIds)
      : { data: [] };
    const cacheMap = Object.fromEntries(
      (cacheResult.data || []).map((c) => [c.scryfall_id, c])
    );
    const cards = (deckCardsResult.data || []).map((dc) => ({
      ...dc,
      ...(cacheMap[dc.scryfall_id] || {}),
      card_name: dc.card_name || cacheMap[dc.scryfall_id]?.card_name || '',
    }));
    return {
      deck: deckResult.data,
      initialCards: cards,
      tier: profileResult.data?.tier || 'free',
    };
  });

  if (loading || !data) return <LoadingScreen />;
  if (data.notFound) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6 text-center" style={{ background: '#0a0e1a' }}>
        <div className="text-5xl mb-3">🗂️</div>
        <p className="text-white font-semibold mb-1">Deck not found</p>
        <p className="text-sm mb-5" style={{ color: '#94a3b8' }}>It may have been deleted, or you don't have access.</p>
        <button
          onClick={() => router.push('/decks')}
          className="rounded-xl px-6 py-3 text-sm font-semibold"
          style={{ background: '#f59e0b', color: '#0a0e1a' }}
        >
          Back to decks
        </button>
      </div>
    );
  }
  return <DeckDetail deck={data.deck} initialCards={data.initialCards} tier={data.tier} userId={user.id} />;
}
