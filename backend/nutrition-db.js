/**
 * Lookup into the TFND nutrition table (data/tfnd.json, built by
 * scripts/build-tfnd.js). Values are per 100 g; `per100g.kcal` is the one
 * calorie number to use (修正熱量, or 熱量 when that is missing).
 *
 *   const { searchFoods } = require('./nutrition-db');
 *   searchFoods('白飯')            // -> [{ food, matchType, matchedOn }, ...] best first
 *   searchFoods('雞蛋', { limit: 3 })
 *
 * Matching runs on 樣品名稱 (name) and 俗名 (aliases):
 *   1. exact name, 2. exact alias              (完全相符)
 *   3. name contains the keyword,
 *   4. an alias contains it,                   (部分相符)
 *   5. the keyword contains a whole name/alias (e.g. "番茄炒蛋" ⊃ "番茄")
 * Within a tier the order is:
 *   a. the keyword is the name's HEAD noun — Chinese food names put it
 *      last, so "紅砂糖" is a 砂糖 but "砂糖橘" is a 橘, "雞蛋(白殼)" is a
 *      雞蛋 but "雞蛋麵" is a 麵: the keyword ends the name, or is followed
 *      only by 平均值 / a "(…)" qualifier;
 *   b. TFND's own 「平均值」 (representative average) entries;
 *   c. the name starts with the keyword;
 *   d. shorter (more generic) name, then TFND id — so results are stable.
 */
'use strict';

const path = require('path');

const DB_FILE = path.join(__dirname, 'data', 'tfnd.json');
let db = null;

function load(){
  if (!db){
    const raw = require(DB_FILE);
    db = {
      meta: raw.meta,
      foods: raw.foods.map(f => ({
        food: f,
        nName: normalize(f.name),
        nAliases: f.aliases.map(normalize).filter(Boolean)
      }))
    };
  }
  return db;
}

// Full-width ASCII -> half-width, drop whitespace, lower-case.
function normalize(s){
  return String(s || '')
    .replace(/[！-～]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .replace(/[\s　]+/g, '')
    .toLowerCase();
}

const TIERS = [
  { type: 'exact-name',        test: (e, k) => e.nName === k ? e.food.name : null },
  { type: 'exact-alias',       test: (e, k) => e.food.aliases.find((a, i) => e.nAliases[i] === k) || null },
  { type: 'name-contains',     test: (e, k) => e.nName.includes(k) ? e.food.name : null },
  { type: 'alias-contains',    test: (e, k) => e.food.aliases.find((a, i) => e.nAliases[i].includes(k)) || null },
  // only names/aliases of >= 2 characters, so a 1-char alias can't match everything
  { type: 'keyword-contains',  test: (e, k) => (e.nName.length >= 2 && k.includes(e.nName)) ? e.food.name
      : (e.food.aliases.find((a, i) => e.nAliases[i].length >= 2 && k.includes(e.nAliases[i])) || null) }
];

// What may follow the keyword for it to still be the name's head noun.
const HEAD_TAIL = /^(平均值)?([(（].*[)）])?$/;

function rankKey(e, k){
  const at = e.nName.indexOf(k);
  const isHead = at >= 0 && HEAD_TAIL.test(e.nName.slice(at + k.length)) ? 0 : 1;
  const isAverage = e.nName.includes('平均值') ? 0 : 1;
  const isPrefix = at === 0 ? 0 : 1;
  return [isHead, isAverage, isPrefix, e.food.name.length];
}

function compareRank(a, b){
  for (let i = 0; i < a.key.length; i++){
    if (a.key[i] !== b.key[i]) return a.key[i] - b.key[i];
  }
  return a.food.id.localeCompare(b.food.id);
}

/**
 * @param {string} keyword  Chinese food name, e.g. "白飯"
 * @param {{limit?: number, category?: string}} [opts]
 * @returns {{food: object, matchType: string, matchedOn: string}[]}
 */
function searchFoods(keyword, opts = {}){
  const limit = opts.limit ?? 5;
  const k = normalize(keyword);
  if (!k) return [];
  const { foods } = load();
  const pool = opts.category ? foods.filter(e => e.food.category === opts.category) : foods;

  const results = [];
  const seen = new Set();
  for (const tier of TIERS){
    const hits = [];
    for (const e of pool){
      if (seen.has(e.food.id)) continue;
      const matchedOn = tier.test(e, k);
      if (matchedOn) hits.push({ food: e.food, matchType: tier.type, matchedOn, key: rankKey(e, k) });
    }
    hits.sort(compareRank);
    for (const { key, ...h } of hits){
      seen.add(h.food.id);
      results.push(h);
      if (results.length >= limit) return results;
    }
  }
  return results;
}

/** Look up one food by its 整合編號 (TFND id). */
function getFoodById(id){
  const e = load().foods.find(x => x.food.id === id);
  return e ? e.food : null;
}

function getMeta(){
  return load().meta;
}

module.exports = { searchFoods, getFoodById, getMeta, normalize };
