/**
 * Tests for chat.js (Groups B/C), made-up dishes only:
 * - the server never changes a portion by itself (the 半份 safety net was
 *   removed: 「AI 不可自行猜測未確認的份量」) — only the AI's own updates count
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

// (10/23) the server never resizes a dish by itself — no size-from-half
const meal3 = [
  dishes[0],
  { no: 2, name: '白飯', category: 'food', foodType: 'staple', fields: { size: 'M' }, fieldSource: { size: 'default' } },
  { no: 3, name: '燙青菜', category: 'food', foodType: 'vegetable', fields: { size: 'M', cookingMethod: '水煮' }, fieldSource: { size: 'default', cookingMethod: 'default' } }
];
const run = (message, ai = {}, extra = { contextDish: 1 }, group = 'B') => {
  const r = parseRequest({ group, dishes: meal3, history: [], message, ...extra });
  return validate({ reply: '好的。', ...ai }, r.dishes, group, r.selected, { contextNo: r.contextNo });
};
const sizeOf = (v, no) => ((v.updates.find(u => u.no === no) || {}).fields || {}).size;
t('recent 甜不辣, 「飯吃了一半」, the AI changes nothing -> 甜不辣 keeps its size (no system change)', () => {
  const v = run('飯吃了一半');
  assert.strictEqual(sizeOf(v, 1), undefined);
  assert.strictEqual(v.updates.length, 0);
  assert.ok(!v.updates.some(u => 'halfFromText' in u));
});
t('recent 甜不辣, 「飯吃了一半」, the AI sets 白飯 XS -> only 白飯 changes', () => {
  const v = run('飯吃了一半', { updates: [{ no: 2, fields: { size: 'XS' } }] });
  assert.deepStrictEqual(v.updates.map(u => [u.no, u.fields.size]), [[2, 'XS']]);
});
t('「我吃了一半」 and the AI only writes a note -> no size change by the system', () => {
  const v = run('我吃了一半', { notes: [{ no: 1, note: '只吃一半' }] });
  assert.strictEqual(v.updates.length, 0);
});
t('selected 甜不辣, 「我吃了半份」, the AI sets XS -> kept as the AI gave it', () => {
  const v = run('我點選了 甜不辣。我吃了半份', { updates: [{ no: 1, fields: { size: 'XS' } }] }, { selected: { type: 'dish', no: 1 } });
  assert.strictEqual(sizeOf(v, 1), 'XS');
});
t('the prompt: a size only for a dish the user selected or named', () => {
  const r = parseRequest({ group: 'B', dishes: meal3, contextDish: 1, history: [], message: '飯吃了一半' });
  assert.ok(buildMessages(r)[0].content.includes('份量(size)不可以自己猜'));
});
t('closing filter keeps 「還有剩一些」', () => {
  const r = req({ contextDish: 1, message: '好' });
  const v = validate({ reply: '好的。', suggestions: ['還有剩一些', '還有喝飲料', '沒有了'] }, r.dishes, 'C', r.selected, { contextNo: r.contextNo, message: r.message });
  assert.deepStrictEqual(v.suggestions, ['還有剩一些']);
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
