/**
 * Tests for chat.js (Groups B/C), made-up dishes only:
 * - 「我吃了半份」 sets size XS (safety net when the AI left the size out),
 *   but not for a countable dish
 * - the dish talked about most recently is told to the AI and used for
 *   Group C's buttons; closing buttons wait until its fields were discussed
 *   node backend/scripts/test-chat-context.js
 */
'use strict';
const assert = require('assert');
const { parseRequest, buildMessages, validate } = require('../chat');

const dishes = [
  { no: 1, name: '甜不辣', category: 'food', foodType: 'protein', fields: { size: 'M', cookingMethod: '炸', sugar: '無糖', salt: '1/4 茶匙' },
    fieldSource: { size: 'default', cookingMethod: 'default', sugar: 'default', salt: 'default' } },
  { no: 2, name: '炸雞腿', category: 'food', foodType: 'protein', fields: { size: 'M' }, fieldSource: { size: 'default' }, count: 3, countable: true }
];
const req = (extra) => parseRequest({ group: 'C', dishes, history: [], ...extra });
const tests = [];
const t = (name, fn) => tests.push([name, fn]);

t('半份, dish selected, AI left size out -> XS', () => {
  const r = req({ selected: { type: 'dish', no: 1 }, message: '我點選了 甜不辣。我吃了半份' });
  const v = validate({ reply: '好的。', notes: [{ no: 1, note: '只吃一半' }] }, r.dishes, 'C', r.selected, { contextNo: r.contextNo, message: r.message });
  const u = v.updates.find(x => x.no === 1);
  assert.ok(u && u.fields.size === 'XS' && u.halfFromText);
});
t('半份, nothing selected, recent dish 1 -> XS on dish 1', () => {
  const r = req({ contextDish: 1, message: '我吃了一半' });
  assert.strictEqual(r.contextNo, 1);
  const v = validate({ reply: '好的。' }, r.dishes, 'B', r.selected, { contextNo: r.contextNo, message: r.message });
  assert.strictEqual(v.updates.find(x => x.no === 1).fields.size, 'XS');
});
t('the AI already set size XS -> kept, no flag', () => {
  const r = req({ selected: { type: 'dish', no: 1 }, message: '我點選了 甜不辣。半份' });
  const v = validate({ reply: '好的。', updates: [{ no: 1, fields: { size: 'XS' } }] }, r.dishes, 'C', r.selected, { contextNo: r.contextNo, message: r.message });
  const u = v.updates.find(x => x.no === 1);
  assert.ok(u.fields.size === 'XS' && !u.halfFromText);
});
t('countable dish: 吃一半 does not change the size', () => {
  const r = req({ selected: { type: 'dish', no: 2 }, message: '我點選了 炸雞腿。吃一半' });
  const v = validate({ reply: '好的。', updates: [{ no: 2, fields: {}, count: 2 }] }, r.dishes, 'C', r.selected, { contextNo: r.contextNo, message: r.message });
  const u = v.updates.find(x => x.no === 2);
  assert.ok(u.count === 2 && u.fields.size !== 'XS');
});
t('整餐 selected: no half safety net', () => {
  const r = req({ selected: { type: 'meal' }, contextDish: 1, message: '關於整餐:吃了一半' });
  assert.strictEqual(r.contextNo, null);
  const v = validate({ reply: '好的。' }, r.dishes, 'C', r.selected, { contextNo: r.contextNo, message: r.message });
  assert.strictEqual(v.updates.length, 0);
});
// (review round 1) the safety net must not fire for another dish, sugar/salt, negations, a question
const noNet = (name, extra, ai, group = 'C') => t(name, () => {
  const r = req(extra);
  const v = validate({ reply: '好的。', ...ai }, r.dishes, group, r.selected, { contextNo: r.contextNo, message: r.message });
  assert.ok(!v.updates.some(u => u.halfFromText), JSON.stringify(v.updates));
});
const withRice = [...dishes, { no: 3, name: '白飯', category: 'food', foodType: 'staple', fields: { size: 'M' }, fieldSource: { size: 'default' } }];
t('another dish named (白飯吃了一半, recent dish 1) -> no net on dish 1', () => {
  const r = parseRequest({ group: 'C', dishes: withRice, contextDish: 1, history: [], message: '白飯吃了一半' });
  const v = validate({ reply: '好的。', updates: [{ no: 3, fields: { size: 'XS' } }] }, r.dishes, 'C', r.selected, { contextNo: r.contextNo, message: r.message });
  assert.deepStrictEqual(v.updates.map(u => [u.no, u.fields.size, !!u.halfFromText]), [[3, 'XS', false]]);
});
noNet('a new dish this turn (還有一碗湯喝了一半)', { contextDish: 1, message: '還有一碗湯喝了一半' }, { newDishes: [{ name: '湯', category: 'food', fields: { size: 'XS' } }] });
noNet('糖減一半', { selected: { type: 'dish', no: 1 }, message: '我點選了 甜不辣。糖減一半' }, { updates: [{ no: 1, fields: { sugar: '半糖' } }] });
noNet('鹽只有平常的一半', { selected: { type: 'dish', no: 1 }, message: '我點選了 甜不辣。鹽只有平常的一半' }, {});
for (const m of ['另一半給朋友吃', '吃了一半以上', '不到一半', '沒有一半']) noNet(`negation / comparison: ${m}`, { contextDish: 1, message: m }, {});
noNet('the AI is asking back (isClarification)', { contextDish: 1, message: '吃了一半吧?還是三分之一' }, { isClarification: true });
t('closing filter keeps 「還有剩一些」', () => {
  const r = req({ contextDish: 1, message: '好' });
  const v = validate({ reply: '好的。', suggestions: ['還有剩一些', '還有喝飲料', '沒有了'] }, r.dishes, 'C', r.selected, { contextNo: r.contextNo, message: r.message });
  assert.deepStrictEqual(v.suggestions, ['還有剩一些']);
});
// (review round 2) dish names with 甜/鹹/糖 and names inside other names
for (const [name, list, ctx] of [
  ['甜不辣吃了一半', dishes, 1],
  ['炒飯吃了一半', [{ no: 1, name: '炒飯', category: 'food', foodType: 'staple', fields: { size: 'M' }, fieldSource: { size: 'default' } }, { no: 2, name: '飯', category: 'food', foodType: 'staple', fields: { size: 'M' }, fieldSource: { size: 'default' } }], 1]
]) t(`net still fires: 「${name}」`, () => {
  const r = parseRequest({ group: 'B', dishes: list, contextDish: ctx, history: [], message: name });
  const v = validate({ reply: '好的。' }, r.dishes, 'B', r.selected, { contextNo: r.contextNo, message: r.message });
  assert.ok(v.updates.some(u => u.no === ctx && u.fields.size === 'XS' && u.halfFromText), JSON.stringify(v.updates));
});
t('the AI is told the recent dish', () => {
  const r = req({ contextDish: 1, message: '是炸的' });
  const ctx = buildMessages(r).find(m => m.role === 'system' && m.content.includes('使用者目前選取'));
  assert.ok(ctx.content.includes('最近談到的菜:第 1 道:甜不辣'));
});
t('C buttons: closing buttons dropped while the recent dish has open fields', () => {
  const r = req({ contextDish: 1, message: '吃完了' });
  const v = validate({ reply: '好的。', suggestions: ['沒有了', '還有喝飲料', '是滷的', '比較鹹', '下一道'] }, r.dishes, 'C', r.selected, { contextNo: r.contextNo, message: r.message });
  assert.deepStrictEqual(v.suggestions, ['是滷的', '比較鹹']);
});
t('C buttons: closing buttons allowed once every field was discussed', () => {
  const done = dishes.map(d => d.no === 1 ? { ...d, fieldSource: { size: 'ai', cookingMethod: 'ai', sugar: 'ai', salt: 'ai' } } : d);
  const r = parseRequest({ group: 'C', dishes: done, contextDish: 1, history: [], message: '好' });
  const v = validate({ reply: '好的。', suggestions: ['下一道', '沒有了'] }, r.dishes, 'C', r.selected, { contextNo: r.contextNo, message: r.message });
  assert.deepStrictEqual(v.suggestions, ['下一道', '沒有了']);
});
t('Group B never gets suggestions', () => {
  const r = req({ contextDish: 1, message: '是炸的' });
  const v = validate({ reply: '好的。', suggestions: ['是滷的'] }, r.dishes, 'B', r.selected, { contextNo: r.contextNo, message: r.message });
  assert.ok(!('suggestions' in v));
});

let failed = 0;
for (const [name, fn] of tests){
  try { fn(); console.log(`ok   ${name}`); } catch (e){ failed += 1; console.log(`FAIL ${name}: ${e.message}`); }
}
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
