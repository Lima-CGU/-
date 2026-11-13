/**
 * Teacher 11/14: 3 scenario questions (old 3 + 4 merged), exact words, the
 * CSV keeps scenario4 (empty for new records, filled for old ones).
 *   node backend/scripts/test-scenario-1114.js
 */
const assert = require('assert');
const fd = require('../field-defaults');
require.cache[require.resolve('../firebase-admin-init.js')] = { exports: { getFirestore: () => { throw new Error('no firestore in tests'); } } };
const records = require('../records');
let fails = 0;
const t = (name, fn) => { try { fn(); console.log('ok  ', name); } catch (e){ fails += 1; console.log('FAIL', name, '-', e.message); } };

t('three questions, word for word', () => {
  assert.deepStrictEqual(fd.SCENARIO_PROMPTS, [
    '主菜下方是否還有其他食物？',
    '除了目前辨識出的食材，還有其他需要補充的食材嗎？',
    '除了目前記錄的內容，還有其他調味料或烹調方式需要補充或修改嗎？'
  ]);
});
t('CSV keeps scenario4: empty for a new record, filled for an old one', () => {
  const now = { id: 'm-test-1114-0001', pid: 'DEVTEST', group: 'A', times: {}, dishes: [{ name: '炒青菜', detail: {} }],
    scenario: { answers: [{ no: 1, answer: 'none', input: 'button' }, { no: 2, answer: 'none', input: 'button' }, { no: 3, answer: 'none', input: 'button' }] } };
  const old = { ...now, id: 'm-test-1114-0002', scenario: { answers: [1, 2, 3, 4].map(no => ({ no, answer: 'none', input: 'button' })) } };
  const rows = records.toCsv([now, old]).replace(/^﻿/, '').split(/\r?\n/);
  const head = rows[0].split(',');
  const cell = (row, k) => rows[row].split(',')[head.indexOf(k)];
  assert.ok(['scenario1', 'scenario2', 'scenario3', 'scenario4'].every(k => head.includes(k)));
  assert.deepStrictEqual(['scenario3', 'scenario4'].map(k => cell(1, k)), ['none(button)', '']);
  assert.deepStrictEqual(['scenario3', 'scenario4'].map(k => cell(2, k)), ['none(button)', 'none(button)']);
});
if (fails){ console.log(`${fails} failed`); process.exit(1); }
console.log('all passed');
