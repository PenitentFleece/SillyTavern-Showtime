// The "Marquee" — floating tabbed panel that hosts all modules.

import { extension_settings } from '../../../../extensions.js';
import { getCurrentChatId, saveSettingsDebounced, eventSource, event_types } from '../../../../../script.js';
import { rafMove } from './uiPerf.js';

const DRAG_THRESHOLD = 5;
const SNAP_THRESHOLD = 56;
const MIN_PANEL_HEIGHT = 200;
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

function escHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, ch =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}

function noticeMark(raw) {
  if (raw == null || raw === '') return '';
  const v = String(raw).trim();
  if (v === '!' || v === '?') return v;
  if (v === 'X' || v === 'x') return 'X';
  const n = Number(v);
  if (Number.isFinite(n) && n > 0) return String(Math.min(99, Math.round(n)));
  return '';
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
    this._notices = [];
    this._noticeUnread = 0;
    this._noticeDropOpen = false;
    // Bumped whenever anything could have changed what a pane shows.
    this._stateSeq = 0;
    const bump = () => { this._stateSeq++; };
    this.bus.on('showtime.stateChanged', bump);
    this.bus.on('showtime.notice', (payload) => this._onNotice(payload));
    if (event_types?.CHAT_CHANGED) {
      eventSource.on(event_types.CHAT_CHANGED, () => this._clearNotices());
    }
    for (const ev of ['MESSAGE_SENT', 'MESSAGE_RECEIVED', 'MESSAGE_SWIPED', 'MESSAGE_DELETED', 'MESSAGE_EDITED', 'CHAT_CHANGED']) {
      if (event_types?.[ev]) eventSource.on(event_types[ev], bump);
    }
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
        <div class="showtime-brand">
          <span class="showtime-logo">SHOWTIME</span>
          <button type="button" class="showtime-notice-pip" hidden title="Status notices" aria-label="Status notices" aria-expanded="false">
            <span class="showtime-notice-count">0</span>
            <span class="showtime-notice-mark" hidden></span>
          </button>
          <div class="showtime-notice-drop" hidden></div>
        </div>
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
    const pip = root.querySelector('.showtime-notice-pip');
    pip.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this._curtainMode) return;
      this._toggleNoticeDrop();
    });
    document.addEventListener('pointerdown', (e) => {
      if (!this._noticeDropOpen) return;
      if (e.target?.closest?.('.showtime-brand')) return;
      this._setNoticeDropOpen(false);
    }, true);
    // Intentional click on title expands when collapsed — not after a drag.
    root.querySelector('.showtime-titlebar').addEventListener('click', (e) => {
      if (this._curtainMode) return;
      if (e.target.closest('button, .showtime-notice-drop')) return;
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
    this._watchPanelSize();
    this.applyPlacement({ preferDefault: !shellPrefs().pinned && shellPrefs().left == null });
    this.syncChatPresence({ animate: false });
    this._watchChatPresence();

    // Activate first enabled tab by default (skipped while the house is closed).
    const first = this.tabs.find(t => this.isModuleEnabled(t.cls.id)) ?? this.tabs[0];
    if (first) this.activate(first.cls.id);
    this._paintNotices();
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
    if (prefs.pinned) this.persistPlacement({ keepCorner: true });
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
        ? 'Pinned here — click to unpin (re-docking and corner snapping come back)'
        : 'Pin this exact spot — no auto-docking, no corner snapping';
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

    // Pinned means pinned: restore the saved spot and never re-dock or re-snap.
    if (prefs.pinned && Number.isFinite(prefs.left) && Number.isFinite(prefs.top)) {
      root.style.left = `${prefs.left}px`;
      root.style.top = `${prefs.top}px`;
      root.style.right = 'auto';
      root.style.bottom = 'auto';
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
    this.fitHeightToViewport();
    clampFixedElement(this.rootEl, { margin: edgeMargin() });
  }

  /**
   * Cap the height at the space left below the marquee's own top edge, so a
   * long list scrolls inside instead of running off the bottom of the screen.
   */
  fitHeightToViewport() {
    const root = this.rootEl;
    if (!root || root.classList.contains('collapsed') || this._curtainMode) return;
    const margin = edgeMargin();
    const minTop = topBarOffset() + margin;
    // Anchor on the position the user chose, not on the clamped live rect:
    // measuring the live top after a clamp feeds back (taller → clamp up →
    // more room → taller) and stretches the panel to full height.
    const prefs = shellPrefs();
    const anchor = Number.isFinite(prefs.top) ? prefs.top : root.getBoundingClientRect().top;
    const top = Math.max(minTop, anchor);
    const avail = Math.max(MIN_PANEL_HEIGHT, window.innerHeight - top - margin);
    const next = `${Math.round(avail)}px`;
    if (root.style.maxHeight !== next) root.style.maxHeight = next;
  }

  /** Content that grows (a long list opening) must not push the panel off-screen. */
  _watchPanelSize() {
    const root = this.rootEl;
    if (!root || this._sizeRo || typeof ResizeObserver === 'undefined') return;
    this._sizeRo = new ResizeObserver(() => {
      if (this._sizeFrame) return;
      this._sizeFrame = requestAnimationFrame(() => {
        this._sizeFrame = 0;
        this.fitHeightToViewport();
        clampFixedElement(this.rootEl, { margin: edgeMargin() });
      });
    });
    this._sizeRo.observe(root);
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

  /** Defer the settings write to idle time (or 2s at the latest). */
  _persistWhenIdle() {
    if (this._persistIdle) return;
    const run = () => {
      this._persistIdle = 0;
      this.persistPlacement();
    };
    this._persistIdle = typeof requestIdleCallback === 'function'
      ? requestIdleCallback(run, { timeout: 2000 })
      : setTimeout(run, 400);
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
        // Re-rendering a whole pane is the expensive part of a tab switch.
        // Reuse the existing DOM when nothing changed since it was built.
        const token = this._renderToken();
        if (tab.paneEl.childElementCount && tab._stRenderToken === token) continue;
        await tab.instance.render(tab.paneEl);
        tab._stRenderToken = this._renderToken();
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
    if (this.isPinned()) this.clampToViewport();
    else if (prefs.corner) this.placeAtCorner(prefs.corner);
    else this.clampToViewport();
  }

  async refreshActiveTab() {
    if (this._curtainMode) return;
    if (!this.activeId) return;
    const tab = this.tabs.find(t => t.cls.id === this.activeId);
    if (!tab) return;
    await tab.instance.render(tab.paneEl);
    tab._stRenderToken = this._renderToken();
  }

  _onNotice(payload) {
    const items = Array.isArray(payload?.items) ? payload.items : [];
    if (!items.length) return;
    const kind = String(payload?.kind || 'status');
    for (const it of items) {
      if (kind === 'inventory') {
        const name = String(it?.name || 'Item').trim();
        const toState = String(it?.toState || it?.label || '').trim();
        const mark = noticeMark(it?.mark);
        this._notices.unshift({
          text: toState ? `${name} · ${toState}` : name,
          at: Date.now(),
          kind: 'inventory',
          mark,
        });
        continue;
      }
      if (kind === 'director') {
        const text = String(it?.text || it?.name || 'Director event').trim();
        if (!text) continue;
        this._notices.unshift({
          text,
          at: Date.now(),
          kind: 'director',
          mark: noticeMark(it?.mark) || '!',
        });
        continue;
      }
      const name = String(it?.name || 'Star').trim();
      const label = String(it?.label || 'Status').trim();
      const toState = String(it?.toState || '').trim();
      if (!toState) continue;
      this._notices.unshift({
        text: `${name} · ${label} is now ${toState}`,
        at: Date.now(),
        kind: 'status',
        mark: '',
      });
    }
    this._notices = this._notices.slice(0, 8);
    if (this._noticeDropOpen) this._noticeUnread = 0;
    else this._noticeUnread = Math.min(8, this._noticeUnread + items.length);
    this._paintNotices();
  }

  _toggleNoticeDrop() {
    this._setNoticeDropOpen(!this._noticeDropOpen);
  }

  _setNoticeDropOpen(open) {
    this._noticeDropOpen = !!open;
    if (this._noticeDropOpen) this._noticeUnread = 0;
    this._paintNotices();
  }

  _clearNotices() {
    this._notices = [];
    this._noticeUnread = 0;
    this._noticeDropOpen = false;
    this._paintNotices();
  }

  _paintNotices() {
    const root = this.rootEl;
    if (!root) return;
    const pip = root.querySelector('.showtime-notice-pip');
    const countEl = root.querySelector('.showtime-notice-count');
    const markEl = root.querySelector('.showtime-notice-mark');
    const drop = root.querySelector('.showtime-notice-drop');
    if (!pip || !drop) return;
    const n = this._notices.length;
    const unread = this._noticeUnread;
    const unreadRows = unread > 0 ? this._notices.slice(0, unread) : [];
    const glyph = unreadRows.map(x => x.mark).find(m => m === 'X' || m === '!' || m === '?')
      || this._notices.map(x => x.mark).find(m => m === 'X' || m === '!' || m === '?')
      || '';
    const addCount = unreadRows
      .filter(x => x.kind === 'inventory' && /^\d+$/.test(String(x.mark || '')))
      .reduce((sum, x) => Math.max(sum, Number(x.mark) || 0), 0);
    pip.hidden = n === 0;
    pip.classList.toggle('has-unread', unread > 0);
    pip.classList.toggle('has-mark', !!glyph);
    pip.setAttribute('aria-expanded', this._noticeDropOpen ? 'true' : 'false');
    if (countEl) {
      const shown = addCount > 0 ? addCount : (unread > 0 ? unread : n);
      countEl.textContent = String(shown);
      countEl.hidden = !shown;
    }
    if (markEl) {
      markEl.textContent = glyph;
      markEl.hidden = !glyph;
    }
    drop.hidden = !this._noticeDropOpen;
    root.classList.toggle('showtime-marquee--notices-open', this._noticeDropOpen);
    if (this._noticeDropOpen) {
      const rows = this._notices.map(x => {
        const jump = x.kind === 'director' || x.kind === 'inventory' || x.kind === 'status';
        return `<div class="showtime-notice-row${jump ? ' showtime-notice-row--jump' : ''}"${
          jump ? ` data-action="open-notice" data-kind="${escHtml(x.kind)}"` : ''
        }>${x.mark ? `<span class="showtime-notice-glyph">${escHtml(x.mark)}</span>` : ''}${escHtml(x.text)}</div>`;
      }).join('');
      drop.innerHTML = `
        <div class="showtime-notice-head">Status</div>
        ${rows || '<div class="showtime-notice-empty">No notices.</div>'}
        <button type="button" class="showtime-notice-clear">Clear</button>`;
      drop.querySelector('.showtime-notice-clear')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this._clearNotices();
      });
      drop.querySelectorAll('[data-action="open-notice"]').forEach((row) => {
        row.addEventListener('click', (e) => {
          e.stopPropagation();
          this._openNoticeTarget(row.dataset.kind);
          this._setNoticeDropOpen(false);
        });
      });
    }
  }

  _revealMarquee() {
    const root = this.rootEl;
    if (!root || this._curtainMode) return;
    if (root.classList.contains('collapsed')) {
      root.classList.remove('collapsed');
      this._syncCollapseChrome();
      this.clampToViewport();
      this.persistPlacement({ keepCorner: true });
    }
  }

  _openNoticeTarget(kind) {
    this._revealMarquee();
    if (kind === 'director') {
      this.bus.emit('backstage.open', { door: 'production' });
      this.bus.emit('backstage.openEventPaper');
      return;
    }
    if (kind === 'inventory') {
      void this.activate('inventory');
      return;
    }
    if (kind === 'status') {
      void this.activate('cast');
    }
  }

  /** Identity of "what a pane would show right now". */
  _renderToken() {
    let chat = '';
    try { chat = String(getCurrentChatId() ?? ''); } catch { /* ignore */ }
    return `${chat}|${this._stateSeq}`;
  }

  makeDraggable(el, handle) {
    let sx = 0, sy = 0, ox = 0, oy = 0, dragging = false, armed = false;

    handle.addEventListener('mousedown', (e) => {
      if (this._curtainMode) return;
      if (e.target.closest('button, .showtime-notice-drop')) return;
      if (e.button !== 0) return;
      armed = true;
      dragging = false;
      this._dragMoved = false;
      sx = e.clientX; sy = e.clientY;
      const rect = el.getBoundingClientRect();
      ox = rect.left; oy = rect.top;
      e.preventDefault();
    });

    // One position update per frame; the listener stays cheap while not armed.
    const paintDrag = rafMove((e) => {
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
    window.addEventListener('mousemove', (e) => {
      if (armed) paintDrag(e);
    });

    window.addEventListener('mouseup', () => {
      if (!armed) return;
      paintDrag.flush();
      armed = false;
      if (!dragging) {
        // Pure click — leave _dragMoved false so titlebar click can expand.
        return;
      }
      dragging = false;
      // A pinned marquee stays exactly where it was dropped.
      const snapped = this.isPinned() ? null : this.snapToNearestCorner({ force: false });
      this._lastSnapCorner = snapped;
      // Persisting writes ST settings; do it when the browser is idle so the
      // next drag doesn't start into that stall.
      this._persistWhenIdle();
      // Click fires after mouseup in the same turn; clear on next tick so expand is skipped.
      setTimeout(() => { this._dragMoved = false; }, 0);
    });
  }
}
