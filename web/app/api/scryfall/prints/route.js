import { NextResponse } from 'next/server';
import { fetchPrints } from '@/lib/scryfall';

export const runtime = 'edge';

// Returns all printings of a card by exact name. Used by the "Change variant"
// sheet so the user can swap a scanned/added card to the specific printing
// they own (foil, full-art, set, etc).
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const name = searchParams.get('name') || '';
  if (!name.trim()) return NextResponse.json([]);
  try {
    const prints = await fetchPrints(name);
    return NextResponse.json(prints);
  } catch (err) {
    console.error('Prints fetch error:', err);
    return NextResponse.json([]);
  }
}
