'use client';

// Visual card matching — the free, zero-cost scan path (ManaBox-style).
//
// We compute a perceptual hash (dHash) of the framed card and find the nearest
// printing in a precomputed hash DB by Hamming distance. No text reading, so
// stylized/foil/full-art cards work, and rough framing is fine. A no-confident
// match falls back to the free Claude Smart Scan.

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

let detectCanvas = null;
function grayAt(source, r, DW) {
  const scale = DW / r.w, DH = Math.max(1, Math.round(r.h * scale));
  if (!detectCanvas) detectCanvas = document.createElement('canvas');
  detectCanvas.width = DW; detectCanvas.height = DH;
  const ctx = detectCanvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(source, r.x, r.y, r.w, r.h, 0, 0, DW, DH);
  const d = ctx.getImageData(0, 0, DW, DH).data;
  const g = new Float64Array(DW * DH);
  for (let p = 0, j = 0; j < DW * DH; p += 4, j++) g[j] = d[p] * 0.299 + d[p + 1] * 0.587 + d[p + 2] * 0.114;
  return { g, DW, DH };
}

function strongestPeak(arr, lo, hi) {
  let bi = lo, bv = -1;
  for (let i = lo; i < hi; i++) if (arr[i] > bv) { bv = arr[i]; bi = i; }
  return { i: bi, v: bv };
}

// Detect the card's bounding box inside (a slightly enlarged) viewfinder ROI by
// finding the strongest border edges via gradient projection. Falls back to the
// viewfinder rect when the result isn't a plausible card (low contrast / glare).
// Returns { rect, detected }.
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
  const { g, DH } = grayAt(video, roi, DW);
  const inv = roi.w / DW; // downscaled → source scale (uniform)

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
  // MTG card aspect 63/88 ≈ 0.716. Allow a generous window — perspective tilt
  // and full-art frames can shift this; rejecting too aggressively flips us back
  // to the loose viewfinder rect, which hashes background.
  const plausible = bw > DW * 0.4 && bh > DH * 0.4 && aspect > 0.5 && aspect < 0.95;

  if (!plausible) return { rect: vf, detected: false };

  // Expand the detected rect by a small fraction so full-art cards (no border)
  // and bordered references compete on the same content area. dHash is highly
  // sensitive to alignment, and the references include the card's border.
  const padX = bw * 0.03, padY = bh * 0.03;
  const x = Math.max(0, roi.x + (L.i - padX) * inv);
  const y = Math.max(0, roi.y + (T.i - padY) * inv);
  const w = Math.min(vW - x, (bw + 2 * padX) * inv);
  const h = Math.min(vH - y, (bh + 2 * padY) * inv);
  return { rect: { x, y, w, h }, detected: true };
}

// Deterministic dHash from full-resolution RGBA pixels: box-average down to a
// (size+1)×size greyscale grid ourselves, then compare horizontally adjacent
// cells. Doing the downscale in plain JS (not canvas drawImage) makes the hash
// identical across engines — the build script (Node/Skia) and the browser must
// agree, which canvas resampling did NOT. MUST match scripts/build-hashes.mjs.
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

// Draw a source region at ~native resolution (no engine resampling) and read it.
function regionPixels(source, sx, sy, sw, sh) {
  const W = Math.max(1, Math.round(sw)), H = Math.max(1, Math.round(sh));
  const canvas = getWorkCanvas(W, H);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, W, H);
  return { data: ctx.getImageData(0, 0, W, H).data, w: W, h: H };
}

// dHash of the framed card (auto-detected bounds, else the viewfinder rect).
function frameHash(video, opts = {}) {
  const det = detectCardRect(video, opts);
  if (!det) return null;
  const card = det.rect;
  if (!card || card.w < 4 || card.h < 4) return null;
  const p = regionPixels(video, card.x, card.y, card.w, card.h);
  return { bytes: dhashFromImageData(p.data, p.w, p.h), card, detected: det.detected };
}

// Pipeline self-test: hash a full image element (the whole card, no crop) the
// way the build script does. Verifies reference⇄camera pipeline parity.
export function hashImageElement(source) {
  const sw = source.naturalWidth || source.width;
  const sh = source.naturalHeight || source.height;
  if (!sw || !sh) return null;
  const p = regionPixels(source, 0, 0, sw, sh);
  return dhashFromImageData(p.data, p.w, p.h);
}

// Hamming distance between a byte hash and a hex-string hash.
export function hammingHex(bytes, hex) {
  let dist = 0;
  for (let i = 0; i < bytes.length; i++) {
    dist += POPCOUNT[bytes[i] ^ parseInt(hex.substr(i * 2, 2), 16)];
  }
  return dist;
}

// Match the framed card against the loaded DB. Returns the best printing, its
// Hamming distance, the runner-up distance (separation = confidence), and ms.
export function matchCard(video, opts = {}) {
  if (!db) return null;
  const fh = frameHash(video, opts);
  if (!fh) return null;
  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const { flat, bytes, n, ids, names, sets, cns } = db;
  const q = fh.bytes;
  let best = 1e9, second = 1e9, bi = -1;
  for (let i = 0; i < n; i++) {
    const off = i * bytes;
    let dist = 0;
    for (let b = 0; b < bytes; b++) dist += POPCOUNT[q[b] ^ flat[off + b]];
    if (dist < best) { second = best; best = dist; bi = i; }
    else if (dist < second) { second = dist; }
  }
  const ms = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0);
  if (bi < 0) return null;
  return {
    id: ids[bi], name: names[bi], set: sets[bi], cn: cns[bi],
    distance: best, runnerUp: second, totalBits: bytes * 8, ms, detected: fh.detected,
  };
}

// Multi-frame consensus: hash several frames per scan. The winner is the card
// that places top-1 in the most frames; tie-broken by mean distance ACROSS all
// frames it appeared in (not the lucky first frame's value). Returns null —
// "no confident match" — when the win isn't decisive, letting the Claude
// fallback take over instead of confidently surfacing a wrong card.
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
  // Confidence thresholds: distance < 30% of bits AND gap ≥ 4% AND clearly the
  // majority of frames. Tuned empirically — Many-Partings-style sticky errors
  // failed the gap test (winning by 1–2 bits) and now drop to no-confident.
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

// Debug: a data-URL of the exact card region we hash, to eyeball framing on-device.
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
