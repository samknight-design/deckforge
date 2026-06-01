/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow Next.js to transpile our monorepo workspace package. Without this,
  // Node 14+ ESM packages imported from a workspace sibling can hit
  // "Cannot use import statement outside a module" during webpack analysis.
  transpilePackages: ['@deckforge/shared'],
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
};

module.exports = nextConfig;
