# DeckForge scanner — resume here (next session)

> Snapshot for picking the scanner work back up. Full detail lives in the
> `scanner-lockon-s1` memory + `docs/SCANNER_LOCKON_PLAN.md`.

## Where we are
- **Detector:** retrained on true 3D perspective (`corner-v3-persp`), handles angles.
  Model is **side-loaded** to the dev phone (`/storage/emulated/0/Android/data/app.deckforge/files/corner.tflite`) — NOT yet in the app bundle.
- **Recognition:** moved **server-side** (SigLIP2 + full 115k index on the laptop match
  server). Validated: ~180–350 ms over real internet, phone stays cool/light, same accuracy.
  This is the chosen architecture. On-device SigLIP path still exists behind `SERVER_LIVE` but
  is dead weight now.
- **Scan flow:** continuous background recognition (never freezes tracking), one still-frame
  per settle, adaptive detector rate (4 fps idle / 12 fps tracking), settle-gate for stacking.
- **Hosting:** parked — HF free tier no longer allows Docker Spaces (PRO-only). Staying on
  laptop + `cloudflared` tunnel for the prototype. Deploy package ready in `scanner-spike/hf_space/`
  for a VPS / Oracle free tier / HF PRO later.
- Branch `scanner/lockon-s0-s1`, latest commit `db3f1a8`. Working tree clean.

## Env bring-up (the session/agent does this via the Bash tool)
```bash
# phone on USB, authorized
adb devices                       # expect: R5CWB1VGYVM  device
adb reverse tcp:8081 tcp:8081     # Metro
adb reverse tcp:8765 tcp:8765     # match server
adb shell svc power stayon true   # doze breaks Fast Refresh

# match server (recognition) — start via Bash (the .venv python trampoline is BROKEN in
# PowerShell (uv quirk) but works from Git Bash). Wait for /health to return.
cd /c/Users/samkn/scanner-spike && nohup .venv/Scripts/python.exe match_server.py > server.log 2>&1 &
curl -s http://127.0.0.1:8765/health          # {"ok":true,"cards":115610}

# Metro
cd /c/Users/samkn/Desktop/DeckForge/mobile && npx expo start --dev-client --port 8081

# launch app — 127.0.0.1 (NOT localhost; phone can't resolve it). Retry the launch in a
# loop until logcat shows Running "main" AND focus == MainActivity (cold-connect often
# fails the 1st try). Then tap the camera FAB (540,2091) ONLY when unlocked.
adb shell am start -a android.intent.action.VIEW -d "deckforge://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081"
```
Untethered/real-internet extra: `scanner-spike/cloudflared.exe tunnel --url http://localhost:8765`
→ paste the `https://….trycloudflare.com/match` URL into `MATCH_SERVER_URL` (ephemeral).

## Device gotchas (burned time last session)
- Flaky USB cable (drops adb), aggressive doze (black screen between commands), and
  DevLauncherErrorActivity on cold relaunch → **retry launch until it loads**.
- **Do NOT blind-tap while locked** — a bottom tap hit the Samsung emergency dialer twice.
  If locked, ask the user to unlock + navigate.
- Screenshots: `adb shell screencap -p /sdcard/x.png; adb pull …` (PowerShell `>` corrupts PNGs).

## Priorities this session
1. **Validate the scanner is solid** — scan session (incl. stacking) confirming the settle-gate
   killed the transitional misreads and the loop feels right. Locks in the win.
2. **Bundle the detector model into the app** (gate to untethered/beta): copy the ~4 MB
   `corner.tflite` into `mobile/assets`, load it from bundled assets instead of the side-loaded
   path, bump BUILD_TAG. Then **delete the dead on-device SigLIP path** (`embedScan` init +
   the ~450 MB models) to slim the app.
3. Polish: config the server URL (not a hardcoded tunnel), graceful "can't reach recognizer" UX.
4. Later: zoom out to the rest of the app (RN3 decks, RN4 IAP/Pro, RN5 store submission).
