// Community deck search. Accessible from the Home screen "Community" quick-action
// and the "See all →" link on the Top Decks feed.
// Shows public decks ordered by likes; filterable by name/format. Users can like
// any deck from here too.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { searchPublicDecks, toggleDeckLike, type PublicDeck } from '../lib/db';
import { useTheme, BRACKET_COLORS, BRACKET_NAMES } from '../lib/theme';
import { tryCompleteChallenge } from '../lib/challenges';
import { useXpToast } from '../lib/xpToast';

type FormatFilter = 'all' | 'commander' | '60card';

export default function DeckSearchScreen({
  userId,
  onBack,
  onOpenDeck,
}: {
  userId: string;
  onBack: () => void;
  onOpenDeck: (deck: PublicDeck) => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { showXp } = useXpToast();

  const [query, setQuery] = useState('');
  const [format, setFormat] = useState<FormatFilter>('all');
  const [decks, setDecks] = useState<PublicDeck[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    const fmtParam = format === 'all' ? undefined : format;
    const results = await searchPublicDecks(query, fmtParam).catch(() => []);
    setDecks(results);
  }, [query, format]);

  useEffect(() => {
    const t = setTimeout(load, query ? 400 : 0);
    return () => clearTimeout(t);
  }, [load, query]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const handleLike = async (deck: PublicDeck) => {
    const wasLiked = likedIds.has(deck.id);
    setLikedIds((prev) => {
      const next = new Set(prev);
      wasLiked ? next.delete(deck.id) : next.add(deck.id);
      return next;
    });
    setDecks((prev) => (prev || []).map((d) =>
      d.id === deck.id ? { ...d, like_count: Math.max(0, (d.like_count || 0) + (wasLiked ? -1 : 1)) } : d
    ));
    await toggleDeckLike(userId, deck.id).then(() => {
      if (!wasLiked) {
        tryCompleteChallenge(userId, 'like_decks').then((r) => {
          if (r.justCompleted) showXp(r.xpEarned, 'Community Spirit complete!');
        });
      }
    }).catch(() => {
      setLikedIds((prev) => {
        const next = new Set(prev);
        wasLiked ? next.add(deck.id) : next.delete(deck.id);
        return next;
      });
    });
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={onBack}>
          <Text style={styles.backBtnText}>← Home</Text>
        </Pressable>
        <Text style={styles.title}>Community Decks</Text>
        <View style={{ width: 70 }} />
      </View>

      {/* Search bar */}
      <View style={styles.searchWrap}>
        <Text style={styles.searchIcon}>🔍</Text>
        <TextInput
          style={styles.searchInput}
          placeholder="Search decks…"
          placeholderTextColor={colors.textDim}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {!!query && (
          <Pressable onPress={() => setQuery('')} style={styles.clearBtn}>
            <Text style={styles.clearBtnText}>✕</Text>
          </Pressable>
        )}
      </View>

      {/* Format filter */}
      <View style={styles.filterRow}>
        {(['all', 'commander', '60card'] as FormatFilter[]).map((f) => (
          <Pressable
            key={f}
            style={[styles.filterChip, format === f && styles.filterChipActive]}
            onPress={() => setFormat(f)}
          >
            <Text style={[styles.filterChipText, format === f && { color: colors.accent }]}>
              {f === 'all' ? 'All' : f === 'commander' ? 'Commander' : '60-Card'}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Deck list */}
      {decks === null ? (
        <View style={styles.center}><ActivityIndicator color={colors.accent} /></View>
      ) : decks.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyIcon}>🌐</Text>
          <Text style={styles.emptyTitle}>No decks found</Text>
          <Text style={styles.emptyBody}>
            {query ? `No results for "${query}"` : 'No public decks yet. Share yours first!'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={decks}
          keyExtractor={(d) => d.id}
          contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
          renderItem={({ item }) => {
            const bracketColor = item.bracket ? (BRACKET_COLORS[item.bracket] || null) : null;
            const liked = likedIds.has(item.id);
            return (
              <Pressable style={styles.deckCard} onPress={() => onOpenDeck(item)}>
                {item.commander_image_url ? (
                  <Image source={{ uri: item.commander_image_url }} style={styles.deckArt} resizeMode="cover" />
                ) : (
                  <View style={[styles.deckArt, styles.deckArtPh]}>
                    <Text style={{ fontSize: 22 }}>🃏</Text>
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={styles.deckName} numberOfLines={1}>{item.name}</Text>
                  <View style={styles.deckMetaRow}>
                    <Text style={styles.deckMeta}>
                      {item.format === 'commander' ? 'Commander' : '60-Card'}
                      {item.card_count ? ` · ${item.card_count}` : ''}
                      {item.profiles?.username ? ` · ${item.profiles.username}` : ''}
                    </Text>
                    {bracketColor && (
                      <View style={[styles.bracketPill, { borderColor: bracketColor }]}>
                        <Text style={[styles.bracketPillText, { color: bracketColor }]}>
                          B{item.bracket} {BRACKET_NAMES[item.bracket!]}
                        </Text>
                      </View>
                    )}
                  </View>
                  {item.commander_name && (
                    <Text style={styles.commander} numberOfLines={1}>⚔ {item.commander_name}</Text>
                  )}
                </View>
                <Pressable style={styles.likeBtn} onPress={() => handleLike(item)}>
                  <Text style={[styles.likeIcon, liked && { color: colors.danger }]}>♥</Text>
                  {(item.like_count ?? 0) > 0 && (
                    <Text style={styles.likeCount}>{item.like_count}</Text>
                  )}
                </Pressable>
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

const createStyles = (c: ReturnType<typeof import('../lib/theme').useTheme>['colors']) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },
    header: {
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      paddingHorizontal: 16, paddingTop: 56, paddingBottom: 12,
      borderBottomColor: c.border, borderBottomWidth: 1,
    },
    title: { color: c.text, fontSize: 18, fontWeight: '700' },
    backBtn: {
      backgroundColor: c.surface, borderColor: c.border, borderWidth: 1,
      paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20,
    },
    backBtnText: { color: c.textMuted, fontSize: 13 },
    searchWrap: {
      flexDirection: 'row', alignItems: 'center',
      backgroundColor: c.surface, borderColor: c.border, borderWidth: 1,
      borderRadius: 12, marginHorizontal: 16, marginTop: 12, marginBottom: 4,
      paddingHorizontal: 12,
    },
    searchIcon: { fontSize: 14, marginRight: 8 },
    searchInput: { flex: 1, color: c.text, fontSize: 14, paddingVertical: 10 },
    clearBtn: { padding: 4 },
    clearBtnText: { color: c.textMuted, fontSize: 13 },
    filterRow: {
      flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 8,
      borderBottomColor: c.border, borderBottomWidth: 1,
    },
    filterChip: {
      paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999,
      backgroundColor: c.surface, borderColor: c.border, borderWidth: 1,
    },
    filterChipActive: { borderColor: c.accent, backgroundColor: 'rgba(245,158,11,0.1)' },
    filterChipText: { color: c.textMuted, fontSize: 13, fontWeight: '600' },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    emptyIcon: { fontSize: 48, marginBottom: 12 },
    emptyTitle: { color: c.text, fontSize: 18, fontWeight: '700', marginBottom: 8 },
    emptyBody: { color: c.textMuted, textAlign: 'center', maxWidth: 280 },
    deckCard: {
      flexDirection: 'row', alignItems: 'center', gap: 12,
      backgroundColor: c.surface, borderColor: c.border, borderWidth: 1,
      borderRadius: 16, padding: 12, marginBottom: 10,
    },
    deckArt: { width: 48, height: 48, borderRadius: 10 },
    deckArtPh: { backgroundColor: c.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
    deckName: { color: c.text, fontSize: 15, fontWeight: '600' },
    deckMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2, flexWrap: 'wrap' },
    deckMeta: { color: c.textMuted, fontSize: 11 },
    bracketPill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 6, paddingVertical: 1 },
    bracketPillText: { fontSize: 10, fontWeight: '700' },
    commander: { color: c.accent, fontSize: 11, marginTop: 2 },
    likeBtn: { alignItems: 'center', paddingLeft: 4 },
    likeIcon: { color: c.textDim, fontSize: 20 },
    likeCount: { color: c.textMuted, fontSize: 10, marginTop: 1 },
  });
