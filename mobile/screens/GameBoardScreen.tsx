// The live life-tracker board (single device). Seats are positioned/oriented by
// the active layout (lib/game/layouts.ts). Modes:
//   • normal      — tap ±life, swipe a seat to enter commander-damage, long-press for counters
//   • cmd-damage  — the swiped seat is the defender (slid drawer); every other
//                   seat shows a ± panel for the commander damage it deals to it
//   • results     — when one player remains, finishing order from elimination
// Persists the in-progress game for resume. Stat write-back + multiplayer are
// later slices (see docs/GAME_TRACKER.md).

import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, Platform, Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import SeatPanel from '../components/game/SeatPanel';
import CmdDamagePanel from '../components/game/CmdDamagePanel';
import LayoutMenu from '../components/game/LayoutMenu';
import PlayerSheet from '../components/game/PlayerSheet';
import DiceDrawer from '../components/game/DiceDrawer';
import ResultsOverlay from '../components/game/ResultsOverlay';
import { FORMATS, isLethal, makeSeat, type GameConfig, type Seat } from '../lib/game/formats';
import { getLayouts, defaultLayout, pct, type Rot } from '../lib/game/layouts';
import { clearGame, saveGame, type SavedGame } from '../lib/game/persist';
import { artCropForCard } from '../lib/game/scryfall';

// Keep the board clear of the (edge-to-edge) system status/navigation bars.
// Properly hiding the nav bar needs expo-navigation-bar (a native rebuild); this
// inset is the no-rebuild fallback, sized to clear a 3-button nav bar.
const INSET_TOP = Platform.OS === 'android' ? (StatusBar.currentHeight ?? 20) : 14;
const INSET_BOTTOM = Platform.OS === 'android' ? 44 : 24;

function freshSeats(config: GameConfig, hostName: string | null): Seat[] {
  return Array.from({ length: config.playerCount }, (_, i) => {
    const seat = makeSeat(i, i === 0 ? hostName || 'You' : `P${i + 1}`, config.startingLife);
    if (i === 0 && config.hostDeck) {
      seat.deckId = config.hostDeck.id;
      seat.deckName = config.hostDeck.name;
      // commander art_crop is fetched on mount (see effect below)
    }
    return seat;
  });
}

const buzz = (style: Haptics.ImpactFeedbackStyle = Haptics.ImpactFeedbackStyle.Light) => {
  Haptics.impactAsync(style).catch(() => {});
};

// The defender's slot during cmd-damage mode: slides in like a drawer, tap to finish.
function DefenderDrawer({ seat, rotation, onClose }: { seat: Seat; rotation: Rot; onClose: () => void }) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(t, { toValue: 1, useNativeDriver: true, speed: 14, bounciness: 7 }).start();
  }, [t]);
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => Math.hypot(g.dx, g.dy) > 14,
      onPanResponderRelease: (_e, g) => { if (Math.hypot(g.dx, g.dy) > 40) onClose(); },
    }),
  ).current;
  const translateX = t.interpolate({ inputRange: [0, 1], outputRange: [0, 20] });
  return (
    <Animated.View style={[drawer.outer, { transform: [{ translateX }] }]} {...pan.panHandlers}>
      <Pressable style={drawer.inner} onPress={onClose}>
        <View pointerEvents="none" style={[drawer.grip, drawer.gripL]} />
        <View pointerEvents="none" style={[drawer.grip, drawer.gripR]} />
        <View style={{ transform: [{ rotate: `${rotation}deg` }], alignItems: 'center' }}>
          <Text style={drawer.kicker}>DEFENDING</Text>
          <Text style={drawer.name} numberOfLines={1}>🛡 {seat.name}</Text>
          <Text style={drawer.life}>{seat.life}</Text>
          <Text style={drawer.done}>‹ tap or slide to finish ›</Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}

export default function GameBoardScreen({
  config,
  userId,
  hostName,
  resume,
  onExit,
}: {
  config: GameConfig;
  userId: string;
  hostName: string | null;
  resume?: SavedGame | null;
  onExit: () => void;
}) {
  const format = FORMATS[config.format];
  const layouts = useMemo(() => getLayouts(config.playerCount), [config.playerCount]);

  const [seats, setSeats] = useState<Seat[]>(() => resume?.seats ?? freshSeats(config, hostName));
  const [layoutId, setLayoutId] = useState(() => resume?.layoutId ?? defaultLayout(config.playerCount).id);
  const [menuOpen, setMenuOpen] = useState(false);
  const [diceOpen, setDiceOpen] = useState(false);
  const [cmdTargetId, setCmdTargetId] = useState<string | null>(null);
  const [optSeatId, setOptSeatId] = useState<string | null>(null);
  const [gameOver, setGameOver] = useState(false);

  const layout = useMemo(() => layouts.find((l) => l.id === layoutId) ?? layouts[0], [layouts, layoutId]);
  const defender = cmdTargetId ? seats.find((s) => s.id === cmdTargetId) ?? null : null;
  const optSeat = optSeatId ? seats.find((s) => s.id === optSeatId) ?? null : null;

  // ── Persistence (debounced) ───────────────────────────────────────────────
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (gameOver) { clearGame(); return; }
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => saveGame({ config, seats, layoutId }), 500);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [seats, layoutId, gameOver, config]);

  // ── Auto-eliminate on lethal (0 life, 10 poison, 21 commander damage) ──────
  useEffect(() => {
    if (gameOver) return;
    const victim = seats.find((s) => s.alive && isLethal(s));
    if (!victim) return;
    buzz(Haptics.ImpactFeedbackStyle.Heavy);
    setSeats((prev) => {
      const aliveCount = prev.filter((s) => s.alive).length;
      return prev.map((s) => (s.id === victim.id ? { ...s, alive: false, placement: aliveCount } : s));
    });
  }, [seats, gameOver]);

  // ── Winner detection ──────────────────────────────────────────────────────
  useEffect(() => {
    if (gameOver || seats.length <= 1) return;
    const alive = seats.filter((s) => s.alive);
    if (alive.length <= 1) {
      if (alive.length === 1 && alive[0].placement == null) {
        setSeats((prev) => prev.map((s) => (s.id === alive[0].id ? { ...s, placement: 1 } : s)));
      }
      buzz(Haptics.ImpactFeedbackStyle.Heavy);
      setGameOver(true);
    }
  }, [seats, gameOver]);

  // Fetch the host commander's cropped art for seat 1 (fresh games only).
  useEffect(() => {
    if (resume) return;
    const cmd = config.hostDeck?.commander_name;
    if (!cmd) return;
    let active = true;
    artCropForCard(cmd).then((art) => {
      if (active && art) setSeats((prev) => prev.map((s, i) => (i === 0 && !s.bgImageUrl ? { ...s, bgImageUrl: art } : s)));
    });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Mutations ─────────────────────────────────────────────────────────────
  const changeLife = (id: string, delta: number) => {
    buzz();
    setSeats((prev) => prev.map((s) => (s.id === id ? { ...s, life: s.life + delta } : s)));
  };

  const mutateSeat = (id: string, fn: (s: Seat) => Seat) =>
    setSeats((prev) => prev.map((s) => (s.id === id ? fn(s) : s)));

  // Monarch / the Initiative are exclusive — granting to one clears the rest.
  const setExclusiveToken = (seatId: string, token: 'monarch' | 'initiative', value: boolean) =>
    setSeats((prev) => prev.map((s) => ({
      ...s,
      status: { ...s.status, [token]: s.id === seatId ? value : value ? false : s.status[token] },
    })));

  // Apply commander damage from attacker → defender (also costs a life each).
  const applyCmd = (defenderId: string, attackerId: string, delta: number) => {
    buzz();
    setSeats((prev) => prev.map((s) => {
      if (s.id !== defenderId) return s;
      const cur = s.cmdDamage[attackerId] || 0;
      const next = Math.max(0, cur + delta);
      const applied = next - cur;
      return { ...s, cmdDamage: { ...s.cmdDamage, [attackerId]: next }, life: s.life - applied };
    }));
  };

  const eliminateSeat = (id: string) => {
    setOptSeatId(null);
    buzz(Haptics.ImpactFeedbackStyle.Medium);
    setSeats((prev) => {
      const target = prev.find((s) => s.id === id);
      if (!target) return prev;
      if (target.alive) {
        const aliveCount = prev.filter((s) => s.alive).length;
        return prev.map((s) => (s.id === id ? { ...s, alive: false, placement: aliveCount } : s));
      }
      return prev.map((s) => (s.id === id ? { ...s, alive: true, placement: null } : s));
    });
  };

  const resetLife = () => {
    setMenuOpen(false);
    setSeats((prev) => prev.map((s) => ({ ...s, life: config.startingLife })));
  };

  const rematch = () => {
    setSeats((prev) => prev.map((s) => ({
      ...s, life: config.startingLife, cmdDamage: {}, counters: { poison: 0, energy: 0, experience: 0 }, customCounters: [], alive: true, placement: null,
    })));
    setGameOver(false);
    setCmdTargetId(null);
  };

  const finish = () => { clearGame(); onExit(); };

  // ── Render ────────────────────────────────────────────────────────────────
  const inCmd = !!defender;

  return (
    <View style={styles.root}>
      <StatusBar hidden />

      <View style={styles.board}>
        <View style={styles.seatArea}>
        {layout.slots.map((slot, i) => {
          const seat = seats[i];
          if (!seat) return null;
          const wrap = { position: 'absolute' as const, left: pct(slot.x), top: pct(slot.y), width: pct(slot.w), height: pct(slot.h), padding: 3 };

          // Commander-damage mode
          if (inCmd && defender) {
            if (seat.id === defender.id) {
              return (
                <View key={seat.id} style={wrap}>
                  <DefenderDrawer seat={seat} rotation={slot.rot} onClose={() => setCmdTargetId(null)} />
                </View>
              );
            }
            return (
              <View key={seat.id} style={wrap}>
                <CmdDamagePanel
                  attacker={seat}
                  rotation={slot.rot}
                  dealt={defender.cmdDamage[seat.id] || 0}
                  onApply={(d) => applyCmd(defender.id, seat.id, d)}
                />
              </View>
            );
          }

          // Normal mode
          return (
            <View key={seat.id} style={wrap}>
              <SeatPanel
                seat={seat}
                rotation={slot.rot}
                onLife={(d) => changeLife(seat.id, d)}
                onSwipe={() => { buzz(); setCmdTargetId(seat.id); }}
                onLongPress={() => setOptSeatId(seat.id)}
              />
              {!seat.alive && (
                <Pressable style={styles.deadOverlay} onPress={() => setOptSeatId(seat.id)}>
                  <View style={{ transform: [{ rotate: `${slot.rot}deg` }], alignItems: 'center' }}>
                    <Text style={styles.deadSkull}>💀</Text>
                    <Text style={styles.deadLabel}>ELIMINATED</Text>
                    <Text style={styles.deadName} numberOfLines={1}>{seat.name}{seat.placement ? `  ·  #${seat.placement}` : ''}</Text>
                  </View>
                </Pressable>
              )}
            </View>
          );
        })}

        {/* Centre control */}
        {inCmd ? (
          <Pressable style={[styles.menuBtn, styles.doneBtn]} onPress={() => setCmdTargetId(null)} hitSlop={8}>
            <Text style={styles.doneIcon}>✓</Text>
          </Pressable>
        ) : (
          <Pressable style={styles.menuBtn} onPress={() => setMenuOpen(true)} hitSlop={8}>
            <Text style={styles.menuIcon}>☰</Text>
          </Pressable>
        )}
        </View>
      </View>

      <LayoutMenu
        visible={menuOpen}
        layouts={layouts}
        activeId={layout.id}
        title={`${format.label} · ${config.playerCount} players`}
        onSelect={(id) => { setLayoutId(id); setMenuOpen(false); }}
        onDice={() => { setMenuOpen(false); setDiceOpen(true); }}
        onReset={resetLife}
        onEnd={() => { setMenuOpen(false); finish(); }}
        onClose={() => setMenuOpen(false)}
      />

      <DiceDrawer
        visible={diceOpen}
        seatNames={seats.map((s) => s.name)}
        onClose={() => setDiceOpen(false)}
      />

      <PlayerSheet
        seat={optSeat}
        userId={userId}
        onMutate={(fn) => optSeatId && mutateSeat(optSeatId, fn)}
        onExclusiveToken={(token, value) => optSeatId && setExclusiveToken(optSeatId, token, value)}
        onEliminate={() => optSeatId && eliminateSeat(optSeatId)}
        onClose={() => setOptSeatId(null)}
      />

      <ResultsOverlay
        visible={gameOver}
        seats={seats}
        hostDeckName={config.hostDeck?.name}
        onRematch={rematch}
        onDone={finish}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#05070d' },
  board: { flex: 1, paddingHorizontal: 3, paddingTop: INSET_TOP, paddingBottom: INSET_BOTTOM },
  seatArea: { flex: 1, position: 'relative' },
  menuBtn: {
    position: 'absolute', top: '50%', left: '50%', marginLeft: -22, marginTop: -22,
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: '#0a0e1a', borderColor: '#1e2d47', borderWidth: 2,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 6,
  },
  menuIcon: { color: '#f1f5f9', fontSize: 20, fontWeight: '700' },
  doneBtn: { backgroundColor: '#059669', borderColor: '#10b981' },
  doneIcon: { color: '#ffffff', fontSize: 22, fontWeight: '800' },
  deadOverlay: { ...StyleSheet.absoluteFillObject, borderRadius: 18, backgroundColor: 'rgba(2,3,8,0.93)', alignItems: 'center', justifyContent: 'center' },
  deadSkull: { fontSize: 46 },
  deadLabel: { color: '#ef4444', fontSize: 12, fontWeight: '900', letterSpacing: 2, marginTop: 4 },
  deadName: { color: '#94a3b8', fontSize: 12, fontWeight: '700', marginTop: 2 },
});

const drawer = StyleSheet.create({
  outer: { flex: 1, borderRadius: 18, overflow: 'hidden', backgroundColor: '#0a0e1a', borderColor: '#334155', borderWidth: 2, borderStyle: 'dashed' },
  inner: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  grip: { position: 'absolute', top: '50%', marginTop: -16, width: 5, height: 32, borderRadius: 3, backgroundColor: 'rgba(148,163,184,0.6)' },
  gripL: { left: 6 },
  gripR: { right: 6 },
  kicker: { color: '#64748b', fontSize: 10, fontWeight: '800', letterSpacing: 1.5 },
  name: { color: '#f1f5f9', fontSize: 14, fontWeight: '700', marginTop: 2 },
  life: { color: '#f1f5f9', fontSize: 40, fontWeight: '800' },
  done: { color: '#64748b', fontSize: 11, fontWeight: '600', marginTop: 4 },
});
