# DeckForge Game Tracker — Architecture & Build Spec

> **Purpose:** Authoritative, self-contained spec for the **Play MTG** game
> tracker — a Lotus-style life/score tracker with a QR "join game" feature that
> attaches players' profiles and decks so wins/losses are recorded. Written so an
> AI or human with no prior context can build it. If the feature needs to be
> re-derived, **start here.**
>
> Status: **spec / not yet built.** Target phase: **RN6** (after RN3 decks port).
> Written June 2026 from a requirements interview with the solo dev.

---

## 1. The one-paragraph summary

One phone — the **host** — runs an entire game by itself: every seat's life,
commander damage, counters and status live on it, and the host can change any
seat. Other players are **optional**. A player only scans the lobby **QR code (or
types the short code)** if they want to attach their DeckForge profile + a chosen
deck, so the result is recorded to *their* deck's stats. Once joined, a player's
phone is a companion that drives **only their own seat**, mirroring the host.
Nothing is multiplayer-fragile: the host is always the source of truth, the
network only matters when someone actually joins, and the live game is held on
the host (persisted locally so it survives an app reopen). Only the **final
result** is written to Supabase.

---

## 2. Locked product decisions (from the interview)

| Decision | Outcome |
| --- | --- |
| Device model | **Host phone is authoritative & self-sufficient.** Companion phones are optional, opt-in via QR/code, and drive only their own seat. |
| Who can join | Anyone scans to attach profile+deck. **Host can also tag a seat** with a known player. Guests with no account simply fill a seat (still counted in placement). |
| Result model | **Win + placement.** Placement is captured by **elimination order** (one tap per death), not turn tracking. |
| Rich mode (turn counts, who-damaged-who) | **Deferred** to a future opt-in "deep stats" mode. Not in v1. |
| Formats at launch | **Commander/EDH, Standard 1v1, Two-Headed Giant, Custom life.** |
| Commander damage | Ships with Commander format; per-seat drawer, 21 = lethal. |
| Counters | Poison/infect, energy/experience, status toggles (Monarch / Initiative / Day-Night / City's Blessing), generic custom counter — **all behind a tidy drawer**, never on the default life view. |
| Table size | **2–8 seats.** Rotating quadrant-style layouts to ~6; **auto-switch to a compact list layout at 7–8.** |
| Host failover | **Lotus-style:** active game persisted **locally** on host (resume on reopen). Only the **final result** is written to Supabase. No live cloud sync of in-progress state. |
| Results surface | (1) per-deck W/L + placement record + game **history**; (2) feeds **AI insights** (Pro tie-in); (3) **profile** lifetime aggregates; (4) **opponent/meta** capture. |
| Monetisation | **Live tracker + basic deck W/L = free** (competes with Lotus). **Game-fed AI insights = Pro.** |
| Table tools | First-player randomiser + dice/coin in a tools menu. |
| Platform | **Mobile only.** Web (maintenance mode) gets exactly one new route: the deep-link join landing page. |

---

## 3. Core architectural insights (the non-obvious parts)

1. **Host-authoritative, companions send intents.** The host holds the canonical
   game state and is the reducer. A companion never mutates shared truth directly —
   it sends an *intent* ("life −1 on my seat"), the host applies it and re-broadcasts
   the authoritative result. Companions render from host broadcasts, with an
   **optimistic local echo** of their own taps for zero-latency feel. This makes
   divergence structurally impossible.

2. **Realtime Broadcast, not Postgres-changes.** Live taps fly over a Supabase
   **Realtime Broadcast** channel (`game:{code}`) — ephemeral, low-latency, nothing
   persisted. This aligns exactly with "only write the result at the end." Postgres
   is touched **once**, at game end. **Presence** on the same channel drives the
   ready/connected dots.

3. **Life changes are deltas, never absolutes.** Two people tapping the same seat
   at once must both count. Every life/counter/commander-damage event carries a
   **delta** (`+1` / `−1`), applied to host state; the host broadcasts the resulting
   absolute total for display reconciliation.

4. **Placement falls out of elimination, not turn tracking.** As each player dies,
   someone taps **Eliminate** on that seat. Elimination *order* = placement
   (first out = last place; last standing = winner). This gives full multiplayer
   placement data with **one tap per death** and zero ongoing friction — the reason
   "win + placement" doesn't require the deferred rich mode.

5. **The host writes everyone's result, including companions'.** Because joined
   companions hand the host their `profile_id` + `deck_id` at join time, the host
   writes the *entire* pod (all seats) to Supabase at game end. Each player later
   reads their own seat rows via RLS. One writer, no client coordination.

---

## 4. User journeys

### 4.1 Host a game

```
Play MTG tab
  → Host or Join chooser
  → HOST:
      Game setup
        • format (Commander / Standard 1v1 / 2HG / Custom)
        • player count (2–8)        → derives seat layout
        • starting life (auto from format; editable for Custom)
        • options (commander-dmg threshold, time/turn limit = off by default)
      → pick YOUR deck (DeckPickerSheet, existing component)
      → "Start" → LOBBY
        • QR code (encodes deckforge://join/{code} as a universal link)
        • short manual code below it
        • seat list with ready / not-ready dots (Presence-driven)
        • host can tag empty seats with a known player name
        • host approves incoming join requests
      → when all seats ready → "Start game" → LIVE BOARD
      → game ends (manual "End game" or one survivor) → RESULTS
        • winner + finishing order (from elimination order)
        • writes pod to Supabase; updates deck/profile stats
        • "Rematch" keeps the pod & layout
```

### 4.2 Join a game

```
Scan QR (system camera → deep link, or in-app Join screen) / type code
  → Join setup
      • pick your deck (DeckPickerSheet)
      • background: defaults to your commander art; pick any Scryfall card or a colour
      • display name (defaults to profile username)
  → "Mark ready" → wait in lobby
  → host starts → COMPANION BOARD (your seat large; optional table glance)
```

A **non-user** who scans the QR with their system camera hits the universal link,
which (app not installed) lands on the web join page → App/Play Store. See §10.

---

## 5. Screens & navigation integration

The mobile app uses a **hand-rolled state-machine navigator** in
[mobile/App.tsx](mobile/App.tsx) (not React Navigation): a `Screen` union + a
bottom `TabBar` with `home | library | decks | profile` and a center scan button.

**Integration plan:**

- Add a **`play` tab** (or repurpose the layout to surface a "Play MTG" entry).
  Recommended: keep the four tabs, and make the center action a **two-purpose**
  button is risky — instead add `play` as a fifth destination reachable from Home
  and from a small tab. Decision for build time; the spec assumes a `play` entry
  point that routes into the chooser.
- New `Screen` variants:
  ```ts
  | { id: 'playHome' }                              // host/join chooser
  | { id: 'gameSetup'; mode: GameMode }             // host config
  | { id: 'gameLobby'; gameId: string; role: 'host' | 'guest' }
  | { id: 'gameBoard'; gameId: string; role: 'host' | 'guest' }
  | { id: 'gameResults'; gameId: string }
  | { id: 'gameJoin'; code?: string }               // entered via deep link
  | { id: 'gameHistory' }                           // past games list
  ```
- The live board and lobby **hide the tab bar** (like `deckDetail` / `scan` today)
  and own their back navigation. The board should call `expo-keep-awake` to keep
  the screen on during play.
- **Orientation:** the app is locked `portrait` in app.json. The live board needs
  to **rotate individual seat panels in-canvas** (CSS-style `transform: rotate`),
  NOT rotate the device — so we keep the portrait lock and rotate per-seat. (A
  future "landscape table" mode could unlock orientation for the board only.)

---

## 6. Realtime model

**Channel:** `game:{code}` (Supabase Realtime, `{ config: { broadcast: { self: false }, presence: { key: seatId } } }`).

**Roles:** the host subscribes as authority; companions subscribe as their seat.

**Presence** payload → lobby/board connection + ready state:
```ts
{ seatId, profileId, displayName, connected: true, ready: boolean }
```

**Broadcast events** (intent → host → authoritative echo):

| event | sender | payload | host action |
| --- | --- | --- | --- |
| `request_join` | guest | `{ profileId, deckId, displayName, commanderName, bgImageUrl }` | create/assign seat, broadcast `seat_assigned` |
| `ready` | guest | `{ seatId, ready }` | update lobby, re-broadcast state |
| `life_delta` | any | `{ seatId, delta }` | apply, broadcast `seat_patch` |
| `cmddmg_delta` | any | `{ seatId, fromSeatId, delta }` | apply, broadcast `seat_patch` |
| `counter_delta` | any | `{ seatId, counter, delta }` | apply, broadcast `seat_patch` |
| `status_toggle` | any | `{ seatId, status, value }` | apply (e.g. monarch is exclusive), broadcast |
| `seat_meta` | seat owner / host | `{ seatId, displayName?, bgColor?, bgImageUrl?, rotation? }` | apply, broadcast |
| `eliminate` | host / seat owner | `{ seatId }` | stamp placement = (#alive at death), broadcast |
| `game_start` | host | `{}` | transition lobby → board |
| `game_end` | host | `{}` | freeze, compute results, write to DB |
| `state_request` | new joiner | `{}` | host replies `state_snapshot` (full state) |
| `state_snapshot` | host | `{ ...fullGameState }` | joiner hydrates |

**Authority rule:** companions may only emit `*_delta` / `seat_meta` for their
**own** `seatId` (host enforces; ignores cross-seat intents from guests). The host
may emit for any seat.

**Optimistic echo:** a companion applies its own `life_delta` locally immediately,
then reconciles to the host's `seat_patch` absolute when it arrives.

---

## 7. In-memory game state (host) + local persistence

```ts
type Seat = {
  id: string;              // stable within the game
  index: number;           // 0..n-1, drives layout position
  displayName: string;
  profileId: string | null;   // null = guest / host-tagged
  deckId: string | null;
  commanderName: string | null;
  bgColor: string | null;
  bgImageUrl: string | null;  // Scryfall art; defaults to commander art
  rotation: 0 | 90 | 180 | 270;
  life: number;
  cmdDamage: Record<string, number>;  // fromSeatId -> dmg (Commander)
  counters: { poison?: number; energy?: number; experience?: number; [k: string]: number | undefined };
  status: { monarch?: boolean; initiative?: boolean; dayNight?: 'day' | 'night'; cityBlessing?: boolean };
  alive: boolean;
  placement: number | null;   // set on elimination / game end
};

type GameState = {
  code: string;
  format: 'commander' | 'standard' | 'twoHeadedGiant' | 'custom';
  startingLife: number;
  cmdDamageLethal: number;    // 21 default
  status: 'lobby' | 'live' | 'ended';
  seats: Seat[];
  teams?: string[][];         // 2HG: groups of seatIds sharing life
  startedAt: number | null;
  endedAt: number | null;
};
```

**Local persistence:** serialise `GameState` to **AsyncStorage**
(`@react-native-async-storage/async-storage` — *new dependency*) on every change
(throttled). On app launch, if a non-`ended` game exists, offer **"Resume game."**
This is the entire failover story — no cloud sync of live state.

---

## 8. Supabase schema (written once, at game end)

```sql
-- A finished (or in-progress, status='live') game. Host owns it.
create table games (
  id          uuid primary key default gen_random_uuid(),
  host_user_id uuid not null references auth.users(id),
  code        text not null,                 -- short join code, unique among active
  format      text not null,
  status      text not null default 'ended', -- 'live' | 'ended'
  started_at  timestamptz,
  ended_at    timestamptz default now(),
  settings    jsonb not null default '{}'    -- startingLife, cmdDamageLethal, teams, etc.
);

-- One row per seat; carries the per-deck result.
create table game_seats (
  id            uuid primary key default gen_random_uuid(),
  game_id       uuid not null references games(id) on delete cascade,
  seat_index    int  not null,
  display_name  text,
  profile_id    uuid references auth.users(id),  -- null for guests/host-tagged
  deck_id       uuid references decks(id),       -- null if no deck attached
  commander_name text,                           -- for opponent/meta capture
  placement     int,                             -- 1 = winner
  is_winner     boolean not null default false
);

create index on game_seats (profile_id);
create index on game_seats (deck_id);
create index on games (host_user_id);
```

**RLS**

```sql
alter table games enable row level security;
alter table game_seats enable row level security;

-- Host manages their games.
create policy games_host_all on games
  for all using (host_user_id = auth.uid()) with check (host_user_id = auth.uid());

-- A participant can read a game they have a seat in.
create policy games_participant_read on games
  for select using (
    exists (select 1 from game_seats s where s.game_id = games.id and s.profile_id = auth.uid())
  );

-- Host writes all seats for their games.
create policy seats_host_write on game_seats
  for all using (
    exists (select 1 from games g where g.id = game_seats.game_id and g.host_user_id = auth.uid())
  ) with check (
    exists (select 1 from games g where g.id = game_seats.game_id and g.host_user_id = auth.uid())
  );

-- A player reads their own seat rows (their stats).
create policy seats_owner_read on game_seats
  for select using (profile_id = auth.uid());
```

**Why the host writes everyone:** companions hand over `profile_id` + `deck_id`
at join, so at game end the host inserts one `games` row + N `game_seats` rows in
a single transaction. Each player later reads their own rows. No multi-writer
coordination, no service-role round-trip.

> **Note:** existing API routes use cookie auth; if any server-side aggregation is
> added later it must also accept the Bearer token (see `mobile/lib/api.ts`
> contract). v1 writes go **directly via the supabase-js client** under RLS — no
> API route needed.

---

## 9. Stats write-back & where they surface

Derived from `games` ⋈ `game_seats` (no denormalised counters needed at first;
add them only if query cost shows up):

- **Deck record + history** — on `DeckDetailScreen`: `W–L`, win-rate, avg
  placement (`select ... from game_seats where deck_id = ? `). A **game history**
  list reads `games` joined to the user's seats.
- **AI insights (Pro)** — game results feed the existing insights payload
  (`InsightsScreen`): "your win-rate piloting this commander is X%." Gate behind
  `profile.tier !== 'free'` exactly like current insight credits.
- **Profile aggregates** — lifetime games / overall win-rate / favourite format on
  `ProfileScreen` (`select ... from game_seats where profile_id = ?`).
- **Opponent / meta** — "commanders you faced" = the *other* seats in games you
  were in (`commander_name` on sibling `game_seats`). Quality depends on how well
  seats were labelled; host tagging improves it.

A `deck_record` SQL view is the clean way to expose the first one to the client.

---

## 10. Deep linking (the one cross-cutting piece of plumbing)

The QR encodes a **universal/app link**, not the raw `deckforge://` scheme, so a
system-camera scan works for non-users.

**Mobile (already partly in place):** the app scheme is `deckforge` and
[mobile/App.tsx](mobile/App.tsx) already has a `Linking` handler (used today for
magic-link auth). Extend it to parse `deckforge://join/{code}` **and** the https
universal link, routing to `{ id: 'gameJoin', code }`.

Add to `app.json`:
- `ios.associatedDomains: ["applinks:deckforge-eta.vercel.app"]`
- `android.intentFilters` for `https://deckforge-eta.vercel.app/j/*` with
  `autoVerify: true`

**Web (the single new route on the Vercel app):**
- `web/app/j/[code]/page.js` — landing page. If the OS intercepted the link the
  app opens directly; otherwise this page shows the game code + **App Store /
  Play Store** buttons (store fallback). Also offers a "I have the app — open it"
  `deckforge://join/{code}` button.
- Serve `/.well-known/apple-app-site-association` (JSON, no extension, correct
  content-type) and `/.well-known/assetlinks.json` from the web app for link
  verification.

**Codes:** short, human-typable (e.g. 6 chars, ambiguity-free alphabet). Unique
among **active** games only (collisions fine once a game ends). Code is the lobby
secret; host approval is the gate. Codes die when the game ends.

---

## 11. Formats & rules config

| Format | Default life | Lethal cmd dmg | Notes |
| --- | --- | --- | --- |
| Commander / EDH | 40 | 21 | Commander-damage drawer per seat; 2–8 seats |
| Standard 1v1 | 20 | n/a | 2 seats; no commander-damage UI |
| Two-Headed Giant | 30 (shared) | 21 | Seats grouped into `teams`; shared life per team |
| Custom life | editable | optional | Any starting life; counters available |

A single `FORMATS` config object in `mobile/lib/game/formats.ts` drives setup
defaults and which UI affordances appear.

---

## 12. Counters, status & table tools

- **Counters** (drawer per seat): poison/infect, energy, experience, **generic
  custom** (user-labelled +/−). Commander damage is its own drawer in Commander.
- **Status toggles**: Monarch (exclusive — passes to one seat), the Initiative
  (exclusive), Day/Night (global), City's Blessing (per seat). Shown as small
  badges on the active seat, set from the drawer.
- **Table tools** (global menu): random first player, dice roller (d6/d20),
  coin flip. Cheap, self-contained, no networking.
- **Per-seat change log + undo:** every applied delta pushes to a small ring
  buffer per seat so a mis-tap is one undo away (falls out of the delta model;
  prevents life-total disputes).

---

## 13. Layout & orientation

- Seat layouts by count: 2 (top/bottom), 3, 4 (quadrants), 5, 6 (rotating
  ring). **7–8 → compact list layout** (panels stacked, smaller, less rotation),
  with a nudge toward companion phones for big pods.
- Each seat panel has an independent `rotation` (0/90/180/270) so players around a
  shared phone read upright. Host sets seat rotation; a companion's own panel is
  always upright on its own device.
- Tap zones: large +/− halves per seat (Lotus pattern), long-press for the
  counter/commander-damage drawer, hold-to-accelerate for big life swings.

---

## 14. Monetisation gating

- **Free:** hosting, joining, the full live tracker, basic per-deck W/L + placement
  record, game history, profile aggregates.
- **Pro (£3.99/mo):** AI insights *fed by* game data, and the future deep-stats
  mode. Gate identically to today's insights flow (`profile.tier`, insight
  credits). Tier source of truth stays `shared/tiers.js`.

---

## 15. Phased build plan (RN6)

- **RN6a — Lobby & navigation skeleton.** `play` entry, host/join chooser, game
  setup, deck pick, lobby screen with QR + manual code. Game state local-only,
  single-device. No Realtime yet.
- **RN6b — Live board (single device).** Seat layouts 2–8, life/counters/commander
  damage, status toggles, drawer, rotation, elimination → placement, results
  screen. AsyncStorage persistence + resume. **This is a shippable single-phone
  tracker on its own** (competes with Lotus).
- **RN6c — Companion join via Realtime.** Broadcast channel + presence,
  host-authoritative reducer, optimistic echo, host approval, deep-link join.
- **RN6d — Stats write-back.** `games` + `game_seats` tables + RLS, host writes pod
  at game end, deck record on `DeckDetailScreen`, profile aggregates, history list.
- **RN6e — Deep-link plumbing & polish.** Universal/app links, web `/j/[code]`
  landing + `.well-known` files, AI-insights feed (Pro), table tools, opponent/meta.

Order matters: **6b ships value with zero backend.** Realtime, stats and deep
links layer on without rework because the host is already authoritative.

---

## 16. Deferred / future

- **Deep-stats mode** (opt-in): turn counter, who-damaged-whom matrix, mulligans,
  game length — richer insights for keen players. Schema-compatible: extra columns
  / a `game_events` table, written only when the mode is on.
- Landscape "table" board mode (unlock orientation for the board only).
- Spectator view; rejoin-after-disconnect via the persistent code.

---

## 17. New files (anticipated)

```
mobile/
  screens/
    PlayHomeScreen.tsx        # host/join chooser
    GameSetupScreen.tsx
    GameLobbyScreen.tsx       # QR + code + ready list
    GameBoardScreen.tsx       # the live tracker
    GameResultsScreen.tsx
    GameJoinScreen.tsx        # entered via deep link / manual code
    GameHistoryScreen.tsx
  components/game/
    SeatPanel.tsx
    SeatLayout.tsx            # count → positions + rotation
    CounterDrawer.tsx
    CommanderDamageDrawer.tsx
    TableToolsMenu.tsx
    QrCode.tsx                # encode join link
  lib/game/
    state.ts                 # GameState reducer (host authority)
    realtime.ts              # Supabase Broadcast + Presence wrapper
    formats.ts               # FORMATS config
    persist.ts               # AsyncStorage save/resume
    results.ts               # compute placement + write to Supabase

web/
  app/j/[code]/page.js        # deep-link landing + store fallback
  public/.well-known/apple-app-site-association
  public/.well-known/assetlinks.json
```

**New mobile deps:** `@react-native-async-storage/async-storage`, a QR encoder
(`react-native-qrcode-svg`). QR *scanning* can reuse `react-native-vision-camera`
(already a dep) or `expo-camera`'s barcode scanner.
