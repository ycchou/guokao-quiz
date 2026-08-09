#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""用 Google Gemini（預設 gemini-3.6-flash）批次生成題目詳解。

設計重點
- 金鑰只從環境變數 GEMINI_API_KEY 讀取，絕不寫入檔案／不進 git。
- 以 explanations.jsonl 為可續跑的進度快取：只對「未生成且有官方答案」的題呼叫 API，
  中斷後重跑會自動略過已完成者。
- 併發送出（ThreadPoolExecutor）＋ 429/5xx 指數退避重試；偵測到「額度用盡」立即中止並提示。
- 圖片題（mode=image）連同裁圖以 inline base64 一起送給模型判讀。
- 只輸出 {qid, explanation, model} 到 explanations.jsonl；套用請再跑 apply_explanations.py。

用法
  set GEMINI_API_KEY=...            # Windows；bash 用 export
  python gen_explanations_gemini.py --dry-run                 # 只估題數，不呼叫 API
  python gen_explanations_gemini.py --prof nurse --exam 113030 --limit 20   # 小量試跑
  python gen_explanations_gemini.py --prof nurse             # 全護理師未完成者
  python gen_explanations_gemini.py                          # 兩職類全部未完成者
"""
import os, sys, json, time, base64, argparse, threading, urllib.parse
import requests

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "explanations.jsonl")
QROOT = r"D:\Antigravity\test\exam-site\public\data\questions"
IMGROOT = r"D:\Antigravity\test\exam-site\public\data"
PROF_SLUGS = {"nurse": "nurse", "rt": "rt"}
DEFAULT_MODEL = "gemini-3.6-flash"

SYSTEM = (
    "你是台灣醫事人員國家考試的資深解題老師。我會給你一題考選部歷屆試題（含題幹、各選項，"
    "以及【官方公告的正確答案】）。請依官方答案寫一段精簡準確的繁體中文解析："
    "先寫「正解 X。」（X 為官方答案字母），再說明該選項為何正確、其他選項為何不適當，"
    "最後以「關鍵：…」點出重點概念或記憶點。"
    "規則：一律以官方公告的正確答案為準，不質疑、不改動答案；若為『何者錯誤／最不適當』題，"
    "說明時點出被選中的敘述為何錯誤；約 100–230 字；用詞專業但好懂；不要重述整個題目；"
    "只輸出解析內容本身，不要任何前言、標題或結語。"
    "格式要求：輸出為「單一段落」的純文字，全程不要換行、不要空行；"
    "不要使用 Markdown、粗體、條列符號；不要使用任何數學排版符號（例如 $ 或 LaTeX），"
    "需要時直接用一般文字與阿拉伯數字書寫（如 N-1、65%）。"
)


def clean_text(txt):
    """壓成單一段落純文字：移除數學排版符號、換行改空白、壓縮多餘空白。"""
    if not txt:
        return txt
    txt = txt.replace("$", "").replace("**", "").replace("　", " ")
    # 換行與 tab 轉為空白
    for ch in ("\r", "\n", "\t"):
        txt = txt.replace(ch, " ")
    while "  " in txt:
        txt = txt.replace("  ", " ")
    return txt.strip()

ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"

_write_lock = threading.Lock()
_stop = threading.Event()          # 觸發後所有工作緒停止（例如額度用盡）
_stop_reason = [None]


def qid_of(prof, code, subno, no):
    return f"{prof}|{code}-{subno}.json|{no}"


def load_done():
    done = set()
    if os.path.exists(CACHE):
        for line in open(CACHE, encoding="utf-8"):
            line = line.strip()
            if not line:
                continue
            try:
                done.add(json.loads(line)["qid"])
            except Exception:
                pass
    return done


def iter_questions(prof_slug, exam=None):
    root = os.path.join(QROOT, prof_slug)
    for name in sorted(os.listdir(root)):
        if not name.endswith(".json"):
            continue
        if exam and not name.startswith(exam):
            continue
        data = json.load(open(os.path.join(root, name), encoding="utf-8"))
        prof = data["profession"]; code = data["examCode"]; subno = data["subjectNo"]
        for q in data["questions"]:
            yield prof, code, subno, q


def build_parts(q):
    opts = q.get("options") or {}
    lines = ["題幹：" + (q.get("stem") or "")]
    for L in sorted(opts):
        lines.append(f"({L}) {opts[L]}")
    lines.append(f"官方正確答案：{q.get('answer')}")
    if q.get("corrected"):
        lines.append("（本題經更正／送分）")
    if q.get("note"):
        lines.append(f"備註：{q['note']}")
    parts = [{"text": "\n".join(lines)}]
    if q.get("mode") == "image" and q.get("img"):
        p = os.path.join(IMGROOT, q["img"].replace("/", os.sep))
        if os.path.exists(p):
            b64 = base64.b64encode(open(p, "rb").read()).decode()
            parts.insert(0, {"inline_data": {"mime_type": "image/png", "data": b64}})
    return parts


BATCH_SYSTEM = (
    SYSTEM +
    " 我會一次給你多題（每題以「第N題」標示）。請回傳一個 JSON 陣列，"
    "每個元素為物件 {\"id\": 題號整數, \"explanation\": \"該題解析\"}，"
    "id 必須對應我給的「第N題」編號，且每一題都要有一個對應元素、不可遺漏或合併。"
)

_BATCH_SCHEMA = {
    "type": "ARRAY",
    "items": {
        "type": "OBJECT",
        "properties": {"id": {"type": "INTEGER"}, "explanation": {"type": "STRING"}},
        "required": ["id", "explanation"],
    },
}


def _post(api_key, model, body, max_retries=5):
    url = ENDPOINT.format(model=model) + "?key=" + urllib.parse.quote(api_key)
    delay = 2.0
    for _ in range(max_retries):
        if _stop.is_set():
            return None
        try:
            r = requests.post(url, json=body, timeout=180)
        except Exception:
            time.sleep(delay); delay = min(delay * 2, 30); continue
        if r.status_code == 200:
            j = r.json()
            try:
                cand = j["candidates"][0]
                return "".join(p.get("text", "") for p in cand["content"]["parts"]).strip()
            except Exception:
                return None
        if r.status_code == 429:
            if "credit" in r.text.lower() or "billing" in r.text.lower():
                _stop_reason[0] = "額度用盡（prepayment credits depleted）— 請先至 AI Studio 儲值"
                _stop.set(); return None
            time.sleep(delay); delay = min(delay * 2, 60); continue
        if r.status_code in (500, 502, 503, 504):
            time.sleep(delay); delay = min(delay * 2, 30); continue
        _stop_reason[0] = f"HTTP {r.status_code}: {r.text[:200]}"
        return None
    return None


def generate_batch(api_key, model, chunk):
    """chunk: list of (qid, q)（皆為文字題）。回傳 list of (qid, explanation)。"""
    blocks = []
    for i, (_qid, q) in enumerate(chunk, 1):
        opts = q.get("options") or {}
        lines = [f"第{i}題", "題幹：" + (q.get("stem") or "")]
        for L in sorted(opts):
            lines.append(f"({L}) {opts[L]}")
        lines.append(f"官方正確答案：{q.get('answer')}")
        if q.get("corrected"):
            lines.append("（本題經更正／送分）")
        if q.get("note"):
            lines.append(f"備註：{q['note']}")
        blocks.append("\n".join(lines))
    body = {
        "system_instruction": {"parts": [{"text": BATCH_SYSTEM}]},
        "contents": [{"role": "user", "parts": [{"text": "\n\n".join(blocks)}]}],
        "generationConfig": {
            "temperature": 0.3, "maxOutputTokens": 8192,
            "responseMimeType": "application/json", "responseSchema": _BATCH_SCHEMA,
        },
    }
    txt = _post(api_key, model, body)
    results = []
    if txt:
        try:
            arr = json.loads(txt)
            by_id = {}
            for item in arr:
                by_id[int(item.get("id"))] = clean_text(item.get("explanation", ""))
            for i, (qid, _q) in enumerate(chunk, 1):
                e = by_id.get(i)
                if e:
                    results.append((qid, e))
        except Exception:
            results = []
    # 缺漏或整批失敗者，逐題補救
    got = {qid for qid, _ in results}
    for qid, q in chunk:
        if qid not in got and not _stop.is_set():
            e = generate_one(api_key, model, q)
            if e:
                results.append((qid, e))
    return results


def generate_one(api_key, model, q, max_retries=5):
    """回傳解析文字或 None。遇額度用盡設定 _stop。"""
    body = {
        "system_instruction": {"parts": [{"text": SYSTEM}]},
        "contents": [{"role": "user", "parts": build_parts(q)}],
        "generationConfig": {"temperature": 0.3, "maxOutputTokens": 2048},
    }
    url = ENDPOINT.format(model=model) + "?key=" + urllib.parse.quote(api_key)
    delay = 2.0
    for attempt in range(max_retries):
        if _stop.is_set():
            return None
        try:
            r = requests.post(url, json=body, timeout=90)
        except Exception:
            time.sleep(delay); delay = min(delay * 2, 30); continue
        if r.status_code == 200:
            j = r.json()
            try:
                cand = j["candidates"][0]
                txt = "".join(p.get("text", "") for p in cand["content"]["parts"]).strip()
                return clean_text(txt) or None
            except Exception:
                return None
        if r.status_code == 429:
            msg = r.text
            if "credit" in msg.lower() or "billing" in msg.lower():
                _stop_reason[0] = "額度用盡（prepayment credits depleted）— 請先至 AI Studio 儲值"
                _stop.set()
                return None
            time.sleep(delay); delay = min(delay * 2, 60); continue   # rate limit
        if r.status_code in (500, 502, 503, 504):
            time.sleep(delay); delay = min(delay * 2, 30); continue
        # 其他錯誤
        _stop_reason[0] = f"HTTP {r.status_code}: {r.text[:200]}"
        return None
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--prof", default="all", help="nurse / rt / all")
    ap.add_argument("--exam", default=None, help="考試碼前綴，如 113030；可只給年份如 113")
    ap.add_argument("--limit", type=int, default=0, help="最多幾題（試跑）")
    ap.add_argument("--workers", type=int, default=6, help="併發數")
    ap.add_argument("--batch", type=int, default=5, help="每次 API 呼叫處理幾題（文字題）")
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    profs = ["nurse", "rt"] if args.prof == "all" else [args.prof]
    done = load_done()
    todo = []
    for prof_slug in profs:
        for prof, code, subno, q in iter_questions(prof_slug, args.exam):
            if q.get("mode") not in ("text", "image"):
                continue                      # 略過 text_uncertain / scanned
            if not q.get("answer") or q.get("answer") == "#":
                continue
            qid = qid_of(prof, code, subno, q["no"])
            if qid in done:
                continue
            todo.append((qid, q))
            if args.limit and len(todo) >= args.limit:
                break
        if args.limit and len(todo) >= args.limit:
            break

    print(f"待生成：{len(todo)} 題（已完成 {len(done)}）")
    if args.dry_run or not todo:
        # gemini-3.6-flash 粗估：每題約 500 in + 250 out tokens
        print("（dry-run）不呼叫 API。實際生成請移除 --dry-run。")
        return

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print("ERROR：未設定環境變數 GEMINI_API_KEY"); sys.exit(1)

    # 分流：圖片題單題、文字題每 args.batch 題一組
    text_items = [(qid, q) for qid, q in todo if q.get("mode") != "image"]
    image_items = [(qid, q) for qid, q in todo if q.get("mode") == "image"]
    chunks = [text_items[i:i + args.batch] for i in range(0, len(text_items), args.batch)]
    for qid, q in image_items:
        chunks.append([(qid, q)])
    print(f"  文字題 {len(text_items)} → {len([c for c in chunks if len(c)>1 or (c and c[0][1].get('mode')!='image')])} 批；圖片題 {len(image_items)} 單題")

    out = open(CACHE, "a", encoding="utf-8")
    ok = 0; done_q = 0; t0 = time.time()
    from concurrent.futures import ThreadPoolExecutor, as_completed

    def run_chunk(chunk):
        if len(chunk) == 1 and chunk[0][1].get("mode") == "image":
            e = generate_one(api_key, args.model, chunk[0][1])
            return [(chunk[0][0], e)] if e else []
        return generate_batch(api_key, args.model, chunk)

    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = {ex.submit(run_chunk, c): len(c) for c in chunks}
        for n, fut in enumerate(as_completed(futs), 1):
            for qid, txt in fut.result():
                with _write_lock:
                    out.write(json.dumps({"qid": qid, "explanation": txt, "model": args.model}, ensure_ascii=False) + "\n")
                    out.flush()
                ok += 1
            done_q += futs[fut]
            if n % 10 == 0 or _stop.is_set():
                rate = ok / max(time.time() - t0, 1)
                print(f"  批次 {n}/{len(chunks)} 已寫入{ok} ({rate:.1f} 題/秒)")
            if _stop.is_set():
                break
    fail = len(todo) - ok
    out.close()
    print(f"完成：成功 {ok}、失敗 {fail}。")
    if _stop_reason[0]:
        print(f"中止原因：{_stop_reason[0]}")
    print("接著執行： python apply_explanations.py  再 npm run build 部署。")


if __name__ == "__main__":
    main()
