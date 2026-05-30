'use client';

// On-device OCR for Magic card titles — the free, zero-cost scan path.
//
// Two engines, picked at runtime:
//   • Native TextDetector (Chromium / Android) — hardware accelerated, ~tens of ms.
//   • Tesseract.js (WASM, runs in its own Worker) — cross-platform fallback (iOS/Safari).
//
// Crucial: we map the on-screen *viewfinder* rectangle back to source-video pixels
// (inverse object-cover), so we OCR exactly what the user framed — not a blind guess
// at the video buffer, which drifts onto the bottom copyright line. Scryfall's fuzzy
// `named` endpoint then corrects OCR slips, so "good enough" text wins.

const hasTextDetector = typeof window !== 'undefined' && 'TextDetector' in window;

// Default viewfinder size (matches the rectangle drawn in Scanner.js).
const VF_W = 232;
const VF_H = 324;

let tessWorker = null;
let tessLoading = null;

let workCanvas = null;
function getWorkCanvas(w, h) {
  if (!workCanvas) workCanvas = document.createElement('canvas');
  if (workCanvas.width !== w) workCanvas.width = w;
  if (workCanvas.height !== h) workCanvas.height = h;
  return workCanvas;
}

export async function warmOcr() {
  if (hasTextDetector) return null;
  if (tessWorker) return tessWorker;
  if (tessLoading) return tessLoading;
  tessLoading = (async () => {
    const { createWorker, PSM } = await import('tesseract.js');
    const worker = await createWorker('eng');
    await worker.setParameters({
      tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz ',-/",
      tessedit_pageseg_mode: PSM?.SINGLE_LINE ?? '7',
    });
    tessWorker = worker;
    tessLoading = null;
    return worker;
  })();
  return tessLoading;
}

export function teardownOcr() {
  if (tessWorker) { try { tessWorker.terminate(); } catch {} tessWorker = null; }
  tessLoading = null;
}

export function ocrEngineName() {
  return hasTextDetector ? 'native' : 'tesseract';
}

// Map the centred viewfinder box (display space) back to source-video pixels,
// undoing the object-cover scale+crop. This is what makes the crop land on the
// card the user actually framed, regardless of screen/camera aspect ratio.
function cardSourceRect(video, vfW = VF_W, vfH = VF_H) {
  const vW = video.videoWidth, vH = video.videoHeight;
  if (!vW || !vH) return null;
  const box = video.getBoundingClientRect();
  const dispW = box.width || vW;
  const dispH = box.height || vH;

  const scale = Math.max(dispW / vW, dispH / vH); // object-cover
  const cropX = (vW * scale - dispW) / 2;         // cut off each side (display px)
  const cropY = (vH * scale - dispH) / 2;

  // Viewfinder, centred in the element, in display space.
  const vfX = (dispW - vfW) / 2;
  const vfY = (dispH - vfH) / 2;

  const toSrc = (dx, dy) => ({ x: (dx + cropX) / scale, y: (dy + cropY) / scale });
  const tl = toSrc(vfX, vfY);
  const br = toSrc(vfX + vfW, vfY + vfH);

  const x = Math.max(0, tl.x);
  const y = Math.max(0, tl.y);
  return { x, y, w: Math.min(vW - x, br.x - tl.x), h: Math.min(vH - y, br.y - tl.y) };
}

// The title bar: top slice of the card, minus the right edge where the mana cost sits.
function titleBandOf(card) {
  return {
    x: card.x + card.w * 0.05,
    y: card.y + card.h * 0.04,
    w: card.w * 0.74,
    h: card.h * 0.11,
  };
}

// Draw a source region into the work canvas, scaled so the target width ≈ destW.
function drawRegion(source, r, destW) {
  const scale = Math.max(0.1, destW / r.w);
  const cw = Math.max(1, Math.round(r.w * scale));
  const ch = Math.max(1, Math.round(r.h * scale));
  const canvas = getWorkCanvas(cw, ch);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, r.x, r.y, r.w, r.h, 0, 0, cw, ch);
  return { canvas, ctx, cw, ch };
}

// Grayscale → Otsu binarize, auto-polarity (background forced light) — for Tesseract.
function binarize(ctx, cw, ch) {
  const img = ctx.getImageData(0, 0, cw, ch);
  const d = img.data;
  const n = cw * ch;
  const gray = new Uint8Array(n);
  const hist = new Uint32Array(256);
  for (let i = 0, j = 0; j < n; i += 4, j++) {
    const g = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;
    gray[j] = g; hist[g]++;
  }
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0, wB = 0, maxVar = -1, thresh = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = n - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const between = wB * wF * (sumB / wB - (sum - sumB) / wF) ** 2;
    if (between > maxVar) { maxVar = between; thresh = t; }
  }
  let blackCount = 0;
  for (let j = 0; j < n; j++) if (gray[j] < thresh) blackCount++;
  const invert = blackCount > n / 2;
  for (let i = 0, j = 0; j < n; i += 4, j++) {
    let v = gray[j] < thresh ? 0 : 255;
    if (invert) v = 255 - v;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
}

function cleanName(raw) {
  return (raw || '')
    .split('\n')[0]
    .replace(/[^A-Za-z',\-/ ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// From all detected text blocks, join the ones on the top-most line — that's the
// title. Structurally skips the type line, rules text and bottom copyright.
function pickTopLine(blocks) {
  const cand = (blocks || []).filter((b) => (b.rawValue || '').replace(/\s/g, '').length >= 2);
  if (!cand.length) return '';
  const minY = Math.min(...cand.map((b) => b.boundingBox.y));
  const heights = cand.map((b) => b.boundingBox.height);
  const lineThresh = Math.max(...heights) * 0.8;
  return cand
    .filter((b) => b.boundingBox.y <= minY + lineThresh)
    .sort((a, b) => a.boundingBox.x - b.boundingBox.x)
    .map((b) => b.rawValue)
    .join(' ');
}

async function nativeRead(source, card) {
  // Detect across the whole card region (not a tight band) and keep the top line —
  // robust to the title sitting a little higher/lower than a fixed band guess.
  const { canvas } = drawRegion(source, card, 640);
  const detector = new window.TextDetector();
  const blocks = await detector.detect(canvas);
  return pickTopLine(blocks);
}

async function tesseractRead(source, card) {
  const worker = tessWorker || await warmOcr();
  if (!worker) return { text: '', confidence: 0 };
  const band = titleBandOf(card);
  const { canvas, ctx, cw, ch } = drawRegion(source, band, Math.min(900, band.w * 3));
  binarize(ctx, cw, ch);
  const { data } = await worker.recognize(canvas);
  return { text: data?.text || '', confidence: (data?.confidence ?? 0) / 100 };
}

// Read the card title from a live <video>. Returns the cleaned candidate name, a
// rough 0–1 confidence, the engine used, and ms elapsed.
export async function readTitle(source, opts = {}) {
  const card = cardSourceRect(source, opts.vfW ?? VF_W, opts.vfH ?? VF_H);
  if (!card || card.w < 4 || card.h < 4) return { name: '', confidence: 0, engine: 'none', ms: 0 };

  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  let name = '', confidence = 0, engine = ocrEngineName();

  if (hasTextDetector) {
    try {
      name = cleanName(await nativeRead(source, card));
      confidence = name.length >= 3 ? 0.75 : 0;
    } catch {
      engine = 'tesseract';
      const r = await tesseractRead(source, card);
      name = cleanName(r.text);
      confidence = r.confidence;
    }
  } else {
    const r = await tesseractRead(source, card);
    name = cleanName(r.text);
    confidence = r.confidence;
  }

  const ms = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0);
  return { name, confidence, engine, ms };
}

// Debug (Phase 0): return a data-URL of the exact card region we OCR, so the crop
// can be eyeballed on-device. Separate canvas so it doesn't clobber the work one.
export function previewCrop(source, opts = {}) {
  const card = cardSourceRect(source, opts.vfW ?? VF_W, opts.vfH ?? VF_H);
  if (!card || card.w < 4) return null;
  const c = document.createElement('canvas');
  const scale = 300 / card.w;
  c.width = Math.round(card.w * scale);
  c.height = Math.round(card.h * scale);
  const ctx = c.getContext('2d');
  ctx.drawImage(source, card.x, card.y, card.w, card.h, 0, 0, c.width, c.height);
  // Mark the title band we hand to Tesseract.
  const b = titleBandOf(card);
  ctx.strokeStyle = '#10b981';
  ctx.lineWidth = 2;
  ctx.strokeRect((b.x - card.x) * scale, (b.y - card.y) * scale, b.w * scale, b.h * scale);
  return c.toDataURL('image/jpeg', 0.7);
}

// Benchmark helper (Phase 0 gate): run N reads on the current frame, return median
// ms and the last detected name so the user can judge on-device speed + accuracy.
export async function benchmarkOcr(source, runs = 5, opts = {}) {
  await warmOcr();
  const times = [];
  let last = { name: '', confidence: 0, engine: ocrEngineName() };
  for (let i = 0; i < runs; i++) {
    last = await readTitle(source, opts);
    times.push(last.ms);
  }
  times.sort((a, b) => a - b);
  const preview = previewCrop(source, opts);
  return { median: times[Math.floor(times.length / 2)] || 0, min: times[0] || 0, max: times[times.length - 1] || 0, runs, preview, ...last };
}
