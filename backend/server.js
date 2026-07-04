/**
 * 香互 · 後端小伺服器
 *
 * 功能:接收前端傳來的照片(base64),代替瀏覽器去呼叫 OpenAI 的
 * GPT-4o 多模態模型辨識照片裡的菜色,整理辨識結果後回傳給前端。
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

function detectPrompt(dishCountHint){
  const hint = dishCountHint ? `使用者說這餐大概有 ${dishCountHint} 道菜,可以參考但不用完全照這個數字。` : '';
  return `你是食物辨識與定位助手。這是一張餐點照片,裡面可能有好幾道不同的菜(不同容器、不同菜色算不同的一道)。${hint}
請找出照片中每一道個別的菜,用繁體中文取名,並估計它在照片中的邊界框位置。
座標系統:照片左上角是 (0,0),右下角是 (100,100),單位是百分比。
請「只」回傳如下格式的 JSON,不要加任何說明文字:
{"dishes":[{"name":"菜名","confidence":90,"x":10,"y":15,"w":30,"h":25}]}
x,y 是邊界框左上角座標百分比,w,h 是邊界框寬高百分比。最多列出 8 道菜,依畫面由左到右、由上到下排序。`;
}

async function callOpenAIVision(imageUrl, prompt, maxTokens){
  const aiRes = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: imageUrl } }
          ]
        }
      ],
      max_tokens: maxTokens
    })
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

app.get('/', (req, res) => {
  res.send('香互後端運作中。POST /api/recognize 或 /api/detect 來辨識食物照片。');
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

  const { imageBase64, dishCountHint } = req.body || {};
  if (!imageBase64) {
    return res.status(400).json({ error: '缺少 imageBase64 欄位。' });
  }

  try {
    const parsed = await callOpenAIVision(toDataUrl(imageBase64), detectPrompt(dishCountHint), 1000);

    const dishes = (Array.isArray(parsed.dishes) ? parsed.dishes : [])
      .slice(0, 8)
      .map(d => ({
        name: String(d.name || '').trim(),
        confidence: Math.max(0, Math.min(100, Math.round(Number(d.confidence) || 0))),
        x: clampPct(d.x),
        y: clampPct(d.y),
        w: Math.max(2, Math.min(100, Number(d.w) || 20)),
        h: Math.max(2, Math.min(100, Number(d.h) || 20))
      }))
      .filter(d => d.name);

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
