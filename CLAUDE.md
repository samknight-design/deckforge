# DeckForge

A mobile-first PWA for Magic: The Gathering players: scan paper cards with the
phone camera, build/track decks, and get AI deck insights. Built solo, deployed
on Vercel.

## Stack

- **Next.js 14** (App Router) + React 18, JavaScript (no TypeScript)
- **Tailwind CSS** (plus a lot of inline `style={{}}` for one-off visuals)
- **Supabase** — auth (email/password, magic link, OAuth, anonymous) + Postgres
- **Anthropic SDK** (`claude-haiku-4-5`) — card identification from photos + deck insights
- **Scryfall API** — card data (prices, types, images), proxied through `/api/scryfall/*`
- **Stripe** — Pro subscription (checkout/portal/webhook). ⚠️ Keys still placeholder, not live.
- Deployed on **Vercel** (team `hello-57720011's projects`, project `deckforge`).
  Stable prod URL: **deckforge-eta.vercel.app**. Pushes to `main` auto-deploy.

## Commands

```bash
npm run dev      # local dev
npm run build    # ALWAYS run before pushing — Vercel build failures are the main pain point
npm run lint
```

## Architecture

- `app/(app)/` — authed routes (decks, decks/[id], scan, profile) behind a shared layout
- `app/welcome` + `app/login` — entry / auth (welcome is the first-visit landing)
- `app/api/scan` — POST image → Claude vision returns card name → Scryfall lookup → cached in `card_cache`
- `app/api/scryfall/*` — search/card/autocomplete/import (autocomplete/card/search use **Edge runtime**)
- `app/api/insights` — Claude-generated deck analysis
- `app/api/stripe/*` — checkout, portal, webhook
- `middleware.js` — routes anon users into the app + /login for conversion; bounces fully-authed users off welcome/login
- `lib/supabase/` — `createClient()` (browser & SSR cookie-based) and `createServiceClient()` (service-role, server-only)
- `lib/scryfall.js` — `normalizeCard`, `fetchCardByName/ById`, `searchCards`, etc.
- `lib/usage.js` — `checkScanLimit` / `incrementScanCount` / insight equivalents
- `lib/deckUtils.js` — deck stats, type grouping, format/color-identity validation warnings
- `components/` — all UI. Big ones: `Scanner.js`, `DeckDetail.js`, `DeckListPage.js`,
  `CardResultSheet.js`, `InsightsSheet.js`, `ImportDeckModal.js`

## Tiers / limits

- **Free**: 1 deck, 25 scans/month. **Pro**: unlimited.
- Scan count is server-authoritative (`lib/usage.js`); the client also updates optimistically.
- Failed scans do NOT consume a scan count (only successful identifications increment).

## Scanner (`components/Scanner.js`) — the most complex component

Auto-scan via frame-stability detection:
- A 150ms `setInterval` samples an 80×60 centre crop into a tiny offscreen canvas
  and compares the R channel against the previous frame.
- ~450ms still (3 frames) → viewfinder turns green ("Hold still…").
- ~750ms still (5 frames) → `doScan()` fires automatically. `MOTION_THRESH=22`.
- 1.8s cooldown after a failed scan. Manual "Tap to Scan" + gallery upload remain as fallbacks.
- Uses the **latest-callback-ref pattern** (`frameCheckCbRef`) so the interval always
  calls a fresh closure without restarting — guards (`isScanningRef`, `inCooldownRef`,
  `hasResultRef`, etc.) are refs, not state, to stay synchronous and avoid stale closures.
- Tuning constants are at the top of the file.

## Env vars (set in Vercel + `.env.local`)

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
ANTHROPIC_API_KEY
NEXT_PUBLIC_SITE_URL
STRIPE_SECRET_KEY          # placeholder
STRIPE_PRO_PRICE_ID        # placeholder
STRIPE_WEBHOOK_SECRET      # placeholder
```

## Conventions / gotchas

- **`useSearchParams()` must be wrapped in `<Suspense>`** or the Vercel build fails
  during static generation (bit us on `/login` — pattern: split inner component, wrap in default export).
- **Don't define components inside render** — define JSX as a variable or a module-level
  component, otherwise React remounts the subtree every render (bit us with `TopBar`).
- Supabase embedded joins (`select('card_cache(...)')`) **silently return null** without a
  real FK. We fetch separately and merge in JS for deck cards + insights.
- PWA: `manifest.json` `start_url` is `/decks`; service worker is `public/sw.js` (bump cache
  version `vN` to invalidate existing installs). Browsers cache `start_url` at install time —
  changing it needs the user to remove & re-add the home-screen shortcut.
- Prices shown in EUR primarily, USD secondary.
- Commit messages: descriptive multi-line, `Co-Authored-By: Claude`. Commit in discrete chunks.

## Open punch-list (not yet done)

- [ ] **Stripe**: all keys are placeholders — wire up real keys + test checkout/webhook before launch
- [ ] **Google OAuth verification**: removes the "unverified app" warning on Google sign-in
- [ ] **CAPTCHA on anonymous sign-in**: recommended before wider launch to prevent abuse
- [ ] Scanner: consider gating auto-fire when no card is present (currently fires on any steady
      surface → harmless error toast + cooldown, no scan consumed)
