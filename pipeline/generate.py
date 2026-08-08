#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Build organized folder plan + download list + index from manifest.json."""
import json, os, re, csv, collections

HERE = os.path.dirname(__file__)
OUTROOT = r"D:\Antigravity\test\護理師高考歷屆試題"
BASE = "https://wwwq.moex.gov.tw/exam/"
TYPE_NAME = {"Q": "試題", "S": "答案", "M": "更正答案"}
TYPE_ORDER = ["Q", "S", "M"]

data = json.load(open(os.path.join(HERE, "manifest.json"), encoding="utf-8"))

# disambiguate duplicate (minguo, session) -> append (code)
groups = collections.Counter((e["minguo"], e["session"]) for e in data)

def short_subject(name):
    n = re.sub(r'[（(][^）)]*[）)]', '', name)   # drop parenthetical detail
    n = n.replace("　", "").strip()
    return n or name

def folder_name(e):
    base = f"{e['minguo']}年_{e['session']}"
    if groups[(e["minguo"], e["session"])] > 1:
        base += f"（{e['code']}）"
    return base

def safe(s):
    return re.sub(r'[<>:"/\\|?*]', '_', s).strip()

rows = []          # for index csv
dl = []            # (url, abspath)
for e in sorted(data, key=lambda x: (x["minguo"], x["code"])):
    folder = folder_name(e)
    for idx, sub in enumerate(e["subjects"], 1):
        subj_short = short_subject(sub["name"])
        for t in TYPE_ORDER:
            if t not in sub["types"]:
                continue
            fname = safe(f"{idx}_{subj_short}_{TYPE_NAME[t]}.pdf")
            rel = os.path.join(folder, fname)
            abspath = os.path.join(OUTROOT, rel)
            url = BASE + sub["types"][t]
            dl.append((url, abspath))
            rows.append({
                "民國年": e["minguo"], "場次": e["session"], "考試代碼": e["code"],
                "科目序": idx, "科目": sub["name"], "類型": TYPE_NAME[t],
                "檔案": rel,
            })

# write download list
with open(os.path.join(HERE, "dl_list.tsv"), "w", encoding="utf-8") as f:
    for url, path in dl:
        f.write(url + "\t" + path + "\n")

# ensure outroot + index dir
os.makedirs(OUTROOT, exist_ok=True)

# write index csv (utf-8-sig for Excel)
with open(os.path.join(OUTROOT, "索引.csv"), "w", encoding="utf-8-sig", newline="") as f:
    w = csv.DictWriter(f, fieldnames=["民國年", "場次", "考試代碼", "科目序", "科目", "類型", "檔案"])
    w.writeheader(); w.writerows(rows)

# write README
n_exams = len(data)
n_q = sum(r["類型"] == "試題" for r in rows)
n_s = sum(r["類型"] == "答案" for r in rows)
n_m = sum(r["類型"] == "更正答案" for r in rows)
lines = [
    "# 護理師高考歷屆試題（民國100年～114年）",
    "",
    "資料來源：考選部「考畢試題查詢平臺」 https://wwwq.moex.gov.tw/exam/wFrmExamQandASearch.aspx",
    "",
    f"- 考試場次：{n_exams} 場",
    f"- 試題檔：{n_q}　標準答案檔：{n_s}　更正答案檔：{n_m}",
    f"- 檔案總數：{len(rows)}",
    "",
    "## 資料夾結構",
    "",
    "每個場次一個資料夾，內含 5 個科目的試題／答案／更正答案（若有）。",
    "檔名格式：`科目序_科目名_類型.pdf`",
    "",
    "## 場次清單",
    "",
    "| 民國年 | 場次 | 考試代碼 | 官方考試名稱 |",
    "|---|---|---|---|",
]
for e in sorted(data, key=lambda x: (x["minguo"], x["code"])):
    lines.append(f"| {e['minguo']} | {e['session']} | {e['code']} | {e['exam_name']} |")
lines += ["", "> 註：護理師自102年起每年舉辦2次；112年起部分年度加辦第三次考試。",
          "> 100～101年護理師考試併於「醫事人員」考試舉行。", ""]
open(os.path.join(OUTROOT, "README.md"), "w", encoding="utf-8").write("\n".join(lines))

print(f"exams={n_exams} files={len(rows)} (Q={n_q} S={n_s} M={n_m})")
print("dl_list.tsv, 索引.csv, README.md written")
