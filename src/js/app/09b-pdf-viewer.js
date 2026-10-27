/* ==========================================================================
   Qelemchi · in-page PDF viewer
   --------------------------------------------------------------------------
   Renders compiled PDFs with PDF.js instead of the browser's built-in viewer.
   The native viewer inside this app can lay the page out against the wrong
   viewport; canvas rendering is deterministic, keeps the app's zoom controls
   meaningful, and works the same in every browser.
   ========================================================================== */

let pdfViewerDoc = null;
let pdfViewerToken = 0;
let pdfViewerMode = 'none'; // 'canvas' | 'frame' | 'none'
let pdfViewerRenderedZoom = 0;
let pdfViewerBaseWidth = 0;
let pdfViewerLayoutTimer = null;
let pdfViewerReady = false;
let pdfViewerCMaps = null;
let pdfViewerPendingBlob = null;
let pdfViewerScrollRatio = null;

function pdfViewerSupported() {
  return !!(window.pdfjsLib && document.getElementById('pdf-canvas') &&
    document.getElementById('qelemchi-pdfjs-worker'));
}

function pdfViewerActive() {
  return pdfViewerMode === 'canvas';
}

function pdfViewerBase() {
  return pdfViewerBaseWidth || 0;
}

function pdfCMapBytes(name) {
  if (!pdfViewerCMaps) {
    pdfViewerCMaps = {};
    const node = document.getElementById('qelemchi-pdfjs-cmaps');
    let table = {};
    try { table = node ? JSON.parse(node.textContent || '{}') : {}; } catch (e) { table = {}; }
    for (const [key, b64] of Object.entries(table)) {
      try {
        const raw = atob(b64);
        const bytes = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
        pdfViewerCMaps[key] = bytes;
      } catch (e) { /* skip a damaged entry */ }
    }
  }
  return pdfViewerCMaps[name] || null;
}

class QelemchiCMapReader {
  async fetch({ name }) {
    const data = pdfCMapBytes(name);
    if (!data) throw new Error(`缺少 CMap ${name}`);
    return { cMapData: data, compressionType: 1 };
  }
}

function pdfViewerInit() {
  if (pdfViewerReady) return true;
  if (!pdfViewerSupported()) return false;
  try {
    const node = document.getElementById('qelemchi-pdfjs-worker');
    const url = URL.createObjectURL(new Blob([node.textContent], { type: 'text/javascript' }));
    pdfjsLib.GlobalWorkerOptions.workerSrc = url;
  } catch (e) {
    // PDF.js can still parse on the main thread when it has no worker URL.
  }
  pdfViewerReady = true;
  return true;
}

function pdfViewerSetStatus(show, text, detail) {
  const box = document.getElementById('pdf-status');
  if (!box) return;
  box.hidden = !show;
  if (!show) return;
  const label = document.getElementById('pdf-status-text');
  const sub = document.getElementById('pdf-status-detail');
  if (label) label.textContent = text || '正在绘制 PDF…';
  if (sub) sub.textContent = detail || '';
}

function pdfViewerClearCanvas() {
  const host = document.getElementById('pdf-canvas');
  if (host) host.innerHTML = '';
}

function pdfViewerDestroyDoc() {
  if (pdfViewerDoc) {
    try { pdfViewerDoc.destroy(); } catch (e) { /* already gone */ }
    pdfViewerDoc = null;
  }
}

function pdfViewerFitZoom() {
  const stage = document.getElementById('preview-stage');
  if (!stage || !pdfViewerBaseWidth) return state.zoom || 1;
  const padding = stage.clientWidth < 520 ? 20 : 60;
  return clamp((stage.clientWidth - padding) / pdfViewerBaseWidth, 0.35, 1.6);
}

function pdfViewerMeta() {
  if (!pdfViewerDoc) return;
  state.pdfPages = pdfViewerDoc.numPages;
  if (state.previewView === 'pdf') {
    const count = document.getElementById('page-count');
    if (count) count.textContent = `${state.pdfPages} 页`;
    const label = document.getElementById('preview-state');
    if (label && state.pdfLabel) label.textContent = state.pdfLabel;
  }
}

function pdfViewerPublishFrame() {
  const frame = document.getElementById('pdf-frame');
  const stage = document.getElementById('pdf-stage');
  const host = document.getElementById('pdf-canvas');
  if (stage) stage.classList.remove('canvas-mode');
  if (host) host.hidden = true;
  if (frame && state.pdfUrl && frame.getAttribute('src') !== state.pdfUrl) frame.src = state.pdfUrl;
}

function pdfViewerShow() {
  const stage = document.getElementById('pdf-stage');
  const host = document.getElementById('pdf-canvas');
  if (!stage || !host) return;
  const canvasMode = pdfViewerMode === 'canvas';
  stage.classList.toggle('canvas-mode', canvasMode);
  host.hidden = !canvasMode;
  if (!canvasMode) {
    pdfViewerPublishFrame();
    return;
  }
  if (!pdfViewerDoc && pdfViewerPendingBlob) {
    const blob = pdfViewerPendingBlob;
    pdfViewerPendingBlob = null;
    pdfViewerLoad(blob);
  }
}

async function pdfViewerRenderPages(token) {
  const doc = pdfViewerDoc;
  const host = document.getElementById('pdf-canvas');
  if (!doc || !host) return;
  if (token == null) token = pdfViewerToken;

  const previousHeight = host.scrollHeight;
  if (previousHeight) pdfViewerScrollRatio = host.scrollTop / previousHeight;

  const zoom = state.zoom || 1;
  const dprCap = 2;
  pdfViewerRenderedZoom = zoom;
  pdfViewerClearCanvas();
  const total = doc.numPages;

  for (let n = 1; n <= total; n++) {
    if (token !== pdfViewerToken) return;
    pdfViewerSetStatus(true, '正在绘制 PDF…', `第 ${n} / ${total} 页`);
    const page = await doc.getPage(n);
    if (token !== pdfViewerToken) return;
    const base = page.getViewport({ scale: 1 });
    const cssWidth = base.width * zoom;
    const ratio = Math.min(window.devicePixelRatio || 1, dprCap, 1900 / Math.max(cssWidth, 1));
    const viewport = page.getViewport({ scale: zoom * Math.max(ratio, 0.5) });
    const canvas = document.createElement('canvas');
    canvas.className = 'pdf-page-canvas';
    canvas.dataset.page = String(n);
    canvas.dataset.baseWidth = String(base.width);
    canvas.dataset.baseHeight = String(base.height);
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    canvas.style.width = `${cssWidth.toFixed(2)}px`;
    canvas.style.height = `${(base.height * zoom).toFixed(2)}px`;
    host.appendChild(canvas);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  if (token !== pdfViewerToken) return;
  if (pdfViewerScrollRatio != null) {
    const ratio = pdfViewerScrollRatio;
    pdfViewerScrollRatio = null;
    const keep = host.scrollHeight * ratio;
    requestAnimationFrame(() => { host.scrollTop = keep; });
  }
}

function pdfViewerSetZoom(zoom) {
  if (pdfViewerMode !== 'canvas' || !pdfViewerDoc) return;
  const host = document.getElementById('pdf-canvas');
  if (!host) return;
  const value = clamp(Number(zoom) || 1, 0.35, 2.4);
  for (const canvas of host.querySelectorAll('canvas.pdf-page-canvas')) {
    const baseW = Number(canvas.dataset.baseWidth) || 0;
    const baseH = Number(canvas.dataset.baseHeight) || 0;
    if (!baseW) continue;
    canvas.style.width = `${(baseW * value).toFixed(2)}px`;
    canvas.style.height = `${(baseH * value).toFixed(2)}px`;
  }
  if (Math.abs(pdfViewerRenderedZoom - value) < 0.002) return;
  clearTimeout(pdfViewerLayoutTimer);
  pdfViewerLayoutTimer = setTimeout(() => {
    if (pdfViewerMode !== 'canvas' || !pdfViewerDoc) return;
    const token = ++pdfViewerToken;
    pdfViewerRenderPages(token).then(() => {
      if (token !== pdfViewerToken) return;
      pdfViewerSetStatus(false);
      pdfViewerMeta();
    });
  }, 380);
}

function pdfViewerLoad(blob) {
  if (!blob) return;
  if (!pdfViewerInit()) {
    pdfViewerMode = 'frame';
    pdfViewerPublishFrame();
    return;
  }
  const stage = document.getElementById('pdf-stage');
  if (stage && stage.hidden) {
    // The pane is not laid out yet; wait until it is visible so the fit
    // zoom is computed against a real width.
    pdfViewerMode = 'canvas';
    pdfViewerPendingBlob = blob;
    return;
  }
  pdfViewerMode = 'canvas';
  pdfViewerPendingBlob = null;
  const token = ++pdfViewerToken;
  clearTimeout(pdfViewerLayoutTimer);
  pdfViewerDestroyDoc();
  pdfViewerClearCanvas();
  pdfViewerRenderedZoom = 0;
  pdfViewerBaseWidth = 0;
  pdfViewerScrollRatio = null;
  pdfViewerSetStatus(true, '正在绘制 PDF…', '');

  (async () => {
    try {
      const data = new Uint8Array(await blob.arrayBuffer());
      if (token !== pdfViewerToken) return;
      const doc = await pdfjsLib.getDocument({
        data,
        isEvalSupported: false,
        CMapReaderFactory: QelemchiCMapReader,
        verbosity: 1
      }).promise;
      if (token !== pdfViewerToken) { doc.destroy(); return; }
      pdfViewerDoc = doc;
      const first = await doc.getPage(1);
      if (token !== pdfViewerToken) return;
      pdfViewerBaseWidth = first.getViewport({ scale: 1 }).width || 0;
      if (state.zoomMode !== 'manual') {
        state.zoom = pdfViewerFitZoom();
        // Mark the pending zoom as already handled: applyZoom() would
        // otherwise schedule a second render and cancel this one.
        pdfViewerRenderedZoom = state.zoom;
        applyZoom();
      }
      await pdfViewerRenderPages(token);
      if (token !== pdfViewerToken) return;
      pdfViewerSetStatus(false);
      pdfViewerMeta();
    } catch (e) {
      if (token !== pdfViewerToken) return;
      console.warn('PDF.js 渲染失败，改用浏览器内置查看器：', e && e.message ? e.message : e);
      pdfViewerMode = 'frame';
      pdfViewerSetStatus(false);
      pdfViewerClearCanvas();
      pdfViewerPublishFrame();
    }
  })();
}

function pdfViewerClear() {
  pdfViewerToken++;
  clearTimeout(pdfViewerLayoutTimer);
  pdfViewerLayoutTimer = null;
  pdfViewerPendingBlob = null;
  pdfViewerDestroyDoc();
  pdfViewerClearCanvas();
  pdfViewerMode = 'none';
  pdfViewerRenderedZoom = 0;
  pdfViewerBaseWidth = 0;
  pdfViewerScrollRatio = null;
  state.pdfPages = 0;
  state.pdfLabel = '';
  pdfViewerSetStatus(false);
  const stage = document.getElementById('pdf-stage');
  if (stage) stage.classList.remove('canvas-mode');
  const host = document.getElementById('pdf-canvas');
  if (host) host.hidden = true;
}
