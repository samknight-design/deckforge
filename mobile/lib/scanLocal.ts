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
import * as FileSystem from 'expo-file-system/legacy';
import { Buffer } from 'buffer';
import { decode as decodeJpeg } from 'jpeg-js';
import {
  hashCardFromPixels,
  matchHash,
  parseHashDb,
} from '@deckforge/shared/cardScan';

type LoadedDb = {
  db: { version: number; count: number; bytesPerHash: number; flat: Uint8Array };
  ids: Uint8Array; // packed cards.ids.bin (8-byte header + 16 bytes per id), parallel to db
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

// Load the bundled DB once: ~3.5 MB hashes + ~1.8 MB packed ids. Both are
// binary (base64-decoded byte slices) — NO JSON.parse, which used to freeze the
// UI for several seconds parsing an 11 MB index. Memoised so later scans reuse it.
export function prepareScanDb(): Promise<LoadedDb> {
  if (dbPromise) return dbPromise;
  dbPromise = (async () => {
    const binMod = require('../assets/hashes/cards.bin');
    const idsMod = require('../assets/hashes/cards.ids.bin');
    const [binAsset, idsAsset] = await Promise.all([
      Asset.fromModule(binMod).downloadAsync(),
      Asset.fromModule(idsMod).downloadAsync(),
    ]);

    const [binB64, idsB64] = await Promise.all([
      FileSystem.readAsStringAsync(binAsset.localUri!, { encoding: FileSystem.EncodingType.Base64 }),
      FileSystem.readAsStringAsync(idsAsset.localUri!, { encoding: FileSystem.EncodingType.Base64 }),
    ]);

    const bytes = new Uint8Array(Buffer.from(binB64, 'base64'));
    const ids = new Uint8Array(Buffer.from(idsB64, 'base64'));

    return { db: parseHashDb(bytes), ids };
  })();
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
