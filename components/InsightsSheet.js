'use client';

import { useState, useEffect } from 'react';

const BRACKET_COLORS = ['', '#10b981', '#22c55e', '#f59e0b', '#ef4444', '#7c3aed'];
const BRACKET_LABELS = ['', 'Casual', 'Focused Casual', 'Optimised', 'High Power', 'cEDH'];

function renderMarkdown(text) {
  // Simple markdown renderer for insights content
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

export default function InsightsSheet({ deckId, deck, tier, hasChanged, lastInsight, autoGenerate, onInsightGenerated, onClose }) {
  const [insight, setInsight] = useState(lastInsight);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Auto-start generation when opened with no pre-loaded insight
  useEffect(() => {
    if (autoGenerate && !lastInsight) {
      generateInsights();
    }
  }, []);

  const generateInsights = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deckId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to generate insights');
      setInsight(data);
      if (onInsightGenerated) onInsightGenerated(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const bracket = insight?.bracket_estimate;

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
                Get a detailed breakdown of your deck's strengths, weaknesses, and improvement suggestions.
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

          {insight?.content && (
            <div className="prose prose-invert max-w-none">
              {renderMarkdown(insight.content)}
            </div>
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
          {(!insight || hasChanged) && (
            <button
              onClick={generateInsights}
              disabled={loading}
              className="flex-2 rounded-xl py-3 px-4 text-sm font-semibold disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, #7c3aed, #f59e0b)', color: '#fff', minHeight: 44, flex: 2 }}
            >
              {loading ? '✨ Analysing…' : insight ? '🔄 Regenerate' : '✨ Generate Insights'}
            </button>
          )}
        </div>
      </div>
    </>
  );
}
