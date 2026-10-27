#!/usr/bin/env node
/* ==========================================================================
   Qelemchi · assemble the in-browser TeX engine bundle
   --------------------------------------------------------------------------
   Inputs are the SwiftLaTeX Emscripten builds, two LaTeX format dumps made
   with SwiftLaTeX's compileformat, and a gzipped texmf archive produced by
   tools/build-texmf.mjs. The outputs in assets/tex are committed so a plain
   `node build.mjs` needs no TeX installation.

   Usage:
     node tools/build-tex-assets.mjs \
       --swiftlatex /path/to/extracted-swiftlatex \
       --formats    /path/to/formats \
       --texmf      /path/to/texmf.bin.gz \
       --fflate     /path/to/fflate.umd.js
   ========================================================================== */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const OUT = path.resolve(arg('out', 'assets/tex'));
const SWIFT = path.resolve(arg('swiftlatex', '/tmp/swiftlatex-extract'));
const FORMATS = path.resolve(arg('formats', '/tmp/swiftlatex-test'));
const TEXMF = path.resolve(arg('texmf', '/tmp/qelemchi-build/texmf.bin.gz'));
const FFLATE = path.resolve(arg('fflate', '/tmp/qelemchi-build/fflate.umd.js'));

const ENGINES = {
  pdftex: 'swiftlatexpdftex',
  xetex: 'swiftlatexxetex',
  dvipdfm: 'swiftlatexdvipdfm'
};

fs.mkdirSync(path.join(OUT, 'engine'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'wasm'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'format'), { recursive: true });

const gzip = (buf) => zlib.gzipSync(buf, { level: 9 });
const write = (rel, data) => {
  const file = path.join(OUT, rel);
  fs.writeFileSync(file, data);
  return data.length;
};

for (const [kind, base] of Object.entries(ENGINES)) {
  const js = fs.readFileSync(path.join(SWIFT, `${base}.js`));
  const wasm = fs.readFileSync(path.join(SWIFT, `${base}.wasm`));
  if (!js.includes('function kpse_find_file_impl(')) throw new Error(`${base}.js: kpse hook not found`);
  if (!js.includes('var Module={};')) throw new Error(`${base}.js: Module initialiser not found`);
  if (!js.includes('self["onmessage"]') && !js.includes('self.onmessage')) throw new Error(`${base}.js: worker entry not found`);
  write(`engine/${kind}.js`, js);
  write(`wasm/${kind}.wasm.gz`, gzip(wasm));
}

for (const [kind, file] of Object.entries({ pdftex: 'pdflatex.fmt', xetex: 'xelatex.fmt' })) {
  write(`format/${file}.gz`, gzip(fs.readFileSync(path.join(FORMATS, `${file}`))));
}

const texmfGz = fs.readFileSync(TEXMF);
const texmf = zlib.gunzipSync(texmfGz);
if (texmf.subarray(0, 5).toString() !== 'TXMF1') throw new Error('texmf archive has an unknown magic');
const headerLength = texmf.readUInt32LE(5);
const header = JSON.parse(texmf.subarray(9, 9 + headerLength).toString('utf8'));
if (!header.files || !header.files.length) throw new Error('texmf archive is empty');
const microtype = header.files.find((f) => f.name === 'microtype.sty');
if (microtype) {
  const start = 9 + headerLength + microtype.off;
  const st = texmf.subarray(start, start + microtype.len).toString('utf8');
  if (!st.includes('\\providecommand\\partokencontext')) {
    throw new Error('texmf archive is missing the microtype compatibility line; rebuild it with tools/build-texmf.mjs');
  }
}
write('texmf.bin.gz', texmfGz);
write('fflate.umd.js', fs.readFileSync(FFLATE));

const kib = (n) => `${(n / 1024).toFixed(0)} KiB`;
console.log('wrote', OUT);
console.log('  engines:', Object.keys(ENGINES).join(', '));
console.log('  formats: pdflatex, xelatex');
console.log('  texmf:  ', header.files.length, 'files,', kib(texmfGz.length), 'gzipped');
