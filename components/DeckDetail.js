'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { groupCardsByType, computeDeckHash, getDeckWarnings } from '@/lib/deckUtils';
import { showToast } from './Toast';
import CardRow from './CardRow';
import StatsPanel from './StatsPanel';
import CommanderPanel from './CommanderPanel';
import InsightsSheet from './InsightsSheet';
import ImportDeckModal from './ImportDeckModal';
import UpgradeModal from './UpgradeModal';

const TABS = ['Cards', 'Stats', 'Notes', 'Insights'];

function ProgressBar({ value, max }) {
  const pct = Math.min(100, (value / max) * 100);
  const color = pct >= 100 ? '#10b981' : pct >= 75 ? '#f59e0b' : '#ef4444';
  return (
    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: '#1e2d47' }}>
      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

function CollapsibleGroup({ name, cards, format, hasCommander, onQuantityChange, onMakeCommander, onMakePartner, onToggleFoil }) {
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
              hasCommander={hasCommander}
              onQuantityChange={onQuantityChange}
              onMakeCommander={format === 'commander' && card.is_legendary ? onMakeCommander : null}
              onMakePartner={format === 'commander' && card.is_legendary ? onMakePartner : null}
              onToggleFoil={onToggleFoil}
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
  const [showImport, setShowImport] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [lastInsight, setLastInsight] = useState(null);
  const [viewMode, setViewMode] = useState('list'); // 'list' | 'grid'
  const [isPublic, setIsPublic] = useState(!!deck.is_public);
  const [togglingPublic, setTogglingPublic] = useState(false);

  const supabase = createClient();
  const router = useRouter();

  const canPublish = deck.bracket != null;

  const togglePublic = async () => {
    if (!canPublish || togglingPublic) return;
    const next = !isPublic;
    setTogglingPublic(true);
    try {
      const res = await fetch('/api/decks/visibility', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deckId: deck.id, isPublic: next }),
      });
      const data = await res.json();
      if (!res.ok) { showToast(data.error || 'Failed to update visibility', 'error'); return; }
      setIsPublic(next);
      setDeck((d) => ({ ...d, is_public: next }));
      showToast(next ? '✓ Deck is now public' : 'Deck set to private', 'success');
    } catch {
      showToast('Failed to update visibility', 'error');
    } finally {
      setTogglingPublic(false);
    }
  };

  const target = deck.format === 'commander' ? 100 : 60;
  const cardCount = cards.reduce((s, c) => s + (c.quantity || 1), 0);
  const totalValue = cards.reduce((s, c) => {
    const unit = c.is_foil ? (c.price_eur_foil ?? c.price_eur ?? 0) : (c.price_eur ?? 0);
    return s + unit * (c.quantity || 1);
  }, 0);

  const deckHash = useMemo(() => computeDeckHash(cards), [cards]);
  const hasChanged = deck.insight_deck_hash !== deckHash;

  const groupedCards = useMemo(() => groupCardsByType(cards), [cards]);

  // Compute commander color identity from cards marked as commander/partner
  const commanderColorIdentity = useMemo(() => {
    const cmdCards = cards.filter((c) => c.is_commander || c.is_partner);
    return [...new Set(cmdCards.flatMap((c) => c.color_identity || []))];
  }, [cards]);

  const deckWarnings = useMemo(
    () => getDeckWarnings(cards, deck.format, commanderColorIdentity),
    [cards, deck.format, commanderColorIdentity]
  );

  const [showWarnings, setShowWarnings] = useState(false);

  // Fetch latest stored insight on mount
  useEffect(() => {
    supabase
      .from('insights')
      .select('content, data, bracket_estimate, generated_at, deck_hash')
      .eq('deck_id', deck.id)
      .order('generated_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setLastInsight(data);
      });
  }, [deck.id]);

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

  const toggleCardFoil = async (card) => {
    const next = !card.is_foil;
    const { error } = await supabase.from('deck_cards').update({ is_foil: next }).eq('id', card.id);
    if (error) { showToast('A foil/non-foil of this card already exists in the deck', 'error'); return; }
    setCards((prev) => prev.map((c) => c.id === card.id ? { ...c, is_foil: next } : c));
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

        {/* Public visibility */}
        <div className="px-4 pb-2">
          <div
            className="flex items-center gap-3 rounded-xl px-3 py-2"
            style={{ background: '#0d1424', border: `1px solid ${isPublic ? 'rgba(16,185,129,0.4)' : '#1e2d47'}` }}
          >
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium" style={{ color: isPublic ? '#10b981' : '#f1f5f9' }}>
                {isPublic ? '🌐 Public' : '🔒 Currently private'}
              </div>
              <div className="text-xs" style={{ color: isPublic ? '#64748b' : '#a78bfa' }}>
                {canPublish
                  ? (isPublic ? 'Others can view, like & clone it' : 'Make it public to share it, collect likes & earn XP →')
                  : 'Run AI Insights to set a bracket, then you can publish'}
              </div>
            </div>
            {isPublic && (
              <Link
                href={`/community/${deck.id}`}
                className="flex-shrink-0 text-xs font-semibold rounded-lg px-2.5 py-1.5"
                style={{ background: '#1a2235', border: '1px solid #1e2d47', color: '#94a3b8' }}
              >
                View
              </Link>
            )}
            <button
              onClick={togglePublic}
              disabled={!canPublish || togglingPublic}
              title={canPublish ? 'Toggle public visibility' : 'Run AI Insights first'}
              className="relative rounded-full transition-colors flex-shrink-0 disabled:opacity-40"
              style={{ width: 44, height: 24, background: isPublic ? '#10b981' : '#334155' }}
            >
              <span className="absolute rounded-full bg-white transition-all" style={{ width: 20, height: 20, top: 2, left: isPublic ? 22 : 2 }} />
            </button>
          </div>
        </div>

        {/* Commander panel */}
        <CommanderPanel deck={deck} />

        {/* Internal tab bar */}
        <div className="flex px-3 pt-1 pb-0 gap-1">
          {TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className="flex-1 px-2 py-2.5 text-sm font-semibold rounded-t-xl transition-all"
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
      <div className="flex-1 overflow-y-auto scroll-y pb-4">
        {activeTab === 'Cards' && (
          <div className="px-3 pt-3">
            {/* Validation warnings */}
            {deckWarnings.length > 0 && (
              <div className="mb-3 rounded-xl overflow-hidden" style={{ border: '1px solid rgba(239,68,68,0.3)' }}>
                <button
                  onClick={() => setShowWarnings(!showWarnings)}
                  className="w-full flex items-center justify-between px-3 py-2.5 text-sm font-semibold"
                  style={{ background: 'rgba(239,68,68,0.1)', color: '#f87171' }}
                >
                  <span>⚠️ {deckWarnings.length} issue{deckWarnings.length > 1 ? 's' : ''} found</span>
                  <span style={{ fontSize: 10 }}>{showWarnings ? '▾' : '▸'}</span>
                </button>
                {showWarnings && (
                  <div className="px-3 py-2 space-y-1.5" style={{ background: 'rgba(239,68,68,0.05)' }}>
                    {deckWarnings.map((w, i) => (
                      <div key={i} className="text-xs" style={{ color: '#fca5a5' }}>
                        {w.type === 'singleton' && (
                          <span>📋 <strong>{w.card}</strong> — {w.qty} copies (singleton violation)</span>
                        )}
                        {w.type === 'color_identity' && (
                          <span>🎨 <strong>{w.card}</strong> — outside commander's color identity</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Add-cards row */}
            <p className="text-xs font-semibold uppercase tracking-wider mb-2 px-1" style={{ color: '#64748b' }}>
              Add cards to this deck
            </p>
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
                🔍 Find
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
                title={viewMode === 'list' ? 'Grid view' : 'List view'}
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
                    hasCommander={!!deck.commander_name}
                    onQuantityChange={updateQuantity}
                    onMakeCommander={makeCommander}
                    onMakePartner={makePartner}
                    onToggleFoil={toggleCardFoil}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'Stats' && (
          <StatsPanel cards={cards} format={deck.format} bracket={deck.bracket} />
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

        {activeTab === 'Insights' && (
          <InsightsSheet
            deckId={deck.id}
            deck={deck}
            tier={tier}
            hasChanged={hasChanged}
            lastInsight={lastInsight}
            onInsightGenerated={(ni) => setLastInsight(ni)}
            inline
          />
        )}
      </div>

      {/* Modals */}
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
