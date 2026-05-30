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
            `,
          }}
        />
      </body>
    </html>
  );
}
