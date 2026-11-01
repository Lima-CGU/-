/**
 * Tests for the 11/01 additions (made-up data only):
 * - SCENARIO_PROMPTS are exactly the instructor's four questions
 * - seasonings: cleanSeasonings, which food types have it, chat.js keeps only
 *   what the AI says for dishes that have it, the scenario question reaches
 *   the AI's context
 * - CSV: seasonings / seasoningsSource / scenarioSec / scenario1..4
 *   node backend/scripts/test-scenario-seasonings.js
 */
'use strict';
const assert = require('assert');
const fd = require('../field-defaults');
const { parseRequest, buildMessages, validate } = require('../chat');
require.cache[require.resolve('../firebase-admin-init.js')] = { exports: { getFirestore: () => { throw new Error('no firestore in tests'); } } };
const records = require('../records');

const tests = [];
const t = (name, fn) => tests.push([name, fn]);

t('the four scenario questions, word for word', () => {
  assert.deepStrictEqual(fd.SCENARIO_PROMPTS, [
    '主菜下方是否還有其他食物？',
    '除了目前辨識出的食材，還有其他需要補充的食材嗎？',
    '除了目前辨識出的食材，還有使用其他調味料嗎？',
    '這道料理是用什麼方式烹調的？'
  ]);
});
t('seasonings apply to food but not fruit / beverage', () => {
  assert.ok(fd.seasoningsApply('vegetable', 'food'));
  assert.ok(fd.seasoningsApply('staple', 'food'));
  assert.ok(!fd.seasoningsApply('fruit', 'food'));
  assert.ok(!fd.seasoningsApply('beverage', 'beverage'));
});
t('cleanSeasonings: 其他 text, dedupe, 沒有特別調味 alone, length limit', () => {
  assert.deepStrictEqual(fd.cleanSeasonings(['醬油', '其他:沙茶醬', '醬油']), ['醬油', '沙茶醬']);
  assert.deepStrictEqual(fd.cleanSeasonings(['醬油', '沒有特別調味']), ['沒有特別調味']);
  assert.deepStrictEqual(fd.cleanSeasonings(['一二三四五六七八九十一']), []);
});
const dishes = [
  { no: 1, name: '炒青菜', category: 'food', foodType: 'vegetable', fields: { size: 'M', seasonings: [] }, fieldSource: { size: 'default', seasonings: 'default' } },
  { no: 2, name: '蘋果', category: 'food', foodType: 'fruit', fields: { size: 'M' }, fieldSource: { size: 'default' } }
];
t('chat: the AI seasonings are kept for 炒青菜, dropped for 蘋果', () => {
  const r = parseRequest({ group: 'B', dishes, history: [], message: '有加醬油', selected: { type: 'dish', no: 1 } });
  const v = validate({ reply: '好的。', updates: [{ no: 1, fields: { seasonings: ['醬油'] } }, { no: 2, fields: { seasonings: ['醬油'] } }] }, r.dishes, 'B', r.selected, { contextNo: r.contextNo });
  assert.deepStrictEqual(v.updates, [{ no: 1, fields: { seasonings: ['醬油'] } }]);
});
t('chat: nothing said about seasonings -> no seasonings update', () => {
  const r = parseRequest({ group: 'B', dishes, history: [], message: '很好吃', selected: { type: 'dish', no: 1 } });
  const v = validate({ reply: '好的。' }, r.dishes, 'B', r.selected, { contextNo: r.contextNo });
  assert.strictEqual(v.updates.length, 0);
});
t('chat: the prompt forbids seasonings guessed from the dish name', () => {
  const r = parseRequest({ group: 'B', dishes, history: [], message: 'x' });
  assert.ok(buildMessages(r)[0].content.includes('絕對不可以依菜名自己加入'));
});
t('chat: the scenario question reaches the AI context', () => {
  const r = parseRequest({ group: 'C', dishes, history: [], message: '有加米酒', scenario: 3 });
  const ctx = buildMessages(r).find(m => m.role === 'system' && m.content.includes('使用者目前選取')).content;
  assert.ok(ctx.includes('情境提問中:系統剛問了第 3 題「除了目前辨識出的食材，還有使用其他調味料嗎？」'));
  assert.strictEqual(parseRequest({ group: 'B', dishes, history: [], message: 'x', scenario: 9 }).scenario, null);
});
t('CSV: seasonings, seasoningsSource, scenarioSec, scenario1..4', () => {
  const rec = { id: 'm-test12345', pid: 'DEVTEST', group: 'A', times: { scenarioSec: 8.5 },
    scenario: { answers: [{ no: 1, answer: 'text' }, { no: 1, answer: 'none' }, { no: 2, answer: 'none' }, { no: 3, answer: 'edit' }, { no: 3, answer: 'none' }, { no: 4, answer: 'none' }] },
    dishes: [{ name: '炒青菜', detail: { seasonings: ['醬油', '米酒'] }, fieldSource: { seasonings: 'user' } },
      { name: '蘋果', detail: { seasonings: null }, fieldSource: { seasonings: 'na' } }] };
  const rows = records.toCsv([rec]).replace(/^\uFEFF/, '').split(/\r?\n/);
  const head = rows[0].split(',');
  const cell = (row, k) => rows[row].split(',')[head.indexOf(k)];
  assert.strictEqual(cell(1, 'seasonings'), '醬油、米酒');
  assert.strictEqual(cell(1, 'seasoningsSource'), 'user');
  assert.strictEqual(cell(2, 'seasonings'), 'NA');
  assert.strictEqual(cell(1, 'scenarioSec'), '8.5');
  assert.deepStrictEqual(['scenario1', 'scenario2', 'scenario3', 'scenario4'].map(k => cell(1, k)), ['text+none', 'none', 'edit+none', 'none']);
});

t('voice: a negated seasoning is not added', () => {
  const v = require('../../voice-match');
  assert.deepStrictEqual(v.seasonings('沒有醬油'), []);
  assert.deepStrictEqual(v.seasonings('不加米酒'), []);
  assert.deepStrictEqual(v.seasonings('醬油但沒有米酒'), ['醬油']);
  assert.deepStrictEqual(v.seasonings('有醬油跟米酒'), ['醬油', '米酒']);
  assert.deepStrictEqual(v.seasonings('沒有'), ['沒有特別調味']);
});
t('C buttons never name 醬油 / 米酒', () => {
  const r = parseRequest({ group: 'C', dishes, history: [], message: 'x', selected: { type: 'dish', no: 1 } });
  const v = validate({ reply: '好的。', suggestions: ['有加醬油', '有放米酒', '比較鹹'] }, r.dishes, 'C', r.selected, { contextNo: r.contextNo });
  assert.deepStrictEqual(v.suggestions, ['比較鹹']);
});

let failed = 0;
for (const [name, fn] of tests){
  try { fn(); console.log(`ok   ${name}`); } catch (e){ failed += 1; console.log(`FAIL ${name}: ${e.message}`); }
}
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
