// Real camera screen — only loaded outside Expo Go.
//
// Pipeline: takeSnapshot (low-res preview) → jpeg-js decode → Hough corner detect
// → perspective warp (68×88) → dHash → nearest-neighbour in 114k DB
//   confident? → /api/scan/resolve  (free, ~200 ms, no AI)
//   unsure?    → /api/scan Claude   (fallback, ~3 s, rate-limited for free users)
//
// KEY PERFORMANCE DECISION: Camera is forced to the lowest available resolution
// (~320×240). jpeg-js is pure JS — at 320×240 (76k px) decode takes ~400ms;
// at 1280×720 (921k px) it took 5–8s. The snapshot matches the preview format.
//
// Corner overlay: after capture, detected corners are animated onto the frozen
// frame so users can see the card was correctly edge-detected before the match.
//
// After a match, the card is upserted into the user's library (user_cards).
// Smart Scan (AI): free users get MAX_FREE_AI_SCANS per day; pro = unlimited.

import { useEffect, useRef, useState, useMemo } from 'react';
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
} from 'react-native-vision-camera';
import * as FileSystem from 'expo-file-system/legacy';
import { apiFetch } from '../lib/api';
import { addCardToDeck, addToLibrary, type Deck, type CardRef } from '../lib/db';
import { matchPhoto, prepareScanDb } from '../lib/scanLocal';
import { useTheme } from '../lib/theme';
import { tryCompleteChallenge } from '../lib/challenges';
import { useXpToast } from '../lib/xpToast';
import DeckPickerSheet from '../components/DeckPickerSheet';

const { width: SW, height: SH } = Dimensions.get('window');

type ScanPhase = 'idle' | 'capturing' | 'detecting' | 'matching' | 'uploading';

type ScannedCard = {
  scryfall_id: string;
  card_name: string;
  image_uri?: string | null;
  type_line?: string;
  set_name?: string;
  set_code?: string;
  price_eur?: number | null;
  _engine: 'local' | 'smart';
  _detected: boolean;
};

type FrozenFrame = {
  uri: string;
  photoW: number;
  photoH: number;
  corners: Array<{ x: number; y: number }> | null;
};

const VF_W = 232;
const VF_H = 324;
const CORNER_ARM = 28;
const THICK = 3;

function cornerToScreen(
  c: { x: number; y: number },
  pW: number,
  pH: number,
): { x: number; y: number } {
  const scale = Math.max(SW / pW, SH / pH);
  const ox = (pW * scale - SW) / 2;
  const oy = (pH * scale - SH) / 2;
  return { x: c.x * scale - ox, y: c.y * scale - oy };
}

function CornerBracket({ pos, color }: { pos: 'tl' | 'tr' | 'bl' | 'br'; color: string }) {
  const base = { position: 'absolute' as const, width: CORNER_ARM, height: CORNER_ARM, borderColor: color };
  if (pos === 'tl') return <View style={[base, { top: 0, left: 0, borderTopWidth: THICK, borderLeftWidth: THICK, borderTopLeftRadius: 4 }]} />;
  if (pos === 'tr') return <View style={[base, { top: 0, right: 0, borderTopWidth: THICK, borderRightWidth: THICK, borderTopRightRadius: 4 }]} />;
  if (pos === 'bl') return <View style={[base, { bottom: 0, left: 0, borderBottomWidth: THICK, borderLeftWidth: THICK, borderBottomLeftRadius: 4 }]} />;
  return <View style={[base, { bottom: 0, right: 0, borderBottomWidth: THICK, borderRightWidth: THICK, borderBottomRightRadius: 4 }]} />;
}

function phaseLabel(p: ScanPhase) {
  if (p === 'capturing') return 'Capturing…';
  if (p === 'detecting') return 'Detecting edges…';
  if (p === 'matching') return 'Matching on-device…';
  if (p === 'uploading') return 'Smart Scan…';
  return '';
}

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

  // Force lowest available resolution to minimise jpeg-js decode time.
  // takeSnapshot() captures at the preview format's videoResolution.
  // Typical phones: 320×240 or 640×480 → 12–50× fewer pixels than default 720p.
  const format = useCameraFormat(device, [
    { videoResolution: { width: 320, height: 240 } },
  ]);
  const cameraRef = useRef<Camera>(null);
  const mounted = useRef(true);

  // Free-tier AI scan limit (session + daily cap enforced on API too)
  const MAX_FREE_AI_SCANS = 10;

  const [requesting, setRequesting] = useState(false);
  const [phase, setPhase] = useState<ScanPhase>('idle');
  const [frozen, setFrozen] = useState<FrozenFrame | null>(null);
  const [result, setResult] = useState<ScannedCard | null>(null);
  const [isFoil, setIsFoil] = useState(false);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [deckPickerVisible, setDeckPickerVisible] = useState(false);
  const [addedTo, setAddedTo] = useState<string | null>(null);
  const [dbReady, setDbReady] = useState(false);
  const [autoCapture, setAutoCapture] = useState(false);
  const [currentDeck, setCurrentDeck] = useState<Deck | undefined>(targetDeck);
  // Track AI (Smart Scan) usage this session. Reset when component unmounts.
  const [aiScansUsed, setAiScansUsed] = useState(0);
  const autoCaptureRef = useRef(false);
  const autoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Animated value for corner dot spring-in
  const cornerAnim = useRef(new Animated.Value(0)).current;
  // Animated value for result sheet slide-up
  const sheetAnim = useRef(new Animated.Value(400)).current;

  useEffect(() => {
    mounted.current = true;
    prepareScanDb().then(() => { if (mounted.current) setDbReady(true); }).catch(() => {});
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (!hasPermission && !requesting) {
      setRequesting(true);
      requestPermission().finally(() => { if (mounted.current) setRequesting(false); });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-capture loop: fires every 2.5 s when autoCapture is on and scanner is idle
  useEffect(() => {
    autoCaptureRef.current = autoCapture;
    if (!autoCapture) {
      if (autoTimerRef.current) { clearTimeout(autoTimerRef.current); autoTimerRef.current = null; }
      return;
    }
    const schedule = () => {
      autoTimerRef.current = setTimeout(() => {
        if (!autoCaptureRef.current || !mounted.current) return;
        // onCapture is defined below via ref so we can call it here
        captureRef.current?.();
        schedule();
      }, 2500);
    };
    schedule();
    return () => { if (autoTimerRef.current) clearTimeout(autoTimerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoCapture]);

  // Animate result sheet when result arrives
  useEffect(() => {
    if (result) {
      Animated.spring(sheetAnim, {
        toValue: 0, useNativeDriver: true, friction: 8, tension: 120,
      }).start();
    } else {
      sheetAnim.setValue(400);
    }
  }, [result, sheetAnim]);

  const reset = () => {
    setResult(null);
    setFrozen(null);
    setIsFoil(false);
    setAddedTo(null);
    cornerAnim.setValue(0);
    setPhase('idle');
  };

  const doAdd = async (deck: Deck) => {
    if (!result) return;
    try {
      await addCardToDeck(deck.id, { scryfall_id: result.scryfall_id, card_name: result.card_name }, isFoil);
      if (mounted.current) setAddedTo(deck.name);
    } catch (e: unknown) {
      Alert.alert('Could not add', e instanceof Error ? e.message : String(e));
    } finally {
      if (mounted.current) setPickerVisible(false);
    }
  };

  const onAddPress = () => {
    if (currentDeck) doAdd(currentDeck);
    else setPickerVisible(true);
  };

  const onCapture = async () => {
    if (phase !== 'idle' || !cameraRef.current) return;
    const set = (p: ScanPhase) => { if (mounted.current) setPhase(p); };
    set('capturing');

    try {
      // Snapshot from preview stream — naturally ~720p, no native resize module needed.
      const photo = await cameraRef.current.takeSnapshot({ quality: 90 });
      const fileUri = photo.path.startsWith('file://') ? photo.path : `file://${photo.path}`;
      const photoW = photo.width;
      const photoH = photo.height;

      // Freeze the frame immediately — the frozen snapshot shows while we process.
      if (mounted.current) setFrozen({ uri: fileUri, photoW, photoH, corners: null });

      set('detecting');

      const base64 = await FileSystem.readAsStringAsync(fileUri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      // Full pipeline: RGBA → Hough corner detect → perspective warp → dHash → nearest-neighbour
      const localMatch = dbReady ? await matchPhoto(base64) : null;

      // Animate detected corners onto the frozen frame
      if (localMatch?.corners && mounted.current) {
        setFrozen((prev) => prev ? { ...prev, corners: localMatch.corners } : null);
        Animated.spring(cornerAnim, {
          toValue: 1, useNativeDriver: true, friction: 5, tension: 200,
        }).start();
      }

      const card: CardRef = { scryfall_id: '', card_name: '' };

      if (localMatch?.confident) {
        set('matching');
        const res = await apiFetch('/api/scan/resolve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scryfall_id: localMatch.scryfallId }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data?.card) {
          card.scryfall_id = data.card.scryfall_id;
          card.card_name = data.card.card_name;
          await addToLibrary(userId, card, isFoil).catch(() => {});
          tryCompleteChallenge(userId, 'scan_cards').then((r) => {
            if (r.justCompleted) showXp(r.xpEarned, 'Card Scanner complete!');
          });
          if (mounted.current) {
            setResult({ ...data.card, _engine: 'local', _detected: localMatch.detected });
          }
          return;
        }
      }

      // Rate-limit Smart Scan for free users — checked here (also enforced server-side)
      if (aiScansUsed >= MAX_FREE_AI_SCANS) {
        Alert.alert(
          'Daily Smart Scan limit reached',
          `You've used ${MAX_FREE_AI_SCANS} AI-assisted scans today. Local matching couldn't identify this card. Try better lighting or a clearer angle, or upgrade to Pro for unlimited Smart Scans.`,
        );
        if (mounted.current) setFrozen(null);
        return;
      }

      set('uploading');
      if (mounted.current) setAiScansUsed((n) => n + 1);
      const formData = new FormData();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (formData as any).append('image', { uri: fileUri, type: 'image/jpeg', name: 'scan.jpg' });
      const res = await apiFetch('/api/scan', { method: 'POST', body: formData });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.card) {
        Alert.alert('Scan failed', String(data?.error || `HTTP ${res.status}`).slice(0, 200));
        if (mounted.current) setFrozen(null);
        return;
      }
      card.scryfall_id = data.card.scryfall_id;
      card.card_name = data.card.card_name;
      await addToLibrary(userId, card, isFoil).catch(() => {});
      tryCompleteChallenge(userId, 'scan_cards').then((r) => {
        if (r.justCompleted) showXp(r.xpEarned, 'Card Scanner complete!');
      });
      if (mounted.current) {
        setResult({ ...data.card, _engine: 'smart', _detected: localMatch?.detected ?? false });
      }
    } catch (e: unknown) {
      Alert.alert('Scan error', (e instanceof Error ? e.message : String(e)).slice(0, 200));
      if (mounted.current) setFrozen(null);
    } finally {
      if (mounted.current) setPhase('idle');
    }
  };

  // Stable ref so the auto-capture timer can call the latest onCapture
  const captureRef = useRef<(() => void) | null>(null);
  captureRef.current = phase === 'idle' && !result ? onCapture : null;

  const scanning = phase !== 'idle';

  // ── Permission / device guards ──────────────────────────────────────────────

  if (!hasPermission) {
    return (
      <View style={[S.center, { backgroundColor: colors.bg }]}>
        <Text style={[S.title, { color: colors.accent }]}>📷 Camera needed</Text>
        <Text style={[S.body, { color: colors.textMuted }]}>
          DeckForge scans cards on-device — photos upload only when local matching isn&apos;t confident.
        </Text>
        <Pressable style={[S.primary, { backgroundColor: colors.accent }]}
          onPress={async () => { setRequesting(true); await requestPermission(); if (mounted.current) setRequesting(false); }}
          disabled={requesting}>
          <Text style={[S.primaryText, { color: colors.accentText }]}>{requesting ? 'Asking…' : 'Grant access'}</Text>
        </Pressable>
        <Pressable style={[S.secondary, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]} onPress={onBack}>
          <Text style={[S.secondaryText, { color: colors.textMuted }]}>← Back</Text>
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

  // ── Main scanner UI ─────────────────────────────────────────────────────────
  return (
    <View style={S.container}>
      {/* Live camera — low-res format to minimise jpeg-js decode time */}
      <Camera
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        device={device}
        format={format}
        isActive={!result && !frozen}
        photo={true}
        video={true}
      />

      {/* Frozen snapshot shown while processing */}
      {frozen && (
        <Image source={{ uri: frozen.uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      )}

      {/* Detected corner dots — spring in after Hough finds them */}
      {frozen?.corners && frozen.corners.map((c, i) => {
        const sc = cornerToScreen(c, frozen.photoW, frozen.photoH);
        return (
          <Animated.View
            key={i}
            style={{
              position: 'absolute',
              left: sc.x - 8,
              top: sc.y - 8,
              width: 16,
              height: 16,
              borderRadius: 8,
              backgroundColor: '#f59e0b',
              borderWidth: 2,
              borderColor: '#fff',
              transform: [{ scale: cornerAnim }],
              opacity: cornerAnim,
            }}
          />
        );
      })}

      {/* Phase text overlay on frozen frame */}
      {frozen && !result && (
        <View style={S.phaseOverlay}>
          <ActivityIndicator color="#f59e0b" size="small" />
          <Text style={S.phaseText}>{phaseLabel(phase)}</Text>
        </View>
      )}

      {/* Viewfinder (only when live) */}
      {!frozen && !result && (
        <View pointerEvents="none" style={S.vfWrap}>
          <View style={{ width: VF_W, height: VF_H }}>
            {(['tl', 'tr', 'bl', 'br'] as const).map((pos) => (
              <CornerBracket key={pos} pos={pos} color={scanning ? '#f59e0b' : 'rgba(255,255,255,0.75)'} />
            ))}
          </View>
          <Text style={S.hint}>
            {scanning ? phaseLabel(phase) : 'Line up the card · tap to scan'}
          </Text>
          {!dbReady && !scanning && <Text style={S.dbHint}>Preparing local scanner…</Text>}
        </View>
      )}

      {/* Top bar */}
      {!result && (
        <View style={S.topBar}>
          <Pressable style={S.iconBtn} onPress={onBack}>
            <Text style={S.iconBtnText}>← Back</Text>
          </Pressable>
          <Pressable
            style={S.deckBadge}
            onPress={() => setDeckPickerVisible(true)}
          >
            <Text style={S.deckBadgeText} numberOfLines={1}>
              {currentDeck ? `🗂 ${currentDeck.name}` : '🗂 Library only'}
            </Text>
          </Pressable>
          <View style={S.enginePill}>
            <View style={[S.engineDot, dbReady && S.engineDotReady]} />
            <Text style={S.enginePillText}>{dbReady ? 'Local' : 'Cloud'}</Text>
          </View>
        </View>
      )}

      {/* Capture button + auto toggle (only when live + idle) */}
      {!frozen && !result && (
        <View style={S.bottomBar}>
          <View style={{ flexDirection: 'row', gap: 10, marginBottom: 8 }}>
            <Pressable
              style={[S.captureBtn, { flex: 1 }, scanning && S.captureBtnDim]}
              onPress={onCapture}
              disabled={scanning || autoCapture}
            >
              {scanning ? <ActivityIndicator color="#0a0e1a" /> : <Text style={S.captureTxt}>⚡ Scan</Text>}
            </Pressable>
            <Pressable
              style={[S.autoBtn, autoCapture && S.autoBtnOn]}
              onPress={() => setAutoCapture((a) => !a)}
            >
              <Text style={[S.autoBtnText, autoCapture && { color: '#0a0e1a' }]}>
                {autoCapture ? '⏸ Auto' : '▶ Auto'}
              </Text>
            </Pressable>
          </View>
          <Text style={S.bottomHint}>
            {autoCapture
              ? '🔄 Auto-scanning every 2.5s — point at a card'
              : dbReady
                ? `⚡ On-device · ${MAX_FREE_AI_SCANS - aiScansUsed} AI scans left today`
                : '✨ Smart Scan · local DB loading…'}
          </Text>
        </View>
      )}

      {/* Result sheet — slides up over frozen frame */}
      {result && (
        <View style={S.resultBackdrop}>
          <Animated.View style={[S.resultSheet, { transform: [{ translateY: sheetAnim }] }]}>
            <View style={S.badgeRow}>
              <Text style={[S.badge, result._engine === 'local' ? S.badgeLocal : S.badgeSmart]}>
                {result._engine === 'local' ? '⚡ Local match' : '✨ Smart Scan'}
              </Text>
              <Text style={S.detectedLabel}>
                {result._detected ? '◈ edges detected' : '⊡ center crop'}
              </Text>
              <Text style={S.libraryLabel}>📚 saved to library</Text>
            </View>

            <View style={{ flexDirection: 'row', gap: 14, alignItems: 'flex-start' }}>
              {result.image_uri ? (
                <Image source={{ uri: result.image_uri }} style={S.resultImg} />
              ) : (
                <View style={[S.resultImg, S.resultImgPlaceholder]}><Text style={{ fontSize: 28 }}>🃏</Text></View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={S.resultName}>{result.card_name}</Text>
                {!!result.type_line && <Text style={S.resultMeta}>{result.type_line}</Text>}
                {!!result.set_name && (
                  <Text style={S.resultMeta}>
                    {result.set_name}{result.set_code ? ` · ${result.set_code.toUpperCase()}` : ''}
                  </Text>
                )}
                {result.price_eur != null && (
                  <Text style={S.resultPrice}>{formatPrice(result.price_eur)}</Text>
                )}
              </View>
            </View>

            {addedTo ? (
              <>
                <Text style={S.addedText}>✓ Added to {addedTo}</Text>
                <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
                  <Pressable style={[S.secondary, { flex: 1 }]} onPress={onBack}>
                    <Text style={S.secondaryText}>Done</Text>
                  </Pressable>
                  <Pressable style={[S.primary, { flex: 2 }]} onPress={reset}>
                    <Text style={S.primaryText}>📷 Scan another</Text>
                  </Pressable>
                </View>
              </>
            ) : (
              <>
                <Pressable
                  style={[S.foilToggle, isFoil && S.foilActive]}
                  onPress={() => setIsFoil((f) => !f)}
                >
                  <Text style={[S.foilText, isFoil && { color: '#c4b5fd' }]}>✦ Foil</Text>
                  <View style={[S.switchTrack, isFoil && { backgroundColor: '#7c3aed' }]}>
                    <View style={[S.switchKnob, isFoil && { left: 20 }]} />
                  </View>
                </Pressable>
                <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
                  <Pressable style={[S.secondary, { flex: 1 }]} onPress={reset}>
                    <Text style={S.secondaryText}>Rescan</Text>
                  </Pressable>
                  <Pressable style={[S.primary, { flex: 2 }]} onPress={onAddPress}>
                    <Text style={S.primaryText}>
                      {currentDeck ? `+ Add to ${currentDeck.name}` : '+ Add to deck'}
                    </Text>
                  </Pressable>
                </View>
              </>
            )}
          </Animated.View>
        </View>
      )}

      {/* Picker for adding a card to a deck (after scan) */}
      <DeckPickerSheet
        userId={userId}
        visible={pickerVisible}
        onClose={() => setPickerVisible(false)}
        onPick={doAdd}
      />

      {/* Picker for selecting the active destination deck mid-session */}
      <DeckPickerSheet
        userId={userId}
        visible={deckPickerVisible}
        onClose={() => setDeckPickerVisible(false)}
        onPick={(deck) => {
          setCurrentDeck(deck);
          setDeckPickerVisible(false);
        }}
      />
    </View>
  );
}

const S = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { fontSize: 20, fontWeight: '700', marginBottom: 12 },
  body: { fontSize: 14, lineHeight: 20, textAlign: 'center', marginBottom: 16, maxWidth: 320 },
  topBar: {
    position: 'absolute', top: 50, left: 16, right: 16,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  topTitle: { color: '#fff', fontWeight: '700', fontSize: 16 },
  iconBtn: {
    backgroundColor: 'rgba(17,24,39,0.7)', borderColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20,
  },
  iconBtnText: { color: '#f1f5f9', fontSize: 13 },
  enginePill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(17,24,39,0.7)', borderColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20,
  },
  engineDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#f59e0b' },
  engineDotReady: { backgroundColor: '#10b981' },
  enginePillText: { color: '#f1f5f9', fontSize: 11, fontWeight: '600' },
  deckBadge: {
    flex: 1, marginHorizontal: 8,
    backgroundColor: 'rgba(17,24,39,0.7)', borderColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20,
    alignItems: 'center',
  },
  deckBadgeText: { color: '#f1f5f9', fontSize: 11, fontWeight: '600' },
  autoBtn: {
    paddingHorizontal: 16, paddingVertical: 14,
    backgroundColor: 'rgba(17,24,39,0.85)', borderColor: 'rgba(255,255,255,0.15)', borderWidth: 1, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  autoBtnOn: { backgroundColor: '#f59e0b', borderColor: '#f59e0b' },
  autoBtnText: { color: '#f1f5f9', fontWeight: '700', fontSize: 13 },
  vfWrap: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  hint: { color: 'rgba(255,255,255,0.85)', marginTop: 18, fontSize: 13, textAlign: 'center' },
  dbHint: { color: 'rgba(245,158,11,0.7)', marginTop: 6, fontSize: 11, fontStyle: 'italic' },
  phaseOverlay: {
    position: 'absolute', bottom: 140, left: 0, right: 0,
    alignItems: 'center', gap: 10, flexDirection: 'row', justifyContent: 'center',
  },
  phaseText: { color: '#f59e0b', fontSize: 14, fontWeight: '600' },
  bottomBar: { position: 'absolute', bottom: 40, left: 24, right: 24, alignItems: 'center' },
  captureBtn: {
    backgroundColor: '#f59e0b', paddingHorizontal: 32, paddingVertical: 16,
    borderRadius: 32, marginBottom: 12, minWidth: 200, alignItems: 'center',
  },
  captureBtnDim: { opacity: 0.6 },
  captureTxt: { color: '#0a0e1a', fontWeight: '700', fontSize: 14 },
  bottomHint: { color: 'rgba(255,255,255,0.5)', fontSize: 11, fontStyle: 'italic', textAlign: 'center' },
  primary: { backgroundColor: '#f59e0b', paddingHorizontal: 24, paddingVertical: 14, borderRadius: 12, marginBottom: 12, alignItems: 'center' },
  primaryText: { color: '#0a0e1a', fontWeight: '700' },
  secondary: { backgroundColor: '#1a2235', borderColor: '#1e2d47', borderWidth: 1, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12, alignItems: 'center' },
  secondaryText: { color: '#94a3b8', fontSize: 14, fontWeight: '500' },
  resultBackdrop: { ...StyleSheet.absoluteFillObject, justifyContent: 'flex-end' },
  resultSheet: {
    backgroundColor: '#111827', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 20, paddingBottom: 40, borderColor: '#1e2d47', borderWidth: 1,
  },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12, flexWrap: 'wrap' },
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, fontSize: 10, fontWeight: '700', overflow: 'hidden', borderWidth: 1 },
  badgeLocal: { color: '#10b981', backgroundColor: 'rgba(16,185,129,0.12)', borderColor: 'rgba(16,185,129,0.4)' },
  badgeSmart: { color: '#fbbf24', backgroundColor: 'rgba(245,158,11,0.15)', borderColor: 'rgba(245,158,11,0.4)' },
  detectedLabel: { color: '#475569', fontSize: 10, fontWeight: '500' },
  libraryLabel: { color: '#3b82f6', fontSize: 10, fontWeight: '500' },
  resultImg: { width: 90, height: 126, borderRadius: 8, backgroundColor: '#1a2235' },
  resultImgPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  resultName: { color: '#fff', fontWeight: '700', fontSize: 18, marginBottom: 4 },
  resultMeta: { color: '#94a3b8', fontSize: 12, marginBottom: 2 },
  resultPrice: { color: '#10b981', fontWeight: '700', marginTop: 6 },
  addedText: { color: '#10b981', fontWeight: '700', fontSize: 15, marginTop: 16 },
  foilToggle: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#1a2235', borderColor: '#1e2d47', borderWidth: 1,
    borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12, marginTop: 16,
  },
  foilActive: { borderColor: '#7c3aed', backgroundColor: 'rgba(124,58,237,0.12)' },
  foilText: { color: '#94a3b8', fontWeight: '500' },
  switchTrack: { width: 40, height: 22, borderRadius: 11, backgroundColor: '#334155', justifyContent: 'center' },
  switchKnob: { width: 18, height: 18, borderRadius: 9, backgroundColor: '#fff', position: 'absolute', left: 2 },
});
