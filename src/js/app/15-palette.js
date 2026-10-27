/* ==========================================================================
   Qelemchi · command palette
   ========================================================================== */

let paletteEl = null;
let paletteInput = null;
let paletteResults = null;
let paletteItems = [];
let paletteActive = 0;
let paletteBound = null;

function paletteCommands() {
  const isGithub = state.mode === 'github';
  return [
    { group: '文件', title: isGithub ? '提交到 GitHub' : '保存本机快照', icon: 'save', kbd: '⌘S', run: saveProject },
    { group: '文件', title: '新建文件', icon: 'plus', run: () => newFileFlow() },
    { group: '文件', title: '上传文件…', icon: 'upload', run: () => { state.uploadTarget = ''; $('#file-upload').click(); } },
    { group: '文件', title: '导出项目 ZIP', icon: 'download', run: exportProjectZip },
    { group: '文件', title: '选择起始模板…', icon: 'file', run: openTemplateChooser },
    { group: '文件', title: '项目内搜索', icon: 'search', kbd: '⇧⌘F', run: focusProjectSearch },
    isGithub
      ? { group: 'GitHub', title: '刷新仓库', icon: 'refresh', run: refreshFromGitHub }
      : { group: 'GitHub', title: '连接 GitHub 仓库…', icon: 'github', run: () => showOnboarding() },
    { group: '视图', title: '源码编辑模式', icon: 'file', run: () => setEditorMode('source') },
    { group: '视图', title: '所见即所得编辑模式', icon: 'edit', run: () => setEditorMode('wysiwyg') },
    { group: '视图', title: '重新编译 PDF', icon: 'refresh', run: refreshPreview },
    { group: '视图', title: '适应窗口宽度', icon: 'search', run: fitPreviewWidth },
    { group: '视图', title: '放大 PDF', icon: 'plus', run: zoomIn },
    { group: '视图', title: '缩小 PDF', icon: 'minus', run: zoomOut },
    { group: '视图', title: '切换明暗主题', icon: state.theme === 'dark' ? 'sun' : 'moon', run: toggleTheme },
    { group: '视图', title: '文件列表', icon: 'folder', run: () => { setSideTab('files'); openSidebarOnMobile('files'); } },
    { group: '视图', title: '文档大纲', icon: 'file', run: () => { setSideTab('outline'); refreshOutline(); openSidebarOnMobile('outline'); } },
    { group: '版本', title: '版本历史', icon: 'history', run: openHistory },
    { group: '版本', title: isGithub ? '编译 PDF（GitHub Actions）' : '如何编译真实 PDF', icon: 'play', kbd: '⌘↵', run: openCompile },
    { group: '版本', title: '设置', icon: 'gear', run: () => openSettings() }
  ];
}

function openSidebarOnMobile(name) {
  if (window.innerWidth > 900) return;
  setSideTab(name);
  document.body.classList.add('sidebar-open');
  const btn = $('#btn-sidebar');
  if (btn) btn.setAttribute('aria-expanded', 'true');
}

function scoreMatch(text, query) {
  const t = text.toLowerCase();
  const q = query.toLowerCase();
  if (!q) return 1;
  if (t === q) return 100;
  if (t.startsWith(q)) return 70;
  const wordStart = new RegExp(`(^|[\\s/_.-])${escapeRegExp(q)}`).test(t);
  if (wordStart) return 50;
  const at = t.indexOf(q);
  if (at >= 0) return 30 - Math.min(at, 20) / 4;
  return 0;
}

function paletteQueryText(query) {
  const raw = query.trim();
  return raw.startsWith('>') ? raw.slice(1).trim() : raw;
}

function collectPaletteItems(query) {
  const raw = query.trim();
  const commandsOnly = raw.startsWith('>');
  const q = paletteQueryText(query);
  const commands = paletteCommands().map((c) => ({
    type: 'command',
    group: c.group,
    title: c.title,
    icon: c.icon,
    kbd: c.kbd || '',
    run: c.run,
    score: scoreMatch(c.title, q) + 6
  }));
  if (commandsOnly) {
    return commands
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
      .slice(0, 60);
  }
  const files = Array.from(state.files.values()).map((file) => ({
    type: 'file',
    group: '文件',
    title: file.path,
    icon: pathExt(file.path).replace('.', '') || 'file',
    kbd: '',
    path: file.path,
    score: scoreMatch(file.path, q) + (state.openTabs.includes(file.path) ? 2 : 0),
    run: () => openFile(file.path)
  }));
  return commands.concat(files)
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .slice(0, 60);
}

function paletteFileIcon(path) {
  const ext = pathExt(path);
  if (ext === '.tex' || ext === '.ltx') return iconSvg('edit');
  if (ext === '.bib') return iconSvg('file');
  return fileIconSvg(path, 15) || iconSvg('file');
}

function renderPalette(query) {
  if (!paletteResults) return;
  paletteItems = collectPaletteItems(query);
  if (!paletteItems.length) {
    paletteResults.innerHTML = '<div class="palette-empty">没有匹配的命令或文件。</div>';
    paletteActive = 0;
    return;
  }
  paletteActive = clamp(paletteActive, 0, paletteItems.length - 1);
  let html = '';
  let lastGroup = '';
  paletteItems.forEach((item, index) => {
    if (item.group !== lastGroup) {
      html += `<div class="palette-group">${escapeHtml(item.group)}</div>`;
      lastGroup = item.group;
    }
    const icon = item.type === 'file' ? paletteFileIcon(item.path) : iconSvg(item.icon);
    html += `<button type="button" class="palette-item${index === paletteActive ? ' active' : ''}" data-palette-index="${index}">` +
      `<span class="pi-icon">${icon}</span><span class="pi-title">${highlightMatch(item.title, paletteQueryText(query))}</span>` +
      (item.kbd ? `<kbd>${escapeHtml(item.kbd)}</kbd>` : item.type === 'file' && state.dirty.has(item.path) ? '<span class="pi-meta">未提交</span>' : '') +
      '</button>';
  });
  paletteResults.innerHTML = html;
  paletteResults.querySelectorAll('[data-palette-index]').forEach((btn) => {
    btn.addEventListener('mousemove', () => {
      const idx = Number(btn.dataset.paletteIndex);
      if (idx === paletteActive) return;
      paletteActive = idx;
      paletteResults.querySelectorAll('.palette-item').forEach((b, i) => b.classList.toggle('active', i === idx));
    });
    btn.addEventListener('click', () => runPaletteItem(Number(btn.dataset.paletteIndex)));
  });
  const activeEl = paletteResults.querySelector('.palette-item.active');
  if (activeEl) activeEl.scrollIntoView({ block: 'nearest' });
}

function runPaletteItem(index) {
  const item = paletteItems[index];
  if (!item) return;
  closePalette();
  setTimeout(() => {
    try {
      const result = item.run();
      if (result && typeof result.catch === 'function') result.catch((e) => {
        toast({ type: 'error', title: '命令执行失败', desc: e.message || String(e) });
      });
    } catch (e) {
      toast({ type: 'error', title: '命令执行失败', desc: e.message || String(e) });
    }
  }, 10);
}

function closePalette() {
  if (!paletteEl) return;
  const node = paletteEl;
  paletteEl = null;
  paletteInput = null;
  paletteResults = null;
  paletteItems = [];
  node.classList.add('is-out');
  if (paletteBound) {
    document.removeEventListener('keydown', paletteBound, true);
    paletteBound = null;
  }
  setTimeout(() => node.remove(), 120);
}

function openPalette(initialQuery = '') {
  if (paletteEl) {
    if (paletteInput) {
      paletteInput.focus();
      paletteInput.select();
    }
    return;
  }
  paletteEl = document.createElement('div');
  paletteEl.className = 'palette-backdrop';
  paletteEl.innerHTML = `<div class="palette" role="dialog" aria-modal="true" aria-label="命令面板">
      <div class="palette-input-row">${iconSvg('search')}
        <input id="palette-input" type="text" autocomplete="off" spellcheck="false" placeholder="搜索命令或文件…" aria-label="命令或文件名">
        <kbd>ESC</kbd>
      </div>
      <div class="palette-results" id="palette-results" role="listbox"></div>
      <div class="palette-foot"><span><kbd>↑</kbd><kbd>↓</kbd> 选择</span><span><kbd>↵</kbd> 打开</span><span>输入 <kbd>></kbd> 只看命令</span></div>
    </div>`;
  document.body.appendChild(paletteEl);
  paletteInput = paletteEl.querySelector('#palette-input');
  paletteResults = paletteEl.querySelector('#palette-results');
  paletteInput.value = initialQuery;
  paletteActive = 0;
  renderPalette(initialQuery);
  paletteInput.addEventListener('input', () => {
    paletteActive = 0;
    renderPalette(paletteInput.value);
  });
  paletteEl.addEventListener('mousedown', (e) => {
    if (e.target === paletteEl) closePalette();
  });
  paletteBound = (e) => {
    if (!paletteEl) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closePalette();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!paletteItems.length) return;
      paletteActive = (paletteActive + 1) % paletteItems.length;
      paintPaletteActive();
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!paletteItems.length) return;
      paletteActive = (paletteActive - 1 + paletteItems.length) % paletteItems.length;
      paintPaletteActive();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      runPaletteItem(paletteActive);
    }
  };
  document.addEventListener('keydown', paletteBound, true);
  setTimeout(() => {
    if (paletteInput) {
      paletteInput.focus();
      if (initialQuery) paletteInput.select();
    }
  }, 30);
}

function paintPaletteActive() {
  if (!paletteResults) return;
  paletteResults.querySelectorAll('.palette-item').forEach((btn, i) => {
    btn.classList.toggle('active', i === paletteActive);
    if (i === paletteActive) btn.scrollIntoView({ block: 'nearest' });
  });
}
