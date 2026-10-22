// World Index — derived cross-cut over Showtime authoring views.
// Views (Cast / Set / Script / Library / Inventory / Visuals / Composer) remain
// the source of truth. This module only reads, scores, and formats for retrieval.

import { getContext } from '../../../../extensions.js';
import { eventSource, event_types } from '../../../../../script.js';
import { getCastMembers, getStarMember, normalizeCastPresence } from './castCatalog.js';
import { listVisibleLibraryLeaves } from './libraryCatalog.js';
import { getSceneCards, getScriptDb, presentYearHint, sceneCardYear } from './scriptCatalog.js';
import {
  ensureCompass,
  getActiveRoom,
  findPlaceIdByKey,
} from './compass/state.js';
import { isTransitVehicleKey } from './travelState.js';
import { ensureNow, seedPlaceId } from './nowSidecar.js';
import { listAllSetPieces } from './compass/schema.js';
import { placeNeighborhood, smokePlaceNeighborhoodPure } from './placeNeighborhood.js';
import { normalizeFacets, flattenFacets, COMPOSER_FACETS } from './keywordFacets.js';
import { normalizeVisuals } from './backgrounds.js';
import { memoBrief } from './uiPerf.js';
import { expandScriptSeeds, shelfOrderedUids } from './scriptDag.js';
import { withShowtimeProfile } from './connectionProfile.js';
import { leanQuietGenerate } from './isolatedGen.js';
import { parseJsonObject } from './jsonExtract.js';
import { stripReceiptWrap } from './receipt.js';
import { formatChatLine } from './castAudit.js';
import { playMessagesSince } from './chatTrack.js';

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
  retrieveMode: 'keyword',
  topN: 5,
  charBudget: 2500,
  blurbMax: 90,
  sceneBlurb: 240,
  back: 2,
  forward: 1,
  cap: 8,
});

function clampInt(n, min, max, fallback) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(max, Math.round(v)));
}

export function normalizeWorldIndex(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const picks = src.lastPicks && typeof src.lastPicks === 'object' ? src.lastPicks : {};
  const asIds = (v) => (Array.isArray(v) ? v : []).map(x => String(x || '').trim()).filter(Boolean);
  return {
    retrieveMode: src.retrieveMode === 'llm' ? 'llm' : 'keyword',
    topN: clampInt(src.topN, 1, 24, WORLD_INDEX_DEFAULTS.topN),
    charBudget: clampInt(src.charBudget, 400, 12000, WORLD_INDEX_DEFAULTS.charBudget),
    back: clampInt(src.back, 0, 8, WORLD_INDEX_DEFAULTS.back),
    forward: clampInt(src.forward, 0, 4, WORLD_INDEX_DEFAULTS.forward),
    cap: clampInt(src.cap, 2, 20, WORLD_INDEX_DEFAULTS.cap),
    lastPicks: {
      scenes: asIds(picks.scenes),
      lore: asIds(picks.lore),
      at: Number(picks.at) || 0,
    },
  };
}

export function worldIndexSettings(storage) {
  try {
    const st = storage.getChat('backstage', {});
    st.worldIndex = normalizeWorldIndex(st.worldIndex);
    return st.worldIndex;
  } catch {
    return normalizeWorldIndex();
  }
}

export function parseWorldIndexAudit(payload) {
  const src = payload && typeof payload === 'object' ? payload : {};
  const asIds = (v) => (Array.isArray(v) ? v : []).map(x => String(x || '').trim()).filter(Boolean);
  return { scenes: asIds(src.scenes), lore: asIds(src.lore) };
}

/** Word-start substring match (Script inject style). */
export function keysMatchHay(keys, haystack) {
  if (!keys?.length || !haystack) return false;
  const hay = String(haystack).toLowerCase();
  const wordChar = /[\p{L}\p{N}_]/u;
  return keys.some((k) => {
    const key = String(k || '').trim().toLowerCase();
    if (!key) return false;
    for (let i = hay.indexOf(key); i !== -1; i = hay.indexOf(key, i + 1)) {
      if (i === 0 || !wordChar.test(hay[i - 1]) || !wordChar.test(key[0])) return true;
    }
    return false;
  });
}

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

const WORD_RE = /[a-z0-9][a-z0-9'-]*/gi;

function addNameTokens(set, name) {
  const t = String(name || '').trim().toLowerCase();
  if (!t) return;
  set.add(t);
  for (const part of t.split(/[^\p{L}\p{N}']+/u).filter(Boolean)) {
    if (part.length >= 2) set.add(part);
  }
}

/** Whole-word tokens from prose. Length ≥ 4, plus explicit proper names of any length. */
export function tokenizeText(text, properNames = []) {
  const set = new Set();
  for (const raw of String(text || '').match(WORD_RE) || []) {
    const w = raw.toLowerCase();
    if (w.length >= 4) set.add(w);
  }
  for (const n of properNames || []) addNameTokens(set, n);
  return set;
}

function wholeWordHit(tokens, value) {
  const v = String(value || '').trim().toLowerCase();
  if (!v || !tokens?.size) return false;
  if (tokens.has(v)) return true;
  const parts = v.match(WORD_RE) || [];
  if (!parts.length) return false;
  if (parts.length === 1) return tokens.has(parts[0]);
  return parts.every(p => tokens.has(p));
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
      if (c.priority === 'star' && c.presence === 'absent') continue;
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
        presence: normalizeCastPresence(c),
      });
    }
  } catch { /* ignore */ }
  return out;
}

function adaptScenes(storage) {
  const out = [];
  try {
    for (const { uid, title, code, card } of getSceneCards(storage)) {
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
        blurb: clipBlurb(card.summary || card.content || card.body || card.text || '', WORLD_INDEX_DEFAULTS.sceneBlurb),
        tags,
        refs: { module: 'script', path: 'cards', uid },
        weight: card.pinned ? 7 : 2,
        pinned: !!card.pinned,
        year: sceneCardYear(card, storage),
        code: String(code || '').trim(),
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
        loc,
        placeId: '',
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
        loc: 'set',
        placeId: it.placeId || '',
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
  const out = [
    ...adaptPlaces(storage),
    ...adaptPeople(storage),
    ...adaptScenes(storage),
    ...adaptLore(storage),
    ...adaptItems(storage),
    ...adaptBackdrops(storage),
  ];
  return out;
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

function recentChatText(maxMsgs = 12) {
  try {
    const chat = getContext()?.chat || [];
    return chat.slice(-maxMsgs).map(m => String(m?.mes || m?.name || '')).join('\n');
  } catch {
    return '';
  }
}

function recentSpeakerNames(maxMsgs = 12) {
  const names = [];
  try {
    const chat = getContext()?.chat || [];
    for (const m of chat.slice(-maxMsgs)) {
      if (m?.is_user) continue;
      const n = String(m?.name || '').trim();
      if (n) names.push(n);
    }
  } catch { /* ignore */ }
  return names;
}

function livePeople(storage, chatTokens) {
  const inPlay = [];
  const writtenOut = new Set();
  try {
    for (const c of getCastMembers(storage)) {
      if (!c?.id || c.priority === 'director') continue;
      const name = String(c.name || '').trim();
      if (!name) continue;
      const presence = normalizeCastPresence(c);
      if (presence === 'writtenOut') {
        writtenOut.add(name.toLowerCase());
        continue;
      }
      if (presence === 'absent') {
        const aliases = [name, ...(c.aliases || [])];
        if (aliases.some(a => wholeWordHit(chatTokens, a))) inPlay.push(name);
        continue;
      }
      inPlay.push(name);
      for (const a of c.aliases || []) {
        const t = String(a || '').trim();
        if (t) inPlay.push(t);
      }
    }
  } catch { /* ignore */ }
  try {
    const star = getStarMember(storage);
    if (star?.name && star.presence !== 'absent') inPlay.push(star.name);
  } catch { /* ignore */ }
  for (const n of recentSpeakerNames()) {
    if (!writtenOut.has(n.toLowerCase())) inPlay.push(n);
  }
  const inSceneNames = [...new Set(inPlay.map(n => String(n).trim()).filter(Boolean))];
  return { inSceneNames, writtenOut };
}

function reasonOf(ctx, uid) {
  const id = String(uid || '').trim();
  if (!id) return '';
  const r = ctx?.neighborhoodReasons;
  if (r instanceof Map) return r.get(id) || '';
  if (r && typeof r === 'object') return r[id] || '';
  if (ctx?.placeId && id === ctx.placeId) return 'active-room';
  return '';
}

export { placeNeighborhood, smokePlaceNeighborhoodPure };

/** Seed place for Index neighborhood. Prefers sidecar occupancy over leftover activeRoom. */
export function occupancySeedPlaceId(compass, travel) {
  const fromNow = seedPlaceId(compass, travel);
  if (fromNow) return fromNow;
  const t = travel && typeof travel === 'object' ? travel : {};
  if (t.mode === 'moving') return '';
  const active = getActiveRoom(compass);
  return active?.id || String(compass?.sonar?.lastPlaceId || '').trim();
}

/**
 * @param {object} storage
 * @param {{ cellId?: string }} [opts]
 */
export function buildWorldContext(storage, opts = {}) {
  let placeId = '';
  let placeName = '';
  let placeTags = [];
  let neighborhoodIds = new Set();
  let neighborhoodReasons = new Map();
  let neighborhoodTags = [];
  try {
    const st = storage.getChat('backstage', {});
    const compass = ensureCompass(st);
    let travel = st.trackers?.scene?.travel;
    try { travel = ensureNow(storage).doc.occupancy; } catch { /* ignore */ }
    const seedId = occupancySeedPlaceId(compass, travel);
    const nb = seedId ? placeNeighborhood(compass, seedId) : { seedId: '', ids: new Set(), reasons: new Map(), tags: [] };
    placeId = nb.seedId;
    neighborhoodIds = nb.ids;
    neighborhoodReasons = nb.reasons;
    neighborhoodTags = nb.tags;
    const seed = placeId ? compass.rooms?.[placeId] : null;
    if (seed) {
      placeName = seed.name || '';
      placeTags = [...(seed.locationTags || [])];
    }
  } catch { /* ignore */ }

  const facets = mergeComposerFacets(storage);
  const chatText = recentChatText(12);
  const haystack = chatText.toLowerCase();
  const chatTokens = tokenizeText(chatText);
  const people = livePeople(storage, chatTokens);
  const proper = [
    ...people.inSceneNames,
    placeName,
    ...neighborhoodTags,
    ...flattenFacets(facets, COMPOSER_FACETS),
  ];
  const tokens = tokenizeText(chatText, proper);

  const narrativeTags = [
    ...flattenFacets(facets, COMPOSER_FACETS),
    ...neighborhoodTags,
    ...placeTags,
    placeName,
  ].filter(Boolean);

  const bag = lowerSet(narrativeTags);
  const typed = {
    place: lowerSet([...facets.location, ...neighborhoodTags, ...placeTags, placeName]),
    person: lowerSet([...facets.characters, ...people.inSceneNames]),
    object: lowerSet(facets.objects),
    mood: lowerSet(facets.mood),
    era: lowerSet(facets.datetime),
  };

  let present = { lockPresentYear: true, year: null, presentUid: '' };
  try { present = presentYearHint(storage); } catch { /* ignore */ }

  const _wiCtx = {
    placeId,
    placeName,
    cellId: String(opts.cellId || '').toUpperCase(),
    locationTags: neighborhoodTags,
    neighborhoodIds,
    neighborhoodReasons,
    neighborhoodTags: lowerSet(neighborhoodTags),
    facets,
    narrativeTags,
    bag,
    typed,
    tokens,
    haystack,
    inSceneNames: people.inSceneNames,
    writtenOut: people.writtenOut,
    lockPresentYear: present.lockPresentYear !== false,
    presentYear: present.year,
    presentUid: present.presentUid || '',
  };
  return _wiCtx;
}

// ─── scoring / pick ───────────────────────────────────────────────────────────

function typedBagFor(type, ctx) {
  const t = String(type || '').toLowerCase();
  if (t === 'place') return ctx.typed?.place;
  if (t === 'person') return ctx.typed?.person;
  if (t === 'object') return ctx.typed?.object;
  if (t === 'mood') return ctx.typed?.mood;
  if (t === 'era' || t === 'event') return ctx.typed?.era;
  return null;
}

function noteReason(reasons, id) {
  if (!reasons.includes(id)) reasons.push(id);
}

/**
 * @param {WorldEntity} entity
 * @param {ReturnType<typeof buildWorldContext>} ctx
 * @returns {{ score: number, reasons: string[] }}
 */
export function rankEntity(entity, ctx) {
  if (!entity) return { score: 0, reasons: [] };
  if (entity.kind === 'backdrop') return { score: 0, reasons: [] };

  const reasons = [];
  const titleLow = String(entity.title || '').toLowerCase();

  if (entity.kind === 'person') {
    if (entity.presence === 'writtenOut' || ctx.writtenOut?.has?.(titleLow)) {
      return { score: 0, reasons: [] };
    }
    if (entity.presence === 'absent') {
      const named = wholeWordHit(ctx.tokens, entity.title)
        || (entity.tags || []).some(t => t.type === 'person' && wholeWordHit(ctx.tokens, t.value));
      if (!named) return { score: 0, reasons: [] };
    }
  }

  let score = Number(entity.weight) || 0;
  let matched = false;

  if (entity.kind === 'place') {
    const why = reasonOf(ctx, entity.refs?.uid)
      || (ctx.placeId && entity.refs?.uid === ctx.placeId ? 'active-room' : '');
    if (why) {
      score += why === 'active-room' ? 24 : why === 'ancestor' ? 18 : 14;
      matched = true;
      noteReason(reasons, why);
    }
  }

  if (entity.kind === 'item' && entity.loc === 'set' && ctx.placeId && entity.placeId === ctx.placeId) {
    score += 10;
    matched = true;
    noteReason(reasons, 'place');
  }

  if (entity.kind === 'person') {
    if ((ctx.inSceneNames || []).some(n => n.toLowerCase() === titleLow)) {
      score += 18;
      matched = true;
      noteReason(reasons, 'presence');
    }
  }

  if (entity.kind === 'scene' && ctx.presentUid && entity.refs?.uid === ctx.presentUid) {
    score += 10;
    matched = true;
    noteReason(reasons, 'present-scene');
  }

  if (entity.kind === 'scene' && ctx.neighborhoodTags instanceof Set) {
    const locHit = (entity.tags || []).some((t) => {
      const type = String(t.type || '').toLowerCase();
      const val = String(t.value || '').toLowerCase();
      if (!val) return false;
      if (type !== 'place' && type !== 'location') return false;
      return ctx.neighborhoodTags.has(val);
    });
    if (locHit) {
      score += 12;
      matched = true;
      noteReason(reasons, 'place');
    }
  }

  for (const t of entity.tags || []) {
    const type = String(t.type || '').toLowerCase();
    const val = String(t.value || '').toLowerCase();
    if (!val) continue;
    if (type === 'term' && /^(static|mobile|set|container|star|lead|major|foil|minor|supporting)$/.test(val)) continue;
    const typedBag = typedBagFor(type, ctx);
    if (typedBag?.has(val)) {
      score += 12;
      matched = true;
      noteReason(reasons, 'token');
    } else if (ctx.bag?.has(val) && val.length >= 4) {
      score += 6;
      matched = true;
      noteReason(reasons, 'token');
    }
    if (val.length >= 4 && wholeWordHit(ctx.tokens, val)) {
      score += 6;
      matched = true;
      noteReason(reasons, 'token');
    }
  }

  if (entity.title && wholeWordHit(ctx.tokens, entity.title)) {
    score += 5;
    matched = true;
    noteReason(reasons, 'token');
  }

  if ((entity.kind === 'scene' || entity.kind === 'lore') && ctx.haystack) {
    const keys = [
      entity.title,
      ...(entity.tags || []).map(t => t.value),
    ].filter(Boolean);
    if (keysMatchHay(keys, ctx.haystack)) {
      score += 14;
      matched = true;
      noteReason(reasons, 'keyword');
    }
  }

  if (entity.kind === 'scene' && matched) {
    if (entity.pinned) {
      score += 8;
      noteReason(reasons, 'present-scene');
    }
    if (ctx.presentYear && entity.year === ctx.presentYear) {
      score += 6;
      noteReason(reasons, 'present-scene');
    }
  }
  if (entity.kind === 'scene' && ctx.lockPresentYear && ctx.presentYear && entity.year && entity.year !== ctx.presentYear) {
    score -= 4;
  }

  if (!matched) return { score: 0, reasons: [] };
  if (score <= 0) return { score: 0, reasons: [] };
  return { score, reasons };
}

/** Numeric score for smoke / callers that only need a number. */
export function scoreEntity(entity, ctx) {
  return rankEntity(entity, ctx).score;
}

function scriptWalkCards(storage) {
  try {
    return (getScriptDb(storage).cards || []).filter(c =>
      c?.uid && c.kind !== 'folder' && c.active !== false);
  } catch {
    return [];
  }
}

function matchNeedle(list, needle, fields) {
  const n = String(needle || '').trim().toLowerCase();
  if (!n) return null;
  return list.find((row) => fields.some((fn) => {
    const v = String(fn(row) || '').trim().toLowerCase();
    return v && v === n;
  })) || null;
}

function packEntity(row, extraReasons = []) {
  const reasons = [...(row.reasons || []), ...extraReasons];
  return { ...row.e, _score: row.s, _reasons: reasons };
}

/**
 * @param {object} storage
 * @param {{ topN?: number, charBudget?: number, cellId?: string, context?: object, settings?: object }} [opts]
 */
export function pickWorldEntities(storage, opts = {}) {
  const settings = normalizeWorldIndex(opts.settings || worldIndexSettings(storage));
  const topN = Math.max(1, Number(opts.topN) || settings.topN);
  const charBudget = Math.max(400, Number(opts.charBudget) || settings.charBudget);
  const ctx = opts.context || buildWorldContext(storage, { cellId: opts.cellId });
  const entities = listWorldEntities(storage).filter(e => e.kind !== 'backdrop');
  const cards = scriptWalkCards(storage);

  const scored = entities.map((e) => {
    const r = rankEntity(e, ctx);
    return { e, s: r.score, reasons: r.reasons };
  });
  const byKind = { place: [], person: [], scene: [], lore: [], item: [] };
  for (const row of scored) {
    if (byKind[row.e.kind]) byKind[row.e.kind].push(row);
  }
  for (const k of Object.keys(byKind)) {
    byKind[k].sort((a, b) => b.s - a.s || a.e.title.localeCompare(b.e.title));
  }

  const llmOn = settings.retrieveMode === 'llm';
  const llmScenes = llmOn ? settings.lastPicks.scenes : [];
  const llmLore = llmOn ? settings.lastPicks.lore : [];

  let sceneSeeds = [];
  if (llmScenes.length) {
    sceneSeeds = llmScenes
      .map(n => matchNeedle(cards, n, [c => c.uid, c => c.title])?.uid)
      .filter(Boolean);
  }
  if (!sceneSeeds.length) {
    sceneSeeds = byKind.scene
      .filter(x => x.s > 0)
      .slice(0, Math.max(2, Math.ceil(topN / 2)))
      .map(x => x.e.refs?.uid)
      .filter(Boolean);
  }

  const expanded = expandScriptSeeds(cards, sceneSeeds, {
    back: settings.back,
    forward: settings.forward,
    cap: settings.cap,
  });
  const sceneUidSet = new Set([...expanded.seeds, ...expanded.extra]);
  const entityByUid = new Map(byKind.scene.map(r => [r.e.refs?.uid, r]));
  const sceneEntities = [];
  for (const uid of shelfOrderedUids(cards)) {
    if (!sceneUidSet.has(uid)) continue;
    const card = cards.find(c => c.uid === uid);
    const row = entityByUid.get(uid);
    const blurb = clipBlurb(card?.summary || card?.content || row?.e.blurb || '', WORLD_INDEX_DEFAULTS.sceneBlurb);
    if (row) {
      sceneEntities.push({ ...packEntity(row, ['dag']), blurb });
    } else if (card) {
      sceneEntities.push({
        id: `scene:${uid}`,
        kind: 'scene',
        title: String(card.title || 'Scene').trim() || 'Scene',
        blurb,
        tags: [],
        refs: { module: 'script', path: 'cards', uid },
        weight: 2,
        _score: 1,
        _reasons: ['dag'],
      });
    }
  }

  const restCap = Math.max(3, topN);
  const scoredRest = ['place', 'person', 'item'].flatMap(k => byKind[k].filter(x => x.s > 0));
  const rest = [];
  const seenKind = new Set();
  const seenId = new Set();
  for (const row of scoredRest) {
    if (seenKind.has(row.e.kind)) continue;
    rest.push(packEntity(row));
    seenKind.add(row.e.kind);
    seenId.add(row.e.id);
  }
  for (const row of scoredRest) {
    if (rest.length >= restCap) break;
    if (seenId.has(row.e.id)) continue;
    rest.push(packEntity(row));
    seenId.add(row.e.id);
  }

  let loreRows = [];
  if (llmLore.length) {
    for (const needle of llmLore) {
      const hit = matchNeedle(byKind.lore, needle, [
        r => r.e.title,
        r => r.e.refs?.path,
        r => r.e.refs?.uid,
      ]);
      if (hit) loreRows.push(packEntity(hit, ['llm']));
    }
  }
  if (!loreRows.length) {
    loreRows = byKind.lore.filter(x => x.s > 0).slice(0, 4).map(r => packEntity(r));
  }

  const ordered = [
    ...rest.filter(e => e.kind === 'place'),
    ...rest.filter(e => e.kind === 'person'),
    ...sceneEntities,
    ...loreRows,
    ...rest.filter(e => e.kind === 'item'),
  ];

  const out = [];
  let used = 0;
  for (const e of ordered) {
    const allowBlurb = e.kind === 'scene' || e.kind === 'lore';
    const line = formatKindLine(e.kind, [e], { activePlaceId: ctx.placeId, allowBlurb });
    if (used + line.length > charBudget && out.length) break;
    out.push(e);
    used += line.length;
  }
  return out;
}

export function collectWorldIndexSceneSeeds(storage, opts = {}) {
  try {
    return pickWorldEntities(storage, opts)
      .filter(e => e.kind === 'scene')
      .map(e => e.refs?.uid)
      .filter(Boolean);
  } catch {
    return [];
  }
}

function sceneHead(e) {
  const code = String(e.code || '').trim();
  const title = String(e.title || '').trim();
  if (code && title && !title.toLowerCase().startsWith(code.toLowerCase())) return `${code} ${title}`;
  return title || code || 'Scene';
}

function formatKindLine(kind, rows, { activePlaceId = '', allowBlurb = false } = {}) {
  if (!rows?.length) return '';
  if (kind === 'person') return `People · ${rows.map(e => e.title).join(', ')}`;
  if (kind === 'place') return `Place · ${rows.map(e => e.title).join(', ')}`;
  const label = KIND_LABEL[kind] || kind;
  return rows.map(e => {
    const head = kind === 'scene' ? sceneHead(e) : e.title;
    const skipPlaceBlurb = kind === 'place' || (kind === 'place' && e.refs?.uid === activePlaceId);
    const blurb = allowBlurb && !skipPlaceBlurb && e.blurb ? ` — ${e.blurb}` : '';
    return `${label} · ${head}${blurb}`;
  }).join('\n');
}

/** Prompt block for the injector. Empty string when nothing relevant. */
export function formatWorldIndexPrompt(entities, opts = {}) {
  if (!entities?.length) return '';
  const activePlaceId = opts.activePlaceId || '';
  const byKind = { place: [], person: [], scene: [], lore: [], item: [] };
  for (const e of entities) {
    if (byKind[e.kind]) byKind[e.kind].push(e);
  }
  const lines = [];
  if (byKind.place.length) {
    lines.push(formatKindLine('place', byKind.place, { activePlaceId, allowBlurb: false }));
  }
  if (byKind.person.length) {
    lines.push(formatKindLine('person', byKind.person, { allowBlurb: false }));
  }
  for (const e of byKind.scene) {
    const blurb = e.blurb ? ` — ${e.blurb}` : '';
    lines.push(`Scene · ${sceneHead(e)}${blurb}`);
  }
  for (const e of byKind.lore) {
    const blurb = e.blurb ? ` — ${e.blurb}` : '';
    lines.push(`Lore · ${e.title}${blurb}`);
  }
  for (const e of byKind.item) {
    lines.push(`Item · ${e.title}`);
  }
  const body = lines.filter(Boolean).join('\n');
  return body ? `[In play]\n${body}` : '';
}

/**
 * One-shot: pick + format for injection.
 * @param {object} storage
 * @param {object} [opts]
 */
export function buildWorldIndexInjection(storage, opts = {}) {
  try {
    const ctx = opts.context || buildWorldContext(storage, { cellId: opts.cellId });
    const settings = opts.settings || worldIndexSettings(storage);
    const picked = pickWorldEntities(storage, { ...opts, context: ctx, settings });
    return formatWorldIndexPrompt(picked, { activePlaceId: ctx.placeId });
  } catch (err) {
    console.warn('[Showtime/WorldIndex] inject failed', err);
    return '';
  }
}

export async function runWorldIndexAudit(storage, { bus } = {}) {
  let st;
  try {
    st = storage.getChat('backstage', {});
    st.worldIndex = normalizeWorldIndex(st.worldIndex);
  } catch {
    return null;
  }
  if (st.worldIndex.retrieveMode !== 'llm') return null;

  const cards = scriptWalkCards(storage);
  const sceneRoster = shelfOrderedUids(cards).map((uid) => {
    const c = cards.find(x => x.uid === uid);
    if (!c) return '';
    const keys = (c.keywords || []).slice(0, 6).join(', ');
    return `- ${c.uid} | ${c.title || ''} | ${c.span || ''} | ${keys} | ${clipBlurb(c.summary || c.content, 80)}`;
  }).filter(Boolean).slice(0, 40).join('\n');

  let loreRoster = '';
  try {
    loreRoster = listVisibleLibraryLeaves(storage).slice(0, 40).map((l) => {
      const key = l.key || l.uid || l.id || l.title;
      const keys = (l.keys || []).slice(0, 6).join(', ');
      return `- ${key} | ${l.title || ''} | ${keys} | ${clipBlurb(l.content, 80)}`;
    }).join('\n');
  } catch { /* ignore */ }

  const chat = getContext()?.chat || [];
  const n = chat.filter(m => m && !m.is_system).length;
  if (!n || st.worldIndex.lastAuditMsgCount === n) return st.worldIndex.lastPicks || null;
  if (!sceneRoster && !loreRoster) {
    st.worldIndex.lastAuditMsgCount = n;
    return st.worldIndex.lastPicks || null;
  }
  const rows = playMessagesSince(chat, Math.max(0, n - 6));
  const sceneClip = rows
    .map(m => formatChatLine({ ...m, mes: stripReceiptWrap(m?.mes) }, 480))
    .filter(Boolean)
    .join('\n')
    .slice(0, 1800);
  if (!sceneClip) return st.worldIndex.lastPicks || null;
  st.worldIndex.lastAuditMsgCount = n;

  const prompt = `Pick Script cards and Library leaves relevant to the latest scene. Return ONLY JSON.
{"scenes":["uid or title"],"lore":["key or title"]}
Max 6 each. Prefer story-order neighbors of what just happened. Empty arrays if none.

Latest scene:
${sceneClip || '(none)'}

Script (story order):
${sceneRoster || '(none)'}

Library:
${loreRoster || '(none)'}`;

  let raw = '';
  try {
    raw = String(await withShowtimeProfile(storage, 'index', () =>
      leanQuietGenerate(prompt, { kind: 'filing' })) ?? '').trim();
  } catch (err) {
    console.warn('[Showtime/WorldIndex] audit generate failed', err);
  }

  let picks = parseWorldIndexAudit(parseJsonObject(raw));
  if (!picks.scenes.length && !picks.lore.length) {
    const live = pickWorldEntities(storage, {
      settings: { ...st.worldIndex, retrieveMode: 'keyword', lastPicks: { scenes: [], lore: [], at: 0 } },
    });
    picks = {
      scenes: live.filter(e => e.kind === 'scene').map(e => e.refs?.uid).filter(Boolean),
      lore: live.filter(e => e.kind === 'lore').map(e => e.title).filter(Boolean),
    };
  }
  st.worldIndex.lastPicks = { scenes: picks.scenes.slice(0, 8), lore: picks.lore.slice(0, 8), at: Date.now() };
  try { storage.saveChat(); } catch { /* ignore */ }
  bus?.emit('showtime.stateChanged');
  return st.worldIndex.lastPicks;
}

/** Register always-on injector rule `world.index`. */
export function registerWorldIndexInjection(injector, storage, opts = {}) {
  if (!injector || !storage) return;
  // Rebuilt on every state change and every generation start; the scan itself
  // walks every cast member, library leaf, place, card and item.
  const build = memoBrief(() => {
    try {
      const root = (typeof opts.houseRoot === 'function' ? opts.houseRoot() : opts.houseRoot) || {};
      if (root.masterOff) return '';
      const cellId = typeof opts.cellId === 'function' ? opts.cellId() : opts.cellId;
      return buildWorldIndexInjection(storage, { ...opts, cellId });
    } catch {
      return '';
    }
  }, 700);
  try {
    if (event_types?.GENERATION_STARTED) {
      eventSource.on(event_types.GENERATION_STARTED, () => build.invalidate());
    }
    if (event_types?.CHAT_CHANGED) {
      eventSource.on(event_types.CHAT_CHANGED, () => build.invalidate());
    }
  } catch { /* ignore */ }
  injector.register({
    id: 'world.index',
    always: true,
    heavy: true,
    buildText: () => build(),
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
  const settings = worldIndexSettings(storage);
  let rows = [];
  try {
    rows = pickWorldEntities(storage, { cellId, settings });
  } catch {
    rows = [];
  }
  const why = (e) => {
    const bits = Array.isArray(e._reasons) && e._reasons.length ? e._reasons : [];
    const score = `score ${Math.round(e._score || 0)}`;
    return bits.length ? `${bits.join(' · ')} · ${score}` : score;
  };
  const body = rows.length
    ? `<ul class="bst-wi-list">${rows.map(e => `
        <li class="bst-wi-item" data-kind="${safe(e.kind)}">
          <span class="bst-wi-kind">${safe(KIND_LABEL[e.kind] || e.kind)}</span>
          <strong class="bst-wi-title">${safe(e.title)}</strong>
          ${e.blurb ? `<span class="bst-wi-blurb">${safe(e.blurb)}</span>` : ''}
          <span class="bst-k">${safe(why(e))}</span>
        </li>`).join('')}</ul>`
    : `<div class="bst-empty">Nothing ranked for the current context — tag places, cast, script, or library leaves.</div>`;

  return `
    <section class="bst-section bst-wi-preview">
      <h3 class="bst-section-h">World Index</h3>
      <p class="bst-hint">Keyword / context is the default. LLM audit runs after each AI post and injects on the next generate — it uses the World Index connection profile (Backstage → Settings; empty falls back to Filing). Script hits stay in DAG order.</p>
      <div class="bst-wi-controls">
        <label>Retrieve
          <select data-wi="retrieveMode">
            <option value="keyword"${settings.retrieveMode !== 'llm' ? ' selected' : ''}>Keyword / context</option>
            <option value="llm"${settings.retrieveMode === 'llm' ? ' selected' : ''}>LLM audit per post</option>
          </select>
        </label>
        <label>Top N
          <input type="number" min="1" max="24" data-wi="topN" value="${safe(String(settings.topN))}">
        </label>
        <label>Budget
          <input type="number" min="400" max="12000" step="100" data-wi="charBudget" value="${safe(String(settings.charBudget))}">
        </label>
      </div>
      ${body}
    </section>`;
}

function smokeCtx(over = {}) {
  const neighborhoodReasons = new Map([['r1', 'active-room']]);
  return {
    placeId: 'r1',
    bag: new Set(['fukuoka', 'docks']),
    typed: {
      place: new Set(['fukuoka', 'docks']),
      person: new Set(['aiko']),
      object: new Set(),
      mood: new Set(['tense']),
      era: new Set(),
    },
    tokens: tokenizeText('at the docks in fukuoka', ['Aiko', 'Docks', 'Fukuoka']),
    haystack: 'at the docks in fukuoka',
    inSceneNames: ['Aiko'],
    writtenOut: new Set(),
    lockPresentYear: true,
    presentYear: 2024,
    presentUid: '',
    neighborhoodIds: new Set(['r1']),
    neighborhoodReasons,
    neighborhoodTags: new Set(['fukuoka', 'docks']),
    ...over,
  };
}

/** Lightweight pure checks (no storage / DOM). Returns '' on success, else error text. */
export function smokeWorldIndexPure() {
  try {
    const tags = toWorldTags({ location: ['Fukuoka'], mood: ['Tense'], characters: ['Aiko'] });
    if (!tags.some(t => t.type === 'place' && t.value === 'Fukuoka')) return 'facet map failed';
    if (formatWorldIndexPrompt([]) !== '') return 'empty prompt should be blank';
    const block = formatWorldIndexPrompt([
      { kind: 'place', title: 'Docks', blurb: 'Salt air', refs: { uid: 'r1' } },
      { kind: 'person', title: 'Aiko', blurb: '' },
    ], { activePlaceId: 'r1' });
    if (!block.includes('[In play]')) return 'missing header';
    if (!block.includes('Place · Docks')) return 'missing place line';
    if (block.includes('Salt air')) return 'active place should not reprint Compass blurb';

    const ctx = smokeCtx();
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
      weight: 8,
    }, ctx);
    if (noise > 0) return 'unrelated high-weight lore should not score';

    const falseHit = scoreEntity({
      id: 'place:x',
      kind: 'place',
      title: 'Dock',
      blurb: '',
      tags: [{ type: 'place', value: 'dock' }],
      refs: { module: 'backstage', uid: 'x' },
      weight: 2,
    }, smokeCtx({
      placeId: '',
      bag: new Set(),
      typed: { place: new Set(), person: new Set(), object: new Set(), mood: new Set(), era: new Set() },
      tokens: tokenizeText('the docksand warehouse hummed'),
      inSceneNames: [],
    }));
    if (falseHit > 0) return 'short substring should not score';

    const gone = scoreEntity({
      id: 'person:ren',
      kind: 'person',
      title: 'Ren',
      blurb: '',
      tags: [{ type: 'person', value: 'Ren' }],
      refs: { module: 'cast', uid: 'ren' },
      weight: 6,
      presence: 'writtenOut',
    }, ctx);
    if (gone > 0) return 'written-out person should not score';

    if (keysMatchHay(['zebra-only'], 'the docks hummed')) return 'keyword miss should stay 0';
    if (!keysMatchHay(['docks'], 'at the docks in fukuoka')) return 'keyword should match word-start';
    const dagCards = [
      { uid: 'a', kind: 'card', parentUid: null, sortIndex: 0, createdAt: 1, title: 'First', summary: 'open', keywords: ['alpha'], followsUids: [], dependsUids: [], active: true },
      { uid: 'b', kind: 'card', parentUid: null, sortIndex: 1, createdAt: 2, title: 'Second', summary: 'follow', keywords: ['beta'], followsUids: ['a'], dependsUids: [], active: true },
    ];
    const walked = expandScriptSeeds(dagCards, ['b'], { back: 2, forward: 0, cap: 8 });
    if (!walked.extra.includes('a')) return 'dag walk should pull follows predecessor';
    const dagOrder = shelfOrderedUids(dagCards).filter(id => id === 'b' || walked.extra.includes(id));
    if (dagOrder.join(',') !== 'a,b') return 'dag order of two Follows-linked cards';
    const parsedAudit = parseWorldIndexAudit({ scenes: ['b', ' First '], lore: ['Ledger', ''] });
    if (parsedAudit.scenes.join(',') !== 'b,First' || parsedAudit.lore.join(',') !== 'Ledger') {
      return 'stub LLM parse';
    }
    const expandedFromParse = expandScriptSeeds(dagCards, parsedAudit.scenes, { back: 2, forward: 0, cap: 8 });
    if (!expandedFromParse.seeds.includes('b') || !expandedFromParse.extra.includes('a')) {
      return 'stub LLM parse + expand';
    }

    const nbErr = smokePlaceNeighborhoodPure();
    if (nbErr) return nbErr;

    const rooms = {
      jp: { id: 'jp', name: 'Japan', kind: 'region', parentId: '' },
      fk: { id: 'fk', name: 'Fukuoka', kind: 'settlement', parentId: 'jp' },
      mall: { id: 'mall', name: 'Canal City Mall', kind: 'district', parentId: 'fk' },
      shop: { id: 'shop', name: 'Okisato Antiques', kind: 'building', parentId: 'mall' },
      rm: { id: 'rm', name: 'Shop Floor', kind: 'room', parentId: 'shop', links: [{ toPlaceId: 'hall' }] },
      hall: { id: 'hall', name: 'Stock Hall', kind: 'room', parentId: 'shop' },
      tokyo: { id: 'tokyo', name: 'Tokyo', kind: 'settlement', parentId: 'jp' },
    };
    const nb = placeNeighborhood({ rooms }, 'rm');

    const walkCtx = smokeCtx({
      placeId: 'rm',
      bag: lowerSet(nb.tags),
      typed: {
        place: lowerSet(nb.tags),
        person: new Set(),
        object: new Set(),
        mood: new Set(),
        era: new Set(),
      },
      tokens: tokenizeText('on the shop floor'),
      inSceneNames: [],
      neighborhoodIds: nb.ids,
      neighborhoodReasons: nb.reasons,
      neighborhoodTags: lowerSet(nb.tags),
    });
    const cityScore = scoreEntity({
      id: 'place:fk', kind: 'place', title: 'Fukuoka', blurb: '', tags: [{ type: 'place', value: 'Fukuoka' }],
      refs: { module: 'backstage', uid: 'fk' }, weight: 2,
    }, walkCtx);
    const tokyoScore = scoreEntity({
      id: 'place:tokyo', kind: 'place', title: 'Tokyo', blurb: '', tags: [{ type: 'place', value: 'Tokyo' }],
      refs: { module: 'backstage', uid: 'tokyo' }, weight: 8,
    }, walkCtx);
    if (cityScore <= 0) return 'parent city should score from the walk';
    if (tokyoScore > 0) return 'unrelated country/city should not score';

    const seedCompass = {
      activeRoomId: 'apt',
      sonar: { lastPlaceId: 'apt' },
      rooms: {
        apt: { id: 'apt', name: 'Fukuoka Heights', kind: 'building' },
        stn: { id: 'stn', name: 'Fukuoka Central', kind: 'building' },
      },
    };
    if (occupancySeedPlaceId(seedCompass, { mode: 'compass' }) !== 'apt') {
      return 'compass occupancy should seed active room';
    }
    if (occupancySeedPlaceId(seedCompass, {
      mode: 'compass', placeKey: 'Fukuoka Central', placeId: 'stn',
    }) !== 'stn') {
      return 'sidecar compass should seed occupancy place not leftover active room';
    }
    if (occupancySeedPlaceId(seedCompass, { mode: 'moving', destKey: 'flight' }) !== '') {
      return 'moving vehicle dest should not seed the apartment';
    }
    if (occupancySeedPlaceId(seedCompass, { mode: 'moving', destKey: 'Fukuoka Central' }) !== 'stn') {
      return 'moving dest place should seed dest not the apartment';
    }
    const movingSkip = rankEntity({
      id: 'place:apt',
      kind: 'place',
      title: 'Fukuoka Heights',
      blurb: '',
      tags: [{ type: 'place', value: 'Fukuoka Heights' }],
      refs: { module: 'backstage', uid: 'apt' },
      weight: 8,
    }, smokeCtx({
      placeId: '',
      neighborhoodIds: new Set(),
      neighborhoodReasons: new Map(),
      neighborhoodTags: new Set(),
      bag: new Set(),
      typed: { place: new Set(), person: new Set(), object: new Set(), mood: new Set(), era: new Set() },
      tokens: tokenizeText('west platform at the station'),
      haystack: 'west platform at the station',
      inSceneNames: [],
    }));
    if (movingSkip.score > 0) return 'moving neighborhood skip should not rank the old apartment';

    return '';
  } catch (err) {
    return String(err?.message || err);
  }
}
