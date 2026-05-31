'use client';

// Card detection — two implementations chosen at runtime:
//
//   1) opencv.js (preferred): proper contour finding + perspective warp.
//      Robust to tilt; warps the card into a canonical upright rectangle which
//      eliminates the dHash alignment sensitivity.
//   2) Lightweight gradient edge-projection (fallback): runs immediately, no
//      download, no WASM, no surprises. Used while opencv loads and when opencv
//      fails to load — so the scanner ALWAYS works, even if opencv is unreachable.
//
// Critical reliability rules:
//   • warmCv() has a hard timeout and never throws into the UI.
//   • detectAndWarp() never throws — any opencv error falls back to gradient.
//   • All cv.Mat allocations are wrapped so a failure can't leak memory and
//     wedge subsequent reads.

const CV_SRC = 'https://docs.opencv.org/4.x/opencv.js';
const CV_TIMEOUT_MS = 8000; // give up if opencv hasn't initialised by this point

let cvState = 'idle'; // 'idle' | 'loading' | 'ready' | 'failed'
let cvPromise = null;

// Load opencv.js lazily, but with a hard timeout and a 'failed' terminal state
// so callers can stop waiting. Never rejects — failure is reported via state.
export function warmCv() {
  if (typeof window === 'undefined') return Promise.resolve(null);
  if (cvState === 'ready') return Promise.resolve(window.cv);
  if (cvState === 'failed') return Promise.resolve(null);
  if (cvPromise) return cvPromise;
  cvState = 'loading';
  cvPromise = new Promise((resolve) => {
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      cvState = ok ? 'ready' : 'failed';
      resolve(ok ? window.cv : null);
    };
    const timer = setTimeout(() => finish(false), CV_TIMEOUT_MS);

    try {
      window.Module = window.Module || {};
      const prev = window.Module.onRuntimeInitialized;
      window.Module.onRuntimeInitialized = () => {
        try { prev?.(); } catch {}
        clearTimeout(timer);
        finish(!!(window.cv && window.cv.Mat));
      };
      if (!document.querySelector('script[data-cv="1"]')) {
        const s = document.createElement('script');
        s.src = CV_SRC;
        s.async = true;
        s.dataset.cv = '1';
        s.onerror = () => { clearTimeout(timer); finish(false); };
        document.head.appendChild(s);
      }
    } catch {
      clearTimeout(timer);
      finish(false);
    }
  });
  return cvPromise;
}

export function cvStatus() { return cvState; }

// ── Lightweight gradient fallback ───────────────────────────────────────────
// (This is what we shipped last round and got 70% on. It's the floor.)

function strongestPeak(arr, lo, hi) {
  let bi = lo, bv = -1;
  for (let i = lo; i < hi; i++) if (arr[i] > bv) { bv = arr[i]; bi = i; }
  return { i: bi, v: bv };
}

function gradientDetect(video, vf) {
  const vW = video.videoWidth, vH = video.videoHeight;
  const mx = vf.w * 0.12, my = vf.h * 0.12;
  const roi = {
    x: Math.max(0, vf.x - mx),
    y: Math.max(0, vf.y - my),
  };
  roi.w = Math.min(vW - roi.x, vf.w + 2 * mx);
  roi.h = Math.min(vH - roi.y, vf.h + 2 * my);

  const DW = 160;
  const scale = DW / roi.w;
  const DH = Math.max(1, Math.round(roi.h * scale));
  const canvas = document.createElement('canvas');
  canvas.width = DW; canvas.height = DH;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(video, roi.x, roi.y, roi.w, roi.h, 0, 0, DW, DH);
  const d = ctx.getImageData(0, 0, DW, DH).data;
  const g = new Float64Array(DW * DH);
  for (let p = 0, j = 0; j < DW * DH; p += 4, j++) g[j] = d[p] * 0.299 + d[p + 1] * 0.587 + d[p + 2] * 0.114;

  const vEdge = new Float64Array(DW);
  for (let x = 1; x < DW - 1; x++) {
    let s = 0;
    for (let y = 0; y < DH; y++) s += Math.abs(g[y * DW + x + 1] - g[y * DW + x - 1]);
    vEdge[x] = s;
  }
  const hEdge = new Float64Array(DH);
  for (let y = 1; y < DH - 1; y++) {
    let s = 0;
    for (let x = 0; x < DW; x++) s += Math.abs(g[(y + 1) * DW + x] - g[(y - 1) * DW + x]);
    hEdge[y] = s;
  }
  const L = strongestPeak(vEdge, 1, Math.floor(DW * 0.45));
  const R = strongestPeak(vEdge, Math.floor(DW * 0.55), DW - 1);
  const T = strongestPeak(hEdge, 1, Math.floor(DH * 0.45));
  const B = strongestPeak(hEdge, Math.floor(DH * 0.55), DH - 1);

  const bw = R.i - L.i, bh = B.i - T.i;
  const aspect = bw / bh;
  const inv = roi.w / DW;
  const plausible = bw > DW * 0.4 && bh > DH * 0.4 && aspect > 0.5 && aspect < 0.95;
  if (!plausible) return { rect: vf, detected: false };

  const padX = bw * 0.03, padY = bh * 0.03;
  const x = Math.max(0, roi.x + (L.i - padX) * inv);
  const y = Math.max(0, roi.y + (T.i - padY) * inv);
  const w = Math.min(vW - x, (bw + 2 * padX) * inv);
  const h = Math.min(vH - y, (bh + 2 * padY) * inv);
  return { rect: { x, y, w, h }, detected: true };
}

function rectCanvasToOutput(video, rect, outW, outH) {
  const c = document.createElement('canvas');
  c.width = outW; c.height = outH;
  c.getContext('2d').drawImage(video, rect.x, rect.y, rect.w, rect.h, 0, 0, outW, outH);
  return c;
}

// ── opencv contour + perspective warp ───────────────────────────────────────

function orderCorners(pts) {
  const sum = pts.map((p) => p.x + p.y);
  const diff = pts.map((p) => p.y - p.x);
  const tl = pts[sum.indexOf(Math.min(...sum))];
  const br = pts[sum.indexOf(Math.max(...sum))];
  const tr = pts[diff.indexOf(Math.min(...diff))];
  const bl = pts[diff.indexOf(Math.max(...diff))];
  return [tl, tr, br, bl];
}

function tryOpencvWarp(cv, video, vf, outW, outH) {
  const vW = video.videoWidth, vH = video.videoHeight;
  const mx = vf.w * 0.18, my = vf.h * 0.18;
  const roi = {
    x: Math.max(0, vf.x - mx),
    y: Math.max(0, vf.y - my),
  };
  roi.w = Math.min(vW - roi.x, vf.w + 2 * mx);
  roi.h = Math.min(vH - roi.y, vf.h + 2 * my);

  const DW = 480;
  const DH = Math.max(1, Math.round((roi.h * DW) / roi.w));
  const work = document.createElement('canvas');
  work.width = DW; work.height = DH;
  work.getContext('2d').drawImage(video, roi.x, roi.y, roi.w, roi.h, 0, 0, DW, DH);

  const allocated = [];
  const alloc = (m) => { allocated.push(m); return m; };

  try {
    const src = alloc(cv.imread(work));
    const gray = alloc(new cv.Mat());
    const blurred = alloc(new cv.Mat());
    const edges = alloc(new cv.Mat());
    const contours = alloc(new cv.MatVector());
    const hierarchy = alloc(new cv.Mat());

    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);
    cv.Canny(blurred, edges, 60, 180);
    const k = cv.Mat.ones(3, 3, cv.CV_8U);
    cv.dilate(edges, edges, k);
    k.delete();
    cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    const roiArea = DW * DH;
    let best = null;
    for (let i = 0; i < contours.size(); i++) {
      const c = contours.get(i);
      const area = cv.contourArea(c);
      if (area < roiArea * 0.18) { c.delete(); continue; }
      const approx = new cv.Mat();
      const peri = cv.arcLength(c, true);
      cv.approxPolyDP(c, approx, peri * 0.02, true);
      if (approx.rows === 4) {
        const pts = [];
        for (let p = 0; p < 4; p++) pts.push({ x: approx.data32S[p * 2], y: approx.data32S[p * 2 + 1] });
        const ord = orderCorners(pts);
        const wAvg = (Math.hypot(ord[1].x - ord[0].x, ord[1].y - ord[0].y) +
                      Math.hypot(ord[2].x - ord[3].x, ord[2].y - ord[3].y)) / 2;
        const hAvg = (Math.hypot(ord[3].x - ord[0].x, ord[3].y - ord[0].y) +
                      Math.hypot(ord[2].x - ord[1].x, ord[2].y - ord[1].y)) / 2;
        const aspect = wAvg / hAvg;
        if (aspect > 0.55 && aspect < 0.90 && area > (best?.area || 0)) best = { ord, area };
      }
      approx.delete(); c.delete();
    }

    if (!best) return null;

    const inv = roi.w / DW;
    const srcTri = alloc(cv.matFromArray(4, 1, cv.CV_32FC2, [
      best.ord[0].x, best.ord[0].y,
      best.ord[1].x, best.ord[1].y,
      best.ord[2].x, best.ord[2].y,
      best.ord[3].x, best.ord[3].y,
    ]));
    const dstTri = alloc(cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, outW, 0, outW, outH, 0, outH]));
    const M = alloc(cv.getPerspectiveTransform(srcTri, dstTri));
    const warped = alloc(new cv.Mat());
    cv.warpPerspective(src, warped, M, new cv.Size(outW, outH));
    const out = document.createElement('canvas');
    out.width = outW; out.height = outH;
    cv.imshow(out, warped);

    // Also report the detected rect in source coordinates so callers can show
    // it without re-running detection.
    const srcRect = {
      x: roi.x + Math.min(best.ord[0].x, best.ord[3].x) * inv,
      y: roi.y + Math.min(best.ord[0].y, best.ord[1].y) * inv,
      w: ((Math.hypot(best.ord[1].x - best.ord[0].x, best.ord[1].y - best.ord[0].y) +
           Math.hypot(best.ord[2].x - best.ord[3].x, best.ord[2].y - best.ord[3].y)) / 2) * inv,
      h: ((Math.hypot(best.ord[3].x - best.ord[0].x, best.ord[3].y - best.ord[0].y) +
           Math.hypot(best.ord[2].x - best.ord[1].x, best.ord[2].y - best.ord[1].y)) / 2) * inv,
    };
    return { canvas: out, rect: srcRect };
  } catch {
    return null;
  } finally {
    for (const m of allocated) { try { m.delete(); } catch {} }
  }
}

// Main entrypoint. NEVER throws. Returns a warped, upright card canvas + the
// detected source rect, or — when no good contour is found / opencv isn't
// ready / anything else goes wrong — a viewfinder-rect crop so the scan still
// has something to hash.
export async function detectAndWarp(video, viewfinder, outW = 488) {
  const outH = Math.round(outW * (88 / 63));
  if (!video?.videoWidth) return { canvas: null, rect: viewfinder, detected: false, engine: 'none' };

  if (cvStatus() === 'ready' && window.cv?.Mat) {
    const r = tryOpencvWarp(window.cv, video, viewfinder, outW, outH);
    if (r) return { canvas: r.canvas, rect: r.rect, detected: true, engine: 'opencv' };
  }

  // Fallback path: gradient detection + plain crop (no warp, no opencv).
  const det = gradientDetect(video, viewfinder);
  return {
    canvas: rectCanvasToOutput(video, det.rect, outW, outH),
    rect: det.rect,
    detected: det.detected,
    engine: cvStatus() === 'ready' ? 'opencv-nomatch-gradient' : 'gradient',
  };
}
