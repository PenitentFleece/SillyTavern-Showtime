// Motivation — per-character arc trees. Not skill points: desires, secrets,
// and the beats that pay them off. Each tier unlocks against a Script scene.
import { getContext } from '../../../../../extensions.js';
import { eventSource, event_types, generateQuietPrompt } from '../../../../../../script.js';
import { power_user } from '../../../../../power-user.js';
import { Module } from '../../lib/module.js';
import { withShowtimeProfile } from '../../lib/connectionProfile.js';
import { getCastMembers, getStarMember, PRIORITY_MAP, priorityMeta, formatDirectorPromptBlock, resolveCastPromptIdentity, listPersonas, isFoilOrHigher } from '../../lib/castCatalog.js';
import { getSceneCards, sceneLabel, creditedScenes } from '../../lib/scriptCatalog.js';
import {
  knowerLabel,
  normalizeKnownBy,
  setKnowerStance,
  knowerKey,
  smokeSecretRelationPure,
  standingSubjects,
  standingToward,
  subjectLabel,
  listPlaySecrets,
  secretsKnownToCharacter,
  characterHouseIds,
  interviewsVisibleOnSheet,
  knowerShareHint,
  knowerShareMode,
  knowerMemberIds,
  houseAffiliateRoster,
  houseAffiliateIds,
} from '../../lib/motivationCatalog.js';
import { buildModal } from '../../lib/compass/dialogs.js';

const TIERS = [
  { id: 'trivial',  label: 'Trivial',  color: '#a89577' },
  { id: 'minor',    label: 'Minor',    color: '#8a8474' },
  { id: 'notable',  label: 'Notable',  color: '#3d7a68' },
  { id: 'major',    label: 'Major',    color: '#c9a24a' },
  { id: 'pivotal',  label: 'Pivotal',  color: '#7a1f1f' },
];
const TIER_MAP = Object.fromEntries(TIERS.map(t => [t.id, t]));
const REWARD_KINDS = [
  { id: 'achievement', label: 'Achievement', hint: 'Files an achievement. Can also grant an item or secret.' },
  { id: 'secret',      label: 'Reveal secret', hint: 'Flips a matching secret to Known (or files it).' },
  { id: 'item',        label: 'Item',        hint: 'Adds the item to Inventory — On Person.' },
  { id: 'bonus',       label: 'Bonus',       hint: 'A note on the beat — dynamic shift, new dynamic, leverage.' },
];
const ITEM_CATS = ['consumable', 'wearable', 'usable', 'misc'];
const GATE_TYPES = [
  { id: 'standing', label: 'Standing', hint: 'Someone must feel a certain way about the Star.' },
  { id: 'secret',   label: 'Secret',   hint: 'A secret on this sheet must be out — or still buried.' },
  { id: 'scene',    label: 'Scene',    hint: 'This character must be credited in a Script scene — or absent from it.' },
  { id: 'beat',     label: 'Beat',     hint: 'Another beat on this arc must already be unlocked.' },
];
const GATE_MAP = Object.fromEntries(GATE_TYPES.map(g => [g.id, g]));
const KINDS = {
  secrets:      { label: 'Secrets',      empty: 'No secrets yet.' },
  achievements: { label: 'Achievements', empty: 'No achievements yet.' },
  interviews:   { label: 'Interviews',   empty: 'No Backstage interviews filed yet.' },
};
const STATUSES = [
  { id: 'unknown',      label: 'Unknown' },
  { id: 'earned',       label: 'Earned' },
  { id: 'established',  label: 'Established' },
];
const STATUS_MAP = Object.fromEntries(STATUSES.map(s => [s.id, s]));

// Cheap pre-filter so the secrets sonar only pays for a quiet-prompt
// classification call on messages that plausibly involve a secret changing
// hands — mirrors Inventory's OFFER_CUE_RE gate.
const SECRET_CUE_RE = /\b(reveals?|admits?|confess(?:es|ing)?|overhears?|eavesdrops?|finds?\s+out|discovers?|learns?|realizes?|blurts?|lets?\s+slip|spills?|catches?\s+(?:sight|a\s+glimpse)\s+of|stumbles?\s+(?:upon|across)|secretly|in\s+secret|it\s+turns?\s+out)\b/i;
const MAX_SONAR_PINGS = 5;

export class MotivationModule extends Module {
  static id = 'motivation';
  static label = 'Motivation';
  static scope = 'chat';

  async init() {
    if (!document.querySelector('link[data-showtime="motivation"]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = new URL('./motivation.css', import.meta.url).href;
      link.dataset.showtime = 'motivation';
      document.head.appendChild(link);
    }
    this._openDrawers = new Set();
    this._focusedCard = { secrets: '', achievements: '', interviews: '' };
    this._focusedStep = '';
    this._sideCollapsed = false;
    this._knowPop = null;
    this._knowModal = null;
    const relationSmoke = smokeSecretRelationPure();
    if (relationSmoke) console.warn('[Motivation] secret relation invariant:', relationSmoke);
    if (!this._sonarBound) {
      this._sonarBound = true;
      this._lastSonarScanLen = -1;
      eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, () => {
        const chatLen = (getContext().chat ?? []).length;
        if (chatLen === this._lastSonarScanLen) return;
        this._lastSonarScanLen = chatLen;
        this._ensureSonar();
        void this._scanSecretsSonar();
        const pol = this._motivationPolicy();
        if (pol.enabled !== false && pol.achievementsSonar !== false) {
          this.state.sonar.msgSinceCheck = (this.state.sonar.msgSinceCheck || 0) + 1;
          if (this.state.sonar.msgSinceCheck >= (pol.scanEveryN || 6)) {
            this.state.sonar.msgSinceCheck = 0;
            this.saveState();
            void this._scanAchievementsSonar();
          } else {
            this.saveState();
          }
        }
      });
    }
  }

  getDefaultState() {
    return { selectedId: '', perChar: {}, sonar: { secretPings: [], beatPings: [], msgSinceCheck: 0 } };
  }

  _ensureSonar() {
    const s = this.state;
    if (!s.sonar || typeof s.sonar !== 'object') s.sonar = {};
    if (!Array.isArray(s.sonar.secretPings)) s.sonar.secretPings = [];
    if (!Array.isArray(s.sonar.beatPings)) s.sonar.beatPings = [];
    if (!Number.isFinite(s.sonar.msgSinceCheck)) s.sonar.msgSinceCheck = 0;
    return s.sonar;
  }

  _motivationPolicy() {
    try {
      return this.storage.getChat('backstage', {})?.trackers?.motivation || {};
    } catch {
      return {};
    }
  }

  _chatToken() {
    try { return getContext()?.chatMetadata ?? null; } catch { return null; }
  }

  _chatTokenStillValid(token) {
    return this._chatToken() === token;
  }

  async onChatChanged() {
    // Reset scan cursor / in-flight flags so a new chat isn't skipped when
    // its length happens to match the previous chat's, and so a quiet prompt
    // that finishes after a switch can't write into the wrong metadata.
    this._lastSonarScanLen = -1;
    this._sonarSecretsBusy = false;
    this._sonarBeatsBusy = false;
    if (this.container) await this.render(this.container);
  }

  /** Switch to the Backstage "Motivation" connection profile for quiet LLM work. */
  async _withMotivationProfile(fn) {
    return withShowtimeProfile(this.storage, 'motivation', fn);
  }

  // ── cast + per-character state ─────────────────────────────────────────────

  // Motivations only apply to plot-relevant billing (star/lead/major/foil) —
  // director, minor, and supporting cast never get arcs/beats/secrets here.
  _members() {
    return getCastMembers(this.storage).filter(c => isFoilOrHigher(c.priority));
  }

  _director() {
    const cast = this.storage.getChat('cast', { characters: [] });
    return (cast.characters ?? []).find(c => c.priority === 'director') ?? null;
  }

  _castRecord(id) {
    const cast = this.storage.getChat('cast', { characters: [] });
    return (cast.characters ?? []).find(c => c.id === id) ?? null;
  }

  _selected() {
    const members = this._members();
    if (!members.length) return null;
    return members.find(m => m.id === this.state.selectedId)
      ?? members.find(m => m.priority === 'star')
      ?? members[0];
  }

  _charState(id) {
    const s = this.state;
    s.perChar ??= {};
    if (!s.perChar[id]) {
      s.perChar[id] = { secrets: [], achievements: [], steps: [], interviews: [], auditAt: 0 };
    }
    const cur = s.perChar[id];
    cur.secrets ??= [];
    cur.achievements ??= [];
    cur.interviews ??= [];
    cur.steps ??= [];
    for (const sec of cur.secrets) {
      sec.knownBy = normalizeKnownBy(sec.knownBy);
      sec.unawareBy = normalizeKnownBy(sec.unawareBy)
        .filter(u => !sec.knownBy.some(k => k.type === u.type && k.id === u.id));
      sec.known = sec.knownBy.length > 0;
      this._normalizeRecord(sec, { secret: true });
    }
    for (const ach of cur.achievements) this._normalizeRecord(ach);
    for (const step of cur.steps) this._normalizeGate(step);
    return cur;
  }

  _normalizeGate(step) {
    if (!step) return;
    const g = step.gate && typeof step.gate === 'object' ? step.gate : {};
    step.gate = {
      hidden: !!g.hidden,
      rules: (Array.isArray(g.rules) ? g.rules : [])
        .filter(r => GATE_MAP[r?.type])
        .map(r => ({
          type: r.type,
          subject: String(r.subject || ''),
          op: r.op === 'max' ? 'max' : 'min',
          value: Number.isFinite(Number(r.value)) ? Number(r.value) : 0,
          refId: String(r.refId || ''),
          mode: String(r.mode || ''),
        })),
    };
  }

  _normalizeRecord(x, { secret = false } = {}) {
    if (!x) return;
    x.sceneUid = typeof x.sceneUid === 'string' ? x.sceneUid : '';
    if (!STATUS_MAP[x.status]) {
      x.status = x.known ? 'earned' : 'unknown';
    }
    if (!secret) x.known = x.status !== 'unknown';
  }

  _sceneOptionsHTML(sceneUid) {
    const scenes = getSceneCards(this.storage);
    return `
      <option value="">— No scene —</option>
      ${scenes.map(s =>
        `<option value="${esc(s.uid)}" ${s.uid === sceneUid ? 'selected' : ''}>${esc(s.code)} — ${esc(s.title)}</option>`).join('')}`;
  }

  _statusSelectHTML(x) {
    const st = STATUS_MAP[x.status] ? x.status : 'unknown';
    return `<select class="mot-status${st !== 'unknown' ? ' on' : ''}" data-field="status"
        title="${st === 'established' ? 'Already true in the book' : st === 'earned' ? 'Happened in play' : 'Not on the record yet'}">
      ${STATUSES.map(s => `<option value="${s.id}" ${st === s.id ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}
    </select>`;
  }

  _sceneFieldHTML(x, { compact = false } = {}) {
    const st = x.status || 'unknown';
    const scene = x.sceneUid ? sceneLabel(this.storage, x.sceneUid) : '';
    if (compact) {
      if (st !== 'earned' || !scene) return '';
      return `<div class="mot-card-src">Earned in ${esc(scene)}</div>`;
    }
    return `
      <div class="mot-field mot-scene-field" ${st === 'earned' ? '' : 'hidden'}>
        <label>Earned in a Script scene</label>
        <select data-field="sceneUid">
          ${this._sceneOptionsHTML(x.sceneUid)}
        </select>
      </div>`;
  }

  _houses() {
    try {
      return this.storage.getChat('reputation', { house: [] }).house ?? [];
    } catch {
      return [];
    }
  }

  _closeKnowPop() {
    this._knowPop?.remove();
    this._knowPop = null;
  }

  _closeKnowModal() {
    this._knowModal?.remove();
    this._knowModal = null;
  }

  _knownBySummary(x) {
    const list = normalizeKnownBy(x?.knownBy);
    const blind = normalizeKnownBy(x?.unawareBy);
    if (!list.length && !blind.length) {
      return { label: 'Untracked', title: 'Nobody tagged — no Reputation connection until you assign Knows or In the dark' };
    }
    const knowNames = list.map(k => knowerLabel(this.storage, k)).filter(Boolean);
    const darkNames = blind.map(k => knowerLabel(this.storage, k)).filter(Boolean);
    const title = [
      knowNames.length ? `Knows: ${knowNames.join(', ')}` : '',
      darkNames.length ? `In the dark: ${darkNames.join(', ')}` : '',
    ].filter(Boolean).join(' · ');
    if (!list.length) {
      return { label: `Dark · ${blind.length}`, title };
    }
    if (!blind.length && list.length === 1) {
      return { label: `Knows · ${knowNames[0] || '1'}`, title };
    }
    const bits = [];
    if (list.length) bits.push(`Knows ${list.length}`);
    if (blind.length) bits.push(`Dark ${blind.length}`);
    return { label: bits.join(' · '), title };
  }

  // ── render ─────────────────────────────────────────────────────────────────

  async render(container) {
    this.container = container;
    this._openDrawers ??= new Set();
    this._focusedCard ??= { secrets: '', achievements: '', interviews: '' };
    this._closeKnowPop();
    this._ensureSonar();
    const members = this._members();
    const sel = this._selected();

    if (!sel) {
      container.innerHTML = `
        <div class="mot-root">
          <div class="mot-empty-all">No cast yet. Add someone in <em>Cast</em> — Motivation tracks what drives them.</div>
        </div>`;
      return;
    }
    if (this.state.selectedId !== sel.id) {
      this.state.selectedId = sel.id;
      this.saveState();
    }

    const cs = this._charState(sel.id);
    const secrets = this._secretsOnSheet(sel.id, cs);
    const interviews = this._interviewsOnSheet(sel);
    container.innerHTML = `
      <div class="mot-root${this._sideCollapsed ? ' side-shut' : ''}">
        <aside class="mot-side">
          <div class="mot-side-head">
            <div class="mot-side-label">Cast</div>
            <button type="button" class="mot-side-toggle" data-action="toggle-side"
              title="${this._sideCollapsed ? 'Expand cast list' : 'Collapse cast list'}">${this._sideCollapsed ? '▸' : '◂'}</button>
          </div>
          <div class="mot-side-list">
            ${members.map(m => this._sideRowHTML(m, m.id === sel.id)).join('')}
          </div>
        </aside>
        <section class="mot-main">
          ${this._sonarHTML()}
          ${this._headerHTML(sel, cs, { secrets, interviews })}
          ${this._drawerHTML('secrets', secrets)}
          ${this._drawerHTML('achievements', cs.achievements)}
          ${this._interviewsDrawerHTML(interviews, sel)}
          ${this._pathHTML(cs)}
        </section>
      </div>`;

    this._bind(container, sel, cs);
  }

  _sideRowHTML(m, on) {
    const p = priorityMeta(m.priority);
    const cs = this.state.perChar?.[m.id];
    const steps = cs?.steps?.length ?? 0;
    const done = cs?.steps?.filter(s => s.unlocked).length ?? 0;
    const face = m.portrait
      ? `<img src="${esc(m.portrait)}" alt="">`
      : esc((m.name || '?').charAt(0).toUpperCase());
    return `
      <button type="button" class="mot-side-row${on ? ' on' : ''}" data-action="select" data-id="${esc(m.id)}"
        style="border-left-color:${p.color}" title="${esc(p.label)}">
        <span class="mot-side-face">${face}</span>
        <span class="mot-side-copy">
          <span class="mot-side-name">${esc(m.name || 'Unnamed')}</span>
          <span class="mot-side-meta">${steps ? `${done}/${steps} beats` : 'No arc'}</span>
        </span>
      </button>`;
  }

  _sonarHTML() {
    const sonar = this._ensureSonar();
    const secretPings = sonar.secretPings ?? [];
    const beatPings = sonar.beatPings ?? [];
    if (!secretPings.length && !beatPings.length) return '';
    const secretRows = secretPings.map(p => `
      <div class="mot-sonar-row" data-sonar="secret" data-id="${esc(p.id)}">
        <div class="mot-sonar-text">“${esc(p.secretTitle)}” (${esc(p.ownerName)}'s secret) may now be known by <strong>${esc(p.learnerNames.join(', ') || 'someone new')}</strong>${p.note ? ` — <em>${esc(p.note)}</em>` : ''}</div>
        <div class="mot-sonar-actions">
          <button type="button" class="mot-btn small gold" data-action="sonar-secret-apply" data-id="${esc(p.id)}">Mark known</button>
          <button type="button" class="mot-btn small" data-action="sonar-secret-dismiss" data-id="${esc(p.id)}">Dismiss</button>
        </div>
      </div>`).join('');
    const beatRows = beatPings.map(p => `
      <div class="mot-sonar-row" data-sonar="beat" data-id="${esc(p.id)}">
        <div class="mot-sonar-text"><strong>${esc(p.characterName)}</strong> may have just hit “${esc(p.beatTitle)}”${p.note ? ` — <em>${esc(p.note)}</em>` : ''}</div>
        <div class="mot-sonar-actions">
          <button type="button" class="mot-btn small gold" data-action="sonar-beat-apply" data-id="${esc(p.id)}">Unlock</button>
          <button type="button" class="mot-btn small" data-action="sonar-beat-dismiss" data-id="${esc(p.id)}">Dismiss</button>
        </div>
      </div>`).join('');
    return `
      <section class="mot-sonar">
        <div class="mot-sonar-head">Narrative sonar</div>
        ${secretRows}
        ${beatRows}
      </section>`;
  }

  _isStarSheet(sel) {
    const star = getStarMember(this.storage);
    return !!(sel && (sel.priority === 'star' || sel.id === star?.id));
  }

  _locateSecret(id) {
    if (!id) return null;
    for (const [ownerId, row] of Object.entries(this.state.perChar || {})) {
      const secret = (row.secrets || []).find(s => s.id === id);
      if (secret) return { secret, ownerId, row };
    }
    return null;
  }

  _heardSecrets(characterId) {
    const play = listPlaySecrets(this.storage);
    const houseIds = characterHouseIds(this.storage, characterId);
    return secretsKnownToCharacter(play, characterId, houseIds).map(p => {
      const live = this._locateSecret(p.id)?.secret;
      return {
        ...(live || p),
        _heard: true,
        ownerId: p.ownerId,
        ownerName: p.ownerName,
      };
    });
  }

  _secretsOnSheet(characterId, cs) {
    const owned = cs?.secrets ?? [];
    const heard = this._heardSecrets(characterId)
      .filter(s => !owned.some(o => o.id === s.id));
    return [...owned, ...heard];
  }

  _interviewsOnSheet(sel) {
    return interviewsVisibleOnSheet(this.storage, sel?.id, { isStar: this._isStarSheet(sel) });
  }

  _headerHTML(sel, cs, { secrets = null, interviews = null } = {}) {
    const p = priorityMeta(sel.priority);
    const scenes = creditedScenes(this.storage, sel.id, sel.name).length;
    const secretN = (secrets ?? cs.secrets ?? []).length;
    const interviewN = (interviews ?? this._interviewsOnSheet(sel)).length;
    const ivBit = this._isStarSheet(sel) && !interviewN
      ? ''
      : ` · ${interviewN} interview${interviewN === 1 ? '' : 's'}`;
    return `
      <header class="mot-head">
        <div class="mot-head-main">
          <div class="mot-head-name">${esc(sel.name || 'Unnamed')}
            <span class="mot-badge" style="border-color:${p.color};color:${p.color}">${esc(p.label)}</span>
          </div>
          <div class="mot-head-meta">${scenes} credited scene${scenes === 1 ? '' : 's'} · ${secretN} secret${secretN === 1 ? '' : 's'} · ${cs.achievements.length} achievement${cs.achievements.length === 1 ? '' : 's'}${ivBit}</div>
        </div>
        <button type="button" class="mot-btn gold" data-action="audit" title="Read the card, secrets, credited scenes, and Director notes, then draft a branching arc">Audit</button>
      </header>`;
  }

  _drawerHTML(kind, list) {
    const meta = KINDS[kind];
    const open = this._openDrawers.has(kind);
    const focusId = this._focusedCard?.[kind] || '';
    const n = list.length;
    return `
      <details class="mot-drawer" data-drawer="${kind}" ${open ? 'open' : ''}>
        <summary>${meta.label} <span class="mot-count">${list.length}</span></summary>
        <div class="mot-cards" data-role="stack" data-kind="${kind}">
          ${n ? list.map((x, i) => this._cardHTML(kind, x, { index: i, total: n, focused: x.id === focusId })).join('') : `<div class="mot-hint">${meta.empty}</div>`}
        </div>
        <button type="button" class="mot-btn small" data-action="add-card" data-kind="${kind}">＋ Add ${kind === 'secrets' ? 'secret' : 'achievement'}</button>
      </details>`;
  }

  _interviewsDrawerHTML(list = [], sel = null) {
    const starSheet = this._isStarSheet(sel);
    if (starSheet && !list.length) return '';
    const open = this._openDrawers.has('interviews');
    const focusId = this._focusedCard?.interviews || '';
    const n = list.length;
    const hint = starSheet
      ? 'Sessions you ran as interviewer from Backstage → Interview → End &amp; file.'
      : 'Filed from Backstage → Interview → End &amp; file.';
    return `
      <details class="mot-drawer" data-drawer="interviews" ${open ? 'open' : ''}>
        <summary>${KINDS.interviews.label} <span class="mot-count">${n}</span></summary>
        <div class="mot-cards" data-role="stack" data-kind="interviews">
          ${n
            ? list.map(x => this._interviewCardHTML(x, { focused: x.id === focusId })).join('')
            : `<div class="mot-hint">${KINDS.interviews.empty}</div>`}
        </div>
        <p class="mot-hint" style="margin:0 8px 8px">${hint}</p>
      </details>`;
  }

  _interviewCardHTML(x, { focused = false } = {}) {
    const turns = x.turns || [];
    const when = (() => {
      try {
        return new Date(x.at || x.startedAt || Date.now()).toLocaleString(undefined, {
          month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
        });
      } catch { return '—'; }
    })();
    const peek = turns.find(t => t.who === 'cast' && t.text)?.text
      || turns.find(t => t.text)?.text
      || '';
    return `
      <article class="mot-card${focused ? ' on' : ' min'}" data-kind="interviews" data-id="${esc(x.id)}">
        <div class="mot-card-body">
          <div class="mot-card-row">
            <span class="mot-card-title">${esc(when)}</span>
            <span class="mot-card-tier">${turns.length} turn${turns.length === 1 ? '' : 's'}</span>
            <button type="button" class="mot-icon danger" data-action="drop-interview" title="Remove">✕</button>
          </div>
          ${x.asInterviewer
            ? `<div class="mot-card-knows">Subject · ${esc(x.subjectName || '—')}</div>`
            : `<div class="mot-card-knows">Interviewer · ${esc(x.interviewer || '—')}</div>`}
          ${focused
            ? `<div class="mot-iv-log">${turns.map(t => {
                const who = t.who === 'cast' ? '' : (t.name || t.who || '');
                return `<div class="mot-iv-line ${t.who === 'user' ? 'ask' : 'ans'}">
                  ${who ? `<span class="mot-iv-who">${esc(who)}</span>` : ''}
                  <span class="mot-iv-text">${esc(t.text || '')}</span>
                </div>`;
              }).join('')}</div>`
            : (peek ? `<div class="mot-card-peek">${esc(peek.slice(0, 140))}${peek.length > 140 ? '…' : ''}</div>` : '')}
        </div>
      </article>`;
  }

  _cardHTML(kind, x, { index = 0, total = 1, focused = false } = {}) {
    const tier = TIER_MAP[x.tier] ?? TIER_MAP.notable;
    const isSecret = kind === 'secrets';
    const heard = isSecret && !!x._heard;
    const know = isSecret ? this._knownBySummary(x) : null;
    const names = isSecret
      ? normalizeKnownBy(x.knownBy).map(k => knowerLabel(this.storage, k)).filter(Boolean)
      : [];
    const darkNames = isSecret
      ? normalizeKnownBy(x.unawareBy).map(k => knowerLabel(this.storage, k)).filter(Boolean)
      : [];
    const tagged = names.length + darkNames.length;
    const desc = (x.description || '').trim();
    const peek = desc.slice(0, 90);
    const z = focused ? total + 10 : index + 1;
    return `
      <article class="mot-card${focused ? ' on' : ' min'}${heard ? ' heard' : ''}" data-kind="${kind}" data-id="${esc(x.id)}"
        ${heard ? 'data-heard="1"' : ''}
        style="border-left-color:${tier.color};z-index:${z}">
        <div class="mot-card-body">
          <div class="mot-card-row">
            <span class="mot-card-title">${esc(x.title || 'Untitled')}</span>
            <span class="mot-card-tier" style="background:${tier.color}">${esc(tier.label)}</span>
            ${heard ? '' : this._statusSelectHTML(x)}
            ${isSecret
              ? `<button type="button" class="mot-known${tagged ? ' on' : ''}" data-action="who-knows"
                  title="${esc(know.title)}">${esc(know.label)}</button>`
              : ''}
            ${heard ? '' : `<button type="button" class="mot-icon" data-action="edit-card" title="Edit">✎</button>
            <button type="button" class="mot-icon danger" data-action="drop-card" title="Remove">✕</button>`}
          </div>
          ${heard ? `<div class="mot-card-knows heard">Knows · ${esc(x.ownerName || 'Unknown')}'s secret</div>` : ''}
          ${focused
            ? `${desc ? `<div class="mot-card-desc">${esc(desc)}</div>` : ''}
               ${names.length ? `<div class="mot-card-knows">Knows · ${esc(names.join(' · '))}</div>` : ''}
               ${darkNames.length ? `<div class="mot-card-knows dark">In the dark · ${esc(darkNames.join(' · '))}</div>` : ''}
               ${this._sceneFieldHTML(x, heard ? { compact: true } : {})}
               ${x.fromStepId ? `<div class="mot-card-src">Granted by an unlocked beat</div>` : ''}`
            : `<div class="mot-card-peek">${peek ? esc(peek) : '<span class="mot-hint">No description.</span>'}
               ${this._sceneFieldHTML(x, { compact: true })}</div>`}
        </div>
      </article>`;
  }

  _pathHTML(cs) {
    const steps = cs.steps ?? [];
    const head = `
      <header class="mot-path-head">
        <div class="mot-path-label">Motivations</div>
        <button type="button" class="mot-btn small" data-action="add-step">＋ Add beat</button>
        ${steps.length ? `<button type="button" class="mot-btn small danger" data-action="clear-path" title="Remove every beat">Clear</button>` : ''}
      </header>`;
    if (!steps.length) {
      return `
        <section class="mot-path">
          ${head}
          <div class="mot-arc" data-role="arc">
            <div class="mot-empty">
              Empty stage. Fill in secrets, credit them in a few scenes, then press <strong>Audit</strong> —
              or add beats by hand. Each arc becomes a column; forks stack inside it.
            </div>
          </div>
        </section>`;
    }
    const columns = this._arcColumns(steps);
    return `
      <section class="mot-path">
        ${head}
        <div class="mot-arc" data-role="arc">
          <div class="mot-stages">
            ${columns.map((col, i) => this._stageHTML(col, i, columns.length, cs)).join('')}
          </div>
        </div>
      </section>`;
  }

  /** Beats bucketed by arc, each arc grouped under the beat it follows. */
  _arcColumns(steps) {
    const byId = new Map(steps.map(s => [s.id, s]));
    const depths = new Map();
    const depthOf = (step, seen = new Set()) => {
      if (depths.has(step.id)) return depths.get(step.id);
      if (seen.has(step.id)) return 0;
      seen.add(step.id);
      const parent = step.parentId ? byId.get(step.parentId) : null;
      const d = parent ? depthOf(parent, seen) + 1 : 0;
      depths.set(step.id, d);
      return d;
    };
    for (const s of steps) depthOf(s);
    const max = Math.max(0, ...depths.values());
    const columns = [];
    const rank = new Map();
    for (let d = 0; d <= max; d++) {
      const col = steps.filter(s => depths.get(s.id) === d);
      if (d > 0) col.sort((a, b) => (rank.get(a.parentId) ?? 99) - (rank.get(b.parentId) ?? 99));
      col.forEach((s, i) => rank.set(s.id, i));
      const groups = [];
      for (const s of col) {
        const key = byId.has(s.parentId) ? s.parentId : '';
        let g = groups.find(x => x.key === key);
        if (!g) groups.push(g = { key, parent: key ? byId.get(key) : null, items: [] });
        g.items.push(s);
      }
      columns.push(groups);
    }
    return columns;
  }

  _stageHTML(groups, index, total, cs) {
    const count = groups.reduce((n, g) => n + g.items.length, 0);
    const label = index === 0 ? 'Opening' : `Arc ${index}`;
    return `
      <section class="mot-stage${index === total - 1 ? ' last' : ''}">
        <header class="mot-stage-head">
          <span class="mot-stage-n">${esc(label)}</span>
          <span class="mot-stage-c">${count}</span>
        </header>
        <div class="mot-stage-body">
          ${groups.map(g => `
            <div class="mot-group${g.items.length > 1 ? ' fork' : ''}">
              ${g.parent ? `<div class="mot-group-k">↳ after ${esc(g.parent.title || 'Untitled beat')}${g.items.length > 1 ? ` · ${g.items.length} ways` : ''}</div>` : ''}
              ${g.items.map(s => this._beatHTML(s, cs)).join('')}
            </div>`).join('')}
        </div>
      </section>`;
  }

  _beatHTML(step, cs) {
    const focused = this._focusedStep === step.id;
    const scene = step.sceneUid ? sceneLabel(this.storage, step.sceneUid) : '';
    const parent = step.parentId ? (cs.steps ?? []).find(s => s.id === step.parentId) : null;
    const blocked = parent && !parent.unlocked;
    const gate = this._gateEval(cs, step);
    const canUnlock = !!step.sceneUid && !blocked && gate.open;
    const sealed = gate.sealed && !step.unlocked;
    const rewards = (step.rewards ?? []).map(r => {
      const tier = TIER_MAP[r.tier];
      return `<span class="mot-reward mot-reward--${esc(r.kind)}">${esc(labelForReward(r))}${tier ? ` · ${esc(tier.label)}` : ''}</span>`;
    }).join('');
    const rewardCount = (step.rewards ?? []).length;
    const conditions = gate.rules.length ? `
      <div class="mot-gates">
        ${gate.rules.map(c =>
          `<span class="mot-gate${c.met ? ' met' : ''}">${c.met ? '✓' : '✗'} ${esc(c.label)}</span>`).join('')}
      </div>` : '';
    return `
      <article class="mot-step${focused ? ' on' : ''}${step.unlocked ? ' unlocked' : ''}${blocked ? ' blocked' : ''}${sealed ? ' sealed' : ''}${!gate.open && !step.unlocked ? ' gated' : ''}"
        data-id="${esc(step.id)}" title="${focused ? '' : (sealed ? 'Sealed until its conditions are met' : esc(step.title || 'Untitled beat'))}">
        <div class="mot-step-row">
          <span class="mot-step-dot">${step.unlocked ? '◆' : (sealed ? '▮' : '◇')}</span>
          <div class="mot-step-title">
            ${sealed && !focused
              ? `<span class="mot-redact">▬▬▬ ▬▬▬▬ ▬▬</span>`
              : `${step.branch ? `<span class="mot-branch">${esc(step.branch)}</span>` : ''}${esc(step.title || 'Untitled beat')}`}
          </div>
        </div>
        ${focused ? `
          ${sealed ? `<div class="mot-step-seal">Sealed — hidden on the board until these are met.</div>` : ''}
          ${step.description ? `<div class="mot-step-desc">${esc(step.description)}</div>` : ''}
          ${step.theme ? `<div class="mot-step-theme">${esc(step.theme)}</div>` : ''}
          ${conditions}
          ${rewards ? `<div class="mot-rewards">${rewards}</div>` : ''}
          <button type="button" class="mot-scene${scene ? ' on' : ''}" data-action="link-scene" title="Connect a Script scene">
            ${scene ? esc(scene) : '⚭ Link a scene'}
          </button>
          <div class="mot-step-actions">
            <button type="button" class="mot-btn small${step.unlocked ? ' gold' : ''}" data-action="toggle-step"
              ${canUnlock || step.unlocked ? '' : 'disabled'}
              title="${step.unlocked
                ? 'Re-lock and withdraw its rewards'
                : (blocked ? 'Unlock the beat before this one first'
                  : (!gate.open ? 'Conditions are not met yet'
                    : (step.sceneUid ? 'Unlock and apply rewards' : 'Link a scene card first')))}">
              ${step.unlocked ? 'Unlocked' : (gate.open ? 'Locked' : 'Blocked')}
            </button>
            <button type="button" class="mot-icon" data-action="edit-step" title="Edit">✎</button>
            <button type="button" class="mot-icon danger" data-action="drop-step" title="Remove">✕</button>
          </div>`
        : `<div class="mot-step-tags">
            ${sealed
              ? `<span class="mot-step-tag seal">Sealed · ${gate.unmet.length} condition${gate.unmet.length === 1 ? '' : 's'}</span>`
              : `${scene ? `<span class="mot-step-tag on">${esc(scene)}</span>` : `<span class="mot-step-tag">No scene</span>`}
                 ${rewardCount ? `<span class="mot-step-tag">${rewardCount} reward${rewardCount === 1 ? '' : 's'}</span>` : ''}
                 ${gate.rules.length ? `<span class="mot-step-tag${gate.open ? ' on' : ' block'}">${gate.open ? 'Conditions met' : `${gate.unmet.length} blocked`}</span>` : ''}`}
          </div>`}
      </article>`;
  }

  // ── binding ────────────────────────────────────────────────────────────────

  _bind(root, sel, cs) {
    root.querySelectorAll('[data-action="sonar-secret-apply"]').forEach(btn => {
      btn.addEventListener('click', () => this._applySecretPing(btn.dataset.id));
    });
    root.querySelectorAll('[data-action="sonar-secret-dismiss"]').forEach(btn => {
      btn.addEventListener('click', () => this._dismissSonarPing('secretPings', btn.dataset.id));
    });
    root.querySelectorAll('[data-action="sonar-beat-apply"]').forEach(btn => {
      btn.addEventListener('click', () => this._applyBeatPing(btn.dataset.id));
    });
    root.querySelectorAll('[data-action="sonar-beat-dismiss"]').forEach(btn => {
      btn.addEventListener('click', () => this._dismissSonarPing('beatPings', btn.dataset.id));
    });
    const arc = root.querySelector('[data-role="arc"]');
    if (arc) {
      const restore = () => {
        arc.scrollLeft = this._arcScroll?.left ?? 0;
        arc.scrollTop = this._arcScroll?.top ?? 0;
        arc.querySelector('.mot-step.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      };
      restore();
      requestAnimationFrame(restore);
      arc.addEventListener('scroll', () => {
        this._arcScroll = { left: arc.scrollLeft, top: arc.scrollTop };
      });
    }
    root.querySelectorAll('[data-action="select"]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.state.selectedId = btn.dataset.id;
        this._focusedStep = '';
        this._arcScroll = null;
        this.saveState();
        this.render(this.container);
      });
    });
    root.querySelector('[data-action="toggle-side"]')?.addEventListener('click', () => {
      this._sideCollapsed = !this._sideCollapsed;
      this.render(this.container);
    });
    root.querySelectorAll('.mot-drawer').forEach(d => {
      d.addEventListener('toggle', () => {
        if (d.open) this._openDrawers.add(d.dataset.drawer);
        else this._openDrawers.delete(d.dataset.drawer);
      });
    });
    root.querySelector('[data-action="audit"]')?.addEventListener('click', e => {
      void this._runAudit(sel, cs, e.currentTarget);
    });
    root.querySelectorAll('[data-action="add-card"]').forEach(btn => {
      btn.addEventListener('click', () => this._openCardEditor(cs, btn.dataset.kind, null));
    });
    root.querySelectorAll('[data-role="stack"]').forEach(stack => {
      stack.addEventListener('click', e => {
        if (e.target.closest('.mot-card')) return;
        const kind = stack.dataset.kind;
        if (!this._focusedCard?.[kind]) return;
        this._focusedCard[kind] = '';
        this.render(this.container);
      });
    });
    root.querySelectorAll('.mot-card').forEach(card => {
      const kind = card.dataset.kind;
      const id = card.dataset.id;
      card.addEventListener('click', e => {
        if (e.target.closest('button, select, label, input')) return;
        this._focusedCard ??= { secrets: '', achievements: '', interviews: '' };
        this._focusedCard[kind] = this._focusedCard[kind] === id ? '' : id;
        this.render(this.container);
      });
      card.querySelector('[data-field="status"]')?.addEventListener('change', e => {
        e.stopPropagation();
        if (kind === 'interviews') return;
        const x = (cs[kind] ?? []).find(y => y.id === id);
        if (!x) return;
        x.status = STATUS_MAP[e.target.value] ? e.target.value : 'unknown';
        if (kind !== 'secrets') x.known = x.status !== 'unknown';
        this.saveState();
        this.bus.emit('motivation.updated', { characterId: this.state.selectedId });
        this.render(this.container);
      });
      card.querySelector('[data-field="sceneUid"]')?.addEventListener('change', e => {
        e.stopPropagation();
        if (kind === 'interviews') return;
        const x = (cs[kind] ?? []).find(y => y.id === id);
        if (!x) return;
        x.sceneUid = e.target.value;
        this.saveState();
        this.bus.emit('motivation.updated', { characterId: this.state.selectedId });
      });
      card.querySelector('[data-action="who-knows"]')?.addEventListener('click', e => {
        e.stopPropagation();
        const x = (cs.secrets ?? []).find(y => y.id === id) || this._locateSecret(id)?.secret;
        if (!x) return;
        this._focusedCard ??= { secrets: '', achievements: '', interviews: '' };
        this._focusedCard.secrets = id;
        this._openKnownDialog(x, { persist: true });
      });
      card.querySelector('[data-action="edit-card"]')?.addEventListener('click', () => {
        if (kind === 'interviews' || card.dataset.heard) return;
        const x = (cs[kind] ?? []).find(y => y.id === id);
        if (x) this._openCardEditor(cs, kind, x);
      });
      card.querySelector('[data-action="drop-card"]')?.addEventListener('click', () => {
        if (kind === 'interviews' || card.dataset.heard) return;
        const x = (cs[kind] ?? []).find(y => y.id === id);
        if (!x || !confirm(`Remove “${x.title}”?`)) return;
        cs[kind] = cs[kind].filter(y => y.id !== id);
        if (this._focusedCard?.[kind] === id) this._focusedCard[kind] = '';
        this.saveState();
        this.bus.emit('motivation.updated', { characterId: this.state.selectedId });
        this.render(this.container);
      });
      card.querySelector('[data-action="drop-interview"]')?.addEventListener('click', e => {
        e.stopPropagation();
        if (!confirm('Remove this filed interview?')) return;
        let found = false;
        for (const row of Object.values(this.state.perChar || {})) {
          if (!Array.isArray(row.interviews)) continue;
          const next = row.interviews.filter(y => y.id !== id);
          if (next.length !== row.interviews.length) found = true;
          row.interviews = next;
        }
        if (!found) return;
        if (this._focusedCard?.interviews === id) this._focusedCard.interviews = '';
        this.saveState();
        this.bus.emit('motivation.updated', { characterId: this.state.selectedId });
        this.render(this.container);
      });
    });
    root.querySelector('[data-action="add-step"]')?.addEventListener('click', () => this._openStepEditor(cs, null));
    root.querySelector('[data-action="clear-path"]')?.addEventListener('click', () => {
      if (!confirm('Remove every beat on this arc? Secrets and achievements stay.')) return;
      cs.steps = [];
      this.saveState();
      this.render(this.container);
    });
    root.querySelectorAll('.mot-step').forEach(el => {
      const id = el.dataset.id;
      el.addEventListener('click', e => {
        if (e.target.closest('button')) return;
        this._focusedStep = this._focusedStep === id ? '' : id;
        this.render(this.container);
      });
      el.querySelector('[data-action="link-scene"]')?.addEventListener('click', () => this._openScenePicker(cs, id));
      el.querySelector('[data-action="toggle-step"]')?.addEventListener('click', () => this._toggleStep(cs, id));
      el.querySelector('[data-action="edit-step"]')?.addEventListener('click', () => {
        const step = (cs.steps ?? []).find(s => s.id === id);
        if (step) this._openStepEditor(cs, step);
      });
      el.querySelector('[data-action="drop-step"]')?.addEventListener('click', () => {
        const step = (cs.steps ?? []).find(s => s.id === id);
        if (!step || !confirm(`Remove “${step.title}”? Beats branching from it move up a level.`)) return;
        for (const child of cs.steps.filter(s => s.parentId === id)) child.parentId = step.parentId ?? null;
        if (step.unlocked) this._withdrawRewards(cs, step);
        cs.steps = cs.steps.filter(s => s.id !== id);
        this.saveState();
        this.render(this.container);
      });
    });
    root.querySelector('.mot-card.on')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  // ── gates ──────────────────────────────────────────────────────────────────

  /** Which of a beat's conditions are met right now. */
  _gateEval(cs, step) {
    const rules = step?.gate?.rules ?? [];
    const checked = rules.map(r => ({ rule: r, met: this._gateRuleMet(cs, r), label: this._gateLabel(r) }));
    const unmet = checked.filter(c => !c.met);
    return {
      rules: checked,
      unmet,
      open: unmet.length === 0,
      sealed: unmet.length > 0 && !!step?.gate?.hidden,
    };
  }

  _gateRuleMet(cs, r) {
    if (r.type === 'standing') {
      const v = standingToward(this.storage, r.subject);
      if (v == null) return false;
      return r.op === 'max' ? v <= r.value : v >= r.value;
    }
    if (r.type === 'secret') {
      const sec = (cs.secrets ?? []).find(s => s.id === r.refId);
      if (!sec) return false;
      const out = normalizeKnownBy(sec.knownBy).length > 0;
      return r.mode === 'buried' ? !out : out;
    }
    if (r.type === 'scene') {
      const sel = this._selected();
      const credited = creditedScenes(this.storage, sel?.id, sel?.name).some(s => s.uid === r.refId);
      return r.mode === 'absent' ? !credited : credited;
    }
    if (r.type === 'beat') {
      return !!(cs.steps ?? []).find(s => s.id === r.refId)?.unlocked;
    }
    return true;
  }

  _gateLabel(r) {
    if (r.type === 'standing') {
      const who = subjectLabel(this.storage, r.subject) || 'Someone';
      const v = `${r.value > 0 ? '+' : ''}${r.value}`;
      return `${who} ${r.op === 'max' ? 'at most' : 'at least'} ${v}`;
    }
    if (r.type === 'secret') {
      const cs = this._charState(this.state.selectedId);
      const sec = (cs.secrets ?? []).find(s => s.id === r.refId);
      const title = sec?.title || 'a secret';
      return r.mode === 'buried' ? `“${title}” still buried` : `“${title}” is out`;
    }
    if (r.type === 'scene') {
      const label = sceneLabel(this.storage, r.refId) || 'a scene';
      return r.mode === 'absent' ? `Absent from ${label}` : `Credited in ${label}`;
    }
    if (r.type === 'beat') {
      const cs = this._charState(this.state.selectedId);
      const step = (cs.steps ?? []).find(s => s.id === r.refId);
      return `After “${step?.title || 'another beat'}”`;
    }
    return 'Condition';
  }

  // ── unlocking ──────────────────────────────────────────────────────────────

  _toggleStep(cs, id) {
    const step = (cs.steps ?? []).find(s => s.id === id);
    if (!step) return;
    if (step.unlocked) {
      step.unlocked = false;
      step.unlockedAt = 0;
      this._withdrawRewards(cs, step);
      for (const child of cs.steps.filter(s => s.parentId === id && s.unlocked)) {
        child.unlocked = false;
        child.unlockedAt = 0;
        this._withdrawRewards(cs, child);
      }
      this.saveState();
      this.render(this.container);
      return;
    }
    if (!step.sceneUid) {
      alert('Connect a scene card first — beats unlock against a place on the Script.');
      return;
    }
    const parent = step.parentId ? cs.steps.find(s => s.id === step.parentId) : null;
    if (parent && !parent.unlocked) {
      alert(`Unlock “${parent.title}” first.`);
      return;
    }
    const gate = this._gateEval(cs, step);
    if (!gate.open) {
      alert(`This path is blocked:\n\n${gate.unmet.map(u => `• ${u.label}`).join('\n')}`);
      return;
    }
    this._unlockStep(cs, step, this.state.selectedId);
    this.render(this.container);
  }

  /** Mechanical unlock (no UI guards/alerts) — shared by the toggle button and the narrative sonar. */
  _unlockStep(cs, step, characterId = null) {
    step.unlocked = true;
    step.unlockedAt = Date.now();
    this._applyRewards(cs, step, characterId || this.state.selectedId);
    this.saveState();
  }

  /** Beats eligible for auto-unlock right now: gate already open, scene linked, parent clear. */
  _eligibleBeats() {
    const out = [];
    for (const m of this._members()) {
      const cs = this.state.perChar?.[m.id];
      if (!cs?.steps?.length) continue;
      for (const step of cs.steps) {
        if (step.unlocked || !step.sceneUid) continue;
        const parent = step.parentId ? cs.steps.find(s => s.id === step.parentId) : null;
        if (parent && !parent.unlocked) continue;
        const priorSelected = this.state.selectedId;
        this.state.selectedId = m.id; // _gateRuleMet's scene check reads the "selected" character
        const gate = this._gateEval(cs, step);
        this.state.selectedId = priorSelected;
        if (!gate.open) continue;
        out.push({ characterId: m.id, characterName: m.name || 'Unnamed', cs, step });
      }
    }
    return out;
  }

  _resolveLearners(names) {
    const star = getStarMember(this.storage);
    const members = this._members();
    const houses = this._houses();
    const out = [];
    for (const raw of names ?? []) {
      const n = String(raw || '').trim();
      if (!n) continue;
      const key = n.toLowerCase();
      if (/^\{\{user\}\}$/i.test(n) || (star?.name && key === String(star.name).trim().toLowerCase())) {
        if (star?.id) out.push({ type: 'cast', id: star.id });
        continue;
      }
      const hit = members.find(m => String(m.name || '').trim().toLowerCase() === key);
      if (hit) {
        out.push({ type: 'cast', id: hit.id });
        continue;
      }
      // Affiliations / houses — same shape the Who-knows picker writes.
      const house = houses.find(h => {
        const alias = String(h.alias || '').trim().toLowerCase();
        const name = String(h.name || '').trim().toLowerCase();
        return (alias && alias === key) || (name && name === key);
      });
      if (house?.id) out.push({ type: 'house', id: house.id });
    }
    return normalizeKnownBy(out);
  }

  /**
   * Narrative sonar (secrets): cheap regex gate + quiet-LLM classification on
   * CHARACTER_MESSAGE_RENDERED, matched only against EXISTING filed secrets —
   * never invents a new one. Queues a user-resolved ping rather than
   * silently flipping knownBy, since reveal detection is inherently fuzzy.
   */
  async _scanSecretsSonar() {
    const pol = this._motivationPolicy();
    if (pol.enabled === false || pol.secretsSonar === false) return;
    if (this._sonarSecretsBusy) return;
    const sonar = this._ensureSonar();
    if (sonar.secretPings.length >= MAX_SONAR_PINGS) return;

    const chat = getContext().chat ?? [];
    // Prefer the most recent non-system line that actually matches the cue —
    // user OR cast ({{user}} narrating a discovery is a valid reveal).
    let mes = null;
    for (let i = chat.length - 1; i >= 0 && i >= chat.length - 6; i--) {
      const m = chat[i];
      if (!m || m.is_system) continue;
      if (SECRET_CUE_RE.test(String(m.mes || ''))) { mes = m; break; }
    }
    const text = String(mes?.mes || '');
    if (!text) return;

    const roster = [];
    const houseNames = this._houses()
      .map(h => h.alias || h.name)
      .filter(Boolean)
      .slice(0, 20);
    for (const m of this._members()) {
      const cs = this.state.perChar?.[m.id];
      for (const sec of (cs?.secrets ?? [])) {
        const knowers = normalizeKnownBy(sec.knownBy).map(k => knowerLabel(this.storage, k)).filter(Boolean);
        roster.push(`- id=${sec.id} · "${sec.title}" (${m.name}'s secret) — ${sec.description ? sec.description.slice(0, 140) : 'no description'} · currently known by: ${knowers.join(', ') || 'nobody yet'}`);
      }
    }
    if (!roster.length) return;

    const chatToken = this._chatToken();
    this._sonarSecretsBusy = true;
    try {
      const prompt = `[System: Return ONLY JSON. No markdown.]
Latest message in the scene:
"""
${text.slice(0, 1200)}
"""

Filed secrets on record (id, title, owner, description, who already knows):
${roster.slice(0, 40).join('\n')}
${houseNames.length ? `\nAffiliations that can learn a secret (use these exact names when a whole group learns it):\n${houseNames.map(n => `- ${n}`).join('\n')}` : ''}

Decide if that latest message shows one of these EXISTING filed secrets becoming known to someone who didn't already know it — through confession, discovery, overhearing, deduction, etc. Do not invent a new secret; only match one from the list above.
JSON schema:
{"detected":true|false,"secretId":"","learners":["Name1","Name2"],"note":""}
- secretId must exactly match an id from the list above.
- learners: names of whoever just learned it — cast member names, affiliation names from the list above, or "{{user}}" for the player character.
- note: one short clause (<=15 words) on what happened.
JSON:`;
      const raw = await this._withMotivationProfile(() =>
        generateQuietPrompt({ quietPrompt: prompt, trimToSentence: false, skipWIAN: true, quietName: 'System' }));
      if (!this._chatTokenStillValid(chatToken)) return;

      const match = String(raw || '').match(/\{[\s\S]*\}/);
      const parsed = match ? JSON.parse(match[0]) : null;
      if (!parsed?.detected || !parsed.secretId) return;

      let owner = null, secret = null;
      for (const m of this._members()) {
        const cs = this.state.perChar?.[m.id];
        const hit = (cs?.secrets ?? []).find(s => s.id === parsed.secretId);
        if (hit) { owner = m; secret = hit; break; }
      }
      if (!owner || !secret) return;

      const learners = this._resolveLearners(parsed.learners);
      if (!learners.length) return;
      const already = normalizeKnownBy(secret.knownBy);
      const isNew = learners.some(l => !already.some(k => k.type === l.type && k.id === l.id));
      if (!isNew) return;

      this._ensureSonar();
      if (this.state.sonar.secretPings.some(p => p.secretId === secret.id)) return;
      this.state.sonar.secretPings.push({
        id: uid(),
        secretId: secret.id,
        ownerCharacterId: owner.id,
        ownerName: owner.name || 'Unnamed',
        secretTitle: secret.title,
        learners,
        learnerNames: learners.map(l => knowerLabel(this.storage, l)).filter(Boolean),
        note: String(parsed.note || '').trim().slice(0, 160),
        at: Date.now(),
      });
      if (this.state.sonar.secretPings.length > MAX_SONAR_PINGS) this.state.sonar.secretPings.shift();
      this.saveState();
      this.bus.emit('showtime.stateChanged');
      if (this.container) this.render(this.container);
    } catch (err) {
      console.warn('[Motivation secrets sonar]', err);
    } finally {
      this._sonarSecretsBusy = false;
    }
  }

  /**
   * Narrative sonar (achievements): throttled every-N-messages broad pass
   * (mirrors Backstage's Director auto-check cadence) over beats whose
   * deterministic gate is ALREADY open — the LLM only judges whether the
   * beat's described payoff actually happened, never re-litigates the gate.
   * Accepting a ping unlocks the beat and distributes its rewards
   * (achievements / secret reveals / inventory items).
   */
  async _scanAchievementsSonar() {
    const pol = this._motivationPolicy();
    if (pol.enabled === false || pol.achievementsSonar === false) return;
    if (this._sonarBeatsBusy) return;
    const sonar = this._ensureSonar();
    if (sonar.beatPings.length >= MAX_SONAR_PINGS) return;

    const eligible = this._eligibleBeats();
    if (!eligible.length) return;

    const chat = getContext().chat ?? [];
    const tail = chat.slice(-12)
      .filter(m => m && !m.is_system)
      .map(m => `${m.name || (m.is_user ? 'You' : '')}: ${String(m.mes || '').slice(0, 400)}`)
      .join('\n').slice(-3000);
    if (!tail.trim()) return;

    const roster = eligible.slice(0, 20).map(e =>
      `- id=${e.step.id} · ${e.characterName} · "${e.step.title}" — ${e.step.description ? e.step.description.slice(0, 160) : 'no description'}`);

    const chatToken = this._chatToken();
    this._sonarBeatsBusy = true;
    try {
      const prompt = `[System: Return ONLY JSON. No markdown.]
Recent scene:
"""
${tail}
"""

Beats currently eligible to pay off (id, character, title, description):
${roster.join('\n')}

Decide if the recent scene shows the payoff described by any of these beats actually happening — not just being discussed, threatened, or hinted at, but actually occurring.
JSON schema:
{"unlocks":[{"beatId":"","note":""}]}
- beatId must exactly match an id from the list above.
- Only include a beat if its payoff clearly already happened in the recent scene.
- note: one short clause (<=15 words) on what happened.
- Return {"unlocks":[]} if nothing clearly paid off yet.
JSON:`;
      const raw = await this._withMotivationProfile(() =>
        generateQuietPrompt({ quietPrompt: prompt, trimToSentence: false, skipWIAN: true, quietName: 'System' }));
      if (!this._chatTokenStillValid(chatToken)) return;

      const match = String(raw || '').match(/\{[\s\S]*\}/);
      const parsed = match ? JSON.parse(match[0]) : null;
      const unlocks = Array.isArray(parsed?.unlocks) ? parsed.unlocks : [];
      if (!unlocks.length) return;

      this._ensureSonar();
      let changed = false;
      for (const u of unlocks.slice(0, 3)) {
        const beatId = String(u?.beatId || '').trim();
        const hit = eligible.find(e => e.step.id === beatId);
        if (!hit) continue;
        if (this.state.sonar.beatPings.some(p => p.beatId === beatId)) continue;
        this.state.sonar.beatPings.push({
          id: uid(),
          characterId: hit.characterId,
          characterName: hit.characterName,
          beatId,
          beatTitle: hit.step.title || 'Untitled beat',
          note: String(u?.note || '').trim().slice(0, 160),
          at: Date.now(),
        });
        changed = true;
      }
      if (!changed) return;
      if (this.state.sonar.beatPings.length > MAX_SONAR_PINGS) {
        this.state.sonar.beatPings.splice(0, this.state.sonar.beatPings.length - MAX_SONAR_PINGS);
      }
      this.saveState();
      this.bus.emit('showtime.stateChanged');
      if (this.container) this.render(this.container);
    } catch (err) {
      console.warn('[Motivation achievements sonar]', err);
    } finally {
      this._sonarBeatsBusy = false;
    }
  }

  _applySecretPing(id) {
    const sonar = this._ensureSonar();
    const idx = sonar.secretPings.findIndex(p => p.id === id);
    if (idx === -1) return;
    const ping = sonar.secretPings[idx];
    const cs = this.state.perChar?.[ping.ownerCharacterId];
    const secret = cs?.secrets?.find(s => s.id === ping.secretId);
    if (secret) {
      for (const learner of ping.learners || []) setKnowerStance(secret, learner, 'knows');
      if (secret.status === 'unknown') secret.status = 'earned';
    }
    sonar.secretPings.splice(idx, 1);
    this.saveState();
    this.bus.emit('motivation.updated', { characterId: ping.ownerCharacterId });
    this.render(this.container);
  }

  _applyBeatPing(id) {
    const sonar = this._ensureSonar();
    const idx = sonar.beatPings.findIndex(p => p.id === id);
    if (idx === -1) return;
    const ping = sonar.beatPings[idx];
    sonar.beatPings.splice(idx, 1);
    const cs = this.state.perChar?.[ping.characterId];
    const step = cs?.steps?.find(s => s.id === ping.beatId);
    if (cs && step && !step.unlocked && step.sceneUid) {
      const parent = step.parentId ? cs.steps.find(s => s.id === step.parentId) : null;
      if (!parent || parent.unlocked) {
        const priorSelected = this.state.selectedId;
        this.state.selectedId = ping.characterId;
        const gate = this._gateEval(cs, step);
        this.state.selectedId = priorSelected;
        if (gate.open) this._unlockStep(cs, step, ping.characterId);
      }
    }
    this.saveState();
    this.render(this.container);
  }

  _dismissSonarPing(listName, id) {
    const sonar = this._ensureSonar();
    const list = sonar[listName] ?? [];
    const idx = list.findIndex(p => p.id === id);
    if (idx !== -1) list.splice(idx, 1);
    this.saveState();
    this.render(this.container);
  }

  _applyRewards(cs, step, characterId = null) {
    for (const r of step.rewards ?? []) {
      this._grantReward(cs, step, r);
      if (r.kind === 'achievement') {
        for (const offer of r.offers ?? []) this._grantReward(cs, step, offer);
      }
    }
    this.bus.emit('motivation.updated', { characterId: characterId || this.state.selectedId });
  }

  _grantReward(cs, step, r) {
    const title = String(r.title || r.name || '').trim();
    if (!title) return;
    const kind = r.kind === 'secret' ? 'secret' : r.kind === 'item' ? 'item' : r.kind === 'achievement' ? 'achievement' : '';
    if (kind === 'secret') {
      const hit = cs.secrets.find(s => s.title.toLowerCase() === title.toLowerCase());
      const star = getStarMember(this.storage);
      const extra = star?.id ? [{ type: 'cast', id: star.id }] : [];
      if (hit) {
        hit.revealedBy = step.id;
        hit.knownByBefore = normalizeKnownBy(hit.knownBy);
        hit.unawareByBefore = normalizeKnownBy(hit.unawareBy);
        for (const k of extra) setKnowerStance(hit, k, 'knows');
        if (hit.status === 'unknown') hit.status = 'earned';
        if (!hit.sceneUid && step.sceneUid) hit.sceneUid = step.sceneUid;
      } else {
        const row = {
          id: uid(), title, tier: TIER_MAP[r.tier] ? r.tier : 'notable',
          description: String(r.description || '').slice(0, 400),
          knownBy: [], unawareBy: [], known: false, fromStepId: step.id,
          status: 'earned', sceneUid: step.sceneUid || '',
        };
        for (const k of extra) setKnowerStance(row, k, 'knows');
        cs.secrets.push(row);
      }
      this._openDrawers.add('secrets');
      return;
    }
    if (kind === 'achievement') {
      const hit = cs.achievements.find(a => a.title.toLowerCase() === title.toLowerCase());
      if (hit) {
        hit.known = true;
        hit.status = hit.status === 'established' ? 'established' : 'earned';
        hit.fromStepId ??= step.id;
        if (!hit.sceneUid && step.sceneUid) hit.sceneUid = step.sceneUid;
      } else {
        cs.achievements.push({
          id: uid(), title, tier: TIER_MAP[r.tier] ? r.tier : 'notable',
          description: String(r.description || '').slice(0, 400),
          known: true, fromStepId: step.id,
          status: 'earned', sceneUid: step.sceneUid || '',
        });
      }
      this._openDrawers.add('achievements');
      return;
    }
    if (kind === 'item') this._grantItem(step, r, title);
  }

  _grantItem(step, r, title) {
    const inv = this.storage.getChat('inventory', { static: [], mobile: [], currency: {}, openBoxes: [] });
    inv.mobile ??= [];
    inv.static ??= [];
    const key = title.toLowerCase();
    if ([...inv.mobile, ...inv.static].some(x => String(x.name || '').toLowerCase() === key)) return;
    inv.mobile.push({
      id: uid(),
      kind: 'item',
      name: title,
      description: String(r.description || '').slice(0, 400),
      parentId: null,
      location: 'mobile',
      condition: 'fine',
      category: ITEM_CATS.includes(r.category) ? r.category : 'misc',
      fromStepId: step.id,
    });
    this.storage.saveChat();
    this.bus.emit('inventory.updated');
  }

  _withdrawRewards(cs, step) {
    for (const kind of ['secrets', 'achievements']) {
      cs[kind] = (cs[kind] ?? []).filter(x => x.fromStepId !== step.id);
      for (const x of cs[kind]) {
        if (x.revealedBy === step.id) {
          if (kind === 'secrets') {
            x.knownBy = normalizeKnownBy(x.knownByBefore);
            if (x.unawareByBefore) x.unawareBy = normalizeKnownBy(x.unawareByBefore);
            x.known = x.knownBy.length > 0;
            delete x.knownByBefore;
            delete x.unawareByBefore;
            if (x.status === 'earned' && !x.knownBy.length) x.status = 'unknown';
          } else {
            x.known = false;
            if (x.status === 'earned') x.status = 'unknown';
          }
          delete x.revealedBy;
        }
      }
    }
    const inv = this.storage.getChat('inventory', { static: [], mobile: [], currency: {}, openBoxes: [] });
    let invChanged = false;
    for (const loc of ['mobile', 'static']) {
      const list = inv[loc];
      if (!Array.isArray(list)) continue;
      const next = list.filter(x => x.fromStepId !== step.id);
      if (next.length !== list.length) {
        inv[loc] = next;
        invChanged = true;
      }
    }
    if (invChanged) {
      this.storage.saveChat();
      this.bus.emit('inventory.updated');
    }
    this.bus.emit('motivation.updated', { characterId: this.state.selectedId });
  }

  _normalizeReward(x) {
    if (!x || typeof x !== 'object') return null;
    const kind = REWARD_KINDS.some(k => k.id === x.kind) ? x.kind : (x.kind === 'loot' || x.kind === 'object' ? 'item' : 'bonus');
    const title = String(x.title ?? x.name ?? '').slice(0, 120).trim();
    if (!title) return null;
    const offers = (Array.isArray(x.offers) ? x.offers : Array.isArray(x.grants) ? x.grants : [])
      .slice(0, 3)
      .map(o => {
        const okind = o?.kind === 'secret' ? 'secret' : 'item';
        const ot = String(o?.title ?? o?.name ?? '').slice(0, 120).trim();
        if (!ot) return null;
        return {
          kind: okind,
          title: ot,
          description: String(o?.description ?? '').slice(0, 400),
          tier: TIER_MAP[o?.tier] ? o.tier : 'notable',
          category: ITEM_CATS.includes(o?.category) ? o.category : 'misc',
        };
      })
      .filter(Boolean);
    return {
      kind,
      title,
      tier: TIER_MAP[x.tier] ? x.tier : 'notable',
      description: String(x.description ?? '').slice(0, 400),
      category: ITEM_CATS.includes(x.category) ? x.category : 'misc',
      offers: kind === 'achievement' ? offers : [],
    };
  }

  // ── editors ────────────────────────────────────────────────────────────────

  _openCardEditor(cs, kind, existing) {
    const x = existing ?? { title: '', tier: 'notable', description: '', known: false, knownBy: [], unawareBy: [], status: 'unknown', sceneUid: '' };
    this._normalizeRecord(x, { secret: kind === 'secrets' });
    const isSecret = kind === 'secrets';
    const backdrop = this._modal(`
      <div class="mot-modal-title">${existing ? 'REFIT' : 'FILE'} ${isSecret ? 'SECRET' : 'ACHIEVEMENT'}</div>
      <div class="mot-modal-sub">— title · weight · ${isSecret ? 'who knows' : 'record'} —</div>
      <div class="mot-field"><label>Title</label>
        <input type="text" data-field="title" value="${esc(x.title)}"></div>
      <div class="mot-field"><label>${isSecret ? 'Priority' : 'Rarity'}</label>
        <select data-field="tier">${TIERS.map(t =>
          `<option value="${t.id}" ${t.id === x.tier ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}</select></div>
      <div class="mot-field"><label>Description</label>
        <textarea data-field="description">${esc(x.description ?? '')}</textarea></div>
      <div class="mot-field"><label>Record</label>
        <select data-field="status">${STATUSES.map(s =>
          `<option value="${s.id}" ${s.id === (x.status || 'unknown') ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}</select>
        <div class="mot-hint">Earned happened in play. Established was already true.</div></div>
      ${this._sceneFieldHTML(x)}
      ${isSecret
        ? `<div class="mot-field"><label>Who knows</label>
            <div data-role="known-by"></div>
            <button type="button" class="mot-btn small" data-action="assign-know">Assign…</button>
            <div class="mot-hint">Pick a cast member or affiliation, then Knows or In the dark. Untagged parties have no Reputation connection.</div></div>`
        : ''}
      <div class="mot-modal-actions">
        <button type="button" class="mot-btn" data-action="cancel">Cancel</button>
        <button type="button" class="mot-btn gold" data-action="save">Save</button>
      </div>
    `);
    const knowDraft = isSecret
      ? { title: x.title, knownBy: normalizeKnownBy(x.knownBy), unawareBy: normalizeKnownBy(x.unawareBy) }
      : null;
    if (isSecret) {
      const knowWrap = backdrop.querySelector('[data-role="known-by"]');
      const refreshKnow = () => this._refreshKnowerField(knowWrap, knowDraft, { persist: false });
      refreshKnow();
      backdrop.querySelector('[data-action="assign-know"]')?.addEventListener('click', () => {
        knowDraft.title = backdrop.querySelector('[data-field="title"]')?.value.trim() || x.title || 'Untitled';
        this._openKnownDialog(knowDraft, { persist: false, onChange: refreshKnow });
      });
    }
    const statusEl = backdrop.querySelector('[data-field="status"]');
    const sceneWrap = backdrop.querySelector('.mot-scene-field');
    const sceneEl = backdrop.querySelector('[data-field="sceneUid"]');
    const syncScene = () => {
      if (sceneWrap) sceneWrap.hidden = statusEl.value !== 'earned';
    };
    statusEl.addEventListener('change', syncScene);
    syncScene();
    backdrop.querySelector('[data-action="save"]').addEventListener('click', () => {
      const title = backdrop.querySelector('[data-field="title"]').value.trim();
      if (!title) { alert('A title is required.'); return; }
      const status = STATUS_MAP[statusEl.value] ? statusEl.value : 'unknown';
      const patch = {
        title,
        tier: backdrop.querySelector('[data-field="tier"]').value,
        description: backdrop.querySelector('[data-field="description"]').value.trim(),
        status,
        sceneUid: sceneEl?.value || '',
      };
      if (isSecret) {
        patch.knownBy = normalizeKnownBy(knowDraft.knownBy);
        patch.unawareBy = normalizeKnownBy(knowDraft.unawareBy);
        patch.known = patch.knownBy.length > 0;
      } else {
        patch.known = status !== 'unknown';
      }
      if (existing) Object.assign(existing, patch);
      else {
        const row = { id: uid(), knownBy: [], unawareBy: [], ...patch };
        cs[kind].push(row);
        existing = row;
      }
      this._openDrawers.add(kind);
      this._focusedCard ??= { secrets: '', achievements: '', interviews: '' };
      this._focusedCard[kind] = existing.id;
      this.saveState();
      this.bus.emit('motivation.updated', { characterId: this.state.selectedId });
      backdrop.remove();
      this.render(this.container);
    });
    setTimeout(() => backdrop.querySelector('[data-field="title"]').focus(), 0);
  }

  _knowerChoices(kind) {
    if (kind === 'house') {
      return this._houses().map(h => ({
        type: 'house',
        id: h.id,
        label: h.alias ? `${h.name} (${h.alias})` : (h.name || 'House'),
      }));
    }
    return this._members().map(m => ({
      type: 'cast',
      id: m.id,
      label: m.name || 'Unnamed',
    }));
  }

  _knowerChipsHTML(secret) {
    const rows = [
      ...normalizeKnownBy(secret?.knownBy).map(k => ({ ...k, stance: 'knows' })),
      ...normalizeKnownBy(secret?.unawareBy).map(k => ({ ...k, stance: 'unaware' })),
    ];
    if (!rows.length) {
      return `<div class="mot-know-empty">Nobody tagged — no Reputation connection until you assign Knows or In the dark.</div>`;
    }
    return `<div class="mot-know-chips">${rows.map(k => `
      <span class="mot-know-chip ${k.stance}" data-know-type="${esc(k.type)}" data-know-id="${esc(k.id)}">
        ${esc(knowerLabel(this.storage, k))}${k.type === 'house' ? ` · ${esc(knowerShareHint(k))}` : ''} · ${k.stance === 'knows' ? 'Knows' : 'Dark'}
        <button type="button" class="mot-know-x" data-action="untrack" title="Remove from this secret">×</button>
      </span>`).join('')}</div>`;
  }

  _refreshKnowerField(wrap, secret, opts = {}) {
    if (!wrap) return;
    wrap.innerHTML = this._knowerChipsHTML(secret);
    wrap.querySelectorAll('[data-action="untrack"]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        const chip = btn.closest('[data-know-id]');
        if (!chip) return;
        setKnowerStance(secret, { type: chip.dataset.knowType, id: chip.dataset.knowId }, '');
        if (opts.persist) {
          this.saveState();
          this.bus.emit('motivation.updated', { characterId: this.state.selectedId });
        }
        this._refreshKnowerField(wrap, secret, opts);
        opts.onChange?.();
      });
    });
  }

  _selectedKnower(root) {
    const sel = root.querySelector('[data-field="knower"]');
    const raw = String(sel?.value || '');
    const [type, ...rest] = raw.split(':');
    const id = rest.join(':');
    if ((type !== 'cast' && type !== 'house') || !id) return null;
    return { type, id };
  }

  _knowerStanceOf(secret, knower) {
    if (!knower) return '';
    const key = knowerKey(knower);
    if (normalizeKnownBy(secret.knownBy).some(k => knowerKey(k) === key)) return 'knows';
    if (normalizeKnownBy(secret.unawareBy).some(k => knowerKey(k) === key)) return 'unaware';
    return '';
  }

  /**
   * Set-style punch ticket: pick a cast member or affiliation, then Knows
   * vs In the dark. Untagged parties stay off the Reputation web.
   */
  _openKnownDialog(secret, { persist = true, onChange } = {}) {
    this._closeKnowPop();
    this._closeKnowModal();
    const title = secret.title || 'Untitled';
    const backdrop = buildModal(`
      <div class="inv-modal-title">SET · WHO KNOWS</div>
      <div class="inv-modal-subtitle">— ${esc(title)} · untagged = no connection —</div>
      <div class="inv-modal-field">
        <label>Who</label>
        <div class="inv-kind-row" data-role="know-kind">
          <button type="button" class="inv-kind-btn on" data-kind="cast">Cast</button>
          <button type="button" class="inv-kind-btn" data-kind="house">Affiliation</button>
        </div>
        <select data-field="knower"></select>
        <div class="inv-modal-hint" data-role="know-empty" hidden></div>
        <div class="mot-share-affils" data-role="house-share" hidden>
          <label class="mot-share-toggle">
            <input type="checkbox" data-field="share-affiliates">
            Affiliates may know this
          </label>
          <div class="inv-modal-hint">Off: the affiliation holds it as an institution. On: pick which members also know — membership alone is not enough.</div>
          <div class="mot-share-tools" data-role="affiliate-tools" hidden>
            <button type="button" class="inv-btn small" data-action="share-all">All members</button>
            <button type="button" class="inv-btn small" data-action="share-none">Clear</button>
          </div>
          <div class="mot-share-list" data-role="affiliate-list" hidden></div>
        </div>
      </div>
      <div class="inv-modal-field">
        <label>This secret</label>
        <div class="inv-kind-row" data-role="know-stance">
          <button type="button" class="inv-kind-btn" data-stance="knows">Knows</button>
          <button type="button" class="inv-kind-btn" data-stance="unaware">In the dark</button>
        </div>
        <button type="button" class="inv-btn small" data-action="untrack-one" style="margin-top:8px">Untrack</button>
        <div class="inv-modal-hint">Knows and In the dark are explicit. Anyone left off both lists has no link.</div>
      </div>
      <div class="inv-modal-field">
        <label>Filed</label>
        <div data-role="known-by"></div>
      </div>
      <div class="inv-modal-actions">
        <button type="button" class="inv-btn" data-act="close">Done</button>
      </div>
    `);
    this._knowModal = backdrop;
    backdrop.style.zIndex = '100001';
    const kindRow = backdrop.querySelector('[data-role="know-kind"]');
    const stanceRow = backdrop.querySelector('[data-role="know-stance"]');
    const select = backdrop.querySelector('[data-field="knower"]');
    const emptyHint = backdrop.querySelector('[data-role="know-empty"]');
    const filed = backdrop.querySelector('[data-role="known-by"]');

    const shareWrap = backdrop.querySelector('[data-role="house-share"]');
    const shareToggle = backdrop.querySelector('[data-field="share-affiliates"]');
    const affilTools = backdrop.querySelector('[data-role="affiliate-tools"]');
    const affilList = backdrop.querySelector('[data-role="affiliate-list"]');

    const persistIf = () => {
      if (!persist) return;
      this.saveState();
      this.bus.emit('motivation.updated', { characterId: this.state.selectedId });
    };

    const filedKnower = knower => {
      if (!knower) return null;
      return [...normalizeKnownBy(secret.knownBy), ...normalizeKnownBy(secret.unawareBy)]
        .find(k => k.type === knower.type && k.id === knower.id) || null;
    };

    const renderAffiliateBoxes = (picked = new Set()) => {
      const knower = this._selectedKnower(backdrop);
      if (knower?.type !== 'house') return;
      const roster = houseAffiliateRoster(this.storage, knower.id);
      if (!roster.length) {
        affilList.innerHTML = `<div class="inv-modal-hint">No members listed on this affiliation yet.</div>`;
        return;
      }
      affilList.innerHTML = roster.map(r => `
        <label>
          <input type="checkbox" data-affiliate value="${esc(r.id)}" ${picked.has(r.id) ? 'checked' : ''}>
          ${esc(r.name)}
        </label>`).join('');
    };

    const paintHouseShare = () => {
      const knower = this._selectedKnower(backdrop);
      const isHouse = knower?.type === 'house';
      shareWrap.hidden = !isHouse;
      if (!isHouse) return;
      const roster = houseAffiliateRoster(this.storage, knower.id);
      const existing = filedKnower(knower);
      const share = knowerShareMode(existing);
      const picked = new Set(
        share === 'all'
          ? roster.map(r => r.id)
          : knowerMemberIds(existing),
      );
      shareToggle.checked = share === 'all' || share === 'members';
      affilTools.hidden = !shareToggle.checked;
      affilList.hidden = !shareToggle.checked;
      renderAffiliateBoxes(picked);
    };

    const readHouseShare = houseId => {
      if (!shareToggle.checked) return { share: 'none', memberIds: [] };
      const roster = houseAffiliateIds(this.storage, houseId);
      const ids = [...backdrop.querySelectorAll('[data-affiliate]:checked')].map(el => el.value).filter(Boolean);
      if (roster.length && ids.length >= roster.length) return { share: 'all', memberIds: ids };
      return { share: 'members', memberIds: ids };
    };

    const paintStance = () => {
      const cur = this._knowerStanceOf(secret, this._selectedKnower(backdrop));
      stanceRow.querySelectorAll('[data-stance]').forEach(btn => {
        btn.classList.toggle('on', btn.dataset.stance === cur);
      });
      paintHouseShare();
    };

    const fillSelect = kind => {
      const choices = this._knowerChoices(kind);
      select.innerHTML = choices.length
        ? `<option value="">— Choose ${kind === 'house' ? 'an affiliation' : 'a cast member'} —</option>`
          + choices.map(c => `<option value="${esc(c.type)}:${esc(c.id)}">${esc(c.label)}</option>`).join('')
        : `<option value="">— None —</option>`;
      emptyHint.hidden = choices.length > 0;
      emptyHint.textContent = kind === 'house'
        ? 'No affiliations yet — add one in Reputation.'
        : 'No cast yet.';
      paintStance();
    };

    const refreshFiled = () => {
      this._refreshKnowerField(filed, secret, {
        persist,
        onChange: () => { paintStance(); onChange?.(); },
      });
    };

    kindRow.querySelectorAll('[data-kind]').forEach(btn => {
      btn.addEventListener('click', () => {
        kindRow.querySelectorAll('[data-kind]').forEach(b => b.classList.toggle('on', b === btn));
        fillSelect(btn.dataset.kind);
      });
    });
    select.addEventListener('change', paintStance);
    const persistShareIfFiled = () => {
      const knower = this._selectedKnower(backdrop);
      if (!knower || knower.type !== 'house') return;
      const stance = this._knowerStanceOf(secret, knower);
      if (!stance) return;
      Object.assign(knower, readHouseShare(knower.id));
      setKnowerStance(secret, knower, stance);
      persistIf();
      refreshFiled();
    };

    shareToggle.addEventListener('change', () => {
      affilTools.hidden = !shareToggle.checked;
      affilList.hidden = !shareToggle.checked;
      if (shareToggle.checked && !affilList.querySelector('[data-affiliate]')) {
        renderAffiliateBoxes(new Set());
      }
      persistShareIfFiled();
    });
    backdrop.querySelector('[data-action="share-all"]').addEventListener('click', () => {
      affilList.querySelectorAll('[data-affiliate]').forEach(el => { el.checked = true; });
      persistShareIfFiled();
    });
    backdrop.querySelector('[data-action="share-none"]').addEventListener('click', () => {
      affilList.querySelectorAll('[data-affiliate]').forEach(el => { el.checked = false; });
      persistShareIfFiled();
    });
    affilList.addEventListener('change', persistShareIfFiled);

    const applyStance = stance => {
      const knower = this._selectedKnower(backdrop);
      if (!knower) { alert('Pick a cast member or affiliation first.'); return; }
      if (knower.type === 'house') Object.assign(knower, readHouseShare(knower.id));
      setKnowerStance(secret, knower, stance);
      persistIf();
      refreshFiled();
      paintStance();
      onChange?.();
    };
    stanceRow.querySelectorAll('[data-stance]').forEach(btn => {
      btn.addEventListener('click', () => applyStance(btn.dataset.stance));
    });
    backdrop.querySelector('[data-action="untrack-one"]').addEventListener('click', () => applyStance(''));

    const close = () => {
      this._closeKnowModal();
      if (persist && this.container) this.render(this.container);
    };
    backdrop.querySelector('[data-act="close"]').addEventListener('click', close);
    backdrop.addEventListener('click', e => {
      if (e.target === backdrop) {
        if (persist && this.container) this.render(this.container);
        this._knowModal = null;
      }
    });

    fillSelect('cast');
    refreshFiled();
  }

  _openStepEditor(cs, existing) {
    const step = existing ?? { title: '', description: '', theme: '', branch: '', parentId: '', rewards: [] };
    const others = (cs.steps ?? []).filter(s => s.id !== existing?.id);
    const backdrop = this._modal(`
      <div class="mot-modal-title">${existing ? 'REFIT BEAT' : 'NEW BEAT'}</div>
      <div class="mot-modal-sub">— a want, a turn, or a cost —</div>
      <div class="mot-field"><label>Title</label>
        <input type="text" data-field="title" value="${esc(step.title)}"></div>
      <div class="mot-field"><label>Description</label>
        <textarea data-field="description">${esc(step.description ?? '')}</textarea></div>
      <div class="mot-field-row">
        <div class="mot-field"><label>Trope / theme</label>
          <input type="text" data-field="theme" value="${esc(step.theme ?? '')}" placeholder="e.g. reluctant mentor"></div>
        <div class="mot-field"><label>Branch label</label>
          <input type="text" data-field="branch" value="${esc(step.branch ?? '')}" placeholder="e.g. Defiance"></div>
      </div>
      <div class="mot-field"><label>Follows</label>
        <select data-field="parentId">
          <option value="">— Opening beat —</option>
          ${others.map(s => `<option value="${esc(s.id)}" ${s.id === step.parentId ? 'selected' : ''}>${esc(s.title || 'Untitled')}</option>`).join('')}
        </select>
        <div class="mot-hint">Branches share a parent — two beats after the same arc are a fork.</div></div>
      <div class="mot-field"><label>Rewards on unlock</label>
        <div class="mot-reward-edit" data-role="rewards">
          ${(step.rewards ?? []).map(r => this._rewardChipHTML(r)).join('') || '<span class="mot-hint">None</span>'}
        </div>
        <button type="button" class="mot-btn small" data-action="add-reward">＋ Add reward</button></div>
      <div class="mot-field"><label>Conditions to open this path</label>
        <div class="mot-reward-edit" data-role="gates">
          ${(step.gate?.rules ?? []).map(r => this._gateChipHTML(r)).join('') || '<span class="mot-hint">None — opens as soon as its parent does</span>'}
        </div>
        <button type="button" class="mot-btn small" data-action="add-gate">＋ Add condition</button>
        <label class="mot-inline-check">
          <input type="checkbox" data-field="gateHidden" ${step.gate?.hidden ? 'checked' : ''}>
          Keep it sealed on the board until they are met
        </label></div>
      <div class="mot-modal-actions">
        <button type="button" class="mot-btn" data-action="cancel">Cancel</button>
        <button type="button" class="mot-btn gold" data-action="save">Save</button>
      </div>
    `);
    const rewardWrap = backdrop.querySelector('[data-role="rewards"]');
    rewardWrap.addEventListener('click', e => {
      const x = e.target.closest('.mot-reward-x');
      if (!x) return;
      x.closest('.mot-reward')?.remove();
    });
    backdrop.querySelector('[data-action="add-reward"]').addEventListener('click', () => {
      this._openRewardAdd(rewardWrap);
    });
    const gateWrap = backdrop.querySelector('[data-role="gates"]');
    gateWrap.addEventListener('click', e => {
      const x = e.target.closest('.mot-reward-x');
      if (!x) return;
      x.closest('.mot-gate')?.remove();
      if (!gateWrap.querySelector('.mot-gate')) {
        gateWrap.innerHTML = '<span class="mot-hint">None — opens as soon as its parent does</span>';
      }
    });
    backdrop.querySelector('[data-action="add-gate"]').addEventListener('click', () => {
      this._openGateAdd(gateWrap, cs, existing?.id);
    });
    backdrop.querySelector('[data-action="save"]').addEventListener('click', () => {
      const title = backdrop.querySelector('[data-field="title"]').value.trim();
      if (!title) { alert('A title is required.'); return; }
      const rewards = [...rewardWrap.querySelectorAll('.mot-reward')].map(el => {
        let offers = [];
        try { offers = JSON.parse(el.dataset.offers || '[]'); } catch { offers = []; }
        return {
          kind: el.dataset.kind,
          title: el.dataset.title,
          tier: el.dataset.tier || '',
          description: el.dataset.description || '',
          category: el.dataset.category || 'misc',
          offers,
        };
      });
      const rules = [...gateWrap.querySelectorAll('.mot-gate')].map(el => ({
        type: el.dataset.type,
        subject: el.dataset.subject || '',
        op: el.dataset.op || 'min',
        value: Number(el.dataset.value) || 0,
        refId: el.dataset.ref || '',
        mode: el.dataset.mode || '',
      }));
      const patch = {
        title,
        description: backdrop.querySelector('[data-field="description"]').value.trim(),
        theme: backdrop.querySelector('[data-field="theme"]').value.trim(),
        branch: backdrop.querySelector('[data-field="branch"]').value.trim(),
        parentId: backdrop.querySelector('[data-field="parentId"]').value || null,
        rewards,
        gate: {
          hidden: !!backdrop.querySelector('[data-field="gateHidden"]').checked,
          rules,
        },
      };
      if (existing) Object.assign(existing, patch);
      else cs.steps.push({ id: uid(), sceneUid: '', unlocked: false, unlockedAt: 0, ...patch });
      this._normalizeGate(existing ?? cs.steps[cs.steps.length - 1]);
      this.saveState();
      backdrop.remove();
      this.render(this.container);
    });
    setTimeout(() => backdrop.querySelector('[data-field="title"]').focus(), 0);
  }

  _rewardChipHTML(r) {
    return `<span class="mot-reward mot-reward--${esc(r.kind)}" data-kind="${esc(r.kind)}" data-title="${esc(r.title)}"
      data-tier="${esc(r.tier || '')}" data-description="${esc(r.description || '')}"
      data-category="${esc(r.category || 'misc')}" data-offers="${esc(JSON.stringify(r.offers || []))}">
      ${esc(labelForReward(r))} <button type="button" class="mot-reward-x">×</button></span>`;
  }

  _gateChipHTML(r) {
    return `<span class="mot-gate" data-type="${esc(r.type)}" data-subject="${esc(r.subject || '')}"
      data-op="${esc(r.op || 'min')}" data-value="${esc(String(r.value ?? 0))}"
      data-ref="${esc(r.refId || '')}" data-mode="${esc(r.mode || '')}">
      ${esc(this._gateLabel(r))} <button type="button" class="mot-reward-x">×</button></span>`;
  }

  _openGateAdd(wrap, cs, selfId) {
    const subjects = standingSubjects(this.storage);
    const secrets = cs.secrets ?? [];
    const scenes = getSceneCards(this.storage);
    const beats = (cs.steps ?? []).filter(s => s.id !== selfId);
    const inner = this._modal(`
      <div class="mot-modal-title">CONDITION</div>
      <div class="mot-modal-sub">— what has to be true before this path opens —</div>
      <div class="mot-field"><label>Kind</label>
        <select data-field="type">${GATE_TYPES.map(g =>
          `<option value="${g.id}">${esc(g.label)}</option>`).join('')}</select>
        <div class="mot-hint" data-role="gate-hint">${esc(GATE_TYPES[0].hint)}</div></div>
      <div class="mot-field" data-pane="standing">
        <label>Who</label>
        <select data-field="subject">
          ${subjects.length
            ? subjects.map(s => `<option value="${esc(s.key)}">${esc(s.label)}</option>`).join('')
            : '<option value="">— No cast or houses on the web yet —</option>'}
        </select>
        <div class="mot-field-row">
          <div class="mot-field"><label>Test</label>
            <select data-field="op">
              <option value="min">At least</option>
              <option value="max">At most</option>
            </select></div>
          <div class="mot-field"><label>Standing</label>
            <input type="number" data-field="value" min="-100" max="100" step="1" value="40"></div>
        </div>
        <div class="mot-hint">Reputation scale, −100 Infamous to +100 Celebrated.</div>
      </div>
      <div class="mot-field" data-pane="secret" hidden>
        <label>Secret</label>
        <select data-field="secret">
          ${secrets.length
            ? secrets.map(s => `<option value="${esc(s.id)}">${esc(s.title || 'Untitled')}</option>`).join('')
            : '<option value="">— No secrets on this sheet —</option>'}
        </select>
        <label>State</label>
        <select data-field="secretMode">
          <option value="known">Someone knows it</option>
          <option value="buried">Nobody knows it</option>
        </select>
      </div>
      <div class="mot-field" data-pane="scene" hidden>
        <label>Scene</label>
        <select data-field="scene">
          ${scenes.length
            ? scenes.map(s => `<option value="${esc(s.uid)}">${esc(s.code)} — ${esc(s.title)}</option>`).join('')
            : '<option value="">— No scenes on the Script —</option>'}
        </select>
        <label>Requirement</label>
        <select data-field="sceneMode">
          <option value="credited">Credited in it</option>
          <option value="absent">Absent from it</option>
        </select>
      </div>
      <div class="mot-field" data-pane="beat" hidden>
        <label>Beat</label>
        <select data-field="beat">
          ${beats.length
            ? beats.map(s => `<option value="${esc(s.id)}">${esc(s.title || 'Untitled')}</option>`).join('')
            : '<option value="">— No other beats yet —</option>'}
        </select>
        <div class="mot-hint">Use this for a prerequisite that is not this beat's parent.</div>
      </div>
      <div class="mot-modal-actions">
        <button type="button" class="mot-btn" data-action="cancel">Cancel</button>
        <button type="button" class="mot-btn gold" data-action="ok">Add</button>
      </div>
    `);
    const typeSel = inner.querySelector('[data-field="type"]');
    const syncPanes = () => {
      inner.querySelector('[data-role="gate-hint"]').textContent = GATE_MAP[typeSel.value]?.hint ?? '';
      inner.querySelectorAll('[data-pane]').forEach(p => {
        p.hidden = p.dataset.pane !== typeSel.value;
      });
    };
    typeSel.addEventListener('change', syncPanes);
    syncPanes();
    inner.querySelector('[data-action="ok"]').addEventListener('click', () => {
      const type = typeSel.value;
      const rule = { type, subject: '', op: 'min', value: 0, refId: '', mode: '' };
      if (type === 'standing') {
        rule.subject = inner.querySelector('[data-field="subject"]').value;
        rule.op = inner.querySelector('[data-field="op"]').value;
        rule.value = Math.max(-100, Math.min(100, Number(inner.querySelector('[data-field="value"]').value) || 0));
        if (!rule.subject) { alert('Pick who has to feel that way.'); return; }
      } else if (type === 'secret') {
        rule.refId = inner.querySelector('[data-field="secret"]').value;
        rule.mode = inner.querySelector('[data-field="secretMode"]').value;
        if (!rule.refId) { alert('File a secret on this sheet first.'); return; }
      } else if (type === 'scene') {
        rule.refId = inner.querySelector('[data-field="scene"]').value;
        rule.mode = inner.querySelector('[data-field="sceneMode"]').value;
        if (!rule.refId) { alert('Add a scene on the Script first.'); return; }
      } else {
        rule.refId = inner.querySelector('[data-field="beat"]').value;
        if (!rule.refId) { alert('There is no other beat to wait on.'); return; }
      }
      wrap.querySelector('.mot-hint')?.remove();
      wrap.insertAdjacentHTML('beforeend', this._gateChipHTML(rule));
      inner.remove();
    });
  }

  _openRewardAdd(wrap) {
    const inner = this._modal(`
      <div class="mot-modal-title">REWARD</div>
      <div class="mot-modal-sub">— applied the moment the beat unlocks —</div>
      <div class="mot-field"><label>Kind</label>
        <select data-field="kind">${REWARD_KINDS.map(k =>
          `<option value="${k.id}">${esc(k.label)}</option>`).join('')}</select>
        <div class="mot-hint" data-role="kind-hint">${esc(REWARD_KINDS[0].hint)}</div></div>
      <div class="mot-field"><label>Title</label>
        <input type="text" data-field="title" placeholder="What lands?"></div>
      <div class="mot-field"><label>Weight</label>
        <select data-field="tier">${TIERS.map(t =>
          `<option value="${t.id}" ${t.id === 'notable' ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}</select></div>
      <div class="mot-field"><label>Description</label>
        <textarea data-field="description"></textarea></div>
      <div class="mot-modal-actions">
        <button type="button" class="mot-btn" data-action="cancel">Cancel</button>
        <button type="button" class="mot-btn gold" data-action="ok">Add</button>
      </div>
    `);
    const kindSel = inner.querySelector('[data-field="kind"]');
    kindSel.addEventListener('change', () => {
      const hint = REWARD_KINDS.find(k => k.id === kindSel.value)?.hint ?? '';
      inner.querySelector('[data-role="kind-hint"]').textContent = hint;
    });
    inner.querySelector('[data-action="ok"]').addEventListener('click', () => {
      const title = inner.querySelector('[data-field="title"]').value.trim();
      if (!title) { alert('A title is required.'); return; }
      const r = {
        kind: kindSel.value,
        title,
        tier: inner.querySelector('[data-field="tier"]').value,
        description: inner.querySelector('[data-field="description"]').value.trim(),
      };
      wrap.querySelector('.mot-hint')?.remove();
      wrap.insertAdjacentHTML('beforeend', this._rewardChipHTML(r));
      inner.remove();
    });
    setTimeout(() => inner.querySelector('[data-field="title"]').focus(), 0);
  }

  _openScenePicker(cs, stepId) {
    const step = (cs.steps ?? []).find(s => s.id === stepId);
    if (!step) return;
    const scenes = getSceneCards(this.storage);
    if (!scenes.length) {
      alert('No scene cards in Script yet. Add a scene there, then link it here.');
      return;
    }
    const backdrop = this._modal(`
      <div class="mot-modal-title">CONNECT SCENE</div>
      <div class="mot-modal-sub">— ${esc(step.title || 'Untitled beat')} —</div>
      <div class="mot-field"><label>Script scene</label>
        <select data-field="scene">
          <option value="">— Not connected —</option>
          ${scenes.map(s => `<option value="${esc(s.uid)}" ${s.uid === step.sceneUid ? 'selected' : ''}>${esc(s.code)} — ${esc(s.title)}</option>`).join('')}
        </select>
        <div class="mot-hint">A beat cannot unlock until it sits somewhere on the Script.</div></div>
      <div class="mot-modal-actions">
        <button type="button" class="mot-btn" data-action="cancel">Cancel</button>
        <button type="button" class="mot-btn gold" data-action="save">Save</button>
      </div>
    `);
    backdrop.querySelector('[data-action="save"]').addEventListener('click', () => {
      const uidVal = backdrop.querySelector('[data-field="scene"]').value;
      step.sceneUid = uidVal;
      if (!uidVal && step.unlocked) {
        step.unlocked = false;
        step.unlockedAt = 0;
        this._withdrawRewards(cs, step);
      }
      this.saveState();
      backdrop.remove();
      this.render(this.container);
    });
  }

  // ── audit ──────────────────────────────────────────────────────────────────

  _auditContext(sel) {
    const clip = (s, n = 500) => {
      const t = String(s || '').trim();
      return t.length > n ? `${t.slice(0, n)}…` : t;
    };
    const ctx = getContext();
    const record = this._castRecord(sel.id);
    const identity = resolveCastPromptIdentity(record || sel, this.storage, {
      characters: ctx.characters ?? [],
      personas: listPersonas(power_user),
    });
    // Card / persona / Director fallback for roles without their own link.
    const cardBlock = identity.block;

    const cs = this._charState(sel.id);
    const secrets = cs.secrets.length
      ? cs.secrets.slice(0, 8).map(s => {
        const who = normalizeKnownBy(s.knownBy).map(k => knowerLabel(this.storage, k)).join(', ') || 'unknown';
        const rec = s.status === 'established' ? 'established' : s.status === 'earned' ? 'earned' : 'unknown';
        const where = s.sceneUid ? ` @ ${sceneLabel(this.storage, s.sceneUid)}` : '';
        return `- [${TIER_MAP[s.tier]?.label ?? s.tier}] ${s.title} (${rec}${where}; known by: ${who})${s.description ? `: ${clip(s.description, 120)}` : ''}`;
      }).join('\n')
      : 'None recorded.';
    const achievements = cs.achievements.length
      ? cs.achievements.slice(0, 8).map(a => {
        const rec = a.status === 'established' ? 'established' : a.status === 'earned' ? 'earned' : 'unknown';
        const where = a.sceneUid ? ` @ ${sceneLabel(this.storage, a.sceneUid)}` : '';
        return `- [${TIER_MAP[a.tier]?.label ?? a.tier}] ${a.title} (${rec}${where})${a.description ? `: ${clip(a.description, 120)}` : ''}`;
      }).join('\n')
      : 'None recorded.';

    const scenes = creditedScenes(this.storage, sel.id, sel.name);
    const sceneBlock = scenes.length
      ? scenes.slice(-8).map(s => `- ${s.code} ${s.title}${s.card.span ? ` (${s.card.span})` : ''}: ${clip(s.card.summary || s.card.content, 160)}`).join('\n')
      : 'No credited scenes yet.';

    const dirBlock = formatDirectorPromptBlock(this.storage);

    const existing = (cs.steps ?? []).length
      ? cs.steps.map(s => `- ${s.title}${s.unlocked ? ' (unlocked)' : ''}`).join('\n')
      : 'None yet.';

    return { cardBlock, secrets, achievements, sceneBlock, dirBlock, existing, priority: sel.priority };
  }

  _isRateLimit(text) {
    return /too many requests|\b429\b|rate.?limit/i.test(String(text || ''));
  }

  async _quietAudit(prompt) {
    const jsonSchema = {
      name: 'motivation_beats',
      description: 'Branching character-arc beats',
      strict: false,
      returnInvalid: true,
      value: {
        type: 'object',
        properties: {
          beats: {
            type: 'array',
            minItems: 4,
            maxItems: 10,
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                parent: { type: ['string', 'null'] },
                branch: { type: 'string' },
                title: { type: 'string' },
                description: { type: 'string' },
                theme: { type: 'string' },
                rewards: { type: 'array' },
              },
              required: ['title'],
            },
          },
        },
        required: ['beats'],
      },
    };
    const opts = {
      quietPrompt: prompt,
      trimToSentence: false,
      skipWIAN: true,
      quietName: 'System',
      jsonSchema,
    };
    const once = async (useSchema = true) => {
      const payload = useSchema ? opts : { ...opts, jsonSchema: null };
      return String(await this._withMotivationProfile(() => generateQuietPrompt(payload)) ?? '').trim();
    };
    let response = '';
    try {
      response = await once(true);
    } catch (err) {
      if (this._isRateLimit(err.message)) {
        await new Promise(r => setTimeout(r, 2500));
      }
      response = await once(false);
    }
    if (this._isRateLimit(response)) {
      await new Promise(r => setTimeout(r, 2500));
      response = await once();
    }
    if (this._isRateLimit(response)) {
      throw new Error('Too many requests — the model is rate-limiting. Wait a few seconds and press Audit again.');
    }
    return response;
  }

  async _runAudit(sel, cs, btn) {
    if (this._auditBusy) return;
    this._auditBusy = true;
    const chatToken = this._chatToken();
    const orig = btn.textContent;
    btn.disabled = true;
    btn.textContent = '…';
    try {
      const c = this._auditContext(sel);
      const prompt = `SYSTEM: Return JSON only. Do not roleplay. Do not write prose.

Task: 4–8 character-arc beats for the dossier below. Wants, turns, costs. At least one fork (two beats, same parent, each with a branch label).

Every beat should carry 1–2 rewards that fit the dossier. Mix kinds:
- achievement (can also offer an item or a secret via "offers")
- secret
- item (a physical thing that goes into Inventory)
- bonus (a dynamic / leverage note)

Prefer concrete loot and secrets on payoff beats, not empty reward arrays.

${c.cardBlock}
Billing: ${PRIORITY_MAP[c.priority]?.label ?? c.priority}

Secrets:
${c.secrets}

Achievements:
${c.achievements}

Credited scenes:
${c.sceneBlock}

Director dials:
${c.dirBlock}

Existing beats (do not repeat):
${c.existing}

Schema:
{"beats":[{"id":"1","parent":null,"branch":"","title":"Opening want","description":"One concrete sentence.","theme":"trope","rewards":[{"kind":"achievement","title":"Named feat","tier":"minor","description":"What they prove.","offers":[]}]},{"id":"2","parent":"1","branch":"Defy","title":"Fork A","description":"If they refuse.","theme":"trope","rewards":[{"kind":"secret","title":"Named secret","tier":"notable","description":"What is revealed."}]},{"id":"3","parent":"1","branch":"Yield","title":"Fork B","description":"If they comply.","theme":"trope","rewards":[{"kind":"achievement","title":"Pact kept","tier":"notable","description":"The cost of yielding.","offers":[{"kind":"item","title":"Sealed letter","description":"A physical token of the deal.","category":"misc"}]}]}]}

parent is null or another id. rewards kind: achievement|secret|item|bonus. tier: trivial|minor|notable|major|pivotal. item category: consumable|wearable|usable|misc. 1–2 rewards per beat. Achievement offers: 0–2 item or secret objects.`;

      const response = await this._quietAudit(prompt);
      if (!this._chatTokenStillValid(chatToken)) {
        throw new Error('Chat changed mid-audit — discarded the draft. Switch back and press Audit again.');
      }
      const raw = salvageBeatList(response);
      if (!raw.length) {
        console.warn('[Motivation audit] raw reply:', response);
        throw new Error('Audit came back as prose instead of beats. Try Audit again.');
      }

      const idMap = new Map();
      const added = [];
      for (const r of raw.slice(0, 10)) {
        if (!r?.title) continue;
        const step = {
          id: uid(),
          title: String(r.title).slice(0, 120),
          description: String(r.description ?? '').slice(0, 400),
          theme: String(r.theme ?? '').slice(0, 120),
          branch: String(r.branch ?? '').slice(0, 40),
          parentId: null,
          sceneUid: '',
          unlocked: false,
          unlockedAt: 0,
          rewards: (Array.isArray(r.rewards) ? r.rewards : []).slice(0, 3).map(x => this._normalizeReward(x)).filter(Boolean),
        };
        if (r.id != null) idMap.set(String(r.id), step.id);
        const parentRaw = r.parent ?? r.parentId ?? r.parent_id;
        added.push({ step, parentKey: parentRaw == null || parentRaw === '' ? null : String(parentRaw) });
      }
      if (!added.length) throw new Error('JSON came back but no beats had a title.');
      for (const a of added) {
        a.step.parentId = a.parentKey ? (idMap.get(a.parentKey) ?? null) : null;
      }
      cs.steps = [...(cs.steps ?? []), ...added.map(a => a.step)];
      cs.auditAt = Date.now();
      this.saveState();
      this.bus.emit('motivation.updated', { characterId: sel.id });
      this.render(this.container);
    } catch (err) {
      console.error('[Motivation audit]', err);
      alert(`Audit failed: ${err.message}`);
    } finally {
      this._auditBusy = false;
      btn.disabled = false;
      btn.textContent = orig;
    }
  }

  _modal(inner) {
    const backdrop = document.createElement('div');
    backdrop.className = 'mot-modal-backdrop';
    backdrop.innerHTML = `<div class="mot-modal">${inner}</div>`;
    document.body.appendChild(backdrop);
    backdrop.querySelector('[data-action="cancel"]')?.addEventListener('click', () => backdrop.remove());
    backdrop.addEventListener('click', e => { if (e.target === backdrop) backdrop.remove(); });
    return backdrop;
  }
}

function labelForReward(r) {
  const prefix = r.kind === 'secret' ? 'Secret' : r.kind === 'achievement' ? 'Achievement' : r.kind === 'item' ? 'Item' : 'Bonus';
  const extra = (r.offers ?? []).length ? ` +${r.offers.length}` : '';
  return `${prefix}: ${r.title}${extra}`;
}

function salvageBeatList(text) {
  const unwrap = val => {
    if (!val) return [];
    if (Array.isArray(val)) return val.filter(x => x && typeof x === 'object');
    if (typeof val !== 'object') return [];
    for (const key of ['beats', 'steps', 'path', 'nodes', 'arc', 'cards', 'motivations']) {
      if (Array.isArray(val[key])) return unwrap(val[key]);
    }
    if (val.title || val.id) return [val];
    return [];
  };
  if (text && typeof text === 'object') return unwrap(text);
  const cleaned = String(text ?? '')
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .trim();
  if (!cleaned) return [];
  const tryParse = s => {
    try { return JSON.parse(s); } catch { /* continue */ }
    try { return JSON.parse(s.replace(/,\s*([}\]])/g, '$1')); } catch { return null; }
  };
  const direct = tryParse(cleaned);
  if (direct) {
    const got = unwrap(direct);
    if (got.length) return got;
  }

  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start >= 0 && end > start) {
    const arr = tryParse(cleaned.slice(start, end + 1));
    const got = unwrap(arr);
    if (got.length) return got;
  }
  const brace = cleaned.indexOf('{');
  const braceEnd = cleaned.lastIndexOf('}');
  if (brace >= 0 && braceEnd > brace) {
    const obj = tryParse(cleaned.slice(brace, braceEnd + 1));
    const got = unwrap(obj);
    if (got.length) return got;
  }

  const items = [];
  let depth = 0;
  let inStr = false;
  let escaped = false;
  let objStart = -1;
  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (inStr) {
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '{') {
      if (depth === 0) objStart = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && objStart >= 0) {
        const obj = tryParse(cleaned.slice(objStart, i + 1));
        if (obj && typeof obj === 'object' && !Array.isArray(obj) && (obj.title || obj.id)) items.push(obj);
        objStart = -1;
      }
    }
  }
  if (items.length) return items;
  return salvageProseBeats(cleaned);
}

function salvageProseBeats(text) {
  const items = [];
  for (const line of String(text).split(/\n+/)) {
    const t = line.trim().replace(/^[*_]+|[*_]+$/g, '');
    if (!t) continue;
    const m = t.match(/^(?:#{1,3}\s*)?(?:(?:beat|step)\s+)?(?:[-*•]|\d+[.)])\s*(.+)$/i)
      || t.match(/^(?:title|beat)\s*[:.—–-]\s*(.+)$/i);
    if (!m) continue;
    const rest = m[1].replace(/^["']|["']$/g, '').trim();
    const parts = rest.split(/\s+[—–]\s+|:\s+/);
    const title = String(parts[0] || '').slice(0, 120).trim();
    if (title.length < 2 || /^(json|beats?|here|sure|output)\b/i.test(title)) continue;
    items.push({
      id: String(items.length + 1),
      parent: items.length ? String(items.length) : null,
      branch: /fork|defy|yield|refuse|comply/i.test(rest) ? title.slice(0, 40) : '',
      title,
      description: parts.slice(1).join(': ').slice(0, 400),
      theme: '',
      rewards: [],
    });
  }
  return items.slice(0, 10);
}

function uid() {
  return crypto?.randomUUID?.() ?? ('m_' + Math.random().toString(36).slice(2, 10));
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, ch =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}
