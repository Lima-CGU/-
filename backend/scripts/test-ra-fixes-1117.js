/**
 * RA decisions on the 11/17 audit: voice negation, 大概 / 不大, CSV formula
 * characters. Made-up records only.  node backend/scripts/test-ra-fixes-1117.js
 */
const assert = require('assert');
require.cache[require.resolve('../firebase-admin-init.js')] = { exports: { getFirestore: () => { throw new Error('no firestore in tests'); } } };
const V = require('../../voice-match');
const records = require('../records');
let fails = 0;
const t = (name, fn) => { try { fn(); console.log('ok  ', name); } catch (e){ fails += 1; console.log('FAIL', name, '-', e.message); } };
const pick = (text, field) => V.match(text, { fields: [field] }).matches.map(m => m.value);

t('seasonings: a negated one is never chosen', () => {
  assert.deepStrictEqual(V.seasonings('不要醬油'), ['沒有特別調味']);
  assert.deepStrictEqual(V.seasonings('沒有加醬油'), ['沒有特別調味']);
  assert.deepStrictEqual(V.seasonings('沒有加醬油跟米酒'), ['沒有特別調味']); // the negation covers the list
  assert.deepStrictEqual(V.seasonings('沒有醬油，有米酒'), ['米酒']);
  assert.deepStrictEqual(V.seasonings('醬油跟米酒'), ['醬油', '米酒']);
  assert.deepStrictEqual(V.seasonings('有加醬油'), ['醬油']);
});
// (11/17 RA 2) the 調味 page applies a spoken change to the list already chosen
const NONE = '沒有特別調味';
const said = (list, text, custom) => V.applySeasoningIntent(list, V.seasoningIntent(text, { custom }), NONE);
t('seasonings: 醬油＋米酒, 「不要醬油」 → only 米酒 is left', () => {
  assert.deepStrictEqual(said(['醬油', '米酒'], '不要醬油'), ['米酒']);
  assert.deepStrictEqual(said(['米酒'], '不要醬油'), ['米酒']);          // other choices stay
  assert.deepStrictEqual(said(['醬油', '米酒'], '沒有醬油，有米酒'), ['米酒']);
});
t('seasonings: only 醬油, 「不要醬油」 → 沒有特別調味', () => {
  assert.deepStrictEqual(said(['醬油'], '不要醬油'), [NONE]);
  assert.deepStrictEqual(said([NONE], '不要醬油'), [NONE]);              // only negations, nothing else chosen
  assert.deepStrictEqual(said([], '沒有加醬油跟米酒'), [NONE]);
  assert.deepStrictEqual(said(['醬油', '米酒'], '沒有'), [NONE]);
  assert.deepStrictEqual(said(['醬油', '沙茶'], '不要沙茶', ['沙茶']), ['醬油']); // typed under 其他
});
t('seasonings: 「不加冰」 (not a seasoning) → nothing chosen, asked again', () => {
  assert.strictEqual(said(['醬油'], '不加冰'), null);
  assert.strictEqual(said([NONE], '不要冰塊'), null);
  assert.strictEqual(said(['醬油'], '醬油，不加冰'), null);
  assert.strictEqual(said([], '不要沙茶'), null);                       // 沙茶 was not typed under 其他
  assert.strictEqual(said(['醬油'], '好'), null);
  assert.deepStrictEqual(V.seasoningIntent('不加冰').unclear, true);
  assert.deepStrictEqual(said([], '沒有加任何東西'), [NONE]);
  assert.deepStrictEqual(said(['米酒'], '有加醬油'), ['米酒', '醬油']);
});
t('sugar / salt: 不加糖 = 無糖; a negated level is not picked', () => {
  assert.deepStrictEqual(pick('不加糖', 'sugar'), ['無糖']);
  assert.deepStrictEqual(pick('沒有加糖', 'sugar'), ['無糖']);
  assert.deepStrictEqual(pick('不要加糖', 'sugar'), ['無糖']);
  assert.deepStrictEqual(pick('不要全糖', 'sugar'), []);
  assert.deepStrictEqual(pick('半糖', 'sugar'), ['半糖']);
  assert.deepStrictEqual(pick('沒有加鹽', 'salt'), ['無鹽']);
  assert.deepStrictEqual(pick('少鹽', 'salt'), ['1/4 茶匙']);
  assert.deepStrictEqual(pick('不是炸的', 'cookingMethod'), []);
});
t('size: 大概 / 不大 are not 大 (L); a real size still is', () => {
  assert.deepStrictEqual(pick('大概', 'size'), []);
  assert.deepStrictEqual(pick('不大', 'size'), []);
  assert.deepStrictEqual(pick('大概吃了半份', 'size'), ['XS']);
  assert.deepStrictEqual(pick('大概一份', 'size'), ['M']);
  assert.deepStrictEqual(['小', '中份', '大', '大份', '很大', '兩份'].map(x => pick(x, 'size')[0]), ['S', 'M', 'L', 'L', 'L', 'XL']);
  for (const x of ['不太大', '沒有很大', '不會太大', '不要太大', '差不多大']) assert.deepStrictEqual(pick(x, 'size'), [], x);
  assert.deepStrictEqual(pick('很大份', 'size'), ['L']);
  assert.deepStrictEqual(pick('我沒有很餓吃小份', 'size'), ['S']);
});
t('CSV: text starting with = + - @ gets a leading quote; numbers / data unchanged', () => {
  const r = { id: 'm-test-ra1117-0001', pid: 'DEVTEST', group: 'A', times: { totalSec: 12.5 }, userActionCount: 3,
    dishes: [{ name: '=HYPERLINK("x")', notes: ['+1 碗', '@me', '-半份'], inputText: '-5克', detail: {} }] };
  const before = JSON.stringify(r);
  const csv = records.toCsv([r]).replace(/^﻿/, '');
  const [head, row] = csv.split(/\r?\n/);
  assert.ok(row.includes(`"'=HYPERLINK(""x"")"`), row);
  assert.ok(row.includes("'+1 碗; @me; -半份") || row.includes("'+1 碗"), row);
  assert.ok(row.includes("'-5克"), row);
  const cols = head.split(',');
  assert.strictEqual(row.split(',')[cols.indexOf('totalSec')], '12.5');
  assert.strictEqual(JSON.stringify(r), before); // export only
  const ids = records.toCsv([{ ...r, pid: '-P01' }]).replace(/^\uFEFF/, '').split(/\r?\n/)[1];
  assert.ok(ids.includes(',-P01,') && !ids.includes("'-P01")); // an id is not quoted
  const ev = records.toEventsCsv([{ ...r, events: [{ seq: 1, event: 'dish_renamed', at: '2026-11-17T00:00:00.000Z', elapsedMs: 0, actor: 'user', before: '白飯', after: '=1+1' }] }]);
  assert.ok(ev.includes("'=1+1"));
});
if (fails){ console.log(`${fails} failed`); process.exit(1); }
console.log('all passed');
