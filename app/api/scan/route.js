import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { fetchCardByName } from '@/lib/scryfall';
import { checkScanLimit, incrementScanCount } from '@/lib/usage';
import { GoogleGenAI } from '@google/genai';

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

    // Call Gemini 2.0 Flash
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    const prompt =
      "You are identifying Magic: The Gathering cards. Look at this image and identify the card name exactly as printed on the card. Reply with ONLY the card name, nothing else. If you cannot identify a card, reply with 'UNKNOWN'.";

    const result = await ai.models.generateContent({
      model: 'gemini-1.5-flash',
      contents: [
        {
          parts: [
            { text: prompt },
            { inlineData: { mimeType, data: base64 } },
          ],
        },
      ],
    });

    const cardName = result.text.trim();

    if (!cardName || cardName === 'UNKNOWN' || cardName.toLowerCase() === 'unknown') {
      return NextResponse.json({ error: 'Card not recognized' }, { status: 404 });
    }

    // Check card cache first
    const { data: cached } = await serviceClient
      .from('card_cache')
      .select('*')
      .eq('card_name', cardName)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();

    let card = cached;

    if (!card) {
      // Fetch from Scryfall
      const scryfallCard = await fetchCardByName(cardName);
      if (!scryfallCard) {
        return NextResponse.json({ error: 'Card not found in database' }, { status: 404 });
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
