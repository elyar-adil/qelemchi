/* ==========================================================================
   Qelemchi · real PDF compilation through GitHub Actions
   ========================================================================== */

let compilePollTimer = null;
let compileTickTimer = null;
let compileToken = 0;

function compileModalBody() {
  return `<div class="compile-summary">
      <span class="compile-icon" id="compile-icon">${iconSvg('play')}</span>
      <div class="compile-summary-text"><b id="compile-title">准备编译</b><small id="compile-sub">正在检查仓库中的工作流…</small></div>
      <span class="compile-elapsed" id="compile-elapsed"></span>
    </div>
    <div class="compile-steps" id="compile-steps">
      ${['检查工作流', '触发 GitHub Actions', '用 TeX Live 编译', '下载 PDF'].map((label, i) =>
        `<div class="compile-step" data-step="${i}"><span class="cs-dot"></span><span class="cs-text">${label}</span><span class="cs-meta"></span></div>`).join('')}
    </div>
    <div class="compile-progress"><i id="compile-progress-bar"></i></div>
    <div class="compile-actions">
      <button type="button" class="btn btn-soft" id="compile-local" hidden>在浏览器内编译</button>
      <select id="compile-engine" class="compile-engine-select" aria-label="TeX 引擎">
        <option value="xelatex">XeLaTeX</option>
        <option value="pdflatex">pdfLaTeX</option>
        <option value="lualatex">LuaLaTeX</option>
      </select>
      <button type="button" class="btn btn-soft" id="compile-cancel">取消</button>
      <button type="button" class="btn btn-soft" id="compile-again" hidden>重新编译</button>
      <button type="button" class="btn btn-soft" id="compile-open-gh" hidden>在 GitHub 查看</button>
      <button type="button" class="btn btn-primary" id="compile-install" hidden>安装工作流</button>
    </div>
    <div class="compile-log" id="compile-log" hidden></div>
    <div class="compile-error-box" id="compile-error" hidden></div>
    <div class="workflow-yaml-wrap" id="compile-yaml-wrap" hidden>
      <div class="modal-section-title" style="margin-top:16px">.github/workflows/qelemchi.yml</div>
      <div class="workflow-yaml" id="compile-yaml"></div>
      <div class="copy-row"><button type="button" class="text-btn small" id="compile-copy-yaml">复制工作流</button></div>
    </div>`;
}

function openCompile() {
  if (state.mode !== 'github' || !state.repo) {
    if (localTexEnabled()) openLocalCompile();
    else openDemoCompile();
    return;
  }
  if (state.compile.busy) {
    if (state.compile.modalOpen) return;
  }
  state.compile.busy = true;
  state.compile.cancelled = false;
  state.compile.status = 'checking';
  state.compile.step = 0;
  state.compile.startedAt = Date.now();
  state.compile.error = '';
  state.compile.run = null;
  state.compile.modalOpen = true;
  const modal = openModal({
    title: '编译 PDF',
    eyebrow: state.repo.full,
    subtitle: '由仓库中的 GitHub Actions 用真实的 TeX Live 生成。',
    size: 'modal-lg',
    body: compileModalBody(),
    actions: [{ label: '关闭', kind: 'ghost' }],
    onClose: () => {
      state.compile.modalOpen = false;
      stopCompilePolling();
      state.compile.busy = false;
    }
  });
  if (!modal) return;
  const engine = modal.body.querySelector('#compile-engine');
  if (engine) {
    engine.value = state.settings.compileEngine || 'xelatex';
    engine.addEventListener('change', () => {
      state.settings.compileEngine = engine.value;
      saveSettings(state.settings);
    });
  }
  const localBtn = modal.body.querySelector('#compile-local');
  if (localBtn) {
    if (!localTexEnabled()) localBtn.hidden = true;
    else localBtn.addEventListener('click', () => {
      modal.close();
      setTimeout(openLocalCompile, 80);
    });
  }
  const cancel = modal.body.querySelector('#compile-cancel');
  if (cancel) cancel.addEventListener('click', () => {
    state.compile.cancelled = true;
    stopCompilePolling();
    state.compile.busy = false;
    setCompileStatus('idle', '已取消', '可以随时重新开始编译。');
    modal.close();
  });
  const again = modal.body.querySelector('#compile-again');
  if (again) again.addEventListener('click', () => {
    modal.close();
    setTimeout(openCompile, 120);
  });
  const copyYaml = modal.body.querySelector('#compile-copy-yaml');
  if (copyYaml) copyYaml.addEventListener('click', async () => {
    if (await copyText(WORKFLOW_YAML)) toast({ type: 'success', title: '工作流已复制' });
  });
  startCompile(modal);
}

function openDemoCompile() {
  const modal = openModal({
    title: '编译真实 PDF',
    eyebrow: '需要连接 GitHub',
    subtitle: '这个构建没有内置 TeX 引擎；真正的 PDF 由 GitHub Actions 的 TeX Live 生成。',
    body: `<div class="modal-note">连接一个仓库后，Qelemchi 会把一份 <code>.github/workflows/qelemchi.yml</code> 写入仓库。之后每次点击“编译 PDF”，工作流会编译主文件并把 <code>build/main.pdf</code> 提交回来。</div>
      <ul class="demo-points" style="margin-top:14px">
        <li><span>01</span>真实 TeX Live（XeLaTeX / pdfLaTeX / LuaLaTeX）</li>
        <li><span>02</span>中文字体随工作流安装</li>
        <li><span>03</span>编译日志与历史都留在你的仓库</li>
      </ul>
      <div class="modal-note warn" style="margin-top:12px">Actions 需要令牌拥有这个仓库的 Actions 读写权限。编译通常需要 40–120 秒。</div>`,
    actions: [
      { label: '继续用预览', kind: 'ghost' },
      { label: '连接 GitHub', kind: 'primary', onClick: () => { modal.close(); connectFromDemo(); } }
    ]
  });
  return modal;
}

function connectFromDemo() {
  showOnboarding();
  const tab = document.querySelector('[data-connect-tab="github"]');
  if (tab) tab.click();
}

function compileStepEl(index) {
  return document.querySelector(`#compile-steps .compile-step[data-step="${index}"]`);
}

function setCompileStep(index, status, meta) {
  const el = compileStepEl(index);
  if (!el) return;
  el.classList.remove('active', 'done', 'error');
  if (status) el.classList.add(status);
  const metaEl = el.querySelector('.cs-meta');
  if (metaEl && meta != null) metaEl.textContent = meta;
}

function setCompileStatus(stateName, title, sub) {
  state.compile.status = stateName;
  const icon = $('#compile-icon');
  const titleEl = $('#compile-title');
  const subEl = $('#compile-sub');
  if (titleEl) titleEl.textContent = title;
  if (subEl) subEl.textContent = sub || '';
  if (icon) {
    icon.classList.remove('success', 'error');
    if (stateName === 'success') { icon.classList.add('success'); icon.innerHTML = iconSvg('check'); }
    else if (stateName === 'error') { icon.classList.add('error'); icon.innerHTML = iconSvg('warning'); }
    else icon.innerHTML = iconSvg('play');
  }
}

function setCompileProgress(pct) {
  const bar = $('#compile-progress-bar');
  if (bar) bar.style.width = `${clamp(pct, 0, 100)}%`;
}

function compileLog(line) {
  const box = $('#compile-log');
  if (!box) return;
  box.hidden = false;
  box.textContent += `${line}\n`;
  box.scrollTop = box.scrollHeight;
}

function showCompileError(message, url) {
  const box = $('#compile-error');
  if (box) {
    box.hidden = false;
    box.textContent = message;
  }
  const open = $('#compile-open-gh');
  if (open && url) {
    open.hidden = false;
    open.onclick = () => window.open(url, '_blank', 'noopener');
  }
  setCompileStatus('error', '编译失败', message);
}

function startCompileTick(startedAt, token) {
  if (compileTickTimer) clearInterval(compileTickTimer);
  compileTickTimer = setInterval(() => {
    if (token !== compileToken) return;
    const elapsed = $('#compile-elapsed');
    if (elapsed) elapsed.textContent = `${Math.round((Date.now() - startedAt) / 1000)} s`;
  }, 500);
}

function clearCompileTimers() {
  if (compilePollTimer) { clearTimeout(compilePollTimer); compilePollTimer = null; }
  if (compileTickTimer) { clearInterval(compileTickTimer); compileTickTimer = null; }
}

function stopCompilePolling() {
  compileToken++;
  clearCompileTimers();
}

async function startCompile(modal) {
  stopCompilePolling();
  loadRunSteps.lastRun = null;
  const token = ++compileToken;
  const startedAt = Date.now();
  const engineSel = modal.body.querySelector('#compile-engine');
  const engine = (engineSel && engineSel.value) || state.settings.compileEngine || 'xelatex';
  const rootFile = state.mainPath || 'main.tex';
  state.settings.compileEngine = engine;
  saveSettings(state.settings);
  startCompileTick(startedAt, token);
  setCompileProgress(6);
  setCompileStep(0, 'active');
  setCompileStatus('checking', '检查仓库工作流', `${engineLabel(engine)} · ${rootFile}`);
  compileLog(`仓库：${state.repo.full} · 分支：${state.branch}`);
  compileLog(`主文件：${rootFile} · 引擎：${engine}`);

  if (hasChanges()) {
    compileLog('提示：工作区有未提交的修改。Actions 编译的是远程仓库中最近一次提交。');
  }

  try {
    let workflow = null;
    try {
      workflow = await ghGetWorkflow(state.repo.owner, state.repo.name);
    } catch (e) {
      if (e.status === 403) throw e;
      workflow = null;
    }
    if (token !== compileToken) return;
    if (!workflow) {
      state.hasWorkflow = false;
      setCompileStep(0, 'done', '未安装');
      setCompileStatus('idle', '还没有编译工作流', '仓库中缺少 .github/workflows/qelemchi.yml。');
      setCompileProgress(8);
      const install = modal.body.querySelector('#compile-install');
      if (install) {
        install.hidden = false;
        install.textContent = '安装工作流并编译';
        install.addEventListener('click', () => installWorkflowAndCompile(modal, token, engine, rootFile));
      }
      const yamlWrap = modal.body.querySelector('#compile-yaml-wrap');
      const yamlBox = modal.body.querySelector('#compile-yaml');
      if (yamlWrap) yamlWrap.hidden = false;
      if (yamlBox) yamlBox.textContent = WORKFLOW_YAML;
      compileLog('工作流不存在。安装会向仓库写入一个提交，之后即可编译。');
      state.compile.busy = false;
      return;
    }
    state.hasWorkflow = true;
    setCompileStep(0, 'done', '已找到');
    setCompileProgress(22);
    await dispatchCompile(modal, token, engine, rootFile, startedAt);
  } catch (e) {
    if (token !== compileToken) return;
    stopCompilePolling();
    state.compile.busy = false;
    showCompileError(e.message || String(e), e.status === 403 ? null : '');
    compileLog(`错误：${e.message || String(e)}`);
  }
}

async function installWorkflowAndCompile(modal, token, engine, rootFile) {
  const install = modal.body.querySelector('#compile-install');
  if (install) setBusy(install, true, '正在安装…');
  try {
    compileLog('正在写入 .github/workflows/qelemchi.yml…');
    await ghInstallWorkflow(state.repo.owner, state.repo.name, state.branch);
    state.hasWorkflow = true;
    compileLog('工作流已提交。');
    if (install) { install.hidden = true; setBusy(install, false); }
    setCompileStep(0, 'done', '已安装');
    setCompileProgress(20);
    const startedAt = Date.now();
    startCompileTick(startedAt, token);
    await dispatchCompile(modal, token, engine, rootFile, startedAt);
  } catch (e) {
    if (token !== compileToken) return;
    if (install) setBusy(install, false);
    state.compile.busy = false;
    showCompileError(e.message || String(e));
  }
}

async function dispatchCompile(modal, token, engine, rootFile, startedAt) {
  setCompileStep(1, 'active');
  setCompileStatus('dispatching', '触发 GitHub Actions', '正在请求工作流运行…');
  const dispatchAt = Date.now();
  await ghDispatchWorkflow(state.repo.owner, state.repo.name, state.branch, engine, rootFile);
  if (token !== compileToken) return;
  compileLog('已触发 workflow_dispatch。');
  setCompileStep(1, 'done', '已触发');
  setCompileStep(2, 'active');
  setCompileProgress(36);
  setCompileStatus('running', 'Actions 正在排队', 'GitHub 会在几秒内分配运行器。');
  pollCompileRun(token, dispatchAt, startedAt, 0);
}

function pollCompileRun(token, dispatchAt, startedAt, attempt) {
  if (token !== compileToken) return;
  if (compilePollTimer) clearTimeout(compilePollTimer);
  const wait = attempt === 0 ? 3500 : 5000;
  compilePollTimer = setTimeout(async () => {
    if (token !== compileToken) return;
    try {
      const data = await ghWorkflowRuns(state.repo.owner, state.repo.name, 15);
      if (token !== compileToken) return;
      const runs = (data && data.workflow_runs) || [];
      const run = runs.find((r) => {
        const created = Date.parse(r.created_at || r.run_started_at || 0);
        return created >= dispatchAt - 20000 && (!r.head_branch || r.head_branch === state.branch);
      }) || runs.find((r) => Date.parse(r.created_at || 0) >= dispatchAt - 20000);
      if (!run) {
        if (Date.now() - dispatchAt > 120000) {
          stopCompilePolling();
          state.compile.busy = false;
          showCompileError('触发了工作流，但两分钟内没有找到对应的运行。请到仓库的 Actions 页面查看。',
            state.repo ? `${githubRepoUrl(state.repo.owner, state.repo.name)}/actions` : '');
          return;
        }
        setCompileProgress(Math.min(50, 38 + attempt));
        compileLog('等待 GitHub 创建运行…');
        pollCompileRun(token, dispatchAt, startedAt, attempt + 1);
        return;
      }
      state.compile.run = run;
      state.compile.runningSince = state.compile.runningSince || Date.now();
      const url = run.html_url || `${githubRepoUrl(state.repo.owner, state.repo.name)}/actions/runs/${run.id}`;
      const open = $('#compile-open-gh');
      if (open) { open.hidden = false; open.onclick = () => window.open(url, '_blank', 'noopener'); }
      if (run.status === 'queued' || run.status === 'waiting' || run.status === 'requested' || run.status === 'pending') {
        setCompileProgress(42);
        setCompileStatus('running', '正在排队', `运行 #${run.run_number || ''} · 等待运行器`);
        compileLog(`运行 #${run.run_number || run.id}：${run.status}`);
      } else if (run.status === 'in_progress') {
        setCompileStep(2, 'active');
        setCompileProgress(62);
        setCompileStatus('running', 'TeX Live 正在编译', '首次运行需要下载 TeX Live 与中文字体，可能需要一两分钟。');
        compileLog(`运行 #${run.run_number || run.id}：in_progress`);
        loadRunSteps(run.id, token);
      } else if (run.status === 'completed') {
        await finishCompileRun(run, token);
        return;
      }
      pollCompileRun(token, dispatchAt, startedAt, attempt + 1);
    } catch (e) {
      if (token !== compileToken) return;
      if (attempt > 40) {
        stopCompilePolling();
        state.compile.busy = false;
        showCompileError(e.message || String(e));
      } else {
        compileLog(`查询运行状态失败，将重试：${e.message || e}`);
        pollCompileRun(token, dispatchAt, startedAt, attempt + 1);
      }
    }
  }, wait);
}

async function loadRunSteps(runId, token) {
  if (loadRunSteps.lastRun === runId) return;
  loadRunSteps.lastRun = runId;
  try {
    const jobs = await ghRunJobs(state.repo.owner, state.repo.name, runId);
    if (token !== compileToken) return;
    for (const job of jobs.jobs || []) {
      compileLog(`Job：${job.name} · ${job.status}${job.conclusion ? ` · ${job.conclusion}` : ''}`);
      for (const step of job.steps || []) {
        const mark = step.conclusion === 'success' ? '✓' : step.conclusion === 'failure' ? '✗' : step.status === 'in_progress' ? '…' : '·';
        compileLog(`  ${mark} ${step.name}`);
      }
    }
  } catch (e) { /* logs are a nicety; the run status still drives the UI */ }
}
loadRunSteps.lastRun = null;

async function finishCompileRun(run, token) {
  clearCompileTimers();
  const url = run.html_url || `${githubRepoUrl(state.repo.owner, state.repo.name)}/actions/runs/${run.id}`;
  if (run.conclusion !== 'success') {
    state.compile.busy = false;
    setCompileStep(2, 'error', run.conclusion || '失败');
    setCompileProgress(100);
    compileLog(`运行结束：${run.conclusion || '失败'}`);
    showCompileError(
      run.conclusion === 'cancelled' ? '这次运行被取消了。' :
        run.conclusion === 'skipped' ? '这次运行被跳过了。' :
          'TeX Live 编译失败。打开 GitHub Actions 可以查看完整的 LaTeX 日志。',
      url
    );
    return;
  }
  setCompileStep(2, 'done', '成功');
  setCompileStep(3, 'active');
  setCompileProgress(88);
  setCompileStatus('fetching', '正在下载 PDF', '编译成功，正在从仓库读取 build/main.pdf…');
  compileLog('工作流成功完成，读取 build/main.pdf…');
  let lastError = null;
  for (let i = 0; i < 4; i++) {
    if (token !== compileToken) return;
    try {
      const blob = await ghFetchPdf(state.repo.owner, state.repo.name, state.branch);
      if (token !== compileToken) return;
      setPdfBlob(blob, { label: 'PDF 已更新', source: 'actions' });
      setCompileStep(3, 'done', formatBytes(blob.size));
      setCompileProgress(100);
      setCompileStatus('success', 'PDF 已生成', `${formatBytes(blob.size)} · 来自提交 ${String(run.head_sha || '').slice(0, 7) || state.branch}`);
      compileLog(`已下载 ${formatBytes(blob.size)}。`);
      state.compile.busy = false;
      const again = $('#compile-again');
      if (again) again.hidden = false;
      toast({ type: 'success', title: 'PDF 编译完成', desc: '预览已切换到真实 PDF。', action: { label: '查看', onClick: () => setPreviewView('pdf') } });
      return;
    } catch (e) {
      lastError = e;
      await sleep(2200);
    }
  }
  state.compile.busy = false;
  showCompileError(lastError ? lastError.message : '编译成功，但没有找到 build/main.pdf。', url);
  setCompileStep(3, 'error', '未找到');
  compileLog('下载 PDF 失败，可能是工作流的 Publish 步骤没有提交 build/main.pdf。');
}
