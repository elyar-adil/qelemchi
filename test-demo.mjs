/* Demo-mode feature test: file operations, search, settings, snapshots, layout. */
import { chromium } from 'playwright';

const PAGE_URL = process.env.QELEMCHI_URL || 'http://127.0.0.1:4173/index.html';
const browser = await chromium.launch(process.env.QELEMCHI_BROWSER_CHANNEL ? { channel: process.env.QELEMCHI_BROWSER_CHANNEL } : {});
const context = await browser.newContext({ viewport: { width: 1440, height: 920 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(`console: ${msg.text()}`); });

async function bootDemo() {
  await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#boot', { state: 'detached' });
  const onboarding = await page.locator('#onboarding:not([hidden])').count();
  if (onboarding) {
    await page.click('[data-connect-tab="demo"]');
    await page.click('#demo-start');
    await page.waitForSelector('#onboarding[hidden]', { state: 'attached' });
  }
  await page.waitForSelector('#editor .CodeMirror', { timeout: 30000 });
  await page.waitForTimeout(500);
}

await bootDemo();
const initial = await page.evaluate(() => ({
  files: [...window.__qelemchi.state.files.keys()],
  active: window.__qelemchi.state.activePath,
  title: window.__qelemchi.state.projectTitle
}));
console.log('initial:', initial);

// New file through the editor overflow menu.
await page.click('#btn-file-actions');
await page.locator('#menu-root').getByRole('button', { name: '新建文件', exact: true }).click();
await page.fill('#prompt-input', 'sections/smoke.tex');
await page.press('#prompt-input', 'Enter');
await page.waitForSelector('.modal', { state: 'detached' });
await page.waitForTimeout(400);
console.log('new file:', await page.evaluate(() => ({
  active: window.__qelemchi.state.activePath,
  exists: window.__qelemchi.state.files.has('sections/smoke.tex'),
  tree: [...document.querySelectorAll('.tree-file')].some((n) => n.dataset.path === 'sections/smoke.tex')
})));

// Type content and confirm the preview updates.
await page.evaluate(() => {
  const cm = document.querySelector('.CodeMirror').CodeMirror;
  cm.setValue('\\section{Smoke Test}\n\nA paragraph for the smoke test with $a^2+b^2=c^2$.');
  window.__qelemchi.openFile('main.tex');
});
await page.waitForTimeout(400);
await page.evaluate(() => {
  const cm = document.querySelector('.CodeMirror').CodeMirror;
  cm.setValue(cm.getValue().replace('\\end{document}', '\\input{sections/smoke}\n\\end{document}'));
});
await page.waitForTimeout(1400);
const previewHasSmoke = await page.evaluate(() =>
  !!(window.__qelemchi.state.preview && window.__qelemchi.state.preview.html.includes('Smoke Test')));
console.log('preview updated:', previewHasSmoke);

// Rename through the per-file context menu.
await page.locator('.tree-file[data-path="sections/smoke.tex"]').click({ button: 'right' });
await page.locator('#menu-root').getByRole('button', { name: '重命名', exact: true }).click();
await page.fill('#prompt-input', 'sections/renamed.tex');
await page.press('#prompt-input', 'Enter');
await page.waitForTimeout(500);
console.log('renamed:', await page.evaluate(() => ({
  exists: window.__qelemchi.state.files.has('sections/renamed.tex'),
  oldGone: !window.__qelemchi.state.files.has('sections/smoke.tex'),
  active: window.__qelemchi.state.activePath
})));

// Delete and confirm.
await page.locator('.tree-file[data-path="sections/renamed.tex"]').click({ button: 'right' });
await page.locator('#menu-root').getByRole('button', { name: '删除', exact: true }).click();
await page.locator('.modal').getByRole('button', { name: '删除', exact: true }).click();
await page.waitForTimeout(500);
console.log('deleted:', await page.evaluate(() => ({
  gone: !window.__qelemchi.state.files.has('sections/renamed.tex'),
  active: window.__qelemchi.state.activePath
})));

// Project search.
await page.click('[data-side-tab="search"]');
await page.fill('#project-search', 'GitHub');
await page.waitForTimeout(600);
const searchCount = await page.locator('.search-hit').count();
console.log('search hits:', searchCount, 'label:', await page.locator('#search-count').textContent());
if (searchCount) {
  await page.locator('.search-hit').first().click();
  await page.waitForTimeout(300);
  console.log('search open:', await page.evaluate(() => window.__qelemchi.state.activePath));
}

// Settings persistence: font size and theme.
await page.click('#btn-settings');
await page.waitForSelector('.modal-settings');
await page.locator('#set-font-size').evaluate((el) => { el.value = '16'; el.dispatchEvent(new Event('input', { bubbles: true })); });
await page.click('[data-settings-tab="appearance"]');
await page.click('[data-theme-choice="dark"]');
await page.waitForTimeout(200);
console.log('settings applied:', await page.evaluate(() => ({
  font: getComputedStyle(document.documentElement).getPropertyValue('--editor-font-size').trim(),
  stored: JSON.parse(localStorage.getItem('qelemchi.settings')).fontSize,
  theme: document.documentElement.dataset.theme
})));
await page.click('.modal-settings .modal-close');
await page.waitForSelector('.modal-settings', { state: 'detached' });

// Reload and verify persistence + restored demo workspace.
await bootDemo();
console.log('after reload:', await page.evaluate(() => ({
  font: getComputedStyle(document.documentElement).getPropertyValue('--editor-font-size').trim(),
  theme: document.documentElement.dataset.theme,
  active: window.__qelemchi.state.activePath,
  files: window.__qelemchi.state.files.size
})));

// Snapshot save → edit → restore.
await page.evaluate(() => {
  const cm = document.querySelector('.CodeMirror').CodeMirror;
  cm.setValue(cm.getValue() + '\n% SNAPSHOT MARKER\n');
});
await page.click('#btn-save');
await page.waitForTimeout(800);
await page.evaluate(() => {
  const cm = document.querySelector('.CodeMirror').CodeMirror;
  cm.setValue(cm.getValue() + '\n% AFTER SNAPSHOT EDIT\n');
});
await page.waitForTimeout(300);
await page.click('#btn-history');
await page.waitForSelector('#history-drawer.is-open');
await page.waitForTimeout(700);
console.log('snapshot rows:', await page.locator('.commit-row').count());
await page.locator('.commit-row').first().click();
await page.waitForSelector('#snapshot-restore');
await page.click('#snapshot-restore');
await page.getByRole('button', { name: '恢复', exact: true }).click();
await page.waitForTimeout(900);
const restored = await page.evaluate(() => document.querySelector('.CodeMirror').CodeMirror.getValue());
console.log('restored contains marker:', restored.includes('SNAPSHOT MARKER'), 'after marker:', restored.includes('AFTER SNAPSHOT EDIT'));

// Restore settings for subsequent runs.
await page.click('#btn-settings');
await page.waitForSelector('.modal-settings');
await page.locator('#set-font-size').evaluate((el) => { el.value = '13.5'; el.dispatchEvent(new Event('input', { bubbles: true })); });
await page.click('[data-settings-tab="appearance"]');
await page.click('[data-theme-choice="light"]');
await page.click('.modal-settings .modal-close');
await page.waitForTimeout(300);

console.log('\nERRORS:');
console.log(errors.length ? errors.join('\n') : 'none');
if (errors.length) {
  console.error(`Browser test failed with ${errors.length} error(s).`);
  process.exitCode = 1;
}
await page.close();
await browser.close();
