// Nested location groups — country → city → area → building.
// Compass geographic places sync into this tree; rooms stay off the tag bag
// and only appear parenthetically on the clapper / sonar label.

import {
  GEO_PLACE_KIND_SET,
  ROOMISH_PLACE_KIND_SET,
  normalizeTagList,
  slugifyId,
} from './compass/schema.js';
import { bindLocationTagEditor } from './locationTagPicker.js';
import { flattenFacets } from './keywordFacets.js';
import { getScriptDb } from './scriptCatalog.js';
import { getLibraryChat, getLibraryGlobal } from './libraryCatalog.js';

export const LOCATION_GROUP_KINDS = Object.freeze([
  { id: 'country', label: 'Country', compassKind: 'region', rank: 2 },
  { id: 'city', label: 'City / Region', compassKind: 'settlement', rank: 3 },
  { id: 'area', label: 'Area / Neighborhood', compassKind: 'district', rank: 4 },
  { id: 'building', label: 'Building', compassKind: 'building', rank: 5 },
]);

const COMPASS_TO_GROUP = Object.freeze({
  region: 'country',
  settlement: 'city',
  district: 'area',
  building: 'building',
});

const GROUP_TO_COMPASS = Object.freeze({
  country: 'region',
  city: 'settlement',
  area: 'district',
  building: 'building',
});

const PARENT_KINDS = Object.freeze({
  country: [],
  city: ['country'],
  area: ['city'],
  building: ['area', 'city'],
});

const KIND_RANK = Object.freeze({
  country: 2,
  region: 2,
  city: 3,
  settlement: 3,
  area: 4,
  district: 4,
  building: 5,
  unit: 6,
  room: 6,
  transitional: 6,
});

function backstage(storage) {
  return storage?.getChat?.('backstage', {}) || {};
}

function nodesOf(cat) {
  return cat?.nodes && typeof cat.nodes === 'object' ? cat.nodes : {};
}

function findByName(nodes, name) {
  const k = String(name || '').trim().toLowerCase();
  if (!k) return null;
  return Object.values(nodes).find(n => String(n?.name || '').toLowerCase() === k) || null;
}

function findByPlaceId(nodes, placeId) {
  const id = String(placeId || '').trim();
  if (!id) return null;
  return Object.values(nodes).find(n => String(n?.placeId || '') === id) || null;
}

function uniqueNodeId(nodes, name) {
  const base = slugifyId(name) || `loc_${Date.now().toString(36)}`;
  if (!nodes[base]) return base;
  let n = 2;
  while (nodes[`${base}_${n}`]) n += 1;
  return `${base}_${n}`;
}

function kindLabel(kind) {
  return LOCATION_GROUP_KINDS.find(k => k.id === kind)?.label
    || String(kind || '').trim()
    || 'Place';
}

export function locationKeyRank(kind) {
  const k = String(kind || '').trim().toLowerCase();
  return KIND_RANK[k] || 1;
}

export function geographicAncestors(compass, placeId, { includeSelf = false } = {}) {
  const rooms = compass?.rooms || {};
  const start = rooms[placeId];
  const out = [];
  const guard = new Set();
  let cur = includeSelf ? start : (start ? rooms[start.parentId] : null);
  while (cur && !guard.has(cur.id)) {
    guard.add(cur.id);
    if (GEO_PLACE_KIND_SET.has(cur.kind)) out.push(cur);
    cur = cur.parentId ? rooms[cur.parentId] : null;
  }
  return out;
}

export function mostPreciseGeoPlace(compass, place) {
  if (!place) return null;
  if (GEO_PLACE_KIND_SET.has(place.kind)) return place;
  return geographicAncestors(compass, place.id)[0] || null;
}

export function inheritGeographicTags(compass, {
  name,
  kind,
  parentId,
  locationTags = [],
} = {}) {
  const extra = normalizeTagList(locationTags);
  const out = [];
  const seen = new Set();
  const push = (t) => {
    const s = String(t || '').trim();
    if (!s) return;
    const k = s.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push(s);
  };
  if (GEO_PLACE_KIND_SET.has(String(kind || '').trim().toLowerCase())) push(name);
  extra.forEach(push);
  let walk = String(parentId || '').trim();
  const guard = new Set();
  const rooms = compass?.rooms || {};
  while (walk && !guard.has(walk)) {
    guard.add(walk);
    const p = rooms[walk];
    if (!p) break;
    if (GEO_PLACE_KIND_SET.has(p.kind) && p.name) push(p.name);
    walk = p.parentId || '';
  }
  return out;
}

export function refreshPlaceLocationTags(compass, placeId) {
  const room = compass?.rooms?.[placeId];
  if (!room) return;
  const ancestorNames = new Set(
    geographicAncestors(compass, placeId).map(p => String(p.name || '').toLowerCase()),
  );
  const own = String(room.name || '').toLowerCase();
  const extras = (room.locationTags || []).filter((t) => {
    const k = String(t || '').toLowerCase();
    return k && k !== own && !ancestorNames.has(k);
  });
  room.locationTags = inheritGeographicTags(compass, {
    name: room.name,
    kind: room.kind,
    parentId: room.parentId,
    locationTags: extras,
  });
}

function isDescendantOf(compass, placeId, ancestorId) {
  const rooms = compass?.rooms || {};
  let walk = rooms[placeId]?.parentId;
  const guard = new Set();
  while (walk && !guard.has(walk)) {
    if (walk === ancestorId) return true;
    guard.add(walk);
    walk = rooms[walk]?.parentId || '';
  }
  return false;
}

export function refreshDescendantLocationTags(compass, rootId) {
  if (!compass?.rooms || !rootId) return;
  for (const r of Object.values(compass.rooms)) {
    if (r.id === rootId) continue;
    if (isDescendantOf(compass, r.id, rootId)) refreshPlaceLocationTags(compass, r.id);
  }
}

function normalizeNode(raw, id) {
  const name = String(raw?.name || '').trim();
  if (!name) return null;
  const kind = LOCATION_GROUP_KINDS.some(k => k.id === raw?.kind) ? raw.kind : String(raw?.kind || '').trim();
  return {
    id: String(raw?.id || id || '').trim() || uniqueNodeId({}, name),
    name,
    kind,
    parentId: String(raw?.parentId || '').trim(),
    placeId: String(raw?.placeId || '').trim(),
  };
}

function syncFromCompass(cat, compass) {
  const nodes = nodesOf(cat);
  const rooms = compass?.rooms || {};
  for (const node of Object.values(nodes)) {
    const linked = node.placeId ? rooms[node.placeId] : null;
    if (linked && !GEO_PLACE_KIND_SET.has(linked.kind)) node.kind = '';
  }
  for (const place of Object.values(rooms)) {
    if (!GEO_PLACE_KIND_SET.has(place?.kind)) continue;
    const kind = COMPASS_TO_GROUP[place.kind] || '';
    const name = String(place.name || '').trim();
    if (!name) continue;
    let node = findByPlaceId(nodes, place.id) || findByName(nodes, name);
    if (!node) {
      const id = `place:${place.id}`;
      node = { id, name, kind, parentId: '', placeId: place.id };
      nodes[id] = node;
    } else {
      node.name = name;
      if (kind) node.kind = kind;
      node.placeId = place.id;
      if (node.id !== `place:${place.id}` && !nodes[`place:${place.id}`]) {
        // keep existing id so parent links stay stable
      }
    }
    const geoParent = geographicAncestors(compass, place.id)[0];
    if (geoParent) {
      const pNode = findByPlaceId(nodes, geoParent.id) || findByName(nodes, geoParent.name);
      node.parentId = pNode && pNode.id !== node.id ? pNode.id : '';
    } else {
      node.parentId = '';
    }
  }
  cat.nodes = nodes;
}

export function ingestLocationNames(storage, names = [], compass = null) {
  const cat = ensureLocationCatalog(storage, compass);
  const nodes = nodesOf(cat);
  const exact = new Set(
    Object.values(compass?.rooms || {})
      .map(p => String(p?.name || '').trim().toLowerCase())
      .filter(Boolean),
  );
  const aliasOnly = new Set();
  for (const p of Object.values(compass?.rooms || {})) {
    for (const a of p.aliases || []) {
      const k = String(a || '').trim().toLowerCase();
      if (k && !exact.has(k)) aliasOnly.add(k);
    }
  }
  for (const raw of names || []) {
    const name = String(raw || '').trim();
    if (!name) continue;
    const k = name.toLowerCase();
    if (aliasOnly.has(k)) continue;
    if (findByName(nodes, name)) continue;
    const id = uniqueNodeId(nodes, name);
    nodes[id] = { id, name, kind: '', parentId: '', placeId: '' };
  }
  cat.nodes = nodes;
  pruneGhostLocationNodes(storage, compass);
  return cat;
}

/** Drop merge leftovers: catalog rows that only exist as another place's alias, or that point at a differently named place. */
export function pruneGhostLocationNodes(storage, compass = null) {
  const cat = ensureLocationCatalog(storage, compass);
  const nodes = nodesOf(cat);
  const rooms = compass?.rooms || {};
  const exact = new Set(
    Object.values(rooms).map(p => String(p?.name || '').trim().toLowerCase()).filter(Boolean),
  );
  const aliasOnly = new Set();
  for (const p of Object.values(rooms)) {
    for (const a of p.aliases || []) {
      const k = String(a || '').trim().toLowerCase();
      if (k && !exact.has(k)) aliasOnly.add(k);
    }
  }
  let changed = false;
  for (const node of Object.values(nodes)) {
    const k = String(node.name || '').trim().toLowerCase();
    const linked = node.placeId ? rooms[node.placeId] : null;
    if (linked && String(linked.name || '').trim().toLowerCase() !== k) {
      node.placeId = '';
      changed = true;
    }
  }
  for (const [id, node] of Object.entries(nodes)) {
    const k = String(node.name || '').trim().toLowerCase();
    if (!k) continue;
    const linked = node.placeId ? rooms[node.placeId] : null;
    if (linked) continue;
    if (!node.kind && aliasOnly.has(k) && !exact.has(k)) {
      const parentId = node.parentId && nodes[node.parentId] && node.parentId !== id
        ? node.parentId
        : '';
      for (const n of Object.values(nodes)) {
        if (n.parentId === id) n.parentId = parentId === n.id ? '' : parentId;
      }
      delete nodes[id];
      changed = true;
    }
  }
  if (changed) cat.nodes = nodes;
  return changed;
}

export function ensureLocationCatalog(storage, compass = null) {
  const st = backstage(storage);
  if (!st.locations || typeof st.locations !== 'object') st.locations = { nodes: {} };
  if (!st.locations.nodes || typeof st.locations.nodes !== 'object') st.locations.nodes = {};
  const cleaned = {};
  for (const [id, raw] of Object.entries(st.locations.nodes)) {
    const node = normalizeNode(raw, id);
    if (node) cleaned[node.id] = node;
  }
  st.locations.nodes = cleaned;
  const stage = compass || st.stage || null;
  if (stage?.rooms) syncFromCompass(st.locations, stage);
  return st.locations;
}

export function syncLocationCatalogFromCompass(storage, compass) {
  return ensureLocationCatalog(storage, compass);
}

export function upsertLocationNode(storage, {
  name,
  kind = '',
  parentId = '',
  placeId = '',
} = {}) {
  const cat = ensureLocationCatalog(storage);
  const n = String(name || '').trim();
  if (!n) throw new Error('Location name is required.');
  const nodes = nodesOf(cat);
  const want = n.toLowerCase();
  let byPlace = placeId ? findByPlaceId(nodes, placeId) : null;
  const byName = findByName(nodes, n);
  if (byPlace && String(byPlace.name || '').toLowerCase() !== want && byName && byName.id !== byPlace.id) {
    byPlace = null;
  }
  let node = byPlace || byName;
  if (!node) {
    const id = uniqueNodeId(nodes, n);
    node = { id, name: n, kind: '', parentId: '', placeId: '' };
    nodes[id] = node;
  }
  node.name = n;
  if (kind && LOCATION_GROUP_KINDS.some(k => k.id === kind)) node.kind = kind;
  if (placeId && (!byPlace || node.id === byPlace.id)) node.placeId = String(placeId);
  const pid = String(parentId || '').trim();
  if (pid && pid !== node.id && nodes[pid]) {
    let walk = pid;
    const guard = new Set();
    let cyclic = false;
    while (walk && !guard.has(walk)) {
      if (walk === node.id) { cyclic = true; break; }
      guard.add(walk);
      walk = nodes[walk]?.parentId || '';
    }
    if (!cyclic) node.parentId = pid;
  } else if (!pid) {
    node.parentId = '';
  }
  cat.nodes = nodes;
  return node;
}

function ancestorNames(nodes, node) {
  const out = [];
  let walk = node?.parentId;
  const guard = new Set();
  while (walk && !guard.has(walk)) {
    guard.add(walk);
    const p = nodes[walk];
    if (!p) break;
    if (p.name) out.push(p.name);
    walk = p.parentId;
  }
  return out;
}

function treeOrder(nodes) {
  const children = new Map();
  for (const n of Object.values(nodes)) {
    const p = n.parentId && nodes[n.parentId] ? n.parentId : '';
    if (!children.has(p)) children.set(p, []);
    children.get(p).push(n);
  }
  for (const list of children.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name));
  }
  const out = [];
  const walk = (parentId, depth) => {
    for (const n of children.get(parentId) || []) {
      if (out.some(x => x.id === n.id)) continue;
      out.push({ ...n, depth });
      walk(n.id, depth + 1);
    }
  };
  walk('', 0);
  for (const n of Object.values(nodes)) {
    if (!out.some(x => x.id === n.id)) out.push({ ...n, depth: 0 });
  }
  return out;
}

export function listLocationTree(storage, compass = null) {
  const cat = ensureLocationCatalog(storage, compass);
  return treeOrder(nodesOf(cat));
}

export function locationChoices(storage) {
  const cat = ensureLocationCatalog(storage);
  const nodes = nodesOf(cat);
  return treeOrder(nodes).map((n) => {
    const parents = ancestorNames(nodes, n);
    const hintParts = [];
    if (n.kind) hintParts.push(kindLabel(n.kind).split(' / ')[0].toLowerCase());
    if (parents[0]) hintParts.push(`in ${parents[0]}`);
    const group = parents.length ? parents[parents.length - 1] : (n.kind ? kindLabel(n.kind) : 'Ungrouped');
    const indent = `${'  '.repeat(n.depth || 0)}`;
    return {
      value: n.name,
      label: `${indent}${n.name}`.trim(),
      hint: hintParts.join(' · '),
      keys: [...new Set([n.name, ...parents].map(s => String(s).toLowerCase()))],
      kind: n.kind,
      parentId: n.parentId,
      group,
      id: n.id,
    };
  });
}

export function locationParentOptions(storage, kind = '') {
  const cat = ensureLocationCatalog(storage);
  const nodes = nodesOf(cat);
  const allow = PARENT_KINDS[kind];
  return treeOrder(nodes)
    .filter(n => n.kind)
    .filter(n => !allow || !allow.length || allow.includes(n.kind))
    .map(n => ({
      id: n.id,
      name: n.name,
      kind: n.kind,
      label: `${n.name} (${kindLabel(n.kind)})`,
    }));
}

export function findLocationNodeByName(storage, name) {
  const cat = ensureLocationCatalog(storage);
  return findByName(nodesOf(cat), name);
}

export function findLocationNodeById(storage, id) {
  const cat = ensureLocationCatalog(storage);
  return nodesOf(cat)[String(id || '').trim()] || null;
}

export function findLocationNodeByPlaceId(storage, placeId) {
  const cat = ensureLocationCatalog(storage);
  return findByPlaceId(nodesOf(cat), placeId);
}

function locKey(s) {
  return String(s || '').trim().toLowerCase();
}

function pushUniqueName(list, value) {
  const s = String(value || '').trim();
  if (!s) return;
  const k = locKey(s);
  if (list.some(x => locKey(x) === k)) return;
  list.push(s);
}

/** Names that identify this Places row (not inherited geo tags). */
export function collectLocationIdentity(storage, compass, {
  placeId = '',
  nodeId = '',
  name = '',
} = {}) {
  const names = [];
  const place = placeId ? compass?.rooms?.[placeId] : null;
  if (place) {
    pushUniqueName(names, place.name);
    for (const a of place.aliases || []) pushUniqueName(names, a);
  }
  const cat = ensureLocationCatalog(storage);
  const nodes = nodesOf(cat);
  const node = (nodeId && nodes[nodeId])
    || (placeId && findByPlaceId(nodes, placeId))
    || findByName(nodes, name)
    || null;
  if (node) pushUniqueName(names, node.name);
  pushUniqueName(names, name);
  return {
    names,
    keys: new Set(names.map(locKey)),
    node,
    place: place || null,
  };
}

function rewriteNameList(list, { keys, replaceWith = '', dropMatches = false } = {}) {
  const dest = String(replaceWith || '').trim();
  const out = [];
  const seen = new Set();
  for (const raw of list || []) {
    const s = String(raw || '').trim();
    if (!s) continue;
    const k = locKey(s);
    let next = s;
    if (keys.has(k)) {
      if (dropMatches || !dest) continue;
      next = dest;
    }
    const nk = locKey(next);
    if (!nk || seen.has(nk)) continue;
    seen.add(nk);
    out.push(next);
  }
  return out;
}

function rewritePlaceTags(tags, { keys, replaceWith = '' } = {}) {
  if (!Array.isArray(tags)) return tags;
  const dest = String(replaceWith || '').trim();
  const out = [];
  const seen = new Set();
  for (const raw of tags) {
    const type = String(raw?.type || '').trim().toLowerCase();
    const value = String(raw?.value ?? raw?.text ?? '').trim();
    if (!type || !value) continue;
    let nextVal = value;
    if ((type === 'place' || type === 'location') && keys.has(locKey(value))) {
      if (!dest) continue;
      nextVal = dest;
    }
    const id = `${type}\u241f${locKey(nextVal)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ ...raw, type: raw.type || type, value: nextVal });
  }
  return out;
}

/**
 * Strip or rename a location's identifying tags across Script, Library,
 * Composer, backgrounds, and other Compass places.
 */
export function rewriteLocationTagNames(storage, compass, {
  removeKeys = [],
  replaceWith = '',
  skipAliasPlaceIds = [],
} = {}) {
  const keys = new Set([...removeKeys].map(locKey).filter(Boolean));
  const dest = String(replaceWith || '').trim();
  const destKey = locKey(dest);
  if (destKey) keys.delete(destKey);
  if (!keys.size) return;
  const skipAliases = new Set((skipAliasPlaceIds || []).map(String));

  try {
    const db = getScriptDb(storage);
    for (const card of db.cards || []) {
      const facets = card.keywordFacets || {};
      if (Array.isArray(facets.location)) {
        facets.location = rewriteNameList(facets.location, { keys, replaceWith: dest });
        card.keywordFacets = facets;
      }
      if (Array.isArray(card.keywords)) {
        try { card.keywords = flattenFacets(card.keywordFacets); } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }

  try {
    const st = getLibraryChat(storage);
    for (const rec of Object.values(st.filing || {})) {
      if (Array.isArray(rec?.tags)) rec.tags = rewritePlaceTags(rec.tags, { keys, replaceWith: dest });
    }
    for (const rec of st.native || []) {
      if (Array.isArray(rec?.tags)) rec.tags = rewritePlaceTags(rec.tags, { keys, replaceWith: dest });
    }
    const g = getLibraryGlobal(storage);
    for (const [book, tags] of Object.entries(g.bookTags || {})) {
      g.bookTags[book] = rewritePlaceTags(tags, { keys, replaceWith: dest });
    }
    storage.saveGlobal();
  } catch { /* ignore */ }

  const patchComposer = (blob) => {
    if (!blob?.sceneFacets || !Array.isArray(blob.sceneFacets.location)) return;
    blob.sceneFacets.location = rewriteNameList(blob.sceneFacets.location, { keys, replaceWith: dest });
  };
  try { patchComposer(storage.getChat('composer', {})); } catch { /* ignore */ }
  try {
    patchComposer(storage.getGlobal('composer', {}));
    storage.saveGlobal();
  } catch { /* ignore */ }

  try {
    const st = backstage(storage);
    for (const bg of st.visuals?.backgrounds || []) {
      if (Array.isArray(bg.locationTags)) {
        bg.locationTags = rewriteNameList(bg.locationTags, { keys, replaceWith: dest });
      }
    }
  } catch { /* ignore */ }

  for (const place of Object.values(compass?.rooms || {})) {
    if (Array.isArray(place.locationTags)) {
      place.locationTags = rewriteNameList(place.locationTags, { keys, replaceWith: dest });
    }
    if (Array.isArray(place.aliases) && !skipAliases.has(String(place.id))) {
      place.aliases = rewriteNameList(place.aliases, { keys, replaceWith: dest, dropMatches: true });
    }
  }
}

export function removeLocationNode(storage, nodeId) {
  const cat = ensureLocationCatalog(storage);
  const nodes = nodesOf(cat);
  const node = nodes[String(nodeId || '').trim()];
  if (!node) return false;
  const parentId = node.parentId && nodes[node.parentId] && node.parentId !== node.id
    ? node.parentId
    : '';
  for (const n of Object.values(nodes)) {
    if (n.parentId === node.id) n.parentId = parentId === n.id ? '' : parentId;
  }
  delete nodes[node.id];
  cat.nodes = nodes;
  return true;
}

export function mergeLocationNodes(storage, sourceId, targetId) {
  const cat = ensureLocationCatalog(storage);
  const nodes = nodesOf(cat);
  const src = nodes[String(sourceId || '').trim()];
  const dst = nodes[String(targetId || '').trim()];
  if (!src) return dst || null;
  if (!dst || src.id === dst.id) {
    if (src && !dst) delete nodes[src.id];
    cat.nodes = nodes;
    return dst || null;
  }
  for (const n of Object.values(nodes)) {
    if (n.parentId === src.id) n.parentId = dst.id === n.id ? '' : dst.id;
  }
  if (src.placeId && !dst.placeId) dst.placeId = src.placeId;
  delete nodes[src.id];
  cat.nodes = nodes;
  return dst;
}

/** How many geo tags the clapper / inject show — the two most precise. */
export const SCENE_LOCATION_DEPTH = 2;

/** First segment of a stored clapper label (old saves stored the full path). */
export function locationKeyFromStored(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const noRoom = s.replace(/\s*\([^)]*\)\s*$/, '').trim();
  return (noRoom.split(',')[0] || s).trim();
}

/** Most precise geo names for a place, country last. Caps at `depth`. */
export function lowestLocationNames(compass, place, { depth = SCENE_LOCATION_DEPTH } = {}) {
  if (!place) return [];
  const cap = Math.max(1, Number(depth) || SCENE_LOCATION_DEPTH);
  return geographicAncestors(compass, place.id, { includeSelf: true })
    .map(p => String(p.name || '').trim())
    .filter(Boolean)
    .slice(0, cap);
}

export function formatCatalogPath(storage, node, { depth = SCENE_LOCATION_DEPTH } = {}) {
  if (!node) return '';
  const cat = ensureLocationCatalog(storage);
  const nodes = nodesOf(cat);
  const cap = Math.max(1, Number(depth) || SCENE_LOCATION_DEPTH);
  const names = [node.name, ...ancestorNames(nodes, node)].filter(Boolean).slice(0, cap);
  return names.join(', ');
}

/**
 * Clapper / sonar label: the two lowest geo tags (building + area, or
 * whatever is next if those are missing). Room / unit names stay in
 * parentheses and never outrank a building.
 */
export function formatSceneLocation({
  compass = null,
  storage = null,
  placeId = '',
  key = '',
} = {}) {
  const rooms = compass?.rooms || {};
  const place = placeId ? rooms[placeId] : null;
  if (place) {
    const names = lowestLocationNames(compass, place);
    const roomish = ROOMISH_PLACE_KIND_SET.has(place.kind);
    const roomName = roomish ? String(place.name || '').trim() : '';
    const core = names.join(', ');
    if (core && roomName && !names.some(n => n.toLowerCase() === roomName.toLowerCase())) {
      return `${core} (${roomName})`;
    }
    return core || roomName || String(key || '').trim() || '—';
  }
  if (storage && key) {
    const needle = locationKeyFromStored(key);
    const node = findLocationNodeByName(storage, needle) || findLocationNodeByName(storage, key);
    if (node) return formatCatalogPath(storage, node) || node.name;
  }
  return locationKeyFromStored(key) || String(key || '').trim() || '—';
}

export function mostPreciseGeoName(compass, place) {
  const geo = mostPreciseGeoPlace(compass, place);
  return String(geo?.name || '').trim();
}

export function bindLocationCatalogPicker(wrap, storage, extra = {}) {
  return bindLocationTagEditor(wrap, {
    getKnown: () => locationChoices(storage),
    createKinds: LOCATION_GROUP_KINDS,
    getParents: (kind) => locationParentOptions(storage, kind),
    onCreate: (spec) => {
      const node = upsertLocationNode(storage, spec);
      try { storage.saveChat(); } catch { /* ignore */ }
      return node.name;
    },
    multi: true,
    ...extra,
  });
}

export { GROUP_TO_COMPASS, COMPASS_TO_GROUP, PARENT_KINDS };

export function smokeSceneLocationPure() {
  const rooms = {
    jp: { id: 'jp', name: 'Japan', kind: 'region', parentId: '' },
    fk: { id: 'fk', name: 'Fukuoka', kind: 'settlement', parentId: 'jp' },
    mall: { id: 'mall', name: 'Canal City Mall', kind: 'district', parentId: 'fk' },
    shop: { id: 'shop', name: 'Okisato Antiques', kind: 'building', parentId: 'mall' },
    rm: { id: 'rm', name: 'Shop Floor', kind: 'room', parentId: 'shop' },
  };
  const compass = { rooms };
  const shop = formatSceneLocation({ compass, placeId: 'shop' });
  if (shop !== 'Okisato Antiques, Canal City Mall') return `shop: ${shop}`;
  const room = formatSceneLocation({ compass, placeId: 'rm' });
  if (room !== 'Okisato Antiques, Canal City Mall (Shop Floor)') return `room: ${room}`;
  const city = formatSceneLocation({ compass, placeId: 'fk' });
  if (city !== 'Fukuoka, Japan') return `city: ${city}`;
  const country = formatSceneLocation({ compass, placeId: 'jp' });
  if (country !== 'Japan') return `country: ${country}`;
  const bits = lowestLocationNames(compass, rooms.shop);
  if (bits.join('|') !== 'Okisato Antiques|Canal City Mall') return `bits: ${bits.join('|')}`;
  if (locationKeyFromStored('Okisato Antiques, Canal City Mall, Fukuoka, Japan') !== 'Okisato Antiques') {
    return 'stored key';
  }
  return '';
}
