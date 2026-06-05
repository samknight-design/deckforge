// Supabase data helpers for the mobile app. Thin typed wrappers around the
// same tables the web PWA uses (decks, deck_cards, card_cache). RLS enforces
// ownership server-side, so these only ever touch the signed-in user's rows.

import { supabase } from './supabase';

export type Deck = {
  id: string;
  name: string;
  format: string;
  card_count: number | null;
  commander_name?: string | null;
  commander_image_url?: string | null;
  updated_at?: string;
};

export type DeckCard = {
  id: string;
  scryfall_id: string;
  card_name: string;
  quantity: number;
  is_foil: boolean;
  is_commander: boolean;
  is_partner: boolean;
  // merged in from card_cache:
  image_uri?: string | null;
  type_line?: string | null;
  set_name?: string | null;
  cmc?: number | null;
  price_eur?: number | null;
};

// Minimal shape needed to add a card — produced by the scanner and search.
export type CardRef = {
  scryfall_id: string;
  card_name: string;
};

export async function getDecks(userId: string): Promise<Deck[]> {
  const { data, error } = await supabase
    .from('decks')
    .select('id, name, format, card_count, commander_name, commander_image_url, updated_at')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data as Deck[]) || [];
}

export async function createDeck(userId: string, name: string, format: string): Promise<Deck> {
  const { data, error } = await supabase
    .from('decks')
    .insert({ user_id: userId, name: name.trim(), format, card_count: 0 })
    .select('id, name, format, card_count, commander_name, commander_image_url, updated_at')
    .single();
  if (error) throw error;
  return data as Deck;
}

// Deck cards joined with their card_cache rows (for image/type/price). We fetch
// the two tables separately and merge in JS — the same pattern the web app uses
// (embedded joins silently return null without a real FK).
export async function getDeckCards(deckId: string): Promise<DeckCard[]> {
  const { data: rows, error } = await supabase
    .from('deck_cards')
    .select('id, scryfall_id, card_name, quantity, is_foil, is_commander, is_partner')
    .eq('deck_id', deckId)
    .order('card_name');
  if (error) throw error;
  const cards = (rows as DeckCard[]) || [];
  const ids = cards.map((c) => c.scryfall_id).filter(Boolean);
  if (ids.length === 0) return cards;

  const { data: cache } = await supabase
    .from('card_cache')
    .select('scryfall_id, image_uri, type_line, set_name, cmc, price_eur')
    .in('scryfall_id', ids);
  const byId = Object.fromEntries((cache || []).map((c: any) => [c.scryfall_id, c]));
  return cards.map((c) => ({ ...c, ...(byId[c.scryfall_id] || {}), card_name: c.card_name }));
}

// Add a card to a deck. A foil and a non-foil of the same printing are tracked
// as separate lines (matches the web app's deck_cards unique key). Returns the
// resulting quantity.
export async function addCardToDeck(deckId: string, card: CardRef, isFoil = false): Promise<number> {
  const { data: existing, error: selErr } = await supabase
    .from('deck_cards')
    .select('id, quantity')
    .eq('deck_id', deckId)
    .eq('scryfall_id', card.scryfall_id)
    .eq('is_foil', isFoil)
    .maybeSingle();
  if (selErr) throw selErr;

  if (existing) {
    const nextQty = (existing.quantity || 1) + 1;
    const { error } = await supabase.from('deck_cards').update({ quantity: nextQty }).eq('id', existing.id);
    if (error) throw error;
    return nextQty;
  }

  const { error } = await supabase.from('deck_cards').insert({
    deck_id: deckId,
    scryfall_id: card.scryfall_id,
    card_name: card.card_name,
    quantity: 1,
    is_commander: false,
    is_partner: false,
    is_foil: isFoil,
  });
  if (error) throw error;
  return 1;
}
