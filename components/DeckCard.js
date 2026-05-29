'use client';

import Link from 'next/link';
import { BRACKET_COLORS, BRACKET_LABELS } from '@/lib/brackets';

function BracketBadge({ bracket }) {
  if (!bracket) {
    return (
      <span
        className="text-xs font-semibold rounded-full px-2.5 py-1 backdrop-blur"
        style={{ background: 'rgba(0,0,0,0.4)', color: 'rgba(255,255,255,0.5)', border: '1px solid rgba(255,255,255,0.18)' }}
        title="Run AI Insights to set a bracket"
      >
        Bracket —
      </span>
    );
  }
  const c = BRACKET_COLORS[bracket] || '#64748b';
  return (
    <span
      className="text-xs font-semibold rounded-full px-2.5 py-1 backdrop-blur"
      style={{ background: `${c}cc`, color: '#fff', border: `1px solid ${c}` }}
    >
      B{bracket} · {BRACKET_LABELS[bracket]}
    </span>
  );
}

function ProgressBar({ value, max }) {
  const pct = Math.min(100, Math.round((value / max) * 100));
  const color = pct >= 100 ? '#10b981' : pct >= 75 ? '#f59e0b' : '#94a3b8';
  return (
    <div className="h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.15)' }}>
      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

const COLOR_MAP = { W: '#f9fafb', U: '#3b82f6', B: '#6b7280', R: '#ef4444', G: '#22c55e' };

function ColorDots({ colors }) {
  if (!colors || colors.length === 0) return null;
  return (
    <div className="flex gap-1">
      {colors.map((c) => (
        <div
          key={c}
          className="rounded-full"
          style={{ width: 8, height: 8, background: COLOR_MAP[c] || '#94a3b8', flexShrink: 0 }}
        />
      ))}
    </div>
  );
}

export default function DeckCard({ deck }) {
  const target = deck.format === 'commander' ? 100 : 60;
  const count = deck.card_count || 0;
  const hasArt = !!deck.commander_image_url;
  const valueDisplay = deck.estimated_value_eur != null
    ? `€${parseFloat(deck.estimated_value_eur).toFixed(2)}`
    : null;

  return (
    <Link href={`/decks/${deck.id}`} className="block">
      <div
        className="relative rounded-2xl overflow-hidden transition-all active:scale-95"
        style={{ minHeight: 160 }}
      >
        {/* Commander artwork background */}
        {hasArt && (
          <img
            src={deck.commander_image_url}
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
            style={{ objectPosition: 'center 15%' }}
          />
        )}

        {/* Gradient overlay — darker without art */}
        <div
          className="absolute inset-0"
          style={{
            background: hasArt
              ? 'linear-gradient(160deg, rgba(10,14,26,0.25) 0%, rgba(10,14,26,0.65) 45%, rgba(10,14,26,0.97) 100%)'
              : '#111827',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 16,
          }}
        />

        {/* Content */}
        <div className="relative z-10 p-4 flex flex-col h-full" style={{ minHeight: 160 }}>
          {/* Top row: bracket + format badges */}
          <div className="flex justify-between items-start mb-auto gap-2">
            <BracketBadge bracket={deck.bracket} />
            <span
              className="text-xs font-semibold rounded-full px-2.5 py-1 backdrop-blur"
              style={{
                background: deck.format === 'commander' ? 'rgba(124,58,237,0.55)' : 'rgba(245,158,11,0.55)',
                color: '#fff',
                border: `1px solid ${deck.format === 'commander' ? 'rgba(167,139,250,0.5)' : 'rgba(245,158,11,0.5)'}`,
              }}
            >
              {deck.format === 'commander' ? 'Commander' : '60-Card'}
            </span>
          </div>

          {/* Bottom: deck info */}
          <div>
            <h3 className="font-bold text-white text-lg leading-snug truncate drop-shadow">
              {deck.name}
            </h3>

            {deck.commander_name && (
              <p className="text-xs mt-0.5 truncate" style={{ color: 'rgba(255,255,255,0.7)' }}>
                ⚔ {deck.commander_name}
                {deck.partner_name && ` + ${deck.partner_name}`}
              </p>
            )}

            <div className="flex items-center gap-3 mt-2 mb-2">
              <span className="text-xs" style={{ color: 'rgba(255,255,255,0.6)' }}>
                <span className="font-bold text-white">{count}</span>/{target}
              </span>
              {valueDisplay && (
                <span className="text-xs font-semibold" style={{ color: '#10b981' }}>{valueDisplay}</span>
              )}
            </div>

            <ProgressBar value={count} max={target} />
          </div>
        </div>
      </div>
    </Link>
  );
}
