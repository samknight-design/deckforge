'use client';

// VariantPicker — sheet listing every printing of a card so the user can swap
// to the specific edition they own (foil, full-art, borderless, etc.). Used
// from CardResultSheet (post-scan, before saving) and CardModal (after the
// card is already in a deck).
//
// Calls /api/scryfall/prints?name=… on open. Selecting a printing returns its
// normalised card payload (the same shape as /api/scryfall/card returns).

import { useEffect, useState } from 'react';
import { formatEurTotal } from '@/lib/currency';
import { getCurrency } from '@/lib/prefs';

export default function VariantPicker({ cardName, currentScryfallId, onPick, onDismiss }) {
  const [prints, setPrints] = useState(null); // null = loading, [] = none
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/scryfall/prints?name=${encodeURIComponent(cardName)}`);
        const data = await res.json();
        if (alive) setPrints(Array.isArray(data) ? data : []);
      } catch (e) {
        if (alive) setError(String(e?.message || e));
      }
    })();
    return () => { alive = false; };
  }, [cardName]);

  const currency = typeof window !== 'undefined' ? getCurrency() : 'GBP';

  return (
    <>
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60"
        onClick={onDismiss}
        style={{ zIndex: 70 }}
      />
      {/* Sheet */}
      <div
        className="absolute bottom-0 left-0 right-0 rounded-t-2xl flex flex-col"
        style={{ background: '#111827', border: '1px solid #1e2d47', zIndex: 71, maxHeight: '80vh' }}
      >
        <div className="flex justify-center pt-3 pb-2 flex-shrink-0">
          <div className="w-10 h-1 rounded-full" style={{ background: '#1e2d47' }} />
        </div>
        <div className="px-4 pb-2 flex-shrink-0">
          <h3 className="text-base font-bold text-white">Change printing</h3>
          <p className="text-xs mt-0.5" style={{ color: '#94a3b8' }}>
            Pick the specific edition you own — {cardName}
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-2 pb-6">
          {prints === null && !error && (
            <div className="flex items-center justify-center py-12">
              <div className="w-6 h-6 border-2 rounded-full animate-spin" style={{ borderColor: '#f59e0b', borderTopColor: 'transparent' }} />
            </div>
          )}
          {error && (
            <p className="text-center text-sm py-8" style={{ color: '#f87171' }}>{error}</p>
          )}
          {prints?.length === 0 && (
            <p className="text-center text-sm py-8" style={{ color: '#64748b' }}>No printings found</p>
          )}
          {prints?.map((p) => {
            const isCurrent = p.scryfall_id === currentScryfallId;
            return (
              <button
                key={p.scryfall_id}
                onClick={() => onPick(p)}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-xl transition-colors active:bg-white/5 mb-1"
                style={{
                  background: isCurrent ? 'rgba(245,158,11,0.12)' : 'transparent',
                  border: `1px solid ${isCurrent ? 'rgba(245,158,11,0.5)' : 'transparent'}`,
                  minHeight: 64,
                }}
              >
                {p.image_uri ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={p.image_uri}
                    alt={p.set_name}
                    className="rounded flex-shrink-0"
                    style={{ width: 38, height: 53, objectFit: 'cover' }}
                  />
                ) : (
                  <div className="rounded flex-shrink-0 flex items-center justify-center" style={{ width: 38, height: 53, background: '#1a2235' }}>🃏</div>
                )}
                <div className="flex-1 min-w-0 text-left">
                  <div className="text-sm font-medium text-white truncate">
                    {p.set_name}{isCurrent && <span className="ml-2 text-xs font-semibold" style={{ color: '#f59e0b' }}>· current</span>}
                  </div>
                  <div className="text-xs mt-0.5" style={{ color: '#64748b' }}>
                    {p.set_code?.toUpperCase()}
                    {p.price_eur != null && <span className="ml-2" style={{ color: '#10b981' }}>{formatEurTotal(p.price_eur, currency)}</span>}
                    {p.price_eur_foil != null && <span className="ml-2" style={{ color: '#a78bfa' }}>✦ {formatEurTotal(p.price_eur_foil, currency)}</span>}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        <div className="flex-shrink-0 px-4 pb-4 pt-2 border-t" style={{ borderColor: '#1e2d47' }}>
          <button
            onClick={onDismiss}
            className="w-full rounded-xl py-2.5 text-sm font-medium"
            style={{ background: '#1a2235', border: '1px solid #1e2d47', color: '#94a3b8', minHeight: 44 }}
          >
            Cancel
          </button>
        </div>
      </div>
    </>
  );
}
