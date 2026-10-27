#!/usr/bin/env node
/* ==========================================================================
   Qelemchi single-file build
   Concatenates templates, styles, the TeX preview engine, the app modules,
   MathJax, CodeMirror and the demo figure into one standalone index.html.
   ========================================================================== */

import { readFile, writeFile, stat, mkdir, copyFile, rm } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createHash } from 'node:crypto';

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const outFile = path.join(ROOT, 'index.html');

const read = (rel) => readFile(path.join(ROOT, rel), 'utf8');
const readBuffer = (rel) => readFile(path.join(ROOT, rel));
const filesIn = (rel, ext) => readdirSync(path.join(ROOT, rel))
  .filter((name) => name.endsWith(ext))
  .sort();

// Every regular file below `rel`, as POSIX paths relative to `rel`.
function filesUnder(rel, prefix = '') {
  const out = [];
  const dir = path.join(ROOT, rel, prefix);
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const child = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...filesUnder(rel, child));
    else if (entry.isFile()) out.push(child);
  }
  return out.sort();
}

// Large TeX payloads live in a public CDN-backed repository instead of the
// HTML. The build copies them to tex-assets/ and embeds a tiny manifest with
// per-file hashes; the runtime verifies each download and caches it in
// IndexedDB, so later compiles work offline.
const TEX_ASSET_HOSTS = [
  'https://fastly.jsdelivr.net/gh/elyar-adil/qelemchi@v1/assets/tex/',
  'https://gcore.jsdelivr.net/gh/elyar-adil/qelemchi@v1/assets/tex/',
  'https://testingcf.jsdelivr.net/gh/elyar-adil/qelemchi@v1/assets/tex/'
];

// `src` is the committed file; `path` is its location relative to the CDN
// base (the same layout as assets/tex/). Only these six files are published.
const TEX_ASSET_FILES = [
  { key: 'wasm:pdftex', src: 'wasm/pdftex.wasm.gz', path: 'wasm/pdftex.wasm.gz' },
  { key: 'wasm:xetex', src: 'wasm/xetex.wasm.gz', path: 'wasm/xetex.wasm.gz' },
  { key: 'wasm:dvipdfm', src: 'wasm/dvipdfm.wasm.gz', path: 'wasm/dvipdfm.wasm.gz' },
  { key: 'format:pdftex', src: 'format/pdflatex.fmt.gz', path: 'format/pdflatex.fmt.gz' },
  { key: 'format:xetex', src: 'format/xelatex.fmt.gz', path: 'format/xelatex.fmt.gz' },
  { key: 'texmf', src: 'texmf.bin.gz', path: 'texmf.bin.gz' }
];

async function texAssetBundle() {
  const outDir = path.join(ROOT, 'tex-assets');
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  const files = {};
  const manifest = { version: 1, generated: new Date().toISOString(), files: {} };
  let total = 0;
  for (const entry of TEX_ASSET_FILES) {
    const buf = await readBuffer(`assets/tex/${entry.src}`);
    const sha256 = createHash('sha256').update(buf).digest('hex');
    files[entry.key] = { file: entry.path, sha256, size: buf.length };
    manifest.files[entry.path] = { sha256, size: buf.length, key: entry.key };
    total += buf.length;
    const target = path.join(outDir, entry.path);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(path.join(ROOT, 'assets/tex', entry.src), target);
  }
  await copyFile(path.join(ROOT, 'assets/tex/README.md'), path.join(outDir, 'README.md'));
  await writeFile(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  const engine = {};
  for (const kind of ['pdftex', 'xetex', 'dvipdfm']) {
    engine[kind] = (await readBuffer(`assets/tex/engine/${kind}.js`)).toString('base64');
  }
  return {
    config: { version: 1, bases: TEX_ASSET_HOSTS, engine, files },
    total
  };
}

async function conferenceKits() {
  const kits = {};
  for (const id of ['cvpr', 'neurips']) {
    const files = [];
    for (const rel of filesUnder(`src/templates/${id}`)) {
      const text = await read(`src/templates/${id}/${rel}`);
      if (text.includes('\u0000')) throw new Error(`${id}/${rel} is not a text template`);
      files.push({ path: rel, text });
    }
    if (!files.length) throw new Error(`conference template ${id} is empty`);
    if (!files.some((f) => f.path === 'main.tex')) throw new Error(`conference template ${id} has no main.tex`);
    kits[id] = { mainPath: 'main.tex', files };
  }
  return kits;
}

function inlineScript(code, label) {
  const safe = String(code)
    .replace(/<\/script/gi, '<\\/script')
    .replace(/^\s*\/\/#\s*sourceMappingURL=.*$/gm, '');
  try {
    new vm.Script(safe, { filename: label });
  } catch (e) {
    throw new Error(`${label} contains a syntax error: ${e.message}`);
  }
  return safe;
}

function inlineStyle(code, label) {
  return String(code).replace(/<\/style/gi, '<\\/style');
}

async function main() {
  const head = await read('src/template/01-head.html');
  const onboarding = await read('src/template/02-onboarding.html');
  const scripts = await read('src/template/03-scripts.html');

  const styleOrder = [
    'src/styles/00-base.css',
    'src/styles/01-layout.css',
    'src/styles/02-preview.css',
    'src/styles/03-onboarding.css',
    'src/styles/04-overlays.css',
    'vendor/codemirror.css',
    'vendor/dialog.css',
    'vendor/foldgutter.css',
    'vendor/show-hint.css',
    'src/styles/05-codemirror.css',
    'src/styles/06-wysiwyg.css'
  ];
  const styles = [];
  for (const rel of styleOrder) styles.push(`/* ${rel} */\n${await read(rel)}`);
  const css = inlineStyle(styles.join('\n\n'), 'styles');

  const cmAddonOrder = [
    'stex.js',
    'closebrackets.js',
    'matchbrackets.js',
    'active-line.js',
    'foldcode.js',
    'xml-fold.js',
    'brace-fold.js',
    'comment-fold.js',
    'foldgutter.js',
    'searchcursor.js',
    'search.js',
    'dialog.js',
    'show-hint.js'
  ];
  const codemirror = inlineScript(await read('vendor/codemirror.js'), 'codemirror.js');
  const addons = [];
  for (const name of cmAddonOrder) {
    addons.push(`/* ${name} */\n${inlineScript(await read(`vendor/${name}`), name)}`);
  }

  const texFiles = filesIn('src/js/tex', '.js');
  const appFiles = filesIn('src/js/app', '.js');
  const texSource = [];
  for (const name of texFiles) texSource.push(`/* tex/${name} */\n${await read(`src/js/tex/${name}`)}`);
  const appSource = [];
  for (const name of appFiles) appSource.push(`/* app/${name} */\n${await read(`src/js/app/${name}`)}`);
  const texJs = texSource.join('\n\n');
  const appJsRaw = appSource.join('\n\n');

  if (!/\(function\s*\(\)\s*\{\s*'use strict';?/.test(appJsRaw)) {
    throw new Error('app bundle must open the shared IIFE in 00-util.js');
  }
  if (!/\}\)\(\);\s*$/.test(appJsRaw.trim())) {
    throw new Error('app bundle must close the shared IIFE in 16-init.js');
  }

  const pdfjsLib = await read('assets/pdfjs/pdf.min.js');
  const pdfjsWorker = await read('assets/pdfjs/pdf.worker.min.js');
  const pdfjsCmapFiles = filesIn('assets/pdfjs/cmaps', '.bcmap');
  const pdfjsCmaps = {};
  for (const name of pdfjsCmapFiles) {
    pdfjsCmaps[name.replace(/\.bcmap$/, '')] = (await readBuffer(`assets/pdfjs/cmaps/${name}`)).toString('base64');
  }
  for (const [label, text] of [['pdf.js', pdfjsLib], ['pdf.js worker', pdfjsWorker]]) {
    if (/<\/script/i.test(text)) throw new Error(`${label} would terminate its inline script block`);
  }

  const imageB64 = (await readBuffer('src/assets/architecture.png')).toString('base64');
  const kits = await conferenceKits();
  const appJs = inlineScript(appJsRaw
    .replace(/__DEMO_IMAGE_BASE64__/g, () => imageB64)
    .replace('__CONFERENCE_KITS__', () => JSON.stringify(kits)), 'app');
  const texEngine = inlineScript(texJs, 'tex-engine');
  const mathjax = inlineScript(await read('vendor/mathjax-tex-svg-full.js'), 'mathjax');

  const texAssets = await texAssetBundle();
  const assetsJson = JSON.stringify(texAssets.config);
  JSON.parse(assetsJson); // fail early on a truncated bundle
  const texFflate = await read('assets/tex/fflate.umd.js');
  for (const [label, text] of [['tex assets', assetsJson], ['fflate', texFflate]]) {
    if (/<\/script/i.test(text)) throw new Error(`${label} would terminate its inline script block`);
  }

  let html = head + '\n' + onboarding + '\n' + scripts;
  html = html
    .replace('/*__STYLES__*/', () => css)
    .replace('/*__MATHJAX_LIB__*/', () => mathjax)
    .replace('/*__CODEMIRROR_LIB__*/', () => codemirror)
    .replace('/*__CM_ADDONS__*/', () => addons.join('\n\n'))
    .replace('/*__TEX_FFLATE__*/', () => texFflate)
    .replace('/*__TEX_ASSETS__*/', () => assetsJson)
    .replace('/*__PDFJS_LIB__*/', () => pdfjsLib)
    .replace('/*__PDFJS_WORKER__*/', () => pdfjsWorker)
    .replace('/*__PDFJS_CMAPS__*/', () => JSON.stringify(pdfjsCmaps))
    .replace('/*__APP__*/', () => `${texEngine}\n\n${appJs}`);

  if (/\/\*__[A-Z_]+__\*\//.test(html)) {
    throw new Error('unreplaced build placeholder remains');
  }
  if (/__DEMO_IMAGE_BASE64__|__CONFERENCE_KITS__/.test(html)) {
    throw new Error('app data placeholder was not replaced');
  }

  await writeFile(outFile, html, 'utf8');
  const info = await stat(outFile);
  console.log(`built ${path.relative(process.cwd(), outFile)}`);
  console.log(`  styles:  ${styleOrder.length} files, ${(css.length / 1024).toFixed(0)} KiB`);
  console.log(`  scripts: ${texFiles.length + appFiles.length} modules + ${cmAddonOrder.length + 2} vendor files`);
  console.log(`  confs:   ${Object.entries(kits).map(([id, k]) => `${id} (${k.files.length} files)`).join(', ')}`);
  console.log(`  tex:     tex-assets/ ${(texAssets.total / 1024 / 1024).toFixed(2)} MiB (CDN + IndexedDB cache)`);
  console.log(`  output:  ${(info.size / 1024 / 1024).toFixed(2)} MiB`);
}

main().catch((e) => {
  console.error('build failed:', e.message);
  process.exitCode = 1;
});
