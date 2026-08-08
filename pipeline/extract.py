#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""考選部 PDF -> structured questions.

Handles two question layouts:
  * labeled    : options prefixed by A. B. C. D.  (呼吸治療師 all years; 護理師 113/114 第一次)
  * positional : options laid out in columns without letters (護理師 most years)

Answer keys parsed from the 標準答案 PDF (and 更正答案 PDF for corrections).
Cross-validates parsed question count against the official 題數.
"""
import fitz, re, unicodedata, subprocess, os

# Private-use-area glyphs (option bullets ⒜⒝… rendered as custom font glyphs) and
# zero-width / bidi marks. These carry no text but, if kept, form phantom empty
# cells that corrupt positional column clustering. Strip them at line level.
_PUA = re.compile('[-\U000f0000-\U000ffffd\U00100000-\U0010fffd'
                  '​-‏‪-‮⁠﻿]')

def pdftotext_layout(path):
    try:
        out = subprocess.run(["pdftotext", "-enc", "UTF-8", "-layout", path, "-"],
                             capture_output=True, timeout=60)
        return out.stdout.decode("utf-8", "replace")
    except Exception:
        return ""

def pdftotext_raw(path):
    try:
        out = subprocess.run(["pdftotext", "-enc", "UTF-8", path, "-"],
                             capture_output=True, timeout=60)
        return out.stdout.decode("utf-8", "replace")
    except Exception:
        return ""

HEADER_PAT = re.compile(
    r'^(代號|頁次|類科名稱|科目名稱|考試名稱|考試時間|座號|全國性|准考證|等\s*別|類\s*科|科\s*目|'
    r'本試題|本科目共|禁止使用|請選出|注意事項|測驗式|標準答案|備\s*註)'
    r'|禁止使用電子計算器|不予計分|複選作答|單一選擇題|盲用|螢幕報讀'
    r'|^\s*※|^\s*\d+年.*考試\s*$|^頁次[：:]')

def _drop_headers(lines):
    return [l for l in lines if l.strip() and not HEADER_PAT.search(l.strip())]

# ---------- text normalisation ----------
def norm(s):
    if not s:
        return s
    s = unicodedata.normalize("NFKC", s)
    return s.replace("　", " ").strip()

def norm_letter(ch):
    ch = unicodedata.normalize("NFKC", ch).upper()
    return ch if ch in "ABCDE" else None

# ---------- answer key ----------
def parse_answer_pdf(path):
    """Return dict{qno:int -> answer:str}, declared count, is_correction.
    Uses pdftotext -layout which keeps 題號/答案 grid aligned."""
    text = pdftotext_layout(path)
    text = unicodedata.normalize("NFKC", text)
    declared = None
    for pat in (r'單選題數[：:\s]*([0-9]+)', r'題\s*數[：:\s]*([0-9]+)'):
        m = re.search(pat, text)
        if m:
            declared = int(m.group(1)); break
    is_corr = "更正" in text

    lines = [l for l in text.splitlines() if l.strip()]
    answers = {}
    notes = {}
    pending_nums = None
    for l in lines:
        s = l.strip()
        if s.startswith("題號"):
            pending_nums = [int(x) for x in re.findall(r'第?\s*([0-9]+)\s*題?', s)]
        elif s.startswith("答案") and pending_nums is not None:
            toks = re.findall(r'[A-E#]', s)
            for idx, n in enumerate(pending_nums):
                if idx < len(toks):
                    answers[n] = toks[idx]
            pending_nums = None
    # correction notes: e.g. "第 36 題，一律給分". Capture only up to the NEXT
    # 第N題 / newline / sentence end, then keep ONLY captures that read like a real
    # erratum. This rejects the 題號 grid header row (第1題 第2題 …) and stray
    # answer-letter columns that pdftotext -layout aligns near a 第N題 token.
    ERRATA_KW = re.compile(r'給分|送分|更正|一律|均給|皆給|均可|皆可|重複|錯誤|刪除|疑義|不計分|加分|均正確')
    for m in re.finditer(r'第\s*([0-9]+)\s*題[，,、：:\s]*(.*?)(?=第\s*[0-9]+\s*題|[\n。；]|$)', text):
        note = m.group(2).strip().rstrip('，,、：: ')
        if note and ERRATA_KW.search(note):
            notes[int(m.group(1))] = note
    return answers, declared, is_corr, notes


# ---------- format detection ----------
def detect_format(doc):
    labeled = 0
    for page in doc:
        for l in _lines(page):
            if re.match(r'^[ABCD][.\．、]', l["t"]):
                labeled += 1
    return "labeled" if labeled >= 8 else "positional"


def _lines(page):
    """Return list of {y,x0,x1,t} text lines sorted by (y,x0)."""
    d = page.get_text("dict")
    out = []
    for b in d["blocks"]:
        for l in b.get("lines", []):
            t = "".join(s["text"] for s in l["spans"])
            t = _PUA.sub("", t).replace("　", " ").strip()
            if not t:
                continue
            x0, y0, x1, y1 = l["bbox"]
            out.append({"y": round(y0, 1), "x0": round(x0, 1), "x1": round(x1, 1), "t": t})
    out.sort(key=lambda r: (r["y"], r["x0"]))
    return out


HEADER_STOP = re.compile(r'計算器|不予計分|請選出|單一選擇|注意|複選')

def _content_lines(doc):
    """All body lines across pages, skipping per-page headers."""
    rows = []
    for page in doc:
        ls = _lines(page)
        # find where body starts: after last header marker on the page
        start = 0
        for i, l in enumerate(ls):
            if HEADER_STOP.search(l["t"]) or re.match(r'^(代號|頁次|類科名稱|科目名稱|考試時間|座號|別[：:]|等$|類$|科$|目[：:])', l["t"]):
                start = i + 1
        rows.extend(ls[start:])
    return rows


# ---------- labeled parser ----------
_OPT = r'(?<![A-Za-z0-9（(])([ABCDE])[.\．、]'
_QRE = re.compile(
    r'(\d+)[.\．]\s*(.*?)'                              # number + stem
    r'(?<![A-Za-z0-9（(])A[.\．、]\s*(.*?)'
    r'(?<![A-Za-z0-9（(])B[.\．、]\s*(.*?)'
    r'(?<![A-Za-z0-9（(])C[.\．、]\s*(.*?)'
    r'(?<![A-Za-z0-9（(])D[.\．、]\s*(.*?)'             # 4 options
    r'(?=(?:\s*\d+[.\．]\s*.*?(?<![A-Za-z0-9（(])A[.\．、])|$)',
    re.S)

def _parse_seg(no, seg):
    seg = seg.strip()
    mo = re.search(r'(?<![A-Za-z0-9（(])A[.\．、]', seg)
    stem = seg[:mo.start()].strip() if mo else seg
    opts = {}
    if mo:
        opart = seg[mo.start():]
        for mm in re.finditer(
                r'(?<![A-Za-z0-9（(])([ABCDE])[.\．、]\s*(.*?)(?=(?<![A-Za-z0-9（(])[ABCDE][.\．、]|$)', opart):
            opts[mm.group(1)] = mm.group(2).strip()
    return {"no": no, "stem": stem, "options": opts}


def parse_labeled(pdf_path):
    raw = pdftotext_raw(pdf_path)
    lines = _drop_headers(raw.splitlines())
    text = re.sub(r'\s+', ' ', " ".join(lines)).strip()
    found = {}
    for m in _QRE.finditer(text):
        no = int(m.group(1))
        if no in found:
            continue
        found[no] = {"no": no, "stem": m.group(2).strip(),
                     "options": {"A": m.group(3).strip(), "B": m.group(4).strip(),
                                 "C": m.group(5).strip(), "D": m.group(6).strip()},
                     "_start": m.start(), "_end": m.end()}
    # recover skipped question numbers as uncertain text
    maxn = max(found) if found else 0
    for n in range(1, maxn + 1):
        if n in found:
            continue
        lo = found[n - 1].get("_end", 0) if (n - 1) in found else 0
        hi = found[n + 1].get("_start", len(text)) if (n + 1) in found else len(text)
        mm = re.search(rf'(?<!\d){n}[.\．]', text[lo:hi])
        if mm:
            seg = text[lo + mm.end(): hi]
            q = _parse_seg(n, seg)
            q["_uncertain"] = True
            q["_start"] = lo + mm.start()
            q["_end"] = hi
            found[n] = q
    return [found[k] for k in sorted(found)]


def _parse_seg(no, seg):
    seg = seg.strip()
    mo = re.search(r'(?<![A-Za-z])A[.\．、]', seg)
    stem = seg[:mo.start()].strip() if mo else seg
    opts = {}
    if mo:
        opart = seg[mo.start():]
        for mm in re.finditer(
                r'(?<![A-Za-z])([ABCDE])[.\．、]\s*(.*?)(?=(?<![A-Za-z])[ABCDE][.\．、]|$)', opart):
            opts[mm.group(1)] = mm.group(2).strip()
    return {"no": no, "stem": stem, "options": opts}


# ---------- positional parser ----------
def parse_positional(doc):
    # collect body lines per page with coords, tag page for image lookups
    all_rows = []
    for pno, page in enumerate(doc):
        for l in _lines(page):
            if HEADER_PAT.search(l["t"]):
                continue
            l["p"] = pno
            all_rows.append(l)

    # find question-number markers: short numeric token near left margin
    left_x = min((r["x0"] for r in all_rows), default=40)
    markers = []
    for i, r in enumerate(all_rows):
        m = re.match(r'^(\d+)$', r["t"])
        if m and r["x0"] <= left_x + 8:
            markers.append((int(m.group(1)), i))
    # keep sequential 1,2,3,...
    seq = []
    expect = 1
    for n, i in markers:
        if n == expect:
            seq.append((n, i)); expect += 1
    # detect option columns via global x0 histogram of non-marker lines
    xs = [r["x0"] for r in all_rows]
    cols = _cluster_columns(xs)

    questions = []
    for k, (n, i) in enumerate(seq):
        end = seq[k + 1][1] if k + 1 < len(seq) else len(all_rows)
        block = all_rows[i:end]
        q = _parse_block(n, block, cols)
        questions.append(q)
    return questions


def _cluster_columns(xs, tol=12):
    xs = sorted(xs)
    clusters = []
    for x in xs:
        if clusters and x - clusters[-1][-1] <= tol:
            clusters[-1].append(x)
        else:
            clusters.append([x])
    # centers with enough support
    centers = sorted([round(sum(c) / len(c), 1) for c in clusters if len(c) >= 3])
    return centers


def _parse_block(n, block, cols):
    num_line = block[0]
    y0 = num_line["y"]
    rest = block[1:]
    rows_by_y = {}
    for l in rest:
        rows_by_y.setdefault(l["y"], []).append(l)
    ys = sorted(rows_by_y)
    # stem first line = same-y-as-number cells to the right of the number
    same_y = [l for l in rest if abs(l["y"] - y0) < 4 and l["x0"] > num_line["x0"]]
    stem = " ".join(l["t"] for l in sorted(same_y, key=lambda z: z["x0"])) if same_y else ""
    # rows strictly below the number's row
    below = [y for y in ys if y > y0 + 4]
    # Anchor: first below-row containing a right-column cell (x0>150) => multi-column options
    anchor = None
    for y in below:
        if any(c["x0"] > 150 for c in rows_by_y[y]):
            anchor = y
            break
    if anchor is not None:
        # 2-column option grids often have ~1-2pt baseline jitter between the
        # left cell (A/C) and its paired right cell (B/D). Pull left-column cells
        # sitting on the same visual row as the anchor into the option region so
        # option A isn't misfiled as stem. 6pt < one row (~15pt) keeps stem safe.
        opt_start = anchor - 6
        opt_ys = [y for y in below if y >= opt_start]
        stem_ys = [y for y in below if y < opt_start]
    else:
        # single-column layout: options are the last 4 below-rows (one cell each)
        stem_ys = below[:-4]
        opt_ys = below[-4:]
    for y in stem_ys:
        stem = (stem + " " + " ".join(c["t"] for c in sorted(rows_by_y[y], key=lambda z: z["x0"]))).strip()
    option_lines = [c for y in opt_ys for c in rows_by_y[y]]
    opts = _cells_to_options(option_lines)
    page = num_line.get("p", 0)
    ys_all = [num_line["y"]] + [l["y"] for l in rest]
    bbox = (min(l["x0"] for l in [num_line] + rest),
            num_line["y"] - 2,
            max(l["x1"] for l in [num_line] + rest),
            max(ys_all) + 16)
    return {"no": n, "stem": stem.strip(), "options": opts, "_page": page, "_bbox": bbox}


def _gap_cluster(vals, gap):
    """Cluster sorted values where consecutive gap>threshold splits. Returns list of
    (center, members-index-set) as centers list; no min-support filter."""
    if not vals:
        return []
    order = sorted(vals)
    groups = [[order[0]]]
    for v in order[1:]:
        if v - groups[-1][-1] > gap:
            groups.append([v])
        else:
            groups[-1].append(v)
    return [sum(g) / len(g) for g in groups]


def _cells_to_options(cells):
    if not cells:
        return {}
    colc = _gap_cluster([c["x0"] for c in cells], gap=30)
    ybands = _gap_cluster([c["y"] for c in cells], gap=6)
    def nearest(centers, v):
        return min(range(len(centers)), key=lambda i: abs(centers[i] - v))
    grid = {}
    for c in cells:
        key = (nearest(ybands, c["y"]), nearest(colc, c["x0"]))
        grid.setdefault(key, []).append(c)
    ordered = []
    for key in sorted(grid):
        txt = " ".join(cc["t"] for cc in sorted(grid[key], key=lambda z: (z["y"], z["x0"])))
        ordered.append(txt)
    letters = "ABCDE"
    return {letters[i]: ordered[i] for i in range(min(len(ordered), 5))}


# ---------- image detection ----------
def question_has_image(doc, qno, questions):
    """Rough: any raster image or vector drawing on pages — flag per doc for now."""
    for page in doc:
        if page.get_images():
            return True
    return False


# ---------- top-level ----------
def _page_figure_rects(page):
    """Return list of fitz.Rect for real embedded figures (skip tiny/full-page)."""
    rects = []
    W, H = page.rect.width, page.rect.height
    try:
        for img in page.get_images(full=True):
            for r in page.get_image_rects(img[0]):
                if r.width < 40 or r.height < 25:
                    continue
                if r.width > 0.92 * W and r.height > 0.92 * H:
                    continue  # full-page background
                rects.append(r)
    except Exception:
        pass
    return rects


def extract_questions(q_path):
    doc = fitz.open(q_path)
    fmt = detect_format(doc)
    if fmt == "labeled":
        qs = parse_labeled(q_path)
    else:
        qs = parse_positional(doc)
        # per-question figure detection via bbox overlap
        fig_by_page = {i: _page_figure_rects(p) for i, p in enumerate(doc)}
        for q in qs:
            bb = q.get("_bbox"); pg = q.get("_page", 0)
            q["_img"] = False
            if bb is None:
                continue
            qr = fitz.Rect(*bb)
            for r in fig_by_page.get(pg, []):
                if qr.intersects(r):
                    q["_img"] = True
                    q["_bbox"] = (min(bb[0], r.x0), min(bb[1], r.y0),
                                  max(bb[2], r.x1), max(bb[3], r.y1))
                    break
    has_img = bool(any(_page_figure_rects(p) for p in doc))
    doc.close()
    return qs, fmt, has_img


def render_crop(pdf_path, page_no, bbox, out_path, zoom=2.0, pad=6):
    """Render a page-region crop to WebP. bbox=(x0,y0,x1,y1) in PDF points."""
    doc = fitz.open(pdf_path)
    page = doc[page_no]
    x0, y0, x1, y1 = bbox
    # widen to full text width for readability
    clip = fitz.Rect(max(0, x0 - pad), max(0, y0 - pad),
                     min(page.rect.width, x1 + pad), min(page.rect.height, y1 + pad))
    pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), clip=clip)
    pix.save(out_path)   # .png
    doc.close()
    return out_path


def render_pages(pdf_path, out_dir, prefix, zoom=1.6):
    """Render every page to PNG. Returns list of filenames."""
    import os as _os
    doc = fitz.open(pdf_path)
    _os.makedirs(out_dir, exist_ok=True)
    names = []
    for i, page in enumerate(doc):
        fn = f"{prefix}-p{i + 1}.png"
        page.get_pixmap(matrix=fitz.Matrix(zoom, zoom)).save(_os.path.join(out_dir, fn))
        names.append(fn)
    doc.close()
    return names


def parse_time_limit(pdf_path):
    txt = pdftotext_layout(pdf_path)
    m = re.search(r'考試時間[：:\s]*([0-9]+)\s*小時', txt)
    if m:
        return int(m.group(1)) * 60
    m = re.search(r'考試時間[：:\s]*([0-9]+)\s*分', txt)
    if m:
        return int(m.group(1))
    return 60


if __name__ == "__main__":
    import sys, json
    qp = sys.argv[1]
    ap = sys.argv[2] if len(sys.argv) > 2 else None
    qs, fmt, img = extract_questions(qp)
    print(f"format={fmt} parsed_questions={len(qs)} has_image={img}")
    ans = decl = None
    if ap:
        ans, decl, corr, notes = parse_answer_pdf(ap)
        print(f"answers={len(ans)} declared={decl} correction={corr}")
    bad = [q["no"] for q in qs if len(q["options"]) != 4]
    print(f"questions_with_wrong_option_count={len(bad)} -> {bad[:15]}")
    for q in qs[:3]:
        print(f"--- Q{q['no']}: {q['stem'][:60]}")
        for L, v in q["options"].items():
            a = f" [answer]" if ans and ans.get(q['no']) == L else ""
            print(f"    {L}. {v[:50]}{a}")
