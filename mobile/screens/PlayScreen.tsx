// Play tab landing — resume an in-progress game, host a new one, or join.
// Joining needs the multiplayer (Realtime + QR scan) slice, so it's a friendly
// placeholder for now.

import { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../lib/theme';
import { FORMATS } from '../lib/game/formats';
import { loadGame, type SavedGame } from '../lib/game/persist';

export default function PlayScreen({
  onHost,
  onResume,
}: {
  onHost: () => void;
  onResume: (saved: SavedGame) => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [saved] = useState<SavedGame | null>(() => loadGame());

  const joinSoon = () =>
    Alert.alert('Joining games — coming soon', 'Hosting works now. Scanning a QR code to join from another phone arrives in the next update.');

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>Play MTG</Text>
      <Text style={styles.sub}>Track life and stats for a real game at the table.</Text>

      {saved && (
        <Pressable style={[styles.card, styles.cardResume]} onPress={() => onResume(saved)}>
          <Text style={styles.cardIcon}>↻</Text>
          <Text style={styles.cardTitle}>Resume game</Text>
          <Text style={styles.cardBody}>
            {FORMATS[saved.config.format].label} · {saved.config.playerCount} players — pick up where you left off.
          </Text>
        </Pressable>
      )}

      <Pressable style={[styles.card, styles.cardHost]} onPress={onHost}>
        <Text style={styles.cardIcon}>🎲</Text>
        <Text style={styles.cardTitle}>Host a game</Text>
        <Text style={styles.cardBody}>Set up a game on this phone — everyone can play from here.</Text>
      </Pressable>

      <Pressable style={styles.card} onPress={joinSoon}>
        <View style={styles.soonRow}>
          <Text style={styles.cardIcon}>📲</Text>
          <View style={styles.soonPill}><Text style={styles.soonPillText}>SOON</Text></View>
        </View>
        <Text style={styles.cardTitle}>Join a game</Text>
        <Text style={styles.cardBody}>Scan a QR or enter a code to join from your own phone.</Text>
      </Pressable>
    </ScrollView>
  );
}

const createStyles = (c: ReturnType<typeof import('../lib/theme').useTheme>['colors']) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },
    content: { padding: 20, paddingTop: 64 },
    heading: { color: c.text, fontSize: 28, fontWeight: '800' },
    sub: { color: c.textMuted, fontSize: 14, marginTop: 4, marginBottom: 24 },
    card: { backgroundColor: c.surface, borderColor: c.border, borderWidth: 1, borderRadius: 20, padding: 20, marginBottom: 14 },
    cardHost: { borderColor: c.accent, backgroundColor: 'rgba(245,158,11,0.06)' },
    cardResume: { borderColor: c.success, backgroundColor: 'rgba(16,185,129,0.07)' },
    cardIcon: { fontSize: 30, marginBottom: 10 },
    cardTitle: { color: c.text, fontSize: 18, fontWeight: '700', marginBottom: 4 },
    cardBody: { color: c.textMuted, fontSize: 13, lineHeight: 19 },
    soonRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
    soonPill: { backgroundColor: c.surfaceAlt, borderColor: c.border, borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
    soonPillText: { color: c.textMuted, fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  });
