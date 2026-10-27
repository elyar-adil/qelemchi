/* ==========================================================================
   Qelemchi · LaTeX preview engine (part 3: inline rendering)
   ========================================================================== */

  const IGNORED_INLINE_COMMANDS = new Set([
    'noindent', 'indent', 'centering', 'raggedright', 'raggedleft', 'raggedbottom',
    'small', 'footnotesize', 'scriptsize', 'tiny', 'large', 'Large', 'LARGE',
    'huge', 'Huge', 'normalsize', 'bfseries', 'mdseries', 'itshape', 'upshape',
    'slshape', 'scshape', 'rmfamily', 'sffamily', 'ttfamily', 'selectfont',
    'protect', 'relax', 'hfill', 'vfill', 'hfil', 'vfil', 'null', 'clearpage',
    'newpage', 'pagebreak', 'nopagebreak', 'linebreak', 'nolinebreak', 'par',
    'displaystyle', 'textstyle', 'scriptstyle', 'scriptscriptstyle',
    'allowbreak', 'nobreak', 'sloppy', 'fussy', 'maketitle', 'tableofcontents',
    'appendix', 'bibliographystyle', 'printbibliography', 'bibliography',
    'pagestyle', 'thispagestyle', 'pagenumbering', 'markboth', 'markright',
    'setlength', 'addtolength', 'setcounter', 'addtocounter', 'stepcounter',
    'refstepcounter', 'vspace', 'hspace', 'smallskip', 'medskip', 'bigskip',
    'frontmatter', 'mainmatter', 'backmatter', 'appendixpage', 'cleardoublepage',
    'onecolumn', 'twocolumn', 'columnbreak', 'balance', 'raggedcolumns',
    'begin', 'end', 'item', 'hline', 'toprule', 'midrule', 'bottomrule',
    'addlinespace', 'arrayrulecolor', 'rowcolor', 'cellcolor', 'cmidrule',
    'cline', 'multicolumn', 'multirow', 'makecell', 'shortstack',
    'caption', 'captionof', 'subcaption', 'centering', 'thanks',
    'hypersetup', 'geometry', 'graphicspath', 'DeclareMathOperator',
    'newtheorem', 'definecolor', 'color', 'normalcolor', 'pagecolor',
    'eject', 'vfil', 'hfil', 'vss', 'hss', 'strut', 'mathstrut', 'phantom',
    'hphantom', 'vphantom', 'smash', 'label', 'index', 'glossary',
    'footnotemark', 'footnotetext', 'marginpar', 'todo', 'missingfigure',
    'addcontentsline', 'addtocontents', 'numberwithin', 'captionsetup',
    'setkomafont', 'KOMAoption', 'sisetup', 'sisetup', 'hyphenation',
    'FloatBarrier', 'clearpage', 'samepage', 'nopagebreak', 'vadjust'
  ]);

  function smartText(s) {
    return String(s)
      .replace(/[ \t]+/g, ' ')
      .replace(/---/g, '—')
      .replace(/--/g, '–')
      .replace(/``/g, '“')
      .replace(/''/g, '”')
      .replace(/!`/g, '¡');
  }

  function decodeUrlArg(raw) {
    return String(raw || '')
      .replace(/\\%/g, '%')
      .replace(/\\#/g, '#')
      .replace(/\\_/g, '_')
      .replace(/\\&/g, '&')
      .replace(/\\~/g, '~')
      .replace(/\\\{/g, '{')
      .replace(/\\\}/g, '}')
      .trim();
  }

  function safeLink(raw) {
    const s = decodeUrlArg(raw);
    if (!s) return null;
    if (/^https?:\/\//i.test(s) || /^mailto:/i.test(s)) return s;
    if (/^www\./i.test(s)) return 'https://' + s;
    return null;
  }

  function colorCss(ctx, raw) {
    const name = String(raw || '').replace(/^\\/, '').trim();
    if (!name) return '';
    if (ctx.colors.has(name)) return ctx.colors.get(name);
    if (/^#[0-9a-f]{3,8}$/i.test(name)) return name;
    if (/^rgb(a)?\(/i.test(name)) return name;
    return '';
  }

  function addFootnote(html, ctx) {
    if (ctx.inFootnote) return html;
    const num = ++ctx.footnoteCounter;
    const note = `<span class="fn-note" id="fn-${num}"><span class="fn-num">${num}</span><span>${html}</span></span>`;
    if (Array.isArray(ctx.noteSink)) ctx.noteSink.push(note);
    else ctx.footnotes.push(note);
    return `<a class="paper-fn-ref" href="#fn-${num}" id="fnref-${num}">${num}</a>`;
  }

  function registerLabel(ctx, rawKey, kind, number, title) {
    const key = String(rawKey || '').trim();
    if (!key) return '';
    const id = `lbl-${safeId(key)}`;
    if (!ctx.labels.has(key)) {
      ctx.labels.set(key, {
        key,
        kind: kind || ctx.currentSectionKind || 'sec',
        number: number != null ? String(number) : (ctx.currentSectionNumber || '?'),
        title: title || ctx.currentSectionTitle || '',
        id
      });
    } else {
      const existing = ctx.labels.get(key);
      if ((!existing.number || existing.number === '?') && number != null) existing.number = String(number);
    }
    return `<span class="tex-label" id="${escAttr(id)}"></span>`;
  }

  function refToken(kind, key) {
    return `@@TREF|${kind}|${encodeURIComponent(String(key || '').trim())}@@`;
  }

  function renderMathInline(raw, display) {
    const cleaned = String(raw || '')
      .replace(/\\label\s*\{[^}]*\}/g, '')
      .replace(/\\tag\*?\s*\{[^}]*\}/g, '');
    const open = display ? '\\[' : '\\(';
    const close = display ? '\\]' : '\\)';
    return `<span class="tex-math${display ? ' tex-display' : ''}">${open}${mathEsc(cleaned)}${close}</span>`;
  }

  function findMathClose(s, start, close) {
    let i = start;
    while (i < s.length) {
      if (s[i] === '\\') {
        if (s.startsWith(close, i)) return i;
        i += 2;
        continue;
      }
      if (s.startsWith(close, i)) return i;
      i++;
    }
    return -1;
  }

  function findDollarClose(s, start) {
    let i = start;
    while (i < s.length) {
      if (s[i] === '\\') { i += 2; continue; }
      if (s[i] === '$') return i;
      i++;
    }
    return -1;
  }

  function citationHtml(keys, ctx, style, pre, post) {
    const parts = [];
    const authors = [];
    const years = [];
    for (const key of keys) {
      const info = ctx.citeMap.get(key);
      if (!info) {
        ctx.warnings.add(`引用键不存在：${key}`);
        parts.push('<span class="tex-cite missing">[?]</span>');
        continue;
      }
      const n = info.num;
      const entry = info.entry;
      parts.push(`<a class="tex-cite" href="#bib-${n}">${n}</a>`);
      if (entry) {
        authors.push(shortAuthor(entry.fields.author || entry.fields.editor || ''));
        years.push(entry.fields.year || '');
      } else if (info.manual) {
        authors.push('');
        years.push('');
      }
    }
    if (style === 'citeauthor') {
      return esc(authors.filter(Boolean).join('; ')) || '?';
    }
    if (style === 'citeyear' || style === 'citeyearpar') {
      const y = years.filter(Boolean).join('; ');
      return style === 'citeyearpar' ? `(${esc(y)})` : esc(y);
    }
    if (!parts.length) return '<span class="tex-cite missing">[?]</span>';
    const core = parts.join(', ');
    let html;
    if (style === 'citealp' || style === 'citealt') html = core;
    else html = `[${core}]`;
    if (style === 'citet' || style === 'textcite') {
      const a = authors.filter(Boolean).join('; ');
      html = a ? `${esc(a)} ${html}` : html;
    }
    if (pre || post) {
      const pieces = [];
      if (pre) pieces.push(esc(plainText(pre)));
      if (post) pieces.push(esc(plainText(post)));
      html = `${html}<span class="cite-note"> (${pieces.join('; ')})</span>`;
    }
    return html;
  }

  function renderInlineImage(pathRaw, optsRaw, ctx) {
    const path = String(pathRaw || '').trim();
    const resolved = resolveAsset(path, ctx.mainPath, ctx);
    if (!resolved) {
      ctx.warnings.add(`找不到图片：${path}`);
      return `<span class="tex-inline-img-missing" title="找不到图片">[${esc(basename(path) || path)}]</span>`;
    }
    const url = ctx.assets.get(resolved);
    if (!url) {
      return `<span class="tex-inline-img-missing" title="该格式需真实编译后显示">[${esc(basename(resolved))}]</span>`;
    }
    const opts = parseKeyValueOptions(optsRaw || '');
    const styles = [];
    const w = widthToCss(opts.width || '');
    const h = opts.height ? formatCssLength(opts.height) : '';
    if (w) styles.push(`width:${w}`);
    if (h) styles.push(`height:${h}`);
    if (opts.scale) styles.push(`transform:scale(${Math.max(0.05, Math.min(4, Number(opts.scale) || 1))})`);
    return `<img class="tex-inline-img" src="${escAttr(url)}" alt="${escAttr(basename(resolved))}"${styles.length ? ` style="${styles.join(';')}"` : ''}>`;
  }

  function parseKeyValueOptions(raw) {
    const out = {};
    for (const part of String(raw || '').split(',')) {
      const m = /^\s*([A-Za-z]+)\s*=\s*([\s\S]+?)\s*$/.exec(part);
      if (m) out[m[1].toLowerCase()] = m[2].replace(/^[{"]|[}"]$/g, '');
      else {
        const flag = part.trim().toLowerCase();
        if (flag) out[flag] = true;
      }
    }
    return out;
  }

  function renderInlineCommand(s, i, ctx) {
    const cmd = readCommandName(s, i);
    if (!cmd) return { html: esc(s[i]), end: i + 1 };
    const name = cmd.name;
    let p = cmd.end;
    if (/^[A-Za-z]/.test(name) && s[p] === '*') p++;
    const readArg = (pos) => {
      const g = readGroup(s, pos);
      return g ? { raw: g.text, end: g.end } : null;
    };
    const readOpt = (pos) => {
      const g = readOptional(s, pos);
      return g ? { raw: g.text, end: g.end } : null;
    };
    const fail = () => ({ html: esc(s.slice(i, p)), end: p });

    if (name === '\\') {
      const opt = readOpt(p);
      if (opt) p = opt.end;
      return { html: '<br>', end: p };
    }
    if (name === ' ') return { html: ' ', end: p };
    if (name === '\n') return { html: ' ', end: p };

    if (name === '(') {
      const close = findMathClose(s, p, '\\)');
      if (close >= 0) return { html: renderMathInline(s.slice(p, close), false), end: close + 2 };
      return { html: esc('('), end: p };
    }
    if (name === '[') {
      const close = findMathClose(s, p, '\\]');
      if (close >= 0) return { html: renderMathInline(s.slice(p, close), true), end: close + 2 };
      return { html: esc('['), end: p };
    }
    if (name === ')' || name === ']') return { html: '', end: p };

    const literalMap = { '%': '%', '&': '&', '_': '_', '#': '#', '$': '$', '{': '{', '}': '}' };
    if (literalMap[name]) return { html: esc(literalMap[name]), end: p };
    if (name === ',' || name === ';' || name === ':' || name === '!') {
      return { html: name === '!' ? '' : ' ', end: p };
    }
    if (name === '/' || name === '-' || name === '@') return { html: '', end: p };

    if (name === 'verb' || name === 'lstinline') {
      let q = p;
      let opt = null;
      if (name === 'lstinline') {
        opt = readOpt(q);
        if (opt) q = opt.end;
      }
      if (s[q] === '{') {
        const g = readArg(q);
        if (g) return { html: `<code class="tex-inline-code">${esc(g.raw)}</code>`, end: g.end };
      }
      const delim = s[q];
      if (!delim || /[A-Za-z\s]/.test(delim)) return fail();
      const end = s.indexOf(delim, q + 1);
      if (end < 0) return fail();
      return { html: `<code class="tex-inline-code">${esc(s.slice(q + 1, end))}</code>`, end: end + 1 };
    }

    if (name === 'mintinline') {
      const lang = readArg(p);
      if (!lang) return fail();
      const g = readArg(lang.end);
      if (!g) return fail();
      return { html: `<code class="tex-inline-code">${esc(g.raw)}</code>`, end: g.end };
    }

    if (ACCENTS[name] && name.length === 1) {
      let base = '';
      let q = p;
      if (s[q] === '{') {
        const g = readArg(q);
        if (g) { base = g.raw; q = g.end; }
      } else if (q < s.length && s[q] !== '\\') {
        base = s[q++];
      }
      if (!base) return { html: esc(name), end: p };
      const first = base[0];
      const mapped = ACCENTS[name][first] || first;
      return { html: esc(mapped + base.slice(1)), end: q };
    }

    const simpleFormatting = {
      textbf: ['strong', ''], mathbf: ['strong', ''], bf: ['strong', ''],
      textit: ['em', ''], emph: ['em', ''], textsl: ['em', ''], mathit: ['em', ''],
      textsc: ['span', 'tex-smallcaps'], textsf: ['span', 'tex-sans'], mathsf: ['span', 'tex-sans'],
      textrm: ['span', 'tex-roman'], mathrm: ['span', 'tex-roman'], textnormal: ['span', ''],
      textup: ['span', ''], textmd: ['span', ''],
      underline: ['u', ''], uline: ['u', ''], sout: ['s', ''], st: ['s', ''],
      textsuperscript: ['sup', ''], textsubscript: ['sub', '']
    };
    if (simpleFormatting[name]) {
      const g = readArg(p);
      if (!g) return fail();
      const [tag, cls] = simpleFormatting[name];
      return { html: `<${tag}${cls ? ` class="${cls}"` : ''}>${renderInline(g.raw, ctx)}</${tag}>`, end: g.end };
    }

    if (name === 'texttt' || name === 'mathtt') {
      const g = readArg(p);
      if (!g) return fail();
      return { html: `<code class="tex-inline-code">${renderInline(g.raw, ctx)}</code>`, end: g.end };
    }

    if (name === 'textcolor' || name === 'colorbox' || name === 'fcolorbox') {
      const a = readArg(p);
      if (!a) return fail();
      const b = readArg(a.end);
      if (!b) return fail();
      if (name === 'textcolor') {
        const css = colorCss(ctx, a.raw);
        return { html: css ? `<span style="color:${escAttr(css)}">${renderInline(b.raw, ctx)}</span>` : renderInline(b.raw, ctx), end: b.end };
      }
      if (name === 'colorbox') {
        const css = colorCss(ctx, a.raw);
        return { html: css ? `<span style="background:${escAttr(css)};padding:0 .18em">${renderInline(b.raw, ctx)}</span>` : renderInline(b.raw, ctx), end: b.end };
      }
      const c = readArg(b.end);
      if (!c) return fail();
      const bg = colorCss(ctx, b.raw);
      const fg = colorCss(ctx, a.raw);
      return { html: `<span style="border:1px solid ${escAttr(fg || 'currentColor')};background:${escAttr(bg || 'transparent')};padding:0 .2em">${renderInline(c.raw, ctx)}</span>`, end: c.end };
    }

    if (name === 'color') {
      const g = readArg(p);
      return g ? { html: '', end: g.end } : fail();
    }

    if (name === 'href') {
      const a = readArg(p);
      if (!a) return fail();
      const b = readArg(a.end);
      if (!b) return fail();
      const url = safeLink(a.raw);
      const label = renderInline(b.raw, ctx);
      if (!url) return { html: `<span class="tex-href-broken" title="不支持或无效的链接">${label}</span>`, end: b.end };
      return { html: `<a class="tex-link" href="${escAttr(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`, end: b.end };
    }

    if (name === 'url' || name === 'nolinkurl') {
      const g = readArg(p);
      if (!g) return fail();
      const url = safeLink(g.raw);
      const txt = decodeUrlArg(g.raw);
      if (name === 'nolinkurl' || !url) return { html: `<span class="tex-url">${esc(txt)}</span>`, end: g.end };
      return { html: `<a class="tex-link tex-url" href="${escAttr(url)}" target="_blank" rel="noopener noreferrer">${esc(txt)}</a>`, end: g.end };
    }

    if (name === 'footnote' || name === 'thanks') {
      const g = readArg(p);
      if (!g) return fail();
      const prevIn = ctx.inFootnote;
      ctx.inFootnote = true;
      const body = renderInline(g.raw, ctx);
      ctx.inFootnote = prevIn;
      return { html: addFootnote(body, ctx), end: g.end };
    }

    if (name === 'footnotetext') {
      const g = readArg(p);
      if (!g) return fail();
      const prevSink = ctx.noteSink;
      const notes = [];
      ctx.noteSink = notes;
      const body = renderInline(g.raw, ctx);
      ctx.noteSink = prevSink;
      const num = ++ctx.footnoteCounter;
      if (Array.isArray(prevSink)) prevSink.push(`<span class="fn-note" id="fn-${num}"><span class="fn-num">${num}</span><span>${body}</span></span>`);
      return { html: '', end: g.end };
    }

    if (name === 'footnotemark') {
      const opt = readOpt(p);
      if (opt) p = opt.end;
      const num = ctx.footnoteCounter || 1;
      return { html: `<sup class="paper-fn-ref">${num}</sup>`, end: p };
    }

    if (name === 'label') {
      const g = readArg(p);
      if (!g) return fail();
      return { html: registerLabel(ctx, g.raw, 'sec', ctx.currentSectionNumber || '?', ctx.currentSectionTitle || ''), end: g.end };
    }

    if (['ref', 'eqref', 'autoref', 'cref', 'Cref', 'vref', 'nameref', 'pageref'].includes(name)) {
      const g = readArg(p);
      if (!g) return fail();
      const kind = name === 'Cref' ? 'cref' : name;
      const keys = parseKeyList(g.raw);
      if (name === 'pageref') {
        return {
          html: keys.map((key) => {
            const label = ctx.labels.get(key);
            if (!label) ctx.warnings.add(`交叉引用不存在：${key}`);
            return `<a class="xref page-xref${label ? '' : ' missing'}" href="${label ? '#' + escAttr(label.id) : '#'}" data-page-ref="${escAttr(key)}">${label ? '—' : '??'}</a>`;
          }).join(', '),
          end: g.end
        };
      }
      if (name === 'nameref') {
        return { html: keys.map((key) => refToken('name', key)).join(', '), end: g.end };
      }
      return { html: keys.map((key) => refToken(kind, key)).join(', '), end: g.end };
    }

    if (name === 'cite' || name === 'citep' || name === 'citet' || name === 'citealp' ||
        name === 'citealt' || name === 'citeauthor' || name === 'citeyear' || name === 'citeyearpar' ||
        name === 'nocite' || name === 'parencite' || name === 'textcite' || name === 'autocite' ||
        name === 'footcite') {
      if (name === 'nocite') {
        const g = readArg(p);
        return { html: '', end: g ? g.end : p };
      }
      let pre = '';
      let post = '';
      const opt1 = readOpt(p);
      if (opt1) { pre = opt1.raw; p = opt1.end; }
      const opt2 = readOpt(p);
      if (opt2) { post = opt2.raw; p = opt2.end; }
      const g = readArg(p);
      if (!g) return fail();
      const style = name === 'parencite' || name === 'autocite' || name === 'footcite' ? 'cite' : name;
      return { html: citationHtml(parseKeyList(g.raw), ctx, style, pre, post), end: g.end };
    }

    if (name === 'includegraphics') {
      const opt = readOpt(p);
      if (opt) p = opt.end;
      const g = readArg(p);
      if (!g) return fail();
      return { html: renderInlineImage(g.raw, opt ? opt.raw : '', ctx), end: g.end };
    }

    if (name === 'ensuremath') {
      const g = readArg(p);
      if (!g) return fail();
      return { html: renderMathInline(g.raw, false), end: g.end };
    }

    if (name === 'texorpdfstring') {
      const a = readArg(p);
      if (!a) return fail();
      const b = readArg(a.end);
      if (!b) return fail();
      return { html: renderInline(a.raw, ctx), end: b.end };
    }

    if (name === 'text' || name === 'mbox' || name === 'hbox' || name === 'makebox' || name === 'framebox') {
      const g = readArg(p);
      if (!g) return fail();
      return { html: name === 'framebox' ? `<span class="tex-fbox">${renderInline(g.raw, ctx)}</span>` : renderInline(g.raw, ctx), end: g.end };
    }

    if (name === 'makecell' || name === 'shortstack') {
      const opt = readOpt(p);
      if (opt) p = opt.end;
      const g = readArg(p);
      if (!g) return fail();
      const html = renderInline(g.raw, ctx).replace(/\\\\/g, '<br>');
      return { html, end: g.end };
    }

    if (name === 'multirow') {
      const a = readArg(p);
      if (!a) return fail();
      const b = readArg(a.end);
      if (!b) return fail();
      const c = readArg(b.end);
      if (!c) return fail();
      return { html: renderInline(c.raw, ctx), end: c.end };
    }

    if (name === 'multicolumn') {
      const a = readArg(p);
      if (!a) return fail();
      const b = readArg(a.end);
      if (!b) return fail();
      const c = readArg(b.end);
      if (!c) return fail();
      return { html: renderInline(c.raw, ctx), end: c.end };
    }

    if (name === 'raisebox' || name === 'parbox' || name === 'scalebox' || name === 'resizebox') {
      const args = [];
      let q = p;
      if (name === 'raisebox') {
        const a = readArg(q); if (!a) return fail(); q = a.end;
        const opt = readOpt(q); if (opt) q = opt.end;
        const b = readArg(q); if (!b) return fail();
        return { html: renderInline(b.raw, ctx), end: b.end };
      }
      if (name === 'parbox') {
        const opt = readOpt(q); if (opt) q = opt.end;
        const a = readArg(q); if (!a) return fail(); q = a.end;
        const b = readArg(q); if (!b) return fail();
        return { html: `<span class="tex-parbox">${renderInline(b.raw, ctx)}</span>`, end: b.end };
      }
      if (name === 'scalebox') {
        const a = readArg(q); if (!a) return fail(); q = a.end;
        const opt = readOpt(q); if (opt) q = opt.end;
        const b = readArg(q); if (!b) return fail();
        const scale = Math.max(0.1, Math.min(4, Number(a.raw) || 1));
        return { html: `<span style="display:inline-block;transform:scale(${scale})">${renderInline(b.raw, ctx)}</span>`, end: b.end };
      }
      const a = readArg(q); if (!a) return fail(); q = a.end;
      const b = readArg(q); if (!b) return fail(); q = b.end;
      const c = readArg(q); if (!c) return fail();
      return { html: renderInline(c.raw, ctx), end: c.end };
    }

    if (name === 'rule') {
      const a = readArg(p);
      if (!a) return fail();
      const b = readArg(a.end);
      if (!b) return fail();
      const w = formatCssLength(a.raw) || '1em';
      const h = formatCssLength(b.raw) || '.4pt';
      return { html: `<span class="tex-rule" style="display:inline-block;width:${escAttr(w)};height:${escAttr(h)};background:currentColor;vertical-align:middle"></span>`, end: b.end };
    }

    if (name === 'vspace' || name === 'hspace') {
      const opt = readOpt(p);
      if (opt) p = opt.end;
      const g = readArg(p);
      if (!g) return fail();
      const len = formatCssLength(g.raw);
      if (!len) return { html: '', end: g.end };
      if (name === 'vspace') {
        return { html: `<span style="display:block;height:${escAttr(len)}"></span>`, end: g.end };
      }
      return { html: `<span style="display:inline-block;width:${escAttr(len)}"></span>`, end: g.end };
    }

    if (name === 'newline' || name === 'linebreak' || name === 'pagebreak' || name === 'nopagebreak') {
      const opt = readOpt(p);
      if (opt) p = opt.end;
      return { html: name === 'newline' || name === 'linebreak' ? '<br>' : '', end: p };
    }

    if (name === 'par') return { html: '<br><br>', end: p };

    if (name === 'today') return { html: esc(todayString(ctx.zh)), end: p };

    if (name === 'and') return { html: '<span class="author-sep"> · </span>', end: p };

    if (name === 'ldots' || name === 'dots' || name === 'textellipsis') {
      return { html: '…', end: p };
    }

    if (name === 'quad') return { html: ' ', end: p };
    if (name === 'qquad') return { html: '  ', end: p };
    if (name === 'enspace' || name === 'thinspace') return { html: ' ', end: p };
    if (name === 'negthinspace') return { html: '', end: p };
    if (name === 'noindent') return { html: '', end: p };

    if (SYMBOLS[name]) return { html: esc(SYMBOLS[name]), end: p };

    if (name === 'textbackslash' || name === 'textasciitilde' || name === 'textless' ||
        name === 'textgreater' || name === 'textbar' || name === 'textunderscore') {
      return { html: esc(SYMBOLS[name] || ''), end: p };
    }

    if (name === 'begin' || name === 'end') {
      const g = readArg(p);
      if (!g) return fail();
      return { html: '', end: g.end };
    }

    if (name === 'item') {
      const opt = readOpt(p);
      if (opt) p = opt.end;
      return { html: '<span class="inline-item-mark">•</span> ', end: p };
    }

    if (name === 'setlength' || name === 'addtolength' || name === 'setcounter' || name === 'addtocounter') {
      const a = readArg(p);
      if (!a) return fail();
      const b = readArg(a.end);
      return { html: '', end: b ? b.end : a.end };
    }

    if (name === 'index' || name === 'glossary' || name === 'captionsetup' || name === 'hypersetup') {
      const g = readArg(p);
      return { html: '', end: g ? g.end : p };
    }

    if (name === 'cline' || name === 'cmidrule') {
      const opt = readOpt(p);
      if (opt) p = opt.end;
      const g = readArg(p);
      return { html: '', end: g ? g.end : p };
    }

    if (name === 'caption' || name === 'captionof') {
      const opt = readOpt(p);
      if (opt) p = opt.end;
      if (name === 'captionof') {
        const a = readArg(p);
        if (!a) return fail();
        const b = readArg(a.end);
        return { html: '', end: b ? b.end : a.end };
      }
      const g = readArg(p);
      return { html: '', end: g ? g.end : p };
    }

    if (name === 'addcontentsline') {
      const a = readArg(p);
      if (!a) return fail();
      const b = readArg(a.end);
      if (!b) return fail();
      const c = readArg(b.end);
      return { html: '', end: c ? c.end : b.end };
    }

    if (name === 'begin' || name === 'end' || name === 'hline' || name === 'toprule' ||
        name === 'midrule' || name === 'bottomrule' || name === 'addlinespace') {
      return { html: '', end: p };
    }

    if (IGNORED_INLINE_COMMANDS.has(name)) {
      return { html: '', end: p };
    }

    // Unknown command: show it as a diagnostic instead of silently dropping
    // content. Arguments are left in the stream, so their text still appears.
    const count = (ctx.unknown.get(name) || 0) + 1;
    ctx.unknown.set(name, count);
    if (count === 1 && ctx.unknownCount < 10) {
      ctx.unknownCount++;
      ctx.warnings.add(`暂不支持的命令 \\${name}，已保留其后面的文字。`);
    }
    return {
      html: `<span class="tex-unknown" title="预览暂不支持 \\${escAttr(name)}">\\${esc(name)}</span>`,
      end: p
    };
  }

  function renderInline(src, ctx) {
    if (src == null) return '';
    const s = String(src);
    let out = '';
    let i = 0;
    while (i < s.length) {
      const ch = s[i];
      if (ch === '\\') {
        const r = renderInlineCommand(s, i, ctx);
        out += r.html;
        i = r.end > i ? r.end : i + 1;
        continue;
      }
      if (ch === '$') {
        if (s.startsWith('$$', i)) {
          const close = s.indexOf('$$', i + 2);
          if (close >= 0) {
            out += renderMathInline(s.slice(i + 2, close), true);
            i = close + 2;
            continue;
          }
        }
        const close = findDollarClose(s, i + 1);
        if (close >= 0) {
          out += renderMathInline(s.slice(i + 1, close), false);
          i = close + 1;
          continue;
        }
        out += esc('$');
        i++;
        continue;
      }
      if (ch === '{' || ch === '}') { i++; continue; }
      if (ch === '~') { out += '\u00a0'; i++; continue; }
      if (ch === '\n') { out += ' '; i++; continue; }
      let j = i;
      while (j < s.length && !'\\${}~'.includes(s[j]) && s[j] !== '\n') j++;
      out += esc(smartText(s.slice(i, j)));
      i = j;
    }
    return out;
  }

  function renderInlineWithNotes(src, ctx) {
    const prev = ctx.noteSink;
    const notes = [];
    ctx.noteSink = notes;
    const html = renderInline(src, ctx);
    ctx.noteSink = prev;
    return { html, notes };
  }

  function notesHtml(notes) {
    if (!notes || !notes.length) return '';
    return `<span class="block-notes">${notes.join('')}</span>`;
  }
