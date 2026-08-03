# 國考題庫（guokao-quiz）

考選部歷屆國考試題線上練習平台。以 Astro 靜態網站產生，資料來自考選部考畢試題查詢平臺。

目前收錄：**護理師**、**呼吸治療師**（民國 100 年以後），共 2 萬 3 千餘題。

## 功能

- **練習模式** `/practice`：選年度／職類／考科作答，即時核對答案。
- **模擬考** `/mock`：整場限時計時作答，結束看成績與詳解。
- **隨機出題** `/random`：單一考科、指定年份範圍隨機抽題。
- **公開題目答案頁** `/nurse/<考試碼>/<科目序>`：完整題目與答案，SEO 友善（供搜尋引擎收錄）。
- **題目搜尋** `/search`：Pagefind 全站題目關鍵字搜尋。
- **紀錄／錯題本／收藏** `/records`：資料存於瀏覽器 localStorage，不上傳。
- 深色模式、RWD、PWA（可加到主畫面、離線複習看過的內容）。

## 開發

```bash
npm install
npm run dev        # http://localhost:4321
npm run build      # 產生 dist/（含 Pagefind 搜尋索引）
npm run preview    # 預覽 dist/
```

## 部署到 Cloudflare Pages

1. 將本資料夾推到 Git（GitHub/GitLab）。
2. Cloudflare Dashboard → Workers & Pages → 建立 Pages 專案 → 連結 repo。
3. 建置設定：
   - **Framework preset**：Astro
   - **Build command**：`npm run build`
   - **Build output directory**：`dist`
4. 綁定自訂網域後，把 `astro.config.mjs` 的 `SITE`（或環境變數 `SITE_URL`）改成正式網址，重新部署，讓 sitemap／SEO 使用正確絕對網址。同步更新 `public/robots.txt` 的 Sitemap 網址。

> `dist/` 約 76MB、1,500 多個檔案，在 Cloudflare Pages 限制（單檔 25MB、總檔 20,000）之內。

## 資料從哪來 / 如何新增職類

題庫資料（`public/data/`）由 `scratchpad` 中的 Python 管線產生：
`extract.py`（PDF→題目/答案解析）+ `build_data.py`（輸出 JSON 與裁圖）。
新增其他職類（如物理治療師、職能治療師）步驟：

1. 用 `profession.py <關鍵字> <資料夾> <考試碼…>` 下載該職類 PDF。
2. 在 `build_data.py` 的 `SRC_ROOTS` / `PROF_SLUG` 加入該職類與 slug，執行 `build_data.py`。
3. 把 `exam-data/` 複製到 `public/data/`，在 `src/lib/types.ts`、`data.ts` 的 slug 對照表加上該職類，重新 build。

## 資料來源與授權

所有試題、標準答案、更正答案來自
[考選部考畢試題查詢平臺](https://wwwq.moex.gov.tw/exam/wFrmExamQandASearch.aspx)（政府公開資料）。
本站為非官方整理，題目經自動化解析，極少數（含圖表、掃描卷）可能有誤差，答案以考選部公告為準。
