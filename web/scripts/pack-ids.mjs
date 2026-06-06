// Convert the bulky cards.idx (JSON with id+name+set+cn per printing, ~11 MB)
// into a compact binary id table the mobile scanner can load WITHOUT JSON.parse.
//
// The scanner only ever needs the scryfall id for a matched row — it calls
// /api/scan/resolve to get name/set/price/etc. from the server. So the names in
// cards.idx are dead weight at scan time. Packing the 36-char UUIDs as 16 raw
// bytes each gives ~1.8 MB and, crucially, parses instantly (it's just a byte
// slice — no main-thread JSON parse, which was freezing the UI for seconds).
//
//   node web/scripts/pack-ids.mjs
//
// Output (parallel order to cards.bin):
//   mobile/assets/hashes/cards.ids.bin
//     Header (8 bytes): "DFID" magic + uint32 count
//     Records: count × 16 bytes (UUID with dashes stripped, hex-decoded)

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const hashDir = path.resolve(scriptDir, '..', '..', 'mobile', 'assets', 'hashes');
const idxPath = path.join(hashDir, 'cards.idx');
const outPath = path.join(hashDir, 'cards.ids.bin');

const idx = JSON.parse(await readFile(idxPath, 'utf8'));
const count = idx.length;

const blob = Buffer.alloc(8 + count * 16);
blob.write('DFID', 0, 4, 'ascii');
blob.writeUInt32LE(count, 4);

for (let i = 0; i < count; i++) {
  const hex = idx[i].id.replace(/-/g, '');
  if (hex.length !== 32) throw new Error(`bad id at ${i}: ${idx[i].id}`);
  blob.write(hex, 8 + i * 16, 16, 'hex');
}

await writeFile(outPath, blob);
console.log(`Wrote ${count} ids → ${outPath} (${(blob.length / 1e6).toFixed(2)} MB)`);
console.log(`(was cards.idx ${( (await readFile(idxPath)).length / 1e6).toFixed(2)} MB JSON)`);
