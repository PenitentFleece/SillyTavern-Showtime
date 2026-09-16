// Cast Module — priorities (incl. Director), item descriptions + conditions, character stats.
import { getContext } from '../../../../../extensions.js';
import { power_user } from '../../../../../power-user.js';
import { user_avatar } from '../../../../../personas.js';
import { Module } from '../../lib/module.js';
import {
  PRIORITIES, PRIORITY_MAP, DIRECTION_FIELDS, ensureDirectorDirection,
  priorityMeta,
  formatDirectorPromptBlock, resolveCastPromptIdentity, directorKeywords,
  normalizeAliases, resolveChatSpeaker, castDisplayName, castNameMatches,
  PRONOUN_APPARENT_OPTIONS, PRONOUN_PREFERRED_OPTIONS,
  normalizePronouns, formatPronounsPromptLine,
  normalizePlotHook, priorityColor,
} from '../../lib/castCatalog.js';
import {
  isAspectEvolutiaAvailable,
  pullEvolutiaDescription,
  pullEvolutiaPersona,
  resolveCardDescription,
  resolvePersonaDescription,
  listAlterEgos,
  getCardEvolutiaState,
  getPersonaEvolutiaState,
} from '../../lib/aspectBridge.js';
import {
  generateQuietPrompt,
  generateRaw,
  eventSource,
  event_types,
  getThumbnailUrl,
  updateMessageBlock,
  saveChatDebounced,
} from '../../../../../../script.js';
import { withShowtimeProfile } from '../../lib/connectionProfile.js';
import { inPlayMemberIds, clipText, compactStatusCueInject, recentPlayMessages } from '../../lib/chatTrack.js';
const STATS_ELIGIBLE = new Set(['star', 'lead', 'major', 'foil']);
const UNIQUE_ROLES = {
  director: { demoteTo: 'major' },
  star: { demoteTo: 'lead' },
};

const STAT_DEFS = {
  base: [
    {
      id: 'health', label: 'Health', color: '#7a1f1f', direction: 'up',
      thresholds: [
        { at: 15,  label: 'Dying' },
        { at: 30,  label: 'Critical' },
        { at: 50,  label: 'Wounded' },
        { at: 70,  label: 'Injured' },
        { at: 85,  label: 'Hurt' },
        { at: 95,  label: 'Uncomfortable' },
        { at: 101, label: 'Healthy' },
      ],
    },
    {
      id: 'energy', label: 'Energy', color: '#c9a24a', direction: 'up',
      thresholds: [
        { at: 20,  label: 'Exhausted' },
        { at: 50,  label: 'Drained' },
        { at: 80,  label: 'Tired' },
        { at: 95,  label: 'Rested' },
        { at: 101, label: 'Energized' },
      ],
    },
  ],
  hard: [
    {
      id: 'hunger', label: 'Satiety', color: '#a86b2b', direction: 'up', group: 'Satiation',
      thresholds: [
        { at: 25,  label: 'Starving' },
        { at: 60,  label: 'Hungry' },
        { at: 80,  label: 'Peckish' },
        { at: 95,  label: 'Full' },
        { at: 101, label: 'Sated' },
      ],
    },
    {
      id: 'thirst', label: 'Hydration', color: '#4a7fa8', direction: 'up', group: 'Satiation',
      thresholds: [
        { at: 25,  label: 'Dehydrated' },
        { at: 60,  label: 'Parched' },
        { at: 80,  label: 'Thirsty' },
        { at: 95,  label: 'Content' },
        { at: 101, label: 'Slaked' },
      ],
    },
    {
      id: 'bathroom', label: 'Bladder', direction: 'down', group: 'Needs',
      thresholds: [
        { at: 40,  label: 'Empty' },
        { at: 70,  label: 'Comfortable' },
        { at: 85,  label: 'Pressing' },
        { at: 95,  label: 'Urgent' },
        { at: 101, label: 'Bursting' },
      ],
    },
    {
      id: 'hygiene', label: 'Odor', direction: 'down', group: 'Needs',
      thresholds: [
        { at: 40,  label: 'Fresh' },
        { at: 65,  label: 'Musty' },
        { at: 85,  label: 'Rank' },
        { at: 95,  label: 'Foul' },
        { at: 101, label: 'Reeking' },
      ],
    },
  ],
};

const ALL_STAT_DEFS = [...STAT_DEFS.base, ...STAT_DEFS.hard];
const THRESHOLD_NOTIFY_STATS = new Set(['bathroom', 'hygiene']);

const DEFAULT_STATS = () => ({
  enabled: false,
  hardMode: false,
  health: 100,
  energy: 100,
  hunger: 100,
  thirst: 100,
  bathroom: 0,
  hygiene: 0,
});

function stateLabel(def, val) {
  if (def.levelMode === 'none') return '';
  if (def.levelMode === 'amount') return String(val);
  const t = def.thresholds ?? [];
  for (let i = 0; i < t.length; i++) {
    if (val < t[i].at) return t[Math.max(0, i)].label;
  }
  return t[t.length - 1]?.label ?? '';
}

function customBarDefsFromTrackers(storage) {
  try {
    const bars = storage.getChat('backstage', {})?.trackers?.status?.customBars;
    if (!Array.isArray(bars)) return [];
    return bars.map(b => {
      try {
        const levels = Array.isArray(b?.levels) ? b.levels : [];
        return {
          id: String(b.id || ''),
          label: String(b.name || 'Custom'),
          color: b.color || '#6a8a4a',
          direction: b.direction === 'down' ? 'down' : 'up',
          levelMode: ['none', 'label', 'amount'].includes(b.levelMode) ? b.levelMode : 'label',
          description: String(b.description || ''),
          thresholds: levels.map(lv => ({
            at: Number(lv?.at) || 0,
            label: String(lv?.label || ''),
          })).concat([{ at: 101, label: levels.slice(-1)[0]?.label || '' }]),
          custom: true,
        };
      } catch {
        return null;
      }
    }).filter(d => d && d.id);
  } catch {
    return [];
  }
}

function statusTrackingMasterOn(storage) {
  try {
    return storage.getChat('backstage', {})?.trackers?.status?.enabled !== false;
  } catch {
    return true;
  }
}

const CONDITIONS = [
  { id: 'pristine', label: 'Pristine', color: '#6b8f4a' },
  { id: 'fine',     label: 'Fine',     color: '#7a9e52' },
  { id: 'worn',     label: 'Worn',     color: '#8a9a4a' },
  { id: 'damaged',  label: 'Damaged',  color: '#c9a24a' },
  { id: 'broken',   label: 'Broken',   color: '#c4772b' },
  { id: 'ruined',   label: 'Ruined',   color: '#7a1f1f' },
];
const CONDITION_MAP = Object.fromEntries(CONDITIONS.map(c => [c.id, c]));


export class CastModule extends Module {
  static id = 'cast';
  static label = 'Cast';
  static scope = 'chat';

  // ─── lifecycle ───────────────────────────────────────────────────────────────

  async init() {
    const href = new URL('./cast.css', import.meta.url).href;
    if (!document.querySelector(`link[data-showtime="cast"]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.dataset.showtime = 'cast';
      document.head.appendChild(link);
    }
    this._expandedIds = new Set();
    this._pendingStatAlert = null;
    this._auditBusy = false;
    this._auditLastAt = 0;

    // Clear one-shot stat alert after the AI's reply lands.
    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, (messageId) => {
      if (this._pendingStatAlert) {
        this._pendingStatAlert = null;
        this.bus.emit('showtime.stateChanged');
      }
      this._applyChatDisplayName(messageId);
    });
    eventSource.on(event_types.MESSAGE_RECEIVED, (messageId) => {
      this._applyChatDisplayName(messageId, { silent: true });
    });

    this._registerInjections();
    this.bus?.on('trackers.updated', () => {
      if (this.container) this._renderList();
    });
  }

  /**
   * If a cast member's Showtime name (or Director → Reply as) differs from the
   * ST card name, rewrite the chat bubble so it shows as the cast identity.
   */
  _applyChatDisplayName(messageId, { silent = false } = {}) {
    try {
      const ctx = getContext();
      const chat = ctx.chat;
      const idx = Number(messageId);
      if (!Number.isFinite(idx) || !chat?.[idx]) return;
      const mes = chat[idx];
      if (mes.is_user || mes.is_system) return;

      const avatar = String(mes.original_avatar || '').trim();
      const speaker = resolveChatSpeaker(this.storage, {
        avatar,
        spokenName: mes.name || '',
      });
      if (!speaker) return;

      const wantName = castDisplayName(speaker);
      if (!wantName || wantName === String(mes.name || '').trim()) return;

      mes.name = wantName;
      if (speaker.portrait) {
        mes.force_avatar = speaker.portrait;
      } else if (speaker.characterCardId && speaker.characterCardId !== avatar) {
        mes.force_avatar = getThumbnailUrl('avatar', speaker.characterCardId);
        mes.original_avatar = speaker.characterCardId;
      }

      mes.extra = mes.extra && typeof mes.extra === 'object' ? mes.extra : {};
      mes.extra.showtimeCastId = speaker.id;

      if (!silent) {
        try {
          updateMessageBlock(idx, mes, { rerenderMessage: false });
        } catch { /* ignore */ }
        const root = document.querySelector(`#chat .mes[mesid="${idx}"]`);
        const nameEl = root?.querySelector('.name_text');
        if (nameEl) nameEl.textContent = wantName;
        const face = root?.querySelector('.avatar img');
        if (face && mes.force_avatar) face.setAttribute('src', mes.force_avatar);
      }
      saveChatDebounced();
    } catch (err) {
      console.warn('[Showtime Cast] chat display name', err);
    }
  }

  getDefaultState() {
    return { characters: [], sortBy: 'priority', filterQuery: '', hiddenRoles: [] };
  }

  _hiddenRoles() {
    const raw = Array.isArray(this.state.hiddenRoles) ? this.state.hiddenRoles : [];
    const ids = new Set(PRIORITIES.map(p => p.id));
    return raw.map(r => String(r || '').toLowerCase()).filter(r => ids.has(r));
  }

  /** Float a <details> popover body on document.body so overflow:hidden ancestors don't clip it. */
  _pinToolbarPop(details, bodySelector) {
    if (!details) return;
    const body = details.querySelector(bodySelector);
    if (!body) return;
    const place = () => {
      if (!details.open) {
        if (body.parentElement !== details) details.appendChild(body);
        body.style.position = '';
        body.style.top = '';
        body.style.right = '';
        body.style.left = '';
        body.style.zIndex = '';
        return;
      }
      const r = details.getBoundingClientRect();
      const maxH = Math.min(240, Math.max(120, window.innerHeight - r.bottom - 12));
      document.body.appendChild(body);
      body.style.position = 'fixed';
      body.style.top = `${Math.round(r.bottom + 4)}px`;
      body.style.right = `${Math.round(Math.max(8, window.innerWidth - r.right))}px`;
      body.style.left = 'auto';
      body.style.zIndex = '10050';
      body.style.maxHeight = `${maxH}px`;
    };
    details.addEventListener('toggle', place);
    const onDoc = e => {
      if (!details.open) return;
      if (details.contains(e.target) || body.contains(e.target)) return;
      details.open = false;
    };
    document.addEventListener('pointerdown', onDoc, true);
    // stash so re-render can drop the old outside listener if needed
    details._castPopCleanup = () => {
      document.removeEventListener('pointerdown', onDoc, true);
      if (body.parentElement !== details) details.appendChild(body);
    };
  }

  async onChatChanged() {
    this._expandedIds = new Set();
    if (this.container) await this.render(this.container);
  }

  // ─── render ──────────────────────────────────────────────────────────────────

  async render(container) {
    this.container = container;
    const s = this.state;
    s.hiddenRoles = this._hiddenRoles();
    const hidden = new Set(s.hiddenRoles);
    const hideN = hidden.size;
    // Detach any previously portaled roles body before wiping the pane
    document.querySelectorAll('.cast-roles-pop-body').forEach(n => {
      if (n.parentElement === document.body) n.remove();
    });
    container.innerHTML = `
      <div class="cast-root">
      <div class="cast-toolbar">
        <input type="search" placeholder="Search cast..." value="${esc(s.filterQuery)}" data-role="filter">
        <select data-role="sort">
          <option value="priority" ${s.sortBy === 'priority' ? 'selected' : ''}>By Priority</option>
          <option value="name"     ${s.sortBy === 'name'     ? 'selected' : ''}>By Name</option>
          <option value="recent"   ${s.sortBy === 'recent'   ? 'selected' : ''}>By Recent</option>
        </select>
        <details class="cast-roles-pop" data-role="roles-pop">
          <summary class="cast-btn${hideN ? ' cast-btn--active' : ''}" title="Hide selected roles from the list">Roles${hideN ? ` · ${hideN}` : ''}</summary>
          <div class="cast-roles-pop-body">
            <p class="cast-roles-hint">Uncheck a role to hide it from the list.</p>
            ${PRIORITIES.map(p => `
              <label class="cast-roles-opt">
                <input type="checkbox" data-role-hide="${esc(p.id)}" ${hidden.has(p.id) ? '' : 'checked'}>
                <span style="color:${esc(priorityMeta(p.id).color)}">${esc(p.label)}</span>
              </label>`).join('')}
            <button type="button" class="cast-btn" data-role="roles-show-all" ${hideN ? '' : 'disabled'}>Show all</button>
          </div>
        </details>
        <button class="cast-btn" data-role="import" title="Import characters from current chat">+ From Chat</button>
        <button class="cast-btn" data-role="import-personas" title="Import from user personas">+ From Personas</button>
        <button class="cast-btn" data-role="add">+ Cast</button>
      </div>
      <div class="cast-list" data-role="list"></div>
      </div>
    `;
    container.querySelector('[data-role="filter"]').addEventListener('input', e => {
      this.state.filterQuery = e.target.value;
      this.saveState();
      this._renderList();
    });
    container.querySelector('[data-role="sort"]').addEventListener('change', e => {
      this.state.sortBy = e.target.value;
      this.saveState();
      this._renderList();
    });
    const rolesPop = container.querySelector('[data-role="roles-pop"]');
    const rolesBody = rolesPop?.querySelector('.cast-roles-pop-body');
    this._pinToolbarPop(rolesPop, '.cast-roles-pop-body');
    const syncRolesChrome = () => {
      const next = this._hiddenRoles();
      const n = next.size;
      const sum = rolesPop?.querySelector('summary');
      if (sum) {
        sum.textContent = n ? `Roles · ${n}` : 'Roles';
        sum.classList.toggle('cast-btn--active', n > 0);
      }
      const showAll = rolesBody?.querySelector('[data-role="roles-show-all"]');
      if (showAll) showAll.disabled = n === 0;
    };
    rolesBody?.addEventListener('change', e => {
      const inp = e.target.closest('[data-role-hide]');
      if (!inp) return;
      const id = inp.dataset.roleHide;
      const next = new Set(this._hiddenRoles());
      if (inp.checked) next.delete(id);
      else next.add(id);
      this.state.hiddenRoles = [...next];
      this.saveState();
      syncRolesChrome();
      this._renderList();
    });
    rolesBody?.querySelector('[data-role="roles-show-all"]')?.addEventListener('click', e => {
      e.preventDefault();
      this.state.hiddenRoles = [];
      this.saveState();
      this.render(this.container);
    });
    container.querySelector('[data-role="add"]').addEventListener('click', () => this._openCastingCall());
    container.querySelector('[data-role="import"]').addEventListener('click', () => this._openImportFromChat());
    container.querySelector('[data-role="import-personas"]').addEventListener('click', () => this._openImportFromPersonas());
    this._renderList();
  }

  _renderList() {
    const listEl = this.container.querySelector('[data-role="list"]');
    const items = this._sortedFiltered();
    if (!items.length) {
      listEl.innerHTML = `<div class="cast-empty">No cast members yet. Click <em>+ Cast</em> to add one.</div>`;
      return;
    }
    listEl.innerHTML = items.map(c => this._renderRow(c)).join('');
    this._bindRows(listEl);
  }

  _renderRow(c) {
    const p = priorityMeta(c.priority);
    const display = this._resolveDisplay(c);
    const portrait = display.portrait
      ? `<img src="${esc(display.portrait)}" alt="">`
      : esc((display.name || '?').charAt(0).toUpperCase());
    const inScene = c.characterCardId && this._getInCurrentChat().has(c.characterCardId);
    const isExp = this._expandedIds.has(c.id);
    const cls = ['cast-row', c.priority, isExp && 'expanded', inScene && 'in-scene'].filter(Boolean).join(' ');
    return `
      <div class="${cls}" data-id="${c.id}" style="border-left-color:${p.color}">
        <div class="cast-row-header">
          <div class="cast-row-portrait">${portrait}</div>
          <div class="cast-row-main">
            <div class="cast-row-name">
              ${esc(display.name || 'Unnamed')}
              <span class="cast-row-badge" style="border-color:${p.color};color:${p.color}">${p.label}</span>
              ${c.characterCardId || c.personaId ? `<span class="cast-row-link" title="${c.personaId ? 'Linked to persona' : 'Linked to character card'}">${c.personaId ? '☆' : '⚭'}</span>` : ''}
              ${inScene ? `<span class="cast-row-scene" title="Present in current chat">●</span>` : ''}
              ${c.replyAsId ? `<span class="cast-row-link" title="Director replies as ${esc(this._find(c.replyAsId)?.name || 'cast')}">→</span>` : ''}
            </div>
            ${normalizeAliases(c.aliases).length
              ? `<div class="cast-row-aliases">${esc(normalizeAliases(c.aliases).join(' · '))}</div>`
              : ''}
          </div>
          <div class="cast-row-actions">
            <button class="cast-btn small" data-action="edit">Edit</button>
            <button class="cast-btn small danger" data-action="delete">×</button>
          </div>
          ${p.hasDetails ? `<button class="cast-row-toggle" data-action="toggle" title="Details">${isExp ? '▾' : '▸'}</button>` : ''}
        </div>
        ${p.hasDetails && isExp ? this._renderDetails(c) : ''}
      </div>
    `;
  }

  _renderDetails(c) {
    if (c.priority === 'director') return this._renderDirectorDetails(c);
    return `
      <div class="cast-details">
        ${STATS_ELIGIBLE.has(c.priority) ? this._renderStats(c) : ''}
        <h4>${c.priority === 'star' ? 'Wardrobe <span class="cast-sync-tag">equipped</span>' : 'Wardrobe'} <button class="cast-audit" data-action="audit-wardrobe">Audit</button></h4>
        ${this._renderItems(c.wardrobe ?? [], 'wardrobe')}
        <button class="cast-item-add" data-action="add-wardrobe">+ Add wardrobe item</button>
        <h4>${c.priority === 'star' ? 'Props <span class="cast-sync-tag">on person</span>' : 'Props'} <button class="cast-audit" data-action="audit-props">Audit</button></h4>
        ${this._renderItems(c.props ?? [], 'props')}
        <button class="cast-item-add" data-action="add-prop">+ Add prop</button>
        <h4>Condition <button class="cast-audit" data-action="audit-condition">Audit</button></h4>
        <textarea class="cast-condition" data-action="condition"
          placeholder="Current state, mood, injuries, effects...">${esc(c.condition ?? '')}</textarea>
      </div>
    `;
  }

  /**
   * Live bio from a linked character card or persona.
   * Card/persona text is never editable in Showtime — edit the source instead.
   * @param {object|null} char
   * @param {{ source?: string, cardId?: string, personaId?: string, alterEgoId?: string }} [opts]
   */
  _liveBio(char = null, opts = {}) {
    const src = opts.source
      || (opts.personaId || char?.personaId ? 'persona'
        : (opts.cardId || char?.characterCardId ? 'card' : 'manual'));
    const pid = opts.personaId ?? char?.personaId ?? '';
    const cid = opts.cardId ?? char?.characterCardId ?? '';
    const egoId = opts.alterEgoId ?? char?.alterEgoId ?? '';

    if (src === 'persona' && pid) {
      const p = this._getPersonas().find(x => x.id === pid);
      const native = String(p?.description || '').trim();
      const pull = pullEvolutiaPersona(pid, { alterEgoId: egoId, native });
      const fields = [];
      if (pull.available && pull.fields.length) {
        for (const f of pull.fields) {
          fields.push({ name: f.name || 'Field', content: f.content });
        }
        if (!pull.swapEnabled && native
          && !pull.fields.some(f => f.content === native)) {
          fields.unshift({ name: 'Description', content: native });
        }
      } else if (native) {
        fields.push({ name: 'Description', content: native });
      }
      return {
        mode: 'persona',
        fields,
        text: resolvePersonaDescription(pid, native, {
          preferEvolutia: char?.preferEvolutia !== false,
          alterEgoId: egoId,
        }),
        sourceLabel: 'Persona',
        alterEgoId: pull.alterEgoId || '',
        alterEgoName: pull.alterEgoName || '',
        alterEgos: pull.alterEgos || listAlterEgos(getPersonaEvolutiaState(pid)),
        emptyHint: pull.available
          ? 'No Evolutia fields / persona description — edit under Personas or Aspect: Evolutia.'
          : 'No persona description yet — edit it under SillyTavern Personas.',
      };
    }

    if (src === 'card' && cid) {
      const st = (getContext().characters || []).find(x => x.avatar === cid) || null;
      const native = String(st?.description || '').trim();
      const pull = pullEvolutiaDescription(st, { alterEgoId: egoId });
      const fields = [];
      if (pull.available && pull.fields.length) {
        for (const f of pull.fields) {
          fields.push({ name: f.name || 'Field', content: f.content });
        }
        if (!pull.swapEnabled && native
          && !pull.fields.some(f => f.content === native)) {
          fields.unshift({ name: 'Description', content: native });
        }
      } else if (native) {
        fields.push({ name: 'Description', content: native });
      }
      return {
        mode: 'card',
        fields,
        text: resolveCardDescription(st, {
          preferEvolutia: char?.preferEvolutia !== false,
          alterEgoId: egoId,
        }),
        sourceLabel: 'Character card',
        alterEgoId: pull.alterEgoId || '',
        alterEgoName: pull.alterEgoName || '',
        alterEgos: pull.alterEgos || listAlterEgos(getCardEvolutiaState(st)),
        emptyHint: 'No description on this card — edit the character card in SillyTavern.',
      };
    }

    return {
      mode: 'manual',
      fields: [],
      text: String(char?.description || '').trim(),
      sourceLabel: '',
      alterEgoId: '',
      alterEgoName: '',
      alterEgos: [],
      emptyHint: '',
    };
  }

  _renderInfoBoxes(bio, { taggedAlterEgos = [], showEgoTags = false } = {}) {
    if (!bio || bio.mode === 'manual') return '';
    const where = bio.mode === 'persona' ? 'persona' : 'character card';
    const head = bio.alterEgoName
      ? `From ${bio.sourceLabel} · ${bio.alterEgoName}`
      : `From ${bio.sourceLabel}`;
    const tagged = new Set((taggedAlterEgos || []).map(String));
    const egoSelect = (bio.alterEgos?.length > 1 || (bio.alterEgos?.length === 1 && isAspectEvolutiaAvailable()))
      ? `
        <div class="cast-ego-row">
          <label class="cast-ego-label">Alter Ego</label>
          <select data-field="alterEgoId">
            ${bio.alterEgos.map(e =>
              `<option value="${esc(e.id)}" ${e.id === bio.alterEgoId ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}
          </select>
        </div>`
      : '';
    const egoTags = showEgoTags && bio.alterEgos?.length
      ? `
        <div class="cast-ego-tags">
          <div class="cast-info-meta">Tag alter egos for character credits — Script / chat tags matching a tagged ego pull that ego’s fields.</div>
          ${bio.alterEgos.map(e => `
            <label class="cast-ego-tag">
              <input type="checkbox" data-ego-tag="${esc(e.id)}" ${tagged.has(e.id) ? 'checked' : ''}>
              <span>${esc(e.name)}</span>
            </label>`).join('')}
        </div>`
      : '';
    if (!bio.fields.length) {
      return `
        <div class="cast-info-panel">
          <div class="cast-info-meta">${esc(head)} · read-only — edit on the ${where}</div>
          ${egoSelect}
          ${egoTags}
          <div class="cast-info-empty">${esc(bio.emptyHint || 'No information.')}</div>
        </div>`;
    }
    const boxes = bio.fields.map((f, i) => `
      <details class="cast-info-fold"${i === 0 ? ' open' : ''}>
        <summary class="cast-info-fold-sum">${esc(f.name || 'Info')}</summary>
        <div class="cast-info-box-body">${esc(f.content)}</div>
      </details>`).join('');
    return `
      <div class="cast-info-panel">
        <div class="cast-info-meta">${esc(head)} · read-only — edit on the ${where}</div>
        ${egoSelect}
        ${egoTags}
        ${boxes}
      </div>`;
  }

  _renderDirectorDetails(c) {
    const d = ensureDirectorDirection(c);
    const others = this.state.characters.filter(x => x.id !== c.id && x.priority !== 'director');
    const select = (fieldId) => {
      const field = DIRECTION_FIELDS[fieldId];
      return `
        <label class="cast-dir-field">
          <span>${field.label}</span>
          <select data-dir="${fieldId}">
            ${field.options.map(o =>
              `<option value="${o.id}" ${d[fieldId] === o.id ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
          </select>
        </label>`;
    };
    return `
      <div class="cast-details cast-details--director">
        <p class="cast-dir-lead">Production dials — personification &amp; focus. These keywords feed Director events, audits, injections, and any prompt that asks the Director.</p>
        <label class="cast-dir-field">
          <span>Reply as</span>
          <select data-field="replyAsId">
            <option value="">— Director card name —</option>
            ${others.map(o =>
              `<option value="${esc(o.id)}" ${c.replyAsId === o.id ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}
          </select>
        </label>
        <p class="cast-modal-hint" style="margin-top:0">When the Director’s linked ST card posts in chat, show that cast member’s name (and portrait if set) instead.</p>
        <div class="cast-dir-grid">
          ${select('genre')}
          ${select('culture')}
          ${select('era')}
          ${select('narratorTone')}
          ${select('verbosity')}
          ${select('personality')}
          ${select('difficulty')}
          ${select('friction')}
          ${select('pace')}
          <label class="cast-dir-field cast-dir-toggle">
            <span>Casual obscenity</span>
            <label class="cast-dir-check">
              <input type="checkbox" data-dir="casualObscenity" ${d.casualObscenity ? 'checked' : ''}>
              Sex isn’t publicly shamed — frank talk / public intimacy is ordinary
            </label>
          </label>
        </div>
        <h4>Additional notes</h4>
        <textarea class="cast-condition" data-dir="notes"
          placeholder="House rules, taboos to keep, recurring motifs, OOC reminders…">${esc(d.notes ?? '')}</textarea>
        <div class="cast-dir-keywords">${esc(directorKeywords(this.storage, c).join(' · ') || '—')}</div>
        <h4>Plot Hooks <button class="cast-audit" data-action="audit-hooks">Audit</button></h4>
        ${this._renderPlotHooks(c.plotHooks ?? [])}
        <button class="cast-item-add" data-action="add-plot-hook">+ Add plot hook</button>
      </div>
    `;
  }

  _persistDirectorDirection(char) {
    const d = ensureDirectorDirection(char);
    // Keep legacy fields in sync for older readers / migrations.
    char.genreNotes = directorKeywords(this.storage, char).join('; ');
    char.condition = d.notes || '';
    char.updatedAt = Date.now();
    this.saveState();
    this.bus.emit('cast.updated', { character: char });
  }

  _hookAssigneeOptions(selectedId = '') {
    const roster = this.state.characters.filter(c => c.priority !== 'director');
    const opts = [`<option value="">— Unassigned —</option>`];
    for (const m of roster) {
      const label = PRIORITY_MAP[m.priority]?.label || m.priority;
      opts.push(`<option value="${esc(m.id)}" ${m.id === selectedId ? 'selected' : ''}>${esc(m.name)} (${esc(label)})</option>`);
    }
    return opts.join('');
  }

  _matchHookAssignee(raw) {
    const needle = String(raw || '').trim();
    if (!needle) return '';
    const roster = this.state.characters.filter(c => c.priority !== 'director');
    if (roster.some(c => c.id === needle)) return needle;
    const hit = roster.find(c => castNameMatches(c, needle));
    return hit?.id || '';
  }

  _renderPlotHooks(hooks) {
    const list = (hooks ?? []).map(h => normalizePlotHook(h)).filter(Boolean);
    if (!list.length) return `<div class="cast-tag-empty">No plot hooks yet.</div>`;
    return list.map(h => {
      const who = h.assignedTo
        ? this.state.characters.find(c => c.id === h.assignedTo)
        : null;
      const badge = who
        ? `<span class="cast-item-cond" style="background:${priorityColor(who.priority)}">${esc(who.name)}</span>`
        : `<span class="cast-item-cond cast-item-cond--open">Unassigned</span>`;
      return `
      <div class="cast-item${h.active === false ? ' cast-item--inactive' : ''}" style="border-left-color:${who ? priorityColor(who.priority) : 'var(--st-sepia)'}">
        <div class="cast-item-row">
          <label class="cast-item-active" title="Active hooks inject into prompts">
            <input type="checkbox" data-action="toggle-hook" data-hook-id="${esc(h.id)}"
              ${h.active !== false ? 'checked' : ''}>
          </label>
          <span class="cast-item-name">${esc(h.name)}</span>
          ${badge}
          <div class="cast-item-actions">
            <button class="cast-btn small" data-action="edit-hook" data-hook-id="${esc(h.id)}">Edit</button>
            <button class="cast-btn small danger" data-action="remove-hook" data-hook-id="${esc(h.id)}">×</button>
          </div>
        </div>
        ${h.description ? `<div class="cast-item-desc">${esc(h.description)}</div>` : ''}
      </div>`;
    }).join('');
  }

  _renderItems(items, kind) {
    if (!items.length) return `<div class="cast-tag-empty">None</div>`;
    return items.map(x => {
      const cond = CONDITION_MAP[x.condition] ?? CONDITION_MAP.pristine;
      return `
        <div class="cast-item" style="border-left-color:${cond.color}">
          <div class="cast-item-row">
            <span class="cast-item-name">${esc(x.name)}</span>
            <span class="cast-item-cond" style="background:${cond.color}">${cond.label}</span>
            <div class="cast-item-actions">
              <button class="cast-btn small" data-action="edit-${kind}" data-item-id="${x.id}">Edit</button>
              <button class="cast-btn small danger" data-action="remove-${kind}" data-item-id="${x.id}">×</button>
            </div>
          </div>
          ${x.description ? `<div class="cast-item-desc">${esc(x.description)}</div>` : ''}
        </div>
      `;
    }).join('');
  }

  _statColor(def) {
    try {
      const colors = this.storage.getChat('backstage', {})?.trackers?.status?.colors;
      const c = colors?.[def.id];
      if (c && /^#[0-9a-fA-F]{3,8}$/.test(c)) return c;
    } catch { /* ignore */ }
    return def.color || '#6b5a8a';
  }

  _customStatValue(stats, id) {
    const bag = stats?.custom && typeof stats.custom === 'object' ? stats.custom : {};
    if (Object.prototype.hasOwnProperty.call(bag, id)) return clamp(bag[id]);
    return 50;
  }

  _renderStats(c) {
    const stats = c.stats ?? DEFAULT_STATS();
    const customDefs = customBarDefsFromTrackers(this.storage);
    const bar = (def) => {
      const val = def.custom
        ? this._customStatValue(stats, def.id)
        : clamp(stats[def.id] ?? (def.direction === 'down' ? 0 : 100));
      const label = stateLabel(def, val);
      const color = this._statColor(def);
      const fillHtml = def.direction === 'up'
        ? `<div class="cast-stat-fill" style="left:0;width:${val}%;background:${color}"></div>`
        : `<div class="cast-stat-fill down" style="right:0;width:${100 - val}%;background:${color}"></div>`;
      const text = def.levelMode === 'none'
        ? String(val)
        : def.levelMode === 'amount'
          ? String(val)
          : (label ? `${label} · ${val}` : String(val));
      return `
        <div class="cast-stat-row"${def.description ? ` title="${esc(def.description)}"` : ''}>
          <span class="cast-stat-label">${esc(def.label)}</span>
          <div class="cast-stat-bar ${def.direction}" data-stat="${esc(def.id)}" ${def.custom ? 'data-custom="1"' : ''}
            title="Click to set · Right-click for exact value">
            ${fillHtml}
            <span class="cast-stat-text">${esc(text)}</span>
          </div>
          <input type="number" class="cast-stat-input" data-stat-input="${esc(def.id)}" ${def.custom ? 'data-custom="1"' : ''}
            value="${val}" min="0" max="100">
        </div>
      `;
    };
    const baseBars = stats.enabled ? STAT_DEFS.base.map(bar).join('') : '';
    let hardBars = '';
    if (stats.enabled && stats.hardMode) {
      const groups = {};
      STAT_DEFS.hard.forEach(d => { (groups[d.group] ??= []).push(d); });
      hardBars = Object.entries(groups).map(([name, defs]) => `
        <div class="cast-stat-group">
          <div class="cast-stat-group-label">${name}</div>
          ${defs.map(bar).join('')}
        </div>
      `).join('');
    }
    const customBars = stats.enabled && customDefs.length
      ? `<div class="cast-stat-group">
          <div class="cast-stat-group-label">Custom</div>
          ${customDefs.map(bar).join('')}
        </div>`
      : '';
    return `
      <h4>Stats
        <div class="cast-stats-toggles">
          ${stats.enabled ? '<button class="cast-audit" data-action="audit-stats">Audit</button>' : ''}
          <label><input type="checkbox" data-action="stats-enable" ${stats.enabled ? 'checked' : ''}>Track</label>
          ${stats.enabled ? `<label><input type="checkbox" data-action="stats-hard" ${stats.hardMode ? 'checked' : ''}>Hard Mode</label>` : ''}
        </div>
      </h4>
      ${baseBars}
      ${hardBars}
      ${customBars}
    `;
  }

  // ─── event binding ───────────────────────────────────────────────────────────

  _bindRows(listEl) {
    listEl.querySelectorAll('.cast-row').forEach(rowEl => {
      const id = rowEl.dataset.id;
      const char = this._find(id);
      if (!char) return;

      // Always-visible row actions
      rowEl.querySelector('[data-action="edit"]')?.addEventListener('click', () => this._openCastingCall(char));
      rowEl.querySelector('[data-action="delete"]')?.addEventListener('click', () => this._confirmDelete(char));
      rowEl.querySelector('[data-action="toggle"]')?.addEventListener('click', () => {
        this._expandedIds.has(id) ? this._expandedIds.delete(id) : this._expandedIds.add(id);
        this._renderList();
      });

      if (!this._expandedIds.has(id)) return;

      // ── Director detail handlers ──────────────────────────────────────────
      if (char.priority === 'director') {
        ensureDirectorDirection(char);

        rowEl.querySelectorAll('[data-dir]').forEach(el => {
          const key = el.dataset.dir;
          const handler = () => {
            const d = ensureDirectorDirection(char);
            if (key === 'casualObscenity') d.casualObscenity = !!el.checked;
            else d[key] = el.value;
            this._persistDirectorDirection(char);
            if (key !== 'notes') {
              const kw = rowEl.querySelector('.cast-dir-keywords');
              if (kw) kw.textContent = directorKeywords(this.storage, char).join(' · ') || '—';
            }
          };
          el.addEventListener('change', handler);
        });

        rowEl.querySelector('[data-field="replyAsId"]')?.addEventListener('change', e => {
          char.replyAsId = e.target.value || '';
          char.updatedAt = Date.now();
          this.saveState();
          this.bus.emit('cast.updated', { character: char });
        });

        rowEl.querySelector('[data-action="add-plot-hook"]')?.addEventListener('click', () =>
          this._openPlotHookDialog(char));

        rowEl.querySelector('[data-action="audit-hooks"]')?.addEventListener('click', e =>
          this._runAudit(char, 'hooks', e.target));

        rowEl.querySelectorAll('[data-action="edit-hook"]').forEach(btn => {
          const hook = (char.plotHooks ?? []).find(h => h.id === btn.dataset.hookId);
          if (hook) btn.addEventListener('click', () => this._openPlotHookDialog(char, hook));
        });

        rowEl.querySelectorAll('[data-action="remove-hook"]').forEach(btn => {
          btn.addEventListener('click', () => {
            char.plotHooks = (char.plotHooks ?? []).filter(h => h.id !== btn.dataset.hookId);
            char.updatedAt = Date.now();
            this.saveState();
            this.bus.emit('cast.updated', { character: char });
            this._renderList();
          });
        });

        rowEl.querySelectorAll('[data-action="toggle-hook"]').forEach(cb => {
          cb.addEventListener('change', () => {
            const hook = (char.plotHooks ?? []).find(h => h.id === cb.dataset.hookId);
            if (!hook) return;
            hook.active = cb.checked;
            char.updatedAt = Date.now();
            this.saveState();
            this.bus.emit('cast.updated', { character: char });
            cb.closest('.cast-item')?.classList.toggle('cast-item--inactive', !cb.checked);
          });
        });

      // ── Character detail handlers ─────────────────────────────────────────
      } else {
        rowEl.querySelector('[data-action="audit-wardrobe"]')?.addEventListener('click', e =>
          this._runAudit(char, 'wardrobe', e.target));
        rowEl.querySelector('[data-action="audit-props"]')?.addEventListener('click', e =>
          this._runAudit(char, 'props', e.target));
        rowEl.querySelector('[data-action="audit-condition"]')?.addEventListener('click', e =>
          this._runAudit(char, 'condition', e.target));
        rowEl.querySelector('[data-action="audit-stats"]')?.addEventListener('click', e =>
          this._runAudit(char, 'stats', e.target));

        rowEl.querySelector('[data-action="add-wardrobe"]')?.addEventListener('click', () =>
          this._openItemDialog(char, 'wardrobe'));
        rowEl.querySelector('[data-action="add-prop"]')?.addEventListener('click', () =>
          this._openItemDialog(char, 'props'));

        rowEl.querySelectorAll('[data-action="edit-wardrobe"]').forEach(btn => {
          const item = (char.wardrobe ?? []).find(x => x.id === btn.dataset.itemId);
          if (item) btn.addEventListener('click', () => this._openItemDialog(char, 'wardrobe', item));
        });
        rowEl.querySelectorAll('[data-action="edit-props"]').forEach(btn => {
          const item = (char.props ?? []).find(x => x.id === btn.dataset.itemId);
          if (item) btn.addEventListener('click', () => this._openItemDialog(char, 'props', item));
        });
        rowEl.querySelectorAll('[data-action="remove-wardrobe"]').forEach(btn =>
          btn.addEventListener('click', () => this._removeSubItem(char, 'wardrobe', btn.dataset.itemId)));
        rowEl.querySelectorAll('[data-action="remove-props"]').forEach(btn =>
          btn.addEventListener('click', () => this._removeSubItem(char, 'props', btn.dataset.itemId)));

        rowEl.querySelector('[data-action="condition"]')?.addEventListener('change', e => {
          char.condition = e.target.value;
          char.updatedAt = Date.now();
          this.saveState();
          this.bus.emit('cast.updated', { character: char });
        });

        // Stats toggles
        rowEl.querySelector('[data-action="stats-enable"]')?.addEventListener('change', e => {
          if (!char.stats) char.stats = DEFAULT_STATS();
          char.stats.enabled = e.target.checked;
          char.updatedAt = Date.now();
          this.saveState();
          this.bus.emit('cast.updated', { character: char });
          this._renderList();
        });
        rowEl.querySelector('[data-action="stats-hard"]')?.addEventListener('change', e => {
          if (!char.stats) char.stats = DEFAULT_STATS();
          char.stats.hardMode = e.target.checked;
          char.updatedAt = Date.now();
          this.saveState();
          this.bus.emit('cast.updated', { character: char });
          this._renderList();
        });

        // Stat bars — click sets value at click position, right-click prompts for exact
        rowEl.querySelectorAll('.cast-stat-bar').forEach(barEl => {
          const statId = barEl.dataset.stat;
          const isCustom = barEl.dataset.custom === '1';
          barEl.addEventListener('click', e => {
            const r = barEl.getBoundingClientRect();
            const pct = clamp(Math.round((e.clientX - r.left) / r.width * 100));
            this._setStatValue(char, statId, pct, isCustom);
            this._renderList();
          });
          barEl.addEventListener('contextmenu', e => {
            e.preventDefault();
            const cur = isCustom
              ? this._customStatValue(char.stats, statId)
              : (char.stats?.[statId] ?? 0);
            const val = prompt('Set exact value (0–100):', cur);
            if (val === null) return;
            this._setStatValue(char, statId, parseInt(val) || 0, isCustom);
            this._renderList();
          });
        });

        rowEl.querySelectorAll('.cast-stat-input').forEach(inp => {
          inp.addEventListener('change', () => {
            this._setStatValue(char, inp.dataset.statInput, parseInt(inp.value) || 0, inp.dataset.custom === '1');
            this._renderList();
          });
        });
      }
    });
  }

  // ─── state helpers ───────────────────────────────────────────────────────────

  _setStatValue(char, statId, rawVal, isCustom = false) {
    if (!char.stats) char.stats = DEFAULT_STATS();
    if (isCustom) {
      char.stats.custom ??= {};
      char.stats.custom[statId] = clamp(rawVal);
      char.updatedAt = Date.now();
      this.saveState();
      this.bus.emit('cast.updated', { character: char });
      return;
    }
    const prev = char.stats[statId];
    char.stats[statId] = clamp(rawVal);
    char.updatedAt = Date.now();

    // One-shot threshold-crossing alert for bladder and hygiene.
    if (THRESHOLD_NOTIFY_STATS.has(statId) && prev !== undefined) {
      const def = ALL_STAT_DEFS.find(d => d.id === statId);
      if (def) {
        const prevLabel = stateLabel(def, clamp(prev));
        const curLabel  = stateLabel(def, clamp(char.stats[statId]));
        if (prevLabel !== curLabel) {
          const name = this._resolveDisplay(char).name;
          this._pendingStatAlert = `[Note: ${name}'s ${def.label} is now ${curLabel}]`;
        }
      }
    }

    this.saveState();
    this.bus.emit('cast.updated', { character: char });
    if (this._pendingStatAlert) this.bus.emit('showtime.stateChanged');
  }

  _removeSubItem(char, kind, itemId) {
    const item = (char[kind] ?? []).find(x => x.id === itemId);
    char[kind] = (char[kind] ?? []).filter(x => x.id !== itemId);
    char.updatedAt = Date.now();
    this.saveState();
    if (item) this._unlinkStarItem(char, item, kind);
    this.bus.emit('cast.updated', { character: char });
    this._renderList();
  }

  _confirmDelete(char) {
    if (!confirm(`Remove ${char.name} from the cast?`)) return;
    const idx = this.state.characters.findIndex(c => c.id === char.id);
    if (idx < 0) return;
    const [removed] = this.state.characters.splice(idx, 1);
    this._expandedIds.delete(removed.id);
    this.saveState();
    this.bus.emit('cast.removed', { id: removed.id, character: removed });
    this._renderList();
  }

  // ─── injections ──────────────────────────────────────────────────────────────

  _registerInjections() {
    if (!this.injector) return;

    // Always-on: character stat summary for in-scene characters.
    this.injector.register({
      id: 'cast.states',
      always: true,
      buildText: () => this._buildStatesInjection(),
    });

    // Always-on: pronouns for in-scene cast members.
    this.injector.register({
      id: 'cast.pronouns',
      always: true,
      buildText: () => this._buildPronounsInjection(),
    });

    // Always-on: Director's active plot hooks and genre notes.
    this.injector.register({
      id: 'cast.director',
      always: true,
      buildText: () => this._buildDirectorInjection(),
    });

    // One-shot: bladder/hygiene threshold crossing alert.
    this.injector.register({
      id: 'cast.stat_alert',
      always: true,
      buildText: () => this._pendingStatAlert ?? '',
    });

    // Trigger-based: wardrobe.
    this.injector.register({
      id: 'cast.wardrobe',
      triggers: ['wardrobe', 'clothes', 'clothing', 'wearing', 'outfit', 'costume',
                 'gear', 'equip', 'attire', 'dressed'],
      buildText: () => this._buildWardrobeInjection(),
    });

    // Trigger-based: props.
    this.injector.register({
      id: 'cast.props',
      triggers: ['props', 'items', 'pocket', 'pockets', 'inventory',
                 'carrying', 'carry', 'holding', 'hold', 'have on'],
      buildText: () => this._buildPropsInjection(),
    });

    const bump = () => this.bus.emit('showtime.stateChanged');
    this.bus.on('cast.added',   bump);
    this.bus.on('cast.updated', bump);
    this.bus.on('cast.removed', bump);
  }

  _inSceneChars() {
    const inScene = this._getInCurrentChat();
    return this.state.characters.filter(c =>
      c.priority === 'star' ||
      (c.characterCardId && inScene.has(c.characterCardId)));
  }

  _inPlayChars() {
    const chars = this._inSceneChars();
    try {
      const status = this.storage.getChat('backstage', {})?.trackers?.status || {};
      if (status.offScreen) return chars;
      const windowN = Number(status.inPlayWindow) || 10;
      const ids = inPlayMemberIds(this.storage, getContext()?.chat || [], windowN);
      return chars.filter(c => c.priority === 'star' || ids.has(c.id));
    } catch {
      return chars;
    }
  }

  _buildStatesInjection() {
    if (!statusTrackingMasterOn(this.storage)) return '';
    const chars = this._inPlayChars().filter(c => c.stats?.enabled);
    const cues = compactStatusCueInject(
      this.storage,
      getContext()?.chat || [],
      Number(this.storage.getChat('backstage', {})?.trackers?.status?.inPlayWindow) || 8,
    );
    if (!chars.length) return cues || '';
    const customDefs = customBarDefsFromTrackers(this.storage);
    const lines = chars.map(c => {
      const name = this._resolveDisplay(c).name;
      const defs = [...STAT_DEFS.base, ...(c.stats.hardMode ? STAT_DEFS.hard : [])];
      const bits = defs.map(def => {
        const val = clamp(c.stats[def.id] ?? (def.direction === 'down' ? 0 : 100));
        return `${def.label}: ${stateLabel(def, val)}`;
      });
      for (const def of customDefs) {
        const val = this._customStatValue(c.stats, def.id);
        const label = stateLabel(def, val);
        const tip = def.description ? ` (${clipText(def.description, 40)})` : '';
        bits.push(def.levelMode === 'none'
          ? `${def.label}: ${val}${tip}`
          : def.levelMode === 'amount'
            ? `${def.label}: ${val}${tip}`
            : `${def.label}: ${label || val}${tip}`);
      }
      return `- ${name} — ${bits.join(', ')}`;
    });
    const block = `[Character conditions right now:\n${lines.join('\n')}]`;
    return cues ? `${block}\n${cues}` : block;
  }

  _buildPronounsInjection() {
    const lines = this._inPlayChars()
      .map(c => {
        const line = formatPronounsPromptLine({ ...c, name: this._resolveDisplay(c).name });
        return line ? `- ${line}` : '';
      })
      .filter(Boolean);
    if (!lines.length) return '';
    return `[Cast pronouns in scene (use preferred forms in narration):\n${lines.join('\n')}]`;
  }

  _buildDirectorInjection() {
    const director = this.state.characters.find(c => c.priority === 'director');
    if (!director) return '';
    const block = formatDirectorPromptBlock(this.storage, { char: director });
    if (!block || block.startsWith('(No Director')) return '';
    return `[Director production dials:\n${block}]`;
  }

  _buildWardrobeInjection() {
    const chars = this._inSceneChars().filter(c => (c.wardrobe ?? []).length);
    if (!chars.length) return '';
    const lines = chars.map(c => {
      const name = this._resolveDisplay(c).name;
      const modifier = this._wardrobeModifier(c);
      const items = c.wardrobe.map(w => {
        const parts = [w.name];
        if (w.condition && w.condition !== 'pristine') parts.push(`(${w.condition})`);
        if (w.description) parts.push(`— ${clipText(w.description, 80)}`);
        return parts.join(' ');
      }).join('; ');
      return `- ${name} is wearing: ${items}${modifier ? `. ${modifier}` : ''}`;
    });
    return `[Wardrobe:\n${lines.join('\n')}]`;
  }

  _wardrobeModifier(c) {
    if (!c.stats?.enabled) return '';
    const parts = [];
    const health  = clamp(c.stats.health  ?? 100);
    const hygiene = clamp(c.stats.hygiene ?? 0);
    if (health  < 30) parts.push('clothing is visibly bloodied or damaged from injuries');
    else if (health < 60) parts.push('clothing shows signs of hardship and wear');
    if (hygiene > 70) parts.push('clothing carries a foul odor');
    else if (hygiene > 40) parts.push('clothing is somewhat soiled');
    return parts.join('; ');
  }

  _buildPropsInjection() {
    const chars = this._inSceneChars().filter(c => (c.props ?? []).length);
    if (!chars.length) return '';
    const lines = chars.map(c => {
      const name = this._resolveDisplay(c).name;
      const items = c.props.map(p => {
        const parts = [p.name];
        if (p.condition && p.condition !== 'pristine') parts.push(`(${p.condition})`);
        if (p.description) parts.push(`— ${clipText(p.description, 80)}`);
        return parts.join(' ');
      }).join('; ');
      return `- ${name} is carrying: ${items}`;
    });
    return `[Items carried:\n${lines.join('\n')}]`;
  }

  // ─── modals ──────────────────────────────────────────────────────────────────

  _openCastingCall(existing = null) {
    const isEdit = !!existing;
    const c = existing ?? {
      name: '', priority: 'supporting', portrait: '',
      description: '', aliases: [], characterCardId: '', syncFromCard: true,
      personaId: '', syncFromPersona: true, replyAsId: '',
      preferEvolutia: true, alterEgoId: '', taggedAlterEgos: [],
    };
    const cards = this._getCharacterCards();
    const personas = this._getPersonas();
    const inChat = this._getInCurrentChat();
    const chatCards  = cards.filter(x =>  inChat.has(x.id));
    const otherCards = cards.filter(x => !inChat.has(x.id));
    const opt = (list, sel) => list.map(x =>
      `<option value="${esc(x.id)}" ${x.id === sel ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
    const source0 = c.personaId ? 'persona' : c.characterCardId ? 'card' : 'manual';
    const others = this.state.characters.filter(x => (!existing || x.id !== existing.id) && x.priority !== 'director');
    const pronouns = normalizePronouns(c.pronouns);

    const backdrop = this._buildModal(`
      <div class="cast-modal-title">${isEdit ? 'RECAST' : 'CASTING CALL'}</div>
      <div class="cast-modal-subtitle">— A Showtime Production —</div>
      <div class="cast-modal-field">
        <label>Link</label>
        <div class="cast-source-row">
          <button type="button" class="cast-source-btn" data-source="manual">Manual</button>
          <button type="button" class="cast-source-btn" data-source="card">Character card</button>
          <button type="button" class="cast-source-btn" data-source="persona">Persona</button>
        </div>
        <div class="cast-modal-hint">Personas are {{user}} faces. Character cards are NPCs in the tavern. Cast Name can differ from the card — chat will show the Cast name.</div>
      </div>
      <div class="cast-modal-field" data-role="card-wrap">
        <label>Character Card</label>
        <select data-field="cardId">
          <option value="">— Choose a card —</option>
          ${chatCards.length  ? `<optgroup label="In this chat">${opt(chatCards,  c.characterCardId ?? '')}</optgroup>` : ''}
          ${otherCards.length ? `<optgroup label="All characters">${opt(otherCards, c.characterCardId ?? '')}</optgroup>` : ''}
        </select>
      </div>
      <div class="cast-modal-field" data-role="persona-wrap">
        <label>Persona</label>
        <select data-field="personaId">
          <option value="">— Choose a persona —</option>
          ${opt(personas, c.personaId ?? '')}
        </select>
      </div>
      <div class="cast-modal-field" data-role="sync-card-wrap" style="display:none">
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;text-transform:none;letter-spacing:0;font-family:var(--st-font-body);font-size:12px;color:var(--st-ink)">
          <input type="checkbox" data-field="syncFromCard" ${(c.syncFromCard ?? true) ? 'checked' : ''} style="width:auto">
          Keep portrait synced with card
        </label>
      </div>
      <div class="cast-modal-field" data-role="sync-persona-wrap" style="display:none">
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;text-transform:none;letter-spacing:0;font-family:var(--st-font-body);font-size:12px;color:var(--st-ink)">
          <input type="checkbox" data-field="syncFromPersona" ${(c.syncFromPersona ?? true) ? 'checked' : ''} style="width:auto">
          Keep name and portrait synced with persona
        </label>
      </div>
      <div class="cast-modal-field"><label>Name <span class="cast-modal-hint" style="display:inline;text-transform:none;letter-spacing:0">· shown in chat / credits</span></label>
        <input type="text" data-field="name" value="${esc(c.name)}"></div>
      <div class="cast-modal-field"><label>Aliases <span class="cast-modal-hint" style="display:inline;text-transform:none;letter-spacing:0">· comma-separated nicknames / tag names</span></label>
        <input type="text" data-field="aliases" value="${esc(normalizeAliases(c.aliases).join(', '))}" placeholder="e.g. The Captain, Cap, Marcus V."></div>
      <div class="cast-modal-field"><label>Priority</label>
        <select data-field="priority">
          ${PRIORITIES.map(p => `<option value="${p.id}" ${p.id === c.priority ? 'selected' : ''}>${p.label}${p.id === 'star' ? ' · {{user}}' : ''}</option>`).join('')}
        </select>
        <div class="cast-modal-hint" data-role="star-hint" style="display:none">Star is unique — tracked like a Lead (stats, wardrobe, props). Usually a persona.</div>
      </div>
      <div class="cast-modal-field" data-role="reply-as-wrap" style="display:none">
        <label>Reply as</label>
        <select data-field="replyAsId">
          <option value="">— Director card name —</option>
          ${others.map(o =>
            `<option value="${esc(o.id)}" ${c.replyAsId === o.id ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}
        </select>
        <div class="cast-modal-hint">When this Director card speaks in chat, show the chosen cast member instead.</div>
      </div>
      <div class="cast-modal-field"><label>Portrait URL (optional)</label>
        <input type="text" data-field="portrait" value="${esc(c.portrait ?? '')}"></div>
      <div class="cast-modal-field" data-role="info-wrap">
        <label>Information</label>
        <div data-role="info-view"></div>
        <textarea data-field="description" data-role="desc-edit" style="display:none" placeholder="Optional note for manual cast entries…">${esc(c.description ?? '')}</textarea>
        <div class="cast-modal-hint" data-role="desc-manual-hint" style="display:none">Manual entries only — linked cards and personas are read-only here; edit them in SillyTavern.</div>
      </div>
      <div class="cast-modal-field" data-role="pronouns-wrap">
        <label>Pronouns</label>
        <div class="cast-pronouns-grid">
          <div>
            <span class="cast-modal-hint" style="display:block;margin-bottom:2px">Apparent</span>
            <select data-field="pronouns-apparent">
              <option value="">—</option>
              ${PRONOUN_APPARENT_OPTIONS.map(o =>
                `<option value="${o.id}" ${pronouns.apparent === o.id ? 'selected' : ''}>${o.label}</option>`).join('')}
            </select>
          </div>
          <div>
            <span class="cast-modal-hint" style="display:block;margin-bottom:2px">Preferred</span>
            <select data-field="pronouns-preferred">
              <option value="">—</option>
              ${PRONOUN_PREFERRED_OPTIONS.map(o =>
                `<option value="${o.id}" ${pronouns.preferred === o.id ? 'selected' : ''}>${o.label}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="cast-pronouns-custom" data-role="pronouns-custom" style="display:none">
          <div>
            <span class="cast-modal-hint" style="display:block;margin-bottom:2px">Possessive</span>
            <input type="text" data-field="pronouns-possessive" value="${esc(pronouns.custom.possessive)}" placeholder="their">
          </div>
          <div>
            <span class="cast-modal-hint" style="display:block;margin-bottom:2px">Personal</span>
            <input type="text" data-field="pronouns-personal" value="${esc(pronouns.custom.personal)}" placeholder="they">
          </div>
          <div>
            <span class="cast-modal-hint" style="display:block;margin-bottom:2px">Reflexive</span>
            <input type="text" data-field="pronouns-reflexive" value="${esc(pronouns.custom.reflexive)}" placeholder="themselves">
          </div>
        </div>
        <div class="cast-modal-hint">Apparent is how they present; preferred forms feed narration when this cast member is in scene.</div>
      </div>
      <div class="cast-modal-actions">
        <button class="cast-btn" data-action="cancel">Cancel</button>
        <button class="cast-btn" data-action="save">${isEdit ? 'Save' : 'Cast'}</button>
      </div>
    `);

    const cardSel    = backdrop.querySelector('[data-field="cardId"]');
    const personaSel = backdrop.querySelector('[data-field="personaId"]');
    const nameEl     = backdrop.querySelector('[data-field="name"]');
    const aliasEl    = backdrop.querySelector('[data-field="aliases"]');
    const portEl     = backdrop.querySelector('[data-field="portrait"]');
    const descEl     = backdrop.querySelector('[data-field="description"]');
    const infoView   = backdrop.querySelector('[data-role="info-view"]');
    const manualHint = backdrop.querySelector('[data-role="desc-manual-hint"]');
    const priEl      = backdrop.querySelector('[data-field="priority"]');
    const apparentEl = backdrop.querySelector('[data-field="pronouns-apparent"]');
    const preferredEl = backdrop.querySelector('[data-field="pronouns-preferred"]');
    const customWrap = backdrop.querySelector('[data-role="pronouns-custom"]');
    let source = source0;
    let infoSnapshot = String(c.description || '').trim();
    let draftAlterEgoId = String(c.alterEgoId || '').trim();
    let draftTaggedEgos = [...(c.taggedAlterEgos || [])].map(String);

    const syncPronounCustom = () => {
      if (customWrap) customWrap.style.display = preferredEl?.value === 'custom' ? '' : 'none';
    };
    preferredEl?.addEventListener('change', syncPronounCustom);
    syncPronounCustom();

    const collectEgoDraft = () => {
      const sel = infoView.querySelector('[data-field="alterEgoId"]');
      if (sel) draftAlterEgoId = sel.value || '';
      draftTaggedEgos = [...infoView.querySelectorAll('[data-ego-tag]:checked')]
        .map(el => el.getAttribute('data-ego-tag'))
        .filter(Boolean);
    };

    const refreshInfoView = () => {
      if (source === 'manual') {
        infoView.innerHTML = '';
        infoView.style.display = 'none';
        descEl.style.display = '';
        if (manualHint) manualHint.style.display = '';
        infoSnapshot = descEl.value.trim();
        draftAlterEgoId = '';
        draftTaggedEgos = [];
        return;
      }
      descEl.style.display = 'none';
      if (manualHint) manualHint.style.display = 'none';
      infoView.style.display = '';
      if ((source === 'card' && !cardSel.value) || (source === 'persona' && !personaSel.value)) {
        infoView.innerHTML = `<div class="cast-info-empty">Choose a ${source === 'persona' ? 'persona' : 'character card'} to view information.</div>`;
        infoSnapshot = '';
        return;
      }
      const bio = this._liveBio(c, {
        source,
        cardId: cardSel.value,
        personaId: personaSel.value,
        alterEgoId: draftAlterEgoId,
      });
      if (!draftAlterEgoId && bio.alterEgoId) draftAlterEgoId = bio.alterEgoId;
      infoView.innerHTML = this._renderInfoBoxes(bio, {
        taggedAlterEgos: draftTaggedEgos,
        showEgoTags: isAspectEvolutiaAvailable() && (bio.alterEgos?.length > 0),
      });
      infoSnapshot = bio.text || '';
      infoView.querySelector('[data-field="alterEgoId"]')?.addEventListener('change', e => {
        draftAlterEgoId = e.target.value || '';
        refreshInfoView();
      });
      infoView.querySelectorAll('[data-ego-tag]').forEach(box => {
        box.addEventListener('change', () => collectEgoDraft());
      });
    };

    const applyPersona = (id, fillEmptyOnly = false) => {
      const p = personas.find(x => x.id === id);
      if (!p) return;
      if (!fillEmptyOnly || !nameEl.value.trim()) nameEl.value = p.name;
      if (!fillEmptyOnly || !portEl.value.trim()) portEl.value = p.avatarUrl;
      draftAlterEgoId = '';
      refreshInfoView();
    };
    const applyCard = (id, { fillName = true } = {}) => {
      const card = cards.find(x => x.id === id);
      if (!card) return;
      // Only seed name when empty so Cast can keep a different stage name.
      if (fillName && !nameEl.value.trim()) nameEl.value = card.name;
      else if (fillName && !isEdit) nameEl.value = card.name;
      portEl.value = card.avatarUrl;
      draftAlterEgoId = '';
      refreshInfoView();
    };
    const syncSource = () => {
      backdrop.querySelectorAll('.cast-source-btn').forEach(b => {
        b.classList.toggle('on', b.dataset.source === source);
      });
      backdrop.querySelector('[data-role="card-wrap"]').style.display = source === 'card' ? '' : 'none';
      backdrop.querySelector('[data-role="persona-wrap"]').style.display = source === 'persona' ? '' : 'none';
      backdrop.querySelector('[data-role="sync-card-wrap"]').style.display = source === 'card' && cardSel.value ? '' : 'none';
      backdrop.querySelector('[data-role="sync-persona-wrap"]').style.display = source === 'persona' && personaSel.value ? '' : 'none';
      refreshInfoView();
    };
    const syncStarHint = () => {
      backdrop.querySelector('[data-role="star-hint"]').style.display = priEl.value === 'star' ? '' : 'none';
      backdrop.querySelector('[data-role="reply-as-wrap"]').style.display = priEl.value === 'director' ? '' : 'none';
    };

    backdrop.querySelectorAll('.cast-source-btn').forEach(b => {
      b.addEventListener('click', () => { source = b.dataset.source; syncSource(); });
    });
    cardSel.addEventListener('change', () => {
      if (cardSel.value) applyCard(cardSel.value);
      else syncSource();
    });
    personaSel.addEventListener('change', () => {
      if (personaSel.value) applyPersona(personaSel.value);
      else syncSource();
    });
    priEl.addEventListener('change', () => {
      syncStarHint();
      if (priEl.value === 'star' && source === 'manual' && !isEdit) {
        source = 'persona';
        if (!personaSel.value && user_avatar) {
          personaSel.value = user_avatar;
          applyPersona(user_avatar, true);
        }
        syncSource();
      }
    });

    syncSource();
    syncStarHint();

    backdrop.querySelector('[data-action="save"]').addEventListener('click', () => {
      collectEgoDraft();
      const name           = nameEl.value.trim();
      const priority       = priEl.value;
      const portrait       = portEl.value.trim();
      let aliases          = normalizeAliases(aliasEl.value);
      const characterCardId = source === 'card' ? (cardSel.value || '') : '';
      const personaId      = source === 'persona' ? (personaSel.value || '') : '';
      const syncFromCard   = backdrop.querySelector('[data-field="syncFromCard"]')?.checked ?? false;
      const syncFromPersona = backdrop.querySelector('[data-field="syncFromPersona"]')?.checked ?? false;
      const preferEvolutia = source === 'card' || source === 'persona';
      const alterEgoId = (source === 'card' || source === 'persona') ? draftAlterEgoId : '';
      const taggedAlterEgos = (source === 'card' || source === 'persona') ? draftTaggedEgos : [];
      const replyAsId = priority === 'director'
        ? (backdrop.querySelector('[data-field="replyAsId"]')?.value || '')
        : '';
      // Merge tagged alter-ego names into aliases so Script character tags resolve.
      const bioForTags = (source === 'card' || source === 'persona')
        ? this._liveBio(c, { source, cardId: characterCardId, personaId, alterEgoId })
        : null;
      if (bioForTags?.alterEgos?.length && taggedAlterEgos.length) {
        const tagNames = bioForTags.alterEgos
          .filter(e => taggedAlterEgos.includes(e.id))
          .map(e => e.name);
        aliases = normalizeAliases([...aliases, ...tagNames]);
      }
      const alterEgoIndex = (bioForTags?.alterEgos || []).map(e => ({ id: e.id, name: e.name }));
      // Linked bios are live/read-only — snapshot for search & offline.
      const description = source === 'manual'
        ? descEl.value
        : (this._liveBio(c, { source, cardId: characterCardId, personaId, alterEgoId }).text || infoSnapshot || '');
      const pronounsNext = normalizePronouns({
        apparent: apparentEl?.value || '',
        preferred: preferredEl?.value || '',
        custom: {
          possessive: backdrop.querySelector('[data-field="pronouns-possessive"]')?.value || '',
          personal: backdrop.querySelector('[data-field="pronouns-personal"]')?.value || '',
          reflexive: backdrop.querySelector('[data-field="pronouns-reflexive"]')?.value || '',
        },
      });

      if (!name) { alert('Name is required.'); return; }
      if (!this._claimUniqueRole(priority, existing)) return;

      if (isEdit) {
        const prev = structuredClone(existing);
        Object.assign(existing, {
          name, priority, portrait, description, aliases, pronouns: pronounsNext,
          characterCardId, syncFromCard, personaId, syncFromPersona,
          preferEvolutia, alterEgoId, taggedAlterEgos, alterEgoIndex, replyAsId,
          updatedAt: Date.now(),
        });
        if (priority === 'director') ensureDirectorDirection(existing);
        else existing.replyAsId = '';
        this.saveState();
        this.bus.emit('cast.updated', { character: existing, previous: prev });
      } else {
        const newChar = {
          id: uid(), name, priority, portrait, description, aliases, pronouns: pronounsNext,
          characterCardId, syncFromCard, personaId, syncFromPersona,
          preferEvolutia, alterEgoId, taggedAlterEgos, alterEgoIndex, replyAsId,
          wardrobe: [], props: [], condition: '',
          plotHooks: [], genreNotes: '',
          createdAt: Date.now(), updatedAt: Date.now(),
        };
        if (priority === 'director') ensureDirectorDirection(newChar);
        this.state.characters.push(newChar);
        this.saveState();
        this.bus.emit('cast.added', { character: newChar });
      }
      backdrop.remove();
      this._renderList();
    });
    setTimeout(() => nameEl.focus(), 0);
  }

  _claimUniqueRole(priority, existing = null) {
    const rule = UNIQUE_ROLES[priority];
    if (!rule) return true;
    const current = this.state.characters.find(x =>
      x.priority === priority && (!existing || x.id !== existing.id));
    if (!current) return true;
    const label = PRIORITY_MAP[priority]?.label ?? priority;
    const demoteLabel = PRIORITY_MAP[rule.demoteTo]?.label ?? rule.demoteTo;
    const ok = confirm(`${current.name} is currently the ${label}. Reassigning will demote them to ${demoteLabel}. Continue?`);
    if (!ok) return false;
    current.priority = rule.demoteTo;
    current.updatedAt = Date.now();
    this.bus.emit('cast.updated', { character: current });
    return true;
  }

  _openImportFromChat() {
    const cards = this._getCharacterCards();
    const inChat = this._getInCurrentChat();
    const present = cards.filter(c => inChat.has(c.id));
    if (!present.length) { alert('No characters found in the current chat.'); return; }
    const linkedIds = new Set(this.state.characters.map(c => c.characterCardId).filter(Boolean));

    const backdrop = this._buildModal(`
      <div class="cast-modal-title">CALL SHEET</div>
      <div class="cast-modal-subtitle">— Import from current chat —</div>
      <div class="cast-modal-field"><label>Priority for imported</label>
        <select data-field="priority">
          ${PRIORITIES.filter(p => !UNIQUE_ROLES[p.id]).map(p =>
            `<option value="${p.id}" ${p.id === 'supporting' ? 'selected' : ''}>${p.label}</option>`).join('')}
        </select>
        <div class="cast-modal-hint">Director and Star are unique — assign those from Casting Call.</div>
      </div>
      <div class="cast-modal-field"><label>Characters</label>
        <div class="cast-import-list">
          ${present.map(c => `
            <label class="cast-import-item ${linkedIds.has(c.id) ? 'linked' : ''}">
              <input type="checkbox" data-card-id="${esc(c.id)}" ${linkedIds.has(c.id) ? 'disabled' : 'checked'}>
              <img src="${esc(c.avatarUrl)}" alt="">
              <span style="flex:1">${esc(c.name)}</span>
              ${linkedIds.has(c.id) ? '<span class="linked-tag">Already cast</span>' : ''}
            </label>
          `).join('')}
        </div>
      </div>
      <div class="cast-modal-actions">
        <button class="cast-btn" data-action="cancel">Cancel</button>
        <button class="cast-btn" data-action="save">Import</button>
      </div>
    `);

    backdrop.querySelector('[data-action="save"]').addEventListener('click', () => {
      const priority = backdrop.querySelector('[data-field="priority"]').value;
      const selected = Array.from(backdrop.querySelectorAll('input[type="checkbox"]:checked'))
        .map(cb => cb.dataset.cardId);
      if (!selected.length) { alert('Select at least one character.'); return; }
      selected.forEach(cardId => {
        const card = cards.find(c => c.id === cardId);
        if (!card) return;
        const st = (getContext().characters || []).find(x => x.avatar === cardId);
        const description = resolveCardDescription(st, { preferEvolutia: true });
        this.state.characters.push({
          id: uid(), name: card.name, priority,
          portrait: card.avatarUrl, characterCardId: card.id,
          syncFromCard: true, personaId: '', syncFromPersona: false,
          description, aliases: [], preferEvolutia: true,
          wardrobe: [], props: [], condition: '',
          plotHooks: [], genreNotes: '',
          createdAt: Date.now(), updatedAt: Date.now(),
        });
        this.bus.emit('cast.added', { character: this.state.characters.at(-1) });
      });
      this.saveState();
      backdrop.remove();
      this._renderList();
    });
  }

  _openImportFromPersonas() {
    const personas = this._getPersonas();
    if (!personas.length) { alert('No personas found.'); return; }
    const linkedIds = new Set(this.state.characters.map(c => c.personaId).filter(Boolean));
    const currentId = user_avatar || '';

    const backdrop = this._buildModal(`
      <div class="cast-modal-title">CALL SHEET</div>
      <div class="cast-modal-subtitle">— Import from personas —</div>
      <div class="cast-modal-field"><label>Priority for imported</label>
        <select data-field="priority">
          ${PRIORITIES.filter(p => p.id !== 'director').map(p =>
            `<option value="${p.id}" ${p.id === 'star' ? 'selected' : ''}>${p.label}${p.id === 'star' ? ' · {{user}}' : ''}</option>`).join('')}
        </select>
        <div class="cast-modal-hint">Star is unique. Extra picks become Leads if you import several as Star.</div>
      </div>
      <div class="cast-modal-field"><label>Personas</label>
        <div class="cast-import-list">
          ${personas.map(p => `
            <label class="cast-import-item ${linkedIds.has(p.id) ? 'linked' : ''}">
              <input type="checkbox" data-persona-id="${esc(p.id)}" ${linkedIds.has(p.id) ? 'disabled' : (p.id === currentId ? 'checked' : '')}>
              <img src="${esc(p.avatarUrl)}" alt="">
              <span style="flex:1">${esc(p.name)}${p.id === currentId ? ' <em style="opacity:.7">(current)</em>' : ''}</span>
              ${linkedIds.has(p.id) ? '<span class="linked-tag">Already cast</span>' : ''}
            </label>
          `).join('')}
        </div>
      </div>
      <div class="cast-modal-actions">
        <button class="cast-btn" data-action="cancel">Cancel</button>
        <button class="cast-btn" data-action="save">Import</button>
      </div>
    `);

    backdrop.querySelector('[data-action="save"]').addEventListener('click', () => {
      const priority = backdrop.querySelector('[data-field="priority"]').value;
      const selected = Array.from(backdrop.querySelectorAll('input[type="checkbox"]:checked'))
        .map(cb => cb.dataset.personaId);
      if (!selected.length) { alert('Select at least one persona.'); return; }
      if (priority === 'star' && !this._claimUniqueRole('star')) return;
      selected.forEach((pid, i) => {
        const p = personas.find(x => x.id === pid);
        if (!p) return;
        const role = (priority === 'star' && i > 0) ? 'lead' : priority;
        this.state.characters.push({
          id: uid(), name: p.name, priority: role,
          portrait: p.avatarUrl, personaId: p.id, syncFromPersona: true,
          characterCardId: '', syncFromCard: false,
          description: p.description || '', aliases: [],
          wardrobe: [], props: [], condition: '',
          plotHooks: [], genreNotes: '',
          createdAt: Date.now(), updatedAt: Date.now(),
        });
        this.bus.emit('cast.added', { character: this.state.characters.at(-1) });
      });
      this.saveState();
      backdrop.remove();
      this._renderList();
    });
  }

  _openItemDialog(char, kind, existing = null) {
    const isEdit     = !!existing;
    const item       = existing ?? { name: '', description: '', condition: 'pristine' };
    const otherKind  = kind === 'wardrobe' ? 'props' : 'wardrobe';
    const otherLabel = kind === 'wardrobe' ? 'Props' : 'Wardrobe';
    const title      = kind === 'wardrobe' ? 'WARDROBE' : 'PROPS';
    const moveBtn    = isEdit
      ? `<button class="cast-btn" data-action="move" style="margin-right:auto">→ Move to ${otherLabel}</button>`
      : '';

    const backdrop = this._buildModal(`
      <div class="cast-modal-title">${title}</div>
      <div class="cast-modal-subtitle">— ${isEdit ? 'Refit item' : 'New item'} for ${esc(char.name)} —</div>
      <div class="cast-modal-field"><label>Name</label>
        <input type="text" data-field="name" value="${esc(item.name)}"></div>
      <div class="cast-modal-field"><label>Description (optional)</label>
        <textarea data-field="description" style="min-height:40px">${esc(item.description ?? '')}</textarea></div>
      <div class="cast-modal-field"><label>Condition</label>
        <select data-field="condition">
          ${CONDITIONS.map(cn =>
            `<option value="${cn.id}" ${cn.id === item.condition ? 'selected' : ''}>${cn.label}</option>`
          ).join('')}
        </select></div>
      <div class="cast-modal-actions">
        ${moveBtn}
        <button class="cast-btn" data-action="cancel">Cancel</button>
        <button class="cast-btn" data-action="save">${isEdit ? 'Save' : 'Add'}</button>
      </div>
    `);

    if (isEdit) {
      backdrop.querySelector('[data-action="move"]')?.addEventListener('click', () => {
        char[kind] = (char[kind] ?? []).filter(x => x.id !== existing.id);
        (char[otherKind] ??= []).push({ ...existing });
        char.updatedAt = Date.now();
        this.saveState();
        this._mirrorStarItem(char, existing, otherKind);
        this.bus.emit('cast.updated', { character: char });
        backdrop.remove();
        this._renderList();
      });
    }

    backdrop.querySelector('[data-action="save"]').addEventListener('click', () => {
      const name = backdrop.querySelector('[data-field="name"]').value.trim();
      if (!name) { alert('Name is required.'); return; }
      const description = backdrop.querySelector('[data-field="description"]').value.trim();
      const condition   = backdrop.querySelector('[data-field="condition"]').value;
      if (isEdit) {
        Object.assign(existing, { name, description, condition });
      } else {
        (char[kind] ??= []).push({ id: uid(), name, description, condition });
      }
      char.updatedAt = Date.now();
      this.saveState();
      this._mirrorStarItem(char, isEdit ? existing : char[kind].at(-1), kind);
      this.bus.emit('cast.updated', { character: char });
      backdrop.remove();
      this._renderList();
    });
    setTimeout(() => backdrop.querySelector('[data-field="name"]').focus(), 0);
  }

  _invState() {
    const inv = this.storage.getChat('inventory', { static: [], mobile: [], currency: {}, openBoxes: [] });
    if (!Array.isArray(inv.static)) inv.static = [];
    if (!Array.isArray(inv.mobile)) inv.mobile = [];
    return inv;
  }

  _findInvRow(inv, id) {
    if (!id) return null;
    return inv.mobile.find(x => x.id === id) || inv.static.find(x => x.id === id) || null;
  }

  _ensureMobile(inv, row) {
    if (row.location === 'mobile' && inv.mobile.includes(row)) return;
    inv.static = inv.static.filter(x => x.id !== row.id);
    inv.mobile = inv.mobile.filter(x => x.id !== row.id);
    row.parentId = null;
    row.location = 'mobile';
    inv.mobile.push(row);
  }

  _mirrorStarItem(char, item, kind) {
    if (char.priority !== 'star' || !item) return;
    const inv = this._invState();
    let row = this._findInvRow(inv, item.inventoryId);
    if (!row) {
      row = {
        id: uid(),
        kind: 'item',
        name: item.name,
        description: item.description ?? '',
        condition: item.condition || 'pristine',
        category: kind === 'wardrobe' ? 'wearable' : 'misc',
        parentId: null,
        location: 'mobile',
      };
      inv.mobile.push(row);
      item.inventoryId = row.id;
    } else {
      row.name = item.name;
      row.description = item.description ?? '';
      row.condition = item.condition || row.condition || 'pristine';
      if (kind === 'wardrobe') row.category = 'wearable';
      this._ensureMobile(inv, row);
    }
    row.equippedTo = kind === 'wardrobe' ? { type: 'player' } : null;
    this.storage.saveChat();
    this.bus.emit('inventory.updated');
  }

  _unlinkStarItem(char, item, kind) {
    if (char.priority !== 'star' || !item?.inventoryId) return;
    const inv = this._invState();
    const row = this._findInvRow(inv, item.inventoryId);
    if (!row) return;
    if (kind === 'wardrobe') {
      row.equippedTo = null;
    } else {
      inv.static = inv.static.filter(x => x.id !== row.id);
      inv.mobile = inv.mobile.filter(x => x.id !== row.id);
      row.parentId = null;
      row.location = 'static';
      row.equippedTo = null;
      inv.static.push(row);
    }
    this.storage.saveChat();
    this.bus.emit('inventory.updated');
  }

  _openPlotHookDialog(char, existing = null) {
    const isEdit = !!existing;
    const hook = normalizePlotHook(existing) || { name: '', description: '', assignedTo: '', active: true };

    const backdrop = this._buildModal(`
      <div class="cast-modal-title">PLOT HOOK</div>
      <div class="cast-modal-subtitle">— ${isEdit ? 'Refit hook' : 'New hook'} —</div>
      <div class="cast-modal-field"><label>Name</label>
        <input type="text" data-field="name" value="${esc(hook.name)}"></div>
      <div class="cast-modal-field"><label>Description (optional)</label>
        <textarea data-field="description" style="min-height:40px">${esc(hook.description)}</textarea></div>
      <div class="cast-modal-field"><label>Assigned to</label>
        <select data-field="assignedTo">${this._hookAssigneeOptions(hook.assignedTo)}</select>
        <div class="cast-modal-hint">Who this pressure sits on. Unassigned hooks stay in the Director’s pool.</div>
      </div>
      <div class="cast-modal-field">
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;text-transform:none;
          letter-spacing:0;font-family:var(--st-font-body);font-size:12px;color:var(--st-ink)">
          <input type="checkbox" data-field="active" ${hook.active !== false ? 'checked' : ''} style="width:auto">
          Active (inject into prompts)
        </label>
      </div>
      <div class="cast-modal-actions">
        <button class="cast-btn" data-action="cancel">Cancel</button>
        <button class="cast-btn" data-action="save">${isEdit ? 'Save' : 'Add'}</button>
      </div>
    `);

    backdrop.querySelector('[data-action="save"]').addEventListener('click', () => {
      const name = backdrop.querySelector('[data-field="name"]').value.trim();
      const description = backdrop.querySelector('[data-field="description"]').value.trim();
      const assignedTo = backdrop.querySelector('[data-field="assignedTo"]').value.trim();
      const active = backdrop.querySelector('[data-field="active"]').checked;
      if (!name) { alert('Name is required.'); return; }
      const next = { name, description, assignedTo, active, text: name };
      if (isEdit) {
        Object.assign(existing, next);
      } else {
        (char.plotHooks ??= []).push({ id: uid(), ...next });
      }
      char.updatedAt = Date.now();
      this.saveState();
      this.bus.emit('cast.updated', { character: char });
      backdrop.remove();
      this._renderList();
    });
    setTimeout(() => backdrop.querySelector('[data-field="name"]').focus(), 0);
  }

  _buildModal(innerHtml) {
    const backdrop = document.createElement('div');
    backdrop.className = 'cast-modal-backdrop';
    backdrop.innerHTML = `<div class="cast-modal" role="dialog" aria-modal="true">${innerHtml}</div>`;
    document.body.appendChild(backdrop);
    const close = () => backdrop.remove();
    backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });
    backdrop.addEventListener('keydown', e => {
      if (e.key === 'Escape') close();
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter')
        backdrop.querySelector('[data-action="save"]')?.click();
    });
    backdrop.querySelector('[data-action="cancel"]')?.addEventListener('click', close);
    return backdrop;
  }

  // ─── data helpers ────────────────────────────────────────────────────────────

  _sortedFiltered() {
    const q = (this.state.filterQuery ?? '').toLowerCase().trim();
    const hidden = new Set(this._hiddenRoles());
    let list = this.state.characters.filter(c => {
      if (hidden.has(c.priority)) return false;
      if (!q) return true;
      return (c.name ?? '').toLowerCase().includes(q) ||
             (c.description ?? '').toLowerCase().includes(q) ||
             normalizeAliases(c.aliases).some(a => a.toLowerCase().includes(q));
    });
    const by = this.state.sortBy ?? 'priority';
    if (by === 'priority') {
      list = list.slice().sort((a, b) => {
        const oa = PRIORITY_MAP[a.priority]?.order ?? 99;
        const ob = PRIORITY_MAP[b.priority]?.order ?? 99;
        return oa !== ob ? oa - ob : (a.name ?? '').localeCompare(b.name ?? '');
      });
    } else if (by === 'name') {
      list = list.slice().sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
    } else if (by === 'recent') {
      list = list.slice().sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
    }
    return list;
  }

  _find(id) {
    return this.state.characters.find(c => c.id === id);
  }

  _getCharacterCards() {
    return (getContext().characters ?? []).map(c => ({
      id: c.avatar,
      name: c.name ?? 'Unnamed',
      avatarUrl: `/thumbnail?type=avatar&file=${encodeURIComponent(c.avatar)}`,
    }));
  }

  _getInCurrentChat() {
    const ctx = getContext();
    const inChat = new Set();
    const groupId = ctx.groupId ?? ctx.selected_group ?? null;
    const chid    = ctx.characterId ?? ctx.this_chid ?? null;
    if (groupId != null) {
      const group = (ctx.groups ?? []).find(g => g.id === groupId);
      if (group) (group.members ?? []).forEach(m => inChat.add(m));
    } else if (chid != null) {
      const char = (ctx.characters ?? [])[chid];
      if (char?.avatar) inChat.add(char.avatar);
    }
    return inChat;
  }

  _getPersonas() {
    const names = power_user?.personas ?? {};
    const descs = power_user?.persona_descriptions ?? {};
    return Object.entries(names).map(([id, name]) => ({
      id,
      name: name || id,
      description: descs[id]?.description ?? '',
      title: descs[id]?.title ?? '',
      avatarUrl: getThumbnailUrl('persona', id),
    })).sort((a, b) => a.name.localeCompare(b.name));
  }

  _resolveDisplay(char) {
    if (char.personaId) {
      const p = this._getPersonas().find(x => x.id === char.personaId);
      if (p) {
        return {
          name: char.syncFromPersona ? p.name : (char.name?.trim() || p.name),
          portrait: char.syncFromPersona ? p.avatarUrl : (char.portrait || p.avatarUrl),
        };
      }
    }
    if (char.characterCardId) {
      const card = this._getCharacterCards().find(c => c.id === char.characterCardId);
      if (card) {
        return {
          name:    char.name?.trim() || card.name,
          portrait: char.syncFromCard ? card.avatarUrl : (char.portrait || card.avatarUrl),
        };
      }
    }
    return { name: char.name, portrait: char.portrait };
  }

  /** Strip HTML / collapse whitespace so chat excerpts stay tiny. */
  _plainMes(mes) {
    return String(mes ?? '')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, ' ')
      .trim();
  }

  _formatChatLine(m) {
    const body = this._plainMes(m?.mes).slice(0, 180);
    if (!body) return '';
    const name = String(m?.name || (m?.is_user ? 'You' : '')).trim() || '…';
    return `${name}: ${body}`;
  }

  // Filter chat to messages by or about this character; hard-cap a small excerpt.
  _getCharacterContext(char, linkedCard, ctx) {
    const allChat = ctx.chat ?? [];
    const charName = (linkedCard?.name ?? char.name ?? '').trim().toLowerCase();
    const cap = 720;
    const take = (rows) => rows.map(m => this._formatChatLine(m)).filter(Boolean).join('\n').slice(-cap);

    if (char.priority === 'star') {
      const byUser = allChat.filter(m => m.is_user && !m.is_system);
      const source = byUser.length >= 2 ? byUser.slice(-4) : allChat.filter(m => !m.is_system).slice(-4);
      return take(source);
    }
    const usable = allChat.filter(m => m && !m.is_system);
    if (!charName) return take(usable.slice(-4));

    const byChar = usable.filter(m => (m.name ?? '').trim().toLowerCase() === charName);
    const mentioning = usable.filter(m =>
      (m.name ?? '').trim().toLowerCase() !== charName &&
      this._plainMes(m.mes).toLowerCase().includes(charName));

    const relevant = [...byChar.slice(-3), ...mentioning.slice(-2)]
      .filter((v, i, a) => a.indexOf(v) === i)
      .sort((a, b) => allChat.indexOf(a) - allChat.indexOf(b));

    const source = relevant.length >= 2 ? relevant.slice(-4) : usable.slice(-4);
    return take(source);
  }

  _getPlotHookContext(ctx) {
    const rows = recentPlayMessages(ctx.chat ?? [], 16);
    return rows.map(m => this._formatChatLine(m)).filter(Boolean).join('\n').slice(-2400);
  }

  _auditIdentityLine(char, identity) {
    const name = identity?.displayName || identity?.name || char.name || 'Unnamed';
    const role = priorityMeta(char.priority)?.label || char.priority || 'cast';
    const forms = formatPronounsPromptLine({ ...char, name: '' });
    const ego = identity?.alterEgoName ? ` · ego ${identity.alterEgoName}` : '';
    return `${name} (${role}${ego})${forms ? ` · ${forms}` : ''}`;
  }

  _isAuditRateLimit(text) {
    return /too many requests|\b429\b|rate.?limit|resource has been exhausted/i.test(String(text || ''));
  }

  /**
   * Isolated quiet generation — do not ride ST's full chat/card prompt.
   * generateRaw + instructOverride keeps the request to this prompt only.
   */
  async _quietAudit(prompt, { jsonSchema = null, responseLength = 350 } = {}) {
    const text = String(prompt || '').trim();
    const isRate = (t) => this._isAuditRateLimit(t);
    return withShowtimeProfile(this.storage, 'audit', async () => {
      const runRaw = async () => {
        try {
          return String(await generateRaw({
            prompt: text,
            systemPrompt: 'Return only the requested JSON or short text. No roleplay. No markdown.',
            instructOverride: true,
            quietToLoud: true,
            responseLength,
            jsonSchema,
            trimNames: false,
          }) ?? '').trim();
        } catch (err) {
          if (isRate(err?.message)) throw err;
          console.warn('[Cast audit generateRaw]', err);
          return '';
        }
      };
      let response = await runRaw();
      if (!response) {
        try {
          response = String(await generateQuietPrompt({
            quietPrompt: text,
            trimToSentence: false,
            skipWIAN: true,
            quietName: 'System',
          }) ?? '').trim();
        } catch (err) {
          if (isRate(err?.message)) {
            throw new Error('Too many requests — wait a few seconds and press Audit again.');
          }
          throw err;
        }
      }
      if (isRate(response)) {
        throw new Error('Too many requests — wait a few seconds and press Audit again.');
      }
      return response;
    });
  }

  // ─── audit ───────────────────────────────────────────────────────────────────

  async _runAudit(char, kind, btn) {
    if (this._auditBusy) {
      alert('An audit is already running. Wait for it to finish.');
      return;
    }
    const now = Date.now();
    if (this._auditLastAt && now - this._auditLastAt < 1600) {
      alert('Too soon — wait a moment before another Audit (avoids rate limits).');
      return;
    }
    this._auditLastAt = now;
    this._auditBusy = true;
    btn.disabled = true;
    const origText = btn.textContent;
    btn.textContent = '...';
    try {
      const ctx = getContext();
      const identity = resolveCastPromptIdentity(char, this.storage, {
        characters: ctx.characters ?? [],
        personas: this._getPersonas(),
      });
      const who = this._auditIdentityLine(char, identity);
      const recentChat = kind === 'hooks'
        ? (this._getPlotHookContext(ctx) || '(no recent scene)')
        : (this._getCharacterContext(char, {
          name: identity.displayName || identity.name || char.name,
        }, ctx) || '(no recent scene)');

      let prompt;
      let jsonSchema = null;
      let responseLength = 280;
      if (kind === 'wardrobe') {
        const existing = (char.wardrobe ?? []).map(x => `- ${x.name}`).join('\n') || 'None';
        prompt = `JSON array only. Clothing ${who} is explicitly described wearing in the scene text below. No card lore, no invented items.
Scene:
${recentChat}
Already listed (do not repeat):
${existing}
0–6 items. Exclude carried objects. If no new clothing is described, return [].
[{"name":"","description":"","condition":"pristine|fine|worn|damaged|broken|ruined"}]`;
        jsonSchema = {
          name: 'cast_wardrobe',
          description: 'Worn clothing items',
          strict: false,
          returnInvalid: true,
          value: {
            type: 'array', maxItems: 6,
            items: { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' }, condition: { type: 'string' } }, required: ['name'] },
          },
        };
      } else if (kind === 'props') {
        const existing = (char.props ?? []).map(x => `- ${x.name}`).join('\n') || 'None';
        prompt = `JSON array only. Objects ${who} is explicitly described carrying (not wearing) in the scene text below. No card lore, no invented items.
Scene:
${recentChat}
Already listed (do not repeat):
${existing}
0–6 items. Exclude clothing. If nothing new is described, return [].
[{"name":"","description":"","condition":"pristine|fine|worn|damaged|broken|ruined"}]`;
        jsonSchema = {
          name: 'cast_props',
          description: 'Carried objects',
          strict: false,
          returnInvalid: true,
          value: {
            type: 'array', maxItems: 6,
            items: { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' }, condition: { type: 'string' } }, required: ['name'] },
          },
        };
      } else if (kind === 'condition') {
        prompt = `1–3 sentences, no preamble. Physical/mental state of ${who}.
Scene:
${recentChat}
Existing notes: ${String(char.condition || 'None').slice(0, 400)}`;
        responseLength = 180;
      } else if (kind === 'stats') {
        if (!char.stats) char.stats = DEFAULT_STATS();
        if (!char.stats.enabled) throw new Error('Enable Track on Stats before auditing.');
        const trackerSnapshot = this._statsAuditSnapshot(char);
        const keys = trackerSnapshot.trackers.map(t => `"${t.id}"`).join(', ');
        const cond = String(char.condition || 'None').slice(0, 400);
        prompt = `JSON only. Audit ONLY the listed trackers for ${who}, based strictly on the scene below. Ignore clothing, props, and inventory entirely — do not mention or infer them.
Scene:
${recentChat}
Trackers (id · label · current 0–100 · state):
${trackerSnapshot.lines}
Condition notes: ${cond}
Rules: use ONLY these exact tracker ids as keys: ${keys}. Each value is an integer 0–100 (start from the current value above; keep it unchanged if the scene gives no reason to shift it). Do not add, rename, or omit tracker keys.
Return exactly: {"stats":{${keys}},"condition":"1–3 sentences on current physical/mental state"}`;
        const statsProps = Object.fromEntries(trackerSnapshot.trackers.map(t => [t.id, { type: 'integer' }]));
        jsonSchema = {
          name: 'cast_stats',
          description: 'Enabled tracker values and condition',
          strict: false,
          returnInvalid: true,
          value: {
            type: 'object',
            properties: {
              stats: { type: 'object', properties: statsProps },
              condition: { type: 'string' },
            },
            required: ['stats'],
          },
        };
        responseLength = 220;
      } else if (kind === 'hooks') {
        const roster = this.state.characters.filter(c => c.priority !== 'director');
        const rosterLines = roster.map(c =>
          `- ${c.name} | id=${c.id} | ${PRIORITY_MAP[c.priority]?.label || c.priority}`
        ).join('\n') || '(no cast besides Director)';
        const existing = (char.plotHooks ?? [])
          .map(h => normalizePlotHook(h))
          .filter(Boolean)
          .map(h => `- ${h.name}${h.assignedTo ? ` → ${this.state.characters.find(c => c.id === h.assignedTo)?.name || h.assignedTo}` : ''}`)
          .join('\n') || 'None';
        prompt = `JSON array only. Potential plot hooks from the chat history below: unresolved tensions, promises, mysteries, deadlines, debts, secrets leaking, obligations, dangling questions. Ground each hook in the scene — no card lore, no invented subplots.
Director keywords: ${directorKeywords(this.storage, char).join('; ') || '—'}
Cast (assign a hook to one of these when it clearly belongs to them; otherwise assignedTo empty):
${rosterLines}
Already listed (do not repeat):
${existing}
Chat:
${recentChat}
0–8 hooks. assignedTo must be a listed id, a listed name, or "".
[{"name":"short title","description":"one sentence","assignedTo":""}]`;
        jsonSchema = {
          name: 'cast_plot_hooks',
          description: 'Potential plot hooks from chat',
          strict: false,
          returnInvalid: true,
          value: {
            type: 'array', maxItems: 8,
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                description: { type: 'string' },
                assignedTo: { type: 'string' },
              },
              required: ['name'],
            },
          },
        };
        responseLength = 420;
      }

      const response = await this._quietAudit(prompt, { jsonSchema, responseLength });

      if (kind === 'condition') {
        char.condition = response.trim().slice(0, 2000);
      } else if (kind === 'stats') {
        const match = response.match(/\{[\s\S]*\}/);
        if (!match) throw new Error('No JSON object in AI response.');
        const parsed = JSON.parse(match[0]);
        this._applyStatsAudit(char, parsed);
      } else if (kind === 'hooks') {
        const match = response.match(/\[[\s\S]*\]/);
        if (!match) throw new Error('No JSON array in AI response.');
        const items = JSON.parse(match[0]);
        if (!Array.isArray(items)) throw new Error('AI response not an array.');
        const have = new Set((char.plotHooks ?? [])
          .map(h => String(normalizePlotHook(h)?.name || '').toLowerCase())
          .filter(Boolean));
        (char.plotHooks ??= []);
        items.forEach(it => {
          const name = String(it?.name || it?.text || it?.title || '').trim().slice(0, 80);
          if (!name || have.has(name.toLowerCase())) return;
          have.add(name.toLowerCase());
          char.plotHooks.push({
            id: uid(),
            name,
            text: name,
            description: String(it.description ?? '').trim().slice(0, 240),
            assignedTo: this._matchHookAssignee(it.assignedTo || it.character || it.who),
            active: true,
          });
        });
      } else {
        const match = response.match(/\[[\s\S]*\]/);
        if (!match) throw new Error('No JSON array in AI response.');
        const items = JSON.parse(match[0]);
        if (!Array.isArray(items)) throw new Error('AI response not an array.');
        (char[kind] ??= []);
        items.forEach(it => {
          if (!it?.name) return;
          char[kind].push({
            id: uid(),
            name: String(it.name).slice(0, 80),
            description: String(it.description ?? '').slice(0, 200),
            condition: CONDITION_MAP[it.condition] ? it.condition : 'pristine',
          });
          this._mirrorStarItem(char, char[kind].at(-1), kind);
        });
      }
      char.updatedAt = Date.now();
      this.saveState();
      this.bus.emit('cast.updated', { character: char });
      this._renderList();
    } catch (err) {
      console.error('[Cast audit]', err);
      const msg = String(err?.message || err);
      alert(this._isAuditRateLimit(msg)
        ? 'Too many requests — wait a few seconds and press Audit again.'
        : `Audit failed: ${msg}`);
    } finally {
      this._auditBusy = false;
      btn.disabled = false;
      btn.textContent = origText;
    }
  }

  /** Enabled tracker defs + prompt lines for stats audit (no wardrobe/props). */
  _statsAuditSnapshot(char) {
    const stats = char.stats ?? DEFAULT_STATS();
    const customDefs = customBarDefsFromTrackers(this.storage);
    const defs = [
      ...STAT_DEFS.base,
      ...(stats.hardMode ? STAT_DEFS.hard : []),
      ...customDefs,
    ];
    const trackers = defs.map(def => {
      const val = def.custom
        ? this._customStatValue(stats, def.id)
        : clamp(stats[def.id] ?? (def.direction === 'down' ? 0 : 100));
      const label = stateLabel(def, val);
      return { id: def.id, label: def.label, value: val, state: label, custom: !!def.custom };
    });
    const lines = trackers.map(t =>
      `- ${t.id} (${t.label}): ${t.value}${t.state ? ` · ${t.state}` : ''}`
    ).join('\n') || '(none)';
    return { trackers, lines };
  }

  _applyStatsAudit(char, parsed) {
    if (!char.stats) char.stats = DEFAULT_STATS();
    const bag = parsed?.stats && typeof parsed.stats === 'object' ? parsed.stats : parsed;
    if (!bag || typeof bag !== 'object') throw new Error('Missing stats object in AI response.');
    const customDefs = customBarDefsFromTrackers(this.storage);
    const customIds = new Set(customDefs.map(d => d.id));
    const baseIds = new Set(STAT_DEFS.base.map(d => d.id));
    const hardIds = new Set(STAT_DEFS.hard.map(d => d.id));
    if (!char.stats.custom || typeof char.stats.custom !== 'object') char.stats.custom = {};
    for (const [id, raw] of Object.entries(bag)) {
      if (id === 'condition' || id === 'enabled' || id === 'hardMode' || id === 'custom') continue;
      const n = Number(raw);
      if (!Number.isFinite(n)) continue;
      const val = clamp(Math.round(n));
      if (customIds.has(id)) char.stats.custom[id] = val;
      else if (baseIds.has(id) || (char.stats.hardMode && hardIds.has(id))) char.stats[id] = val;
    }
    if (typeof parsed?.condition === 'string' && parsed.condition.trim()) {
      char.condition = parsed.condition.trim().slice(0, 2000);
    }
  }
}

// ─── module-level utilities ───────────────────────────────────────────────────

function uid() {
  return crypto?.randomUUID?.() ?? ('c_' + Math.random().toString(36).slice(2, 10));
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, ch =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}

function clamp(n, min = 0, max = 100) {
  return Math.max(min, Math.min(max, n));
}