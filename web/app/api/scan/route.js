import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getAuthedSupabase } from '@/lib/supabase/authForRoute';
import { fetchCardByName, fetchCardBySetAndNumber, fetchCardByNameAndSet } from '@/lib/scryfall';
import { recordEvent } from '@/lib/gamification';
import Anthropic from '@anthropic-ai/sdk';

// "Smart Scan" — Claude Haiku vision fallback. Used when local dHash matching
// isn't confident. Costs ~£0.0025 per call (Haiku vision).
//
// Rate limits (daily, enforced via check_and_increment_smart_scan Postgres fn):
//   Free tier:  10 AI scans / day
//   Pro tier:   unlimited
//
// Auth: accepts cookie sessions (web PWA) and Bearer JWTs (React Native mobile).

const DAILY_LIMIT_FREE = 10;
const DAILY_LIMIT_PRO  = 99999; // effectively unlimited

export async function POST(request) {
  try {
    // Auth + form parse in parallel.
    const [{ supabase: authedSupa, user }, formData] = await Promise.all([
      getAuthedSupabase(request),
      request.formData(),
    ]);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const imageFile = formData.get('image');
    if (!imageFile) {
      return NextResponse.json({ error: 'No image provided' }, { status: 400 });
    }

    const arrayBuffer = await imageFile.arrayBuffer();
    const serviceClient = createServiceClient();

    // Check + consume one Smart Scan credit
    const { data: profileRow } = await serviceClient
      .from('profiles')
      .select('tier')
      .eq('id', user.id)
      .single();
    const isPro = profileRow?.tier === 'pro';
    const dailyLimit = isPro ? DAILY_LIMIT_PRO : DAILY_LIMIT_FREE;

    const { data: limitData } = await serviceClient.rpc('check_and_increment_smart_scan', {
      p_user_id: user.id,
      p_daily_limit: dailyLimit,
    });
    if (limitData && !limitData.allowed) {
      return NextResponse.json(
        { error: `Smart Scan limit reached (${limitData.used}/${dailyLimit} today). Upgrade to Pro for unlimited AI scans.` },
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

    // Claude vision reads the card's identifying marks. We ask for the title
    // (most reliable) plus the set code + collector number printed on the
    // bottom info line — together those pin down the exact printing the user is
    // holding (full-art, set, basic lands, etc.), not just a default printing.
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 150,
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
              text:
                'Identify this Magic: The Gathering card from the photo. Reply with ONLY a JSON object (no markdown fences, no commentary) of this exact shape:\n' +
                '{"name": string|null, "set_code": string|null, "collector_number": string|null}\n\n' +
                '- name: the exact card name printed at the top. For basic lands use just "Forest", "Island", "Swamp", "Mountain", or "Plains".\n' +
                '- set_code: the 3–5 letter set code on the bottom info line (the small code beside the collector number and rarity letter). Use null if unreadable.\n' +
                '- collector_number: the collector number, usually bottom-left (e.g. "234", or the number before the slash in "234/281"). Return only the number. Use null if unreadable.\n\n' +
                'If you cannot identify the card at all, return {"name": null, "set_code": null, "collector_number": null}.',
            },
          ],
        },
      ],
    });

    // Parse the structured response, tolerating stray prose or code fences.
    const raw = (message.content[0]?.text || '').trim();
    let detected = { name: null, set_code: null, collector_number: null };
    try {
      const jsonText = raw.replace(/```json|```/gi, '').trim();
      const match = jsonText.match(/\{[\s\S]*\}/);
      detected = JSON.parse(match ? match[0] : jsonText);
    } catch {
      // Fall back to treating the whole reply as a bare card name.
      if (raw && raw.toUpperCase() !== 'UNKNOWN') detected.name = raw;
    }

    const cardName = (detected.name || '').trim();
    const setCode = detected.set_code ? String(detected.set_code).trim() : null;
    const collectorNumber = detected.collector_number ? String(detected.collector_number).trim() : null;

    if (!cardName || cardName.toUpperCase() === 'UNKNOWN') {
      return NextResponse.json(
        { error: 'Card not recognized — try better lighting or hold the card steady' },
        { status: 404 }
      );
    }

    // Resolve the most specific printing we can, with safe fallbacks. We
    // validate that an exact set/number hit actually matches the detected name,
    // so a misread code can't silently return the wrong card.
    const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const nameMatches = (a, b) => {
      const na = norm(a), nb = norm(b);
      if (!na || !nb) return false;
      return na === nb || na.startsWith(nb) || nb.startsWith(na) || na.includes(nb) || nb.includes(na);
    };

    let card = null;
    if (setCode && collectorNumber) {
      const exact = await fetchCardBySetAndNumber(setCode, collectorNumber);
      if (exact && nameMatches(exact.card_name, cardName)) card = exact;
    }
    if (!card && setCode) {
      card = await fetchCardByNameAndSet(cardName, setCode);
    }
    if (!card) {
      card = await fetchCardByName(cardName);
    }

    if (!card) {
      return NextResponse.json(
        { error: `"${cardName}" not found — try scanning again` },
        { status: 404 }
      );
    }

    // Cache the resolved printing + record the scan event for XP/achievements.
    // No quota consumption — scanning is free and unlimited.
    await serviceClient.from('card_cache').upsert(card, { onConflict: 'scryfall_id' });
    const rewards = await recordEvent(serviceClient, user.id, 'scan');

    return NextResponse.json({
      engine: 'smart',
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
    console.error('Scan error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
