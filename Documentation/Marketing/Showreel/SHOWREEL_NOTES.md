# THE WEEKEND — Showreel Production Notes (v2)

## Deliverables

| File | Format | Duration |
|---|---|---|
| `The-Weekend-Showreel-16x9.mp4` | 1920×1080, 60 fps, H.264 High (CRF 16) + AAC 320k stereo | 65.0 s |
| `The-Weekend-Showreel-9x16.mp4` | 1080×1920, 60 fps, H.264 High (CRF 16) + AAC 320k stereo | 65.0 s |
| `preview-16x9.mp4` / `preview-9x16.mp4` | Same cuts at ~3 Mbps (~25 MB) for texting/email | 65.0 s |

- **Loudness:** about −14 LUFS integrated, −1 dBTP.
- **Vertical cut:** recomposed from real captures of the app's mobile layout (432×768 at 2.5×), not cropped from the landscape version.
- **Previous version:** v1 is kept in `previous/`.

## What changed from v1 (review feedback)

- **Features highlighted.** The reel now has two dedicated sections for what makes the app different:
  - **Chug analyzer** (Jeffrey's Rule): a real upload → "Analyzing your chug…" → AI grade + roast, then the Recent Chugs feed and the leaderboard.
  - **Rule customization:** Commissioner Tools hub → Scoring Rules, with a value typed live and saved.
- **Framing.** Every shot now shows the full screen, with at most ~4–6% gentle drift. All macro close-ups were removed. The Gamecast → Fantasy Impact move is a pan, not a zoom. Titles sit on a soft shade so they never cover the feature being shown.
- **Tagline** changed to **YOUR LEAGUE. YOUR RULES.**
- **`/weekend` page** is still excluded, per earlier direction.

## Story and timestamps (identical timing in both cuts; 120 BPM grid)

| Time | Section | Shot (all real app UI, full screen) |
|---|---|---|
| 0:00–0:08 | Anticipation | Black and a heartbeat, then the real signed-out intro: **WELCOME / TO / THE / WEEKEND League**. The live ticker runs underneath, and the app's own light-switch and pour sounds play. |
| 0:08–0:12 | The world | The whole home dashboard floating in 3D: tickers, Jeffrey's Rule chug countdown, live games. |
| 0:12–0:14 | Drop | **GAME DAY** |
| 0:14–0:16 | Game day | The matchup page: 112.7 vs 118.9, The Grudge, win probability. |
| 0:16–0:21 | Game day | Gamecast: red zone, then the **Kelce TD on the downbeat at 0:19** (KC 27→34). |
| 0:21–0:24 | Game day | Pan down to **Fantasy Impact** refreshing your players' points. **EVERY POINT MATTERS** |
| 0:24–0:26 | Game day | The matchup flips: 112.7 → 131.1, win probability 60% → 97%. |
| 0:26–0:32 | The league | League chat live: "KELCE. 36 YEARS OLD." 🔥7, a typing indicator, then "I'm going to be sick" 😂9. **YOUR LEAGUE. LIVE.** |
| 0:32–0:44 | **Chug analyzer** | **SCORE ZERO? YOU CHUG.** The video is uploaded, "Analyzing your chug…" shows, and the **🍺 Grade 8.7/10 lands on the downbeat at 0:36** (5.3s · smoothness 9.1 · hype 8.4, "Paid down a chug", AI roast). **AI-GRADED CHUGS.** Then the Recent Chugs feed with roasts, and the leaderboard with owed/fine chips and commissioner "Mark paid" actions. |
| 0:44–0:54 | **Rule customization** | **YOUR LEAGUE. YOUR RULES.** The Commissioner Tools hub (all 9 tools), then Scoring Rules. **QB Tackle is typed 5 → 15** (**CUSTOM SCORING.**), the kicking rules show (FG 0.1/yard, missed-FG penalties by distance), and **Save → "Saved."** lands at 0:52. |
| 0:54–0:56 | The league | Weekly awards and the AI-written weekly recap. |
| 0:56–0:58 | Montage | Four beat-cut flashes: TD, chug grade, saved rules, chat. |
| 0:58–1:05 | Final | **THE WEEKEND** ignites in crimson neon. **YOUR LEAGUE. YOUR RULES.** Then fade to black. |

Not shown:
- **Lounge / watch party:** it needs real live video, which I won't fake.
- **Draft room:** out of season.
- **Hardcoded `/rules` rulebook:** it's your real league's text, including money and betting details.

## Demo data (fictional; nothing real, nothing private)

- **League:** "The Sunday Syndicate", with 12 invented owners.
- **Chug content:** all chug grades, roasts and leaderboard rows are invented.
- **Scoring values:** these mirror your league's real adoptions (QB tackle 15, FG 0.1/yard, missed-FG −5/−3/−1/0). The QB-tackle value starts at 5 in the demo so it can be typed to 15 on camera.
- **Uploaded file:** the upload is a 2-second black placeholder named `marcus-week4-chug.mov`. The UI never shows the video itself, and the mock returns the grade after a simulated 2.6s analysis.
- **Production:** no production data or services were touched.

## Tools and method

- **Capture:** the real Next.js frontend (production build) pointed at a local mock API with WebSockets (`pipeline/mock.mjs`, `pipeline/data.mjs`). The Gamecast TD, chat messages, chug upload/grade and scoring-rules save all go through the app's real code paths.
- **Recording:** Playwright + Chromium, with real 1080p screencasts (`--force-device-scale-factor`) and full-page 3× stills.
  - `capture_all.mjs` covers intro, home, gamecast, chat and stills.
  - `capture_features.mjs` covers chug and commissioner.
- **Compositing:** `comp.html` is rendered frame by frame at 60 fps. The edit is in `edl_v2.js`, copied to `edl_h.js` / `edl_v.js`; one file serves both formats.
- **Audio:** `synth2.py` is the v1 instrument set (`synth.py`) with the v2 timeline (`timeline_v2.py`). It includes the app's own intro sounds, a half-time groove for the chug section, a scan-to-hit build into the grade reveal, and keystroke clicks plus a save chime.
- **Encoding:** ffmpeg. No project dependencies were added and no app code was changed.

## Regenerating

Same steps as before (see the v1 section below), plus:

```bash
node capture_features.mjs h && node capture_features.mjs v   # chug + commissioner clips
python3 index_clips.py
cp edl_v2.js edl_h.js && cp edl_v2.js edl_v.js
node render.mjs h 60 frames_h && node render.mjs v 60 frames_v
python3 synth2.py score2.wav 65.0
# encode each with score2.wav (loudnorm I=-14:TP=-1)
```

If you recapture, re-detect the event times at the top of `edl_v2.js` (`EV`: TD, IMPACT, CHUG, TYPE, SAVED) and keep them on the same downbeats (19.0, 22.5, 36.0, 48.5, 52.0).

### Base pipeline (from v1)

```bash
ln -s /path/to/Better_Fantasy_App/frontend/node_modules node_modules
echo '{"step":0}' > demo-state.json; mkdir -p clips stills
node mock.mjs &
(cd /path/to/frontend && NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8799 npx next build \
   && NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8799 npx next start -p 3100 &)
node capture_all.mjs h intro,home,stills,gamecast,chat
node capture_all.mjs v intro,home,stills,gamecast,chat
python3 -m http.server 8811 --bind 127.0.0.1 &
# ...render/encode as above, then rebuild the frontend with your normal env:
(cd /path/to/frontend && npx next build)
```

## Housekeeping

- **Git:** everything is in `Documentation/Marketing/Showreel/`, untracked, and nothing was committed. Add `*.mp4` to `.gitignore` or host the videos elsewhere before committing this folder.
- **Build restored:** `frontend/.next` was rebuilt with your normal environment after capturing.

## Unrelated issues noticed (not fixed)

1. **Chat typing indicator overlaps the last message's reaction pill.**
2. **League chat is always titled "Weekend League"** instead of the active league's name.
3. **Naming:** the app says "WEEKEND League", while the brand direction is THE WEEKEND.
4. **`/weekend` is still reachable** in the current build.
5. **Scoring Rules `qb_tackle` hint** wraps into a long block that pushes its input out of line at desktop width. Cosmetic.
