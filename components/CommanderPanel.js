'use client';

// Compact single-line commander strip (art-crop thumbnail) to keep the deck
// header short and leave more room for the card list.
export default function CommanderPanel({ deck }) {
  if (!deck.commander_name && !deck.partner_name) return null;

  return (
    <div className="px-4 py-2 flex items-center gap-2" style={{ background: 'rgba(124,58,237,0.08)', borderBottom: '1px solid rgba(124,58,237,0.2)' }}>
      {deck.commander_image_url && (
        <img
          src={deck.commander_image_url}
          alt=""
          className="rounded flex-shrink-0"
          style={{ width: 26, height: 26, objectFit: 'cover', objectPosition: 'center 18%' }}
        />
      )}
      <span className="text-xs font-semibold truncate" style={{ color: '#c4b5fd' }}>
        ⚔ {deck.commander_name}{deck.partner_name ? ` + ${deck.partner_name}` : ''}
      </span>
    </div>
  );
}
