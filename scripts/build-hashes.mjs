// Build a perceptual-hash database for card image matching.
//
//   node scripts/build-hashes.mjs "set:ltr or set:ltc" ltr
//
// Queries Scryfall (unique prints), downloads each printing's small image, computes
// a 256-bit dHash, and writes public/hashes/<slug>.json. This is the seed of the
// full pipeline (Phase H1 scales it to the whole bulk dataset).

import sharp from 'sharp';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const HASH_SIZE = 16;            // 16×16 comparisons → 256-bit dHash
const SCRYFALL = 'https://api.scryfall.com';
const HEADERS = {
  'User-Agent': 'DeckForge/1.0 (https://github.com/samknight-design/deckforge)',
  Accept: 'application/json',
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// dHash: greyscale → resize to (size+1)×size → compare horizontally adjacent
// pixels. Packed MSB-first to match the browser matcher exactly.
async function dhash(buf, size = HASH_SIZE) {
  const w = size + 1, h = size;
  const raw = await sharp(buf).resize(w, h, { fit: 'fill' }).greyscale().raw().toBuffer();
  const bits = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * w + x;
      bits.push(raw[i] < raw[i + 1] ? 1 : 0);
    }
  }
  let hex = '';
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let k = 0; k < 8; k++) b = (b << 1) | bits[i + k];
    hex += b.toString(16).padStart(2, '0');
  }
  return hex;
}

function imageUrl(card) {
  const uris = card.image_uris || card.card_faces?.[0]?.image_uris;
  return uris?.small || uris?.normal || null;
}

async function fetchAllPrints(query) {
  const cards = [];
  let url = `${SCRYFALL}/cards/search?q=${encodeURIComponent(query)}&unique=prints&order=set`;
  while (url) {
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) throw new Error(`Scryfall ${res.status} for ${url}`);
    const data = await res.json();
    cards.push(...(data.data || []));
    url = data.has_more ? data.next_page : null;
    await sleep(100); // be polite to the API
  }
  return cards;
}

async function main() {
  const query = process.argv[2] || 'set:ltr or set:ltc';
  const slug = process.argv[3] || 'ltr';

  console.log(`Querying Scryfall: "${query}"`);
  const prints = await fetchAllPrints(query);
  console.log(`Found ${prints.length} printings. Hashing images…`);

  const out = [];
  let done = 0, skipped = 0;
  for (const card of prints) {
    const u = imageUrl(card);
    if (!u) { skipped++; continue; }
    try {
      const res = await fetch(u, { headers: { 'User-Agent': HEADERS['User-Agent'] } });
      if (!res.ok) { skipped++; continue; }
      const buf = Buffer.from(await res.arrayBuffer());
      const hash = await dhash(buf);
      out.push({ id: card.id, name: card.name, set: card.set, cn: card.collector_number, hash });
      done++;
      if (done % 50 === 0) console.log(`  ${done}/${prints.length}`);
    } catch (e) {
      skipped++;
    }
    await sleep(60); // polite image pacing
  }

  const dir = path.join(process.cwd(), 'public', 'hashes');
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${slug}.json`);
  await writeFile(file, JSON.stringify({ query, bits: HASH_SIZE * HASH_SIZE, count: out.length, cards: out }));
  console.log(`\nWrote ${out.length} hashes (${skipped} skipped) → public/hashes/${slug}.json`);
}

main().catch((e) => { console.error(e); process.exit(1); });
