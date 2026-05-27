'use client';

import { useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { groupCardsByType, computeDeckHash } from '@/lib/deckUtils';
import { showToast } from './Toast';
import CardRow from './CardRow';
import StatsPanel from './StatsPanel';
import CommanderPanel from './CommanderPanel';
import InsightsSheet from './InsightsSheet';
import ImportDeckModal from './ImportDeckModal';
import UpgradeModal from './UpgradeModal';

const TABS = ['Cards', 'Stats', 'Notes'];

function ProgressBar({ value, max }) {
  const pct = Math.min(100, (value / max) * 100);
  const color = pct >= 100 ? '#10b981' : pct >= 75 ? '#f59e0b' : '#ef4444';
  return (
    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: '#1e2d47' }}>
      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

function CollapsibleGroup({ name, cards, format, onQuantityChange, onMakeCommander, onMakePartner }) {
  const [open, setOpen] = useState(true);
  const count = cards.reduce((s, c) => s + (c.quantity || 1), 0);

  return (
    <div className="mb-2">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-2 py-2"
        style={{ minHeight: 40 }}
      >
        <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#94a3b8' }}>
          {name}
        </span>
        <span className="text-xs text-text-dim">
          {count} {open ? '▾' : '▸'}
        </span>
      </button>
      {open && (
        <div className="space-y-0.5">
          {cards.map((card) => (
            <CardRow
              key={card.id || card.scryfall_id}
              card={card}
              format={format}
              onQuantityChange={onQuantityChange}
              onMakeCommander={format === 'commander' && card.is_legendary ? onMakeCommander : null}
              onMakePartner={format === 'commander' && card.is_legendary ? onMakePartner : null}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function DeckDetail({ deck: initialDeck, initialCards, tier, userId }) {
  const [deck, setDeck] = useState(initialDeck);
  const [cards, setCards] = useState(initialCards);
  const [activeTab, setActiveTab] = useState('Cards');
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState(deck.name);
  const [notes, setNotes] = useState(deck.notes || '');
  const [showInsights, setShowInsights] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [lastInsight, setLastInsight] = useState(null);
  const [viewMode, setViewMode] = useState('list'); // 'list' | 'grid'

  const supabase = createClient();
  const router = useRouter();

  const target = deck.format === 'commander' ? 100 : 60;
  const cardCount = cards.reduce((s, c) => s + (c.quantity || 1), 0);
  const totalValue = cards.reduce((s, c) => s + (c.price_eur || 0) * (c.quantity || 1), 0);

  const deckHash = useMemo(() => computeDeckHash(cards), [cards]);
  const hasChanged = deck.insight_deck_hash !== deckHash;

  const groupedCards = useMemo(() => groupCardsByType(cards), [cards]);

  const saveName = async () => {
    if (editedName.trim() === deck.name) { setIsEditingName(false); return; }
    const { error } = await supabase
      .from('decks')
      .update({ name: editedName.trim() })
      .eq('id', deck.id);
    if (!error) setDeck((d) => ({ ...d, name: editedName.trim() }));
    setIsEditingName(false);
  };

  const saveNotes = async (value) => {
    setNotes(value);
    await supabase.from('decks').update({ notes: value }).eq('id', deck.id);
  };

  const updateQuantity = async (card, delta) => {
    const newQty = (card.quantity || 1) + delta;
    if (newQty < 1) {
      // Remove card
      await supabase.from('deck_cards').delete().eq('id', card.id);
      setCards((prev) => prev.filter((c) => c.id !== card.id));
    } else {
      await supabase.from('deck_cards').update({ quantity: newQty }).eq('id', card.id);
      setCards((prev) => prev.map((c) => c.id === card.id ? { ...c, quantity: newQty } : c));
    }
  };

  const makeCommander = async (card) => {
    // Clear existing commander
    await supabase.from('deck_cards').update({ is_commander: false }).eq('deck_id', deck.id);

    // Set new commander
    await supabase.from('deck_cards').update({ is_commander: true }).eq('id', card.id);

    // Update deck
    const updates = {
      commander_scryfall_id: card.scryfall_id,
      commander_name: card.card_name,
      commander_image_url: card.image_uri || null,
    };
    await supabase.from('decks').update(updates).eq('id', deck.id);

    setDeck((d) => ({ ...d, ...updates }));
    setCards((prev) => prev.map((c) => ({ ...c, is_commander: c.id === card.id })));
  };

  const makePartner = async (card) => {
    await supabase.from('deck_cards').update({ is_partner: false }).eq('deck_id', deck.id);
    await supabase.from('deck_cards').update({ is_partner: true }).eq('id', card.id);

    const updates = {
      partner_scryfall_id: card.scryfall_id,
      partner_name: card.card_name,
      partner_image_url: card.image_uri || null,
    };
    await supabase.from('decks').update(updates).eq('id', deck.id);
    setDeck((d) => ({ ...d, ...updates }));
    setCards((prev) => prev.map((c) => ({ ...c, is_partner: c.id === card.id })));
  };

  const handleImportDone = (imported, failed) => {
    router.refresh();
    if (failed > 0) {
      showToast(`Imported ${imported} cards. ${failed} couldn't be found.`, 'error');
    } else {
      showToast(`✓ Imported ${imported} cards`, 'success');
    }
  };

  const handleInsights = () => {
    if (tier !== 'pro') {
      setShowUpgrade(true);
    } else {
      setShowInsights(true);
    }
  };

  const deleteDeck = async () => {
    if (!confirm('Delete this deck? This cannot be undone.')) return;
    await supabase.from('deck_cards').delete().eq('deck_id', deck.id);
    await supabase.from('decks').delete().eq('id', deck.id);
    router.push('/decks');
  };

  return (
    <div className="h-full flex flex-col" style={{ background: '#0a0e1a' }}>
      {/* Header */}
      <div
        className="flex-shrink-0"
        style={{ background: '#111827', borderBottom: '1px solid #1e2d47' }}
      >
        {/* Top row: back + title + menu */}
        <div className="flex items-center gap-2 px-3 pt-4 pb-2">
          <button
            onClick={() => router.back()}
            className="flex-shrink-0 flex items-center justify-center rounded-xl"
            style={{ width: 40, height: 40, background: '#1a2235', border: '1px solid #1e2d47', color: '#94a3b8' }}
          >
            ←
          </button>

          <div className="flex-1 min-w-0">
            {isEditingName ? (
              <input
                value={editedName}
                onChange={(e) => setEditedName(e.target.value)}
                onBlur={saveName}
                onKeyDown={(e) => e.key === 'Enter' && saveName()}
                autoFocus
                className="w-full bg-transparent text-text-primary font-bold text-base outline-none border-b"
                style={{ borderColor: '#f59e0b' }}
              />
            ) : (
              <h1
                className="text-base font-bold text-text-primary truncate cursor-pointer"
                onClick={() => setIsEditingName(true)}
              >
                {deck.name} ✏️
              </h1>
            )}
          </div>

          <span
            className="flex-shrink-0 text-xs font-semibold rounded-full px-2.5 py-1"
            style={{
              background: deck.format === 'commander' ? 'rgba(124,58,237,0.15)' : 'rgba(245,158,11,0.15)',
              color: deck.format === 'commander' ? '#a78bfa' : '#f59e0b',
              border: `1px solid ${deck.format === 'commander' ? 'rgba(124,58,237,0.3)' : 'rgba(245,158,11,0.3)'}`,
            }}
          >
            {deck.format === 'commander' ? 'CMD' : '60'}
          </span>

          <button
            onClick={deleteDeck}
            className="flex-shrink-0 flex items-center justify-center rounded-xl text-xs"
            style={{ width: 36, height: 36, color: '#475569' }}
            title="Delete deck"
          >
            🗑
          </button>
        </div>

        {/* Stats row */}
        <div className="flex items-center gap-4 px-4 pb-2">
          <span className="text-sm text-text-secondary">
            <span className="font-bold text-text-primary">{cardCount}</span>/{target}
          </span>
          <span className="text-sm font-bold" style={{ color: '#10b981' }}>
            €{totalValue.toFixed(2)}
          </span>
          <div className="flex-1">
            <ProgressBar value={cardCount} max={target} />
          </div>
        </div>

        {/* Commander panel */}
        <CommanderPanel deck={deck} />

        {/* Internal tab bar */}
        <div className="flex px-4 pt-1 pb-0 gap-1">
          {TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className="px-4 py-2.5 text-sm font-semibold rounded-t-xl transition-all"
              style={{
                background: activeTab === tab ? '#0a0e1a' : 'transparent',
                color: activeTab === tab ? '#f59e0b' : '#94a3b8',
                borderBottom: activeTab === tab ? '2px solid #f59e0b' : '2px solid transparent',
                minHeight: 40,
              }}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto scroll-y pb-20">
        {activeTab === 'Cards' && (
          <div className="px-3 pt-3">
            {/* Action row */}
            <div className="flex gap-2 mb-3">
              <button
                onClick={() => setShowImport(true)}
                className="flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-semibold"
                style={{ background: '#1a2235', border: '1px solid #1e2d47', color: '#94a3b8', minHeight: 40 }}
              >
                📋 Import
              </button>
              <button
                onClick={() => router.push(`/scan?deckId=${deck.id}&mode=Search`)}
                className="flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-semibold"
                style={{ background: '#1a2235', border: '1px solid #1e2d47', color: '#94a3b8', minHeight: 40 }}
              >
                🔍 Search
              </button>
              <button
                onClick={() => router.push(`/scan?deckId=${deck.id}`)}
                className="flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-semibold"
                style={{ background: '#1a2235', border: '1px solid #1e2d47', color: '#94a3b8', minHeight: 40 }}
              >
                📷 Scan
              </button>
              <button
                onClick={() => setViewMode(viewMode === 'list' ? 'grid' : 'list')}
                className="rounded-xl py-2.5 px-3 text-xs font-semibold"
                style={{ background: '#1a2235', border: '1px solid #1e2d47', color: '#94a3b8', minHeight: 40 }}
              >
                {viewMode === 'list' ? '⊞' : '≡'}
              </button>
            </div>

            {cards.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="text-5xl mb-4">📭</div>
                <p className="text-text-secondary text-sm">No cards yet. Scan or import to add cards.</p>
              </div>
            ) : viewMode === 'grid' ? (
              <div className="grid grid-cols-3 gap-2 pb-4">
                {cards.map((card) => (
                  <div key={card.id} className="rounded-xl overflow-hidden">
                    {card.image_uri ? (
                      <img
                        src={card.image_uri}
                        alt={card.card_name}
                        className="w-full"
                        style={{ aspectRatio: '2/3', objectFit: 'cover' }}
                      />
                    ) : (
                      <div
                        className="w-full flex items-center justify-center text-2xl"
                        style={{ aspectRatio: '2/3', background: '#1a2235', border: '1px solid #1e2d47' }}
                      >
                        🃏
                      </div>
                    )}
                    <div className="px-1 py-0.5 text-center">
                      <span className="text-xs text-text-dim">{card.quantity}x</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="pb-4">
                {Object.entries(groupedCards).map(([groupName, groupCards]) => (
                  <CollapsibleGroup
                    key={groupName}
                    name={groupName}
                    cards={groupCards}
                    format={deck.format}
                    onQuantityChange={updateQuantity}
                    onMakeCommander={makeCommander}
                    onMakePartner={makePartner}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'Stats' && (
          <StatsPanel cards={cards} format={deck.format} />
        )}

        {activeTab === 'Notes' && (
          <div className="px-4 pt-4">
            <textarea
              value={notes}
              onChange={(e) => saveNotes(e.target.value)}
              placeholder="Add notes about your deck strategy, card explanations, upgrade plans…"
              className="w-full rounded-xl p-4 text-sm leading-relaxed outline-none focus:ring-2 ring-gold resize-none"
              style={{
                background: '#111827',
                border: '1px solid #1e2d47',
                color: '#f1f5f9',
                minHeight: 300,
              }}
            />
            <p className="text-xs text-text-dim mt-2">Auto-saved</p>
          </div>
        )}
      </div>

      {/* Generate Insights FAB */}
      <div
        className="absolute bottom-0 left-0 right-0 px-4 pb-3 pt-2"
        style={{ background: 'linear-gradient(to top, #0a0e1a 70%, transparent)', pointerEvents: 'none' }}
      >
        <button
          onClick={handleInsights}
          className="w-full rounded-2xl py-3.5 text-sm font-bold flex items-center justify-center gap-2"
          style={{
            background: tier === 'pro'
              ? 'linear-gradient(135deg, #7c3aed, #f59e0b)'
              : '#1a2235',
            color: tier === 'pro' ? '#fff' : '#94a3b8',
            border: tier !== 'pro' ? '1px solid #1e2d47' : 'none',
            minHeight: 48,
            pointerEvents: 'all',
          }}
        >
          <span>✨</span>
          {tier === 'pro' ? 'Generate Insights' : '✨ Generate Insights (Pro)'}
          {tier !== 'pro' && (
            <span
              className="ml-1 text-xs rounded-full px-2 py-0.5"
              style={{ background: 'rgba(245,158,11,0.2)', color: '#f59e0b' }}
            >
              Pro
            </span>
          )}
        </button>
      </div>

      {/* Modals */}
      {showInsights && (
        <InsightsSheet
          deckId={deck.id}
          deck={deck}
          tier={tier}
          hasChanged={hasChanged}
          lastInsight={lastInsight}
          onClose={() => setShowInsights(false)}
        />
      )}
      {showImport && (
        <ImportDeckModal
          deckId={deck.id}
          onImport={handleImportDone}
          onClose={() => setShowImport(false)}
        />
      )}
      {showUpgrade && <UpgradeModal onClose={() => setShowUpgrade(false)} />}
    </div>
  );
}
