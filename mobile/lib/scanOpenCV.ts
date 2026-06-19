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
import { detectCorners } from './embedScan';

const PROC_LONG = 600;   // process at this long-side resolution (speed vs detail)
const WARP_W = 146;      // warp output size — mirrors Scryfall 'small' source
const WARP_H = 204;
const CWARP_W = 400;     // larger COLOUR warp for the embedding match server (more detail)
const CWARP_H = 560;
const MIN_AREA_FRAC = 0.08; // card quad must cover ≥8% of the frame
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
  error?: string;        // set if the native pipeline threw — surfaced on screen
};

function hypot(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

// 4 corners of a (possibly rotated) rectangle from minAreaRect's center/size/angle.
function rectCorners(r: { centerX: number; centerY: number; width: number; height: number; angle: number }): Array<{ x: number; y: number }> {
  const rad = (r.angle * Math.PI) / 180;
  const c = Math.cos(rad), s = Math.sin(rad);
  const hw = r.width / 2, hh = r.height / 2;
  return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([dx, dy]) => ({
    x: r.centerX + dx * c - dy * s,
    y: r.centerY + dx * s + dy * c,
  }));
}

// Art-region crop — MUST stay byte-identical to dhashFromImageData() in
// web/scripts/build-full-hashes.mjs (same constants + same cell math).
const ART_X0 = 0.07, ART_X1 = 0.93, ART_Y0 = 0.11, ART_Y1 = 0.58;

// dHash over the card's ART REGION on a single-channel (grayscale) buffer.
// Byte-identical math to the DB build (which uses the same crop on RGBA luma).
export function dhashGray(data: Uint8Array, sw: number, sh: number, size = 16): Uint8Array {
  return dhashGrayCrop(data, sw, sh, ART_X0, ART_X1, ART_Y0, ART_Y1, size);
}

// Same dHash, but with an explicit art-crop window. Used by the multi-crop
// matcher to absorb small warp misalignment (a loose tier-2 detection leaves a
// margin/shift around the card, so the fixed crop lands on shifted pixels). The
// DB stays fixed; we search query-side for the crop that best lines up.
export function dhashGrayCrop(
  data: Uint8Array, sw: number, sh: number,
  x0f: number, x1f: number, y0f: number, y1f: number, size = 16,
): Uint8Array {
  const ax0 = Math.round(x0f * sw), ax1 = Math.round(x1f * sw);
  const ay0 = Math.round(y0f * sh), ay1 = Math.round(y1f * sh);
  const rw = ax1 - ax0, rh = ay1 - ay0;
  const gw = size + 1, gh = size;
  const grid = new Float64Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) {
    const y0 = ay0 + Math.floor((gy * rh) / gh);
    const y1 = ay0 + Math.max(Math.floor((gy * rh) / gh) + 1, Math.floor(((gy + 1) * rh) / gh));
    for (let gx = 0; gx < gw; gx++) {
      const x0 = ax0 + Math.floor((gx * rw) / gw);
      const x1 = ax0 + Math.max(Math.floor((gx * rw) / gw) + 1, Math.floor(((gx + 1) * rw) / gw));
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

// Candidate art-crop windows. The first is the byte-identical DB crop; the rest
// are small inset/outset/vertical nudges that compensate for a loose warp's
// margin/shift. Matching tries all of them (× 0°/180°) and keeps the lowest
// distance — turning a near-miss (e.g. dist 75 from a slightly-off warp) into a hit.
const ART_CROPS: ReadonlyArray<readonly [number, number, number, number]> = [
  [0.07, 0.93, 0.11, 0.58], // base — DB-identical
  [0.10, 0.90, 0.14, 0.555], // inset (margin around the card → sample tighter)
  [0.04, 0.96, 0.075, 0.605], // outset (warp clipped the card → sample wider)
  [0.07, 0.93, 0.085, 0.555], // art window nudged up
  [0.07, 0.93, 0.135, 0.605], // art window nudged down
];

export type MultiCropMatch = { index: number; distance: number; runnerUp: number };

// Match a warped grayscale card against the DB, tolerant to small warp
// misalignment: tries candidate crops at 0° and 180°, keeps the best.
// PERF: the base crop runs first; if it's already confident (≤ acceptDist) we
// return after just 2 scans — so clean cards stay instant and only borderline
// cards (loose warp on dark/borderless art) pay for the extra crops.
export function bestMatchMultiCrop(
  buf: Uint8Array, w: number, h: number,
  db: { count: number; bytesPerHash: number; flat: Uint8Array },
  acceptDist = 72,
): MultiCropMatch {
  const rev = reversed(buf);
  const [bx0, bx1, by0, by1] = ART_CROPS[0];
  let best = matchHash(dhashGrayCrop(buf, w, h, bx0, bx1, by0, by1), db) as MultiCropMatch;
  const b1 = matchHash(dhashGrayCrop(rev, w, h, bx0, bx1, by0, by1), db);
  if (b1.distance < best.distance) best = b1;
  if (best.distance <= acceptDist) return best; // clean card → done in 2 scans

  for (let i = 1; i < ART_CROPS.length; i++) {
    const [x0, x1, y0, y1] = ART_CROPS[i];
    const m0 = matchHash(dhashGrayCrop(buf, w, h, x0, x1, y0, y1), db);
    if (m0.distance < best.distance) best = m0;
    const m1 = matchHash(dhashGrayCrop(rev, w, h, x0, x1, y0, y1), db);
    if (m1.distance < best.distance) best = m1;
  }
  return best;
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

function errResult(msg: string): OpenCVMatch {
  return { detected: false, contourCount: 0, quadCount: 0, scryfallId: null, index: -1, distance: -1, gap: -1, error: msg };
}

export async function matchPhotoOpenCV(base64Jpeg: string): Promise<OpenCVMatch> {
  const { db, ids } = await prepareScanDb();
  const t0 = Date.now();

  try {
    const srcColor = OpenCV.base64ToMat(base64Jpeg);
    const dims = OpenCV.matToBuffer(srcColor, 'uint8'); // also gives us cols/rows
    const srcW = dims.cols, srcH = dims.rows;
    if (!srcW || !srcH) return errResult('decode failed (0x0 image)');

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
    OpenCV.invoke('Canny', blur, edges, 30, 90);
    // Thicken edges so a card's broken border closes into ONE solid contour.
    const dil = OpenCV.createObject(ObjectType.Mat, 0, 0, DataTypes.CV_8U);
    const kernel = OpenCV.createObject(ObjectType.Mat, 5, 5, DataTypes.CV_8U, new Array(25).fill(1));
    OpenCV.invoke('dilate', edges, dil, kernel, OpenCV.createObject(ObjectType.Point, -1, -1), 2,
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
      // Smallest enclosing (possibly rotated) rectangle — robust to imperfect contours.
      const rr = OpenCV.invoke('minAreaRect', c);
      const r = OpenCV.toJSValue(rr) as { centerX: number; centerY: number; width: number; height: number; angle: number };
      const rw = r.width, rh = r.height;
      if (rw <= 1 || rh <= 1) continue;
      const ratio = Math.min(rw, rh) / Math.max(rw, rh);
      if (ratio < ASPECT_LO || ratio > ASPECT_HI) continue;
      const rectArea = rw * rh;
      if (area < 0.6 * rectArea) continue; // contour must mostly fill its box (a card does)
      quadCount++;
      if (rectArea > bestArea) { bestArea = rectArea; bestQuad = orderQuadPortrait(rectCorners(r)); }
    }

    let warpedBuf: Uint8Array;
    let detected = false;

    if (bestQuad) {
      detected = true;
      // getPerspectiveTransform requires Point2f (float) vectors, NOT integer
      // Point vectors — passing the wrong kind throws "not a Point2fVector".
      const srcPV = OpenCV.createObject(ObjectType.Point2fVector, [
        OpenCV.createObject(ObjectType.Point2f, bestQuad[0].x, bestQuad[0].y),
        OpenCV.createObject(ObjectType.Point2f, bestQuad[1].x, bestQuad[1].y),
        OpenCV.createObject(ObjectType.Point2f, bestQuad[2].x, bestQuad[2].y),
        OpenCV.createObject(ObjectType.Point2f, bestQuad[3].x, bestQuad[3].y),
      ]);
      const dstPV = OpenCV.createObject(ObjectType.Point2fVector, [
        OpenCV.createObject(ObjectType.Point2f, 0, 0),
        OpenCV.createObject(ObjectType.Point2f, WARP_W - 1, 0),
        OpenCV.createObject(ObjectType.Point2f, WARP_W - 1, WARP_H - 1),
        OpenCV.createObject(ObjectType.Point2f, 0, WARP_H - 1),
      ]);
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
    const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    console.warn('[opencv] pipeline error:', msg);
    return errResult(msg);
  } finally {
    try { OpenCV.clearBuffers(); } catch {}
  }
}

export function reversed(buf: Uint8Array): Uint8Array {
  const n = buf.length;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = buf[n - 1 - i];
  return out;
}

// Detect the card using the learned corner model and return a tight COLOUR warp as
// RGBA pixels for the on-device embedding match. Always outputs 256×256 (the corner
// model's native resolution). The outW/outH params are kept for API compat but ignored.
export type ColorWarp = { rgba: number[]; w: number; h: number; detected: boolean };
export async function warpPhotoColor(base64Jpeg: string, _outW = CWARP_W, _outH = CWARP_H): Promise<ColorWarp | null> {
  const SIZE = 256;
  try {
    const srcColor = OpenCV.base64ToMat(base64Jpeg);
    const dims = OpenCV.matToBuffer(srcColor, 'uint8');
    const srcW = dims.cols, srcH = dims.rows;
    if (!srcW || !srcH) return null;

    // Center-square crop → resize to 256×256 in one warpPerspective call.
    // A naive resize squishes the full camera frame (e.g. 4032×3024) into a 1:1
    // square, distorting the card art enough to break the embedding match.
    const sq = Math.min(srcW, srcH);
    const sqX = (srcW - sq) / 2;
    const sqY = (srcH - sq) / 2;
    const cropSrc = OpenCV.createObject(ObjectType.Point2fVector, [
      OpenCV.createObject(ObjectType.Point2f, sqX,      sqY),
      OpenCV.createObject(ObjectType.Point2f, sqX + sq, sqY),
      OpenCV.createObject(ObjectType.Point2f, sqX + sq, sqY + sq),
      OpenCV.createObject(ObjectType.Point2f, sqX,      sqY + sq),
    ]);
    const cropDst = OpenCV.createObject(ObjectType.Point2fVector, [
      OpenCV.createObject(ObjectType.Point2f, 0,        0),
      OpenCV.createObject(ObjectType.Point2f, SIZE - 1, 0),
      OpenCV.createObject(ObjectType.Point2f, SIZE - 1, SIZE - 1),
      OpenCV.createObject(ObjectType.Point2f, 0,        SIZE - 1),
    ]);
    const Mcrop = OpenCV.invoke('getPerspectiveTransform', cropSrc, cropDst, DecompTypes.DECOMP_LU);
    const mat256 = OpenCV.createObject(ObjectType.Mat, 0, 0, DataTypes.CV_8U);
    OpenCV.invoke('warpPerspective', srcColor, mat256, Mcrop,
      OpenCV.createObject(ObjectType.Size, SIZE, SIZE),
      InterpolationFlags.INTER_AREA, BorderTypes.BORDER_CONSTANT,
      OpenCV.createObject(ObjectType.Scalar, 0));

    // Extract BGR bytes and convert to RGBA for detectCorners().
    const bgrBuf = OpenCV.matToBuffer(mat256, 'uint8');
    const bgr = bgrBuf.buffer as Uint8Array; // interleaved BGR, SIZE*SIZE*3
    const n = SIZE * SIZE;
    const rgba = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
      rgba[i * 4]     = bgr[i * 3 + 2]; // R ← BGR[2]
      rgba[i * 4 + 1] = bgr[i * 3 + 1]; // G ← BGR[1]
      rgba[i * 4 + 2] = bgr[i * 3];     // B ← BGR[0]
      rgba[i * 4 + 3] = 255;
    }

    // Corner model: 4 corners in canonical portrait order [tl,tr,br,bl], [0,SIZE] px.
    let bestQuad: Array<{ x: number; y: number }> | null = null;
    let detected = false;
    const corners = await detectCorners(rgba, SIZE);
    if (corners) {
      bestQuad = corners.map(([x, y]) => ({ x, y }));
      detected = true;
    }

    // Fallback: centre-crop at card aspect when corner model is not loaded or returns null.
    if (!bestQuad) {
      const aspect = 63 / 88; // card w/h
      const cw = SIZE * aspect;
      const cx = (SIZE - cw) / 2;
      bestQuad = [
        { x: cx,      y: 0 },
        { x: cx + cw, y: 0 },
        { x: cx + cw, y: SIZE },
        { x: cx,      y: SIZE },
      ];
    }

    // Warp the 256×256 colour image to a flat card using the 4 detected corners.
    const srcPV = OpenCV.createObject(ObjectType.Point2fVector, [
      OpenCV.createObject(ObjectType.Point2f, bestQuad[0].x, bestQuad[0].y),
      OpenCV.createObject(ObjectType.Point2f, bestQuad[1].x, bestQuad[1].y),
      OpenCV.createObject(ObjectType.Point2f, bestQuad[2].x, bestQuad[2].y),
      OpenCV.createObject(ObjectType.Point2f, bestQuad[3].x, bestQuad[3].y),
    ]);
    const dstPV = OpenCV.createObject(ObjectType.Point2fVector, [
      OpenCV.createObject(ObjectType.Point2f, 0,        0),
      OpenCV.createObject(ObjectType.Point2f, SIZE - 1, 0),
      OpenCV.createObject(ObjectType.Point2f, SIZE - 1, SIZE - 1),
      OpenCV.createObject(ObjectType.Point2f, 0,        SIZE - 1),
    ]);
    const M = OpenCV.invoke('getPerspectiveTransform', srcPV, dstPV, DecompTypes.DECOMP_LU);
    const warped = OpenCV.createObject(ObjectType.Mat, 0, 0, DataTypes.CV_8U);
    OpenCV.invoke('warpPerspective', mat256, warped, M,
      OpenCV.createObject(ObjectType.Size, SIZE, SIZE),
      InterpolationFlags.INTER_CUBIC, BorderTypes.BORDER_CONSTANT,
      OpenCV.createObject(ObjectType.Scalar, 0));

    // Convert warped BGR → RGBA output.
    const warpedBuf = OpenCV.matToBuffer(warped, 'uint8');
    const wbgr = warpedBuf.buffer as Uint8Array;
    const rgbaOut: number[] = new Array(n * 4);
    for (let i = 0; i < n; i++) {
      rgbaOut[i * 4]     = wbgr[i * 3 + 2]; // R
      rgbaOut[i * 4 + 1] = wbgr[i * 3 + 1]; // G
      rgbaOut[i * 4 + 2] = wbgr[i * 3];     // B
      rgbaOut[i * 4 + 3] = 255;
    }
    return { rgba: rgbaOut, w: SIZE, h: SIZE, detected };
  } catch (e) {
    console.warn('[opencv] warpPhotoColor error:', e);
    return null;
  } finally {
    try { OpenCV.clearBuffers(); } catch {}
  }
}

// Warp a 4-corner quad out of an in-memory interleaved image buffer to a flat
// `outSize`×`outSize` RGBA crop, ready for embedAndMatch. Used by the live corner-
// model path: the corner model gives the quad, this flattens the card to feed the
// encoder. `buf` is srcSize×srcSize with `channels` bytes/pixel in R,G,B,(A) order;
// `quad` is [[tl],[tr],[br],[bl]] in srcSize pixel coords.
export function warpQuadColor(
  buf: Uint8Array, srcSize: number, channels: number,
  quad: number[][], outSize = 256,
): Uint8Array {
  try {
    const srcMat = OpenCV.bufferToMat('uint8', srcSize, srcSize, channels as 1 | 3 | 4, buf);
    const srcPV = OpenCV.createObject(ObjectType.Point2fVector, [
      OpenCV.createObject(ObjectType.Point2f, quad[0][0], quad[0][1]),
      OpenCV.createObject(ObjectType.Point2f, quad[1][0], quad[1][1]),
      OpenCV.createObject(ObjectType.Point2f, quad[2][0], quad[2][1]),
      OpenCV.createObject(ObjectType.Point2f, quad[3][0], quad[3][1]),
    ]);
    const dstPV = OpenCV.createObject(ObjectType.Point2fVector, [
      OpenCV.createObject(ObjectType.Point2f, 0,           0),
      OpenCV.createObject(ObjectType.Point2f, outSize - 1, 0),
      OpenCV.createObject(ObjectType.Point2f, outSize - 1, outSize - 1),
      OpenCV.createObject(ObjectType.Point2f, 0,           outSize - 1),
    ]);
    const M = OpenCV.invoke('getPerspectiveTransform', srcPV, dstPV, DecompTypes.DECOMP_LU);
    const warped = OpenCV.createObject(ObjectType.Mat, 0, 0, DataTypes.CV_8U);
    OpenCV.invoke('warpPerspective', srcMat, warped, M, OpenCV.createObject(ObjectType.Size, outSize, outSize),
      InterpolationFlags.INTER_CUBIC, BorderTypes.BORDER_CONSTANT, OpenCV.createObject(ObjectType.Scalar, 0));
    const wbuf = OpenCV.matToBuffer(warped, 'uint8').buffer as Uint8Array; // outSize²×channels, R,G,B,(A)
    const n = outSize * outSize;
    const rgba = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
      rgba[i * 4]     = wbuf[i * channels];     // R
      rgba[i * 4 + 1] = wbuf[i * channels + 1]; // G
      rgba[i * 4 + 2] = wbuf[i * channels + 2]; // B
      rgba[i * 4 + 3] = 255;
    }
    return rgba;
  } finally {
    try { OpenCV.clearBuffers(); } catch {}
  }
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
