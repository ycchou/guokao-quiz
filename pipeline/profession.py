#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Generalized 考選部 exam scraper: parse pages for a given profession keyword,
build organized folders + download list + index.

Usage: python profession.py <keyword> <outfolder> <code1> <code2> ...
Reads cached pages from ./pages/<code>.html (fetch them first with curl).
Writes dl_list_<keyword>.tsv here, and 索引.csv + README.md into OUTROOT.
"""
import json, os, re, csv, sys, html as htmlmod, collections

HERE = os.path.dirname(__file__)
BASE = "https://wwwq.moex.gov.tw/exam/"
TYPE_NAME = {"Q": "試題", "S": "答案", "M": "更正答案"}
TYPE_ORDER = ["Q", "S", "M"]

KEYWORD = sys.argv[1]
OUTNAME = sys.argv[2]
CODES = sys.argv[3:]
OUTROOT = os.path.join(r"D:\Antigravity\test", OUTNAME)

OFFICIAL = {}
for line in open(os.path.join(HERE, "allexams.txt"), encoding="utf-8"):
    if "\t" in line:
        c, n = line.rstrip("\n").split("\t", 1)
        OFFICIAL[c] = n

def session_of(name):
    m = re.search(r'第[一二三四1-4]次', name)
    if m:
        return m.group(0).replace("1", "一").replace("2", "二").replace("3", "三").replace("4", "四")
    return "第一次"

def clean_subject(title):
    t = htmlmod.unescape(title)
    t = re.sub(r'^另開[新]?視窗[，,]\s*開[啓啟]\s*', '', t)
    t = re.sub(r'(試題|測驗題標準答案|標準答案|更正後答案|更正答案|答案)\s*[\(（]Pdf檔[\)）]\s*$', '', t)
    return t.strip()

def short_subject(name):
    n = re.sub(r'[（(][^）)]*[）)]', '', name)
    return n.replace("　", "").strip() or name

def safe(s):
    return re.sub(r'[<>:"/\\|?*]', '_', s).strip()

def parse(code, h):
    exam_name = OFFICIAL.get(code, "")
    labs = re.findall(rf'<label[^>]*for="[^"]*chk_{code}_(\d+)"[^>]*>([^<]*)</label>', h)
    target_c = None
    for c, n in labs:
        n2 = htmlmod.unescape(n)
        if KEYWORD in n2:
            target_c = c; break
    if not target_c:
        return exam_name, None, []
    files = {}
    for m in re.finditer(
        rf'title="([^"]*)"[^>]*href="(wHandExamQandA_File\.ashx\?t=([QSM])&amp;code={code}&amp;c={target_c}&amp;s=(\d+)&amp;q=1)"', h):
        title, href, t, s = m.groups()
        href = href.replace("&amp;", "&")
        subj = clean_subject(title)
        files.setdefault(s, {"name": subj, "types": {}})
        files[s]["types"][t] = href
        if len(subj) > len(files[s]["name"]):
            files[s]["name"] = subj
    return exam_name, target_c, [(s, files[s]) for s in sorted(files)]

# ---- parse all ----
exams = []
for code in CODES:
    p = os.path.join(HERE, "pages", f"{code}.html")
    h = open(p, encoding="utf-8").read()
    name, c, subs = parse(code, h)
    if not c or not subs:
        print(f"{code}: NO {KEYWORD} -> skip")
        continue
    exams.append({"code": code, "c": c, "minguo": code[:3],
                  "session": session_of(name), "exam_name": name,
                  "subjects": [{"s": s, "name": x["name"], "types": x["types"]} for s, x in subs]})

groups = collections.Counter((e["minguo"], e["session"]) for e in exams)

def folder_name(e):
    base = f"{e['minguo']}年_{e['session']}"
    if groups[(e["minguo"], e["session"])] > 1:
        base += f"（{e['code']}）"
    return base

rows, dl = [], []
for e in sorted(exams, key=lambda x: (x["minguo"], x["code"])):
    folder = folder_name(e)
    for idx, sub in enumerate(e["subjects"], 1):
        subj_short = short_subject(sub["name"])
        for t in TYPE_ORDER:
            if t not in sub["types"]:
                continue
            fname = safe(f"{idx}_{subj_short}_{TYPE_NAME[t]}.pdf")
            rel = os.path.join(folder, fname)
            dl.append((BASE + sub["types"][t], os.path.join(OUTROOT, rel)))
            rows.append({"民國年": e["minguo"], "場次": e["session"], "考試代碼": e["code"],
                         "科目序": idx, "科目": sub["name"], "類型": TYPE_NAME[t], "檔案": rel})

with open(os.path.join(HERE, f"dl_list_{OUTNAME}.tsv"), "w", encoding="utf-8", newline="") as f:
    for url, path in dl:
        f.write(url + "\t" + path + "\n")

os.makedirs(OUTROOT, exist_ok=True)
with open(os.path.join(OUTROOT, "索引.csv"), "w", encoding="utf-8-sig", newline="") as f:
    w = csv.DictWriter(f, fieldnames=["民國年", "場次", "考試代碼", "科目序", "科目", "類型", "檔案"])
    w.writeheader(); w.writerows(rows)

n_q = sum(r["類型"] == "試題" for r in rows)
n_s = sum(r["類型"] == "答案" for r in rows)
n_m = sum(r["類型"] == "更正答案" for r in rows)
lines = [f"# {KEYWORD}高考歷屆試題（民國100年起）", "",
         "資料來源：考選部「考畢試題查詢平臺」 https://wwwq.moex.gov.tw/exam/wFrmExamQandASearch.aspx", "",
         f"- 考試場次：{len(exams)} 場",
         f"- 試題檔：{n_q}　標準答案檔：{n_s}　更正答案檔：{n_m}",
         f"- 檔案總數：{len(rows)}", "",
         "## 資料夾結構", "",
         "每個場次一個資料夾。檔名格式：`科目序_科目名_類型.pdf`", "",
         "## 場次清單", "",
         "| 民國年 | 場次 | 考試代碼 | 科目數 | 官方考試名稱 |", "|---|---|---|---|---|"]
for e in sorted(exams, key=lambda x: (x["minguo"], x["code"])):
    lines.append(f"| {e['minguo']} | {e['session']} | {e['code']} | {len(e['subjects'])} | {e['exam_name']} |")
open(os.path.join(OUTROOT, "README.md"), "w", encoding="utf-8").write("\n".join(lines) + "\n")

print(f"\n{KEYWORD}: exams={len(exams)} files={len(rows)} (Q={n_q} S={n_s} M={n_m})")
for e in sorted(exams, key=lambda x: (x["minguo"], x["code"])):
    nm = sum('M' in s['types'] for s in e['subjects'])
    print(f"  {e['code']} c={e['c']} {e['minguo']}{e['session']} 科目={len(e['subjects'])} M={nm}  {e['exam_name'][:32]}")
