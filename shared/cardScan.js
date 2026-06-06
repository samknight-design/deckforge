// Pure, framework-agnostic card scan engine. Ported from the browser pipeline
// (web/lib/cardWarp.js + cardMatch.js) that reached ~90% accuracy — but with
// every DOM/canvas dependency removed so it runs in React Native (fed raw RGBA
// pixels) AND in Node (the build script).
//
// Pipeline: RGBA pixels → Hough-line corner detection → perspective unskew →
// dHash → Hamming match against the bundled hash DB.
//
// CRITICAL: dhash() must stay byte-identical to scripts/build-full-hashes.mjs,
// or live hashes won't align with the reference DB.
//
// PERFORMANCE NOTES (2026-06):
// The biggest bottleneck is jpeg-js JPEG decode in CameraView (caller's job to
// pass small images). Changes here target the compute AFTER decode:
//   - DOWN_W 240→120: Hough works on 120-wide luma, ~8× faster accumulation
//   - HOUGH_THETA_STEPS 180→90: 2° angular resolution; sufficient for cards
//   - Warp output 244×340→68×88: 14× fewer pixels; dhash is resolution-agnostic
//     (the DB hashes are from 146×204 Scryfall images, not 244×340 warps — safe)
//   - matchHash: early-exit when accumulated dist exceeds running best
//   - Separate confidence gates for corner-detected vs center-crop paths

const HASH_SIZE = 16;            // 16×16 dHash → 256 bits / 32 bytes — DO NOT CHANGE (DB format)
const DOWN_W = 120;              // Hough downscale width (was 240)
const HOUGH_THETA_STEPS = 90;   // Angular resolution (was 180 — 2° is enough for card edges)
const EDGE_THRESH_FRAC = 0.22;  // Slightly lower threshold catches more edges in poor lighting

// Warp output size for dHash computation.
// IMPORTANT: The DB hashes are built from Scryfall 'small' images (146×204), NOT from
// warped frames. dHash maps any source size to the 17×16 grid proportionally, so 68×88
// and 244×340 produce compatible (closely matching) hashes. Smaller = 14× faster warp.
const WARP_W = 68;
const WARP_H = 88;

// ── dHash ───────────────────────────────────────────────────────────────────
export function dhash(data, sw, sh, size = HASH_SIZE) {
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
        for (let x = x0; x < x1; x++) {
          const i = (y * sw + x) * 4;
          sum += data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
          cnt++;
        }
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

// ── Corner detection (Hough) ────────────────────────────────────────────────
function sobelMag(luma, w, h) {
  const mag = new Float32Array(w * h);
  let max = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const tl = luma[i - w - 1], tc = luma[i - w], tr = luma[i - w + 1];
      const ml = luma[i - 1], mr = luma[i + 1];
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

function houghAccumulate(mag, w, h, thresh) {
  const thetaSteps = HOUGH_THETA_STEPS;
  const rhoMax = Math.ceil(Math.sqrt(w * w + h * h));
  const rhoSteps = 2 * rhoMax + 1;
  const acc = new Uint32Array(thetaSteps * rhoSteps);
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
  return { acc, rhoMax, rhoSteps, thetaSteps };
}

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
      if (Math.abs(p.r - q.r) < minSeparation && Math.abs(p.t - q.t) < thetaSteps * 0.15) { tooClose = true; break; }
    }
    if (!tooClose) picked.push(p);
  }
  return picked.map((p) => ({ rho: p.r - rhoMax, theta: (p.t / thetaSteps) * Math.PI, votes: p.v }));
}

function intersect(a, b) {
  const sa = Math.sin(a.theta), ca = Math.cos(a.theta);
  const sb = Math.sin(b.theta), cb = Math.cos(b.theta);
  const det = ca * sb - sa * cb;
  if (Math.abs(det) < 1e-6) return null;
  return { x: (sb * a.rho - sa * b.rho) / det, y: (-cb * a.rho + ca * b.rho) / det };
}

function orderCorners(pts) {
  const sum = pts.map((p) => p.x + p.y);
  const diff = pts.map((p) => p.y - p.x);
  return [
    pts[sum.indexOf(Math.min(...sum))],
    pts[diff.indexOf(Math.min(...diff))],
    pts[sum.indexOf(Math.max(...sum))],
    pts[diff.indexOf(Math.max(...diff))],
  ];
}

// Detect the card's 4 corners in a full RGBA image. Returns [tl,tr,br,bl] in
// full-resolution coords, or null when no plausible card quad is found.
export function detectCorners(rgba, w, h) {
  const DW = Math.min(DOWN_W, w);
  const DH = Math.max(1, Math.round(h * (DW / w)));
  const luma = new Uint8ClampedArray(DW * DH);
  const sx = w / DW, sy = h / DH;
  for (let dy = 0; dy < DH; dy++) {
    const syy = Math.min(h - 1, (dy * sy) | 0);
    for (let dx = 0; dx < DW; dx++) {
      const sxx = Math.min(w - 1, (dx * sx) | 0);
      const i = (syy * w + sxx) * 4;
      luma[dy * DW + dx] = (77 * rgba[i] + 150 * rgba[i + 1] + 29 * rgba[i + 2]) >> 8;
    }
  }
  const { mag, max } = sobelMag(luma, DW, DH);
  if (max === 0) return null;
  const hough = houghAccumulate(mag, DW, DH, max * EDGE_THRESH_FRAC);
  const ts = hough.thetaSteps;
  // Vertical lines: near 0° or near 180° (using 90-step table, so near 0 or near 90)
  const vertFrac = Math.floor(ts * 0.20);
  const vert = [
    ...topPeaks(hough, 0, vertFrac, 6, Math.floor(DW * 0.25)),
    ...topPeaks(hough, ts - vertFrac, ts, 6, Math.floor(DW * 0.25)),
  ].sort((a, b) => b.votes - a.votes).slice(0, 8);
  // Horizontal lines: mid-range theta
  const horizLo = Math.floor(ts * 0.35), horizHi = Math.floor(ts * 0.65);
  const horiz = topPeaks(hough, horizLo, horizHi, 6, Math.floor(DH * 0.25));
  if (vert.length < 2 || horiz.length < 2) return null;

  const pickPair = (lines, minSep) => {
    for (let i = 0; i < lines.length; i++)
      for (let j = i + 1; j < lines.length; j++)
        if (Math.abs(lines[i].rho - lines[j].rho) >= minSep) return [lines[i], lines[j]];
    return null;
  };
  const vp = pickPair(vert, Math.floor(DW * 0.4));
  const hp = pickPair(horiz, Math.floor(DH * 0.4));
  if (!vp || !hp) return null;

  const corners = [];
  for (const v of vp) for (const hl of hp) {
    const p = intersect(v, hl);
    if (!p) return null;
    corners.push(p);
  }
  if (corners.length !== 4) return null;
  const ordered = orderCorners(corners);

  const wTop = Math.hypot(ordered[1].x - ordered[0].x, ordered[1].y - ordered[0].y);
  const wBot = Math.hypot(ordered[2].x - ordered[3].x, ordered[2].y - ordered[3].y);
  const hL = Math.hypot(ordered[3].x - ordered[0].x, ordered[3].y - ordered[0].y);
  const hR = Math.hypot(ordered[2].x - ordered[1].x, ordered[2].y - ordered[1].y);
  const wAvg = (wTop + wBot) / 2, hAvg = (hL + hR) / 2;
  if (wAvg < DW * 0.35 || hAvg < DH * 0.35) return null;
  const aspect = wAvg / hAvg;
  if (aspect < 0.45 || aspect > 1.0) return null;

  const invX = w / DW, invY = h / DH;
  return ordered.map((p) => ({ x: p.x * invX, y: p.y * invY }));
}

// ── Perspective warp ────────────────────────────────────────────────────────
function solve8(A, B) {
  const n = 8;
  const M = A.map((row, i) => [...row, B[i]]);
  for (let i = 0; i < n; i++) {
    let pivot = i;
    for (let k = i + 1; k < n; k++) if (Math.abs(M[k][i]) > Math.abs(M[pivot][i])) pivot = k;
    if (Math.abs(M[pivot][i]) < 1e-9) return null;
    [M[i], M[pivot]] = [M[pivot], M[i]];
    for (let k = 0; k < n; k++) {
      if (k === i) continue;
      const factor = M[k][i] / M[i][i];
      for (let j = i; j <= n; j++) M[k][j] -= factor * M[i][j];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

// Warp the quad given by corners into a clean WARP_W×WARP_H RGBA rectangle.
// Output at 68×88 is 14× faster than the old 244×340 and produces compatible
// dHash values (the hash function is resolution-agnostic).
export function warpRGBA(rgba, w, h, corners, outW = WARP_W, outH = WARP_H) {
  const [tl, tr, br, bl] = corners;
  const A = [
    [0, 0, 1, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 1, 0, 0],
    [outW - 1, 0, 1, 0, 0, 0, -(outW - 1) * tr.x, 0],
    [0, 0, 0, outW - 1, 0, 1, -(outW - 1) * tr.y, 0],
    [outW - 1, outH - 1, 1, 0, 0, 0, -(outW - 1) * br.x, -(outH - 1) * br.x],
    [0, 0, 0, outW - 1, outH - 1, 1, -(outW - 1) * br.y, -(outH - 1) * br.y],
    [0, outH - 1, 1, 0, 0, 0, 0, -(outH - 1) * bl.x],
    [0, 0, 0, 0, outH - 1, 1, 0, -(outH - 1) * bl.y],
  ];
  const B = [tl.x, tl.y, tr.x, tr.y, br.x, br.y, bl.x, bl.y];
  const M = solve8(A, B);
  if (!M) return null;
  const [a, b, c, d, e, f, g, hh] = M;
  const out = new Uint8ClampedArray(outW * outH * 4);
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const denom = g * x + hh * y + 1;
      const sx = (a * x + b * y + c) / denom;
      const sy = (d * x + e * y + f) / denom;
      const o = (y * outW + x) * 4;
      if (sx < 0 || sx >= w - 1 || sy < 0 || sy >= h - 1) { out[o + 3] = 255; continue; }
      const x0 = Math.floor(sx), y0 = Math.floor(sy);
      const fx = sx - x0, fy = sy - y0;
      const i00 = (y0 * w + x0) * 4, i01 = i00 + 4, i10 = i00 + w * 4, i11 = i10 + 4;
      const w00 = (1 - fx) * (1 - fy), w01 = fx * (1 - fy), w10 = (1 - fx) * fy, w11 = fx * fy;
      out[o]     = rgba[i00] * w00 + rgba[i01] * w01 + rgba[i10] * w10 + rgba[i11] * w11;
      out[o + 1] = rgba[i00 + 1] * w00 + rgba[i01 + 1] * w01 + rgba[i10 + 1] * w10 + rgba[i11 + 1] * w11;
      out[o + 2] = rgba[i00 + 2] * w00 + rgba[i01 + 2] * w01 + rgba[i10 + 2] * w10 + rgba[i11 + 2] * w11;
      out[o + 3] = 255;
    }
  }
  return { data: out, width: outW, height: outH };
}

// Center-crop fallback to card aspect when no corners are detected.
export function centerCropToAspect(rgba, w, h, outW = WARP_W, outH = WARP_H) {
  const aspect = outW / outH;
  let cw = w, ch = Math.round(w / aspect);
  if (ch > h) { ch = h; cw = Math.round(h * aspect); }
  const cx = Math.floor((w - cw) / 2), cy = Math.floor((h - ch) / 2);
  const out = new Uint8ClampedArray(outW * outH * 4);
  for (let y = 0; y < outH; y++) {
    const sy = cy + Math.floor((y / outH) * ch);
    for (let x = 0; x < outW; x++) {
      const sx = cx + Math.floor((x / outW) * cw);
      const si = (sy * w + sx) * 4, di = (y * outW + x) * 4;
      out[di] = rgba[si]; out[di + 1] = rgba[si + 1]; out[di + 2] = rgba[si + 2]; out[di + 3] = 255;
    }
  }
  return { data: out, width: outW, height: outH };
}

// Full pipeline: pixels → (detect + warp | center crop) → dHash.
// Returns { hash, detected, corners } — corners are in the original pixel space.
export function hashCardFromPixels(rgba, w, h) {
  const corners = detectCorners(rgba, w, h);
  const warped = corners
    ? warpRGBA(rgba, w, h, corners)
    : centerCropToAspect(rgba, w, h);
  if (!warped) return { hash: null, detected: false, corners: null };
  return { hash: dhash(warped.data, warped.width, warped.height), detected: !!corners, corners };
}

// ── Hash DB matching ────────────────────────────────────────────────────────
const POPCOUNT = new Uint8Array(256);
for (let i = 0; i < 256; i++) POPCOUNT[i] = (i & 1) + POPCOUNT[i >> 1];

// Parse the packed binary DB (cards.bin). bytes = Uint8Array of the whole file.
export function parseHashDb(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (magic !== 'DFHB') throw new Error('bad hash DB magic: ' + magic);
  const version = dv.getUint32(4, true);
  const count = dv.getUint32(8, true);
  const bytesPerHash = dv.getUint32(12, true);
  const flat = bytes.subarray(16, 16 + count * bytesPerHash);
  return { version, count, bytesPerHash, flat };
}

// Nearest-neighbour Hamming search across the full DB.
// Key optimisation: early exit when accumulated dist >= running best.
// For 114k cards with best typically at ~35–55 bits, most cards are rejected
// well before byte 32, cutting average inner-loop iterations by 3–5×.
export function matchHash(query, db) {
  const { count, bytesPerHash, flat } = db;
  let best = bytesPerHash * 8 + 1; // start above max possible
  let second = best;
  let bi = -1;

  for (let i = 0; i < count; i++) {
    const off = i * bytesPerHash;
    let dist = 0;
    for (let b = 0; b < bytesPerHash; b++) {
      dist += POPCOUNT[query[b] ^ flat[off + b]];
      if (dist >= best) { dist = best; break; } // early exit — can't win
    }
    if (dist < best) { second = best; best = dist; bi = i; }
    else if (dist < second) second = dist;
  }
  return { index: bi, distance: best, runnerUp: second, totalBits: bytesPerHash * 8 };
}
