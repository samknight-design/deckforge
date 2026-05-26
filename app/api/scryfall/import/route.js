import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { fetchCardCollection } from '@/lib/scryfall';

export async function POST(request) {
  try {
    const supabase = createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { cards, deckId } = await request.json();

    if (!deckId || !cards || !Array.isArray(cards)) {
      return NextResponse.json({ error: 'deckId and cards required' }, { status: 400 });
    }

    // Verify deck ownership
    const { data: deck } = await supabase
      .from('decks')
      .select('id')
      .eq('id', deckId)
      .eq('user_id', user.id)
      .single();

    if (!deck) {
      return NextResponse.json({ error: 'Deck not found' }, { status: 404 });
    }

    // Fetch all cards from Scryfall
    const identifiers = cards.map((c) => ({ name: c.name }));
    const resolved = await fetchCardCollection(identifiers);

    if (!resolved || resolved.length === 0) {
      return NextResponse.json({ error: 'No cards could be resolved from Scryfall' }, { status: 400 });
    }

    const serviceClient = createServiceClient();

    // Cache resolved cards
    if (resolved.length > 0) {
      await serviceClient.from('card_cache').upsert(resolved, {
        onConflict: 'scryfall_id',
        ignoreDuplicates: false,
      });
    }

    // Map resolved cards back to quantities from input
    const nameToQty = {};
    for (const c of cards) {
      nameToQty[c.name.toLowerCase()] = (nameToQty[c.name.toLowerCase()] || 0) + (c.quantity || 1);
    }

    let imported = 0;
    let failed = cards.length - resolved.length;

    const inserts = [];
    for (const card of resolved) {
      const qty = nameToQty[card.card_name.toLowerCase()] || 1;
      inserts.push({
        deck_id: deckId,
        scryfall_id: card.scryfall_id,
        card_name: card.card_name,
        quantity: qty,
        is_commander: false,
        is_partner: false,
      });
      imported++;
    }

    if (inserts.length > 0) {
      // Upsert: increment quantity if already exists
      const { error: insertError } = await serviceClient.from('deck_cards').upsert(inserts, {
        onConflict: 'deck_id,scryfall_id',
        ignoreDuplicates: false,
      });

      if (insertError) {
        console.error('Import insert error:', insertError);
        return NextResponse.json({ error: 'Failed to insert cards' }, { status: 500 });
      }
    }

    return NextResponse.json({ imported, failed });
  } catch (err) {
    console.error('Import error:', err);
    return NextResponse.json({ error: 'Import failed' }, { status: 500 });
  }
}
