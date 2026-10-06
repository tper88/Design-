/* Część 6: presety zakładek i edytor chipów szybkiego filtra. */
import pw from '/opt/node-tools/node_modules/playwright/index.js';
const { chromium } = pw;
import { writeFileSync, mkdirSync } from 'node:fs';
const ROOT = '/home/user/Design-';
const OUT = '/tmp/claude-0/e2e6';
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

async function openWizard(template) {
  const wz = await ctx.newPage();
  watch(wz, 'wizard');
  await wz.goto('file://' + ROOT + '/dist/tracker-wizard.html');
  await wz.waitForSelector('#wz-start-cards .wz-tile');
  await wz.locator('.wz-tile', { hasText: template }).first().click();
  await wz.waitForSelector('#wz-step-1:not([hidden])');
  await wz.locator('#wz-rail a', { hasText: 'Tabs' }).click();
  await wz.waitForSelector('#wz-step-3:not([hidden])');
  return wz;
}
const addPreset = (wz, v) => wz.locator('#wz-step-3 [data-preset="' + v + '"]').click();
const lastTab = wz => wz.evaluate(() => { const t = TBWizard.state.cfg.tabs; return t[t.length - 1]; });

/* ---------------------------------------- */
section('FAZA 25 — kafelki presetów w kroku Tabs');
const wz = await openWizard('Request log');
const presetCount = await wz.locator('#wz-step-3 .wz-preset').count();
ok(presetCount === 7, 'krok Tabs pokazuje 7 typów zakładek', 'było ' + presetCount);
ok(await wz.locator('#wz-step-3 .wz-preset:disabled').count() === 0,
  'przy zbiorze z datami żaden preset nie jest wyłączony');
ok(await wz.locator('#wz-step-3 button', { hasText: '+ Add tab' }).count() === 0,
  'stary pusty przycisk „+ Add tab” zniknął');

/* ---------------------------------------- */
section('FAZA 26 — każdy preset buduje zakładkę dopasowaną do kolumn');
const ids = await wz.evaluate(() => {
  const ds = TBWizard.state.cfg.datasets[0];
  const col = n => ds.columns.find(c => c.label === n).id;
  return { ds: ds.id, recv: col('Received'), due: col('Due'), stat: col('Status'),
           own: col('Owner'), subj: col('Subject'), res: col('Resolution') };
});
const before = await wz.evaluate(() => TBWizard.state.cfg.tabs.length);

await addPreset(wz, 'summary');
await wz.waitForTimeout(150);
let t = await lastTab(wz);
ok(t.label === 'Summary 2', 'etykieta nie dubluje istniejącej zakładki', t.label);
ok(await wz.locator('.toast', { hasText: 'Added “Summary 2”' }).count() >= 1,
  'toast mówi, co dodano');
const sType = t.components.map(c => c.type + (c.opts.kind ? ':' + c.opts.kind : ''));
ok(sType.includes('chart:bar') && sType.includes('chart:donut') && sType.includes('kpi'),
  'Summary: KPI + wykres w czasie + donut', sType.join(','));
const bar = t.components.find(c => c.opts.kind === 'bar');
ok(bar.agg.groupBy.field === ids.recv,
  'oś czasu idzie po dacie wpływu, nie po terminie', bar.agg.groupBy.field);
const donut = t.components.find(c => c.opts.kind === 'donut');
ok(donut.agg.groupBy.field === ids.stat, 'donut grupuje po kolumnie z listą (Status)');
const kOver = t.components.find(c => c.title === 'Overdue');
ok(kOver && kOver.agg.filter.rules.some(r => r.cmp === 'relDate' && r.field === ids.due) &&
   kOver.agg.filter.rules.some(r => r.cmp === 'ne' && r.value === 'done'),
  'KPI Overdue: termin minął i nie zamknięte');
ok(t.components.some(c => c.type === 'banner' && c.span === 'full'),
  'baner z liczbą otwartych na całą szerokość');

await addPreset(wz, 'query');
await wz.waitForTimeout(150);
t = await lastTab(wz);
const tbl = t.components[0];
ok(t.components.length === 1 && tbl.type === 'table', 'Query: jedna tabela');
const chips = tbl.opts.quickFilters.map(q => q.label);
ok(JSON.stringify(chips) === JSON.stringify(['Open', 'Overdue', 'Due this week', 'Mine']),
  'Query: chipy Open / Overdue / Due this week / Mine', chips.join(','));
const acts = tbl.opts.contextMenu.actions.map(a => a.label);
ok(acts.includes('Mark as closed') && acts.includes('Due today') && acts.includes('Assign to me'),
  'Query: akcje pod prawym przyciskiem dobrane z kolumn', acts.join(','));
ok(!tbl.opts.columns.includes(ids.res), 'długi tekst nie trafia do kolumn tabeli');
ok(tbl.opts.contextMenu.actions.find(a => a.label === 'Assign to me').value === '@user',
  '„Assign to me” wstawia @user');

await addPreset(wz, 'agenda');
await wz.waitForTimeout(150);
t = await lastTab(wz);
const ag = t.components.find(c => c.type === 'agenda');
ok(ag && ag.opts.sources[0].dateField === ids.due, 'Agenda bierze kolumnę terminu (Due)');
ok(ag.opts.sources[0].toneField === ids.stat && ag.opts.sources[0].metaField === ids.own,
  'Agenda: kropka z listy Status, podpis z Owner');

for (const v of ['notes', 'checklist', 'todo']) { await addPreset(wz, v); await wz.waitForTimeout(80); }
const tail = await wz.evaluate(() => TBWizard.state.cfg.tabs.slice(-3));
ok(tail[0].components[0].type === 'notes', 'Notes: tablica karteczek');
ok(tail[1].components[0].type === 'checklist' && tail[1].components[0].opts.resetDaily === true,
  'Checklist: rutyna czyszczona codziennie');
ok(tail[2].components[0].opts.resetDaily === false && tail[2].components[0].opts.showDue === true &&
   tail[2].components[1].type === 'notes', 'To-do: jednorazowe z terminami + notatki obok');

const allIds = await wz.evaluate(() => {
  const s = new Set(); let dup = 0;
  TBWizard.state.cfg.tabs.forEach(t => { [t.id].concat(t.components.map(c => c.id)).forEach(i => {
    if (s.has(i)) dup++; s.add(i); }); });
  return dup;
});
ok(allIds === 0, 'wszystkie id zakładek i komponentów są unikalne');
ok(await wz.locator('#wz-step-3 .wz-row').count() === before + 6, 'lista zakładek pokazuje 6 nowych');
const problems = await wz.evaluate(() => TBWizard.validate());
ok(problems.length === 0, 'walidacja przechodzi bez uwag', problems.join(' | '));

/* filtry w presetach nie mogą dzielić obiektów — edycja jednego zmieniłaby drugi */
const shared = await wz.evaluate(() => {
  const tabs = TBWizard.state.cfg.tabs;
  const q = tabs[tabs.length - 5].components[0].opts.quickFilters;
  q[0].filter.rules[0].value = 'XXX';
  const leak = JSON.stringify(tabs).split('"XXX"').length - 1;
  q[0].filter.rules[0].value = 'done';
  return leak;
});
ok(shared === 1, 'filtry presetów to niezależne kopie', 'wystąpień: ' + shared);

/* ---------------------------------------- */
section('FAZA 27 — edytor chipów szybkiego filtra');
await wz.locator('#wz-step-3 .wz-row').nth(before + 1).locator('.wz-mini').first().click();
await wz.waitForSelector('#wz-step-4:not([hidden])');
await wz.locator('#wz-step-4 .wz-row-main', { hasText: 'Requests' }).first().click();
await wz.waitForSelector('.wz-quickfilters');
let chipRows = await wz.locator('.wz-quickfilters > .wz-row').count();
ok(chipRows === 4, 'edytor pokazuje 4 chipy z presetu', 'było ' + chipRows);
await wz.locator('.wz-quickfilters > .wz-row').nth(3).locator('> .wz-row-actions .wz-mini').click();
await wz.waitForTimeout(150);
chipRows = await wz.locator('.wz-quickfilters > .wz-row').count();
ok(chipRows === 3, 'chip da się usunąć', 'było ' + chipRows);
await wz.locator('.wz-quickfilters button', { hasText: '+ Add a chip' }).click();
await wz.waitForTimeout(150);
let p2 = await wz.evaluate(() => TBWizard.validate());
ok(p2.some(x => /Quick filter .* has no conditions/.test(x)),
  'chip bez warunków jest zgłaszany w walidacji', p2.join(' | '));
await wz.locator('.wz-quickfilters > .wz-row').nth(3).locator('input').first().fill('Big ones');
await wz.locator('.wz-quickfilters > .wz-row').nth(3).locator('input').first().blur();
await wz.locator('.wz-quickfilters > .wz-row').nth(3).locator('button', { hasText: '+ Add condition' }).click();
await wz.waitForTimeout(150);
p2 = await wz.evaluate(() => TBWizard.validate());
ok(p2.length === 0, 'po dodaniu warunku walidacja znów czysta', p2.join(' | '));
const q4 = await wz.evaluate(() => {
  const tabs = TBWizard.state.cfg.tabs;
  return tabs[tabs.length - 5].components[0].opts.quickFilters[3];
});
ok(q4.label === 'Big ones' && q4.filter.rules.length === 1, 'nowy chip ma etykietę i warunek');

/* ---------------------------------------- */
section('FAZA 28 — zbiór bez dat: Agenda wyłączona, reszta działa');
const wb = await openWizard('Blank tracker');
ok(await wb.locator('#wz-step-3 [data-preset="agenda"]').isDisabled(),
  'Agenda wyłączona, gdy żaden zbiór nie ma kolumny dat');
ok((await wb.locator('#wz-step-3 [data-preset="agenda"] small').textContent()).includes('date column'),
  'kafelek mówi, czego brakuje');
await addPreset(wb, 'summary');
await wb.waitForTimeout(150);
const bs = await lastTab(wb);
ok(bs.components.length === 1 && bs.components[0].type === 'kpi',
  'Summary na gołym zbiorze: sam licznik, bez zgadywania', bs.components.map(c => c.type).join(','));
await addPreset(wb, 'query');
await wb.waitForTimeout(150);
const bq = (await lastTab(wb)).components[0];
ok(bq.opts.quickFilters.length === 0 && bq.opts.contextMenu.actions.length === 0,
  'Query na gołym zbiorze: bez chipów i akcji, których nie ma z czego zbudować');

/* drugi zbiór z datą — selektor zbioru i fallback agendy */
await wb.evaluate(() => {
  const cfg = TBWizard.state.cfg;
  cfg.datasets.push({ id: 'ds_ev', name: 'Events', titleField: 'c_evn', columns: [
    { id: 'c_evn', label: 'Event', type: 'text' },
    { id: 'c_evd', label: 'Deadline', type: 'date' }] });
});
await wb.locator('#wz-rail a', { hasText: 'Data' }).click();
await wb.locator('#wz-rail a', { hasText: 'Tabs' }).click();
await wb.waitForSelector('#wz-step-3:not([hidden])');
ok(await wb.locator('#wz-step-3 label', { hasText: 'Built on dataset' }).count() === 1,
  'przy dwóch zbiorach pojawia się wybór zbioru');
ok(!(await wb.locator('#wz-step-3 [data-preset="agenda"]').isDisabled()), 'Agenda się włącza');
await addPreset(wb, 'agenda');
await wb.waitForTimeout(150);
const ba = (await lastTab(wb)).components[0];
ok(ba.opts.sources[0].dataset === 'ds_ev' && ba.opts.sources[0].dateField === 'c_evd',
  'Agenda sięga po zbiór, który ma daty');

/* ---------------------------------------- */
section('FAZA 29 — zakładki z presetów działają w trackerze');
const html = await wz.evaluate(() => TBWizard.emit(TBWizard.state.cfg, false));
writeFileSync(OUT + '/tracker.html', html);
const tr = await ctx.newPage();
watch(tr, 'tracker');
await tr.goto('file://' + OUT + '/tracker.html');
await tr.waitForSelector('#tb-nav a');
const nav = await tr.locator('#tb-nav a').allTextContents();
ok(['Summary 2', 'Query', 'Agenda', 'Notes 2', 'Checklist', 'To-do'].every(n => nav.some(x => x.includes(n))),
  'wszystkie zakładki z presetów są w nawigacji', nav.join(' | '));

await tr.evaluate((o) => {
  const ds = TB.config().datasets[0];
  const iso = d => { const x = new Date(); x.setDate(x.getDate() + d); return x.toISOString().slice(0, 10); };
  const mk = (i, recv, due, stat) => {
    const d = {};
    d[o.subj] = 'Item ' + i; d[o.recv] = recv; d[o.due] = due; d[o.stat] = stat; d[o.own] = 'X';
    return { id: 'r_p' + i, ds: ds.id, data: d, _c: Date.now(), _m: Date.now(), _d: 0 };
  };
  TB.store.putRecord(mk(1, iso(-40), iso(-3), 'new'));   // po terminie, otwarte
  TB.store.putRecord(mk(2, iso(-10), iso(2), 'wip'));    // w tym tygodniu
  TB.store.putRecord(mk(3, iso(-5), iso(-1), 'done'));   // po terminie, ale zamknięte
}, ids);
await tr.waitForTimeout(500);

await tr.locator('#tb-nav a', { hasText: 'Summary 2' }).click();
await tr.waitForTimeout(400);
const sPanel = tr.locator('#tb-panels > section:not([hidden])');
const kAll = await sPanel.locator('.card', { hasText: 'All requests' }).locator('.kpi-v').textContent();
const kOv = await sPanel.locator('.card', { hasText: 'Overdue' }).locator('.kpi-v').textContent();
ok(kAll.trim() === '3' && kOv.trim() === '1', 'Summary liczy: 3 wszystkie, 1 po terminie',
  kAll + ' / ' + kOv);
ok(await sPanel.locator('svg').count() >= 2, 'oba wykresy się rysują');

await tr.locator('#tb-nav a', { hasText: 'Query' }).click();
await tr.waitForTimeout(300);
const qPanel = tr.locator('#tb-panels > section:not([hidden])');
ok(await qPanel.locator('.tb-table tbody tr').count() === 3, 'Query pokazuje 3 wiersze');
await qPanel.locator('.tb-chip-btn', { hasText: 'Overdue' }).click();
await tr.waitForTimeout(400);
ok(await qPanel.locator('.tb-table tbody tr').count() === 1, 'chip Overdue zostawia 1 wiersz');
await qPanel.locator('.tb-chip-btn', { hasText: 'Overdue' }).click();
await qPanel.locator('.tb-chip-btn', { hasText: 'Due this week' }).click();
await tr.waitForTimeout(400);
ok(await qPanel.locator('.tb-table tbody tr').count() === 1, 'chip Due this week zostawia 1 wiersz');
ok(await qPanel.locator('.tb-chip-btn', { hasText: 'Big ones' }).count() === 1,
  'chip dodany ręcznie w kreatorze też jest');

await tr.locator('#tb-nav a', { hasText: 'Agenda' }).click();
await tr.waitForTimeout(300);
const aPanel = tr.locator('#tb-panels > section:not([hidden])');
const items = await aPanel.locator('.tb-agenda-item').count();
ok(items === 2, 'Agenda: 2 otwarte terminy (zamknięte odfiltrowane)', 'było ' + items);

await tr.locator('#tb-nav a', { hasText: 'To-do' }).click();
await tr.waitForTimeout(300);
const dPanel = tr.locator('#tb-panels > section:not([hidden])');
ok(await dPanel.locator('.tb-grid-main, .tb-grid-2').count() >= 1, 'To-do ma układ dwukolumnowy');

/* ---------------------------------------- */
section('Błędy konsoli');
ok(errors.length === 0, 'zero błędów w konsoli', errors.join('\n'));

await browser.close();
console.log('\n' + '='.repeat(60));
console.log('CZĘŚĆ 6: zaliczone ' + pass + ', nieudane ' + fail);
if (fail) { console.log('Nieudane:\n - ' + fails.join('\n - ')); process.exit(1); }
