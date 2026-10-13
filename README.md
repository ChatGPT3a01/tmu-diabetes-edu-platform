# 生成式 AI 智慧助理輔助之成年人糖尿病互動衛教平台（MVP）

繁體中文糖尿病互動衛教平台，同時作為**研究資料蒐集工具**：電子同意 → 匿名 Participant ID → 基本資料 → 知識前測 → 8 個互動衛教模組 → AI 智慧助理 → 知識後測 → 自我效能 → 系統滿意度 → 完成頁（學習成果摘要）。研究者後臺與受試者介面分開。

## 快速開始

```bash
# 需要 Node.js 22.13 以上（使用內建 node:sqlite，免編譯）
npm install
npm start            # 或在 Windows 直接雙擊 start.bat
```

- 受試者端：http://localhost:3100
- 研究者後臺：http://localhost:3100/admin
- 首次啟動會自動建立管理者帳號 `admin`，**隨機初始密碼寫在部署資料夾外的 `../_帳密備忘_勿上傳.md`**；也可用環境變數 `ADMIN_USER`、`ADMIN_PASSWORD` 指定。登入後請到「我的帳號」修改密碼。
- 產生模擬資料：`npm run seed`（預設 40 位，編號 SIMxxxx）；清除模擬資料：`npm run reset`，或在後臺「系統與模擬資料」操作。

## 功能對照需求

| 需求 | 實作 |
|---|---|
| 研究流程（同意→ID→基本資料→前測→8 模組→AI→後測→自我效能→滿意度→完成） | `public/js/app.js`，有進度保護（不可跳關、已完成測驗不可重做），可分次完成 |
| 匿名 Participant ID | 研究人員給的編號或自動產生 `P0001`；另給 6 碼「繼續碼」供換裝置續做；不收姓名 |
| 8 模組：目標→圖文→案例→互動問題→作答→即時正誤回饋與解釋→AI 延伸提問→完成 | 每模組 6 步驟；答錯可「再試一次」或「看正確答案」，記錄 attempt_count |
| 前後測 ≥20 題、涵蓋 8 領域、0–100 分、前測不顯示分數 | 24 題（每領域 3 題），伺服器端計分，前端拿不到標準答案；後測完成後顯示成果摘要 |
| AI 智慧助理限定糖尿病衛教，明確免責標示，不診斷／不停藥改藥／不給劑量 | `src/ai.js`：分類 → 安全守門（dose / stop / diagnose / emergency / offtopic）→ 回答；LLM 輸出含劑量數字也會被攔截 |
| AI_question_category 自動分類 | knowledge、blood_glucose、diet、exercise、medication、hypoglycemia、foot_care、complication、other |
| Event logging（18 欄、16 種 event_type） | `events` 資料表；分數類事件只能由伺服器產生（防偽造）；前端離線時先存本機佇列，恢復連線自動上傳 |
| 研究者 Dashboard | 受試者數、前後測平均、進步分數（含配對 t 檢定）、各題正確率、8 模組完成率、學習時間、各模組停留時間、AI 使用次數與類型分布、AI 使用程度 × 後測／進步分數（分組＋散布圖＋Pearson r）、個別完整學習軌跡 |
| CSV 與 Excel 匯出（6 類資料表） | participants、pre_post_test、learning_events、module_performance、ai_interactions、questionnaires；CSV 為 UTF-8 BOM，Excel 含 README 工作表 |
| researcher / admin 權限 | scrypt 密碼雜湊、HttpOnly + SameSite=Strict Cookie、登入節流、稽核紀錄；researcher 只能看與匯出，admin 另可管帳號、內容、模擬資料、刪除受試者 |
| 後臺管理 | 帳號管理、衛教內容 JSON 編輯（自動驗證＋備份）、模擬資料產生／清除、受試者資料撤回、操作稽核紀錄 |

### 北醫資料整合
- 模組 ⑤ 藥物安全：依北醫附醫藥劑部指導單（Rybelsus PFS-7200-0215、Trajenta 0143、Galvus Met 0161、Jardiance Duo 0249、胰島素筆針 9030）與資料夾內《北醫藥物衛教》「會改變血糖 vs 影響藥效」分開教的規劃。
- 模組 ⑤ 胰島素施打互動學習：保存、注射前確認、通暢測試、部位選擇（互動人體圖）、部位輪替、胰島素種類 → 進食時間、10 題情境測驗（依《胰島素施打衛教》規劃）。
- 模組 ③ 健康飲食：7 步驟（含醣食物 → 餐盤法 → 食物代換 → 外食 → 水果飲料 → 低血糖飲食 → 情境遊戲），含互動餐盤遊戲（依《糖尿病飲食衛教重點》）。
- 模組 ⑥ 低血糖：依北醫附醫《低血糖處理準則》（PFS-7200-0159）15-15 原則，含互動模擬。

## UI / UX 與裝置設計

- **中高齡友善**：基準字級 20px（可切 4 級）、按鈕至少 56px 高、一次一題、高對比模式、每張衛教卡與題目都有「🔊 朗讀」（Web Speech API，zh-TW），AI 支援語音輸入（瀏覽器支援時）。
- **RWD（響應式）**：流動版面＋媒體查詢，表格在手機自動轉成卡片，Likert 量表在窄螢幕改直排，無水平捲動（E2E 已自動檢查）。
- **AWD（自適應）**：JS 偵測裝置類型（含 iPad 偽裝 Mac 的情形）切換版面結構──手機：頂部進度條＋底部固定主要按鈕（拇指可及）；平板：加寬單欄；桌機：左側固定進度步驟欄。裝置類型同時記錄到研究資料（device_type）。
- **PWA**：manifest（standalone、maskable icon）＋ Service Worker，可「加入主畫面」、離線開啟介面；研究 API 一律走網路，不快取。
- 支援深色模式、`prefers-reduced-motion`、鍵盤操作與螢幕閱讀器（ARIA role / aria-live）。

## 串接真正 LLM

預設 `LLM_PROVIDER=local`（本機規則式知識庫，免金鑰）。改用 LLM：

```bash
# Gemini
set LLM_PROVIDER=gemini
set GEMINI_API_KEY=...          # 金鑰只放環境變數
set GEMINI_MODEL=gemini-3.5-flash   # 或 gemini-3.1-pro-preview、gemini-3.1-flash-lite
# OpenAI
set LLM_PROVIDER=openai
set OPENAI_API_KEY=...
set OPENAI_MODEL=gpt-5.6-terra      # 或 gpt-5.6-sol、gpt-5.6-luna
```
LLM 失敗時自動退回本機知識庫；安全守門永遠在 LLM 之前執行。

## 架構

```
server.js            Express 路由（/api/p/* 受試者、/api/admin/* 研究者）、安全標頭與 CSP
src/db.js            SQLite（node:sqlite）資料表；日後換 PostgreSQL 只需替換此層
src/participant.js   受試者核心流程（路由與模擬資料共用）
src/ai.js            AI 分類、守門、本機知識庫／OpenAI／Gemini
src/stats.js         Dashboard 統計（含配對 t 檢定、Pearson r）與六大匯出表
src/exporter.js      CSV / Excel
src/simulate.js      模擬資料產生器
src/auth.js          帳號、Session、權限
content/content.json 題庫、8 模組、問卷、AI 知識庫（後臺可編輯）
public/              受試者 SPA（PWA）；public/admin/ 研究者後臺
data/platform.db     研究資料庫（不納入版控）
```

## 正式部署前注意

- 以 HTTPS 部署並設 `COOKIE_SECURE=1`；在反向代理後面設 `TRUST_PROXY=1`。
- 自我效能量表目前為**研究者自編題目（待確認）**，正式施測請替換為已授權之信效度量表；SUS 為公開量表中文版。
- 同意書聯絡資訊、IRB 編號**待確認**後填入 `content/content.json` 的 `consent`。
- 衛教內容請由醫療專業人員審閱後再上線。
- 備份：複製 `data/platform.db`（及 `content/`）即可；還原時停止服務後覆蓋回去。

## 回復方式
- 內容改壞：`content/backups/` 內有每次後臺儲存前的備份，複製回 `content/content.json` 後重啟。
- 清空研究資料：停止服務 → 刪除 `data/` 資料夾 → 重新啟動（會重建空資料庫與 admin 帳號）。
