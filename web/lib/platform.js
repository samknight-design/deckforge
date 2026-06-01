// Tiny platform-aware helpers — used by both PWA (browser) and native (Capacitor
// WebView). Keep this file dependency-free so it works in every entry point.

// True when running inside a Capacitor native shell (iOS / Android). False in
// regular browsers (PWA). We detect via the global Capacitor object that the
// runtime injects; safe on the server (returns false).
export function isNative() {
  if (typeof window === 'undefined') return false;
  return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
}

// Base URL for `/api/*` calls. PWA → relative (same origin). Native → absolute
// URL of the Vercel deployment, since the WebView's origin is capacitor://localhost
// which obviously has no /api routes.
//
// Override with NEXT_PUBLIC_API_BASE if you want to point native builds at a
// staging Vercel preview.
export function apiBase() {
  if (!isNative()) return '';
  return process.env.NEXT_PUBLIC_API_BASE || 'https://deckforge-eta.vercel.app';
}

// Wrap `fetch` to prepend apiBase() for any /api/* URL. Use this everywhere
// instead of bare fetch when calling our own server. Headers/options pass
// through unchanged.
export function apiFetch(path, init) {
  const url = path.startsWith('/api/') ? apiBase() + path : path;
  return fetch(url, init);
}
