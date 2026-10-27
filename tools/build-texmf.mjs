#!/usr/bin/env node
/* ==========================================================================
   Qelemchi · build texmf.bin.gz from captured kpse lookups
   --------------------------------------------------------------------------
   The capture files are newline-delimited `MAP {json}` records emitted by the
   development mock of the SwiftLaTeX texlive endpoint. Each record names the
   absolute TeX Live file that satisfied a request:

     MAP {"req":"article.cls","fmt":26,"file":"/.../texlive/2026/.../article.cls"}

   Point --captures at a directory of cap-*.log files. --fonts is a directory
   containing optional replacement fonts named exactly like the archive entry
   (for example FandolSong-Regular.otf). Missing entries keep the TeX Live
   original. The script writes a gzipped TXMF1 archive.
   ========================================================================== */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const CAP_DIR = path.resolve(arg('captures', '/tmp/swiftlatex-test'));
const FONT_DIR = path.resolve(arg('fonts', '/tmp/fontsub'));
const OUT = path.resolve(arg('out', '/tmp/texmf.bin.gz'));
const YEAR = arg('year', '2026');

const files = new Map();
for (const name of fs.readdirSync(CAP_DIR).filter((n) => /^cap-.*\.log$/.test(n))) {
  for (const line of fs.readFileSync(path.join(CAP_DIR, name), 'utf8').split('\n')) {
    if (!line.startsWith('MAP ')) continue;
    let record;
    try { record = JSON.parse(line.slice(4)); } catch (e) { continue; }
    if (!record.file || !record.file.includes(`/texlive/${YEAR}/`)) continue;
    const base = path.basename(record.file);
    if (!files.has(base)) files.set(base, record.file);
  }
}
if (!files.size) throw new Error(`no MAP records found below ${CAP_DIR}`);

const COMPAT = '% Qelemchi compatibility: the bundled pdfTeX/XeTeX engines predate\n' +
  '% the 2026 kernel primitive used by microtype when suspending tagging.\n' +
  '\\providecommand\\partokencontext[1]{}\n';

const entries = [];
const chunks = [];
let offset = 0;
for (const [base, source] of [...files].sort()) {
  const replacement = path.join(FONT_DIR, base);
  let data = fs.readFileSync(fs.existsSync(replacement) ? replacement : source);
  if (base === 'microtype.sty' && data.includes('partokencontext')) {
    data = Buffer.concat([Buffer.from(COMPAT, 'utf8'), data]);
  }
  entries.push({ name: base, off: offset, len: data.length, source: fs.existsSync(replacement) ? base : path.basename(source) });
  chunks.push(data);
  offset += data.length;
}

const header = Buffer.from(JSON.stringify({ version: 1, files: entries }), 'utf8');
const length = Buffer.alloc(4);
length.writeUInt32LE(header.length, 0);
const raw = Buffer.concat([Buffer.from('TXMF1'), length, header, ...chunks]);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, zlib.gzipSync(raw, { level: 9 }));
console.log(`wrote ${OUT}: ${entries.length} files, raw ${(raw.length / 1024 / 1024).toFixed(1)} MiB, gz ${(fs.statSync(OUT).size / 1024 / 1024).toFixed(1)} MiB`);
