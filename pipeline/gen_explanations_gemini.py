#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""用 Google Gemini（gemini-3.6-flash）生成題目詳解——「免費額度節流版」。

免費額度預設（可用參數調整）：
  10 RPM（每分鐘請求數）／ 250,000 TPM（每分鐘 token）／ 1,500 RPD（每日請求數）

省錢關鍵：
  1. 低速：Governor 保證請求間隔 ≥ 60/RPM 秒。
  2. 限量：達每日 RPD 上限自動停止；當日用量記於 gemini_quota.json，跨重啟累計。
  3. 一次多題：每個請求塞 --batch 題（JSON 陣列輸出），大幅減少請求數 → 每日能做更多題。
  4. 關思考：預設 thinkingBudget=0（思考型模型的思考 token 也計費，關掉最省）。

金鑰只從環境變數 GEMINI_API_KEY 讀取，不落地、不進 git。
用法：
  set GEMINI_API_KEY=...
  python gen_explanations_gemini.py --dry-run                 # 只估題數
  python gen_explanations_gemini.py --prof nurse --exam 113030 --limit 30   # 小量試跑
  python gen_explanations_gemini.py --prof all               # 依免費額度，每天跑到上限自動停
"""
import os, sys, json, time, base64, argparse, threading, datetime, urllib.parse
import requests

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "explanations.jsonl")
QUOTA = os.path.join(HERE, "gemini_quota.json")
QROOT = r"D:\Antigravity\test\exam-site\public\data\questions"
IMGROOT = r"D:\Antigravity\test\exam-site\public\data"
DEFAULT_MODEL = "gemini-3.6-flash"
ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"

SYSTEM = (
    "你是台灣醫事人員國家考試的資深解題老師。我會給你一題考選部歷屆試題（含題幹、各選項，"
    "以及【官方公告的正確答案】）。請依官方答案寫一段精簡準確的繁體中文解析："
    "先寫「正解 X。」（X 為官方答案字母），再說明該選項為何正確、其他選項為何不適當，"
    "最後以「關鍵：…」點出重點概念或記憶點。"
    "規則：一律以官方公告的正確答案為準，不質疑、不改動答案；若為『何者錯誤／最不適當』題，"
    "說明時點出被選中的敘述為何錯誤；約 100–230 字；用詞專業但好懂；不要重述整個題目；"
    "只輸出解析內容本身，不要任何前言、標題或結語。"
    "格式：單一段落純文字，不要換行或空行，不要 Markdown、粗體、條列，"
    "不要使用 $ 或 LaTeX 等數學排版符號（用一般文字與阿拉伯數字，如 N-1、65%）。"
)
BATCH_SYSTEM = (
    SYSTEM +
    " 我會一次給你多題（每題以「第N題」標示）。請回傳一個 JSON 陣列，每個元素為物件 "
    "{\"id\": 題號整數, \"explanation\": \"該題解析\"}，id 必須對應「第N題」編號，"
    "每一題都要有一個對應元素、不可遺漏或合併。"
)
_BATCH_SCHEMA = {
    "type": "ARRAY",
    "items": {"type": "OBJECT",
              "properties": {"id": {"type": "INTEGER"}, "explanation": {"type": "STRING"}},
              "required": ["id", "explanation"]},
}

_write_lock = threading.Lock()
_stop = threading.Event()
_stop_reason = [None]


class Governor:
    """限制請求速率（RPM）與每日總量（RPD，跨重啟累計於 gemini_quota.json）。"""
    def __init__(self, rpm, rpd):
        self.min_interval = 60.0 / rpm if rpm > 0 else 0.0
        self.lock = threading.Lock()
        self.last = 0.0
        self.rpd = rpd
        today = datetime.date.today().isoformat()
        used = 0
        if os.path.exists(QUOTA):
            try:
                q = json.load(open(QUOTA, encoding="utf-8"))
                if q.get("date") == today:
                    used = int(q.get("used", 0))
            except Exception:
                pass
        self.date = today
        self.used_start = used
        self.count = 0            # 本次執行已用請求數
        self._persist()

    def remaining(self):
        return max(0, self.rpd - self.used_start - self.count)

    def _persist(self):
        try:
            json.dump({"date": self.date, "used": self.used_start + self.count},
                      open(QUOTA, "w", encoding="utf-8"))
        except Exception:
            pass

    def acquire(self):
        with self.lock:
            if self.used_start + self.count >= self.rpd:
                if not _stop.is_set():
                    _stop_reason[0] = f"已達每日請求上限 {self.rpd}（RPD），今日停止；明日可續跑。"
                    _stop.set()
                return False
            now = time.monotonic()
            wait = self.min_interval - (now - self.last)
            if wait > 0:
                time.sleep(wait); now = time.monotonic()
            self.last = now
            self.count += 1
            if self.count % 20 == 0:
                self._persist()
            return True


GOV = None


def clean_text(txt):
    if not txt:
        return txt
    txt = txt.replace("$", "").replace("**", "").replace("　", " ")
    for ch in ("\r", "\n", "\t"):
        txt = txt.replace(ch, " ")
    while "  " in txt:
        txt = txt.replace("  ", " ")
    return txt.strip()


def qid_of(prof, code, subno, no):
    return f"{prof}|{code}-{subno}.json|{no}"


def load_done():
    done = set()
    if os.path.exists(CACHE):
        for line in open(CACHE, encoding="utf-8"):
            line = line.strip()
            if line:
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


def _gen_config(args, schema=None, max_tokens=2048):
    cfg = {"temperature": 0.3, "maxOutputTokens": max_tokens}
    if args.thinking_budget is not None:
        cfg["thinkingConfig"] = {"thinkingBudget": args.thinking_budget}
    if schema is not None:
        cfg["responseMimeType"] = "application/json"
        cfg["responseSchema"] = schema
    return cfg


def _post(api_key, model, body, max_retries=5):
    """單一 HTTP 請求（經 Governor 節流）。"""
    if GOV is not None and not GOV.acquire():
        return None
    url = ENDPOINT.format(model=model) + "?key=" + urllib.parse.quote(api_key)
    delay = 6.0
    for _ in range(max_retries):
        if _stop.is_set():
            return None
        try:
            r = requests.post(url, json=body, timeout=180)
        except Exception:
            time.sleep(delay); delay = min(delay * 2, 60); continue
        if r.status_code == 200:
            j = r.json()
            try:
                cand = j["candidates"][0]
                return "".join(p.get("text", "") for p in cand["content"]["parts"]).strip()
            except Exception:
                return None
        if r.status_code == 429:
            low = r.text.lower()
            if "spending cap" in low or "credit" in low or "billing" in low:
                _stop_reason[0] = "額度／支出上限已滿（billing）— 請至 AI Studio 調整；或改用免費額度專案金鑰"
                _stop.set(); return None
            # 速率限制：退避後重試（重試不再額外佔用 governor 的 count）
            time.sleep(delay); delay = min(delay * 2, 60); continue
        if r.status_code in (500, 502, 503, 504):
            time.sleep(delay); delay = min(delay * 2, 30); continue
        _stop_reason[0] = f"HTTP {r.status_code}: {r.text[:200]}"
        return None
    return None


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


def generate_one(api_key, model, q, args):
    body = {"system_instruction": {"parts": [{"text": SYSTEM}]},
            "contents": [{"role": "user", "parts": build_parts(q)}],
            "generationConfig": _gen_config(args, max_tokens=2048)}
    txt = _post(api_key, model, body)
    return clean_text(txt) if txt else None


def generate_batch(api_key, model, chunk, args):
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
    body = {"system_instruction": {"parts": [{"text": BATCH_SYSTEM}]},
            "contents": [{"role": "user", "parts": [{"text": "\n\n".join(blocks)}]}],
            "generationConfig": _gen_config(args, schema=_BATCH_SCHEMA,
                                            max_tokens=min(600 * len(chunk) + 1024, 32768))}
    txt = _post(api_key, model, body)
    results = []
    if txt:
        try:
            by_id = {int(it["id"]): clean_text(it.get("explanation", "")) for it in json.loads(txt)}
            for i, (qid, _q) in enumerate(chunk, 1):
                if by_id.get(i):
                    results.append((qid, by_id[i]))
        except Exception:
            results = []
    got = {qid for qid, _ in results}
    for qid, q in chunk:
        if qid not in got and not _stop.is_set():
            e = generate_one(api_key, model, q, args)
            if e:
                results.append((qid, e))
    return results


def main():
    global GOV
    ap = argparse.ArgumentParser()
    ap.add_argument("--prof", default="all", help="nurse / rt / all")
    ap.add_argument("--exam", default=None, help="考試碼前綴，如 113030 或 113")
    ap.add_argument("--limit", type=int, default=0, help="最多幾題（試跑）")
    ap.add_argument("--batch", type=int, default=15, help="每個請求處理幾題")
    ap.add_argument("--workers", type=int, default=3, help="併發數（受 RPM 節流，不宜過高）")
    ap.add_argument("--rpm", type=int, default=10, help="每分鐘請求上限（免費額度 10）")
    ap.add_argument("--rpd", type=int, default=1500, help="每日請求上限（免費額度 1500）")
    ap.add_argument("--thinking-budget", type=int, default=0,
                    help="思考 token 預算（0=關閉最省；設 -1 或省略可用動態思考）")
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    profs = ["nurse", "rt"] if args.prof == "all" else [args.prof]
    done = load_done()
    todo = []
    for prof_slug in profs:
        for prof, code, subno, q in iter_questions(prof_slug, args.exam):
            if q.get("mode") not in ("text", "image"):
                continue
            if not q.get("answer") or q.get("answer") == "#":
                continue
            qid = qid_of(prof, code, subno, q["no"])
            if qid not in done:
                todo.append((qid, q))
            if args.limit and len(todo) >= args.limit:
                break
        if args.limit and len(todo) >= args.limit:
            break

    text_items = [(qid, q) for qid, q in todo if q.get("mode") != "image"]
    image_items = [(qid, q) for qid, q in todo if q.get("mode") == "image"]
    chunks = [text_items[i:i + args.batch] for i in range(0, len(text_items), args.batch)]
    chunks += [[it] for it in image_items]
    est_requests = len(chunks)
    print(f"待生成：{len(todo)} 題 → {est_requests} 個請求（每請求最多 {args.batch} 題）")

    if args.dry_run or not todo:
        days = -(-est_requests // args.rpd)
        print(f"（dry-run）以 {args.rpm} RPM／{args.rpd} RPD 估算：約需 {days} 天（每天約 {args.rpd} 請求、"
              f"~{args.rpd*args.batch} 題）。thinking_budget={args.thinking_budget}")
        return

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print("ERROR：未設定 GEMINI_API_KEY"); sys.exit(1)

    GOV = Governor(args.rpm, args.rpd)
    rem = GOV.remaining()
    print(f"今日剩餘可用請求：{rem}（RPD {args.rpd}）")
    if rem <= 0:
        print("今日請求額度已用完，請明日再跑。"); return

    out = open(CACHE, "a", encoding="utf-8")
    ok = 0; t0 = time.time()
    from concurrent.futures import ThreadPoolExecutor, as_completed

    def run_chunk(chunk):
        if len(chunk) == 1 and chunk[0][1].get("mode") == "image":
            e = generate_one(api_key, args.model, chunk[0][1], args)
            return [(chunk[0][0], e)] if e else []
        return generate_batch(api_key, args.model, chunk, args)

    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = {ex.submit(run_chunk, c): c for c in chunks}
        for n, fut in enumerate(as_completed(futs), 1):
            for qid, txt in fut.result():
                with _write_lock:
                    out.write(json.dumps({"qid": qid, "explanation": txt, "model": args.model}, ensure_ascii=False) + "\n")
                    out.flush()
                ok += 1
            if n % 5 == 0 or _stop.is_set():
                rate = ok / max(time.time() - t0, 1)
                print(f"  已處理 {n}/{len(chunks)} 請求；寫入 {ok} 題；剩餘今日請求 {GOV.remaining()} ({rate:.2f} 題/秒)")
            if _stop.is_set():
                break
    out.close()
    GOV._persist()
    print(f"本次寫入 {ok} 題；今日已用請求 {GOV.used_start + GOV.count}/{args.rpd}。")
    if _stop_reason[0]:
        print("停止原因：" + _stop_reason[0])
    print("接著執行： python apply_explanations.py 再 build/deploy。")


if __name__ == "__main__":
    main()
