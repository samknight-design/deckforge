'use client';

import { useState } from 'react';
import { ManaCostDisplay } from './ColourPip';
import CardModal from './CardModal';

export default function CardRow({ card, format, hasCommander, onQuantityChange, onMakeCommander, onMakePartner, onToggleFoil }) {
  const [showModal, setShowModal] = useState(false);
  const isCommander = card.is_commander;
  const isPartner = card.is_partner;
  const isSingleton = format === 'commander';
  const isBasicLand = card.type_line?.includes('Basic');
  const showSingletonWarning = isSingleton && card.quantity > 1 && !isBasicLand;

  return (
    <>
      <div
        className="flex items-center gap-3 py-2.5 px-3 rounded-xl"
        style={{ background: isCommander || isPartner ? 'rgba(124,58,237,0.08)' : 'transparent' }}
      >
        {/* Card thumbnail */}
        <button onClick={() => setShowModal(true)} className="flex-shrink-0">
          {card.image_uri ? (
            <img
              src={card.image_uri}
              alt={card.card_name}
              className="rounded-lg"
              style={{ width: 40, height: 40, objectFit: 'cover', objectPosition: 'center 16%' }}
            />
          ) : (
            <div
              className="rounded-lg flex items-center justify-center"
              style={{ width: 40, height: 40, background: '#1a2235', border: '1px solid #1e2d47' }}
            >
              <span className="text-sm">🃏</span>
            </div>
          )}
        </button>

        {/* Card info */}
        <div className="flex-1 min-w-0" onClick={() => setShowModal(true)}>
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-medium text-text-primary truncate">
              {card.card_name}
            </span>
            {(isCommander || isPartner) && (
              <span
                className="text-xs font-bold rounded px-1.5 py-0.5"
                style={{ background: 'rgba(124,58,237,0.3)', color: '#a78bfa' }}
              >
                {isPartner ? 'Partner' : 'CMD'}
              </span>
            )}
            {card.is_foil && (
              <span
                className="text-xs font-bold rounded px-1.5 py-0.5"
                style={{ background: 'rgba(124,58,237,0.22)', color: '#c4b5fd' }}
                title="Foil"
              >
                ✦ Foil
              </span>
            )}
            {showSingletonWarning && (
              <span className="text-xs" title="Singleton violation">⚠️</span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-xs text-text-dim truncate" style={{ maxWidth: 160 }}>
              {card.type_line?.split(' — ')[0]}
            </span>
          </div>
        </div>

        {/* CMC */}
        <div className="flex-shrink-0 w-7 text-center">
          <ManaCostDisplay manaCost={card.mana_cost} size={14} />
        </div>

        {/* Qty controls */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={() => onQuantityChange(card, -1)}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-sm font-bold transition-colors"
            style={{ background: '#1a2235', color: '#94a3b8', border: '1px solid #1e2d47', minHeight: 28 }}
          >
            −
          </button>
          <span className="text-sm font-semibold text-text-primary w-5 text-center">
            {card.quantity}
          </span>
          <button
            onClick={() => onQuantityChange(card, 1)}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-sm font-bold transition-colors"
            style={{ background: '#1a2235', color: '#94a3b8', border: '1px solid #1e2d47', minHeight: 28 }}
          >
            +
          </button>
        </div>
      </div>

      {showModal && (
        <CardModal
          card={card}
          format={format}
          hasCommander={hasCommander}
          onClose={() => setShowModal(false)}
          onMakeCommander={onMakeCommander ? () => { onMakeCommander(card); setShowModal(false); } : null}
          onMakePartner={onMakePartner ? () => { onMakePartner(card); setShowModal(false); } : null}
          onToggleFoil={onToggleFoil ? () => onToggleFoil(card) : null}
        />
      )}
    </>
  );
}
