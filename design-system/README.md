# Savance Design System

Styl wyekstrahowany z referencyjnego dashboardu „Savance”: ciepły glassmorphism, ciemny motyw, bursztynowe tło, kolorowe karty KPI i pastelowe wykresy.

## Pliki

**Wszystko w jednym pliku:** `savance-kit.html`. Przykładowy dashboard, paleta, prompt AI (przycisk „Kopiuj”), kod trzech plików biblioteki (przyciski „Kopiuj” i „Pobierz”) oraz instrukcja integracji. Otwórz go w przeglądarce. Po zmianie źródeł wygeneruj go ponownie: `python3 build-kit.py`.

**Do narzędzia generującego (wymagane):**

| Plik | Do czego |
|---|---|
| `savance.css` | Wszystkie tokeny (`--sv-*`) i klasy komponentów (`.sv-*`). |
| `savance-charts.js` | Wykresy SVG bez zależności: `bar`, `line` (wiele serii), `hbar` (ranking), `donut`, `spark`, formatery liczb (pl-PL). |
| `savance-ui.js` | Zachowanie: zakładki (sidebar i w kartach), modal (statyczny i dynamiczny), toast, sortowanie tabel, upload pliku. |
| `PROMPT.md` | Pełny prompt systemowy dla AI generującego dashboard z danych Excela plus instrukcja integracji. |

**Referencyjne (opcjonalne):**

| Plik | Do czego |
|---|---|
| `components.html` | Wzorcowy dashboard z 4 stronami i wszystkimi komponentami. Można go dołączyć do promptu jako przykład. |
| `example-dashboard.html` | Odtworzenie oryginalnego dashboardu Savance. |
| `styleguide.html` | Wizualny style guide: paleta, gradienty, typografia, komponenty v1.0. |
| `tokens.json` | Wartości tokenów w JSON (Figma / Tailwind / własny generator). |

## Komponenty

v1.0: shell, sidebar, nawigacja, topbar, karty KPI, karta szklana, przyciski, chipy, input, awatary, legenda, miernik, wykresy słupkowe i liniowe.
v1.1: baner (8 wariantów), zakładki w treści, karta statystyki, sparkline, pasek postępu, tabela (sortowanie, stopka, przewijanie), lista top N, select, pole formularza, strefa uploadu i karta pliku, **modal** (4 rozmiary, statyczny i dynamiczny), toast, stan pusty, skeleton, tagi, siatki 2/3/4 kolumny, donut, ranking poziomy, wykres wieloseryjny.

## Szybki start

```html
<link rel="stylesheet" href="savance.css">
<body class="sv-body">
  <div class="sv-shell">
    <aside class="sv-sidebar">…</aside>
    <main class="sv-main">…</main>
  </div>
  <script src="savance-charts.js"></script>
</body>
```

## Paleta w skrócie

**Backdrop (za oknem):** `#E0A35E` amber · `#A37D50` honey · `#836146` umber · `#545260` slate

**Powierzchnie:** shell `#0C0908` · sidebar `#0A0706` · canvas `#1A1311` · glass `rgba(255,244,235,.045/.075/.11)` · border `rgba(255,240,225,.09)`

**Tekst:** `#F6F0EA` · `#BDB3AB` · `#857B74` · na jasnym `#1C1410`

**Akcenty:**
- Amber `#FAD9A6 #F6C27E #EFA75E #E39F5F #D0822F #A8621C`
- Sky `#CBE6FB #A6D3F7 #89BFEF #72B0EA #4F92D6 #356FB0`
- Lavender `#DCD7F6 #BFB6E1 #A59CE6 #8A84E0 #6F6AD0`
- Indigo `#6F87C8 #6560D8 #6E429E #4A2E80`
- Magenta `#CA768E #BB4189 #962E6D` · Rose `#E7768A #E05A7C` · Coral `#F0906E #E8745A`
- Gold `#F8DC7E #F2C94C #E0B02E` · Khaki `#B89C7C #986F50 #76716E`
- Cream `#FBEFD9 #F4DFBC #D0B690` · Cocoa `#5A3E2C #3E2A1E #2A1C14`

**Status:** success `#3CCB7F` · warning `#F5B544` · danger `#EF5A5F` · info `#89BFEF` · neutral `#8A807A`

**Serie wykresów (stała kolejność):** `#EFA75E` amber → `#A59CE6` lavender → `#89BFEF` sky → `#E05A7C` rose → `#F2C94C` gold → `#B89C7C` khaki

**Karty KPI (gradienty, od lewej):** khaki → indigo → magenta → rose → sunset (pełne definicje w `savance.css`, sekcja 6).

## Typografia

Plus Jakarta Sans (fallback: Inter, system-ui). Skala: 36 hero · 22 H1 · 20 wartość KPI · 17 H2 · 14 H3 · 13 body · 12 label · 11 caption · 10 osie/eyebrow. Liczby zawsze `tabular-nums`.

## Geometria

Odstępy w siatce 4 px (4–48). Promienie: 6 słupki · 10 nav/inputy · 14 KPI · 18 panele · 26 okno · 999 pigułki. Odstęp między kartami 16 px, padding kart 18 px, szerokość sidebara 200 px.

## Reguły dla generatora (do wklejenia w prompt AI)

```
Styl: Savance Warm Glass (dark). Używaj wyłącznie klas i tokenów z savance.css.
1. Struktura: .sv-body > .sv-shell > (.sv-sidebar + .sv-main). Topbar: .sv-topbar z .sv-title, jedną .sv-btn--cream (główna akcja), .sv-input i .sv-btn--amber (przełącznik kontekstu).
2. Nawigacja: .sv-nav z dokładnie jednym .sv-nav__item.is-active.
3. KPI: rząd .sv-grid--kpi, max 5 kart .sv-kpi w kolejności khaki, indigo, magenta, rose, sunset. Karta: __head (avatar + nazwa), .sv-kpi-value, __foot (opis + zmiana %).
4. Panele: .sv-card z .sv-card__head (tytuł .sv-h3 + .sv-caption, po prawej .sv-chip--accent lub .sv-btn--sm). Główna siatka .sv-grid--main (1.55fr / 1fr).
5. Wykresy: SavanceCharts.bar / .line. Kolory serii w kolejności amber, lavender, sky, rose, gold; poprzedni okres = ghost. Linie w gold. Zawsze legenda .sv-legend przy 2+ seriach.
6. Kolor tylko w kartach KPI i danych wykresów. Tekst: var(--sv-text), etykiety var(--sv-text-2), podpisy var(--sv-text-3). Zielony/czerwony tylko dla statusu, zawsze ze strzałką ▲▼.
7. Bez białych teł, bez czystej szarości, bez ostrych rogów. Liczby z .sv-num.
```
