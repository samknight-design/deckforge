// First-time onboarding screen. Shown when profile.username is null.
// Cannot be skipped — the user must set a username + avatar before entering the app.
// Step 1: pick username (unique, 3–20 chars, alphanumeric + underscore)
// Step 2: pick avatar from the emoji grid
// On submit → updates profile → calls onComplete to enter the app.

import { useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { updateProfile } from '../lib/db';
import { useTheme } from '../lib/theme';
import { AVATAR_OPTIONS } from '../lib/avatars';

type Step = 'username' | 'avatar';

export default function OnboardingScreen({
  userId,
  onComplete,
}: {
  userId: string;
  onComplete: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [step, setStep] = useState<Step>('username');
  const [username, setUsername] = useState('');
  const [selectedAvatar, setSelectedAvatar] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Slide animation between steps
  const slideAnim = useRef(new Animated.Value(0)).current;

  const goToAvatarStep = () => {
    const trimmed = username.trim();
    if (trimmed.length < 3) { setError('Must be at least 3 characters'); return; }
    if (trimmed.length > 20) { setError('Must be 20 characters or fewer'); return; }
    if (!/^[a-zA-Z0-9_]+$/.test(trimmed)) { setError('Only letters, numbers and underscores'); return; }
    setError(null);
    setStep('avatar');
    Animated.spring(slideAnim, { toValue: 1, useNativeDriver: true, friction: 10, tension: 120 }).start();
  };

  const handleSubmit = async () => {
    if (!selectedAvatar) { setError('Please pick an avatar'); return; }
    setSaving(true);
    setError(null);
    const result = await updateProfile(userId, { username: username.trim(), avatar_key: selectedAvatar });
    if (result.error) {
      setError(result.error);
      setSaving(false);
      // Username taken — go back to username step
      if (result.error.includes('taken')) {
        setStep('username');
        Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, friction: 10, tension: 120 }).start();
      }
      return;
    }
    onComplete();
  };

  const stepTranslate = slideAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -40],
  });

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.logo}>⚔️ DeckForge</Text>
        <Text style={styles.subtitle}>Let's set up your profile</Text>
      </View>

      {/* Step indicators */}
      <View style={styles.stepRow}>
        <View style={[styles.stepDot, styles.stepDotActive]} />
        <View style={[styles.stepLine, step === 'avatar' && styles.stepLineActive]} />
        <View style={[styles.stepDot, step === 'avatar' && styles.stepDotActive]} />
      </View>
      <View style={styles.stepLabelRow}>
        <Text style={[styles.stepLabel, step === 'username' && { color: colors.accent }]}>Username</Text>
        <Text style={[styles.stepLabel, step === 'avatar' && { color: colors.accent }]}>Avatar</Text>
      </View>

      {/* Step 1 — Username */}
      {step === 'username' && (
        <ScrollView contentContainerStyle={styles.stepContent} keyboardShouldPersistTaps="handled">
          <Text style={styles.stepTitle}>Choose your username</Text>
          <Text style={styles.stepDesc}>This is how other players will see you. It must be unique and can be changed later.</Text>

          <TextInput
            style={[styles.input, !!error && { borderColor: colors.danger }]}
            placeholder="e.g. CardMaster99"
            placeholderTextColor={colors.textDim}
            value={username}
            onChangeText={(t) => { setUsername(t); setError(null); }}
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            maxLength={20}
            returnKeyType="next"
            onSubmitEditing={goToAvatarStep}
          />

          {/* Character count */}
          <Text style={[styles.charCount, username.length > 18 && { color: colors.danger }]}>
            {username.length}/20
          </Text>

          {error && <Text style={styles.errorText}>{error}</Text>}

          <Text style={styles.rules}>Letters, numbers and underscores only · 3–20 characters</Text>

          <Pressable
            style={[styles.primaryBtn, (!username.trim() || username.trim().length < 3) && { opacity: 0.4 }]}
            onPress={goToAvatarStep}
            disabled={!username.trim() || username.trim().length < 3}
          >
            <Text style={styles.primaryBtnText}>Continue →</Text>
          </Pressable>
        </ScrollView>
      )}

      {/* Step 2 — Avatar */}
      {step === 'avatar' && (
        <View style={styles.stepContent}>
          <Text style={styles.stepTitle}>Pick your avatar</Text>
          <Text style={styles.stepDesc}>
            More avatars unlock as you level up. You can always change this later.
          </Text>

          <FlatList
            data={AVATAR_OPTIONS}
            keyExtractor={(a) => a.key}
            numColumns={4}
            scrollEnabled={false}
            columnWrapperStyle={{ gap: 12, marginBottom: 12 }}
            contentContainerStyle={{ paddingVertical: 8 }}
            renderItem={({ item }) => {
              const isSelected = selectedAvatar === item.key;
              return (
                <Pressable
                  style={[
                    styles.avatarOption,
                    { borderColor: isSelected ? colors.accent : colors.border },
                    isSelected && { backgroundColor: 'rgba(245,158,11,0.12)' },
                  ]}
                  onPress={() => { setSelectedAvatar(item.key); setError(null); }}
                >
                  <Text style={styles.avatarEmoji}>{item.emoji}</Text>
                </Pressable>
              );
            }}
          />

          {error && <Text style={styles.errorText}>{error}</Text>}

          <View style={styles.btnRow}>
            <Pressable
              style={styles.secondaryBtn}
              onPress={() => {
                setStep('username');
                Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, friction: 10, tension: 120 }).start();
              }}
            >
              <Text style={styles.secondaryBtnText}>← Back</Text>
            </Pressable>
            <Pressable
              style={[styles.primaryBtn, { flex: 2 }, (!selectedAvatar || saving) && { opacity: 0.4 }]}
              onPress={handleSubmit}
              disabled={!selectedAvatar || saving}
            >
              {saving
                ? <ActivityIndicator color={colors.accentText} size="small" />
                : <Text style={styles.primaryBtnText}>Enter DeckForge ⚔️</Text>}
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

const createStyles = (c: ReturnType<typeof import('../lib/theme').useTheme>['colors']) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },
    header: { alignItems: 'center', paddingTop: 80, paddingBottom: 32 },
    logo: { color: c.accent, fontSize: 34, fontWeight: '900', marginBottom: 8 },
    subtitle: { color: c.textMuted, fontSize: 16 },
    stepRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 0, paddingHorizontal: 80 },
    stepDot: {
      width: 12, height: 12, borderRadius: 6,
      backgroundColor: c.border, borderWidth: 2, borderColor: c.border,
    },
    stepDotActive: { backgroundColor: c.accent, borderColor: c.accent },
    stepLine: { flex: 1, height: 2, backgroundColor: c.border },
    stepLineActive: { backgroundColor: c.accent },
    stepLabelRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 72, marginTop: 6, marginBottom: 32 },
    stepLabel: { color: c.textDim, fontSize: 12, fontWeight: '600' },
    stepContent: { flex: 1, paddingHorizontal: 24 },
    stepTitle: { color: c.text, fontSize: 24, fontWeight: '700', marginBottom: 8 },
    stepDesc: { color: c.textMuted, fontSize: 14, lineHeight: 20, marginBottom: 24 },
    input: {
      backgroundColor: c.surface, borderColor: c.border, borderWidth: 1.5,
      borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14,
      color: c.text, fontSize: 17, marginBottom: 6,
    },
    charCount: { color: c.textDim, fontSize: 11, textAlign: 'right', marginBottom: 8 },
    errorText: { color: c.danger, fontSize: 13, marginBottom: 12 },
    rules: { color: c.textDim, fontSize: 12, marginBottom: 24 },
    avatarOption: {
      flex: 1, aspectRatio: 1, backgroundColor: c.surface, borderWidth: 2,
      borderRadius: 16, alignItems: 'center', justifyContent: 'center',
    },
    avatarEmoji: { fontSize: 32 },
    btnRow: { flexDirection: 'row', gap: 10, marginTop: 8 },
    primaryBtn: {
      backgroundColor: c.accent, paddingVertical: 16,
      borderRadius: 14, alignItems: 'center', marginTop: 8,
    },
    primaryBtnText: { color: c.accentText, fontWeight: '700', fontSize: 16 },
    secondaryBtn: {
      flex: 1, backgroundColor: c.surface, borderColor: c.border, borderWidth: 1,
      paddingVertical: 16, borderRadius: 14, alignItems: 'center', marginTop: 8,
    },
    secondaryBtnText: { color: c.textMuted, fontWeight: '600' },
  });
