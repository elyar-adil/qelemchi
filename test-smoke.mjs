import { chromium } from 'playwright';

const URL = process.env.QELEMCHI_URL || 'http://127.0.0.1:4173/index.html';
const browser = await chromium.launch(process.env.QELEMCHI_BROWSER_CHANNEL ? { channel: process.env.QELEMCHI_BROWSER_CHANNEL } : {});
const context = await browser.newContext({ viewport: { width: 1440, height: 920 }, acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
});
page.on('requestfailed', (req) => {
  if (!/sourceMappingURL|\.map($|\?)/.test(req.url())) errors.push(`requestfailed: ${req.url()} ${req.failure()?.errorText}`);
});

await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#boot', { state: 'detached', timeout: 15000 });
console.log('boot gone');

const onboardingVisible = await page.locator('#onboarding:not([hidden])').count();
console.log('onboarding visible:', onboardingVisible);
if (onboardingVisible) {
  await page.click('[data-connect-tab="demo"]');
  await page.click('#demo-start');
  await page.waitForSelector('#onboarding[hidden]', { state: 'attached', timeout: 10000 });
}

await page.waitForSelector('#editor .CodeMirror', { timeout: 30000 });
await page.waitForTimeout(1200);

const info = await page.evaluate(() => ({
  pages: window.__qelemchi.state.pdfPages || 0,
  pageLabel: document.querySelector('#page-count')?.textContent,
  state: document.querySelector('#preview-state')?.textContent,
  math: document.querySelectorAll('mjx-container').length,
  trees: document.querySelectorAll('.tree-file').length,
  outline: document.querySelector('#outline-count')?.textContent,
  title: document.querySelector('#project-title')?.textContent,
  warnings: document.querySelector('#issue-label')?.textContent,
  word: document.querySelector('#word-count')?.textContent,
  zoom: document.querySelector('#btn-zoom-reset')?.textContent,
  pdfCanvas: document.querySelectorAll('#pdf-canvas canvas').length
}));
console.log(info);
await page.screenshot({ path: '/tmp/qelemchi-demo.png', fullPage: false });

// theme toggle
const themeBefore = await page.getAttribute('html', 'data-theme');
await page.click('#btn-theme');
const themeAfter = await page.getAttribute('html', 'data-theme');
console.log('theme:', themeBefore, '->', themeAfter);

// settings
await page.click('#btn-settings');
await page.waitForSelector('.modal-settings');
await page.click('[data-settings-tab="appearance"]');
await page.click('[data-theme-choice="light"]');
await page.screenshot({ path: '/tmp/qelemchi-settings.png' });
await page.click('.modal-settings .modal-close');
await page.waitForSelector('.modal-settings', { state: 'detached' });

// palette
await page.keyboard.press('Meta+k');
await page.waitForSelector('#palette-input');
await page.fill('#palette-input', '设置');
const paletteItems = await page.locator('.palette-item').count();
console.log('palette items for 设置:', paletteItems);
await page.screenshot({ path: '/tmp/qelemchi-palette.png' });
await page.keyboard.press('Escape');
await page.waitForSelector('#palette-input', { state: 'detached' });

// demo save + history
await page.click('#btn-save');
await page.waitForTimeout(900);
await page.click('#btn-history');
await page.waitForSelector('#history-drawer.is-open');
await page.waitForTimeout(500);
const historyRows = await page.locator('.commit-row').count();
console.log('snapshot rows:', historyRows);
await page.screenshot({ path: '/tmp/qelemchi-history.png' });
await page.click('#history-close');
await page.waitForTimeout(350);

// compile modal for demo
await page.click('#btn-compile');
await page.waitForSelector('.modal');
const compileTitle = await page.locator('.modal h2').first().textContent();
console.log('compile modal:', compileTitle);
await page.click('.modal .modal-close');
await page.waitForSelector('.modal', { state: 'detached' });

// export zip
const downloadPromise = page.waitForEvent('download', { timeout: 8000 }).catch(() => null);
await page.evaluate(() => window.__qelemchi.exportProjectZip());
const download = await downloadPromise;
console.log('download:', download ? download.suggestedFilename() : 'none');
if (download) await download.saveAs('/tmp/qelemchi-export.zip');

// mobile
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(500);
const mobile = await page.evaluate(() => ({
  switchVisible: !document.querySelector('#mobile-switch')?.hidden,
  pane: document.querySelector('#workspace')?.dataset.mobilePane,
  previewDisplay: getComputedStyle(document.querySelector('#preview-pane')).display
}));
console.log('mobile:', mobile);
await page.screenshot({ path: '/tmp/qelemchi-mobile.png' });
await page.click('[data-mobile-pane="preview"]');
await page.waitForTimeout(900);
const mobileAfter = await page.evaluate(() => ({
  pane: document.querySelector('#workspace')?.dataset.mobilePane,
  previewDisplay: getComputedStyle(document.querySelector('#preview-pane')).display,
  pages: window.__qelemchi.state.pdfPages || 0
}));
console.log('mobile preview:', mobileAfter);
await page.screenshot({ path: '/tmp/qelemchi-mobile-preview.png' });

console.log('\nERRORS:');
console.log(errors.length ? errors.join('\n') : 'none');
if (errors.length) {
  console.error(`Browser test failed with ${errors.length} error(s).`);
  process.exitCode = 1;
}
await page.close();
await browser.close();
