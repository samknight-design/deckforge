import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { recordEvent } from '@/lib/gamification';

// Set a deck's public/private state (owner only). Awards a publish event the
// first time a deck is made public this month (task/achievement handle XP;
// repeated toggles in the same period don't re-reward).
export async function POST(request) {
  try {
    const supabase = createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { deckId, isPublic } = await request.json();
    if (!deckId || typeof isPublic !== 'boolean') {
      return NextResponse.json({ error: 'deckId and isPublic required' }, { status: 400 });
    }

    const svc = createServiceClient();
    const { data: deck } = await svc
      .from('decks')
      .select('id, user_id, is_public, bracket')
      .eq('id', deckId)
      .maybeSingle();

    if (!deck || deck.user_id !== user.id) {
      return NextResponse.json({ error: 'Deck not found' }, { status: 404 });
    }
    if (isPublic && deck.bracket == null) {
      return NextResponse.json({ error: 'Run AI Insights to set a bracket before publishing.' }, { status: 400 });
    }

    await svc.from('decks').update({ is_public: isPublic }).eq('id', deckId);

    // Award only on a private → public transition.
    if (isPublic && !deck.is_public) {
      await recordEvent(svc, user.id, 'publish');
    }

    return NextResponse.json({ is_public: isPublic });
  } catch (err) {
    console.error('Visibility error:', err);
    return NextResponse.json({ error: 'Failed to update visibility' }, { status: 500 });
  }
}
