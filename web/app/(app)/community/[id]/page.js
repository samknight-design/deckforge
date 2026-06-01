import { createClient, createServiceClient } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';
import PublicDeckView from '@/components/PublicDeckView';

export const dynamic = 'force-dynamic';

export default async function PublicDeckPage({ params }) {
  const svc = createServiceClient();

  // Only public decks are viewable here.
  const { data: deck } = await svc
    .from('decks')
    .select('*')
    .eq('id', params.id)
    .eq('is_public', true)
    .maybeSingle();
  if (!deck) notFound();

  const { data: deckCards } = await svc
    .from('deck_cards')
    .select('id, scryfall_id, card_name, quantity, is_commander, is_partner, is_foil')
    .eq('deck_id', params.id)
    .order('card_name');

  const ids = (deckCards || []).map((c) => c.scryfall_id).filter(Boolean);
  const { data: cache } = ids.length
    ? await svc.from('card_cache').select('*').in('scryfall_id', ids)
    : { data: [] };
  const cacheMap = Object.fromEntries((cache || []).map((c) => [c.scryfall_id, c]));

  const cards = (deckCards || []).map((dc) => ({
    ...dc,
    ...(cacheMap[dc.scryfall_id] || {}),
    card_name: dc.card_name || cacheMap[dc.scryfall_id]?.card_name || '',
  }));

  // Deck author (for the "by @username" link)
  const { data: author } = await svc
    .from('profiles')
    .select('username, avatar_key')
    .eq('id', deck.user_id)
    .maybeSingle();

  // Current viewer: liked state + ownership
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  let liked = false;
  let isOwner = false;
  if (user) {
    isOwner = deck.user_id === user.id;
    const { data: likeRow } = await svc
      .from('deck_likes')
      .select('id')
      .eq('deck_id', params.id)
      .eq('user_id', user.id)
      .maybeSingle();
    liked = !!likeRow;
  }

  return (
    <PublicDeckView
      deck={deck}
      cards={cards}
      liked={liked}
      likeCount={deck.like_count || 0}
      isOwner={isOwner}
      signedIn={!!user}
      author={author || null}
    />
  );
}
