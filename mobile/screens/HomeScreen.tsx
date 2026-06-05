import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { getTopDecks, getLibraryStats, getProfile, toggleDeckLike, type PublicDeck, type Profile } from '../lib/db';
import { useTheme, xpToLevel, BRACKET_COLORS, BRACKET_NAMES } from '../lib/theme';

// Static news items — swap for a Supabase `news_items` table query later
const NEWS = [
  { id: '1', title: 'AI Insights upgraded', body: 'Bracket estimates are now more accurate with the new Claude model.', date: 'Jun 2026' },
  { id: '2', title: 'Community decks live', body: 'Share your decks and discover builds from other players.', date: 'Jun 2026' },
];

// Avatar placeholder map (emoji by key — replaced with real SVGs in future)
export const AVATAR_OPTIONS = [
  { key: 'wizard',   emoji: '🧙' },
  { key: 'dragon',   emoji: '🐉' },
  { key: 'knight',   emoji: '⚔️' },
  { key: 'mystic',   emoji: '🔮' },
  { key: 'eagle',    emoji: '🦅' },
  { key: 'moon',     emoji: '🌙' },
  { key: 'comet',    emoji: '☄️' },
  { key: 'castle',   emoji: '🏰' },
  { key: 'wave',     emoji: '🌊' },
  { key: 'storm',    emoji: '⚡' },
  { key: 'flame',    emoji: '🔥' },
  { key: 'forest',   emoji: '🌿' },
];

function getAvatar(key?: string | null, initial = 'U') {
  const found = AVATAR_OPTIONS.find((a) => a.key === key);
  return found ? found.emoji : initial;
}

export default function HomeScreen({
  userId,
  onOpenDeck,
  onGoToLibrary,
  onGoToScan,
  onGoToDeckSearch,
}: {
  userId: string;
  onOpenDeck: (deck: PublicDeck) => void;
  onGoToLibrary: () => void;
  onGoToScan: () => void;
  onGoToDeckSearch: () => void;
}) {
  const { colors, formatPrice } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [profile, setProfile] = useState<Profile | null>(null);
  const [topDecks, setTopDecks] = useState<PublicDeck[] | null>(null);
  const [stats, setStats] = useState<{ totalCards: number; totalValue: number } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const [newsExpanded, setNewsExpanded] = useState(false);

  const load = useCallback(async () => {
    const [p, d, s] = await Promise.all([
      getProfile(userId).catch(() => null),
      getTopDecks(8).catch(() => []),
      getLibraryStats(userId).catch(() => ({ totalCards: 0, totalValue: 0 })),
    ]);
    setProfile(p);
    setTopDecks(d);
    setStats(s);
  }, [userId]);

  useEffect(() => { load(); }, [load]);

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
    setTopDecks((prev) => (prev || []).map((d) =>
      d.id === deck.id ? { ...d, like_count: Math.max(0, (d.like_count || 0) + (wasLiked ? -1 : 1)) } : d
    ));
    await toggleDeckLike(userId, deck.id).catch(() => {
      // revert on error
      setLikedIds((prev) => {
        const next = new Set(prev);
        wasLiked ? next.add(deck.id) : next.delete(deck.id);
        return next;
      });
    });
  };

  const levelInfo = profile ? xpToLevel(profile.xp || 0) : null;
  const avatarDisplay = profile?.avatar_key
    ? getAvatar(profile.avatar_key)
    : (profile?.username || 'U')[0].toUpperCase();
  const avatarIsEmoji = !!profile?.avatar_key;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
    >
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>Good scanning,</Text>
          <Text style={styles.username}>{profile?.username || 'Summoner'}</Text>
        </View>
        <View style={styles.avatar}>
          <Text style={[styles.avatarText, avatarIsEmoji && { fontSize: 26 }]}>{avatarDisplay}</Text>
        </View>
      </View>

      {/* XP bar */}
      {levelInfo && (
        <View style={styles.xpCard}>
          <View style={styles.xpRow}>
            <Text style={styles.xpLevel}>Level {levelInfo.level}</Text>
            <Text style={styles.xpValue}>{levelInfo.progress} / {levelInfo.needed} XP</Text>
          </View>
          <View style={styles.xpTrack}>
            <View style={[styles.xpFill, { width: `${Math.min(100, (levelInfo.progress / levelInfo.needed) * 100)}%` as any }]} />
          </View>
        </View>
      )}

      {/* Quick actions */}
      <View style={styles.quickRow}>
        <Pressable style={styles.quickCard} onPress={onGoToScan}>
          <Text style={styles.quickIcon}>📷</Text>
          <Text style={styles.quickLabel}>Scan card</Text>
        </Pressable>
        <Pressable style={styles.quickCard} onPress={onGoToLibrary}>
          <Text style={styles.quickIcon}>📚</Text>
          <Text style={styles.quickLabel}>My library</Text>
          {stats && stats.totalCards > 0 && (
            <Text style={styles.quickSub}>{stats.totalCards} cards</Text>
          )}
        </Pressable>
        <Pressable style={styles.quickCard} onPress={onGoToDeckSearch}>
          <Text style={styles.quickIcon}>🌐</Text>
          <Text style={styles.quickLabel}>Community</Text>
        </Pressable>
      </View>

      {/* Library value banner */}
      {stats && stats.totalValue > 0 && (
        <View style={styles.valueBanner}>
          <Text style={styles.valueBannerLabel}>Collection value</Text>
          <Text style={styles.valueBannerAmount}>{formatPrice(stats.totalValue)}</Text>
        </View>
      )}

      {/* News widget */}
      <Pressable style={styles.newsHeader} onPress={() => setNewsExpanded((e) => !e)}>
        <Text style={styles.sectionTitle}>📰 App Updates</Text>
        <Text style={[styles.sectionTitle, { fontSize: 13 }]}>{newsExpanded ? '▲' : '▼'}</Text>
      </Pressable>
      {newsExpanded && NEWS.map((n) => (
        <View key={n.id} style={styles.newsCard}>
          <View style={styles.newsTopRow}>
            <Text style={styles.newsTitle}>{n.title}</Text>
            <Text style={styles.newsDate}>{n.date}</Text>
          </View>
          <Text style={styles.newsBody}>{n.body}</Text>
        </View>
      ))}

      {/* Top decks */}
      <View style={styles.sectionRow}>
        <Text style={styles.sectionTitle}>🔥 Top Decks</Text>
        <Pressable onPress={onGoToDeckSearch}>
          <Text style={styles.seeAll}>See all →</Text>
        </Pressable>
      </View>
      {topDecks === null ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 16 }} />
      ) : topDecks.length === 0 ? (
        <Text style={styles.emptyText}>No public decks yet — be the first to share one!</Text>
      ) : (
        topDecks.map((deck) => {
          const bracketColor = deck.bracket ? (BRACKET_COLORS[deck.bracket] || null) : null;
          const liked = likedIds.has(deck.id);
          return (
            <Pressable key={deck.id} style={styles.deckCard} onPress={() => onOpenDeck(deck)}>
              {deck.commander_image_url ? (
                <Image source={{ uri: deck.commander_image_url }} style={styles.deckArt} resizeMode="cover" />
              ) : (
                <View style={[styles.deckArt, styles.deckArtPh]}>
                  <Text style={{ fontSize: 20 }}>🃏</Text>
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.deckName} numberOfLines={1}>{deck.name}</Text>
                <View style={styles.deckMetaRow}>
                  <Text style={styles.deckMeta}>
                    {deck.format === 'commander' ? 'Commander' : '60-Card'}
                    {deck.card_count ? ` · ${deck.card_count}` : ''}
                    {deck.profiles?.username ? ` · ${deck.profiles.username}` : ''}
                  </Text>
                  {bracketColor && (
                    <View style={[styles.bracketPill, { borderColor: bracketColor }]}>
                      <Text style={[styles.bracketPillText, { color: bracketColor }]}>B{deck.bracket}</Text>
                    </View>
                  )}
                </View>
              </View>
              <Pressable style={styles.likeBtn} onPress={() => handleLike(deck)}>
                <Text style={[styles.likeIcon, liked && { color: colors.danger }]}>♥</Text>
                {deck.like_count ? <Text style={styles.likeCount}>{deck.like_count}</Text> : null}
              </Pressable>
            </Pressable>
          );
        })
      )}

      <View style={{ height: 100 }} />
    </ScrollView>
  );
}

const createStyles = (c: ReturnType<typeof import('../lib/theme').useTheme>['colors']) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },
    content: { padding: 20, paddingTop: 60 },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
    greeting: { color: c.textMuted, fontSize: 13 },
    username: { color: c.text, fontSize: 22, fontWeight: '700' },
    avatar: {
      width: 44, height: 44, borderRadius: 22,
      backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center',
    },
    avatarText: { color: c.accentText, fontSize: 18, fontWeight: '700' },
    xpCard: {
      backgroundColor: c.surface, borderColor: c.border, borderWidth: 1,
      borderRadius: 16, padding: 14, marginBottom: 14,
    },
    xpRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
    xpLevel: { color: c.text, fontWeight: '700', fontSize: 13 },
    xpValue: { color: c.textMuted, fontSize: 12 },
    xpTrack: { height: 6, borderRadius: 3, backgroundColor: c.surfaceAlt },
    xpFill: { height: 6, borderRadius: 3, backgroundColor: c.accent },
    quickRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
    quickCard: {
      flex: 1, backgroundColor: c.surface, borderColor: c.border, borderWidth: 1,
      borderRadius: 16, padding: 14, alignItems: 'center',
    },
    quickIcon: { fontSize: 24, marginBottom: 4 },
    quickLabel: { color: c.text, fontWeight: '600', fontSize: 12 },
    quickSub: { color: c.textMuted, fontSize: 10, marginTop: 2 },
    valueBanner: {
      backgroundColor: c.surfaceAlt, borderColor: c.border, borderWidth: 1,
      borderRadius: 16, padding: 14, flexDirection: 'row',
      justifyContent: 'space-between', alignItems: 'center', marginBottom: 20,
    },
    valueBannerLabel: { color: c.textMuted, fontSize: 13 },
    valueBannerAmount: { color: c.success, fontWeight: '700', fontSize: 20 },
    newsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
    newsCard: {
      backgroundColor: c.surface, borderColor: c.border, borderWidth: 1,
      borderRadius: 14, padding: 12, marginBottom: 8,
    },
    newsTopRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
    newsTitle: { color: c.text, fontWeight: '600', fontSize: 13 },
    newsDate: { color: c.textDim, fontSize: 11 },
    newsBody: { color: c.textMuted, fontSize: 12, lineHeight: 18 },
    sectionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, marginTop: 8 },
    sectionTitle: { color: c.text, fontWeight: '700', fontSize: 16 },
    seeAll: { color: c.accent, fontSize: 13, fontWeight: '600' },
    emptyText: { color: c.textMuted, fontSize: 13, textAlign: 'center', paddingVertical: 20 },
    deckCard: {
      flexDirection: 'row', alignItems: 'center', gap: 12,
      backgroundColor: c.surface, borderColor: c.border, borderWidth: 1,
      borderRadius: 16, padding: 12, marginBottom: 10,
    },
    deckArt: { width: 44, height: 44, borderRadius: 10 },
    deckArtPh: { backgroundColor: c.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
    deckName: { color: c.text, fontSize: 15, fontWeight: '600' },
    deckMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2, flexWrap: 'wrap' },
    deckMeta: { color: c.textMuted, fontSize: 11 },
    bracketPill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 5, paddingVertical: 1 },
    bracketPillText: { fontSize: 10, fontWeight: '700' },
    likeBtn: { alignItems: 'center', paddingLeft: 4 },
    likeIcon: { color: c.textDim, fontSize: 18 },
    likeCount: { color: c.textMuted, fontSize: 10, marginTop: 1 },
  });
