const SCRYFALL_BASE = 'https://api.scryfall.com';

// Scryfall requires an identifying User-Agent and an explicit Accept header on
// every request — without them the API rejects the call (non-200), which our
// helpers below treat as "no results". The edge runtime's default fetch
// User-Agent is not accepted, so we set these explicitly everywhere.
const SCRYFALL_HEADERS = {
  'User-Agent': 'DeckForge/1.0 (https://github.com/samknight-design/deckforge)',
  Accept: 'application/json',
};

export function normalizeCard(data) {
  const imageUris = data.image_uris || data.card_faces?.[0]?.image_uris || {};
  const imageUriBack = data.card_faces?.[1]?.image_uris?.normal || null;
  return {
    scryfall_id: data.id,
    card_name: data.name,
    oracle_text: data.oracle_text || data.card_faces?.[0]?.oracle_text || '',
    mana_cost: data.mana_cost || data.card_faces?.[0]?.mana_cost || '',
    cmc: data.cmc ?? 0,
    type_line: data.type_line || '',
    colors: data.colors || data.card_faces?.[0]?.colors || [],
    color_identity: data.color_identity || [],
    set_code: data.set || '',
    set_name: data.set_name || '',
    image_uri: imageUris.normal || imageUris.large || imageUris.small || null,
    image_uri_back: imageUriBack,
    price_usd: data.prices?.usd ? parseFloat(data.prices.usd) : null,
    price_usd_foil: data.prices?.usd_foil ? parseFloat(data.prices.usd_foil) : null,
    price_eur: data.prices?.eur ? parseFloat(data.prices.eur) : null,
    price_eur_foil: data.prices?.eur_foil ? parseFloat(data.prices.eur_foil) : null,
    is_legendary: (data.type_line || '').includes('Legendary'),
    is_creature: (data.type_line || '').includes('Creature'),
    is_land: (data.type_line || '').includes('Land'),
    power: data.power || null,
    toughness: data.toughness || null,
    loyalty: data.loyalty || null,
    legalities: data.legalities || {},
    cached_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  };
}

export async function fetchCardByName(name) {
  const url = `${SCRYFALL_BASE}/cards/named?fuzzy=${encodeURIComponent(name)}`;
  const res = await fetch(url, { headers: SCRYFALL_HEADERS, next: { revalidate: 3600 } });
  if (!res.ok) return null;
  const data = await res.json();
  if (data.object === 'error') return null;
  return normalizeCard(data);
}

export async function fetchCardById(id) {
  const url = `${SCRYFALL_BASE}/cards/${id}`;
  const res = await fetch(url, { headers: SCRYFALL_HEADERS, next: { revalidate: 3600 } });
  if (!res.ok) return null;
  const data = await res.json();
  if (data.object === 'error') return null;
  return normalizeCard(data);
}

export async function autocompleteCardName(query) {
  if (!query || query.length < 2) return [];
  const url = `${SCRYFALL_BASE}/cards/autocomplete?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: SCRYFALL_HEADERS, next: { revalidate: 300 } });
  if (!res.ok) return [];
  const data = await res.json();
  return data.data || [];
}

export async function fetchCardCollection(identifiers) {
  // identifiers = [{ name: 'Card Name' }, ...]
  const chunks = [];
  for (let i = 0; i < identifiers.length; i += 75) {
    chunks.push(identifiers.slice(i, i + 75));
  }

  const results = [];
  for (const chunk of chunks) {
    const res = await fetch(`${SCRYFALL_BASE}/cards/collection`, {
      method: 'POST',
      headers: { ...SCRYFALL_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifiers: chunk }),
    });
    if (!res.ok) continue;
    const data = await res.json();
    if (data.data) {
      results.push(...data.data.map(normalizeCard));
    }
  }
  return results;
}

export async function searchCards(query) {
  if (!query || query.trim().length === 0) return [];
  const url = `${SCRYFALL_BASE}/cards/search?q=${encodeURIComponent(query)}&order=name&unique=cards`;
  const res = await fetch(url, { headers: SCRYFALL_HEADERS, cache: 'no-store' });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.data || []).slice(0, 30).map(normalizeCard);
}

export function formatEur(value) {
  if (value === null || value === undefined) return '—';
  return `€${parseFloat(value).toFixed(2)}`;
}
