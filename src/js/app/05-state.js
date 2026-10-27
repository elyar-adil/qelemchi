/* ==========================================================================
   Qelemchi · application state and project helpers
   ========================================================================== */

const state = {
  booted: false,
  mode: 'demo',
  connected: false,
  token: '',
  user: null,
  repo: null,
  branch: 'main',
  remember: 'session',
  passphrase: '',
  sessionMeta: null,
  files: new Map(),
  assets: new Map(),
  assetUrls: new Map(),
  mainPath: 'main.tex',
  activePath: '',
  openTabs: [],
  dirty: new Set(),
  deleted: new Set(),
  collapsed: new Set(),
  lastSaved: 0,
  lastCommit: null,
  projectTitle: '示例论文',
  settings: loadSettings(),
  theme: 'light',
  zoom: 1,
  sideTab: 'files',
  editorMode: 'source',
  previewView: 'pdf',
  preview: null,
  previewBusy: false,
  previewTimer: null,
  previewRenderedAt: 0,
  warnings: [],
  outline: [],
  searchQuery: '',
  searchResults: [],
  hasWorkflow: false,
  repoInfo: null,
  pdfUrl: '',
  pdfBlob: null,
  pdfSource: 'none',
  pdfPages: 0,
  pdfLabel: '',
  localTex: {
    busy: false,
    queued: false,
    stale: true,
    autoArmed: false,
    error: '',
    engine: '',
    phase: 'idle',
    progress: 0,
    signature: '',
    compiledAt: 0,
    ms: 0,
    log: '',
    warnings: [],
    startedAt: 0,
    modalOpen: false,
    result: null
  },
  compile: {
    busy: false,
    cancelled: false,
    run: null,
    status: 'idle',
    step: 0,
    startedAt: 0,
    error: '',
    modalOpen: false
  },
  history: {
    open: false,
    loading: false,
    list: [],
    page: 1,
    selected: null,
    detail: null,
    mode: 'demo'
  },
  save: {
    busy: false,
    error: '',
    lastMessage: ''
  },
  editorReady: false,
  bootProgress: 0,
  demoDismissed: false,
  offline: false,
  lastCursor: { line: 1, column: 1 },
  mobilePane: 'editor'
};

function resolveTheme(setting) {
  if (setting === 'light' || setting === 'dark') return setting;
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(setting) {
  state.settings.theme = setting;
  state.theme = resolveTheme(setting);
  document.documentElement.dataset.theme = state.theme;
  document.documentElement.style.colorScheme = state.theme;
  saveSettings(state.settings);
}

function toggleTheme() {
  const next = state.theme === 'dark' ? 'light' : 'dark';
  applyTheme(next);
}

function serializeFiles(files = state.files) {
  const out = [];
  for (const file of files.values()) {
    if (file.text != null) out.push({ path: file.path, text: file.text });
    else out.push({ path: file.path, base64: file.base64 || '', mime: file.mime || mimeFor(file.path) });
  }
  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}

function fileMapFromArray(files) {
  const map = new Map();
  for (const f of files || []) {
    if (!f || !f.path) continue;
    const path = normalizeProjectPath(f.path);
    if (!path) continue;
    if (f.text != null) {
      map.set(path, {
        path,
        text: String(f.text),
        base64: null,
        mime: mimeFor(path),
        size: new Blob([String(f.text)]).size,
        sha: f.sha || null
      });
    } else {
      map.set(path, {
        path,
        text: null,
        base64: f.base64 || '',
        mime: f.mime || mimeFor(path),
        size: f.base64 ? Math.floor((String(f.base64).length * 3) / 4) : (f.size || 0),
        sha: f.sha || null
      });
    }
  }
  return map;
}

function revokeAssetUrls() {
  for (const url of state.assetUrls.values()) {
    try { URL.revokeObjectURL(url); } catch (e) { /* ignore */ }
  }
  state.assetUrls.clear();
  state.assets.clear();
}

function rebuildAssetUrls() {
  revokeAssetUrls();
  for (const file of state.files.values()) {
    if (file.text != null || !file.base64) continue;
    if (!isImagePath(file.path) && !isPdfPath(file.path)) continue;
    try {
      const bytes = base64ToBytes(file.base64);
      const blob = new Blob([bytes], { type: file.mime || mimeFor(file.path) });
      const url = URL.createObjectURL(blob);
      state.assetUrls.set(file.path, url);
      state.assets.set(file.path, url);
    } catch (e) {
      // A corrupt binary asset should not prevent editing the paper.
    }
  }
}

function detectMainFromState() {
  const texts = Array.from(state.files.values()).filter((f) => f.text != null && /\.tex$/i.test(f.path));
  const withClass = texts.filter((f) => /\\documentclass\b/.test(f.text || ''));
  const pool = withClass.length ? withClass : texts;
  const preferred = ['main.tex', 'paper.tex', 'article.tex', 'ms.tex', 'thesis.tex'];
  for (const name of preferred) {
    const hit = pool.find((f) => f.path.toLowerCase() === name);
    if (hit) return hit.path;
  }
  return pool.length ? pool.slice().sort((a, b) => a.path.length - b.path.length)[0].path : '';
}

function applyProjectFiles(files, opts = {}) {
  revokeAssetUrls();
  state.files = fileMapFromArray(files);
  state.mainPath = opts.mainPath || detectMainFromState() || 'main.tex';
  state.dirty.clear();
  state.deleted.clear();
  state.collapsed.clear();
  state.lastCommit = null;
  state.openTabs = [];
  state.activePath = '';
  state.preview = null;
  state.warnings = [];
  state.outline = [];
  state.lastSaved = opts.lastSaved || Date.now();
  rebuildAssetUrls();
  const first = state.mainPath && state.files.has(state.mainPath) ? state.mainPath : (state.files.keys().next().value || '');
  if (first) {
    state.openTabs = [first];
    state.activePath = first;
  }
  updateProjectTitle();
}

function updateProjectTitle() {
  let title = '';
  if (state.preview && state.preview.meta && state.preview.meta.title && state.preview.meta.title !== '未命名文稿') {
    title = state.preview.meta.title;
  }
  if (!title && state.repo) title = state.repo.full;
  if (!title) {
    const main = state.files.get(state.mainPath);
    if (main && main.text) {
      const m = main.text.match(/\\title\s*\{([^}]*)\}/);
      if (m) title = m[1].replace(/\\\\/g, ' ').replace(/[{}]/g, '').trim();
    }
  }
  state.projectTitle = title || '未命名论文';
  const elTitle = $('#project-title');
  if (elTitle) {
    elTitle.textContent = state.projectTitle;
    elTitle.title = state.projectTitle;
  }
  document.title = `${state.projectTitle} · Qelemchi`;
}

function currentFile() {
  return state.activePath ? state.files.get(state.activePath) || null : null;
}

function getFile(path) {
  return state.files.get(normalizeProjectPath(path)) || null;
}

function textFilesForPreview() {
  const out = [];
  for (const f of state.files.values()) {
    if (f.text != null) out.push({ path: f.path, text: f.text });
  }
  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}

function markDirty(path) {
  if (!path) return;
  state.dirty.add(path);
  state.deleted.delete(path);
}

function clearChanges() {
  state.dirty.clear();
  state.deleted.clear();
}

function hasChanges() {
  return state.dirty.size > 0 || state.deleted.size > 0;
}

function changesForCommit() {
  const changes = [];
  for (const path of state.dirty) {
    const file = state.files.get(path);
    if (!file) continue;
    if (file.text != null) changes.push({ path, text: file.text });
    else changes.push({ path, base64: file.base64 || '', mime: file.mime });
  }
  for (const path of state.deleted) {
    changes.push({ path, delete: true });
  }
  return changes.sort((a, b) => a.path.localeCompare(b.path));
}

function setActivePath(path) {
  state.activePath = path;
  if (path && !state.openTabs.includes(path)) state.openTabs.push(path);
}

function closeTabState(path) {
  state.openTabs = state.openTabs.filter((p) => p !== path);
  if (state.activePath === path) {
    state.activePath = state.openTabs[state.openTabs.length - 1] || '';
  }
}

function removeFileState(path) {
  const existing = state.files.get(path);
  state.files.delete(path);
  state.dirty.delete(path);
  if (existing && existing.sha) state.deleted.add(path);
  else state.deleted.delete(path);
  state.openTabs = state.openTabs.filter((p) => p !== path);
  if (state.activePath === path) state.activePath = state.openTabs[state.openTabs.length - 1] || '';
  if (state.mainPath === path) state.mainPath = detectMainFromState();
}

function addFileState(path, text = '', opts = {}) {
  const normalized = normalizeProjectPath(path);
  if (!normalized) return null;
  const file = {
    path: normalized,
    text: String(text == null ? '' : text),
    base64: null,
    mime: mimeFor(normalized),
    size: new Blob([String(text || '')]).size,
    sha: opts.sha || null
  };
  state.files.set(normalized, file);
  markDirty(normalized);
  return file;
}

function addBinaryFileState(path, base64, mime, size) {
  const normalized = normalizeProjectPath(path);
  if (!normalized) return null;
  const file = {
    path: normalized,
    text: null,
    base64,
    mime: mime || mimeFor(normalized),
    size: size || Math.floor((String(base64 || '').length * 3) / 4),
    sha: null
  };
  state.files.set(normalized, file);
  markDirty(normalized);
  return file;
}

function renameFileState(oldPath, newPath) {
  const file = state.files.get(oldPath);
  if (!file) return false;
  const normalized = normalizeProjectPath(newPath);
  if (!normalized || state.files.has(normalized)) return false;
  state.files.delete(oldPath);
  const wasRemote = !!file.sha;
  file.path = normalized;
  state.files.set(normalized, file);
  state.dirty.delete(oldPath);
  if (wasRemote) state.deleted.add(oldPath);
  else state.deleted.delete(oldPath);
  markDirty(normalized);
  state.openTabs = state.openTabs.map((p) => (p === oldPath ? normalized : p));
  if (state.activePath === oldPath) state.activePath = normalized;
  if (state.mainPath === oldPath) state.mainPath = normalized;
  rebuildAssetUrls();
  return true;
}

function projectSnapshotRecord(message) {
  return {
    id: `snap-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    projectId: 'demo',
    createdAt: Date.now(),
    message: message || '保存草稿',
    title: state.projectTitle,
    mainPath: state.mainPath,
    files: serializeFiles()
  };
}

function demoProjectRecord() {
  return {
    version: 1,
    updatedAt: Date.now(),
    title: state.projectTitle,
    mainPath: state.mainPath,
    files: serializeFiles()
  };
}

const persistDemoSoon = debounce(async () => {
  if (state.mode !== 'demo') return;
  try {
    await saveProjectRecord(demoProjectRecord());
    state.lastSaved = Date.now();
    renderSaveState();
  } catch (e) { /* ignore */ }
}, 900);

async function persistDemoNow() {
  if (state.mode !== 'demo') return;
  try {
    await saveProjectRecord(demoProjectRecord());
    state.lastSaved = Date.now();
    renderSaveState();
  } catch (e) { /* ignore */ }
}

async function createDemoSnapshot(message) {
  const record = projectSnapshotRecord(message);
  await saveSnapshot(record);
  return record;
}

async function loadDemoWorkspace() {
  const saved = await loadProjectRecord();
  if (saved && Array.isArray(saved.files) && saved.files.length) {
    applyProjectFiles(saved.files, { mainPath: saved.mainPath, lastSaved: saved.updatedAt });
    state.projectTitle = saved.title || state.projectTitle;
    updateProjectTitle();
    return { restored: true };
  }
  applyProjectFiles(demoProjectFiles(), { mainPath: 'main.tex' });
  updateProjectTitle();
  await persistDemoNow();
  return { restored: false };
}

function applyTemplate(id) {
  const template = getTemplate(id);
  applyProjectFiles(template.files, { mainPath: template.mainPath });
  updateProjectTitle();
  if (state.mode === 'demo') persistDemoSoon();
}

function setMode(mode) {
  state.mode = mode;
  state.connected = mode === 'github';
  if (mode === 'demo') {
    state.repo = null;
    state.branch = 'main';
    state.hasWorkflow = false;
  }
}
