import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { apiFetch } from '../lib/api';
import { type Deck } from '../lib/db';
import { useTheme, BRACKET_NAMES, BRACKET_COLORS } from '../lib/theme';
import { tryCompleteChallenge } from '../lib/challenges';
import { useXpToast } from '../lib/xpToast';

type InsightData = {
  bracket: number;
  bracket_name: string;
  power_level: number;
  summary: string;
  strategy: string;
  strengths: Array<{ title: string; detail: string }>;
  weaknesses: Array<{ title: string; detail: string }>;
  cards_to_add: Array<{ name: string; reason: string }>;
  cards_to_remove: Array<{ name: string; reason: string }>;
};

type InsightResult = {
  data: InsightData | null;
  content: string;
  bracket_estimate: number;
  generated_at: string;
  cached: boolean;
};

function Section({ title, children, color }: { title: string; children: React.ReactNode; color: string }) {
  const [open, setOpen] = useState(true);
  return (
    <View style={{ marginBottom: 16 }}>
      <Pressable
        onPress={() => setOpen((o) => !o)}
        style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}
      >
        <Text style={{ color, fontWeight: '700', fontSize: 15 }}>{title}</Text>
        <Text style={{ color, fontSize: 14 }}>{open ? '▲' : '▼'}</Text>
      </Pressable>
      {open && children}
    </View>
  );
}

export default function InsightsScreen({
  deck,
  onBack,
  userId,
}: {
  deck: Deck;
  onBack: () => void;
  userId?: string;
}) {
  const { colors, formatPrice } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { showXp } = useXpToast();

  const [insight, setInsight] = useState<InsightResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchInsight = useCallback(async (force = false) => {
    if (force) setGenerating(true);
    else setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deckId: deck.id, force }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setInsight(data);
      // Challenge: run_insights (only on fresh generation, not cache)
      if (!data.cached && userId) {
        tryCompleteChallenge(userId, 'run_insights').then((r) => {
          if (r.justCompleted) showXp(r.xpEarned, 'AI Analyst complete!');
        });
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      setGenerating(false);
    }
  }, [deck.id]);

  useEffect(() => { fetchInsight(); }, [fetchInsight]);

  const d = insight?.data;
  const bracket = insight?.bracket_estimate || d?.bracket || 3;
  const bracketColor = BRACKET_COLORS[bracket] || colors.accent;
  const bracketName = BRACKET_NAMES[bracket] || 'Optimised';

  return (
    <View style={styles.container}>
      {/* Top bar */}
      <View style={styles.topBar}>
        <Pressable style={styles.backBtn} onPress={onBack}>
          <Text style={styles.backBtnText}>← Back</Text>
        </Pressable>
        <Text style={styles.topTitle} numberOfLines={1}>{deck.name}</Text>
        <Pressable
          style={[styles.regenBtn, generating && { opacity: 0.5 }]}
          onPress={() => fetchInsight(true)}
          disabled={generating}
        >
          <Text style={styles.regenBtnText}>{generating ? '…' : '↺'}</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} size="large" />
          <Text style={styles.loadingText}>Analysing your deck with Claude…</Text>
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>⚠️ {error}</Text>
          <Pressable style={styles.primaryBtn} onPress={() => fetchInsight()}>
            <Text style={styles.primaryBtnText}>Try again</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          {/* Bracket badge */}
          <View style={[styles.bracketCard, { borderColor: bracketColor }]}>
            <View style={[styles.bracketBadge, { backgroundColor: bracketColor }]}>
              <Text style={styles.bracketNum}>{bracket}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.bracketName, { color: bracketColor }]}>{bracketName}</Text>
              <Text style={styles.bracketSub}>Bracket {bracket} / 5</Text>
            </View>
            {d?.power_level != null && (
              <View style={styles.powerBadge}>
                <Text style={styles.powerNum}>{d.power_level}</Text>
                <Text style={styles.powerLabel}>/10</Text>
              </View>
            )}
          </View>

          {/* Power bar */}
          {d?.power_level != null && (
            <View style={styles.powerBarWrap}>
              <View style={styles.powerTrack}>
                <View style={[styles.powerFill, { width: `${d.power_level * 10}%` as any, backgroundColor: bracketColor }]} />
              </View>
              <Text style={styles.powerBarLabel}>Power level {d.power_level}/10</Text>
            </View>
          )}

          {/* Cached notice */}
          {insight?.cached && (
            <View style={styles.cachedBanner}>
              <Text style={styles.cachedText}>Cached · generated {new Date(insight.generated_at).toLocaleDateString()}</Text>
            </View>
          )}

          {/* Summary */}
          {d?.summary && (
            <View style={styles.summaryCard}>
              <Text style={styles.summaryTitle}>Overview</Text>
              <Text style={styles.summaryText}>{d.summary}</Text>
              {d.strategy && <Text style={styles.summaryText}>{d.strategy}</Text>}
            </View>
          )}

          {/* Strengths */}
          {d?.strengths && d.strengths.length > 0 && (
            <Section title="💪 Strengths" color={colors.success}>
              {d.strengths.map((s, i) => (
                <View key={i} style={styles.listCard}>
                  <Text style={[styles.listCardTitle, { color: colors.success }]}>{s.title}</Text>
                  <Text style={styles.listCardDetail}>{s.detail}</Text>
                </View>
              ))}
            </Section>
          )}

          {/* Weaknesses */}
          {d?.weaknesses && d.weaknesses.length > 0 && (
            <Section title="⚠️ Weaknesses" color={colors.danger}>
              {d.weaknesses.map((w, i) => (
                <View key={i} style={styles.listCard}>
                  <Text style={[styles.listCardTitle, { color: colors.danger }]}>{w.title}</Text>
                  <Text style={styles.listCardDetail}>{w.detail}</Text>
                </View>
              ))}
            </Section>
          )}

          {/* Cards to add */}
          {d?.cards_to_add && d.cards_to_add.length > 0 && (
            <Section title="➕ Cards to Add" color={colors.info}>
              {d.cards_to_add.map((c, i) => (
                <View key={i} style={styles.listCard}>
                  <Text style={[styles.listCardTitle, { color: colors.info }]}>{c.name}</Text>
                  <Text style={styles.listCardDetail}>{c.reason}</Text>
                </View>
              ))}
            </Section>
          )}

          {/* Cards to remove */}
          {d?.cards_to_remove && d.cards_to_remove.length > 0 && (
            <Section title="➖ Cards to Cut" color={colors.textMuted}>
              {d.cards_to_remove.map((c, i) => (
                <View key={i} style={styles.listCard}>
                  <Text style={[styles.listCardTitle, { color: colors.textMuted }]}>{c.name}</Text>
                  <Text style={styles.listCardDetail}>{c.reason}</Text>
                </View>
              ))}
            </Section>
          )}

          {/* Regenerate */}
          <Pressable
            style={[styles.regenFullBtn, generating && { opacity: 0.5 }]}
            onPress={() => fetchInsight(true)}
            disabled={generating}
          >
            {generating ? (
              <ActivityIndicator color={colors.accentText} size="small" />
            ) : (
              <Text style={styles.regenFullBtnText}>↺ Regenerate Insights</Text>
            )}
          </Pressable>

          <View style={{ height: 100 }} />
        </ScrollView>
      )}
    </View>
  );
}

const createStyles = (c: ReturnType<typeof import('../lib/theme').useTheme>['colors']) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },
    topBar: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: 16, paddingTop: 56, paddingBottom: 12,
      borderBottomColor: c.border, borderBottomWidth: 1,
    },
    topTitle: { color: c.text, fontWeight: '700', fontSize: 17, flex: 1, textAlign: 'center' },
    backBtn: {
      backgroundColor: c.surface, borderColor: c.border, borderWidth: 1,
      paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20,
    },
    backBtnText: { color: c.textMuted, fontSize: 13 },
    regenBtn: {
      backgroundColor: c.surface, borderColor: c.border, borderWidth: 1,
      width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
    },
    regenBtnText: { color: c.accent, fontSize: 18, fontWeight: '700' },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    loadingText: { color: c.textMuted, fontSize: 14, marginTop: 16, textAlign: 'center' },
    errorText: { color: c.danger, fontSize: 15, textAlign: 'center', marginBottom: 20 },
    primaryBtn: { backgroundColor: c.accent, paddingHorizontal: 24, paddingVertical: 14, borderRadius: 12 },
    primaryBtnText: { color: c.accentText, fontWeight: '700' },
    scroll: { padding: 20 },
    bracketCard: {
      flexDirection: 'row', alignItems: 'center', gap: 14,
      backgroundColor: c.surface, borderWidth: 2, borderRadius: 20,
      padding: 16, marginBottom: 12,
    },
    bracketBadge: {
      width: 52, height: 52, borderRadius: 26,
      alignItems: 'center', justifyContent: 'center',
    },
    bracketNum: { color: '#fff', fontSize: 24, fontWeight: '900' },
    bracketName: { fontWeight: '700', fontSize: 18 },
    bracketSub: { color: c.textMuted, fontSize: 12 },
    powerBadge: { alignItems: 'center' },
    powerNum: { color: c.text, fontWeight: '900', fontSize: 28 },
    powerLabel: { color: c.textMuted, fontSize: 12 },
    powerBarWrap: { marginBottom: 16 },
    powerTrack: { height: 8, borderRadius: 4, backgroundColor: c.surfaceAlt, marginBottom: 4 },
    powerFill: { height: 8, borderRadius: 4 },
    powerBarLabel: { color: c.textMuted, fontSize: 12 },
    cachedBanner: {
      backgroundColor: c.surfaceAlt, borderColor: c.border, borderWidth: 1,
      borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, marginBottom: 16,
    },
    cachedText: { color: c.textDim, fontSize: 11 },
    summaryCard: {
      backgroundColor: c.surface, borderColor: c.border, borderWidth: 1,
      borderRadius: 16, padding: 16, marginBottom: 20,
    },
    summaryTitle: { color: c.text, fontWeight: '700', fontSize: 14, marginBottom: 8 },
    summaryText: { color: c.textMuted, fontSize: 14, lineHeight: 20, marginBottom: 8 },
    listCard: {
      backgroundColor: c.surface, borderColor: c.border, borderWidth: 1,
      borderRadius: 12, padding: 12, marginBottom: 8,
    },
    listCardTitle: { fontWeight: '700', fontSize: 13, marginBottom: 4 },
    listCardDetail: { color: c.textMuted, fontSize: 13, lineHeight: 18 },
    regenFullBtn: {
      backgroundColor: c.accent, paddingVertical: 16, borderRadius: 16,
      alignItems: 'center', marginTop: 8,
    },
    regenFullBtnText: { color: c.accentText, fontWeight: '700', fontSize: 15 },
  });
