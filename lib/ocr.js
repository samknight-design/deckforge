'use client';

// On-device OCR for Magic card titles — the free, zero-cost scan path.
//
// Two engines, picked at runtime:
//   • Native TextDetector (Chromium / Android) — hardware accelerated, ~tens of ms.
//   • Tesseract.js (WASM, runs in its own Worker) — cross-platform fallback (iOS/Safari).
//
// We OCR only a small, preprocessed *band* of the frame (the title bar), never the
// full 1280×720 image — cropping is the single biggest speed win. Scryfall's fuzzy
// `named` endpoint then corrects the inevitable OCR slips, so "good enough" text wins.

const hasTextDetector = typeof window !== 'undefined' && 'TextDetector' in window;

let tessWorker = null;
let tessLoading = null;

// Reused offscreen canvases (avoid per-read allocation churn).
let workCanvas = null;
function getWorkCanvas(w, h) {
  if (!workCanvas) workCanvas = document.createElement('canvas');
  if (workCanvas.width !== w) workCanvas.width = w;
  if (workCanvas.height !== h) workCanvas.height = h;
  return workCanvas;
}

// Warm the Tesseract worker once, ahead of the first scan, so a read isn't paying
// the (multi-hundred-ms) engine load. No-op when the native detector is available.
export async function warmOcr() {
  if (hasTextDetector) return null;
  if (tessWorker) return tessWorker;
  if (tessLoading) return tessLoading;
  tessLoading = (async () => {
    const { createWorker, PSM } = await import('tesseract.js');
    const worker = await createWorker('eng');
    await worker.setParameters({
      // Card names: letters, spaces, apostrophes, commas, hyphens, slashes.
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

// A Magic card is 63×88mm (aspect ≈ 0.716) — the same ratio as the scanner
// viewfinder, so the user fits the whole card into frame. We reconstruct that
// card rectangle in the centre of the video, then carve out sub-bands.
function cardRect(vw, vh) {
  const aspect = 63 / 88;
  let h = vh * 0.78;          // ~viewfinder fill
  let w = h * aspect;
  if (w > vw * 0.92) { w = vw * 0.92; h = w / aspect; }
  return { x: (vw - w) / 2, y: (vh - h) / 2, w, h };
}

// Title bar sits just below the top edge; skip the right side where the mana cost
// lives so it doesn't pollute the name.
function titleBand(vw, vh) {
  const c = cardRect(vw, vh);
  return {
    sx: c.x + c.w * 0.055,
    sy: c.y + c.h * 0.052,
    sw: c.w * 0.80,
    sh: c.h * 0.105,
  };
}

// Crop → upscale → grayscale → Otsu binarize, with auto-polarity so dark-framed
// cards (light text on black) come out as dark-text-on-light like everything else.
function preprocess(source, band, scale = 3) {
  const cw = Math.max(1, Math.round(band.sw * scale));
  const ch = Math.max(1, Math.round(band.sh * scale));
  const canvas = getWorkCanvas(cw, ch);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, band.sx, band.sy, band.sw, band.sh, 0, 0, cw, ch);

  const img = ctx.getImageData(0, 0, cw, ch);
  const d = img.data;
  const n = cw * ch;
  const gray = new Uint8Array(n);
  const hist = new Uint32Array(256);
  for (let i = 0, j = 0; j < n; i += 4, j++) {
    const g = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;
    gray[j] = g;
    hist[g]++;
  }

  // Otsu threshold.
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0, wB = 0, maxVar = -1, thresh = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = n - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > maxVar) { maxVar = between; thresh = t; }
  }

  let blackCount = 0;
  for (let j = 0; j < n; j++) if (gray[j] < thresh) blackCount++;
  const invert = blackCount > n / 2; // background should be the majority → keep it white

  for (let i = 0, j = 0; j < n; i += 4, j++) {
    let v = gray[j] < thresh ? 0 : 255;
    if (invert) v = 255 - v;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function cleanName(raw) {
  return (raw || '')
    .split('\n')[0]
    .replace(/[^A-Za-z',\-/ ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function nativeRead(canvas) {
  const detector = new window.TextDetector();
  const blocks = await detector.detect(canvas);
  if (!blocks?.length) return '';
  // The title is the longest detected run on the line.
  const best = blocks.reduce((a, b) =>
    (b.rawValue || '').length > (a.rawValue || '').length ? b : a, blocks[0]);
  return best.rawValue || '';
}

async function tesseractRead(canvas) {
  const worker = tessWorker || await warmOcr();
  if (!worker) return { text: '', confidence: 0 };
  const { data } = await worker.recognize(canvas);
  return { text: data?.text || '', confidence: (data?.confidence ?? 0) / 100 };
}

// Read the card title from a live <video> (or any drawable source). Returns the
// cleaned candidate name, a rough 0–1 confidence, the engine used, and ms elapsed.
export async function readTitle(source) {
  const vw = source?.videoWidth || source?.width || 0;
  const vh = source?.videoHeight || source?.height || 0;
  if (!vw || !vh) return { name: '', confidence: 0, engine: 'none', ms: 0 };

  const band = titleBand(vw, vh);
  const canvas = preprocess(source, band);

  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  let name = '', confidence = 0, engine = ocrEngineName();

  if (hasTextDetector) {
    try {
      const raw = await nativeRead(canvas);
      name = cleanName(raw);
      confidence = name.length >= 3 ? 0.75 : 0; // native API gives no score; infer from output
    } catch {
      engine = 'tesseract';
      const r = await tesseractRead(canvas);
      name = cleanName(r.text);
      confidence = r.confidence;
    }
  } else {
    const r = await tesseractRead(canvas);
    name = cleanName(r.text);
    confidence = r.confidence;
  }

  const ms = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0);
  return { name, confidence, engine, ms };
}

// Benchmark helper (Phase 0 gate): run N reads on the current frame, return the
// median ms and the last detected name so the user can judge on-device speed.
export async function benchmarkOcr(source, runs = 5) {
  await warmOcr();
  const times = [];
  let last = { name: '', confidence: 0, engine: ocrEngineName() };
  for (let i = 0; i < runs; i++) {
    last = await readTitle(source);
    times.push(last.ms);
  }
  times.sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)] || 0;
  return { median, min: times[0] || 0, max: times[times.length - 1] || 0, runs, ...last };
}
