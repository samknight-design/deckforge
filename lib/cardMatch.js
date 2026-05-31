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

// ── IndexedDB cache for the binary hash DB ───────────────────────────────────
// Download the ~10 MB blob once per device, then load from local storage. The
// meta file's `builtAt` is the cache key — when Scryfall publishes new sets
// and we rebuild, the client picks up the new bin automatically.

const IDB_NAME = 'deckforge';
const IDB_STORE = 'hashdb';

function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function idbGet(key) {
  return new Promise(async (resolve) => {
    try {
      const db = await idbOpen();
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}
function idbPut(key, value) {
  return new Promise(async (resolve) => {
    try {
      const db = await idbOpen();
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(value, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    } catch { resolve(false); }
  });
}

// Load the legacy JSON spike DB (used by the Phase H0 match test).
async function loadJsonDb(url) {
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
  return { n, bytes, flat, ids, names, sets, cns, bits: bytes * 8 };
}

// Load the full binary DB (cards.bin + cards.idx.json + cards.meta.json),
// caching both blob and index in IndexedDB so it's a one-time download per device.
async function loadBinaryDb(binUrl, idxUrl, metaUrl) {
  // 1. Fetch the meta first so we know what builtAt key to use.
  const metaRes = await fetch(metaUrl, { cache: 'no-store' });
  if (!metaRes.ok) throw new Error(`meta ${metaRes.status}`);
  const meta = await metaRes.json();
  const key = `db@${meta.builtAt}`;

  // 2. Try cache.
  let cached = await idbGet(key);
  let bin, idx;
  if (cached?.bin && cached?.idx) {
    bin = cached.bin;
    idx = cached.idx;
  } else {
    // 3. Cold path — download + cache.
    const [binRes, idxRes] = await Promise.all([fetch(binUrl), fetch(idxUrl)]);
    if (!binRes.ok || !idxRes.ok) throw new Error('failed to download DB');
    bin = new Uint8Array(await binRes.arrayBuffer());
    idx = await idxRes.json();
    await idbPut(key, { bin, idx });
  }

  // 4. Parse the binary header.
  const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const magic = String.fromCharCode(bin[0], bin[1], bin[2], bin[3]);
  if (magic !== 'DFHB') throw new Error('bad hash DB magic');
  const version = view.getUint32(4, true);
  const count = view.getUint32(8, true);
  const bytes = view.getUint32(12, true);
  if (version !== 1) throw new Error(`unknown hash DB version ${version}`);
  if (idx.length !== count) throw new Error(`idx/bin count mismatch (${idx.length} vs ${count})`);

  // The hash bytes live in-place inside the loaded ArrayBuffer — no copy.
  const flat = new Uint8Array(bin.buffer, bin.byteOffset + 16, count * bytes);
  const ids = new Array(count), names = new Array(count), sets = new Array(count), cns = new Array(count);
  for (let i = 0; i < count; i++) {
    const r = idx[i];
    ids[i] = r.id; names[i] = r.name; sets[i] = r.set; cns[i] = r.cn;
  }
  return { n: count, bytes, flat, ids, names, sets, cns, bits: bytes * 8 };
}

// Public API. Pass a JSON spike DB URL (legacy) OR `{ bin, idx, meta }` for the
// full binary DB.
export async function loadMatchDb(source) {
  if (db) return db;
  if (loading) return loading;
  loading = (async () => {
    if (typeof source === 'string') {
      db = await loadJsonDb(source);
    } else {
      db = await loadBinaryDb(source.bin, source.idx, source.meta);
    }
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

// Read a source region's pixels into a canvas. When outW/outH are omitted,
// reads at native resolution (used by hashImageElement so the parity self-test
// hashes the same content the build script does). When provided, downscales to
// the requested size — the matching path uses ~200px for ~60× less work than
// native, with no accuracy loss because box-average dHash is scale-tolerant
// and the reference images were small (~146px) to begin with.
function regionPixels(source, sx, sy, sw, sh, outW, outH) {
  const W = Math.max(1, Math.round(outW ?? sw));
  const H = Math.max(1, Math.round(outH ?? sh));
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

// dHash from a sub-rectangle of a larger pixel buffer. Same math as
// dhashFromImageData but indexes into an offset window — lets us derive all
// alignment-shifted variants from ONE pixel read instead of cropping seven
// times.
function dhashFromSubRect(data, bufW, x0, y0, w, h, size = HASH_SIZE) {
  const gw = size + 1, gh = size;
  const grid = new Float64Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) {
    const sy0 = y0 + Math.floor((gy * h) / gh);
    const sy1 = y0 + Math.max(Math.floor((gy * h) / gh) + 1, Math.floor(((gy + 1) * h) / gh));
    for (let gx = 0; gx < gw; gx++) {
      const sx0 = x0 + Math.floor((gx * w) / gw);
      const sx1 = x0 + Math.max(Math.floor((gx * w) / gw) + 1, Math.floor(((gx + 1) * w) / gw));
      let sum = 0, cnt = 0;
      for (let y = sy0; y < sy1; y++) {
        const row = y * bufW;
        for (let x = sx0; x < sx1; x++) {
          const i = (row + x) * 4;
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

function frameHashes(video, opts = {}) {
  const det = detectCardRect(video, opts);
  if (!det) return null;
  const base = det.rect;
  if (!base || base.w < 4 || base.h < 4) return null;
  const vW = video.videoWidth, vH = video.videoHeight;

  // Crop the detected card + 10% margin into ONE 200px-wide buffer. All 7
  // variants come from this single buffer via dhashFromSubRect (no re-reading
  // pixels). 200px is plenty for dHash and ~60× cheaper than native res.
  const margin = 0.10;
  const cx = base.x + base.w / 2;
  const cy = base.y + base.h / 2;
  const bufSrcW = Math.min(vW, base.w * (1 + 2 * margin));
  const bufSrcH = Math.min(vH, base.h * (1 + 2 * margin));
  const bufSrcX = Math.max(0, cx - bufSrcW / 2);
  const bufSrcY = Math.max(0, cy - bufSrcH / 2);
  const W = 200;
  const H = Math.max(1, Math.round(bufSrcH * (W / bufSrcW)));
  const p = regionPixels(video, bufSrcX, bufSrcY, bufSrcW, bufSrcH, W, H);

  // Where the detected card sits inside that buffer (margin trimmed).
  const insetX = W * margin / (1 + 2 * margin);
  const insetY = H * margin / (1 + 2 * margin);
  const sw = W - 2 * insetX;
  const sh = H - 2 * insetY;

  const hashes = [];
  for (const v of VARIANTS) {
    const w = sw * v.s, h = sh * v.s;
    const vx = insetX + sw / 2 - w / 2 + sw * v.ox;
    const vy = insetY + sh / 2 - h / 2 + sh * v.oy;
    const x0 = Math.max(0, Math.round(vx));
    const y0 = Math.max(0, Math.round(vy));
    const cw = Math.min(W - x0, Math.round(w));
    const ch = Math.min(H - y0, Math.round(h));
    if (cw < 4 || ch < 4) continue;
    hashes.push(dhashFromSubRect(p.data, W, x0, y0, cw, ch));
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

// Multi-frame consensus: hash a small number of frames per scan with early
// exit on slam-dunk single-frame matches. Tie-break by mean distance across
// all frames a card appears in. Returns confident=false when the win isn't
// decisive — that's the seam where Claude Smart Scan takes over.
//
// Speed tuning: 2 frames default (was 7); first frame can short-circuit the
// rest if it's clearly correct. Single-frame accuracy was already high; the
// voting was insurance, and it cost a multi-second penalty.
export async function matchCardVoted(video, opts = {}, frames = 2) {
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

      // Early exit: a slam-dunk match (distance < 15% of bits AND runner-up
      // 12% bits behind) on the first frame is near-certain correct. Save the
      // remaining frames.
      const total = m.totalBits;
      if (f === 0 && m.distance <= total * 0.15 && (m.runnerUp - m.distance) >= total * 0.12) {
        break;
      }
    }
    if (f < frames - 1) await sleep(15);
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
