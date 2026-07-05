// Board menu (opened by the centre ☰). Pick a seat layout for the current
// player count — each shown as a little diagram with arrows for facing — plus
// Dice, Reset and End. Drag the sheet down (or tap outside) to dismiss.

import { ScrollView, StyleSheet, Text, View, Pressable } from 'react-native';
import { SEAT_COLORS } from '../../lib/game/formats';
import { pct, type Layout, type Rot } from '../../lib/game/layouts';
import BottomSheet from './BottomSheet';

function Preview({ layout }: { layout: Layout }) {
  return (
    <View style={styles.preview}>
      {layout.slots.map((s, i) => (
        <View
          key={i}
          style={[
            styles.previewSlot,
            { left: pct(s.x), top: pct(s.y), width: pct(s.w), height: pct(s.h), backgroundColor: SEAT_COLORS[i % SEAT_COLORS.length] },
          ]}
        >
          <Text style={[styles.previewArrow, { transform: [{ rotate: `${s.rot as Rot}deg` }] }]}>▲</Text>
        </View>
      ))}
    </View>
  );
}

export default function LayoutMenu({
  visible,
  layouts,
  activeId,
  title,
  onSelect,
  onDice,
  onReset,
  onEnd,
  onClose,
}: {
  visible: boolean;
  layouts: Layout[];
  activeId: string;
  title: string;
  onSelect: (id: string) => void;
  onDice: () => void;
  onReset: () => void;
  onEnd: () => void;
  onClose: () => void;
}) {
  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <Text style={styles.title}>{title}</Text>

      <Text style={styles.section}>Layout</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {layouts.map((l) => {
          const active = l.id === activeId;
          return (
            <Pressable key={l.id} style={[styles.card, active && styles.cardActive]} onPress={() => onSelect(l.id)}>
              <Preview layout={l} />
              <Text style={[styles.cardLabel, active && { color: '#f59e0b' }]} numberOfLines={1}>{l.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={styles.actions}>
        <Pressable style={styles.actionBtn} onPress={onDice}><Text style={styles.actionText}>🎲 Dice</Text></Pressable>
        <Pressable style={styles.actionBtn} onPress={onReset}><Text style={styles.actionText}>⟲ Reset</Text></Pressable>
        <Pressable style={[styles.actionBtn, styles.endBtn]} onPress={onEnd}><Text style={[styles.actionText, { color: '#fca5a5' }]}>✕ End</Text></Pressable>
      </View>
    </BottomSheet>
  );
}

const PREVIEW_W = 70;
const PREVIEW_H = 104;

const styles = StyleSheet.create({
  title: { color: '#fff', fontSize: 18, fontWeight: '700', marginBottom: 4 },
  section: { color: '#94a3b8', fontSize: 12, fontWeight: '700', marginTop: 12, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  row: { gap: 12, paddingVertical: 2 },
  card: { alignItems: 'center', padding: 8, borderRadius: 14, borderWidth: 1, borderColor: 'transparent' },
  cardActive: { borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.08)' },
  preview: { width: PREVIEW_W, height: PREVIEW_H, borderRadius: 8, overflow: 'hidden', backgroundColor: '#05070d', position: 'relative' },
  previewSlot: { position: 'absolute', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#05070d' },
  previewArrow: { color: 'rgba(255,255,255,0.9)', fontSize: 11 },
  cardLabel: { color: '#cbd5e1', fontSize: 12, fontWeight: '600', marginTop: 6, maxWidth: PREVIEW_W + 16, textAlign: 'center' },
  actions: { flexDirection: 'row', gap: 10, marginTop: 20 },
  actionBtn: { flex: 1, alignItems: 'center', paddingVertical: 13, borderRadius: 12, backgroundColor: '#1a2235', borderColor: '#1e2d47', borderWidth: 1 },
  endBtn: { backgroundColor: 'rgba(239,68,68,0.12)', borderColor: 'rgba(239,68,68,0.4)' },
  actionText: { color: '#f1f5f9', fontWeight: '700', fontSize: 13 },
});
