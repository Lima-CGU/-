/**
 * 香互 · 後端小伺服器
 *
 * 功能:接收前端傳來的照片(base64)或文字,代替瀏覽器去呼叫 OpenAI 的
 * GPT-4o,辨識照片裡的菜色與定位邊界框。
 *
 * 為什麼需要這個中間層(不能讓前端直接打 OpenAI)?
 * OpenAI 的 API Key 如果直接寫在網站的 JS 裡,任何人打開瀏覽器
 * 「檢查原始碼」都能看到並盜用你的額度。金鑰只能放在伺服器的
 * 環境變數裡,由伺服器代替瀏覽器去呼叫 OpenAI。
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const sharp = require('sharp');

const app = express();
const fieldDefaults = require('./field-defaults');
// Render sits in front as one proxy: req.ip = the visitor's address
// (used by the admin wrong-password limit)
app.set('trust proxy', 1);

// 前端傳來的是完整照片的 base64,體積可能較大,把上限調高一點
app.use(express.json({ limit: '15mb' }));

// 開發方便先全開放,正式上線建議把 origin 換成你的 GitHub Pages 網址
app.use(cors());

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1';
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const SEGMENTATION_API_URL = process.env.SEGMENTATION_API_URL || '';
const SEGMENTATION_API_KEY = process.env.SEGMENTATION_API_KEY || '';

const RECOGNIZE_PROMPT = `你是食物辨識助手。你收到的這張照片,已經被系統判定為「不容易一眼認出是什麼」,才會特地拿來問你要不要提供候選菜名——所以你「一定要」給出至少 2 個、最多 3 個不同的合理菜名候選,不能因為你偏好某一個答案就只給 1 個。

請用繁體中文,依照下面的步驟:
1. 想出最可能的菜名,當作第一候選,並誠實估計信心百分比(0-100 整數)。
2. 再想出至少 1 個、最多 2 個外觀/顏色/質地上合理、但確實不同的其他可能菜名,當作備選候選——這是必須的步驟,不能省略。
3. 每個候選必須是彼此不同的猜測(不同食材、不同做法或不同菜名),不能只是同一個答案的文字微調或重複。
4. 每個候選都要判斷 category:像咖啡、茶、牛奶、果汁、豆漿、汽水這類「用喝的、液態、不需要咀嚼」的東西,category 填 "beverage";其餘固體或半固體食物(包含湯品)一律填 "food"。
5. 唯一的例外:如果整張照片糊到完全看不出任何食物形狀或顏色線索,才可以只回傳 1 個候選,name 填「看不出來」,confidence 填 0,category 填 "food"。

依信心度由高到低排序。請「只」回傳如下格式的 JSON,不要加任何說明文字:
{"dishes":[{"name":"菜名1","confidence":65,"category":"food"},{"name":"菜名2","confidence":40,"category":"food"},{"name":"菜名3","confidence":25,"category":"beverage"}]}`;

const DETECT_PROMPT = `你是食物辨識與定位助手。這是一張餐點照片,裡面可能有好幾道不同的菜或飲品(不同容器、不同菜色算不同的一道,飲品也算一道)。
請找出照片中每一道個別的菜或飲品,用繁體中文取名,並估計它在照片中的邊界框位置。

極重要：判斷「這是不是一道菜」的標準是「這個區域是不是一道完整、有自己菜名的料理」,不是「視覺上看不看得出食材界線」。
- 如果一個食物本身就是一道完整、有名字的料理(例如炒麵、滷雞腿、炒青菜、咖哩飯、味噌湯),就算裡面能明顯看出好幾種食材(紅蘿蔔、蛋、蔥、肉絲等),仍然只用一個框、一個菜名代表整道菜,絕對不要把裡面的食材拆成個別的框。這種情況下框的範圍要覆蓋整道菜所有看得到的部分,不能只框住其中一小塊。
- 只有當畫面中出現好幾個各自獨立、沒有被烹調或拌合在一起的食物,且彼此不是同一道料理的一部分時(例如吐司旁邊放著蘋果切片、香蕉切片),才需要分開框、分開命名。
- 判斷順序:先問「這整個區域看起來像不像一道有名字的料理/餐點」——是的話整個當一道菜;只有當畫面是好幾樣分開放置、看得出是不同種類、沒有被同一個烹調步驟結合在一起的食物時,才分開處理。
- 不同容器(不同盤子/碗/杯子)裝的食物,仍然各自算一道。

極重要：絕對禁止用「拼盤」「套餐」「早餐組合」「餐點組合」這類籠統的打包式名稱,去代表好幾個原本可以個別命名、各自獨立的食物。
- 判斷該不該合併成一個名稱的唯一標準,是這些食材「有沒有被同一個烹調動作結合在一起變成一道菜」——例如真的下鍋一起炒、拌在一起的沙拉,才算同一道菜。
- 單純因為「放在同一個盤子上」,或「這樣組合起來看起來像一份套餐/一份早餐」而想到的名稱,一律不能拿來當作合併的理由。就算好幾樣食物擺在同一個盤子上、整體看起來很像一份「早餐」,只要它們彼此是各自可以單獨叫出名字、沒有被烹調或拌合在一起的獨立食物,就必須分開框、分開命名,不可以因為「湊起來可以取一個套餐名稱」就合併成一個籠統標籤。
- 具體範例:一張照片裡有吐司、蘋果切片、香蕉切片、水煮蛋、生菜,擺在同一個盤子上。
  - 錯誤示範:取名「早餐拼盤」,只用一個框涵蓋全部。
  - 正確做法:拆成「吐司」「蘋果切片」「香蕉切片」「水煮蛋」「生菜沙拉」五個獨立的框,各自命名。

極重要：框選目標必須是「食物視覺主體」而不是「容器輪廓」。
- 絕對不要把整個碗、整個盤、整個桌面、整個背景都框進去。
- 不要把空白的盤底、碗邊、桌面背景、或大塊未食用空間算進去。
- 框的邊界要緊貼食物實際可見區域,只留最小邊距。
- 若食物在碗或盤中,你仍然要框成食物範圍,而不是整個容器範圍。
- 框大小通常不應超過畫面 10%~55%,不能超過 70%,更不能接近 90%。
- 任何框都不要重疊、不要貼住另一個菜的框,框與框之間應有明顯背景空隙。
- 若不確定,請選擇「整道菜的主體範圍」,不要讓框變成整個容器或整張照片。
- 依畫面由左到右、由上到下排序。

錯誤示例(不要做):
- 把整個盤子或整個碗框起來
- 把桌面背景、空白區或大塊盤邊算進去
- 框太大到幾乎佔滿整張照片
- 框重疊或貼住鄰近菜

正確示例:
- 只框住可食用的食物主體,邊距很小,像食物輪廓,不是容器輪廓

每一道也請判斷 category:像咖啡、茶、牛奶、果汁、豆漿、汽水這類「用喝的、液態、不需要咀嚼」的東西,category 填 "beverage";其餘固體或半固體食物(包含湯品)一律填 "food"。

每一道也請判斷 foodType(食物類型),只能是下列其中之一:
- "staple" 主食:飯、麵、粥、麵包、吐司、饅頭、地瓜等澱粉類
- "protein" 蛋白質:肉、魚、海鮮、蛋、豆腐、豆製品
- "vegetable" 蔬菜:青菜、菇類、沙拉等以蔬菜為主的菜
- "soup" 湯品
- "fruit" 水果(整顆或切片都算)
- "beverage" 飲料(category 是 "beverage" 時一律填這個)
- "snack" 點心、甜點、零食
- "other" 都不是或看不出來

極重要:肉類只寫「看得出來」的種類,不要猜。
- 只有看得到明確特徵時才寫具體種類:要寫魚種(例如「鮭魚」),必須看得到魚皮、魚肉的片狀紋理,或鮭魚那種橘粉色魚肉;要寫「雞腿」,必須看得到雞腿的形狀或骨頭。豬排、牛排等也一樣,要看得到該部位的形狀。
- 看不出是雞、豬、牛還是魚時,一律用通用名稱,例如「照燒肉塊」「醬燒肉塊」「炒肉丁」「炸肉塊」,而且 confidence 要設在 60 以下。
- 不要因為醬汁顏色(深色、紅色、照燒色)或料理方式(照燒、紅燒、糖醋)就猜成特定食材。例如深色、淋了醬的肉塊,看不到魚皮或魚肉紋理,就不能寫「照燒鮭魚」,要寫「照燒肉塊」。

數量:只有「本來就是一個一個吃」的食物才回傳 count(整數,照片上看得到的數量)和 countUnit(只能是 隻、顆、個、片、根、塊、粒、條 其中之一)。
- 只有這些可以回傳 count:雞腿、雞翅、炸雞塊(整塊的炸物)、帶骨排骨、整顆的雞蛋、水餃、煎餃、包子、壽司、蝦、整根香蕉。這些看得清楚時「一定要」回傳 count。
- 切成一口大小的肉丁、肉塊、豆腐丁、切片水果(例如蘋果切片、香蕉切片)、蛋的切塊,一律不要回傳 count 和 countUnit(之後改用份量判斷)。
- 無法逐一數的菜(炒麵、炒青菜、白飯、湯、沙拉、飲料)也不要回傳 count 和 countUnit。
- 盤中有好幾個時要一個一個數(依位置由左到右、由上到下逐一點數),疊在一起或被遮住的部分依看得到的形狀合理估計(例如露出一截骨頭或一角也算一個)。
- 同一盤數出來超過 12 個時,請重新確認是不是切成一口大小的切塊;如果是,就不要回傳 count。
- 照片太模糊、真的看不出有幾個時,不回傳 count。

座標系統:照片左上角是 (0,0),右下角是 (100,100),單位是百分比。
請「只」回傳如下格式的 JSON,不要加任何說明文字(count、countUnit 只在可數時才加):
{"dishes":[{"name":"白飯","confidence":92,"category":"food","foodType":"staple","x":5,"y":55,"w":35,"h":30},{"name":"滷雞腿","confidence":88,"category":"food","foodType":"protein","x":50,"y":20,"w":30,"h":30,"count":3,"countUnit":"隻"},{"name":"照燒肉塊","confidence":55,"category":"food","foodType":"protein","x":10,"y":12,"w":32,"h":28}]}
(第三個例子是看不出是哪種肉的一口大小肉塊:用通用名稱、confidence 低於 60,而且不回傳 count。)
x,y 是邊界框左上角座標百分比,w,h 是邊界框寬高百分比。最多列出 8 道菜。`;

// imageUrl 可傳 null,這時只送純文字給 GPT-4o(不需要 vision)
// prompt 也可以直接傳整個 messages 陣列(/api/chat 用,含 system 訊息與對話紀錄)
// temperature 可選:不傳就用 API 預設值,傳低一點的值(例如 0.2)可以讓短文字建議類的
// 輸出更穩定一致,不會像預設溫度那樣偶爾給出敷衍、跟原始回饋對不上的答案
async function callOpenAIVision(imageUrl, prompt, maxTokens, temperature){
  const content = imageUrl
    ? [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: imageUrl } }
      ]
    : prompt;

  const body = {
    model: OPENAI_MODEL,
    response_format: { type: 'json_object' },
    messages: Array.isArray(prompt) ? prompt : [
      { role: 'user', content }
    ],
    // gpt-5.x/6.x reject `max_tokens` ("Unsupported parameter", 400) and require
    // `max_completion_tokens` instead. gpt-4.1 accepts `max_completion_tokens` too,
    // so this one param name works across every model this app has tested.
    max_completion_tokens: maxTokens
  };
  if (temperature !== undefined) body.temperature = temperature;

  console.log('[OpenAI request] model=%s maxTokens=%s temperature=%s hasImage=%s\nprompt:\n%s',
    OPENAI_MODEL, maxTokens, temperature, !!imageUrl, Array.isArray(prompt) ? JSON.stringify(prompt, null, 1) : prompt);

  const aiRes = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const data = await aiRes.json();
  if (!aiRes.ok){
    // Log the raw OpenAI error body here — this is the one place that
    // actually sees it; callers only get err.message unless they dig into
    // err.detail themselves, which historically nobody did.
    console.error('[OpenAI request FAILED] status=%s raw body=%s', aiRes.status, JSON.stringify(data));
    const err = new Error('OpenAI 回傳錯誤');
    err.status = aiRes.status;
    err.detail = data;
    throw err;
  }

  const rawContent = data.choices?.[0]?.message?.content || '{}';
  console.log('[OpenAI raw response content]\n%s', rawContent);

  try {
    return JSON.parse(rawContent);
  } catch (parseErr){
    console.error('[OpenAI response is not valid JSON] parseErr=%s raw=%s', parseErr.message, rawContent);
    const err = new Error('OpenAI 回傳的內容不是有效 JSON');
    err.status = 502;
    err.detail = data;
    throw err;
  }
}

// /api/detect asks with temperature 0 so the same photo gets the same
// answer. A model that rejects temperature (400 unsupported_parameter, or
// unsupported_value — gpt-6.1-sol only accepts the default 1) is asked again
// without it, and that is remembered per model so later requests don't pay
// for a failing first call.
const noTemperatureModels = new Set();
function rejectsTemperature(err){
  const e = err && err.detail && err.detail.error;
  if (!err || err.status !== 400 || !e) return false;
  return e.param === 'temperature'
    || (/unsupported_(parameter|value)/.test(String(e.code || e.type || '')) && /temperature/i.test(String(e.message || '')));
}
async function callDetectAI(imageUrl){
  if (noTemperatureModels.has(OPENAI_MODEL)) return callOpenAIVision(imageUrl, DETECT_PROMPT, 1000);
  try {
    return await callOpenAIVision(imageUrl, DETECT_PROMPT, 1000, 0);
  } catch (err){
    if (!rejectsTemperature(err)) throw err;
    noTemperatureModels.add(OPENAI_MODEL);
    console.warn('[detect] model %s does not accept temperature=0; retrying without temperature (and not sending it again)', OPENAI_MODEL);
    return callOpenAIVision(imageUrl, DETECT_PROMPT, 1000);
  }
}

function toDataUrl(imageBase64){
  return imageBase64.startsWith('data:')
    ? imageBase64
    : `data:image/jpeg;base64,${imageBase64}`;
}

function normalizeSegmentationBoxes(payload){
  const items = [];
  const append = (candidate) => {
    if (!candidate || typeof candidate !== 'object') return;
    const x = Number(candidate.x ?? candidate.left ?? candidate.minX ?? candidate.bbox?.x ?? candidate.box?.x ?? 0);
    const y = Number(candidate.y ?? candidate.top ?? candidate.minY ?? candidate.bbox?.y ?? candidate.box?.y ?? 0);
    const w = Number(candidate.w ?? candidate.width ?? candidate.bbox?.w ?? candidate.box?.w ?? candidate.right ?? 0);
    const h = Number(candidate.h ?? candidate.height ?? candidate.bbox?.h ?? candidate.box?.h ?? candidate.bottom ?? 0);
    const confidence = Number(candidate.confidence ?? candidate.score ?? 0);
    const name = String(candidate.name || candidate.label || '食物區塊').trim();

    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(w) || !Number.isFinite(h)) return;

    let finalX = clampPct(x);
    let finalY = clampPct(y);
    let finalW = clampPct(w);
    let finalH = clampPct(h);

    if (finalW <= 0 || finalH <= 0) return;
    if (finalX + finalW > 100) finalW = Math.max(5, 100 - finalX);
    if (finalY + finalH > 100) finalH = Math.max(5, 100 - finalY);

    items.push({
      name,
      confidence: Math.max(0, Math.min(100, Number.isFinite(confidence) ? Math.round(confidence) : 92)),
      x: finalX,
      y: finalY,
      w: finalW,
      h: finalH
    });
  };

  if (Array.isArray(payload)) {
    payload.forEach(append);
    return items;
  }

  const possibleCollections = [
    payload?.boxes,
    payload?.detections,
    payload?.results,
    payload?.segments,
    payload?.masks,
    payload?.dishes,
    payload?.objects,
    payload?.annotations
  ];

  possibleCollections.forEach(list => {
    if (Array.isArray(list)) list.forEach(append);
  });

  if (payload && typeof payload === 'object' && !items.length) {
    append(payload);
  }

  return items;
}

async function callSegmentationModel(imageBase64){
  if (!SEGMENTATION_API_URL) return null;

  try {
    const res = await fetch(SEGMENTATION_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(SEGMENTATION_API_KEY ? { Authorization: `Bearer ${SEGMENTATION_API_KEY}` } : {})
      },
      body: JSON.stringify({
        imageBase64,
        image: imageBase64,
        model: 'food-segmentation'
      })
    });

    if (!res.ok) {
      console.warn('segmentation API returned non-OK', res.status);
      return null;
    }

    const data = await res.json();
    const boxes = normalizeSegmentationBoxes(data);
    return boxes;
  } catch (err) {
    console.warn('segmentation API unavailable, falling back to OpenAI detect:', err.message);
    return null;
  }
}

function clampPct(n){
  return Math.max(0, Math.min(100, Number(n) || 0));
}

// GPT is asked for "food" or "beverage" but might omit the field or return
// something else entirely — never let that reach the frontend as anything
// but one of the two known values, defaulting to "food".
function normalizeCategory(value){
  return value === 'beverage' ? 'beverage' : 'food';
}

// How many of a countable food the photo shows: an integer 1–50 and one of
// the countable units, or nothing at all (an invalid pair is dropped).
const COUNT_UNITS = ['隻', '顆', '個', '片', '根', '塊', '粒', '條'];
function normalizeCount(d){
  const count = Number(d && d.count);
  const unit = String((d && d.countUnit) || '').trim();
  if (!Number.isInteger(count) || count < 1 || count > 50 || !COUNT_UNITS.includes(unit)) return {};
  return { count, countUnit: unit };
}

function normalizeDishBox(rawBox){
  let x = clampPct(rawBox?.x ?? 0);
  let y = clampPct(rawBox?.y ?? 0);
  let w = Number(rawBox?.w ?? 20);
  let h = Number(rawBox?.h ?? 20);

  if (!Number.isFinite(w) || !Number.isFinite(h)){
    return { x: 0, y: 0, w: 20, h: 20 };
  }

  w = Math.max(8, Math.min(100, w));
  h = Math.max(8, Math.min(100, h));

  const originalX = x;
  const originalY = y;
  const originalW = w;
  const originalH = h;

  // No upper-size shrinking here: the old 48%/52% width-height caps and the
  // 2200 area cap forcibly shrank every large dish (a single bowl in a 2x2
  // photo is already ~30-45% wide), so big dishes ended up framed smaller
  // than the food itself. Only the minimum-size guard remains.
  if (w < 10 || h < 10){
    const scale = Math.max(1.2, 16 / Math.max(w, 1), 16 / Math.max(h, 1));
    w *= scale;
    h *= scale;
  }

  w = Math.max(10, Math.min(100, w));
  h = Math.max(10, Math.min(100, h));

  x = originalX + (originalW - w) / 2;
  y = originalY + (originalH - h) / 2;

  if (x + w > 100) x = Math.max(0, 100 - w);
  if (y + h > 100) y = Math.max(0, 100 - h);

  return { x, y, w, h };
}

async function estimateFoodRegionBoxes(imageBase64){
  try {
    const raw = imageBase64.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '');
    const image = await sharp(Buffer.from(raw, 'base64'))
      .resize(180, 180, { fit: 'inside', withoutEnlargement: true })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const { data, info } = image;
    const { width, height, channels } = info;
    const visited = new Array(height).fill(null).map(() => new Array(width).fill(false));
    const mask = new Array(height).fill(null).map(() => new Array(width).fill(0));

    for (let y = 0; y < height; y++){
      for (let x = 0; x < width; x++){
        const idx = (y * width + x) * channels;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        const maxChannel = Math.max(r, g, b);
        const minChannel = Math.min(r, g, b);
        const sat = maxChannel - minChannel;
        const brightness = (r + g + b) / 3;

        const foodLike = sat >= 18 && brightness >= 18 && brightness <= 245 && !(sat < 10 && brightness > 180);
        if (foodLike) mask[y][x] = 1;
      }
    }

    const boxes = [];
    const dirs = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];

    for (let y = 0; y < height; y++){
      for (let x = 0; x < width; x++){
        if (visited[y][x] || mask[y][x] !== 1) continue;
        const queue = [[x, y]];
        visited[y][x] = true;
        let minX = x;
        let minY = y;
        let maxX = x;
        let maxY = y;
        let count = 0;

        while (queue.length) {
          const [cx, cy] = queue.pop();
          count += 1;
          minX = Math.min(minX, cx);
          minY = Math.min(minY, cy);
          maxX = Math.max(maxX, cx);
          maxY = Math.max(maxY, cy);

          for (const [dx, dy] of dirs) {
            const nx = cx + dx;
            const ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            if (visited[ny][nx] || mask[ny][nx] !== 1) continue;
            visited[ny][nx] = true;
            queue.push([nx, ny]);
          }
        }

        if (count < 90) continue;
        const w = maxX - minX + 1;
        const h = maxY - minY + 1;
        const box = {
          x: (minX / width) * 100,
          y: (minY / height) * 100,
          w: (w / width) * 100,
          h: (h / height) * 100,
          area: w * h
        };
        if (box.w >= 8 && box.h >= 8 && box.w <= 90 && box.h <= 90) boxes.push(box);
      }
    }

    if (!boxes.length) return [];

    boxes.sort((a, b) => b.area - a.area);
    const merged = [];
    for (const box of boxes) {
      let mergedBox = null;
      for (const target of merged) {
        const overlapX = Math.min(target.x + target.w, box.x + box.w) - Math.max(target.x, box.x);
        const overlapY = Math.min(target.y + target.h, box.y + box.h) - Math.max(target.y, box.y);
        const overlap = Math.max(0, overlapX) * Math.max(0, overlapY);
        const targetArea = target.w * target.h;
        const boxArea = box.w * box.h;
        const union = targetArea + boxArea - overlap;
        if (union > 0 && overlap / union > 0.15) {
          mergedBox = target;
          target.x = Math.min(target.x, box.x);
          target.y = Math.min(target.y, box.y);
          target.w = Math.max(target.x + target.w, box.x + box.w) - target.x;
          target.h = Math.max(target.y + target.h, box.y + box.h) - target.y;
          target.area = target.w * target.h;
          break;
        }
      }
      if (!mergedBox) merged.push(box);
    }

    return merged.slice(0, 6).map(b => ({
      x: clampPct(b.x),
      y: clampPct(b.y),
      w: clampPct(b.w),
      h: clampPct(b.h)
    }));
  } catch (err) {
    console.error('fallback detect error', err);
    return [];
  }
}

// 讓框盡量貼近食物主體,不要再把整個碗/盤/桌面一起框進來
const BOX_PAD_RATIO = 0.002;
function padBox(x, y, w, h){
  const padW = w * BOX_PAD_RATIO;
  const padH = h * BOX_PAD_RATIO;
  let nx = x - padW;
  let ny = y - padH;
  let nw = w + padW * 2;
  let nh = h + padH * 2;

  if (nx < 0){ nw += nx; nx = 0; }
  if (ny < 0){ nh += ny; ny = 0; }
  if (nx + nw > 100) nw = 100 - nx;
  if (ny + nh > 100) nh = 100 - ny;

  return { x: nx, y: ny, w: nw, h: nh };
}

app.get('/', (req, res) => {
  res.send('香互後端運作中。POST /api/recognize、/api/detect 辨識食物照片。');
});

// Relying on a single call to both commit to a first guess AND brainstorm
// alternatives is unreliable — GPT sometimes just doesn't bother generating
// a genuinely different second guess even when told to. When that happens
// (exactly one low-confidence dish came back), ask a second, independent
// question specifically for "something different from X" and fold the
// result in, so a low-confidence result reliably ends up with >= 2 options
// instead of depending on one call's compliance.
async function fetchAlternateCandidate(imageUrl, excludeName){
  const prompt = `你是食物辨識助手。這張照片裡的食物,已經有人猜測是「${excludeName}」,但信心不高。
請你用繁體中文想出「另一個不同的」合理猜測——外觀、顏色或質地上合理,但必須是跟「${excludeName}」不同的菜名,不能只是同義詞或文字上的小變化。同時判斷 category:像咖啡、茶、牛奶、果汁、豆漿、汽水這類「用喝的、液態、不需要咀嚼」的東西,category 填 "beverage";其餘一律填 "food"。
如果你真的想不出任何合理的不同猜測,name 請填跟「${excludeName}」一樣,confidence 填 0。
請「只」回傳如下格式的 JSON,不要加任何說明文字:
{"name":"備選菜名","confidence":40,"category":"food"}`;

  try {
    const parsed = await callOpenAIVision(imageUrl, prompt, 150);
    const name = String(parsed.name || '').trim();
    const confidence = Math.max(0, Math.min(100, Math.round(Number(parsed.confidence) || 0)));
    if (!name || name === excludeName || name === '看不出來' || confidence <= 0) return null;
    return { name, confidence, category: normalizeCategory(parsed.category) };
  } catch (err){
    console.error('[recognize] alternate-candidate call failed:', err.message);
    return null;
  }
}

app.post('/api/recognize', async (req, res) => {
  if (!OPENAI_API_KEY) {
    return res.status(500).json({
      error: '伺服器還沒設定 OPENAI_API_KEY 環境變數,請先在部署平台設定金鑰。'
    });
  }

  const { imageBase64 } = req.body || {};
  if (!imageBase64) {
    return res.status(400).json({ error: '缺少 imageBase64 欄位。' });
  }

  try {
    const parsed = await callOpenAIVision(toDataUrl(imageBase64), RECOGNIZE_PROMPT, 300);

    // "看不出來" means GPT itself couldn't identify anything — never let it
    // through as a normal candidate (it can carry any confidence number GPT
    // felt like attaching, including a misleadingly high one). Treat "no
    // usable dishes" as an empty list instead, so the caller's own
    // failure-handling kicks in rather than a fake candidate.
    const dishes = (Array.isArray(parsed.dishes) ? parsed.dishes : [])
      .slice(0, 5)
      .map(d => ({
        name: String(d.name || '').trim(),
        confidence: Math.max(0, Math.min(100, Math.round(Number(d.confidence) || 0))),
        category: normalizeCategory(d.category)
      }))
      .filter(d => d.name && d.name !== '看不出來');

    if (!dishes.length){
      console.warn('[recognize] GPT could not identify anything usable in this crop (raw dishes=%s)', JSON.stringify(parsed.dishes));
    } else if (dishes.length === 1 && dishes[0].confidence < 80){
      console.log('[recognize] only one low-confidence dish (%s, %s%%) — asking for a second opinion', dishes[0].name, dishes[0].confidence);
      const alt = await fetchAlternateCandidate(toDataUrl(imageBase64), dishes[0].name);
      if (alt) dishes.push(alt);
    }

    res.json({ dishes });
  } catch (err){
    console.error(err);
    res.status(err.status || 500).json({ error: err.message, detail: err.detail || String(err) });
  }
});

// 自動抓框:整張照片一次送給 GPT-4o,請它自己找出每一道菜的位置和名稱
app.post('/api/detect', async (req, res) => {
  if (!OPENAI_API_KEY) {
    return res.status(500).json({
      error: '伺服器還沒設定 OPENAI_API_KEY 環境變數,請先在部署平台設定金鑰。'
    });
  }

  const { imageBase64 } = req.body || {};
  if (!imageBase64) {
    return res.status(400).json({ error: '缺少 imageBase64 欄位。' });
  }

  try {
    const segmentationBoxes = await callSegmentationModel(imageBase64);
    let dishes = [];

    if (segmentationBoxes && segmentationBoxes.length) {
      // A third-party segmentation adapter has no concept of food-vs-
      // beverage — it's not GPT, so there's nothing to ask it to classify.
      // Always "food" here; only the GPT-4o DETECT_PROMPT path below can
      // actually tell the two apart.
      dishes = segmentationBoxes
        .slice(0, 8)
        .map(box => ({
          name: String(box.name || '食物區塊').trim(),
          confidence: Math.max(0, Math.min(100, box.confidence || 90)),
          category: 'food',
          foodType: 'other',
          ...normalizeDishBox(box)
        }));
    } else {
      const parsed = await callDetectAI(toDataUrl(imageBase64));
      dishes = (Array.isArray(parsed.dishes) ? parsed.dishes : [])
        .slice(0, 8)
        .map(d => {
          const normalized = normalizeDishBox(d);
          const padded = padBox(normalized.x, normalized.y, normalized.w, normalized.h);
          return {
            name: String(d.name || '').trim(),
            confidence: Math.max(0, Math.min(100, Math.round(Number(d.confidence) || 0))),
            category: normalizeCategory(d.category),
            // unknown / missing -> 'other' (field-defaults.js)
            foodType: fieldDefaults.normalizeFoodType(d.foodType, normalizeCategory(d.category)),
            ...padded,
            ...normalizeCount(d)
          };
        })
        .filter(d => d.name);
    }

    res.json({ dishes });
  } catch (err){
    console.error(err);
    res.status(err.status || 500).json({ error: err.message, detail: err.detail || String(err) });
  }
});

// One dish -> calories. The AI only picks a candidate from the nutrition
// tables (by number); nutrition-calc.js does the math. Returns this dish's
// figures only — never the candidate list or any table.
app.post('/api/nutrition', async (req, res) => {
  if (!OPENAI_API_KEY) {
    return res.status(500).json({ error: '伺服器還沒設定 OPENAI_API_KEY 環境變數,請先在部署平台設定金鑰。' });
  }
  try {
    const { httpStatus, ...payload } = await require('./nutrition-estimate')
      .estimate(req.body, prompt => callOpenAIVision(null, prompt, 200));
    res.status(httpStatus).json(payload);
  } catch (err) {
    console.error('[nutrition] failed:', err.message);
    res.status(502).json({ error: '熱量計算暫時失敗。' });
  }
});

// Groups B and C: one chat turn. The AI turns the user's words into Group A's
// five fields (values checked against the allowed options in chat.js) and writes
// a short reply that never contains calorie / nutrient numbers; for Group C the
// same call also returns suggestion buttons.
app.post('/api/chat', async (req, res) => {
  if (!OPENAI_API_KEY) {
    return res.status(500).json({ error: '伺服器還沒設定 OPENAI_API_KEY 環境變數,請先在部署平台設定金鑰。' });
  }
  try {
    const { httpStatus, ...payload } = await require('./chat')
      .chat(req.body, messages => callOpenAIVision(null, messages, 900));
    res.status(httpStatus).json(payload);
  } catch (err) {
    console.error('[chat] failed:', err.message);
    res.status(502).json({ error: '對話暫時失敗,請再試一次。' });
  }
});

/* ---------- study data (Firestore, via the service account only) ---------- */
// POST /api/records { record, photo? } — one meal; the record id is the
// document id, so retries never duplicate. GET /api/admin/* need ADMIN_TOKEN.
const records = require('./records');
function studyDb(){
  return require('./firebase-admin-init').getFirestore().db;
}

app.post('/api/records', async (req, res) => {
  try {
    const out = await records.saveRecord(studyDb(), req.body);
    res.json({ ok: true, ...out });
  } catch (err) {
    if (err instanceof records.BadRequest) return res.status(400).json({ ok: false, error: err.message });
    console.error('[records] save failed:', err.message);
    res.status(500).json({ ok: false, error: '紀錄暫時無法寫入,稍後會自動重試。' });
  }
});

// Every /api/admin/* request: ADMIN_TOKEN required; 10 wrong tokens from one
// IP within 15 minutes -> 429 for that IP until the window passes.
const adminLimiter = require('./admin-limit').createFailureLimiter();
app.use('/api/admin', (req, res, next) => {
  const ip = req.ip || 'unknown';
  const wait = adminLimiter.blockedFor(ip);
  if (wait){
    res.set('Retry-After', String(wait));
    return res.status(429).json({ error: `密碼錯誤次數太多,請 ${Math.ceil(wait / 60)} 分鐘後再試。` });
  }
  const auth = records.checkAdmin(req);
  if (!auth.ok){
    if (auth.status === 401) adminLimiter.fail(ip);
    return res.status(auth.status).json({ error: auth.error });
  }
  adminLimiter.succeed(ip);
  next();
});

// the admin page's 登入: just checks the token (the guard above)
app.get('/api/admin/check', (req, res) => res.json({ ok: true }));

function adminFilters(q){
  return {
    pid: typeof q.pid === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(q.pid) ? q.pid : null,
    group: records.GROUPS.includes(q.group) ? q.group : null,
    mealId: typeof q.meal === 'string' && /^[A-Za-z0-9_-]{1,20}$/.test(q.meal) ? q.meal : null
  };
}
// ?hideExcluded=1 (the admin page's checkbox): drop TEST / DEVTEST and excluded meals
async function adminList(q){
  const list = await records.loadRecords(studyDb(), adminFilters(q));
  return q.hideExcluded === '1' ? list.filter(r => !records.isHidden(r)) : list;
}

// list / overview rows (no photos, no conversation)
app.get('/api/admin/records', async (req, res) => {
  try {
    const list = await adminList(req.query);
    res.set('Cache-Control', 'no-store');
    res.json({ count: list.length, records: list.map(records.summarize) });
  } catch (err) {
    console.error('[admin] records failed:', err.message);
    res.status(500).json({ error: '讀取紀錄失敗。' });
  }
});

// one full record (no photo) for the expanded row
app.get('/api/admin/records/:id', async (req, res) => {
  try {
    const record = await records.getRecord(studyDb(), req.params.id);
    if (!record) return res.status(404).json({ error: '找不到這筆紀錄。' });
    res.set('Cache-Control', 'no-store');
    res.json({ record });
  } catch (err) {
    if (err instanceof records.BadRequest) return res.status(400).json({ error: err.message });
    console.error('[admin] record failed:', err.message);
    res.status(500).json({ error: '讀取紀錄失敗。' });
  }
});

// mark / unmark as excluded — writes only excluded, excludeReason, excludedAt
app.post('/api/admin/records/:id/exclude', async (req, res) => {
  try {
    const out = await records.setExcluded(studyDb(), req.params.id, req.body);
    if (!out) return res.status(404).json({ error: '找不到這筆紀錄。' });
    res.json({ ok: true, ...out });
  } catch (err) {
    if (err instanceof records.BadRequest) return res.status(400).json({ error: err.message });
    console.error('[admin] exclude failed:', err.message);
    res.status(500).json({ error: '標記失敗,請再試一次。' });
  }
});

app.get('/api/admin/export', async (req, res) => {
  const format = String(req.query.format || 'json').toLowerCase();
  if (!['csv', 'json', 'events'].includes(format)) return res.status(400).json({ error: 'format 必須是 csv、json 或 events。' });
  try {
    const list = await adminList(req.query);
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    res.set('Cache-Control', 'no-store');
    if (format === 'csv'){
      res.set('Content-Type', 'text/csv; charset=utf-8');
      res.set('Content-Disposition', `attachment; filename="pictameal-meals-${stamp}.csv"`);
      return res.send(records.toCsv(list));
    }
    if (format === 'events'){
      // one row per event (CSV), same filters
      res.set('Content-Type', 'text/csv; charset=utf-8');
      res.set('Content-Disposition', `attachment; filename="pictameal-events-${stamp}.csv"`);
      return res.send(records.toEventsCsv(list));
    }
    res.set('Content-Disposition', `attachment; filename="pictameal-meals-${stamp}.json"`);
    res.json({ exportedAt: new Date().toISOString(), count: list.length, records: list });
  } catch (err) {
    console.error('[admin] export failed:', err.message);
    res.status(500).json({ error: '匯出失敗。' });
  }
});

app.get('/api/admin/photo', async (req, res) => {
  try {
    const buf = await records.getPhoto(studyDb(), String(req.query.id || ''));
    if (!buf) return res.status(404).json({ error: '找不到這筆紀錄的照片。' });
    res.set('Content-Type', 'image/jpeg');
    res.set('Cache-Control', 'no-store');
    res.set('Content-Disposition', `attachment; filename="${req.query.id}.jpg"`);
    res.send(buf);
  } catch (err) {
    if (err instanceof records.BadRequest) return res.status(400).json({ error: err.message });
    console.error('[admin] photo failed:', err.message);
    res.status(500).json({ error: '讀取照片失敗。' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`香互後端啟動,監聽 port ${PORT}`);
});

// Nutrition tables for the upcoming calorie feature: loads the private
// foods1000 table from Firestore into memory once. Never throws — if
// Firestore is unreachable it logs why and falls back to the public TFND
// table, so recognition keeps working. (No endpoint exposes the tables;
// a future /api/nutrition returns one dish's result only.)
require('./nutrition-db').init();
