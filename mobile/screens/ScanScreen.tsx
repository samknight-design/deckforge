// Entry point for the camera/scanner experience.
//
// react-native-vision-camera is a NATIVE module — Expo Go can't load it.
// Stock Expo Go users see a friendly "needs dev client" message instead of
// a crash. The real camera view lives in CameraView.tsx and is only
// require()'d when we know we're running in a custom dev client / standalone
// build (so its top-level vision-camera import doesn't blow up Expo Go).

import { Pressable, StyleSheet, Text, View } from 'react-native';
import Constants from 'expo-constants';
import type { Deck } from '../lib/db';

const isExpoGo = Constants.appOwnership === 'expo';

export default function ScanScreen({
  userId,
  targetDeck,
  onBack,
}: {
  userId: string;
  targetDeck?: Deck | null;
  onBack: () => void;
}) {
  if (isExpoGo) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>📷 Scanner needs the Dev Client</Text>
        <Text style={styles.body}>
          The native camera library (react-native-vision-camera) can&apos;t run inside
          stock Expo Go — it includes Swift / Kotlin code that the App Store
          version of Expo Go doesn&apos;t bundle.
          {'\n\n'}
          Next push: I&apos;ll walk you through a one-time EAS build that produces
          a custom &quot;DeckForge Dev Client&quot; app for your phone. You&apos;ll install
          it once, then `expo start` connects to it instead of Expo Go and the
          camera screen will work for real.
        </Text>
        <Pressable style={styles.button} onPress={onBack}>
          <Text style={styles.buttonText}>← Back</Text>
        </Pressable>
      </View>
    );
  }

  // In a dev client or standalone build — load the real camera screen.
  // The require()s happen INSIDE CameraHost (a child of ErrorBoundary) so that
  // even a module-eval / asset-resolution crash is caught and shown on screen
  // rather than white-screening the app. vision-camera is only require()'d here,
  // never in Expo Go (guarded above).
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const ErrorBoundary = require('../components/ErrorBoundary').default;
  return (
    <ErrorBoundary onBack={onBack}>
      <CameraHost userId={userId} targetDeck={targetDeck} onBack={onBack} />
    </ErrorBoundary>
  );
}

function CameraHost({
  userId,
  targetDeck,
  onBack,
}: {
  userId: string;
  targetDeck?: Deck | null;
  onBack: () => void;
}) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const CameraView = require('./CameraView').default;
  return <CameraView userId={userId} targetDeck={targetDeck} onBack={onBack} />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0e1a',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  title: {
    color: '#f59e0b',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 16,
    textAlign: 'center',
  },
  body: {
    color: '#cbd5e1',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 24,
    maxWidth: 360,
  },
  button: {
    backgroundColor: '#1a2235',
    borderColor: '#1e2d47',
    borderWidth: 1,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  buttonText: { color: '#94a3b8', fontSize: 14, fontWeight: '500' },
});
