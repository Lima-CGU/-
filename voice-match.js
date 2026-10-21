/**
 * Spoken words -> field values, with a FIXED keyword / homophone table (no AI).
 * Group A uses it to pick options by voice; Groups B/C can share it later.
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
    containerType: [
      [['便當盒', '便當', '飯盒', '餐盒'], 'lunchbox'],
      [['盤子', '盤', '碟子', '碟', '盤的'], 'plate'],
      [['碗', '一碗', '晚'], 'bowl'],
      [['杯子', '杯', '一杯', '悲'], 'cup']
    ],
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
      [['水煮', '煮的', '水主', '水煮的', '煮'], '水煮'],
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
      [['無糖', '沒糖', '不加糖', '沒有糖', '吳糖', '無堂'], '無糖'],
      [['微糖', '一分糖', '二分糖', '四分之一', '圍糖'], '微糖(四分之一)'],
      [['半糖', '一半', '五分糖', '伴糖', '二分之一'], '半糖'],
      [['少糖', '七分糖', '七分', '四分之三'], '少糖(四分之三)'],
      [['全糖', '正常糖', '全甜', '泉糖'], '全糖']
    ],
    salt: [
      [['無鹽', '沒鹽', '不加鹽', '沒有鹽', '吳鹽', '無言'], '無鹽'],
      [['四分之一', '少鹽', '一點點鹽', '一點鹽'], '1/4 茶匙'],
      [['二分之一', '一半', '半茶匙', '半匙'], '1/2 茶匙'],
      [['四分之三'], '3/4 茶匙'],
      [['一茶匙', '一匙', '一整匙', '很鹹', '整匙'], '1 茶匙']
    ]
  };

  // naming the field restricts the words to that field
  const FIELD_WORDS = {
    containerType: ['容器', '裝在', '裝'],
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
  /** 'more' | 'back' | 'next' | null — 下一組 is checked before 下一步. */
  function command(text){
    const t = normalize(text);
    for (const [words, cmd] of COMMANDS) if (words.some(w => t.includes(w))) return cmd;
    return null;
  }

  /** A spoken count 1–99: 「3」「三個」「十二隻」「兩個」, else null. */
  const DIGITS = { 零: 0, 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  function count(text){
    const t = normalize(text);
    const d = /(\d{1,2})/.exec(t);
    if (d) return Number(d[1]) || null;
    const m = /([一二兩三四五六七八九]?)(十?)([一二三四五六七八九]?)/.exec(t.replace(/[^零一二兩三四五六七八九十]/g, ' ').trim());
    if (!m || !m[0]) return null;
    const [, a, ten, b] = m;
    const n = ten ? (a ? DIGITS[a] : 1) * 10 + (b ? DIGITS[b] : 0) : (a ? DIGITS[a] : 0);
    return n || null;
  }

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

    const matches = [];
    const ambiguous = [];
    const taken = new Set();
    const useUp = word => { rest = rest.split(word).join('·'); };
    for (const c of cands){
      if (!rest.includes(c.word)) continue;
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
  const FOOD_AFTER = '(?=[\\u4e00-\\u9fff]{0,4}(雞|鴨|鵝|豬|牛|羊|魚|蝦|蟹|蛋|肉|排|翅|腿|菜|豆|飯|麵|餃|包|粿|糕|餅|薯|瓜|筍|菇|花枝|魷|蚵|丸|腸|塊|片|的))';
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
    [/(少|多|加|無|沒|不加|一點)(言|嚴|顏|研)/g, '$1鹽'],
    [/(無|微|半|少|全|去|沒)(唐|堂|塘)/g, '$1糖'],
    // size: 大分 / 小分 / 半分 / 兩分 → 份 (not 分之 / 分糖)
    [/([大小半兩一])分(?![之糖鐘鍾])/g, '$1份']
  ];
  /** -> { text, changed } — the corrected text and whether anything changed. */
  function fixHomophones(text){
    const raw = String(text || '');
    let out = raw;
    for (const [re, to] of HOMOPHONE_RULES) out = out.replace(re, to);
    return { text: out, changed: out !== raw };
  }

  return { match, command, count, normalize, fixHomophones, TABLE, FIELD_WORDS, COMMANDS };
});
