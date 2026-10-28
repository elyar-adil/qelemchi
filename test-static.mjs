import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const htmlPath = path.join(root, 'index.html');
const [html, info] = await Promise.all([
  readFile(htmlPath, 'utf8'),
  stat(htmlPath)
]);

assert.ok(info.size > 1_000_000, 'generated index.html looks unexpectedly small');
assert.match(html, /^<!doctype html>/i, 'HTML document must have a doctype');
assert.match(html, /<title>Qelemchi/, 'page title should identify the app');
assert.match(html, /Content-Security-Policy/, 'CSP must remain present');
assert.match(html, /https:\/\/api\.github\.com/, 'GitHub API must be permitted by CSP');
assert.match(html, /fastly\.jsdelivr\.net/, 'TeX asset CDN configuration is missing');
assert.match(html, /window\.__qelemchi/, 'app test/debug API is missing');
assert.match(html, /id="onboarding"/, 'onboarding shell is missing');
assert.match(html, /id="editor"/, 'editor shell is missing');
assert.match(html, /id="preview-pane"/, 'PDF preview shell is missing');
assert.doesNotMatch(html, /\/\*__[A-Z_]+__\*\//, 'unreplaced build placeholder remains');
assert.doesNotMatch(html, /__DEMO_IMAGE_BASE64__|__CONFERENCE_KITS__/, 'unreplaced app data placeholder remains');
assert.doesNotMatch(html, /<script\b[^>]*\bsrc\s*=/i, 'the single-file app must not depend on external script tags');

console.log(`static checks passed: index.html (${(info.size / 1024 / 1024).toFixed(2)} MiB)`);
