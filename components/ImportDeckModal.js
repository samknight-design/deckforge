'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { parseDeckList } from '@/lib/deckUtils';

// Can be used in two ways:
//  1. From deck detail: pass deckId + onImport(count, failed) + onClose
//  2. From decks list: pass userId + decks + onImported(newDeck) + onClose
export default function ImportDeckModal({ deckId, userId, decks = [], onImport, onImported, onClose }) {
  const standAlone = !deckId; // true when called from decks list
  const [step, setStep] = useState(standAlone ? 'deck' : 'paste'); // 'deck' | 'paste' | 'preview'
  const [selectedDeckId, setSelectedDeckId] = useState(decks[0]?.id || '__new__');
  const [newDeckName, setNewDeckName] = useState('');
  const [newDeckFormat, setNewDeckFormat] = useState('commander');
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(null);
  const supabase = createClient();

  const effectiveDeckId = deckId || (selectedDeckId !== '__new__' ? selectedDeckId : null);
  const isNewDeck = standAlone && selectedDeckId === '__new__';

  const handleDeckStepNext = () => {
    if (isNewDeck && !newDeckName.trim()) return;
    setStep('paste');
  };

  const handlePreview = () => {
    const parsed = parseDeckList(text);
    if (parsed.length === 0) { setError('No valid cards found.'); return; }
    setPreview(parsed);
    setError('');
    setStep('preview');
  };

  const handleImport = async () => {
    if (!text.trim()) return;
    setLoading(true);
    setError('');
    try {
      const parsed = parseDeckList(text);
      if (parsed.length === 0) throw new Error('No valid cards found.');

      let targetDeckId = effectiveDeckId;

      // Create new deck if needed
      if (isNewDeck) {
        const { data, error: err } = await supabase
          .from('decks')
          .insert({ user_id: userId, name: newDeckName.trim(), format: newDeckFormat, card_count: 0 })
          .select()
          .single();
        if (err || !data) throw new Error('Failed to create deck');
        targetDeckId = data.id;
        // Call API to import cards
        const res = await fetch('/api/scryfall/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cards: parsed, deckId: targetDeckId }),
        });
        const result = await res.json();
        if (!res.ok) throw new Error(result.error || 'Import failed');
        onImported?.(data);
        onClose();
        return;
      }

      const res = await fetch('/api/scryfall/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cards: parsed, deckId: targetDeckId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Import failed');
      onImport?.(data.imported || parsed.length, data.failed || 0);
      onClose();
    } catch (err) {
      setError(err.message || 'Import failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/60" onClick={onClose} style={{ zIndex: 200 }} />
      <div className="fixed inset-x-0 bottom-0 rounded-t-2xl flex flex-col" style={{ background: '#111827', border: '1px solid #1e2d47', zIndex: 210, maxHeight: '90vh' }}>
        <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-10 h-1 rounded-full" style={{ background: '#1e2d47' }} />
        </div>
        <div className="flex items-center justify-between px-4 pb-3 flex-shrink-0">
          <h2 className="font-bold text-white text-lg">
            {step === 'deck' ? 'Choose Destination' : step === 'paste' ? 'Paste Deck List' : 'Preview Import'}
          </h2>
          <button onClick={onClose} className="flex items-center justify-center text-slate-400" style={{ minHeight: 44, minWidth: 44 }}>✕</button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-2">

          {/* Step 1: deck selector (standalone mode only) */}
          {step === 'deck' && (
            <div className="space-y-4">
              <p className="text-sm text-slate-400">Where should the imported cards go?</p>

              {/* New deck option */}
              <button onClick={() => setSelectedDeckId('__new__')}
                className="w-full flex items-center gap-3 rounded-xl p-4 text-left transition-all"
                style={{ background: selectedDeckId === '__new__' ? 'rgba(245,158,11,0.12)' : '#1a2235', border: `1px solid ${selectedDeckId === '__new__' ? '#f59e0b' : '#1e2d47'}` }}>
                <span className="text-2xl">✨</span>
                <div>
                  <div className="font-semibold text-sm" style={{ color: selectedDeckId === '__new__' ? '#f59e0b' : '#f1f5f9' }}>Create New Deck</div>
                  <div className="text-xs text-slate-400 mt-0.5">Import into a brand new deck</div>
                </div>
                {selectedDeckId === '__new__' && <span className="ml-auto" style={{ color: '#f59e0b' }}>✓</span>}
              </button>

              {isNewDeck && (
                <div className="space-y-3">
                  <input
                    type="text"
                    value={newDeckName}
                    onChange={(e) => setNewDeckName(e.target.value)}
                    placeholder="Deck name e.g. Mono Red Burn"
                    autoFocus
                    className="w-full rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 ring-gold"
                    style={{ background: '#1a2235', border: '1px solid #1e2d47', color: '#f1f5f9', minHeight: 44 }}
                  />
                  <div className="flex gap-2">
                    {[{ value: 'commander', label: 'Commander' }, { value: '60card', label: '60-Card' }].map((f) => (
                      <button key={f.value} type="button" onClick={() => setNewDeckFormat(f.value)}
                        className="flex-1 rounded-xl py-2 text-sm font-medium transition-all"
                        style={{ background: newDeckFormat === f.value ? 'rgba(245,158,11,0.15)' : '#1a2235', border: `1px solid ${newDeckFormat === f.value ? '#f59e0b' : '#1e2d47'}`, color: newDeckFormat === f.value ? '#f59e0b' : '#94a3b8', minHeight: 40 }}>
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Existing decks */}
              {decks.length > 0 && (
                <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #1e2d47' }}>
                  {decks.map((deck, i) => (
                    <button key={deck.id} onClick={() => setSelectedDeckId(deck.id)}
                      className="w-full flex items-center gap-3 px-4 py-3 text-left text-sm transition-all"
                      style={{ background: selectedDeckId === deck.id ? 'rgba(245,158,11,0.1)' : 'transparent', borderBottom: i < decks.length - 1 ? '1px solid #1e2d47' : 'none', minHeight: 48 }}>
                      <span>📦</span>
                      <span style={{ color: selectedDeckId === deck.id ? '#f59e0b' : '#f1f5f9' }}>{deck.name}</span>
                      <span className="ml-auto text-xs rounded-full px-2 py-0.5" style={{ background: deck.format === 'commander' ? '#7c3aed' : '#1a2235', color: '#f1f5f9' }}>
                        {deck.format === 'commander' ? 'CMD' : '60'}
                      </span>
                      {selectedDeckId === deck.id && <span style={{ color: '#f59e0b' }}>✓</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Step 2: paste deck list */}
          {step === 'paste' && (
            <div className="space-y-3">
              <p className="text-xs text-slate-400">
                Paste from <span className="text-amber-400">Moxfield</span>, <span className="text-amber-400">Archidekt</span>, <span className="text-amber-400">MTGGoldfish</span> or any plain list — set codes, collector numbers, foils (<code className="text-amber-400">*F*</code>) and section headers (Commander / Deck / Sideboard) are handled automatically.
              </p>

              <label
                className="flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-medium cursor-pointer"
                style={{ background: '#1a2235', border: '1px dashed #2c3e5c', color: '#94a3b8', minHeight: 44 }}
              >
                📄 Upload a .txt / .dec file
                <input
                  type="file"
                  accept=".txt,.dec,.csv,text/plain"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = () => { setText(String(reader.result || '')); setPreview(null); setError(''); };
                    reader.readAsText(file);
                    e.target.value = '';
                  }}
                />
              </label>

              <textarea
                value={text}
                onChange={(e) => { setText(e.target.value); setPreview(null); setError(''); }}
                placeholder={"1 Sol Ring (C21) 263 *F*\n1x Atraxa, Praetors' Voice\n10 Forest\n..."}
                className="w-full rounded-xl p-3 text-sm font-mono outline-none focus:ring-2 ring-gold resize-none"
                style={{ background: '#1a2235', border: '1px solid #1e2d47', color: '#f1f5f9', minHeight: 200 }}
              />
              {error && <p className="text-red-400 text-sm">{error}</p>}
            </div>
          )}

          {/* Step 3: preview */}
          {step === 'preview' && preview && (
            <div className="space-y-3">
              <div className="rounded-xl p-3" style={{ background: '#1a2235', border: '1px solid #1e2d47' }}>
                <p className="font-semibold text-white mb-2 text-sm">{preview.length} cards to import</p>
                <div className="max-h-48 overflow-y-auto space-y-0.5">
                  {preview.slice(0, 25).map((c, i) => (
                    <div key={i} className="text-sm text-slate-300">
                      <span className="text-white font-medium">{c.quantity}x</span> {c.name}
                      {c.commander && <span className="text-xs ml-1" style={{ color: '#a78bfa' }}>· CMD</span>}
                      {c.foil && <span className="text-xs ml-1" style={{ color: '#c4b5fd' }}>✦</span>}
                    </div>
                  ))}
                  {preview.length > 25 && <div className="text-slate-400 text-xs">…and {preview.length - 25} more</div>}
                </div>
              </div>
              {error && <p className="text-red-400 text-sm">{error}</p>}
            </div>
          )}
        </div>

        {/* Footer buttons */}
        <div className="flex gap-3 px-4 py-3 flex-shrink-0" style={{ borderTop: '1px solid #1e2d47' }}>
          {step === 'deck' && (
            <>
              <button onClick={onClose} className="flex-1 rounded-xl py-3 text-sm font-medium" style={{ background: '#1a2235', border: '1px solid #1e2d47', color: '#94a3b8', minHeight: 44 }}>Cancel</button>
              <button onClick={handleDeckStepNext} disabled={isNewDeck && !newDeckName.trim()}
                className="flex-1 rounded-xl py-3 text-sm font-semibold disabled:opacity-50"
                style={{ background: '#f59e0b', color: '#0a0e1a', minHeight: 44 }}>
                Next →
              </button>
            </>
          )}
          {step === 'paste' && (
            <>
              <button onClick={() => standAlone ? setStep('deck') : onClose()}
                className="flex-1 rounded-xl py-3 text-sm font-medium" style={{ background: '#1a2235', border: '1px solid #1e2d47', color: '#94a3b8', minHeight: 44 }}>
                {standAlone ? '← Back' : 'Cancel'}
              </button>
              <button onClick={handlePreview} disabled={!text.trim()}
                className="flex-1 rounded-xl py-3 text-sm font-semibold disabled:opacity-50"
                style={{ background: '#1a2235', border: '1px solid #f59e0b', color: '#f59e0b', minHeight: 44 }}>
                Preview
              </button>
            </>
          )}
          {step === 'preview' && (
            <>
              <button onClick={() => { setStep('paste'); setError(''); }}
                className="flex-1 rounded-xl py-3 text-sm font-medium" style={{ background: '#1a2235', border: '1px solid #1e2d47', color: '#94a3b8', minHeight: 44 }}>
                ← Edit
              </button>
              <button onClick={handleImport} disabled={loading}
                className="flex-[2] rounded-xl py-3 text-sm font-semibold disabled:opacity-50"
                style={{ background: '#f59e0b', color: '#0a0e1a', minHeight: 44 }}>
                {loading ? 'Importing…' : `Import ${preview?.length} Cards`}
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}
