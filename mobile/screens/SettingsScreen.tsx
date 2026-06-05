import { useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { updateProfile, getProfile } from '../lib/db';
import { useTheme, type Currency } from '../lib/theme';

export default function SettingsScreen({ onBack, userId }: { onBack: () => void; userId?: string }) {
  const { colors, theme, currency, setTheme, setCurrency } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [username, setUsername] = useState('');
  const [currentUsername, setCurrentUsername] = useState<string | null>(null);
  const [loadedUsername, setLoadedUsername] = useState(false);
  const [savingUsername, setSavingUsername] = useState(false);

  // Lazy-load current username on first render
  if (userId && !loadedUsername) {
    setLoadedUsername(true);
    getProfile(userId).then((p) => {
      setCurrentUsername(p?.username ?? null);
      setUsername(p?.username ?? '');
    }).catch(() => {});
  }

  const signOut = () => {
    Alert.alert('Sign out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => supabase.auth.signOut() },
    ]);
  };

  const saveUsername = async () => {
    if (!userId || !username.trim()) return;
    const trimmed = username.trim();
    if (trimmed === currentUsername) return;
    if (trimmed.length < 3) { Alert.alert('Too short', 'Username must be at least 3 characters.'); return; }
    if (!/^[a-zA-Z0-9_]+$/.test(trimmed)) { Alert.alert('Invalid', 'Only letters, numbers and underscores allowed.'); return; }
    setSavingUsername(true);
    const { error } = await updateProfile(userId, { username: trimmed });
    setSavingUsername(false);
    if (error) {
      Alert.alert('Error', error);
    } else {
      setCurrentUsername(trimmed);
      Alert.alert('Saved', `Username updated to @${trimmed}`);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.topBar}>
        <Pressable style={styles.backBtn} onPress={onBack}>
          <Text style={styles.backBtnText}>← Back</Text>
        </Pressable>
        <Text style={styles.title}>Settings</Text>
        <View style={{ width: 70 }} />
      </View>

      {/* Username */}
      {userId && (
        <>
          <Text style={styles.sectionLabel}>USERNAME</Text>
          <View style={styles.section}>
            <View style={[styles.row, { borderBottomWidth: 0 }]}>
              <TextInput
                style={[styles.usernameInput, { color: colors.text }]}
                value={username}
                onChangeText={setUsername}
                placeholder="your_username"
                placeholderTextColor={colors.textDim}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="done"
                onSubmitEditing={saveUsername}
              />
              <Pressable
                style={[styles.saveBtn, (!username.trim() || username === currentUsername || savingUsername) && { opacity: 0.4 }]}
                onPress={saveUsername}
                disabled={!username.trim() || username === currentUsername || savingUsername}
              >
                <Text style={styles.saveBtnText}>{savingUsername ? '…' : 'Save'}</Text>
              </Pressable>
            </View>
          </View>
        </>
      )}

      {/* Appearance */}
      <Text style={styles.sectionLabel}>APPEARANCE</Text>
      <View style={styles.section}>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Dark mode</Text>
          <Switch
            value={theme === 'dark'}
            onValueChange={(v) => setTheme(v ? 'dark' : 'light')}
            trackColor={{ false: colors.border, true: colors.accent }}
            thumbColor="#fff"
          />
        </View>
      </View>

      {/* Currency */}
      <Text style={styles.sectionLabel}>CURRENCY</Text>
      <View style={styles.section}>
        {(['EUR', 'USD', 'GBP'] as Currency[]).map((c) => (
          <Pressable
            key={c}
            style={[styles.row, { borderBottomWidth: c === 'GBP' ? 0 : 1 }]}
            onPress={() => setCurrency(c)}
          >
            <Text style={styles.rowLabel}>
              {c === 'EUR' ? '🇪🇺 Euro (€)' : c === 'USD' ? '🇺🇸 US Dollar ($)' : '🇬🇧 British Pound (£)'}
            </Text>
            {currency === c && <Text style={styles.checkmark}>✓</Text>}
          </Pressable>
        ))}
      </View>

      {/* About */}
      <Text style={styles.sectionLabel}>ABOUT</Text>
      <View style={styles.section}>
        <View style={[styles.row, { borderBottomWidth: 0 }]}>
          <Text style={styles.rowLabel}>DeckForge</Text>
          <Text style={styles.rowValue}>v1.0.0</Text>
        </View>
      </View>

      {/* Account */}
      <Text style={styles.sectionLabel}>ACCOUNT</Text>
      <View style={styles.section}>
        <Pressable style={[styles.row, { borderBottomWidth: 0 }]} onPress={signOut}>
          <Text style={[styles.rowLabel, { color: colors.danger }]}>Sign out</Text>
        </Pressable>
      </View>

      <View style={{ height: 60 }} />
    </ScrollView>
  );
}

const createStyles = (c: ReturnType<typeof import('../lib/theme').useTheme>['colors']) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },
    content: { paddingBottom: 40 },
    topBar: {
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      paddingHorizontal: 20, paddingTop: 60, paddingBottom: 20,
    },
    title: { color: c.text, fontSize: 18, fontWeight: '700' },
    backBtn: {
      backgroundColor: c.surface, borderColor: c.border, borderWidth: 1,
      paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20,
    },
    backBtnText: { color: c.textMuted, fontSize: 13 },
    sectionLabel: {
      color: c.textDim, fontSize: 11, fontWeight: '700', letterSpacing: 1,
      paddingHorizontal: 20, paddingTop: 20, paddingBottom: 8,
    },
    section: {
      backgroundColor: c.surface, borderColor: c.border, borderWidth: 1,
      borderRadius: 16, marginHorizontal: 20, overflow: 'hidden',
    },
    row: {
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      paddingHorizontal: 16, paddingVertical: 14,
      borderBottomColor: c.border, borderBottomWidth: 1,
    },
    rowLabel: { color: c.text, fontSize: 15 },
    rowValue: { color: c.textMuted, fontSize: 14 },
    checkmark: { color: c.accent, fontSize: 18, fontWeight: '700' },
    usernameInput: { flex: 1, fontSize: 15, paddingVertical: 0 },
    saveBtn: { backgroundColor: c.accent, paddingHorizontal: 14, paddingVertical: 6, borderRadius: 12 },
    saveBtnText: { color: c.accentText, fontWeight: '700', fontSize: 13 },
  });
