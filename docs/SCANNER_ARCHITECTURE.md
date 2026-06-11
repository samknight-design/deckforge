# DeckForge Scanner — Architecture & Rebuild Guide

> **Purpose:** This is the authoritative, self-contained explanation of how the
> DeckForge card scanner works. It is written so that an AI (or a human) with no
> prior context could rebuild the scanner from scratch. If the scanner ever needs
> to be re-derived, **start here.**
>
> Last verified: June 2026. Measured result: **8/8 cards correct** (7 free
> on-device art-hash, 1 free on-device OCR, 0 AI, 0 wrong), including a Japanese
> card and an ornate Mystical Archive card.

---

## 1. The problem & the core idea

Identify a paper Magic: The Gathering card from a live phone camera, **on-device,
for free, instantly**, with AI only as a rare last resort.

The breakthrough idea after many failures: **don't rely on one signal.** Use a
ladder of methods that fail in *different* situations, so together they cover the
messy real world:

```
  Tier 1  ── Art-region fingerprint  (live, on-device, free)   → ~90% of cards
  Tier 2  ── OCR the card NAME       (on-device, free)         → glare/sleeve/ornate/foreign
  Tier 3  ── AI Smart Scan (Claude)  (network, costs a credit) → true anomalies only
```

Two hard-won principles:

1. **Fingerprint the ARTWORK, not the whole card.** Borders, title fonts, and
   text boxes are shared across thousands of cards — generic noise. The artwork
   is the unique, discriminative part, and it's language-independent (fixes
   foreign cards). This is what ManaBox does.
2. **Identify by content, not by a perfect boundary.** Requiring a clean 4-corner
   card outline is brittle on cluttered desks / decks / sleeves. The OCR tier
   needs only the *title* to be readable — a far lower bar.

---

## 2. The scan ladder in detail

### Tier 1 — live art-region fingerprint (the workhorse)

Runs continuously on the camera thread (vision-camera **frame processor /
worklet**). Per (throttled) frame:

1. **Get pixels without a snapshot.** `vision-camera-resize-plugin` `resize(frame,
   {scale, pixelFormat:'bgr', dataType:'uint8'})` → downscaled BGR `Uint8Array`.
2. **Detect the card (two-tier, see §3).** → 4 ordered corners `[tl,tr,br,bl]`.
3. **Perspective-warp** the card flat to a fixed **146×204** grayscale rectangle
   (`getPerspectiveTransform` + `warpPerspective`).
4. **dHash the ART REGION** of that warp (see §4) → 256-bit fingerprint.
5. **Match** against the bundled DB (Hamming nearest-neighbour, see §5) at **0°
   and 180°** (cards can be upside-down); take the lower distance.
6. If `distance ≤ AUTO_MAX_DIST (72)` → **confident** → add card, buzz, toast.
   Else keep trying.

### Tier 2 — OCR name match (free fallback)

If Tier 1 can't get a confident match for **`AI_ESCALATE_MS` (3500 ms)** while a
card is held steady, escalate:

1. `takeSnapshot()` once (reused for OCR and, if needed, AI).
2. `@react-native-ml-kit/text-recognition` reads **all text** on the card.
3. Every recognised line (plus adjacent-line pairs, for titles that wrap) is
   **normalised** and **snapped to the nearest real card name** — exact match
   first, then bounded fuzzy (Levenshtein, ≥ 0.8 similarity) — against a
   **dictionary of ~27k unique names**. We *never* trust raw OCR spelling.
4. A hit resolves to a `scryfall_id` and adds the card. **Free, no AI.**

### Tier 3 — AI Smart Scan (rare)

If OCR also fails, POST the *same* snapshot to `/api/scan` (Claude vision). Adds
the result. Respects a daily free cap (Pro = unlimited). This should be hit only
for genuine anomalies (obscured cards, exotic Secret Lair/Un-cards).

---

## 3. Card detection (two-tier)

Goal: turn a camera frame into 4 ordered corner points of the card. Shared by the
live worklet (`CameraView.tsx`) and Force Scan (`scanOpenCV.ts`).

Common preprocessing (native OpenCV via `react-native-fast-opencv`):
`Mat → cvtColor BGR2GRAY → GaussianBlur(5×5) → Canny(30, 90)`.

- **Tier 1 — PRECISE (clean cards):** `findContours(RETR_EXTERNAL)` on the *raw*
  Canny edges. For each contour with area ≥ `MIN_AREA_FRAC (0.08)` of the frame:
  `approxPolyDP(0.02·perimeter)`. If it yields **exactly 4 points** with card
  aspect ratio (`min/max ∈ [0.55, 0.92]`), it's a tight, exact quad. Pick the
  largest. **This is what gives clean cards their low, accurate distances.**
- **Tier 2 — ROBUST (only if Tier 1 found nothing):** `dilate(5×5, 2 iters)` to
  bridge faint/broken borders, `findContours`, then take the largest card-aspect
  contour's **`minAreaRect`** (a rotated rectangle — tolerant of imperfect
  contours). Catches faint/ornate borders (Mystical Archive) but its crop is
  looser, so it only "wins" when precise fails.

Then order the 4 points to `[tl,tr,br,bl]` (sum/diff method) and **force portrait**
(if the quad is wider than tall, rotate the labelling) so sideways cards warp
upright. 180° flips are handled by matching both ends in Tier 1.

> **Lesson learned:** an *aggressive single-tier* detector (dilate + minAreaRect
> for everything) regressed clean cards because the looser crop shifts the
> fingerprint. The two-tier order (precise first, robust fallback) is essential.

---

## 4. The fingerprint: art-region dHash (the most critical detail)

A **dHash** (difference hash): downscale a region to a 17×16 grid of average
luma, then emit a bit per horizontally-adjacent pair (`left < right`) → 16×16 =
**256 bits / 32 bytes**.

**We hash only the ART REGION**, a fixed proportion of the full card:

```
ART_X0 = 0.07   ART_X1 = 0.93     (≈ inner 86% width)
ART_Y0 = 0.11   ART_Y1 = 0.58     (the art band: below title, above type line)
```

> **THE BYTE-IDENTICAL RULE (do not violate):** the crop + cell math in the DB
> builder (`web/scripts/build-full-hashes.mjs` → `dhashFromImageData`) and on the
> phone (`mobile/lib/scanOpenCV.ts` → `dhashGray`) **must be identical**, including
> the `ART_*` constants and the exact `Math.round`/`Math.floor` cell-boundary
> formulas. If they diverge, *nothing matches*. The only legitimate difference is
> the luma source: the builder reads RGBA (`0.299R+0.587G+0.114B`); the phone
> reads single-channel gray that OpenCV `cvtColor` already produced with the same
> weights.

Why art-only: more discriminative (art is unique), robust to border/foil/frame
variation, tolerant of small crop error (a boundary slip barely moves the central
art), and **language-independent** (a Japanese card matches its English art).

The warp and the Scryfall reference image are both the full card front at 146×204,
so the same proportional crop selects the same physical region on both sides.

---

## 5. Matching & the hash database

**Matching** (`shared/cardScan.js` → `matchHash`): brute-force Hamming distance of
the 32-byte query against all ~115k DB hashes, with a precomputed popcount table
and an **early-exit** once a candidate exceeds the running best. ~tens of ms.
Returns `{index, distance, runnerUp}`. We compute it for the 0° and 180° hashes
and keep the lower distance.

> **Reprints note:** `gap` (runner-up − best) is unreliable because reprints share
> artwork (the runner-up is often *the same card, different printing*, so gap ≈ 0).
> **Confidence is `distance`-only**, not gap.

**Database files** (bundled in `mobile/assets/hashes/`, all index-parallel, count
must match across all three):

| File | Format | Role |
|---|---|---|
| `cards.bin` | 16-byte header `DFHB` + count·32 art-region hashes | the fingerprints |
| `cards.ids.bin` | header `DFID` + count·16-byte packed UUIDs | row → scryfall_id (`idAt`) |
| `cards.names.bin`| header `DFNM` + offset table + UTF-8 blob | row → name (`nameAt`), OCR dict |
| `cards.idx` | JSON `[{id,name,set,cn}]` | tooling source for the two `pack-*` scripts (not bundled) |
| `cards.meta.json`| `{count, builtAt, ...}` | metadata |

Measured-current count: **115,304**.

> **Performance lessons:** load these via expo-file-system's native
> `new File(uri).bytes()` (a `Uint8Array`, no base64) — pure-JS base64 decode and
> big `JSON.parse` both froze the UI. Names/ids are packed binary precisely to
> avoid an 11 MB JSON parse. In the worklet, gate on a `dbReady` shared boolean —
> **never capture the 3.5 MB hash array in the worklet closure** (it gets deep-copied).

---

## 6. Worklet ⇄ JS thread (a subtle, critical bug class)

The detection + warp run in the **worklet** (camera thread); the 115k match runs
on the **JS thread** (off the camera thread). To pass the warped image across:

- **Copy the warped pixels into a plain `number[]` in the worklet BEFORE calling
  `OpenCV.clearBuffers()`**, then pass the array via `useRunOnJS`. Native-backed
  views / typed arrays marshalled across threads arrive as **zeros** → every scan
  matches the same "blank" card. (This exact bug produced "every scan = Restless
  Anchorage".) On the JS side, `Uint8Array.from(arr)`.
- `OpenCV.clearBuffers()` **every frame** (and in `catch`) or native memory blows up.
- The heavy 115k match runs **once per detected card**, not per frame — gated by
  `scanBlocked` (set when a stable card is warped, cleared after the JS handler +
  cooldown). A stability gate (`STABLE_FRAMES_NEEDED = 3` steady centroid
  detections) avoids matching motion-blurred frames.

---

## 7. Tuning constants (all in `mobile/screens/CameraView.tsx` unless noted)

| Constant | Value | Meaning |
|---|---|---|
| `AUTO_MAX_DIST` | 72 | dist ≤ this = confident add. Good matches sit ≤71, garbage ≥82 (clean gap). |
| `STABLE_FRAMES_NEEDED` | 3 | steady-centroid detections before warping |
| `FRAME_THROTTLE` | 3 | run the detector every Nth frame |
| `AI_ESCALATE_MS` | 3500 | steady-but-unmatched this long → OCR→AI escalation |
| `SCAN_COOLDOWN_MS` | 1500 | pause after a successful add |
| `PROC_LONG` | 480 | detection resolution (long side) |
| `WARP_W` / `WARP_H` | 146 / 204 | warped card size (matches Scryfall `small`) |
| `MIN_AREA_FRAC` | 0.08 | card must cover ≥8% of the frame |
| `ASPECT_LO`/`ASPECT_HI` | 0.55 / 0.92 | accepted card aspect band (true ratio ≈ 0.716) |
| `ART_X0..Y1` (scanOpenCV + build) | 0.07/0.93/0.11/0.58 | art-region crop — **keep identical both sides** |
| OCR fuzzy threshold (`scanOcr.ts`) | 0.80 | min name similarity to accept |

---

## 8. Key files

| File | Role |
|---|---|
| `mobile/screens/CameraView.tsx` | Scanner UI + live worklet (two-tier detect, warp, dispatch) + escalation ladder + haptics/toasts |
| `mobile/lib/scanOpenCV.ts` | `matchPhotoOpenCV` (Force Scan), `dhashGray` (**art-region**), `reversed`, `rectCorners`, `orderQuadPortrait` |
| `mobile/lib/scanLocal.ts` | `prepareScanDb` (native byte read of the 3 bundled DBs), `idAt`, `nameAt`, `parseHashDb` |
| `mobile/lib/scanOcr.ts` | `ensureNameIndex` (27k-name dict), `ocrMatch` (ML Kit + exact/fuzzy) |
| `shared/cardScan.js` | `matchHash`, `parseHashDb` (+ legacy Hough warp, now superseded for live) |
| `web/scripts/build-full-hashes.mjs` | DB builder — art-region dHash, **resume checkpoint + cached download** |
| `web/scripts/pack-ids.mjs` / `pack-names.mjs` | derive `cards.ids.bin` / `cards.names.bin` from `cards.idx` |

---

## 9. Native modules & why each is needed

- `react-native-vision-camera` (v4) — camera + frame processors.
- `react-native-worklets-core` — runs the detector on the camera thread.
- `vision-camera-resize-plugin` — get frame pixels in the worklet (no snapshot).
- `react-native-fast-opencv` — OpenCV (Canny, contours, perspective warp) in JS/worklet.
- `@react-native-ml-kit/text-recognition` — on-device OCR for the name tier.
- `expo-haptics` — the success buzz.
- `expo-build-properties` — **sets `android.minSdkVersion = 26`** (required by
  vision-camera raw-pixel APIs). Must be a plugin; the `app.json` `android` block
  field is silently ignored.
- `expo-file-system` — `File.bytes()` native byte reads of the DB.

---

## 10. How to rebuild the hash DB (~40 min)

```bash
# From repo root. Re-fingerprints all printings from their ART region.
node --expose-gc web/scripts/build-full-hashes.mjs       # resumes if it crashes
node web/scripts/pack-names.mjs                            # realign cards.names.bin to new count
# (pack-ids is emitted by the build script itself)
# Verify all three counts match, then commit mobile/assets/hashes/*
```

The build streams the 545 MB Scryfall bulk (cached), fetches each card's `small`
image, art-crops + dHashes it. It **segfaults around ~55–60k** on the native
canvas (memory); it now **checkpoints every ~1800 cards** and the `--expose-gc`
run plus an outer retry loop auto-resume to completion. Run it in an auto-retry
loop: `for i in $(seq 1 40); do node --expose-gc web/scripts/build-full-hashes.mjs && break; done`.

---

## 11. Build & dev workflow (local — no EAS)

EAS free Android builds run out; we build **locally**. One-time env (already set
on the dev machine): `ANDROID_HOME`, **`JAVA_HOME` = a real JDK 17** (the Expo
Gradle plugin requires 17; Android Studio's bundled JBR is 21), accepted SDK
licenses, Gradle wrapper pre-cached, raised Gradle HTTP timeouts.

```bash
cd mobile
JAVA_HOME=<jdk17> npx expo run:android      # build+install dev client (native changes only)
npx expo start --dev-client                 # JS-only iteration: instant hot reload, no rebuild
```

**Native changes** (new module, `app.json` plugin, minSdk) need `expo run:android`.
**JS changes** hot-reload over Metro instantly. A **DB swap** (`cards.bin`) needs a
**full app reload** (the DB is memoised; Fast Refresh won't re-load it).

Live debugging over USB (`adb`): screenshot (`screencap -p`/`pull`; note the live
camera preview captures black — that's normal), read `console.log`/errors from the
Metro task output (`[live] best=<name> dist=<n> tier=<1|2>`, `[ocr] …`, `[ai] …`),
deep-link to load the project:
`adb shell am start -a android.intent.action.VIEW -d "exp+deckforge://expo-development-client/?url=http://localhost:8081"`.

---

## 12. Catalogue of bugs we hit (so they're never re-hit)

1. **minSdkVersion in `app.json` android block is ignored** → use `expo-build-properties`. (Symptom: `frame.toArrayBuffer()` "needs minSdkVersion 26".)
2. **`getPerspectiveTransform` needs `Point2fVector`, not `PointVector`** ("Argument (1) is not a Point2fVector").
3. **Worklet→JS buffer must be copied to `number[]` before `clearBuffers`** (else zeros → every scan the same card).
4. **dHash build/scan math must be byte-identical** (incl. the art crop).
5. **Don't capture the 3.5 MB hash array in the worklet** (use a `dbReady` flag).
6. **Read DB via `File.bytes()`**, never base64-in-JS or big `JSON.parse` (UI freeze).
7. **Confidence is distance-only**, not gap (reprints make gap ≈ 0).
8. **Two-tier detection order matters** — precise first; an aggressive-only detector regresses clean cards.
9. **Don't strip the forced camera `format`** — it regressed live detection.
10. **DB rebuild segfaults** — needs checkpoint/resume + cached download.
11. **Local builds: never uninstall the app** to "get the latest" — that's an EAS habit; JS hot-reloads.

---

## 13. Current state & open items

- **Working** (8/8 measured): art-region hash + OCR + AI ladder; foreign + ornate cards handled on-device.
- **Watch:** foreign/sleeved cards can creep toward the 72 threshold (the Japanese card was 63–71).
- **Next:** a wider measured run (more Mystical Archive, Rhythm of the Wild, Amazing Spider-Man, sleeved, foils, basic lands, cluttered background), then fine-tune `AUTO_MAX_DIST` from data. Possible future: continuous live OCR (frame-processor text recognition) to make the name tier instant rather than escalation-only.
