// Placeholder root component — replaced by expo-router in Phase RN1 when we
// add real navigation. For now: confirms the workspace boots and the shared
// package resolves from the monorepo root.

import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';
import { TIERS } from '@deckforge/shared/tiers';

export default function App() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>⚔️ DeckForge</Text>
      <Text style={styles.subtitle}>Mobile scaffolding online.</Text>
      <Text style={styles.meta}>
        Loaded {Object.keys(TIERS).length} tiers from @deckforge/shared.
      </Text>
      <StatusBar style="light" />
    </View>
  );
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
    fontSize: 32,
    fontWeight: '700',
    marginBottom: 8,
  },
  subtitle: {
    color: '#cbd5e1',
    fontSize: 16,
    marginBottom: 16,
  },
  meta: {
    color: '#64748b',
    fontSize: 12,
    fontFamily: 'monospace',
  },
});
