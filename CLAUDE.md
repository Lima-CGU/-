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

## Backend

Main file: `backend/server.js`

- `OPENAI_MODEL` is read from the environment and passed directly as `model: OPENAI_MODEL` to the OpenAI Chat Completions API.
- `gpt-4.1` is the currently verified working model.
- `gpt-5.6-sol` and `gpt-5.6-terra` previously failed in the deployed test; do not assume they are available without checking the OpenAI project/model access.
- `/api/recognize` recognizes one cropped dish.
- `/api/detect` detects multiple dishes and returns percentage-based boxes.
- Detection uses a strict food-only prompt and conservative box normalization/padding. It is still approximate GPT bounding-box detection, not pixel-accurate segmentation.
- An optional external segmentation adapter exists through `SEGMENTATION_API_URL` and `SEGMENTATION_API_KEY`. If configured and it returns boxes, `/api/detect` prefers those boxes; otherwise it falls back to OpenAI detection.
- `sharp` is installed for the coarse local fallback image-processing heuristic.

## Environment

Required on the backend deployment:

```env
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-4.1
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
- The cache name is currently `pictameal-shell-v2`.
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
