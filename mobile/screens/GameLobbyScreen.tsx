// Host lobby: shows the QR + pincode players use to join, the seat/ready list,
// and the Start button. Live joining (Realtime + scanning) is a later slice —
// for now the host can start immediately and run every seat from this phone.

import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../lib/theme';
import { FORMATS, type GameConfig } from '../lib/game/formats';
import { generateCode, joinUrl } from '../lib/game/session';
import QrCode from '../components/game/QrCode';

export default function GameLobbyScreen({
  config,
  onBack,
  onStartGame,
}: {
  config: GameConfig;
  onBack: () => void;
  onStartGame: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [code] = useState(generateCode);
  const format = FORMATS[config.format];

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <Pressable style={styles.iconBtn} onPress={onBack}><Text style={styles.iconBtnText}>← Back</Text></Pressable>
        <Text style={styles.topTitle}>Game lobby</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.meta}>{format.label} · {config.playerCount} players · {config.startingLife} life</Text>

        <View style={styles.qrWrap}>
          <QrCode value={joinUrl(code)} size={210} />
        </View>

        <Text style={styles.codeLabel}>Game code</Text>
        <Text style={styles.code}>{code}</Text>
        <Text style={styles.hint}>Scan the code or enter it on another phone to join with your own deck. Live joining is coming soon — for now everyone can play from this phone.</Text>

        {/* Seat / ready list */}
        <View style={styles.seats}>
          <View style={styles.seatRow}>
            <View style={[styles.seatDot, { backgroundColor: colors.success }]} />
            <Text style={styles.seatName}>You (host){config.hostDeck ? ` · ${config.hostDeck.name}` : ''}</Text>
            <Text style={[styles.seatState, { color: colors.success }]}>Ready</Text>
          </View>
          {Array.from({ length: config.playerCount - 1 }, (_, i) => (
            <View key={i} style={styles.seatRow}>
              <View style={[styles.seatDot, { backgroundColor: colors.textDim }]} />
              <Text style={[styles.seatName, { color: colors.textMuted }]}>Player {i + 2}</Text>
              <Text style={[styles.seatState, { color: colors.textDim }]}>Local</Text>
            </View>
          ))}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Pressable style={styles.startBtn} onPress={onStartGame}>
          <Text style={styles.startBtnText}>Start game →</Text>
        </Pressable>
      </View>
    </View>
  );
}

const createStyles = (c: ReturnType<typeof import('../lib/theme').useTheme>['colors']) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg, paddingTop: 50 },
    topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 12, borderBottomColor: c.border, borderBottomWidth: 1 },
    topTitle: { color: c.text, fontWeight: '700', fontSize: 18 },
    iconBtn: { backgroundColor: c.surface, borderColor: c.border, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20 },
    iconBtnText: { color: c.textMuted, fontSize: 13 },
    content: { padding: 20, alignItems: 'center' },
    meta: { color: c.textMuted, fontSize: 13, marginBottom: 18 },
    qrWrap: { padding: 12, backgroundColor: '#ffffff', borderRadius: 16 },
    codeLabel: { color: c.textMuted, fontSize: 12, fontWeight: '700', letterSpacing: 1, marginTop: 18, textTransform: 'uppercase' },
    code: { color: c.text, fontSize: 40, fontWeight: '900', letterSpacing: 6, marginTop: 4 },
    hint: { color: c.textDim, fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 12, maxWidth: 320 },
    seats: { alignSelf: 'stretch', marginTop: 22, gap: 8 },
    seatRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: c.surface, borderColor: c.border, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12 },
    seatDot: { width: 10, height: 10, borderRadius: 5 },
    seatName: { color: c.text, fontSize: 14, fontWeight: '600', flex: 1 },
    seatState: { fontSize: 12, fontWeight: '700' },
    footer: { padding: 16, borderTopColor: c.border, borderTopWidth: 1 },
    startBtn: { backgroundColor: c.accent, paddingVertical: 16, borderRadius: 14, alignItems: 'center' },
    startBtnText: { color: c.accentText, fontWeight: '800', fontSize: 16 },
  });
