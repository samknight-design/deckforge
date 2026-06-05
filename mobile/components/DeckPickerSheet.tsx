// Bottom-sheet modal for picking (or creating) a deck. Used by the scan result
// to add a matched card. Self-loads the user's decks on open.

import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { createDeck, getDecks, type Deck } from '../lib/db';

export default function DeckPickerSheet({
  userId,
  visible,
  onPick,
  onClose,
}: {
  userId: string;
  visible: boolean;
  onPick: (deck: Deck) => void;
  onClose: () => void;
}) {
  const [decks, setDecks] = useState<Deck[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newFormat, setNewFormat] = useState('commander');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setDecks(null);
    getDecks(userId).then(setDecks).catch(() => setDecks([]));
  }, [visible, userId]);

  const submitNewDeck = async () => {
    if (!newName.trim() || busy) return;
    setBusy(true);
    try {
      const deck = await createDeck(userId, newName, newFormat);
      onPick(deck);
      setNewName('');
      setCreating(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <Text style={styles.title}>Add to deck</Text>

        {creating ? (
          <View>
            <TextInput
              style={styles.input}
              placeholder="Deck name e.g. Atraxa Superfriends"
              placeholderTextColor="#475569"
              value={newName}
              onChangeText={setNewName}
              autoFocus
              editable={!busy}
            />
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
              {[
                { v: 'commander', label: 'Commander' },
                { v: '60card', label: '60-Card' },
              ].map((f) => (
                <Pressable
                  key={f.v}
                  style={[styles.formatChip, newFormat === f.v && styles.formatChipActive]}
                  onPress={() => setNewFormat(f.v)}
                >
                  <Text style={[styles.formatChipText, newFormat === f.v && { color: '#f59e0b' }]}>
                    {f.label}
                  </Text>
                </Pressable>
              ))}
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Pressable style={[styles.secondary, { flex: 1 }]} onPress={() => setCreating(false)} disabled={busy}>
                <Text style={styles.secondaryText}>Cancel</Text>
              </Pressable>
              <Pressable style={[styles.primary, { flex: 2 }]} onPress={submitNewDeck} disabled={busy || !newName.trim()}>
                <Text style={styles.primaryText}>{busy ? 'Creating…' : 'Create & add'}</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <>
            <Pressable style={styles.newDeckRow} onPress={() => setCreating(true)}>
              <Text style={styles.newDeckText}>✨ Create new deck</Text>
            </Pressable>
            {decks === null ? (
              <ActivityIndicator color="#f59e0b" style={{ marginVertical: 24 }} />
            ) : decks.length === 0 ? (
              <Text style={styles.empty}>No decks yet — create one above.</Text>
            ) : (
              <FlatList
                data={decks}
                keyExtractor={(d) => d.id}
                style={{ maxHeight: 320 }}
                renderItem={({ item }) => (
                  <Pressable style={styles.deckRow} onPress={() => onPick(item)}>
                    <Text style={styles.deckName} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <View style={styles.deckBadge}>
                      <Text style={styles.deckBadgeText}>
                        {item.format === 'commander' ? 'CMD' : '60'}
                      </Text>
                    </View>
                  </Pressable>
                )}
              />
            )}
            <Pressable style={[styles.secondary, { marginTop: 8 }]} onPress={onClose}>
              <Text style={styles.secondaryText}>Cancel</Text>
            </Pressable>
          </>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: {
    backgroundColor: '#111827',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderColor: '#1e2d47',
    borderWidth: 1,
    padding: 20,
    paddingBottom: 36,
  },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#1e2d47', alignSelf: 'center', marginBottom: 14 },
  title: { color: '#fff', fontSize: 18, fontWeight: '700', marginBottom: 14 },
  newDeckRow: { paddingVertical: 14, borderBottomColor: '#1e2d47', borderBottomWidth: 1, marginBottom: 4 },
  newDeckText: { color: '#a78bfa', fontWeight: '600', fontSize: 15 },
  deckRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomColor: 'rgba(30,45,71,0.5)',
    borderBottomWidth: 1,
  },
  deckName: { color: '#f1f5f9', fontSize: 15, flex: 1 },
  deckBadge: { backgroundColor: '#1a2235', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  deckBadgeText: { color: '#94a3b8', fontSize: 11, fontWeight: '700' },
  empty: { color: '#64748b', textAlign: 'center', marginVertical: 24 },
  input: {
    backgroundColor: '#1a2235',
    borderColor: '#1e2d47',
    borderWidth: 1,
    color: '#f1f5f9',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    marginBottom: 12,
    fontSize: 14,
  },
  formatChip: {
    flex: 1,
    backgroundColor: '#1a2235',
    borderColor: '#1e2d47',
    borderWidth: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  formatChipActive: { borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.12)' },
  formatChipText: { color: '#94a3b8', fontWeight: '600' },
  primary: { backgroundColor: '#f59e0b', paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  primaryText: { color: '#0a0e1a', fontWeight: '700' },
  secondary: {
    backgroundColor: '#1a2235',
    borderColor: '#1e2d47',
    borderWidth: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  secondaryText: { color: '#94a3b8', fontWeight: '500' },
});
