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

// Deterministic dHash — MUST stay byte-identical to lib/cardMatch.js: box-average
// the full-res image down to a (size+1)×size greyscale grid in plain JS (no engine
// resampling), Rec.601 luma, compare horizontally adjacent cells, pack MSB-first.
function dhashFromImageData(data, sw, sh, size = HASH_SIZE) {
  const gw = size + 1, gh = size;
  const grid = new Float64Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) {
    const y0 = Math.floor((gy * sh) / gh);
    const y1 = Math.max(y0 + 1, Math.floor(((gy + 1) * sh) / gh));
    for (let gx = 0; gx < gw; gx++) {
      const x0 = Math.floor((gx * sw) / gw);
      const x1 = Math.max(x0 + 1, Math.floor(((gx + 1) * sw) / gw));
      let sum = 0, cnt = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * sw + x) * 4;
          sum += data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
          cnt++;
        }
      }
      grid[gy * gw + gx] = cnt ? sum / cnt : 0;
    }
  }
  const out = new Uint8Array((size * size) / 8);
  let bit = 0;
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < size; gx++) {
      if (grid[gy * gw + gx] < grid[gy * gw + gx + 1]) out[bit >> 3] |= (0x80 >> (bit & 7));
      bit++;
    }
  }
  let hex = '';
  for (const b of out) hex += b.toString(16).padStart(2, '0');
  return hex;
}

function dhashFromImage(img, size = HASH_SIZE) {
  const W = img.width, H = img.height;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0);
  const { data } = ctx.getImageData(0, 0, W, H);
  return dhashFromImageData(data, W, H, size);
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
