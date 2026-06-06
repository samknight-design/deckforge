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

type IdxEntry = { id: string; name: string; set: string; cn: string };
type LoadedDb = {
  db: { version: number; count: number; bytesPerHash: number; flat: Uint8Array };
  idx: IdxEntry[];
};

export type LocalMatch = {
  scryfallId: string;
  name: string;
  set: string;
  cn: string;
  distance: number;
  runnerUp: number;
  totalBits: number;
  detected: boolean;
  confident: boolean;
  corners: Array<{x: number; y: number}> | null;
};

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

// Load + parse the bundled DB once. ~3.5 MB binary + idx JSON.
// Memoised so subsequent scans are instant (first scan pays the load cost).
export function prepareScanDb(): Promise<LoadedDb> {
  if (dbPromise) return dbPromise;
  dbPromise = (async () => {
    const binMod = require('../assets/hashes/cards.bin');
    const idxMod = require('../assets/hashes/cards.idx');
    const [binAsset, idxAsset] = await Promise.all([
      Asset.fromModule(binMod).downloadAsync(),
      Asset.fromModule(idxMod).downloadAsync(),
    ]);

    const binB64 = await FileSystem.readAsStringAsync(binAsset.localUri!, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const bytes = new Uint8Array(Buffer.from(binB64, 'base64'));

    const idxText = await FileSystem.readAsStringAsync(idxAsset.localUri!, {
      encoding: FileSystem.EncodingType.UTF8,
    });
    const idx = JSON.parse(idxText) as IdxEntry[];

    return { db: parseHashDb(bytes), idx };
  })();
  return dbPromise;
}

// Match a base64 JPEG against the DB.
// CRITICAL: pass a low-resolution JPEG (~320×240). jpeg-js is pure JS and
// decoding large images is the #1 bottleneck. See CameraView for format setup.
export async function matchPhoto(base64Jpeg: string): Promise<LocalMatch | null> {
  const { db, idx } = await prepareScanDb();

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

  const entry = idx[m.index];
  if (!entry) return null;

  const maxDist = detected ? DETECTED_MAX_DIST : CROP_MAX_DIST;
  const minGap  = detected ? DETECTED_MIN_GAP  : CROP_MIN_GAP;
  const gap = m.runnerUp - m.distance;
  const confident = m.distance <= maxDist && gap >= minGap;

  console.log(`[scan] result: ${entry.name} (${entry.set}) — dist=${m.distance}/${maxDist}, gap=${gap}/${minGap}, confident=${confident}`);

  return {
    scryfallId: entry.id,
    name: entry.name,
    set: entry.set,
    cn: entry.cn,
    distance: m.distance,
    runnerUp: m.runnerUp,
    totalBits: m.totalBits,
    detected,
    confident,
    corners,
  };
}
