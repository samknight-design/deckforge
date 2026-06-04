# DeckForge

An MTG companion app — scan paper cards with the phone camera, build/track
decks, get AI deck insights, share with a community. Solo developer.

## Repository shape

This is a **monorepo with three npm workspaces**:

```
DeckForge/
├── web/      — Next.js 14 App Router PWA. Vercel-deployed.
│              All API routes live here. Maintenance mode (no new features);
│              hits the same Supabase + Anthropic + Stripe as mobile.
├── mobile/   — Expo SDK 54 React Native app (TypeScript). EAS-built,
│              shipped to App Store + Play Store. This is the primary
│              experience going forward.
└── shared/   — Pure-JS modules consumed by both web and mobile.
               No DOM, no Next, no React Native APIs.
```

Root `package.json` declares the workspaces; root `vercel.json` keeps the
Vercel deploy building from `web/`. **Always `cd` into the right workspace
before running commands** — running `npx expo start` from the repo root
fails because Expo can't find `mobile/`'s `package.json`.

## Quick command map

```bash
# From repo root:
npm run build          # web Vercel build (delegates to web workspace)
npm run dev            # web local Next dev server

# From mobile/:
npx expo start --dev-client   # connect to the EAS dev-client APK on phone
npx expo start                # connect to stock Expo Go (limited — no native modules)
eas build --profile development --platform android   # cloud-build a new dev client APK

# From repo root or web/:
node web/scripts/build-full-hashes.mjs    # H1 — produce the bundled hash DB for mobile
```

## Project history (why things are the way they are)

DeckForge began as a PWA. The scanner used Claude Haiku vision for every
scan (~£0.0025 each) which made free unlimited scanning impossible. After
multiple failed attempts at a browser-side replacement (Tesseract OCR with
stylised MTG titles, OpenCV.js that froze the user's phone, perceptual
hashing that worked but couldn't handle perspective/alignment cleanly in
a browser), the call was made to ship as a real native app on App Store +
Play Store. **React Native + Expo** chosen over Capacitor (avoids Apple's
"thin wrapper" review risk) and over full Swift + Compose (cost of writing
every screen twice for a solo dev). The PWA continues to exist for desktop
users; mobile is where new work lands.

## Stack

**Web** (`web/`):
- Next.js 14 (App Router), React 18.3, JavaScript (no TS in `web/`)
- Tailwind CSS + inline styles
- `@supabase/ssr` for cookie-based auth, `@anthropic-ai/sdk` for Claude
  vision (Smart Scan fallback) + Sonnet (deck insights), Stripe (placeholder
  keys), Scryfall (proxied via `/api/scryfall/*`)
- Deployed to **deckforge-eta.vercel.app** — pushes to `main` auto-deploy.

**Mobile** (`mobile/`):
- Expo SDK 54 (pinned — newer SDKs unavailable in store Expo Go), React
  19.1, TypeScript
- React Native 0.81, `@supabase/supabase-js` with **expo-secure-store**
  as the session storage adapter (Keychain on iOS / EncryptedSharedPrefs
  on Android)
- `react-native-vision-camera` v5 for the camera (needs the dev client —
  doesn't work in stock Expo Go)
- `expo-web-browser` + `expo-auth-session` for Google OAuth (SFAuthSession
  / Custom Tabs)
- Calls `web/`'s API routes on Vercel for everything server-side
- EAS Build → App Store + Play Store. Project owner: **arcaneflame**.
  EAS project ID in `mobile/app.json`.

**Shared** (`shared/`):
- Pure JS modules: `tiers.js`, `brackets.js`, `currency.js`, `deckUtils.js`
- Imported as `@deckforge/shared/<name>` via subpath exports
- Web re-exports via thin shims at `web/lib/{name}.js` so old `@/lib/*`
  imports keep working

## Hash database (H1)

Mobile scans visually match against a precomputed perceptual-hash database
of every Scryfall printing (~114k cards at last count, growing).

- **Build script**: `web/scripts/build-full-hashes.mjs` — streams the 540 MB
  Scryfall bulk file via `stream-json` (Node's max-string-length blocks the
  naive `res.json()` approach). Fetches each card's `small` image, computes
  a 256-bit dHash (16×16 grid, byte-identical math to the legacy PWA
  matcher in `web/lib/cardMatch.js`), writes the result to:
  ```
  mobile/assets/hashes/cards.bin       (~3.5 MB packed binary)
  mobile/assets/hashes/cards.idx.json  (id+name+set+cn lookup)
  mobile/assets/hashes/cards.meta.json (version + builtAt + count)
  ```
- Hash file ships bundled with the Expo app via the standard `assets/`
  pipeline — no network download required at scan time.
- Run periodically (whenever new MTG sets release) and commit the new files.

## Phase progression

Roughly tracked in `~/.claude/plans/i-need-to-tackle-ethereal-book.md`:

- ✅ **RN0** — monorepo restructure, shared/ extraction, Expo scaffolding
- ✅ **RN1** — Supabase auth in mobile with SecureStore + Google OAuth
- 🟡 **RN2** — native scanner (in progress)
  - ✅ RN2a — scan screen scaffolding + vision-camera installed
  - 🟡 RN2b — EAS dev-client build in queue
  - ⏳ RN2c — first scan flow (Claude Smart Scan via /api/scan)
  - ⏳ RN2d — frame processor plugin (iOS Vision / Android ML Kit, custom
    Swift + Kotlin native module) + local dHash matching
  - ⏳ RN2e — wire to deck flow
- 🟡 **H1** — full hash DB build (~37 min, runs in parallel with RN2b)
- ⏳ **RN3** — Decks list, deck detail, add-card flow (port from web)
- ⏳ **RN4** — IAP for Pro tier subscription + insights bolt-on
- ⏳ **RN5** — App Store + Play Store submission

## Database (Supabase, project `ubqesvqnkjlfdmffnglx`, region eu-west-1)

Schema and RLS are unchanged from the original PWA. Authoritative table list:

- `profiles` (one per auth user, own row only) — username, avatar, tier,
  xp, scan_credits, insight_credits, lifetime_*, like counts, stripe_*
- `decks` — owner via `user_id`; `bracket`, `like_count`, `is_public`,
  `share_token`, format, commander/partner, value. Public decks readable
  by all via RLS.
- `deck_cards` — `(deck_id, scryfall_id, is_foil)` unique. Foils are
  separate lines from non-foils.
- `card_cache` — normalised Scryfall rows keyed by `scryfall_id`.
- `insights` — one current row per deck (regen deletes prior); `data` jsonb
  is the dashboard payload.
- `usage` — monthly `(user_id, month_year)` row with `scan_count` +
  `insight_count`.
- `deck_likes`, `user_achievements`, `user_tasks`, `credit_ledger`,
  `challenges`, `news_items`.

Mobile uses `@supabase/supabase-js` with an `expo-secure-store` storage
adapter (cookies don't persist in a WebView). Web uses `@supabase/ssr`
with cookies. Both authenticate against the same project.

## Server-side API auth

Mobile authenticates against `/api/*` by sending the Supabase session JWT
as a `Bearer` header. **The existing API routes still use cookies-based
auth** (`createClient` from `web/lib/supabase/server.js`) — they will need
to ALSO accept Bearer tokens before mobile can call any of them
successfully. This is a known follow-up (currently logged in mobile's
`lib/api.ts` as the wrapper's contract).

## Tier / economy

Single source of truth: `shared/tiers.js`. Currently still the legacy
free/pro/legendary set; will be reshaped to a single Pro tier (£3.99/mo,
15 insights, ad-free, unlimited scans) + one insight bolt-on as part of
Phase RN4. Web will pick up the change automatically via the shim.

## Conventions / gotchas

- **Build mode matters**: `mobile/` cannot run in stock Expo Go once
  vision-camera or any other native module is in use. Use `npx expo start
  --dev-client` after the user installs the EAS-built dev client APK.
- **Vision-camera Expo plugin currently disabled** in `mobile/app.json` —
  the v5 plugin entry made `npx expo config` exit non-zero with a silent
  PowerShell stderr swallow. Restore it later if we need its prebuild-side
  permission strings; the runtime camera permission flow works without it.
- **Camera permission text** — currently the system default. To customise,
  re-add the vision-camera plugin once we figure out the SDK 54 mismatch,
  OR set `ios.infoPlist.NSCameraUsageDescription` and
  `android.permissions` directly in `app.json`.
- **Workspace symlinks**: `npm install` at root sets up
  `node_modules/@deckforge/{shared,mobile}` as symlinks. Web and mobile
  use different React versions (18 / 19); React 18 is pinned in the root
  `package.json` dependencies to keep the hoist correct — without that
  pin, mobile's React 19 wins the hoist and Next.js's prerender crashes
  with "Cannot read properties of null (reading 'useContext')".
- **CRLF**: Windows line endings get normalised by git on commit. The
  `LF will be replaced by CRLF` warnings during `git add` are expected
  and harmless.
- **`web/.env.local`** and **`mobile/.env.local`** are separate files with
  separate variable names (`NEXT_PUBLIC_*` vs `EXPO_PUBLIC_*`). The values
  for the Supabase URL + anon key are identical between the two; the env
  prefix differs because each toolchain only inlines its own prefix.
- **Always commit AND push to `main`**: Vercel deploys from `main`, so
  any change must reach GitHub before it's testable.

## Env vars (web/.env.local + Vercel)

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
ANTHROPIC_API_KEY
NEXT_PUBLIC_SITE_URL
NEXT_PUBLIC_RATE_URL       # optional; populates "Rate the app" in Settings
STRIPE_SECRET_KEY          # placeholder
STRIPE_PRO_PRICE_ID        # placeholder
STRIPE_WEBHOOK_SECRET      # placeholder
```

## Env vars (mobile/.env.local)

```
EXPO_PUBLIC_SUPABASE_URL
EXPO_PUBLIC_SUPABASE_ANON_KEY
```

Plus the EAS project's environment variables panel (Production / Preview
/ Development) should mirror the same two — required for cloud builds to
inline them.
