'use client';

// Robust card detection using opencv.js — contours + perspective warp.
//
// Reads the viewfinder ROI, finds rectangular contours that look like an MTG
// card (aspect ~0.716, fills a meaningful share of the ROI), picks the biggest
// good candidate, and warps it into a canonical upright rectangle. That warp
// kills the alignment sensitivity that's been hurting dHash matching.
//
// opencv.js (~7–8 MB WASM) loads lazily the first time warmCv() is called —
// once, then cached. We only call this on the /scan page.

const CV_SRC = 'https://docs.opencv.org/4.x/opencv.js';

let cvReady = null;

export function warmCv() {
  if (typeof window === 'undefined') return Promise.resolve(null);
  if (window.cv && window.cv.Mat) return Promise.resolve(window.cv);
  if (cvReady) return cvReady;
  cvReady = new Promise((resolve, reject) => {
    // Module shim so opencv.js calls back when ready.
    window.Module = window.Module || {};
    const prev = window.Module.onRuntimeInitialized;
    window.Module.onRuntimeInitialized = () => {
      prev?.();
      resolve(window.cv);
    };
    const existing = document.querySelector(`script[data-cv="1"]`);
    if (existing) return; // another caller already injected it
    const s = document.createElement('script');
    s.src = CV_SRC;
    s.async = true;
    s.dataset.cv = '1';
    s.onerror = () => reject(new Error('opencv.js failed to load'));
    document.head.appendChild(s);
  });
  return cvReady;
}

// Return [tl, tr, br, bl] for a 4-point contour (any winding).
function orderCorners(pts) {
  const sum = pts.map((p) => p.x + p.y);
  const diff = pts.map((p) => p.y - p.x);
  const tl = pts[sum.indexOf(Math.min(...sum))];
  const br = pts[sum.indexOf(Math.max(...sum))];
  const tr = pts[diff.indexOf(Math.min(...diff))];
  const bl = pts[diff.indexOf(Math.max(...diff))];
  return [tl, tr, br, bl];
}

// Detect the card in `video` and return a canvas containing the warped card,
// upright, at the requested width (height scales by MTG aspect 63/88).
// Falls back to a plain crop of the centred viewfinder rect when no good
// rectangular contour is found.
export async function detectAndWarp(video, viewfinder, outW = 488) {
  const cv = await warmCv();
  const outH = Math.round(outW * (88 / 63));

  const vW = video.videoWidth, vH = video.videoHeight;
  if (!vW || !vH) return { canvas: null, detected: false };

  // ROI: viewfinder + a generous margin so the card's edges aren't clipped if the
  // user holds it slightly outside the rectangle.
  const mx = viewfinder.w * 0.18, my = viewfinder.h * 0.18;
  const roi = {
    x: Math.max(0, viewfinder.x - mx),
    y: Math.max(0, viewfinder.y - my),
  };
  roi.w = Math.min(vW - roi.x, viewfinder.w + 2 * mx);
  roi.h = Math.min(vH - roi.y, viewfinder.h + 2 * my);

  // Draw the ROI into a working canvas at a manageable resolution (perf).
  const DW = 480;
  const DH = Math.max(1, Math.round((roi.h * DW) / roi.w));
  const work = document.createElement('canvas');
  work.width = DW; work.height = DH;
  const wctx = work.getContext('2d', { willReadFrequently: true });
  wctx.drawImage(video, roi.x, roi.y, roi.w, roi.h, 0, 0, DW, DH);

  const src = cv.imread(work);
  const gray = new cv.Mat();
  const blurred = new cv.Mat();
  const edges = new cv.Mat();
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  let warpedCanvas = null;
  let detected = false;

  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);
    cv.Canny(blurred, edges, 60, 180);
    // Close gaps along the card edge so contour-finding gets a clean loop.
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
        for (let p = 0; p < 4; p++) {
          pts.push({ x: approx.data32S[p * 2], y: approx.data32S[p * 2 + 1] });
        }
        const ordered = orderCorners(pts);
        const wTop = Math.hypot(ordered[1].x - ordered[0].x, ordered[1].y - ordered[0].y);
        const wBot = Math.hypot(ordered[2].x - ordered[3].x, ordered[2].y - ordered[3].y);
        const hL = Math.hypot(ordered[3].x - ordered[0].x, ordered[3].y - ordered[0].y);
        const hR = Math.hypot(ordered[2].x - ordered[1].x, ordered[2].y - ordered[1].y);
        const wAvg = (wTop + wBot) / 2;
        const hAvg = (hL + hR) / 2;
        const aspect = wAvg / hAvg;
        // MTG card aspect 63/88 ≈ 0.716. Allow for perspective tilt.
        if (aspect > 0.55 && aspect < 0.90 && area > (best?.area || 0)) {
          best = { ordered, area };
        }
      }
      approx.delete();
      c.delete();
    }

    if (best) {
      detected = true;
      const srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
        best.ordered[0].x, best.ordered[0].y,
        best.ordered[1].x, best.ordered[1].y,
        best.ordered[2].x, best.ordered[2].y,
        best.ordered[3].x, best.ordered[3].y,
      ]);
      const dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
        0, 0,
        outW, 0,
        outW, outH,
        0, outH,
      ]);
      const M = cv.getPerspectiveTransform(srcTri, dstTri);
      const warped = new cv.Mat();
      cv.warpPerspective(src, warped, M, new cv.Size(outW, outH));
      warpedCanvas = document.createElement('canvas');
      warpedCanvas.width = outW; warpedCanvas.height = outH;
      cv.imshow(warpedCanvas, warped);
      srcTri.delete(); dstTri.delete(); M.delete(); warped.delete();
    } else {
      // Fallback: crop the centred viewfinder area straight from the video.
      warpedCanvas = document.createElement('canvas');
      warpedCanvas.width = outW; warpedCanvas.height = outH;
      const wctx2 = warpedCanvas.getContext('2d');
      wctx2.drawImage(video, viewfinder.x, viewfinder.y, viewfinder.w, viewfinder.h, 0, 0, outW, outH);
    }
  } finally {
    src.delete(); gray.delete(); blurred.delete();
    edges.delete(); contours.delete(); hierarchy.delete();
  }

  return { canvas: warpedCanvas, detected };
}
