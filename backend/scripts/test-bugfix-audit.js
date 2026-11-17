/**
 * Bugs found in the site-wide audit (11/17). Made-up items only.
 *   node backend/scripts/test-bugfix-audit.js
 */
const assert = require('assert');
const V = require('../../voice-match');
const fd = require('../field-defaults');
const est = require('../nutrition-estimate');
const calc = require('../nutrition-calc');
let fails = 0;
const t = (name, fn) => { try { fn(); console.log('ok  ', name); } catch (e){ fails += 1; console.log('FAIL', name, '-', e.message); } };

t('voice count: decimals and numbers outside 1–50 are not a count', () => {
  for (const s of ['3.5個', '1.5', '2.5顆', '三點五個', '100', '七十']) assert.strictEqual(V.count(s), null, s);
  assert.deepStrictEqual(['三隻', '12隻', '十二隻', '50', '全部'].map(V.count), [3, 12, 12, 50, 'all']);
});
t('speech homophones: ordinary sentences stay as they are', () => {
  for (const s of ['我真的吃了牛肉', '這個真的很好吃的', '沙拉有很多顏色', '多研究', '一分熟的牛排']) assert.strictEqual(V.fixHomophones(s).text, s, s);
  assert.deepStrictEqual(['真的雞', '少言', '吵青菜', '半唐', '大分', '針的白菜'].map(s => V.fixHomophones(s).text),
    ['蒸的雞', '少鹽', '炒青菜', '半糖', '大份', '蒸的白菜']);
});
t('seasoning 其他 with a full-width colon', () => assert.deepStrictEqual(fd.cleanSeasonings(['其他：辣椒醬']), ['辣椒醬']));
t('grams: a thousands comma, never the tail of a longer number', () => {
  assert.deepStrictEqual([fd.parseGrams('雞肉1,500克').name, fd.parseGrams('雞肉1,500克').grams], ['雞肉', 1500]);
  assert.strictEqual(fd.parseGrams('雞肉1,500克').raw, '雞肉1,500克'); // the text as typed
  assert.deepStrictEqual(fd.gramsIn('雞肉1,500克'), [1500]);
  assert.strictEqual(fd.parseGrams('牛肉100500克').grams, null);
  assert.strictEqual(fd.parseGrams('牛肉2千克').grams, null);
  assert.deepStrictEqual(fd.gramsIn('牛肉100500克'), []);
  assert.strictEqual(fd.parseGrams('鴨肉180克').grams, 180);
});
t('/api/nutrition: prototype keys are not table values', () => {
  assert.ok(est.validate({ name: 'x', size: 'M', salt: 'constructor' }).error);
  assert.ok(est.validate({ name: 'x', size: 'toString' }).error);
  const item = { name: '測試飯', basis: 'per100g', weightG: 100, kcal: 150, category: 'food' };
  const r = calc.compute(item, { foodType: 'staple', size: 'M', salt: null, cookingMethod: 'constructor' });
  assert.strictEqual(r.status, 'ok');
  assert.ok(Number.isFinite(r.kcal));
  assert.strictEqual(calc.compute(item, { foodType: 'constructor', size: 'M', salt: null }).status, 'ok');
});
if (fails){ console.log(`${fails} failed`); process.exit(1); }
console.log('all passed');
