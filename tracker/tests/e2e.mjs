/* Testy end-to-end kreatora i trackera. Uruchomienie:
   node tracker/tests/e2e.mjs
   Wymaga: python3 tracker/build-themes.py && python3 tracker/build-wizard.py */
import pw from '/opt/node-tools/node_modules/playwright/index.js';
const { chromium } = pw;
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';

const ROOT = '/home/user/Design-';
const OUT = '/tmp/claude-0/e2e';
mkdirSync(OUT, { recursive: true });

let pass = 0, fail = 0;
const fails = [];
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; fails.push(label); console.log('  ✗ ' + label + (extra ? '  → ' + extra : '')); }
}
function section(t) { console.log('\n== ' + t); }

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });

/* Zbieranie błędów konsoli — asercja "console.error = 0" z planu */
const errors = [];
function watch(page, tag) {
  page.on('console', m => { if (m.type() === 'error') errors.push(tag + ': ' + m.text()); });
  page.on('pageerror', e => errors.push(tag + ' pageerror: ' + e.message));
}

/* ------------------------------------------------ FAZA 1: kreator */
section('FAZA 1 — kreator');
const wz = await ctx.newPage();
watch(wz, 'wizard');
await wz.goto('file://' + ROOT + '/dist/tracker-wizard.html');
await wz.waitForSelector('#wz-start-cards .wz-tile');

ok(await wz.locator('#wz-step-0').isVisible(), 'krok 0 widoczny na starcie');
ok((await wz.locator('#wz-start-cards .wz-tile').count()) === 3, '3 szablony do wyboru');
ok(await wz.locator('#wz-next').isDisabled(), '"Dalej" zablokowane, dopóki nie ma configu');

await wz.locator('.wz-tile', { hasText: 'Rejestr zapytań' }).first().click();
await wz.waitForSelector('#wz-step-1:not([hidden])');
ok(true, 'szablon wczytany, przeszedł do kroku 1');

const themeCount = await wz.locator('#wz-step-1 .wz-themes .wz-tile').count();
ok(themeCount === 5, 'krok 1 pokazuje 5 styli do wyboru', 'było ' + themeCount);

for (const step of [2, 3, 4, 5]) {
  await wz.locator('#wz-next').click();
  await wz.waitForSelector(`#wz-step-${step}:not([hidden])`);
}
ok(true, 'przejście przez wszystkie kroki do 5');

const problems = await wz.evaluate(() => TBWizard.validate());
ok(problems.length === 0, 'walidacja szablonu bez błędów', JSON.stringify(problems));

const cfg = await wz.evaluate(() => TBWizard.state.cfg);
ok(cfg.datasets.length === 1 && cfg.datasets[0].columns.length === 7,
  'szablon ma 1 zbiór i 7 kolumn');
ok(cfg.tabs.length === 4, 'szablon ma 4 zakładki', 'było ' + cfg.tabs.length);
const tableCmp = cfg.tabs.flatMap(t => t.components).find(c => c.type === 'table');
ok(tableCmp.opts.contextMenu.actions.length === 3,
  'tabela ma 3 własne akcje menu kontekstowego');
ok(cfg.meta.trackerId && cfg.meta.trackerId.startsWith('trk_'), 'trackerId wygenerowany');

const html = await wz.evaluate(() => TBWizard.emit(TBWizard.state.cfg, false));
writeFileSync(OUT + '/tracker.html', html);
const kb = Buffer.byteLength(html) / 1024;
ok(html.startsWith('<!doctype html>'), 'emitowany plik zaczyna się od doctype');
ok(!/<script\s[^>]*\ssrc=/.test(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '<script></script>')),
  'emitowany plik nie ma <script src=> (jest samodzielny)');
ok(!/<link\s[^>]*rel=["']stylesheet/.test(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '<script></script>')
   .replace(/<link[^>]*fonts\.googleapis[^>]*>/g, '')),
  'emitowany plik nie linkuje arkuszy stylów (poza opcjonalnymi fontami)');
console.log('  … rozmiar emitowanego trackera: ' + kb.toFixed(0) + ' KB');

/* escapowanie "<" w wyspie konfiguracji */
await wz.evaluate(() => {
  TBWizard.state.cfg.tabs[0].label = 'Zły </script><script>window.__PWNED=1</script>';
});
const evil = await wz.evaluate(() => TBWizard.emit(TBWizard.state.cfg, false));
ok(!evil.includes('</script><script>window.__PWNED'),
  'nazwa zakładki z </script> jest escapowana w wyspie configu');
ok(evil.includes('\\u003c/script'), 'escapowanie użyło \\u003c');
writeFileSync(OUT + '/evil.html', evil);

/* ------------------------------------------------ FAZA 2: wstrzyknięcie przez nazwę */
section('FAZA 2 — próba wstrzyknięcia skryptu przez nazwę zakładki');
const ev = await ctx.newPage();
watch(ev, 'evil');
await ev.goto('file://' + OUT + '/evil.html');
await ev.waitForTimeout(600);
ok(await ev.evaluate(() => !window.__PWNED), 'skrypt z nazwy zakładki NIE wykonał się');
ok(await ev.evaluate(() => !!document.getElementById('tb-nav')),
  'tracker z nieprzyjazną nazwą wciąż się renderuje');
await ev.close();

/* ------------------------------------------------ FAZA 3: tracker na file:// */
section('FAZA 3 — tracker, file://, bez połączenia z plikiem');
const tr = await ctx.newPage();
watch(tr, 'tracker');
await tr.goto('file://' + OUT + '/tracker.html');
await tr.waitForSelector('#tb-nav a');

ok(!(await tr.locator('.tb-gate').count()), 'brama przeglądarki NIE blokuje (Chromium ma FSA i IDB)');
const navN = await tr.locator('#tb-nav a').count();
ok(navN === 4, 'sidebar ma 4 zakładki', 'było ' + navN);
ok(await tr.locator('#tb-notices .tb-banner-warning').count() > 0,
  'jest ostrzeżenie, że dane nie są zapisywane do pliku');
ok(await tr.locator('#tb-save').getAttribute('data-state') === 'off',
  'wskaźnik zapisu w stanie "off"');
ok(await tr.locator('.tb-empty strong').first().isVisible(),
  'pusta tabela pokazuje stan pusty z podpowiedzią');

/* dodanie wiersza przez interfejs */
await tr.locator('#tb-nav a', { hasText: 'Rejestr' }).click();
await tr.locator('button', { hasText: '+ Dodaj wiersz' }).first().click();
await tr.waitForSelector('.tb-drawer.is-open');
ok(true, 'drawer dodawania wiersza otwarty');

/* walidacja: próba zapisu bez wymaganych pól */
await tr.locator('.tb-drawer-foot button', { hasText: 'Dodaj wiersz' }).click();
ok(await tr.locator('.tb-drawer .tb-err').count() > 0,
  'walidacja blokuje zapis i pokazuje komunikat przy wymaganym polu');

const inputs = tr.locator('.tb-drawer .tb-field input.tb-input');
await inputs.nth(0).fill('Anna Kowalska');
await inputs.nth(1).fill('Korekta faktury 9/2026');
await tr.locator('.tb-drawer-foot button', { hasText: 'Dodaj wiersz' }).click();
await tr.waitForSelector('.tb-drawer', { state: 'detached' });
let rows = await tr.locator('.tb-table tbody tr').count();
ok(rows === 1, 'wiersz dodany przez interfejs', 'wierszy: ' + rows);

/* dwa kolejne wiersze przez API, żeby mieć na czym liczyć */
await tr.evaluate(() => {
  const cfg = TB.config();
  const ds = cfg.datasets[0];
  const col = n => ds.columns.find(c => new RegExp(n, 'i').test(c.label)).id;
  const mk = (who, subj, kwota, stat, due) => {
    const d = {};
    d[col('Zgłaszający')] = who;
    d[col('Temat')] = subj;
    d[col('Wpłynęło')] = '2026-09-15';
    d[col('Termin')] = due;
    d[col('Status')] = stat;
    return { id: 'r_test_' + who.length + subj.length, ds: ds.id, data: d,
             _c: Date.now(), _m: Date.now(), _d: 0 };
  };
  TB.store.putRecord(mk('Piotr Nowak', 'Zapytanie o limit', 1200, 'wip', '2026-01-01'));
  TB.store.putRecord(mk('Maria Wiśniewska', 'Reklamacja dostawy', 800, 'done', '2026-12-31'));
});
await tr.waitForTimeout(250);
rows = await tr.locator('.tb-table tbody tr').count();
ok(rows === 3, 'łącznie 3 wiersze w tabeli', 'wierszy: ' + rows);

/* przeliczenie KPI bez reloadu */
await tr.locator('#tb-nav a', { hasText: 'Podsumowanie' }).click();
await tr.waitForTimeout(200);
const kpis = await tr.locator('#tb-panels .kpi-v').allTextContents();
ok(kpis.some(t => t.trim() === '3'), 'KPI „Wszystkie zapytania" pokazuje 3 bez reloadu',
  JSON.stringify(kpis));
const overdue = await tr.locator('.card', { hasText: 'Po terminie' }).locator('.kpi-v').textContent();
ok(overdue.trim() === '1', 'KPI „Po terminie" liczy 1 (termin 2026-01-01, status wip)',
  'było ' + overdue);
ok(await tr.locator('#tb-panels .tb-chart svg').count() >= 2, 'wykresy się wyrysowały');
ok(await tr.locator('#tb-panels .tb-banner-accent').count() >= 1, 'baner z wnioskiem obecny');

/* checklista i karteczka */
await tr.locator('#tb-nav a', { hasText: 'Terminy' }).click();
await tr.waitForTimeout(150);
ok(await tr.locator('.tb-agenda-item').count() >= 1, 'agenda pokazuje terminy z danych');
ok(await tr.locator('.tb-agenda-day.is-overdue').count() >= 1, 'agenda wyróżnia wpisy po terminie');
await tr.locator('.tb-check-add input').fill('Przegląd skrzynki');
await tr.locator('.tb-check-add input').press('Enter');
await tr.waitForTimeout(150);
ok(await tr.locator('.tb-check-item').count() === 1, 'pozycja checklisty dodana');
await tr.locator('.tb-check-item input.tb-check').check();
await tr.waitForTimeout(150);
ok(await tr.locator('.tb-check-item.is-done').count() === 1, 'pozycja odhaczona');

await tr.locator('#tb-nav a', { hasText: 'Notatki' }).click();
await tr.waitForTimeout(150);
await tr.locator('button', { hasText: '+ Dodaj karteczkę' }).click();
await tr.waitForTimeout(150);
const noteText = tr.locator('.tb-note .tb-note-text').first();
await noteText.click();
await noteText.type('Zadzwonić do Kowalskiego');
await tr.locator('#tb-title').click();   // blur = commit
await tr.waitForTimeout(250);
ok((await tr.locator('.tb-note .tb-note-text').first().textContent()).includes('Kowalskiego'),
  'karteczka zapisała treść');

/* ------------------------------------------------ FAZA 4: trwałość po reloadzie */
section('FAZA 4 — trwałość po przeładowaniu (IndexedDB)');
await tr.reload();
await tr.waitForSelector('#tb-nav a');
await tr.locator('#tb-nav a', { hasText: 'Rejestr' }).click();
await tr.waitForTimeout(300);
rows = await tr.locator('.tb-table tbody tr').count();
ok(rows === 3, '3 wiersze przetrwały reload', 'wierszy: ' + rows);
await tr.locator('#tb-nav a', { hasText: 'Terminy' }).click();
await tr.waitForTimeout(200);
ok(await tr.locator('.tb-check-item.is-done').count() === 1, 'stan checklisty przetrwał reload');
await tr.locator('#tb-nav a', { hasText: 'Notatki' }).click();
await tr.waitForTimeout(200);
ok((await tr.locator('.tb-note .tb-note-text').first().textContent() || '').includes('Kowalskiego'),
  'treść karteczki przetrwała reload');

await tr.close();
await wz.close();

/* ------------------------------------------------ podsumowanie częściowe */
section('Błędy konsoli');
if (errors.length) { errors.forEach(e => console.log('  ! ' + e)); }
ok(errors.length === 0, 'zero błędów w konsoli na wszystkich stronach',
  errors.length + ' błędów');

console.log('\n' + '='.repeat(60));
console.log('CZĘŚĆ 1: zaliczone ' + pass + ', nieudane ' + fail);
if (fails.length) { console.log('Nieudane:'); fails.forEach(f => console.log('  - ' + f)); }
writeFileSync(OUT + '/part1.json', JSON.stringify({ pass, fail, fails, errors }, null, 2));
await browser.close();
process.exit(fail ? 1 : 0);
