import pw from '/opt/node-tools/node_modules/playwright/index.js';
const { chromium } = pw;
import { writeFileSync } from 'node:fs';
const ROOT = '/home/user/Design-';
const SHOTS = ROOT + '/shots';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1420, height: 980 }, deviceScaleFactor: 1.4 });
await ctx.addInitScript(`window.showSaveFilePicker = async () => { throw Object.assign(new Error('x'),{name:'AbortError'}); };`);
const wz = await ctx.newPage();
await wz.goto('file://' + ROOT + '/dist/tracker-wizard.html');
await wz.waitForSelector('#wz-start-cards .wz-tile');
await wz.screenshot({ path: SHOTS + '/1-wizard-start.png' });

await wz.locator('.wz-tile', { hasText: 'Request log' }).first().click();
await wz.waitForSelector('#wz-step-1:not([hidden])');
await wz.screenshot({ path: SHOTS + '/2-wizard-styles.png' });

await wz.locator('#wz-rail a', { hasText: 'Components' }).click();
await wz.waitForSelector('#wz-step-4:not([hidden])');
await wz.locator('.wz-row-main').first().click();
await wz.waitForTimeout(300);
await wz.screenshot({ path: SHOTS + '/3-wizard-components.png' });

/* tabela: panel menu kontekstowego */
await wz.locator('#wz-rail a', { hasText: 'Tabs' }).click();
await wz.waitForTimeout(200);
await wz.locator('#wz-step-3 .wz-row-actions button[title="Edit components"]').nth(1).click();
await wz.waitForTimeout(300);
await wz.locator('#wz-step-4 .wz-row-main').first().click();
await wz.waitForTimeout(400);
await wz.locator('#wz-step-4').screenshot({ path: SHOTS + '/4-wizard-menu-actions.png' });

/* krok Tabs: kafelki presetów; zrzut z elementu, bo karta jest pod listą zakładek */
await wz.locator('#wz-rail a', { hasText: 'Tabs' }).click();
await wz.waitForTimeout(200);
await wz.locator('#wz-step-3').screenshot({ path: SHOTS + '/4b-wizard-tab-presets.png' });

await wz.locator('#wz-rail a', { hasText: 'Alerts' }).click();
await wz.waitForTimeout(300);
await wz.locator('#wz-step-5 .wz-row').first().locator('.wz-mini').first().click();
await wz.waitForTimeout(300);
await wz.screenshot({ path: SHOTS + '/5-wizard-alerts.png' });

/* trackery w motywach, z danymi */
const seeded = async (theme, file) => {
  const html = await wz.evaluate((t) => {
    TBWizard.state.cfg.meta.theme = t;
    return TBWizard.emit(TBWizard.state.cfg, true);
  }, theme);
  writeFileSync('/tmp/claude-0/' + file + '.html', html);
  const p = await ctx.newPage();
  await p.goto('file:///tmp/claude-0/' + file + '.html');
  await p.waitForSelector('#tb-nav a');
  await p.waitForTimeout(900);
  await p.screenshot({ path: SHOTS + '/' + file + '-summary.png' });
  await p.locator('#tb-nav a', { hasText: 'Log' }).click();
  await p.waitForTimeout(700);
  await p.screenshot({ path: SHOTS + '/' + file + '-log.png' });
  return p;
};

const p1 = await seeded('amber-dusk', '6-amber-dusk');
/* profil: ustawiamy dane, żeby zrzut pokazywał awatar, a nie zachętę */
await p1.evaluate(() => TB.profile.save({ name: 'Anna Kowalska', team: 'Client Services', color: 'c3', photo: null }));
await p1.waitForTimeout(400);
/* menu kontekstowe na zrzucie */
await p1.locator('.tb-table tbody tr input.tb-check').nth(0).check();
await p1.waitForTimeout(300);
await p1.locator('.tb-table tbody tr input.tb-check').nth(1).check();
await p1.waitForTimeout(400);
await p1.locator('.tb-table tbody tr').nth(1).click({ button: 'right' });
await p1.waitForSelector('.tb-menu');
await p1.waitForTimeout(250);
await p1.screenshot({ path: SHOTS + '/6-context-menu.png' });
await p1.keyboard.press('Escape');
/* drawer z karteczką */
await p1.locator('.tb-table tbody tr').first().click();
await p1.waitForSelector('.tb-drawer.is-open');
await p1.waitForTimeout(600);
await p1.screenshot({ path: SHOTS + '/7-row-drawer.png' });
await p1.keyboard.press('Escape');
await p1.waitForTimeout(300);
/* alerty pod dzwonkiem */
await p1.locator('#tb-bell').click().catch(() => {});
await p1.waitForTimeout(400);
await p1.screenshot({ path: SHOTS + '/8-alerts.png' });
await p1.keyboard.press('Escape');
await p1.waitForTimeout(200);
await p1.locator('#tb-profile-btn').click();
await p1.waitForTimeout(500);
await p1.screenshot({ path: SHOTS + '/9-profile.png' });
await p1.close();

for (const [t, f] of [['soft-corporate','10-soft-corporate'], ['frosted-mono','11-frosted-mono'],
                      ['crisp-fintech','12-crisp-fintech'], ['pastel-iridescent','13-pastel-iridescent']]) {
  const p = await seeded(t, f);
  await p.close();
}
await b.close();
console.log('zrzuty gotowe');
