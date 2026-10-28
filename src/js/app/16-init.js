/* ==========================================================================
   Qelemchi · boot and global bindings
   ========================================================================== */

const LAYOUT_KEY = 'qelemchi.layout';

function bootStatus(text) {
  const node = $('#boot-status');
  if (node) node.textContent = text;
}

function hideBoot() {
  const boot = $('#boot');
  if (!boot) return;
  boot.classList.add('is-gone');
  setTimeout(() => boot.remove(), 420);
}

function guard(fn) {
  return (...args) => {
    try {
      const result = fn(...args);
      if (result && typeof result.catch === 'function') {
        result.catch((e) => toast({ type: 'error', title: '操作失败', desc: e.message || String(e) }));
      }
      return result;
    } catch (e) {
      toast({ type: 'error', title: '操作失败', desc: e.message || String(e) });
      return undefined;
    }
  };
}

function updateWordCount() {
  const el = $('#word-count');
  if (!el) return;
  const file = currentFile();
  let text = '';
  if (file && file.text != null) {
    const fromEditor = editor && state.editorMode !== 'wysiwyg' && state.activePath === file.path;
    text = fromEditor ? editor.getValue() : file.text;
  }
  const cjk = (text.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length;
  const latin = (text.replace(/[\u3400-\u9fff\uf900-\ufaff]/g, ' ').match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g) || []).length;
  el.textContent = `${cjk + latin} 字`;
}

function setMobilePane(pane) {
  const name = pane === 'preview' ? 'preview' : 'editor';
  state.mobilePane = name;
  const workspace = $('#workspace');
  if (workspace) workspace.dataset.mobilePane = name;
  document.querySelectorAll('#mobile-switch [data-mobile-pane]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mobilePane === name);
  });
  if (name === 'preview') {
    setTimeout(() => fitPreviewWidth(true), 80);
  } else if (editor) {
    setTimeout(() => { try { editor.refresh(); } catch (e) { /* ignore */ } }, 60);
  }
}

function setSidebarOpen(open) {
  const sidebar = $('#sidebar');
  const btn = $('#btn-sidebar');
  if (!sidebar) return;
  sidebar.classList.toggle('is-open', !!open);
  document.body.classList.toggle('sidebar-open', !!open);
  if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function toggleSidebar(force) {
  const sidebar = $('#sidebar');
  if (!sidebar) return;
  const next = force != null ? force : !sidebar.classList.contains('is-open');
  setSidebarOpen(next);
}

function accountMenu(anchor) {
  const items = [];
  if (state.mode === 'github' && state.user) {
    items.push({ labelGroup: `@${state.user.login}` });
    items.push({ label: '在 GitHub 打开账户', icon: 'external', onClick: () => window.open(state.user.html_url || `https://github.com/${state.user.login}`, '_blank', 'noopener') });
    if (state.repo) {
      items.push({ label: '打开论文仓库', icon: 'github', onClick: () => window.open(githubRepoUrl(state.repo.owner, state.repo.name), '_blank', 'noopener') });
      items.push({ label: '复制仓库地址', icon: 'link', onClick: async () => {
        const ok = await copyText(`${state.repo.owner}/${state.repo.name}`);
        toast(ok ? { type: 'success', title: '仓库地址已复制', desc: state.repo.full } : { type: 'error', title: '复制失败' });
      } });
    }
    items.push({ label: '切换仓库…', icon: 'refresh', onClick: () => showOnboarding({ prefillRepo: state.repo ? state.repo.full : '', keepToken: true }) });
    items.push({ sep: true });
    items.push({ label: '设置', icon: 'gear', onClick: () => openSettings('github') });
    items.push({ label: '断开 GitHub', icon: 'warning', danger: true, onClick: disconnectGitHub });
  } else {
    items.push({ labelGroup: '本机示例' });
    items.push({ label: '连接 GitHub 仓库…', icon: 'github', onClick: () => showOnboarding() });
    items.push({ label: '选择起始模板…', icon: 'file', onClick: openTemplateChooser });
    items.push({ sep: true });
    items.push({ label: '设置', icon: 'gear', onClick: () => openSettings() });
    items.push({ label: '关于 Qelemchi', icon: 'info', onClick: () => openSettings('about') });
  }
  showMenu(anchor, items);
}

function brandMenu(anchor) {
  showMenu(anchor, [
    { labelGroup: state.projectTitle || '当前项目' },
    { label: '新建文件', icon: 'plus', onClick: () => newFileFlow() },
    { label: '选择起始模板…', icon: 'file', onClick: openTemplateChooser },
    { label: '导出项目 ZIP', icon: 'download', onClick: exportProjectZip },
    { sep: true },
    state.mode === 'github'
      ? { label: '刷新仓库', icon: 'refresh', onClick: refreshFromGitHub }
      : { label: '连接 GitHub 仓库…', icon: 'github', onClick: () => showOnboarding() },
    { label: '设置', icon: 'gear', onClick: () => openSettings() },
    { label: '关于 Qelemchi', icon: 'info', onClick: () => openSettings('about') }
  ]);
}

function previewMoreMenu(anchor) {
  const items = [
    { label: '适合宽度', icon: 'search', onClick: () => fitPreviewWidth() },
    { label: '实际大小 · 100%', icon: 'file', onClick: () => setZoom(1) },
    { label: '放大', icon: 'plus', onClick: zoomIn },
    { label: '缩小', icon: 'minus', onClick: zoomOut },
    { label: '重新编译 PDF', icon: 'refresh', onClick: refreshPreview }
  ];
  if (state.pdfUrl) {
    items.push({ sep: true });
    items.push({ label: '在新标签页打开 PDF', icon: 'external', onClick: () => window.open(state.pdfUrl, '_blank', 'noopener') });
    items.push({ label: '下载 PDF', icon: 'download', onClick: () => downloadBlob(state.pdfBlob, `${safeFileName(state.projectTitle)}.pdf`) });
    items.push({ label: '用 GitHub Actions 编译', icon: 'play', onClick: () => openCompile() });
  } else {
    items.push({ sep: true });
    items.push({ label: state.mode === 'github' ? '编译 PDF' : '如何编译 PDF', icon: 'play', onClick: openCompile });
  }
  showMenu(anchor, items);
}

/* --------------------------------------------------------------------------
   Resizable panes
   -------------------------------------------------------------------------- */

function loadLayout() {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (!raw) return;
    const layout = JSON.parse(raw);
    if (layout && Number(layout.sidebar)) {
      document.documentElement.style.setProperty('--sidebar-w', `${clamp(Number(layout.sidebar), 196, 360)}px`);
    }
    if (layout && Number(layout.preview)) {
      applyPreviewWidth(clamp(Number(layout.preview), 320, 2000));
    }
  } catch (e) { /* ignore */ }
}

function saveLayout() {
  try {
    const sidebar = $('#sidebar');
    const preview = $('#preview-pane');
    localStorage.setItem(LAYOUT_KEY, JSON.stringify({
      sidebar: sidebar ? Math.round(sidebar.getBoundingClientRect().width) : 252,
      preview: preview ? Math.round(preview.getBoundingClientRect().width) : 0
    }));
  } catch (e) { /* ignore */ }
}

function applyPreviewWidth(width) {
  const preview = $('#preview-pane');
  const workspace = $('#workspace');
  if (!preview || !workspace) return;
  const total = workspace.getBoundingClientRect().width;
  const max = Math.max(320, total - 300);
  const w = clamp(Number(width) || 0, 320, max);
  preview.style.flex = `0 0 ${w}px`;
}

function initResizers() {
  const workspace = $('#workspace');
  const left = $('#resizer-left');
  const right = $('#resizer-right');
  if (!workspace) return;

  if (left) {
    left.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const sidebar = $('#sidebar');
      if (!sidebar) return;
      const startX = e.clientX;
      const startW = sidebar.getBoundingClientRect().width;
      left.classList.add('is-dragging');
      document.body.classList.add('is-resizing');
      try { left.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      const move = (ev) => {
        const w = clamp(startW + ev.clientX - startX, 196, 360);
        document.documentElement.style.setProperty('--sidebar-w', `${Math.round(w)}px`);
        if (editor) editor.refresh();
      };
      const up = () => {
        left.classList.remove('is-dragging');
        document.body.classList.remove('is-resizing');
        left.removeEventListener('pointermove', move);
        left.removeEventListener('pointerup', up);
        left.removeEventListener('pointercancel', up);
        saveLayout();
        fitPreviewWidth(true);
      };
      left.addEventListener('pointermove', move);
      left.addEventListener('pointerup', up);
      left.addEventListener('pointercancel', up);
    });
  }

  if (right) {
    right.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const preview = $('#preview-pane');
      if (!preview) return;
      const startX = e.clientX;
      const startW = preview.getBoundingClientRect().width;
      const total = workspace.getBoundingClientRect().width;
      right.classList.add('is-dragging');
      document.body.classList.add('is-resizing');
      try { right.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      const move = (ev) => {
        const w = clamp(startW - (ev.clientX - startX), 320, Math.max(320, total - 300));
        preview.style.flex = `0 0 ${Math.round(w)}px`;
      };
      const up = () => {
        right.classList.remove('is-dragging');
        document.body.classList.remove('is-resizing');
        right.removeEventListener('pointermove', move);
        right.removeEventListener('pointerup', up);
        right.removeEventListener('pointercancel', up);
        saveLayout();
        fitPreviewWidth(true);
      };
      right.addEventListener('pointermove', move);
      right.addEventListener('pointerup', up);
      right.addEventListener('pointercancel', up);
    });
  }
}

/* --------------------------------------------------------------------------
   Global event wiring
   -------------------------------------------------------------------------- */

function wireTopbar() {
  const save = $('#btn-save');
  if (save) save.addEventListener('click', guard(saveProject));
  const compile = $('#btn-compile');
  if (compile) compile.addEventListener('click', guard(openCompile));
  const theme = $('#btn-theme');
  if (theme) theme.addEventListener('click', toggleTheme);
  const settings = $('#btn-settings');
  if (settings) settings.addEventListener('click', () => openSettings());
  const account = $('#btn-account');
  if (account) account.addEventListener('click', () => accountMenu(account));
  const brand = $('#brand-home');
  if (brand) {
    brand.addEventListener('click', (e) => {
      e.preventDefault();
      brandMenu(brand);
    });
  }
  const connect = $('#btn-connect');
  if (connect) connect.addEventListener('click', () => showOnboarding());
  const demoConnect = $('#demo-connect');
  if (demoConnect) demoConnect.addEventListener('click', () => showOnboarding({ tab: 'github' }));
  const offlineRetry = $('#offline-retry');
  if (offlineRetry) offlineRetry.addEventListener('click', () => refreshFromGitHub());

  const mobileBtn = $('#btn-sidebar');
  if (mobileBtn) mobileBtn.addEventListener('click', () => toggleSidebar());

  document.querySelectorAll('#mobile-switch [data-mobile-pane]').forEach((btn) => {
    btn.addEventListener('click', () => setMobilePane(btn.dataset.mobilePane));
  });

  document.addEventListener('pointerdown', (e) => {
    if (!document.body.classList.contains('sidebar-open')) return;
    const sidebar = $('#sidebar');
    const toggle = $('#btn-sidebar');
    if (sidebar && sidebar.contains(e.target)) return;
    if (toggle && toggle.contains(e.target)) return;
    setSidebarOpen(false);
  });

  document.addEventListener('click', (e) => {
    const strip = $('#issue-strip');
    if (!strip || !strip.classList.contains('open')) return;
    if (strip.contains(e.target)) return;
    toggleIssuePopover(false);
  });
}

function wireEditorChrome() {
  document.querySelectorAll('[data-format]').forEach((btn) => {
    btn.addEventListener('click', () => applyFormat(btn.dataset.format));
  });
  const insert = $('#btn-insert');
  if (insert) {
    insert.addEventListener('click', () => {
      insert.setAttribute('aria-expanded', 'true');
      const items = insertMenuItems().map((item) => Object.assign({}, item, {
        onClick: item.onClick ? () => { insert.setAttribute('aria-expanded', 'false'); item.onClick(); } : undefined
      }));
      showMenu(insert, items, { align: 'left' });
      setTimeout(() => insert.setAttribute('aria-expanded', 'false'), 0);
    });
  }
  const palette = $('#btn-palette');
  if (palette) palette.addEventListener('click', () => openPalette());
}

function wireEditorModeTabs() {
  const tabs = $('#editor-mode-tabs');
  if (!tabs) return;
  tabs.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-mode]');
    if (btn) setEditorMode(btn.dataset.mode);
  });
}

function wirePreviewChrome() {
  const out = $('#btn-zoom-out');
  if (out) out.addEventListener('click', zoomOut);
  const zin = $('#btn-zoom-in');
  if (zin) zin.addEventListener('click', zoomIn);
  const reset = $('#btn-zoom-reset');
  if (reset) reset.addEventListener('click', () => setZoom(1));
  const fit = $('#btn-fit');
  if (fit) fit.addEventListener('click', () => fitPreviewWidth());
  const refresh = $('#btn-preview-refresh');
  if (refresh) refresh.addEventListener('click', refreshPreview);
  const more = $('#btn-preview-more');
  if (more) more.addEventListener('click', () => previewMoreMenu(more));
  const issue = $('#issue-toggle');
  if (issue) issue.addEventListener('click', () => toggleIssuePopover());
}

function wireGlobalKeys() {
  document.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;
    const key = String(e.key || '').toLowerCase();
    if (e.defaultPrevented) return;
    if (mod && !e.shiftKey && key === 's') {
      e.preventDefault();
      guard(saveProject)();
      return;
    }
    if (mod && !e.shiftKey && key === 'k') {
      e.preventDefault();
      openPalette();
      return;
    }
    if (mod && !e.shiftKey && e.key === 'Enter') {
      e.preventDefault();
      guard(openCompile)();
      return;
    }
    if (mod && e.shiftKey && key === 'f') {
      e.preventDefault();
      focusProjectSearch();
      return;
    }
    if (e.key === 'Escape') {
      closeMenu();
      toggleIssuePopover(false);
      if (document.body.classList.contains('sidebar-open')) setSidebarOpen(false);
    }
  });

  window.addEventListener('beforeunload', (e) => {
    if (state.mode === 'github' && hasChanges() && !state.save.busy) {
      e.preventDefault();
      e.returnValue = '还有尚未提交到 GitHub 的修改。';
      return e.returnValue;
    }
    return undefined;
  });
}

function initResponsive() {
  const mq = window.matchMedia('(max-width: 980px)');
  const sync = () => {
    const mobileSwitch = $('#mobile-switch');
    if (mobileSwitch) mobileSwitch.hidden = !mq.matches;
    if (!mq.matches) setSidebarOpen(false);
    const preview = $('#preview-pane');
    if (preview && mq.matches) preview.style.flex = '';
    const workspace = $('#workspace');
    if (workspace) workspace.dataset.mobilePane = state.mobilePane || 'editor';
    if (editor) setTimeout(() => { try { editor.refresh(); } catch (e) { /* ignore */ } }, 80);
  };
  if (mq.addEventListener) mq.addEventListener('change', sync);
  sync();
  window.addEventListener('resize', debounce(() => {
    if (editor) { try { editor.refresh(); } catch (e) { /* ignore */ } }
    if (state.zoomMode !== 'manual') fitPreviewWidth(true);
  }, 180));
}

function initThemeWatcher() {
  if (!window.matchMedia) return;
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const onChange = () => {
    if ((state.settings.theme || 'system') === 'system') applyTheme('system');
  };
  if (mq.addEventListener) mq.addEventListener('change', onChange);
}

function initEditorExtras() {
  if (!editor) return;
  editor.on('change', debounce(updateWordCount, 150));
  applyEditorSettings();
}

/* --------------------------------------------------------------------------
   Boot
   -------------------------------------------------------------------------- */

async function init() {
  if (state.booted) return;
  state.booted = true;
  applyTheme(state.settings.theme || 'system');
  applyZoom();
  bootStatus('正在恢复工作区');

  initOnboardingEvents();
  initHistoryEvents();
  initTreeEvents();
  initResizers();
  wireTopbar();
  wireEditorChrome();
  wireEditorModeTabs();
  wirePreviewChrome();
  wireGlobalKeys();
  initResponsive();
  initThemeWatcher();

  let restored = false;
  try {
    const loaded = await loadDemoWorkspace();
    restored = !!(loaded && loaded.restored);
  } catch (e) {
    console.warn('Could not restore demo workspace', e);
  }

  const app = $('#app');
  if (app) app.hidden = false;
  bootStatus('正在准备编辑器');
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  initEditor();
  initEditorExtras();
  loadLayout();

  renderTree();
  renderTabs();
  const first = state.activePath || state.mainPath;
  if (first && state.files.has(first)) openFile(first);
  if (state.settings.editorMode === 'wysiwyg') {
    setEditorMode('wysiwyg', { silent: true, focus: false });
  }
  setPreviewView('pdf');
  refreshOutline();
  renderSaveState();
  updateStorageUI();
  updateProjectTitle();
  updateWordCount();
  if (!state.theme) applyTheme(state.settings.theme || 'system');
  showDemoBanner(state.mode === 'demo' && !state.demoDismissed);
  schedulePreview(120);
  if (localTexEnabled()) {
    setTimeout(() => {
      if (!state.localTex.stale || state.localTex.busy || state.pdfSource === 'local') return;
      // Never pull the engine pack on startup; only recompile projects whose
      // assets are already cached. Otherwise the preview shows an explicit
      // "compile" button, and edits do not trigger a download until the first
      // compile has been requested.
      const kind = localTexDetectEngine() === 'xelatex' ? 'xetex' : 'pdftex';
      localTexAssetsCached(kind).then((cached) => {
        if (!cached || state.localTex.busy || state.pdfSource === 'local') return;
        state.localTex.autoArmed = true;
        if (state.localTex.stale) runLocalCompile({ reason: 'boot' });
      }).catch(() => {});
    }, 900);
  }

  setTimeout(() => fitPreviewWidth(true), 260);
  hideBoot();

  const meta = loadSessionMeta();
  if (meta && meta.mode === 'github' && meta.repo) {
    const connected = await tryAutoConnect();
    if (connected) {
      updateWordCount();
      toast({ type: 'success', title: '已恢复上次的仓库', desc: state.repo ? state.repo.full : '' });
    }
  } else if (!restored) {
    // First launch starts in the editable local demo. GitHub connection is optional
    // and can be opened from the toolbar or storage panel whenever the user needs it.
  }

  window.__qelemchi = {
    state,
    saveProject,
    openPalette,
    openSettings,
    openHistory,
    openCompile,
    refreshPreview,
    exportProjectZip,
    renderPreview,
    openFile,
    setEditorMode,
    syncEditorFromState,
    showOnboarding,
    tryAutoConnect,
    get wysiwyg() { return wys; }
  };
}

init().catch((e) => {
  console.error(e);
  bootStatus('启动失败');
  const status = $('#boot-status');
  if (status) status.textContent = `启动失败：${e.message || e}`;
});

})();
