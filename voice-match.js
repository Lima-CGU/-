/**
 * Spoken words -> field values, with a FIXED keyword / homophone table (no AI).
 * Group A uses it to pick options by voice; Groups B/C use fixHomophones.
 *
 *   PictaVoiceMatch.match(text, { category })
 *     -> { matches: [{ field, value, heard }], ambiguous: [heard…] }
 *
 * How it reads one utterance:
 *  1. normalise (spaces, full-width digits, 「2分之1」 -> 二分之一 …);
 *  2. every field's words count, longest first;
 *  3. a word that several fields share (e.g. 四分之一 = salt or sugar) goes to
 *     the field the user named (鹽 / 糖 / 容器 / 份量 / 烹調 …) — 「鹽二分之一」 is
 *     salt, 「糖四分之一」 is sugar; with no such name it is ambiguous, not used;
 *  4. at most one value per field; matched text is used up, so 「半糖」 is not
 *     also read as size 「半份」.
 * Homophones are listed per field: in 烹調方式 「真的 / 針的 / 貞的」 are 蒸.
 */
(function (root, factory){
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PictaVoiceMatch = factory();
})(typeof self !== 'undefined' ? self : this, function (){
  'use strict';

  // field -> [ [spoken words…], value ]   (homophones included)
  const TABLE = {
    // (no containerType: the container field was removed 10/22)
    size: [
      [['特小', '一點點', '幾口', '很少', '半份', 'XS', 'xs'], 'XS'],
      [['小份', '少一點', '少量', '小'], 'S'],
      [['中份', '一般', '正常', '普通', '一份', '中'], 'M'],
      [['大份', '多一點', '大'], 'L'],
      [['特大', '超大', '很多', '兩份', 'XL', 'xl'], 'XL']
    ],
    cookingFood: [
      [['生食', '生的', '生吃', '沒煮', '升的'], '生食'],
      [['沙拉', '莎拉', '殺拉'], '沙拉'],
      [['水煮', '煮的', '水主', '水煮的', '煮', '汆燙', '川燙', '燙的', '燙'], '水煮'],
      [['蒸', '蒸的', '真的', '針的', '貞的', '真', '針', '貞', '爭的'], '蒸'],
      [['炒', '炒的', '吵', '吵的'], '炒'],
      [['煎', '煎的', '尖', '尖的', '堅', '堅的', '奸的'], '煎'],
      [['炸', '炸的', '詐', '詐的', '乍', '乍的'], '炸'],
      [['燒烤', '烧烤', '燒考', 'BBQ', 'bbq'], '燒烤'],
      [['烤', '烤的', '考', '考的', '拷'], '烤'],
      [['滷', '滷的', '魯', '魯的', '鹵', '鹵的'], '滷'],
      [['燉', '燉的', '頓', '頓的', '炖'], '燉'],
      [['烘焙', '烘烤', '紅焙', '烘培'], '烘焙']
    ],
    cookingBeverage: [
      [['沖泡', '衝泡', '泡的'], '沖泡'],
      [['現煮', '線煮'], '現煮'],
      [['現榨', '線榨', '鮮榨'], '現榨'],
      [['冰鎮', '冰的', '冰'], '冰鎮'],
      [['熱飲', '熱的', '熱'], '熱飲'],
      [['調製', '調的'], '調製'],
      [['不適用', '沒有', '都不是'], '不適用']
    ],
    sugar: [
      [['無糖', '沒糖', '不加糖', '沒有糖', '沒加糖', '沒有加糖', '不要糖', '不要加糖', '吳糖', '無堂'], '無糖'],
      [['微糖', '一分糖', '二分糖', '四分之一', '圍糖'], '微糖(四分之一)'],
      [['半糖', '一半', '五分糖', '伴糖', '二分之一'], '半糖'],
      [['少糖', '七分糖', '七分', '四分之三'], '少糖(四分之三)'],
      [['全糖', '正常糖', '全甜', '泉糖'], '全糖']
    ],
    salt: [
      [['無鹽', '沒鹽', '不加鹽', '沒有鹽', '沒加鹽', '沒有加鹽', '不要鹽', '不要加鹽', '吳鹽', '無言'], '無鹽'],
      [['四分之一', '少鹽', '一點點鹽', '一點鹽'], '1/4 茶匙'],
      [['二分之一', '一半', '半茶匙', '半匙'], '1/2 茶匙'],
      [['四分之三'], '3/4 茶匙'],
      [['一茶匙', '一匙', '一整匙', '很鹹', '整匙'], '1 茶匙']
    ]
  };

  // naming the field restricts the words to that field
  const FIELD_WORDS = {
    size: ['份量', '分量', '大小', '尺寸'],
    cookingMethod: ['烹調', '煮法', '做法', '作法', '料理方式', '方式'],
    sugar: ['糖', '甜度', '甜'],
    salt: ['鹽', '鹹度', '鹹']
  };

  function normalize(text){
    return String(text || '')
      .replace(/[\s，。、！？,.!?]/g, '')
      .replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
      .replace(/([1-4])\/([1-4])/g, (m, a, b) => `${b}分之${a}`) // 1/2 -> 2分之1
      .replace(/(\d)分之(\d)/g, (m, a, b) => `${'〇一二三四'[a] || a}分之${'〇一二三四'[b] || b}`)
      .replace(/兩分之一/g, '二分之一')
      .replace(/1茶匙|1匙/g, '一茶匙')
      .replace(/½/g, '二分之一');
  }

  function entriesFor(field, category){
    if (field === 'cookingMethod') return TABLE[category === 'beverage' ? 'cookingBeverage' : 'cookingFood'];
    return TABLE[field];
  }

  // Page commands (Group A, one field per page), checked before options
  const COMMANDS = [
    [['換一組', '下一組', '其他', '別的', '換別的', '再換'], 'more'],
    [['上一步', '上一頁', '回上一'], 'back'],
    [['下一步', '下一頁', '好了', '可以了', '確定', '完成'], 'next']
  ];
  // these only at the START of what was said (「下一個」 = next), never
  // inside a sentence: 「桌上一個」「剩下一個」 are counts, not commands
  const START_COMMANDS = [
    [new RegExp(`^${'(嗯|欸|呃|啊|那|好|請|再|我要|回到|回)*'}(上一個|前一個)`), 'back'],
    [new RegExp(`^${'(嗯|欸|呃|啊|那|好|請|再|我要|回到|回)*'}(下一個|下一道)`), 'next']
  ];
  // words with a 一 that is not a count (「再來一個」 is simply ignored)
  const NOT_A_COUNT = /^(嗯|欸|呃|啊|那|好|請|再|我要|回到|回)*(下一|上一|前一)(個|道)|(下一|上一|回上一)(步|頁|組|題)|再來一個|換一組|一點|一下/g;
  /** 'more' | 'back' | 'next' | null — 下一組 is checked before 下一步. */
  function command(text){
    const t = normalize(text);
    for (const [words, cmd] of COMMANDS) if (words.some(w => t.includes(w))) return cmd;
    for (const [re, cmd] of START_COMMANDS) if (re.test(t)) return cmd;
    return null;
  }

  /** A spoken count 1–99, or 'all' (「全部」): only a clear number —
   *  digits (「4」「4 個」), a Chinese number with a unit (「三塊」「十二隻」「兩個」),
   *  or a Chinese number said on its own (「三」) except a lone 「一」. A 一 inside
   *  a word (「下一步」「換一組」「一點」) is never a count. Else null.
   *  (The caller checks command() first: 「下一步」 is a command, not 1.) */
  const DIGITS = { 零: 0, 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const COUNT_UNITS = '個隻顆片根塊粒條份碗盤杯支串尾';
  const CN_NUM = '([一二兩三四五六七八九]?十[一二三四五六七八九]?|[一二兩三四五六七八九])';
  function cnNumber(s){
    const m = /^([一二兩三四五六七八九]?)(十?)([一二三四五六七八九]?)$/.exec(s);
    if (!m) return null;
    const [, a, ten, b] = m;
    const n = ten ? (a ? DIGITS[a] : 1) * 10 + (b ? DIGITS[b] : 0) : (a ? DIGITS[a] : 0);
    return n || null;
  }
  function count(text){
    // (11/17) a decimal (3.5 / 三點五) is not a count; only whole numbers 1–50
    if (/[0-9０-９][.．點][0-9０-９]|[一二兩三四五六七八九十]點[一二三四五六七八九]/.test(String(text || ''))) return null;
    const inRange = n => (Number.isInteger(n) && n >= 1 && n <= 50 ? n : null);
    const t = normalize(text).replace(NOT_A_COUNT, '·');
    if (/全部|全吃|都吃完|吃光/.test(t)) return 'all';
    const d = /(\d+)/.exec(t);
    if (d) return inRange(Number(d[1]));
    const withUnit = new RegExp(CN_NUM + '[' + COUNT_UNITS + ']').exec(t);
    if (withUnit) return inRange(cnNumber(withUnit[1]));
    const alone = t.replace(/^(吃了|我吃了|有|共|總共)/, '').replace(/[了啦喔吧]$/, '');
    if (new RegExp('^' + CN_NUM + '$').test(alone) && alone !== '一') return inRange(cnNumber(alone));
    return null;
  }

  // (11/17 RA) 「不要…」「沒有加…」「不是…」 right before a value word
  // (also 「不太大」「沒有很大」「不會太大」: a degree word between)
  const NEGATION_BEFORE = /(不要|不想|不用|不加|不放|不是|沒有|沒加|沒放|別|沒|不)(加|放|用|要)?(太|很|會太|會很|會|那麼|算)?$/;
  const NEGATIVE_VALUES = ['無糖', '無鹽', '不適用'];
  // a size character inside an ordinary word
  const NOT_A_SIZE = /大概|大約|大致|大家|大部分|大多|大多數|大小|不大|中間|中午|小心|小時|不小|大部份|差不多大(?!份)/g;

  // opts.fields: only these fields (e.g. the one on the current page)
  function match(text, opts = {}){
    const category = opts.category === 'beverage' ? 'beverage' : 'food';
    let rest = normalize(text);
    const fields = Array.isArray(opts.fields) && opts.fields.length ? opts.fields.filter(f => FIELD_WORDS[f]) : Object.keys(FIELD_WORDS);
    // fields the user named (鹽 / 糖 / 容器 …): they win when a word is shared
    const named = fields.filter(f => FIELD_WORDS[f].some(w => rest.includes(w)));

    // every (word, field, value), longest word first
    const cands = [];
    fields.forEach(field => entriesFor(field, category).forEach(([words, value]) => {
      words.forEach(w => cands.push({ field, value, word: normalize(w) || w }));
    }));
    cands.sort((a, b) => b.word.length - a.word.length);

    // (11/17 RA) words that only look like a size: 「大概」「不大」 is not 大 (L)
    if (fields.includes('size')) rest = rest.replace(NOT_A_SIZE, '·');

    const matches = [];
    const ambiguous = [];
    const taken = new Set();
    const useUp = word => { rest = rest.split(word).join('·'); };
    for (const c of cands){
      if (!rest.includes(c.word)) continue;
      // (11/17 RA) 「不要全糖」「不是炸的」: a negated value is never picked — not
      // understood, the page asks again (「沒有加糖」「不要鹽」 are 無糖 / 無鹽 words)
      const before = rest.slice(0, rest.indexOf(c.word));
      if (NEGATION_BEFORE.test(before) && !NEGATIVE_VALUES.includes(c.value)){
        if (!ambiguous.includes(c.word)) ambiguous.push(c.word);
        useUp(c.word);
        continue;
      }
      // every field (not decided yet) that has this exact word
      const owners = cands.filter(o => o.word === c.word && !taken.has(o.field));
      if (!owners.length) continue;
      let pick = owners.length === 1 ? owners[0] : null;
      if (!pick){
        const namedOwners = owners.filter(o => named.includes(o.field));
        if (namedOwners.length === 1) pick = namedOwners[0];
      }
      if (!pick){
        if (!ambiguous.includes(c.word)) ambiguous.push(c.word);
        useUp(c.word);
        continue;
      }
      matches.push({ field: pick.field, value: pick.value, heard: c.word });
      taken.add(pick.field);
      useUp(c.word);
    }
    return { matches, ambiguous };
  }

  /* ---------- Groups B/C: fix speech homophones before the text goes to the AI ----------
     Only in a cooking / size / sugar / salt context, so ordinary words stay:
     「真的雞」→「蒸的雞」, but 「真的很好吃」 is left alone. */
  // (11/17) a food word right after (at most one character between), so 「真的雞」 is
  // 蒸的雞 but 「我真的吃了牛肉」「真的很好吃的」 stay as they are
  const FOOD_AFTER = '(?=[\\u4e00-\\u9fff]?(雞|鴨|鵝|豬|牛|羊|魚|蝦|蟹|蛋|肉|排|翅|腿|菜|豆|飯|麵|餃|包|粿|糕|餅|薯|瓜|筍|菇|花枝|魷|蚵|丸|腸|塊|片))';
  const HOMOPHONE_RULES = [
    // cooking: 「X的 + food」 or 「用X的」
    [new RegExp('(真|針|貞|爭)的' + FOOD_AFTER, 'g'), '蒸的'],
    [new RegExp('(詐|乍)的' + FOOD_AFTER, 'g'), '炸的'],
    [new RegExp('(尖|堅|奸)的' + FOOD_AFTER, 'g'), '煎的'],
    [new RegExp('吵的' + FOOD_AFTER, 'g'), '炒的'],
    [new RegExp('考的' + FOOD_AFTER, 'g'), '烤的'],
    [new RegExp('魯的' + FOOD_AFTER, 'g'), '滷的'],
    [new RegExp('頓的' + FOOD_AFTER, 'g'), '燉的'],
    [/用(真|針|貞)的/g, '用蒸的'], [/用(詐|乍)的/g, '用炸的'], [/用(尖|堅)的/g, '用煎的'],
    [/用吵的/g, '用炒的'], [/用考的/g, '用烤的'], [/用魯的/g, '用滷的'], [/用頓的/g, '用燉的'],
    // 「吵青菜」「吵飯」: 吵 right before a food word
    [/吵(?=(青菜|高麗菜|空心菜|菠菜|地瓜葉|飯|麵|蛋|肉|蝦|豆))/g, '炒'],
    [/魯(?=(肉|蛋|豆干|雞腿|牛肉|味))/g, '滷'],
    // salt / sugar
    // (only as the end of a phrase: 「少言」「多言一點」, not 「很多顏色」「多研究」)
    [/(少|多|加|無|沒|不加|一點)(言|嚴|顏|研)(?=$|[\s，。,.!！?？、]|一點|點|些)/g, '$1鹽'],
    [/(無|微|半|少|全|去|沒)(唐|堂|塘)/g, '$1糖'],
    // size: 大分 / 小分 / 半分 / 兩分 → 份 (not 分之 / 分糖)
    [/([大小半兩一])分(?![之糖鐘鍾熟])/g, '$1份']
  ];
  /** -> { text, changed } — the corrected text and whether anything changed. */
  function fixHomophones(text){
    const raw = String(text || '');
    let out = raw;
    for (const [re, to] of HOMOPHONE_RULES) out = out.replace(re, to);
    return { text: out, changed: out !== raw };
  }

  /* ---------- food homophones (teacher 11/15: 「薑絲」 heard as 「殭屍」) ----------
     Speech (the App's 🎤 or the phone keyboard's dictation) can turn a food
     into a common word. A FIXED table, no AI. Two kinds:
     - ALWAYS: never a word in a meal description -> always the food;
     - IN_LIST: a real word too (輕鬆 = relaxed): only changed in a field
       that holds food names (opts.foodInput), or in a chat message when it
       stands like a list item (after 加 / 有 / 和 / 、 … or the start, and
       before 和 / 以及 / 、 / ， … or the end). Otherwise the text stays. */
  const FOOD_ALWAYS = [
    [['殭屍', '僵屍', '薑屍', '江絲', '姜絲'], '薑絲'],
    [['九成塔', '酒層塔', '九層踏', '九曾塔'], '九層塔'],
    [['算頭', '蒜投'], '蒜頭'],
    [['算末'], '蒜末'],
    [['聰花', '沖花'], '蔥花'],
    [['清聰', '青聰'], '青蔥'],
    [['香彩'], '香菜']
  ];
  const FOOD_IN_LIST = [
    [['輕鬆', '青松', '清松'], '青蔥'],
    [['將士'], '薑絲']
  ];
  const LIST_BEFORE = /(^|[加有放和跟及、，,。\s了])$/;
  const LIST_AFTER = /^($|[以和跟及、，,。！!？?\s等])/;
  /** -> { text, changed, fixes: [{ from, to }] } */
  function fixFoodWords(text, opts = {}){
    const raw = String(text || '');
    let out = raw;
    const fixes = [];
    const swap = (from, to, test) => {
      let k = out.indexOf(from);
      while (k >= 0){
        if (!test || test(out.slice(0, k), out.slice(k + from.length))){
          out = out.slice(0, k) + to + out.slice(k + from.length);
          fixes.push({ from, to });
          k = out.indexOf(from, k + to.length);
        } else k = out.indexOf(from, k + from.length);
      }
    };
    FOOD_ALWAYS.forEach(([words, to]) => words.forEach(w => swap(w, to)));
    FOOD_IN_LIST.forEach(([words, to]) => words.forEach(w => swap(w, to,
      opts.foodInput ? null : (before, after) => LIST_BEFORE.test(before) && LIST_AFTER.test(after))));
    return { text: out, changed: out !== raw, fixes };
  }

  /** 調味 page (11/01): 「醬油」「米酒」, or 「沒有 / 沒加 / 不加」 = 沒有特別調味.
   *  -> the values heard (never both a seasoning and 沒有特別調味). */
  const SEASONING_WORDS = [[['醬油', '豆油', '醬由'], '醬油'], [['米酒'], '米酒']];
  // 「沒有醬油」「不加米酒」 name a seasoning that was NOT used: it is skipped
  // (and does not mean 沒有特別調味 either — other seasonings may be used)
  const NEGATED_BEFORE = /(沒有|沒加|不加|沒放|不要|不用|不放|別|沒|不)[加放用要]?$/;
  // (11/17 RA) 「沒有加醬油跟米酒」: the negation covers the whole list
  const LIST_JOIN = /^(跟|和|及|以及|還有|與|或|或是)$/;
  function seasonings(text){
    // a comma / space ends a phrase: 「沒有，醬油有」 is not 「沒有醬油」
    const t = String(text || '').replace(/[\s，,。、;；!！?？]+/g, '|');
    const out = [];
    let named = false;
    // every seasoning mentioned, in the order said
    const hits = [];
    SEASONING_WORDS.forEach(([words, value]) => words.forEach(w => {
      for (let k = t.indexOf(w); k >= 0; k = t.indexOf(w, k + 1)) hits.push({ k, end: k + w.length, value });
    }));
    hits.sort((a, b) => a.k - b.k);
    let negated = false;
    let prevEnd = -1;
    hits.forEach(h => {
      named = true;
      const gap = prevEnd >= 0 ? t.slice(prevEnd, h.k) : null;
      // negated right before it, or joined by 跟 / 和 … to a negated one
      negated = NEGATED_BEFORE.test(t.slice(Math.max(0, h.k - 3), h.k)) || (negated && gap !== null && LIST_JOIN.test(gap));
      if (!negated && !out.includes(h.value)) out.push(h.value);
      prevEnd = h.end;
    });
    // (11/17 RA) only negated ones (「不要醬油」「沒有加醬油跟米酒」): 沒有特別調味
    if (named && !out.length) return ['沒有特別調味'];
    if (out.length || named) return out;
    return /沒有|沒加|不加|沒放|都沒|無調味/.test(t) ? ['沒有特別調味'] : [];
  }

  return { match, command, count, normalize, fixHomophones, fixFoodWords, FOOD_ALWAYS, FOOD_IN_LIST, seasonings, TABLE, FIELD_WORDS, COMMANDS, NOT_A_COUNT };
});
