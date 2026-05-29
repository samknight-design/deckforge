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

- `app/(app)/` — authed routes (home, decks, decks/[id], scan, profile, community, community/[id]) behind a shared layout. `/home` is the default landing tab.
- `app/welcome` + `app/login` — entry / auth (welcome is the first-visit landing)
- `app/api/scan` — POST image → Claude vision returns `{name, set_code, collector_number}` (JSON) →
  resolve EXACT printing via Scryfall (set/number → name+set → name fallback, with name-match
  validation) → cached in `card_cache` by `scryfall_id`. Captures the actual printing (art/set/price)
- `app/api/scryfall/*` — search/card/autocomplete/import (autocomplete/card/search use **Edge runtime**)
- `app/api/insights` — Claude-generated deck analysis. Returns **structured JSON** (`data`: bracket,
  power_level, cards_to_add/remove, strengths/weaknesses, summary/strategy), stored in `insights.data`,
  and stamps `decks.bracket`. `InsightsSheet` renders a dashboard (falls back to markdown for legacy rows).
- `app/api/decks/like` + `app/api/decks/clone` — toggle a like (maintains `decks.like_count`) / clone a
  public deck into your account (free-tier cap enforced). Both use the service client.
- **Community**: `/community` (browse public decks) + `/community/[id]` (read-only view: like, export
  decklist, clone). Public reads use `createServiceClient()` with explicit `is_public=true` filters; the
  DB also has "Public decks visible to all" RLS as a backstop. `deck_likes` table holds per-user likes.
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

Two modes:
- **Normal (default)**: pure manual "Tap to Scan" → `CardResultSheet` confirmation
  (which has a Foil toggle). Motion auto-fire is OFF here.
- **Quick Scan (Pro only)**: a toggle that turns on motion auto-fire and auto-adds each
  scanned card to the pre-selected deck with no prompt, with a live session counter.
  Requires a real destination deck (creates one first if "New Deck" is selected).
  After each auto-add it waits for the card to be swapped out (a motion event) before re-arming.

Auto-scan (Quick Scan only) via frame-stability detection:
- A 150ms `setInterval` samples an 80×60 centre crop into a tiny offscreen canvas
  and compares the R channel against the previous frame.
- ~300ms still (2 frames) → viewfinder turns green. ~600ms still (4 frames) → `doScan()` fires.
- `MOTION_THRESH=30` (higher = more hand-held wiggle room). Portrait viewfinder guide.
- 1.5s cooldown after a failed scan. Gallery upload remains as a fallback.
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
- PWA: `manifest.json` `start_url` is `/home`; service worker is `public/sw.js` (currently `v3` — bump
  cache version `vN` to invalidate existing installs). Browsers cache `start_url` at install time —
  changing it needs the user to remove & re-add the home-screen shortcut.
- Prices shown in EUR primarily, USD secondary.
- Commit messages: descriptive multi-line, `Co-Authored-By: Claude`. Commit in discrete chunks.

## Open punch-list (not yet done)

- [ ] **Stripe**: all keys are placeholders — wire up real keys + test checkout/webhook before launch
- [ ] **Google OAuth verification**: removes the "unverified app" warning on Google sign-in
- [ ] **CAPTCHA on anonymous sign-in**: recommended before wider launch to prevent abuse
- [ ] Scanner: consider gating auto-fire when no card is present (Quick Scan currently fires on any
      steady surface → harmless error toast + cooldown, no scan consumed)
- [ ] `deck_cards.is_foil` (boolean, default false) added for the manual foil toggle. Import flow
      (`/api/scryfall/import`) still adds non-foil only.
- [ ] **Community moderation**: public decks/likes have no reporting/abuse handling yet — add before
      wider launch. Brackets (`decks.bracket`), likes (`deck_likes`, `decks.like_count`) and
      `insights.data` were added 2026-05-29.
