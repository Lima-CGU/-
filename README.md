# PICTAMEAL · AI 飲食紀錄(階段 1:拍照上傳 + 真實菜色辨識)

參考 [PICTAMEAL](https://mhealth.jmir.org/2025/1/e60070) 研究中的「AI 影像辨識飲食回報」流程,重製前四格畫面(A 開始 → B 拍照 → C 確認上傳 → D 辨識菜色),用手機外框呈現。

**目前狀態**:前端 + 後端都已串接,照片一上傳就由後端呼叫 OpenAI 的 GPT-4o 自動框出每一道菜的位置並辨識,直接回傳繁體中文菜名;辨識錯的框可以刪除,漏掉的菜也能自己拖曳補框。

## 檔案結構

```
photo-upload-site/
├── index.html   # 手機外框四格畫面 + 下方上傳紀錄
├── style.css    # PICTAMEAL 活力主題樣式(手機外框、畫面切換、邊界框/圓點/泡泡)
├── script.js    # 畫面導覽、拍照、自動辨識框選、手動補框、寫入上傳紀錄
├── backend/     # Node.js 後端,代理呼叫 OpenAI GPT-4o 辨識菜色
└── README.md
```

## 目前的使用者旅程

1. **A 開始**:品牌畫面,按「開始拍照」
2. **B 拍照**:開啟裝置鏡頭,可拍照或改用「從相簿選」上傳既有照片
3. **C 確認上傳**:預覽照片,按「確認上傳・開始辨識」
4. **D 辨識菜色**:一進到這個畫面,前端就把整張照片送到後端請 GPT-4o 自動找出每一道菜的位置和名稱。信心度達門檻(預設 85%,見下方說明)時直接把結果畫在照片上,框中央的圓點顯示「待判」,點一下就直接確認;信心度低於門檻則跳出畫面下方的候選菜名對話框,列出最多三個候選讓使用者選,按 Confirm 套用、按 Cancel 退回原本狀態。辨識錯的按框上的「×」刪掉;AI 漏掉的菜可以拖曳畫面左下角的空白框圖示到照片上補一個框,拖曳邊角調整範圍後按「✓ 確認範圍」送去辨識(套用一樣的信心度規則,一樣可能跳候選對話框);全部沒有還在辨識中或未確認的框,才能按「完成 · 存入日記」
5. 完成的餐點會出現在頁面下方「上傳紀錄」清單,顯示辨識出的菜名清單。

**為什麼候選對話框改成只在信心度不足時才跳出?**
原始規格是 AI 辨識完成後一律彈出候選菜名對話框讓使用者選,但實測下來 GPT-4.1 的信心度普遍偏高,每次都要多點一步反而拖慢流程。因此改為信心度低於門檻(預設 85%,常數 `CONFIDENCE_DIALOG_THRESHOLD`,見 `script.js`)才觸發候選對話框,其餘時候直接顯示辨識結果、待使用者點圓點確認;使用者仍可透過語音修正、細部調整、或拖曳補框,在任何信心度下修正菜名。

**邊界框怎麼來的?**
一開始試過用 OpenCV.js 的 Hough Circle Transform 自動抓圓盤/圓碗位置,但遇到真實照片(盤子大小不一、重疊擺放、光影雜訊)常常框錯或抓到一堆假的圓,調參數也無法穩定解決——這是傳統影像處理方法的本質限制。後來先改成讓使用者自己拖曳畫框確保位置準確,現在則是換成請 GPT-4o 這種多模態模型直接對整張照片估計每道菜的邊界框位置(百分比座標),不用使用者動手畫;因為是「估計」而非精準物件偵測,位置不一定完全貼合,所以保留手動增刪框的能力當作修正機制。

**為什麼現在是整張照片一次辨識,而不是裁切後逐一辨識?**
舊的 Hugging Face 食物辨識模型是「分類」模型,一次只給一個答案,所以當時得把每道菜裁切下來、一次只送一道菜辨識。GPT-4o 是多模態模型,能一次「看懂」整張照片裡有哪些不同的菜、各自在哪個位置,所以自動辨識時改成整張照片一次送出、一次回傳所有菜名跟位置,效率更好;手動補框時仍然是裁切單一區域送去辨識,做法跟舊版一樣。

**Diary 畫面:為什麼 Edit 跟 Expand 合併成一個 ✏️ 入口?**
參考論文(JMIR mhealth 2025 e60070)的設計裡,AI 只負責辨識菜名,份量/烹調方式/糖/鹽等細部屬性一律由使用者自行填寫。因為這些屬性變成「每道菜都要填」的必經步驟,而不是偶發才需要的修正,原始規格裡分開的「Edit(改菜名)」跟「Expand 後編輯屬性」兩個入口,合併成 Diary 卡片上單一的 ✏️ 圖示——點一次就能同時修改菜名跟全部細部屬性,不用先進去看詳情、再另外找地方改名字。🎤 語音修正菜名維持獨立(語音天生只適合修正名稱這種短文字,不適合用來選份量/烹調方式)。新加入的菜色屬性預設全部空白,不放任何範例文字,逼使用者自己填。

## `backend/` 是做什麼的

一個小的 Node.js/Express 伺服器,接收照片後代替瀏覽器呼叫 OpenAI 的 GPT-4o 多模態模型辨識(API Key 不能放前端,必須由伺服器代呼叫)。提供兩個端點:`POST /api/detect` 送整張照片,自動找出所有菜的位置和名稱;`POST /api/recognize` 送單一裁切區域,辨識一道菜(手動補框時使用)。環境變數用 `OPENAI_API_KEY`(選填 `OPENAI_MODEL`,預設 `gpt-4o`)。目前已部署在 Render,前端 `script.js` 裡的 `BACKEND_URL` 指向這個部署網址。

## 熱量計算(A 組 Page 4)

每道菜 5 個欄位填完,前端會呼叫 `POST /api/nutrition`,結果顯示在菜名右邊的熱量標籤(點開看算式與蛋白質/脂肪/醣類/鈉)、照片標籤的第二行、底部整餐熱量(估算值),並和紀錄一起存檔。流程:後端先從 foods1000(老師提供、私有,存在 Firestore)和 TFND(衛福部食藥署,`backend/data/tfnd.json`)各找最接近的 10 筆候選 → 由 AI **只挑編號與比對程度**(exact / close / approx / none,不能回傳任何數字)→ 用固定公式計算。

**計算規則(照老師的「熱量計算功能總結」)**

- 離散單位(份/碗/個/顆/片/根/條/粒/塊/隻/瓣/杯/盒/臺/湯匙/茶匙/把):總熱量 = 資料庫熱量 × 尺寸倍數。
- 連續單位(公克 g / 毫升 c.c.):總熱量 = 資料庫熱量 ÷ 重量基準 × 實際份量。TFND 的基準是 100 g;foods1000 用它自己的重量欄。實際份量由「容器 × 尺寸」對照表決定。
- 蛋白質、脂肪、醣類用和熱量相同的倍數換算。
- 鹽只影響鈉:鈉(mg)= 品項本身的鈉(同樣倍數換算)+ 鹽的茶匙數 × 2358;無鹽 = 0。
- 烹調方式、糖只記錄,不影響任何數字。
- 換算後每公克超過 9.5 大卡視為資料異常:不顯示數字,回傳 `anomaly` 並寫 log。
- 比對程度 none → 不計算,顯示「無法估算」。approx → 顯示「(近似)」。
- 候選分成 A(份/碗/顆/根/片/個/杯等離散單位,通常是 foods1000)和 B(每 100 g / 公克 / 毫升)。只要 A 裡有同一種食物(名稱不必完全相同,例如水煮蛋 → 以「顆/個」計的雞蛋),一律選 A;找不到才用 B 加份量對照表。
- 同樣的輸入會快取(挑選結果依「菜名、食物/飲料、容器、飲料是否無糖」快取),不重複呼叫 AI。

**設定檔 `backend/nutrition-config.js`——裡面每一個數字都標了「待老師確認」:**

| 設定 | 目前的預設值 |
|---|---|
| 尺寸倍數(目前所有食物分類共用;結構已是「依分類設定」,之後在 `byCategory` 填各分類自己的倍數即可) | XS 0.5、S 0.75、M 1.0(固定)、L 1.5、XL 2.0 |
| 份量對照・盤子 | XS 100 g、S 150 g、M 250 g、L 350 g、XL 450 g |
| 份量對照・碗 | XS 100 g、S 150 g、M 200 g、L 300 g、XL 400 g |
| 份量對照・杯子 | XS 150 ml、S 250 ml、M 350 ml、L 500 ml、XL 700 ml |
| 沒有容器欄位的水果,每個的公克數(比對到每 100 g 的品項時 × 個數) | XS 50 g、S 100 g、M 150 g、L 200 g、XL 250 g【待老師確認】 |
| 鹽的茶匙數 | 無鹽 0、1/4 茶匙 0.25、1/2 茶匙 0.5、3/4 茶匙 0.75、1 茶匙 1 |
| 每茶匙鹽的鈉 | 2358 mg |
| 異常門檻 | 9.5 kcal/g |
| 可數單位(×數量) | 隻、顆、個、片、根、塊、粒、條;同類:個=顆=粒、根=條 |

註:份量對照表只在比對到公克/毫升品項時使用;盤子、碗以公克計,杯子以毫升計,單位不同時視為 1 ml ≈ 1 g。

前端的顯示與計算是共用元件 `calorie.js`(`window.PictaCalorie`),B 組之後只要送出同樣的 `pictameal:dish-detail-complete` 事件、用同一組顯示函式即可。

## 依食物類型的預設值與適用欄位(老師 10/21、10/22 決定,三組共用)

起因:老師測一顆柿子時,欄位被迫選「容器:杯子、烹調:水煮」這類不適合水果的選項。現在每道菜會依「食物類型」只問適用的欄位,並先帶入對應的預設值。

**要改數值請改這一個檔案:`backend/field-defaults.js`**。後端(`server.js`、`chat.js`、`nutrition-*`)用 `require` 讀它,App 頁面也直接載入同一個檔案(`<script src="backend/field-defaults.js">`,GitHub Pages 會發佈整個 repo),所以只有一份,不會兩邊不一致。改完要把 `sw.js` 的 `CACHE_NAME` 加 1,並重新部署 Render。

**食物類型 `foodType`**:`/api/detect` 每道菜多回傳一個 `foodType`,只能是 staple(主食:飯、麵、麵包)、protein(肉、魚、蛋、豆製品)、vegetable(蔬菜)、soup(湯)、fruit(水果)、beverage(飲料)、snack(點心、甜點)、other。不合法或沒有就當成 other;飲料(category = beverage)一律是 beverage。對話中新增的菜沒有經過辨識,改用菜名的關鍵字猜(例如有「湯」→ soup,有「飯/麵」→ staple),猜不到就是 other。

**適用欄位(`APPLICABLE`,全部【待老師確認】)**

| foodType | 顯示的欄位 |
|---|---|
| fruit 水果 | 份量、數量(不問容器、烹調、糖、鹽) |
| beverage 飲料 | 容器、份量、糖(不問烹調、鹽) |
| 其他類型 | 容器、份量、烹調、糖、鹽;可數的菜另外有數量 |

- 不適用的欄位:不顯示、不填預設值,存進紀錄時值是 `null`,來源 `fieldSource` 記成 `na`;CSV 匯出那一欄的值是 `NA`、來源欄是 `na`,看得出是「不適用」(飲料的烹調選項裡本來就有「不適用」這個值,兩者不同)。
- 判斷一道菜是否「填完」、能不能算熱量,只看適用的欄位(和數量)。
- AI 分錯類時(例如把炒菜當成水果):A 組在最後一頁有小按鈕「還要補充其他欄位」,按下去會把被隱藏的欄位加回來(之後這些欄位也要填),記一筆 `edit_opened`(`detail.what = 'hidden-fields'`、`detail.fields` = 哪些欄位,算 1 次使用者操作);B/C 組照常用對話描述,AI 記下的欄位來源是 `ai`。
- 容器的「直接拿」(`none`)已經拿掉(10/22),前端、後端、熱量計算、`chat.js` 的允許值都一致;10/21~10/22 之間存的舊紀錄若有 `none`,日記仍顯示「直接拿」。

**預設值(`DEFAULTS`,只填適用的欄位,全部【待老師確認】)**

| foodType | 容器 | 份量 | 烹調(菜名沒有烹調字時) | 糖 | 鹽 |
|---|---|---|---|---|---|
| staple 主食 | 碗 | M | (留空) | 無糖 | 無鹽 |
| protein 蛋白質 | 盤子 | M | (留空) | 無糖 | 1/4 茶匙 |
| vegetable 蔬菜 | 盤子 | M | (留空) | 無糖 | 1/4 茶匙 |
| soup 湯 | 碗 | M | (留空) | 無糖 | 1/4 茶匙 |
| fruit 水果 | — | M | — | — | — |
| beverage 飲料 | 杯子 | M | — | 無糖 | — |
| snack 點心 | 盤子 | M | (留空) | 半糖 | 無鹽 |
| other 其他 | 盤子 | M | (留空) | 無糖 | 1/4 茶匙 |

- **數量**:照片上數得到的數量是預設值。水果照片上沒有數量時,A 組的數量預設是 1(`DEFAULT_COUNT`【待老師確認】,畫面上看得到,可以改);B/C 組照舊要受試者說了吃幾個才算(沒說就「待補數量」)。
- **烹調方式**:先看菜名裡有沒有烹調關鍵字(燒烤、烘焙、沙拉、水煮、炒、煎、炸、烤、蒸、滷、燉、煮→水煮;「生魚片、生菜、生吃、涼拌」→ 生食,但「花生」「生煎包」不算生食),有就用對應的選項(例如「炒青菜」→ 炒);沒有才用上表。
- **什麼時候套用**:AI 初稿一出來,A、B、C 三組的每道菜都套用;B/C 組在對話中新增的菜也依它的類型套用。日記裡的「+ 新增菜色」和日記編輯沒有改。
- **事件**:每套用一道菜記一筆 `default_applied`(actor `system`,`detail` 有 `foodType`、套用的欄位與值、`notApplicable` 不適用的欄位),不算進 `userActionCount`。
- **水果的熱量**:比對到以「個/顆」計的品項時照個數算;比對到每 100 公克的品項時,用「每個的公克數 × 個數」換算:XS 50 g、S 100 g、M 150 g、L 200 g、XL 250 g(`backend/nutrition-config.js` 的 `NO_CONTAINER_PIECE_GRAMS`【待老師確認】)。

**每個欄位的來源 `fieldSource`**(存在 record 每道菜上;CSV 有 `foodType` 和 `containerTypeSource`、`sizeSource`、`cookingMethodSource`、`sugarSource`、`saltSource`、`countSource`):
- `default`:系統預設(含照片上的數量),受試者沒動過
- `user`:受試者改的(A 組點選或語音、日記 ✏️ 修改)
- `ai`:B/C 組 AI 依受試者的話更新的
- `na`:這道菜的類型不適用這個欄位
- 舊紀錄沒有來源資料,CSV 顯示 `unknown`。
- 目的是驗證老師的假設:受試者沒仔細看、沒改預設值就會記錄錯誤。A 組點一下和預設值相同的卡牌,也會把來源改成 `user`(事件 `field_set`,`detail.confirmedDefault: true`);把預設值改掉記 `field_changed`(`before` = 預設值,`detail.fromDefault: true`)。
- B/C 組:預設值不會傳給對話 AI(AI 只看到受試者說過的內容),所以 AI 的追問規則和以前一樣;熱量一進對話頁就依預設值先算。

**修改時照片縮小(三組一樣)**
- 第 4 頁:A 組點選一道菜開始填、B/C 組進入對話畫面時,照片縮成上方一小條(原本高度的 1/3,`PHOTO_COMPACT_SHARE`),下方操作區有更多空間;照片上的編號標籤仍看得到、可以點(小照片上的標籤只顯示菜名)。
- 點照片可以暫時放大查看(右下角提示「點照片放大」),再點一次縮回。A 組完成一道菜、回到選菜狀態時,照片恢復原本大小。B/C 組的「+ 整餐/其他」在小照片時移到照片左下方旁邊,不擋住照片。
- 放大/縮小記事件 `photo_expanded` / `photo_collapsed`(actor `user`),不算進 `userActionCount`。

**A 組:一頁一題**
- 點一道菜後一頁只問一個欄位,依序:份量 → 數量(只有可數的菜和水果)→ 容器 → 烹調方式 → 糖 → 鹽;不適用的欄位直接跳過(例如柿子只有份量、數量兩頁,炒青菜有五頁)。
- 每頁上方顯示「第 n / N 題:欄位名稱」,下方有「上一步」「下一步」,最後一頁的「下一步」是「完成這道菜」(回到選菜狀態)。
- 預設值所在的卡牌一進頁面就是選取狀態;受試者不改、直接按「下一步」也可以。
- 換頁記事件 `step_next` / `step_back`(actor `user`,`detail.field` = 這一頁的欄位、`detail.to` = 下一頁或 `done`)。**這兩個事件目前不算進 `userActionCount`,是否計入待老師確認**;原始事件完整保留,分析時可以重算。
- 改菜名(鉛筆)只能自己輸入菜名;記錄過程中沒有「+ 新增菜色」(10/21)。

**A 組:卡牌與「其他 ↻」**
- 每頁一次只顯示一組 3~4 張卡牌,下方「其他 ↻」換成下一組,全部看完回到第一組。預設值(或目前的值)所在的那一組放在最前面。
- 分組寫在 `field-defaults.js` 的 `CARD_GROUPS`(各類型可在 `CARD_GROUPS_BY_TYPE` 另外設定)【待老師確認】,例如烹調方式 [炒、煎、炸] → [蒸、水煮、烤] → [滷、燉、燒烤] → [生食、沙拉、烘焙];份量 [S、M、L] → [XS、XL];鹽 [無鹽、1/4 茶匙、1/2 茶匙] → [3/4 茶匙、1 茶匙];糖 [無糖、微糖、半糖] → [少糖、全糖];容器 [盤子、碗、杯子]。
- 目前選的值不在畫面上這一組時,卡牌上方用一行小字顯示「目前:○○」。
- 按「其他 ↻」記事件 `options_next`(actor `user`,`field`、`detail.group` = 第幾組),算 1 次使用者操作。(上一版「其他…」展開完整清單的做法已經拿掉。)

**A 組:語音(每一頁的麥克風)**
- 語音只影響「這一頁的欄位」(例如在烹調方式頁說「真的」→ 蒸;在數量頁說「兩個」→ 2)。
- 說「換一組」「其他」「下一組」= 按「其他 ↻」;說「下一步」「好了」= 下一步;說「上一步」= 上一步。同一句裡有選項也有指令(「蒸的,下一步」)時先選再換頁。
- 比對不到時顯示「沒有聽懂,請再說一次,或直接點選卡牌」,後面最多附 10 個字的原話。
- 選到的值記成 `field_set` / `field_changed`,`source: 'voice'`;語音的換組、換頁事件也帶 `source: 'voice'`。

**同音字對照表 `voice-match.js`(獨立模組,之後 B/C 組共用)**
- 依欄位判斷同音字:烹調方式「真的/針的/貞的」→ 蒸、「詐/乍」→ 炸、「尖/堅」→ 煎、「吵」→ 炒、「考」→ 烤、「魯」→ 滷、「頓」→ 燉;鹽「二分之一/一半」→ 1/2 茶匙、「四分之一」→ 1/4 茶匙;也接受「1/2」「2分之1」這類寫法。在某一頁時只比對那一頁的欄位,所以在鹽的頁面說「四分之一」就是鹽。要加詞或同音字,改 `voice-match.js` 的 `TABLE`(指令在 `COMMANDS`)。

## 菜色辨識規則(`/api/detect`)

照片上傳後,後端用 `backend/server.js` 的 `DETECT_PROMPT` 請 AI 一次找出每一道菜的位置、名稱和(可數的)數量。除了原本「一道完整料理只框一次」「不要用拼盤這種籠統名稱」「框食物不框容器」的規則外,新增:

**肉類只寫看得出來的種類**
- 只有看得到明確特徵才寫具體種類:魚要看得到魚皮、魚肉的片狀紋理或橘粉色魚肉,才可以寫「鮭魚」等魚種;要寫「雞腿」必須看得到雞腿形狀或骨頭。
- 看不出是雞、豬、牛還是魚時,用通用名稱,例如「照燒肉塊」「醬燒肉塊」「炒肉丁」「炸肉塊」,而且信心度設在 60 以下。
- 不會因為醬汁顏色(深色、照燒色)或料理方式(照燒、紅燒)就猜成特定食材(例如不再把看不出種類的深色肉塊猜成「照燒鮭魚塊」)。

**數量只給「本來就是一個一個吃」的食物**
- 只有雞腿、雞翅、炸雞塊(整塊炸物)、帶骨排骨、整顆雞蛋、水餃、煎餃、包子、壽司、蝦、整根香蕉會回傳數量。
- 切成一口大小的肉丁、肉塊、豆腐丁、切片水果(蘋果切片、香蕉切片)、蛋的切塊,不回傳數量,改用份量判斷(不會再出現「×15」)。
- 同一盤數出來超過 12 個時,AI 要先確認是不是一口大小的切塊,是的話就不回傳數量。

**穩定性**
- `/api/detect` 呼叫 AI 時帶 `temperature: 0`,讓同一張照片每次的結果盡量一致。
- 如果目前的模型不接受 temperature(OpenAI 回 400 `unsupported_parameter`,或像 `gpt-6.1-sol` 這樣只接受預設值而回 400 `unsupported_value`),後端會自動改成不帶 temperature 重送一次,在 log 記一行 `[detect] model … does not accept temperature=0 …`,並記住這個模型,之後的辨識直接不帶 temperature(不會每張照片都多失敗一次)。後端重新啟動後會重新試一次。
- 注意:目前設定的 `gpt-6.1-sol` 不接受 temperature 0,所以實際上會走「不帶 temperature」的路;要真的用到 temperature 0,需要換成接受這個參數的模型(模型設定這次沒有改)。

`/api/recognize`(單一裁切區域、改菜名的候選)和 `/api/chat` 沒有改。

## 可數食物的數量(A、B 組)

- 辨識時 AI 只替「本來就是一個一個吃」的菜(雞腿、雞翅、炸雞塊、帶骨排骨、整顆雞蛋、水餃、煎餃、包子、壽司、蝦、整根香蕉)回報照片上的數量和單位(隻、顆、個、片、根、塊、粒、條),標籤顯示成「滷雞腿 ×9」。炒麵、青菜、白飯、湯,以及切成一口大小的肉丁、豆腐丁、切片水果、蛋的切塊不會有數量(見上方「菜色辨識規則」)。
- A 組 Page 4:有數量的菜多一列「數量」,用「−」「+」調整(1~50,不能打字);這列不算 5 個必填欄位。日記卡片 ✏️ 也能調整。B 組:說「雞腿吃了 4 隻」AI 會把數量改成 4(以使用者吃的為準)。
- 熱量:比對到的品項是以可數單位計(例如以「隻」計的雞腿品項),而且單位和數量的單位同一類時,熱量 = 品項熱量 × 尺寸倍數 × 數量(營養素同樣)。每 100 g、「份/碗」的品項,或單位不同類(例如香蕉切片 8 片 vs 以「根」計的香蕉品項),數量不參與計算。**「可數食物的尺寸代表每一個的大小」與「單位要同一類才乘數量」這兩條待老師確認**(寫在 `backend/nutrition-config.js`)。
- 比對到的品項是以「隻、顆、個…」計,但 AI 沒數到數量時,不會默默當成 1 個:照片標籤顯示「雞腿 ×?」,熱量顯示「待補數量」,A 組的「數量」列顯示「?」,按「+」從 1 開始;數量填好之前這道菜不算「已填完」。
- B/C 組:受試者說了可數的菜吃了幾個(例如「香煎雞肉塊吃了 4 塊」),但沒說份量、這道菜也還沒有份量時,**系統自動把份量補成 M**(每一個是一般大小),熱量就能照常計算,不會一直顯示「待補份量」。後端(`backend/chat.js` 的 `validate()`)和前端各補一次(雙重保險);受試者有說每個比較大或比較小(AI 填了 L、S 等)時以受試者說的為準,不會覆蓋。自動補上的份量在事件紀錄裡是一筆獨立的 `record_updated`(`actor = system`、`field = size`、`detail.auto = 'size-from-count'`),也不算進 `editLog` 的選欄位次數,分析時看得出是系統補的。
- B 組:照片上的數量是盤子上的數量,不等於吃了幾個。受試者描述可數的菜卻沒說吃了幾個時,AI 會追問一次(例如「照片上大約有 8 隻雞腿,你吃了幾隻呢?」,算進追問次數);受試者回答前熱量顯示「待補數量」,按「完成」時也算「資訊不完整」。
- 存檔:每道菜存 AI 數的數量(`aiOriginal.count`)、最後的數量(`count`)、單位(`countUnit`)和改了幾次(`countEdits`);CSV 匯出多了 `aiCount`、`finalCount`、`countUnit`、`countEdits` 四欄。

## 三個實驗組

| 組別 | 網址參數 | Page 4 的回報方式 |
|---|---|---|
| A 傳統組 | `?group=A`(預設) | 清單按鈕填 5 個欄位 |
| B 對話組 | `?group=B` | 和 AI 對話,沒有提示按鈕 |
| C 對話+情境提示組 | `?group=C` | 和 B 組相同的對話,輸入框正上方多一排最多 4 個提示按鈕 |

組別和 A、B 一樣記在這台裝置(localStorage `pictameal:studyGroup`),網址參數優先;畫面上不會顯示組別。Page 1~3 三組完全相同。

## B 組(對話組)與 C 組(對話+情境提示組)Page 4

B 組從 Page 3 按「下一步」進入對話頁(和 A 組同一個畫面、同一套照片/圓圈/標籤,只把填寫面板換成對話)。

- 點照片上的圓圈選一道菜(再點一次取消),或點「+ 整餐/其他」描述整餐、補充漏掉的菜;不選也可以直接說,由 AI 判斷。
- AI 只整理使用者說的話,轉成和 A 組完全一樣的 5 個欄位(容器、尺寸、烹調方式、糖、鹽);說不清楚時一次只追問一個具體問題(主要是份量),不會為了填滿欄位追問容器、糖、鹽。
- 熱量沿用 `calorie.js`:有尺寸(公克/毫升品項還要有容器)就計算,否則顯示「待補份量」。熱量由程式顯示在照片標籤、AI 回覆下方的熱量標籤和底部整餐熱量,AI 的文字裡不會出現任何數字。
- 選菜時輸入列上方顯示該道菜的裁切縮圖(整餐顯示整張照片),送出的「我點選了 X」訊息也附縮圖;存檔只記菜的編號。等待 AI 時顯示「正在整理…」動畫並暫停輸入。AI 不會說「已記錄完成」,使用者沒有要補充時會提醒按「完成」。
- 「完成」隨時可按;有菜沒描述或缺尺寸時會先確認。存檔包含完整對話、訊息數、追問次數、每道菜的備註、新增和更名的菜。日記卡片顯示熱量與備註,沒有 ✏️ 編輯(要修改請回到對話)。B、C 組的日記卡片相同。
- **拒答無關問題(B、C 組)**:AI 只處理這一餐的飲食紀錄。使用者問寫作業、寫程式、翻譯、閒聊、時事、要它扮演其他角色或忽略規則時,一律只回「我只能協助記錄這一餐吃了什麼喔～請告訴我你吃了哪些食物、吃了多少。」,不改任何菜的欄位,也沒有提示按鈕;回應帶 `offTopic: true`,存檔記次數。
- **C 組提示按鈕**:每次 AI 回覆後換成新的一組(0~4 個,沒有就隱藏),依對話情境和選取的菜提示「下一句可能想說的」,例如剛描述完一道菜時是「這道很鹹」「我只吃一半」「分量比較多」「加了很多醬」,問數量時是「吃了 2 個」「全部吃完」;用使用者的口吻,不含熱量、營養數字或健康建議。點按鈕 = 把按鈕文字當成使用者訊息直接送出(和打字送出完全一樣,也套用目前選取的菜)。等待 AI 回覆時按鈕隱藏。按鈕一排橫向排列,放不下時可以橫向捲動。

**`POST /api/chat` 的規則**:輸入 `group`(`'B'` 或 `'C'`,其他值一律當 `'B'`)、菜色清單(編號、菜名、已記錄的欄位)、目前選取的菜或「整餐」、最近 12 則對話、這句話(後端截斷到 500 字,含「我點選了 X。」前綴);回傳 `reply`、`updates`、`notes`、`newDishes`、`renameDishes`、`isClarification`、`offTopic`,C 組另外有 `suggestions`(和回覆是同一次 AI 呼叫產生,不多呼叫)。後端會檢查每個欄位值都在允許的選項內(飲料用飲料的烹調方式),不合法的直接丟掉;回覆中提到熱量或營養素的句子會被移除。`suggestions` 只保留字串、去掉頭尾空白、最多 4 個、每個最多 10 字(超過的整個丟掉),含熱量/營養/健康字眼的也丟掉;B 組回應裡一律沒有 `suggestions`。`offTopic: true` 時後端強制改成固定的拒答句、清空所有更新。使用 `OPENAI_MODEL`、`max_completion_tokens`(900),不設 temperature。

## 研究資料(Firestore)

每一餐按「完成」後,整筆紀錄會由後端寫進 Firebase Firestore。**只有後端(服務帳戶)能寫入**;前端沒有任何 Firebase 金鑰或設定,Firestore 安全規則維持拒絕所有前端讀寫。

**受試者網址**:`https://lima-cgu.github.io/-/?group=A&pid=P001&meal=M01`(B 組換成 `group=B`,C 組換成 `group=C`)。`pid` 和 `group` 一樣會記在這台裝置上(網址參數優先),沒有帶就是 `TEST`。`meal` 是便當編號(英數字、`-`、`_`,最多 20 字),一樣記在這台裝置上(localStorage `pictameal:mealId`),沒有帶就是空字串;換便當時開新的 `meal=` 網址即可。畫面上不會顯示 pid、組別和便當編號。

**存了什麼**(`meals` collection,文件 ID = 紀錄 ID):
- `id`、`pid`、`group`、`mealId`(便當編號)、`appVersion`(= sw.js 的 CACHE_NAME)、`userAgent`
- `times`:`startedAt`(確認照片、進入辨識)、`nextAt`(Page 3 按「下一步」)、`doneAt`(按「完成」)、`durationSec`;以及事件算出的 `taskStartAt`、`photoConfirmedAt`、`aiDraftAt`、`firstEditAt`、`finalConfirmedAt`、`totalSec`、`correctionSec`、`aiProcessingSec`、`preEditDelaySec`(見下方「計時與操作事件紀錄」)
- `events`(操作事件)、`userActionCount`(見下方)
- `aiDetections`:AI 原始辨識(菜名、信心度、框座標);每道菜的 `aiOriginal`
- `dishes`:最後的菜名、5 個欄位(`detail`)、食物類型(`foodType`)、每個欄位的來源(`fieldSource`:default / user / ai)、熱量結果(`nutrition`);`nutrition`:整餐熱量
- `editLog`:`renameCount`(改菜名次數)、`fieldSetCount`(選欄位次數)、`fieldChangeCount`(把已填的值改掉的次數)、`deletedDishes`、`addedDishes`;之後在日記上修改會再加上 `diaryEditCount`、`diaryDeletedDishes`,並以同一個 ID 重新上傳
- `group`:`A`、`B` 或 `C`
- B、C 組:`chat`(完整對話:角色、內容、時間、當時選取的菜編號;`messageCount`、`userMessageCount`、`clarificationCount`、`offTopicCount`(被拒答次數)、新增與更名的菜),每道菜的 `notes`、`renamedFrom`。每則使用者訊息有 `source`:`typed`(自己打字,含語音輸入)或 `suggestion`(點提示按鈕);被拒答的 AI 訊息有 `offTopic: true`
- C 組另外:`chat.suggestionShownCount`(總共顯示過幾個按鈕)、`chat.suggestionTapCount`(點了幾次)、`chat.suggestionTaps`(每次點的按鈕文字與時間);每則 AI 訊息存當時顯示的 `suggestions`
- `apiErrors`:API 錯誤(哪個 API、時間、訊息);`upload`:上傳嘗試次數與失敗原因
- 後端加上:`receivedAt`、`firstReceivedAt`、`uploadCount`、`photoStored`、`photoBytes`;在日記刪掉整餐時會標記 `deletedFromDiary`(資料保留)

**照片**(`photos` collection,文件 ID 同紀錄 ID):前端壓縮成長邊最多 1024 px 的 JPEG(品質約 0.7,超過 900 KB 就再降),存成 Firestore 的 bytes 欄位(不使用 Firebase Storage)。要整個關掉照片上傳:把 `script.js` 的 `SAVE_PHOTOS` 改成 `false`,或在 Render 設定環境變數 `SAVE_PHOTOS=false`(後端會忽略收到的照片)。

**上傳失敗不會遺失**:紀錄先存進瀏覽器的待上傳佇列(localStorage;照片放 IndexedDB),再嘗試上傳;失敗時在 App 開啟、網路恢復、畫面回到前景、以及每 60 秒自動重試。同一筆紀錄重試只會覆寫同一份文件,不會重複。日記卡片上用小字顯示「已同步」或「等待上傳」。這台裝置的日記(含熱量,照片與縮圖是縮小版)也存在 localStorage,重新整理後會恢復。

**下載資料**(需要 Render 環境變數 `ADMIN_TOKEN`;沒帶或錯誤一律拒絕):

```powershell
$env:ADMIN_TOKEN = "（貼上 ADMIN_TOKEN）"
$h = @{ Authorization = "Bearer $env:ADMIN_TOKEN" }
$api = "https://xianghu-backend.onrender.com"
Invoke-WebRequest "$api/api/admin/export?format=csv"  -Headers $h -OutFile meals.csv    # 一道菜一列,Excel 可直接開
Invoke-WebRequest "$api/api/admin/export?format=json" -Headers $h -OutFile meals.json   # 完整紀錄(不含照片)
Invoke-WebRequest "$api/api/admin/export?format=events" -Headers $h -OutFile events.csv  # 一個事件一列
Invoke-WebRequest "$api/api/admin/photo?id=紀錄ID"     -Headers $h -OutFile 紀錄ID.jpg
```

可加 `&pid=P001`、`&group=A`(`B`、`C` 也可以)或 `&meal=M01` 只匯出部分資料。CSV 欄位:紀錄 ID、pid、group、`mealId`、各時間與耗時(含 `totalSec`、`correctionSec`、`aiProcessingSec`、`preEditDelaySec`)、`userActionCount`、菜的編號與來源、AI 原始菜名與信心度、最後菜名、5 個欄位、熱量、比對程度、比對品項、營養素、備註、整餐熱量、B/C 組訊息數與追問次數、`suggestionShownCount`、`suggestionTapCount`(只有 C 組有值)、`offTopicCount`(B/C 組)、改名/修改/刪除/新增、API 錯誤數等。**匯出的檔案含老師提供的私有食材品項名稱(matchedName),不要放進這個 repo。**

**在 Firebase 後台看紀錄**:[Firebase Console](https://console.firebase.google.com/) → 專案 **pictameal** → 左側「Firestore Database」→「資料」分頁 → `meals`(每餐一份)、`photos`(照片)。點文件就能看到所有欄位。

**刪除測試資料**(例如測試時用的 `pid=DEVTEST`):

```bash
cd backend
node scripts/delete-records.js --pid=DEVTEST         # 先列出(不刪)
node scripts/delete-records.js --pid=DEVTEST --yes   # 刪除 meals 和 photos
```

**ADMIN_TOKEN 怎麼產生**:在自己電腦執行 `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`,把輸出的 43 個字元貼到 Render → Environment → `ADMIN_TOKEN`。不要寫進 repo,也不要貼在聊天或文件裡;只給需要下載資料的研究助理。

## 計時與操作事件紀錄(A、B、C 三組)

每一餐的紀錄多了 `events` 陣列(依發生順序),每一筆:

`{ seq, event, at, elapsedMs, page, actor, target, field, before, after, attemptId, source, status, detail }`

- `at`:ISO 8601 時間;`elapsedMs`:從 `task_start` 起算的毫秒(用 `performance.now()`,不受裝置時鐘調整影響)
- `page`:`start`、`camera`、`review`、`recognize`(Page 3)、`report`(A 組 Page 4)、`chat`(B/C 組 Page 4)、`diary`
- `actor`:`user`(受試者)、`system`(程式)、`ai`(AI 的結果顯示出來)
- `target`:菜的編號(和照片上的圓圈編號相同;B/C 組含對話新增的菜),整餐是 `'meal'`,沒有對象是 `null`
- `source`:只有 `message_submitted` 有,`typed`(打字)、`voice`(用 🎤 語音輸入到輸入框再送出)、`suggestion`(點 C 組提示按鈕)
- `status`:`success`、`failed`、`cancelled`
- **隱私**:事件裡不放對話原文(原文在 `chat.messages`);`message_submitted` 只記字數。A 組的 `before`/`after` 記菜名和欄位值。
- **上限**:每餐最多 3000 筆;到上限時最後一筆是 `error`(`detail.reason = 'event-limit'`),之後不再記錄,紀錄上標 `eventsCapped: true`。整筆紀錄若超過上傳上限(約 850 KB),會從後面截掉事件並標 `eventsTruncated: { kept, total }`。

**事件清單**

| 事件 | actor | 什麼時候 |
|---|---|---|
| `task_start` | user | 在開始畫面按「開始拍照」。還沒確認照片就回到開始畫面再按一次,算同一個任務;已確認過照片(那一餐沒完成就離開)再按,會開始新的任務。沒按「開始拍照」就確認照片時,在確認照片時補記(`detail.noStartTap: true`)。 |
| `page_view` | system | 每次切換畫面(`detail.from` = 上一個畫面) |
| `photo_confirmed` | user | 按「確認上傳・開始辨識」(`detail.source` = camera / library) |
| `ai_request_started` | system | 送出 `/api/detect` |
| `ai_draft_displayed` | ai | 辨識結果(圓圈+菜名)畫在 Page 3 上(`detail.dishCount`、`latencyMs`) |
| `ai_request_failed` | system | 辨識失敗 |
| `item_selected` | user / system | 點選一道菜(A:點圓圈、按「下一道」;新增菜色後自動選取記 system。B/C:點圓圈或「+ 整餐/其他」,`detail.deselect` = 是不是取消選取) |
| `edit_opened` | user / system | A 組:選菜後欄位面板自動打開記 system;按鉛筆改菜名記 user |
| `field_set` / `field_changed` | user | A 組:第一次選某欄位(`before = null`)/ 把已選的值改掉 |
| `dish_renamed` | user | A 組:改菜名(before/after = 舊/新菜名;`detail.inputType` = `typed` 自己打字 / `picked` 從候選清單選) |
| `count_changed` | user | A 組:數量 −/+ |
| `dish_added` / `dish_deleted` | user | A 組:點照片新增一道菜 / 確認刪除 |
| `message_submitted` | user | B/C 組:送出一則訊息(含點提示按鈕) |
| `ai_response_displayed` | ai | B/C 組:AI 回覆顯示(`detail`:`isClarification`、`offTopic`、`updatedDishes`、`latencyMs`…) |
| `record_updated` | system | B/C 組:AI 改了某道菜,每道菜一筆;`field` = 改了哪些欄位,`before`/`after` = 那些欄位的前後值;新增的菜 `before = null` |
| `suggestion_shown` | system | C 組:顯示一組提示按鈕(`detail.texts`) |
| `final_confirmed` | user | 按「完成」(連點只記一次;B/C 組在「資訊不完整」確認框按確定之後) |
| `step_next` / `step_back` | user | A 組一頁一題:下一步/上一步(`detail.field`、`detail.to`) |
| `options_next` | user | A 組「其他 ↻」換下一組卡牌 |
| `photo_expanded` / `photo_collapsed` | user | 第 4 頁點小照片放大/縮回 |
| `back` | user | 鏡頭畫面回首頁、重拍、Page 4 按相機離開 |
| `cancel` | user | 取消刪除、取消改菜名、取消新增菜色、離開確認框按取消、「完成」確認框按取消 |
| `error` | system | API 失敗或重試(`detail.api`) |

**attemptId(一次修正嘗試)**:`C01`、`C02`…,每一餐從 01 開始。B/C 組每送出一則訊息是一次嘗試,之後的 `ai_response_displayed`、`record_updated`、`suggestion_shown`(和失敗的 `error`)沿用同一個 attemptId。A 組沒有「儲存」按鈕,點一下選項就立刻生效,所以**每一次生效的修改是一次嘗試**:`field_set`、`field_changed`、`dish_renamed`、`count_changed`、`dish_added`、`dish_deleted` 各自拿一個新的 attemptId;選菜、打開面板、取消不算嘗試。

**`times` 新增的欄位**(原本的 `startedAt`、`nextAt`、`doneAt`、`durationSec` 保留):

| 欄位 | 意思 |
|---|---|
| `taskStartAt`、`photoConfirmedAt`、`aiDraftAt`、`finalConfirmedAt` | 對應事件第一次發生的時間 |
| `firstEditAt` | `ai_draft_displayed` 之後第一個使用者的修改或送出(`field_set`、`field_changed`、`dish_renamed`、`count_changed`、`dish_added`、`dish_deleted`、`message_submitted`;選菜不算);沒有就是 `null` |
| `totalSec` | task_start → final_confirmed |
| `correctionSec` | ai_draft_displayed → final_confirmed |
| `aiProcessingSec` | photo_confirmed → ai_draft_displayed |
| `preEditDelaySec` | ai_draft_displayed → firstEdit;沒有修改就是 `null` |

秒數由 `elapsedMs` 相減,取到小數一位。

**`userActionCount`(暫定規則,之後分析可能調整)**:三組用同一套計數原則——**點選食物 = 1、完成一次文字輸入 = 1、按送出/確認 = 1**。計算範圍是 `ai_draft_displayed` 到 `final_confirmed`(含)之間 `actor = user` 的事件:

| 事件 | 計數 |
|---|---|
| `item_selected`(A 組點圓圈/「下一道」;B/C 組點圓圈或「+ 整餐/其他」,取消選取也算) | 1 |
| `edit_opened`(只算使用者自己點開的,例如按鉛筆) | 1 |
| `field_set`、`field_changed`、`count_changed`、`dish_added`、`dish_deleted` | 各 1 |
| `dish_renamed`:`inputType = typed`(自己打字 + 確認) | 2 |
| `dish_renamed`:`inputType = picked`(從清單選) | 1 |
| `message_submitted`:`source = typed` 或 `voice`(文字輸入 + 送出) | 2 |
| `message_submitted`:`source = suggestion`(點提示按鈕直接送出) | 1 |
| `options_next`(「其他 ↻」) | 1 |
| `final_confirmed` | 1 |

`page_view`、`back`、`cancel`、`step_next` / `step_back`(**是否計入待老師確認**)、`photo_expanded` / `photo_collapsed`、`actor = system / ai` 的事件不算。沒有 AI 初稿(辨識失敗)或沒按完成時是 `null`。**這只是暫定的計數;原始事件全部保留在 `events`(和 `format=events` 匯出)裡,分析時可以用不同規則重算。**

**下載事件**:`format=events` 是一列一個事件的 CSV(`recordId`、`pid`、`group`、`mealId` + 事件所有欄位;`before`/`after`/`detail` 是 JSON 字串),一樣需要 ADMIN_TOKEN,也可以用 `pid`、`group`、`meal` 篩選。

## 後台使用說明(給研究助理)

研究管理後台是一個網頁,手機和電腦都能用:**https://lima-cgu.github.io/-/admin.html**。App 裡沒有連到這裡的按鈕,也不會被搜尋引擎收錄;請直接輸入網址或存成書籤。

### 1. 登入

1. 打開上面的網址。
2. 在「密碼」欄輸入後台密碼(就是 Render 上的 `ADMIN_TOKEN`,由負責的研究人員私下給你;不要寫在紙上、聊天室或文件裡)。
3. 按「登入」。如果伺服器在休眠,第一次可能要等 1~2 分鐘。
4. 密碼只保存在這個分頁:**關掉分頁就要重新輸入**。用完請按右上角「登出」。
5. 密碼打錯 10 次,這台電腦/手機的網路會被暫停 15 分鐘,請等 15 分鐘後再試。

### 2. 每位受試者開始前:先確認伺服器醒著

Render 免費方案的伺服器閒置約 15 分鐘就會休眠,休眠後第一次 AI 辨識要多等約 80 秒。為了不讓受試者等:

- **方法一(建議)**:受試者開始正式記錄前,先打開 App 做示範和練習。App 一打開就會在背景喚醒伺服器,練習的這段時間伺服器就醒了。(練習請用 `pid=TEST` 或不帶 pid 的網址,資料會被當成測試資料排除。)
- **方法二**:在後台最上方看「伺服器狀態」:
  - 🟢 **醒著**:可以開始。
  - 🟡 **喚醒中**:正在等伺服器醒來,旁邊會顯示已經等了幾秒(通常 1~2 分鐘)。等它變成「醒著」再讓受試者開始。
  - 🔴 **無法連線**:等了 3 分鐘還是沒有回應。請按「喚醒伺服器」再試一次;一直失敗請聯絡負責的研究人員。
  - 想主動叫醒伺服器時,按「喚醒伺服器」。後台開著的時候每 2 分鐘會自動再確認一次。

### 3. 篩選

1. 在「篩選」選組別(全部/A/B/C),需要的話輸入便當編號(例如 `M01`)或受試者編號(例如 `P001`)。
2. 「排除 TEST(測試資料)和已標記排除的紀錄」預設是勾選的:受試者編號是 `TEST` 或 `DEVTEST` 的紀錄,和你標記「排除」的紀錄,都不會出現在總覽、列表和下載的檔案裡。
3. 按「套用篩選」。按「清除」回到全部。

### 4. 看總覽(論文用)

「總覽」表格是三組各一欄的統計:紀錄筆數、受試者人數、修正時間、總時間、操作次數(平均 ± 標準差)、AI 處理時間(平均)。數字取到小數第 2 位;括號裡的 n 是有這個數字的紀錄筆數(例如 AI 辨識失敗的那一餐沒有修正時間,就不算進去)。表格下方有每個指標的白話說明。

### 5. 看每一餐的紀錄

1. 「紀錄列表」一列是一餐(新的在上面),會列出時間、受試者、組別、便當、菜數、修正時間、操作次數、整餐熱量、上傳狀態、是否排除。手機上每一餐顯示成一張小卡片。
2. 點一列會展開:左邊是這一餐的照片;右邊是「AI 初稿 ↔ 受試者最後的結果」對照表(改過的菜名用紅字標出,受試者刪掉的 AI 菜色也會列出),B/C 組另外會顯示完整對話。再點一次收起來。

### 6. 標記排除(不會刪除資料)

1. 展開那一餐,在最下面選擇原因(技術故障、操作錯誤、練習資料、重複紀錄、其他),需要的話在旁邊補充說明。
2. 按「標記排除」。這筆紀錄會從總覽統計中拿掉,但資料完全保留。
3. 要取消:先把「排除 TEST 和已標記排除的紀錄」取消勾選並按「套用篩選」,找到那一列展開,按「取消排除」。

### 7. 下載資料

按下方三個按鈕之一,會套用目前的篩選條件(包括「排除…」勾選框):

- 「下載紀錄(Excel 可開的 CSV)」:一道菜一列,直接用 Excel 開。最後兩欄是 `excluded`(是否排除)和 `excludeReason`(原因)。
- 「下載事件紀錄 CSV」:一個操作事件一列(計時與操作分析用)。
- 「下載完整 JSON」:完整紀錄(不含照片),給需要寫程式分析的人。

**下載的檔案含老師提供的私有食材品項名稱,只能存在研究用的電腦,不要上傳到網路、雲端共用資料夾或 GitHub。**

## 本機預覽

**快取策略(`sw.js`)**:`index.html`、`script.js`、`style.css`、`calorie.js`、`sync.js`、`manifest.json`、`sw.js` 和頁面導覽請求是 **network-first**:先抓網路上的最新版(`cache: 'no-cache'`,連瀏覽器的 HTTP 快取也會向伺服器確認),抓到就更新快取;只有離線時才用快取。這樣不會出現「舊的 index.html 配新的 script.js」而讓按鈕沒反應。圖片和 icon 維持 cache-first。前端每次改版仍要把 `CACHE_NAME` 加 1。另外,script.js 用到、但舊版頁面可能沒有的元素(例如 C 組的提示按鈕列),程式會先檢查,不存在就跳過。

```bash
cd photo-upload-site
python3 -m http.server 8000
```
瀏覽器打開 `http://localhost:8000`(拍照功能需要在 `http://localhost` 或 `https://` 下才會拿到鏡頭權限)。

## 下一階段規劃(尚未實作)

- **日記彙總頁的熱量/營養素**:目前 Diary 卡片已經可以修改單一菜色的名稱跟份量/烹調方式/糖/鹽,但還沒有熱量或營養素計算(app 裡完全沒有這類資料來源,不打算之後放假數字)
- **Render 免費方案的休眠問題**:閒置約 15 分鐘後會睡眠,冷啟動時第一次 AI 辨識要多等約 80 秒。目前不升級付費方案,改用:App 一載入就在背景呼叫一次後端 `GET /` 喚醒它(不等待、失敗不顯示、不記事件、不影響計時),並在受試者開始前先用 App 示範練習,或在後台確認「伺服器狀態」是「醒著」(見上方「後台使用說明」)。
