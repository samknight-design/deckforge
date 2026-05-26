'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import DeckCard from './DeckCard';
import UpgradeModal from './UpgradeModal';

export default function DeckListPage({ decks: initialDecks, tier, userId }) {
  const [decks, setDecks] = useState(initialDecks);
  const [showNewDeck, setShowNewDeck] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [newDeckName, setNewDeckName] = useState('');
  const [newDeckFormat, setNewDeckFormat] = useState('60card');
  const [creating, setCreating] = useState(false);
  const supabase = createClient();

  const canCreateDeck = tier === 'pro' || decks.length < 3;

  const handleNewDeck = () => {
    if (!canCreateDeck) {
      setShowUpgrade(true);
      return;
    }
    setShowNewDeck(true);
  };

  const createDeck = async (e) => {
    e.preventDefault();
    if (!newDeckName.trim()) return;
    setCreating(true);

    const { data, error } = await supabase
      .from('decks')
      .insert({
        user_id: userId,
        name: newDeckName.trim(),
        format: newDeckFormat,
        card_count: 0,
      })
      .select()
      .single();

    if (!error && data) {
      setDecks((prev) => [data, ...prev]);
      setShowNewDeck(false);
      setNewDeckName('');
    } else {
      alert('Failed to create deck');
    }
    setCreating(false);
  };

  return (
    <div className="h-full flex flex-col" style={{ background: '#0a0e1a' }}>
      {/* Header */}
      <div
        className="flex-shrink-0 px-4 pt-6 pb-4"
        style={{ borderBottom: '1px solid #1e2d47' }}
      >
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-text-primary">My Decks</h1>
            <p className="text-xs text-text-secondary mt-0.5">
              {decks.length} deck{decks.length !== 1 ? 's' : ''}
              {tier === 'free' && ` · ${decks.length}/3 free`}
            </p>
          </div>
          <button
            onClick={handleNewDeck}
            className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold"
            style={{ background: '#f59e0b', color: '#0a0e1a', minHeight: 44 }}
          >
            + New Deck
          </button>
        </div>
      </div>

      {/* Deck list */}
      <div className="flex-1 overflow-y-auto scroll-y px-4 py-4 space-y-3">
        {decks.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-16">
            <div className="text-6xl mb-4">🃏</div>
            <h3 className="text-text-primary font-semibold text-lg mb-2">No decks yet</h3>
            <p className="text-text-secondary text-sm max-w-xs">
              Create your first deck to start tracking your cards and getting AI insights.
            </p>
            <button
              onClick={handleNewDeck}
              className="mt-6 rounded-xl px-6 py-3 text-sm font-semibold"
              style={{ background: '#f59e0b', color: '#0a0e1a' }}
            >
              Create First Deck
            </button>
          </div>
        ) : (
          decks.map((deck) => <DeckCard key={deck.id} deck={deck} />)
        )}

        {/* Free tier limit notice */}
        {tier === 'free' && decks.length >= 3 && (
          <div
            className="rounded-2xl p-4 text-center"
            style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)' }}
          >
            <p className="text-sm" style={{ color: '#f59e0b' }}>
              Free plan limit: 3 decks
            </p>
            <button
              onClick={() => setShowUpgrade(true)}
              className="mt-2 text-xs underline"
              style={{ color: '#f59e0b' }}
            >
              Upgrade to Pro for unlimited decks
            </button>
          </div>
        )}
      </div>

      {/* New deck modal */}
      {showNewDeck && (
        <div
          className="absolute inset-0 flex items-end justify-center"
          style={{ zIndex: 100, background: 'rgba(0,0,0,0.6)' }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowNewDeck(false); }}
        >
          <div
            className="w-full rounded-t-2xl sheet-enter px-4 pt-4 pb-8"
            style={{ background: '#111827', border: '1px solid #1e2d47' }}
          >
            <div className="flex justify-center mb-4">
              <div className="w-10 h-1 rounded-full" style={{ background: '#1e2d47' }} />
            </div>
            <h2 className="text-lg font-bold text-text-primary mb-4">New Deck</h2>

            <form onSubmit={createDeck} className="space-y-4">
              <div>
                <label className="text-xs text-text-secondary block mb-1">Deck Name</label>
                <input
                  type="text"
                  value={newDeckName}
                  onChange={(e) => setNewDeckName(e.target.value)}
                  placeholder="e.g. Mono Red Burn"
                  required
                  autoFocus
                  className="w-full rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 ring-gold"
                  style={{
                    background: '#1a2235',
                    border: '1px solid #1e2d47',
                    color: '#f1f5f9',
                    minHeight: 44,
                  }}
                />
              </div>

              <div>
                <label className="text-xs text-text-secondary block mb-2">Format</label>
                <div className="flex gap-3">
                  {[
                    { value: '60card', label: '60-Card', desc: 'Standard / Modern' },
                    { value: 'commander', label: 'Commander', desc: '100-card singleton' },
                  ].map((f) => (
                    <button
                      type="button"
                      key={f.value}
                      onClick={() => setNewDeckFormat(f.value)}
                      className="flex-1 rounded-xl p-3 text-sm text-left transition-all"
                      style={{
                        background: newDeckFormat === f.value ? 'rgba(245,158,11,0.15)' : '#1a2235',
                        border: `1px solid ${newDeckFormat === f.value ? '#f59e0b' : '#1e2d47'}`,
                        color: newDeckFormat === f.value ? '#f59e0b' : '#94a3b8',
                        minHeight: 64,
                      }}
                    >
                      <div className="font-semibold">{f.label}</div>
                      <div className="text-xs mt-0.5 opacity-70">{f.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNewDeck(false)}
                  className="flex-1 rounded-xl py-3 text-sm font-medium"
                  style={{ background: '#1a2235', border: '1px solid #1e2d47', color: '#94a3b8', minHeight: 44 }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating || !newDeckName.trim()}
                  className="flex-1 rounded-xl py-3 text-sm font-semibold disabled:opacity-50"
                  style={{ background: '#f59e0b', color: '#0a0e1a', minHeight: 44 }}
                >
                  {creating ? 'Creating…' : 'Create Deck'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showUpgrade && <UpgradeModal onClose={() => setShowUpgrade(false)} />}
    </div>
  );
}
