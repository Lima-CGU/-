/**
 * One dish -> calories. Steps:
 *   1. find up to 10 candidates in foods1000 and 10 in tfnd (nutrition-db)
 *   2. the AI picks ONE candidate by its number + how close it is
 *      (exact / close / approx / none). It never sees or returns a number.
 *   3. nutrition-calc.js does the arithmetic with the picked item.
 * The response carries only this one dish's figures — never the candidates.
 */
'use strict';

const nutrition = require('./nutrition-db');
const calc = require('./nutrition-calc');
const cfg = require('./nutrition-config');

const MATCH_LEVELS = ['exact', 'close', 'approx', 'none'];
const SOURCE_LABEL = { foods1000: '老師提供的食材資料', tfnd: '衛福部食藥署食品營養成分資料庫' };
const CANDIDATES_PER_SOURCE = 10;
const CACHE_MAX = 500;

/* ---------- candidates ---------- */

// The whole name first, then its 2+ character pieces (and finally its last character), longest first and
// (at equal length) nearest the end first — Chinese head nouns come last.
function keywordsFor(name){
  const k = nutrition.normalize(name);
  const out = [k];
  for (let len = k.length - 1; len >= 2; len--){
    for (let start = k.length - len; start >= 0; start--) out.push(k.slice(start, start + len));
  }
  // last, the head noun alone (煎餃 -> 餃, so 水餃 can be offered as a close dish)
  if (k.length >= 2) out.push(k.slice(-1));
  return out;
}

// Interleaves the best hits of every keyword (rank 1 of each, then rank 2 …)
// so one broad keyword can't crowd out the others.
function candidatesFrom(source, name){
  const lists = keywordsFor(name).map(kw => nutrition.searchFoods(kw, { limit: 5, source }));
  const out = [];
  const seen = new Set();
  for (let rank = 0; rank < 5 && out.length < CANDIDATES_PER_SOURCE; rank++){
    for (const list of lists){
      const hit = list[rank];
      if (hit && !seen.has(hit.id) && out.length < CANDIDATES_PER_SOURCE){
        seen.add(hit.id);
        out.push(hit);
      }
    }
  }
  return out;
}

function describeCandidate(c){
  if (c.basis === 'perUnit'){
    const unit = String(c.unit || '').replace(/[(（].*$/, '');
    return `${c.name}(每 1 ${unit}${c.weightG ? `,約 ${c.weightG} g` : ''})`;
  }
  const state = c.description ? `;${String(c.description).slice(0, 40)}` : '';
  return `${c.name}(每 100 g${state})`;
}

/* ---------- AI pick ---------- */

function buildPrompt(input, candidates){
  const isBev = input.category === 'beverage';
  const lines = candidates.map((c, i) => `${i + 1}. ${describeCandidate(c)}`).join('\n');
  return `你是食物營養資料庫的「比對助手」。使用者記錄了一道菜,請從下面的候選清單中,挑出最能代表這道菜的一筆。
菜名:${input.name}(${isBev ? '飲料' : '食物'})
容器:${cfg.CONTAINER_LABELS[input.containerType] || input.containerType}${isBev ? `\n糖量:${input.sugar}` : ''}

候選清單:
${lines}

規則:
- 你只能回傳候選的「編號」和「比對程度」,絕對不能回傳任何熱量或營養數字。
- 比對程度 match:exact = 同一道菜;close = 同一道菜但做法或名稱略有不同;approx = 不同但最接近(例如煎餃→水餃);none = 差太多,不能拿來代表(此時 pick 填 null)。
- 一樣適合時,優先選單位是「份、碗、杯」這類離散單位的品項(不要選以 g 計的)。
- 飲料若糖量是「無糖」,優先選不含糖的品項(例如黑咖啡應選美式咖啡,不是冰咖啡)。
- 像「蘋果切片」這種切開的食物,要考慮份量是否接近:切片不等於一整顆,整顆的份量差太多就不要選。
- 混合菜餚如果清單裡只有生的原料、不適合代表整道菜,請填 none。
請「只」回傳如下格式的 JSON,不要加任何說明文字:
{"pick":3,"match":"close"}`;
}

/* ---------- cache ---------- */

// The pick depends only on what could change WHICH food is the right one:
// the name, food/beverage, the container, and (beverages) whether it's
// sugar-free. Size, salt, cooking method and sugar level never change the pick,
// so a dish re-edited only in those fields reuses it — and the numbers stay
// consistent. Concurrent identical requests share one AI call.
const pickCache = new Map();
const inFlight = new Map();

function pickKey(input){
  const sugarFree = input.category === 'beverage' ? (input.sugar === '無糖' ? 'sf' : 'sw') : '-';
  return [nutrition.normalize(input.name), input.category, input.containerType, sugarFree].join('|');
}

async function pickCandidate(input, askAI){
  const key = pickKey(input);
  if (pickCache.has(key)) return pickCache.get(key);
  if (inFlight.has(key)) return inFlight.get(key);

  const job = (async () => {
    const candidates = [
      ...candidatesFrom('foods1000', input.name),
      ...candidatesFrom('tfnd', input.name)
    ];
    let result = { item: null, match: 'none' };
    if (candidates.length){
      const parsed = await askAI(buildPrompt(input, candidates));
      const match = MATCH_LEVELS.includes(parsed && parsed.match) ? parsed.match : 'none';
      const idx = Number.isInteger(parsed && parsed.pick) ? parsed.pick - 1 : -1;
      const item = candidates[idx] || null;
      if (item && match !== 'none') result = { item, match };
    }
    if (pickCache.size >= CACHE_MAX) pickCache.delete(pickCache.keys().next().value);
    pickCache.set(key, result);
    return result;
  })();
  inFlight.set(key, job);
  try { return await job; } finally { inFlight.delete(key); }
}

/* ---------- main ---------- */

function validate(body){
  const b = body || {};
  const name = String(b.name || '').replace(/\(\d+%\)$/, '').trim();
  if (!name || name.length > 40) return { error: '缺少或不合理的 name。' };
  const category = b.category === 'beverage' ? 'beverage' : 'food';
  if (!cfg.PORTION_TABLE[b.containerType]) return { error: 'containerType 必須是 plate / bowl / cup。' };
  if (!(b.size in cfg.SIZE_MULTIPLIERS.default)) return { error: 'size 必須是 XS / S / M / L / XL。' };
  if (calc.saltTeaspoons(b.salt) === undefined) return { error: 'salt 不在對照表內。' };
  return {
    input: {
      name, category,
      containerType: b.containerType, size: b.size,
      cookingMethod: String(b.cookingMethod || '').slice(0, 20),   // recorded only
      sugar: String(b.sugar || '').slice(0, 20),
      salt: String(b.salt)
    }
  };
}

/**
 * @param body   request body (see validate)
 * @param askAI  async (prompt) => parsed JSON object
 */
async function estimate(body, askAI){
  const v = validate(body);
  if (v.error) return { httpStatus: 400, error: v.error };
  const input = v.input;
  await nutrition.init();

  const { item, match } = await pickCandidate(input, askAI);
  const base = { name: input.name, cookingMethod: input.cookingMethod, sugar: input.sugar, salt: input.salt };
  if (!item){
    return { httpStatus: 200, status: 'none', match: 'none', ...base, explanation: '資料庫中找不到足以代表這道菜的品項,無法估算。' };
  }

  const r = calc.compute(item, input);
  if (r.status === 'anomaly'){
    console.warn(`[nutrition] ANOMALY: "${input.name}" matched "${item.name}" (${item.source}) -> ${r.perGram} kcal/g over ${r.grams} g, exceeds ${cfg.MAX_KCAL_PER_GRAM}; numbers withheld`);
    return { httpStatus: 200, status: 'anomaly', match, matchedName: item.name, source: item.source, sourceLabel: SOURCE_LABEL[item.source], ...base, explanation: '換算後的熱量異常,視為資料異常,不顯示數字。' };
  }
  if (r.status !== 'ok'){
    console.warn(`[nutrition] cannot compute "${input.name}" with "${item.name}" (${item.source}): ${r.reason}`);
    return { httpStatus: 200, status: 'none', match: 'none', ...base, explanation: '這個品項缺少換算所需的資料,無法估算。' };
  }
  const { status, ...numbers } = r;
  return {
    httpStatus: 200,
    status: 'ok',
    match,
    matchedName: item.name,
    source: item.source,
    sourceLabel: SOURCE_LABEL[item.source],
    unit: item.basis === 'perUnit' ? String(item.unit || '').replace(/[(（].*$/, '') : '100 g',
    ...base,
    ...numbers
  };
}

module.exports = { estimate, validate, SOURCE_LABEL };
