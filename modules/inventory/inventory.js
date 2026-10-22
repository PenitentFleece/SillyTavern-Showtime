// Inventory — {{user}} belongings. Trunk (dressing room) vs On Person.
import { getContext } from '../../../../../extensions.js';
import { eventSource, event_types } from '../../../../../../script.js';
import { Module } from '../../lib/module.js';
import { getCastMembers, getStarMember, resolveChatSpeaker } from '../../lib/castCatalog.js';
import { ensureCompass, getActiveRoom, listLostAndFound, removeFromLostAndFound, pickupItem } from '../../lib/compass/state.js';
import { listAllSetPieces } from '../../lib/compass/schema.js';
import { resolveLockKeys } from '../../lib/compass/render.js';
import { clipText, CHAT_SCAN_DEPTH, playMessagesSince, scanCareCues } from '../../lib/chatTrack.js';
import { formatChatLine, clipExcerptToLines } from '../../lib/castAudit.js';
import { parseJsonObject, parseJsonArray } from '../../lib/jsonExtract.js';
import { withShowtimeProfile } from '../../lib/connectionProfile.js';
import { leanQuietGenerate } from '../../lib/isolatedGen.js';
import { applyDifficultyToStat } from '../../lib/trackersConfig.js';
import { stateLabel, STAT_DEFS } from '../../lib/statBars.js';
import {
  FILL_BANDS, FILL_MAP, AMOUNT_UNITS,
  readAmount, writeAmount, applyAmountOp, spendAmount, deriveFill,
  formatAmountLine, hasAmount, careKind, amountAllowed, clearAmount,
  smokeInvAmountPure,
} from '../../lib/invAmount.js';
import { inferKitKind, smokeKitNestPure, kitChildren, kitDescendantIds } from '../../lib/kitNest.js';
import {
  deriveLocator,
  formatItemPlace,
  moveItem,
  stampInventoryLocators,
  worldFromStorage,
  smokeItemLocatorPure,
} from '../../lib/itemLocator.js';
import { exposeLinkedItem } from '../../lib/fileCabinet.js';
import {
  readHandoffSentence,
  handoffItemOp,
  fileOneHandoff,
  rewindOneHandoff,
} from '../../lib/receipt.js';
import {
  buildShowtimeModal,
  showtimeAlert,
  showtimeConfirm,
} from '../../lib/dialogs.js';

const CONDITIONS = [
  { id: 'pristine', label: 'Pristine', color: '#6b8f4a' },
  { id: 'fine',     label: 'Fine',     color: '#7a9e52' },
  { id: 'worn',     label: 'Worn',     color: '#8a9a4a' },
  { id: 'damaged',  label: 'Damaged',  color: '#c9a24a' },
  { id: 'broken',   label: 'Broken',   color: '#c4772b' },
  { id: 'ruined',   label: 'Ruined',   color: '#7a1f1f' },
];
const CONDITION_MAP = Object.fromEntries(CONDITIONS.map(c => [c.id, c]));

const CATEGORIES = [
  { id: 'consumable', label: 'Consumable', color: '#8a4a58', bg: '#ead4d8' },
  { id: 'wearable',   label: 'Wearable',   color: '#3d7a68', bg: '#d4ebe3' },
  { id: 'usable',     label: 'Usable',     color: '#4a5e7a', bg: '#d4dce8' },
  { id: 'misc',       label: 'Misc',       color: '#8a8474', bg: '#e4e0d4' },
];
const CATEGORY_MAP = Object.fromEntries(CATEGORIES.map(c => [c.id, c]));

const CONTAINER_COLOR = '#c9a24a';

const LOCS = {
  static: { title: 'Trunk',     sub: 'Left in the dressing room', moveTo: 'Move to Trunk' },
  mobile: { title: 'On Person', sub: 'Carried with you',          moveTo: 'Move to On Person' },
};

// Verbs for proposing an item on a cast member. "give" is an unconditional,
// immediate transfer (no narrative reply needed); the rest inject a note and
// wait for the target's in-character reply before anything moves.
const USE_VERBS = [
  { id: 'offer', label: 'Offer',   phrase: 'offering' },
  { id: 'use',   label: 'Use on',  phrase: 'using' },
  { id: 'force', label: 'Force',  phrase: 'forcing' },
  { id: 'give',  label: 'Give',    phrase: 'giving' },
];
const USE_VERB_MAP = Object.fromEntries(USE_VERBS.map(v => [v.id, v]));

// Cheap pre-filter so we only pay for a quiet-prompt classification call on
// messages that plausibly involve handing/forcing/offering something over.
const OFFER_CUE_RE = /\b(offers?(?:\s+you)?|hands?\s+(?:you|over|across)|holds?\s+out|gives?\s+you|passes?\s+you|slides?\s+(?:you|across)|pulls?\s+out|draws?\s+out|unsheathes?|tosses?\s+you|hurls?\s+at\s+you)\b/i;

export class InventoryModule extends Module {
  static id = 'inventory';
  static label = 'Inventory';
  static scope = 'chat';

  async init() {
    const href = new URL('./inventory.css', import.meta.url).href;
    if (!document.querySelector('link[data-showtime="inventory"]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.dataset.showtime = 'inventory';
      document.head.appendChild(link);
    }
    if (!this._starSyncBound) {
      this._starSyncBound = true;
      this.bus.on('inventory.updated', () => {
        this._syncStarLoadout();
        if (this.container && this.state.handoffSeed?.applied) this.render(this.container);
      });
      // The turn receipt already files item moves. A second inventory
      // audit here was another model call on the same lines.
    }
    this._pendingUseId = null;
    const amountSmoke = smokeInvAmountPure() || smokeKitNestPure() || smokeItemLocatorPure();
    if (amountSmoke) console.warn('[Showtime/Inventory] smoke failed:', amountSmoke);
    this._registerInjections();
    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, (messageId) => {
      if (this._pendingUseId) {
        this._pendingUseId = null;
        this.bus.emit('showtime.stateChanged');
      }
      this._readPendingHandoff(messageId);
      // Cast-initiated: scan the message that just rendered for an NPC
      // offering/using/forcing/giving an item onto {{user}}. Dedupe by chat
      // length so re-renders of the same message don't rescan it.
      const chatLen = (getContext().chat ?? []).length;
      if (chatLen !== this._lastIncomingScanLen) {
        this._lastIncomingScanLen = chatLen;
        this._scanIncomingOffer();
      }
    });
    eventSource.on(event_types.MESSAGE_SENT, () => { /* receipt cadence owns filing */ });
    eventSource.on(event_types.MESSAGE_SWIPED, () => clearTimeout(this._invTrackTimer));
  }

  getDefaultState() {
    return { static: [], mobile: [], currency: {}, openBoxes: [], pending: null, incoming: null, lastExchange: null, handoffSeed: null };
  }

  _migrate() {
    const s = this.state;
    let changed = false;
    if (Array.isArray(s.onPerson) && !s.mobile?.length) {
      s.mobile = s.onPerson;
      delete s.onPerson;
      changed = true;
    }
    if (Array.isArray(s.storage) && !s.static?.length) {
      s.static = s.storage;
      delete s.storage;
      changed = true;
    }
    if (!Array.isArray(s.static)) { s.static = []; changed = true; }
    if (!Array.isArray(s.mobile)) { s.mobile = []; changed = true; }
    if (!Array.isArray(s.openBoxes)) { s.openBoxes = []; changed = true; }
    if (!s.currency) { s.currency = {}; changed = true; }
    if (s.pending === undefined) { s.pending = null; changed = true; }
    if (s.incoming === undefined) { s.incoming = null; changed = true; }
    if (s.lastExchange === undefined) { s.lastExchange = null; changed = true; }
    if (s.handoffSeed === undefined) { s.handoffSeed = null; changed = true; }
    for (const loc of ['static', 'mobile']) {
      for (const x of this._list(loc)) {
        const before = JSON.stringify({ amount: x.amount ?? null, fill: x.fill || '' });
        if (!amountAllowed(x)) {
          if (x.amount || x.fill) clearAmount(x);
        } else {
          const a = readAmount(x);
          if (a) writeAmount(x, a);
          else if (x.amount || x.fill) {
            delete x.amount;
            delete x.fill;
          }
        }
        const after = JSON.stringify({ amount: x.amount ?? null, fill: x.fill || '' });
        if (before !== after) changed = true;
      }
    }
    stampInventoryLocators(s, { ownerId: this._starChar()?.id });
    if (changed) this.saveState();
  }

  _chatToken() {
    try { return getContext()?.chatMetadata ?? null; } catch { return null; }
  }

  _chatTokenStillValid(token) {
    return this._chatToken() === token;
  }

  async onChatChanged() {
    this._lastIncomingScanLen = -1;
    this._resetInvTrackCursor();
  }

  _starChar() {
    const state = this.storage.getChat('cast', { characters: [] });
    return (state.characters ?? []).find(c => c.priority === 'star') ?? null;
  }

  _playerName() {
    const star = getStarMember(this.storage);
    if (star?.name) return String(star.name).trim();
    const ctx = getContext();
    return String(ctx?.name1 || ctx?.personaName || 'You').trim() || 'You';
  }

  _list(location) {
    return location === 'mobile' ? this.state.mobile : this.state.static;
  }

  _find(id) {
    for (const loc of ['static', 'mobile']) {
      const item = this._list(loc).find(x => x.id === id);
      if (item) return { item, location: loc };
    }
    return null;
  }

  _children(location, parentId) {
    return this._list(location).filter(x => (x.parentId ?? null) === parentId);
  }

  _itemLoc(item) {
    const list = this.state.static.includes(item) ? 'static' : 'mobile';
    return deriveLocator(item, { list, ownerId: this._starChar()?.id || 'star' });
  }

  _placePhrase(item) {
    const hint = {
      list: this.state.static.includes(item) ? 'static' : 'mobile',
      ownerId: this._starChar()?.id || 'star',
    };
    const world = { inventory: this.state, characters: [], compass: {} };
    return formatItemPlace(item, hint, world);
  }

  _descendants(location, containerId) {
    const list = this._list(location);
    const ids = new Set([containerId]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const x of list) {
        if (x.parentId && ids.has(x.parentId) && !ids.has(x.id)) {
          ids.add(x.id);
          grew = true;
        }
      }
    }
    ids.delete(containerId);
    return [...ids];
  }

  async render(container) {
    this.container = container;
    this._closeItemMenu();
    this._migrate();
    this._syncStarLoadout();
    const player = this._playerName();
    const star = this._starChar();
    const wornInv = [...this.state.static, ...this.state.mobile].filter(x =>
      this._itemLoc(x).where === 'worn',
    );
    const worn = wornInv;

    container.innerHTML = `
      <div class="inv-root">
        <div class="inv-vanity-inner">
        <div class="inv-head">
          <div class="inv-head-row">
            <div class="inv-player">${esc(player)}</div>
            <button type="button" class="inv-audit" data-action="audit" title="Audit belongings from {{user}} messages">Audit</button>
          </div>
          <div class="inv-hint">${star
            ? 'Star tracker — mention an item by name to cue it in the scene.'
            : 'Cast this persona as Star to track wardrobe and stats like a Lead.'}</div>
          <div class="inv-worn">
            <div class="inv-worn-label">Equipped</div>
            ${worn.length
              ? `<div class="inv-worn-chips">${worn.map(w =>
                  `<span class="inv-worn-chip">${esc(w.name)}</span>`).join('')}</div>`
              : `<div class="inv-worn-empty">Nothing equipped on ${esc(player)}.</div>`}
          </div>
        </div>
        ${this._renderPendingBanner()}
        ${this._renderIncomingBanner()}
        ${this._renderUndoBanner()}
        <div class="inv-cols">
          ${this._renderColumn('static')}
          ${this._renderColumn('mobile')}
        </div>
        </div>
      </div>
    `;

    container.querySelector('[data-action="audit"]')?.addEventListener('click', e => {
      this._runAudit(e.currentTarget);
    });
    container.querySelector('[data-action="pending-cancel"]')?.addEventListener('click', () => {
      this._cancelPending();
    });
    container.querySelector('[data-action="pending-accept"]')?.addEventListener('click', () => {
      this._commitHandoff('take', this.state.pending?.mesId);
    });
    container.querySelector('[data-action="pending-consume"]')?.addEventListener('click', () => {
      this._commitHandoff('use', this.state.pending?.mesId);
    });
    container.querySelector('[data-action="pending-leave"]')?.addEventListener('click', () => {
      this._commitHandoff('refuse', this.state.pending?.mesId);
    });
    container.querySelector('[data-action="incoming-accept"]')?.addEventListener('click', () => {
      const damage = container.querySelector('[data-incoming-field="damage"]')?.value || 'none';
      this._applyIncomingResolution('accept_transfer', damage);
    });
    container.querySelector('[data-action="incoming-leave"]')?.addEventListener('click', () => {
      this._applyIncomingResolution('reject', 'none');
    });
    container.querySelector('[data-action="undo-exchange"]')?.addEventListener('click', () => {
      this._undoExchange();
    });
    container.querySelector('[data-action="incoming-dismiss"]')?.addEventListener('click', () => {
      const name = this.state.incoming?.itemName;
      this.state.incoming = null;
      this.saveState();
      if (name) this._emitInvNotice([{ name, label: 'Offer', toState: 'rejected', mark: 'X' }]);
      this.render(this.container);
    });
    container.querySelectorAll('[data-action="add"]').forEach(btn => {
      btn.addEventListener('click', () => this._openAddDialog(btn.dataset.location));
    });
    container.querySelectorAll('[data-action="use-item"]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const found = this._find(btn.dataset.id);
        if (found) this._runItemAction('use', found.item.id, found.location);
      });
    });
    container.querySelectorAll('[data-action="move-item"]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const found = this._find(btn.dataset.id);
        if (found) this._runItemAction('move', found.item.id, found.location);
      });
    });
    container.querySelectorAll('[data-action="item-menu"]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const found = this._find(btn.dataset.id);
        if (found) this._openItemMenu(btn, found.item, found.location);
      });
    });
    container.querySelectorAll('[data-action="toggle-box"]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        this._toggleBox(btn.dataset.id);
      });
    });
  }

  _renderColumn(location) {
    const loc = LOCS[location];
    if (location === 'static') {
      const roots = this._children('static', null);
      const here = roots.filter(x => this._itemLoc(x).where === 'room');
      const trunk = roots.filter(x => this._itemLoc(x).where !== 'room');
      const trunkBody = trunk.length
        ? trunk.map(x => this._renderEntry('static', x)).join('')
        : `<div class="inv-empty">Empty</div>`;
      return `
      <div class="inv-col" data-location="static">
        ${here.length ? `
        <div class="inv-col-head">
          <div class="inv-col-title">Here</div>
          <div class="inv-col-sub">Left in the scene</div>
        </div>
        <div class="inv-col-body inv-col-body--here">${this._renderHereGroups(here)}</div>` : ''}
        <div class="inv-col-head">
          <div class="inv-col-title">${esc(loc.title)}</div>
          <div class="inv-col-sub">${esc(loc.sub)}</div>
        </div>
        <div class="inv-col-body">
          ${trunkBody}
          <button class="inv-add" data-action="add" data-location="static">+ Add</button>
        </div>
      </div>`;
    }
    const roots = this._children(location, null);
    const body = roots.length
      ? roots.map(x => this._renderEntry(location, x)).join('')
      : `<div class="inv-empty">Empty</div>`;
    return `
      <div class="inv-col" data-location="${location}">
        <div class="inv-col-head">
          <div class="inv-col-title">${esc(loc.title)}</div>
          <div class="inv-col-sub">${esc(loc.sub)}</div>
        </div>
        <div class="inv-col-body">
          ${body}
          <button class="inv-add" data-action="add" data-location="${location}">+ Add</button>
        </div>
      </div>
    `;
  }

  _renderHereGroups(roots) {
    const groups = new Map();
    for (const x of roots) {
      const surface = this._itemLoc(x).surface || 'in the room';
      if (!groups.has(surface)) groups.set(surface, []);
      groups.get(surface).push(x);
    }
    return [...groups.entries()].map(([surface, items]) => `
      <div class="inv-surface-label">${esc(surface)}</div>
      ${items.map(x => this._renderEntry('static', x)).join('')}
    `).join('');
  }

  _renderEntry(location, item, nested = false) {
    const isContainer = item.kind === 'container';
    const cat = CATEGORY_MAP[item.category];
    const cond = CONDITION_MAP[item.condition] ?? CONDITION_MAP.pristine;
    const border = isContainer ? (cond.color ?? CONTAINER_COLOR) : (cat?.color ?? '#8a8474');
    const equipped = item.equippedTo
      ? item.equippedTo.type === 'player'
        ? `Equipped · ${this._playerName()}`
        : `Equipped · ${item.equippedTo.name || 'cast'}`
      : '';
    const kids = isContainer ? this._children(location, item.id) : [];
    const open = isContainer && (this.state.openBoxes ?? []).includes(item.id);
    const fold = isContainer
      ? `<button type="button" class="inv-fold" data-action="toggle-box" data-id="${item.id}" title="${open ? 'Collapse' : 'Expand'}">${open ? '▾' : '▸'}</button>`
      : '';
    const count = isContainer && kids.length && !open
      ? `<span class="inv-item-meta-inline">${kids.length} inside</span>`
      : '';
    const condBadge = (isContainer || (item.condition && item.condition !== 'pristine'))
      ? `<span class="inv-item-cond" style="background:${cond.color}">${esc(cond.label)}</span>`
      : '';
    const amt = readAmount(item);
    const fillLine = formatAmountLine(item);
    const fillBadge = fillLine
      ? `<span class="inv-item-fill" style="background:${FILL_MAP[amt?.fill]?.color ?? '#8a8474'}">${esc(fillLine)}</span>`
      : '';
    const catBadge = isContainer
      ? ''
      : `<span class="inv-item-cat" style="background:${cat?.color ?? '#8a8474'}">${esc(cat?.label ?? 'Item')}</span>`;
    const canUse = !isContainer || hasAmount(item);
    const actions = `
      ${canUse ? `<button type="button" class="inv-row-act" data-action="use-item" data-id="${item.id}">Use</button>` : ''}
      <button type="button" class="inv-row-act" data-action="move-item" data-id="${item.id}">Move</button>`;

    return `
      <div class="inv-item${nested ? ' inv-item--in' : ''}${isContainer ? ' inv-item--box' : ''}" style="border-left-color:${border}">
        <div class="inv-item-row">
          ${fold}
          <span class="inv-item-name">${isContainer ? '▣ ' : ''}${esc(item.name)}</span>
          ${count}
          ${catBadge}
          ${condBadge}
          ${fillBadge}
          ${actions}
          <button type="button" class="inv-kebab" data-action="item-menu" data-id="${item.id}" title="Actions" aria-label="Item actions">···</button>
        </div>
        ${item.description ? `<div class="inv-item-desc">${esc(item.description)}</div>` : ''}
        ${equipped ? `<div class="inv-item-meta">${esc(equipped)}</div>` : ''}
      </div>
      ${isContainer && open ? kids.map(k => this._renderEntry(location, k, true)).join('') : ''}
    `;
  }

  _renderPendingBanner() {
    const p = this.state.pending;
    if (!p) return '';
    const verbInfo = USE_VERB_MAP[p.verb] || USE_VERB_MAP.use;
    if (!p.ready && !p.resolved) {
      return `
        <div class="inv-pending">
          <div class="inv-pending-head">Awaiting ${esc(p.targetName)}'s response — you're ${esc(verbInfo.phrase)} “${esc(p.itemName)}” on them</div>
          <div class="inv-pending-row">
            <button type="button" class="inv-btn" data-action="pending-cancel">Cancel</button>
          </div>
        </div>`;
    }
    return `
      <div class="inv-pending">
        <div class="inv-pending-head">${esc(p.targetName)} has answered. Take “${esc(p.itemName)}”, mark it used up, or leave it.</div>
        <div class="inv-pending-row">
          <button type="button" class="inv-btn" data-action="pending-accept">Accept</button>
          <button type="button" class="inv-btn" data-action="pending-consume">Used up</button>
          <button type="button" class="inv-btn" data-action="pending-leave">Leave it</button>
          <select data-pending-field="damage" title="Only if the reply broke it">
            <option value="none" selected>No damage</option>
            <option value="damaged">Damaged</option>
            <option value="destroyed">Destroyed</option>
          </select>
        </div>
      </div>`;
  }

  _renderIncomingBanner() {
    const inc = this.state.incoming;
    if (!inc) return '';
    const verbInfo = USE_VERB_MAP[inc.verb] || USE_VERB_MAP.offer;
    return `
      <div class="inv-pending inv-pending--incoming">
        <div class="inv-pending-head">${esc(inc.npcName)} is ${esc(verbInfo.phrase)} “${esc(inc.itemName)}”${inc.itemDesc ? ` — <em>${esc(inc.itemDesc)}</em>` : ''}</div>
        <div class="inv-pending-row">
          <button type="button" class="inv-btn" data-action="incoming-accept">Accept</button>
          <button type="button" class="inv-btn" data-action="incoming-leave">Leave it</button>
          <select data-incoming-field="damage" title="Only if it broke">
            <option value="none" selected>No damage</option>
            <option value="damaged">Damaged</option>
            <option value="destroyed">Destroyed</option>
          </select>
        </div>
      </div>`;
  }

  _renderUndoBanner() {
    const seed = this.state.handoffSeed;
    const ex = seed?.applied && seed.note
      ? { note: seed.note }
      : this.state.lastExchange;
    if (!ex?.note) return '';
    return `
      <div class="inv-pending">
        <div class="inv-pending-head">${esc(ex.note)}</div>
        <div class="inv-pending-row">
          <button type="button" class="inv-btn" data-action="undo-exchange">Undo</button>
        </div>
      </div>`;
  }

  _closeItemMenu() {
    document.querySelectorAll('.inv-menu-pop').forEach(el => el.remove());
    if (this._menuCloser) {
      document.removeEventListener('pointerdown', this._menuCloser, true);
      document.removeEventListener('mousedown', this._menuCloser, true);
      document.removeEventListener('keydown', this._menuKeyCloser, true);
      this._menuCloser = null;
      this._menuKeyCloser = null;
    }
  }

  _openItemMenu(btn, item, location) {
    this._closeItemMenu();
    const canEquip = item.kind !== 'container' && item.category === 'wearable';
    const canUse = item.kind !== 'container' || hasAmount(item);
    const pop = document.createElement('div');
    pop.className = 'inv-menu-pop';
    pop.innerHTML = `
      ${canUse ? `<button type="button" data-act="use">Use…</button>` : ''}
      ${canEquip ? `<button type="button" data-act="${item.equippedTo ? 'unequip' : 'equip'}">${item.equippedTo ? 'Unequip' : 'Equip'}</button>` : ''}
      <button type="button" data-act="move">${esc(LOCS[location === 'mobile' ? 'static' : 'mobile'].moveTo)}</button>
      <button type="button" data-act="edit">Edit</button>
      <button type="button" data-act="remove" class="danger">Remove</button>
    `;
    document.body.appendChild(pop);
    const r = btn.getBoundingClientRect();
    const w = pop.offsetWidth;
    const left = Math.min(Math.max(8, r.right - w), window.innerWidth - w - 8);
    const top = r.bottom + 6;
    pop.style.left = `${left}px`;
    pop.style.top = `${Math.min(top, window.innerHeight - pop.offsetHeight - 8)}px`;
    pop.addEventListener('click', e => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (!act) return;
      this._closeItemMenu();
      this._runItemAction(act, item.id, location);
    });
    // Capture phase: Showtime marquee stops mousedown bubbling, so bubble
    // listeners on document never see clicks inside the panel.
    this._menuCloser = ev => {
      if (pop.contains(ev.target) || btn.contains(ev.target)) return;
      this._closeItemMenu();
    };
    this._menuKeyCloser = ev => {
      if (ev.key === 'Escape') this._closeItemMenu();
    };
    setTimeout(() => {
      document.addEventListener('pointerdown', this._menuCloser, true);
      document.addEventListener('mousedown', this._menuCloser, true);
      document.addEventListener('keydown', this._menuKeyCloser, true);
    }, 0);
  }

  _itemPolicy() {
    try {
      return this.storage.getChat('backstage', {})?.trackers?.items || {};
    } catch {
      return {};
    }
  }

  _runItemAction(act, id, location) {
    const pol = this._itemPolicy();
    if (pol.enabled === false && (act === 'use' || act === 'remove' || act === 'equip' || act === 'unequip' || act === 'move')) {
      void showtimeAlert('Item tracking is disabled under Stage → Trackers → Items.', { title: 'INVENTORY' });
      return;
    }
    if (act === 'use') {
      if (pol.castCanUse === false) { void showtimeAlert('Item use is disabled under Stage → Trackers → Items.', { title: 'INVENTORY' }); return; }
      this._openUseDialog(id, location);
    }
    else if (act === 'edit') this._openEditDialog(id);
    else if (act === 'remove') {
      if (pol.castCanDelete === false) { void showtimeAlert('Deleting items is disabled under Stage → Trackers → Items.', { title: 'INVENTORY' }); return; }
      void this._remove(id);
    }
    else if (act === 'equip') this._openEquipDialog(id);
    else if (act === 'unequip') this._unequip(id);
    else if (act === 'move') {
      const dest = location === 'mobile' ? 'static' : 'mobile';
      this._moveTo(id, dest);
    }
  }

  _useSelf(id, spend = 1) {
    const found = this._find(id);
    if (!found) return;
    if (found.item.kind === 'container' && !hasAmount(found.item)) return;
    let spent = 0;
    let noticed = false;
    if (hasAmount(found.item)) {
      spent = spendAmount(found.item, spend).spent;
      this.saveState();
      this.bus.emit('inventory.updated');
      if (spent > 0) noticed = this._nudgeStarFromPack(found.item, spent);
    }
    if (!noticed) {
      this._emitInvNotice([{ name: found.item.name, label: 'Used', toState: 'used', mark: '!' }]);
    }
    this._pendingUseId = id;
    this.bus.emit('showtime.stateChanged');
    if (this.container) this.render(this.container);
  }

  _nudgeStarFromPack(item, spent) {
    if (!spent) return false;
    const kind = careKind(item);
    if (kind !== 'food' && kind !== 'drink') return false;
    const star = this._starChar() || getStarMember(this.storage);
    if (!star?.stats?.enabled || !star.stats.hardMode) return false;
    let difficulty = 'normal';
    try { difficulty = this.storage.getChat('backstage', {})?.trackers?.status?.difficulty || 'normal'; } catch { /* ignore */ }
    const id = kind === 'drink' ? 'thirst' : 'hunger';
    const def = STAT_DEFS.hard.find(d => d.id === id);
    const current = Math.max(0, Math.min(100, Number(star.stats[id] ?? 100) || 0));
    const bump = Math.min(18, 8 + Math.min(Number(spent) || 1, 3) * 3);
    const proposed = Math.min(100, current + bump);
    const val = applyDifficultyToStat(current, proposed, { difficulty, direction: 'up' });
    if (val === current) return false;
    const from = def ? stateLabel(def, current) : '';
    const to = def ? stateLabel(def, val) : '';
    star.stats[id] = val;
    star.updatedAt = Date.now();
    this.storage.saveChat();
    this.bus.emit('cast.updated', { character: star });
    this.bus.emit('showtime.notice', {
      kind: 'status',
      items: [{
        name: star.name || this._playerName(),
        label: def?.label || 'Used',
        fromState: from,
        toState: to,
        threshold: !!(from && to && from !== to),
      }],
    });
    return true;
  }

  /** Target + verb picker for using/offering/forcing/giving an item to a cast member. */
  _openUseDialog(id, location) {
    const found = this._find(id);
    if (!found) return;
    const player = this._playerName();
    const members = getCastMembers(this.storage).filter(c => c.priority !== 'director' && c.priority !== 'star');
    const counted = hasAmount(found.item);
    const fillLine = formatAmountLine(found.item);
    const hints = {
      offer: 'Injects a note offering the item, then waits for their in-character reply to accept or reject.',
      use: 'Injects a note using the item on them, then waits for their in-character reply to accept or reject.',
      force: 'Injects a note forcing the item on them — they may still resist in their reply.',
      give: 'Transfers the item to them immediately. No reply needed.',
    };
    const backdrop = this._buildModal(`
      <div class="inv-modal-title">USE ITEM</div>
      <div class="inv-modal-subtitle">— ${esc(found.item.name)}${fillLine ? ` · ${esc(fillLine)}` : ''} —</div>
      <div class="inv-modal-field">
        <label>Target</label>
        <select data-field="target">
          <option value="self">Yourself · ${esc(player)}</option>
          ${members.map(m => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('')}
        </select>
      </div>
      ${counted ? `
      <div class="inv-modal-field" data-spend-wrap>
        <label>Spend</label>
        <input type="number" data-field="spend" min="1" step="1" value="1">
        <div class="inv-modal-hint">How much to use from this pack. Empty packs stay on the list.</div>
      </div>` : ''}
      <div class="inv-modal-field" data-verb-wrap style="display:none">
        <label>Action</label>
        <div class="inv-cat-row">
          ${USE_VERBS.map(v => `<button type="button" class="inv-cat-btn" data-verb="${v.id}">${esc(v.label)}</button>`).join('')}
        </div>
        <div class="inv-modal-hint" data-verb-hint></div>
      </div>
      <div class="inv-modal-actions">
        <button class="inv-btn" data-action="cancel">Cancel</button>
        <button class="inv-btn" data-action="save">Use</button>
      </div>
    `);
    let target = 'self';
    let verb = null;
    const verbWrap = backdrop.querySelector('[data-verb-wrap]');
    const spendWrap = backdrop.querySelector('[data-spend-wrap]');
    const saveBtn = backdrop.querySelector('[data-action="save"]');
    const sync = () => {
      backdrop.querySelectorAll('[data-verb]').forEach(b => b.classList.toggle('on', b.dataset.verb === verb));
      backdrop.querySelector('[data-verb-hint]').textContent = verb ? hints[verb] : '';
      saveBtn.textContent = verb === 'give' ? 'Give' : (verb ? 'Propose' : 'Use');
      saveBtn.disabled = target !== 'self' && !verb;
      if (spendWrap) spendWrap.style.display = target === 'self' ? '' : 'none';
    };
    backdrop.querySelector('[data-field="target"]').addEventListener('change', e => {
      target = e.target.value;
      verbWrap.style.display = target === 'self' ? 'none' : '';
      if (target === 'self') verb = null;
      sync();
    });
    backdrop.querySelectorAll('[data-verb]').forEach(b => {
      b.addEventListener('click', () => { verb = b.dataset.verb; sync(); });
    });
    sync();
    backdrop.querySelector('[data-action="cancel"]').addEventListener('click', () => backdrop.remove());
    backdrop.addEventListener('click', e => { if (e.target === backdrop) backdrop.remove(); });
    backdrop.querySelector('[data-action="save"]').addEventListener('click', () => {
      if (target === 'self') {
        const rawSpend = Number(backdrop.querySelector('[data-field="spend"]')?.value);
        const spend = Number.isFinite(rawSpend) && rawSpend > 0 ? rawSpend : 1;
        backdrop.remove();
        this._useSelf(id, spend);
        return;
      }
      if (!verb) return;
      if (verb === 'give') {
        backdrop.remove();
        this._giveToCast(id, location, target);
        return;
      }
      backdrop.remove();
      this._proposeUse(id, location, target, verb);
    });
  }

  /** Immediate, unconditional hand-off — no narrative confirmation needed. */
  async _giveToCast(id, location, characterId) {
    const found = this._find(id);
    if (!found) return;
    const cast = this.storage.getChat('cast', { characters: [] });
    const char = (cast.characters ?? []).find(c => c.id === characterId);
    if (!char) { void showtimeAlert('That cast member is gone.', { title: 'INVENTORY' }); return; }
    if (!await showtimeConfirm(`Give ${found.item.name} to ${char.name}?`, { title: 'GIVE BELONGING', confirmLabel: 'Give' })) return;
    this._captureExchange(`Gave ${found.item.name} to ${char.name}.`);
    const world = worldFromStorage(this.storage);
    const wearable = found.item.category === 'wearable' && found.item.kind !== 'container';
    const moved = moveItem(world, id, {
      where: wearable ? 'worn' : 'carried',
      ownerId: char.id,
    }, { reason: `given to ${char.name}` });
    if (!moved.ok) this._transferItemToCast(found.item, found.location, char);
    this.saveState();
    this.bus.emit('inventory.updated');
    this.render(this.container);
  }

  /** Moves (or removes, on destroy) an item from Star's lists into a cast member's belongings. */
  _transferItemToCast(item, location, char, { damage = 'none' } = {}) {
    const dropIds = [item.id, ...this._descendants(location, item.id)];
    if (damage === 'destroyed') {
      this.state[location] = this._list(location).filter(x => !dropIds.includes(x.id));
      return;
    }
    const batch = this._list(location).filter(x => dropIds.includes(x.id));
    const idMap = new Map(batch.map(src => [src.id, uid()]));
    for (const src of batch) {
      const condition = damage === 'damaged' ? 'damaged' : (src.condition || 'pristine');
      const nested = !!(src.parentId && idMap.has(src.parentId));
      const row = {
        id: idMap.get(src.id),
        name: src.name,
        description: src.description || '',
        condition,
        kind: inferKitKind(src),
        parentId: nested ? idMap.get(src.parentId) : null,
      };
      const amt = readAmount(src);
      if (amt) writeAmount(row, amt);
      const toWardrobe = !nested && src.category === 'wearable' && src.kind !== 'container';
      const bucket = toWardrobe ? (char.wardrobe ??= []) : (char.props ??= []);
      bucket.push(row);
    }
    char.updatedAt = Date.now();
    this.bus.emit('cast.updated', { character: char });
    this.state[location] = this._list(location).filter(x => !dropIds.includes(x.id));
  }

  /** Offer / Use / Force — injects a note and waits for the target's in-character reply. */
  _proposeUse(id, location, characterId, verb) {
    const found = this._find(id);
    if (!found) return;
    const cast = this.storage.getChat('cast', { characters: [] });
    const char = (cast.characters ?? []).find(c => c.id === characterId);
    if (!char) { void showtimeAlert('That cast member is gone.', { title: 'INVENTORY' }); return; }
    this.state.pending = {
      id: uid(),
      itemId: found.item.id,
      itemName: found.item.name,
      itemDesc: found.item.description || '',
      itemCategory: found.item.category || 'misc',
      location: found.location,
      targetCharacterId: char.id,
      targetName: char.name,
      verb,
      playerName: this._playerName(),
      proposedAt: Date.now(),
      classifying: false,
      ready: false,
      resolved: null,
      classifyFailed: false,
    };
    this.saveState();
    this.bus.emit('showtime.stateChanged');
    this._emitInvNotice([{
      name: this.state.pending.itemName,
      label: verb === 'give' ? 'Give' : 'Offer',
      toState: 'pending',
      mark: '?',
    }]);
    this.render(this.container);
  }

  _cancelPending() {
    this.state.pending = null;
    this.saveState();
    this.render(this.container);
  }

  /** The reply already happened. The desk decides; this does not call the model. */
  _markPendingReady() {
    const pending = this.state.pending;
    if (!pending || pending.ready || pending.resolved) return;
    pending.ready = true;
    this.saveState();
  }

  _aimedAtSpeaker(pending, mes) {
    if (!pending || !mes || mes.is_user || mes.is_system) return false;
    const speaker = resolveChatSpeaker(this.storage, mes, getContext());
    if (!speaker) return false;
    if (pending.targetCharacterId && speaker.id === pending.targetCharacterId) return true;
    const said = String(speaker.name || '').trim().toLowerCase();
    const aimed = String(pending.targetName || '').trim().toLowerCase();
    return !!said && said === aimed;
  }

  _receiptOn(mesId) {
    const mes = getContext()?.chat?.[mesId];
    return !!mes?.extra?.showtimeReceipt;
  }

  _undoOpFor(found, outcome) {
    const item = found?.item;
    const name = String(item?.name || '').trim();
    if (!name) return null;
    if (outcome === 'use') {
      return {
        name,
        action: 'add',
        where: found.location === 'static' ? 'trunk' : 'carried',
        owner: 'star',
        kind: item.kind,
        category: item.category,
        reason: 'undo handoff',
      };
    }
    return {
      name,
      action: 'move',
      where: item.equippedTo ? 'worn' : (found.location === 'static' ? 'trunk' : 'carried'),
      owner: 'star',
      reason: 'undo handoff',
    };
  }

  /** Read take, use, or refuse only while this offer is aimed at the speaker. */
  _readPendingHandoff(messageId) {
    const pending = this.state.pending;
    if (!pending || pending.ready || pending.resolved) return;
    const chat = getContext()?.chat || [];
    const hinted = Number(messageId);
    const mes = Number.isFinite(hinted) ? chat[hinted] : chat[chat.length - 1];
    if (!this._aimedAtSpeaker(pending, mes)) return;
    const mesId = chat.indexOf(mes);
    const outcome = readHandoffSentence(mes.mes, pending.itemName);
    if (!outcome) {
      pending.ready = true;
      pending.mesId = mesId;
      this.saveState();
      if (this.container) this.render(this.container);
      return;
    }
    this._commitHandoff(outcome, mesId);
  }

  /** Seed the receipt item op. Apply it now only if this message already has a receipt. */
  _commitHandoff(outcome, mesId) {
    const pending = this.state.pending;
    if (!pending) return;
    if (outcome === 'refuse') {
      const name = pending.itemName;
      this.state.pending = null;
      this.saveState();
      this._emitInvNotice([{ name, label: 'Offer', toState: 'rejected', mark: 'X' }]);
      if (this.container) this.render(this.container);
      return;
    }
    const found = this._find(pending.itemId);
    const wearable = found?.item?.category === 'wearable' && found.item.kind !== 'container';
    const op = handoffItemOp({
      itemName: pending.itemName,
      wearable,
      owner: pending.targetName,
      outcome,
    });
    if (!op) return;
    const seed = {
      op,
      undo: this._undoOpFor(found, outcome),
      mesId,
      applied: false,
      note: outcome === 'use'
        ? `Used up ${pending.itemName}.`
        : `Gave ${pending.itemName} to ${pending.targetName}.`,
    };
    this.state.pending = null;
    if (this._receiptOn(mesId)) {
      fileOneHandoff(this.storage, seed);
      seed.applied = true;
    }
    this.state.handoffSeed = seed;
    this.saveState();
    this.bus.emit('inventory.updated');
    if (this.container) this.render(this.container);
  }

  _captureExchange(note) {
    let kits = [];
    try {
      const cast = this.storage.getChat('cast', { characters: [] });
      kits = (cast.characters || []).map(c => ({
        id: c.id,
        props: structuredClone(c.props || []),
        wardrobe: structuredClone(c.wardrobe || []),
      }));
    } catch { /* cast missing */ }
    this.state.lastExchange = {
      at: Date.now(),
      note: String(note || '').slice(0, 160),
      static: structuredClone(this.state.static || []),
      mobile: structuredClone(this.state.mobile || []),
      kits,
    };
  }

  _undoExchange() {
    const seed = this.state.handoffSeed;
    if (seed?.applied && seed.undo) {
      rewindOneHandoff(this.storage, seed);
      this.state.handoffSeed = null;
      this.saveState();
      this.bus.emit('inventory.updated');
      this.render(this.container);
      return;
    }
    const snap = this.state.lastExchange;
    if (!snap) return;
    this.state.static = Array.isArray(snap.static) ? snap.static : [];
    this.state.mobile = Array.isArray(snap.mobile) ? snap.mobile : [];
    try {
      const cast = this.storage.getChat('cast', { characters: [] });
      for (const kit of snap.kits || []) {
        const char = (cast.characters || []).find(c => c.id === kit.id);
        if (!char) continue;
        char.props = kit.props || [];
        char.wardrobe = kit.wardrobe || [];
        char.updatedAt = Date.now();
        this.bus.emit('cast.updated', { character: char });
      }
    } catch { /* cast missing */ }
    this.state.lastExchange = null;
    this.saveState();
    this.bus.emit('inventory.updated');
    this.render(this.container);
  }

  /** Commits the desk's choice and keeps one Undo snapshot. */
  _applyPendingResolution(outcome, damage) {
    const pending = this.state.pending;
    if (!pending) return;
    const found = this._find(pending.itemId);
    const moves = outcome === 'accept_transfer' || outcome === 'accept_consume'
      || damage === 'destroyed' || damage === 'damaged';
    if (found && moves) {
      const note = outcome === 'accept_consume' || damage === 'destroyed'
        ? `Used up ${pending.itemName}.`
        : outcome === 'accept_transfer'
          ? `Gave ${pending.itemName} to ${pending.targetName}.`
          : `Marked ${pending.itemName} damaged.`;
      this._captureExchange(note);
    }
    if (found) {
      if (outcome === 'accept_transfer') {
        const cast = this.storage.getChat('cast', { characters: [] });
        const char = (cast.characters ?? []).find(c => c.id === pending.targetCharacterId);
        if (char) this._transferItemToCast(found.item, found.location, char, { damage });
        else void showtimeAlert('That cast member is gone — item stays with you.', { title: 'INVENTORY' });
      } else if (outcome === 'accept_consume') {
        this.state[found.location] = this._list(found.location).filter(x => x.id !== found.item.id);
      } else if (damage === 'destroyed') {
        this.state[found.location] = this._list(found.location).filter(x => x.id !== found.item.id);
      } else if (damage === 'damaged') {
        found.item.condition = 'damaged';
      }
    }
    this.state.pending = null;
    this.saveState();
    this.bus.emit('inventory.updated');
    if (outcome === 'accept_transfer') {
      this._emitInvNotice([{ name: pending.itemName, label: 'Inventory', toState: 'moved', mark: '!' }]);
    } else if (outcome === 'accept_consume' || damage === 'destroyed') {
      this._emitInvNotice([{ name: pending.itemName, label: 'Inventory', toState: 'removed', mark: 'X' }]);
    } else if (outcome === 'reject') {
      this._emitInvNotice([{ name: pending.itemName, label: 'Offer', toState: 'rejected', mark: 'X' }]);
    } else if (damage === 'damaged') {
      this._emitInvNotice([{ name: pending.itemName, label: 'Inventory', toState: 'changed', mark: '!' }]);
    }
    this.render(this.container);
  }

  /**
   * Cast-initiated direction: scan the message that just rendered for an NPC
   * offering/using/forcing/giving a physical item onto {{user}}. Gated by a
   * cheap regex so the quiet-prompt classification only fires on plausible
   * lines, never on every single message.
   */
  /** A tracked belonging named in an offer line. No model call. */
  _scanIncomingOffer() {
    if (this.state.incoming) return;
    const pol = this._itemPolicy();
    if (pol.enabled === false || pol.castCanUse === false || pol.npcCanOffer === false) return;

    const chat = getContext().chat ?? [];
    let mes = null;
    for (let i = chat.length - 1; i >= 0; i--) {
      if (chat[i] && !chat[i].is_user && !chat[i].is_system) { mes = chat[i]; break; }
    }
    const text = String(mes?.mes || '');
    if (!text || !OFFER_CUE_RE.test(text)) return;

    const speaker = resolveChatSpeaker(this.storage, {
      avatar: String(mes.original_avatar || '').trim(),
      spokenName: mes.name || '',
    });
    if (!speaker || speaker.priority === 'star' || speaker.priority === 'director') return;

    const low = text.toLowerCase();
    const belongings = [
      ...(speaker.props || []).map(item => ({ item, bucket: 'props' })),
      ...(speaker.wardrobe || []).map(item => ({ item, bucket: 'wardrobe' })),
    ];
    const hit = belongings.find(({ item }) => {
      const name = String(item?.name || '').trim();
      return name.length >= 3 && low.includes(name.toLowerCase());
    });
    if (!hit) return;

    const verb = /\b(forc\w*|hurls?)\b/i.test(text) ? 'force'
      : /\b(us(?:e|es|ing)|appl\w*)\b/i.test(text) ? 'use'
        : 'offer';
    const matched = hit.item;
    const nestList = hit.bucket === 'props' ? kitChildren(speaker.props, matched.id) : [];
    this.state.incoming = {
      id: uid(),
      npcCharacterId: speaker.id,
      npcName: speaker.name,
      verb,
      itemId: matched.id,
      itemBucket: hit.bucket,
      itemName: matched.name,
      itemDesc: matched.description || '',
      itemCategory: hit.bucket === 'wardrobe' ? 'wearable' : (matched.category || 'misc'),
      itemCondition: matched.condition || 'pristine',
      itemAmount: readAmount(matched),
      itemKind: inferKitKind(matched),
      itemNest: nestList.map(x => ({
        name: x.name,
        description: x.description || '',
        condition: x.condition || 'pristine',
        kind: inferKitKind(x),
        amount: readAmount(x),
      })),
      at: Date.now(),
    };
    this.saveState();
    this.bus.emit('showtime.stateChanged');
    this._emitInvNotice([{
      name: this.state.incoming.itemName,
      label: 'Offer',
      toState: 'pending',
      mark: '?',
    }]);
    if (this.container) this.render(this.container);
  }

  _applyIncomingResolution(outcome, damage) {
    const inc = this.state.incoming;
    if (!inc) return;
    if (outcome === 'accept_transfer' || outcome === 'accept_consume' || damage === 'damaged' || damage === 'destroyed') {
      const note = outcome === 'accept_consume' || damage === 'destroyed'
        ? `Used up ${inc.itemName}.`
        : outcome === 'accept_transfer'
          ? `Took ${inc.itemName}.`
          : `Marked ${inc.itemName} damaged.`;
      this._captureExchange(note);
    }
    const cast = this.storage.getChat('cast', { characters: [] });
    const npc = (cast.characters ?? []).find(c => c.id === inc.npcCharacterId);
    const removeFromNpc = () => {
      if (!npc || !inc.itemId || !inc.itemBucket) return;
      const list = npc[inc.itemBucket] ?? [];
      const drop = new Set([inc.itemId, ...kitDescendantIds(list, inc.itemId)]);
      npc[inc.itemBucket] = list.filter(x => !drop.has(x.id));
      npc.updatedAt = Date.now();
    };
    if (outcome === 'accept_transfer') {
      if (damage !== 'destroyed') {
        const condition = damage === 'damaged' ? 'damaged' : (inc.itemCondition || 'pristine');
        const parentRow = {
          id: uid(),
          kind: inc.itemKind === 'container' || (inc.itemNest || []).length ? 'container' : 'item',
          name: inc.itemName,
          description: inc.itemDesc || '',
          parentId: null,
          location: 'mobile',
          condition,
          category: inc.itemCategory || 'misc',
        };
        if (inc.itemAmount) writeAmount(parentRow, inc.itemAmount);
        this.state.mobile.push(parentRow);
        for (const kid of inc.itemNest || []) {
          const row = {
            id: uid(),
            kind: kid.kind === 'container' ? 'container' : 'item',
            name: kid.name,
            description: kid.description || '',
            parentId: parentRow.id,
            location: 'mobile',
            condition: damage === 'damaged' ? 'damaged' : (kid.condition || 'pristine'),
            category: 'misc',
          };
          if (kid.amount) writeAmount(row, kid.amount);
          this.state.mobile.push(row);
        }
      }
      removeFromNpc();
      if (npc) this.bus.emit('cast.updated', { character: npc });
    } else if (outcome === 'accept_consume') {
      removeFromNpc();
      if (npc) this.bus.emit('cast.updated', { character: npc });
    } else if (damage !== 'none' && npc && inc.itemId && inc.itemBucket) {
      const row = (npc[inc.itemBucket] ?? []).find(x => x.id === inc.itemId);
      if (row) {
        if (damage === 'destroyed') npc[inc.itemBucket] = npc[inc.itemBucket].filter(x => x.id !== inc.itemId);
        else row.condition = 'damaged';
        npc.updatedAt = Date.now();
        this.bus.emit('cast.updated', { character: npc });
      }
    }
    this.state.incoming = null;
    this.saveState();
    this.bus.emit('inventory.updated');
    if (outcome === 'accept_transfer' && damage !== 'destroyed') {
      this._emitInvNotice([{ name: inc.itemName, label: 'Inventory', toState: 'added', mark: 1 }]);
    } else if (outcome === 'reject') {
      this._emitInvNotice([{ name: inc.itemName, label: 'Offer', toState: 'rejected', mark: 'X' }]);
    } else if (outcome === 'accept_consume' || damage === 'destroyed') {
      this._emitInvNotice([{ name: inc.itemName, label: 'Inventory', toState: 'removed', mark: 'X' }]);
    } else if (damage === 'damaged') {
      this._emitInvNotice([{ name: inc.itemName, label: 'Inventory', toState: 'changed', mark: '!' }]);
    }
    this.render(this.container);
  }

  _registerInjections() {
    if (!this.injector) return;
    this.injector.register({
      id: 'inventory.items',
      always: true,
      buildText: () => this._buildItemInjection(),
    });
  }

  _userTranscript() {
    const chat = getContext().chat ?? [];
    const byUser = chat.filter(m => m.is_user);
    if (!byUser.length) return '';
    return byUser.slice(-20).map(m => `${m.name || 'You'}: ${m.mes ?? ''}`).join('\n').slice(-4000);
  }

  _inventoryRoster(scene = '') {
    const rows = [];
    for (const loc of ['mobile', 'static']) {
      for (const x of this._list(loc)) {
        const kind = x.kind === 'container' ? 'container' : 'item';
        const place = this._placePhrase(x);
        const amt = formatAmountLine(x);
        const fill = amt ? `, ${amt}` : '';
        rows.push(`- ${x.name} (${kind}, ${place}${fill})`);
      }
    }
    for (const line of this._worldKitLines({ scene, max: 20 })) rows.push(line);
    return rows.join('\n') || 'None';
  }

  _worldKitLines({ scene = '', max = 16 } = {}) {
    const rows = [];
    const cap = Math.max(4, Number(max) || 16);
    const hay = String(scene || '').toLowerCase();
    if (!hay.trim()) return rows;
    try {
      const compass = ensureCompass(this.storage.getChat('backstage', {}));
      const here = getActiveRoom(compass);
      for (const p of listLostAndFound(compass)) {
        const n = String(p.name || '').trim();
        if (!n) continue;
        if (n.length < 3 || !hay.includes(n.toLowerCase())) continue;
        rows.push(`- ${n} (lost & found)`);
        if (rows.length >= cap) return rows;
      }
      const pieces = listAllSetPieces(compass).filter(p => p.layer !== 'fixtures');
      const ordered = here?.id
        ? [...pieces.filter(p => p.placeId === here.id), ...pieces.filter(p => p.placeId !== here.id)]
        : pieces;
      for (const p of ordered) {
        const n = String(p.name || '').trim();
        if (!n) continue;
        const named = n.length >= 3 && hay.includes(n.toLowerCase());
        if (!named) continue;
        if (p.layer === 'furniture' && !named) continue;
        const where = p.placeName || 'set';
        rows.push(`- ${n} (on set · ${where} · ${p.layer})`);
        if (rows.length >= cap) break;
      }
    } catch { /* ignore */ }
    return rows;
  }

  _claimWorldPiece(name) {
    const key = String(name || '').trim().toLowerCase();
    if (!key) return null;
    try {
      const compass = ensureCompass(this.storage.getChat('backstage', {}));
      const lostHit = listLostAndFound(compass).find(p => String(p.name || '').trim().toLowerCase() === key);
      if (lostHit) {
        const piece = removeFromLostAndFound(compass, lostHit.id) || lostHit;
        this.storage.saveChat();
        return piece;
      }
      const here = getActiveRoom(compass);
      const pieces = listAllSetPieces(compass).filter(p => p.layer !== 'fixtures');
      const ordered = here?.id
        ? [...pieces.filter(p => p.placeId === here.id), ...pieces.filter(p => p.placeId !== here.id)]
        : pieces;
      const setHit = ordered.find(p => String(p.name || '').trim().toLowerCase() === key);
      if (!setHit) return null;
      const taken = pickupItem(compass, setHit.placeId, { itemId: setHit.id });
      this.storage.saveChat();
      return taken;
    } catch (err) {
      console.warn('[Inventory audit claim]', err);
      return null;
    }
  }

  _resetInvTrackCursor() {
    const chat = getContext()?.chat || [];
    this._invTrackPrimed = true;
    this._invLastCount = chat.filter(m => m && !m.is_system).length;
    clearTimeout(this._invTrackTimer);
  }

  _scheduleInvCadence() {
    clearTimeout(this._invTrackTimer);
    this._invTrackTimer = setTimeout(() => {
      this._runInvCadence().catch(err => console.warn('[Inventory cadence]', err));
    }, 1200);
  }

  _emitInvNotice(items) {
    const list = (items || []).filter(it => it && (it.name || it.toState || it.mark));
    if (!list.length) return;
    this.bus.emit('showtime.notice', { kind: 'inventory', items: list });
  }

  _findByName(name) {
    const key = String(name || '').trim().toLowerCase();
    if (!key) return null;
    for (const loc of ['mobile', 'static']) {
      const item = this._list(loc).find(x => String(x.name).trim().toLowerCase() === key);
      if (item) return { item, location: loc };
    }
    return null;
  }

  _invCueHit(windowText) {
    const hay = String(windowText || '');
    if (!hay.trim()) return false;
    if (/\b(pick(?:ed|s)?\s+up|takes?|grab(?:s|bed)?|stow(?:s|ed)?|pocket(?:s|ed)?|wear(?:s|ing|ed)?|put(?:s)?\s+(?:away|on|in|down)|drop(?:s|ped)?|loses?|unpack|pack(?:s|ed)?|gives?\s+you|hands?|equip(?:s|ped)?)\b/i.test(hay)) {
      return true;
    }
    const care = scanCareCues(hay);
    if (care.includes('eat') || care.includes('drink')) return true;
    const low = hay.toLowerCase();
    for (const loc of ['mobile', 'static']) {
      for (const x of this._list(loc)) {
        const n = String(x.name || '').trim();
        if (n.length >= 3 && low.includes(n.toLowerCase())) return true;
      }
    }
    return !!(this.state.incoming || this.state.pending);
  }

  async _runInvCadence() {
    if (this._invBusy) return;
    const pol = this._itemPolicy();
    if (pol.enabled === false) return;
    const chat = getContext()?.chat || [];
    const windowRows = (chat.filter(m => m && !m.is_system) || []).slice(-8);
    const windowText = windowRows.map(m => formatChatLine(m, 480)).filter(Boolean).join('\n');
    if (!this._invCueHit(windowText)) return;
    this._invBusy = true;
    try {
      await this._runDeltaAudit(windowText, { silent: true });
    } finally {
      this._invBusy = false;
    }
  }

  _deltaRoster(scene = '') {
    const rows = [];
    for (const loc of ['mobile', 'static']) {
      for (const x of this._list(loc)) {
        const kind = x.kind === 'container' ? 'container' : 'item';
        const place = this._placePhrase(x);
        const eq = this._itemLoc(x).where === 'worn' ? ', equipped' : '';
        const cond = x.condition && x.condition !== 'pristine' ? `, ${x.condition}` : '';
        const amt = formatAmountLine(x);
        const fill = amt ? `, ${amt}` : '';
        rows.push(`- ${x.name} (${kind}, ${place}${cond}${eq}${fill})`);
      }
    }
    for (const line of this._worldKitLines({ scene, max: 12 })) rows.push(line);
    return rows.join('\n') || 'None';
  }

  async _runDeltaAudit(windowText, { silent = false } = {}) {
    const player = this._playerName();
    const scene = clipExcerptToLines(String(windowText || '').trim(), 1800);
    if (!scene) return 0;
    const chatToken = this._chatToken();
    const prompt = `You are filing a lean inventory delta for ${player} ({{user}}).

Scene (recent lines only):
${scene}

Current belongings:
${this._deltaRoster(scene)}

Return ONLY a JSON array of changes that actually happened in those lines. Empty [] if nothing changed.
Each object:
{"action":"add"|"move"|"remove"|"update","name":"...","kind":"item"|"container","location":"person"|"trunk","inside":"","condition":"pristine|fine|worn|damaged|broken|ruined","category":"consumable|wearable|usable|misc","equipped":false,"remaining":null,"capacity":null,"unit":"pieces|servings|ml|g|","fill":"full|high|half|low|empty|"}
- add: newly acquired / picked up / given to ${player}. Reuse an existing Set / lost & found name instead of minting a second copy. Do not repeat names already in belongings. A pack of chips/pills/water is ONE row with remaining/capacity/fill — never one row per piece.
- move: existing item changed place (person vs trunk) or went inside a container (inside=container name).
- remove: thrown away, given away, destroyed. Eating or drinking from a pack is NOT remove.
- update: condition, equipped, remaining, capacity, unit, or fill changed; keep the same name. "ate some chips" / "half the bottle" UPDATES remaining or fill. Empty packs stay listed (fill empty, remaining 0). Wearables never take remaining/capacity/fill.
- location person = On Person; trunk = Trunk / left behind.
- inside: items slid/pocketed/stuffed into a bag, pack, satchel, or case stay accounted for as children of that container — do not list them as loose. Add the container first if it is new.
EXCLUDE other people's things, scenery not taken, and default body clothing unless named.

JSON:`;
    const response = String(await withShowtimeProfile(this.storage, 'audit', () =>
      leanQuietGenerate(prompt, { kind: 'filing' })) ?? '').trim();
    if (!this._chatTokenStillValid(chatToken)) return 0;
    if (!response) {
      if (!silent) throw new Error('Empty inventory delta.');
      return 0;
    }
    const ops = parseJsonArray(response);
    if (!ops) {
      if (!silent) throw new Error('No JSON array in the inventory delta.');
      return 0;
    }
    if (!Array.isArray(ops) || !ops.length) return 0;
    const notices = this._applyDeltaOps(ops);
    if (notices.length) {
      this.saveState();
      this.bus.emit('inventory.updated');
      this._emitInvNotice(notices);
      if (this.container) this.render(this.container);
    }
    return notices.length;
  }

  _applyDeltaOps(raw) {
    const notices = [];
    const locOf = v => {
      const s = String(v ?? '').toLowerCase();
      if (['trunk', 'static', 'storage', 'dressing room', 'left'].some(k => s.includes(k))) return 'static';
      return 'mobile';
    };
    const dropSilent = (id) => {
      const found = this._find(id);
      if (!found) return;
      const drop = new Set([id, ...this._descendants(found.location, id)]);
      for (const x of this._list(found.location)) {
        if (drop.has(x.id) && x.equippedTo) this._unequip(x.id, { silent: true, skipRender: true });
      }
      this.state[found.location] = this._list(found.location).filter(x => !drop.has(x.id));
    };

    const adds = [];
    for (const op of raw || []) {
      if (!op || !String(op.name || '').trim()) continue;
      const action = String(op.action || '').toLowerCase();
      const name = String(op.name).trim().slice(0, 80);
      if (action === 'add') {
        adds.push(op);
        continue;
      }
      const found = this._findByName(name);
      if (!found) {
        if (action === 'remove') continue;
        adds.push({ ...op, action: 'add' });
        continue;
      }
      if (action === 'remove') {
        dropSilent(found.item.id);
        notices.push({ name, label: 'Inventory', toState: 'removed', mark: 'X' });
        continue;
      }
      let changed = false;
      if (action === 'move' || op.location) {
        const dest = locOf(op.location);
        if (dest !== found.location) {
          this._moveTo(found.item.id, dest);
          changed = true;
        }
      }
      const fresh = this._findByName(name);
      if (!fresh) continue;
      if (op.inside) {
        const box = this._findByName(String(op.inside));
        if (box?.item?.kind === 'container') {
          if (box.location !== fresh.location) this._moveTo(fresh.item.id, box.location);
          const again = this._findByName(name);
          if (again) {
            again.item.parentId = box.item.id;
            changed = true;
          }
        }
      }
      const row = this._findByName(name)?.item;
      if (!row) continue;
      if (op.condition && CONDITION_MAP[op.condition] && op.condition !== row.condition) {
        row.condition = op.condition;
        changed = true;
      }
      if (op.equipped === true && row.category === 'wearable' && row.equippedTo?.type !== 'player') {
        row.equippedTo = { type: 'player' };
        changed = true;
      } else if (op.equipped === false && row.equippedTo) {
        this._unequip(row.id, { silent: true, skipRender: true });
        changed = true;
      }
      if (applyAmountOp(row, op)) changed = true;
      if (changed) notices.push({ name, label: 'Inventory', toState: 'changed', mark: '!' });
    }

    if (adds.length) {
      const added = this._applyAuditItems(adds);
      if (added) {
        for (const it of adds.slice(0, added)) {
          const nm = String(it.name || '').trim();
          if (nm) notices.push({ name: nm, label: 'Inventory', toState: 'added', mark: added });
        }
      }
    }
    return notices;
  }

  async _runAudit(btn) {
    if (!btn) return;
    const orig = btn.textContent;
    btn.disabled = true;
    btn.textContent = '...';
    try {
      const transcript = this._userTranscript();
      if (!transcript.trim()) {
        void showtimeAlert(`No ${this._playerName()} messages to audit yet.`, { title: 'INVENTORY AUDIT' });
        return;
      }
      const player = this._playerName();
      const chatToken = this._chatToken();
      const prompt = `You are filing an inventory claim for ${player} ({{user}}).\n\nRead ONLY the {{user}} messages below. Do not invent items from the persona, the scenario, or anyone else — other speakers are not provided on purpose.\n\nAlready accounted for (reuse these names; do not mint a second copy). If {{user}} picks up an on-set or lost & found object, still return that same name so it can be claimed:\n${this._inventoryRoster(transcript)}\n\n{{user}} messages:\n${clipExcerptToLines(transcript, 4000)}\n\nReturn ONLY a JSON array of objects {{user}} actually mentioned having, carrying, storing, picking up, opening, or wearing.\nINCLUDE: items and containers (bags, packs, boxes, pockets-as-bags, crates, cases).\nEXCLUDE: clothing already implied as a default body, scenery that is not taken, other people's things, and anything not in the {{user}} lines.\nIf nothing new is mentioned, return [].\n\nEach object:\n{"kind":"item"|"container","name":"...","description":"...","condition":"pristine|fine|worn|damaged|broken|ruined","category":"consumable|wearable|usable|misc","location":"person"|"trunk","inside":"","equipped":false,"remaining":null,"capacity":null,"unit":"pieces|servings|ml|g|","fill":"full|high|half|low|empty|"}\n- kind container: no category; bags/packs/pouches/boxes that hold other things. A bag of chips CAN be the pack itself (remaining/fill on that container) — do not mint one row per chip.\n- location person = carried with {{user}}; trunk = left behind / stored / not on them.\n- inside = name of a container (existing or in this same list), or "". Items placed into a bag/pack must set inside; do not mint them as loose copies.\n- equipped true only if kind is item, category wearable, and {{user}} said they are wearing it.\n- condition from the text; default pristine.\n- remaining/capacity/unit/fill: homogeneous contents (chips, water, pills) on consumable packs or containers. Never on wearables — clothing is not a countable pack. Reuse an existing pack name and set remaining/fill instead of adding copies. Empty packs stay listed.\n\nJSON:`;

      const response = String(await withShowtimeProfile(this.storage, 'audit', () =>
        leanQuietGenerate(prompt, { kind: 'filing' })) ?? '').trim();
      if (!this._chatTokenStillValid(chatToken)) return;
      if (!response) throw new Error('Empty audit reply.');
      const items = parseJsonArray(response);
      if (!Array.isArray(items)) throw new Error('No JSON array in the audit reply.');
      const added = this._applyAuditItems(items);
      if (!added) {
        this._emitInvNotice([{ name: this._playerName(), label: 'Audit', toState: 'nothing new', mark: '!' }]);
        return;
      }
      this.saveState();
      this.bus.emit('inventory.updated');
      this._emitInvNotice(items.filter(it => it && String(it.name || '').trim()).slice(0, added).map(it => ({
        name: String(it.name).trim(),
        label: 'Inventory',
        toState: 'added',
        mark: added,
      })));
      this.render(this.container);
    } catch (err) {
      console.error('[Inventory audit]', err);
      void showtimeAlert(`Audit failed: ${err.message}`, { title: 'INVENTORY AUDIT', danger: true });
    } finally {
      btn.disabled = false;
      btn.textContent = orig;
    }
  }

  _applyAuditItems(raw) {
    const existing = new Set(
      [...this.state.static, ...this.state.mobile].map(x => String(x.name ?? '').trim().toLowerCase()).filter(Boolean),
    );
    try {
      const star = getStarMember(this.storage);
      for (const w of star?.wardrobe || []) {
        const n = String(w?.name || '').trim().toLowerCase();
        if (n) existing.add(n);
      }
      for (const p of star?.props || []) {
        const n = String(p?.name || '').trim().toLowerCase();
        if (n) existing.add(n);
      }
    } catch { /* ignore */ }
    const locOf = v => {
      const s = String(v ?? '').toLowerCase();
      if (['trunk', 'static', 'storage', 'dressing room', 'left'].some(k => s.includes(k))) return 'static';
      return 'mobile';
    };
    const findContainer = (name, preferLoc) => {
      const key = String(name ?? '').trim().toLowerCase();
      if (!key) return null;
      const lists = preferLoc === 'static' ? ['static', 'mobile'] : ['mobile', 'static'];
      for (const loc of lists) {
        const hit = this._list(loc).find(x => x.kind === 'container' && String(x.name).trim().toLowerCase() === key);
        if (hit) return { item: hit, location: loc };
      }
      return null;
    };

    const rows = raw
      .filter(it => it && String(it.name ?? '').trim())
      .map(it => {
        const name = String(it.name).trim().slice(0, 80);
        const kind = String(it.kind ?? '').toLowerCase() === 'container' ? 'container' : 'item';
        const category = CATEGORY_MAP[it.category] ? it.category : (kind === 'item' ? 'misc' : undefined);
        return {
          name,
          kind,
          description: String(it.description ?? '').trim().slice(0, 240),
          condition: CONDITION_MAP[it.condition] ? it.condition : 'pristine',
          category,
          location: locOf(it.location),
          inside: String(it.inside ?? it.parent ?? '').trim(),
          equipped: !!(it.equipped && kind === 'item' && (category === 'wearable' || String(it.category).toLowerCase() === 'wearable')),
          remaining: it.remaining ?? it.count ?? it.left,
          capacity: it.capacity ?? it.max ?? it.full,
          unit: it.unit,
          unitLabel: it.unitLabel,
          fill: it.fill,
        };
      });

    if (!rows.length) return 0;

    const claimInto = (it) => {
      const world = this._claimWorldPiece(it.name);
      if (!world) return it;
      const cond = world.condition && CONDITION_MAP[world.condition] ? world.condition : it.condition;
      return {
        ...it,
        name: world.name || it.name,
        description: it.description || String(world.description || '').trim(),
        condition: cond,
        kind: world.kind === 'container' ? 'container' : it.kind,
      };
    };

    let added = 0;
    const containers = rows.filter(r => r.kind === 'container');
    const others = rows.filter(r => r.kind !== 'container');

    for (const rawIt of containers) {
      const hit = this._findByName(rawIt.name);
      if (hit) {
        if (applyAmountOp(hit.item, rawIt)) added += 1;
        continue;
      }
      const it = claimInto(rawIt);
      if (existing.has(it.name.toLowerCase()) || this._findByName(it.name)) {
        const again = this._findByName(it.name);
        if (again && applyAmountOp(again.item, it)) added += 1;
        continue;
      }
      const row = {
        id: uid(),
        kind: 'container',
        name: it.name,
        description: it.description,
        parentId: null,
        location: it.location,
        condition: it.condition,
      };
      applyAmountOp(row, it);
      this._list(it.location).push(row);
      existing.add(it.name.toLowerCase());
      added += 1;
    }

    for (const rawIt of others) {
      const hit = this._findByName(rawIt.name);
      if (hit) {
        if (applyAmountOp(hit.item, rawIt)) added += 1;
        continue;
      }
      const it = claimInto(rawIt);
      if (existing.has(it.name.toLowerCase()) || this._findByName(it.name)) {
        const again = this._findByName(it.name);
        if (again && applyAmountOp(again.item, it)) added += 1;
        continue;
      }
      let location = it.location;
      let parentId = null;
      if (it.inside) {
        const box = findContainer(it.inside, location);
        if (box) {
          location = box.location;
          parentId = box.item.id;
        }
      }
      const row = {
        id: uid(),
        kind: 'item',
        name: it.name,
        description: it.description,
        parentId,
        location,
        condition: it.condition,
        category: it.category || 'misc',
      };
      if (it.equipped && row.category === 'wearable') {
        row.equippedTo = { type: 'player' };
      }
      applyAmountOp(row, it);
      this._list(location).push(row);
      existing.add(it.name.toLowerCase());
      added += 1;
    }
    return added;
  }

  _scanText() {
    const chat = getContext().chat ?? [];
    return chat.filter(m => m && !m.is_system).slice(-CHAT_SCAN_DEPTH).map(m => String(m.mes ?? '')).join('\n');
  }

  _itemCueHit(item, hay) {
    const name = String(item.name ?? '').trim();
    if (name.length < 2) return false;
    const cues = [name];
    const words = name.split(/\s+/).filter(w => w.length >= 5);
    if (words.length) cues.push(words[words.length - 1]);
    return cues.some(cue => {
      const re = new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapeRe(cue)}(?:$|[^\\p{L}\\p{N}])`, 'iu');
      return re.test(hay);
    });
  }

  _starOwns(item) {
    const loc = this._itemLoc(item);
    const owner = String(loc.ownerId || '');
    const starId = this._starChar()?.id || '';
    if (!owner || owner === 'star' || owner === 'player' || owner === 'you') return true;
    return !!(starId && owner === starId);
  }

  /** Equipped, then loose On Person. Trunk and packed contents stay off this list. */
  _onPersonLines() {
    const lines = [];
    const ids = new Set();
    const push = (item) => {
      if (!item || ids.has(item.id) || lines.length >= 8) return;
      if (!this._starOwns(item)) return;
      ids.add(item.id);
      lines.push(this._condenseItem(item, 'mobile'));
    };
    for (const loc of ['mobile', 'static']) {
      for (const item of this._list(loc)) {
        if (this._itemLoc(item).where === 'worn') push(item);
      }
    }
    for (const loc of ['mobile', 'static']) {
      for (const item of this._list(loc)) {
        const where = this._itemLoc(item).where;
        if (where === 'carried' && !item.parentId) push(item);
      }
    }
    return { lines, ids };
  }

  _condenseItem(item, loc) {
    const cond = CONDITION_MAP[item.condition]?.label ?? 'Pristine';
    const cat = item.kind === 'container' ? 'Container' : (CATEGORY_MAP[item.category]?.label ?? 'Item');
    const place = loc === 'mobile' || item.location === 'mobile' ? 'on person' : 'in trunk';
    const eq = item.equippedTo?.type === 'player' ? ', equipped' : '';
    const amt = formatAmountLine(item);
    const fill = amt ? `, ${amt}` : '';
    const desc = String(item.description ?? '').trim();
    const tail = desc ? ` — ${clipText(desc, 80)}` : '';
    return `- ${item.name} (${cat}, ${cond}, ${place}${eq}${fill})${tail}`;
  }

  _buildItemInjection() {
    try {
      if (this.storage.getChat('backstage', {})?.trackers?.items?.enabled === false) return '';
    } catch { /* ignore */ }
    const lines = [];
    const pending = this.state.pending;
    if (pending && !pending.ready && !pending.resolved) {
      const verbInfo = USE_VERB_MAP[pending.verb] || USE_VERB_MAP.use;
      const desc = String(pending.itemDesc || '').trim();
      lines.push(`[Note: ${pending.playerName} is ${verbInfo.phrase} ${pending.itemName}${desc ? ` (${clipText(desc, 80)})` : ''} on ${pending.targetName}. ${pending.targetName}, answer in the scene with a sentence that takes the item, uses it up, or refuses it.]`);
    }
    const used = this._pendingUseId ? this._find(this._pendingUseId) : null;
    if (used) {
      const cond = CONDITION_MAP[used.item.condition]?.label ?? 'Pristine';
      const amt = formatAmountLine(used.item);
      const desc = String(used.item.description ?? '').trim();
      lines.push(`[Note: ${this._playerName()} uses ${used.item.name} (${cond}${amt ? `, ${amt}` : ''})${desc ? ` — ${clipText(desc, 80)}` : ''}]`);
    }
    const carried = this._onPersonLines();
    if (carried.lines.length) lines.push(`[On person:\n${carried.lines.join('\n')}]`);
    const hay = this._scanText();
    const hits = [];
    if (hay.trim()) {
      for (const loc of ['mobile', 'static']) {
        for (const item of this._list(loc)) {
          if (used && item.id === used.item.id) continue;
          if (carried.ids.has(item.id)) continue;
          if (this._itemCueHit(item, hay)) hits.push(this._condenseItem(item, loc));
        }
      }
      if (hits.length) lines.push(`[Items at hand:\n${hits.join('\n')}]`);
    }
    const setNotes = this._setAccessNotes(hay, hits);
    if (setNotes) lines.push(setNotes);
    return lines.join('\n');
  }

  /** Rooms, locks, and Set props that Inventory should know about. */
  _setAccessNotes(hay, atHand = []) {
    try {
      const compass = ensureCompass(this.storage.getChat('backstage', {}));
      const active = getActiveRoom(compass);
      const bits = [];
      if (active) {
        const locks = resolveLockKeys(this.storage, active);
        const lockHits = locks.filter(s => /unlockable with/i.test(s));
        if (lockHits.length) bits.push(`Locks in ${active.name}: ${lockHits.join('; ')}`);
        else if (locks.length && atHand.length) bits.push(`Locked in ${active.name}: ${locks[0]}`);
      }
      const hayLow = String(hay || '').toLowerCase();
      const props = [];
      if (hayLow) {
        for (const it of listAllSetPieces(compass)) {
          if (it.layer === 'fixtures') continue;
          const name = String(it.name || '').trim();
          if (!name) continue;
          if (!hayLow.includes(name.toLowerCase())) continue;
          const where = `${it.placeName || 'Set'}${it.cell ? ` ${it.cell}` : ''}`;
          props.push(`${name} (${where})`);
          if (props.length >= 8) break;
        }
      }
      if (props.length) bits.push(`On the Set: ${props.join('; ')}`);
      if (!bits.length) return '';
      return `[Set / access:\n${bits.map(b => `- ${b}`).join('\n')}]`;
    } catch {
      return '';
    }
  }

  _openAddDialog(location) {
    const pol = this._itemPolicy();
    if (pol.enabled === false) {
      void showtimeAlert('Item tracking is disabled under Stage → Trackers → Items.', { title: 'INVENTORY' });
      return;
    }
    if (pol.castCanCraft === false) {
      void showtimeAlert('Making / adding items is disabled under Stage → Trackers → Items.', { title: 'INVENTORY' });
      return;
    }
    this._openItemDialog({ location, existing: null });
  }

  _openEditDialog(id) {
    const found = this._find(id);
    if (!found) return;
    this._openItemDialog({ location: found.location, existing: found.item });
  }

  _openItemDialog({ location, existing }) {
    const isEdit = !!existing;
    const item = existing ?? {
      kind: 'item',
      name: '',
      description: '',
      category: 'misc',
      condition: 'pristine',
      parentId: null,
    };
    const other = location === 'mobile' ? 'static' : 'mobile';
    const otherLabel = LOCS[other].title;
    const containers = this._list(location).filter(x =>
      x.kind === 'container' && (!isEdit || x.id !== existing.id),
    );

    const backdrop = this._buildModal(`
      <div class="inv-modal-title">${isEdit ? 'REFIT CLAIM' : 'ITEM CLAIM'}</div>
      <div class="inv-modal-subtitle">— property claim —</div>
      <div class="inv-modal-field"><label>Name</label>
        <input type="text" data-field="name" value="${esc(item.name)}"></div>
      <div class="inv-modal-field"><label>Place</label>
        <select data-field="place">
          <option value="mobile" ${location === 'mobile' ? 'selected' : ''}>On Person</option>
          <option value="static" ${location === 'static' ? 'selected' : ''}>Trunk</option>
        </select>
      </div>
      <details class="inv-more">
        <summary>More</summary>
      <div class="inv-modal-field" data-kind-wrap>
        <label>What is this?</label>
        <div class="inv-kind-row">
          <button type="button" class="inv-kind-btn" data-kind="container">Container</button>
          <button type="button" class="inv-kind-btn" data-kind="item">Item</button>
        </div>
        <div class="inv-modal-hint">Containers hold items and can be damaged. Items are sorted by use.</div>
      </div>
      <div class="inv-modal-field" data-cat-wrap>
        <label>Item category</label>
        <div class="inv-cat-row">
          ${CATEGORIES.map(c =>
            `<button type="button" class="inv-cat-btn" data-cat="${c.id}">${esc(c.label)}</button>`,
          ).join('')}
        </div>
      </div>
      <div class="inv-modal-field"><label>Description (optional)</label>
        <textarea data-field="description">${esc(item.description ?? '')}</textarea></div>
      <div class="inv-modal-field" data-cond-wrap>
        <label>Condition</label>
        <select data-field="condition">
          ${CONDITIONS.map(cn =>
            `<option value="${cn.id}" ${cn.id === (item.condition || 'pristine') ? 'selected' : ''}>${cn.label}</option>`,
          ).join('')}
        </select>
        <div class="inv-modal-hint">Pristine → Fine → Worn → Damaged → Broken → Ruined. Worn is use, not equipped.</div>
      </div>
      <div class="inv-modal-field" data-amount-wrap>
        <label>Amount (optional)</label>
        <div class="inv-amount-row">
          <input type="number" data-field="remaining" min="0" step="1" placeholder="Left" value="${esc(readAmount(item)?.remaining ?? '')}">
          <span class="inv-amount-slash">/</span>
          <input type="number" data-field="capacity" min="0" step="1" placeholder="Full" value="${esc(readAmount(item)?.capacity ?? '')}">
          <select data-field="unit">
            <option value="">Unit</option>
            ${AMOUNT_UNITS.map(u =>
              `<option value="${u.id}" ${u.id === (readAmount(item)?.unit || '') ? 'selected' : ''}>${esc(u.label)}</option>`,
            ).join('')}
          </select>
        </div>
        <input type="text" data-field="unitLabel" placeholder="Custom unit" value="${esc(readAmount(item)?.unitLabel ?? '')}" data-unit-label>
        <label>Fill</label>
        <div class="inv-cat-row" data-fill-row>
          ${FILL_BANDS.map(b =>
            `<button type="button" class="inv-fill-btn" data-fill="${b.id}">${esc(b.label)}</button>`,
          ).join('')}
          <button type="button" class="inv-fill-btn" data-fill="">—</button>
        </div>
        <div class="inv-modal-hint">How much is still in it (chips, water, pills). Wearables cannot hold a count. Empty packs stay on the list.</div>
      </div>
      <div class="inv-modal-field" data-parent-wrap>
        <label>Inside a container (optional)</label>
        <select data-field="parentId">
          <option value="">— Loose in this section —</option>
          ${containers.map(c =>
            `<option value="${c.id}" ${item.parentId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`,
          ).join('')}
        </select>
      </div>
      </details>
      <div class="inv-modal-actions">
        ${isEdit ? `<button class="inv-btn" data-action="move" style="margin-right:auto">→ ${esc(otherLabel)}</button>` : ''}
        <button class="inv-btn" data-action="cancel">Cancel</button>
        <button class="inv-btn" data-action="save">${isEdit ? 'Save' : 'Add'}</button>
      </div>
    `);

    let kind = isEdit ? (item.kind === 'container' ? 'container' : 'item') : 'item';
    let category = CATEGORY_MAP[item.category] ? item.category : 'misc';
    let fillBand = readAmount(item)?.fill || '';

    const syncKind = () => {
      backdrop.querySelectorAll('.inv-kind-btn').forEach(b => {
        b.classList.toggle('on', b.dataset.kind === kind);
      });
      const picked = !!kind;
      const isC = kind === 'container';
      backdrop.querySelector('[data-cat-wrap]').style.display = picked && !isC ? '' : 'none';
      backdrop.querySelector('[data-cond-wrap]').style.display = picked ? '' : 'none';
      backdrop.querySelector('[data-amount-wrap]').style.display =
        picked && (isC || category !== 'wearable') ? '' : 'none';
      backdrop.querySelector('[data-parent-wrap]').style.display = picked && !isC ? '' : 'none';
    };
    const syncCat = () => {
      backdrop.querySelectorAll('.inv-cat-btn').forEach(b => {
        b.classList.toggle('on', b.dataset.cat === category);
      });
      syncKind();
    };
    const syncFill = () => {
      backdrop.querySelectorAll('.inv-fill-btn').forEach(b => {
        b.classList.toggle('on', (b.dataset.fill || '') === fillBand);
      });
      const unit = backdrop.querySelector('[data-field="unit"]').value;
      backdrop.querySelector('[data-unit-label]').style.display = unit === 'custom' ? '' : 'none';
    };
    const stampAmount = (row) => {
      if (kind === 'item' && category === 'wearable') {
        clearAmount(row);
        return;
      }
      const remaining = backdrop.querySelector('[data-field="remaining"]').value;
      const capacity = backdrop.querySelector('[data-field="capacity"]').value;
      const unit = backdrop.querySelector('[data-field="unit"]').value;
      const unitLabel = backdrop.querySelector('[data-field="unitLabel"]').value.trim();
      if (remaining === '' && capacity === '' && !unit && !fillBand) {
        clearAmount(row);
        return;
      }
      writeAmount(row, {
        remaining: remaining === '' ? null : remaining,
        capacity: capacity === '' ? null : capacity,
        unit,
        unitLabel,
        fill: fillBand,
      });
    };
    syncKind();
    syncCat();
    syncFill();

    backdrop.querySelectorAll('.inv-kind-btn').forEach(b => {
      b.addEventListener('click', () => { kind = b.dataset.kind; syncKind(); });
    });
    backdrop.querySelectorAll('.inv-cat-btn').forEach(b => {
      b.addEventListener('click', () => { category = b.dataset.cat; syncCat(); });
    });
    backdrop.querySelectorAll('.inv-fill-btn').forEach(b => {
      b.addEventListener('click', () => { fillBand = b.dataset.fill || ''; syncFill(); });
    });
    backdrop.querySelector('[data-field="unit"]').addEventListener('change', syncFill);
    const syncFillFromCounts = () => {
      const rem = backdrop.querySelector('[data-field="remaining"]').value;
      const cap = backdrop.querySelector('[data-field="capacity"]').value;
      if (rem === '' && cap === '') return;
      const nRem = rem === '' ? null : Number(rem);
      const nCap = cap === '' ? null : Number(cap);
      const next = deriveFill(
        Number.isFinite(nRem) ? nRem : null,
        Number.isFinite(nCap) ? nCap : null,
        fillBand,
      );
      if (next) fillBand = next;
      syncFill();
    };
    backdrop.querySelector('[data-field="remaining"]').addEventListener('input', syncFillFromCounts);
    backdrop.querySelector('[data-field="capacity"]').addEventListener('input', syncFillFromCounts);
    backdrop.querySelector('[data-action="cancel"]').addEventListener('click', () => backdrop.remove());
    backdrop.addEventListener('click', e => { if (e.target === backdrop) backdrop.remove(); });

    if (isEdit) {
      backdrop.querySelector('[data-action="move"]')?.addEventListener('click', () => {
        this._moveTo(existing.id, other);
        backdrop.remove();
      });
    }

    backdrop.querySelector('[data-action="save"]').addEventListener('click', () => {
      if (!kind) { void showtimeAlert('Choose Container or Item first.', { title: 'ITEM CLAIM' }); return; }
      const name = backdrop.querySelector('[data-field="name"]').value.trim();
      if (!name) { void showtimeAlert('Name is required.', { title: 'ITEM CLAIM' }); return; }
      const place = backdrop.querySelector('[data-field="place"]')?.value === 'static' ? 'static' : 'mobile';
      const description = backdrop.querySelector('[data-field="description"]').value.trim();
      const condition = backdrop.querySelector('[data-field="condition"]').value;
      let parentId = backdrop.querySelector('[data-field="parentId"]').value || null;
      if (kind === 'container' || place !== location) parentId = null;

      if (isEdit) {
        if (existing.kind === 'container' && kind === 'item') {
          const kids = this._children(location, existing.id);
          if (kids.length) {
            void showtimeAlert('Empty this container before turning it into an item.', { title: 'ITEM CLAIM' });
            return;
          }
        }
        Object.assign(existing, {
          kind,
          name,
          description,
          parentId,
          condition,
          category: kind === 'item' ? category : undefined,
        });
        if (kind === 'container') {
          delete existing.category;
          existing.equippedTo = null;
        }
        if (kind === 'item' && category !== 'wearable') existing.equippedTo = null;
        stampAmount(existing);
      } else {
        const row = {
          id: uid(),
          kind,
          name,
          description,
          parentId,
          location: place,
          condition,
        };
        if (kind === 'item') row.category = category;
        stampAmount(row);
        this._list(place).push(row);
      }
      this.saveState();
      this.bus.emit('inventory.updated');
      if (isEdit && place !== location) this._moveTo(existing.id, place);
      backdrop.remove();
      this.render(this.container);
    });
    setTimeout(() => backdrop.querySelector('[data-field="name"]').focus(), 0);
  }

  _moveTo(id, dest) {
    const found = this._find(id);
    if (!found || found.location === dest) return;
    const world = worldFromStorage(this.storage);
    const result = moveItem(world, id, {
      where: dest === 'static' ? 'trunk' : 'carried',
      ownerId: 'star',
    }, { reason: dest === 'static' ? 'to trunk' : 'on person' });
    if (!result.ok) return;
    if (dest !== 'static') {
      const star = this._starChar();
      if (star?.id) exposeLinkedItem(this.storage, id, star.id);
    }
    this.saveState();
    this.bus.emit('inventory.updated');
    this.render(this.container);
  }

  async _remove(id) {
    const found = this._find(id);
    if (!found) return;
    const label = found.item.name || 'this belonging';
    if (!await showtimeConfirm(`Remove ${label}?`, { title: 'REMOVE BELONGING', danger: true, confirmLabel: 'Remove' })) return;
    const drop = new Set([id, ...this._descendants(found.location, id)]);
    for (const x of this._list(found.location)) {
      if (drop.has(x.id) && x.equippedTo) {
        this._unequip(x.id, { silent: true, skipRender: true });
      }
    }
    this.state[found.location] = this._list(found.location).filter(x => !drop.has(x.id));
    this.saveState();
    this.bus.emit('inventory.updated');
    this.render(this.container);
  }

  _openEquipDialog(id) {
    const found = this._find(id);
    if (!found || found.item.category !== 'wearable') return;
    const player = this._playerName();
    const members = getCastMembers(this.storage).filter(c => c.priority !== 'director' && c.priority !== 'star');
    const backdrop = this._buildModal(`
      <div class="inv-modal-title">WARDROBE CLAIM</div>
      <div class="inv-modal-subtitle">— ${esc(found.item.name)} —</div>
      <div class="inv-modal-field">
        <label>Wear on</label>
        <select data-field="target">
          <option value="player">You · ${esc(player)} (Star)</option>
          ${members.map(m =>
            `<option value="cast:${m.id}">${esc(m.name)}</option>`,
          ).join('')}
        </select>
        <div class="inv-modal-hint">Adds this wearable to that character's wardrobe tracker.</div>
      </div>
      <div class="inv-modal-actions">
        <button class="inv-btn" data-action="cancel">Cancel</button>
        <button class="inv-btn" data-action="save">Equip</button>
      </div>
    `);
    backdrop.querySelector('[data-action="cancel"]').addEventListener('click', () => backdrop.remove());
    backdrop.addEventListener('click', e => { if (e.target === backdrop) backdrop.remove(); });
    backdrop.querySelector('[data-action="save"]').addEventListener('click', () => {
      const val = backdrop.querySelector('[data-field="target"]').value;
      this._equip(found.item, val);
      backdrop.remove();
    });
  }

  _equip(item, targetVal) {
    const world = worldFromStorage(this.storage);
    if (targetVal === 'player') {
      moveItem(world, item.id, { where: 'worn', ownerId: 'star' }, { reason: 'equipped' });
      const star = this._starChar();
      if (star?.id) exposeLinkedItem(this.storage, item.id, star.id);
    } else if (targetVal.startsWith('cast:')) {
      const characterId = targetVal.slice(5);
      const char = (world.characters ?? []).find(c => c.id === characterId);
      if (!char) { void showtimeAlert('That cast member is gone.', { title: 'WARDROBE CLAIM' }); return; }
      const moved = moveItem(world, item.id, { where: 'worn', ownerId: characterId }, { reason: `worn by ${char.name}` });
      if (moved.ok) {
        exposeLinkedItem(this.storage, item.id, characterId);
        this.bus.emit('cast.updated', { character: char });
      }
    }
    this.saveState();
    this.bus.emit('inventory.updated');
    this.render(this.container);
  }

  _toggleBox(id) {
    const open = new Set(this.state.openBoxes ?? []);
    if (open.has(id)) open.delete(id);
    else open.add(id);
    this.state.openBoxes = [...open];
    this.saveState();
    this.render(this.container);
  }

  _asLoadout(item) {
    const row = {
      name: item.name,
      description: item.description ?? '',
      condition: item.condition || 'pristine',
      inventoryId: item.id,
      kind: inferKitKind(item),
      category: item.category,
    };
    const amt = readAmount(item);
    if (amt) writeAmount(row, amt);
    return row;
  }

  _mergeLinked(existing, invItems) {
    const manual = (existing ?? []).filter(x => !x.inventoryId);
    const prev = new Map((existing ?? []).filter(x => x.inventoryId).map(x => [x.inventoryId, x]));
    const linked = invItems.map(it => {
      const old = prev.get(it.id);
      return { id: old?.id ?? uid(), ...this._asLoadout(it) };
    });
    const byInv = new Map(linked.map(x => [x.inventoryId, x]));
    for (const it of invItems) {
      const child = byInv.get(it.id);
      if (!child || !it.parentId) continue;
      const parent = byInv.get(it.parentId);
      if (parent) {
        child.parentId = parent.id;
        parent.kind = 'container';
      }
    }
    return [...linked, ...manual];
  }

  _syncStarLoadout() {
    const star = this._starChar();
    stampInventoryLocators(this.state, { ownerId: star?.id });
    this.storage.saveChat();
    if (star) this.bus.emit('cast.updated', { character: star });
  }

  _unequip(id, { skipRender = false } = {}) {
    const world = worldFromStorage(this.storage);
    const hit = moveItem(world, id, { where: 'carried', ownerId: 'star' }, { reason: 'unequipped' });
    if (!hit.ok) return;
    this.saveState();
    this.bus.emit('inventory.updated');
    if (!skipRender && this.container) this.render(this.container);
  }

  _buildModal(inner) {
    return buildShowtimeModal(inner, { closeOnBackdrop: false });
  }
}

function uid() {
  return crypto?.randomUUID?.() ?? ('i_' + Math.random().toString(36).slice(2, 10));
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, ch =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}
