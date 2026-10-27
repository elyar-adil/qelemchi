/* ==========================================================================
   Qelemchi · dialogs, menus, toasts
   ========================================================================== */

function toast(opts) {
  const options = typeof opts === 'string' ? { title: opts } : (opts || {});
  const root = $('#toast-root');
  if (!root) return null;
  const type = options.type || 'info';
  const iconName = type === 'success' ? 'check' : type === 'error' ? 'warning' : type === 'warn' ? 'warning' : 'info';
  const node = document.createElement('div');
  node.className = `toast ${type}`;
  node.innerHTML = `<span class="toast-icon">${iconSvg(iconName)}</span>` +
    `<div class="toast-body"><div class="toast-title">${escapeHtml(options.title || '')}</div>` +
    (options.desc ? `<div class="toast-desc">${options.descHtml ? options.desc : escapeHtml(options.desc)}</div>` : '') +
    (options.action ? `<button type="button" class="toast-action">${escapeHtml(options.action.label)}</button>` : '') +
    `</div><button type="button" class="toast-close" aria-label="关闭">${iconSvg('x')}</button>`;
  root.appendChild(node);
  let gone = false;
  const remove = () => {
    if (gone) return;
    gone = true;
    node.classList.add('is-out');
    setTimeout(() => node.remove(), 240);
  };
  node.querySelector('.toast-close').addEventListener('click', remove);
  if (options.action) {
    node.querySelector('.toast-action').addEventListener('click', () => {
      remove();
      if (options.action.onClick) options.action.onClick();
    });
  }
  setTimeout(remove, options.duration || (type === 'error' ? 7600 : 5200));
  return node;
}

function openModal(options = {}) {
  const root = $('#modal-root');
  if (!root) return null;
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  const modal = document.createElement('div');
  modal.className = `modal ${options.size || ''}`.trim();
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  if (options.id) modal.id = options.id;
  const head = document.createElement('div');
  head.className = 'modal-head';
  head.innerHTML = `<div class="modal-head-text">${options.eyebrow ? `<div class="modal-section-title" style="margin-bottom:5px">${escapeHtml(options.eyebrow)}</div>` : ''}<h2>${escapeHtml(options.title || '')}</h2>${options.subtitle ? `<p>${escapeHtml(options.subtitle)}</p>` : ''}</div>`;
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'icon-btn xs modal-close';
  closeBtn.setAttribute('aria-label', '关闭');
  closeBtn.innerHTML = iconSvg('x');
  head.appendChild(closeBtn);
  modal.appendChild(head);
  const body = document.createElement('div');
  body.className = `modal-body ${options.bodyClass || ''}`.trim();
  if (typeof options.body === 'string') body.innerHTML = options.body;
  else if (options.body instanceof Node) body.appendChild(options.body);
  modal.appendChild(body);
  let foot = null;
  const footWrap = document.createElement('div');
  footWrap.className = 'modal-foot';
  if (options.footLeft) {
    const left = document.createElement('div');
    left.className = 'foot-left';
    left.innerHTML = options.footLeft;
    footWrap.appendChild(left);
    foot = footWrap;
  }
  if (options.actions && options.actions.length) {
    for (const action of options.actions) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `btn ${action.kind === 'primary' ? 'btn-primary' : action.kind === 'danger' ? 'danger' : 'btn-soft'}`;
      btn.innerHTML = action.html || escapeHtml(action.label || '确定');
      btn.addEventListener('click', async () => {
        if (btn.disabled) return;
        if (action.onClick) {
          const prev = btn.innerHTML;
          try {
            const result = await action.onClick(api, btn);
            if (result !== false) api.close();
          } catch (e) {
            btn.innerHTML = prev;
            toast({ type: 'error', title: '操作失败', desc: e.message || String(e) });
          }
        } else {
          api.close();
        }
      });
      footWrap.appendChild(btn);
    }
    modal.appendChild(footWrap);
    foot = footWrap;
  }
  backdrop.appendChild(modal);
  root.appendChild(backdrop);
  document.body.classList.add('modal-open');
  let closed = false;
  const api = {
    backdrop,
    modal,
    body,
    foot,
    close() {
      if (closed) return;
      closed = true;
      backdrop.style.animation = 'fadeIn .14s reverse';
      modal.style.animation = 'modalIn .14s reverse';
      setTimeout(() => {
        backdrop.remove();
        if (!root.querySelector('.modal-backdrop')) document.body.classList.remove('modal-open');
      }, 140);
      document.removeEventListener('keydown', onKey, true);
      if (options.onClose) options.onClose();
    },
    setBusy(busy, label) {
      const primary = footWrap.querySelector('.btn-primary');
      if (primary) setBusy(primary, busy, label);
    }
  };
  const onKey = (e) => {
    if (e.key === 'Escape' && !options.persistent) {
      e.preventDefault();
      api.close();
    }
  };
  document.addEventListener('keydown', onKey, true);
  closeBtn.addEventListener('click', api.close);
  if (!options.persistent) {
    backdrop.addEventListener('mousedown', (e) => {
      if (e.target === backdrop) api.close();
    });
  }
  if (options.onOpen) options.onOpen(api);
  const focusable = modal.querySelector('input, textarea, button.btn-primary, button');
  if (focusable) setTimeout(() => { if (!modal.contains(document.activeElement)) focusable.focus(); }, 50);
  return api;
}

function confirmDialog(title, message, opts = {}) {
  return new Promise((resolve) => {
    let decided = false;
    const api = openModal({
      title,
      size: 'modal-sm',
      body: `<div class="modal-note ${opts.danger ? 'danger' : ''}">${opts.html ? message : escapeHtml(message)}</div>`,
      persistent: false,
      actions: [
        { label: opts.cancelLabel || '取消', kind: 'ghost', onClick: () => { decided = true; resolve(false); } },
        { label: opts.confirmLabel || '确认', kind: opts.danger ? 'danger' : 'primary', onClick: () => { decided = true; resolve(true); } }
      ],
      onClose: () => { if (!decided) resolve(false); }
    });
    return api;
  });
}

function promptDialog(title, label, defaultValue = '', opts = {}) {
  return new Promise((resolve) => {
    let decided = false;
    const api = openModal({
      title,
      size: 'modal-sm',
      body: `<div class="field"><label for="prompt-input">${escapeHtml(label)}</label><input id="prompt-input" type="text" value="${escapeAttr(defaultValue)}" autocomplete="off" spellcheck="false" placeholder="${escapeAttr(opts.placeholder || '')}"></div>${opts.hint ? `<div class="field-hint" style="margin-top:7px">${escapeHtml(opts.hint)}</div>` : ''}`,
      persistent: false,
      actions: [
        { label: '取消', kind: 'ghost', onClick: () => { decided = true; resolve(null); } },
        { label: opts.confirmLabel || '确定', kind: 'primary', onClick: (modalApi) => {
          const value = modalApi.body.querySelector('#prompt-input').value.trim();
          decided = true;
          resolve(value);
        } }
      ],
      onClose: () => { if (!decided) resolve(null); }
    });
    const input = api.body.querySelector('#prompt-input');
    setTimeout(() => {
      input.focus();
      input.select();
    }, 60);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        decided = true;
        resolve(input.value.trim());
        api.close();
      }
    });
  });
}

let menuCloseHandler = null;

function closeMenu() {
  const root = $('#menu-root');
  if (!root) return;
  root.hidden = true;
  root.innerHTML = '';
  if (menuCloseHandler) {
    document.removeEventListener('mousedown', menuCloseHandler, true);
    window.removeEventListener('resize', menuCloseHandler);
    window.removeEventListener('scroll', menuCloseHandler, true);
    menuCloseHandler = null;
  }
}

function showMenu(anchor, items, opts = {}) {
  const root = $('#menu-root');
  if (!root) return;
  closeMenu();
  root.innerHTML = '';
  for (const item of items || []) {
    if (!item) continue;
    if (item.sep) {
      const sep = document.createElement('div');
      sep.className = 'menu-sep';
      root.appendChild(sep);
      continue;
    }
    if (item.labelGroup) {
      const label = document.createElement('div');
      label.className = 'menu-label';
      label.textContent = item.labelGroup;
      root.appendChild(label);
      continue;
    }
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `menu-item${item.danger ? ' danger' : ''}`;
    btn.innerHTML = `${item.icon ? iconSvg(item.icon) : ''}<span>${escapeHtml(item.label)}</span>${item.kbd ? `<span class="mi-kbd">${escapeHtml(item.kbd)}</span>` : ''}`;
    if (item.disabled) btn.disabled = true;
    btn.addEventListener('click', () => {
      closeMenu();
      if (item.onClick) item.onClick();
    });
    root.appendChild(btn);
  }
  root.hidden = false;
  const rect = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { left: 20, bottom: 42, top: 24, right: 44 };
  const width = root.offsetWidth;
  const height = root.offsetHeight;
  let left = opts.align === 'left' ? rect.left : rect.right - width;
  let top = rect.bottom + 5;
  if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8;
  if (left < 8) left = 8;
  if (top + height > window.innerHeight - 8) top = Math.max(8, rect.top - height - 5);
  root.style.left = `${left}px`;
  root.style.top = `${top}px`;
  menuCloseHandler = (e) => {
    if (e.type === 'mousedown' && (root.contains(e.target) || (anchor && anchor.contains(e.target)))) return;
    closeMenu();
  };
  setTimeout(() => {
    document.addEventListener('mousedown', menuCloseHandler, true);
    window.addEventListener('resize', menuCloseHandler);
    window.addEventListener('scroll', menuCloseHandler, true);
  }, 0);
}

function renderSaveState() {
  const save = $('#save-state');
  const dot = $('#save-dot');
  const btn = $('#btn-save');
  if (!save) return;
  const dirty = hasChanges();
  save.classList.toggle('dirty', dirty);
  save.classList.toggle('saved', !dirty);
  const label = save.querySelector('span');
  if (label) {
    if (state.save.busy) label.textContent = '正在提交…';
    else if (dirty) label.textContent = state.mode === 'demo' ? '有未保存修改' : '有未提交修改';
    else label.textContent = state.mode === 'demo' ? '本机草稿已保存' : '已与仓库同步';
  }
  if (dot) dot.className = `save-dot ${dirty ? 'is-dirty' : 'is-saved'}`;
  if (btn) {
    btn.classList.toggle('dirty', dirty);
    btn.title = state.mode === 'demo' ? '保存本机快照 (⌘S)' : '提交到 GitHub (⌘S)';
    const span = btn.querySelector('span:not(.save-dot)');
    if (span) span.textContent = state.mode === 'demo' ? '保存' : '提交';
  }
  const status = $('#status-dirty');
  if (status) {
    if (state.save.busy) status.textContent = '正在写入 GitHub…';
    else if (dirty) status.textContent = state.mode === 'demo' ? '修改仅保存在本机' : `${state.dirty.size + state.deleted.size} 个文件待提交`;
    else status.textContent = state.mode === 'demo' ? '所有修改已保存在本机' : '工作区与远程仓库一致';
  }
}

function setConnectionBanner(text, retry = true) {
  const banner = $('#offline-banner');
  if (!banner) return;
  banner.hidden = !text;
  const t = $('#offline-text');
  if (t) t.textContent = text;
  const retryBtn = $('#offline-retry');
  if (retryBtn) retryBtn.hidden = !retry;
}

function showDemoBanner(show) {
  const banner = $('#demo-banner');
  if (banner) banner.hidden = !show;
}
