/* ==========================================================================
   Qelemchi · file tree, outline, project search, uploads
   ========================================================================== */

function buildFileTree() {
  const root = { name: '', path: '', folders: new Map(), files: [] };
  for (const file of state.files.values()) {
    const parts = file.path.split('/');
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!node.folders.has(part)) {
        node.folders.set(part, {
          name: part,
          path: parts.slice(0, i + 1).join('/'),
          folders: new Map(),
          files: []
        });
      }
      node = node.folders.get(part);
    }
    node.files.push(file);
  }
  return root;
}

function renderTree() {
  const wrap = $('#file-tree');
  if (!wrap) return;
  const root = buildFileTree();
  const frag = document.createDocumentFragment();
  const renderNode = (node, depth) => {
    const folders = Array.from(node.folders.values()).sort((a, b) => a.name.localeCompare(b.name));
    const files = node.files.slice().sort((a, b) => a.path.localeCompare(b.path));
    for (const folder of folders) {
      const open = !state.collapsed.has(folder.path);
      const row = document.createElement('div');
      row.className = `tree-row is-folder${open ? ' is-open' : ''}`;
      row.dataset.path = folder.path;
      row.dataset.folder = '1';
      row.style.paddingLeft = `${8 + depth * 13}px`;
      row.innerHTML = `<span class="twisty${open ? ' open' : ''}" aria-hidden="true"><svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.3"><path d="m3 2 4 3-4 3"/></svg></span>${folderIconSvg(open)}<span class="tree-name">${escapeHtml(folder.name)}</span><span class="tree-size">${folder.files.length + folder.folders.size}</span>`;
      row.addEventListener('click', () => {
        if (state.collapsed.has(folder.path)) state.collapsed.delete(folder.path);
        else state.collapsed.add(folder.path);
        renderTree();
      });
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showFolderMenu(folder.path, row);
      });
      frag.appendChild(row);
      if (open) renderNode(folder, depth + 1);
    }
    for (const file of files) {
      const row = document.createElement('div');
      row.className = `tree-row tree-file${file.path === state.activePath ? ' active' : ''}${state.dirty.has(file.path) ? ' dirty' : ''}`;
      row.dataset.path = file.path;
      row.style.paddingLeft = `${8 + depth * 13 + 13}px`;
      row.innerHTML = `${fileIconSvg(file.path)}<span class="tree-name">${escapeHtml(pathBase(file.path))}</span>` +
        (state.dirty.has(file.path) ? '<span class="dirty-dot"></span>' : `<span class="tree-size">${formatBytes(file.size || 0)}</span>`) +
        `<button type="button" class="tree-more" aria-label="文件操作">${iconSvg('gear')}</button>`;
      row.title = file.path;
      row.addEventListener('click', (e) => {
        if (e.target.closest('.tree-more')) {
          e.stopPropagation();
          showFileMenu(file.path, row.querySelector('.tree-more'));
          return;
        }
        openFile(file.path);
      });
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showFileMenu(file.path, row);
      });
      frag.appendChild(row);
    }
  };
  renderNode(root, 0);
  if (!frag.childNodes.length) {
    const empty = document.createElement('div');
    empty.className = 'tree-empty';
    empty.innerHTML = `<div>还没有文件</div><button type="button" class="btn btn-soft" style="margin-top:10px">新建 main.tex</button>`;
    empty.querySelector('button').addEventListener('click', () => newFileFlow('main.tex'));
    frag.appendChild(empty);
  }
  wrap.innerHTML = '';
  wrap.appendChild(frag);
}

function showFileMenu(path, anchor) {
  const file = state.files.get(path);
  if (!file) return;
  showMenu(anchor, [
    { label: '打开', icon: 'edit', onClick: () => openFile(path) },
    { label: '重命名', icon: 'edit', onClick: () => renameFileFlow(path) },
    { label: '复制副本', icon: 'plus', onClick: () => duplicateFileFlow(path) },
    { label: '复制路径', icon: 'link', onClick: async () => {
      if (await copyText(path)) toast({ type: 'success', title: '路径已复制', desc: path });
    } },
    { label: '下载', icon: 'download', onClick: () => downloadFile(path) },
    { sep: true },
    { label: '删除', icon: 'trash', danger: true, onClick: () => deleteFileFlow(path) }
  ], { align: 'left' });
}

function showFolderMenu(path, anchor) {
  showMenu(anchor, [
    { label: '在此新建文件', icon: 'plus', onClick: () => newFileFlow(`${path}/new-file.tex`) },
    { label: '上传文件到此处', icon: 'upload', onClick: () => { state.uploadTarget = path; $('#file-upload').click(); } },
    { label: '复制路径', icon: 'link', onClick: async () => {
      if (await copyText(path)) toast({ type: 'success', title: '路径已复制', desc: path });
    } },
    { sep: true },
    { label: '删除整个文件夹', icon: 'trash', danger: true, onClick: () => deleteFolderFlow(path) }
  ], { align: 'left' });
}

async function newFileFlow(defaultPath = '') {
  const path = await promptDialog('新建文件', '文件路径', defaultPath || 'sections/new-file.tex', {
    placeholder: 'sections/new-file.tex',
    hint: '可以使用文件夹路径。扩展名决定文件类型，例如 .tex、.bib、.md。'
  });
  if (!path) return;
  const normalized = normalizeProjectPath(path);
  if (!normalized) return;
  if (state.files.has(normalized)) {
    toast({ type: 'error', title: '文件已存在', desc: normalized });
    openFile(normalized);
    return;
  }
  const initial = pathExt(normalized) === '.tex' ? '% 新文件\n\n' : '';
  addFileState(normalized, initial);
  state.collapsed.delete(pathDir(normalized));
  if (!state.mainPath) state.mainPath = normalized;
  renderTree();
  openFile(normalized);
  if (state.mode === 'demo') persistDemoSoon();
  schedulePreview();
  toast({ type: 'success', title: '文件已创建', desc: normalized });
}

async function newFolderFlow() {
  const path = await promptDialog('新建文件夹', '文件夹路径', 'sections', {
    placeholder: 'sections',
    hint: 'Git 不保存空文件夹；Qelemchi 会创建一个 .gitkeep 占位文件。'
  });
  if (!path) return;
  const normalized = normalizeProjectPath(path);
  if (!normalized) return;
  const keep = `${normalized}/.gitkeep`;
  if (state.files.has(keep)) {
    toast({ type: 'warn', title: '文件夹已存在', desc: normalized });
    return;
  }
  addFileState(keep, '');
  state.collapsed.delete(normalized);
  renderTree();
  if (state.mode === 'demo') persistDemoSoon();
  toast({ type: 'success', title: '文件夹已创建', desc: normalized });
}

async function renameFileFlow(oldPath) {
  const next = await promptDialog('重命名文件', '新路径', oldPath, {
    hint: '重命名会先删除旧路径，再创建新路径；提交后在 Git 历史中表现为一次改动。'
  });
  if (!next || next === oldPath) return;
  if (!renameFileState(oldPath, next)) {
    toast({ type: 'error', title: '无法重命名', desc: '目标路径已存在或无效。' });
    return;
  }
  renderTree();
  renderTabs();
  if (state.activePath === next) openFile(next);
  schedulePreview();
  if (state.mode === 'demo') persistDemoSoon();
  toast({ type: 'success', title: '已重命名', desc: next });
}

async function duplicateFileFlow(path) {
  const file = state.files.get(path);
  if (!file) return;
  const suggested = `${pathStem(path)}-copy${pathExt(path)}`;
  const next = await promptDialog('复制文件', '新路径', suggested);
  if (!next) return;
  const normalized = normalizeProjectPath(next);
  if (!normalized || state.files.has(normalized)) {
    toast({ type: 'error', title: '目标路径已存在或无效' });
    return;
  }
  if (file.text != null) addFileState(normalized, file.text);
  else addBinaryFileState(normalized, file.base64, file.mime, file.size);
  rebuildAssetUrls();
  renderTree();
  openFile(normalized);
  schedulePreview();
  if (state.mode === 'demo') persistDemoSoon();
}

async function deleteFileFlow(path) {
  const file = state.files.get(path);
  if (!file) return;
  const ok = await confirmDialog(
    '删除文件',
    `确定从项目中删除 ${path} 吗？${state.mode === 'github' ? '下次提交时，仓库中的对应文件也会被删除。' : '本机草稿会立即更新。'}`,
    { confirmLabel: '删除', danger: true }
  );
  if (!ok) return;
  removeFileState(path);
  renderTree();
  renderTabs();
  if (!state.activePath) {
    const first = state.openTabs[0] || state.files.keys().next().value;
    if (first) openFile(first);
    else if (editor) {
      editorSuppress = true;
      editor.setValue('');
      editorSuppress = false;
    }
  } else {
    openFile(state.activePath);
  }
  schedulePreview();
  if (state.mode === 'demo') persistDemoSoon();
  toast({ type: 'success', title: '已删除', desc: path });
}

async function deleteFolderFlow(path) {
  const prefix = `${normalizeProjectPath(path)}/`;
  const victims = Array.from(state.files.keys()).filter((p) => p.startsWith(prefix));
  if (!victims.length) return;
  const ok = await confirmDialog('删除文件夹', `确定删除 ${path} 下的 ${victims.length} 个文件吗？此操作只影响下一次提交，Git 历史仍然保留。`, { confirmLabel: '删除文件夹', danger: true });
  if (!ok) return;
  for (const p of victims) removeFileState(p);
  renderTree();
  renderTabs();
  if (state.activePath && !state.files.has(state.activePath)) {
    const first = state.openTabs[0] || state.files.keys().next().value;
    if (first) openFile(first);
  }
  schedulePreview();
  if (state.mode === 'demo') persistDemoSoon();
  toast({ type: 'success', title: '文件夹已删除', desc: path });
}

function downloadFile(path) {
  const file = state.files.get(path);
  if (!file) return;
  if (file.text != null) downloadBlob(new Blob([file.text], { type: 'text/plain;charset=utf-8' }), pathBase(path));
  else downloadBlob(new Blob([base64ToBytes(file.base64 || '')], { type: file.mime || mimeFor(path) }), pathBase(path));
}

async function uploadFiles(fileList, targetDir = '') {
  const files = Array.from(fileList || []);
  if (!files.length) return;
  let uploaded = 0;
  let skipped = 0;
  for (const f of files) {
    if (f.size > 12 * 1024 * 1024) {
      skipped++;
      continue;
    }
    let rel = f.webkitRelativePath || f.name;
    rel = normalizeProjectPath(rel);
    if (targetDir) rel = normalizeProjectPath(`${targetDir}/${rel}`);
    if (!rel) continue;
    if (state.files.has(rel)) {
      const overwrite = await confirmDialog('文件已存在', `${rel} 已经存在，是否覆盖？`, { confirmLabel: '覆盖' });
      if (!overwrite) continue;
      state.deleted.delete(rel);
    }
    try {
      if (isTextPath(rel)) {
        const text = await readFileAsText(f);
        addFileState(rel, text);
      } else {
        const buf = await readFileAsArrayBuffer(f);
        addBinaryFileState(rel, bytesToBase64(new Uint8Array(buf)), f.type || mimeFor(rel), f.size);
      }
      uploaded++;
    } catch (e) {
      skipped++;
    }
  }
  state.uploadTarget = '';
  rebuildAssetUrls();
  if (!state.mainPath) state.mainPath = detectMainFromState();
  renderTree();
  const firstText = Array.from(state.files.values()).find((f) => f.text != null);
  if (firstText && !state.activePath) openFile(firstText.path);
  schedulePreview();
  if (state.mode === 'demo') persistDemoSoon();
  if (uploaded) toast({ type: 'success', title: `已上传 ${uploaded} 个文件`, desc: skipped ? `${skipped} 个文件因大小或读取失败被跳过。` : '文件已加入项目。' });
  else toast({ type: 'error', title: '没有上传文件', desc: '文件可能超过 12 MB 或读取失败。' });
}

function refreshOutline() {
  const list = $('#outline-list');
  if (!list) return;
  state.outline = TeXPreview.scanOutline({ files: textFilesForPreview(), mainPath: state.mainPath });
  const count = $('#outline-count');
  if (count) count.textContent = state.outline.length ? `${state.outline.length}` : '';
  if (!state.outline.length) {
    list.innerHTML = '<div class="pane-empty">正文中还没有章节标题。以 \\section{...} 开始。</div>';
    return;
  }
  list.innerHTML = state.outline.map((item) => {
    const lvl = clamp(item.level + 1, 1, 3);
    return `<button type="button" class="outline-item lvl-${lvl}" data-file="${escapeAttr(item.file)}" data-line="${item.line}">` +
      `<span class="ol-num">${item.starred ? '·' : (item.level === 0 ? '§' : '')}</span>` +
      `<span class="ol-title">${escapeHtml(item.title)}</span>` +
      `${item.file !== state.mainPath ? `<span class="ol-file">${escapeHtml(pathBase(item.file))}</span>` : ''}` +
      `</button>`;
  }).join('');
  list.querySelectorAll('.outline-item').forEach((btn) => {
    btn.addEventListener('click', () => openFile(btn.dataset.file, Number(btn.dataset.line)));
  });
}

function runProjectSearch(query) {
  state.searchQuery = String(query || '').trim();
  const wrap = $('#search-results');
  const count = $('#search-count');
  if (!wrap) return;
  if (!state.searchQuery) {
    wrap.innerHTML = '<div class="pane-empty">输入关键词，搜索项目中的全部文本文件。</div>';
    if (count) count.textContent = '';
    return;
  }
  const q = state.searchQuery.toLowerCase();
  const groups = [];
  let total = 0;
  const files = Array.from(state.files.values()).filter((f) => f.text != null).sort((a, b) => a.path.localeCompare(b.path));
  for (const file of files) {
    const lines = splitLines(file.text);
    const hits = [];
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(q)) {
        hits.push({ line: i + 1, text: lines[i] });
        total++;
        if (hits.length >= 12 || total >= 120) break;
      }
    }
    if (hits.length) groups.push({ file: file.path, hits });
    if (total >= 120) break;
  }
  if (count) count.textContent = total ? `${total}${total >= 120 ? '+' : ''}` : '';
  if (!groups.length) {
    wrap.innerHTML = `<div class="pane-empty">没有找到“${escapeHtml(state.searchQuery)}”。</div>`;
    return;
  }
  wrap.innerHTML = groups.map((g) => `<div class="search-file-block">` +
    `<div class="search-file-head">${fileIconSvg(g.file, 13)}<span>${escapeHtml(g.file)}</span><small>${g.hits.length}</small></div>` +
    g.hits.map((h) => `<button type="button" class="search-hit" data-file="${escapeAttr(g.file)}" data-line="${h.line}">` +
      `<span class="search-hit-line">${h.line}</span><span class="search-hit-text">${highlightMatch(h.text.trim(), state.searchQuery)}</span></button>`).join('') +
    `</div>`).join('');
  wrap.querySelectorAll('.search-hit').forEach((btn) => {
    btn.addEventListener('click', () => openFile(btn.dataset.file, Number(btn.dataset.line)));
  });
}

function setSideTab(name) {
  state.sideTab = name;
  document.querySelectorAll('[data-side-tab]').forEach((tab) => {
    const active = tab.dataset.sideTab === name;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  document.querySelectorAll('[data-side-pane]').forEach((pane) => {
    pane.hidden = pane.dataset.sidePane !== name;
  });
  if (name === 'outline') refreshOutline();
  if (name === 'search') setTimeout(() => $('#project-search')?.focus(), 40);
}

function updateStorageUI() {
  const repoName = state.mode === 'github' && state.repo ? state.repo.full : '本机示例';
  const storageRepo = $('#storage-repo');
  if (storageRepo) storageRepo.textContent = repoName;
  const badge = $('#storage-badge');
  if (badge) badge.textContent = state.mode === 'github' ? (state.repo && state.repo.private ? 'PRIVATE' : 'GITHUB') : 'LOCAL';
  const sub = $('#storage-sub');
  if (sub) {
    if (state.mode === 'github') {
      const branch = state.branch || 'main';
      sub.textContent = `${branch} · 每次提交都是一个版本`;
    } else {
      sub.textContent = '修改自动保存在浏览器';
    }
  }
  const connect = $('#btn-connect');
  if (connect) connect.hidden = state.mode === 'github';
  const pill = $('#repo-pill-text');
  if (pill) pill.textContent = state.mode === 'github' && state.repo ? state.repo.full : '示例项目';
  const repoPill = $('#repo-pill');
  if (repoPill) repoPill.title = state.mode === 'github' ? '打开 GitHub 仓库' : '连接 GitHub 仓库';
  const conn = $('#conn-state');
  if (conn) {
    conn.classList.toggle('github', state.mode === 'github' && !state.offline);
    conn.classList.toggle('demo', state.mode !== 'github');
    conn.classList.toggle('offline', state.offline);
    const span = conn.querySelector('span');
    if (span) span.textContent = state.mode === 'github' ? (state.offline ? 'GitHub 离线' : (state.repo && state.repo.private ? '私有仓库' : 'GitHub 已连接')) : '本机示例';
  }
  const statusRepo = $('#status-repo');
  if (statusRepo) statusRepo.textContent = state.mode === 'github' && state.repo ? state.repo.full : '未连接 GitHub';
  const initials = $('#avatar-initials');
  if (initials) initials.textContent = state.user ? initialsOfUser(state.user) : (state.mode === 'github' ? 'GH' : 'TF');
  const account = $('#btn-account');
  if (account) account.classList.toggle('is-demo', state.mode !== 'github');
  const engine = $('#status-engine');
  if (engine) {
    const eng = state.preview && state.preview.meta ? state.preview.meta.engine : (state.settings.compileEngine || 'xelatex');
    engine.textContent = `预览 · ${String(eng).replace('latex', 'LaTeX').replace('xeLaTeX', 'XeLaTeX').replace('pdflatex', 'pdfLaTeX').replace('lualatex', 'LuaLaTeX')}`;
  }
  showDemoBanner(state.mode === 'demo' && !state.demoDismissed);
  renderSaveState();
}

function initialsOfUser(user) {
  if (!user) return 'TF';
  if (user.name) return initials(user.name);
  return initials(user.login);
}

function initTreeEvents() {
  document.querySelectorAll('[data-file-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.fileAction;
      if (action === 'new') newFileFlow();
      else if (action === 'folder') newFolderFlow();
      else if (action === 'upload') { state.uploadTarget = ''; $('#file-upload').click(); }
      else if (action === 'refresh') refreshFromGitHub();
    });
  });
  document.querySelectorAll('[data-side-tab]').forEach((tab) => {
    tab.addEventListener('click', () => setSideTab(tab.dataset.sideTab));
  });
  const search = $('#project-search');
  if (search) {
    const run = debounce(() => runProjectSearch(search.value), 110);
    search.addEventListener('input', run);
    search.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { search.value = ''; runProjectSearch(''); search.blur(); }
    });
  }
  const upload = $('#file-upload');
  if (upload) {
    upload.addEventListener('change', () => {
      const target = state.uploadTarget || '';
      uploadFiles(upload.files, target);
      upload.value = '';
    });
  }
  const dirUpload = $('#dir-upload');
  if (dirUpload) {
    dirUpload.addEventListener('change', () => {
      uploadFiles(dirUpload.files, '');
      dirUpload.value = '';
    });
  }
  const drop = $('#editor-drop');
  const wrap = $('#editor-wrap');
  if (wrap) {
    let dragDepth = 0;
    wrap.addEventListener('dragenter', (e) => {
      if (!e.dataTransfer || !e.dataTransfer.types.includes('Files')) return;
      e.preventDefault();
      dragDepth++;
      if (drop) drop.hidden = false;
    });
    wrap.addEventListener('dragover', (e) => {
      if (!e.dataTransfer || !e.dataTransfer.types.includes('Files')) return;
      e.preventDefault();
    });
    wrap.addEventListener('dragleave', () => {
      dragDepth = Math.max(0, dragDepth - 1);
      if (!dragDepth && drop) drop.hidden = true;
    });
    wrap.addEventListener('drop', (e) => {
      if (!e.dataTransfer || !e.dataTransfer.files.length) return;
      e.preventDefault();
      dragDepth = 0;
      if (drop) drop.hidden = true;
      const target = state.activePath ? pathDir(state.activePath) : '';
      uploadFiles(e.dataTransfer.files, target);
    });
  }
  const fileActions = $('#btn-file-actions');
  if (fileActions) {
    fileActions.addEventListener('click', () => {
      const active = state.activePath;
      showMenu(fileActions, [
        { label: '新建文件', icon: 'plus', onClick: () => newFileFlow() },
        { label: '新建文件夹', icon: 'folder', onClick: newFolderFlow },
        { label: '上传文件', icon: 'upload', onClick: () => { state.uploadTarget = ''; $('#file-upload').click(); } },
        { label: '上传文件夹', icon: 'upload', onClick: () => $('#dir-upload').click() },
        { sep: true },
        { label: '关闭当前标签', icon: 'x', disabled: !active, onClick: () => active && closeTab(active) },
        { label: '关闭其他标签', icon: 'x', disabled: !active, onClick: () => active && closeOtherTabs(active) },
        { sep: true },
        { label: '刷新仓库', icon: 'refresh', onClick: refreshFromGitHub }
      ], { align: 'left' });
    });
  }
  const demoDismiss = $('#demo-dismiss');
  if (demoDismiss) {
    demoDismiss.addEventListener('click', () => {
      state.demoDismissed = true;
      showDemoBanner(false);
    });
  }
  const repoPill = $('#repo-pill');
  if (repoPill) {
    repoPill.addEventListener('click', () => {
      if (state.mode === 'github' && state.repo) window.open(githubRepoUrl(state.repo.owner, state.repo.name), '_blank', 'noopener');
      else showOnboarding();
    });
  }
}
