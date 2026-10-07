#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build-manual.py — składa instrukcję obsługi dist/tracker-manual.html.

Źródła:
  tracker/manual/src/*.html   rozdziały (00-top i 99-bottom to szkielet strony)
  tracker/manual/manual.css   styl
  tracker/manual/img/*.png    zrzuty z tools/manual-shots.mjs

Każdy rozdział to <section id data-level data-pl data-en> z dokładnie jednym
blokiem <div class="l-pl" lang="pl"> i jednym <div class="l-en" lang="en">.
Nagłówki, numerację i spis treści dokłada build — w źródle ich nie ma.

Build PRZERYWA się, gdy:
  - etykieta <span class="ui">…</span> nie występuje dosłownie w kodzie
    kreatora ani trackera (instrukcja rozjechała się z produktem),
  - wersje PL i EN sekcji mają różne zrzuty, podnagłówki, tabele lub kroki,
  - treść odwołuje się do zrzutu, którego nie ma.

Zrzuty idą jako WebP w jednej wyspie JSON — obie wersje językowe korzystają
z tego samego obrazu, więc plik nie rośnie dwukrotnie.

Uruchomienie:  python3 tracker/build-manual.py
"""

import base64
import html
import io
import json
import re
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent
MAN = ROOT / "manual"
DIST = ROOT.parent / "dist"
CAPTURE_SCALE = 1.25        # deviceScaleFactor w manual-shots.mjs
MAX_PX = 1400               # szerokość w pikselach po przeskalowaniu
QUALITY = 80

SOURCES = ["wizard.js", "wizard-src.html", "tb-runtime.js", "tb-ui.js", "tb-xlsx.js",
           "themes/themes.json"]

SECTION_RE = re.compile(
    r'<section id="([a-z0-9-]+)" data-level="([12])" data-pl="([^"]+)" data-en="([^"]+)">(.*?)</section>',
    re.S)
UI_RE = re.compile(r'<span class="ui(?: wrap)?">(.*?)</span>', re.S)


def fail(problems):
    print("BUILD INSTRUKCJI PRZERWANY:")
    for p in problems:
        print("  - " + p)
    sys.exit(1)


def encode_shot(path):
    im = Image.open(path).convert("RGB")
    w0, h0 = im.size
    css_w, css_h = round(w0 / CAPTURE_SCALE), round(h0 / CAPTURE_SCALE)
    if w0 > MAX_PX:
        im = im.resize((MAX_PX, round(h0 * MAX_PX / w0)), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "WEBP", quality=QUALITY, method=6)
    data = base64.b64encode(buf.getvalue()).decode("ascii")
    return {"src": "data:image/webp;base64," + data, "w": css_w, "h": css_h}, len(buf.getvalue())


def main():
    src_dir = MAN / "src"
    parts = sorted(src_dir.glob("*.html"))
    top = (src_dir / "00-top.html").read_text(encoding="utf-8")
    bottom = (src_dir / "99-bottom.html").read_text(encoding="utf-8")
    body = "\n".join(p.read_text(encoding="utf-8") for p in parts
                     if p.name not in ("00-top.html", "99-bottom.html"))

    problems = []
    product = "\n".join((ROOT / s).read_text(encoding="utf-8") for s in SOURCES)

    sections = SECTION_RE.findall(body)
    if not sections:
        fail(["nie znaleziono żadnej sekcji"])
    leftover = SECTION_RE.sub("", body).strip()
    if leftover:
        problems.append("tekst poza sekcjami: " + leftover[:80])

    ids = [s[0] for s in sections]
    dup = {i for i in ids if ids.count(i) > 1}
    if dup:
        problems.append("powtórzone id sekcji: " + ", ".join(sorted(dup)))

    used_shots = []
    toc = ["<ol>"]
    out_sections = []
    n1 = n2 = 0
    for sid, level, t_pl, t_en, inner in sections:
        if level == "1":
            n1 += 1
            n2 = 0
            num = str(n1)
        else:
            n2 += 1
            num = "%d.%d" % (n1, n2)
        tag = "h2" if level == "1" else "h3"

        pl_open = inner.count('<div class="l-pl" lang="pl">')
        en_open = inner.count('<div class="l-en" lang="en">')
        if pl_open != 1 or en_open != 1:
            problems.append("sekcja %s: oczekiwany 1 blok PL i 1 EN (jest %d/%d)" % (sid, pl_open, en_open))
            continue
        i_pl = inner.index('<div class="l-pl" lang="pl">')
        i_en = inner.index('<div class="l-en" lang="en">')
        pl, en = (inner[i_pl:i_en], inner[i_en:]) if i_pl < i_en else (inner[i_pl:], inner[i_en:i_pl])

        for what, pat in (("zrzuty", r'data-shot="([^"]+)"'), ("podnagłówki", r"<h4[ >]"),
                          ("tabele", r"<table"), ("kroki", r'<ol class="steps">'),
                          ("ramki", r'class="callout ')):
            a, b = re.findall(pat, pl), re.findall(pat, en)
            if a != b:
                problems.append("sekcja %s: %s różnią się między PL i EN (%s / %s)" % (sid, what, a, b))
        steps_pl = sum(len(re.findall(r"<li", m)) for m in re.findall(r'<ol class="steps">(.*?)</ol>', pl, re.S))
        steps_en = sum(len(re.findall(r"<li", m)) for m in re.findall(r'<ol class="steps">(.*?)</ol>', en, re.S))
        if steps_pl != steps_en:
            problems.append("sekcja %s: różna liczba kroków PL/EN (%d/%d)" % (sid, steps_pl, steps_en))

        used_shots += re.findall(r'data-shot="([^"]+)"', inner)

        for raw in UI_RE.findall(inner):
            label = html.unescape(re.sub(r"<[^>]+>", "", raw)).strip()
            if label and label not in product:
                problems.append("sekcja %s: etykieta „%s” nie występuje w kodzie produktu" % (sid, label))

        def head(lang_title):
            return '<%s><span class="num">%s</span> %s</%s>' % (tag, num, lang_title, tag)
        inner2 = inner.replace('<div class="l-pl" lang="pl">',
                               '<div class="l-pl" lang="pl">' + head(t_pl), 1)
        inner2 = inner2.replace('<div class="l-en" lang="en">',
                                '<div class="l-en" lang="en">' + head(t_en), 1)
        out_sections.append('<section id="%s" data-level="%s">%s</section>' % (sid, level, inner2))
        toc.append('<li class="lvl%s"><a href="#%s"><span class="num">%s</span>'
                   '<span class="l-pl" lang="pl">%s</span><span class="l-en" lang="en">%s</span></a></li>'
                   % (level, sid, num, t_pl, t_en))
    toc.append("</ol>")

    # Odwołania typu <a href="#change">8</a>: cel musi istnieć, a numer w treści
    # linku musi być numerem tego rozdziału — inaczej po dodaniu sekcji tekst
    # „patrz rozdział 8” po cichu wskazywałby zły rozdział.
    numbers = {}
    m1 = m2 = 0
    for sid, level, _pl, _en, _inner in sections:
        if level == "1":
            m1 += 1
            m2 = 0
            numbers[sid] = str(m1)
        else:
            m2 += 1
            numbers[sid] = "%d.%d" % (m1, m2)
    for target, text in re.findall(r'<a href="#([a-z0-9-]+)">([^<]*)</a>', body):
        if target not in numbers:
            problems.append("odwołanie do nieistniejącej sekcji #%s" % target)
        elif re.fullmatch(r"\d+(\.\d+)?", text.strip()) and text.strip() != numbers[target]:
            problems.append("odwołanie „%s” do #%s, a ta sekcja ma numer %s" % (text, target, numbers[target]))

    # zrzuty
    shots, total_img = {}, 0
    for name in sorted(set(used_shots)):
        p = MAN / "img" / (name + ".png")
        if not p.is_file():
            problems.append("brak zrzutu %s.png (uruchom tools/manual-shots.mjs)" % name)
            continue
        shots[name], size = encode_shot(p)
        total_img += size
    unused = sorted(p.stem for p in (MAN / "img").glob("*.png") if p.stem not in set(used_shots))

    if problems:
        fail(problems)

    css = (MAN / "manual.css").read_text(encoding="utf-8")
    shots_json = json.dumps(shots, separators=(",", ":")).replace("<", "\\u003c")
    out = top.replace("<!--M:CSS-->", css, 1).replace("<!--M:TOC-->", "\n".join(toc), 1)
    out += "\n".join(out_sections) + "\n" + bottom.replace("<!--M:SHOTS-->", shots_json, 1)

    if "<!--M:" in out:
        fail(["nie wszystkie markery M: zostały podmienione"])
    markup = re.sub(r"<script\b[^>]*>.*?</script>", "", out, flags=re.S)
    if re.search(r'<link\s|src="https?:', markup):
        fail(["instrukcja ładuje coś z sieci — ma działać offline"])
    if "-->" in re.sub(r"<!--.*?-->", "", markup, flags=re.S):
        fail(["komentarz HTML zamknięty za wcześnie"])

    DIST.mkdir(exist_ok=True)
    target = DIST / "tracker-manual.html"
    target.write_text(out, encoding="utf-8")
    labels = len(UI_RE.findall(body))
    print("Sekcje: %d (rozdziały: %d) · etykiety UI sprawdzone: %d · zrzuty: %d (%.0f KB)"
          % (len(sections), n1, labels, len(shots), total_img / 1024))
    if unused:
        print("Nieużyte zrzuty: " + ", ".join(unused))
    print("OK: %s  (%.0f KB)" % (target, target.stat().st_size / 1024))


if __name__ == "__main__":
    main()
