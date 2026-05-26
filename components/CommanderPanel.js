'use client';

import { ColourPips } from './ColourPip';

export default function CommanderPanel({ deck, onSetCommander }) {
  if (!deck.commander_name && !deck.partner_name) return null;

  return (
    <div className="px-4 py-3" style={{ background: 'rgba(124,58,237,0.08)', borderBottom: '1px solid rgba(124,58,237,0.2)' }}>
      <div className="text-xs font-semibold mb-2" style={{ color: '#a78bfa' }}>
        ⚔ COMMANDER
      </div>
      <div className="flex gap-3">
        {/* Commander */}
        {deck.commander_name && (
          <div className="flex items-center gap-3">
            {deck.commander_image_url && (
              <img
                src={deck.commander_image_url}
                alt={deck.commander_name}
                className="rounded-lg flex-shrink-0"
                style={{ width: 56, height: 78, objectFit: 'cover' }}
              />
            )}
            <div>
              <p className="font-semibold text-text-primary text-sm">{deck.commander_name}</p>
              <p className="text-xs text-text-secondary mt-0.5">Commander</p>
            </div>
          </div>
        )}

        {/* Partner divider */}
        {deck.partner_name && (
          <>
            <div className="flex items-center text-text-dim text-sm">+</div>
            <div className="flex items-center gap-3">
              {deck.partner_image_url && (
                <img
                  src={deck.partner_image_url}
                  alt={deck.partner_name}
                  className="rounded-lg flex-shrink-0"
                  style={{ width: 56, height: 78, objectFit: 'cover' }}
                />
              )}
              <div>
                <p className="font-semibold text-text-primary text-sm">{deck.partner_name}</p>
                <p className="text-xs text-text-secondary mt-0.5">Partner</p>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
