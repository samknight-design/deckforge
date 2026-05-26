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

  const { data: deckCards } = await supabase
    .from('deck_cards')
    .select(`
      id, deck_id, scryfall_id, card_name, quantity, is_commander, is_partner, added_at,
      card_cache (
        scryfall_id, card_name, oracle_text, mana_cost, cmc, type_line,
        colors, color_identity, set_code, set_name,
        image_uri, image_uri_back,
        price_usd, price_eur,
        is_legendary, is_creature, is_land,
        power, toughness, loyalty, legalities
      )
    `)
    .eq('deck_id', params.id)
    .order('card_name');

  const { data: profile } = await supabase
    .from('profiles')
    .select('tier')
    .eq('id', user.id)
    .single();

  // Merge card_cache data into deck_cards
  const cards = (deckCards || []).map((dc) => ({
    ...dc,
    ...(dc.card_cache || {}),
    card_name: dc.card_name || dc.card_cache?.card_name,
  }));

  return (
    <DeckDetail
      deck={deck}
      initialCards={cards}
      tier={profile?.tier || 'free'}
      userId={user.id}
    />
  );
}
