'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import DeckCard from './DeckCard';
import UpgradeModal from './UpgradeModal';
import ImportDeckModal from './ImportDeckModal';

const QUICK_ACTIONS = [
  { icon: '📷', label: 'Scan', mode: 'Live Scan' },
  { icon: '🖼️', label: 'Photo', mode: 'Photo' },
  { icon: '🔍', label: 'Search', mode: 'Search' },
  { icon: '📋', label: 'Import', mode: 'Import' },
];

export default function DeckListPage({ decks: initialDecks, tier, userId }) {
  const [decks, setDecks] = useState(initialDecks);
  const [showNewDeck, setShowNewDeck] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [newDeckName, setNewDeckName] = useState('');
  const [newDeckFormat, setNewDeckFormat] = useState('commander');
  const [creating, setCreating] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  const canCreateDeck = tier === 'pro' || decks.length < 3;

  const handleNewDeck = () => {
    if (!canCreateDeck) { setShowUpgrade(true); return; }
    setShowNewDeck(true);
  };

  const handleQuickAction = (mode) => {
    if (mode === 'Import') { setShowImport(true); return; }
    router.push(`/scan?mode=${encodeURIComponent(mode)}`);
  };

  const createDeck = async (e) => {
    e.preventDefault();
    if (!newDeckName.trim()) return;
    setCreating(true);
    const { data, error } = await supabase
      .from('decks')
      .insert({ user_id: userId, name: newDeckName.trim(), format: newDeckFormat, card_count: 0 })
      .select()
      .single();
    if (!error && data) {
      setDecks((prev) => [data, ...prev]);
      setShowNewDeck(false);
      setNewDeckName('');
      router.push(`/decks/${data.id}`);
    } else {
      alert('Failed to create deck');
    }
    setCreating(false);
  };

  return (
    <div className="h-full flex flex-col" style={{ background: '#0a0e1a' }}>
      {/* Header */}
      <div className="flex-shrink-0 px-4 pt-6 pb-3" style={{ borderBottom: '1px solid #1e2d47' }}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-xl font-bold text-white">My Decks</h1>
            <p className="text-xs text-slate-400 mt-0.5">
              {decks.length} deck{decks.length !== 1 ? 's' : ''}
              {tier === 'free' && ` · ${decks.length}/3 free`}
            </p>
          </div>
          <button
            onClick={handleNewDeck}
            className="flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold"
            style={{ background: '#f59e0b', color: '#0a0e1a', minHeight: 44 }}
          >
            + New Deck
          </button>
        </div>

        {/* Quick action buttons */}
        <div className="grid grid-cols-4 gap-2">
          {QUICK_ACTIONS.map((action) => (
            <button
              key={action.mode}
              onClick={() => handleQuickAction(action.mode)}
              className="flex flex-col items-center gap-1.5 rounded-xl py-3 text-xs font-medium transition-all active:scale-95"
              style={{ background: '#111827', border: '1px solid #1e2d47', color: '#94a3b8', minHeight: 64 }}
            >
              <span className="text-xl">{action.icon}</span>
              <span>{action.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Deck list */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {decks.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-12">
            <div className="text-6xl mb-4">🃏</div>
            <h3 className="text-white font-semibold text-lg mb-2">No decks yet</h3>
            <p className="text-slate-400 text-sm max-w-xs mb-6">
              Create a deck, then add cards by scanning, photo, searching, or importing a list.
            </p>
            <button onClick={handleNewDeck} className="rounded-xl px-6 py-3 text-sm font-semibold" style={{ background: '#f59e0b', color: '#0a0e1a' }}>
              Create First Deck
            </button>
          </div>
        ) : (
          decks.map((deck) => <DeckCard key={deck.id} deck={deck} />)
        )}

        {tier === 'free' && decks.length >= 3 && (
          <div className="rounded-2xl p-4 text-center" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)' }}>
            <p className="text-sm" style={{ color: '#f59e0b' }}>Free plan: 3 decks max</p>
            <button onClick={() => setShowUpgrade(true)} className="mt-1 text-xs underline" style={{ color: '#f59e0b' }}>
              Upgrade for unlimited decks
            </button>
          </div>
        )}
      </div>

      {/* New deck modal */}
      {showNewDeck && (
        <div className="absolute inset-0 flex items-end z-50" style={{ background: 'rgba(0,0,0,0.6)' }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowNewDeck(false); }}>
          <div className="w-full rounded-t-2xl px-4 pt-4 pb-8" style={{ background: '#111827', border: '1px solid #1e2d47' }}>
            <div className="flex justify-center mb-4">
              <div className="w-10 h-1 rounded-full" style={{ background: '#1e2d47' }} />
            </div>
            <h2 className="text-lg font-bold text-white mb-4">New Deck</h2>
            <form onSubmit={createDeck} className="space-y-4">
              <div>
                <label className="text-xs text-slate-400 block mb-1">Deck Name</label>
                <input
                  type="text"
                  value={newDeckName}
                  onChange={(e) => setNewDeckName(e.target.value)}
                  placeholder="e.g. Atraxa Superfriends"
                  required
                  autoFocus
                  className="w-full rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 ring-gold"
                  style={{ background: '#1a2235', border: '1px solid #1e2d47', color: '#f1f5f9', minHeight: 44 }}
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-2">Format</label>
                <div className="flex gap-3">
                  {[{ value: 'commander', label: 'Commander', desc: '100-card singleton' }, { value: '60card', label: '60-Card', desc: 'Standard / Modern' }].map((f) => (
                    <button type="button" key={f.value} onClick={() => setNewDeckFormat(f.value)}
                      className="flex-1 rounded-xl p-3 text-sm text-left transition-all"
                      style={{ background: newDeckFormat === f.value ? 'rgba(245,158,11,0.15)' : '#1a2235', border: `1px solid ${newDeckFormat === f.value ? '#f59e0b' : '#1e2d47'}`, color: newDeckFormat === f.value ? '#f59e0b' : '#94a3b8', minHeight: 64 }}>
                      <div className="font-semibold">{f.label}</div>
                      <div className="text-xs mt-0.5 opacity-70">{f.desc}</div>
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setShowNewDeck(false)}
                  className="flex-1 rounded-xl py-3 text-sm font-medium"
                  style={{ background: '#1a2235', border: '1px solid #1e2d47', color: '#94a3b8', minHeight: 44 }}>
                  Cancel
                </button>
                <button type="submit" disabled={creating || !newDeckName.trim()}
                  className="flex-1 rounded-xl py-3 text-sm font-semibold disabled:opacity-50"
                  style={{ background: '#f59e0b', color: '#0a0e1a', minHeight: 44 }}>
                  {creating ? 'Creating…' : 'Create Deck'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showUpgrade && <UpgradeModal onClose={() => setShowUpgrade(false)} />}
      {showImport && (
        <ImportDeckModal
          userId={userId}
          decks={decks}
          onClose={() => setShowImport(false)}
          onImported={(newDeck) => {
            setDecks((prev) => [newDeck, ...prev]);
            setShowImport(false);
            router.push(`/decks/${newDeck.id}`);
          }}
        />
      )}
    </div>
  );
}
