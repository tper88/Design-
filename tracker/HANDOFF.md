# Handoff — Tracker builder

Written 2026-10-06. Read this plus `README-tracker.md` and you have the whole
picture; nothing important lives only in the chat history.

## What this is

A wizard (`dist/tracker-wizard.html`) that people open in Chrome or Edge and use
to assemble their own tracker — tabs, components, columns, alerts, style — with
no code. It emits **one self-contained HTML file** that runs offline and writes
its data to a `.json` file on the user's own disk. It is meant to replace the
Excel sheets people keep for request logs, checklists, notes and deadlines.

Tomasz's five styleguide HTMLs are the visual foundation. They sit untouched in
`tracker/sources/` and the themes are generated from them.

## Current state

**Done and verified.** Branch `tracker-wizard`, head `18a4676`, pushed.
**No pull request has been opened** — Tomasz has not asked for one.

Build + 5 test parts: **151 assertions, zero console errors**, Chromium.

```
43 + 30 + 25 + 24 + 29 = 151
```

| | |
|---|---|
| emitted tracker | **164.5–165.8 KB** (one theme, no data) |
| `dist/tracker-wizard.html` | ~405 KB |
| themes | 5, 7.6–9.0 KB each |

The size is worth stating plainly because the original plan promised 100–130 KB.
The runtime came out ~35 KB bigger than estimated. Nothing is broken by it; the
plan's number was simply wrong.

## Build and test

```bash
python3 tracker/build-themes.py     # sources/*.html  -> themes/*.css + themes.json
python3 tracker/build-wizard.py     # everything      -> dist/tracker-wizard.html
sh tracker/tests/run-all.sh         # build + all 151 assertions (needs Chromium)
node tracker/tests/e2e5.mjs         # one part on its own
```

Chromium is at `/opt/pw-browsers/chromium`; `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`
is already set in this environment. Never run `playwright install`.

`dist/tracker-wizard.html` is a **build artifact**. It is committed, but editing
it by hand is pointless — the next build overwrites it. Sources live in
`tracker/`.

## File map

| file | ~size | what it is |
|---|---|---|
| `build-themes.py` | 13 KB | extracts the 5 themes from `sources/`, validates the 34-token contract, appends hand-written shell SKINS, resolves `var()` chains for the swatches |
| `build-wizard.py` | 6.6 KB | assembles `dist/tracker-wizard.html`; base64 asset islands; build assertions |
| `tools/strip.py` | — | string/regex-aware JS and CSS comment stripper |
| `themes/*.css` + `themes.json` | 40 KB | **generated — never edit** |
| `tracker.css` | 37 KB | the neutral `tb-*` layer; the only place layout lives |
| `tb-charts.js` | 19 KB | SVG charts, port of `savance-charts.js`, palette on `--c1..--c5` |
| `tb-ui.js` | 17 KB | tabs, modal, drawer, toast, dropzone, context menu |
| `tb-xlsx.js` | 16 KB | real `.xlsx` writer, no libraries |
| `tb-runtime.js` | 112 KB | the tracker engine — **the big one** |
| `tracker-shell.html` | 1.5 KB | output template, 9 `<!--TB:*-->` markers |
| `wizard-src.html` + `wizard.css` + `wizard.js` | 3.3 + 3.9 + 85 KB | the builder itself |
| `tests/e2e*.mjs` + `run-all.sh` | — | 5 parts, 24 phases |
| `sources/` | — | Tomasz's 6 uploaded files, md5-verified. **Read-only.** |

`design-system/` is **not** touched. `savance.css` and `savance-charts.js` were
sources for a port, not dependencies.

## Test coverage, by phase

```
e2e.mjs   1 wizard · 2 script injection via tab name · 3 tracker on file:// · 4 reload persistence
e2e2.mjs  5 context menu · 6 data file + save indicator · 7 conflict bar · 8 .xlsx via UI · 9 browser gate
e2e3.mjs  10 setup · 11 typed export + multi-sheet · 12 rebuild keeps data
          13 restoring a column restores its data · 14 all 5 themes · 15 style baked in, no switcher
e2e4.mjs  16 paste Excel header · 17 paste Excel data · 18 search/quick filter/pagination · 19 note pinned to row
e2e5.mjs  20 Request log template · 21 alerts · 22 profile + avatar · 23 profile photo · 24 number/date format picker
```

## Invariants — break these and things fail quietly

1. **The `.data.json` file is the source of truth; IndexedDB is only a cache.**
   Over `file://` browser storage is keyed to the **file path**, so renaming or
   moving `tracker.html` would look exactly like losing everything.
2. **Ids are immutable** (`ds_ c_ t_ k_ a_ al_ trk_`). Minted once, never derived
   from a label, never regenerated, never reused. This is what makes rebuilding a
   tracker non-destructive: a deleted column **hides** its data as an orphan and
   the data comes back if a column with that id is re-added.
3. **`JSON.stringify` does not escape `<`.** The config island escapes it to
   `<` or a tab named `</script>` closes the island and injects script.
   Test phase 2 guards this.
4. **`String.replace` substitutes `$&` in the *replacement*.** Every asset
   injection uses the **function form** — `.replace(marker, () => value)`. The
   USD number format contains `$&` and was corrupted by the string form once
   already.
5. **Themes carry `* { margin: 0; padding: 0 }`.** That reset kills UA defaults,
   which is why `.tb-modal` needs an explicit `margin: auto` (the modal rendered
   in the top-left corner without it). Assume no UA default survives.
6. **Anything that floats uses `--tb-solid`** — `linear-gradient(var(--surface),
   var(--surface)), var(--page-bg)`. The glass themes are translucent, so without
   it the context menu shows the table straight through itself.
7. **Charts theme through `var()` in the `style` attribute**, never presentation
   attributes and never `getComputedStyle`.
8. **`safe(fn)`** wraps IndexedDB calls because `put()` throws **synchronously**
   on a DataCloneError, so a bare `.catch` never attaches and the promise dies.
9. **`requestPermission()` must be the first statement in a gesture handler** —
   no `await` before it, or the user-gesture requirement is lost.
10. **Watch for raw U+2028/U+2029** in written files. The Write tool decoded
    ` ` into the literal separator twice and broke regex literals. A
    project-wide scan currently shows zero; re-run it after bulk edits.

## Decisions already settled — do not reopen

- **Chrome and Edge only.** No Firefox or Safari fallback; the tracker shows a
  full-screen notice instead of pretending to save.
- **One style, baked in. No switcher.** Changing the style means loading the
  `.tracker.json` back into the wizard and generating again.
- **Wizard step 0 has two equal paths**: start new / from a template, **and**
  upload a `.tracker.json`. The upload path is not a side link.
- **Product UI is English**, with a locale picker (en-GB default, en-US, pl-PL)
  driving all date and number formatting through `Intl`.
- **Alerts are in-app only.** A closed HTML file has nothing running in the
  background, so a desktop notification could only ever fire while the tracker is
  already open.
- Real `.xlsx` export, 4 scopes: selected rows / current view / whole dataset /
  whole tracker (a sheet per dataset).
- Import is CSV + paste from Excel (TSV). No `.xlsx` input.

## Open items

**One question for Tomasz, unanswered:**
Code comments and commit messages are still **Polish** while the product UI is
English. He said "wszystko ma być po angielsku" in the context of the product.
If that was meant to cover the source too, it is one translation pass over
`tb-runtime.js`, `wizard.js`, `tracker.css`, the Python builders and the test
runner's console output (which is also Polish). Ask before doing it — it touches
every file and the tests assert on some of that output.

**Not built, and Tomasz knows:**
- Tab presets exist only through the 3 starting templates; a new tab starts empty.
- Tooltip, accordion, stepper and breadcrumbs have styles in `tracker.css` but no
  component uses them and they are not in the wizard catalogue.
- Skeleton is unused.
- Month-grid calendar, calculated columns, OR filters, drag and drop, undo/redo
  and `.xlsx` import are out of scope for this version.

**Not verifiable in a headless session — Tomasz has to check these himself:**
1. A real Ctrl+V of a range copied from Excel.
2. Opening an exported `.xlsx` in real Excel (structure and types were verified
   programmatically with `zipfile` + `ElementTree` + openpyxl round-trips, but
   not Excel's own rendering).
3. The full File System Access permission path across an actual browser restart.

## Screenshots

`shots/` holds 19 PNGs, regenerated after the modal fix. The generator is
`tracker/tools/shots.mjs` (run it from the repo root with `node`); it was moved
out of a scratch directory into the repo so it survives this session.
