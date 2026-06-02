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

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  // Fail loudly rather than silently mis-routing requests at runtime.
  throw new Error(
    'Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY. ' +
    'Copy mobile/.env.example to mobile/.env.local and fill them in.'
  );
}

// Temporary diagnostic: prints in the Metro terminal so we can confirm the
// env file is being read and the URL looks right. Remove once auth works.
// eslint-disable-next-line no-console
console.log('[supabase] URL =', SUPABASE_URL, '| anon key length =', SUPABASE_ANON_KEY.length);

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
