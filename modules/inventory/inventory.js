// Inventory — {{user}} belongings. Trunk (dressing room) vs On Person.
import { getContext } from '../../../../../extensions.js';
import { eventSource, event_types, generateQuietPrompt } from '../../../../../../script.js';
import { Module } from '../../lib/module.js';
import { getCastMembers, getStarMember, resolveChatSpeaker } from '../../lib/castCatalog.js';
import { ensureCompass, getActiveRoom } from '../../lib/compass/state.js';
import { listAllSetPieces } from '../../lib/compass/schema.js';
import { resolveLockKeys } from '../../lib/compass/render.js';
import { clipText, CHAT_SCAN_DEPTH } from '../../lib/chatTrack.js';
import { withShowtimeProfile } from '../../lib/connectionProfile.js';

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
const OFFER_CUE_RE = /\b(offers?|hands?(?:\s+(?:you|over|across))?|holds?\s+out|thrusts?|forces?|shoves?|presses?(?:\s+(?:into|in))?|gives?\s+you|passes?\s+you|slides?\s+(?:you|across|it)|produces?|pulls?\s+out|draws?|unsheathes?|tosses?\s+you|hurls?(?:\s+at\s+you)?|presents?)\b/i;

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
      this.bus.on('inventory.updated', () => this._syncStarLoadout());
    }
    this._pendingUseId = null;
    this._registerInjections();
    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, () => {
      if (this._pendingUseId) {
        this._pendingUseId = null;
        this.bus.emit('showtime.stateChanged');
      }
      // A cast reply just landed while an Offer/Use/Force is awaiting a
      // verdict — read it and classify accept/reject/damage.
      const pending = this.state.pending;
      if (pending && !pending.classifying && !pending.resolved) {
        pending.classifying = true;
        this.saveState();
        this._classifyPendingUse(pending.id);
        if (this.container) this.render(this.container);
      }
      // Cast-initiated: scan the message that just rendered for an NPC
      // offering/using/forcing/giving an item onto {{user}}. Dedupe by chat
      // length so re-renders of the same message don't rescan it.
      const chatLen = (getContext().chat ?? []).length;
      if (chatLen !== this._lastIncomingScanLen) {
        this._lastIncomingScanLen = chatLen;
        this._scanIncomingOffer();
      }
    });
  }

  getDefaultState() {
    return { static: [], mobile: [], currency: {}, openBoxes: [], pending: null, incoming: null };
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
    if (this.container) await this.render(this.container);
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
      x.kind === 'item' && x.category === 'wearable' && x.equippedTo?.type === 'player',
    );
    const wornCast = (star?.wardrobe ?? []).filter(w => !wornInv.some(i => i.id === w.inventoryId));
    const worn = [...wornInv, ...wornCast];

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
    container.querySelector('[data-action="pending-apply"]')?.addEventListener('click', () => {
      const outcome = container.querySelector('[data-pending-field="outcome"]')?.value || 'reject';
      const damage = container.querySelector('[data-pending-field="damage"]')?.value || 'none';
      this._applyPendingResolution(outcome, damage);
    });
    container.querySelector('[data-action="incoming-apply"]')?.addEventListener('click', () => {
      const outcome = container.querySelector('[data-incoming-field="outcome"]')?.value || 'reject';
      const damage = container.querySelector('[data-incoming-field="damage"]')?.value || 'none';
      this._applyIncomingResolution(outcome, damage);
    });
    container.querySelector('[data-action="incoming-dismiss"]')?.addEventListener('click', () => {
      this.state.incoming = null;
      this.saveState();
      this.render(this.container);
    });
    container.querySelectorAll('[data-action="add"]').forEach(btn => {
      btn.addEventListener('click', () => this._openAddDialog(btn.dataset.location));
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
    const catBadge = isContainer
      ? ''
      : `<span class="inv-item-cat" style="background:${cat?.color ?? '#8a8474'}">${esc(cat?.label ?? 'Item')}</span>`;

    return `
      <div class="inv-item${nested ? ' inv-item--in' : ''}${isContainer ? ' inv-item--box' : ''}" style="border-left-color:${border}">
        <div class="inv-item-row">
          ${fold}
          <span class="inv-item-name">${isContainer ? '▣ ' : ''}${esc(item.name)}</span>
          ${count}
          ${catBadge}
          ${condBadge}
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
    if (p.resolved) {
      const r = p.resolved;
      return `
        <div class="inv-pending">
          <div class="inv-pending-head">${p.classifyFailed
            ? `Couldn't auto-read the reply — resolve “${esc(p.itemName)}” manually:`
            : `${esc(p.targetName)} responded to your ${esc(verbInfo.label.toLowerCase())} of “${esc(p.itemName)}”${r.note ? ` — <em>${esc(r.note)}</em>` : ''}`}</div>
          <div class="inv-pending-row">
            <select data-pending-field="outcome">
              <option value="accept_transfer" ${r.outcome === 'accept_transfer' ? 'selected' : ''}>Accepted — moves to ${esc(p.targetName)}</option>
              <option value="accept_consume" ${r.outcome === 'accept_consume' ? 'selected' : ''}>Accepted — used up / applied</option>
              <option value="reject" ${r.outcome === 'reject' ? 'selected' : ''}>Rejected — stays with you</option>
            </select>
            <select data-pending-field="damage">
              <option value="none" ${r.damage === 'none' ? 'selected' : ''}>No damage</option>
              <option value="damaged" ${r.damage === 'damaged' ? 'selected' : ''}>Damaged</option>
              <option value="destroyed" ${r.damage === 'destroyed' ? 'selected' : ''}>Destroyed</option>
            </select>
            <button type="button" class="inv-btn" data-action="pending-apply">Apply</button>
          </div>
        </div>`;
    }
    if (p.classifying) {
      return `
        <div class="inv-pending">
          <div class="inv-pending-head">Reading ${esc(p.targetName)}'s response to your ${esc(verbInfo.label.toLowerCase())} of “${esc(p.itemName)}”…</div>
        </div>`;
    }
    return `
      <div class="inv-pending">
        <div class="inv-pending-head">Awaiting ${esc(p.targetName)}'s response — you're ${esc(verbInfo.phrase)} “${esc(p.itemName)}” on them</div>
        <div class="inv-pending-row">
          <button type="button" class="inv-btn" data-action="pending-cancel">Cancel</button>
        </div>
      </div>`;
  }

  _renderIncomingBanner() {
    const inc = this.state.incoming;
    if (!inc) return '';
    const verbInfo = USE_VERB_MAP[inc.verb] || USE_VERB_MAP.offer;
    return `
      <div class="inv-pending inv-pending--incoming">
        <div class="inv-pending-head">${esc(inc.npcName)} is ${esc(verbInfo.phrase)} “${esc(inc.itemName)}”${inc.itemDesc ? ` — <em>${esc(inc.itemDesc)}</em>` : ''} on you</div>
        <div class="inv-pending-row">
          <select data-incoming-field="outcome">
            <option value="accept_transfer">Accept — add to On Person</option>
            <option value="accept_consume">Accept — used on you (no item kept)</option>
            <option value="reject" selected>Reject / ignore</option>
          </select>
          <select data-incoming-field="damage">
            <option value="none" selected>No damage</option>
            <option value="damaged">Damaged</option>
            <option value="destroyed">Destroyed</option>
          </select>
          <button type="button" class="inv-btn" data-action="incoming-apply">Apply</button>
          <button type="button" class="inv-btn" data-action="incoming-dismiss">Dismiss</button>
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
    const canUse = item.kind !== 'container';
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
      alert('Item tracking is disabled under Stage → Trackers → Items.');
      return;
    }
    if (act === 'use') {
      if (pol.castCanUse === false) { alert('Item use is disabled under Stage → Trackers → Items.'); return; }
      this._openUseDialog(id, location);
    }
    else if (act === 'edit') this._openEditDialog(id);
    else if (act === 'remove') {
      if (pol.castCanDelete === false) { alert('Deleting items is disabled under Stage → Trackers → Items.'); return; }
      this._remove(id);
    }
    else if (act === 'equip') this._openEquipDialog(id);
    else if (act === 'unequip') this._unequip(id);
    else if (act === 'move') {
      const dest = location === 'mobile' ? 'static' : 'mobile';
      this._moveTo(id, dest);
    }
  }

  _useSelf(id) {
    const found = this._find(id);
    if (!found || found.item.kind === 'container') return;
    this._pendingUseId = id;
    this.bus.emit('showtime.stateChanged');
  }

  /** Target + verb picker for using/offering/forcing/giving an item to a cast member. */
  _openUseDialog(id, location) {
    const found = this._find(id);
    if (!found) return;
    const player = this._playerName();
    const members = getCastMembers(this.storage).filter(c => c.priority !== 'director' && c.priority !== 'star');
    const hints = {
      offer: 'Injects a note offering the item, then waits for their in-character reply to accept or reject.',
      use: 'Injects a note using the item on them, then waits for their in-character reply to accept or reject.',
      force: 'Injects a note forcing the item on them — they may still resist in their reply.',
      give: 'Transfers the item to them immediately. No reply needed.',
    };
    const backdrop = this._buildModal(`
      <div class="inv-modal-title">USE ITEM</div>
      <div class="inv-modal-subtitle">— ${esc(found.item.name)} —</div>
      <div class="inv-modal-field">
        <label>Target</label>
        <select data-field="target">
          <option value="self">Yourself · ${esc(player)}</option>
          ${members.map(m => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('')}
        </select>
      </div>
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
    const saveBtn = backdrop.querySelector('[data-action="save"]');
    const sync = () => {
      backdrop.querySelectorAll('[data-verb]').forEach(b => b.classList.toggle('on', b.dataset.verb === verb));
      backdrop.querySelector('[data-verb-hint]').textContent = verb ? hints[verb] : '';
      saveBtn.textContent = verb === 'give' ? 'Give' : (verb ? 'Propose' : 'Use');
      saveBtn.disabled = target !== 'self' && !verb;
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
        backdrop.remove();
        this._useSelf(id);
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
  _giveToCast(id, location, characterId) {
    const found = this._find(id);
    if (!found) return;
    const cast = this.storage.getChat('cast', { characters: [] });
    const char = (cast.characters ?? []).find(c => c.id === characterId);
    if (!char) { alert('That cast member is gone.'); return; }
    if (!confirm(`Give ${found.item.name} to ${char.name}?`)) return;
    this._transferItemToCast(found.item, found.location, char);
    this.saveState();
    this.bus.emit('inventory.updated');
    this.render(this.container);
  }

  /** Moves (or removes, on destroy) an item from Star's lists into a cast member's belongings. */
  _transferItemToCast(item, location, char, { damage = 'none' } = {}) {
    if (damage === 'destroyed') {
      this.state[location] = this._list(location).filter(x => x.id !== item.id);
      return;
    }
    const condition = damage === 'damaged' ? 'damaged' : (item.condition || 'pristine');
    const bucket = item.category === 'wearable' ? (char.wardrobe ??= []) : (char.props ??= []);
    bucket.push({ id: uid(), name: item.name, description: item.description || '', condition });
    char.updatedAt = Date.now();
    this.bus.emit('cast.updated', { character: char });
    this.state[location] = this._list(location).filter(x => x.id !== item.id);
  }

  /** Offer / Use / Force — injects a note and waits for the target's in-character reply. */
  _proposeUse(id, location, characterId, verb) {
    const found = this._find(id);
    if (!found) return;
    const cast = this.storage.getChat('cast', { characters: [] });
    const char = (cast.characters ?? []).find(c => c.id === characterId);
    if (!char) { alert('That cast member is gone.'); return; }
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
      resolved: null,
      classifyFailed: false,
    };
    this.saveState();
    this.bus.emit('showtime.stateChanged');
    this.render(this.container);
  }

  _cancelPending() {
    this.state.pending = null;
    this.saveState();
    this.render(this.container);
  }

  /** Reads the cast reply that just landed and classifies accept/reject + damage via a quiet prompt. */
  async _classifyPendingUse(pendingId) {
    const chatToken = this._chatToken();
    try {
      const chat = getContext().chat ?? [];
      let reply = '';
      for (let i = chat.length - 1; i >= 0; i--) {
        if (chat[i] && !chat[i].is_user && !chat[i].is_system) { reply = String(chat[i].mes || ''); break; }
      }
      const pending = this.state.pending;
      if (!pending || pending.id !== pendingId) return;
      const verbInfo = USE_VERB_MAP[pending.verb] || USE_VERB_MAP.use;
      const prompt = `[System: Return ONLY JSON. No markdown.]
${pending.playerName} is ${verbInfo.phrase} "${pending.itemName}"${pending.itemDesc ? ` (${pending.itemDesc})` : ''} on ${pending.targetName}.

${pending.targetName}'s latest in-character reply:
"""
${reply.slice(0, 1200)}
"""

Classify the outcome from that reply ONLY.
JSON schema:
{"outcome":"accept_transfer"|"accept_consume"|"reject","damage":"none"|"damaged"|"destroyed","note":""}
- accept_transfer: ${pending.targetName} takes/keeps the item as their own.
- accept_consume: the item gets used up or applied on ${pending.targetName} and no longer exists afterward (e.g. a potion drunk, a bandage used).
- reject: ${pending.targetName} refuses or ignores it — the item stays with ${pending.playerName}.
- damage: only non-"none" if the reply implies the item broke, was damaged, or was destroyed during the exchange (independent of accept/reject).
- note: one short clause explaining the read (<=15 words).
JSON:`;
      const raw = await generateQuietPrompt({ quietPrompt: prompt, trimToSentence: false });
      if (!this._chatTokenStillValid(chatToken)) return;
      const cur = this.state.pending;
      if (!cur || cur.id !== pendingId) return;
      const match = String(raw || '').match(/\{[\s\S]*\}/);
      const parsed = match ? JSON.parse(match[0]) : null;
      const outcome = ['accept_transfer', 'accept_consume', 'reject'].includes(parsed?.outcome) ? parsed.outcome : 'reject';
      const damage = ['none', 'damaged', 'destroyed'].includes(parsed?.damage) ? parsed.damage : 'none';
      cur.classifying = false;
      cur.resolved = { outcome, damage, note: String(parsed?.note || '').trim().slice(0, 160) };
      cur.classifyFailed = !parsed;
      this.saveState();
      this.bus.emit('showtime.stateChanged');
      if (this.container) this.render(this.container);
    } catch (err) {
      console.warn('[Inventory use-on classify]', err);
      if (!this._chatTokenStillValid(chatToken)) return;
      const cur = this.state.pending;
      if (cur && cur.id === pendingId) {
        cur.classifying = false;
        cur.resolved = { outcome: 'reject', damage: 'none', note: '' };
        cur.classifyFailed = true;
        this.saveState();
        if (this.container) this.render(this.container);
      }
    }
  }

  /** Commits the (possibly user-edited) resolution and clears the pending action. */
  _applyPendingResolution(outcome, damage) {
    const pending = this.state.pending;
    if (!pending) return;
    const found = this._find(pending.itemId);
    if (found) {
      if (outcome === 'accept_transfer') {
        const cast = this.storage.getChat('cast', { characters: [] });
        const char = (cast.characters ?? []).find(c => c.id === pending.targetCharacterId);
        if (char) this._transferItemToCast(found.item, found.location, char, { damage });
        else alert('That cast member is gone — item stays with you.');
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
    this.render(this.container);
  }

  /**
   * Cast-initiated direction: scan the message that just rendered for an NPC
   * offering/using/forcing/giving a physical item onto {{user}}. Gated by a
   * cheap regex so the quiet-prompt classification only fires on plausible
   * lines, never on every single message.
   */
  async _scanIncomingOffer() {
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

    const chatToken = this._chatToken();
    try {
      const player = this._playerName();
      const roster = [
        ...(speaker.props ?? []).map(p => `- ${p.name} (prop)`),
        ...(speaker.wardrobe ?? []).map(w => `- ${w.name} (worn)`),
      ].join('\n') || '(none tracked)';
      const prompt = `[System: Return ONLY JSON. No markdown.]
${speaker.name} just said this to ${player} ({{user}}):
"""
${text.slice(0, 1200)}
"""

${speaker.name}'s currently tracked belongings:
${roster}

Decide if ${speaker.name} is offering, using, forcing, or giving a physical item/object to ${player} in that line — not a gesture, glance, or non-physical thing.
JSON schema:
{"detected":true|false,"verb":"offer"|"use"|"force"|"give","itemName":"","itemDesc":"","category":"consumable"|"wearable"|"usable"|"misc"}
- detected=false if nothing physical is being handed over, used on, or forced onto ${player}.
- itemName should exactly match one of ${speaker.name}'s tracked belongings above when it clearly is one of them; otherwise name the new item plainly.
- category is a best guess only when itemName is new.
JSON:`;
      const raw = await generateQuietPrompt({ quietPrompt: prompt, trimToSentence: false });
      if (!this._chatTokenStillValid(chatToken)) return;
      if (this.state.incoming) return; // superseded while we were awaiting the model

      const match = String(raw || '').match(/\{[\s\S]*\}/);
      const parsed = match ? JSON.parse(match[0]) : null;
      if (!parsed?.detected) return;
      const verb = USE_VERB_MAP[parsed.verb] ? parsed.verb : 'offer';
      const itemName = String(parsed.itemName || '').trim().slice(0, 80);
      if (!itemName) return;

      const nameKey = itemName.toLowerCase();
      const matchedProp = (speaker.props ?? []).find(p => String(p.name).trim().toLowerCase() === nameKey);
      const matchedWear = !matchedProp ? (speaker.wardrobe ?? []).find(w => String(w.name).trim().toLowerCase() === nameKey) : null;
      const matched = matchedProp || matchedWear;

      this.state.incoming = {
        id: uid(),
        npcCharacterId: speaker.id,
        npcName: speaker.name,
        verb,
        itemId: matched?.id || null,
        itemBucket: matchedWear ? 'wardrobe' : (matchedProp ? 'props' : null),
        itemName: matched?.name || itemName,
        itemDesc: matched?.description || String(parsed.itemDesc || '').trim().slice(0, 240),
        itemCategory: matchedWear ? 'wearable' : (CATEGORY_MAP[parsed.category] ? parsed.category : 'misc'),
        itemCondition: matched?.condition || 'pristine',
        at: Date.now(),
      };
      this.saveState();
      this.bus.emit('showtime.stateChanged');
      if (this.container) this.render(this.container);
    } catch (err) {
      console.warn('[Inventory incoming scan]', err);
    }
  }

  /** Commits (or discards) an NPC's offer/use/force/give onto {{user}}. */
  _applyIncomingResolution(outcome, damage) {
    const inc = this.state.incoming;
    if (!inc) return;
    const cast = this.storage.getChat('cast', { characters: [] });
    const npc = (cast.characters ?? []).find(c => c.id === inc.npcCharacterId);
    const removeFromNpc = () => {
      if (!npc || !inc.itemId || !inc.itemBucket) return;
      npc[inc.itemBucket] = (npc[inc.itemBucket] ?? []).filter(x => x.id !== inc.itemId);
      npc.updatedAt = Date.now();
    };
    if (outcome === 'accept_transfer') {
      if (damage !== 'destroyed') {
        const condition = damage === 'damaged' ? 'damaged' : (inc.itemCondition || 'pristine');
        this.state.mobile.push({
          id: uid(),
          kind: 'item',
          name: inc.itemName,
          description: inc.itemDesc || '',
          parentId: null,
          location: 'mobile',
          condition,
          category: inc.itemCategory || 'misc',
        });
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

  _inventoryRoster() {
    const rows = [];
    for (const loc of ['mobile', 'static']) {
      for (const x of this._list(loc)) {
        const kind = x.kind === 'container' ? 'container' : 'item';
        const place = loc === 'mobile' ? 'on person' : 'in trunk';
        const parent = x.parentId ? this._list(loc).find(p => p.id === x.parentId) : null;
        const nest = parent ? `, inside ${parent.name}` : '';
        rows.push(`- ${x.name} (${kind}, ${place}${nest})`);
      }
    }
    return rows.join('\n') || 'None';
  }

  async _runAudit(btn) {
    if (!btn) return;
    const orig = btn.textContent;
    btn.disabled = true;
    btn.textContent = '...';
    try {
      const transcript = this._userTranscript();
      if (!transcript.trim()) {
        alert('No {{user}} messages to audit yet.');
        return;
      }
      const player = this._playerName();
      const prompt = `You are filing an inventory claim for ${player} ({{user}}).\n\nRead ONLY the {{user}} messages below. Do not invent items from the persona, the scenario, or anyone else — other speakers are not provided on purpose.\n\nExisting belongings (do not repeat these names):\n${this._inventoryRoster()}\n\n{{user}} messages:\n${transcript}\n\nReturn ONLY a JSON array of objects {{user}} actually mentioned having, carrying, storing, picking up, opening, or wearing.\nINCLUDE: items and containers (bags, packs, boxes, pockets-as-bags, crates, cases).\nEXCLUDE: clothing already implied as a default body, scenery that is not taken, other people's things, and anything not in the {{user}} lines.\nIf nothing new is mentioned, return [].\n\nEach object:\n{"kind":"item"|"container","name":"...","description":"...","condition":"pristine|fine|worn|damaged|broken|ruined","category":"consumable|wearable|usable|misc","location":"person"|"trunk","inside":"","equipped":false}\n- kind container: no category; bags/packs/pouches/boxes that hold other things.\n- location person = carried with {{user}}; trunk = left behind / stored / not on them.\n- inside = name of a container (existing or in this same list), or "".\n- equipped true only if kind is item, category wearable, and {{user}} said they are wearing it.\n- condition from the text; default pristine.\n\nJSON:`;

      const response = String(await withShowtimeProfile(this.storage, 'audit', () =>
        generateQuietPrompt({ quietPrompt: prompt, trimToSentence: false })) ?? '').trim();
      if (!response) throw new Error('Empty audit reply.');
      const match = response.match(/\[[\s\S]*\]/);
      if (!match) throw new Error('No JSON array in the audit reply.');
      const items = JSON.parse(match[0]);
      if (!Array.isArray(items)) throw new Error('Audit reply was not an array.');
      const added = this._applyAuditItems(items);
      if (!added) {
        alert('Nothing new in {{user}} messages.');
        return;
      }
      this.saveState();
      this.bus.emit('inventory.updated');
      this.render(this.container);
    } catch (err) {
      console.error('[Inventory audit]', err);
      alert(`Audit failed: ${err.message}`);
    } finally {
      btn.disabled = false;
      btn.textContent = orig;
    }
  }

  _applyAuditItems(raw) {
    const existing = new Set(
      [...this.state.static, ...this.state.mobile].map(x => String(x.name ?? '').trim().toLowerCase()).filter(Boolean),
    );
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
        };
      })
      .filter(it => !existing.has(it.name.toLowerCase()));

    if (!rows.length) return 0;

    let added = 0;
    const containers = rows.filter(r => r.kind === 'container');
    const others = rows.filter(r => r.kind !== 'container');

    for (const it of containers) {
      if (existing.has(it.name.toLowerCase())) continue;
      this._list(it.location).push({
        id: uid(),
        kind: 'container',
        name: it.name,
        description: it.description,
        parentId: null,
        location: it.location,
        condition: it.condition,
      });
      existing.add(it.name.toLowerCase());
      added += 1;
    }

    for (const it of others) {
      if (existing.has(it.name.toLowerCase())) continue;
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

  _condenseItem(item, loc) {
    const cond = CONDITION_MAP[item.condition]?.label ?? 'Pristine';
    const cat = item.kind === 'container' ? 'Container' : (CATEGORY_MAP[item.category]?.label ?? 'Item');
    const place = loc === 'mobile' || item.location === 'mobile' ? 'on person' : 'in trunk';
    const eq = item.equippedTo?.type === 'player' ? ', equipped' : '';
    const desc = String(item.description ?? '').trim();
    const tail = desc ? ` — ${clipText(desc, 80)}` : '';
    return `- ${item.name} (${cat}, ${cond}, ${place}${eq})${tail}`;
  }

  _buildItemInjection() {
    try {
      if (this.storage.getChat('backstage', {})?.trackers?.items?.enabled === false) return '';
    } catch { /* ignore */ }
    const lines = [];
    const pending = this.state.pending;
    if (pending && !pending.resolved) {
      const verbInfo = USE_VERB_MAP[pending.verb] || USE_VERB_MAP.use;
      const desc = String(pending.itemDesc || '').trim();
      lines.push(`[Note: ${pending.playerName} is ${verbInfo.phrase} ${pending.itemName}${desc ? ` (${clipText(desc, 80)})` : ''} on ${pending.targetName}. ${pending.targetName}, respond in character and make it clear whether you accept, reject, or otherwise react.]`);
    }
    const used = this._pendingUseId ? this._find(this._pendingUseId) : null;
    if (used) {
      const cond = CONDITION_MAP[used.item.condition]?.label ?? 'Pristine';
      const desc = String(used.item.description ?? '').trim();
      lines.push(`[Note: ${this._playerName()} uses ${used.item.name} (${cond})${desc ? ` — ${clipText(desc, 80)}` : ''}]`);
    }
    const hay = this._scanText();
    const hits = [];
    if (hay.trim()) {
      for (const loc of ['mobile', 'static']) {
        for (const item of this._list(loc)) {
          if (used && item.id === used.item.id) continue;
          if (this._itemCueHit(item, hay)) hits.push(this._condenseItem(item, loc));
        }
      }
      if (hits.length) {
        lines.push(`[Items at hand:\n${hits.join('\n')}]`);
      }
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
      alert('Item tracking is disabled under Stage → Trackers → Items.');
      return;
    }
    if (pol.castCanCraft === false) {
      alert('Making / adding items is disabled under Stage → Trackers → Items.');
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
      <div class="inv-modal-subtitle">— property claim · ${esc(LOCS[location].title)} —</div>
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
      <div class="inv-modal-field"><label>Name</label>
        <input type="text" data-field="name" value="${esc(item.name)}"></div>
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
      <div class="inv-modal-field" data-parent-wrap>
        <label>Inside a container (optional)</label>
        <select data-field="parentId">
          <option value="">— Loose in this section —</option>
          ${containers.map(c =>
            `<option value="${c.id}" ${item.parentId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`,
          ).join('')}
        </select>
      </div>
      <div class="inv-modal-actions">
        ${isEdit ? `<button class="inv-btn" data-action="move" style="margin-right:auto">→ ${esc(otherLabel)}</button>` : ''}
        <button class="inv-btn" data-action="cancel">Cancel</button>
        <button class="inv-btn" data-action="save">${isEdit ? 'Save' : 'Add'}</button>
      </div>
    `);

    let kind = isEdit ? (item.kind === 'container' ? 'container' : 'item') : null;
    let category = CATEGORY_MAP[item.category] ? item.category : 'misc';

    const syncKind = () => {
      backdrop.querySelectorAll('.inv-kind-btn').forEach(b => {
        b.classList.toggle('on', b.dataset.kind === kind);
      });
      const picked = !!kind;
      const isC = kind === 'container';
      backdrop.querySelector('[data-cat-wrap]').style.display = picked && !isC ? '' : 'none';
      backdrop.querySelector('[data-cond-wrap]').style.display = picked ? '' : 'none';
      backdrop.querySelector('[data-parent-wrap]').style.display = picked && !isC ? '' : 'none';
    };
    const syncCat = () => {
      backdrop.querySelectorAll('.inv-cat-btn').forEach(b => {
        b.classList.toggle('on', b.dataset.cat === category);
      });
    };
    syncKind();
    syncCat();

    backdrop.querySelectorAll('.inv-kind-btn').forEach(b => {
      b.addEventListener('click', () => { kind = b.dataset.kind; syncKind(); });
    });
    backdrop.querySelectorAll('.inv-cat-btn').forEach(b => {
      b.addEventListener('click', () => { category = b.dataset.cat; syncCat(); });
    });
    backdrop.querySelector('[data-action="cancel"]').addEventListener('click', () => backdrop.remove());
    backdrop.addEventListener('click', e => { if (e.target === backdrop) backdrop.remove(); });

    if (isEdit) {
      backdrop.querySelector('[data-action="move"]')?.addEventListener('click', () => {
        this._moveTo(existing.id, other);
        backdrop.remove();
      });
    }

    backdrop.querySelector('[data-action="save"]').addEventListener('click', () => {
      if (!kind) { alert('Choose Container or Item first.'); return; }
      const name = backdrop.querySelector('[data-field="name"]').value.trim();
      if (!name) { alert('Name is required.'); return; }
      const description = backdrop.querySelector('[data-field="description"]').value.trim();
      const condition = backdrop.querySelector('[data-field="condition"]').value;
      let parentId = backdrop.querySelector('[data-field="parentId"]').value || null;
      if (kind === 'container') parentId = null;

      if (isEdit) {
        if (existing.kind === 'container' && kind === 'item') {
          const kids = this._children(location, existing.id);
          if (kids.length) {
            alert('Empty this container before turning it into an item.');
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
      } else {
        const row = {
          id: uid(),
          kind,
          name,
          description,
          parentId,
          location,
          condition,
        };
        if (kind === 'item') row.category = category;
        this._list(location).push(row);
      }
      this.saveState();
      this.bus.emit('inventory.updated');
      backdrop.remove();
      this.render(this.container);
    });
    setTimeout(() => backdrop.querySelector('[data-field="name"]').focus(), 0);
  }

  _moveTo(id, dest) {
    const found = this._find(id);
    if (!found || found.location === dest) return;
    const srcList = this._list(found.location);
    const destList = this._list(dest);
    const movingIds = new Set([id, ...this._descendants(found.location, id)]);
    const batch = srcList.filter(x => movingIds.has(x.id));
    found.item.parentId = null;
    for (const x of batch) {
      x.location = dest;
    }
    this.state[found.location] = srcList.filter(x => !movingIds.has(x.id));
    destList.push(...batch);
    this.saveState();
    this.bus.emit('inventory.updated');
    this.render(this.container);
  }

  _remove(id) {
    const found = this._find(id);
    if (!found) return;
    const label = found.item.name || 'this belonging';
    if (!confirm(`Remove ${label}?`)) return;
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
        <div class="inv-modal-hint">Adds this wearable to that character's wardrobe tracker. Further mechanics come later.</div>
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
    this._unequip(item.id, { silent: true, skipRender: true });
    if (targetVal === 'player') {
      item.equippedTo = { type: 'player' };
    } else if (targetVal.startsWith('cast:')) {
      const characterId = targetVal.slice(5);
      const cast = this.storage.getChat('cast', { characters: [] });
      const char = (cast.characters ?? []).find(c => c.id === characterId);
      if (!char) { alert('That cast member is gone.'); return; }
      (char.wardrobe ??= []).push({
        id: uid(),
        name: item.name,
        description: item.description ?? '',
        condition: item.condition || 'pristine',
        inventoryId: item.id,
      });
      char.updatedAt = Date.now();
      item.equippedTo = { type: 'cast', characterId, name: char.name };
      this.bus.emit('cast.updated', { character: char });
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
    return {
      name: item.name,
      description: item.description ?? '',
      condition: item.condition || 'pristine',
      inventoryId: item.id,
    };
  }

  _mergeLinked(existing, invItems) {
    const manual = (existing ?? []).filter(x => !x.inventoryId);
    const prev = new Map((existing ?? []).filter(x => x.inventoryId).map(x => [x.inventoryId, x]));
    const linked = invItems.map(it => {
      const old = prev.get(it.id);
      return { id: old?.id ?? uid(), ...this._asLoadout(it) };
    });
    return [...linked, ...manual];
  }

  _syncStarLoadout() {
    const star = this._starChar();
    if (!star) return;
    const all = [...(this.state.static ?? []), ...(this.state.mobile ?? [])];
    const equipped = all.filter(x => x.kind !== 'container' && x.equippedTo?.type === 'player');
    const onPerson = (this.state.mobile ?? []).filter(x => !x.equippedTo);
    star.wardrobe = this._mergeLinked(star.wardrobe, equipped);
    star.props = this._mergeLinked(star.props, onPerson);
    star.updatedAt = Date.now();
    this.storage.saveChat();
    this.bus.emit('cast.updated', { character: star });
  }

  _unequip(id, { silent = false, skipRender = false } = {}) {
    const found = this._find(id);
    if (!found) return;
    const item = found.item;
    const eq = item.equippedTo;
    if (eq?.type === 'cast' && eq.characterId) {
      const cast = this.storage.getChat('cast', { characters: [] });
      const char = (cast.characters ?? []).find(c => c.id === eq.characterId);
      if (char) {
        char.wardrobe = (char.wardrobe ?? []).filter(w => w.inventoryId !== item.id);
        char.updatedAt = Date.now();
        this.bus.emit('cast.updated', { character: char });
      }
    }
    item.equippedTo = null;
    this.saveState();
    this.bus.emit('inventory.updated');
    if (!skipRender && this.container) this.render(this.container);
  }

  _buildModal(inner) {
    const backdrop = document.createElement('div');
    backdrop.className = 'inv-modal-backdrop';
    backdrop.innerHTML = `<div class="inv-modal">${inner}</div>`;
    document.body.appendChild(backdrop);
    return backdrop;
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
