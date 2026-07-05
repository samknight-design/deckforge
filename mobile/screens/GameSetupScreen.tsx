// Host setup: choose format, player count and starting life, optionally attach
// your deck, then start the board. Single-device for now — attaching a deck is
// groundwork for stat tracking in a later slice.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { getDecks, type Deck } from '../lib/db';
import { useTheme } from '../lib/theme';
import {
  FORMATS,
  FORMAT_ORDER,
  type GameConfig,
  type GameFormat,
} from '../lib/game/formats';

export default function GameSetupScreen({
  userId,
  onBack,
  onStart,
}: {
  userId: string;
  onBack: () => void;
  onStart: (config: GameConfig) => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [format, setFormat] = useState<GameFormat>('commander');
  const [playerCount, setPlayerCount] = useState(FORMATS.commander.minPlayers + 2); // default 4
  const [startingLife, setStartingLife] = useState(FORMATS.commander.defaultLife);
  const [hostDeck, setHostDeck] = useState<Deck | null>(null);
  const [decks, setDecks] = useState<Deck[] | null>(null);

  useEffect(() => {
    getDecks(userId).then(setDecks).catch(() => setDecks([]));
  }, [userId]);

  // When the format changes, snap life + clamp player count to its rules.
  const pickFormat = (f: GameFormat) => {
    const def = FORMATS[f];
    setFormat(f);
    setStartingLife(def.defaultLife);
    setPlayerCount((n) => Math.min(def.maxPlayers, Math.max(def.minPlayers, def.teams ? def.minPlayers : n)));
  };

  const def = FORMATS[format];
  const canDec = playerCount > def.minPlayers;
  const canInc = playerCount < def.maxPlayers;

  const start = () =>
    onStart({ format, playerCount, startingLife, hostDeck });

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <Pressable style={styles.iconBtn} onPress={onBack}>
          <Text style={styles.iconBtnText}>← Back</Text>
        </Pressable>
        <Text style={styles.topTitle}>Host a game</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* Format */}
        <Text style={styles.label}>Format</Text>
        <View style={styles.formatGrid}>
          {FORMAT_ORDER.map((f) => {
            const fd = FORMATS[f];
            const active = f === format;
            return (
              <Pressable
                key={f}
                style={[styles.formatCard, active && styles.formatCardActive]}
                onPress={() => pickFormat(f)}
              >
                <Text style={[styles.formatName, active && { color: colors.accent }]}>{fd.label}</Text>
                <Text style={styles.formatBlurb}>{fd.blurb}</Text>
              </Pressable>
            );
          })}
        </View>

        {/* Players */}
        <Text style={styles.label}>Players</Text>
        <View style={styles.stepperRow}>
          <Pressable
            style={[styles.stepBtn, !canDec && styles.stepBtnOff]}
            onPress={() => canDec && setPlayerCount((n) => n - 1)}
          >
            <Text style={styles.stepBtnText}>−</Text>
          </Pressable>
          <View style={styles.stepValueWrap}>
            <Text style={styles.stepValue}>{playerCount}</Text>
            <Text style={styles.stepUnit}>players</Text>
          </View>
          <Pressable
            style={[styles.stepBtn, !canInc && styles.stepBtnOff]}
            onPress={() => canInc && setPlayerCount((n) => n + 1)}
          >
            <Text style={styles.stepBtnText}>+</Text>
          </Pressable>
        </View>
        {def.teams && <Text style={styles.hint}>Two-Headed Giant is fixed at 4 (two teams of two).</Text>}
        {playerCount >= 7 && <Text style={styles.hint}>Big pods get tight on one phone — players can use their own later.</Text>}

        {/* Starting life */}
        <Text style={styles.label}>Starting life</Text>
        <View style={styles.stepperRow}>
          <Pressable style={styles.stepBtn} onPress={() => setStartingLife((l) => Math.max(1, l - 1))}>
            <Text style={styles.stepBtnText}>−</Text>
          </Pressable>
          <View style={styles.stepValueWrap}>
            <Text style={styles.stepValue}>{startingLife}</Text>
            <Text style={styles.stepUnit}>life</Text>
          </View>
          <Pressable style={styles.stepBtn} onPress={() => setStartingLife((l) => l + 1)}>
            <Text style={styles.stepBtnText}>+</Text>
          </Pressable>
        </View>
        <View style={styles.presetRow}>
          {[20, 30, 40].map((v) => (
            <Pressable key={v} style={styles.preset} onPress={() => setStartingLife(v)}>
              <Text style={styles.presetText}>{v}</Text>
            </Pressable>
          ))}
        </View>

        {/* Your deck (optional) */}
        <Text style={styles.label}>Your deck <Text style={styles.optional}>· optional</Text></Text>
        {decks === null ? (
          <ActivityIndicator color={colors.accent} style={{ marginVertical: 12 }} />
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.deckRow}>
            <Pressable
              style={[styles.deckChip, !hostDeck && styles.deckChipActive]}
              onPress={() => setHostDeck(null)}
            >
              <Text style={[styles.deckChipText, !hostDeck && { color: colors.accent }]}>No deck</Text>
            </Pressable>
            {decks.map((d) => {
              const active = hostDeck?.id === d.id;
              return (
                <Pressable
                  key={d.id}
                  style={[styles.deckChip, active && styles.deckChipActive]}
                  onPress={() => setHostDeck(d)}
                >
                  <Text style={[styles.deckChipText, active && { color: colors.accent }]} numberOfLines={1}>
                    {d.name}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        )}
        <Text style={styles.hint}>Attach a deck to track this game's result later (coming soon).</Text>

        <View style={{ height: 24 }} />
      </ScrollView>

      <View style={styles.footer}>
        <Pressable style={styles.startBtn} onPress={start}>
          <Text style={styles.startBtnText}>Start game →</Text>
        </Pressable>
      </View>
    </View>
  );
}

const createStyles = (c: ReturnType<typeof import('../lib/theme').useTheme>['colors']) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg, paddingTop: 50 },
    topBar: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: 16, paddingBottom: 12, borderBottomColor: c.border, borderBottomWidth: 1,
    },
    topTitle: { color: c.text, fontWeight: '700', fontSize: 18 },
    iconBtn: {
      backgroundColor: c.surface, borderColor: c.border, borderWidth: 1,
      paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20,
    },
    iconBtnText: { color: c.textMuted, fontSize: 13 },
    content: { padding: 20 },
    label: { color: c.text, fontWeight: '700', fontSize: 15, marginBottom: 10, marginTop: 18 },
    optional: { color: c.textDim, fontWeight: '500', fontSize: 13 },
    formatGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    formatCard: {
      width: '47%', flexGrow: 1,
      backgroundColor: c.surface, borderColor: c.border, borderWidth: 1,
      borderRadius: 14, padding: 14,
    },
    formatCardActive: { borderColor: c.accent, backgroundColor: 'rgba(245,158,11,0.08)' },
    formatName: { color: c.text, fontWeight: '700', fontSize: 14, marginBottom: 3 },
    formatBlurb: { color: c.textMuted, fontSize: 11 },
    stepperRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
    stepBtn: {
      width: 54, height: 54, borderRadius: 16,
      backgroundColor: c.surface, borderColor: c.border, borderWidth: 1,
      alignItems: 'center', justifyContent: 'center',
    },
    stepBtnOff: { opacity: 0.35 },
    stepBtnText: { color: c.text, fontSize: 26, fontWeight: '600' },
    stepValueWrap: { flex: 1, alignItems: 'center' },
    stepValue: { color: c.text, fontSize: 34, fontWeight: '800' },
    stepUnit: { color: c.textMuted, fontSize: 12 },
    hint: { color: c.textDim, fontSize: 12, marginTop: 8, lineHeight: 17 },
    presetRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
    preset: {
      flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 10,
      backgroundColor: c.surfaceAlt, borderColor: c.border, borderWidth: 1,
    },
    presetText: { color: c.textMuted, fontWeight: '700', fontSize: 13 },
    deckRow: { gap: 8, paddingVertical: 2 },
    deckChip: {
      maxWidth: 160,
      backgroundColor: c.surface, borderColor: c.border, borderWidth: 1,
      paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999,
    },
    deckChipActive: { borderColor: c.accent, backgroundColor: 'rgba(245,158,11,0.08)' },
    deckChipText: { color: c.textMuted, fontWeight: '600', fontSize: 13 },
    footer: { padding: 16, borderTopColor: c.border, borderTopWidth: 1 },
    startBtn: { backgroundColor: c.accent, paddingVertical: 16, borderRadius: 14, alignItems: 'center' },
    startBtnText: { color: c.accentText, fontWeight: '800', fontSize: 16 },
  });
