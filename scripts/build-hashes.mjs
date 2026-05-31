// Build a perceptual-hash database for card image matching.
//
//   node scripts/build-hashes.mjs "set:ltr or set:ltc" ltr
//
// Queries Scryfall (unique prints), downloads each printing's small image, computes
// a 256-bit dHash, and writes public/hashes/<slug>.json. Crucially this uses the
// SAME canvas engine (@napi-rs/canvas → Skia) and dHash math as the browser matcher
// (lib/cardMatch.js), so reference and camera hashes live in the same space.
//
// Also writes public/test-card.{jpg,json} (first card) for the in-app pipeline
// self-test. This script is the seed of the full pipeline (Phase H1).

import { createCanvas, loadImage } from '@napi-rs/canvas';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const HASH_SIZE = 16; // 16×16 comparisons → 256-bit dHash
const SCRYFALL = 'https://api.scryfall.com';
const HEADERS = {
  'User-Agent': 'DeckForge/1.0 (https://github.com/samknight-design/deckforge)',
  Accept: 'application/json',
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// dHash — MUST stay byte-identical to lib/cardMatch.js: greyscale via Rec.601,
// resize to (size+1)×size, compare horizontally adjacent pixels, pack MSB-first.
function dhashFromImage(img, size = HASH_SIZE) {
  const w = size + 1, h = size;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  const out = new Uint8Array((size * h) / 8);
  let bit = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * w + x) * 4, i2 = (y * w + x + 1) * 4;
      const g1 = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
      const g2 = d[i2] * 0.299 + d[i2 + 1] * 0.587 + d[i2 + 2] * 0.114;
      if (g1 < g2) out[bit >> 3] |= (0x80 >> (bit & 7));
      bit++;
    }
  }
  let hex = '';
  for (const b of out) hex += b.toString(16).padStart(2, '0');
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
    await sleep(100);
  }
  return cards;
}

async function main() {
  const query = process.argv[2] || 'set:ltr or set:ltc';
  const slug = process.argv[3] || 'ltr';

  console.log(`Querying Scryfall: "${query}"`);
  const prints = await fetchAllPrints(query);
  console.log(`Found ${prints.length} printings. Hashing images…`);

  const dir = path.join(process.cwd(), 'public', 'hashes');
  await mkdir(dir, { recursive: true });

  const out = [];
  let done = 0, skipped = 0, testWritten = false;
  for (const card of prints) {
    const u = imageUrl(card);
    if (!u) { skipped++; continue; }
    try {
      const res = await fetch(u, { headers: { 'User-Agent': HEADERS['User-Agent'] } });
      if (!res.ok) { skipped++; continue; }
      const buf = Buffer.from(await res.arrayBuffer());
      const img = await loadImage(buf);
      const hash = dhashFromImage(img);
      out.push({ id: card.id, name: card.name, set: card.set, cn: card.collector_number, hash });
      done++;

      // Bundle the first card for the in-app pipeline self-test.
      if (!testWritten) {
        await writeFile(path.join(process.cwd(), 'public', 'test-card.jpg'), buf);
        await writeFile(
          path.join(process.cwd(), 'public', 'test-card.json'),
          JSON.stringify({ id: card.id, name: card.name, hash })
        );
        testWritten = true;
        console.log(`  test card: ${card.name} (${hash.slice(0, 16)}…)`);
      }
      if (done % 100 === 0) console.log(`  ${done}/${prints.length}`);
    } catch {
      skipped++;
    }
    await sleep(60);
  }

  const file = path.join(dir, `${slug}.json`);
  await writeFile(file, JSON.stringify({ query, bits: HASH_SIZE * HASH_SIZE, count: out.length, cards: out }));
  console.log(`\nWrote ${out.length} hashes (${skipped} skipped) → public/hashes/${slug}.json`);
}

main().catch((e) => { console.error(e); process.exit(1); });
