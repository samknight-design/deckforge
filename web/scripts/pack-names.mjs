// Pack card names into a compact binary the mobile scanner can read WITHOUT a
// big JSON.parse, so a confident on-device match can auto-add + show a toast
// instantly with ZERO network round-trip (no /api/scan/resolve on the hot path).
//
//   node web/scripts/pack-names.mjs
//
// Output (parallel order to cards.bin / cards.ids.bin):
//   mobile/assets/hashes/cards.names.bin
//     Header (8 bytes): "DFNM" + uint32 count
//     Offset table: (count+1) × uint32 (byte offsets into the blob, relative to blob start)
//     Blob: concatenated UTF-8 name bytes
//   nameAt(i) = utf8-decode(blob[offset[i] .. offset[i+1]])

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const hashDir = path.resolve(scriptDir, '..', '..', 'mobile', 'assets', 'hashes');

const idx = JSON.parse(await readFile(path.join(hashDir, 'cards.idx'), 'utf8'));
const count = idx.length;

const nameBufs = idx.map((e) => Buffer.from(e.name ?? '', 'utf8'));
const blobSize = nameBufs.reduce((s, b) => s + b.length, 0);

const headerSize = 8;
const tableSize = (count + 1) * 4;
const out = Buffer.alloc(headerSize + tableSize + blobSize);

out.write('DFNM', 0, 4, 'ascii');
out.writeUInt32LE(count, 4);

let off = 0;
for (let i = 0; i < count; i++) {
  out.writeUInt32LE(off, headerSize + i * 4);
  off += nameBufs[i].length;
}
out.writeUInt32LE(off, headerSize + count * 4); // sentinel end offset

let pos = headerSize + tableSize;
for (const b of nameBufs) { b.copy(out, pos); pos += b.length; }

await writeFile(path.join(hashDir, 'cards.names.bin'), out);
console.log(`Wrote ${count} names -> cards.names.bin (${(out.length / 1e6).toFixed(2)} MB)`);
