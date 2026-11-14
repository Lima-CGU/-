/**
 * 11/14: correctionAttemptCount / cancelledAttemptCount (RA 「Interaction
 * Effort Coding Protocol」), computed from record.events at export time.
 * Made-up records only.  node backend/scripts/test-correction-attempts.js
 */
const assert = require('assert');
require.cache[require.resolve('../firebase-admin-init.js')] = { exports: { getFirestore: () => { throw new Error('no firestore in tests'); } } };
const records = require('../records');
const Stats = require('../../admin-stats');
let fails = 0;
const t = (name, fn) => { try { fn(); console.log('ok  ', name); } catch (e){ fails += 1; console.log('FAIL', name, '-', e.message); } };

let seq = 0;
const ev = (event, extra = {}) => ({ seq: ++seq, event, at: '2026-11-14T06:00:00.000Z', elapsedMs: seq * 100, page: 'report', actor: 'user',
  target: 1, field: null, before: null, after: null, attemptId: null, source: null, status: 'success', detail: null, ...extra });
const rec = (group, events) => ({ id: `m-test-1114-ca-${group}${seq}`, pid: 'DEVTEST', group, times: { correctionSec: 9 }, dishes: [{ name: '炒青菜', detail: {} }], userActionCount: 5, events });
const count = r => records.correctionAttempts(r);

// A: three fields changed = 3 attempts
const a3 = rec('A', [ev('task_start'), ev('ai_draft_displayed', { actor: 'system' }), ev('item_selected'),
  ev('field_set', { field: 'size', attemptId: 'C01' }), ev('field_changed', { field: 'cookingMethod', attemptId: 'C02' }),
  ev('field_set', { field: 'salt', attemptId: 'C03' }), ev('dish_reviewed'), ev('final_confirmed')]);
// B: one message that changes two fields = 1 attempt
const b1 = rec('B', [ev('task_start'), ev('message_submitted', { page: 'chat', attemptId: 'C01' }),
  ev('ai_response_displayed', { actor: 'ai', attemptId: 'C01' }),
  ev('record_updated', { actor: 'ai', attemptId: 'C01', field: 'size' }), ev('record_updated', { actor: 'ai', attemptId: 'C01', field: 'salt' }),
  ev('record_updated', { actor: 'system', attemptId: 'C01', detail: { sourceOnly: true } }), ev('final_confirmed')]);

t('A: three fields changed = 3', () => assert.deepStrictEqual(count(a3), { correctionAttemptCount: 3, cancelledAttemptCount: 0 }));
t('B: one message changing two fields = 1', () => assert.deepStrictEqual(count(b1), { correctionAttemptCount: 1, cancelledAttemptCount: 0 }));
t('Diary changes after the save do not count', () => {
  const r = rec('A', a3.events.concat([
    ev('diary_field_changed', { page: 'diary', attemptId: null, detail: { afterFinal: true } }),
    ev('field_set', { page: 'diary', attemptId: 'C09', detail: { afterFinal: true } })]));
  assert.strictEqual(count(r).correctionAttemptCount, 3);
});
t('earlier unsaved attempt / before the task do not count', () => {
  const r = rec('A', [ev('field_set', { attemptId: 'C01', detail: { previousAttempt: true } }), ev('tutorial_opened', { detail: { beforeTask: true } })].concat(a3.events));
  assert.strictEqual(count(r).correctionAttemptCount, 3);
});
t('cancelled does not count', () => {
  // A: a rename / delete backed out of (no attemptId) is no attempt at all
  const r = rec('A', a3.events.concat([
    ev('edit_opened'), ev('cancel', { field: 'name', detail: { what: 'rename' } }),
    ev('delete_asked'), ev('cancel', { detail: { what: 'delete' } })]));
  assert.deepStrictEqual(count(r), { correctionAttemptCount: 3, cancelledAttemptCount: 0 });
  // an attempt with a cancelled status: cancelledAttemptCount instead
  const r2 = rec('A', a3.events.concat([ev('field_set', { field: 'sugar', attemptId: 'C04', status: 'cancelled' })]));
  assert.deepStrictEqual(count(r2), { correctionAttemptCount: 3, cancelledAttemptCount: 1 });
});
t('dish_reviewed (old 10/22 fix2 records had an attemptId on it) is not an attempt', () => {
  const r = rec('A', a3.events.concat([ev('dish_reviewed', { attemptId: 'C05' })]));
  assert.strictEqual(count(r).correctionAttemptCount, 3);
});
t('failed B/C message does not count (cancelledAttemptCount instead)', () => {
  const r = rec('B', b1.events.concat([ev('message_submitted', { page: 'chat', attemptId: 'C02' }),
    ev('error', { actor: 'system', status: 'failed', attemptId: 'C02', detail: { api: 'chat' } })]));
  assert.deepStrictEqual(count(r), { correctionAttemptCount: 1, cancelledAttemptCount: 1 });
});
t('a record without events: unknown (null), not 0', () => {
  assert.deepStrictEqual(count({ id: 'x', group: 'A' }), { correctionAttemptCount: null, cancelledAttemptCount: null });
  assert.deepStrictEqual(count({ id: 'x', group: 'A', events: [] }), { correctionAttemptCount: null, cancelledAttemptCount: null });
});
t('CSV has the two columns', () => {
  const rows = records.toCsv([a3, b1]).replace(/^﻿/, '').split(/\r?\n/);
  const head = rows[0].split(',');
  const cell = (row, k) => rows[row].split(',')[head.indexOf(k)];
  assert.ok(head.includes('correctionAttemptCount') && head.includes('cancelledAttemptCount'));
  assert.deepStrictEqual([cell(1, 'correctionAttemptCount'), cell(1, 'cancelledAttemptCount'), cell(2, 'correctionAttemptCount')], ['3', '0', '1']);
});
t('admin summary + overview: mean ± SD of correctionAttemptCount', () => {
  const rows = [a3, rec('A', a3.events.slice(0, 4)), b1].map(records.summarize);
  assert.deepStrictEqual(rows.map(r => r.correctionAttemptCount), [3, 1, 1]);
  const o = Stats.overview(rows);
  assert.strictEqual(o.A.correctionAttemptCount.n, 2);
  assert.strictEqual(o.A.correctionAttemptCount.mean, 2);
  assert.strictEqual(Stats.fmt(o.A.correctionAttemptCount.sd), '1.41');
  assert.strictEqual(o.B.correctionAttemptCount.mean, 1);
});
t('nothing is stored: validateRecord / the record are unchanged', () => {
  const before = JSON.stringify(a3);
  records.toCsv([a3]); records.summarize(a3);
  assert.strictEqual(JSON.stringify(a3), before);
});
if (fails){ console.log(`${fails} failed`); process.exit(1); }
console.log('all passed');
