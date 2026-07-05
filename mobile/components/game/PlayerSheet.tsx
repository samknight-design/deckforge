// Per-player options, opened by long-pressing a panel:
//   • rename
//   • background — a colour from the palette, or Scryfall card art
//   • tokens — Monarch / the Initiative (exclusive) / City's Blessing
//   • counters — poison / energy / experience / custom
//   • eliminate / bring back

import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { BG_COLOR_CHOICES, seatColor, type Seat } from '../../lib/game/formats';
import { getDecks, type Deck } from '../../lib/db';
import { searchArt, artCropForCard, type ArtResult as Art } from '../../lib/game/scryfall';
import BottomSheet from './BottomSheet';

function Counter({ icon, label, value, onDelta }: { icon: string; label: string; value: number; onDelta: (d: number) => void }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowIcon}>{icon}</Text>
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.stepper}>
        <Pressable style={styles.stepBtn} onPress={() => onDelta(-1)}><Text style={styles.stepTxt}>−</Text></Pressable>
        <Text style={styles.stepVal}>{value}</Text>
        <Pressable style={styles.stepBtn} onPress={() => onDelta(1)}><Text style={styles.stepTxt}>+</Text></Pressable>
      </View>
    </View>
  );
}

export default function PlayerSheet({
  seat,
  userId,
  onMutate,
  onExclusiveToken,
  onEliminate,
  onClose,
}: {
  seat: Seat | null;
  userId: string;
  onMutate: (fn: (s: Seat) => Seat) => void;
  onExclusiveToken: (token: 'monarch' | 'initiative', value: boolean) => void;
  onEliminate: () => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Art[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [decks, setDecks] = useState<Deck[] | null>(null);

  useEffect(() => {
    getDecks(userId).then(setDecks).catch(() => setDecks([]));
  }, [userId]);

  // Debounced Scryfall art search
  useEffect(() => {
    if (!query.trim()) { setResults(null); setError(null); return; }
    setSearching(true);
    setError(null);
    const t = setTimeout(async () => {
      try {
        setResults(await searchArt(query.trim()));
      } catch {
        setError('Search failed — check your connection.');
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 450);
    return () => clearTimeout(t);
  }, [query]);

  if (!seat) return null;
  const pickDeck = (d: Deck) => {
    onMutate((s) => ({ ...s, deckId: d.id, deckName: d.name }));
    // Auto-apply the commander's cropped art as the background (async).
    if (d.commander_name) {
      artCropForCard(d.commander_name).then((art) => {
        if (art) onMutate((s) => (s.deckId === d.id ? { ...s, bgImageUrl: art, bgColor: null } : s));
      });
    }
  };
  const tint = seatColor(seat);
  const setC = (k: 'poison' | 'energy' | 'experience', d: number) =>
    onMutate((s) => ({ ...s, counters: { ...s.counters, [k]: Math.max(0, s.counters[k] + d) } }));

  return (
    <BottomSheet visible onClose={onClose}>
        <View style={styles.titleRow}>
          <View style={[styles.dot, { backgroundColor: tint }]} />
          <TextInput
            style={styles.nameInput}
            value={seat.name}
            onChangeText={(t) => onMutate((s) => ({ ...s, name: t }))}
            placeholder="Player name"
            placeholderTextColor="#475569"
            maxLength={16}
          />
        </View>

        <ScrollView style={{ maxHeight: 460 }} keyboardShouldPersistTaps="handled">
          {/* Deck */}
          <Text style={styles.section}>Deck</Text>
          {decks === null ? (
            <ActivityIndicator color="#f59e0b" style={{ marginVertical: 8 }} />
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.deckRow}>
              <Pressable style={[styles.deckChip, !seat.deckId && styles.deckChipActive]} onPress={() => onMutate((s) => ({ ...s, deckId: null, deckName: null }))}>
                <Text style={[styles.deckChipTxt, !seat.deckId && { color: '#f59e0b' }]}>No deck</Text>
              </Pressable>
              {decks.map((d) => (
                <Pressable key={d.id} style={[styles.deckChip, seat.deckId === d.id && styles.deckChipActive]} onPress={() => pickDeck(d)}>
                  <Text style={[styles.deckChipTxt, seat.deckId === d.id && { color: '#f59e0b' }]} numberOfLines={1}>{d.name}</Text>
                </Pressable>
              ))}
            </ScrollView>
          )}

          {/* Background colour */}
          <Text style={styles.section}>Background colour</Text>
          <View style={styles.swatches}>
            <Pressable
              style={[styles.swatchDefault, !seat.bgColor && !seat.bgImageUrl && styles.swatchSel]}
              onPress={() => onMutate((s) => ({ ...s, bgColor: null, bgImageUrl: null }))}
            >
              <Text style={styles.swatchDefaultTxt}>Auto</Text>
            </Pressable>
            {BG_COLOR_CHOICES.map((c) => (
              <Pressable
                key={c}
                style={[styles.swatch, { backgroundColor: c }, seat.bgColor === c && !seat.bgImageUrl && styles.swatchSel]}
                onPress={() => onMutate((s) => ({ ...s, bgColor: c, bgImageUrl: null }))}
              />
            ))}
          </View>

          {/* Background art */}
          <Text style={styles.section}>Background art</Text>
          <View style={styles.searchRow}>
            <TextInput
              style={styles.search}
              value={query}
              onChangeText={setQuery}
              placeholder="Search a card for art…"
              placeholderTextColor="#475569"
              autoCapitalize="none"
            />
            {seat.bgImageUrl ? (
              <Pressable style={styles.clearArt} onPress={() => onMutate((s) => ({ ...s, bgImageUrl: null }))}>
                <Text style={styles.clearArtTxt}>Clear</Text>
              </Pressable>
            ) : null}
          </View>
          {error ? <Text style={styles.errTxt}>{error}</Text> : null}
          {searching ? (
            <ActivityIndicator color="#f59e0b" style={{ marginVertical: 12 }} />
          ) : results ? (
            results.length === 0 ? (
              <Text style={styles.noArt}>No cards found.</Text>
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.artRow}>
                {results.map((r) => (
                  <Pressable key={r.id} onPress={() => onMutate((s) => ({ ...s, bgImageUrl: r.art }))}>
                    <Image source={{ uri: r.art }} style={[styles.art, seat.bgImageUrl === r.art && styles.artSel]} resizeMode="cover" />
                  </Pressable>
                ))}
              </ScrollView>
            )
          ) : null}

          {/* Tokens */}
          <Text style={styles.section}>Tokens</Text>
          <View style={styles.tokenRow}>
            <Pressable style={[styles.token, seat.status.monarch && styles.tokenOn]} onPress={() => onExclusiveToken('monarch', !seat.status.monarch)}>
              <Text style={styles.tokenIcon}>👑</Text><Text style={styles.tokenLbl}>Monarch</Text>
            </Pressable>
            <Pressable style={[styles.token, seat.status.initiative && styles.tokenOn]} onPress={() => onExclusiveToken('initiative', !seat.status.initiative)}>
              <Text style={styles.tokenIcon}>🛡</Text><Text style={styles.tokenLbl}>Initiative</Text>
            </Pressable>
            <Pressable style={[styles.token, seat.status.cityBlessing && styles.tokenOn]} onPress={() => onMutate((s) => ({ ...s, status: { ...s.status, cityBlessing: !s.status.cityBlessing } }))}>
              <Text style={styles.tokenIcon}>🏙</Text><Text style={styles.tokenLbl}>City's Blessing</Text>
            </Pressable>
          </View>

          {/* Counters */}
          <Text style={styles.section}>Counters</Text>
          <Counter icon="☠" label="Poison" value={seat.counters.poison} onDelta={(d) => setC('poison', d)} />
          <Counter icon="⚡" label="Energy" value={seat.counters.energy} onDelta={(d) => setC('energy', d)} />
          <Counter icon="✦" label="Experience" value={seat.counters.experience} onDelta={(d) => setC('experience', d)} />
          {seat.customCounters.map((c) => (
            <View key={c.id} style={styles.row}>
              <Pressable onPress={() => onMutate((s) => ({ ...s, customCounters: s.customCounters.filter((x) => x.id !== c.id) }))} hitSlop={8}><Text style={styles.rowIcon}>✕</Text></Pressable>
              <TextInput
                style={[styles.rowLabel, styles.customLabel]}
                value={c.label}
                onChangeText={(t) => onMutate((s) => ({ ...s, customCounters: s.customCounters.map((x) => (x.id === c.id ? { ...x, label: t } : x)) }))}
                maxLength={14}
              />
              <View style={styles.stepper}>
                <Pressable style={styles.stepBtn} onPress={() => onMutate((s) => ({ ...s, customCounters: s.customCounters.map((x) => (x.id === c.id ? { ...x, value: Math.max(0, x.value - 1) } : x)) }))}><Text style={styles.stepTxt}>−</Text></Pressable>
                <Text style={styles.stepVal}>{c.value}</Text>
                <Pressable style={styles.stepBtn} onPress={() => onMutate((s) => ({ ...s, customCounters: s.customCounters.map((x) => (x.id === c.id ? { ...x, value: x.value + 1 } : x)) }))}><Text style={styles.stepTxt}>+</Text></Pressable>
              </View>
            </View>
          ))}
          <Pressable style={styles.addBtn} onPress={() => onMutate((s) => ({ ...s, customCounters: [...s.customCounters, { id: `c-${Date.now()}`, label: `Counter ${s.customCounters.length + 1}`, value: 0 }] }))}>
            <Text style={styles.addText}>+ Add counter</Text>
          </Pressable>
        </ScrollView>

        <Pressable style={styles.eliminate} onPress={onEliminate}>
          <Text style={styles.eliminateText}>{seat.alive ? '☠ Eliminate player' : '↺ Bring back'}</Text>
        </Pressable>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: { backgroundColor: '#111827', borderTopLeftRadius: 24, borderTopRightRadius: 24, borderColor: '#1e2d47', borderWidth: 1, padding: 20, paddingBottom: 28 },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#1e2d47', alignSelf: 'center', marginBottom: 14 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 },
  dot: { width: 14, height: 14, borderRadius: 7 },
  nameInput: { flex: 1, color: '#f1f5f9', fontSize: 18, fontWeight: '700', paddingVertical: 4 },
  section: { color: '#94a3b8', fontSize: 12, fontWeight: '800', marginTop: 16, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  swatch: { width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderColor: 'transparent' },
  swatchSel: { borderColor: '#f8fafc' },
  swatchDefault: { height: 30, paddingHorizontal: 12, borderRadius: 15, backgroundColor: '#1a2235', borderWidth: 2, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  swatchDefaultTxt: { color: '#cbd5e1', fontSize: 12, fontWeight: '700' },
  deckRow: { gap: 8, paddingVertical: 2 },
  deckChip: { maxWidth: 170, backgroundColor: '#1a2235', borderColor: '#1e2d47', borderWidth: 1, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999 },
  deckChipActive: { borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.08)' },
  deckChipTxt: { color: '#cbd5e1', fontWeight: '600', fontSize: 13 },
  errTxt: { color: '#fca5a5', fontSize: 13, marginVertical: 8 },
  searchRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  search: { flex: 1, backgroundColor: '#1a2235', borderColor: '#1e2d47', borderWidth: 1, color: '#f1f5f9', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, fontSize: 14 },
  clearArt: { backgroundColor: '#1a2235', borderColor: '#1e2d47', borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12 },
  clearArtTxt: { color: '#94a3b8', fontWeight: '700', fontSize: 13 },
  artRow: { gap: 8, paddingVertical: 10 },
  art: { width: 92, height: 66, borderRadius: 8, borderWidth: 2, borderColor: 'transparent' },
  artSel: { borderColor: '#f59e0b' },
  noArt: { color: '#64748b', fontSize: 13, marginVertical: 10 },
  tokenRow: { flexDirection: 'row', gap: 8 },
  token: { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: '#1a2235', borderColor: '#1e2d47', borderWidth: 1 },
  tokenOn: { borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.12)' },
  tokenIcon: { fontSize: 20, marginBottom: 3 },
  tokenLbl: { color: '#cbd5e1', fontSize: 11, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomColor: 'rgba(30,45,71,0.5)', borderBottomWidth: 1 },
  rowIcon: { color: '#94a3b8', fontSize: 18, width: 28 },
  rowLabel: { color: '#f1f5f9', fontSize: 15, flex: 1 },
  customLabel: { borderBottomColor: '#1e2d47', borderBottomWidth: 1, paddingVertical: 2 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  stepBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#1a2235', borderColor: '#1e2d47', borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  stepTxt: { color: '#f1f5f9', fontSize: 22, fontWeight: '600' },
  stepVal: { color: '#f1f5f9', fontSize: 20, fontWeight: '800', minWidth: 28, textAlign: 'center' },
  addBtn: { paddingVertical: 14, alignItems: 'center' },
  addText: { color: '#a78bfa', fontWeight: '600', fontSize: 14 },
  eliminate: { marginTop: 12, paddingVertical: 13, borderRadius: 12, alignItems: 'center', backgroundColor: 'rgba(239,68,68,0.12)', borderColor: 'rgba(239,68,68,0.4)', borderWidth: 1 },
  eliminateText: { color: '#fca5a5', fontWeight: '700', fontSize: 14 },
  close: { alignItems: 'center', marginTop: 10, paddingVertical: 8 },
  closeText: { color: '#94a3b8', fontWeight: '600', fontSize: 14 },
});
