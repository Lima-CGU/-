/**
 * 11/13 event logging: a failed AI draft (aiDraftFailed / aiDraftStatus /
 * aiWaitSec) is accepted, exported in the CSV and shown in the admin
 * summary; Diary events after the save (afterFinal) and the new event names
 * pass validation and reach the events CSV. Made-up records only.
 *   node backend/scripts/test-events-1113.js
 */
const assert = require('assert');
require.cache[require.resolve('../firebase-admin-init.js')] = { exports: { getFirestore: () => { throw new Error('no firestore in tests'); } } };
const records = require('../records');
let fails = 0;
const t = (name, fn) => { try { fn(); console.log('ok  ', name); } catch (e){ fails += 1; console.log('FAIL', name, '-', e.message); } };

const ev = (seq, event, extra = {}) => ({ seq, event, at: '2026-11-13T06:00:00.000Z', elapsedMs: seq * 100, page: 'chat', actor: 'user',
  target: null, field: null, before: null, after: null, attemptId: null, source: null, status: 'success', detail: null, ...extra });
const base = () => ({
  id: 'm-test-1113-0001', pid: 'DEVTEST', group: 'B', appVersion: 'pictameal-shell-v39',
  times: { startedAt: '2026-11-13T06:00:00.000Z', doneAt: '2026-11-13T06:01:00.000Z', correctionSec: 8.5, aiWaitSec: 0.6, aiFailedAt: '2026-11-13T06:00:05.000Z' },
  dishes: [{ name: '炒青菜', detail: { size: 'M' } }],
  userActionCount: 8, aiDraftStatus: 'failed', aiDraftFailed: true, aiDraftFailReason: 'timeout',
  events: [
    ev(1, 'task_start'), ev(2, 'ai_request_failed', { actor: 'system', status: 'failed', detail: { api: 'detect', reason: 'timeout', latencyMs: 589 } }),
    ev(3, 'ai_failure_displayed', { actor: 'system', status: 'failed' }), ev(4, 'voice_failed', { actor: 'system', source: 'voice', status: 'failed', detail: { reason: 'no-speech' } }),
    ev(5, 'diary_dish_deleted', { page: 'diary', target: 1, before: '炒青菜', detail: { afterFinal: true } })
  ]
});

t('a failed-draft record with the new fields is valid', () => {
  assert.doesNotThrow(() => records.validateRecord(base()));
});
t('aiDraftStatus / aiDraftFailed are checked', () => {
  assert.throws(() => records.validateRecord({ ...base(), aiDraftStatus: 'maybe' }), /aiDraftStatus/);
  assert.throws(() => records.validateRecord({ ...base(), aiDraftFailed: 'yes' }), /aiDraftFailed/);
  assert.throws(() => records.validateRecord({ ...base(), times: { ...base().times, aiWaitSec: -1 } }), /aiWaitSec/);
});
t('CSV: aiDraftFailed, aiDraftStatus, aiWaitSec', () => {
  const ok = { ...base(), id: 'm-test-1113-0002', aiDraftStatus: 'empty', aiDraftFailed: false, times: { correctionSec: 8.2 } };
  const old = { ...base(), id: 'm-test-1113-0003' }; delete old.aiDraftStatus; delete old.aiDraftFailed;
  const rows = records.toCsv([base(), ok, old]).replace(/^﻿/, '').split(/\r?\n/);
  const head = rows[0].split(',');
  const cell = (row, k) => rows[row].split(',')[head.indexOf(k)];
  assert.ok(head.includes('aiDraftFailed') && head.includes('aiDraftStatus') && head.includes('aiWaitSec'));
  assert.deepStrictEqual([cell(1, 'aiDraftFailed'), cell(1, 'aiDraftStatus'), cell(1, 'aiWaitSec'), cell(1, 'correctionSec'), cell(1, 'userActionCount')], ['true', 'failed', '0.6', '8.5', '8']);
  assert.deepStrictEqual([cell(2, 'aiDraftFailed'), cell(2, 'aiDraftStatus')], ['false', 'empty']);
  assert.deepStrictEqual([cell(3, 'aiDraftFailed'), cell(3, 'aiDraftStatus')], ['', '']); // an old record: unknown
});
t('events CSV: the new events, incl. afterFinal Diary changes', () => {
  const csv = records.toEventsCsv([base()]);
  for (const name of ['ai_failure_displayed', 'voice_failed', 'diary_dish_deleted']) assert.ok(csv.includes(name), name);
  assert.ok(csv.includes('afterFinal'));
});
t('admin summary: aiDraftFailed', () => {
  assert.strictEqual(records.summarize(base()).aiDraftFailed, true);
  assert.strictEqual(records.summarize({ ...base(), aiDraftStatus: 'ok', aiDraftFailed: false }).aiDraftFailed, false);
});
if (fails){ console.log(`${fails} failed`); process.exit(1); }
console.log('all passed');
