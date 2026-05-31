'use client';

// Visual card matching — the free, zero-cost scan path (ManaBox-style).
//
// Pipeline per frame:
//   1) Lightweight gradient edge-projection finds the card's bounding box
//      inside the viewfinder ROI (no WASM, no external scripts — always loads).
//   2) Read pixels at native resolution, dHash them via in-JS box-average
//      (engine-independent — agrees with the Node build script bit-for-bit).
//   3) Multi-frame voting + confidence floor → either CONFIDENT or
//      "uncertain → free Claude Smart Scan fallback".
//
// Self-test (a bundled reference image hashed in-browser vs its stored hash)
// MUST stay at 0 — that's the parity guarantee the matcher relies on.

const VF_W = 232;
const VF_H = 324;
const HASH_SIZE = 16; // must match scripts/build-hashes.mjs

let db = null;       // { n, bytes, flat: Uint8Array, ids, names, sets, cns, bits }
let loading = null;

// Popcount lookup for fast Hamming distance.
const POPCOUNT = new Uint8Array(256);
for (let i = 0; i < 256; i++) POPCOUNT[i] = (i & 1) + POPCOUNT[i >> 1];

let workCanvas = null;
function getWorkCanvas(w, h) {
  if (!workCanvas) workCanvas = document.createElement('canvas');
  if (workCanvas.width !== w) workCanvas.width = w;
  if (workCanvas.height !== h) workCanvas.height = h;
  return workCanvas;
}

function hexToBytes(hex, out, off) {
  for (let i = 0; i < hex.length; i += 2) out[off + i / 2] = parseInt(hex.substr(i, 2), 16);
}

export async function loadMatchDb(url) {
  if (db) return db;
  if (loading) return loading;
  loading = (async () => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`hash DB ${res.status}`);
    const json = await res.json();
    const cards = json.cards || [];
    const n = cards.length;
    const bytes = (json.bits || HASH_SIZE * HASH_SIZE) / 8;
    const flat = new Uint8Array(n * bytes);
    const ids = new Array(n), names = new Array(n), sets = new Array(n), cns = new Array(n);
    for (let i = 0; i < n; i++) {
      const c = cards[i];
      ids[i] = c.id; names[i] = c.name; sets[i] = c.set; cns[i] = c.cn;
      hexToBytes(c.hash, flat, i * bytes);
    }
    db = { n, bytes, flat, ids, names, sets, cns, bits: bytes * 8 };
    loading = null;
    return db;
  })();
  return loading;
}

export function matchDbInfo() {
  return db ? { n: db.n, bits: db.bits } : null;
}

// Map the centred viewfinder box back to source-video pixels (inverse object-cover),
// so we hash exactly the card the user framed regardless of screen/camera aspect.
function cardSourceRect(video, vfW = VF_W, vfH = VF_H) {
  const vW = video.videoWidth, vH = video.videoHeight;
  if (!vW || !vH) return null;
  const box = video.getBoundingClientRect();
  const dispW = box.width || vW;
  const dispH = box.height || vH;
  const scale = Math.max(dispW / vW, dispH / vH);
  const cropX = (vW * scale - dispW) / 2;
  const cropY = (vH * scale - dispH) / 2;
  const vfX = (dispW - vfW) / 2;
  const vfY = (dispH - vfH) / 2;
  const toSrc = (dx, dy) => ({ x: (dx + cropX) / scale, y: (dy + cropY) / scale });
  const tl = toSrc(vfX, vfY);
  const br = toSrc(vfX + vfW, vfY + vfH);
  const x = Math.max(0, tl.x), y = Math.max(0, tl.y);
  return { x, y, w: Math.min(vW - x, br.x - tl.x), h: Math.min(vH - y, br.y - tl.y) };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Gradient edge-projection card detection ─────────────────────────────────
// Finds the strongest left/right/top/bottom edges inside the ROI, then validates
// the result by size + aspect. Falls back to the viewfinder rect if implausible.

let detectCanvas = null;
function strongestPeak(arr, lo, hi) {
  let bi = lo, bv = -1;
  for (let i = lo; i < hi; i++) if (arr[i] > bv) { bv = arr[i]; bi = i; }
  return { i: bi, v: bv };
}

function detectCardRect(video, opts = {}) {
  const vf = cardSourceRect(video, opts.vfW ?? VF_W, opts.vfH ?? VF_H);
  if (!vf) return null;
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
  if (!detectCanvas) detectCanvas = document.createElement('canvas');
  detectCanvas.width = DW; detectCanvas.height = DH;
  const ctx = detectCanvas.getContext('2d', { willReadFrequently: true });
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

  // Tiny padding so full-art (no border) competes against bordered references.
  const padX = bw * 0.03, padY = bh * 0.03;
  const x = Math.max(0, roi.x + (L.i - padX) * inv);
  const y = Math.max(0, roi.y + (T.i - padY) * inv);
  const w = Math.min(vW - x, (bw + 2 * padX) * inv);
  const h = Math.min(vH - y, (bh + 2 * padY) * inv);
  return { rect: { x, y, w, h }, detected: true };
}

// ── dHash: engine-independent box-average ───────────────────────────────────
// MUST stay byte-identical to scripts/build-hashes.mjs. Self-test verifies this.

function dhashFromImageData(data, sw, sh, size = HASH_SIZE) {
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

// Read a source region's pixels at native resolution (NO engine resampling) so
// the box-average dHash hashes the same content the build script does.
function regionPixels(source, sx, sy, sw, sh) {
  const W = Math.max(1, Math.round(sw)), H = Math.max(1, Math.round(sh));
  const canvas = getWorkCanvas(W, H);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, W, H);
  return { data: ctx.getImageData(0, 0, W, H).data, w: W, h: H };
}

// Alignment-tolerant hashing. dHash is exquisitely sensitive to small scale /
// crop shifts — a few pixels of drift between the camera framing and the
// reference framing can flip ~20% of the bits, which is exactly what we've
// been seeing. Instead of perfecting detection, we sample several plausible
// crops around the detected rect and emit ALL of their hashes; the matcher
// then takes the minimum distance over the full set against the DB.
//
// Variants: 3 scales centred + 4 diagonal offsets at base scale = 7 hashes per
// frame. Reference DB is one canonical crop (full image); widening the QUERY
// side absorbs the small framing differences that flip dHash bits.
const VARIANTS = [
  { s: 1.00, ox: 0, oy: 0 },
  { s: 0.94, ox: 0, oy: 0 },
  { s: 1.06, ox: 0, oy: 0 },
  { s: 1.00, ox: -0.03, oy: -0.03 },
  { s: 1.00, ox:  0.03, oy: -0.03 },
  { s: 1.00, ox: -0.03, oy:  0.03 },
  { s: 1.00, ox:  0.03, oy:  0.03 },
];

function frameHashes(video, opts = {}) {
  const det = detectCardRect(video, opts);
  if (!det) return null;
  const base = det.rect;
  if (!base || base.w < 4 || base.h < 4) return null;
  const vW = video.videoWidth, vH = video.videoHeight;
  const cx = base.x + base.w / 2;
  const cy = base.y + base.h / 2;
  const hashes = [];
  for (const v of VARIANTS) {
    const w = base.w * v.s, h = base.h * v.s;
    const x = Math.max(0, cx - w / 2 + base.w * v.ox);
    const y = Math.max(0, cy - h / 2 + base.h * v.oy);
    const cw = Math.min(vW - x, w);
    const ch = Math.min(vH - y, h);
    if (cw < 4 || ch < 4) continue;
    const p = regionPixels(video, x, y, cw, ch);
    hashes.push(dhashFromImageData(p.data, p.w, p.h));
  }
  return { hashes, card: base, detected: det.detected };
}

// Pipeline self-test: hash a full image element the way the build script does.
// Distance to its stored hash must be 0 — that's the parity guarantee.
export function hashImageElement(source) {
  const sw = source.naturalWidth || source.width;
  const sh = source.naturalHeight || source.height;
  if (!sw || !sh) return null;
  const p = regionPixels(source, 0, 0, sw, sh);
  return dhashFromImageData(p.data, p.w, p.h);
}

export function hammingHex(bytes, hex) {
  let dist = 0;
  for (let i = 0; i < bytes.length; i++) {
    dist += POPCOUNT[bytes[i] ^ parseInt(hex.substr(i * 2, 2), 16)];
  }
  return dist;
}

export function matchCard(video, opts = {}) {
  if (!db) return null;
  const fh = frameHashes(video, opts);
  if (!fh || !fh.hashes.length) return null;
  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const { flat, bytes, n, ids, names, sets, cns } = db;

  // For each DB card, take the MIN distance over our query variants. That's
  // the alignment-tolerant comparison: if any of our crops is close, the card
  // wins. Then pick the best (and second-best) card overall.
  let best = 1e9, second = 1e9, bi = -1;
  for (let i = 0; i < n; i++) {
    const off = i * bytes;
    let cardMin = 1e9;
    for (let h = 0; h < fh.hashes.length; h++) {
      const q = fh.hashes[h];
      let dist = 0;
      for (let b = 0; b < bytes; b++) dist += POPCOUNT[q[b] ^ flat[off + b]];
      if (dist < cardMin) cardMin = dist;
    }
    if (cardMin < best) { second = best; best = cardMin; bi = i; }
    else if (cardMin < second) { second = cardMin; }
  }
  const ms = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0);
  if (bi < 0) return null;
  return {
    id: ids[bi], name: names[bi], set: sets[bi], cn: cns[bi],
    distance: best, runnerUp: second, totalBits: bytes * 8, ms,
    detected: fh.detected, variants: fh.hashes.length,
  };
}

// Multi-frame consensus: hash several frames per scan. Tie-break by mean
// distance across all frames a card appears in. Returns confident=false when
// the win isn't decisive — that's the seam where Claude Smart Scan takes over.
export async function matchCardVoted(video, opts = {}, frames = 7) {
  if (!db) return null;
  const votes = new Map();
  let detectedAny = false;
  let runnerUpSum = 0, sampleCount = 0;
  for (let f = 0; f < frames; f++) {
    const m = matchCard(video, opts);
    if (m) {
      detectedAny = detectedAny || m.detected;
      const e = votes.get(m.id) || { count: 0, sum: 0, best: 1e9, m };
      e.count++; e.sum += m.distance; e.best = Math.min(e.best, m.distance);
      if (m.distance <= e.best) e.m = m;
      votes.set(m.id, e);
      runnerUpSum += m.runnerUp; sampleCount++;
    }
    if (f < frames - 1) await sleep(25);
  }
  if (!votes.size) return null;
  let win = null;
  for (const e of votes.values()) {
    const mean = e.sum / e.count;
    if (!win || e.count > win.count || (e.count === win.count && mean < win.mean)) {
      win = { ...e, mean };
    }
  }
  const total = win.m.totalBits;
  const meanRunnerUp = sampleCount ? runnerUpSum / sampleCount : total;
  const gap = (meanRunnerUp - win.mean) / total;
  const confident =
    win.mean <= total * 0.30 &&
    gap >= 0.04 &&
    win.count >= Math.ceil(frames / 2);
  return {
    ...win.m,
    distance: Math.round(win.mean),
    runnerUp: Math.round(meanRunnerUp),
    votes: win.count,
    frames,
    detected: detectedAny,
    confident,
  };
}

export function previewCardCrop(video, opts = {}) {
  const det = detectCardRect(video, opts);
  const card = det?.rect;
  if (!card || card.w < 4) return null;
  const c = document.createElement('canvas');
  const scale = 240 / card.w;
  c.width = Math.round(card.w * scale);
  c.height = Math.round(card.h * scale);
  c.getContext('2d').drawImage(video, card.x, card.y, card.w, card.h, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.7);
}
