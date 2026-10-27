/* ==========================================================================
   Qelemchi · LaTeX preview engine (part 5: assembly & public API)
   ========================================================================== */

  function refPrefix(kind, label, ctx) {
    const zh = ctx.zh;
    if (kind === 'ref' || kind === 'vref' || kind === 'name') return '';
    const n = label ? label.number : '??';
    if (kind === 'eq') return zh ? `式 (${n})` : `Equation (${n})`;
    const k = label ? label.kind : 'sec';
    if (k === 'fig') return zh ? `图 ${n}` : `Figure ${n}`;
    if (k === 'tbl') return zh ? `表 ${n}` : `Table ${n}`;
    if (k === 'eq') return zh ? `式 (${n})` : `Equation (${n})`;
    if (k === 'thm') return zh ? `定理 ${n}` : `Theorem ${n}`;
    if (k === 'alg') return zh ? `算法 ${n}` : `Algorithm ${n}`;
    if (k === 'sec') return zh ? `第 ${n} 节` : `Section ${n}`;
    return String(n);
  }

  function resolveRefTokens(html, ctx) {
    return String(html).replace(/@@TREF\|([^|]+)\|([^@]+)@@/g, (_, kind, encoded) => {
      let key = encoded;
      try { key = decodeURIComponent(encoded); } catch (e) { /* keep */ }
      const label = ctx.labels.get(key);
      if (!label) {
        ctx.warnings.add(`交叉引用不存在：${key}`);
        return '<span class="xref missing">??</span>';
      }
      if (kind === 'name') {
        const text = label.title || label.number || '??';
        return `<a class="xref" href="#${escAttr(label.id)}">${esc(text)}</a>`;
      }
      if (kind === 'eq') {
        return `<a class="xref" href="#${escAttr(label.id)}">(${esc(label.number || '?')})</a>`;
      }
      if (kind === 'ref' || kind === 'vref') {
        return `<a class="xref" href="#${escAttr(label.id)}">${esc(label.number || '?')}</a>`;
      }
      const prefix = refPrefix(kind, label, ctx);
      return `<a class="xref" href="#${escAttr(label.id)}">${esc(prefix)}</a>`;
    });
  }

  function stripHtmlText(html) {
    return String(html || '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
  }

  function countStats(html, ctx) {
    const text = stripHtmlText(html);
    const cjk = (text.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g) || []).length;
    const latin = text.replace(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g, ' ')
      .match(/[A-Za-z0-9][A-Za-z0-9'’._-]*/g) || [];
    return {
      words: latin.length + cjk,
      chars: text.replace(/\s+/g, '').length,
      cjk,
      equations: ctx.stats.equations,
      figures: ctx.stats.figures,
      tables: ctx.stats.tables,
      citations: ctx.stats.citations,
      refs: ctx.labels.size,
      headings: ctx.tocItems.length
    };
  }

  // Author notes are typeset as footnotes, not as extra author lines.
  function stripAuthorNotes(src) {
    const s = String(src || '');
    let out = '';
    let i = 0;
    while (i < s.length) {
      if (s[i] === '\\') {
        const m = /^\\(?:thanks|footnote|footnotetext)\b\s*/.exec(s.slice(i));
        if (m) {
          const p = i + m[0].length;
          if (s[p] === '{') {
            const g = readGroup(s, p);
            if (g) { i = g.end; continue; }
          }
        }
      }
      out += s[i++];
    }
    return out;
  }

  // Simple, argument-less definitions such as \def\confName{CVPR}. The visual
  // editor can substitute these without a TeX engine.
  function collectSimpleDefs(source) {
    const defs = {};
    const re = /\\(?:def|newcommand|renewcommand|providecommand)\s*(?:\{\s*\\([A-Za-z@]+)\s*\}|\\([A-Za-z@]+))\s*(?:\[[^\]]*\]\s*)?\{([^{}]*)\}/g;
    let m;
    while ((m = re.exec(source))) {
      const name = m[1] || m[2];
      const value = m[3];
      if (!name || value == null || defs[name] != null) continue;
      if (/[#\\{}]/.test(value)) continue;
      defs[name] = value.trim();
    }
    return defs;
  }

  function expandSimpleDefs(src, defs) {
    let out = String(src || '');
    for (const name of Object.keys(defs || {}).sort((a, b) => b.length - a.length)) {
      const re = new RegExp(`\\\\${name}(?![A-Za-z@])`, 'g');
      out = out.replace(re, () => defs[name]);
    }
    return out;
  }

  function splitTitleLines(src) {
    return stripAuthorNotes(src)
      .split(/\\\\\s*(?:\[[^\]]*\])?/)
      .map((line) => plainText(line))
      .filter(Boolean);
  }

  function splitAuthorGroups(src) {
    return stripAuthorNotes(src)
      .split(/\\(?:and|And|AND)(?![A-Za-z])/)
      .map((author) => splitTitleLines(author))
      .filter((group) => group.length);
  }

  function buildProject(input = {}) {
    const ctx = createRenderContext(input);
    const warnings = ctx.warnings;
    if (!ctx.mainPath) {
      warnings.error('没有可用的 .tex 源文件。');
      return {
        html: '<div class="tex-placeholder"><b>没有找到 LaTeX 源文件</b><br>请新建一个 main.tex 文件。</div>',
        warnings: warnings.list,
        meta: { title: '', author: '', engine: 'pdflatex', pageSize: 'a4', zh: false },
        stats: { words: 0, chars: 0, cjk: 0, equations: 0, figures: 0, tables: 0, citations: 0, refs: 0, headings: 0 },
        toc: [],
        labels: {}
      };
    }
    const rawMain = getText(ctx, ctx.mainPath) || '';
    const source = stripComments(expandIncludes(ctx, ctx.mainPath));
    const parsed = parsePreamble(ctx, source);
    let body = expandUserMacros(parsed.body, ctx);
    if ((ctx.titleRaw || ctx.authorRaw) && !/\\maketitle\b/.test(body)) {
      body = '\\maketitle\n\n' + body;
    }
    prepareCitations(ctx, body);
    let html = parseBlocks(ctx, body, {}).join('\n');
    if (html.includes('@@TOCBLOCK@@')) {
      html = html.split('@@TOCBLOCK@@').join(buildTocHtml(ctx));
    }
    if (!ctx.bibRendered && (ctx.citeOrder.length || ctx.bib.size || ctx.manualBib.length)) {
      html += '\n' + renderBibliographyBlock(ctx);
    }
    html = resolveRefTokens(html, ctx);
    if (!html.trim()) {
      html = '<div class="tex-placeholder"><b>正文为空</b><br>在 main.tex 的 document 环境中开始写作吧。</div>';
    }
    const stats = countStats(html, ctx);
    const packages = Array.from(ctx.packages);
    const docOptions = ctx.docOptions.slice();
    const cvprOptions = ctx.packageOptions.get('cvpr') || [];
    const neuripsOptions = ctx.packageOptions.get('neurips_2025')
      || ctx.packageOptions.get('neurips')
      || [];
    const cvprReview = packages.includes('cvpr') && cvprOptions.includes('review');
    const neuripsFinal = neuripsOptions.some((o) => (
      o === 'final' || o === 'preprint' || o === 'dandb' || o === 'creativeai' || o === 'sglblindworkshop'
    ));
    const anonymous = cvprReview || (packages.some((p) => /^neurips/.test(p)) && !neuripsFinal);
    const defs = collectSimpleDefs(source);
    const defValue = (name) => (defs[name] != null ? plainText(defs[name]) : '');
    const titleRaw = expandSimpleDefs(ctx.titleRaw, defs);
    const authorRaw = expandSimpleDefs(ctx.authorRaw, defs);
    const meta = {
      title: plainText(titleRaw) || '未命名文稿',
      titleLines: splitTitleLines(titleRaw),
      author: plainText(authorRaw),
      authorGroups: splitAuthorGroups(authorRaw),
      date: ctx.hasDateCommand ? formatDate(ctx.dateRaw, ctx.zh) : '',
      engine: ctx.engine,
      pageSize: ctx.pageSize,
      zh: ctx.zh,
      docClass: ctx.docClass,
      docOptions,
      baseFont: ctx.baseFont || '10pt',
      packages,
      geometry: ctx.geometryRaw || '',
      anonymous,
      paperId: defValue('paperID'),
      confName: defValue('confName'),
      defs,
      mainPath: ctx.mainPath,
      bibFiles: ctx.bibFiles.slice(),
      hasTitle: !!ctx.titleRaw,
      warnings: warnings.list.length
    };
    return {
      html,
      warnings: warnings.list,
      meta,
      stats,
      toc: ctx.tocItems.slice(),
      labels: Object.fromEntries(Array.from(ctx.labels.entries()).map(([k, v]) => [k, { kind: v.kind, number: v.number, title: v.title, id: v.id }])),
      citations: Object.fromEntries(Array.from(ctx.citeMap.entries()).map(([k, v]) => [k, v.num])),
      engine: ctx.engine,
      pageSize: ctx.pageSize,
      mathMacros: ctx.mathMacros || {}
    };
  }

  function scanOutline(input = {}) {
    const files = (input.files || []).map((f) => ({ path: normalizePath(f.path), text: String(f.text || '') }));
    const mainPath = normalizePath(input.mainPath || '');
    files.sort((a, b) => {
      if (a.path === mainPath) return -1;
      if (b.path === mainPath) return 1;
      return a.path.localeCompare(b.path);
    });
    const out = [];
    const levelOf = { part: 0, chapter: 1, section: 1, subsection: 2, subsubsection: 3, paragraph: 4 };
    for (const file of files) {
      if (!/\.tex$/i.test(file.path)) continue;
      const text = stripComments(file.text);
      const re = /\\(part|chapter|section|subsection|subsubsection|paragraph)\*?\s*(?:\[[^\]]*\]\s*)?\{/g;
      let m;
      while ((m = re.exec(text))) {
        const g = readGroup(text, m.index + m[0].length - 1);
        if (!g) continue;
        const before = text.slice(0, m.index);
        const line = before.split('\n').length;
        const title = plainText(g.text) || '(未命名)';
        out.push({
          level: levelOf[m[1]] || 1,
          command: m[1],
          starred: /\\[a-z]+\*/.test(m[0]),
          title,
          file: file.path,
          line,
          id: `outline-${out.length}`
        });
      }
    }
    return out;
  }

  return {
    build: buildProject,
    parse: buildProject,
    scanOutline,
    parseBib,
    version: '1.0.0'
  };
})();
