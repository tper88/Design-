/* Część 7: wklejanie z Excela naprawdę — Ctrl+V przez schowek przeglądarki,
   format liczb i dat zależny od locale, wklejka bez nagłówka, typy w kreatorze. */
import pw from '/opt/node-tools/node_modules/playwright/index.js';
const { chromium } = pw;
import { writeFileSync, mkdirSync } from 'node:fs';
const ROOT = '/home/user/Design-';
const OUT = '/tmp/claude-0/e2e7';
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
await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);

/* Kreator: szablon Request log + kolumny Amount (liczba) i Urgent (tak/nie). */
const wz = await ctx.newPage();
watch(wz, 'wizard');
await wz.goto('file://' + ROOT + '/dist/tracker-wizard.html');
await wz.waitForSelector('#wz-start-cards .wz-tile');
await wz.locator('.wz-tile', { hasText: 'Request log' }).first().click();
await wz.waitForSelector('#wz-step-1:not([hidden])');
await wz.evaluate(() => {
  const ds = TBWizard.state.cfg.datasets[0];
  ds.columns.push({ id: 'c_amt', label: 'Amount', type: 'number', format: 'currency' });
  ds.columns.push({ id: 'c_urg', label: 'Urgent', type: 'bool' });
});

async function trackerFor(locale) {
  const html = await wz.evaluate((l) => {
    TBWizard.state.cfg.meta.locale = l;
    TBWizard.state.cfg.meta.trackerId = 'trk_paste_' + l.replace('-', '');
    return TBWizard.emit(TBWizard.state.cfg, false);
  }, locale);
  const file = OUT + '/tracker-' + locale + '.html';
  writeFileSync(file, html);
  const tr = await ctx.newPage();
  watch(tr, 'tracker ' + locale);
  await tr.goto('file://' + file);
  await tr.waitForSelector('#tb-nav a');
  await tr.locator('#tb-nav a', { hasText: 'Log' }).click();
  await tr.waitForTimeout(300);
  return tr;
}

/* Prawdziwe Ctrl+V: tekst trafia do schowka systemowego, potem skrót
   klawiszowy — przeglądarka sama odpala zdarzenie paste. */
async function pasteViaClipboard(tr, text) {
  await tr.evaluate(t => navigator.clipboard.writeText(t), text);
  await tr.locator('#tb-title').click();          // fokus poza polami edycji
  await tr.keyboard.press('Control+V');
  await tr.waitForTimeout(400);
}

async function records(tr) {
  return tr.evaluate(() => {
    const ds = TB.config().datasets[0];
    const col = {}; ds.columns.forEach(c => { col[c.id] = c.label; });
    return Object.values(TB.data.index).filter(r => r.ds === ds.id && !r._d).map(r => {
      const o = {}; Object.keys(r.data).forEach(k => { o[col[k] || k] = r.data[k]; }); return o;
    });
  });
}
const find = (rows, subj) => rows.find(r => r.Subject === subj) || {};

/* Tak wygląda schowek po Ctrl+C w Excelu: tabulatory, CRLF między wierszami,
   komórka z nową linią w cudzysłowie (z LF w środku), CRLF na końcu.
   Kolejność kolumn celowo INNA niż w tabeli — dopasowanie idzie po nazwach. */
const EXCEL_GB =
  'Subject\tRequested by\tReceived\tDue\tStatus\tAmount\tUrgent\r\n' +
  'Monitor 24"\tAnna Kowalska\t06/10/2026\t13/10/2026\tIn progress\t1,234.56\tTRUE\r\n' +
  '"Line one\nline two"\tPeter Novak\t01/02/2026\t03/02/2026\tNew\t£99.00\tFALSE\r\n' +
  'Report access\tMaria Wisniewska\t5/3/26\t\tClosed\t(50.00)\t\r\n';

/* ---------------------------------------- */
section('FAZA 30 — Ctrl+V z Excela (en-GB), z nagłówkiem');
const gb = await trackerFor('en-GB');
await pasteViaClipboard(gb, EXCEL_GB);
ok(await gb.locator('dialog.tb-modal[open]').count() === 1, 'Ctrl+V na zakładce z tabelą otwiera import');
const banner = await gb.locator('dialog.tb-modal .tb-banner-title').textContent();
ok(/3 rows ready/.test(banner), 'rozpoznane 3 wiersze danych (nagłówek nie liczy się jako wiersz)', banner);
const mapped = await gb.evaluate(() => {
  const ds = TB.config().datasets[0];
  return [...document.querySelectorAll('dialog.tb-modal select')].map(s => {
    const c = ds.columns.find(x => x.id === s.value); return c ? c.label : '';
  });
});
ok(JSON.stringify(mapped) === JSON.stringify(['Subject', 'Requested by', 'Received', 'Due', 'Status', 'Amount', 'Urgent']),
  'kolumny dopasowane po nazwach mimo innej kolejności', mapped.join(','));
ok(/e\.g\. “Monitor 24"”/.test(await gb.locator('dialog.tb-modal label').first().textContent()),
  'przy kolumnie widać przykładową wartość');
await gb.locator('dialog.tb-modal button', { hasText: 'Import 3 rows' }).click();
await gb.waitForTimeout(500);
const toastGB = await gb.locator('.toast').textContent();
ok(/Imported 3 rows$/.test(toastGB.trim()), 'import bez ostrzeżeń o typach', toastGB);
let rows = await records(gb);
const m24 = find(rows, 'Monitor 24"');
ok(m24.Received === '2026-10-06', 'en-GB: 06/10/2026 to 6 października', m24.Received);
ok(m24.Due === '2026-10-13', 'en-GB: 13/10/2026 to 13 października', m24.Due);
ok(m24.Amount === 1234.56, 'en-GB: 1,234.56 to 1234.56 (nie 1.234)', m24.Amount);
ok(m24.Urgent === true && m24.Status === 'wip', 'TRUE → tak; „In progress” → wartość listy', m24.Urgent + ' ' + m24.Status);
const ml = find(rows, 'Line one\nline two');
ok(ml.Subject === 'Line one\nline two', 'komórka wieloliniowa przeszła w całości');
ok(ml.Amount === 99 && ml.Urgent === false && ml.Received === '2026-02-01', '£99.00 → 99, FALSE → nie, 01/02 → 1 lutego',
  ml.Amount + ' ' + ml.Urgent + ' ' + ml.Received);
const ra = find(rows, 'Report access');
ok(ra.Amount === -50 && ra.Received === '2026-03-05', 'księgowe (50.00) → −50, 5/3/26 → 5 marca 2026',
  ra.Amount + ' ' + ra.Received);
ok(ra.Due === undefined && ra.Urgent === undefined, 'puste komórki zostają puste');
ok(await gb.locator('.tb-table tbody tr').count() === 3, 'tabela pokazuje 3 wiersze');
ok(await gb.locator('.tb-table tbody td', { hasText: 'Monitor 24"' }).count() === 1,
  'cudzysłów w środku komórki nie połknął reszty wklejki');

/* ---------------------------------------- */
section('FAZA 31 — wklejka bez nagłówka idzie po pozycji kolumn tabeli');
/* tabela Log: Received, Subject, Requested by, Status, Due, Owner */
await pasteViaClipboard(gb, '07/10/2026\tPrinter jam\tTom Lewandowski\tNew\t09/10/2026\tAnna\r\n');
ok(await gb.locator('dialog.tb-modal[open]').count() === 1, 'okno importu otwarte');
const b2 = await gb.locator('dialog.tb-modal .tb-banner-text').textContent();
ok(/no header row/.test(b2), 'okno mówi, że dopasowanie jest po pozycji', b2);
ok(/1 row ready/.test(await gb.locator('dialog.tb-modal .tb-banner-title').textContent()),
  'pierwszy wiersz NIE jest zjadany jako nagłówek');
await gb.locator('dialog.tb-modal button', { hasText: 'Import 1 rows' }).click();
await gb.waitForTimeout(500);
rows = await records(gb);
const pj = find(rows, 'Printer jam');
ok(pj.Received === '2026-10-07' && pj['Requested by'] === 'Tom Lewandowski' && pj.Status === 'new' &&
   pj.Due === '2026-10-09' && pj.Owner === 'Anna', 'wszystkie 6 pól trafiło na swoje miejsce', JSON.stringify(pj));

/* ---------------------------------------- */
section('FAZA 32 — gdzie Ctrl+V NIE przejmuje wklejania');
await gb.evaluate(t => navigator.clipboard.writeText(t), 'just text');
await gb.locator('.tb-search input').click();
await gb.keyboard.press('Control+V');
await gb.waitForTimeout(400);
ok(await gb.locator('dialog.tb-modal[open]').count() === 0, 'w polu wyszukiwania Ctrl+V wkleja tekst, nie importuje');
ok((await gb.locator('.tb-search input').inputValue()) === 'just text', 'tekst trafił do pola');
await gb.locator('.tb-search input').fill('');
await gb.waitForTimeout(400);
await gb.locator('#tb-nav a', { hasText: 'Notes' }).click();
await gb.waitForTimeout(300);
await pasteViaClipboard(gb, 'a\tb\r\n1\t2\r\n');
ok(await gb.locator('dialog.tb-modal[open]').count() === 0, 'na zakładce bez tabeli nic się nie dzieje');

/* ---------------------------------------- */
section('FAZA 33 — en-US: ta sama data znaczy co innego');
const us = await trackerFor('en-US');
await pasteViaClipboard(us,
  'Subject\tReceived\tAmount\r\nUS row\t06/10/2026\t$1,234.56\r\nUS row 2\t10/13/2026\t2,000\r\n');
await us.locator('dialog.tb-modal button', { hasText: 'Import 2 rows' }).click();
await us.waitForTimeout(500);
rows = await records(us);
ok(find(rows, 'US row').Received === '2026-06-10', 'en-US: 06/10/2026 to 10 czerwca', find(rows, 'US row').Received);
ok(find(rows, 'US row').Amount === 1234.56, 'en-US: $1,234.56 → 1234.56');
ok(find(rows, 'US row 2').Received === '2026-10-13' && find(rows, 'US row 2').Amount === 2000,
  'en-US: 10/13/2026 i 2,000 (tysiące)');

/* ---------------------------------------- */
section('FAZA 34 — pl-PL: przecinek, spacje tysięcy, PRAWDA/FAŁSZ');
const pl = await trackerFor('pl-PL');
await pasteViaClipboard(pl,
  'Subject\tReceived\tAmount\tUrgent\r\n' +
  'Wiersz PL\t06.10.2026\t1\u00a0234,56 zł\tPRAWDA\r\n' +
  'Wiersz PL 2\t2026-10-07\t12,5\tFAŁSZ\r\n' +
  'Zły wiersz\t32.13.2026\tabc\tmoże\r\n');
await pl.locator('dialog.tb-modal button', { hasText: 'Import 3 rows' }).click();
await pl.waitForTimeout(500);
const toastPL = await pl.locator('.toast').textContent();
ok(/3 values did not match/.test(toastPL), 'nieczytelne wartości są zgłaszane, a nie zerowane', toastPL);
rows = await records(pl);
const p1 = find(rows, 'Wiersz PL');
ok(p1.Received === '2026-10-06' && p1.Amount === 1234.56 && p1.Urgent === true,
  'pl-PL: 06.10.2026, „1 234,56 zł”, PRAWDA', JSON.stringify(p1));
const p2 = find(rows, 'Wiersz PL 2');
ok(p2.Amount === 12.5 && p2.Urgent === false, 'pl-PL: 12,5 i FAŁSZ', JSON.stringify(p2));
const p3 = find(rows, 'Zły wiersz');
ok(p3.Received === '32.13.2026' && p3.Amount === 'abc' && p3.Urgent === 'może',
  'surowe wartości zostają w rekordzie do poprawienia', JSON.stringify(p3));
await pl.locator('#tb-nav a', { hasText: 'Log' }).click();
await pl.waitForTimeout(300);
ok(await pl.locator('.tb-table tbody tr', { hasText: 'Zły wiersz' }).locator('td.tb-cell-warn').count() >= 1,
  'zła komórka jest oznaczona w tabeli (tb-cell-warn)');

/* ---------------------------------------- */
section('FAZA 35 — kreator: typy kolumn z prawdziwej wklejki');
const wz2 = await ctx.newPage();
watch(wz2, 'wizard2');
await wz2.goto('file://' + ROOT + '/dist/tracker-wizard.html');
await wz2.waitForSelector('#wz-start-cards .wz-tile');
await wz2.locator('.wz-tile', { hasText: 'Blank tracker' }).first().click();
await wz2.waitForSelector('#wz-step-1:not([hidden])');
await wz2.locator('#wz-rail a', { hasText: 'Data' }).click();
await wz2.waitForSelector('#wz-step-2:not([hidden])');
await wz2.locator('button', { hasText: 'Paste a header from Excel' }).click();
await wz2.waitForSelector('dialog.tb-modal textarea');
await wz2.locator('dialog.tb-modal textarea').fill(
  'Client\tValue\tOpened\tPaid\tPostcode\r\n' +
  'Nordic Ltd\t1,234.56\t06/10/2026\tTRUE\t12345\r\n' +
  'Baltic SA\t£12,750.00\t14/09/2026\tFALSE\t23456\r\n' +
  'Vistula LLP\t(9,300.25)\t30/08/2026\tTRUE\t34567\r\n' +
  'Oder plc\t500\t1/7/26\tFALSE\t45678\r\n');
await wz2.locator('dialog.tb-modal button', { hasText: 'Create columns' }).click();
await wz2.waitForTimeout(400);
const types = await wz2.evaluate(() => {
  const o = {}; TBWizard.state.cfg.datasets[0].columns.forEach(c => { o[c.label] = c.type; }); return o;
});
ok(types.Value === 'number', 'kwoty w formacie angielskim i z walutą → liczba', types.Value);
ok(types.Opened === 'date', 'daty d/m/r → data', types.Opened);
ok(types.Paid === 'bool', 'TRUE/FALSE → tak/nie', types.Paid);
ok(types.Postcode === 'number', '5-cyfrowe kody NIE są brane za serial daty', types.Postcode);
ok(types.Client === 'text', 'nazwy → tekst', types.Client);

/* ---------------------------------------- */
section('Błędy konsoli');
ok(errors.length === 0, 'zero błędów w konsoli', errors.join('\n'));

await browser.close();
console.log('\n' + '='.repeat(60));
console.log('CZĘŚĆ 7: zaliczone ' + pass + ', nieudane ' + fail);
if (fail) { console.log('Nieudane:\n - ' + fails.join('\n - ')); process.exit(1); }
