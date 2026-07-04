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

app.get('/', (req, res) => {
  res.send('香互後端運作中。POST /api/recognize 來辨識食物照片。');
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

  // OpenAI 的 vision 輸入要的就是 data URL,直接沿用前端傳來的格式即可
  const imageUrl = imageBase64.startsWith('data:')
    ? imageBase64
    : `data:image/jpeg;base64,${imageBase64}`;

  try {
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
              { type: 'text', text: RECOGNIZE_PROMPT },
              { type: 'image_url', image_url: { url: imageUrl } }
            ]
          }
        ],
        max_tokens: 300
      })
    });

    const data = await aiRes.json();

    if (!aiRes.ok){
      return res.status(aiRes.status).json({
        error: 'OpenAI 回傳錯誤',
        detail: data
      });
    }

    let parsed;
    try {
      parsed = JSON.parse(data.choices?.[0]?.message?.content || '{}');
    } catch (parseErr){
      return res.status(502).json({ error: 'OpenAI 回傳的內容不是有效 JSON', detail: data });
    }

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
    res.status(500).json({ error: '呼叫 OpenAI 時發生錯誤', detail: String(err) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`香互後端啟動,監聽 port ${PORT}`);
});
