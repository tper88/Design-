# Kreator trackerów

Kreator składa **jeden plik HTML**, który działa offline i zapisuje dane
do wskazanego pliku `.json` na dysku użytkownika.

## Dwa artefakty

| plik | co to jest | kto go tworzy |
|---|---|---|
| `dist/tracker-wizard.html` | kreator — otwierasz go w przeglądarce | `build-wizard.py` |
| `<nazwa>.html` | gotowy tracker dla użytkownika | kreator, w kroku 5 |
| `<nazwa>.tracker.json` | **struktura** trackera do późniejszych zmian | kreator, w kroku 5 |
| `<nazwa>.data.json` | **dane** użytkownika | sam tracker, w trakcie pracy |

Struktura i dane są rozdzielone na stałe. Dzięki temu przebudowa trackera
nigdy nie rusza wpisanych rekordów.

## Build

```bash
python3 tracker/build-themes.py     # wyciąga 5 motywów z tracker/sources/
python3 tracker/build-wizard.py     # składa dist/tracker-wizard.html
node tracker/tests/e2e.mjs          # testy, 4 części: e2e / e2e2 / e2e3 / e2e4
```

`dist/tracker-wizard.html` jest **artefaktem builda**. Każda ręczna edycja
zniknie przy następnym uruchomieniu assemblera — źródła są w `tracker/`.

## Wymagania przeglądarki

**Chrome albo Edge.** Tracker używa File System Access API do zapisu
do pliku. Bez tego API pokazuje pełnoekranowy komunikat i nie uruchamia się —
celowo, żeby nie udawać, że zapisuje dane, których nie zapisze.
Firefox i Safari nie są obsługiwane.

## Trwałość danych — co trzeba wiedzieć

Źródłem prawdy jest **plik `.data.json`**, nie przeglądarka. IndexedDB jest
tylko szybkim cache'em. Powód jest konkretny: przy otwarciu przez `file://`
magazyn przeglądarki jest kluczowany po **ścieżce pliku**, więc zmiana nazwy
albo przeniesienie `tracker.html` wyglądałaby jak utrata wszystkiego.
Plik `.data.json` tego nie dotyczy.

Konsekwencje dla użytkownika:

- Przy pierwszym uruchomieniu tracker prosi o wskazanie pliku danych.
- Po zamknięciu przeglądarki pokazuje pasek **„Połącz ponownie z plikiem"**
  z nazwą zapamiętanego pliku. Jedno kliknięcie na sesję — tego nie da się
  obejść, przeglądarka wymaga gestu użytkownika do odnowienia uprawnienia.
- Zapis jest automatyczny (1,5 s po ostatniej zmianie) plus przycisk
  **Zapisz** i **Ctrl+S**. Przy ukryciu karty leci wymuszony zapis.
- `beforeunload` nie dokończy zapisu asynchronicznego — przy niezapisanych
  zmianach przeglądarka pokaże swoje ostrzeżenie, a IndexedDB jest siatką
  bezpieczeństwa.
- Jeśli plik zmieni się poza kartą, tracker pokazuje pasek konfliktu
  z trzema wyjściami. **Nic nie jest nadpisywane automatycznie.**
- Aktualizując tracker, **nadpisz stary plik w tym samym miejscu i pod tą
  samą nazwą**.

## Dodanie szóstego motywu

Motywy są generowane z plików styleguide'ów w `tracker/sources/` przez
`build-themes.py`. Żeby dodać kolejny:

1. Wrzuć plik HTML styleguide'u do `tracker/sources/`.
2. Dopisz wpis do listy `THEMES` w `build-themes.py` (id, plik, nazwa, prefiks).
3. Dopisz **skórę shella** do słownika `SKINS` — layout należy do `tracker.css`,
   motyw dokłada tylko malowanie (`.tb-frame`, `.tb-side`, `.tb-head`,
   `.tb-nav a.is-active`). Build sprawdza, że każdy token użyty w skórze
   naprawdę istnieje w `:root` tego motywu.

### Kontrakt 34 tokenów

Motyw **musi** definiować w `:root` wszystkie poniższe. Build pada, jeśli
czegoś brakuje — i to jest zamierzone, bo `tracker.css` na nich stoi.

```
--page-bg  --surface  --surface-2  --text  --text-2  --muted
--border   --divider  --accent     --hover --up      --down
--c1 --c2 --c3 --c4 --c5           --shadow
--r-card --r-inner --r-pill
--sp-1 --sp-2 --sp-3 --sp-4 --sp-5 --sp-6 --sp-8
--font-head --font-body --font-mono
--code-bg --code-text --toc-bg
```

Opcjonalnie: `--c1-hi … --c5-hi` (jaśniejszy wierzch gradientu słupków).
Bez nich gradient to ten sam odcień z malejącą alfą.

### Klasy komponentów brane z motywu

Markup trackera używa **własnych nazw klas z Twoich styleguide'ów**, żeby każdy
styl zachował charakter: `card card-h card-t panel hero kicker meta btn
btn-primary btn-secondary btn-ghost btn-icon chip badge tabs tab seg kpi-t
kpi-v kpi-s pb pb-h trend up down arr chart bar series av toast row flex`
plus stany `active on show block`.

Dwie świadome wyjątki: `.input` i `.select` w styleguide'ach są **atrapami**
(divy z `display:flex` i `color:var(--muted)`), więc prawdziwe kontrolki mają
własne klasy `tb-input` / `tb-select`. `.legend` występuje tylko w jednym
motywie, więc legendy rysuje `tb-legend`.

## Co jeszcze nie jest zrobione

- **Presety zakładek** istnieją tylko przez 3 szablony startowe. Dodając nową
  zakładkę w kroku 3, dostajesz pustą — komponenty dokładasz sam.
- **Tooltip, accordion, stepper, breadcrumbs** mają gotowe styles w
  `tracker.css`, ale żaden komponent ich jeszcze nie używa i nie ma ich
  w katalogu kreatora. Toggle jest używany (przełączniki w kreatorze).
- **Skeleton** jest niewykorzystany — nic w trackerze nie ładuje się tak długo,
  żeby miał sens.
- Siatka miesiąca kalendarza, kolumny liczone (formuły), filtry OR,
  drag & drop, undo/redo, import `.xlsx` — poza zakresem pierwszej wersji.
