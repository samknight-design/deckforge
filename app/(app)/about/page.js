import { createServiceClient } from '@/lib/supabase/server';
import ResourceHeader from '@/components/ResourceHeader';

export const metadata = { title: 'About · DeckForge' };
export const dynamic = 'force-dynamic';

const APP_VERSION = '1.2.0';

export default async function AboutPage() {
  const svc = createServiceClient();
  const { data: news } = await svc
    .from('news_items')
    .select('kind, title, body, created_at')
    .eq('published', true)
    .order('created_at', { ascending: false })
    .limit(20);

  return (
    <div className="h-full overflow-y-auto" style={{ background: '#0a0e1a' }}>
      <ResourceHeader title="About DeckForge" />
      <div className="px-4 py-4 space-y-4">

        <div className="rounded-2xl p-4 text-center" style={{ background: '#111827', border: '1px solid #1e2d47' }}>
          <div className="text-4xl mb-2">⚔️</div>
          <div className="font-bold text-white text-lg">DeckForge</div>
          <div className="text-xs" style={{ color: '#64748b' }}>Version {APP_VERSION}</div>
          <p className="text-sm mt-3" style={{ color: '#cbd5e1' }}>
            An MTG companion app built for players — scan cards, build and analyse decks, and share them with a community.
          </p>
        </div>

        <div>
          <h3 className="font-bold text-white mb-2 px-1">Update history</h3>
          <div className="rounded-2xl overflow-hidden" style={{ background: '#111827', border: '1px solid #1e2d47' }}>
            {(news || []).length === 0 && (
              <div className="px-3 py-4 text-center text-xs" style={{ color: '#64748b' }}>No updates yet.</div>
            )}
            {(news || []).map((n, i) => (
              <div key={i} className="px-3 py-2.5" style={{ borderBottom: i < news.length - 1 ? '1px solid #1e2d47' : 'none' }}>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-white">{n.title}</span>
                  {n.kind === 'news' && <span className="text-xs rounded px-1.5" style={{ background: 'rgba(245,158,11,0.15)', color: '#f59e0b' }}>News</span>}
                  <span className="ml-auto text-xs" style={{ color: '#475569' }}>{new Date(n.created_at).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}</span>
                </div>
                {n.body && <p className="text-xs mt-0.5" style={{ color: '#94a3b8' }}>{n.body}</p>}
              </div>
            ))}
          </div>
        </div>

        {/* Legally-required attributions only. DeckForge is an independent app —
            mentions below are NOT partnerships, sponsorships or endorsements. */}
        <div className="rounded-xl p-3" style={{ background: '#111827', border: '1px solid #1e2d47' }}>
          <div className="text-xs font-semibold mb-1" style={{ color: '#64748b' }}>ATTRIBUTIONS</div>
          <p className="text-xs leading-relaxed" style={{ color: '#94a3b8' }}>
            Card data and prices courtesy of <a href="https://scryfall.com" target="_blank" rel="noopener noreferrer" style={{ color: '#cbd5e1' }}>Scryfall</a>.
            Magic: The Gathering and all card images are trademarks and copyrights of Wizards of the Coast LLC.
            DeckForge is an independent project and is <strong>not</strong> affiliated with, endorsed by or sponsored by Wizards of the Coast, Scryfall, or any other company.
          </p>
        </div>

      </div>
    </div>
  );
}
