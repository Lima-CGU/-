/**
 * Tests for voice-match.js count() / command() (Group A's 數量 page):
 * 「下一個」「前一個」「上一個」「再來一個」「下一道」 are never the count 1;
 * on the 烹調方式 page 「燙的」 = 水煮.
 *   node backend/scripts/test-voice-count.js
 */
'use strict';
const assert = require('assert');
const { count, command } = require('../../voice-match');

const CASES = [
  // [said, count, command]
  ['下一個', null, 'next'], ['下一道', null, 'next'], ['下一步', null, 'next'],
  ['前一個', null, 'back'], ['上一個', null, 'back'], ['上一步', null, 'back'],
  ['再來一個', null, null], ['換一組', null, 'more'], ['一', null, null], ['一點', null, null],
  ['一個', 1, null], ['三個', 3, null], ['三塊', 3, null], ['4 個', 4, null], ['十二隻', 12, null],
  ['兩隻', 2, null], ['三', 3, null], ['全部', 'all', null],
  // 上一個/下一個 only count as commands at the start — inside a sentence they are counts
  ['早上一個', 1, null], ['桌上一個', 1, null], ['剩下一個', 1, null], ['目前一個', 1, null],
  ['請下一個', null, 'next'], ['十一個', 11, null],
  // speech fillers before the command are still a command
  ['嗯，下一個', null, 'next'], ['欸下一個', null, 'next'], ['我要下一個', null, 'next'], ['回到上一個', null, 'back']
];
// 燙 on the 烹調方式 page = 水煮 (10/23)
const { match } = require('../../voice-match');
const COOK = [['燙的', '水煮'], ['是燙的', '水煮'], ['汆燙', '水煮'], ['川燙', '水煮'], ['炒的', '炒']];
let failed = 0;
for (const [said, want] of COOK){
  const m = match(said, { fields: ['cookingMethod'] }).matches.find(x => x.field === 'cookingMethod');
  if (!m || m.value !== want){ failed += 1; console.log(`FAIL cooking ${said} -> ${m && m.value} (want ${want})`); }
  else console.log(`ok   cooking ${said} -> ${m.value}`);
}
for (const [said, n, cmd] of CASES){
  try {
    assert.strictEqual(count(said), n, 'count');
    assert.strictEqual(command(said), cmd, 'command');
    console.log(`ok   ${said} -> count ${JSON.stringify(n)}, command ${JSON.stringify(cmd)}`);
  } catch (e){
    failed += 1;
    console.log(`FAIL ${said}: ${e.message} (count ${JSON.stringify(count(said))}, command ${JSON.stringify(command(said))})`);
  }
}
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
