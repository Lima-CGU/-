/**
 * Arithmetic tests for nutrition-calc.js with MADE-UP items (no database):
 * food type × size portions, fruit pieces, oil × count only when the count
 * was used, no oil for 炸醬麵.
 *   node backend/scripts/test-nutrition-calc.js
 */
'use strict';
const assert = require('assert');
const calc = require('../nutrition-calc');
const { defaultsFor } = require('../field-defaults');

const per100 = { name: '測試品項', unit: '100g', basis: 'per100g', kcal: 100, fatG: 1, weightG: 100 };
const perServing = { name: '雞腿', unit: '份', basis: 'perUnit', kcal: 300, fatG: 15, weightG: 150 };
const perPiece = { ...perServing, unit: '隻' };
const tests = [];
const t = (name, fn) => tests.push([name, fn]);

t('food type × size grams (M)', () => {
  const want = { staple: 200, protein: 90, vegetable: 100, soup: 350, snack: 80, beverage: 350, other: 150 };
  for (const [type, g] of Object.entries(want)) assert.strictEqual(calc.compute(per100, { foodType: type, size: 'M' }).amount, g, type);
});
t('a container from an old record is ignored', () => {
  assert.strictEqual(calc.compute(per100, { foodType: 'staple', size: 'L', containerType: 'plate' }).amount, 300);
});
t('fruit: grams per piece × count', () => {
  assert.strictEqual(calc.compute(per100, { foodType: 'fruit', size: 'M', count: 2 }).amount, 300);
});
t('雞腿 ×3 matched to a per-份 item: oil × 1', () => {
  const r = calc.compute(perServing, { foodType: 'protein', size: 'M', cookingMethod: '炒', count: 3, countUnit: '隻' });
  assert.strictEqual(r.countUsed, null);
  assert.strictEqual(r.oilTeaspoons, 1);
});
t('雞腿 ×3 matched to a per-隻 item: oil × 3', () => {
  const r = calc.compute(perPiece, { foodType: 'protein', size: 'M', cookingMethod: '炒', count: 3, countUnit: '隻' });
  assert.strictEqual(r.countUsed, 3);
  assert.strictEqual(r.oilTeaspoons, 3);
});
t('炸醬麵: no cooking preset, no oil', () => {
  const d = defaultsFor('炸醬麵', 'staple', 'food');
  assert.ok(!d.cookingMethod);
  const r = calc.compute({ ...perServing, name: '炸醬麵' }, { foodType: 'staple', size: 'M', cookingMethod: d.cookingMethod || '' });
  assert.strictEqual(r.oilTeaspoons, 0);
});
t('an item named 炸雞腿 already includes its oil', () => {
  assert.strictEqual(calc.oilFor({ ...perServing, name: '炸雞腿' }, { cookingMethod: '炸', size: 'M' }), 0);
});

let failed = 0;
for (const [name, fn] of tests){
  try { fn(); console.log(`ok   ${name}`); } catch (e){ failed += 1; console.log(`FAIL ${name}: ${e.message}`); }
}
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
