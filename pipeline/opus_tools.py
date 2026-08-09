# -*- coding: utf-8 -*-
"""Opus 手寫詳解的分批工具。
  python opus_tools.py dump N      # 取出接下來 N 題未生成詳解者 -> /tmp/opus_batch.txt (+qids.json)
  python opus_tools.py stats       # 顯示進度
合併：python opus_tools.py merge /path/to/expl.json   # {qid: explanation} 併入，model=claude-opus-4-8
"""
import json, os, sys
HERE=os.path.dirname(os.path.abspath(__file__))
CACHE=os.path.join(HERE,"explanations.jsonl")
sys.path.insert(0,HERE)
import gen_explanations_gemini as G

def load_done():
    done=set()
    if os.path.exists(CACHE):
        for l in open(CACHE,encoding="utf-8"):
            if l.strip():
                try: done.add(json.loads(l)["qid"])
                except: pass
    return done

def all_todo():
    done=load_done(); todo=[]
    for slug in ("nurse","rt"):
        for prof,code,subno,q in G.iter_questions(slug):
            if q.get("mode")!="text": continue   # 圖片題另外讀圖處理
            if not q.get("answer") or q.get("answer")=="#": continue
            qid=G.qid_of(prof,code,subno,q["no"])
            if qid not in done: todo.append((qid,q))
    return todo

def cmd_dump(n):
    todo=all_todo()[:int(n)]
    with open("/tmp/opus_batch.txt","w",encoding="utf-8") as f:
        for qid,q in todo:
            f.write(f"\n### QID={qid}  官方答案={q.get('answer')}\n")
            f.write("題幹："+(q.get("stem") or "")+"\n")
            for L in sorted(q.get("options") or {}): f.write(f"({L}) {q['options'][L]}\n")
            if q.get("note"): f.write(f"備註：{q['note']}\n")
            if q.get("mode")=="image": f.write("（本題為圖片題，無圖僅憑文字）\n")
    json.dump([qid for qid,_ in todo], open("/tmp/opus_batch_qids.json","w"), ensure_ascii=False)
    print(f"已輸出 {len(todo)} 題 -> /tmp/opus_batch.txt")

def cmd_stats():
    done=load_done(); todo=all_todo()
    print(f"已生成詳解(快取) {len(done)}；尚未生成 {len(todo)}")

def cmd_merge(path):
    new=json.load(open(path,encoding="utf-8"))
    recs=[json.loads(l) for l in open(CACHE,encoding="utf-8") if l.strip()]
    idx={r["qid"]:i for i,r in enumerate(recs)}
    add=0
    for qid,exp in new.items():
        rec={"qid":qid,"explanation":exp,"model":"claude-opus-4-8"}
        if qid in idx: recs[idx[qid]]=rec
        else: recs.append(rec);
        add+=1
    with open(CACHE,"w",encoding="utf-8") as f:
        for r in recs: f.write(json.dumps(r,ensure_ascii=False)+"\n")
    print(f"併入 {add} 題；快取總數 {len(recs)}")

if __name__=="__main__":
    c=sys.argv[1]
    if c=="dump": cmd_dump(sys.argv[2])
    elif c=="stats": cmd_stats()
    elif c=="merge": cmd_merge(sys.argv[2])
