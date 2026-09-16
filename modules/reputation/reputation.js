// Reputation — Connections (personal web) and Affiliations (guilds / companies).
import { getContext } from '../../../../../extensions.js';
import { getThumbnailUrl, generateQuietPrompt } from '../../../../../../script.js';
import { power_user } from '../../../../../power-user.js';
import { Module } from '../../lib/module.js';
import { withShowtimeProfile } from '../../lib/connectionProfile.js';
import { getStarMember, getCastMembers, priorityLabel, resolveCastPromptIdentity, formatDirectorPromptBlock, listPersonas } from '../../lib/castCatalog.js';
import {
  listPlaySecrets,
  nodeKnowsSecret,
  nodeUnawareOfSecret,
  nodeOwnsSecret,
  nodeTiedToSecret,
  interviewsVisibleOnSheet,
  characterHouseIds,
} from '../../lib/motivationCatalog.js';
import { getSceneCards, creditedScenes, sceneLabel } from '../../lib/scriptCatalog.js';

const NOTICE_CATS = [
  { id: 'group',      label: 'Affiliation', color: '#3d7a68', bg: '#d4ebe3' },
  { id: 'individual', label: 'Individual', color: '#8a4a58', bg: '#ead4d8' },
  { id: 'rumor',      label: 'Rumor',      color: '#6b4a8a', bg: '#e6d4ea' },
];
const HOUSE_SORTS = [
  { id: 'name',        label: 'Name' },
  { id: 'reputation',  label: 'Reputation' },
  { id: 'affiliation', label: 'Affiliation' },
];
const WORLD_MUL = 4;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 4;
const NOTICE_CAT_MAP = Object.fromEntries(NOTICE_CATS.map(c => [c.id, c]));

// Bad ↔ Good. `at` is the exclusive upper bound of that band (standingInfo).
const STANDING = [
  { at: -85, label: 'Infamous',      color: '#7a1f1f' },
  { at: -69, label: 'Hostile',       color: '#c42b2b' },
  { at: -54, label: 'Cold',          color: '#c45a32' },
  { at: -38, label: 'Unfriendly',    color: '#d4782c' },
  { at: -23, label: 'Uncomfortable', color: '#d49a3a' },
  { at: -8,  label: 'Wary',          color: '#c9a24a' },
  { at: 8,   label: 'Neutral',       color: '#e8c56b' },
  { at: 23,  label: 'Interested',    color: '#b8c45a' },
  { at: 38,  label: 'Comfortable',   color: '#7aab4a' },
  { at: 54,  label: 'Friendly',      color: '#4a9e52' },
  { at: 69,  label: 'Close',         color: '#3d8a68' },
  { at: 85,  label: 'Bonded',        color: '#2e7a5a' },
  { at: 101, label: 'Celebrated',    color: '#c9e86b' },
];

function standingInfo(val) {
  const n = clamp(val);
  for (const s of STANDING) {
    if (n < s.at) return s;
  }
  return STANDING[STANDING.length - 1];
}

function clamp(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(-100, Math.min(100, Math.round(v)));
}

function parseStandingTake(text) {
  const raw = String(text ?? '').trim();
  const m = raw.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      const o = JSON.parse(m[0]);
      const take = String(o.take ?? o.opinion ?? o.text ?? '').trim();
      const standing = o.standing ?? o.value ?? o.karma;
      return {
        standing: Number.isFinite(Number(standing)) ? clamp(standing) : null,
        take: take.split(/(?<=[.!?])\s+/).filter(Boolean).slice(0, 3).join(' '),
      };
    } catch { /* fall through */ }
  }
  return {
    standing: null,
    take: raw.split(/(?<=[.!?])\s+/).filter(Boolean).slice(0, 3).join(' '),
  };
}

export class ReputationModule extends Module {
  static id = 'reputation';
  static label = 'Reputation';
  static scope = 'chat';

  async init() {
    const href = new URL('./reputation.css', import.meta.url).href;
    if (!document.querySelector('link[data-showtime="reputation"]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.dataset.showtime = 'reputation';
      document.head.appendChild(link);
    }
    this._focusedHouseId = null;
    this._editingHouseId = null;
    this._houseSnap = null;
    this._dragging = null;
    this._cardMode = 'view';
    this._editSnap = null;
    this._webRo = null;
    this._webPan = null;
    this._webVw = 0;
    this._webVh = 0;
    this._hideDossier = false;
    if (!this._motivationBound) {
      this._motivationBound = true;
      this.bus.on('motivation.updated', () => {
        if (this.container) this.render(this.container);
      });
    }
  }

  getDefaultState() {
    return {
      tab: 'personal',
      inspectedId: 'self',
      focusId: 'self',
      personal: [this._selfNode()],
      house: [],
      houseSort: 'name',
      webZoom: 1,
    };
  }

  _selfNode() {
    return {
      id: 'self',
      kind: 'self',
      name: 'You',
      description: '',
      notes: '',
      standing: 0,
      category: 'individual',
      characterId: '',
      houseId: '',
      readings: [],
      x: 0.5,
      y: 0.5,
      links: [],
    };
  }

  _migrate() {
    const s = this.state;
    let changed = false;
    if (!Array.isArray(s.personal)) {
      s.personal = [this._selfNode()];
      changed = true;
    }
    if (!s.personal.some(n => n.id === 'self' || n.kind === 'self')) {
      s.personal.unshift(this._selfNode());
      changed = true;
    }
    if (Array.isArray(s.audiences) && s.audiences.length) {
      for (const a of s.audiences) {
        const id = a.id || uid();
        if (s.personal.some(n => n.id === id || n.name === a.name)) continue;
        const pos = this._orbit(s.personal.length);
        s.personal.push({
          id,
          kind: 'notice',
          category: 'group',
          characterId: '',
          houseId: '',
          readings: [],
          name: a.name || 'The Audience',
          description: '',
          notes: '',
          standing: clamp(a.value ?? 0),
          x: pos.x,
          y: pos.y,
          links: ['self'],
        });
        const self = s.personal.find(n => n.kind === 'self');
        if (self) {
          self.links ??= [];
          if (!self.links.includes(id)) self.links.push(id);
        }
      }
      delete s.audiences;
      changed = true;
    }
    if (!Array.isArray(s.house)) { s.house = []; changed = true; }
    for (const h of s.house) {
      if (this._normalizeHouse(h)) changed = true;
    }
    if (!HOUSE_SORTS.some(x => x.id === s.houseSort)) { s.houseSort = 'name'; changed = true; }
    const z = Number(s.webZoom);
    if (!Number.isFinite(z) || z < ZOOM_MIN || z > ZOOM_MAX) { s.webZoom = 1; changed = true; }
    if (s.tab !== 'house') s.tab = 'personal';
    if (!s.focusId) { s.focusId = s.selectedId || 'self'; changed = true; }
    if (!s.inspectedId) { s.inspectedId = s.selectedId || s.focusId || 'self'; changed = true; }
    for (const n of s.personal) {
      if (!NOTICE_CAT_MAP[n.category]) {
        n.category = 'individual';
        changed = true;
      }
      if (!Array.isArray(n.links)) { n.links = []; changed = true; }
      if (!Array.isArray(n.readings)) { n.readings = []; changed = true; }
      if (n.characterId == null) { n.characterId = ''; changed = true; }
      if (n.houseId == null) { n.houseId = ''; changed = true; }
      if (n.originId == null) { n.originId = ''; changed = true; }
      if (n.targetId == null) { n.targetId = ''; changed = true; }
      if (!Array.isArray(n.supporters)) { n.supporters = []; changed = true; }
      // Migrate legacy node-level intro/description/notes onto a reading toward a linked peer (prefer self).
      const legacyIntro = n.intro && n.intro !== 'none' ? String(n.intro) : '';
      const legacyDesc = String(n.description || '').trim();
      const legacyNotes = String(n.notes || '').trim();
      if (legacyIntro || legacyDesc || legacyNotes) {
        const links = Array.isArray(n.links) ? n.links : [];
        const peer = links.includes('self') ? 'self' : links[0];
        if (peer && peer !== n.id) {
          n.readings ??= [];
          let rec = n.readings.find(r => r.targetId === peer);
          if (!rec) {
            rec = { targetId: peer, aware: 'knows', take: '' };
            n.readings.push(rec);
          }
          if (legacyIntro && (!rec.intro || rec.intro === 'none')) rec.intro = legacyIntro;
          if (legacyDesc && !String(rec.description || '').trim()) rec.description = legacyDesc;
          if (legacyNotes && !String(rec.take || '').trim()) rec.take = legacyNotes;
          changed = true;
        }
        if (legacyNotes) { n.notes = ''; changed = true; }
      }
    }
    const self = s.personal.find(n => n.kind === 'self');
    if (self) {
      const star = getStarMember(this.storage);
      const ctx = getContext();
      const name = star?.name || ctx?.name1 || 'You';
      if (self.name !== name) { self.name = name; changed = true; }
      self.category = 'individual';
      if (star?.id && self.characterId !== star.id) { self.characterId = star.id; changed = true; }
    }
    if (this._syncHouseWeb()) changed = true;
    if (this._syncSecretWeb()) changed = true;
    if (changed) this.saveState();
  }

  _orbit(index) {
    const i = Math.max(0, index - 1);
    const angle = i * 2.2;
    return {
      x: 0.5 + Math.cos(angle) * 0.32,
      y: 0.5 + Math.sin(angle) * 0.30,
    };
  }

  _orbitAround(origin, i, count) {
    const n = Math.max(count, 1);
    const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
    const r = 0.17;
    return {
      x: (origin?.x ?? 0.5) + Math.cos(angle) * r,
      y: (origin?.y ?? 0.5) + Math.sin(angle) * r,
    };
  }

  _posLimit() {
    const span = WORLD_MUL / 2;
    return { min: 0.5 - span, max: 0.5 + span };
  }

  _clampPos(x, y) {
    const { min, max } = this._posLimit();
    return {
      x: Math.max(min, Math.min(max, Number(x) || 0.5)),
      y: Math.max(min, Math.min(max, Number(y) || 0.5)),
    };
  }

  _webMetrics(webEl) {
    const web = webEl || this.container?.querySelector('[data-role="web"]');
    const vw = Math.max(1, web?.clientWidth || 1);
    const vh = Math.max(1, web?.clientHeight || 1);
    return {
      vw, vh,
      ww: vw * WORLD_MUL,
      wh: vh * WORLD_MUL,
      padX: ((WORLD_MUL - 1) / 2) * vw,
      padY: ((WORLD_MUL - 1) / 2) * vh,
    };
  }

  _nodePx(n, m) {
    return {
      x: m.padX + (Number(n.x) || 0.5) * m.vw,
      y: m.padY + (Number(n.y) || 0.5) * m.vh,
    };
  }

  _homePan(m, z = this._zoomValue()) {
    return this._lockPanToFocus(m, z);
  }

  _lockPanToFocus(m, z = this._zoomValue()) {
    const focus = this._center();
    if (!m) return { x: 0, y: 0 };
    const pt = focus ? this._nodePx(focus, m) : { x: m.padX + 0.5 * m.vw, y: m.padY + 0.5 * m.vh };
    return { x: m.vw / 2 - pt.x * z, y: m.vh / 2 - pt.y * z };
  }

  _ensureLink(aId, bId) {
    if (!aId || !bId || aId === bId) return false;
    const a = this._node(aId);
    const b = this._node(bId);
    if (!a || !b) return false;
    a.links ??= [];
    b.links ??= [];
    let changed = false;
    if (!a.links.includes(bId)) { a.links.push(bId); changed = true; }
    if (!b.links.includes(aId)) { b.links.push(aId); changed = true; }
    return changed;
  }

  _houseRoster(h) {
    const roster = [];
    if (h.headId) roster.push({ characterId: h.headId, role: 'Apparent head' });
    for (const c of h.connections ?? []) {
      if (!c.characterId || roster.some(r => r.characterId === c.characterId)) continue;
      roster.push({ characterId: c.characterId, role: c.role || 'Member' });
    }
    return roster;
  }

  _tagsFor(n) {
    const tags = [];
    const seen = new Set();
    const push = (h, role) => {
      if (!h || seen.has(h.id)) return;
      seen.add(h.id);
      tags.push({
        houseId: h.id,
        label: (h.alias || h.name || 'Affiliation').slice(0, 10),
        role: role || 'Member',
      });
    };
    if (n.category === 'group' && n.houseId) {
      push(this._house(n.houseId), 'Affiliation');
      return tags;
    }
    const star = getStarMember(this.storage);
    const cid = n.characterId || (n.kind === 'self' ? star?.id : '');
    if (!cid) return tags;
    for (const h of this.state.house ?? []) {
      if (h.headId === cid) push(h, 'Apparent head');
      const conn = (h.connections ?? []).find(c => c.characterId === cid);
      if (conn) push(h, conn.role || 'Member');
    }
    return tags;
  }

  _findPersonNode(characterId) {
    if (!characterId) return null;
    const star = getStarMember(this.storage);
    const self = this._nodes().find(n => n.kind === 'self');
    if (self && (self.characterId === characterId || star?.id === characterId)) return self;
    return this._nodes().find(n => n.category === 'individual' && n.characterId === characterId) ?? null;
  }

  _playSecrets() {
    return listPlaySecrets(this.storage);
  }

  _secretCastIds() {
    const ids = new Set();
    for (const s of this._playSecrets()) {
      const tagged = [...(s.knownBy || []), ...(s.unawareBy || [])];
      if (!tagged.length) continue;
      ids.add(s.ownerId);
      for (const k of tagged) {
        if (k.type === 'cast') ids.add(k.id);
      }
    }
    return ids;
  }

  _castIdFor(n) {
    if (!n) return '';
    if (n.characterId) return n.characterId;
    if (n.kind === 'self') return getStarMember(this.storage)?.id || '';
    return '';
  }

  _nodeForKnower(k) {
    if (!k) return null;
    if (k.type === 'house') {
      return this._nodes().find(n => n.category === 'group' && n.houseId === k.id) ?? null;
    }
    return this._findPersonNode(k.id);
  }

  _ensurePersonNode(characterId) {
    if (!characterId) return { created: false };
    const existing = this._findPersonNode(characterId);
    if (existing) return { created: false, node: existing };
    const member = getCastMembers(this.storage).find(c => c.id === characterId);
    const pos = this._orbit(this._nodes().length);
    const node = {
      id: `c_${characterId}`,
      kind: 'notice',
      auto: true,
      category: 'individual',
      characterId,
      houseId: '',
      name: member?.name || 'Cast',
      description: '',
      notes: '',
      standing: 0,
      x: pos.x,
      y: pos.y,
      links: [],
      readings: [],
    };
    this.state.personal.push(node);
    return { created: true, node };
  }

  _syncSecretWeb() {
    let changed = false;
    for (const s of this._playSecrets()) {
      const tagged = [...(s.knownBy || []), ...(s.unawareBy || [])];
      if (!tagged.length) continue;
      if (this._ensurePersonNode(s.ownerId).created) changed = true;
      for (const k of tagged) {
        if (k.type === 'cast' && this._ensurePersonNode(k.id).created) changed = true;
      }
    }
    return changed;
  }

  _nodeSecretCtx(n) {
    const starId = getStarMember(this.storage)?.id || '';
    const houseIds = characterHouseIds(this.storage, this._castIdFor(n));
    return { starId, houseIds };
  }

  _secretsAboutNode(n) {
    const cid = this._castIdFor(n);
    if (!cid) return [];
    return this._playSecrets().filter(s => s.ownerId === cid);
  }

  _secretsKnownByNode(n) {
    const { starId, houseIds } = this._nodeSecretCtx(n);
    return this._playSecrets().filter(s => nodeKnowsSecret(n, s, starId, houseIds));
  }

  _secretsUnawareByNode(n) {
    const { starId, houseIds } = this._nodeSecretCtx(n);
    return this._playSecrets().filter(s => nodeUnawareOfSecret(n, s, starId, houseIds));
  }

  _secretsObserverKnowsAbout(observer, target) {
    if (!observer || !target || observer.id === target.id) return [];
    const about = this._secretsAboutNode(target);
    const { starId, houseIds } = this._nodeSecretCtx(observer);
    return about.filter(s => nodeKnowsSecret(observer, s, starId, houseIds));
  }

  _syncHouseWeb() {
    let changed = false;
    const houseIds = new Set((this.state.house ?? []).map(h => h.id));
    const self = this._nodes().find(n => n.kind === 'self');

    for (const h of this.state.house ?? []) {
      let group = this._nodes().find(n => n.category === 'group' && n.houseId === h.id);
      if (!group) {
        const pos = this._orbit(this._nodes().length);
        group = {
          id: `h_${h.id}`,
          kind: 'notice',
          auto: true,
          category: 'group',
          houseId: h.id,
          characterId: '',
          name: h.alias || h.name,
          description: h.duty || '',
          notes: '',
          standing: clamp(h.standing),
          x: pos.x,
          y: pos.y,
          links: [],
          readings: [],
        };
        this.state.personal.push(group);
        if (self) this._ensureLink(self.id, group.id);
        changed = true;
      } else if (group.auto) {
        const nm = h.alias || h.name;
        if (group.name !== nm) { group.name = nm; changed = true; }
        const st = clamp(h.standing);
        if (group.standing !== st) { group.standing = st; changed = true; }
      }

      const roster = this._houseRoster(h);
      roster.forEach((m, i) => {
        let person = this._findPersonNode(m.characterId);
        if (!person) {
          const member = getCastMembers(this.storage).find(c => c.id === m.characterId);
          const pos = this._orbitAround(group, i, roster.length);
          person = {
            id: `c_${m.characterId}`,
            kind: 'notice',
            auto: true,
            category: 'individual',
            characterId: m.characterId,
            houseId: '',
            name: member?.name || 'Cast',
            description: '',
            notes: '',
            standing: 0,
            x: pos.x,
            y: pos.y,
            links: [],
            readings: [],
          };
          this.state.personal.push(person);
          changed = true;
        } else if (person.auto && person.kind !== 'self') {
          const member = getCastMembers(this.storage).find(c => c.id === m.characterId);
          if (member?.name && person.name !== member.name) { person.name = member.name; changed = true; }
        }
        if (this._ensureLink(group.id, person.id)) changed = true;
      });
    }

    const keep = new Set();
    const secretCast = this._secretCastIds();
    for (const n of this._nodes()) keep.add(n.id);
    const next = this._nodes().filter(n => {
      if (!n.auto) return true;
      if (n.kind === 'self') return true;
      if (n.category === 'group') return houseIds.has(n.houseId);
      if (n.category === 'individual' && n.characterId) {
        return this._tagsFor(n).length > 0 || secretCast.has(n.characterId);
      }
      return true;
    });
    if (next.length !== this.state.personal.length) {
      this.state.personal = next;
      const ids = new Set(next.map(n => n.id));
      for (const n of next) {
        n.links = (n.links ?? []).filter(id => ids.has(id));
        n.readings = (n.readings ?? []).filter(r => ids.has(r.targetId));
      }
      if (this.state.focusId && !ids.has(this.state.focusId)) this.state.focusId = 'self';
      if (this.state.inspectedId && !ids.has(this.state.inspectedId)) this.state.inspectedId = this.state.focusId || 'self';
      changed = true;
    }
    return changed;
  }

  async onChatChanged() {
    this._focusedHouseId = null;
    this._editingHouseId = null;
    this._houseSnap = null;
    this._cardMode = 'view';
    this._webPan = null;
    if (this.container) await this.render(this.container);
  }

  _normalizeHouse(h) {
    if (!h || typeof h !== 'object') return false;
    let changed = false;
    const set = (key, fallback) => {
      if (h[key] == null) { h[key] = fallback; changed = true; }
    };
    set('name', 'Unnamed Affiliation');
    set('alias', '');
    set('badge', '');
    set('badgeSide', h.badgeSide === 'right' ? 'right' : 'left');
    if (h.badgeSide !== 'left' && h.badgeSide !== 'right') { h.badgeSide = 'left'; changed = true; }
    set('authority', '');
    set('headId', '');
    set('duty', '');
    if (!Array.isArray(h.connections)) { h.connections = []; changed = true; }
    else {
      h.connections = h.connections.map(c => ({
        characterId: c.characterId || c.id || '',
        role: c.role || c.affiliation || '',
      })).filter(c => c.characterId);
    }
    if (h.standing == null) { h.standing = 0; changed = true; }
    set('notes', '');
    set('dress', 'gradient');
    if (!['solid', 'gradient', 'banner'].includes(h.dress)) { h.dress = 'gradient'; changed = true; }
    set('colorA', '#c9a24a');
    set('colorB', '#6b4f1e');
    set('banner', '');
    set('opinion', '');
    if (!h.duty && h.description) { h.duty = h.description; changed = true; }
    return changed;
  }

  async render(container) {
    this.container = container;
    this._migrate();
    const tab = this.state.tab === 'house' ? 'house' : 'personal';
    container.innerHTML = `
      <div class="rep-root">
        <div class="rep-tabs">
          <button type="button" class="rep-tab${tab === 'personal' ? ' on' : ''}" data-tab="personal">Connections</button>
          <button type="button" class="rep-tab${tab === 'house' ? ' on' : ''}" data-tab="house">Affiliations</button>
        </div>
        ${tab === 'personal' ? this._renderPersonal() : this._renderHouse()}
      </div>
    `;
    container.querySelectorAll('.rep-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        this.state.tab = btn.dataset.tab;
        this.saveState();
        this.render(this.container);
      });
    });
    if (tab === 'personal') this._bindPersonal(container);
    else this._bindHouse(container);
  }

  _nodes() {
    return this.state.personal ?? [];
  }

  _node(id) {
    return this._nodes().find(n => n.id === id) ?? null;
  }

  _house(id) {
    if (!id) return null;
    return (this.state.house ?? []).find(h => h.id === id) ?? null;
  }

  _castChar(id) {
    if (!id) return null;
    return (this.storage.getChat('cast', { characters: [] }).characters ?? []).find(c => c.id === id) ?? null;
  }

  _castPortrait(id) {
    if (!id) return '';
    const c = this._castChar(id);
    if (!c) {
      const m = getCastMembers(this.storage).find(x => x.id === id);
      return m?.portrait || '';
    }
    if (c.portrait) return c.portrait;
    if (c.characterCardId) return `/thumbnail?type=avatar&file=${encodeURIComponent(c.characterCardId)}`;
    if (c.personaId) {
      try { return getThumbnailUrl('persona', c.personaId) || ''; }
      catch { return ''; }
    }
    return '';
  }

  _portraitFor(node) {
    if (!node) return '';
    if (node.category === 'group' && node.houseId) {
      const house = this._house(node.houseId);
      if (house?.badge) return house.badge;
    }
    const id = node.characterId || (node.kind === 'self' ? getStarMember(this.storage)?.id : '');
    return this._castPortrait(id);
  }

  _bubbleLabel(n) {
    if (n.category === 'group' && n.houseId) {
      const house = this._house(n.houseId);
      if (house?.alias) return house.alias;
      if (house?.name) return house.name;
    }
    return n.name || '?';
  }

  _canAudit() {
    const n = this._node(this.state.focusId);
    if (!n || this.state.focusId !== n.id) return false;
    if (n.kind === 'self') return true;
    return n.category === 'individual';
  }

  _bubblesByType(excludeId) {
    const groups = { group: [], individual: [], rumor: [] };
    for (const n of this._nodes()) {
      if (n.id === excludeId) continue;
      const cat = NOTICE_CAT_MAP[n.category] ? n.category : 'individual';
      (groups[cat] ??= []).push(n);
    }
    return groups;
  }

  _optgroupsHTML(excludeId, selectedId) {
    const groups = this._bubblesByType(excludeId);
    const blocks = [
      ['group', 'Affiliation'],
      ['individual', 'Individual'],
      ['rumor', 'Rumor'],
    ];
    return blocks.map(([id, label]) => {
      const list = groups[id] ?? [];
      if (!list.length) return '';
      return `<optgroup label="${esc(label)}">${list.map(n =>
        `<option value="${n.id}" ${n.id === selectedId ? 'selected' : ''}>${esc(n.name || label)}</option>`,
      ).join('')}</optgroup>`;
    }).join('');
  }

  _scriptCards() {
    try {
      return this.storage.getChat('script', { cards: [] }).cards ?? [];
    } catch {
      return [];
    }
  }

  _creditedScenes(characterId, name) {
    const id = characterId || '';
    const nm = (name || '').trim().toLowerCase();
    return this._scriptCards().filter(c => {
      if (c.active === false) return false;
      return (c.credits ?? []).some(cr =>
        (id && cr.characterId === id) || (nm && String(cr.name || '').trim().toLowerCase() === nm),
      );
    }).slice(-8);
  }

  _castPromptBlock(node) {
    const ctx = getContext();
    const cid = node.characterId || (node.kind === 'self' ? getStarMember(this.storage)?.id : '');
    const char = cid ? this._castChar(cid) : null;
    if (!char) return `Character: ${node.name}`;
    const identity = resolveCastPromptIdentity(char, this.storage, {
      characters: ctx.characters ?? [],
      personas: listPersonas(power_user),
    });
    return `${identity.block}\n\nDIRECTOR DIALS:\n${formatDirectorPromptBlock(this.storage, { includeHooks: false })}`;
  }

  _recentScene(node) {
    const ctx = getContext();
    const all = ctx.chat ?? [];
    const cid = node.characterId || (node.kind === 'self' ? getStarMember(this.storage)?.id : '');
    const char = cid ? this._castChar(cid) : null;
    const charName = (char?.name || node.name || '').trim().toLowerCase();
    if (node.kind === 'self' || char?.priority === 'star') {
      const byUser = all.filter(m => m.is_user);
      const source = byUser.length >= 2 ? byUser.slice(-12) : all.slice(-8);
      return source.map(m => `${m.name}: ${m.mes}`).join('\n').slice(-3000);
    }
    if (!charName) return all.slice(-8).map(m => `${m.name}: ${m.mes}`).join('\n').slice(-3000);
    const byChar = all.filter(m => (m.name ?? '').trim().toLowerCase() === charName);
    const mentioning = all.filter(m =>
      (m.name ?? '').trim().toLowerCase() !== charName &&
      (m.mes ?? '').toLowerCase().includes(charName));
    const relevant = [...byChar.slice(-10), ...mentioning.slice(-6)]
      .filter((v, i, a) => a.indexOf(v) === i)
      .sort((a, b) => all.indexOf(a) - all.indexOf(b));
    const source = relevant.length >= 2 ? relevant : all.slice(-8);
    return source.map(m => `${m.name}: ${m.mes}`).join('\n').slice(-3000);
  }

  _center() {
    return this._node(this.state.focusId) || this._node('self');
  }

  _isStarNode(n) {
    if (!n) return false;
    if (n.kind === 'self') return true;
    const star = getStarMember(this.storage);
    return !!(star && n.characterId && n.characterId === star.id);
  }

  _readingToward(observer, targetId) {
    if (!observer || !targetId) return null;
    return (observer.readings ?? []).find(r => r.targetId === targetId) ?? null;
  }

  _effectiveReadingToward(observer, targetId) {
    // Rumors are circulating takes — they don't hold opinions of their own.
    if (!observer || !targetId || observer.id === targetId) return null;
    if (observer.category === 'rumor') return null;

    const rec = this._readingToward(observer, targetId);
    const target = this._node(targetId);
    const secrets = this._secretsObserverKnowsAbout(observer, target);
    const rumorFeed = this._rumorsHeardBy(observer, targetId);
    const rumorBits = rumorFeed.map(r => this._rumorText(r)).filter(Boolean);

    const mergeRumor = (base) => {
      if (!rumorFeed.length) return base;
      const takeParts = [base?.take, ...rumorBits].map(t => String(t || '').trim()).filter(Boolean);
      const rumors = rumorFeed.map(r => ({
        id: r.id,
        name: r.name || 'Rumor',
        text: this._rumorText(r),
      }));
      if (!base && !takeParts.length && !secrets.length) {
        return {
          targetId,
          aware: 'knows',
          take: '',
          standing: undefined,
          source: 'rumor',
          secrets: [],
          rumors,
        };
      }
      return {
        targetId,
        aware: base?.aware === 'unaware' && (secrets.length || rumorFeed.length)
          ? 'knows'
          : (base?.aware || 'knows'),
        take: takeParts.join('\n'),
        standing: base?.standing,
        intro: base?.intro,
        description: base?.description,
        source: base
          ? (rumorFeed.length ? `${base.source || 'reading'}+rumor` : (base.source || 'reading'))
          : (secrets.length ? 'secret+rumor' : 'rumor'),
        secrets: base?.secrets || secrets,
        rumors,
      };
    };

    if (observer?.category === 'group' && observer.houseId && this._isStarNode(target)) {
      const house = this._house(observer.houseId);
      if (house) {
        const standing = clamp(house.standing);
        const take = house.opinion || rec?.take || '';
        if (!rec && !take && standing === 0 && !secrets.length && !rumorFeed.length) return rec;
        return mergeRumor({
          targetId,
          aware: rec?.aware === 'unaware' && secrets.length ? 'knows' : (rec?.aware || 'knows'),
          take,
          standing,
          intro: rec?.intro,
          description: rec?.description,
          source: secrets.length ? 'secret' : 'house',
          secrets,
        });
      }
    }
    if (secrets.length) {
      return mergeRumor({
        targetId,
        aware: rec?.aware === 'unaware' ? 'knows' : (rec?.aware || 'knows'),
        take: rec?.take || '',
        standing: rec?.standing,
        intro: rec?.intro,
        description: rec?.description,
        source: rec ? rec.source || 'reading' : 'secret',
        secrets,
      });
    }
    if (rumorFeed.length) return mergeRumor(rec || null);
    return rec;
  }

  /** Text body of a rumor bubble (description, else name). */
  _rumorText(rumor) {
    if (!rumor) return '';
    return String(rumor.description || '').trim() || String(rumor.name || '').trim();
  }

  /** Whether this bubble is on the rumor’s circulation thread. */
  _hearsRumor(observer, rumor) {
    if (!observer || !rumor || rumor.category !== 'rumor') return false;
    if (observer.id === rumor.id) return false;
    if ((observer.links || []).includes(rumor.id) || (rumor.links || []).includes(observer.id)) return true;
    if (rumor.originId && rumor.originId === observer.id) return true;
    if (rumor.targetId && rumor.targetId === observer.id) return false; // subject, not hearer
    const cid = this._castIdFor(observer);
    if (cid && (rumor.supporters || []).some(s => s.characterId === cid)) return true;
    return false;
  }

  /** Rumors about `targetId` that `observer` is connected to. */
  _rumorsHeardBy(observer, targetId) {
    if (!observer || !targetId) return [];
    return this._nodes().filter(n =>
      n.category === 'rumor'
      && n.targetId === targetId
      && this._hearsRumor(observer, n));
  }

  _inboundOpinions(targetId) {
    if (!targetId) return [];
    const target = this._node(targetId);
    // Rumors aren't "thought about" — they are the thought.
    if (target?.category === 'rumor') return [];
    const rows = [];
    for (const src of this._nodes()) {
      if (src.id === targetId) continue;
      if (src.category === 'rumor') continue;
      const rec = this._effectiveReadingToward(src, targetId);
      if (!rec) continue;
      if (!String(rec.take || '').trim() && rec.standing == null && !rec.rumors?.length && !rec.secrets?.length) continue;
      rows.push({ src, r: rec });
    }
    return rows;
  }

  _upsertReading(from, targetId, { take, aware, standing, intro, description } = {}) {
    if (!from || !targetId || from.id === targetId) return null;
    if (from.category === 'rumor') return null;
    const to = this._node(targetId);
    if (to?.category === 'rumor') return null;
    from.readings ??= [];
    let rec = from.readings.find(r => r.targetId === targetId);
    if (!rec) {
      rec = { targetId, aware: aware || 'knows', take: take || '' };
      from.readings.push(rec);
    } else {
      if (aware) rec.aware = aware;
      if (take != null) rec.take = take;
    }
    if (standing != null && Number.isFinite(Number(standing))) rec.standing = clamp(standing);
    if (intro != null) rec.intro = String(intro || 'none');
    if (description != null) rec.description = String(description || '').trim();
    this._ensureLink(from.id, targetId);
    return rec;
  }

  /** Filed relationship fields between `n` and the centered bubble (from n's reading of center). */
  _relationWithCenter(n) {
    const center = this._center();
    if (!n || !center || n.id === center.id) return null;
    const rec = this._readingToward(n, center.id);
    let intro = rec?.intro;
    // Legacy: node.intro was star-relative — only fall back when center is the Star.
    if ((!intro || intro === 'none') && (center.id === 'self' || this._isStarNode(center))) {
      intro = n.intro;
    }
    return {
      center,
      rec,
      intro: intro || 'none',
      description: String(rec?.description || '').trim(),
    };
  }

  _applyTowardStanding(node, value, el) {
    if (node?.category === 'rumor') return;
    const v = clamp(value);
    const info = standingInfo(v);
    const lab = el?.querySelector('[data-role="stand-label"]');
    if (lab) {
      lab.textContent = `${info.label} · ${v}`;
      lab.style.color = info.color;
    }
    const center = this._center();
    if (!center || !node || node.id === center.id) return;
    this._upsertReading(node, center.id, { standing: v, aware: 'knows' });
    if (node.category === 'group' && node.houseId && this._isStarNode(center)) {
      const house = this._house(node.houseId);
      if (house) house.standing = v;
    }
    this.saveState();
    this.bus.emit('reputation.updated', { node });
    this._sizeWeb();
  }

  /** Centered bubble’s reading of the inspected/selected bubble. */
  _applyFromCenterStanding(node, value, el) {
    if (node?.category === 'rumor') return;
    const v = clamp(value);
    const info = standingInfo(v);
    const lab = el?.querySelector('[data-role="from-center-stand-label"]');
    if (lab) {
      lab.textContent = `${info.label} · ${v}`;
      lab.style.color = info.color;
    }
    const center = this._center();
    if (!center || !node || node.id === center.id) return;
    this._upsertReading(center, node.id, { standing: v, aware: 'knows' });
    if (center.category === 'group' && center.houseId && this._isStarNode(node)) {
      const house = this._house(center.houseId);
      if (house) house.standing = v;
    }
    this.saveState();
    this.bus.emit('reputation.updated', { node: center });
    this._sizeWeb();
  }

  _opinionTowardCenter(n) {
    const center = this._center();
    if (!n || !center) return null;
    if (n.id === center.id) return { self: true, center };
    const rec = this._effectiveReadingToward(n, center.id);
    if (!rec) return { center, empty: true };
    return {
      center,
      standing: rec.standing != null ? clamp(rec.standing) : 0,
      take: rec.take || '',
      aware: rec.aware || 'heard',
      source: rec.source || 'reading',
    };
  }

  _secretChipsHTML(secrets, label, { subject = null } = {}) {
    if (!secrets?.length) return '';
    const { starId, houseIds } = this._nodeSecretCtx(subject);
    return `
      <div class="rep-secrets">
        <div class="rep-dos-k">${esc(label)}</div>
        ${secrets.map(s => {
          const blind = subject && nodeUnawareOfSecret(subject, s, starId, houseIds);
          const who = blind
            ? 'in the dark'
            : (s.knownBy.map(k => this._knowerName(k)).filter(Boolean).join(' · ') || (s.ownerName ? 'owner' : 'Unknown'));
          return `<span class="rep-secret-chip${blind ? ' blind' : ''}" title="${esc(s.description || s.title)}">${esc(s.title)}${s.ownerName && label !== 'Their secrets' ? ` · ${esc(s.ownerName)}` : ''} — ${esc(who)}</span>`;
        }).join('')}
      </div>`;
  }

  _knowerName(k) {
    if (!k) return '';
    if (k.type === 'house') {
      const h = this._house(k.id);
      return h ? (h.alias || h.name) : 'Affiliation';
    }
    const m = getCastMembers(this.storage).find(c => c.id === k.id);
    return m?.name || 'Cast';
  }

  /** A secret only surfaces as a knowledge chip if this bubble is explicitly tagged. */
  _secretsOnCard(n) {
    const { starId, houseIds } = this._nodeSecretCtx(n);
    return this._playSecrets().filter(s => nodeTiedToSecret(n, s, starId, houseIds));
  }

  _interviewsForNode(n) {
    if (!n || n.category === 'group' || n.category === 'rumor') return [];
    const castId = n?.characterId || this._castIdFor?.(n) || '';
    if (!castId) return [];
    try {
      const starId = getStarMember(this.storage)?.id || '';
      const isStar = n.kind === 'self' || castId === starId;
      return interviewsVisibleOnSheet(this.storage, castId, { isStar });
    } catch {
      return [];
    }
  }

  _interviewsBlockHTML(n) {
    const list = this._interviewsForNode(n);
    if (!list.length) return '';
    return `
      <div class="rep-secrets rep-interviews">
        <div class="rep-dos-k">Interviews</div>
        ${list.slice(0, 6).map(s => {
          const turns = s.turns || [];
          const when = (() => {
            try {
              return new Date(s.at || s.startedAt || Date.now()).toLocaleDateString(undefined, {
                month: 'short', day: 'numeric',
              });
            } catch { return '—'; }
          })();
          const peek = turns.find(t => t.who === 'cast' && t.text)?.text || '';
          const title = s.asInterviewer
            ? `${when} · ${s.subjectName || 'Subject'} · ${turns.length} turns`
            : `${when} · ${s.interviewer || 'Interviewer'} · ${turns.length} turns`;
          return `<span class="rep-secret-chip" title="${esc(peek.slice(0, 240))}">${esc(title)}</span>`;
        }).join('')}
      </div>`;
  }

  /** True when this notice has an introduction relative to the centered bubble. */
  _hasIntro(n) {
    return this._introInfo(n).kind !== 'none';
  }

  /** How this notice entered the story *with the centered bubble* (or a given peer). */
  _introInfo(n, towardId = null) {
    const center = towardId ? this._node(towardId) : this._center();
    const tid = towardId || center?.id || '';
    const peerName = center?.name || 'them';
    let raw = 'none';
    if (n && tid && n.id !== tid) {
      const rec = this._readingToward(n, tid);
      raw = String(rec?.intro || 'none');
      // Legacy: node.intro was star-relative.
      if (raw === 'none' && (tid === 'self' || this._isStarNode(center))) {
        raw = String(n.intro || 'none');
      }
    }
    if (raw === 'pre') {
      return { kind: 'pre', label: `Pre-established with ${peerName}`, raw };
    }
    if (raw.startsWith('scene:')) {
      const uid = raw.slice(6);
      const label = sceneLabel(this.storage, uid);
      if (label) {
        return { kind: 'scene', uid, label: `Introduced to ${peerName} in ${label}`, raw };
      }
    }
    return { kind: 'none', label: '', raw: 'none' };
  }

  _introOptionsHTML(n, towardId = null) {
    const cur = this._introInfo(n, towardId).raw || 'none';
    const cid = n.characterId || (n.kind === 'self' ? getStarMember(this.storage)?.id || '' : '');
    const credited = creditedScenes(this.storage, cid, n.name);
    const creditedIds = new Set(credited.map(s => s.uid));
    const others = getSceneCards(this.storage).filter(s => !creditedIds.has(s.uid));
    const opt = s => `<option value="scene:${esc(s.uid)}" ${cur === `scene:${s.uid}` ? 'selected' : ''}>${esc(s.code ? `${s.code} · ${s.title}` : s.title)}</option>`;
    return `
      <option value="none" ${cur === 'none' ? 'selected' : ''}>— None —</option>
      <option value="pre" ${cur === 'pre' ? 'selected' : ''}>Pre-established · beyond this story</option>
      ${credited.length ? `<optgroup label="Credited scenes">${credited.map(opt).join('')}</optgroup>` : ''}
      ${others.length ? `<optgroup label="Other scenes">${others.map(opt).join('')}</optgroup>` : ''}`;
  }

  /** Centered/focused cast may only see a secret if they are tagged as knowing it. */
  _centerKnowsSecret(secret) {
    const center = this._center();
    if (!center || !secret) return false;
    const { starId, houseIds } = this._nodeSecretCtx(center);
    return nodeKnowsSecret(center, secret, starId, houseIds);
  }

  /** @deprecated use _centerKnowsSecret — kept name for call sites during tighten */
  _centerInvolvedInSecret(secret) {
    return this._centerKnowsSecret(secret);
  }

  _secretsBlockHTML(n) {
    const center = this._center();
    const starId = getStarMember(this.storage)?.id || '';
    const viewingOther = !!(center && n.id !== center.id);
    const centerOwns = s => nodeOwnsSecret(center, s, starId);

    // Secrets this bubble owns. Owner may see their own without a knowledge tag.
    // Third parties looking in only see them if they are explicitly tagged as knowing.
    let held = this._secretsAboutNode(n);
    if (viewingOther) {
      held = held.filter(s => this._centerKnowsSecret(s));
    }

    // Secrets this bubble knows about others — never leak to a center who is untagged.
    let known = this._secretsKnownByNode(n).filter(s => s.ownerId !== this._castIdFor(n));
    if (viewingOther) {
      known = known.filter(s => this._centerKnowsSecret(s) || centerOwns(s));
    }

    // Explicit "in the dark" only — never implied for untagged parties.
    let dark = this._secretsUnawareByNode(n);
    if (viewingOther) {
      dark = dark.filter(s => this._centerKnowsSecret(s) || centerOwns(s));
    }

    if (!held.length && !known.length && !dark.length) return '';
    return `
      ${held.length ? this._secretChipsHTML(held, 'Their secrets', { subject: n }) : ''}
      ${known.length ? this._secretChipsHTML(known, viewingOther ? 'Also knows (shared)' : 'Knows about others') : ''}
      ${dark.length ? this._secretChipsHTML(dark, 'In the dark', { subject: n }) : ''}`;
  }

  _thinksLabel(fromName, toName) {
    return `What ${fromName || 'this bubble'} thinks of ${toName || 'the center'}`;
  }

  _opinionCardHTML(n) {
    if (n.category === 'rumor') return '';
    const op = this._opinionTowardCenter(n);
    if (!op) return '';
    if (op.self) {
      const incoming = this._inboundOpinions(n.id);
      return `
        <div class="rep-opinion">
          <div class="rep-dos-k">Centered</div>
          <div class="rep-card-muted">Other bubbles show their opinion of ${esc(n.name)}.</div>
          ${incoming.length ? `
            <div class="rep-incoming">${incoming.map(({ src, r }) =>
              `<span class="rep-in-chip">${esc(src.name)}${r.take ? ` — ${esc(r.take)}` : ''}${r.rumors?.length ? ` · ${r.rumors.length} rumor${r.rumors.length === 1 ? '' : 's'}` : ''}</span>`).join('')}</div>` : ''}
        </div>`;
    }
    const info = op.standing != null ? standingInfo(op.standing) : null;
    const reverse = this._effectiveReadingToward(op.center, n.id);
    const revStand = reverse?.standing != null ? clamp(reverse.standing) : 0;
    const revInfo = reverse?.standing != null ? standingInfo(revStand) : null;
    const showFromCenter = this._hasIntro(n);
    const towardFull = this._effectiveReadingToward(n, op.center.id);
    const rumorChips = towardFull?.rumors?.length
      ? `<div class="rep-rumor-feed">${towardFull.rumors.map(r =>
          `<span class="rep-in-chip" title="${esc(r.text || '')}">⌘ ${esc(r.name)}${r.text ? ` — ${esc(r.text.slice(0, 80))}` : ''}</span>`).join('')}</div>`
      : '';
    return `
      <div class="rep-opinion">
        <div class="rep-dos-k">${esc(this._thinksLabel(n.name, op.center.name))}</div>
        ${info ? `<span class="rep-card-badge" style="color:${info.color};border-color:${info.color}">${info.label}${op.standing != null ? ` · ${op.standing}` : ''}</span>` : ''}
        ${op.take ? `<div class="rep-card-peek">${esc(op.take)}</div>` : `<div class="rep-card-muted">No reading of ${esc(op.center.name)} yet.</div>`}
        ${rumorChips}
        ${this._secretChipsHTML(this._secretsObserverKnowsAbout(n, op.center), 'Holds on them')}
        ${showFromCenter ? `
        <div class="rep-opinion-reverse">
          <div class="rep-dos-k">${esc(this._thinksLabel(op.center.name, n.name))}</div>
          ${revInfo
            ? `<span class="rep-card-badge" style="color:${revInfo.color};border-color:${revInfo.color}">${esc(revInfo.label)}${reverse?.standing != null ? ` · ${revStand}` : ''}</span>`
            : `<div class="rep-card-muted">No reading of ${esc(n.name)} yet — set it in Edit.</div>`}
          ${reverse?.take ? `<div class="rep-card-peek">${esc(reverse.take)}</div>` : ''}
        </div>` : `
        <div class="rep-card-muted">Set Introduction (pre-established or a scene) before filing what ${esc(op.center.name)} thinks of ${esc(n.name)}.</div>`}
      </div>
    `;
  }

  _renderPersonal() {
    const nodes = this._nodes();
    const bubbles = nodes.map(n => this._bubbleHTML(n)).join('');
    const inspected = this._node(this.state.inspectedId) || this._node(this.state.focusId) || nodes[0];
    const hideCard = !!this._hideDossier;
    return `
      <div class="rep-personal${hideCard ? ' cards-hid' : ''}">
        <div class="rep-toolbar">
          <div class="rep-kicker">Meters &amp; rings: each bubble’s standing toward the Star · Affiliations track house opinion of the Star</div>
          <button type="button" class="rep-btn" data-action="toggle-dossier" title="${hideCard ? 'Show detail cards' : 'Hide detail cards to focus the web'}">${hideCard ? 'Show details' : 'Hide details'}</button>
          <button type="button" class="rep-audit" data-action="audit" ${this._canAudit() ? '' : 'hidden'}>Audit</button>
          <button type="button" class="rep-btn" data-action="add-notice">+ Connection</button>
        </div>
        <div class="rep-web" data-role="web">
          <div class="rep-web-world" data-role="web-world">
            <svg class="rep-web-svg" data-role="web-svg"></svg>
            ${bubbles}
          </div>
          <div class="rep-zoom">
            <button type="button" class="rep-zoom-btn" data-zoom="out" title="Zoom out">−</button>
            <span class="rep-zoom-label" data-role="zoom-label">${Math.round((this.state.webZoom || 1) * 100)}%</span>
            <button type="button" class="rep-zoom-btn" data-zoom="in" title="Zoom in">+</button>
            <button type="button" class="rep-zoom-btn" data-zoom="reset" title="Reset">⌂</button>
          </div>
        </div>
        <div class="rep-dossier" data-role="dossier" ${hideCard ? 'hidden' : ''}>
          ${inspected ? this._renderDossier(inspected) : `<div class="rep-dossier-empty">Select a notice in the web.</div>`}
        </div>
      </div>
    `;
  }

  _opinionStanding(observer, targetId) {
    if (!observer || !targetId || observer.id === targetId) return null;
    if (observer.category === 'rumor') return null;
    const rec = this._effectiveReadingToward(observer, targetId);
    if (!rec || rec.standing == null) return null;
    const standing = clamp(rec.standing);
    const info = standingInfo(standing);
    return { standing, color: info.color, label: info.label, rec };
  }

  /** Star stand-in on the web (self node, or character-linked Star). */
  _starTargetId() {
    const self = this._node('self');
    if (self) return self.id;
    const star = getStarMember(this.storage);
    if (!star?.id) return '';
    const hit = this._nodes().find(n => n.characterId && n.characterId === star.id);
    return hit?.id || '';
  }

  _standTowardStar(n) {
    const starId = this._starTargetId();
    if (!n || !starId) return { kind: 'empty' };
    if (n.id === starId || this._isStarNode(n)) {
      return { kind: 'center', label: 'Star', color: '#c9a24a' };
    }
    const op = this._opinionStanding(n, starId);
    if (!op) return { kind: 'empty' };
    return {
      kind: 'read',
      standing: op.standing,
      color: op.color,
      label: op.label,
      deg: ((op.standing + 100) / 200) * 360,
    };
  }

  _meterHTML(n) {
    const st = this._standTowardStar(n);
    if (st.kind !== 'read') return '';
    const title = `Toward Star · ${st.label} · ${st.standing}`;
    return `<span class="rep-meter" style="--stand-color:${st.color};--stand-deg:${st.deg}deg" title="${esc(title)}"></span>`;
  }

  /** Border ring: standing toward Star for cast / house bubbles; gold for Star / focus. */
  _bubbleBorderColor(n) {
    if (!n) return 'var(--st-gold-dim)';
    if (this.state.focusId === n.id || this.state.inspectedId === n.id || this._isStarNode(n) || n.kind === 'self') {
      return 'var(--st-gold)';
    }
    const st = this._standTowardStar(n);
    if (st.kind === 'read') return st.color;
    const cat = NOTICE_CAT_MAP[n.category] ?? NOTICE_CAT_MAP.individual;
    return cat.color;
  }

  _standingBarHTML(value, { fromName, toName, field = 'toward-standing', hint = '' } = {}) {
    const v = clamp(value);
    const info = standingInfo(v);
    const labelRole = field === 'from-center-standing' ? 'from-center-stand-label' : 'stand-label';
    return `
      <div class="rep-field">
        <label>${esc(this._thinksLabel(fromName, toName))}</label>
        <div class="rep-stand-stack">
          <input type="range" min="-100" max="100" step="1" data-field="${esc(field)}" value="${v}">
          <span class="rep-stand-label" data-role="${esc(labelRole)}" style="color:${info.color}">${esc(info.label)} · ${v}</span>
        </div>
        <div class="rep-hint">${esc(hint || 'Standing toward the Star colors that bubble’s ring on the web.')}</div>
      </div>`;
  }

  _standingDraftHTML(value = 0) {
    const v = clamp(value);
    const info = standingInfo(v);
    return `
      <div class="rep-stand-stack">
        <input type="range" min="-100" max="100" step="1" data-draft="reading-standing" value="${v}">
        <span class="rep-stand-label" data-role="draft-stand-label" style="color:${info.color}">${esc(info.label)} · ${v}</span>
      </div>
      <div class="rep-hint">Infamous → Celebrated</div>`;
  }

  _opinionArrowHTML(from, to, sidePx, m) {
    const op = this._opinionStanding(from, to.id);
    if (!op) return '';
    const focusId = this.state.focusId;
    const bubbleR = id => (id === focusId ? 36 : 30);
    const trim = (bubbleR(from.id) + bubbleR(to.id)) / 2;
    const a = this._nodePx(from, m);
    const b = this._nodePx(to, m);
    const g = this._edgeGeomPx(a.x, a.y, b.x, b.y, sidePx, trim);
    const hot = from.id === focusId || to.id === focusId;
    return `<line class="reading karma${hot ? '' : ' dim'}" x1="${g.x1}" y1="${g.y1}" x2="${g.x2}" y2="${g.y2}" stroke="${op.color}"/>`
      + this._arrowPoly(g.x1, g.y1, g.x2, g.y2, hot, op.color);
  }

  _bubbleClass(n) {
    const cat = NOTICE_CAT_MAP[n.category] ?? NOTICE_CAT_MAP.individual;
    const bits = ['rep-bubble', `cat-${cat.id}`];
    if (this.state.inspectedId === n.id) bits.push('inspect');
    if (this.state.focusId === n.id) bits.push('focus');
    if (n.kind === 'self') bits.push('self');
    if (this._portraitFor(n)) bits.push('has-face');
    // Grey out anyone not directly threaded to the centered bubble.
    const focusId = this.state.focusId;
    if (n.id !== focusId && !this._linkedTo(focusId, n.id)) bits.push('muted');
    return bits.join(' ');
  }

  _bubbleHTML(n) {
    const cat = NOTICE_CAT_MAP[n.category] ?? NOTICE_CAT_MAP.individual;
    const border = this._bubbleBorderColor(n);
    const bg = n.kind === 'self' || this._portraitFor(n) ? '' : `background:${cat.bg};`;
    const face = this._portraitFor(n);
    const tags = this._tagsFor(n);
    const tagTitle = tags.map(t => `${t.label}${t.role ? ` — ${t.role}` : ''}`).join('\n');
    return `
      <button type="button" class="${this._bubbleClass(n)}" data-id="${n.id}"
        style="left:0;top:0;border-color:${border};${bg}"
        title="${esc((n.name || 'Notice') + (tagTitle ? `\n${tagTitle}` : ''))}">
        ${this._meterHTML(n)}
        <span class="rep-bubble-disk">
          ${face ? `<img class="rep-bubble-face" src="${esc(face)}" alt="">` : ''}
          <span class="rep-bubble-name">${esc(this._bubbleLabel(n).slice(0, 18))}</span>
        </span>
        ${tags.length ? `<span class="rep-affils">${tags.map(t =>
          `<span class="rep-affil" title="${esc(`${t.label} — ${t.role}`)}">${esc(t.label)}</span>`).join('')}</span>` : ''}
      </button>`;
  }

  _svgLines(m) {
    if (!m?.ww || !m?.wh) return '';
    const nodes = this._nodes();
    const focusId = this.state.focusId;
    const lines = [];
    const seen = new Set();
    const bubbleR = id => (id === focusId ? 36 : 30);
    const px = n => this._nodePx(n, m);
    for (const n of nodes) {
      for (const toId of n.links ?? []) {
        const key = [n.id, toId].sort().join(':');
        if (seen.has(key)) continue;
        seen.add(key);
        const to = this._node(toId);
        if (!to) continue;
        const trim = (bubbleR(n.id) + bubbleR(to.id)) / 2;
        const a = px(n);
        const b = px(to);
        const g = this._edgeGeomPx(a.x, a.y, b.x, b.y, 3, trim);
        const hot = n.id === focusId || to.id === focusId;
        // Color the thread with the same standing palette as the rings when tied to focus.
        let stroke = hot ? '#ffe066' : '#c9a24a';
        if (hot && focusId) {
          const outer = n.id === focusId ? to : n;
          const op = this._opinionStanding(outer, focusId);
          if (op?.color) stroke = op.color;
        }
        lines.push(`<line class="thread${hot ? '' : ' dim'}" x1="${g.x1}" y1="${g.y1}" x2="${g.x2}" y2="${g.y2}" stroke="${stroke}"/>`);
      }
    }
    for (const n of nodes) {
      if (n.id === focusId) continue;
      if (!this._linkedTo(focusId, n.id)) continue;
      if (n.category === 'rumor') continue;
      const to = this._node(focusId);
      if (!to || to.category === 'rumor') continue;
      // Single undirected thread already drawn above; opinion arrows are for mutual takes.
      lines.push(this._opinionArrowHTML(n, to, -8, m));
      lines.push(this._opinionArrowHTML(to, n, 8, m));
    }
    const secretSeen = new Set();
    const center = this._center();
    const { starId, houseIds } = this._nodeSecretCtx(center);
    const centerCastId = center ? this._castIdFor(center) : '';
    for (const s of this._playSecrets()) {
      const tagged = [...(s.knownBy || []), ...(s.unawareBy || [])];
      if (!tagged.length) continue;
      // Web secret threads stay hidden unless the focused cast owns, knows, or is tagged in the dark.
      if (center && centerCastId !== s.ownerId && !nodeTiedToSecret(center, s, starId, houseIds)) continue;
      const owner = this._findPersonNode(s.ownerId);
      if (!owner) continue;
      for (const k of tagged) {
        const knower = this._nodeForKnower(k);
        if (!knower || knower.id === owner.id) continue;
        const key = [owner.id, knower.id].sort().join(':');
        if (secretSeen.has(key)) continue;
        secretSeen.add(key);
        const trim = (bubbleR(owner.id) + bubbleR(knower.id)) / 2;
        const a = px(knower);
        const b = px(owner);
        const g = this._edgeGeomPx(a.x, a.y, b.x, b.y, 7, trim);
        const hot = owner.id === focusId || knower.id === focusId;
        const knowerHouses = this._nodeSecretCtx(knower).houseIds;
        const blind = nodeUnawareOfSecret(knower, s, starId, knowerHouses) && !nodeKnowsSecret(knower, s, starId, knowerHouses);
        lines.push(`<line class="secret${blind ? ' blind' : ''}${hot ? '' : ' dim'}" x1="${g.x1}" y1="${g.y1}" x2="${g.x2}" y2="${g.y2}" stroke="${blind ? '#6a5a38' : '#7a1f1f'}"/>`);
      }
    }
    return lines.join('');
  }

  _edgeGeomPx(ax, ay, bx, by, sidePx, trimPx) {
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const px = -uy * sidePx;
    const py = ux * sidePx;
    const trim = Math.min(trimPx, len * 0.42);
    return {
      x1: ax + ux * trim + px,
      y1: ay + uy * trim + py,
      x2: bx - ux * trim + px,
      y2: by - uy * trim + py,
    };
  }

  _arrowPoly(x1, y1, x2, y2, hot, fill = '#ff7a3a') {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const tipx = x2;
    const tipy = y2;
    const bx = tipx - ux * 5;
    const by = tipy - uy * 5;
    const px = -uy * 2.2;
    const py = ux * 2.2;
    return `<polygon class="rep-arrow${hot ? '' : ' dim'}" fill="${fill}" points="${tipx},${tipy} ${bx + px},${by + py} ${bx - px},${by - py}"/>`;
  }

  _sizeWeb() {
    const web = this.container?.querySelector('[data-role="web"]');
    const world = web?.querySelector('[data-role="web-world"]');
    const svg = web?.querySelector('[data-role="web-svg"]');
    if (!web || !world || !svg) return;
    const m = this._webMetrics(web);
    if (this._webVw && this._webVw !== m.vw && this._webPan) {
      this._webPan.x *= m.vw / this._webVw;
      this._webPan.y *= m.vh / this._webVh;
    }
    this._webVw = m.vw;
    this._webVh = m.vh;
    if (!this._webPan) this._webPan = this._homePan(m);
    world.style.width = `${m.ww}px`;
    world.style.height = `${m.wh}px`;
    svg.setAttribute('width', String(m.ww));
    svg.setAttribute('height', String(m.wh));
    svg.setAttribute('viewBox', `0 0 ${m.ww} ${m.wh}`);
    svg.innerHTML = this._svgLines(m);
    this._paintBubbles();
    this._applyWebView();
  }

  _zoomValue() {
    const z = Number(this.state.webZoom);
    if (!Number.isFinite(z)) return 1;
    return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
  }

  _applyWebView() {
    const world = this.container?.querySelector('[data-role="web-world"]');
    const lab = this.container?.querySelector('[data-role="zoom-label"]');
    if (!world) return;
    const z = this._zoomValue();
    const web = this.container?.querySelector('[data-role="web"]');
    const m = this._webMetrics(web);
    const p = this._clampPan(this._webPan ?? this._homePan(m, z), m, z);
    this._webPan = p;
    world.style.transform = `translate(${p.x}px, ${p.y}px) scale(${z})`;
    if (lab) lab.textContent = `${Math.round(z * 100)}%`;
    requestAnimationFrame(() => this._fadeWebEdges());
  }

  /** Soften bubbles/threads near the viewport rim so the web feels focused. */
  _fadeWebEdges() {
    const web = this.container?.querySelector('[data-role="web"]');
    if (!web) return;
    const rect = web.getBoundingClientRect();
    if (rect.width < 16 || rect.height < 16) return;
    const margin = Math.min(rect.width, rect.height) * 0.2;
    const opacityAt = (x, y) => {
      const dx = Math.min(x - rect.left, rect.right - x);
      const dy = Math.min(y - rect.top, rect.bottom - y);
      const d = Math.min(dx, dy);
      if (d >= margin) return 1;
      return Math.max(0.12, d / margin);
    };
    for (const b of web.querySelectorAll('.rep-bubble')) {
      const br = b.getBoundingClientRect();
      let o = opacityAt(br.left + br.width / 2, br.top + br.height / 2);
      if (b.classList.contains('focus') || b.classList.contains('inspect')) o = Math.max(o, 0.65);
      b.style.opacity = String(o);
    }
    const svg = web.querySelector('[data-role="web-svg"]');
    if (!svg) return;
    for (const el of svg.querySelectorAll('line, polygon')) {
      const er = el.getBoundingClientRect();
      if (!er.width && !er.height) continue;
      let o = opacityAt(er.left + er.width / 2, er.top + er.height / 2);
      if (el.classList.contains('dim')) o *= 0.55;
      el.style.opacity = String(o);
    }
  }

  /** Keeps the world covering the viewport; centres it when zoomed out past the edges. */
  _clampPan(p, m, z = this._zoomValue()) {
    const axis = (v, size, view) =>
      size <= view ? (view - size) / 2 : Math.min(0, Math.max(view - size, v));
    return {
      x: axis(p?.x ?? 0, m.ww * z, m.vw),
      y: axis(p?.y ?? 0, m.wh * z, m.vh),
    };
  }

  /** Zooms about whatever the viewport is currently looking at. */
  _setZoom(next) {
    const z0 = this._zoomValue();
    const z1 = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, next));
    const web = this.container?.querySelector('[data-role="web"]');
    const m = this._webMetrics(web);
    if (this._webPan && z0 > 0) {
      const cx = (m.vw / 2 - this._webPan.x) / z0;
      const cy = (m.vh / 2 - this._webPan.y) / z0;
      this._webPan = { x: m.vw / 2 - cx * z1, y: m.vh / 2 - cy * z1 };
    }
    this.state.webZoom = z1;
    this.saveState();
    this._applyWebView();
  }

  /** Home = the focused bubble dead centre at 100%. */
  _resetView() {
    const web = this.container?.querySelector('[data-role="web"]');
    const m = this._webMetrics(web);
    this.state.webZoom = 1;
    this._webPan = this._clampPan(this._homePan(m, 1), m, 1);
    this.saveState();
    this._applyWebView();
  }

  _paintMeter(b, n) {
    b.querySelectorAll('.rep-meter, .rep-meter-tag').forEach(el => el.remove());
    b.insertAdjacentHTML('afterbegin', this._meterHTML(n));
  }

  _paintBubbles() {
    const web = this.container?.querySelector('[data-role="web"]');
    if (!web) return;
    const m = this._webMetrics(web);
    for (const n of this._nodes()) {
      const b = web.querySelector(`.rep-bubble[data-id="${n.id}"]`);
      if (!b) continue;
      const cat = NOTICE_CAT_MAP[n.category] ?? NOTICE_CAT_MAP.individual;
      const face = this._portraitFor(n);
      const pt = this._nodePx(n, m);
      const border = this._bubbleBorderColor(n);
      b.className = this._bubbleClass(n);
      b.style.left = `${pt.x}px`;
      b.style.top = `${pt.y}px`;
      b.style.borderColor = border;
      if (n.kind === 'self' || face) b.style.background = '';
      else b.style.background = cat.bg;
      b.title = n.name || 'Notice';
      this._paintMeter(b, n);
      let disk = b.querySelector('.rep-bubble-disk');
      if (!disk) {
        disk = document.createElement('span');
        disk.className = 'rep-bubble-disk';
        b.appendChild(disk);
      }
      let img = disk.querySelector('.rep-bubble-face');
      if (face) {
        if (!img) {
          img = document.createElement('img');
          img.className = 'rep-bubble-face';
          img.alt = '';
          disk.prepend(img);
        }
        if (img.getAttribute('src') !== face) img.src = face;
      } else if (img) {
        img.remove();
      }
      let name = disk.querySelector('.rep-bubble-name');
      if (!name) {
        name = document.createElement('span');
        name.className = 'rep-bubble-name';
        disk.appendChild(name);
      }
      name.textContent = this._bubbleLabel(n).slice(0, 18);
      let aff = b.querySelector('.rep-affils');
      const tags = this._tagsFor(n);
      if (tags.length) {
        const html = tags.map(t =>
          `<span class="rep-affil" title="${esc(`${t.label} — ${t.role}`)}">${esc(t.label)}</span>`).join('');
        if (!aff) {
          aff = document.createElement('span');
          aff.className = 'rep-affils';
          b.appendChild(aff);
        }
        aff.innerHTML = html;
      } else if (aff) {
        aff.remove();
      }
      b.title = [n.name || 'Notice', ...tags.map(t => `${t.label} — ${t.role}`)].join('\n');
    }
    this._fadeWebEdges();
  }

  _fillCard() {
    const el = this.container?.querySelector('[data-role="dossier"]');
    if (!el) return;
    const n = this._node(this.state.inspectedId) || this._node(this.state.focusId);
    el.innerHTML = n ? this._renderDossier(n) : `<div class="rep-dossier-empty">Select a notice in the web.</div>`;
    this._bindDossier(el, n);
  }

  _setInspect(id) {
    if (!this._node(id)) return;
    this.state.inspectedId = id;
    this._cardMode = 'view';
    this._editSnap = null;
    this.saveState();
    this._paintBubbles();
    this._fillCard();
    this._syncAuditButton();
  }

  _setFocus(id) {
    const next = this._node(id);
    if (!next) return;
    this.state.focusId = id;
    this.state.inspectedId = id;
    this._cardMode = 'view';
    this._editSnap = null;
    this.saveState();
    this._paintBubbles();
    this._webPan = null;
    this._sizeWeb();
    this._fillCard();
    this._syncAuditButton();
  }

  _syncAuditButton() {
    this.container?.querySelectorAll('[data-action="audit"]').forEach(btn => {
      if (btn.closest('.rep-modal')) return;
      if (btn.closest('.rep-card-actions')) return;
      btn.hidden = !this._canAudit();
    });
  }

  _snapshotNotice(n) {
    const center = this._center();
    const centerId = center && n.id !== center.id ? center.id : '';
    const rec = centerId ? this._readingToward(n, centerId) : null;
    return {
      name: n.name,
      description: n.description,
      notes: n.notes,
      standing: n.standing,
      category: n.category,
      characterId: n.characterId,
      houseId: n.houseId,
      intro: n.intro,
      _relCenterId: centerId,
      _hadRel: !!rec,
      _rel: rec ? { ...rec } : null,
    };
  }

  _restoreNoticeSnapshot(node, snap) {
    if (!node || !snap) return;
    const { _rel, _relCenterId, _hadRel, ...fields } = snap;
    Object.assign(node, fields);
    if (!_relCenterId) return;
    node.readings ??= [];
    const i = node.readings.findIndex(r => r.targetId === _relCenterId);
    if (_hadRel && _rel) {
      if (i >= 0) node.readings[i] = { ..._rel };
      else node.readings.push({ ..._rel });
    } else if (!_hadRel && i >= 0) {
      node.readings.splice(i, 1);
    }
  }

  _renderDossier(n) {
    const mode = this._cardMode === 'edit' || this._cardMode === 'connections' ? this._cardMode : 'view';
    if (mode === 'edit') return this._renderCardEdit(n);
    if (mode === 'connections') return this._renderCardConnections(n);
    return this._renderCardView(n);
  }

  _cardShell(n, { mode, inner }) {
    const cat = NOTICE_CAT_MAP[n.category] ?? NOTICE_CAT_MAP.individual;
    const isSelf = n.kind === 'self';
    const focused = this.state.focusId === n.id;
    const linkedToFocus = !focused && this._linkedTo(this.state.focusId, n.id);
    const org = isSelf ? 'STAR' : cat.label.toUpperCase();
    return `
      <div class="rep-card${mode === 'edit' ? ' editing' : ''}${mode === 'connections' ? ' linking' : ''}">
        <div class="rep-card-punches"><span></span><span></span><span></span></div>
        <div class="rep-card-body">
          <div class="rep-card-top">
            <span class="rep-card-org">${esc(org)}</span>
            <span class="rep-card-title">${esc(n.name || 'Untitled')}</span>
            <div class="rep-card-actions">
              ${mode === 'view' ? `
                <button type="button" class="rep-stamp" data-card="edit" title="Edit">✎</button>
                <button type="button" class="rep-stamp" data-card="connections" title="View connections">⚭</button>
                ${linkedToFocus
                  ? `<button type="button" class="rep-stamp danger" data-action="sever-link" title="Sever thread to the centered bubble">Sever</button>`
                  : ''}
                ${focused && (n.kind === 'self' || n.category === 'individual')
                  ? `<button type="button" class="rep-audit" data-action="audit" title="Audit connection">Audit</button>`
                  : focused ? '' : `<button type="button" class="rep-stamp" data-card="focus" title="Focus this notice">◎</button>`}
              ` : ''}
              ${mode === 'edit' ? `
                <button type="button" class="rep-stamp" data-card="save" title="Save">Save</button>
                <button type="button" class="rep-stamp" data-card="cancel" title="Cancel">✕</button>
              ` : ''}
              ${mode === 'connections' ? `
                <button type="button" class="rep-stamp" data-card="view" title="Back">View</button>
              ` : ''}
            </div>
          </div>
          ${inner}
        </div>
      </div>
    `;
  }

  _renderCardView(n) {
    if (n.category === 'rumor') return this._renderRumorView(n);
    const house = this._house(n.houseId);
    const cast = n.characterId ? getCastMembers(this.storage).find(c => c.id === n.characterId) : null;
    const focused = this.state.focusId === n.id;
    const links = (n.links ?? []).map(id => this._node(id)).filter(Boolean);
    const houseDuty = (house?.duty || house?.description || '').trim();
    const tags = this._tagsFor(n);
    const rel = this._relationWithCenter(n);
    const intro = this._introInfo(n);
    const toward = rel ? this._effectiveReadingToward(n, rel.center.id) : null;
    const hasReading = !!(toward && (toward.take || toward.standing != null || toward.rumors?.length));
    const inner = `
      <div class="rep-card-meta">
        ${focused ? `<span class="rep-card-flag">Focused</span>`
          : this._linkedTo(this.state.focusId, n.id)
            ? `<span class="rep-card-flag">Direct · inspecting</span>`
            : `<span class="rep-card-flag dim">Indirect · inspecting</span>`}
        ${!focused && intro.kind !== 'none' ? `<span class="rep-card-intro">${esc(intro.label)}</span>` : ''}
        ${!focused && intro.kind === 'none' ? `<span class="rep-card-intro dim">No introduction with ${esc(rel?.center?.name || 'center')} yet</span>` : ''}
      </div>
      ${!focused && rel?.description
        ? `<div class="rep-card-peek"><span class="rep-dos-k">Relationship</span> ${esc(rel.description)}</div>`
        : ''}
      ${this._opinionCardHTML(n)}
      ${!focused && !hasReading
        ? `<div class="rep-dossier-actions">
            <button type="button" class="rep-stamp" data-action="add-reading-toward" title="File what they think of the centered bubble">+ Reading</button>
          </div>`
        : ''}
      ${this._secretsBlockHTML(n)}
      ${this._interviewsBlockHTML(n)}
      ${tags.length ? `<div class="rep-card-affils">${tags.map(t =>
        `<span class="rep-affil" title="${esc(t.role)}">${esc(t.label)}</span>`).join('')}</div>` : ''}
      ${cast ? `<div class="rep-card-credit">Cast · ${esc(cast.name)} (${esc(priorityLabel(cast.priority))})</div>` : ''}
      ${n.category === 'group' ? `
        <div class="rep-card-house">
          ${house ? `
            <div class="rep-card-house-name">Affiliation · ${esc(house.name)}${house.alias ? ` · ${esc(house.alias)}` : ''}</div>
            ${house.authority ? `<div class="rep-card-credit">${esc(house.authority)}</div>` : ''}
            ${houseDuty ? `<div class="rep-card-house-desc">${esc(houseDuty)}</div>` : `<div class="rep-card-muted">No affiliation brief yet.</div>`}
            <button type="button" class="rep-stamp" data-card="open-house">Open dossier</button>
          ` : `<div class="rep-card-muted">Not linked to an Affiliation. Edit to connect it.</div>`}
        </div>` : ''}
      ${(() => {
        const center = this._center();
        const inbound = center && n.id === center.id ? this._inboundOpinions(n.id) : [];
        const bits = [`${links.length} thread${links.length === 1 ? '' : 's'}`];
        if (center && n.id !== center.id) bits.push(hasReading ? `opinion of ${center.name}` : `no take on ${center.name}`);
        if (inbound.length) bits.push(`${inbound.length} reading${inbound.length === 1 ? '' : 's'} of ${n.name}`);
        return `<div class="rep-card-peek dim">${bits.join(' · ')}</div>`;
      })()}
    `;
    return this._cardShell(n, { mode: 'view', inner });
  }

  _renderRumorView(n) {
    const focused = this.state.focusId === n.id;
    const target = this._node(n.targetId);
    const text = this._rumorText(n);
    const hearers = (n.links ?? [])
      .map(id => this._node(id))
      .filter(o => o && o.id !== n.originId && o.id !== n.targetId);
    const inner = `
      <div class="rep-card-meta">
        ${focused ? `<span class="rep-card-flag">Focused</span>`
          : this._linkedTo(this.state.focusId, n.id)
            ? `<span class="rep-card-flag">Direct · inspecting</span>`
            : `<span class="rep-card-flag dim">Indirect · inspecting</span>`}
        <span class="rep-card-intro">Rumor${target ? ` about ${esc(target.name)}` : ''}</span>
      </div>
      ${text ? `<div class="rep-card-peek"><span class="rep-dos-k">The take</span> ${esc(text)}</div>`
        : `<div class="rep-card-muted">No rumor text yet — edit to file what people are saying.</div>`}
      <div class="rep-card-muted">Rumors don’t hold thoughts of their own. Linked characters absorb this into their reading of ${esc(target?.name || 'the target')}.</div>
      ${this._rumorViewHTML(n)}
      ${hearers.length ? `
        <div class="rep-dos-k">Circulating among</div>
        <div class="rep-members">${hearers.map(h => `<span class="rep-affil">${esc(h.name)}</span>`).join('')}</div>` : ''}
    `;
    return this._cardShell(n, { mode: 'view', inner });
  }

  _rumorViewHTML(n) {
    const origin = this._node(n.originId);
    const target = this._node(n.targetId);
    const supporters = n.supporters ?? [];
    return `
      <div class="rep-rumor-block">
        <div class="rep-dos-k">Origin</div>
        <div>${origin ? esc(origin.name) : '<span class="rep-card-muted">Unattributed</span>'}</div>
        <div class="rep-dos-k">Supporters</div>
        <div class="rep-members">
          ${supporters.length
            ? supporters.map(s => this._memberBadgeHTML(s.characterId, s.role || 'Supporter')).join('')
            : `<div class="rep-card-muted">None named.</div>`}
        </div>
        <div class="rep-dos-k">Target</div>
        <div>${target ? esc(target.name) : '<span class="rep-card-muted">No target.</span>'}</div>
      </div>
    `;
  }

  _renderCardEdit(n) {
    const isSelf = n.kind === 'self';
    const cast = getCastMembers(this.storage).filter(c => c.priority !== 'director');
    const houses = this.state.house ?? [];
    const center = this._center();
    if (n.category === 'rumor') {
      const target = this._node(n.targetId);
      const inner = `
        <div class="rep-field"><label>Name</label>
          <input type="text" data-field="name" value="${esc(n.name)}"></div>
        <div class="rep-field">
          <label>The rumor <span class="rep-hint">${target ? `about ${esc(target.name)}` : 'set target under Connections'}</span></label>
          <textarea data-field="description" placeholder="What people are saying…">${esc(n.description ?? '')}</textarea>
        </div>
        <div class="rep-card-muted">Rumors don’t file thoughts or standings — they feed into linked characters’ reading of the target. Wire origin / target / hearers under Connections (⚭).</div>
        ${isSelf || n.auto ? '' : `
          <div class="rep-dossier-actions">
            <button type="button" class="rep-btn small danger" data-action="remove-notice">Remove</button>
          </div>`}
      `;
      return this._cardShell(n, { mode: 'edit', inner });
    }
    const rel = this._relationWithCenter(n);
    const toward = center && n.id !== center.id ? this._effectiveReadingToward(n, center.id) : null;
    const standVal = toward?.standing != null ? toward.standing : 0;
    const fromCenter = center && n.id !== center.id ? this._effectiveReadingToward(center, n.id) : null;
    const fromCenterVal = fromCenter?.standing != null ? fromCenter.standing : 0;
    const hasReading = !!(toward && (String(toward.take || '').trim() || toward.standing != null));
    const inner = `
      <div class="rep-field"><label>Name</label>
        <input type="text" data-field="name" value="${esc(n.name)}" ${isSelf ? 'readonly' : ''}></div>
      ${n.category === 'individual' ? `
      <div class="rep-field">
        <label>Cast / credit</label>
        <select data-field="characterId">
          <option value="">— Not linked —</option>
          ${cast.map(m =>
            `<option value="${esc(m.id)}" ${n.characterId === m.id ? 'selected' : ''}>${esc(m.name)} (${esc(priorityLabel(m.priority))})</option>`,
          ).join('')}
        </select>
      </div>` : ''}
      ${n.category === 'group' ? `
      <div class="rep-field">
        <label>Affiliation</label>
        <select data-field="houseId">
          <option value="">— Not linked —</option>
          ${houses.map(h =>
            `<option value="${esc(h.id)}" ${n.houseId === h.id ? 'selected' : ''}>${esc(h.name)}</option>`,
          ).join('')}
        </select>
        ${houses.length ? '' : `<div class="rep-card-muted">No affiliations yet — add one on the Affiliations tab.</div>`}
      </div>` : ''}
      ${center && n.id !== center.id ? `
      <div class="rep-field">
        <label>Introduction <span class="rep-hint">with ${esc(center.name)}</span></label>
        <select data-field="rel-intro">${this._introOptionsHTML(n, center.id)}</select>
      </div>
      <div class="rep-field">
        <label>Relationship <span class="rep-hint">with ${esc(center.name)}</span></label>
        <textarea data-field="rel-description" placeholder="How they know each other, history, favors…">${esc(rel?.description || '')}</textarea>
      </div>
      ${this._standingBarHTML(standVal, { fromName: n.name, toName: center.name })}
      ${this._hasIntro(n)
        ? this._standingBarHTML(fromCenterVal, {
          fromName: center.name,
          toName: n.name,
          field: 'from-center-standing',
          hint: 'Manual: what the centered bubble thinks of this one.',
        })
        : `<div class="rep-card-muted">Set Introduction first (pre-established or a scene) to file what ${esc(center.name)} thinks of ${esc(n.name)}.</div>`}
      ${!hasReading
        ? `<div class="rep-dossier-actions">
            <button type="button" class="rep-stamp" data-action="add-reading-toward">+ Reading</button>
          </div>`
        : `<div class="rep-card-muted">Reading filed — edit the take under Connections (⚭).</div>`}
      ` : `<div class="rep-card-muted">Centered — introductions, relationships, and readings are filed on other bubbles relative to this one.</div>`}
      ${isSelf || n.auto ? '' : `
        <div class="rep-dossier-actions">
          <button type="button" class="rep-btn small danger" data-action="remove-notice">Remove</button>
        </div>`}
    `;
    return this._cardShell(n, { mode: 'edit', inner });
  }

  _renderCardConnections(n) {
    if (n.category === 'rumor') return this._cardShell(n, { mode: 'connections', inner: this._rumorConnectionsHTML(n) });
    const others = this._nodes().filter(x => x.id !== n.id);
    const links = new Set(n.links ?? []);
    const linked = others.filter(o => links.has(o.id));
    const unlinked = others.filter(o => !links.has(o.id));
    const center = this._center();
    const towardCenter = center && n.id !== center.id ? this._effectiveReadingToward(n, center.id) : null;
    const filedToward = center && n.id !== center.id ? this._readingToward(n, center.id) : null;
    const incoming = n.id === center?.id ? this._inboundOpinions(n.id) : [];
    const inner = `
      ${others.length ? `
        <div class="rep-field">
          <label>Threads</label>
          <div class="rep-saved-list">
            ${linked.length ? linked.map(o => `
              <div class="rep-saved">
                <span class="rep-saved-name">${esc(o.name)}</span>
                <button type="button" class="rep-btn small danger" data-action="toggle-link" data-id="${o.id}">×</button>
              </div>`).join('') : `<div class="rep-card-muted">No threads filed.</div>`}
          </div>
          ${unlinked.length ? `
          <div class="rep-draft">
            <div class="rep-draft-k">Add connection</div>
            <select data-draft="thread">
              <option value="">— Connect to —</option>
              ${unlinked.map(o => `<option value="${o.id}">${esc(o.name)}</option>`).join('')}
            </select>
            <button type="button" class="rep-stamp" data-action="confirm-thread">Confirm</button>
          </div>` : ''}
        </div>
        ${n.id === center?.id ? `
        <div class="rep-field">
          <label>Readings of ${esc(n.name)}</label>
          <div class="rep-incoming">
            ${incoming.length ? incoming.map(({ src, r }) => {
              const st = r.standing != null ? standingInfo(r.standing) : standingInfo(0);
              return `<span class="rep-in-chip" style="border-color:${st.color};color:${st.color}">${esc(src.name)} · ${esc(st.label)}</span>`;
            }).join('') : `<div class="rep-card-muted">No opinions of the centered bubble yet.</div>`}
          </div>
        </div>` : `
        <div class="rep-field">
          <label>${esc(this._thinksLabel(n.name, center?.name))} <span class="rep-hint">this bubble only</span></label>
          <div class="rep-saved-list">
            ${towardCenter ? this._renderReadingSaved(towardCenter, { droppable: !!filedToward }) : `<div class="rep-card-muted">No take on the centered bubble.</div>`}
          </div>
          ${!filedToward && center ? `
          <div class="rep-draft">
            <div class="rep-draft-k">${esc(this._thinksLabel(n.name, center.name))}</div>
            <input type="hidden" data-draft="reading-target" value="${esc(center.id)}">
            ${this._standingDraftHTML(0)}
            <input type="text" data-draft="reading-take" placeholder="How they take it (optional)">
            <button type="button" class="rep-stamp" data-action="confirm-reading">Confirm</button>
          </div>` : ''}
        </div>`}
        ${this._secretsBlockHTML(n)}
        ${this._interviewsBlockHTML(n)}
      ` : `<div class="rep-card-muted">No other notices to connect yet.</div>`}
    `;
    return this._cardShell(n, { mode: 'connections', inner });
  }

  _rumorConnectionsHTML(n) {
    const origin = this._node(n.originId);
    const target = this._node(n.targetId);
    const supporters = n.supporters ?? [];
    const taken = new Set(supporters.map(s => s.characterId));
    const cast = getCastMembers(this.storage).filter(c => c.priority !== 'director' && !taken.has(c.id));
    const reserved = new Set([n.originId, n.targetId].filter(Boolean));
    const hearers = (n.links ?? [])
      .map(id => this._node(id))
      .filter(o => o && !reserved.has(o.id) && o.category !== 'rumor');
    const hearerIds = new Set(hearers.map(h => h.id));
    const unlinked = this._nodes().filter(o =>
      o.id !== n.id
      && o.category !== 'rumor'
      && !reserved.has(o.id)
      && !hearerIds.has(o.id));
    return `
      <div class="rep-card-muted">One thread per bubble — rumors don’t trade mutual thoughts. Linked hearers absorb this into their reading of the target.</div>
      <div class="rep-field">
        <label>Origin</label>
        ${origin ? `
          <div class="rep-saved">
            <span class="rep-saved-name">${esc(origin.name)}</span>
            <button type="button" class="rep-btn small danger" data-action="clear-origin">×</button>
          </div>` : `<div class="rep-card-muted">Unattributed</div>`}
        <div class="rep-draft">
          <div class="rep-draft-k">${origin ? 'Change origin' : 'Set origin'}</div>
          <select data-draft="origin">
            <option value="">— Who started it —</option>
            ${this._optgroupsHTML(n.id, n.originId)}
          </select>
          <button type="button" class="rep-stamp" data-action="confirm-origin">Confirm</button>
        </div>
      </div>
      <div class="rep-field">
        <label>Supporters</label>
        <div class="rep-saved-list">
          ${supporters.length ? supporters.map(s => {
            const m = getCastMembers(this.storage).find(c => c.id === s.characterId);
            return `
              <div class="rep-saved" data-id="${esc(s.characterId)}">
                ${this._memberBadgeHTML(s.characterId, s.role || 'Supporter')}
                <div class="rep-saved-copy">
                  <span class="rep-saved-name">${esc(m?.name || 'Unknown')}</span>
                  ${s.role ? `<span class="rep-saved-meta">${esc(s.role)}</span>` : ''}
                </div>
                <button type="button" class="rep-btn small danger" data-action="drop-supporter" data-id="${esc(s.characterId)}">×</button>
              </div>`;
          }).join('') : `<div class="rep-card-muted">None named.</div>`}
        </div>
        <div class="rep-draft">
          <div class="rep-draft-k">Add supporter</div>
          <select data-draft="supporter">
            <option value="">— Choose cast —</option>
            ${cast.map(m => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('')}
          </select>
          <input type="text" data-draft="supporter-role" placeholder="Why they back it (optional)">
          <button type="button" class="rep-stamp" data-action="confirm-supporter">Confirm</button>
        </div>
      </div>
      <div class="rep-field">
        <label>Target</label>
        ${target ? `
          <div class="rep-saved">
            <span class="rep-saved-name">${esc(target.name)}</span>
            <button type="button" class="rep-btn small danger" data-action="clear-target">×</button>
          </div>` : `<div class="rep-card-muted">No target.</div>`}
        <div class="rep-draft">
          <div class="rep-draft-k">${target ? 'Change target' : 'Set target'}</div>
          <select data-draft="target">
            <option value="">— About whom —</option>
            ${this._optgroupsHTML(n.id, n.targetId)}
          </select>
          <button type="button" class="rep-stamp" data-action="confirm-target">Confirm</button>
        </div>
      </div>
      <div class="rep-field">
        <label>Circulating among <span class="rep-hint">single thread each</span></label>
        <div class="rep-saved-list">
          ${hearers.length ? hearers.map(o => `
            <div class="rep-saved">
              <span class="rep-saved-name">${esc(o.name)}</span>
              <button type="button" class="rep-btn small danger" data-action="toggle-link" data-id="${o.id}">×</button>
            </div>`).join('') : `<div class="rep-card-muted">No extra hearers — origin &amp; supporters already count.</div>`}
        </div>
        ${unlinked.length ? `
        <div class="rep-draft">
          <div class="rep-draft-k">Thread to</div>
          <select data-draft="thread">
            <option value="">— Who heard it —</option>
            ${unlinked.map(o => `<option value="${o.id}">${esc(o.name)}</option>`).join('')}
          </select>
          <button type="button" class="rep-stamp" data-action="confirm-thread">Confirm</button>
        </div>` : ''}
      </div>
    `;
  }

  _renderReadingSaved(r, { droppable = true } = {}) {
    const target = this._node(r.targetId);
    const standing = r.standing != null ? clamp(r.standing) : null;
    const info = standing != null ? standingInfo(standing) : null;
    const rumors = r.rumors || [];
    return `
      <div class="rep-saved" data-target="${r.targetId}">
        <div class="rep-saved-copy">
          <span class="rep-saved-name">${esc(target?.name || '—')}</span>
          ${info
            ? `<span class="rep-saved-meta" style="color:${info.color}">${esc(info.label)} · ${standing}</span>`
            : (rumors.length ? `<span class="rep-saved-meta">via rumor</span>` : '')}
          ${r.take ? `<span class="rep-saved-take">${esc(r.take)}</span>` : ''}
          ${rumors.length ? `<span class="rep-saved-meta">${rumors.map(x => `⌘ ${x.name}`).join(' · ')}</span>` : ''}
        </div>
        ${droppable ? `<button type="button" class="rep-btn small danger" data-action="drop-reading">×</button>` : ''}
      </div>
    `;
  }

  _bindPersonal(root) {
    this._webRo?.disconnect();
    root.querySelector('[data-action="add-notice"]')?.addEventListener('click', () => this._addNotice());
    root.querySelector('[data-action="toggle-dossier"]')?.addEventListener('click', () => {
      this._hideDossier = !this._hideDossier;
      this.render(this.container);
    });
    root.querySelector('[data-action="audit"]')?.addEventListener('click', () => this._openAudit());
    root.querySelectorAll('.rep-bubble').forEach(btn => {
      btn.addEventListener('pointerdown', e => this._onBubbleDown(e, btn));
      btn.addEventListener('click', e => {
        if (btn.dataset.dragged === '1') { e.preventDefault(); return; }
        this._setInspect(btn.dataset.id);
      });
      btn.addEventListener('dblclick', e => {
        e.preventDefault();
        this._setFocus(btn.dataset.id);
      });
    });
    this._bindDossier(root.querySelector('[data-role="dossier"]'), this._node(this.state.inspectedId));
    const web = root.querySelector('[data-role="web"]');
    root.querySelector('[data-zoom="in"]')?.addEventListener('click', () => this._setZoom(this._zoomValue() * 1.2));
    root.querySelector('[data-zoom="out"]')?.addEventListener('click', () => this._setZoom(this._zoomValue() / 1.2));
    root.querySelector('[data-zoom="reset"]')?.addEventListener('click', () => this._resetView());
    if (web) {
      web.addEventListener('wheel', e => {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
        this._setZoom(this._zoomValue() * factor);
      }, { passive: false });
      web.addEventListener('pointerdown', e => this._onPlaneDown(e, web));
    }
    requestAnimationFrame(() => {
      this._sizeWeb();
      this._applyWebView();
    });
    if (web && typeof ResizeObserver !== 'undefined') {
      this._webRo = new ResizeObserver(() => this._sizeWeb());
      this._webRo.observe(web);
    }
  }

  _bindDossier(el, node) {
    if (!el || !node) return;
    el.querySelector('[data-card="edit"]')?.addEventListener('click', () => {
      this._editSnap = this._snapshotNotice(node);
      this._cardMode = 'edit';
      this._fillCard();
    });
    el.querySelector('[data-card="connections"]')?.addEventListener('click', () => {
      this._cardMode = 'connections';
      this._fillCard();
    });
    el.querySelector('[data-card="view"]')?.addEventListener('click', () => {
      this._cardMode = 'view';
      this._fillCard();
    });
    el.querySelector('[data-card="focus"]')?.addEventListener('click', () => this._setFocus(node.id));
    el.querySelector('[data-card="save"]')?.addEventListener('click', () => {
      this._editSnap = null;
      this._cardMode = 'view';
      this.saveState();
      this._paintBubbles();
      this._sizeWeb();
      this._fillCard();
    });
    el.querySelector('[data-card="cancel"]')?.addEventListener('click', () => {
      if (this._editSnap) this._restoreNoticeSnapshot(node, this._editSnap);
      this._editSnap = null;
      this._cardMode = 'view';
      this.saveState();
      this._paintBubbles();
      this._fillCard();
    });
    el.querySelector('[data-card="open-house"]')?.addEventListener('click', () => {
      if (!node.houseId) return;
      this._focusedHouseId = node.houseId;
      this._editingHouseId = null;
      this.state.tab = 'house';
      this.saveState();
      this.render(this.container);
    });
    el.querySelector('[data-action="audit"]')?.addEventListener('click', () => this._openAudit());
    el.querySelectorAll('[data-action="add-reading-toward"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const center = this._center();
        if (!center || center.id === node.id || node.category === 'rumor') return;
        this._upsertReading(node, center.id, { aware: 'knows', take: '' });
        this._ensureLink(node.id, center.id);
        this._cardMode = 'connections';
        this.saveState();
        this._sizeWeb();
        this._fillCard();
      });
    });
    el.querySelector('[data-action="sever-link"]')?.addEventListener('click', () => {
      const focusId = this.state.focusId;
      if (!focusId || focusId === node.id) return;
      if (!this._linkedTo(focusId, node.id)) return;
      this._removeLink(focusId, node.id);
      this.saveState();
      this._sizeWeb();
      this._fillCard();
    });
    el.querySelector('[data-action="confirm-origin"]')?.addEventListener('click', () => {
      this._setRumorLink(node, 'originId', el.querySelector('[data-draft="origin"]')?.value);
    });
    el.querySelector('[data-action="confirm-target"]')?.addEventListener('click', () => {
      this._setRumorLink(node, 'targetId', el.querySelector('[data-draft="target"]')?.value);
    });
    el.querySelector('[data-action="clear-origin"]')?.addEventListener('click', () => this._setRumorLink(node, 'originId', ''));
    el.querySelector('[data-action="clear-target"]')?.addEventListener('click', () => this._setRumorLink(node, 'targetId', ''));
    el.querySelector('[data-action="confirm-supporter"]')?.addEventListener('click', () => {
      const id = el.querySelector('[data-draft="supporter"]')?.value;
      if (!id) return;
      node.supporters ??= [];
      if (!node.supporters.some(s => s.characterId === id)) {
        node.supporters.push({
          characterId: id,
          role: el.querySelector('[data-draft="supporter-role"]')?.value.trim() || 'Supporter',
        });
      }
      const person = this._findPersonNode(id);
      if (person) this._ensureLink(node.id, person.id);
      this.saveState();
      this._sizeWeb();
      this._fillCard();
    });
    el.querySelectorAll('[data-action="drop-supporter"]').forEach(btn => {
      btn.addEventListener('click', () => {
        node.supporters = (node.supporters ?? []).filter(s => s.characterId !== btn.dataset.id);
        this.saveState();
        this._fillCard();
      });
    });

    const saveField = (field, value) => {
      if (field === 'standing') node.standing = clamp(value);
      else node[field] = value;
      this.saveState();
      this.bus.emit('reputation.updated', { node });
      if (field === 'standing' || field === 'name') {
        this._paintBubbles();
        this._sizeWeb();
      }
    };
    el.querySelectorAll('[data-field]').forEach(inp => {
      const ev = inp.tagName === 'TEXTAREA' || inp.type === 'text' || inp.tagName === 'SELECT' ? 'change' : 'input';
      inp.addEventListener(ev, () => {
        if (inp.dataset.field === 'characterId') {
          node.characterId = inp.value;
          const m = getCastMembers(this.storage).find(c => c.id === inp.value);
          if (m?.name && node.kind !== 'self') {
            node.name = m.name;
            const nameEl = el.querySelector('[data-field="name"]');
            if (nameEl) nameEl.value = m.name;
          }
          this.saveState();
          this._paintBubbles();
          return;
        }
        if (inp.dataset.field === 'houseId') {
          node.houseId = inp.value;
          const house = this._house(inp.value);
          const center = this._center();
          if (house) {
            if (!node.name || node.name === 'Notice') node.name = house.alias || house.name;
            const nameEl = el.querySelector('[data-field="name"]');
            if (nameEl && node.name) nameEl.value = node.name;
            const duty = (house.duty || house.description || '').trim();
            if (duty && center && center.id !== node.id) {
              const rec = this._readingToward(node, center.id);
              if (!String(rec?.description || '').trim()) {
                this._upsertReading(node, center.id, { description: duty, aware: 'knows' });
                const descEl = el.querySelector('[data-field="rel-description"]');
                if (descEl && !(descEl.value || '').trim()) descEl.value = duty;
              }
            }
          }
          this.saveState();
          this.bus.emit('reputation.updated', { node });
          this._paintBubbles();
          return;
        }
        if (inp.dataset.field === 'rel-intro') {
          const center = this._center();
          if (!center || center.id === node.id) return;
          this._upsertReading(node, center.id, { intro: inp.value, aware: 'knows' });
          this.saveState();
          this._sizeWeb();
          this._fillCard();
          return;
        }
        if (inp.dataset.field === 'rel-description') {
          const center = this._center();
          if (!center || center.id === node.id) return;
          this._upsertReading(node, center.id, { description: inp.value, aware: 'knows' });
          this.saveState();
          this.bus.emit('reputation.updated', { node });
          return;
        }
        if (inp.dataset.field === 'toward-standing') {
          this._applyTowardStanding(node, inp.value, el);
          return;
        }
        if (inp.dataset.field === 'from-center-standing') {
          this._applyFromCenterStanding(node, inp.value, el);
          return;
        }
        // Node-level intro/notes are obsolete; description is rumor body only.
        if (inp.dataset.field === 'intro' || inp.dataset.field === 'notes') {
          return;
        }
        if (inp.dataset.field === 'description') {
          if (node.category !== 'rumor') return;
          saveField('description', inp.value);
          return;
        }
        saveField(inp.dataset.field, inp.value);
      });
    });
    el.querySelectorAll('[data-action="set-cat"]').forEach(btn => {
      btn.addEventListener('click', () => {
        node.category = btn.dataset.cat;
        if (node.category !== 'individual') node.characterId = '';
        if (node.category !== 'group') node.houseId = '';
        this.saveState();
        this._fillCard();
        this._paintBubbles();
      });
    });
    el.querySelector('[data-action="confirm-thread"]')?.addEventListener('click', () => {
      const id = el.querySelector('[data-draft="thread"]')?.value;
      if (!id) return;
      this._toggleLink(node.id, id);
      this.saveState();
      this._sizeWeb();
      this._fillCard();
    });
    el.querySelectorAll('[data-action="toggle-link"]').forEach(btn => {
      btn.addEventListener('click', () => {
        this._toggleLink(node.id, btn.dataset.id);
        this.saveState();
        this._sizeWeb();
        this._fillCard();
      });
    });
    el.querySelector('[data-draft="reading-standing"]')?.addEventListener('input', e => {
      const v = clamp(e.currentTarget.value);
      const info = standingInfo(v);
      const lab = el.querySelector('[data-role="draft-stand-label"]');
      if (lab) {
        lab.textContent = `${info.label} · ${v}`;
        lab.style.color = info.color;
      }
    });
    el.querySelector('[data-action="confirm-reading"]')?.addEventListener('click', () => {
      const center = this._center();
      const targetId = el.querySelector('[data-draft="reading-target"]')?.value;
      if (!targetId || !center || targetId !== center.id) return;
      node.readings ??= [];
      if (!node.readings.some(r => r.targetId === targetId)) {
        node.readings.push({
          targetId,
          aware: 'knows',
          standing: clamp(el.querySelector('[data-draft="reading-standing"]')?.value ?? 0),
          take: el.querySelector('[data-draft="reading-take"]')?.value.trim() || '',
        });
      }
      this.saveState();
      this._sizeWeb();
      this._fillCard();
    });
    el.querySelectorAll('[data-action="drop-reading"]').forEach(btn => {
      const row = btn.closest('.rep-saved');
      const targetId = row?.dataset.target;
      if (!targetId) return;
      btn.addEventListener('click', () => {
        node.readings = (node.readings ?? []).filter(r => r.targetId !== targetId);
        this.saveState();
        this._sizeWeb();
        this._fillCard();
      });
    });
    el.querySelector('[data-action="remove-notice"]')?.addEventListener('click', () => {
      if (!confirm(`Drop the notice for ${node.name}?`)) return;
      this._removeNotice(node.id);
    });
  }

  _refreshWebChrome() {
    this._paintBubbles();
    this._sizeWeb();
  }

  /** Drag empty plane to pan. The focused bubble stays the home position for reset. */
  _onPlaneDown(e, web) {
    if (e.button != null && e.button !== 0) return;
    if (e.target.closest('.rep-bubble')) return;
    const m = this._webMetrics(web);
    const base = { ...(this._webPan ?? this._homePan(m)) };
    const startX = e.clientX;
    const startY = e.clientY;
    web.setPointerCapture?.(e.pointerId);
    web.classList.add('panning');
    const move = ev => {
      this._webPan = this._clampPan(
        { x: base.x + (ev.clientX - startX), y: base.y + (ev.clientY - startY) },
        this._webMetrics(web),
      );
      this._applyWebView();
    };
    const up = () => {
      web.classList.remove('panning');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      this._fadeWebEdges();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  _onBubbleDown(e, btn) {
    if (e.button != null && e.button !== 0) return;
    e.stopPropagation();
    const node = this._node(btn.dataset.id);
    const web = this.container.querySelector('[data-role="web"]');
    if (!node || !web) return;
    if (node.id === this.state.focusId) return;
    btn.dataset.dragged = '0';
    const startX = e.clientX;
    const startY = e.clientY;
    const orig = { x: node.x, y: node.y };
    btn.setPointerCapture?.(e.pointerId);
    btn.classList.add('dragging');
    const move = ev => {
      const rect = web.getBoundingClientRect();
      if (Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) > 4) btn.dataset.dragged = '1';
      const z = this._zoomValue();
      const next = this._clampPos(
        orig.x + (ev.clientX - startX) / (rect.width * z),
        orig.y + (ev.clientY - startY) / (rect.height * z),
      );
      node.x = next.x;
      node.y = next.y;
      this._refreshWebChrome();
    };
    const up = () => {
      btn.classList.remove('dragging');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      this.saveState();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  _linkedTo(aId, bId) {
    if (!aId || !bId || aId === bId) return false;
    const a = this._node(aId);
    return !!(a?.links ?? []).includes(bId);
  }

  _removeLink(aId, bId) {
    if (aId === bId) return;
    const a = this._node(aId);
    const b = this._node(bId);
    if (!a || !b) return;
    a.links = (a.links ?? []).filter(id => id !== bId);
    b.links = (b.links ?? []).filter(id => id !== aId);
  }

  _toggleLink(aId, bId) {
    if (aId === bId) return;
    const a = this._node(aId);
    const b = this._node(bId);
    if (!a || !b) return;
    a.links ??= [];
    b.links ??= [];
    if (a.links.includes(bId)) {
      this._removeLink(aId, bId);
    } else {
      a.links.push(bId);
      b.links.push(aId);
    }
  }

  _setRumorLink(node, field, id) {
    const prev = node[field];
    if (prev && prev !== id) {
      const other = this._node(prev);
      if (other && (field === 'originId' || field === 'targetId')) {
        node.links = (node.links ?? []).filter(x => x !== prev);
        other.links = (other.links ?? []).filter(x => x !== node.id);
      }
    }
    node[field] = id || '';
    if (id) this._ensureLink(node.id, id);
    this.saveState();
    this._sizeWeb();
    this._fillCard();
  }

  _openAudit() {
    if (!this._canAudit()) return;
    const focus = this._node(this.state.focusId);
    const backdrop = this._buildModal(`
      <div class="rep-modal-title">AUDIT</div>
      <div class="rep-modal-subtitle">— Evaluate a connection —</div>
      <div class="rep-field">
        <label>From</label>
        <div class="rep-locked">
          <div class="rep-locked-title">${esc(focus.name)}</div>
        </div>
      </div>
      <div class="rep-field">
        <label>Evaluate connection to</label>
        <select data-field="target">
          <option value="">— Choose a bubble —</option>
          ${this._optgroupsHTML(focus.id, '')}
        </select>
      </div>
      <div class="rep-modal-actions">
        <button type="button" class="rep-btn" data-action="cancel">Cancel</button>
        <button type="button" class="rep-audit" data-action="run-audit">Audit</button>
      </div>
    `);
    backdrop.querySelector('[data-action="run-audit"]').addEventListener('click', async () => {
      const targetId = backdrop.querySelector('[data-field="target"]').value;
      if (!targetId) { alert('Choose a bubble to evaluate.'); return; }
      const btn = backdrop.querySelector('[data-action="run-audit"]');
      await this._runConnectionAudit(focus, this._node(targetId), btn);
      backdrop.remove();
    });
  }

  async _runConnectionAudit(from, to, btn) {
    if (!from || !to) return;
    const orig = btn.textContent;
    btn.disabled = true;
    btn.textContent = '...';
    try {
      const cid = from.characterId || (from.kind === 'self' ? getStarMember(this.storage)?.id : '');
      const cardBlock = this._castPromptBlock(from);
      const tags = this._tagsFor(from);
      const affil = tags.length
        ? tags.map(t => `${t.label} (${t.role})`).join(', ')
        : 'None listed';
      const scenes = this._creditedScenes(cid, from.name);
      const sceneBlock = scenes.length
        ? scenes.map(c => {
          const role = (c.credits ?? []).find(cr => cr.characterId === cid || String(cr.name || '').toLowerCase() === String(from.name || '').toLowerCase());
          const body = (c.summary || c.content || '').trim().slice(0, 400);
          return `- ${c.title || 'Untitled'}${role?.role ? ` [${role.role}]` : ''}${body ? `: ${body}` : ''}`;
        }).join('\n')
        : 'None credited.';
      const recent = this._recentScene(from);
      const toCat = NOTICE_CAT_MAP[to.category]?.label || 'Notice';
      let targetBlock = `${toCat}: ${to.name}\n${(to.description || '').trim()}`;
      if (to.category === 'group' && to.houseId) {
        const h = this._house(to.houseId);
        if (h) targetBlock += `\nHouse duty: ${h.duty || ''}\nAuthority: ${h.authority || ''}`;
      }
      if (to.category === 'rumor') {
        const origin = this._node(to.originId);
        const tgt = this._node(to.targetId);
        targetBlock += `\nOrigin: ${origin?.name || 'unknown'}\nRumor target: ${tgt?.name || 'unknown'}`;
      }
      const existing = (from.readings ?? []).find(r => r.targetId === to.id);

      const prompt = `You are ${from.name}. Stay in character.\n\n${cardBlock}\n\nHouse affiliations: ${affil}\n\nCredited scenes/cards:\n${sceneBlock}\n\nRecent scene:\n${recent}\n\nSomeone asks: "What do you think of ${to.name}?"\n\nSubject:\n${targetBlock}\n\n${existing?.take ? `Your prior take: ${existing.take}\n` : ''}Answer in at most 3 sentences. No preamble, no quotes around the whole answer, no "As ${from.name}".`;

      const response = String(await withShowtimeProfile(this.storage, 'audit', () =>
        generateQuietPrompt({ quietPrompt: prompt, trimToSentence: true })) ?? '').trim();
      if (!response) throw new Error('Empty audit reply.');
      const take = response.split(/(?<=[.!?])\s+/).filter(Boolean).slice(0, 3).join(' ');
      from.readings ??= [];
      const rec = from.readings.find(r => r.targetId === to.id);
      if (rec) {
        rec.aware = rec.aware === 'unaware' ? 'heard' : (rec.aware || 'knows');
        rec.take = take;
      } else {
        from.readings.push({ targetId: to.id, aware: 'knows', take });
      }
      this._ensureLink(from.id, to.id);
      this.saveState();
      this.bus.emit('reputation.updated', { node: from });
      this._sizeWeb();
      this.state.inspectedId = from.id;
      this._cardMode = 'connections';
      this._fillCard();
    } catch (err) {
      console.error('[Reputation audit]', err);
      alert(`Audit failed: ${err.message}`);
    } finally {
      btn.disabled = false;
      btn.textContent = orig;
    }
  }

  async _runHouseAudit(h, btn) {
    if (!h || !btn) return;
    const orig = btn.textContent;
    btn.disabled = true;
    btn.textContent = '...';
    try {
      const self = this._nodes().find(n => n.kind === 'self') || this._selfNode();
      const star = getStarMember(this.storage);
      const starName = star?.name || self.name || '{{user}}';
      const roster = this._houseRoster(h).map(m => {
        const c = getCastMembers(this.storage).find(x => x.id === m.characterId);
        return `- ${c?.name || 'Unknown'} (${m.role})`;
      }).join('\n') || 'None listed.';
      const head = h.headId ? getCastMembers(this.storage).find(c => c.id === h.headId) : null;
      const scenes = this._creditedScenes(star?.id, starName);
      const sceneBlock = scenes.length
        ? scenes.map(c => {
          const role = (c.credits ?? []).find(cr => cr.characterId === star?.id || String(cr.name || '').toLowerCase() === String(starName || '').toLowerCase());
          const body = (c.summary || c.content || '').trim().slice(0, 400);
          return `- ${c.title || 'Untitled'}${role?.role ? ` [${role.role}]` : ''}${body ? `: ${body}` : ''}`;
        }).join('\n')
        : 'None credited.';
      const recent = this._recentScene(self);
      const starBlock = this._castPromptBlock(self);

      const prompt = `You are the institution "${h.name}"${h.alias ? ` (${h.alias})` : ''}. Speak as the house's collective stance, not as a single person.\n\nDuty / purpose: ${h.duty || 'unstated'}\nAuthority: ${h.authority || 'unstated'}\nApparent head: ${head?.name || 'none named'}\nKnown members:\n${roster}\n\nThe Star ({{user}}):\n${starBlock}\nName on file: ${starName}\n\nCredited scenes/cards involving the Star:\n${sceneBlock}\n\nRecent scene:\n${recent}\n\n${h.opinion ? `Prior institutional take: ${h.opinion}\nPrior standing: ${clamp(h.standing)}\n` : ''}How does this house regard the Star?\n\nReply with JSON only, no markdown:\n{"standing": <integer from -100 to 100>, "take": "<at most 3 sentences>"}\nstanding: -100 infamous/hostile toward the Star, 0 unknown/neutral, 100 celebrated/favored.`;

      const response = String(await withShowtimeProfile(this.storage, 'audit', () =>
        generateQuietPrompt({ quietPrompt: prompt, trimToSentence: false })) ?? '').trim();
      if (!response) throw new Error('Empty audit reply.');
      const parsed = parseStandingTake(response);
      if (!parsed.take && parsed.standing == null) throw new Error('Could not read the audit.');
      if (parsed.standing != null) h.standing = parsed.standing;
      if (parsed.take) h.opinion = parsed.take;
      const group = this._nodes().find(n => n.category === 'group' && n.houseId === h.id);
      if (group) {
        group.standing = clamp(h.standing);
        if (self) this._upsertReading(group, self.id, { take: h.opinion, aware: 'knows', standing: h.standing });
      }
      this.saveState();
      this.bus.emit('reputation.updated', { house: h });
      this.render(this.container);
    } catch (err) {
      console.error('[Reputation house audit]', err);
      alert(`Audit failed: ${err.message}`);
    } finally {
      btn.disabled = false;
      btn.textContent = orig;
    }
  }

  _addNotice() {
    const houses = this.state.house ?? [];
    const hubId = this.state.focusId || 'self';
    const backdrop = this._buildModal(`
      <div class="rep-modal-title">CONNECTION</div>
      <div class="rep-modal-subtitle">— Post it on the web —</div>
      <div class="rep-field">
        <label>Kind</label>
        <div class="rep-cat-row">
          ${NOTICE_CATS.map(c =>
            `<button type="button" class="rep-cat-btn${c.id === 'individual' ? ' on' : ''}" data-cat="${c.id}" style="--cat:${c.color}">${esc(c.label)}</button>`,
          ).join('')}
        </div>
      </div>
      <div class="rep-field" data-role="cast-wrap">
        <label>Cast / credit (optional)</label>
        <select data-field="characterId">
          <option value="">— Not linked —</option>
          ${getCastMembers(this.storage).filter(c => c.priority !== 'director').map(m =>
            `<option value="${esc(m.id)}">${esc(m.name)} (${esc(priorityLabel(m.priority))})</option>`,
          ).join('')}
        </select>
      </div>
      <div class="rep-field" data-role="house-wrap" style="display:none">
        <label>Affiliation</label>
        <select data-field="houseId">
          <option value="">— Choose an affiliation —</option>
          ${houses.map(h => `<option value="${esc(h.id)}">${esc(h.alias ? `${h.name} (${h.alias})` : h.name)}</option>`).join('')}
        </select>
        ${houses.length ? '' : `<div class="rep-card-muted">File an Affiliation dossier first.</div>`}
      </div>
      <div class="rep-locked" data-role="house-preview" hidden></div>
      <div data-role="rumor-wrap" style="display:none">
        <div class="rep-field">
          <label>Origin</label>
          <select data-field="originId">
            <option value="">— Who started it —</option>
            ${this._optgroupsHTML('', '')}
          </select>
        </div>
        <div class="rep-field">
          <label>Target</label>
          <select data-field="targetId">
            <option value="">— About whom —</option>
            ${this._optgroupsHTML('', '')}
          </select>
        </div>
        <div class="rep-field">
          <label>Supporters</label>
          <div class="rep-members" data-role="supporter-chips"></div>
          <div class="rep-draft">
            <div class="rep-draft-k">Add supporter</div>
            <select data-draft="new-supporter">
              <option value="">— Choose cast —</option>
              ${getCastMembers(this.storage).filter(c => c.priority !== 'director').map(m =>
                `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('')}
            </select>
            <button type="button" class="rep-stamp" data-action="add-supporter">Add</button>
          </div>
        </div>
      </div>
      <div class="rep-field" data-role="name-wrap"><label>Name</label>
        <input type="text" data-field="name" placeholder="Person, mill, rumor..."></div>
      <div class="rep-field" data-role="desc-wrap"><label data-role="desc-label">Description (optional)</label>
        <textarea data-field="description"></textarea></div>
      <div class="rep-modal-actions">
        <button type="button" class="rep-btn" data-action="cancel">Cancel</button>
        <button type="button" class="rep-btn" data-action="save">Post</button>
      </div>
    `);
    let category = 'individual';
    const supporters = [];
    const chips = backdrop.querySelector('[data-role="supporter-chips"]');
    const paintChips = () => {
      chips.innerHTML = supporters.map(s => this._memberBadgeHTML(s.characterId, 'Supporter')).join('');
    };
    const preview = backdrop.querySelector('[data-role="house-preview"]');
    const fillPreview = house => {
      if (!house) {
        preview.hidden = true;
        preview.innerHTML = '';
        return;
      }
      preview.hidden = false;
      preview.innerHTML = `
        <div class="rep-locked-k">From the dossier</div>
        <div class="rep-locked-title">${esc(house.name)}${house.alias ? ` <sup class="rep-alias">${esc(house.alias)}</sup>` : ''}</div>
        ${house.authority ? `<div class="rep-locked-auth">${esc(house.authority)}</div>` : ''}
        ${house.duty ? `<div class="rep-locked-duty">${esc(house.duty)}</div>` : ''}
      `;
    };
    const syncCat = () => {
      backdrop.querySelectorAll('.rep-cat-btn').forEach(b => b.classList.toggle('on', b.dataset.cat === category));
      const houseMode = category === 'group';
      const rumorMode = category === 'rumor';
      backdrop.querySelector('[data-role="cast-wrap"]').style.display = category === 'individual' ? '' : 'none';
      backdrop.querySelector('[data-role="house-wrap"]').style.display = houseMode ? '' : 'none';
      backdrop.querySelector('[data-role="rumor-wrap"]').style.display = rumorMode ? '' : 'none';
      backdrop.querySelector('[data-role="name-wrap"]').style.display = houseMode ? 'none' : '';
      backdrop.querySelector('[data-role="desc-wrap"]').style.display = houseMode ? 'none' : '';
      const descLab = backdrop.querySelector('[data-role="desc-label"]');
      if (descLab) descLab.textContent = rumorMode ? 'The rumor' : 'Description (optional)';
      if (!houseMode) fillPreview(null);
      else fillPreview(this._house(backdrop.querySelector('[data-field="houseId"]').value));
    };
    backdrop.querySelectorAll('.rep-cat-btn').forEach(b => {
      b.addEventListener('click', () => { category = b.dataset.cat; syncCat(); });
    });
    backdrop.querySelector('[data-field="characterId"]')?.addEventListener('change', e => {
      const m = getCastMembers(this.storage).find(c => c.id === e.target.value);
      if (m?.name) backdrop.querySelector('[data-field="name"]').value = m.name;
    });
    backdrop.querySelector('[data-field="houseId"]')?.addEventListener('change', e => {
      fillPreview(this._house(e.target.value));
    });
    backdrop.querySelector('[data-action="add-supporter"]')?.addEventListener('click', () => {
      const id = backdrop.querySelector('[data-draft="new-supporter"]')?.value;
      if (!id || supporters.some(s => s.characterId === id)) return;
      supporters.push({ characterId: id, role: 'Supporter' });
      paintChips();
    });
    backdrop.querySelector('[data-action="save"]').addEventListener('click', () => {
      let name = backdrop.querySelector('[data-field="name"]').value.trim();
      let description = backdrop.querySelector('[data-field="description"]').value.trim();
      const characterId = category === 'individual'
        ? (backdrop.querySelector('[data-field="characterId"]')?.value || '')
        : '';
      const houseId = category === 'group'
        ? (backdrop.querySelector('[data-field="houseId"]')?.value || '')
        : '';
      const originId = category === 'rumor' ? (backdrop.querySelector('[data-field="originId"]')?.value || '') : '';
      const targetId = category === 'rumor' ? (backdrop.querySelector('[data-field="targetId"]')?.value || '') : '';
      if (category === 'group') {
        const house = this._house(houseId);
        if (!house) { alert('Choose an affiliation from the list.'); return; }
        if (this._nodes().some(n => n.category === 'group' && n.houseId === houseId)) {
          alert('That affiliation is already on the web.');
          return;
        }
        name = house.alias || house.name;
        description = house.duty || house.description || '';
      }
      if (category === 'rumor' && !name) { alert('Name the rumor.'); return; }
      if (!name) { alert('Name is required.'); return; }
      const pos = this._orbit(this._nodes().length);
      const node = {
        id: uid(),
        kind: 'notice',
        category,
        characterId,
        houseId,
        originId,
        targetId,
        supporters: category === 'rumor' ? supporters.slice() : [],
        name,
        description,
        notes: '',
        standing: 0,
        x: pos.x,
        y: pos.y,
        links: [hubId],
        readings: [],
      };
      const hub = this._node(hubId) || this._nodes().find(n => n.kind === 'self');
      if (hub) { hub.links ??= []; if (!hub.links.includes(node.id)) hub.links.push(node.id); }
      this.state.personal.push(node);
      if (originId) this._ensureLink(node.id, originId);
      if (targetId) this._ensureLink(node.id, targetId);
      if (category === 'rumor') {
        for (const s of supporters) {
          const person = this._findPersonNode(s.characterId);
          if (person) this._ensureLink(node.id, person.id);
        }
      }
      this.state.inspectedId = node.id;
      this._cardMode = 'view';
      this.saveState();
      this.bus.emit('reputation.updated', { node });
      backdrop.remove();
      this.render(this.container);
    });
    setTimeout(() => backdrop.querySelector('[data-field="name"]').focus(), 0);
  }

  _removeNotice(id) {
    const node = this._node(id);
    if (!node || node.kind === 'self') return;
    for (const n of this._nodes()) {
      n.links = (n.links ?? []).filter(x => x !== id);
      n.readings = (n.readings ?? []).filter(r => r.targetId !== id);
    }
    this.state.personal = this._nodes().filter(n => n.id !== id);
    if (this.state.focusId === id) this.state.focusId = 'self';
    this.state.inspectedId = this.state.focusId || 'self';
    this._cardMode = 'view';
    this.saveState();
    this.bus.emit('reputation.removed', { id });
    this.render(this.container);
  }

  _renderHouse() {
    const list = this._sortedHouses();
    const sort = this.state.houseSort || 'name';
    return `
      <div class="rep-house">
        <div class="rep-toolbar">
          <div class="rep-kicker">Printed dossiers · affiliation standing is the Star / {{user}} only</div>
          <label class="rep-sort">
            <span>Sort</span>
            <select data-action="house-sort">
              ${HOUSE_SORTS.map(s =>
                `<option value="${s.id}" ${s.id === sort ? 'selected' : ''}>${esc(s.label)}</option>`,
              ).join('')}
            </select>
          </label>
          <button type="button" class="rep-btn" data-action="add-house">+ Affiliation</button>
        </div>
        <div class="rep-house-stack" data-role="house-list">
          ${list.length ? list.map((h, i) => this._renderHouseDossier(h, i, list.length)).join('') : `<div class="rep-empty">No affiliations filed yet.</div>`}
        </div>
      </div>
    `;
  }

  _sortedHouses() {
    const list = [...(this.state.house ?? [])];
    const sort = this.state.houseSort || 'name';
    const score = h => this._affiliationScore(h);
    list.sort((a, b) => {
      if (sort === 'reputation') return clamp(b.standing) - clamp(a.standing) || (a.name || '').localeCompare(b.name || '');
      if (sort === 'affiliation') return score(b) - score(a) || (a.name || '').localeCompare(b.name || '');
      return (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' });
    });
    const topId = this._editingHouseId || this._focusedHouseId;
    if (topId) {
      const i = list.findIndex(h => h.id === topId);
      if (i >= 0) list.push(...list.splice(i, 1));
    }
    return list;
  }

  _affiliationScore(h) {
    const members = new Set((h.connections ?? []).map(c => c.characterId).filter(Boolean));
    if (h.headId) members.add(h.headId);
    let mutual = 0;
    for (const other of this.state.house ?? []) {
      if (other.id === h.id) continue;
      const theirs = new Set((other.connections ?? []).map(c => c.characterId).filter(Boolean));
      if (other.headId) theirs.add(other.headId);
      for (const id of members) if (theirs.has(id)) mutual += 1;
    }
    return members.size * 10 + mutual;
  }

  _houseBannerStyle(h) {
    const a = h.colorA || '#c9a24a';
    const b = h.colorB || '#6b4f1e';
    if (h.dress === 'banner' && h.banner) {
      const url = String(h.banner).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      return `background-image:url("${url}");background-size:cover;background-position:center`;
    }
    if (h.dress === 'solid') return `background:${a}`;
    return `background:linear-gradient(90deg, ${a}, ${b})`;
  }

  _houseTitleHTML(h) {
    const alias = (h.alias || '').trim();
    return `${esc(h.name || 'Unnamed Affiliation')}${alias ? ` <sup class="rep-alias">${esc(alias)}</sup>` : ''}`;
  }

  _karmaHTML(h, { editable = false } = {}) {
    const info = standingInfo(h.standing);
    const v = clamp(h.standing);
    const pct = Math.abs(v) / 2;
    const style = v >= 0
      ? `left:50%;width:${pct}%;background:${info.color}`
      : `left:${50 - pct}%;width:${pct}%;background:${info.color}`;
    return `
      <div class="rep-karma" data-role="karma">
        <div class="rep-karma-head">
          <span>Opinion of the Star</span>
          <span class="rep-karma-label" data-role="stand-label" style="color:${info.color}">${info.label} · ${v}</span>
        </div>
        <div class="rep-karma-track" title="This house's opinion of {{user}}">
          <div class="rep-karma-mid"></div>
          <div class="rep-karma-fill" data-role="karma-fill" style="${style}"></div>
        </div>
        ${h.opinion ? `<div class="rep-house-take" data-role="house-take">${esc(h.opinion)}</div>` : ''}
        ${editable ? `<input type="range" min="-100" max="100" step="1" data-field="standing" value="${v}">` : ''}
      </div>
    `;
  }

  _memberBadgeHTML(characterId, role, { removable = false } = {}) {
    const m = getCastMembers(this.storage).find(c => c.id === characterId);
    const name = m?.name || 'Unknown';
    const face = this._castPortrait(characterId);
    const tip = role ? `${name} — ${role}` : name;
    const init = (name || '?').charAt(0).toUpperCase();
    return `
      <span class="rep-member" data-id="${esc(characterId)}" title="${esc(tip)}">
        ${face ? `<img src="${esc(face)}" alt="">` : `<span class="rep-member-init">${esc(init)}</span>`}
        ${removable ? `<button type="button" class="rep-member-x" data-action="drop-member" data-id="${esc(characterId)}" title="Remove">×</button>` : ''}
      </span>
    `;
  }

  _houseConnectionsHTML(h, { composing = true } = {}) {
    const members = (h.connections ?? []).filter(c => c.characterId);
    const cast = getCastMembers(this.storage).filter(c => c.priority !== 'director');
    const taken = new Set(members.map(c => c.characterId));
    const free = cast.filter(c => !taken.has(c.id));
    return `
      <div class="rep-saved-list">
        ${members.length ? members.map(c => {
          const m = getCastMembers(this.storage).find(x => x.id === c.characterId);
          return `
            <div class="rep-saved" data-id="${esc(c.characterId)}">
              ${this._memberBadgeHTML(c.characterId, c.role)}
              <div class="rep-saved-copy">
                <span class="rep-saved-name">${esc(m?.name || 'Unknown')}</span>
                ${c.role ? `<span class="rep-saved-meta">${esc(c.role)}</span>` : ''}
              </div>
              ${composing ? `<button type="button" class="rep-btn small danger" data-action="drop-member" data-id="${esc(c.characterId)}">×</button>` : ''}
            </div>`;
        }).join('') : `<div class="rep-card-muted">No known members listed.</div>`}
      </div>
      ${composing ? `
      <div class="rep-draft">
        <div class="rep-draft-k">Add connection</div>
        <select data-draft="member">
          <option value="">— Choose cast —</option>
          ${free.map(m => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('')}
        </select>
        <input type="text" data-draft="member-role" placeholder="Affiliation / position">
        <button type="button" class="rep-stamp" data-action="confirm-member">Confirm</button>
      </div>` : ''}
    `;
  }

  _renderHouseDossier(h, index, total) {
    const open = this._focusedHouseId === h.id;
    const editing = this._editingHouseId === h.id;
    const mode = editing ? 'editing' : (open ? 'open' : 'min');
    const z = editing || open ? 500 : index + 1;
    const side = h.badgeSide === 'right' ? 'badge-right' : 'badge-left';
    const head = h.headId ? getCastMembers(this.storage).find(c => c.id === h.headId) : null;
    const inner = editing ? this._renderHouseEdit(h) : (open ? this._renderHouseOpen(h, head) : this._renderHousePeek(h, head));
    return `
      <article class="rep-dos ${mode}" data-id="${h.id}" style="z-index:${z}">
        <div class="rep-dos-banner" data-role="dress" style="${this._houseBannerStyle(h)}"></div>
        <header class="rep-letterhead ${side}">
          <div class="rep-letterhead-badge" data-role="badge">
            ${h.badge
              ? `<img src="${esc(h.badge)}" alt="">`
              : `<span class="rep-monogram">${esc((h.alias || h.name || '?').charAt(0).toUpperCase())}</span>`}
          </div>
          <div class="rep-letterhead-copy">
            <div class="rep-letterhead-title">${this._houseTitleHTML(h)}</div>
            <div class="rep-letterhead-authority">${esc(h.authority || 'Authority unstated')}</div>
          </div>
          <div class="rep-letterhead-actions">
            ${editing ? `
              <button type="button" class="rep-stamp" data-action="save-house">Save</button>
              <button type="button" class="rep-stamp" data-action="cancel-house">✕</button>
            ` : `
              <button type="button" class="rep-audit" data-action="audit-house" title="Audit opinion of the Star">Audit</button>
              <button type="button" class="rep-stamp" data-action="edit-house" title="Edit">✎</button>
              <button type="button" class="rep-stamp" data-action="remove-house" title="Remove">✕</button>
            `}
          </div>
        </header>
        <div class="rep-dos-body">${inner}</div>
      </article>
    `;
  }

  _renderHousePeek(h, head) {
    const duty = (h.duty || '').trim();
    return `
      ${this._karmaHTML(h)}
      <div class="rep-dos-peek">${duty ? esc(duty) : '<span class="rep-card-muted">No brief on file.</span>'}</div>
      ${head ? `<div class="rep-dos-line">Head · ${esc(head.name)}</div>` : ''}
    `;
  }

  _renderHouseOpen(h, head) {
    const duty = (h.duty || '').trim();
    return `
      <div class="rep-dos-block">
        <div class="rep-dos-k">Apparent head</div>
        ${head ? `
          <div class="rep-head">
            ${this._memberBadgeHTML(head.id, 'Apparent head')}
            <span>${esc(head.name)}</span>
          </div>` : `<div class="rep-card-muted">No figurehead named.</div>`}
      </div>
      <div class="rep-dos-block">
        <div class="rep-dos-k">Duty</div>
        <div class="rep-dos-duty">${duty ? esc(duty) : '<span class="rep-card-muted">No brief on file.</span>'}</div>
      </div>
      <div class="rep-dos-block">
        <div class="rep-dos-k">Connections</div>
        ${this._houseConnectionsHTML(h, { composing: true })}
      </div>
      ${this._karmaHTML(h)}
      ${h.notes ? `<div class="rep-dos-notes">${esc(h.notes)}</div>` : ''}
    `;
  }

  _renderHouseEdit(h) {
    const cast = getCastMembers(this.storage).filter(c => c.priority !== 'director');
    return `
      <div class="rep-field"><label>Name / title</label>
        <input type="text" data-field="name" value="${esc(h.name)}"></div>
      <div class="rep-field"><label>Abbreviation / alias</label>
        <input type="text" data-field="alias" value="${esc(h.alias ?? '')}" placeholder="Used on tags and the web"></div>
      <div class="rep-field"><label>Authority</label>
        <input type="text" data-field="authority" value="${esc(h.authority ?? '')}" placeholder="Rank, power, relevancy in society"></div>
      <div class="rep-field">
        <label>Letterhead badge</label>
        <div class="rep-badge-edit">
          <input type="text" data-field="badge" value="${esc(h.badge ?? '')}" placeholder="Image URL or choose a file">
          <input type="file" accept="image/*" data-action="badge-file">
          <select data-field="badgeSide">
            <option value="left" ${h.badgeSide !== 'right' ? 'selected' : ''}>Badge left</option>
            <option value="right" ${h.badgeSide === 'right' ? 'selected' : ''}>Badge right</option>
          </select>
        </div>
      </div>
      <div class="rep-field">
        <label>Dossier dress</label>
        <div class="rep-dress-edit">
          <select data-field="dress">
            <option value="gradient" ${h.dress !== 'solid' && h.dress !== 'banner' ? 'selected' : ''}>Gradient</option>
            <option value="solid" ${h.dress === 'solid' ? 'selected' : ''}>Solid color</option>
            <option value="banner" ${h.dress === 'banner' ? 'selected' : ''}>Banner image</option>
          </select>
          <input type="color" data-field="colorA" value="${esc(h.colorA || '#c9a24a')}" title="Color A">
          <input type="color" data-field="colorB" value="${esc(h.colorB || '#6b4f1e')}" title="Color B">
          <input type="text" data-field="banner" value="${esc(h.banner ?? '')}" placeholder="Banner image URL">
          <input type="file" accept="image/*" data-action="banner-file">
        </div>
      </div>
      <div class="rep-field">
        <label>Apparent head</label>
        <select data-field="headId">
          <option value="">— None —</option>
          ${cast.map(m =>
            `<option value="${esc(m.id)}" ${h.headId === m.id ? 'selected' : ''}>${esc(m.name)} (${esc(priorityLabel(m.priority))})</option>`,
          ).join('')}
        </select>
      </div>
      <div class="rep-field"><label>Duty / purpose</label>
        <textarea data-field="duty" placeholder="Usual activities, responsibilities, goal...">${esc(h.duty ?? '')}</textarea></div>
      <div class="rep-field">
        <label>Connections</label>
        ${this._houseConnectionsHTML(h, { composing: true })}
      </div>
      ${this._karmaHTML(h, { editable: true })}
      <div class="rep-field"><label>Private notes</label>
        <textarea data-field="notes">${esc(h.notes ?? '')}</textarea></div>
    `;
  }

  _bindHouse(root) {
    root.querySelector('[data-action="add-house"]')?.addEventListener('click', () => this._addHouse());
    root.querySelector('[data-action="house-sort"]')?.addEventListener('change', e => {
      this.state.houseSort = e.target.value;
      this.saveState();
      this.render(this.container);
    });
    if (this._focusedHouseId) {
      requestAnimationFrame(() => {
        root.querySelector(`.rep-dos[data-id="${this._focusedHouseId}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      });
    }
    root.querySelectorAll('.rep-dos').forEach(card => {
      const h = (this.state.house ?? []).find(x => x.id === card.dataset.id);
      if (!h) return;
      card.addEventListener('click', e => {
        if (e.target.closest('.rep-letterhead-actions, .rep-dos-body input, .rep-dos-body textarea, .rep-dos-body select, .rep-dos-body button, .rep-member-x, .rep-draft')) return;
        if (this._editingHouseId === h.id) return;
        if (this._focusedHouseId === h.id) {
          if (!e.target.closest('.rep-letterhead')) return;
          this._focusedHouseId = null;
        } else {
          this._focusedHouseId = h.id;
        }
        this.render(this.container);
      });
      card.querySelector('[data-action="audit-house"]')?.addEventListener('click', e => {
        e.stopPropagation();
        this._runHouseAudit(h, e.currentTarget);
      });
      card.querySelector('[data-action="edit-house"]')?.addEventListener('click', e => {
        e.stopPropagation();
        this._houseSnap = JSON.parse(JSON.stringify({
          name: h.name, alias: h.alias, badge: h.badge, badgeSide: h.badgeSide,
          authority: h.authority, headId: h.headId, duty: h.duty,
          connections: h.connections ?? [], standing: h.standing, opinion: h.opinion, notes: h.notes,
          dress: h.dress, colorA: h.colorA, colorB: h.colorB, banner: h.banner,
        }));
        this._focusedHouseId = h.id;
        this._editingHouseId = h.id;
        this.render(this.container);
      });
      card.querySelector('[data-action="save-house"]')?.addEventListener('click', e => {
        e.stopPropagation();
        this._houseSnap = null;
        this._editingHouseId = null;
        this._focusedHouseId = h.id;
        this.saveState();
        this.bus.emit('reputation.updated', { house: h });
        this.render(this.container);
      });
      card.querySelector('[data-action="cancel-house"]')?.addEventListener('click', e => {
        e.stopPropagation();
        if (this._houseSnap) Object.assign(h, this._houseSnap);
        this._houseSnap = null;
        this._editingHouseId = null;
        this.saveState();
        this.render(this.container);
      });
      card.querySelector('[data-action="remove-house"]')?.addEventListener('click', e => {
        e.stopPropagation();
        if (!confirm(`File away the dossier for ${h.name}?`)) return;
        this.state.house = this.state.house.filter(x => x.id !== h.id);
        for (const n of this._nodes()) {
          if (n.houseId === h.id) n.houseId = '';
        }
        if (this._focusedHouseId === h.id) this._focusedHouseId = null;
        if (this._editingHouseId === h.id) this._editingHouseId = null;
        this.saveState();
        this.render(this.container);
      });
      card.querySelector('[data-action="badge-file"]')?.addEventListener('change', e => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          h.badge = String(reader.result || '');
          const url = card.querySelector('[data-field="badge"]');
          if (url) url.value = h.badge;
          this.saveState();
          const badge = card.querySelector('[data-role="badge"]');
          if (badge) badge.innerHTML = `<img src="${esc(h.badge)}" alt="">`;
        };
        reader.readAsDataURL(file);
      });
      card.querySelectorAll('[data-field]').forEach(inp => {
        const ev = inp.type === 'range' ? 'input' : 'change';
        inp.addEventListener(ev, () => {
          if (inp.dataset.field === 'standing') {
            h.standing = clamp(inp.value);
            this._paintKarma(card, h);
          } else {
            h[inp.dataset.field] = inp.value;
            if (inp.dataset.field === 'name' || inp.dataset.field === 'alias') {
              const title = card.querySelector('.rep-letterhead-title');
              if (title) title.innerHTML = this._houseTitleHTML(h);
            }
            if (inp.dataset.field === 'authority') {
              const auth = card.querySelector('.rep-letterhead-authority');
              if (auth) auth.textContent = h.authority || 'Authority unstated';
            }
            if (inp.dataset.field === 'badge') {
              const badge = card.querySelector('[data-role="badge"]');
              if (badge) {
                badge.innerHTML = h.badge
                  ? `<img src="${esc(h.badge)}" alt="">`
                  : `<span class="rep-monogram">${esc((h.alias || h.name || '?').charAt(0).toUpperCase())}</span>`;
              }
            }
            if (inp.dataset.field === 'badgeSide') {
              const headEl = card.querySelector('.rep-letterhead');
              headEl?.classList.toggle('badge-right', h.badgeSide === 'right');
              headEl?.classList.toggle('badge-left', h.badgeSide !== 'right');
            }
            if (['dress', 'colorA', 'colorB', 'banner'].includes(inp.dataset.field)) {
              const dress = card.querySelector('[data-role="dress"]');
              if (dress) dress.setAttribute('style', this._houseBannerStyle(h));
            }
          }
          this.saveState();
        });
      });
      card.querySelector('[data-action="banner-file"]')?.addEventListener('change', e => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          h.banner = String(reader.result || '');
          h.dress = 'banner';
          const url = card.querySelector('[data-field="banner"]');
          if (url) url.value = h.banner;
          const dressSel = card.querySelector('[data-field="dress"]');
          if (dressSel) dressSel.value = 'banner';
          const dress = card.querySelector('[data-role="dress"]');
          if (dress) dress.setAttribute('style', this._houseBannerStyle(h));
          this.saveState();
        };
        reader.readAsDataURL(file);
      });
      card.querySelector('[data-action="confirm-member"]')?.addEventListener('click', e => {
        e.stopPropagation();
        const id = card.querySelector('[data-draft="member"]')?.value;
        if (!id) return;
        h.connections ??= [];
        if (!h.connections.some(c => c.characterId === id)) {
          h.connections.push({
            characterId: id,
            role: card.querySelector('[data-draft="member-role"]')?.value.trim() || '',
          });
        }
        this.saveState();
        this.render(this.container);
      });
      card.querySelectorAll('[data-action="drop-member"]').forEach(btn => {
        btn.addEventListener('click', e => {
          e.stopPropagation();
          h.connections = (h.connections ?? []).filter(c => c.characterId !== btn.dataset.id);
          this.saveState();
          this.render(this.container);
        });
      });
    });
  }

  _paintKarma(card, h) {
    const info = standingInfo(h.standing);
    const v = clamp(h.standing);
    const pct = Math.abs(v) / 2;
    const fill = card.querySelector('[data-role="karma-fill"]');
    if (fill) {
      fill.style.width = `${pct}%`;
      fill.style.left = v >= 0 ? '50%' : `${50 - pct}%`;
      fill.style.background = info.color;
    }
    const lab = card.querySelector('[data-role="stand-label"]');
    if (lab) {
      lab.textContent = `${info.label} · ${v}`;
      lab.style.color = info.color;
    }
    let take = card.querySelector('[data-role="house-take"]');
    if (h.opinion) {
      if (!take) {
        take = document.createElement('div');
        take.className = 'rep-house-take';
        take.dataset.role = 'house-take';
        card.querySelector('[data-role="karma"]')?.appendChild(take);
      }
      take.textContent = h.opinion;
    } else {
      take?.remove();
    }
  }

  _addHouse() {
    const backdrop = this._buildModal(`
      <div class="rep-modal-title">HOUSE</div>
      <div class="rep-modal-subtitle">— File a new dossier —</div>
      <div class="rep-field"><label>Name / title</label>
        <input type="text" data-field="name" placeholder="The company, guild, or order..."></div>
      <div class="rep-field"><label>Abbreviation / alias</label>
        <input type="text" data-field="alias" placeholder="Short tag for the web"></div>
      <div class="rep-field"><label>Authority</label>
        <input type="text" data-field="authority" placeholder="Position, power, relevancy..."></div>
      <div class="rep-modal-actions">
        <button type="button" class="rep-btn" data-action="cancel">Cancel</button>
        <button type="button" class="rep-btn" data-action="save">File</button>
      </div>
    `);
    backdrop.querySelector('[data-action="save"]').addEventListener('click', () => {
      const name = backdrop.querySelector('[data-field="name"]').value.trim();
      if (!name) { alert('Name is required.'); return; }
      const house = {
        id: uid(),
        name,
        alias: backdrop.querySelector('[data-field="alias"]').value.trim(),
        badge: '',
        badgeSide: 'left',
        authority: backdrop.querySelector('[data-field="authority"]').value.trim(),
        headId: '',
        duty: '',
        connections: [],
        notes: '',
        standing: 0,
        opinion: '',
        dress: 'gradient',
        colorA: '#c9a24a',
        colorB: '#6b4f1e',
        banner: '',
      };
      this.state.house.push(house);
      this._focusedHouseId = house.id;
      this._editingHouseId = house.id;
      this._houseSnap = JSON.parse(JSON.stringify(house));
      this.saveState();
      this.bus.emit('reputation.updated', { house });
      backdrop.remove();
      this.render(this.container);
    });
    setTimeout(() => backdrop.querySelector('[data-field="name"]').focus(), 0);
  }

  _buildModal(inner) {
    const backdrop = document.createElement('div');
    backdrop.className = 'rep-modal-backdrop';
    backdrop.innerHTML = `<div class="rep-modal">${inner}</div>`;
    document.body.appendChild(backdrop);
    backdrop.addEventListener('click', e => { if (e.target === backdrop) backdrop.remove(); });
    backdrop.querySelector('[data-action="cancel"]')?.addEventListener('click', () => backdrop.remove());
    return backdrop;
  }
}

function uid() {
  return crypto?.randomUUID?.() ?? ('r_' + Math.random().toString(36).slice(2, 10));
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, ch =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}
