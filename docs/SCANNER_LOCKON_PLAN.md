# Scanner Lock-On Plan — Road to ManaBox Parity

> **Purpose:** Step-by-step build plan to close the gap between DeckForge's
> scanner and ManaBox's: instant, buttery lock-on that hugs card edges at any
> angle, with near-instant recognition. Written for Opus 4.8 to execute with no
> prior context. Read `docs/SCANNER_ARCHITECTURE.md` first for the pipeline;
> read §1 here for the *measured current state* this plan starts from.
>
> Status: PLAN (June 2026). Nothing here is built yet.

---

## 0. The target, made concrete

"ManaBox parity" means, on a mid-range Android phone:

| Metric | Target | How to measure |
| --- | --- | --- |
| Lock-on overlay | True **perspective quad** hugging all 4 card edges (not a rotated box) | Visual |
| Overlay update rate | Perceived-continuous (≥ 25 Hz effective, smoothed) | Perf HUD (§S0) |
| Overlay lag while moving the card slowly | None visible (< ~80 ms behind the card) | Slow-pan test |
| Reacquire after losing the card | < 300 ms | Perf HUD |
| Card fully in frame → correct ID badge | median ≤ 500 ms, p90 ≤ 1 s | Perf HUD e2e timer |
| Sustained scanning | ≥ 15 cards/min for 5 min without thermal collapse | Stopwatch test |
| Accuracy | No regression vs the measured 8/8 protocol (incl. Japanese + Mystical Archive) | §7 test protocol |

---

## 1. Verified current state (do not re-derive; this was audited)

From `mobile/screens/CameraView.tsx`:

1. **Corner detector:** TFLite heatmap model, **256×256 RGB input**, run
   **synchronously on the camera thread** via `runAtTargetFps(TFLITE_FPS)` with
   `TFLITE_FPS = 12`. Comment records that 24 Hz **froze the camera thread**
   ("camera-thread starvation. Next: decouple").
2. **Delegate:** `useTensorflowModel(tfSource)` — **default CPU delegate**, no
   GPU/NNAPI, quantization state of the model unknown (it's side-loaded).
3. **Overlay:** a **rotated rectangle**, not a quad — `Animated.Value`s
   `trackTX/trackTY/trackSX/trackSY/trackRot` (translate/scale/rotate of a
   fixed box). Driven by worklet→JS marshalling. Structurally it *cannot* hug
   the card edges under perspective (a tilted card is a trapezoid).
4. **No inter-frame tracking or filtering:** corners update at 12 Hz steps;
   no One-Euro/Kalman smoothing layer (there is stability *counting* —
   `stableCount`, centroid drift — but no positional smoothing).
5. **Recognition:** dHash Hamming over the bundled 114k DB in the worklet
   (fast, not the bottleneck), temporal voting exists
   (`consecutiveCount`/`lastMatchIndex`), `AUTO_MAX_DIST = 72`; SigLIP
   embedding confirm runs **once at lock** (`captureNext` → warp+embed),
   encoder forced to **CPU** (GPU/NNAPI path previously broke — see memory:
   "CPU-encoder recognition fix").
6. **Models are side-loaded** onto the dev phone (`corner.tflite` from a
   hardcoded `/storage/emulated/0/...` path; `siglip/matcher/corner.onnx` from
   app documents). **A store install has no working v2 scanner.**
7. `react-native-fast-opencv` is installed. It exposes imgproc incl.
   `matchTemplate`, but **no video module** (no `calcOpticalFlowPyrLK`).
8. `react-native-reanimated` and `@shopify/react-native-skia` are **NOT
   installed** (only `react-native-worklets-core`). These are native deps →
   **need the dev-client rebuild**.

### Diagnosis (why it doesn't feel like ManaBox)

The recognition brain is fine. The *feel* gap is three compounding rendering/
detection facts: **12 Hz CPU detection** (steppy) + **no smoothing between
detections** (jumpy) + **a rotated-box overlay marshalled to the JS thread**
(laggy, and geometrically wrong under tilt). ManaBox's magic is a fast
detector + temporal smoothing + a GPU-drawn perspective quad. All three are
additive fixes — nothing existing needs to be thrown away.

---

## 2. Technology inventory — what we are NOT yet using

| Tech | What it buys | Cost |
| --- | --- | --- |
| **int8 quantization** of the corner model (+ smaller input, e.g. 192²) | 2–4× detector speedup on CPU | Re-export model; no new deps |
| **GPU delegate** (`android-gpu`) / **CoreML** (iOS) in fast-tflite | Potentially 2–5× further; frees camera thread | Config change + validation |
| **One-Euro filter** on corner positions (pure TS, in-worklet) | Kills jitter, keeps responsiveness — the standard AR-pointer trick | ~40 lines, no deps |
| **Reanimated shared values + Skia canvas quad** | 60 fps GPU overlay, zero React re-render, true 4-corner perspective quad | **Rebuild** (2 native deps) |
| Detector/camera-thread **decoupling** (double-buffer: worklet writes pixels, detector runs on its own thread) | Camera never starves; detector runs as fast as it can | Medium refactor (the code comment already plans this) |
| `matchTemplate` corner-patch tracking between detections | True tracking if 25–30 Hz detection proves unreachable on low-end devices | Stretch option only |
| **Apple Vision `VNDetectRectanglesRequest`** (iOS) | Free native rectangle detection on iOS as the detector or a cross-check | iOS phase |
| **XNNPACK thread tuning** for the CPU fallback path | Free 20–50% on multi-core | Config |
| **PCA→128-d int8** embedding DB + **int8-quantized SigLIP** | Embedding confirm < ~250 ms; DB ~15 MB instead of ~175 MB | Offline pipeline work |
| Collector-line OCR tiebreaker | Same-art printing disambiguation (a ManaBox differentiator) | Later phase |

Explicitly rejected: auto-foil detection (ManaBox's is unreliable too);
FAISS-style ANN indexing (114k × 128-d int8 brute force is trivial);
switching detector to classical Canny/contours (sleeves/toploaders create
double edges — the reason the heatmap model exists; keep classical only as a
speed experiment, never as the sole path).

---

## 2.5 iOS-compatibility rules — apply to EVERY phase

**Context:** all development and testing happens on the dev's Android phone.
iOS must still ship without nasty surprises — so iOS is a *design constraint
on every line written*, not a porting phase. S6 below is a *validation* pass,
not a port.

1. **No platform forks in pipeline logic.** The scanner pipeline talks to a
   `detectCorners(frame) → corners|null` interface and a
   `embed(crop) → vector` interface. Platform differences (which delegate,
   which model runtime, Apple Vision fallback) live *behind* those interfaces,
   selected via `Platform.select` at the leaf only.
2. **No hardcoded native paths — ever.** All model/DB artifacts resolve via
   expo-file-system `Paths.document` / `Paths.cache` (platform-neutral). The
   existing `/storage/emulated/0/...` load is the anti-pattern S5 deletes.
3. **Delegate selection is a config table, not an if-chain:**
   Android → `android-gpu` → int8-CPU/XNNPACK fallback; iOS → `core-ml` →
   CPU fallback. Write the full table now; the iOS row simply stays untested
   until S6. Same for ONNX Runtime execution providers (encoder).
4. **Isolate frame orientation/pixel-format assumptions.** The worklet's
   `rotation: '90deg'` sensor-to-portrait fix encodes *Android* sensor
   behaviour; iOS sensors differ. Wrap orientation + pixel-format handling in
   one helper with the assumption documented, so S6 adjusts one place, not
   scattered math.
5. **Cross-platform libraries only** (current picks all qualify: vision-camera,
   fast-tflite w/ CoreML delegate, onnxruntime-react-native, ML Kit iOS pods,
   worklets-core, Skia, Reanimated, expo-haptics/file-system). Anything
   Android-only (e.g. expo-navigation-bar) must be UI-chrome, never pipeline,
   and guarded.
6. **Insets:** replace hardcoded status/nav-bar numbers with
   `react-native-safe-area-context` in the Big Rebuild (iOS home-indicator
   and notch geometry differ per device — hardcoding is an iOS landmine).
7. **Early iOS canary build:** run the first iOS EAS build (Apple dev account,
   pods compiling — vision-camera, fast-tflite, onnxruntime, ML Kit) as soon
   as the Big Rebuild lands — long before feature-parity work — so toolchain
   surprises surface while they're cheap. TestFlight the smoke test.
8. **Per-phase iOS notes:** every phase below carries its iOS implication
   inline; leaving one unaddressed = the phase isn't done.

## 3. Execution phases

Ordering matters: S0 before everything (you cannot optimise what you don't
measure); S1–S2 need no rebuild and land immediately; S3 waits for the Big
Rebuild; S4–S6 follow. **All phases obey §2.5.**

### S0 — Perf HUD + baseline (½ day)

Add a dev-only overlay (toggle in the scan screen) showing rolling averages:
- detector inference ms + effective detection Hz
- worklet frame budget ms (time inside frameProcessor)
- dHash match ms, embed confirm ms (when it runs)
- **e2e lock time**: first frame with 4 corners → overlay locked
- **e2e ID time**: first frame with 4 corners → confident match

Log a baseline row (device, all metrics) into this doc's §8 before touching
anything. Every subsequent step records its delta here.

### S1 — Detector speed (no rebuild)

1. **Re-export the corner model quantized** (int8, and a 192×192 input
   variant). The training pipeline lives with the heatmap-detector work (see
   memory `corner_detector_heatmap`). Validate corner accuracy vs the current
   model on the §7 test set — accept ≤ 2 px mean corner error at 256-space.
   → **DONE 2026-07-05, BOTH REJECTED — see §8 "S1.1 RESULT". int8 collapses
   the model (185–193 px); 192² doubles corner error (13 px). Ship fp16 @256;
   get the speed from S1.2 delegate + S1.4 decouple instead.**
2. **Try delegates** in order, measuring each: `android-gpu` → CPU-int8-XNNPACK
   (multi-thread). Keep whichever is fastest *and stable* (delegates can fail
   per-device; wrap in try/fallback-to-CPU like the encoder fix did).
3. Raise `TFLITE_FPS` stepwise (12 → 18 → 24 → 30) watching for the
   camera-thread starvation that froze 24 before. If starvation reappears
   before 24 Hz:
4. **Decouple** (the "Next: decouple" plan in the code): worklet copies the
   resized frame into a double buffer + notifies; detector loop runs on its
   own thread (or JS thread via the existing ONNX path pattern), writes
   corners to shared values. Camera thread never blocks on inference.

**Exit criteria:** ≥ 24 Hz effective detection, camera preview at full fps,
no accuracy regression.

*iOS note:* implement the delegate table (§2.5.3) with the `core-ml` row in
place; export the int8 model in a CoreML-delegate-compatible way (avoid
Android-only ops — validate the op set when exporting, not in S6).

### S2 — Smoothing + lock-on state machine (no rebuild)

1. **One-Euro filter per corner** (8 scalar filters: x,y × 4 corners), running
   in the worklet on every detector output. Tune (`minCutoff`, `beta`) for:
   still card = rock solid; moving card = tight follow. This single step is
   most of the "buttery" feel.
2. **Lock-on state machine** with hysteresis:
   `SEARCHING → CANDIDATE (1 detection) → LOCKED (N consistent) → COASTING
   (detection missed ≤ 250 ms, hold last smoothed quad) → SEARCHING`.
   Never blank the overlay on a single missed frame — coasting is what makes
   ManaBox feel glued.
3. Recognition already votes via `consecutiveCount`; re-tune the vote count
   against the new (higher) detection rate so time-to-ID doesn't lengthen.

**Exit criteria:** slow-pan test shows no jitter and no visible lag; overlay
survives brief occlusion/blur without flicker.

*iOS note:* pure TS in the worklet — platform-free by construction. Keep the
orientation assumption inside the §2.5.4 helper.

### S3 — True quad overlay (REQUIRES the Big Rebuild)

Prereq: add `react-native-reanimated` + `@shopify/react-native-skia` to the
dev client (batch with the other rebuild items in `docs/APP_EVALUATION.md` §8
Phase A — never spend a build on one feature).

1. Bridge worklets-core shared values → Reanimated shared values (or migrate
   the corner shared values to Reanimated's, which vision-camera interops
   with) so smoothed corners flow to the UI thread without JS marshalling.
2. Replace the `trackTX/TY/SX/SY/Rot` box with a **Skia `Path` quad** drawn
   through the 4 smoothed corners (screen-space mapped from 256-space →
   preview coords — the mapping code exists for the box). Style: rounded
   corner ticks + subtle glow; colour state = searching (dim) / locked
   (accent) / recognised (success + card name chip).
3. Delete the old box path once the quad ships.

**Exit criteria:** overlay visibly hugs all four edges of a tilted card;
no frame drops on the preview while overlaying.

*iOS note:* Skia + Reanimated are fully cross-platform (that's part of why
they're chosen over any Android-specific rendering trick). The 256-space →
preview-coords mapping must go through the §2.5.4 orientation helper.

### S4 — Recognition latency polish

1. dHash tier stays the instant path. With detection at 24–30 Hz, re-tune
   `AUTO_MAX_DIST` + vote count for median-≤500 ms ID (measure via HUD).
2. **Quantize the SigLIP encoder to int8** and re-validate the "clean colour
   crop" accuracy finding (memory: `scanner_v2_embeddings`); target < 250 ms
   confirm on CPU. If int8 SigLIP still misses budget, *then* evaluate a
   distilled small encoder — not before (avoid premature training work).
3. **PCA→128-d int8 embedding DB** build step in the DB pipeline (~15 MB for
   114k printings). Matcher = plain int8 matmul; no ANN index needed.
4. Embed-confirm runs async on lock (already the design) — UI never waits on
   it; it only *corrects* a dHash answer or resolves a low-confidence one.

### S5 — Ship the models (converts the prototype into a product)

1. Kill the hardcoded `/storage/emulated/0/...` and documents-dir loads.
2. Decision per artifact: corner.tflite (int8, ~few MB) → **bundle** in
   assets; SigLIP int8 (~95 MB) → **first-run CDN download** with versioned
   manifest, SHA-256 verification, progress UI, resume/retry; embedding DB
   (~15 MB) → download with the same manifest (it updates per MTG set —
   decoupled from app releases).
3. Scanner runs dHash+OCR tiers immediately even before downloads complete;
   embedding tier activates when present (graceful ladder degradation).
4. Automate DB/embedding rebuilds per set release (extend
   `web/scripts/build-full-hashes.mjs` pipeline; publish to CDN, not git —
   also fixes the 19 MB-binary-commits repo bloat).
5. Delete the dead 11 MB `mobile/assets/hashes/cards.idx` from the bundle.

*iOS note:* the download/manifest code paths are identical on both platforms
by §2.5.2; bundle-vs-download decisions apply equally (App Store cellular
download prompt kicks in over 200 MB — another reason to quantise).

### S6 — iOS validation (not a port — §2.5 kept it portable all along)

1. First iOS dev-client build (also Phase A of the app evaluation — run the
   canary build much earlier, right after the Big Rebuild; S6 is where the
   *scanner* gets validated on real iOS hardware).
2. Flip the delegate table's iOS row live: fast-tflite **CoreML delegate**
   for the corner model; onnxruntime CoreML EP for the encoder; measure both.
3. If TFLite-on-iOS disappoints: **`VNDetectRectanglesRequest`** (Apple
   Vision, native, free) as the iOS detector behind the same
   `detectCorners` interface — the rest of the pipeline doesn't care who
   found the corners.
4. Verify the §2.5.4 orientation helper's iOS branch (sensor rotation and
   pixel format are the most likely real differences to surface here).
5. Re-run the whole §7 protocol on iOS hardware.

**Hardware reality check:** the dev has no iPhone. Options, in order: EAS
Simulator builds catch compile/pod issues but not camera work (no camera in
the simulator); TestFlight to a friend's/family iPhone for the §7 protocol;
worst case, a cheap used iPhone (SE/11-class) is the single best hardware
purchase this project can make before iOS submission.

### S7 — Printing disambiguation (later, after parity)

Same-art reprints can't be split by art fingerprints. Add a collector-line
OCR pass (bottom-left of the warped card: collector number + set code) as a
tiebreaker when the top match has near-duplicates. This is the last ManaBox
differentiator; do it only once lock-on parity is achieved.

---

## 4. What NOT to do

- Don't rewrite the recognition ladder — it measures 8/8 and its tiers cover
  disjoint failure modes.
- Don't chase per-frame embedding inference — confirm-once is the design.
- Don't adopt classical contour detection as primary (sleeve double-edges).
- Don't add an ANN library for 114k vectors.
- Don't attempt auto-foil.
- Don't spend a dev-client build on a single native dep (batch: reanimated,
  skia, + the evaluation's Phase-A list).

---

## 5. Dependencies on other plans

- **Big Rebuild** (APP_EVALUATION §8 Phase A) gates S3 and S6.
- Model-shipping (S5) overlaps the evaluation's #1 finding — same work item.
- The game tracker's QR-scan need can reuse the same rebuild.

## 6. Risk register

| Risk | Mitigation |
| --- | --- |
| GPU delegate unstable on some Androids | try/catch → CPU-int8 fallback (pattern already exists for the encoder) |
| Quantized corner model loses accuracy on sleeves/toploaders | Validate on §7 set before adopting; keep fp16 fallback |
| 24–30 Hz unreachable on low-end devices | S1.4 decoupling + S2 coasting makes 15 Hz *feel* smooth; template-match tracking is the stretch option |
| SigLIP int8 accuracy drop | Re-run the embedding validation suite from memory `scanner_v2_embeddings` |
| CDN model download friction at first run | Ladder degrades gracefully (dHash+OCR work offline immediately) |

## 7. Test protocol (run before/after every phase)

Fixed physical set, same lighting rig: 10 cards covering — plain modern,
Japanese, Mystical Archive (ornate), foil, sleeved matte, sleeved glossy,
toploader, old-frame (93/94), full-art land, same-art reprint pair. For each:
flat scan, 30° tilt, 45° tilt, slow pan, cluttered desk background, low light.
Record: lock time, ID time, correct/incorrect, overlay feel notes. Compare
against the same cards in ManaBox on the same phone — that's the bar.

## 8. Baseline + progress log

| Date | Phase | Device | Det Hz | Det ms | Lock ms | ID ms (med) | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-07-05 | S0 baseline | Samsung R5CWB1VGYVM | ~10 (eff) | ~21 | ~711 | (lock-bound) | fp32@256, **default CPU delegate**, TFLITE_FPS=12. wl budget ~50–60 ms. embed ~650–760 ms + match ~30–50 ms (async, once at lock). |

**S0 baseline notes (2026-07-05, measured via the new perf HUD):**
- **The detector cannot sustain even its own 12 Hz throttle — effective ~10 Hz.**
  Inference ~21 ms but the *whole* worklet callback (resize→normalise→infer→
  decode) is ~50–60 ms; at 30 fps camera that caps effective detection ~10 Hz.
  This is the steppy-overlay root cause, and the number S1.2 (GPU delegate) +
  S1.4 (decouple) must beat.
- **Recognition is NOT the bottleneck.** embed ~700 ms + match ~40 ms runs async
  once at lock, off the camera thread — user confirms "identification is very
  quick; it's the lock-on/capture that takes longest." So S1/S2 (detector speed
  + smoothing/coasting) is exactly the right target; the embed ladder is untouched.
- Lock (first-seen→LOCKED overlay) ~711 ms in a clean case; e2e time-to-add is
  dominated by the lock-on/stability struggle, not embed. HUD `id` reads per-card
  now (resets on add + on card-exit).

### S1.2 RESULT (2026-07-05) — delegates give NO real gain (budget-bound)

Measured idle detector timing per delegate (fp32@256, Samsung R5CWB1VGYVM), via
the HUD delegate-cycle pill / start-index:

| Delegate | Inference ms | Effective Hz | Worklet budget ms |
| --- | --- | --- | --- |
| default (CPU) | 22 | 10.0 | 48 |
| android-gpu | 19 | 10.1 | 48 |
| nnapi | 21 | 10.9 | 48 |

All three loaded fine; **none moves effective Hz or the budget.** The detector is
**budget-bound, not inference-bound** — inference is only ~20 ms of ~48 ms. Like
int8 (S1.1), delegates are a dead end here. **Budget breakdown** (added HUD line):

```
resize 3 ms  +  normalise 15 ms  +  inference 22 ms  +  decode 1 ms  +  ~5 ms overhead
```

- The **normalise loop** (uint8→float32 ImageNet, 196k px × 3 divides) is ~15 ms
  = a third of the budget. A precomputed uint8→float **LUT did NOT help** (~17 ms):
  Hermes has no JIT, so the ~196k-iteration interpreted loop is the cost, not the
  arithmetic. To cut it you must *eliminate* the loop — bake normalisation into the
  model (uint8 input + Mul/Add first ops) so the worklet feeds the raw resize bytes
  straight in (skips both the loop AND the 196k Float32Array build). Deferred: it's a
  model re-export, and model-conversion has bitten twice (int8 broke, fp16 won't load).

### S1.3 RESULT (2026-07-05) — raising the FPS throttle works

`TFLITE_FPS` 12 → **20** raised **effective detection 10 → 15 Hz** with **no camera
starvation** (the old "24 froze it" note predates this measurement; at 20 the camera
stays live — a transient Broken-pipe on launch reconfigure recovers). Budget 48 ms
caps the ceiling at ~21 Hz, so 15 Hz approaches but doesn't hit it. Kept at 20.
**Net S1 detector state: 15 Hz (from 10), CPU, fp32@256.** Further raw-Hz gains need
model-baked normalise (−15 ms → ~33 Hz ceiling) or S1.4 decouple. Per the plan's own
thesis, **15 Hz + S2 (One-Euro + coasting) should already feel like ManaBox** — so S2
is the higher-value next step over grinding more detector ms.

### S1.1 RESULT (2026-07-05) — int8 and 192² BOTH rejected on accuracy

Validated in `scanner-spike/` (`convert_int8.py`, `export_192.py`) against 150
val crops; abs corner error measured in 256-space, drift vs each source's own
ONNX. **Bar was drift ≤ 2 px, no absolute regression.**

| Variant | Abs err (px) | Drift (px) | Size | Verdict |
| --- | --- | --- | --- | --- |
| ONNX 256 (baseline) | 7.08 | — | — | — |
| TFLite fp32 @256 | 7.08 | 0.00 | 6.75 MB | ✅ lossless |
| TFLite **fp16 @256** | (≈0 on-device) | ~0 | **3.24 MB** | ✅ **the pick** |
| TFLite int8 dynamic-range @256 | **185.9** | 185.2 | 1.86 MB | ❌ catastrophic |
| TFLite int8 full-integer @256 | **193.2** | 192.6 | 1.86 MB | ❌ catastrophic |
| ONNX 192 | 12.93 | — | — | ❌ ~2× looser |
| TFLite fp32 @192 | 12.93 | 0.00 | 6.75 MB | ❌ too loose for SigLIP |
| TFLite int8 @192 | 180.4 | 180.4 | 1.86 MB | ❌ catastrophic |

**Findings that revise §2's assumptions:**
1. **int8 is dead for this corner model.** dynamic-range int8 quantizes *only
   weights* (no calibration) and still collapses to 185 px → int8 **weights
   alone** destroy the heatmap head (same failure class as the SigLIP int8
   disaster). Not a calibration bug: fp32/fp16 convert losslessly through the
   same pipeline. Per-channel, full-integer (calibrated on 200 real crops), and
   int16-act variants all fail identically.
2. **192² input is dead too.** 7.08 → 12.93 px is a train/test resolution
   mismatch (model trained at 256); 13 px is in the known-bad range that
   collapses SigLIP onto blank cards. Re-training a native-192 model was not
   attempted — deferred (would need a fresh train run for a marginal MAC saving).
3. **Therefore the detector speedup CANNOT come from precision/input shrink.**
   The model stays **fp16 @256** (half the fp32 size, drift ~0, GPU-delegate
   friendly). All S1 speed must come from **S1.2 (GPU/CoreML delegate)** and
   **S1.4 (camera-thread decouple)** — not S1.1. Update §2's int8/192² row
   accordingly: rejected on this architecture. fp16 is the shippable artifact
   (`scanner-spike/corner_f16.tflite`, already exported).

---

## 9. SESSION-0 EXECUTION PACK — everything a cold session needs

> Read this section FIRST in the implementing session. It contains every fact
> verified during the planning audit so nothing needs re-deriving, plus the
> exact environment bring-up. Trust it; spot-check only what you touch.

### 9.1 Required reading order

1. This doc, top to bottom (§1 current state, §2.5 iOS rules are load-bearing).
2. `docs/SCANNER_ARCHITECTURE.md` — the recognition-ladder rationale.
3. Memory files `corner-detector-heatmap` + `scanner-v2-embeddings` — training
   history and the "clean colour crop" accuracy finding.

### 9.2 Environment bring-up (Windows, PowerShell; phone on USB)

```powershell
# 1. Phone visible?
adb devices                       # expect: R5CWB1VGYVM  device (Samsung, Android)
# 2. USB port-forward for Metro
adb reverse tcp:8081 tcp:8081
# 3. Start the dev server (BACKGROUND task; it dies between sessions — always restart)
cd C:\Users\samkn\Desktop\DeckForge\mobile
npx expo start --dev-client --localhost --port 8081
# 4. Launch the app at the server (URL-ENCODED url param — unencoded silently lands
#    on the dev-client "Development servers" launcher screen instead of the app)
adb shell am start -a android.intent.action.VIEW -d "deckforge://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081"
# 5. Clean reload when JS state is suspect:
adb shell am force-stop app.deckforge   # then repeat step 4
# 6. Runtime-error check that does NOT lie (the Metro log accumulates stale errors
#    from mid-edit saves — a current-code error must be confirmed via logcat):
adb logcat -c ; <cold-launch> ; adb logcat -d | Select-String "SyntaxError|Cannot read prop|ReactNativeJS.*Error"
```

Typecheck after every edit: `cd mobile; npx tsc --noEmit -p tsconfig.json`
(must run from `mobile/`). Expect CRLF warnings from git — harmless.
If port 8081 is squatted by a stale node: find via
`Get-NetTCPConnection -LocalPort 8081 -State Listen`, kill, restart.

### 9.3 Code map (audited line anchors — may drift a few lines)

`mobile/screens/CameraView.tsx` (~1900 lines, the whole live scan UX):
- L73  `TFLITE_URL` — hardcoded `file:///storage/emulated/0/Android/data/app.deckforge/files/corner.tflite` (**the side-load; S5 kills this**)
- L74  `TFLITE_FPS = 12` — comment records 24 Hz froze the camera thread; "Next: decouple"
- L133 `FRAME_THROTTLE = 1` — `liveBusy` shared value is the real gate
- L403–418 worklet shared values (worklets-core `useSharedValue`): `consecutiveCount`, `lastMatchIndex`, `stableCount`, `alignSV`, `liveBusy`, `captureNext`, `tfReady`…
- L424–425 `tfSource = { url: TFLITE_URL }` → `useTensorflowModel(tfSource)` — **default CPU delegate**; S1 adds the delegate table here
- L448–452 `trackTX/trackTY/trackSX/trackSY/trackRot` RN `Animated.Value`s — the rotated-box overlay S3 replaces with a Skia quad
- L873 `onCornerFrame` — JS-side: 256×256 RGB in → detectCorners → gates → warp → embed
- L1534 `useFrameProcessor` / L1545 `runAtTargetFps(TFLITE_FPS, …)` — camera-thread sync inference site
- Worklet rotates the sensor frame `rotation:'90deg'` to upright portrait (**Android sensor assumption — §2.5.4**)

`mobile/lib/embedScan.ts`: `ENCODER_PATH`/`MATCHER_PATH`/`CORNER_PATH` = app documents dir (side-loaded); `detectCorners()` decodes 4× 64×64 heatmaps (argmax + 5×5 weighted-centroid sub-pixel; presence gate `CORNER_PEAK_MIN = 0.20`).
`mobile/lib/scanOpenCV.ts`: `warpQuadColor` — fast-opencv perspective warp.
`mobile/lib/scanLocal.ts` L112–114: dHash DB via bundled assets `cards.bin` (3.6 MB) + `cards.ids.bin` (1.8 MB) + `cards.names.bin` (2.3 MB). **`cards.idx` (11 MB) in the same folder is loaded by NOTHING — dead weight, delete in S5.**

### 9.4 Model artifacts + training pipeline (lives OUTSIDE the repo)

**`C:\Users\samkn\scanner-spike\`** — Python training/export env (CPU torch):
- `train_corners.py` (CornerNet: MobileNetV3-small + upsample decoder → 4 heatmaps 64×64), `gen_corner_data.py` (synthetic data v3: toploaders/sleeves/rounded corners/glare), `eval_corners.py` (visual eval)
- `export_onnx.py`, `convert_fp16.py`, `convert_and_check.py` (**the ONNX→TFLite converter — S1's int8 export extends this**)
- `build_index.py`, `build_matcher.py` (embedding DB + matcher graph)
- **Already-exported artifacts (do NOT regenerate blindly):** `corner.onnx`, `corner.tflite` (fp32), `corner_f16.tflite`, `matcher.onnx`, `siglip2_image.onnx`, `siglip2_image_fp16.onnx`, **`siglip2_image_int8.onnx` — the int8 encoder S4 needs ALREADY EXISTS; validate its accuracy before assuming it's usable**
- `run_train.ps1` pattern: long training runs detached via `Start-Process` (survives the harness background-task cap); log `corner_train.log` is UTF-16

**Getting a model onto the dev phone** (until S5 ships real distribution):
```powershell
adb push C:\Users\samkn\scanner-spike\corner_int8.tflite /storage/emulated/0/Android/data/app.deckforge/files/corner.tflite
```
Bump `BUILD_TAG` in the code (`corner-rot-v3` pattern) whenever the detector artifact changes, so on-screen diagnostics identify which model is live.

### 9.5 Verified facts — do NOT re-audit these

- fast-tflite is v2 (`react-native-fast-tflite ^2.0.0`); vision-camera is **4.7.3** (CLAUDE.md saying v5 is doc drift); worklets-core `^1.6.3` is the only worklet runtime — **`react-native-reanimated` and `@shopify/react-native-skia` are NOT installed** (S3 is rebuild-gated)
- `react-native-fast-opencv 0.4.8` has imgproc (`matchTemplate` yes) but **no video module — no optical flow**
- Legacy RN architecture (`newArchEnabled: false` in app.json); expect the deprecation WARN in every log — not our error
- ONNX encoder previously broke on GPU/NNAPI → was forced to CPU ("CPU-encoder recognition fix") — expect the same risk with delegates; always wrap in try→CPU-fallback
- Metro log shows stale errors from mid-edit saves; `Bundled …ms` lines after your edit + clean logcat = healthy
- Two known-benign warnings on every launch: Legacy Architecture; SecureStore >2048 bytes
- The dev phone is the ONLY test device (Samsung, `R5CWB1VGYVM`); **no iPhone exists** — every line obeys §2.5

### 9.6 First-session execution order

1. Bring up env (§9.2), confirm scanner still scans (baseline sanity).
2. **S0**: build the perf HUD (dev-only toggle in the scan screen), measure,
   fill the §8 baseline row. Do not skip — every later step's value is proven
   against this row.
3. **S1.1**: int8 (+192² variant) corner export in scanner-spike
   (`convert_and_check.py` as the base; validate ≤2 px mean corner error via
   `eval_corners.py` before pushing to the phone).
4. **S1.2**: delegate table (`android-gpu` → int8-CPU/XNNPACK fallback; CoreML
   row written but dormant). Measure each config in the HUD.
5. **S1.3/S1.4**: raise `TFLITE_FPS` stepwise; decouple from the camera thread
   if starvation reappears before 24 Hz.
6. **S2**: One-Euro filters + lock/coast state machine (pure TS, in-worklet).
7. Update §8 log + the memory file after each phase. Commit policy: the user
   decides when to commit — **do not push without being asked.**
