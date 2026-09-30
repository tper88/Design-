#!/usr/bin/env python3
"""Składa savance-kit.html: jeden samodzielny plik z przykładowym dashboardem,
paletą, promptem dla AI, kodem biblioteki i instrukcją integracji.

Użycie:  python3 build-kit.py   (uruchom ponownie po każdej zmianie źródeł)
"""
import html
import re
from pathlib import Path

HERE = Path(__file__).parent
css = (HERE / "savance.css").read_text(encoding="utf-8")
charts = (HERE / "savance-charts.js").read_text(encoding="utf-8")
ui = (HERE / "savance-ui.js").read_text(encoding="utf-8")
prompt_md = (HERE / "PROMPT.md").read_text(encoding="utf-8")
page = (HERE / "components.html").read_text(encoding="utf-8")

# ---------- prompt: tylko część między znacznikami ----------
start = prompt_md.index("\n=== POCZĄTEK PROMPTU ===\n") + len("\n=== POCZĄTEK PROMPTU ===\n")
end = prompt_md.index("\n=== KONIEC PROMPTU ===")
prompt = prompt_md[start:end].strip()
replace_code = re.search(r"Przykład podmiany w JS:\n```js\n(.*?)```", prompt_md, re.S).group(1).strip()

# ---------- paleta: parsowanie zmiennych z :root ----------
root = css[css.index(":root {"):css.index("\n}\n", css.index(":root {"))]
tokens = re.findall(r"--sv-([a-z0-9-]+):\s*([^;]+);", root)
tokens = [(n, " ".join(v.split())) for n, v in tokens if re.match(r"(#|rgba|linear-gradient|radial-gradient|var\(--sv-)", v.strip())]
tokens = [(n, v) for n, v in tokens if not n.startswith(("shadow", "glow", "blur", "ease"))]

GROUPS = [
    ("Backdrop (za oknem)", lambda n: n.startswith("backdrop")),
    ("Powierzchnie", lambda n: n.split("-")[0] in ("shell", "sidebar", "canvas", "glass", "border", "divider", "grid")),
    ("Tekst", lambda n: n.startswith("text")),
    ("Amber (akcent marki)", lambda n: n.startswith("amber")),
    ("Sky (nawigacja)", lambda n: n.startswith("sky")),
    ("Lavender i indigo", lambda n: n.startswith(("lavender", "indigo"))),
    ("Magenta, rose, coral", lambda n: n.startswith(("magenta", "rose", "coral"))),
    ("Gold, khaki, cream, cocoa", lambda n: n.startswith(("gold", "khaki", "cream", "cocoa"))),
    ("Semantyka i status", lambda n: n.startswith(("accent", "success", "warning", "danger", "info", "neutral"))),
    ("Serie wykresów (stała kolejność)", lambda n: n.startswith("chart")),
    ("Gradienty", lambda n: n.startswith("grad")),
]
used = set()
swatch_html = []
for title, match in GROUPS:
    items = [(n, v) for n, v in tokens if match(n) and n not in used]
    if not items:
        continue
    used.update(n for n, _ in items)
    grad = title == "Gradienty"
    cells = "".join(
        f'<button class="kit-sw" type="button" data-copy-text="var(--sv-{n})" title="Kliknij, żeby skopiować var(--sv-{n})">'
        f'<span class="kit-sw__chip"><i style="background:var(--sv-{n})"></i></span>'
        f'<span class="kit-sw__name">--sv-{n}</span><span class="kit-sw__val">{html.escape(v)}</span></button>'
        for n, v in items
    )
    swatch_html.append(
        f'<div class="sv-stack" style="gap:10px"><div class="sv-eyebrow">{title}</div>'
        f'<div class="kit-sws{" kit-sws--wide" if grad else ""}">{cells}</div></div>'
    )


def code_block(file_id, filename, content, lang):
    return f"""
      <section class="sv-card sv-stack" style="gap:12px">
        <div class="sv-card__head" style="margin:0"><div><div class="sv-h3">{filename}</div>
          <div class="sv-caption">{lang} · {len(content.splitlines())} linii</div></div>
          <div class="sv-row"><button class="sv-btn sv-btn--sm" type="button" data-copy="{file_id}">Kopiuj</button>
          <button class="sv-btn sv-btn--sm sv-btn--cream" type="button" data-download="{file_id}" data-filename="{filename}">Pobierz</button></div></div>
        <pre class="kit-code" id="{file_id}">{html.escape(content)}</pre>
      </section>"""


NAV = """
        <li class="sv-eyebrow" style="padding:14px 12px 4px">Zestaw</li>
        <li><a class="sv-nav__item" href="#" data-sv-tab="kit-colors"><svg><use href="#i-palette"/></svg>Kolory</a></li>
        <li><a class="sv-nav__item" href="#" data-sv-tab="kit-prompt"><svg><use href="#i-doc"/></svg>Prompt AI</a></li>
        <li><a class="sv-nav__item" href="#" data-sv-tab="kit-files"><svg><use href="#i-code"/></svg>Biblioteka</a></li>
        <li><a class="sv-nav__item" href="#" data-sv-tab="kit-setup"><svg><use href="#i-plug"/></svg>Integracja</a></li>"""

ICONS = """
  <symbol id="i-palette" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.5-.8 1.5-1.5 0-1-.7-1.3-.7-2.2 0-.9.7-1.6 1.6-1.6H17a4 4 0 0 0 4-4c0-4.7-4-8.7-9-8.7z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10.5" cy="7" r="1"/><circle cx="15.5" cy="7.5" r="1"/></symbol>
  <symbol id="i-doc" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/></symbol>
  <symbol id="i-code" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 7l-5 5 5 5M16 7l5 5-5 5"/></symbol>
  <symbol id="i-plug" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4"/></symbol>
</svg>"""

PAGES = f"""
    <!-- ============ ZESTAW: KOLORY ============ -->
    <section class="sv-tabpanel sv-stack" id="kit-colors" hidden>
      <div class="sv-section-head"><div><h2 class="sv-h2">Kolory i gradienty</h2><p>Wszystkie tokeny kolorów z savance.css. Kliknij próbkę, żeby skopiować zmienną CSS.</p></div></div>
      <section class="sv-card sv-stack" style="gap:24px">{"".join(swatch_html)}</section>
    </section>

    <!-- ============ ZESTAW: PROMPT ============ -->
    <section class="sv-tabpanel sv-stack" id="kit-prompt" hidden>
      <div class="sv-banner">
        <div class="sv-banner__icon"><svg><use href="#i-doc"/></svg></div>
        <div class="sv-banner__body"><h2 class="sv-banner__title">Prompt systemowy dla AI</h2>
          <p class="sv-banner__text">Przed wysłaniem podmień trzy znaczniki: <code>{{{{DATA_JSON}}}}</code> (zmapowane dane z Excela), <code>{{{{FILE_NAME}}}}</code> (nazwa pliku) i <code>{{{{USER_BRIEF}}}}</code> (oczekiwania użytkownika albo „brak”).</p></div>
        <div class="sv-banner__actions"><button class="sv-btn sv-btn--cream" type="button" data-copy="src-prompt">Kopiuj prompt</button></div>
      </div>
      <section class="sv-card"><pre class="kit-code kit-code--prose" id="src-prompt">{html.escape(prompt)}</pre></section>
    </section>

    <!-- ============ ZESTAW: BIBLIOTEKA ============ -->
    <section class="sv-tabpanel sv-stack" id="kit-files" hidden>
      <div class="sv-section-head"><div><h2 class="sv-h2">Pliki biblioteki</h2><p>Te trzy pliki musi dostać każdy wygenerowany dashboard. „Pobierz” zapisuje plik z właściwą nazwą.</p></div></div>
      <div class="sv-tabs" data-sv-tabs>
        <button class="sv-tab is-active" type="button" data-sv-tab="f-css">savance.css</button>
        <button class="sv-tab" type="button" data-sv-tab="f-charts">savance-charts.js</button>
        <button class="sv-tab" type="button" data-sv-tab="f-ui">savance-ui.js</button>
      </div>
      <div class="sv-tabpanel" id="f-css">{code_block("src-css", "savance.css", css, "CSS")}</div>
      <div class="sv-tabpanel" id="f-charts" hidden>{code_block("src-charts", "savance-charts.js", charts, "JavaScript")}</div>
      <div class="sv-tabpanel" id="f-ui" hidden>{code_block("src-ui", "savance-ui.js", ui, "JavaScript")}</div>
    </section>

    <!-- ============ ZESTAW: INTEGRACJA ============ -->
    <section class="sv-tabpanel sv-stack" id="kit-setup" hidden>
      <div class="sv-section-head"><div><h2 class="sv-h2">Integracja z narzędziem</h2><p>Jak połączyć wgrany plik Excel, AI i bibliotekę Savance w jeden działający dashboard.</p></div></div>
      <div class="sv-grid sv-grid--2">
        <section class="sv-card sv-stack" style="gap:14px">
          <div class="sv-h3">Przepływ</div>
          <ul class="sv-list">
            <li class="sv-list__item"><span class="sv-list__rank">1</span><div class="sv-list__body"><span class="sv-list__title">Wczytaj Excel i zmapuj dane</span><span class="sv-list__meta">np. SheetJS → JSON</span></div></li>
            <li class="sv-list__item"><span class="sv-list__rank">2</span><div class="sv-list__body"><span class="sv-list__title">Wstaw dane do promptu</span><span class="sv-list__meta">{{{{DATA_JSON}}}}, {{{{FILE_NAME}}}}, {{{{USER_BRIEF}}}}</span></div></li>
            <li class="sv-list__item"><span class="sv-list__rank">3</span><div class="sv-list__body"><span class="sv-list__title">Wyślij prompt do AI</span><span class="sv-list__meta">odpowiedź to jeden dokument HTML</span></div></li>
            <li class="sv-list__item"><span class="sv-list__rank">4</span><div class="sv-list__body"><span class="sv-list__title">Wstaw bibliotekę do HTML-a</span><span class="sv-list__meta">podmiana 3 tagów, kod obok</span></div></li>
            <li class="sv-list__item"><span class="sv-list__rank">5</span><div class="sv-list__body"><span class="sv-list__title">Pokaż wynik</span><span class="sv-list__meta">&lt;iframe srcdoc&gt; albo zapis do .html</span></div></li>
          </ul>
        </section>
        <section class="sv-card sv-stack" style="gap:14px">
          <div class="sv-h3">Pliki</div>
          <ul class="sv-list">
            <li class="sv-list__item"><span class="sv-file__ext">CSS</span><div class="sv-list__body"><span class="sv-list__title">savance.css</span><span class="sv-list__meta">styl i wszystkie komponenty · wymagany</span></div></li>
            <li class="sv-list__item"><span class="sv-file__ext">JS</span><div class="sv-list__body"><span class="sv-list__title">savance-charts.js</span><span class="sv-list__meta">wykresy i formatery liczb · wymagany</span></div></li>
            <li class="sv-list__item"><span class="sv-file__ext">JS</span><div class="sv-list__body"><span class="sv-list__title">savance-ui.js</span><span class="sv-list__meta">zakładki, modal, toast, tabele, upload · wymagany</span></div></li>
            <li class="sv-list__item"><span class="sv-file__ext">TXT</span><div class="sv-list__body"><span class="sv-list__title">Prompt AI</span><span class="sv-list__meta">zakładka „Prompt AI” w tym pliku</span></div></li>
          </ul>
          <p class="sv-caption" style="margin:0">Ten plik zawiera wszystko. Kod pobierzesz w zakładce „Biblioteka”.</p>
        </section>
      </div>
      <section class="sv-card sv-stack" style="gap:12px">
        <div class="sv-card__head" style="margin:0"><div><div class="sv-h3">Wstawienie biblioteki do wygenerowanego HTML-a</div>
          <div class="sv-caption">SAVANCE_CSS, SAVANCE_CHARTS_JS i SAVANCE_UI_JS to treść trzech plików jako tekst</div></div>
          <button class="sv-btn sv-btn--sm" type="button" data-copy="src-replace">Kopiuj</button></div>
        <pre class="kit-code" id="src-replace">{html.escape(replace_code)}</pre>
        <p class="sv-caption" style="margin:0">savance.css ładuje font Plus Jakarta Sans z Google Fonts. Bez internetu strona użyje fontu zastępczego.</p>
      </section>
    </section>
"""

KIT_CSS = """
.kit-code { margin: 0; padding: 16px; max-height: 560px; overflow: auto; border-radius: var(--sv-radius-md);
  background: rgba(8, 5, 4, .55); border: 1px solid var(--sv-border);
  font: 400 12px/1.6 var(--sv-font-mono); color: var(--sv-cream-200); white-space: pre; tab-size: 2; }
.kit-code--prose { white-space: pre-wrap; max-height: 70vh; }
.kit-sws { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; align-items: start; }
.kit-sws--wide { grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); }
.kit-sw { all: unset; box-sizing: border-box; cursor: pointer; display: flex; flex-direction: column; min-width: 0;
  border-radius: var(--sv-radius-md); overflow: hidden; border: 1px solid var(--sv-border); background: var(--sv-glass-solid-1);
  transition: transform var(--sv-dur) var(--sv-ease), border-color var(--sv-dur); }
.kit-sw:hover { transform: translateY(-2px); border-color: var(--sv-border-strong); }
.kit-sw:focus-visible { outline: 2px solid var(--sv-sky-400); outline-offset: 2px; }
.kit-sw__chip { position: relative; height: 56px; background-color: #221A17;
  background-image: linear-gradient(45deg, #2B211D 25%, transparent 25%, transparent 75%, #2B211D 75%), linear-gradient(45deg, #2B211D 25%, transparent 25%, transparent 75%, #2B211D 75%);
  background-size: 12px 12px; background-position: 0 0, 6px 6px; }
.kit-sw__chip i { position: absolute; inset: 0; }
.kit-sw__name { padding: 8px 10px 0; font-size: 11px; font-weight: 600; color: var(--sv-text); }
.kit-sw__val { padding: 2px 10px 0; margin-bottom: 8px; font: 500 10.5px/1.35 var(--sv-font-mono); color: var(--sv-text-3); word-break: break-all;
  display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.sv-main code { font-family: var(--sv-font-mono); font-size: .92em; padding: 1px 5px; border-radius: 4px; background: rgba(0,0,0,.25); }
"""

KIT_JS = """
<script>
(function () {
  var title = document.querySelector('.sv-title'), demoTitle = title.textContent;
  var demoCtl = Array.prototype.slice.call(document.querySelectorAll('.sv-topbar > :not(.sv-title)'));
  document.addEventListener('sv:tabchange', function (e) {
    if (!e.detail.trigger.classList.contains('sv-nav__item')) return;
    var kit = e.detail.id.indexOf('kit-') === 0;
    title.textContent = kit ? 'Savance Kit' : demoTitle;
    demoCtl.forEach(function (el) { el.hidden = kit; });
  });
  function flash(msg) { SavanceUI.toast(msg, 'success', 2200); }
  function copy(text, label) {
    var done = function () { flash('Skopiowano: ' + label); };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done, function () { fallback(text) ? done() : flash('Zaznacz tekst i skopiuj ręcznie'); });
    } else if (fallback(text)) done(); else flash('Zaznacz tekst i skopiuj ręcznie');
  }
  function fallback(text) {
    var ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', '');
    ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select();
    var ok = false; try { ok = document.execCommand('copy'); } catch (e) {} ta.remove(); return ok;
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-copy],[data-copy-text],[data-download]');
    if (!b) return;
    if (b.dataset.copyText) return copy(b.dataset.copyText, b.dataset.copyText);
    var src = document.getElementById(b.dataset.copy || b.dataset.download);
    if (b.dataset.copy) return copy(src.textContent, b.textContent === 'Kopiuj prompt' ? 'prompt' : (b.closest('.sv-card').querySelector('.sv-h3') || {}).textContent || 'kod');
    var type = /\\.css$/.test(b.dataset.filename) ? 'text/css' : 'text/javascript';
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([src.textContent], { type: type + ';charset=utf-8' }));
    a.download = b.dataset.filename; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    flash('Pobrano: ' + b.dataset.filename);
  });
})();
</script>
"""

out = page
out = out.replace("<title>Savance Components</title>", "<title>Savance Kit</title>")
out = out.replace('<link rel="stylesheet" href="savance.css">', "<style>\n" + css + "\n" + KIT_CSS + "</style>")
out = out.replace('<script src="savance-charts.js"></script>', "<script>\n" + charts + "\n</script>")
out = out.replace('<script src="savance-ui.js"></script>', "<script>\n" + ui + "\n</script>")
out = out.replace("</svg>", ICONS, 1)
nav_anchor = 'data-sv-tab="page-import"><svg><use href="#i-upload"/></svg>Import</a></li>'
out = out.replace(nav_anchor, nav_anchor + NAV, 1)
out = out.replace('<ul class="sv-nav">', '<ul class="sv-nav">\n        <li class="sv-eyebrow" style="padding:0 12px 4px">Przykład</li>', 1)
out = out.replace("  </main>", PAGES + "  </main>", 1)
out = out.replace("</body>", KIT_JS + "</body>")

# biblioteka musi być wstawiona, nie linkowana (sprawdzamy część przed pierwszym <pre> z kodem źródłowym)
head = out.split('<pre class="kit-code')[0]
assert '<link rel="stylesheet" href="savance.css">' not in head.split("<style>")[0], "savance.css nie wstawiony"
assert prompt.startswith("Jesteś generatorem"), "zły fragment promptu"
for needle in ('<script src="savance-charts.js">', '<script src="savance-ui.js">'):
    assert needle not in head, needle

(HERE / "savance-kit.html").write_text(out, encoding="utf-8")
print("savance-kit.html", round(len(out.encode()) / 1024), "KB,", len(tokens), "tokenów kolorów")
