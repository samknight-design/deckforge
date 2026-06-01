'use client';

// Was a server component that fetched decks/profile/usage on the server.
// Now client-side via useInitialData (works in static export, identical UX
// once the data loads).

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useInitialData, LoadingScreen } from '@/lib/useInitialData';
import Scanner from '@/components/Scanner';

function ScanPageInner() {
  const searchParams = useSearchParams();
  const { loading, data, user } = useInitialData(async (supabase, user) => {
    const [decksResult, profileResult, usageResult] = await Promise.all([
      supabase.from('decks').select('id, name, format').eq('user_id', user.id).order('updated_at', { ascending: false }),
      supabase.from('profiles').select('tier').eq('id', user.id).single(),
      supabase.from('usage').select('scan_count').eq('user_id', user.id).eq('month_year', new Date().toISOString().slice(0, 7)).maybeSingle(),
    ]);
    return {
      decks: decksResult.data || [],
      tier: profileResult.data?.tier || 'free',
      scanCount: usageResult.data?.scan_count || 0,
    };
  });

  if (loading || !data) return <LoadingScreen />;
  return (
    <Scanner
      decks={data.decks}
      tier={data.tier}
      scanCount={data.scanCount}
      initialMode={searchParams?.get('mode') || 'Live Scan'}
      initialDeckId={searchParams?.get('deckId') || null}
      userId={user.id}
    />
  );
}

export default function ScanPage() {
  // useSearchParams() must be wrapped in Suspense or static-export build fails.
  return (
    <Suspense fallback={<LoadingScreen />}>
      <ScanPageInner />
    </Suspense>
  );
}
