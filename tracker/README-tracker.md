# Tracker builder

A wizard that produces a **single HTML file**: a tracker that runs offline and
writes its data to a `.json` file on the user's own disk.

The product UI is English. **Code comments and commit messages are Polish** —
they are maintenance notes, not product.

## What comes out of it

| file | what it is | who writes it |
|---|---|---|
| `dist/tracker-wizard.html` | the builder — open it in Chrome | `build-wizard.py` |
| `<name>.html` | the finished tracker | the builder, last step |
| `<name>.tracker.json` | the tracker's **structure**, for later edits | the builder, last step |
| `<name>.data.json` | the user's **data** | the tracker itself, while in use |

Structure and data are kept apart permanently, so rebuilding a tracker never
touches the rows people have typed.

## Build and test

```bash
python3 tracker/build-themes.py     # extracts the 5 themes from tracker/sources/
python3 tracker/build-wizard.py     # assembles dist/tracker-wizard.html
sh tracker/tests/run-all.sh         # build + 197 end-to-end assertions in Chromium
```

`dist/tracker-wizard.html` is a **build artifact**. Editing it by hand is
pointless — the next build overwrites it. Sources live in `tracker/`.

## Browser support

**Chrome and Edge.** The tracker writes to disk through the File System Access
API. Without that API it shows a full-screen notice and refuses to start,
rather than pretending to save. Firefox and Safari are not supported.

## How data is kept

The **`.data.json` file is the source of truth**; IndexedDB is only a fast local
cache. The reason is concrete: when a page is opened over `file://`, browser
storage is keyed to the **file path**, so renaming or moving `tracker.html`
would look exactly like losing everything. The `.json` file does not care.

What this means for the person using it:

- On first run the tracker asks them to pick a data file.
- After the browser is closed and reopened it shows **“Reconnect to your data
  file”** with the remembered file name. One click per browser session — that
  cannot be avoided, because browsers require a user gesture to renew file
  permission.
- Saving is automatic (1.5 s after the last change) plus a **Save** button and
  **Ctrl+S**. Hiding the tab forces a save.
- `beforeunload` cannot finish an async write, so an unsaved state triggers the
  browser's own warning and IndexedDB acts as the safety net.
- If the file changed outside the tab, a conflict bar offers three ways out.
  **Nothing is ever overwritten automatically.**
- When updating a tracker, **overwrite the old file in place, same name**.

## Personalisation

Each person sets their own name, team, avatar colour and optional photo from
the sidebar. Photos are cropped square and resized to 96×96 in the browser
(≈1–4 KB) so the data file stays small. The profile is stored per machine in
IndexedDB and also travels inside the data file; a local profile always wins
over the one in the file, so sharing a file does not overwrite someone's name.

The `@user` and `@team` tokens — usable as column defaults, filter values and
right-click action values — resolve to that profile.

## Alerts

Alerts are rules defined in the wizard: a dataset, a filter, a threshold, a
tone and a message with `{{n}}`. The tracker shows them under a bell in the top
bar with a count, recalculated after every change. Clicking an alert jumps to
the tab you nominated.

They are deliberately **in-app only**. A plain HTML file cannot notify anyone
while it is closed — there is nothing running in the background — so a desktop
notification would only ever fire while the tracker is already open.

## Tab presets

In the Tabs step, **Add a tab** offers seven kinds: Summary, Query, Agenda,
Notes, Checklist, To-do and Blank. Each comes with components already wired to
the chosen dataset. Column roles are guessed from types and names:

| role | how it is recognised |
|---|---|
| due date | a date column named like *due, deadline, until, termin* |
| event date (time axis) | the first other date column |
| closed state | a pick-list option or yes/no column named like *done, closed, complete* |
| owner | a text column defaulting to `@user`, or named like *owner, assigned* |

A miss only means fewer components, never a broken tab: with no closed state
there is no "Open" filter, with no due date there is no "Overdue". Agenda is
disabled until some dataset has a date column. Everything a preset creates is
ordinary configuration, editable in the Components step — including the quick
filter chips above a table, which now have their own editor.

## Style

The style is **baked into the generated file**: one theme, no switcher. To
change it, load the `.tracker.json` back into the wizard, pick another style and
generate again — the data stays where it is, because the tracker id does not
change.

### Adding a sixth theme

Themes are generated from the styleguide files in `tracker/sources/` by
`build-themes.py`:

1. Drop the styleguide HTML into `tracker/sources/`.
2. Add an entry to `THEMES` in `build-themes.py` (id, file, name, prefix).
3. Add a **shell skin** to the `SKINS` dict — layout belongs to `tracker.css`,
   the theme only paints (`.tb-frame`, `.tb-side`, `.tb-head`,
   `.tb-nav a.is-active`). The build checks that every token used in a skin
   really exists in that theme's `:root`.

### The 34-token contract

A theme **must** define all of these in `:root`. The build fails if any is
missing, and that is deliberate: `tracker.css` stands on them.

```
--page-bg  --surface  --surface-2  --text  --text-2  --muted
--border   --divider  --accent     --hover --up      --down
--c1 --c2 --c3 --c4 --c5           --shadow
--r-card --r-inner --r-pill
--sp-1 --sp-2 --sp-3 --sp-4 --sp-5 --sp-6 --sp-8
--font-head --font-body --font-mono
--code-bg --code-text --toc-bg
```

Optional: `--c1-hi … --c5-hi` (a lighter top for bar gradients). Without them a
gradient is the same hue fading out.

### Component classes taken from the theme

The tracker markup uses **the class names from your own styleguides**, so each
style keeps its character: `card card-h card-t panel hero kicker meta btn
btn-primary btn-secondary btn-ghost btn-icon chip badge tabs tab seg kpi-t kpi-v
kpi-s pb pb-h trend up down arr chart bar series av toast row flex` plus the
states `active on show block`.

Two deliberate exceptions: `.input` and `.select` in the styleguides are
**mock-ups** (divs with `display:flex` and `color:var(--muted)`), so real
controls use `tb-input` / `tb-select`. `.legend` exists in only one theme, so
legends are drawn by `tb-legend`.

Anything that floats above content — the context menu, tooltips, the modal, the
drawer, sticky table headers — uses `--tb-solid`, which lays the theme's
`--surface` over an opaque `--page-bg`. Without it the glass themes show the
table straight through the menu.

## Not built yet

- **Tooltip, accordion, stepper, breadcrumbs** have styles in `tracker.css`, but
  no component uses them and they are not in the wizard's catalogue. The toggle
  is used (the wizard's own switches).
- **Skeleton** is unused — nothing in the tracker loads slowly enough to need it.
- Month-grid calendar, calculated columns, OR filters, drag and drop, undo/redo
  and `.xlsx` import are out of scope for this version.
