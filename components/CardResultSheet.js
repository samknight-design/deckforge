'use client';

import { useState } from 'react';
import Image from 'next/image';
import { ManaCostDisplay, ColourPips } from './ColourPip';

const NEW_DECK = '__new__';

export default function CardResultSheet({ card, decks, activeDeckId, onAdd, onDismiss }) {
  // If activeDeckId is null (scanner had "New Deck" selected) or no decks exist, pre-select __new__
  const [selectedDeckId, setSelectedDeckId] = useState(activeDeckId || decks[0]?.id || NEW_DECK);
  const [adding, setAdding] = useState(false);

  const handleAdd = async () => {
    if (!selectedDeckId) return;
    setAdding(true);
    await onAdd(card, selectedDeckId);
    setAdding(false);
  };

  const formatPrice = (v) => (v != null ? `€${parseFloat(v).toFixed(2)}` : '—');

  return (
    <>
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop"
        onClick={onDismiss}
        style={{ zIndex: 40 }}
      />

      {/* Sheet */}
      <div
        className="absolute bottom-0 left-0 right-0 sheet-enter rounded-t-2xl"
        style={{ background: '#111827', border: '1px solid #1e2d47', zIndex: 50 }}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-10 h-1 rounded-full" style={{ background: '#1e2d47' }} />
        </div>

        <div className="px-4 pb-6">
          <div className="flex gap-4">
            {/* Card image */}
            <div className="flex-shrink-0">
              {card.image_uri ? (
                <img
                  src={card.image_uri}
                  alt={card.card_name}
                  className="rounded-xl"
                  style={{ width: 90, height: 126, objectFit: 'cover' }}
                />
              ) : (
                <div
                  className="rounded-xl flex items-center justify-center"
                  style={{ width: 90, height: 126, background: '#1a2235', border: '1px solid #1e2d47' }}
                >
                  <span className="text-3xl">🃏</span>
                </div>
              )}
            </div>

            {/* Card info */}
            <div className="flex-1 min-w-0">
              <h3 className="font-bold text-text-primary text-base leading-snug mb-1 truncate">
                {card.card_name}
              </h3>
              <p className="text-text-secondary text-xs mb-2 leading-relaxed line-clamp-2">
                {card.type_line}
              </p>
              <div className="flex items-center gap-2 mb-2">
                <ManaCostDisplay manaCost={card.mana_cost} size={16} />
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold" style={{ color: '#10b981' }}>
                  {formatPrice(card.price_eur)}
                </span>
                {card.price_usd != null && (
                  <span className="text-xs text-text-dim">${parseFloat(card.price_usd).toFixed(2)}</span>
                )}
              </div>
            </div>
          </div>

          {/* Deck selector */}
          <div className="mt-4">
            <label className="text-xs text-text-secondary mb-1 block">Add to deck</label>
            <select
              value={selectedDeckId || ''}
              onChange={(e) => setSelectedDeckId(e.target.value)}
              className="w-full rounded-xl px-4 py-3 text-sm appearance-none"
              style={{
                background: '#1a2235',
                border: '1px solid #1e2d47',
                color: '#f1f5f9',
                minHeight: 44,
              }}
            >
              <option value={NEW_DECK}>✨ Create New Deck</option>
              {decks.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>

          {/* Action buttons */}
          <div className="flex gap-3 mt-4">
            <button
              onClick={onDismiss}
              className="flex-1 rounded-xl py-3 text-sm font-medium"
              style={{
                background: '#1a2235',
                border: '1px solid #1e2d47',
                color: '#94a3b8',
                minHeight: 44,
              }}
            >
              Dismiss
            </button>
            <button
              onClick={handleAdd}
              disabled={adding}
              className="flex-2 rounded-xl py-3 px-6 text-sm font-semibold disabled:opacity-60"
              style={{
                background: selectedDeckId === NEW_DECK
                  ? 'linear-gradient(135deg, #7c3aed, #f59e0b)'
                  : '#f59e0b',
                color: selectedDeckId === NEW_DECK ? '#fff' : '#0a0e1a',
                minHeight: 44,
                flex: 2,
              }}
            >
              {adding ? 'Adding…' : selectedDeckId === NEW_DECK ? '✨ Create & Add' : 'Add to Deck'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
