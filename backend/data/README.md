# Nutrition data (TFND)

`tfnd.json` is the nutrition table used for calorie calculation. It is built
from Taiwan's official **食品營養成分資料庫 (Taiwan Food Nutrient Database,
TFND)**, published by 衛生福利部食品藥物管理署 (TFDA).

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

`backend/nutrition-db.js` → `searchFoods(keyword, { limit, category })` matches
樣品名稱 and 俗名: exact name, exact alias, then partial matches. Partial matches
prefer foods where the keyword is the name's head noun (紅砂糖 over 砂糖橘), then
TFND's own 「平均值」 entries. See the comment at the top of the file.

Known limits: TFND is ingredient-level. It has no generic 「豬肉」 entry (pork is
listed by cut, e.g. 豬絞肉平均值, 豬後腿肉), no 白砂糖 (only 紅砂糖 / 黑砂糖), and
only dry/fresh noodles (乾麵條 347 kcal) — no cooked noodles. Most dish names
(番茄炒蛋, 煎餃) return no match.
