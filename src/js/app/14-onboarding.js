/* ==========================================================================
   Qelemchi · onboarding, GitHub connection and session restore
   ========================================================================== */

let onboardingOpts = {};
let onboardingBusy = false;
let onboardingBound = false;

function showOnboarding(opts = {}) {
  onboardingOpts = Object.assign({}, opts);
  const section = $('#onboarding');
  if (!section) return;
  section.hidden = false;
  document.body.classList.add('onboarding-open');
  switchConnectTab(opts.tab === 'demo' ? 'demo' : 'github');
  setConnectError('');
  if (opts.message) setConnectError(opts.message);

  const repoInput = $('#repo-input');
  if (repoInput) {
    if (opts.prefillRepo) repoInput.value = opts.prefillRepo;
    else if (opts.reset) repoInput.value = '';
  }
  const tokenInput = $('#token-input');
  if (tokenInput && !opts.keepToken) tokenInput.value = '';
  const help = $('#token-help');
  if (help) help.hidden = true;

  const remember = document.querySelector('input[name="remember"]:checked');
  if (remember) updateRememberUI(remember.value);

  setTimeout(() => {
    if (opts.focus !== false && !opts.prefillRepo) {
      const token = $('#token-input');
      if (token) token.focus();
    }
  }, 60);
}

function hideOnboarding() {
  const section = $('#onboarding');
  if (section) section.hidden = true;
  document.body.classList.remove('onboarding-open');
  onboardingOpts = {};
  setConnectError('');
}

function switchConnectTab(name) {
  document.querySelectorAll('[data-connect-tab]').forEach((tab) => {
    const active = tab.dataset.connectTab === name;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  document.querySelectorAll('[data-connect-panel]').forEach((panel) => {
    panel.hidden = panel.dataset.connectPanel !== name;
  });
}

function setConnectError(message) {
  const box = $('#connect-error');
  if (!box) return;
  box.hidden = !message;
  box.textContent = message || '';
}

function updateRememberUI(mode) {
  const field = $('#passphrase-field');
  if (field) field.hidden = mode !== 'passphrase';
  if (mode === 'passphrase') {
    setTimeout(() => {
      const input = $('#passphrase-input');
      if (input && !input.value) input.focus();
    }, 40);
  }
}

function onboardingTokenValue() {
  const input = $('#token-input');
  const typed = input ? input.value.trim() : '';
  if (typed) return typed;
  if (onboardingOpts.keepToken) return state.token || '';
  return '';
}

function setConnectBusy(busy, label) {
  const btn = $('#connect-submit');
  if (!btn) return;
  setBusy(btn, busy, label || '正在连接…');
}

async function connectFromOnboarding() {
  if (onboardingBusy) return;
  const token = onboardingTokenValue();
  const repoInput = $('#repo-input');
  const rawRepo = repoInput ? repoInput.value.trim() : '';
  const remember = (document.querySelector('input[name="remember"]:checked') || {}).value || 'session';
  const passphraseInput = $('#passphrase-input');
  const passphrase = passphraseInput ? passphraseInput.value : '';

  setConnectError('');
  if (!token) {
    setConnectError('请先填写 personal access token。');
    const input = $('#token-input');
    if (input) input.focus();
    return;
  }
  if (!/^(github_pat_|ghp_|gho_|ghu_|ghs_|ghr_)/.test(token) && token.length < 20) {
    setConnectError('这看起来不像 GitHub 令牌。请粘贴完整的 token。');
    return;
  }
  const repo = parseRepoInput(rawRepo);
  if (!repo) {
    setConnectError('仓库格式应为 owner/repo，例如 ada/paper-2026。');
    if (repoInput) repoInput.focus();
    return;
  }
  if (remember === 'passphrase' && String(passphrase).length < 8) {
    setConnectError('口令至少需要 8 个字符。');
    return;
  }
  if (state.mode === 'github' && hasChanges()) {
    const ok = await confirmDialog(
      '切换到另一个仓库？',
      '当前工作区有尚未提交的修改，切换后这些修改会从编辑器中消失（远程仓库不受影响）。',
      { confirmLabel: '切换', danger: true }
    );
    if (!ok) return;
  }

  onboardingBusy = true;
  setConnectBusy(true, '正在验证令牌…');
  const previousToken = state.token;
  state.token = token;
  try {
    const user = await ghUser();
    setConnectBusy(true, '正在读取仓库…');
    const project = await ghLoadProject(repo.owner, repo.name, {
      onProgress: (p) => {
        if (p.phase === 'tree') setConnectBusy(true, `读取文件树 · ${p.total} 个文件…`);
        else if (p.phase === 'files') setConnectBusy(true, `读取文件 ${p.loaded}/${p.total}…`);
      }
    });

    let storedMode = remember;
    try {
      await clearAllTokens();
      await storeRememberedToken(token, remember, passphrase);
    } catch (e) {
      storeSessionToken(token);
      storedMode = 'session';
      toast({ type: 'warn', title: '令牌未能持久保存', desc: `${e.message || e} 本次会话仍可使用。` });
    }
    state.remember = storedMode;
    state.passphrase = storedMode === 'passphrase' ? passphrase : '';
    saveSessionMeta({
      mode: 'github',
      repo: { owner: repo.owner, name: repo.name, full: repo.full, private: !!project.repo.private },
      remember: storedMode,
      login: user.login,
      name: user.name || '',
      avatar: user.avatar_url || '',
      lastConnected: Date.now()
    });

    finishLoadedProject(project, repo, user);
    hideOnboarding();
    renderAllAfterProjectLoad();
    toast({
      type: 'success',
      title: '已连接 GitHub',
      desc: project.empty ? `${repo.full} 是空仓库，可以选一个模板开始。` : `${repo.full} · ${project.files.size} 个文件`
    });
    if (project.empty) setTimeout(() => openTemplateChooser(), 420);
    else if (!project.mainPath) {
      toast({ type: 'warn', title: '没有找到主文件', desc: '仓库中没有包含 \\documentclass 的 .tex 文件。' });
    }
  } catch (e) {
    state.token = previousToken;
    if (e && e.status === 401) {
      setConnectError('令牌无效或已过期。请重新创建一个 fine-grained token。');
    } else if (e && e.status === 404) {
      setConnectError(`找不到 ${repo.full}。请确认仓库名，以及令牌是否授权了这个仓库。`);
    } else if (e && e.status === 403) {
      setConnectError(e.message || '令牌没有访问这个仓库的权限。');
    } else {
      setConnectError(e.message || String(e));
    }
  } finally {
    onboardingBusy = false;
    setConnectBusy(false);
  }
}

function finishLoadedProject(project, repo, user) {
  setMode('github');
  state.user = user || state.user;
  state.repo = {
    owner: repo.owner,
    name: repo.name,
    full: `${repo.owner}/${repo.name}`,
    private: !!(project.repo && project.repo.private),
    defaultBranch: project.branch
  };
  state.branch = project.branch || 'main';
  state.hasWorkflow = !!project.hasWorkflow;
  state.offline = false;
  state.pdfBlob = null;
  state.pdfUrl = '';
  try { clearPdf(); } catch (e) { /* ignore */ }
  applyProjectFiles(Array.from(project.files.values()), { mainPath: project.mainPath });
  updateProjectTitle();
}

function renderAllAfterProjectLoad() {
  const active = state.activePath || state.mainPath;
  if (active && state.files.has(active)) {
    openFile(active);
  } else if (editor) {
    editorSuppress = true;
    editor.setValue('');
    editorSuppress = false;
    updateEditorMeta();
    renderTabs();
    renderTree();
  }
  refreshOutline();
  renderSaveState();
  updateStorageUI();
  updateProjectTitle();
  showDemoBanner(false);
  setConnectionBanner('', false);
  schedulePreview(0);
}

async function browseRepositories() {
  const picker = $('#repo-picker');
  if (!picker) return;
  const token = onboardingTokenValue();
  picker.hidden = false;
  if (!token) {
    picker.innerHTML = '<div class="repo-picker-empty">先填写令牌，才能列出你有权限的仓库。</div>';
    return;
  }
  picker.innerHTML = '<div class="repo-picker-empty"><span class="typeset-spinner" style="width:11px;height:11px;border-width:1.5px;margin-right:5px"></span>正在读取仓库…</div>';
  const previousToken = state.token;
  state.token = token;
  try {
    const repos = await ghListRepos();
    state.token = previousToken;
    if (!repos.length) {
      picker.innerHTML = '<div class="repo-picker-empty">这个令牌还没有可写的仓库。可以先创建一个私有仓库。</div>' + repoCreateButton();
      bindRepoCreate(picker);
      return;
    }
    picker.innerHTML = repos.map((r) => `<button type="button" class="repo-option" data-repo="${escapeAttr(r.full)}">` +
      `<b>${escapeHtml(r.full)}${r.private ? ' <span style="opacity:.55">· 私有</span>' : ''}</b>` +
      `<small>${escapeHtml(r.description || r.defaultBranch || '')}${r.updatedAt ? ` · ${escapeHtml(timeAgo(r.updatedAt))}` : ''}</small></button>`).join('') +
      repoCreateButton();
    picker.querySelectorAll('[data-repo]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const input = $('#repo-input');
        if (input) input.value = btn.dataset.repo;
        picker.hidden = true;
      });
    });
    bindRepoCreate(picker);
  } catch (e) {
    state.token = previousToken;
    picker.innerHTML = `<div class="repo-picker-error">${escapeHtml(e.message || String(e))}</div>`;
  }
}

function repoCreateButton() {
  return '<button type="button" class="repo-option repo-create" id="repo-create" style="border-top:1px solid var(--line-soft);margin-top:3px;padding-top:8px">' +
    '<b>＋ 新建私有仓库</b><small>需要令牌拥有创建仓库的权限</small></button>';
}

function bindRepoCreate(picker) {
  const btn = picker.querySelector('#repo-create');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const name = await promptDialog('新建私有仓库', '仓库名', '', {
      placeholder: 'paper-2026',
      hint: '仓库会创建在你的 GitHub 账号下，并自动作为当前论文仓库。'
    });
    if (!name) return;
    const token = onboardingTokenValue();
    if (!token) {
      setConnectError('请先填写令牌。');
      return;
    }
    const previousToken = state.token;
    state.token = token;
    setBusy(btn, true, '正在创建…');
    try {
      const created = await ghCreateRepo(name, { private: true });
      state.token = previousToken;
      const input = $('#repo-input');
      if (input) input.value = created.full_name || `${created.owner.login}/${created.name}`;
      const pickerEl = $('#repo-picker');
      if (pickerEl) pickerEl.hidden = true;
      toast({ type: 'success', title: '私有仓库已创建', desc: created.full_name || name });
    } catch (e) {
      state.token = previousToken;
      setBusy(btn, false);
      toast({ type: 'error', title: '创建仓库失败', desc: e.message || String(e) });
    }
  });
}

async function startDemoFromOnboarding() {
  if (state.mode === 'github') {
    const ok = await confirmDialog(
      '打开示例项目？',
      '会离开当前仓库视图。令牌仍保存在本机，随时可以重新连接。',
      { confirmLabel: '打开示例' }
    );
    if (!ok) return;
  }
  hideOnboarding();
  setMode('demo');
  state.offline = false;
  clearPdf();
  await loadDemoWorkspace();
  showDemoBanner(!state.demoDismissed);
  setConnectionBanner('', false);
  renderAllAfterProjectLoad();
  toast({ type: 'info', title: '示例项目已打开', desc: '所有修改都只保存在本机，可随时连接 GitHub。' });
}

async function showTokenHelp() {
  const help = $('#token-help');
  if (!help) return;
  help.hidden = !help.hidden;
}

/* --------------------------------------------------------------------------
   Session restore and passphrase unlock
   -------------------------------------------------------------------------- */

function askUnlockPassphrase(meta) {
  return new Promise((resolve) => {
    let decided = false;
    const repoName = meta && meta.repo ? meta.repo.full : '仓库';
    const modal = openModal({
      title: '解锁 GitHub 令牌',
      eyebrow: repoName,
      subtitle: '上次你选择用口令加密保存令牌。输入口令后，Qelemchi 会重新打开论文仓库。',
      size: 'modal-sm',
      body: `<div class="field">
          <label for="unlock-passphrase">解锁口令</label>
          <input id="unlock-passphrase" type="password" autocomplete="current-password" spellcheck="false" placeholder="口令">
        </div>
        <div class="form-error" id="unlock-error" role="alert" hidden></div>
        <div class="modal-note" style="margin-top:10px">口令不会离开浏览器；它只用于 PBKDF2 派生本机密钥。</div>`,
      actions: [
        { label: '稍后连接', kind: 'ghost', onClick: () => { decided = true; resolve(''); } },
        { label: '解锁', kind: 'primary', onClick: async (api, btn) => {
          const input = api.body.querySelector('#unlock-passphrase');
          const value = input ? input.value : '';
          const err = api.body.querySelector('#unlock-error');
          if (!value) {
            if (err) { err.hidden = false; err.textContent = '请输入口令。'; }
            input && input.focus();
            return false;
          }
          setBusy(btn, true, '正在解锁…');
          try {
            const token = await readRememberedToken('passphrase', value);
            if (!token) throw new Error('没有找到已保存的令牌。');
            decided = true;
            resolve(token);
            return true;
          } catch (e) {
            setBusy(btn, false);
            if (err) {
              err.hidden = false;
              err.textContent = '口令不正确，或令牌已被清除。';
            }
            if (input) { input.select(); input.focus(); }
            return false;
          }
        } }
      ],
      onClose: () => { if (!decided) resolve(''); }
    });
    if (!modal) { resolve(''); return; }
    const input = modal.body.querySelector('#unlock-passphrase');
    if (input) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const primary = modal.foot && modal.foot.querySelector('.btn-primary');
          if (primary) primary.click();
        }
      });
      setTimeout(() => input.focus(), 60);
    }
  });
}

async function tryAutoConnect() {
  const meta = loadSessionMeta();
  if (!meta || meta.mode !== 'github' || !meta.repo || !meta.repo.full) return false;
  const repo = parseRepoInput(meta.repo.full);
  if (!repo) {
    clearSessionMeta();
    return false;
  }
  const remember = meta.remember || 'session';
  let token = '';
  if (remember === 'passphrase') {
    token = await askUnlockPassphrase(meta);
    if (!token) {
      showOnboarding({ prefillRepo: repo.full });
      return false;
    }
  } else {
    try {
      token = await readRememberedToken(remember);
    } catch (e) {
      token = '';
    }
  }
  if (!token) {
    showOnboarding({ prefillRepo: repo.full });
    return false;
  }
  state.token = token;
  state.remember = remember;
  try {
    const user = await ghUser();
    const project = await ghLoadProject(repo.owner, repo.name);
    finishLoadedProject(project, repo, user);
    renderAllAfterProjectLoad();
    saveSessionMeta(Object.assign({}, meta, {
      repo: { owner: repo.owner, name: repo.name, full: repo.full, private: !!project.repo.private },
      login: user.login,
      name: user.name || '',
      avatar: user.avatar_url || '',
      lastConnected: Date.now()
    }));
    return true;
  } catch (e) {
    if (e && e.status === 401) {
      try { await clearRememberedToken(remember); } catch (err) { /* ignore */ }
      clearSessionMeta();
      state.token = '';
    }
    showOnboarding({ prefillRepo: repo.full, message: `上次的仓库没有自动打开：${e.message || e}` });
    return false;
  }
}

/* --------------------------------------------------------------------------
   Bindings
   -------------------------------------------------------------------------- */

function initOnboardingEvents() {
  if (onboardingBound) return;
  onboardingBound = true;

  const section = $('#onboarding');
  const close = $('#onboarding-close');
  if (close) close.addEventListener('click', () => {
    if (!onboardingBusy) hideOnboarding();
  });
  if (section) section.addEventListener('click', (event) => {
    if (event.target === section && !onboardingBusy) hideOnboarding();
  });

  document.querySelectorAll('[data-connect-tab]').forEach((tab) => {
    tab.addEventListener('click', () => switchConnectTab(tab.dataset.connectTab));
  });

  const form = $('#connect-form');
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      connectFromOnboarding();
    });
  }

  const toggle = $('#toggle-token');
  if (toggle) {
    toggle.addEventListener('click', () => {
      const input = $('#token-input');
      if (!input) return;
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      toggle.setAttribute('aria-label', show ? '隐藏令牌' : '显示令牌');
      toggle.classList.toggle('is-visible', show);
    });
  }

  document.querySelectorAll('input[name="remember"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      if (radio.checked) updateRememberUI(radio.value);
    });
  });

  const help = $('#show-token-help');
  if (help) help.addEventListener('click', showTokenHelp);

  const browse = $('#browse-repos');
  if (browse) browse.addEventListener('click', browseRepositories);

  const tokenInput = $('#token-input');
  if (tokenInput) {
    tokenInput.addEventListener('input', () => {
      setConnectError('');
      const picker = $('#repo-picker');
      if (picker) picker.hidden = true;
    });
  }

  const demo = $('#demo-start');
  if (demo) demo.addEventListener('click', startDemoFromOnboarding);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !onboardingBusy) {
      const section = $('#onboarding');
      if (!section || section.hidden) return;
      const modalRoot = $('#modal-root');
      if (modalRoot && modalRoot.querySelector('.modal-backdrop')) return;
      hideOnboarding();
    }
  });
}
