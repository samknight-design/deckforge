// End-of-game results: finishing order from elimination placement (1 = winner).
// Stat write-back to Supabase is a later slice; this is display + rematch/exit.

import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { seatColor, type Seat } from '../../lib/game/formats';

const MEDAL = ['🥇', '🥈', '🥉'];

export default function ResultsOverlay({
  visible,
  seats,
  hostDeckName,
  onRematch,
  onDone,
}: {
  visible: boolean;
  seats: Seat[];
  hostDeckName?: string | null;
  onRematch: () => void;
  onDone: () => void;
}) {
  const ranked = [...seats].sort((a, b) => (a.placement ?? 99) - (b.placement ?? 99));

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDone}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.kicker}>GAME OVER</Text>
          <Text style={styles.title}>Results</Text>

          <ScrollView style={{ maxHeight: 360 }} contentContainerStyle={{ gap: 8 }}>
            {ranked.map((s, i) => {
              const place = s.placement ?? i + 1;
              const tint = seatColor(s);
              return (
                <View key={s.id} style={[styles.row, place === 1 && styles.rowWin]}>
                  <Text style={styles.place}>{place <= 3 ? MEDAL[place - 1] : `#${place}`}</Text>
                  <View style={[styles.dot, { backgroundColor: tint }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name} numberOfLines={1}>{s.name}</Text>
                    {s.colorIndex === 0 && hostDeckName ? <Text style={styles.deck} numberOfLines={1}>{hostDeckName}</Text> : null}
                  </View>
                  <Text style={styles.life}>{s.life} life</Text>
                </View>
              );
            })}
          </ScrollView>

          <View style={styles.actions}>
            <Pressable style={[styles.btn, styles.secondary]} onPress={onDone}><Text style={styles.secondaryText}>Done</Text></Pressable>
            <Pressable style={[styles.btn, styles.primary]} onPress={onRematch}><Text style={styles.primaryText}>↻ Rematch</Text></Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 420, backgroundColor: '#111827', borderColor: '#1e2d47', borderWidth: 1, borderRadius: 24, padding: 22 },
  kicker: { color: '#64748b', fontSize: 12, fontWeight: '800', letterSpacing: 2, textAlign: 'center' },
  title: { color: '#fff', fontSize: 26, fontWeight: '800', textAlign: 'center', marginBottom: 18 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#1a2235', borderColor: '#1e2d47', borderWidth: 1, borderRadius: 14, padding: 12 },
  rowWin: { borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.1)' },
  place: { fontSize: 18, fontWeight: '800', color: '#f1f5f9', width: 30, textAlign: 'center' },
  dot: { width: 12, height: 12, borderRadius: 6 },
  name: { color: '#f1f5f9', fontSize: 15, fontWeight: '700' },
  deck: { color: '#94a3b8', fontSize: 12, marginTop: 1 },
  life: { color: '#64748b', fontSize: 13, fontWeight: '600' },
  actions: { flexDirection: 'row', gap: 10, marginTop: 18 },
  btn: { flex: 1, paddingVertical: 14, borderRadius: 14, alignItems: 'center' },
  primary: { backgroundColor: '#f59e0b' },
  primaryText: { color: '#0a0e1a', fontWeight: '800' },
  secondary: { backgroundColor: '#1a2235', borderColor: '#1e2d47', borderWidth: 1 },
  secondaryText: { color: '#94a3b8', fontWeight: '700' },
});
