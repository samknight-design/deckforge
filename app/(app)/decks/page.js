import { createClient } from '@/lib/supabase/server';
import DeckListPage from '@/components/DeckListPage';

export default async function DecksPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: decks } = await supabase
    .from('decks')
    .select('*')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false });

  const { data: profile } = await supabase
    .from('profiles')
    .select('tier')
    .eq('id', user.id)
    .single();

  return <DeckListPage decks={decks || []} tier={profile?.tier || 'free'} userId={user.id} />;
}
