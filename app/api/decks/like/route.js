import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { recordEvent } from '@/lib/gamification';

// Toggle the current user's like on a PUBLIC deck and return the fresh count.
export async function POST(request) {
  try {
    const supabase = createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { deckId } = await request.json();
    if (!deckId) {
      return NextResponse.json({ error: 'deckId required' }, { status: 400 });
    }

    const svc = createServiceClient();

    // Only public decks can be liked.
    const { data: deck } = await svc
      .from('decks')
      .select('id, is_public, user_id')
      .eq('id', deckId)
      .maybeSingle();
    if (!deck || !deck.is_public) {
      return NextResponse.json({ error: 'Deck not found' }, { status: 404 });
    }

    const { data: existing } = await svc
      .from('deck_likes')
      .select('id')
      .eq('deck_id', deckId)
      .eq('user_id', user.id)
      .maybeSingle();

    let liked;
    if (existing) {
      await svc.from('deck_likes').delete().eq('id', existing.id);
      liked = false;
    } else {
      await svc.from('deck_likes').insert({ deck_id: deckId, user_id: user.id });
      liked = true;
    }

    // Recompute + persist the denormalised count.
    const { count } = await svc
      .from('deck_likes')
      .select('id', { count: 'exact', head: true })
      .eq('deck_id', deckId);
    const like_count = count || 0;
    await svc.from('decks').update({ like_count }).eq('id', deckId);

    // XP only on liking (not unliking), and never for liking your own deck.
    let rewards = null;
    if (liked && deck.user_id !== user.id) {
      rewards = await recordEvent(svc, user.id, 'like_given');
      await recordEvent(svc, deck.user_id, 'like_received');
    }

    return NextResponse.json({ liked, like_count, rewards });
  } catch (err) {
    console.error('Like error:', err);
    return NextResponse.json({ error: 'Failed to update like' }, { status: 500 });
  }
}
