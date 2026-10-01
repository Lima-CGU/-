#!/usr/bin/env node
/**
 * Build backend/data/tfnd.json from the official Taiwan Food Nutrient
 * Database (食品營養成分資料庫, TFND) open-data download.
 *
 *   node scripts/build-tfnd.js              use the newest zip/csv in data/raw/
 *   node scripts/build-tfnd.js --download   fetch the official zip first, then build
 *   node scripts/build-tfnd.js <file.zip|file.csv>
 *
 * Source: 衛福部食藥署 open data, 政府資料開放平臺 InfoId=20 (CSV, logType=2).
 * The CSV is a "long" table — one row per (food, nutrient) — so it is
 * pivoted here to one record per food, keeping only the fields the calorie
 * feature needs, per 100 g of edible portion.
 *
 * Pure Node (no dependencies): the single-entry zip is read with zlib.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const DATA_DIR = path.join(__dirname, '..', 'data');
const RAW_DIR = path.join(DATA_DIR, 'raw');
const OUT_FILE = path.join(DATA_DIR, 'tfnd.json');
const DOWNLOAD_URL = 'https://data.fda.gov.tw/opendata/exportDataList.do?method=ExportData&InfoId=20&logType=2';

// TFND analysis items (分析項) -> output field. All are 每100克含量.
const FIELDS = {
  '熱量': 'energyKcal',
  '修正熱量': 'energyCorrectedKcal',
  '粗蛋白': 'proteinG',
  '粗脂肪': 'fatG',
  '總碳水化合物': 'carbohydrateG',
  '鈉': 'sodiumMg'
};

/* ---------- input ---------- */

async function download(){
  fs.mkdirSync(RAW_DIR, { recursive: true });
  console.log('downloading', DOWNLOAD_URL);
  const res = await fetch(DOWNLOAD_URL);
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.readUInt32LE(0) !== 0x04034b50) throw new Error('download is not a zip file');
  const file = path.join(RAW_DIR, `tfnd_InfoId20_csv_${today()}.zip`);
  fs.writeFileSync(file, buf);
  console.log(`saved ${path.relative(process.cwd(), file)} (${(buf.length / 1048576).toFixed(1)} MB)`);
  return file;
}

function newestRawFile(){
  if (!fs.existsSync(RAW_DIR)) return null;
  const files = fs.readdirSync(RAW_DIR)
    .filter(f => /\.(zip|csv)$/i.test(f))
    .map(f => path.join(RAW_DIR, f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  // prefer a zip (the actual download) over an extracted csv
  return files.find(f => /\.zip$/i.test(f)) || files[0] || null;
}

// Minimal reader for a zip holding one CSV (stored or deflated).
function readCsvFromZip(file){
  const buf = fs.readFileSync(file);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--){
    if (buf.readUInt32LE(i) === 0x06054b50){ eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip file (no end-of-central-directory record)');
  const entries = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < entries; n++){
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad zip central directory');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (!/\.csv$/i.test(name)) continue;
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const start = localOff + 30 + lNameLen + lExtraLen;
    const data = buf.subarray(start, start + compSize);
    if (method === 0) return { name, text: data.toString('utf8') };
    if (method === 8) return { name, text: zlib.inflateRawSync(data).toString('utf8') };
    throw new Error(`unsupported zip compression method ${method}`);
  }
  throw new Error('no .csv file inside the zip');
}

/* ---------- CSV ---------- */

// RFC 4180 style: quoted fields, "" escapes, CRLF or LF.
function* parseCsv(text){
  let row = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++){
    const c = text[i];
    if (quoted){
      if (c === '"'){
        if (text[i + 1] === '"'){ cur += '"'; i++; }
        else quoted = false;
      } else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ','){ row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r'){
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      if (row.length > 1 || row[0] !== '') yield row;
      row = [];
    } else cur += c;
  }
  if (cur !== '' || row.length){ row.push(cur); yield row; }
}

function toNumber(v){
  const s = String(v ?? '').trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function splitAliases(v){
  return String(v || '')
    .split(/[,，、;；]/)
    .map(s => s.trim())
    .filter(Boolean);
}

/* ---------- build ---------- */

function build(csvText, sourceFile){
  const rows = parseCsv(csvText.replace(/^﻿/, ''));
  const header = rows.next().value.map(h => h.trim());
  const col = name => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`column "${name}" not found — has the TFND file layout changed? header: ${header.join(',')}`);
    return i;
  };
  const C = {
    category: col('食品分類'), id: col('整合編號'), name: col('樣品名稱'),
    alias: col('俗名'), desc: col('內容物描述'), group: col('分析項分類'),
    item: col('分析項'), unit: col('含量單位'), per100: col('每100克含量')
  };

  const foods = new Map();
  const units = {};
  let rowCount = 0;
  for (const r of rows){
    rowCount++;
    const id = (r[C.id] || '').trim();
    if (!id) continue;
    let food = foods.get(id);
    if (!food){
      food = {
        id,
        name: (r[C.name] || '').trim(),
        aliases: splitAliases(r[C.alias]),
        category: (r[C.category] || '').trim(),
        description: (r[C.desc] || '').trim(),
        per100g: {}
      };
      foods.set(id, food);
    }
    const field = FIELDS[(r[C.item] || '').trim()];
    if (!field) continue;
    const unit = (r[C.unit] || '').trim();
    units[field] = units[field] || new Set();
    units[field].add(unit);
    food.per100g[field] = toNumber(r[C.per100]);
  }

  // sanity: units must be what the field names promise
  const expectUnit = { energyKcal: 'kcal', energyCorrectedKcal: 'kcal', proteinG: 'g', fatG: 'g', carbohydrateG: 'g', sodiumMg: 'mg' };
  for (const [field, set] of Object.entries(units)){
    const bad = [...set].filter(u => u && u !== expectUnit[field]);
    if (bad.length) throw new Error(`unexpected unit for ${field}: ${bad.join(', ')}`);
  }

  const list = [...foods.values()].map(f => {
    const n = f.per100g;
    // The single calorie value the app uses: 修正熱量 when present, else 熱量.
    const kcal = n.energyCorrectedKcal ?? n.energyKcal ?? null;
    return {
      id: f.id,
      name: f.name,
      aliases: f.aliases,
      category: f.category,
      description: f.description,
      per100g: {
        kcal,
        kcalSource: n.energyCorrectedKcal != null ? '修正熱量' : (n.energyKcal != null ? '熱量' : null),
        energyKcal: n.energyKcal ?? null,
        energyCorrectedKcal: n.energyCorrectedKcal ?? null,
        proteinG: n.proteinG ?? null,
        fatG: n.fatG ?? null,
        carbohydrateG: n.carbohydrateG ?? null,
        sodiumMg: n.sodiumMg ?? null
      }
    };
  }).sort((a, b) => a.id.localeCompare(b.id));

  const missing = Object.fromEntries(Object.values(FIELDS).map(f => [f, list.filter(x => x.per100g[f] == null).length]));
  const usedCorrected = list.filter(x => x.per100g.kcalSource === '修正熱量').length;

  return {
    meta: {
      source: '衛生福利部食品藥物管理署 食品營養成分資料庫 (TFND)',
      sourceUrl: DOWNLOAD_URL,
      datasetPage: 'https://data.gov.tw/dataset/8543',
      license: '政府資料開放授權條款-第1版 (Open Government Data License, version 1.0)',
      sourceFile: path.basename(sourceFile),
      builtAt: new Date().toISOString(),
      unitBasis: 'per 100 g edible portion (每100克含量)',
      kcalField: 'per100g.kcal = 修正熱量 when present, otherwise 熱量',
      foodCount: list.length,
      csvRowCount: rowCount,
      kcalFrom修正熱量: usedCorrected,
      missingValues: missing
    },
    foods: list
  };
}

function today(){
  return new Date().toISOString().slice(0, 10);
}

(async () => {
  const args = process.argv.slice(2);
  let file = args.find(a => !a.startsWith('--'));
  if (args.includes('--download')) file = await download();
  file = file || newestRawFile();
  if (!file) throw new Error(`no input: put the TFND zip/csv in ${RAW_DIR} or run with --download`);

  console.log('reading', path.relative(process.cwd(), file));
  const { text, name } = /\.zip$/i.test(file)
    ? readCsvFromZip(file)
    : { text: fs.readFileSync(file, 'utf8'), name: path.basename(file) };
  console.log('csv', name, `${(Buffer.byteLength(text) / 1048576).toFixed(1)} MB`);

  const out = build(text, file);
  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 1) + '\n');
  console.log(`wrote ${path.relative(process.cwd(), OUT_FILE)}: ${out.meta.foodCount} foods ` +
    `(${(fs.statSync(OUT_FILE).size / 1024).toFixed(0)} KB), kcal from 修正熱量 for ${out.meta.kcalFrom修正熱量}`);
  console.log('missing values per field:', out.meta.missingValues);
})().catch(err => {
  console.error('build-tfnd failed:', err.message);
  process.exit(1);
});
