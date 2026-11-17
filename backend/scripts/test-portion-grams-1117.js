/**
 * Teacher 11/14–11/15: grams typed / written / said for a dish, and food
 * homophones (殭屍 → 薑絲). Made-up items only (no foods1000 data).
 *   node backend/scripts/test-portion-grams-1117.js
 */
const assert = require('assert');
require.cache[require.resolve('../firebase-admin-init.js')] = { exports: { getFirestore: () => { throw new Error('no firestore in tests'); } } };
const fd = require('../field-defaults');
const vm = require('../../voice-match');
const calc = require('../nutrition-calc');
const est = require('../nutrition-estimate');
const chat = require('../chat');
const records = require('../records');
let fails = 0;
const t = (name, fn) => { try { fn(); console.log('ok  ', name); } catch (e){ fails += 1; console.log('FAIL', name, '-', e.message); } };

/* grams in a food text */
t('parseGrams: 鴨肉180克 / 高麗菜 50g / 薑絲5公克 / no grams', () => {
  assert.deepStrictEqual(fd.parseGrams('鴨肉180克'), { name: '鴨肉', grams: 180, raw: '鴨肉180克' });
  assert.deepStrictEqual(fd.parseGrams('高麗菜 50g'), { name: '高麗菜', grams: 50, raw: '高麗菜 50g' });
  assert.deepStrictEqual(fd.parseGrams('薑絲5公克'), { name: '薑絲', grams: 5, raw: '薑絲5公克' });
  assert.deepStrictEqual(fd.parseGrams('鴨肉'), { name: '鴨肉', grams: null, raw: '鴨肉' });
});
t('parseGrams: not sure = no change', () => {
  assert.strictEqual(fd.parseGrams('180克').grams, null);            // no food name left
  assert.strictEqual(fd.parseGrams('飯3000克').grams, null);         // over 2000
  assert.strictEqual(fd.parseGrams('鴨肉180克高麗菜50克').grams, null); // two amounts
  assert.strictEqual(fd.parseGrams('雞腿 1.5 克').grams, null);           // not a whole gram
  assert.strictEqual(fd.parseGrams('飯兩百克').grams, 200);              // spoken numerals
  assert.strictEqual(fd.parseGrams('飯一百零五克').grams, 105);
  assert.strictEqual(fd.parseGrams('雞腿一點五克').grams, null);
  assert.deepStrictEqual([fd.parseGrams('鴨肉大概180克左右').name, fd.parseGrams('180克的鴨肉').name], ['鴨肉', '鴨肉']);
  assert.strictEqual(fd.parseGrams('豬肉１２０公克').grams, 120);
});
t('splitFoods: several foods in one send, each with its own grams', () => {
  const each = t => fd.splitFoods(t).map(x => { const p = fd.parseGrams(x); return [p.name, p.grams]; });
  assert.deepStrictEqual(each('薑絲5克以及青蔥'), [['薑絲', 5], ['青蔥', null]]);
  assert.deepStrictEqual(each('鴨肉180克、高麗菜50克'), [['鴨肉', 180], ['高麗菜', 50]]);
  assert.deepStrictEqual(each('薑絲和青蔥'), [['薑絲', null], ['青蔥', null]]);
  assert.deepStrictEqual(each('只有鴨肉'), [['只有鴨肉', null]]);
  assert.deepStrictEqual(fd.splitFoods('鴨肉'), ['鴨肉']);
  assert.deepStrictEqual(fd.splitFoods('1,000克米飯'), ['1000克米飯']); // a thousands comma is not a separator
  // protected words: their 和 / 及 is not a separator
  assert.deepStrictEqual(fd.splitFoods('鮭魚和風沙拉'), ['鮭魚和風沙拉']);
  assert.deepStrictEqual(fd.splitFoods('和牛漢堡和薯條'), ['和牛漢堡', '薯條']);
  assert.deepStrictEqual(fd.splitFoods('及第粥'), ['及第粥']);
  assert.deepStrictEqual(fd.splitFoods('和菓子跟和式煎餅'), ['和菓子', '和式煎餅']);
  // 和牛 only as the first word of a food; 及第 not inside 以及
  assert.deepStrictEqual(fd.splitFoods('豬肉和牛肉'), ['豬肉', '牛肉']);
  assert.deepStrictEqual(fd.splitFoods('雞肉和牛奶'), ['雞肉', '牛奶']);
  assert.deepStrictEqual(fd.splitFoods('薯條和和牛漢堡'), ['薯條', '和牛漢堡']);
  assert.deepStrictEqual(fd.splitFoods('白飯以及第二碗湯'), ['白飯', '第二碗湯']);
  // homophones are fixed before splitting: 殭屍5克以及青蔥 -> 薑絲 5 克 + 青蔥
  assert.deepStrictEqual(fd.splitFoods(vm.fixFoodWords('殭屍5克以及青蔥', { foodInput: true }).text), ['薑絲5克', '青蔥']);
});
t('gramsIn: every amount said', () => assert.deepStrictEqual(fd.gramsIn('飯大概200克，青菜50g'), [200, 50]));

/* food homophones */
t('fixFoodWords: 殭屍 / 僵屍 → 薑絲 anywhere', () => {
  assert.strictEqual(vm.fixFoodWords('殭屍').text, '薑絲');
  assert.strictEqual(vm.fixFoodWords('僵屍').text, '薑絲');
  assert.strictEqual(vm.fixFoodWords('殭屍以及青蔥').text, '薑絲以及青蔥');
  assert.deepStrictEqual(vm.fixFoodWords('殭屍').fixes, [{ from: '殭屍', to: '薑絲' }]);
});
t('fixFoodWords: 輕鬆 / 青松 → 青蔥 in a food box, or as a list item in a sentence', () => {
  assert.strictEqual(vm.fixFoodWords('輕鬆', { foodInput: true }).text, '青蔥');
  assert.strictEqual(vm.fixFoodWords('青松', { foodInput: true }).text, '青蔥');
  assert.strictEqual(vm.fixFoodWords('加了薑絲和輕鬆').text, '加了薑絲和青蔥');
  assert.strictEqual(vm.fixFoodWords('我吃得很輕鬆').text, '我吃得很輕鬆'); // a real word: kept
  assert.strictEqual(vm.fixFoodWords('九成塔').text, '九層塔');
  assert.strictEqual(vm.fixFoodWords('炒青菜').changed, false);
});

/* calculation */
const per100 = { name: '測試白飯', basis: 'per100g', weightG: 100, kcal: 180, proteinG: 3, fatG: 0.3, carbohydrateG: 40, sodiumMg: 1, category: 'food' };
const bowl = { name: '測試飯', basis: 'perUnit', unit: '碗', weightG: 200, kcal: 280, category: 'food' };
const piece = { name: '測試雞腿', basis: 'perUnit', unit: '隻', kcal: 200, category: 'food' };
t('grams replace food type × size (per 100 g item)', () => {
  const a = calc.compute(per100, { foodType: 'staple', size: 'M', salt: null });
  const b = calc.compute(per100, { foodType: 'staple', size: 'M', salt: null, portionGrams: 240 });
  assert.notStrictEqual(a.amount, 240);
  assert.deepStrictEqual([b.status, b.amount, b.kcal, b.portionGramsUsed], ['ok', 240, 432, true]);
});
t('grams with a per-unit item of known weight: grams ÷ its weight', () => {
  const r = calc.compute(bowl, { foodType: 'staple', size: 'L', salt: null, portionGrams: 100 });
  assert.deepStrictEqual([r.kcal, r.portionGramsUsed], [140, true]);
});
t('grams but a per-piece item without weight: size / count as before; no size = needs-portion', () => {
  assert.strictEqual(calc.compute(piece, { foodType: 'protein', size: null, salt: null, portionGrams: 100 }).status, 'needs-portion');
  const r = calc.compute(piece, { foodType: 'protein', size: 'M', salt: null, portionGrams: 100, count: 2, countUnit: '隻' });
  assert.deepStrictEqual([r.kcal, r.portionGramsUsed], [400, false]);
});
t('/api/nutrition validation: portionGrams 1–2000, size optional with grams', () => {
  assert.ok(est.validate({ name: '飯', size: 'M', portionGrams: 0 }).error);
  assert.ok(est.validate({ name: '飯', size: 'M', portionGrams: 2001 }).error);
  assert.ok(est.validate({ name: '飯', portionGrams: 200 }).input);
  assert.ok(est.validate({ name: '飯' }).error);
  assert.strictEqual(est.validate({ name: '飯', size: 'M', portionGrams: 200 }).input.portionGrams, 200);
});

/* B/C: grams only when the user said them */
const dishes = [{ no: 1, name: '白飯', category: 'food', foodType: 'staple', applicable: ['size'], fields: {}, fieldSource: {}, seasoningsApply: false }];
t('chat: 「飯大概200克」 -> portionGrams 200 on that dish', () => {
  const v = chat.validate({ reply: '好的。', updates: [{ no: 1, fields: { portionGrams: 200 } }] }, dishes, 'B', null, { message: '飯大概200克' });
  assert.strictEqual(v.updates[0].fields.portionGrams, 200);
});
t('chat: grams the user did not say are dropped (no guessing)', () => {
  const v = chat.validate({ reply: '好的。', updates: [{ no: 1, fields: { portionGrams: 250, size: 'M' } }] }, dishes, 'B', null, { message: '飯吃了一碗' });
  assert.strictEqual(v.updates[0].fields.portionGrams, undefined);
  assert.strictEqual(v.updates[0].fields.size, 'M');
});
t('chat: a new dish 「鴨肉180克」 -> name 鴨肉 + portionGrams', () => {
  const v = chat.validate({ reply: '好的。', newDishes: [{ name: '鴨肉180克', category: 'food', fields: {} }] }, dishes, 'B', null, { message: '還有鴨肉180克', scenario: 2 });
  assert.deepStrictEqual([v.newDishes[0].name, v.newDishes[0].fields.portionGrams, v.newDishes[0].scenario], ['鴨肉', 180, 2]);
});
t('chat: the prompt tells the AI about grams and food homophones', () => {
  const m = chat.buildMessages(chat.parseRequest({ group: 'B', dishes: [{ no: 1, name: '白飯', fields: { portionGrams: 200 } }], message: 'x' }));
  assert.ok(m[0].content.includes('portionGrams') && m[0].content.includes('殭屍/僵屍'));
  assert.ok(m[1].content.includes('重量:200 公克'));
});

/* CSV: new columns appended, old ones unchanged */
t('CSV: portionGrams / portionGramsSource / portionGramsUsed / inputText at the end', () => {
  const r = { id: 'm-test-1117-0001', pid: 'DEVTEST', group: 'A', times: {}, dishes: [
    { name: '鴨肉', inputText: '鴨肉180克', detail: { size: 'M', portionGrams: 180 }, fieldSource: { portionGrams: 'user' }, nutrition: { status: 'ok', kcal: 300, portionGramsUsed: true } },
    { name: '炒青菜', detail: { size: 'M', portionGrams: null } }] };
  const rows = records.toCsv([r]).replace(/^﻿/, '').split(/\r?\n/);
  const head = rows[0].split(',');
  assert.deepStrictEqual(head.slice(-4), ['portionGrams', 'portionGramsSource', 'portionGramsUsed', 'inputText']);
  assert.strictEqual(head.indexOf('userActionCount'), 13); // an old column keeps its place
  const cell = (row, k) => rows[row].split(',')[head.indexOf(k)];
  assert.deepStrictEqual(['portionGrams', 'portionGramsSource', 'portionGramsUsed', 'inputText'].map(k => cell(1, k)), ['180', 'user', 'true', '鴨肉180克']);
  assert.deepStrictEqual(['portionGrams', 'portionGramsSource'].map(k => cell(2, k)), ['', '']);
});
if (fails){ console.log(`${fails} failed`); process.exit(1); }
console.log('all passed');
