/**
 * Food homophones by PINYIN (teacher 11/27). Speech / keyboard dictation can
 * turn a food into other characters with the same sound: 「鄉間旗魚」 is
 * 「香煎旗魚」, 「紅羅波」 is 「紅蘿蔔」. A piece of the text is replaced only when
 *
 *  - it is 2+ Chinese characters (a single character is never changed);
 *  - its pinyin, tones ignored, equals the pinyin of exactly ONE known word
 *    (two or more different words with that sound -> no change). Taiwanese
 *    accent: zh=z, ch=c, sh=s, ing=in, eng=en; any other difference = no change;
 *  - the known word is in the food data loaded at run time (foods1000 from
 *    Firestore + TFND, see nutrition-db.foodNames()), or in the cooking /
 *    seasoning / common-ingredient lists below;
 *  - it is not itself a known word, does not overlap one already in the text
 *    (「雞肉」「白飯」 stay), nor a protected word (和風 / 和牛 / 和菓子 / 和式 /
 *    及第) or an everyday word (COMMON_WORDS);
 *  - it holds no function character (我 / 有 / 了 / 很 / 和 …) and no
 *    one-character cooking word (炒魚 is 炒 + 魚, not 草魚; 媽媽煮的 stays).
 *
 * The word list is built in memory from the loaded data — nothing is written
 * to a file and no endpoint returns the list.
 *
 *   const fixer = createFixer(words);   // words: iterable of strings
 *   fixer.fix('鄉間旗魚') -> { text: '香煎旗魚', changed: true, fixes: [{ from: '鄉間', to: '香煎', at: 0 }] }
 */
'use strict';

const { pinyin } = require('pinyin-pro');

// cooking methods (the teacher's list + the app's options of 2+ characters)
const COOKING_WORDS = [
  '香煎', '清蒸', '紅燒', '涼拌', '爆炒', '水煮', '油炸', '清燙', '乾煎', '酥炸', '清炒', '快炒', '燒烤',
  '碳烤', '炭烤', '火烤', '燉煮', '滷製', '清燉', '紅燉', '糖醋', '醬燒', '醬爆', '鹽烤', '烘焙', '生食',
  '沙拉', '汆燙', '川燙', '燙青菜', '蒜炒', '油淋', '三杯', '宮保', '乾扁', '乾煸', '燜燒', '蔥爆', '椒鹽', '鹽酥'
];
// seasonings and condiments
const SEASONING_WORDS = [
  '醬油', '米酒', '豆油', '蠔油', '沙茶', '沙茶醬', '胡椒', '胡椒粉', '黑胡椒', '白胡椒', '味噌', '番茄醬',
  '豆瓣醬', '辣椒', '辣椒醬', '辣油', '麻油', '香油', '烏醋', '白醋', '黑醋', '味醂', '鹽巴', '砂糖', '冰糖',
  '甜麵醬', '芝麻醬', '花生醬', '美乃滋', '咖哩', '五香粉', '八角', '花椒', '辣豆瓣', '醬料', '和風醬', '柴魚',
  '蒜泥', '蒜末', '薑泥', '薑末', '蔥末', '醋', '芥末', '哇沙米', '豆豉', '腐乳', '紅糟', '胡麻醬'
];
// common ingredients / dishes (public everyday words; TFND covers most others)
const INGREDIENT_WORDS = [
  '薑絲', '九層塔', '蒜頭', '蔥花', '青蔥', '香菜', '紅蘿蔔', '玉米', '青豆', '雞肉', '豬肉', '牛肉', '羊肉',
  '鴨肉', '鵝肉', '魚肉', '白飯', '糙米飯', '炒飯', '炒麵', '麵條', '青花菜', '花椰菜', '高麗菜', '空心菜',
  '地瓜葉', '菠菜', '小白菜', '大白菜', '洋蔥', '蘑菇', '香菇', '金針菇', '杏鮑菇', '木耳', '豆腐', '豆干',
  '雞蛋', '滷蛋', '荷包蛋', '炒蛋', '蛋花', '旗魚', '鮭魚', '鯖魚', '虱目魚', '吳郭魚', '鱈魚', '蝦仁',
  '花枝', '魷魚', '蛤蜊', '肉塊', '肉片', '肉絲', '肉丁', '雞腿', '雞胸', '雞翅', '排骨', '香腸', '火腿',
  '培根', '貢丸', '魚丸', '水餃', '煎餃', '包子', '饅頭', '地瓜', '馬鈴薯', '南瓜', '冬瓜', '絲瓜', '小黃瓜',
  '番茄', '茄子', '甜椒', '青椒', '彩椒', '四季豆', '豆芽菜', '筍子', '竹筍', '海帶', '紫菜', '味噌湯',
  '蛋花湯', '玉米濃湯', '酸辣湯', '沙拉', '水果', '香蕉', '蘋果', '芭樂', '橘子', '柳丁', '西瓜', '鳳梨',
  '奶茶', '紅茶', '綠茶', '豆漿', '牛奶', '咖啡', '米粉', '冬粉', '粄條', '烏龍麵', '油豆腐', '甜不辣'
];
// protected (never changed, never a target of a change) — same words as field-defaults SPLIT_PROTECTED
const PROTECTED_WORDS = ['和菓子', '和風', '和牛', '和式', '及第'];
// everyday words that must never become a food
const COMMON_WORDS = [
  '今天', '昨天', '明天', '早餐', '午餐', '晚餐', '宵夜', '點心', '時候', '然後', '因為', '所以', '可以',
  '一點', '一些', '一半', '比較', '感覺', '好吃', '隨便', '努力', '謝謝', '剛剛', '其實', '應該', '已經',
  '真的', '一起', '全部', '大概', '大約', '差不多', '一樣', '這樣', '那樣', '怎麼', '什麼', '知道', '覺得',
  '東西', '食物', '剩下', '一份', '一碗', '一盤', '一杯', '兩份', '半份', '吃完', '不錯', '方便', '時間',
  '上面', '下面', '旁邊', '裡面', '底下', '下方', '上方', '中間', '左邊', '右邊', '主菜', '配菜', '湯匙', '筷子'
];
// characters a misheard food never contains (they mark a sentence, not a name)
const STOP_CHARS = new Set([...'我你他她它們的了是在有沒不很也都就還和跟及與或要想說吃喝這那個些嗎呢吧啊喔哦嗯欸呃啦耶呀謝請給把被讓幫再又才只太']);
// a one-character cooking word in the piece: 炒 + 魚 is not 草魚, 媽媽煮的 is not 媽蔴竹的
const COOKING_CHARS = new Set([...'炒煎炸蒸煮烤滷燉燙拌燒燜熏']);
const HAN = /^[㐀-鿿]+$/;
const MAX_LEN = 8;

/** One syllable with the Taiwanese-accent merges. */
function looseSyllable(s){
  return String(s || '').toLowerCase()
    .replace(/ü|v/g, 'u')
    .replace(/^zh/, 'z').replace(/^ch/, 'c').replace(/^sh/, 's')
    .replace(/ing$/, 'in').replace(/eng$/, 'en');
}
function syllables(text){
  return pinyin(text, { toneType: 'none', type: 'array', v: true }).map(looseSyllable);
}
function keyOf(text){ return syllables(text).join(' '); }

/** Turns a food-data name into words: 「雞滷蛋(現煮)」 -> 雞滷蛋; 「胡蘿蔔平均值」 -> 胡蘿蔔. */
function wordsFromName(name){
  const out = [];
  String(name || '')
    .replace(/[(（][^)）]*[)）]/g, ' ')
    .replace(/平均值|市售|冷凍|即食/g, ' ')
    .split(/[^㐀-鿿]+/)
    .forEach(w => { if (w.length >= 2 && w.length <= MAX_LEN) out.push(w); });
  return out;
}

function createFixer(words){
  const known = new Set();
  const byKey = new Map(); // loose pinyin -> Set of words
  const add = w => {
    if (!w || w.length < 2 || w.length > MAX_LEN || !HAN.test(w) || known.has(w)) return;
    known.add(w);
    const k = keyOf(w);
    if (!byKey.has(k)) byKey.set(k, new Set());
    byKey.get(k).add(w);
  };
  for (const name of words || []) wordsFromName(name).forEach(add);
  COOKING_WORDS.concat(SEASONING_WORDS, INGREDIENT_WORDS).forEach(add);
  // protected / everyday words: never replaced (they are not targets either)
  const keep = new Set(PROTECTED_WORDS.concat(COMMON_WORDS));

  function fix(text){
    const raw = String(text || '');
    const chars = [...raw];
    const n = chars.length;
    // spans already right: a known word, a protected word, an everyday word
    const locked = new Array(n).fill(false);
    for (let i = 0; i < n; i++){
      for (let len = 2; len <= MAX_LEN && i + len <= n; len++){
        const w = chars.slice(i, i + len).join('');
        if (known.has(w) || keep.has(w)) for (let j = i; j < i + len; j++) locked[j] = true;
      }
    }
    // pinyin of the whole text once (polyphones read in context)
    const sy = (() => {
      try { return pinyin(raw, { toneType: 'none', type: 'array', v: true }).map(looseSyllable); } catch (e){ return null; }
    })();
    if (!sy || sy.length !== n) return { text: raw, changed: false, fixes: [] };
    const fixes = [];
    const out = chars.slice();
    let i = 0;
    while (i < n){
      let done = false;
      for (let len = Math.min(MAX_LEN, n - i); len >= 2 && !done; len--){
        const piece = chars.slice(i, i + len);
        const w = piece.join('');
        if (!HAN.test(w)) continue;
        if (piece.some(c => STOP_CHARS.has(c))) continue;
        if (locked.slice(i, i + len).some(Boolean)) continue;
        if (piece.some(c => COOKING_CHARS.has(c))) continue;
        const hits = byKey.get(sy.slice(i, i + len).join(' '));
        if (!hits) continue;
        const others = [...hits].filter(x => x !== w);
        if (!others.length) continue;
        // the same sound for two or more different foods: leave it as it is
        if (others.length > 1 || hits.size > 1){ done = true; i += 1; break; }
        const to = others[0];
        for (let j = 0; j < len; j++) out[i + j] = j === 0 ? to : '';
        fixes.push({ from: w, to, at: i });
        i += len;
        done = true;
      }
      if (!done) i += 1;
    }
    const fixed = out.join('');
    return { text: fixed, changed: fixed !== raw, fixes };
  }

  return { fix, size: () => known.size, has: w => known.has(w) };
}

module.exports = { createFixer, keyOf, looseSyllable, wordsFromName, COOKING_WORDS, SEASONING_WORDS, INGREDIENT_WORDS, PROTECTED_WORDS, COMMON_WORDS };
