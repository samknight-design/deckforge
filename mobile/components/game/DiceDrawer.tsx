// Table tools: polyhedral dice, coin flip, and a random first-player picker.
// Self-contained; opened from the board menu.

import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import BottomSheet from './BottomSheet';

const DICE = [4, 6, 8, 10, 12, 20, 100];

type Result = { label: string; value: string };

export default function DiceDrawer({
  visible,
  seatNames,
  onClose,
}: {
  visible: boolean;
  seatNames: string[];
  onClose: () => void;
}) {
  const [result, setResult] = useState<Result | null>(null);

  const buzz = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});

  const rollDie = (sides: number) => { buzz(); setResult({ label: `d${sides}`, value: String(1 + Math.floor(Math.random() * sides)) }); };
  const flipCoin = () => { buzz(); setResult({ label: 'Coin', value: Math.random() < 0.5 ? 'Heads' : 'Tails' }); };
  const firstPlayer = () => { buzz(); setResult({ label: 'Goes first', value: seatNames[Math.floor(Math.random() * seatNames.length)] || '—' }); };

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <Text style={styles.title}>Dice & tools</Text>

      <View style={styles.result}>
          {result ? (
            <>
              <Text style={styles.resultLabel}>{result.label}</Text>
              <Text style={styles.resultValue} numberOfLines={1} adjustsFontSizeToFit>{result.value}</Text>
            </>
          ) : (
            <Text style={styles.resultHint}>Tap a die to roll</Text>
          )}
        </View>

        <View style={styles.grid}>
          {DICE.map((d) => (
            <Pressable key={d} style={styles.die} onPress={() => rollDie(d)}>
              <Text style={styles.dieText}>d{d}</Text>
            </Pressable>
          ))}
        </View>

      <View style={styles.toolRow}>
        <Pressable style={styles.tool} onPress={flipCoin}><Text style={styles.toolText}>🪙 Coin flip</Text></Pressable>
        <Pressable style={styles.tool} onPress={firstPlayer}><Text style={styles.toolText}>🎯 First player</Text></Pressable>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: { backgroundColor: '#111827', borderTopLeftRadius: 24, borderTopRightRadius: 24, borderColor: '#1e2d47', borderWidth: 1, padding: 20, paddingBottom: 30 },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#1e2d47', alignSelf: 'center', marginBottom: 14 },
  title: { color: '#fff', fontSize: 18, fontWeight: '700', marginBottom: 14 },
  result: { alignItems: 'center', justifyContent: 'center', height: 110, backgroundColor: '#05070d', borderRadius: 16, borderColor: '#1e2d47', borderWidth: 1, marginBottom: 16 },
  resultLabel: { color: '#64748b', fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1 },
  resultValue: { color: '#f59e0b', fontSize: 52, fontWeight: '900', paddingHorizontal: 16 },
  resultHint: { color: '#475569', fontSize: 15 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center' },
  die: { width: 64, height: 56, borderRadius: 14, backgroundColor: '#1a2235', borderColor: '#1e2d47', borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  dieText: { color: '#f1f5f9', fontSize: 17, fontWeight: '800' },
  toolRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  tool: { flex: 1, alignItems: 'center', paddingVertical: 14, borderRadius: 12, backgroundColor: '#1a2235', borderColor: '#1e2d47', borderWidth: 1 },
  toolText: { color: '#f1f5f9', fontWeight: '700', fontSize: 14 },
  close: { alignItems: 'center', marginTop: 14, paddingVertical: 8 },
  closeText: { color: '#94a3b8', fontWeight: '600', fontSize: 14 },
});
