/**
 * Tests for field-defaults.js guessFoodType (food type from a dish name):
 * a name with both vegetable and starchy-staple words (玉米, 地瓜, 馬鈴薯) is a
 * vegetable; 玉米濃湯 stays soup; 玉米 alone / 玉米飯 are staples.
 *   node backend/scripts/test-guess-food-type.js
 */
'use strict';
const assert = require('assert');
const { guessFoodType } = require('../field-defaults');

const CASES = [
  ['玉米炒蔬菜丁', 'vegetable'], ['三色蔬菜', 'vegetable'], ['玉米濃湯', 'soup'],
  ['玉米', 'staple'], ['玉米飯', 'staple'], ['烤地瓜', 'staple'], ['白飯', 'staple'],
  ['青菜炒飯', 'staple'], ['地瓜葉', 'vegetable'], ['茶葉蛋', 'protein'], ['炒地瓜葉', 'vegetable'], ['川燙地瓜葉', 'vegetable'], ['甜椒炒香腸', 'protein'], ['燙青菜', 'vegetable'], ['蘋果', 'fruit']
];
let failed = 0;
for (const [name, want] of CASES){
  const got = guessFoodType(name, 'food');
  try { assert.strictEqual(got, want); console.log(`ok   ${name} -> ${got}`); }
  catch (e){ failed += 1; console.log(`FAIL ${name} -> ${got} (want ${want})`); }
}
assert.strictEqual(guessFoodType('玉米汁', 'beverage'), 'beverage');
// tea leaves are not a vegetable (no category given)
assert.notStrictEqual(guessFoodType('桑葉茶'), 'vegetable');
assert.notStrictEqual(guessFoodType('茶葉'), 'vegetable');
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
