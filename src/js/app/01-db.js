/* ==========================================================================
   Qelemchi · IndexedDB persistence
   ========================================================================== */

const DB_NAME = 'qelemchi';
const DB_VERSION = 1;
let dbPromise = null;

function openDatabase() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error('IndexedDB 不可用'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('secrets')) db.createObjectStore('secrets');
      if (!db.objectStoreNames.contains('snapshots')) db.createObjectStore('snapshots', { keyPath: 'id' });
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => reject(req.error || new Error('无法打开本地数据库'));
    req.onblocked = () => reject(new Error('本地数据库被其他标签页占用'));
  });
  return dbPromise;
}

function txStore(store, mode = 'readonly') {
  return openDatabase().then((db) => db.transaction(store, mode).objectStore(store));
}

function reqPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB 操作失败'));
  });
}

async function idbGet(store, key) {
  try {
    const s = await txStore(store);
    return await reqPromise(s.get(key));
  } catch (e) {
    return null;
  }
}

async function idbPut(store, key, value) {
  const s = await txStore(store, 'readwrite');
  // Stores with a keyPath (snapshots) reject an explicit out-of-line key.
  return reqPromise(s.keyPath ? s.put(value) : s.put(value, key));
}

async function idbDelete(store, key) {
  const s = await txStore(store, 'readwrite');
  return reqPromise(s.delete(key));
}

async function idbAll(store) {
  try {
    const s = await txStore(store);
    return await reqPromise(s.getAll());
  } catch (e) {
    return [];
  }
}

async function idbClear(store) {
  const s = await txStore(store, 'readwrite');
  return reqPromise(s.clear());
}

const LS = {
  meta: 'qelemchi.session',
  settings: 'qelemchi.settings',
  theme: 'qelemchi.theme',
  demo: 'qelemchi.demo.fallback',
  snapshots: 'qelemchi.snapshots.fallback'
};

function loadSessionMeta() {
  try {
    const raw = localStorage.getItem(LS.meta);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

function saveSessionMeta(meta) {
  try { localStorage.setItem(LS.meta, JSON.stringify(meta)); } catch (e) { /* ignore */ }
}

function clearSessionMeta() {
  try { localStorage.removeItem(LS.meta); } catch (e) { /* ignore */ }
}

const DEFAULT_SETTINGS = {
  theme: 'system',
  editorMode: 'source',
  fontSize: 13.5,
  lineNumbers: true,
  lineWrapping: true,
  previewDelay: 420,
  autoSave: true,
  compileEngine: 'xelatex',
  localEngine: 'auto',
  localCompileDelay: 2200,
  showOutlineBadge: true
};

function loadSettings() {
  try {
    const raw = localStorage.getItem(LS.settings);
    const parsed = raw ? JSON.parse(raw) : {};
    return Object.assign({}, DEFAULT_SETTINGS, parsed || {});
  } catch (e) {
    return Object.assign({}, DEFAULT_SETTINGS);
  }
}

function saveSettings(settings) {
  try { localStorage.setItem(LS.settings, JSON.stringify(settings)); } catch (e) { /* ignore */ }
}

async function saveProjectRecord(record) {
  try {
    await idbPut('kv', 'project:demo', record);
  } catch (e) {
    try { localStorage.setItem(LS.demo, JSON.stringify(record)); } catch (err) { /* ignore */ }
  }
}

async function loadProjectRecord() {
  try {
    const rec = await idbGet('kv', 'project:demo');
    if (rec) return rec;
  } catch (e) { /* fall through */ }
  try {
    const raw = localStorage.getItem(LS.demo);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

async function saveSnapshot(record) {
  try {
    await idbPut('snapshots', record.id, record);
  } catch (e) {
    try {
      const list = await listSnapshots();
      list.unshift(record);
      localStorage.setItem(LS.snapshots, JSON.stringify(list.slice(0, 30)));
    } catch (err) { /* ignore */ }
  }
  await pruneSnapshots(30);
}

async function listSnapshots(projectId = 'demo') {
  const all = await idbAll('snapshots');
  // Also merge the localStorage fallback: a snapshot may have been written
  // there if IndexedDB failed once, and idbAll() silently returns [].
  try {
    const raw = localStorage.getItem(LS.snapshots);
    const fallback = raw ? JSON.parse(raw) : [];
    for (const snap of fallback) {
      if (!all.some((s) => s.id === snap.id)) all.push(snap);
    }
  } catch (e) { /* ignore malformed fallback */ }
  return all.filter((s) => s.projectId === projectId).sort((a, b) => b.createdAt - a.createdAt);
}

async function pruneSnapshots(limit = 30) {
  try {
    const all = await listSnapshots('demo');
    for (const snap of all.slice(limit)) await idbDelete('snapshots', snap.id);
  } catch (e) { /* ignore */ }
}

async function deleteSnapshot(id) {
  try { await idbDelete('snapshots', id); } catch (e) { /* ignore */ }
}

async function clearAllLocalData() {
  try { await idbClear('kv'); } catch (e) { /* ignore */ }
  try { await idbClear('snapshots'); } catch (e) { /* ignore */ }
  try { localStorage.removeItem(LS.demo); } catch (e) { /* ignore */ }
  try { localStorage.removeItem(LS.snapshots); } catch (e) { /* ignore */ }
}
