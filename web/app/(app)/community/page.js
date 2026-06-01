import { createServiceClient } from '@/lib/supabase/server';
import CommunityBrowse from '@/components/CommunityBrowse';

export const dynamic = 'force-dynamic';

export default async function CommunityPage() {
  // Public reads go through the service client with an explicit is_public filter
  // (no permissive RLS on decks/deck_cards).
  const svc = createServiceClient();
  const { data: decks } = await svc
    .from('decks')
    .select('id, name, format, commander_name, commander_image_url, bracket, like_count, card_count, estimated_value_eur')
    .eq('is_public', true)
    .order('like_count', { ascending: false })
    .limit(100);

  return <CommunityBrowse decks={decks || []} />;
}
