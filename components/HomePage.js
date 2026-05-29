import Link from 'next/link';
import { BRACKET_COLORS } from '@/lib/brackets';
import { TIERS, TIER_ORDER, BOLT_ONS, CURRENCY } from '@/lib/tiers';

const fmtPrice = (p) => `${CURRENCY}${p.toFixed(2)}`;

// Curated MTG resources (official links open in a new tab).
const RESOURCES = [
  { label: 'Comprehensive Rules', desc: 'The full official rulebook', href: 'https://magic.wizards.com/en/rules', icon: '📖' },
  { label: 'Commander Brackets', desc: 'How power brackets work', href: 'https://magic.wizards.com/en/news/announcements/introducing-commander-brackets-beta', icon: '🎚️' },
  { label: 'Banned & Restricted', desc: 'Current ban lists by format', href: 'https://magic.wizards.com/en/banned-restricted-list', icon: '🚫' },
  { label: 'Scryfall', desc: 'Search every card', href: 'https://scryfall.com', icon: '🔎' },
];

// In-app changelog (newest first) — maintained here.
const WHATS_NEW = [
  { date: 'May 2026', title: 'Community decks', body: 'Publish your decks, browse others, like and clone them.' },
  { date: 'May 2026', title: 'Insights dashboard + brackets', body: 'AI insights now show a bracket, power level, and cards to add or cut.' },
  { date: 'May 2026', title: 'Smarter scanning', body: 'Exact-printing detection (full art, set, foil) and a Pro Quick Scan mode.' },
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

const QUICK_LINKS = [
  { href: '/decks', icon: '🗂️', label: 'My Decks' },
  { href: '/scan', icon: '📷', label: 'Scan' },
  { href: '/community', icon: '🌐', label: 'Community' },
];

export default function HomePage({ topDecks, news }) {
  const updates = (news && news.length) ? news : WHATS_NEW;
  return (
    <div className="h-full overflow-y-auto" style={{ background: '#0a0e1a' }}>
      {/* Hero */}
      <div className="px-4 pt-6 pb-4">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-2xl">⚔️</span>
          <h1 className="text-xl font-bold text-white">DeckForge</h1>
        </div>
        <p className="text-sm" style={{ color: '#64748b' }}>Your MTG companion — scan, build, analyse, share.</p>
      </div>

      {/* Quick links */}
      <div className="px-4 mb-6">
        <div className="grid grid-cols-3 gap-2">
          {QUICK_LINKS.map((q) => (
            <Link
              key={q.href}
              href={q.href}
              className="flex flex-col items-center gap-1.5 rounded-xl py-3 text-xs font-medium"
              style={{ background: '#111827', border: '1px solid #1e2d47', color: '#94a3b8', minHeight: 64 }}
            >
              <span className="text-xl">{q.icon}</span>
              <span>{q.label}</span>
            </Link>
          ))}
        </div>
      </div>

      {/* Top decks this week */}
      <div className="mb-6">
        <div className="flex items-center justify-between px-4 mb-2">
          <h2 className="text-sm font-bold text-white">🔥 Top decks this week</h2>
          <Link href="/community" className="text-xs font-medium" style={{ color: '#f59e0b' }}>Browse all →</Link>
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
      </div>

      {/* Rules & resources */}
      <div className="px-4 mb-6">
        <h2 className="text-sm font-bold text-white mb-2">📚 Rules & resources</h2>
        <div className="grid grid-cols-2 gap-2">
          {RESOURCES.map((r) => (
            <a
              key={r.label}
              href={r.href}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-xl p-3"
              style={{ background: '#111827', border: '1px solid #1e2d47' }}
            >
              <div className="text-lg mb-1">{r.icon}</div>
              <div className="text-sm font-semibold text-white leading-tight">{r.label}</div>
              <div className="text-xs mt-0.5" style={{ color: '#64748b' }}>{r.desc}</div>
            </a>
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
  );
}
