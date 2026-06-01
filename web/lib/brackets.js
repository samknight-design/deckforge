// Shared MTG "bracket" tier scale (1-5), used by the insights dashboard, deck
// cards, stats panel and the public/community views so the labels and colours
// stay consistent everywhere. Index 0 is unused (brackets are 1-5).
export const BRACKET_COLORS = ['', '#10b981', '#22c55e', '#f59e0b', '#ef4444', '#7c3aed'];
export const BRACKET_LABELS = ['', 'Casual', 'Focused Casual', 'Optimised', 'High Power', 'cEDH'];

// Clamp/validate an arbitrary value to a 1-5 bracket, or null if not set.
export function normaliseBracket(value) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1 || n > 5) return null;
  return n;
}

export function bracketLabel(bracket) {
  return BRACKET_LABELS[bracket] || '';
}

export function bracketColor(bracket) {
  return BRACKET_COLORS[bracket] || '#64748b';
}
