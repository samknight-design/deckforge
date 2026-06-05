// Deck detail — lists the cards in a deck with image, type, price. Tapping
// "Scan into this deck" jumps to the scanner with this deck pre-selected.

import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { getDeckCards, type Deck, type DeckCard } from '../lib/db';

export default function DeckDetailScreen({
  deck,
  onBack,
  onScanInto,
}: {
  deck: Deck;
  onBack: () => void;
  onScanInto: (deck: Deck) => void;
}) {
  const [cards, setCards] = useState<DeckCard[] | null>(null);

  const load = useCallback(() => {
    setCards(null);
    getDeckCards(deck.id).then(setCards).catch(() => setCards([]));
  }, [deck.id]);

  useEffect(() => { load(); }, [load]);

  const totalCards = (cards || []).reduce((s, c) => s + (c.quantity || 1), 0);
  const totalValue = (cards || []).reduce((s, c) => s + (c.price_eur || 0) * (c.quantity || 1), 0);

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <Pressable style={styles.iconButton} onPress={onBack}>
          <Text style={styles.iconButtonText}>← Decks</Text>
        </Pressable>
        <Text style={styles.topTitle} numberOfLines={1}>{deck.name}</Text>
        <View style={{ width: 64 }} />
      </View>

      <View style={styles.statsRow}>
        <Text style={styles.stat}>{totalCards} cards</Text>
        <Text style={styles.statDim}>·</Text>
        <Text style={styles.stat}>{deck.format === 'commander' ? 'Commander' : '60-Card'}</Text>
        {totalValue > 0 && (
          <>
            <Text style={styles.statDim}>·</Text>
            <Text style={styles.statValue}>€{totalValue.toFixed(2)}</Text>
          </>
        )}
      </View>

      {cards === null ? (
        <View style={styles.center}><ActivityIndicator color="#f59e0b" /></View>
      ) : cards.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyEmoji}>🃏</Text>
          <Text style={styles.emptyBody}>No cards yet. Scan some in!</Text>
        </View>
      ) : (
        <FlatList
          data={cards}
          keyExtractor={(c) => c.id}
          contentContainerStyle={{ padding: 12, paddingBottom: 96 }}
          renderItem={({ item }) => (
            <View style={styles.cardRow}>
              {item.image_uri ? (
                <Image source={{ uri: item.image_uri }} style={styles.cardThumb} resizeMode="cover" />
              ) : (
                <View style={[styles.cardThumb, styles.thumbPlaceholder]}><Text>🃏</Text></View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.cardName} numberOfLines={1}>
                  {item.quantity > 1 ? `${item.quantity}× ` : ''}{item.card_name}
                  {item.is_foil ? ' ✦' : ''}
                </Text>
                {!!item.type_line && <Text style={styles.cardMeta} numberOfLines={1}>{item.type_line}</Text>}
                {!!item.set_name && <Text style={styles.cardSet} numberOfLines={1}>{item.set_name}</Text>}
              </View>
              {item.price_eur != null && (
                <Text style={styles.cardPrice}>€{Number(item.price_eur).toFixed(2)}</Text>
              )}
            </View>
          )}
        />
      )}

      <View style={styles.bottomBar}>
        <Pressable style={styles.scanButton} onPress={() => onScanInto(deck)}>
          <Text style={styles.scanButtonText}>📷 Scan into this deck</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0e1a', paddingTop: 50 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  topTitle: { color: '#fff', fontWeight: '700', fontSize: 17, flex: 1, textAlign: 'center' },
  iconButton: {
    backgroundColor: '#111827',
    borderColor: '#1e2d47',
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
  },
  iconButtonText: { color: '#f1f5f9', fontSize: 13 },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 10,
    borderBottomColor: '#1e2d47',
    borderBottomWidth: 1,
  },
  stat: { color: '#94a3b8', fontSize: 13 },
  statDim: { color: '#475569' },
  statValue: { color: '#10b981', fontSize: 13, fontWeight: '600' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyEmoji: { fontSize: 44, marginBottom: 10 },
  emptyBody: { color: '#94a3b8' },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
    borderBottomColor: 'rgba(30,45,71,0.5)',
    borderBottomWidth: 1,
  },
  cardThumb: { width: 36, height: 50, borderRadius: 5, backgroundColor: '#1a2235' },
  thumbPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  cardName: { color: '#f1f5f9', fontSize: 14, fontWeight: '500' },
  cardMeta: { color: '#64748b', fontSize: 12, marginTop: 2 },
  cardSet: { color: '#475569', fontSize: 11, marginTop: 1 },
  cardPrice: { color: '#10b981', fontSize: 13, fontWeight: '600' },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 16,
    paddingBottom: 28,
    backgroundColor: 'rgba(10,14,26,0.95)',
    borderTopColor: '#1e2d47',
    borderTopWidth: 1,
  },
  scanButton: { backgroundColor: '#f59e0b', paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  scanButtonText: { color: '#0a0e1a', fontWeight: '700', fontSize: 15 },
});
