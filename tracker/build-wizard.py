#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build-wizard.py — składa dist/tracker-wizard.html z plików źródłowych.

Assety trackera (szkielet, CSS, trzy biblioteki, runtime, motywy) trafiają do
pliku kreatora jako base64 w <script type="text/plain">. Base64, a nie surowy
tekst, bo literalne "</script" albo "-->" w kodzie potrafi zamknąć wyspę;
w base64 to niemożliwe. Koszt +33% dotyczy tylko pliku kreatora, który nie ma
budżetu rozmiaru — emitowany tracker dostaje assety zdekodowane.

Komentarze i wcięcia są wycinane strippperem świadomym stringów (tools/strip.py).
Identyfikatory NIE są skracane — czytelność przy debugowaniu jest warta więcej
niż te bajty.

Uruchomienie:  python3 tracker/build-wizard.py
Wymaga wcześniejszego: python3 tracker/build-themes.py
"""

import base64
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DIST = ROOT.parent / "dist"
sys.path.insert(0, str(ROOT / "tools"))
from strip import strip_js, strip_css           # noqa: E402

# Motyw, w którym chodzi sam interfejs kreatora.
WIZARD_THEME = "crisp-fintech"

BANNER = (
    "<!--\n"
    "  PLIK WYGENEROWANY przez tracker/build-wizard.py — NIE EDYTUJ RĘCZNIE.\n"
    "  Każda zmiana zniknie przy następnym buildzie. Źródła: tracker/*.\n"
    "-->\n"
)


def read(path):
    return (ROOT / path).read_text(encoding="utf-8")


def b64(text):
    return base64.b64encode(text.encode("utf-8")).decode("ascii")


def island(name, text):
    return ('<script type="text/plain" data-asset="%s" data-enc="b64">%s</script>'
            % (name, b64(text)))


def main():
    themes_dir = ROOT / "themes"
    reg_path = themes_dir / "themes.json"
    if not reg_path.is_file():
        sys.exit("BŁĄD: brak themes/themes.json — uruchom najpierw build-themes.py")

    registry = json.loads(reg_path.read_text(encoding="utf-8"))
    themes = registry.get("themes", [])
    if not themes:
        sys.exit("BŁĄD: rejestr motywów jest pusty")

    # ---- assety trackera (to, co trafia do emitowanego pliku) ----
    assets = {
        "shell": read("tracker-shell.html"),
        "trackercss": strip_css(read("tracker.css")),
        "charts": strip_js(read("tb-charts.js")),
        "ui": strip_js(read("tb-ui.js")),
        "xlsx": strip_js(read("tb-xlsx.js")),
        "runtime": strip_js(read("tb-runtime.js")),
        "themes.json": reg_path.read_text(encoding="utf-8"),
    }
    theme_css = {}
    for t in themes:
        css = strip_css((themes_dir / t["file"]).read_text(encoding="utf-8"))
        theme_css[t["id"]] = css
        assets["theme:" + t["id"]] = css

    # Asset nie może zawierać niczego, co w przeglądarce odpali sieć.
    for name, text in assets.items():
        if '@import url("http' in text or "@import url('http" in text:
            sys.exit("BŁĄD: asset %s wciąż importuje zasób z sieci" % name)

    if WIZARD_THEME not in theme_css:
        sys.exit("BŁĄD: motyw kreatora %s nie istnieje" % WIZARD_THEME)

    # ---- strona kreatora ----
    out = read("wizard-src.html")

    def put(marker, value):
        """Podmiana literalna. W Pythonie str.replace nie przetwarza żadnych
        sekwencji w zamienniku, więc asset zawierający $& albo \\1 jest
        bezpieczny. (W JS to nieprawda — tam emitter musi używać formy
        funkcyjnej .replace(marker, function () { return value; }).)"""
        nonlocal out
        if marker not in out:
            sys.exit("BŁĄD: brak markera %s w wizard-src.html" % marker)
        out = out.replace(marker, value, 1)

    put("<!--WZ:THEMECSS-->", theme_css[WIZARD_THEME])
    put("<!--WZ:EXTRACSS-->", assets["trackercss"])
    put("<!--WZ:WIZARDCSS-->", strip_css(read("wizard.css")))
    put("<!--WZ:CHARTS-->", assets["charts"])
    put("<!--WZ:UI-->", assets["ui"])
    put("<!--WZ:WIZARDJS-->", strip_js(read("wizard.js")))
    put("<!--WZ:ASSETS-->", "\n".join(island(k, v) for k, v in sorted(assets.items())))

    out = out.replace("<!doctype html>", "<!doctype html>\n" + BANNER, 1)

    # ---- asercje ----
    # Treść <script> trzeba wyciąć PRZED sprawdzaniem tagów: emitter w JS
    # zawiera literał '<link rel="stylesheet"...', który nie jest tagiem
    # tej strony. Bez tego asercja fałszywie alarmuje.
    markup = re.sub(r"<script\b[^>]*>.*?</script>", "<script></script>", out, flags=re.S)

    problems = []
    if re.search(r"<link\s[^>]*rel=[\"']stylesheet", markup):
        problems.append("został <link rel=stylesheet> — plik nie jest samodzielny")
    if re.search(r"<script\s[^>]*\ssrc=", markup):
        problems.append("został <script src=> — plik nie jest samodzielny")
    if "<!--WZ:" in out:
        problems.append("nie wszystkie markery WZ: zostały podmienione")
    if '@import url("http' in markup:
        problems.append("został @import z sieci w CSS strony")
    # szkielet trackera MUSI zachować swoje markery — podmienia je emitter w JS
    shell_markers = re.findall(r"<!--TB:[A-Z]+-->", assets["shell"])
    if len(shell_markers) < 10:
        problems.append("szkielet trackera ma tylko %d markerów TB: (oczekiwane 10)"
                        % len(shell_markers))
    for need in ("shell", "runtime", "charts", "ui", "xlsx", "trackercss"):
        if ('data-asset="%s"' % need) not in out:
            problems.append("brak wyspy assetu %s" % need)

    if problems:
        print("BUILD PRZERWANY:")
        for p in problems:
            print("  - " + p)
        sys.exit(1)

    DIST.mkdir(parents=True, exist_ok=True)
    target = DIST / "tracker-wizard.html"
    target.write_text(out, encoding="utf-8")

    # ---- raport ----
    print("Assety trackera (po wycięciu komentarzy):")
    for k in ("shell", "trackercss", "charts", "ui", "xlsx", "runtime"):
        print("  %-12s %7.1f KB" % (k, len(assets[k].encode()) / 1024))
    print("  %-12s %7.1f KB  (%d motywów)"
          % ("motywy", sum(len(v.encode()) for v in theme_css.values()) / 1024, len(theme_css)))

    one = min(len(v.encode()) for v in theme_css.values())
    core = sum(len(assets[k].encode()) for k in
               ("shell", "trackercss", "charts", "ui", "xlsx", "runtime"))
    print("\nSzacowany rozmiar emitowanego trackera:")
    print("  jeden motyw          %6.1f KB" % ((core + one) / 1024))
    print("  z przełącznikiem     %6.1f KB"
          % ((core + sum(len(v.encode()) for v in theme_css.values())) / 1024))
    print("\nOK: %s  (%.1f KB)" % (target, len(out.encode()) / 1024))
    print("Markery szkieletu zachowane: %s" % " ".join(sorted(set(shell_markers))))


if __name__ == "__main__":
    main()
