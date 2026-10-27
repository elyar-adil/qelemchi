/* ==========================================================================
   Qelemchi · settings, templates and project export
   ========================================================================== */

function settingsNavItems() {
  return [
    { id: 'editor', label: '编辑器', icon: 'edit' },
    { id: 'appearance', label: '外观', icon: 'sun' },
    { id: 'preview', label: '预览与编译', icon: 'play' },
    { id: 'project', label: '项目', icon: 'file' },
    { id: 'github', label: 'GitHub', icon: 'github' },
    { id: 'about', label: '关于', icon: 'info' }
  ];
}

function settingsSwitch(id, checked, label) {
  return `<button type="button" class="switch" id="${id}" role="switch" aria-checked="${checked ? 'true' : 'false'}" aria-label="${escapeAttr(label)}"></button>`;
}

function settingsRow(label, hint, control) {
  return `<div class="settings-row"><div class="settings-row-text"><div class="settings-row-label">${escapeHtml(label)}</div>` +
    (hint ? `<div class="settings-row-hint">${escapeHtml(hint)}</div>` : '') +
    `</div><div class="settings-row-control">${control}</div></div>`;
}

function settingsEditorPane() {
  const s = state.settings;
  return `<div class="settings-pane" data-settings-pane="editor">
    <h3>编辑器</h3>
    <p class="settings-lede">这些设置只影响写作界面，不会写入论文仓库。</p>
    ${settingsRow('源码字号', '更大的字号适合长时间写作。',
      `<input type="range" id="set-font-size" min="11" max="18" step="0.5" value="${escapeAttr(s.fontSize || 13.5)}"><span class="range-val" id="set-font-size-val">${escapeHtml(s.fontSize || 13.5)}px</span>`)}
    ${settingsRow('显示行号', '在编辑器左侧显示行号。', settingsSwitch('set-line-numbers', s.lineNumbers !== false, '显示行号'))}
    ${settingsRow('自动换行', '长行在窗口内折行，而不是横向滚动。', settingsSwitch('set-line-wrapping', s.lineWrapping !== false, '自动换行'))}
    ${settingsRow('编辑器快捷键', '⌘S 保存/提交 · ⌘K 命令面板 · ⌘/ 注释 · ⌘⇧F 项目搜索', '<kbd class="kbd-static">⌘K</kbd>')}
  </div>`;
}

function settingsAppearancePane() {
  const theme = state.settings.theme || 'system';
  const option = (id, label) => `<button type="button" data-theme-choice="${id}" class="${theme === id ? 'active' : ''}">${label}</button>`;
  return `<div class="settings-pane" data-settings-pane="appearance" hidden>
    <h3>外观</h3>
    <p class="settings-lede">Qelemchi 使用暖色纸张与墨色，预览页始终按论文纸张渲染。</p>
    ${settingsRow('主题', '跟随系统，或固定为亮色/暗色。',
      `<div class="theme-choice" id="theme-choice">${option('system', '跟随系统')}${option('light', '亮色')}${option('dark', '暗色')}</div>`)}
    ${settingsRow('界面密度', '这是演示版的固定密度；窄窗口会自动切换为单栏。', '<span class="range-val">舒适</span>')}
  </div>`;
}

function settingsPreviewPane() {
  const s = state.settings;
  const engine = s.compileEngine || 'xelatex';
  const select = `<select id="set-compile-engine">
      ${['xelatex', 'pdflatex', 'lualatex'].map((id) => `<option value="${id}"${engine === id ? ' selected' : ''}>${engineLabel(id)}</option>`).join('')}
    </select>`;
  const delay = s.localCompileDelay || 2200;
  const localEngine = s.localEngine || 'auto';
  const localSelect = `<select id="set-local-engine">
      <option value="auto"${localEngine === 'auto' ? ' selected' : ''}>自动（检测中文与字体）</option>
      <option value="xelatex"${localEngine === 'xelatex' ? ' selected' : ''}>XeLaTeX</option>
      <option value="pdflatex"${localEngine === 'pdflatex' ? ' selected' : ''}>pdfLaTeX</option>
    </select>`;
  return `<div class="settings-pane" data-settings-pane="preview" hidden>
    <h3>预览与编译</h3>
    <p class="settings-lede">右侧预览始终是编译后的真实 PDF；论文结构在编辑器的“所见即所得”模式中显示。</p>
    ${settingsRow('停止输入后编译', '首次编译之后生效；数值越小 PDF 更新越即时，也越容易在高频输入时占用 CPU。',
      `<input type="range" id="set-preview-delay" min="600" max="4000" step="100" value="${escapeAttr(delay)}"><span class="range-val" id="set-preview-delay-val">${escapeHtml(delay)}ms</span>`)}
    ${settingsRow('浏览器编译引擎', '默认自动识别 ctex / fontspec 等中文与字体设置。', localSelect)}
    ${settingsRow('GitHub Actions 引擎', '使用远程工作流编译时的默认引擎。', select)}
    ${settingsRow('重新编译', '立即用内置 TeX 引擎从当前源码重新生成 PDF。', '<button type="button" class="btn btn-soft" id="set-reflow">重新编译 PDF</button>')}
    <div class="modal-note" style="margin-top:16px">PDF 在浏览器里由真实的 TeX 引擎编译。首次编译会从 CDN 下载约 15 MB 引擎资源，经 SHA-256 校验后缓存在本机；之后编辑会自动重编译，也能离线使用。源码与 PDF 都不会上传。</div>
  </div>`;
}

function settingsProjectPane() {
  const texFiles = Array.from(state.files.values()).filter((f) => f.text != null && /\.tex$/i.test(f.path));
  const mainOptions = texFiles.map((f) => `<option value="${escapeAttr(f.path)}"${f.path === state.mainPath ? ' selected' : ''}>${escapeHtml(f.path)}</option>`).join('');
  const isGithub = state.mode === 'github';
  return `<div class="settings-pane" data-settings-pane="project" hidden>
    <h3>项目</h3>
    <p class="settings-lede">${isGithub ? `当前项目直接来自 ${escapeHtml(state.repo ? state.repo.full : 'GitHub')}。` : '示例项目保存在本机浏览器中。'}</p>
    ${settingsRow('主文件', '预览和编译脚本都从这里开始。', `<select id="set-main-file">${mainOptions || '<option>没有 .tex 文件</option>'}</select>`)}
    ${settingsRow('导出项目', '把当前全部文件打包为 ZIP，包含图片与参考文献。', '<button type="button" class="btn btn-soft" id="set-export-zip">导出 ZIP</button>')}
    ${settingsRow('导入文件', '把本地文件或文件夹加入当前项目。', '<button type="button" class="btn btn-soft" id="set-import-files">导入…</button>')}
    ${!isGithub ? settingsRow('本机快照', '把当前草稿记录为一个可恢复的版本。', '<button type="button" class="btn btn-soft" id="set-snapshot">保存快照</button>') : ''}
    ${isGithub ? settingsRow('下载编译后的 PDF', '如果本次会话已经编译成功。', `<button type="button" class="btn btn-soft" id="set-download-pdf"${state.pdfBlob ? '' : ' disabled'}>下载 PDF</button>`) : ''}
    <div class="modal-note" style="margin-top:16px">仓库里只有普通的 .tex、.bib 与图片文件，没有私有格式。退出 Qelemchi 之后，你仍然可以用 Git、Overleaf 或 arXiv 继续。</div>
  </div>`;
}

function settingsGithubPane() {
  const isGithub = state.mode === 'github';
  const rememberLabel = state.remember === 'device' ? '本机加密保存' : state.remember === 'passphrase' ? '口令解锁' : '仅本次会话';
  const repo = state.repo;
  let html = `<div class="settings-pane" data-settings-pane="github" hidden><h3>GitHub</h3><p class="settings-lede">浏览器直连 api.github.com。论文内容不经过任何中间服务器。</p>`;
  if (state.user) {
    html += `<div class="gh-account"><div class="gh-account-avatar">${escapeHtml(initialsOfUser(state.user))}</div>
      <div class="gh-account-info"><b>${escapeHtml(state.user.name || state.user.login)}</b><small>@${escapeHtml(state.user.login)}</small></div>
      <button type="button" class="btn btn-soft" id="set-open-profile">GitHub 主页</button></div>`;
  }
  if (isGithub && repo) {
    html += settingsRow('论文仓库', `${repo.full} · 分支 ${state.branch} · ${repo.private ? '私有' : '公开'}`,
      '<button type="button" class="btn btn-soft" id="set-open-repo">打开仓库</button>');
    html += settingsRow('刷新仓库', '从 GitHub 重新读取最新提交与文件。', '<button type="button" class="btn btn-soft" id="set-refresh-repo">刷新</button>');
  }
  html += settingsRow('令牌保存方式', isGithub ? `当前：${rememberLabel}。更改需要重新连接。` : '连接 GitHub 时可以选择保存方式。',
    '<button type="button" class="btn btn-soft" id="set-change-token">更换令牌</button>');
  html += `<div class="modal-note" style="margin-top:16px">建议使用 fine-grained token：只授权这篇论文的仓库，Contents 读写；需要编译 PDF 时再给 Actions 读写。令牌不会进入仓库，也不会出现在 URL 或 localStorage 中。</div>`;
  html += `<div class="settings-danger"><button type="button" class="btn danger" id="set-disconnect">${isGithub ? '断开 GitHub' : '清除本机数据'}</button></div>`;
  html += '</div>';
  return html;
}

function settingsAboutPane() {
  return `<div class="settings-pane" data-settings-pane="about" hidden>
    <h3>Qelemchi</h3>
    <p class="settings-lede">把论文写在 GitHub 上。单 HTML 文件，无后端。</p>
    <div class="about-block">
      <p>Qelemchi 借用 <code>Ilimchi</code> 的存储思想：没有数据库，没有服务器，仓库就是唯一的数据源。一次保存展开为 Git Data API 上的 blob、tree、commit 与 ref 更新，因此提交历史就是论文的版本历史。</p>
      <p>预览由一个保守的 LaTeX 子集排版器生成，公式交给 MathJax。它不是 TeX 的替代品；需要最终稿时，点击“编译 PDF”让仓库里的 Actions 用真实 TeX Live 编译。</p>
      <p>源码与图片都属于你。这个 HTML 文件本身也可以保存到仓库里，作为工具的一份副本。</p>
    </div>
    <div class="about-meta">Qelemchi v1.0 · 单 HTML 文件<br>存储模型：GitHub Git Data API<br>预览引擎：TeXPreview 1.0 · MathJax 3 · CodeMirror 5</div>
  </div>`;
}

function openSettings(initialTab = 'editor') {
  const nav = settingsNavItems();
  const body = `<div class="settings-wrap">
    <nav class="settings-nav" aria-label="设置分类">
      ${nav.map((item) => `<button type="button" data-settings-tab="${item.id}" class="${item.id === initialTab ? 'active' : ''}">${iconSvg(item.icon)}<span>${escapeHtml(item.label)}</span></button>`).join('')}
    </nav>
    <div class="settings-content">
      ${settingsEditorPane()}
      ${settingsAppearancePane()}
      ${settingsPreviewPane()}
      ${settingsProjectPane()}
      ${settingsGithubPane()}
      ${settingsAboutPane()}
    </div>
  </div>`;
  const modal = openModal({
    title: '设置',
    subtitle: '编辑器、预览与 GitHub 连接',
    size: 'modal-settings',
    bodyClass: 'flush',
    body,
    actions: [{ label: '完成', kind: 'primary' }]
  });
  if (!modal) return;
  modal.body.querySelectorAll('[data-settings-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      modal.body.querySelectorAll('[data-settings-tab]').forEach((b) => b.classList.toggle('active', b === btn));
      modal.body.querySelectorAll('[data-settings-pane]').forEach((pane) => {
        pane.hidden = pane.dataset.settingsPane !== btn.dataset.settingsTab;
      });
    });
  });
  wireSettingsControls(modal);
}

function wireSettingsControls(modal) {
  const body = modal.body;
  const save = () => saveSettings(state.settings);

  const font = body.querySelector('#set-font-size');
  if (font) {
    const val = body.querySelector('#set-font-size-val');
    font.addEventListener('input', () => {
      const size = Number(font.value) || 13.5;
      state.settings.fontSize = size;
      if (val) val.textContent = `${size}px`;
      save();
      applyEditorSettings();
    });
  }
  bindSwitch(body.querySelector('#set-line-numbers'), (on) => {
    state.settings.lineNumbers = on;
    save();
    applyEditorSettings();
  });
  bindSwitch(body.querySelector('#set-line-wrapping'), (on) => {
    state.settings.lineWrapping = on;
    save();
    applyEditorSettings();
  });
  body.querySelectorAll('[data-theme-choice]').forEach((btn) => {
    btn.addEventListener('click', () => {
      body.querySelectorAll('[data-theme-choice]').forEach((b) => b.classList.toggle('active', b === btn));
      applyTheme(btn.dataset.themeChoice);
    });
  });
  const delay = body.querySelector('#set-preview-delay');
  if (delay) {
    const val = body.querySelector('#set-preview-delay-val');
    delay.addEventListener('input', () => {
      const ms = Number(delay.value) || 2200;
      state.settings.localCompileDelay = ms;
      state.settings.previewDelay = ms;
      if (val) val.textContent = `${ms}ms`;
      save();
    });
  }
  const engine = body.querySelector('#set-compile-engine');
  if (engine) {
    engine.addEventListener('change', () => {
      state.settings.compileEngine = engine.value;
      save();
      updateStorageUI();
    });
  }
  const localEngine = body.querySelector('#set-local-engine');
  if (localEngine) {
    localEngine.addEventListener('change', () => {
      state.settings.localEngine = localEngine.value;
      save();
      if (state.pdfSource === 'local' && state.localTex.stale) scheduleLocalCompile(200);
    });
  }
  const reflow = body.querySelector('#set-reflow');
  if (reflow) reflow.addEventListener('click', () => {
    modal.close();
    if (localTexEnabled()) {
      runLocalCompile({ force: true, manual: true, reason: 'settings' });
    } else if (state.mode === 'github') {
      openCompile();
    } else {
      toast({ type: 'info', title: '无法编译 PDF', desc: '这个构建没有内置 TeX 引擎，请连接 GitHub 仓库后用 Actions 编译。' });
    }
  });
  const main = body.querySelector('#set-main-file');
  if (main) {
    main.addEventListener('change', () => {
      if (!main.value) return;
      state.mainPath = main.value;
      updateProjectTitle();
      schedulePreview(0);
      toast({ type: 'success', title: '主文件已切换', desc: main.value });
    });
  }
  const exportZip = body.querySelector('#set-export-zip');
  if (exportZip) exportZip.addEventListener('click', exportProjectZip);
  const importFiles = body.querySelector('#set-import-files');
  if (importFiles) importFiles.addEventListener('click', () => {
    modal.close();
    $('#file-upload').click();
  });
  const snapshot = body.querySelector('#set-snapshot');
  if (snapshot) snapshot.addEventListener('click', async () => {
    modal.close();
    await saveDemoSnapshot();
  });
  const downloadPdf = body.querySelector('#set-download-pdf');
  if (downloadPdf) downloadPdf.addEventListener('click', () => {
    if (!state.pdfBlob) return;
    downloadBlob(state.pdfBlob, `${safeFileName(state.projectTitle)}.pdf`);
  });

  const openProfile = body.querySelector('#set-open-profile');
  if (openProfile) openProfile.addEventListener('click', () => window.open(state.user.html_url, '_blank', 'noopener'));
  const openRepo = body.querySelector('#set-open-repo');
  if (openRepo) openRepo.addEventListener('click', () => {
    if (state.repo) window.open(githubRepoUrl(state.repo.owner, state.repo.name), '_blank', 'noopener');
  });
  const refresh = body.querySelector('#set-refresh-repo');
  if (refresh) refresh.addEventListener('click', () => {
    modal.close();
    refreshFromGitHub();
  });
  const changeToken = body.querySelector('#set-change-token');
  if (changeToken) changeToken.addEventListener('click', () => {
    modal.close();
    showOnboarding({ prefillRepo: state.repo ? state.repo.full : '', keepToken: false });
  });
  const disconnect = body.querySelector('#set-disconnect');
  if (disconnect) disconnect.addEventListener('click', async () => {
    modal.close();
    if (state.mode === 'github') await disconnectGitHub();
    else await clearLocalWorkspace();
  });
}

function bindSwitch(node, onChange) {
  if (!node) return;
  node.addEventListener('click', () => {
    const next = node.getAttribute('aria-checked') !== 'true';
    node.setAttribute('aria-checked', next ? 'true' : 'false');
    onChange(next);
  });
}

function safeFileName(name) {
  const cleaned = String(name || 'paper')
    .replace(/[\\/:*?"<>|\n\r]+/g, '-')
    .replace(/[：]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s-]+|[.\s-]+$/g, '')
    .slice(0, 80)
    .replace(/[.\s-]+$/g, '');
  return cleaned || 'paper';
}

function exportProjectZip() {
  const files = Array.from(state.files.values());
  if (!files.length) {
    toast({ type: 'error', title: '没有可导出的文件' });
    return;
  }
  try {
    const encoder = new TextEncoder();
    const entries = files.map((file) => ({
      path: file.path,
      bytes: file.text != null ? encoder.encode(file.text) : base64ToBytes(file.base64 || ''),
      date: new Date()
    }));
    const blob = buildZip(entries);
    downloadBlob(blob, `${safeFileName(state.projectTitle)}.zip`);
    toast({ type: 'success', title: '项目已导出', desc: `${files.length} 个文件 · ${formatBytes(blob.size)}` });
  } catch (e) {
    toast({ type: 'error', title: '导出失败', desc: e.message || String(e) });
  }
}

async function disconnectGitHub() {
  const ok = await confirmDialog(
    '断开 GitHub？',
    '会清除本机保存的访问令牌，并回到示例项目。仓库与其中的论文不会受到任何影响。',
    { confirmLabel: '断开', danger: true }
  );
  if (!ok) return;
  try {
    await clearAllTokens();
  } catch (e) { /* ignore */ }
  clearSessionMeta();
  state.token = '';
  state.user = null;
  state.repo = null;
  state.hasWorkflow = false;
  state.branch = 'main';
  state.remember = 'session';
  state.offline = false;
  setMode('demo');
  clearPdf();
  await loadDemoWorkspace();
  renderTree();
  renderTabs();
  if (state.activePath) openFile(state.activePath);
  renderSaveState();
  updateStorageUI();
  updateProjectTitle();
  schedulePreview(0);
  showOnboarding({ prefillRepo: '' });
  toast({ type: 'success', title: '已断开 GitHub', desc: '现在使用的是本机示例项目。' });
}

async function clearLocalWorkspace() {
  const ok = await confirmDialog(
    '清除本机数据？',
    '会删除浏览器中保存的示例草稿、快照与加密令牌。GitHub 仓库不受影响。',
    { confirmLabel: '清除', danger: true }
  );
  if (!ok) return;
  await clearAllLocalData();
  await clearAllTokens();
  clearSessionMeta();
  toast({ type: 'success', title: '本机数据已清除' });
  setTimeout(() => window.location.reload(), 500);
}

function openTemplateChooser() {
  const cards = ['demo', 'cvpr', 'neurips', 'blank', 'conference'].map((id) => {
    const meta = templateMeta(id);
    return `<button type="button" class="template-card" data-template="${id}">
      <div class="template-thumb"><div class="tt-title"></div><div class="tt-sub"></div>
        <div class="tt-line"></div><div class="tt-line"></div><div class="tt-line tt-short"></div>
        <div class="tt-line"></div><div class="tt-line tt-short"></div></div>
      <b>${escapeHtml(meta.name)}</b><small>${escapeHtml(meta.description)}</small>
    </button>`;
  }).join('');
  const modal = openModal({
    title: '选择起始模板',
    subtitle: '模板会替换当前工作区中的文件。',
    size: 'modal-lg',
    body: `<div class="template-grid">${cards}</div>` +
      `<div class="modal-note" style="margin-top:14px">${state.mode === 'github' ? '在已连接的项目中应用模板会把它当作一次本地修改，提交后才会写入仓库。' : '示例与模板只保存在本机，随时可以连接 GitHub。'}</div>`,
    actions: [{ label: '取消', kind: 'ghost' }]
  });
  if (!modal) return;
  modal.body.querySelectorAll('[data-template]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.template;
      if (hasChanges()) {
        const ok = await confirmDialog('替换当前工作区？', '尚未保存的修改会被模板内容替换。', { confirmLabel: '替换', danger: true });
        if (!ok) return;
      }
      const previousPaths = state.mode === 'github' ? Array.from(state.files.keys()) : [];
      applyTemplate(id);
      clearChanges();
      if (state.mode === 'github') {
        for (const path of previousPaths) {
          if (!state.files.has(path)) state.deleted.add(path);
        }
        for (const path of state.files.keys()) markDirty(path);
        updateStorageUI();
        renderSaveState();
      }
      renderTree();
      renderTabs();
      if (state.activePath) openFile(state.activePath);
      renderSaveState();
      updateStorageUI();
      updateProjectTitle();
      schedulePreview(0);
      modal.close();
      toast({ type: 'success', title: '已应用模板', desc: templateMeta(id).name });
    });
  });
}
