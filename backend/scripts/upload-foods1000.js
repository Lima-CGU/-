#!/usr/bin/env node
/**
 * Upload the teacher's 1000-item food table (PRIVATE — never commit it or
 * anything derived from it) to Firestore.
 *
 *   node scripts/upload-foods1000.js [path/to/foods-1000.xls]
 *   (default C:\code\pictameal-private\foods-1000.xls, or env FOODS1000_XLS)
 *
 * Reads the .xls straight into memory and writes ONLY to Firestore — no
 * file is written anywhere. Prints counts, never record contents.
 *
 * Firestore layout (re-running overwrites; stale chunks are deleted):
 *   foods1000_chunks/chunk_000 … : { index, count, items: [ …~200 foods ] }
 *   foods1000_meta/current       : { count, chunkCount, chunkIds, sourceFile,
 *                                    uploadedAt, units, legend, ... }
 * Every value is per ONE unit of the food (e.g. 白飯 1 碗), not per 100 g.
 *
 * Credentials: see firebase-admin-init.js (env FIREBASE_SERVICE_ACCOUNT,
 * else backend/firebase-key.json).
 */
'use strict';

const path = require('path');
const fs = require('fs');
const { getFirestore } = require('../firebase-admin-init');

const DEFAULT_XLS = 'C:\\code\\pictameal-private\\foods-1000.xls';
const CHUNK_SIZE = 200;
const MAX_DOC_BYTES = 900 * 1024; // Firestore limit is 1 MiB; keep headroom
const CHUNKS = 'foods1000_chunks';
const META = 'foods1000_meta';

// 食材 sheet, by column position (rows 2–3 hold the headers, row 1 is junk).
const COL = {
  id: 0, name: 1, unit: 2, unitMin: 3, unitMax: 4, unitStep: 5,
  category: 6, subcategory: 7, categoryGroup: 8, weight: 9,
  kcal: 10, carbohydrateG: 11, proteinG: 12, fatG: 13, cholesterolMg: 14, sodiumMg: 15,
  exGrains: 16, exProteinLow: 17, exProteinMid: 18, exProteinHigh: 19, exFat: 20,
  exMilkSkim: 21, exMilkLow: 22, exMilkWhole: 23, exVegetable: 24, exFruit: 25
};
// Header text expected at row 2 / row 3 for a few columns — guards against a
// changed layout silently shifting every field.
const EXPECT_HEADER = { 2: '單位', 9: '重量', 10: '熱量', 11: '醣類', 12: '蛋白質', 13: '脂肪', 15: '鈉', 16: '主食類', 24: '蔬菜類', 25: '水果類' };
const EXPECT_HEADER_ROW3 = { 17: '低脂', 18: '中脂', 19: '高脂', 21: '脫脂', 22: '低脂', 23: '全脂' };

function text(v){
  return v === null || v === undefined ? '' : String(v).trim();
}

// A sheet number: a number, or numeric text. Per the sheet's own legend,
// 「-」 = not analyzed -> null; 「Tr」 = trace -> 0 ("Tf" is a typo of it);
// a trailing annotation like "26*" -> 26. Anything else -> null.
function parseNumber(v){
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = text(v);
  if (!s || s === '-' || s === '缺') return null;
  if (/^t[rf]$/i.test(s)) return 0;
  const m = /^(-?\d+(?:\.\d+)?)\s*\*?$/.exec(s);
  return m ? Number(m[1]) : null;
}

// 重量: "200", "130(EP)", "350(AP)", "-", "缺" -> number + EP/AP basis
function parseWeight(v){
  if (typeof v === 'number') return { weightG: v, weightBasis: null };
  const s = text(v);
  const m = /^(\d+(?:\.\d+)?)\s*(?:[(（]\s*(EP|AP)\s*[)）])?$/i.exec(s);
  return m ? { weightG: Number(m[1]), weightBasis: m[2] ? m[2].toUpperCase() : null } : { weightG: null, weightBasis: null };
}

function readSheet(file){
  const XLSX = require('xlsx'); // devDependency: only this local script needs it
  const wb = XLSX.readFile(file);
  for (const s of ['食材', '食材單位']){
    if (!wb.Sheets[s]) throw new Error(`sheet "${s}" not found (sheets: ${wb.SheetNames.join(', ')})`);
  }
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['食材'], { header: 1, raw: true, defval: null });
  for (const [c, want] of Object.entries(EXPECT_HEADER)){
    if (!text(rows[1][c]).includes(want)) throw new Error(`unexpected header in column ${Number(c) + 1}: "${text(rows[1][c])}" (expected "${want}") — layout changed?`);
  }
  for (const [c, want] of Object.entries(EXPECT_HEADER_ROW3)){
    if (text(rows[2][c]) !== want) throw new Error(`unexpected sub-header in column ${Number(c) + 1}: "${text(rows[2][c])}" (expected "${want}")`);
  }

  const items = [];
  const legend = [];
  for (const r of rows.slice(3)){
    if (!r.some(v => text(v) !== '')) continue;
    // rows with a name but no 編號 are the sheet's legend notes
    if (text(r[COL.id]) === ''){
      if (text(r[COL.name])) legend.push(text(r[COL.name]));
      continue;
    }
    const id = parseNumber(r[COL.id]);
    const nutrientText = {};
    const num = key => {
      const raw = r[COL[key]];
      if (typeof raw !== 'number' && text(raw) !== '') nutrientText[key] = text(raw);
      return parseNumber(raw);
    };
    const w = parseWeight(r[COL.weight]);
    const note = r.slice(26).map(text).filter(Boolean).join(' ');
    const item = {
      id,
      name: text(r[COL.name]),
      unit: text(r[COL.unit]),
      unitMin: parseNumber(r[COL.unitMin]),
      unitMax: parseNumber(r[COL.unitMax]),
      unitStep: parseNumber(r[COL.unitStep]),
      category: text(r[COL.category]),
      subcategory: text(r[COL.subcategory]),
      categoryGroup: text(r[COL.categoryGroup]),
      weightText: text(r[COL.weight]),
      weightG: w.weightG,
      weightBasis: w.weightBasis,
      kcal: num('kcal'),
      carbohydrateG: num('carbohydrateG'),
      proteinG: num('proteinG'),
      fatG: num('fatG'),
      cholesterolMg: num('cholesterolMg'),
      sodiumMg: num('sodiumMg'),
      exchanges: {
        grains: parseNumber(r[COL.exGrains]),
        proteinLowFat: parseNumber(r[COL.exProteinLow]),
        proteinMediumFat: parseNumber(r[COL.exProteinMid]),
        proteinHighFat: parseNumber(r[COL.exProteinHigh]),
        fat: parseNumber(r[COL.exFat]),
        milkSkim: parseNumber(r[COL.exMilkSkim]),
        milkLowFat: parseNumber(r[COL.exMilkLow]),
        milkWhole: parseNumber(r[COL.exMilkWhole]),
        vegetable: parseNumber(r[COL.exVegetable]),
        fruit: parseNumber(r[COL.exFruit])
      }
    };
    if (Object.keys(nutrientText).length) item.nutrientText = nutrientText;
    // keep the raw text of the range columns when they weren't plain numbers
    const rangeText = {};
    for (const k of ['unitMin', 'unitMax', 'unitStep']){
      const raw = r[COL[k]];
      if (typeof raw !== 'number' && text(raw) !== '' && parseNumber(raw) === null) rangeText[k] = text(raw);
    }
    if (Object.keys(rangeText).length) item.rangeText = rangeText;
    if (note) item.note = note;
    if (!item.name) throw new Error(`row with 編號 ${text(r[COL.id])} has no name`);
    items.push(item);
  }

  const ids = items.map(i => i.id);
  if (ids.some(i => i === null)) throw new Error('a 編號 is not a number');
  if (new Set(ids).size !== ids.length) throw new Error('duplicate 編號');

  const units = XLSX.utils.sheet_to_json(wb.Sheets['食材單位'], { header: 1, raw: true, defval: null })
    .filter(r => text(r[1]))
    .map(r => ({ id: parseNumber(r[0]), name: text(r[1]) }));

  return { items, units, legend };
}

async function main(){
  const file = process.argv[2] || process.env.FOODS1000_XLS || DEFAULT_XLS;
  if (!fs.existsSync(file)) throw new Error(`file not found: ${file}`);
  const repoRoot = path.resolve(__dirname, '..', '..');
  if (path.resolve(file).toLowerCase().startsWith(repoRoot.toLowerCase() + path.sep)){
    throw new Error(`refusing to read ${file}: the private food table must live OUTSIDE the repo (${repoRoot})`);
  }

  const { items, units, legend } = readSheet(file);
  const chunks = [];
  for (let i = 0; i < items.length; i += CHUNK_SIZE) chunks.push(items.slice(i, i + CHUNK_SIZE));
  chunks.forEach((c, i) => {
    const bytes = Buffer.byteLength(JSON.stringify(c));
    if (bytes > MAX_DOC_BYTES) throw new Error(`chunk ${i} would be ${bytes} bytes (> ${MAX_DOC_BYTES}); lower CHUNK_SIZE`);
  });

  const { db, projectId, source } = getFirestore();
  console.log(`parsed ${items.length} foods, ${units.length} units, ${legend.length} legend notes -> ${chunks.length} chunks`);
  console.log(`uploading to Firestore project "${projectId}" (credentials: ${source})`);

  const chunkIds = chunks.map((_, i) => `chunk_${String(i).padStart(3, '0')}`);
  const existing = await db.collection(CHUNKS).listDocuments();
  const stale = existing.filter(ref => !chunkIds.includes(ref.id));

  // one atomic batch: new chunks + meta + removal of chunks a smaller table no longer needs
  const batch = db.batch();
  chunks.forEach((items, i) => {
    batch.set(db.collection(CHUNKS).doc(chunkIds[i]), { index: i, count: items.length, items });
  });
  stale.forEach(ref => batch.delete(ref));
  const { FieldValue } = require('firebase-admin/firestore');
  batch.set(db.collection(META).doc('current'), {
    count: items.length,
    chunkCount: chunks.length,
    chunkSize: CHUNK_SIZE,
    chunkIds,
    sourceFile: path.basename(file),
    uploadedAt: FieldValue.serverTimestamp(),
    uploadedAtIso: new Date().toISOString(),
    basis: 'per unit (每一單位, see each item.unit / weightG)',
    units,
    legend
  });
  await batch.commit();

  // read back the counts to confirm
  const meta = (await db.collection(META).doc('current').get()).data();
  const back = await db.collection(CHUNKS).get();
  const stored = back.docs.reduce((n, d) => n + (d.get('count') || 0), 0);
  console.log(`done: meta.count=${meta.count}, ${back.size} chunk docs holding ${stored} foods` +
    (stale.length ? `, removed ${stale.length} stale chunk(s)` : ''));
  if (stored !== items.length) throw new Error(`read-back mismatch: stored ${stored}, expected ${items.length}`);
}

main().catch(err => {
  console.error('upload-foods1000 failed:', err.message);
  process.exit(1);
});
