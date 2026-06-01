import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { recordEvent } from '@/lib/gamification';

// Clone a PUBLIC deck into the current user's account (a fresh, private,
// editable copy). Respects the free-tier 1-deck cap.
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

    const { data: src } = await svc
      .from('decks')
      .select('*')
      .eq('id', deckId)
      .eq('is_public', true)
      .maybeSingle();
    if (!src) {
      return NextResponse.json({ error: 'Deck not found' }, { status: 404 });
    }

    // Free-tier deck cap (mirror of DeckListPage canCreateDeck)
    const { data: profile } = await supabase.from('profiles').select('tier').eq('id', user.id).single();
    const tier = profile?.tier || 'free';
    if (tier !== 'pro') {
      const { count } = await svc
        .from('decks')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id);
      if ((count || 0) >= 1) {
        return NextResponse.json(
          { error: 'Free plan is limited to 1 deck. Upgrade to Pro to clone more decks.' },
          { status: 403 }
        );
      }
    }

    // New deck starts private with no bracket — the cloner runs their own insights.
    const { data: newDeck, error: deckErr } = await svc
      .from('decks')
      .insert({
        user_id: user.id,
        name: `${src.name} (copy)`,
        format: src.format,
        commander_scryfall_id: src.commander_scryfall_id,
        commander_name: src.commander_name,
        commander_image_url: src.commander_image_url,
        partner_scryfall_id: src.partner_scryfall_id,
        partner_name: src.partner_name,
        partner_image_url: src.partner_image_url,
        card_count: src.card_count,
        estimated_value_eur: src.estimated_value_eur,
        is_public: false,
        bracket: null,
      })
      .select()
      .single();
    if (deckErr || !newDeck) {
      return NextResponse.json({ error: 'Failed to create deck' }, { status: 500 });
    }

    const { data: srcCards } = await svc
      .from('deck_cards')
      .select('scryfall_id, card_name, quantity, is_commander, is_partner, is_foil')
      .eq('deck_id', deckId);

    if (srcCards && srcCards.length) {
      const rows = srcCards.map((c) => ({ ...c, deck_id: newDeck.id }));
      await svc.from('deck_cards').insert(rows);
    }

    // Reward the original author when someone else clones their deck.
    if (src.user_id && src.user_id !== user.id) {
      await recordEvent(svc, src.user_id, 'clone_received');
    }

    return NextResponse.json({ deckId: newDeck.id });
  } catch (err) {
    console.error('Clone error:', err);
    return NextResponse.json({ error: 'Failed to clone deck' }, { status: 500 });
  }
}
