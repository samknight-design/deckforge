// One player's panel on the life-tracker board. Content rotates by `rotation`
// (set by the active layout) so the player reads upright.
//   • tap a half           → −1 / +1 life
//   • tap the −/+ icon      → −1 / +1 ;  long-press the −/+ icon → −10 / +10
//   • grip + swipe          → slide the panel to open commander damage
//   • long-press a half     → per-player options sheet
// Adapts to its measured size so nothing gets clipped on small slots.

import { useRef, useState } from 'react';
import { Animated, Image, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { CMD_DAMAGE_LETHAL, seatColor, type Seat } from '../../lib/game/formats';
import type { Rot } from '../../lib/game/layouts';

const SWIPE_OPEN = 46;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export default function SeatPanel({
  seat,
  rotation,
  onLife,
  onSwipe,
  onLongPress,
}: {
  seat: Seat;
  rotation: Rot;
  onLife: (delta: number) => void;
  onSwipe: () => void;
  onLongPress: () => void;
}) {
  const tint = seatColor(seat);
  const slide = useRef(new Animated.Value(0)).current;
  const [minDim, setMinDim] = useState(999);

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_e, g) => Math.hypot(g.dx, g.dy) > 16,
      onPanResponderMove: (_e, g) => slide.setValue(clamp(g.dx, -70, 70)),
      onPanResponderRelease: (_e, g) => {
        Animated.spring(slide, { toValue: 0, useNativeDriver: true, speed: 20, bounciness: 8 }).start();
        if (Math.hypot(g.dx, g.dy) > SWIPE_OPEN) onSwipe();
      },
      onPanResponderTerminate: () => Animated.spring(slide, { toValue: 0, useNativeDriver: true }).start(),
    }),
  ).current;

  const showSigns = minDim >= 68;
  const showName = minDim >= 60;
  const showDeck = minDim >= 90 && !!seat.deckName;
  const showBadges = minDim >= 80;
  const showGrip = minDim >= 88;
  const lifeFont = clamp(minDim * 0.5, 22, 58);
  const tokenFont = clamp(minDim * 0.14, 11, 16);

  const counters = seat.counters ?? { poison: 0, energy: 0, experience: 0 };
  const status = seat.status ?? { monarch: false, initiative: false, cityBlessing: false };
  const maxCmd = Object.values(seat.cmdDamage ?? {}).reduce((m, v) => Math.max(m, v), 0);
  const badges: string[] = [];
  if (counters.poison > 0) badges.push(`☠${counters.poison}`);
  if (maxCmd > 0) badges.push(`⚔${maxCmd}`);
  if (counters.energy > 0) badges.push(`⚡${counters.energy}`);
  if (counters.experience > 0) badges.push(`✦${counters.experience}`);
  (seat.customCounters ?? []).forEach((c) => c.value > 0 && badges.push(`${c.label} ${c.value}`));
  const lethalCmd = maxCmd >= CMD_DAMAGE_LETHAL;

  const tokens: string[] = [];
  if (status.monarch) tokens.push('👑');
  if (status.initiative) tokens.push('🛡');
  if (status.cityBlessing) tokens.push('🏙');

  const signStyle = { fontSize: lifeFont * 0.42 };

  return (
    <Animated.View
      style={[styles.outer, { backgroundColor: tint, transform: [{ translateX: slide }] }]}
      onLayout={(e) => setMinDim(Math.min(e.nativeEvent.layout.width, e.nativeEvent.layout.height))}
      {...pan.panHandlers}
    >
      {seat.bgImageUrl ? (
        <>
          <Image source={{ uri: seat.bgImageUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" />
          <View style={[StyleSheet.absoluteFill, styles.scrim]} />
        </>
      ) : null}

      <View style={[styles.inner, { transform: [{ rotate: `${rotation}deg` }] }]}>
        {/* full-height ±1 tap halves; long-press opens the options sheet */}
        <View style={styles.touchRow}>
          <Pressable style={styles.half} onPress={() => onLife(-1)} onLongPress={onLongPress} delayLongPress={330} />
          <Pressable style={styles.half} onPress={() => onLife(1)} onLongPress={onLongPress} delayLongPress={330} />
        </View>

        <View pointerEvents="box-none" style={styles.center}>
          {tokens.length > 0 && <Text style={[styles.tokens, { fontSize: tokenFont }]} numberOfLines={1}>{tokens.join(' ')}</Text>}
          {showName && <Text style={styles.name} numberOfLines={1}>{seat.name}</Text>}
          {showDeck && <Text style={styles.deck} numberOfLines={1}>🃏 {seat.deckName}</Text>}
          <View pointerEvents="box-none" style={styles.lifeRow}>
            {showSigns && (
              <Pressable hitSlop={10} onPress={() => onLife(-1)} onLongPress={() => onLife(-10)} delayLongPress={300}>
                <Text style={[styles.sign, signStyle]}>−</Text>
              </Pressable>
            )}
            <Text style={[styles.life, { fontSize: lifeFont }]} numberOfLines={1} adjustsFontSizeToFit>{seat.life}</Text>
            {showSigns && (
              <Pressable hitSlop={10} onPress={() => onLife(1)} onLongPress={() => onLife(10)} delayLongPress={300}>
                <Text style={[styles.sign, signStyle]}>+</Text>
              </Pressable>
            )}
          </View>
          {showBadges && badges.length > 0 && (
            <Text style={[styles.badges, lethalCmd && { color: '#fee2e2' }]} numberOfLines={1}>{badges.join('  ')}</Text>
          )}
        </View>
      </View>

      {/* single grip hugging the panel's screen edge — signals it slides */}
      {showGrip && <View pointerEvents="none" style={styles.grip} />}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  outer: { flex: 1, borderRadius: 18, overflow: 'hidden' },
  scrim: { backgroundColor: 'rgba(5,7,13,0.45)' },
  inner: { flex: 1 },
  touchRow: { ...StyleSheet.absoluteFillObject, flexDirection: 'row' },
  half: { flex: 1 },
  grip: { position: 'absolute', right: 2, top: '50%', marginTop: -16, width: 4, height: 32, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.4)' },
  center: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  tokens: { marginBottom: 1 },
  name: { color: '#ffffff', opacity: 0.9, fontSize: 13, fontWeight: '700' },
  deck: { color: '#ffffff', opacity: 0.7, fontSize: 11, fontWeight: '600', marginTop: 1 },
  lifeRow: { flexDirection: 'row', alignItems: 'center' },
  sign: { color: '#ffffff', opacity: 0.5, fontWeight: '400', marginHorizontal: 12 },
  life: { color: '#ffffff', fontWeight: '800' },
  badges: { color: '#ffffff', opacity: 0.9, fontSize: 12, fontWeight: '700', marginTop: 2 },
});
