import { NextResponse } from 'next/server';
import { searchCards } from '@/lib/scryfall';

export const runtime = 'edge';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q') || '';

  if (!q || q.trim().length === 0) {
    return NextResponse.json([]);
  }

  try {
    const cards = await searchCards(q);
    return NextResponse.json(cards);
  } catch (err) {
    console.error('Search error:', err);
    return NextResponse.json([]);
  }
}
