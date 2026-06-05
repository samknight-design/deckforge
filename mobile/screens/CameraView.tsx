// The real camera screen — only loaded outside Expo Go.
//
// Phase RN2c: tap-to-scan captures a photo, posts it to /api/scan (Claude
// Smart Scan) on Vercel, and shows the matched card in an in-screen result
// overlay. This is the slow-but-works path — every scan costs an AI call.
//
// Phase RN2d (next): replace tap-to-scan with continuous frame processor
// using iOS Vision / Android ML Kit, detect the card's 4 corners, warp,
// compute dHash, and match against the bundled 114k-printing hash DB. Claude
// becomes the fallback for cards the local matcher isn't confident on.

import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
} from 'react-native-vision-camera';
import { apiFetch } from '../lib/api';
import { addCardToDeck, type Deck } from '../lib/db';
import DeckPickerSheet from '../components/DeckPickerSheet';

type ScannedCard = {
  scryfall_id: string;
  card_name: string;
  image_uri?: string | null;
  type_line?: string;
  set_name?: string;
  set_code?: string;
  price_eur?: number | null;
};

export default function CameraView({
  userId,
  targetDeck,
  onBack,
}: {
  userId: string;
  targetDeck?: Deck | null;
  onBack: () => void;
}) {
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('back');
  const cameraRef = useRef<Camera>(null);
  const [requesting, setRequesting] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<ScannedCard | null>(null);
  const [isFoil, setIsFoil] = useState(false);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [addedTo, setAddedTo] = useState<string | null>(null);

  const reset = () => {
    setResult(null);
    setIsFoil(false);
    setAddedTo(null);
  };

  const doAdd = async (deck: Deck) => {
    if (!result) return;
    try {
      await addCardToDeck(deck.id, { scryfall_id: result.scryfall_id, card_name: result.card_name }, isFoil);
      setAddedTo(deck.name);
    } catch (e: unknown) {
      Alert.alert('Could not add', e instanceof Error ? e.message : String(e));
    } finally {
      setPickerVisible(false);
    }
  };

  // "Add to deck" tap: straight to the target deck if scanning into one,
  // else open the deck picker.
  const onAddPress = () => {
    if (targetDeck) doAdd(targetDeck);
    else setPickerVisible(true);
  };

  // Auto-prompt for camera permission on first mount.
  useEffect(() => {
    if (!hasPermission && !requesting) {
      setRequesting(true);
      requestPermission().finally(() => setRequesting(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onCapture = async () => {
    if (scanning || !cameraRef.current) return;
    setScanning(true);
    try {
      // 1. Grab a still from the live preview. takePhoto returns { path, ...
      //    width, height, etc. } where `path` is a file URI on local disk.
      const photo = await cameraRef.current.takePhoto({
        flash: 'off',
        enableShutterSound: false,
      });

      // 2. POST the photo as multipart/form-data to /api/scan. In RN, the
      //    FormData field for a file is { uri, type, name } (cast to any to
      //    sidestep web's File-only typing).
      const fileUri = photo.path.startsWith('file://') ? photo.path : `file://${photo.path}`;
      const formData = new FormData();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (formData as any).append('image', { uri: fileUri, type: 'image/jpeg', name: 'scan.jpg' });

      const res = await apiFetch('/api/scan', { method: 'POST', body: formData });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.card) {
        const msg = data?.error || `HTTP ${res.status}`;
        Alert.alert('Scan failed', String(msg).slice(0, 200));
        return;
      }
      setResult(data.card as ScannedCard);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      Alert.alert('Scan error', msg.slice(0, 200));
    } finally {
      setScanning(false);
    }
  };

  if (!hasPermission) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>📷 Camera access needed</Text>
        <Text style={styles.body}>
          DeckForge uses your phone&apos;s camera to scan cards. Photos are only
          sent to the server when you tap to scan.
        </Text>
        <Pressable
          style={styles.primary}
          onPress={async () => {
            setRequesting(true);
            await requestPermission();
            setRequesting(false);
          }}
          disabled={requesting}
        >
          <Text style={styles.primaryText}>{requesting ? 'Asking…' : 'Grant access'}</Text>
        </Pressable>
        <Pressable style={styles.secondary} onPress={onBack}>
          <Text style={styles.secondaryText}>← Back</Text>
        </Pressable>
      </View>
    );
  }

  if (!device) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#f59e0b" />
        <Text style={styles.body}>Looking for the back camera…</Text>
        <Pressable style={styles.secondary} onPress={onBack}>
          <Text style={styles.secondaryText}>← Back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Camera
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={!result}
        photo={true}
      />

      {/* Card-aspect viewfinder rectangle (63:88 = MTG card) */}
      {!result && (
        <View pointerEvents="none" style={styles.viewfinderWrap}>
          <View style={[styles.viewfinder, scanning && { borderColor: '#f59e0b' }]} />
          <Text style={styles.hint}>
            {scanning ? 'Identifying card…' : 'Line up the card inside the box · tap to scan'}
          </Text>
        </View>
      )}

      {/* Top bar */}
      {!result && (
        <View style={styles.topBar}>
          <Pressable style={styles.iconButton} onPress={onBack}>
            <Text style={styles.iconButtonText}>← Back</Text>
          </Pressable>
          <Text style={styles.topTitle}>Scan</Text>
          <View style={{ width: 60 }} />
        </View>
      )}

      {/* Capture button */}
      {!result && (
        <View style={styles.bottomBar}>
          <Pressable
            style={[styles.captureButton, scanning && { opacity: 0.6 }]}
            onPress={onCapture}
            disabled={scanning}
          >
            {scanning ? (
              <ActivityIndicator color="#0a0e1a" />
            ) : (
              <Text style={styles.captureText}>⚡ Tap to Scan</Text>
            )}
          </Pressable>
          <Text style={styles.bottomHint}>
            ✨ Smart Scan via Claude · on-device matching coming in RN2d
          </Text>
        </View>
      )}

      {/* Result overlay */}
      {result && (
        <View style={styles.resultBackdrop}>
          <View style={styles.resultSheet}>
            <Text style={styles.resultBadge}>✨ Smart Scan match</Text>
            <View style={{ flexDirection: 'row', gap: 14, alignItems: 'flex-start' }}>
              {result.image_uri ? (
                <Image source={{ uri: result.image_uri }} style={styles.resultImage} />
              ) : (
                <View style={[styles.resultImage, { alignItems: 'center', justifyContent: 'center' }]}>
                  <Text style={{ fontSize: 30 }}>🃏</Text>
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.resultName}>{result.card_name}</Text>
                {!!result.type_line && <Text style={styles.resultMeta}>{result.type_line}</Text>}
                {!!result.set_name && (
                  <Text style={styles.resultMeta}>
                    {result.set_name}
                    {result.set_code ? ` · ${result.set_code.toUpperCase()}` : ''}
                  </Text>
                )}
                {result.price_eur != null && (
                  <Text style={styles.resultPrice}>€{Number(result.price_eur).toFixed(2)}</Text>
                )}
              </View>
            </View>

            {addedTo ? (
              <>
                <Text style={styles.addedText}>✓ Added to {addedTo}</Text>
                <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
                  <Pressable style={[styles.secondary, { flex: 1 }]} onPress={onBack}>
                    <Text style={styles.secondaryText}>Done</Text>
                  </Pressable>
                  <Pressable style={[styles.primary, { flex: 2 }]} onPress={reset}>
                    <Text style={styles.primaryText}>📷 Scan another</Text>
                  </Pressable>
                </View>
              </>
            ) : (
              <>
                {/* Foil toggle */}
                <Pressable
                  style={[styles.foilToggle, isFoil && styles.foilToggleActive]}
                  onPress={() => setIsFoil((f) => !f)}
                >
                  <Text style={[styles.foilText, isFoil && { color: '#c4b5fd' }]}>✦ Foil</Text>
                  <View style={[styles.switch, isFoil && { backgroundColor: '#7c3aed' }]}>
                    <View style={[styles.knob, isFoil && { left: 20 }]} />
                  </View>
                </Pressable>

                <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
                  <Pressable style={[styles.secondary, { flex: 1 }]} onPress={reset}>
                    <Text style={styles.secondaryText}>Rescan</Text>
                  </Pressable>
                  <Pressable style={[styles.primary, { flex: 2 }]} onPress={onAddPress}>
                    <Text style={styles.primaryText}>
                      {targetDeck ? `+ Add to ${targetDeck.name}` : '+ Add to deck'}
                    </Text>
                  </Pressable>
                </View>
              </>
            )}
          </View>
        </View>
      )}

      <DeckPickerSheet
        userId={userId}
        visible={pickerVisible}
        onClose={() => setPickerVisible(false)}
        onPick={doAdd}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: {
    flex: 1,
    backgroundColor: '#0a0e1a',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  title: { color: '#f59e0b', fontSize: 20, fontWeight: '700', marginBottom: 12 },
  body: {
    color: '#cbd5e1',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 16,
    maxWidth: 320,
  },
  topBar: {
    position: 'absolute',
    top: 50,
    left: 16,
    right: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  topTitle: { color: '#fff', fontWeight: '700', fontSize: 16 },
  iconButton: {
    backgroundColor: 'rgba(17,24,39,0.7)',
    borderColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
  },
  iconButtonText: { color: '#f1f5f9', fontSize: 13 },
  viewfinderWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewfinder: {
    width: 232,
    height: 324,
    borderColor: 'rgba(255,255,255,0.4)',
    borderWidth: 2,
    borderRadius: 12,
  },
  hint: { color: 'rgba(255,255,255,0.8)', marginTop: 14, fontSize: 13 },
  bottomBar: {
    position: 'absolute',
    bottom: 40,
    left: 24,
    right: 24,
    alignItems: 'center',
  },
  captureButton: {
    backgroundColor: '#f59e0b',
    paddingHorizontal: 32,
    paddingVertical: 16,
    borderRadius: 32,
    marginBottom: 12,
    minWidth: 200,
    alignItems: 'center',
  },
  captureText: { color: '#0a0e1a', fontWeight: '700', fontSize: 14 },
  bottomHint: { color: 'rgba(255,255,255,0.5)', fontSize: 11, fontStyle: 'italic' },
  primary: {
    backgroundColor: '#f59e0b',
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 12,
    marginBottom: 12,
    alignItems: 'center',
  },
  primaryText: { color: '#0a0e1a', fontWeight: '700' },
  secondary: {
    backgroundColor: '#1a2235',
    borderColor: '#1e2d47',
    borderWidth: 1,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  secondaryText: { color: '#94a3b8', fontSize: 14, fontWeight: '500' },
  resultBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.78)',
    justifyContent: 'flex-end',
  },
  resultSheet: {
    backgroundColor: '#111827',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingBottom: 36,
    borderColor: '#1e2d47',
    borderWidth: 1,
  },
  resultBadge: {
    alignSelf: 'flex-start',
    color: '#fbbf24',
    backgroundColor: 'rgba(245,158,11,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.4)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    fontSize: 10,
    fontWeight: '700',
    marginBottom: 12,
    overflow: 'hidden',
  },
  resultImage: {
    width: 90,
    height: 126,
    borderRadius: 8,
    backgroundColor: '#1a2235',
  },
  resultName: { color: '#fff', fontWeight: '700', fontSize: 18, marginBottom: 4 },
  resultMeta: { color: '#94a3b8', fontSize: 12, marginBottom: 2 },
  resultPrice: { color: '#10b981', fontWeight: '700', marginTop: 6 },
  addedText: { color: '#10b981', fontWeight: '700', fontSize: 15, marginTop: 16 },
  foilToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1a2235',
    borderColor: '#1e2d47',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginTop: 16,
  },
  foilToggleActive: { borderColor: '#7c3aed', backgroundColor: 'rgba(124,58,237,0.12)' },
  foilText: { color: '#94a3b8', fontWeight: '500' },
  switch: { width: 40, height: 22, borderRadius: 11, backgroundColor: '#334155', justifyContent: 'center' },
  knob: { width: 18, height: 18, borderRadius: 9, backgroundColor: '#fff', position: 'absolute', left: 2 },
});
