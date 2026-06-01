// Wrapper around fetch() that targets the deckforge Vercel deployment for
// all /api/* calls. The base URL is read from app.json's `extra.apiBaseUrl`
// (via expo-constants), so flipping between staging and prod is a config
// change, not a code change.

import Constants from 'expo-constants';
import { supabase } from './supabase';

const API_BASE: string =
  (Constants.expoConfig?.extra?.apiBaseUrl as string | undefined) ||
  'https://deckforge-eta.vercel.app';

// Authenticated fetch — automatically attaches the current Supabase session
// token as a Bearer header so the Vercel API can identify the user.
//
// Use for /api/* routes. For everything else, just use fetch() directly.
export async function apiFetch(path: string, init: RequestInit = {}) {
  const url = path.startsWith('http') ? path : API_BASE + path;
  const { data: { session } } = await supabase.auth.getSession();
  const headers = new Headers(init.headers || {});
  if (session?.access_token) {
    headers.set('Authorization', `Bearer ${session.access_token}`);
  }
  return fetch(url, { ...init, headers });
}

// Convenience for JSON POSTs.
export async function apiPostJson<T = unknown>(path: string, body: unknown): Promise<T> {
  const res = await apiFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${path} ${res.status}: ${text}`);
  }
  return res.json();
}
