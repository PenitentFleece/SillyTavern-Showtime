// Unified Showtime punch-ticket modals, alerts, confirmations, prompts, menus, and notice helpers.

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function normalizeDialogOptions(message, opts = {}, defaults = {}) {
  const text = String(message ?? '').trim();
  const title = String(opts?.title || defaults.title || 'SHOWTIME').trim();
  const subtitle = String(opts?.subtitle ?? defaults.subtitle ?? '— Stage Desk —').trim();
  const confirmLabel = String(opts?.confirmLabel || opts?.okLabel || defaults.confirmLabel || 'OK').trim();
  const cancelLabel = String(opts?.cancelLabel || defaults.cancelLabel || 'Cancel').trim();
  const defaultValue = String(opts?.defaultValue ?? defaults.defaultValue ?? '');
  const placeholder = String(opts?.placeholder ?? defaults.placeholder ?? '');
  const danger = !!(opts?.danger ?? defaults.danger);
  return {
    message: text,
    title,
    subtitle,
    confirmLabel,
    cancelLabel,
    defaultValue,
    placeholder,
    danger,
  };
}

/**
 * Emit a notification onto the unified Marquee sticker-bubble thread.
 * Falls back to `window.Showtime?.bus` when `bus` is omitted.
 */
export function emitShowtimeNotice(bus, payload = {}) {
  const targetBus = bus || (typeof window !== 'undefined' ? window.Showtime?.bus : null);
  if (!targetBus || typeof targetBus.emit !== 'function') return false;
  const kind = String(payload.kind || 'house').trim() || 'house';
  const items = Array.isArray(payload.items)
    ? payload.items
    : (payload.text || payload.name)
      ? [{
        text: String(payload.text || payload.name || '').trim(),
        name: String(payload.name || '').trim(),
        toState: String(payload.toState || payload.label || '').trim(),
        mark: payload.mark ?? '!',
        characterId: String(payload.characterId || '').trim(),
      }]
      : [];
  if (!items.length) return false;
  targetBus.emit('showtime.notice', { ...payload, kind, items });
  return true;
}

/**
 * Build a Showtime punch-ticket modal backdrop and card.
 * @param {string} innerHtml
 * @param {{ className?: string, modalClass?: string, closeOnBackdrop?: boolean, onClose?: () => void }} [opts]
 * @returns {HTMLElement}
 */
export function buildShowtimeModal(innerHtml, opts = {}) {
  const backdrop = document.createElement('div');
  backdrop.className = ['inv-modal-backdrop', 'st-dialog-backdrop', opts.className || '']
    .filter(Boolean)
    .join(' ');
  const modalCls = ['inv-modal', 'st-dialog', opts.modalClass || '']
    .filter(Boolean)
    .join(' ');
  backdrop.innerHTML = `<div class="${modalCls}" role="dialog" aria-modal="true">${innerHtml}</div>`;
  document.body.appendChild(backdrop);

  let closed = false;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey, true);
    backdrop.remove();
    try { opts.onClose?.(); } catch { /* ignore */ }
  };
  const onKey = (e) => {
    if (e.key === 'Escape') {
      if (!document.body.contains(backdrop)) {
        document.removeEventListener('keydown', onKey, true);
        return;
      }
      e.stopPropagation();
      cleanup();
    }
  };
  document.addEventListener('keydown', onKey, true);
  if (opts.closeOnBackdrop !== false) {
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) cleanup();
    });
  }
  backdrop._stClose = cleanup;
  return backdrop;
}

export const buildModal = buildShowtimeModal;

/**
 * Non-blocking Showtime-formatted alert modal. Returns a Promise that resolves when dismissed.
 * @param {string} message
 * @param {{ title?: string, subtitle?: string, okLabel?: string, danger?: boolean }} [opts]
 * @returns {Promise<void>}
 */
export function showtimeAlert(message, opts = {}) {
  const cfg = normalizeDialogOptions(message, opts, {
    title: 'STAGE NOTICE',
    subtitle: '— Showtime Desk —',
    confirmLabel: 'OK',
  });
  if (typeof document === 'undefined') return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const backdrop = buildShowtimeModal(`
      <div class="inv-modal-title">${esc(cfg.title)}</div>
      ${cfg.subtitle ? `<div class="inv-modal-subtitle">${esc(cfg.subtitle)}</div>` : ''}
      <div class="st-dialog-body">${esc(cfg.message).replace(/\n/g, '<br>')}</div>
      <div class="inv-modal-actions">
        <button type="button" class="inv-btn${cfg.danger ? ' danger' : ''}" data-act="ok">${esc(cfg.confirmLabel)}</button>
      </div>
    `, { onClose: finish });
    const okBtn = backdrop.querySelector('[data-act="ok"]');
    okBtn?.addEventListener('click', () => {
      backdrop._stClose?.();
      finish();
    });
    setTimeout(() => okBtn?.focus?.(), 0);
  });
}

/**
 * Showtime-formatted confirmation modal replacing native `window.confirm()`.
 * @param {string} message
 * @param {{ title?: string, subtitle?: string, confirmLabel?: string, cancelLabel?: string, danger?: boolean }} [opts]
 * @returns {Promise<boolean>}
 */
export function showtimeConfirm(message, opts = {}) {
  const cfg = normalizeDialogOptions(message, opts, {
    title: 'CONFIRM ACTION',
    subtitle: '— Stage Desk —',
    confirmLabel: 'Confirm',
    cancelLabel: 'Cancel',
    danger: false,
  });
  if (typeof document === 'undefined') return Promise.resolve(false);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (val) => {
      if (settled) return;
      settled = true;
      resolve(!!val);
    };
    const backdrop = buildShowtimeModal(`
      <div class="inv-modal-title">${esc(cfg.title)}</div>
      ${cfg.subtitle ? `<div class="inv-modal-subtitle">${esc(cfg.subtitle)}</div>` : ''}
      <div class="st-dialog-body">${esc(cfg.message).replace(/\n/g, '<br>')}</div>
      <div class="inv-modal-actions">
        <button type="button" class="inv-btn" data-act="cancel">${esc(cfg.cancelLabel)}</button>
        <button type="button" class="inv-btn${cfg.danger ? ' danger' : ''}" data-act="confirm">${esc(cfg.confirmLabel)}</button>
      </div>
    `, { onClose: () => finish(false) });
    const cancelBtn = backdrop.querySelector('[data-act="cancel"]');
    const confirmBtn = backdrop.querySelector('[data-act="confirm"]');
    cancelBtn?.addEventListener('click', () => {
      finish(false);
      backdrop._stClose?.();
    });
    confirmBtn?.addEventListener('click', () => {
      finish(true);
      backdrop._stClose?.();
    });
    setTimeout(() => confirmBtn?.focus?.(), 0);
  });
}

/**
 * Two-way Showtime choice modal for the Camera Focus prompt: the Star is
 * leaving an active scene and the user picks which thread narration follows.
 * Resolves `'keepCast'`, `'followStar'`, or `null` if dismissed without a choice.
 * @param {string} message
 * @param {{ title?: string, subtitle?: string, castLabel?: string, starLabel?: string }} [opts]
 * @returns {Promise<'keepCast'|'followStar'|null>}
 */
export function showtimeCameraFocusChoice(message, opts = {}) {
  const title = String(opts?.title || 'CAMERA FOCUS').trim();
  const subtitle = String(opts?.subtitle ?? '— Stage Desk —').trim();
  const text = String(message ?? '').trim();
  const castLabel = String(opts?.castLabel || 'In play cast').trim();
  const starLabel = String(opts?.starLabel || 'Star').trim();
  if (typeof document === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (val) => {
      if (settled) return;
      settled = true;
      resolve(val);
    };
    const backdrop = buildShowtimeModal(`
      <div class="inv-modal-title">${esc(title)}</div>
      ${subtitle ? `<div class="inv-modal-subtitle">${esc(subtitle)}</div>` : ''}
      <div class="st-dialog-body">${esc(text).replace(/\n/g, '<br>')}</div>
      <div class="inv-modal-actions">
        <button type="button" class="inv-btn" data-act="keepCast">${esc(castLabel)}</button>
        <button type="button" class="inv-btn" data-act="followStar">${esc(starLabel)}</button>
      </div>
    `, { onClose: () => finish(null) });
    const castBtn = backdrop.querySelector('[data-act="keepCast"]');
    const starBtn = backdrop.querySelector('[data-act="followStar"]');
    castBtn?.addEventListener('click', () => {
      finish('keepCast');
      backdrop._stClose?.();
    });
    starBtn?.addEventListener('click', () => {
      finish('followStar');
      backdrop._stClose?.();
    });
    setTimeout(() => castBtn?.focus?.(), 0);
  });
}

/**
 * Showtime-formatted prompt modal replacing native `window.prompt()`.
 * Resolves with the entered string (or `null` when cancelled).
 * @param {string} message
 * @param {{ title?: string, subtitle?: string, defaultValue?: string, placeholder?: string, confirmLabel?: string, cancelLabel?: string }} [opts]
 * @returns {Promise<string|null>}
 */
export function showtimePrompt(message, opts = {}) {
  const cfg = normalizeDialogOptions(message, opts, {
    title: 'STAGE ENTRY',
    subtitle: '— Stage Desk —',
    confirmLabel: 'Save',
    cancelLabel: 'Cancel',
    defaultValue: '',
    placeholder: '',
  });
  if (typeof document === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (val) => {
      if (settled) return;
      settled = true;
      resolve(val);
    };
    const backdrop = buildShowtimeModal(`
      <div class="inv-modal-title">${esc(cfg.title)}</div>
      ${cfg.subtitle ? `<div class="inv-modal-subtitle">${esc(cfg.subtitle)}</div>` : ''}
      <div class="inv-modal-field">
        <label>${esc(cfg.message)}</label>
        <input type="text" data-field="prompt-input" value="${esc(cfg.defaultValue)}" placeholder="${esc(cfg.placeholder)}">
      </div>
      <div class="inv-modal-actions">
        <button type="button" class="inv-btn" data-act="cancel">${esc(cfg.cancelLabel)}</button>
        <button type="button" class="inv-btn" data-act="confirm">${esc(cfg.confirmLabel)}</button>
      </div>
    `, { onClose: () => finish(null) });
    const input = backdrop.querySelector('[data-field="prompt-input"]');
    const cancelBtn = backdrop.querySelector('[data-act="cancel"]');
    const confirmBtn = backdrop.querySelector('[data-act="confirm"]');
    const submit = () => {
      const val = String(input?.value ?? '');
      finish(val);
      backdrop._stClose?.();
    };
    input?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submit();
      }
    });
    cancelBtn?.addEventListener('click', () => {
      finish(null);
      backdrop._stClose?.();
    });
    confirmBtn?.addEventListener('click', submit);
    setTimeout(() => {
      input?.focus?.();
      input?.select?.();
    }, 0);
  });
}

let activeMenuCleanup = null;

/**
 * Open a Showtime-styled floating menu anchored near `anchorEl`.
 * @param {HTMLElement} anchorEl
 * @param {Array<{ id?: string, label: string, danger?: boolean, disabled?: boolean, onSelect?: () => void }>} items
 * @param {{ className?: string }} [opts]
 */
export function showtimeMenu(anchorEl, items = [], opts = {}) {
  if (typeof document === 'undefined' || !anchorEl) return () => {};
  if (activeMenuCleanup) activeMenuCleanup();

  const pop = document.createElement('div');
  pop.className = ['inv-menu-pop', 'st-menu-pop', opts.className || ''].filter(Boolean).join(' ');
  pop.innerHTML = (items || []).map((it, idx) => `
    <button type="button" data-idx="${idx}" class="${it?.danger ? 'danger' : ''}"${it?.disabled ? ' disabled' : ''}>
      ${esc(it?.label || '')}
    </button>
  `).join('');
  document.body.appendChild(pop);

  const rect = anchorEl.getBoundingClientRect();
  const popRect = pop.getBoundingClientRect();
  const left = Math.max(8, Math.min(rect.right - popRect.width, window.innerWidth - popRect.width - 8));
  const top = (rect.bottom + popRect.height + 8 > window.innerHeight)
    ? Math.max(8, rect.top - popRect.height - 4)
    : rect.bottom + 4;
  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;

  const close = () => {
    pop.remove();
    document.removeEventListener('mousedown', onDocDown, true);
    document.removeEventListener('keydown', onKey, true);
    if (activeMenuCleanup === close) activeMenuCleanup = null;
  };
  const onDocDown = (e) => {
    if (!pop.contains(e.target) && e.target !== anchorEl) close();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };
  pop.querySelectorAll('button[data-idx]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = Number(btn.dataset.idx);
      const item = items[idx];
      close();
      if (item && !item.disabled) item.onSelect?.(item);
    });
  });
  setTimeout(() => {
    document.addEventListener('mousedown', onDocDown, true);
    document.addEventListener('keydown', onKey, true);
  }, 0);
  activeMenuCleanup = close;
  return close;
}

export async function smokeDialogsPure() {
  const cfg = normalizeDialogOptions('Delete this card?', { danger: true, confirmLabel: 'Delete' });
  if (cfg.message !== 'Delete this card?') return 'dialog message mismatch';
  if (!cfg.danger || cfg.confirmLabel !== 'Delete') return 'dialog options mismatch';
  let received = null;
  const fakeBus = { emit: (ev, data) => { received = { ev, data }; } };
  const ok = emitShowtimeNotice(fakeBus, { kind: 'house', text: 'Saved' });
  if (!ok || received?.ev !== 'showtime.notice' || received?.data?.items?.[0]?.text !== 'Saved') {
    return 'emitShowtimeNotice failed';
  }
  if (typeof document === 'undefined') {
    const result = await showtimeCameraFocusChoice('Weslie is stepping out. Keep following the scene, or follow Weslie?');
    if (result !== null) return 'showtimeCameraFocusChoice should resolve null outside a DOM (no document)';
  }
  return '';
}
