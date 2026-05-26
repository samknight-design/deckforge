import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { checkInsightLimit, incrementInsightCount } from '@/lib/usage';
import { computeDeckHash } from '@/lib/deckUtils';
import Anthropic from '@anthropic-ai/sdk';

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

    // Get profile for tier check
    const { data: profile } = await supabase
      .from('profiles')
      .select('tier')
      .eq('id', user.id)
      .single();

    const limitCheck = await checkInsightLimit(supabase, user.id, profile?.tier || 'free');
    if (!limitCheck.allowed) {
      return NextResponse.json({ error: 'AI Insights require a Pro subscription.' }, { status: 403 });
    }

    // Fetch deck
    const { data: deck, error: deckError } = await supabase
      .from('decks')
      .select('*')
      .eq('id', deckId)
      .eq('user_id', user.id)
      .single();

    if (deckError || !deck) {
      return NextResponse.json({ error: 'Deck not found' }, { status: 404 });
    }

    // Fetch cards with cache data
    const { data: deckCards } = await supabase
      .from('deck_cards')
      .select(`
        *,
        card_cache (
          card_name, oracle_text, mana_cost, cmc, type_line,
          colors, color_identity, is_legendary, is_creature, is_land,
          power, toughness, legalities
        )
      `)
      .eq('deck_id', deckId);

    if (!deckCards || deckCards.length === 0) {
      return NextResponse.json({ error: 'Deck has no cards' }, { status: 400 });
    }

    // Compute hash
    const cardList = deckCards.map((c) => ({
      card_name: c.card_cache?.card_name || c.card_name,
      quantity: c.quantity,
    }));
    const deckHash = computeDeckHash(cardList);

    // Check cached insight (same hash, < 7 days)
    if (deck.insight_deck_hash === deckHash && deck.last_insight_at) {
      const lastAt = new Date(deck.last_insight_at);
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      if (lastAt > sevenDaysAgo) {
        // Return cached insight
        const serviceClient = createServiceClient();
        const { data: cachedInsight } = await serviceClient
          .from('insights')
          .select('*')
          .eq('deck_id', deckId)
          .eq('deck_hash', deckHash)
          .order('generated_at', { ascending: false })
          .limit(1)
          .single();

        if (cachedInsight) {
          return NextResponse.json({
            content: cachedInsight.content,
            bracket_estimate: cachedInsight.bracket_estimate,
            generated_at: cachedInsight.generated_at,
            cached: true,
          });
        }
      }
    }

    // Build card list for prompt
    const colorIdentity = deck.commander_name
      ? deckCards
          .filter((c) => c.is_commander)
          .flatMap((c) => c.card_cache?.color_identity || [])
          .filter((v, i, a) => a.indexOf(v) === i)
      : [];

    const cardListText = deckCards
      .map((c) => {
        const name = c.card_cache?.card_name || c.card_name;
        const type = c.card_cache?.type_line || '';
        const cmc = c.card_cache?.cmc ?? '';
        return `${c.quantity}x ${name} (${type}, CMC ${cmc})`;
      })
      .join('\n');

    const systemPrompt = `You are an expert Magic: The Gathering deck analyst. Analyse the provided deck and give structured, actionable feedback. Be specific about card names. Format your response exactly as instructed.`;

    const userPrompt = `Analyse this ${deck.format === 'commander' ? 'Commander (EDH)' : '60-card'} deck${deck.commander_name ? ` led by ${deck.commander_name}${deck.partner_name ? ` and ${deck.partner_name}` : ''}` : ''}${colorIdentity.length > 0 ? ` (Color Identity: ${colorIdentity.join('')})` : ''}:

DECK LIST:
${cardListText}

Format your response EXACTLY as follows:

## Bracket [N] — [Name]
[1-2 sentence bracket description. Bracket 1 = casual/jank, 2 = focused casual, 3 = optimised, 4 = high power, 5 = cEDH/competitive]

### 💪 Key Strengths
- **Strength name**: explanation with specific cards mentioned

### ⚠️ Weaknesses & Risks
- **Weakness**: explanation with specific cards mentioned

### 🔧 Suggested Improvements
- **Card to add**: why it helps + what to cut

### 🎯 How to Play This Deck
[2-3 sentences on the core strategy and win conditions]

### ⚡ Power Level: [N]/10
[brief justification of the power level score]`;

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 1500,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const content = message.content[0].text;

    // Parse bracket estimate
    const bracketMatch = content.match(/##\s*Bracket\s*\[?(\d)\]?/i);
    const bracketEstimate = bracketMatch ? parseInt(bracketMatch[1], 10) : 3;

    // Save insight
    const serviceClient = createServiceClient();
    const { data: savedInsight } = await serviceClient
      .from('insights')
      .insert({
        deck_id: deckId,
        user_id: user.id,
        content,
        bracket_estimate: bracketEstimate,
        deck_hash: deckHash,
        model_used: 'claude-sonnet-4-5',
        generated_at: new Date().toISOString(),
      })
      .select()
      .single();

    // Update deck with hash + timestamp
    await serviceClient
      .from('decks')
      .update({
        insight_deck_hash: deckHash,
        last_insight_at: new Date().toISOString(),
      })
      .eq('id', deckId);

    await incrementInsightCount(serviceClient, user.id);

    return NextResponse.json({
      content,
      bracket_estimate: bracketEstimate,
      generated_at: savedInsight?.generated_at || new Date().toISOString(),
      cached: false,
    });
  } catch (err) {
    console.error('Insights error:', err);
    return NextResponse.json({ error: 'Failed to generate insights' }, { status: 500 });
  }
}
