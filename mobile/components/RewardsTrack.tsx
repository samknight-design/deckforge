// CoD/Clash-style horizontal rewards track.
//
// Two rows: FREE (top) and PRO (bottom).
// Nodes appear at every 5 levels; milestones at 10, 20, 30, 50, 75, 100.
// Current level marker glows on the track. Locked items are greyed out.
// Scrolls to show the current level node on mount.

import { useRef, useEffect, useMemo } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTheme } from '../lib/theme';

const NODE_W = 72;    // width of each node column
const TRACK_H = 56;   // height of each row's node area
const GAP = 8;        // gap between node columns

// ── Reward definitions ────────────────────────────────────────────────────────

export type RewardTier = 'free' | 'pro';

export type Reward = {
  level: number;
  tier: RewardTier;
  icon: string;
  label: string;
  /** If true this is a feature unlock, not just a cosmetic */
  feature?: boolean;
};

export const REWARDS: Reward[] = [
  // Level 1
  { level: 1,  tier: 'free', icon: '🌿', label: 'Forest avatar' },
  // Level 5
  { level: 5,  tier: 'free', icon: '⚔️',  label: 'Knight avatar' },
  { level: 5,  tier: 'pro',  icon: '🔥',  label: 'Flame avatar (Pro)' },
  // Level 10
  { level: 10, tier: 'free', icon: '🔮',  label: 'Mystic avatar' },
  { level: 10, tier: 'free', icon: '🥈',  label: 'Silver border' },
  { level: 10, tier: 'pro',  icon: '🧠',  label: '+1 AI Insight/mo', feature: true },
  // Level 15
  { level: 15, tier: 'free', icon: '🐉',  label: 'Dragon avatar' },
  { level: 15, tier: 'pro',  icon: '🌙',  label: 'Moon avatar (Pro)' },
  // Level 20
  { level: 20, tier: 'free', icon: '⚡',  label: 'Storm avatar' },
  { level: 20, tier: 'free', icon: '🥇',  label: 'Gold border' },
  { level: 20, tier: 'pro',  icon: '🧠',  label: '+2 AI Insights/mo', feature: true },
  // Level 25
  { level: 25, tier: 'free', icon: '🦅',  label: 'Eagle avatar' },
  { level: 25, tier: 'pro',  icon: '👑',  label: 'Crown avatar (Pro)' },
  // Level 30
  { level: 30, tier: 'free', icon: '☄️',  label: 'Comet avatar' },
  { level: 30, tier: 'pro',  icon: '💎',  label: 'Diamond border (Pro)' },
  { level: 30, tier: 'pro',  icon: '🧠',  label: '+3 AI Insights/mo', feature: true },
  // Level 40
  { level: 40, tier: 'free', icon: '🏰',  label: 'Castle avatar' },
  { level: 40, tier: 'pro',  icon: '✨',  label: 'Animated border (Pro)' },
  // Level 50
  { level: 50, tier: 'free', icon: '🌊',  label: 'Wave avatar' },
  { level: 50, tier: 'pro',  icon: '🧠',  label: '+5 AI Insights/mo', feature: true },
  { level: 50, tier: 'pro',  icon: '🌟',  label: 'Legend frame (Pro)' },
  // Level 75
  { level: 75, tier: 'free', icon: '🧙',  label: 'Wizard avatar' },
  { level: 75, tier: 'pro',  icon: '🔮',  label: 'Mystic Pro frame' },
  // Level 100
  { level: 100, tier: 'free', icon: '🎖️', label: 'Planeswalker title' },
  { level: 100, tier: 'pro',  icon: '👁️',  label: 'Omniscient frame (Pro)' },
];

// Levels that have reward nodes (every 5 levels up to 100)
const MILESTONES = [1, 5, 10, 15, 20, 25, 30, 40, 50, 75, 100];

function getRewardsAt(level: number, tier: RewardTier): Reward[] {
  return REWARDS.filter((r) => r.level === level && r.tier === tier);
}

// ── Track node ────────────────────────────────────────────────────────────────

function TrackNode({
  milestone,
  tier,
  currentLevel,
  isPro,
  colors,
}: {
  milestone: number;
  tier: RewardTier;
  currentLevel: number;
  isPro: boolean;
  colors: ReturnType<typeof import('../lib/theme').useTheme>['colors'];
}) {
  const rewards = getRewardsAt(milestone, tier);
  const unlocked = currentLevel >= milestone;
  const isProReward = tier === 'pro';
  const canAccess = isProReward ? isPro && unlocked : unlocked;

  if (rewards.length === 0) {
    // Just a track connector node (no reward)
    return (
      <View style={[nodeStyles.connector, { borderColor: unlocked ? colors.accent : colors.border }]}>
        <View style={[nodeStyles.connectorDot, { backgroundColor: unlocked ? colors.accent : colors.border }]} />
      </View>
    );
  }

  const reward = rewards[0];
  return (
    <View style={{ alignItems: 'center' }}>
      <View style={[
        nodeStyles.node,
        {
          backgroundColor: canAccess ? (isProReward ? 'rgba(124,58,237,0.15)' : 'rgba(245,158,11,0.12)') : colors.surfaceAlt,
          borderColor: canAccess ? (isProReward ? colors.purple : colors.accent) : colors.border,
        },
      ]}>
        <Text style={[nodeStyles.nodeIcon, !canAccess && { opacity: 0.35 }]}>{reward.icon}</Text>
        {!canAccess && !unlocked && (
          <View style={nodeStyles.lockOverlay}>
            <Text style={{ fontSize: 10, color: colors.textDim }}>🔒</Text>
          </View>
        )}
        {!canAccess && unlocked && isProReward && (
          <View style={nodeStyles.lockOverlay}>
            <Text style={{ fontSize: 9, color: colors.purple }}>Pro</Text>
          </View>
        )}
      </View>
      <Text style={[nodeStyles.nodeLabel, { color: canAccess ? colors.text : colors.textDim }]} numberOfLines={1}>
        Lv {milestone}
      </Text>
    </View>
  );
}

const nodeStyles = StyleSheet.create({
  node: {
    width: 52, height: 52, borderRadius: 14, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center', position: 'relative',
  },
  nodeIcon: { fontSize: 24 },
  lockOverlay: {
    position: 'absolute', bottom: -1, right: -1,
    backgroundColor: 'rgba(10,14,26,0.85)', borderRadius: 6,
    paddingHorizontal: 3, paddingVertical: 1,
  },
  nodeLabel: { fontSize: 9, fontWeight: '600', marginTop: 4 },
  connector: {
    width: 32, height: 32, borderRadius: 10, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center',
  },
  connectorDot: { width: 8, height: 8, borderRadius: 4 },
});

// ── Main component ─────────────────────────────────────────────────────────────

type Props = {
  currentLevel: number;
  isPro: boolean;
};

export default function RewardsTrack({ currentLevel, isPro }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const scrollRef = useRef<ScrollView>(null);

  // Auto-scroll to current level position on mount
  useEffect(() => {
    const idx = MILESTONES.findIndex((m) => m >= currentLevel);
    const scrollTo = Math.max(0, (idx - 1) * (NODE_W + GAP));
    setTimeout(() => {
      scrollRef.current?.scrollTo({ x: scrollTo, animated: true });
    }, 400);
  }, [currentLevel]);

  const totalWidth = MILESTONES.length * (NODE_W + GAP);

  return (
    <View style={styles.wrapper}>
      {/* Row labels */}
      <View style={styles.rowLabels}>
        <View style={styles.rowLabel}>
          <Text style={[styles.rowLabelText, { color: colors.accent }]}>FREE</Text>
        </View>
        <View style={[styles.rowLabel, styles.rowLabelPro]}>
          <Text style={[styles.rowLabelText, { color: colors.purple }]}>PRO</Text>
        </View>
      </View>

      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[styles.track, { width: totalWidth }]}
      >
        {/* Connecting line — FREE row */}
        <View style={[styles.trackLine, styles.trackLineFree, { backgroundColor: colors.accent, opacity: 0.3 }]} />
        {/* Connecting line — PRO row */}
        <View style={[styles.trackLine, styles.trackLinePro, { backgroundColor: colors.purple, opacity: 0.3 }]} />

        {/* Level nodes */}
        {MILESTONES.map((milestone, i) => {
          const isCurrent = currentLevel >= milestone &&
            (i === MILESTONES.length - 1 || currentLevel < MILESTONES[i + 1]);

          return (
            <View key={milestone} style={[styles.milestoneCol, { width: NODE_W }]}>
              {/* Current level glow indicator */}
              {isCurrent && (
                <View style={[styles.currentMarker, { borderColor: colors.accent }]} />
              )}

              {/* Free row node */}
              <View style={styles.freeRow}>
                <TrackNode
                  milestone={milestone}
                  tier="free"
                  currentLevel={currentLevel}
                  isPro={isPro}
                  colors={colors}
                />
              </View>

              {/* Pro row node */}
              <View style={styles.proRow}>
                <TrackNode
                  milestone={milestone}
                  tier="pro"
                  currentLevel={currentLevel}
                  isPro={isPro}
                  colors={colors}
                />
              </View>
            </View>
          );
        })}
      </ScrollView>

      {!isPro && (
        <View style={[styles.proBanner, { backgroundColor: colors.surfaceAlt, borderColor: colors.purple }]}>
          <Text style={[styles.proBannerText, { color: colors.purple }]}>
            ⭐ Upgrade to Pro to unlock the bottom track — bonus AI insights + exclusive avatars
          </Text>
        </View>
      )}
    </View>
  );
}

const createStyles = (c: ReturnType<typeof import('../lib/theme').useTheme>['colors']) =>
  StyleSheet.create({
    wrapper: {
      backgroundColor: c.surface, borderColor: c.border, borderWidth: 1,
      borderRadius: 20, overflow: 'hidden', marginBottom: 8,
    },
    rowLabels: {
      position: 'absolute', left: 0, top: 0, bottom: 0, width: 44,
      justifyContent: 'space-around', paddingVertical: 20, zIndex: 2,
      backgroundColor: c.surface, borderRightColor: c.border, borderRightWidth: 1,
    },
    rowLabel: { alignItems: 'center' },
    rowLabelPro: {},
    rowLabelText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
    track: {
      flexDirection: 'row',
      paddingHorizontal: 52,
      paddingVertical: 16,
      alignItems: 'center',
      position: 'relative',
    },
    trackLine: {
      position: 'absolute',
      left: 52,
      right: 0,
      height: 2,
    },
    trackLineFree: { top: 16 + TRACK_H / 2 },
    trackLinePro: { top: 16 + TRACK_H + 16 + TRACK_H / 2 },
    milestoneCol: {
      alignItems: 'center',
      marginRight: GAP,
    },
    freeRow: {
      height: TRACK_H,
      alignItems: 'center',
      justifyContent: 'center',
    },
    proRow: {
      height: TRACK_H,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 16,
    },
    currentMarker: {
      position: 'absolute',
      top: -4,
      width: NODE_W - 4,
      bottom: -4,
      borderWidth: 2,
      borderRadius: 18,
      zIndex: 1,
    },
    proBanner: {
      paddingHorizontal: 16, paddingVertical: 10,
      borderTopColor: c.purple, borderTopWidth: 1,
    },
    proBannerText: { fontSize: 12, textAlign: 'center', lineHeight: 17 },
  });
