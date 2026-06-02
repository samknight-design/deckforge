// Phase RN1 milestone screen. Reflects auth state: signed-out shows email +
// "send magic link" + "password sign-in"; signed-in shows user info + sign-out.
// expo-router lands in Phase RN3 — for now this single screen proves Supabase
// works end-to-end on a real device.

import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Linking from 'expo-linking';
import { supabase } from './lib/supabase';
import { TIERS } from '@deckforge/shared/tiers';
import type { Session } from '@supabase/supabase-js';

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [bootstrapped, setBootstrapped] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  // Auth boot: read whatever session exists in SecureStore, subscribe to changes.
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setBootstrapped(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Magic-link callback handler: when the user taps the link in their email,
  // the OS opens deckforge:// → this listener fires → exchange code for session.
  useEffect(() => {
    const handle = async (url: string) => {
      try {
        const parsed = Linking.parse(url);
        const code = (parsed.queryParams?.code as string | undefined) || undefined;
        if (!code) return;
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) Alert.alert('Sign-in failed', error.message);
      } catch (e: any) {
        Alert.alert('Sign-in error', e?.message ?? String(e));
      }
    };
    Linking.getInitialURL().then((u) => { if (u) handle(u); });
    const sub = Linking.addEventListener('url', ({ url }) => handle(url));
    return () => sub.remove();
  }, []);

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
    else Alert.alert('Check your email', `We sent a sign-in link to ${email.trim()}.`);
  };

  const signInWithPassword = async () => {
    if (!email.trim() || !password) { Alert.alert('Email and password required'); return; }
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) Alert.alert('Sign-in failed', error.message);
  };

  const signOut = async () => {
    setBusy(true);
    await supabase.auth.signOut();
    setBusy(false);
  };

  // Phase RN1 diagnostic: hit Supabase's OTP endpoint with a plain fetch,
  // bypassing the SDK. If THIS works but signInWithOtp doesn't, the bug is
  // in the SDK's request construction. If this also fails, it's a deeper
  // RN networking issue. Remove once auth verified working.
  const testRawFetch = async () => {
    if (!email.trim()) { Alert.alert('Email required'); return; }
    setBusy(true);
    try {
      const url = (process.env.EXPO_PUBLIC_SUPABASE_URL || '').trim() + '/auth/v1/otp';
      const anon = (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '').trim();
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: anon,
          Authorization: `Bearer ${anon}`,
        },
        body: JSON.stringify({ email: email.trim(), create_user: true }),
      });
      const text = await res.text();
      Alert.alert(`Raw fetch ${res.status}`, text.slice(0, 500));
    } catch (e: any) {
      Alert.alert('Raw fetch threw', `${e?.name ?? 'Error'}: ${e?.message ?? String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  if (!bootstrapped) {
    return (
      <View style={styles.container}>
        <Text style={styles.subtitle}>Loading…</Text>
        <StatusBar style="light" />
      </View>
    );
  }

  if (!session) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>⚔️ DeckForge</Text>
        <Text style={styles.subtitle}>Sign in to start scanning</Text>
        <TextInput
          style={styles.input}
          placeholder="you@example.com"
          placeholderTextColor="#475569"
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
          editable={!busy}
        />
        <TextInput
          style={styles.input}
          placeholder="password (optional — use magic link instead)"
          placeholderTextColor="#475569"
          autoCapitalize="none"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
          editable={!busy}
        />
        <Pressable
          style={({ pressed }) => [styles.primary, (pressed || busy) && { opacity: 0.6 }]}
          onPress={sendMagicLink}
          disabled={busy}
        >
          <Text style={styles.primaryText}>Send magic link</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.secondary, (pressed || busy) && { opacity: 0.6 }]}
          onPress={signInWithPassword}
          disabled={busy}
        >
          <Text style={styles.secondaryText}>Sign in with password</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.secondary, (pressed || busy) && { opacity: 0.6 }]}
          onPress={testRawFetch}
          disabled={busy}
        >
          <Text style={styles.secondaryText}>🧪 Test raw fetch (diagnostic)</Text>
        </Pressable>
        <StatusBar style="light" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>⚔️ DeckForge</Text>
      <Text style={styles.subtitle}>Signed in</Text>
      <Text style={styles.meta}>{session.user.email ?? '(anonymous)'}</Text>
      <Text style={styles.meta}>id: {session.user.id.slice(0, 8)}…</Text>
      <Text style={styles.meta}>
        Loaded {Object.keys(TIERS).length} tiers from @deckforge/shared
      </Text>
      <Pressable
        style={({ pressed }) => [styles.secondary, (pressed || busy) && { opacity: 0.6 }]}
        onPress={signOut}
        disabled={busy}
      >
        <Text style={styles.secondaryText}>Sign out</Text>
      </Pressable>
      <StatusBar style="light" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0e1a',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  title: { color: '#f59e0b', fontSize: 32, fontWeight: '700', marginBottom: 8 },
  subtitle: { color: '#cbd5e1', fontSize: 16, marginBottom: 16 },
  meta: { color: '#64748b', fontSize: 12, fontFamily: 'monospace', marginBottom: 4 },
  input: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#1a2235',
    borderColor: '#1e2d47',
    borderWidth: 1,
    color: '#f1f5f9',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    marginBottom: 12,
    fontSize: 14,
  },
  primary: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#f59e0b',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 8,
  },
  primaryText: { color: '#0a0e1a', fontSize: 14, fontWeight: '700' },
  secondary: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#1a2235',
    borderColor: '#1e2d47',
    borderWidth: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  secondaryText: { color: '#94a3b8', fontSize: 14, fontWeight: '500' },
});
