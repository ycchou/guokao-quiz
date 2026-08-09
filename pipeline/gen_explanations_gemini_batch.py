#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""用 Google Gemini Batch API（非同步、費用約 5 折）批次生成題目詳解。

流程（可續跑）：
  submit  收集未完成題 → 分批上傳 JSONL 輸入檔 → 建立 batch job(s)，狀態寫入 batch_state.json
  fetch   輪詢每個 job；完成後下載結果、對應回 qid、清理後寫入 explanations.jsonl
  run     submit 後持續 fetch 直到全部完成（適合背景執行）

金鑰僅從環境變數 GEMINI_API_KEY 讀取，不落地、不進 git。
用法：
  set GEMINI_API_KEY=...
  python gen_explanations_gemini_batch.py submit --prof all
  python gen_explanations_gemini_batch.py fetch          # 反覆執行直到全部 ingested
  python gen_explanations_gemini_batch.py run --prof all # 一次做完（背景）
"""
import os, sys, json, time, base64, argparse
from google import genai

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "explanations.jsonl")
STATE = os.path.join(HERE, "batch_state.json")
QROOT = r"D:\Antigravity\test\exam-site\public\data\questions"
IMGROOT = r"D:\Antigravity\test\exam-site\public\data"
DEFAULT_MODEL = "gemini-3.6-flash"
MAX_PER_JOB = 5000     # 每個 batch job 的請求數上限（保守）

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


def clean_text(txt):
    if not txt:
        return txt
    txt = txt.replace("$", "").replace("**", "").replace("　", " ")
    for ch in ("\r", "\n", "\t"):
        txt = txt.replace(ch, " ")
    while "  " in txt:
        txt = txt.replace("  ", " ")
    return txt.strip()


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


def build_request(q):
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
            parts.insert(0, {"inlineData": {"mimeType": "image/png", "data": b64}})
    return {
        "contents": [{"role": "user", "parts": parts}],
        "systemInstruction": {"parts": [{"text": SYSTEM}]},
        "generationConfig": {"temperature": 0.3, "maxOutputTokens": 2048},
    }


def collect_todo(profs, exam):
    done = load_done()
    todo = []
    for prof_slug in profs:
        for prof, code, subno, q in iter_questions(prof_slug, exam):
            if q.get("mode") not in ("text", "image"):
                continue
            if not q.get("answer") or q.get("answer") == "#":
                continue
            qid = f"{prof}|{code}-{subno}.json|{q['no']}"
            if qid in done:
                continue
            todo.append((qid, q))
    return todo


def cmd_submit(client, args):
    profs = ["nurse", "rt"] if args.prof == "all" else [args.prof]
    todo = collect_todo(profs, args.exam)
    if args.limit:
        todo = todo[:args.limit]
    print(f"待送出：{len(todo)} 題")
    if not todo:
        return
    state = {"model": args.model, "jobs": []}
    for start in range(0, len(todo), MAX_PER_JOB):
        chunk = todo[start:start + MAX_PER_JOB]
        fn = os.path.join(HERE, f"_batch_in_{start}.jsonl")
        keymap = {}
        with open(fn, "w", encoding="utf-8") as f:
            for i, (qid, q) in enumerate(chunk):
                key = f"r{i}"
                keymap[key] = qid
                f.write(json.dumps({"key": key, "request": build_request(q)}, ensure_ascii=False) + "\n")
        up = client.files.upload(file=fn, config={"mime_type": "application/jsonl"})
        job = client.batches.create(model=args.model, src=up.name)
        print(f"  job {job.name}  ({len(chunk)} 題)  state={job.state}")
        state["jobs"].append({"job": job.name, "keymap": keymap, "ingested": False})
        os.remove(fn)
    json.dump(state, open(STATE, "w", encoding="utf-8"), ensure_ascii=False)
    print(f"已建立 {len(state['jobs'])} 個 batch job，狀態存於 {STATE}")


def _ingest_job(client, jobrec):
    job = client.batches.get(name=jobrec["job"])
    st = str(job.state)
    if not any(x in st for x in ("SUCCEEDED", "PARTIALLY")):
        return st, 0
    keymap = jobrec["keymap"]
    written = 0
    out = open(CACHE, "a", encoding="utf-8")
    dest = job.dest
    records = []
    if dest and getattr(dest, "file_name", None):
        raw = client.files.download(file=dest.file_name)
        txt = raw.decode("utf-8") if isinstance(raw, (bytes, bytearray)) else str(raw)
        for ln in txt.strip().splitlines():
            if ln.strip():
                records.append(json.loads(ln))
    elif dest and getattr(dest, "inlined_responses", None):
        for i, r in enumerate(dest.inlined_responses):
            records.append({"key": f"r{i}", "_inline": r})
    for rec in records:
        qid = keymap.get(rec.get("key"))
        if not qid:
            continue
        try:
            if "_inline" in rec:
                t = rec["_inline"].response.candidates[0].content.parts[0].text
            else:
                t = rec["response"]["candidates"][0]["content"]["parts"][0]["text"]
        except Exception:
            continue
        t = clean_text(t)
        if t:
            out.write(json.dumps({"qid": qid, "explanation": t, "model": job.model}, ensure_ascii=False) + "\n")
            written += 1
    out.close()
    jobrec["ingested"] = True
    return st, written


def cmd_fetch(client, args):
    if not os.path.exists(STATE):
        print("找不到 batch_state.json，請先 submit"); return False
    state = json.load(open(STATE, encoding="utf-8"))
    all_done = True
    total_written = 0
    for jr in state["jobs"]:
        if jr.get("ingested"):
            continue
        st, w = _ingest_job(client, jr)
        total_written += w
        print(f"  {jr['job']}: {st}  寫入 {w}")
        if not jr.get("ingested"):
            all_done = False
    json.dump(state, open(STATE, "w", encoding="utf-8"), ensure_ascii=False)
    print(f"本次寫入 {total_written} 題；{'全部完成' if all_done else '仍有 job 進行中'}")
    return all_done


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["submit", "fetch", "run"])
    ap.add_argument("--prof", default="all")
    ap.add_argument("--exam", default=None)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--poll", type=int, default=60, help="fetch/run 輪詢間隔秒數")
    args = ap.parse_args()

    key = os.environ.get("GEMINI_API_KEY")
    if not key:
        print("ERROR：未設定 GEMINI_API_KEY"); sys.exit(1)
    client = genai.Client(api_key=key)

    if args.cmd == "submit":
        cmd_submit(client, args)
    elif args.cmd == "fetch":
        cmd_fetch(client, args)
    elif args.cmd == "run":
        cmd_submit(client, args)
        while True:
            if cmd_fetch(client, args):
                break
            time.sleep(args.poll)
        print("完成。接著執行： python apply_explanations.py 再 build/deploy。")


if __name__ == "__main__":
    main()
