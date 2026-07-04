/**
 * 香互 · 後端小伺服器
 *
 * 功能:接收前端傳來的照片(base64),代替瀏覽器去呼叫 Hugging Face
 * 上的食物辨識模型(nateraw/food,訓練在 Food-101 資料集),
 * 整理辨識結果後回傳給前端。
 *
 * 為什麼需要這個中間層(不能讓前端直接打 Hugging Face)?
 * Hugging Face 的 Access Token 如果直接寫在網站的 JS 裡,任何人打開
 * 瀏覽器「檢查原始碼」都能看到並盜用你的額度。金鑰只能放在伺服器的
 * 環境變數裡,由伺服器代替瀏覽器去呼叫 Hugging Face。
 */

const express = require('express');
const cors = require('cors');

const app = express();

// 前端傳來的是完整照片的 base64,體積可能較大,把上限調高一點
app.use(express.json({ limit: '15mb' }));

// 開發方便先全開放,正式上線建議把 origin 換成你的 GitHub Pages 網址
app.use(cors());

const HF_TOKEN = process.env.HF_TOKEN;
const HF_MODEL_URL = 'https://router.huggingface.co/hf-inference/models/nateraw/food';

app.get('/', (req, res) => {
  res.send('香互後端運作中。POST /api/recognize 來辨識食物照片。');
});

app.post('/api/recognize', async (req, res) => {
  if (!HF_TOKEN) {
    return res.status(500).json({
      error: '伺服器還沒設定 HF_TOKEN 環境變數,請先在部署平台設定金鑰。'
    });
  }

  const { imageBase64 } = req.body || {};
  if (!imageBase64) {
    return res.status(400).json({ error: '缺少 imageBase64 欄位。' });
  }

  // 前端傳來的通常是 data URL,例如 "data:image/jpeg;base64,/9j/4AAQ..."
  // Hugging Face Inference API 要的是原始圖片的二進位內容,不是 JSON
  const base64Data = imageBase64.includes(',')
    ? imageBase64.split(',')[1]
    : imageBase64;
  const imageBuffer = Buffer.from(base64Data, 'base64');

  try {
    const hfRes = await fetch(HF_MODEL_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${HF_TOKEN}`,
        'Content-Type': 'application/octet-stream'
      },
      body: imageBuffer
    });

    const data = await hfRes.json();

    if (!hfRes.ok){
      // 模型第一次被呼叫時常常需要「暖機」,會回傳 503 + estimated_time
      if (hfRes.status === 503 && data?.estimated_time){
        return res.status(503).json({
          error: '模型正在啟動,請稍等幾秒後再試一次',
          estimated_time: data.estimated_time
        });
      }
      return res.status(hfRes.status).json({
        error: 'Hugging Face 回傳錯誤',
        detail: data
      });
    }

    // 回傳格式通常是 [{ label: "fried_rice", score: 0.87 }, ...]
    const dishes = (Array.isArray(data) ? data : [])
      .filter(d => d.score >= 0.05)
      .slice(0, 5)
      .map(d => ({
        name: d.label.replace(/_/g, ' '),
        confidence: Math.round(d.score * 100)
      }));

    res.json({ dishes });
  } catch (err){
    console.error(err);
    res.status(500).json({ error: '呼叫 Hugging Face 時發生錯誤', detail: String(err) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`香互後端啟動,監聽 port ${PORT}`);
});
