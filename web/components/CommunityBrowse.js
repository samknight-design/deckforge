'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { BRACKET_COLORS, BRACKET_LABELS } from '@/lib/brackets';

function PublicDeckCard({ deck }) {
  const hasArt = !!deck.commander_image_url;
  const target = deck.format === 'commander' ? 100 : 60;
  const bColor = deck.bracket ? (BRACKET_COLORS[deck.bracket] || '#64748b') : null;

  return (
    <Link href={`/community/${deck.id}`} className="block">
      <div className="relative rounded-2xl overflow-hidden transition-all active:scale-95" style={{ minHeight: 132 }}>
        {hasArt && (
          <img src={deck.commander_image_url} alt="" className="absolute inset-0 w-full h-full object-cover" style={{ objectPosition: 'center 15%' }} />
        )}
        <div
          className="absolute inset-0"
          style={{
            background: hasArt
              ? 'linear-gradient(160deg, rgba(10,14,26,0.25) 0%, rgba(10,14,26,0.7) 50%, rgba(10,14,26,0.97) 100%)'
              : '#111827',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 16,
          }}
        />
        <div className="relative z-10 p-3 flex flex-col h-full" style={{ minHeight: 132 }}>
          <div className="flex justify-between items-start mb-auto gap-2">
            {bColor ? (
              <span className="text-xs font-semibold rounded-full px-2 py-0.5 backdrop-blur" style={{ background: `${bColor}cc`, color: '#fff', border: `1px solid ${bColor}` }}>
                B{deck.bracket}
              </span>
            ) : <span />}
            <span className="text-xs font-semibold rounded-full px-2 py-0.5 backdrop-blur" style={{ background: 'rgba(245,158,11,0.18)', color: '#fbbf24', border: '1px solid rgba(245,158,11,0.4)' }}>
              👍 {deck.like_count || 0}
            </span>
          </div>
          <div>
            <h3 className="font-bold text-white text-base leading-snug truncate drop-shadow">{deck.name}</h3>
            {deck.commander_name && (
              <p className="text-xs mt-0.5 truncate" style={{ color: 'rgba(255,255,255,0.7)' }}>⚔ {deck.commander_name}</p>
            )}
            <p className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.6)' }}>
              {deck.format === 'commander' ? 'Commander' : '60-Card'} · {deck.card_count || 0}/{target}
            </p>
          </div>
        </div>
      </div>
    </Link>
  );
}

export default function CommunityBrowse({ decks }) {
  const [query, setQuery] = useState('');
  const [format, setFormat] = useState('');   // '' | 'commander' | '60card'
  const [bracket, setBracket] = useState(''); // '' | 1..5
  const [sort, setSort] = useState('likes');  // 'likes' | 'cards'

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = decks.filter((d) => {
      if (format && d.format !== format) return false;
      if (bracket && d.bracket !== parseInt(bracket, 10)) return false;
      if (q) {
        const hay = `${d.name || ''} ${d.commander_name || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    list = [...list].sort((a, b) =>
      sort === 'cards' ? (b.card_count || 0) - (a.card_count || 0) : (b.like_count || 0) - (a.like_count || 0)
    );
    return list;
  }, [decks, query, format, bracket, sort]);

  return (
    <div className="h-full flex flex-col" style={{ background: '#0a0e1a' }}>
      {/* Header */}
      <div className="flex-shrink-0 px-4 pt-6 pb-3" style={{ borderBottom: '1px solid #1e2d47' }}>
        <h1 className="text-xl font-bold text-white mb-0.5">Community Decks</h1>
        <p className="text-xs text-slate-400 mb-3">Browse, like and clone public decks</p>

        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by deck name or commander…"
          className="w-full rounded-xl px-4 py-3 text-sm outline-none mb-2"
          style={{ background: '#111827', border: '1px solid #1e2d47', color: '#f1f5f9', minHeight: 44 }}
        />

        <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
          {[
            { v: '', l: 'All formats' },
            { v: 'commander', l: 'Commander' },
            { v: '60card', l: '60-Card' },
          ].map((f) => (
            <button
              key={f.v}
              onClick={() => setFormat(f.v)}
              className="rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap flex-shrink-0"
              style={{
                background: format === f.v ? '#f59e0b' : 'rgba(30,45,71,0.6)',
                color: format === f.v ? '#0a0e1a' : '#94a3b8',
                minHeight: 28,
              }}
            >
              {f.l}
            </button>
          ))}
          <span className="w-px flex-shrink-0" style={{ background: '#1e2d47' }} />
          {['', '1', '2', '3', '4', '5'].map((b) => (
            <button
              key={b || 'any'}
              onClick={() => setBracket(b)}
              className="rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap flex-shrink-0"
              style={{
                background: bracket === b ? '#7c3aed' : 'rgba(30,45,71,0.6)',
                color: bracket === b ? '#fff' : '#94a3b8',
                minHeight: 28,
              }}
            >
              {b ? `B${b}` : 'Any bracket'}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs text-slate-400">{filtered.length} deck{filtered.length !== 1 ? 's' : ''}</span>
          <button
            onClick={() => setSort(sort === 'likes' ? 'cards' : 'likes')}
            className="text-xs font-medium rounded-lg px-2.5 py-1"
            style={{ background: '#111827', border: '1px solid #1e2d47', color: '#94a3b8' }}
          >
            Sort: {sort === 'likes' ? '👍 Most liked' : '🃏 Most cards'}
          </button>
        </div>

        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="text-5xl mb-4">🌐</div>
            <p className="text-slate-400 text-sm max-w-xs">No public decks match your search yet. Be the first to publish one!</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {filtered.map((d) => <PublicDeckCard key={d.id} deck={d} />)}
          </div>
        )}
      </div>
    </div>
  );
}
