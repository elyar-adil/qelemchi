/* ==========================================================================
   Qelemchi · compile a real PDF in the browser
   --------------------------------------------------------------------------
   The PDF tab and the compile button use a WebAssembly TeX Live engine that
   ships inside this HTML file. There is no server and no network request:
   the engine, its LaTeX format and a small texmf archive are decoded in a
   worker, and the kpse lookup hook is redirected at that in-memory archive.
   ========================================================================== */

const LOCAL_TEX_FMT_NAMES = {
  pdftex: 'swiftlatexpdftex.fmt',
  xetex: 'swiftlatexxetex.fmt',
  dvipdfm: ''
};

const LOCAL_TEX_PRELUDE = String.raw`
(function(){
  var A = self.__QELEMCHI_ASSETS;
  function dec(s){var b=atob(s),u=new Uint8Array(b.length);for(var i=0;i<b.length;i++)u[i]=b.charCodeAt(i);return u;}
  function gunzip(s){return fflate.gunzipSync(dec(s));}
  self.__QELEMCHI_WASM = gunzip(A.wasm);
  var bytes=null, files=null, written=Object.create(null);
  var EXTS={3:['.tfm','.pk'],4:['.bib'],7:['.bst'],8:['.map'],10:['.fmt'],26:['.sty','.cls','.def','.cfg','.clo','.fd','.ltx','.tex'],29:['.pfb','.t1'],30:['.vf'],33:['.enc'],36:['.otf','.ttf'],41:['.pgc'],47:['.otf','.ttf']};
  var GENERIC=['.tfm','.pfb','.afm','.enc','.map','.sty','.cls','.clo','.def','.cfg','.tex','.ltx','.fd','.vf','.bib','.bst','.ttf','.otf','.png','.jpg','.pdf','.tec','.txt'];
  function loadTexmf(){
    if(files) return;
    var raw=gunzip(A.texmf);
    if(String.fromCharCode(raw[0],raw[1],raw[2],raw[3],raw[4])!=='TXMF1') throw new Error('bad texmf archive');
    var dv=new DataView(raw.buffer,raw.byteOffset,raw.byteLength);
    var hlen=dv.getUint32(5,true);
    var header=JSON.parse(new TextDecoder().decode(raw.subarray(9,9+hlen)));
    bytes=raw.subarray(9+hlen);
    files=new Map();
    for(var i=0;i<header.files.length;i++) files.set(header.files[i].name,header.files[i]);
  }
  function fileFor(name){
    loadTexmf();
    var e=files.get(name); if(e) return e;
    var low=name.toLowerCase();
    var it=files.values(), cur=it.next();
    while(!cur.done){ if(cur.value.name.toLowerCase()===low) return cur.value; cur=it.next(); }
    return null;
  }
  function resolution(name,fmt){
    if(/\.[a-z0-9]{1,6}$/i.test(name)) return fileFor(name);
    var lists=[EXTS[fmt]||[],GENERIC];
    for(var i=0;i<lists.length;i++) for(var j=0;j<lists[i].length;j++){
      var e=fileFor(name+lists[i][j]); if(e) return e;
    }
    return fileFor(name);
  }
  function pathFor(e){
    var path=TEXCACHEROOT+'/'+e.name;
    if(!written[path]){ FS.writeFile(path,bytes.subarray(e.off,e.off+e.len)); written[path]=1; }
    return allocate(intArrayFromString(path),'i8',ALLOC_NORMAL);
  }
  self.__qelemchiLocalFile=function(name,format){
    if(name.indexOf('/tex/')===0) name=name.slice(5);
    if(name.indexOf('/')!==-1) return 0;
    if(format===10 && name===self.__QELEMCHI_FMT_NAME){
      if(!self.__qelemchiFmtBytes) self.__qelemchiFmtBytes=gunzip(A.format);
      var fmtPath=TEXCACHEROOT+'/'+name;
      if(!written[fmtPath]){ FS.writeFile(fmtPath,self.__qelemchiFmtBytes); written[fmtPath]=1; }
      return allocate(intArrayFromString(fmtPath),'i8',ALLOC_NORMAL);
    }
    var entry=resolution(name,format);
    return entry?pathFor(entry):0;
  };
})();
function kpse_find_file_impl(nameptr, format, mustexist){
  return self.__qelemchiLocalFile(UTF8ToString(nameptr), format) || 0;
}
`;

const localTexEngines = new Map(); // kind -> { worker, pending, busy, startedAt }
const LOCAL_TEX_CACHE_PREFIX = 'texasset:';
let localTexConfigCache = null;
let localTexAssetCache = null;
const localTexAssetPromises = new Map();
let localTexAssetProgress = null;
let localTexCompileToken = 0;
let localTexScheduleTimer = null;
let localTexIdleTimer = null;
let localTexElapsedTimer = null;

function localTexEnabled() {
  return !!document.getElementById('qelemchi-tex-assets');
}

function localTexConfig() {
  if (localTexConfigCache) return localTexConfigCache;
  const el = document.getElementById('qelemchi-tex-assets');
  if (!el) throw new Error('TeX 资源清单不可用');
  let parsed;
  try {
    parsed = JSON.parse(el.textContent || '');
  } catch (e) {
    throw new Error(`TeX 资源清单无法读取：${e.message || e}`);
  }
  if (!parsed) throw new Error('TeX 资源清单为空');
  if (!parsed.wasm && (!parsed.files || !parsed.bases)) throw new Error('TeX 资源清单不完整');
  localTexConfigCache = parsed;
  return parsed;
}

function localTexBytesToBase64(bytes) {
  let out = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    out += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(out);
}

async function localTexSha256(bytes) {
  if (!(window.crypto && window.crypto.subtle && window.crypto.subtle.digest)) return '';
  try {
    const digest = await window.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch (e) {
    return '';
  }
}

async function localTexFetchAsset(config, key, index, total) {
  const spec = config.files[key];
  if (!spec) throw new Error(`TeX 资源条目缺失：${key}`);
  const cacheKey = LOCAL_TEX_CACHE_PREFIX + spec.sha256;
  let cached = null;
  try { cached = await idbGet('kv', cacheKey); } catch (e) { cached = null; }
  if (cached) {
    if (localTexAssetProgress) localTexAssetProgress(index + 1, total, spec.file, true);
    return cached;
  }
  if (localTexAssetProgress) localTexAssetProgress(index, total, spec.file, false);
  let lastError = null;
  for (const base of config.bases) {
    const url = String(base).replace(/\/?$/, '/') + spec.file;
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), 120000) : null;
    try {
      const response = await fetch(url, { mode: 'cors', signal: controller ? controller.signal : undefined });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (spec.size && bytes.length !== spec.size) throw new Error(`文件大小不符（${bytes.length}/${spec.size}）`);
      const digest = await localTexSha256(bytes);
      if (spec.sha256 && digest && digest !== spec.sha256) throw new Error('SHA-256 校验失败');
      const b64 = localTexBytesToBase64(bytes);
      try { await idbPut('kv', cacheKey, b64); } catch (e) { /* cache is best effort */ }
      if (localTexAssetProgress) localTexAssetProgress(index + 1, total, spec.file, false);
      return b64;
    } catch (e) {
      lastError = e;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  throw new Error(`无法下载 TeX 资源 ${spec.file}：${(lastError && lastError.message) || '网络错误'}`);
}

function localTexAssetKeys(kind) {
  // Only the engine that will actually run is downloaded; the shared texmf
  // archive is reused by both pdfTeX and XeTeX. dvipdfm has no format.
  if (kind === 'xetex') return ['wasm:xetex', 'format:xetex', 'texmf'];
  if (kind === 'dvipdfm') return ['wasm:dvipdfm', 'texmf'];
  return ['wasm:pdftex', 'format:pdftex', 'texmf'];
}

async function localTexAssets(kind = 'pdftex') {
  const config = localTexConfig();
  if (config.wasm) { // older builds embedded the payload in the HTML
    localTexAssetCache = config;
    return config;
  }
  const cache = localTexAssetCache || (localTexAssetCache = {
    engine: config.engine || {},
    wasm: {},
    format: {},
    texmf: null
  });
  const has = (key) => {
    if (key === 'texmf') return !!cache.texmf;
    if (key.startsWith('wasm:')) return !!cache.wasm[key.slice(5)];
    if (key.startsWith('format:')) return !!cache.format[key.slice(7)];
    return false;
  };
  const wanted = localTexAssetKeys(kind);
  if (wanted.every(has)) return cache;

  if (!localTexAssetPromises.has(kind)) {
    const task = (async () => {
      const missing = wanted.filter((key) => !has(key));
      const total = missing.length;
      let done = 0;
      await Promise.all(missing.map(async (key) => {
        const index = done++;
        const value = await localTexFetchAsset(config, key, index, total);
        if (key === 'texmf') cache.texmf = value;
        else if (key.startsWith('wasm:')) cache.wasm[key.slice(5)] = value;
        else if (key.startsWith('format:')) cache.format[key.slice(7)] = value;
      }));
      if (!cache.wasm[kind] || !cache.texmf) throw new Error('TeX 资源不完整');
      if (kind !== 'dvipdfm' && !cache.format[kind]) throw new Error('TeX 资源不完整');
      return cache;
    })();
    task.catch(() => { localTexAssetPromises.delete(kind); });
    localTexAssetPromises.set(kind, task);
  }
  return localTexAssetPromises.get(kind);
}

async function localTexAssetsCached(kind = 'pdftex') {
  const config = localTexConfig();
  if (config.wasm) return true;
  for (const key of localTexAssetKeys(kind)) {
    const spec = config.files[key];
    if (!spec) return false;
    let value = null;
    try { value = await idbGet('kv', LOCAL_TEX_CACHE_PREFIX + spec.sha256); } catch (e) { value = null; }
    if (!value) return false;
  }
  return true;
}

function localTexFflateSource() {
  const el = document.getElementById('qelemchi-fflate');
  if (!el) throw new Error('解压组件不可用');
  return el.textContent || '';
}

function localTexDetectEngine() {
  const chosen = state.settings.localEngine || 'auto';
  if (chosen === 'pdflatex' || chosen === 'xelatex') return chosen;
  const texts = Array.from(state.files.values())
    .filter((f) => f.text != null && /\.(tex|sty|cls|fd)$/i.test(f.path))
    .map((f) => f.text)
    .join('\n');
  if (/\\(?:documentclass|usepackage)(?:\[[^\]]*\])?\s*\{[^}]*(?:ctex|xeCJK|fontspec|unicode-math|polyglossia)/i.test(texts)) return 'xelatex';
  if (/\\(?:setCJKmainfont|setCJKsansfont|setCJKmonofont|setmainfont|setsansfont|setmonofont|newfontfamily)\b/.test(texts)) return 'xelatex';
  if (/\\usepackage(?:\[[^\]]*\])?\s*\{ctex\b/.test(texts)) return 'xelatex';
  return 'pdflatex';
}

function localTexPassCount(files) {
  const all = Object.keys(files)
    .filter((p) => /\.(tex|bib)$/i.test(p))
    .map((p) => (typeof files[p] === 'string' ? files[p] : ''))
    .join('\n');
  const cites = /\\cite[a-zA-Z]*\s*(?:\[[^\]]*\])?\s*\{/.test(all);
  const bib = /\\(?:bibliography|addbibresource)\s*(?:\[[^\]]*\])?\s*\{/.test(all) || /\\printbibliography\b/.test(all);
  return cites || bib ? 3 : 2;
}

function localTexSignature(files, engine) {
  let h = 2166136261;
  const feed = (text) => {
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
  };
  feed(engine);
  const paths = Object.keys(files).sort();
  for (const p of paths) {
    feed(p);
    const v = files[p];
    if (typeof v === 'string') {
      feed(`:${v.length}:`);
      feed(v);
    } else {
      feed(`:b:${v.base64 ? v.base64.length : 0}:`);
      feed(v.base64 || '');
    }
  }
  return `${(h >>> 0).toString(36)}-${paths.length}`;
}

function localTexEntryFor() {
  // SwiftLaTeX always runs BibTeX against main.aux, and its formats expect a
  // root-level job. A generated main.tex wraps any other main file.
  return 'main.tex';
}

function localTexProjectSnapshot() {
  const files = {};
  for (const file of state.files.values()) {
    if (file.text != null) files[file.path] = file.text;
    else if (file.base64) files[file.path] = { base64: file.base64 };
  }
  const mainPath = state.mainPath;
  if (mainPath && mainPath !== 'main.tex') {
    files['main.tex'] = `\\input{${mainPath}}\n`;
  }
  return files;
}

function localTexDirsOf(files) {
  const dirs = new Set();
  for (const p of Object.keys(files)) {
    const parts = p.split('/');
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
  }
  return Array.from(dirs).sort();
}

function localTexNextPaint() {
  return new Promise((resolve) => setTimeout(resolve, 24));
}

async function localTexCreateEngine(kind) {
  await localTexNextPaint();
  const assets = await localTexAssets(kind);
  if (!assets.engine || !assets.engine[kind]) throw new Error(`缺少 ${kind} 引擎代码`);
  const engineJs = atob(assets.engine[kind]);
  const patched = engineJs
    .replace(/function kpse_find_file_impl\(/, 'function __qelemchiOriginalKpse(')
    .replace('var Module={};', 'var Module={wasmBinary:self.__QELEMCHI_WASM};');
  const bundle = {
    wasm: assets.wasm[kind],
    format: kind === 'dvipdfm' ? '' : assets.format[kind],
    texmf: assets.texmf
  };
  const source = 'self.__QELEMCHI_KIND=' + JSON.stringify(kind) + ';' +
    'self.__QELEMCHI_FMT_NAME=' + JSON.stringify(LOCAL_TEX_FMT_NAMES[kind]) + ';' +
    'self.__QELEMCHI_ASSETS=' + JSON.stringify(bundle) + ';\n' +
    localTexFflateSource() + '\n' + LOCAL_TEX_PRELUDE + '\n' + patched;
  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  let worker;
  try {
    worker = new Worker(url);
  } finally {
    URL.revokeObjectURL(url);
  }
  const entry = { kind, worker, pending: null, busy: false, startedAt: 0 };
  await new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { worker.terminate(); } catch (e) { /* ignore */ }
      reject(new Error('TeX 引擎启动超时'));
    }, 120000);
    worker.onmessage = (ev) => {
      const d = ev.data || {};
      if (settled) return;
      if (d.result === 'ok') {
        settled = true;
        clearTimeout(timer);
        resolve();
      } else if (d.result === 'failed') {
        settled = true;
        clearTimeout(timer);
        try { worker.terminate(); } catch (e) { /* ignore */ }
        reject(new Error(`TeX 引擎启动失败${d.log ? `：${localTexFirstLine(d.log)}` : ''}`));
      }
    };
    worker.onerror = (ev) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { worker.terminate(); } catch (e) { /* ignore */ }
      reject(new Error(ev.message || 'TeX 引擎无法启动'));
    };
  });
  worker.onerror = () => {
    if (entry.pending) {
      const done = entry.pending;
      entry.pending = null;
      entry.busy = false;
      done({ result: 'failed', status: -1, log: '', error: '编译进程异常退出' });
    }
    localTexDropEngine(kind);
  };
  worker.onmessage = (ev) => {
    const d = ev.data || {};
    if (d.cmd === 'compile' && entry.pending) {
      const done = entry.pending;
      entry.pending = null;
      entry.busy = false;
      done(d);
    }
  };
  return entry;
}

function localTexDropEngine(kind) {
  const entry = localTexEngines.get(kind);
  if (!entry) return;
  localTexEngines.delete(kind);
  try { entry.worker.terminate(); } catch (e) { /* ignore */ }
}

function localTexDisposeEngines() {
  for (const kind of Array.from(localTexEngines.keys())) localTexDropEngine(kind);
}

function localTexScheduleIdle() {
  if (localTexIdleTimer) clearTimeout(localTexIdleTimer);
  localTexIdleTimer = setTimeout(() => {
    if (state.localTex.busy) { localTexScheduleIdle(); return; }
    localTexDisposeEngines();
  }, 120000);
}

async function localTexGetEngine(kind) {
  let entry = localTexEngines.get(kind);
  if (entry) return entry;
  entry = await localTexCreateEngine(kind);
  localTexEngines.set(kind, entry);
  return entry;
}

function localTexPost(entry, message, transfer) {
  entry.worker.postMessage(message, transfer || []);
}

function localTexFlush(entry) {
  localTexPost(entry, { cmd: 'flushcache' });
}

function localTexWriteProject(entry, files) {
  for (const dir of localTexDirsOf(files)) localTexPost(entry, { cmd: 'mkdir', url: dir });
  for (const [path, value] of Object.entries(files)) {
    const src = typeof value === 'string' ? value : base64ToBytes(value.base64);
    localTexPost(entry, { cmd: 'writefile', url: path, src });
  }
}

function localTexCompileCommand(entry, cmd) {
  return new Promise((resolve) => {
    if (entry.pending) {
      resolve({ result: 'failed', status: -1, log: '', error: '引擎正忙' });
      return;
    }
    entry.busy = true;
    entry.startedAt = performance.now();
    let timer = null;
    const finish = (message) => {
      if (timer) clearTimeout(timer);
      resolve(message);
    };
    timer = setTimeout(() => {
      if (entry.pending !== finish) return;
      entry.pending = null;
      entry.busy = false;
      localTexDropEngine(entry.kind);
      finish({ result: 'failed', status: -1, log: '', error: '编译超时，请重试或改用 GitHub Actions' });
    }, 180000);
    entry.pending = finish;
    localTexPost(entry, { cmd });
  });
}

function localTexFirstLine(log) {
  const line = String(log || '').split('\n').find((l) => l.startsWith('!') || /error/i.test(l));
  return (line || String(log || '').split('\n')[0] || '').trim();
}

function localTexParseLog(log) {
  const warnings = [];
  const lines = String(log || '').split('\n');
  let firstError = '';
  for (let i = 0; i < lines.length && i < 4000; i++) {
    const line = lines[i];
    if (!firstError && (line.startsWith('!') || /^! LaTeX Error/.test(line))) {
      const context = lines[i + 1] && /^l\.\d+/.test(lines[i + 1]) ? `（${lines[i + 1].trim()}）` : '';
      firstError = `${line.trim()}${context}`;
    }
    if (/^(?:LaTeX|Package|Class) .*Warning:/.test(line)) {
      const message = line.replace(/^(?:LaTeX|Package|Class) /, '').trim();
      if (!warnings.some((w) => w.message === message)) warnings.push({ level: 'warn', message, count: 1 });
    }
  }
  if (firstError) warnings.unshift({ level: 'error', message: firstError, count: 1 });
  return { firstError, warnings: warnings.slice(0, 8) };
}

function localTexSetPhase(phase, label, pct) {
  state.localTex.phase = phase;
  state.localTex.progress = pct;
  const statusText = document.getElementById('pdf-status-text');
  if (statusText) statusText.textContent = label;
  const stateLabel = document.getElementById('preview-state');
  if (stateLabel && phase !== 'done' && phase !== 'error') stateLabel.textContent = label;
  const bar = document.getElementById('local-compile-bar');
  if (bar) bar.style.width = `${clamp(pct, 4, 100)}%`;
  const title = document.getElementById('local-compile-title');
  if (title && label) title.textContent = label;
  localTexSyncSteps(phase);
}

function localTexShowStatus(show) {
  const status = document.getElementById('pdf-status');
  if (status) status.hidden = !show;
}

function localTexShowPreviewError(result) {
  const box = document.getElementById('preview-error');
  if (!box) return;
  box.hidden = false;
  box.innerHTML = '';
  const text = document.createElement('div');
  text.textContent = result.error || 'PDF 编译失败';
  box.appendChild(text);
  if (result.log) {
    const actions = document.createElement('div');
    actions.className = 'preview-error-actions';
    const logBtn = document.createElement('button');
    logBtn.type = 'button';
    logBtn.className = 'btn btn-soft';
    logBtn.textContent = '查看编译日志';
    logBtn.addEventListener('click', () => localTexOpenLog(result.log, result.title));
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'btn btn-primary';
    retry.textContent = '重试';
    retry.addEventListener('click', () => runLocalCompile({ force: true, reason: 'retry' }));
    actions.appendChild(logBtn);
    actions.appendChild(retry);
    box.appendChild(actions);
  }
}

function localTexClearPreviewError() {
  const box = document.getElementById('preview-error');
  if (box) { box.hidden = true; box.innerHTML = ''; }
}

function localTexOpenLog(log, title) {
  if (!log) return;
  const modal = openModal({
    title: title || 'TeX 编译日志',
    eyebrow: '浏览器内编译',
    subtitle: '来自内置 TeX Live 引擎的完整标准输出。',
    size: 'modal-lg',
    body: '<pre class="compile-log local-tex-log"></pre>',
    actions: [{ label: '关闭', kind: 'ghost' }]
  });
  if (!modal) return;
  const pre = modal.body.querySelector('.local-tex-log');
  if (pre) pre.textContent = log;
}

function localTexUpdateIssues(result) {
  state.localTex.warnings = result.warnings || [];
  if (state.previewView === 'pdf') {
    renderPreviewWarnings(state.localTex.warnings);
  }
}

function localTexDeliver(msg, meta) {
  const bytes = new Uint8Array(msg.pdf);
  if (!bytes.length) throw new Error('引擎返回了空的 PDF');
  const blob = new Blob([bytes], { type: 'application/pdf' });
  state.localTex.stale = false;
  state.localTex.compiledAt = Date.now();
  state.localTex.ms = meta.ms;
  state.localTex.engine = meta.engine;
  state.localTex.log = meta.log;
  state.localTex.error = '';
  state.localTex.signature = meta.signature;
  state.pdfSource = 'local';
  setPdfBlob(blob, {
    label: `${engineLabel(meta.engine)} · ${formatBytes(blob.size)} · ${meta.ms < 1000 ? `${Math.round(meta.ms)} ms` : `${(meta.ms / 1000).toFixed(1)} s`}`,
    source: 'local',
    engine: meta.engine
  });
}

async function runLocalCompile(options = {}) {
  const opts = Object.assign({ force: false, manual: false, reason: 'auto' }, options);
  if (!localTexEnabled()) {
    if (opts.manual) toast({ type: 'info', title: '浏览器编译不可用', desc: '这个构建没有内置 TeX 引擎，请使用 GitHub Actions。' });
    return { ok: false, error: '内置 TeX 引擎不可用' };
  }
  if (state.localTex.busy) {
    state.localTex.queued = true;
    return null;
  }
  const main = state.files.get(state.mainPath);
  if (!main || main.text == null) {
    const result = { ok: false, error: '主文件不存在或不是文本文件' };
    state.localTex.error = result.error;
    if (opts.manual) toast({ type: 'error', title: '无法编译', desc: result.error });
    return result;
  }

  const token = ++localTexCompileToken;
  const engine = localTexDetectEngine();
  const files = localTexProjectSnapshot();
  const signature = localTexSignature(files, engine);
  if (!opts.force && signature === state.localTex.signature && state.pdfBlob && state.pdfSource === 'local') {
    return { ok: true, cached: true };
  }

  state.localTex.busy = true;
  state.localTex.autoArmed = true;
  state.localTex.error = '';
  state.localTex.engine = engine;
  state.localTex.signature = signature;
  state.localTex.startedAt = Date.now();
  state.pdfSource = state.pdfSource === 'local' ? 'local' : state.pdfSource;
  localTexShowStatus(true);
  localTexClearPreviewError();
  if (typeof hidePreviewEmpty === 'function') hidePreviewEmpty();
  localTexSetPhase('preparing', '正在准备浏览器内 TeX 引擎…', 4);
  localTexAssetProgress = (done, total, file, cached) => {
    const pct = 6 + Math.round((done / Math.max(1, total)) * 14);
    const label = cached
      ? `正在读取本地缓存的 TeX 资源（${done}/${total}）…`
      : `正在下载 TeX 资源 ${done}/${total} · ${file}…`;
    localTexSetPhase('preparing', label, pct);
  };
  showPdfStage();

  const started = performance.now();
  const passes = localTexPassCount(files);
  const entryName = localTexEntryFor(state.mainPath);
  const elapsed = document.getElementById('local-compile-elapsed');
  if (localTexElapsedTimer) clearInterval(localTexElapsedTimer);
  localTexElapsedTimer = setInterval(() => {
    if (elapsed) elapsed.textContent = `${Math.round((Date.now() - state.localTex.startedAt) / 1000)} s`;
  }, 500);

  let log = '';
  try {
    if (engine === 'xelatex') {
      localTexSetPhase('preparing', '正在启动 XeLaTeX 引擎…', 24);
      const xe = await localTexGetEngine('xetex');
      if (token !== localTexCompileToken) return null;
      localTexFlush(xe);
      localTexWriteProject(xe, files);
      localTexPost(xe, { cmd: 'setmainfile', url: entryName });
      localTexSetPhase('compiling', `XeLaTeX 正在编译（${passes} 遍）…`, 24);
      let xeResult = null;
      for (let pass = 0; pass < passes; pass++) {
        xeResult = await localTexCompileCommand(xe, 'compilelatex');
        if (token !== localTexCompileToken) return null;
        log = xeResult.log || log;
        if (xeResult.result !== 'ok') {
          throw Object.assign(new Error(localTexFirstLine(log) || 'XeLaTeX 编译失败'), { log });
        }
        localTexSetPhase('compiling', `XeLaTeX 第 ${pass + 1}/${passes} 遍完成…`, 24 + Math.round(((pass + 1) / passes) * 34));
      }
      localTexSetPhase('converting', '正在把 XDV 转换为 PDF…', 66);
      const dx = await localTexGetEngine('dvipdfm');
      if (token !== localTexCompileToken) return null;
      localTexFlush(dx);
      localTexWriteProject(dx, files);
      localTexPost(dx, { cmd: 'writefile', url: 'main.xdv', src: new Uint8Array(xeResult.pdf) });
      localTexPost(dx, { cmd: 'setmainfile', url: 'main.xdv' });
      const pdfResult = await localTexCompileCommand(dx, 'compilepdf');
      if (token !== localTexCompileToken) return null;
      log = `${log}\n${pdfResult.log || ''}`;
      if (pdfResult.result !== 'ok') {
        throw Object.assign(new Error(localTexFirstLine(pdfResult.log) || 'PDF 转换失败'), { log });
      }
      localTexDeliver(pdfResult, {
        engine, log, signature,
        ms: performance.now() - started
      });
    } else {
      localTexSetPhase('preparing', '正在启动 pdfLaTeX 引擎…', 24);
      const tex = await localTexGetEngine('pdftex');
      if (token !== localTexCompileToken) return null;
      localTexFlush(tex);
      localTexWriteProject(tex, files);
      localTexPost(tex, { cmd: 'setmainfile', url: entryName });
      localTexSetPhase('compiling', `pdfLaTeX 正在编译（${passes} 遍）…`, 26);
      let result = null;
      for (let pass = 0; pass < passes; pass++) {
        result = await localTexCompileCommand(tex, 'compilelatex');
        if (token !== localTexCompileToken) return null;
        log = result.log || log;
        if (result.result !== 'ok') {
          throw Object.assign(new Error(localTexFirstLine(log) || 'pdfLaTeX 编译失败'), { log });
        }
        localTexSetPhase('compiling', `pdfLaTeX 第 ${pass + 1}/${passes} 遍完成…`, 26 + Math.round(((pass + 1) / passes) * 56));
      }
      localTexDeliver(result, {
        engine, log, signature,
        ms: performance.now() - started
      });
    }

    const parsed = localTexParseLog(log);
    state.localTex.error = '';
    localTexUpdateIssues({ warnings: parsed.warnings.filter((w) => w.level !== 'error') });
    localTexSetPhase('done', 'PDF 已在浏览器中生成', 100);
    localTexShowStatus(false);
    if (document.getElementById('local-compile-log')) {
      const logBox = document.getElementById('local-compile-log');
      if (logBox) { logBox.hidden = false; logBox.textContent = log; logBox.scrollTop = logBox.scrollHeight; }
      const subtitle = document.getElementById('local-compile-sub');
      if (subtitle) subtitle.textContent = `${engineLabel(engine)} · ${passes} 遍 · ${formatBytes(state.pdfBlob ? state.pdfBlob.size : 0)}`;
      const icon = document.getElementById('local-compile-icon');
      if (icon) { icon.classList.remove('error'); icon.classList.add('success'); icon.innerHTML = iconSvg('check'); }
      const again = document.getElementById('local-compile-again');
      if (again) again.hidden = false;
      const errBox = document.getElementById('local-compile-error');
      if (errBox) { errBox.hidden = true; errBox.textContent = ''; }
    }
    const result = { ok: true, engine, log, ms: performance.now() - started };
    state.localTex.result = result;
    return result;
  } catch (e) {
    const parsed = localTexParseLog(log || e.log || '');
    const message = e.message || parsed.firstError || 'PDF 编译失败';
    state.localTex.error = message;
    state.localTex.log = log || e.log || '';
    localTexShowStatus(false);
    localTexSetPhase('error', 'PDF 编译失败', 100);
    localTexUpdateIssues({ warnings: parsed.warnings });
    if (state.previewView === 'pdf' && state.pdfUrl) {
      showPdfStage();
      localTexShowPreviewError({ error: message, log: log || e.log, title: `${engineLabel(engine)} 编译失败` });
    } else if (!document.getElementById('local-compile-log')) {
      showPreviewError(`PDF 编译失败：${message}`);
    }
    const errBox = document.getElementById('local-compile-error');
    if (errBox) {
      errBox.hidden = false;
      errBox.textContent = `${message}\n\n${localTexLastLines(log || e.log || '', 24)}`;
    }
    const icon = document.getElementById('local-compile-icon');
    if (icon) { icon.classList.remove('success'); icon.classList.add('error'); icon.innerHTML = iconSvg('warning'); }
    const title = document.getElementById('local-compile-title');
    if (title) title.textContent = 'PDF 编译失败';
    const again = document.getElementById('local-compile-again');
    if (again) again.hidden = false;
    return { ok: false, error: message, log: log || e.log || '' };
  } finally {
    localTexAssetProgress = null;
    if (token === localTexCompileToken) {
      state.localTex.busy = false;
      if (localTexElapsedTimer) { clearInterval(localTexElapsedTimer); localTexElapsedTimer = null; }
      localTexScheduleIdle();
      if (state.localTex.queued) {
        state.localTex.queued = false;
        if (state.previewView === 'pdf' || state.localTex.modalOpen) {
          setTimeout(() => runLocalCompile({ reason: 'queued' }), 60);
        }
      }
    }
  }
}

function localTexLastLines(log, count) {
  const lines = String(log || '').trim().split('\n');
  return lines.slice(-count).join('\n');
}

function localTexNoteSourceChanged() {
  if (!localTexEnabled()) return;
  if (!state.localTex.stale) state.localTex.stale = true;
  const main = state.files.get(state.mainPath);
  if (main && main.text != null && !state.localTex.busy) scheduleLocalCompile();
}

function scheduleLocalCompile(delay) {
  if (!localTexEnabled() || !state.localTex.autoArmed) return;
  const main = state.files.get(state.mainPath);
  if (!main || main.text == null) return;
  if (localTexScheduleTimer) clearTimeout(localTexScheduleTimer);
  const wait = delay != null ? delay : (state.settings.localCompileDelay || 2200);
  localTexScheduleTimer = setTimeout(() => {
    localTexScheduleTimer = null;
    if (state.localTex.stale && !state.localTex.busy) runLocalCompile({ reason: 'edit' });
  }, Math.max(400, wait));
}

function localTexCompileModalBody() {
  return `<div class="compile-summary">
      <span class="compile-icon" id="local-compile-icon">${iconSvg('play')}</span>
      <div class="compile-summary-text"><b id="local-compile-title">准备浏览器内编译</b><small id="local-compile-sub">正在装载内置引擎…</small></div>
      <span class="compile-elapsed" id="local-compile-elapsed"></span>
    </div>
    <div class="compile-progress"><i id="local-compile-bar"></i></div>
    <div class="compile-steps">
      <div class="compile-step active" data-local-step="0"><span class="cs-dot"></span><span class="cs-text">加载 TeX 引擎资源</span><span class="cs-meta">按需下载 · 本机缓存</span></div>
      <div class="compile-step" data-local-step="1"><span class="cs-dot"></span><span class="cs-text">编译 LaTeX 源码</span><span class="cs-meta">多遍 + BibTeX</span></div>
      <div class="compile-step" data-local-step="2"><span class="cs-dot"></span><span class="cs-text">生成 PDF</span><span class="cs-meta">留在本机</span></div>
    </div>
    <div class="compile-log" id="local-compile-log" hidden></div>
    <div class="compile-error-box" id="local-compile-error" hidden></div>
    <div class="compile-actions">
      <button type="button" class="btn btn-soft" id="local-compile-again" hidden>重新编译</button>
      <button type="button" class="btn btn-soft" id="local-compile-log-btn" hidden>查看日志</button>
      <button type="button" class="btn btn-soft" id="local-compile-actions">${state.mode === 'github' ? '改用 GitHub Actions' : '连接 GitHub 用 Actions 编译'}</button>
    </div>
    <div class="modal-note" style="margin-top:14px">首次编译会从 CDN 下载约 15 MB 的 TeX 引擎资源，经 SHA-256 校验后缓存在本机；之后可以离线编译。源码与 PDF 都不会上传，请求只发往公开的静态资源域名。内置模板所需的中文字体随引擎资源提供，生僻字可能缺少字形。</div>`;
}

function openLocalCompile() {
  if (!localTexEnabled()) {
    openDemoCompile();
    return;
  }
  const modal = openModal({
    title: '编译真实 PDF',
    eyebrow: '浏览器内 · 无服务器',
    subtitle: '按需加载 TeX Live 引擎并缓存在本机，直接生成 PDF，类似 Overleaf。',
    size: 'modal-lg',
    body: localTexCompileModalBody(),
    actions: [{ label: '关闭', kind: 'ghost' }],
    onClose: () => { state.localTex.modalOpen = false; }
  });
  if (!modal) return;
  state.localTex.modalOpen = true;
  const again = modal.body.querySelector('#local-compile-again');
  if (again) again.addEventListener('click', () => {
    if (again.disabled) return;
    again.hidden = true;
    runLocalCompile({ force: true, manual: true });
  });
  const logBtn = modal.body.querySelector('#local-compile-log-btn');
  if (logBtn) logBtn.addEventListener('click', () => localTexOpenLog(state.localTex.log, 'TeX 编译日志'));
  const actions = modal.body.querySelector('#local-compile-actions');
  if (actions) actions.addEventListener('click', () => {
    modal.close();
    if (state.mode === 'github') openCompile();
    else connectFromDemo();
  });
  runLocalCompile({ force: true, manual: true, modal: true });
}

function localTexSyncSteps(phase) {
  const steps = document.querySelectorAll('[data-local-step]');
  if (!steps.length) return;
  const map = { preparing: 0, compiling: 1, converting: 2, done: 3, error: -1 };
  const index = map[phase] != null ? map[phase] : 0;
  steps.forEach((el, i) => {
    el.classList.toggle('active', i === index);
    el.classList.toggle('done', i < index || phase === 'done');
    el.classList.toggle('error', phase === 'error' && i === Math.max(0, index));
  });
}
