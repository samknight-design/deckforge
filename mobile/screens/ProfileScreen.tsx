import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { getProfile, getLibraryStats, getDecks, updateProfile, type Profile } from '../lib/db';
import { useTheme, xpToLevel, BRACKET_COLORS } from '../lib/theme';
import { AVATAR_OPTIONS } from './HomeScreen';

const LEVEL_TITLES: Record<number, string> = {
  1: 'Apprentice', 5: 'Journeyman', 10: 'Adept',
  20: 'Expert', 30: 'Master', 50: 'Grand Master', 75: 'Legend', 100: 'Planeswalker',
};

function getLevelTitle(level: number): string {
  const thresholds = Object.keys(LEVEL_TITLES).map(Number).sort((a, b) => b - a);
  for (const t of thresholds) if (level >= t) return LEVEL_TITLES[t];
  return 'Apprentice';
}

// Level milestones that unlock rewards
const LEVEL_UNLOCKS = [
  { level: 1,  reward: '🌿 Forest avatar unlocked' },
  { level: 5,  reward: '⚔️ Knight avatar unlocked' },
  { level: 10, reward: '🔮 Mystic avatar unlocked' },
  { level: 15, reward: '🐉 Dragon avatar unlocked' },
  { level: 20, reward: '⚡ Storm avatar unlocked + Silver border' },
  { level: 30, reward: '🧙 Wizard avatar unlocked' },
  { level: 40, reward: '🦅 Eagle avatar unlocked + Gold border' },
  { level: 50, reward: '☄️ Comet avatar unlocked + Extra AI insight/mo' },
  { level: 75, reward: '🔥 Flame avatar unlocked + Diamond border' },
  { level: 100, reward: '🌊 Wave avatar unlocked + Planeswalker frame' },
];

const ACHIEVEMENTS = [
  { key: 'first_scan', label: 'First Scan', icon: '📷', desc: 'Scan your first card' },
  { key: 'deck_builder', label: 'Deck Builder', icon: '🗂️', desc: 'Create your first deck' },
  { key: 'card_collector', label: 'Collector', icon: '📚', desc: 'Library reaches 100 cards' },
  { key: 'insight_seeker', label: 'AI Student', icon: '🧠', desc: 'Generate first AI insight' },
  { key: 'social_butterfly', label: 'Social', icon: '♥', desc: 'Get 10 likes on a deck' },
];

export default function ProfileScreen({
  userId,
  onGoToSettings,
}: {
  userId: string;
  onGoToSettings: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [profile, setProfile] = useState<Profile | null>(null);
  const [stats, setStats] = useState<{ totalCards: number; totalValue: number } | null>(null);
  const [deckCount, setDeckCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showAvatarPicker, setShowAvatarPicker] = useState(false);

  const load = useCallback(async () => {
    const [p, s, d] = await Promise.all([
      getProfile(userId).catch(() => null),
      getLibraryStats(userId).catch(() => ({ totalCards: 0, totalValue: 0 })),
      getDecks(userId).then((ds) => ds.length).catch(() => 0),
    ]);
    setProfile(p);
    setStats(s);
    setDeckCount(d);
    setLoading(false);
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const handlePickAvatar = async (key: string) => {
    setShowAvatarPicker(false);
    setProfile((p) => p ? { ...p, avatar_key: key } : p);
    await updateProfile(userId, { avatar_key: key });
  };

  const levelInfo = profile ? xpToLevel(profile.xp || 0) : null;
  const level = levelInfo?.level || 1;

  const avatarDisplay = profile?.avatar_key
    ? AVATAR_OPTIONS.find((a) => a.key === profile.avatar_key)?.emoji || (profile?.username || 'U')[0].toUpperCase()
    : (profile?.username || 'U')[0].toUpperCase();
  const avatarIsEmoji = !!profile?.avatar_key;

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color={colors.accent} /></View>;
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
    >
      {/* Top bar */}
      <View style={styles.topBar}>
        <Text style={styles.screenTitle}>Profile</Text>
        <Pressable style={styles.settingsBtn} onPress={onGoToSettings}>
          <Text style={styles.settingsBtnText}>⚙️ Settings</Text>
        </Pressable>
      </View>

      {/* Avatar + name card */}
      <View style={styles.profileCard}>
        <Pressable style={styles.avatar} onPress={() => setShowAvatarPicker(true)}>
          <Text style={[styles.avatarText, avatarIsEmoji && { fontSize: 36 }]}>{avatarDisplay}</Text>
          <View style={styles.avatarEdit}><Text style={{ fontSize: 10, color: '#fff' }}>✏️</Text></View>
        </Pressable>
        <Text style={styles.username}>{profile?.username || 'Summoner'}</Text>
        <View style={styles.tierBadge}>
          <Text style={styles.tierText}>{profile?.tier === 'pro' ? '⭐ Pro' : '🌱 Free'}</Text>
        </View>
        <Text style={styles.levelTitle}>{getLevelTitle(level)}</Text>
      </View>

      {/* XP card */}
      {levelInfo && (
        <View style={styles.xpCard}>
          <View style={styles.xpRow}>
            <Text style={styles.xpLevelBig}>Level {level}</Text>
            <Text style={styles.xpPoints}>{profile?.xp || 0} XP total</Text>
          </View>
          <View style={styles.xpTrack}>
            <View style={[styles.xpFill, { width: `${Math.min(100, (levelInfo.progress / levelInfo.needed) * 100)}%` as any }]} />
          </View>
          <Text style={styles.xpNext}>{levelInfo.progress} / {levelInfo.needed} XP to level {level + 1}</Text>
        </View>
      )}

      {/* Stats */}
      <View style={styles.statsGrid}>
        {[
          { label: 'Cards scanned', value: profile?.lifetime_scans || 0, icon: '📷' },
          { label: 'Library cards', value: stats?.totalCards || 0, icon: '📚' },
          { label: 'Decks built', value: deckCount, icon: '🗂️' },
          { label: 'AI insights', value: profile?.lifetime_insights || 0, icon: '🧠' },
        ].map((s) => (
          <View key={s.label} style={styles.statCard}>
            <Text style={styles.statIcon}>{s.icon}</Text>
            <Text style={styles.statValue}>{s.value}</Text>
            <Text style={styles.statLabel}>{s.label}</Text>
          </View>
        ))}
      </View>

      {/* Level unlocks dashboard */}
      <Text style={styles.sectionTitle}>🔓 Level Unlocks</Text>
      <View style={styles.unlocksCard}>
        {LEVEL_UNLOCKS.map((u) => {
          const unlocked = level >= u.level;
          return (
            <View key={u.level} style={[styles.unlockRow, !unlocked && styles.unlockLocked]}>
              <View style={[styles.unlockDot, { backgroundColor: unlocked ? colors.accent : colors.border }]} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.unlockLevel, { color: unlocked ? colors.accent : colors.textDim }]}>
                  Level {u.level}
                </Text>
                <Text style={[styles.unlockReward, !unlocked && { color: colors.textDim }]}>{u.reward}</Text>
              </View>
              {unlocked && <Text style={{ color: colors.success, fontSize: 14 }}>✓</Text>}
            </View>
          );
        })}
      </View>

      {/* Achievements */}
      <Text style={styles.sectionTitle}>Achievements</Text>
      {ACHIEVEMENTS.map((a) => {
        const earned = false; // TODO: wire to user_achievements
        return (
          <View key={a.key} style={[styles.achievementRow, !earned && styles.achievementLocked]}>
            <View style={[styles.achievementIcon, earned && styles.achievementIconEarned]}>
              <Text style={{ fontSize: 20 }}>{a.icon}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.achievementLabel, !earned && { color: colors.textDim }]}>{a.label}</Text>
              <Text style={styles.achievementDesc}>{a.desc}</Text>
            </View>
            {earned && <Text style={styles.achievementCheck}>✓</Text>}
          </View>
        );
      })}

      <View style={{ height: 100 }} />

      {/* Avatar picker modal */}
      <Modal visible={showAvatarPicker} transparent animationType="slide" onRequestClose={() => setShowAvatarPicker(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setShowAvatarPicker(false)} />
        <View style={styles.modalSheet}>
          <View style={styles.handle} />
          <Text style={styles.modalTitle}>Choose Avatar</Text>
          <Text style={styles.modalSub}>More unlocked as you level up. Custom SVG designs coming soon.</Text>
          <FlatList
            data={AVATAR_OPTIONS}
            keyExtractor={(a) => a.key}
            numColumns={4}
            columnWrapperStyle={{ gap: 12, marginBottom: 12 }}
            contentContainerStyle={{ paddingHorizontal: 4 }}
            renderItem={({ item }) => {
              const isSelected = profile?.avatar_key === item.key;
              return (
                <Pressable
                  style={[styles.avatarOption, isSelected && styles.avatarOptionSelected]}
                  onPress={() => handlePickAvatar(item.key)}
                >
                  <Text style={styles.avatarOptionEmoji}>{item.emoji}</Text>
                </Pressable>
              );
            }}
          />
          <Pressable style={styles.modalClose} onPress={() => setShowAvatarPicker(false)}>
            <Text style={styles.modalCloseText}>Cancel</Text>
          </Pressable>
        </View>
      </Modal>
    </ScrollView>
  );
}

const createStyles = (c: ReturnType<typeof import('../lib/theme').useTheme>['colors']) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },
    content: { paddingBottom: 40 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    topBar: {
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      paddingHorizontal: 20, paddingTop: 60, paddingBottom: 12,
    },
    screenTitle: { color: c.text, fontSize: 22, fontWeight: '700' },
    settingsBtn: {
      backgroundColor: c.surface, borderColor: c.border, borderWidth: 1,
      paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20,
    },
    settingsBtnText: { color: c.textMuted, fontSize: 13 },
    profileCard: {
      alignItems: 'center', backgroundColor: c.surface, borderColor: c.border,
      borderWidth: 1, borderRadius: 20, marginHorizontal: 20, padding: 24, marginBottom: 16,
    },
    avatar: {
      width: 72, height: 72, borderRadius: 36, backgroundColor: c.accent,
      alignItems: 'center', justifyContent: 'center', marginBottom: 12,
    },
    avatarText: { color: c.accentText, fontSize: 32, fontWeight: '700' },
    avatarEdit: {
      position: 'absolute', bottom: 0, right: 0, width: 22, height: 22,
      borderRadius: 11, backgroundColor: c.surfaceAlt, borderColor: c.border, borderWidth: 1,
      alignItems: 'center', justifyContent: 'center',
    },
    username: { color: c.text, fontSize: 20, fontWeight: '700', marginBottom: 8 },
    tierBadge: {
      backgroundColor: c.surfaceAlt, borderColor: c.border, borderWidth: 1,
      paddingHorizontal: 12, paddingVertical: 4, borderRadius: 999, marginBottom: 6,
    },
    tierText: { color: c.textMuted, fontSize: 12, fontWeight: '600' },
    levelTitle: { color: c.accent, fontSize: 13, fontWeight: '600' },
    xpCard: {
      backgroundColor: c.surface, borderColor: c.border, borderWidth: 1,
      borderRadius: 16, marginHorizontal: 20, padding: 16, marginBottom: 16,
    },
    xpRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
    xpLevelBig: { color: c.text, fontWeight: '700', fontSize: 16 },
    xpPoints: { color: c.textMuted, fontSize: 13 },
    xpTrack: { height: 8, borderRadius: 4, backgroundColor: c.surfaceAlt, marginBottom: 6 },
    xpFill: { height: 8, borderRadius: 4, backgroundColor: c.accent },
    xpNext: { color: c.textDim, fontSize: 11 },
    statsGrid: {
      flexDirection: 'row', flexWrap: 'wrap', gap: 12,
      paddingHorizontal: 20, marginBottom: 24,
    },
    statCard: {
      flex: 1, minWidth: '44%', backgroundColor: c.surface, borderColor: c.border,
      borderWidth: 1, borderRadius: 16, padding: 16, alignItems: 'center',
    },
    statIcon: { fontSize: 22, marginBottom: 6 },
    statValue: { color: c.text, fontWeight: '700', fontSize: 22, marginBottom: 2 },
    statLabel: { color: c.textMuted, fontSize: 11, textAlign: 'center' },
    sectionTitle: { color: c.text, fontWeight: '700', fontSize: 16, marginHorizontal: 20, marginBottom: 12, marginTop: 4 },
    unlocksCard: {
      backgroundColor: c.surface, borderColor: c.border, borderWidth: 1,
      borderRadius: 16, marginHorizontal: 20, padding: 16, marginBottom: 24,
    },
    unlockRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomColor: c.border, borderBottomWidth: StyleSheet.hairlineWidth },
    unlockLocked: { opacity: 0.4 },
    unlockDot: { width: 8, height: 8, borderRadius: 4 },
    unlockLevel: { fontSize: 11, fontWeight: '700', marginBottom: 2 },
    unlockReward: { color: c.textMuted, fontSize: 13 },
    achievementRow: {
      flexDirection: 'row', alignItems: 'center', gap: 12,
      backgroundColor: c.surface, borderColor: c.border, borderWidth: 1,
      borderRadius: 16, padding: 14, marginHorizontal: 20, marginBottom: 8,
    },
    achievementLocked: { opacity: 0.5 },
    achievementIcon: {
      width: 44, height: 44, borderRadius: 22,
      backgroundColor: c.surfaceAlt, alignItems: 'center', justifyContent: 'center',
    },
    achievementIconEarned: { backgroundColor: 'rgba(245,158,11,0.15)' },
    achievementLabel: { color: c.text, fontWeight: '600', fontSize: 14, marginBottom: 2 },
    achievementDesc: { color: c.textMuted, fontSize: 12 },
    achievementCheck: { color: c.success, fontSize: 18, fontWeight: '700' },
    // Avatar modal
    modalBackdrop: { flex: 1, backgroundColor: c.overlay },
    modalSheet: {
      backgroundColor: c.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
      borderTopColor: c.border, borderTopWidth: 1, padding: 20,
    },
    handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: c.border, alignSelf: 'center', marginBottom: 16 },
    modalTitle: { color: c.text, fontSize: 18, fontWeight: '700', marginBottom: 4 },
    modalSub: { color: c.textMuted, fontSize: 12, marginBottom: 16 },
    avatarOption: {
      flex: 1, aspectRatio: 1, backgroundColor: c.surfaceAlt, borderColor: c.border,
      borderWidth: 1, borderRadius: 16, alignItems: 'center', justifyContent: 'center',
    },
    avatarOptionSelected: { borderColor: c.accent, backgroundColor: 'rgba(245,158,11,0.15)' },
    avatarOptionEmoji: { fontSize: 32 },
    modalClose: {
      backgroundColor: c.surfaceAlt, borderColor: c.border, borderWidth: 1,
      paddingVertical: 14, borderRadius: 12, alignItems: 'center', marginTop: 12, marginBottom: 8,
    },
    modalCloseText: { color: c.textMuted, fontWeight: '600' },
  });
