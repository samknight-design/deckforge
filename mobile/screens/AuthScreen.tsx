import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { makeRedirectUri } from 'expo-auth-session';
import { supabase } from '../lib/supabase';
import { useTheme } from '../lib/theme';

// Sign-in screen: Google OAuth, magic link, or email+password. Shown by Root when there is
// no Supabase session. Self-contained — drives auth via supabase; Root reacts to the session.
export default function AuthScreen() {
  const { colors } = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const sendMagicLink = async () => {
    if (!email.trim()) { Alert.alert('Email required'); return; }
    setBusy(true);
    const redirectTo = Linking.createURL('/');
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: redirectTo },
    });
    setBusy(false);
    if (error) Alert.alert('Could not send link', error.message);
    else Alert.alert('Check your email', `Sent a sign-in link to ${email.trim()}.`);
  };

  const signInWithPassword = async () => {
    if (!email.trim() || !password) { Alert.alert('Email and password required'); return; }
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) Alert.alert('Sign-in failed', error.message);
  };

  const signInWithGoogle = async () => {
    setBusy(true);
    try {
      const redirectTo = makeRedirectUri();
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo, skipBrowserRedirect: true },
      });
      if (error) throw error;
      if (!data?.url) throw new Error('No OAuth URL from Supabase');
      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
      if (result.type !== 'success' || !result.url) return;
      const parsed = Linking.parse(result.url);
      const code = parsed.queryParams?.code as string | undefined;
      if (!code) throw new Error(`No code in redirect. Raw: ${result.url.slice(0, 200)}`);
      const { error: exErr } = await supabase.auth.exchangeCodeForSession(code);
      if (exErr) throw exErr;
    } catch (e: any) {
      Alert.alert('Google sign-in failed', e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[authStyles.container, { backgroundColor: colors.bg }]}>
      <Text style={[authStyles.logo, { color: colors.accent }]}>⚔️ DeckForge</Text>
      <Text style={[authStyles.tagline, { color: colors.textMuted }]}>
        Scan. Build. Analyse. Conquer.
      </Text>

      <Pressable
        style={({ pressed }) => [authStyles.google, (pressed || busy) && authStyles.dim]}
        onPress={signInWithGoogle}
        disabled={busy}
      >
        <Text style={authStyles.googleText}>🔵 Continue with Google</Text>
      </Pressable>

      <View style={[authStyles.divider]}>
        <View style={[authStyles.divLine, { backgroundColor: colors.border }]} />
        <Text style={[authStyles.divText, { color: colors.textDim }]}>or email</Text>
        <View style={[authStyles.divLine, { backgroundColor: colors.border }]} />
      </View>

      <TextInput
        style={[authStyles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
        placeholder="you@example.com"
        placeholderTextColor={colors.textDim}
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
        editable={!busy}
      />
      <TextInput
        style={[authStyles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
        placeholder="password (optional)"
        placeholderTextColor={colors.textDim}
        autoCapitalize="none"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
        editable={!busy}
      />

      <Pressable
        style={({ pressed }) => [authStyles.primary, { backgroundColor: colors.accent }, (pressed || busy) && authStyles.dim]}
        onPress={sendMagicLink}
        disabled={busy}
      >
        <Text style={[authStyles.primaryText, { color: colors.accentText }]}>Send magic link</Text>
      </Pressable>
      <Pressable
        style={({ pressed }) => [authStyles.secondary, { backgroundColor: colors.surface, borderColor: colors.border }, (pressed || busy) && authStyles.dim]}
        onPress={signInWithPassword}
        disabled={busy}
      >
        <Text style={[authStyles.secondaryText, { color: colors.textMuted }]}>Sign in with password</Text>
      </Pressable>

      <StatusBar style="light" />
    </View>
  );
}

const authStyles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  logo: { fontSize: 36, fontWeight: '900', marginBottom: 8 },
  tagline: { fontSize: 14, marginBottom: 32, textAlign: 'center' },
  google: {
    width: '100%', maxWidth: 360, backgroundColor: '#fff',
    paddingVertical: 14, borderRadius: 12, alignItems: 'center', marginBottom: 16,
  },
  googleText: { color: '#0a0e1a', fontSize: 14, fontWeight: '600' },
  divider: { flexDirection: 'row', alignItems: 'center', width: '100%', maxWidth: 360, marginVertical: 16 },
  divLine: { flex: 1, height: 1 },
  divText: { fontSize: 11, paddingHorizontal: 12 },
  input: {
    width: '100%', maxWidth: 360, borderWidth: 1, paddingHorizontal: 16,
    paddingVertical: 12, borderRadius: 12, marginBottom: 12, fontSize: 14,
  },
  primary: {
    width: '100%', maxWidth: 360, paddingVertical: 14,
    borderRadius: 12, alignItems: 'center', marginBottom: 10,
  },
  primaryText: { fontSize: 14, fontWeight: '700' },
  secondary: {
    width: '100%', maxWidth: 360, borderWidth: 1,
    paddingVertical: 14, borderRadius: 12, alignItems: 'center',
  },
  secondaryText: { fontSize: 14, fontWeight: '500' },
  dim: { opacity: 0.6 },
});
