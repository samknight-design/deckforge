// Collapsible daily challenges widget for the Home screen.
// Shows today's 6 challenges with progress bars and XP rewards.
// Auto-completes the daily_login challenge on mount.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  getDailyChallenges,
  tryCompleteChallenge,
  MAX_DAILY_XP,
  type ChallengeProgress,
} from '../lib/challenges';
import { useTheme } from '../lib/theme';
import { useXpToast } from '../lib/xpToast';

export default function DailyChallengesWidget({
  userId,
}: {
  userId: string;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { showXp } = useXpToast();

  const [challenges, setChallenges] = useState<ChallengeProgress[] | null>(null);
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(async () => {
    const data = await getDailyChallenges(userId).catch(() => null);
    if (!data) return;
    setChallenges(data);
  }, [userId]);

  // On mount: load progress then auto-complete daily_login
  useEffect(() => {
    const init = async () => {
      await load();
      const result = await tryCompleteChallenge(userId, 'daily_login');
      if (result.justCompleted) {
        showXp(result.xpEarned, 'Daily check-in');
        await load(); // Refresh to show it ticked
      }
    };
    init();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const totalEarned = (challenges || []).reduce((s, c) => s + c.xp_earned, 0);
  const completedCount = (challenges || []).filter((c) => c.completed).length;

  return (
    <View style={styles.wrapper}>
      {/* Header — always visible */}
      <Pressable style={styles.header} onPress={() => setExpanded((e) => !e)}>
        <View style={styles.headerLeft}>
          <Text style={styles.headerTitle}>⚡ Daily Challenges</Text>
          <Text style={styles.headerSub}>
            {completedCount}/{(challenges || []).length} complete · {totalEarned}/{MAX_DAILY_XP} XP
          </Text>
        </View>
        <View style={styles.headerRight}>
          {/* Mini progress bar */}
          <View style={styles.miniTrack}>
            <View style={[styles.miniFill, { width: `${(totalEarned / MAX_DAILY_XP) * 100}%` as any }]} />
          </View>
          <Text style={[styles.chevron, expanded && { transform: [{ rotate: '180deg' }] }]}>▼</Text>
        </View>
      </Pressable>

      {/* Expanded body */}
      {expanded && (
        <View style={styles.body}>
          {challenges === null ? (
            <ActivityIndicator color={colors.accent} style={{ marginVertical: 16 }} />
          ) : (
            challenges.map((c) => (
              <ChallengeRow key={c.key} challenge={c} colors={colors} styles={styles} />
            ))
          )}
        </View>
      )}
    </View>
  );
}

function ChallengeRow({
  challenge: c,
  colors,
  styles,
}: {
  challenge: ChallengeProgress;
  colors: ReturnType<typeof import('../lib/theme').useTheme>['colors'];
  styles: ReturnType<typeof createStyles>;
}) {
  const progress = Math.min(c.progress, c.target);
  const pct = c.target > 0 ? progress / c.target : 0;

  return (
    <View style={[styles.challengeRow, c.completed && styles.challengeRowDone]}>
      <Text style={styles.challengeIcon}>{c.icon}</Text>
      <View style={{ flex: 1 }}>
        <View style={styles.challengeTopRow}>
          <Text style={[styles.challengeLabel, c.completed && { color: colors.textDim }]}>
            {c.label}
          </Text>
          <Text style={styles.challengeXp}>+{c.xp} XP</Text>
        </View>
        <Text style={styles.challengeDesc}>{c.description}</Text>
        {/* Progress bar (only for incremental challenges) */}
        {c.target > 1 && (
          <View style={styles.challengeTrack}>
            <View style={[styles.challengeFill, { width: `${pct * 100}%` as any, backgroundColor: c.completed ? colors.success : colors.accent }]} />
          </View>
        )}
        {c.target > 1 && (
          <Text style={styles.challengeCount}>{progress}/{c.target}</Text>
        )}
      </View>
      {/* Completion indicator */}
      <View style={[styles.checkCircle, c.completed && { backgroundColor: colors.success, borderColor: colors.success }]}>
        {c.completed && <Text style={{ color: '#fff', fontSize: 12 }}>✓</Text>}
      </View>
    </View>
  );
}

const createStyles = (c: ReturnType<typeof import('../lib/theme').useTheme>['colors']) =>
  StyleSheet.create({
    wrapper: {
      backgroundColor: c.surface, borderColor: c.border, borderWidth: 1,
      borderRadius: 16, marginBottom: 20, overflow: 'hidden',
    },
    header: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      padding: 14,
    },
    headerLeft: { flex: 1 },
    headerTitle: { color: c.text, fontWeight: '700', fontSize: 14 },
    headerSub: { color: c.textMuted, fontSize: 11, marginTop: 2 },
    headerRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    miniTrack: { width: 60, height: 4, borderRadius: 2, backgroundColor: c.surfaceAlt },
    miniFill: { height: 4, borderRadius: 2, backgroundColor: c.accent },
    chevron: { color: c.textDim, fontSize: 10, fontWeight: '700' },
    body: { borderTopColor: c.border, borderTopWidth: 1, paddingHorizontal: 14, paddingVertical: 8 },
    challengeRow: {
      flexDirection: 'row', alignItems: 'flex-start', gap: 10,
      paddingVertical: 10, borderBottomColor: c.border, borderBottomWidth: StyleSheet.hairlineWidth,
    },
    challengeRowDone: { opacity: 0.6 },
    challengeIcon: { fontSize: 20, width: 28, textAlign: 'center', marginTop: 2 },
    challengeTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 },
    challengeLabel: { color: c.text, fontSize: 13, fontWeight: '600', flex: 1 },
    challengeXp: { color: c.accent, fontSize: 12, fontWeight: '700' },
    challengeDesc: { color: c.textMuted, fontSize: 11, marginBottom: 4 },
    challengeTrack: { height: 4, borderRadius: 2, backgroundColor: c.surfaceAlt, marginTop: 4 },
    challengeFill: { height: 4, borderRadius: 2 },
    challengeCount: { color: c.textDim, fontSize: 10, marginTop: 2 },
    checkCircle: {
      width: 22, height: 22, borderRadius: 11,
      borderWidth: 1.5, borderColor: c.border,
      alignItems: 'center', justifyContent: 'center', marginTop: 2,
    },
  });
