'use client';

import { useState, useEffect } from 'react';
import { BRACKET_COLORS, BRACKET_LABELS } from '@/lib/brackets';
import { showReward } from './RewardToast';
import CardModal from './CardModal';

function renderMarkdown(text) {
  // Fallback renderer for older insights that have no structured `data`.
  const lines = text.split('\n');
  const elements = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith('## ')) {
      const bracketMatch = line.match(/\[(\d)\]/);
      const bracket = bracketMatch ? parseInt(bracketMatch[1]) : null;
      elements.push(
        <div key={i} className="mb-4">
          <h2 className="text-xl font-bold text-text-primary leading-snug">
            {bracket && (
              <span
                className="inline-block rounded-lg px-3 py-1 text-sm font-bold mr-2"
                style={{ background: `${BRACKET_COLORS[bracket]}20`, color: BRACKET_COLORS[bracket], border: `1px solid ${BRACKET_COLORS[bracket]}40` }}
              >
                Bracket {bracket}
              </span>
            )}
            {line.replace(/^## /, '').replace(/Bracket \[\d\] — /, '')}
          </h2>
        </div>
      );
    } else if (line.startsWith('### ')) {
      elements.push(
        <h3 key={i} className="text-base font-bold text-text-primary mt-5 mb-2">
          {line.replace(/^### /, '')}
        </h3>
      );
    } else if (line.startsWith('- **')) {
      const match = line.match(/^- \*\*(.+?)\*\*: (.+)$/);
      if (match) {
        elements.push(
          <div key={i} className="flex gap-2 mb-2">
            <span className="mt-1 flex-shrink-0" style={{ color: '#f59e0b' }}>•</span>
            <p className="text-sm leading-relaxed" style={{ color: '#cbd5e1' }}>
              <strong className="text-text-primary">{match[1]}</strong>: {match[2]}
            </p>
          </div>
        );
      } else {
        elements.push(
          <div key={i} className="flex gap-2 mb-2">
            <span className="mt-1 flex-shrink-0" style={{ color: '#94a3b8' }}>•</span>
            <p className="text-sm leading-relaxed" style={{ color: '#cbd5e1' }}>{line.replace(/^- /, '')}</p>
          </div>
        );
      }
    } else if (line.trim() && !line.startsWith('#')) {
      elements.push(
        <p key={i} className="text-sm leading-relaxed mb-2" style={{ color: '#cbd5e1' }}>
          {line}
        </p>
      );
    }
    i++;
  }

  return elements;
}

function PowerBar({ level }) {
  const lvl = Math.max(0, Math.min(10, level || 0));
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs" style={{ color: '#94a3b8' }}>Power level</span>
        <span className="text-xs font-bold" style={{ color: '#f59e0b' }}>{lvl}/10</span>
      </div>
      <div className="h-2 rounded-full overflow-hidden" style={{ background: '#1e2d47' }}>
        <div
          className="h-full rounded-full"
          style={{ width: `${lvl * 10}%`, background: 'linear-gradient(90deg, #22c55e, #f59e0b, #ef4444)' }}
        />
      </div>
    </div>
  );
}

// A tappable card entry — name chip + reason. Tapping opens a card preview
// (and is the hook for a future "buy this card" action).
function CardEntry({ name, reason, tone, onPick }) {
  const color = tone === 'add' ? '#10b981' : '#f87171';
  const bg = tone === 'add' ? 'rgba(16,185,129,0.1)' : 'rgba(248,113,113,0.1)';
  return (
    <div className="flex items-start gap-2 mb-2">
      <button
        onClick={() => onPick(name)}
        className="flex-shrink-0 rounded-lg px-2.5 py-1 text-xs font-semibold text-left transition-all active:scale-95"
        style={{ background: bg, color, border: `1px solid ${color}33`, maxWidth: 150 }}
        title={`Preview ${name}`}
      >
        {name}
      </button>
      {reason && (
        <p className="text-xs leading-relaxed pt-1" style={{ color: '#94a3b8' }}>{reason}</p>
      )}
    </div>
  );
}

function Dashboard({ data, onPick }) {
  const bracket = data.bracket;
  const bColor = BRACKET_COLORS[bracket] || '#64748b';
  const bLabel = data.bracket_name || BRACKET_LABELS[bracket] || '';

  return (
    <div className="pb-2">
      {/* Bracket + power level */}
      <div className="rounded-2xl p-4 mb-4" style={{ background: '#1a2235', border: `1px solid ${bColor}40` }}>
        <div className="flex items-center gap-3 mb-3">
          <div
            className="flex flex-col items-center justify-center rounded-xl flex-shrink-0"
            style={{ width: 56, height: 56, background: `${bColor}20`, border: `1px solid ${bColor}55` }}
          >
            <span className="text-xs font-medium" style={{ color: bColor }}>Bracket</span>
            <span className="text-2xl font-bold leading-none" style={{ color: bColor }}>{bracket || '—'}</span>
          </div>
          <div className="min-w-0">
            <div className="text-lg font-bold text-text-primary leading-tight">{bLabel}</div>
            <div className="text-xs" style={{ color: '#64748b' }}>Predicted power bracket</div>
          </div>
        </div>
        <PowerBar level={data.power_level} />
      </div>

      {/* Cards to add / cut */}
      <div className="grid grid-cols-1 gap-4 mb-4">
        {Array.isArray(data.cards_to_add) && data.cards_to_add.length > 0 && (
          <div>
            <h3 className="text-sm font-bold mb-2" style={{ color: '#10b981' }}>➕ Cards to add</h3>
            {data.cards_to_add.map((c, i) => (
              <CardEntry key={`a${i}`} name={c.name} reason={c.reason} tone="add" onPick={onPick} />
            ))}
          </div>
        )}
        {Array.isArray(data.cards_to_remove) && data.cards_to_remove.length > 0 && (
          <div>
            <h3 className="text-sm font-bold mb-2" style={{ color: '#f87171' }}>✂️ Cards to cut</h3>
            {data.cards_to_remove.map((c, i) => (
              <CardEntry key={`r${i}`} name={c.name} reason={c.reason} tone="cut" onPick={onPick} />
            ))}
          </div>
        )}
      </div>

      {/* Strengths / weaknesses */}
      {Array.isArray(data.strengths) && data.strengths.length > 0 && (
        <div className="mb-4">
          <h3 className="text-sm font-bold text-text-primary mb-2">💪 Strengths</h3>
          {data.strengths.map((s, i) => (
            <div key={i} className="flex gap-2 mb-1.5">
              <span className="mt-1 flex-shrink-0" style={{ color: '#10b981' }}>•</span>
              <p className="text-sm leading-relaxed" style={{ color: '#cbd5e1' }}>
                {s.title && <strong className="text-text-primary">{s.title}: </strong>}{s.detail}
              </p>
            </div>
          ))}
        </div>
      )}
      {Array.isArray(data.weaknesses) && data.weaknesses.length > 0 && (
        <div className="mb-4">
          <h3 className="text-sm font-bold text-text-primary mb-2">⚠️ Weaknesses</h3>
          {data.weaknesses.map((w, i) => (
            <div key={i} className="flex gap-2 mb-1.5">
              <span className="mt-1 flex-shrink-0" style={{ color: '#f59e0b' }}>•</span>
              <p className="text-sm leading-relaxed" style={{ color: '#cbd5e1' }}>
                {w.title && <strong className="text-text-primary">{w.title}: </strong>}{w.detail}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Text summary */}
      {(data.summary || data.strategy) && (
        <div className="rounded-xl p-3" style={{ background: '#1a2235', border: '1px solid #1e2d47' }}>
          {data.summary && <p className="text-sm leading-relaxed mb-2" style={{ color: '#cbd5e1' }}>{data.summary}</p>}
          {data.strategy && (
            <>
              <h4 className="text-xs font-bold text-text-primary mt-2 mb-1">🎯 How to play</h4>
              <p className="text-sm leading-relaxed" style={{ color: '#cbd5e1' }}>{data.strategy}</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// Shown for older insights that predate the structured dashboard (data === null):
// a greyed placeholder prompting a regenerate, with the original text below.
function LegacyInsight({ content }) {
  return (
    <div>
      <div className="rounded-2xl p-4 mb-4 text-center" style={{ background: '#1a2235', border: '1px dashed #2c3e5c' }}>
        <div className="flex items-center justify-center gap-2 mb-2 opacity-50">
          <div className="rounded-xl" style={{ width: 56, height: 56, background: '#0d1424', border: '1px solid #1e2d47' }} />
          <div className="text-left">
            <div className="h-3 w-24 rounded mb-1.5" style={{ background: '#0d1424' }} />
            <div className="h-2 w-32 rounded" style={{ background: '#0d1424' }} />
          </div>
        </div>
        <p className="text-sm font-medium" style={{ color: '#94a3b8' }}>Dashboard not available for this analysis</p>
        <p className="text-xs mt-0.5" style={{ color: '#64748b' }}>Regenerate insight to populate the dashboard.</p>
      </div>
      {content && (
        <div className="rounded-xl p-3" style={{ background: '#111827', border: '1px solid #1e2d47' }}>
          <div className="text-xs font-semibold mb-1" style={{ color: '#64748b' }}>Previous analysis</div>
          <div className="prose prose-invert max-w-none">{renderMarkdown(content)}</div>
        </div>
      )}
    </div>
  );
}

export default function InsightsSheet({ deckId, deck, tier, hasChanged, lastInsight, autoGenerate, onInsightGenerated, onClose }) {
  const [insight, setInsight] = useState(lastInsight);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [previewCard, setPreviewCard] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Auto-start generation when opened with no pre-loaded insight
  useEffect(() => {
    if (autoGenerate && !lastInsight) {
      generateInsights();
    }
  }, []);

  const generateInsights = async (force = false) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deckId, force }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to generate insights');
      setInsight(data);
      showReward(data.rewards);
      if (onInsightGenerated) onInsightGenerated(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Open a quick preview of a recommended card (future hook for purchase links).
  const pickCard = async (name) => {
    setPreviewLoading(true);
    try {
      const res = await fetch(`/api/scryfall/card?name=${encodeURIComponent(name)}`);
      const card = await res.json();
      if (res.ok && card?.scryfall_id) setPreviewCard(card);
    } catch {
      /* non-fatal */
    } finally {
      setPreviewLoading(false);
    }
  };

  const bracket = insight?.bracket_estimate;
  const data = insight?.data;

  return (
    <>
      <div className="fixed inset-0 bg-black/60 backdrop" onClick={onClose} style={{ zIndex: 300 }} />
      <div
        className="fixed inset-x-0 bottom-0 rounded-t-2xl sheet-enter flex flex-col"
        style={{ background: '#111827', border: '1px solid #1e2d47', zIndex: 310, maxHeight: '85vh' }}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-10 h-1 rounded-full" style={{ background: '#1e2d47' }} />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-4 pb-3 flex-shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-xl">✨</span>
            <div>
              <h2 className="font-bold text-text-primary">AI Deck Insights</h2>
              {insight?.generated_at && (
                <p className="text-xs text-text-secondary">
                  {insight.cached ? 'Cached • ' : ''}
                  {new Date(insight.generated_at).toLocaleDateString()}
                </p>
              )}
            </div>
          </div>
          {bracket && (
            <div
              className="rounded-full px-3 py-1 text-sm font-bold"
              style={{
                background: `${BRACKET_COLORS[bracket]}20`,
                color: BRACKET_COLORS[bracket],
                border: `1px solid ${BRACKET_COLORS[bracket]}40`,
              }}
            >
              B{bracket} — {BRACKET_LABELS[bracket]}
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto scroll-y px-4 pb-4">
          {!insight && !loading && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="text-5xl mb-4">🧙</div>
              <h3 className="font-semibold text-text-primary mb-2">Ready to Analyse</h3>
              <p className="text-sm text-text-secondary max-w-xs">
                Get a bracket prediction, cards to add or cut, and a strategy breakdown for your deck.
              </p>
            </div>
          )}

          {loading && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="w-10 h-10 border-2 border-gold border-t-transparent rounded-full animate-spin mb-4" />
              <p className="text-text-secondary text-sm">Claude is analysing your deck…</p>
            </div>
          )}

          {error && (
            <div
              className="rounded-xl p-4 mb-4"
              style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}
            >
              <p className="text-red-400 text-sm">{error}</p>
            </div>
          )}

          {!loading && insight && (
            data
              ? <Dashboard data={data} onPick={pickCard} />
              : <LegacyInsight content={insight.content} />
          )}

          {previewLoading && (
            <p className="text-xs text-center mt-2" style={{ color: '#64748b' }}>Loading card…</p>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex gap-3 px-4 py-3 flex-shrink-0" style={{ borderTop: '1px solid #1e2d47' }}>
          <button
            onClick={onClose}
            className="flex-1 rounded-xl py-3 text-sm font-medium"
            style={{ background: '#1a2235', border: '1px solid #1e2d47', color: '#94a3b8', minHeight: 44 }}
          >
            Close
          </button>
          {(!insight || hasChanged || !data) && (
            <button
              onClick={() => generateInsights(true)}
              disabled={loading}
              className="flex-2 rounded-xl py-3 px-4 text-sm font-semibold disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, #7c3aed, #f59e0b)', color: '#fff', minHeight: 44, flex: 2 }}
            >
              {loading ? '✨ Analysing…' : insight ? '🔄 Regenerate' : '✨ Generate Insights'}
            </button>
          )}
        </div>
      </div>

      {previewCard && (
        <CardModal
          card={previewCard}
          format={deck?.format}
          hasCommander={false}
          onClose={() => setPreviewCard(null)}
        />
      )}
    </>
  );
}
