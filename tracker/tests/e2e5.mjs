/* Część 5: profil z awatarem i zdjęciem, alerty z regułami, wybór formatu. */
import pw from '/opt/node-tools/node_modules/playwright/index.js';
const { chromium } = pw;
import { writeFileSync, mkdirSync } from 'node:fs';
const ROOT = '/home/user/Design-';
const OUT = '/tmp/claude-0/e2e5';
mkdirSync(OUT, { recursive: true });

let pass = 0, fail = 0; const fails = [];
function ok(c, l, e) { if (c) { pass++; console.log('  ✓ ' + l); } else { fail++; fails.push(l); console.log('  ✗ ' + l + (e ? '  → ' + e : '')); } }
function section(t) { console.log('\n== ' + t); }

const FAKE = `
window.__fs = { content:'', mtime:0, perm:'granted', writes:0 };
window.showSaveFilePicker = async () => ({
  name:'d.json',
  queryPermission: async () => window.__fs.perm,
  requestPermission: async () => 'granted',
  getFile: async () => ({ name:'d.json', lastModified: window.__fs.mtime,
                          text: async () => window.__fs.content }),
  createWritable: async () => ({
    write: async (d) => { window.__fs.content = typeof d === 'string' ? d
      : (d instanceof Blob ? await d.text() : new TextDecoder().decode(d)); window.__fs.writes++; },
    close: async () => { window.__fs.mtime = Date.now(); }
  })
});`;

const browser = await chromium.launch();
const errors = [];
function watch(p, tag) {
  p.on('console', m => { if (m.type()==='error') errors.push(tag+': '+m.text()); });
  p.on('pageerror', e => errors.push(tag+' pageerror: '+e.message));
}
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
await ctx.addInitScript(FAKE);

section('FAZA 20 — przygotowanie z szablonu Request log');
const wz = await ctx.newPage();
watch(wz, 'wizard');
await wz.goto('file://' + ROOT + '/dist/tracker-wizard.html');
await wz.waitForSelector('#wz-start-cards .wz-tile');
await wz.locator('.wz-tile', { hasText: 'Request log' }).first().click();
await wz.waitForSelector('#wz-step-1:not([hidden])');

/* krok Alerts musi istnieć i pokazywać reguły z szablonu */
await wz.locator('#wz-rail a', { hasText: 'Alerts' }).click();
await wz.waitForSelector('#wz-step-5:not([hidden])');
const alertRows = await wz.locator('#wz-step-5 .wz-row').count();
ok(alertRows === 2, 'krok Alerts pokazuje 2 reguły z szablonu', 'było ' + alertRows);
await wz.locator('#wz-step-5 .wz-row').first().locator('.wz-mini').first().click();
await wz.waitForTimeout(250);
ok(await wz.locator('#wz-step-5 .wz-row textarea, #wz-step-5 .wz-row .tb-field').count() > 0,
  'reguła rozwija się do edycji');

const html = await wz.evaluate(() => TBWizard.emit(TBWizard.state.cfg, false));
writeFileSync(OUT + '/tracker.html', html);
const cfg = await wz.evaluate(() => TBWizard.state.cfg);
ok(cfg.alerts.length === 2 && cfg.alerts[0].goToTab, 'alerty mają docelową zakładkę');

const tr = await ctx.newPage();
watch(tr, 'tracker');
await tr.goto('file://' + OUT + '/tracker.html');
await tr.waitForSelector('#tb-nav a');

/* ---------------------------------------- alerty */
section('FAZA 21 — alerty');
ok(await tr.locator('#tb-bell').count() === 1, 'dzwonek jest w topbarze');
ok(await tr.locator('#tb-bell .tb-bell-count').count() === 0,
  'bez danych dzwonek nie pokazuje licznika');

const ids = await tr.evaluate(() => {
  const ds = TB.config().datasets[0];
  const col = n => ds.columns.find(c => new RegExp(n, 'i').test(c.label)).id;
  const o = { subj: col('Subject'), req: col('Requested by'), due: col('Due'),
              stat: col('Status'), own: col('Owner') };
  const mk = (i, due, stat, owner) => {
    const d = {};
    d[o.req] = 'Client ' + i; d[o.subj] = 'Request ' + i;
    d[o.due] = due; d[o.stat] = stat; d[o.own] = owner;
    return { id: 'r_a' + i, ds: ds.id, data: d, _c: Date.now(), _m: Date.now(), _d: 0 };
  };
  TB.store.putRecord(mk(1, '2020-01-01', 'new', 'Anna'));     // po terminie
  TB.store.putRecord(mk(2, '2020-02-01', 'wip', 'Anna'));     // po terminie
  TB.store.putRecord(mk(3, '2099-01-01', 'new', ''));         // bez opiekuna
  return o;
});
await tr.waitForTimeout(500);
const count = await tr.locator('#tb-bell .tb-bell-count').textContent();
ok(count === '2', 'dzwonek pokazuje 2 aktywne alerty', 'było ' + count);
ok(await tr.locator('#tb-bell').getAttribute('data-tone') === 'danger',
  'ton dzwonka to najcięższy z aktywnych (danger)');

await tr.locator('#tb-bell').click();
await tr.waitForSelector('.tb-menu');
const alertTexts = await tr.locator('.tb-menu .tb-menu-head').allTextContents();
ok(alertTexts.some(t => /2 requests are past their due date/.test(t)),
  'lista alertów podstawia liczbę w {{n}}', JSON.stringify(alertTexts));
ok(alertTexts.some(t => /1 open requests have no owner/.test(t)),
  'druga reguła też liczy poprawnie');

await tr.locator('.tb-menu .tb-menu-item', { hasText: 'Overdue requests' }).click();
await tr.waitForTimeout(400);
ok((await tr.locator('#tb-title').textContent()) === 'Log',
  'klik w alert przeskakuje na wskazaną zakładkę');

/* po naprawieniu danych alert znika */
await tr.evaluate((o) => {
  const ds = TB.config().datasets[0];
  ['r_a1', 'r_a2'].forEach(id => {
    const r = TB.data.index[id];
    r.data[o.stat] = 'done';
    TB.store.touch(r);
  });
}, ids);
await tr.waitForTimeout(500);
const count2 = await tr.locator('#tb-bell .tb-bell-count').textContent();
ok(count2 === '1', 'po zamknięciu zgłoszeń licznik spada do 1', 'było ' + count2);

/* ---------------------------------------- profil */
section('FAZA 22 — profil i awatar');
ok(await tr.locator('#tb-profile-btn').count() === 1, 'profil jest w sidebarze');
ok((await tr.locator('.tb-profile-name').textContent()).includes('Set up'),
  'bez danych profil zachęca do uzupełnienia');
ok((await tr.locator('.tb-profile-team').textContent()) === 'Operations',
  'zespół domyślny z kreatora jest widoczny');

await tr.locator('#tb-profile-btn').click();
await tr.waitForSelector('dialog.tb-modal');
await tr.locator('dialog.tb-modal input.tb-input').first().fill('Anna Kowalska');
await tr.locator('dialog.tb-modal input.tb-input').nth(1).fill('Client Services');
await tr.locator('dialog.tb-modal .tb-colors button').nth(2).click();
await tr.waitForTimeout(200);
const initials = await tr.locator('dialog.tb-modal .tb-avatar-lg').textContent();
ok(initials === 'AK', 'podgląd awatara pokazuje inicjały', initials);
/* Motywy mają reset * { margin:0 }, który potrafi zepsuć centrowanie <dialog>. */
const centered = await tr.evaluate(() => {
  const d = document.querySelector('dialog.tb-modal').getBoundingClientRect();
  const dx = Math.abs((d.left + d.right) / 2 - innerWidth / 2);
  const dy = Math.abs((d.top + d.bottom) / 2 - innerHeight / 2);
  return { dx: Math.round(dx), dy: Math.round(dy) };
});
ok(centered.dx < 20 && centered.dy < 20, 'modal jest wyśrodkowany w oknie',
  'odchylenie x=' + centered.dx + ' y=' + centered.dy);
await tr.locator('dialog.tb-modal button', { hasText: 'Save profile' }).click();
await tr.waitForTimeout(500);
ok((await tr.locator('.tb-profile-name').textContent()) === 'Anna Kowalska', 'imię zapisane');
ok((await tr.locator('.tb-profile-team').textContent()) === 'Client Services', 'zespół zapisany');
ok((await tr.locator('#tb-side-foot .tb-avatar').textContent()) === 'AK',
  'awatar w sidebarze pokazuje inicjały');

/* akcja „assign to me" używa imienia z profilu */
await tr.locator('#tb-nav a', { hasText: 'Log' }).click();
await tr.waitForSelector('.tb-table tbody tr');
await tr.locator('.tb-table tbody tr').first().click({ button: 'right' });
await tr.waitForSelector('.tb-menu');
await tr.locator('.tb-menu .tb-menu-item', { hasText: 'Assign to me' }).click();
await tr.waitForTimeout(400);
const ownerCell = await tr.locator('.tb-table tbody tr').first().locator('td').last().textContent();
ok(ownerCell.trim() === 'Anna Kowalska',
  'akcja „Assign to me" wstawiła imię z profilu', ownerCell);

/* zdjęcie: prawdziwa ścieżka przez okno wyboru pliku */
section('FAZA 23 — zdjęcie profilowe');
const pngBytes = await tr.evaluate(async () => {
  const c = document.createElement('canvas');
  c.width = 640; c.height = 480;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 640, 480);
  grd.addColorStop(0, '#ff6600'); grd.addColorStop(1, '#0066ff');
  g.fillStyle = grd; g.fillRect(0, 0, 640, 480);
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  return Array.from(new Uint8Array(await blob.arrayBuffer()));
});
writeFileSync(OUT + '/photo.png', Buffer.from(pngBytes));
console.log('  … źródłowe zdjęcie: ' + (pngBytes.length / 1024).toFixed(0) + ' KB, 640×480');

await tr.locator('#tb-profile-btn').click();
await tr.waitForSelector('dialog.tb-modal');
const [chooser] = await Promise.all([
  tr.waitForEvent('filechooser'),
  tr.locator('dialog.tb-modal button', { hasText: 'Upload a photo' }).click()
]);
await chooser.setFiles(OUT + '/photo.png');
await tr.waitForTimeout(700);
const previewBg = await tr.locator('dialog.tb-modal .tb-avatar-lg').evaluate(
  el => getComputedStyle(el).backgroundImage);
ok(/^url\("data:image\/jpeg/.test(previewBg), 'podgląd pokazuje wgrane zdjęcie jako JPEG');
const photoLen = await tr.evaluate(() => {
  const el = document.querySelector('dialog.tb-modal .tb-avatar-lg');
  const m = /url\("(data:[^"]+)"\)/.exec(getComputedStyle(el).backgroundImage);
  return m ? m[1].length : 0;
});
ok(photoLen > 0 && photoLen < 12000,
  'zdjęcie przeskalowane do ~' + Math.round(photoLen / 1024) + ' KB (źródło ' +
  Math.round(pngBytes.length / 1024) + ' KB)', photoLen + ' znaków');
await tr.locator('dialog.tb-modal button', { hasText: 'Save profile' }).click();
await tr.waitForTimeout(600);

/* profil trafia do pliku danych i przeżywa reload */
const fileProfile = await tr.evaluate(() => {
  try { return JSON.parse(window.__fs.content).profile; } catch (e) { return null; }
});
await tr.locator('#tb-head-actions button', { hasText: 'Save' }).click();
await tr.waitForTimeout(800);
const fp2 = await tr.evaluate(() => {
  try { return JSON.parse(window.__fs.content).profile; } catch (e) { return null; }
});
ok(fp2 && fp2.name === 'Anna Kowalska' && fp2.photo && fp2.photo.indexOf('data:image/jpeg') === 0,
  'profil ze zdjęciem zapisany w pliku danych');

await tr.reload();
await tr.waitForSelector('#tb-side-foot .tb-avatar');
await tr.waitForTimeout(400);
ok((await tr.locator('.tb-profile-name').textContent()) === 'Anna Kowalska',
  'profil przetrwał reload');
const bg2 = await tr.locator('#tb-side-foot .tb-avatar').evaluate(
  el => getComputedStyle(el).backgroundImage);
ok(/data:image\/jpeg/.test(bg2), 'zdjęcie przetrwało reload');

await tr.close();

/* ---------------------------------------- formaty */
section('FAZA 24 — wybór formatu liczb i dat');
for (const [loc, wantDate, wantNum] of [
  ['en-GB', '28/09/2026', '48,200.50'],
  ['en-US', '09/28/2026', '48,200.50'],
  ['pl-PL', '28.09.2026', '48 200,50']
]) {
  const h = await wz.evaluate((l) => {
    TBWizard.state.cfg.meta.locale = l;
    return TBWizard.emit(TBWizard.state.cfg, true);
  }, loc);
  const f = OUT + '/loc-' + loc + '.html';
  writeFileSync(f, h);
  const p = await ctx.newPage();
  watch(p, 'loc:' + loc);
  await p.goto('file://' + f);
  await p.waitForSelector('#tb-nav a');
  const got = await p.evaluate(() => ({
    date: TB.fmt.date('2026-09-28'),
    num: TB.fmt.number(48200.5, 'number'),
    cur: TB.fmt.number(1234.5, 'currency')
  }));
  const okDate = got.date === wantDate;
  const okNum = got.num.replace(/\s/g, ' ') === wantNum;
  ok(okDate && okNum, loc + ': data ' + got.date + ', liczba ' + got.num + ', waluta ' + got.cur,
    'oczekiwano ' + wantDate + ' / ' + wantNum);
  await p.close();
}

await wz.close();
section('Błędy konsoli');
if (errors.length) errors.forEach(e => console.log('  ! ' + e));
ok(errors.length === 0, 'zero błędów w konsoli', errors.length + ' błędów');

console.log('\n' + '='.repeat(60));
console.log('CZĘŚĆ 5: zaliczone ' + pass + ', nieudane ' + fail);
if (fails.length) { console.log('Nieudane:'); fails.forEach(f => console.log('  - ' + f)); }
await browser.close();
process.exit(fail ? 1 : 0);
