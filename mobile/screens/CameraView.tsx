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
import * as FileSystem from 'expo-file-system/legacy';
import { apiFetch } from '../lib/api';
import { addCardToDeck, addToLibrary, type Deck } from '../lib/db';
import { prepareScanDb, idAt } from '../lib/scanLocal';
import { useTheme } from '../lib/theme';
import { tryCompleteChallenge } from '../lib/challenges';
import { useXpToast } from '../lib/xpToast';
import DeckPickerSheet from '../components/DeckPickerSheet';

// ── Constants ─────────────────────────────────────────────────────────────────

const FP_MAX_DIST          = 75;
const FP_MIN_GAP           = 7;
const STABLE_FRAMES_NEEDED = 5;
const SCAN_COOLDOWN_MS     = 2500;
const MAX_FREE_AI_SCANS    = 10;

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
  const [popcountTable]       = useState<number[]>(() => {
    const t = new Array(256); t[0] = 0;
    for (let i = 1; i < 256; i++) t[i] = (i & 1) + t[i >> 1];
    return t;
  });

  // ── Shared values ──────────────────────────────────────────────────────────

  const consecutiveCount = useSharedValue(0);
  const lastMatchIndex   = useSharedValue(-1);
  const scanBlocked      = useSharedValue(false);

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
    prepareScanDb().then(({ db, ids }) => {
      if (!mounted.current) return;
      setDbFlat(db.flat);
      setDbCount(db.count);
      setDbIds(ids);
    }).catch(e => console.warn('[scan] DB load failed:', e));
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
      const photo = await cameraRef.current.takeSnapshot({ quality: 30 });
      const fileUri = photo.path.startsWith('file://') ? photo.path : `file://${photo.path}`;
      const { matchPhoto } = await import('../lib/scanLocal');
      const base64 = await FileSystem.readAsStringAsync(fileUri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      const match = await matchPhoto(base64);
      if (match?.confident) {
        await handleLocalMatch(match.index);
        return;
      }

      // Not confident — try Smart Scan
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
    if (dbFlat == null || scanBlocked.value) return;
    const { width, height, bytesPerRow, pixelFormat } = frame;
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(frame.toArrayBuffer());
    } catch {
      // Requires minSdkVersion 26 — EAS rebuild needed.
      return;
    }
    const hash = dhashFromBytes(bytes, width, height, bytesPerRow, pixelFormat === 'yuv', 16);
    const m = matchHashWorklet(hash, dbFlat, dbCount, 32, popcountTable);
    const confident = m.distance <= FP_MAX_DIST && (m.runnerUp - m.distance) >= FP_MIN_GAP && m.index >= 0;
    if (confident && m.index === lastMatchIndex.value) {
      consecutiveCount.value++;
      if (consecutiveCount.value >= STABLE_FRAMES_NEEDED) {
        scanBlocked.value = true;
        consecutiveCount.value = 0;
        lastMatchIndex.value = -1;
        handleLocalMatch(m.index);
      }
    } else {
      lastMatchIndex.value = confident ? m.index : -1;
      consecutiveCount.value = confident ? 1 : 0;
    }
  }, [dbFlat, dbCount, popcountTable, handleLocalMatch, scanBlocked, consecutiveCount, lastMatchIndex]);

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
        photo
        frameProcessor={dbLoaded && !result ? frameProcessor : undefined}
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
            { borderColor: busy ? '#f59e0b' : dbLoaded ? 'rgba(255,255,255,0.65)' : 'rgba(255,255,255,0.2)' },
          ]}>
            {busy && <View style={S.scanLine} />}
          </View>
          <Text style={S.vfHint}>
            {!dbLoaded ? '⏳ Loading scanner…'
              : resolving ? '⚡ Matched — saving…'
              : manualScanning ? '⚡ Scanning…'
              : quickMode ? '📷 Point at a card — auto-scans'
              : '📷 Point at a card — will pause for review'}
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
