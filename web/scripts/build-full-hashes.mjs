// Build the FULL Scryfall hash database (~90k printings) in a compact binary
// format for client-side card matching.
//
//   node scripts/build-full-hashes.mjs               # full build
//   node scripts/build-full-hashes.mjs --incremental # only hash new prints
//
// Output:
//   public/hashes/cards.bin  — packed binary (header + per-card records)
//   public/hashes/cards.idx.json — id+name+set+cn lookup table (parallel order)
//   public/hashes/cards.meta.json — { version, count, bytesPerHash, builtAt }
//
// Binary layout:
//   Header (16 bytes): "DFHB" magic + uint32 version + uint32 count + uint32 bytesPerHash
//   Records: count × bytesPerHash bytes (hashes only, parallel to idx.json)
//
// The client mmaps this with fetch + ArrayBuffer; no JSON parsing the hashes,
// and the index can be loaded lazily / streamed.

import { createCanvas, loadImage } from '@napi-rs/canvas';
import { writeFile, mkdir, readFile, access, unlink } from 'node:fs/promises';
import { createWriteStream, createReadStream, existsSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import streamArray from 'stream-json/streamers/stream-array.js';

const HASH_SIZE = 16;                   // 16×16 → 256-bit / 32-byte dHash
const BYTES_PER_HASH = (HASH_SIZE * HASH_SIZE) / 8;
const SCRYFALL_BULK = 'https://api.scryfall.com/bulk-data';
const USER_AGENT = 'DeckForge/1.0 (https://github.com/samknight-design/deckforge)';
const CONCURRENCY = 8;                  // parallel image fetches (be polite)
const RETRY = 3;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// dHash — MUST stay byte-identical to lib/cardMatch.js.
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
  return out;
}

async function dhashFromBuffer(buf) {
  const img = await loadImage(buf);
  const W = img.width, H = img.height;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0);
  const { data } = ctx.getImageData(0, 0, W, H);
  return dhashFromImageData(data, W, H);
}

function imageUrl(card) {
  // Prefer small (~146×204) — plenty for dHash, fastest to download.
  const uris = card.image_uris || card.card_faces?.[0]?.image_uris;
  return uris?.small || uris?.normal || null;
}

// Stream-load Scryfall's bulk default_cards file. The file is ~540 MB of JSON;
// loading it into one string blows Node's v8 max-string-length (≈ 512 MB).
// So: download to disk first, then stream-parse the top-level array element
// by element via stream-json. Returns an async iterable of card objects.
async function* streamBulkCards() {
  console.log('Fetching Scryfall bulk-data manifest…');
  const manifestRes = await fetch(SCRYFALL_BULK, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
  if (!manifestRes.ok) throw new Error(`bulk-data manifest ${manifestRes.status}`);
  const manifest = await manifestRes.json();
  const entry = manifest.data.find((e) => e.type === 'default_cards');
  if (!entry) throw new Error('no default_cards in bulk-data');

  const tmpFile = path.join(os.tmpdir(), `deckforge-bulk-${Date.now()}.json`);
  console.log(`Downloading default_cards (${(entry.size / 1e6).toFixed(0)} MB) → ${tmpFile}`);
  const cardsRes = await fetch(entry.download_uri, { headers: { 'User-Agent': USER_AGENT } });
  if (!cardsRes.ok) throw new Error(`default_cards ${cardsRes.status}`);
  if (!cardsRes.body) throw new Error('default_cards response has no body');
  // Pipe HTTP body → disk
  await pipeline(Readable.fromWeb(cardsRes.body), createWriteStream(tmpFile));
  console.log('Download complete. Streaming parse…');

  try {
    // Stream-parse the top-level JSON array: each yielded value is a card object.
    // withParserAsStream() returns a Node stream in object mode that emits
    // { key, value } per array element.
    const stream = createReadStream(tmpFile).pipe(streamArray.withParserAsStream());
    for await (const { value } of stream) {
      yield value;
    }
  } finally {
    try { await unlink(tmpFile); } catch {}
  }
}

// `print` here is the slimmed record built by the streaming pass: { id, name,
// set, cn, url }. Returns a Uint8Array of bytes or null on failure.
async function hashOne(print) {
  if (!print?.url) return null;
  for (let attempt = 0; attempt < RETRY; attempt++) {
    try {
      const res = await fetch(print.url, { headers: { 'User-Agent': USER_AGENT } });
      if (!res.ok) { await sleep(200); continue; }
      const buf = Buffer.from(await res.arrayBuffer());
      return await dhashFromBuffer(buf);
    } catch {
      await sleep(200 * (attempt + 1));
    }
  }
  return null;
}

async function loadExisting(idxPath, binPath) {
  if (!existsSync(idxPath) || !existsSync(binPath)) return null;
  console.log('Loading existing hashes for incremental update…');
  const idx = JSON.parse(await readFile(idxPath, 'utf8'));
  const bin = await readFile(binPath);
  // Header is 16 bytes; hashes follow.
  const map = new Map();
  for (let i = 0; i < idx.length; i++) {
    const off = 16 + i * BYTES_PER_HASH;
    map.set(idx[i].id, bin.subarray(off, off + BYTES_PER_HASH));
  }
  console.log(`  ${map.size} existing hashes loaded.`);
  return map;
}

async function main() {
  const incremental = process.argv.includes('--incremental');
  // Output goes into mobile/assets/hashes/ so it bundles with the Expo app.
  // Path is relative to this script's location (repo/web/scripts/) so the
  // script can be invoked from anywhere — `node web/scripts/build-full-hashes.mjs`
  // from the repo root works, as does `cd web && node scripts/...`.
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const outDir = path.resolve(scriptDir, '..', '..', 'mobile', 'assets', 'hashes');
  console.log(`Output → ${outDir}`);
  await mkdir(outDir, { recursive: true });
  const binPath = path.join(outDir, 'cards.bin');
  const idxPath = path.join(outDir, 'cards.idx.json');
  const metaPath = path.join(outDir, 'cards.meta.json');

  const existing = incremental ? await loadExisting(idxPath, binPath) : null;

  // Stream-collect every printing that has an image. The card objects from
  // stream-json are full Scryfall card records, but we only keep what we need
  // for hashing and the index — about ~150 bytes per card vs ~5 KB raw, so
  // ~90k cards × 150 = 14 MB resident. Fine.
  console.log('Pass 1/2: streaming card metadata…');
  const prints = [];
  for await (const card of streamBulkCards()) {
    const u = imageUrl(card);
    if (!u) continue;
    prints.push({ id: card.id, name: card.name, set: card.set, cn: card.collector_number, url: u });
  }
  console.log(`Total printings with images: ${prints.length}`);
  console.log('Pass 2/2: fetching images + hashing in parallel batches…');

  const idx = new Array(prints.length);
  const hashes = new Array(prints.length);

  let done = 0, skipped = 0, reused = 0;
  const startTs = Date.now();

  // Process in parallel batches to throttle.
  for (let i = 0; i < prints.length; i += CONCURRENCY) {
    const batch = prints.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(async (card, k) => {
      const slot = i + k;
      idx[slot] = { id: card.id, name: card.name, set: card.set, cn: card.cn };
      const reuse = existing?.get(card.id);
      if (reuse) { reused++; return reuse; }
      const h = await hashOne(card);
      if (h) done++;
      else skipped++;
      return h;
    }));
    for (let k = 0; k < results.length; k++) hashes[i + k] = results[k];

    if ((i / CONCURRENCY) % 25 === 0) {
      const elapsed = (Date.now() - startTs) / 1000;
      const rate = (done + reused) / Math.max(1, elapsed);
      const eta = Math.round((prints.length - i) / Math.max(1, rate));
      console.log(`  ${i + batch.length}/${prints.length} · ${rate.toFixed(1)}/s · ETA ${Math.floor(eta / 60)}m${String(eta % 60).padStart(2, '0')}s · reused ${reused} · new ${done} · skip ${skipped}`);
    }
    await sleep(40); // polite pacing between batches
  }

  // Filter out skipped (no hash) entries, keep idx parallel to bin.
  const finalIdx = [];
  const finalHashes = [];
  for (let i = 0; i < idx.length; i++) {
    if (hashes[i]) {
      finalIdx.push(idx[i]);
      finalHashes.push(hashes[i]);
    }
  }

  // Pack the binary blob: 16-byte header + finalHashes.
  const count = finalHashes.length;
  const blob = Buffer.alloc(16 + count * BYTES_PER_HASH);
  blob.write('DFHB', 0, 4, 'ascii');
  blob.writeUInt32LE(1, 4);                    // format version
  blob.writeUInt32LE(count, 8);
  blob.writeUInt32LE(BYTES_PER_HASH, 12);
  for (let i = 0; i < count; i++) {
    blob.set(finalHashes[i], 16 + i * BYTES_PER_HASH);
  }

  await writeFile(binPath, blob);
  await writeFile(idxPath, JSON.stringify(finalIdx));
  await writeFile(metaPath, JSON.stringify({
    version: 1,
    builtAt: new Date().toISOString(),
    count,
    bytesPerHash: BYTES_PER_HASH,
    sizeMb: +(blob.length / 1e6).toFixed(2),
  }, null, 2));

  console.log(`\nWrote ${count} hashes:`);
  console.log(`  ${binPath} (${(blob.length / 1e6).toFixed(2)} MB)`);
  console.log(`  ${idxPath} (${((await readFile(idxPath)).length / 1e6).toFixed(2)} MB)`);
  console.log(`  ${metaPath}`);
  console.log(`  ${skipped} skipped, ${reused} reused.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
