#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 explanations.jsonl 的解析套回題庫 JSON。

explanations.jsonl 每行：{"qid": "護理師|114030-1.json|1", "explanation": "..."}
qid 格式與 functions/api/answers.js 一致：prof|examCode-subNo.json|no
可重複執行；同時更新網站用的 public/data 與中間產物 exam-data（若存在）。
"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "explanations.jsonl")
TARGETS = [
    r"D:\Antigravity\test\exam-site\public\data\questions",
    r"D:\Antigravity\test\exam-data\questions",
]

def load_cache():
    m = {}
    if not os.path.exists(CACHE):
        return m
    for line in open(CACHE, encoding="utf-8"):
        line = line.strip()
        if not line:
            continue
        try:
            rec = json.loads(line)
        except Exception:
            continue
        qid = rec.get("qid")
        exp = rec.get("explanation")
        if qid and exp is not None:
            m[qid] = exp
    return m

def apply_to_tree(root, cache):
    if not os.path.isdir(root):
        return 0, 0
    files = 0
    applied = 0
    for dirpath, _, names in os.walk(root):
        for name in names:
            if not name.endswith(".json"):
                continue
            path = os.path.join(dirpath, name)
            data = json.load(open(path, encoding="utf-8"))
            prof = data.get("profession")
            code = data.get("examCode")
            subno = data.get("subjectNo")
            fname = f"{code}-{subno}.json"
            changed = False
            for q in data.get("questions", []):
                qid = f"{prof}|{fname}|{q['no']}"
                if qid in cache:
                    if q.get("explanation") != cache[qid]:
                        q["explanation"] = cache[qid]
                        changed = True
                        applied += 1
            if changed:
                json.dump(data, open(path, "w", encoding="utf-8"), ensure_ascii=False)
                files += 1
    return files, applied

def main():
    cache = load_cache()
    print(f"cache entries: {len(cache)}")
    for root in TARGETS:
        files, applied = apply_to_tree(root, cache)
        print(f"{root}: updated {applied} questions in {files} files")

if __name__ == "__main__":
    main()
