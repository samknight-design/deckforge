import { NextResponse } from 'next/server';
import { autocompleteCardName } from '@/lib/scryfall';

export const runtime = 'edge';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q') || '';

  if (!query || query.length < 2) {
    return NextResponse.json([]);
  }

  try {
    const names = await autocompleteCardName(query);
    return NextResponse.json(names);
  } catch (err) {
    console.error('Autocomplete error:', err);
    return NextResponse.json([]);
  }
}
