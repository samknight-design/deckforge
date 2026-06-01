import './globals.css';
import { cookies } from 'next/headers';

export const metadata = {
  title: 'DeckForge',
  description: 'Magic: The Gathering companion — scan cards, build decks, get AI insights',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'DeckForge',
  },
};

export const viewport = {
  themeColor: '#f59e0b',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }) {
  // Read prefs from cookies on the server so the initial HTML matches the
  // user's saved choice — avoids a flash of dark when switching to light.
  const ck = cookies();
  const theme = ck.get('df_theme')?.value || 'dark';
  const currency = ck.get('df_currency')?.value || 'GBP';
  return (
    <html lang="en" data-theme={theme} data-currency={currency}>
      <head>
        <link rel="apple-touch-icon" href="/icons/icon.svg" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="theme-color" content="#f59e0b" />
      </head>
      <body className="bg-bg-primary text-text-primary">
        {children}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if ('serviceWorker' in navigator) {
                window.addEventListener('load', function() {
                  navigator.serviceWorker.register('/sw.js').catch(function(err) {
                    console.log('SW registration failed:', err);
                  });
                });
              }
              // Mobile DevTools shim — opt-in via ?debug=1 in the URL.
              // Loads Eruda from a CDN, mounts the on-screen console drawer,
              // and persists across navigation in the same session.
              (function() {
                try {
                  var url = new URL(window.location.href);
                  var want = url.searchParams.get('debug') === '1';
                  if (want) sessionStorage.setItem('df_debug', '1');
                  if (sessionStorage.getItem('df_debug') === '1') {
                    window.__df_dbgWarp = true; // enable Hough debug logging
                    var s = document.createElement('script');
                    s.src = 'https://cdn.jsdelivr.net/npm/eruda';
                    s.onload = function() { try { window.eruda && window.eruda.init(); } catch (e) {} };
                    document.head.appendChild(s);
                  }
                } catch (e) {}
              })();
            `,
          }}
        />
      </body>
    </html>
  );
}
