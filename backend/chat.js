/**
 * Group B (conversational reporting): one chat turn.
 *
 *   POST /api/chat  { dishes, selected, history, message }
 *     dishes   [{ no, name, category, onPhoto, fields: {containerType,size,cookingMethod,sugar,salt}, notes: [] }]
 *     selected { type: 'dish', no } | { type: 'meal' } | null
 *     history  [{ role: 'user'|'assistant', content }]   (recent turns, oldest first)
 *     message  what the user just said
 *   -> { reply, updates, notes, newDishes, renameDishes, isClarification }
 *
 * The AI only turns what the user said into the SAME five fields Group A
 * fills in. Every value it returns is checked against the option lists
 * below (copied from script.js — keep them in sync); anything else is
 * dropped. The reply never carries calorie / nutrient numbers (the page
 * shows those itself, from /api/nutrition).
 */
'use strict';

// Same values as script.js containerOptions / sizeOptions /
// FOOD_COOKING_METHODS / BEVERAGE_COOKING_METHODS / sugarOptions / saltOptions.
const OPTIONS = {
  containerType: ['plate', 'bowl', 'cup'],
  size: ['XS', 'S', 'M', 'L', 'XL'],
  cookingMethodFood: ['沙拉', '水煮', '蒸', '炒', '煎', '炸', '烤', '燒烤', '烘焙'],
  cookingMethodBeverage: ['沖泡', '現煮', '現榨', '冰鎮', '熱飲', '調製', '不適用'],
  sugar: ['無糖', '微糖(四分之一)', '半糖', '少糖(四分之三)', '全糖'],
  salt: ['無鹽', '1/4 茶匙', '1/2 茶匙', '3/4 茶匙', '1 茶匙']
};
const FIELDS = ['containerType', 'size', 'cookingMethod', 'sugar', 'salt'];
const CONTAINER_LABEL = { plate: '盤子', bowl: '碗', cup: '杯子' };
const MAX_HISTORY = 12;
const MAX_NEW_DISHES = 5;

const SYSTEM_PROMPT = `你是「飲食記錄助手」,幫使用者把一餐吃了什麼整理成紀錄。照片上的菜已經由系統辨識並編號。
說話方式:繁體中文、口語、簡短親切(回覆 1~3 句,加上條列)。
你只整理使用者說的內容:不評論飲食好壞、不給營養或健康建議、絕對不要寫出任何熱量、卡路里或營養素數字(系統會另外顯示)。

每道菜有 5 個欄位,值只能從下列選項挑,使用者沒說、也判斷不出來就不要填(不要猜):
- containerType 容器:plate(盤子)、bowl(碗)、cup(杯子)。使用者說「一碗」→ bowl,「一盤」→ plate,「一杯」→ cup;飲料通常是 cup。
- size 份量(相對於一般一人份):XS = 半份/一半/幾口;S = 少一點/小份;M = 一份/一碗/一盤/一杯/一個/一片/一塊/一顆/一根/一條/正常份量(使用者說了這類數量就要填 size);L = 一份半/大碗/多一點;XL = 兩份/兩碗/很多。
- cookingMethod 烹調方式:食物用 ${OPTIONS.cookingMethodFood.join('、')};飲料用 ${OPTIONS.cookingMethodBeverage.join('、')}。
- sugar 糖:${OPTIONS.sugar.join('、')}(多用於飲料)。
- salt 鹽:${OPTIONS.salt.join('、')}。
無法放進欄位的描述(例如「含一顆蛋」「只吃一半」「加了辣油」),寫進 notes,掛在那道菜上。

規則:
1. 使用者有選取某道菜時,這句話預設是在描述那道菜;選了「整餐」時,是在說整餐或補充照片上漏掉的菜;都沒選時,依內容判斷是哪一道。
2. 使用者提到照片上沒有的菜(例如「還有一碗味噌湯」),放進 newDishes。
3. 使用者更正菜名(例如「那不是雞腿,是豬排」),放進 renameDishes。
4. 描述不清楚時要追問,一次只問一個具體問題,isClarification 設 true,不要自己猜:
   - 使用者描述了一道菜卻完全沒提份量,而且這道菜目前也沒有 size → 追問份量(例如「白飯大概吃了多少?一碗、半碗還是更多?」)。
   - 看不出是哪一道菜、描述互相矛盾、或說的東西被遮住看不清楚時 → 追問釐清。
   - 清單中標示「還無法估算熱量」的菜,代表系統還需要份量資訊(例如這道菜是用碗、盤還是杯裝),可以在使用者談到它、或沒有其他要問的時候,追問一次。
   - 不要為了填滿欄位追問容器、糖、鹽、烹調方式這些使用者沒提的細節。
5. 不追問時,回覆格式參考:「好的,我已記錄:\\n• 白飯(一碗,含一顆蛋)\\n還有其他食物要補充嗎?你也可以點選其他項目,或直接告訴我整餐的感受。」條列只寫這次記錄到的內容。
6. 菜的編號 no 一律用下面清單裡的編號;新菜不用編號。
7. 紀錄要等使用者按畫面下方的「完成」才會儲存,所以絕對不要說「已記錄完成」「這餐記錄好了」「已經存檔/儲存」這類表示已存檔的話(「我已記錄:」條列這次的內容可以)。
8. 使用者表示沒有要補充了(例如「沒有了」「就這些」「吃完了」),不要追問,回覆:「如果都描述完了,請按下方的『完成』。」

請「只」回傳如下 JSON,不要加任何說明文字(沒有的項目給空陣列):
{"reply":"…","updates":[{"no":1,"fields":{"containerType":"bowl","size":"M"}}],"notes":[{"no":1,"note":"含一顆蛋"}],"newDishes":[{"name":"味噌湯","category":"beverage","fields":{"containerType":"bowl","size":"M"},"note":""}],"renameDishes":[{"no":2,"name":"豬排","category":"food"}],"isClarification":false}`;

const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
const category = v => (v === 'beverage' ? 'beverage' : 'food');

function describeDish(d){
  const f = d.fields || {};
  const parts = FIELDS.filter(k => f[k]).map(k => (k === 'containerType' ? `容器:${CONTAINER_LABEL[f[k]] || f[k]}` : `${{ size: '份量', cookingMethod: '烹調', sugar: '糖', salt: '鹽' }[k]}:${f[k]}`));
  if (d.notes && d.notes.length) parts.push(`備註:${d.notes.join(';')}`);
  const kcal = d.needsPortion ? '(還無法估算熱量:需要知道份量,例如用碗、盤、杯裝或吃了多少)' : '';
  return `${d.no}. ${d.name}(${d.category === 'beverage' ? '飲料' : '食物'}${d.onPhoto ? '' : ',照片上沒有'})${parts.length ? ' — 已記錄 ' + parts.join('、') : ' — 尚未記錄'}${kcal}`;
}

/* ---------- validation of the AI's answer ---------- */

// Keeps only allowed values; the cooking method must match the dish's kind.
function cleanFields(fields, cat){
  const out = {};
  if (!fields || typeof fields !== 'object') return out;
  for (const k of FIELDS){
    const v = typeof fields[k] === 'string' ? fields[k].trim() : '';
    if (!v) continue;
    const allowed = k === 'cookingMethod'
      ? (cat === 'beverage' ? OPTIONS.cookingMethodBeverage : OPTIONS.cookingMethodFood)
      : OPTIONS[k];
    // tolerate "1/2茶匙" for "1/2 茶匙"
    const hit = allowed.find(a => a === v || a.replace(/\s+/g, '') === v.replace(/\s+/g, ''));
    if (hit) out[k] = hit;
  }
  return out;
}

// The reply must not state calories / nutrients: drop any line or sentence that does.
const NUTRITION_WORDS = /熱量|卡路里|大卡|千卡|kcal|蛋白質|脂肪|醣類|碳水|鈉/i;
// ...nor claim the meal is saved — only 「完成」 saves it.
const SAVED_WORDS = /記錄完成|紀錄完成|完成記錄|完成紀錄|記錄好了|紀錄好了|記好了|已(經)?(存檔|儲存|保存|存好)/;
function cleanReply(text){
  const bad = s => NUTRITION_WORDS.test(s) || SAVED_WORDS.test(s);
  const lines = str(text, 800).split('\n').map(line => {
    if (!bad(line)) return line;
    return line.split(/(?<=[。!?!?,,])/).filter(s => !bad(s)).join('');
  });
  return lines.filter(l => l.trim()).join('\n').trim();
}

function validate(parsed, dishes){
  const byNo = new Map(dishes.map(d => [d.no, d]));
  const p = parsed && typeof parsed === 'object' ? parsed : {};
  const list = v => (Array.isArray(v) ? v : []);

  const renameDishes = [];
  for (const r of list(p.renameDishes)){
    const d = byNo.get(Number(r && r.no));
    const name = str(r && r.name, 30);
    if (d && name && name !== d.name) renameDishes.push({ no: d.no, name, category: r.category ? category(r.category) : d.category });
  }
  // a rename may switch food <-> beverage: validate cooking methods against the new kind
  const catOf = no => (renameDishes.find(r => r.no === no) || byNo.get(no)).category;

  const merged = new Map(); // no -> fields (several updates for one dish are merged)
  for (const u of list(p.updates)){
    const d = byNo.get(Number(u && u.no));
    if (!d) continue;
    const f = cleanFields(u.fields, catOf(d.no));
    if (Object.keys(f).length) merged.set(d.no, { ...(merged.get(d.no) || {}), ...f });
  }
  const updates = [...merged].map(([no, fields]) => ({ no, fields }));

  const notes = [];
  for (const n of list(p.notes)){
    const d = byNo.get(Number(n && n.no));
    const note = str(n && n.note, 60);
    if (d && note) notes.push({ no: d.no, note });
  }

  const newDishes = [];
  for (const nd of list(p.newDishes).slice(0, MAX_NEW_DISHES)){
    const name = str(nd && nd.name, 30);
    if (!name || dishes.some(d => d.name === name)) continue;
    const cat = category(nd.category);
    newDishes.push({ name, category: cat, fields: cleanFields(nd.fields, cat), note: str(nd.note, 60) });
  }

  return {
    reply: cleanReply(p.reply) || '好的,我記下來了。還有其他食物要補充嗎?',
    updates, notes, newDishes, renameDishes,
    isClarification: p.isClarification === true
  };
}

/* ---------- request ---------- */

function parseRequest(body){
  const b = body || {};
  const message = str(b.message, 500);
  if (!message) return { error: '缺少 message。' };
  if (!Array.isArray(b.dishes) || b.dishes.length > 30) return { error: 'dishes 必須是陣列。' };
  const dishes = b.dishes.map(d => ({
    no: Number(d && d.no),
    name: str(d && d.name, 30).replace(/\(\d+%\)$/, ''),
    category: category(d && d.category),
    onPhoto: !(d && d.onPhoto === false),
    fields: cleanFields(d && d.fields, category(d && d.category)),
    notes: (Array.isArray(d && d.notes) ? d.notes : []).map(n => str(n, 60)).filter(Boolean).slice(0, 10),
    needsPortion: !!(d && d.needsPortion)
  })).filter(d => Number.isInteger(d.no) && d.no > 0 && d.name);
  const sel = b.selected || null;
  const selected = sel && sel.type === 'meal' ? { type: 'meal' }
    : sel && sel.type === 'dish' && dishes.some(d => d.no === Number(sel.no)) ? { type: 'dish', no: Number(sel.no) } : null;
  const history = (Array.isArray(b.history) ? b.history : []).slice(-MAX_HISTORY)
    .map(m => ({ role: m && m.role === 'assistant' ? 'assistant' : 'user', content: str(m && m.content, 600) }))
    .filter(m => m.content);
  return { dishes, selected, history, message };
}

function buildMessages({ dishes, selected, history, message }){
  const sel = !selected ? '沒有選取(請依內容判斷是哪一道)'
    : selected.type === 'meal' ? '整餐/其他(整餐的描述,或照片上漏掉的菜)'
    : `第 ${selected.no} 道:${dishes.find(d => d.no === selected.no).name}`;
  const context = `目前的菜色清單:\n${dishes.map(describeDish).join('\n') || '(沒有)'}\n\n使用者目前選取:${sel}`;
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'system', content: context },
    ...history,
    { role: 'user', content: message }
  ];
}

/**
 * @param body   request body
 * @param askAI  async (messages) => parsed JSON object
 */
async function chat(body, askAI){
  const req = parseRequest(body);
  if (req.error) return { httpStatus: 400, error: req.error };
  const parsed = await askAI(buildMessages(req));
  return { httpStatus: 200, ...validate(parsed, req.dishes) };
}

module.exports = { chat, validate, cleanFields, cleanReply, OPTIONS };
