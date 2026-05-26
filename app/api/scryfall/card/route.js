import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { fetchCardByName, fetchCardById } from '@/lib/scryfall';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const name = searchParams.get('name');
  const id = searchParams.get('id');

  if (!name && !id) {
    return NextResponse.json({ error: 'name or id required' }, { status: 400 });
  }

  try {
    const serviceClient = createServiceClient();

    // Check cache first
    let cached = null;
    if (id) {
      const { data } = await serviceClient
        .from('card_cache')
        .select('*')
        .eq('scryfall_id', id)
        .gt('expires_at', new Date().toISOString())
        .maybeSingle();
      cached = data;
    } else if (name) {
      const { data } = await serviceClient
        .from('card_cache')
        .select('*')
        .ilike('card_name', name)
        .gt('expires_at', new Date().toISOString())
        .maybeSingle();
      cached = data;
    }

    if (cached) {
      return NextResponse.json(cached);
    }

    // Fetch from Scryfall
    const card = id ? await fetchCardById(id) : await fetchCardByName(name);

    if (!card) {
      return NextResponse.json({ error: 'Card not found' }, { status: 404 });
    }

    // Cache it
    await serviceClient.from('card_cache').upsert(card, { onConflict: 'scryfall_id' });

    return NextResponse.json(card);
  } catch (err) {
    console.error('Card fetch error:', err);
    return NextResponse.json({ error: 'Failed to fetch card' }, { status: 500 });
  }
}
