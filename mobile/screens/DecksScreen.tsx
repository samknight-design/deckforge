// Deck list screen. Shows the user's decks; tap to open detail; create new.

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
import { getDecks, type Deck } from '../lib/db';
import DeckPickerSheet from '../components/DeckPickerSheet';

export default function DecksScreen({
  userId,
  onBack,
  onOpenDeck,
}: {
  userId: string;
  onBack: () => void;
  onOpenDeck: (deck: Deck) => void;
}) {
  const [decks, setDecks] = useState<Deck[] | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(() => {
    setDecks(null);
    getDecks(userId).then(setDecks).catch(() => setDecks([]));
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <Pressable style={styles.iconButton} onPress={onBack}>
          <Text style={styles.iconButtonText}>← Home</Text>
        </Pressable>
        <Text style={styles.topTitle}>My Decks</Text>
        <Pressable style={styles.iconButton} onPress={() => setShowCreate(true)}>
          <Text style={styles.iconButtonText}>+ New</Text>
        </Pressable>
      </View>

      {decks === null ? (
        <View style={styles.center}>
          <ActivityIndicator color="#f59e0b" />
        </View>
      ) : decks.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyEmoji}>🗂️</Text>
          <Text style={styles.emptyTitle}>No decks yet</Text>
          <Text style={styles.emptyBody}>Create a deck, then scan cards straight into it.</Text>
          <Pressable style={styles.primary} onPress={() => setShowCreate(true)}>
            <Text style={styles.primaryText}>✨ Create your first deck</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={decks}
          keyExtractor={(d) => d.id}
          contentContainerStyle={{ padding: 16 }}
          renderItem={({ item }) => (
            <Pressable style={styles.deckCard} onPress={() => onOpenDeck(item)}>
              {item.commander_image_url ? (
                <Image source={{ uri: item.commander_image_url }} style={styles.deckArt} resizeMode="cover" />
              ) : (
                <View style={[styles.deckArt, styles.deckArtPlaceholder]}>
                  <Text style={{ fontSize: 24 }}>🃏</Text>
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.deckName} numberOfLines={1}>{item.name}</Text>
                <Text style={styles.deckMeta}>
                  {item.format === 'commander' ? 'Commander' : '60-Card'} · {item.card_count ?? 0} cards
                </Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
          )}
        />
      )}

      <DeckPickerSheet
        userId={userId}
        visible={showCreate}
        onClose={() => setShowCreate(false)}
        onPick={(deck) => {
          setShowCreate(false);
          onOpenDeck(deck);
        }}
      />
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
    paddingBottom: 12,
    borderBottomColor: '#1e2d47',
    borderBottomWidth: 1,
  },
  topTitle: { color: '#fff', fontWeight: '700', fontSize: 18 },
  iconButton: {
    backgroundColor: '#111827',
    borderColor: '#1e2d47',
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
  },
  iconButtonText: { color: '#f1f5f9', fontSize: 13 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  emptyEmoji: { fontSize: 48, marginBottom: 12 },
  emptyTitle: { color: '#fff', fontSize: 18, fontWeight: '700', marginBottom: 6 },
  emptyBody: { color: '#94a3b8', textAlign: 'center', marginBottom: 20, maxWidth: 280 },
  deckCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#111827',
    borderColor: '#1e2d47',
    borderWidth: 1,
    borderRadius: 16,
    padding: 12,
    marginBottom: 10,
  },
  deckArt: { width: 48, height: 48, borderRadius: 10 },
  deckArtPlaceholder: { backgroundColor: '#1a2235', alignItems: 'center', justifyContent: 'center' },
  deckName: { color: '#f1f5f9', fontSize: 16, fontWeight: '600' },
  deckMeta: { color: '#64748b', fontSize: 12, marginTop: 2 },
  chevron: { color: '#475569', fontSize: 24 },
  primary: { backgroundColor: '#f59e0b', paddingHorizontal: 24, paddingVertical: 14, borderRadius: 12 },
  primaryText: { color: '#0a0e1a', fontWeight: '700' },
});
