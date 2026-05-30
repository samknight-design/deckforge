# DeckForge

A mobile-first PWA for Magic: The Gathering players: scan paper cards with the
phone camera, build/track decks, get AI deck insights, and share with a
community. Built solo, deployed on Vercel.

## Stack

- **Next.js 14** (App Router) + React 18, JavaScript (no TypeScript)
- **Tailwind CSS** (plus a lot of inline `style={{}}` for one-off visuals)
- **Supabase** — auth (email/password, magic link, OAuth, anonymous) + Postgres
- **Anthropic SDK** (`claude-haiku-4-5` for vision, `claude-sonnet-4-5` for insights)
- **Scryfall API** — card data (prices, images, sets) — **partner**, proxied via `/api/scryfall/*`
- **Stripe** — subscriptions + one-off bolt-ons. ⚠️ Keys still placeholder, not live.
- Deployed on **Vercel** (team `hello-57720011's projects`, project `deckforge`).
  Stable prod URL: **deckforge-eta.vercel.app**. Pushes to `main` auto-deploy.

## Commands

```bash
npm run dev      # local dev
npm run build    # ALWAYS run before pushing — Vercel build failures are the main pain point
npm run lint
```

## Routing overview (`app/`)

- `app/(app)/` — authed routes behind a shared layout:
  - `home` (default landing — avatar/level header, featured decks, resources, plans, news)
  - `decks` (My Decks; view-mode toggle large/grid/list)
  - `decks/[id]` (deck view — Cards / Stats / Notes / **Insights** tabs)
  - `scan` (Scanner + "Add card" search + import shortcut)
  - `community` (browse public decks) + `community/[id]` (read-only view: like, export, clone, author link)
  - `u/[username]` (public profile)
  - `profile` (own profile — avatar, nickname, XP, achievements, tasks, store, **Settings**)
  - `rewards` (season-pass style level/credit track)
  - `rules` (collapsible MTG basics), `brackets`, `banlist` (in-app reference pages)
  - `about` (version + update history from `news_items`), `privacy`
- `app/welcome` + `app/login` — entry / auth (welcome is the first-visit landing)
- `app/api/scan` — POST image → Claude vision returns `{name, set_code, collector_number}` (JSON) →
  resolve EXACT printing via Scryfall (set/number → name+set → name fallback, with name-match
  validation) → cached in `card_cache` by `scryfall_id`. Captures the actual printing (art/set/price).
  Consumes a scan via `consumeScan()` and emits a `recordEvent('scan')`.
- `app/api/insights` — Claude-generated deck analysis (Sonnet). Returns **structured JSON** (`data`:
  bracket, power_level, cards_to_add/remove, strengths/weaknesses, summary/strategy), stored in
  `insights.data`, and stamps `decks.bracket`. Deletes prior insights for the deck on regen.
  `force:true` bypasses the 7-day hash cache. `InsightsSheet` renders a dashboard (greyed legacy
  fallback for `data === null`). Consumes an insight + emits `recordEvent('insight')`.
- `app/api/scryfall/*` — search/card/autocomplete/import (autocomplete/card/search use **Edge runtime**)
- `app/api/decks/like` / `clone` / `visibility` — like toggle (maintains `decks.like_count`),
  public-deck clone with free-tier cap, owner-only publish (awards publish XP).
- `app/api/stripe/*` — checkout, portal, webhook (placeholders).
- `middleware.js` — `protectedPaths` includes scan/decks/profile/home/community/u/rewards/rules/
  brackets/banlist/privacy/about. Routes anon into the app; bounces fully-authed users off welcome/login.

## Components & libs

- `lib/supabase/` — `createClient()` (browser & SSR cookie-based) and `createServiceClient()`
  (service-role, server-only).
- `lib/scryfall.js` — `normalizeCard`, `fetchCardByName/ById`, `fetchCardBySetAndNumber`,
  `fetchCardByNameAndSet`, `searchCards`, `fetchCardCollection`. All requests carry a real
  `User-Agent` and `Accept` header (Scryfall rejects requests without identifying headers).
- `lib/scryfall` HTTP responses are normalised into `card_cache` rows (one row per printing).
- `lib/usage.js` — `checkScanLimit` / `consumeScan` and `checkInsightLimit` / `consumeInsight`.
  Burns monthly quota first, then credits; failed scans don't consume.
- `lib/tiers.js` (client-safe) — single source of truth for `TIERS`, `BOLT_ONS`, `AVATARS`, XP curve,
  achievements catalogue, week/month period keys. `TASKS` here was the seed; runtime now reads the
  `challenges` table.
- `lib/gamification.js` (server) — `recordEvent(svc, userId, type, n)` returns a rewards summary
  (`{xp, leveledTo, achievements[], challenges[], scanCredits, insightCredits}`) consumed by
  `components/RewardToast.js`. `addCredits(svc, userId, kind, amount, reason)` for bolt-ons /
  admin grants.
- `lib/deckUtils.js` — stats, grouping, validation warnings, `parseDeckList` (handles
  Moxfield/Archidekt/MTGGoldfish exports), `exportDecklist`.
- `lib/brackets.js` — `BRACKET_COLORS` / `BRACKET_LABELS` / `normaliseBracket`. Shared by insights
  sheet, deck card, stats panel, public deck view.
- `lib/currency.js` — `formatPrice`, `formatCardPrice`, `formatEurTotal`, `symbolFor`,
  `CURRENCY_OPTIONS`. EUR/USD use Scryfall native prices; **GBP is approximated from EUR via a
  static rate** (constant in the file). Real-time FX is a TODO.
- `lib/prefs.js` — cookie-backed read/write for theme + currency; sets matching `data-*` attributes
  on `<html>`. Root layout (`app/layout.js`) reads the cookies on the server to avoid theme flash.
- `components/` — heavyweights:
  - `Scanner.js` (motion-stability + quick-scan, the most complex)
  - `DeckDetail.js` (tabs incl. inline Insights, public toggle, foil-aware totals)
  - `DeckListPage.js` (3 view modes), `DeckCard.js` (`compact` prop for grid)
  - `CardResultSheet.js` (foil toggle, deck picker), `CardModal.js` (foil toggle in deck context)
  - `InsightsSheet.js` (inline + sheet modes), `ImportDeckModal.js` (.txt upload + paste)
  - `HomePage.js`, `CommunityBrowse.js`, `PublicDeckView.js`, `PublicProfileView.js`
  - `ProfilePage.js`, `SettingsSection.js`, `Avatar.js`
  - `RewardToast.js` (`showReward`), `Toast.js` (`showToast`), `BottomNav.js`, `LikeButton.js`
  - `ResourceHeader.js`, `CommanderPanel.js`, `CardRow.js`, `StatsPanel.js`, `ManaBar.js`

## DB schema (Supabase project `ubqesvqnkjlfdmffnglx`, region eu-west-1, Postgres 17)

Tables (RLS notes in **bold**):
- `profiles` — `id` (= auth user), `email`, `username` (unique, case-insensitive), `avatar_key`,
  `tier` ∈ free|pro|legendary, `xp`, `scan_credits`, `insight_credits`, `lifetime_scans`,
  `lifetime_insights`, `likes_given`, `likes_received`, `decks_published`, `is_admin`,
  `currency` (GBP|USD|EUR, default GBP), `theme` (dark|light), `stripe_customer_id`,
  `stripe_subscription_id`, `subscription_ends_at`. **Own row only.**
- `decks` — owner via `user_id`; `bracket` (1–5, set by insights), `like_count` (denormalised),
  `is_public`, `share_token`, format, commander/partner, value, etc. **Own rows; public reads via
  policy "Public decks visible to all".**
- `deck_cards` — `(deck_id, scryfall_id, is_foil)` is the unique key (foils are separate lines).
  **Own cards; cards in public decks visible to all.**
- `card_cache` — Scryfall normalised rows keyed by `scryfall_id`. **Anyone authed can read.**
- `insights` — one current row per deck (regen deletes prior); `data` jsonb is the dashboard payload.
  **Own rows.**
- `usage` — monthly `(user_id, month_year)` row with `scan_count` + `insight_count`. **Own rows.**
- `deck_likes` — `(deck_id, user_id)` unique. **Owner-only; writes via service role.**
- `user_achievements`, `user_tasks` — gamification state. **Own reads; writes via service role.**
- `credit_ledger` — append-only audit (positive grants, negative consumes). **Own reads.**
- `challenges` — editable challenge catalogue (insert a row to add a monthly/weekly challenge).
  `metric` ∈ scan|insight|like_given|publish. **Public read.**
- `news_items` — editable homepage / about update feed (`kind` news|update, `published`, `sort`).
  **Public read.**

## Tiers / limits / economy

Single source of truth: `lib/tiers.js`.

| Tier | Price/mo | Yearly | Scans | Insights | Decks |
|---|---|---|---|---|---|
| Free | £0 | — | 50 | 2 | 1 |
| **Pro** | **£1.99** | £18.99 | 350 | 10 | ∞ |
| **Legendary** | **£6.99** | £64.99 | 1,500 | 30 | ∞ |

Bolt-ons (one-off, credits never expire): **+100 scans £1.99 · +300 scans £2.99 · +10 insights £3.99**.

- Pricing was reassessed alongside ManaBox (PRO ~£1.99). We can't match "unlimited scanning" at the
  same price because our scanning has a real per-call AI cost (~£0.0025 each) — quotas are bounded
  so every tier is worst-case profitable. **Differentiator is AI insights**, not raw scan volume.
- Insights are metered per tier (cached returns don't consume).
- Failed scans don't consume.

## Gamification

- XP: `scan +2`, `insight +5`, `like_given +1`, `like_received +3`, `clone_received +5`, publish via
  challenge/achievement only. No XP for liking/cloning your own decks.
- Level rewards (`levelRewards()` in `lib/tiers.js`): every level grants +20 scan credits; every
  5th level also grants +5 insight credits.
- **Reward popup (`components/RewardToast.js`)** appears only on level-up / achievement /
  challenge-complete — never per-action XP noise. APIs return a `rewards` object; clients pass it to
  `showReward()`.

## Editable content (no code, no deploy)

Two tables live in Supabase Table Editor:
- **`challenges`** — add a row (key, name, icon, period week|month, metric, target, xp, active,
  sort). The profile Challenges card and `recordEvent()` pick it up immediately.
- **`news_items`** — add a row (kind news|update, title, body, optional url, published, sort).
  Drives `/home` "What's new" and `/about` update history.

`profiles.is_admin` exists for a future in-app admin UI; not used yet.

## Scanner (`components/Scanner.js`) — the most complex component

Two modes:
- **Normal (default)**: pure manual "Tap to Scan" → `CardResultSheet` confirmation (with Foil toggle).
  Motion auto-fire is OFF.
- **Quick Scan (Pro+ only)**: motion auto-fire + auto-add to a pre-selected deck (no prompt), with a
  live session counter. Requires a real destination deck (creates one first if "New Deck" is selected).
  After each auto-add it waits for a motion event before re-arming.

Auto-scan (Quick Scan only) via frame-stability detection:
- 150ms `setInterval` samples an 80×60 centre crop, compares the R channel against the previous frame.
- ~300ms still (2 frames) → viewfinder green. ~600ms still (4 frames) → `doScan()` fires.
  `MOTION_THRESH=30` (higher = more hand-held wiggle). Portrait viewfinder guide.
- 1.5s cooldown after a failed scan; 0.9s after a Quick Scan auto-add. Gallery upload as fallback.
- Uses the **latest-callback-ref pattern** (`frameCheckCbRef`) so the interval calls a fresh closure
  without restarting; guards (`isScanningRef`, `inCooldownRef`, `hasResultRef`) are refs to avoid
  stale closures.

Scan accuracy: vision returns name + set code + collector number; resolution ladder is
`set+number` (validated against name) → `name+set` → `name`. Captures the actual printing —
full-art / set / basic-land variant — into `card_cache` (one row per printing).

## Preferences (theme + currency)

- Stored in cookies (`df_theme`, `df_currency`) **and** mirrored to `profiles.theme` /
  `profiles.currency` when signed in.
- `app/layout.js` reads cookies on the server and sets `<html data-theme=… data-currency=…>` so the
  initial paint matches the user's choice (no flash).
- Currency: EUR / USD use Scryfall native prices; **GBP is approximated from EUR with a static rate**
  (constant `EUR_TO_GBP` in `lib/currency.js`). Toggle in the Settings section.
- Theme: dark is the canonical look. **Light is a preview** (CSS variable overrides only) — most
  components still use hardcoded dark inline colours. Polishing light mode is on the punch-list.

## Env vars (set in Vercel + `.env.local`)

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
ANTHROPIC_API_KEY
NEXT_PUBLIC_SITE_URL
NEXT_PUBLIC_RATE_URL       # optional; populates "Rate the app" in Settings
STRIPE_SECRET_KEY          # placeholder
STRIPE_PRO_PRICE_ID        # placeholder
STRIPE_LEGENDARY_PRICE_ID  # TODO once Stripe is live
STRIPE_BOLTON_*            # TODO once Stripe is live
STRIPE_WEBHOOK_SECRET      # placeholder
```

## Conventions / gotchas

- **`useSearchParams()` must be wrapped in `<Suspense>`** or the Vercel build fails during static
  generation (bit us on `/login` — pattern: split inner component, wrap in default export).
- **Don't define components inside render** — define JSX as a variable or a module-level component,
  otherwise React remounts the subtree every render (bit us with `TopBar`).
- Supabase embedded joins (`select('card_cache(...)')`) **silently return null** without a real FK.
  We fetch separately and merge in JS for deck cards + insights.
- PWA: `manifest.json` `start_url` is `/home`; service worker is `public/sw.js` (currently `v3` —
  bump cache version `vN` to invalidate existing installs). Browsers cache `start_url` at install
  time — changing it needs the user to remove & re-add the home-screen shortcut.
- Scryfall HTTP calls **must send identifying headers** (real User-Agent + Accept); `lib/scryfall.js`
  does this — empty UAs are rejected.
- Commit messages: descriptive multi-line, `Co-Authored-By: Claude`. Commit in discrete chunks.
  Always run `npm run build` before pushing.

## Open punch-list (not yet done)

- [ ] **Stripe (the main blocker for revenue)**: wire real keys + create products/prices for Pro,
      Legendary and the three bolt-ons. Implement tier checkout + one-time bolt-on checkout, and a
      webhook that (a) sets `profiles.tier` on sub events and (b) calls `addCredits()` on bolt-on
      payment. **The single seam to fill is `handlePurchase()` in `components/ProfilePage.js`.**
      `UpgradeModal.js` also still shows old £3.99 copy.
- [ ] **Scanner overhaul (next planned chat)** — improve speed, accuracy, ergonomics; the user
      flagged "full scanner issues" as the next session's topic.
- [ ] **Light mode polish** — most components still use hardcoded dark inline colours; light is a
      preview only.
- [ ] **Live FX for GBP currency** (currently a static rate in `lib/currency.js`).
- [ ] **Community moderation** — public decks/likes have no reporting/abuse handling yet.
- [ ] **Google OAuth verification** + **CAPTCHA on anonymous sign-in** before wider launch.
- [ ] Scanner: gate auto-fire when no card is present (Quick Scan currently fires on any steady
      surface → harmless error toast + cooldown, no scan consumed).
- [ ] Import flow (`/api/scryfall/import`) doesn't yet support a fuzzy fallback for unmatched bare
      names without a set code.
