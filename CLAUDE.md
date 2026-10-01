# PICTAMEAL Project Handoff

## Project

PICTAMEAL is a mobile-first food diary web app. The frontend is plain HTML/CSS/JavaScript. The backend is Node.js + Express and proxies OpenAI requests so the API key stays server-side.

Repository: `https://github.com/Lima-CGU/-.git`
Branch: `main`

## Current Status

- Core flow is implemented: start -> camera/library upload -> review -> AI recognition -> confirm dishes -> save meal record.
- Camera access uses `navigator.mediaDevices.getUserMedia`; photo-library upload is also supported.
- Food recognition and bounding-box detection use the backend API.
- Voice food-name correction uses the browser Web Speech API with text fallback.
- Detail adjustment supports container type, portion size, cooking method, sugar, and salt.
- Mobile layout uses a full-viewport app surface; desktop shows a phone-style frame.
- PWA support is enabled with `manifest.json`, icons, and `sw.js`.
- The A/start screen currently shows only the PICTAMEAL title, illustration, start button, and tutorial link. The Home icon, Home label, and introductory copy were removed.
- The latest UI pass harmonized background, purple primary actions, teal completion states, radii, borders, and shadows.

## Research Study Groups

The app is used in a two-arm study: **Group A** (traditional — report with buttons/options) and **Group B** (conversational — report by chatting with AI).

- Group comes from the URL: `?group=A` or `?group=B` (case-insensitive); missing or anything else = `A`. Read once at startup into `STUDY_GROUP` (`script.js`). Only the URL is consulted — nothing is persisted.
- The group must NEVER be shown on screen (no labels, no switcher) — participants must not learn another group exists. It is only written into data: each meal record in `mealRecords` has `group`, and its Diary card carries `data-group` (not displayed).
- Note: the PWA `start_url` is `./index.html` with no query, so a participant launching from the home-screen icon gets the default `A`. Hand out the full `?group=` link and have participants use it (or handle this before relying on installed-PWA launches).
- Page flow: Page 1 start and Page 2 camera are identical for both groups; Page 3 (`data-screen="recognize"`) is identical for both; only Page 4 differs. Page 4 is not built yet — both groups currently go to the existing Diary screen (`data-screen="diary"`); Group B's chat page comes later.
- Local testing: `npx serve` redirects `/index.html?group=B` to `/index` and DROPS the query — test with `/?group=B` (GitHub Pages serves `index.html?group=B` fine).

## Page 3 (recognize screen) — read-only "initial result"

- `RECOGNIZE_PREVIEW_ONLY = true` (`script.js`) + the `.recognize-preview` class on the screen make it view-only for both groups: after `/api/detect`, each dish shows a numbered marker (`.det-marker`) at the center of the box the backend returned, with its single-line label (name + smaller, fainter confidence) directly under it. No box outline.
- Hidden (code kept for Page 4, not deleted): confirm dots, × delete, manual + box spawner, low-confidence candidate sheet, auto-advance, "已確認 N" / "還有 N 道菜未確認". Zoom-to-food and the "查看完整照片" toggle are kept.
- The only way forward is "下一步" (`#recognizeNextBtn`, enabled once detection finishes, even with 0 dishes) → `saveCurrentMeal()` → Diary.
- Each det keeps `apiBox` (exactly what `/api/detect` returned, % of the full photo) next to its x/y/w/h (the `normalizeDetectionBox()` display box, which can be enlarged/edge-clamped so its center drifts). Saved dishes store `box` = backend box and `displayBox` = display box; thumbnails still crop from the display box.
- Label placement (`resolveLabelOverlaps`, preview slots): under the marker → one row lower → above → one row higher → right/left of it, each with small sideways nudges; avoids other labels, every marker, and on-photo controls, staying inside the visible photo.

## Backend

Main file: `backend/server.js`

- `OPENAI_MODEL` is read from the environment and passed directly as `model: OPENAI_MODEL` to the OpenAI Chat Completions API.
- `gpt-6.1-sol` is the currently configured model (upgraded from `gpt-4.1`).
- The request body uses `max_completion_tokens`, not `max_tokens`. Every `gpt-5.x`/`gpt-6.x` model rejects `max_tokens` with a 400 `unsupported_parameter` error; `gpt-4.1` and earlier accept `max_completion_tokens` too, so this one param name works across all of them. **This was the actual root cause of the `gpt-5.6-sol`/`gpt-5.6-terra` failures below — not a model-access problem.**
- ~~`gpt-5.6-sol` and `gpt-5.6-terra` previously failed in the deployed test~~ — corrected: both work fine once the request uses `max_completion_tokens`. Verified directly against `/api/detect`'s real prompt. Also verified working (non-reasoning, fast): `gpt-5.5`, `gpt-5.6-luna`, `gpt-6-sol`, `gpt-6-astra`, `gpt-6-luna`. Do not use bare `gpt-5` for this app — it's a reasoning model and burns most of its completion-token budget on hidden reasoning tokens before producing visible output, which is both slower and more expensive for this latency-sensitive per-photo recognition flow.
- `/api/recognize` recognizes one cropped dish.
- `/api/detect` detects multiple dishes and returns percentage-based boxes.
- Detection uses a strict food-only prompt and box normalization/padding. It is still approximate GPT bounding-box detection, not pixel-accurate segmentation. Backend `normalizeDishBox` only enforces 0–100 bounds and a minimum size (the old 48%/52% size caps and 2200 area cap were removed — they shrank large dishes smaller than the food).
- Box percentages are relative to the FULL original photo. The recognize screen shows the photo with `object-fit: contain`, and `layoutRecognizeOverlay()` / `photoRect()` in `script.js` pin `.recognize-overlay` and manual-box coordinates to the photo's actual drawn rectangle. Never switch that image back to `cover` or measure boxes against `recognizeWrap` — boxes would drift toward the center.
- Recognize-screen layout: `#recognizeStage` is the available space; `#recognizeWrap` is the photo frame, sized by `layoutRecognizePhoto()` to the photo's aspect ratio (width-filled; height-filled only if too tall) and centered, clipping overflow. After `/api/detect` returns, `zoomToFood()` zooms the display to the union of all boxes + 8% margin (FLIP animation); `#recognizeZoomToggle` switches between that and the full photo. The zoom is display-only — box coordinates stay % of the full photo, and `photoRect()` reports the full (partly clipped) photo rect so mapping is unchanged.
- Recognize-screen labels are one line (name + confidence), never width-clamped, and placed OUTSIDE the box by default; `resolveLabelOverlaps()` picks the first of above/below (left- or right-aligned, with small sideways nudges) or inside that stays on the photo and avoids other labels, every confirm dot, and the on-photo controls.
- An optional external segmentation adapter exists through `SEGMENTATION_API_URL` and `SEGMENTATION_API_KEY`. If configured and it returns boxes, `/api/detect` prefers those boxes; otherwise it falls back to OpenAI detection.
- `sharp` is installed for the coarse local fallback image-processing heuristic.

## Environment

Required on the backend deployment:

```env
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-6.1-sol
```

Optional:

```env
SEGMENTATION_API_URL=...
SEGMENTATION_API_KEY=...
```

Never commit `backend/.env` or API keys. Render must be configured with the environment variables above and redeployed after changes.

## PWA

- `index.html` registers `./sw.js` on page load.
- `sw.js` caches the app shell and same-origin GET requests only. Cross-origin backend requests are not intercepted.
- The cache name is currently `pictameal-shell-v7`. Bump it on every frontend change (`index.html`/`style.css`/`script.js`/anything else in `APP_SHELL`), otherwise a previously-installed PWA keeps serving the old cached shell instead of picking up the update.
- Service Workers require `https://` or `localhost`; they do not work from `file://`.

## Useful Checks

Run from the repository root:

```powershell
node --check script.js
node --check sw.js
node --check backend/server.js
cd backend; npm install; npm start
```

Serve the frontend locally for PWA testing:

```powershell
npx --yes http-server . -p 4173 -c-1
```

Open `http://localhost:4173/index.html`.

## Editing Guidance

- Preserve the existing plain HTML/CSS/JS architecture; avoid introducing a framework unless explicitly requested.
- Do not expose `OPENAI_API_KEY` in frontend files.
- Keep changes focused and preserve the existing camera, recognition, voice correction, and detail-adjustment flows.
- After frontend changes, test both desktop and a narrow mobile viewport and check for horizontal overflow.
- After backend changes, run syntax checks and exercise `/api/detect` or `/api/recognize` with a valid image.
- Do not add generated test images to commits unless explicitly requested.

## Recent Commits

- `e198435` Harmonize overall UI styling
- `eaf41f5` Simplify start screen
- `6481889` Add installable PWA shell
- `ec1231b` Tighten bounding box detection: stricter prompt and smaller max sizes
- `6be7a14` Improve detection box accuracy and model env support
