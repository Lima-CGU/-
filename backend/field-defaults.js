/**
 * Field options, food types and per-type defaults — ONE file for both sides:
 *   backend:  require('./field-defaults')          (server.js, chat.js, nutrition-*)
 *   frontend: <script src="backend/field-defaults.js"> -> window.PictaFieldDefaults
 * (GitHub Pages serves the whole repo, so the page loads this very file —
 * there is no second copy to keep in sync.) Change values HERE only.
 *
 * Every default and every "relevant options" list is 【待老師確認】.
 */
(function (root, factory){
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PictaFieldDefaults = factory();
})(typeof self !== 'undefined' ? self : this, function (){
  'use strict';

  /* ---------- the five fields' allowed values ---------- */
  const OPTIONS = {
    // (「直接拿」 'none' was removed on 10/22: a fruit simply has no container field)
    containerType: ['plate', 'bowl', 'cup', 'lunchbox'],
    size: ['XS', 'S', 'M', 'L', 'XL'],
    cookingMethodFood: ['生食', '沙拉', '水煮', '蒸', '炒', '煎', '炸', '烤', '燒烤', '滷', '燉', '烘焙'],
    cookingMethodBeverage: ['沖泡', '現煮', '現榨', '冰鎮', '熱飲', '調製', '不適用'],
    sugar: ['無糖', '微糖(四分之一)', '半糖', '少糖(四分之三)', '全糖'],
    salt: ['無鹽', '1/4 茶匙', '1/2 茶匙', '3/4 茶匙', '1 茶匙']
  };
  const FIELDS = ['containerType', 'size', 'cookingMethod', 'sugar', 'salt'];
  // 'none' stays only so records saved between 10/21 and 10/22 still read well
  const CONTAINER_LABELS = { plate: '盤子', bowl: '碗', cup: '杯子', lunchbox: '便當盒', none: '直接拿' };

  /* ---------- food types (from /api/detect) ---------- */
  const FOOD_TYPES = ['staple', 'protein', 'vegetable', 'soup', 'fruit', 'beverage', 'snack', 'other'];
  const FOOD_TYPE_LABELS = {
    staple: '主食', protein: '蛋白質', vegetable: '蔬菜', soup: '湯品',
    fruit: '水果', beverage: '飲料', snack: '點心', other: '其他'
  };
  // anything else -> 'other'; a beverage category always means foodType beverage
  function normalizeFoodType(v, category){
    if (category === 'beverage') return 'beverage';
    const t = String(v || '').trim().toLowerCase();
    if (!FOOD_TYPES.includes(t)) return 'other';
    // a solid food the AI called a beverage type: keep the category's word
    return t === 'beverage' && category && category !== 'beverage' ? 'other' : t;
  }

  /* ---------- fields that apply to each food type 【待老師確認】 ----------
     A field that doesn't apply is not shown, gets no preset, is saved as
     null with fieldSource 'na', and is not needed for a dish to be filled.
     'count' = the 數量 step (other types get it only when the dish is countable). */
  const ALL_FIELDS = ['containerType', 'size', 'cookingMethod', 'sugar', 'salt'];
  const APPLICABLE = {
    fruit:    ['size', 'count'],                     // 【待老師確認】
    beverage: ['containerType', 'size', 'sugar']     // 【待老師確認】
    // every other type: all five fields (+ count when countable) 【待老師確認】
  };
  /** The five-field keys that apply (no 'count'). */
  function applicableFields(foodType, category){
    const t = normalizeFoodType(foodType, category);
    return (APPLICABLE[t] || ALL_FIELDS).filter(f => f !== 'count');
  }
  /** Does this type always have a 數量 step (not only when countable)? */
  function alwaysCounted(foodType, category){
    const t = normalizeFoodType(foodType, category);
    return !!(APPLICABLE[t] && APPLICABLE[t].includes('count'));
  }

  // a type that always has a 數量 step (fruit) starts at this many when the
  // photo gave no count (Group A; shown selected, the user can change it)
  const DEFAULT_COUNT = 1; // 【待老師確認】

  /* ---------- defaults per food type 【待老師確認】 ----------
     cookingMethod here is only the fallback when the dish name has no
     cooking word (see cookingFromName); '' = left empty for the user. */
  const DEFAULTS = {
    staple:    { containerType: 'bowl',  size: 'M', cookingMethod: '',    sugar: '無糖', salt: '無鹽' },     // 【待老師確認】
    protein:   { containerType: 'plate', size: 'M', cookingMethod: '',    sugar: '無糖', salt: '1/4 茶匙' }, // 【待老師確認】
    vegetable: { containerType: 'plate', size: 'M', cookingMethod: '',    sugar: '無糖', salt: '1/4 茶匙' }, // 【待老師確認】
    soup:      { containerType: 'bowl',  size: 'M', cookingMethod: '',    sugar: '無糖', salt: '1/4 茶匙' }, // 【待老師確認】
    fruit:     { size: 'M' },                                    // 【待老師確認】 (only size + count apply)
    beverage:  { containerType: 'cup',   size: 'M', sugar: '無糖' },       // 【待老師確認】 (no cooking / salt)
    snack:     { containerType: 'plate', size: 'M', cookingMethod: '',    sugar: '半糖', salt: '無鹽' },     // 【待老師確認】
    other:     { containerType: 'plate', size: 'M', cookingMethod: '',    sugar: '無糖', salt: '1/4 茶匙' }  // 【待老師確認】
  };

  /* ---------- option cards (Group A, one field per page) 【待老師確認】 ----------
     A page shows one group of 3–4 cards; 「其他 ↻」 shows the next group and
     wraps back to the first. The group holding the dish's preset is shown
     first. CARD_GROUPS_BY_TYPE overrides a field for one food type. */
  // A field with at most 6 options shows them all on one page (no 「其他 ↻」);
  // only a longer list (food cooking methods) is split into groups of ≤ 6.
  const MAX_CARDS_PER_PAGE = 6;
  const CARD_GROUPS = {
    containerType: [['plate', 'bowl', 'lunchbox', 'cup']],
    size: [['XS', 'S', 'M', 'L', 'XL']],
    cookingMethod: [['炒', '煎', '炸', '蒸', '水煮', '烤'], ['滷', '燉', '燒烤', '生食', '沙拉', '烘焙']],
    cookingMethodBeverage: [['沖泡', '現煮', '現榨', '冰鎮', '熱飲', '調製'], ['不適用']],
    sugar: [['無糖', '微糖(四分之一)', '半糖', '少糖(四分之三)', '全糖']],
    salt: [['無鹽', '1/4 茶匙', '1/2 茶匙', '3/4 茶匙', '1 茶匙']]
  };
  // which options a food type offers / in what order (便當盒 only for
  // staple, protein, vegetable and other) 【待老師確認】
  const CARD_GROUPS_BY_TYPE = {
    staple:    { containerType: [['bowl', 'plate', 'lunchbox', 'cup']] },
    protein:   { containerType: [['plate', 'bowl', 'lunchbox', 'cup']] },
    vegetable: { containerType: [['plate', 'bowl', 'lunchbox', 'cup']] },
    other:     { containerType: [['plate', 'bowl', 'lunchbox', 'cup']] },
    soup:      { containerType: [['bowl', 'cup', 'plate']] },
    beverage:  { containerType: [['cup', 'bowl', 'plate']] },
    snack:     { containerType: [['plate', 'bowl', 'cup']] },
    fruit:     { containerType: [['plate', 'bowl', 'cup']] }
  };
  /** The card groups for one field of one dish; the group with `current` first. */
  function cardGroups(field, foodType, category, current){
    const t = normalizeFoodType(foodType, category);
    const key = field === 'cookingMethod' && category === 'beverage' ? 'cookingMethodBeverage' : field;
    const own = (CARD_GROUPS_BY_TYPE[t] || {})[field];
    const groups = ((category === 'beverage' && field === 'cookingMethod') ? CARD_GROUPS[key] : (own || CARD_GROUPS[key])).map(g => g.slice());
    // a current value the type's list lacks (e.g. set in the Diary) is still shown
    if (current && !groups.some(g => g.includes(current))){
      const last = groups[groups.length - 1];
      if (last.length < MAX_CARDS_PER_PAGE) last.push(current); else groups.push([current]);
    }
    const i = groups.findIndex(g => g.includes(current));
    return i > 0 ? groups.slice(i).concat(groups.slice(0, i)) : groups;
  }

  /* ---------- cooking word in the dish name -> cooking method ----------
     Longest / most specific first (燒烤 before 烤, 水煮 before 煮). 生 means
     生食 only as a word of its own (生魚片, 生菜 …), not inside 花生 / 生煎. */
  const COOKING_KEYWORDS = [
    ['燒烤', '燒烤'], ['烘焙', '烘焙'], ['沙拉', '沙拉'], ['水煮', '水煮'],
    ['炒', '炒'], ['煎', '煎'], ['炸', '炸'], ['烤', '烤'], ['蒸', '蒸'],
    ['滷', '滷'], ['燉', '燉'], ['煮', '水煮']
  ];
  const RAW_WORDS = /生魚片|生菜|生食|生鮮|生吃|涼拌/;
  const BEVERAGE_KEYWORDS = [['現榨', '現榨'], ['現煮', '現煮'], ['沖泡', '沖泡'], ['冰鎮', '冰鎮'], ['熱', '熱飲'], ['調酒', '調製']];

  function cookingFromName(name, category){
    const n = String(name || '').replace(/\(\d+%\)$/, '');
    if (category === 'beverage'){
      const hit = BEVERAGE_KEYWORDS.find(([k]) => n.includes(k));
      return hit ? hit[1] : '';
    }
    const hit = COOKING_KEYWORDS.find(([k]) => n.includes(k));
    if (hit) return hit[1];
    return RAW_WORDS.test(n) ? '生食' : '';
  }

  /** The default value of every field for one dish: { containerType, size, cookingMethod?, sugar, salt }. */
  function defaultsFor(name, foodType, category){
    const t = normalizeFoodType(foodType, category);
    const d = { ...DEFAULTS[t] };
    const fields = applicableFields(t, category);
    if (fields.includes('cookingMethod')) d.cookingMethod = cookingFromName(name, category) || d.cookingMethod;
    // only the fields that apply get a preset
    Object.keys(d).forEach(k => { if (!d[k] || !fields.includes(k)) delete d[k]; });
    return d;
  }

  /* ---------- food type of a dish that has none (added in the chat) ----------
     A keyword guess from the name; 'other' when nothing fits. */
  const TYPE_WORDS = [
    ['soup', /湯|羹/],
    ['fruit', /蘋果|香蕉|柿|橘|柑|橙|柳丁|葡萄|芭樂|奇異果|鳳梨|芒果|西瓜|哈密瓜|木瓜|草莓|藍莓|櫻桃|水梨|梨子|桃子|水蜜桃|荔枝|龍眼|火龍果|蓮霧|棗|水果/],
    ['snack', /蛋糕|餅乾|布丁|甜甜圈|冰淇淋|巧克力|甜點|點心|鬆餅|蛋塔|麻糬|果凍|洋芋片|雪花冰/],
    ['staple', /飯|麵|粥|吐司|麵包|饅頭|包子|水餃|煎餃|餃|粄條|米粉|冬粉|燒餅|蛋餅|三明治|漢堡|貝果|壽司|地瓜|馬鈴薯|玉米/],
    ['protein', /雞|鴨|鵝|豬|牛|羊|魚|蝦|蟹|貝|蚵|花枝|魷|肉|排骨|蛋|豆腐|豆干|豆皮|培根|火腿|香腸/],
    ['vegetable', /菜|青江|空心|高麗|花椰|筍|菇|茄子|苦瓜|絲瓜|南瓜|豆芽|四季豆|秋葵|蘿蔔|番茄|小黃瓜|洋蔥|沙拉/]
  ];
  function guessFoodType(name, category){
    if (category === 'beverage') return 'beverage';
    const n = String(name || '');
    const hit = TYPE_WORDS.find(([, re]) => re.test(n));
    return hit ? hit[0] : 'other';
  }

  return {
    DEFAULT_COUNT, MAX_CARDS_PER_PAGE, OPTIONS, FIELDS, CONTAINER_LABELS, FOOD_TYPES, FOOD_TYPE_LABELS, DEFAULTS, APPLICABLE, CARD_GROUPS, CARD_GROUPS_BY_TYPE, COOKING_KEYWORDS,
    normalizeFoodType, cookingFromName, defaultsFor, applicableFields, alwaysCounted, cardGroups, guessFoodType
  };
});
