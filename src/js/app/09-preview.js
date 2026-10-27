/* ==========================================================================
   Qelemchi · PDF preview pane
   --------------------------------------------------------------------------
   The right-hand pane only ever shows the compiled PDF. LaTeX structure is
   rendered in the editor's WYSIWYG mode instead, so there is no second
   "typeset" preview surface to keep in sync.
   ========================================================================== */

let previewRun = 0;
let pdfObjectUrl = '';

function schedulePreview(delay) {
  if (!state.booted && !state.editorReady) return;
  if (typeof localTexNoteSourceChanged === 'function') localTexNoteSourceChanged();
  if (typeof wysiwygNotifySourceChanged === 'function') wysiwygNotifySourceChanged();
  if (state.previewTimer) clearTimeout(state.previewTimer);
  const wait = delay != null ? delay : (state.settings.previewDelay || 420);
  state.previewTimer = setTimeout(() => {
    state.previewTimer = null;
    renderPreview();
  }, Math.max(0, wait));
}

function previewEmpty(message, hint, actions) {
  const empty = $('#preview-empty');
  if (!empty) return;
  const list = actions || [];
  empty.hidden = false;
  empty.innerHTML = `<div class="preview-empty-icon">${iconSvg(list.length ? 'play' : 'file')}</div>` +
    `<h3>${escapeHtml(message)}</h3>` +
    (hint ? `<p>${escapeHtml(hint)}</p>` : '') +
    (list.length
      ? `<div class="preview-empty-actions">${list.map((a, i) =>
        `<button type="button" class="btn ${i === 0 ? 'btn-primary' : 'btn-soft'}" data-empty-action="${i}">${escapeHtml(a.label)}</button>`).join('')}</div>`
      : '');
  empty.querySelectorAll('[data-empty-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const action = list[Number(btn.dataset.emptyAction)];
      if (action && action.onClick) action.onClick();
    });
  });
}

function hidePreviewEmpty() {
  const empty = $('#preview-empty');
  if (empty) { empty.hidden = true; empty.innerHTML = ''; }
}

function setPreviewMeta(pages, label) {
  const count = $('#page-count');
  if (count) count.textContent = `${state.pdfPages || pages || 0} 页`;
  const stateLabel = $('#preview-state');
  if (stateLabel && state.pdfLabel) stateLabel.textContent = state.pdfLabel;
  else if (stateLabel && label) stateLabel.textContent = label;
}

function showPreviewError(message) {
  const box = $('#preview-error');
  if (box) {
    box.hidden = false;
    box.textContent = message || 'PDF 编译失败';
  }
  hidePreviewEmpty();
}

function clearPreviewMessages() {
  const error = $('#preview-error');
  if (error) { error.hidden = true; error.textContent = ''; }
  hidePreviewEmpty();
}

/* --------------------------------------------------------------------------
   Project model
   The preview pane no longer paginates HTML, but the WYSIWYG editor relies on
   TeXPreview for metadata, labels and math macros. Building it here keeps
   state.preview (title, engine, warnings) current after every edit.
   -------------------------------------------------------------------------- */

async function renderPreview() {
  if (state.previewBusy) {
    schedulePreview(180);
    return;
  }
  const run = ++previewRun;
  state.previewBusy = true;
  try {
    const main = state.files.get(state.mainPath);
    if (!main || main.text == null) {
      state.preview = null;
      state.warnings = [];
      updateProjectTitle();
      renderPreviewWarnings([]);
      previewEmpty('还没有可编译的主文件', '新建一个包含 \\documentclass 的 .tex 文件，然后在 main.tex 中写作。', [
        { label: '选择模板', onClick: () => openTemplateChooser() }
      ]);
      return;
    }
    if (typeof TeXPreview === 'undefined') throw new Error('排版模型没有加载，请重新打开页面。');
    const result = TeXPreview.build({
      files: textFilesForPreview(),
      mainPath: state.mainPath,
      assets: state.assetUrls
    });
    if (run !== previewRun) return;
    state.preview = result;
    state.warnings = result.warnings || [];
    state.previewRenderedAt = Date.now();
    updateProjectTitle();
    renderPreviewWarnings(state.localTex.warnings || []);
    if (!state.pdfUrl && !state.localTex.busy) {
      if (localTexEnabled()) {
        previewEmpty('PDF 尚未编译', state.localTex.autoArmed
          ? '浏览器内置 TeX 引擎会在后台生成 PDF，编辑后会稍等片刻再自动编译。'
          : '首次编译会从 CDN 下载约 15 MB 的 TeX 引擎资源并缓存在本机；之后编辑即可自动编译，也能离线使用。', [
          { label: '立即编译', onClick: () => runLocalCompile({ force: true, manual: true, reason: 'empty' }) },
          { label: '使用 GitHub Actions', onClick: () => openCompile() }
        ]);
      } else {
        previewEmpty('还没有 PDF', state.mode === 'github'
          ? '点击“编译 PDF”，用仓库里的 GitHub Actions 生成 PDF。'
          : '这个构建没有内置 TeX 引擎，请连接 GitHub 仓库后用 Actions 编译。', [
          { label: '编译 PDF', onClick: () => openCompile() }
        ]);
      }
    } else if (state.pdfUrl) {
      hidePreviewEmpty();
    }
  } catch (e) {
    console.error(e);
    showPreviewError(`预览失败：${e.message || String(e)}`);
    setPreviewMeta(0, '预览失败');
  } finally {
    if (run === previewRun) state.previewBusy = false;
  }
}

function engineLabel(id) {
  const map = { xelatex: 'XeLaTeX', pdflatex: 'pdfLaTeX', lualatex: 'LuaLaTeX', latex: 'LaTeX' };
  return map[String(id || '').toLowerCase()] || 'TeX';
}

/* --------------------------------------------------------------------------
   MathJax helpers (also used by the WYSIWYG editor)
   -------------------------------------------------------------------------- */

async function waitForMathJax() {
  if (!window.MathJax) return false;
  try {
    if (MathJax.startup && MathJax.startup.promise) await MathJax.startup.promise;
  } catch (e) { /* MathJax logs its own errors */ }
  return !!(MathJax.typesetPromise || MathJax.typeset);
}

async function typesetBody(body, macros) {
  const ready = await waitForMathJax();
  if (!ready || !body) return;
  const config = Object.assign({}, macros || {});
  // MathJax 3.2's combined bundle does not publish `MathJax.tex`; the live
  // TeX input jax lives on startup.input and carries the macro table.
  const texJax = (MathJax.startup && MathJax.startup.input && MathJax.startup.input[0]) || MathJax.tex;
  if (texJax) texJax.macros = config;
  if (MathJax.config && MathJax.config.tex) MathJax.config.tex.macros = config;
  if (MathJax.texReset) MathJax.texReset();
  try {
    if (MathJax.typesetPromise) await MathJax.typesetPromise([body]);
    else MathJax.typeset([body]);
  } catch (e) {
    console.warn('MathJax typeset failed', e);
  }
}

/* --------------------------------------------------------------------------
   Warnings strip
   -------------------------------------------------------------------------- */

function renderPreviewWarnings(warnings) {
  const strip = $('#issue-strip');
  const pop = $('#issue-popover');
  const label = $('#issue-label');
  const list = warnings || [];
  const total = list.reduce((sum, w) => sum + (w.count || 1), 0);
  if (strip) strip.hidden = !list.length;
  if (label) label.textContent = `${total} 条编译提示`;
  if (pop) {
    pop.hidden = true;
    pop.innerHTML = list.map((w) => {
      const level = w.level || 'warn';
      const levelLabel = level === 'error' ? 'ERROR' : level === 'info' ? 'INFO' : 'WARN';
      return `<div class="issue-item"><span class="issue-level${level === 'error' ? ' error' : level === 'info' ? ' info' : ''}">${levelLabel}</span>` +
        `<span>${escapeHtml(w.message)}${w.count > 1 ? ` <b>×${w.count}</b>` : ''}</span></div>`;
    }).join('');
  }
  const open = strip && strip.classList.contains('open');
  if (pop) pop.hidden = !(open && list.length);
}

function activeIssueWarnings() {
  return state.localTex.warnings || [];
}

function toggleIssuePopover(force) {
  const strip = $('#issue-strip');
  const pop = $('#issue-popover');
  if (!strip || !pop) return;
  const open = force != null ? force : !strip.classList.contains('open');
  strip.classList.toggle('open', open);
  pop.hidden = !open || !activeIssueWarnings().length;
}

/* --------------------------------------------------------------------------
   PDF stage and view
   -------------------------------------------------------------------------- */

function showPdfStage() {
  const stage = $('#pdf-stage');
  if (!stage) return;
  stage.hidden = false;
  if (typeof pdfViewerShow === 'function') pdfViewerShow();
  else {
    const frame = $('#pdf-frame');
    if (frame && state.pdfUrl && frame.getAttribute('src') !== state.pdfUrl) frame.src = state.pdfUrl;
  }
}

function hidePdfStage() {
  const stage = $('#pdf-stage');
  if (stage) stage.hidden = true;
}

function setPreviewView() {
  state.previewView = 'pdf';
  showPdfStage();
  if (typeof localTexShowStatus === 'function') localTexShowStatus(state.localTex.busy);
  if (state.pdfLabel && !state.localTex.busy) {
    const label = $('#preview-state');
    if (label) label.textContent = state.pdfLabel;
  }
  renderPreviewWarnings(state.localTex.warnings || []);
  if (!state.pdfUrl && state.localTex.busy) {
    hidePreviewEmpty();
    if (typeof localTexShowStatus === 'function') localTexShowStatus(true);
  }
}

function setPdfBlob(blob, meta) {
  if (pdfObjectUrl) {
    try { URL.revokeObjectURL(pdfObjectUrl); } catch (e) { /* ignore */ }
  }
  state.pdfBlob = blob;
  if (meta && meta.source) state.pdfSource = meta.source;
  state.pdfLabel = meta && meta.label ? meta.label : 'PDF 已更新';
  pdfObjectUrl = URL.createObjectURL(blob);
  state.pdfUrl = pdfObjectUrl;
  hidePreviewEmpty();
  if (typeof pdfViewerLoad === 'function') pdfViewerLoad(blob);
  else {
    const frame = $('#pdf-frame');
    if (frame) frame.src = pdfObjectUrl;
  }
  const stateLabel = $('#preview-state');
  if (stateLabel) stateLabel.textContent = state.pdfLabel;
  const statusEngine = $('#status-engine');
  if (statusEngine) {
    statusEngine.textContent = meta && meta.engine ? `PDF · ${engineLabel(meta.engine)}` : 'PDF';
  }
  setPreviewView('pdf');
}

function clearPdf() {
  if (pdfObjectUrl) {
    try { URL.revokeObjectURL(pdfObjectUrl); } catch (e) { /* ignore */ }
  }
  pdfObjectUrl = '';
  state.pdfUrl = '';
  state.pdfBlob = null;
  state.pdfSource = 'none';
  if (state.localTex) state.localTex.stale = true;
  state.pdfPages = 0;
  state.pdfLabel = '';
  if (typeof pdfViewerClear === 'function') pdfViewerClear();
  const frame = $('#pdf-frame');
  if (frame) frame.removeAttribute('src');
  if (typeof localTexShowStatus === 'function') localTexShowStatus(false);
}

/* --------------------------------------------------------------------------
   Zoom
   -------------------------------------------------------------------------- */

function applyZoom() {
  if (typeof pdfViewerSetZoom === 'function') pdfViewerSetZoom(state.zoom);
  const label = $('#btn-zoom-reset');
  if (label) label.textContent = `${Math.round(state.zoom * 100)}%`;
}

function setZoom(value, opts = {}) {
  const zoom = clamp(Number(value) || 1, 0.35, 2.4);
  state.zoom = zoom;
  if (opts.manual !== false) state.zoomMode = 'manual';
  applyZoom();
}

function zoomIn() {
  setZoom(state.zoom + 0.1);
}

function zoomOut() {
  setZoom(state.zoom - 0.1);
}

function fitPreviewWidth(quiet) {
  const stage = $('#preview-stage');
  if (typeof pdfViewerActive !== 'function' || !pdfViewerActive() || !pdfViewerBase()) return;
  const base = pdfViewerBase();
  const padding = stage && stage.clientWidth < 520 ? 20 : 60;
  const width = stage ? stage.clientWidth : 0;
  if (!width) return;
  const fit = clamp((width - padding) / base, 0.35, 2.4);
  state.zoomMode = 'fit';
  state.zoom = fit;
  applyZoom();
  if (!quiet) toast({ type: 'success', title: '已适合宽度', desc: `${Math.round(fit * 100)}%` });
}

function refreshPreview() {
  if (localTexEnabled()) {
    runLocalCompile({ force: true, manual: true, reason: 'refresh' });
    return;
  }
  if (state.mode === 'github') {
    openCompile();
    return;
  }
  toast({ type: 'info', title: '无法编译 PDF', desc: '这个构建没有内置 TeX 引擎，请连接 GitHub 仓库后用 Actions 编译。' });
}

function focusEditorLine(file, line) {
  if (!file) return;
  if (state.activePath !== file) openFile(file);
  if (line != null && editor) {
    const lineNo = clamp(Number(line) - 1, 0, editor.lineCount() - 1);
    editor.setCursor({ line: lineNo, ch: 0 });
    editor.scrollIntoView({ line: lineNo, ch: 0 }, 80);
  }
}
