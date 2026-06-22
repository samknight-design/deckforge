// On-device embedding scanner: SigLIP2 (ONNX) + a baked-in "matcher" model that does
// the 115k cosine search as a single matmul (onnxruntime native, ~tens of ms vs the
// old 88M-op JS loop that took seconds). Entirely on the phone, no server.
//
// Preprocessing matches open_clip's SigLIP preprocess: square 256×256, normalise
// (x/255 - 0.5)/0.5 = x/127.5 - 1.

import { InferenceSession, Tensor } from 'onnxruntime-react-native';
import { File } from 'expo-file-system';

const BASE = '/storage/emulated/0/Android/data/app.deckforge/files';
const ENCODER_PATH = `${BASE}/siglip.onnx`;
const MATCHER_PATH = `${BASE}/matcher.onnx`;
const CORNER_PATH  = `${BASE}/corner.onnx`;
const CORNER_PEAK_MIN = 0.20; // mean heatmap peak below this → no card in frame
const META_URI = `file://${BASE}/meta.bin`;

export type EmbedMatch = { id: string; name: string; set: string; cn: string; score: number };

let encoder: InferenceSession | null = null;
let matcher: InferenceSession | null = null;
let cornerModel: InferenceSession | null = null;
let N = 0;
let metaCount = 0;
let metaOffsets: Uint32Array | null = null;
let metaBlob: Uint8Array | null = null;
let initPromise: Promise<void> | null = null;

export function isReady(): boolean { return encoder != null && matcher != null; }
export function isCornerReady(): boolean { return cornerModel != null; }

export function initEmbedScan(onStage?: (s: string) => void): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    // CPU execution provider ONLY. XNNPACK ran the fp16 ViT in degraded fp16
    // arithmetic — proven (2026-06-19) to drop cosine ~0.07-0.10 vs desktop and
    // flip borderline matches (Disdainful Stroke → Satsuki). The plain CPU EP
    // upcasts fp16→fp32 internally, matching the desktop result exactly. Slightly
    // slower per scan, but correct. (NNAPI was already a wash — ViT ops fall back.)
    onStage?.('Loading encoder…');
    // CPU EP for accuracy. (Tried intraOpNumThreads=4 to speed the ~500ms ViT pass — it was
    // SLOWER: it contends with the camera-thread TFLite detector. Default threading wins.)
    encoder = await InferenceSession.create(ENCODER_PATH, { executionProviders: ['cpu'] });
    onStage?.('Loading matcher…');
    matcher = await InferenceSession.create(MATCHER_PATH);

    onStage?.('Loading corner model…');
    try {
      cornerModel = await InferenceSession.create(CORNER_PATH);
    } catch (e) {
      console.warn('[corner] model load failed — warp will use centre-crop fallback:', e);
    }

    onStage?.('Loading card names…');
    const mb = await new File(META_URI).bytes();
    const dv = new DataView(mb.buffer, mb.byteOffset, mb.byteLength);
    metaCount = dv.getUint32(0, true);
    metaOffsets = new Uint32Array(metaCount + 1);
    for (let i = 0; i <= metaCount; i++) metaOffsets[i] = dv.getUint32(4 + i * 4, true);
    metaBlob = mb.subarray(4 + (metaCount + 1) * 4);
    N = metaCount;
    onStage?.(`Ready · ${N} cards`);
  })();
  return initPromise;
}

function metaAt(i: number): { id: string; name: string; set: string; cn: string } {
  const s = metaOffsets![i], e = metaOffsets![i + 1];
  const str = new TextDecoder().decode(metaBlob!.subarray(s, e));
  const [id, name, set, cn] = str.split('\t');
  return { id, name, set, cn };
}

// rgba: Uint8Array of a SIZE×SIZE colour warp (RGBA). Returns top-k matches.
export async function embedAndMatch(rgba: Uint8Array, size = 256, k = 5): Promise<{ matches: EmbedMatch[]; embMs: number; matchMs: number }> {
  if (!encoder || !matcher) throw new Error('embedScan not initialised');
  const px = size * size;
  const data = new Float32Array(3 * px);
  for (let p = 0; p < px; p++) {
    data[p]          = rgba[p * 4]     / 127.5 - 1; // R plane
    data[px + p]     = rgba[p * 4 + 1] / 127.5 - 1; // G plane
    data[2 * px + p] = rgba[p * 4 + 2] / 127.5 - 1; // B plane
  }
  const t0 = Date.now();
  const enc = await encoder.run({ image: new Tensor('float32', data, [1, 3, size, size]) });
  const embTensor = enc.embedding; // [1,768], already L2-normalised by the export wrapper
  const embMs = Date.now() - t0;

  const t1 = Date.now();
  const out = await matcher.run({ embedding: embTensor });
  const scores = out.scores.data as Float32Array; // [N] cosine scores
  // top-k argmax over N (cheap: N comparisons, not N*768)
  const topIdx = new Int32Array(k).fill(-1);
  const topScore = new Float32Array(k).fill(-Infinity);
  for (let i = 0; i < N; i++) {
    const s = scores[i];
    if (s > topScore[k - 1]) {
      let j = k - 1;
      while (j > 0 && topScore[j - 1] < s) { topScore[j] = topScore[j - 1]; topIdx[j] = topIdx[j - 1]; j--; }
      topScore[j] = s; topIdx[j] = i;
    }
  }
  const matchMs = Date.now() - t1;
  const matches: EmbedMatch[] = [];
  for (let r = 0; r < k; r++) if (topIdx[r] >= 0) matches.push({ ...metaAt(topIdx[r]), score: Math.round(topScore[r] * 1e4) / 1e4 });
  return { matches, embMs, matchMs };
}

// buf: Uint8Array of a size×size image, interleaved with `channels` bytes per pixel
// in R,G,B,(A) order (channels=3 for RGB from the resize plugin, 4 for RGBA).
// Returns 4 corners [[tl_x,tl_y],[tr_x,tr_y],[br_x,br_y],[bl_x,bl_y]] in pixel coords
// within the size image (canonical portrait order matching orderQuadPortraitW), or
// null if the corner model is not loaded.
export async function detectCorners(buf: Uint8Array, size = 256, channels = 4): Promise<number[][] | null> {
  if (!cornerModel) return null;
  const px = size * size;
  const data = new Float32Array(3 * px);
  // ImageNet normalisation: (value/255 - mean) / std  — matches training preprocessing
  const meanR = 0.485, meanG = 0.456, meanB = 0.406;
  const stdR  = 0.229, stdG  = 0.224, stdB  = 0.225;
  for (let p = 0; p < px; p++) {
    const o = p * channels;
    data[p]          = (buf[o]     / 255 - meanR) / stdR; // R plane
    data[px + p]     = (buf[o + 1] / 255 - meanG) / stdG; // G plane
    data[2 * px + p] = (buf[o + 2] / 255 - meanB) / stdB; // B plane
  }
  const out = await cornerModel.run({
    image: new Tensor('float32', data, [1, 3, size, size]),
  });
  // Heatmap-keypoint output: [1,4,H,W] raw heatmaps, one channel per corner
  // (tl,tr,br,bl). Decode each = peak location (sub-pixel weighted centroid) +
  // peak value as a detection confidence. Spatial peaks localize far tighter than
  // the old global-pool coord regression.
  const hm = out.heatmaps.data as Float32Array;
  const dims = out.heatmaps.dims; // [1,4,H,W]
  const H = dims[2], W = dims[3];
  const corners: number[][] = [];
  let peakSum = 0;
  for (let c = 0; c < 4; c++) {
    const base = c * H * W;
    let mi = 0, mv = -Infinity;
    for (let k = 0; k < H * W; k++) { const v = hm[base + k]; if (v > mv) { mv = v; mi = k; } }
    const py = (mi / W) | 0, pxk = mi % W;
    // 5×5 weighted centroid around the peak → sub-pixel corner
    let sw = 0, sx = 0, sy = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const yy = py + dy, xx = pxk + dx;
      if (yy < 0 || yy >= H || xx < 0 || xx >= W) continue;
      const v = hm[base + yy * W + xx];
      if (v > 0) { sw += v; sx += v * xx; sy += v * yy; }
    }
    const cx = sw > 0 ? sx / sw : pxk;
    const cy = sw > 0 ? sy / sw : py;
    corners.push([(cx / (W - 1)) * size, (cy / (H - 1)) * size]);
    peakSum += mv;
  }
  // Presence gate: flat heatmaps (no card in frame) → low peaks → no detection.
  if (peakSum / 4 < CORNER_PEAK_MIN) return null;
  return corners;
}
