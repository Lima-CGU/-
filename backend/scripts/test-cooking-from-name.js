/**
 * Tests for field-defaults.js cookingFromName (the cooking word in a dish
 * name, with the exception list: 炸醬 is not 炸, 紅燒 is not 燒烤 …).
 *   node backend/scripts/test-cooking-from-name.js
 */
'use strict';
const assert = require('assert');
const { cookingFromName } = require('../field-defaults');

const CASES = [
  ['炸雞腿', '炸'], ['炒高麗菜', '炒'], ['乾煎魚', '煎'], ['清蒸魚', '蒸'],
  ['燒烤雞', '燒烤'], ['烤雞腿', '烤'], ['水煮蛋', '水煮'], ['滷蛋', '滷'],
  ['生魚片', '生食'], ['白飯', ''],
  // 燙 / 汆燙 / 川燙 = 水煮 (10/23)
  ['燙青菜', '水煮'], ['清燙肉片', '水煮'], ['汆燙花枝', '水煮'], ['川燙地瓜葉', '水煮'],
  // the reported dish: its cooking preset is 炒
  ['甜椒炒香腸', '炒'],
  // exceptions
  ['炸醬麵', ''], ['炸醬', ''], ['紅燒牛肉麵', ''], ['烤麩', ''], ['燒賣', ''],
  // an exception does not hide another real cooking word
  ['炸醬炒飯', '炒'], ['紅燒烤肉', '烤']
];
let failed = 0;
for (const [name, want] of CASES){
  const got = cookingFromName(name, 'food');
  try { assert.strictEqual(got, want); console.log(`ok   ${name} -> ${JSON.stringify(got)}`); }
  catch (e){ failed += 1; console.log(`FAIL ${name} -> ${JSON.stringify(got)} (want ${JSON.stringify(want)})`); }
}
// beverages use their own words
assert.strictEqual(cookingFromName('現榨柳橙汁', 'beverage'), '現榨');
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
