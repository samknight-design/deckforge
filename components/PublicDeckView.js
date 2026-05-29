'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { groupCardsByType, exportDecklist } from '@/lib/deckUtils';
import { BRACKET_COLORS, BRACKET_LABELS } from '@/lib/brackets';
import { showToast } from './Toast';
import StatsPanel from './StatsPanel';
import LikeButton from './LikeButton';

function ReadOnlyRow({ card }) {
  return (
    <div className="flex items-center gap-3 py-2 px-2">
      {card.image_uri ? (
        <img src={card.image_uri} alt="" className="rounded-lg flex-shrink-0" style={{ width: 32, height: 45, objectFit: 'cover' }} />
      ) : (
        <div className="rounded-lg flex items-center justify-center flex-shrink-0" style={{ width: 32, height: 45, background: '#1a2235', border: '1px solid #1e2d47' }}>🃏</div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium text-text-primary truncate">{card.card_name}</span>
          {card.is_foil && (
            <span className="text-xs font-bold rounded px-1.5 py-0.5" style={{ background: 'rgba(124,58,237,0.22)', color: '#c4b5fd' }}>✦</span>
          )}
        </div>
        <div className="text-xs truncate" style={{ color: '#64748b' }}>{card.type_line?.split(' — ')[0]}</div>
      </div>
      <span className="text-sm font-semibold text-text-primary flex-shrink-0">{card.quantity}×</span>
    </div>
  );
}

export default function PublicDeckView({ deck, cards, liked, likeCount, isOwner, signedIn }) {
  const router = useRouter();
  const [tab, setTab] = useState('Cards'); // Cards | Stats
  const [cloning, setCloning] = useState(false);

  const grouped = useMemo(() => groupCardsByType(cards), [cards]);
  const target = deck.format === 'commander' ? 100 : 60;
  const cardCount = cards.reduce((s, c) => s + (c.quantity || 1), 0);
  const bColor = deck.bracket ? (BRACKET_COLORS[deck.bracket] || '#64748b') : '#475569';

  const handleExport = async () => {
    const text = exportDecklist(cards, deck);
    try {
      await navigator.clipboard.writeText(text);
      showToast('✓ Decklist copied to clipboard', 'success');
    } catch {
      // Fallback: download as a file
      const blob = new Blob([text], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${deck.name.replace(/[^a-z0-9]+/gi, '_')}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  const handleClone = async () => {
    if (cloning) return;
    setCloning(true);
    try {
      const res = await fetch('/api/decks/clone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deckId: deck.id }),
      });
      const data = await res.json();
      if (res.ok && data.deckId) {
        showToast('✓ Cloned to your decks', 'success');
        router.push(`/decks/${data.deckId}`);
      } else {
        showToast(data.error || 'Failed to clone deck', 'error');
      }
    } catch {
      showToast('Failed to clone deck', 'error');
    } finally {
      setCloning(false);
    }
  };

  return (
    <div className="h-full flex flex-col" style={{ background: '#0a0e1a' }}>
      {/* Header */}
      <div className="flex-shrink-0" style={{ background: '#111827', borderBottom: '1px solid #1e2d47' }}>
        <div className="flex items-center gap-2 px-3 pt-4 pb-2">
          <button
            onClick={() => router.push('/community')}
            className="flex-shrink-0 flex items-center justify-center rounded-xl"
            style={{ width: 40, height: 40, background: '#1a2235', border: '1px solid #1e2d47', color: '#94a3b8' }}
          >
            ←
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-base font-bold text-text-primary truncate">{deck.name}</h1>
            {deck.commander_name && (
              <p className="text-xs truncate" style={{ color: '#94a3b8' }}>⚔ {deck.commander_name}{deck.partner_name ? ` + ${deck.partner_name}` : ''}</p>
            )}
          </div>
          {deck.bracket && (
            <span className="flex-shrink-0 text-xs font-semibold rounded-full px-2.5 py-1" style={{ background: `${bColor}22`, color: bColor, border: `1px solid ${bColor}55` }}>
              B{deck.bracket} · {BRACKET_LABELS[deck.bracket]}
            </span>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 px-3 pb-3">
          <LikeButton deckId={deck.id} initialLiked={liked} initialCount={likeCount} />
          <button
            onClick={handleExport}
            className="flex-1 rounded-xl py-2.5 text-sm font-semibold"
            style={{ background: '#1a2235', border: '1px solid #1e2d47', color: '#94a3b8', minHeight: 44 }}
          >
            ⬇ Export
          </button>
          {!isOwner && (
            <button
              onClick={handleClone}
              disabled={cloning}
              className="flex-1 rounded-xl py-2.5 text-sm font-semibold disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, #7c3aed, #f59e0b)', color: '#fff', minHeight: 44 }}
            >
              {cloning ? 'Cloning…' : '⎘ Clone'}
            </button>
          )}
        </div>

        {/* Tabs */}
        <div className="flex px-4 gap-1">
          {['Cards', 'Stats'].map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="px-4 py-2.5 text-sm font-semibold rounded-t-xl"
              style={{
                background: tab === t ? '#0a0e1a' : 'transparent',
                color: tab === t ? '#f59e0b' : '#94a3b8',
                borderBottom: tab === t ? '2px solid #f59e0b' : '2px solid transparent',
                minHeight: 40,
              }}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto pb-6">
        {tab === 'Cards' ? (
          <div className="px-3 pt-2">
            <p className="text-xs px-1 py-2" style={{ color: '#64748b' }}>{cardCount}/{target} cards</p>
            {Object.entries(grouped).map(([groupName, groupCards]) => (
              <div key={groupName} className="mb-2">
                <div className="px-2 py-1.5 text-xs font-semibold uppercase tracking-wider" style={{ color: '#94a3b8' }}>
                  {groupName} · {groupCards.reduce((s, c) => s + (c.quantity || 1), 0)}
                </div>
                {groupCards.map((c) => <ReadOnlyRow key={c.id || c.scryfall_id} card={c} />)}
              </div>
            ))}
          </div>
        ) : (
          <StatsPanel cards={cards} format={deck.format} bracket={deck.bracket} />
        )}
      </div>
    </div>
  );
}
