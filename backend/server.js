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

// 前端傳來的是完整照片的 base64,體積可能較大,把上限調高一點
app.use(express.json({ limit: '15mb' }));

// 開發方便先全開放,正式上線建議把 origin 換成你的 GitHub Pages 網址
app.use(cors());

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1';
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const SEGMENTATION_API_URL = process.env.SEGMENTATION_API_URL || '';
const SEGMENTATION_API_KEY = process.env.SEGMENTATION_API_KEY || '';

const RECOGNIZE_PROMPT = `你是食物辨識助手。請用繁體中文判斷這張照片裡的食物,依照下面的步驟思考,不要跳過:

1. 先誠實估計你對「最可能的菜名」有多確定,給出這個第一候選的菜名跟信心百分比(0-100 整數)。這個信心百分比要如實反映你真正的判斷——如果照片其實很清楚、你很確定,就應該給高分(例如 90 以上),不要因為接下來的步驟而故意調低。
2. 檢查上一步的信心:如果 <80,代表真的有不確定性,你「必須」再想至少 1 個、最多 2 個外觀/顏色/質地上合理但確實不同的其他可能菜名,當作備選候選,就算你比較偏好第一個答案也要老實列出。如果第一候選信心已經 >=80,就不需要湊其他候選,直接只回傳這 1 個就好。
3. 每個候選必須是彼此不同的猜測(不同食材、不同做法或不同菜名),不能只是同一個答案的文字微調或重複。
4. 如果整張照片糊到完全看不出任何食物形狀或顏色線索,例外處理:只回傳 1 個候選,name 填「看不出來」,confidence 填 0。

最多列出 3 個候選,依信心度由高到低排序。請「只」回傳如下格式的 JSON,不要加任何說明文字:
{"dishes":[{"name":"菜名1","confidence":65},{"name":"菜名2","confidence":40}]}`;

const DETECT_PROMPT = `你是食物辨識與定位助手。這是一張餐點照片,裡面可能有好幾道不同的菜(不同容器、不同菜色算不同的一道)。
請找出照片中每一道個別的菜,用繁體中文取名,並估計它在照片中的邊界框位置。

極重要：框選目標必須是「食物視覺主體」而不是「容器輪廓」。
- 絕對不要把整個碗、整個盤、整個桌面、整個背景都框進去。
- 不要把空白的盤底、碗邊、桌面背景、或大塊未食用空間算進去。
- 框的邊界要緊貼食物實際可見區域,只留最小邊距。
- 若食物在碗或盤中,你仍然要框成食物範圍,而不是整個容器範圍。
- 若同一個容器裡有多種食材混合,仍算同一道菜,但框必須覆蓋整個食物群聚區域,不能只抓一小塊。
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

座標系統:照片左上角是 (0,0),右下角是 (100,100),單位是百分比。
請「只」回傳如下格式的 JSON,不要加任何說明文字:
{"dishes":[{"name":"菜名","confidence":90,"x":10,"y":15,"w":30,"h":25}]}
x,y 是邊界框左上角座標百分比,w,h 是邊界框寬高百分比。最多列出 8 道菜。`;

// imageUrl 可傳 null,這時只送純文字給 GPT-4o(不需要 vision)
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
    messages: [
      { role: 'user', content }
    ],
    max_tokens: maxTokens
  };
  if (temperature !== undefined) body.temperature = temperature;

  console.log('[OpenAI request] model=%s maxTokens=%s temperature=%s hasImage=%s\nprompt:\n%s',
    OPENAI_MODEL, maxTokens, temperature, !!imageUrl, prompt);

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

  if (w > 52 || h > 52){
    const scale = Math.min(52 / w, 52 / h, 1);
    w *= scale;
    h *= scale;
  }

  const area = w * h;
  if (area > 2200){
    const scale = Math.sqrt(2200 / area);
    w *= scale;
    h *= scale;
  }

  if (w > 48 || h > 48){
    const scale = Math.min(48 / w, 48 / h, 1);
    w *= scale;
    h *= scale;
  }

  if (w < 10 || h < 10){
    const scale = Math.max(1.2, 16 / Math.max(w, 1), 16 / Math.max(h, 1));
    w *= scale;
    h *= scale;
  }

  w = Math.max(10, Math.min(48, w));
  h = Math.max(10, Math.min(48, h));

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
請你用繁體中文想出「另一個不同的」合理猜測——外觀、顏色或質地上合理,但必須是跟「${excludeName}」不同的菜名,不能只是同義詞或文字上的小變化。
如果你真的想不出任何合理的不同猜測,name 請填跟「${excludeName}」一樣,confidence 填 0。
請「只」回傳如下格式的 JSON,不要加任何說明文字:
{"name":"備選菜名","confidence":40}`;

  try {
    const parsed = await callOpenAIVision(imageUrl, prompt, 150);
    const name = String(parsed.name || '').trim();
    const confidence = Math.max(0, Math.min(100, Math.round(Number(parsed.confidence) || 0)));
    if (!name || name === excludeName || name === '看不出來' || confidence <= 0) return null;
    return { name, confidence };
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
        confidence: Math.max(0, Math.min(100, Math.round(Number(d.confidence) || 0)))
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
      dishes = segmentationBoxes
        .slice(0, 8)
        .map(box => ({
          name: String(box.name || '食物區塊').trim(),
          confidence: Math.max(0, Math.min(100, box.confidence || 90)),
          ...normalizeDishBox(box)
        }));
    } else {
      const parsed = await callOpenAIVision(toDataUrl(imageBase64), DETECT_PROMPT, 1000);
      dishes = (Array.isArray(parsed.dishes) ? parsed.dishes : [])
        .slice(0, 8)
        .map(d => {
          const normalized = normalizeDishBox(d);
          const padded = padBox(normalized.x, normalized.y, normalized.w, normalized.h);
          return {
            name: String(d.name || '').trim(),
            confidence: Math.max(0, Math.min(100, Math.round(Number(d.confidence) || 0))),
            ...padded
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`香互後端啟動,監聽 port ${PORT}`);
});
