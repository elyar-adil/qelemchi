/* ==========================================================================
   Qelemchi · utilities
   ========================================================================== */

(function () {
'use strict';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESC_MAP[c]);
const escapeAttr = escapeHtml;
const escapeRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

const normalizeProjectPath = (p) => {
  const parts = String(p == null ? '' : p).replace(/\\/g, '/').split('/');
  const out = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') { if (out.length) out.pop(); continue; }
    out.push(part);
  }
  return out.join('/');
};
const pathDir = (p) => {
  const n = normalizeProjectPath(p);
  const i = n.lastIndexOf('/');
  return i < 0 ? '' : n.slice(0, i);
};
const pathBase = (p) => {
  const n = normalizeProjectPath(p);
  return n.slice(n.lastIndexOf('/') + 1);
};
const pathExt = (p) => {
  const b = pathBase(p);
  const i = b.lastIndexOf('.');
  return i < 0 ? '' : b.slice(i).toLowerCase();
};
const pathStem = (p) => {
  const n = normalizeProjectPath(p);
  const i = n.lastIndexOf('.');
  const s = n.lastIndexOf('/');
  return i > s ? n.slice(0, i) : n;
};

const TEXT_EXTS = new Set(['.tex', '.bib', '.md', '.markdown', '.txt', '.cls', '.sty', '.bst', '.yml', '.yaml', '.json', '.csv', '.tsv', '.xml', '.html', '.htm', '.js', '.css', '.toml', '.ini', '.cfg', '.sh', '.py', '.r', '.m', '.latex', '.ltx', '.tikz', '.bbx', '.cbx', '.def', '.clo', '.dtx', '.ins', '.gitignore', '.gitattributes', '']);
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.avif']);
const isTextPath = (p) => {
  const e = pathExt(p);
  if (IMAGE_EXTS.has(e)) return false;
  if (e === '.pdf') return false;
  if (e === '.zip' || e === '.gz' || e === '.tar') return false;
  return TEXT_EXTS.has(e) || !e;
};
const isImagePath = (p) => IMAGE_EXTS.has(pathExt(p));
const isPdfPath = (p) => pathExt(p) === '.pdf';

const MIME_BY_EXT = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.bmp': 'image/bmp', '.avif': 'image/avif',
  '.pdf': 'application/pdf', '.zip': 'application/zip', '.json': 'application/json',
  '.txt': 'text/plain', '.md': 'text/markdown', '.tex': 'text/x-tex', '.bib': 'text/x-bibtex',
  '.yml': 'text/yaml', '.yaml': 'text/yaml', '.csv': 'text/csv'
};
const mimeFor = (p) => MIME_BY_EXT[pathExt(p)] || (isTextPath(p) ? 'text/plain;charset=utf-8' : 'application/octet-stream');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const uid = (prefix = '') => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const shortSha = (sha) => String(sha || '').slice(0, 7);

function debounce(fn, wait = 300) {
  let t = null;
  const wrapped = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
  wrapped.cancel = () => clearTimeout(t);
  wrapped.flush = (...args) => { clearTimeout(t); fn(...args); };
  return wrapped;
}

function throttle(fn, wait = 200) {
  let last = 0;
  let timer = null;
  return (...args) => {
    const now = Date.now();
    const remain = wait - (now - last);
    if (remain <= 0) {
      last = now;
      fn(...args);
    } else if (!timer) {
      timer = setTimeout(() => {
        timer = null;
        last = Date.now();
        fn(...args);
      }, remain);
    }
  };
}

function formatBytes(n) {
  n = Number(n) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDateTime(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  if (sameDay) return `今天 ${hh}:${mm}`;
  return `${y}-${m}-${day} ${hh}:${mm}`;
}

function timeAgo(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const diff = Math.max(0, Date.now() - d.getTime());
  if (diff < 60 * 1000) return '刚刚';
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / 3600000)} 小时前`;
  if (diff < 7 * 24 * 60 * 60 * 1000) return `${Math.floor(diff / 86400000)} 天前`;
  return formatDateTime(d).slice(0, 10);
}

function parseRepoInput(raw) {
  let s = String(raw || '').trim();
  s = s.replace(/^https?:\/\/github\.com\//i, '').replace(/^github\.com\//i, '');
  s = s.replace(/\.git$/i, '').replace(/^\/+|\/+$/g, '');
  const parts = s.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  const owner = parts[0];
  const name = parts[1];
  if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(name)) return null;
  return { owner, name, full: `${owner}/${name}` };
}

function bytesToBase64(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < arr.length; i += chunk) {
    binary += String.fromCharCode.apply(null, arr.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(b64) {
  const clean = String(b64 || '').replace(/\s+/g, '');
  const binary = atob(clean);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function utf8ToBase64(text) {
  return bytesToBase64(new TextEncoder().encode(String(text == null ? '' : text)));
}

function base64ToUtf8(b64) {
  const bytes = base64ToBytes(b64);
  try {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  } catch (e) {
    return '';
  }
}

function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('读取文件失败'));
    reader.readAsArrayBuffer(file);
  });
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('读取文件失败'));
    reader.readAsText(file);
  });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(String(text));
    return true;
  } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = String(text);
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (err) { /* ignore */ }
    ta.remove();
    return ok;
  }
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function fileIconSvg(path, size = 14) {
  const ext = pathExt(path);
  if (ext === '.tex') {
    return `<svg class="tree-icon tex" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M3.5 1.8h6L13 5.3v8.9H3.5z"/><path d="M9.5 1.8v3.5H13"/><path d="M5.4 9.2h5.2M5.4 11.3h3.7"/></svg>`;
  }
  if (ext === '.bib') {
    return `<svg class="tree-icon bib" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M3 3.2h10v9.6H3z"/><path d="M5 5.4h6M5 7.5h6M5 9.6h4"/></svg>`;
  }
  if (IMAGE_EXTS.has(ext)) {
    return `<svg class="tree-icon img" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2"><rect x="2.2" y="3" width="11.6" height="10" rx="1"/><circle cx="5.5" cy="6.2" r="1"/><path d="m3 12 3.3-3.3 2.4 2.4 1.6-1.6L14 12"/></svg>`;
  }
  if (ext === '.md' || ext === '.txt') {
    return `<svg class="tree-icon md" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M3 1.8h6L13 5.3v8.9H3.5z"/><path d="M9.5 1.8v3.5H13"/><path d="M5.3 8h5.4M5.3 10h5.4M5.3 12h3.4"/></svg>`;
  }
  if (ext === '.pdf') {
    return `<svg class="tree-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M3.5 1.8h6L13 5.3v8.9H3.5z"/><path d="M9.5 1.8v3.5H13"/><path d="M5.3 9h5.4M5.3 11h3.2"/></svg>`;
  }
  return `<svg class="tree-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M3.5 1.8h6L13 5.3v8.9H3.5z"/><path d="M9.5 1.8v3.5H13"/></svg>`;
}

function folderIconSvg(open) {
  return `<svg class="tree-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2"><path d="${open ? 'M1.8 4.2h4.3l1.2 1.6h6.9v7.4H1.8z' : 'M1.8 3.2h4.3l1.2 1.6h6.9v7.8H1.8z'}"/></svg>`;
}

function iconSvg(name) {
  const icons = {
    history: '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M3.2 7.2A6 6 0 1 1 3.7 11"/><path d="M3 3.5v4.3h4.3"/><path d="M9 5.5v3.3l2.2 1.4"/></svg>',
    save: '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M3 3h9l3 3v9H3z"/><path d="M6 3v4h6V3M6 15v-5h6v5"/></svg>',
    play: '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M5.5 3.7 14 9l-8.5 5.3V3.7Z"/></svg>',
    gear: '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="9" cy="9" r="2.3"/><path d="M14.4 10.4a5.5 5.5 0 0 0 0-2.8l1.3-1-1.4-2.4-1.6.6A5.8 5.8 0 0 0 10.5 3l-.3-1.6H7.8L7.5 3a5.8 5.8 0 0 0-2.2 1.3l-1.6-.6-1.4 2.4 1.3 1a5.5 5.5 0 0 0 0 2.8l-1.3 1 1.4 2.4 1.6-.6A5.8 5.8 0 0 0 7.5 15l.3 1.6h2.4l.3-1.6a5.8 5.8 0 0 0 2.2-1.3l1.6.6 1.4-2.4-1.3-1Z"/></svg>',
    plus: '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 3.5v11M3.5 9h11"/></svg>',
    minus: '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3.5 9h11"/></svg>',
    file: '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M4 2.5h6.5L14.5 6v9.5H4z"/><path d="M10.5 2.5V6H14.5"/></svg>',
    folder: '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M2 4.5h5l1.3 1.8h7.7v7.2H2z"/></svg>',
    trash: '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M3.5 5h11M7 5V3.5h4V5M5 5l.8 10h6.4L13 5"/><path d="M7.6 8v4.5M10.4 8v4.5"/></svg>',
    edit: '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.4"><path d="m3 15 1-3.7L12.6 2.7l2.7 2.7L6.7 14 3 15Z"/><path d="m11.4 4 2.6 2.6"/></svg>',
    refresh: '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M14.5 7.2A5.5 5.5 0 1 0 14.7 11"/><path d="M14.5 3.5v3.8h-3.8"/></svg>',
    link: '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M7.2 10.8 10.8 7.2"/><path d="M6 8.4 4.6 9.8a2.6 2.6 0 0 0 3.7 3.7l1.4-1.4"/><path d="m12 9.6 1.4-1.4a2.6 2.6 0 0 0-3.7-3.7L8.3 5.9"/></svg>',
    external: '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M7 4H3.5v10.5H14V11"/><path d="M10 3h5v5M8 10l7-7"/></svg>',
    check: '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.7"><path d="m3.5 9.5 3.5 3.5 7.5-8"/></svg>',
    x: '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5"><path d="m4 4 10 10M14 4 4 14"/></svg>',
    upload: '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M9 12V3.5M5.8 6.3 9 3l3.2 3.3"/><path d="M3.5 11v3.5h11V11"/></svg>',
    download: '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M9 3v8.5M5.8 8.3 9 11.5l3.2-3.2"/><path d="M3.5 11v3.5h11V11"/></svg>',
    search: '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="8" cy="8" r="5"/><path d="m12 12 3 3"/></svg>',
    moon: '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M15 11.2A6 6 0 0 1 6.8 3a6.2 6.2 0 1 0 8.2 8.2Z"/></svg>',
    sun: '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="9" cy="9" r="3.2"/><path d="M9 1.8v1.8M9 14.4v1.8M1.8 9h1.8M14.4 9h1.8M3.9 3.9l1.3 1.3M12.8 12.8l1.3 1.3M14.1 3.9l-1.3 1.3M5.2 12.8l-1.3 1.3"/></svg>',
    warning: '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M9 2.5 16.5 15h-15L9 2.5Z"/><path d="M9 7v3.4M9 13v.1"/></svg>',
    info: '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="9" cy="9" r="6.5"/><path d="M9 8.2v4M9 5.8v.1"/></svg>',
    key: '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="6.5" cy="8" r="3.2"/><path d="m8.8 10.3 5.7 5.7M11 12.5l1.4-1.4M12.8 14.3l1.4-1.4"/></svg>',
    github: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.4 7.4 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/></svg>'
  };
  return icons[name] || '';
}

function initials(name) {
  const s = String(name || '').trim();
  if (!s) return 'TF';
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function highlightMatch(text, query) {
  const q = String(query || '');
  if (!q) return escapeHtml(text);
  const re = new RegExp(escapeRegExp(q), 'ig');
  let out = '';
  let last = 0;
  String(text).replace(re, (m, offset) => {
    out += escapeHtml(String(text).slice(last, offset));
    out += `<mark>${escapeHtml(m)}</mark>`;
    last = offset + m.length;
    return m;
  });
  out += escapeHtml(String(text).slice(last));
  return out;
}

function splitLines(text) {
  return String(text == null ? '' : text).replace(/\r\n?/g, '\n').split('\n');
}

function lineDiff(oldText, newText, maxLines = 900) {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  if (a.length > maxLines || b.length > maxLines) {
    return { truncated: true, lines: [{ type: 'hunk', text: `文件较大，已省略逐行对比（${a.length} → ${b.length} 行）。` }] };
  }
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: 'same', text: a[i], oldLine: i + 1, newLine: j + 1 });
      i++; j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: 'del', text: a[i], oldLine: i + 1 });
      i++;
    } else {
      out.push({ type: 'add', text: b[j], newLine: j + 1 });
      j++;
    }
  }
  while (i < n) { out.push({ type: 'del', text: a[i], oldLine: i + 1 }); i++; }
  while (j < m) { out.push({ type: 'add', text: b[j], newLine: j + 1 }); j++; }
  return { truncated: false, lines: out };
}

function renderDiff(oldText, newText) {
  const d = lineDiff(oldText, newText);
  const lines = d.lines.map((line) => {
    if (line.type === 'hunk') return `<div class="diff-line hunk"><span class="dl-sign">@@</span><span class="dl-text">${escapeHtml(line.text)}</span></div>`;
    if (line.type === 'same') return `<div class="diff-line"><span class="dl-sign"> </span><span class="dl-text">${escapeHtml(line.text)}</span></div>`;
    const sign = line.type === 'add' ? '+' : '−';
    return `<div class="diff-line ${line.type}"><span class="dl-sign">${sign}</span><span class="dl-text">${escapeHtml(line.text)}</span></div>`;
  }).join('');
  return `<div class="diff-block">${lines || '<div class="diff-empty">没有差异</div>'}</div>`;
}

function renderPatch(patch) {
  if (!patch) return '<div class="diff-empty">二进制文件或改动过大，GitHub 未返回 diff。</div>';
  const lines = String(patch).split('\n').map((line) => {
    let cls = '';
    let sign = ' ';
    if (line.startsWith('@@')) { cls = 'hunk'; sign = '@@'; }
    else if (line.startsWith('+')) { cls = 'add'; sign = '+'; }
    else if (line.startsWith('-')) { cls = 'del'; sign = '−'; }
    return `<div class="diff-line ${cls}"><span class="dl-sign">${sign}</span><span class="dl-text">${escapeHtml(line.replace(/^(?:@@|\+|-)/, ''))}</span></div>`;
  }).join('');
  return `<div class="diff-block">${lines}</div>`;
}

function makeId(prefix = 'id') {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

// A tiny uncompressed ZIP writer, enough to export a paper project without a
// dependency. UTF-8 names are flagged so Chinese paths survive the round trip.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(date) {
  const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  const year = Math.max(1980, d.getFullYear());
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const day = ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date: day };
}

function buildZip(entries) {
  const encoder = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  for (const entry of entries || []) {
    const nameBytes = encoder.encode(entry.path);
    const data = entry.bytes instanceof Uint8Array ? entry.bytes : new Uint8Array(entry.bytes || []);
    const crc = crc32(data);
    const stamp = dosDateTime(entry.date || new Date());
    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true);
    lv.setUint16(8, 0, true);
    lv.setUint16(10, stamp.time, true);
    lv.setUint16(12, stamp.date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    local.set(nameBytes, 30);
    parts.push(local, data);

    const cd = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, stamp.time, true);
    cv.setUint16(14, stamp.date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    cd.set(nameBytes, 46);
    central.push(cd);

    offset += local.length + data.length;
  }
  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);
  return new Blob(parts.concat(central, [end]), { type: 'application/zip' });
}

function setBusy(btn, busy, label) {
  if (!btn) return;
  if (busy) {
    btn.dataset.originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.classList.add('is-loading');
    btn.innerHTML = `<span class="typeset-spinner" style="width:12px;height:12px;border-width:1.5px;margin-right:5px"></span>${escapeHtml(label || '处理中…')}`;
  } else {
    btn.disabled = false;
    btn.classList.remove('is-loading');
    if (btn.dataset.originalHtml != null) {
      btn.innerHTML = btn.dataset.originalHtml;
      delete btn.dataset.originalHtml;
    }
  }
}
