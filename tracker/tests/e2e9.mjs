/* Część 9: naprawy znalezione przy pisaniu instrukcji.
   Każda faza odpowiada punktom z planu (A1–A4). */
import pw from '/opt/node-tools/node_modules/playwright/index.js';
const { chromium } = pw;
import { writeFileSync, mkdirSync } from 'node:fs';
const ROOT = '/home/user/Design-';
const OUT = '/tmp/claude-0/e2e9';
mkdirSync(OUT, { recursive: true });

let pass = 0, fail = 0; const fails = [];
function ok(c, l, e) { if (c) { pass++; console.log('  ✓ ' + l); } else { fail++; fails.push(l); console.log('  ✗ ' + l + (e ? '  → ' + e : '')); } }
function section(t) { console.log('\n== ' + t); }

/* Atrapa dysku: pliki po nazwie, oba okna (zapis i otwieranie), awaria zapisu na żądanie. */
const FS = (seed) => `
window.__files = ${JSON.stringify(seed || {})};
window.__pick = 'data.json';
window.__failWrite = false;
window.__writes = 0;
window.__perm = 'granted';
function __handle(name) {
  return {
    kind: 'file', name,
    queryPermission: async () => window.__perm,
    requestPermission: async () => { window.__perm = 'granted'; return 'granted'; },
    getFile: async () => {
      const f = window.__files[name] || { content: '', mtime: 0 };
      return { name, lastModified: f.mtime, text: async () => f.content };
    },
    createWritable: async () => {
      if (window.__failWrite) throw new Error('Disk is full');
      let buf = '';
      return {
        write: async (d) => { buf = typeof d === 'string' ? d : await new Blob([d]).text(); },
        close: async () => { window.__files[name] = { content: buf, mtime: Date.now() }; window.__writes++; }
      };
    }
  };
}
window.showSaveFilePicker = async () => __handle(window.__pick);
window.showOpenFilePicker = async () => [__handle(window.__pick)];`;

const browser = await chromium.launch();
const errors = [];
function watch(p, tag) {
  p.on('console', m => { if (m.type() === 'error') errors.push(tag + ': ' + m.text()); });
  p.on('pageerror', e => errors.push(tag + ' pageerror: ' + e.message));
}
const fieldSel = (label) => `.tb-field:has(> label:text-is("${label}")) > :is(select,input)`;

/* ---------------------------------------------------------------- kreator */
section('FAZA 40 — kreator: wartości, fonty, nazwy plików, wykres liniowy');
const wctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
const wz = await wctx.newPage();
watch(wz, 'wizard');
await wz.goto('file://' + ROOT + '/dist/tracker-wizard.html');
await wz.waitForSelector('#wz-start-cards .wz-tile');
await wz.locator('.wz-tile', { hasText: 'Request log' }).first().click();
await wz.waitForSelector('#wz-step-1:not([hidden])');

const meta = await wz.evaluate(() => TBWizard.state.cfg.meta);
ok(/^https:\/\/fonts\.googleapis\.com/.test(meta.fontHref || ''), 'szablon od razu ma link do fontów motywu', meta.fontHref);
const htmlF = await wz.evaluate(() => TBWizard.emit(TBWizard.state.cfg, false));
ok(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com/.test(htmlF), 'wygenerowany tracker ładuje fonty');

await wz.evaluate(() => { TBWizard.state.cfg.meta.name = 'Zgłoszenia działu / IT'; });
const base = await wz.evaluate(() => TBWizard.fileBase());
ok(base === 'Zgłoszenia działu _ IT', 'polskie litery zostają w nazwie pliku', base);
await wz.evaluate(() => { TBWizard.state.cfg.meta.name = 'Request log'; });

/* typ kolumny: Owner (tekst, @user) → data czyści niepasujący default */
await wz.locator('#wz-rail a', { hasText: 'Data' }).click();
await wz.waitForSelector('#wz-step-2:not([hidden])');
const colRow = async (name) => wz.locator('#wz-step-2 .wz-row').nth(await wz.evaluate((n) =>
  [...document.querySelectorAll('#wz-step-2 .wz-row')].findIndex(r => {
    const i = r.querySelector('input[aria-label="Column name"]'); return i && i.value === n;
  }), name));
await (await colRow('Owner')).locator('select[aria-label="Column type"]').selectOption('date');
await wz.waitForTimeout(150);
const ownerDef = await wz.evaluate(() => {
  const c = TBWizard.state.cfg.datasets[0].columns.find(x => x.label === 'Owner');
  return { type: c.type, def: c.default === undefined ? 'BRAK' : c.default };
});
ok(ownerDef.type === 'date' && ownerDef.def === 'BRAK', 'zmiana typu usunęła @user z kolumny daty', JSON.stringify(ownerDef));
await (await colRow('Owner')).locator('select[aria-label="Column type"]').selectOption('text');

/* domyślna wartość listy wyboru jest widoczna i edytowalna */
await wz.locator('#wz-step-2 button', { hasText: 'Pick list options' }).first().click();
await wz.waitForSelector('dialog.tb-modal');
const defSel = wz.locator('dialog.tb-modal ' + fieldSel('New rows start as'));
ok(await defSel.count() === 1, 'okno opcji listy ma pole „New rows start as”');
ok(await defSel.inputValue() === 'new', 'pokazuje obecny default szablonu (New)', await defSel.inputValue());
await defSel.selectOption('wip');
await wz.locator('dialog.tb-modal button', { hasText: 'Done' }).click();
await wz.waitForTimeout(150);
ok(await wz.evaluate(() => TBWizard.state.cfg.datasets[0].columns.find(x => x.label === 'Status').default) === 'wip',
  'zmiana defaultu listy zapisana');

/* filtr: zapisana wartość = pokazana */
await wz.locator('#wz-rail a', { hasText: 'Components' }).click();
await wz.waitForSelector('#wz-step-4:not([hidden])');
await wz.locator('#wz-step-4 .wz-type', { hasText: 'KPI card' }).click();
await wz.waitForTimeout(150);
await wz.locator('#wz-step-4 button', { hasText: '+ Add condition' }).first().click();
await wz.waitForTimeout(150);
const condRow = () => wz.locator('#wz-step-4 select[aria-label="Condition"]').first();
await condRow().selectOption('relDate');
await wz.waitForTimeout(150);
let rule = await wz.evaluate(() => {
  const t = TBWizard.state.cfg.tabs[TBWizard.state.tab];
  const c = t.components.find(x => x.id === TBWizard.state.cmp);
  return c.agg.filter.rules[0];
});
const shown = await wz.locator('#wz-step-4 select[aria-label="Value"]').first().inputValue();
ok(rule.value === shown && shown === 'today', '„date relative to today”: zapisane = pokazane (today)', JSON.stringify(rule) + ' / ' + shown);
await wz.locator('#wz-step-4 select[aria-label="Column"]').first().selectOption({ label: 'Status' });
await wz.waitForTimeout(150);
await condRow().selectOption('eq');
await wz.waitForTimeout(150);
rule = await wz.evaluate(() => {
  const t = TBWizard.state.cfg.tabs[TBWizard.state.tab];
  return t.components.find(x => x.id === TBWizard.state.cmp).agg.filter.rules[0];
});
ok(rule.value === 'new', 'kolumna z listą: zapisana pierwsza widoczna opcja', JSON.stringify(rule));

/* wykres liniowy z podziałem na serie nie blokuje już eksportu */
await wz.locator('#wz-step-4 .wz-type', { hasText: 'Chart' }).click();
await wz.waitForTimeout(150);
await wz.locator('#wz-step-4 ' + fieldSel('Chart type')).selectOption('line');
await wz.locator('#wz-step-4 ' + fieldSel('Group by column')).selectOption({ label: 'Received' });
await wz.locator('#wz-step-4 ' + fieldSel('Split into series by')).selectOption({ label: 'Status' });
await wz.waitForTimeout(200);
const maxS = wz.locator('#wz-step-4 ' + fieldSel('Max series (line charts: 3 or fewer)'));
ok(await maxS.count() === 1 && await maxS.inputValue() === '3', 'pole „Max series” pojawia się z wartością 3');
let probs = await wz.evaluate(() => TBWizard.validate());
ok(!probs.some(p => /line chart/i.test(p)), 'wykres liniowy z podziałem przechodzi walidację', probs.join(' | '));
await maxS.fill('6'); await maxS.blur();
await wz.waitForTimeout(150);
probs = await wz.evaluate(() => TBWizard.validate());
ok(probs.some(p => /Max series/.test(p)), 'zbyt wiele serii → ostrzeżenie wskazuje istniejące pole', probs.join(' | '));
await maxS.fill('3'); await maxS.blur();

/* własna akcja: „Ask before running” */
await wz.locator('#wz-step-4 select[aria-label="Tab"], #wz-step-4 ' + fieldSel('Tab')).first().selectOption({ label: 'Log' });
await wz.waitForTimeout(150);
await wz.locator('#wz-step-4 .wz-row-main', { hasText: 'Requests' }).first().click();
await wz.waitForTimeout(200);
const askBox = wz.locator('#wz-step-4 label.tb-switch', { hasText: 'Ask before running' }).first();
ok(await askBox.count() === 1, 'każda własna akcja ma „Ask before running”');
await askBox.locator('input').check();
ok(await wz.evaluate(() => {
  const t = TBWizard.state.cfg.tabs.find(x => x.label === 'Log');
  return t.components[0].opts.contextMenu.actions[0].confirm === true;
}), 'zaznaczenie zapisuje confirm: true w akcji');

/* tracker do dalszych faz: dodatkowa zakładka z tabelą bez notatek i zakładka To-do */
const trackerHtml = await wz.evaluate(() => {
  const cfg = TBWizard.state.cfg;
  const ds = cfg.datasets[0];
  cfg.tabs = cfg.tabs.filter(t => ['Summary', 'Log', 'Dates', 'Notes'].includes(t.label));
  cfg.tabs[0].components = cfg.tabs[0].components.filter(c => c.type !== 'kpi' || c.title !== 'KPI card');
  cfg.tabs[0].components = cfg.tabs[0].components.filter(c => c.type !== 'chart' || c.title !== 'Chart');
  cfg.tabs.push({
    id: 't_plain', label: 'Plain', icon: '▤', layout: { cols: 1, variant: 'even' },
    components: [{ id: 'k_plain', type: 'table', title: 'Plain table', col: 0, order: 10, span: 'full',
      dataset: ds.id, agg: { op: 'count' },
      opts: { pageSize: 50, editable: true, selectable: true, search: true, rowNotes: false,
        columns: ds.columns.slice(0, 3).map(c => c.id),
        contextMenu: { builtins: ['edit', 'duplicate', 'delete', 'addNote', 'copyRow', 'exportSelected'], actions: [] } } }]
  });
  cfg.tabs.push(TBWizard.presets.build('todo', ds));
  return TBWizard.emit(cfg, false);
});
writeFileSync(OUT + '/tracker.html', trackerHtml);
const problems = await wz.evaluate(() => TBWizard.validate());
ok(problems.length === 0, 'konfiguracja testowa przechodzi walidację', problems.join(' | '));

/* ---------------------------------------------------------------- pliki */
section('FAZA 41 — podpinanie pliku: otwórz istniejący nie nadpisuje danych');
const ctxA = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
await ctxA.addInitScript(FS());
const tA = await ctxA.newPage();
watch(tA, 'tracker A');
await tA.goto('file://' + OUT + '/tracker.html');
await tA.waitForSelector('#tb-nav a');
await tA.locator('#tb-notices button', { hasText: 'Choose a data file' }).click();
await tA.waitForSelector('dialog.tb-modal .tb-choice');
ok((await tA.locator('dialog.tb-modal .tb-modal-title').textContent()) === 'Where should your data live?',
  'okno wyboru ma tytuł „Where should your data live?”');
await tA.locator('dialog.tb-modal .tb-choice', { hasText: 'Create a new data file' }).click();
await tA.waitForTimeout(500);
const seedRows = await tA.evaluate(() => {
  const ds = TB.config().datasets[0];
  const col = n => ds.columns.find(c => c.label === n).id;
  [1, 2].forEach(i => {
    const d = {}; d[col('Subject')] = 'Saved row ' + i; d[col('Requested by')] = 'Ann';
    TB.store.putRecord({ id: 'r_s' + i, ds: ds.id, data: d, _c: 1, _m: 1, _d: 0 });
  });
  return TB.store.saveNow();
});
await tA.waitForTimeout(300);
const fileA = await tA.evaluate(() => JSON.parse(window.__files['data.json'].content));
ok(seedRows === true && fileA.records.length === 2, 'pierwszy komputer zapisał 2 wiersze do pliku');

/* „nowy komputer”: pusta przeglądarka, ten sam plik na dysku */
const ctxB = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
await ctxB.addInitScript(FS({ 'data.json': { content: JSON.stringify(fileA), mtime: Date.now() - 5000 } }));
const tB = await ctxB.newPage();
watch(tB, 'tracker B');
await tB.goto('file://' + OUT + '/tracker.html');
await tB.waitForSelector('#tb-nav a');
await tB.locator('#tb-nav a', { hasText: 'Log' }).click();
await tB.locator('#tb-notices button', { hasText: 'Choose a data file' }).click();
await tB.locator('dialog.tb-modal .tb-choice', { hasText: 'Open my existing data file' }).click();
await tB.waitForTimeout(700);
const fileB = await tB.evaluate(() => JSON.parse(window.__files['data.json'].content));
ok(fileB.records.length === 2, 'otwarcie istniejącego pliku go NIE nadpisało', 'rekordów w pliku: ' + fileB.records.length);
ok(await tB.locator('.tb-table tbody tr').count() === 2, 'wiersze z pliku są w tabeli');
ok(/Opened data\.json — 2 records loaded/.test(await tB.locator('.toast').textContent()), 'toast mówi, ile wczytano');
ok((await tB.locator('#tb-save').getAttribute('data-state')) === 'saved', 'wskaźnik: zapisane');

/* plik, który nie jest danymi trackera */
await tB.evaluate(() => { window.__files['other.json'] = { content: '{"hello":1}', mtime: 1 }; window.__pick = 'other.json'; });
await tB.locator('#tb-head-actions button[aria-label="More options"]').click();
await tB.locator('.tb-menu .tb-menu-item', { hasText: 'Link a different file…' }).click();
await tB.locator('dialog.tb-modal .tb-choice', { hasText: 'Open my existing data file' }).click();
await tB.waitForTimeout(400);
ok(/not tracker data/.test(await tB.locator('.toast').textContent()), 'obcy JSON: jasny komunikat, nic nie podpięte');
ok(await tB.evaluate(() => window.__files['other.json'].content) === '{"hello":1}', 'obcy plik nietknięty');

/* lokalne zmiany + plik z danymi → wybór, plik nietknięty do decyzji */
section('FAZA 42 — konflikt przy podpinaniu i przy Reconnect');
const ctxC = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
await ctxC.addInitScript(FS({ 'data.json': { content: JSON.stringify(fileA), mtime: Date.now() - 5000 } }));
const tC = await ctxC.newPage();
watch(tC, 'tracker C');
await tC.goto('file://' + OUT + '/tracker.html');
await tC.waitForSelector('#tb-nav a');
await tC.evaluate(() => {
  const ds = TB.config().datasets[0];
  const col = n => ds.columns.find(c => c.label === n).id;
  const d = {}; d[col('Subject')] = 'Typed before linking'; d[col('Requested by')] = 'Bob';
  TB.store.putRecord({ id: 'r_local', ds: ds.id, data: d, _c: 1, _m: 1, _d: 0 });
});
await tC.locator('#tb-notices button', { hasText: 'Choose a data file' }).click();
await tC.locator('dialog.tb-modal .tb-choice', { hasText: 'Open my existing data file' }).click();
await tC.waitForTimeout(500);
ok((await tC.locator('#tb-notices .tb-banner-danger .tb-banner-title').textContent()) === 'This file already holds data',
  'plik z danymi + niezapisane zmiany → pasek wyboru');
await tC.waitForTimeout(1800);
ok(JSON.parse(await tC.evaluate(() => window.__files['data.json'].content)).records.length === 2,
  'do decyzji plik nie jest zapisywany');
await tC.locator('#tb-notices .tb-banner-danger button', { hasText: 'Keep browser copy' }).click();
await tC.waitForTimeout(600);
const afterKeep = JSON.parse(await tC.evaluate(() => window.__files['data.json'].content));
ok(afterKeep.records.some(r => r.id === 'r_local'), '„Keep browser copy” zapisuje wersję z przeglądarki');
ok(await tC.locator('#tb-notices .tb-banner-danger').count() === 0, 'pasek znika po decyzji');

/* Reconnect: plik nie nowszy + niezapisana edycja → edycja zostaje i trafia do pliku */
const keptEdit = await tC.evaluate(async () => {
  const r = TB.data.index['r_local'];
  const ds = TB.config().datasets[0];
  const subj = ds.columns.find(c => c.label === 'Subject').id;
  r.data[subj] = 'Edited before Reconnect';
  TB.store.touch(r);
  await TB.store.reconnect();
  await new Promise(res => setTimeout(res, 400));
  const file = JSON.parse(window.__files['data.json'].content);
  return {
    mem: TB.data.index['r_local'].data[subj],
    file: (file.records.find(x => x.id === 'r_local') || { data: {} }).data[subj]
  };
});
ok(keptEdit.mem === 'Edited before Reconnect', 'Reconnect nie zgubił edycji w przeglądarce', JSON.stringify(keptEdit));
ok(keptEdit.file === 'Edited before Reconnect', 'edycja sprzed Reconnect trafiła do pliku', JSON.stringify(keptEdit));

/* nieudany zapis nie udaje sukcesu */
section('FAZA 43 — nieudany zapis');
await tC.evaluate(() => { window.__failWrite = true; });
await tC.locator('#tb-head-actions button', { hasText: 'Save' }).click();
await tC.waitForTimeout(500);
const failToast = await tC.locator('.toast').textContent();
ok(/Could not write the data file: Disk is full/.test(failToast), 'komunikat o błędzie zostaje, a nie „Saved”', failToast);
ok((await tC.locator('#tb-save').getAttribute('data-state')) === 'dirty', 'wskaźnik: niezapisane zmiany');
await tC.evaluate(() => { window.__failWrite = false; });

/* ---------------------------------------------------------------- tabela */
const P = '#tb-panels > section:not([hidden]) ';
section('FAZA 44 — tabela: sortowanie przed limitem, puste stany, edycja w komórce');
await tC.evaluate(() => {
  const ds = TB.config().datasets[0];
  const col = n => ds.columns.find(c => c.label === n).id;
  for (let i = 1; i <= 600; i++) {
    const d = {}; d[col('Subject')] = 'Row ' + String(i).padStart(4, '0'); d[col('Requested by')] = 'Bulk';
    d[col('Status')] = 'new';
    TB.store.putRecord({ id: 'r_b' + i, ds: ds.id, data: d, _c: i, _m: i, _d: 0 });
  }
});
await tC.locator('#tb-nav a', { hasText: 'Log' }).click();
await tC.waitForTimeout(500);
ok(await tC.locator(P + '.tb-banner-title', { hasText: 'Showing the first 500 rows' }).count() === 1, 'ponad 500 wierszy: baner limitu');
await tC.locator(P + '.tb-table thead th', { hasText: 'Subject' }).click();
await tC.waitForTimeout(300);
await tC.locator(P + '.tb-table thead th', { hasText: 'Subject' }).click();
await tC.waitForTimeout(400);
const top = await tC.locator(P + '.tb-table tbody tr').first().textContent();
ok(top.includes('Row 0600'), 'sortowanie malejąco obejmuje wszystkie 601 wierszy, nie pierwsze 500', top.slice(0, 80));
await tC.locator(P + '.tb-toolbar button', { hasText: 'Export' }).click();
const viewItem = await tC.locator('.tb-menu .tb-menu-item', { hasText: 'Current view' }).textContent();
ok(/\(601\)/.test(viewItem), 'eksport „Current view” obejmuje wszystkie 601 pasujących wierszy', viewItem);
await tC.keyboard.press('Escape');

await tC.locator(P + '.tb-chip-btn', { hasText: 'Overdue' }).click();
await tC.waitForTimeout(400);
ok(await tC.locator('.tb-empty-title, .tb-empty h3, .tb-empty', { hasText: 'Nothing matches your filters' }).count() >= 1,
  'chip bez wyników: „Nothing matches your filters”, nie „No rows yet”');
ok(await tC.locator('button', { hasText: 'Clear filters' }).count() === 1, 'jest „Clear filters”');
await tC.locator('button', { hasText: 'Clear filters' }).click();
await tC.waitForTimeout(300);

/* edycja w komórce: dwuklik edytuje, zwykły klik otwiera panel */
await tC.locator(P + '.tb-table thead th', { hasText: 'Subject' }).click(); // asc
await tC.waitForTimeout(300);
const subjCell = tC.locator(P + '.tb-table tbody tr').first().locator('td[data-tb-editable]').nth(1);
const before = await subjCell.textContent();
await subjCell.dblclick();
await tC.waitForTimeout(400);
ok(await tC.locator('.tb-drawer.is-open').count() === 0, 'dwuklik NIE otwiera panelu');
ok(await subjCell.locator('input').count() === 1, 'dwuklik zamienia komórkę w pole edycji', before);
await subjCell.locator('input').fill('Edited in the cell');
await subjCell.locator('input').press('Enter');
await tC.waitForTimeout(400);
ok(await tC.locator(P + '.tb-table tbody td', { hasText: 'Edited in the cell' }).count() === 1, 'Enter zapisuje edycję w komórce');
await tC.locator(P + '.tb-table tbody tr').nth(1).locator('td[data-tb-editable]').nth(1).click();
await tC.waitForSelector('.tb-drawer.is-open', { timeout: 2000 });
ok(true, 'pojedynczy klik dalej otwiera panel wiersza');
ok(await tC.locator('.tb-drawer .tb-check-group', { hasText: 'Notes on this row' }).isVisible(),
  'tabela z notatkami: panel ma „Notes on this row”');
await tC.keyboard.press('Escape');
await tC.waitForTimeout(300);

/* tabela z wyłączonymi notatkami, bez Ctrl+C, „Duplicated” */
await tC.locator('#tb-nav a', { hasText: 'Plain' }).click();
await tC.waitForTimeout(400);
await tC.locator(P + '.tb-table tbody tr').first().click({ button: 'right' });
await tC.waitForSelector('.tb-menu');
const items = await tC.locator('.tb-menu .tb-menu-item').allTextContents();
ok(!items.some(x => /Add a note/.test(x)), '„Notes on rows” wyłączone → brak „Add a note”', items.join(' | '));
ok(!items.some(x => /Ctrl\+C/.test(x)), 'przy „Copy as text” nie ma martwego skrótu Ctrl+C');
await tC.locator('.tb-menu .tb-menu-item', { hasText: 'Duplicate' }).click();
await tC.waitForTimeout(300);
ok(/^Duplicated 1 row$/.test((await tC.locator('.toast').textContent()).trim()), 'toast „Duplicated 1 row”');
await tC.locator(P + '.tb-table tbody tr').first().locator('td').nth(2).click();
await tC.waitForSelector('.tb-drawer.is-open');
ok(!(await tC.locator('.tb-drawer .tb-check-group', { hasText: 'Notes on this row' }).isVisible()),
  'panel bez sekcji notatek');
await tC.keyboard.press('Escape');
await tC.waitForTimeout(300);

/* własna akcja z „Ask before running” pyta */
await tC.locator('#tb-nav a', { hasText: 'Log' }).click();
await tC.waitForTimeout(300);
await tC.locator(P + '.tb-table tbody tr').first().click({ button: 'right' });
await tC.locator('.tb-menu .tb-menu-item', { hasText: 'Close request' }).click();
await tC.waitForTimeout(300);
ok(await tC.locator('dialog.tb-modal button', { hasText: 'Apply' }).count() === 1, '„Ask before running” → potwierdzenie z „Apply”');
await tC.locator('dialog.tb-modal button', { hasText: 'Cancel' }).click();

/* ---------------------------------------------------------------- checklista */
section('FAZA 45 — checklista z terminami');
await tC.locator('#tb-nav a', { hasText: 'To-do' }).click();
await tC.waitForTimeout(400);
const dateIn = tC.locator(P + '.tb-check-add input[type="date"]');
ok(await dateIn.count() === 1, 'To-do: pole terminu przy dodawaniu pozycji');
await tC.locator(P + '.tb-check-add input[aria-label="New checklist item"]').fill('Send the report');
await dateIn.fill('2026-12-24');
await tC.locator(P + '.tb-check-add input[aria-label="New checklist item"]').press('Enter');
await tC.waitForTimeout(400);
const dueTxt = await tC.locator(P + '.tb-check-item .tb-check-due').first().textContent();
const expDue = await tC.evaluate(() => TB.fmt.date('2026-12-24'));
ok(dueTxt === expDue, 'pozycja pokazuje termin', dueTxt + ' vs ' + expDue);
await tC.locator(P + '.tb-check-item .tb-check-due').first().click();
await tC.locator(P + '.tb-check-item input[type="date"]').fill('2026-12-31');
await tC.waitForTimeout(400);
ok((await tC.locator(P + '.tb-check-item .tb-check-due').first().textContent()) === await tC.evaluate(() => TB.fmt.date('2026-12-31')),
  'klik w termin pozwala go zmienić');
await tC.locator('#tb-nav a', { hasText: 'Dates' }).click();
await tC.waitForTimeout(300);
ok(await tC.locator(P + '.tb-check-add input[type="date"]').count() === 0, 'codzienna rutyna (bez terminów) nie ma pola daty');

/* ---------------------------------------------------------------- uszkodzony plik */
section('FAZA 46 — uszkodzona konfiguracja');
writeFileSync(OUT + '/broken.html', trackerHtml.replace(/(<script type="application\/json" id="tb-config">)[\s\S]*?(<\/script>)/, '$1{broken$2'));
const tD = await ctxA.newPage();
await tD.goto('file://' + OUT + '/broken.html');
await tD.waitForSelector('.tb-gate h1');
ok((await tD.locator('.tb-gate h1').textContent()) === 'This tracker file is damaged', 'uszkodzony plik ma własny nagłówek, nie „Chrome and Edge”');

section('Błędy konsoli');
ok(errors.length === 0, 'zero błędów w konsoli', errors.join('\n'));

await browser.close();
console.log('\n' + '='.repeat(60));
console.log('CZĘŚĆ 9: zaliczone ' + pass + ', nieudane ' + fail);
if (fail) { console.log('Nieudane:\n - ' + fails.join('\n - ')); process.exit(1); }
