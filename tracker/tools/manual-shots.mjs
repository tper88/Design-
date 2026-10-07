/* Zrzuty ekranu do instrukcji (tracker/manual/img/*.png).
   Uruchomienie z katalogu repo:  node tracker/tools/manual-shots.mjs
   Robione z aktualnego dist/tracker-wizard.html, więc po każdej zmianie UI
   wystarczy puścić skrypt i przebudować instrukcję. */
import pw from '/opt/node-tools/node_modules/playwright/index.js';
const { chromium } = pw;
import { writeFileSync, mkdirSync } from 'node:fs';
const ROOT = '/home/user/Design-';
const IMG = ROOT + '/tracker/manual/img';
const TMP = '/tmp/claude-0/manual-shots';
mkdirSync(IMG, { recursive: true });
mkdirSync(TMP, { recursive: true });

const shots = [];
async function snap(target, name, opts) {
  await target.screenshot(Object.assign({ path: IMG + '/' + name + '.png', animations: 'disabled' }, opts || {}));
  shots.push(name);
}
const pause = (p, ms) => p.waitForTimeout(ms || 250);
const fieldSel = (label) => `.tb-field:has(> label:text-is("${label}")) > :is(select,input,textarea)`;

/* Atrapa dysku jak w testach: pliki po nazwie, oba okna. Opcjonalnie
   „zapamiętany” uchwyt bez uprawnień — żeby pokazać baner Reconnect. */
const FS = (opts) => `
window.__files = ${JSON.stringify((opts && opts.files) || {})};
window.__pick = 'Request log.data.json';
window.__perm = ${JSON.stringify((opts && opts.perm) || 'granted')};
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
      let buf = '';
      return { write: async (d) => { buf = typeof d === 'string' ? d : await new Blob([d]).text(); },
               close: async () => { window.__files[name] = { content: buf, mtime: Date.now() }; } };
    }
  };
}
window.showSaveFilePicker = async () => __handle(window.__pick);
window.showOpenFilePicker = async () => [__handle(window.__pick)];
/* Prawdziwy uchwyt pliku da się zapisać w IndexedDB, atrapy (z funkcjami) nie —
   bez tego na każdym zrzucie wisiałby baner „file was not remembered”,
   którego w Chrome nie ma. */
(function () {
  const put = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (v, k) {
    if (v && v.k === 'fileHandle') {
      const req = {};
      setTimeout(() => { req.result = 'fileHandle'; if (req.onsuccess) req.onsuccess(); }, 0);
      return req;
    }
    return put.call(this, v, k);
  };
})();
${opts && opts.remembered ? `
(function () {
  const get = IDBObjectStore.prototype.get;
  IDBObjectStore.prototype.get = function (key) {
    if (key === 'fileHandle') {
      const req = {};
      setTimeout(() => { req.result = { k: 'fileHandle', v: __handle(window.__pick) }; if (req.onsuccess) req.onsuccess(); }, 0);
      return req;
    }
    return get.call(this, key);
  };
})();` : ''}`;

const browser = await chromium.launch({ args: ['--lang=en-GB'] });
const errors = [];
function watch(p, tag) {
  p.on('console', m => { if (m.type() === 'error') errors.push(tag + ': ' + m.text()); });
  p.on('pageerror', e => errors.push(tag + ' pageerror: ' + e.message));
  /* toasty („Loaded the … template”, „Saved”) są prawdziwe, ale na zrzutach
     w instrukcji tylko zasłaniają to, co opisujemy */
  p.on('load', () => p.addStyleTag({ content: '.toast{visibility:hidden!important}' }).catch(() => {}));
}
const VIEW = { width: 1280, height: 860 };

/* ================================================================ kreator */
const wctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 1.25, locale: 'en-GB' });
await wctx.addInitScript(`window.showSaveFilePicker = async () => { throw Object.assign(new Error('x'), { name: 'AbortError' }); };`);
const wz = await wctx.newPage();
watch(wz, 'wizard');
await wz.goto('file://' + ROOT + '/dist/tracker-wizard.html');
await wz.waitForSelector('#wz-start-cards .wz-tile');
await snap(wz, 'w-start');

await wz.locator('.wz-tile', { hasText: 'Request log' }).first().click();
await wz.waitForSelector('#wz-step-1:not([hidden])');
await pause(wz, 400);
await snap(wz, 'w-basics', { fullPage: true });

await wz.locator('#wz-rail a', { hasText: 'Data' }).click();
await wz.waitForSelector('#wz-step-2:not([hidden])');
await pause(wz);
await snap(wz, 'w-data', { fullPage: true });
const statusRowIdx = await wz.evaluate(() => [...document.querySelectorAll('#wz-step-2 .wz-row')]
  .findIndex(r => { const i = r.querySelector('input[aria-label="Column name"]'); return i && i.value === 'Status'; }));
await snap(wz.locator('#wz-step-2 .wz-row').nth(statusRowIdx), 'w-column-row');
await wz.locator('#wz-step-2 .wz-row').nth(statusRowIdx).locator('button', { hasText: 'Pick list options' }).click();
await wz.waitForSelector('dialog.tb-modal');
await pause(wz, 400);
await snap(wz.locator('dialog.tb-modal'), 'w-options');
await wz.locator('dialog.tb-modal button', { hasText: 'Done' }).click();
await pause(wz, 300);

await wz.locator('#wz-step-2 button', { hasText: 'Paste a header from Excel' }).click();
await wz.waitForSelector('dialog.tb-modal textarea');
await wz.locator('dialog.tb-modal textarea').fill(
  'Client\tAmount\tInvoice date\tPaid\n' +
  'Nordic Ltd\t1,234.56\t06/10/2026\tTRUE\n' +
  'Baltic SA\t980.00\t14/09/2026\tFALSE\n' +
  'Vistula LLP\t2,450.10\t30/08/2026\tTRUE');
await pause(wz, 300);
await snap(wz.locator('dialog.tb-modal'), 'w-paste-header');
await wz.locator('dialog.tb-modal button', { hasText: 'Cancel' }).click();
await pause(wz, 300);

await wz.locator('#wz-rail a', { hasText: 'Tabs' }).click();
await wz.waitForSelector('#wz-step-3:not([hidden])');
await pause(wz);
await snap(wz.locator('#wz-step-3 .card').first(), 'w-tabs');
await snap(wz.locator('#wz-step-3 .card').nth(1), 'w-presets');

await wz.locator('#wz-rail a', { hasText: 'Components' }).click();
await wz.waitForSelector('#wz-step-4:not([hidden])');
await pause(wz);
await wz.locator('#wz-step-4 .wz-row-main', { hasText: 'Overdue' }).first().click();
await pause(wz, 300);
await snap(wz, 'w-components', { fullPage: true });
await snap(wz.locator('#wz-step-4 .tb-field.wz-wide', { has: wz.locator('label', { hasText: 'Only count rows where' }) }).first(), 'w-filter');
await wz.locator('#wz-step-4 ' + fieldSel('Tab')).first().selectOption({ label: 'Log' });
await pause(wz, 300);
await wz.locator('#wz-step-4 .wz-row-main', { hasText: 'Requests' }).first().click();
await pause(wz, 300);
await snap(wz.locator('#wz-step-4 .wz-split > .card').nth(1), 'w-table-settings');
await snap(wz.locator('#wz-step-4 .tb-field.wz-wide', { has: wz.locator('label', { hasText: 'Quick filter chips' }) }).first(), 'w-chips');
await snap(wz.locator('#wz-step-4 .tb-field.wz-wide', { has: wz.locator('label', { hasText: 'Right-click menu' }) }).first(), 'w-ctxmenu');
await wz.locator('#wz-step-4 ' + fieldSel('Tab')).first().selectOption({ label: 'Dates' });
await pause(wz, 300);
await wz.locator('#wz-step-4 .wz-row-main', { hasText: 'What is due' }).first().click();
await pause(wz, 300);
await snap(wz.locator('#wz-step-4 .wz-split > .card').nth(1), 'w-agenda');
await wz.locator('#wz-step-4 ' + fieldSel('Tab')).first().selectOption({ label: 'Summary' });
await pause(wz, 300);
await wz.locator('#wz-step-4 .wz-row-main', { hasText: 'Requests over time' }).first().click();
await pause(wz, 300);
await snap(wz.locator('#wz-step-4 .wz-split > .card').nth(1), 'w-chart');

await wz.locator('#wz-rail a', { hasText: 'Alerts' }).click();
await wz.waitForSelector('#wz-step-5:not([hidden])');
await wz.locator('#wz-step-5 .wz-row').first().locator('.wz-mini').first().click();
await pause(wz, 300);
await snap(wz, 'w-alerts', { fullPage: true });

await wz.locator('#wz-rail a', { hasText: 'Review & export' }).click();
await wz.waitForSelector('#wz-step-6:not([hidden])');
await pause(wz, 400);
await snap(wz, 'w-review', { fullPage: true });
/* tak wygląda lista problemów — pusta zakładka na chwilę */
await wz.evaluate(() => { TBWizard.state.cfg.tabs.push({ id: 't_tmp', label: 'Blank', icon: '▦', layout: { cols: 1 }, components: [] }); });
await wz.locator('#wz-rail a', { hasText: 'Alerts' }).click();
await wz.locator('#wz-rail a', { hasText: 'Review & export' }).click();
await pause(wz, 300);
await snap(wz.locator('#wz-step-6 .tb-banner-danger').first(), 'w-problems');
await wz.evaluate(() => { TBWizard.state.cfg.tabs = TBWizard.state.cfg.tabs.filter(t => t.id !== 't_tmp'); });
await wz.locator('#wz-rail a', { hasText: 'Alerts' }).click();
await wz.locator('#wz-rail a', { hasText: 'Review & export' }).click();
await pause(wz, 300);
await wz.locator('#wz-step-6 button', { hasText: 'Preview' }).click();
await wz.waitForSelector('dialog.tb-modal iframe');
await pause(wz, 1500);
await snap(wz, 'w-preview');
await wz.locator('dialog.tb-modal button', { hasText: 'Close' }).last().click();
await pause(wz, 300);

/* tracker do zrzutów: Request log + zakładka To-do */
const html = await wz.evaluate(() => {
  const cfg = TBWizard.state.cfg;
  cfg.tabs.push(TBWizard.presets.build('todo', cfg.datasets[0]));
  return TBWizard.emit(cfg, false);
});
writeFileSync(TMP + '/Request log.html', html);
const cfgJson = await wz.evaluate(() => JSON.stringify(TBWizard.state.cfg));

/* ================================================================ tracker */
const SEED = `(function () {
  const ds = TB.config().datasets[0];
  const col = n => ds.columns.find(c => c.label === n).id;
  const iso = d => { const x = new Date(); x.setDate(x.getDate() + d); return x.toISOString().slice(0, 10); };
  const rows = [
    ['Invoice correction', 'Nordic Ltd', -20, -3, 'wip', 'Anna Kowalska'],
    ['Credit limit query', 'Baltic SA', -15, 2, 'new', 'Peter Novak'],
    ['Delivery complaint', 'Vistula LLP', -12, -1, 'new', ''],
    ['Address change', 'Oder plc', -10, 5, 'done', 'Maria Wisniewska', 'Updated in the CRM.'],
    ['Quarterly reconciliation', 'Finance team', -9, 9, 'wip', 'Anna Kowalska'],
    ['Report access', 'Sales team', -7, 1, 'new', 'Tom Lewandowski'],
    ['Contract review', 'Legal', -6, 12, 'wip', 'Kate Zielinska'],
    ['Duplicate payment', 'Nordic Ltd', -5, 0, 'new', 'Anna Kowalska'],
    ['Price list update', 'Marketing', -4, 20, 'done', 'Peter Novak', 'Sent to all clients.'],
    ['VAT number check', 'Baltic SA', -3, 3, 'new', ''],
    ['Refund request', 'Vistula LLP', -2, 6, 'wip', 'Maria Wisniewska'],
    ['New supplier setup', 'Purchasing', -1, 14, 'new', 'Tom Lewandowski'],
    ['Bank details change', 'Oder plc', -40, -30, 'done', 'Anna Kowalska', 'Confirmed by phone.'],
    ['Statement request', 'Finance team', -55, -45, 'done', 'Peter Novak', 'Sent.'],
    ['Credit note', 'Nordic Ltd', -70, -60, 'done', 'Kate Zielinska', 'Issued.'],
    ['Audit question', 'Legal', -85, -75, 'done', 'Tom Lewandowski', 'Answered.']
  ];
  rows.forEach((r, i) => {
    const d = {};
    d[col('Subject')] = r[0]; d[col('Requested by')] = r[1]; d[col('Received')] = iso(r[2]);
    d[col('Due')] = iso(r[3]); d[col('Status')] = r[4]; d[col('Owner')] = r[5];
    if (r[6]) d[col('Resolution')] = r[6];
    TB.store.putRecord({ id: 'r_m' + i, ds: ds.id, data: d, _c: Date.now() - i, _m: Date.now(), _d: 0 });
  });
})();`;

const tctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 1.25, locale: 'en-GB' });
await tctx.addInitScript(FS());
const tr = await tctx.newPage();
watch(tr, 'tracker');
await tr.goto('file://' + TMP + '/Request log.html');
await tr.waitForSelector('#tb-nav a');
await pause(tr, 400);
await snap(tr, 't-first-open');
await tr.locator('#tb-notices button', { hasText: 'Choose a data file' }).click();
await tr.waitForSelector('dialog.tb-modal .tb-choice');
await pause(tr, 400);
await snap(tr.locator('dialog.tb-modal'), 't-choose-file');
await tr.locator('dialog.tb-modal .tb-choice', { hasText: 'Create a new data file' }).click();
await pause(tr, 600);
await tr.evaluate(SEED);
await pause(tr, 300);

/* profil, żeby „Mine” i „Assign to me” miały sens */
await tr.locator('#tb-profile-btn').click();
await tr.waitForSelector('dialog.tb-modal');
await tr.locator('dialog.tb-modal input.tb-input').first().fill('Anna Kowalska');
await tr.locator('dialog.tb-modal input.tb-input').nth(1).fill('Operations');
await tr.locator('dialog.tb-modal .tb-colors button').nth(1).click();
await pause(tr, 300);
await snap(tr.locator('dialog.tb-modal'), 't-profile');
await tr.locator('dialog.tb-modal button', { hasText: 'Save profile' }).click();
await pause(tr, 2000);
await snap(tr.locator('#tb-head'), 't-topbar');

await tr.locator('#tb-nav a', { hasText: 'Summary' }).click();
await pause(tr, 600);
await snap(tr, 't-summary');

await tr.locator('#tb-nav a', { hasText: 'Log' }).click();
await pause(tr, 500);
await snap(tr, 't-table');
const P = '#tb-panels > section:not([hidden]) ';
await snap(tr.locator(P + '.tb-toolbar'), 't-toolbar');
await tr.locator(P + '.tb-chip-btn', { hasText: 'Overdue' }).click();
await pause(tr, 400);
await snap(tr.locator(P + '.card').first(), 't-chip-active');
await tr.locator(P + '.tb-chip-btn', { hasText: 'Overdue' }).click();
await pause(tr, 300);

const firstRow = tr.locator(P + '.tb-table tbody tr').first();
await firstRow.locator('td[data-tb-editable]').nth(1).click();
await tr.waitForSelector('.tb-drawer.is-open');
await pause(tr, 500);
await snap(tr, 't-drawer');
await tr.keyboard.press('Escape');
await pause(tr, 400);

const cell = tr.locator(P + '.tb-table tbody tr').nth(1).locator('td[data-tb-editable]').nth(3);
await cell.dblclick();
await pause(tr, 400);
await snap(tr.locator(P + '.tb-table-wrap'), 't-cell-edit', { clip: undefined });
await tr.keyboard.press('Escape');
await pause(tr, 300);

await tr.locator(P + '.tb-table tbody tr').nth(1).locator('input.tb-check').check();
await tr.locator(P + '.tb-table tbody tr').nth(2).locator('input.tb-check').check();
await pause(tr, 300);
await tr.locator(P + '.tb-table tbody tr').nth(2).locator('td').nth(3).click({ button: 'right' });
await tr.waitForSelector('.tb-menu');
await pause(tr, 300);
await snap(tr, 't-context-menu');
await tr.keyboard.press('Escape');
await pause(tr, 300);

await tr.locator(P + '.tb-toolbar button', { hasText: 'Export' }).click();
await tr.waitForSelector('.tb-menu');
await pause(tr, 300);
await snap(tr, 't-export-menu');
await tr.keyboard.press('Escape');
await pause(tr, 300);
await tr.locator(P + '.tb-table thead input.tb-check').uncheck().catch(() => {});

/* wklejanie z Excela: Ctrl+V na zakładce z tabelą */
await tctx.grantPermissions(['clipboard-read', 'clipboard-write']);
await tr.evaluate(t => navigator.clipboard.writeText(t),
  'Subject\tRequested by\tReceived\tDue\tStatus\r\n' +
  'Missing invoice\tNordic Ltd\t01/10/2026\t10/10/2026\tNew\r\n' +
  'Payment reminder\tOder plc\t02/10/2026\t12/10/2026\tIn progress\r\n');
await tr.locator('#tb-title').click();
await tr.keyboard.press('Control+V');
await tr.waitForSelector('dialog.tb-modal select');
await pause(tr, 400);
await snap(tr.locator('dialog.tb-modal'), 't-paste-import');
await tr.locator('dialog.tb-modal button', { hasText: 'Cancel' }).click();
await pause(tr, 300);

/* zła wartość w komórce */
await tr.evaluate(() => {
  const ds = TB.config().datasets[0];
  const r = TB.data.index['r_m1'];
  r.data[ds.columns.find(c => c.label === 'Due').id] = '32.13.2026';
  TB.store.touch(r);
});
await pause(tr, 500);
await snap(tr.locator(P + '.tb-table tbody tr').nth(1), 't-bad-value');
await tr.evaluate(() => {
  const ds = TB.config().datasets[0];
  const r = TB.data.index['r_m1'];
  const x = new Date(); x.setDate(x.getDate() + 2);
  r.data[ds.columns.find(c => c.label === 'Due').id] = x.toISOString().slice(0, 10);
  TB.store.touch(r);
});

await tr.locator('#tb-nav a', { hasText: 'Dates' }).click();
await pause(tr, 400);
for (const item of ['Clear the inbox', 'Answer open requests', 'Send the daily report']) {
  await tr.locator(P + '.tb-check-add input[aria-label="New checklist item"]').fill(item);
  await tr.locator(P + '.tb-check-add input[aria-label="New checklist item"]').press('Enter');
  await pause(tr, 200);
}
await tr.locator(P + '.tb-check-item input.tb-check').first().check();
await pause(tr, 400);
await snap(tr, 't-agenda');

await tr.locator('#tb-nav a', { hasText: 'To-do' }).click();
await pause(tr, 400);
const todo = [['Prepare the monthly report', 3], ['Renew the software licence', -2], ['Book the team meeting', 10]];
for (const [txt, d] of todo) {
  const x = new Date(); x.setDate(x.getDate() + d);
  await tr.locator(P + '.tb-check-add input[aria-label="New checklist item"]').fill(txt);
  await tr.locator(P + '.tb-check-add input[type="date"]').fill(x.toISOString().slice(0, 10));
  await tr.locator(P + '.tb-check-add input[aria-label="New checklist item"]').press('Enter');
  await pause(tr, 200);
}
await tr.locator(P + 'button', { hasText: '+ Add note' }).first().click();
await pause(tr, 300);
await tr.locator(P + '.tb-note .tb-note-text').first().click();
await tr.keyboard.type('Ask IT about the new laptop');
await tr.locator('#tb-title').click();
await pause(tr, 400);
await snap(tr, 't-todo');

await tr.locator('#tb-nav a', { hasText: 'Notes' }).click();
await pause(tr, 300);
for (const txt of ['Call the client before shipping', 'Check the September reconciliation', 'Holiday cover: Peter from 14th']) {
  await tr.locator(P + 'button', { hasText: '+ Add note' }).first().click();
  await pause(tr, 200);
  await tr.locator(P + '.tb-note .tb-note-text').first().click();
  await tr.keyboard.type(txt);
  await tr.locator('#tb-title').click();
  await pause(tr, 250);
}
await snap(tr, 't-notes');

await tr.locator('#tb-bell').click();
await tr.waitForSelector('.tb-menu');
await pause(tr, 300);
await snap(tr, 't-alerts');
await tr.keyboard.press('Escape');
await pause(tr, 200);

await tr.locator('#tb-head-actions button[aria-label="More options"]').click();
await tr.waitForSelector('.tb-menu');
await pause(tr, 300);
await snap(tr, 't-more-menu');
await tr.keyboard.press('Escape');

/* stan pliku zapisany do kolejnych scen */
const fileContent = await tr.evaluate(() => window.__files['Request log.data.json'].content);

/* ---- Reconnect po restarcie przeglądarki: zapamiętany plik, brak uprawnień */
const rctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 1.25, locale: 'en-GB' });
await rctx.addInitScript(FS({ files: { 'Request log.data.json': { content: fileContent, mtime: Date.now() } }, perm: 'prompt', remembered: true }));
const rt = await rctx.newPage();
watch(rt, 'reconnect');
await rt.goto('file://' + TMP + '/Request log.html');
await rt.waitForSelector('#tb-notices .tb-banner');
await pause(rt, 400);
await snap(rt.locator('#tb-notices'), 't-reconnect');

/* ---- nowy komputer + lokalne zmiany → wybór wersji */
const cctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 1.25, locale: 'en-GB' });
await cctx.addInitScript(FS({ files: { 'Request log.data.json': { content: fileContent, mtime: Date.now() } } }));
const ct = await cctx.newPage();
watch(ct, 'conflict');
await ct.goto('file://' + TMP + '/Request log.html');
await ct.waitForSelector('#tb-nav a');
await ct.evaluate(() => {
  const ds = TB.config().datasets[0];
  const d = {}; d[ds.columns.find(c => c.label === 'Subject').id] = 'Typed before linking';
  TB.store.putRecord({ id: 'r_x', ds: ds.id, data: d, _c: 1, _m: 1, _d: 0 });
});
await ct.locator('#tb-notices button', { hasText: 'Choose a data file' }).click();
await ct.locator('dialog.tb-modal .tb-choice', { hasText: 'Open my existing data file' }).click();
await ct.waitForSelector('#tb-notices .tb-banner-danger');
await pause(ct, 400);
await snap(ct.locator('#tb-notices .tb-banner-danger'), 't-conflict');

/* ---- struktura zmieniona: ten sam plik HTML, nowa wersja struktury */
const html2 = await wz.evaluate((json) => {
  const cfg = JSON.parse(json);
  cfg.rev = (cfg.rev || 1) + 1;
  cfg.datasets[0].columns.push({ id: 'c_prio_manual', label: 'Priority', type: 'enum',
    options: [{ value: 'low', label: 'Low', tone: '' }, { value: 'high', label: 'High', tone: 'danger' }] });
  return TBWizard.emit(cfg, false);
}, cfgJson);
writeFileSync(TMP + '/Request log.html', html2);
await tr.reload();
await tr.waitForSelector('#tb-notices .tb-banner');
await pause(tr, 400);
await snap(tr.locator('#tb-notices .tb-banner').first(), 't-structure');

/* ---- bramka przeglądarki */
const gctx = await browser.newContext({ viewport: { width: 900, height: 420 }, deviceScaleFactor: 1.25, locale: 'en-GB' });
await gctx.addInitScript('delete window.showSaveFilePicker; delete window.showOpenFilePicker;');
const gt = await gctx.newPage();
await gt.goto('file://' + TMP + '/Request log.html');
await gt.waitForSelector('.tb-gate');
await snap(gt, 't-gate');

await browser.close();
console.log(shots.length + ' zrzutów: ' + shots.join(', '));
if (errors.length) { console.log('BŁĘDY KONSOLI:\n' + errors.join('\n')); process.exit(1); }
