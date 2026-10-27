/* ==========================================================================
   Qelemchi · LaTeX preview engine (part 1: primitives, BibTeX, files)
   A pragmatic LaTeX subset renderer. Not a TeX engine: the final PDF is
   produced by GitHub Actions. Everything here is escaped before it becomes
   HTML; MathJax handles math with trust disabled.
   ========================================================================== */

const TeXPreview = (() => {
  'use strict';

  const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
  const LATIN_RE = /[A-Za-z]/;

  const HTML_ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => HTML_ESC[c]);
  const escAttr = esc;

  const normalizePath = (p) => {
    const parts = String(p == null ? '' : p).replace(/\\/g, '/').split('/');
    const out = [];
    for (const part of parts) {
      if (!part || part === '.') continue;
      if (part === '..') { if (out.length) out.pop(); continue; }
      out.push(part);
    }
    return out.join('/');
  };
  const dirname = (p) => {
    const n = normalizePath(p);
    const i = n.lastIndexOf('/');
    return i < 0 ? '' : n.slice(0, i);
  };
  const basename = (p) => {
    const n = normalizePath(p);
    return n.slice(n.lastIndexOf('/') + 1);
  };
  const extname = (p) => {
    const b = basename(p);
    const i = b.lastIndexOf('.');
    return i < 0 ? '' : b.slice(i).toLowerCase();
  };
  const stripExt = (p) => {
    const n = normalizePath(p);
    const i = n.lastIndexOf('.');
    const slash = n.lastIndexOf('/');
    return i > slash ? n.slice(0, i) : n;
  };
  const joinPath = (...parts) => normalizePath(parts.filter(Boolean).join('/'));

  function readCommandName(src, i) {
    if (src[i] !== '\\') return null;
    if (i + 1 >= src.length) return { name: '', end: i + 1 };
    let j = i + 1;
    if (src[j] === '\\') return { name: '\\', end: i + 2 };
    if (/[A-Za-z@]/.test(src[j])) {
      while (j < src.length && /[A-Za-z@]/.test(src[j])) j++;
      return { name: src.slice(i + 1, j), end: j };
    }
    return { name: src[j], end: i + 2 };
  }

  function skipSpace(src, i) {
    while (i < src.length && (src[i] === ' ' || src[i] === '\t' || src[i] === '\n' || src[i] === '\r')) i++;
    return i;
  }

  function readGroup(src, i, open = '{', close = '}') {
    const start = skipSpace(src, i);
    if (src[start] !== open) return null;
    let depth = 1;
    let j = start + 1;
    while (j < src.length) {
      const c = src[j];
      if (c === '\\') { j += 2; continue; }
      if (c === open) depth++;
      else if (c === close) {
        depth--;
        if (depth === 0) return { text: src.slice(start + 1, j), end: j + 1, start };
      }
      j++;
    }
    return { text: src.slice(start + 1), end: src.length, start, unterminated: true };
  }

  function readOptional(src, i) {
    const start = skipSpace(src, i);
    if (src[start] !== '[') return null;
    let depth = 1;
    let j = start + 1;
    while (j < src.length) {
      const c = src[j];
      if (c === '\\') { j += 2; continue; }
      if (c === '{') {
        const g = readGroup(src, j);
        if (g) { j = g.end; continue; }
      }
      if (c === '[') depth++;
      else if (c === ']') {
        depth--;
        if (depth === 0) return { text: src.slice(start + 1, j), end: j + 1, start };
      }
      j++;
    }
    return null;
  }

  function findEnvEnd(src, env, from) {
    let depth = 1;
    let i = from;
    const re = /\\begin\s*\{([^}]+)\}|\\end\s*\{([^}]+)\}/g;
    re.lastIndex = i;
    let m;
    while ((m = re.exec(src))) {
      if (m[1] === env) depth++;
      else if (m[2] === env) {
        depth--;
        if (depth === 0) return { content: src.slice(from, m.index), end: re.lastIndex, endStart: m.index };
      }
    }
    return { content: src.slice(from), end: src.length, endStart: src.length, unterminated: true };
  }

  function findDisplayEnd(src, i) {
    if (src.startsWith('$$', i)) {
      let j = i + 2;
      while (j < src.length) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src.startsWith('$$', j)) return { content: src.slice(i + 2, j), end: j + 2, display: true };
        j++;
      }
      return null;
    }
    if (src.startsWith('\\[', i)) {
      let j = i + 2;
      while (j < src.length) {
        if (src[j] === '\\') {
          if (src[j + 1] === ']') return { content: src.slice(i + 2, j), end: j + 2, display: true };
          j += 2; continue;
        }
        j++;
      }
      return null;
    }
    return null;
  }

  const VERB_ENV_RE = /\\begin\{(verbatim\*?|lstlisting|minted|comment)\}[\s\S]*?\\end\{\1\}/g;

  function protectVerbatim(src, stash) {
    return String(src).replace(VERB_ENV_RE, (m) => {
      stash.push(m);
      return `\u0000TEXSTASH${stash.length - 1}\u0000`;
    });
  }

  function restoreVerbatim(src, stash) {
    return String(src).replace(/\u0000TEXSTASH(\d+)\u0000/g, (_, n) => stash[Number(n)] || '');
  }

  function stripComments(src) {
    const stash = [];
    let text = protectVerbatim(src, stash);
    let out = '';
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '\\') { out += c; if (i + 1 < text.length) out += text[++i]; continue; }
      if (c === '%') {
        while (i < text.length && text[i] !== '\n') i++;
        if (i < text.length) out += '\n';
        continue;
      }
      out += c;
    }
    return restoreVerbatim(out, stash);
  }

  function collectFiles(files) {
    const paths = new Set();
    const byLower = new Map();
    for (const f of files) {
      const p = normalizePath(f.path || f.name || '');
      if (!p) continue;
      paths.add(p);
      byLower.set(p.toLowerCase(), p);
    }
    return { paths, byLower };
  }

  function resolveFile(ref, fromPath, ctx, exts = ['']) {
    const raw = String(ref || '').trim().replace(/^["']|["']$/g, '');
    if (!raw) return null;
    const clean = raw.replace(/^\.\//, '');
    const fromDir = dirname(fromPath || '');
    const rootCandidates = [];
    if (clean.startsWith('/')) rootCandidates.push(normalizePath(clean));
    else {
      rootCandidates.push(normalizePath(joinPath(fromDir, clean)));
      rootCandidates.push(normalizePath(clean));
      for (const gp of ctx.graphicsPaths || []) {
        rootCandidates.push(normalizePath(joinPath(gp, clean)));
        rootCandidates.push(normalizePath(joinPath(fromDir, gp, clean)));
      }
    }
    const seen = new Set();
    for (const c of rootCandidates) {
      if (!c || seen.has(c)) continue;
      seen.add(c);
      for (const ext of exts) {
        const candidate = normalizePath(c + ext);
        if (ctx.files.paths.has(candidate)) return candidate;
        if (ctx.files.byLower.has(candidate.toLowerCase())) return ctx.files.byLower.get(candidate.toLowerCase());
      }
    }
    return null;
  }

  function resolveAsset(ref, fromPath, ctx) {
    const exts = ['', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.pdf', '.eps'];
    return resolveFile(ref, fromPath, ctx, exts);
  }

  function plainText(src) {
    let s = String(src || '');
    s = s.replace(/\\label\s*\{[^}]*\}/g, '');
    // Explicit line breaks and non-breaking spaces carry no text meaning.
    s = s.replace(/\\\\\s*(?:\[[^\]]*\])?/g, ' ');
    s = s.replace(/\\(?:newline|linebreak)\s*(?:\[[^\]]*\])?/g, ' ');
    s = s.replace(/~/g, ' ');
    // Control space ("\LaTeX\ is") would otherwise leave a stray backslash.
    s = s.replace(/\\\s+/g, ' ');
    s = s.replace(/\\(?:thanks|footnote|footnotetext)\s*\{/g, '{');
    s = s.replace(/\\(?:textbf|textit|emph|textsc|textsf|texttt|textrm|textnormal|mbox|hbox|text|mathrm|mathbf|mathit)\s*\{([^{}]*)\}/g, '$1');
    s = s.replace(/\\[a-zA-Z@]+\*?\s*(?:\[[^\]]*\])?/g, (m) => {
      if (/^\\(?:LaTeX|TeX)$/.test(m)) return m.slice(1);
      return '';
    });
    s = s.replace(/\\[%&_#${}]/g, (m) => m[1] || '');
    s = s.replace(/[{}]/g, '');
    s = s.replace(/\s*([：，。；！？、])\s*/g, '$1');
    s = s.replace(/\s+/g, ' ').trim();
    return s;
  }

  function safeId(key) {
    return String(key || '').replace(/[^A-Za-z0-9_.:-]+/g, '-').replace(/^-+|-+$/g, '') || 'label';
  }

  function alphabet(n) {
    let s = '';
    n = Math.max(1, n);
    while (n > 0) {
      const r = (n - 1) % 26;
      s = String.fromCharCode(65 + r) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }

  const ACCENTS = {
    "'": { a: 'á', e: 'é', i: 'í', o: 'ó', u: 'ú', y: 'ý', A: 'Á', E: 'É', I: 'Í', O: 'Ó', U: 'Ú', Y: 'Ý', c: 'ć', n: 'ń', s: 'ś', z: 'ź' },
    '`': { a: 'à', e: 'è', i: 'ì', o: 'ò', u: 'ù', A: 'À', E: 'È', I: 'Ì', O: 'Ò', U: 'Ù' },
    '^': { a: 'â', e: 'ê', i: 'î', o: 'ô', u: 'û', A: 'Â', E: 'Ê', I: 'Î', O: 'Ô', U: 'Û' },
    '"': { a: 'ä', e: 'ë', i: 'ï', o: 'ö', u: 'ü', y: 'ÿ', A: 'Ä', E: 'Ë', I: 'Ï', O: 'Ö', U: 'Ü' },
    '~': { a: 'ã', n: 'ñ', o: 'õ', A: 'Ã', N: 'Ñ', O: 'Õ' },
    'c': { c: 'ç', C: 'Ç', s: 'ş', S: 'Ş', t: 'ţ', T: 'Ţ' },
    'v': { c: 'č', C: 'Č', s: 'š', S: 'Š', z: 'ž', Z: 'Ž', r: 'ř', R: 'Ř', e: 'ě', E: 'Ě' },
    'u': { a: 'ă', A: 'Ă', g: 'ğ', G: 'Ğ' },
    'H': { o: 'ő', O: 'Ő', u: 'ű', U: 'Ű' },
    'k': { a: 'ą', A: 'Ą', e: 'ę', E: 'Ę' },
    'r': { a: 'å', A: 'Å' },
    '=': { a: 'ā', e: 'ē', i: 'ī', o: 'ō', u: 'ū' },
    '.': { z: 'ż', Z: 'Ż', c: 'ċ', C: 'Ċ' }
  };

  const SYMBOLS = {
    LaTeX: 'LaTeX', TeX: 'TeX', BibTeX: 'BibTeX', XeLaTeX: 'XeLaTeX', LuaLaTeX: 'LuaLaTeX',
    ldots: '…', dots: '…', textellipsis: '…', textemdash: '—', textendash: '–',
    copyright: '©', textcopyright: '©', textregistered: '®', texttrademark: '™',
    dag: '†', ddag: '‡', S: '§', P: '¶', textsection: '§', textparagraph: '¶',
    pounds: '£', textsterling: '£', euro: '€', texteuro: '€', textdegree: '°',
    textbackslash: '\\', textasciitilde: '~', textless: '<', textgreater: '>', textbar: '|',
    textunderscore: '_', textbraceleft: '{', textbraceright: '}', textbullet: '•',
    checkmark: '✓', times: '×', cdot: '·', pm: '±', mp: '∓', leq: '≤', geq: '≥',
    neq: '≠', approx: '≈', infty: '∞', partial: '∂', nabla: '∇', sum: '∑',
    prod: '∏', int: '∫', alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ',
    epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', lambda: 'λ',
    mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ',
    phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω', Gamma: 'Γ', Delta: 'Δ',
    Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
    ae: 'æ', AE: 'Æ', oe: 'œ', OE: 'Œ', aa: 'å', AA: 'Å', o: 'ø', O: 'Ø', l: 'ł', L: 'Ł', ss: 'ß',
    i: 'ı', j: 'ȷ', quad: ' ', qquad: '  ', enspace: ' ', thinspace: ' ', negthinspace: ''
  };

  const SPACING = { ',': '\u2009', ';': '\u2005', ':': '\u2004', '!': '', ' ': ' ', '~': '\u00a0', '\\': '<br>' };

  function parseBib(text, warnings) {
    const entries = new Map();
    const src = String(text || '');
    let i = 0;
    const n = src.length;
    const skipWs = (p) => { while (p < n && /\s/.test(src[p])) p++; return p; };
    const readBalanced = (p, open, close) => {
      let depth = 1;
      let j = p + 1;
      while (j < n) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === open) depth++;
        else if (src[j] === close) {
          depth--;
          if (depth === 0) return { text: src.slice(p + 1, j), end: j + 1 };
        }
        j++;
      }
      return { text: src.slice(p + 1), end: n };
    };
    while ((i = src.indexOf('@', i)) >= 0) {
      const head = /^@\s*([A-Za-z]+)\s*([{(])\s*([^,\s{}()]*)\s*,/.exec(src.slice(i));
      if (!head) { i++; continue; }
      const type = head[1].toLowerCase();
      const key = head[3].trim();
      let p = i + head[0].length;
      if (type === 'comment' || type === 'preamble') {
        const close = head[2] === '{' ? '}' : ')';
        const g = readBalanced(i + head[0].length - 1, head[2], close);
        i = g.end;
        continue;
      }
      if (type === 'string') {
        const close = head[2] === '{' ? '}' : ')';
        const g = readBalanced(i + head[0].length - 1, head[2], close);
        i = g.end;
        continue;
      }
      const fields = {};
      while (p < n) {
        p = skipWs(p);
        if (src[p] === ',' || src[p] === '\n' || src[p] === '\r') { p++; continue; }
        if (src[p] === '}' || src[p] === ')') break;
        if (src[p] === '@') break;
        let nameStart = p;
        while (p < n && /[A-Za-z0-9_:-]/.test(src[p])) p++;
        const field = src.slice(nameStart, p).toLowerCase();
        if (!field) { p++; continue; }
        p = skipWs(p);
        if (src[p] !== '=') {
          while (p < n && src[p] !== ',' && src[p] !== '\n') p++;
          continue;
        }
        p++;
        p = skipWs(p);
        let value = '';
        if (src[p] === '{') {
          const g = readBalanced(p, '{', '}');
          value = g.text;
          p = g.end;
        } else if (src[p] === '"') {
          let j = p + 1;
          let buf = '';
          while (j < n) {
            if (src[j] === '\\') { buf += src[j] + (src[j + 1] || ''); j += 2; continue; }
            if (src[j] === '"') break;
            buf += src[j++];
          }
          value = buf;
          p = j + 1;
        } else {
          let j = p;
          while (j < n && src[j] !== ',' && src[j] !== '}' && src[j] !== ')' && src[j] !== '\n') j++;
          value = src.slice(p, j);
          p = j;
        }
        // handle concatenation: field = "a" # "b"
        p = skipWs(p);
        while (src[p] === '#') {
          p++;
          p = skipWs(p);
          if (src[p] === '{') {
            const g = readBalanced(p, '{', '}');
            value += g.text;
            p = g.end;
          } else if (src[p] === '"') {
            let j = p + 1;
            while (j < n && src[j] !== '"') j++;
            value += src.slice(p + 1, j);
            p = j + 1;
          } else {
            let j = p;
            while (j < n && src[j] !== ',' && src[j] !== '}' && src[j] !== '\n') j++;
            value += src.slice(p, j);
            p = j;
          }
          p = skipWs(p);
        }
        fields[field] = value.replace(/[{}]/g, '').replace(/\\&/g, '&').replace(/\s+/g, ' ').trim();
      }
      if (key) entries.set(key, { type, key, fields });
      i = Math.max(p, i + 1);
    }
    return entries;
  }

  function splitAuthors(author) {
    if (!author) return [];
    const out = [];
    let depth = 0;
    let start = 0;
    const s = String(author);
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '{') depth++;
      else if (s[i] === '}') depth--;
      else if (depth === 0 && /\s/.test(s[i])) {
        const rest = s.slice(i);
        const m = /^\s+and\s+/i.exec(rest);
        if (m) {
          out.push(s.slice(start, i).trim());
          i += m[0].length - 1;
          start = i + 1;
        }
      }
    }
    out.push(s.slice(start).trim());
    return out.filter(Boolean);
  }

  function formatAuthorOne(raw) {
    let s = plainText(raw).replace(/^\s*and\s+/i, '').trim();
    if (!s) return '';
    if (/^others$/i.test(s)) return 'et al.';
    if (s.includes(',')) {
      const [last, ...rest] = s.split(',');
      const first = rest.join(',').trim();
      const initials = first
        .split(/\s+/)
        .filter(Boolean)
        .map((w) => (/^[A-Z]\.?$/.test(w) ? w.replace(/\.?$/, '.') : w[0].toUpperCase() + '.'))
        .join(' ');
      return initials ? `${initials} ${last.trim()}` : last.trim();
    }
    return s;
  }

  function formatAuthors(raw, max = 6) {
    const list = splitAuthors(raw).map(formatAuthorOne).filter(Boolean);
    if (!list.length) return '';
    if (list.length > max) return `${list.slice(0, max).join(', ')}, et al.`;
    if (list.length === 1) return list[0];
    if (list.length === 2) return `${list[0]} and ${list[1]}`;
    return `${list.slice(0, -1).join(', ')}, and ${list[list.length - 1]}`;
  }

  function shortAuthor(raw) {
    const list = splitAuthors(raw).map((a) => {
      const p = plainText(a);
      if (p.includes(',')) return p.split(',')[0].trim();
      const parts = p.split(/\s+/);
      return parts[parts.length - 1] || p;
    }).filter(Boolean);
    if (!list.length) return '';
    if (list.length === 1) return list[0];
    if (list.length === 2) return `${list[0]} & ${list[1]}`;
    return `${list[0]} et al.`;
  }

  function makeWarningBag() {
    const map = new Map();
    const list = [];
    const api = {
      list,
      add(message, level = 'warn') {
        const key = `${level}:${message}`;
        if (map.has(key)) { map.get(key).count++; return; }
        const item = { message, level, count: 1 };
        map.set(key, item);
        list.push(item);
      },
      error(message) { api.add(message, 'error'); },
      info(message) { api.add(message, 'info'); },
      get size() { return list.length; }
    };
    return api;
  }

  function todayString(zh) {
    const d = new Date();
    if (zh) return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`;
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  }

  function formatDate(raw, zh) {
    const s = String(raw || '').trim();
    if (!s) return '';
    if (/\\today\b/.test(s)) return todayString(zh);
    return plainText(s);
  }

  // Escape a math string for insertion into a text node. MathJax reads the
  // textContent, so HTML entities are decoded back to the original TeX.
  const mathEsc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
