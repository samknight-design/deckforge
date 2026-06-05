// Phase RN1 milestone screen. Reflects auth state: signed-out shows email +
// "send magic link" + "password sign-in"; signed-in shows user info + sign-out.
// expo-router lands in Phase RN3 — for now this single screen proves Supabase
// works end-to-end on a real device.

import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { makeRedirectUri } from 'expo-auth-session';
import { supabase } from './lib/supabase';
import type { Session } from '@supabase/supabase-js';
import type { Deck } from './lib/db';
import ScanScreen from './screens/ScanScreen';
import DecksScreen from './screens/DecksScreen';
import DeckDetailScreen from './screens/DeckDetailScreen';

// Required for the in-app browser session to dismiss correctly when the
// OAuth provider redirects back to us. Calling this once at module scope is
// the documented pattern; safe to call even if there's no pending session.
WebBrowser.maybeCompleteAuthSession();

// Lightweight nav state machine. Avoids pulling in expo-router (which would
// mean restructuring the entry point) — fine while the app has a handful of
// screens. `deck` carries context for scan-into-deck + deck detail.
type Nav =
  | { screen: 'home' }
  | { screen: 'scan'; deck?: Deck | null }
  | { screen: 'decks' }
  | { screen: 'deckDetail'; deck: Deck };

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [bootstrapped, setBootstrapped] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [nav, setNav] = useState<Nav>({ screen: 'home' });

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

  // Google OAuth via PKCE:
  //   1. Ask Supabase for the Google authorize URL with skipBrowserRedirect.
  //   2. Open it in a system in-app browser (SFAuthenticationSession on iOS /
  //      Custom Tabs on Android) via WebBrowser.openAuthSessionAsync.
  //   3. After Google → Supabase → our redirectTo, the browser closes and
  //      returns the redirect URL.
  //   4. Parse out ?code= and exchange it for a session.
  const signInWithGoogle = async () => {
    setBusy(true);
    try {
      const redirectTo = makeRedirectUri();
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo, skipBrowserRedirect: true },
      });
      if (error) throw error;
      if (!data?.url) throw new Error('No OAuth URL returned from Supabase');

      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
      if (result.type !== 'success' || !result.url) {
        // User cancelled — no error, just nothing happens.
        return;
      }
      // Diagnostic: print the raw redirect URL on failure paths. Safe to log
      // briefly — the code is single-use and our anon key is already shipped.
      // Remove once Google auth verified working.
      // eslint-disable-next-line no-console
      console.log('[oauth] redirect URL:', result.url);
      const parsed = Linking.parse(result.url);
      const code = parsed.queryParams?.code as string | undefined;
      if (!code) throw new Error(`No 'code' in OAuth redirect URL. Raw: ${result.url.slice(0, 200)}`);
      const { error: exErr } = await supabase.auth.exchangeCodeForSession(code);
      if (exErr) throw exErr;
    } catch (e: any) {
      Alert.alert('Google sign-in failed', e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    setBusy(true);
    await supabase.auth.signOut();
    setBusy(false);
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
          style={({ pressed }) => [styles.google, (pressed || busy) && { opacity: 0.6 }]}
          onPress={signInWithGoogle}
          disabled={busy}
        >
          <Text style={styles.googleText}>🔵 Continue with Google</Text>
        </Pressable>
        <View style={styles.divider}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>or with email</Text>
          <View style={styles.dividerLine} />
        </View>
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
        <StatusBar style="light" />
      </View>
    );
  }

  const userId = session.user.id;

  if (nav.screen === 'scan') {
    return (
      <ScanScreen
        userId={userId}
        targetDeck={nav.deck}
        onBack={() => setNav(nav.deck ? { screen: 'deckDetail', deck: nav.deck } : { screen: 'home' })}
      />
    );
  }

  if (nav.screen === 'decks') {
    return (
      <DecksScreen
        userId={userId}
        onBack={() => setNav({ screen: 'home' })}
        onOpenDeck={(deck) => setNav({ screen: 'deckDetail', deck })}
      />
    );
  }

  if (nav.screen === 'deckDetail') {
    return (
      <DeckDetailScreen
        deck={nav.deck}
        onBack={() => setNav({ screen: 'decks' })}
        onScanInto={(deck) => setNav({ screen: 'scan', deck })}
      />
    );
  }

  // Home
  return (
    <View style={styles.container}>
      <Text style={styles.title}>⚔️ DeckForge</Text>
      <Text style={styles.subtitle}>{session.user.email ?? 'Signed in'}</Text>
      <Pressable
        style={({ pressed }) => [styles.primary, pressed && { opacity: 0.6 }]}
        onPress={() => setNav({ screen: 'scan' })}
      >
        <Text style={styles.primaryText}>📷 Scan a card</Text>
      </Pressable>
      <Pressable
        style={({ pressed }) => [styles.secondary, pressed && { opacity: 0.6 }]}
        onPress={() => setNav({ screen: 'decks' })}
      >
        <Text style={styles.secondaryText}>🗂️ My Decks</Text>
      </Pressable>
      <Pressable
        style={({ pressed }) => [styles.signout, (pressed || busy) && { opacity: 0.6 }]}
        onPress={signOut}
        disabled={busy}
      >
        <Text style={styles.signoutText}>Sign out</Text>
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
  signout: { marginTop: 24, paddingVertical: 8 },
  signoutText: { color: '#475569', fontSize: 13 },
  google: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#fff',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 12,
  },
  googleText: { color: '#0a0e1a', fontSize: 14, fontWeight: '600' },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    maxWidth: 360,
    marginVertical: 12,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: '#1e2d47' },
  dividerText: { color: '#64748b', fontSize: 11, paddingHorizontal: 12 },
});
