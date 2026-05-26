'use client';

import Link from 'next/link';
import { ColourPips } from './ColourPip';

function ProgressBar({ value, max, color = '#f59e0b' }) {
  const pct = Math.min(100, Math.round((value / max) * 100));
  return (
    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: '#1e2d47' }}>
      <div
        className="h-full rounded-full transition-all"
        style={{ width: `${pct}%`, background: color }}
      />
    </div>
  );
}

export default function DeckCard({ deck }) {
  const target = deck.format === 'commander' ? 100 : 60;
  const count = deck.card_count || 0;
  const commanderColors = deck.commander_name ? [] : [];
  const valueDisplay = deck.estimated_value_eur != null
    ? `€${parseFloat(deck.estimated_value_eur).toFixed(2)}`
    : '—';

  return (
    <Link href={`/decks/${deck.id}`} className="block">
      <div
        className="rounded-2xl p-4 transition-all active:scale-95"
        style={{ background: '#111827', border: '1px solid #1e2d47' }}
      >
        {/* Header row */}
        <div className="flex items-start justify-between mb-2">
          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-text-primary truncate text-base">{deck.name}</h3>
            {deck.commander_name && (
              <p className="text-xs truncate mt-0.5" style={{ color: '#7c3aed' }}>
                ⚔ {deck.commander_name}
                {deck.partner_name && ` + ${deck.partner_name}`}
              </p>
            )}
          </div>
          <span
            className="ml-2 flex-shrink-0 text-xs font-semibold rounded-full px-2.5 py-1"
            style={{
              background: deck.format === 'commander' ? 'rgba(124,58,237,0.15)' : 'rgba(245,158,11,0.15)',
              color: deck.format === 'commander' ? '#a78bfa' : '#f59e0b',
              border: `1px solid ${deck.format === 'commander' ? 'rgba(124,58,237,0.3)' : 'rgba(245,158,11,0.3)'}`,
            }}
          >
            {deck.format === 'commander' ? 'Commander' : '60-Card'}
          </span>
        </div>

        {/* Stats row */}
        <div className="flex items-center gap-4 mb-3">
          <span className="text-sm text-text-secondary">
            <span className="font-semibold text-text-primary">{count}</span>/{target} cards
          </span>
          <span className="text-sm font-semibold" style={{ color: '#10b981' }}>
            {valueDisplay}
          </span>
        </div>

        {/* Progress bar */}
        <ProgressBar value={count} max={target} />
      </div>
    </Link>
  );
}
