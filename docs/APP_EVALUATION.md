# DeckForge — Ultimate App Evaluation (June 2026)

> **Purpose:** Full-stack honest review before the next dev sprint. Measures the
> app against the five long-term priorities: (1) the ultimate MTG app, (2)
> ManaBox-beating scanner, (3) ultimate collection organiser, (4) Lotus-beating
> game tracker with QR join, (5) ultimate stats/insights.
> Everything below was verified against the codebase at review time.

---

## 0. Executive scorecard

| Pillar | Grade | One-line verdict |
| --- | --- | --- |
| Architecture for long-run iOS+Android | **B** | Right foundations (Expo/EAS, monorepo, shared/), four structural debts |
| Performance | **B−** | Scanner pipeline excellent by design; app shell unoptimised; dead weight shipping |
| Scanner vs ManaBox | **B+ design / D shippability** | v2 architecture validated, but **models are side-loaded onto the dev phone — a store install has a broken v2 scanner** |
| Game tracker vs Lotus | **C** | Solid core loop; missing ~10 table-stakes features incl. keep-awake and undo |
| Collection organiser | **C+** | Library + decks work; no import/export, no sideboards, no card↔deck cross-ref UI |
| Stats pillar | **D (by sequencing, not fault)** | Insights exist; game data layer unbuilt, so the flywheel isn't spinning yet |
| Store readiness | **D** | IAP, account deletion, crash reporting, iOS build — all unstarted |

---

## 1. Architecture — is this the right long-run iOS+Android foundation?

**Broadly yes.** The three big calls were correct:

- **Expo SDK 54 + EAS + React Native** — the only sane solo-dev path to both
  stores. Native modules (vision-camera, fast-tflite, onnxruntime) prove the
  escape hatch works when needed.
- **Monorepo with `shared/`** — tiers/brackets/currency logic is already
  write-once. Web shims keep the PWA alive for free.
- **Supabase direct-from-client + RLS** with the Vercel API only for
  AI/secrets — minimal server surface, cheap to run.

### Structural debts (ranked)

1. **Legacy RN Architecture** (`newArchEnabled: false`). RN is actively
   deprecating legacy arch (warning fires on every launch). The native-module
   ecosystem (vision-camera, worklets, reanimated) is now new-arch-first.
   Migrating is a *when not if*; every month waited raises the cost. Do it in a
   deliberate rebuild window with time to fix fallout.
2. **iOS has never been built.** Not once. vision-camera, fast-tflite (CoreML
   delegate), onnxruntime-react-native, ML Kit text recognition — all
   iOS-supported on paper, all unverified in this app. Apple dev account, EAS
   credentials, TestFlight flow: unstarted. This is the single biggest
   unknown-unknown reservoir in the project.
3. **Hand-rolled navigation** (`App.tsx` state machine). Fine at current scale
   and fast to work in — but it has no back-stack, no Android back-button
   handling, no state restoration, and deep-link routing (QR join!) will need
   to be wired manually. Verdict: keep it, but formalise a route-from-URL
   function when multiplayer join lands; migrate to React Navigation only if
   screen count doubles again.
4. **Session storage risk:** Supabase session in expo-secure-store already
   logs the >2048-byte warning; a future SDK *throws* instead. The official
   fix (AsyncStorage payload + SecureStore encryption key) needs the
   AsyncStorage native dep → batch into the rebuild.

Minor: CLAUDE.md says vision-camera v5; package.json has 4.7.3 (doc drift).
API auth: `authForRoute.js` (Bearer + cookie) covers `/api/scan`,
`/api/scan/resolve`, `/api/insights` — the routes mobile actually calls. A few
routes (decks/like, visibility, clone, scryfall/import) are still cookie-only,
but mobile does those via supabase-js directly, so nothing is currently broken.

---

## 2. Performance audit

**Scanner pipeline: genuinely well-engineered.** Frame-processor worklet,
camera-thread TFLite, resize-plugin for zero-snapshot pixel access, throttled
cadence, binary-packed hash DB with typed-array Hamming matching. This is the
right shape and it shows in the measured 8/8 result.

**App shell: unoptimised, in fixable ways.**

| Issue | Impact | Fix |
| --- | --- | --- |
| **~11 MB dead asset**: `assets/hashes/cards.idx` is required by nothing (only bin/ids/names bins are loaded) | +11 MB on every install & OTA update (~58% of the hash payload) | Delete it; regenerate only the bins |
| Tab switches unmount/remount screens → full refetch every visit | Wasted Supabase round-trips, visible loading flicker | Light client cache (TanStack Query, pure JS) or keep-mounted tabs |
| `card_cache` joins use `.in(ids)` with unbounded id lists | **Will break** for large libraries (URL length limits ≈ few hundred ids) — directly blocks "track entire collection" | Chunk to 100–150 ids per query, or an RPC |
| No `expo-image` | Jank + memory churn on long art-heavy lists | Add in rebuild (native dep) |
| Full library loaded then filtered in JS | Fine to ~2–3k rows, degrades beyond | Acceptable for now; revisit with pagination at scale |

**Board/tracker perf is fine** (8 seats, debounced persistence, native-driver
animations).

---

## 3. Scanner — the honest ManaBox comparison

### The critical finding

`embedScan.ts` loads `siglip.onnx` / `matcher.onnx` / `corner.onnx` from the
app's **device documents folder**, and `CameraView.tsx` loads `corner.tflite`
from a **hardcoded `/storage/emulated/0/...` Android path**. None of these
models are bundled or downloaded by the app — they were side-loaded onto the
dev phone.

**Consequences:** a store install has no v2 detector/recogniser (silently falls
back to whatever the legacy path does); iOS is impossible with those paths; and
this is invisible in dev because the dev phone has the files.

**Required: a model-shipping pipeline.** Either bundle (size-permitting) or a
first-run CDN download with versioned manifest, hash verification, progress UI
and retry. This is the #1 scanner priority — ahead of accuracy work.

### Size problem to solve with it

SigLIP2-B is ~190 MB fp16 / ~95 MB int8 — near or beyond bundling sanity and a
material download. Decisions needed: quantise (int8), or distill to a smaller
encoder, or accept a one-time large download. Similarly the embedding DB:
114k printings × 768-d fp16 ≈ 175 MB → must be PCA/quantised (128-d int8 ≈
~15 MB, on par with today's hash DB).

### Gap list to actual ManaBox parity

1. **Ship the models** (above).
2. **Printing identification.** ManaBox tells you *which printing* — art alone
   cannot separate same-art reprints. The dHash DB is already per-printing;
   the v2 path needs a tiebreaker for same-art sets (collector-number/set-symbol
   OCR of the bottom line is the pragmatic answer).
3. **Speed budget.** Define and measure: recognition < ~300 ms on mid-range
   Android, sustained 10+ cards/min without heat throttling.
4. **iOS parity** — untested end-to-end (CoreML delegate, ONNX runtime on iOS).
5. **DB freshness pipeline.** Hash/embedding builds are manual. New sets ship
   ~6×/year. Automate: scheduled build → versioned CDN manifest → in-app delta
   update (no app-store release per set). Also stop growing the git repo with
   19 MB binary asset commits (LFS or CDN).
6. **Foil handling** stays a manual toggle (ManaBox's auto-foil is unreliable
   too — don't chase it).
7. Scryfall client etiquette: add a proper `User-Agent`; respect 10 req/s.

**Verdict:** the recognition *architecture* (art-region fingerprint → OCR name
snap → AI last resort, moving to embeddings) is the right one and the v2
validation work already de-risked the hard ML question. What's missing is
*productisation*: shipping, size, printing disambiguation, automation, iOS.

---

## 4. Game tracker — Lotus gap matrix

Built and working: host flow, 2–8 seat layout system with per-count presets,
life ±1/±10, swipe-to-commander-damage (per-source, lethal auto-elim), poison/
energy/experience/custom counters, monarch/initiative/city's blessing tokens,
Scryfall art or colour backgrounds (commander auto-art), dice/coin/first-player,
elimination → placement → results, local resume, QR + pincode lobby (display
only).

### Missing vs Lotus (table stakes first)

| Gap | Why it matters | Cost |
| --- | --- | --- |
| **Screen keep-awake** | The screen sleeps mid-game — a dealbreaker for a table app. `expo-keep-awake` ships inside the `expo` package: it's a one-liner, no rebuild | Trivial |
| **Undo / life-change log** | The #1 tracker moment: "wait, what just happened?" Spec'd (ring buffer) but unbuilt | Small |
| **2HG shared team life** | Format is in the setup menu but seats are independent — currently a lie | Small |
| Day/Night global toggle | Common status; peers already exist | Trivial |
| Game timer (elapsed) | Lotus has it; cheap polish | Trivial |
| Saved player profiles (recurring friends) | Big retention + feeds guest-seat attribution in the stats vision | Medium |
| Game history screen | Spec'd; the visible payoff of playing games in-app | Medium |
| Life-delta aggregation animation (tap-tap-tap → "−3" floats) | The single most "premium feel" tracker detail | Small |
| Landscape/tablet layouts | Secondary; phones-flat-on-table is the core case | Later |

### Missing vs the *strategy* (bigger than Lotus parity)

- **Stat write-back** (`games`/`game_seats` tables + RLS) — designed in
  GAME_TRACKER.md, unbuilt. Without it the tracker earns nothing strategically.
- **Multiplayer QR join** (Realtime companion seats) — the differentiator;
  unbuilt. Note: Supabase Realtime is pure JS (no rebuild); QR *scanning* can
  reuse vision-camera (no rebuild); **deep links do need the rebuild** (assoc.
  domains) + the web `/j/[code]` landing route. Today the lobby QR encodes a
  URL that 404s if scanned with a system camera — ship the web route before
  anyone scans it in the wild.

---

## 5. Collection organiser — gaps to "ultimate"

1. **Import/export (CSV: ManaBox, Moxfield, Archidekt, Deckbox; text deck
   lists).** The adoption feature. Every serious user has a collection
   somewhere else; without import, switching cost kills you. With it (plus
   export, which builds trust), you drain competitors' moats. Scryfall's
   `/cards/collection` endpoint batch-resolves 75 identifiers/request.
2. **Sideboard/maybeboard** — `deck_cards` has no board column; competitive
   formats are misrepresented.
3. **Card ↔ deck cross-reference UI** ("this card is in Atraxa + Yawgmoth") —
   the data exists, the view doesn't. Core organiser value.
4. Collection value **history** (weekly snapshot table) — cheap, feeds insights.
5. Multiple printings/conditions/languages per card in `user_cards` (currently
   one row per scryfall_id with condition + foil counts).
6. **Offline scan queue** — scanning at an LGS with no signal should queue
   writes, not fail.
7. Set-completion view, want lists, trade lists — later-tier, but they're what
   "makes ManaBox redundant" ultimately means.
8. Verify `card_cache` price staleness strategy (when do prices refresh?).

---

## 6. Stats pillar — the dependency chain

Nothing here is technically hard; it's sequenced behind the tracker:

```
games/game_seats tables → host writes pod at game end
  → deck W/L + placement on DeckDetailScreen
  → profile lifetime stats
  → games data merged into the insights payload (Pro)
  → card-swap suggester (deck + library cross-ref fed to Claude, Pro)
  → opponent/meta view (commanders faced)
```

Bracket scoring already exists via insights. The swap suggester is the only new
AI surface — its unit economics (one Claude call per suggestion set) need the
same credit treatment as insights.

---

## 7. Blind spots — full sweep

**Store-submission blockers (currently unstarted):**
1. **IAP.** Apple/Google *mandate* native in-app purchase for digital subs —
   a Stripe checkout in the app is a rejection. RN4 must be RevenueCat (or
   expo-iap) with entitlement→`profiles.tier` sync; Stripe survives only on
   the web PWA. This changes the RN4 design assumption.
2. **Account deletion in-app** — Apple requirement for any app with accounts.
   Needs a service-role endpoint + full data cascade.
3. Privacy policy URL, Play data-safety form, App Store privacy nutrition
   labels, age rating.
4. **No crash reporting or analytics** (Sentry + PostHog/similar). Shipping to
   stores without them = flying blind. Sentry needs the rebuild.

**Engineering risk:**
5. **Zero tests.** Highest-value first targets: the dHash bit-math (the
   byte-identical-to-web contract is a silent-corruption risk), game reducer
   (elimination/placement edge cases), `shared/` functions, `authForRoute`.
   Plus a CI that runs `tsc` + web build on push (no CI exists at all).
6. Legacy-arch EOL + React 19/RN pinning debt (see §1).
7. SecureStore session-size time bomb (see §1).
8. `.in()` scale bug (see §2).
9. Supabase plan limits: Realtime concurrent connections + DB row caps —
   check before multiplayer beta.
10. Vercel/Anthropic spend: `usage` table tracks scans/insights, but no alerting.

**Product/positioning:**
11. Deck *text* import (paste a Moxfield list) is missing — cheapest
    deck-building win that exists.
12. The lobby QR resolves to a dead URL until `web/app/j/[code]` ships.
13. Web PWA scope ambiguity: it's "maintenance mode" but the strategy needs it
    for deep-link landing, account deletion, and marketing/SEO. Define the
    minimal web surface deliberately.
14. Doc drift: CLAUDE.md vision-camera version, phase list vs reality.

---

## 8. Recommended sequencing (the springboard)

**Phase A — Make what exists shippable (do first, ~everything else depends on it)**
1. Model-shipping pipeline (bundle-or-download + manifest versioning) + delete
   dead `cards.idx` + embedding quantisation decision.
2. **The Big Rebuild** — one deliberate EAS dev-client build batching every
   native need: new-arch attempt (or explicit deferral), expo-navigation-bar
   (immersive nav for the tracker), AsyncStorage (session fix), expo-image,
   Sentry, RevenueCat, keep-awake wiring, QR-scan config, associated domains
   for deep links. Builds are the bottleneck resource — never spend one on a
   single feature.
3. **First iOS build + TestFlight smoke test** — start now, in parallel; it
   surfaces the unknown-unknowns while they're cheap.

**Phase B — Tracker completion + the stats foundation**
Keep-awake, undo/log, 2HG, day/night, timer, delta animations, game history,
saved players — then `games`/`game_seats` write-back and deck/profile records.

**Phase C — Multiplayer join**
Web `/j/[code]` + AASA/assetlinks, Realtime companion seats, QR scanning,
host-approval lobby. (The moat feature; it needs B's tables.)

**Phase D — Collection moat**
CSV import/export, deck text import, sideboards, card↔deck cross-ref,
`.in()` chunking + query cache.

**Phase E — Stats & monetisation**
Insights×games integration, swap suggester, RevenueCat Pro launch.

**Phase F — Store checklist**
Account deletion, privacy docs, analytics verification, store listings.

The through-line: **A unblocks everything, B–C build the ecosystem lock-in
(games + stats are the reason to be in DeckForge), D drains competitors'
moats, E monetises what B–D created.**
