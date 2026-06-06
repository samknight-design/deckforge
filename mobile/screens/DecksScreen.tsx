import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { getDecks, shareDeck, type Deck } from '../lib/db';
import { useTheme, BRACKET_COLORS, BRACKET_NAMES } from '../lib/theme';
import DeckPickerSheet from '../components/DeckPickerSheet';
import { tryCompleteChallenge } from '../lib/challenges';
import { useXpToast } from '../lib/xpToast';

type ViewMode = 'list' | 'compact' | 'tiled';

export default function DecksScreen({
  userId,
  onBack,
  onOpenDeck,
}: {
  userId: string;
  onBack: () => void;
  onOpenDeck: (deck: Deck) => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { showXp } = useXpToast();

  const [decks, setDecks] = useState<Deck[] | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [sharingId, setSharingId] = useState<string | null>(null);

  const load = useCallback(() => {
    setDecks(null);
    getDecks(userId).then(setDecks).catch(() => setDecks([]));
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  const handleShare = async (deck: Deck) => {
    if (deck.bracket == null) {
      Alert.alert('No bracket assigned', 'Run AI Insights first to assign a bracket before sharing.');
      return;
    }
    setSharingId(deck.id);
    try {
      const token = deck.share_token || (await shareDeck(deck.id));
      await Share.share({ message: `Check out my deck "${deck.name}" on DeckForge!`, url: `https://deckforge-eta.vercel.app/d/${token}` });
      tryCompleteChallenge(userId, 'share_deck').then((r) => {
        if (r.justCompleted) showXp(r.xpEarned, 'Community Share complete!');
      });
    } catch {
      Alert.alert('Share failed', 'Could not generate a share link.');
    } finally {
      setSharingId(null);
      load();
    }
  };

  const renderListItem = (item: Deck) => {
    const bracketColor = item.bracket ? (BRACKET_COLORS[item.bracket] || colors.textDim) : null;
    return (
      <Pressable style={styles.deckCard} onPress={() => onOpenDeck(item)}>
        {item.commander_image_url ? (
          <Image source={{ uri: item.commander_image_url }} style={styles.deckArt} resizeMode="cover" />
        ) : (
          <View style={[styles.deckArt, styles.deckArtPh]}>
            <Text style={{ fontSize: 24 }}>🃏</Text>
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={styles.deckName} numberOfLines={1}>{item.name}</Text>
          <View style={styles.deckMetaRow}>
            <Text style={styles.deckMeta}>
              {item.format === 'commander' ? 'Commander' : '60-Card'} · {item.card_count ?? 0} cards
            </Text>
            {item.commander_name && (
              <Text style={styles.deckCommander} numberOfLines={1}> · {item.commander_name}</Text>
            )}
          </View>
        </View>
        <View style={styles.deckActions}>
          {bracketColor ? (
            <View style={[styles.bracketPill, { borderColor: bracketColor }]}>
              <Text style={[styles.bracketPillText, { color: bracketColor }]}>B{item.bracket}</Text>
            </View>
          ) : (
            <View style={[styles.bracketPill, { borderColor: colors.border }]}>
              <Text style={[styles.bracketPillText, { color: colors.textDim }]}>—</Text>
            </View>
          )}
          <Pressable
            style={styles.shareBtn}
            onPress={() => handleShare(item)}
            disabled={sharingId === item.id}
          >
            <Text style={styles.shareBtnText}>{item.is_public ? '🔗' : '↑'}</Text>
          </Pressable>
          <Text style={styles.chevron}>›</Text>
        </View>
      </Pressable>
    );
  };

  const renderCompactItem = (item: Deck) => {
    const bracketColor = item.bracket ? (BRACKET_COLORS[item.bracket] || colors.textDim) : null;
    return (
      <Pressable style={styles.compactCard} onPress={() => onOpenDeck(item)}>
        <View style={{ flex: 1 }}>
          <Text style={styles.compactName} numberOfLines={1}>{item.name}</Text>
          <Text style={styles.compactMeta}>
            {item.format === 'commander' ? 'CMD' : '60'} · {item.card_count ?? 0}
            {item.commander_name ? ` · ${item.commander_name}` : ''}
          </Text>
        </View>
        {bracketColor && (
          <View style={[styles.bracketPill, { borderColor: bracketColor }]}>
            <Text style={[styles.bracketPillText, { color: bracketColor }]}>B{item.bracket}</Text>
          </View>
        )}
        <Text style={[styles.chevron, { fontSize: 18 }]}>›</Text>
      </Pressable>
    );
  };

  const renderTiledItem = (item: Deck) => {
    const bracketColor = item.bracket ? (BRACKET_COLORS[item.bracket] || colors.textDim) : null;
    return (
      <Pressable style={styles.tiledCard} onPress={() => onOpenDeck(item)}>
        {item.commander_image_url ? (
          <Image source={{ uri: item.commander_image_url }} style={styles.tiledArt} resizeMode="cover" />
        ) : (
          <View style={[styles.tiledArt, styles.deckArtPh]}><Text style={{ fontSize: 32 }}>🃏</Text></View>
        )}
        <View style={styles.tiledBody}>
          <Text style={styles.tiledName} numberOfLines={2}>{item.name}</Text>
          <Text style={styles.tiledMeta}>{item.card_count ?? 0} cards</Text>
          {bracketColor && (
            <View style={[styles.bracketPill, { borderColor: bracketColor, alignSelf: 'flex-start', marginTop: 4 }]}>
              <Text style={[styles.bracketPillText, { color: bracketColor }]}>B{item.bracket} {BRACKET_NAMES[item.bracket!]}</Text>
            </View>
          )}
        </View>
      </Pressable>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <Pressable style={styles.iconBtn} onPress={onBack}>
          <Text style={styles.iconBtnText}>← Home</Text>
        </Pressable>
        <Text style={styles.topTitle}>My Decks</Text>
        <Pressable style={styles.iconBtn} onPress={() => setShowCreate(true)}>
          <Text style={styles.iconBtnText}>+ New</Text>
        </Pressable>
      </View>

      {/* View mode toggle */}
      <View style={styles.viewToggle}>
        {(['list', 'compact', 'tiled'] as ViewMode[]).map((m) => (
          <Pressable
            key={m}
            style={[styles.viewBtn, viewMode === m && styles.viewBtnActive]}
            onPress={() => setViewMode(m)}
          >
            <Text style={[styles.viewBtnText, viewMode === m && { color: colors.accent }]}>
              {m === 'list' ? '☰ List' : m === 'compact' ? '≡ Compact' : '⊞ Tiled'}
            </Text>
          </Pressable>
        ))}
      </View>

      {decks === null ? (
        <View style={styles.center}><ActivityIndicator color={colors.accent} /></View>
      ) : decks.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyEmoji}>🗂️</Text>
          <Text style={styles.emptyTitle}>No decks yet</Text>
          <Text style={styles.emptyBody}>Create a deck, then scan cards straight into it.</Text>
          <Pressable style={styles.primary} onPress={() => setShowCreate(true)}>
            <Text style={styles.primaryText}>✨ Create your first deck</Text>
          </Pressable>
        </View>
      ) : viewMode === 'tiled' ? (
        <FlatList
          data={decks}
          keyExtractor={(d) => d.id}
          numColumns={2}
          columnWrapperStyle={{ gap: 12 }}
          contentContainerStyle={{ padding: 16, gap: 12 }}
          renderItem={({ item }) => renderTiledItem(item)}
        />
      ) : (
        <FlatList
          data={decks}
          keyExtractor={(d) => d.id}
          contentContainerStyle={{ padding: 16, gap: 8 }}
          renderItem={({ item }) => viewMode === 'list' ? renderListItem(item) : renderCompactItem(item)}
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

const createStyles = (c: ReturnType<typeof import('../lib/theme').useTheme>['colors']) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg, paddingTop: 50 },
    topBar: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: 16, paddingBottom: 12,
      borderBottomColor: c.border, borderBottomWidth: 1,
    },
    topTitle: { color: c.text, fontWeight: '700', fontSize: 18 },
    iconBtn: {
      backgroundColor: c.surface, borderColor: c.border, borderWidth: 1,
      paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20,
    },
    iconBtnText: { color: c.textMuted, fontSize: 13 },
    viewToggle: {
      flexDirection: 'row', gap: 6, paddingHorizontal: 16, paddingVertical: 10,
      borderBottomColor: c.border, borderBottomWidth: 1,
    },
    viewBtn: {
      paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999,
      backgroundColor: c.surface, borderColor: c.border, borderWidth: 1,
    },
    viewBtnActive: { borderColor: c.accent, backgroundColor: 'rgba(245,158,11,0.1)' },
    viewBtnText: { color: c.textMuted, fontSize: 12, fontWeight: '600' },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    emptyEmoji: { fontSize: 48, marginBottom: 12 },
    emptyTitle: { color: c.text, fontSize: 18, fontWeight: '700', marginBottom: 6 },
    emptyBody: { color: c.textMuted, textAlign: 'center', marginBottom: 20, maxWidth: 280 },
    primary: { backgroundColor: c.accent, paddingHorizontal: 24, paddingVertical: 14, borderRadius: 12 },
    primaryText: { color: c.accentText, fontWeight: '700' },
    // List view
    deckCard: {
      flexDirection: 'row', alignItems: 'center', gap: 12,
      backgroundColor: c.surface, borderColor: c.border, borderWidth: 1,
      borderRadius: 16, padding: 12,
    },
    deckArt: { width: 48, height: 48, borderRadius: 10 },
    deckArtPh: { backgroundColor: c.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
    deckName: { color: c.text, fontSize: 15, fontWeight: '600' },
    deckMetaRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 2 },
    deckMeta: { color: c.textMuted, fontSize: 11 },
    deckCommander: { color: c.textDim, fontSize: 11 },
    deckActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    bracketPill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 6, paddingVertical: 2 },
    bracketPillText: { fontSize: 10, fontWeight: '700' },
    shareBtn: {
      width: 28, height: 28, borderRadius: 14,
      backgroundColor: c.surfaceAlt, borderColor: c.border, borderWidth: 1,
      alignItems: 'center', justifyContent: 'center',
    },
    shareBtnText: { fontSize: 13 },
    chevron: { color: c.textDim, fontSize: 22 },
    // Compact view
    compactCard: {
      flexDirection: 'row', alignItems: 'center', gap: 10,
      paddingVertical: 10, paddingHorizontal: 12,
      backgroundColor: c.surface, borderColor: c.border, borderWidth: 1, borderRadius: 12,
    },
    compactName: { color: c.text, fontSize: 14, fontWeight: '600' },
    compactMeta: { color: c.textMuted, fontSize: 11, marginTop: 1 },
    // Tiled view
    tiledCard: {
      flex: 1, backgroundColor: c.surface, borderColor: c.border, borderWidth: 1, borderRadius: 16, overflow: 'hidden',
    },
    tiledArt: { width: '100%', height: 120 },
    tiledBody: { padding: 10 },
    tiledName: { color: c.text, fontSize: 13, fontWeight: '600', marginBottom: 2 },
    tiledMeta: { color: c.textMuted, fontSize: 11 },
  });
