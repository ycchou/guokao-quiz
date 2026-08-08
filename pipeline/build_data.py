#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Build structured question dataset (JSON + crop images) from downloaded exam PDFs.

Output tree (OUT):
  index.json                      -- master catalog for site selectors
  questions/<prof>/<code>-<n>.json
  q-img/<prof>/<code>-<n>-q<no>.webp   -- crops for unparseable / image questions
"""
import os, re, csv, json, sys, unicodedata
import extract as ex

HERE = os.path.dirname(__file__)
OUT = r"D:\Antigravity\test\exam-data"
SRC_ROOTS = {
    "護理師": r"D:\Antigravity\test\護理師高考歷屆試題",
    "呼吸治療師": r"D:\Antigravity\test\呼吸治療師高考歷屆試題",
}
# ASCII slugs for on-disk/URL folders (avoid non-ASCII paths on static hosts)
PROF_SLUG = {"護理師": "nurse", "呼吸治療師": "rt"}
DL_TSVS = ["dl_list.tsv", "dl_list_呼吸治療師高考歷屆試題.tsv"]

# official exam names
OFFICIAL = {}
for line in open(os.path.join(HERE, "allexams.txt"), encoding="utf-8"):
    if "\t" in line:
        c, n = line.rstrip("\n").split("\t", 1)
        OFFICIAL[c] = n

# path -> source moex url
PATH2URL = {}
for tsv in DL_TSVS:
    p = os.path.join(HERE, tsv)
    if not os.path.exists(p):
        continue
    for line in open(p, encoding="utf-8"):
        line = line.rstrip("\n").rstrip("\r")
        if "\t" not in line:
            continue
        url, path = line.split("\t", 1)
        PATH2URL[os.path.normpath(path)] = url

_PUA = re.compile('[-󰀀-󿿽􀀀-􏿽​-‏‪-‮⁠﻿]')
def sanitize(s):
    """Remove private-use-area glyph markers (option bullets etc.) and zero-width chars."""
    if not s:
        return s
    s = _PUA.sub('', s)
    # strip leftover leading bullet punctuation
    s = re.sub(r'^[\s.．、）)]+', '', s)
    return s.strip()

def short_subject(name):
    n = re.sub(r'[（(][^）)]*[）)]', '', name)
    return n.replace("　", "").strip() or name

def src_url(prof, rel):
    ap = os.path.normpath(os.path.join(SRC_ROOTS[prof], rel))
    return PATH2URL.get(ap)

def load_catalog():
    """Return dict[(prof,code,subno)] -> {meta, Q,S,M paths}."""
    cat = {}
    for prof, root in SRC_ROOTS.items():
        idx = os.path.join(root, "索引.csv")
        for r in csv.DictReader(open(idx, encoding="utf-8-sig")):
            key = (prof, r["考試代碼"], int(r["科目序"]))
            e = cat.setdefault(key, {"prof": prof, "minguo": int(r["民國年"]),
                                     "session": r["場次"], "code": r["考試代碼"],
                                     "subNo": int(r["科目序"]), "subject": r["科目"],
                                     "files": {}})
            typ = {"試題": "Q", "答案": "S", "更正答案": "M"}[r["類型"]]
            e["files"][typ] = os.path.join(root, r["檔案"])
            e["rel"] = {**e.get("rel", {}), typ: r["檔案"]}
    return cat

def process(entry):
    prof = entry["prof"]; code = entry["code"]; slug = PROF_SLUG[prof]
    qpdf = entry["files"].get("Q")
    spdf = entry["files"].get("S")
    mpdf = entry["files"].get("M")
    result = {
        "id": f"{prof}-{code}-{entry['subNo']}",
        "profession": prof, "minguo": entry["minguo"], "year": entry["minguo"] + 1911,
        "session": entry["session"], "examCode": code,
        "examName": OFFICIAL.get(code, ""),
        "subjectNo": entry["subNo"], "subject": entry["subject"],
        "subjectShort": short_subject(entry["subject"]),
        "source": {"question": src_url(prof, entry["rel"].get("Q", "")),
                   "answer": src_url(prof, entry["rel"].get("S", "")) if spdf else None,
                   "errata": src_url(prof, entry["rel"].get("M", "")) if mpdf else None},
        "questions": [], "flags": [],
        "stats": {"total": 0, "text": 0, "image": 0, "uncertain": 0, "answered": 0, "corrected": 0},
        "isEssay": False,
    }
    if not qpdf or not os.path.exists(qpdf):
        result["flags"].append("no_question_pdf"); return result, []
    # scanned (image-only) PDF: no extractable text
    if len(ex.pdftotext_raw(qpdf).strip()) < 40:
        result["scanned"] = True
        result["flags"].append("scanned")
        answers, declared, _, notes = ({}, None, False, {})
        if spdf and os.path.exists(spdf):
            answers, declared, _, notes = ex.parse_answer_pdf(spdf)
        pdir = os.path.join(OUT, "q-img", slug)
        pages = ex.render_pages(qpdf, pdir, f"{code}-{entry['subNo']}")
        result["pageImages"] = [f"q-img/{slug}/{n}" for n in pages]
        result["timeLimitMin"] = ex.parse_time_limit(qpdf) if False else 60
        for no in sorted(answers):
            result["questions"].append({"no": no, "answer": answers[no], "mode": "scanned",
                                        "corrected": False, "note": notes.get(no)})
        result["declared"] = declared
        result["stats"] = {"total": len(result["questions"]), "text": 0, "image": 0,
                           "uncertain": 0, "answered": len(answers), "corrected": 0, "scanned": len(pages)}
        return result, []
    try:
        qs, fmt, has_img = ex.extract_questions(qpdf)
    except Exception as e:
        result["flags"].append(f"extract_error:{e}"); return result, []
    result["format"] = fmt
    result["timeLimitMin"] = ex.parse_time_limit(qpdf)

    answers = {}; declared = None; notes = {}
    if spdf and os.path.exists(spdf):
        answers, declared, _, notes = ex.parse_answer_pdf(spdf)
    # corrections from errata: override with clean letters, mark # as 送分
    corr_qnos = set()
    if mpdf and os.path.exists(mpdf):
        m_ans, m_decl, _, m_notes = ex.parse_answer_pdf(mpdf)
        for no, a in m_ans.items():
            if a == "#":
                corr_qnos.add(no); notes[no] = m_notes.get(no, "本題經更正（詳見更正答案）")
            elif a in "ABCDE":
                if answers.get(no) != a:
                    corr_qnos.add(no)
                answers[no] = a
    result["declared"] = declared
    result["isEssay"] = (spdf is None)

    # drop phantom questions (no<1 or beyond the declared count)
    hi = declared if declared else 999
    qs = [q for q in qs if 1 <= q["no"] <= hi]
    crops = []  # (qno, pdf, page, bbox)
    for q in qs:
        no = q["no"]
        opts = q.get("options", {})
        ans = answers.get(no)
        clean = (len(opts) == 4 and all(opts.get(k, "").strip() for k in "ABCD") and not q.get("_uncertain"))
        needs_img = q.get("_img", False)
        item = {"no": no, "answer": ans, "corrected": no in corr_qnos,
                "note": notes.get(no)}
        if clean and not needs_img:
            item["mode"] = "text"; item["stem"] = q["stem"]; item["options"] = {k: opts[k] for k in opts}
        elif q.get("_bbox") is not None:
            # image mode: render crop; keep any parsed text/options as supplement
            item["mode"] = "image"
            item["stem"] = q.get("stem", "")
            if clean:
                item["options"] = {k: opts[k] for k in opts}
            crops.append((no, qpdf, q["_page"], q["_bbox"]))
        else:
            # labeled bad question with no bbox: keep imperfect text + flag
            item["mode"] = "text_uncertain"; item["stem"] = q.get("stem", ""); item["options"] = {k: opts[k] for k in opts}
        result["questions"].append(item)

    # sanitize all user-visible text (remove PUA option-bullet glyphs, zero-width)
    for it in result["questions"]:
        if it.get("stem"):
            it["stem"] = sanitize(it["stem"])
        if it.get("options"):
            it["options"] = {k: sanitize(v) for k, v in it["options"].items()}
        if it.get("note"):
            it["note"] = sanitize(it["note"])

    # validation flags
    n_ans = sum(1 for q in result["questions"] if q["answer"])
    if declared and len(qs) != declared:
        result["flags"].append(f"count_mismatch:{len(qs)}!={declared}")
    if spdf and n_ans < len(qs):
        result["flags"].append(f"missing_answers:{len(qs)-n_ans}")
    result["stats"] = {
        "total": len(result["questions"]),
        "text": sum(q["mode"] == "text" for q in result["questions"]),
        "image": sum(q["mode"] == "image" for q in result["questions"]),
        "uncertain": sum(q["mode"] == "text_uncertain" for q in result["questions"]),
        "answered": n_ans, "corrected": len(corr_qnos),
    }
    return result, crops

def main(limit=None):
    cat = load_catalog()
    keys = sorted(cat, key=lambda k: (k[0], k[1], k[2]))
    if limit:
        keys = keys[:limit]
    os.makedirs(OUT, exist_ok=True)
    index = {"professions": {}, "generatedAt": __import__("datetime").date.today().isoformat()}
    tot_img = 0
    summary = []
    for key in keys:
        entry = cat[key]
        res, crops = process(entry)
        prof = res["profession"]; slug = PROF_SLUG[prof]
        # write crops
        img_dir = os.path.join(OUT, "q-img", slug)
        if crops:
            os.makedirs(img_dir, exist_ok=True)
        for (no, pdf, page, bbox) in crops:
            fn = f"{res['examCode']}-{res['subjectNo']}-q{no}.png"
            try:
                ex.render_crop(pdf, page, bbox, os.path.join(img_dir, fn))
                for q in res["questions"]:
                    if q["no"] == no:
                        q["img"] = f"q-img/{slug}/{fn}"
                tot_img += 1
            except Exception as e:
                res["flags"].append(f"crop_error_q{no}:{e}")
        # write subject json
        jdir = os.path.join(OUT, "questions", slug)
        os.makedirs(jdir, exist_ok=True)
        jpath = os.path.join(jdir, f"{res['examCode']}-{res['subjectNo']}.json")
        json.dump(res, open(jpath, "w", encoding="utf-8"), ensure_ascii=False)
        # index
        P = index["professions"].setdefault(prof, {"exams": {}})
        E = P["exams"].setdefault(res["examCode"], {
            "minguo": res["minguo"], "year": res["year"], "session": res["session"],
            "examName": res["examName"], "subjects": []})
        E["subjects"].append({"no": res["subjectNo"], "subject": res["subject"],
                              "short": res["subjectShort"], "file": f"{res['examCode']}-{res['subjectNo']}.json",
                              "count": res["stats"]["total"], "answered": res["stats"]["answered"],
                              "img": res["stats"]["image"], "isEssay": res.get("isEssay", False)})
        summary.append((res["id"], res["stats"], res["flags"]))
    json.dump(index, open(os.path.join(OUT, "index.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    # report
    print(f"subjects={len(keys)} crops={tot_img}")
    flagged = [(i, f) for (i, s, f) in summary if f]
    print(f"flagged_subjects={len(flagged)}")
    for i, f in flagged[:40]:
        print("  ", i, f)

if __name__ == "__main__":
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else None
    main(limit)
