/* Część 4: wklejanie z Excela (tracker i kreator), szukanie, filtry szybkie,
   paginacja, karteczka przypięta do wiersza. */
import pw from '/opt/node-tools/node_modules/playwright/index.js';
const { chromium } = pw;
import { writeFileSync, mkdirSync } from 'node:fs';
const ROOT = '/home/user/Design-';
const OUT = '/tmp/claude-0/e2e4';
mkdirSync(OUT, { recursive: true });

let pass = 0, fail = 0; const fails = [];
function ok(c, l, e) { if (c) { pass++; console.log('  ✓ ' + l); } else { fail++; fails.push(l); console.log('  ✗ ' + l + (e ? '  → ' + e : '')); } }
function section(t) { console.log('\n== ' + t); }

const browser = await chromium.launch();
const errors = [];
function watch(p, tag) {
  p.on('console', m => { if (m.type()==='error') errors.push(tag+': '+m.text()); });
  p.on('pageerror', e => errors.push(tag+' pageerror: '+e.message));
}
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
const wz = await ctx.newPage();
watch(wz, 'wizard');
await wz.goto('file://' + ROOT + '/dist/tracker-wizard.html');
await wz.waitForSelector('#wz-start-cards .wz-tile');

/* ---- wklejanie nagłówka w kreatorze ---- */
section('FAZA 16 — kreator: wklejanie nagłówka z Excela');
await wz.locator('.wz-tile', { hasText: 'Pusty tracker' }).first().click();
await wz.waitForSelector('#wz-step-1:not([hidden])');
await wz.locator('#wz-rail a', { hasText: 'Dane' }).click();
await wz.waitForSelector('#wz-step-2:not([hidden])');
const colsBefore = await wz.evaluate(() => TBWizard.state.cfg.datasets[0].columns.length);
await wz.locator('button', { hasText: 'Wklej nagłówek z Excela' }).click();
await wz.waitForSelector('dialog.tb-modal textarea');
const TSV = [
  'Klient\tData\tKwota\tStatus\tPilne',
  'Nordic sp. z o.o.\t2026-09-28\t48200,50\tOtwarte\ttak',
  'Baltic SA\t2026-09-14\t12750,00\tZamknięte\tnie',
  'Vistula sp.j.\t2026-08-30\t9300,25\tOtwarte\ttak'
].join('\n');
await wz.locator('dialog.tb-modal textarea').fill(TSV);
await wz.locator('dialog.tb-modal button', { hasText: 'Utwórz kolumny' }).click();
await wz.waitForTimeout(400);
const cols = await wz.evaluate(() => TBWizard.state.cfg.datasets[0].columns);
ok(cols.length === colsBefore + 5, '5 kolumn utworzonych z nagłówka',
  colsBefore + ' → ' + cols.length);
const byLabel = {};
cols.forEach(c => { byLabel[c.label] = c.type; });
ok(byLabel['Data'] === 'date', 'typ „Data" rozpoznany jako data', byLabel['Data']);
ok(byLabel['Kwota'] === 'number', 'typ „Kwota" rozpoznany jako liczba (przecinek dziesiętny)', byLabel['Kwota']);
ok(byLabel['Klient'] === 'text', 'typ „Klient" rozpoznany jako tekst', byLabel['Klient']);
ok(byLabel['Pilne'] === 'bool', 'typ „Pilne" rozpoznany jako tak/nie', byLabel['Pilne']);
ok(byLabel['Status'] === 'enum', 'typ „Status" rozpoznany jako lista wyboru', byLabel['Status']);

/* ---- tracker z tego configu ---- */
section('FAZA 17 — tracker: wklejanie danych z Excela');
const html = await wz.evaluate(() => {
  /* kolumna enum bez opcji nie przeszłaby walidacji — dopisujemy je,
     tak jak zrobiłby to użytkownik w edytorze opcji */
  const ds = TBWizard.state.cfg.datasets[0];
  const st = ds.columns.find(c => c.label === 'Status');
  st.options = [{ value: 'Otwarte', label: 'Otwarte', tone: 'warning' },
                { value: 'Zamknięte', label: 'Zamknięte', tone: 'success' }];
  const tbl = TBWizard.state.cfg.tabs[0].components[0];
  tbl.opts.columns = ds.columns.map(c => c.id);
  tbl.opts.quickFilters = [{ label: 'Tylko otwarte',
    filter: { op: 'and', rules: [{ field: st.id, cmp: 'eq', value: 'Otwarte' }] } }];
  tbl.opts.pageSize = 10;
  return TBWizard.emit(TBWizard.state.cfg, false);
});
writeFileSync(OUT + '/tracker.html', html);
const tr = await ctx.newPage();
watch(tr, 'tracker');
await tr.goto('file://' + OUT + '/tracker.html');
await tr.waitForSelector('.tb-table');

await tr.locator('button', { hasText: 'Wklej z Excela' }).click();
await tr.waitForSelector('dialog.tb-modal textarea');
await tr.locator('dialog.tb-modal textarea').fill(TSV);
await tr.locator('dialog.tb-modal button', { hasText: 'Dalej' }).click();
await tr.waitForTimeout(400);
ok(await tr.locator('dialog.tb-modal select').count() === 5,
  'krok mapowania pokazuje 5 selectów (po jednym na kolumnę pliku)');
const mapped = await tr.evaluate(() =>
  [...document.querySelectorAll('dialog.tb-modal select')].filter(s => s.value).length);
ok(mapped === 5, 'kolumny dopasowały się automatycznie po nazwie', 'dopasowanych: ' + mapped);
await tr.locator('dialog.tb-modal button', { hasText: 'Wczytaj' }).click();
await tr.waitForTimeout(600);
let rows = await tr.locator('.tb-table tbody tr').count();
ok(rows === 3, '3 wiersze wczytane z wklejonego TSV', 'wierszy: ' + rows);
const cellText = await tr.locator('.tb-table tbody tr').first().locator('td').allTextContents();
/* pl-PL używa TWARDEJ spacji (U+00A0) jako separatora tysięcy — normalizujemy
   białe znaki, inaczej porównanie ze zwykłą spacją zawsze zawiedzie */
const flat = cellText.join(' ').replace(/\s/g, ' ');
ok(flat.includes('48 200,50'),
  'liczba z przecinkiem dziesiętnym wczytana i sformatowana (separator = NBSP)',
  JSON.stringify(cellText));
ok(cellText.join(' ').includes('28.09.2026'), 'data wczytana i sformatowana po polsku');
ok(await tr.locator('.tb-table tbody tr .tb-tag').count() >= 1,
  'wartość listy wyboru pokazuje się jako tag ze kolorem');

/* ---- szukanie i filtr szybki ---- */
section('FAZA 18 — szukanie, filtr szybki, paginacja');
await tr.locator('.tb-search input').fill('Baltic');
await tr.waitForTimeout(500);
rows = await tr.locator('.tb-table tbody tr').count();
ok(rows === 1, 'szukanie zawęża do 1 wiersza', 'wierszy: ' + rows);
await tr.locator('.tb-search input').fill('');
await tr.waitForTimeout(500);
await tr.locator('.tb-chip-btn', { hasText: 'Tylko otwarte' }).click();
await tr.waitForTimeout(400);
rows = await tr.locator('.tb-table tbody tr').count();
ok(rows === 2, 'filtr szybki „Tylko otwarte" daje 2 wiersze', 'wierszy: ' + rows);
ok(await tr.locator('.tb-chip-btn[aria-pressed="true"]').count() === 1,
  'aktywny filtr jest oznaczony');
await tr.locator('.tb-chip-btn', { hasText: 'Tylko otwarte' }).click();
await tr.waitForTimeout(400);

/* paginacja: dosypujemy 25 wierszy przy pageSize 10 */
await tr.evaluate(() => {
  const ds = TB.config().datasets[0];
  const c = ds.columns[0].id;
  for (let i = 0; i < 25; i++) {
    const d = {}; d[c] = 'Klient ' + i;
    TB.store.putRecord({ id: 'r_p' + i, ds: ds.id, data: d, _c: Date.now(), _m: Date.now(), _d: 0 });
  }
});
await tr.waitForTimeout(500);
rows = await tr.locator('.tb-table tbody tr').count();
ok(rows === 10, 'na stronie jest 10 wierszy przy pageSize 10', 'wierszy: ' + rows);
const pages = await tr.locator('.tb-pager .tb-pg').count();
ok(pages >= 4, 'paginacja pokazuje przyciski stron', 'przycisków: ' + pages);
await tr.locator('.tb-pager .tb-pg', { hasText: '3' }).first().click();
await tr.waitForTimeout(300);
ok(await tr.locator('.tb-pager .tb-pg[aria-current="page"]').count() === 1,
  'wybrana strona jest oznaczona jako aktualna');

/* ---- karteczka przypięta do wiersza ---- */
section('FAZA 19 — karteczka przypięta do wiersza');
await tr.locator('.tb-pager .tb-pg', { hasText: '1' }).first().click();
await tr.waitForTimeout(300);
await tr.locator('.tb-table tbody tr').first().click();
await tr.waitForSelector('.tb-drawer.is-open');
ok(await tr.locator('.tb-drawer').getByText('Karteczki do tego wiersza').count() === 1,
  'drawer ma sekcję karteczek wiersza');
const hasNotesCmp = await tr.evaluate(() =>
  TB.config().tabs.some(t => (t.components || []).some(c => c.type === 'notes')));
if (!hasNotesCmp) {
  await tr.locator('.tb-drawer button', { hasText: 'Przypnij karteczkę' }).click();
  await tr.waitForTimeout(300);
  ok(await tr.locator('.toast.show').count() === 1,
    'bez komponentu karteczek tracker MÓWI, że trzeba go dodać, zamiast milczeć');
} else {
  ok(true, '(szablon ma komponent karteczek — ścieżka ostrzeżenia nieaktywna)');
}
await tr.keyboard.press('Escape');
await tr.waitForTimeout(300);

/* teraz z komponentem karteczek */
const html2 = await wz.evaluate(() => {
  TBWizard.state.cfg.tabs.push({
    id: 'tab_notes', label: 'Notatki', icon: '🗒', preset: 'notes',
    layout: { cols: 1, variant: 'even' },
    components: [{ id: 'k_notes1', type: 'notes', title: 'Karteczki', col: 0, order: 10,
      span: 'full', opts: {} }]
  });
  TBWizard.state.cfg.rev++;
  return TBWizard.emit(TBWizard.state.cfg, false);
});
writeFileSync(OUT + '/tracker.html', html2);
await tr.reload();
await tr.waitForSelector('.tb-table tbody tr');
await tr.locator('.tb-table tbody tr').first().click();
await tr.waitForSelector('.tb-drawer.is-open');
await tr.locator('.tb-drawer button', { hasText: 'Przypnij karteczkę' }).click();
await tr.waitForTimeout(400);
ok(await tr.locator('.tb-drawer .tb-note').count() === 1, 'karteczka przypięta do wiersza');
const pin = tr.locator('.tb-drawer .tb-note .tb-note-text').first();
await pin.click();
await pin.type('Klient prosi o telefon przed wysyłką');
await tr.locator('.tb-drawer .tb-modal-title').click();
await tr.waitForTimeout(400);
await tr.keyboard.press('Escape');
await tr.waitForTimeout(400);

/* karteczka przypięta NIE powinna zaśmiecać tablicy karteczek */
await tr.locator('#tb-nav a', { hasText: 'Notatki' }).click();
await tr.waitForTimeout(400);
const boardNotes = await tr.locator('#tb-panels .tb-note').count();
ok(boardNotes === 0, 'przypięta karteczka nie pojawia się na ogólnej tablicy',
  'na tablicy: ' + boardNotes);

/* i wraca w drawerze tego samego wiersza po reloadzie */
await tr.reload();
await tr.waitForSelector('.tb-table tbody tr');
await tr.locator('.tb-table tbody tr').first().click();
await tr.waitForSelector('.tb-drawer.is-open');
await tr.waitForTimeout(300);
const pinText = await tr.locator('.tb-drawer .tb-note .tb-note-text').first().textContent();
ok((pinText || '').includes('telefon przed wysyłką'),
  'treść przypiętej karteczki przetrwała reload i wróciła przy swoim wierszu', pinText);

await tr.close(); await wz.close();
section('Błędy konsoli');
if (errors.length) errors.forEach(e => console.log('  ! ' + e));
ok(errors.length === 0, 'zero błędów w konsoli', errors.length + ' błędów');

console.log('\n' + '='.repeat(60));
console.log('CZĘŚĆ 4: zaliczone ' + pass + ', nieudane ' + fail);
if (fails.length) { console.log('Nieudane:'); fails.forEach(f => console.log('  - ' + f)); }
await browser.close();
process.exit(fail ? 1 : 0);
