#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build-themes.py — wyciąga motywy trackera z 5 styleguide'ów w tracker/sources/.

Z każdego pliku bierze:
  1. bloki :root (tokeny) — verbatim,
  2. reguły dla html/body (tło strony, scena) — verbatim,
  3. reguły komponentów, których tracker faktycznie używa (ALLOW poniżej),
  4. @keyframes i przefiltrowane @media,
  5. dopisuje SKIN — ręcznie napisaną skórę shella (tb-frame/tb-side/tb-main/...),
     bo layout shella należy do tracker.css, a z motywu bierzemy tylko malowanie.

Czego NIE robi: nie przepisuje prefiksowanych klas demo (lm-/wl-/gl-/zt-/ad-) na
wspólne nazwy. Te klasy to różne struktury pod różnymi nazwami (tylko Amber Dusk ma
prawdziwy sidebar), więc mechaniczna zamiana prefiksu dałaby bełkot.

Wyjście: tracker/themes/<id>.css + tracker/themes/themes.json
Uruchomienie: python3 tracker/build-themes.py
"""

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "sources"
OUT = ROOT / "themes"

# ---------------------------------------------------------------- motywy

THEMES = [
    {"id": "soft-corporate",    "file": "01-soft-corporate.html",    "name": "Soft Corporate",    "prefix": "lm"},
    {"id": "pastel-iridescent", "file": "02-pastel-iridescent.html", "name": "Pastel Iridescent", "prefix": "wl"},
    {"id": "frosted-mono",      "file": "03-frosted-mono-glass.html","name": "Frosted Mono Glass","prefix": "gl"},
    {"id": "crisp-fintech",     "file": "04-crisp-fintech.html",     "name": "Crisp Fintech",     "prefix": "zt"},
    {"id": "amber-dusk",        "file": "05-amber-dusk.html",        "name": "Amber Dusk",        "prefix": "ad"},
]

# Kontrakt: te tokeny MUSZĄ być w :root każdego motywu, bo tracker.css na nich stoi.
CONTRACT = [
    "--page-bg", "--surface", "--surface-2", "--text", "--text-2", "--muted",
    "--border", "--divider", "--accent", "--hover", "--up", "--down",
    "--c1", "--c2", "--c3", "--c4", "--c5", "--shadow",
    "--r-card", "--r-inner", "--r-pill",
    "--sp-1", "--sp-2", "--sp-3", "--sp-4", "--sp-5", "--sp-6", "--sp-8",
    "--font-head", "--font-body", "--font-mono",
    "--code-bg", "--code-text", "--toc-bg",
]

# Klasy, których markup trackera faktycznie używa. Reguła motywu przechodzi tylko
# wtedy, gdy KAŻDA klasa w jej selektorze jest na tej liście. Reszta jest nieużywana,
# więc jej wycięcie nie zmienia wyglądu — tylko rozmiar.
ALLOW = {
    # powierzchnie i typografia
    "card", "card-h", "card-t", "panel", "hero", "kicker", "meta",
    # przyciski
    "btn", "btn-primary", "btn-secondary", "btn-ghost", "btn-icon",
    # oznaczenia (uwaga: .input/.select w styleguide'ach to ATRAPY — divy udające
    # pola, z display:flex i color:muted. Prawdziwe kontrolki: tb-input/tb-select.)
    "chip", "badge",
    # nawigacja w treści
    "tabs", "tab", "seg",
    # KPI
    "kpi-t", "kpi-v", "kpi-s",
    # postęp i trendy
    "pb", "pb-h", "trend", "up", "down", "arr",
    # wykresy
    "chart", "bar", "series", "av",  # .legend jest tylko w 1/5 → tb-legend
    # komunikaty i utility
    "toast", "row", "flex",
    # stany
    "active", "on", "show", "block",
}

# Skóra shella: layout jest w tracker.css, tu tylko malowanie, z tokenów danego motywu.
# Każdy `--token` użyty poniżej jest sprawdzany przy buildzie — typo wywala build.
SKINS = {
    "soft-corporate": """
.tb-frame{background:var(--lm-bg);border:1px solid var(--border);box-shadow:var(--lm-shadow-pop)}
.tb-side{background:#fff;border-right:1px solid var(--border)}
.tb-head{background:#fff;border:1px solid var(--border);border-radius:var(--r-inner)}
.tb-nav a.is-active{background:var(--accent);color:#fff}
""",
    "pastel-iridescent": """
.tb-frame{background:var(--wl-canvas);box-shadow:var(--wl-shadow-device)}
.tb-side{background:#fff}
.tb-head{background:transparent}
.tb-nav a.is-active{background:var(--wl-ink);color:#fff}
""",
    "frosted-mono": """
.tb-frame{background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.6);
  backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);box-shadow:var(--gl-shadow)}
.tb-side{background:rgba(40,40,44,.45);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px)}
.tb-head{background:transparent}
.tb-side .tb-nav a{color:rgba(255,255,255,.78)}
.tb-nav a.is-active{background:rgba(255,255,255,.22);color:#fff}
""",
    "crisp-fintech": """
.tb-frame{background:var(--zt-bg);border:1px solid #fff;box-shadow:var(--zt-shadow-canvas)}
.tb-side{background:var(--surface);border-right:1px solid var(--border)}
.tb-head{background:transparent}
.tb-nav a.is-active{background:var(--accent);color:#fff}
""",
    "amber-dusk": """
.tb-frame{background:var(--ad-frame);backdrop-filter:var(--ad-blur);
  -webkit-backdrop-filter:var(--ad-blur);box-shadow:var(--ad-shadow-frame)}
.tb-side{background:var(--ad-sidebar)}
.tb-head{background:transparent}
.tb-nav a.is-active{background:var(--ad-sky);color:var(--ad-ink);font-weight:600}
""",
}

# ---------------------------------------------------------------- parser CSS


def split_blocks(css):
    """Dzieli CSS na bloki najwyższego poziomu, licząc nawiasy. Komentarze poza
    blokami są pomijane. Zwraca listę surowych stringów '<sel>{...}'."""
    out, buf, depth, i, n = [], [], 0, 0, len(css)
    while i < n:
        if css.startswith("/*", i):
            end = css.find("*/", i + 2)
            i = n if end < 0 else end + 2
            continue
        ch = css[i]
        buf.append(ch)
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth <= 0:
                depth = 0
                block = "".join(buf).strip()
                if block:
                    out.append(block)
                buf = []
        i += 1
    return out


def selector_of(block):
    return block[: block.index("{")].strip()


def body_of(block):
    return block[block.index("{") + 1 : block.rindex("}")]


def classes_in(sel):
    return set(re.findall(r"\.(-?[_a-zA-Z][\w-]*)", sel))


def selector_allowed(sel):
    """Selektor przechodzi, gdy nie odwołuje się do żadnej klasy spoza ALLOW
    i nie używa id (w motywach id-ki należą do demo)."""
    if "#" in sel:
        return False
    return classes_in(sel) <= ALLOW


def filter_rule(block, dropped):
    """Zwraca regułę z selektorami ograniczonymi do dozwolonych, albo None.
    Lista selektorów rozbijana po przecinkach, żeby z '.tabs,.gl-nav{…}'
    zostało '.tabs{…}'."""
    sel = selector_of(block)
    parts = [p.strip() for p in sel.split(",") if p.strip()]
    keep = [p for p in parts if selector_allowed(p)]
    drop = [p for p in parts if not selector_allowed(p)]
    for d in drop:
        dropped.add(d)
    if not keep:
        return None
    return ",".join(keep) + "{" + body_of(block).strip() + "}"


def is_root(sel):
    return bool(re.match(r"^:root\b", sel.strip()))


def is_base(sel):
    """html / body — tło strony i scena motywu."""
    parts = [p.strip() for p in sel.split(",")]
    return all(re.match(r"^(html|body)(\s*,|\s|$)", p) or p in ("html", "body") for p in parts)


def extract(css, dropped):
    roots, base, rules = [], [], []
    for block in split_blocks(css):
        if "{" not in block:
            continue
        sel = selector_of(block)

        if sel.startswith("@"):
            at = sel.split()[0].lower()
            if at in ("@media", "@supports"):
                inner = body_of(block)
                kept = []
                for sub in split_blocks(inner):
                    if "{" not in sub:
                        continue
                    ssel = selector_of(sub)
                    if is_root(ssel) or is_base(ssel):
                        kept.append(sub)
                    else:
                        r = filter_rule(sub, dropped)
                        if r:
                            kept.append(r)
                if kept:
                    rules.append(sel + "{\n" + "\n".join(kept) + "\n}")
            elif at in ("@keyframes", "@-webkit-keyframes", "@font-face"):
                rules.append(block)
            # @import / @charset celowo pomijane — tracker działa offline
            continue

        if is_root(sel):
            roots.append(block)
        elif is_base(sel):
            base.append(block)
        else:
            r = filter_rule(block, dropped)
            if r:
                rules.append(r)
    return roots, base, rules


# ---------------------------------------------------------------- build


def token_values(root_css):
    return dict(re.findall(r"(--[a-zA-Z0-9-]+)\s*:\s*([^;]+);", root_css))


def resolve(tokens, value, depth=0):
    """Rozwija var(--x) do wartości literalnej. Potrzebne do swatchy w themes.json:
    motywy definiują --c1: var(--lm-blue), a kreator rysuje kafelki wyboru stylu
    w kontekście INNEGO motywu, gdzie --lm-blue nie istnieje — bez rozwinięcia
    kafelek byłby bez koloru."""
    v = (value or "").strip()
    for _ in range(8):
        m = re.fullmatch(r"var\(\s*(--[a-zA-Z0-9-]+)\s*(?:,\s*([^)]*))?\)", v)
        if not m:
            return v
        nxt = tokens.get(m.group(1))
        if nxt is None:
            nxt = m.group(2)            # fallback z var(--x, fallback)
            if nxt is None:
                return v
        v = nxt.strip()
    return v


def main():
    if not SRC.is_dir():
        sys.exit("BŁĄD: brak katalogu %s" % SRC)
    OUT.mkdir(parents=True, exist_ok=True)

    registry, failures = [], []

    for th in THEMES:
        path = SRC / th["file"]
        if not path.is_file():
            failures.append("%s: brak pliku %s" % (th["id"], path.name))
            continue

        html = path.read_text(encoding="utf-8")
        blocks = re.findall(r"<style[^>]*>(.*?)</style>", html, re.S)
        if not blocks:
            failures.append("%s: brak bloku <style>" % th["id"])
            continue
        css = max(blocks, key=len)

        dropped = set()
        roots, base, rules = extract(css, dropped)
        if not roots:
            failures.append("%s: brak :root" % th["id"])
            continue

        tokens = token_values("\n".join(roots))

        # Kontrakt tokenów — bez tego tracker.css nie ma na czym stać.
        missing = [t for t in CONTRACT if t not in tokens]
        if missing:
            failures.append("%s: brak tokenów kontraktu: %s" % (th["id"], " ".join(missing)))
            continue

        # Skóra shella — sprawdzamy, że odwołuje się do istniejących tokenów.
        skin = SKINS[th["id"]].strip()
        skin_tokens = set(re.findall(r"var\((--[a-zA-Z0-9-]+)", skin))
        unknown = sorted(t for t in skin_tokens if t not in tokens)
        if unknown:
            failures.append("%s: SKIN używa nieistniejących tokenów: %s" % (th["id"], " ".join(unknown)))
            continue

        head = (
            "/* %s — motyw trackera.\n"
            "   WYGENEROWANY z sources/%s przez build-themes.py. Nie edytuj ręcznie.\n"
            "   Layout shella jest w tracker.css; tutaj tokeny, komponenty i skóra shella. */\n"
        ) % (th["name"], th["file"])

        out_css = "\n".join(
            [head]
            + roots
            + [""]
            + base
            + [""]
            + rules
            + ["", "/* ---- skóra shella (layout w tracker.css) ---- */", skin, ""]
        )

        (OUT / (th["id"] + ".css")).write_text(out_css, encoding="utf-8")

        # href do fontów Google — tracker może go opcjonalnie wczytać, gdy jest online.
        font = re.search(r'<link[^>]+href="(https://fonts\.googleapis\.com/[^"]+)"', html)

        registry.append(
            {
                "id": th["id"],
                "name": th["name"],
                "file": th["id"] + ".css",
                "bytes": len(out_css.encode("utf-8")),
                "fontHref": font.group(1) if font else None,
                "swatch": {
                    "pageBg": resolve(tokens, tokens["--page-bg"]),
                    "surface": resolve(tokens, tokens["--surface"]),
                    "text": resolve(tokens, tokens["--text"]),
                    "accent": resolve(tokens, tokens["--accent"]),
                    "series": [resolve(tokens, tokens["--c%d" % i]) for i in range(1, 6)],
                },
            }
        )

        unresolved = [k for k, v in registry[-1]["swatch"].items()
                      if (v if isinstance(v, str) else " ".join(v)).find("var(") >= 0]
        if unresolved:
            failures.append("%s: swatch wciąż zawiera var(): %s" % (th["id"], " ".join(unresolved)))

        print(
            "  %-18s %6.1f KB  (tokenów: %3d, reguł: %3d, odrzuconych selektorów: %3d)"
            % (th["id"], len(out_css.encode()) / 1024, len(tokens), len(rules), len(dropped))
        )
        if "--verbose" in sys.argv:
            for d in sorted(dropped):
                print("        odrzucone: %s" % d)

    if failures:
        print("\nBUILD PRZERWANY:")
        for f in failures:
            print("  - " + f)
        sys.exit(1)

    (OUT / "themes.json").write_text(
        json.dumps({"contract": CONTRACT, "themes": registry}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    total = sum(t["bytes"] for t in registry)
    print(
        "\nOK: %d motywów, razem %.1f KB (największy %.1f KB), kontrakt %d tokenów."
        % (
            len(registry),
            total / 1024,
            max(t["bytes"] for t in registry) / 1024,
            len(CONTRACT),
        )
    )
    print("Zapisano: %s" % OUT)


if __name__ == "__main__":
    main()
