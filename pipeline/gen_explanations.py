#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""用 Anthropic Batch API 批次生成題目詳解（Opus 4.8）。

特色：
- 內容雜湊/qid 快取（explanations.jsonl）：只對「未生成」的題生成，可重複執行、增量補。
- 圖片題以 vision 一起判讀（讀 public/data/q-img）。
- 系統提示詞 prompt caching，Batch API 5 折，成本最省。
- 生成後只寫入 explanations.jsonl；再跑 apply_explanations.py 套回題庫 JSON。

用法：
  pip install anthropic
  set ANTHROPIC_API_KEY=sk-ant-...        # Windows；或 export（bash）
  python gen_explanations.py --prof nurse            # 全護理師（約 12,300 題）
  python gen_explanations.py --prof nurse --exam 114030   # 只某場
  python gen_explanations.py --prof nurse --limit 50      # 只前 50 題（試跑）
  python gen_explanations.py --prof nurse --dry-run       # 只估題數與粗略成本，不呼叫 API
成本（Opus 4.8＋批次5折）：約每千題 US$4–6；全護理師約 US$50–70（估計，實際依長度）。
"""
import os, sys, json, time, base64, argparse, hashlib

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "explanations.jsonl")
QROOT = r"D:\Antigravity\test\exam-site\public\data\questions"
IMGROOT = r"D:\Antigravity\test\exam-site\public\data"

MODEL = "claude-opus-4-8"

SYSTEM = (
    "你是台灣醫事人員國家考試的資深解題老師。我會給你一題考選部歷屆試題（含題幹、各選項，以及【官方公告的正確答案】）。"
    "請根據官方答案，用繁體中文寫一段精簡準確的解析：①點出正解為何正確 ②簡述其他每個選項為何不適當 ③帶出關鍵概念或記憶點。"
    "規則：一律以官方公告的正確答案為準，不要質疑或改動答案；若題目經更正／送分，依提供的備註說明；約 100–250 字；"
    "用詞專業但好懂；不要重述整個題目；只輸出解析內容本身，不要任何前言、標題或結語。"
)


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
        if exam and not name.startswith(exam + "-"):
            continue
        data = json.load(open(os.path.join(root, name), encoding="utf-8"))
        prof = data["profession"]; code = data["examCode"]; subno = data["subjectNo"]
        for q in data["questions"]:
            yield prof, code, subno, q


def build_user_content(q):
    lines = [f"題幹：{q.get('stem','')}"]
    opts = q.get("options") or {}
    for L in sorted(opts):
        lines.append(f"({L}) {opts[L]}")
    lines.append(f"官方正確答案：{q.get('answer')}")
    if q.get("corrected"):
        lines.append("（本題經更正／送分）")
    if q.get("note"):
        lines.append(f"備註：{q['note']}")
    text = "\n".join(lines)
    content = [{"type": "text", "text": text}]
    if q.get("mode") == "image" and q.get("img"):
        p = os.path.join(IMGROOT, q["img"].replace("/", os.sep))
        if os.path.exists(p):
            b64 = base64.b64encode(open(p, "rb").read()).decode()
            content.insert(0, {"type": "image", "source": {
                "type": "base64", "media_type": "image/png", "data": b64}})
    return content


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--prof", default="nurse", help="slug: nurse / rt")
    ap.add_argument("--exam", default=None, help="只做某考試碼，如 114030")
    ap.add_argument("--limit", type=int, default=0, help="最多幾題（試跑用）")
    ap.add_argument("--model", default=MODEL)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    done = load_done()
    todo = []  # (custom_id, qid, params)
    cid2qid = {}
    for prof, code, subno, q in iter_questions(args.prof, args.exam):
        if q.get("mode") not in ("text", "image"):
            continue  # 略過 text_uncertain / scanned
        if not q.get("answer"):
            continue
        qid = qid_of(prof, code, subno, q["no"])
        if qid in done:
            continue
        cid = "q" + hashlib.sha1(qid.encode("utf-8")).hexdigest()[:40]
        cid2qid[cid] = qid
        params = {
            "model": args.model,
            "max_tokens": 700,
            "system": [{"type": "text", "text": SYSTEM, "cache_control": {"type": "ephemeral"}}],
            "messages": [{"role": "user", "content": build_user_content(q)}],
        }
        todo.append((cid, qid, params))
        if args.limit and len(todo) >= args.limit:
            break

    print(f"待生成題數：{len(todo)}（已完成 {len(done)}）")
    if args.dry_run or not todo:
        est = len(todo) * 0.005
        print(f"（dry-run）粗估成本約 US${est:.1f}（Opus＋批次，實際依長度）")
        return

    import anthropic
    client = anthropic.Anthropic()

    # 分批（每批上限 100k，這裡保守每批 20k）
    CHUNK = 20000
    out = open(CACHE, "a", encoding="utf-8")
    for i in range(0, len(todo), CHUNK):
        chunk = todo[i:i + CHUNK]
        reqs = [{"custom_id": cid, "params": p} for (cid, _qid, p) in chunk]
        batch = client.messages.batches.create(requests=reqs)
        print(f"批次 {batch.id} 已送出（{len(reqs)} 題），輪詢中…")
        while True:
            b = client.messages.batches.retrieve(batch.id)
            if b.processing_status == "ended":
                break
            print(f"  處理中… succeeded={b.request_counts.succeeded} errored={b.request_counts.errored}")
            time.sleep(30)
        n_ok = 0
        for r in client.messages.batches.results(batch.id):
            qid = cid2qid.get(r.custom_id)
            if not qid:
                continue
            if r.result.type == "succeeded":
                txt = "".join(b.text for b in r.result.message.content if getattr(b, "type", "") == "text").strip()
                if txt:
                    out.write(json.dumps({"qid": qid, "explanation": txt, "model": args.model}, ensure_ascii=False) + "\n")
                    out.flush()
                    n_ok += 1
            else:
                print(f"  失敗 {qid}: {r.result.type}")
        print(f"  批次完成，成功寫入 {n_ok} 題")
    out.close()
    print("全部完成。接著執行： python apply_explanations.py")


if __name__ == "__main__":
    main()
