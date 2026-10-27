/* ==========================================================================
   Qelemchi · version history (Git commits and local snapshots)
   ========================================================================== */

const HISTORY_PAGE_SIZE = 30;

function openHistory() {
  if (state.mode === 'demo') {
    state.history.mode = 'demo';
  } else {
    state.history.mode = 'github';
  }
  state.history.open = true;
  state.history.selected = null;
  state.history.detail = null;
  const drawer = $('#history-drawer');
  const backdrop = $('#drawer-backdrop');
  if (!drawer || !backdrop) return;
  drawer.hidden = false;
  backdrop.hidden = false;
  requestAnimationFrame(() => drawer.classList.add('is-open'));
  loadHistory(1, false);
}

function closeHistory() {
  const drawer = $('#history-drawer');
  const backdrop = $('#drawer-backdrop');
  state.history.open = false;
  if (drawer) {
    drawer.classList.remove('is-open');
    setTimeout(() => { if (!state.history.open) drawer.hidden = true; }, 280);
  }
  if (backdrop) backdrop.hidden = true;
}

function historyDateLabel(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((start - day) / 86400000);
  if (diff === 0) return '今天';
  if (diff === 1) return '昨天';
  if (diff === 7) return '一周前';
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}

function normalizeCommit(commit) {
  const info = commit.commit || {};
  const author = commit.author || {};
  return {
    kind: 'github',
    sha: commit.sha,
    short: String(commit.sha || '').slice(0, 7),
    message: (info.message || '').split('\n')[0] || '（无提交说明）',
    date: info.author && info.author.date ? new Date(info.author.date) : new Date(),
    author: (info.author && info.author.name) || (author.login || 'GitHub'),
    login: author.login || '',
    url: commit.html_url || (state.repo ? `${githubRepoUrl(state.repo.owner, state.repo.name)}/commit/${commit.sha}` : ''),
    raw: commit
  };
}

function normalizeSnapshot(snap) {
  return {
    kind: 'demo',
    id: snap.id,
    sha: snap.id,
    short: String(snap.id || '').slice(-7),
    message: snap.message || '本机快照',
    date: new Date(snap.createdAt || Date.now()),
    author: '本机',
    url: '',
    snapshot: snap
  };
}

async function loadHistory(page = 1, append = false) {
  const body = $('#history-body');
  const foot = $('#history-foot');
  if (!body) return;
  if (state.history.loading) return;
  state.history.loading = true;
  if (!append) {
    body.innerHTML = '<div class="history-empty"><div class="typeset-spinner" style="margin:0 auto 12px"></div>正在读取版本…</div>';
  }
  try {
    let items = [];
    let hasMore = false;
    if (state.history.mode === 'github') {
      if (!state.repo) throw new Error('还没有连接仓库。');
      const commits = await ghListCommits(state.repo.owner, state.repo.name, state.branch, page, HISTORY_PAGE_SIZE);
      items = (Array.isArray(commits) ? commits : []).map(normalizeCommit);
      hasMore = items.length >= HISTORY_PAGE_SIZE;
      state.history.page = page;
    } else {
      const snaps = await listSnapshots('demo');
      items = snaps.map(normalizeSnapshot);
      hasMore = false;
    }
    if (append) state.history.list = state.history.list.concat(items);
    else {
      state.history.list = items;
      state.history.page = page;
    }
    state.history.hasMore = hasMore;
    renderHistoryList();
    if (foot) {
      if (state.history.mode === 'github') {
        foot.innerHTML = `<span>${escapeHtml(state.repo ? `${state.repo.full} · ${state.branch}` : 'GitHub')}</span><span>${state.history.list.length} 个版本</span>`;
      } else {
        foot.innerHTML = '<span>本机版本 · 只保存在这台设备</span>' +
          `<span>${state.history.list.length} 个快照</span>`;
      }
    }
  } catch (e) {
    body.innerHTML = `<div class="history-empty">${iconSvg('warning')}<div>无法读取版本历史<br><small>${escapeHtml(e.message || String(e))}</small></div></div>`;
    if (foot) foot.innerHTML = '<span>读取失败</span><span></span>';
  } finally {
    state.history.loading = false;
  }
}

function renderHistoryList() {
  const body = $('#history-body');
  if (!body) return;
  const list = state.history.list || [];
  if (!list.length) {
    body.innerHTML = state.history.mode === 'github'
      ? '<div class="history-empty">' + iconSvg('history') + '<div>还没有提交记录。<br>第一次点击“提交”即可开始。</div></div>'
      : '<div class="history-empty">' + iconSvg('history') + '<div>还没有本机快照。<br>点击“保存”会把当前草稿记为一个版本。</div></div>';
    return;
  }
  let html = '<div class="history-list">';
  let lastDate = '';
  list.forEach((item, index) => {
    const label = historyDateLabel(item.date);
    if (label !== lastDate) {
      html += `<div class="history-date">${escapeHtml(label)}</div>`;
      lastDate = label;
    }
    const active = state.history.selected === item.sha;
    html += `<button type="button" class="commit-row${active ? ' active' : ''}" data-index="${index}">` +
      `<span class="commit-avatar">${escapeHtml(initials(item.author))}</span>` +
      `<span class="commit-main"><span class="commit-msg">${escapeHtml(item.message)}</span>` +
      `<span class="commit-meta"><span class="commit-sha">${escapeHtml(item.short)}</span>` +
      `<span>${escapeHtml(timeAgo(item.date))}</span>` +
      (state.history.mode === 'demo' && item.snapshot ? `<span>· ${item.snapshot.files ? item.snapshot.files.length : 0} 文件</span>` : '') +
      `</span></span></button>`;
  });
  html += '</div>';
  if (state.history.hasMore) {
    html += '<button type="button" class="load-more" id="history-more">加载更多</button>';
  }
  body.innerHTML = html;
  body.querySelectorAll('.commit-row').forEach((row) => {
    row.addEventListener('click', () => openHistoryDetail(Number(row.dataset.index)));
  });
  const more = body.querySelector('#history-more');
  if (more) {
    more.addEventListener('click', () => {
      more.disabled = true;
      more.textContent = '正在读取…';
      loadHistory((state.history.page || 1) + 1, true).then(() => {
        const still = $('#history-more');
        if (still) { still.disabled = false; still.textContent = '加载更多'; }
      });
    });
  }
}

async function openHistoryDetail(index) {
  const item = state.history.list[index];
  if (!item) return;
  state.history.selected = item.sha;
  renderHistoryList();
  const body = $('#history-body');
  if (!body) return;
  body.innerHTML = '<div class="history-empty"><div class="typeset-spinner" style="margin:0 auto 12px"></div>正在读取版本详情…</div>';
  try {
    if (item.kind === 'github') {
      const detail = await ghCommitDetail(state.repo.owner, state.repo.name, item.sha);
      state.history.detail = detail;
      renderGitHubDetail(detail, item);
    } else {
      state.history.detail = item.snapshot;
      await renderSnapshotDetail(item.snapshot);
    }
  } catch (e) {
    body.innerHTML = `<div class="history-empty">${iconSvg('warning')}<div>读取失败：${escapeHtml(e.message || String(e))}</div>` +
      '<button type="button" class="btn btn-soft" id="history-detail-back" style="margin-top:14px">返回历史</button></div>';
    const back = body.querySelector('#history-detail-back');
    if (back) back.addEventListener('click', renderHistoryList);
  }
}

function historyBackButton() {
  return '<button type="button" class="text-btn cd-back" id="history-detail-back">← 返回版本列表</button>';
}

function bindHistoryBack() {
  const back = $('#history-detail-back');
  if (back) back.addEventListener('click', renderHistoryList);
}

function renderGitHubDetail(detail, item) {
  const body = $('#history-body');
  if (!body) return;
  const info = detail.commit || {};
  const files = detail.files || [];
  const stats = detail.stats || {};
  const message = (info.message || item.message);
  const [firstLine, ...rest] = String(message).split('\n');
  const fileHtml = files.map((file) => {
    const status = file.status === 'added' ? '新增' : file.status === 'removed' ? '删除' : file.status === 'renamed' ? '重命名' : '修改';
    const patch = file.patch ? renderPatch(file.patch) : '<div class="diff-binary">二进制文件或改动过大，GitHub 未返回 diff。</div>';
    return `<div class="cd-file"><div class="cd-file-head">${escapeHtml(file.filename)}` +
      `<span class="diff-stat">${status} · <span class="add">+${file.additions || 0}</span> <span class="del">−${file.deletions || 0}</span></span></div>${patch}</div>`;
  }).join('');
  body.innerHTML = `<div class="commit-detail">
    ${historyBackButton()}
    <div class="cd-title">${escapeHtml(firstLine || item.message)}</div>
    ${rest.length ? `<div class="modal-note" style="margin-top:10px;white-space:pre-wrap">${escapeHtml(rest.join('\n').trim())}</div>` : ''}
    <div class="cd-meta"><span class="commit-sha">${escapeHtml(item.short)}</span><span>${escapeHtml(info.author ? info.author.name : item.author)}</span>` +
      `<span>${escapeHtml(formatDateTime(item.date))}</span><span>${escapeHtml((stats.total || files.length))} 个文件</span></div>
    <div class="cd-actions">
      <button type="button" class="btn btn-primary" id="history-restore">恢复此版本</button>
      <button type="button" class="btn btn-soft" id="history-open-github">在 GitHub 打开</button>
      <button type="button" class="btn btn-soft" id="history-copy-sha">复制 SHA</button>
    </div>
    <div class="cd-files">${fileHtml || '<div class="diff-empty">这个提交没有文件改动。</div>'}</div>
  </div>`;
  bindHistoryBack();
  const restore = $('#history-restore');
  if (restore) restore.addEventListener('click', () => restoreGitHubVersion(item));
  const openGh = $('#history-open-github');
  if (openGh) openGh.addEventListener('click', () => window.open(item.url, '_blank', 'noopener'));
  const copy = $('#history-copy-sha');
  if (copy) copy.addEventListener('click', async () => {
    if (await copyText(item.sha)) toast({ type: 'success', title: 'SHA 已复制', desc: item.sha });
  });
}

async function restoreGitHubVersion(item) {
  if (!state.repo) return;
  const ok = await confirmDialog(
    '恢复这个版本？',
    `会把 ${item.short} 的文件状态作为一次新的提交写回 ${state.branch}。已有的历史不会被删除，之后仍可恢复回来。`,
    { confirmLabel: '恢复此版本' }
  );
  if (!ok) return;
  try {
    await ghRestoreCommit(state.repo.owner, state.repo.name, state.branch, item.sha, `恢复版本 ${item.short}`);
    toast({ type: 'success', title: '已恢复并提交', desc: `以 ${item.short} 的内容创建了一个新提交` });
    closeHistory();
    await refreshFromGitHub({ force: true });
  } catch (e) {
    toast({ type: 'error', title: '恢复失败', desc: e.message || String(e) });
  }
}

function snapshotFileLines(snapshot) {
  return snapshot && Array.isArray(snapshot.files) ? snapshot.files : [];
}

async function renderSnapshotDetail(snapshot) {
  const body = $('#history-body');
  if (!body) return;
  const current = serializeFiles();
  const currentMap = new Map(current.map((f) => [f.path, f]));
  const snapMap = new Map(snapshotFileLines(snapshot).map((f) => [f.path, f]));
  const paths = Array.from(new Set([...snapMap.keys(), ...currentMap.keys()])).sort();
  const changed = [];
  for (const path of paths) {
    const before = snapMap.get(path);
    const after = currentMap.get(path);
    if (!before && !after) continue;
    if (before && after && before.text != null && after.text != null && before.text === after.text) continue;
    if (before && after && before.text == null && after.text == null && before.base64 === after.base64) continue;
    if (!before && after) continue; // files added after this snapshot
    changed.push({ path, before, after });
  }
  const filesHtml = changed.length ? changed.map(({ path, before, after }) => {
    if (!before) return '';
    if (!after) {
      return `<div class="cd-file"><div class="cd-file-head">${escapeHtml(path)}<span class="diff-stat">已删除</span></div>` +
        (before.text != null ? renderDiff(before.text, '') : '<div class="diff-binary">二进制文件</div>') + '</div>';
    }
    if (before.text != null && after.text != null) {
      return `<div class="cd-file"><div class="cd-file-head">${escapeHtml(path)}<span class="diff-stat">与当前草稿不同</span></div>${renderDiff(before.text, after.text)}</div>`;
    }
    return `<div class="cd-file"><div class="cd-file-head">${escapeHtml(path)}<span class="diff-stat">二进制文件已变化</span></div><div class="diff-binary">二进制资源的差异不在浏览器中展示。</div></div>`;
  }).join('') : '<div class="diff-empty">当前草稿与这个快照相同。</div>';
  body.innerHTML = `<div class="commit-detail">
    ${historyBackButton()}
    <div class="cd-title">${escapeHtml(snapshot.message || '本机快照')}</div>
    <div class="cd-meta"><span class="commit-sha">${escapeHtml(String(snapshot.id || '').slice(-7))}</span>` +
      `<span>${escapeHtml(formatDateTime(snapshot.createdAt || Date.now()))}</span>` +
      `<span>${snapshotFileLines(snapshot).length} 个文件</span></div>
    <div class="cd-actions">
      <button type="button" class="btn btn-primary" id="snapshot-restore">恢复此快照</button>
      <button type="button" class="btn danger" id="snapshot-delete">删除快照</button>
    </div>
    <div class="cd-files">${filesHtml}</div>
  </div>`;
  bindHistoryBack();
  const restore = $('#snapshot-restore');
  if (restore) restore.addEventListener('click', () => restoreSnapshot(snapshot));
  const del = $('#snapshot-delete');
  if (del) del.addEventListener('click', () => deleteLocalSnapshot(snapshot));
}

async function restoreSnapshot(snapshot) {
  const ok = await confirmDialog(
    '恢复这个本机快照？',
    '当前草稿会被快照内容替换。恢复后仍可以再次保存为新的快照。',
    { confirmLabel: '恢复' }
  );
  if (!ok) return;
  applyProjectFiles(snapshotFileLines(snapshot), { mainPath: snapshot.mainPath });
  clearChanges();
  await persistDemoNow();
  state.projectTitle = snapshot.title || state.projectTitle;
  renderTree();
  renderTabs();
  if (state.activePath) openFile(state.activePath);
  updateProjectTitle();
  renderSaveState();
  updateStorageUI();
  schedulePreview(0);
  closeHistory();
  toast({ type: 'success', title: '已恢复快照', desc: formatDateTime(snapshot.createdAt || Date.now()) });
}

async function deleteLocalSnapshot(snapshot) {
  const ok = await confirmDialog('删除快照', '只删除这条本机快照，不会影响当前草稿。', { confirmLabel: '删除', danger: true });
  if (!ok) return;
  await deleteSnapshot(snapshot.id);
  state.history.list = state.history.list.filter((item) => item.sha !== snapshot.id);
  state.history.selected = null;
  renderHistoryList();
  toast({ type: 'success', title: '快照已删除' });
}

function initHistoryEvents() {
  const open = $('#btn-history');
  if (open) open.addEventListener('click', openHistory);
  const close = $('#history-close');
  if (close) close.addEventListener('click', closeHistory);
  const backdrop = $('#drawer-backdrop');
  if (backdrop) backdrop.addEventListener('click', closeHistory);
  const refresh = $('#history-refresh');
  if (refresh) refresh.addEventListener('click', () => loadHistory(1, false));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.history.open) closeHistory();
  });
}
