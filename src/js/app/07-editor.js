/* ==========================================================================
   Qelemchi · CodeMirror editor
   ========================================================================== */

let editor = null;
let editorSuppress = false;

const EDITOR_MODES = {
  '.tex': 'stex',
  '.ltx': 'stex',
  '.latex': 'stex',
  '.cls': 'stex',
  '.sty': 'stex',
  '.bib': 'stex',
  '.tikz': 'stex'
};

function initEditor() {
  const host = $('#editor');
  if (!host || !window.CodeMirror) {
    const fallback = $('#editor-fallback');
    if (fallback) {
      fallback.style.display = 'block';
      fallback.addEventListener('input', () => {
        const file = currentFile();
        if (!file) return;
        file.text = fallback.value;
        markDirty(file.path);
        schedulePreview();
        renderSaveState();
        refreshDirtyIndicators();
      });
    }
    return;
  }
  const fallback = $('#editor-fallback');
  if (fallback) fallback.style.display = 'none';
  editor = CodeMirror(host, {
    value: '',
    mode: 'stex',
    lineNumbers: state.settings.lineNumbers !== false,
    lineWrapping: state.settings.lineWrapping !== false,
    indentUnit: 2,
    tabSize: 2,
    indentWithTabs: false,
    autoCloseBrackets: true,
    matchBrackets: true,
    styleActiveLine: true,
    foldGutter: true,
    gutters: ['CodeMirror-linenumbers', 'CodeMirror-foldgutter'],
    extraKeys: {
      'Cmd-S': () => saveProject(),
      'Ctrl-S': () => saveProject(),
      'Cmd-K': () => openPalette(),
      'Ctrl-K': () => openPalette(),
      'Cmd-/': 'toggleComment',
      'Ctrl-/': 'toggleComment',
      'Cmd-B': () => applyFormat('bold'),
      'Ctrl-B': () => applyFormat('bold'),
      'Cmd-I': () => applyFormat('italic'),
      'Ctrl-I': () => applyFormat('italic'),
      'Cmd-Enter': () => openCompile(),
      'Ctrl-Enter': () => openCompile(),
      'Shift-Cmd-F': () => focusProjectSearch(),
      'Shift-Ctrl-F': () => focusProjectSearch(),
      'Ctrl-Space': 'autocomplete'
    }
  });
  state.editorReady = true;
  editor.on('change', () => {
    if (editorSuppress) return;
    const file = currentFile();
    if (!file || file.text == null) return;
    file.text = editor.getValue();
    file.size = new Blob([file.text]).size;
    markDirty(file.path);
    updateEditorMeta();
    renderSaveState();
    refreshDirtyIndicators();
    schedulePreview();
    if (state.mode === 'demo') persistDemoSoon();
    if (state.mode === 'github') maybeSaveDraftSoon();
  });
  editor.on('cursorActivity', () => {
    if (!editor) return;
    const pos = editor.getCursor();
    state.lastCursor = { line: pos.line + 1, column: pos.ch + 1 };
    const cursor = $('#cursor-pos');
    if (cursor) cursor.textContent = `Ln ${pos.line + 1}, Col ${pos.ch + 1}`;
  });
  editor.on('focus', () => {
    document.body.classList.add('editor-focus');
  });
  editor.on('blur', () => {
    document.body.classList.remove('editor-focus');
  });
  applyEditorSettings();
  const active = currentFile();
  if (active && active.text != null) openFile(active.path);
}

function applyEditorSettings() {
  if (!editor) return;
  editor.setOption('lineNumbers', state.settings.lineNumbers !== false);
  editor.setOption('lineWrapping', state.settings.lineWrapping !== false);
  editor.setOption('tabSize', 2);
  document.documentElement.style.setProperty('--editor-font-size', `${state.settings.fontSize || 13.5}px`);
  setTimeout(() => { try { editor.refresh(); } catch (e) { /* ignore */ } }, 40);
}

function setEditorReadOnly(flag) {
  if (editor) editor.setOption('readOnly', flag ? 'nocursor' : false);
}

function wysiwygAvailable(file) {
  return !!(file && file.text != null && typeof wysIsEditablePath === 'function' && wysIsEditablePath(file.path));
}

function editorIsVisual() {
  return state.editorMode === 'wysiwyg' && typeof wysiwygCurrentPath === 'function' && !!wysiwygCurrentPath();
}

function showWysiwygHost(show) {
  const host = $('#wysiwyg');
  if (host) host.hidden = !show;
}

function setEditorMode(mode, opts = {}) {
  const next = mode === 'wysiwyg' ? 'wysiwyg' : 'source';
  const file = currentFile();
  if (next === 'wysiwyg' && !wysiwygAvailable(file)) {
    toast({
      type: 'info',
      title: '仅 LaTeX 文件支持所见即所得',
      desc: file ? `${pathBase(file.path)} 需要在源码模式中编辑。` : '先在文件树中打开一个 .tex 文件。'
    });
    return;
  }
  state.editorMode = next;
  state.settings.editorMode = next;
  if (!opts.silent) {
    try { saveSettings(state.settings); } catch (e) { /* ignore */ }
  }
  const tabs = $('#editor-mode-tabs');
  if (tabs) {
    tabs.querySelectorAll('[data-mode]').forEach((btn) => {
      const on = btn.dataset.mode === next;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  }
  const wrap = $('#editor-wrap');
  if (wrap) wrap.dataset.mode = next;

  if (next === 'wysiwyg') {
    if (editor) editor.getWrapperElement().style.display = 'none';
    const fallback = $('#editor-fallback');
    if (fallback) fallback.style.display = 'none';
    showWysiwygHost(true);
    if (file) {
      wysiwygStart(file.path, opts.line != null ? { focusPathLine: opts.line } : {});
    }
    if (window.innerWidth <= 980) setMobilePane('editor');
  } else {
    if (typeof wysiwygStop === 'function') wysiwygStop();
    showWysiwygHost(false);
    if (editor) {
      editor.getWrapperElement().style.display = '';
      syncEditorFromState();
      try { editor.refresh(); } catch (e) { /* ignore */ }
      if (opts.focus !== false && window.innerWidth > 760) {
        setTimeout(() => { try { editor.focus(); } catch (e) { /* ignore */ } }, 30);
      }
      if (opts.line != null) {
        const lineNo = Math.max(0, Math.min(editor.lineCount() - 1, Number(opts.line) - 1));
        editor.setCursor({ line: lineNo, ch: 0 });
        editor.scrollIntoView({ line: lineNo, ch: 0 }, 120);
      }
    } else {
      const fallback = $('#editor-fallback');
      if (fallback) fallback.style.display = 'block';
    }
  }
  updateWordCount();
}

function syncEditorFromState() {
  if (!editor) return;
  const file = currentFile();
  if (!file || file.text == null) return;
  if (editor.getValue() === file.text) return;
  const cur = editor.getCursor();
  editorSuppress = true;
  editor.setValue(file.text || '');
  editorSuppress = false;
  try { editor.setCursor(cur); } catch (e) { /* ignore */ }
}

function openFile(path, line) {
  const normalized = normalizeProjectPath(path);
  const file = state.files.get(normalized);
  if (!file) {
    toast({ type: 'error', title: '文件不存在', desc: normalized });
    return;
  }
  if (file.text == null) {
    openBinaryPreview(file);
    return;
  }
  const same = state.activePath === normalized && editor;
  const visual = state.editorMode === 'wysiwyg' && wysiwygAvailable(file);
  setActivePath(normalized);
  if (editor) editor.getWrapperElement().style.display = visual ? 'none' : '';
  if (visual) {
    showWysiwygHost(true);
    wysiwygStart(normalized, line != null ? { focusPathLine: line } : {});
  } else {
    showWysiwygHost(false);
    if (editor && !same) {
      editorSuppress = true;
      editor.setValue(file.text || '');
      editorSuppress = false;
      editor.clearHistory();
      editor.setOption('mode', EDITOR_MODES[pathExt(normalized)] || null);
      editor.setOption('readOnly', false);
      if (state.editorMode === 'wysiwyg' && typeof wysiwygStop === 'function') wysiwygStop();
    } else if (editor && same) {
      // Refresh from state only if the active file changed elsewhere.
      if (editor.getValue() !== file.text) syncEditorFromState();
    }
  }
  renderTabs();
  renderTree();
  updateEditorMeta();
  renderSaveState();
  updateStorageUI();
  positionToolbarForFile();
  if (line != null && editor && !visual) {
    const lineNo = Math.max(0, Math.min(editor.lineCount() - 1, Number(line) - 1));
    editor.setCursor({ line: lineNo, ch: 0 });
    editor.scrollIntoView({ line: lineNo, ch: 0 }, 120);
  }
  if (editor && !visual && window.innerWidth > 760) {
    setTimeout(() => { try { editor.focus(); } catch (e) { /* ignore */ } }, 30);
  }
  if (window.innerWidth <= 980) setMobilePane('editor');
  updateWordCount();
}

function updateEditorMeta() {
  const meta = $('#editor-file-meta');
  const file = currentFile();
  if (!meta || !file) return;
  const size = file.text != null ? new Blob([file.text]).size : file.size || 0;
  const kind = pathExt(file.path) === '.tex' ? 'LaTeX' : pathExt(file.path).replace('.', '').toUpperCase() || 'TEXT';
  meta.textContent = `${kind} · UTF-8 · ${formatBytes(size)}`;
}

function renderTabs() {
  const wrap = $('#file-tabs');
  if (!wrap) return;
  wrap.innerHTML = '';
  for (const path of state.openTabs) {
    const file = state.files.get(path);
    if (!file) continue;
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = `file-tab${path === state.activePath ? ' active' : ''}${state.dirty.has(path) ? ' dirty' : ''}`;
    tab.dataset.path = path;
    tab.innerHTML = `${fileIconSvg(path, 13)}<span class="ft-name">${escapeHtml(pathBase(path))}</span>` +
      (state.dirty.has(path) ? '<i class="ft-dirty"></i>' : '') +
      `<span class="ft-close" role="button" aria-label="关闭 ${escapeAttr(pathBase(path))}">${iconSvg('x')}</span>`;
    tab.title = path;
    tab.addEventListener('click', (e) => {
      if (e.target.closest('.ft-close')) {
        e.stopPropagation();
        closeTab(path);
        return;
      }
      openFile(path);
    });
    tab.addEventListener('auxclick', (e) => {
      if (e.button === 1) {
        e.preventDefault();
        closeTab(path);
      }
    });
    wrap.appendChild(tab);
  }
  const active = wrap.querySelector('.file-tab.active');
  if (active) active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function closeTab(path) {
  if (!state.openTabs.includes(path)) return;
  closeTabState(path);
  if (state.activePath === path) {
    const next = state.openTabs[state.openTabs.length - 1] || '';
    if (next) openFile(next);
    else if (editor) {
      editorSuppress = true;
      editor.setValue('');
      editorSuppress = false;
      updateEditorMeta();
    }
  }
  renderTabs();
}

function closeOtherTabs(path) {
  state.openTabs = [path];
  state.activePath = path;
  renderTabs();
}

function refreshDirtyIndicators() {
  renderTabs();
  renderSaveState();
  updateStorageUI();
  const tree = $('#file-tree');
  if (tree) {
    tree.querySelectorAll('.tree-file').forEach((row) => {
      row.classList.toggle('dirty', state.dirty.has(row.dataset.path));
    });
  }
}

function insertAtCursor(text, selectFrom = 0, selectTo = 0) {
  if (!editor) return;
  const doc = editor.getDoc();
  const cursor = doc.getCursor();
  doc.replaceRange(text, cursor);
  const start = { line: cursor.line, ch: cursor.ch + selectFrom };
  const end = { line: cursor.line, ch: cursor.ch + selectTo };
  doc.setSelection(start, end);
  editor.focus();
}

function wrapSelection(before, after, placeholder = '') {
  if (!editor) return;
  const doc = editor.getDoc();
  const selected = doc.getSelection() || placeholder;
  const from = doc.getCursor('from');
  doc.replaceSelection(`${before}${selected}${after}`, 'around');
  if (!doc.getSelection() && placeholder) {
    const start = { line: from.line, ch: from.ch + before.length };
    doc.setSelection(start, { line: start.line, ch: start.ch + placeholder.length });
  }
  editor.focus();
}

function insertBlock(lines, caretOffsetLine = 0) {
  if (!editor) return;
  const doc = editor.getDoc();
  const cursor = doc.getCursor();
  const before = cursor.ch > 0 ? '\n' : '';
  const after = '\n';
  const text = `${before}${lines.join('\n')}${after}`;
  doc.replaceRange(text, cursor);
  const line = cursor.line + caretOffsetLine + (before ? 1 : 0);
  doc.setCursor({ line, ch: 0 });
  editor.focus();
}

function applyFormat(kind) {
  if (state.editorMode === 'wysiwyg' && typeof wysApplyFormat === 'function') {
    wysApplyFormat(kind);
    return;
  }
  if (!editor) return;
  switch (kind) {
    case 'bold': wrapSelection('\\textbf{', '}', '粗体文本'); break;
    case 'italic': wrapSelection('\\textit{', '}', '斜体文本'); break;
    case 'emph': wrapSelection('\\emph{', '}', '强调文本'); break;
    case 'code': wrapSelection('\\texttt{', '}', 'code'); break;
    case 'link': wrapSelection('\\href{https://example.com}{', '}', '链接文本'); break;
    case 'section':
      insertBlock(['\\section{新章节}', '\\label{sec:new-section}', '', '在这里开始写作。'], 0);
      break;
    case 'math': wrapSelection('$', '$', 'x \\in \\mathbb{R}'); break;
    case 'equation':
      insertBlock(['\\begin{equation}', '  \\label{eq:new-equation}', '  E = mc^2', '\\end{equation}'], 1);
      break;
    case 'cite': wrapSelection('\\cite{', '}', 'key'); break;
    case 'ref': wrapSelection('\\ref{', '}', 'sec:label'); break;
    case 'figure':
      insertBlock([
        '\\begin{figure}[htbp]',
        '  \\centering',
        '  \\includegraphics[width=0.8\\linewidth]{figures/example.png}',
        '  \\caption{图注}',
        '  \\label{fig:new-figure}',
        '\\end{figure}'
      ], 2);
      break;
    case 'table':
      insertBlock([
        '\\begin{table}[htbp]',
        '  \\centering',
        '  \\caption{表注}',
        '  \\label{tab:new-table}',
        '  \\begin{tabular}{lcc}',
        '    \\toprule',
        '    列 A & 列 B & 列 C \\\\',
        '    \\midrule',
        '    1 & 2 & 3 \\\\',
        '    \\bottomrule',
        '  \\end{tabular}',
        '\\end{table}'
      ], 4);
      break;
    case 'list':
      insertBlock(['\\begin{itemize}', '  \\item 第一项', '  \\item 第二项', '\\end{itemize}'], 1);
      break;
    case 'comment':
      if (window.CodeMirror && CodeMirror.commands && CodeMirror.commands.toggleComment) CodeMirror.commands.toggleComment(editor);
      break;
    default: break;
  }
}

function positionToolbarForFile() {
  const file = currentFile();
  const formatbar = $('#formatbar');
  if (!formatbar) return;
  const isTex = file && ['.tex', '.ltx', '.latex', '.cls', '.sty', '.bib'].includes(pathExt(file.path));
  formatbar.classList.toggle('is-disabled', !isTex);
  formatbar.querySelectorAll('button').forEach((b) => { b.disabled = !isTex; });
}

function insertMenuItems() {
  return [
    { labelGroup: '结构' },
    { label: '章节', icon: 'file', kbd: '§', onClick: () => applyFormat('section') },
    { label: '无序列表', icon: 'file', onClick: () => applyFormat('list') },
    { sep: true },
    { labelGroup: '数学与引用' },
    { label: '行内公式', icon: 'edit', kbd: '$', onClick: () => applyFormat('math') },
    { label: '编号公式', icon: 'edit', onClick: () => applyFormat('equation') },
    { label: '文献引用', icon: 'link', onClick: () => applyFormat('cite') },
    { label: '交叉引用', icon: 'link', onClick: () => applyFormat('ref') },
    { sep: true },
    { labelGroup: '浮动体' },
    { label: '插入图', icon: 'file', onClick: () => applyFormat('figure') },
    { label: '插入表', icon: 'file', onClick: () => applyFormat('table') },
    { label: '上传图片/文件', icon: 'upload', onClick: () => $('#file-upload').click() }
  ];
}

async function openBinaryPreview(file) {
  if (!file) return;
  const url = state.assets.get(file.path);
  if (isImagePath(file.path)) {
    openModal({
      title: pathBase(file.path),
      subtitle: `${formatBytes(file.size)} · 图片资源`,
      size: 'modal-lg',
      body: `<div class="binary-preview"><img src="${escapeAttr(url || '')}" alt="${escapeAttr(pathBase(file.path))}"></div>` +
        `<div class="field-hint" style="margin-top:12px">${escapeHtml(file.path)}</div>`,
      actions: [
        { label: '下载', kind: 'soft', onClick: () => { if (url) fetch(url).then((r) => r.blob()).then((b) => downloadBlob(b, pathBase(file.path))); } },
        { label: '关闭', kind: 'primary' }
      ]
    });
    return;
  }
  if (isPdfPath(file.path)) {
    openModal({
      title: pathBase(file.path),
      subtitle: 'PDF 文件',
      size: 'modal-xl',
      body: url ? `<iframe class="binary-pdf" src="${escapeAttr(url)}" title="${escapeAttr(pathBase(file.path))}"></iframe>` : '<div class="modal-note">该 PDF 尚未下载到本地。</div>',
      actions: [{ label: '关闭', kind: 'primary' }]
    });
    return;
  }
  openModal({
    title: pathBase(file.path),
    subtitle: '二进制文件',
    body: `<div class="modal-note">这个文件不是文本文件，Qelemchi 不在编辑器中打开它。<br><code>${escapeHtml(file.path)}</code></div>`,
    actions: [{ label: '下载', kind: 'soft', onClick: () => {
      if (!file.base64) return;
      downloadBlob(new Blob([base64ToBytes(file.base64)], { type: file.mime || mimeFor(file.path) }), pathBase(file.path));
    } }, { label: '关闭', kind: 'primary' }]
  });
}

function focusProjectSearch() {
  const tab = document.querySelector('[data-side-tab="search"]');
  if (tab) tab.click();
  setTimeout(() => {
    const input = $('#project-search');
    if (input) {
      input.focus();
      input.select();
    }
  }, 50);
}

function maybeSaveDraftSoon() {
  // GitHub drafts stay in memory until committed; local drafts are persisted.
  renderSaveState();
}
