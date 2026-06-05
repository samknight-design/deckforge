// Unified auth resolver for API routes that serve both the web PWA AND the
// React Native mobile app.
//
// Web sends the session via cookies (set by @supabase/ssr). Mobile sends it
// as an Authorization: Bearer <jwt> header (because cookies don't persist
// across cold app starts in a WebView-less native runtime). This helper
// tries Bearer first; falls back to cookies. Either way, returns
// { supabase, user } — or { supabase, user: null } if neither produces a
// signed-in user.
//
// Use this in any /api/* route handler that should accept both clients,
// replacing the bare `createClient()` + `auth.getUser()` pattern.

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function getAuthedSupabase(request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // 1) Bearer token path (mobile). If present, create a client that attaches
  //    it to every request — Supabase then reads the JWT and identifies the
  //    user from the token's claims, no cookies involved.
  const auth = request.headers.get('Authorization') || request.headers.get('authorization');
  if (auth?.startsWith('Bearer ')) {
    const jwt = auth.slice('Bearer '.length).trim();
    if (jwt) {
      const supabase = createServerClient(url, anonKey, {
        cookies: { getAll: () => [], setAll: () => {} },
        global: { headers: { Authorization: `Bearer ${jwt}` } },
      });
      const { data: { user } } = await supabase.auth.getUser();
      if (user) return { supabase, user };
      // Fall through to cookie path if the bearer was somehow invalid.
    }
  }

  // 2) Cookie path (web PWA, same as the legacy lib/supabase/server createClient).
  const cookieStore = cookies();
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() { return cookieStore.getAll(); },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server component — cookies can't be set.
        }
      },
    },
  });
  const { data: { user } } = await supabase.auth.getUser();
  return { supabase, user };
}
