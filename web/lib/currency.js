// Currency display preference.
//
// Cards in card_cache already carry price_eur and price_usd from Scryfall, so
// EUR and USD are exact (no conversion). For GBP we approximate from the EUR
// price using a static rate — accurate enough for a deck-builder where card
// prices fluctuate daily anyway. Real-time FX can be wired later.

export const CURRENCY_OPTIONS = [
  { key: 'GBP', symbol: '£', label: 'British Pound (£)' },
  { key: 'EUR', symbol: '€', label: 'Euro (€)' },
  { key: 'USD', symbol: '$', label: 'US Dollar ($)' },
];

const EUR_TO_GBP = 0.85; // approximate; refresh periodically if needed
export const DEFAULT_CURRENCY = 'GBP';

export function symbolFor(currency = DEFAULT_CURRENCY) {
  return CURRENCY_OPTIONS.find((c) => c.key === currency)?.symbol || '£';
}

// Format a price given a card-like object that may carry price_eur / price_usd.
// `value` (number) is treated as EUR (legacy callers).
export function formatPrice(value, currency = DEFAULT_CURRENCY) {
  if (value == null || isNaN(value)) return '—';
  const sym = symbolFor(currency);
  let n = parseFloat(value);
  if (currency === 'GBP') n = n * EUR_TO_GBP;
  // USD callers should pass the USD value directly; if a EUR value is passed
  // for USD display the result will look slightly off but is non-fatal.
  return `${sym}${n.toFixed(2)}`;
}

// Pick the best per-card price for the active currency, with foil awareness.
export function cardPrice(card, currency = DEFAULT_CURRENCY, foil = false) {
  if (!card) return null;
  if (currency === 'USD') {
    const v = foil ? (card.price_usd_foil ?? card.price_usd) : card.price_usd;
    return v != null ? parseFloat(v) : null;
  }
  // EUR / GBP both start from price_eur
  const v = foil ? (card.price_eur_foil ?? card.price_eur) : card.price_eur;
  if (v == null) return null;
  const eur = parseFloat(v);
  return currency === 'GBP' ? eur * EUR_TO_GBP : eur;
}

export function formatCardPrice(card, currency = DEFAULT_CURRENCY, foil = false) {
  const v = cardPrice(card, currency, foil);
  if (v == null) return '—';
  return `${symbolFor(currency)}${v.toFixed(2)}`;
}

// EUR-denominated aggregate (e.g. a deck total) → formatted in the active currency.
export function formatEurTotal(eurAmount, currency = DEFAULT_CURRENCY) {
  if (eurAmount == null || isNaN(eurAmount)) return '—';
  const sym = symbolFor(currency);
  const n = currency === 'GBP' ? parseFloat(eurAmount) * EUR_TO_GBP : parseFloat(eurAmount);
  // USD callers don't usually go through here; falls through as EUR-equivalent.
  return `${sym}${n.toFixed(2)}`;
}
