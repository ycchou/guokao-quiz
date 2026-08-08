# 資料管線（考選部 PDF → 結構化題庫）

這裡是把**考選部考畢試題 PDF** 轉成網站用的結構化題庫（`public/data/`）的所有腳本。
網站本身（Astro）用不到這些；只有在**新增職類／年度、重建題庫資料**時才會用到。

## 相依
- **Python 3**（3.10+）：`pip install pymupdf`（PyMuPDF，用於座標解析與裁圖）
- **poppler 的 `pdftotext`**（Windows 可用 Git for Windows 內附的，或另裝 poppler）
- **bash + curl**（下載）

## 路徑假設（跨裝置要調整）
腳本預設整個專案放在一個基底資料夾下，並有這些**同層**資料夾：
```
<base>/
├─ 護理師高考歷屆試題/         # 下載的 PDF（各場次資料夾）
├─ 呼吸治療師高考歷屆試題/
├─ exam-data/                  # 解析輸出（index.json + questions/ + q-img/）
└─ exam-site/                  # 網站（本 repo）
    └─ pipeline/               # 你在這裡
```
本機開發時，這個 base 是 `D:\Antigravity\test`。**換裝置／換 OS 時**，請調整各腳本頂端的路徑常數：
- `build_data.py`：`OUT`（輸出到 exam-data）、`SRC_ROOTS`（各職類 PDF 資料夾）、`DL_TSVS`
- `profession.py`：`OUT`、`SRC_ROOTS`
- `download.sh` / `dl.sh`：目標資料夾

> 原始 PDF（各約 86MB）與 `exam-data/`（約 32MB）**沒有進 git**（可由腳本重新產生）。
> 網站實際使用的資料是已複製進 repo 的 `exam-site/public/data/`（已版控）。

## 各檔用途
| 檔案 | 說明 |
|---|---|
| `allexams.txt` | 考選部全年度考試代碼→名稱對照（`<code>\t<name>`），解析職類的參考資料 |
| `profession.py` | 通用：`python profession.py <關鍵字> <輸出資料夾> <考試碼…>` 下載並產生某職類的下載清單/索引 |
| `download.sh` / `dl.sh` | 讀下載清單 TSV，用 curl 抓 PDF（含 %PDF 驗證、跳過已完成）。**注意：背景執行無網路，需前景跑** |
| `extract.py` | 解析核心：`parse_labeled`（選項有 A./B./…，用 pdftotext 文字＋選項錨點正則）、`parse_positional`（無字母、靠 PyMuPDF 座標分欄）、`parse_answer_pdf`（`pdftotext -layout` 讀答案格）、圖片偵測、`render_crop`/`render_pages` |
| `build_data.py` | 管線主程式：走訪 `索引.csv` → 每科呼叫 extract → 合併答案/更正 → 產生 `questions/<slug>/<code>-<sub>.json`、`q-img/` 裁圖、`index.json`；含 sanitize（清 PUA 豆腐字）、掃描檔整頁渲染 |
| `generate.py` / `parse.py` | 早期：整理下載資料夾結構、第一版護理師考碼解析（保留備查） |

## 典型流程（新增一個職類，例如物理治療師）
1. 從 `allexams.txt` 找出含該職類的考試碼（名稱或用頁面標籤比對；見 `profession.py`）。
2. `python profession.py 物理治療師 物理治療師高考歷屆試題 <考試碼…>` 產生下載清單。
3. 前景跑 `download.sh`（或 `dl.sh <清單>`）把 PDF 抓下來。
4. 在 `build_data.py` 的 `SRC_ROOTS` / `PROF_SLUG` 加入該職類與 slug，執行 `python build_data.py`。
5. 把 `exam-data/` 複製到 `exam-site/public/data/`；在 `src/lib/types.ts`、`data.ts` 的 slug 對照表加該職類。
6. `npm run build` 重建網站。

> 職類的分類碼 `c` 因年度而異，務必靠頁面 `<label>` 內含職類名來辨識（見 `profession.py` 的做法），不要硬編碼。
