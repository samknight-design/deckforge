import { createClient } from '@/lib/supabase/server';
import Scanner from '@/components/Scanner';

export default async function ScanPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: decks } = await supabase
    .from('decks')
    .select('id, name, format')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false });

  const { data: profile } = await supabase
    .from('profiles')
    .select('tier')
    .eq('id', user.id)
    .single();

  // Get current month usage
  const monthYear = new Date().toISOString().slice(0, 7).replace('-', '-');
  const { data: usage } = await supabase
    .from('usage')
    .select('scan_count')
    .eq('user_id', user.id)
    .eq('month_year', monthYear)
    .maybeSingle();

  return (
    <Scanner
      decks={decks || []}
      tier={profile?.tier || 'free'}
      scanCount={usage?.scan_count || 0}
    />
  );
}
