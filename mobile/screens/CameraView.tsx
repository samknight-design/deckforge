// Card scanner — two modes toggled from the top bar:
//
// QUICK mode  — frame processor auto-identifies and immediately adds to the
//               selected destination. Flash indicator confirms each scan.
//               No popup. No foil (add those in the library afterwards).
//
// REVIEW mode — frame processor detects the card, then pauses and shows a
//               sheet so the user can set foil, change destination, and
//               confirm before the card is added.
//
// Frame.toArrayBuffer() requires minSdkVersion 26 (set in app.json, EAS
// rebuild needed). The worklet catches the error safely until then; use
// Force Scan as the fallback in that case.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  Camera,
  useCameraDevice,
  useCameraFormat,
  useCameraPermission,
  useFrameProcessor,
  runAtTargetFps,
} from 'react-native-vision-camera';
import { useSharedValue, useRunOnJS } from 'react-native-worklets-core';
import { useTensorflowModel, type TensorflowModelDelegate } from 'react-native-fast-tflite';
import { useResizePlugin } from 'vision-camera-resize-plugin';
import {
  OpenCV,
  ObjectType,
  DataTypes,
  ColorConversionCodes,
  RetrievalModes,
  ContourApproximationModes,
  InterpolationFlags,
  DecompTypes,
  BorderTypes,
} from 'react-native-fast-opencv';
import * as Haptics from 'expo-haptics';
import * as FileSystem from 'expo-file-system/legacy';
import { apiFetch } from '../lib/api';
import { addCardToDeck, addToLibrary, type Deck } from '../lib/db';
import { prepareScanDb, idAt, nameAt } from '../lib/scanLocal';
import { bestMatchMultiCrop } from '../lib/scanOpenCV';
import { useTheme } from '../lib/theme';
import { tryCompleteChallenge } from '../lib/challenges';
import { useXpToast } from '../lib/xpToast';
import DeckPickerSheet from '../components/DeckPickerSheet';
import QuadOverlay, { type QuadHandle } from '../components/QuadOverlay';

// ── Constants ─────────────────────────────────────────────────────────────────

// Bump this string whenever the scanner changes — it's shown on screen so we can
// confirm which build is actually running on the device (no more guessing).
const BUILD_TAG = 'v3-SERVER';

// S1.2 — delegate table (§2.5.3). Preference order per platform; index 0 is the
// production lead, later entries are fallbacks. On Android we lead with the GPU
// delegate (fp16 model → GPU-native), then CPU. A dev pill cycles through these
// for measurement; a load error auto-falls-back toward CPU.
const DELEGATE_TABLE: TensorflowModelDelegate[] = Platform.select({
  android: ['default', 'android-gpu', 'nnapi'],
  ios: ['default', 'core-ml'],
  default: ['default'],
}) as TensorflowModelDelegate[];

// Camera-thread detector: run the corner model as TFLite via react-native-fast-tflite
// INSIDE the frame-processor worklet (runSync). This removes the per-frame 196k-pixel
// worklet→JS marshal that throttled the JS-thread ONNX detector — the box now tracks at
// camera framerate. The heavy warp+embed still runs once per lock on the JS thread; the
// worklet hands it the frame pixels exactly once (captureNext). Flip to false to fall
// back to the proven JS-thread ONNX detector (onCornerFrame) if the worklet misbehaves.
const USE_TFLITE_DETECTOR = true;
const TFLITE_URL = 'file:///storage/emulated/0/Android/data/app.deckforge/files/corner.tflite';
// ── Detector rate (PERF SLIDERS) ─────────────────────────────────────────────
// The detector's normalise+inference (~40ms) runs on the camera thread EVERY frame it
// fires. Running it flat-out continuously is the main heat source (thermal throttle →
// the "gradually more laggy" you saw). So the rate is ADAPTIVE: crawl when no card is in
// view (just enough to notice one appear), ramp up only while actively tracking a card.
// These two numbers are the perf dials — lower = cooler/less lag, higher = snappier.
const DETECT_FPS_IDLE   = 4;   // no card in frame → just watch for one (low heat)
const DETECT_FPS_ACTIVE = 12;  // card in frame → track it smoothly
const MISS_BEFORE_RESET = 2; // hold the quad through only a 1-2 frame blip (~130ms), then HIDE it —
                             // so the box vanishes over the gap between cards (ManaBox: no card, no box)
                             // instead of coasting/swooping across to the next one.
// Card-presence gate: mean heatmap peak below this = no real card in frame → no box. Real cards
// score ~1.0-1.25 (measured), non-card desk/gaps score low, so a firm 0.40 cleanly rejects the gap.
const CARD_PRESENCE_MIN = 0.40;

// ── S2 One-Euro filter ───────────────────────────────────────────────────────
// Adaptive low-pass (Casiez et al. 2012) on the corner positions: at low speed the
// cutoff is low → heavy smoothing (rock-solid when the card is still); as the card
// moves, the cutoff rises with speed → light smoothing (tight follow, no lag). This
// replaces the fixed-alpha EMA, which had to compromise between jitter and lag.
// Tune live: OE_MIN_CUTOFF lower = steadier when still; OE_BETA higher = snappier
// when moving. Values are for corner coords in *frame pixels* at ~15 Hz.
const OE_MIN_CUTOFF = 0.5;   // Hz, cutoff at zero speed — LOW = reject hand tremor hard
const OE_BETA       = 0.007; // speed coefficient (px/s → added cutoff): still tracks real motion
const OE_DCUTOFF    = 1.0;   // derivative low-pass cutoff

function oeAlpha(cutoff: number, dt: number): number {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

// Continuous auto-scan: native OpenCV detects + flattens the card every (throttled)
// frame on the camera thread; the heavy 114k match runs once on the JS thread only
// when a card is held steady. No snapshot, no per-frame full-DB scan, no freeze.
// DISABLED during the Phase A embedding trial: the live frame processor + takeSnapshot
// crashes the Samsung camera session ("Error configuring streams: Broken pipe"), and
// for validating the matcher we use tap-to-scan with a fixed guide box instead.
const LIVE_AUTOSCAN = true;

// TUNING SWITCH — while we perfect on-device detection, escalation (OCR + AI) is
// OFF so every card must be carried by the art-hash alone. This gives a clean
// signal (no fallback hiding a bad warp) AND avoids the mid-stream takeSnapshot
// that was destabilising the camera session. Flip back ON to ship the polish.
const ESCALATION_ENABLED = false;

// DIAGNOSTIC — when true, every warped card image the matcher sees is saved to
// the app cache as a JPEG (throttled) so we can pull it and inspect exactly what
// the hash is computed from. Turn OFF for normal use.
const DUMP_WARP = false;
// DIAGNOSTIC — dump the COLOUR 256×256 crop the corner-model live path feeds to
// SigLIP, so we can pull it and see orientation/quality (the box can hug a card
// while the warp comes out upside-down → recognition fails). Turn OFF for normal use.
const DUMP_LIVE = false;

// PHASE A (embedding scanner trial) — when true, the Force Scan button captures a
// COLOUR card crop and POSTs it to the local SigLIP2 match server (reachable via
// `adb reverse tcp:8765`) instead of the on-device dHash path. Temporary test
// scaffold to validate embedding accuracy on real captures before building the
// on-device model. Turn OFF to restore the normal dHash Force Scan.
// ON-DEVICE embedding match (no server) — runs SigLIP2 + the 115k index on the phone.
// Takes priority over SERVER_MATCH when true.
const ONDEVICE_MATCH = true;
const SERVER_MATCH = true;
// Match-server URL. Default = loopback via `adb reverse tcp:8765` (cable, reliable).
// For untethered real-internet testing: run `scanner-spike/cloudflared.exe tunnel --url
// http://localhost:8765`, grab the https://….trycloudflare.com URL, and paste it here
// (it changes each tunnel restart). Later: the permanent hosted URL.
const MATCH_SERVER_URL = 'http://127.0.0.1:8765/match';
// SERVER_LIVE — route the LIVE auto-scan recognition to the desktop match server
// (adb reverse tcp:8765) instead of the on-device SigLIP. Test the server-side option:
// the phone only detects+warps and sends the crop, so the ~450MB models never load on
// the phone (no swap thrash) and the ~700ms embed never cooks it. Flip false → on-device.
const SERVER_LIVE = true;
// Embedding cosine confidence gate. Measured on real captures: correct matches
// ≥0.73, wrong matches ~0.63. Accept ≥ this, else ask for a realign+retry — so a
// bad/loose capture fails LOUD instead of adding the wrong card. Tune with data.
// Real cards (CPU encoder) score 0.856–0.918; fakes/garbage/bad-crops ≤0.75.
// 0.82 sits in the clean gap → genuine cards accept, a hand-drawn fake or loose
// crop is rejected ("realign & retry") instead of being force-matched. This is the
// rejection ManaBox does — it only commits when it's actually confident.
const CONF_MIN = 0.82;
// Reprints share art → a real card's top-K embed matches are the SAME NAME (different
// printings); garbage matches random different names. So accept a sub-CONF_MIN match when
// the top-K reach name CONSENSUS ("treat same-name ties as confident"). Live warps of hard
// cards (splits, showcase) sit ~0.72-0.79 and were being wrongly rejected at 0.82.
const NAME_CONSENSUS_MIN = 0.72; // floor below which even same-name consensus isn't trusted
                                 // (0.68 let an angle-distorted warp false-accept at 0.695)
const TEMPORAL_MIN = 0.74;    // min score to count toward temporal (cross-attempt) consensus
const TEMPORAL_FRAMES = 2;    // same card N consecutive attempts → accept (rescues borderline 1-printing cards)

// dist ≤ this counts as a confident match. gap is NOT used — reprints share
// artwork, so the runner-up is often another printing of the SAME card (gap≈0).
const AUTO_MAX_DIST        = 72;
const AI_ESCALATE_MS       = 3500;  // give the art-fingerprint a real chance before escalating
const STABLE_FRAMES_NEEDED = 3;     // back to the known-good measured-run value
const FRAME_THROTTLE       = 1;     // liveBusy lock is the real gate now; no artificial spacing
const SCAN_COOLDOWN_MS     = 1500;  // pause after a hit before re-arming
const MAX_FREE_AI_SCANS    = 10;

// Live OpenCV processing + warp geometry
const PROC_LONG     = 480;          // detection resolution (long side)
const WARP_W        = 146;          // warped card size fed to the matcher
const WARP_H        = 204;
const MIN_AREA_FRAC = 0.08;         // card quad must cover ≥8% of the frame
const ASPECT_LO     = 0.55;         // card ratio 63/88 ≈ 0.716
const ASPECT_HI     = 0.92;

// ── Lock-on HUD ────────────────────────────────────────────────────────────────
// The tracking box springs from this centred resting size onto the detected card.
const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const BOX_W = 232;                  // resting HUD box size (matches old viewfinder)
const BOX_H = 324;
// Frame(proc, landscape) → portrait screen mapping. The back camera sensor is
// rotated 90° vs the display; we rotate counter-clockwise (matches observed
// tracking) then COVER-scale with a SINGLE factor so the box keeps the card's
// true aspect ratio (per-axis fraction mapping squashed it). Flips are
// calibration knobs — toggle on device if the box mirrors the card.
const MAP_FLIP_X = false;           // flip the horizontal (screen-X) axis
const MAP_FLIP_Y = false;           // flip the vertical   (screen-Y) axis

// Minimal base64 encoder (no Buffer polyfill dependency) — used by the warp dump.
function bytesToBase64(bytes: Uint8Array): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += chars[(n >> 18) & 63] + chars[(n >> 12) & 63] + chars[(n >> 6) & 63] + chars[n & 63];
  }
  const rem = bytes.length - i;
  if (rem === 1) { const n = bytes[i] << 16; out += chars[(n >> 18) & 63] + chars[(n >> 12) & 63] + '=='; }
  else if (rem === 2) { const n = (bytes[i] << 16) | (bytes[i + 1] << 8); out += chars[(n >> 18) & 63] + chars[(n >> 12) & 63] + chars[(n >> 6) & 63] + '='; }
  return out;
}

// SERVER_LIVE — recognize a 256×256 RGBA colour crop on the desktop match server instead
// of on-device. Encodes → JPEG → base64 → POST /match. Returns the SAME shape the on-device
// embedAndMatch returns ({matches:[{id,name,set,cn,score}], embMs, matchMs}) so onGrabbedFrame's
// accept/consensus/add logic is unchanged. The heavy SigLIP + 115k match runs on the server.
type LiveMatch = { id: string; name: string; set: string; cn: string; score: number };
async function serverMatchRgba(rgba: Uint8Array, size = 256): Promise<{ matches: LiveMatch[]; embMs: number; matchMs: number }> {
  const g = global as any;
  if (typeof g.Buffer === 'undefined') g.Buffer = require('buffer').Buffer;
  const jpeg = await import('jpeg-js');
  const enc = (jpeg as any).encode({ data: rgba, width: size, height: size }, 80);
  const imgB64 = bytesToBase64(enc.data as Uint8Array);
  const t0 = Date.now();
  const res = await fetch(MATCH_SERVER_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_b64: imgB64 }),
  });
  const rtt = Date.now() - t0;
  const data = await res.json().catch(() => ({} as any));
  return { matches: (data?.matches ?? []) as LiveMatch[], embMs: data?.ms ?? rtt, matchMs: rtt };
}

// ── Worklet helpers ───────────────────────────────────────────────────────────
// Run on the camera thread — no external imports, all logic self-contained.

function dhashFromBytes(
  bytes: Uint8Array,
  frameW: number,
  frameH: number,
  bytesPerRow: number,
  isYuv: boolean,
  size: number,
): Uint8Array {
  'worklet';
  const cardAspect = 63 / 88;
  let cropW = frameW;
  let cropH = Math.round(frameW / cardAspect);
  if (cropH > frameH) { cropH = frameH; cropW = Math.round(frameH * cardAspect); }
  const cropX = Math.floor((frameW - cropW) / 2);
  const cropY = Math.floor((frameH - cropH) / 2);
  const gw = size + 1, gh = size;
  const grid: number[] = new Array(gw * gh).fill(0);
  const step = isYuv ? 1 : 4;
  for (let gy = 0; gy < gh; gy++) {
    const y0 = cropY + Math.floor((gy * cropH) / gh);
    const y1 = cropY + Math.max(y0 - cropY + 1, Math.floor(((gy + 1) * cropH) / gh));
    for (let gx = 0; gx < gw; gx++) {
      const x0 = cropX + Math.floor((gx * cropW) / gw);
      const x1 = cropX + Math.max(x0 - cropX + 1, Math.floor(((gx + 1) * cropW) / gw));
      let sum = 0, cnt = 0;
      // Sample ~4×4 points per cell regardless of resolution — keeps the
      // per-frame cost flat even at 720p.
      const sx = Math.max(1, Math.floor((x1 - x0) / 4));
      const sy = Math.max(1, Math.floor((y1 - y0) / 4));
      for (let fy = y0; fy < y1; fy += sy) {
        const rowBase = fy * bytesPerRow;
        for (let fx = x0; fx < x1; fx += sx) {
          sum += isYuv ? bytes[rowBase + fx]
            : (77 * bytes[rowBase + fx * step] + 150 * bytes[rowBase + fx * step + 1] + 29 * bytes[rowBase + fx * step + 2]) >> 8;
          cnt++;
        }
      }
      grid[gy * gw + gx] = cnt > 0 ? sum / cnt : 0;
    }
  }
  const out = new Uint8Array((size * size) >> 3);
  let bit = 0;
  for (let gy = 0; gy < gh; gy++)
    for (let gx = 0; gx < size; gx++) {
      if (grid[gy * gw + gx] < grid[gy * gw + gx + 1]) out[bit >> 3] |= (0x80 >> (bit & 7));
      bit++;
    }
  return out;
}

function matchHashWorklet(
  query: Uint8Array, flat: Uint8Array, count: number, bph: number, pc: number[],
): { index: number; distance: number; runnerUp: number } {
  'worklet';
  let best = bph * 8 + 1, second = best, bi = -1;
  for (let i = 0; i < count; i++) {
    const off = i * bph;
    let dist = 0;
    for (let b = 0; b < bph; b++) {
      dist += pc[query[b] ^ flat[off + b]];
      if (dist >= best) { dist = best; break; }
    }
    if (dist < best) { second = best; best = dist; bi = i; }
    else if (dist < second) second = dist;
  }
  return { index: bi, distance: best, runnerUp: second };
}

type Pt = { x: number; y: number };

function hypotW(a: Pt, b: Pt): number {
  'worklet';
  const dx = a.x - b.x, dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

// Order 4 points to [tl,tr,br,bl] and force a portrait mapping so a sideways card
// still warps upright. 180° ambiguity is handled by matching both ends later.
function orderQuadPortraitW(pts: Pt[]): Pt[] {
  'worklet';
  let tl = pts[0], tr = pts[0], br = pts[0], bl = pts[0];
  let minS = 1e18, maxS = -1e18, minD = 1e18, maxD = -1e18;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]; const s = p.x + p.y, d = p.x - p.y;
    if (s < minS) { minS = s; tl = p; }
    if (s > maxS) { maxS = s; br = p; }
    if (d > maxD) { maxD = d; tr = p; }
    if (d < minD) { minD = d; bl = p; }
  }
  let ord = [tl, tr, br, bl];
  const w = (hypotW(ord[0], ord[1]) + hypotW(ord[3], ord[2])) / 2;
  const h = (hypotW(ord[0], ord[3]) + hypotW(ord[1], ord[2])) / 2;
  if (w > h) ord = [ord[1], ord[2], ord[3], ord[0]];
  return ord;
}

// 4 corners of minAreaRect's center/size/angle (worklet).
function rectCornersW(r: { centerX: number; centerY: number; width: number; height: number; angle: number }): Pt[] {
  'worklet';
  const rad = (r.angle * Math.PI) / 180;
  const c = Math.cos(rad), s = Math.sin(rad);
  const hw = r.width / 2, hh = r.height / 2;
  const d = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
  const out: Pt[] = [];
  for (let i = 0; i < 4; i++) out.push({ x: r.centerX + d[i][0] * c - d[i][1] * s, y: r.centerY + d[i][0] * s + d[i][1] * c });
  return out;
}

// ── Types ─────────────────────────────────────────────────────────────────────

type Engine = 'local' | 'smart' | 'ocr' | 'embed';

type ScannedCard = {
  scryfall_id: string;
  card_name: string;
  image_uri?: string | null;
  type_line?: string;
  set_name?: string;
  set_code?: string;
  price_eur?: number | null;
  _engine?: Engine;
  // DIAGNOSTIC fields (shown in the review sheet so we can read real numbers)
  _dist?: number;
  _gap?: number;
  _detected?: boolean;
  _confident?: boolean;
  _contours?: number;
  _quads?: number;
};

type ScanNotif = { type: 'success' | 'warn' | 'error'; text: string; sub?: string; engine?: Engine };

// ── Component ─────────────────────────────────────────────────────────────────

export default function CameraView({
  userId,
  targetDeck,
  onBack,
}: {
  userId: string;
  targetDeck?: Deck | null;
  onBack: () => void;
}) {
  const { colors, formatPrice } = useTheme();
  const { showXp } = useXpToast();
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('back');
  const mounted = useRef(true);
  const cameraRef = useRef<Camera>(null);
  const notifTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rejectSince = useRef(0); // when a steady card first failed to match (for AI escalation)
  const captureCooldownUntil = useRef(0); // throttle between background recognition attempts (ms epoch)
  const captureArmed = useRef(true);      // ONE grab per settle: consumed on capture, re-armed when the card moves / leaves
  const lastDumpAt = useRef(0);  // throttle for the DUMP_WARP diagnostic
  const dumpIdx = useRef(0);     // rotating filename index for warp dumps
  const lastQuadCx = useRef(0);  // last corner-model quad centroid (frame space, stability)
  const lastQuadCy = useRef(0);
  // S2 One-Euro filter state for the 8 corner scalars ([tl,tr,br,bl] × x,y, frame space).
  // xr = last raw sample (for the derivative), xf = last filtered output, df = last
  // filtered derivative, t = last timestamp (ms). emaValid gates seeding (kept as the
  // name because every reset site already flips it): false → next detection re-seeds.
  const oe = useRef<{ xr: number[]; xf: number[]; df: number[]; t: number }>({ xr: [], xf: [], df: [], t: 0 });
  const emaValid = useRef(false); // false → next detection re-seeds the filter (no drag from a stale lock)

  // Crisp preview (720p). The dhash worklet samples with a stride, so its cost
  // stays bounded regardless of frame resolution — no need to cripple the preview.
  const format = useCameraFormat(device, [
    { videoResolution: { width: 1280, height: 720 } },
  ]);

  // Pulls frame pixels into a resized buffer inside the worklet (no snapshot).
  const { resize } = useResizePlugin();

  // ── State ──────────────────────────────────────────────────────────────────

  const [quickMode, setQuickMode]           = useState(true);
  const [resolving, setResolving]           = useState(false);
  const [manualScanning, setManualScanning] = useState(false);
  const [isFoil, setIsFoil]                = useState(false);
  const [currentDeck, setCurrentDeck]       = useState<Deck | undefined>(targetDeck ?? undefined);
  // deck picker can be opened from top bar (quick) or result sheet (review)
  const [deckPickerVisible, setDeckPickerVisible] = useState(false);
  const [aiScansUsed, setAiScansUsed]       = useState(0);
  const [aiThinking, setAiThinking]         = useState(false); // escalation in progress (highlights viewfinder)
  const [escalateMsg, setEscalateMsg]       = useState<string | null>(null); // "🔤 Reading text…" / "✨ Asking AI…"
  const [reading, setReading]               = useState(false); // "🔍 Reading card…" (card detected, working)
  const readingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // quick mode: flash notification
  const [scanNotif, setScanNotif]           = useState<ScanNotif | null>(null);
  // review mode: result sheet
  const [result, setResult]                 = useState<ScannedCard | null>(null);

  // Hash DB
  const [dbFlat, setDbFlat]   = useState<Uint8Array | null>(null);
  const [dbCount, setDbCount] = useState(0);
  const [dbIds, setDbIds]     = useState<Uint8Array | null>(null);
  const [dbNames, setDbNames] = useState<Uint8Array | null>(null);

  // On-screen diagnostics (the user can't read Metro logs)
  const [loadStage, setLoadStage] = useState('Starting…');
  const [embedStatus, setEmbedStatus] = useState(ONDEVICE_MATCH ? 'on-device: loading…' : '');
  const [loadError, setLoadError] = useState<string | null>(null);
  // 'unknown' until the frame processor runs once; 'active' if raw pixels work,
  // 'unavailable' if frame.toArrayBuffer() throws (needs the minSdkVersion-26 build)
  const [fpStatus, setFpStatus] = useState<'unknown' | 'active' | 'unavailable'>('unknown');
  // Live match readout (DIAGNOSTIC): best Hamming distance + gap, updated a few
  // times per second from the frame processor, so we can see how close matches are.
  const [liveDist, setLiveDist] = useState<number | null>(null);
  const [liveGap, setLiveGap]   = useState<number | null>(null);
  // 0 = no card, 1 = card detected (unsteady), 2 = stable/locked
  const [alignState, setAlignState] = useState<0 | 1 | 2>(0);

  // ── Collect-mode (training-data capture) ───────────────────────────────────
  // Pure-JS capture path for the real-data detector pipeline: when ON, the scanner
  // stops recognising and instead snapshots the exact 256×256 frame the corner
  // detector sees + its predicted corners (256-space, so they overlay the saved
  // JPEG 1:1). Build real holder/multi-card data on your own collection → fine-tune
  // the detector. No native rebuild needed — toggled live on the phone.
  const [collectMode, setCollectMode]   = useState(false);
  const collectModeRef                  = useRef(false); // read on the camera-thread callback (no stale closure)
  const [collectCount, setCollectCount] = useState(0);
  const collectCountRef                 = useRef(0);
  const collectSaving                   = useRef(false); // guard double-save on rapid taps
  const lastFrameRgb = useRef<Uint8Array | null>(null);  // latest 256² RGB the detector saw
  const lastCorners  = useRef<number[][] | null>(null);  // its predicted corners (256-space) or null
  const [popcountTable]       = useState<number[]>(() => {
    const t = new Array(256); t[0] = 0;
    for (let i = 1; i < 256; i++) t[i] = (i & 1) + t[i >> 1];
    return t;
  });

  // ── Shared values ──────────────────────────────────────────────────────────

  const consecutiveCount = useSharedValue(0);
  const lastMatchIndex   = useSharedValue(-1);
  const scanBlocked      = useSharedValue(false); // freezes the detector — for manual/Force-Scan snapshots ONLY
  const recognizing      = useSharedValue(false); // a background embed is in flight — gates CAPTURE, never the box tracking
  const cardActiveSV     = useSharedValue(false); // worklet: a card is currently in frame → run the detector at the active (faster) rate
  const fpReported       = useSharedValue(false); // report fp health to JS only once
  const fpErrReported    = useSharedValue(false); // report a worklet error only once
  const frameTick        = useSharedValue(0);     // throttle counter
  const dbReady          = useSharedValue(false);  // gate (avoids capturing 3.5MB in the worklet)
  const embedReady       = useSharedValue(false);  // gate: embedding model + index fully loaded
  const liveBusy         = useSharedValue(false);  // corner pipeline in-flight → worklet skips marshalling
  const lastCx           = useSharedValue(0);      // last detected card centroid (stability)
  const lastCy           = useSharedValue(0);
  const stableCount      = useSharedValue(0);      // consecutive steady detections
  const alignSV          = useSharedValue(0);      // mirrors alignState in the worklet (avoids per-frame JS calls)
  const captureNext      = useSharedValue(false);  // JS → worklet: deliver ONE frame's pixels (lock → warp+embed)
  const collectGrab      = useSharedValue(false);  // collect-mode shutter → worklet: deliver one frame to save
  const tfReady          = useSharedValue(false);  // TFLite corner model loaded (worklet gate)
  // S0 perf HUD — the worklet writes these timings; JS polls them (worklet shared-value
  // writes don't trigger a React re-render, so a light interval reads them for display).
  const hudDetMs         = useSharedValue(0);      // last detector runSync duration (ms)
  const hudWlMs          = useSharedValue(0);      // last full frame-processor callback duration (ms)
  const hudDetCount      = useSharedValue(0);      // detector runs so far → effective Hz via delta
  const hudResizeMs      = useSharedValue(0);      // resize()  ms (budget breakdown)
  const hudNormMs        = useSharedValue(0);      // uint8→float32 ImageNet normalise loop ms
  const hudDecodeMs      = useSharedValue(0);      // heatmap argmax+centroid decode ms

  // TFLite corner detector — loaded once from the device files dir. The source MUST be a
  // stable ref: a fresh { url } literal each render made the hook reload the model on EVERY
  // render (the scanner re-renders constantly) → hundreds of model loads → OOM crash + the
  // "failed to load Tensorflow Model" ×200 spam. useMemo loads it exactly once.
  const tfSource = useMemo(() => ({ url: TFLITE_URL }), []);
  // S1.2 — delegate selection. Cycled by a dev pill for measurement; auto-falls-back
  // toward CPU on a load error. The hook reloads the model whenever `delegate` changes.
  const [delegateIdx, setDelegateIdx] = useState(0); // CPU default (delegates gave no real gain — S1.2)
  const delegate = DELEGATE_TABLE[delegateIdx] ?? 'default';
  const tflite  = useTensorflowModel(tfSource, delegate);
  // Only expose the model object when the TFLite detector is actually active. Otherwise
  // the Nitro HybridObject leaks into the vision-camera worklet closure and throws
  // ("no NativeState") because worklets-core can't share it. ONNX mode → null.
  const tfModel = (USE_TFLITE_DETECTOR && tflite.state === 'loaded') ? tflite.model : null;
  // The delegate that ACTUALLY bound — a GPU/NNAPI delegate can silently fall back to
  // CPU inside TFLite, so surface the real one so measurement isn't fooled.
  const activeDelegate = tflite.state === 'loaded' ? tflite.model.delegate : delegate;
  useEffect(() => {
    tfReady.value = tfModel != null;
    console.log('[detector]', USE_TFLITE_DETECTOR ? 'TFLITE' : 'ONNX', '·', BUILD_TAG, '· req:', delegate, '· tflite:', tflite.state);
    if (tflite.state === 'error') {
      console.warn(`[tflite] load error (delegate=${delegate})`, tflite.error);
      if (delegate !== 'default') setDelegateIdx(0); // per-device delegate failed → CPU
      else if (USE_TFLITE_DETECTOR) setEmbedStatus(`tflite load failed: ${String(tflite.error).slice(0, 60)}`);
    } else if (tflite.state === 'loaded') {
      console.log(`[tflite] corner model loaded ✓ (delegate=${tflite.model.delegate})`);
    }
  }, [tflite, tfModel, tfReady, delegate]);

  // Called from the worklet (once) to report whether raw-pixel access works.
  const reportFp = useRunOnJS((ok: boolean) => {
    if (mounted.current) setFpStatus(ok ? 'active' : 'unavailable');
  }, []);

  // ── Lock-on tracking box (native-driver transforms; no per-frame re-render) ──
  // A single outlined rect that springs from centre onto the detected card.
  const trackTX = useRef(new Animated.Value(0)).current;  // translateX from centre
  const trackTY = useRef(new Animated.Value(0)).current;  // translateY from centre
  const trackSX = useRef(new Animated.Value(1)).current;  // scaleX vs BOX_W
  const trackSY = useRef(new Animated.Value(1)).current;  // scaleY vs BOX_H
  const trackRot = useRef(new Animated.Value(0)).current; // rotation (deg) to match card tilt
  const quadRef = useRef<QuadHandle>(null); // S3 interim — true perspective-quad overlay
  const lastAlign = useRef(0);
  const lastRot = useRef(0);
  const missCount = useRef(0); // consecutive no-card frames (hysteresis so a brief gap doesn't snap the box)
  // ── S0 perf HUD (dev-only, toggle from the top bar) ──────────────────────────
  const [showHud, setShowHud] = useState(true);
  const [hud, setHud] = useState({ det: 0, wl: 0, hz: 0, emb: 0, match: 0, lock: 0, id: 0, rz: 0, nm: 0, dc: 0 });
  const firstSeenRef    = useRef(0);     // ts a valid card quad first entered frame (e2e timers)
  const lockRecordedRef = useRef(false); // latch so lock ms is captured once per card
  const hudLockRef  = useRef(0);         // last e2e lock ms (corners → LOCKED)
  const hudIdRef    = useRef(0);         // last e2e ID ms (corners → confident add)
  const hudEmbRef   = useRef(0);         // last SigLIP embed-confirm ms
  const hudMatchRef = useRef(0);         // last matcher ms
  const lastTopId = useRef('');   // top-match id across attempts (temporal consensus)
  const lastTopCount = useRef(0);
  const lastAddedId = useRef(''); // last auto-added card id — skip re-adding it while still in frame (cleared on card-exit)
  // Actual rendered preview size (measured) — the camera draws edge-to-edge, which
  // is LARGER than Dimensions.get('window') (that excludes the status bar). Using
  // the real size is what makes the overlay land exactly on the card.
  const viewSize = useRef({ w: SCREEN_W, h: SCREEN_H });

  const springTo = useCallback((tx: number, ty: number, sx: number, sy: number, rot = 0) => {
    // Snappier than before (higher tension, a touch more friction to avoid overshoot)
    // so the box tracks the card rather than lagging behind it. EMA upstream removes
    // the jitter that a stiff spring would otherwise amplify.
    const cfg = { useNativeDriver: true, friction: 9, tension: 130 } as const;
    Animated.spring(trackTX, { toValue: tx, ...cfg }).start();
    Animated.spring(trackTY, { toValue: ty, ...cfg }).start();
    Animated.spring(trackSX, { toValue: sx, ...cfg }).start();
    Animated.spring(trackSY, { toValue: sy, ...cfg }).start();
    Animated.spring(trackRot, { toValue: rot, ...cfg }).start();
  }, [trackTX, trackTY, trackSX, trackSY, trackRot]);

  // Map one processed-frame point → portrait-screen point. Rotates the landscape
  // frame counter-clockwise (rotW=ph, rotH=pw) then COVER-scales with a SINGLE
  // factor (+ centre crop), so aspect is preserved exactly.
  const mapPoint = useCallback((fx: number, fy: number, pw: number, ph: number) => {
    const VW = viewSize.current.w, VH = viewSize.current.h;
    const rotW = ph, rotH = pw;
    let rx = fy;            // CCW: new-x = old-y
    let ry = pw - fx;       // CCW: new-y = (oldW - old-x)
    if (MAP_FLIP_X) rx = rotW - rx;
    if (MAP_FLIP_Y) ry = rotH - ry;
    const s = Math.max(VW / rotW, VH / rotH);
    return { x: rx * s - (rotW * s - VW) / 2, y: ry * s - (rotH * s - VH) / 2 };
  }, []);

  // S2 — One-Euro filter over the 8 corner scalars. `emaValid.current === false`
  // seeds the filter from the current sample (fresh acquisition, no drag across a
  // gap); every reset site already flips emaValid false. Returns the filtered array.
  const oneEuro8 = useCallback((raw: number[]): number[] => {
    const s = oe.current;
    const now = Date.now();
    if (!emaValid.current || s.xf.length !== raw.length) {
      s.xr = raw.slice(); s.xf = raw.slice(); s.df = new Array(raw.length).fill(0);
      s.t = now; emaValid.current = true;
      return s.xf.slice();
    }
    const dt = Math.max(0.001, (now - s.t) / 1000); // seconds
    const out = new Array(raw.length);
    for (let i = 0; i < raw.length; i++) {
      const dx = (raw[i] - s.xr[i]) / dt;
      const aD = oeAlpha(OE_DCUTOFF, dt);
      const edx = aD * dx + (1 - aD) * s.df[i];
      const cutoff = OE_MIN_CUTOFF + OE_BETA * Math.abs(edx);
      const aX = oeAlpha(cutoff, dt);
      const xf = aX * raw[i] + (1 - aX) * s.xf[i];
      s.xr[i] = raw[i]; s.df[i] = edx; s.xf[i] = xf; out[i] = xf;
    }
    s.t = now;
    return out;
  }, []);

  // Called from the worklet EVERY detected frame with the FOUR ordered card
  // corners (proc px) + frame dims + alignment state. Fits a rotated rectangle to
  // the real corners → true centre, true size, true tilt (no bounding-box drift).
  const reportCard = useRunOnJS((
    x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number,
    pw: number, ph: number, state: number,
  ) => {
    if (!mounted.current) return;
    const p0 = mapPoint(x0, y0, pw, ph), p1 = mapPoint(x1, y1, pw, ph);
    const p2 = mapPoint(x2, y2, pw, ph), p3 = mapPoint(x3, y3, pw, ph);
    const cx = (p0.x + p1.x + p2.x + p3.x) / 4;
    const cy = (p0.y + p1.y + p2.y + p3.y) / 4;
    const d = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
    const w = (d(p0, p1) + d(p2, p3)) / 2;   // top/bottom edges = card width
    const h = (d(p1, p2) + d(p3, p0)) / 2;   // side edges = card height
    // Tilt from the top edge; normalise via 180° symmetry to avoid spin jumps.
    let ang = (Math.atan2(p1.y - p0.y, p1.x - p0.x) * 180) / Math.PI;
    while (ang - lastRot.current > 90) ang -= 180;
    while (ang - lastRot.current < -90) ang += 180;
    lastRot.current = ang;
    springTo(
      cx - viewSize.current.w / 2,
      cy - viewSize.current.h / 2,
      Math.max(0.2, Math.min(2.4, w / BOX_W)),
      Math.max(0.2, Math.min(2.4, h / BOX_H)),
      ang,
    );
    if (state !== lastAlign.current) { lastAlign.current = state; setAlignState(state as 0 | 1 | 2); }
  }, [springTo, mapPoint]);

  // Called from the worklet when no card is in view → box glides back to centre.
  const onNoCard = useRunOnJS(() => {
    if (!mounted.current) return;
    missCount.current += 1;
    if (missCount.current < MISS_BEFORE_RESET) return; // hold the quad through a brief detection gap (coast)
    firstSeenRef.current = 0; lockRecordedRef.current = false; // S0 HUD: card left → reset e2e timers
    lastAddedId.current = ''; // card left → allow the next card (or this one re-presented) to be added
    captureArmed.current = true; // card left → re-arm so the next card grabs a fresh still frame
    lastRot.current = 0;
    emaValid.current = false; // real loss (coast expired) → next acquisition re-seeds the filter fresh
    quadRef.current?.set(null, '#10b981'); // hide the perspective quad (card lost)
    springTo(0, 0, 1, 1, 0);
    if (lastAlign.current !== 0) { lastAlign.current = 0; setAlignState(0); }
  }, [springTo]);

  // Swallow the recoverable Samsung session-config error ('Broken pipe' on stream config
  // when isActive/frameProcessor toggle) so it doesn't spam the dev error overlay. The
  // camera recovers and streams fine; surface only genuinely unexpected errors.
  const onCameraError = useCallback((e: { code?: string; message?: string }) => {
    const code = e?.code ?? '';
    if (code === 'session/invalid-output-configuration' || /Broken pipe/i.test(String(e?.message))) {
      console.log('[camera] recoverable session config error (ignored)');
      return;
    }
    console.warn('[camera] error:', code, e?.message);
  }, []);

  // Called from the worklet (throttled) with the live best distance/gap.
  const reportMatch = useRunOnJS((dist: number, gap: number) => {
    if (!mounted.current) return;
    setLiveDist(dist);
    setLiveGap(gap);
  }, []);

  // Called once if the live OpenCV worklet throws — surfaced so we can see it.
  const onFpError = useRunOnJS((msg: string) => {
    if (mounted.current) Alert.alert('Live scan error', msg.slice(0, 300));
  }, []);

  // ── Notification animation (quick mode) ───────────────────────────────────

  const notifAnim = useRef(new Animated.Value(0)).current;

  const showNotif = useCallback((n: ScanNotif) => {
    if (notifTimer.current) clearTimeout(notifTimer.current);
    notifAnim.stopAnimation();
    notifAnim.setValue(0);
    setScanNotif(n);
    Animated.spring(notifAnim, { toValue: 1, useNativeDriver: true, friction: 7, tension: 120 }).start();
    notifTimer.current = setTimeout(() => {
      Animated.timing(notifAnim, { toValue: 0, duration: 350, useNativeDriver: true }).start(() => {
        if (mounted.current) setScanNotif(null);
      });
    }, 2200);
  }, [notifAnim]);

  // Result sheet animation (review mode)
  const sheetAnim = useRef(new Animated.Value(400)).current;
  useEffect(() => {
    if (result) {
      Animated.spring(sheetAnim, { toValue: 0, useNativeDriver: true, friction: 8, tension: 120 }).start();
    } else {
      sheetAnim.setValue(400);
    }
  }, [result, sheetAnim]);

  // ── DB loading ─────────────────────────────────────────────────────────────

  useEffect(() => {
    mounted.current = true;
    prepareScanDb((s) => { if (mounted.current) setLoadStage(s); })
      .then(({ db, ids, names }) => {
        if (!mounted.current) return;
        setDbFlat(db.flat);
        setDbCount(db.count);
        setDbIds(ids);
        setDbNames(names);
        dbReady.value = true;
        // Warm up the OCR name dictionary in the background so the first
        // escalation isn't delayed building it.
        import('../lib/scanOcr').then(m => m.ensureNameIndex()).catch(() => {});
      })
      .catch((e) => {
        console.warn('[scan] DB load failed:', e);
        if (mounted.current) setLoadError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      mounted.current = false;
      if (notifTimer.current) clearTimeout(notifTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!hasPermission) requestPermission().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Warm up the on-device embedding model + index (loads ~280MB; takes a few sec).
  useEffect(() => {
    if (SERVER_LIVE) {
      // Server-side recognition: DON'T load the on-device SigLIP (~450MB) at all — that's the
      // whole point of the test (keep the phone light). Mark ready so captures proceed; the
      // desktop match server does the recognition. Ping /health so the status reflects reality.
      embedReady.value = true;
      fetch(MATCH_SERVER_URL.replace('/match', '/health'))
        .then(r => r.json())
        .then(d => { if (mounted.current) setEmbedStatus(`server ✓ ${d?.cards ?? '?'} cards`); })
        .catch(() => { if (mounted.current) setEmbedStatus('server: unreachable (adb reverse 8765?)'); });
      return;
    }
    if (!ONDEVICE_MATCH) return;
    import('../lib/embedScan')
      .then(m => m.initEmbedScan(s => { if (mounted.current) setEmbedStatus(s); }))
      .then(() => { embedReady.value = true; })
      .catch(e => {
        console.log('[embed-init-error]', e?.message || String(e), e?.stack || '');
        if (mounted.current) setEmbedStatus('embed init failed: ' + (e?.message || e));
      });
  }, []);

  // S0 perf HUD poll — reads the worklet timing shared values + JS-side e2e refs
  // ~2.5×/s and folds them into one setState (never per-frame). Effective detection
  // Hz = Δ(detector run count) / Δt.
  useEffect(() => {
    if (!showHud) return;
    let lastCount = hudDetCount.value, lastT = Date.now();
    const t = setInterval(() => {
      const now = Date.now(), c = hudDetCount.value;
      const dt = Math.max(1, now - lastT);
      const hz = Math.round(((c - lastCount) * 1000 / dt) * 10) / 10;
      lastCount = c; lastT = now;
      // EMA-smooth the per-frame worklet timings (spec asks for rolling averages);
      // hz is already a windowed average over the poll interval.
      setHud(prev => ({
        det: prev.det ? Math.round(hudDetMs.value * 0.35 + prev.det * 0.65) : Math.round(hudDetMs.value),
        wl: prev.wl ? Math.round(hudWlMs.value * 0.35 + prev.wl * 0.65) : Math.round(hudWlMs.value),
        hz,
        emb: hudEmbRef.current,
        match: hudMatchRef.current,
        lock: hudLockRef.current,
        id: hudIdRef.current,
        rz: prev.rz ? Math.round(hudResizeMs.value * 0.35 + prev.rz * 0.65) : Math.round(hudResizeMs.value),
        nm: prev.nm ? Math.round(hudNormMs.value * 0.35 + prev.nm * 0.65) : Math.round(hudNormMs.value),
        dc: prev.dc ? Math.round(hudDecodeMs.value * 0.35 + prev.dc * 0.65) : Math.round(hudDecodeMs.value),
      }));
    }, 400);
    return () => clearInterval(t);
  }, [showHud, hudDetCount, hudDetMs, hudWlMs, hudResizeMs, hudNormMs, hudDecodeMs]);

  // ── Helpers ────────────────────────────────────────────────────────────────

  const resetScanner = useCallback((delayMs = 0) => {
    const go = () => {
      if (!mounted.current) return;
      scanBlocked.value = false;
      consecutiveCount.value = 0;
      lastMatchIndex.value = -1;
      alignSV.value = 0;
      stableCount.value = 0;
      lastAlign.current = 0;
      setAlignState(0);
      springTo(0, 0, 1, 1);  // glide the lock-on box back to centre
    };
    if (delayMs > 0) setTimeout(go, delayMs);
    else go();
  }, [scanBlocked, consecutiveCount, lastMatchIndex, alignSV, stableCount, springTo]);

  const doAdd = useCallback(async (card: ScannedCard, foil: boolean, deck: Deck | undefined) => {
    await addToLibrary(userId, { scryfall_id: card.scryfall_id, card_name: card.card_name }, foil).catch(() => {});
    if (deck) {
      await addCardToDeck(deck.id, { scryfall_id: card.scryfall_id, card_name: card.card_name }, foil).catch(() => {});
      tryCompleteChallenge(userId, 'add_to_deck').then(r => {
        if (r.justCompleted && mounted.current) showXp(r.xpEarned, 'Deck Builder complete!');
      });
    }
    tryCompleteChallenge(userId, 'scan_cards').then(r => {
      if (r.justCompleted && mounted.current) showXp(r.xpEarned, 'Card Scanner complete!');
    });
  }, [userId, showXp]);

  // AI Smart Scan on an already-captured snapshot (reused from the escalation).
  const runAiScan = useCallback(async (fileUri: string): Promise<boolean> => {
    if (aiScansUsed >= MAX_FREE_AI_SCANS) {
      showNotif({ type: 'warn', text: 'AI assists used up today', sub: 'Upgrade to Pro for unlimited' });
      return false;
    }
    setAiScansUsed(n => n + 1);
    try {
      const formData = new FormData();
      (formData as any).append('image', { uri: fileUri, type: 'image/jpeg', name: 'scan.jpg' });
      const res = await apiFetch('/api/scan', { method: 'POST', body: formData });
      const data = await res.json().catch(() => ({}));
      console.log(`[ai] → ${res.ok && data?.card ? data.card.card_name : 'no match'}`);
      if (res.ok && data?.card) {
        const card = data.card;
        if (quickMode) {
          await doAdd({ scryfall_id: card.scryfall_id, card_name: card.card_name }, false, currentDeck);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          showNotif({ type: currentDeck ? 'success' : 'warn', text: card.card_name, sub: currentDeck ? `→ ${currentDeck.name}` : '→ Library', engine: 'smart' });
        } else {
          setResult({ ...card, _engine: 'smart' });
        }
        return true;
      }
      return false;
    } catch { return false; }
  }, [aiScansUsed, quickMode, currentDeck, doAdd, showNotif]);

  // Escalation ladder when the live art-fingerprint can't read a card:
  //   snapshot → on-device OCR name-match (free) → AI Smart Scan (rare).
  const escalate = useCallback(async (): Promise<boolean> => {
    if (!cameraRef.current) return false;
    let fileUri: string;
    try {
      const photo = await cameraRef.current.takeSnapshot({ quality: 60 });
      fileUri = photo.path.startsWith('file://') ? photo.path : `file://${photo.path}`;
    } catch { return false; }

    if (mounted.current) { setAiThinking(true); setEscalateMsg('🔤 Reading text…'); }
    try {
      // Tier 2 — read the card name (free, on-device).
      try {
        const { ocrMatch } = await import('../lib/scanOcr');
        const ocr = await ocrMatch(fileUri);
        if (ocr) {
          console.log(`[ocr] ${ocr.via} ${ocr.score.toFixed(2)} → ${ocr.name}`);
          if (quickMode) {
            await doAdd({ scryfall_id: ocr.id, card_name: ocr.name }, false, currentDeck);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
            showNotif({ type: currentDeck ? 'success' : 'warn', text: ocr.name, sub: currentDeck ? `→ ${currentDeck.name}` : '→ Library', engine: 'ocr' });
          } else {
            setResult({ scryfall_id: ocr.id, card_name: ocr.name, _engine: 'ocr' });
            apiFetch('/api/scan/resolve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scryfall_id: ocr.id }) })
              .then(r => r.json()).then(d => { if (d?.card && mounted.current) setResult(prev => (prev ? { ...prev, ...d.card } : prev)); }).catch(() => {});
          }
          return true;
        }
      } catch (e) { console.warn('[ocr] error', e); }

      // Tier 3 — AI (rare anomalies). Reuse the same snapshot.
      if (mounted.current) setEscalateMsg('✨ Asking AI…');
      return await runAiScan(fileUri);
    } finally {
      if (mounted.current) { setAiThinking(false); setEscalateMsg(null); }
    }
  }, [quickMode, currentDeck, doAdd, showNotif, runAiScan]);

  // ── Core: resolve a match index to a full card, then act on mode ───────────

  const handleLocalMatch = useRunOnJS(async (matchIndex: number) => {
    if (!dbIds || !mounted.current) return;
    const scryfallId = idAt(dbIds, matchIndex);
    if (!scryfallId) return;

    setResolving(true);
    try {
      const res = await apiFetch('/api/scan/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scryfall_id: scryfallId }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.ok && data?.card) {
        const card: ScannedCard = data.card;

        if (quickMode) {
          // Quick — auto-add immediately, no popup
          await doAdd(card, false, currentDeck);
          showNotif({
            type: currentDeck ? 'success' : 'warn',
            text: card.card_name,
            sub: currentDeck ? `→ ${currentDeck.name}` : '→ Library',
            engine: 'local',
          });
          resetScanner(SCAN_COOLDOWN_MS);
        } else {
          // Review — pause and show sheet
          setResult({ ...card, _engine: 'local' });
          // scanner stays blocked until user acts
        }
      } else {
        showNotif({ type: 'error', text: 'Could not identify', sub: 'Try Force Scan' });
        resetScanner();
      }
    } catch {
      showNotif({ type: 'error', text: 'Network error', sub: 'Try again' });
      resetScanner();
    } finally {
      if (mounted.current) setResolving(false);
    }
  }, [dbIds, quickMode, currentDeck, doAdd, showNotif, resetScanner]);

  // DIAGNOSTIC — encode the warped grayscale image (exactly what the hash sees)
  // to a JPEG in the app cache, so it can be pulled off-device and inspected.
  const dumpWarp = useCallback(async (buf: number[], w: number, h: number, label: string) => {
    const now = Date.now();
    if (now - lastDumpAt.current < 900) return; // throttle
    lastDumpAt.current = now;
    try {
      // jpeg-js is a Node lib that expects a GLOBAL Buffer — RN has none, so
      // install one before importing it (a module-local import won't satisfy it).
      const g = global as any;
      if (typeof g.Buffer === 'undefined') g.Buffer = require('buffer').Buffer;
      const jpeg = await import('jpeg-js');
      const rgba = new Uint8Array(w * h * 4);
      for (let i = 0; i < w * h; i++) {
        const v = buf[i] & 0xff;
        rgba[i * 4] = v; rgba[i * 4 + 1] = v; rgba[i * 4 + 2] = v; rgba[i * 4 + 3] = 255;
      }
      const enc = (jpeg as any).encode({ data: rgba, width: w, height: h }, 90);
      const b64 = bytesToBase64(enc.data as Uint8Array);
      const idx = dumpIdx.current % 6; dumpIdx.current++;
      const uri = `${FileSystem.cacheDirectory}warp_${idx}_${label}.jpg`;
      await FileSystem.writeAsStringAsync(uri, b64, { encoding: FileSystem.EncodingType.Base64 });
      console.log(`[warp-dump] saved ${uri}`);
    } catch (e) { console.warn('[warp-dump] failed', e); }
  }, []);

  // Called from the worklet when a steady card has been detected + flattened.
  // Runs the 114k match on the JS thread (fast, off the camera thread), then
  // auto-adds (quick) or opens the review sheet — using LOCAL names, NO network.
  const onWarpedCard = useRunOnJS(async (buf: number[], w: number, h: number, tier: number) => {
    if (!dbFlat || !dbIds || !mounted.current) { scanBlocked.value = false; return; }
    // A card was detected & flattened → show active "Reading…" feedback so the
    // pre-AI wait doesn't look idle. Clears shortly after detections stop.
    setReading(true);
    if (readingTimer.current) clearTimeout(readingTimer.current);
    readingTimer.current = setTimeout(() => { if (mounted.current) setReading(false); }, 900);
    const u8 = Uint8Array.from(buf);
    const db = { count: dbCount, bytesPerHash: 32, flat: dbFlat };
    // Multi-crop match: tolerant to small warp misalignment (margin/shift/rotation
    // from a loose tier-2 detection on dark/borderless cards).
    const m = bestMatchMultiCrop(u8, w, h, db, AUTO_MAX_DIST);
    setLiveDist(m.distance); setLiveGap(m.runnerUp - m.distance);
    const nmDbg = (dbNames && nameAt(dbNames, m.index)) || '?';
    console.log(`[live] best=${nmDbg} dist=${m.distance} tier=${tier} → ${m.distance <= AUTO_MAX_DIST ? 'ADD' : 'skip'}`);
    if (DUMP_WARP) dumpWarp(buf, w, h, `d${m.distance}t${tier}`);

    if (m.distance > AUTO_MAX_DIST) {
      if (!ESCALATION_ENABLED) {
        // Pure-hash tuning mode: no OCR/AI. Most "misses" are transient (the warp
        // lands on a good crop a frame later), so DON'T red-flash every one — keep
        // retrying silently and only surface a failure after sustained inability.
        const now = Date.now();
        if (rejectSince.current === 0) rejectSince.current = now;
        if (now - rejectSince.current >= AI_ESCALATE_MS) {
          rejectSince.current = 0;
          showNotif({ type: 'error', text: 'No match', sub: `closest dist ${m.distance}` });
          resetScanner(900);
          return;
        }
        resetScanner(350);
        return;
      }
      // A steady card that won't match locally → after a few seconds, hand to AI.
      const now = Date.now();
      if (rejectSince.current === 0) rejectSince.current = now;
      if (now - rejectSince.current >= AI_ESCALATE_MS) {
        rejectSince.current = 0;
        const ok = await escalate();
        resetScanner(ok ? SCAN_COOLDOWN_MS : 1200);
        return;
      }
      resetScanner(400);
      return;
    }
    rejectSince.current = 0; // confident — clear the escalation timer

    const id = idAt(dbIds, m.index);
    const nm = (dbNames && nameAt(dbNames, m.index)) || 'Card';
    if (!id) { resetScanner(500); return; }

    // Confident match → ONE success buzz (the only buzz; silence = still trying).
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    if (quickMode) {
      await doAdd({ scryfall_id: id, card_name: nm }, false, currentDeck);
      showNotif({
        type: currentDeck ? 'success' : 'warn',
        text: nm,
        sub: currentDeck ? `→ ${currentDeck.name}` : '→ Library',
        engine: 'local',
      });
      resetScanner(SCAN_COOLDOWN_MS);
    } else {
      // Review — show the sheet instantly from local data, enrich image/price async.
      setResult({
        scryfall_id: id, card_name: nm, _engine: 'local',
        _dist: m.distance, _gap: m.runnerUp - m.distance, _detected: true, _confident: true,
      });
      apiFetch('/api/scan/resolve', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scryfall_id: id }),
      }).then(r => r.json()).then(d => {
        if (d?.card && mounted.current) setResult(prev => (prev ? { ...prev, ...d.card } : prev));
      }).catch(() => {});
    }
  }, [dbFlat, dbCount, dbIds, dbNames, quickMode, currentDeck, doAdd, showNotif, resetScanner, scanBlocked, escalate]);

  // Called from the worklet (throttled) with a 256×256 RGB frame + the camera frame
  // dims. THIS is the corner-model ("YOLO") live path: run the learned corner
  // detector on the JS thread → smooth quad that hugs the card → drive the lock-on
  // box → stability gate → warp → embed → add. No OpenCV edge detection, no
  // takeSnapshot. cornerBusy guards against overlapping model runs.
  const onCornerFrame = useRunOnJS(async (rgbArr: number[], fw: number, fh: number) => {
    // liveBusy was already claimed by the worklet; release it on every exit path
    // (the finally below) so the camera thread can ship the next frame.
    if (!mounted.current || scanBlocked.value) { liveBusy.value = false; return; }
    try {
      const rgb = Uint8Array.from(rgbArr);
      const { detectCorners } = await import('../lib/embedScan');
      const corners = await detectCorners(rgb, 256, 3); // [tl,tr,br,bl] in 256 space
      // Collect-mode: stash the detector's exact 256² input + its predicted corners
      // for the shutter to write as training data. We deliberately also keep frames
      // the detector MISSES (corners null) — sleeved/toploader/multi-card failures
      // are the data we most need. No recognition / add-to-deck while collecting.
      if (collectModeRef.current) {
        // Stash for the shutter, then fall through to drive the live box so the user
        // sees the detector's guess while framing — including loose/wrong boxes on
        // clutter, exactly the cases to capture. Warp/embed/add is skipped below.
        lastFrameRgb.current = rgb;
        lastCorners.current = corners ?? null;
      }
      if (!corners) { emaValid.current = false; onNoCard(); return; }

      // Map 256-square model coords → upright-portrait-frame coords. The worklet
      // rotated the frame to portrait then auto centre-square-cropped before resizing
      // to 256, so undo that square crop here. fw/fh are the ROTATED frame dims.
      const sq = Math.min(fw, fh);
      const cropX = (fw - sq) / 2, cropY = (fh - sq) / 2;
      const fpt = corners.map(([mx, my]) => ({ x: cropX + (mx / 256) * sq, y: cropY + (my / 256) * sq }));

      // Plausibility gate: a real card quad is portrait-ish and a sensible size.
      // Rejects the degenerate quad the model emits on an empty table → no false box.
      const dd = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
      const qw = (dd(fpt[0], fpt[1]) + dd(fpt[3], fpt[2])) / 2;
      const qh = (dd(fpt[0], fpt[3]) + dd(fpt[1], fpt[2])) / 2;
      const aspect = Math.min(qw, qh) / Math.max(qw, qh);
      const areaFrac = (qw * qh) / (sq * sq);
      // A real card warps to ~0.716; allow a band for perspective. Reject near-square
      // quads (>0.88) — that's the loose box the model emits on non-cards (the fake
      // drawing came in at 0.94), so we don't even attempt a match on those.
      if (aspect < 0.5 || aspect > 0.88 || areaFrac < 0.12 || areaFrac > 1.25) {
        stableCount.value = 0;
        emaValid.current = false;
        onNoCard();
        return;
      }
      missCount.current = 0; // valid card → clear the no-card hysteresis

      // Drive the lock-on box. The frame is already upright portrait, so map to the
      // portrait screen with a single COVER-scale + centre-crop (no rotation).
      const VW = viewSize.current.w, VH = viewSize.current.h;
      const mscale = Math.max(VW / fw, VH / fh);
      const mp = (p: { x: number; y: number }) => ({
        x: p.x * mscale - (fw * mscale - VW) / 2,
        y: p.y * mscale - (fh * mscale - VH) / 2,
      });
      // EMA-smooth the corners (frame space) for a jitter-free, gliding hug. The raw
      // fpt is still used for stability + the warp crop (precision matters there); only
      // the visible BOX is smoothed. Seeding on first detection avoids a slide-in.
      // S2 — adaptive One-Euro smoothing on the 4 corners (steady still, tight moving).
      const _oe = oneEuro8([fpt[0].x, fpt[0].y, fpt[1].x, fpt[1].y, fpt[2].x, fpt[2].y, fpt[3].x, fpt[3].y]);
      const spt = [{ x: _oe[0], y: _oe[1] }, { x: _oe[2], y: _oe[3] }, { x: _oe[4], y: _oe[5] }, { x: _oe[6], y: _oe[7] }];
      const p0 = mp(spt[0]), p1 = mp(spt[1]), p2 = mp(spt[2]), p3 = mp(spt[3]);
      const cx = (p0.x + p1.x + p2.x + p3.x) / 4, cy = (p0.y + p1.y + p2.y + p3.y) / 4;
      const sw = (dd(p0, p1) + dd(p2, p3)) / 2, sh = (dd(p1, p2) + dd(p3, p0)) / 2;
      let ang = (Math.atan2(p1.y - p0.y, p1.x - p0.x) * 180) / Math.PI;
      while (ang - lastRot.current > 90) ang -= 180;
      while (ang - lastRot.current < -90) ang += 180;
      lastRot.current = ang;

      // Stability in frame space (centroid steadiness over consecutive frames).
      const qcx = (fpt[0].x + fpt[1].x + fpt[2].x + fpt[3].x) / 4;
      const qcy = (fpt[0].y + fpt[1].y + fpt[2].y + fpt[3].y) / 4;
      const moved = Math.abs(qcx - lastQuadCx.current) + Math.abs(qcy - lastQuadCy.current);
      lastQuadCx.current = qcx; lastQuadCy.current = qcy;
      stableCount.value = moved < sq * 0.055 ? stableCount.value + 1 : 1;
      const fState = stableCount.value >= STABLE_FRAMES_NEEDED ? 2 : 1;
      // S3 interim — draw the true perspective quad through the 4 smoothed corners
      // (green when LOCKED, amber while still settling). Replaces the rotated box.
      quadRef.current?.set([p0, p1, p2, p3], fState === 2 ? '#10b981' : '#f59e0b');
      if (fState !== lastAlign.current) { lastAlign.current = fState; setAlignState(fState as 0 | 1 | 2); }

      if (stableCount.value < STABLE_FRAMES_NEEDED) return;

      // Collect-mode: the box tracks for framing feedback, but never recognise or
      // auto-add — keep re-evaluating so the shutter can grab any frame on demand.
      if (collectModeRef.current) { stableCount.value = 0; return; }

      // Locked + steady → warp the card flat and embed.
      recognizing.value = true;   // background embed in flight — gates re-capture, NOT tracking
      setReading(true);
      if (readingTimer.current) clearTimeout(readingTimer.current);
      readingTimer.current = setTimeout(() => { if (mounted.current) setReading(false); }, 900);

      const { warpQuadColor } = await import('../lib/scanOpenCV');
      const rgba = warpQuadColor(rgb, 256, 3, corners, 256);

      // DIAGNOSTIC: save the exact colour crop SigLIP sees, so we can inspect
      // orientation/quality off-device. Also dump the rotated input frame once.
      if (DUMP_LIVE) {
        try {
          const g: any = global as any;
          if (typeof g.Buffer === 'undefined') g.Buffer = require('buffer').Buffer;
          const jpeg = await import('jpeg-js');
          const idx = dumpIdx.current % 6; dumpIdx.current++;
          const encCrop = (jpeg as any).encode({ data: rgba, width: 256, height: 256 }, 85);
          await FileSystem.writeAsStringAsync(
            `${FileSystem.cacheDirectory}live_crop_${idx}.jpg`,
            bytesToBase64(encCrop.data as Uint8Array), { encoding: FileSystem.EncodingType.Base64 });
          // rotated input frame (rgb → rgba) to verify the 90° rotation direction
          const frameRgba = new Uint8Array(256 * 256 * 4);
          for (let p = 0; p < 256 * 256; p++) {
            frameRgba[p * 4] = rgb[p * 3]; frameRgba[p * 4 + 1] = rgb[p * 3 + 1];
            frameRgba[p * 4 + 2] = rgb[p * 3 + 2]; frameRgba[p * 4 + 3] = 255;
          }
          const encFrame = (jpeg as any).encode({ data: frameRgba, width: 256, height: 256 }, 80);
          await FileSystem.writeAsStringAsync(
            `${FileSystem.cacheDirectory}live_frame_${idx}.jpg`,
            bytesToBase64(encFrame.data as Uint8Array), { encoding: FileSystem.EncodingType.Base64 });
          console.log(`[live-dump] live_crop_${idx}.jpg / live_frame_${idx}.jpg`);
        } catch (e) { console.warn('[live-dump] failed', e); }
      }

      const { embedAndMatch } = await import('../lib/embedScan');
      let { matches, embMs, matchMs } = await embedAndMatch(rgba, 256);
      let top = matches[0];
      let conf = top?.score ?? 0;
      let orient = 0;
      // SigLIP is orientation-sensitive and the index is upright-only. If the first
      // pass isn't confident, try the 180°-rotated crop — this absorbs a wrong
      // rotation direction in the worklet AND cards physically held upside-down.
      if (conf < CONF_MIN) {
        const N = 256 * 256;
        const rgba180 = new Uint8Array(rgba.length);
        for (let p = 0; p < N; p++) {
          const s = (N - 1 - p) * 4, d = p * 4;
          rgba180[d] = rgba[s]; rgba180[d + 1] = rgba[s + 1]; rgba180[d + 2] = rgba[s + 2]; rgba180[d + 3] = 255;
        }
        const r2 = await embedAndMatch(rgba180, 256);
        if ((r2.matches[0]?.score ?? 0) > conf) {
          matches = r2.matches; top = r2.matches[0]; conf = top?.score ?? 0; orient = 180;
          embMs += r2.embMs; matchMs += r2.matchMs;
        }
      }
      console.log(`[quick] emb=${embMs}ms match=${matchMs}ms aspect=${aspect.toFixed(2)} rot=${orient} → ${top ? `${top.name} ${top.set} (${conf.toFixed(3)})` : 'none'} ${conf >= CONF_MIN ? 'ACCEPT' : 'reject'}`);

      if (conf < CONF_MIN) {
        const now = Date.now();
        if (rejectSince.current === 0) rejectSince.current = now;
        if (now - rejectSince.current >= AI_ESCALATE_MS) {
          rejectSince.current = 0;
          showNotif({ type: 'error', text: 'No match', sub: 'realign & retry' });
          resetScanner(900);
          return;
        }
        resetScanner(250);
        return;
      }
      rejectSince.current = 0;
      hudEmbRef.current = embMs; hudMatchRef.current = matchMs; // S0 HUD: embed/match confirm ms
      if (firstSeenRef.current) hudIdRef.current = Date.now() - firstSeenRef.current; // S0 HUD: e2e ID ms
      firstSeenRef.current = 0; lockRecordedRef.current = false; // reset e2e timers per-card (even in back-to-back scans)
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      if (quickMode) {
        await doAdd({ scryfall_id: top.id, card_name: top.name }, false, currentDeck);
        showNotif({
          type: currentDeck ? 'success' : 'warn',
          text: top.name,
          sub: currentDeck ? `→ ${currentDeck.name}` : '→ Library',
          engine: 'embed',
        });
        resetScanner(SCAN_COOLDOWN_MS);
      } else {
        setResult({
          scryfall_id: top.id, card_name: top.name, _engine: 'embed',
          _dist: 0, _gap: 0, _detected: true, _confident: true,
        });
        apiFetch('/api/scan/resolve', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scryfall_id: top.id }),
        }).then(r => r.json()).then(d => {
          if (d?.card && mounted.current) setResult(prev => (prev ? { ...prev, ...d.card } : prev));
        }).catch(() => {});
      }
    } catch (e) {
      console.log('[quick-error]', String(e));
    } finally {
      liveBusy.value = false;
    }
  }, [quickMode, currentDeck, doAdd, showNotif, resetScanner, scanBlocked, onNoCard, springTo, stableCount, liveBusy]);

  // ── TFLite camera-thread path ───────────────────────────────────────────────
  // Write one stashed frame (lastFrameRgb) + its corners to documentDirectory/collect/.
  // Shared by the ONNX collect path (captureCollect) and the TFLite grab (onGrabbedFrame).
  const saveCollectFrame = useCallback(async () => {
    if (collectSaving.current) return;
    const rgb = lastFrameRgb.current;
    if (!rgb) { showNotif({ type: 'warn', text: 'No frame yet', sub: 'point at a card first' }); return; }
    collectSaving.current = true;
    try {
      const g: any = global as any;
      if (typeof g.Buffer === 'undefined') g.Buffer = require('buffer').Buffer;
      const jpeg = await import('jpeg-js');
      const N = 256 * 256;
      const rgba = new Uint8Array(N * 4);
      for (let p = 0; p < N; p++) {
        rgba[p * 4] = rgb[p * 3]; rgba[p * 4 + 1] = rgb[p * 3 + 1];
        rgba[p * 4 + 2] = rgb[p * 3 + 2]; rgba[p * 4 + 3] = 255;
      }
      const enc = (jpeg as any).encode({ data: rgba, width: 256, height: 256 }, 92);
      const base = `${FileSystem.documentDirectory}collect/`;
      await FileSystem.makeDirectoryAsync(base, { intermediates: true }).catch(() => {});
      const ts = Date.now();
      await FileSystem.writeAsStringAsync(`${base}f_${ts}.jpg`,
        bytesToBase64(enc.data as Uint8Array), { encoding: FileSystem.EncodingType.Base64 });
      await FileSystem.writeAsStringAsync(`${base}f_${ts}.json`,
        JSON.stringify({ ts, build: BUILD_TAG, size: 256, corners: lastCorners.current }));
      collectCountRef.current += 1;
      setCollectCount(collectCountRef.current);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      showNotif({
        type: 'success',
        text: `Captured #${collectCountRef.current}`,
        sub: lastCorners.current ? 'frame + corners saved' : '⚠ detector missed — frame saved',
      });
    } catch (e) {
      showNotif({ type: 'error', text: 'Capture failed', sub: String(e).slice(0, 40) });
    } finally {
      collectSaving.current = false;
    }
  }, [showNotif]);

  // Cheap per-frame hop from the TFLite worklet: just the 8 corner numbers (256-space)
  // + mean heatmap peak. Drives the lock-on box + stability EXACTLY like onCornerFrame,
  // but with NO pixel marshal. On lock it raises captureNext so the worklet hands over
  // one frame's pixels (→ onGrabbedFrame) for the warp+embed.
  const onCornerResult = useRunOnJS((cs: number[], peakAvg: number, fw: number, fh: number) => {
    if (!mounted.current || scanBlocked.value) { liveBusy.value = false; return; }
    try {
      if (captureNext.value) return;                       // already waiting for the grab
      const corners: number[][] = [[cs[0], cs[1]], [cs[2], cs[3]], [cs[4], cs[5]], [cs[6], cs[7]]];
      if (collectModeRef.current) lastCorners.current = peakAvg >= 0.20 ? corners : null;
      if (peakAvg < CARD_PRESENCE_MIN) { onNoCard(); return; } // no real card → hide (onNoCard coasts ≤2 frames then resets)

      const sq = Math.min(fw, fh);
      const cropX = (fw - sq) / 2, cropY = (fh - sq) / 2;
      const fpt = corners.map(([mx, my]) => ({ x: cropX + (mx / 256) * sq, y: cropY + (my / 256) * sq }));
      const dd = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
      const qw = (dd(fpt[0], fpt[1]) + dd(fpt[3], fpt[2])) / 2;
      const qh = (dd(fpt[0], fpt[3]) + dd(fpt[1], fpt[2])) / 2;
      const aspect = Math.min(qw, qh) / Math.max(qw, qh);
      const areaFrac = (qw * qh) / (sq * sq);
      if (aspect < 0.5 || aspect > 0.88 || areaFrac < 0.12 || areaFrac > 1.25) {
        stableCount.value = 0; onNoCard(); return; // implausible quad → coast (filter stays warm)
      }
      missCount.current = 0; // valid card → clear the no-card hysteresis
      if (firstSeenRef.current === 0) firstSeenRef.current = Date.now(); // S0 HUD: e2e timer start

      const VW = viewSize.current.w, VH = viewSize.current.h;
      const mscale = Math.max(VW / fw, VH / fh);
      const mp = (p: { x: number; y: number }) => ({
        x: p.x * mscale - (fw * mscale - VW) / 2,
        y: p.y * mscale - (fh * mscale - VH) / 2,
      });
      // S2 — adaptive One-Euro smoothing on the 4 corners (steady still, tight moving).
      const _oe = oneEuro8([fpt[0].x, fpt[0].y, fpt[1].x, fpt[1].y, fpt[2].x, fpt[2].y, fpt[3].x, fpt[3].y]);
      const spt = [{ x: _oe[0], y: _oe[1] }, { x: _oe[2], y: _oe[3] }, { x: _oe[4], y: _oe[5] }, { x: _oe[6], y: _oe[7] }];
      const p0 = mp(spt[0]), p1 = mp(spt[1]), p2 = mp(spt[2]), p3 = mp(spt[3]);
      const cx = (p0.x + p1.x + p2.x + p3.x) / 4, cy = (p0.y + p1.y + p2.y + p3.y) / 4;
      const sw = (dd(p0, p1) + dd(p2, p3)) / 2, sh = (dd(p1, p2) + dd(p3, p0)) / 2;
      let ang = (Math.atan2(p1.y - p0.y, p1.x - p0.x) * 180) / Math.PI;
      while (ang - lastRot.current > 90) ang -= 180;
      while (ang - lastRot.current < -90) ang += 180;
      lastRot.current = ang;

      const qcx = (fpt[0].x + fpt[1].x + fpt[2].x + fpt[3].x) / 4;
      const qcy = (fpt[0].y + fpt[1].y + fpt[2].y + fpt[3].y) / 4;
      const moved = Math.abs(qcx - lastQuadCx.current) + Math.abs(qcy - lastQuadCy.current);
      lastQuadCx.current = qcx; lastQuadCy.current = qcy;
      stableCount.value = moved < sq * 0.055 ? stableCount.value + 1 : 1;
      const fState = stableCount.value >= STABLE_FRAMES_NEEDED ? 2 : 1;
      // S3 interim — draw the true perspective quad through the 4 smoothed corners
      // (green when LOCKED, amber while still settling). Replaces the rotated box.
      quadRef.current?.set([p0, p1, p2, p3], fState === 2 ? '#10b981' : '#f59e0b');
      if (fState !== lastAlign.current) { lastAlign.current = fState; setAlignState(fState as 0 | 1 | 2); }
      if (fState === 2 && !lockRecordedRef.current) {      // S0 HUD: e2e lock ms (corners → LOCKED)
        lockRecordedRef.current = true;
        hudLockRef.current = firstSeenRef.current ? Date.now() - firstSeenRef.current : 0;
      }

      if (collectModeRef.current) return;                  // collect: box only, shutter grabs
      if (!embedReady.value) return;                       // model not loaded yet
      // ManaBox-style continuous flow: recognition runs in the BACKGROUND and never freezes
      // the box. Grab a frame whenever the box is locked and no embed is in flight / cooling —
      // NO "hold still" gate (a loose/blurry grab just fails the confidence check and we retry
      // on the next frame). Skip only fast motion (that frame would be motion-blurred).
      // Grab exactly ONE still frame per hold and identify it in the BACKGROUND — no continuous
      // real-time embedding (that was the lag + the "identifying…" flicker). But only after a
      // GENUINE settle: the box must actually reach LOCKED (fState 2 = several steady frames),
      // NOT a momentary dip while a card is being placed onto a stack — that transitional crop
      // was the misread source. Moving drops it out of LOCKED → re-arm; settling fires one grab.
      if (fState < 2) { captureArmed.current = true; return; } // still settling/moving → (re)arm
      if (!captureArmed.current || recognizing.value || Date.now() < captureCooldownUntil.current) return;
      captureArmed.current = false;                        // consume the arm → exactly one grab per settle
      captureNext.value = true;                            // grab one frame's pixels → onGrabbedFrame (background)
    } finally {
      liveBusy.value = false;
    }
  }, [scanBlocked, recognizing, captureNext, onNoCard, springTo, stableCount, liveBusy]);

  // One-shot heavy path: the worklet marshals the frame's pixels exactly once (on lock,
  // or on a collect shutter). Warp → embed → match → add — same as onCornerFrame's tail.
  const onGrabbedFrame = useRunOnJS(async (rgbArr: number[], cs: number[], peakAvg: number, fw: number, fh: number, forCollect: boolean) => {
    try {
      const rgb = Uint8Array.from(rgbArr);
      const corners: number[][] = [[cs[0], cs[1]], [cs[2], cs[3]], [cs[4], cs[5]], [cs[6], cs[7]]];
      if (forCollect) {
        lastFrameRgb.current = rgb;
        lastCorners.current = peakAvg >= 0.20 ? corners : null;
        await saveCollectFrame();
        return;
      }
      recognizing.value = true;   // background embed in flight — gates re-capture, NOT tracking
      setReading(true);
      if (readingTimer.current) clearTimeout(readingTimer.current);
      readingTimer.current = setTimeout(() => { if (mounted.current) setReading(false); }, 900);

      const { warpQuadColor } = await import('../lib/scanOpenCV');
      const rgba = warpQuadColor(rgb, 256, 3, corners, 256);
      // Recognition: server-side (SERVER_LIVE) or on-device SigLIP. Same return shape either way.
      const embedAndMatch = SERVER_LIVE ? null : (await import('../lib/embedScan')).embedAndMatch;
      const doMatch = (r: Uint8Array) => SERVER_LIVE ? serverMatchRgba(r, 256) : embedAndMatch!(r, 256);
      // Accept on absolute confidence OR same-name consensus in the top-K (reprints).
      const ok = (ms: Array<{ name: string; score: number }>): boolean => {
        const t = ms[0];
        if (!t) return false;
        if (t.score >= CONF_MIN) return true;                   // single high-confidence hit
        if (t.score < NAME_CONSENSUS_MIN) return false;         // too low to trust at all
        return ms.filter((m) => m.name === t.name).length >= 3; // strong same-name consensus (≥3 of top-K)
      };

      let { matches, embMs, matchMs } = await doMatch(rgba);
      let orient = 0;
      // Only pay for the 180° retry if the upright pass didn't already accept (handles
      // physically-rotated cards). Accepting on consensus here also skips the retry for
      // hard cards → ~halves their time.
      if (!ok(matches)) {
        const N = 256 * 256;
        const rgba180 = new Uint8Array(rgba.length);
        for (let p = 0; p < N; p++) {
          const s = (N - 1 - p) * 4, d = p * 4;
          rgba180[d] = rgba[s]; rgba180[d + 1] = rgba[s + 1]; rgba180[d + 2] = rgba[s + 2]; rgba180[d + 3] = 255;
        }
        const r2 = await doMatch(rgba180);
        if (ok(r2.matches) || (r2.matches[0]?.score ?? 0) > (matches[0]?.score ?? 0)) {
          matches = r2.matches; orient = 180;
          embMs += r2.embMs; matchMs += r2.matchMs;
        }
      }
      const top = matches[0];
      const conf = top?.score ?? 0;
      let accepted = ok(matches);
      const sameN = top ? matches.filter((m) => m.name === top.name).length : 0;
      // Temporal consensus: the SAME card as top match across consecutive attempts → accept
      // even when each pass is sub-threshold (rescues borderline single-printing cards like
      // Mindful Biomancer flickering ~0.80). Angle/garbage mismatches vary between attempts,
      // so they never accumulate temporal consensus.
      let temporalN = 0;
      if (top && top.score >= TEMPORAL_MIN) {
        if (top.id === lastTopId.current) lastTopCount.current += 1;
        else { lastTopId.current = top.id; lastTopCount.current = 1; }
        temporalN = lastTopCount.current;
        if (!accepted && temporalN >= TEMPORAL_FRAMES) accepted = true;
      } else {
        lastTopId.current = ''; lastTopCount.current = 0;
      }
      console.log(`[quick-tf] emb=${embMs}ms match=${matchMs}ms peak=${peakAvg.toFixed(2)} rot=${orient} → ${top ? `${top.name} ${top.set} (${conf.toFixed(3)} ${sameN}/${matches.length} t${temporalN})` : 'none'} ${accepted ? 'ACCEPT' : 'reject'}`);

      if (!accepted) {
        // ManaBox-style: no "hold still" nag, no reset — keep the box tracking the card and
        // silently retry on the next good frame after a short beat (throttles the CPU-heavy
        // embed so tracking stays responsive during the retries).
        captureCooldownUntil.current = Date.now() + 450;
        return;
      }
      rejectSince.current = 0;
      captureCooldownUntil.current = Date.now() + SCAN_COOLDOWN_MS; // pause re-scan after a hit
      hudEmbRef.current = embMs; hudMatchRef.current = matchMs; // S0 HUD: embed/match confirm ms
      if (firstSeenRef.current) hudIdRef.current = Date.now() - firstSeenRef.current; // S0 HUD: e2e ID ms
      firstSeenRef.current = 0; lockRecordedRef.current = false; // reset e2e timers per-card
      // Continuous scanning would otherwise re-add the very card still in your hand. Skip if
      // it's the one we just added; the guard clears when the card leaves the frame (onNoCard),
      // so re-presenting it — or moving to the next card — adds normally. ManaBox-style.
      if (quickMode && top.id === lastAddedId.current) return;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      if (quickMode) {
        lastAddedId.current = top.id;
        await doAdd({ scryfall_id: top.id, card_name: top.name }, false, currentDeck);
        showNotif({
          type: currentDeck ? 'success' : 'warn',
          text: top.name,
          sub: currentDeck ? `→ ${currentDeck.name}` : '→ Library',
          engine: 'embed',
        });
        // Keep tracking the card (green quad stays hugging it) — no reset/hide. The cooldown
        // + lastAddedId guard prevent a double-add; moving to the next card scans it.
      } else {
        setResult({
          scryfall_id: top.id, card_name: top.name, _engine: 'embed',
          _dist: 0, _gap: 0, _detected: true, _confident: true,
        });
        apiFetch('/api/scan/resolve', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scryfall_id: top.id }),
        }).then(r => r.json()).then(d => {
          if (d?.card && mounted.current) setResult(prev => (prev ? { ...prev, ...d.card } : prev));
        }).catch(() => {});
      }
    } catch (e) {
      console.log('[quick-tf-error]', String(e));
    } finally {
      recognizing.value = false;  // embed done → capture can re-arm (gated by captureCooldownUntil)
      setReading(false);
      liveBusy.value = false;
    }
  }, [quickMode, currentDeck, doAdd, showNotif, resetScanner, recognizing, saveCollectFrame, liveBusy]);

  // Toggle collect-mode; reset any in-flight scan/lock so the switch is clean both ways.
  const toggleCollect = useCallback(() => {
    setCollectMode((m) => {
      const next = !m;
      collectModeRef.current = next;
      return next;
    });
    scanBlocked.value = false;
    stableCount.value = 0;
    emaValid.current = false;
    setResult(null);
    setReading(false);
  }, [scanBlocked, stableCount]);

  // Shutter — capture one frame to documentDirectory/collect/. TFLite path: pixels live
  // on the camera thread, so ask the worklet to deliver one frame (→ onGrabbedFrame →
  // saveCollectFrame). ONNX path: pixels are already stashed. Pull the set with:
  //   adb exec-out run-as app.deckforge tar c -C files collect > collect.tar
  const captureCollect = useCallback(async () => {
    if (collectSaving.current) return;
    if (USE_TFLITE_DETECTOR) { collectGrab.value = true; return; }
    await saveCollectFrame();
  }, [saveCollectFrame, collectGrab]);

  // Cumulative counter: count frames already on disk so the badge reflects the
  // whole collection, not just this session.
  useEffect(() => {
    (async () => {
      try {
        const base = `${FileSystem.documentDirectory}collect/`;
        const info = await FileSystem.getInfoAsync(base);
        if (!info.exists) return;
        const files = await FileSystem.readDirectoryAsync(base);
        const n = files.filter((f) => f.endsWith('.jpg')).length;
        collectCountRef.current = n;
        setCollectCount(n);
      } catch { /* best-effort */ }
    })();
  }, []);


  // Review mode: user confirms the card in the sheet
  const onReviewAdd = useCallback(async () => {
    if (!result) return;
    await doAdd(result, isFoil, currentDeck);
    showNotif({
      type: currentDeck ? 'success' : 'warn',
      text: result.card_name,
      sub: `${currentDeck ? `→ ${currentDeck.name}` : '→ Library'}${isFoil ? ' · foil' : ''}`,
      engine: result._engine,
    });
    setResult(null);
    setIsFoil(false);
    resetScanner(SCAN_COOLDOWN_MS);
  }, [result, isFoil, currentDeck, doAdd, showNotif, resetScanner]);

  const onReviewRescan = useCallback(() => {
    setResult(null);
    setIsFoil(false);
    resetScanner();
  }, [resetScanner]);

  // ── Force Scan (manual JPEG fallback) ─────────────────────────────────────

  // ON-DEVICE — capture a colour card crop, embed with SigLIP2 ON THE PHONE, and
  // match against the bundled 115k int8 index. No server, fully offline.
  const ondeviceScan = useCallback(async () => {
    if (!cameraRef.current || manualScanning || resolving || result) return;
    setManualScanning(true);
    scanBlocked.value = true;
    try {
      const photo = await cameraRef.current.takeSnapshot({ quality: 90 });
      const fileUri = photo.path.startsWith('file://') ? photo.path : `file://${photo.path}`;
      const base64 = await FileSystem.readAsStringAsync(fileUri, { encoding: FileSystem.EncodingType.Base64 });
      const { warpPhotoColor } = await import('../lib/scanOpenCV');
      const warp = await warpPhotoColor(base64, 256, 256); // square 256 for the model
      if (!warp || warp.w === 0) { showNotif({ type: 'error', text: 'Capture failed', sub: 'try again' }); resetScanner(); return; }
      const { embedAndMatch } = await import('../lib/embedScan');
      const { matches, embMs, matchMs } = await embedAndMatch(Uint8Array.from(warp.rgba), 256);
      const top = matches[0];
      const conf = top?.score ?? 0;
      console.log(`[ondevice] emb=${embMs}ms match=${matchMs}ms → ${top ? `${top.name} ${top.set}/${top.cn} (${top.score})` : 'none'} ${conf >= CONF_MIN ? 'ACCEPT' : 'reject'}`);
      if (top && conf >= CONF_MIN) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        showNotif({ type: 'success', text: top.name, sub: `📱 on-device ${top.set?.toUpperCase()} ${top.cn} · ${top.score}`, engine: 'local' });
      } else if (top) {
        showNotif({ type: 'warn', text: 'Not sure — realign & retry', sub: `closest: ${top.name} (${top.score})` });
      } else {
        showNotif({ type: 'error', text: 'No match', sub: 'try again' });
      }
    } catch (e: unknown) {
      showNotif({ type: 'error', text: 'On-device scan error', sub: (e instanceof Error ? e.message : String(e)).slice(0, 90) });
    } finally {
      if (mounted.current) setManualScanning(false);
      resetScanner(SCAN_COOLDOWN_MS);
    }
  }, [manualScanning, resolving, result, showNotif, resetScanner, scanBlocked]);

  // PHASE A — capture a COLOUR card crop and match it against the local SigLIP2
  // embedding server. Proves embedding accuracy on real captures before we build
  // the on-device model. (Reuses the Force Scan button; no worklet changes.)
  const serverScan = useCallback(async () => {
    if (!cameraRef.current || manualScanning || resolving || result) return;
    setManualScanning(true);
    scanBlocked.value = true;
    try {
      const photo = await cameraRef.current.takeSnapshot({ quality: 90 });
      const fileUri = photo.path.startsWith('file://') ? photo.path : `file://${photo.path}`;
      const base64 = await FileSystem.readAsStringAsync(fileUri, { encoding: FileSystem.EncodingType.Base64 });
      const { warpPhotoColor } = await import('../lib/scanOpenCV');
      const warp = await warpPhotoColor(base64);
      if (!warp || warp.w === 0) {
        showNotif({ type: 'error', text: 'Capture failed', sub: 'try again' });
        resetScanner(); return;
      }
      // warp.detected === false means we fell back to the guide-box centre crop
      // (full-art card with no clean border) — still worth sending to the matcher.
      // Encode the RGBA colour crop → JPEG → base64 (jpeg-js needs a global Buffer).
      const g = global as any;
      if (typeof g.Buffer === 'undefined') g.Buffer = require('buffer').Buffer;
      const jpeg = await import('jpeg-js');
      const enc = (jpeg as any).encode({ data: Uint8Array.from(warp.rgba), width: warp.w, height: warp.h }, 80);
      const imgB64 = bytesToBase64(enc.data as Uint8Array);
      const res = await fetch(MATCH_SERVER_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_b64: imgB64 }),
      });
      const data = await res.json().catch(() => ({}));
      const top = data?.matches?.[0];
      const conf = top?.score ?? 0;
      console.log(`[server] ${data?.ms}ms → ${top ? `${top.name} ${top.set}/${top.cn} (${top.score})` : 'no match'} ${conf >= CONF_MIN ? 'ACCEPT' : 'reject'}`);
      if (top && conf >= CONF_MIN) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        showNotif({ type: 'success', text: `${top.name}`, sub: `✨ embed ${top.set?.toUpperCase()} ${top.cn} · ${top.score}`, engine: 'smart' });
      } else if (top) {
        // Below the confidence gate — likely a loose/poor capture. Fail loud.
        showNotif({ type: 'warn', text: 'Not sure — realign & retry', sub: `closest: ${top.name} (${top.score})` });
      } else {
        showNotif({ type: 'error', text: 'No match', sub: data?.error ? String(data.error).slice(0, 60) : 'server returned nothing' });
      }
    } catch (e: unknown) {
      showNotif({ type: 'error', text: 'Server scan error', sub: (e instanceof Error ? e.message : String(e)).slice(0, 80) });
    } finally {
      if (mounted.current) setManualScanning(false);
      resetScanner(SCAN_COOLDOWN_MS);
    }
  }, [manualScanning, resolving, result, showNotif, resetScanner, scanBlocked]);

  const onManualCapture = useCallback(async () => {
    if (ONDEVICE_MATCH) return ondeviceScan();
    if (SERVER_MATCH) return serverScan();
    if (!cameraRef.current || manualScanning || resolving || result) return;
    setManualScanning(true);
    scanBlocked.value = true;

    try {
      const photo = await cameraRef.current.takeSnapshot({ quality: 60 });
      const fileUri = photo.path.startsWith('file://') ? photo.path : `file://${photo.path}`;
      const { matchPhotoOpenCV } = await import('../lib/scanOpenCV');
      const base64 = await FileSystem.readAsStringAsync(fileUri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      const match = await matchPhotoOpenCV(base64);
      if (match?.error) {
        // Surface the real OpenCV error so we can diagnose it (instead of
        // silently falling back to AI every time).
        Alert.alert('On-device scan error', match.error.slice(0, 400));
        resetScanner();
        return;
      }
      // Confident local match → show/add it. Otherwise fall through to AI Smart
      // Scan (reliable) instead of surfacing a wrong low-confidence guess.
      if (match?.scryfallId && match.detected && match.distance <= AUTO_MAX_DIST) {
        try {
          const res = await apiFetch('/api/scan/resolve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ scryfall_id: match.scryfallId }),
          });
          const data = await res.json().catch(() => ({}));
          if (res.ok && data?.card) {
            setResult({
              ...data.card,
              _engine: 'local',
              _dist: match.distance,
              _gap: match.gap,
              _detected: match.detected,
              _confident: true,
              _contours: match.contourCount,
              _quads: match.quadCount,
            });
            return;
          }
        } catch {
          // fall through to Smart Scan
        }
      }

      // No local match (or resolve failed) — try Smart Scan
      if (aiScansUsed >= MAX_FREE_AI_SCANS) {
        Alert.alert('Daily AI limit reached', `${MAX_FREE_AI_SCANS} Smart Scans used today.`);
        resetScanner();
        return;
      }
      setAiScansUsed(n => n + 1);
      const formData = new FormData();
      (formData as any).append('image', { uri: fileUri, type: 'image/jpeg', name: 'scan.jpg' });
      const res = await apiFetch('/api/scan', { method: 'POST', body: formData });
      const data = await res.json().catch(() => ({}));

      if (res.ok && data?.card) {
        const card: ScannedCard = data.card;
        if (quickMode) {
          await doAdd(card, false, currentDeck);
          showNotif({
            type: currentDeck ? 'success' : 'warn',
            text: card.card_name,
            sub: currentDeck ? `→ ${currentDeck.name}` : '→ Library',
            engine: 'smart',
          });
          resetScanner(SCAN_COOLDOWN_MS);
        } else {
          setResult({ ...card, _engine: 'smart' });
        }
      } else {
        showNotif({ type: 'error', text: 'Not identified', sub: 'Try better lighting' });
        resetScanner();
      }
    } catch (e: unknown) {
      showNotif({ type: 'error', text: 'Scan error', sub: (e instanceof Error ? e.message : String(e)).slice(0, 80) });
      resetScanner();
    } finally {
      if (mounted.current) setManualScanning(false);
    }
  }, [cameraRef, manualScanning, resolving, result, aiScansUsed, quickMode, currentDeck, doAdd, showNotif, handleLocalMatch, resetScanner, scanBlocked, serverScan, ondeviceScan]);

  // ── Frame processor ────────────────────────────────────────────────────────

  const frameProcessor = useFrameProcessor((frame) => {
    'worklet';
    if (USE_TFLITE_DETECTOR) {
      // ── Camera-thread TFLite detector (synchronous, throttled) ────────────
      // fast-tflite 2.x's model is bound to the SYNCHRONOUS frame-processor worklet
      // runtime — calling it from runAsync's separate context segfaults. So we run it
      // synchronously, throttled via runAtTargetFps so the camera thread isn't starved
      // (which Broken-pipes Samsung's HAL). Per frame we marshal ONLY 8 corner numbers
      // (onCornerResult → box); pixels go over once, on lock/collect (onGrabbedFrame).
      if (!LIVE_AUTOSCAN || !tfReady.value || scanBlocked.value || tfModel == null) return;
      const model = tfModel;
      // Adaptive rate: crawl when no card in view, ramp up while tracking one (heat/perf).
      runAtTargetFps(cardActiveSV.value ? DETECT_FPS_ACTIVE : DETECT_FPS_IDLE, () => {
        'worklet';
        try {
          const _t0 = performance.now(); // S0 HUD: full callback budget
          const rgb = resize(frame, {
            rotation: '90deg',
            scale: { width: 256, height: 256 }, // upright centre-square-crop → 256² RGB (HWC)
            pixelFormat: 'rgb', dataType: 'uint8',
          });
          const _tR = performance.now(); hudResizeMs.value = _tR - _t0; // S0 HUD: resize ms
          if (!fpReported.value) { fpReported.value = true; reportFp(true); }
          // Normalise to NHWC float32 (ImageNet). resize gives HWC RGB → the model's
          // [1,256,256,3] input is just this buffer normalised in place.
          const N = 256 * 256;
          const input = new Float32Array(N * 3);
          for (let p = 0; p < N; p++) {
            const o = p * 3;
            input[o]     = (rgb[o]     / 255 - 0.485) / 0.229;
            input[o + 1] = (rgb[o + 1] / 255 - 0.456) / 0.224;
            input[o + 2] = (rgb[o + 2] / 255 - 0.406) / 0.225;
          }
          const _tN = performance.now(); hudNormMs.value = _tN - _tR; // S0 HUD: normalise-loop ms
          const outs = model.runSync([input]); // fast-tflite 2.x: TypedArray[] in/out
          const _tI = performance.now(); hudDetMs.value = _tI - _tN; // S0 HUD: detector inference ms
          const hm = outs[0] as Float32Array;   // [1,64,64,4] NHWC raw heatmaps (already typed)
          const H = 64, W = 64;
          const cs = [0, 0, 0, 0, 0, 0, 0, 0];
          let peakSum = 0;
          for (let c = 0; c < 4; c++) {
            let mi = 0, mv = -1e9;
            for (let k = 0; k < H * W; k++) { const v = hm[k * 4 + c]; if (v > mv) { mv = v; mi = k; } }
            const py = (mi / W) | 0, pxk = mi % W;
            let sw = 0, sx = 0, sy = 0;
            for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
              const yy = py + dy, xx = pxk + dx;
              if (yy < 0 || yy >= H || xx < 0 || xx >= W) continue;
              const v = hm[(yy * W + xx) * 4 + c];
              if (v > 0) { sw += v; sx += v * xx; sy += v * yy; }
            }
            const ccx = sw > 0 ? sx / sw : pxk, ccy = sw > 0 ? sy / sw : py;
            cs[c * 2] = (ccx / (W - 1)) * 256;
            cs[c * 2 + 1] = (ccy / (H - 1)) * 256;
            peakSum += mv;
          }
          const peakAvg = peakSum / 4;
          cardActiveSV.value = peakAvg >= CARD_PRESENCE_MIN; // drives the adaptive detector rate
          const _tD = performance.now();
          hudDecodeMs.value = _tD - _tI;           // S0 HUD: heatmap decode ms
          hudWlMs.value = _tD - _t0;               // S0 HUD: whole callback budget
          hudDetCount.value += 1;                  // S0 HUD: effective detection rate
          // One-shot pixel handoff: build the number[] ONCE, only when we need it.
          if (captureNext.value || collectGrab.value) {
            const forCollect = collectGrab.value;
            captureNext.value = false; collectGrab.value = false;
            const arr: number[] = [];
            for (let i = 0; i < rgb.length; i++) arr.push(rgb[i]);
            onGrabbedFrame(arr, cs, peakAvg, frame.height, frame.width, forCollect);
            return; // liveBusy released by onGrabbedFrame
          }
          if (peakAvg < CARD_PRESENCE_MIN) { onNoCard(); liveBusy.value = false; return; }
          onCornerResult(cs, peakAvg, frame.height, frame.width);
        } catch (e) {
          liveBusy.value = false;
          if (!fpErrReported.value) { fpErrReported.value = true; onFpError(String(e)); }
        }
      });
      return;
    }

    // ── ONNX JS-thread detector (fallback when USE_TFLITE_DETECTOR=false) ──────
    if (!LIVE_AUTOSCAN || !embedReady.value || scanBlocked.value || liveBusy.value) return;
    frameTick.value += 1;
    if (frameTick.value % FRAME_THROTTLE !== 0) return;
    liveBusy.value = true;
    try {
      const rgb = resize(frame, {
        rotation: '90deg',
        scale: { width: 256, height: 256 },
        pixelFormat: 'rgb', dataType: 'uint8',
      });
      if (!fpReported.value) { fpReported.value = true; reportFp(true); }
      const arr: number[] = [];
      for (let i = 0; i < rgb.length; i++) arr.push(rgb[i]);
      onCornerFrame(arr, frame.height, frame.width);
    } catch (e) {
      liveBusy.value = false;
      if (!fpErrReported.value) { fpErrReported.value = true; onFpError(String(e)); }
    }
  }, [tfModel, tfReady, embedReady, scanBlocked, liveBusy, frameTick, resize, captureNext, collectGrab, fpReported, reportFp, fpErrReported, onFpError, onCornerFrame, onCornerResult, onGrabbedFrame, hudDetMs, hudWlMs, hudDetCount, hudResizeMs, hudNormMs, hudDecodeMs, cardActiveSV]);

  // ── Permission / device guards ─────────────────────────────────────────────

  if (!hasPermission) {
    return (
      <View style={[S.center, { backgroundColor: colors.bg }]}>
        <Text style={[S.title, { color: colors.accent }]}>📷 Camera needed</Text>
        <Text style={[S.body, { color: colors.textMuted }]}>
          DeckForge scans cards on-device. Images upload only when local matching isn't confident.
        </Text>
        <Pressable style={[S.fullBtn, { backgroundColor: colors.accent }]}
          onPress={() => requestPermission().catch(() => {})}>
          <Text style={[S.fullBtnText, { color: colors.accentText }]}>Grant access</Text>
        </Pressable>
        <Pressable style={[S.fullBtn, { backgroundColor: colors.surfaceAlt, borderColor: colors.border, borderWidth: 1, marginTop: 8 }]}
          onPress={onBack}>
          <Text style={[S.fullBtnText, { color: colors.textMuted }]}>← Back</Text>
        </Pressable>
      </View>
    );
  }

  if (!device) {
    return (
      <View style={[S.center, { backgroundColor: colors.bg }]}>
        <ActivityIndicator color={colors.accent} />
        <Text style={[S.body, { color: colors.textMuted }]}>Looking for back camera…</Text>
      </View>
    );
  }

  const dbLoaded = dbFlat != null;
  const busy = resolving || manualScanning;

  // HUD corner colour: white → amber (detected) → green (stable/locked)
  const hudColor = loadError
    ? '#ef4444'
    : (busy || aiThinking) ? '#f59e0b'
    : (alignState === 2 || reading) ? '#10b981'
    : alignState === 1 ? '#f59e0b'
    : dbLoaded ? 'rgba(255,255,255,0.55)'
    : 'rgba(255,255,255,0.2)';

  const NOTIF_C = {
    success: { bg: 'rgba(16,185,129,0.96)',  fg: '#fff' },
    warn:    { bg: 'rgba(245,158,11,0.96)',   fg: '#0a0e1a' },
    error:   { bg: 'rgba(239,68,68,0.96)',    fg: '#fff' },
  } as const;

  return (
    <View
      style={S.container}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        if (width > 0 && height > 0) viewSize.current = { w: width, h: height };
      }}
    >
      {/* Camera — always active unless we have a review result */}
      <Camera
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        device={device}
        format={format}
        pixelFormat="yuv"
        isActive={!result}
        frameProcessor={LIVE_AUTOSCAN && dbLoaded && !result ? frameProcessor : undefined}
        onError={onCameraError}
      />

      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      {!result && (
        <View style={S.topBar}>
          <Pressable style={S.pill} onPress={onBack}>
            <Text style={S.pillTxt}>← Back</Text>
          </Pressable>

          {/* Destination (quick mode) */}
          <Pressable style={[S.pill, S.pillFlex]} onPress={() => setDeckPickerVisible(true)}>
            <Text style={S.pillTxt} numberOfLines={1}>
              🗂 {currentDeck ? currentDeck.name : 'Library only'}
            </Text>
          </Pressable>

          {/* Quick / Review toggle */}
          <View style={S.modeToggle}>
            <Pressable
              style={[S.modeBtn, quickMode && S.modeBtnActive]}
              onPress={() => setQuickMode(true)}
            >
              <Text style={[S.modeTxt, quickMode && S.modeTxtActive]}>⚡ Quick</Text>
            </Pressable>
            <Pressable
              style={[S.modeBtn, !quickMode && S.modeBtnActive]}
              onPress={() => setQuickMode(false)}
            >
              <Text style={[S.modeTxt, !quickMode && S.modeTxtActive]}>👁 Review</Text>
            </Pressable>
          </View>

          {/* Collect-mode toggle (training-data capture) */}
          <Pressable style={[S.pill, collectMode && S.modeBtnActive]} onPress={toggleCollect}>
            <Text style={S.pillTxt}>{collectMode ? '⏺' : '⊕'}</Text>
          </Pressable>

          {/* S0 perf-HUD toggle (dev) */}
          <Pressable style={[S.pill, showHud && S.modeBtnActive]} onPress={() => setShowHud(v => !v)}>
            <Text style={S.pillTxt}>📊</Text>
          </Pressable>

          {/* S1.2 delegate cycle (dev): CPU → GPU → NN */}
          <Pressable style={[S.pill, delegateIdx !== 0 && S.modeBtnActive]} onPress={() => setDelegateIdx(i => (i + 1) % DELEGATE_TABLE.length)}>
            <Text style={S.pillTxt}>{delegate === 'default' ? 'CPU' : delegate === 'android-gpu' ? 'GPU' : delegate === 'nnapi' ? 'NN' : delegate}</Text>
          </Pressable>

          {/* DB live indicator */}
          <View style={S.pill}>
            <View style={[S.dot, dbLoaded && S.dotReady]} />
          </View>
        </View>
      )}

      {/* ── Resting viewfinder guide (only while SEARCHING; the perspective quad
             takes over the moment a card is detected) ──────────────────────── */}
      {!result && alignState === 0 && (
        <View pointerEvents="none" style={S.vfWrap}>
          <View style={[S.trackBox, { borderColor: hudColor, opacity: 0.55 }]}>
            <View style={[S.corner, S.cornerTL, { borderColor: hudColor }]} />
            <View style={[S.corner, S.cornerTR, { borderColor: hudColor }]} />
            <View style={[S.corner, S.cornerBR, { borderColor: hudColor }]} />
            <View style={[S.corner, S.cornerBL, { borderColor: hudColor }]} />
          </View>
        </View>
      )}

      {/* ── S3 interim — true perspective-quad lock-on (hugs the card at any
             angle). Renders itself imperatively via quadRef. ─────────────────── */}
      {!result && <QuadOverlay ref={quadRef} />}

      {/* Hint text — fixed position, does not move with the lock-on box */}
      {!result && (
        <View pointerEvents="none" style={S.hintWrap}>
          <Text style={S.vfHint}>
            {collectMode ? '⏺ Collect-mode — frame any card (bare/sleeved/toploader/2–3 in view) & tap Capture'
              : loadError ? `⚠️ Load failed: ${loadError}`
              : !dbLoaded ? `⏳ ${loadStage}`
              : escalateMsg ? escalateMsg
              : resolving ? '⚡ Saving…'
              : manualScanning ? '⚡ Reading card…'
              : reading ? '🔍 Identifying…'
              : alignState >= 1 ? '🎯 Tracking card…'
              : '📷 Point at a card'}
          </Text>
        </View>
      )}

      {/* ── Diagnostics strip (temporary, top so it's readable) ─────────── */}
      {!result && (
        <View pointerEvents="none" style={S.diag}>
          <Text style={S.diagText}>
            [{BUILD_TAG}·{activeDelegate === 'default' ? 'CPU' : activeDelegate}]  DB: {dbLoaded ? `✓ ${dbCount}` : '…'}   ·   Auto-scan: {
              fpStatus === 'active' ? '✓ live' : fpStatus === 'unavailable' ? '✗' : dbLoaded ? '…ready' : '…'
            }
          </Text>
          <Text style={S.diagHint}>
            {ONDEVICE_MATCH ? embedStatus
              : liveDist != null ? `last match dist=${liveDist} (lower=better, ≤${AUTO_MAX_DIST} adds)` : 'point at a card'}
          </Text>
        </View>
      )}

      {/* ── S0 perf HUD (dev-only; toggle 📊 in the top bar) ────────────── */}
      {!result && showHud && (
        <View pointerEvents="none" style={S.perfHud}>
          <Text style={S.perfHudText}>det {hud.det}ms · {hud.hz}Hz · wl {hud.wl}ms</Text>
          <Text style={S.perfHudText}>rz {hud.rz}ms · nm {hud.nm}ms · dc {hud.dc}ms</Text>
          <Text style={S.perfHudText}>emb {hud.emb || '–'}ms · match {hud.match || '–'}ms</Text>
          <Text style={S.perfHudText}>lock {hud.lock || '–'}ms · id {hud.id || '–'}ms</Text>
        </View>
      )}

      {/* ── Quick-mode flash notification ──────────────────────────────── */}
      {scanNotif && (
        <Animated.View style={[
          S.notif,
          {
            backgroundColor: NOTIF_C[scanNotif.type].bg,
            opacity: notifAnim,
            transform: [{ translateY: notifAnim.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
          },
        ]}>
          <Text style={[S.notifTitle, { color: NOTIF_C[scanNotif.type].fg }]} numberOfLines={1}>
            {scanNotif.type === 'error' ? '✗' : '✓'} {scanNotif.text}
          </Text>
          {scanNotif.sub && (
            <Text style={[S.notifSub, { color: NOTIF_C[scanNotif.type].fg }]}>
              {scanNotif.engine === 'smart' ? '✨ AI Smart Scan  ·  ' : scanNotif.engine === 'ocr' ? '🔤 Name match  ·  ' : scanNotif.engine === 'local' ? '⚡ On-device  ·  ' : ''}{scanNotif.sub}
            </Text>
          )}
        </Animated.View>
      )}

      {/* ── Force scan button (bottom bar, no result) ───────────────────── */}
      {!result && (
        <View style={S.bottomBar}>
          {collectMode ? (
            <>
              <Pressable style={S.forceBtn} onPress={captureCollect}>
                <Text style={S.forceTxt}>⏺ Capture frame  ·  {collectCount} saved</Text>
              </Pressable>
              <Text style={S.aiHint}>Saving detector frames + corners for fine-tuning</Text>
            </>
          ) : (
            <>
              <Pressable style={[S.forceBtn, busy && S.btnDim]} onPress={onManualCapture} disabled={busy}>
                {manualScanning
                  ? <ActivityIndicator color="#0a0e1a" size="small" />
                  : <Text style={S.forceTxt}>{ONDEVICE_MATCH ? '📱 Embed scan (on-device)' : SERVER_MATCH ? '✨ Embed scan (server)' : '⚡ Force scan'}</Text>}
              </Pressable>
              <Text style={S.aiHint}>{MAX_FREE_AI_SCANS - aiScansUsed} AI scans remaining today</Text>
            </>
          )}
        </View>
      )}

      {/* ── Review mode result sheet ─────────────────────────────────────── */}
      {result && (
        <View style={S.backdrop}>
          <Animated.View style={[S.sheet, { transform: [{ translateY: sheetAnim }] }]}>
            {/* Card info row */}
            <View style={S.cardRow}>
              {result.image_uri
                ? <Image source={{ uri: result.image_uri }} style={S.cardImg} />
                : <View style={[S.cardImg, S.cardImgPh]}><Text style={{ fontSize: 28 }}>🃏</Text></View>
              }
              <View style={{ flex: 1 }}>
                <Text style={[S.engineBadge, result._engine === 'smart' ? S.engineSmart : S.engineLocal]}>
                  {result._engine === 'smart' ? '✨ AI Smart Scan' : result._engine === 'ocr' ? '🔤 Name match' : '⚡ On-device match'}
                </Text>
                {result._dist != null && (
                  <Text style={S.debugLine}>
                    dist={result._dist} · gap={result._gap} · {result._detected ? '📐 card found' : '✂️ no card (crop)'}
                    {result._contours != null ? ` · contours=${result._contours} quads=${result._quads}` : ''} · {result._confident ? 'CONFIDENT' : 'low-conf'}
                  </Text>
                )}
                <Text style={S.cardName}>{result.card_name}</Text>
                {!!result.type_line && <Text style={S.cardMeta}>{result.type_line}</Text>}
                {!!result.set_name && (
                  <Text style={S.cardMeta}>
                    {result.set_name}{result.set_code ? ` · ${result.set_code.toUpperCase()}` : ''}
                  </Text>
                )}
                {result.price_eur != null && (
                  <Text style={S.cardPrice}>{formatPrice(result.price_eur)}</Text>
                )}
              </View>
            </View>

            {/* Foil toggle */}
            <Pressable style={[S.foilRow, isFoil && S.foilRowActive]} onPress={() => setIsFoil(f => !f)}>
              <Text style={[S.foilLabel, isFoil && S.foilLabelActive]}>✦ Foil printing</Text>
              <View style={[S.switchTrack, isFoil && S.switchTrackOn]}>
                <View style={[S.switchKnob, isFoil && S.switchKnobOn]} />
              </View>
            </Pressable>

            {/* Destination selector */}
            <Pressable style={S.destRow} onPress={() => setDeckPickerVisible(true)}>
              <Text style={S.destLabel}>Adding to</Text>
              <Text style={S.destValue} numberOfLines={1}>
                {currentDeck ? currentDeck.name : 'Library only'} ›
              </Text>
            </Pressable>

            {/* Actions */}
            <View style={S.actionRow}>
              <Pressable style={S.rescanBtn} onPress={onReviewRescan}>
                <Text style={S.rescanTxt}>Rescan</Text>
              </Pressable>
              <Pressable style={S.addBtn} onPress={onReviewAdd}>
                <Text style={S.addTxt}>Add card</Text>
              </Pressable>
            </View>
          </Animated.View>
        </View>
      )}

      {/* Deck picker — used from top bar (quick) and result sheet (review) */}
      <DeckPickerSheet
        userId={userId}
        visible={deckPickerVisible}
        onClose={() => setDeckPickerVisible(false)}
        onPick={deck => {
          setCurrentDeck(deck);
          setDeckPickerVisible(false);
        }}
      />
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const S = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { fontSize: 20, fontWeight: '700', marginBottom: 12 },
  body: { fontSize: 14, lineHeight: 20, textAlign: 'center', marginBottom: 16, maxWidth: 320 },
  fullBtn: { paddingVertical: 14, borderRadius: 12, alignItems: 'center', width: '100%', maxWidth: 280 },
  fullBtnText: { fontWeight: '700', fontSize: 14 },

  // Top bar
  topBar: {
    position: 'absolute', top: 50, left: 12, right: 12,
    flexDirection: 'row', alignItems: 'center', gap: 6,
  },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(17,24,39,0.82)', borderColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 20,
  },
  pillFlex: { flex: 1 },
  pillTxt: { color: '#f1f5f9', fontSize: 11, fontWeight: '600' },

  // Mode toggle
  modeToggle: {
    flexDirection: 'row',
    backgroundColor: 'rgba(17,24,39,0.82)', borderColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1, borderRadius: 20, overflow: 'hidden',
  },
  modeBtn: { paddingHorizontal: 10, paddingVertical: 7 },
  modeBtnActive: { backgroundColor: 'rgba(245,158,11,0.25)' },
  modeTxt: { color: 'rgba(255,255,255,0.45)', fontSize: 11, fontWeight: '600' },
  modeTxtActive: { color: '#f59e0b' },

  dot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: '#f59e0b' },
  dotReady: { backgroundColor: '#10b981' },

  // Lock-on tracking box (transformed by Animated translate/scale)
  vfWrap: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  trackBox: { width: 232, height: 324, borderRadius: 14, borderWidth: 2 },
  // Corner accent pieces — colour applied inline
  corner: { position: 'absolute', width: 26, height: 26, borderWidth: 3 },
  cornerTL: { top: -2, left: -2, borderRightWidth: 0, borderBottomWidth: 0, borderTopLeftRadius: 10 },
  cornerTR: { top: -2, right: -2, borderLeftWidth: 0, borderBottomWidth: 0, borderTopRightRadius: 10 },
  cornerBR: { bottom: -2, right: -2, borderLeftWidth: 0, borderTopWidth: 0, borderBottomRightRadius: 10 },
  cornerBL: { bottom: -2, left: -2, borderRightWidth: 0, borderTopWidth: 0, borderBottomLeftRadius: 10 },
  // Hint text sits fixed below centre (does not track the card)
  hintWrap: {
    position: 'absolute', left: 0, right: 0, top: SCREEN_H * 0.5 + 180,
    alignItems: 'center',
  },
  vfHint: {
    color: 'rgba(255,255,255,0.9)', fontSize: 13, textAlign: 'center',
    paddingHorizontal: 20, backgroundColor: 'rgba(0,0,0,0.45)',
    paddingVertical: 6, borderRadius: 10, overflow: 'hidden',
  },

  // Diagnostics strip (top, below the top bar)
  diag: {
    position: 'absolute', top: 92, left: 16, right: 16, alignItems: 'center', gap: 4,
  },
  diagText: {
    color: 'rgba(255,255,255,0.7)', fontSize: 11, fontWeight: '600',
    backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: 10, overflow: 'hidden',
  },
  diagBig: {
    color: '#f59e0b', fontSize: 16, fontWeight: '800',
    backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 12, paddingVertical: 5,
    borderRadius: 10, overflow: 'hidden',
  },
  diagHint: {
    color: 'rgba(255,255,255,0.5)', fontSize: 10,
    backgroundColor: 'rgba(0,0,0,0.4)', paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 8, overflow: 'hidden',
  },
  debugLine: { color: '#fbbf24', fontSize: 11, fontWeight: '700', marginBottom: 4 },

  // S0 perf HUD — top-left below the diag strip, in clear space; never intercepts touches.
  perfHud: {
    position: 'absolute', left: 12, top: 132, alignItems: 'flex-start', gap: 2,
  },
  perfHudText: {
    color: '#34d399', fontSize: 11, fontWeight: '700', fontVariant: ['tabular-nums'],
    backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 8, paddingVertical: 2,
    borderRadius: 6, overflow: 'hidden',
  },

  // Flash notification
  notif: {
    position: 'absolute', bottom: 110, left: 20, right: 20,
    borderRadius: 14, paddingHorizontal: 18, paddingVertical: 13,
    alignItems: 'center', elevation: 8,
    shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 4 },
  },
  notifTitle: { fontSize: 15, fontWeight: '700', textAlign: 'center' },
  notifSub: { fontSize: 12, fontWeight: '500', marginTop: 3, opacity: 0.88 },

  // Bottom bar
  bottomBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    paddingHorizontal: 20, paddingBottom: 36, paddingTop: 14,
    backgroundColor: 'rgba(10,14,26,0.88)',
    borderTopColor: 'rgba(30,45,71,0.8)', borderTopWidth: 1,
    alignItems: 'center', gap: 8,
  },
  forceBtn: {
    width: '100%', backgroundColor: '#f59e0b',
    paddingVertical: 14, borderRadius: 12, alignItems: 'center',
  },
  forceTxt: { color: '#0a0e1a', fontWeight: '700', fontSize: 14 },
  btnDim: { opacity: 0.45 },
  aiHint: { color: 'rgba(255,255,255,0.38)', fontSize: 11 },

  // Review sheet
  backdrop: { ...StyleSheet.absoluteFillObject, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    backgroundColor: '#111827',
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    borderTopColor: '#1e2d47', borderTopWidth: 1,
    padding: 20, paddingBottom: 40,
  },
  cardRow: { flexDirection: 'row', gap: 14, marginBottom: 18 },
  cardImg: { width: 64, height: 90, borderRadius: 8, backgroundColor: '#1a2235' },
  cardImgPh: { alignItems: 'center', justifyContent: 'center' },
  engineBadge: {
    alignSelf: 'flex-start', fontSize: 11, fontWeight: '700',
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, marginBottom: 6,
    overflow: 'hidden',
  },
  engineLocal: { backgroundColor: 'rgba(16,185,129,0.15)', color: '#10b981' },
  engineSmart: { backgroundColor: 'rgba(245,158,11,0.15)', color: '#f59e0b' },
  cardName: { color: '#f1f5f9', fontSize: 17, fontWeight: '700', marginBottom: 4 },
  cardMeta: { color: '#64748b', fontSize: 13, marginBottom: 2 },
  cardPrice: { color: '#10b981', fontSize: 14, fontWeight: '600', marginTop: 4 },

  foilRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#1a2235', borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 13, marginBottom: 10,
    borderWidth: 1, borderColor: '#1e2d47',
  },
  foilRowActive: { borderColor: '#7c3aed', backgroundColor: 'rgba(124,58,237,0.1)' },
  foilLabel: { color: '#94a3b8', fontSize: 14, fontWeight: '600' },
  foilLabelActive: { color: '#c4b5fd' },
  switchTrack: { width: 40, height: 22, borderRadius: 11, backgroundColor: '#1e2d47', position: 'relative' },
  switchTrackOn: { backgroundColor: '#7c3aed' },
  switchKnob: { position: 'absolute', top: 3, left: 3, width: 16, height: 16, borderRadius: 8, backgroundColor: '#64748b' },
  switchKnobOn: { left: 21, backgroundColor: '#fff' },

  destRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#1a2235', borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 13, marginBottom: 18,
    borderWidth: 1, borderColor: '#1e2d47',
  },
  destLabel: { color: '#64748b', fontSize: 13 },
  destValue: { color: '#f1f5f9', fontSize: 14, fontWeight: '600', flex: 1, textAlign: 'right' },

  actionRow: { flexDirection: 'row', gap: 10 },
  rescanBtn: {
    flex: 1, backgroundColor: '#1a2235', borderColor: '#1e2d47', borderWidth: 1,
    paddingVertical: 14, borderRadius: 12, alignItems: 'center',
  },
  rescanTxt: { color: '#94a3b8', fontWeight: '600' },
  addBtn: { flex: 2, backgroundColor: '#f59e0b', paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  addTxt: { color: '#0a0e1a', fontWeight: '700', fontSize: 15 },
});
