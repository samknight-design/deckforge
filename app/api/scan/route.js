import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { fetchCardByName } from '@/lib/scryfall';
import { checkScanLimit, incrementScanCount } from '@/lib/usage';
import Anthropic from '@anthropic-ai/sdk';

export async function POST(request) {
  try {
    const supabase = createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get user profile for tier
    const { data: profile } = await supabase
      .from('profiles')
      .select('tier')
      .eq('id', user.id)
      .single();

    const tier = profile?.tier || 'free';

    // Check scan limit
    const serviceClient = createServiceClient();
    const limitCheck = await checkScanLimit(serviceClient, user.id, tier);
    if (!limitCheck.allowed) {
      return NextResponse.json(
        { error: 'Monthly scan limit reached. Upgrade to Pro for unlimited scans.' },
        { status: 429 }
      );
    }

    const formData = await request.formData();
    const imageFile = formData.get('image');

    if (!imageFile) {
      return NextResponse.json({ error: 'No image provided' }, { status: 400 });
    }

    // Convert image to base64
    const arrayBuffer = await imageFile.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');
    const mimeType = imageFile.type || 'image/jpeg';

    // Use Claude vision to identify the card (no Google billing required)
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
              source: {
                type: 'base64',
                media_type: mimeType,
                data: base64,
              },
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
      return NextResponse.json({ error: 'Card not recognized — try better lighting or hold the card steady' }, { status: 404 });
    }

    // Check card cache first (case-insensitive match)
    const { data: cached } = await serviceClient
      .from('card_cache')
      .select('*')
      .ilike('card_name', cardName)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();

    let card = cached;

    if (!card) {
      // Fetch from Scryfall
      const scryfallCard = await fetchCardByName(cardName);
      if (!scryfallCard) {
        return NextResponse.json({ error: `"${cardName}" not found — try scanning again` }, { status: 404 });
      }

      // Cache to database
      await serviceClient.from('card_cache').upsert(scryfallCard, {
        onConflict: 'scryfall_id',
      });

      card = scryfallCard;
    }

    // Increment usage
    await incrementScanCount(serviceClient, user.id);

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
