'use client';

import { useState } from 'react';
import { parseDeckList } from '@/lib/deckUtils';
import { fetchCardCollection } from '@/lib/scryfall';

export default function ImportDeckModal({ deckId, onImport, onClose }) {
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(null);

  const handlePreview = () => {
    const parsed = parseDeckList(text);
    setPreview(parsed);
    setError('');
  };

  const handleImport = async () => {
    if (!text.trim()) return;
    setLoading(true);
    setError('');

    try {
      const parsed = parseDeckList(text);
      if (parsed.length === 0) {
        setError('No valid cards found in the deck list.');
        setLoading(false);
        return;
      }

      // Resolve via API
      const res = await fetch('/api/scryfall/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cards: parsed, deckId }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Import failed');

      onImport(data.imported || parsed.length, data.failed || 0);
      onClose();
    } catch (err) {
      setError(err.message || 'Import failed. Please check the format and try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/60 backdrop" onClick={onClose} style={{ zIndex: 200 }} />
      <div
        className="fixed inset-x-0 bottom-0 rounded-t-2xl sheet-enter flex flex-col"
        style={{ background: '#111827', border: '1px solid #1e2d47', zIndex: 210, maxHeight: '85vh' }}
      >
        <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-10 h-1 rounded-full" style={{ background: '#1e2d47' }} />
        </div>

        <div className="flex items-center justify-between px-4 pb-3 flex-shrink-0">
          <h2 className="font-bold text-text-primary text-lg">Import Deck List</h2>
          <button onClick={onClose} style={{ color: '#94a3b8', minHeight: 44, minWidth: 44 }} className="flex items-center justify-center">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto scroll-y px-4">
          <p className="text-xs text-text-secondary mb-3">
            Paste a deck list in any of these formats:
            <br />• <code className="text-gold">4 Lightning Bolt</code>
            <br />• <code className="text-gold">4x Lightning Bolt</code>
            <br />• <code className="text-gold">Lightning Bolt x4</code>
            <br />Lines starting with <code className="text-gold">//</code> or <code className="text-gold">SB:</code> are ignored.
          </p>

          <textarea
            value={text}
            onChange={(e) => { setText(e.target.value); setPreview(null); }}
            placeholder="4 Lightning Bolt&#10;4x Goblin Guide&#10;2 Mountain&#10;..."
            className="w-full rounded-xl p-3 text-sm font-mono outline-none focus:ring-2 ring-gold resize-none"
            style={{
              background: '#1a2235',
              border: '1px solid #1e2d47',
              color: '#f1f5f9',
              minHeight: 200,
            }}
          />

          {preview && (
            <div
              className="mt-3 rounded-xl p-3 text-sm"
              style={{ background: '#1a2235', border: '1px solid #1e2d47' }}
            >
              <p className="font-semibold text-text-primary mb-2">Preview ({preview.length} cards parsed):</p>
              <div className="max-h-32 overflow-y-auto space-y-0.5">
                {preview.slice(0, 20).map((c, i) => (
                  <div key={i} className="text-text-secondary">
                    <span className="text-text-primary font-medium">{c.quantity}x</span> {c.name}
                  </div>
                ))}
                {preview.length > 20 && (
                  <div className="text-text-dim text-xs">…and {preview.length - 20} more</div>
                )}
              </div>
            </div>
          )}

          {error && (
            <div className="mt-3 rounded-xl p-3" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}>
              <p className="text-red-400 text-sm">{error}</p>
            </div>
          )}
        </div>

        <div className="flex gap-3 px-4 py-3 flex-shrink-0" style={{ borderTop: '1px solid #1e2d47' }}>
          {!preview ? (
            <>
              <button
                onClick={onClose}
                className="flex-1 rounded-xl py-3 text-sm font-medium"
                style={{ background: '#1a2235', border: '1px solid #1e2d47', color: '#94a3b8', minHeight: 44 }}
              >
                Cancel
              </button>
              <button
                onClick={handlePreview}
                disabled={!text.trim()}
                className="flex-1 rounded-xl py-3 text-sm font-semibold disabled:opacity-50"
                style={{ background: '#1a2235', border: '1px solid #f59e0b', color: '#f59e0b', minHeight: 44 }}
              >
                Preview
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setPreview(null)}
                className="flex-1 rounded-xl py-3 text-sm font-medium"
                style={{ background: '#1a2235', border: '1px solid #1e2d47', color: '#94a3b8', minHeight: 44 }}
              >
                Edit
              </button>
              <button
                onClick={handleImport}
                disabled={loading}
                className="flex-2 rounded-xl py-3 text-sm font-semibold disabled:opacity-50"
                style={{ background: '#f59e0b', color: '#0a0e1a', minHeight: 44, flex: 2 }}
              >
                {loading ? 'Importing…' : `Import ${preview.length} Cards`}
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}
