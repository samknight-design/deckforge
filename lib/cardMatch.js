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

// dHash of the framed card.
function frameHash(video, opts = {}) {
  const card = cardSourceRect(video, opts.vfW ?? VF_W, opts.vfH ?? VF_H);
  if (!card || card.w < 4 || card.h < 4) return null;
  const p = regionPixels(video, card.x, card.y, card.w, card.h);
  return { bytes: dhashFromImageData(p.data, p.w, p.h), card };
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
    distance: best, runnerUp: second, totalBits: bytes * 8, ms,
  };
}

// Debug: a data-URL of the exact card region we hash, to eyeball framing on-device.
export function previewCardCrop(video, opts = {}) {
  const card = cardSourceRect(video, opts.vfW ?? VF_W, opts.vfH ?? VF_H);
  if (!card || card.w < 4) return null;
  const c = document.createElement('canvas');
  const scale = 240 / card.w;
  c.width = Math.round(card.w * scale);
  c.height = Math.round(card.h * scale);
  c.getContext('2d').drawImage(video, card.x, card.y, card.w, card.h, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.7);
}
