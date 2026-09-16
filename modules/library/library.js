// Library — the glossary shelf. Active lorebooks are detected and shown as
// loose entries; the user files them into sections ("cubbies") that have
// nothing to do with which book an entry came from. Lorebooks stay the source
// of truth: Library only records where an entry sits and how it is tagged.
// Entries authored here are Library's own, and only those get injected —
// SillyTavern's World Info already handles everything that lives in a book.

import { getContext } from '../../../../../extensions.js';
import {
  loadWorldInfo,
  openWorldInfoEditor,
  selected_world_info,
  world_info,
  world_names,
  METADATA_KEY,
} from '../../../../../world-info.js';
import { Module } from '../../lib/module.js';
import { getCastMembers, getCastRecords, castNameMatches, normalizeAliases } from '../../lib/castCatalog.js';
import { collectActiveLocationTags } from '../../lib/compass/state.js';
import { bindLocationTagEditor, locationTagEditorHTML, readLocationTags } from '../../lib/locationTagPicker.js';

const SEED_SECTIONS = [
  { title: 'Places & Geography', icon: '⛰', blurb: 'Cities, rooms, roads, the shape of the map.' },
  { title: 'Cultures & Peoples', icon: '❖', blurb: 'Customs, languages, faiths, how people live.' },
  { title: 'Factions & Powers', icon: '⚔', blurb: 'Houses, guilds, crowns, anyone with leverage.' },
  { title: 'Documents & Records', icon: '✎', blurb: 'Letters, ledgers, laws, things written down.' },
  { title: 'Events & History', icon: '✦', blurb: 'Wars, disasters, festivals, what already happened.' },
];

const SEED_TAG_TYPES = [
  { id: 'place',   label: 'Place',   color: '#3d7a68' },
  { id: 'culture', label: 'Culture', color: '#6b4a8a' },
  { id: 'faction', label: 'Faction', color: '#8a4a58' },
  { id: 'person',  label: 'Person',  color: '#4a5e7a' },
  { id: 'event',   label: 'Event',   color: '#8a6f2c' },
  { id: 'object',  label: 'Object',  color: '#6b5a3a' },
  { id: 'term',    label: 'Term',    color: '#5a4429' },
  { id: 'era',     label: 'Era',     color: '#7a1f1f' },
  { id: 'scene',   label: 'Scene',   color: '#4a6a8a' },
];

const SOURCE_LABELS = {
  global: 'Global',
  chat: 'Chat',
  character: 'Character',
  persona: 'Persona',
  filed: 'Filed',
};

/**
 * Entry keys travel through `data-key` attributes, so the separator has to
 * survive HTML parsing: NUL is rewritten to U+FFFD inside an attribute value,
 * which silently broke every key read back off a card.
 */
const SEP = '\u241f';
const LEGACY_SEPS = ['\u0000', '\ufffd'];
const UNSORTED = '__unsorted__';

/** Fallback cubby inks, cycled by position so no two neighbours match. */
const CUBBY_INKS = ['#8c6b3f', '#5d7a6b', '#7a5a6e', '#4f6b86', '#8a5a44', '#6b6a8c'];

export class LibraryModule extends Module {
  static id = 'library';
  static label = 'Library';
  static scope = 'chat';

  constructor(deps) {
    super(deps);
    if (!document.querySelector('link[data-showtime="library"]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = new URL('./library.css', import.meta.url).href;
      link.dataset.showtime = 'library';
      document.head.appendChild(link);
    }
    this._books = [];
    this._booksLoaded = false;
    this._loading = false;
    this._view = 'shelf';
    this._filter = { tag: '', text: '' };
    this._openKeys = new Set();
    this._openBooks = new Set();
    this._uncap = new Set();
    this._focusSection = '';
    this._looseOpen = true;
    this._flat = false;
    this._dupOnly = false;
    this._hideExtras = false;
    this._showDismissed = false;
    this._dupCache = null;
    this._shutShelves = new Set();
    this._selected = new Set();
    this._searchTimer = 0;
    this._leafCache = null;
    this._cubbyScrolls = {};
  }

  async init() {
    this._registerInjection();
  }

  async onChatChanged() {
    this._booksLoaded = false;
    this._openKeys.clear();
    this._uncap.clear();
    this._selected.clear();
    this._focusSection = '';
    this._dupCache = null;
    this._leafCache = null;
    this._filter = { tag: '', text: '' };
  }

  getDefaultState() {
    return {
      version: 2,
      seeded: false,
      sections: [],
      filing: {},
      bookFiling: {},
      adopted: [],
      native: [],
      dismissed: [],
      settings: {
        scanDepth: 4,
        injectPinned: true,
        injectKeyword: true,
      },
    };
  }

  _defaultGlobal() {
    return {
      tagTypes: structuredClone(SEED_TAG_TYPES),
      shelves: [],
      bookShelf: {},
      bookTags: {},
    };
  }

  /** Global slice — tag vocabulary plus lorebook folders and book-level tags. */
  _g() {
    const g = this.storage.getGlobal('library', this._defaultGlobal());
    g.tagTypes = Array.isArray(g.tagTypes) && g.tagTypes.length
      ? g.tagTypes
      : structuredClone(SEED_TAG_TYPES);
    if (!g.tagTypes.some(t => t.id === 'scene')) {
      g.tagTypes.push({ id: 'scene', label: 'Scene', color: '#4a6a8a' });
    }
    g.shelves ??= [];
    g.bookShelf ??= {};
    g.bookTags ??= {};
    return g;
  }

  _saveG() {
    this.storage.saveGlobal();
  }

  _save({ inject = false } = {}) {
    this.saveState();
    if (inject) this.bus?.emit('showtime.stateChanged');
  }

  _invalidate() {
    this._leafCache = null;
    this._dupCache = null;
  }

  /**
   * Twins across books: identical text is a certainty, an identical title with
   * different text is worth a look. Nothing is ever removed on Library's say-so.
   */
  _dupes() {
    if (this._dupCache) return this._dupCache;
    const flat = s => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
    const byText = new Map();
    const byTitle = new Map();
    for (const leaf of this._leaves()) {
      const text = flat(leaf.content).slice(0, 600);
      if (text.length > 24) {
        if (!byText.has(text)) byText.set(text, []);
        byText.get(text).push(leaf);
      }
      const title = flat(leaf.title);
      if (title) {
        if (!byTitle.has(title)) byTitle.set(title, []);
        byTitle.get(title).push(leaf);
      }
    }
    const byKey = new Map();
    const groups = [];
    const add = (group, kind, only) => {
      const books = [...new Set(group.map(l => l.kind === 'native' ? 'Library' : l.book))];
      const gid = groups.length;
      groups.push({ gid, kind, books, title: group[0].title, keys: group.map(l => l.key) });
      for (const leaf of only ?? group) {
        byKey.set(leaf.key, { gid, kind, count: group.length, books });
      }
    };
    for (const group of byText.values()) if (group.length > 1) add(group, 'text');
    for (const group of byTitle.values()) {
      if (group.length < 2) continue;
      // Short / generic titles ("Untitled", "Note") are not evidence of a copy.
      if (flat(group[0].title).length < 8) continue;
      const fresh = group.filter(l => !byKey.has(l.key));
      if (!fresh.length) continue;
      add(group, 'title', fresh);
    }
    const overlap = new Map();
    for (const g of groups) {
      for (const a of g.books) {
        for (const b of g.books) {
          if (a === b) continue;
          if (!overlap.has(a)) overlap.set(a, new Map());
          overlap.get(a).set(b, (overlap.get(a).get(b) ?? 0) + 1);
        }
      }
    }
    const leaves = new Map(this._leaves().map(l => [l.key, l]));
    const extras = new Set();
    const keepers = new Set();
    for (const g of groups) {
      const copies = g.keys.map(k => leaves.get(k)).filter(Boolean);
      if (copies.length < 2) continue;
      // Prefer a keeper already chosen by another twin group, then a filed
      // copy, else the first — so Hide extras never parks the "real" one.
      let keeper = copies.find(l => keepers.has(l.key));
      if (!keeper) keeper = copies.find(l => l.sectionId) ?? copies[0];
      keepers.add(keeper.key);
      for (const l of copies) if (l.key !== keeper.key) extras.add(l.key);
    }
    for (const k of keepers) extras.delete(k);
    this._dupCache = { byKey, groups, overlap, extras };
    return this._dupCache;
  }

  /** One copy stays put; the rest are the ones worth acting on. */
  _dupExtras() {
    return [...this._dupes().extras];
  }

  _bookNameFromKey(key) {
    for (const sep of [SEP, ...LEGACY_SEPS]) {
      if (key.includes(sep)) return key.split(sep)[0];
    }
    return key;
  }

  _dupBadgeHTML(leaf) {
    const rec = this._dupes().byKey.get(leaf.key);
    if (!rec) return '';
    const where = rec.books.filter(b => b !== (leaf.kind === 'native' ? 'Library' : leaf.book));
    const what = rec.kind === 'text' ? 'Same text as' : 'Same title as';
    return `<span class="lib-dup${rec.kind === 'text' ? ' hard' : ''}"
      title="${esc(`${what} ${rec.count - 1} other ${rec.count === 2 ? 'entry' : 'entries'}${where.length ? ` · also in ${where.join(', ')}` : ' · in this same book'}`)}">⧉${rec.count}</span>`;
  }

  _db() {
    const st = this.state;
    st.sections ??= [];
    st.filing ??= {};
    st.bookFiling ??= {};
    st.adopted ??= [];
    st.native ??= [];
    st.dismissed ??= [];
    st.settings ??= { scanDepth: 4, injectPinned: true, injectKeyword: true };
    if (st.version !== 2) {
      st.version = 2;
      const moved = {};
      for (const [key, rec] of Object.entries(st.filing)) {
        let fixed = key;
        for (const old of LEGACY_SEPS) fixed = fixed.split(old).join(SEP);
        moved[fixed] = rec;
      }
      st.filing = moved;
      this.saveState();
    }
    // Worldbuilding baseline, laid out once. Deleting them all is allowed.
    if (!st.seeded) {
      st.seeded = true;
      if (!st.sections.length) {
        st.sections = SEED_SECTIONS.map((s, i) => ({
          id: uid(),
          title: s.title,
          blurb: s.blurb,
          icon: s.icon,
          wide: false,
          muted: false,
          sortIndex: i,
        }));
      }
      this.saveState();
    }
    return st;
  }

  // ── lorebook detection ─────────────────────────────────────────────────────

  /** Every book this chat actually has in play, and why it is in play. */
  _detectBooks() {
    const ctx = getContext();
    const found = new Map();
    const add = (name, src) => {
      const n = String(name || '').trim();
      if (!n) return;
      if (!found.has(n)) found.set(n, new Set());
      found.get(n).add(src);
    };

    for (const n of selected_world_info ?? []) add(n, 'global');
    add(ctx.chatMetadata?.[METADATA_KEY], 'chat');

    const chid = ctx.characterId ?? ctx.this_chid;
    const char = chid != null ? (ctx.characters ?? [])[chid] : null;
    add(char?.data?.extensions?.world, 'character');
    const file = String(char?.avatar || '').replace(/\.[^.]+$/, '');
    const lore = (world_info?.charLore ?? []).find(e => e.name === file);
    for (const b of lore?.extraBooks ?? []) add(b, 'character');

    add(ctx.powerUserSettings?.persona_description_lorebook, 'persona');

    // Books the user filed or pulled in stay visible even out of play.
    const st = this._db();
    for (const name of st.adopted) add(name, 'filed');
    for (const name of Object.keys(st.bookFiling)) add(name, 'filed');
    // Only revive a book from a filing key if it is a real lorebook — a
    // mangled separator used to invent ghost copies of the same book.
    const known = new Set(world_names ?? []);
    for (const key of Object.keys(st.filing)) {
      const name = this._bookNameFromKey(key);
      if (known.has(name) || found.has(name)) add(name, 'filed');
    }

    return found;
  }

  async _loadBooks() {
    if (this._loading) return;
    this._loading = true;
    try {
      const detected = this._detectBooks();
      const results = await Promise.allSettled(
        [...detected.keys()].map(name => loadWorldInfo(name).then(wi => ({ name, wi }))),
      );
      const seen = new Set();
      this._books = results
        .filter(r => r.status === 'fulfilled' && r.value?.wi)
        .map(({ value: { name, wi } }) => {
          const raw = wi.entries ?? {};
          const entries = (Array.isArray(raw) ? raw : Object.values(raw))
            .filter(Boolean)
            .map(e => ({ ...e, uid: String(e.uid) }));
          return { name, sources: [...(detected.get(name) ?? [])], entries };
        })
        .filter(b => {
          if (seen.has(b.name)) return false;
          seen.add(b.name);
          return true;
        })
        .sort((a, b) => a.name.localeCompare(b.name));
      this._leafCache = null;
      this._booksLoaded = true;
    } finally {
      this._loading = false;
    }
  }

  /** Books on disk that this chat is not using — offer-to-file candidates. */
  _dormantBooks() {
    const live = new Set(this._books.map(b => b.name));
    return (world_names ?? []).filter(n => !live.has(n));
  }

  // ── tags ───────────────────────────────────────────────────────────────────

  _tagTypes() {
    return this._g().tagTypes;
  }

  _tagType(id) {
    return this._tagTypes().find(t => t.id === id) ?? null;
  }

  _normalizeTags(list) {
    const out = [];
    const seen = new Set();
    for (const raw of list ?? []) {
      const type = String(raw?.type || '').trim();
      const value = String(raw?.value ?? raw?.text ?? '').trim();
      if (!type || !value) continue;
      const key = `${type}${SEP}${value.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ type, value });
    }
    return out;
  }

  /** An entry carries its own tags plus whatever its book is tagged with. */
  _effectiveTags(leaf) {
    const own = this._normalizeTags(leaf.tags);
    if (leaf.kind !== 'linked') return own;
    const book = this._normalizeTags(this._g().bookTags[leaf.book]);
    const seen = new Set(own.map(t => `${t.type}${SEP}${t.value.toLowerCase()}`));
    return [
      ...own,
      ...book
        .filter(t => !seen.has(`${t.type}${SEP}${t.value.toLowerCase()}`))
        .map(t => ({ ...t, inherited: true })),
    ];
  }

  _tagChipHTML(tag, { removable = false } = {}) {
    const type = this._tagType(tag.type);
    const color = type?.color || 'var(--st-sepia)';
    const label = type?.label || tag.type;
    return `<span class="lib-tag${tag.inherited ? ' inherited' : ''}" style="border-color:${esc(color)};color:${esc(color)}"
      data-type="${esc(tag.type)}" data-value="${esc(tag.value)}"
      title="${esc(label)}${tag.inherited ? ' — from the lorebook' : ''}">${esc(label)} · ${esc(tag.value)}${
      removable ? ' <button type="button" class="lib-tag-x">×</button>' : ''}</span>`;
  }

  /** Every tag in play, counted, for the filter bar. */
  _tagIndex(leaves) {
    const map = new Map();
    for (const leaf of leaves) {
      for (const tag of this._effectiveTags(leaf)) {
        const key = `${tag.type}${SEP}${tag.value}`;
        const rec = map.get(key) ?? { type: tag.type, value: tag.value, count: 0 };
        rec.count++;
        map.set(key, rec);
      }
    }
    const order = this._tagTypes().map(t => t.id);
    return [...map.values()].sort((a, b) =>
      order.indexOf(a.type) - order.indexOf(b.type)
      || b.count - a.count
      || a.value.localeCompare(b.value));
  }

  _uniqueNames(list) {
    const out = [];
    const seen = new Set();
    for (const raw of list || []) {
      const s = String(raw || '').trim();
      if (!s) continue;
      const k = s.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(s);
    }
    return out;
  }

  _tagsOfType(type) {
    return this._uniqueNames(
      this._tagIndex(this._leaves())
        .filter(t => t.type === type)
        .map(t => t.value));
  }

  _tagTypeLabel(typeId) {
    return this._tagType(typeId)?.label || typeId || 'tag';
  }

  /** Established values for any tag type — special sources for place/person/faction, else in-use tags (+ Script facets where they map). */
  _knownValuesForType(type) {
    const id = String(type || '');
    if (id === 'place') return this._knownPlaceNames();
    if (id === 'person') return this._personSuggestEntries();
    if (id === 'faction') return this._knownFactionNames();
    const bag = [...this._tagsOfType(id)];
    try {
      const g = this._g();
      for (const list of Object.values(g.bookTags || {})) {
        for (const t of this._normalizeTags(list)) {
          if (t.type === id) bag.push(t.value);
        }
      }
    } catch { /* ignore */ }
    try {
      const script = this.storage.getChat('script', {});
      for (const card of script?.cards || []) {
        if (card?.kind === 'folder') continue;
        if (id === 'object') {
          for (const o of card?.keywordFacets?.objects || []) bag.push(o);
        } else if (id === 'era') {
          for (const d of card?.keywordFacets?.datetime || []) bag.push(d);
          if (card?.timeKey) bag.push(card.timeKey);
        } else if (id === 'scene') {
          const codes = card?.sceneCodes || card?.codes;
          if (Array.isArray(codes)) codes.forEach(c => bag.push(c));
          else if (card?.title) bag.push(card.title);
        }
      }
    } catch { /* ignore */ }
    return this._uniqueNames(bag);
  }

  _canonicalValueForType(type, raw) {
    const id = String(type || '');
    if (id === 'place') return this._canonicalPlaceName(raw);
    if (id === 'person') return this._canonicalPersonName(raw);
    if (id === 'faction') return this._canonicalFactionName(raw);
    const n = String(raw || '').trim();
    if (!n) return '';
    const hit = this._knownValuesForType(id).find(t => t.toLowerCase() === n.toLowerCase());
    return hit || n;
  }

  _knownPlaceNames() {
    const bag = [];
    try { bag.push(...collectActiveLocationTags(this.storage)); } catch { /* ignore */ }
    bag.push(...this._tagsOfType('place'));
    try {
      const script = this.storage.getChat('script', {});
      for (const card of script?.cards || []) {
        if (card?.kind === 'folder' || card?.active === false) continue;
        for (const loc of card?.keywordFacets?.location || []) bag.push(loc);
      }
    } catch { /* ignore */ }
    try {
      const st = this.storage.getChat('backstage', {});
      const rooms = st?.stage?.rooms || {};
      for (const p of Object.values(rooms)) {
        if (p?.name) bag.push(p.name);
        for (const t of p?.locationTags || []) bag.push(t);
      }
    } catch { /* ignore */ }
    return this._uniqueNames(bag);
  }

  _knownPersonNames() {
    return this._uniqueNames(this._personSuggestEntries().map(e => e.value));
  }

  /**
   * Person suggest rows: cast primary names + tagged alter egos.
   * Alter-ego rows display as "Ego · Cast Name" but file the cast name.
   * Aliases/nicknames are search-only (not listed).
   */
  _personSuggestEntries() {
    const entries = [];
    const seenRows = new Set();
    const push = ({ value, label, keys = [] }) => {
      const v = String(value || '').trim();
      const lab = String(label || v).trim() || v;
      if (!v) return;
      const rowKey = `${v.toLowerCase()}\0${lab.toLowerCase()}`;
      if (seenRows.has(rowKey)) return;
      seenRows.add(rowKey);
      entries.push({
        value: v,
        label: lab,
        keys: this._uniqueNames([v, lab, ...keys]),
      });
    };
    try {
      for (const c of getCastRecords(this.storage)) {
        if (!c || c.priority === 'director') continue;
        const name = String(c.name || '').trim();
        if (!name) continue;
        const aliasKeys = normalizeAliases(c.aliases);
        push({ value: name, label: name, keys: aliasKeys });
        const tagged = new Set((c.taggedAlterEgos || []).map(String));
        for (const ego of c.alterEgoIndex || []) {
          const id = String(ego?.id || '');
          const egoName = String(ego?.name || '').trim();
          if (!egoName) continue;
          if (tagged.size && !tagged.has(id)) continue;
          if (egoName.toLowerCase() === name.toLowerCase()) continue;
          // Listed for picking; value always the cast member.
          push({
            value: name,
            label: `${egoName} · ${name}`,
            keys: [egoName, name, ...aliasKeys],
          });
        }
      }
    } catch { /* ignore */ }
    // Script credits → cast primary when known; otherwise keep the credit name.
    try {
      const script = this.storage.getChat('script', {});
      for (const card of script?.cards || []) {
        if (card?.kind === 'folder') continue;
        for (const cr of card?.credits || []) {
          const raw = String(cr?.name || '').trim();
          if (!raw) continue;
          const canon = this._canonicalPersonName(raw);
          push({ value: canon, label: canon, keys: [raw, canon] });
        }
      }
    } catch { /* ignore */ }
    // Existing person tags that aren't already covered by cast primaries.
    for (const t of this._tagsOfType('person')) {
      const canon = this._canonicalPersonName(t);
      push({ value: canon, label: canon, keys: [t, canon] });
    }
    try {
      const g = this._g();
      for (const list of Object.values(g.bookTags || {})) {
        for (const t of this._normalizeTags(list)) {
          if (t.type !== 'person') continue;
          const canon = this._canonicalPersonName(t.value);
          push({ value: canon, label: canon, keys: [t.value, canon] });
        }
      }
    } catch { /* ignore */ }
    return entries;
  }

  _canonicalPersonName(raw) {
    const n = String(raw || '').trim();
    if (!n) return '';
    // "Ego · Cast Name" rows from the suggest list
    const split = n.match(/^(.+?)\s*[·•]\s*(.+)$/);
    if (split) {
      const viaCast = this._canonicalPersonName(split[2]);
      if (viaCast) return viaCast;
    }
    try {
      const hit = getCastRecords(this.storage).find(c =>
        c?.priority !== 'director' && castNameMatches(c, n));
      if (hit?.name) return String(hit.name).trim();
    } catch { /* ignore */ }
    try {
      const hit = getCastMembers(this.storage).find(m => castNameMatches(m, n));
      if (hit?.name) return String(hit.name).trim();
    } catch { /* ignore */ }
    return n;
  }

  _canonicalPlaceName(raw) {
    const n = String(raw || '').trim();
    if (!n) return '';
    const hit = this._knownPlaceNames().find(t => t.toLowerCase() === n.toLowerCase());
    return hit || n;
  }

  _reputationFactions() {
    const houses = [];
    const groups = [];
    try {
      const rep = this.storage.getChat('reputation', { personal: [], house: [] }) || {};
      for (const h of rep.house || []) {
        const name = String(h.name || '').trim();
        const alias = String(h.alias || '').trim();
        if (name) houses.push({ name, alias, id: h.id });
      }
      for (const n of rep.personal || []) {
        if (!n || n.kind === 'self' || n.id === 'self') continue;
        if (n.category !== 'group') continue;
        const name = String(n.name || '').trim();
        if (name) groups.push({ name, id: n.id, houseId: String(n.houseId || '') });
      }
    } catch { /* ignore */ }
    return { houses, groups };
  }

  /** True when `short` is that house's alias or an initialism of its full name. */
  _isFactionShorthand(short, house) {
    const s = String(short || '').trim();
    const full = String(house?.name || '').trim();
    const alias = String(house?.alias || '').trim();
    if (!s || !full) return false;
    if (s.toLowerCase() === full.toLowerCase()) return false;
    if (alias && s.toLowerCase() === alias.toLowerCase()) return true;
    const compact = s.replace(/[^a-z0-9]/gi, '');
    if (compact.length < 2 || compact.length > 8) return false;
    const words = full.split(/[\s\-/]+/).filter(Boolean);
    const skip = /^(of|the|and|a|an|&)$/i;
    const initialsAll = words.map(w => w[0]).join('');
    const initialsSig = words.filter(w => !skip.test(w)).map(w => w[0]).join('');
    const c = compact.toLowerCase();
    return c === initialsAll.toLowerCase() || c === initialsSig.toLowerCase();
  }

  _factionDisplayName(raw, { houses, groups } = this._reputationFactions()) {
    const n = String(raw || '').trim();
    if (!n) return '';
    const low = n.toLowerCase();
    for (const h of houses) {
      if (h.name.toLowerCase() === low || (h.alias && h.alias.toLowerCase() === low)
        || this._isFactionShorthand(n, h)) return h.name;
    }
    for (const g of groups) {
      if (g.name.toLowerCase() !== low) continue;
      const linked = houses.find(h => h.id && h.id === g.houseId);
      if (linked) return linked.name;
      const byAlias = houses.find(h => this._isFactionShorthand(g.name, h));
      if (byAlias) return byAlias.name;
      return g.name;
    }
    return n;
  }

  _knownFactionNames() {
    const { houses, groups } = this._reputationFactions();
    const bag = [];
    const pushFull = (raw) => {
      const full = this._factionDisplayName(raw, { houses, groups });
      if (!full) return;
      if (houses.some(h => this._isFactionShorthand(full, h))) return;
      bag.push(full);
    };
    for (const h of houses) pushFull(h.name);
    for (const g of groups) {
      const linked = houses.find(h => h.id && h.id === g.houseId);
      if (linked) { pushFull(linked.name); continue; }
      if (houses.some(h => this._isFactionShorthand(g.name, h))) continue;
      pushFull(g.name);
    }
    try {
      const script = this.storage.getChat('script', {});
      for (const card of script?.cards || []) {
        if (card?.kind === 'folder') continue;
        for (const sp of card?.sponsors || []) {
          if ((sp?.kind !== 'house' && sp?.kind !== 'dossier') || !sp.name) continue;
          pushFull(sp.name);
        }
      }
    } catch { /* ignore */ }
    return this._uniqueNames(bag);
  }

  _canonicalFactionName(raw) {
    const n = String(raw || '').trim();
    if (!n) return '';
    const full = this._factionDisplayName(n);
    return full || n;
  }

  _guessTagType(value) {
    const v = String(value || '').trim();
    if (!v) return 'term';
    const low = v.toLowerCase();
    if (this._knownPlaceNames().some(n => n.toLowerCase() === low)) return 'place';
    try {
      if (getCastRecords(this.storage).some(c =>
        c?.priority !== 'director' && castNameMatches(c, v))) return 'person';
    } catch { /* ignore */ }
    if (this._knownPersonNames().some(n => n.toLowerCase() === low)) return 'person';
    {
      const { houses, groups } = this._reputationFactions();
      if (houses.some(h => h.name.toLowerCase() === low || (h.alias && h.alias.toLowerCase() === low))
        || groups.some(g => g.name.toLowerCase() === low)
        || this._knownFactionNames().some(n => n.toLowerCase() === low)) return 'faction';
    }
    const existing = this._tagIndex(this._leaves()).find(t => t.value.toLowerCase() === low);
    if (existing) return existing.type;
    return this._tagType('term') ? 'term' : (this._tagTypes()[0]?.id || 'term');
  }

  _scriptTagCandidates({ mention = '' } = {}) {
    const needle = String(mention || '').toLowerCase().replace(/\s+/g, ' ').trim();
    const out = [];
    const seen = new Set();
    const push = (type, value, from) => {
      const v = this._canonicalValueForType(type, String(value || '').trim());
      if (!v || !this._tagType(type)) return;
      const key = `${type}${SEP}${v.toLowerCase()}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ type, value: v, from });
    };
    const cardMentions = (card) => {
      if (!needle) return true;
      const bits = [
        card?.title,
        ...(card?.keywords || []),
        ...(card?.keywordFacets?.location || []),
        ...(card?.credits || []).map(c => c?.name),
      ].map(s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim()).filter(s => s.length >= 3);
      if (needle.length < 3) return false;
      return bits.some(s => s.includes(needle) || needle.includes(s));
    };
    try {
      const script = this.storage.getChat('script', {});
      for (const card of script?.cards || []) {
        if (card?.kind === 'folder') continue;
        if (!cardMentions(card)) continue;
        const from = String(card.title || 'Untitled').trim() || 'Untitled';
        for (const loc of card?.keywordFacets?.location || []) push('place', loc, from);
        for (const obj of card?.keywordFacets?.objects || []) push('object', obj, from);
        for (const dt of card?.keywordFacets?.datetime || []) push('era', dt, from);
        for (const cr of card?.credits || []) push('person', cr?.name, from);
        for (const sp of card?.sponsors || []) {
          if ((sp?.kind === 'house' || sp?.kind === 'dossier') && sp.name) {
            push('faction', sp.name, from);
          }
        }
      }
    } catch { /* ignore */ }
    const order = this._tagTypes().map(t => t.id);
    return out.sort((a, b) =>
      order.indexOf(a.type) - order.indexOf(b.type) || a.value.localeCompare(b.value));
  }

  _appendTagChips(tagWrap, tags) {
    if (!tagWrap) return 0;
    const existing = new Set([...tagWrap.querySelectorAll('.lib-tag')].map(el =>
      `${el.dataset.type}${SEP}${String(el.dataset.value).toLowerCase()}`));
    let n = 0;
    for (const t of this._normalizeTags(tags)) {
      const key = `${t.type}${SEP}${t.value.toLowerCase()}`;
      if (existing.has(key)) continue;
      existing.add(key);
      tagWrap.querySelector('.lib-hint')?.remove();
      tagWrap.insertAdjacentHTML('beforeend', this._tagChipHTML(t, { removable: true }));
      n++;
    }
    if (!tagWrap.querySelector('.lib-tag')) {
      tagWrap.innerHTML = '<span class="lib-hint">None</span>';
    }
    return n;
  }

  _mergeTagsOnLeaves(keys, tags) {
    const add = this._normalizeTags(tags);
    if (!add.length) return 0;
    let touched = 0;
    for (const key of keys || []) {
      const leaf = this._leafByKey(key);
      if (!leaf) continue;
      const before = this._normalizeTags(leaf.tags);
      const next = this._normalizeTags([...before, ...add]);
      if (next.length === before.length) continue;
      this._setLeafTags(key, next);
      touched++;
    }
    return touched;
  }

  // ── entries ────────────────────────────────────────────────────────────────

  _entryKey(book, uid) {
    return `${book}${SEP}${uid}`;
  }

  _entryTitle(e) {
    const keys = Array.isArray(e.key) ? e.key.join(', ') : e.key;
    return String(e.comment || keys || 'Untitled').trim();
  }

  _entryKeys(e) {
    const primary = Array.isArray(e.key) ? e.key : (e.key ? [e.key] : []);
    const secondary = Array.isArray(e.keysecondary) ? e.keysecondary : [];
    return [...primary, ...secondary].map(k => String(k).trim()).filter(Boolean);
  }

  /** One flat list of everything the shelf can hold. */
  _leaves() {
    if (this._leafCache) return this._leafCache;
    const st = this._db();
    const sections = new Map((st.sections || []).map(s => [s.id, s]));
    const out = [];
    for (const book of this._books) {
      const bookDefault = st.bookFiling[book.name] ?? '';
      for (const e of book.entries) {
        const key = this._entryKey(book.name, e.uid);
        const filed = st.filing[key];
        const sectionId = filed && filed.sectionId !== undefined
          ? filed.sectionId
          : bookDefault;
        const sid = sectionId || '';
        out.push({
          kind: 'linked',
          key,
          book: book.name,
          uid: e.uid,
          title: this._entryTitle(e),
          content: String(e.content || ''),
          keys: this._entryKeys(e),
          constant: !!e.constant,
          disabled: !!e.disable,
          sectionId: sid,
          sectionTitle: sid ? (sections.get(sid)?.title || '') : '',
          tags: filed?.tags ?? [],
          note: filed?.note || '',
          sortIndex: filed?.sortIndex ?? 0,
        });
      }
    }
    for (const n of st.native) {
      const sid = n.sectionId || '';
      out.push({
        kind: 'native',
        key: `native${SEP}${n.id}`,
        id: n.id,
        book: '',
        title: String(n.title || 'Untitled'),
        content: String(n.content || ''),
        keys: Array.isArray(n.keywords) ? n.keywords : [],
        constant: !!n.pinned,
        disabled: n.active === false,
        sectionId: sid,
        sectionTitle: sid ? (sections.get(sid)?.title || '') : '',
        tags: n.tags ?? [],
        note: String(n.note || ''),
        sortIndex: n.sortIndex ?? 0,
      });
    }
    this._leafCache = out;
    return out;
  }

  _leafByKey(key) {
    return this._leaves().find(l => l.key === key) ?? null;
  }

  _section(id) {
    return this._db().sections.find(s => s.id === id) ?? null;
  }

  _sections() {
    return [...this._db().sections].sort((a, b) =>
      (a.sortIndex ?? 0) - (b.sortIndex ?? 0) || String(a.title).localeCompare(String(b.title)));
  }

  _fileLeaf(key, sectionId) {
    const st = this._db();
    if (key.startsWith(`native${SEP}`)) {
      const id = key.slice(`native${SEP}`.length);
      const rec = st.native.find(n => n.id === id);
      if (rec) rec.sectionId = sectionId === UNSORTED ? '' : sectionId;
    } else {
      const rec = st.filing[key] ?? (st.filing[key] = { tags: [] });
      rec.sectionId = sectionId === UNSORTED ? '' : sectionId;
    }
    this._invalidate();
    this._save({ inject: key.startsWith(`native${SEP}`) });
  }

  _setLeafTags(key, tags) {
    const st = this._db();
    const clean = this._normalizeTags(tags);
    if (key.startsWith(`native${SEP}`)) {
      const rec = st.native.find(n => n.id === key.slice(`native${SEP}`.length));
      if (rec) rec.tags = clean;
    } else {
      const rec = st.filing[key] ?? (st.filing[key] = {});
      rec.tags = clean;
      if (rec.sectionId === undefined) rec.sectionId = st.bookFiling[key.split(SEP)[0]] ?? '';
    }
    this._invalidate();
    this._save({ inject: key.startsWith(`native${SEP}`) });
  }

  // ── filtering ──────────────────────────────────────────────────────────────

  _matches(leaf) {
    const text = this._filter.text.trim().toLowerCase();
    if (text) {
      const hay = `${leaf.title} ${leaf.book} ${leaf.keys.join(' ')}`.toLowerCase();
      if (!hay.includes(text) && !String(leaf.content || '').toLowerCase().includes(text)) return false;
    }
    const pick = this._filter.tag;
    if (pick) {
      const [type, value] = pick.split(SEP);
      const want = String(value || '').toLowerCase();
      if (!this._effectiveTags(leaf).some(t => t.type === type && t.value.toLowerCase() === want)) return false;
    }
    if (this._dupOnly && !this._dupes().byKey.has(leaf.key)) return false;
    if (this._view === 'shelf' && this._hideExtras && this._dupes().extras.has(leaf.key)) return false;
    const dismissed = (this._db().dismissed || []).includes(leaf.key);
    if (this._showDismissed) return dismissed;
    if (dismissed) return false;
    return true;
  }

  _filterActive() {
    return !!(this._filter.tag || this._filter.text.trim() || this._dupOnly || this._hideExtras);
  }

  // ── render ─────────────────────────────────────────────────────────────────

  async render(container) {
    this.container = container;
    if (!this._booksLoaded && !this._loading) {
      container.innerHTML = `<div class="lib-root"><div class="lib-boot">Reading the shelves…</div></div>`;
      await this._loadBooks();
    }
    this._paint();
  }

  _paint() {
    const container = this.container;
    if (!container) return;
    const keepBoard = container.querySelector('.lib-board')?.scrollTop ?? this._boardScroll ?? 0;
    const keepLoose = container.querySelector('.lib-loose-body')?.scrollTop ?? this._looseScroll ?? 0;
    const keepBooks = container.querySelector('.lib-books')?.scrollTop ?? this._booksScroll ?? 0;
    const keepBulk = container.querySelector('.lib-bulk-list')?.scrollTop ?? this._bulkScroll ?? 0;
    const keepFlat = container.querySelector('.lib-flat-body')?.scrollTop ?? this._flatScroll ?? 0;
    // Focused cubbies (and grid cubbies) scroll inside .lib-cubby-body — not .lib-board.
    const keepBodies = { ...(this._cubbyScrolls || {}) };
    container.querySelectorAll('.lib-cubby[data-section] .lib-cubby-body').forEach(el => {
      const id = el.closest('[data-section]')?.dataset.section;
      if (id) keepBodies[id] = el.scrollTop;
    });
    const leaves = this._leaves();
    container.innerHTML = `
      <div class="lib-root">
        ${this._topHTML(leaves)}
        <main class="lib-body">
          ${this._view === 'books' ? this._booksHTML(leaves)
            : this._view === 'bulk' ? this._bulkHTML(leaves)
            : this._shelfHTML(leaves)}
        </main>
        ${this._statusHTML(leaves)}
      </div>`;
    // Bind the freshly built root, not the persistent container: the container
    // survives every paint, so listeners would stack and fire once per paint.
    this._bind(container.querySelector('.lib-root'));
    const board = container.querySelector('.lib-board');
    if (board) {
      board.scrollTop = keepBoard;
      this._boardScroll = keepBoard;
      board.addEventListener('scroll', () => { this._boardScroll = board.scrollTop; }, { passive: true });
    }
    const loose = container.querySelector('.lib-loose-body');
    if (loose) {
      loose.scrollTop = keepLoose;
      this._looseScroll = keepLoose;
      loose.addEventListener('scroll', () => { this._looseScroll = loose.scrollTop; }, { passive: true });
    }
    const books = container.querySelector('.lib-books');
    if (books) {
      books.scrollTop = keepBooks;
      this._booksScroll = keepBooks;
      books.addEventListener('scroll', () => { this._booksScroll = books.scrollTop; }, { passive: true });
    }
    const bulk = container.querySelector('.lib-bulk-list');
    if (bulk) {
      bulk.scrollTop = keepBulk;
      this._bulkScroll = keepBulk;
      bulk.addEventListener('scroll', () => { this._bulkScroll = bulk.scrollTop; }, { passive: true });
    }
    const flat = container.querySelector('.lib-flat-body');
    if (flat) {
      flat.scrollTop = keepFlat;
      this._flatScroll = keepFlat;
      flat.addEventListener('scroll', () => { this._flatScroll = flat.scrollTop; }, { passive: true });
    }
    this._cubbyScrolls = keepBodies;
    container.querySelectorAll('.lib-cubby[data-section] .lib-cubby-body').forEach(el => {
      const id = el.closest('[data-section]')?.dataset.section;
      if (!id) return;
      const y = keepBodies[id] || 0;
      el.scrollTop = y;
      el.addEventListener('scroll', () => {
        this._cubbyScrolls[id] = el.scrollTop;
      }, { passive: true });
    });
  }

  _topHTML(leaves) {
    return `
      <header class="lib-top">
        <span class="lib-brand">Library</span>
        <nav class="lib-tabs">
          <button type="button" class="lib-tab${this._view === 'shelf' ? ' on' : ''}" data-view="shelf">Shelf</button>
          <button type="button" class="lib-tab${this._view === 'books' ? ' on' : ''}" data-view="books">Lorebooks</button>
          <button type="button" class="lib-tab${this._view === 'bulk' ? ' on' : ''}" data-view="bulk">Bulk</button>
        </nav>
        <input type="search" class="lib-search" data-role="search" placeholder="Search titles, keys, text…"
          value="${esc(this._filter.text)}">
        ${this._view === 'books' ? '' : this._sortHTML(leaves)}
        <div class="lib-top-actions">
          ${this._view === 'shelf' ? `
            <button type="button" class="lib-btn small${this._flat ? ' gold' : ''}" data-action="toggle-flat"
              title="${this._flat ? 'Back to cubbies' : 'Cards only — one flat list of whatever matches'}">${this._flat ? 'Cubbies' : 'Cards only'}</button>
            <button type="button" class="lib-btn small${this._dupOnly ? ' gold' : ''}" data-action="toggle-dupes"
              title="Only entries that have a twin in another book (or the same one)">Twins</button>
            <button type="button" class="lib-btn small${this._hideExtras ? ' gold' : ''}" data-action="toggle-extras"
              title="Hide every extra copy — keep the filed one, or the first">Hide extras</button>
            <button type="button" class="lib-btn small" data-action="add-section">＋ Cubby</button>
            <button type="button" class="lib-btn small" data-action="add-entry">＋ Entry</button>` : ''}
          <button type="button" class="lib-btn small" data-action="tag-types" title="Rename or add tag types">Tags</button>
          <button type="button" class="lib-btn small" data-action="settings" title="Activation settings">⚙</button>
          <button type="button" class="lib-btn small" data-action="reload" title="Re-read lorebooks">⟳</button>
        </div>
      </header>`;
  }

  _sortHTML(leaves) {
    const index = this._tagIndex(leaves);
    if (!index.length) return '';
    const groups = new Map();
    for (const t of index) {
      if (!groups.has(t.type)) groups.set(t.type, []);
      groups.get(t.type).push(t);
    }
    return `
      <label class="lib-sort">
        <span class="lib-k">Show</span>
        <select data-role="sort">
          <option value="">All cubbies</option>
          ${[...groups].map(([type, tags]) => {
            const label = this._tagType(type)?.label || type;
            return `<optgroup label="${esc(label)}">${tags.map(t => {
              const key = `${t.type}${SEP}${t.value}`;
              return `<option value="${esc(key)}" ${this._filter.tag === key ? 'selected' : ''}>${esc(t.value)} (${t.count})</option>`;
            }).join('')}</optgroup>`;
          }).join('')}
        </select>
      </label>`;
  }

  _shelfHTML(leaves) {
    const sections = this._sections();
    const visible = leaves.filter(l => this._matches(l));
    if (this._flat) return this._flatHTML(visible);
    const byId = new Map(sections.map(s => [s.id, []]));
    const loose = [];
    for (const leaf of visible) {
      if (leaf.sectionId && byId.has(leaf.sectionId)) byId.get(leaf.sectionId).push(leaf);
      else loose.push(leaf);
    }
    const hideEmpty = this._filterActive();
    const focus = this._focusSection ? sections.find(s => s.id === this._focusSection) : null;
    const shown = focus
      ? [focus]
      : sections.filter(s => !hideEmpty || (byId.get(s.id) ?? []).length);
    const cubbies = shown
      .map((s, i) => this._cubbyHTML(s, byId.get(s.id) ?? [], {
        index: sections.indexOf(s),
        focused: !!focus,
      }))
      .join('');
    const showLoose = !focus && (!hideEmpty || loose.length);
    return `
      <div class="lib-stage">
        <div class="lib-board${focus ? ' focused' : ''}">
          ${cubbies || `<div class="lib-empty">${hideEmpty
            ? 'No cubby holds a card with that tag.'
            : 'No cubbies yet. Press <strong>＋ Cubby</strong>.'}</div>`}
        </div>
        ${showLoose ? this._looseHTML(loose) : ''}
      </div>`;
  }

  /** Cubbies out of the way: just the cards that match, wherever they live. */
  _flatHTML(visible) {
    const titles = new Map(this._sections().map(s => [s.id, s]));
    const sorted = [...visible].sort((a, b) =>
      String(titles.get(a.sectionId)?.title ?? '~').localeCompare(String(titles.get(b.sectionId)?.title ?? '~'))
      || a.title.localeCompare(b.title));
    const cap = this._uncap.has('__flat__') ? sorted.length : 80;
    const shown = sorted.slice(0, cap);
    const rest = sorted.length - shown.length;
    return `
      <div class="lib-stage">
        <div class="lib-flat">
          <div class="lib-flat-head">
            <span class="lib-cubby-title">Cards only</span>
            <span class="lib-cubby-count">${sorted.length}</span>
            <span class="lib-hint">${this._filterActive()
              ? 'Everything matching your filter, cubbies set aside.'
              : 'Every entry in one list. Narrow it with Show or the search box.'}</span>
          </div>
          <div class="lib-flat-body">
            ${shown.length
              ? shown.map(l => `
                <div class="lib-flat-row">
                  <span class="lib-flat-where" title="Cubby">${esc(titles.get(l.sectionId)?.title || 'Unsorted')}</span>
                  ${this._leafHTML(l, { compact: true, peek: true })}
                </div>`).join('')
              : `<div class="lib-cubby-empty">Nothing matches.</div>`}
            ${rest > 0 ? `<button type="button" class="lib-more" data-action="uncap" data-section="__flat__">+ ${rest} more</button>` : ''}
          </div>
        </div>
      </div>`;
  }

  /** Each cubby gets its own ink so the grid is readable at a glance. */
  _accent(section, index) {
    if (/^#[0-9a-f]{6}$/i.test(section.color || '')) return section.color;
    return CUBBY_INKS[(index < 0 ? 0 : index) % CUBBY_INKS.length];
  }

  _looseHTML(leaves) {
    const sorted = [...leaves].sort((a, b) =>
      (a.sortIndex ?? 0) - (b.sortIndex ?? 0) || a.title.localeCompare(b.title));
    const cap = this._uncap.has(UNSORTED) ? sorted.length : 48;
    const shown = sorted.slice(0, cap);
    const rest = sorted.length - shown.length;
    const shut = !this._looseOpen;
    return `
      <section class="lib-loose${shut ? ' shut' : ''}" data-section="${UNSORTED}">
        <header class="lib-loose-head">
          <span class="lib-cubby-icon">⁙</span>
          <span class="lib-cubby-title">Unsorted</span>
          <span class="lib-cubby-count">${sorted.length}</span>
          <span class="lib-hint">Not filed yet — Move, or drag onto a cubby.</span>
          <button type="button" class="lib-icon" data-action="toggle-loose"
            title="${shut ? 'Show the unsorted pile' : 'Collapse — give the cubbies the whole panel'}">${shut ? '▴' : '▾'}</button>
        </header>
        ${shut ? '' : `
          <div class="lib-loose-body">
            ${shown.length
              ? shown.map(l => this._leafHTML(l, { compact: true, peek: true })).join('')
              : `<div class="lib-cubby-empty">Nothing loose — every detected entry is filed.</div>`}
            ${rest > 0 ? `<button type="button" class="lib-more" data-action="uncap" data-section="${UNSORTED}">+ ${rest} more</button>` : ''}
          </div>`}
      </section>`;
  }

  _cubbyHTML(section, leaves, { index = 0, focused = false } = {}) {
    const sorted = [...leaves].sort((a, b) =>
      (a.sortIndex ?? 0) - (b.sortIndex ?? 0) || a.title.localeCompare(b.title));
    const cap = this._uncap.has(section.id) || focused ? sorted.length : 24;
    const shown = sorted.slice(0, cap);
    const rest = sorted.length - shown.length;
    const ink = this._accent(section, index);
    return `
      <section class="lib-cubby${section.muted ? ' muted' : ''}${focused ? ' focus' : ''}"
        data-section="${esc(section.id)}" style="border-top-color:${esc(ink)}">
        <header class="lib-cubby-head" style="background:${esc(ink)}1f">
          <span class="lib-cubby-icon" style="color:${esc(ink)}">${esc(section.icon || '◈')}</span>
          <span class="lib-cubby-title">${esc(section.title)}</span>
          <span class="lib-cubby-count">${sorted.length}</span>
          <button type="button" class="lib-icon" data-action="focus-section" title="${focused ? 'Back to the grid' : 'Open this cubby on its own'}">${focused ? '⤡' : '⤢'}</button>
          <button type="button" class="lib-icon" data-action="edit-section" title="Rename, recolour, mute">✎</button>
          <button type="button" class="lib-icon danger" data-action="drop-section" title="Remove cubby (entries go to Unsorted)">✕</button>
        </header>
        ${section.blurb && focused ? `<div class="lib-cubby-blurb">${esc(section.blurb)}</div>` : ''}
        ${section.muted ? `<div class="lib-cubby-mute">Muted</div>` : ''}
        <div class="lib-cubby-body">
          ${shown.length
            ? shown.map(l => this._leafHTML(l, { compact: true, peek: focused })).join('')
            : `<div class="lib-cubby-empty">${esc(section.blurb || 'Empty.')}</div>`}
          ${rest > 0 ? `<button type="button" class="lib-more" data-action="uncap" data-section="${esc(section.id)}">+ ${rest} more</button>` : ''}
        </div>
      </section>`;
  }

  _leafHTML(leaf, { compact = false, peek: wantPeek = false } = {}) {
    const open = this._openKeys.has(leaf.key);
    const tags = open ? this._effectiveTags(leaf) : [];
    const peek = wantPeek && !open ? clip(leaf.content, 110) : '';
    // Inside a third-width cubby there is only room for the name; source and
    // summary belong to the wider strips, and to the tooltip.
    const dense = compact && !wantPeek && !open;
    const src = leaf.kind === 'native' ? 'Written in Library' : leaf.book;
    return `
      <article class="lib-entry${open ? ' on' : ''}${compact && !open ? ' compact' : ''}${dense ? ' dense' : ''}${leaf.kind === 'native' ? ' native' : ''}${leaf.disabled ? ' off' : ''}"
        data-key="${esc(leaf.key)}"${dense ? ` title="${esc([src, ...leaf.keys.slice(0, 4)].join(' · '))}"` : ''}>
        <div class="lib-entry-row">
          <span class="lib-entry-mark" title="${leaf.kind === 'native' ? 'Written in Library' : 'Lives in a lorebook'}">${leaf.kind === 'native' ? '◆' : '◇'}</span>
          <span class="lib-entry-title">${esc(leaf.title)}</span>
          ${this._dupBadgeHTML(leaf)}
          ${leaf.constant ? `<span class="lib-entry-flag" title="Always on">★</span>` : ''}
          ${dense
            ? `<button type="button" class="lib-icon lib-move-btn" data-action="move-pick" title="Move to a cubby">⇄</button>`
            : `<button type="button" class="lib-btn small lib-move-btn" data-action="move-pick" title="Move to a cubby">Move</button>`}
        </div>
        ${open || dense ? '' : `
          <div class="lib-entry-meta">
            ${leaf.kind === 'native'
              ? `<span class="lib-entry-src native">Library</span>`
              : `<span class="lib-entry-src" title="Lorebook">${esc(leaf.book)}</span>`}
            ${leaf.keys.length ? `<span class="lib-entry-keys" title="${esc(leaf.keys.join(', '))}">${esc(leaf.keys.slice(0, 3).join(' · '))}${leaf.keys.length > 3 ? ' …' : ''}</span>` : ''}
          </div>
          ${peek ? `<div class="lib-entry-peek">${esc(peek)}</div>` : ''}`}
        ${open && tags.length ? `<div class="lib-entry-tags">${tags.map(t => this._tagChipHTML(t)).join('')}</div>` : ''}
        ${open ? `
          <div class="lib-entry-open">
            <div class="lib-entry-src-line">
              ${leaf.kind === 'native'
                ? 'Written in Library'
                : `From lorebook <strong>${esc(leaf.book)}</strong>`}
              ${leaf.disabled ? ' · disabled in the book' : ''}
            </div>
            ${leaf.keys.length ? `<div class="lib-entry-keyline"><span class="lib-k">Keys</span> ${esc(leaf.keys.join(' · '))}</div>` : ''}
            <div class="lib-entry-body">${esc(leaf.content) || '<span class="lib-hint">No text.</span>'}</div>
            ${leaf.note ? `<div class="lib-entry-note">${esc(leaf.note)}</div>` : ''}
            <div class="lib-entry-actions">
              <button type="button" class="lib-btn small" data-action="tag-leaf">Tags</button>
              <button type="button" class="lib-btn small" data-action="note-leaf">Note</button>
              ${leaf.kind === 'native'
                ? `<button type="button" class="lib-btn small" data-action="edit-native">Edit</button>
                   <button type="button" class="lib-btn small danger" data-action="drop-native">Delete</button>`
                : `<button type="button" class="lib-btn small" data-action="open-book" title="Open this lorebook in SillyTavern">Open book</button>`}
            </div>
          </div>` : ''}
      </article>`;
  }

  _booksHTML(leaves) {
    const g = this._g();
    const st = this._db();
    const counts = new Map();
    for (const leaf of leaves) {
      if (leaf.kind !== 'linked') continue;
      const rec = counts.get(leaf.book) ?? { total: 0, filed: 0 };
      rec.total++;
      if (leaf.sectionId) rec.filed++;
      counts.set(leaf.book, rec);
    }
    const shelves = [...g.shelves].sort((a, b) => (a.sortIndex ?? 0) - (b.sortIndex ?? 0));
    const groups = [
      ...shelves.map(sh => ({ shelf: sh, books: this._books.filter(b => g.bookShelf[b.name] === sh.id) })),
      { shelf: null, books: this._books.filter(b => !g.bookShelf[b.name] || !shelves.some(s => s.id === g.bookShelf[b.name])) },
    ];
    const dormant = this._dormantBooks();
    return `
      <div class="lib-books">
        <div class="lib-books-head">
          <span class="lib-hint">Folders and book tags are global — they follow the lorebook into every chat. Cubbies and filing are per chat.</span>
          <button type="button" class="lib-btn small" data-action="add-shelf">＋ Folder</button>
        </div>
        ${groups.filter(gr => gr.books.length || gr.shelf).map(gr => this._folderHTML({
          id: gr.shelf ? gr.shelf.id : '__loose__',
          title: gr.shelf ? gr.shelf.label : 'Unfoldered',
          count: gr.books.length,
          tools: gr.shelf ? `
            <button type="button" class="lib-icon" data-action="rename-shelf" data-shelf="${esc(gr.shelf.id)}" title="Rename folder">✎</button>
            <button type="button" class="lib-icon danger" data-action="drop-shelf" data-shelf="${esc(gr.shelf.id)}" title="Remove folder">✕</button>` : '',
          body: gr.books.length
            ? gr.books.map(b => this._bookHTML(b, counts.get(b.name) ?? { total: 0, filed: 0 })).join('')
            : `<div class="lib-cubby-empty">No books in this folder yet.</div>`,
        })).join('')}
        ${dormant.length ? this._folderHTML({
          id: '__dormant__',
          title: 'Not in play',
          count: dormant.length,
          body: `
            <div class="lib-dormant">
              ${dormant.map(n => `<button type="button" class="lib-btn small" data-action="adopt-book" data-book="${esc(n)}" title="Pull this book onto the shelf">${esc(n)}</button>`).join('')}
            </div>
            <div class="lib-hint">These exist on disk but this chat is not using them. Pulling one in only shows it here — it does not activate it in SillyTavern.</div>`,
        }) : ''}
        ${st.native.length ? this._folderHTML({
          id: '__native__',
          title: 'Written in Library',
          count: st.native.length,
          body: `<div class="lib-hint">These are Library's own entries — the only ones it injects.</div>`,
        }) : ''}
      </div>`;
  }

  _folderHTML({ id, title, count, tools = '', body }) {
    const open = !this._shutShelves.has(id);
    return `
      <section class="lib-shelf${open ? '' : ' shut'}" data-shelf="${esc(id)}">
        <header class="lib-shelf-head">
          <button type="button" class="lib-book-toggle" data-action="toggle-shelf" data-shelf="${esc(id)}"
            title="${open ? 'Collapse' : 'Expand'}">${open ? '▾' : '▸'}</button>
          <span class="lib-shelf-title">${esc(title)}</span>
          <span class="lib-cubby-count">${count}</span>
          ${tools}
        </header>
        ${open ? body : ''}
      </section>`;
  }

  /** Pick many, then move or tag them in one go. */
  _bulkHTML(leaves) {
    const sections = new Map(this._sections().map(s => [s.id, s]));
    const dupes = this._dupes();
    let shown = leaves.filter(l => this._matches(l));
    if (this._dupOnly) shown = shown.filter(l => dupes.byKey.has(l.key));
    shown.sort((a, b) => this._dupOnly
      ? (dupes.byKey.get(a.key).gid - dupes.byKey.get(b.key).gid) || a.book.localeCompare(b.book)
      : a.title.localeCompare(b.title));
    const picked = shown.filter(l => this._selected.has(l.key)).length;
    return `
      <div class="lib-bulk">
        <div class="lib-bulk-bar">
          <span class="lib-bulk-count" data-role="bulk-count">${picked} of ${shown.length} picked</span>
          <button type="button" class="lib-btn small" data-action="bulk-all">Select all</button>
          <button type="button" class="lib-btn small" data-action="bulk-none">None</button>
          <span class="lib-bulk-gap"></span>
          <button type="button" class="lib-btn small${this._dupOnly ? ' gold' : ''}" data-action="bulk-dupes"
            title="Only entries that have a twin somewhere">⧉ Duplicates${dupes.byKey.size ? ` (${dupes.byKey.size})` : ''}</button>
          ${this._dupOnly ? `<button type="button" class="lib-btn small" data-action="bulk-extras" title="Pick every copy except the one already filed">Pick extras</button>` : ''}
          ${this._dupOnly ? `<button type="button" class="lib-btn small danger" data-action="bulk-park-extras" title="Move extras into a muted Duplicates cubby">Park extras</button>` : ''}
          <button type="button" class="lib-btn small danger" data-action="bulk-dismiss-extras" title="Hide linked extras from the shelf — World Info untouched">Dismiss extras</button>
          ${(this._db().dismissed || []).length
            ? `<button type="button" class="lib-btn small${this._showDismissed ? ' gold' : ''}" data-action="toggle-dismissed" title="${this._showDismissed ? 'Select rows then click to restore, or click with none selected to leave' : 'Browse dismissed extras'}">${this._showDismissed ? 'Restore selected / close' : `Dismissed (${this._db().dismissed.length})`}</button>`
            : ''}
          <button type="button" class="lib-btn small gold" data-action="bulk-move">Move to…</button>
          <button type="button" class="lib-btn small" data-action="bulk-tag">＋ Tag</button>
          <button type="button" class="lib-btn small" data-action="bulk-untag">− Tag</button>
          <button type="button" class="lib-btn small" data-action="bulk-keys-tags" title="Turn each entry's World Info keys into typed tags">Keys → tags</button>
          <button type="button" class="lib-btn small" data-action="bulk-from-script" title="Copy Place / Person / Object tags off matching Script cards">From Script</button>
          <button type="button" class="lib-btn small danger" data-action="bulk-delete-natives" title="Permanently delete Library-written copies only">Delete Library copies</button>
        </div>
        <div class="lib-hint lib-bulk-hint">${this._dupOnly
          ? 'Copies sit together. <strong>⧉</strong> filled = identical text; hollow = same title. <strong>Dismiss extras</strong> hides linked twins from the shelf (lorebooks untouched). <strong>Park extras</strong> shelves them in a muted cubby. <strong>Delete Library copies</strong> only removes ◆ natives you wrote here.'
          : 'Search and <strong>Show</strong> narrow the list — Select all takes only what you can see. <strong>Dismiss extras</strong> hides linked duplicate clutter. Cubbies can be removed with ✕ — contents return to Unsorted.'}</div>
        <div class="lib-bulk-list">
          ${shown.length ? shown.map((l, i) => {
            const on = this._selected.has(l.key);
            const rec = dupes.byKey.get(l.key);
            const prev = i > 0 ? dupes.byKey.get(shown[i - 1].key) : null;
            const head = this._dupOnly && rec && (!prev || prev.gid !== rec.gid);
            return `
              ${head ? `<div class="lib-bulk-group">${esc(l.title)} — ${rec.count} copies${rec.kind === 'text' ? ', identical text' : ', same title only'}</div>` : ''}
              <label class="lib-bulk-row${on ? ' on' : ''}">
                <input type="checkbox" data-role="pick" data-key="${esc(l.key)}" ${on ? 'checked' : ''}>
                <span class="lib-entry-mark">${l.kind === 'native' ? '◆' : '◇'}</span>
                <span class="lib-bulk-title" title="${esc(l.keys.join(', '))}">${esc(l.title)}</span>
                ${this._dupOnly ? '' : this._dupBadgeHTML(l)}
                <span class="lib-bulk-where">${esc(sections.get(l.sectionId)?.title || 'Unsorted')}</span>
                <span class="lib-bulk-src">${esc(l.kind === 'native' ? 'Library' : l.book)}</span>
              </label>`;
          }).join('') : `<div class="lib-cubby-empty">${this._dupOnly ? 'No duplicates found.' : 'Nothing matches.'}</div>`}
        </div>
      </div>`;
  }

  _bulkKeys({ quiet = false } = {}) {
    const keys = this._leaves().filter(l => this._selected.has(l.key)).map(l => l.key);
    if (!keys.length && !quiet) alert('Pick at least one entry first.');
    return keys;
  }

  /** Selected bulk keys, or all twin extras when nothing is selected. */
  _selectedOrDupExtras() {
    const picked = this._bulkKeys({ quiet: true });
    return picked.length ? picked : this._dupExtras();
  }

  /** "This book is mostly a copy of that one" — said plainly, never acted on. */
  _overlapHTML(name, total) {
    const shared = this._dupes().overlap.get(name);
    if (!shared?.size) return '';
    const rows = [...shared].sort((a, b) => b[1] - a[1]);
    return `
      <div class="lib-overlap">
        <span class="lib-dup hard">⧉</span>
        ${rows.map(([other, n]) => {
          const pct = total ? Math.round((n / total) * 100) : 0;
          return `<span class="lib-overlap-bit">${n} also in <strong>${esc(other)}</strong>${pct >= 60 ? ` — ${pct}% of this book` : ''}</span>`;
        }).join('')}
      </div>`;
  }

  _bookHTML(book, count) {
    const g = this._g();
    const open = this._openBooks.has(book.name);
    const sections = this._sections();
    const filedTo = this._db().bookFiling[book.name] || '';
    const tags = this._normalizeTags(g.bookTags[book.name]);
    return `
      <article class="lib-book${open ? ' on' : ''}" data-book="${esc(book.name)}">
        <header class="lib-book-head">
          <button type="button" class="lib-book-toggle" data-action="toggle-book">${open ? '▾' : '▸'}</button>
          <span class="lib-book-name">${esc(book.name)}</span>
          <span class="lib-book-badges">
            ${book.sources.map(s => `<span class="lib-badge src-${esc(s)}">${esc(SOURCE_LABELS[s] || s)}</span>`).join('')}
          </span>
          <span class="lib-cubby-count" title="Filed / total entries">${count.filed}/${count.total}</span>
        </header>
        ${this._overlapHTML(book.name, count.total)}
        <div class="lib-book-row">
          <label class="lib-move">
            <span class="lib-k">File whole book</span>
            <select data-action="file-book">
              <option value="${UNSORTED}" ${filedTo ? '' : 'selected'}>— Leave unsorted —</option>
              ${sections.map(s =>
                `<option value="${esc(s.id)}" ${s.id === filedTo ? 'selected' : ''}>${esc(s.title)}</option>`).join('')}
            </select>
          </label>
          <button type="button" class="lib-btn small" data-action="tag-book">Book tags</button>
          <label class="lib-move">
            <span class="lib-k">Folder</span>
            <select data-action="shelve-book">
              <option value="">— None —</option>
              ${g.shelves.map(sh =>
                `<option value="${esc(sh.id)}" ${g.bookShelf[book.name] === sh.id ? 'selected' : ''}>${esc(sh.label)}</option>`).join('')}
            </select>
          </label>
          <button type="button" class="lib-btn small" data-action="open-book">Open in ST</button>
          ${this._db().adopted.includes(book.name)
            ? `<button type="button" class="lib-btn small danger" data-action="release-book" title="Stop showing this book here">Release</button>`
            : ''}
        </div>
        ${tags.length ? `<div class="lib-entry-tags">${tags.map(t => this._tagChipHTML(t)).join('')}</div>` : ''}
        ${open ? `
          <div class="lib-book-entries">
            ${book.entries.length ? book.entries.map(e => {
              const key = this._entryKey(book.name, e.uid);
              const filing = this._db().filing[key];
              const sectionId = filing && filing.sectionId !== undefined ? filing.sectionId : filedTo;
              return `
                <div class="lib-book-entry" data-key="${esc(key)}">
                  <span class="lib-book-entry-title" title="${esc(this._entryKeys(e).join(', '))}">${esc(this._entryTitle(e))}</span>
                  ${this._dupBadgeHTML(this._leafByKey(key) ?? { key })}
                  <select data-action="file-entry">
                    <option value="${UNSORTED}" ${sectionId ? '' : 'selected'}>— Unsorted —</option>
                    ${sections.map(s =>
                      `<option value="${esc(s.id)}" ${s.id === sectionId ? 'selected' : ''}>${esc(s.title)}</option>`).join('')}
                  </select>
                </div>`;
            }).join('') : `<div class="lib-cubby-empty">This book has no entries.</div>`}
          </div>` : ''}
      </article>`;
  }

  _statusHTML(leaves) {
    const st = this._db();
    const filed = leaves.filter(l => l.sectionId).length;
    const twins = this._dupes().groups.length;
    const bits = [
      `${leaves.length} entr${leaves.length === 1 ? 'y' : 'ies'}`,
      `${filed} filed`,
      `${this._books.length} book${this._books.length === 1 ? '' : 's'} in play`,
      `${st.native.length} written here`,
    ];
    if (twins) bits.push(`${twins} twin group${twins === 1 ? '' : 's'}`);
    return `<footer class="lib-status">${bits.join(' · ')}</footer>`;
  }

  // ── binding ────────────────────────────────────────────────────────────────

  _bind(root) {
    root.addEventListener('click', e => this._onRootClick(e));
    root.addEventListener('change', e => this._onRootChange(e));
    root.addEventListener('pointerdown', e => {
      const card = e.target.closest('.lib-entry');
      if (!card || !root.contains(card)) return;
      if (e.target.closest('button, select, label, input')) return;
      this._onEntryPointerDown(e, card, card.dataset.key);
    });
    const search = root.querySelector('[data-role="search"]');
    search?.addEventListener('input', () => {
      this._filter.text = search.value;
      clearTimeout(this._searchTimer);
      this._searchTimer = setTimeout(() => this._paint(), 180);
    });
  }

  _onRootClick(e) {
    const act = e.target.closest('[data-action], [data-view]');
    if (act?.dataset.view) {
      this._view = act.dataset.view;
      this._paint();
      return;
    }
    const action = act?.dataset.action;
    if (action === 'add-section') return this._openSectionEditor(null);
    if (action === 'add-entry') return this._openNativeEditor(null);
    if (action === 'tag-types') return this._openTagTypes();
    if (action === 'settings') return this._openSettings();
    if (action === 'reload') {
      this._booksLoaded = false;
      return void this._loadBooks().then(() => this._paint());
    }
    if (action === 'add-shelf') {
      const label = prompt('Folder name', 'Worldbuilding');
      if (!label?.trim()) return;
      const g = this._g();
      g.shelves.push({ id: uid(), label: label.trim(), sortIndex: g.shelves.length });
      this._saveG();
      this._paint();
      return;
    }
    if (action === 'toggle-flat') {
      this._flat = !this._flat;
      this._focusSection = '';
      this._paint();
      return;
    }
    if (action === 'toggle-dupes') {
      this._dupOnly = !this._dupOnly;
      this._paint();
      return;
    }
    if (action === 'toggle-extras') {
      this._hideExtras = !this._hideExtras;
      this._paint();
      return;
    }
    if (action === 'toggle-shelf') {
      const id = act.dataset.shelf;
      if (this._shutShelves.has(id)) this._shutShelves.delete(id);
      else this._shutShelves.add(id);
      this._paint();
      return;
    }
    if (action === 'bulk-all') {
      const dupes = this._dupes();
      for (const leaf of this._leaves()) {
        if (!this._matches(leaf)) continue;
        if (this._dupOnly && !dupes.byKey.has(leaf.key)) continue;
        this._selected.add(leaf.key);
      }
      this._paint();
      return;
    }
    if (action === 'bulk-dupes') {
      this._dupOnly = !this._dupOnly;
      this._paint();
      return;
    }
    if (action === 'bulk-extras') {
      this._selected = new Set(this._dupExtras());
      this._paint();
      return;
    }
    if (action === 'bulk-park-extras') {
      this._parkDuplicateExtras();
      return;
    }
    if (action === 'bulk-dismiss-extras') {
      this._dismissDuplicateExtras();
      return;
    }
    if (action === 'toggle-dismissed') {
      if (this._showDismissed) {
        const keys = this._bulkKeys().filter(k => (this._db().dismissed || []).includes(k));
        if (keys.length) {
          const st = this._db();
          const drop = new Set(keys);
          st.dismissed = (st.dismissed || []).filter(k => !drop.has(k));
          this._selected.clear();
          this._save();
          this._showDismissed = false;
          this._paint();
          return;
        }
        this._showDismissed = false;
      } else {
        this._showDismissed = true;
        this._dupOnly = false;
      }
      this._paint();
      return;
    }
    if (action === 'bulk-delete-natives') {
      this._bulkDeleteNatives();
      return;
    }
    if (action === 'bulk-none') {
      this._selected.clear();
      this._paint();
      return;
    }
    if (action === 'bulk-move') return this._openBulkMove();
    if (action === 'bulk-tag') return this._openBulkTag();
    if (action === 'bulk-untag') return this._openBulkUntag();
    if (action === 'bulk-keys-tags') return this._openBulkConvertKeys();
    if (action === 'bulk-from-script') return this._openBulkExtractScript();
    if (action === 'toggle-loose') {
      this._looseOpen = !this._looseOpen;
      this._paint();
      return;
    }
    if (action === 'focus-section') {
      const id = act.closest('.lib-cubby')?.dataset.section;
      this._focusSection = this._focusSection === id ? '' : id;
      this._paint();
      return;
    }
    if (action === 'edit-section') {
      const id = act.closest('.lib-cubby')?.dataset.section;
      const section = this._section(id);
      if (section) this._openSectionEditor(section);
      return;
    }
    if (action === 'drop-section') {
      this._dropSection(act.closest('.lib-cubby')?.dataset.section);
      return;
    }
    if (action === 'uncap') {
      this._uncap.add(act.dataset.section);
      this._paint();
      return;
    }
    const card = e.target.closest('.lib-entry');
    const key = card?.dataset.key;
    if (action === 'move-pick' && key) {
      this._openMovePicker(key);
      return;
    }
    if (action === 'tag-leaf' && key) {
      const leaf = this._leafByKey(key);
      if (leaf) this._openTagEditor(leaf);
      return;
    }
    if (action === 'note-leaf' && key) {
      this._editNote(key);
      return;
    }
    if (action === 'edit-native' && key) {
      const rec = this._db().native.find(n => `native${SEP}${n.id}` === key);
      if (rec) this._openNativeEditor(rec);
      return;
    }
    if (action === 'drop-native' && key) {
      this._dropNative(key);
      return;
    }
    if (action === 'open-book') {
      const name = act.closest('.lib-book')?.dataset.book || this._leafByKey(key)?.book;
      if (name) this._openBook(name);
      return;
    }
    if (action === 'toggle-book') {
      const name = act.closest('.lib-book')?.dataset.book;
      if (!name) return;
      if (this._openBooks.has(name)) this._openBooks.delete(name);
      else this._openBooks.add(name);
      this._paint();
      return;
    }
    if (action === 'tag-book') {
      const name = act.closest('.lib-book')?.dataset.book;
      if (name) this._openBookTagEditor(name);
      return;
    }
    if (action === 'release-book') {
      const name = act.closest('.lib-book')?.dataset.book;
      const st = this._db();
      st.adopted = st.adopted.filter(n => n !== name);
      this._invalidate();
      this._save();
      this._booksLoaded = false;
      return void this._loadBooks().then(() => this._paint());
    }
    if (action === 'adopt-book') {
      const name = act.dataset.book;
      const st = this._db();
      if (name && !st.adopted.includes(name)) st.adopted.push(name);
      this._invalidate();
      this._save();
      this._booksLoaded = false;
      this._openBooks.add(name);
      return void this._loadBooks().then(() => this._paint());
    }
    if (action === 'rename-shelf') {
      const g = this._g();
      const sh = g.shelves.find(s => s.id === act.dataset.shelf);
      if (!sh) return;
      const next = prompt('Folder name', sh.label);
      if (!next?.trim()) return;
      sh.label = next.trim();
      this._saveG();
      this._paint();
      return;
    }
    if (action === 'drop-shelf') {
      const g = this._g();
      const id = act.dataset.shelf;
      if (!confirm('Remove this folder? The books inside stay on the shelf.')) return;
      g.shelves = g.shelves.filter(s => s.id !== id);
      for (const [book, sid] of Object.entries(g.bookShelf)) {
        if (sid === id) delete g.bookShelf[book];
      }
      this._saveG();
      this._paint();
      return;
    }
    if (action) return;
    if (!card || card.dataset.dragged === '1') return;
    if (e.target.closest('button, select, label, input')) return;
    if (this._openKeys.has(key)) this._openKeys.delete(key);
    else this._openKeys.add(key);
    this._refreshEntry(card, key);
  }

  _onRootChange(e) {
    const el = e.target;
    if (el.dataset.role === 'pick') {
      const key = el.dataset.key;
      if (el.checked) this._selected.add(key);
      else this._selected.delete(key);
      el.closest('.lib-bulk-row')?.classList.toggle('on', el.checked);
      this._refreshBulkCount();
      return;
    }
    if (el.dataset.role === 'sort') {
      this._filter.tag = el.value;
      this._paint();
      return;
    }
    if (el.dataset.action === 'move-leaf') {
      this._fileLeaf(el.closest('.lib-entry')?.dataset.key, el.value);
      this._paint();
      return;
    }
    if (el.dataset.action === 'file-book') {
      const name = el.closest('.lib-book')?.dataset.book;
      const st = this._db();
      if (el.value === UNSORTED) delete st.bookFiling[name];
      else st.bookFiling[name] = el.value;
      for (const [key, rec] of Object.entries(st.filing)) {
        if (key.split(SEP)[0] === name && !rec.tags?.length && !rec.note) delete st.filing[key];
      }
      this._invalidate();
      this._save();
      this._paint();
      return;
    }
    if (el.dataset.action === 'shelve-book') {
      const name = el.closest('.lib-book')?.dataset.book;
      const g = this._g();
      if (el.value) g.bookShelf[name] = el.value;
      else delete g.bookShelf[name];
      this._saveG();
      this._paint();
      return;
    }
    if (el.dataset.action === 'file-entry') {
      this._fileLeaf(el.closest('[data-key]')?.dataset.key, el.value);
      this._paint();
    }
  }

  _refreshEntry(card, key) {
    const leaf = this._leafByKey(key);
    if (!leaf || !card) return this._paint();
    const compact = !!card.closest('.lib-cubby, .lib-loose');
    const peek = !!card.closest('.lib-loose, .lib-cubby.focus');
    card.outerHTML = this._leafHTML(leaf, { compact, peek });
  }

  _dropSection(id) {
    const section = this._section(id);
    if (!section || !confirm(`Remove “${section.title}”? Its entries go back to Unsorted — nothing is deleted from any lorebook.`)) return;
    const st = this._db();
    if (this._focusSection === id) this._focusSection = '';
    st.sections = st.sections.filter(s => s.id !== id);
    for (const rec of Object.values(st.filing)) {
      if (rec.sectionId === id) rec.sectionId = '';
    }
    for (const [book, sid] of Object.entries(st.bookFiling)) {
      if (sid === id) delete st.bookFiling[book];
    }
    for (const n of st.native) {
      if (n.sectionId === id) n.sectionId = '';
    }
    this._invalidate();
    this._save();
    this._paint();
  }

  _editNote(key) {
    const leaf = this._leafByKey(key);
    if (!leaf) return;
    const next = prompt('Shelf note — yours, never injected', leaf.note || '');
    if (next == null) return;
    const st = this._db();
    if (leaf.kind === 'linked') {
      const rec = st.filing[key] ?? (st.filing[key] = { tags: [] });
      rec.note = next.trim();
      if (rec.sectionId === undefined) rec.sectionId = st.bookFiling[leaf.book] ?? '';
    } else if (leaf.kind === 'native') {
      const rec = st.native.find(n => n.id === leaf.id);
      if (rec) rec.note = next.trim();
    }
    this._invalidate();
    this._save();
    this._paint();
  }

  _dropNative(key) {
    const st = this._db();
    const rec = st.native.find(n => `native${SEP}${n.id}` === key);
    if (!rec || !confirm(`Delete “${rec.title}”? This one is Library's own, so it is gone for good.`)) return;
    st.native = st.native.filter(n => n.id !== rec.id);
    this._openKeys.delete(key);
    this._invalidate();
    this._save({ inject: true });
    this._paint();
  }

  /** Muted cubby that holds duplicate linked copies without touching World Info. */
  _duplicatesCubby() {
    const st = this._db();
    let cubby = (st.sections || []).find(s => s.id === 'duplicates' || /^duplicates$/i.test(s.title));
    if (cubby) {
      cubby.muted = true;
      return cubby;
    }
    cubby = {
      id: 'duplicates',
      title: 'Duplicates',
      blurb: 'Parked twin copies — lorebooks untouched. Delete natives from Bulk if you wrote them here.',
      icon: '⧉',
      color: '#8a7a5a',
      wide: false,
      muted: true,
      sortIndex: 999,
    };
    st.sections.push(cubby);
    return cubby;
  }

  _parkDuplicateExtras() {
    const keys = this._selectedOrDupExtras();
    if (!keys.length) { alert('No extras to park — flip on Duplicates and Pick extras first.'); return; }
    const cubby = this._duplicatesCubby();
    let moved = 0;
    let skippedNative = 0;
    for (const key of keys) {
      const leaf = this._leafByKey(key);
      if (!leaf) continue;
      if (leaf.kind === 'native') { skippedNative += 1; continue; }
      this._fileLeaf(key, cubby.id);
      moved += 1;
    }
    this._selected.clear();
    this._invalidate();
    this._save();
    this._paint();
    alert(`Parked ${moved} linked extra${moved === 1 ? '' : 's'} in “Duplicates”.${skippedNative ? ` ${skippedNative} Library-written copy/copies were left selected — use Delete Library copies for those.` : ''}`);
  }

  /** Hide linked extras from the shelf without touching World Info. */
  _dismissDuplicateExtras() {
    const keys = this._selectedOrDupExtras();
    if (!keys.length) {
      alert('No extras to dismiss — open Duplicates, Pick extras, or select linked twins first.');
      return;
    }
    const st = this._db();
    st.dismissed ??= [];
    let hid = 0;
    let skippedNative = 0;
    for (const key of keys) {
      const leaf = this._leafByKey(key);
      if (!leaf) continue;
      if (leaf.kind === 'native') { skippedNative += 1; continue; }
      if (!st.dismissed.includes(key)) {
        st.dismissed.push(key);
        hid += 1;
      }
    }
    this._selected.clear();
    this._showDismissed = false;
    this._invalidate();
    this._save();
    this._paint();
    alert(`Dismissed ${hid} linked extra${hid === 1 ? '' : 's'} from view.${skippedNative ? ` ${skippedNative} Library-written copy/copies were left — use Delete Library copies for those.` : ''} Use Dismissed (…) then select + click again to restore.` );
  }

  _bulkDeleteNatives() {
    const keys = this._bulkKeys().filter(k => String(k).startsWith(`native${SEP}`));
    if (!keys.length) {
      alert('Select Library-written (◆) copies only. Linked lorebook entries cannot be deleted from here.');
      return;
    }
    if (!confirm(`Permanently delete ${keys.length} Library-written entr${keys.length === 1 ? 'y' : 'ies'}? Lorebooks are not touched.`)) return;
    const st = this._db();
    const drop = new Set(keys.map(k => k.slice(`native${SEP}`.length)));
    st.native = (st.native || []).filter(n => !drop.has(n.id));
    for (const k of keys) this._openKeys.delete(k);
    this._selected.clear();
    this._invalidate();
    this._save({ inject: true });
    this._paint();
  }

  /** Ghost + rectangle hit-test — host chrome eats HTML5 DnD and elementFromPoint. */
  _onEntryPointerDown(e, el, key) {
    if (e.button != null && e.button !== 0) return;
    if (e.target.closest('button, select, label, input')) return;
    el.dataset.dragged = '0';
    const startX = e.clientX;
    const startY = e.clientY;
    const from = el.closest('[data-section]')?.dataset.section || '';
    let dragging = false;
    let ghost = null;
    const move = ev => {
      if (!dragging) {
        if (Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) < 6) return;
        dragging = true;
        el.dataset.dragged = '1';
        this._dragKey = key;
        el.classList.add('dragging');
        this.container?.querySelector('.lib-root')?.classList.add('dragging');
        ghost = document.createElement('div');
        ghost.className = 'lib-ghost';
        ghost.textContent = el.querySelector('.lib-entry-title')?.textContent || 'Entry';
        document.body.appendChild(ghost);
      }
      if (ghost) {
        ghost.style.left = `${ev.clientX + 12}px`;
        ghost.style.top = `${ev.clientY + 8}px`;
      }
      this._highlightCubbyAt(ev.clientX, ev.clientY);
    };
    const up = ev => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      ghost?.remove();
      el.classList.remove('dragging');
      this.container?.querySelector('.lib-root')?.classList.remove('dragging');
      const dest = dragging ? this._cubbyAt(ev.clientX, ev.clientY) : '';
      this._clearCubbyHighlights();
      this._dragKey = null;
      if (dragging && dest && dest !== from) {
        this._fileLeaf(key, dest);
        this._paint();
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  _cubbyAt(x, y) {
    const spots = this.container?.querySelectorAll('.lib-cubby, .lib-loose') ?? [];
    for (const el of spots) {
      const r = el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
        return el.dataset.section || '';
      }
    }
    return '';
  }

  _highlightCubbyAt(x, y) {
    const dest = this._cubbyAt(x, y);
    this.container?.querySelectorAll('.lib-cubby, .lib-loose').forEach(el => {
      el.classList.toggle('drop', el.dataset.section === dest);
    });
  }

  _clearCubbyHighlights() {
    this.container?.querySelectorAll('.lib-cubby.drop, .lib-loose.drop').forEach(el => el.classList.remove('drop'));
  }

  _openBook(name) {
    try {
      openWorldInfoEditor(name);
    } catch (err) {
      console.error('[Library] open lorebook', err);
      alert(`Could not open “${name}” in SillyTavern.`);
    }
  }

  // ── modals ─────────────────────────────────────────────────────────────────

  _openMovePicker(key) {
    const leaf = this._leafByKey(key);
    if (!leaf) return;
    const backdrop = this._modal(`
      <div class="lib-modal-title">MOVE</div>
      <div class="lib-modal-sub">— ${esc(leaf.title)} —</div>
      <div class="lib-move-list">
        <button type="button" class="lib-btn" data-dest="${UNSORTED}">Unsorted</button>
        ${this._sections().map(s =>
          `<button type="button" class="lib-btn${s.id === leaf.sectionId ? ' gold' : ''}" data-dest="${esc(s.id)}">${esc(s.icon || '◈')} ${esc(s.title)}</button>`).join('')}
      </div>
      <div class="lib-modal-actions">
        <button type="button" class="lib-btn" data-action="cancel">Cancel</button>
      </div>`);
    backdrop.querySelector('.lib-move-list').addEventListener('click', e => {
      const dest = e.target.closest('[data-dest]')?.dataset.dest;
      if (!dest) return;
      backdrop.remove();
      const current = leaf.sectionId || UNSORTED;
      if (dest !== current) {
        this._fileLeaf(key, dest);
        this._paint();
      }
    });
  }

  _refreshBulkCount() {
    const el = this.container?.querySelector('[data-role="bulk-count"]');
    if (!el) return;
    const shown = this._leaves().filter(l => this._matches(l));
    const picked = shown.filter(l => this._selected.has(l.key)).length;
    el.textContent = `${picked} of ${shown.length} picked`;
  }

  _openBulkMove() {
    const keys = this._bulkKeys();
    if (!keys.length) return;
    const backdrop = this._modal(`
      <div class="lib-modal-title">MOVE ${keys.length}</div>
      <div class="lib-modal-sub">— every picked entry lands in the same cubby —</div>
      <div class="lib-move-list">
        <button type="button" class="lib-btn" data-dest="${UNSORTED}">Unsorted</button>
        ${this._sections().map(s =>
          `<button type="button" class="lib-btn" data-dest="${esc(s.id)}">${esc(s.icon || '◈')} ${esc(s.title)}</button>`).join('')}
      </div>
      <div class="lib-modal-actions">
        <button type="button" class="lib-btn" data-action="cancel">Cancel</button>
      </div>`);
    backdrop.querySelector('.lib-move-list').addEventListener('click', e => {
      const dest = e.target.closest('[data-dest]')?.dataset.dest;
      if (!dest) return;
      backdrop.remove();
      for (const key of keys) this._fileLeaf(key, dest);
      this._paint();
    });
  }

  _openBulkTag() {
    const keys = this._bulkKeys();
    if (!keys.length) return;
    const backdrop = this._modal(`
      <div class="lib-modal-title">TAG ${keys.length}</div>
      <div class="lib-modal-sub">— these are added; existing tags stay —</div>
      <div class="lib-field">
        <div class="lib-tag-edit" data-role="tags"><span class="lib-hint">None</span></div>
        <button type="button" class="lib-btn small" data-action="add-tag">＋ Add tag</button>
        <button type="button" class="lib-btn small" data-action="from-script">From Script</button>
      </div>
      <div class="lib-modal-actions">
        <button type="button" class="lib-btn" data-action="cancel">Cancel</button>
        <button type="button" class="lib-btn gold" data-action="save">Apply</button>
      </div>`);
    const tagWrap = backdrop.querySelector('[data-role="tags"]');
    this._wireTagWrap(backdrop, tagWrap);
    backdrop.querySelector('[data-action="save"]').addEventListener('click', () => {
      const add = this._readTagWrap(tagWrap);
      if (!add.length) { alert('Add at least one tag.'); return; }
      for (const key of keys) {
        const leaf = this._leafByKey(key);
        if (leaf) this._setLeafTags(key, [...(leaf.tags ?? []), ...add]);
      }
      backdrop.remove();
      this._paint();
    });
  }

  _openBulkUntag() {
    const keys = this._bulkKeys();
    if (!keys.length) return;
    const seen = new Map();
    for (const key of keys) {
      for (const t of this._leafByKey(key)?.tags ?? []) {
        const id = `${t.type}${SEP}${String(t.value).toLowerCase()}`;
        const rec = seen.get(id) ?? { tag: t, count: 0 };
        rec.count++;
        seen.set(id, rec);
      }
    }
    const rows = [...seen.values()].sort((a, b) => b.count - a.count);
    const backdrop = this._modal(`
      <div class="lib-modal-title">REMOVE TAG</div>
      <div class="lib-modal-sub">— from ${keys.length} picked ${keys.length === 1 ? 'entry' : 'entries'} —</div>
      <div class="lib-move-list">
        ${rows.length ? rows.map(r =>
          `<button type="button" class="lib-btn" data-type="${esc(r.tag.type)}" data-value="${esc(r.tag.value)}">${esc(r.tag.value)} <span class="lib-cubby-count">${r.count}</span></button>`).join('')
          : `<div class="lib-hint">None of the picked entries carry tags of their own. Tags inherited from a lorebook are removed in <strong>Book tags</strong>.</div>`}
      </div>
      <div class="lib-modal-actions">
        <button type="button" class="lib-btn" data-action="cancel">Cancel</button>
      </div>`);
    backdrop.querySelector('.lib-move-list').addEventListener('click', e => {
      const btn = e.target.closest('[data-type]');
      if (!btn) return;
      const { type, value } = btn.dataset;
      backdrop.remove();
      for (const key of keys) {
        const leaf = this._leafByKey(key);
        if (!leaf) continue;
        const kept = (leaf.tags ?? []).filter(t =>
          !(t.type === type && String(t.value).toLowerCase() === value.toLowerCase()));
        if (kept.length !== (leaf.tags ?? []).length) this._setLeafTags(key, kept);
      }
      this._paint();
    });
  }

  _openSectionEditor(section) {
    const editing = !!section;
    const s = section ?? { title: '', blurb: '', icon: '◈', wide: false, muted: false };
    const backdrop = this._modal(`
      <div class="lib-modal-title">${editing ? 'REFIT CUBBY' : 'NEW CUBBY'}</div>
      <div class="lib-modal-sub">— a shelf of your own making —</div>
      <div class="lib-field-row">
        <div class="lib-field" style="flex:0 0 70px"><label>Mark</label>
          <input type="text" data-field="icon" maxlength="2" value="${esc(s.icon || '◈')}"></div>
        <div class="lib-field"><label>Name</label>
          <input type="text" data-field="title" value="${esc(s.title)}" placeholder="Cultures & Peoples"></div>
        <div class="lib-field" style="flex:0 0 62px"><label>Ink</label>
          <input type="color" data-field="color" value="${esc(this._accent(s, this._sections().indexOf(section)))}"></div>
      </div>
      <div class="lib-field"><label>What belongs here</label>
        <textarea data-field="blurb" placeholder="Customs, languages, faiths…">${esc(s.blurb || '')}</textarea></div>
      <label class="lib-check"><input type="checkbox" data-field="muted" ${s.muted ? 'checked' : ''}> Muted — keep its Library-written entries out of the prompt</label>
      <div class="lib-modal-actions">
        <button type="button" class="lib-btn" data-action="cancel">Cancel</button>
        <button type="button" class="lib-btn gold" data-action="save">Save</button>
      </div>`);
    backdrop.querySelector('[data-action="save"]').addEventListener('click', () => {
      const title = backdrop.querySelector('[data-field="title"]').value.trim();
      if (!title) { alert('A name is required.'); return; }
      const patch = {
        title,
        icon: backdrop.querySelector('[data-field="icon"]').value.trim() || '◈',
        blurb: backdrop.querySelector('[data-field="blurb"]').value.trim(),
        color: backdrop.querySelector('[data-field="color"]').value,
        muted: backdrop.querySelector('[data-field="muted"]').checked,
      };
      const st = this._db();
      if (editing) Object.assign(section, patch);
      else st.sections.push({ id: uid(), sortIndex: st.sections.length, ...patch });
      this._invalidate();
      this._save();
      backdrop.remove();
      this._paint();
    });
    setTimeout(() => backdrop.querySelector('[data-field="title"]').focus(), 0);
  }

  _openNativeEditor(rec) {
    const editing = !!rec;
    const n = rec ?? {
      title: '', content: '', keywords: [], pinned: false, active: true,
      sectionId: '', tags: [],
    };
    const sections = this._sections();
    const backdrop = this._modal(`
      <div class="lib-modal-title">${editing ? 'REFIT ENTRY' : 'NEW ENTRY'}</div>
      <div class="lib-modal-sub">— Library's own; this one does get injected —</div>
      <div class="lib-field"><label>Title</label>
        <input type="text" data-field="title" value="${esc(n.title)}"></div>
      <div class="lib-field"><label>Text</label>
        <textarea data-field="content" rows="6" placeholder="What the model should know…">${esc(n.content)}</textarea></div>
      <div class="lib-field"><label>Keys <span class="lib-hint">comma separated — any of these in recent messages pulls it in</span></label>
        <input type="text" data-field="keywords" value="${esc((n.keywords ?? []).join(', '))}"></div>
      <div class="lib-field"><label>Cubby</label>
        <select data-field="sectionId">
          <option value="">— Unsorted —</option>
          ${sections.map(s =>
            `<option value="${esc(s.id)}" ${s.id === n.sectionId ? 'selected' : ''}>${esc(s.title)}</option>`).join('')}
        </select></div>
      <label class="lib-check"><input type="checkbox" data-field="pinned" ${n.pinned ? 'checked' : ''}> Always on — inject without waiting for a key</label>
      <label class="lib-check"><input type="checkbox" data-field="active" ${n.active !== false ? 'checked' : ''}> Active</label>
      <div class="lib-field"><label>Tags</label>
        <div class="lib-tag-edit" data-role="tags">
          ${this._normalizeTags(n.tags).map(t => this._tagChipHTML(t, { removable: true })).join('') || '<span class="lib-hint">None</span>'}
        </div>
        <button type="button" class="lib-btn small" data-action="add-tag">＋ Add tag</button>
        <button type="button" class="lib-btn small" data-action="keys-to-tags">Keys → tags</button>
        <button type="button" class="lib-btn small" data-action="from-script">From Script</button></div>
      <div class="lib-modal-actions">
        <button type="button" class="lib-btn" data-action="cancel">Cancel</button>
        <button type="button" class="lib-btn gold" data-action="save">Save</button>
      </div>`);
    const tagWrap = backdrop.querySelector('[data-role="tags"]');
    this._wireTagWrap(backdrop, tagWrap, {
      getKeys: () => (backdrop.querySelector('[data-field="keywords"]')?.value || '')
        .split(',').map(s => s.trim()).filter(Boolean),
      mention: n.title,
    });
    backdrop.querySelector('[data-action="save"]').addEventListener('click', () => {
      const title = backdrop.querySelector('[data-field="title"]').value.trim();
      if (!title) { alert('A title is required.'); return; }
      const patch = {
        title,
        content: backdrop.querySelector('[data-field="content"]').value.trim(),
        keywords: backdrop.querySelector('[data-field="keywords"]').value
          .split(',').map(s => s.trim()).filter(Boolean),
        sectionId: backdrop.querySelector('[data-field="sectionId"]').value,
        pinned: backdrop.querySelector('[data-field="pinned"]').checked,
        active: backdrop.querySelector('[data-field="active"]').checked,
        tags: this._readTagWrap(tagWrap),
      };
      const st = this._db();
      if (editing) Object.assign(rec, patch, { updatedAt: Date.now() });
      else st.native.push({ id: uid(), sortIndex: st.native.length, createdAt: Date.now(), updatedAt: Date.now(), ...patch });
      this._invalidate();
      this._save({ inject: true });
      backdrop.remove();
      this._paint();
    });
    setTimeout(() => backdrop.querySelector('[data-field="title"]').focus(), 0);
  }

  _openTagEditor(leaf) {
    const backdrop = this._modal(`
      <div class="lib-modal-title">TAGS</div>
      <div class="lib-modal-sub">— ${esc(leaf.title)} —</div>
      <div class="lib-field">
        <div class="lib-tag-edit" data-role="tags">
          ${this._normalizeTags(leaf.tags).map(t => this._tagChipHTML(t, { removable: true })).join('') || '<span class="lib-hint">None</span>'}
        </div>
        <button type="button" class="lib-btn small" data-action="add-tag">＋ Add tag</button>
        <button type="button" class="lib-btn small" data-action="keys-to-tags" title="Turn this entry's World Info keys into typed tags">Keys → tags</button>
        <button type="button" class="lib-btn small" data-action="from-script" title="Pull Place / Person / Object tags from Script cards">From Script</button>
        <div class="lib-hint">Tags sort across cubbies — pick one in Show at the top of the shelf.</div>
      </div>
      ${leaf.kind === 'linked' ? `<div class="lib-hint">Tags inherited from the lorebook itself are managed on the Lorebooks tab.</div>` : ''}
      <div class="lib-modal-actions">
        <button type="button" class="lib-btn" data-action="cancel">Cancel</button>
        <button type="button" class="lib-btn gold" data-action="save">Save</button>
      </div>`);
    const tagWrap = backdrop.querySelector('[data-role="tags"]');
    this._wireTagWrap(backdrop, tagWrap, { keys: leaf.keys || [], mention: leaf.title });
    backdrop.querySelector('[data-action="save"]').addEventListener('click', () => {
      this._setLeafTags(leaf.key, this._readTagWrap(tagWrap));
      backdrop.remove();
      this._paint();
    });
  }

  _openBookTagEditor(name) {
    const g = this._g();
    const backdrop = this._modal(`
      <div class="lib-modal-title">BOOK TAGS</div>
      <div class="lib-modal-sub">— ${esc(name)} · global —</div>
      <div class="lib-field">
        <div class="lib-tag-edit" data-role="tags">
          ${this._normalizeTags(g.bookTags[name]).map(t => this._tagChipHTML(t, { removable: true })).join('') || '<span class="lib-hint">None</span>'}
        </div>
        <button type="button" class="lib-btn small" data-action="add-tag">＋ Add tag</button>
        <button type="button" class="lib-btn small" data-action="from-script">From Script</button>
        <div class="lib-hint">Every entry in this book inherits these, in every chat.</div>
      </div>
      <div class="lib-modal-actions">
        <button type="button" class="lib-btn" data-action="cancel">Cancel</button>
        <button type="button" class="lib-btn gold" data-action="save">Save</button>
      </div>`);
    const tagWrap = backdrop.querySelector('[data-role="tags"]');
    this._wireTagWrap(backdrop, tagWrap);
    backdrop.querySelector('[data-action="save"]').addEventListener('click', () => {
      g.bookTags[name] = this._readTagWrap(tagWrap);
      this._invalidate();
      this._saveG();
      backdrop.remove();
      this._paint();
    });
  }

  _wireTagWrap(backdrop, tagWrap, { keys = [], getKeys = null, mention = '' } = {}) {
    tagWrap.addEventListener('click', e => {
      const x = e.target.closest('.lib-tag-x');
      if (!x) return;
      x.closest('.lib-tag')?.remove();
      if (!tagWrap.querySelector('.lib-tag')) tagWrap.innerHTML = '<span class="lib-hint">None</span>';
    });
    backdrop.querySelector('[data-action="add-tag"]')?.addEventListener('click', () => {
      this._openTagAdd(tagWrap);
    });
    backdrop.querySelector('[data-action="keys-to-tags"]')?.addEventListener('click', () => {
      const list = typeof getKeys === 'function' ? getKeys() : keys;
      this._openConvertKeys(tagWrap, list);
    });
    backdrop.querySelector('[data-action="from-script"]')?.addEventListener('click', () => {
      this._openExtractFromScript(tagWrap, { mention });
    });
  }

  _readTagWrap(tagWrap) {
    return this._normalizeTags([...tagWrap.querySelectorAll('.lib-tag')].map(el => ({
      type: el.dataset.type,
      value: el.dataset.value,
    })));
  }

  _openTagAdd(tagWrap) {
    const types = this._tagTypes();
    const first = types[0];
    const firstLabel = (first?.label || 'tag').toLowerCase();
    const inner = this._modal(`
      <div class="lib-modal-title">TAG</div>
      <div class="lib-modal-sub">— pick a type, then choose from established values or add a new one —</div>
      <div class="lib-field"><label>Type</label>
        <select data-field="type">${types.map(t =>
          `<option value="${esc(t.id)}">${esc(t.label)}</option>`).join('')}</select></div>
      <div class="lib-field" data-role="value-picker">
        <label data-role="value-label">${esc(first?.label || 'Value')}</label>
        ${locationTagEditorHTML({
          fieldRole: 'lib-tag-values',
          placeholder: `Find or add a ${firstLabel}…`,
          emptyHint: `Pick an established ${firstLabel} or create a new one.`,
          newBtnLabel: `＋ New ${firstLabel}`,
          noun: firstLabel,
        })}
      </div>
      <div class="lib-modal-actions">
        <button type="button" class="lib-btn" data-action="cancel">Cancel</button>
        <button type="button" class="lib-btn gold" data-action="ok">Add</button>
      </div>`);
    const typeSel = inner.querySelector('[data-field="type"]');
    const valueBox = inner.querySelector('[data-role="value-picker"]');
    const valueLabel = inner.querySelector('[data-role="value-label"]');
    const search = valueBox?.querySelector('.st-loctag-search');
    const newBtn = valueBox?.querySelector('.st-loctag-new');
    const chips = valueBox?.querySelector('.st-loctag-chips');
    const wrap = valueBox?.querySelector('.st-loctag-wrap');

    bindLocationTagEditor(valueBox, {
      getKnown: () => this._knownValuesForType(typeSel.value),
      resolveValue: (raw) => this._canonicalValueForType(typeSel.value, raw),
      matchItem: (name, needle) => {
        if (typeSel.value === 'faction') {
          const { houses } = this._reputationFactions();
          const h = houses.find(x => x.name.toLowerCase() === String(name).toLowerCase());
          return !!(h?.alias && h.alias.toLowerCase().includes(needle));
        }
        if (typeSel.value === 'person') {
          try {
            const rec = getCastRecords(this.storage).find(c =>
              String(c?.name || '').toLowerCase() === String(name).toLowerCase());
            if (!rec) return false;
            if (normalizeAliases(rec.aliases).some(a => a.toLowerCase().includes(needle))) return true;
            const tagged = new Set((rec.taggedAlterEgos || []).map(String));
            for (const ego of rec.alterEgoIndex || []) {
              if (tagged.size && !tagged.has(String(ego?.id || ''))) continue;
              if (String(ego?.name || '').toLowerCase().includes(needle)) return true;
            }
          } catch { /* ignore */ }
        }
        return false;
      },
      multi: true,
      noun: firstLabel,
    });

    const syncTypeChrome = () => {
      const type = typeSel.value;
      const label = this._tagTypeLabel(type);
      const noun = label.toLowerCase();
      if (valueLabel) valueLabel.textContent = label;
      if (search) {
        search.placeholder = type === 'person'
          ? 'Find a cast member or alter ego…'
          : type === 'faction'
            ? 'Find an affiliation…'
            : `Find or add a ${noun}…`;
        search.value = '';
      }
      if (wrap) {
        wrap.dataset.noun = noun;
        wrap.dataset.emptyHint = type === 'person'
          ? 'Pick a cast member. Alter egos appear as “Ego · Cast name” and tag as the cast member.'
          : `Pick an established ${noun} or create a new one.`;
      }
      if (newBtn) {
        newBtn.textContent = `＋ New ${noun}`;
        newBtn.title = `Create a new ${noun} tag`;
      }
      // Don't carry Place chips into Culture (etc.) when the type changes.
      if (chips) {
        const hint = wrap?.dataset.emptyHint || `Pick an established ${noun} or create a new one.`;
        chips.innerHTML = `<span class="st-loctag-empty">${esc(hint)}</span>`;
      }
    };
    typeSel.addEventListener('change', syncTypeChrome);
    syncTypeChrome();

    inner.querySelector('[data-action="ok"]').addEventListener('click', () => {
      const type = typeSel.value;
      const values = readLocationTags(valueBox);
      if (!values.length) { alert('Give it at least one value.'); return; }
      const tagged = values.map(value => ({
        type,
        value: this._canonicalValueForType(type, value),
      }));
      this._appendTagChips(tagWrap, tagged);
      inner.remove();
    });
    setTimeout(() => search?.focus(), 0);
  }

  _openConvertKeys(tagWrap, keys) {
    const list = this._uniqueNames(keys);
    if (!list.length) {
      alert('This entry has no keys to convert.');
      return;
    }
    const types = this._tagTypes();
    const inner = this._modal(`
      <div class="lib-modal-title">KEYS → TAGS</div>
      <div class="lib-modal-sub">— guessed from locations, cast, affiliations, and tags already in play —</div>
      <div class="lib-convert-list">
        ${list.map((key, i) => {
          const guess = this._guessTagType(key);
          return `<label class="lib-convert-row">
            <input type="checkbox" data-i="${i}" checked>
            <span class="lib-convert-key">${esc(key)}</span>
            <select data-type-for="${i}">${types.map(t =>
              `<option value="${esc(t.id)}" ${t.id === guess ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}</select>
          </label>`;
        }).join('')}
      </div>
      <div class="lib-modal-actions">
        <button type="button" class="lib-btn" data-action="cancel">Cancel</button>
        <button type="button" class="lib-btn" data-action="all-term">All as Term</button>
        <button type="button" class="lib-btn gold" data-action="ok">Add tags</button>
      </div>`);
    inner.querySelector('[data-action="all-term"]')?.addEventListener('click', () => {
      const id = this._tagType('term')?.id || types[0]?.id;
      if (!id) return;
      inner.querySelectorAll('select[data-type-for]').forEach(sel => { sel.value = id; });
    });
    inner.querySelector('[data-action="ok"]').addEventListener('click', () => {
      const add = [];
      for (let i = 0; i < list.length; i++) {
        const on = inner.querySelector(`input[data-i="${i}"]`)?.checked;
        if (!on) continue;
        const type = inner.querySelector(`select[data-type-for="${i}"]`)?.value;
        if (!type) continue;
        let value = list[i];
        value = this._canonicalValueForType(type, value);
        add.push({ type, value });
      }
      if (!add.length) { alert('Pick at least one key.'); return; }
      this._appendTagChips(tagWrap, add);
      inner.remove();
    });
  }

  _openExtractFromScript(tagWrap, { mention = '', matchOnly = false } = {}) {
    const all = this._scriptTagCandidates();
    if (!all.length) {
      alert('No Place, Person, Faction, Object, or Era tags found on Script cards.');
      return;
    }
    const matched = mention ? this._scriptTagCandidates({ mention }) : all;
    const inner = this._modal(`
      <div class="lib-modal-title">FROM SCRIPT</div>
      <div class="lib-modal-sub">— location, credits, objects, and dates on Script cards —</div>
      ${mention ? `<label class="lib-check"><input type="checkbox" data-field="match" ${matchOnly || matched.length ? 'checked' : ''}>
        Only cards that mention this entry</label>` : ''}
      <div class="lib-extract-list" data-role="extract-list"></div>
      <div class="lib-modal-actions">
        <button type="button" class="lib-btn" data-action="cancel">Cancel</button>
        <button type="button" class="lib-btn" data-action="all">Select all</button>
        <button type="button" class="lib-btn gold" data-action="ok">Add tags</button>
      </div>`);
    const listEl = inner.querySelector('[data-role="extract-list"]');
    const matchBox = inner.querySelector('[data-field="match"]');
    const paint = () => {
      const rows = matchBox?.checked ? this._scriptTagCandidates({ mention }) : all;
      if (!rows.length) {
        listEl.innerHTML = '<div class="lib-hint">No matching Script tags.</div>';
        return;
      }
      const groups = new Map();
      for (const row of rows) {
        if (!groups.has(row.type)) groups.set(row.type, []);
        groups.get(row.type).push(row);
      }
      listEl.innerHTML = [...groups].map(([type, items]) => `
        <div class="lib-extract-group">
          <div class="lib-extract-head">${esc(this._tagType(type)?.label || type)}</div>
          ${items.map((row, i) => `
            <label class="lib-extract-row">
              <input type="checkbox" data-type="${esc(row.type)}" data-value="${esc(row.value)}" checked>
              <span>${esc(row.value)}</span>
              <em>${esc(row.from)}</em>
            </label>`).join('')}
        </div>`).join('');
    };
    matchBox?.addEventListener('change', paint);
    paint();
    inner.querySelector('[data-action="all"]')?.addEventListener('click', () => {
      listEl.querySelectorAll('input[type="checkbox"]').forEach(c => { c.checked = true; });
    });
    inner.querySelector('[data-action="ok"]').addEventListener('click', () => {
      const add = [...listEl.querySelectorAll('input[type="checkbox"]:checked')].map(el => ({
        type: el.dataset.type,
        value: el.dataset.value,
      }));
      if (!add.length) { alert('Pick at least one tag.'); return; }
      this._appendTagChips(tagWrap, add);
      inner.remove();
    });
  }

  _openBulkConvertKeys() {
    const keys = this._bulkKeys();
    if (!keys.length) return;
    const leaves = keys.map(k => this._leafByKey(k)).filter(l => l?.keys?.length);
    if (!leaves.length) {
      alert('None of the picked entries have World Info keys.');
      return;
    }
    const inner = this._modal(`
      <div class="lib-modal-title">KEYS → TAGS</div>
      <div class="lib-modal-sub">— ${leaves.length} ${leaves.length === 1 ? 'entry' : 'entries'} with keys —</div>
      <div class="lib-hint">Each key becomes a tag. Locations, cast, and affiliations are typed automatically; everything else is a Term you can change per entry after.</div>
      <div class="lib-modal-actions">
        <button type="button" class="lib-btn" data-action="cancel">Cancel</button>
        <button type="button" class="lib-btn gold" data-action="ok">Convert</button>
      </div>`);
    inner.querySelector('[data-action="ok"]').addEventListener('click', () => {
      let n = 0;
      for (const leaf of leaves) {
        const add = (leaf.keys || []).map(value => {
          const type = this._guessTagType(value);
          return { type, value: this._canonicalValueForType(type, value) };
        });
        const before = this._normalizeTags(leaf.tags).length;
        this._setLeafTags(leaf.key, [...(leaf.tags || []), ...add]);
        if (this._normalizeTags(this._leafByKey(leaf.key)?.tags).length > before) n++;
      }
      inner.remove();
      this._paint();
      alert(n ? `Tagged ${n} ${n === 1 ? 'entry' : 'entries'} from their keys.` : 'Those tags were already present.');
    });
  }

  _openBulkExtractScript() {
    const keys = this._bulkKeys();
    if (!keys.length) return;
    const all = this._scriptTagCandidates();
    if (!all.length) {
      alert('No Place, Person, Faction, Object, or Era tags found on Script cards.');
      return;
    }
    const inner = this._modal(`
      <div class="lib-modal-title">FROM SCRIPT</div>
      <div class="lib-modal-sub">— ${keys.length} picked ${keys.length === 1 ? 'entry' : 'entries'} —</div>
      <label class="lib-check"><input type="checkbox" data-field="match" checked>
        Match each entry to Script cards that mention it (title or keys)</label>
      <div class="lib-hint">Uncheck to add the same picked Script tags to every selected entry.</div>
      <div class="lib-extract-list" data-role="extract-list"></div>
      <div class="lib-modal-actions">
        <button type="button" class="lib-btn" data-action="cancel">Cancel</button>
        <button type="button" class="lib-btn gold" data-action="ok">Apply</button>
      </div>`);
    const listEl = inner.querySelector('[data-role="extract-list"]');
    const matchBox = inner.querySelector('[data-field="match"]');
    const groups = new Map();
    for (const row of all) {
      if (!groups.has(row.type)) groups.set(row.type, []);
      groups.get(row.type).push(row);
    }
    listEl.innerHTML = [...groups].map(([type, items]) => `
      <div class="lib-extract-group">
        <div class="lib-extract-head">${esc(this._tagType(type)?.label || type)}</div>
        ${items.map(row => `
          <label class="lib-extract-row">
            <input type="checkbox" data-type="${esc(row.type)}" data-value="${esc(row.value)}" checked>
            <span>${esc(row.value)}</span>
            <em>${esc(row.from)}</em>
          </label>`).join('')}
      </div>`).join('');
    inner.querySelector('[data-action="ok"]').addEventListener('click', () => {
      const picked = [...listEl.querySelectorAll('input[type="checkbox"]:checked')].map(el => ({
        type: el.dataset.type,
        value: el.dataset.value,
      }));
      const match = !!matchBox?.checked;
      let n = 0;
      if (match) {
        for (const key of keys) {
          const leaf = this._leafByKey(key);
          if (!leaf) continue;
          const mention = [leaf.title, ...(leaf.keys || [])].filter(Boolean).join(' ');
          const add = this._scriptTagCandidates({ mention })
            .filter(t => picked.some(p => p.type === t.type && p.value.toLowerCase() === t.value.toLowerCase()));
          if (!add.length) continue;
          const before = this._normalizeTags(leaf.tags).length;
          this._setLeafTags(key, [...(leaf.tags || []), ...add]);
          if (this._normalizeTags(this._leafByKey(key)?.tags).length > before) n++;
        }
      } else {
        n = this._mergeTagsOnLeaves(keys, picked);
      }
      inner.remove();
      this._paint();
      alert(n ? `Updated ${n} ${n === 1 ? 'entry' : 'entries'}.` : 'No new tags to add.');
    });
  }

  _openTagTypes() {
    const g = this._g();
    const backdrop = this._modal(`
      <div class="lib-modal-title">TAG TYPES</div>
      <div class="lib-modal-sub">— your vocabulary, shared by every chat —</div>
      <div class="lib-types" data-role="types">
        ${g.tagTypes.map(t => `
          <div class="lib-type-row" data-id="${esc(t.id)}">
            <input type="color" data-field="color" value="${esc(/^#[0-9a-f]{6}$/i.test(t.color || '') ? t.color : '#8a6a3d')}">
            <input type="text" data-field="label" value="${esc(t.label)}">
            <button type="button" class="lib-icon danger" data-action="drop-type" title="Remove type">✕</button>
          </div>`).join('')}
      </div>
      <button type="button" class="lib-btn small" data-action="add-type">＋ Add type</button>
      <div class="lib-hint">Removing a type leaves tags already written with it in place — they simply show their raw name until you add the type back.</div>
      <div class="lib-modal-actions">
        <button type="button" class="lib-btn" data-action="cancel">Cancel</button>
        <button type="button" class="lib-btn gold" data-action="save">Save</button>
      </div>`);
    const wrap = backdrop.querySelector('[data-role="types"]');
    wrap.addEventListener('click', e => {
      const x = e.target.closest('[data-action="drop-type"]');
      if (!x) return;
      x.closest('.lib-type-row')?.remove();
    });
    backdrop.querySelector('[data-action="add-type"]').addEventListener('click', () => {
      wrap.insertAdjacentHTML('beforeend', `
        <div class="lib-type-row" data-id="">
          <input type="color" data-field="color" value="#8a6a3d">
          <input type="text" data-field="label" placeholder="Religion">
          <button type="button" class="lib-icon danger" data-action="drop-type" title="Remove type">✕</button>
        </div>`);
      wrap.lastElementChild?.querySelector('[data-field="label"]')?.focus();
    });
    backdrop.querySelector('[data-action="save"]').addEventListener('click', () => {
      const rows = [...wrap.querySelectorAll('.lib-type-row')];
      const next = [];
      const seen = new Set();
      for (const row of rows) {
        const label = row.querySelector('[data-field="label"]').value.trim();
        if (!label) continue;
        const id = row.dataset.id || slug(label);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        next.push({ id, label, color: row.querySelector('[data-field="color"]').value });
      }
      if (!next.length) { alert('Keep at least one tag type.'); return; }
      g.tagTypes = next;
      this._saveG();
      backdrop.remove();
      this._paint();
    });
  }

  _openSettings() {
    const st = this._db();
    const s = st.settings;
    const backdrop = this._modal(`
      <div class="lib-modal-title">LIBRARY</div>
      <div class="lib-modal-sub">— activation for Library's own entries —</div>
      <div class="lib-hint">Entries that live in a lorebook are injected by SillyTavern's World Info, exactly as they always were. Library never doubles them up — it only injects the entries written here.</div>
      <div class="lib-field"><label>Scan depth <span class="lib-hint">messages searched for keys</span></label>
        <input type="number" data-field="scanDepth" min="1" max="100" value="${esc(String(s.scanDepth ?? 4))}"></div>
      <label class="lib-check"><input type="checkbox" data-field="injectPinned" ${s.injectPinned !== false ? 'checked' : ''}> Inject always-on entries</label>
      <label class="lib-check"><input type="checkbox" data-field="injectKeyword" ${s.injectKeyword !== false ? 'checked' : ''}> Inject on key match</label>
      <div class="lib-modal-actions">
        <button type="button" class="lib-btn" data-action="cancel">Cancel</button>
        <button type="button" class="lib-btn gold" data-action="save">Save</button>
      </div>`);
    backdrop.querySelector('[data-action="save"]').addEventListener('click', () => {
      s.scanDepth = Math.max(1, Math.min(100, Number(backdrop.querySelector('[data-field="scanDepth"]').value) || 4));
      s.injectPinned = backdrop.querySelector('[data-field="injectPinned"]').checked;
      s.injectKeyword = backdrop.querySelector('[data-field="injectKeyword"]').checked;
      this._save({ inject: true });
      backdrop.remove();
      this._paint();
    });
  }

  _modal(inner) {
    const backdrop = document.createElement('div');
    backdrop.className = 'lib-modal-backdrop';
    const stacked = document.querySelectorAll('.lib-modal-backdrop').length;
    if (stacked) backdrop.style.zIndex = String(100000 + stacked * 10);
    backdrop.innerHTML = `<div class="lib-modal">${inner}</div>`;
    document.body.appendChild(backdrop);
    backdrop.querySelector('[data-action="cancel"]')?.addEventListener('click', () => backdrop.remove());
    backdrop.addEventListener('click', e => { if (e.target === backdrop) backdrop.remove(); });
    return backdrop;
  }

  // ── injection ──────────────────────────────────────────────────────────────

  _registerInjection() {
    if (!this.injector) return;
    this.injector.register({
      id: 'library.glossary',
      always: true,
      buildText: () => this._buildInjection(),
    });
  }

  _haystack(depth) {
    const chat = getContext().chat ?? [];
    const n = Math.max(0, Number(depth) || 0);
    if (!n) return '';
    return chat.slice(-n).map(m => m?.mes ?? '').join('\n').toLowerCase();
  }

  /** Only Library-written entries — lorebook entries stay World Info's job. */
  _injectionPicks() {
    const st = this._db();
    const s = st.settings ?? {};
    const muted = new Set(st.sections.filter(x => x.muted).map(x => x.id));
    const pool = st.native.filter(n => n.active !== false && !muted.has(n.sectionId));
    const hay = this._haystack(s.scanDepth ?? 4);
    const picks = [];
    for (const n of pool) {
      const keys = (n.keywords ?? []).map(k => String(k).trim().toLowerCase()).filter(Boolean);
      if (n.pinned) {
        if (s.injectPinned !== false) picks.push(n);
        continue;
      }
      if (s.injectKeyword === false || !keys.length || !hay) continue;
      if (keys.some(k => hay.includes(k))) picks.push(n);
    }
    return picks;
  }

  _buildInjection() {
    const picks = this._injectionPicks();
    if (!picks.length) return '';
    return picks.map(n => {
      const section = this._section(n.sectionId);
      const tags = this._normalizeTags(n.tags)
        .map(t => `${this._tagType(t.type)?.label || t.type}: ${t.value}`)
        .join(' · ');
      const lines = [`[${section ? section.title : 'Library'}] ${n.title}`];
      if (n.content) lines.push(clip(n.content, 360));
      if (tags) lines.push(tags);
      return lines.join('\n');
    }).join('\n\n---\n\n');
  }
}

function uid() {
  return crypto?.randomUUID?.() ?? ('l_' + Math.random().toString(36).slice(2, 10));
}

function slug(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function clip(text, max) {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, ch =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
