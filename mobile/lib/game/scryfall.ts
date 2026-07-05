// Tiny Scryfall helpers for the game tracker. Scryfall is a public API but now
// expects an explicit Accept header. `art_crop` is the cropped artwork region
// (landscape) — ideal as a panel background, unlike the full card image which
// covers the panel in card frame/text.

const HEADERS = { Accept: 'application/json' };

export type ArtResult = { id: string; name: string; art: string };

// Search distinct artworks for a query (used by the background picker).
export async function searchArt(q: string): Promise<ArtResult[]> {
  const res = await fetch(
    `https://api.scryfall.com/cards/search?q=${encodeURIComponent(q)}&unique=art&order=released`,
    { headers: HEADERS },
  );
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`Scryfall ${res.status}`);
  const json = await res.json();
  return ((json.data as any[]) || [])
    .map((c) => ({ id: c.id, name: c.name, art: c.image_uris?.art_crop || c.card_faces?.[0]?.image_uris?.art_crop }))
    .filter((x) => x.art)
    .slice(0, 24);
}

// The art_crop for a named card (used to turn a deck's commander into a clean
// background). Tries exact, then fuzzy. Returns null on any miss.
export async function artCropForCard(name: string): Promise<string | null> {
  const get = async (param: 'exact' | 'fuzzy') => {
    const res = await fetch(`https://api.scryfall.com/cards/named?${param}=${encodeURIComponent(name)}`, { headers: HEADERS });
    if (!res.ok) return null;
    const j = await res.json();
    return j.image_uris?.art_crop ?? j.card_faces?.[0]?.image_uris?.art_crop ?? null;
  };
  try {
    return (await get('exact')) ?? (await get('fuzzy'));
  } catch {
    return null;
  }
}
