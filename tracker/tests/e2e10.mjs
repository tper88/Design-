/* Część 10: instrukcja obsługi dist/tracker-manual.html. */
import pw from '/opt/node-tools/node_modules/playwright/index.js';
const { chromium } = pw;
import { mkdirSync } from 'node:fs';
const ROOT = '/home/user/Design-';
const OUT = '/tmp/claude-0/e2e10';
mkdirSync(OUT, { recursive: true });
const URL = 'file://' + ROOT + '/dist/tracker-manual.html';

let pass = 0, fail = 0; const fails = [];
function ok(c, l, e) { if (c) { pass++; console.log('  ✓ ' + l); } else { fail++; fails.push(l); console.log('  ✗ ' + l + (e ? '  → ' + e : '')); } }
function section(t) { console.log('\n== ' + t); }

const browser = await chromium.launch();
const errors = [];
function watch(p, tag) {
  p.on('console', m => { if (m.type() === 'error') errors.push(tag + ': ' + m.text()); });
  p.on('pageerror', e => errors.push(tag + ' pageerror: ' + e.message));
}

section('FAZA 50 — język: domyślny, przełącznik, pamięć');
const plCtx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'pl-PL' });
const p = await plCtx.newPage();
watch(p, 'pl');
await p.goto(URL);
ok(await p.evaluate(() => document.documentElement.dataset.lang) === 'pl', 'przeglądarka po polsku → instrukcja po polsku');
const visible = async (sel) => p.locator(sel).evaluateAll(els => els.filter(e => e.offsetParent !== null).length);
const plVis = await visible('main .l-pl'), enVis = await visible('main .l-en');
ok(plVis > 40 && enVis === 0, 'widać tylko polskie bloki', plVis + ' PL / ' + enVis + ' EN');
ok((await p.locator('section#start h2').first().innerText()).includes('Zacznij tutaj'), 'nagłówek rozdziału 1 po polsku');
await p.locator('[data-set-lang="en"]').click();
ok(await visible('main .l-pl') === 0 && await visible('main .l-en') > 40, 'przełącznik pokazuje tylko angielski');
ok(await p.title() === 'Tracker builder — user guide', 'tytuł karty zmienia język');
ok(await p.locator('[data-set-lang="en"]').getAttribute('aria-pressed') === 'true', 'przycisk EN ma aria-pressed=true');
await p.reload();
ok(await p.evaluate(() => document.documentElement.dataset.lang) === 'en', 'wybór języka przetrwał przeładowanie');
await p.locator('[data-set-lang="pl"]').click();

section('FAZA 51 — spis treści, kotwice, obrazy');
const tocLinks = await p.locator('#toc a').count();
ok(tocLinks === 45, 'spis treści ma 45 pozycji', tocLinks);
const broken = await p.evaluate(() => [...document.querySelectorAll('a[href^="#"]')]
  .map(a => a.getAttribute('href').slice(1)).filter(id => id && !document.getElementById(id)));
ok(broken.length === 0, 'każda kotwica ma cel', broken.join(','));
await p.locator('#toc a[href="#t-paste"]').click();
await p.waitForTimeout(800);
const top = await p.evaluate(() => document.getElementById('t-paste').getBoundingClientRect().top);
ok(top >= 0 && top < 160, 'klik w spis przewija do rozdziału (pod paskiem)', Math.round(top));
const imgs = await p.evaluate(() => [...document.querySelectorAll('img[data-shot]')].map(i => ({ s: i.dataset.shot, ok: i.complete && i.naturalWidth > 0 })));
ok(imgs.length >= 84 && imgs.every(i => i.ok), 'wszystkie zrzuty się wczytały (' + imgs.length + ')', imgs.filter(i => !i.ok).map(i => i.s).join(','));
const shotsInFile = await p.evaluate(() => Object.keys(JSON.parse(document.getElementById('shots').textContent)).length);
ok(shotsInFile === 42, 'każdy zrzut jest w pliku raz (42), wspólny dla obu języków', shotsInFile);
ok(await p.locator('link[rel="stylesheet"], script[src], img[src^="http"]').count() === 0, 'nic nie jest ładowane z sieci');

section('FAZA 52 — szerokości ekranu');
for (const w of [1280, 900, 390]) {
  await p.setViewportSize({ width: w, height: 900 });
  await p.waitForTimeout(200);
  const over = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(over <= 0, 'brak poziomego przewijania przy ' + w + ' px', 'nadmiar ' + over + ' px');
}
ok(await p.locator('#menu-btn').isVisible(), 'na telefonie jest przycisk spisu treści');
ok(!(await p.locator('#toc').isVisible()), 'spis treści schowany do kliknięcia');
await p.locator('#menu-btn').click();
ok(await p.locator('#toc').isVisible(), 'przycisk otwiera spis treści');
await p.locator('#toc a[href="#keys"]').click();
await p.waitForTimeout(500);
ok(!(await p.locator('#toc').isVisible()), 'wybór pozycji zamyka spis');
await p.screenshot({ path: OUT + '/mobile.png' });

section('FAZA 53 — druk');
await p.setViewportSize({ width: 1280, height: 900 });
await p.emulateMedia({ media: 'print' });
ok(!(await p.locator('.topbar').isVisible()) && !(await p.locator('#toc').isVisible()), 'w druku bez paska i spisu treści');
ok(await visible('main .l-en') === 0, 'w druku tylko aktywny język');
await p.emulateMedia({ media: 'screen' });

section('Błędy konsoli');
ok(errors.length === 0, 'zero błędów w konsoli', errors.join('\n'));
await browser.close();
console.log('\n' + '='.repeat(60));
console.log('CZĘŚĆ 10: zaliczone ' + pass + ', nieudane ' + fail);
if (fail) { console.log('Nieudane:\n - ' + fails.join('\n - ')); process.exit(1); }
