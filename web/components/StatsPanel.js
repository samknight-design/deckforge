'use client';

import { useMemo } from 'react';
import { computeDeckStats } from '@/lib/deckUtils';
import { BRACKET_COLORS, BRACKET_LABELS } from '@/lib/brackets';
import { formatEurTotal } from '@/lib/currency';
import { getCurrency } from '@/lib/prefs';
import ManaBar from './ManaBar';
import ColourPip from './ColourPip';

const TYPE_COLORS = {
  Creatures: '#10b981',
  Instants: '#3b82f6',
  Sorceries: '#8b5cf6',
  Enchantments: '#f59e0b',
  Artifacts: '#94a3b8',
  Planeswalkers: '#ef4444',
  Lands: '#6b7280',
  Other: '#475569',
};

export default function StatsPanel({ cards, format, bracket }) {
  const stats = useMemo(() => computeDeckStats(cards), [cards]);
  const target = format === 'commander' ? 100 : 60;
  const recommendedLands = format === 'commander' ? [36, 40] : [20, 26];
  const landWarning = stats.landCount < recommendedLands[0] || stats.landCount > recommendedLands[1];

  const typeMax = Math.max(...Object.values(stats.typeBreakdown).filter(Boolean), 1);

  const bColor = bracket ? (BRACKET_COLORS[bracket] || '#64748b') : '#475569';

  return (
    <div className="px-4 py-4 space-y-6">
      {/* Power bracket */}
      <div
        className="rounded-xl p-3 flex items-center gap-3"
        style={{ background: '#111827', border: `1px solid ${bracket ? `${bColor}55` : '#1e2d47'}` }}
      >
        <div
          className="flex flex-col items-center justify-center rounded-lg flex-shrink-0"
          style={{ width: 44, height: 44, background: bracket ? `${bColor}20` : '#1a2235', border: `1px solid ${bracket ? `${bColor}55` : '#1e2d47'}` }}
        >
          <span className="text-base font-bold leading-none" style={{ color: bracket ? bColor : '#475569' }}>
            {bracket || '—'}
          </span>
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold" style={{ color: bracket ? '#f1f5f9' : '#64748b' }}>
            {bracket ? `Bracket ${bracket} · ${BRACKET_LABELS[bracket]}` : 'Bracket not set'}
          </div>
          <div className="text-xs" style={{ color: '#64748b' }}>
            {bracket ? 'Predicted power level' : 'Run AI Insights to set a bracket'}
          </div>
        </div>
      </div>

      {/* Overview grid */}
      <div className="grid grid-cols-2 gap-3">
        {[
          { label: 'Total Cards', value: `${stats.totalCards}/${target}` },
          { label: 'Lands', value: stats.landCount, warning: landWarning },
          { label: 'Avg CMC', value: stats.avgCmc },
          { label: 'Est. Value', value: formatEurTotal(stats.totalValue, getCurrency()), color: '#10b981' },
        ].map((item) => (
          <div
            key={item.label}
            className="rounded-xl p-3"
            style={{ background: '#111827', border: '1px solid #1e2d47' }}
          >
            <div className="text-xs text-text-secondary mb-1">{item.label}</div>
            <div
              className="text-xl font-bold"
              style={{ color: item.color || (item.warning ? '#f59e0b' : '#f1f5f9') }}
            >
              {item.value}
            </div>
            {item.warning && (
              <div className="text-xs mt-0.5" style={{ color: '#f59e0b' }}>
                Recommended: {recommendedLands[0]}–{recommendedLands[1]}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Colour distribution */}
      <div>
        <h3 className="text-sm font-semibold text-text-primary mb-3">Colour Distribution</h3>
        <div className="flex gap-3 flex-wrap">
          {Object.entries(stats.colorMap)
            .filter(([, count]) => count > 0)
            .map(([color, count]) => (
              <div key={color} className="flex items-center gap-2">
                <ColourPip color={color} size={22} />
                <span className="text-sm font-semibold text-text-primary">{count}</span>
              </div>
            ))}
          {Object.values(stats.colorMap).every((v) => v === 0) && (
            <p className="text-sm text-text-secondary">No colour data</p>
          )}
        </div>
      </div>

      {/* Mana curve */}
      <div>
        <h3 className="text-sm font-semibold text-text-primary mb-3">Mana Curve</h3>
        <ManaBar manaCurve={stats.manaCurve} />
      </div>

      {/* Card type breakdown */}
      <div>
        <h3 className="text-sm font-semibold text-text-primary mb-3">Card Types</h3>
        <div className="space-y-2">
          {Object.entries(stats.typeBreakdown)
            .filter(([, count]) => count > 0)
            .sort(([, a], [, b]) => b - a)
            .map(([type, count]) => (
              <div key={type} className="flex items-center gap-3">
                <span className="text-xs text-text-secondary w-24 flex-shrink-0">{type}</span>
                <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: '#1e2d47' }}>
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${(count / typeMax) * 100}%`,
                      background: TYPE_COLORS[type] || '#475569',
                    }}
                  />
                </div>
                <span className="text-xs font-semibold text-text-primary w-6 text-right">{count}</span>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
