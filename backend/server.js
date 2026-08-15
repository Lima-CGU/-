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

const RECOGNIZE_PROMPT = `你是食物辨識助手。請判斷這張照片裡的主要食物是什麼,用繁體中文回答菜名(例如「滷雞腿」「蕃茄炒蛋」)。
如果完全看不出來是什麼食物,name 請填「看不出來」。
請「只」回傳如下格式的 JSON,不要加任何說明文字:
{"dishes":[{"name":"菜名","confidence":90}]}
最多列出 3 個候選菜名,依可能性由高到低排序,confidence 是你自己估計的信心百分比(0-100 整數)。`;

const DETECT_PROMPT = `你是食物辨識與定位助手。這是一張餐點照片,裡面可能有好幾道不同的菜(不同容器、不同菜色算不同的一道)。
請找出照片中每一道個別的菜,用繁體中文取名,並估計它在照片中的邊界框位置。

非常重要：框要緊貼「可食用食物主體」,不要碰到整個碗、整個盤、整個桌面、整個背景。這是最關鍵的要求。

框選規則:
- 目標是「這道菜的整體食物區域」,不要只框某一小塊食材,也不要把空白的盤底、碗邊、桌面背景、或未食用空間算進去。
- 若食物在碗、盤或餐盤中,框要剛好包住食物群聚區域,只保留最小邊距。通常長寬應該控制在畫面約 10%~55% 之間,不要超過 70%,更不要接近 90%。
- 若同一個碗/盤裡有多種食材混在一起(例如玉米、豌豆、紅椒混炒),仍然算同一道菜,但框要覆蓋整個食物區域,不要只抓到單一種食材的局部,也不要把整個碗整個容器都框起來。
- 若食物邊界不明確,請選擇「食物主體範圍」,保留很少的邊距,讓食物整體都在框內,但不要讓框擴張到填滿整個可用空間。
- 框與框之間應該有明顯的背景空隙,不能重疊、不能貼在一起。
- 若是大盤料理、主食、炒青菜、蒸蛋等,框通常應該比盤子的整體邊界更小,只框住實際食物區域。
- 如果有多道菜,請依畫面由左到右、由上到下排序。
- 所有座標都使用百分比,座標系統是照片左上角是 (0,0),右下角是 (100,100)。

錯誤示例(不要做):
- 把整個盤子或整個碗框起來
- 把桌面背景、空白區或大塊盤邊算進去
- 框太大到幾乎佔滿整張照片
- 框重疊或貼住鄰近菜

正確示例:
- 鮮明食物區域框,邊距很小,吃起來像真正的食物輪廓,不是容器輪廓

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
    const err = new Error('OpenAI 回傳錯誤');
    err.status = aiRes.status;
    err.detail = data;
    throw err;
  }

  try {
    return JSON.parse(data.choices?.[0]?.message?.content || '{}');
  } catch (parseErr){
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

  if (w > 60 || h > 60){
    const scale = Math.min(60 / w, 60 / h, 1);
    w *= scale;
    h *= scale;
  }

  const area = w * h;
  if (area > 2800){
    const scale = Math.sqrt(2800 / area);
    w *= scale;
    h *= scale;
  }

  if (w > 55 || h > 55){
    const scale = Math.min(55 / w, 55 / h, 1);
    w *= scale;
    h *= scale;
  }

  if (w < 12 || h < 12){
    const scale = Math.max(1.25, 18 / Math.max(w, 1), 18 / Math.max(h, 1));
    w *= scale;
    h *= scale;
  }

  w = Math.max(12, Math.min(55, w));
  h = Math.max(12, Math.min(55, h));

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

// 讓框盡量貼近食物主體,不讓整個碗/盤/桌面都被框進來
const BOX_PAD_RATIO = 0.005;
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

    const dishes = (Array.isArray(parsed.dishes) ? parsed.dishes : [])
      .slice(0, 5)
      .map(d => ({
        name: String(d.name || '').trim(),
        confidence: Math.max(0, Math.min(100, Math.round(Number(d.confidence) || 0)))
      }))
      .filter(d => d.name);

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
