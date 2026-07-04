# 香互後端(Hugging Face 食物辨識代理伺服器)

這是一個小型 Node.js/Express 伺服器,唯一的工作是:接收前端傳來的照片,
代替瀏覽器呼叫 Hugging Face 上的食物辨識模型(`nateraw/food`,訓練在
Food-101 資料集,101 種常見食物,準確度約 89%),把辨識結果整理成簡單
的 JSON 傳回前端。**Hugging Face 的 token 只存在這個伺服器裡,前端拿不到。**

## 檔案

```
backend/
├── server.js       # Express 伺服器本體
├── package.json    # 依賴套件(express、cors)
├── .env.example    # 環境變數範例(token 放這裡,不要真的填進這個檔案)
└── README.md
```

## API

**POST `/api/recognize`**

Request body(JSON):
```json
{ "imageBase64": "data:image/jpeg;base64,......" }
```

Response(成功):
```json
{
  "dishes": [
    { "name": "fried rice", "confidence": 87 },
    { "name": "steak", "confidence": 42 }
  ]
}
```

Response(模型正在暖機,503):
```json
{ "error": "模型正在啟動,請稍等幾秒後再試一次", "estimated_time": 20 }
```
Hugging Face 的免費模型如果一段時間沒人用,會先「休眠」,第一次呼叫要
等它啟動(通常 10-30 秒),之後就會正常快速回應。

## 本機測試

```bash
cd backend
npm install
cp .env.example .env
# 打開 .env,把 HF_TOKEN 換成你自己申請到的 token
npm start
```
伺服器預設跑在 `http://localhost:3000`。

## 部署到 Render(免費方案示範)

1. 到 [render.com](https://render.com) 註冊帳號,可以直接用 GitHub 帳號登入
2. 先把這個 `backend` 資料夾(連同整個 repo)推上 GitHub(如果還沒推的話)
3. Render 儀表板點 **New** → **Web Service**
4. 選擇連結你的 GitHub repo
5. **Root Directory** 填 `backend`(告訴 Render 只跑這個子資料夾)
6. **Build Command** 填 `npm install`
7. **Start Command** 填 `npm start`
8. **Environment Variables** 那邊新增一個變數:
   - Key: `HF_TOKEN`
   - Value: 你的 Hugging Face token
9. 選免費方案(Free),點 **Create Web Service**
10. 部署完成後,Render 會給你一個網址,例如 `https://xianghu-backend.onrender.com`

**注意**:免費方案通常會在閒置一段時間後「睡眠」,第一次請求要等它醒過來
(可能要等 30 秒~1 分鐘),之後的請求就正常快。

## 部署好之後

把拿到的後端網址(例如 `https://xianghu-backend.onrender.com`)交給我,
我會把前端的辨識邏輯改成呼叫這個網址,取代現在的假資料。
