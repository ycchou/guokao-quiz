#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Dry-run parser for 考選部 護理師高考 exam pages.
Finds the 護理師 (高考, not 護士普考) category code per exam and lists Q/S/M files.
"""
import re, os, sys, html as htmlmod, urllib.request, json

BASE = "https://wwwq.moex.gov.tw/exam/"
CACHE = os.path.join(os.path.dirname(__file__), "pages")
os.makedirs(CACHE, exist_ok=True)

CODES = """100030 100140 101030 101110 102030 102110 103030 103100 104030 104100
105030 105090 106030 106110 106111 107030 107110 108020 108110 109030 109110
110030 110110 111030 111110 112030 112110 112180 113030 113100 113180
114030 114100 114170""".split()

def fetch(code):
    p = os.path.join(CACHE, f"{code}.html")
    if os.path.exists(p) and os.path.getsize(p) > 2000:
        return open(p, encoding="utf-8").read()
    minguo = int(code[:3]); ad = minguo + 1911
    url = f"{BASE}wFrmExamQandASearch.aspx?y={ad}&e={code}"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    data = urllib.request.urlopen(req, timeout=60).read().decode("utf-8", "replace")
    open(p, "w", encoding="utf-8").write(data)
    return data

TYPE_NAME = {"Q": "試題", "S": "答案", "M": "更正答案"}

# official exam names from dropdown (allexams.txt: "<code>\t<name>")
OFFICIAL = {}
_af = os.path.join(os.path.dirname(__file__), "allexams.txt")
if os.path.exists(_af):
    for line in open(_af, encoding="utf-8"):
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

def parse(code, h):
    exam_name = OFFICIAL.get(code, "")
    # profession labels -> find 護理師 高考 (exclude 護士)
    labs = re.findall(rf'<label[^>]*for="[^"]*chk_{code}_(\d+)"[^>]*>([^<]*)</label>', h)
    nursing_c = None
    for c, n in labs:
        n2 = htmlmod.unescape(n)
        if "護理師" in n2:
            nursing_c = c; nursing_label = n2; break
    if not nursing_c:
        return exam_name, None, []
    # collect Q/S/M links for that c
    files = {}
    for m in re.finditer(
        rf'title="([^"]*)"[^>]*href="(wHandExamQandA_File\.ashx\?t=([QSM])&amp;code={code}&amp;c={nursing_c}&amp;s=(\d+)&amp;q=1)"', h):
        title, href, t, s = m.groups()
        href = href.replace("&amp;", "&")
        subj = clean_subject(title)
        files.setdefault(s, {"name": subj, "types": {}})
        files[s]["types"][t] = href
        if len(subj) > len(files[s]["name"]):
            files[s]["name"] = subj
    subs = [(s, files[s]) for s in sorted(files)]
    return exam_name, nursing_c, subs

def main():
    total_files = 0
    report = []
    for code in CODES:
        try:
            h = fetch(code)
        except Exception as e:
            print(f"{code}: FETCH ERROR {e}"); continue
        exam_name, c, subs = parse(code, h)
        nq = sum('Q' in x['types'] for _, x in subs)
        ns = sum('S' in x['types'] for _, x in subs)
        nm = sum('M' in x['types'] for _, x in subs)
        cnt = sum(len(x['types']) for _, x in subs)
        total_files += cnt
        minguo = code[:3]; sess = session_of(exam_name)
        print(f"{code} c={c} {minguo}年{sess} 科目={len(subs)} Q={nq} S={ns} M={nm}  {exam_name[:36]}")
        report.append({"code": code, "c": c, "minguo": minguo, "session": sess,
                       "exam_name": exam_name,
                       "subjects": [{"s": s, "name": x["name"], "types": x["types"]} for s, x in subs]})
    print(f"\nTOTAL FILES TO DOWNLOAD: {total_files}")
    json.dump(report, open(os.path.join(os.path.dirname(__file__), "manifest.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    print("manifest.json written")

if __name__ == "__main__":
    main()
