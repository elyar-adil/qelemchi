/* ==========================================================================
   Qelemchi · GitHub API client
   Browser -> api.github.com only. Fine-grained PATs are used directly.
   ========================================================================== */

const GITHUB_API = 'https://api.github.com';
const WORKFLOW_PATH = '.github/workflows/qelemchi.yml';

const WORKFLOW_YAML = `name: Qelemchi PDF

on:
  workflow_dispatch:
    inputs:
      engine:
        description: TeX engine
        required: true
        default: xelatex
        type: choice
        options:
          - xelatex
          - pdflatex
          - lualatex
      root_file:
        description: Root .tex file
        required: true
        default: main.tex
        type: string

permissions:
  contents: write

concurrency:
  group: qelemchi-pdf-\${{ github.ref }}
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Compile LaTeX
        uses: xu-cheng/latex-action@v4
        with:
          root_file: \${{ inputs.root_file }}
          compiler: \${{ inputs.engine }}
          args: -interaction=nonstopmode -halt-on-error -file-line-error
          extra_system_packages: fonts-noto-cjk

      - name: Publish PDF
        shell: bash
        run: |
          set -e
          PDF=\$(find . -type f -name '*.pdf' -not -path './.git/*' -not -path './build/*' | head -n 1)
          if [ -z "\$PDF" ]; then
            echo "No PDF produced by LaTeX."
            exit 1
          fi
          mkdir -p build
          cp "\$PDF" build/main.pdf
          git config user.name "Qelemchi"
          git config user.email "qelemchi@users.noreply.github.com"
          git add build/main.pdf
          if git diff --cached --quiet; then
            echo "PDF unchanged; nothing to publish."
          else
            git commit -m "Build PDF [skip ci]"
            git push
          fi
`;

class GitHubError extends Error {
  constructor(message, status = 0, details = null, url = '') {
    super(message);
    this.name = 'GitHubError';
    this.status = status;
    this.details = details;
    this.url = url;
  }
}

function ghHeaders(token, accept, extra = {}) {
  return Object.assign({
    'Authorization': `Bearer ${token}`,
    'Accept': accept || 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  }, extra || {});
}

function ghErrorMessage(data, fallback) {
  if (!data) return fallback;
  if (typeof data === 'string') return data;
  if (data.message && data.errors && data.errors.length) {
    return `${data.message}：${data.errors.map((e) => e.message || e.code || String(e)).join('；')}`;
  }
  return data.message || fallback;
}

async function ghRequest(path, options = {}) {
  const token = options.token || state.token;
  if (!token) throw new GitHubError('尚未连接 GitHub。', 401);
  const method = options.method || 'GET';
  const accept = options.accept || 'application/vnd.github+json';
  const headers = ghHeaders(token, accept, options.headers);
  let body;
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeout || 45000);
  let res;
  try {
    res = await fetch(GITHUB_API + path, {
      method,
      headers,
      body,
      signal: controller.signal,
      cache: 'no-store',
      redirect: options.redirect || 'follow'
    });
  } catch (e) {
    clearTimeout(timeout);
    if (e.name === 'AbortError') throw new GitHubError('GitHub 请求超时，请检查网络后重试。', 0);
    throw new GitHubError('无法连接 GitHub。请检查网络、代理或仓库权限。', 0);
  }
  clearTimeout(timeout);
  if (options.rawResponse) return res;
  if (res.status === 204) return null;
  let data = null;
  const text = await res.text();
  if (text) {
    try { data = JSON.parse(text); } catch (e) { data = text; }
  }
  if (!res.ok) {
    let msg = ghErrorMessage(data, `GitHub API ${res.status}`);
    if (res.status === 401) msg = '令牌无效或已过期，请重新连接 GitHub。';
    else if (res.status === 403) {
      const remaining = res.headers.get('x-ratelimit-remaining');
      if (remaining === '0') {
        const reset = res.headers.get('x-ratelimit-reset');
        const t = reset ? new Date(Number(reset) * 1000) : null;
        msg = `GitHub API 速率限制已用完${t ? `，约 ${formatDateTime(t)} 重置` : ''}。`;
      } else {
        msg = `GitHub 拒绝了请求：${msg}。请确认令牌有该仓库的 Contents 与 Actions 权限。`;
      }
    } else if (res.status === 404) {
      msg = 'GitHub 没有找到这个仓库或文件。请确认仓库名、分支和令牌权限。';
    } else if (res.status === 409) {
      msg = '仓库为空或发生了并发冲突，请刷新后重试。';
    } else if (res.status === 422) {
      msg = `GitHub 拒绝了写入：${msg}`;
    }
    throw new GitHubError(msg, res.status, data, GITHUB_API + path);
  }
  return data;
}

async function ghUser() {
  return ghRequest('/user');
}

async function ghRepo(owner, name) {
  return ghRequest(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`);
}

async function ghListRepos() {
  const repos = await ghRequest('/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator&visibility=all');
  return (Array.isArray(repos) ? repos : [])
    .filter((r) => r.permissions && (r.permissions.push || r.permissions.admin || r.permissions.maintain || r.permissions.write))
    .map((r) => ({
      owner: r.owner.login,
      name: r.name,
      full: r.full_name,
      private: !!r.private,
      defaultBranch: r.default_branch,
      updatedAt: r.updated_at,
      description: r.description || '',
      url: r.html_url
    }));
}

async function ghRef(owner, name, branch) {
  try {
    const data = await ghRequest(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/git/ref/heads/${branch.split('/').map(encodeURIComponent).join('/')}`);
    return data && data.object ? data.object.sha : (data && data.sha);
  } catch (e) {
    if (e instanceof GitHubError && (e.status === 404 || e.status === 409)) return null;
    throw e;
  }
}

async function ghGetCommit(owner, name, sha) {
  return ghRequest(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/git/commits/${encodeURIComponent(sha)}`);
}

async function ghGetTree(owner, name, sha, recursive = true) {
  return ghRequest(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/git/trees/${encodeURIComponent(sha)}${recursive ? '?recursive=1' : ''}`);
}

async function ghGetBlob(owner, name, sha) {
  return ghRequest(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/git/blobs/${encodeURIComponent(sha)}`);
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      out[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return out;
}

function detectMainPath(files) {
  const texts = Array.from(files.values()).filter((f) => f.text != null && /\.tex$/i.test(f.path));
  const withClass = texts.filter((f) => /\\documentclass\b/.test(f.text));
  const pool = withClass.length ? withClass : texts;
  if (!pool.length) return '';
  const preferred = ['main.tex', 'paper.tex', 'article.tex', 'ms.tex', 'thesis.tex', 'root.tex'];
  for (const name of preferred) {
    const hit = pool.find((f) => f.path.toLowerCase() === name);
    if (hit) return hit.path;
  }
  return pool.slice().sort((a, b) => a.path.length - b.path.length || a.path.localeCompare(b.path))[0].path;
}

async function ghLoadProject(owner, name, opts = {}) {
  const repo = await ghRepo(owner, name);
  const branch = repo.default_branch || 'main';
  if (opts.onProgress) opts.onProgress({ phase: 'repo', repo });
  const refSha = await ghRef(owner, name, branch);
  const files = new Map();
  const skipped = [];
  let treeSha = '';
  let hasWorkflow = false;
  if (refSha) {
    const commit = await ghGetCommit(owner, name, refSha);
    treeSha = commit.tree.sha;
    const tree = await ghGetTree(owner, name, treeSha, true);
    hasWorkflow = (tree.tree || []).some((t) => t.path === WORKFLOW_PATH && t.type === 'blob');
    let blobs = (tree.tree || []).filter((t) => t.type === 'blob');
    blobs = blobs.filter((t) => {
      const p = t.path;
      if (!p) return false;
      if (p.startsWith('.git/') || p.startsWith('node_modules/') || p.startsWith('__pycache__/')) return false;
      if (p.startsWith('.github/') || p.startsWith('build/')) return false;
      if (/\.(aux|log|out|toc|synctex\.gz|fls|fdb_latexmk|bbl|blg|nav|snm|vrb)$/i.test(p)) return false;
      return true;
    });
    if (blobs.length > 320) {
      skipped.push(`仓库文件较多，已只读取前 320 个（共 ${blobs.length} 个）。`);
      blobs = blobs.slice(0, 320);
    }
    if (opts.onProgress) opts.onProgress({ phase: 'tree', total: blobs.length, loaded: 0, treeSha });
    let loaded = 0;
    await mapLimit(blobs, 6, async (blob) => {
      const path = blob.path;
      const size = blob.size || 0;
      if (size > 8 * 1024 * 1024) {
        skipped.push(`${path} 超过 8 MB，已跳过。`);
        loaded++;
        return;
      }
      try {
        const data = await ghGetBlob(owner, name, blob.sha);
        const base64 = data.content ? data.content.replace(/\s+/g, '') : '';
        const text = isTextPath(path) && size <= 3 * 1024 * 1024 ? base64ToUtf8(base64) : null;
        files.set(path, {
          path,
          sha: blob.sha,
          size,
          text: text != null ? text : null,
          base64: text == null ? base64 : null,
          mime: mimeFor(path)
        });
      } catch (e) {
        skipped.push(`${path} 读取失败：${e.message}`);
      }
      loaded++;
      if (opts.onProgress && (loaded % 3 === 0 || loaded === blobs.length)) {
        opts.onProgress({ phase: 'files', total: blobs.length, loaded, path, treeSha });
      }
    });
  }
  const mainPath = detectMainPath(files);
  return {
    repo,
    branch,
    refSha,
    treeSha,
    files,
    mainPath,
    hasWorkflow,
    empty: files.size === 0,
    skipped,
    noTex: !!files.size && !mainPath
  };
}

async function ghCreateBlob(owner, name, content, isBase64 = true) {
  return ghRequest(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/git/blobs`, {
    method: 'POST',
    body: { content, encoding: isBase64 ? 'base64' : 'utf-8' }
  });
}

async function ghCreateTree(owner, name, tree, baseTree) {
  const body = { tree };
  if (baseTree) body.base_tree = baseTree;
  return ghRequest(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/git/trees`, {
    method: 'POST',
    body
  });
}

async function ghCreateCommit(owner, name, message, treeSha, parents, author) {
  const body = { message, tree: treeSha, parents: parents || [] };
  if (author) body.author = author;
  return ghRequest(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/git/commits`, {
    method: 'POST',
    body
  });
}

async function ghUpdateRef(owner, name, branch, sha) {
  return ghRequest(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/git/refs/heads/${branch.split('/').map(encodeURIComponent).join('/')}`, {
    method: 'PATCH',
    body: { sha, force: false }
  });
}

async function ghCreateRef(owner, name, branch, sha) {
  return ghRequest(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/git/refs`, {
    method: 'POST',
    body: { ref: `refs/heads/${branch}`, sha }
  });
}

async function ghCommitChanges(owner, name, branch, changes, message, opts = {}) {
  const refSha = await ghRef(owner, name, branch);
  if (!refSha) {
    return ghInitializeRepo(owner, name, branch, changes, message);
  }
  const head = await ghGetCommit(owner, name, refSha);
  const blobs = changes.filter((c) => !c.delete);
  const blobResults = await mapLimit(blobs, 4, async (change) => {
    const content = change.base64 != null ? change.base64 : utf8ToBase64(change.text || '');
    const blob = await ghCreateBlob(owner, name, content, true);
    return { path: change.path, sha: blob.sha };
  });
  const treeEntries = [];
  for (const change of changes) {
    if (change.delete) {
      treeEntries.push({ path: change.path, mode: '100644', type: 'blob', sha: null });
    }
  }
  for (const b of blobResults) {
    treeEntries.push({ path: b.path, mode: '100644', type: 'blob', sha: b.sha });
  }
  const tree = await ghCreateTree(owner, name, treeEntries, head.tree.sha);
  let commit;
  try {
    commit = await ghCreateCommit(owner, name, message, tree.sha, [refSha], opts.author);
    await ghUpdateRef(owner, name, branch, commit.sha);
  } catch (e) {
    if (e instanceof GitHubError && (e.status === 422 || e.status === 409)) {
      throw new GitHubError('远程仓库在你编辑期间有了新的提交。请先刷新仓库，再提交你的修改，以免覆盖他人的工作。', 409, e.details);
    }
    throw e;
  }
  return { commit, sha: commit.sha, treeSha: tree.sha, branch };
}

async function ghInitializeRepo(owner, name, branch, changes, message) {
  const blobs = changes.filter((c) => !c.delete);
  const blobResults = await mapLimit(blobs, 4, async (change) => {
    const content = change.base64 != null ? change.base64 : utf8ToBase64(change.text || '');
    const blob = await ghCreateBlob(owner, name, content, true);
    return { path: change.path, sha: blob.sha };
  });
  const treeEntries = blobResults.map((b) => ({ path: b.path, mode: '100644', type: 'blob', sha: b.sha }));
  if (!treeEntries.length) throw new GitHubError('没有可写入的文件。', 400);
  const tree = await ghCreateTree(owner, name, treeEntries, null);
  const commit = await ghCreateCommit(owner, name, message, tree.sha, []);
  try {
    await ghCreateRef(owner, name, branch, commit.sha);
  } catch (e) {
    // A branch may have been created by another tab in the meantime.
    const refSha = await ghRef(owner, name, branch);
    if (!refSha) throw e;
    return ghCommitChanges(owner, name, branch, changes, message);
  }
  return { commit, sha: commit.sha, treeSha: tree.sha, branch };
}

async function ghListCommits(owner, name, branch, page = 1, perPage = 30) {
  return ghRequest(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/commits?sha=${encodeURIComponent(branch)}&per_page=${perPage}&page=${page}`);
}

async function ghCommitDetail(owner, name, sha) {
  return ghRequest(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/commits/${encodeURIComponent(sha)}`);
}

async function ghRestoreCommit(owner, name, branch, targetSha, message) {
  const target = await ghGetCommit(owner, name, targetSha);
  const headSha = await ghRef(owner, name, branch);
  if (!headSha) throw new GitHubError('当前分支没有可恢复的提交。', 400);
  const commit = await ghCreateCommit(owner, name, message, target.tree.sha, [headSha]);
  try {
    await ghUpdateRef(owner, name, branch, commit.sha);
  } catch (e) {
    if (e instanceof GitHubError && (e.status === 422 || e.status === 409)) {
      throw new GitHubError('恢复失败：远程分支刚刚更新。请刷新历史后重试。', 409);
    }
    throw e;
  }
  return commit;
}

async function ghCreateRepo(name, opts = {}) {
  const repoName = String(name || '').trim();
  if (!/^[A-Za-z0-9_.-]{1,100}$/.test(repoName)) {
    throw new GitHubError('仓库名只能包含字母、数字、点、下划线与连字符。', 400);
  }
  return ghRequest('/user/repos', {
    method: 'POST',
    body: {
      name: repoName,
      private: opts.private !== false,
      description: opts.description || 'LaTeX paper managed with Qelemchi',
      auto_init: false,
      has_issues: false,
      has_wiki: false,
      has_projects: false
    }
  });
}

async function ghFileExists(owner, name, path, ref) {
  try {
    await ghRequest(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}`);
    return true;
  } catch (e) {
    if (e instanceof GitHubError && e.status === 404) return false;
    throw e;
  }
}

async function ghGetWorkflow(owner, name) {
  try {
    return await ghRequest(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/actions/workflows/qelemchi.yml`);
  } catch (e) {
    if (e instanceof GitHubError && e.status === 404) return null;
    throw e;
  }
}

async function ghDispatchWorkflow(owner, name, branch, engine, rootFile) {
  return ghRequest(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/actions/workflows/qelemchi.yml/dispatches`, {
    method: 'POST',
    body: {
      ref: branch,
      inputs: { engine, root_file: rootFile }
    }
  });
}

async function ghWorkflowRuns(owner, name, perPage = 10) {
  return ghRequest(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/actions/workflows/qelemchi.yml/runs?per_page=${perPage}&event=workflow_dispatch`);
}

async function ghRunJobs(owner, name, runId) {
  return ghRequest(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/actions/runs/${encodeURIComponent(runId)}/jobs`);
}

async function ghFetchPdf(owner, name, ref) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  let res;
  try {
    res = await fetch(`${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/contents/build/main.pdf?ref=${encodeURIComponent(ref)}`, {
      headers: ghHeaders(state.token, 'application/vnd.github.raw'),
      signal: controller.signal,
      cache: 'no-store'
    });
  } catch (e) {
    clearTimeout(timer);
    throw new GitHubError('下载编译后的 PDF 失败，请检查网络。', 0);
  }
  clearTimeout(timer);
  if (!res.ok) {
    if (res.status === 404) throw new GitHubError('还没有找到 build/main.pdf。请确认 Actions 已运行成功，并且工作流有 Contents 写权限。', 404);
    throw new GitHubError(`下载 PDF 失败（HTTP ${res.status}）。`, res.status);
  }
  return await res.blob();
}

async function ghInstallWorkflow(owner, name, branch) {
  return ghCommitChanges(owner, name, branch, [
    { path: WORKFLOW_PATH, text: WORKFLOW_YAML }
  ], 'Add Qelemchi PDF workflow');
}

function githubRepoUrl(owner, name) {
  return `https://github.com/${owner}/${name}`;
}

function githubCommitUrl(owner, name, sha) {
  return `${githubRepoUrl(owner, name)}/commit/${sha}`;
}
