/* Cold/warm CDN asset loading: download, SHA-256 verify, IndexedDB cache,
   second compile works without touching the network. */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';

// The CSP only allows the approved jsDelivr origins, so the cold-download test
// needs a throwaway build that points at the local static server instead.
if (!process.env.QELEMCHI_TEST_URL) {
  let html = readFileSync('index.html', 'utf8');
  for (const host of [
    'https://fastly.jsdelivr.net/gh/elyar-adil/qelemchi@v1/assets/tex/',
    'https://gcore.jsdelivr.net/gh/elyar-adil/qelemchi@v1/assets/tex/',
    'https://testingcf.jsdelivr.net/gh/elyar-adil/qelemchi@v1/assets/tex/'
  ]) html = html.replaceAll(host, 'http://127.0.0.1:4173/tex-assets/');
  if (!html.includes('http://127.0.0.1:4173/tex-assets/')) throw new Error('asset hosts not replaced');
  html = html.replace('connect-src https://api.github.com ', 'connect-src http://127.0.0.1:4173 https://api.github.com ');
  writeFileSync('index.test.html', html);
}

const PAGE_URL = process.env.QELEMCHI_TEST_URL || 'http://127.0.0.1:4173/index.test.html';
const browser = await chromium.launch({ channel: 'msedge' });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
if (process.env.QELEMCHI_FALLBACK) {
  // Force the last jsDelivr endpoint to prove the fallback loop works.
  await context.route(/https:\/\/(fastly|gcore)\.jsdelivr\.net\/.*/, (route) => route.abort());
}
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

async function boot() {
  await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#boot', { state: 'detached', timeout: 30000 });
  if (await page.locator('#onboarding:not([hidden])').count()) {
    await page.click('[data-connect-tab="demo"]');
    await page.click('#demo-start');
    await page.waitForSelector('#onboarding[hidden]', { state: 'attached' });
  }
  await page.waitForTimeout(600);
}

async function compile() {
  const requests = [];
  const onReq = (r) => {
    const u = new globalThis.URL(r.url());
    if (/\/tex(-assets)?\//.test(u.pathname)) requests.push(`${u.host}/${u.pathname.split('/').pop()}`);
  };
  page.on('request', onReq);
  const started = Date.now();
  await page.evaluate(() => window.__qelemchi.refreshPreview());
  let done = false;
  for (let i = 0; i < 480; i++) {
    done = await page.evaluate(() => window.__qelemchi.state.pdfSource === 'local' && !!window.__qelemchi.state.pdfBlob);
    if (done) break;
    await page.waitForTimeout(500);
  }
  if (!done) throw new Error('compile did not finish');
  const ms = Date.now() - started;
  page.off('request', onReq);
  const info = await page.evaluate(() => ({
    pages: window.__qelemchi.state.pdfPages,
    size: window.__qelemchi.state.pdfBlob.size,
    label: window.__qelemchi.state.pdfLabel,
    error: window.__qelemchi.state.localTex.error
  }));
  return { ms, requests, ...info };
}

await boot();
const cold = await compile();
console.log('cold:', JSON.stringify(cold));

const cache = await page.evaluate(() => new Promise((resolve) => {
  const req = indexedDB.open('qelemchi');
  req.onsuccess = () => {
    const db = req.result;
    const tx = db.transaction('kv', 'readonly');
    const store = tx.objectStore('kv');
    const keysReq = store.getAllKeys();
    const valsReq = store.getAll();
    tx.oncomplete = () => {
      const keys = keysReq.result.filter((k) => String(k).startsWith('texasset:'));
      const sizes = valsReq.result
        .filter((v, i) => String(keysReq.result[i]).startsWith('texasset:'))
        .map((v) => Math.round(String(v).length * 0.75));
      resolve({ count: keys.length, bytes: sizes.reduce((a, b) => a + b, 0), sizes });
    };
  };
}));
console.log('cache:', JSON.stringify(cache));

await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('#boot', { state: 'detached', timeout: 30000 });
await page.waitForTimeout(600);
const warm = await compile();
console.log('warm:', JSON.stringify(warm));
console.log('errors:', errors);
await page.screenshot({ path: '/tmp/qelemchi-local-pdf.png', fullPage: false });
await browser.close();
