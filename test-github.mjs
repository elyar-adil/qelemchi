/* Mocked GitHub API end-to-end test: connect → edit → commit → history → compile. */
import { chromium } from 'playwright';
import { Buffer } from 'node:buffer';

const PAGE_URL = process.env.QELEMCHI_URL || 'http://127.0.0.1:4173/index.html';
const OWNER = 'ada';
const REPO = 'paper-2026';
const TOKEN = 'github_pat_mock_token_0123456789';

const model = {
  head: 'c0',
  tree: '0000',
  workflow: false,
  blobSeq: 10,
  treeSeq: 0,
  commitSeq: 0,
  files: new Map(),
  pendingBlobs: new Map()
};
const commits = [];
const calls = [];
let runPolls = 0;

function sha(prefix) {
  const n = prefix === 'blob' ? model.blobSeq++ : prefix === 'tree' ? model.treeSeq++ : model.commitSeq++;
  return `${prefix}${String(n).padStart(3, '0')}${'0'.repeat(29)}`.slice(0, 40);
}
function addFile(path, text) {
  model.files.set(path, { sha: sha('blob'), text });
}
function asTree() {
  return [...model.files.entries()].map(([path, f]) => ({
    path, mode: '100644', type: 'blob', sha: f.sha, size: Buffer.byteLength(f.text || '', 'utf8')
  }));
}
function recordCommit(message, treeSha) {
  const id = sha('commit');
  model.head = id;
  model.tree = treeSha;
  commits.unshift({
    sha: id,
    commit: {
      message,
      author: { name: 'Ada Lovelace', date: new Date().toISOString() },
      tree: { sha: treeSha }
    },
    author: { login: 'ada' },
    html_url: `https://github.com/${OWNER}/${REPO}/commit/${id}`
  });
  return { sha: id, tree: { sha: treeSha } };
}

addFile('main.tex', [
  '\\documentclass{article}',
  '\\title{Mock Paper}',
  '\\author{Ada Lovelace}',
  '\\begin{document}',
  '\\maketitle',
  '\\section{Introduction}',
  'Hello $x^2 + y^2 = z^2$.',
  '\\input{sections/one}',
  '\\end{document}'
].join('\n'));
addFile('sections/one.tex', '\\section{Details}\nSome details with $\\alpha$ and a reference.');
commits.push({
  sha: 'c0',
  commit: { message: 'Initial paper', author: { name: 'Ada Lovelace', date: new Date(Date.now() - 86400000).toISOString() }, tree: { sha: model.tree } },
  author: { login: 'ada' },
  html_url: `https://github.com/${OWNER}/${REPO}/commit/c0`
});
model.head = 'c0';

const PDF = Buffer.from([
  '%PDF-1.4',
  '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
  '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
  '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >> endobj',
  '4 0 obj << /Length 44 >> stream',
  'BT /F1 24 Tf 72 720 Td (Mock PDF) Tj ET',
  'endstream endobj',
  'trailer << /Root 1 0 R >>',
  '%%EOF'
].join('\n'));

const browser = await chromium.launch(process.env.QELEMCHI_BROWSER_CHANNEL ? { channel: process.env.QELEMCHI_BROWSER_CHANNEL } : {});
const context = await browser.newContext({ viewport: { width: 1440, height: 920 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(`console: ${msg.text()}`); });

await context.route('https://api.github.com/**', async (route) => {
  const req = route.request();
  const url = new URL(req.url());
  const path = url.pathname;
  const method = req.method();
  calls.push(`${method} ${path}${url.search}`);

  const json = (data, status = 200) => route.fulfill({
    status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify(data)
  });
  const missing = () => json({ message: 'Not Found' }, 404);
  const auth = req.headers()['authorization'];
  if (!auth || !auth.includes(TOKEN)) return json({ message: 'Bad credentials' }, 401);

  if (method === 'GET' && path === '/user') {
    return json({ login: 'ada', name: 'Ada Lovelace', avatar_url: '' });
  }
  if (method === 'GET' && path === '/user/repos') {
    return json([{ name: REPO, full_name: `${OWNER}/${REPO}`, owner: { login: OWNER }, private: true, default_branch: 'main', updated_at: new Date().toISOString(), permissions: { push: true } }]);
  }
  const base = `/repos/${OWNER}/${REPO}`;
  if (method === 'GET' && path === base) {
    return json({ name: REPO, full_name: `${OWNER}/${REPO}`, private: true, default_branch: 'main' });
  }
  if (method === 'GET' && path === `${base}/git/ref/heads/main`) {
    return json({ ref: 'refs/heads/main', object: { sha: model.head } });
  }
  if (method === 'PATCH' && path === `${base}/git/refs/heads/main`) {
    const body = JSON.parse(req.postData() || '{}');
    if (body.force) return json({ message: 'force not allowed' }, 422);
    model.head = body.sha;
    return json({ ref: 'refs/heads/main', object: { sha: body.sha } });
  }
  if (method === 'GET' && path.startsWith(`${base}/git/commits/`)) {
    const id = path.split('/').pop();
    const found = commits.find((c) => c.sha === id) || commits[0];
    return json({ sha: found.sha, tree: { sha: model.tree }, parents: [] });
  }
  if (method === 'GET' && path.startsWith(`${base}/git/trees/`)) {
    return json({ sha: model.tree, tree: asTree(), truncated: false });
  }
  if (method === 'GET' && path.startsWith(`${base}/git/blobs/`)) {
    const id = path.split('/').pop();
    const file = [...model.files.values()].find((f) => f.sha === id);
    if (!file) return missing();
    return json({ sha: id, encoding: 'base64', content: Buffer.from(file.text, 'utf8').toString('base64'), size: Buffer.byteLength(file.text, 'utf8') });
  }
  if (method === 'POST' && path === `${base}/git/blobs`) {
    const body = JSON.parse(req.postData() || '{}');
    const text = Buffer.from(body.content || '', body.encoding === 'base64' ? 'base64' : 'utf8').toString('utf8');
    const id = sha('blob');
    model.pendingBlobs.set(id, text);
    return json({ sha: id, url: `https://api.github.com${base}/git/blobs/${id}` }, 201);
  }
  if (method === 'POST' && path === `${base}/git/trees`) {
    const body = JSON.parse(req.postData() || '{}');
    const treeSha = sha('tree');
    // Apply entries against the current model, recovering text for blobs
    // created just above.
    for (const entry of body.tree || []) {
      if (entry.sha === null) model.files.delete(entry.path);
      else {
        const existing = model.files.get(entry.path);
        const text = model.pendingBlobs.get(entry.sha) ?? (existing ? existing.text : '');
        model.files.set(entry.path, { sha: entry.sha, text });
      }
    }
    model.tree = treeSha;
    return json({ sha: treeSha, tree: asTree() }, 201);
  }
  if (method === 'POST' && path === `${base}/git/commits`) {
    const body = JSON.parse(req.postData() || '{}');
    const result = recordCommit(body.message, body.tree);
    return json(result, 201);
  }
  if (method === 'POST' && path === `${base}/git/refs`) {
    const body = JSON.parse(req.postData() || '{}');
    model.head = body.sha;
    return json({ ref: body.ref, object: { sha: body.sha } }, 201);
  }
  if (method === 'GET' && path === `${base}/commits`) {
    return json(commits);
  }
  if (method === 'GET' && path === `${base}/actions/workflows/qelemchi.yml`) {
    if (!model.workflow) return missing();
    return json({ id: 1, name: 'Qelemchi PDF', path: '.github/workflows/qelemchi.yml' });
  }
  if (method === 'POST' && path === `${base}/actions/workflows/qelemchi.yml/dispatches`) {
    model.workflow = true;
    return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
  }
  if (method === 'GET' && path === `${base}/actions/workflows/qelemchi.yml/runs`) {
    runPolls++;
    const created = new Date(Date.now() - 2000).toISOString();
    return json({
      workflow_runs: [{
        id: 77, run_number: 7, status: 'completed', conclusion: 'success', head_branch: 'main',
        created_at: created, html_url: `https://github.com/${OWNER}/${REPO}/actions/runs/77`
      }]
    });
  }
  if (method === 'GET' && path === `${base}/actions/runs/77/jobs`) {
    return json({ jobs: [{ name: 'build', status: 'completed', conclusion: 'success', steps: [{ name: 'Compile LaTeX', status: 'completed', conclusion: 'success' }] }] });
  }
  if (method === 'GET' && path === `${base}/contents/build/main.pdf`) {
    return route.fulfill({
      status: 200, contentType: 'application/pdf',
      headers: { 'access-control-allow-origin': '*' }, body: PDF
    });
  }
  console.log('UNHANDLED MOCK', method, path);
  return missing();
});

await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#boot', { state: 'detached' });
await page.click('[data-connect-tab="github"]');
await page.fill('#token-input', TOKEN);
await page.fill('#repo-input', `${OWNER}/${REPO}`);
await page.click('#connect-submit');
await page.waitForSelector('#onboarding[hidden]', { state: 'attached', timeout: 20000 });
await page.waitForSelector('#pages .page:not(.measure-page)', { timeout: 20000 });
await page.waitForTimeout(600);

const connected = await page.evaluate(() => ({
  mode: window.__qelemchi.state.mode,
  repo: window.__qelemchi.state.repo?.full,
  files: [...window.__qelemchi.state.files.keys()],
  main: window.__qelemchi.state.mainPath,
  connected: window.__qelemchi.state.connected,
  pages: document.querySelectorAll('#pages .page:not(.measure-page)').length,
  title: document.querySelector('#project-title')?.textContent
}));
console.log('connected:', connected);

// Edit through CodeMirror and commit.
await page.evaluate(() => {
  const cm = document.querySelector('.CodeMirror').CodeMirror;
  const value = cm.getValue();
  cm.setValue(value.replace('\\end{document}', '\\section{Added}\nA new paragraph from the mocked test.\n\n\\end{document}'));
});
await page.waitForTimeout(300);
const dirty = await page.evaluate(() => window.__qelemchi.state.dirty.size + window.__qelemchi.state.deleted.size);
console.log('pending changes:', dirty);
await page.click('#btn-save');
await page.waitForSelector('#commit-message');
console.log('commit files:', await page.locator('.commit-file').count());
await page.fill('#commit-message', 'Add mocked section');
await page.getByRole('button', { name: '提交', exact: true }).click();
await page.waitForSelector('.modal', { state: 'detached', timeout: 20000 }).catch(() => null);
await page.waitForTimeout(800);
console.log('after commit:', await page.evaluate(() => ({
  head: window.__qelemchi.state.lastCommit?.sha,
  changes: window.__qelemchi.state.dirty.size + window.__qelemchi.state.deleted.size,
  dirty: document.querySelector('#save-dot')?.className
})), 'mock head:', model.head);

// History.
await page.click('#btn-history');
await page.waitForSelector('#history-drawer.is-open');
await page.waitForTimeout(600);
console.log('history rows:', await page.locator('.commit-row').count());
const firstMessage = await page.locator('.commit-row .commit-msg').first().textContent().catch(() => '');
console.log('history first:', firstMessage);
await page.click('#history-close');
await page.waitForTimeout(400);

// Compile (workflow missing → install → dispatch → completed → PDF).
await page.click('#btn-compile');
await page.waitForSelector('.modal');
await page.waitForSelector('#compile-install:not([hidden])', { timeout: 15000 });
console.log('install workflow offered');
await page.click('#compile-install');
await page.waitForSelector('#pdf-stage:not([hidden])', { timeout: 30000 });
await page.waitForTimeout(600);
const compile = await page.evaluate(() => ({
  title: document.querySelector('#compile-title')?.textContent,
  step3: document.querySelector('#compile-step')?.textContent,
  pdfSrc: document.querySelector('#pdf-frame')?.getAttribute('src'),
  view: window.__qelemchi.state.previewView,
  pdfSize: window.__qelemchi.state.pdfBlob?.size,
  hasWorkflow: window.__qelemchi.state.hasWorkflow
}));
console.log('compile:', compile);
console.log('run polls:', runPolls);
console.log('mutating calls:', calls.filter((c) => !c.startsWith('GET')));
console.log('commit count:', commits.length, 'head:', model.head);

console.log('\nERRORS:');
console.log(errors.length ? errors.join('\n') : 'none');
if (errors.length) {
  console.error(`Browser test failed with ${errors.length} error(s).`);
  process.exitCode = 1;
}
await page.close();
await browser.close();
