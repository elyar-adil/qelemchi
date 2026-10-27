/* ==========================================================================
   Qelemchi · WYSIWYG editor
   --------------------------------------------------------------------------
   A visual editing surface that works on the real LaTeX source. Every block
   knows its exact character range in the file, so editing a paragraph rewrites
   just that range and leaves everything else (macros, figures, comments,
   formatting) byte-for-byte intact.

   Prose, headings, keywords, abstract/quote/theorem bodies and list items are
   editable. Structural material (equations, figures, tables, arbitrary
   environments) is shown as a read-only card with a shortcut to the source.
   Inline constructs that cannot be round-tripped safely — math, citations,
   references, footnotes, unknown macros — become atomic chips that carry their
   original source in `data-tex`.
   ========================================================================== */

const WYS_HEADING_LEVELS = { part: 1, chapter: 1, section: 2, subsection: 3, subsubsection: 4, paragraph: 4, subparagraph: 4 };
const WYS_HEADING_NAMES = new Set(Object.keys(WYS_HEADING_LEVELS));
const WYS_STRUCT_COMMANDS = new Set([
  'maketitle', 'tableofcontents', 'bibliography', 'bibliographystyle', 'printbibliography',
  'appendix', 'newpage', 'clearpage', 'cleardoublepage', 'pagebreak',
  'input', 'include', 'subfile', 'includeonly', 'keywords'
]);
const WYS_SILENT_COMMANDS = new Set(['bibliographystyle', 'includeonly']);
const WYS_INCLUDE_COMMANDS = new Set(['input', 'include', 'subfile']);
const WYS_LIST_ENVS = new Set(['itemize', 'enumerate', 'description']);
const WYS_MATH_ENVS = new Set([
  'equation', 'equation*', 'align', 'align*', 'gather', 'gather*', 'multline', 'multline*',
  'eqnarray', 'eqnarray*', 'displaymath', 'math', 'flalign', 'flalign*', 'alignat', 'alignat*'
]);
const WYS_THEOREM_ENVS = new Set([
  'theorem', 'lemma', 'proposition', 'corollary', 'definition', 'remark', 'example',
  'assumption', 'conjecture', 'claim', 'observation', 'notation', 'exercise', 'problem',
  'property', 'result', 'fact'
]);
const WYS_THEOREM_NAMES = {
  theorem: '定理', lemma: '引理', proposition: '命题', corollary: '推论',
  definition: '定义', remark: '注记', example: '例', assumption: '假设',
  conjecture: '猜想', claim: '断言', observation: '观察', notation: '记号',
  exercise: '练习', problem: '问题', property: '性质', result: '结果', fact: '事实',
  proof: '证明'
};
const WYS_THEOREM_EN_NAMES = {
  theorem: 'Theorem', lemma: 'Lemma', proposition: 'Proposition', corollary: 'Corollary',
  definition: 'Definition', remark: 'Remark', example: 'Example', assumption: 'Assumption',
  conjecture: 'Conjecture', claim: 'Claim', observation: 'Observation', notation: 'Notation',
  exercise: 'Exercise', problem: 'Problem', property: 'Property', result: 'Result', fact: 'Fact',
  proof: 'Proof'
};
const WYS_FORMAT_MACROS = {
  textbf: 'strong',
  textit: 'em',
  emph: 'em',
  texttt: 'code',
  underline: 'u',
  textrm: 'span',
  textsf: 'span',
  textsc: 'span',
  textnormal: 'span',
  mbox: 'span'
};
// TeX 2.09-era declarations still common in conference templates.
const WYS_DECL_MACROS = {
  bf: 'textbf', bfseries: 'textbf', mdseries: 'textnormal',
  it: 'textit', itshape: 'textit', sl: 'textit', slshape: 'textit',
  em: 'emph',
  tt: 'texttt', ttfamily: 'texttt',
  sc: 'textsc', scshape: 'textsc',
  rm: 'textrm', rmfamily: 'textrm', normalfont: 'textnormal',
  sf: 'textsf', sffamily: 'textsf'
};
const WYS_SYMBOL_MACROS = {
  LaTeX: 'LaTeX', TeX: 'TeX', XeLaTeX: 'XeLaTeX', pdfLaTeX: 'pdfLaTeX',
  BibTeX: 'BibTeX', LaTeXe: 'LaTeX2e', ldots: '…', dots: '…', textellipsis: '…',
  textbackslash: '\\', textasciitilde: '~', textasciicircum: '^',
  textendash: '–', textemdash: '—', S: '§', P: '¶', copyright: '©', textregistered: '®',
  texttrademark: '™', dag: '†', ddag: '‡', pounds: '£', euro: '€', checkmark: '✓',
  eg: 'e.g.', ie: 'i.e.', etc: 'etc.', etal: 'et al.', vs: 'vs.', cf: 'cf.', iid: 'i.i.d.'
};

const wys = {
  active: false,
  path: '',
  rootPath: '',
  blocks: [],
  bodyStart: 0,
  bodyEnd: 0,
  project: null,
  profile: 'article',
  typesetToken: 0,
  renderToken: 0,
  refreshTimer: null,
  internalEdit: false,
  focusRequest: null,
  lastBlock: null,
  savedRange: null,
  hostObserver: null
};

// The visual surface follows the document class rather than one generic sheet:
// CVPR is a two-column Times page, NeurIPS a wide single column, and the
// Chinese starter an A4 ctexart page. Profiles drive both geometry and type.
function wysTemplateProfile(project) {
  const meta = (project && project.meta) || {};
  const packages = (meta.packages || []).map((s) => String(s).toLowerCase());
  const options = (meta.docOptions || []).map((s) => String(s).toLowerCase());
  if (packages.includes('cvpr')) return 'cvpr';
  if (packages.some((p) => /^neurips/.test(p) || p === 'nips')) return 'neurips';
  if (meta.zh || /^ctex/.test(meta.docClass || '')) return 'ctex';
  if (options.includes('twocolumn')) return 'twocolumn';
  return meta.pageSize === 'letter' ? 'letter' : 'article';
}

function wysPlainHeading(raw) {
  return String(raw || '')
    .replace(/\\label\s*\{[^}]*\}/g, '')
    .replace(/\\(?:cite|citep|citet|ref|eqref|cref|Cref|autoref)\*?\s*(?:\[[^\]]*\])?\s*\{[^}]*\}/g, '')
    .replace(/\\(?:textbf|textit|emph|texttt|textrm|textsf|textsc)\s*\{([^{}]*)\}/g, '$1')
    .replace(/\$([^$]*)\$/g, '$1')
    .replace(/\\[a-zA-Z@]+\*?/g, ' ')
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// Headings are scanned file by file, so take the section number from the
// document-wide TOC/label table instead of a local counter (which would
// restart in every \input file).
function wysAssignHeadingNumbers(blocks, project) {
  if (!project) return;
  const toc = project.toc || [];
  const labels = project.labels || {};
  const used = new Set();
  for (const block of blocks) {
    if (block.kind !== 'heading' || block.starred) continue;
    let number = '';
    const labeled = block.label ? labels[block.label] : null;
    if (labeled && labeled.number && labeled.number !== '?') number = String(labeled.number);
    if (!number && toc.length) {
      const title = wysPlainHeading(block.raw);
      const index = toc.findIndex((item, i) => !used.has(i) && wysPlainHeading(item.title) === title);
      if (index >= 0) {
        used.add(index);
        if (toc[index].number) number = String(toc[index].number);
      }
    }
    if (number) block.number = number;
  }
}

/* --------------------------------------------------------------------------
   Small source helpers (brace aware, comment aware)
   -------------------------------------------------------------------------- */

function wysSkipSpaces(text, i, limit) {
  while (i < limit && (text[i] === ' ' || text[i] === '\t' || text[i] === '\n' || text[i] === '\r')) i++;
  return i;
}

function wysSkipLineSpaces(text, i, limit) {
  while (i < limit && (text[i] === ' ' || text[i] === '\t')) i++;
  return i;
}

function wysCommandAt(text, i) {
  if (text[i] !== '\\') return null;
  const m = /^\\([A-Za-z@]+)/.exec(text.slice(i, i + 80));
  if (!m) return null;
  return { name: m[1], end: i + m[0].length };
}

function wysReadGroup(text, open, limit) {
  if (text[open] !== '{') return null;
  let depth = 0;
  for (let i = open; i < limit; i++) {
    const ch = text[i];
    if (ch === '\\') { i++; continue; }
    if (ch === '%') {
      const nl = text.indexOf('\n', i);
      if (nl < 0 || nl >= limit) return null;
      i = nl;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return {
          start: open,
          end: i + 1,
          contentStart: open + 1,
          contentEnd: i,
          text: text.slice(open + 1, i)
        };
      }
    }
  }
  return null;
}

function wysReadBracket(text, open, limit) {
  if (text[open] !== '[') return null;
  let braces = 0;
  for (let i = open + 1; i < limit; i++) {
    const ch = text[i];
    if (ch === '\\') { i++; continue; }
    if (ch === '{') braces++;
    else if (ch === '}') braces = Math.max(0, braces - 1);
    else if (ch === ']' && braces === 0) {
      return { start: open, end: i + 1, contentStart: open + 1, contentEnd: i, text: text.slice(open + 1, i) };
    }
  }
  return null;
}

function wysFindEnvEnd(text, from, limit, name) {
  const re = new RegExp('\\\\(begin|end)\\s*\\{' + escapeRegExp(name) + '\\}', 'g');
  re.lastIndex = from;
  let depth = 1;
  let m;
  while ((m = re.exec(text))) {
    if (m.index >= limit) break;
    if (m[1] === 'begin') depth++;
    else {
      depth--;
      if (depth === 0) return { end: m.index + m[0].length, innerEnd: m.index };
    }
  }
  return null;
}

function wysFindDisplayEnd(text, i, limit) {
  const dollar = text.startsWith('$$', i);
  const open = dollar ? 2 : 2; // \[ or $$
  const closer = dollar ? '$$' : '\\]';
  let p = i + open;
  while (p < limit) {
    if (text[p] === '\\') { p += 2; continue; }
    if (text.startsWith(closer, p)) {
      return { contentStart: i + open, contentEnd: p, end: p + closer.length };
    }
    p++;
  }
  return null;
}

function wysTrimRange(text, start, end) {
  while (start < end && /\s/.test(text[start])) start++;
  while (end > start && /\s/.test(text[end - 1])) end--;
  return { start, end };
}

function wysLineOf(text, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) if (text[i] === '\n') line++;
  return line;
}

function wysIsEditablePath(path) {
  return ['.tex', '.ltx', '.latex'].includes(pathExt(path));
}

function wysBodyRange(text) {
  const begin = /\\begin\s*\{document\}/.exec(text);
  if (!begin) return { start: 0, end: text.length, hasPreamble: false };
  const end = text.lastIndexOf('\\end{document}');
  if (end <= begin.index) return { start: 0, end: text.length, hasPreamble: false };
  return {
    start: begin.index + begin[0].length,
    end,
    hasPreamble: true,
    preambleEnd: begin.index
  };
}

function wysBraceText(raw) {
  return String(raw || '').replace(/\\label\s*\{[^}]*\}/g, '')
    .replace(/\\[a-zA-Z@]+\*?\s*(?:\[[^\]]*\])?/g, (m) => (/^\\(?:LaTeX|TeX)$/.test(m) ? m.slice(1) : ''))
    .replace(/\\[%&_#${}]/g, (m) => m[1] || '')
    .replace(/[{}]/g, '')
    .replace(/~/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* --------------------------------------------------------------------------
   Source scanning
   -------------------------------------------------------------------------- */

function wysStartsBlock(text, pos, limit) {
  let i = wysSkipLineSpaces(text, pos, limit);
  if (i >= limit) return false;
  if (text[i] === '%') return true;
  if (text.startsWith('\\[', i) || text.startsWith('$$', i)) return true;
  if (text[i] !== '\\') return false;
  const cmd = wysCommandAt(text, i);
  if (!cmd) return false;
  if (WYS_HEADING_NAMES.has(cmd.name)) return true;
  if (cmd.name === 'begin' || cmd.name === 'end') return true;
  return WYS_STRUCT_COMMANDS.has(cmd.name);
}

function wysParseHeading(text, i, limit) {
  const cmd = wysCommandAt(text, i);
  if (!cmd || !WYS_HEADING_NAMES.has(cmd.name)) return null;
  let p = cmd.end;
  const starred = text[p] === '*';
  if (starred) p++;
  p = wysSkipSpaces(text, p, limit);
  let titleGroup = null;
  if (text[p] === '[') {
    const opt = wysReadBracket(text, p, limit);
    if (opt) { p = wysSkipSpaces(text, opt.end, limit); }
  }
  if (text[p] !== '{') return null;
  titleGroup = wysReadGroup(text, p, limit);
  if (!titleGroup) return null;
  let end = titleGroup.end;
  // Include an immediately following \label{...} so it stays part of the block.
  let q = wysSkipSpaces(text, end, limit);
  if (text.startsWith('\\label', q)) {
    const lc = wysCommandAt(text, q);
    let lp = lc ? lc.end : q + 6;
    lp = wysSkipSpaces(text, lp, limit);
    if (text[lp] === '{') {
      const lg = wysReadGroup(text, lp, limit);
      if (lg) end = lg.end;
    }
  }
  return {
    start: i,
    end,
    contentStart: titleGroup.contentStart,
    contentEnd: titleGroup.contentEnd,
    level: WYS_HEADING_LEVELS[cmd.name] || 2,
    command: cmd.name,
    starred,
    titleRaw: titleGroup.text
  };
}

function wysParseEnv(text, i, limit) {
  const cmd = wysCommandAt(text, i);
  if (!cmd || cmd.name !== 'begin') return null;
  let p = wysSkipSpaces(text, cmd.end, limit);
  if (text[p] !== '{') return null;
  const nameGroup = wysReadGroup(text, p, limit);
  if (!nameGroup) return null;
  const env = nameGroup.text.trim();
  const close = wysFindEnvEnd(text, nameGroup.end, limit, env);
  if (!close) return null;
  return {
    env,
    start: i,
    end: close.end,
    innerStart: nameGroup.end,
    innerEnd: close.innerEnd
  };
}

function wysScanProse(text, start, end, project, opts = {}) {
  const blocks = [];
  let i = start;
  while (i < end) {
    i = wysSkipSpaces(text, i, end);
    if (i >= end) break;
    if (text[i] === '%') {
      const nl = text.indexOf('\n', i);
      i = nl < 0 || nl >= end ? end : nl + 1;
      continue;
    }
    if (opts.keywords && text.startsWith('\\keywords', i)) {
      const cmd = wysCommandAt(text, i);
      const g = cmd ? wysReadGroup(text, wysSkipSpaces(text, cmd.end, end), end) : null;
      if (g) {
        blocks.push(wysMakeBlock({
          kind: 'keywords',
          start: i,
          end: g.end,
          contentStart: g.contentStart,
          contentEnd: g.contentEnd,
          prefix: '\\keywords{',
          suffix: '}',
          parent: opts.parent != null ? opts.parent : null
        }, project, text, opts.path));
        i = g.end;
        continue;
      }
    }
    // Paragraph: runs until a blank line or \par, with \keywords breaking out.
    let p = i;
    let stop = end;
    while (p < end) {
      const nl = text.indexOf('\n', p);
      const lineEnd = nl < 0 || nl > end ? end : nl;
      const line = text.slice(p, lineEnd);
      if (!line.trim()) { stop = p; break; }
      if (p > i && opts.keywords && /^\s*\\keywords\b/.test(line)) { stop = p; break; }
      if (p > i && /^\s*%/.test(line)) { stop = p; break; }
      const par = /\\par\b/.exec(line);
      if (par) { stop = p + par.index; break; }
      p = lineEnd + 1;
    }
    const trimmed = wysTrimRange(text, i, Math.min(stop, end));
    if (trimmed.end <= trimmed.start) { i = stop > i ? stop : i + 1; continue; }
    let contentStart = trimmed.start;
    let prefix = '';
    const lead = /^\s*\\noindent\b\s*/.exec(text.slice(trimmed.start, Math.min(trimmed.start + 40, trimmed.end)));
    if (lead) {
      contentStart = trimmed.start + lead[0].length;
      prefix = text.slice(trimmed.start, contentStart);
    }
    const raw = text.slice(contentStart, trimmed.end);
    if (raw.trim()) {
      blocks.push(wysMakeBlock({
        kind: 'para',
        start: trimmed.start,
        end: trimmed.end,
        contentStart,
        contentEnd: trimmed.end,
        prefix,
        parent: opts.parent != null ? opts.parent : null
      }, project, text, opts.path));
    }
    i = stop > i ? stop : i + 1;
    if (text.startsWith('\\par', i)) i += 4;
  }
  return blocks;
}

function wysScanItems(text, start, end, project, parent, fromPath) {
  const items = [];
  let i = start;
  let current = null;
  const closeCurrent = (to) => {
    if (!current) return;
    const trimmed = wysTrimRange(text, current.contentStart, to);
    if (trimmed.end > trimmed.start) {
      current.contentEnd = trimmed.end;
      current.end = trimmed.end;
      items.push(wysMakeBlock(current, project, text, fromPath));
    }
    current = null;
  };
  while (i < end) {
    if (text[i] === '%') {
      const nl = text.indexOf('\n', i);
      i = nl < 0 || nl >= end ? end : nl + 1;
      continue;
    }
    if (text[i] === '\\') {
      const cmd = wysCommandAt(text, i);
      if (cmd && cmd.name === 'item') {
        closeCurrent(i);
        let p = wysSkipSpaces(text, cmd.end, end);
        let label = '';
        if (text[p] === '[') {
          const opt = wysReadBracket(text, p, end);
          if (opt) { label = opt.text; p = wysSkipSpaces(text, opt.end, end); }
        }
        current = {
          kind: 'item',
          start: p,
          end: p,
          contentStart: p,
          contentEnd: p,
          label,
          parent
        };
        i = p;
        continue;
      }
      if (cmd && cmd.name === 'begin') {
        const env = wysParseEnv(text, i, end);
        if (env) { i = env.end; continue; }
      }
      if (cmd && cmd.name === 'end') { i = cmd.end; continue; }
      i = cmd ? cmd.end : i + 1;
      continue;
    }
    i++;
  }
  closeCurrent(end);
  return items;
}

function wysMakeBlock(base, project, text, fromPath) {
  const block = Object.assign({
    index: -1,
    kind: 'para',
    editable: false,
    parent: null,
    children: null,
    prefix: '',
    suffix: '',
    label: '',
    path: fromPath || '',
    parsed: null,
    raw: ''
  }, base);
  block.raw = text.slice(block.contentStart, block.contentEnd);
  block.parsed = wysParseInline(block.raw, project, block.path);
  const unsafeBlockCmd = /\\(?:begin|end|section|subsection|chapter|part|paragraph|item|par)\b/.test(block.raw);
  const comment = /(^|[^\\])%/.test(block.raw);
  const multiline = /\n[ \t]*\n/.test(block.raw);
  block.editable = !!(block.parsed.safe && !unsafeBlockCmd && !comment && !(block.kind === 'item' && multiline));
  return block;
}

function wysScanDocument(text, path, project, opts = {}) {
  const range = wysBodyRange(text);
  const blocks = [];
  const stack = Array.isArray(opts.stack) ? opts.stack : [path];
  const depth = Number(opts.depth) || 0;
  let i = range.start;
  const push = (b) => { b.index = blocks.length; blocks.push(b); return b; };

  while (i < range.end) {
    i = wysSkipSpaces(text, i, range.end);
    if (i >= range.end) break;
    if (text[i] === '%') {
      let j = i;
      while (j < range.end) {
        const nl = text.indexOf('\n', j);
        const lineEnd = nl < 0 || nl >= range.end ? range.end : nl;
        const line = text.slice(j, lineEnd);
        if (!/^\s*%/.test(line) && line.trim()) break;
        j = lineEnd + 1;
      }
      i = j;
      continue;
    }

    if (text.startsWith('\\[', i) || text.startsWith('$$', i)) {
      const d = wysFindDisplayEnd(text, i, range.end);
      if (d) {
        const b = push({
          kind: 'math',
          start: i,
          end: d.end,
          contentStart: d.contentStart,
          contentEnd: d.contentEnd,
          display: true
        });
        b.raw = text.slice(d.contentStart, d.contentEnd);
        i = d.end;
        continue;
      }
    }

    if (text[i] === '\\') {
      const cmd = wysCommandAt(text, i);
      if (cmd) {
        if (WYS_HEADING_NAMES.has(cmd.name)) {
          const h = wysParseHeading(text, i, range.end);
          if (h) {
            const b = push({
              kind: 'heading',
              start: h.start,
              end: h.end,
              contentStart: h.contentStart,
              contentEnd: h.contentEnd,
              level: h.level,
              command: h.command,
              starred: h.starred
            });
            const labelMatch = /\\label\s*\{([^}]*)\}/.exec(text.slice(h.start, h.end));
            if (labelMatch) b.label = labelMatch[1].trim();
            b.raw = text.slice(h.contentStart, h.contentEnd);
            b.parsed = wysParseInline(b.raw, project, path);
            b.editable = b.parsed.safe && !/(^|[^\\])%/.test(b.raw);
            i = h.end;
            continue;
          }
        }

        if (cmd.name === 'begin') {
          const env = wysParseEnv(text, i, range.end);
          if (env) {
            const kind = wysEnvKind(env.env);
            if (kind === 'abstract' || kind === 'quote' || kind === 'list' || kind === 'theorem' || kind === 'proof') {
              const container = push({
                kind: kind === 'list' ? 'list' : kind,
                start: env.start,
                end: env.end,
                innerStart: env.innerStart,
                innerEnd: env.innerEnd,
                env: env.env,
                raw: text.slice(env.innerStart, env.innerEnd),
                children: []
              });
              let bodyStart = env.innerStart;
              let title = '';
              if (kind === 'theorem' || kind === 'proof') {
                let p = wysSkipSpaces(text, bodyStart, env.innerEnd);
                if (text[p] === '[') {
                  const opt = wysReadBracket(text, p, env.innerEnd);
                  if (opt) { title = opt.text; p = wysSkipSpaces(text, opt.end, env.innerEnd); }
                }
                bodyStart = p;
                container.title = title;
              }
              if (kind === 'list') {
                container.children = wysScanItems(text, bodyStart, env.innerEnd, project, container.index, path)
                  .map((child) => push(child).index);
              } else {
                container.children = wysScanProse(text, bodyStart, env.innerEnd, project, {
                  keywords: kind === 'abstract',
                  parent: container.index,
                  path
                }).map((child) => push(child).index);
              }
              i = env.end;
              continue;
            }
            const b = push({
              kind: 'environment',
              env: env.env,
              start: env.start,
              end: env.end,
              contentStart: env.innerStart,
              contentEnd: env.innerEnd
            });
            b.raw = text.slice(env.innerStart, env.innerEnd);
            i = env.end;
            continue;
          }
        }

        if (WYS_STRUCT_COMMANDS.has(cmd.name)) {
          let p = cmd.end;
          let optional = '';
          let group = null;
          p = wysSkipSpaces(text, p, range.end);
          let probe = p;
          const opt = text[probe] === '[' ? wysReadBracket(text, probe, range.end) : null;
          if (opt) { optional = opt.text; p = wysSkipSpaces(text, opt.end, range.end); }
          if (text[p] === '{') {
            group = wysReadGroup(text, p, range.end);
            if (group) p = group.end;
          }
          // Render the whole paper, not an include placeholder: expand
          // \input/\include in place, with cycle and depth guards.
          if (WYS_INCLUDE_COMMANDS.has(cmd.name) && group && depth < 12) {
            const target = wysResolveTexPath(group.text, path);
            const targetFile = target ? state.files.get(target) : null;
            if (target && targetFile && targetFile.text != null && !stack.includes(target)) {
              const sub = wysScanDocument(targetFile.text, target, project, {
                stack: stack.concat(target),
                depth: depth + 1
              });
              const base = blocks.length;
              for (const child of sub.blocks) {
                child.index += base;
                if (child.parent != null) child.parent += base;
                if (Array.isArray(child.children)) child.children = child.children.map((n) => n + base);
                if (!child.path) child.path = target;
                blocks.push(child);
              }
              i = p;
              continue;
            }
          }
          if (!WYS_SILENT_COMMANDS.has(cmd.name)) {
            push({
              kind: 'command',
              command: cmd.name,
              start: i,
              end: p,
              contentStart: group ? group.contentStart : p,
              contentEnd: group ? group.contentEnd : p,
              argument: group ? group.text : '',
              optional
            });
          }
          i = p;
          continue;
        }
      }
    }

    // Paragraph
    const paraStart = i;
    let p = i;
    while (p < range.end) {
      const nl = text.indexOf('\n', p);
      const lineEnd = nl < 0 || nl >= range.end ? range.end : nl;
      const line = text.slice(p, lineEnd);
      if (!line.trim()) break;
      if (p > paraStart && wysStartsBlock(text, p, range.end)) break;
      if (/^\s*%/.test(line)) break;
      p = lineEnd + 1;
    }
    const trimmed = wysTrimRange(text, paraStart, Math.min(p, range.end));
    if (trimmed.end <= trimmed.start) { i = p > i ? p : i + 1; continue; }
    let contentStart = trimmed.start;
    let prefix = '';
    const lead = /^\s*\\noindent\b\s*/.exec(text.slice(trimmed.start, Math.min(trimmed.start + 40, trimmed.end)));
    if (lead) {
      contentStart = trimmed.start + lead[0].length;
      prefix = text.slice(trimmed.start, contentStart);
    }
    if (text.slice(contentStart, trimmed.end).trim()) {
      push(wysMakeBlock({
        kind: 'para',
        start: trimmed.start,
        end: trimmed.end,
        contentStart,
        contentEnd: trimmed.end,
        prefix
      }, project, text, path));
    }
    i = p > i ? p : i + 1;
  }

  for (const block of blocks) {
    if (!block.path) block.path = path;
  }
  return { blocks, bodyStart: range.start, bodyEnd: range.end, hasPreamble: range.hasPreamble };
}

function wysEnvKind(env) {
  if (env === 'abstract') return 'abstract';
  if (WYS_LIST_ENVS.has(env)) return 'list';
  if (WYS_MATH_ENVS.has(env)) return 'math';
  if (env === 'figure' || env === 'figure*' || env === 'wrapfigure' || env === 'strip') return 'figure';
  if (env === 'table' || env === 'table*' || env === 'tabular' || env === 'tabular*' || env === 'longtable') return 'table';
  if (env === 'verbatim' || env === 'Verbatim' || env === 'lstlisting' || env === 'minted') return 'code';
  if (env === 'quote' || env === 'quotation' || env === 'center' || env === 'flushleft' || env === 'flushright') return 'quote';
  if (WYS_THEOREM_ENVS.has(env)) return 'theorem';
  if (env === 'proof') return 'proof';
  return 'other';
}

/* --------------------------------------------------------------------------
   Inline parsing
   -------------------------------------------------------------------------- */

function wysAtom(tex, displayHtml, cls) {
  return `<span class="wys-atom${cls ? ' ' + cls : ''}" contenteditable="false" data-tex="${escapeAttr(tex)}">${displayHtml == null ? escapeHtml(tex) : displayHtml}</span>`;
}

function wysMacroDisplay(name) {
  return `<span class="wys-macro-token">\\${escapeHtml(name)}</span>`;
}

function wysResolveLabel(project, key) {
  return project && project.labels ? project.labels[key] : null;
}

function wysCiteNumbers(project, keys) {
  const map = project && project.citations ? project.citations : null;
  if (!map) return keys.join(', ');
  const nums = keys.map((key) => map[key]).filter((n) => n != null).sort((a, b) => a - b);
  if (!nums.length) return keys.join(', ');
  return nums.join(', ');
}

function wysRefDisplay(project, cmd, key) {
  const label = wysResolveLabel(project, key);
  if (!label) return '<span class="xref missing">??</span>';
  const n = label.number || '?';
  if (cmd === 'eqref') return `(${escapeHtml(n)})`;
  if (cmd === 'ref' || cmd === 'pageref') return escapeHtml(n);
  if (cmd === 'autoref' || cmd === 'cref' || cmd === 'Cref' || cmd === 'nameref') {
    const kind = label.kind;
    const zh = !!(project && project.meta && project.meta.zh);
    if (!zh) {
      const prefix = { fig: 'Figure ', tbl: 'Table ', eq: 'Equation ', thm: 'Theorem ', sec: 'Section ', alg: 'Algorithm ' }[kind];
      return escapeHtml((prefix || '') + n);
    }
    const prefix = { fig: '图 ', tbl: '表 ', eq: '式 ', thm: '定理 ', sec: '第 ', alg: '算法 ' }[kind];
    return escapeHtml((prefix || '') + n + (kind === 'sec' ? ' 节' : ''));
  }
  return escapeHtml(n);
}

function shouldRenderDefValue(value) {
  return typeof value === 'string' && !!value && !/[\\{}#$]/.test(value);
}

function wysParseInline(src, project, fromPath) {
  const st = { safe: true };
  const text = String(src == null ? '' : src);
  const tokens = wysParseInlineSeq(text, 0, text.length, project, st, 0, fromPath);
  return {
    safe: st.safe,
    tokens,
    html: wysRenderTokens(tokens)
  };
}

function wysParseInlineSeq(s, i, limit, project, st, depth, fromPath) {
  const out = [];
  let text = '';
  const flush = () => { if (text) { out.push({ t: 'text', v: text }); text = ''; } };
  if (depth > 8) { st.safe = false; return [{ t: 'text', v: s.slice(i, limit) }]; }

  while (i < limit) {
    const ch = s[i];
    if (ch === '\\') {
      const nx = s[i + 1];
      if (nx === '\\') {
        flush();
        let p = i + 2;
        if (s[p] === '*') p++;
        const opt = s[p] === '[' ? wysReadBracket(s, p, limit) : null;
        if (opt) p = opt.end;
        out.push({ t: 'break' });
        i = p;
        continue;
      }
      if (nx && '&%$#_{}'.includes(nx)) { text += nx; i += 2; continue; }
      if (nx === ' ') { text += ' '; i += 2; continue; }
      if (nx === ',' || nx === ';' || nx === ':' || nx === '!') {
        flush();
        out.push({ t: 'atom', tex: s.slice(i, i + 2), html: ' ' });
        i += 2;
        continue;
      }
      if (nx === '(') {
        const close = s.indexOf('\\)', i + 2);
        if (close < 0 || close >= limit) { st.safe = false; text += '\\('; i += 2; continue; }
        flush();
        const tex = s.slice(i, close + 2);
        out.push({ t: 'atom', tex, html: escapeHtml(tex), cls: 'tex-math wys-math-atom' });
        i = close + 2;
        continue;
      }
      if (nx === '[') {
        const d = wysFindDisplayEnd(s, i, limit);
        st.safe = false;
        if (d) {
          flush();
          out.push({ t: 'atom', tex: s.slice(i, d.end), html: escapeHtml(`\\[${s.slice(d.contentStart, d.contentEnd)}\\]`), cls: 'tex-math wys-math-atom' });
          i = d.end;
        } else { text += '\\['; i += 2; }
        continue;
      }
      const cmd = wysCommandAt(s, i);
      if (!cmd) { text += '\\'; i++; continue; }
      const name = cmd.name;

      // Unbraced declaration (\bf text) styles the rest of this scope.
      if (WYS_DECL_MACROS[name]) {
        const p = wysSkipSpaces(s, cmd.end, limit);
        const g = s[p] === '{' ? wysReadGroup(s, p, limit) : null;
        flush();
        const child = g
          ? wysParseInlineSeq(s, g.contentStart, g.contentEnd, project, st, depth + 1, fromPath)
          : wysParseInlineSeq(s, cmd.end, limit, project, st, depth + 1, fromPath);
        out.push({ t: 'mark', kind: WYS_DECL_MACROS[name], children: child });
        i = g ? g.end : limit;
        continue;
      }

      if (WYS_FORMAT_MACROS[name]) {
        let p = wysSkipSpaces(s, cmd.end, limit);
        if (s[p] !== '{') { st.safe = false; text += s.slice(i, cmd.end); i = cmd.end; continue; }
        const g = wysReadGroup(s, p, limit);
        if (!g) { st.safe = false; text += s.slice(i, cmd.end); i = cmd.end; continue; }
        flush();
        const child = wysParseInlineSeq(s, g.contentStart, g.contentEnd, project, st, depth + 1, fromPath);
        out.push({ t: 'mark', kind: name, children: child });
        i = g.end;
        continue;
      }

      if (name === 'href') {
        let p = wysSkipSpaces(s, cmd.end, limit);
        const url = s[p] === '{' ? wysReadGroup(s, p, limit) : null;
        if (!url) { st.safe = false; text += s.slice(i, cmd.end); i = cmd.end; continue; }
        let q = wysSkipSpaces(s, url.end, limit);
        const label = s[q] === '{' ? wysReadGroup(s, q, limit) : null;
        if (!label) { st.safe = false; text += s.slice(i, url.end); i = url.end; continue; }
        flush();
        out.push({
          t: 'atom',
          tex: s.slice(i, label.end),
          html: `<span class="wys-link-token">${escapeHtml(wysBraceText(label.text) || url.text)}</span>`,
          cls: 'wys-link'
        });
        i = label.end;
        continue;
      }

      if (name === 'url') {
        const p = wysSkipSpaces(s, cmd.end, limit);
        const g = s[p] === '{' ? wysReadGroup(s, p, limit) : null;
        if (!g) { st.safe = false; text += s.slice(i, cmd.end); i = cmd.end; continue; }
        flush();
        out.push({ t: 'atom', tex: s.slice(i, g.end), html: `<span class="wys-link-token">${escapeHtml(g.text)}</span>`, cls: 'wys-link' });
        i = g.end;
        continue;
      }

      if (/^cite/.test(name)) {
        let p = cmd.end;
        let groups = 0;
        while (groups < 2) {
          p = wysSkipSpaces(s, p, limit);
          if (s[p] !== '[') break;
          const opt = wysReadBracket(s, p, limit);
          if (!opt) break;
          p = opt.end;
          groups++;
        }
        p = wysSkipSpaces(s, p, limit);
        const g = s[p] === '{' ? wysReadGroup(s, p, limit) : null;
        if (!g) { st.safe = false; text += s.slice(i, cmd.end); i = cmd.end; continue; }
        flush();
        const keys = g.text.split(',').map((x) => x.trim()).filter(Boolean);
        out.push({
          t: 'atom',
          tex: s.slice(i, g.end),
          html: `<span class="wys-cite">[${escapeHtml(wysCiteNumbers(project, keys))}]</span>`,
          cls: 'wys-cite-atom'
        });
        i = g.end;
        continue;
      }

      if (['ref', 'eqref', 'pageref', 'autoref', 'cref', 'Cref', 'nameref'].includes(name)) {
        const p = wysSkipSpaces(s, cmd.end, limit);
        const g = s[p] === '{' ? wysReadGroup(s, p, limit) : null;
        if (!g) { st.safe = false; text += s.slice(i, cmd.end); i = cmd.end; continue; }
        flush();
        out.push({ t: 'atom', tex: s.slice(i, g.end), html: wysRefDisplay(project, name, g.text.trim()), cls: 'wys-ref-atom' });
        i = g.end;
        continue;
      }

      if (name === 'label') {
        const p = wysSkipSpaces(s, cmd.end, limit);
        const g = s[p] === '{' ? wysReadGroup(s, p, limit) : null;
        if (!g) { st.safe = false; text += s.slice(i, cmd.end); i = cmd.end; continue; }
        flush();
        out.push({ t: 'atom', tex: s.slice(i, g.end), html: '<span class="wys-label-mark" title="标签">#</span>', cls: 'wys-label-atom' });
        i = g.end;
        continue;
      }

      if (name === 'footnote' || name === 'thanks') {
        const p = wysSkipSpaces(s, cmd.end, limit);
        const g = s[p] === '{' ? wysReadGroup(s, p, limit) : null;
        if (!g) { st.safe = false; text += s.slice(i, cmd.end); i = cmd.end; continue; }
        flush();
        out.push({ t: 'atom', tex: s.slice(i, g.end), html: '<sup class="wys-fn">*</sup>', cls: 'wys-fn-atom' });
        i = g.end;
        continue;
      }

      if (name === 'includegraphics') {
        let p = wysSkipSpaces(s, cmd.end, limit);
        const opt = s[p] === '[' ? wysReadBracket(s, p, limit) : null;
        if (opt) p = wysSkipSpaces(s, opt.end, limit);
        const g = s[p] === '{' ? wysReadGroup(s, p, limit) : null;
        if (!g) { st.safe = false; text += s.slice(i, cmd.end); i = cmd.end; continue; }
        flush();
        const url = wysAssetUrl(g.text.trim(), fromPath || wys.path);
        const html = url
          ? `<img class="wys-inline-img" src="${escapeAttr(url)}" alt="">`
          : `<span class="wys-macro-token">\\includegraphics</span>`;
        out.push({ t: 'atom', tex: s.slice(i, g.end), html, cls: 'wys-image-atom' });
        i = g.end;
        continue;
      }

      if (name === 'begin' || name === 'end') {
        st.safe = false;
        const p = wysSkipSpaces(s, cmd.end, limit);
        const g = s[p] === '{' ? wysReadGroup(s, p, limit) : null;
        const end = g ? g.end : cmd.end;
        flush();
        out.push({ t: 'atom', tex: s.slice(i, end), html: `<span class="wys-macro-token">\\${name}{…}</span>` });
        i = end;
        continue;
      }

      if (WYS_SYMBOL_MACROS[name] != null) {
        let p = cmd.end;
        let tex = s.slice(i, cmd.end);
        if (s[p] === '{' && s[p + 1] === '}') { tex = s.slice(i, p + 2); p += 2; }
        flush();
        out.push({ t: 'atom', tex, html: `<span class="wys-symbol">${escapeHtml(WYS_SYMBOL_MACROS[name])}</span>`, cls: 'wys-symbol-atom' });
        i = p;
        continue;
      }

      // Simple user definitions (\def\confName{CVPR}) render as their value
      // while keeping the original source for round-tripping.
      const defs = project && project.meta && project.meta.defs;
      if (defs && typeof defs[name] === 'string' && shouldRenderDefValue(defs[name])) {
        flush();
        out.push({
          t: 'atom',
          tex: s.slice(i, cmd.end),
          html: `<span class="wys-symbol">${escapeHtml(defs[name])}</span>`,
          cls: 'wys-symbol-atom'
        });
        i = cmd.end;
        continue;
      }

      // Unknown macro: keep it intact as an atomic chip. Consume immediate
      // optional/required arguments so the chip covers the whole call.
      let p = cmd.end;
      let consumed = false;
      for (let n = 0; n < 4; n++) {
        const q = wysSkipSpaces(s, p, limit);
        if (s[q] === '[') {
          const opt = wysReadBracket(s, q, limit);
          if (!opt) break;
          p = opt.end; consumed = true; continue;
        }
        if (s[q] === '{') {
          const g = wysReadGroup(s, q, limit);
          if (!g) break;
          p = g.end; consumed = true; continue;
        }
        break;
      }
      flush();
      out.push({
        t: 'atom',
        tex: s.slice(i, p),
        html: consumed ? `<span class="wys-macro-token">\\${escapeHtml(name)}{…}</span>` : wysMacroDisplay(name),
        cls: 'wys-macro-atom'
      });
      i = p;
      continue;
    }

    if (ch === '$') {
      if (s.startsWith('$$', i)) {
        st.safe = false;
        const d = wysFindDisplayEnd(s, i, limit);
        if (d) {
          flush();
          out.push({ t: 'atom', tex: s.slice(i, d.end), html: escapeHtml(`\\[${s.slice(d.contentStart, d.contentEnd)}\\]`), cls: 'tex-math wys-math-atom' });
          i = d.end;
        } else { text += '$$'; i += 2; }
        continue;
      }
      let p = i + 1;
      let found = -1;
      while (p < limit) {
        if (s[p] === '\\') { p += 2; continue; }
        if (s[p] === '$') { found = p; break; }
        p++;
      }
      if (found < 0) { st.safe = false; text += '$'; i++; continue; }
      flush();
      const tex = s.slice(i, found + 1);
      out.push({ t: 'atom', tex, html: escapeHtml(`\\(${s.slice(i + 1, found)}\\)`), cls: 'tex-math wys-math-atom' });
      i = found + 1;
      continue;
    }

    if (ch === '%') {
      st.safe = false;
      const nl = s.indexOf('\n', i);
      const end = nl < 0 || nl > limit ? limit : nl;
      flush();
      out.push({ t: 'atom', tex: s.slice(i, end), html: `<span class="wys-comment-token">%…</span>`, cls: 'wys-comment-atom' });
      i = end;
      continue;
    }

    if (ch === '~') { text += '\u00A0'; i++; continue; }
    if (ch === '{') {
      // Old-style font declarations scope to the group: {\bf text}.
      const g = wysReadGroup(s, i, limit);
      const decl = g ? /^\s*\\([A-Za-z]+)\s*/.exec(g.text) : null;
      const kind = decl ? WYS_DECL_MACROS[decl[1]] : null;
      if (g && kind) {
        flush();
        const child = wysParseInlineSeq(s, g.contentStart + decl[0].length, g.contentEnd, project, st, depth + 1, fromPath);
        out.push({ t: 'mark', kind, children: child });
        i = g.end;
        continue;
      }
      i++;
      continue;
    }
    if (ch === '}') { i++; continue; }
    if (ch === '\n' || ch === '\r') { text += ' '; i++; continue; }
    text += ch;
    i++;
  }
  flush();
  return out;
}

// TeX's ``...''/`...' pairs read as typographic quotes on the page.
function wysSmartQuotes(value) {
  return String(value || '')
    .replace(/``/g, '“')
    .replace(/''/g, '”')
    .replace(/`/g, '‘')
    .replace(/'/g, '’');
}

function wysRenderTokens(tokens) {
  return tokens.map((tok) => {
    if (tok.t === 'text') return escapeHtml(wysSmartQuotes(tok.v));
    if (tok.t === 'break') return '<br>';
    if (tok.t === 'atom') {
      return `<span class="wys-atom${tok.cls ? ' ' + tok.cls : ''}" contenteditable="false" data-tex="${escapeAttr(tok.tex)}">${tok.html}</span>`;
    }
    if (tok.t === 'mark') {
      const kind = tok.kind;
      const tag = kind === 'underline' ? 'u' : kind === 'texttt' ? 'code' : kind === 'textbf' ? 'strong' : kind === 'textit' || kind === 'emph' ? 'em' : 'span';
      return `<${tag} data-wys-mark="${escapeAttr(kind)}">${wysRenderTokens(tok.children)}</${tag}>`;
    }
    return '';
  }).join('');
}

/* --------------------------------------------------------------------------
   DOM → LaTeX
   -------------------------------------------------------------------------- */

const WYS_LATEX_ESCAPES = {
  '\\': '\\textbackslash{}',
  '{': '\\{',
  '}': '\\}',
  '%': '\\%',
  '$': '\\$',
  '&': '\\&',
  '#': '\\#',
  '_': '\\_',
  '^': '\\^{}',
  '~': '\\textasciitilde{}',
  '\u00A0': '~'
};

function wysEscapeText(value) {
  return String(value || '')
    .replace(/[\u201C\u201D\u2018\u2019]/g, (ch) => ({ '\u201C': '``', '\u201D': "''", '\u2018': '`', '\u2019': "'" }[ch]))
    .replace(/[\\{}%$&#_^~\u00A0]/g, (ch) => WYS_LATEX_ESCAPES[ch] || ch);
}

function wysSerializeNodes(nodes) {
  let out = '';
  for (const node of nodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      out += wysEscapeText(node.nodeValue);
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const el = node;
    if (el.dataset && el.dataset.tex != null) { out += el.dataset.tex; continue; }
    const tag = el.tagName.toLowerCase();
    if (tag === 'br') { out += '\\\\'; continue; }
    const inner = wysSerializeNodes(el.childNodes);
    const mark = el.dataset ? el.dataset.wysMark : '';
    if (tag === 'strong' || tag === 'b' || (el.style && el.style.fontWeight === 'bold')) out += `\\textbf{${inner}}`;
    else if (tag === 'em' || tag === 'i' || (el.style && el.style.fontStyle === 'italic')) {
      out += mark === 'textit' ? `\\textit{${inner}}` : mark === 'textnormal' ? inner : `\\emph{${inner}}`;
    } else if (tag === 'code' || tag === 'tt') out += `\\texttt{${inner}}`;
    else if (tag === 'u' || (el.style && /underline/.test(el.style.textDecoration || ''))) out += `\\underline{${inner}}`;
    else if (tag === 'a' && el.dataset && el.dataset.href) out += `\\href{${el.dataset.href}}{${inner}}`;
    else if (mark && WYS_FORMAT_MACROS[mark]) out += `\\${mark}{${inner}}`;
    else out += inner;
  }
  return out;
}

function wysCleanLatex(value) {
  return String(value || '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, ' ')
    .replace(/\s+([,.;:!?，。；：！？])/g, '$1')
    .trim();
}

function wysSerializeBlockText(el) {
  return wysCleanLatex(wysSerializeNodes(el.childNodes));
}

/* --------------------------------------------------------------------------
   Rendering
   -------------------------------------------------------------------------- */

function wysAssetUrl(ref, fromPath) {
  const raw = String(ref || '').trim().replace(/^["']|["']$/g, '');
  if (!raw) return '';
  const ext = pathExt(raw);
  const exts = ext ? [''] : ['', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.pdf'];
  const fromDir = pathDir(fromPath || '');
  const candidates = raw.startsWith('/')
    ? [normalizeProjectPath(raw.slice(1))]
    : [normalizeProjectPath(fromDir ? `${fromDir}/${raw}` : raw), normalizeProjectPath(raw)];
  for (const base of candidates) {
    if (!base) continue;
    for (const suffix of exts) {
      const key = normalizeProjectPath(base + suffix);
      if (state.assetUrls && state.assetUrls.has(key)) return state.assetUrls.get(key);
      if (state.assets && state.assets.has(key)) return state.assets.get(key);
    }
  }
  return '';
}

function wysResolveTexPath(ref, fromPath) {
  const raw = String(ref || '').trim();
  if (!raw) return '';
  const fromDir = pathDir(fromPath || '');
  const candidates = [
    normalizeProjectPath(fromDir ? `${fromDir}/${raw}` : raw),
    normalizeProjectPath(raw)
  ];
  for (const base of candidates) {
    for (const suffix of (pathExt(base) ? [''] : ['.tex'])) {
      const key = normalizeProjectPath(base + suffix);
      if (state.files.has(key)) return key;
    }
  }
  return '';
}

function wysHoverTool(block, label = '源码') {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'wys-tool';
  btn.textContent = label;
  btn.title = '在源码模式中编辑这一块';
  btn.dataset.wysSource = String(block.index);
  return btn;
}

function wysParagraphSurface(block, project, opts = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'wys-block wys-para' + (block.kind === 'keywords' ? ' wys-keywords-block' : '') + (opts.className ? ' ' + opts.className : '');
  wrap.dataset.block = String(block.index);
  if (block.path) wrap.dataset.path = block.path;
  if (block.kind === 'keywords') {
    const prefix = document.createElement('span');
    prefix.className = 'wys-prefix';
    prefix.textContent = '关键词：';
    wrap.appendChild(prefix);
  }
  const text = document.createElement('div');
  text.className = 'wys-text';
  text.spellcheck = false;
  text.contentEditable = block.editable ? 'true' : 'false';
  if (!block.editable) text.classList.add('is-readonly');
  text.innerHTML = block.parsed.html;
  if (block.prefix) wrap.dataset.prefix = block.prefix;
  wrap.appendChild(text);
  if (!block.editable) wrap.appendChild(wysHoverTool(block));
  return wrap;
}

function wysHeadingSurface(block, project) {
  const tag = `h${clamp(block.level || 2, 1, 6)}`;
  const head = document.createElement(tag);
  head.className = 'wys-block wys-heading';
  head.dataset.block = String(block.index);
  if (block.path) head.dataset.path = block.path;
  if (block.number) {
    const num = document.createElement('span');
    num.className = 'wys-heading-num';
    num.textContent = block.number;
    head.appendChild(num);
  }
  const text = document.createElement('span');
  text.className = 'wys-text';
  text.spellcheck = false;
  text.contentEditable = block.editable ? 'true' : 'false';
  if (!block.editable) text.classList.add('is-readonly');
  text.innerHTML = block.parsed.html;
  head.appendChild(text);
  const file = state.files.get(block.path || wys.path);
  const label = block.label
    || (/\\label\s*\{([^}]*)\}/.exec(file ? file.text.slice(block.contentEnd, block.end) : '') || [])[1];
  if (label) {
    const anchor = document.createElement('span');
    anchor.className = 'wys-anchor';
    anchor.textContent = label;
    anchor.title = '标签';
    head.appendChild(anchor);
  }
  if (!block.editable) head.appendChild(wysHoverTool(block));
  return head;
}

function wysItemSurface(block, project) {
  const li = document.createElement('li');
  li.className = 'wys-block wys-item';
  li.dataset.block = String(block.index);
  if (block.path) li.dataset.path = block.path;
  if (block.label) {
    const label = document.createElement('span');
    label.className = 'wys-item-label';
    label.innerHTML = wysParseInline(block.label, project, block.path).html;
    li.appendChild(label);
  }
  const text = document.createElement('div');
  text.className = 'wys-text';
  text.spellcheck = false;
  text.contentEditable = block.editable ? 'true' : 'false';
  if (!block.editable) text.classList.add('is-readonly');
  text.innerHTML = block.parsed.html;
  li.appendChild(text);
  if (!block.editable) li.appendChild(wysHoverTool(block));
  return li;
}

function wysVisualBlock(block, extraClass, bodyHtml, label) {
  const wrap = document.createElement('div');
  wrap.className = `wys-block wys-visual${extraClass ? ' ' + extraClass : ''}`;
  wrap.dataset.block = String(block.index);
  if (block.path) wrap.dataset.path = block.path;
  if (label) wrap.setAttribute('aria-label', label);
  wrap.innerHTML = bodyHtml;
  wrap.appendChild(wysHoverTool(block));
  return wrap;
}

function wysBlockNumber(raw, project) {
  const m = /\\label\s*\{([^}]*)\}/.exec(raw || '');
  if (!m) return '';
  const label = wysResolveLabel(project, m[1].trim());
  return label && label.number ? String(label.number) : '';
}

function wysCaptionHtml(caption, project, raw, kind, fromPath) {
  if (!caption) return '';
  const zh = !!(project && project.meta && project.meta.zh);
  const word = kind === 'table' ? (zh ? '表' : 'Table') : (zh ? '图' : 'Figure');
  const number = wysBlockNumber(raw, project);
  return `<div class="wys-caption"><span class="wys-caption-label">${word}${number ? ' ' + escapeHtml(number) : ''}</span>${wysParseInline(caption, project, fromPath).html}</div>`;
}

function wysExtractFirst(raw, re) {
  const m = re.exec(raw || '');
  if (!m) return null;
  const g = wysReadGroup(raw, m.index + m[0].length - 1, raw.length);
  return g ? { group: g, match: m } : null;
}

function wysFigureBody(raw, project, block) {
  let caption = wysExtractFirst(raw, /\\caption\*?\s*(?:\[[^\]]*\]\s*)?\{/g);
  if (!caption) {
    caption = wysExtractFirst(raw, /\\captionof\s*\{[^}]*\}\s*(?:\[[^\]]*\]\s*)?\{/g);
  }
  const graphics = [];
  const re = /\\includegraphics\s*(?:\[([^\]]*)\])?\s*\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(raw))) graphics.push({ opts: m[1] || '', ref: m[2] });
  let html = '';
  if (graphics.length) {
    const fromPath = (block && block.path) || wys.path;
    const parts = graphics.map((graphic) => {
      const url = wysAssetUrl(graphic.ref, fromPath);
      const width = wysGraphicWidth(graphic.opts);
      if (url) {
        return `<img src="${escapeAttr(url)}" alt="${escapeAttr(pathBase(graphic.ref))}"${width ? ` style="width:${width}"` : ''}>`;
      }
      // The mwe example images are not project assets but the TeX engine still
      // typesets them, so keep their golden-ratio footprint in the visual page.
      const example = /^example-image/i.test(pathBase(graphic.ref));
      return `<div class="wys-figure-missing${example ? ' wys-figure-example' : ''}">图片未找到 · <code>${escapeHtml(graphic.ref)}</code></div>`;
    });
    html += graphics.length > 1
      ? `<div class="wys-figure-media wys-figure-strip">${parts.join('')}</div>`
      : `<div class="wys-figure-media">${parts[0]}</div>`;
  }
  if (caption) html += wysCaptionHtml(caption.group.text, project, raw, 'figure', block && block.path);
  if (!html) html = `<pre class="wys-source">${escapeHtml(raw.trim())}</pre>`;
  return html;
}

function wysGraphicWidth(opts) {
  const m = /(?:^|,)\s*width\s*=\s*([^,\]]+)/.exec(opts || '');
  if (!m) return '';
  const value = m[1].trim();
  const rel = /^([\d.]+)\s*\\(?:linewidth|textwidth|columnwidth|hsize)/.exec(value);
  if (rel) return `${(clamp(Number(rel[1]) || 1, 0.05, 1) * 100).toFixed(1)}%`;
  const abs = /^([\d.]+)\s*(cm|mm|in|pt|em|ex)$/.exec(value);
  if (abs) return `${abs[1]}${abs[2]}`;
  return '';
}

function wysSplitRows(raw) {
  const rows = [];
  let row = '';
  let depth = 0;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '\\') {
      if (raw[i + 1] === '\\') {
        if (depth === 0) {
          const opt = raw[i + 2] === '[' ? /^\[[^\]]*\]/.exec(raw.slice(i + 2)) : null;
          rows.push(row);
          row = '';
          i += 1 + (opt ? opt[0].length : 0);
          continue;
        }
        row += '\\\\';
        i++;
        continue;
      }
      const cmd = wysCommandAt(raw, i);
      if (cmd) { row += raw.slice(i, cmd.end); i = cmd.end - 1; continue; }
      row += ch;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') depth = Math.max(0, depth - 1);
    if (ch === '&' && depth === 0) { row += '\u0000'; continue; }
    row += ch;
  }
  if (row.trim()) rows.push(row);
  return rows
    .map((r) => r.replace(/\\(?:toprule|midrule|bottomrule|hline)\b(\[[^\]]*\])?/g, '')
      .replace(/\\cmidrule\s*(\([^)]*\))?\s*\{[^}]*\}/g, '')
      .replace(/\\addlinespace\b(\[[^\]]*\])?/g, '')
      .trim())
    .filter((r) => r.length);
}

function wysTableBody(raw, project, fromPath) {
  let caption = '';
  const cap = wysExtractFirst(raw, /\\caption\*?\s*(?:\[[^\]]*\]\s*)?\{/g);
  if (cap) caption = cap.group.text;
  let tabular = raw;
  const begin = /\\begin\s*\{(tabular\*?|longtable)\}/.exec(raw);
  if (begin) {
    let bodyStart = begin.index + begin[0].length;
    const g = raw[bodyStart] === '{' ? wysReadGroup(raw, bodyStart, raw.length) : null;
    if (g) bodyStart = g.end;
    const close = wysFindEnvEnd(raw, bodyStart, raw.length, begin[1]);
    if (close) tabular = raw.slice(bodyStart, close.innerEnd);
  }
  const rows = wysSplitRows(tabular).slice(0, 80);
  let table = '<table class="wys-table">';
  rows.forEach((row, index) => {
    const cells = row.split('\u0000').map((cell) => {
      let clean = cell.trim();
      const mc = /^\\multicolumn\s*\{[^}]*\}\s*\{[^}]*\}\s*\{/.exec(clean);
      if (mc) {
        const g = wysReadGroup(clean, mc[0].length - 1, clean.length);
        if (g) clean = g.text;
      }
      return `<td>${wysParseInline(clean, project, fromPath).html}</td>`;
    });
    table += `<tr${index === 0 ? ' class="head"' : ''}>${cells.join('')}</tr>`;
  });
  table += '</table>';
  let html = '';
  if (caption) html += wysCaptionHtml(caption, project, raw, 'table', fromPath);
  html += table;
  return html;
}

function wysMathBody(raw, env, project) {
  const number = wysBlockNumber(raw, project);
  let body = String(raw || '')
    .replace(/\\label\s*\{[^}]*\}/g, '')
    .replace(/\\(?:nonumber|notag)\b/g, '')
    .trim();
  if (/^align|^flalign|^alignat|^eqnarray/.test(env || '')) body = `\\begin{aligned}${body}\\end{aligned}`;
  else if (/^gather/.test(env || '')) body = `\\begin{gathered}${body}\\end{gathered}`;
  return `<div class="wys-equation tex-math">\\[${escapeHtml(body)}\\]${number ? `<span class="wys-eq-number">(${escapeHtml(number)})</span>` : ''}</div>`;
}

function wysRenderBlock(block, project) {
  if (block.kind === 'heading') return wysHeadingSurface(block, project);
  if (block.kind === 'para' || block.kind === 'keywords') return wysParagraphSurface(block, project);
  if (block.kind === 'item') return wysItemSurface(block, project);

  if (block.kind === 'abstract' || block.kind === 'quote' || block.kind === 'theorem' || block.kind === 'proof' || block.kind === 'list') {
    const wrap = document.createElement('div');
    wrap.className = `wys-block wys-container wys-${block.kind}`;
    wrap.dataset.block = String(block.index);
    if (block.path) wrap.dataset.path = block.path;
    const zh = !!(project && project.meta && project.meta.zh);
    if (block.kind === 'abstract') {
      const title = document.createElement('div');
      title.className = 'wys-container-title wys-abstract-title';
      title.textContent = zh ? '摘要' : 'Abstract';
      wrap.appendChild(title);
    } else if (block.kind === 'theorem') {
      const name = zh ? (WYS_THEOREM_NAMES[block.env] || block.env) : (WYS_THEOREM_EN_NAMES[block.env] || block.env);
      const number = wysBlockNumber(block.raw, project);
      const head = document.createElement('div');
      head.className = 'wys-theorem-head';
      head.textContent = `${name}${number ? ' ' + number : ''}${block.title ? (zh ? `（${wysBraceText(block.title)}）` : ` (${wysBraceText(block.title)})`) : ''}.`;
      wrap.appendChild(head);
    } else if (block.kind === 'proof') {
      const head = document.createElement('div');
      head.className = 'wys-proof-head';
      head.textContent = zh ? '证明.' : 'Proof.';
      wrap.appendChild(head);
    }

    if (block.kind === 'list') {
      const list = document.createElement(block.env === 'enumerate' ? 'ol' : block.env === 'description' ? 'dl' : 'ul');
      list.className = 'wys-list';
      for (const childIndex of block.children || []) {
        const child = wys.blocks[childIndex];
        if (!child) continue;
        if (block.env === 'description') {
          const dt = document.createElement('dt');
          dt.textContent = child.label || '';
          list.appendChild(dt);
          const dd = document.createElement('dd');
          dd.appendChild(wysItemSurface(child, project).querySelector('.wys-text'));
          dd.dataset.block = String(child.index);
          list.appendChild(dd);
        } else {
          list.appendChild(wysItemSurface(child, project));
        }
      }
      wrap.appendChild(list);
    } else {
      for (const childIndex of block.children || []) {
        const child = wys.blocks[childIndex];
        if (child) wrap.appendChild(wysRenderBlock(child, project));
      }
      if (block.kind === 'proof') {
        const qed = document.createElement('span');
        qed.className = 'wys-qed';
        qed.textContent = '□';
        wrap.appendChild(qed);
      }
    }
    wrap.appendChild(wysHoverTool(block));
    return wrap;
  }

  if (block.kind === 'math') {
    return wysVisualBlock(block, 'wys-block-equation', wysMathBody(block.raw, '', project), '公式');
  }
  if (block.kind === 'environment') {
    const kind = wysEnvKind(block.env);
    if (kind === 'math') return wysVisualBlock(block, 'wys-block-equation', wysMathBody(block.raw, block.env, project), block.env);
    if (kind === 'figure' || kind === 'table') {
      const el = kind === 'figure'
        ? wysVisualBlock(block, 'wys-block-figure', wysFigureBody(block.raw, project, block), block.env)
        : wysVisualBlock(block, 'wys-block-table', wysTableBody(block.raw, project, block.path), block.env);
      if (block.env === 'strip' || /\*$/.test(block.env)) el.classList.add('wys-span-all');
      return el;
    }
    if (kind === 'code') return wysVisualBlock(block, 'wys-block-code', `<pre class="wys-source">${escapeHtml(block.raw.trim())}</pre>`, block.env);
    return wysVisualBlock(block, 'wys-block-env', `<pre class="wys-source">${escapeHtml(block.raw.trim())}</pre>`, block.env);
  }
  if (block.kind === 'command') return wysCommandCard(block, project);
  return wysVisualBlock(block, 'wys-block-src', `<pre class="wys-source">${escapeHtml(block.raw || '')}</pre>`);
}

function wysCommandCard(block, project) {
  const cmd = block.command;
  const fromPath = block.path || wys.path;
  const fileName = pathBase(fromPath);
  if (cmd === 'maketitle') {
    const meta = (project && project.meta) || {};
    const profile = wys.profile;
    const zh = !!meta.zh;
    let titleLines = Array.isArray(meta.titleLines) && meta.titleLines.length
      ? meta.titleLines
      : [meta.title || (zh ? '未命名文稿' : 'Untitled Paper')];
    let groups = Array.isArray(meta.authorGroups) ? meta.authorGroups.filter((g) => g.length) : [];
    if (meta.anonymous && profile === 'cvpr') {
      groups = [[`Anonymous ${meta.confName || 'CVPR'} submission`, `Paper ID ${meta.paperId || '*****'}`]];
    } else if (meta.anonymous && profile === 'neurips') {
      groups = [['Anonymous Author(s)', 'Affiliation', 'Address', 'email']];
    }
    const authors = groups.length
      ? `<div class="wys-title-authors">${groups.map((group) => `<div class="wys-title-author">${group.map((line) => escapeHtml(line)).join('<br>')}</div>`).join('')}</div>`
      : '';
    const showDate = profile !== 'cvpr' && profile !== 'neurips' && meta.date;
    const html = `<div class="wys-title-block">
      <h1>${titleLines.map((line) => escapeHtml(line)).join('<br>')}</h1>
      ${authors}
      ${showDate ? `<div class="wys-title-date">${escapeHtml(meta.date)}</div>` : ''}
    </div>`;
    return wysVisualBlock(block, 'wys-block-title', html, '标题');
  }
  if (cmd === 'tableofcontents') {
    const toc = (project && project.toc) || [];
    const zh = !!(project && project.meta && project.meta.zh);
    const html = toc.length
      ? `<div class="wys-toc"><div class="wys-toc-title">${zh ? '目录' : 'Contents'}</div>${toc.map((item) => {
        const level = Math.max(1, item.level || 1);
        return `<div class="wys-toc-item" style="--toc-level:${level - 1}">`
          + `<span class="wys-toc-num">${escapeHtml(item.number || '')}</span>`
          + `<span class="wys-toc-text">${escapeHtml(item.title || '')}</span>`
          + '<span class="wys-toc-dots"></span>'
          + '</div>';
      }).join('')}</div>`
      : `<div class="wys-visual-note">${zh ? '目录将在编译后生成' : 'Contents will appear after compilation'}</div>`;
    return wysVisualBlock(block, 'wys-block-toc', html, '目录');
  }
  if (cmd === 'input' || cmd === 'include' || cmd === 'subfile') {
    const target = wysResolveTexPath(block.argument, fromPath);
    const targetFile = target ? state.files.get(target) : null;
    const exists = !!targetFile;
    const html = `<div class="wys-include-line">
      <span class="wys-include-icon">▸</span>
      <code>${escapeHtml(block.argument || '(空)')}</code>
      ${target && target !== block.argument && target !== `${block.argument}.tex` ? `<span class="wys-include-resolved">${escapeHtml(target)}</span>` : ''}
      ${exists ? `<button type="button" class="wys-open-file" data-path="${escapeAttr(target)}">打开</button>` : '<span class="wys-include-missing">未找到</span>'}
    </div>`;
    return wysVisualBlock(block, 'wys-block-include', html, `\\${cmd}`);
  }
  if (cmd === 'bibliography' || cmd === 'printbibliography') {
    const bibs = (project && project.meta && project.meta.bibFiles) || [];
    const count = project && project.citations ? Object.keys(project.citations).length : 0;
    const html = `<div class="wys-bib-line"><b>参考文献</b><span>${bibs.length ? bibs.map(escapeHtml).join(', ') : escapeHtml(block.argument || '未指定 .bib 文件')}</span>${count ? `<small>${count} 条引用</small>` : ''}</div>`;
    return wysVisualBlock(block, 'wys-block-bib', html, `\\${cmd}`);
  }
  if (cmd === 'appendix') return wysVisualBlock(block, 'wys-block-divider', '<div class="wys-divider"><span>附录</span></div>', '\\appendix');
  if (cmd === 'newpage' || cmd === 'clearpage' || cmd === 'cleardoublepage' || cmd === 'pagebreak') {
    return wysVisualBlock(block, 'wys-block-divider', '<div class="wys-divider"><span>分页</span></div>', `\\${cmd}`);
  }
  if (cmd === 'keywords') {
    const fake = {
      index: block.index,
      kind: 'keywords',
      raw: block.argument,
      path: fromPath,
      parsed: wysParseInline(block.argument, project, fromPath),
      editable: wysParseInline(block.argument, project, fromPath).safe,
      prefix: '\\keywords{'
    };
    return wysParagraphSurface(fake, project);
  }
  return wysVisualBlock(block, 'wys-block-src', `<pre class="wys-source">${escapeHtml(`\\${cmd}`)}</pre>`, fileName);
}

function wysPreambleChip(lineCount, meta, path) {
  const chip = document.createElement('div');
  chip.className = 'wys-preamble';
  chip.innerHTML = `<div class="wys-preamble-text"><b>导言区</b><small>${lineCount} 行 · ${escapeHtml((meta && meta.docClass) || 'LaTeX')} · 宏包与文档设置</small></div>`;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn btn-soft wys-preamble-btn';
  btn.textContent = '编辑导言区';
  btn.addEventListener('click', () => {
    setEditorMode('source');
    if (path && state.activePath !== path) openFile(path);
    if (editor) {
      editor.setCursor({ line: 0, ch: 0 });
      editor.focus();
    }
  });
  chip.appendChild(btn);
  return chip;
}

/* --------------------------------------------------------------------------
   Render the document into #wysiwyg
   -------------------------------------------------------------------------- */

// Measure the page box from the active profile. A block is laid out at the
// real column width so its height can be used to split the paper into pages.
function wysPageMetrics(host, profile) {
  const cs = getComputedStyle(host);
  const rawNum = (name, fallback) => {
    const v = parseFloat(String(cs.getPropertyValue(name) || '').trim());
    return Number.isFinite(v) ? v : fallback;
  };
  const pageWidth = rawNum('--wys-page-width', 816);
  const pageHeight = rawNum('--wys-page-height', 1056);
  const padX = pageWidth * rawNum('--wys-pad-x', 11.76) / 100;
  // CSS resolves percentage padding against the containing block's width,
  // including padding-top/bottom, so all three margins scale with page width.
  const padTop = pageWidth * rawNum('--wys-pad-top', 11.76) / 100;
  const padBottom = pageWidth * rawNum('--wys-pad-bottom', 13.24) / 100;
  const columns = profile === 'cvpr' || profile === 'twocolumn';
  const contentWidth = pageWidth - padX * 2;
  const gap = columns ? contentWidth * 0.0455 : 0;
  const columnWidth = columns ? (contentWidth - gap) / 2 : contentWidth;
  return {
    pageWidth,
    pageHeight,
    padX,
    padTop,
    padBottom,
    contentWidth,
    contentHeight: pageHeight - padTop - padBottom,
    columns,
    gap,
    columnWidth
  };
}

// Full-width blocks interrupt the two-column flow: the centered title, the
// teaser strip, and starred floats all span both columns in the template.
function wysIsWideBlock(block, metrics) {
  if (!metrics.columns) return false;
  if (block.kind === 'command' && (block.command === 'maketitle' || block.command === 'tableofcontents')) return true;
  if (block.kind === 'environment' && (block.env === 'strip' || /\*$/.test(block.env || ''))) return true;
  return false;
}

function wysWaitForImages(root) {
  const imgs = root.tagName === 'IMG' ? [root] : Array.from(root.querySelectorAll('img'));
  if (!imgs.length) return Promise.resolve();
  const wait = Promise.all(imgs.map((img) => new Promise((resolve) => {
    const done = () => resolve();
    if (img.complete) {
      if (img.decode) img.decode().then(done, done);
      else done();
      return;
    }
    img.addEventListener('load', done, { once: true });
    img.addEventListener('error', done, { once: true });
    setTimeout(done, 1200);
  })));
  return Promise.race([wait, new Promise((resolve) => setTimeout(resolve, 1800))]);
}

async function wysMeasureBlocks(host, blocks, project, profile, metrics) {
  const heights = new Map();
  const probe = document.createElement('div');
  probe.className = `wys-doc page-body wys-profile-${profile}`;
  probe.style.cssText = 'position:absolute;left:-20000px;top:0;visibility:hidden;pointer-events:none;'
    + 'margin:0;padding:0;border:0;box-shadow:none;min-height:0;width:10px;column-count:auto;';
  host.appendChild(probe);
  try {
    for (const block of blocks) {
      if (block.parent != null) continue;
      const wide = wysIsWideBlock(block, metrics);
      const width = wide ? metrics.contentWidth : metrics.columnWidth;
      probe.style.width = `${Math.max(40, width)}px`;
      let el = null;
      try {
        el = wysRenderBlock(block, project);
      } catch (e) {
        console.warn('WYSIWYG measure failed', e);
        continue;
      }
      probe.appendChild(el);
      // Images carry the page's largest intrinsic height; measuring before they
      // decode would under-count figures and let a page overflow.
      if (el.querySelector('img') || el.tagName === 'IMG') await wysWaitForImages(el);
      const cs = getComputedStyle(el);
      const h = el.getBoundingClientRect().height
        + (parseFloat(cs.marginTop) || 0)
        + (parseFloat(cs.marginBottom) || 0);
      heights.set(block.index, Math.max(1, h));
      probe.removeChild(el);
    }
  } finally {
    probe.remove();
  }
  return heights;
}

// Group top-level blocks into paper pages. A full-width block costs twice its
// height in a two-column flow because it pushes both columns down.
function wysPaginateBlocks(blocks, heights, metrics) {
  const capacity = metrics.columns ? metrics.contentHeight * 2 : metrics.contentHeight;
  const pages = [];
  let current = { blocks: [], used: 0, hasColumn: false };
  const flush = () => {
    if (!current.blocks.length) return;
    pages.push(current);
    current = { blocks: [], used: 0, hasColumn: false };
  };
  for (const block of blocks) {
    if (block.parent != null) continue;
    const wide = wysIsWideBlock(block, metrics);
    const height = heights.get(block.index) || 0;
    const cost = wide && metrics.columns ? height * 2 : height;
    if (current.blocks.length) {
      if (wide && current.hasColumn) flush();
      else if (current.used + cost > capacity * 0.97) flush();
    }
    current.blocks.push(block);
    current.used += cost;
    if (!wide) current.hasColumn = true;
  }
  flush();
  if (!pages.length) pages.push({ blocks: [], used: 0, hasColumn: false });
  return pages;
}

// The sheet is laid out at the real page size (letter/A4 at 96 dpi) and then
// zoomed to fit the pane. Scaling the whole page — rather than shrinking the
// page width at a fixed font size — keeps line breaks, column widths and
// margins identical to the compiled PDF.
function wysFitSheet(doc) {
  const host = $('#wysiwyg');
  if (!host || !doc) return;
  const pageWidth = parseFloat(getComputedStyle(doc).getPropertyValue('--wys-page-width')) || 816;
  const avail = Math.max(240, host.clientWidth - 36);
  const zoom = Math.round(Math.min(1, avail / pageWidth) * 1000) / 1000;
  if (doc.dataset.zoom === String(zoom)) return;
  doc.dataset.zoom = String(zoom);
  doc.style.zoom = String(zoom);
}

async function wyswygRefresh(opts = {}) {
  const host = $('#wysiwyg');
  if (!host || !wys.active) return;
  const renderToken = ++wys.renderToken;
  const file = currentFile();
  if (!file || file.text == null) {
    host.innerHTML = '<div class="wys-notice">没有可编辑的文本文件。</div>';
    return;
  }
  if (!wysIsEditablePath(file.path)) {
    host.innerHTML = '<div class="wys-notice">这个文件类型不支持所见即所得编辑。请切换到源码模式。</div>';
    return;
  }
  let project = null;
  try {
    project = TeXPreview.build({
      files: textFilesForPreview(),
      mainPath: state.mainPath,
      assets: state.assetUrls
    });
  } catch (e) {
    console.warn('WYSIWYG model failed', e);
  }
  wys.path = file.path;
  wys.project = project;
  // The visual surface always shows the whole paper. When the project has a
  // main file, scan from it so \input/\include bodies appear in place; the
  // active file only decides where the view scrolls.
  const mainFile = state.mainPath ? state.files.get(state.mainPath) : null;
  const root = mainFile && mainFile.text != null && /\\begin\s*\{document\}/.test(mainFile.text)
    ? mainFile
    : file;
  wys.rootPath = root.path;
  const scan = wysScanDocument(root.text, root.path, project);
  wys.blocks = scan.blocks;
  wys.bodyStart = scan.bodyStart;
  wys.bodyEnd = scan.bodyEnd;
  wysAssignHeadingNumbers(wys.blocks, project);

  const profile = wysTemplateProfile(project);
  wys.profile = profile;
  host.dataset.profile = profile;

  // Measure while the previous page stays on screen: images decode
  // asynchronously, and clearing the host first would drop focus mid-edit.
  let groups = null;
  if (scan.blocks.length) {
    const metrics = wysPageMetrics(host, profile);
    const heights = await wysMeasureBlocks(host, wys.blocks, project, profile, metrics);
    if (renderToken !== wys.renderToken || !wys.active) return;
    groups = wysPaginateBlocks(wys.blocks, heights, metrics);
    if (window.__QELEMCHI_WYS_DEBUG) {
      window.__wysDebugLast = {
        metrics,
        heights: Array.from(heights.entries()),
        groups: groups.map((g) => g.blocks.map((b) => b.index)),
        blocks: wys.blocks.map((b) => ({ index: b.index, kind: b.kind, env: b.env, path: b.path, raw: String(b.raw || '').slice(0, 80) }))
      };
    }
  }

  host.innerHTML = '';
  if (scan.hasPreamble) {
    const lineCount = wysLineOf(root.text, scan.bodyStart) - 1;
    host.appendChild(wysPreambleChip(lineCount, project && project.meta, root.path));
  }
  const pagesEl = document.createElement('div');
  pagesEl.className = 'wys-pages';

  const renderBlocks = (flow, blocks) => {
    for (const block of blocks) {
      try {
        flow.appendChild(wysRenderBlock(block, project));
      } catch (e) {
        console.warn('WYSIWYG block failed', e);
        const blockFile = state.files.get(block.path || file.path) || file;
        const fallback = wysVisualBlock(block, 'wys-block-src', `<pre class="wys-source">${escapeHtml(blockFile.text.slice(block.start, block.end))}</pre>`, '源码');
        flow.appendChild(fallback);
      }
    }
  };

  const addPage = (blocks) => {
    const pageEl = document.createElement('div');
    pageEl.className = 'wys-page';
    pageEl.dataset.page = String(pagesEl.children.length + 1);
    const flow = document.createElement('div');
    flow.className = `wys-doc page-body wys-profile-${profile}`
      + (project && project.meta && project.meta.zh ? ' paper-zh' : '');
    flow.dataset.page = pageEl.dataset.page;
    renderBlocks(flow, blocks);
    pageEl.appendChild(flow);
    pagesEl.appendChild(pageEl);
    return flow;
  };

  if (!scan.blocks.length) {
    const flow = addPage([]);
    const empty = document.createElement('div');
    empty.className = 'wys-empty';
    empty.innerHTML = '<b>正文为空</b><span>在源码模式中写入第一段，或直接在这里开始输入。</span>';
    const start = document.createElement('div');
    start.className = 'wys-block wys-para';
    start.dataset.emptyAt = String(scan.bodyStart);
    start.dataset.path = root.path;
    const text = document.createElement('div');
    text.className = 'wys-text';
    text.contentEditable = 'true';
    text.innerHTML = '<br>';
    start.appendChild(text);
    empty.appendChild(start);
    flow.appendChild(empty);
  } else {
    for (const group of groups || []) addPage(group.blocks);
  }
  const doc = pagesEl;
  if (opts.emptyAt != null) {
    const holder = document.createElement('div');
    holder.className = 'wys-block wys-para wys-new';
    holder.dataset.emptyAt = String(opts.emptyAt);
    if (opts.emptyPath) holder.dataset.path = opts.emptyPath;
    const text = document.createElement('div');
    text.className = 'wys-text';
    text.contentEditable = 'true';
    text.innerHTML = '<br>';
    holder.appendChild(text);
    let anchor = null;
    const anchorPath = opts.emptyPath || root.path;
    for (const b of wys.blocks) {
      if (b.parent != null) continue;
      if ((b.path || root.path) !== anchorPath) continue;
      if (b.contentEnd <= opts.emptyAt) anchor = b;
    }
    const anchorEl = anchor ? doc.querySelector(`[data-block="${anchor.index}"]`) : null;
    if (anchorEl) anchorEl.after(holder);
    else {
      const flow = doc.querySelector('.wys-doc') || doc;
      flow.insertBefore(holder, flow.firstChild);
    }
  }
  if (opts.emptyItemAt != null) {
    const li = document.createElement('li');
    li.className = 'wys-block wys-item wys-new';
    li.dataset.emptyAt = String(opts.emptyItemAt);
    if (opts.emptyPath) li.dataset.path = opts.emptyPath;
    const text = document.createElement('div');
    text.className = 'wys-text';
    text.contentEditable = 'true';
    text.innerHTML = '<br>';
    li.appendChild(text);
    const listEl = opts.parentIndex != null
      ? doc.querySelector(`[data-block="${opts.parentIndex}"] .wys-list`)
      : null;
    (listEl || doc.querySelector('.wys-doc') || doc).appendChild(li);
  }
  host.appendChild(doc);
  wysFitSheet(doc);
  const newPara = (opts.emptyAt != null || opts.emptyItemAt != null) ? doc.querySelector('.wys-new .wys-text') : null;
  if (newPara) {
    newPara.focus();
    const range = document.createRange();
    range.selectNodeContents(newPara);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    newPara.scrollIntoView({ block: 'nearest' });
  }

  const token = ++wys.typesetToken;
  typesetBody(doc, project && project.mathMacros ? project.mathMacros : {}).then(() => {
    if (token !== wys.typesetToken) return;
  }).catch(() => {});

  if (opts.focusOffset != null) {
    wysFocusOffset(opts.focusOffset, opts.focusPath || file.path);
  } else if (opts.focusPathLine != null) {
    wysFocusLine(opts.focusPathLine);
  } else if (root.path !== file.path) {
    wysScrollToPath(file.path);
  }
}

function wysScrollToPath(path) {
  const host = $('#wysiwyg');
  if (!host || !path || path === wys.rootPath) return;
  const first = wys.blocks.find((b) => b.parent == null && (b.path || wys.rootPath) === path);
  if (!first) return;
  const el = host.querySelector(`[data-block="${first.index}"]`);
  if (el) el.scrollIntoView({ block: 'center' });
}

function wysFocusOffset(offset, path) {
  const host = $('#wysiwyg');
  if (!host) return;
  const scope = path || wys.path;
  let best = null;
  for (const block of wys.blocks) {
    if (!block.editable) continue;
    if ((block.path || wys.rootPath) !== scope) continue;
    if (block.contentStart <= offset && offset <= block.contentEnd) { best = block; break; }
    if (block.contentStart >= offset) { best = block; break; }
  }
  if (!best) {
    const editables = wys.blocks.filter((b) => b.editable && (b.path || wys.rootPath) === scope);
    best = editables[editables.length - 1];
  }
  if (!best) return;
  const el = host.querySelector(`[data-block="${best.index}"] .wys-text`);
  if (!el) return;
  el.focus();
  const sel = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
  el.scrollIntoView({ block: 'nearest' });
}

function wysFocusLine(line) {
  const file = currentFile();
  if (!file) return;
  let offset = 0;
  const lines = String(file.text || '').split('\n');
  for (let i = 0; i < Math.min(lines.length, Math.max(0, line - 1)); i++) offset += lines[i].length + 1;
  wysFocusOffset(offset, file.path);
}

function wyswygOpen(path, opts = {}) {
  wys.active = true;
  const host = $('#wysiwyg');
  if (host) host.hidden = false;
  const file = state.files.get(path);
  if (!file || file.text == null) {
    if (host) host.innerHTML = '<div class="wys-notice">这个文件不是文本文件，无法用所见即所得编辑。</div>';
    return;
  }
  wys.path = path;
  wyswygRefresh(opts);
}

function wyswygDeactivate() {
  wys.active = false;
  wys.renderToken++;
  wys.blocks = [];
  wys.focusRequest = null;
  const host = $('#wysiwyg');
  if (host) { host.hidden = true; host.innerHTML = ''; }
}

/* --------------------------------------------------------------------------
   Editing
   -------------------------------------------------------------------------- */

function wysEditableFromTarget(target) {
  const host = $('#wysiwyg');
  if (!host || !target || !host.contains(target)) return null;
  const textEl = target.closest('.wys-text');
  if (!textEl || textEl.getAttribute('contenteditable') !== 'true') return null;
  const wrap = textEl.closest('[data-block]');
  if (!wrap) return null;
  const index = Number(wrap.dataset.block);
  const block = wys.blocks[index];
  if (!block || !block.editable) return null;
  return { block, textEl, index, wrap };
}

function wysApplyBlockSource(index, newContent) {
  const block = wys.blocks[index];
  const blockPath = block ? (block.path || wys.path) : '';
  const file = blockPath ? state.files.get(blockPath) : currentFile();
  if (!block || !file || file.text == null || !block.editable) return;
  if (block.kind === 'para' || block.kind === 'item') newContent = newContent.trim();
  const oldRaw = file.text.slice(block.contentStart, block.contentEnd);
  if (oldRaw === newContent) return;
  const oldEnd = block.contentEnd;
  const delta = newContent.length - (oldEnd - block.contentStart);
  file.text = file.text.slice(0, block.contentStart) + newContent + file.text.slice(oldEnd);
  file.size = new Blob([file.text]).size;
  block.contentEnd = block.contentStart + newContent.length;
  block.raw = newContent;
  if (block.kind === 'para' || block.kind === 'keywords' || block.kind === 'item') block.end = block.contentEnd;
  if (block.kind === 'heading') block.end += delta;
  for (const other of wys.blocks) {
    if (other === block) continue;
    if ((other.path || wys.path) !== blockPath) continue;
    if (other.contentStart >= oldEnd) other.contentStart += delta;
    if (other.contentEnd > oldEnd) other.contentEnd += delta;
    if (other.start >= oldEnd) other.start += delta;
    if (other.end >= oldEnd) other.end += delta;
  }
  wysAfterSourceChange(file);
}

function wysAfterSourceChange(file) {
  if (!file) file = currentFile();
  if (!file) return;
  file.size = new Blob([file.text]).size;
  markDirty(file.path);
  updateEditorMeta();
  renderSaveState();
  refreshDirtyIndicators();
  updateWordCount();
  wys.internalEdit = true;
  schedulePreview();
  wys.internalEdit = false;
  if (state.mode === 'demo') persistDemoSoon();
  if (state.mode === 'github') maybeSaveDraftSoon();
}

function wysShiftBlockRanges(oldEnd, delta, path) {
  if (!delta) return;
  const scope = path || wys.path;
  for (const other of wys.blocks) {
    if ((other.path || wys.path) !== scope) continue;
    if (other.contentStart >= oldEnd) other.contentStart += delta;
    if (other.contentEnd > oldEnd) other.contentEnd += delta;
    if (other.start >= oldEnd) other.start += delta;
    if (other.end >= oldEnd) other.end += delta;
  }
}

function wysCommitBlock(index) {
  const wrap = $('#wysiwyg') && $('#wysiwyg').querySelector(`[data-block="${index}"]`);
  if (!wrap) return;
  const textEl = wrap.querySelector('.wys-text');
  if (!textEl) return;
  wysApplyBlockSource(index, wysSerializeBlockText(textEl));
}

function wysAfterDomEdit() {
  const active = document.activeElement;
  const found = wysEditableFromTarget(active && active.closest ? active.closest('.wys-text') : null);
  const target = found || wysEditableFromTarget(window.getSelection() && window.getSelection().anchorNode ? window.getSelection().anchorNode.parentElement : null);
  if (target) wysApplyBlockSource(target.index, wysSerializeBlockText(target.textEl));
}

function wysCurrentEditableRange() {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  const node = range.startContainer.nodeType === Node.TEXT_NODE ? range.startContainer.parentElement : range.startContainer;
  if (!node || !node.closest || !node.closest('.wys-text')) return null;
  return range;
}

function wysRangeForInsert() {
  return wysCurrentEditableRange() || (wys.savedRange ? wys.savedRange.cloneRange() : null);
}

function wysInsertTextAtSelection(text) {
  const sel = window.getSelection();
  if (!sel) return false;
  let range = wysRangeForInsert();
  if (!range) return false;
  range.deleteContents();
  const node = document.createTextNode(text);
  range.insertNode(node);
  range.setStartAfter(node);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
  return true;
}

function wysInsertAtomAtSelection(tex, html, cls) {
  const sel = window.getSelection();
  if (!sel) return false;
  const range = wysRangeForInsert();
  if (!range) return false;
  const startNode = range.startContainer;
  const editable = startNode.nodeType === Node.TEXT_NODE
    ? startNode.parentElement.closest('.wys-text')
    : (startNode.closest ? startNode.closest('.wys-text') : null);
  if (!editable || editable.getAttribute('contenteditable') !== 'true') return false;
  range.deleteContents();
  const span = document.createElement('span');
  span.className = `wys-atom${cls ? ' ' + cls : ''}`;
  span.setAttribute('contenteditable', 'false');
  span.dataset.tex = tex;
  span.innerHTML = html == null ? escapeHtml(tex) : html;
  range.insertNode(span);
  range.setStartAfter(span);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
  const found = wysEditableFromTarget(editable);
  if (found) wysApplyBlockSource(found.index, wysSerializeBlockText(editable));
  return true;
}

function wysSplitBlock(blockInfo, mode) {
  const { block, textEl } = blockInfo;
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  if (!textEl.contains(range.startContainer)) return;
  const beforeRange = document.createRange();
  beforeRange.selectNodeContents(textEl);
  beforeRange.setEnd(range.startContainer, range.startOffset);
  const afterRange = document.createRange();
  afterRange.selectNodeContents(textEl);
  afterRange.setStart(range.startContainer, range.startOffset);
  const beforeFrag = beforeRange.cloneContents();
  const afterFrag = afterRange.cloneContents();
  const holderA = document.createElement('div');
  holderA.appendChild(beforeFrag);
  const holderB = document.createElement('div');
  holderB.appendChild(afterFrag);
  const before = wysSerializeBlockText(holderA);
  const after = wysSerializeBlockText(holderB);
  const file = state.files.get(block.path || wys.path) || currentFile();
  if (!file) return;
  const path = file.path;

  if (mode === 'item') {
    if (!after) {
      const at = block.contentEnd;
      const insertion = '\n  \\item ';
      file.text = file.text.slice(0, at) + insertion + file.text.slice(at);
      wysShiftBlockRanges(at, insertion.length, path);
      wysAfterSourceChange(file);
      wyswygRefresh({ emptyItemAt: at + insertion.length, emptyPath: path, parentIndex: block.parent });
      return;
    }
    const insertion = `\n  \\item ${after}`;
    const content = `${before}${insertion}`;
    wysApplyBlockSource(block.index, content);
    const at = block.contentStart + content.length - after.length;
    wyswygRefresh({ focusOffset: at, focusPath: path });
    return;
  }

  if (block.kind === 'heading' || block.kind === 'keywords') return;
  if (!after) {
    const at = block.contentEnd;
    file.text = file.text.slice(0, at) + '\n\n' + file.text.slice(at);
    wysShiftBlockRanges(at, 2, path);
    wysAfterSourceChange(file);
    wyswygRefresh({ emptyAt: at + 2, emptyPath: path });
    return;
  }
  const content = `${before}\n\n${after}`;
  wysApplyBlockSource(block.index, content);
  const at = block.contentStart + before.length + 2;
  wyswygRefresh({ focusOffset: at, focusPath: path });
}

function wysFillEmptyParagraph(wrap, value) {
  const path = wrap.dataset.path || wys.path;
  const file = state.files.get(path) || currentFile();
  if (!file || !value) return;
  const at = Number(wrap.dataset.emptyAt);
  if (!Number.isFinite(at)) return;
  const rest = file.text.slice(at);
  const suffix = /^\s*(\n|$)/.test(rest) ? '' : '\n\n';
  file.text = file.text.slice(0, at) + value + suffix + rest;
  wysShiftBlockRanges(at, value.length + suffix.length, file.path);
  wysAfterSourceChange(file);
  wyswygRefresh({ focusOffset: at + value.length, focusPath: file.path });
}

function wysInsertSnippet(snippet) {
  let block = null;
  const found = wysEditableFromTarget(document.activeElement);
  if (found) block = found.block;
  if (!block) {
    const editables = wys.blocks.filter((b) => b.editable || b.kind === 'heading');
    block = editables[editables.length - 1] || wys.blocks[wys.blocks.length - 1];
  }
  const file = state.files.get((block && block.path) || wys.path) || currentFile();
  if (!file || file.text == null) return;
  const at = block ? block.end : wysBodyRange(file.text).end;
  const text = file.text;
  const glue = `\n\n${String(snippet).trim()}\n\n`;
  file.text = text.slice(0, at) + glue + text.slice(at);
  file.size = new Blob([file.text]).size;
  markDirty(file.path);
  updateEditorMeta();
  renderSaveState();
  refreshDirtyIndicators();
  updateWordCount();
  wys.internalEdit = true;
  schedulePreview();
  wys.internalEdit = false;
  wyswygRefresh({ focusOffset: at + 2, focusPath: file.path });
  if (state.mode === 'demo') persistDemoSoon();
  if (state.mode === 'github') maybeSaveDraftSoon();
}

function wysOpenSourceAt(index) {
  const block = wys.blocks[index];
  if (!block) return;
  const file = state.files.get(block.path || wys.path) || currentFile();
  const line = file ? wysLineOf(file.text, block.start) : 1;
  setEditorMode('source');
  if (file) focusEditorLine(file.path, line);
}

function wysPrompt(title, label, value, onOk, options = {}) {
  const live = wysCurrentEditableRange();
  wys.savedRange = live ? live.cloneRange() : null;
  const modal = openModal({
    title,
    eyebrow: '所见即所得',
    subtitle: options.subtitle || '',
    body: `<div class="field"><label class="field-label" for="wys-prompt-input">${escapeHtml(label)}</label>` +
      `<input class="input" id="wys-prompt-input" type="text" value="${escapeAttr(value || '')}" autocomplete="off" spellcheck="false"></div>` +
      (options.hint ? `<div class="field-hint">${escapeHtml(options.hint)}</div>` : ''),
    actions: [
      { label: '取消', kind: 'ghost' },
      {
        label: options.okLabel || '插入',
        kind: 'primary',
        onClick: (api) => {
          const input = api.body.querySelector('#wys-prompt-input');
          const result = input ? input.value.trim() : '';
          api.close();
          if (result) onOk(result);
        }
      }
    ]
  });
  if (!modal) return;
  const input = modal.body.querySelector('#wys-prompt-input');
  if (input) {
    setTimeout(() => { input.focus(); input.select(); }, 40);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const primary = modal.modal.querySelector('.btn-primary');
        if (primary) primary.click();
      }
    });
  }
}

function wysApplyFormat(kind) {
  const host = $('#wysiwyg');
  const focus = document.activeElement;
  const inside = host && (host.contains(focus) || (window.getSelection() && window.getSelection().anchorNode && host.contains(window.getSelection().anchorNode)));
  if (!inside && kind !== 'section' && kind !== 'equation' && kind !== 'figure' && kind !== 'table' && kind !== 'list') {
    toast({ type: 'info', title: '先在段落中放置光标', desc: '把光标放进一个可编辑段落，再使用这个格式按钮。' });
    return;
  }
  switch (kind) {
    case 'bold':
      document.execCommand('styleWithCSS', false, false);
      document.execCommand('bold');
      wysAfterDomEdit();
      break;
    case 'italic':
      document.execCommand('styleWithCSS', false, false);
      document.execCommand('italic');
      wysAfterDomEdit();
      break;
    case 'emph':
      wysWrapSelection('emph');
      break;
    case 'code':
      wysWrapSelection('code');
      break;
    case 'link':
      wysPrompt('插入链接', '网址', 'https://', (url) => {
        const label = url.replace(/^https?:\/\//, '').replace(/\/$/, '') || '链接';
        if (!wysInsertAtomAtSelection(`\\href{${url}}{${label}}`, `<span class="wys-link-token">${escapeHtml(label)}</span>`, 'wys-link')) {
          toast({ type: 'info', title: '请先把光标放进段落' });
        }
      });
      break;
    case 'math':
      wysPrompt('插入行内公式', 'LaTeX 公式', 'x \\in \\mathbb{R}', (tex) => {
        if (!wysInsertAtomAtSelection(`$${tex}$`, escapeHtml(`\\(${tex}\\)`), 'tex-math wys-math-atom')) {
          toast({ type: 'info', title: '请先把光标放进段落' });
        } else if (wys.project) {
          typesetBody(host, wys.project.mathMacros || {}).catch(() => {});
        }
      }, { hint: '公式在编辑时显示为排版结果；要修改请切换到源码模式。' });
      break;
    case 'cite':
      wysPrompt('插入文献引用', 'BibTeX 键（多个用逗号分隔）', '', (keys) => {
        if (!wysInsertAtomAtSelection(`\\cite{${keys}}`, `<span class="wys-cite">[${escapeHtml(keys)}]</span>`, 'wys-cite-atom')) {
          toast({ type: 'info', title: '请先把光标放进段落' });
        }
      });
      break;
    case 'ref':
      wysPrompt('插入交叉引用', '标签名', 'sec:intro', (key) => {
        const display = wysRefDisplay(wys.project, 'ref', key);
        if (!wysInsertAtomAtSelection(`\\ref{${key}}`, display, 'wys-ref-atom')) {
          toast({ type: 'info', title: '请先把光标放进段落' });
        }
      });
      break;
    case 'section':
      wysInsertSnippet('\\section{新章节}\n\\label{sec:new-section}\n\n在这里开始写作。');
      break;
    case 'equation':
      wysInsertSnippet('\\begin{equation}\n  \\label{eq:new-equation}\n  E = mc^2\n\\end{equation}');
      break;
    case 'figure':
      wysInsertSnippet('\\begin{figure}[htbp]\n  \\centering\n  \\includegraphics[width=0.8\\linewidth]{figures/example.png}\n  \\caption{图注}\n  \\label{fig:new-figure}\n\\end{figure}');
      break;
    case 'table':
      wysInsertSnippet('\\begin{table}[htbp]\n  \\centering\n  \\caption{表注}\n  \\label{tab:new-table}\n  \\begin{tabular}{lcc}\n    \\toprule\n    列 A & 列 B & 列 C \\\\\n    \\midrule\n    1 & 2 & 3 \\\\\n    \\bottomrule\n  \\end{tabular}\n\\end{table}');
      break;
    case 'list':
      wysInsertSnippet('\\begin{itemize}\n  \\item 第一项\n  \\item 第二项\n\\end{itemize}');
      break;
    case 'comment':
      wysInsertSnippet('% 注释');
      break;
    default:
      break;
  }
}

function wysWrapSelection(kind) {
  const sel = window.getSelection();
  if (!sel) return;
  const range = wysRangeForInsert();
  if (!range || range.collapsed) return;
  const tag = kind === 'emph' ? 'em' : 'code';
  const wrapper = document.createElement(tag);
  if (kind === 'emph') wrapper.dataset.wysMark = 'emph';
  try {
    range.surroundContents(wrapper);
  } catch (e) {
    wrapper.appendChild(range.extractContents());
    range.insertNode(wrapper);
  }
  sel.removeAllRanges();
  const after = document.createRange();
  after.setStartAfter(wrapper);
  after.collapse(true);
  sel.addRange(after);
  wysAfterDomEdit();
}

/* --------------------------------------------------------------------------
   Events
   -------------------------------------------------------------------------- */

function wysHandleKeydown(e) {
  if (!wys.active) return;
  const emptyWrap = e.target.closest && e.target.closest('[data-empty-at]');
  if (emptyWrap) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const path = emptyWrap.dataset.path || wys.path;
      const file = state.files.get(path) || currentFile();
      if (!file) return;
      const at = Number(emptyWrap.dataset.emptyAt);
      const insertion = e.target.closest('.wys-item') ? '\n  \\item ' : '\n\n';
      file.text = file.text.slice(0, at) + insertion + file.text.slice(at);
      wysShiftBlockRanges(at, insertion.length, file.path);
      wysAfterSourceChange(file);
      if (e.target.closest('.wys-item')) {
        const parentIndex = Number(emptyWrap.closest('[data-block]') ? emptyWrap.closest('[data-block]').dataset.block : NaN);
        wyswygRefresh({ emptyItemAt: at + insertion.length, emptyPath: file.path, parentIndex: Number.isFinite(parentIndex) ? parentIndex : null });
      } else {
        wyswygRefresh({ emptyAt: at + insertion.length, emptyPath: file.path });
      }
    }
    return;
  }
  const found = wysEditableFromTarget(e.target);
  if (!found) return;
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    wysSplitBlock(found, found.block.kind === 'item' ? 'item' : 'para');
    return;
  }
  if (e.key === 'Enter' && e.shiftKey) {
    // Shift+Enter inserts an explicit LaTeX line break.
    e.preventDefault();
    if (wysInsertTextAtSelection('\n')) {
      const sel = window.getSelection();
      const text = sel && sel.anchorNode && sel.anchorNode.parentElement ? sel.anchorNode.parentElement.closest('.wys-text') : null;
      if (text) {
        const r = sel.getRangeAt(0);
        const br = document.createElement('br');
        r.insertNode(br);
        r.setStartAfter(br);
        r.collapse(true);
        sel.removeAllRanges();
        sel.addRange(r);
        wysApplyBlockSource(found.index, wysSerializeBlockText(text));
      }
    }
    return;
  }
  if (e.key === 'Backspace') {
    const sel = window.getSelection();
    if (sel && sel.rangeCount && sel.isCollapsed && found.block.kind === 'para') {
      const range = sel.getRangeAt(0);
      const pre = document.createRange();
      pre.selectNodeContents(found.textEl);
      pre.setEnd(range.startContainer, range.startOffset);
      if (!pre.toString().replace(/\u200B/g, '').length && !found.textEl.textContent.trim()) {
        e.preventDefault();
        wysDeleteEmptyBlock(found);
      }
    }
  }
}

function wysDeleteEmptyBlock(found) {
  if (!found.block) return;
  const block = found.block;
  const file = state.files.get(block.path || wys.path) || currentFile();
  if (!file) return;
  const text = file.text;
  let start = block.contentStart;
  let end = block.contentEnd;
  // Also remove the blank separator immediately following.
  let after = end;
  while (after < text.length && (text[after] === ' ' || text[after] === '\t')) after++;
  if (text[after] === '\n') {
    after++;
    while (after < text.length && (text[after] === ' ' || text[after] === '\t' || text[after] === '\r')) after++;
    if (text[after] === '\n') after++;
  }
  file.text = text.slice(0, start) + text.slice(after);
  file.size = new Blob([file.text]).size;
  markDirty(file.path);
  updateEditorMeta();
  renderSaveState();
  refreshDirtyIndicators();
  updateWordCount();
  wys.internalEdit = true;
  schedulePreview();
  wys.internalEdit = false;
  wyswygRefresh({ focusOffset: Math.max(0, start - 1), focusPath: file.path });
}

function wysWysiwygNotifySourceChanged() {
  if (!wys.active) return;
  if (wys.internalEdit) return;
  const host = $('#wysiwyg');
  if (host && document.activeElement && host.contains(document.activeElement)) return;
  if (wys.refreshTimer) clearTimeout(wys.refreshTimer);
  wys.refreshTimer = setTimeout(() => {
    wys.refreshTimer = null;
    if (!wys.active) return;
    const file = currentFile();
    if (!file || file.path !== wys.path) return;
    wyswygRefresh();
  }, 260);
}

function wysWireHost() {
  const host = $('#wysiwyg');
  if (!host || host.dataset.wired === '1') return;
  host.dataset.wired = '1';

  if (window.ResizeObserver) {
    let frame = 0;
    const observer = new ResizeObserver(() => {
      if (!wys.active) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const doc = host.querySelector('.wys-pages') || host.querySelector('.wys-doc');
        if (doc) wysFitSheet(doc);
      });
    });
    observer.observe(host);
    wys.hostObserver = observer;
  }

  host.addEventListener('input', (e) => {
    if (wys.internalEdit) return;
    const emptyWrap = e.target.closest && e.target.closest('[data-empty-at]');
    if (emptyWrap) {
      const textEl = emptyWrap.querySelector('.wys-text');
      if (textEl) wysFillEmptyParagraph(emptyWrap, wysSerializeBlockText(textEl));
      return;
    }
    const found = wysEditableFromTarget(e.target);
    if (!found) return;
    wysApplyBlockSource(found.index, wysSerializeBlockText(found.textEl));
  });

  host.addEventListener('keydown', wysHandleKeydown);

  host.addEventListener('focusin', (e) => {
    host.querySelectorAll('.wys-block.is-focused').forEach((n) => n.classList.remove('is-focused'));
    const found = wysEditableFromTarget(e.target);
    if (found && found.wrap) found.wrap.classList.add('is-focused');
  });

  host.addEventListener('click', (e) => {
    const src = e.target.closest('[data-wys-source]');
    if (src) {
      e.preventDefault();
      wysOpenSourceAt(Number(src.dataset.wysSource));
      return;
    }
    const open = e.target.closest('.wys-open-file');
    if (open) {
      e.preventDefault();
      openFile(open.dataset.path);
      return;
    }
    const link = e.target.closest('a');
    if (link) e.preventDefault();
  });

  host.addEventListener('mousedown', (e) => {
    const atom = e.target.closest('.wys-atom');
    if (atom) {
      // Clicking a chip should not put the caret inside it.
      e.preventDefault();
      return;
    }
    if (e.target.closest('.wys-tool, .wys-open-file, .wys-preamble-btn')) return;
  });

  host.addEventListener('paste', (e) => {
    const found = wysEditableFromTarget(e.target);
    if (!found) return;
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text/plain').replace(/\r\n?/g, '\n');
    if (!text) return;
    if (/\n\s*\n/.test(text)) {
      const blocks = text.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
      if (!blocks.length) return;
      const sel = window.getSelection();
      const range = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
      if (!range) return;
      const beforeRange = document.createRange();
      beforeRange.selectNodeContents(found.textEl);
      beforeRange.setEnd(range.startContainer, range.startOffset);
      const afterRange = document.createRange();
      afterRange.selectNodeContents(found.textEl);
      afterRange.setStart(range.startContainer, range.startOffset);
      const holderA = document.createElement('div');
      holderA.appendChild(beforeRange.cloneContents());
      const holderB = document.createElement('div');
      holderB.appendChild(afterRange.cloneContents());
      const before = wysSerializeBlockText(holderA);
      const after = wysSerializeBlockText(holderB);
      const content = [before, ...blocks.map((b) => wysEscapeText(b)), after].filter(Boolean).join('\n\n');
      wysApplyBlockSource(found.index, content);
      wyswygRefresh({
        focusOffset: found.block.contentStart + content.length - after.length,
        focusPath: found.block.path || wys.path
      });
      return;
    }
    const flat = text.replace(/\n/g, ' ');
    if (!wysInsertTextAtSelection(flat)) return;
    wysAfterDomEdit();
  });
}

/* --------------------------------------------------------------------------
   Public integration points used by the rest of the app
   -------------------------------------------------------------------------- */

function wysiwygNotifySourceChanged() {
  wysWysiwygNotifySourceChanged();
}

function wysiwygStart(path, opts = {}) {
  wysWireHost();
  wyswygOpen(path, opts);
}

function wysiwygStop() {
  wyswygDeactivate();
}

function wysiwygFocusLine(line) {
  if (!wys.active) return;
  wysFocusLine(line);
}

function wysiwygCurrentPath() {
  return wys.active ? wys.path : '';
}
