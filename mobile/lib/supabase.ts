// Supabase client for the React Native app.
//
// Sessions persist via expo-secure-store (encrypted Keychain on iOS,
// EncryptedSharedPreferences on Android), NOT cookies. The web app uses
// @supabase/ssr's cookie-based session — different storage, same backend.
//
// SUPABASE_URL + SUPABASE_ANON_KEY come from mobile/.env.local at build time
// via Expo's EXPO_PUBLIC_* convention. The anon key is *designed* to be
// shipped to clients (RLS protects the data); it isn't a secret.

import 'react-native-url-polyfill/auto'; // Supabase JS uses URL/URLSearchParams; RN needs the polyfill
import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';

// .trim() defensively — copy-paste from Notepad / VS Code sometimes drags a
// trailing newline that breaks URL concatenation when the SDK builds e.g.
// `${URL}/auth/v1/otp`. Cheap insurance, harmless on clean values.
const SUPABASE_URL = (process.env.EXPO_PUBLIC_SUPABASE_URL || '').trim();
const SUPABASE_ANON_KEY = (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '').trim();

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  // Fail loudly rather than silently mis-routing requests at runtime.
  throw new Error(
    'Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY. ' +
    'Copy mobile/.env.example to mobile/.env.local and fill them in.'
  );
}

// Temporary diagnostic: char-by-char dump of the URL so we can see whitespace
// or hidden characters. Anon key prints length + first/last 4 chars. Remove
// once auth works.
// eslint-disable-next-line no-console
console.log('[supabase] URL length:', SUPABASE_URL.length, '| URL chars:', JSON.stringify(SUPABASE_URL));
// eslint-disable-next-line no-console
console.log('[supabase] anon key length:', SUPABASE_ANON_KEY.length, '| starts:', SUPABASE_ANON_KEY.slice(0, 4), '| ends:', SUPABASE_ANON_KEY.slice(-4));

// SecureStore-backed storage adapter for Supabase auth. Supabase reads/writes
// the session object as a JSON string under one key; SecureStore handles the
// encrypted persistence. Token refresh, sign-out, etc. all flow through here.
const secureStorage = {
  async getItem(key: string) {
    return SecureStore.getItemAsync(key);
  },
  async setItem(key: string, value: string) {
    await SecureStore.setItemAsync(key, value);
  },
  async removeItem(key: string) {
    await SecureStore.deleteItemAsync(key);
  },
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: secureStorage,
    autoRefreshToken: true,
    persistSession: true,
    // RN has no built-in URL bar; we handle redirect callbacks via expo-linking,
    // not URL detection.
    detectSessionInUrl: false,
  },
});
