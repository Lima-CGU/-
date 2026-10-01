/**
 * Nutrition lookup for calorie calculation, over two sources:
 *
 *  - foods1000: the teacher's PRIVATE 1000-item table, stored in Firestore
 *    (scripts/upload-foods1000.js). Values are PER ONE UNIT of the food
 *    (one 碗 / 份 / 個 … of that food, weightG grams). Loaded once into memory by init() — queries
 *    never hit Firestore. Never expose the whole table through an API.
 *  - tfnd: the public TFDA 食品營養成分資料庫 (data/tfnd.json,
 *    scripts/build-tfnd.js). Values are PER 100 g; kcal = 修正熱量
 *    (or 熱量 when missing).
 *
 *   const nutrition = require('./nutrition-db');
 *   await nutrition.init();                 // at server start; never throws
 *   nutrition.searchFoods('白飯')            // foods1000 first, tfnd only if none
 *
 * Each result: { source: 'foods1000'|'tfnd', basis: 'perUnit'|'per100g',
 *   name, matchType, matchedOn, id, category, unit, weightG, weightText,
 *   kcal, proteinG, fatG, carbohydrateG, sodiumMg }
 * (unit/weightG are the serving for foods1000; for tfnd unit is '100g').
 *
 * Matching (same rules for both; foods1000 has no 俗名):
 *   1. exact name, 2. exact alias              (完全相符)
 *   3. name contains the keyword,
 *   4. an alias contains it,                   (部分相符)
 *   5. the keyword contains a whole name/alias (e.g. "番茄炒蛋" ⊃ "番茄")
 *   6. last resort, 'core-word': a >= 2-char piece of the keyword that is
 *      some food's head noun (see coreWordMatch) — a guess, check it
 * Within a tier:
 *   a. the keyword is the name's HEAD noun — Chinese food names put it
 *      last, so "紅砂糖" is a 砂糖 but "砂糖橘" is a 橘, "雞蛋(白殼)" is a
 *      雞蛋 but "雞蛋麵" is a 麵: the keyword ends the name, or is followed
 *      only by 平均值 / a "(…)" qualifier;
 *   b. TFND's own 「平均值」 (representative average) entries;
 *   c. the name starts with the keyword;
 *   d. shorter (more generic) name, then id — so results are stable.
 */
'use strict';

const path = require('path');

const TFND_FILE = path.join(__dirname, 'data', 'tfnd.json');
const FOODS1000_CHUNKS = 'foods1000_chunks';
const FOODS1000_META = 'foods1000_meta';

let tfnd = null;
let foods1000 = null; // null until init() has loaded it
const status = { foods1000: 'not loaded', foods1000Count: 0, foods1000Error: null, tfndCount: 0 };

/* ---------- loading ---------- */

function loadTfnd(){
  if (!tfnd){
    const raw = require(TFND_FILE);
    tfnd = {
      meta: raw.meta,
      entries: raw.foods.map(f => ({
        id: f.id,
        name: f.name,
        aliases: f.aliases,
        nName: normalize(f.name),
        nAliases: f.aliases.map(normalize).filter(Boolean),
        food: f
      }))
    };
    status.tfndCount = tfnd.entries.length;
  }
  return tfnd;
}

let initPromise = null;

/**
 * Loads foods1000 from Firestore into memory (once). Never throws: on any
 * failure it logs why and the module keeps working with tfnd only.
 */
function init(){
  if (!initPromise) initPromise = (async () => {
    loadTfnd();
    try {
      const { getFirestore } = require('./firebase-admin-init');
      const { db, projectId } = getFirestore();
      const [metaSnap, chunkSnap] = await Promise.all([
        db.collection(FOODS1000_META).doc('current').get(),
        db.collection(FOODS1000_CHUNKS).get()
      ]);
      if (!metaSnap.exists) throw new Error(`${FOODS1000_META}/current not found in project "${projectId}" — run scripts/upload-foods1000.js`);
      const meta = metaSnap.data();
      const items = chunkSnap.docs
        .sort((a, b) => (a.get('index') ?? 0) - (b.get('index') ?? 0))
        .flatMap(d => d.get('items') || []);
      if (items.length !== meta.count){
        throw new Error(`foods1000 has ${items.length} items in ${chunkSnap.size} chunks but meta says ${meta.count} — re-run the upload`);
      }
      foods1000 = items.map(f => ({ id: f.id, name: f.name, aliases: [], nName: normalize(f.name), nAliases: [], food: f }));
      status.foods1000 = 'loaded';
      status.foods1000Count = foods1000.length;
      status.foods1000Error = null;
      console.log(`[nutrition] foods1000: ${foods1000.length} foods loaded from Firestore (uploaded ${meta.uploadedAtIso || '?'}); tfnd: ${status.tfndCount} foods`);
    } catch (err){
      foods1000 = null;
      status.foods1000 = 'unavailable';
      status.foods1000Error = err.message;
      console.error(`[nutrition] foods1000 NOT loaded — continuing with tfnd only (${status.tfndCount} foods). Reason: ${err.message}`);
    }
  })();
  return initPromise;
}

function getStatus(){
  return { ...status };
}

/* ---------- matching ---------- */

// Full-width ASCII -> half-width, drop whitespace, lower-case.
function normalize(s){
  return String(s || '')
    .replace(/[！-～]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .replace(/[\s　]+/g, '')
    .toLowerCase();
}

const TIERS = [
  { type: 'exact-name',        test: (e, k) => e.nName === k ? e.name : null },
  { type: 'exact-alias',       test: (e, k) => e.aliases.find((a, i) => e.nAliases[i] === k) || null },
  { type: 'name-contains',     test: (e, k) => e.nName.includes(k) ? e.name : null },
  { type: 'alias-contains',    test: (e, k) => e.aliases.find((a, i) => e.nAliases[i].includes(k)) || null },
  // only names/aliases of >= 2 characters, so a 1-char alias can't match everything
  { type: 'keyword-contains',  test: (e, k) => (e.nName.length >= 2 && k.includes(e.nName)) ? e.name
      : (e.aliases.find((a, i) => e.nAliases[i].length >= 2 && k.includes(e.nAliases[i])) || null) }
];
const EXACT = new Set(['exact-name', 'exact-alias']);

// What may follow the keyword for it to still be the name's head noun.
const HEAD_TAIL = /^(平均值)?([(（].*[)）])?$/;

function rankKey(e, k){
  const at = e.nName.indexOf(k);
  const isHead = at >= 0 && HEAD_TAIL.test(e.nName.slice(at + k.length)) ? 0 : 1;
  const isAverage = e.nName.includes('平均值') ? 0 : 1;
  const isPrefix = at === 0 ? 0 : 1;
  return [isHead, isAverage, isPrefix, e.name.length];
}

function compareRank(a, b){
  for (let i = 0; i < a.key.length; i++){
    if (a.key[i] !== b.key[i]) return a.key[i] - b.key[i];
  }
  return String(a.e.id).localeCompare(String(b.e.id), 'en', { numeric: true });
}

const HEAD_AT = (name, sub) => {
  for (let at = name.indexOf(sub); at >= 0; at = name.indexOf(sub, at + 1)){
    if (HEAD_TAIL.test(name.slice(at + sub.length))) return true;
  }
  return false;
};

// Last resort when nothing matches strictly: the longest piece of the
// keyword (>= 2 chars; at equal length, the one nearest the END — Chinese
// head nouns come last) that is the head noun of some food's name, or one
// of its 俗名. E.g. (TFND) "蘋果切片" -> 蘋果 -> 蘋果平均值.
// A guess — reported as matchType 'core-word'.
function coreWordMatch(entries, k, limit){
  for (let len = k.length - 1; len >= 2; len--){
    for (let start = k.length - len; start >= 0; start--){
      const sub = k.slice(start, start + len);
      const hits = entries
        .filter(e => HEAD_AT(e.nName, sub) || e.nAliases.includes(sub))
        .map(e => ({ e, matchType: 'core-word', matchedOn: sub, key: rankKey(e, sub) }));
      if (hits.length) return hits.sort(compareRank).slice(0, limit);
    }
  }
  return [];
}

function matchIn(entries, k, limit){
  const results = [];
  const seen = new Set();
  for (const tier of TIERS){
    const hits = [];
    for (const e of entries){
      if (seen.has(e.id)) continue;
      const matchedOn = tier.test(e, k);
      if (matchedOn) hits.push({ e, matchType: tier.type, matchedOn, key: rankKey(e, k) });
    }
    hits.sort(compareRank);
    for (const h of hits){
      seen.add(h.e.id);
      results.push(h);
      if (results.length >= limit) return results;
    }
  }
  return results;
}

/* ---------- result shapes ---------- */

function fromFoods1000({ e, matchType, matchedOn }){
  const f = e.food;
  return {
    source: 'foods1000', basis: 'perUnit',
    id: f.id, name: f.name, matchType, matchedOn,
    category: [f.category, f.subcategory].filter(Boolean).join(' / '),
    unit: f.unit, weightG: f.weightG, weightText: f.weightText, weightBasis: f.weightBasis,
    kcal: f.kcal, proteinG: f.proteinG, fatG: f.fatG, carbohydrateG: f.carbohydrateG, sodiumMg: f.sodiumMg
  };
}

function fromTfnd({ e, matchType, matchedOn }){
  const f = e.food;
  const n = f.per100g;
  return {
    source: 'tfnd', basis: 'per100g',
    id: f.id, name: f.name, matchType, matchedOn,
    category: f.category, description: f.description,
    unit: '100g', weightG: 100, weightText: '100', weightBasis: null,
    kcal: n.kcal, proteinG: n.proteinG, fatG: n.fatG, carbohydrateG: n.carbohydrateG, sodiumMg: n.sodiumMg
  };
}

/* ---------- search ---------- */

/**
 * Order: foods1000 (exact, then partial) -> tfnd (exact, then partial) ->
 * foods1000 core-word guess -> tfnd core-word guess. The first step with
 * any hit wins, so results come from one source only, best first; a real
 * tfnd match beats a guessed foods1000 one. If foods1000 isn't loaded, its
 * steps are skipped.
 * @param {string} keyword  dish / food name, e.g. "白飯"
 * @param {{limit?: number, source?: 'foods1000'|'tfnd'}} [opts]  source forces one table
 */
function searchFoods(keyword, opts = {}){
  const limit = opts.limit ?? 5;
  const k = normalize(keyword);
  if (!k) return [];
  const useF = opts.source !== 'tfnd' && !!foods1000;
  const useT = opts.source !== 'foods1000';
  const steps = [
    useF && (() => matchIn(foods1000, k, limit).map(fromFoods1000)),
    useT && (() => matchIn(loadTfnd().entries, k, limit).map(fromTfnd)),
    useF && (() => coreWordMatch(foods1000, k, limit).map(fromFoods1000)),
    useT && (() => coreWordMatch(loadTfnd().entries, k, limit).map(fromTfnd))
  ].filter(Boolean);
  for (const step of steps){
    const hits = step();
    if (hits.length) return hits;
  }
  return [];
}

function isExactMatch(result){
  return !!result && EXACT.has(result.matchType);
}

function getTfndMeta(){
  return loadTfnd().meta;
}

module.exports = { init, getStatus, searchFoods, isExactMatch, getTfndMeta, normalize };
