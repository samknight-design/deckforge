import { createClient } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';
import DeckDetail from '@/components/DeckDetail';

export default async function DeckDetailPage({ params }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: deck, error } = await supabase
    .from('decks')
    .select('*')
    .eq('id', params.id)
    .eq('user_id', user.id)
    .single();

  if (error || !deck) {
    notFound();
  }

  // Fetch deck_cards WITHOUT embedded join (no FK exists from scryfall_id to card_cache)
  const { data: deckCards } = await supabase
    .from('deck_cards')
    .select('id, deck_id, scryfall_id, card_name, quantity, is_commander, is_partner, added_at')
    .eq('deck_id', params.id)
    .order('card_name');

  // Separately fetch card_cache data for all scryfall_ids in this deck
  const scryfallIds = (deckCards || []).map((dc) => dc.scryfall_id).filter(Boolean);
  let cacheMap = {};
  if (scryfallIds.length > 0) {
    const { data: cached } = await supabase
      .from('card_cache')
      .select('*')
      .in('scryfall_id', scryfallIds);
    cacheMap = Object.fromEntries((cached || []).map((c) => [c.scryfall_id, c]));
  }

  // Merge: deck_card row + card_cache data
  const cards = (deckCards || []).map((dc) => ({
    ...dc,
    ...(cacheMap[dc.scryfall_id] || {}),
    card_name: dc.card_name || cacheMap[dc.scryfall_id]?.card_name || '',
  }));

  const { data: profile } = await supabase
    .from('profiles')
    .select('tier')
    .eq('id', user.id)
    .single();

  return (
    <DeckDetail
      deck={deck}
      initialCards={cards}
      tier={profile?.tier || 'free'}
      userId={user.id}
    />
  );
}
