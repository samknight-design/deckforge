import { createClient } from '@/lib/supabase/server';
import Scanner from '@/components/Scanner';

export default async function ScanPage({ searchParams }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const [decksResult, profileResult, usageResult] = await Promise.all([
    supabase.from('decks').select('id, name, format').eq('user_id', user.id).order('updated_at', { ascending: false }),
    supabase.from('profiles').select('tier').eq('id', user.id).single(),
    supabase.from('usage').select('scan_count').eq('user_id', user.id).eq('month_year', new Date().toISOString().slice(0, 7)).maybeSingle(),
  ]);

  return (
    <Scanner
      decks={decksResult.data || []}
      tier={profileResult.data?.tier || 'free'}
      scanCount={usageResult.data?.scan_count || 0}
      initialMode={searchParams?.mode || 'Live Scan'}
      initialDeckId={searchParams?.deckId || null}
      userId={user.id}
    />
  );
}
