/* ==========================================================================
   Qelemchi · saving, snapshots and repository refresh
   ========================================================================== */

function defaultCommitMessage(changes) {
  if (!changes.length) return 'Update paper';
  if (changes.length === 1) {
    const c = changes[0];
    if (c.delete) return `删除 ${c.path}`;
    if (c.path === state.mainPath) return '更新主文件';
    return `更新 ${c.path}`;
  }
  return `更新 ${changes.length} 个文件`;
}

function changeKind(change) {
  if (change.delete) return '删除';
  const file = state.files.get(change.path);
  return file && file.sha ? '修改' : '新增';
}

async function saveProject() {
  if (state.save.busy) return;
  if (state.mode === 'demo') {
    await saveDemoSnapshot();
    return;
  }
  if (!state.connected || !state.repo) {
    showOnboarding();
    toast({ type: 'info', title: '先连接一个 GitHub 仓库', desc: '连接之后，每次保存都会成为一次真实的提交。' });
    return;
  }
  const changes = changesForCommit();
  if (!changes.length) {
    toast({ type: 'success', title: '没有需要提交的修改', desc: '工作区已经与仓库同步。' });
    return;
  }
  openCommitDialog(changes);
}

async function saveDemoSnapshot() {
  try {
    const record = await createDemoSnapshot('本机保存');
    await persistDemoNow();
    clearChanges();
    state.lastSaved = Date.now();
    renderSaveState();
    refreshDirtyIndicators();
    toast({ type: 'success', title: '已保存本机快照', desc: `${record.files.length} 个文件 · 可在版本历史中回到这一版` });
  } catch (e) {
    toast({ type: 'error', title: '保存失败', desc: e.message || String(e) });
  }
}

function openCommitDialog(changes) {
  const list = changes.slice(0, 40).map((change) => {
    const kind = changeKind(change);
    return `<div class="commit-file${change.delete ? ' is-delete' : ''}"><span class="cf-icon">${iconSvg(change.delete ? 'trash' : 'file')}</span>` +
      `<span class="cf-path">${escapeHtml(change.path)}</span><span class="cf-kind">${kind}</span></div>`;
  }).join('');
  const more = changes.length > 40 ? `<div class="commit-count" style="padding:7px 10px 0">另有 ${changes.length - 40} 个文件…</div>` : '';
  const body = `<div class="field">
      <label for="commit-message">提交说明</label>
      <input id="commit-message" type="text" value="${escapeAttr(defaultCommitMessage(changes))}" autocomplete="off" spellcheck="false" maxlength="120">
      <div class="field-hint">每次保存对应仓库中的一次 commit；提交历史就是论文的版本历史。</div>
    </div>
    <div class="modal-section">
      <div class="modal-section-title">本次提交 · ${changes.length} 个文件</div>
      <div class="commit-files">${list || '<div class="commit-file"><span class="cf-path">没有文件</span></div>'}${more}</div>
    </div>
    <div class="modal-note" style="margin-top:14px">提交会以非强制方式推进分支。如果远程仓库在此期间有了新的提交，Qelemchi 会停下来提示你先刷新，而不是覆盖别人的工作。</div>`;

  const modal = openModal({
    title: '提交到 GitHub',
    eyebrow: state.repo ? `${state.repo.full} · ${state.branch}` : '',
    subtitle: '论文源码将以原子提交写入你的仓库。',
    size: 'modal-lg',
    body,
    actions: [
      { label: '取消', kind: 'ghost' },
      { label: '提交', kind: 'primary', onClick: async (api) => {
        const input = api.body.querySelector('#commit-message');
        const message = (input.value || '').trim() || defaultCommitMessage(changes);
        await commitProject(message, api);
      } }
    ]
  });
  if (!modal) return;
  const input = modal.body.querySelector('#commit-message');
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      const btn = modal.foot && modal.foot.querySelector('.btn-primary');
      if (btn) btn.click();
    }
  });
}

async function commitProject(message, modalApi) {
  if (state.save.busy) return;
  const repo = state.repo;
  if (!repo) throw new Error('还没有连接仓库。');
  const changes = changesForCommit();
  if (!changes.length) {
    toast({ type: 'success', title: '没有需要提交的修改' });
    return;
  }
  state.save.busy = true;
  state.save.error = '';
  renderSaveState();
  if (modalApi && modalApi.setBusy) modalApi.setBusy(true, '正在提交…');
  try {
    const result = await ghCommitChanges(repo.owner, repo.name, state.branch, changes, message);
    state.lastCommit = result;
    await syncRemoteShas(repo, result);
    clearChanges();
    state.save.busy = false;
    state.save.lastMessage = message;
    renderSaveState();
    refreshDirtyIndicators();
    updateStorageUI();
    toast({
      type: 'success',
      title: '已提交到 GitHub',
      desc: `${String(result.sha || '').slice(0, 7)} · ${describeCommit(message)}`,
      action: { label: '查看历史', onClick: () => openHistory() }
    });
    return result;
  } catch (e) {
    state.save.busy = false;
    renderSaveState();
    if (modalApi && modalApi.setBusy) modalApi.setBusy(false);
    if (e && e.status === 409) {
      toast({
        type: 'error',
        title: '远程仓库有新的提交',
        desc: e.message,
        action: { label: '刷新仓库', onClick: () => refreshFromGitHub() }
      });
    } else {
      state.save.error = e.message || String(e);
      toast({ type: 'error', title: '提交失败', desc: state.save.error });
    }
    return false;
  }
}

async function syncRemoteShas(repo, result) {
  if (!result || !result.commit) return;
  const treeSha = result.commit.tree ? result.commit.tree.sha : result.treeSha;
  if (!treeSha) return;
  try {
    const tree = await ghGetTree(repo.owner, repo.name, treeSha, true);
    for (const entry of (tree && tree.tree) || []) {
      if (entry.type !== 'blob') continue;
      const file = state.files.get(entry.path);
      if (file) file.sha = entry.sha;
    }
  } catch (e) {
    // The commit already succeeded; stale SHAs only mean a later delete may
    // need a refresh. Do not turn a successful save into an error.
  }
}

function describeCommit(message) {
  const s = String(message || '').replace(/\s+/g, ' ').trim();
  return s.length > 46 ? `${s.slice(0, 46)}…` : s;
}

async function refreshFromGitHub(opts = {}) {
  if (state.mode !== 'github' || !state.repo) {
    if (!opts.silent) showOnboarding();
    return false;
  }
  if (hasChanges() && !opts.force) {
    const ok = await confirmDialog(
      '放弃本机修改？',
      '从 GitHub 重新读取会覆盖尚未提交的修改。已提交的版本不受影响。',
      { confirmLabel: '放弃并刷新', danger: true }
    );
    if (!ok) return false;
  }
  const repo = state.repo;
  const modal = openModal({
    title: '正在刷新仓库',
    eyebrow: repo.full,
    subtitle: '从 GitHub 读取最新的提交与文件。',
    body: `<div class="field-hint" id="refresh-progress">正在读取仓库信息…</div>`,
    persistent: true,
    size: 'modal-sm'
  });
  const progress = modal && modal.body.querySelector('#refresh-progress');
  try {
    setConnectionBanner('', false);
    const project = await ghLoadProject(repo.owner, repo.name, {
      onProgress: (p) => {
        if (!progress) return;
        if (p.phase === 'tree') progress.textContent = `读取文件树：共 ${p.total} 个文件…`;
        else if (p.phase === 'files') progress.textContent = `读取文件 ${p.loaded} / ${p.total}${p.path ? ` · ${p.path}` : ''}`;
        else progress.textContent = '正在读取仓库信息…';
      }
    });
    state.repo = {
      owner: repo.owner,
      name: repo.name,
      full: `${repo.owner}/${repo.name}`,
      private: !!project.repo.private,
      defaultBranch: project.branch
    };
    state.branch = project.branch || state.branch || 'main';
    state.hasWorkflow = project.hasWorkflow;
    state.lastCommit = null;
    state.pdfUrl = '';
    clearPdf();
    applyProjectFiles(Array.from(project.files.values()), { mainPath: project.mainPath });
    state.preview = null;
    if (!state.mainPath) state.mainPath = project.mainPath || '';
    openFile(state.activePath || state.mainPath || (state.files.keys().next().value || ''));
    renderTree();
    renderTabs();
    refreshOutline();
    renderSaveState();
    updateStorageUI();
    updateProjectTitle();
    schedulePreview(0);
    if (modal) modal.close();
    if (project.empty) {
      toast({ type: 'info', title: '仓库是空的', desc: '可以从模板开始，把第一篇论文写进去。', action: { label: '选择模板', onClick: () => openTemplateChooser() } });
    } else if (!project.mainPath) {
      toast({ type: 'warn', title: '没有找到主文件', desc: '仓库里没有包含 \\documentclass 的 .tex 文件。' });
    } else {
      toast({ type: 'success', title: '已刷新', desc: `${project.files.size} 个文件${project.skipped.length ? `，${project.skipped.length} 个被跳过` : ''}` });
    }
    if (project.skipped.length) console.warn('Skipped files:', project.skipped);
    return true;
  } catch (e) {
    if (modal) modal.close();
    const message = e.message || String(e);
    setConnectionBanner(message, true);
    toast({ type: 'error', title: '刷新失败', desc: message });
    return false;
  }
}

async function loadRepoProject(repo, opts = {}) {
  const project = await ghLoadProject(repo.owner, repo.name, opts);
  state.repo = Object.assign({}, repo, {
    full: `${repo.owner}/${repo.name}`,
    private: !!project.repo.private,
    defaultBranch: project.branch
  });
  state.branch = project.branch || 'main';
  state.hasWorkflow = project.hasWorkflow;
  applyProjectFiles(Array.from(project.files.values()), { mainPath: project.mainPath });
  return project;
}
