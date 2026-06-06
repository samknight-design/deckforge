// Native OpenCV card scanner — the ManaBox-style pipeline.
//
//   snapshot JPEG → decode → grayscale → blur → Canny edges → contours
//   → largest 4-corner quad at card aspect → perspective-warp flat
//   → dHash (DB-compatible math) → Hamming match against the bundled DB
//
// Runs on the JS thread (react-native-fast-opencv is JSI, callable here). This
// is the proving ground for the vision pipeline; once validated it moves into
// the camera-thread frame processor for continuous auto-scan.
//
// dHash math is byte-identical to web/scripts/build-full-hashes.mjs: COLOR_*2GRAY
// uses luma 0.299R+0.587G+0.114B, the same weights the DB was built with, and the
// 17×16 grid comparison matches — so warped-card hashes line up with the DB.

import {
  OpenCV,
  ObjectType,
  DataTypes,
  ColorConversionCodes,
  RetrievalModes,
  ContourApproximationModes,
  InterpolationFlags,
  DecompTypes,
  BorderTypes,
} from 'react-native-fast-opencv';
import { matchHash } from '@deckforge/shared/cardScan';
import { prepareScanDb, idAt } from './scanLocal';

const PROC_LONG = 600;   // process at this long-side resolution (speed vs detail)
const WARP_W = 146;      // warp output size — mirrors Scryfall 'small' source
const WARP_H = 204;
const MIN_AREA_FRAC = 0.12; // card quad must cover ≥12% of the frame
const ASPECT_LO = 0.55;     // card ratio is 63/88 ≈ 0.716; accept a band around it
const ASPECT_HI = 0.92;

export type OpenCVMatch = {
  detected: boolean;     // true if a card quad was found and warped
  contourCount: number;  // how many contours Canny+findContours produced (debug)
  quadCount: number;     // how many 4-corner card-aspect quads were seen (debug)
  scryfallId: string | null;
  index: number;
  distance: number;
  gap: number;
};

function hypot(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

// dHash on a single-channel (grayscale) buffer — same grid math as the DB build.
function dhashGray(data: Uint8Array, sw: number, sh: number, size = 16): Uint8Array {
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
        const row = y * sw;
        for (let x = x0; x < x1; x++) { sum += data[row + x]; cnt++; }
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

// Order 4 points to [tl,tr,br,bl] and force a portrait mapping (so a sideways
// card still warps upright). 180° ambiguity is handled later by matching both.
function orderQuadPortrait(pts: Array<{ x: number; y: number }>): Array<{ x: number; y: number }> {
  let tl = pts[0], tr = pts[0], br = pts[0], bl = pts[0];
  let minS = Infinity, maxS = -Infinity, minD = Infinity, maxD = -Infinity;
  for (const p of pts) {
    const s = p.x + p.y, d = p.x - p.y;
    if (s < minS) { minS = s; tl = p; }
    if (s > maxS) { maxS = s; br = p; }
    if (d > maxD) { maxD = d; tr = p; }
    if (d < minD) { minD = d; bl = p; }
  }
  let ord = [tl, tr, br, bl];
  const w = (hypot(ord[0].x, ord[0].y, ord[1].x, ord[1].y) + hypot(ord[3].x, ord[3].y, ord[2].x, ord[2].y)) / 2;
  const h = (hypot(ord[0].x, ord[0].y, ord[3].x, ord[3].y) + hypot(ord[1].x, ord[1].y, ord[2].x, ord[2].y)) / 2;
  if (w > h) ord = [ord[1], ord[2], ord[3], ord[0]]; // rotate so the long side is vertical
  return ord;
}

export async function matchPhotoOpenCV(base64Jpeg: string): Promise<OpenCVMatch | null> {
  const { db, ids } = await prepareScanDb();
  const t0 = Date.now();

  try {
    const srcColor = OpenCV.base64ToMat(base64Jpeg);
    const dims = OpenCV.matToBuffer(srcColor, 'uint8'); // also gives us cols/rows
    const srcW = dims.cols, srcH = dims.rows;
    if (!srcW || !srcH) return null;

    // Downscale for fast, stable edge detection (preserve aspect).
    const scale = PROC_LONG / Math.max(srcW, srcH);
    const pw = Math.max(1, Math.round(srcW * scale));
    const ph = Math.max(1, Math.round(srcH * scale));
    const proc = OpenCV.createObject(ObjectType.Mat, 0, 0, DataTypes.CV_8U);
    OpenCV.invoke('resize', srcColor, proc, OpenCV.createObject(ObjectType.Size, pw, ph), 0, 0, InterpolationFlags.INTER_AREA);

    const gray = OpenCV.createObject(ObjectType.Mat, 0, 0, DataTypes.CV_8U);
    OpenCV.invoke('cvtColor', proc, gray, ColorConversionCodes.COLOR_BGR2GRAY);

    const blur = OpenCV.createObject(ObjectType.Mat, 0, 0, DataTypes.CV_8U);
    OpenCV.invoke('GaussianBlur', gray, blur, OpenCV.createObject(ObjectType.Size, 5, 5), 0);

    const edges = OpenCV.createObject(ObjectType.Mat, 0, 0, DataTypes.CV_8U);
    OpenCV.invoke('Canny', blur, edges, 50, 150);
    // Dilate to close small gaps in the card border so the contour is whole.
    const dil = OpenCV.createObject(ObjectType.Mat, 0, 0, DataTypes.CV_8U);
    const kernel = OpenCV.createObject(ObjectType.Mat, 3, 3, DataTypes.CV_8U, new Array(9).fill(255));
    OpenCV.invoke('dilate', edges, dil,
      kernel, OpenCV.createObject(ObjectType.Point, -1, -1), 1,
      BorderTypes.BORDER_CONSTANT, OpenCV.createObject(ObjectType.Scalar, 0));

    const contours = OpenCV.createObject(ObjectType.MatVector);
    OpenCV.invoke('findContours', dil, contours, RetrievalModes.RETR_EXTERNAL, ContourApproximationModes.CHAIN_APPROX_SIMPLE);
    const cinfo = OpenCV.toJSValue(contours);
    const contourCount = cinfo.array.length;

    const minArea = MIN_AREA_FRAC * pw * ph;
    let bestQuad: Array<{ x: number; y: number }> | null = null;
    let bestArea = 0;
    let quadCount = 0;

    for (let i = 0; i < contourCount; i++) {
      const c = OpenCV.copyObjectFromVector(contours, i);
      const area = OpenCV.invoke('contourArea', c, false).value;
      if (area < minArea) continue;
      const peri = OpenCV.invoke('arcLength', c, true).value;
      const approx = OpenCV.createObject(ObjectType.PointVector);
      OpenCV.invoke('approxPolyDP', c, approx, 0.02 * peri, true);
      const pj = OpenCV.toJSValue(approx);
      if (pj.array.length !== 4) continue;

      const ord = orderQuadPortrait(pj.array);
      const w = (hypot(ord[0].x, ord[0].y, ord[1].x, ord[1].y) + hypot(ord[3].x, ord[3].y, ord[2].x, ord[2].y)) / 2;
      const h = (hypot(ord[0].x, ord[0].y, ord[3].x, ord[3].y) + hypot(ord[1].x, ord[1].y, ord[2].x, ord[2].y)) / 2;
      const ratio = Math.min(w, h) / Math.max(w, h);
      if (ratio < ASPECT_LO || ratio > ASPECT_HI) continue;
      quadCount++;
      if (area > bestArea) { bestArea = area; bestQuad = ord; }
    }

    let warpedBuf: Uint8Array;
    let detected = false;

    if (bestQuad) {
      detected = true;
      const srcPV = OpenCV.createObject(ObjectType.PointVector);
      for (const p of bestQuad) OpenCV.addObjectToVector(srcPV, OpenCV.createObject(ObjectType.Point, Math.round(p.x), Math.round(p.y)));
      const dstPV = OpenCV.createObject(ObjectType.PointVector);
      OpenCV.addObjectToVector(dstPV, OpenCV.createObject(ObjectType.Point, 0, 0));
      OpenCV.addObjectToVector(dstPV, OpenCV.createObject(ObjectType.Point, WARP_W - 1, 0));
      OpenCV.addObjectToVector(dstPV, OpenCV.createObject(ObjectType.Point, WARP_W - 1, WARP_H - 1));
      OpenCV.addObjectToVector(dstPV, OpenCV.createObject(ObjectType.Point, 0, WARP_H - 1));
      const M = OpenCV.invoke('getPerspectiveTransform', srcPV, dstPV, DecompTypes.DECOMP_LU);
      const warped = OpenCV.createObject(ObjectType.Mat, 0, 0, DataTypes.CV_8U);
      OpenCV.invoke('warpPerspective', gray, warped, M, OpenCV.createObject(ObjectType.Size, WARP_W, WARP_H),
        InterpolationFlags.INTER_LINEAR, BorderTypes.BORDER_CONSTANT, OpenCV.createObject(ObjectType.Scalar, 0));
      warpedBuf = OpenCV.matToBuffer(warped, 'uint8').buffer as Uint8Array;
    } else {
      // No quad found — center-crop the gray frame to card aspect as a fallback,
      // so we still return a (weaker) guess and useful diagnostics.
      const cardAspect = WARP_W / WARP_H;
      let cw = pw, ch = Math.round(pw / cardAspect);
      if (ch > ph) { ch = ph; cw = Math.round(ph * cardAspect); }
      const cx = Math.floor((pw - cw) / 2), cy = Math.floor((ph - ch) / 2);
      const roi = OpenCV.createObject(ObjectType.Rect, cx, cy, cw, ch);
      // crop via warpPerspective-free path: use getRectSubPix-like through resize of a submat is complex;
      // simplest: read the whole gray buffer and center-crop in JS.
      const g = OpenCV.matToBuffer(gray, 'uint8');
      const full = g.buffer as Uint8Array;
      const crop = new Uint8Array(cw * ch);
      for (let y = 0; y < ch; y++) {
        const sRow = (cy + y) * pw + cx;
        const dRow = y * cw;
        for (let x = 0; x < cw; x++) crop[dRow + x] = full[sRow + x];
      }
      void roi;
      warpedBuf = crop;
      // reuse crop dims for hashing below by stashing on a temp
      const hash = dhashGray(crop, cw, ch);
      const m0 = matchHash(hash, db);
      const rev = reversed(crop);
      const m180 = matchHash(dhashGray(rev, cw, ch), db);
      const best = m180.distance < m0.distance ? m180 : m0;
      return finalize(false, contourCount, quadCount, best, ids, t0);
    }

    // Hash the warped card at 0° and 180°, match both, keep the better.
    const hash0 = dhashGray(warpedBuf, WARP_W, WARP_H);
    const m0 = matchHash(hash0, db);
    const hash180 = dhashGray(reversed(warpedBuf), WARP_W, WARP_H);
    const m180 = matchHash(hash180, db);
    const best = m180.distance < m0.distance ? m180 : m0;
    return finalize(detected, contourCount, quadCount, best, ids, t0);
  } catch (e) {
    console.warn('[opencv] pipeline error:', e);
    return null;
  } finally {
    OpenCV.clearBuffers();
  }
}

function reversed(buf: Uint8Array): Uint8Array {
  const n = buf.length;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = buf[n - 1 - i];
  return out;
}

function finalize(
  detected: boolean,
  contourCount: number,
  quadCount: number,
  m: { index: number; distance: number; runnerUp: number },
  ids: Uint8Array,
  t0: number,
): OpenCVMatch {
  console.log(`[opencv] detected=${detected} contours=${contourCount} quads=${quadCount} dist=${m.distance} gap=${m.runnerUp - m.distance} ${Date.now() - t0}ms`);
  return {
    detected,
    contourCount,
    quadCount,
    scryfallId: idAt(ids, m.index),
    index: m.index,
    distance: m.distance,
    gap: m.runnerUp - m.distance,
  };
}
