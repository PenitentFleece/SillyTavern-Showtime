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

export const LOCATION_GROUP_KINDS = Object.freeze([
  { id: 'country', label: 'Country / Region', compassKind: 'region', rank: 2 },
  { id: 'city', label: 'City', compassKind: 'settlement', rank: 3 },
  { id: 'area', label: 'Area / District', compassKind: 'district', rank: 4 },
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

export function ingestLocationNames(storage, names = []) {
  const cat = ensureLocationCatalog(storage);
  const nodes = nodesOf(cat);
  for (const raw of names || []) {
    const name = String(raw || '').trim();
    if (!name) continue;
    if (findByName(nodes, name)) continue;
    const id = uniqueNodeId(nodes, name);
    nodes[id] = { id, name, kind: '', parentId: '', placeId: '' };
  }
  cat.nodes = nodes;
  return cat;
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
  let node = (placeId && findByPlaceId(nodes, placeId)) || findByName(nodes, n);
  if (!node) {
    const id = uniqueNodeId(nodes, n);
    node = { id, name: n, kind: '', parentId: '', placeId: '' };
    nodes[id] = node;
  }
  node.name = n;
  if (kind && LOCATION_GROUP_KINDS.some(k => k.id === kind)) node.kind = kind;
  if (placeId) node.placeId = String(placeId);
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

export function formatCatalogPath(storage, node) {
  if (!node) return '';
  const cat = ensureLocationCatalog(storage);
  const nodes = nodesOf(cat);
  const names = [node.name, ...ancestorNames(nodes, node)].filter(Boolean);
  return names.join(', ');
}

/**
 * Clapper / sonar label: Building, Area, City, Country (Room)
 * Room / unit names stay in parentheses and never outrank a building.
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
    const chain = geographicAncestors(compass, place.id, { includeSelf: true });
    const names = chain.map(p => String(p.name || '').trim()).filter(Boolean);
    const roomish = ROOMISH_PLACE_KIND_SET.has(place.kind);
    const roomName = roomish ? String(place.name || '').trim() : '';
    const core = names.join(', ');
    if (core && roomName && !names.some(n => n.toLowerCase() === roomName.toLowerCase())) {
      return `${core} (${roomName})`;
    }
    return core || roomName || String(key || '').trim() || '—';
  }
  if (storage && key) {
    const node = findLocationNodeByName(storage, key);
    if (node) return formatCatalogPath(storage, node) || node.name;
  }
  return String(key || '').trim() || '—';
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
