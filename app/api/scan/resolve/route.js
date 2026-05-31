import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { fetchCardById } from '@/lib/scryfall';
import { recordEvent } from '@/lib/gamification';

// Resolve a visual-match hit. The client has identified a card by its Scryfall
// `id` via on-device hash matching; this route fetches the canonical printing,
// caches it, and records the scan event for XP/achievements.
//
// No Claude call, no scan quota — scanning is free and unlimited on this path.
// The legacy /api/scan (Claude vision) remains as the Smart Scan fallback for
// when visual matching isn't confident.

export async function POST(request) {
  try {
    const supabase = createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const scryfallId = (body?.scryfall_id || '').trim();
    if (!scryfallId) {
      return NextResponse.json({ error: 'scryfall_id required' }, { status: 400 });
    }

    const serviceClient = createServiceClient();
    const card = await fetchCardById(scryfallId);
    if (!card) {
      return NextResponse.json({ error: `Card not found for id ${scryfallId}` }, { status: 404 });
    }

    // Cache the resolved printing + record the scan event (XP, achievements).
    await Promise.all([
      serviceClient.from('card_cache').upsert(card, { onConflict: 'scryfall_id' }),
    ]);
    const rewards = await recordEvent(serviceClient, user.id, 'scan');

    return NextResponse.json({
      engine: 'visual',
      card: {
        scryfall_id: card.scryfall_id,
        card_name: card.card_name,
        image_uri: card.image_uri,
        type_line: card.type_line,
        mana_cost: card.mana_cost,
        cmc: card.cmc,
        colors: card.colors,
        color_identity: card.color_identity,
        price_eur: card.price_eur,
        price_usd: card.price_usd,
        price_eur_foil: card.price_eur_foil,
        price_usd_foil: card.price_usd_foil,
        is_legendary: card.is_legendary,
        oracle_text: card.oracle_text,
        set_code: card.set_code,
        set_name: card.set_name,
      },
      rewards,
    });
  } catch (err) {
    console.error('Scan resolve error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
