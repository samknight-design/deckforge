import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { checkInsightLimit, incrementInsightCount } from '@/lib/usage';
import { computeDeckHash } from '@/lib/deckUtils';
import { normaliseBracket } from '@/lib/brackets';
import Anthropic from '@anthropic-ai/sdk';

export async function POST(request) {
  try {
    const supabase = createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { deckId, force } = await request.json();
    if (!deckId) {
      return NextResponse.json({ error: 'deckId required' }, { status: 400 });
    }

    // Fetch profile, deck, and deck_cards all at once
    const [profileResult, deckResult, deckCardsResult] = await Promise.all([
      supabase.from('profiles').select('tier').eq('id', user.id).single(),
      supabase.from('decks').select('*').eq('id', deckId).eq('user_id', user.id).single(),
      supabase.from('deck_cards')
        .select('id, scryfall_id, card_name, quantity, is_commander, is_partner')
        .eq('deck_id', deckId),
    ]);

    const limitCheck = await checkInsightLimit(supabase, user.id, profileResult.data?.tier || 'free');
    if (!limitCheck.allowed) {
      return NextResponse.json({ error: 'AI Insights require a Pro subscription.' }, { status: 403 });
    }

    const deck = deckResult.data;
    const deckError = deckResult.error;

    if (deckError || !deck) {
      return NextResponse.json({ error: 'Deck not found' }, { status: 404 });
    }

    const deckCards = deckCardsResult.data;

    if (!deckCards || deckCards.length === 0) {
      return NextResponse.json({ error: 'Deck has no cards' }, { status: 400 });
    }

    // Separately fetch card_cache for all scryfall_ids
    const scryfallIds = deckCards.map((dc) => dc.scryfall_id).filter(Boolean);
    let cacheMap = {};
    if (scryfallIds.length > 0) {
      const serviceClient = createServiceClient();
      const { data: cached } = await serviceClient
        .from('card_cache')
        .select('scryfall_id, card_name, oracle_text, mana_cost, cmc, type_line, colors, color_identity, is_legendary, is_creature, is_land, power, toughness, legalities')
        .in('scryfall_id', scryfallIds);
      cacheMap = Object.fromEntries((cached || []).map((c) => [c.scryfall_id, c]));
    }

    // Merge card data
    const mergedCards = deckCards.map((dc) => ({
      ...dc,
      card_cache: cacheMap[dc.scryfall_id] || null,
    }));

    // Compute hash
    const cardList = mergedCards.map((c) => ({
      card_name: c.card_cache?.card_name || c.card_name,
      quantity: c.quantity,
    }));
    const deckHash = computeDeckHash(cardList);

    // Check cached insight (same hash, < 7 days) — skipped when force-regenerating
    if (!force && deck.insight_deck_hash === deckHash && deck.last_insight_at) {
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
            data: cachedInsight.data || null,
            bracket_estimate: cachedInsight.bracket_estimate,
            generated_at: cachedInsight.generated_at,
            cached: true,
          });
        }
      }
    }

    // Build card list for prompt
    const colorIdentity = deck.commander_name
      ? mergedCards
          .filter((c) => c.is_commander)
          .flatMap((c) => c.card_cache?.color_identity || [])
          .filter((v, i, a) => a.indexOf(v) === i)
      : [];

    const cardListText = mergedCards
      .map((c) => {
        const name = c.card_cache?.card_name || c.card_name;
        const type = c.card_cache?.type_line || '';
        const cmc = c.card_cache?.cmc ?? '';
        return `${c.quantity}x ${name} (${type}, CMC ${cmc})`;
      })
      .join('\n');

    const systemPrompt = `You are an expert Magic: The Gathering deck analyst. Analyse the provided deck and return ONLY a JSON object with structured, actionable feedback. Be specific and use exact, real card names.`;

    const userPrompt = `Analyse this ${deck.format === 'commander' ? 'Commander (EDH)' : '60-card'} deck${deck.commander_name ? ` led by ${deck.commander_name}${deck.partner_name ? ` and ${deck.partner_name}` : ''}` : ''}${colorIdentity.length > 0 ? ` (Color Identity: ${colorIdentity.join('')})` : ''}:

DECK LIST:
${cardListText}

Reply with ONLY a JSON object (no markdown fences, no commentary) of this exact shape:
{
  "bracket": <integer 1-5>,
  "bracket_name": "<one of: Casual, Focused Casual, Optimised, High Power, cEDH>",
  "power_level": <integer 1-10>,
  "summary": "<2-3 sentence overview of the deck>",
  "strategy": "<2-3 sentences on the core gameplan and win conditions>",
  "strengths": [{"title": "<short label>", "detail": "<explanation naming specific cards>"}],
  "weaknesses": [{"title": "<short label>", "detail": "<explanation naming specific cards>"}],
  "cards_to_add": [{"name": "<exact card name>", "reason": "<why it helps>"}],
  "cards_to_remove": [{"name": "<exact card name already in this deck>", "reason": "<why to cut it>"}]
}

Provide 3-5 items each in strengths, weaknesses, cards_to_add and cards_to_remove. Bracket scale: 1 = casual/jank, 2 = focused casual, 3 = optimised, 4 = high power, 5 = cEDH/competitive. cards_to_remove must only name cards present in the deck list above.`;

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 2000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const raw = (message.content[0]?.text || '').trim();

    // Parse the structured response, tolerating stray prose or code fences.
    let data = null;
    try {
      const jsonText = raw.replace(/```json|```/gi, '').trim();
      const match = jsonText.match(/\{[\s\S]*\}/);
      data = JSON.parse(match ? match[0] : jsonText);
    } catch {
      data = null;
    }

    // Bracket: prefer the structured value, fall back to a loose text scan.
    const bracketEstimate =
      normaliseBracket(data?.bracket) ??
      (raw.match(/bracket\D*(\d)/i) ? parseInt(raw.match(/bracket\D*(\d)/i)[1], 10) : 3);

    // `content` keeps a human-readable fallback (used if `data` is ever absent).
    const content = data?.summary || raw;

    // Replace any prior insights for this deck so regenerating overwrites
    // rather than stacking up old analyses.
    const serviceClient = createServiceClient();
    await serviceClient.from('insights').delete().eq('deck_id', deckId);

    const { data: savedInsight } = await serviceClient
      .from('insights')
      .insert({
        deck_id: deckId,
        user_id: user.id,
        content,
        data,
        bracket_estimate: bracketEstimate,
        deck_hash: deckHash,
        model_used: 'claude-sonnet-4-5',
        generated_at: new Date().toISOString(),
      })
      .select()
      .single();

    // Update deck with hash + timestamp + the stamped bracket tier
    await serviceClient
      .from('decks')
      .update({
        insight_deck_hash: deckHash,
        last_insight_at: new Date().toISOString(),
        bracket: bracketEstimate,
      })
      .eq('id', deckId);

    await incrementInsightCount(serviceClient, user.id);

    return NextResponse.json({
      content,
      data,
      bracket_estimate: bracketEstimate,
      generated_at: savedInsight?.generated_at || new Date().toISOString(),
      cached: false,
    });
  } catch (err) {
    console.error('Insights error:', err);
    return NextResponse.json({ error: 'Failed to generate insights' }, { status: 500 });
  }
}
