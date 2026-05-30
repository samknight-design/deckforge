// Client preference helpers (theme + currency).
// Persistence: cookie (so the server layout can read it on the next request,
// avoiding a flash of the wrong theme) + a data attribute on <html> so CSS can
// react immediately without a re-render.

import { DEFAULT_CURRENCY } from './currency';

export const DEFAULT_THEME = 'dark';

export function readCookie(name) {
  if (typeof document === 'undefined') return null;
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : null;
}

function writeCookie(name, value) {
  if (typeof document === 'undefined') return;
  const oneYear = 365 * 24 * 60 * 60;
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${oneYear}; samesite=lax`;
}

export function getTheme() {
  return readCookie('df_theme') || DEFAULT_THEME;
}
export function getCurrency() {
  return readCookie('df_currency') || DEFAULT_CURRENCY;
}

export function setTheme(theme) {
  writeCookie('df_theme', theme);
  if (typeof document !== 'undefined') document.documentElement.setAttribute('data-theme', theme);
}
export function setCurrency(currency) {
  writeCookie('df_currency', currency);
  if (typeof document !== 'undefined') document.documentElement.setAttribute('data-currency', currency);
}
