/**
 * 香互 · 後端小伺服器
 *
 * 功能:接收前端傳來的照片(base64)或文字,代替瀏覽器去呼叫 OpenAI 的
 * GPT-4o,辨識照片裡的菜色、或把長者口語的飲食回饋轉譯成烹調建議。
 *
 * 為什麼需要這個中間層(不能讓前端直接打 OpenAI)?
 * OpenAI 的 API Key 如果直接寫在網站的 JS 裡,任何人打開瀏覽器
 * 「檢查原始碼」都能看到並盜用你的額度。金鑰只能放在伺服器的
 * 環境變數裡,由伺服器代替瀏覽器去呼叫 OpenAI。
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();

// 前端傳來的是完整照片的 base64,體積可能較大,把上限調高一點
app.use(express.json({ limit: '15mb' }));

// 開發方便先全開放,正式上線建議把 origin 換成你的 GitHub Pages 網址
app.use(cors());

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o';
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

const RECOGNIZE_PROMPT = `你是食物辨識助手。請判斷這張照片裡的主要食物是什麼,用繁體中文回答菜名(例如「滷雞腿」「蕃茄炒蛋」)。
如果完全看不出來是什麼食物,name 請填「看不出來」。
請「只」回傳如下格式的 JSON,不要加任何說明文字:
{"dishes":[{"name":"菜名","confidence":90}]}
最多列出 3 個候選菜名,依可能性由高到低排序,confidence 是你自己估計的信心百分比(0-100 整數)。`;

const DETECT_PROMPT = `你是食物辨識與定位助手。這是一張餐點照片,裡面可能有好幾道不同的菜(不同容器、不同菜色算不同的一道)。
請找出照片中每一道個別的菜,用繁體中文取名,並估計它在照片中的邊界框位置。

框選規則:
- 邊界框要盡可能涵蓋該道菜「完整」的範圍,不要只框住食物的一部分(例如只框到半碗飯、或只框到局部食材)
- 請以「該道菜所在的碗或盤子的邊緣」作為框選依據,讓框盡量貼齊碗盤的外緣,確保同一個碗/盤裡的食物都完整包在框內
- 如果同一個碗/盤裡有多種食材混合或並排在一起(例如玉米、豌豆、紅椒混炒),仍然算作同一道菜,框選整個碗/盤區域,不要切割成多個框
- 如果不確定邊界確切在哪裡,寧可框大一點、讓框稍微超出碗盤邊緣包到一點背景,也不要框小了切到食物本身

座標系統:照片左上角是 (0,0),右下角是 (100,100),單位是百分比。
請「只」回傳如下格式的 JSON,不要加任何說明文字:
{"dishes":[{"name":"菜名","confidence":90,"x":10,"y":15,"w":30,"h":25}]}
x,y 是邊界框左上角座標百分比,w,h 是邊界框寬高百分比。最多列出 8 道菜,依畫面由左到右、由上到下排序。`;

function translateFeedbackPrompt(dishName, feedbackText){
  return `你是照護飲食轉譯助手。長者對「${dishName}」這道菜的原始回饋是:「${feedbackText}」,
請將這句模糊的感受,轉譯成看護可以直接執行的具體烹調調整建議,用簡短的繁體中文條列說明(例如切法、烹調時間、調味調整等)。
如果原始回饋看起來只是稱讚或沒有需要調整的地方,就回覆「這道菜很合適,不需調整」。
請「只」回傳如下格式的 JSON,不要加任何說明文字:
{"suggestion":"具體建議文字"}`;
}

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

function clampPct(n){
  return Math.max(0, Math.min(100, Number(n) || 0));
}

// GPT-4o 估計的框常常偏小、切到碗盤邊緣,主動往外擴一點當作補償
const BOX_PAD_RATIO = 0.15;
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
  res.send('香互後端運作中。POST /api/recognize、/api/detect 辨識食物照片,POST /api/translate-feedback 轉譯飲食回饋。');
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
    const parsed = await callOpenAIVision(toDataUrl(imageBase64), DETECT_PROMPT, 1000);

    const dishes = (Array.isArray(parsed.dishes) ? parsed.dishes : [])
      .slice(0, 8)
      .map(d => {
        const x = clampPct(d.x);
        const y = clampPct(d.y);
        const w = Math.max(2, Math.min(100, Number(d.w) || 20));
        const h = Math.max(2, Math.min(100, Number(d.h) || 20));
        const padded = padBox(x, y, w, h);
        return {
          name: String(d.name || '').trim(),
          confidence: Math.max(0, Math.min(100, Math.round(Number(d.confidence) || 0))),
          ...padded
        };
      })
      .filter(d => d.name);

    res.json({ dishes });
  } catch (err){
    console.error(err);
    res.status(err.status || 500).json({ error: err.message, detail: err.detail || String(err) });
  }
});

// 飲食回饋轉譯:把長者口語的模糊感受,轉成看護可以執行的具體烹調建議
app.post('/api/translate-feedback', async (req, res) => {
  if (!OPENAI_API_KEY) {
    return res.status(500).json({
      error: '伺服器還沒設定 OPENAI_API_KEY 環境變數,請先在部署平台設定金鑰。'
    });
  }

  const { dishName, feedbackText } = req.body || {};
  if (!feedbackText) {
    return res.status(400).json({ error: '缺少 feedbackText 欄位。' });
  }

  try {
    const prompt = translateFeedbackPrompt(dishName || '這道菜', feedbackText);
    const parsed = await callOpenAIVision(null, prompt, 300, 0.2);
    const suggestion = String(parsed.suggestion || '').trim();

    res.json({ suggestion });
  } catch (err){
    console.error(err);
    res.status(err.status || 500).json({ error: err.message, detail: err.detail || String(err) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`香互後端啟動,監聽 port ${PORT}`);
});
