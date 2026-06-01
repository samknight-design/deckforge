/** @type {import('next').NextConfig} */
//
// Two build modes:
//   • Default — Vercel SSR build. Pages can use server components, API routes
//     run as serverless functions. Used for deckforge-eta.vercel.app and CI.
//   • NATIVE_BUILD=1 — Static export. All pages must be client components
//     (server features like cookies() / dynamic data fetch don't run). The
//     resulting `out/` directory bundles into the Capacitor native app, which
//     then calls the SAME API routes (still hosted on Vercel) over HTTPS.
//
// To toggle locally: `NATIVE_BUILD=1 npm run build` (or use the
// `native:build` script in package.json which sets it for you).
const isNative = process.env.NATIVE_BUILD === '1';

const nextConfig = {
  ...(isNative && {
    output: 'export',
    distDir: 'out',
    trailingSlash: true,           // capacitor-friendly: each route → /route/index.html
    images: { unoptimized: true }, // next/image's default loader needs the runtime — disable for static export
  }),
  ...(!isNative && {
    images: {
      remotePatterns: [
        { protocol: 'https', hostname: 'cards.scryfall.io' },
        { protocol: 'https', hostname: 'svgs.scryfall.io' },
        { protocol: 'https', hostname: 'card.scryfall.io' },
      ],
    },
    async headers() {
      return [
        {
          source: '/sw.js',
          headers: [
            { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
            { key: 'Content-Type', value: 'application/javascript' },
          ],
        },
        {
          source: '/manifest.json',
          headers: [
            { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
            { key: 'Content-Type', value: 'application/manifest+json' },
          ],
        },
      ];
    },
  }),
};

module.exports = nextConfig;
