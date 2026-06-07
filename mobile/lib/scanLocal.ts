// On-device card matching. Decodes a captured JPEG to RGBA, runs the shared
// scan engine (Hough corner detect → perspective unskew → dHash), and matches
// against the bundled 114k-printing hash DB. Confident hits resolve for free
// via /api/scan/resolve; low-confidence falls back to Claude Smart Scan.
//
// PERFORMANCE NOTES (2026-06):
// The caller (CameraView) is responsible for capturing at low resolution
// (~320×240). jpeg-js decode time scales with pixel count: 320×240 = 76k px
// decodes in ~400ms; 1280×720 = 921k px took 5–8s. DO NOT capture at high res.

import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';
import * as LegacyFS from 'expo-file-system/legacy';
import { Buffer } from 'buffer';
import { decode as decodeJpeg } from 'jpeg-js';
import {
  hashCardFromPixels,
  matchHash,
  parseHashDb,
} from '@deckforge/shared/cardScan';

type LoadedDb = {
  db: { version: number; count: number; bytesPerHash: number; flat: Uint8Array };
  ids: Uint8Array;   // packed cards.ids.bin (8-byte header + 16 bytes per id), parallel to db
  names: Uint8Array; // packed cards.names.bin ("DFNM" + count + offset table + utf8 blob)
};

export type LocalMatch = {
  scryfallId: string;
  index: number;
  distance: number;
  runnerUp: number;
  totalBits: number;
  detected: boolean;
  confident: boolean;
  corners: Array<{x: number; y: number}> | null;
};

// Format the 16-byte packed UUID at row `i` of cards.ids.bin into the canonical
// 8-4-4-4-12 string. Header is 8 bytes, then 16 bytes per id.
export function idAt(ids: Uint8Array, i: number): string | null {
  const off = 8 + i * 16;
  if (off + 16 > ids.length) return null;
  let hex = '';
  for (let b = 0; b < 16; b++) hex += ids[off + b].toString(16).padStart(2, '0');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// Read the card name at row `i` from cards.names.bin (header 8B + (count+1) uint32
// offsets + utf8 blob). Lets a confident match auto-add + toast with NO network.
export function nameAt(names: Uint8Array, i: number): string | null {
  if (!names || names.length < 8) return null;
  const dv = new DataView(names.buffer, names.byteOffset, names.byteLength);
  const count = dv.getUint32(4, true);
  if (i < 0 || i >= count) return null;
  const tableBase = 8;
  const blobStart = tableBase + (count + 1) * 4;
  const start = dv.getUint32(tableBase + i * 4, true) + blobStart;
  const end = dv.getUint32(tableBase + (i + 1) * 4, true) + blobStart;
  if (end > names.length || start > end) return null;
  return Buffer.from(names.subarray(start, end)).toString('utf8');
}

// ── Confidence gates ──────────────────────────────────────────────────────────
//
// Separate thresholds for when Hough corner detection succeeded (perspective-
// corrected image) vs center-crop fallback (uncorrected, more hash drift).
//
// "distance" = Hamming distance between query and DB hash (0 = identical, 256 = inverted)
// "gap"      = how much better the winner is vs runner-up (higher = more confident)
//
// Corner-detected path: tighter distance threshold (better image quality)
const DETECTED_MAX_DIST = 65;   // ≤ 25% bit mismatch (was 72)
const DETECTED_MIN_GAP  = 10;   // winner leads runner-up by ≥ 10 bits (was 12)

// Center-crop path: looser thresholds (no perspective correction = more drift)
const CROP_MAX_DIST     = 85;   // ≤ 33% bit mismatch (was same as detected)
const CROP_MIN_GAP      = 8;    // winner leads runner-up by ≥ 8 bits

let dbPromise: Promise<LoadedDb> | null = null;

// How the bytes were read — surfaced on screen so we can tell native-fast vs
// pure-JS-slow path apart during debugging.
export let dbReadMethod: 'native' | 'base64-fallback' | 'unknown' = 'unknown';

// Read a file's raw bytes. FAST PATH: expo-file-system's native File.bytes()
// hands back a Uint8Array directly (no base64, no pure-JS decode — does NOT block
// the JS thread). FALLBACK: legacy readAsStringAsync + Buffer base64 decode (pure
// JS, slow, blocks) only if the native API isn't in this build.
async function readBytes(localUri: string): Promise<Uint8Array> {
  try {
    const f = new File(localUri);
    const b = await f.bytes();
    dbReadMethod = 'native';
    return b;
  } catch {
    const b64 = await LegacyFS.readAsStringAsync(localUri, { encoding: LegacyFS.EncodingType.Base64 });
    dbReadMethod = 'base64-fallback';
    return new Uint8Array(Buffer.from(b64, 'base64'));
  }
}

// Load the bundled DB once: ~3.5 MB hashes + ~1.8 MB packed ids, both binary.
// NO JSON.parse and (on the native path) NO base64 — so it doesn't freeze the UI.
// `onStage` reports progress for on-screen diagnostics. Memoised; a failed load
// clears the memo so it can be retried.
export function prepareScanDb(onStage?: (s: string) => void): Promise<LoadedDb> {
  if (dbPromise) return dbPromise;
  dbPromise = (async () => {
    const t0 = Date.now();
    onStage?.('Locating database…');
    const binMod = require('../assets/hashes/cards.bin');
    const idsMod = require('../assets/hashes/cards.ids.bin');
    const namesMod = require('../assets/hashes/cards.names.bin');
    const [binAsset, idsAsset, namesAsset] = await Promise.all([
      Asset.fromModule(binMod).downloadAsync(),
      Asset.fromModule(idsMod).downloadAsync(),
      Asset.fromModule(namesMod).downloadAsync(),
    ]);

    onStage?.('Reading hashes…');
    const bytes = await readBytes(binAsset.localUri!);
    onStage?.('Reading card index…');
    const ids = await readBytes(idsAsset.localUri!);
    const names = await readBytes(namesAsset.localUri!);

    const parsed = parseHashDb(bytes);
    onStage?.(`Ready · ${parsed.count} cards · ${Date.now() - t0}ms · ${dbReadMethod}`);
    return { db: parsed, ids, names };
  })();
  // On failure, clear the memo so the next attempt can retry instead of caching the rejection.
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

// Match a base64 JPEG against the DB.
// CRITICAL: pass a low-resolution JPEG (~320×240). jpeg-js is pure JS and
// decoding large images is the #1 bottleneck. See CameraView for format setup.
export async function matchPhoto(base64Jpeg: string): Promise<LocalMatch | null> {
  const { db, ids } = await prepareScanDb();

  const t0 = Date.now();
  const raw = Buffer.from(base64Jpeg, 'base64');
  const img = decodeJpeg(raw, { useTArray: true, formatAsRGBA: true } as any);
  console.log(`[scan] jpeg-js decode: ${Date.now() - t0}ms (${img.width}×${img.height})`);

  const t1 = Date.now();
  const { hash, detected, corners } = hashCardFromPixels(img.data, img.width, img.height);
  console.log(`[scan] hash pipeline (hough+warp+dhash): ${Date.now() - t1}ms (detected: ${detected})`);

  if (!hash) return null;

  const t2 = Date.now();
  const m = matchHash(hash, db);
  console.log(`[scan] matchHash ${db.count} cards: ${Date.now() - t2}ms (dist=${m.distance}, gap=${m.runnerUp - m.distance})`);

  const scryfallId = idAt(ids, m.index);
  if (!scryfallId) return null;

  const maxDist = detected ? DETECTED_MAX_DIST : CROP_MAX_DIST;
  const minGap  = detected ? DETECTED_MIN_GAP  : CROP_MIN_GAP;
  const gap = m.runnerUp - m.distance;
  const confident = m.distance <= maxDist && gap >= minGap;

  console.log(`[scan] result: ${scryfallId} — dist=${m.distance}/${maxDist}, gap=${gap}/${minGap}, confident=${confident}`);

  return {
    scryfallId,
    index: m.index,
    distance: m.distance,
    runnerUp: m.runnerUp,
    totalBits: m.totalBits,
    detected,
    confident,
    corners,
  };
}
