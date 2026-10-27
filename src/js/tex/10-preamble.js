/* ==========================================================================
   Qelemchi · LaTeX preview engine (part 2: project front matter)
   ========================================================================== */

  const DEFAULT_COLORS = {
    black: '#1c1b18', white: '#ffffff', red: '#b3261e', green: '#3f6b45',
    blue: '#315d86', cyan: '#2b7a7a', magenta: '#8e3b73', yellow: '#b18a1f',
    orange: '#b46528', violet: '#6b4f9a', purple: '#6b4f9a', brown: '#7a5136',
    gray: '#777777', grey: '#777777', lightgray: '#d3d3d3', darkgray: '#4f4f4f',
    olive: '#6f6b2f', teal: '#2f6f68', pink: '#c06a86', maroon: '#7b2d2d',
    navy: '#263b5e', lime: '#6d8f2f', aquamarine: '#4f9b8c'
  };

  const ZH_THEOREM_NAMES = {
    theorem: '定理', lemma: '引理', proposition: '命题', corollary: '推论',
    definition: '定义', remark: '注记', example: '例', assumption: '假设',
    conjecture: '猜想', claim: '断言', observation: '观察', algorithm: '算法',
    proof: '证明', exercise: '练习', problem: '问题', notation: '记号'
  };

  function getText(ctx, path) {
    return ctx.textByPath.get(path);
  }

  function mergeFilePaths(ctx, extraPaths) {
    for (const p of extraPaths) {
      const n = normalizePath(p);
      if (!n) continue;
      ctx.files.paths.add(n);
      if (!ctx.files.byLower.has(n.toLowerCase())) ctx.files.byLower.set(n.toLowerCase(), n);
    }
  }

  function createRenderContext(opts) {
    const rawFiles = (opts.files || []).map((f) => ({
      path: normalizePath(f.path),
      text: String(f.text == null ? '' : f.text)
    })).filter((f) => f.path);
    const textByPath = new Map(rawFiles.map((f) => [f.path, f.text]));
    let mainPath = normalizePath(opts.mainPath || '');
    if (!mainPath || !textByPath.has(mainPath)) {
      mainPath = rawFiles.find((f) => /\\documentclass\b/.test(f.text))?.path
        || rawFiles.find((f) => f.path.endsWith('.tex'))?.path
        || rawFiles[0]?.path || '';
    }
    const ctx = {
      mainPath,
      rootDir: dirname(mainPath),
      textByPath,
      files: collectFiles(rawFiles),
      assets: new Map(),
      warnings: makeWarningBag(),
      macros: new Map(),
      mathMacros: {},
      mathOperators: new Map(),
      newtheorems: new Map(),
      colors: new Map(Object.entries(DEFAULT_COLORS)),
      graphicsPaths: [],
      pageSize: 'a4',
      zh: false,
      docClass: 'article',
      docOptions: [],
      titleRaw: '',
      authorRaw: '',
      dateRaw: null,
      hasDateCommand: false,
      bib: new Map(),
      bibFiles: [],
      citeOrder: [],
      citeMap: new Map(),
      manualBib: [],
      manualBibMap: new Map(),
      labels: new Map(),
      headings: [],
      footnotes: [],
      footnoteCounter: 0,
      noteSink: null,
      inFootnote: false,
      counters: {
        section: [0, 0, 0, 0],
        equation: 0,
        figure: 0,
        table: 0,
        theorem: new Map(),
        algorithm: 0,
        listing: 0
      },
      chapterMode: false,
      appendix: false,
      currentSectionNumber: '',
      currentSectionId: '',
      currentSectionKind: 'sec',
      headingSeq: 0,
      blockSeq: 0,
      titleRendered: false,
      bibRendered: false,
      tocToken: '',
      unknown: new Map(),
      unknownCount: 0,
      lists: 0,
      tocItems: [],
      stats: { equations: 0, figures: 0, tables: 0, citations: 0, refs: 0 },
      engine: 'pdflatex',
      packages: new Set(),
      includeChain: [],
      sourceTitle: '',
      rendererVersion: '1.0'
    };
    const assetEntries = opts.assets instanceof Map ? Array.from(opts.assets.entries()) : Object.entries(opts.assets || {});
    for (const [p, url] of assetEntries) {
      const n = normalizePath(p);
      ctx.assets.set(n, url);
    }
    mergeFilePaths(ctx, Array.from(ctx.assets.keys()));
    return ctx;
  }

  function splitTopLevel(src, commandName) {
    const out = [];
    const re = new RegExp('\\\\' + commandName + '\\b', 'g');
    let depth = 0;
    let start = 0;
    let i = 0;
    while (i < src.length) {
      const c = src[i];
      if (c === '\\') {
        if (depth === 0) {
          re.lastIndex = i;
          const m = re.exec(src);
          if (m && m.index === i) {
            out.push(src.slice(start, i));
            i += m[0].length;
            start = i;
            continue;
          }
        }
        i += 2;
        continue;
      }
      if (c === '{') depth++;
      else if (c === '}') depth = Math.max(0, depth - 1);
      i++;
    }
    out.push(src.slice(start));
    return out;
  }

  function extractCommandArg(src, name, from = 0) {
    const re = new RegExp('\\\\' + name + '(?![A-Za-z@])', 'g');
    re.lastIndex = from;
    const m = re.exec(src);
    if (!m) return null;
    let i = m.index + m[0].length;
    const opt = readOptional(src, i);
    if (opt) i = opt.end;
    const g = readGroup(src, i);
    if (!g) return null;
    return { text: g.text, start: m.index, end: g.end, optional: opt ? opt.text : null };
  }

  function extractCommandOptionalArg(src, name, from = 0) {
    const re = new RegExp('\\\\' + name + '(?![A-Za-z@])', 'g');
    re.lastIndex = from;
    const m = re.exec(src);
    if (!m) return null;
    const g = readOptional(src, m.index + m[0].length);
    return g ? { text: g.text, start: m.index, end: g.end } : null;
  }

  function parseDocumentClass(ctx, preamble) {
    const dc = extractCommandArg(preamble, 'documentclass');
    if (!dc) return;
    ctx.docOptions = (dc.optional || '').split(',').map((s) => s.trim()).filter(Boolean);
    ctx.docClass = dc.text.trim().toLowerCase();
    ctx.chapterMode = /^(book|report|memoir|scrbook|scrreprt)$/.test(ctx.docClass);
    if (ctx.docOptions.includes('letterpaper')) ctx.pageSize = 'letter';
    if (ctx.docOptions.includes('a4paper')) ctx.pageSize = 'a4';
    const opts = ctx.docOptions.join(',');
    if (/11pt|12pt/.test(opts)) ctx.baseFont = opts.match(/1[12]pt/)[0];
  }

  function parseGeometry(ctx, preamble) {
    const geo = extractCommandArg(preamble, 'geometry');
    if (!geo) return;
    const o = geo.text;
    if (/letterpaper/i.test(o)) ctx.pageSize = 'letter';
    if (/a4paper/i.test(o)) ctx.pageSize = 'a4';
  }

  function parseUsePackages(ctx, preamble) {
    const re = /\\usepackage\s*(?:\[([^\]]*)\])?\s*\{([^}]*)\}/g;
    let m;
    while ((m = re.exec(preamble))) {
      for (const p of m[2].split(',')) {
        const name = p.trim().toLowerCase();
        if (name) ctx.packages.add(name);
      }
    }
    const cls = ctx.docClass;
    if (/^ctex/.test(cls) || ctx.packages.has('ctex') || ctx.packages.has('xecjk') || ctx.packages.has('xecyk')) {
      ctx.zh = true;
      ctx.engine = 'xelatex';
    }
    if (ctx.packages.has('fontspec') || ctx.packages.has('unicode-math') || ctx.packages.has('luatextra')) ctx.engine = 'xelatex';
    if (ctx.packages.has('luacode')) ctx.engine = 'lualatex';
  }

  function parseMacroDefinitions(ctx, preamble) {
    const commandRe = /\\(newcommand|renewcommand|providecommand|DeclareRobustCommand)\b\*?/g;
    let m;
    while ((m = commandRe.exec(preamble))) {
      let i = m.index + m[0].length;
      i = skipSpace(preamble, i);
      let name = '';
      if (preamble[i] === '{') {
        const g = readGroup(preamble, i);
        if (!g) continue;
        name = g.text.trim();
        i = g.end;
      } else if (preamble[i] === '\\') {
        const c = readCommandName(preamble, i);
        if (!c) continue;
        name = c.name;
        i = c.end;
      } else continue;
      name = name.replace(/^\\/, '').trim();
      if (!name) continue;
      let nargs = 0;
      let def = null;
      const optN = readOptional(preamble, i);
      if (optN) {
        nargs = Math.max(0, Math.min(9, parseInt(optN.text.trim(), 10) || 0));
        i = optN.end;
        if (nargs > 0) {
          const optD = readOptional(preamble, i);
          if (optD) { def = optD.text; i = optD.end; }
        }
      }
      const body = readGroup(preamble, i);
      if (!body) continue;
      ctx.macros.set(name, { name, nargs, default: def, body: body.text });
    }

    const opRe = /\\DeclareMathOperator\*?\s*\{([^}]*)\}\s*\{/g;
    while ((m = opRe.exec(preamble))) {
      const name = m[1].trim().replace(/^\\/, '');
      const g = readGroup(preamble, m.index + m[0].length - 1);
      if (!g || !name) continue;
      ctx.mathOperators.set(name, g.text);
      ctx.macros.set(name, { name, nargs: 0, default: null, body: `\\operatorname{${g.text}}` });
    }
  }

  function buildMathMacros(ctx) {
    const macros = {
      '\\R': '\\mathbb{R}',
      '\\N': '\\mathbb{N}',
      '\\Z': '\\mathbb{Z}',
      '\\Q': '\\mathbb{Q}',
      '\\C': '\\mathbb{C}',
      '\\E': '\\mathbb{E}',
      '\\Var': '\\operatorname{Var}',
      '\\Cov': '\\operatorname{Cov}',
      '\\argmax': '\\operatorname*{arg\\,max}',
      '\\argmin': '\\operatorname*{arg\\,min}',
      '\\coloneqq': '\\coloneq',
      '\\eqdef': '\\overset{\\text{def}}{=}',
      '\\abs': '\\left|#1\\right|',
      '\\norm': '\\left\\lVert#1\\right\\rVert',
      '\\bm': '\\boldsymbol'
    };
    // mathjax macros with arguments are arrays; default macros above that use #1 need arg counts
    macros['\\abs'] = ['\\left|#1\\right|', 1];
    macros['\\norm'] = ['\\left\\lVert#1\\right\\rVert', 1];
    for (const [name, def] of ctx.macros) {
      const key = '\\' + name;
      if (def.nargs > 0) {
        const arr = [def.body, def.nargs];
        if (def.default != null) arr.push(def.default);
        macros[key] = arr;
      } else {
        macros[key] = def.body;
      }
    }
    ctx.mathMacros = macros;
  }

  function parseTheoremDefinitions(ctx, preamble) {
    const re = /\\newtheorem\*?\s*\{([^}]+)\}\s*(?:\[([^\]]+)\])?\s*\{([^}]+)\}\s*(?:\[([^\]]+)\])?/g;
    let m;
    while ((m = re.exec(preamble))) {
      const env = m[1].trim();
      const shared = (m[2] || '').trim();
      const title = m[3].trim();
      const within = (m[4] || '').trim();
      if (!env) continue;
      ctx.newtheorems.set(env, {
        env,
        title: plainText(title) || title,
        titleRaw: title,
        shared,
        within
      });
    }
  }

  function parseColorDefinitions(ctx, preamble) {
    const re = /\\definecolor\s*\{([^}]+)\}\s*\{([^}]+)\}\s*\{([^}]+)\}/g;
    let m;
    while ((m = re.exec(preamble))) {
      const name = m[1].trim();
      const model = m[2].trim().toLowerCase();
      const spec = m[3].trim();
      let css = null;
      if (model === 'html' || model === 'HTML') {
        css = spec.startsWith('#') ? spec : '#' + spec;
      } else if (model === 'rgb') {
        const v = spec.split(',').map((x) => Number(x.trim()));
        if (v.length === 3) css = `rgb(${v.map((x) => Math.round(Math.max(0, Math.min(1, x)) * 255)).join(',')})`;
      } else if (model === 'rgb255') {
        const v = spec.split(',').map((x) => Number(x.trim()));
        if (v.length === 3) css = `rgb(${v.map((x) => Math.round(Math.max(0, Math.min(255, x)))).join(',')})`;
      } else if (model === 'gray') {
        const x = Math.round(Math.max(0, Math.min(1, Number(spec))) * 255);
        css = `rgb(${x},${x},${x})`;
      } else if (model === 'cmyk') {
        const v = spec.split(',').map((x) => Number(x.trim()));
        if (v.length === 4) {
          const [c, m2, y, k] = v.map((x) => Math.max(0, Math.min(1, x)));
          css = `rgb(${Math.round(255 * (1 - c) * (1 - k))},${Math.round(255 * (1 - m2) * (1 - k))},${Math.round(255 * (1 - y) * (1 - k))})`;
        }
      }
      if (css) ctx.colors.set(name, css);
    }
  }

  function parseGraphicsPaths(ctx, preamble) {
    const gp = extractCommandArg(preamble, 'graphicspath');
    if (!gp) return;
    const re = /\{([^{}]*)\}/g;
    let m;
    while ((m = re.exec(gp.text))) {
      const p = m[1].trim();
      if (p) ctx.graphicsPaths.push(normalizePath(p));
    }
  }

  function parsePreamble(ctx, source) {
    let begin = source.indexOf('\\begin{document}');
    let preamble = '';
    let body = source;
    if (begin >= 0) {
      preamble = source.slice(0, begin);
      const endRe = /\\end\{document\}/g;
      endRe.lastIndex = begin;
      const endM = endRe.exec(source);
      body = source.slice(begin + '\\begin{document}'.length, endM ? endM.index : source.length);
    } else {
      ctx.warnings.add('没有找到 \\begin{document}，已把整个文件当作正文排版。');
    }

    parseDocumentClass(ctx, preamble);
    parseGeometry(ctx, preamble);
    parseUsePackages(ctx, preamble);
    parseMacroDefinitions(ctx, preamble);
    parseTheoremDefinitions(ctx, preamble);
    parseColorDefinitions(ctx, preamble);
    parseGraphicsPaths(ctx, preamble);

    const title = extractCommandArg(preamble, 'title');
    if (title) ctx.titleRaw = title.text;
    const author = extractCommandArg(preamble, 'author');
    if (author) ctx.authorRaw = author.text;
    const date = extractCommandArg(preamble, 'date');
    if (date) { ctx.dateRaw = date.text; ctx.hasDateCommand = true; }

    // A CJK body makes the preview switch to a Chinese book face even when the
    // class is a plain article class.
    if (!ctx.zh && CJK_RE.test(body)) ctx.zh = true;
    if (ctx.zh && ctx.packages.has('fontspec')) ctx.engine = 'xelatex';

    // Collect declared bibliography resources from both preamble and body.
    const all = preamble + '\n' + body;
    const bibRe = /\\(?:bibliography|addbibresource)\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/g;
    let bm;
    while ((bm = bibRe.exec(all))) {
      for (const part of bm[1].split(',')) {
        const ref = part.trim();
        if (!ref) continue;
        const resolved = resolveFile(ref, ctx.mainPath, ctx, ['', '.bib']);
        if (resolved && !ctx.bibFiles.includes(resolved)) ctx.bibFiles.push(resolved);
        else if (!resolved) ctx.warnings.add(`找不到参考文献文件：${ref}.bib`);
      }
    }
    for (const path of ctx.bibFiles) {
      const text = getText(ctx, path);
      if (!text) continue;
      const entries = parseBib(text, ctx.warnings);
      for (const [key, entry] of entries) {
        if (!ctx.bib.has(key)) ctx.bib.set(key, entry);
      }
    }

    buildMathMacros(ctx);
    ctx.sourceTitle = ctx.titleRaw ? plainText(ctx.titleRaw) : '';
    return { preamble, body };
  }

  function expandIncludes(ctx, path, stack = [], depth = 0) {
    if (depth > 14) {
      ctx.warnings.add('\\input 嵌套层级过深，已停止展开。');
      return '';
    }
    if (stack.includes(path)) {
      ctx.warnings.add(`检测到循环 \\input：${path}`);
      return '';
    }
    let text = getText(ctx, path);
    if (text == null) {
      ctx.warnings.add(`找不到源文件：${path}`);
      return '';
    }
    const stash = [];
    text = protectVerbatim(text, stash);
    text = text.replace(/\\(input|include|subfile)\s*\{([^}]*)\}/g, (m, kind, ref) => {
      const resolved = resolveFile(ref, path, ctx, ['', '.tex']);
      if (!resolved) {
        ctx.warnings.add(`找不到 \\${kind} 的文件：${ref}`);
        return `\n% missing ${kind}: ${ref}\n`;
      }
      const inner = expandIncludes(ctx, resolved, stack.concat(path), depth + 1);
      return kind === 'include' ? `\n\\newpage\n${inner}\n` : `\n${inner}\n`;
    });
    return restoreVerbatim(text, stash);
  }

  function expandUserMacros(src, ctx) {
    if (!ctx.macros.size) return src;
    const stash = [];
    let text = protectVerbatim(src, stash);
    const names = Array.from(ctx.macros.keys()).sort((a, b) => b.length - a.length);
    if (!names.length) return src;
    const nameSet = new Set(names);
    let out = '';
    let i = 0;
    let guard = 0;
    const expandOne = (s, depth) => {
      if (depth > 12 || guard++ > 50000) {
        if (guard === 50001) ctx.warnings.add('宏展开次数过多，已停止。');
        return s;
      }
      let result = '';
      let p = 0;
      while (p < s.length) {
        if (s[p] !== '\\') { result += s[p++]; continue; }
        const cmd = readCommandName(s, p);
        if (!cmd) { result += s[p++]; continue; }
        const def = ctx.macros.get(cmd.name);
        if (!def) { result += s.slice(p, cmd.end); p = cmd.end; continue; }
        let q = cmd.end;
        let args = [];
        if (def.nargs > 0) {
          const opt = readOptional(s, q);
          if (opt && def.default != null) {
            args.push(opt.text);
            q = opt.end;
          } else {
            args.push(def.default != null ? def.default : '');
          }
          for (let k = args.length; k < def.nargs; k++) {
            const g = readGroup(s, q);
            if (!g) break;
            args.push(g.text);
            q = g.end;
          }
          if (args.length < def.nargs) {
            result += s.slice(p, cmd.end);
            p = cmd.end;
            continue;
          }
        }
        let body = def.body;
        for (let a = 0; a < args.length; a++) {
          body = body.split('#' + (a + 1)).join(args[a]);
        }
        result += expandOne(body, depth + 1);
        p = q;
      }
      return result;
    };
    out = expandOne(text, 0);
    return restoreVerbatim(out, stash);
  }

  function scanManualBib(ctx, body) {
    const re = /\\bibitem\s*(?:\[([^\]]*)\])?\s*\{([^}]+)\}/g;
    let m;
    const starts = [];
    while ((m = re.exec(body))) {
      starts.push({ key: m[2].trim(), index: m.index, end: re.lastIndex, label: m[1] || '' });
    }
    for (let i = 0; i < starts.length; i++) {
      const item = starts[i];
      const content = body.slice(item.end, i + 1 < starts.length ? starts[i + 1].index : body.length)
        .replace(/\\end\{thebibliography\}[\s\S]*$/, '')
        .trim();
      ctx.manualBib.push({ key: item.key, content, label: item.label });
      if (!ctx.manualBibMap.has(item.key)) ctx.manualBibMap.set(item.key, ctx.manualBib.length);
    }
  }

  function prepareCitations(ctx, body) {
    scanManualBib(ctx, body);
    const re = /\\(?:cite|citep|citet|citealp|citealt|citeauthor|citeyear|citeyearpar|nocite|parencite|textcite|autocite|footcite)\*?\s*(?:\[[^\]]*\]\s*){0,2}\{([^}]*)\}/g;
    let m;
    const seen = new Set();
    let nociteAll = false;
    while ((m = re.exec(body))) {
      const keys = m[1].split(',').map((s) => s.trim()).filter(Boolean);
      for (const key of keys) {
        if (key === '*') { nociteAll = true; continue; }
        if (!seen.has(key)) {
          seen.add(key);
          ctx.citeOrder.push(key);
        }
      }
    }
    for (const [key] of ctx.manualBibMap) {
      if (!seen.has(key)) {
        seen.add(key);
        ctx.citeOrder.push(key);
      }
    }
    if (nociteAll) {
      for (const key of ctx.bib.keys()) {
        if (!seen.has(key)) { seen.add(key); ctx.citeOrder.push(key); }
      }
    }
    if (!ctx.citeOrder.length && ctx.bib.size && ctx.bibFiles.length) {
      for (const key of ctx.bib.keys()) {
        ctx.citeOrder.push(key);
        seen.add(key);
      }
    }
    let num = 1;
    for (const key of ctx.citeOrder) {
      if (ctx.manualBibMap.has(key)) {
        ctx.citeMap.set(key, {
          num: num++,
          entry: null,
          manual: ctx.manualBib.find((b) => b.key === key)
        });
      } else if (ctx.bib.has(key)) {
        ctx.citeMap.set(key, { num: num++, entry: ctx.bib.get(key), manual: null });
      }
    }
    for (const key of ctx.citeOrder) {
      if (!ctx.citeMap.has(key)) ctx.warnings.add(`引用键不存在：${key}`);
    }
    ctx.stats.citations = ctx.citeOrder.length;
  }

  function formatCssLength(raw) {
    const s = String(raw || '').trim();
    if (!s) return '';
    if (/^-?\d*\.?\d+\s*(cm|mm|in|pt|em|ex|px|%)$/.test(s)) return s;
    if (/^-?\d*\.?\d+$/.test(s)) return s + 'pt';
    return '';
  }

  function widthToCss(raw) {
    let s = String(raw || '').trim();
    if (!s) return '';
    const rel = /^([0-9.]+)\s*\*?\s*\\(?:linewidth|textwidth|columnwidth|hsize)$/.exec(s);
    if (rel) return `${Math.max(0, Math.min(100, Number(rel[1]) * 100))}%`;
    if (/^\\(?:linewidth|textwidth|columnwidth|hsize)$/.test(s)) return '100%';
    const m = /^([0-9.]+)\s*%\s*$/.exec(s);
    if (m) return `${Math.max(0, Math.min(100, Number(m[1])))}%`;
    return formatCssLength(s);
  }

  function parseKeyList(raw) {
    return String(raw || '').split(',').map((s) => s.trim()).filter(Boolean);
  }
