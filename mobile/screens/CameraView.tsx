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
import { dhashGray, reversed } from '../lib/scanOpenCV';
import { matchHash } from '@deckforge/shared/cardScan';
import { useTheme } from '../lib/theme';
import { tryCompleteChallenge } from '../lib/challenges';
import { useXpToast } from '../lib/xpToast';
import DeckPickerSheet from '../components/DeckPickerSheet';

// ── Constants ─────────────────────────────────────────────────────────────────

// Bump this string whenever the scanner changes — it's shown on screen so we can
// confirm which build is actually running on the device (no more guessing).
const BUILD_TAG = 'opencv-v6';

// Continuous auto-scan: native OpenCV detects + flattens the card every (throttled)
// frame on the camera thread; the heavy 114k match runs once on the JS thread only
// when a card is held steady. No snapshot, no per-frame full-DB scan, no freeze.
const LIVE_AUTOSCAN = true;

// dist ≤ this counts as a confident match. gap is NOT used — reprints share
// artwork, so the runner-up is often another printing of the SAME card (gap≈0).
const AUTO_MAX_DIST        = 72;
const STABLE_FRAMES_NEEDED = 3;     // card centroid steady this many detections → lock
const FRAME_THROTTLE       = 3;     // run the detector every Nth frame
const SCAN_COOLDOWN_MS     = 1500;  // pause after a hit before re-arming
const MAX_FREE_AI_SCANS    = 10;

// Live OpenCV processing + warp geometry
const PROC_LONG     = 480;          // detection resolution (long side)
const WARP_W        = 146;          // warped card size fed to the matcher
const WARP_H        = 204;
const MIN_AREA_FRAC = 0.08;         // card quad must cover ≥8% of the frame
const ASPECT_LO     = 0.55;         // card ratio 63/88 ≈ 0.716
const ASPECT_HI     = 0.92;

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

type Engine = 'local' | 'smart';

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
  const [loadError, setLoadError] = useState<string | null>(null);
  // 'unknown' until the frame processor runs once; 'active' if raw pixels work,
  // 'unavailable' if frame.toArrayBuffer() throws (needs the minSdkVersion-26 build)
  const [fpStatus, setFpStatus] = useState<'unknown' | 'active' | 'unavailable'>('unknown');
  // Live match readout (DIAGNOSTIC): best Hamming distance + gap, updated a few
  // times per second from the frame processor, so we can see how close matches are.
  const [liveDist, setLiveDist] = useState<number | null>(null);
  const [liveGap, setLiveGap]   = useState<number | null>(null);
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
  const lastCx           = useSharedValue(0);      // last detected card centroid (stability)
  const lastCy           = useSharedValue(0);
  const stableCount      = useSharedValue(0);      // consecutive steady detections

  // Called from the worklet (once) to report whether raw-pixel access works.
  const reportFp = useRunOnJS((ok: boolean) => {
    if (mounted.current) setFpStatus(ok ? 'active' : 'unavailable');
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

  // ── Helpers ────────────────────────────────────────────────────────────────

  const resetScanner = useCallback((delayMs = 0) => {
    const go = () => {
      if (!mounted.current) return;
      scanBlocked.value = false;
      consecutiveCount.value = 0;
      lastMatchIndex.value = -1;
    };
    if (delayMs > 0) setTimeout(go, delayMs);
    else go();
  }, [scanBlocked, consecutiveCount, lastMatchIndex]);

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

  // Called from the worklet when a steady card has been detected + flattened.
  // Runs the 114k match on the JS thread (fast, off the camera thread), then
  // auto-adds (quick) or opens the review sheet — using LOCAL names, NO network.
  const onWarpedCard = useRunOnJS(async (buf: number[], w: number, h: number) => {
    if (!dbFlat || !dbIds || !mounted.current) { scanBlocked.value = false; return; }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    const u8 = Uint8Array.from(buf);
    const db = { count: dbCount, bytesPerHash: 32, flat: dbFlat };
    const m0 = matchHash(dhashGray(u8, w, h), db);
    const m180 = matchHash(dhashGray(reversed(u8), w, h), db);
    const m = m180.distance < m0.distance ? m180 : m0;
    setLiveDist(m.distance); setLiveGap(m.runnerUp - m.distance);
    const nmDbg = (dbNames && nameAt(dbNames, m.index)) || '?';
    console.log(`[live] best=${nmDbg} dist=${m.distance} → ${m.distance <= AUTO_MAX_DIST ? 'ADD' : 'skip'}`);

    if (m.distance > AUTO_MAX_DIST) { resetScanner(500); return; } // unsure → keep scanning

    const id = idAt(dbIds, m.index);
    const nm = (dbNames && nameAt(dbNames, m.index)) || 'Card';
    if (!id) { resetScanner(500); return; }

    if (quickMode) {
      await doAdd({ scryfall_id: id, card_name: nm }, false, currentDeck);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
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
  }, [dbFlat, dbCount, dbIds, dbNames, quickMode, currentDeck, doAdd, showNotif, resetScanner, scanBlocked]);

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

  const onManualCapture = useCallback(async () => {
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
      if (match?.scryfallId) {
        // DIAGNOSTIC: always show the OpenCV best guess + numbers (confident or
        // not) so we can read on screen whether the matcher got the right card.
        const confident = match.detected && match.distance <= 70 && match.gap >= 5;
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
              _confident: confident,
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
  }, [cameraRef, manualScanning, resolving, result, aiScansUsed, quickMode, currentDeck, doAdd, showNotif, handleLocalMatch, resetScanner, scanBlocked]);

  // ── Frame processor ────────────────────────────────────────────────────────

  const frameProcessor = useFrameProcessor((frame) => {
    'worklet';
    if (!LIVE_AUTOSCAN || !dbReady.value || scanBlocked.value) return;
    frameTick.value += 1;
    if (frameTick.value % FRAME_THROTTLE !== 0) return;

    try {
      const fw = frame.width, fh = frame.height;
      let pw: number, ph: number;
      if (fw >= fh) { pw = PROC_LONG; ph = Math.round((fh * PROC_LONG) / fw); }
      else { ph = PROC_LONG; pw = Math.round((fw * PROC_LONG) / fh); }

      // Frame → resized BGR buffer → Mat (native, no snapshot).
      const rgb = resize(frame, { scale: { width: pw, height: ph }, pixelFormat: 'bgr', dataType: 'uint8' });
      const src = OpenCV.bufferToMat('uint8', ph, pw, 3, rgb);
      const gray = OpenCV.createObject(ObjectType.Mat, 0, 0, DataTypes.CV_8U);
      OpenCV.invoke('cvtColor', src, gray, ColorConversionCodes.COLOR_BGR2GRAY);
      const blur = OpenCV.createObject(ObjectType.Mat, 0, 0, DataTypes.CV_8U);
      OpenCV.invoke('GaussianBlur', gray, blur, OpenCV.createObject(ObjectType.Size, 5, 5), 0);
      const edges = OpenCV.createObject(ObjectType.Mat, 0, 0, DataTypes.CV_8U);
      OpenCV.invoke('Canny', blur, edges, 30, 90);
      // Thicken edges so faint/low-contrast card borders close into one contour.
      const dil = OpenCV.createObject(ObjectType.Mat, 0, 0, DataTypes.CV_8U);
      const kernel = OpenCV.createObject(ObjectType.Mat, 5, 5, DataTypes.CV_8U, new Array(25).fill(1));
      OpenCV.invoke('dilate', edges, dil, kernel, OpenCV.createObject(ObjectType.Point, -1, -1), 2,
        BorderTypes.BORDER_CONSTANT, OpenCV.createObject(ObjectType.Scalar, 0));
      const contours = OpenCV.createObject(ObjectType.MatVector);
      OpenCV.invoke('findContours', dil, contours, RetrievalModes.RETR_EXTERNAL, ContourApproximationModes.CHAIN_APPROX_SIMPLE);
      const cinfo = OpenCV.toJSValue(contours);
      const n = cinfo.array.length;
      if (!fpReported.value) { fpReported.value = true; reportFp(true); }

      const minArea = MIN_AREA_FRAC * pw * ph;
      let best: Pt[] | null = null;
      let bestArea = 0;
      for (let i = 0; i < n; i++) {
        const c = OpenCV.copyObjectFromVector(contours, i);
        const area = OpenCV.invoke('contourArea', c, false).value;
        if (area < minArea) continue;
        const rr = OpenCV.invoke('minAreaRect', c);
        const r = OpenCV.toJSValue(rr) as { centerX: number; centerY: number; width: number; height: number; angle: number };
        const rw = r.width, rh = r.height;
        if (rw <= 1 || rh <= 1) continue;
        const ratio = Math.min(rw, rh) / Math.max(rw, rh);
        if (ratio < ASPECT_LO || ratio > ASPECT_HI) continue;
        const rectArea = rw * rh;
        if (area < 0.6 * rectArea) continue; // contour must mostly fill its box (a card does)
        if (rectArea > bestArea) { bestArea = rectArea; best = orderQuadPortraitW(rectCornersW(r)); }
      }

      if (!best) { stableCount.value = 0; OpenCV.clearBuffers(); return; }

      // Require the card to be held roughly still before locking (avoids blur).
      const cx = (best[0].x + best[1].x + best[2].x + best[3].x) / 4;
      const cy = (best[0].y + best[1].y + best[2].y + best[3].y) / 4;
      const moved = Math.abs(cx - lastCx.value) + Math.abs(cy - lastCy.value);
      lastCx.value = cx; lastCy.value = cy;
      stableCount.value = moved < pw * 0.05 ? stableCount.value + 1 : 1;

      if (stableCount.value >= STABLE_FRAMES_NEEDED) {
        const srcPV = OpenCV.createObject(ObjectType.Point2fVector, [
          OpenCV.createObject(ObjectType.Point2f, best[0].x, best[0].y),
          OpenCV.createObject(ObjectType.Point2f, best[1].x, best[1].y),
          OpenCV.createObject(ObjectType.Point2f, best[2].x, best[2].y),
          OpenCV.createObject(ObjectType.Point2f, best[3].x, best[3].y),
        ]);
        const dstPV = OpenCV.createObject(ObjectType.Point2fVector, [
          OpenCV.createObject(ObjectType.Point2f, 0, 0),
          OpenCV.createObject(ObjectType.Point2f, WARP_W - 1, 0),
          OpenCV.createObject(ObjectType.Point2f, WARP_W - 1, WARP_H - 1),
          OpenCV.createObject(ObjectType.Point2f, 0, WARP_H - 1),
        ]);
        const M = OpenCV.invoke('getPerspectiveTransform', srcPV, dstPV, DecompTypes.DECOMP_LU);
        const warped = OpenCV.createObject(ObjectType.Mat, 0, 0, DataTypes.CV_8U);
        OpenCV.invoke('warpPerspective', gray, warped, M, OpenCV.createObject(ObjectType.Size, WARP_W, WARP_H),
          InterpolationFlags.INTER_LINEAR, BorderTypes.BORDER_CONSTANT, OpenCV.createObject(ObjectType.Scalar, 0));
        const out = OpenCV.matToBuffer(warped, 'uint8');
        const src = out.buffer;
        const len = src.length;
        // Copy into a plain number[] BEFORE clearBuffers frees native memory, and
        // pass an array (reliably marshalled worklet→JS). Native views / typed
        // arrays came across as zeros → every scan matched the same card.
        const arr: number[] = [];
        for (let i = 0; i < len; i++) arr.push(src[i]);
        scanBlocked.value = true; // lock until the JS handler resolves + cools down
        stableCount.value = 0;
        OpenCV.clearBuffers();
        onWarpedCard(arr, out.cols, out.rows);
        return;
      }

      OpenCV.clearBuffers();
    } catch (e) {
      if (!fpErrReported.value) { fpErrReported.value = true; onFpError(String(e)); }
      try { OpenCV.clearBuffers(); } catch (e2) {}
    }
  }, [dbReady, scanBlocked, frameTick, resize, fpReported, reportFp, fpErrReported, onFpError, onWarpedCard, lastCx, lastCy, stableCount]);

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

  const NOTIF_C = {
    success: { bg: 'rgba(16,185,129,0.96)',  fg: '#fff' },
    warn:    { bg: 'rgba(245,158,11,0.96)',   fg: '#0a0e1a' },
    error:   { bg: 'rgba(239,68,68,0.96)',    fg: '#fff' },
  } as const;

  return (
    <View style={S.container}>
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

      {/* ── Viewfinder ──────────────────────────────────────────────────── */}
      {!result && (
        <View pointerEvents="none" style={S.vfWrap}>
          <View style={[
            S.vfRect,
            { borderColor: loadError ? '#ef4444' : busy ? '#f59e0b' : dbLoaded ? 'rgba(255,255,255,0.65)' : 'rgba(255,255,255,0.2)' },
          ]}>
            {busy && <View style={S.scanLine} />}
          </View>
          <Text style={S.vfHint}>
            {loadError ? `⚠️ Load failed: ${loadError}`
              : !dbLoaded ? `⏳ ${loadStage}`
              : resolving ? '⚡ Saving…'
              : manualScanning ? '⚡ Reading card…'
              : '📷 Hold a card steady in the box — it scans automatically'}
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
            {liveDist != null ? `last match dist=${liveDist} (lower=better, ≤${AUTO_MAX_DIST} adds)` : 'hold a card steady in the box'}
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
              {scanNotif.engine === 'smart' ? '✨ AI Smart Scan  ·  ' : scanNotif.engine === 'local' ? '⚡ On-device  ·  ' : ''}{scanNotif.sub}
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
              : <Text style={S.forceTxt}>⚡ Force scan</Text>}
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
                  {result._engine === 'smart' ? '✨ AI Smart Scan' : '⚡ On-device match'}
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

  // Viewfinder
  vfWrap: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  vfRect: { width: 232, height: 324, borderWidth: 2, borderRadius: 12, overflow: 'hidden' },
  scanLine: {
    position: 'absolute', left: 0, right: 0, height: 2, top: '40%',
    backgroundColor: 'rgba(245,158,11,0.7)',
  },
  vfHint: {
    color: 'rgba(255,255,255,0.88)', marginTop: 18, fontSize: 13,
    textAlign: 'center', paddingHorizontal: 20,
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
