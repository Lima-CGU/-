# Nutrition data

Calorie calculation uses two tables. `backend/nutrition-db.js` queries
**foods1000 first, then TFND**.

| | foods1000 | TFND |
|---|---|---|
| What | the teacher's 1000-item food table | TFDA 食品營養成分資料庫 |
| Public? | **NO — private.** Never in this repo. | Yes (open data) |
| Where | Firestore (`foods1000_chunks`, `foods1000_meta`) | `tfnd.json` (this folder) |
| Values | **per one unit** of the food (one 碗 / 份 / 個 …; `weightG` grams) | **per 100 g** |

## foods1000 (private — not in this repo)

The teacher-provided table **must not be made public**. This repo is public
and GitHub Pages publishes every file in it, so neither the spreadsheet nor
anything converted from it may ever be committed (`.gitignore` blocks
`*.xls`, `*.xlsx`, `foods1000*.json`). It lives only in Firestore, and the
source file stays outside the repo at
`C:\code\pictameal-private\foods-1000.xls`.

- **Firestore** (project in the service-account key): `foods1000_chunks/chunk_000 … chunk_004`
  (≤ 200 foods each, `{ index, count, items }`) and `foods1000_meta/current`
  (`count`, `chunkIds`, `sourceFile`, `uploadedAt`, the sheet's unit list and legend).
  Firestore security rules deny all client access (`allow read, write: if false`),
  so only the backend's service account can read it — keep it that way.
- **Fields per food**: `id` (編號), `name`, `unit`, `unitMin`/`unitMax`/`unitStep` (始/末/間距),
  `category`/`subcategory`/`categoryGroup`, `weightText` (raw, e.g. `130(EP)`, `-`, `缺`) +
  `weightG` (parsed number or null) + `weightBasis` (`EP` 可食重量 / `AP` 購買時重量 / null),
  `kcal`, `carbohydrateG`, `proteinG`, `fatG`, `cholesterolMg`, `sodiumMg`, and `exchanges`
  (主食, 豆魚肉蛋 低/中/高脂, 油脂, 奶 脫/低/全脂, 蔬菜, 水果 代換份數).
  Following the sheet's own legend: `-` (未分析) → null, `Tr` (微量) → 0, `26*` → 26;
  the original text of any such cell is kept in `nutrientText`.
- **Re-upload** (overwrites the previous upload; stale chunks are deleted):

  ```bash
  cd backend
  npm install                      # includes the dev-only xls reader
  node scripts/upload-foods1000.js # reads C:\code\pictameal-private\foods-1000.xls
  # or: node scripts/upload-foods1000.js D:\path\to\foods-1000.xls
  ```

  It writes nothing to disk (the xls is parsed in memory), prints counts only,
  and refuses to read a spreadsheet located inside the repo.
- **Server**: `nutrition-db.init()` runs at startup and loads foods1000 into
  memory once (≈ 5 Firestore document reads). If that fails it logs the
  reason and continues with TFND only. No endpoint returns the table.
- **Credentials**: env `FIREBASE_SERVICE_ACCOUNT` (the whole key JSON as one
  string) — on Render; otherwise `backend/firebase-key.json` (local only,
  git-ignored). See `backend/firebase-admin-init.js`.

## TFND

`tfnd.json` is built from Taiwan's official **食品營養成分資料庫 (Taiwan Food
Nutrient Database, TFND)**, published by 衛生福利部食品藥物管理署 (TFDA).

| | |
|---|---|
| Source | TFDA open data, 政府資料開放平臺 dataset [8543](https://data.gov.tw/dataset/8543) — `data.fda.gov.tw` InfoId=20, CSV export (`logType=2`) |
| Version | TFDA's consumer site lists the current release as **食品營養成分資料庫 2025版 UPDATE1** (page dated 2026/4/30). The open-data export used here is file `20_2.csv`, timestamped 2026-08-26 inside the zip (catalogue metadata updated 2026-08-27; refreshed every 3 months). This is the official current export, not the 2015 copies circulating on GitHub. |
| Downloaded | 2026-10-01 → `raw/tfnd_InfoId20_csv_2026-10-01.zip` |
| Records | **2,180 foods**, from 226,720 rows (the CSV is a long table: one row per food × nutrient) |
| License | **政府資料開放授權條款-第1版** (Open Government Data License, version 1.0) — free use including commercial, with attribution to the provider (衛生福利部食品藥物管理署). |

## Calorie field

Every food has one calorie number to use: **`per100g.kcal`** = **修正熱量** (corrected
energy) when present, otherwise 熱量. In this release 修正熱量 is present for all
2,180 foods, so `kcal` is always 修正熱量 (`per100g.kcalSource` says which was used).
Both raw values are kept as `energyKcal` (熱量) and `energyCorrectedKcal` (修正熱量).

## Record format

All nutrient values are **per 100 g edible portion** (每100克含量); a value
that TFND leaves blank is `null` (protein 30, fat 50, sodium 51 foods).

```json
{
  "id": "B0700201",              // 整合編號
  "name": "馬鈴薯",              // 樣品名稱
  "aliases": ["洋芋", "洋薯"],    // 俗名, split on commas
  "category": "澱粉類",          // 食品分類
  "description": "樣品狀態:生,黃皮種; 前處理描述:去皮,混合均勻打碎",  // 內容物描述 (raw/cooked etc.)
  "per100g": {
    "kcal": 74, "kcalSource": "修正熱量",
    "energyKcal": 77, "energyCorrectedKcal": 74,
    "proteinG": 2.6, "fatG": 0.2, "carbohydrateG": 15.8, "sodiumMg": 3
  }
}
```

TFND items used: 熱量 / 修正熱量 (kcal), 粗蛋白 (g), 粗脂肪 (g), 總碳水化合物 (g), 鈉 (mg).
`description` is included because many foods only differ by raw vs cooked.

## Rebuilding

```bash
cd backend
node scripts/build-tfnd.js --download   # fetch the current official zip into data/raw/, then build
node scripts/build-tfnd.js              # rebuild from the newest zip/csv already in data/raw/
node scripts/test-nutrition-db.js 白飯 雞蛋   # eyeball lookups
```

The script needs no npm packages. It checks the expected column names and
units, and stops with an error if TFDA changes the file layout.

Raw files: the downloaded zip (~3 MB) is committed so the build is
reproducible; the extracted CSV (~62 MB) is git-ignored. If a future zip
exceeds 20 MB, don't commit it — download it with `--download` instead.

## Lookup

`backend/nutrition-db.js` → `searchFoods(name, { limit, source })`. Order:
foods1000 (exact, then partial) → TFND (exact, then partial) → foods1000
"core-word" guess → TFND "core-word" guess; the first step with a hit wins.
Each result says its `source` (`foods1000` / `tfnd`) and `basis`
(`perUnit` with `unit` + `weightG`, or `per100g`). Partial matches prefer
foods where the keyword is the name's head noun (紅砂糖 over 砂糖橘), then
TFND's 「平均值」 entries. `matchType: 'core-word'` means only a piece of the
name matched (e.g. 蘋果切片 → 蘋果) — treat it as a guess.

Known limits: TFND is ingredient-level. It has no generic 「豬肉」 entry (pork is
listed by cut, e.g. 豬絞肉平均值, 豬後腿肉), no 白砂糖 (only 紅砂糖 / 黑砂糖), and
only dry/fresh noodles (乾麵條 347 kcal) — no cooked noodles. Mixed dishes
(番茄炒蛋, 煎餃, 雞腿便當) are not in either table as such.
