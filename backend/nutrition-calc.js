/**
 * Pure calorie arithmetic for ONE dish, following the teacher's
 * 「熱量計算功能總結」. No I/O, no AI. Every number it uses lives in
 * nutrition-config.js.
 *
 *   discrete unit (份/碗/個/…):  total = database value × size multiplier
 *   gram / millilitre unit:      total = database value ÷ weight basis × amount served
 *   protein / fat / carbohydrate use the same factor as calories
 *   sodium (mg) = item sodium × the same factor + salt teaspoons × 2358
 *   cooking method and sugar are recorded only — they never change a number
 *   kcal per gram above MAX_KCAL_PER_GRAM -> status 'anomaly' (no numbers)
 */
'use strict';

const cfg = require('./nutrition-config');

const round = (n, d = 0) => { const m = 10 ** d; return Math.round(n * m) / m; };
const isNum = v => typeof v === 'number' && Number.isFinite(v);

function sizeMultiplier(category, size){
  const set = cfg.SIZE_MULTIPLIERS.byCategory[category] || cfg.SIZE_MULTIPLIERS.default;
  return set[size];
}

function saltTeaspoons(salt){
  return cfg.SALT_TEASPOONS[String(salt || '').replace(/\s+/g, '')];
}

function isContinuous(item){
  return item.basis === 'per100g' || cfg.CONTINUOUS_UNIT.test(String(item.unit || ''));
}

// "公克(g)" -> "公克", "個(小7*5)" -> "個"
const unitLabel = u => String(u || '').replace(/[(（].*$/, '').trim();

/**
 * @param item   a nutrition-db search result (the one the AI picked)
 * @param input  { containerType, size, salt }
 * @returns {{status:'ok'|'anomaly'|'unsupported', ...}}
 */
function compute(item, input){
  const salt = saltTeaspoons(input.salt);
  if (salt === undefined) return { status: 'unsupported', reason: 'salt' };
  if (!isNum(item.kcal)) return { status: 'unsupported', reason: 'no-kcal' };

  let factor, grams, basisKind, amount = null, amountUnit = null, multiplier = null, how, formula;
  const itemUnit = unitLabel(item.unit);

  if (isContinuous(item)){
    const portion = cfg.PORTION_TABLE[input.containerType];
    const served = portion && portion[input.size];
    const base = item.weightG;
    if (!isNum(served) || !isNum(base) || base <= 0) return { status: 'unsupported', reason: 'no-portion' };
    basisKind = 'continuous';
    amount = served;
    amountUnit = portion.unit;
    factor = served / base;
    grams = served;
    const baseUnit = item.basis === 'per100g' ? '公克' : (itemUnit || '公克');
    const baseU = /毫升|ml|c\.?c/i.test(itemUnit) ? 'ml' : 'g';
    formula = `每 ${base}${baseU} ${item.kcal} kcal × ${served}${amountUnit}`;
    how = `以「${item.name}」每 ${base} ${baseUnit}為基準,` +
      `${cfg.CONTAINER_LABELS[input.containerType]} ${input.size} 約 ${served} ${amountUnit === 'ml' ? '毫升' : '公克'}` +
      `(÷ ${base} × ${served})`;
  } else {
    const m = sizeMultiplier(item.category, input.size);
    if (!isNum(m)) return { status: 'unsupported', reason: 'size' };
    basisKind = 'discrete';
    multiplier = m;
    factor = m;
    grams = isNum(item.weightG) && item.weightG > 0 ? item.weightG * m : null;
    formula = `${item.name} 1 ${itemUnit} ${item.kcal} kcal × ${input.size} ${m} 倍`;
    how = `以「${item.name} 1 ${itemUnit}」為基準,尺寸 ${input.size} × ${m}`;
  }

  const kcal = item.kcal * factor;
  const perGram = grams ? kcal / grams : null;
  if (perGram !== null && perGram > cfg.MAX_KCAL_PER_GRAM){
    return { status: 'anomaly', perGram: round(perGram, 2), grams: round(grams, 1) };
  }

  const scale = v => (isNum(v) ? round(v * factor, 1) : null);
  const itemSodium = isNum(item.sodiumMg) ? item.sodiumMg * factor : 0;
  const sodiumMg = round(itemSodium + salt * cfg.SODIUM_MG_PER_TEASPOON);
  if (salt > 0) how += `;鹽 ${String(input.salt).replace(/\s+/g, '')} → 鈉 +${round(salt * cfg.SODIUM_MG_PER_TEASPOON)} mg`;

  return {
    status: 'ok',
    kcal: round(kcal),
    proteinG: scale(item.proteinG),
    fatG: scale(item.fatG),
    carbohydrateG: scale(item.carbohydrateG),
    sodiumMg,
    sodiumItemMissing: !isNum(item.sodiumMg),
    basisKind, multiplier, amount, amountUnit,
    explanation: how,
    formula
  };
}

module.exports = { compute, saltTeaspoons, sizeMultiplier, isContinuous };
