'use client';

// Auth + per-page data fetching for the static-exported native build.
// In SSR mode each page did `supabase.auth.getUser()` + Supabase queries on
// the server, then handed props to a client child. Static export can't run
// that, so we do the same work client-side via this small hook trio.
//
// Pattern:
//   • <AuthProvider> sits in app/(app)/layout.js. It fetches the user once,
//     shows a spinner while loading, redirects to /welcome on no-auth, and
//     exposes the user via context.
//   • Pages call useAuth() to read the user (instant after the layout has
//     loaded), and useInitialData(fetcher) to load their own props.

import { createContext, useContext, useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

const AuthCtx = createContext({ user: null, loading: true });

export function AuthProvider({ children, redirectTo = '/welcome' }) {
  const [state, setState] = useState({ user: null, loading: true });
  const router = useRouter();
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    (async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.replace(redirectTo);
        return;
      }
      setState({ user, loading: false });
    })();
  }, [router, redirectTo]);
  return <AuthCtx.Provider value={state}>{children}</AuthCtx.Provider>;
}

// Read the authenticated user from context. Returns { user: null, loading: true }
// while the layout is still resolving auth.
export function useAuth() {
  return useContext(AuthCtx);
}

// Per-page data loader. Runs once when the user is available. Fetcher receives
// the browser Supabase client + the user, returns whatever the page needs.
//
//   const { loading, data } = useInitialData(async (supabase, user) => {
//     const { data: decks } = await supabase.from('decks').select('*').eq('user_id', user.id);
//     return { decks: decks || [] };
//   });
export function useInitialData(fetcher) {
  const { user, loading: authLoading } = useAuth();
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const ran = useRef(false);

  useEffect(() => {
    if (authLoading || !user || ran.current) return;
    ran.current = true;
    let alive = true;
    (async () => {
      try {
        const supabase = createClient();
        const data = fetcher ? await fetcher(supabase, user) : {};
        if (alive) setState({ loading: false, data, error: null });
      } catch (e) {
        if (alive) setState({ loading: false, data: null, error: e });
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user]);

  return { ...state, user };
}

// Consistent dark-theme spinner used by the layout + per-page loading states.
export function LoadingScreen() {
  return (
    <div className="flex items-center justify-center w-full h-full" style={{ background: '#0a0e1a' }}>
      <div className="w-8 h-8 border-2 rounded-full animate-spin" style={{ borderColor: '#f59e0b', borderTopColor: 'transparent' }} />
    </div>
  );
}
