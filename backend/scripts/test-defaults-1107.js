/**
 * Teacher 11/07: a dish whose name has no cooking word starts at 水煮, and
 * 調味 starts at 沒有特別調味 — every group, incl. scenario-added foods.
 *   node backend/scripts/test-defaults-1107.js
 */
const assert = require('assert');
const fd = require('../field-defaults');
let fails = 0;
const t = (name, fn) => { try { fn(); console.log('ok  ', name); } catch (e){ fails += 1; console.log('FAIL', name, '-', e.message); } };

t('no cooking word -> 水煮 (鴨肉, 高麗菜, 白飯, 荷包蛋)', () => {
  for (const name of ['鴨肉', '高麗菜', '白飯', '荷包蛋', '鴨肉180克']){
    const type = fd.guessFoodType(name, 'food');
    assert.strictEqual(fd.defaultsFor(name, type, 'food').cookingMethod, '水煮', name);
  }
});
t('a cooking word in the name still wins (炒青菜 炒, 滷蛋 滷, 炸雞腿 炸)', () => {
  assert.strictEqual(fd.defaultsFor('炒青菜', 'vegetable', 'food').cookingMethod, '炒');
  assert.strictEqual(fd.defaultsFor('滷蛋', 'protein', 'food').cookingMethod, '滷');
  assert.strictEqual(fd.defaultsFor('炸雞腿', 'protein', 'food').cookingMethod, '炸');
});
t('fruit / beverage get no cooking preset (the field does not apply)', () => {
  assert.ok(!('cookingMethod' in fd.defaultsFor('香蕉', 'fruit', 'food')));
  assert.ok(!('cookingMethod' in fd.defaultsFor('紅茶', 'beverage', 'beverage')));
});
t('every food type with a cooking field has a cooking preset', () => {
  for (const type of fd.FOOD_TYPES){
    const cat = type === 'beverage' ? 'beverage' : 'food';
    if (!fd.applicableFields(type, cat).includes('cookingMethod')) continue;
    assert.ok(fd.defaultsFor('某某', type, cat).cookingMethod, type);
  }
});
t('調味 preset = [沒有特別調味], a valid clean list', () => {
  assert.deepStrictEqual(fd.SEASONING_DEFAULT, ['沒有特別調味']);
  assert.deepStrictEqual(fd.cleanSeasonings(fd.SEASONING_DEFAULT), ['沒有特別調味']);
  assert.ok(fd.OPTIONS.cookingMethodFood.includes(fd.DEFAULT_COOKING));
});
if (fails){ console.log(`${fails} failed`); process.exit(1); }
console.log('all passed');
