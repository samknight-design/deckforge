'use client';

import { ManaCostDisplay, ColourPips } from './ColourPip';

export default function CardModal({ card, format, onClose, onMakeCommander, onMakePartner }) {
  const formatPrice = (v) => (v != null ? `€${parseFloat(v).toFixed(2)}` : '—');
  const formatUsd = (v) => (v != null ? `$${parseFloat(v).toFixed(2)}` : '—');

  return (
    <>
      <div
        className="fixed inset-0 bg-black/70 backdrop"
        onClick={onClose}
        style={{ zIndex: 200 }}
      />
      <div
        className="fixed inset-x-4 top-1/2 -translate-y-1/2 rounded-2xl overflow-hidden sheet-enter"
        style={{ background: '#111827', border: '1px solid #1e2d47', zIndex: 210, maxWidth: 400, margin: '0 auto' }}
      >
        {/* Card art */}
        {card.image_uri && (
          <div className="relative w-full" style={{ paddingBottom: '70%', background: '#0a0e1a' }}>
            <img
              src={card.image_uri}
              alt={card.card_name}
              className="absolute inset-0 w-full h-full object-contain"
            />
            {card.image_uri_back && (
              <img
                src={card.image_uri_back}
                alt={`${card.card_name} (back)`}
                className="absolute top-2 right-2 rounded-lg"
                style={{ width: 60, height: 84, objectFit: 'cover', border: '2px solid #1e2d47' }}
              />
            )}
          </div>
        )}

        <div className="p-4">
          {/* Name + mana cost */}
          <div className="flex items-start justify-between gap-2 mb-2">
            <h2 className="font-bold text-text-primary text-lg leading-snug flex-1">{card.card_name}</h2>
            <ManaCostDisplay manaCost={card.mana_cost} size={18} />
          </div>

          {/* Type line */}
          <p className="text-sm text-text-secondary mb-3">{card.type_line}</p>

          {/* Oracle text */}
          {card.oracle_text && (
            <div
              className="rounded-xl p-3 mb-3 text-sm leading-relaxed"
              style={{ background: '#1a2235', color: '#cbd5e1' }}
            >
              {card.oracle_text}
            </div>
          )}

          {/* Stats row */}
          <div className="flex items-center gap-4 mb-3 flex-wrap">
            {card.power != null && card.toughness != null && (
              <span className="text-sm font-bold" style={{ color: '#f59e0b' }}>
                {card.power}/{card.toughness}
              </span>
            )}
            {card.loyalty != null && (
              <span className="text-sm font-bold" style={{ color: '#7c3aed' }}>
                Loyalty: {card.loyalty}
              </span>
            )}
            <span className="text-sm text-text-secondary">CMC: {card.cmc}</span>
            {card.set_name && (
              <span className="text-xs text-text-dim">{card.set_name}</span>
            )}
          </div>

          {/* Prices */}
          <div className="flex gap-4 mb-4">
            <div>
              <div className="text-xs text-text-dim mb-0.5">Cardmarket</div>
              <div className="font-bold text-green-400 text-base">{formatPrice(card.price_eur)}</div>
            </div>
            {card.price_eur_foil != null && (
              <div>
                <div className="text-xs text-text-dim mb-0.5">Foil EUR</div>
                <div className="font-semibold text-text-secondary text-sm">{formatPrice(card.price_eur_foil)}</div>
              </div>
            )}
            <div>
              <div className="text-xs text-text-dim mb-0.5">TCGPlayer</div>
              <div className="font-semibold text-text-secondary text-sm">{formatUsd(card.price_usd)}</div>
            </div>
          </div>

          {/* Color identity */}
          {card.color_identity?.length > 0 && (
            <div className="flex items-center gap-2 mb-4">
              <span className="text-xs text-text-dim">Color identity:</span>
              <ColourPips colors={card.color_identity} size={18} />
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-2 flex-wrap">
            {onMakeCommander && format === 'commander' && card.is_legendary && !card.is_commander && (
              <button
                onClick={onMakeCommander}
                className="flex-1 rounded-xl py-2.5 text-sm font-semibold"
                style={{ background: 'rgba(124,58,237,0.2)', color: '#a78bfa', border: '1px solid rgba(124,58,237,0.4)', minHeight: 44 }}
              >
                ⚔ Set as Commander
              </button>
            )}
            {onMakePartner && format === 'commander' && card.is_legendary && !card.is_commander && !card.is_partner && (
              <button
                onClick={onMakePartner}
                className="flex-1 rounded-xl py-2.5 text-sm font-semibold"
                style={{ background: 'rgba(124,58,237,0.1)', color: '#a78bfa', border: '1px solid rgba(124,58,237,0.3)', minHeight: 44 }}
              >
                + Set as Partner
              </button>
            )}
            <button
              onClick={onClose}
              className="flex-1 rounded-xl py-2.5 text-sm font-medium"
              style={{ background: '#1a2235', border: '1px solid #1e2d47', color: '#94a3b8', minHeight: 44 }}
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
