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

- `STUDY_GROUP` (`script.js`) is resolved once at startup: (1) `?group=A` / `?group=B` in the URL (case-insensitive) always wins and is saved to `localStorage` key `pictameal:studyGroup`; (2) otherwise the saved value — this is what keeps a participant in their group when launching the home-screen PWA, whose `start_url` has no query; (3) otherwise `A`. Any other `?group=` value is ignored (falls through to 2/3). All storage access is in try/catch, so blocked storage just means URL-or-A. A research assistant switches a device by opening the other `?group=` link.
- The group must NEVER be shown on screen (no labels, no switcher) — participants must not learn another group exists. It is only written into data: each meal record in `mealRecords` has `group`, and its Diary card carries `data-group` (not displayed).
- Page flow: Page 1 start and Page 2 camera are identical for both groups; Page 3 (`data-screen="recognize"`) is identical for both; only Page 4 differs. Group A → Page 4 report screen (`data-screen="report"`, below). Group B → still saves straight to the Diary screen (`data-screen="diary"`); its chat page comes later.
- Group A has no voice (🎤) entry points anywhere: none on Page 4, and `renderDiaryDishRow` skips the mic button when `STUDY_GROUP === 'A'`.
- Local testing: `npx serve` redirects `/index.html?group=B` to `/index` and DROPS the query — test with `/?group=B` (GitHub Pages serves `index.html?group=B` fine).
- Port 5500 is the owner's VS Code Live Server preview — never start or stop anything on it; run test servers on another port (e.g. 5600).
- Do NOT temporarily edit `BACKEND_URL` in `script.js` for testing. Live Server serves the working copy, and `sw.js` is cache-first, so a preview that loads the edited file caches it under the current `CACHE_NAME` and keeps calling the test URL (showing "自動辨識失敗") until the cache name changes. Test against the real Render backend, or intercept requests in Playwright (`page.route`) instead.

## Page 3 (recognize screen) — read-only "initial result"

- `RECOGNIZE_PREVIEW_ONLY = true` (`script.js`) + the `.recognize-preview` class on the screen make it view-only for both groups: after `/api/detect`, each dish shows a numbered marker (`.det-marker`) at the center of the box the backend returned, with its single-line label (name + smaller, fainter confidence) directly under it. No box outline.
- Hidden (code kept for Page 4, not deleted): confirm dots, × delete, manual + box spawner, low-confidence candidate sheet, auto-advance, "已確認 N" / "還有 N 道菜未確認". Zoom-to-food and the "查看完整照片" toggle are kept.
- The only way forward is "下一步" (`#recognizeNextBtn`, enabled once detection finishes, even with 0 dishes) → `saveCurrentMeal()` → Diary.
- Each det keeps `apiBox` (exactly what `/api/detect` returned, % of the full photo) next to its x/y/w/h (the `normalizeDetectionBox()` display box, which can be enlarged/edge-clamped so its center drifts). Saved dishes store `box` = backend box and `displayBox` = display box; thumbnails still crop from the display box.
- Label placement (`resolveLabelOverlaps`, preview slots): a label must read as belonging to its own marker, so it only sits snug directly UNDER its marker (2px gap), shifted sideways by at most 1.5× the marker width (`previewLabelNudges`, smallest shift first), else snug directly ABOVE it the same way. The only further shift allowed is clamping it back inside the visible photo. Placement is greedy, then a small exhaustive search over the labels still in conflict (plus neighbors) repairs dead ends. In very dense photos (e.g. sample-meals 01, 7 dishes) a zero-overlap layout under these rules provably may not exist — then the fewest-overlap layout is used.

- Labels that still collide (or would have to be clamped further than 1.5× the marker width to stay on the photo) after placement get `.det-label-compact` (~15% smaller name, confidence hidden) and placement runs again; all other labels stay full size. Labels show only name + confidence (no filled-in details).

## Page 4, Group A (report screen) — fill in each dish

- Entered from Page 3's "下一步" when `STUDY_GROUP === 'A'` (`enterReportMode()`). The Page 3 photo stage node (`#recognizeStage`) is MOVED into `#reportPhotoSlot`, so the same photo / markers / labels / zoom / coordinate code is reused unchanged; `exitReportMode()` moves it back (also called by `setupRecognizeScreen()` for every new photo). The report screen carries `.recognize-preview` too.
- Top row = the Diary heading (title, count, camera button — camera asks before discarding a half-filled meal).
- Photo area (`#reportPhotoSlot`): full content width, height = width × the photo's aspect ratio, capped at 50% of the Page 4 screen (`sizeReportPhotoSlot()`, re-run on resize / image load); the photo is never cropped. The detail panel below scrolls.
- Markers are tappable on Page 4 with three states: `.marker-empty` (white hollow, not filled), `.marker-active` (green ring, selected), `.marker-done` (solid green — all five fields set). Nothing is selected on entry; the panel shows "點選照片上的菜色開始填寫" until a marker is tapped, then only that dish: thumbnail (cropped from its box), name + small confidence, and the five fields (`containerType`, `size`, `cookingMethod`, `sugar`, `salt`) built from the detail-adjust modal's own option arrays (`containerOptions`, `sizeOptions`, `FOOD_/BEVERAGE_COOKING_METHODS`, `sugarOptions`, `saltOptions`). Values live in `det.detail`, same shape as the modal. On Page 4 every field is a row of small, wrapping buttons like 尺寸 (`.screen-report` overrides; the modal keeps its own layout).
- Rename (pencil): opens the existing candidate sheet immediately (loading), fills up to 3 candidates from `/api/recognize` (`fetchCandidatesForDet`), and lets the user type a name instead (typed name wins; confidence becomes null). A food↔beverage switch drops a cooking method the new list lacks.
- Delete (trash): asks once more inline; the box is removed and markers renumber.
- "+ 新增菜色" (photo bottom-right): next tap on the photo adds a dish — a `MANUAL_BOX_DEFAULT_SIZE` box centered on the tap is cropped and sent to `/api/recognize`; the new marker sits exactly on the tap point (`det.tapPoint`), is auto-selected, and is saved with `source: 'user'`.
- Footer (`updateReportDone()`, re-run on every select / field / rename / add / delete): while any dish is unfilled it shows "已填 N / 總數 道", plus "下一道 ›" once the selected dish is itself filled — that selects the next unfilled dish in marker order, wrapping to the start (`nextUnfilledReportDet()`); tapping markers to jump around still works. Only when every dish is filled does the footer become just "完成". It saves via `saveCurrentMeal()` (record has `group`, each dish has `detail`, `box`, `displayBox`, `source`, `tapPoint`) and goes to the Diary.
- **Calorie hook:** `notifyDishDetailComplete(det, reason)` dispatches `document` event `pictameal:dish-detail-complete` with `{ dishId, name, confidence, category, detail, group, reason }` — `reason: 'completed'` when a dish first gets all five fields, `'changed'` on any later field/name edit while it is still complete. Hang the calorie calculation there.

## Nutrition data (for calorie calculation)

- `backend/data/tfnd.json`: official TFDA 食品營養成分資料庫 (TFND), 2,180 foods, per-100 g kcal / protein / fat / carbs / sodium. Built by `backend/scripts/build-tfnd.js` (`--download` fetches the current official zip; no npm deps). Version, license (政府資料開放授權條款-第1版) and format: `backend/data/README.md`.
- Use `per100g.kcal` as THE calorie value (修正熱量, falling back to 熱量).
- Lookup: `backend/nutrition-db.js` → `searchFoods(keyword)` (exact name → exact 俗名 → partial, preferring head-noun matches and TFND 「平均值」 entries). Not wired into the server or front end yet.
- TFND is ingredient-level: most dish names (番茄炒蛋, 煎餃) don't match, and there is no generic 「豬肉」 entry — the calorie feature will need a dish → ingredient mapping step.

## Backend

Main file: `backend/server.js`

- `OPENAI_MODEL` is read from the environment and passed directly as `model: OPENAI_MODEL` to the OpenAI Chat Completions API.
- `gpt-6.1-sol` is the currently configured model (upgraded from `gpt-4.1`).
- The request body uses `max_completion_tokens`, not `max_tokens`. Every `gpt-5.x`/`gpt-6.x` model rejects `max_tokens` with a 400 `unsupported_parameter` error; `gpt-4.1` and earlier accept `max_completion_tokens` too, so this one param name works across all of them. **This was the actual root cause of the `gpt-5.6-sol`/`gpt-5.6-terra` failures below — not a model-access problem.**
- ~~`gpt-5.6-sol` and `gpt-5.6-terra` previously failed in the deployed test~~ — corrected: both work fine once the request uses `max_completion_tokens`. Verified directly against `/api/detect`'s real prompt. Also verified working (non-reasoning, fast): `gpt-5.5`, `gpt-5.6-luna`, `gpt-6-sol`, `gpt-6-astra`, `gpt-6-luna`. Do not use bare `gpt-5` for this app — it's a reasoning model and burns most of its completion-token budget on hidden reasoning tokens before producing visible output, which is both slower and more expensive for this latency-sensitive per-photo recognition flow.
- `gpt-6.1-sol` does NOT accept `temperature` other than the default 1 (400 `unsupported_value` for 0.2), so `/api/detect` and `/api/recognize` send no temperature. Re-check before adding one after a model change.
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
- The cache name is currently `pictameal-shell-v10`. Bump it on every frontend change (`index.html`/`style.css`/`script.js`/anything else in `APP_SHELL`), otherwise a previously-installed PWA keeps serving the old cached shell instead of picking up the update.
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
