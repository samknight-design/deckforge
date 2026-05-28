import { createClient } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';
import DeckDetail from '@/components/DeckDetail';

export default async function DeckDetailPage({ params }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // Round 1: deck, deck_cards, and profile all fire simultaneously
  const [deckResult, deckCardsResult, profileResult] = await Promise.all([
    supabase
      .from('decks')
      .select('*')
      .eq('id', params.id)
      .eq('user_id', user.id)
      .single(),
    supabase
      .from('deck_cards')
      .select('id, deck_id, scryfall_id, card_name, quantity, is_commander, is_partner, added_at')
      .eq('deck_id', params.id)
      .order('card_name'),
    supabase
      .from('profiles')
      .select('tier')
      .eq('id', user.id)
      .single(),
  ]);

  if (deckResult.error || !deckResult.data) {
    notFound();
  }

  // Round 2: card_cache only (needs scryfall_ids from round 1)
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

  return (
    <DeckDetail
      deck={deckResult.data}
      initialCards={cards}
      tier={profileResult.data?.tier || 'free'}
      userId={user.id}
    />
  );
}
