import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { fetchCardByName } from '@/lib/scryfall';
import { checkScanLimit, incrementScanCount } from '@/lib/usage';
import Anthropic from '@anthropic-ai/sdk';

export async function POST(request) {
  try {
    const supabase = createClient();

    // Round 1: auth check + form parse in parallel
    const [authResult, formData] = await Promise.all([
      supabase.auth.getUser(),
      request.formData(),
    ]);

    const { data: { user }, error: authError } = authResult;
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const imageFile = formData.get('image');
    if (!imageFile) {
      return NextResponse.json({ error: 'No image provided' }, { status: 400 });
    }

    // Round 2: profile + image buffer in parallel
    const [profileResult, arrayBuffer] = await Promise.all([
      supabase.from('profiles').select('tier').eq('id', user.id).single(),
      imageFile.arrayBuffer(),
    ]);

    const tier = profileResult.data?.tier || 'free';

    // Check scan limit
    const serviceClient = createServiceClient();
    const limitCheck = await checkScanLimit(serviceClient, user.id, tier);
    if (!limitCheck.allowed) {
      return NextResponse.json(
        { error: 'Monthly scan limit reached. Upgrade to Pro for unlimited scans.' },
        { status: 429 }
      );
    }

    // Convert image to base64 (Web API — works everywhere)
    const uint8Array = new Uint8Array(arrayBuffer);
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < uint8Array.length; i += chunkSize) {
      binary += String.fromCharCode(...uint8Array.subarray(i, i + chunkSize));
    }
    const base64 = btoa(binary);
    const mimeType = imageFile.type || 'image/jpeg';

    // Claude vision identifies the card
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 60,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mimeType, data: base64 },
            },
            {
              type: 'text',
              text: 'This is a Magic: The Gathering card. What is the exact card name printed at the top of the card? Reply with ONLY the card name — no punctuation, no explanations. If you cannot clearly see a card name, reply with UNKNOWN.',
            },
          ],
        },
      ],
    });

    const cardName = message.content[0].text.trim();

    if (!cardName || cardName.toUpperCase() === 'UNKNOWN') {
      return NextResponse.json(
        { error: 'Card not recognized — try better lighting or hold the card steady' },
        { status: 404 }
      );
    }

    // Round 3: cache lookup + usage increment can happen together after Anthropic responds
    const [cachedResult] = await Promise.all([
      serviceClient
        .from('card_cache')
        .select('*')
        .ilike('card_name', cardName)
        .gt('expires_at', new Date().toISOString())
        .maybeSingle(),
    ]);

    let card = cachedResult.data;

    if (!card) {
      const scryfallCard = await fetchCardByName(cardName);
      if (!scryfallCard) {
        return NextResponse.json(
          { error: `"${cardName}" not found — try scanning again` },
          { status: 404 }
        );
      }
      // Cache write + usage increment in parallel
      await Promise.all([
        serviceClient.from('card_cache').upsert(scryfallCard, { onConflict: 'scryfall_id' }),
        incrementScanCount(serviceClient, user.id),
      ]);
      card = scryfallCard;
    } else {
      await incrementScanCount(serviceClient, user.id);
    }

    return NextResponse.json({
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
        is_legendary: card.is_legendary,
        oracle_text: card.oracle_text,
        set_name: card.set_name,
      },
    });
  } catch (err) {
    console.error('Scan error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
