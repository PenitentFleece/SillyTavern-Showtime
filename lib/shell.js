// The "Marquee" — floating tabbed panel that hosts all modules.

import { extension_settings } from '../../../../extensions.js';
import { getCurrentChatId, saveSettingsDebounced } from '../../../../../script.js';

const DRAG_THRESHOLD = 5;
const SNAP_THRESHOLD = 56;
const CORNERS = ['tl', 'tr', 'bl', 'br'];
const SELECT_CHAT_POPUP_ID = 'shadow_select_chat_popup';

function houseRoot() {
  if (!extension_settings.showtime) extension_settings.showtime = {};
  const root = extension_settings.showtime;
  root.enabledModules ??= {};
  if (typeof root.masterOff !== 'boolean') root.masterOff = false;
  root.shell ??= {};
  return root;
}

function shellPrefs() {
  const s = houseRoot().shell;
  if (typeof s.pinned !== 'boolean') s.pinned = false;
  if (s.corner != null && !CORNERS.includes(s.corner)) s.corner = null;
  return s;
}

function isSelectChatScreenOpen() {
  const el = document.getElementById(SELECT_CHAT_POPUP_ID);
  if (!el) return false;
  const st = getComputedStyle(el);
  if (st.display === 'none' || st.visibility === 'hidden') return false;
  const op = parseFloat(st.opacity);
  if (Number.isFinite(op) && op < 0.05) return false;
  return true;
}

function isWelcomeHouse() {
  return !!document.querySelector('#chat .welcomePanel');
}

function topBarOffset() {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue('--topBarBlockSize').trim();
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : 50;
}

function edgeMargin() {
  return 8;
}

/**
 * Keep a fixed-position popout on-screen (under the top bar, with margin).
 * Shared by Marquee, Scene board, and Tape Deck.
 * @param {HTMLElement} el
 * @param {{ margin?: number }} [opts]
 */
export function clampFixedElement(el, { margin = 8 } = {}) {
  if (!el) return;
  const minTop = topBarOffset() + margin;
  const rect = el.getBoundingClientRect();
  let left = rect.left;
  let top = rect.top;
  const w = rect.width || el.offsetWidth || 1;
  const h = rect.height || el.offsetHeight || 1;
  const maxLeft = Math.max(margin, window.innerWidth - w - margin);
  const maxTop = Math.max(minTop, window.innerHeight - h - margin);
  left = Math.min(Math.max(margin, left), maxLeft);
  top = Math.min(Math.max(minTop, top), maxTop);
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
  el.style.right = 'auto';
  el.style.bottom = 'auto';
}

export class Shell {
  constructor({ bus }) {
    this.bus = bus;
    this.tabs = [];              // [{ cls, instance, tabEl, paneEl }]
    this.activeId = null;
    this.rootEl = null;
    this._curtainMode = false;
    this._liftTimer = null;
    this._dragMoved = false;
  }

  registerTab(cls, instance) {
    this.tabs.push({ cls, instance, tabEl: null, paneEl: null });
  }

  mount(parent) {
    const closed = !this.hasOpenChat();
    const root = document.createElement('div');
    root.id = 'showtime-marquee';
    root.className = closed
      ? 'showtime-marquee showtime-marquee--curtain'
      : 'showtime-marquee collapsed';
    root.innerHTML = `
      <div class="showtime-curtain" aria-hidden="${closed ? 'false' : 'true'}">
        <div class="showtime-curtain-valance"></div>
        <div class="showtime-curtain-skirt">
          <span class="showtime-curtain-label">House closed</span>
        </div>
      </div>
      <div class="showtime-titlebar">
        <span class="showtime-logo">SHOWTIME</span>
        <div class="showtime-titlebar-actions">
          <button type="button" class="showtime-btn-pin" title="Pin position" aria-pressed="false">📍</button>
          <button type="button" class="showtime-btn-collapse" title="Expand / collapse">–</button>
        </div>
      </div>
      <div class="showtime-tabs" role="tablist"></div>
      <div class="showtime-body"></div>
    `;
    parent.appendChild(root);
    this.rootEl = root;
    this._curtainMode = closed;

    const tabsEl = root.querySelector('.showtime-tabs');
    const bodyEl = root.querySelector('.showtime-body');

    for (const tab of this.tabs) {
      const btn = document.createElement('button');
      btn.className = 'showtime-tab';
      btn.role = 'tab';
      btn.dataset.moduleId = tab.cls.id;
      btn.textContent = tab.cls.label;
      btn.addEventListener('click', () => {
        if (this._curtainMode) return;
        this.activate(tab.cls.id);
      });
      tabsEl.appendChild(btn);

      const pane = document.createElement('div');
      pane.className = 'showtime-pane';
      pane.dataset.moduleId = tab.cls.id;
      pane.hidden = true;
      bodyEl.appendChild(pane);

      tab.tabEl = btn;
      tab.paneEl = pane;
    }

    root.querySelector('.showtime-btn-collapse').addEventListener('click', (e) => {
      e.stopPropagation();
      if (this._curtainMode) return;
      this.toggleCollapsed();
    });
    root.querySelector('.showtime-btn-pin').addEventListener('click', (e) => {
      e.stopPropagation();
      if (this._curtainMode) return;
      this.togglePinned();
    });
    // Intentional click on title expands when collapsed — not after a drag.
    root.querySelector('.showtime-titlebar').addEventListener('click', (e) => {
      if (this._curtainMode) return;
      if (e.target.closest('button')) return;
      if (this._dragMoved) return;
      if (root.classList.contains('collapsed')) {
        root.classList.remove('collapsed');
        this._syncCollapseChrome();
        this.clampToViewport();
        this.persistPlacement();
      }
    });

    this.makeDraggable(root, root.querySelector('.showtime-titlebar'));
    root.addEventListener('mousedown', e => e.stopPropagation());
    root.addEventListener('click', e => e.stopPropagation());

    window.addEventListener('resize', () => {
      this.applyPlacement({ preferSnap: true });
    });

    this.applyTabPolicy();
    this.syncPinChrome();
    this.applyPlacement({ preferDefault: !shellPrefs().pinned && shellPrefs().left == null });
    this.syncChatPresence({ animate: false });
    this._watchChatPresence();

    // Activate first enabled tab by default (skipped while the house is closed).
    const first = this.tabs.find(t => this.isModuleEnabled(t.cls.id)) ?? this.tabs[0];
    if (first) this.activate(first.cls.id);
  }

  /** True when a play chat is on stage — not welcome, not Manage/Select Chat. */
  hasOpenChat() {
    try {
      if (isWelcomeHouse() || isSelectChatScreenOpen()) return false;
      const id = getCurrentChatId();
      return id !== undefined && id !== null && String(id) !== '';
    } catch {
      return false;
    }
  }

  _watchChatPresence() {
    if (this._chatWatch) return;
    const tick = () => {
      const open = this.hasOpenChat();
      if (open === !this._curtainMode) return;
      this.syncChatPresence({ animate: true });
    };
    const observe = (el, opts) => {
      if (!el || typeof MutationObserver === 'undefined') return;
      const mo = new MutationObserver(() => {
        clearTimeout(this._chatWatchTimer);
        this._chatWatchTimer = setTimeout(tick, 50);
      });
      mo.observe(el, opts);
      this._chatWatchers = this._chatWatchers || [];
      this._chatWatchers.push(mo);
    };
    this._chatWatch = true;
    observe(document.getElementById('chat'), { childList: true });
    observe(document.getElementById(SELECT_CHAT_POPUP_ID), {
      attributes: true,
      attributeFilter: ['style', 'class'],
    });
  }

  /**
   * Curtain when no chat; lift animation when a chat opens.
   * The marquee itself always stays mounted.
   * @param {{ animate?: boolean }} [opts]
   */
  syncChatPresence({ animate = true } = {}) {
    const root = this.rootEl;
    if (!root) return;
    root.hidden = false;
    root.style.display = 'flex';
    if (root.parentElement !== document.body) {
      document.body.appendChild(root);
    }
    const open = this.hasOpenChat();
    const wasCurtain = this._curtainMode;

    if (!open) {
      if (this._liftTimer) {
        clearTimeout(this._liftTimer);
        this._liftTimer = null;
      }
      this._curtainMode = true;
      root.classList.add('showtime-marquee--curtain');
      root.classList.remove('showtime-marquee--curtain-lift', 'collapsed');
      root.querySelector('.showtime-curtain')?.setAttribute('aria-hidden', 'false');
      document.body.appendChild(root);
      this._syncCollapseChrome();
      // Pinned / saved placement stays put; unpinned with no save still docks top-right.
      this.applyPlacement({ preferDefault: !shellPrefs().pinned && shellPrefs().left == null });
      if (!wasCurtain) this.bus?.emit('showtime.chatPresence', { open: false });
      return;
    }

    // Chat is open
    this._curtainMode = false;
    root.querySelector('.showtime-curtain')?.setAttribute('aria-hidden', 'true');

    if (wasCurtain && animate) {
      root.classList.remove('showtime-marquee--curtain');
      root.classList.add('showtime-marquee--curtain-lift', 'collapsed');
      this._syncCollapseChrome();
      if (this._liftTimer) clearTimeout(this._liftTimer);
      this._liftTimer = setTimeout(() => {
        root.classList.remove('showtime-marquee--curtain-lift');
        this._liftTimer = null;
        this.applyPlacement();
      }, 950);
    } else {
      root.classList.remove('showtime-marquee--curtain', 'showtime-marquee--curtain-lift');
    }
    this.applyPlacement();
    if (wasCurtain) {
      const id = this.activeId
        || this.tabs.find(t => this.isModuleEnabled(t.cls.id))?.cls.id
        || this.tabs[0]?.cls.id;
      if (id) void this.activate(id);
      this.bus?.emit('showtime.chatPresence', { open: true });
    }
  }

  toggleCollapsed() {
    const root = this.rootEl;
    if (!root) return;
    root.classList.toggle('collapsed');
    this._syncCollapseChrome();
    // Size change only — keep left/top; do not re-dock to default.
    this.clampToViewport();
    this.persistPlacement({ keepCorner: true });
  }

  _syncCollapseChrome() {
    const root = this.rootEl;
    if (!root) return;
    const btn = root.querySelector('.showtime-btn-collapse');
    if (!btn) return;
    const collapsed = root.classList.contains('collapsed');
    btn.textContent = collapsed ? '+' : '–';
    btn.title = collapsed ? 'Expand' : 'Collapse';
  }

  isPinned() {
    return !!shellPrefs().pinned;
  }

  togglePinned() {
    const prefs = shellPrefs();
    prefs.pinned = !prefs.pinned;
    if (prefs.pinned) this.persistPlacement();
    else saveSettingsDebounced();
    this.syncPinChrome();
  }

  syncPinChrome() {
    const root = this.rootEl;
    if (!root) return;
    const on = this.isPinned();
    root.classList.toggle('showtime-marquee--pinned', on);
    const btn = root.querySelector('.showtime-btn-pin');
    if (btn) {
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.textContent = on ? '📌' : '📍';
      btn.title = on
        ? 'Unpin — position still remembered until you drag'
        : 'Pin position — keep this spot across open/close';
    }
  }

  /** Default dock: under the SillyTavern top bar (right side). */
  stickUnderTopBar() {
    this.placeAtCorner('tr');
  }

  /**
   * @param {'tl'|'tr'|'bl'|'br'} corner
   */
  placeAtCorner(corner) {
    const root = this.rootEl;
    if (!root || !CORNERS.includes(corner)) return;
    const margin = edgeMargin();
    const minTop = topBarOffset() + margin;
    const rect = root.getBoundingClientRect();
    const w = rect.width || root.offsetWidth || 200;
    const h = rect.height || root.offsetHeight || 40;
    const maxLeft = Math.max(margin, window.innerWidth - w - margin);
    const maxTop = Math.max(minTop, window.innerHeight - h - margin);

    let left = margin;
    let top = minTop;
    if (corner === 'tr' || corner === 'br') left = maxLeft;
    if (corner === 'bl' || corner === 'br') top = maxTop;

    root.style.left = `${left}px`;
    root.style.top = `${top}px`;
    root.style.right = 'auto';
    root.style.bottom = 'auto';

    const prefs = shellPrefs();
    prefs.corner = corner;
    prefs.left = left;
    prefs.top = top;
  }

  /**
   * Restore saved placement, optional default dock, then clamp / optional re-snap.
   * @param {{ preferDefault?: boolean, preferSnap?: boolean }} [opts]
   */
  applyPlacement({ preferDefault = false, preferSnap = false } = {}) {
    const root = this.rootEl;
    if (!root) return;
    const prefs = shellPrefs();

    if (preferDefault && !prefs.pinned) {
      this.stickUnderTopBar();
      this.clampToViewport();
      return;
    }

    if (prefs.corner && CORNERS.includes(prefs.corner)) {
      this.placeAtCorner(prefs.corner);
    } else if (Number.isFinite(prefs.left) && Number.isFinite(prefs.top)) {
      root.style.left = `${prefs.left}px`;
      root.style.top = `${prefs.top}px`;
      root.style.right = 'auto';
      root.style.bottom = 'auto';
    } else {
      this.stickUnderTopBar();
    }

    this.clampToViewport();
    if (preferSnap && prefs.corner) this.placeAtCorner(prefs.corner);
    else if (preferSnap) this.snapToNearestCorner({ force: false });
  }

  /** Keep the marquee fully on-screen with a margin; never above the top bar. */
  clampToViewport() {
    clampFixedElement(this.rootEl, { margin: edgeMargin() });
  }

  /**
   * If near a corner (or force), snap. Returns snapped corner id or null.
   * @param {{ force?: boolean, threshold?: number }} [opts]
   */
  snapToNearestCorner({ force = false, threshold = SNAP_THRESHOLD } = {}) {
    const root = this.rootEl;
    if (!root) return null;
    const margin = edgeMargin();
    const minTop = topBarOffset() + margin;
    const rect = root.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    const maxLeft = Math.max(margin, window.innerWidth - w - margin);
    const maxTop = Math.max(minTop, window.innerHeight - h - margin);

    const spots = {
      tl: { left: margin, top: minTop },
      tr: { left: maxLeft, top: minTop },
      bl: { left: margin, top: maxTop },
      br: { left: maxLeft, top: maxTop },
    };

    let best = null;
    let bestDist = Infinity;
    for (const id of CORNERS) {
      const s = spots[id];
      const d = Math.hypot(rect.left - s.left, rect.top - s.top);
      if (d < bestDist) {
        bestDist = d;
        best = id;
      }
    }

    if (!best) return null;
    if (!force && bestDist > threshold) return null;
    this.placeAtCorner(best);
    return best;
  }

  /**
   * @param {{ keepCorner?: boolean }} [opts]
   */
  persistPlacement({ keepCorner = false } = {}) {
    const root = this.rootEl;
    if (!root) return;
    const prefs = shellPrefs();
    const rect = root.getBoundingClientRect();
    prefs.left = rect.left;
    prefs.top = rect.top;
    if (!keepCorner) {
      // Clear free-float corner tag unless we just snapped.
      const snapped = this._lastSnapCorner;
      prefs.corner = snapped || null;
      this._lastSnapCorner = null;
    }
    saveSettingsDebounced();
  }

  isModuleEnabled(moduleId) {
    const root = houseRoot();
    if (moduleId === 'backstage') return true;
    return root.enabledModules[moduleId] !== false;
  }

  applyTabPolicy() {
    const root = houseRoot();
    this.rootEl?.classList.toggle('showtime-marquee--dead', !!root.masterOff);
    for (const tab of this.tabs) {
      const on = this.isModuleEnabled(tab.cls.id);
      tab.tabEl?.classList.toggle('showtime-tab--struck', !on);
      tab.tabEl?.setAttribute('aria-disabled', on ? 'false' : 'true');
      if (tab.tabEl) tab.tabEl.title = on ? '' : 'Disabled in Backstage → Settings';
    }
    if (this.activeId && !this.isModuleEnabled(this.activeId)) {
      const fallback = this.tabs.find(t => this.isModuleEnabled(t.cls.id));
      if (fallback) void this.activate(fallback.cls.id);
    }
  }

  async activate(moduleId) {
    if (this._curtainMode) return;
    if (!this.isModuleEnabled(moduleId)) return;
    for (const tab of this.tabs) {
      const active = tab.cls.id === moduleId;
      tab.tabEl.classList.toggle('active', active);
      tab.paneEl.hidden = !active;
      // Inline display:flex from a module must not override [hidden].
      tab.paneEl.style.display = active ? '' : 'none';
      if (active) {
        await tab.instance.render(tab.paneEl);
      }
    }
    this.activeId = moduleId;
    this.rootEl?.classList.toggle(
      'showtime-marquee--wide',
      moduleId === 'inventory' || moduleId === 'reputation' || moduleId === 'composer'
      || moduleId === 'motivation' || moduleId === 'library' || moduleId === 'backstage',
    );
    this.rootEl?.classList.toggle('showtime-marquee--script', moduleId === 'script');
    this.rootEl?.classList.toggle('showtime-marquee--mid', moduleId === 'cast');
    // Width class changed — re-apply corner snap or clamp without docking default.
    const prefs = shellPrefs();
    if (prefs.corner) this.placeAtCorner(prefs.corner);
    else this.clampToViewport();
  }

  async refreshActiveTab() {
    if (this._curtainMode) return;
    if (!this.activeId) return;
    const tab = this.tabs.find(t => t.cls.id === this.activeId);
    if (tab) await tab.instance.render(tab.paneEl);
  }

  makeDraggable(el, handle) {
    let sx = 0, sy = 0, ox = 0, oy = 0, dragging = false, armed = false;

    handle.addEventListener('mousedown', (e) => {
      if (this._curtainMode) return;
      if (e.target.closest('button')) return;
      if (e.button !== 0) return;
      armed = true;
      dragging = false;
      this._dragMoved = false;
      sx = e.clientX; sy = e.clientY;
      const rect = el.getBoundingClientRect();
      ox = rect.left; oy = rect.top;
      e.preventDefault();
    });

    window.addEventListener('mousemove', (e) => {
      if (!armed) return;
      const dx = e.clientX - sx;
      const dy = e.clientY - sy;
      if (!dragging) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        dragging = true;
        this._dragMoved = true;
        shellPrefs().corner = null; // free-float until snap
      }
      el.style.left = `${ox + dx}px`;
      el.style.top = `${oy + dy}px`;
      el.style.right = 'auto';
      el.style.bottom = 'auto';
      this.clampToViewport();
    });

    window.addEventListener('mouseup', () => {
      if (!armed) return;
      armed = false;
      if (!dragging) {
        // Pure click — leave _dragMoved false so titlebar click can expand.
        return;
      }
      dragging = false;
      const snapped = this.snapToNearestCorner({ force: false });
      this._lastSnapCorner = snapped;
      this.persistPlacement();
      // Click fires after mouseup in the same turn; clear on next tick so expand is skipped.
      setTimeout(() => { this._dragMoved = false; }, 0);
    });
  }
}
