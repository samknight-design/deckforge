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
            The MTG companion built for players — scan, build, analyse and share decks, with AI insights and a friendly community.
          </p>
        </div>

        <div className="rounded-2xl p-4" style={{ background: '#111827', border: '1px solid #1e2d47' }}>
          <h3 className="font-bold text-white mb-2">Partners</h3>
          <ul className="text-sm space-y-1.5" style={{ color: '#cbd5e1' }}>
            <li>🃏 <strong className="text-white">Scryfall</strong> — card data partner (prices, images, sets).</li>
            <li>✨ <strong className="text-white">Anthropic Claude</strong> — vision scanning and deck insights.</li>
            <li>🗄️ <strong className="text-white">Supabase</strong> — auth, database and storage.</li>
            <li>▲ <strong className="text-white">Vercel</strong> — hosting.</li>
            <li>💳 <strong className="text-white">Stripe</strong> — secure payments.</li>
          </ul>
          <p className="text-xs mt-3" style={{ color: '#475569' }}>Magic: The Gathering is a trademark of Wizards of the Coast. DeckForge is an independent fan project and is not affiliated with WotC.</p>
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

      </div>
    </div>
  );
}
