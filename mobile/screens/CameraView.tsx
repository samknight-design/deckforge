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

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  Image,
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
} from 'react-native-vision-camera';
import { useSharedValue, useRunOnJS } from 'react-native-worklets-core';
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

// ── Constants ─────────────────────────────────────────────────────────────────

// Bump this string whenever the scanner changes — it's shown on screen so we can
// confirm which build is actually running on the device (no more guessing).
const BUILD_TAG = 'fluid-v4';

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
const MATCH_SERVER_URL = 'http://localhost:8765/match';
// Embedding cosine confidence gate. Measured on real captures: correct matches
// ≥0.73, wrong matches ~0.63. Accept ≥ this, else ask for a realign+retry — so a
// bad/loose capture fails LOUD instead of adding the wrong card. Tune with data.
// Real cards (CPU encoder) score 0.856–0.918; fakes/garbage/bad-crops ≤0.75.
// 0.82 sits in the clean gap → genuine cards accept, a hand-drawn fake or loose
// crop is rejected ("realign & retry") instead of being force-matched. This is the
// rejection ManaBox does — it only commits when it's actually confident.
const CONF_MIN = 0.82;

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
  const lastDumpAt = useRef(0);  // throttle for the DUMP_WARP diagnostic
  const dumpIdx = useRef(0);     // rotating filename index for warp dumps
  const lastQuadCx = useRef(0);  // last corner-model quad centroid (frame space, stability)
  const lastQuadCy = useRef(0);
  const emaPts = useRef<Array<{ x: number; y: number }>>([]); // EMA-smoothed box corners (frame space)
  const emaValid = useRef(false); // false → next detection seeds the EMA (no drag from a stale lock)

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
  const [popcountTable]       = useState<number[]>(() => {
    const t = new Array(256); t[0] = 0;
    for (let i = 1; i < 256; i++) t[i] = (i & 1) + t[i >> 1];
    return t;
  });

  // ── Shared values ──────────────────────────────────────────────────────────

  const consecutiveCount = useSharedValue(0);
  const lastMatchIndex   = useSharedValue(-1);
  const scanBlocked      = useSharedValue(false);
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
  const lastAlign = useRef(0);
  const lastRot = useRef(0);
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
    lastRot.current = 0;
    springTo(0, 0, 1, 1, 0);
    if (lastAlign.current !== 0) { lastAlign.current = 0; setAlignState(0); }
  }, [springTo]);

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
    if (!ONDEVICE_MATCH) return;
    import('../lib/embedScan')
      .then(m => m.initEmbedScan(s => { if (mounted.current) setEmbedStatus(s); }))
      .then(() => { embedReady.value = true; })
      .catch(e => {
        console.log('[embed-init-error]', e?.message || String(e), e?.stack || '');
        if (mounted.current) setEmbedStatus('embed init failed: ' + (e?.message || e));
      });
  }, []);

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
      const A = 0.5; // higher = snappier, lower = smoother
      if (!emaValid.current || emaPts.current.length !== 4) {
        emaPts.current = fpt.map((p) => ({ x: p.x, y: p.y }));
        emaValid.current = true;
      } else {
        for (let i = 0; i < 4; i++) {
          emaPts.current[i].x += A * (fpt[i].x - emaPts.current[i].x);
          emaPts.current[i].y += A * (fpt[i].y - emaPts.current[i].y);
        }
      }
      const spt = emaPts.current;
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
      stableCount.value = moved < sq * 0.04 ? stableCount.value + 1 : 1;
      const fState = stableCount.value >= STABLE_FRAMES_NEEDED ? 2 : 1;
      springTo(
        cx - viewSize.current.w / 2, cy - viewSize.current.h / 2,
        Math.max(0.2, Math.min(2.4, sw / BOX_W)), Math.max(0.2, Math.min(2.4, sh / BOX_H)), ang,
      );
      if (fState !== lastAlign.current) { lastAlign.current = fState; setAlignState(fState as 0 | 1 | 2); }

      if (stableCount.value < STABLE_FRAMES_NEEDED) return;

      // Locked + steady → warp the card flat and embed.
      scanBlocked.value = true;
      stableCount.value = 0;
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
    if (!LIVE_AUTOSCAN || !embedReady.value || scanBlocked.value || liveBusy.value) return;
    frameTick.value += 1;
    if (frameTick.value % FRAME_THROTTLE !== 0) return;

    // Claim the busy-lock NOW, before the expensive resize+marshal, so the next
    // camera frames skip instead of redundantly marshalling while this one is in
    // flight. onCornerFrame releases it in its finally; the catch below releases it
    // if we never reach the dispatch. This is what keeps the detect→detect latency
    // minimal (tight tracking) without piling up work on the camera thread.
    liveBusy.value = true;
    try {
      // ROTATE the sensor frame to upright portrait FIRST, then auto centre-square-
      // crop + resize to 256×256 RGB. Critical: the back-camera frame is landscape,
      // so a portrait-held card lies SIDEWAYS and spans wider than the square — a
      // landscape square-crop clips the card's ends → corner model fits a card-shaped
      // quad to a fragment → garbage warp → "Blank Card"/"The Bean". Rotating first
      // makes the card upright (narrower than tall) so it fits the square intact.
      const rgb = resize(frame, {
        rotation: '90deg',
        scale: { width: 256, height: 256 }, // auto centre-square-crop of the upright frame
        pixelFormat: 'rgb', dataType: 'uint8',
      });
      if (!fpReported.value) { fpReported.value = true; reportFp(true); }

      // Marshal to a plain number[] (typed arrays come across as zeros worklet→JS).
      // Pass ROTATED dims (width/height swap after 90°) for the box-mapping math.
      const arr: number[] = [];
      for (let i = 0; i < rgb.length; i++) arr.push(rgb[i]);
      onCornerFrame(arr, frame.height, frame.width);
    } catch (e) {
      liveBusy.value = false; // never dispatched → release so we don't wedge
      if (!fpErrReported.value) { fpErrReported.value = true; onFpError(String(e)); }
    }
  }, [embedReady, scanBlocked, liveBusy, frameTick, resize, fpReported, reportFp, fpErrReported, onFpError, onCornerFrame]);

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

          {/* DB live indicator */}
          <View style={S.pill}>
            <View style={[S.dot, dbLoaded && S.dotReady]} />
          </View>
        </View>
      )}

      {/* ── Lock-on tracking box ────────────────────────────────────────── */}
      {!result && (
        <View pointerEvents="none" style={S.vfWrap}>
          <Animated.View style={[
            S.trackBox,
            {
              borderColor: hudColor,
              opacity: alignState === 0 ? 0.55 : 1,
              transform: [
                { translateX: trackTX },
                { translateY: trackTY },
                { rotate: trackRot.interpolate({ inputRange: [-360, 360], outputRange: ['-360deg', '360deg'] }) },
                { scaleX: trackSX },
                { scaleY: trackSY },
              ],
            },
          ]}>
            {/* Corner accents for the lock-on look */}
            <View style={[S.corner, S.cornerTL, { borderColor: hudColor }]} />
            <View style={[S.corner, S.cornerTR, { borderColor: hudColor }]} />
            <View style={[S.corner, S.cornerBR, { borderColor: hudColor }]} />
            <View style={[S.corner, S.cornerBL, { borderColor: hudColor }]} />
          </Animated.View>
        </View>
      )}

      {/* Hint text — fixed position, does not move with the lock-on box */}
      {!result && (
        <View pointerEvents="none" style={S.hintWrap}>
          <Text style={S.vfHint}>
            {loadError ? `⚠️ Load failed: ${loadError}`
              : !dbLoaded ? `⏳ ${loadStage}`
              : escalateMsg ? escalateMsg
              : resolving ? '⚡ Saving…'
              : manualScanning ? '⚡ Reading card…'
              : reading ? '🔍 Reading card… hold steady'
              : alignState === 2 ? '🎯 Locked on — hold steady'
              : alignState === 1 ? '🔎 Card detected — hold still'
              : SERVER_MATCH ? '🃏 Fill the box with the card, then tap Embed scan'
              : '📷 Point at a card — it locks on automatically'}
          </Text>
        </View>
      )}

      {/* ── Diagnostics strip (temporary, top so it's readable) ─────────── */}
      {!result && (
        <View pointerEvents="none" style={S.diag}>
          <Text style={S.diagText}>
            [{BUILD_TAG}]  DB: {dbLoaded ? `✓ ${dbCount}` : '…'}   ·   Auto-scan: {
              fpStatus === 'active' ? '✓ live' : fpStatus === 'unavailable' ? '✗' : dbLoaded ? '…ready' : '…'
            }
          </Text>
          <Text style={S.diagHint}>
            {ONDEVICE_MATCH ? embedStatus
              : liveDist != null ? `last match dist=${liveDist} (lower=better, ≤${AUTO_MAX_DIST} adds)` : 'hold a card steady in the box'}
          </Text>
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
          <Pressable style={[S.forceBtn, busy && S.btnDim]} onPress={onManualCapture} disabled={busy}>
            {manualScanning
              ? <ActivityIndicator color="#0a0e1a" size="small" />
              : <Text style={S.forceTxt}>{ONDEVICE_MATCH ? '📱 Embed scan (on-device)' : SERVER_MATCH ? '✨ Embed scan (server)' : '⚡ Force scan'}</Text>}
          </Pressable>
          <Text style={S.aiHint}>{MAX_FREE_AI_SCANS - aiScansUsed} AI scans remaining today</Text>
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
