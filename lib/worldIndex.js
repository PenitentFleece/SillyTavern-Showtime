// World Index — derived cross-cut over Showtime authoring views.
// Views (Cast / Set / Script / Library / Inventory / Visuals / Composer) remain
// the source of truth. This module only reads, scores, and formats for retrieval.

import { getContext } from '../../../../extensions.js';
import { getCastMembers, getStarMember } from './castCatalog.js';
import { listVisibleLibraryLeaves } from './libraryCatalog.js';
import { getSceneCards } from './scriptCatalog.js';
import {
  collectActiveLocationTags,
  ensureCompass,
  getActiveRoom,
} from './compass/state.js';
import { listAllSetPieces } from './compass/schema.js';
import { normalizeFacets, flattenFacets, COMPOSER_FACETS } from './keywordFacets.js';
import { normalizeVisuals } from './backgrounds.js';

/** @typedef {{ type: string, value: string }} WorldTag */
/**
 * @typedef {object} WorldEntity
 * @property {string} id
 * @property {'place'|'person'|'scene'|'lore'|'item'|'backdrop'} kind
 * @property {string} title
 * @property {string} blurb
 * @property {WorldTag[]} tags
 * @property {{ module: string, path?: string, uid?: string }} refs
 * @property {number} weight
 */

export const WORLD_INDEX_DEFAULTS = Object.freeze({
  topN: 7,
  charBudget: 1200,
  blurbMax: 160,
});

const FACET_TO_TYPE = Object.freeze({
  location: 'place',
  objects: 'object',
  characters: 'person',
  datetime: 'era',
  mood: 'mood',
});

const KIND_LABEL = Object.freeze({
  place: 'Place',
  person: 'Person',
  scene: 'Scene',
  lore: 'Lore',
  item: 'Item',
  backdrop: 'Backdrop',
});

// ─── tags ─────────────────────────────────────────────────────────────────────

function tag(type, value) {
  const t = String(type || 'term').trim() || 'term';
  const v = String(value || '').trim();
  if (!v) return null;
  return { type: t, value: v };
}

function uniqTags(list) {
  const out = [];
  const seen = new Set();
  for (const raw of list || []) {
    if (!raw) continue;
    const t = typeof raw === 'string'
      ? tag('term', raw)
      : tag(raw.type || 'term', raw.value);
    if (!t) continue;
    const k = `${t.type.toLowerCase()}::${t.value.toLowerCase()}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

/** Normalize mixed tag/facet/string bags into WorldTag[]. */
export function toWorldTags(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return uniqTags(raw.map(x => {
      if (typeof x === 'string') return tag('term', x);
      if (x && typeof x === 'object') return tag(x.type || 'term', x.value ?? x.label ?? x.name);
      return null;
    }));
  }
  if (typeof raw === 'object') {
    // Facet object { location: [], … }
    const facets = normalizeFacets(raw, COMPOSER_FACETS);
    const out = [];
    for (const [fid, vals] of Object.entries(facets)) {
      const type = FACET_TO_TYPE[fid] || fid;
      for (const v of vals || []) out.push(tag(type, v));
    }
    return uniqTags(out);
  }
  if (typeof raw === 'string') return uniqTags([tag('term', raw)]);
  return [];
}

function clipBlurb(text, max = WORLD_INDEX_DEFAULTS.blurbMax) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1).trim()}…`;
}

function lowerSet(arr) {
  return new Set((arr || []).map(x => String(x).toLowerCase()).filter(Boolean));
}

// ─── adapters ─────────────────────────────────────────────────────────────────

function adaptPlaces(storage) {
  const out = [];
  try {
    const st = storage.getChat('backstage', {});
    const compass = ensureCompass(st);
    const activeId = compass.activeRoomId || '';
    for (const room of Object.values(compass.rooms || {})) {
      if (!room?.id) continue;
      const tags = toWorldTags([
        ...(room.locationTags || []).map(v => ({ type: 'place', value: v })),
        room.name ? { type: 'place', value: room.name } : null,
        room.kind ? { type: 'term', value: room.kind } : null,
      ]);
      out.push({
        id: `place:${room.id}`,
        kind: 'place',
        title: String(room.name || 'Place').trim() || 'Place',
        blurb: clipBlurb(room.description || room.orientation_note || ''),
        tags,
        refs: { module: 'backstage', path: `stage.rooms.${room.id}`, uid: room.id },
        weight: room.id === activeId ? 8 : 2,
      });
    }
  } catch { /* ignore */ }
  return out;
}

function adaptPeople(storage) {
  const out = [];
  try {
    for (const c of getCastMembers(storage)) {
      if (!c?.id || c.priority === 'director') continue;
      const name = String(c.name || '').trim();
      if (!name) continue;
      const aliases = Array.isArray(c.aliases) ? c.aliases : [];
      const tags = toWorldTags([
        { type: 'person', value: name },
        ...aliases.map(a => ({ type: 'person', value: a })),
        c.priority ? { type: 'term', value: c.priority } : null,
      ]);
      const blurb = clipBlurb(c.description || '');
      // Skip empty extras with no description and no aliases beyond name
      if (!blurb && !aliases.length && c.priority === 'minor') continue;
      let weight = 1;
      if (c.priority === 'star') weight = 6;
      else if (c.priority === 'lead') weight = 4;
      else if (c.priority === 'major') weight = 3;
      else if (c.priority === 'foil') weight = 3;
      out.push({
        id: `person:${c.id}`,
        kind: 'person',
        title: name,
        blurb,
        tags,
        refs: { module: 'cast', path: `characters`, uid: c.id },
        weight,
      });
    }
  } catch { /* ignore */ }
  return out;
}

function adaptScenes(storage) {
  const out = [];
  try {
    for (const { uid, title, card } of getSceneCards(storage)) {
      if (!card || card.active === false) continue;
      const facets = normalizeFacets(card.keywordFacets || {}, COMPOSER_FACETS);
      const tags = toWorldTags([
        ...toWorldTags(facets),
        ...(Array.isArray(card.keywords) ? card.keywords.map(v => ({ type: 'term', value: v })) : []),
        ...(Array.isArray(card.aliases) ? card.aliases.map(v => ({ type: 'term', value: v })) : []),
        ...(Array.isArray(card.tags) ? card.tags.map(v => (typeof v === 'string' ? { type: 'term', value: v } : v)) : []),
      ]);
      out.push({
        id: `scene:${uid}`,
        kind: 'scene',
        title: String(title || card.title || 'Scene').trim() || 'Scene',
        blurb: clipBlurb(card.content || card.body || card.text || ''),
        tags,
        refs: { module: 'script', path: 'cards', uid },
        weight: card.pinned ? 7 : 2,
      });
    }
  } catch { /* ignore */ }
  return out;
}

function adaptLore(storage) {
  const out = [];
  try {
    // Prefer Library's cached lorebooks when loaded; otherwise natives only.
    const leaves = listVisibleLibraryLeaves(storage);
    for (const leaf of leaves) {
      if (!leaf || leaf.disabled) continue;
      if (!leaf.title && !leaf.content) continue;
      const tags = toWorldTags([
        ...(leaf.tags || []),
        ...(leaf.keys || []).map(v => ({ type: 'term', value: v })),
      ]);
      out.push({
        id: `lore:${leaf.key}`,
        kind: 'lore',
        title: String(leaf.title || 'Lore').trim() || 'Lore',
        blurb: clipBlurb(leaf.content || ''),
        tags,
        refs: { module: 'library', path: leaf.key, uid: leaf.uid || leaf.id },
        weight: leaf.constant ? 6 : 2,
      });
    }
  } catch { /* ignore */ }
  return out;
}

function adaptItems(storage) {
  const out = [];
  try {
    const inv = storage.getChat('inventory', { static: [], mobile: [] });
    const pushItem = (item, loc) => {
      if (!item?.id || item.parentId) return;
      const name = String(item.name || '').trim();
      if (!name) return;
      const tags = toWorldTags([
        { type: 'object', value: name },
        item.category ? { type: 'term', value: item.category } : null,
        item.kind === 'container' ? { type: 'term', value: 'container' } : null,
        { type: 'term', value: loc },
      ]);
      out.push({
        id: `item:${item.id}`,
        kind: 'item',
        title: name,
        blurb: clipBlurb(item.description || ''),
        tags,
        refs: { module: 'inventory', path: loc, uid: item.id },
        weight: loc === 'mobile' ? 3 : 1,
      });
    };
    for (const it of inv.static || []) pushItem(it, 'static');
    for (const it of inv.mobile || []) pushItem(it, 'mobile');
  } catch { /* ignore */ }
  try {
    const st = storage.getChat('backstage', {});
    const compass = ensureCompass(st);
    const activeId = compass.activeRoomId || '';
    for (const it of listAllSetPieces(compass)) {
      if (it.layer === 'fixtures') continue;
      const name = String(it.name || '').trim();
      if (!name) continue;
      const tags = toWorldTags([
        { type: 'object', value: name },
        it.category ? { type: 'term', value: it.category } : null,
        it.placeName ? { type: 'place', value: it.placeName } : null,
        ...(compass.rooms?.[it.placeId]?.locationTags || []).map(v => ({ type: 'place', value: v })),
        { type: 'term', value: 'set' },
        it.layer ? { type: 'term', value: it.layer } : null,
      ]);
      out.push({
        id: `item:set:${it.id}`,
        kind: 'item',
        title: name,
        blurb: clipBlurb(it.description || `${it.placeName || 'Set'}${it.cell ? ` · ${it.cell}` : ''}`),
        tags,
        refs: { module: 'backstage', path: `stage.rooms.${it.placeId}`, uid: it.id },
        weight: it.placeId === activeId ? 4 : 1.5,
      });
    }
  } catch { /* ignore */ }
  return out;
}

function adaptBackdrops(storage) {
  const out = [];
  try {
    const st = storage.getChat('backstage', {});
    const visuals = normalizeVisuals(st.visuals);
    for (const bg of visuals.backgrounds || []) {
      const tags = toWorldTags([
        ...(bg.locationTags || []).map(v => ({ type: 'place', value: v })),
        ...(bg.sceneTags || []).map(v => ({ type: 'scene', value: v })),
        ...(bg.tags || []).map(v => ({ type: 'term', value: v })),
      ]);
      out.push({
        id: `bg:${bg.id}`,
        kind: 'backdrop',
        title: String(bg.title || 'Backdrop').trim() || 'Backdrop',
        blurb: clipBlurb(bg.title || ''),
        tags,
        refs: { module: 'backstage', path: 'visuals.backgrounds', uid: bg.id },
        weight: bg.id === visuals.activeId ? 2 : 0.5,
      });
    }
  } catch { /* ignore */ }
  return out;
}

/** Flatten all adapters into WorldEntity[]. */
export function listWorldEntities(storage) {
  return [
    ...adaptPlaces(storage),
    ...adaptPeople(storage),
    ...adaptScenes(storage),
    ...adaptLore(storage),
    ...adaptItems(storage),
    ...adaptBackdrops(storage),
  ];
}

// ─── context ──────────────────────────────────────────────────────────────────

function mergeComposerFacets(storage) {
  const merge = (a, b) => {
    const out = normalizeFacets({}, COMPOSER_FACETS);
    for (const f of COMPOSER_FACETS) {
      const seen = new Set();
      for (const v of [...(a[f.id] || []), ...(b[f.id] || [])]) {
        const s = String(v || '').trim();
        if (!s) continue;
        const k = s.toLowerCase();
        if (seen.has(k)) continue;
        seen.add(k);
        out[f.id].push(s);
      }
    }
    return out;
  };
  let chat = normalizeFacets({}, COMPOSER_FACETS);
  let glob = normalizeFacets({}, COMPOSER_FACETS);
  try {
    chat = normalizeFacets(storage.getChat('composer', {})?.sceneFacets, COMPOSER_FACETS);
  } catch { /* ignore */ }
  try {
    glob = normalizeFacets(storage.getGlobal('composer', {})?.sceneFacets, COMPOSER_FACETS);
  } catch { /* ignore */ }
  return merge(chat, glob);
}

function recentHaystack(maxMsgs = 12) {
  try {
    const chat = getContext()?.chat || [];
    const slice = chat.slice(-maxMsgs);
    return slice.map(m => String(m?.mes || '')).join('\n').toLowerCase();
  } catch {
    return '';
  }
}

function inSceneNames(storage) {
  const names = [];
  try {
    const ctx = getContext();
    const chat = ctx?.chat || [];
    const cardIds = new Set();
    for (const m of chat) {
      if (m?.is_user) continue;
      const cid = m?.character_id ?? m?.original_avatar;
      // Collect speaker names from recent non-user messages
      const n = String(m?.name || '').trim();
      if (n) names.push(n);
    }
    const star = getStarMember(storage);
    if (star?.name) names.push(star.name);
    // Cast members linked to cards currently in the group chat
    const members = getCastMembers(storage);
    try {
      const chars = ctx?.characters || [];
      for (const ch of chars) {
        if (ch?.avatar) cardIds.add(String(ch.avatar));
      }
    } catch { /* ignore */ }
    for (const c of members) {
      if (c.characterCardId && cardIds.has(String(c.characterCardId))) {
        if (c.name) names.push(c.name);
      }
    }
  } catch { /* ignore */ }
  return [...new Set(names.map(n => n.trim()).filter(Boolean))];
}

/**
 * @param {object} storage
 * @param {{ cellId?: string }} [opts]
 */
export function buildWorldContext(storage, opts = {}) {
  const locationTags = collectActiveLocationTags(storage);
  let placeId = '';
  let placeName = '';
  let placeTags = [];
  try {
    const st = storage.getChat('backstage', {});
    const compass = ensureCompass(st);
    const active = getActiveRoom(compass);
    if (active) {
      placeId = active.id;
      placeName = active.name || '';
      placeTags = [...(active.locationTags || [])];
    }
  } catch { /* ignore */ }

  const facets = mergeComposerFacets(storage);
  const narrativeTags = [
    ...flattenFacets(facets, COMPOSER_FACETS),
    ...locationTags,
    ...placeTags,
    placeName,
  ].filter(Boolean);

  const bag = lowerSet(narrativeTags);
  const typed = {
    place: lowerSet([...facets.location, ...locationTags, ...placeTags, placeName]),
    person: lowerSet([...facets.characters, ...inSceneNames(storage)]),
    object: lowerSet(facets.objects),
    mood: lowerSet(facets.mood),
    era: lowerSet(facets.datetime),
  };

  return {
    placeId,
    placeName,
    cellId: String(opts.cellId || '').toUpperCase(),
    locationTags,
    facets,
    narrativeTags,
    bag,
    typed,
    inSceneNames: inSceneNames(storage),
    haystack: recentHaystack(12),
  };
}

// ─── scoring / pick ───────────────────────────────────────────────────────────

/**
 * @param {WorldEntity} entity
 * @param {ReturnType<typeof buildWorldContext>} ctx
 */
export function scoreEntity(entity, ctx) {
  if (!entity) return -1;
  let score = Number(entity.weight) || 0;
  let matched = false;

  if (entity.kind === 'place' && ctx.placeId && entity.refs?.uid === ctx.placeId) {
    score += 24;
    matched = true;
  }

  if (entity.kind === 'person') {
    const title = entity.title.toLowerCase();
    if ((ctx.inSceneNames || []).some(n => n.toLowerCase() === title)) {
      score += 18;
      matched = true;
    }
  }

  if (entity.kind === 'backdrop') {
    // Keep backdrops weak in text index — Visuals already apply images.
    score *= 0.35;
  }

  for (const t of entity.tags || []) {
    const type = String(t.type || '').toLowerCase();
    const val = String(t.value || '').toLowerCase();
    if (!val) continue;
    const typedBag = ctx.typed?.[type === 'place' ? 'place'
      : type === 'person' ? 'person'
        : type === 'object' ? 'object'
          : type === 'mood' ? 'mood'
            : type === 'era' || type === 'event' ? 'era'
              : null];
    if (typedBag?.has(val)) {
      score += 12;
      matched = true;
    } else if (ctx.bag?.has(val)) {
      score += 6;
      matched = true;
    }
    if (ctx.haystack && ctx.haystack.includes(val)) {
      score += 4;
      matched = true;
    }
  }

  // Title hit in haystack
  if (ctx.haystack && entity.title && ctx.haystack.includes(entity.title.toLowerCase())) {
    score += 5;
    matched = true;
  }

  if (!matched && score < 4) return 0;
  return score;
}

/**
 * @param {object} storage
 * @param {{ topN?: number, charBudget?: number, cellId?: string, context?: object }} [opts]
 */
export function pickWorldEntities(storage, opts = {}) {
  const topN = Math.max(1, Number(opts.topN) || WORLD_INDEX_DEFAULTS.topN);
  const charBudget = Math.max(200, Number(opts.charBudget) || WORLD_INDEX_DEFAULTS.charBudget);
  const ctx = opts.context || buildWorldContext(storage, { cellId: opts.cellId });
  const entities = listWorldEntities(storage);

  const scored = entities
    .map(e => ({ e, s: scoreEntity(e, ctx) }))
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s || a.e.kind.localeCompare(b.e.kind) || a.e.title.localeCompare(b.e.title));

  // Prefer kind diversity in the first slots
  const picked = [];
  const seenKind = new Set();
  const seenKey = new Set();
  const keyOf = (e) => `${e.kind}::${e.title.toLowerCase()}`;

  const tryPush = (row) => {
    if (picked.length >= topN) return false;
    const k = keyOf(row.e);
    if (seenKey.has(k)) return false;
    seenKey.add(k);
    picked.push(row);
    seenKind.add(row.e.kind);
    return true;
  };

  for (const row of scored) {
    if (!seenKind.has(row.e.kind)) tryPush(row);
  }
  for (const row of scored) {
    if (picked.length >= topN) break;
    tryPush(row);
  }

  // Char budget trim
  const out = [];
  let used = 0;
  for (const row of picked) {
    const line = formatEntityLine(row.e);
    if (used + line.length > charBudget && out.length) break;
    out.push({ ...row.e, _score: row.s });
    used += line.length;
  }
  return out;
}

function formatEntityLine(e) {
  const label = KIND_LABEL[e.kind] || e.kind;
  const blurb = e.blurb ? ` — ${e.blurb}` : '';
  return `- ${label}: ${e.title}${blurb}`;
}

/** Prompt block for the injector. Empty string when nothing relevant. */
export function formatWorldIndexPrompt(entities) {
  if (!entities?.length) return '';
  const lines = entities.map(formatEntityLine);
  return `[World Index — in play]\n${lines.join('\n')}`;
}

/**
 * One-shot: pick + format for injection.
 * @param {object} storage
 * @param {object} [opts]
 */
export function buildWorldIndexInjection(storage, opts = {}) {
  try {
    const picked = pickWorldEntities(storage, opts);
    return formatWorldIndexPrompt(picked);
  } catch (err) {
    console.warn('[Showtime/WorldIndex] inject failed', err);
    return '';
  }
}

/** Register always-on injector rule `world.index`. */
export function registerWorldIndexInjection(injector, storage, opts = {}) {
  if (!injector || !storage) return;
  injector.register({
    id: 'world.index',
    always: true,
    buildText: () => {
      try {
        const root = (typeof opts.houseRoot === 'function' ? opts.houseRoot() : opts.houseRoot) || {};
        if (root.masterOff) return '';
        const cellId = typeof opts.cellId === 'function' ? opts.cellId() : opts.cellId;
        return buildWorldIndexInjection(storage, { ...opts, cellId });
      } catch {
        return '';
      }
    },
  });
}

/**
 * HTML strip for Stage preview.
 * @param {object} storage
 * @param {{ esc: Function, cellId?: string }} opts
 */
export function buildWorldIndexPreviewHtml(storage, { esc, cellId = '' } = {}) {
  const safe = typeof esc === 'function' ? esc : (s => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'));
  let rows = [];
  try {
    rows = pickWorldEntities(storage, { cellId });
  } catch {
    rows = [];
  }
  const body = rows.length
    ? `<ul class="bst-wi-list">${rows.map(e => `
        <li class="bst-wi-item" data-kind="${safe(e.kind)}">
          <span class="bst-wi-kind">${safe(KIND_LABEL[e.kind] || e.kind)}</span>
          <strong class="bst-wi-title">${safe(e.title)}</strong>
          ${e.blurb ? `<span class="bst-wi-blurb">${safe(e.blurb)}</span>` : ''}
          <span class="bst-k">score ${safe(String(Math.round(e._score || 0)))}</span>
        </li>`).join('')}</ul>`
    : `<div class="bst-empty">Nothing ranked for the current context — tag places, cast, script, or library leaves.</div>`;

  return `
    <section class="bst-section bst-wi-preview">
      <h3 class="bst-section-h">World Index</h3>
      <p class="bst-hint">Derived retrieval preview — what <code>world.index</code> would inject on the next generation. Authoring views stay the source of truth.</p>
      ${body}
    </section>`;
}

/** Lightweight pure checks (no storage / DOM). Returns '' on success, else error text. */
export function smokeWorldIndexPure() {
  try {
    const tags = toWorldTags({ location: ['Fukuoka'], mood: ['Tense'], characters: ['Aiko'] });
    if (!tags.some(t => t.type === 'place' && t.value === 'Fukuoka')) return 'facet map failed';
    if (formatWorldIndexPrompt([]) !== '') return 'empty prompt should be blank';
    const block = formatWorldIndexPrompt([
      { kind: 'place', title: 'Docks', blurb: 'Salt air' },
      { kind: 'person', title: 'Aiko', blurb: '' },
    ]);
    if (!block.includes('[World Index — in play]')) return 'missing header';
    if (!block.includes('Place: Docks')) return 'missing place line';
    const ctx = {
      placeId: 'r1',
      bag: new Set(['fukuoka', 'docks']),
      typed: {
        place: new Set(['fukuoka', 'docks']),
        person: new Set(['aiko']),
        object: new Set(),
        mood: new Set(['tense']),
        era: new Set(),
      },
      inSceneNames: ['Aiko'],
      haystack: 'at the docks in fukuoka',
    };
    const placeScore = scoreEntity({
      id: 'place:r1',
      kind: 'place',
      title: 'Docks',
      blurb: '',
      tags: [{ type: 'place', value: 'Fukuoka' }],
      refs: { module: 'backstage', uid: 'r1' },
      weight: 8,
    }, ctx);
    if (placeScore <= 0) return 'active place should score';
    const noise = scoreEntity({
      id: 'lore:x',
      kind: 'lore',
      title: 'Unrelated',
      blurb: '',
      tags: [{ type: 'term', value: 'zebra-only' }],
      refs: { module: 'library' },
      weight: 1,
    }, ctx);
    if (noise > 0) return 'unrelated lore should not score';
    return '';
  } catch (err) {
    return String(err?.message || err);
  }
}
