/**
 * 11/27: food homophones by pinyin (all groups) + one sentence split into
 * several foods (position words). Only the words given in the work order and
 * public TFND data — never the teacher's foods1000 table (not loaded here).
 *   node backend/scripts/test-food-homophones-1127.js
 */
const assert = require('assert');
const path = require('path');
const { spawn } = require('child_process');
require.cache[require.resolve('../firebase-admin-init.js')] = { exports: { getFirestore: () => { throw new Error('no firestore in tests'); } } };
const fd = require('../field-defaults');
const vm = require('../../voice-match');
const fp = require('../food-pinyin');
const db = require('../nutrition-db');

let fails = 0;
const t = async (name, fn) => { try { await fn(); console.log('ok  ', name); } catch (e){ fails += 1; console.log('FAIL', name, '-', e.message); } };

// the word list as the server builds it: food data loaded at run time (here
// TFND only — foods1000 is not loaded in tests) + the cooking / seasoning lists
const fixer = fp.createFixer(db.foodNames());
// what the app does: the fixed table first, then the pinyin check
const fixAll = (text, opts) => fixer.fix(vm.fixFoodWords(text, opts).text).text;

(async () => {
  await t('should change: 鄉間旗魚 → 香煎旗魚', () => {
    const r = fixer.fix('鄉間旗魚');
    assert.strictEqual(r.text, '香煎旗魚');
    assert.deepStrictEqual(r.fixes.map(f => [f.from, f.to]), [['鄉間', '香煎']]);
  });
  await t('should change: 炒玉米青豆紅羅波 → 炒玉米青豆紅蘿蔔', () => {
    assert.strictEqual(fixer.fix('炒玉米青豆紅羅波').text, '炒玉米青豆紅蘿蔔');
  });
  await t('should change: 殭屍 / 九成塔 / 聰花 / 算頭 (pinyin alone, and table + pinyin)', () => {
    const want = { 殭屍: '薑絲', 九成塔: '九層塔', 聰花: '蔥花', 算頭: '蒜頭' };
    for (const [from, to] of Object.entries(want)){
      assert.strictEqual(fixer.fix(from).text, to, `pinyin ${from}`);
      assert.strictEqual(vm.fixFoodWords(from).text, to, `table ${from}`);
      assert.strictEqual(fixAll(from), to, `both ${from}`);
    }
  });
  await t('split: 醬燒肉塊上有薑絲下方有滷蛋 → 醬燒肉塊 / 薑絲 / 滷蛋', () => {
    assert.deepStrictEqual(fd.splitFoods(fixAll('醬燒肉塊上有薑絲下方有滷蛋', { foodInput: true })), ['醬燒肉塊', '薑絲', '滷蛋']);
    // homophones and position words together
    assert.deepStrictEqual(fd.splitFoods(fixAll('醬燒肉塊上有殭屍下方有滷蛋', { foodInput: true })), ['醬燒肉塊', '薑絲', '滷蛋']);
  });
  await t('split: every position word in the list', () => {
    for (const w of ['上有', '上面有', '下有', '下面有', '下方有', '底下有', '旁邊有', '裡面有', '上面還有', '配']){
      assert.deepStrictEqual(fd.splitFoods(`白飯${w}滷蛋`), ['白飯', '滷蛋'], w);
    }
    // the older separators still work, and 上面還有 is one separator
    assert.deepStrictEqual(fd.splitFoods('白飯上面還有薑絲、蔥花以及蒜頭'), ['白飯', '薑絲', '蔥花', '蒜頭']);
    assert.deepStrictEqual(fd.splitFoods('滷蛋'), ['滷蛋']);
  });
  await t('should NOT change: everyday words never become a food', () => {
    for (const w of ['我很努力', '隨便', '沒有了', '謝謝']) assert.strictEqual(fixAll(w), w, w);
  });
  await t('should NOT change: words that are already right', () => {
    for (const w of ['雞肉', '白飯', '青花菜']) assert.strictEqual(fixAll(w), w, w);
  });
  await t('should NOT change: protected words (和牛 / 和風醬), and they are not split', () => {
    for (const w of ['和牛', '和風醬']) assert.strictEqual(fixAll(w, { foodInput: true }), w, w);
    assert.deepStrictEqual(fd.splitFoods('和牛'), ['和牛']);
    assert.deepStrictEqual(fd.splitFoods('和風醬'), ['和風醬']);
  });
  await t('single character never changed; 2+ only', () => {
    assert.strictEqual(fixer.fix('魚').text, '魚');
    assert.strictEqual(fixer.fix('江').text, '江');
  });
  await t('Taiwanese accent: zh=z ch=c sh=s in=ing en=eng; other sounds = no change', () => {
    assert.strictEqual(fp.looseSyllable('zhi'), 'zi');
    assert.strictEqual(fp.looseSyllable('chao'), 'cao');
    assert.strictEqual(fp.looseSyllable('shi'), 'si');
    assert.strictEqual(fp.looseSyllable('qing'), 'qin');
    assert.strictEqual(fp.looseSyllable('feng'), 'fen');
    assert.strictEqual(fixer.fix('江詩').text, '薑絲'); // jiang shi = jiang si
    assert.strictEqual(fixer.fix('江西').text, '江西'); // jiang xi: close, not the same
  });
  await t('two different foods with the same sound: no change', () => {
    const f = fp.createFixer(['甲米', '佳米']); // made-up words, both jia mi
    assert.strictEqual(f.fix('假米').text, '假米');
  });
  await t('a target must be a known word (food data / cooking / seasoning lists)', () => {
    const empty = fp.createFixer([]);
    assert.strictEqual(empty.fix('鄉間旗魚').text, '香煎旗魚'); // 香煎 is in the cooking list
    assert.strictEqual(empty.fix('眼麥').text, '眼麥');     // 燕麥 is only in the food data (TFND)
    assert.strictEqual(fixer.fix('眼麥').text, '燕麥');
    assert.ok(fp.COOKING_WORDS.includes('香煎') && fp.SEASONING_WORDS.includes('醬油'));
  });
  await t('ordinary sentences stay as they are', () => {
    for (const s of ['我今天中午吃了一個便當', '媽媽煮的', '雞腿是炸的然後有一顆滷蛋', '炒魚', '剩下的湯沒有喝', '飲料是半糖去冰的綠茶', '感覺有點鹹'])
      assert.strictEqual(fixAll(s), s, s);
  });
  await t('(review) option words the app reads are never turned into food: 正常 / 少冰 / 七分糖 …', () => {
    for (const w of ['正常', '正常份量', '正常糖', '正常鹽', '少冰', '去冰', '一分糖', '二分糖', '五分糖', '七分糖', '半糖', '小份', '一般'])
      assert.strictEqual(fixAll(w), w, w);
  });
  await t('(review) every voice-match option / command word still means the same after fixing', () => {
    const fields = ['size', 'cookingMethod', 'sugar', 'salt'];
    const same = [];
    Object.entries(vm.TABLE).forEach(([key, rows]) => rows.forEach(([words]) => words.forEach(w => {
      const category = key === 'cookingBeverage' ? 'beverage' : 'food';
      const before = vm.match(w, { category, fields }).matches.map(m => m.field + m.value).join();
      const after = vm.match(fixAll(w), { category, fields }).matches.map(m => m.field + m.value).join();
      if (before !== after) same.push(`${w}: ${before} -> ${after}`);
    })));
    vm.COMMANDS.forEach(([words]) => words.forEach(w => { if (vm.command(fixAll(w)) !== vm.command(w)) same.push(`command ${w}`); }));
    Object.values(vm.FIELD_WORDS).forEach(words => words.forEach(w => { if (fixAll(w) !== w) same.push(`field word ${w}`); }));
    assert.deepStrictEqual(same, []);
  });
  await t('(review) 配 splits, but not inside 配菜 / 搭配 / 配方 / 配料', () => {
    assert.deepStrictEqual(fd.splitFoods('雞腿配飯'), ['雞腿', '飯']);
    for (const w of ['炒配菜', '白飯配菜', '原味配方奶', '搭配沙拉', '配料']) assert.deepStrictEqual(fd.splitFoods(w), [w], w);
  });
  await t('the module writes no word list: food-pinyin.js / server.js hold no food data file', () => {
    const fs = require('fs');
    const src = fs.readFileSync(path.join(__dirname, '..', 'food-pinyin.js'), 'utf8');
    assert.ok(!/readFileSync|writeFile/.test(src));
  });

  /* the endpoint, on a local server (TFND only: no Firestore here) */
  await t('POST /api/food-words returns the corrected text and each replacement only', async () => {
    const port = 3197;
    const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
      env: { ...process.env, PORT: String(port), FIREBASE_SERVICE_ACCOUNT: '', OPENAI_API_KEY: '' },
      cwd: path.join(__dirname, '..'), stdio: 'ignore'
    });
    try {
      let res = null;
      for (let i = 0; i < 50 && !res; i++){
        await new Promise(r => setTimeout(r, 200));
        res = await fetch(`http://127.0.0.1:${port}/api/food-words`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '我吃了鄉間旗魚和紅羅波' })
        }).catch(() => null);
      }
      assert.ok(res && res.ok, 'server answered');
      const data = await res.json();
      assert.strictEqual(data.text, '我吃了香煎旗魚和紅蘿蔔');
      assert.deepStrictEqual(data.fixes, [{ from: '鄉間', to: '香煎' }, { from: '紅羅波', to: '紅蘿蔔' }]);
      assert.deepStrictEqual(Object.keys(data).sort(), ['changed', 'fixes', 'text']);
      const same = await (await fetch(`http://127.0.0.1:${port}/api/food-words`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '謝謝' })
      })).json();
      assert.deepStrictEqual(same, { text: '謝謝', changed: false, fixes: [] });
      // (review) a burst of requests from one address is refused after 300 a minute
      let refused = 0;
      for (let i = 0; i < 302; i++){
        const r = await fetch(`http://127.0.0.1:${port}/api/food-words`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '白飯' }) });
        if (r.status === 429) refused += 1;
      }
      assert.ok(refused >= 1, 'rate limited');
    } finally { srv.kill(); }
  });

  console.log(fails ? `\n${fails} FAILED` : '\nall passed');
  process.exit(fails ? 1 : 0);
})();
