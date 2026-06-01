import Link from 'next/link';
import Avatar from './Avatar';
import { BRACKET_COLORS } from '@/lib/brackets';
import { TIERS, BOLT_ONS, CURRENCY, levelProgress } from '@/lib/tiers';

const fmtPrice = (p) => `${CURRENCY}${p.toFixed(2)}`;

// In-app reference pages (replaces the old external link soup).
const RESOURCES = [
  { label: 'Rules', icon: '📖', href: '/rules' },
  { label: 'Brackets', icon: '🎚️', href: '/brackets' },
  { label: 'Ban list', icon: '🚫', href: '/banlist' },
];

// Fallback updates if the news_items table is empty.
const WHATS_NEW = [
  { title: 'Community decks', body: 'Publish your decks, browse others, like and clone them.' },
  { title: 'Insights dashboard + brackets', body: 'AI insights now show a bracket, power level, and cards to add or cut.' },
];

function TopDeckCard({ deck }) {
  const hasArt = !!deck.commander_image_url;
  const bColor = deck.bracket ? (BRACKET_COLORS[deck.bracket] || '#64748b') : null;
  return (
    <Link href={`/community/${deck.id}`} className="block flex-shrink-0" style={{ width: 150 }}>
      <div className="relative rounded-2xl overflow-hidden" style={{ height: 120 }}>
        {hasArt && <img src={deck.commander_image_url} alt="" className="absolute inset-0 w-full h-full object-cover" style={{ objectPosition: 'center 15%' }} />}
        <div className="absolute inset-0" style={{ background: hasArt ? 'linear-gradient(160deg, rgba(10,14,26,0.2), rgba(10,14,26,0.95))' : '#111827', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16 }} />
        <div className="relative z-10 p-2.5 flex flex-col h-full justify-between">
          <div className="flex justify-between">
            {bColor ? (
              <span className="text-xs font-semibold rounded-full px-1.5 py-0.5 backdrop-blur" style={{ background: `${bColor}cc`, color: '#fff' }}>B{deck.bracket}</span>
            ) : <span />}
            <span className="text-xs font-semibold rounded-full px-1.5 py-0.5 backdrop-blur" style={{ background: 'rgba(245,158,11,0.2)', color: '#fbbf24' }}>👍 {deck.like_count || 0}</span>
          </div>
          <div>
            <h4 className="text-sm font-bold text-white leading-tight truncate drop-shadow">{deck.name}</h4>
            {deck.commander_name && <p className="text-xs truncate" style={{ color: 'rgba(255,255,255,0.65)' }}>{deck.commander_name}</p>}
          </div>
        </div>
      </div>
    </Link>
  );
}

export default function HomePage({ topDecks, news, profile, isAnon }) {
  const updates = (news && news.length) ? news : WHATS_NEW;
  const tierCfg = TIERS[profile?.tier] || TIERS.free;
  const lvl = levelProgress(profile?.xp || 0);

  return (
    <div className="h-full overflow-y-auto" style={{ background: '#0a0e1a' }}>
      {/* Identity header */}
      <div className="px-4 pt-5 pb-4" style={{ background: '#111827', borderBottom: '1px solid #1e2d47' }}>
        <div className="flex items-center gap-3">
          <Link href="/profile"><Avatar avatarKey={profile?.avatar_key} size={52} ring={tierCfg.color} /></Link>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <Link href="/profile" className="min-w-0">
                <div className="font-bold text-white truncate">{isAnon ? 'Guest' : (profile?.username || 'Set a nickname')}</div>
                <div className="text-xs" style={{ color: '#a78bfa' }}>{tierCfg.icon} {tierCfg.name} · Level {lvl.level}</div>
              </Link>
              {isAnon && (
                <Link href="/login" className="flex-shrink-0 text-xs font-bold rounded-full px-3 py-1.5" style={{ background: '#f59e0b', color: '#0a0e1a' }}>
                  Sign in
                </Link>
              )}
            </div>
            <Link href="/rewards" className="block mt-2">
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: '#1e2d47' }}>
                <div className="h-full rounded-full" style={{ width: `${Math.min(100, (lvl.into / lvl.span) * 100)}%`, background: 'linear-gradient(90deg,#7c3aed,#f59e0b)' }} />
              </div>
            </Link>
          </div>
        </div>
        {isAnon && (
          <p className="text-xs mt-3" style={{ color: '#64748b' }}>You’re playing as a guest — sign in to save your decks, XP and progress.</p>
        )}
      </div>

      <div className="pt-4">
        {/* Top decks */}
        <div className="mb-6">
          <div className="flex items-center justify-between px-4 mb-2">
            <h2 className="text-sm font-bold text-white">🔥 Featured decks</h2>
          </div>
          {topDecks.length === 0 ? (
            <div className="mx-4 rounded-xl px-4 py-6 text-center" style={{ background: '#111827', border: '1px solid #1e2d47' }}>
              <p className="text-sm" style={{ color: '#64748b' }}>No public decks yet — publish one from its page to feature here.</p>
            </div>
          ) : (
            <div className="flex gap-3 overflow-x-auto px-4 pb-1" style={{ scrollbarWidth: 'none' }}>
              {topDecks.map((d) => <TopDeckCard key={d.id} deck={d} />)}
            </div>
          )}
          <div className="px-4 mt-2">
            <Link href="/community" className="text-xs font-semibold" style={{ color: '#f59e0b' }}>Browse all public decks →</Link>
          </div>
        </div>

        {/* Reference squares */}
        <div className="px-4 mb-6">
          <div className="grid grid-cols-3 gap-2">
            {RESOURCES.map((r) => (
              <Link
                key={r.href}
                href={r.href}
                className="flex flex-col items-center justify-center gap-1.5 rounded-2xl"
                style={{ background: '#111827', border: '1px solid #1e2d47', aspectRatio: '1 / 1' }}
              >
                <span className="text-2xl">{r.icon}</span>
                <span className="text-xs font-semibold text-white">{r.label}</span>
              </Link>
            ))}
          </div>
        </div>

        {/* Plans & top-ups */}
        <div className="px-4 mb-6">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-bold text-white">⚡ Upgrade</h2>
            <Link href="/profile" className="text-xs font-medium" style={{ color: '#f59e0b' }}>Manage →</Link>
          </div>
          <div className="grid grid-cols-2 gap-2 mb-2">
            {['pro', 'legendary'].map((key) => {
              const t = TIERS[key];
              return (
                <Link key={key} href="/profile" className="rounded-2xl p-3" style={{ background: '#111827', border: `1px solid ${t.color}55` }}>
                  <div className="font-bold text-sm" style={{ color: t.color }}>{t.icon} {t.name}</div>
                  <div className="text-lg font-bold text-white mt-0.5">{fmtPrice(t.price)}<span className="text-xs font-normal" style={{ color: '#64748b' }}>/mo</span></div>
                  <div className="text-xs mt-1" style={{ color: '#94a3b8' }}>{t.scans.toLocaleString()} scans · {t.insights} insights</div>
                </Link>
              );
            })}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {BOLT_ONS.map((b) => (
              <Link key={b.key} href="/profile" className="rounded-xl p-2.5 flex items-center justify-between" style={{ background: '#111827', border: '1px solid #1e2d47' }}>
                <span className="text-xs font-semibold text-white">{b.label}</span>
                <span className="text-xs font-semibold" style={{ color: '#10b981' }}>{fmtPrice(b.price)}</span>
              </Link>
            ))}
          </div>
        </div>

        {/* What's new */}
        <div className="px-4 pb-8">
          <h2 className="text-sm font-bold text-white mb-2">✨ What's new</h2>
          <div className="rounded-xl overflow-hidden" style={{ background: '#111827', border: '1px solid #1e2d47' }}>
            {updates.map((n, i) => {
              const inner = (
                <>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-white">{n.title}</span>
                    {n.kind === 'news' && <span className="text-xs rounded px-1.5" style={{ background: 'rgba(245,158,11,0.15)', color: '#f59e0b' }}>News</span>}
                  </div>
                  {n.body && <p className="text-xs mt-0.5" style={{ color: '#94a3b8' }}>{n.body}</p>}
                </>
              );
              const style = { borderBottom: i < updates.length - 1 ? '1px solid #1e2d47' : 'none' };
              return n.url ? (
                <a key={i} href={n.url} target="_blank" rel="noopener noreferrer" className="block px-3 py-2.5" style={style}>{inner}</a>
              ) : (
                <div key={i} className="px-3 py-2.5" style={style}>{inner}</div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
