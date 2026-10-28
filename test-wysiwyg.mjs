/* WYSIWYG visual-surface checks: seamless paper flow, resolved citations. */
import { chromium } from 'playwright';

const PAGE_URL = process.env.QELEMCHI_URL || 'http://127.0.0.1:4173/index.html';
const browser = await chromium.launch(process.env.QELEMCHI_BROWSER_CHANNEL ? { channel: process.env.QELEMCHI_BROWSER_CHANNEL } : {});
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(`console: ${msg.text()}`); });

await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#boot', { state: 'detached' });
if (await page.locator('#onboarding:not([hidden])').count()) {
  await page.click('[data-connect-tab="demo"]');
  await page.click('#demo-start');
  await page.waitForSelector('#onboarding[hidden]', { state: 'attached' });
}
await page.waitForTimeout(1000);
await page.click('#editor-mode-tabs [data-mode="wysiwyg"]');
await page.waitForSelector('#wysiwyg:not([hidden]) .wys-doc', { timeout: 15000 });

for (const file of ['main.tex', 'sections/method.tex', 'sections/results.tex', 'sections/intro.tex']) {
  await page.evaluate((f) => window.__qelemchi.openFile(f), file);
  await page.waitForTimeout(1200);
  const report = await page.evaluate(() => {
    const host = document.querySelector('#wysiwyg');
    const doc = host.querySelector('.wys-doc');
    const cs = doc ? getComputedStyle(doc) : {};
    return {
      active: window.__qelemchi.state.activePath,
      mode: window.__qelemchi.state.editorMode,
      cards: host.querySelectorAll('.wys-card-head, .wys-src-btn, .wys-readonly-badge').length,
      tools: host.querySelectorAll('.wys-tool').length,
      blocks: host.querySelectorAll('.wys-block').length,
      headings: [...host.querySelectorAll('.wys-heading .wys-text')].map((n) => n.textContent.trim()).slice(0, 8),
      cites: [...host.querySelectorAll('.wys-cite')].map((n) => n.textContent).slice(0, 10),
      refs: [...host.querySelectorAll('.wys-ref-atom')].map((n) => n.textContent).slice(0, 6),
      figures: host.querySelectorAll('.wys-block-figure img').length,
      tables: host.querySelectorAll('.wys-table').length,
      equations: host.querySelectorAll('.wys-equation').length,
      eqNumbers: [...host.querySelectorAll('.wys-eq-number')].map((n) => n.textContent),
      captions: [...host.querySelectorAll('.wys-caption')].map((n) => n.textContent.trim()).slice(0, 6),
      padding: cs.padding,
      width: doc ? Math.round(doc.getBoundingClientRect().width) : 0,
      inPane: doc ? (doc.getBoundingClientRect().right <= host.getBoundingClientRect().right + 1) : false
    };
  });
  console.log(JSON.stringify(report));
  if (file !== 'main.tex') await page.locator('#wysiwyg').screenshot({ path: `/tmp/wys-${file.split('/')[1]}.png` });
}
console.log('errors:', errors);
if (errors.length) {
  console.error(`Browser test failed with ${errors.length} error(s).`);
  process.exitCode = 1;
}
await browser.close();
