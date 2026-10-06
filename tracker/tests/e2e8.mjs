/* Część 8: eksport .xlsx otwarty w prawdziwym arkuszu kalkulacyjnym.

   LibreOffice Calc w trybie headless czyta plik z trackera, a potem:
   - zapisuje każdy arkusz jako CSV „tak jak wyświetlany” — widać, czy daty
     są datami, a kwoty mają format waluty,
   - zapisuje go ponownie jako .xlsx — openpyxl sprawdza typy komórek po tym,
     jak przeszły przez obcy silnik,
   - renderuje go do PDF → PNG, żeby można było na to po prostu popatrzeć.
   To nie jest Excel, ale to niezależna implementacja OOXML: jeśli plik
   byłby uszkodzony albo typy błędne, wyjdzie to tutaj. */
import pw from '/opt/node-tools/node_modules/playwright/index.js';
const { chromium } = pw;
import { writeFileSync, mkdirSync, readFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const ROOT = '/home/user/Design-';
const OUT = '/tmp/claude-0/e2e8';
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT + '/lo', { recursive: true });

let pass = 0, fail = 0; const fails = [];
function ok(c, l, e) { if (c) { pass++; console.log('  ✓ ' + l); } else { fail++; fails.push(l); console.log('  ✗ ' + l + (e ? '  → ' + e : '')); } }
function section(t) { console.log('\n== ' + t); }

const SOFFICE = ['/usr/bin/soffice', '/usr/bin/libreoffice'].find(p => existsSync(p));
if (!SOFFICE) {
  console.log('\nCZĘŚĆ 8: POMINIĘTA — brak LibreOffice w środowisku (soffice).');
  process.exit(0);
}

const FAKE = `
window.__fs = { content:'', mtime:0, perm:'granted' };
window.__xlsx = null;
window.showSaveFilePicker = async (o) => {
  const isX = o && /\\.xlsx$/.test(o.suggestedName || '');
  return {
    name: (o && o.suggestedName) || 'd.json',
    queryPermission: async () => 'granted',
    requestPermission: async () => 'granted',
    getFile: async () => ({ name:'d.json', lastModified: window.__fs.mtime, text: async () => window.__fs.content }),
    createWritable: async () => ({
      write: async (d) => {
        if (isX) { const b = d instanceof Blob ? await d.arrayBuffer() : d;
                   window.__xlsx = Array.from(new Uint8Array(b)); }
        else window.__fs.content = typeof d === 'string' ? d : await new Blob([d]).text();
      },
      close: async () => { window.__fs.mtime = Date.now(); }
    })
  };
};`;

const browser = await chromium.launch();
const errors = [];
function watch(p, tag) {
  p.on('console', m => { if (m.type()==='error') errors.push(tag+': '+m.text()); });
  p.on('pageerror', e => errors.push(tag+' pageerror: '+e.message));
}
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
await ctx.addInitScript(FAKE);

section('FAZA 36 — eksport całego trackera z trudnymi wartościami');
const wz = await ctx.newPage();
watch(wz, 'wizard');
await wz.goto('file://' + ROOT + '/dist/tracker-wizard.html');
await wz.waitForSelector('#wz-start-cards .wz-tile');
await wz.locator('.wz-tile', { hasText: 'Request log' }).first().click();
await wz.waitForSelector('#wz-step-1:not([hidden])');
const html = await wz.evaluate(() => {
  const cfg = TBWizard.state.cfg;
  cfg.meta.locale = 'pl-PL';
  cfg.meta.currency = 'PLN';
  cfg.datasets[0].columns.push({ id: 'c_amt', label: 'Amount', type: 'number', format: 'currency' });
  cfg.datasets[0].columns.push({ id: 'c_urg', label: 'Urgent', type: 'bool' });
  return TBWizard.emit(cfg, false);
});
writeFileSync(OUT + '/tracker.html', html);
const tr = await ctx.newPage();
watch(tr, 'tracker');
await tr.goto('file://' + OUT + '/tracker.html');
await tr.waitForSelector('#tb-nav a');

await tr.evaluate(() => {
  const ds = TB.config().datasets[0];
  const col = n => ds.columns.find(c => c.label === n).id;
  const mk = (id, o) => {
    const d = {}; Object.keys(o).forEach(k => { d[col(k)] = o[k]; });
    TB.store.putRecord({ id, ds: ds.id, data: d, _c: Date.now(), _m: Date.now(), _d: 0 });
  };
  mk('r_x1', { 'Requested by': 'Łukasz Żółkiewski', Subject: 'Zażółć gęślą jaźń', Received: '2026-10-06',
    Due: '2026-10-13', Status: 'wip', Amount: 1234.56, Urgent: true, Resolution: 'Linia 1\nLinia 2' });
  mk('r_x2', { 'Requested by': 'Anna', Subject: 'Ujemna kwota', Received: '2024-01-01',
    Status: 'done', Amount: -50.5, Urgent: false });
  mk('r_x3', { 'Requested by': 'Piotr', Subject: 'Złe dane', Received: '32.13.2026', Status: 'new', Amount: 'abc',
    Urgent: 'może' });
  mk('r_x5', { 'Requested by': 'Ola', Subject: 'Liczba ze śmieciem', Received: '2026-02-02', Status: 'new',
    Amount: '12abc' });
  mk('r_x4', { 'Requested by': '=SUM(A1:A9)', Subject: '<b>&"cytat"</b>', Received: '2026-01-31', Status: 'new' });
});
await tr.waitForTimeout(300);
await tr.evaluate(() => TB.io.exportXlsx(null, 'all'));
await tr.waitForFunction(() => window.__xlsx && window.__xlsx.length > 0, null, { timeout: 5000 });
const bytes = await tr.evaluate(() => window.__xlsx);
const XLSX = OUT + '/export.xlsx';
writeFileSync(XLSX, Buffer.from(bytes));
ok(bytes.length > 1000, 'tracker wyeksportował plik .xlsx', bytes.length + ' B');

/* ---------------------------------------- */
section('FAZA 37 — LibreOffice Calc otwiera plik');
const LO = [SOFFICE, '-env:UserInstallation=file://' + OUT + '/profile', '--headless'];
function lo(args) {
  return execFileSync(LO[0], LO.slice(1).concat(args), { encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'] });
}
let csvLog = '';
try {
  /* 76 = UTF-8; „true” na 9. pozycji = zapisz tak, jak wyświetlane; -1 = wszystkie arkusze */
  csvLog = lo(['--convert-to', 'csv:Text - txt - csv (StarCalc):44,34,76,1,,0,false,true,true,false,false,-1',
    '--outdir', OUT + '/lo', XLSX]);
} catch (e) { csvLog = String(e.stdout || '') + String(e.stderr || e.message); }
const csvs = readdirSync(OUT + '/lo').filter(f => f.endsWith('.csv'));
ok(csvs.length === 1 && /Requests/.test(csvs[0]), 'Calc czyta skoroszyt i widzi arkusz Requests', csvs.join(', ') + ' | ' + csvLog.trim().split('\n').pop());
const reqCsv = csvs.find(f => /Requests/.test(f));
const shown = reqCsv ? readFileSync(OUT + '/lo/' + reqCsv, 'utf8') : '';
/* CSV z komórką wieloliniową zajmuje kilka linii fizycznych — czytamy go
   tym samym parserem, którego używa tracker, a nie split('\n'). */
globalThis.window = globalThis;
new Function(readFileSync(ROOT + '/tracker/tb-parse.js', 'utf8'))();
const table = globalThis.TBParse.delimited(shown, ',');
const lines = table.map(r => r.join(','));
ok(lines[0] === 'Requested by,Subject,Received,Due,Status,Owner,Resolution,Amount,Urgent',
  'nagłówek arkusza to etykiety kolumn', lines[0]);
const row1 = lines.find(l => l.includes('Zażółć')) || '';
ok(row1.includes('Łukasz Żółkiewski') && row1.includes('Zażółć gęślą jaźń'), 'polskie znaki nienaruszone');
ok(/2026-10-06/.test(row1) && !/46301/.test(row1), 'data wyświetla się jako data, nie jako serial 46301', row1);
ok(/1[ ,.\u00a0]?234[.,]56/.test(row1) && /zł/.test(row1), 'kwota z formatem waluty (zł)', row1);
ok(/In progress/.test(row1), 'lista wyboru wyeksportowana jako etykieta');
ok(/TRUE/.test(row1), 'tak/nie jako wartość logiczna');
ok(/-50[.,]50 zł/.test(lines.find(l => l.includes('Ujemna')) || ''), 'ujemna kwota z walutą');
const row4 = lines.find(l => l.includes('cytat')) || '';
ok(row4.includes('=SUM(A1:A9)'), 'tekst zaczynający się od „=” nie jest wykonywany jako formuła', row4);
ok(row4.includes('<b>&"cytat"</b>'), 'znaki XML (<, &, ") przeszły bez uszkodzeń', row4);

/* ---------------------------------------- */
section('FAZA 38 — typy komórek po przejściu przez Calc');
try { lo(['--convert-to', 'xlsx', '--outdir', OUT + '/lo', XLSX]); } catch (e) { /* sprawdzi to asercja niżej */ }
const RESAVED = OUT + '/lo/export.xlsx';
ok(existsSync(RESAVED), 'Calc zapisał plik ponownie jako .xlsx');
const PY = `
import json, sys, datetime, openpyxl
wb = openpyxl.load_workbook(sys.argv[1])
ws = wb['Requests']
head = [c.value for c in ws[1]]
out = {'sheets': wb.sheetnames, 'rows': {}}
for row in ws.iter_rows(min_row=2):
    key = row[1].value
    out['rows'][key] = {head[i]: {'v': (c.value.isoformat() if isinstance(c.value, (datetime.date, datetime.datetime)) else c.value),
                                  't': type(c.value).__name__, 'fmt': c.number_format, 'dt': c.data_type}
                        for i, c in enumerate(row)}
print(json.dumps(out))
`;
let info = null;
try { info = JSON.parse(execFileSync('python3', ['-I', '-c', PY, RESAVED], { encoding: 'utf8' })); }
catch (e) { ok(false, 'openpyxl czyta plik po Calc', String(e.message).slice(0, 200)); }
if (info) {
  const r1 = info.rows['Zażółć gęślą jaźń'] || {};
  ok(r1.Received && r1.Received.t === 'datetime' && r1.Received.v.startsWith('2026-10-06'),
    'Received to data (datetime)', JSON.stringify(r1.Received));
  ok(r1.Amount && r1.Amount.t === 'float' && Math.abs(r1.Amount.v - 1234.56) < 1e-9,
    'Amount to liczba 1234.56', JSON.stringify(r1.Amount));
  ok(r1.Amount && /zł/.test(r1.Amount.fmt), 'format liczbowy waluty przetrwał', r1.Amount && r1.Amount.fmt);
  /* Calc przy zapisie do .xlsx zapisuje wartość logiczną jako formułę =TRUE()
     — to jego konwencja, nie nasz plik. Nasz oryginał sprawdzamy osobno niżej. */
  ok(r1.Urgent && ((r1.Urgent.t === 'bool' && r1.Urgent.v === true) ||
     (r1.Urgent.dt === 'f' && /TRUE/.test(r1.Urgent.v))), 'Urgent nadal jest prawdą logiczną po Calc',
     JSON.stringify(r1.Urgent));
  ok(r1.Resolution && r1.Resolution.v === 'Linia 1\nLinia 2', 'tekst wieloliniowy w jednej komórce');
  const r2 = info.rows['Ujemna kwota'] || {};
  ok(r2.Amount && r2.Amount.v === -50.5, 'ujemna kwota', JSON.stringify(r2.Amount));
  ok(r2.Received && r2.Received.v.startsWith('2024-01-01'), '2024-01-01 bez przesunięcia o dzień');
  const r3 = info.rows['Złe dane'] || {};
  ok(r3.Amount && r3.Amount.t === 'str' && r3.Amount.v === 'abc' && r3.Received.v === '32.13.2026',
    'nieczytelne wartości eksportują się jako tekst, nie jako 0', JSON.stringify(r3.Amount));
  ok(r3.Urgent && r3.Urgent.t === 'str' && r3.Urgent.v === 'może',
    'zła wartość tak/nie wychodzi jako tekst, nie jako TRUE', JSON.stringify(r3.Urgent));
  const r5 = info.rows['Liczba ze śmieciem'] || {};
  ok(r5.Amount && r5.Amount.v === '12abc', '„12abc” wychodzi jako tekst, nie jako 12', JSON.stringify(r5.Amount));
  const r4 = info.rows['<b>&"cytat"</b>'] || {};
  ok(r4['Requested by'] && r4['Requested by'].dt === 's', '„=SUM(…)” zostaje tekstem także po zapisie przez Calc',
    JSON.stringify(r4['Requested by']));
}

const WIDTHS = execFileSync('python3', ['-I', '-c',
  "import openpyxl,sys; ws=openpyxl.load_workbook(sys.argv[1])['Requests']; print(ws.column_dimensions['B'].width, ws.column_dimensions['C'].width)",
  XLSX], { encoding: 'utf8' }).trim().split(' ').map(Number);
ok(WIDTHS[0] >= 19, 'kolumna Subject jest szeroka jak najdłuższy temat, nie jak nagłówek', 'B=' + WIDTHS[0]);
ok(WIDTHS[1] >= 12 && WIDTHS[1] <= 14, 'kolumna dat ma stałą, wystarczającą szerokość', 'C=' + WIDTHS[1]);

const ORIG = execFileSync('python3', ['-I', '-c',
  "import openpyxl,sys; ws=openpyxl.load_workbook(sys.argv[1])['Requests']; r=ws[2]; print(r[8].data_type, r[8].value)",
  XLSX], { encoding: 'utf8' }).trim();
ok(ORIG === 'b True', 'w oryginale tak/nie to komórka typu logicznego (t="b")', ORIG);
const WRAP = execFileSync('python3', ['-I', '-c',
  "import openpyxl,sys; ws=openpyxl.load_workbook(sys.argv[1])['Requests']; a=ws['G2'].alignment; b=ws['B2'].alignment; print(a.wrap_text, a.vertical, b.wrap_text)",
  XLSX], { encoding: 'utf8' }).trim();
ok(WRAP === 'True top None', 'komórka wieloliniowa zawija tekst; zwykła nie', WRAP);

/* ---------------------------------------- */
section('FAZA 39 — render arkusza (PDF → PNG)');
try { lo(['--convert-to', 'pdf', '--outdir', OUT + '/lo', XLSX]); } catch (e) { /* asercja niżej */ }
ok(existsSync(OUT + '/lo/export.pdf'), 'Calc renderuje skoroszyt do PDF');
try {
  execFileSync('pdftoppm', ['-png', '-r', '110', '-f', '1', '-l', '1', OUT + '/lo/export.pdf', OUT + '/lo/page']);
} catch (e) { /* brak pdftoppm nie jest błędem eksportu */ }
const png = readdirSync(OUT + '/lo').find(f => /^page.*\.png$/.test(f));
ok(!!png, 'pierwsza strona jako obraz: ' + (png ? OUT + '/lo/' + png : '—'));

section('Błędy konsoli');
ok(errors.length === 0, 'zero błędów w konsoli', errors.join('\n'));

await browser.close();
console.log('\n' + '='.repeat(60));
console.log('CZĘŚĆ 8: zaliczone ' + pass + ', nieudane ' + fail);
if (fail) { console.log('Nieudane:\n - ' + fails.join('\n - ')); process.exit(1); }
