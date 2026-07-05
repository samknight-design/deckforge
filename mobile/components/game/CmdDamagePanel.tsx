// Shown in each attacker's slot while commander-damage mode is open. Tapping a
// half applies/removes commander damage that THIS attacker has dealt to the
// defending player (each point also costs the defender a life). Rotates with
// the slot like the normal panel so it reads for that player.

import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CMD_DAMAGE_LETHAL, seatColor, type Seat } from '../../lib/game/formats';
import type { Rot } from '../../lib/game/layouts';

export default function CmdDamagePanel({
  attacker,
  rotation,
  dealt,
  onApply,
}: {
  attacker: Seat;
  rotation: Rot;
  dealt: number;
  onApply: (delta: number) => void;
}) {
  const tint = seatColor(attacker);
  const lethal = dealt >= CMD_DAMAGE_LETHAL;

  return (
    <View style={[styles.outer, { backgroundColor: tint }]}>
      <View style={[styles.inner, { transform: [{ rotate: `${rotation}deg` }] }]}>
        <View style={styles.touchRow}>
          <Pressable style={[styles.half, { alignItems: 'flex-start' }]} onPress={() => onApply(-1)}>
            <Text style={styles.hint}>−</Text>
          </Pressable>
          <Pressable style={[styles.half, { alignItems: 'flex-end' }]} onPress={() => onApply(1)}>
            <Text style={styles.hint}>+</Text>
          </Pressable>
        </View>

        <View pointerEvents="none" style={styles.center}>
          <Text style={styles.from} numberOfLines={1}>⚔ from {attacker.name}</Text>
          <Text style={[styles.dmg, lethal && { color: '#fecaca' }]} numberOfLines={1} adjustsFontSizeToFit>{dealt}</Text>
          {lethal && <Text style={styles.lethal}>LETHAL</Text>}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: { flex: 1, borderRadius: 18, overflow: 'hidden', opacity: 0.96 },
  inner: { flex: 1 },
  touchRow: { ...StyleSheet.absoluteFillObject, flexDirection: 'row' },
  half: { flex: 1, justifyContent: 'center', paddingHorizontal: 14 },
  hint: { color: '#ffffff', opacity: 0.35, fontSize: 28, fontWeight: '300' },
  center: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  from: { color: '#ffffff', opacity: 0.85, fontSize: 12, fontWeight: '700', marginBottom: 2 },
  dmg: { color: '#ffffff', fontSize: 52, fontWeight: '800' },
  lethal: { color: '#fecaca', fontSize: 11, fontWeight: '800', letterSpacing: 1, marginTop: 2 },
});
