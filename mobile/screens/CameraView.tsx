// The real camera screen. Only loaded by ScanScreen when we're confirmed not
// in Expo Go (i.e. running in a dev client or production build) — Expo Go
// would crash on the vision-camera import at the top of this file.
//
// Phase RN2a: live preview + a placeholder capture button. Phase RN2b adds
// the frame processor (per-frame card-rectangle detection via iOS Vision /
// Android ML Kit). Phase RN2c adds hash matching and the result sheet.

import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
} from 'react-native-vision-camera';

export default function CameraView({ onBack }: { onBack: () => void }) {
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('back');
  const [requesting, setRequesting] = useState(false);

  // Auto-prompt for camera permission on first mount. If denied, the user
  // can re-tap the "Grant access" button.
  useEffect(() => {
    if (!hasPermission && !requesting) {
      setRequesting(true);
      requestPermission().finally(() => setRequesting(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!hasPermission) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>📷 Camera access needed</Text>
        <Text style={styles.body}>
          DeckForge uses your phone&apos;s camera to scan cards on-device. We don&apos;t
          record or upload video.
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
      <Camera style={StyleSheet.absoluteFill} device={device} isActive={true} />

      {/* Card-aspect viewfinder rectangle (63:88 = MTG card) */}
      <View pointerEvents="none" style={styles.viewfinderWrap}>
        <View style={styles.viewfinder} />
        <Text style={styles.hint}>Line up the card inside the box</Text>
      </View>

      {/* Top bar */}
      <View style={styles.topBar}>
        <Pressable style={styles.iconButton} onPress={onBack}>
          <Text style={styles.iconButtonText}>← Back</Text>
        </Pressable>
        <Text style={styles.topTitle}>Scan</Text>
        <View style={{ width: 60 }} />
      </View>

      {/* Capture button (no-op for now — Phase RN2b wires it up to the
          frame processor + hash matcher) */}
      <View style={styles.bottomBar}>
        <Pressable style={styles.captureButton} onPress={() => {}}>
          <Text style={styles.captureText}>⚡ Tap to Scan</Text>
        </Pressable>
        <Text style={styles.bottomHint}>
          RN2a milestone — preview only. Hashing + auto-detect next.
        </Text>
      </View>
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
  title: {
    color: '#f59e0b',
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 12,
  },
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
    height: 324, // 232 × (88/63) ≈ 324 — MTG card aspect
    borderColor: 'rgba(255,255,255,0.4)',
    borderWidth: 2,
    borderRadius: 12,
  },
  hint: {
    color: 'rgba(255,255,255,0.7)',
    marginTop: 14,
    fontSize: 13,
  },
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
    shadowColor: '#f59e0b',
    shadowOpacity: 0.4,
    shadowRadius: 12,
  },
  captureText: { color: '#0a0e1a', fontWeight: '700', fontSize: 14 },
  bottomHint: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 11,
    fontStyle: 'italic',
  },
  primary: {
    backgroundColor: '#f59e0b',
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 12,
    marginBottom: 12,
  },
  primaryText: { color: '#0a0e1a', fontWeight: '700' },
  secondary: {
    backgroundColor: '#1a2235',
    borderColor: '#1e2d47',
    borderWidth: 1,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  secondaryText: { color: '#94a3b8', fontSize: 14, fontWeight: '500' },
});
