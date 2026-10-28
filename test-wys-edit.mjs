/* WYSIWYG editing round-trip: DOM edits write back to LaTeX, modes stay in sync. */
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
await page.evaluate(() => window.__qelemchi.openFile('sections/intro.tex'));
await page.click('#editor-mode-tabs [data-mode="wysiwyg"]');
await page.waitForSelector('#wysiwyg:not([hidden]) .wys-doc', { timeout: 15000 });
await page.waitForTimeout(800);

const before = await page.evaluate(() => window.__qelemchi.state.files.get('sections/intro.tex').text);
const paraCountBefore = await page.locator('#wysiwyg .wys-para').count();

// Place the caret at the true end of the first paragraph, then type.
await page.evaluate(() => {
  const el = document.querySelector('#wysiwyg .wys-para[data-path="sections/intro.tex"] .wys-text');
  el.focus();
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
});
await page.keyboard.type(' 编辑测试XYZ');
await page.waitForTimeout(300);
const afterType = await page.evaluate(() => window.__qelemchi.state.files.get('sections/intro.tex').text);
console.log('typed into source:', afterType.includes('编辑测试XYZ'), 'cite kept:', afterType.includes('\\cite{'));

// Enter at the paragraph end creates a real new paragraph.
await page.keyboard.press('Enter');
await page.waitForTimeout(300);
const emptyCreated = await page.locator('#wysiwyg .wys-new').count();
await page.keyboard.type('新段落ABC');
await page.waitForTimeout(400);
const afterEnter = await page.evaluate(() => window.__qelemchi.state.files.get('sections/intro.tex').text);
const match = /编辑测试XYZ(\s*)新段落ABC/.exec(afterEnter);
console.log('enter made empty block:', emptyCreated > 0, 'new paragraph own block:', /编辑测试XYZ\s*\n\s*\n\s*新段落ABC/.test(afterEnter), 'separator:', JSON.stringify(match && match[1]));
console.log('blocks grew:', (await page.locator('#wysiwyg .wys-para').count()) > paraCountBefore);

// Hover affordance on a read-only visual block opens source at that line.
await page.evaluate(() => window.__qelemchi.openFile('sections/method.tex'));
await page.waitForTimeout(900);
const figure = page.locator('#wysiwyg .wys-block-figure').first();
await figure.hover();
await page.waitForTimeout(250);
const toolOpacity = await page.evaluate(() => {
  const t = document.querySelector('#wysiwyg .wys-block-figure .wys-tool');
  return t ? getComputedStyle(t).opacity : null;
});
await figure.locator('.wys-tool').click();
await page.waitForTimeout(600);
const srcState = await page.evaluate(() => ({
  mode: window.__qelemchi.state.editorMode,
  cmVisible: !document.querySelector('.editor-cm')?.hidden,
  wysHidden: document.querySelector('#wysiwyg').hidden,
  cursor: document.querySelector('.CodeMirror')?.CodeMirror?.getCursor()
}));
console.log('hover tool opacity:', toolOpacity, 'source state:', JSON.stringify(srcState));

// Source edits flow back into the visual surface.
await page.evaluate(() => {
  const cm = document.querySelector('.CodeMirror').CodeMirror;
  cm.replaceRange('\n\n源码里新增的一段。\n', { line: cm.lastLine(), ch: 0 }, { line: cm.lastLine(), ch: 0 });
});
await page.click('#editor-mode-tabs [data-mode="wysiwyg"]');
await page.waitForTimeout(900);
const visualHasNew = await page.locator('#wysiwyg .wys-text').filter({ hasText: '源码里新增的一段' }).count();
console.log('source edit reflected in visual:', visualHasNew > 0);

// Text edits survive a reload of the visual surface.
await page.evaluate(() => window.__qelemchi.openFile('sections/intro.tex'));
await page.waitForTimeout(700);
const finalText = await page.evaluate(() => window.__qelemchi.state.files.get('sections/intro.tex').text);
console.log('text persisted:', finalText.includes('编辑测试XYZ') && finalText.includes('新段落ABC'));
console.log('original first line preserved:', finalText.startsWith(before.split('\n')[0]));
console.log('errors:', errors);
if (errors.length) {
  console.error(`Browser test failed with ${errors.length} error(s).`);
  process.exitCode = 1;
}
await browser.close();
