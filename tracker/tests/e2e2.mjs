/* Część 2: menu kontekstowe, plik danych, konflikt, eksport xlsx,
   przebudowa z zachowaniem danych, 5 motywów, brama przeglądarki. */
import pw from '/opt/node-tools/node_modules/playwright/index.js';
const { chromium } = pw;
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';

const ROOT = '/home/user/Design-';
const OUT = '/tmp/claude-0/e2e';
mkdirSync(OUT, { recursive: true });

let pass = 0, fail = 0; const fails = [];
function ok(c, l, e) { if (c) { pass++; console.log('  ✓ ' + l); } else { fail++; fails.push(l); console.log('  ✗ ' + l + (e ? '  → ' + e : '')); } }
function section(t) { console.log('\n== ' + t); }

/* Atrapa File System Access: pozwala przetestować realną ścieżkę zapisu
   i odnawiania uprawnień bez okna dialogowego systemu. */
const FAKE_FS = `
window.__fs = { name: 'dane.data.json', content: '', mtime: 0, perm: 'granted', writes: 0 };
window.__mkHandle = function () {
  return {
    name: window.__fs.name, kind: 'file',
    queryPermission: async () => window.__fs.perm,
    requestPermission: async () => { window.__fs.perm = 'granted'; return 'granted'; },
    getFile: async () => ({
      name: window.__fs.name, lastModified: window.__fs.mtime,
      text: async () => window.__fs.content
    }),
    createWritable: async () => ({
      write: async (d) => {
        window.__fs.content = typeof d === 'string' ? d
          : (d instanceof Blob ? await d.text() : new TextDecoder().decode(d));
        window.__fs.writes++;
      },
      close: async () => { window.__fs.mtime = Date.now(); }
    })
  };
};
window.showSaveFilePicker = async () => window.__mkHandle();
`;

const browser = await chromium.launch();
const errors = [];
function watch(p, tag) {
  p.on('console', m => { if (m.type() === 'error') errors.push(tag + ': ' + m.text()); });
  p.on('pageerror', e => errors.push(tag + ' pageerror: ' + e.message));
}

/* ---------------------------------------- menu kontekstowe + eksport + plik */
section('FAZA 5 — menu kontekstowe');
const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
await ctx.addInitScript(FAKE_FS);
const tr = await ctx.newPage();
watch(tr, 'tracker');
await tr.goto('file://' + OUT + '/tracker.html');
await tr.waitForSelector('#tb-nav a');
await tr.locator('#tb-nav a', { hasText: 'Rejestr' }).click();
await tr.waitForSelector('.tb-table');

/* Każdy kontekst Playwrighta to świeży profil, więc IndexedDB jest pusta —
   dosiewamy 3 wiersze przez API, żeby mieć na czym testować menu. */
await tr.evaluate(() => {
  const cfg = TB.config();
  const ds = cfg.datasets[0];
  const col = n => ds.columns.find(c => new RegExp(n, 'i').test(c.label)).id;
  const mk = (i, who, subj, stat, due) => {
    const d = {};
    d[col('Zgłaszający')] = who;
    d[col('Temat')] = subj;
    d[col('Wpłynęło')] = '2026-09-1' + i;
    d[col('Termin')] = due;
    d[col('Status')] = stat;
    return { id: 'r_seed' + i, ds: ds.id, data: d, _c: Date.now(), _m: Date.now(), _d: 0 };
  };
  TB.store.putRecord(mk(1, 'Anna Kowalska', 'Korekta faktury', 'new', '2026-11-30'));
  TB.store.putRecord(mk(2, 'Piotr Nowak', 'Zapytanie o limit', 'wip', '2026-01-01'));
  TB.store.putRecord(mk(3, 'Maria Wiśniewska', 'Reklamacja dostawy', 'new', '2026-12-31'));
});
await tr.waitForSelector('.tb-table tbody tr');
const rowCount = await tr.locator('.tb-table tbody tr').count();
ok(rowCount === 3, 'dane zasiane dla testów menu (' + rowCount + ' wiersze)');

/* prawy klik poza tabelą — normalne menu przeglądarki */
await tr.locator('#tb-title').click({ button: 'right' });
await tr.waitForTimeout(150);
ok(await tr.locator('.tb-menu').count() === 0,
  'prawy klik poza tabelą NIE podmienia menu przeglądarki');

/* prawy klik na wierszu poza zaznaczeniem */
await tr.locator('.tb-table tbody tr').first().click({ button: 'right' });
await tr.waitForSelector('.tb-menu');
ok(true, 'menu kontekstowe otwiera się na wierszu');
const items = await tr.locator('.tb-menu .tb-menu-item').allTextContents();
ok(items.some(t => t.includes('Zamknij zapytanie')), 'menu ma własną akcję z wizarda',
  JSON.stringify(items));
ok(items.some(t => t.includes('Przypisz do mnie')), 'menu ma akcję „Przypisz do mnie"');
ok(await tr.locator('.tb-menu .tb-menu-head').count() === 0,
  'bez zaznaczenia menu nie pokazuje nagłówka o liczbie wierszy');
await tr.keyboard.press('Escape');
await tr.waitForTimeout(120);
ok(await tr.locator('.tb-menu').count() === 0, 'Escape zamyka menu');

/* akcja na jednym wierszu poza zaznaczeniem */
const firstRowStatusBefore = await tr.locator('.tb-table tbody tr').first()
  .locator('td').nth(4).textContent();
await tr.locator('.tb-table tbody tr').first().click({ button: 'right' });
await tr.waitForSelector('.tb-menu');
await tr.locator('.tb-menu .tb-menu-item', { hasText: 'Zamknij zapytanie' }).click();
await tr.waitForTimeout(300);
const firstRowStatusAfter = await tr.locator('.tb-table tbody tr').first()
  .locator('td').nth(4).textContent();
ok(firstRowStatusAfter.includes('Zamknięte'),
  'akcja setField zmieniła status jednego wiersza', firstRowStatusBefore + ' → ' + firstRowStatusAfter);

/* zaznaczenie 2 wierszy i akcja masowa */
const boxes = tr.locator('.tb-table tbody tr input.tb-check');
await boxes.nth(1).check();
await tr.waitForTimeout(200);
await tr.locator('.tb-table tbody tr input.tb-check').nth(2).check();
await tr.waitForTimeout(250);
ok((await tr.locator('.tb-toolbar .tb-count').textContent()).includes('2'),
  'pasek pokazuje liczbę zaznaczonych');
await tr.locator('.tb-table tbody tr').nth(1).click({ button: 'right' });
await tr.waitForSelector('.tb-menu');
const head = await tr.locator('.tb-menu .tb-menu-head').first().textContent();
ok(head.includes('2'), 'menu na wierszu W zaznaczeniu mówi o 2 wierszach', head);
await tr.locator('.tb-menu .tb-menu-item', { hasText: 'Termin na dziś' }).click();
await tr.waitForTimeout(400);
const today = new Date();
const iso = today.getFullYear() + '.' + String(today.getMonth() + 1).padStart(2, '0') + '.' +
  String(today.getDate()).padStart(2, '0');
const dmy = iso.split('.').reverse().join('.');
const dueCells = await tr.locator('.tb-table tbody tr').nth(1).locator('td').allTextContents();
const dueCells2 = await tr.locator('.tb-table tbody tr').nth(2).locator('td').allTextContents();
ok(dueCells.join(' ').includes(dmy) && dueCells2.join(' ').includes(dmy),
  'akcja masowa ustawiła dzisiejszą datę w OBU zaznaczonych wierszach',
  dmy + ' | ' + dueCells.join('|') + ' || ' + dueCells2.join('|'));

/* ---------------------------------------- plik danych */
section('FAZA 6 — plik danych, zapis i wskaźnik');
await tr.locator('#tb-notices button', { hasText: 'Wybierz plik danych' }).click();
await tr.waitForTimeout(600);
const st1 = await tr.locator('#tb-save').getAttribute('data-state');
ok(st1 === 'saved', 'po wskazaniu pliku wskaźnik pokazuje "Zapisano"', st1);
const fileObj = await tr.evaluate(() => JSON.parse(window.__fs.content));
ok(fileObj.$kind === 'tracker.data' && fileObj.records.length >= 3,
  'plik danych zawiera rekordy (' + fileObj.records.length + ')');
ok(!!fileObj.trackerId, 'plik danych nosi trackerId');
ok(await tr.locator('#tb-notices .tb-banner-warning').count() >= 1,
  'jest ostrzeżenie, że uchwyt pliku nie został zapamiętany (atrapa nie jest klonowalna)');

const writes1 = await tr.evaluate(() => window.__fs.writes);
await tr.keyboard.press('Control+s');
await tr.waitForTimeout(500);
const writes2 = await tr.evaluate(() => window.__fs.writes);
ok(writes2 > writes1, 'Ctrl+S wymusza zapis do pliku', writes1 + ' → ' + writes2);

/* ---------------------------------------- konflikt */
section('FAZA 7 — konflikt: plik nowszy niż kopia lokalna');
await tr.evaluate(() => {
  const cfg = TB.config();
  const ds = cfg.datasets[0];
  const col = n => ds.columns.find(c => new RegExp(n, 'i').test(c.label)).id;
  const d = {};
  d[col('Zgłaszający')] = 'Z PLIKU';
  d[col('Temat')] = 'Rekord wczytany z pliku';
  window.__fs.content = JSON.stringify({
    $kind: 'tracker.data', trackerId: cfg.meta.trackerId, configRev: cfg.rev,
    savedAt: new Date().toISOString(),
    records: [{ id: 'r_fromfile', ds: ds.id, data: d, _c: 1, _m: 1, _d: 0 }]
  });
  window.__fs.mtime = Date.now() + 60000;   // plik "zmieniony poza kartą"
  window.__fs.perm = 'prompt';
});
const reconnected = await tr.evaluate(() => TB.store.reconnect());
await tr.waitForTimeout(500);
ok(reconnected === true, 'reconnect() odnowił uprawnienie');
ok(await tr.locator('#tb-notices .tb-banner-danger').count() === 1,
  'pokazał się pasek konfliktu');
const cActions = await tr.locator('#tb-notices .tb-banner-danger button').allTextContents();
ok(cActions.length === 3, 'pasek konfliktu daje 3 wyjścia', JSON.stringify(cActions));
ok((await tr.locator('.tb-table tbody tr').count()) === 3,
  'przed decyzją dane NIE zostały nadpisane');
await tr.locator('#tb-notices .tb-banner-danger button', { hasText: 'Wczytaj z pliku' }).click();
await tr.waitForTimeout(700);
const afterLoad = await tr.locator('.tb-table tbody tr').count();
ok(afterLoad === 1, 'po wyborze „Wczytaj z pliku" jest 1 rekord z pliku', 'wierszy: ' + afterLoad);
ok((await tr.locator('.tb-table tbody tr').first().textContent()).includes('Z PLIKU'),
  'to jest właśnie rekord z pliku');

/* ---------------------------------------- eksport xlsx przez realną ścieżkę */
section('FAZA 8 — eksport .xlsx przez interfejs');
await tr.evaluate(() => {
  window.__xlsx = null;
  window.showSaveFilePicker = async (o) => ({
    name: (o && o.suggestedName) || 'x.xlsx',
    createWritable: async () => ({
      write: async (d) => {
        const buf = d instanceof Blob ? await d.arrayBuffer() : d;
        window.__xlsx = Array.from(new Uint8Array(buf));
      },
      close: async () => {}
    })
  });
});
await tr.locator('.tb-toolbar button', { hasText: 'Eksport' }).click();
await tr.waitForSelector('.tb-menu');
const expItems = await tr.locator('.tb-menu .tb-menu-item').allTextContents();
ok(expItems.length >= 5, 'menu eksportu ma wszystkie zakresy', JSON.stringify(expItems));
ok(expItems.some(t => t.includes('Cały tracker')), 'jest zakres „cały tracker — arkusz na zbiór"');
await tr.locator('.tb-menu .tb-menu-item', { hasText: 'Aktualny widok' }).click();
await tr.waitForTimeout(800);
const bytes = await tr.evaluate(() => window.__xlsx);
ok(Array.isArray(bytes) && bytes.length > 1000, 'eksport wyprodukował plik',
  bytes ? bytes.length + ' B' : 'brak');
if (bytes) writeFileSync(OUT + '/export-view.xlsx', Buffer.from(bytes));

/* cały tracker — wiele arkuszy */
await tr.locator('.tb-toolbar button', { hasText: 'Eksport' }).click();
await tr.waitForSelector('.tb-menu');
await tr.locator('.tb-menu .tb-menu-item', { hasText: 'Cały tracker' }).click();
await tr.waitForTimeout(800);
const bytesAll = await tr.evaluate(() => window.__xlsx);
if (bytesAll) writeFileSync(OUT + '/export-all.xlsx', Buffer.from(bytesAll));
ok(Array.isArray(bytesAll) && bytesAll.length > 1000, 'eksport całego trackera wyprodukował plik');

await tr.close();

/* ---------------------------------------- brama przeglądarki */
section('FAZA 9 — brama przeglądarki');
const ctx2 = await browser.newContext();
await ctx2.addInitScript('delete window.showSaveFilePicker;');
const g = await ctx2.newPage();
watch(g, 'gate');
await g.goto('file://' + OUT + '/tracker.html');
await g.waitForTimeout(500);
ok(await g.locator('.tb-gate').count() === 1, 'bez File System Access pokazuje się brama');
const gateText = await g.locator('.tb-gate p').textContent();
ok(/Chrome|Edge/.test(gateText), 'brama mówi wprost, czego użyć', gateText.slice(0, 60));
ok(await g.locator('#tb-nav a').count() === 0, 'brama nie uruchamia trackera w tle');
await g.close();
await ctx2.close();

section('Błędy konsoli');
if (errors.length) errors.forEach(e => console.log('  ! ' + e));
ok(errors.length === 0, 'zero błędów w konsoli', errors.length + ' błędów');

console.log('\n' + '='.repeat(60));
console.log('CZĘŚĆ 2: zaliczone ' + pass + ', nieudane ' + fail);
if (fails.length) { console.log('Nieudane:'); fails.forEach(f => console.log('  - ' + f)); }
await browser.close();
process.exit(fail ? 1 : 0);
