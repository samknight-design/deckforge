// Supabase data helpers for the mobile app. Thin typed wrappers around the
// same tables the web PWA uses (decks, deck_cards, card_cache, user_cards,
// profiles). RLS enforces ownership server-side.

import { supabase } from './supabase';

export type Deck = {
  id: string;
  name: string;
  format: string;
  card_count: number | null;
  commander_name?: string | null;
  commander_image_url?: string | null;
  partner_name?: string | null;
  partner_image_url?: string | null;
  bracket?: number | null;
  is_public?: boolean;
  share_token?: string | null;
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
  mana_cost?: string | null;
  colors?: string[] | null;
  price_eur?: number | null;
};

export type CardRef = {
  scryfall_id: string;
  card_name: string;
};

export async function getDecks(userId: string): Promise<Deck[]> {
  const { data, error } = await supabase
    .from('decks')
    .select('id, name, format, card_count, commander_name, commander_image_url, partner_name, partner_image_url, bracket, is_public, share_token, updated_at')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data as Deck[]) || [];
}

export async function createDeck(userId: string, name: string, format: string): Promise<Deck> {
  const { data, error } = await supabase
    .from('decks')
    .insert({ user_id: userId, name: name.trim(), format, card_count: 0 })
    .select('id, name, format, card_count, commander_name, commander_image_url, partner_name, bracket, is_public, share_token, updated_at')
    .single();
  if (error) throw error;
  return data as Deck;
}

export async function updateDeck(deckId: string, updates: Partial<Pick<Deck, 'name' | 'format' | 'is_public'>>): Promise<void> {
  const { error } = await supabase.from('decks').update(updates).eq('id', deckId);
  if (error) throw error;
}

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
    .select('scryfall_id, image_uri, type_line, set_name, cmc, mana_cost, colors, price_eur')
    .in('scryfall_id', ids);
  const byId = Object.fromEntries((cache || []).map((c: any) => [c.scryfall_id, c]));
  return cards.map((c) => ({ ...c, ...(byId[c.scryfall_id] || {}), card_name: c.card_name }));
}

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

export async function setDeckCardQuantity(cardId: string, quantity: number): Promise<void> {
  if (quantity <= 0) {
    const { error } = await supabase.from('deck_cards').delete().eq('id', cardId);
    if (error) throw error;
  } else {
    const { error } = await supabase.from('deck_cards').update({ quantity }).eq('id', cardId);
    if (error) throw error;
  }
}

export async function setCommander(deckId: string, scryfallId: string | null, isPartner = false): Promise<void> {
  // Clear existing commander/partner flag of the same type
  if (isPartner) {
    await supabase.from('deck_cards').update({ is_partner: false }).eq('deck_id', deckId).eq('is_partner', true);
  } else {
    await supabase.from('deck_cards').update({ is_commander: false }).eq('deck_id', deckId).eq('is_commander', true);
  }
  if (scryfallId) {
    const col = isPartner ? 'is_partner' : 'is_commander';
    await supabase.from('deck_cards').update({ [col]: true }).eq('deck_id', deckId).eq('scryfall_id', scryfallId);
  }
}

export async function shareDeck(deckId: string): Promise<string> {
  const token = Math.random().toString(36).slice(2, 10);
  const { error } = await supabase
    .from('decks')
    .update({ is_public: true, share_token: token })
    .eq('id', deckId);
  if (error) throw error;
  return token;
}

export async function toggleDeckLike(userId: string, deckId: string): Promise<'liked' | 'unliked'> {
  const { data: existing } = await supabase
    .from('deck_likes')
    .select('id')
    .eq('user_id', userId)
    .eq('deck_id', deckId)
    .maybeSingle();

  if (existing) {
    await supabase.from('deck_likes').delete().eq('user_id', userId).eq('deck_id', deckId);
    await supabase.from('decks').update({ like_count: supabase.rpc('decrement', { x: 1 }) as any }).eq('id', deckId);
    return 'unliked';
  }
  await supabase.from('deck_likes').insert({ user_id: userId, deck_id: deckId });
  await supabase.rpc('increment_deck_like', { deck_id: deckId }).then(() => {});
  return 'liked';
}

// ── Library (user_cards) ────────────────────────────────────────────────────

export type LibraryCard = {
  id: string;
  scryfall_id: string;
  card_name: string;
  quantity: number;
  foil_quantity: number;
  condition: string;
  acquired_at: string;
  // joined from card_cache:
  image_uri?: string | null;
  type_line?: string | null;
  set_name?: string | null;
  set_code?: string | null;
  cmc?: number | null;
  mana_cost?: string | null;
  colors?: string[] | null;
  price_eur?: number | null;
};

export async function getLibrary(userId: string): Promise<LibraryCard[]> {
  const { data, error } = await supabase
    .from('user_cards')
    .select('id, scryfall_id, card_name, quantity, foil_quantity, condition, acquired_at')
    .eq('user_id', userId)
    .order('card_name');
  if (error) throw error;
  const cards = (data as LibraryCard[]) || [];
  const ids = cards.map((c) => c.scryfall_id);
  if (!ids.length) return cards;

  const { data: cache } = await supabase
    .from('card_cache')
    .select('scryfall_id, image_uri, type_line, set_name, set_code, cmc, mana_cost, colors, price_eur')
    .in('scryfall_id', ids);
  const byId = Object.fromEntries((cache || []).map((c: any) => [c.scryfall_id, c]));
  return cards.map((c) => ({ ...c, ...(byId[c.scryfall_id] || {}) }));
}

export async function addToLibrary(userId: string, card: CardRef, isFoil = false): Promise<void> {
  const { data: existing } = await supabase
    .from('user_cards')
    .select('id, quantity, foil_quantity')
    .eq('user_id', userId)
    .eq('scryfall_id', card.scryfall_id)
    .maybeSingle();

  if (existing) {
    const update = isFoil
      ? { foil_quantity: (existing.foil_quantity || 0) + 1 }
      : { quantity: (existing.quantity || 0) + 1 };
    await supabase.from('user_cards').update(update).eq('id', existing.id);
  } else {
    await supabase.from('user_cards').insert({
      user_id: userId,
      scryfall_id: card.scryfall_id,
      card_name: card.card_name,
      quantity: isFoil ? 0 : 1,
      foil_quantity: isFoil ? 1 : 0,
    });
  }
}

export async function removeFromLibrary(userId: string, scryfall_id: string): Promise<void> {
  const { error } = await supabase
    .from('user_cards')
    .delete()
    .eq('user_id', userId)
    .eq('scryfall_id', scryfall_id);
  if (error) throw error;
}

export async function setLibraryQuantity(
  userId: string,
  scryfall_id: string,
  quantity: number,
  foilQuantity: number,
): Promise<void> {
  if (quantity <= 0 && foilQuantity <= 0) {
    await removeFromLibrary(userId, scryfall_id);
    return;
  }
  const { error } = await supabase
    .from('user_cards')
    .update({ quantity, foil_quantity: foilQuantity })
    .eq('user_id', userId)
    .eq('scryfall_id', scryfall_id);
  if (error) throw error;
}

// ── Profile ─────────────────────────────────────────────────────────────────

export type Profile = {
  id: string;
  username?: string | null;
  avatar_key?: string | null;
  tier: string;
  xp: number;
  scan_credits: number;
  insight_credits: number;
  like_count?: number;
  lifetime_scans?: number;
  lifetime_insights?: number;
};

export async function getProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, avatar_key, tier, xp, scan_credits, insight_credits, like_count, lifetime_scans, lifetime_insights')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return data as Profile | null;
}

export async function updateProfile(
  userId: string,
  updates: Partial<Pick<Profile, 'username' | 'avatar_key'>>,
): Promise<{ error?: string }> {
  const { error } = await supabase.from('profiles').update(updates).eq('id', userId);
  if (error) {
    if (error.code === '23505') return { error: 'That username is already taken.' };
    return { error: error.message };
  }
  return {};
}

// ── Public decks (home feed + community search) ─────────────────────────────

export type PublicDeck = {
  id: string;
  name: string;
  format: string;
  card_count: number | null;
  like_count: number | null;
  bracket?: number | null;
  commander_name?: string | null;
  commander_image_url?: string | null;
  profiles?: { username?: string | null } | null;
};

export async function getTopDecks(limit = 10): Promise<PublicDeck[]> {
  const { data, error } = await supabase
    .from('decks')
    .select('id, name, format, card_count, like_count, bracket, commander_name, commander_image_url, profiles(username)')
    .eq('is_public', true)
    .order('like_count', { ascending: false })
    .limit(limit);
  if (error) return [];
  return (data as PublicDeck[]) || [];
}

export async function searchPublicDecks(query: string, format?: string): Promise<PublicDeck[]> {
  let q = supabase
    .from('decks')
    .select('id, name, format, card_count, like_count, bracket, commander_name, commander_image_url, profiles(username)')
    .eq('is_public', true)
    .order('like_count', { ascending: false })
    .limit(50);
  if (query.trim()) q = q.ilike('name', `%${query.trim()}%`);
  if (format) q = q.eq('format', format);
  const { data } = await q;
  return (data as PublicDeck[]) || [];
}

export async function getLibraryStats(userId: string): Promise<{ totalCards: number; totalValue: number }> {
  const { data } = await supabase
    .from('user_cards')
    .select('quantity, foil_quantity, scryfall_id')
    .eq('user_id', userId);
  const cards = data || [];
  const totalCards = cards.reduce((s: number, c: any) => s + (c.quantity || 0) + (c.foil_quantity || 0), 0);

  if (!cards.length) return { totalCards: 0, totalValue: 0 };
  const ids = cards.map((c: any) => c.scryfall_id);
  const { data: cache } = await supabase
    .from('card_cache')
    .select('scryfall_id, price_eur')
    .in('scryfall_id', ids);
  const priceMap = Object.fromEntries((cache || []).map((c: any) => [c.scryfall_id, c.price_eur || 0]));
  const totalValue = cards.reduce((s: number, c: any) => {
    const p = priceMap[c.scryfall_id] || 0;
    return s + p * ((c.quantity || 0) + (c.foil_quantity || 0));
  }, 0);
  return { totalCards, totalValue };
}
