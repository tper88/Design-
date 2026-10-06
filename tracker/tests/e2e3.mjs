/* Część 3: typowany eksport przez przeglądarkę, wiele arkuszy,
   przebudowa struktury z zachowaniem danych, 5 motywów, przełącznik stylu. */
import pw from '/opt/node-tools/node_modules/playwright/index.js';
const { chromium } = pw;
import { writeFileSync, mkdirSync } from 'node:fs';

const ROOT = '/home/user/Design-';
const OUT = '/tmp/claude-0/e2e3';
mkdirSync(OUT, { recursive: true });

let pass = 0, fail = 0; const fails = [];
function ok(c, l, e) { if (c) { pass++; console.log('  ✓ ' + l); } else { fail++; fails.push(l); console.log('  ✗ ' + l + (e ? '  → ' + e : '')); } }
function section(t) { console.log('\n== ' + t); }

const FAKE = `
window.__fs = { name:'d.json', content:'', mtime:0, perm:'granted', writes:0 };
window.__xlsx = null;
window.showSaveFilePicker = async (o) => {
  const isX = o && /\\.xlsx$/.test(o.suggestedName || '');
  return {
    name: (o && o.suggestedName) || 'f',
    queryPermission: async () => window.__fs.perm,
    requestPermission: async () => { window.__fs.perm='granted'; return 'granted'; },
    getFile: async () => ({ name:'d.json', lastModified: window.__fs.mtime,
                            text: async () => window.__fs.content }),
    createWritable: async () => ({
      write: async (d) => {
        if (isX) { const b = d instanceof Blob ? await d.arrayBuffer() : d;
                   window.__xlsx = Array.from(new Uint8Array(b)); }
        else { window.__fs.content = typeof d === 'string' ? d
                 : (d instanceof Blob ? await d.text() : new TextDecoder().decode(d));
               window.__fs.writes++; }
      },
      close: async () => { if (!isX) window.__fs.mtime = Date.now(); }
    })
  };
};`;

const browser = await chromium.launch();
const errors = [];
function watch(p, tag) {
  p.on('console', m => { if (m.type()==='error') errors.push(tag+': '+m.text()); });
  p.on('pageerror', e => errors.push(tag+' pageerror: '+e.message));
}

const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
await ctx.addInitScript(FAKE);

/* ---- kreator: config + tracker ---- */
section('FAZA 10 — przygotowanie');
const wz = await ctx.newPage();
watch(wz, 'wizard');
await wz.goto('file://' + ROOT + '/dist/tracker-wizard.html');
await wz.waitForSelector('#wz-start-cards .wz-tile');
await wz.locator('.wz-tile', { hasText: 'Request log' }).first().click();
await wz.waitForSelector('#wz-step-1:not([hidden])');

const cfgA = await wz.evaluate(() => TBWizard.state.cfg);
writeFileSync(OUT + '/struktura.tracker.json', JSON.stringify(cfgA, null, 2));
let html = await wz.evaluate(() => TBWizard.emit(TBWizard.state.cfg, false));
writeFileSync(OUT + '/tracker.html', html);
ok(true, 'tracker i plik struktury zapisane');
const trackerIdA = cfgA.meta.trackerId;

/* ---- dane z liczbami i datami ---- */
const tr = await ctx.newPage();
watch(tr, 'tracker');
await tr.goto('file://' + OUT + '/tracker.html');
await tr.waitForSelector('#tb-nav a');
const colIds = await tr.evaluate(() => {
  const ds = TB.config().datasets[0];
  const col = n => ds.columns.find(c => new RegExp(n, 'i').test(c.label)).id;
  const ids = { req: col('Requested by'), subj: col('Subject'), recv: col('Received'),
                due: col('Due'), stat: col('Status'), own: col('Owner'), res: col('Resolution') };
  const mk = (i, who, subj, recv, stat) => {
    const d = {};
    d[ids.req] = who; d[ids.subj] = subj; d[ids.recv] = recv;
    d[ids.due] = '2026-11-0' + i; d[ids.stat] = stat; d[ids.own] = 'Team ' + i;
    d[ids.res] = 'Rozwiązanie numer ' + i;
    return { id: 'r_x' + i, ds: ds.id, data: d, _c: Date.now(), _m: Date.now(), _d: 0 };
  };
  TB.store.putRecord(mk(1, 'Anna Kowalska', 'Korekta faktury', '2026-10-06', 'new'));
  TB.store.putRecord(mk(2, 'Piotr Nowak', 'Limit kredytowy', '2026-09-15', 'wip'));
  TB.store.putRecord(mk(3, 'Żaneta Śliwa', 'Reklamacja', '2026-08-20', 'done'));
  return ids;
});
await tr.waitForTimeout(300);
await tr.locator('#tb-nav a', { hasText: 'Log' }).click();
await tr.waitForSelector('.tb-table tbody tr');
ok((await tr.locator('.tb-table tbody tr').count()) === 3, '3 wiersze w tabeli');

/* ---- eksport typowany przez przeglądarkę ---- */
section('FAZA 11 — eksport typowany i wiele arkuszy');
await tr.locator('.tb-toolbar button', { hasText: 'Export' }).click();
await tr.waitForSelector('.tb-menu');
await tr.locator('.tb-menu .tb-menu-item', { hasText: 'Whole dataset' }).click();
await tr.waitForTimeout(900);
let bytes = await tr.evaluate(() => window.__xlsx);
ok(Array.isArray(bytes) && bytes.length > 1000, 'eksport zbioru wyprodukował plik');
writeFileSync(OUT + '/typed.xlsx', Buffer.from(bytes));

/* karteczka + checklista → eksport całego trackera ma dawać 3 arkusze */
await tr.locator('#tb-nav a', { hasText: 'Notes' }).click();
await tr.waitForTimeout(200);
await tr.locator('button', { hasText: '+ Add note' }).click();
await tr.waitForTimeout(200);
const nt = tr.locator('.tb-note .tb-note-text').first();
await nt.click(); await nt.type('Notatka testowa'); await tr.locator('#tb-title').click();
await tr.waitForTimeout(300);
await tr.locator('#tb-nav a', { hasText: 'Dates' }).click();
await tr.waitForTimeout(200);
await tr.locator('.tb-check-add input').fill('Pozycja checklisty');
await tr.locator('.tb-check-add input').press('Enter');
await tr.waitForTimeout(300);
await tr.locator('#tb-nav a', { hasText: 'Log' }).click();
await tr.waitForTimeout(250);
await tr.evaluate(() => { window.__xlsx = null; });
await tr.locator('.tb-toolbar button', { hasText: 'Export' }).click();
await tr.waitForSelector('.tb-menu');
await tr.locator('.tb-menu .tb-menu-item', { hasText: 'Everything' }).click();
await tr.waitForTimeout(900);
bytes = await tr.evaluate(() => window.__xlsx);
ok(Array.isArray(bytes) && bytes.length > 1000, 'eksport całego trackera wyprodukował plik');
writeFileSync(OUT + '/all.xlsx', Buffer.from(bytes));

/* ---- przebudowa struktury ---- */
section('FAZA 12 — przebudowa z zachowaniem danych');
await wz.locator('#wz-rail a', { hasText: 'Start' }).click();
await wz.waitForSelector('#wz-step-0:not([hidden])');
await wz.setInputFiles('#wz-cfg-file', OUT + '/struktura.tracker.json');
await wz.waitForSelector('#wz-step-1:not([hidden])');
const cfgLoaded = await wz.evaluate(() => TBWizard.state.cfg);
ok(cfgLoaded.meta.trackerId === trackerIdA, 'wczytany config zachował trackerId');
ok(cfgLoaded.rev === cfgA.rev + 1, 'wersja struktury podniesiona', cfgA.rev + ' → ' + cfgLoaded.rev);

/* usuń kolumnę "Opiekun", dodaj kolumnę "Priorytet" */
const removedColId = await wz.evaluate((ids) => {
  const ds = TBWizard.state.cfg.datasets[0];
  ds.columns = ds.columns.filter(c => c.id !== ids.own);
  ds.columns.push({ id: 'c_newprio', label: 'Priority', type: 'text' });
  TBWizard.state.cfg.tabs.forEach(t => (t.components || []).forEach(c => {
    if (c.opts && c.opts.columns) {
      c.opts.columns = c.opts.columns.filter(x => x !== ids.own).concat(['c_newprio']);
    }
    if (c.opts && c.opts.sources) c.opts.sources.forEach(s => { if (s.metaField === ids.own) s.metaField = null; });
    if (c.opts && c.opts.contextMenu) {
      c.opts.contextMenu.actions = c.opts.contextMenu.actions.filter(a => a.field !== ids.own);
    }
  }));
  return ids.own;
}, colIds);
const problems2 = await wz.evaluate(() => TBWizard.validate());
ok(problems2.length === 0, 'struktura po zmianach przechodzi walidację', JSON.stringify(problems2));
html = await wz.evaluate(() => TBWizard.emit(TBWizard.state.cfg, false));
writeFileSync(OUT + '/tracker.html', html);

await tr.reload();
await tr.waitForSelector('#tb-nav a');
await tr.waitForTimeout(400);
ok(await tr.locator('#tb-notices .tb-banner-accent').count() >= 1,
  'tracker informuje o zmianie struktury');
const noteTxt = await tr.locator('#tb-notices .tb-banner-accent .tb-banner-text').first().textContent();
ok(/\+1 columns/.test(noteTxt) && /1 columns \(data kept\)/.test(noteTxt),
  'komunikat wymienia +1 i −1 kolumnę', noteTxt);
await tr.locator('#tb-nav a', { hasText: 'Log' }).click();
await tr.waitForSelector('.tb-table tbody tr');
ok((await tr.locator('.tb-table tbody tr').count()) === 3, '3 wiersze przetrwały przebudowę');
let headers = await tr.locator('.tb-table thead th').allTextContents();
ok(headers.some(h => h.includes('PRIORITY')) || headers.some(h => /priority/i.test(h)),
  'nowa kolumna widoczna w tabeli', JSON.stringify(headers));
ok(!headers.some(h => /owner/i.test(h)), 'usunięta kolumna zniknęła z tabeli');
const orphanStillInRecord = await tr.evaluate((rid) => {
  const recs = TB.data.byDs[TB.config().datasets[0].id] || [];
  return recs.some(r => r.data[rid] != null);
}, removedColId);
ok(orphanStillInRecord, 'dane usuniętej kolumny NIE zostały wymazane z rekordów');

/* przywrócenie kolumny — dane mają wrócić */
section('FAZA 13 — przywrócenie kolumny przywraca dane');
await wz.evaluate((rid) => {
  const ds = TBWizard.state.cfg.datasets[0];
  ds.columns.push({ id: rid, label: 'Owner', type: 'text' });
  TBWizard.state.cfg.tabs.forEach(t => (t.components || []).forEach(c => {
    if (c.opts && c.opts.columns) c.opts.columns.push(rid);
  }));
  TBWizard.state.cfg.rev++;
}, removedColId);
html = await wz.evaluate(() => TBWizard.emit(TBWizard.state.cfg, false));
writeFileSync(OUT + '/tracker.html', html);
await tr.reload();
await tr.waitForSelector('#tb-nav a');
await tr.locator('#tb-nav a', { hasText: 'Log' }).click();
await tr.waitForSelector('.tb-table tbody tr');
headers = await tr.locator('.tb-table thead th').allTextContents();
ok(headers.some(h => /owner/i.test(h)), 'kolumna wróciła do tabeli');
const cellTexts = await tr.locator('.tb-table tbody tr').first().locator('td').allTextContents();
ok(cellTexts.some(t => /Team/.test(t)),
  'WARTOŚCI w przywróconej kolumnie wróciły', JSON.stringify(cellTexts));

await tr.close(); await wz.close(); await ctx.close();

/* ---- 5 motywów ---- */
section('FAZA 14 — wszystkie 5 motywów');
const ctx3 = await browser.newContext({ viewport: { width: 1400, height: 950 } });
await ctx3.addInitScript(FAKE);
const wz3 = await ctx3.newPage();
watch(wz3, 'themes');
await wz3.goto('file://' + ROOT + '/dist/tracker-wizard.html');
await wz3.waitForSelector('#wz-start-cards .wz-tile');
await wz3.locator('.wz-tile', { hasText: 'Request log' }).first().click();
await wz3.waitForSelector('#wz-step-1:not([hidden])');
const themeIds = await wz3.evaluate(() => TBWizard.emit && window.__themes ||
  JSON.parse(new TextDecoder().decode(Uint8Array.from(
    atob(document.querySelector('[data-asset="themes.json"]').textContent),
    c => c.charCodeAt(0)))).themes.map(t => ({ id: t.id, name: t.name, c1: t.swatch.series[0] })));

for (const t of themeIds) {
  const h = await wz3.evaluate((id) => {
    TBWizard.state.cfg.meta.theme = id;
    return TBWizard.emit(TBWizard.state.cfg, true);
  }, t.id);
  const f = OUT + '/theme-' + t.id + '.html';
  writeFileSync(f, h);
  const p = await ctx3.newPage();
  watch(p, 'theme:' + t.id);
  await p.goto('file://' + f);
  await p.waitForSelector('#tb-nav a');
  await p.waitForTimeout 
    ? await p.waitForTimeout(500) : null;
  const res = await p.evaluate(() => {
    /* Karty w części motywów są półprzezroczyste (szkło), więc samo
       backgroundColor nie opisuje tego, co widzi oko. Składamy warstwy
       od najgłębszej nieprzezroczystej w górę — tak jak przeglądarka. */
    const rgba = c => { const m = (c || '').match(/[\d.]+/g); return m ? [+m[0], +m[1], +m[2], m[3] === undefined ? 1 : +m[3]] : null; };
    function effBg(el) {
      const layers = [];
      for (let n = el; n; n = n.parentElement) {
        const q = rgba(getComputedStyle(n).backgroundColor);
        if (q && q[3] > 0) { layers.push(q); if (q[3] >= 1) break; }
      }
      let base;
      if (layers.length && layers[layers.length - 1][3] >= 1) base = layers.pop().slice(0, 3);
      else {
        const pg = rgba(getComputedStyle(document.documentElement).getPropertyValue('--page-bg').trim()) ||
                   rgba(getComputedStyle(document.body).backgroundColor);
        base = pg ? pg.slice(0, 3) : [255, 255, 255];
      }
      for (let i = layers.length - 1; i >= 0; i--) {
        const l = layers[i], a = l[3];
        base = [0, 1, 2].map(k => l[k] * a + base[k] * (1 - a));
      }
      return base;
    }
    const lum = c => {
      const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
      return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
    };
    const card = document.querySelector('.card');
    const cs = getComputedStyle(card);
    const fg = rgba(cs.color).slice(0, 3);
    const bg = effBg(card);
    const l1 = lum(fg), l2 = lum(bg);
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    return {
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      contrast: Math.round(ratio * 100) / 100,
      c1: getComputedStyle(document.documentElement).getPropertyValue('--c1').trim(),
      charts: document.querySelectorAll('.tb-chart svg').length,
      cardBg: cs.backgroundColor, effBg: bg.map(Math.round).join(',')
    };
  });
  const okOverflow = res.overflow <= 1;
  const okContrast = res.contrast >= 4.5;
  const okC1 = res.c1.toLowerCase() === t.c1.toLowerCase();
  ok(okOverflow && okContrast && okC1 && res.charts >= 2,
    t.name + ': brak przewijania w poziomie, kontrast ' + res.contrast + ':1, --c1 ' + res.c1 +
    ', wykresów ' + res.charts,
    'overflow=' + res.overflow + ' contrast=' + res.contrast + ' c1=' + res.c1 +
    ' oczekiwano=' + t.c1 + ' charts=' + res.charts);
  await p.close();
}

/* ---- styl jest wypalony w pliku: brak przełącznika ---- */
section('FAZA 15 — styl wypalony w pliku, bez przełącznika');
const hOne = await wz3.evaluate(() => {
  TBWizard.state.cfg.meta.theme = 'amber-dusk';
  return TBWizard.emit(TBWizard.state.cfg, true);
});
writeFileSync(OUT + '/single.html', hOne);
const ps = await ctx3.newPage();
watch(ps, 'single');
await ps.goto('file://' + OUT + '/single.html');
await ps.waitForSelector('#tb-nav a');
await ps.waitForTimeout(400);
ok(await ps.locator('script[type="text/plain"][data-theme]').count() === 0,
  'plik NIE zawiera dodatkowych motywów — waży tylko tyle, ile trzeba');
ok(await ps.locator('#tb-head-actions select').count() === 0,
  'w topbarze nie ma przełącznika stylu');
const c1now = await ps.evaluate(() =>
  getComputedStyle(document.documentElement).getPropertyValue('--c1').trim());
ok(c1now.toLowerCase() === '#f4a95e', 'wypalony motyw to Amber Dusk', c1now);
const fill = await ps.evaluate(() => {
  const s2 = document.querySelector('.tb-chart svg stop');
  return s2 ? s2.getAttribute('style') : null;
});
ok(fill && fill.includes('var(--c1)'),
  'gradient słupka nadal odwołuje się do tokenu motywu', fill);
await ps.close();

section('Błędy konsoli');
if (errors.length) errors.forEach(e => console.log('  ! ' + e));
ok(errors.length === 0, 'zero błędów w konsoli', errors.length + ' błędów');

console.log('\n' + '='.repeat(60));
console.log('CZĘŚĆ 3: zaliczone ' + pass + ', nieudane ' + fail);
if (fails.length) { console.log('Nieudane:'); fails.forEach(f => console.log('  - ' + f)); }
await browser.close();
process.exit(fail ? 1 : 0);
