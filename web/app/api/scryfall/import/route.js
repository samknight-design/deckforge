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
      .select('id, format')
      .eq('id', deckId)
      .eq('user_id', user.id)
      .single();

    if (!deck) {
      return NextResponse.json({ error: 'Deck not found' }, { status: 404 });
    }

    // Build the most specific Scryfall identifier per card: exact printing when
    // a set + collector number was parsed (Moxfield/Archidekt), else name+set,
    // else just the name.
    const identifiers = cards.map((c) => {
      if (c.set && c.collector_number) return { set: c.set, collector_number: String(c.collector_number) };
      if (c.set) return { name: c.name, set: c.set };
      return { name: c.name };
    });
    const resolved = await fetchCardCollection(identifiers);

    if (!resolved || resolved.length === 0) {
      return NextResponse.json({ error: 'No cards could be resolved. Check the list format and try again.' }, { status: 400 });
    }

    const serviceClient = createServiceClient();

    // Cache resolved cards
    await serviceClient.from('card_cache').upsert(resolved, {
      onConflict: 'scryfall_id',
      ignoreDuplicates: false,
    });

    // Map parsed metadata (qty / foil / commander) back to resolved cards by name.
    const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const meta = {};
    for (const c of cards) {
      const k = norm(c.name);
      if (!meta[k]) meta[k] = { quantity: 0, foil: false, commander: false };
      meta[k].quantity += c.quantity || 1;
      meta[k].foil = meta[k].foil || !!c.foil;
      meta[k].commander = meta[k].commander || !!c.commander;
    }

    const isCommanderDeck = deck.format === 'commander';
    const resolvedKeys = new Set(resolved.map((r) => norm(r.card_name)));
    const failed = Object.keys(meta).filter((k) => !resolvedKeys.has(k)).length;

    const inserts = resolved.map((card) => {
      const m = meta[norm(card.card_name)] || { quantity: 1, foil: false, commander: false };
      return {
        deck_id: deckId,
        scryfall_id: card.scryfall_id,
        card_name: card.card_name,
        quantity: m.quantity || 1,
        is_commander: isCommanderDeck && m.commander,
        is_partner: false,
        is_foil: m.foil,
      };
    });

    if (inserts.length > 0) {
      const { error: insertError } = await serviceClient.from('deck_cards').upsert(inserts, {
        onConflict: 'deck_id,scryfall_id,is_foil',
        ignoreDuplicates: false,
      });

      if (insertError) {
        console.error('Import insert error:', insertError);
        return NextResponse.json({ error: 'Failed to insert cards' }, { status: 500 });
      }
    }

    // If the list flagged commander(s) for a Commander deck, set the deck's commander.
    if (isCommanderDeck) {
      const commanders = resolved.filter((r) => meta[norm(r.card_name)]?.commander);
      if (commanders.length) {
        const updates = {
          commander_scryfall_id: commanders[0].scryfall_id,
          commander_name: commanders[0].card_name,
          commander_image_url: commanders[0].image_uri || null,
        };
        if (commanders[1]) {
          updates.partner_scryfall_id = commanders[1].scryfall_id;
          updates.partner_name = commanders[1].card_name;
          updates.partner_image_url = commanders[1].image_uri || null;
        }
        await serviceClient.from('decks').update(updates).eq('id', deckId);
      }
    }

    return NextResponse.json({ imported: inserts.length, failed });
  } catch (err) {
    console.error('Import error:', err);
    return NextResponse.json({ error: 'Import failed' }, { status: 500 });
  }
}
