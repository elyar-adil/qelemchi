/* ==========================================================================
   Qelemchi · LaTeX preview engine (part 4: block rendering)
   ========================================================================== */

  const HEADING_NAMES = ['part', 'chapter', 'section', 'subsection', 'subsubsection', 'paragraph', 'subparagraph'];

  const THEOREM_DEFAULTS = {
    theorem: ['Theorem', '定理'], lemma: ['Lemma', '引理'], proposition: ['Proposition', '命题'],
    corollary: ['Corollary', '推论'], definition: ['Definition', '定义'], remark: ['Remark', '注记'],
    example: ['Example', '例'], assumption: ['Assumption', '假设'], conjecture: ['Conjecture', '猜想'],
    claim: ['Claim', '断言'], observation: ['Observation', '观察'], notation: ['Notation', '记号'],
    exercise: ['Exercise', '练习'], problem: ['Problem', '问题'], algorithm: ['Algorithm', '算法'],
    property: ['Property', '性质'], result: ['Result', '结果'], fact: ['Fact', '事实']
  };

  function extractLabels(raw) {
    const labels = [];
    const clean = String(raw || '').replace(/\\label\s*\{([^}]*)\}/g, (_, key) => {
      const k = key.trim();
      if (k) labels.push(k);
      return '';
    });
    return { labels, clean };
  }

  function extractCaption(raw) {
    const re = /\\caption\*?\s*(?:\[[^\]]*\]\s*)?\{/g;
    const m = re.exec(raw);
    if (!m) return { caption: '', star: false, clean: raw, index: -1 };
    const g = readGroup(raw, m.index + m[0].length - 1);
    if (!g) return { caption: '', star: /caption\*/.test(m[0]), clean: raw, index: m.index };
    const clean = raw.slice(0, m.index) + raw.slice(g.end);
    return {
      caption: g.text,
      star: /caption\*/.test(m[0]),
      clean,
      index: m.index,
      end: g.end
    };
  }

  function removeCommandArg(raw, name) {
    const re = new RegExp('\\\\' + name + '\\*?\\s*(?:\\[[^\\]]*\\]\\s*)?\\{', 'g');
    let out = '';
    let last = 0;
    let m;
    while ((m = re.exec(raw))) {
      const g = readGroup(raw, m.index + m[0].length - 1);
      if (!g) break;
      out += raw.slice(last, m.index);
      last = g.end;
      re.lastIndex = g.end;
    }
    return last ? out + raw.slice(last) : raw;
  }

  function pageBreakBlock() {
    return '<div class="page-break" data-page-break="1"></div>';
  }

  function renderProse(ctx, raw, opts = {}) {
    const blocks = [];
    let text = String(raw || '').replace(/\r\n?/g, '\n');
    if (!text.trim()) return blocks;
    // Split on blank lines at the top level. \par is also a paragraph boundary.
    const pieces = text.split(/\n[ \t]*\n|(?:^|\s)\\par(?:\s|$)/);
    for (let piece of pieces) {
      piece = piece.trim();
      if (!piece) continue;
      if (/^\\(?:vspace|hspace|smallskip|medskip|bigskip)\b/.test(piece) && piece.length < 120) {
        // A paragraph made only of spacing commands should not create an empty line.
        const stripped = piece.replace(/\\(?:vspace|hspace)\s*(?:\[[^\]]*\])?\s*\{[^}]*\}/g, '').replace(/\\(?:smallskip|medskip|bigskip)\b/g, '').trim();
        if (!stripped) continue;
      }
      let noindent = false;
      if (/^\\noindent\b/.test(piece)) {
        noindent = true;
        piece = piece.replace(/^\\noindent\b\s*/, '');
      }
      if (!piece.trim()) continue;
      const { html, notes } = renderInlineWithNotes(piece, ctx);
      const cls = ['paper-para'];
      if (noindent) cls.push('no-indent');
      blocks.push(`<p class="${cls.join(' ')}">${html}${notesHtml(notes)}</p>`);
    }
    return blocks;
  }

  function renderTitleBlock(ctx) {
    ctx.titleRendered = true;
    const title = String(ctx.titleRaw || '').trim();
    const author = String(ctx.authorRaw || '').trim();
    const date = ctx.hasDateCommand ? formatDate(ctx.dateRaw, ctx.zh) : '';
    if (!title && !author && !date) return '';
    const notes = [];
    const prevSink = ctx.noteSink;
    ctx.noteSink = notes;
    const titleHtml = title ? renderInline(title, ctx) : '';
    const authorParts = author ? splitTopLevel(author, 'and') : [];
    const authorHtml = authorParts
      .map((part) => renderInline(part.trim(), ctx))
      .filter(Boolean)
      .join('<span class="author-sep">·</span>');
    ctx.noteSink = prevSink;
    const kicker = ctx.zh ? '研究论文' : 'RESEARCH PAPER';
    const parts = [`<div class="paper-title-kicker">${esc(kicker)}</div>`];
    if (titleHtml) parts.push(`<h1 class="paper-title">${titleHtml}</h1>`);
    if (authorHtml) parts.push(`<div class="paper-authors">${authorHtml}</div>`);
    if (date) parts.push(`<div class="paper-date">${esc(date)}</div>`);
    if (notes.length) parts.push(notesHtml(notes));
    return `<div class="paper-title-block">${parts.join('')}</div>`;
  }

  function headingLevelIndex(ctx, name) {
    if (name === 'chapter') return 0;
    if (name === 'section') return ctx.chapterMode ? 1 : 0;
    if (name === 'subsection') return ctx.chapterMode ? 2 : 1;
    if (name === 'subsubsection') return ctx.chapterMode ? 3 : 2;
    if (name === 'paragraph' || name === 'subparagraph') return ctx.chapterMode ? 4 : 3;
    return 0;
  }

  function headingTag(ctx, name) {
    if (name === 'part') return 'h1';
    if (name === 'chapter') return 'h1';
    if (name === 'section') return ctx.chapterMode ? 'h2' : 'h1';
    if (name === 'subsection') return ctx.chapterMode ? 'h3' : 'h2';
    if (name === 'subsubsection') return ctx.chapterMode ? 'h4' : 'h3';
    return 'h4';
  }

  function headingNumber(ctx, name) {
    const arr = ctx.counters.section;
    if (name === 'part') {
      ctx.counters.part = (ctx.counters.part || 0) + 1;
      return toRoman(ctx.counters.part);
    }
    const level = headingLevelIndex(ctx, name);
    if (level === 0) {
      arr[0]++;
      for (let k = 1; k < arr.length; k++) arr[k] = 0;
      ctx.currentSectionNumber = ctx.appendix ? alphabet(arr[0]) : String(arr[0]);
      return ctx.currentSectionNumber;
    }
    arr[level]++;
    for (let k = level + 1; k < arr.length; k++) arr[k] = 0;
    const parts = [];
    for (let k = 0; k <= level; k++) {
      if (k === 0 && ctx.appendix) parts.push(alphabet(arr[0]));
      else parts.push(String(arr[k]));
    }
    ctx.currentSectionNumber = parts.join('.');
    return ctx.currentSectionNumber;
  }

  function parseHeading(ctx, src, start) {
    const cmd = readCommandName(src, start);
    if (!cmd) return null;
    const name = cmd.name;
    let p = cmd.end;
    let starred = false;
    if (src[p] === '*') { starred = true; p++; }
    let p2 = skipSpace(src, p);
    const opt = readOptional(src, p2);
    if (opt) p2 = opt.end;
    const g = readGroup(src, p2);
    if (!g) return null;
    p = g.end;
    const labels = [];
    let titleRaw = g.text;
    const inTitle = extractLabels(titleRaw);
    labels.push(...inTitle.labels);
    titleRaw = inTitle.clean;
    // Labels commonly sit immediately after \section{...}.
    while (true) {
      const q = skipSpace(src, p);
      if (src.startsWith('\\label', q) && !/[A-Za-z@]/.test(src[q + 6] || '')) {
        const lg = readGroup(src, q + 6);
        if (lg) {
          labels.push(lg.text.trim());
          p = lg.end;
          continue;
        }
      }
      break;
    }
    const level = headingLevelIndex(ctx, name);
    let number = '';
    if (!starred && name !== 'part') number = headingNumber(ctx, name);
    if (starred) {
      // Starred sections do not update the visible section title used by
      // equation/theorem anchors, but they are still a logical division.
      ctx.currentSectionNumber = ctx.currentSectionNumber || '';
    }
    const titleText = plainText(titleRaw);
    ctx.currentSectionTitle = titleText;
    ctx.currentSectionKind = 'sec';
    ctx.headingSeq++;
    let blockId = labels.length ? `lbl-${safeId(labels[0])}` : `sec-${ctx.headingSeq}`;
    const extraAnchors = [];
    for (let k = 0; k < labels.length; k++) {
      const entry = registerLabel(ctx, labels[k], 'sec', number || '?', titleText);
      if (k === 0) blockId = `lbl-${safeId(labels[0])}`;
      else extraAnchors.push(entry);
    }
    ctx.currentSectionId = blockId;
    if (!starred) {
      ctx.tocItems.push({
        level: Math.max(1, level + 1),
        number,
        title: titleText || '(未命名)',
        id: blockId
      });
    }
    const tag = headingTag(ctx, name);
    const cls = ['paper-heading', `h${Math.max(1, level + 1)}`];
    if (starred) cls.push('unnumbered');
    if (name === 'part') cls.push('paper-part');
    const numHtml = number ? `<span class="sec-num">${esc(number)}</span>` : '';
    const html = `<${tag} class="${cls.join(' ')}" id="${escAttr(blockId)}">${numHtml}${renderInline(titleRaw, ctx)}${extraAnchors.join('')}</${tag}>`;
    return { html, end: p, name, number, starred };
  }

  function toRoman(n) {
    const map = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
    let out = '';
    let x = Math.max(1, n | 0);
    for (const [v, s] of map) {
      while (x >= v) { out += s; x -= v; }
    }
    return out;
  }

  function renderEquationBlock(ctx, raw, opts = {}) {
    let content = String(raw || '').trim();
    const labels = [];
    content = content.replace(/\\label\s*\{([^}]*)\}/g, (_, key) => { labels.push(key.trim()); return ''; });
    let tag = '';
    let tagStar = false;
    const tagM = /\\tag\*?\s*\{/.exec(content);
    if (tagM) {
      tagStar = /\\tag\*/.test(tagM[0]);
      const g = readGroup(content, tagM.index + tagM[0].length - 1);
      if (g) {
        tag = g.text.trim();
        content = content.slice(0, tagM.index) + content.slice(g.end);
      }
    }
    const unnumbered = opts.numbered === false || /\\nonumber\b|\\notag\b/.test(content) || tagStar;
    content = content.replace(/\\nonumber\b|\\notag\b/g, '').trim();
    let number = '';
    if (!unnumbered) {
      if (tag) number = tag;
      else {
        ctx.counters.equation++;
        number = String(ctx.counters.equation);
      }
    } else if (tag) {
      number = tag;
    }
    const env = opts.env || '';
    let math = content;
    if (env === 'align' || env === 'align*' || env === 'flalign' || env === 'flalign*' || env === 'eqnarray' || env === 'eqnarray*') {
      math = `\\begin{aligned}\n${content}\n\\end{aligned}`;
    } else if (env === 'gather' || env === 'gather*' || env === 'multline' || env === 'multline*') {
      math = `\\begin{gathered}\n${content}\n\\end{gathered}`;
    } else if (env === 'displaymath' || env === 'math') {
      // already math
    }
    const autoId = `eq-${number || (ctx.stats.equations + 1)}`;
    let blockId = autoId;
    const anchors = [];
    for (let k = 0; k < labels.length; k++) {
      const entry = registerLabel(ctx, labels[k], 'eq', number || '?', '式');
      if (k === 0) blockId = `lbl-${safeId(labels[0])}`;
      else anchors.push(entry);
    }
    ctx.stats.equations++;
    const numHtml = unnumbered ? '' : `<div class="eq-number">(${esc(number)})</div>`;
    return `<div class="equation${unnumbered ? ' unnumbered' : ''}" id="${escAttr(blockId)}">` +
      `<div class="eq-math">\\[${mathEsc(math)}\\]</div>${numHtml}${anchors.join('')}</div>`;
  }

  function imageBlockHtml(ctx, path, optsRaw) {
    const opts = parseKeyValueOptions(optsRaw || '');
    const resolved = resolveAsset(path, ctx.mainPath, ctx);
    if (!resolved) {
      return `<div class="figure-placeholder"><b>图片未找到</b><code>${esc(path)}</code></div>`;
    }
    const url = ctx.assets.get(resolved);
    if (!url) {
      return `<div class="figure-placeholder"><b>该图片格式需真实编译后显示</b><code>${esc(resolved)}</code></div>`;
    }
    const style = [];
    const w = widthToCss(opts.width || '');
    const h = opts.height ? formatCssLength(opts.height) : '';
    if (w) style.push(`width:${w}`);
    if (h) style.push(`height:${h}`);
    if (opts.scale) style.push(`transform:scale(${Math.max(0.05, Math.min(4, Number(opts.scale) || 1))})`);
    return `<img src="${escAttr(url)}" alt="${escAttr(basename(resolved))}"${style.length ? ` style="${style.join(';')}"` : ''}>`;
  }

  function renderFigureContent(ctx, content, opts = {}) {
    let raw = String(content || '');
    const cap = extractCaption(raw);
    raw = cap.clean;
    const allLabels = extractLabels(raw);
    let labels = allLabels.labels.concat(extractLabels(cap.caption).labels);
    raw = allLabels.clean;
    let caption = extractLabels(cap.caption).clean.trim();
    // Remove float/layout commands that have no visual representation here.
    raw = raw
      .replace(/\\(?:centering|raggedright|raggedleft|small|footnotesize|scriptsize|tiny|large|Large|LARGE|huge|Huge|normalsize)\b/g, ' ')
      .replace(/\\(?:vspace|hspace)\s*(?:\[[^\]]*\])?\s*\{[^}]*\}/g, ' ')
      .replace(/\\caption\*?\s*(?:\[[^\]]*\])?\s*\{[^}]*\}/g, ' ')
      .replace(/\\label\s*\{[^}]*\}/g, ' ');
    const includes = [];
    const re = /\\includegraphics\s*(?:\[([^\]]*)\])?\s*\{([^}]*)\}/g;
    let m;
    while ((m = re.exec(raw))) includes.push({ opts: m[1] || '', path: m[2].trim() });
    let media = '';
    if (includes.length === 1) {
      media = imageBlockHtml(ctx, includes[0].path, includes[0].opts);
    } else if (includes.length > 1) {
      media = `<div class="figure-grid">${includes.map((inc) => `<div class="figure-cell">${imageBlockHtml(ctx, inc.path, inc.opts)}</div>`).join('')}</div>`;
    } else if (/\\begin\s*\{tikzpicture\}|\\tikz\b|\\begin\s*\{picture\}/.test(raw)) {
      media = `<div class="figure-placeholder wide"><b>TikZ / 绘图内容</b><code>需真实编译后显示</code></div>`;
    } else {
      const leftovers = plainText(raw);
      if (leftovers) media = `<div class="figure-placeholder wide"><b>图</b><code>${esc(leftovers.slice(0, 160))}</code></div>`;
    }
    const num = ++ctx.counters.figure;
    ctx.stats.figures++;
    const labelWord = ctx.zh ? '图' : 'Figure';
    let blockId = `fig-${num}`;
    const anchors = [];
    for (let k = 0; k < labels.length; k++) {
      const entry = registerLabel(ctx, labels[k], 'fig', String(num), plainText(caption));
      if (k === 0) blockId = `lbl-${safeId(labels[0])}`;
      else anchors.push(entry);
    }
    const capHtml = caption
      ? `<figcaption>${cap.star ? '' : `<span class="cap-label">${labelWord} ${num}</span>　`}${renderInline(caption, ctx)}</figcaption>`
      : '';
    const cls = `paper-figure${opts.wide ? ' wide' : ''}`;
    return `<figure class="${cls}" id="${escAttr(blockId)}">${anchors.join('')}<div class="figure-media">${media}</div>${capHtml}</figure>`;
  }

  function parseColumnSpec(spec) {
    const s = String(spec || '').replace(/\s+/g, '');
    const out = [];
    let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (c === 'l' || c === 'c' || c === 'r') { out.push(c); i++; continue; }
      if (c === 'X') { out.push('l'); i++; continue; }
      if (c === 'p' || c === 'm' || c === 'b') {
        if (s[i + 1] === '{') {
          const g = readGroup(s, i + 1);
          out.push('l');
          i = g ? g.end : i + 2;
          continue;
        }
        out.push('l'); i++; continue;
      }
      if (c === '*') {
        if (s[i + 1] === '{') {
          const g = readGroup(s, i + 1);
          if (g && s[g.end] === '{') {
            const g2 = readGroup(s, g.end);
            const sub = parseColumnSpec(g2 ? g2.text : '');
            const n = Math.max(0, parseInt(g.text, 10) || 0);
            for (let k = 0; k < n; k++) out.push(...sub);
            i = g2 ? g2.end : g.end;
            continue;
          }
        }
        i++; continue;
      }
      if (c === '>' || c === '<' || c === '@' || c === '!') {
        if (s[i + 1] === '{') {
          const g = readGroup(s, i + 1);
          i = g ? g.end : i + 2;
          continue;
        }
      }
      i++;
    }
    return out.length ? out : ['l'];
  }

  function splitTableRows(body) {
    const rows = [];
    let start = 0;
    let depth = 0;
    let math = false;
    for (let i = 0; i < body.length; i++) {
      const c = body[i];
      if (c === '\\') {
        if (depth === 0 && !math && body[i + 1] === '\\') {
          rows.push(body.slice(start, i));
          i += 2;
          if (body[i] === '*') i++;
          if (body[i] === '[') {
            const opt = readOptional(body, i);
            if (opt) i = opt.end - 1;
          }
          start = i + 1;
          continue;
        }
        if (depth === 0 && !math && (body.slice(i, i + 3) === '\\cr' && !/[A-Za-z]/.test(body[i + 3] || ''))) {
          rows.push(body.slice(start, i));
          i += 2;
          start = i + 1;
          continue;
        }
        i++;
        continue;
      }
      if (c === '{') depth++;
      else if (c === '}') depth = Math.max(0, depth - 1);
      else if (c === '$' && depth === 0) math = !math;
    }
    rows.push(body.slice(start));
    return rows;
  }

  function splitTableCells(row) {
    const cells = [];
    let start = 0;
    let depth = 0;
    let math = false;
    for (let i = 0; i < row.length; i++) {
      const c = row[i];
      if (c === '\\') { i++; continue; }
      if (c === '{') depth++;
      else if (c === '}') depth = Math.max(0, depth - 1);
      else if (c === '$' && depth === 0) math = !math;
      else if (c === '&' && depth === 0 && !math) {
        cells.push(row.slice(start, i));
        start = i + 1;
      }
    }
    cells.push(row.slice(start));
    return cells.map((c) => c.trim());
  }

  function parseTableCell(ctx, cell, align, isHeader) {
    let text = String(cell || '').trim();
    text = text.replace(/\\rowcolor\s*\{[^}]*\}/g, ' ')
      .replace(/\\cellcolor\s*\{[^}]*\}/g, ' ')
      .replace(/\\arrayrulecolor\s*\{[^}]*\}/g, ' ')
      .replace(/\\specialrule\s*\{[^}]*\}\s*\{[^}]*\}\s*\{[^}]*\}/g, ' ')
      .replace(/\\cline\s*\{[^}]*\}/g, ' ')
      .replace(/\\cmidrule(?:\([^)]*\))?\s*\{[^}]*\}/g, ' ')
      .replace(/\\(?:centering|raggedright|raggedleft)\b/g, ' ')
      .trim();
    let colspan = 1;
    let rowspan = 1;
    let colAlign = align || 'l';
    const mc = /^\\multicolumn\s*\{([^}]*)\}\s*\{([^}]*)\}\s*\{/.exec(text);
    if (mc) {
      colspan = Math.max(1, parseInt(mc[1], 10) || 1);
      const as = parseColumnSpec(mc[2]);
      colAlign = as[0] || colAlign;
      const g = readGroup(text, mc[0].length - 1);
      text = g ? g.text : '';
    }
    const mr = /^\\multirow\s*\{([^}]*)\}\s*\{([^}]*)\}\s*\{/.exec(text);
    if (mr) {
      rowspan = Math.max(1, parseInt(mr[1], 10) || 1);
      const g = readGroup(text, mr[0].length - 1);
      text = g ? g.text : '';
    }
    const mcell = /^\\makecell\s*(?:\[[^\]]*\]\s*)?\{/.exec(text);
    if (mcell) {
      const g = readGroup(text, mcell[0].length - 1);
      text = g ? g.text : text;
    }
    const ss = /^\\shortstack\s*(?:\[[^\]]*\]\s*)?\{/.exec(text);
    if (ss) {
      const g = readGroup(text, ss[0].length - 1);
      text = g ? g.text : text;
    }
    text = text.replace(/\\\\/g, '<br>');
    const html = renderInline(text, ctx) || '&nbsp;';
    const tag = isHeader ? 'th' : 'td';
    const attrs = [`class="col-${colAlign}"`];
    if (colspan > 1) attrs.push(`colspan="${colspan}"`);
    if (rowspan > 1) attrs.push(`rowspan="${rowspan}"`);
    return `<${tag} ${attrs.join(' ')}>${html}</${tag}>`;
  }

  function renderTabular(ctx, spec, body) {
    const aligns = parseColumnSpec(spec);
    const rawRows = splitTableRows(String(body || '').replace(/\\tabularnewline\b/g, '\\\\'));
    const rows = [];
    let sawTop = false;
    let sawMid = false;
    for (const rawRow of rawRows) {
      let row = String(rawRow).trim();
      if (!row) continue;
      const hasTop = /\\toprule\b/.test(row);
      const hasMid = /\\midrule\b/.test(row);
      const hasBottom = /\\bottomrule\b/.test(row);
      if (hasTop) sawTop = true;
      if (hasMid) sawMid = true;
      row = row
        .replace(/\\toprule\b|\\midrule\b|\\bottomrule\b|\\hline\b|\\addlinespace\b/g, ' ')
        .replace(/\\cline\s*\{[^}]*\}/g, ' ')
        .replace(/\\cmidrule(?:\([^)]*\))?\s*\{[^}]*\}/g, ' ')
        .replace(/\\specialrule\s*\{[^}]*\}\s*\{[^}]*\}\s*\{[^}]*\}/g, ' ')
        .replace(/\\endfirsthead\b|\\endhead\b|\\endfoot\b|\\endlastfoot\b/g, ' ')
        .trim();
      if (!row) {
        if (hasMid && rows.length) rows[rows.length - 1].mid = true;
        continue;
      }
      const cells = splitTableCells(row);
      if (!cells.some((c) => c.trim())) continue;
      if (hasMid && rows.length) rows[rows.length - 1].mid = true;
      rows.push({ cells, mid: false, top: hasTop, bottom: hasBottom });
    }
    if (!rows.length) return '<div class="figure-placeholder">空表格</div>';
    const header = (sawTop || sawMid) && rows.length > 1 ? rows.shift() : null;
    if (header) header.mid = false;
    const width = Math.max(...rows.map((r) => r.cells.length), header ? header.cells.length : 0, aligns.length);
    const getAlign = (k) => aligns[k] || aligns[aligns.length - 1] || 'l';
    const renderRow = (row, isHeader) => {
      const cells = [];
      for (let k = 0; k < row.cells.length; k++) {
        cells.push(parseTableCell(ctx, row.cells[k], getAlign(k), isHeader));
      }
      while (cells.length < width) cells.push(`<${isHeader ? 'th' : 'td'} class="col-${getAlign(cells.length)}">&nbsp;</${isHeader ? 'th' : 'td'}>`);
      return `<tr${row.mid ? ' class="midrule"' : ''}>${cells.join('')}</tr>`;
    };
    const headHtml = header ? `<thead>${renderRow(header, true)}</thead>` : '';
    const bodyHtml = `<tbody>${rows.map((r) => renderRow(r, false)).join('')}</tbody>`;
    return `<table class="tabular${!sawTop && !sawMid ? ' no-rules' : ''}">${headHtml}${bodyHtml}</table>`;
  }

  function renderTableContent(ctx, content, opts = {}) {
    let raw = String(content || '');
    const cap = extractCaption(raw);
    let labels = extractLabels(raw).labels.concat(extractLabels(cap.caption).labels);
    raw = extractLabels(raw).clean;
    let caption = extractLabels(cap.caption).clean.trim();
    const tabRe = /\\begin\s*\{(tabular\*?|tabularx|longtable|array)\}/g;
    const tm = tabRe.exec(raw);
    if (!tm) {
      const leftovers = plainText(raw.replace(/\\centering\b/g, ''));
      if (!leftovers) return '';
      return `<div class="paper-table"><div class="table-wrap"><div class="figure-placeholder">${esc(leftovers)}</div></div></div>`;
    }
    const env = tm[1];
    let p = tm.index + tm[0].length;
    let spec = 'l';
    if (env === 'tabular*' || env === 'tabularx') {
      const w = readGroup(raw, p);
      if (w) p = w.end;
    }
    const pos = readOptional(raw, p);
    if (pos) p = pos.end;
    const sg = readGroup(raw, p);
    if (sg) { spec = sg.text; p = sg.end; }
    const found = findEnvEnd(raw, env, p);
    const tableBody = found.content;
    const capIndex = cap.index >= 0 ? cap.index : Infinity;
    const captionTop = capIndex < tm.index;
    const num = ++ctx.counters.table;
    ctx.stats.tables++;
    let blockId = `tbl-${num}`;
    const anchors = [];
    for (let k = 0; k < labels.length; k++) {
      const entry = registerLabel(ctx, labels[k], 'tbl', String(num), plainText(caption));
      if (k === 0) blockId = `lbl-${safeId(labels[0])}`;
      else anchors.push(entry);
    }
    const labelWord = ctx.zh ? '表' : 'Table';
    const capHtml = caption
      ? `<figcaption class="${captionTop ? 'caption-top' : 'caption-bottom'}">${cap.star ? '' : `<span class="cap-label">${labelWord} ${num}</span>　`}${renderInline(caption, ctx)}</figcaption>`
      : '';
    const table = renderTabular(ctx, spec, tableBody);
    const top = captionTop ? capHtml : '';
    const bottom = captionTop ? '' : capHtml;
    return `<figure class="paper-table" id="${escAttr(blockId)}">${anchors.join('')}${top}<div class="table-wrap">${table}</div>${bottom}</figure>`;
  }

  function parseListItems(content) {
    const items = [];
    let current = null;
    let i = 0;
    const push = () => { if (current) { items.push(current); current = null; } };
    const s = String(content || '');
    while (i < s.length) {
      if (s.startsWith('\\begin', i)) {
        const cmd = readCommandName(s, i);
        if (cmd && cmd.name === 'begin') {
          const g = readGroup(s, cmd.end);
          if (g) {
            const env = g.text.trim();
            const end = findEnvEnd(s, env, g.end);
            if (current) current.content += s.slice(i, end.end);
            i = end.end;
            continue;
          }
        }
      }
      if (s.startsWith('\\item', i) && !/[A-Za-z@]/.test(s[i + 5] || '')) {
        push();
        let p = i + 5;
        const opt = readOptional(s, p);
        let label = '';
        if (opt) { label = opt.text; p = opt.end; }
        current = { label, content: '' };
        i = p;
        continue;
      }
      if (current) current.content += s[i];
      i++;
    }
    push();
    return items;
  }

  function renderListEnv(ctx, env, content) {
    let raw = String(content || '');
    let start = 1;
    if (env === 'enumerate') {
      const opt = readOptional(raw, 0);
      if (opt) {
        raw = raw.slice(opt.end);
        const sm = /(?:^|,)\s*start\s*=\s*(\d+)/.exec(opt.text);
        if (sm) start = Math.max(1, parseInt(sm[1], 10) || 1);
      }
    }
    const items = parseListItems(raw);
    ctx.lists++;
    if (env === 'description') {
      const rows = items.map((item) => {
        const term = item.label ? renderInline(item.label, ctx) : '&nbsp;';
        const body = parseBlocks(ctx, item.content, { nested: true }).join('') || '&nbsp;';
        return `<dt>${term}</dt><dd>${body}</dd>`;
      });
      return `<dl>${rows.join('')}</dl>`;
    }
    const tag = env === 'enumerate' ? 'ol' : 'ul';
    const attr = env === 'enumerate' && start !== 1 ? ` start="${start}"` : '';
    const lis = items.map((item) => {
      let body = parseBlocks(ctx, item.content, { nested: true }).join('');
      body = body.replace(/^<p class="paper-para[^"]*">/, '<p>');
      return `<li>${body || '&nbsp;'}</li>`;
    });
    return `<${tag}${attr}>${lis.join('')}</${tag}>`;
  }

  function renderTheoremEnv(ctx, env, content) {
    const isProof = env === 'proof' || env === 'proof*';
    let raw = String(content || '').trim();
    const labels = extractLabels(raw).labels;
    raw = extractLabels(raw).clean;
    let note = '';
    const opt = readOptional(raw, 0);
    if (opt) { note = opt.text.trim(); raw = raw.slice(opt.end); }
    const def = ctx.newtheorems.get(env);
    let display = '';
    if (def) {
      display = def.title || env;
      const known = THEOREM_DEFAULTS[env];
      if (ctx.zh && known && /^[A-Za-z ]+$/.test(display)) display = known[1];
    } else if (THEOREM_DEFAULTS[env]) {
      display = ctx.zh ? THEOREM_DEFAULTS[env][1] : THEOREM_DEFAULTS[env][0];
    } else {
      display = env.replace(/[-_]/g, ' ');
    }
    let number = '';
    if (!isProof) {
      const starred = env.endsWith('*');
      if (!starred) {
        const key = (def && def.shared) || env.replace(/\*$/, '');
        const n = (ctx.counters.theorem.get(key) || 0) + 1;
        ctx.counters.theorem.set(key, n);
        if (def && def.within) number = `${ctx.currentSectionNumber || '0'}.${n}`;
        else number = String(n);
      }
    }
    const title = isProof ? (ctx.zh ? '证明' : 'Proof') : display;
    const headNum = number ? ` ${esc(number)}` : '';
    const noteHtml = note ? `<span class="thm-note">${ctx.zh ? '（' : ' ('}${renderInline(note, ctx)}${ctx.zh ? '）' : ')'}</span>` : '';
    const body = parseBlocks(ctx, raw, { nested: true }).join('');
    let blockId = `${safeId(env)}-${number || ctx.headingSeq}`;
    const anchors = [];
    for (let k = 0; k < labels.length; k++) {
      const entry = registerLabel(ctx, labels[k], 'thm', number || '?', `${title}${number ? ' ' + number : ''}`);
      if (k === 0) blockId = `lbl-${safeId(labels[0])}`;
      else anchors.push(entry);
    }
    const qed = isProof ? '<span class="qed">□</span>' : '';
    return `<div class="${escAttr(env.replace(/\*$/, ''))} theorem-box" id="${escAttr(blockId)}">${anchors.join('')}` +
      `<div class="thm-head">${esc(title)}${headNum}${noteHtml}.</div>` +
      `<div class="thm-body">${body || '&nbsp;'}${qed}</div></div>`;
  }

  function renderAbstract(ctx, content) {
    let raw = String(content || '');
    const kw = extractCommandArg(raw, 'keywords');
    let keywords = '';
    if (kw) {
      keywords = kw.text;
      raw = raw.slice(0, kw.start) + raw.slice(kw.end);
    }
    const kwEnv = /\\begin\s*\{(?:keywords|IEEEkeywords)\}([\s\S]*?)\\end\s*\{(?:keywords|IEEEkeywords)\}/i.exec(raw);
    if (kwEnv) {
      if (!keywords) keywords = kwEnv[1];
      raw = raw.slice(0, kwEnv.index) + raw.slice(kwEnv.index + kwEnv[0].length);
    }
    const body = parseBlocks(ctx, raw, { nested: true }).join('');
    const kwHtml = keywords.trim()
      ? `<div class="paper-keywords"><b>${ctx.zh ? '关键词' : 'Keywords'}：</b>${renderInline(keywords.replace(/\\sep\b/g, ', '), ctx)}</div>`
      : '';
    return `<div class="paper-abstract-block"><div class="abstract-title">${ctx.zh ? '摘要' : 'Abstract'}</div>${body}${kwHtml}</div>`;
  }

  function renderKeywords(ctx, raw) {
    const text = String(raw || '').trim();
    if (!text) return '';
    return `<div class="paper-keywords"><b>${ctx.zh ? '关键词' : 'Keywords'}：</b>${renderInline(text.replace(/\\sep\b/g, ', '), ctx)}</div>`;
  }

  function renderCodeEnv(ctx, env, content) {
    if (env.toLowerCase() === 'comment') return '';
    let raw = String(content || '');
    let lang = env.toLowerCase() === 'minted' ? '' : (env.toLowerCase().includes('lst') ? 'LaTeX' : 'Verbatim');
    if (env.toLowerCase() === 'minted') {
      const g = readGroup(raw, 0);
      if (g) { lang = g.text.trim(); raw = raw.slice(g.end); }
    }
    const opt = readOptional(raw, 0);
    if (opt) {
      const lm = /language\s*=\s*([^,\]]+)/i.exec(opt.text);
      if (lm) lang = lm[1].trim();
      raw = raw.slice(opt.end);
    }
    raw = raw.replace(/^\n/, '').replace(/\n\s*$/, '');
    const label = String(lang || 'code').toUpperCase();
    return `<div class="paper-code"><span class="code-label">${esc(label)}</span>${esc(raw)}</div>`;
  }

  function renderTheoremLikeAlgorithm(ctx, env, content) {
    let raw = String(content || '');
    const cap = extractCaption(raw);
    raw = cap.clean;
    const labels = extractLabels(raw).labels;
    raw = extractLabels(raw).clean;
    const num = ++ctx.counters.algorithm;
    let blockId = `alg-${num}`;
    const anchors = [];
    for (let k = 0; k < labels.length; k++) {
      const entry = registerLabel(ctx, labels[k], 'alg', String(num), plainText(cap.caption));
      if (k === 0) blockId = `lbl-${safeId(labels[0])}`;
      else anchors.push(entry);
    }
    const body = raw
      .replace(/\\begin\s*\{algorithmic\}([\s\S]*?)\\end\s*\{algorithmic\}/g, '$1')
      .replace(/\\(?:State|EndIf|EndFor|EndWhile|EndProcedure|EndFunction|Else|EndIf)\b/g, '\n')
      .replace(/\\(?:If|For|While|Procedure|Function)\b/g, '')
      .replace(/\\[A-Za-z@]+\*?/g, '')
      .replace(/[{}]/g, '')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return `<div class="paper-table algorithm-box" id="${escAttr(blockId)}"><div class="figure-placeholder wide" style="text-align:left"><b>${ctx.zh ? '算法' : 'Algorithm'} ${num}</b>${cap.caption ? `<div>${renderInline(cap.caption, ctx)}</div>` : ''}<pre style="white-space:pre-wrap;margin:.6em 0 0;font-family:var(--mono)">${esc(body)}</pre></div>${anchors.join('')}</div>`;
  }

  function renderBibliographyBlock(ctx) {
    if (ctx.bibRendered) return '';
    ctx.bibRendered = true;
    const entries = [];
    const order = ctx.citeOrder.length ? ctx.citeOrder : Array.from(ctx.bib.keys());
    if (!order.length && ctx.manualBib.length) {
      for (const m of ctx.manualBib) order.push(m.key);
    }
    const seen = new Set();
    for (let idx = 0; idx < order.length; idx++) {
      const key = order[idx];
      if (seen.has(key)) continue;
      seen.add(key);
      const info = ctx.citeMap.get(key);
      const manual = ctx.manualBib.find((m) => m.key === key);
      let num = info ? info.num : idx + 1;
      let html = '';
      if (manual) {
        html = renderInline(manual.content.replace(/\\newblock\b/g, ' '), ctx);
      } else if (ctx.bib.has(key)) {
        html = formatBibEntry(ctx.bib.get(key), ctx);
      } else {
        continue;
      }
      entries.push(`<div class="bib-entry" id="bib-${num}"><span class="bib-num">[${num}]</span>${html}</div>`);
    }
    if (!entries.length) {
      entries.push(`<div class="bib-empty">${ctx.zh ? '尚未找到参考文献条目。' : 'No bibliography entries found.'}</div>`);
    }
    return `<div class="paper-bibliography"><div class="bib-title">${ctx.zh ? '参考文献' : 'References'}</div>${entries.join('')}</div>`;
  }

  function formatBibEntry(entry, ctx) {
    if (!entry) return '';
    const f = entry.fields || {};
    const authors = formatAuthors(f.author || f.editor || '');
    const title = plainText(f.title || '');
    const year = plainText(f.year || f.date || '');
    const pages = plainText(f.pages || '').replace(/--/g, '–');
    const volume = plainText(f.volume || '');
    const number = plainText(f.number || '');
    const journal = plainText(f.journal || f.journaltitle || '');
    const booktitle = plainText(f.booktitle || '');
    const publisher = plainText(f.publisher || f.school || f.institution || '');
    const address = plainText(f.address || '');
    const doi = decodeUrlArg(f.doi || '');
    const url = safeLink(f.url || '');
    const pieces = [];
    if (authors) pieces.push(esc(authors) + '.');
    if (title) {
      const isBook = entry.type === 'book' || entry.type === 'thesis' || entry.type === 'phdthesis';
      pieces.push(isBook ? `<i>${esc(title)}</i>.` : esc(title) + '.');
    }
    if (entry.type === 'article') {
      let s = '';
      if (journal) s += `<i>${esc(journal)}</i>`;
      if (volume) s += (s ? ', ' : '') + `vol. ${esc(volume)}`;
      if (number) s += (s ? ', ' : '') + `no. ${esc(number)}`;
      if (pages) s += (s ? ', ' : '') + `pp. ${esc(pages)}`;
      if (year) s += (s ? ', ' : '') + esc(year);
      if (s) pieces.push(s + '.');
    } else if (entry.type === 'inproceedings' || entry.type === 'conference' || entry.type === 'incollection') {
      let s = '';
      if (booktitle) s += `In <i>${esc(booktitle)}</i>`;
      if (pages) s += (s ? ', ' : '') + `pp. ${esc(pages)}`;
      if (publisher) s += (s ? ', ' : '') + esc(publisher);
      if (year) s += (s ? ', ' : '') + esc(year);
      if (s) pieces.push(s + '.');
    } else {
      let s = '';
      if (publisher) s += esc(publisher);
      if (address) s += (s ? ', ' : '') + esc(address);
      if (year) s += (s ? ', ' : '') + esc(year);
      if (s) pieces.push(s + '.');
    }
    if (doi) pieces.push(`<a class="bib-link" href="https://doi.org/${escAttr(doi)}" target="_blank" rel="noopener noreferrer">doi:${esc(doi)}</a>.`);
    if (url && !doi) pieces.push(`<a class="bib-link" href="${escAttr(url)}" target="_blank" rel="noopener noreferrer">${esc(url)}</a>.`);
    if (f.note && !doi && !url) pieces.push(esc(plainText(f.note)) + '.');
    return pieces.join(' ');
  }

  function buildTocHtml(ctx) {
    const title = ctx.zh ? '目录' : 'Contents';
    if (!ctx.tocItems.length) {
      return `<div class="paper-toc"><div class="toc-title">${title}</div><div class="toc-empty">${ctx.zh ? '文内尚无带编号的章节标题。' : 'No numbered headings yet.'}</div></div>`;
    }
    const rows = ctx.tocItems.map((item) => {
      const lvl = Math.max(1, Math.min(4, item.level));
      return `<div class="toc-row lvl-${lvl}"><span class="toc-num">${esc(item.number)}</span>` +
        `<a href="#${escAttr(item.id)}" data-toc-ref="${escAttr(item.id)}">${esc(item.title)}</a>` +
        `<span class="toc-dots"></span><span class="toc-page" data-toc-page="${escAttr(item.id)}">—</span></div>`;
    }).join('');
    return `<div class="paper-toc"><div class="toc-title">${title}</div>${rows}</div>`;
  }

  const NOOP_ARG_COMMANDS = {
    pagestyle: 1, thispagestyle: 1, pagenumbering: 1, bibliographystyle: 1,
    hypersetup: 1, geometry: 1, graphicspath: 1, captionsetup: 1, sisetup: 1,
    markboth: 2, markright: 1, setlength: 2, addtolength: 2, setcounter: 2,
    addtocounter: 2, numberwithin: 2, pagecolor: 1, color: 1, definecolor: 3,
    newtheorem: 3, captionsetup: 1, hyphenation: 1, addcontentsline: 3,
    includegraphics: 1
  };

  function consumeGroups(src, i, count) {
    let p = i;
    for (let k = 0; k < count; k++) {
      const opt = readOptional(src, p);
      if (opt) p = opt.end;
      const g = readGroup(src, p);
      if (!g) return p;
      p = g.end;
    }
    return p;
  }

  function renderEnvironment(ctx, src, start, opts = {}) {
    const cmd = readCommandName(src, start);
    if (!cmd || cmd.name !== 'begin') return null;
    const eg = readGroup(src, cmd.end);
    if (!eg) return { html: '', end: cmd.end };
    const env = eg.text.trim();
    const envLower = env.toLowerCase();
    const found = findEnvEnd(src, env, eg.end);
    let content = found.content;
    const end = found.end;
    if (found.unterminated) ctx.warnings.add(`环境 ${env} 没有找到对应的 \\end{${env}}。`);
    let html = '';

    if (envLower === 'figure' || envLower === 'figure*' || envLower === 'wrapfigure' || envLower === 'subfigure') {
      if (envLower === 'wrapfigure') {
        const opt = readOptional(content, 0);
        if (opt) content = content.slice(opt.end);
        const w = readGroup(content, 0);
        if (w) content = content.slice(w.end);
      }
      content = content.replace(/^\s*\[[^\]]*\]\s*/, '');
      html = renderFigureContent(ctx, content, { wide: envLower === 'figure*' });
    } else if (envLower === 'table' || envLower === 'table*') {
      content = content.replace(/^\s*\[[^\]]*\]\s*/, '');
      html = renderTableContent(ctx, content, { wide: envLower === 'table*' });
    } else if (envLower === 'tabular' || envLower === 'tabular*' || envLower === 'tabularx' || envLower === 'longtable' || envLower === 'array') {
      const num = ++ctx.counters.table;
      const spec = readGroup(content, 0);
      const rest = spec ? content.slice(spec.end) : content;
      html = `<figure class="paper-table"><div class="table-wrap">${renderTabular(ctx, spec ? spec.text : 'l', rest)}</div></figure>`;
      ctx.stats.tables++;
    } else if (envLower === 'itemize' || envLower === 'enumerate' || envLower === 'description') {
      html = renderListEnv(ctx, envLower, content);
    } else if (envLower === 'abstract') {
      html = renderAbstract(ctx, content);
    } else if (envLower === 'keywords' || envLower === 'ieeekeywords') {
      html = renderKeywords(ctx, content);
    } else if (envLower === 'thebibliography') {
      html = renderBibliographyBlock(ctx);
    } else if (envLower === 'proof' || envLower === 'proof*' || ctx.newtheorems.has(envLower) || THEOREM_DEFAULTS[envLower]) {
      if (envLower === 'algorithm') html = renderTheoremLikeAlgorithm(ctx, env, content);
      else html = renderTheoremEnv(ctx, envLower, content);
    } else if (envLower === 'equation' || envLower === 'equation*' || envLower === 'align' || envLower === 'align*' ||
               envLower === 'gather' || envLower === 'gather*' || envLower === 'multline' || envLower === 'multline*' ||
               envLower === 'eqnarray' || envLower === 'eqnarray*' || envLower === 'flalign' || envLower === 'flalign*') {
      html = renderEquationBlock(ctx, content, { numbered: !envLower.endsWith('*'), env });
    } else if (envLower === 'displaymath') {
      html = renderEquationBlock(ctx, content, { numbered: false, env });
    } else if (envLower === 'math') {
      html = `<span class="tex-math">\\(${mathEsc(content)}\\)</span>`;
    } else if (envLower === 'verbatim' || envLower === 'verbatim*' || envLower === 'lstlisting' ||
               envLower === 'minted' || envLower === 'verbatim' || envLower === 'verbatim*' ||
               envLower === 'comment') {
      html = renderCodeEnv(ctx, envLower, content);
    } else if (envLower === 'quote' || envLower === 'quotation') {
      const inner = parseBlocks(ctx, content, { nested: true }).join('');
      html = `<blockquote class="paper-quote">${inner}</blockquote>`;
    } else if (envLower === 'verse') {
      const lines = content.split(/\\\\|\n/).map((l) => l.trim()).filter(Boolean);
      html = `<div class="paper-verse">${lines.map((l) => renderInline(l, ctx)).join('<br>')}</div>`;
    } else if (envLower === 'center' || envLower === 'flushleft' || envLower === 'flushright') {
      const inner = parseBlocks(ctx, content, { nested: true }).join('');
      if (/^<(figure|div class="equation")/.test(inner.trim()) && !/<\/figure>[\s\S]*\S/.test(inner.trim())) return { html: inner, end };
      const cls = envLower === 'center' ? 'paper-center' : (envLower === 'flushleft' ? 'paper-flushleft' : 'paper-flushright');
      html = `<div class="${cls}">${inner}</div>`;
    } else if (envLower === 'minipage') {
      const opt = readOptional(content, 0);
      let p = opt ? opt.end : 0;
      const w = readGroup(content, p);
      if (w) p = w.end;
      const inner = parseBlocks(ctx, content.slice(p), { nested: true }).join('');
      const width = w ? widthToCss(w.text) : '';
      html = `<div class="paper-minipage"${width ? ` style="width:${escAttr(width)}"` : ''}>${inner}</div>`;
    } else if (envLower === 'multicols' || envLower === 'multicols*') {
      const n = readGroup(content, 0);
      const inner = parseBlocks(ctx, n ? content.slice(n.end) : content, { nested: true }).join('');
      html = `<div class="paper-multicol">${inner}</div>`;
    } else if (envLower === 'titlepage') {
      html = (ctx.titleRendered ? '' : renderTitleBlock(ctx)) + parseBlocks(ctx, content, { nested: true }).join('');
    } else if (envLower === 'acknowledgments' || envLower === 'acknowledgements') {
      const inner = parseBlocks(ctx, content, { nested: true }).join('');
      html = `<div class="paper-acks"><div class="thm-head">${ctx.zh ? '致谢' : 'Acknowledgments'}.</div>${inner}</div>`;
    } else if (envLower === 'appendices' || envLower === 'appendix') {
      html = parseBlocks(ctx, content, { nested: true }).join('');
    } else if (envLower === 'tikzpicture' || envLower === 'picture' || envLower === 'asy' || envLower === 'pgfpicture') {
      html = `<div class="figure-placeholder wide"><b>TikZ / 绘图内容</b><code>需真实编译后显示</code></div>`;
    } else if (envLower === 'algorithm') {
      html = renderTheoremLikeAlgorithm(ctx, env, content);
    } else if (envLower === 'algorithmic' || envLower === 'algorithmicx') {
      html = renderTheoremLikeAlgorithm(ctx, env, content);
    } else if (envLower === 'document') {
      html = parseBlocks(ctx, content, { nested: true }).join('');
    } else if (envLower === 'small' || envLower === 'footnotesize' || envLower === 'scriptsize' ||
               envLower === 'large' || envLower === 'Large' || envLower === 'LARGE' ||
               envLower === 'spacing' || envLower === 'singlespace' || envLower === 'onehalfspacing' ||
               envLower === 'doublespace' || envLower === 'adjustbox' || envLower === 'landscape' ||
               envLower === 'samepage' || envLower === 'footnotesize') {
      html = parseBlocks(ctx, content, { nested: true }).join('');
    } else if (envLower === 'tcolorbox' || envLower === 'mdframed' || envLower === 'shaded' || envLower === 'leftbar' || envLower === 'framed') {
      const inner = parseBlocks(ctx, content, { nested: true }).join('');
      html = `<div class="paper-box">${inner}</div>`;
    } else {
      ctx.warnings.add(`暂不支持的环境 ${env}，已按普通段落显示。`);
      const inner = parseBlocks(ctx, content, { nested: true }).join('');
      html = `<div class="tex-env tex-env-${escAttr(safeId(envLower))}">${inner}</div>`;
    }
    return { html, end };
  }

  function parseBlocks(ctx, src, opts = {}) {
    const blocks = [];
    let para = '';
    const flush = () => {
      if (para.trim()) blocks.push(...renderProse(ctx, para, opts));
      para = '';
    };
    const S = String(src || '');
    let i = 0;
    while (i < S.length) {
      const ch = S[i];
      if (ch === '\n' || ch === '\r' || ch === ' ' || ch === '\t') {
        let j = i;
        let newlines = 0;
        while (j < S.length && (S[j] === '\n' || S[j] === '\r' || S[j] === ' ' || S[j] === '\t')) {
          if (S[j] === '\n') newlines++;
          j++;
        }
        if (newlines >= 2) flush();
        else if (para && !para.endsWith(' ')) para += ' ';
        i = j;
        continue;
      }
      if (ch === '\\') {
        if (S[i + 1] === '[') {
          flush();
          const d = findDisplayEnd(S, i);
          if (d) { blocks.push(renderEquationBlock(ctx, d.content, { numbered: false })); i = d.end; continue; }
          para += '\\[';
          i += 2;
          continue;
        }
        const cmd = readCommandName(S, i);
        if (!cmd) { para += S[i++]; continue; }
        const name = cmd.name;
        if (name === 'begin') {
          const g = readGroup(S, cmd.end);
          if (g) {
            flush();
            const res = renderEnvironment(ctx, S, i, opts);
            if (res && res.html) blocks.push(res.html);
            i = res ? res.end : g.end;
            continue;
          }
        }
        if (name === 'end') {
          const g = readGroup(S, cmd.end);
          i = g ? g.end : cmd.end;
          continue;
        }
        if (HEADING_NAMES.includes(name)) {
          flush();
          const h = parseHeading(ctx, S, i);
          if (h) {
            if (h.html) blocks.push(h.html);
            i = h.end;
            continue;
          }
        }
        if (name === 'maketitle') {
          flush();
          if (!ctx.titleRendered) {
            const t = renderTitleBlock(ctx);
            if (t) blocks.push(t);
          }
          i = cmd.end;
          continue;
        }
        if (name === 'tableofcontents') {
          flush();
          ctx.tocTokenCount = (ctx.tocTokenCount || 0) + 1;
          blocks.push('@@TOCBLOCK@@');
          i = cmd.end;
          continue;
        }
        if (name === 'appendix') {
          flush();
          ctx.appendix = true;
          ctx.counters.section = [0, 0, 0, 0];
          ctx.currentSectionNumber = '';
          i = cmd.end;
          continue;
        }
        if (name === 'bibliography') {
          flush();
          const g = readGroup(S, cmd.end);
          const b = renderBibliographyBlock(ctx);
          if (b) blocks.push(b);
          i = g ? g.end : cmd.end;
          continue;
        }
        if (name === 'printbibliography') {
          flush();
          let p = cmd.end;
          const opt = readOptional(S, p);
          if (opt) p = opt.end;
          const b = renderBibliographyBlock(ctx);
          if (b) blocks.push(b);
          i = p;
          continue;
        }
        if (name === 'bibliographystyle' || name === 'addbibresource') {
          const g = readGroup(S, cmd.end);
          i = g ? g.end : cmd.end;
          continue;
        }
        if (name === 'newpage' || name === 'clearpage' || name === 'cleardoublepage' || name === 'pagebreak') {
          flush();
          let p = cmd.end;
          const opt = readOptional(S, p);
          if (opt) p = opt.end;
          if (!opts.nested) blocks.push(pageBreakBlock());
          i = p;
          continue;
        }
        if (name === 'par') {
          flush();
          i = cmd.end;
          continue;
        }
        if (name === 'noindent') {
          para += '\\noindent ';
          i = cmd.end;
          continue;
        }
        if (name === 'vspace') {
          let p = cmd.end;
          const opt = readOptional(S, p);
          if (opt) p = opt.end;
          const g = readGroup(S, p);
          if (g) {
            if (!para.trim()) {
              const len = formatCssLength(g.text);
              if (len && !opts.nested) blocks.push(`<div class="paper-vspace" style="height:${escAttr(len)}"></div>`);
            }
            i = g.end;
            continue;
          }
        }
        if (name === 'hrule') {
          flush();
          if (!opts.nested) blocks.push('<hr class="paper-rule-line">');
          i = cmd.end;
          continue;
        }
        if (name === 'keywords') {
          flush();
          const g = readGroup(S, cmd.end);
          if (g) {
            const k = renderKeywords(ctx, g.text);
            if (k) blocks.push(k);
            i = g.end;
            continue;
          }
        }
        if (name === 'title' || name === 'author' || name === 'date') {
          const g = readGroup(S, cmd.end);
          i = g ? g.end : cmd.end;
          continue;
        }
        if (name === 'addcontentsline') {
          const a = readGroup(S, cmd.end);
          if (a) {
            const b = readGroup(S, a.end);
            if (b) {
              const c = readGroup(S, b.end);
              if (c) {
                const levelArg = a.text.trim();
                const level = levelArg === 'chapter' ? 1 : levelArg === 'section' ? 1 : levelArg === 'subsection' ? 2 : 2;
                ctx.tocItems.push({
                  level,
                  number: '',
                  title: plainText(c.text),
                  id: ctx.currentSectionId || `sec-${ctx.headingSeq}`
                });
                i = c.end;
                continue;
              }
            }
          }
        }
        if (name === 'setcounter' || name === 'addtocounter') {
          const a = readGroup(S, cmd.end);
          if (a) {
            const b = readGroup(S, a.end);
            if (b) {
              const counter = a.text.trim();
              const val = parseInt(b.text.trim(), 10);
              if (!Number.isNaN(val)) {
                if (counter === 'equation') ctx.counters.equation = name === 'addtocounter' ? ctx.counters.equation + val : val;
                if (counter === 'figure') ctx.counters.figure = name === 'addtocounter' ? ctx.counters.figure + val : val;
                if (counter === 'table') ctx.counters.table = name === 'addtocounter' ? ctx.counters.table + val : val;
              }
              i = b.end;
              continue;
            }
          }
        }
        if (name === 'setlength' || name === 'addtolength') {
          const a = readGroup(S, cmd.end);
          if (a) {
            const b = readGroup(S, a.end);
            if (b) { i = b.end; continue; }
          }
        }
        if (NOOP_ARG_COMMANDS[name] && name !== 'includegraphics' && name !== 'color') {
          const p = consumeGroups(S, cmd.end, NOOP_ARG_COMMANDS[name]);
          i = p;
          continue;
        }
        if (name === 'includegraphics') {
          const opt = readOptional(S, cmd.end);
          let p = opt ? opt.end : cmd.end;
          const g = readGroup(S, p);
          if (g) {
            if (!para.trim()) {
              const num = ++ctx.counters.figure;
              ctx.stats.figures++;
              const capLabel = ctx.zh ? '图' : 'Figure';
              blocks.push(`<figure class="paper-figure" id="fig-${num}"><div class="figure-media">${imageBlockHtml(ctx, g.text, opt ? opt.text : '')}</div></figure>`);
              i = g.end;
              continue;
            }
            para += S.slice(i, g.end);
            i = g.end;
            continue;
          }
        }
        para += S.slice(i, cmd.end);
        i = cmd.end;
        continue;
      }
      if (ch === '$' && S.startsWith('$$', i)) {
        flush();
        const d = findDisplayEnd(S, i);
        if (d) {
          blocks.push(renderEquationBlock(ctx, d.content, { numbered: false }));
          i = d.end;
          continue;
        }
      }
      para += ch;
      i++;
    }
    flush();
    return blocks;
  }
