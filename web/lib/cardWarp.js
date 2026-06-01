'use client';

// Pure-JS card corner detection + perspective warp. Replaces opencv.js
// (which froze the user's phone) with a hand-rolled Hough-line corner
// finder and manual 4-point perspective warp.
//
// Pipeline:
//   1. Sobel gradient → edge magnitude map on a downscaled ROI.
//   2. Threshold to keep the strongest edges.
//   3. Hough transform — accumulate votes for lines in (rho, theta) space.
//   4. Pick the 2 strongest near-vertical and 2 strongest near-horizontal
//      peaks → those are the card's 4 sides.
//   5. Intersect them pairwise → 4 corner points.
//   6. Bilinear-sample the source frame at the destination grid points
//      (manual perspective warp) → canonical upright rectangle.
//
// Never throws. If Hough fails, returns null and the caller falls back to
// the simple gradient bounding-box detector.

const DOWN_W = 240;       // ROI downscale width for edge detection
const HOUGH_THETA_STEPS = 180; // 0..π in 180 buckets (1° resolution) — finer angles catch slight tilt
const EDGE_THRESH_FRAC = 0.25; // keep edges in top 25% of magnitude (looser; was 0.5)

// Sobel gradient magnitude. Returns a Float32Array (length DW × DH).
function sobelMag(luma, w, h) {
  const mag = new Float32Array(w * h);
  let max = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const tl = luma[i - w - 1], tc = luma[i - w], tr = luma[i - w + 1];
      const ml = luma[i - 1],                       mr = luma[i + 1];
      const bl = luma[i + w - 1], bc = luma[i + w], br = luma[i + w + 1];
      const gx = (tr + 2 * mr + br) - (tl + 2 * ml + bl);
      const gy = (bl + 2 * bc + br) - (tl + 2 * tc + tr);
      const m = Math.abs(gx) + Math.abs(gy);
      mag[i] = m;
      if (m > max) max = m;
    }
  }
  return { mag, max };
}

// Hough accumulator over (rho, theta). Returns {acc, rhoMax, thetaSteps}.
// Theta is sampled 0..π; rho range is ±√(w²+h²).
function houghAccumulate(mag, w, h, thresh) {
  const thetaSteps = HOUGH_THETA_STEPS;
  const rhoMax = Math.ceil(Math.sqrt(w * w + h * h));
  const rhoSteps = 2 * rhoMax + 1;
  const acc = new Uint32Array(thetaSteps * rhoSteps);
  // Precompute sin/cos for each theta bucket.
  const sinT = new Float32Array(thetaSteps);
  const cosT = new Float32Array(thetaSteps);
  for (let t = 0; t < thetaSteps; t++) {
    const theta = (t / thetaSteps) * Math.PI;
    sinT[t] = Math.sin(theta);
    cosT[t] = Math.cos(theta);
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mag[y * w + x] < thresh) continue;
      for (let t = 0; t < thetaSteps; t++) {
        const rho = Math.round(x * cosT[t] + y * sinT[t]) + rhoMax;
        if (rho >= 0 && rho < rhoSteps) acc[t * rhoSteps + rho]++;
      }
    }
  }
  return { acc, rhoMax, rhoSteps, thetaSteps, sinT, cosT };
}

// Find the N strongest non-adjacent peaks in the Hough accumulator within a
// given theta range. Returns array of { rho, theta, votes }.
function topPeaks(hough, thetaLo, thetaHi, n, minSeparation) {
  const { acc, rhoMax, rhoSteps, thetaSteps } = hough;
  const peaks = [];
  for (let t = thetaLo; t < thetaHi; t++) {
    for (let r = 0; r < rhoSteps; r++) {
      const v = acc[t * rhoSteps + r];
      if (v === 0) continue;
      peaks.push({ t, r, v });
    }
  }
  peaks.sort((a, b) => b.v - a.v);
  const picked = [];
  for (const p of peaks) {
    if (picked.length >= n) break;
    let tooClose = false;
    for (const q of picked) {
      const dr = Math.abs(p.r - q.r);
      const dt = Math.abs(p.t - q.t);
      if (dr < minSeparation && dt < thetaSteps * 0.15) { tooClose = true; break; }
    }
    if (tooClose) continue;
    picked.push(p);
  }
  return picked.map((p) => ({
    rho: p.r - rhoMax,
    theta: (p.t / thetaSteps) * Math.PI,
    votes: p.v,
  }));
}

// Intersect two lines given in (rho, theta) form. Returns {x, y} or null when
// they're parallel.
function intersect(a, b) {
  const sa = Math.sin(a.theta), ca = Math.cos(a.theta);
  const sb = Math.sin(b.theta), cb = Math.cos(b.theta);
  const det = ca * sb - sa * cb;
  if (Math.abs(det) < 1e-6) return null;
  return {
    x: (sb * a.rho - sa * b.rho) / det,
    y: (-cb * a.rho + ca * b.rho) / det,
  };
}

// Order [tl, tr, br, bl] from any 4 points.
function orderCorners(pts) {
  const sum = pts.map((p) => p.x + p.y);
  const diff = pts.map((p) => p.y - p.x);
  const tl = pts[sum.indexOf(Math.min(...sum))];
  const br = pts[sum.indexOf(Math.max(...sum))];
  const tr = pts[diff.indexOf(Math.min(...diff))];
  const bl = pts[diff.indexOf(Math.max(...diff))];
  return [tl, tr, br, bl];
}

// Find the card's 4 corners in `video`, restricted to a viewfinder ROI.
// Returns array of 4 {x,y} in source-video pixel coordinates, or null.
export function findCorners(video, vf) {
  const vW = video.videoWidth, vH = video.videoHeight;
  if (!vW || !vH) return null;
  const mx = vf.w * 0.15, my = vf.h * 0.15;
  const roi = {
    x: Math.max(0, vf.x - mx),
    y: Math.max(0, vf.y - my),
  };
  roi.w = Math.min(vW - roi.x, vf.w + 2 * mx);
  roi.h = Math.min(vH - roi.y, vf.h + 2 * my);

  const DW = DOWN_W;
  const DH = Math.max(1, Math.round(roi.h * (DW / roi.w)));
  const canvas = document.createElement('canvas');
  canvas.width = DW; canvas.height = DH;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(video, roi.x, roi.y, roi.w, roi.h, 0, 0, DW, DH);
  const data = ctx.getImageData(0, 0, DW, DH).data;
  const luma = new Uint8ClampedArray(DW * DH);
  for (let p = 0, j = 0; j < DW * DH; p += 4, j++) {
    luma[j] = (77 * data[p] + 150 * data[p + 1] + 29 * data[p + 2]) >> 8;
  }

  const { mag, max } = sobelMag(luma, DW, DH);
  if (max === 0) return null;
  const hough = houghAccumulate(mag, DW, DH, max * EDGE_THRESH_FRAC);

  // Card edges: 2 nearly-vertical (theta ~0 or ~π), 2 nearly-horizontal
  // (theta ~π/2). With theta sampled 0..π in 90 steps:
  //   vertical lines → t ≈ 0..15 or 75..89
  //   horizontal lines → t ≈ 35..55
  const ts = hough.thetaSteps;
  // Vertical: combine the two wraparound bands. Up to ±27° tilt allowed.
  const vert = [
    ...topPeaks(hough, 0, Math.floor(ts * 0.20), 6, Math.floor(DW * 0.25)),
    ...topPeaks(hough, Math.floor(ts * 0.80), ts, 6, Math.floor(DW * 0.25)),
  ].sort((a, b) => b.votes - a.votes).slice(0, 8);
  // Horizontal: 90° ± 27°.
  const horiz = topPeaks(hough, Math.floor(ts * 0.35), Math.floor(ts * 0.65), 6, Math.floor(DH * 0.25));

  // Debug: surface why we may be failing — logged once per call.
  if (typeof window !== 'undefined' && window.__df_dbgWarp) {
    // eslint-disable-next-line no-console
    console.log('[warp]', { vert: vert.length, horiz: horiz.length, topV: vert.slice(0, 2), topH: horiz.slice(0, 2) });
  }

  if (vert.length < 2 || horiz.length < 2) return null;

  // Pick the 2 strongest vertical that are far apart (left + right edges),
  // and the 2 strongest horizontal that are far apart (top + bottom).
  function pickPair(lines, minSep) {
    for (let i = 0; i < lines.length; i++) {
      for (let j = i + 1; j < lines.length; j++) {
        if (Math.abs(lines[i].rho - lines[j].rho) >= minSep) return [lines[i], lines[j]];
      }
    }
    return null;
  }
  const vp = pickPair(vert, Math.floor(DW * 0.4));
  const hp = pickPair(horiz, Math.floor(DH * 0.4));
  if (!vp || !hp) return null;

  // 4 corners = pairwise intersections.
  const corners = [];
  for (const v of vp) for (const h of hp) {
    const p = intersect(v, h);
    if (!p) return null;
    corners.push(p);
  }
  if (corners.length !== 4) return null;
  const ordered = orderCorners(corners);

  // Sanity: aspect ratio in the right ballpark (MTG card = 63/88 ≈ 0.716).
  const wTop = Math.hypot(ordered[1].x - ordered[0].x, ordered[1].y - ordered[0].y);
  const wBot = Math.hypot(ordered[2].x - ordered[3].x, ordered[2].y - ordered[3].y);
  const hL = Math.hypot(ordered[3].x - ordered[0].x, ordered[3].y - ordered[0].y);
  const hR = Math.hypot(ordered[2].x - ordered[1].x, ordered[2].y - ordered[1].y);
  const wAvg = (wTop + wBot) / 2, hAvg = (hL + hR) / 2;
  if (wAvg < DW * 0.35 || hAvg < DH * 0.35) return null;
  const aspect = wAvg / hAvg;
  // MTG card aspect 63/88 ≈ 0.716; allow ±35% for perspective tilt.
  if (aspect < 0.45 || aspect > 1.0) return null;

  // Map back to source-video coordinates.
  const inv = roi.w / DW;
  return ordered.map((p) => ({ x: roi.x + p.x * inv, y: roi.y + p.y * inv }));
}

// Manual perspective warp via inverse-mapping + bilinear sampling. Writes
// directly into a destination canvas so the warped card is ready to hash.
export function warpToCanvas(video, corners, outW, outH) {
  // Build the source→dest perspective transform, then invert it so we can
  // sample for each dest pixel. Reuses the classic 8-coefficient method:
  // four (sx, sy) → (dx, dy) pairs solve for [a,b,c,d,e,f,g,h] in
  //   dx = (a·sx + b·sy + c) / (g·sx + h·sy + 1)
  //   dy = (d·sx + e·sy + f) / (g·sx + h·sy + 1)
  // We only need the inverse (dest → src), so solve dest as the input.
  const [tl, tr, br, bl] = corners;
  // dest corners (a clean rectangle):
  const dx0 = 0, dy0 = 0;
  const dx1 = outW - 1, dy1 = 0;
  const dx2 = outW - 1, dy2 = outH - 1;
  const dx3 = 0, dy3 = outH - 1;

  // Solve the 8 inverse-mapping coefficients using the system of 8 equations.
  // Source = M · Dest; we want M (dest pixel → source pixel).
  const A = [
    [dx0, dy0, 1, 0, 0, 0, -dx0 * tl.x, -dy0 * tl.x],
    [0, 0, 0, dx0, dy0, 1, -dx0 * tl.y, -dy0 * tl.y],
    [dx1, dy1, 1, 0, 0, 0, -dx1 * tr.x, -dy1 * tr.x],
    [0, 0, 0, dx1, dy1, 1, -dx1 * tr.y, -dy1 * tr.y],
    [dx2, dy2, 1, 0, 0, 0, -dx2 * br.x, -dy2 * br.x],
    [0, 0, 0, dx2, dy2, 1, -dx2 * br.y, -dy2 * br.y],
    [dx3, dy3, 1, 0, 0, 0, -dx3 * bl.x, -dy3 * bl.x],
    [0, 0, 0, dx3, dy3, 1, -dx3 * bl.y, -dy3 * bl.y],
  ];
  const B = [tl.x, tl.y, tr.x, tr.y, br.x, br.y, bl.x, bl.y];
  const M = solve8(A, B);
  if (!M) return null;
  const [a, b, c, d, e, f, g, h] = M;

  // Read the whole source frame into a buffer for bilinear sampling.
  const vW = video.videoWidth, vH = video.videoHeight;
  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = vW; srcCanvas.height = vH;
  srcCanvas.getContext('2d').drawImage(video, 0, 0);
  const src = srcCanvas.getContext('2d').getImageData(0, 0, vW, vH).data;

  const dst = document.createElement('canvas');
  dst.width = outW; dst.height = outH;
  const dstCtx = dst.getContext('2d');
  const dstImg = dstCtx.createImageData(outW, outH);
  const dstData = dstImg.data;

  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const denom = g * x + h * y + 1;
      const sx = (a * x + b * y + c) / denom;
      const sy = (d * x + e * y + f) / denom;
      if (sx < 0 || sx >= vW - 1 || sy < 0 || sy >= vH - 1) continue;
      // Bilinear sample.
      const x0 = Math.floor(sx), y0 = Math.floor(sy);
      const fx = sx - x0, fy = sy - y0;
      const i00 = (y0 * vW + x0) * 4;
      const i01 = i00 + 4;
      const i10 = i00 + vW * 4;
      const i11 = i10 + 4;
      const w00 = (1 - fx) * (1 - fy), w01 = fx * (1 - fy);
      const w10 = (1 - fx) * fy,       w11 = fx * fy;
      const o = (y * outW + x) * 4;
      dstData[o]     = src[i00] * w00 + src[i01] * w01 + src[i10] * w10 + src[i11] * w11;
      dstData[o + 1] = src[i00 + 1] * w00 + src[i01 + 1] * w01 + src[i10 + 1] * w10 + src[i11 + 1] * w11;
      dstData[o + 2] = src[i00 + 2] * w00 + src[i01 + 2] * w01 + src[i10 + 2] * w10 + src[i11 + 2] * w11;
      dstData[o + 3] = 255;
    }
  }
  dstCtx.putImageData(dstImg, 0, 0);
  return dst;
}

// Gauss-Jordan elimination for an 8x8 system (A·x = B). Returns x or null.
function solve8(A, B) {
  const n = 8;
  const M = A.map((row, i) => [...row, B[i]]);
  for (let i = 0; i < n; i++) {
    // Pivot.
    let pivot = i;
    for (let k = i + 1; k < n; k++) if (Math.abs(M[k][i]) > Math.abs(M[pivot][i])) pivot = k;
    if (Math.abs(M[pivot][i]) < 1e-9) return null;
    [M[i], M[pivot]] = [M[pivot], M[i]];
    // Eliminate.
    for (let k = 0; k < n; k++) {
      if (k === i) continue;
      const factor = M[k][i] / M[i][i];
      for (let j = i; j <= n; j++) M[k][j] -= factor * M[i][j];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}
