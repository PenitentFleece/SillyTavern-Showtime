// Room Compass — chat-scoped state mutators (lives under backstage.stage).

import {
  COMPASS_VERSION,
  createRoom,
  defaultCompassState,
  normalizeCell,
  normalizeCompassState,
  normalizeSonar,
  normalizeFacing,
  normalizeExitDir,
  normalizeKind,
  normalizeWall,
  normalizeOpeningType,
  normalizeTagList,
  normalizeRoom,
  normalizePiece,
  normalizeCellLayer,
  snapshotRoom,
  uid,
  isLoadableKind,
  isSuiteHostKind,
  isExteriorHostKind,
  isCompassPlaceKind,
  GEO_PLACE_KIND_SET,
  buildPlaceTree,
  placeMatchesLocationTags,
  slugifyId,
  OPPOSITE_WALL,
  CARDINAL_TO_EDGE,
  EDGE_TO_CARDINAL,
  WALL_EDGE_CELLS,
  cellForWallAlong,
  CELLS,
  CELL_LAYER_IDS,
  listCellPieces,
  syncExitsFromLinks,
  normalizeFootprint,
  normalizeInternalWall,
  normalizeSuiteLayout,
  normalizeSuitePose,
} from './schema.js';
import {
  ensureSuiteChildPoses,
  findContactingPairs,
  findCornerJunctions,
  listSuiteChildren,
  listSuiteUnits,
  snapChildAmongSiblings,
  suiteStoryMap,
  inferStoryFromName,
  suiteUnitOuterSilhouette,
  SUITE_SNAP_TOL,
  alignSuiteContactGeometry,
  worldPolygon,
  edgesFacingCardinal,
  reshapeFaceWorld,
  sharedPairForEdge,
  sharedPairsForEdge,
  packWorldPolygon,
  unionAdjacentPolygons,
  worldEdgeCardinal,
  worldFromNorm,
  worldToFootprintNorm,
} from './suiteLayout.js';
import { edgeCardinal, insertVertexOnEdge, isCollinearVertex, removeVertexAt } from './floorplan.js';
import {
  narrativeLocationTags,
  refreshPlaceLocationTags,
  keepNarrativeLocationTags,
  refreshDescendantLocationTags,
  ensureLocationCatalog,
  geographicAncestors,
} from '../locationCatalog.js';
import { dropMatchedUnlisted } from './unlisted.js';

const MAX_CHANGES = 8;
/** Live compass objects already migrated this session — skip clone-all-rooms. */
const READY_COMPASS = new WeakSet();

function suiteHostId(compass, placeId) {
  const room = compass?.rooms?.[String(placeId || '').trim()];
  if (!room) return '';
  if (isSuiteHostKind(room.kind)) return room.id;
  const parent = compass?.rooms?.[room.parentId];
  if (parent && isSuiteHostKind(parent.kind)) return parent.id;
  return '';
}

function captureSuiteSnapshot(compass, unitId) {
  const unit = compass.rooms[unitId];
  const children = listSuiteChildren(compass, unitId);
  const rooms = {};
  for (const child of children) rooms[child.id] = snapshotRoom(child);
  return {
    childIds: children.map(c => c.id),
    suiteLayout: JSON.parse(JSON.stringify(normalizeSuiteLayout(unit?.suiteLayout))),
    suiteVisualFootprints: JSON.parse(JSON.stringify(unit?.suiteVisualFootprints || {})),
    rooms,
  };
}

/** Snapshot every suite child + layout so threshold / split / fuse / reshape can be undone. */
export function pushSuiteHistory(compass, unitOrPlaceId, summary) {
  const uid = suiteHostId(compass, unitOrPlaceId);
  if (!uid) return false;
  const unit = compass.rooms[uid];
  if (!unit) return false;
  const stack = Array.isArray(unit.suiteHistory) ? unit.suiteHistory : [];
  stack.push({
    at: Date.now(),
    summary: String(summary || '').trim() || 'change',
    ...captureSuiteSnapshot(compass, uid),
  });
  unit.suiteHistory = stack.length > MAX_CHANGES ? stack.slice(-MAX_CHANGES) : stack;
  return true;
}

export function suiteHistoryPeek(compass, unitId = '') {
  const uid = suiteHostId(compass, unitId);
  const stack = compass?.rooms?.[uid]?.suiteHistory;
  const last = Array.isArray(stack) && stack.length ? stack[stack.length - 1] : null;
  return {
    count: Array.isArray(stack) ? stack.length : 0,
    summary: last?.summary || '',
  };
}

/**
 * Restore the suite (all children + layout) to the last wall/structure snapshot.
 * Recreates rooms dropped by Merge and removes rooms created by Divide.
 */
export function undoSuiteLastChange(compass, unitId = '') {
  const uid = String(unitId || compass.activeRoomId || '').trim();
  const unit = compass.rooms?.[uid];
  if (!unit || !isSuiteHostKind(unit.kind)) throw new Error('Open a suite to undo.');
  const stack = Array.isArray(unit.suiteHistory) ? unit.suiteHistory.slice() : [];
  if (!stack.length) throw new Error('Nothing to undo in this suite.');
  const last = stack.pop();
  const keepIds = new Set((last.childIds || []).map(String));
  for (const child of listSuiteChildren(compass, uid)) {
    if (!keepIds.has(child.id)) delete compass.rooms[child.id];
  }
  for (const id of last.childIds || []) {
    const snap = last.rooms?.[id];
    if (!snap) continue;
    const existing = compass.rooms[id];
    const restored = normalizeRoom({ ...snap, id, parentId: uid });
    restored.recent_changes = existing?.recent_changes || [];
    compass.rooms[id] = restored;
  }
  unit.suiteLayout = last.suiteLayout && typeof last.suiteLayout === 'object' ? last.suiteLayout : {};
  unit.suiteVisualFootprints = last.suiteVisualFootprints && typeof last.suiteVisualFootprints === 'object'
    ? last.suiteVisualFootprints
    : {};
  unit.suiteHistory = stack;
  touch(unit);
  const normalized = normalizeRoom(unit);
  normalized.suiteHistory = stack;
  compass.rooms[uid] = normalized;
  if (compass.activeRoomId && !compass.rooms[compass.activeRoomId]) {
    compass.activeRoomId = uid;
  }
  return { summary: last.summary || '' };
}

/**
 * Read + normalize compass blob from a Backstage chat state object.
 * Mutates `backstage.stage` into compass shape when migrating.
 * @param {object} backstageState
 * @returns {object} compass state
 */
export function ensureCompass(backstageState) {
  if (!backstageState || typeof backstageState !== 'object') {
    return defaultCompassState();
  }
  const raw = backstageState.stage;
  if (raw && typeof raw === 'object' && raw.version === COMPASS_VERSION && READY_COMPASS.has(raw)) {
    keepNarrativeLocationTags(raw);
    return raw;
  }
  // Already v2 — cap undo stacks in place. Do not clone every room on chat load.
  if (raw && typeof raw === 'object' && raw.version === COMPASS_VERSION && raw.rooms && typeof raw.rooms === 'object') {
    for (const room of Object.values(raw.rooms)) {
      if (!room || typeof room !== 'object') continue;
      if (Array.isArray(room.recent_changes) && room.recent_changes.length > MAX_CHANGES) {
        room.recent_changes = room.recent_changes.slice(-MAX_CHANGES);
      }
      if (Array.isArray(room.suiteHistory) && room.suiteHistory.length > MAX_CHANGES) {
        room.suiteHistory = room.suiteHistory.slice(-MAX_CHANGES);
      }
    }
    keepNarrativeLocationTags(raw);
    READY_COMPASS.add(raw);
    backstageState.stage = raw;
    return raw;
  }
  const migrated = normalizeCompassState(raw);
  if (migrated._migrationNote) {
    delete migrated._migrationNote;
  }
  // Defensive: drop undo stacks that somehow stayed nested/huge
  for (const room of Object.values(migrated.rooms || {})) {
    const stack = room.recent_changes || [];
    if (stack.length > MAX_CHANGES) room.recent_changes = stack.slice(-MAX_CHANGES);
    if (Array.isArray(room.suiteHistory) && room.suiteHistory.length > MAX_CHANGES) {
      room.suiteHistory = room.suiteHistory.slice(-MAX_CHANGES);
    }
  }
  backstageState.stage = {
    version: COMPASS_VERSION,
    activeRoomId: migrated.activeRoomId || '',
    rooms: migrated.rooms || {},
    lostAndFound: Array.isArray(migrated.lostAndFound)
      ? migrated.lostAndFound.map(it => normalizePiece(it)).filter(Boolean)
      : (Array.isArray(raw?.lostAndFound)
        ? raw.lostAndFound.map(it => normalizePiece(it)).filter(Boolean)
        : []),
    // Preserve sonar pings across re-normalization — without this, every
    // ensureCompass() call (i.e. nearly every compass action) silently wiped
    // the last-known cast positions back to empty.
    sonar: normalizeSonar(migrated.sonar || raw?.sonar),
    suiteDraft: migrated.suiteDraft ?? null,
  };
  repairSuiteSharedLinks(backstageState.stage);
  keepNarrativeLocationTags(backstageState.stage);
  READY_COMPASS.add(backstageState.stage);
  return backstageState.stage;
}

export function getActiveRoom(compass) {
  const id = compass?.activeRoomId;
  if (!id) return null;
  return compass.rooms?.[id] || null;
}

export function getPlace(compass, placeId) {
  const id = String(placeId || '').trim();
  return compass?.rooms?.[id] || null;
}

const SHOWROOM_SYNONYM_SET = new Set([
  'display floor',
  'display room',
  'display room floor',
  'shop floor',
  'sales floor',
  'showroom',
  'main showroom',
  'storefront',
]);

const SERVICE_CORRIDOR_SYNONYM_SET = new Set([
  'service corridor',
  'delivery hallway',
  'service hall',
  'employee exit corridor',
  'loading bay corridor',
]);

function matchSinglePlaceKey(compass, want) {
  if (!want) return '';
  for (const r of Object.values(compass?.rooms || {})) {
    const id = String(r?.id || '').trim();
    if (id.toLowerCase() === want) return id;
    if (String(r?.name || '').trim().toLowerCase() === want) return id;
    for (const a of r?.aliases || []) {
      if (String(a || '').trim().toLowerCase() === want) return id;
    }
    for (const t of r?.locationTags || []) {
      if (String(t || '').trim().toLowerCase() === want) return id;
    }
  }
  if (SHOWROOM_SYNONYM_SET.has(want)) {
    const activeId = String(compass?.sonar?.lastPlaceId || compass?.activeRoomId || '').trim();
    const rooms = Object.values(compass?.rooms || {}).filter(r =>
      r && /^(main\s+showroom|showroom|display\s+room|display\s+floor|shop\s+floor|sales\s+floor)$/i.test(String(r.name || '').trim()));
    if (rooms.length === 1) return rooms[0].id;
    if (rooms.length > 1 && activeId) {
      const curParent = compass?.rooms?.[activeId]?.parentId || activeId;
      const sibling = rooms.find(r => r.parentId === curParent);
      if (sibling) return sibling.id;
    }
    if (rooms.length) return rooms[0].id;
  }
  if (SERVICE_CORRIDOR_SYNONYM_SET.has(want)) {
    const hit = Object.values(compass?.rooms || {}).find(r =>
      r && /^(service\s+corridor|delivery\s+hallway|service\s+hall)$/i.test(String(r.name || '').trim()));
    if (hit) return hit.id;
  }
  return '';
}

export function findPlaceIdByKey(compass, key) {
  const want = String(key || '').trim().toLowerCase();
  if (!want) return '';
  const direct = matchSinglePlaceKey(compass, want);
  if (direct) return direct;
  const paren = want.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  if (paren) {
    const subId = matchSinglePlaceKey(compass, paren[2].trim());
    if (subId) return subId;
    const parentId = matchSinglePlaceKey(compass, paren[1].trim());
    if (parentId) return parentId;
  }
  const parts = want.split(/\s*(?:·|—|–|\/|->|›)\s*/).map(s => s.trim()).filter(Boolean);
  if (parts.length > 1) {
    for (let i = parts.length - 1; i >= 0; i--) {
      const pid = matchSinglePlaceKey(compass, parts[i]);
      if (pid) return pid;
    }
  }
  return '';
}

function placeHasAncestor(compass, placeId, ancestorId) {
  if (!placeId || !ancestorId) return false;
  const rooms = compass?.rooms || {};
  const guard = new Set();
  let cur = rooms[placeId];
  while (cur && !guard.has(cur.id)) {
    if (cur.id === ancestorId) return true;
    guard.add(cur.id);
    cur = cur.parentId ? rooms[cur.parentId] : null;
  }
  return false;
}

export function defaultStandingChild(compass, unitId) {
  const rooms = Object.values(compass?.rooms || {})
    .filter(r => r && r.parentId === unitId && isLoadableKind(r.kind));
  if (!rooms.length) return null;
  const entry = rooms.find(r => /^(display|shop|sales|store|main|entry|foyer|lobby|front|parlor|living)/i.test(String(r.name || '').trim()));
  return entry || rooms[0];
}

/** Load the compass room + sonar for a compass travel commit. No-op while moving. */
export function syncOccupancyRoom(compass, travel) {
  if (!compass || typeof compass !== 'object') return { loaded: false };
  const t = travel && typeof travel === 'object' ? travel : {};
  if (t.mode !== 'compass') return { loaded: false };
  let placeId = String(t.placeId || '').trim();
  if (!placeId) placeId = findPlaceIdByKey(compass, t.placeKey);
  let place = placeId ? getPlace(compass, placeId) : null;
  if (!place) return { loaded: false };
  if (place.kind === 'unit') {
    const prevId = String(compass.sonar?.lastPlaceId || compass.activeRoomId || '').trim();
    const prevPlace = prevId ? getPlace(compass, prevId) : null;
    if (prevPlace && isLoadableKind(prevPlace.kind) && placeHasAncestor(compass, prevPlace.id, place.id)) {
      place = prevPlace;
    } else {
      const child = defaultStandingChild(compass, place.id);
      if (child) place = child;
    }
  }
  let loaded = false;
  if (isCompassPlaceKind(place.kind)) {
    try {
      loadRoom(compass, place.id);
      loaded = true;
    } catch { /* ignore */ }
  }
  compass.sonar = normalizeSonar(compass.sonar);
  compass.sonar.lastKey = String(t.placeKey || compass.sonar.lastKey || '').trim();
  compass.sonar.lastPlaceId = place.id;
  compass.sonar.lastAt = Date.now();
  return { loaded, placeId: place.id };
}

function touch(room) {
  room.updatedAt = Date.now();
}

function pushChange(room, summary, beforeSnap) {
  room.recent_changes = Array.isArray(room.recent_changes) ? room.recent_changes : [];
  room.recent_changes.push({
    at: Date.now(),
    summary: String(summary || '').trim() || 'change',
    snapshot: beforeSnap,
  });
  if (room.recent_changes.length > MAX_CHANGES) {
    room.recent_changes = room.recent_changes.slice(-MAX_CHANGES);
  }
}

function withRoomMutation(compass, roomId, summary, fn) {
  const room = compass.rooms?.[roomId];
  if (!room) throw new Error(`Place "${roomId}" not found.`);
  const before = snapshotRoom(room);
  const result = fn(room);
  touch(room);
  pushChange(room, summary, before);
  compass.rooms[roomId] = normalizeRoom(room);
  // Any suite "visual align" override cached on the parent unit was welded
  // against this room's *old* footprint — if the room's own shape actually
  // changed (wall drag, split, divide, etc.), that cached override is now
  // stale and must be dropped, or the suite view would render an outdated
  // shape while the individual room shows its current (correct) one.
  if (JSON.stringify(before.footprint) !== JSON.stringify(compass.rooms[roomId].footprint)) {
    invalidateSuiteVisualFootprint(compass, roomId);
  }
  return result;
}

/** Drop a stale suite-visual footprint override for a room whose real shape changed. */
function invalidateSuiteVisualFootprint(compass, roomId) {
  const room = compass.rooms?.[roomId];
  const parentId = room?.parentId || '';
  const unit = parentId ? compass.rooms?.[parentId] : null;
  if (!unit || !isSuiteHostKind(unit.kind)) return;
  if (!unit.suiteVisualFootprints || !(roomId in unit.suiteVisualFootprints)) return;
  const before = snapshotRoom(unit);
  const nextVisuals = { ...unit.suiteVisualFootprints };
  delete nextVisuals[roomId];
  unit.suiteVisualFootprints = nextVisuals;
  touch(unit);
  pushChange(unit, 'suite visual invalidate', before);
  compass.rooms[parentId] = normalizeRoom(unit);
}

/** "Bathroom" when the name is unique; "Bathroom · Upper Unit" when another place shares it. */
export function disambiguatedPlaceName(compass, place) {
  const name = String(place?.name || '').trim() || String(place?.id || '');
  if (!place?.id || !name) return name;
  const key = name.toLowerCase();
  const peers = Object.values(compass?.rooms || {}).filter(p =>
    p && p.id !== place.id && String(p.name || '').trim().toLowerCase() === key);
  if (!peers.length) return name;
  const host = compass?.rooms?.[place.parentId];
  const hostName = String(host?.name || '').trim();
  return hostName ? `${name} · ${hostName}` : name;
}

export function listRooms(compass) {
  return Object.values(compass.rooms || {})
    .map(r => ({
      id: r.id,
      name: r.name,
      kind: r.kind || 'room',
      parentId: r.parentId || '',
      locationTags: r.locationTags || [],
      loadable: isLoadableKind(r.kind),
      active: r.id === compass.activeRoomId,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export { buildPlaceTree, placeMatchesLocationTags, slugifyId, isLoadableKind };

function uniquePlaceId(compass, name) {
  const base = slugifyId(name) || `place_${Date.now().toString(36)}`;
  if (!compass?.rooms?.[base]) return base;
  let n = 2;
  while (compass.rooms[`${base}_${n}`]) n += 1;
  return `${base}_${n}`;
}

export function createAndStoreRoom(compass, {
  id,
  name,
  orientation_note = '',
  description = '',
  kind = 'room',
  parentId = '',
  locationTags = [],
  aliases = [],
  listingCode = '',
  category = '',
  footprint = null,
} = {}) {
  let rid = String(id || '').trim();
  const wantParent = String(parentId || '').trim();
  if (rid && compass.rooms[rid]) {
    const existing = compass.rooms[rid];
    const same = String(existing.name || '').trim().toLowerCase()
      === String(name || rid).trim().toLowerCase();
    const parentOk = !wantParent || String(existing.parentId || '') === wantParent;
    if (same && parentOk) return existing;
    rid = uniquePlaceId(compass, name || rid);
  }
  if (!rid) rid = uniquePlaceId(compass, name);
  const room = createRoom({
    id: rid,
    name,
    orientation_note,
    description,
    kind,
    parentId,
    locationTags: narrativeLocationTags(compass, {
      name: name || rid,
      parentId,
      locationTags,
    }),
    aliases,
    listingCode,
    category,
    footprint,
  });
  if (parentId) {
    if (!compass.rooms[parentId]) throw new Error(`Parent "${parentId}" not found.`);
    if (parentId === room.id) throw new Error('Place cannot parent itself.');
  }
  if (compass.rooms[room.id]) throw new Error(`Place "${room.id}" already exists.`);
  compass.rooms[room.id] = room;
  try { dropMatchedUnlisted(compass); } catch { /* ignore */ }
  return room;
}

export function renamePlace(compass, placeId, name) {
  const result = withRoomMutation(compass, placeId, 'rename', room => {
    const n = String(name || '').trim();
    if (!n) throw new Error('Name is required.');
    const prev = String(room.name || '').trim();
    room.name = n;
    const tags = Array.isArray(room.locationTags) ? [...room.locationTags] : [];
    room.locationTags = tags.map(t =>
      (prev && String(t).toLowerCase() === prev.toLowerCase()) ? n : t);
    refreshPlaceLocationTags(compass, placeId);
  });
  refreshDescendantLocationTags(compass, placeId);
  try { dropMatchedUnlisted(compass); } catch { /* ignore */ }
  return result;
}

export function setPlaceKind(compass, placeId, kind) {
  const result = withRoomMutation(compass, placeId, `kind ${kind}`, room => {
    room.kind = normalizeKind(kind);
    if (compass.activeRoomId === placeId && !isCompassPlaceKind(room.kind)) {
      compass.activeRoomId = '';
    }
    refreshPlaceLocationTags(compass, placeId);
  });
  refreshDescendantLocationTags(compass, placeId);
  return result;
}

export function setParent(compass, placeId, parentId) {
  const pid = String(parentId || '').trim();
  if (pid === placeId) return getPlace(compass, placeId);
  if (pid && !compass.rooms[pid]) throw new Error(`Parent "${pid}" not found.`);
  if (pid) {
    let walk = pid;
    const guard = new Set();
    while (walk) {
      if (walk === placeId) throw new Error('That would create a nesting cycle.');
      if (guard.has(walk)) break;
      guard.add(walk);
      walk = compass.rooms[walk]?.parentId || '';
    }
  }
  const result = withRoomMutation(compass, placeId, `parent ${pid || '(root)'}`, room => {
    room.parentId = pid;
    refreshPlaceLocationTags(compass, placeId);
  });
  refreshDescendantLocationTags(compass, placeId);
  return result;
}

/**
 * True when a proposed tag/alias collides with another place's name or aliases.
 * Narrative keywords such as Home may be shared. A place may also keep its own name.
 */
export function findPlaceKeyCollision(compass, placeId, keys) {
  const id = String(placeId || '').trim();
  const room = compass?.rooms?.[id];
  if (!room) return null;
  const allow = new Set();
  const addAllow = (s) => {
    const k = String(s || '').trim().toLowerCase();
    if (k) allow.add(k);
  };
  addAllow(room.name);
  for (const p of geographicAncestors(compass, id)) addAllow(p.name);
  const list = Array.isArray(keys) ? keys : normalizeTagList(keys);
  for (const raw of list) {
    const needle = String(raw || '').trim();
    const low = needle.toLowerCase();
    if (!low || allow.has(low)) continue;
    for (const other of Object.values(compass.rooms || {})) {
      if (!other || other.id === id) continue;
      const bag = [other.name, ...(other.aliases || [])];
      if (bag.some(s => String(s || '').trim().toLowerCase() === low)) {
        return { key: needle, otherId: other.id, otherName: other.name || other.id };
      }
    }
  }
  return null;
}

export function smokePlaceKeyCollisionPure() {
  const compass = {
    rooms: {
      fukuoka: { id: 'fukuoka', name: 'Fukuoka', kind: 'settlement', parentId: '', locationTags: [], aliases: [] },
      shop: { id: 'shop', name: 'Okisato Antiques', kind: 'building', parentId: 'fukuoka', locationTags: [], aliases: [] },
      plaza: { id: 'plaza', name: 'Plaza', kind: 'district', parentId: 'fukuoka', locationTags: [], aliases: ['Town Square'] },
    },
  };
  if (findPlaceKeyCollision(compass, 'shop', ['Fukuoka'])) return 'ancestor-blocked';
  if (findPlaceKeyCollision(compass, 'shop', ['Okisato Antiques'])) return 'own-name';
  if (!findPlaceKeyCollision(compass, 'shop', ['Plaza'])) return 'plaza-miss';
  if (!findPlaceKeyCollision(compass, 'shop', ['town square'])) return 'alias-miss';
  return '';
}

export function setLocationTags(compass, placeId, tags) {
  const room0 = getPlace(compass, placeId);
  const list = narrativeLocationTags(compass, {
    name: room0?.name,
    parentId: room0?.parentId,
    locationTags: normalizeTagList(tags),
  });
  const hit = findPlaceKeyCollision(compass, placeId, list);
  if (hit) throw new Error(`"${hit.key}" is already used by ${hit.otherName}. Pick a unique tag.`);
  return withRoomMutation(compass, placeId, 'location tags', room => {
    room.locationTags = list;
  });
}

export function setPlaceAliases(compass, placeId, aliases) {
  const list = normalizeTagList(aliases);
  const hit = findPlaceKeyCollision(compass, placeId, list);
  if (hit) throw new Error(`"${hit.key}" is already used by ${hit.otherName}. Pick a unique alias.`);
  const result = withRoomMutation(compass, placeId, 'aliases', room => {
    room.aliases = list;
  });
  try { dropMatchedUnlisted(compass); } catch { /* ignore */ }
  return result;
}

export function setPlaceListingCode(compass, placeId, code) {
  return withRoomMutation(compass, placeId, 'listing code', room => {
    room.listingCode = String(code || '').trim();
  });
}

export function setPlaceCategory(compass, placeId, category) {
  return withRoomMutation(compass, placeId, 'category', room => {
    room.category = String(category || '').trim();
  });
}

/** Mark whether a place is exposed to the elements / outdoors. */
export function setPlaceExposed(compass, placeId, exposed) {
  return withRoomMutation(compass, placeId, exposed ? 'exposed' : 'sheltered', room => {
    room.exposed = !!exposed;
  });
}

function retargetPlaceRefs(compass, fromId, toId) {
  const from = String(fromId || '').trim();
  const to = String(toId || '').trim();
  if (!from) return;
  for (const room of Object.values(compass.rooms || {})) {
    if (room.parentId === from) room.parentId = to && to !== room.id ? to : '';
    if (Array.isArray(room.links)) {
      room.links = room.links.filter((l) => {
        if (l?.toPlaceId !== from) return true;
        if (!to || to === room.id) return false;
        l.toPlaceId = to;
        return true;
      });
    }
    if (room.suiteLayout && Object.prototype.hasOwnProperty.call(room.suiteLayout, from)) {
      if (to && to !== from && !room.suiteLayout[to]) room.suiteLayout[to] = room.suiteLayout[from];
      delete room.suiteLayout[from];
    }
    if (room.suiteVisualFootprints && Object.prototype.hasOwnProperty.call(room.suiteVisualFootprints, from)) {
      if (to && to !== from && !room.suiteVisualFootprints[to]) {
        room.suiteVisualFootprints[to] = room.suiteVisualFootprints[from];
      }
      delete room.suiteVisualFootprints[from];
    }
  }
  const sonar = compass.sonar;
  if (sonar?.pings && typeof sonar.pings === 'object') {
    for (const p of Object.values(sonar.pings)) {
      if (p?.placeId === from) p.placeId = to || '';
    }
  }
  if (sonar?.lastPlaceId === from) sonar.lastPlaceId = to || '';
  if (compass.activeRoomId === from) compass.activeRoomId = to || '';
}

export function deletePlace(compass, placeId, { reparent = true } = {}) {
  const id = String(placeId || '').trim();
  const room = compass.rooms?.[id];
  if (!room) throw new Error(`Place "${id}" not found.`);
  const kids = Object.values(compass.rooms).filter(r => r.parentId === id);
  if (kids.length && !reparent) {
    throw new Error(`Cannot delete "${id}" — move or delete ${kids.length} nested place(s) first.`);
  }
  const up = room.parentId && room.parentId !== id ? room.parentId : '';
  retargetPlaceRefs(compass, id, reparent ? up : '');
  delete compass.rooms[id];
  if (compass.activeRoomId === id) compass.activeRoomId = '';
  return true;
}

function mergeStringField(dst, src, key) {
  const a = String(dst[key] || '').trim();
  const b = String(src[key] || '').trim();
  if (!b || a === b) return;
  dst[key] = a ? `${a}\n\n${b}` : b;
}

export function mergePlaces(compass, sourceId, targetId) {
  const from = String(sourceId || '').trim();
  const to = String(targetId || '').trim();
  if (!from || !to) throw new Error('Pick a place to merge into.');
  if (from === to) throw new Error('Cannot merge a place into itself.');
  const src = compass.rooms?.[from];
  const dst = compass.rooms?.[to];
  if (!src) throw new Error(`Place "${from}" not found.`);
  if (!dst) throw new Error(`Place "${to}" not found.`);
  let walk = dst.parentId;
  const guard = new Set();
  while (walk) {
    if (walk === from) throw new Error('Cannot merge a place into one of its nested locations.');
    if (guard.has(walk)) break;
    guard.add(walk);
    walk = compass.rooms[walk]?.parentId || '';
  }
  const aliases = [...(dst.aliases || [])];
  const pushAlias = (s) => {
    const n = String(s || '').trim();
    if (!n) return;
    if (n.toLowerCase() === String(dst.name || '').toLowerCase()) return;
    if (aliases.some(a => String(a).toLowerCase() === n.toLowerCase())) return;
    aliases.push(n);
  };
  pushAlias(src.name);
  for (const a of src.aliases || []) pushAlias(a);
  dst.aliases = normalizeTagList(aliases);
  const srcOwn = new Set(
    [src.name, ...(src.aliases || [])].map(s => String(s || '').trim().toLowerCase()).filter(Boolean),
  );
  dst.locationTags = normalizeTagList([
    ...(dst.locationTags || []),
    ...(src.locationTags || []).filter(t => !srcOwn.has(String(t || '').trim().toLowerCase())),
  ]);
  mergeStringField(dst, src, 'description');
  mergeStringField(dst, src, 'orientation_note');
  const occ = Array.isArray(dst.occupants) ? dst.occupants : (dst.occupants = []);
  const occKey = (o) => `${String(o?.castId || '').trim()}\n${String(o?.name || '').trim().toLowerCase()}`;
  const seenOcc = new Set(occ.map(occKey));
  for (const o of src.occupants || []) {
    const k = occKey(o);
    if (!k.trim() || seenOcc.has(k)) continue;
    seenOcc.add(k);
    occ.push({ ...o });
  }
  if (dst.suiteLayout || src.suiteLayout) {
    dst.suiteLayout = { ...(dst.suiteLayout || {}), ...(src.suiteLayout || {}) };
    delete dst.suiteLayout[from];
  }
  retargetPlaceRefs(compass, from, to);
  delete compass.rooms[from];
  refreshPlaceLocationTags(compass, to);
  refreshDescendantLocationTags(compass, to);
  touch(dst);
  return dst;
}

export function loadRoom(compass, roomId) {
  const id = String(roomId || '').trim();
  const room = compass.rooms[id];
  if (!room) throw new Error(`Place "${id}" not found.`);
  if (!isCompassPlaceKind(room.kind)) {
    throw new Error(`"${id}" is a ${room.kind} — load a room, hall, or building exterior.`);
  }
  compass.activeRoomId = id;
  return room;
}

export function unloadRoom(compass) {
  compass.activeRoomId = '';
}

export function requireActive(compass) {
  const room = getActiveRoom(compass);
  if (!room) throw new Error('No room loaded. Load a room or transitional place first.');
  return room;
}

export function setOrientationNote(compass, roomId, note) {
  return withRoomMutation(compass, roomId, 'orientation_note', room => {
    room.orientation_note = String(note || '').trim();
  });
}

export function addItem(compass, roomId, {
  id = '',
  cell,
  name,
  state = '',
  layer = 'clutter',
  kind = 'item',
  category = 'misc',
  condition = 'fine',
  description = '',
  cells = null,
  occupiable,
  maxOccupancy,
  contains,
  contentsVisible,
  surface = '',
  parentId = '',
  qty = 0,
  locator = null,
} = {}) {
  const cellId = normalizeCell(cell);
  const layerId = normalizeCellLayer(layer);
  const itemName = String(name || '').trim();
  if (!itemName) throw new Error('Item name is required.');
  return withRoomMutation(compass, roomId, `add ${layerId} ${itemName} @ ${cellId}`, room => {
    const span = layerId === 'furniture' || layerId === 'fixtures'
      ? (Array.isArray(cells) && cells.length ? cells : [cellId])
      : [];
    const item = normalizePiece({
      ...(id ? { id } : {}),
      kind: layerId === 'furniture' ? 'item' : kind,
      name: itemName,
      description: description || state,
      category: layerId === 'furniture' ? 'misc' : category,
      condition,
      cells: span,
      occupiable,
      maxOccupancy,
      contains,
      contentsVisible,
      surface,
      parentId,
      qty,
      locator,
    });
    if (!room.cells[cellId][layerId]) room.cells[cellId][layerId] = [];
    // Furniture/fixtures: store once on anchor cell with full span
    room.cells[cellId][layerId].push(item);
    return { ...item, layer: layerId, cell: cellId };
  });
}

export function updateItem(compass, roomId, { itemId, cell, layer, patch = {} } = {}) {
  return withRoomMutation(compass, roomId, `update item`, room => {
    const hit = findItem(room, { itemId, cell, layer });
    if (!hit) throw new Error('Item not found in room.');
    const destLayer = patch.layer ? normalizeCellLayer(patch.layer) : hit.layer;
    const rawMerged = { ...hit.item, ...patch, id: hit.item.id };
    if (destLayer === 'clutter') {
      rawMerged.cells = [];
      rawMerged.occupiable = false;
      rawMerged.maxOccupancy = 0;
    } else if (!Array.isArray(rawMerged.cells) || !rawMerged.cells.length) {
      rawMerged.cells = [hit.cell];
    }
    const next = normalizePiece(rawMerged);
    const span = next.cells || [];
    const anchor = (destLayer === 'furniture' && span.length && !span.includes(hit.cell))
      ? span[0]
      : hit.cell;
    if (anchor !== hit.cell || destLayer !== hit.layer) {
      room.cells[hit.cell][hit.layer].splice(hit.index, 1);
      if (!room.cells[anchor][destLayer]) room.cells[anchor][destLayer] = [];
      room.cells[anchor][destLayer].push(next);
      return { ...next, layer: destLayer, cell: anchor };
    }
    room.cells[hit.cell][hit.layer][hit.index] = next;
    return { ...next, layer: hit.layer, cell: hit.cell };
  });
}

export function removeItem(compass, roomId, { itemId, name, cell, layer } = {}) {
  return withRoomMutation(compass, roomId, `remove item`, room => {
    const hit = findItem(room, { itemId, name, cell, layer });
    if (!hit) throw new Error('Item not found in room.');
    room.cells[hit.cell][hit.layer].splice(hit.index, 1);
    return { ...hit.item, fromCell: hit.cell, layer: hit.layer };
  });
}

/** Unplaced stage pieces (not on a cell, not in cast/user inventory). */
export function listLostAndFound(compass) {
  return Array.isArray(compass?.lostAndFound) ? compass.lostAndFound.slice() : [];
}

export function addToLostAndFound(compass, piece, { layer = 'clutter' } = {}) {
  if (!compass || typeof compass !== 'object') throw new Error('No compass.');
  compass.lostAndFound ??= [];
  const item = normalizePiece({
    ...piece,
    id: piece?.id || uid(),
  });
  if (!item?.name) throw new Error('Item name is required.');
  item._lostLayer = normalizeCellLayer(layer || piece?.layer || piece?._lostLayer || 'clutter');
  const i = compass.lostAndFound.findIndex(x => x.id === item.id);
  if (i >= 0) compass.lostAndFound[i] = item;
  else compass.lostAndFound.push(item);
  return item;
}

export function removeFromLostAndFound(compass, itemId) {
  if (!compass?.lostAndFound?.length) return null;
  const i = compass.lostAndFound.findIndex(x => x.id === itemId);
  if (i < 0) return null;
  const [item] = compass.lostAndFound.splice(i, 1);
  return item;
}

/** Pull a piece off the stage into Lost & Found (keeps the object). */
export function sendItemToLostAndFound(compass, roomId, { itemId, name, cell, layer } = {}) {
  const taken = removeItem(compass, roomId, { itemId, name, cell, layer });
  return addToLostAndFound(compass, taken, { layer: taken.layer || layer || 'clutter' });
}

/** Place a Lost & Found piece into a room cell. */
export function placeFromLostAndFound(compass, roomId, {
  itemId,
  cell,
  layer,
} = {}) {
  const item = removeFromLostAndFound(compass, itemId);
  if (!item) throw new Error('Item not in Lost & Found.');
  const layerId = normalizeCellLayer(layer || item._lostLayer || 'clutter');
  delete item._lostLayer;
  return addItem(compass, roomId, {
    id: item.id,
    cell,
    layer: layerId,
    name: item.name,
    description: item.description || '',
    kind: item.kind,
    category: item.category,
    condition: item.condition,
    cells: item.cells,
    occupiable: item.occupiable,
    maxOccupancy: item.maxOccupancy,
    contains: item.contains,
    contentsVisible: item.contentsVisible,
    surface: item.surface || '',
    parentId: item.parentId || '',
    qty: item.qty || 0,
  });
}

/** Move a piece to another compass area, layer, or room (re-anchors furniture/fixtures). */
export function moveItem(compass, roomId, {
  itemId,
  cell,
  layer,
  toCell,
  toLayer,
  toRoomId,
  surface,
  parentId,
} = {}) {
  const targetRoomId = String(toRoomId || roomId || '').trim();
  if (targetRoomId && targetRoomId !== roomId) {
    if (!compass?.rooms?.[targetRoomId]) throw new Error(`Place "${targetRoomId}" not found.`);
    const taken = removeItem(compass, roomId, { itemId, cell, layer });
    const destCell = toCell ? normalizeCell(toCell) : normalizeCell(taken.fromCell || cell || 'C');
    const destLayer = toLayer ? normalizeCellLayer(toLayer) : normalizeCellLayer(taken.layer || layer || 'clutter');
    const added = addItem(compass, targetRoomId, {
      id: taken.id,
      cell: destCell,
      layer: destLayer,
      name: taken.name,
      description: taken.description || '',
      kind: taken.kind,
      category: taken.category,
      condition: taken.condition,
      cells: destLayer === 'furniture' || destLayer === 'fixtures' ? [destCell] : [],
      occupiable: taken.occupiable,
      maxOccupancy: taken.maxOccupancy,
      contains: taken.contains,
      contentsVisible: taken.contentsVisible,
      surface: surface !== undefined ? String(surface || '').trim() : (taken.surface || ''),
      parentId: parentId !== undefined ? String(parentId || '').trim() : '',
      qty: taken.qty || 0,
      locator: taken.locator
        ? { ...taken.locator, placeId: targetRoomId, cell: destCell, parentId: '' }
        : undefined,
    });
    return { ...added, fromCell: taken.fromCell, fromRoomId: roomId, toRoomId: targetRoomId };
  }

  return withRoomMutation(compass, roomId, `move item`, room => {
    const hit = findItem(room, { itemId, cell, layer });
    if (!hit) throw new Error('Item not found in room.');
    const dest = toCell ? normalizeCell(toCell) : hit.cell;
    const destLayer = toLayer ? normalizeCellLayer(toLayer) : hit.layer;
    const nextSurface = surface !== undefined ? String(surface || '').trim() : hit.item.surface;
    const nextParentId = parentId !== undefined ? String(parentId || '').trim() : hit.item.parentId;
    if (hit.cell === dest && hit.layer === destLayer && surface === undefined && parentId === undefined && destLayer === 'clutter') {
      return { ...hit.item, layer: hit.layer, cell: dest };
    }
    const [piece] = room.cells[hit.cell][hit.layer].splice(hit.index, 1);
    let cells = [];
    if (destLayer === 'furniture' || destLayer === 'fixtures') {
      const span = Array.isArray(piece.cells) && piece.cells.length
        ? piece.cells.map(c => (c === hit.cell ? dest : c))
        : [dest];
      const seen = new Set();
      for (const c of [dest, ...span]) {
        try {
          const id = normalizeCell(c);
          if (seen.has(id)) continue;
          seen.add(id);
          cells.push(id);
        } catch { /* skip */ }
      }
    }
    const next = normalizePiece({
      ...piece,
      id: piece.id,
      cells,
      ...(destLayer === 'clutter' ? { occupiable: false, maxOccupancy: 0 } : {}),
      surface: nextSurface,
      parentId: nextParentId,
      locator: piece.locator
        ? { ...piece.locator, cell: dest, surface: nextSurface || '', parentId: nextParentId || '' }
        : undefined,
    });
    if (!room.cells[dest][destLayer]) room.cells[dest][destLayer] = [];
    room.cells[dest][destLayer].push(next);
    return { ...next, layer: destLayer, cell: dest, fromCell: hit.cell, fromLayer: hit.layer };
  });
}

/** Reorder a piece within its cell layer (dir: -1 = up/earlier, +1 = down/later). */
export function reorderCellItem(compass, roomId, { itemId, cell, layer, dir = -1 } = {}) {
  return withRoomMutation(compass, roomId, `reorder item`, room => {
    const hit = findItem(room, { itemId, cell, layer });
    if (!hit) throw new Error('Item not found in room.');
    const list = room.cells[hit.cell]?.[hit.layer];
    if (!Array.isArray(list) || list.length < 2) return hit.item;
    const step = Number(dir) < 0 ? -1 : 1;
    const targetIdx = Math.max(0, Math.min(list.length - 1, hit.index + step));
    if (targetIdx === hit.index) return hit.item;
    const [piece] = list.splice(hit.index, 1);
    list.splice(targetIdx, 0, piece);
    return { ...piece, layer: hit.layer, cell: hit.cell };
  });
}

export function setItemState(compass, roomId, { itemId, name, cell, state } = {}) {
  return updateItem(compass, roomId, {
    itemId,
    cell,
    patch: { description: String(state ?? '').trim() },
  });
}

/**
 * Remove item from room; returns the removed item (caller adds to Inventory).
 */
export function pickupItem(compass, roomId, { itemId, name, cell, layer } = {}) {
  return withRoomMutation(compass, roomId, `pickup item`, room => {
    const hit = findItem(room, { itemId, name, cell, layer });
    if (!hit) throw new Error('Item not found in room.');
    if (hit.layer === 'fixtures') {
      throw new Error('Fixtures cannot be picked up — delete them instead.');
    }
    room.cells[hit.cell][hit.layer].splice(hit.index, 1);
    return { ...hit.item, fromCell: hit.cell, layer: hit.layer };
  });
}

function findItem(room, { itemId, name, cell, layer } = {}) {
  const cells = cell ? [normalizeCell(cell)] : Object.keys(room.cells);
  const layers = layer ? [normalizeCellLayer(layer)] : CELL_LAYER_IDS;
  const wantId = String(itemId || '').trim();
  const wantName = String(name || '').trim().toLowerCase();
  for (const c of cells) {
    for (const lyr of layers) {
      const list = room.cells[c]?.[lyr] || [];
      for (let i = 0; i < list.length; i++) {
        const it = list[i];
        if (wantId && it.id === wantId) return { item: it, cell: c, index: i, layer: lyr };
        if (!wantId && wantName && it.name.toLowerCase() === wantName) {
          return { item: it, cell: c, index: i, layer: lyr };
        }
      }
    }
  }
  return null;
}

export function setExit(compass, roomId, dir, label) {
  const d = normalizeExitDir(dir);
  const text = String(label || '').trim();
  if (!text) throw new Error('Exit label is required (or use clear).');
  return withRoomMutation(compass, roomId, `exit ${d}`, room => {
    room.exits[d] = text;
  });
}

export function clearExit(compass, roomId, dir) {
  const d = normalizeExitDir(dir);
  return withRoomMutation(compass, roomId, `clear exit ${d}`, room => {
    delete room.exits[d];
  });
}

export function wallLinkAllowed(compass, src, dest) {
  if (!src || !dest || src.id === dest.id) return false;
  if (GEO_PLACE_KIND_SET.has(src.kind) && GEO_PLACE_KIND_SET.has(dest.kind)) return false;
  return true;
}

/**
 * Categorized candidate places that `room` can share a wall or opening with:
 * - `siblings`: rooms/corridors under the same parent
 * - `corridors`: halls/promenades/shared spaces in the parent building, complex, or district
 * - `units`: neighboring units/shops/buildings and their entry rooms in the same building/complex/district
 * - `others`: any other compass places in the world
 * - `exteriorHost`: enclosing building or suite host for exterior walls
 */
export function listLinkableNeighbors(compass, room) {
  const rooms = compass?.rooms || {};
  const result = {
    siblings: [],
    corridors: [],
    units: [],
    others: [],
    exteriorHost: room ? exteriorHostForPlace(compass, room) : null,
  };
  if (!room?.id) return result;

  const seen = new Set([room.id]);
  const parentId = String(room.parentId || '').trim();
  const parent = parentId ? rooms[parentId] : null;

  // Walk ancestors to find enclosing building / complex / district
  const ancestorIds = new Set();
  let walk = parentId;
  const guard = new Set();
  while (walk && rooms[walk] && !guard.has(walk)) {
    guard.add(walk);
    ancestorIds.add(walk);
    walk = String(rooms[walk].parentId || '').trim();
  }

  const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''));

  // 1. Direct siblings under the same parent
  if (parentId) {
    for (const r of Object.values(rooms)) {
      if (!r?.id || seen.has(r.id) || r.parentId !== parentId) continue;
      if (GEO_PLACE_KIND_SET.has(r.kind)) continue;
      if (r.kind === 'room' || r.kind === 'transitional') {
        seen.add(r.id);
        result.siblings.push(r);
      }
    }
    result.siblings.sort(byName);
  }

  // 2. Corridors & shared spaces + 3. Neighboring units/buildings in the enclosing complex
  const complexChildren = Object.values(rooms).filter(r =>
    r?.id && !seen.has(r.id) && !GEO_PLACE_KIND_SET.has(r.kind)
    && ((r.parentId && ancestorIds.has(r.parentId)) || ancestorIds.has(r.id)));

  for (const r of complexChildren) {
    if (seen.has(r.id)) continue;
    if (r.id === parentId) continue;
    if (r.kind === 'transitional' || (r.kind === 'room' && r.parentId !== parentId && ancestorIds.has(r.parentId)) || r.kind === 'outdoor') {
      seen.add(r.id);
      result.corridors.push(r);
    } else if (r.kind === 'unit' || r.kind === 'building') {
      seen.add(r.id);
      result.units.push(r);
      // Also include rooms directly inside neighboring units/shops
      const unitRooms = Object.values(rooms)
        .filter(kr => kr?.id && !seen.has(kr.id) && kr.parentId === r.id && (kr.kind === 'room' || kr.kind === 'transitional'))
        .sort(byName);
      for (const kr of unitRooms) {
        seen.add(kr.id);
        result.units.push(kr);
      }
    }
  }
  result.corridors.sort(byName);

  // 4. Any remaining compass places (including parent building/unit if not already listed)
  for (const r of Object.values(rooms)) {
    if (!r?.id || seen.has(r.id)) continue;
    if (GEO_PLACE_KIND_SET.has(r.kind)) continue;
    seen.add(r.id);
    result.others.push(r);
  }
  result.others.sort(byName);

  return result;
}

/** Building exterior if nested in one; otherwise the nearest suite host. */
function exteriorHostForPlace(compass, place) {
  const rooms = compass?.rooms || {};
  let pid = place?.parentId || '';
  const seen = new Set();
  let suiteHost = null;
  while (pid && !seen.has(pid)) {
    seen.add(pid);
    const p = rooms[pid];
    if (!p) break;
    if (isExteriorHostKind(p.kind)) return p;
    if (!suiteHost && isSuiteHostKind(p.kind)) suiteHost = p;
    pid = p.parentId || '';
  }
  return suiteHost;
}

/**
 * Point an exterior wall (and its doors/windows) at the building/suite host.
 * Reciprocal uses the same cardinal — the host's north face, not the opposite wall.
 */
export function linkWallToExterior(compass, roomId, linkId) {
  const rid = String(roomId || '').trim();
  const lid = String(linkId || '').trim();
  const room = compass?.rooms?.[rid];
  if (!room) throw new Error('Place not found.');
  const link = (room.links || []).find(l => l.id === lid);
  if (!link) throw new Error('Opening wall not found.');
  if (link.wall === 'above' || link.wall === 'below') return link;
  const dest = exteriorHostForPlace(compass, room);
  if (!dest) {
    withRoomMutation(compass, rid, 'wall external', r => {
      const l = (r.links || []).find(x => x.id === lid);
      if (!l) return;
      l.external = true;
    });
    return (compass.rooms[rid].links || []).find(l => l.id === lid) || link;
  }
  withRoomMutation(compass, rid, `openings → ${dest.name || dest.id}`, r => {
    const l = (r.links || []).find(x => x.id === lid);
    if (!l) return;
    l.toPlaceId = dest.id;
    l.external = true;
    if (!l.sharedStyle) l.sharedStyle = 'merged';
    for (const op of l.openings || []) {
      if (!op.cell) {
        try { op.cell = normalizeCell(cellForWallAlong(l.wall, op.along)); } catch { op.cell = 'C'; }
      }
      if (op.type !== 'window' && op.type !== 'hole') op.travel = true;
    }
    syncExitsFromLinks(r);
  });
  let wall = link.wall;
  try { if (wall && wall !== 'above' && wall !== 'below') wall = normalizeWall(wall); } catch { /* keep */ }
  if (!wall || wall === 'above' || wall === 'below') wall = 'N';
  const existingPeer = (dest.links || []).find(l => l.toPlaceId === rid && l.wall === wall);
  if (!existingPeer) {
    addLink(compass, dest.id, {
      wall,
      toPlaceId: rid,
      description: 'exterior',
    });
  }
  const after = compass.rooms[rid];
  const afterLink = (after.links || []).find(l => l.id === lid);
  for (const op of afterLink?.openings || []) {
    syncOpeningToPeer(compass, after, afterLink, op);
  }
  return afterLink;
}

/** Bind an unbound wall to a contacting sibling, or to the suite/building exterior. */
function autoBindFixtureWall(compass, roomId, linkId, along = null) {
  const room = compass?.rooms?.[roomId];
  const link = (room?.links || []).find(l => l.id === linkId);
  if (!room || !link) return link;
  if (link.wall === 'above' || link.wall === 'below') return link;
  const current = link.toPlaceId ? compass.rooms[link.toPlaceId] : null;
  const parent = compass.rooms?.[room.parentId];
  const edge = Number(link.edge);
  if (parent && isSuiteHostKind(parent.kind) && Number.isFinite(edge)) {
    try {
      const pair = sharedPairForSuiteEdge(compass, parent.id, room.id, edge, along);
      if (pair) {
        const neighborId = pair.aId === room.id ? pair.bId : pair.aId;
        if (neighborId && compass.rooms[neighborId] && neighborId !== room.id) {
          if (link.toPlaceId !== neighborId || !findPeerLink(compass, room, link)?.peerLink) {
            return linkWallToRoom(compass, room.id, link.id, neighborId);
          }
          return link;
        }
      }
    } catch { /* geometry unavailable */ }
  }
  if (current && !isSuiteHostKind(current.kind) && !isExteriorHostKind(current.kind)) return link;
  if (link.external) {
    try { return linkWallToExterior(compass, room.id, link.id); } catch { return link; }
  }
  return link;
}

/**
 * Link this place to a neighbor across a shared wall (or above/below).
 * Pass `external: true` with an empty neighbor to mark a wall that faces outside.
 */
export function addLink(compass, roomId, {
  wall,
  edge = null,
  toPlaceId = '',
  description = '',
  openings = [],
  external = false,
} = {}) {
  let w = '';
  let edgeIdx = edge;
  if (wall && wall !== 'above' && wall !== 'below') {
    w = normalizeWall(wall);
    if (edgeIdx == null && CARDINAL_TO_EDGE[w] != null) edgeIdx = CARDINAL_TO_EDGE[w];
  } else if (wall === 'above' || wall === 'below') {
    w = wall;
    edgeIdx = null;
  } else if (edgeIdx != null) {
    edgeIdx = Math.max(0, Math.floor(Number(edgeIdx)));
    w = EDGE_TO_CARDINAL[edgeIdx] || '';
  } else {
    throw new Error('Pick a wall or above/below.');
  }
  const to = String(toPlaceId || '').trim();
  if (!to && !external) throw new Error('Pick a neighbor place, or mark the wall as external.');
  if (to && to === roomId) throw new Error('Cannot link a place to itself.');
  if (to && !compass.rooms[to]) throw new Error(`Neighbor "${to}" not found.`);
  if (to) {
    const src = compass.rooms[roomId];
    const dest = compass.rooms[to];
    if (src && dest && !wallLinkAllowed(compass, src, dest)) {
      throw new Error('Cannot link those two places.');
    }
  }
  const summary = to
    ? `link ${w || `wall${edgeIdx}`} → ${to}`
    : `link ${w || `wall${edgeIdx}`} → outside`;
  const result = withRoomMutation(compass, roomId, summary, room => {
    // Prefer geometric cardinal (split walls are not limited to the 0–3 map).
    if (edgeIdx != null) {
      try {
        const card = edgeCardinal(room.footprint, edgeIdx);
        if (card) w = card;
      } catch { /* keep */ }
    }
    const existing = (room.links || []).find(l => {
      if (edgeIdx != null) {
        if (l.edge !== edgeIdx) return false;
        if (to) return l.toPlaceId === to || (!l.toPlaceId && !l.external);
        return (!l.toPlaceId && !l.external) || (external && l.external);
      }
      return l.wall === w && ((!to && !l.toPlaceId) || l.toPlaceId === to || (!to && external));
    });
    if (existing) {
      if (to) existing.toPlaceId = to;
      if (description) existing.description = String(description).trim();
      if (external) existing.external = true;
      if (edgeIdx != null) existing.edge = edgeIdx;
      if (w) existing.wall = w;
      return existing;
    }
    const link = {
      id: uid('lnk'),
      wall: w,
      edge: edgeIdx,
      toPlaceId: to,
      description: String(description || '').trim(),
      external: !!external,
      sharedStyle: 'merged',
      openings: Array.isArray(openings) ? openings : [],
    };
    room.links = room.links || [];
    room.links.push(link);
    return link;
  });
  if (result?.external && !result.toPlaceId) {
    try { return linkWallToExterior(compass, roomId, result.id) || result; } catch { /* no host */ }
  }
  return result;
}

/**
 * Point a wall (and its doors/windows) at a neighbor so exits/peer views resolve.
 * Creates the reciprocal link when missing, fills opening cells, and mirrors fixtures.
 */
export function linkWallToRoom(compass, roomId, linkId, toPlaceId) {
  const to = String(toPlaceId || '').trim();
  const lid = String(linkId || '').trim();
  if (!to) throw new Error('Pick a place to link.');
  if (to === roomId) throw new Error('Cannot link a wall to itself.');
  if (!compass?.rooms?.[to]) throw new Error(`Neighbor "${to}" not found.`);
  const src = compass.rooms[roomId];
  const dest = compass.rooms[to];
  if (!src) throw new Error('Place not found.');
  if (!wallLinkAllowed(compass, src, dest)) {
    throw new Error('Cannot link those two places.');
  }
  const link = (src.links || []).find(l => l.id === lid);
  if (!link) throw new Error('Opening wall not found.');

  // Unsync openings from previous peer if re-targeting an existing linked wall
  if (link.toPlaceId && link.toPlaceId !== to) {
    for (const op of link.openings || []) {
      unsyncOpeningFromPeer(compass, src, link, op.id);
    }
  }

  let wall = link.wall;
  if (link.edge != null && link.edge !== '') {
    try {
      const card = edgeCardinal(src.footprint, Number(link.edge));
      if (card) wall = card;
    } catch { /* keep */ }
  }
  if (!wall || (wall !== 'above' && wall !== 'below')) {
    try { wall = normalizeWall(wall || 'N'); } catch { wall = 'N'; }
  }

  withRoomMutation(compass, roomId, `openings → ${dest.name || to}`, room => {
    const l = (room.links || []).find(x => x.id === lid);
    if (!l) return;
    l.wall = wall;
    l.toPlaceId = to;
    l.external = false;
    if (l.description === 'suite snap') l.description = '';
    for (const op of l.openings || []) {
      if (!op.cell) {
        try { op.cell = normalizeCell(cellForWallAlong(l.wall, op.along)); } catch { op.cell = 'C'; }
      }
      if (op.type !== 'window' && op.type !== 'hole') op.travel = true;
    }
    syncExitsFromLinks(room);
  });

  const opp = OPPOSITE_WALL[wall] || '';
  if (opp) {
    const sameParent = (src.parentId || '') === (dest.parentId || '');
    const peerEdge = sameParent ? resolveSharedEdge(compass, dest, src, opp) : null;
    try {
      addLink(compass, to, {
        wall: opp,
        edge: peerEdge,
        toPlaceId: roomId,
      });
    } catch { /* peer wall may already be linked */ }
  }

  const after = compass.rooms[roomId];
  const afterLink = (after.links || []).find(l => l.id === lid);
  for (const op of afterLink?.openings || []) {
    syncOpeningToPeer(compass, after, afterLink, op);
  }
  return afterLink;
}

/**
 * Unified helper to set what a wall (and its openings) borders or connects to:
 * - `target === '__exterior__'`: exterior wall (faces outside / parent exterior)
 * - `target === '__auto__'`: auto-bind to contacting suite sibling, or unbind if outer wall
 * - `target === ''` or `'__none__'`: unlinked wall (keeps openings, clears target)
 * - `target === '<placeId>'`: links wall and openings to `<placeId>` (sibling, corridor, or neighboring unit)
 */
export function setWallConnection(compass, roomId, edgeIdx, target, { linkId = '', along = null } = {}) {
  const rid = String(roomId || '').trim();
  const room = compass?.rooms?.[rid];
  if (!room) throw new Error('Room not found.');
  const t = String(target ?? '').trim();
  const hasEdge = edgeIdx != null && edgeIdx !== '' && Number.isFinite(Number(edgeIdx));
  const ei = hasEdge ? Math.max(0, Math.floor(Number(edgeIdx))) : null;

  let link = linkId ? (room.links || []).find(l => l.id === linkId) : null;
  if (!link && ei != null) {
    link = ensureEdgeLink(compass, rid, ei, along);
  }
  if (!link) throw new Error('Wall link not found.');

  if (t === '__exterior__') {
    if (link.toPlaceId) {
      dropCrossBuildingReciprocal(compass, room, link);
      const liveRoom = compass.rooms?.[rid] || room;
      const liveLink = (liveRoom.links || []).find(l => l.id === link.id) || link;
      for (const op of liveLink.openings || []) {
        unsyncOpeningFromPeer(compass, liveRoom, liveLink, op.id);
      }
      withRoomMutation(compass, rid, 'clear wall peer', r => {
        const l = (r.links || []).find(x => x.id === link.id);
        if (l) l.toPlaceId = '';
      });
    }
    return linkWallToExterior(compass, rid, link.id);
  }

  if (t === '__auto__') {
    const parent = compass.rooms?.[room.parentId];
    if (parent && isSuiteHostKind(parent.kind) && ei != null) {
      const pair = sharedPairForSuiteEdge(compass, parent.id, rid, ei, along);
      if (pair?.peerId) {
        return linkWallToRoom(compass, rid, link.id, pair.peerId);
      }
    }
    return setWallConnection(compass, rid, ei, '__none__', { linkId: link.id, along });
  }

  if (!t || t === '__none__') {
    if (link.toPlaceId) {
      dropCrossBuildingReciprocal(compass, room, link);
      const liveRoom = compass.rooms?.[rid] || room;
      const liveLink = (liveRoom.links || []).find(l => l.id === link.id) || link;
      for (const op of liveLink.openings || []) {
        unsyncOpeningFromPeer(compass, liveRoom, liveLink, op.id);
      }
    }
    return withRoomMutation(compass, rid, 'unlink wall', r => {
      const l = (r.links || []).find(x => x.id === link.id);
      if (!l) return null;
      l.toPlaceId = '';
      l.external = false;
      if (l.description === 'suite snap') l.description = '';
      syncExitsFromLinks(r);
      return l;
    });
  }

  return linkWallToRoom(compass, rid, link.id, t);
}

/** Toggle whether an existing wall link faces outside. */
export function setLinkExternal(compass, roomId, linkId, external) {
  const lid = String(linkId || '').trim();
  const result = withRoomMutation(compass, roomId, external ? 'wall external' : 'wall interior', room => {
    const link = (room.links || []).find(l => l.id === lid);
    if (!link) throw new Error('Link not found.');
    link.external = !!external;
    if (!link.external && !link.toPlaceId && !(link.openings || []).length) {
      room.links = room.links.filter(l => l.id !== lid);
    }
    return link;
  });
  if (result?.external) {
    try { return linkWallToExterior(compass, roomId, lid) || result; } catch { /* no host */ }
  }
  return result;
}

/**
 * Resolve which real footprint edge on `room` actually faces `wall` toward
 * `peer`, using its true (posed) geometry rather than assuming a rectangle. A
 * plain N/E/S/W → 0/1/2/3 lookup silently picks the wrong edge on any room
 * reshaped by divide/align (e.g. an L-shaped Living Area whose real west edge
 * is index 4, not 3 — 3 is already its south wall), which then creates a
 * duplicate/conflicting link that never renders any style change.
 */
function resolveSharedEdge(compass, room, peer, wall) {
  const parent = compass?.rooms?.[room?.parentId || ''];
  if (!parent || !isSuiteHostKind(parent.kind)) return null;
  const pose = normalizeSuitePose(parent.suiteLayout?.[room.id] || { x: 0, y: 0, rot: 0 });
  const candidates = edgesFacingCardinal(room, pose, wall);
  if (!candidates.length) return null;
  if (candidates.length === 1) return candidates[0];
  // Multiple edges face this cardinal (a split/irregular wall) — pick the one
  // physically closest to the peer room.
  const peerPose = normalizeSuitePose(parent.suiteLayout?.[peer.id] || { x: 0, y: 0, rot: 0 });
  const verts = worldPolygon(room, pose);
  const peerVerts = worldPolygon(peer, peerPose);
  const peerCx = peerVerts.reduce((s, v) => s + v.x, 0) / (peerVerts.length || 1);
  const peerCy = peerVerts.reduce((s, v) => s + v.y, 0) / (peerVerts.length || 1);
  let best = candidates[0];
  let bestD = Infinity;
  for (const i of candidates) {
    const a = verts[i];
    const b = verts[(i + 1) % verts.length];
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const d = Math.hypot(mx - peerCx, my - peerCy);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

/** Mark reciprocal suite wall links as merged (solid) or threshold (dotted). */
export function setSharedWallStyle(compass, roomAId, roomBId, wallA, wallB, style = 'merged', opts = {}) {
  const aId = String(roomAId || '').trim();
  const bId = String(roomBId || '').trim();
  const next = style === 'threshold' ? 'threshold' : (style === 'open' ? 'open' : 'merged');
  if (opts.record !== false) {
    const summary = String(opts.summary || '').trim()
      || (next === 'threshold' ? 'threshold' : next === 'open' ? 'delete wall' : 'restore wall');
    pushSuiteHistory(compass, aId, summary);
  }
  const apply = (roomId, peerId, wall) => {
    const room = compass.rooms?.[roomId];
    const peer = compass.rooms?.[peerId];
    if (!room) return;
    withRoomMutation(compass, roomId, `wall ${next}`, r => {
      let hit = false;
      for (const link of r.links || []) {
        if (link.toPlaceId !== peerId || link.wall !== wall) continue;
        link.sharedStyle = next;
        hit = true;
      }
      if (hit) return;
      // Ensure a link exists so the style persists — resolve the real edge
      // geometrically instead of assuming a rectangular N/E/S/W layout.
      const edge = peer ? resolveSharedEdge(compass, r, peer, wall) : null;
      let w = wall;
      if (edge != null) {
        try { w = edgeCardinal(r.footprint, edge) || wall; } catch { /* keep */ }
      }
      r.links = r.links || [];
      r.links.push({
        id: uid('lnk'),
        wall: w,
        edge,
        toPlaceId: peerId,
        description: 'suite shared',
        external: false,
        sharedStyle: next,
        openings: [],
      });
    });
  };
  apply(aId, bId, wallA);
  apply(bId, aId, wallB);
  return next;
}

/**
 * Remove an interior shared-wall relationship. Exterior walls cannot be
 * deleted — open them with a threshold instead.
 */
export function deleteInteriorSharedWall(compass, roomAId, roomBId, wallA, wallB) {
  const a = compass.rooms?.[String(roomAId || '')];
  const b = compass.rooms?.[String(roomBId || '')];
  if (!a || !b) throw new Error('Pick a shared wall first.');
  const isTrueExterior = (room, peerId, wall) => {
    const hit = (room.links || []).find(l => l.toPlaceId === peerId && l.wall === wall);
    return !!(hit?.external && !hit.toPlaceId);
  };
  if (isTrueExterior(a, b.id, wallA) || isTrueExterior(b, a.id, wallB)) {
    throw new Error('Exterior walls cannot be deleted. Use a threshold to open to the outside.');
  }
  return setSharedWallStyle(compass, a.id, b.id, wallA, wallB, 'open', { summary: 'delete wall' });
}

/**
 * Put a threshold or deleted (open) wall back to a solid merged wall.
 * Shared: both rooms. Exterior: the selected edge's external threshold.
 */
export function restoreSuiteWall(compass, {
  aId = '',
  bId = '',
  wallA = '',
  wallB = '',
  placeId = '',
  edge = null,
} = {}) {
  const sharedA = String(aId || '').trim();
  const sharedB = String(bId || '').trim();
  if (sharedA && sharedB) {
    return setSharedWallStyle(compass, sharedA, sharedB, wallA, wallB, 'merged', { summary: 'restore wall' });
  }
  const pid = String(placeId || '').trim();
  const ei = Math.floor(Number(edge));
  if (!pid || !Number.isFinite(ei)) throw new Error('Pick a threshold or open wall to restore.');
  pushSuiteHistory(compass, pid, 'restore wall');
  return withRoomMutation(compass, pid, 'restore wall', room => {
    const links = room.links || [];
    const byEdge = links.find(l => l.edge === ei);
    const link = byEdge || links.find(l => {
      if (l.edge != null && l.edge !== '' && Number(l.edge) !== ei) return false;
      return l.sharedStyle === 'threshold' || l.sharedStyle === 'open';
    });
    if (!link || (link.sharedStyle !== 'threshold' && link.sharedStyle !== 'open')) {
      throw new Error('That wall is already solid. Pick a threshold or open wall.');
    }
    link.sharedStyle = 'merged';
    return link;
  });
}

function cloneLink(link) {
  return {
    ...link,
    openings: Array.isArray(link?.openings) ? link.openings.map(o => ({ ...o })) : [],
  };
}

function mergeRoomCells(dst, src) {
  dst.cells = dst.cells && typeof dst.cells === 'object' ? dst.cells : {};
  for (const cellId of CELLS) {
    const from = src?.cells?.[cellId];
    if (!from) continue;
    const into = dst.cells[cellId] || (dst.cells[cellId] = {});
    for (const layer of CELL_LAYER_IDS) {
      const pieces = Array.isArray(from[layer]) ? from[layer] : [];
      if (!pieces.length) continue;
      into[layer] = Array.isArray(into[layer]) ? into[layer] : [];
      for (const piece of pieces) {
        into[layer].push(normalizePiece({ ...piece, id: uid('itm') }));
      }
    }
  }
}

function remapLinksOntoPolygon(links, sources, newRoom, newPose) {
  const newVerts = worldPolygon(newRoom, newPose);
  const nNew = newVerts.length;
  if (!nNew) return links;
  const out = [];
  for (const { link, verts } of sources) {
    const nOld = verts.length;
    if (!nOld || link.edge == null || link.edge === '') {
      out.push(link);
      continue;
    }
    const i = ((Math.floor(Number(link.edge)) % nOld) + nOld) % nOld;
    const a = verts[i];
    const b = verts[(i + 1) % nOld];
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    let best = 0;
    let bestD = Infinity;
    for (let j = 0; j < nNew; j++) {
      const c = newVerts[j];
      const d = newVerts[(j + 1) % nNew];
      const dist = Math.hypot((c.x + d.x) / 2 - mx, (c.y + d.y) / 2 - my);
      if (dist < bestD) {
        bestD = dist;
        best = j;
      }
    }
    const next = cloneLink(link);
    next.edge = best;
    try { next.wall = worldEdgeCardinal(newRoom, newPose, best) || next.wall; } catch { /* keep */ }
    out.push(next);
  }
  return out;
}

/**
 * Fuse two suite siblings along their shared wall into a single room (one
 * footprint, one arrange handle). The kept room inherits the dropped room's
 * name as an alias, plus occupants, tags, and wall links.
 */
export function fuseSuiteRoomsAlongWall(compass, unitId, roomAId, roomBId, keepId = '') {
  const uid = String(unitId || '').trim();
  const aId = String(roomAId || '').trim();
  const bId = String(roomBId || '').trim();
  if (!aId || !bId || aId === bId) throw new Error('Pick a shared wall between two rooms.');
  const unit = compass.rooms?.[uid];
  const roomA = compass.rooms?.[aId];
  const roomB = compass.rooms?.[bId];
  if (!unit || !isSuiteHostKind(unit.kind)) throw new Error('Merge rooms from the suite view.');
  if (!roomA || !roomB) throw new Error('Both rooms must exist.');
  if ((roomA.parentId || '') !== uid || (roomB.parentId || '') !== uid) {
    throw new Error('Both rooms must belong to this suite.');
  }
  const keep = keepId === bId ? bId : aId;
  const drop = keep === aId ? bId : aId;
  const keepRoom = compass.rooms[keep];
  const dropRoom = compass.rooms[drop];
  const children = listSuiteChildren(compass, uid);
  const { layout } = ensureSuiteChildPoses(unit, children);
  const poseK = normalizeSuitePose(layout[keep] || { x: 0, y: 0, rot: 0 });
  const poseD = normalizeSuitePose(layout[drop] || { x: 0, y: 0, rot: 0 });
  const vertsK = worldPolygon(keepRoom, poseK);
  const vertsD = worldPolygon(dropRoom, poseD);
  const union = unionAdjacentPolygons(vertsK, vertsD, 0.45);
  if (!union || union.length < 3) {
    throw new Error('Those rooms do not share a wall that can be fused. Split at corners, then try again.');
  }
  pushSuiteHistory(compass, uid, `merge ${dropRoom.name || drop} → ${keepRoom.name || keep}`);
  const packed = packWorldPolygon(keepRoom, poseK, union);
  const newRoom = { ...keepRoom, footprint: packed.footprint };
  const linkSources = [
    ...(keepRoom.links || []).filter(l => l.toPlaceId !== drop).map(l => ({ link: cloneLink(l), verts: vertsK })),
    ...(dropRoom.links || []).filter(l => l.toPlaceId !== keep).map(l => ({ link: cloneLink(l), verts: vertsD })),
  ];
  const remapped = remapLinksOntoPolygon(linkSources.map(s => s.link), linkSources, newRoom, packed.pose);

  mergeRoomCells(keepRoom, dropRoom);
  const walls = Array.isArray(keepRoom.internalWalls) ? keepRoom.internalWalls.slice() : [];
  for (const w of dropRoom.internalWalls || []) {
    const aW = worldFromNorm(dropRoom, poseD, Number(w.x0) || 0, Number(w.y0) || 0);
    const bW = worldFromNorm(dropRoom, poseD, Number(w.x1) || 0, Number(w.y1) || 0);
    const na = worldToFootprintNorm(aW.x, aW.y, newRoom, packed.pose);
    const nb = worldToFootprintNorm(bW.x, bW.y, newRoom, packed.pose);
    const next = normalizeInternalWall({ ...w, id: uid('wall'), x0: na.x, y0: na.y, x1: nb.x, y1: nb.y }, packed.footprint);
    if (next) walls.push(next);
  }
  keepRoom.internalWalls = walls;

  mergePlaces(compass, drop, keep);
  setFootprint(compass, keep, packed.footprint);
  withRoomMutation(compass, keep, `fuse links ${drop}`, room => {
    room.links = remapped;
    room.internalWalls = walls;
    syncExitsFromLinks(room);
  });
  const liveLayout = { ...normalizeSuiteLayout(compass.rooms[uid]?.suiteLayout) };
  liveLayout[keep] = packed.pose;
  delete liveLayout[drop];
  withRoomMutation(compass, uid, `fuse ${drop} → ${keep}`, r => {
    r.suiteLayout = normalizeSuiteLayout(liveLayout);
    if (r.suiteVisualFootprints) {
      const visuals = { ...r.suiteVisualFootprints };
      delete visuals[keep];
      delete visuals[drop];
      r.suiteVisualFootprints = visuals;
    }
  });
  reconcileSuiteSnapLinks(compass, uid);
  return compass.rooms[keep];
}

/** Insert vertices on walls where a neighbor's corner meets the edge. */
export function insertSuiteCornerVertices(compass, unitId) {
  const uid = String(unitId || '').trim();
  const unit = compass.rooms?.[uid];
  if (!unit) throw new Error(`Unit "${uid}" not found.`);
  const children0 = listSuiteChildren(compass, uid);
  const { layout: layout0 } = ensureSuiteChildPoses(unit, children0);
  if (!findCornerJunctions(children0, layout0).length) return 0;
  pushSuiteHistory(compass, uid, 'split at corners');
  let n = 0;
  for (let guard = 0; guard < 24; guard++) {
    const children = listSuiteChildren(compass, uid);
    const { layout } = ensureSuiteChildPoses(unit, children);
    const hits = findCornerJunctions(children, layout);
    if (!hits.length) break;
    const hit = hits[0];
    insertFootprintVertex(compass, hit.roomId, hit.edgeIndex, hit.t);
    n++;
  }
  return n;
}

/** One-face suite reshape: only the dragged wall moves in world space. */
export function reshapeSuiteRoomFace(compass, unitId, childId, edgeIndex, worldPoint, selectedEdges = null, worldVerts = null, step = 0) {
  const uid = String(unitId || '').trim();
  const cid = String(childId || '').trim();
  const unit = compass.rooms?.[uid];
  const room = compass.rooms?.[cid];
  if (!unit || !room) throw new Error('Room not found.');
  pushSuiteHistory(compass, uid, `reshape ${room.name || cid}`);
  const { layout } = ensureSuiteChildPoses(unit, listSuiteChildren(compass, uid));
  const pose = normalizeSuitePose(layout[cid] || { x: 0, y: 0, rot: 0 });
  const extra = Array.isArray(selectedEdges)
    ? selectedEdges.filter(e => e.placeId === cid).map(e => Number(e.edge))
    : null;
  const packed = Array.isArray(worldVerts) && worldVerts.length >= 3
    ? packWorldPolygon(room, pose, worldVerts)
    : reshapeFaceWorld(room, pose, edgeIndex, worldPoint, {
      allSelectedEdges: extra && extra.length > 1 ? extra : null,
      step: Number(step) > 0 ? Number(step) : 0,
    });
  setFootprint(compass, cid, packed.footprint);
  layout[cid] = packed.pose;
  withRoomMutation(compass, uid, `reshape ${cid}`, r => {
    r.suiteLayout = normalizeSuiteLayout(layout);
  });
  reconcileSuiteSnapLinks(compass, uid);
  return packed.pose;
}

export function sharedPairForSuiteEdge(compass, unitId, roomId, edgeIndex, along = null) {
  const uid = String(unitId || '').trim();
  const unit = compass.rooms?.[uid];
  if (!unit) return null;
  const children = listSuiteChildren(compass, uid);
  const { layout } = ensureSuiteChildPoses(unit, children);
  const storyMap = suiteStoryMap(compass, children);
  return sharedPairForEdge(children, layout, roomId, edgeIndex, storyMap, undefined, along);
}

export function sharedPairsForSuiteEdge(compass, unitId, roomId, edgeIndex) {
  const uid = String(unitId || '').trim();
  const unit = compass.rooms?.[uid];
  if (!unit) return [];
  const children = listSuiteChildren(compass, uid);
  const { layout } = ensureSuiteChildPoses(unit, children);
  const storyMap = suiteStoryMap(compass, children);
  return sharedPairsForEdge(children, layout, roomId, edgeIndex, storyMap);
}

/**
 * Align suite child poses + shared-wall vertices so contacting faces meet
 * cleanly *in the combined suite view*.
 *
 * This never rewrites a child room's own `footprint` — each room's
 * individually-authored proportions stay exactly as drawn when that room is
 * the focus. Instead, the welded vertex positions are cached on the parent
 * unit as `suiteVisualFootprints[roomId]`, a display-only override that
 * `renderSuiteFloorplan` substitutes in when drawing the family view, so
 * shared walls line up with no gaps/overlaps without touching real data.
 */
export function alignSuiteWalls(compass, unitId) {
  const uid = String(unitId || '').trim();
  const unit = compass.rooms?.[uid];
  if (!unit) throw new Error(`Unit "${uid}" not found.`);
  const children = listSuiteChildren(compass, uid);
  if (children.length < 2) throw new Error('Need at least two rooms to align.');
  const { layout } = ensureSuiteChildPoses(unit, children);
  const { layout: nextLayout, footprintPatches } = alignSuiteContactGeometry(children, layout);
  setSuiteLayout(compass, uid, nextLayout);
  withRoomMutation(compass, uid, 'suite visual align', room => {
    const visuals = { ...(room.suiteVisualFootprints || {}) };
    for (const [roomId, fp] of Object.entries(footprintPatches)) {
      visuals[roomId] = fp;
    }
    room.suiteVisualFootprints = visuals;
  });
  return { layout: nextLayout, patched: Object.keys(footprintPatches).length };
}

/** Clear a unit's cached suite-visual weld override (e.g. before re-aligning from scratch). */
export function clearSuiteVisualAlign(compass, unitId) {
  const uid = String(unitId || '').trim();
  const unit = compass.rooms?.[uid];
  if (!unit) throw new Error(`Unit "${uid}" not found.`);
  withRoomMutation(compass, uid, 'suite visual reset', room => {
    room.suiteVisualFootprints = {};
  });
}

/**
 * Persist suite child poses on a Unit and reconcile wall links from contacts.
 * @returns {{ layout: object, snaps: Array }}
 */
export function setSuiteLayout(compass, unitId, layout) {
  const uid = String(unitId || '').trim();
  const unit = compass.rooms?.[uid];
  if (!unit) throw new Error(`Suite host "${uid}" not found.`);
  if (!isSuiteHostKind(unit.kind)) throw new Error('Suite layout only applies to units and buildings.');
  const next = normalizeSuiteLayout(layout);
  withRoomMutation(compass, uid, 'suite layout', room => {
    room.suiteLayout = next;
  });
  return reconcileSuiteSnapLinks(compass, uid);
}

/** Set or clear the explicit story/floor number on a room or unit. */
export function setRoomStory(compass, placeId, story) {
  const pid = String(placeId || '').trim();
  const room = compass?.rooms?.[pid];
  if (!room) throw new Error(`Place "${pid}" not found.`);
  const n = story == null || story === '' ? null : Math.round(Number(story));
  const updated = withRoomMutation(compass, pid, `floor ${n ?? 'auto'}`, r => {
    r.story = Number.isFinite(n) ? n : null;
  });
  const parentId = String(room.parentId || '').trim();
  const parent = compass?.rooms?.[parentId];
  if (parent && isSuiteHostKind(parent.kind)) {
    try { reconcileSuiteSnapLinks(compass, parentId); } catch { /* ignore */ }
  }
  return updated;
}

/** Move one child (or nested unit) on the suite canvas; optionally snap to siblings. */
export function moveSuiteChild(compass, unitId, childId, pose, { snap = true } = {}) {
  const uid = String(unitId || '').trim();
  const cid = String(childId || '').trim();
  const unit = compass.rooms?.[uid];
  if (!unit || !isSuiteHostKind(unit.kind)) throw new Error('Suite layout requires a unit or building.');
  const children = listSuiteChildren(compass, uid);
  const nestedUnits = unit.kind === 'building' ? listSuiteUnits(compass, uid) : [];
  const isChildRoom = children.some(c => c.id === cid);
  const isNestedUnit = nestedUnits.some(u => u.id === cid);
  if (!isChildRoom && !isNestedUnit) throw new Error(`"${cid}" is not a child of this suite.`);
  const { layout } = ensureSuiteChildPoses(unit, children, compass);
  let nextPose = normalizeSuitePose(pose);
  let snapInfo = { snapped: false };
  if (snap && isChildRoom) {
    const storyMap = suiteStoryMap(compass, [...children, ...nestedUnits]);
    snapInfo = snapChildAmongSiblings(cid, nextPose, children, layout, SUITE_SNAP_TOL, storyMap);
    nextPose = snapInfo.pose;
  }
  layout[cid] = nextPose;
  withRoomMutation(compass, uid, `suite move ${cid}`, room => {
    room.suiteLayout = normalizeSuiteLayout(layout);
  });
  const result = reconcileSuiteSnapLinks(compass, uid);
  return { ...result, snap: snapInfo };
}

/**
 * A suite pose that points at another building's room (same name, different
 * parent) is not that room. Copy a shell under this suite, retarget only
 * this suite's links, and leave the original where it lives.
 * @returns {object[]} newly created rooms
 */
export function forkForeignSuiteRooms(compass, unitId) {
  const uid = String(unitId || '').trim();
  const unit = compass?.rooms?.[uid];
  if (!unit || !isSuiteHostKind(unit.kind)) return [];
  const layout = { ...(unit.suiteLayout || {}) };
  const visual = { ...(unit.suiteVisualFootprints || {}) };
  const children = listSuiteChildren(compass, uid);
  const childIds = new Set(children.map(c => c.id));
  const created = [];
  let layoutDirty = false;
  for (const posedId of Object.keys(layout)) {
    if (!posedId || childIds.has(posedId) || posedId === uid) continue;
    const foreign = compass.rooms?.[posedId];
    if (!foreign || !isLoadableKind(foreign.kind)) continue;
    if (String(foreign.parentId || '') === uid) continue;
    const inbound = [];
    for (const child of children) {
      for (const link of child.links || []) {
        if (!link?.external && link.toPlaceId === posedId) inbound.push({ child, link });
      }
    }
    if (!inbound.length) continue;
    const copy = createAndStoreRoom(compass, {
      name: foreign.name || 'Room',
      kind: foreign.kind === 'transitional' ? 'transitional' : 'room',
      parentId: uid,
      listingCode: foreign.listingCode || '',
      footprint: foreign.footprint ? JSON.parse(JSON.stringify(foreign.footprint)) : null,
    });
    for (const child of children) {
      if (!(child.links || []).some(l => l.toPlaceId === posedId)) continue;
      withRoomMutation(compass, child.id, `separate ${copy.name || 'room'}`, room => {
        for (const link of room.links || []) {
          if (link.toPlaceId === posedId) link.toPlaceId = copy.id;
        }
        syncExitsFromLinks(room);
      });
    }
    withRoomMutation(compass, foreign.id, `keep ${foreign.name || 'room'} in ${compass.rooms?.[foreign.parentId]?.name || 'its building'}`, room => {
      room.links = (room.links || []).filter(l => l.toPlaceId !== uid && !childIds.has(l.toPlaceId));
      syncExitsFromLinks(room);
    });
    const seenBack = new Set();
    for (const child of listSuiteChildren(compass, uid)) {
      for (const link of child.links || []) {
        if (link.toPlaceId !== copy.id || seenBack.has(child.id)) continue;
        seenBack.add(child.id);
        const wall = OPPOSITE_WALL[link.wall] || link.wall || 'N';
        try {
          addLink(compass, copy.id, { wall, toPlaceId: child.id, description: 'suite snap' });
        } catch { /* ignore */ }
      }
    }
    layout[copy.id] = layout[posedId];
    delete layout[posedId];
    if (visual[posedId]) {
      visual[copy.id] = visual[posedId];
      delete visual[posedId];
    }
    layoutDirty = true;
    childIds.add(copy.id);
    created.push(compass.rooms[copy.id] || copy);
  }
  if (layoutDirty) {
    withRoomMutation(compass, uid, 'separate same-named rooms', room => {
      room.suiteLayout = layout;
      room.suiteVisualFootprints = visual;
    });
  }
  return created;
}

/**
 * A room whose own doors connect exclusively into a *different* suite — and
 * not a single one of its own current siblings — almost certainly got
 * reparented into the wrong unit/building by mistake (stray edit, an earlier
 * repair that grabbed the wrong room, etc.). Move it back to the suite its
 * links actually lead into. Deliberately conservative: skip anything with
 * even one real link to a true sibling, or links split across more than one
 * foreign suite, since either means we can't be confident where it belongs.
 * @returns {object[]} rooms that were reparented back to their true suite
 */
export function repairMisparentedSuiteRooms(compass) {
  const moved = [];
  const hosts = Object.values(compass?.rooms || {}).filter(r => r && isSuiteHostKind(r.kind));
  for (const host of hosts) {
    const hostTop = topSuiteAncestorId(compass, host.id);
    for (const child of listSuiteChildren(compass, host.id)) {
      let hasOwnSiblingLink = false;
      // Group foreign links by their *top-level building*, not their immediate
      // parent — a door into the shop's Break Room and another into the shop's
      // Storage both count as "the shop", even if those rooms sit a level or
      // two apart inside the shop's own nested units.
      const foreignTops = new Map(); // topAncestorId -> representative immediate parentId
      for (const link of child.links || []) {
        if (link.external || !link.toPlaceId) continue;
        const peer = compass.rooms?.[link.toPlaceId];
        const peerParentId = String(peer?.parentId || '');
        if (!peerParentId) continue;
        if (peerParentId === host.id) { hasOwnSiblingLink = true; continue; }
        const peerTop = topSuiteAncestorId(compass, link.toPlaceId);
        if (peerTop === hostTop) { hasOwnSiblingLink = true; continue; }
        if (!foreignTops.has(peerTop)) foreignTops.set(peerTop, peerParentId);
      }
      if (hasOwnSiblingLink || foreignTops.size !== 1) continue;
      const [trueParentId] = [...foreignTops.values()];
      const trueParent = compass.rooms?.[trueParentId];
      if (!trueParent || !isSuiteHostKind(trueParent.kind) || trueParentId === child.parentId) continue;
      withRoomMutation(compass, child.id, `repair misparented ${child.name || 'room'} → ${trueParent.name || trueParentId}`, room => {
        room.parentId = trueParentId;
      });
      if (host.suiteLayout && host.suiteLayout[child.id]) {
        withRoomMutation(compass, host.id, 'drop stray suite pose (misparented room)', room => {
          const layout = { ...(room.suiteLayout || {}) };
          delete layout[child.id];
          room.suiteLayout = layout;
        });
      }
      moved.push(compass.rooms[child.id]);
    }
  }
  return moved;
}

/** Walk a place's parentId chain to its outermost host (top-level unit/building/etc). */
export function topSuiteAncestorId(compass, placeId) {
  let id = String(placeId || '').trim();
  const seen = new Set();
  while (id && compass?.rooms?.[id] && !seen.has(id)) {
    seen.add(id);
    const parentId = String(compass.rooms[id].parentId || '').trim();
    if (!parentId || !compass.rooms[parentId]) break;
    id = parentId;
  }
  return id;
}

/**
 * A door that leads into a room belonging to a totally different, unrelated
 * building (no shared top-level ancestor) — and that the far side doesn't
 * even link back to — is almost always stray data (a dangling reference left
 * over from a rename/copy, or a mistaken link in an earlier edit), not a
 * deliberately authored passage. Sever it (clear `toPlaceId`, drop any
 * "suite snap/shared" tag) so it quits bleeding the other building's rooms
 * into this one's floorplan canvas as off-canvas stub captions.
 *
 * A reciprocal link is left alone when either side carries a real note
 * (an authored secret passage). A reciprocal pair whose notes are only the
 * automatic "suite snap" / "suite shared" tags is leftover geometry from
 * when the rooms were treated as one suite, and both sides are cleared.
 * @returns {boolean} whether anything changed
 */
function isAutoSuiteLinkNote(description) {
  const s = String(description || '').trim();
  return s === 'suite snap' || s === 'suite shared';
}

function clearLinkTarget(link) {
  if (!link) return;
  link.toPlaceId = '';
  if (link.description === 'suite snap' || link.description === 'suite shared' || link.description === 'exterior') {
    link.description = '';
  }
}

export function severForeignCrossBuildingLinks(compass) {
  const rooms = compass?.rooms || {};
  let changed = false;
  for (const room of Object.values(rooms)) {
    if (!room || !isLoadableKind(room.kind)) continue;
    const myTop = topSuiteAncestorId(compass, room.id);
    const toSever = new Set();
    const peerJobs = [];
    for (const link of room.links || []) {
      const toId = String(link.toPlaceId || '').trim();
      if (!toId || link.external) continue;
      const peer = rooms[toId];
      if (!peer) continue;
      const peerTop = topSuiteAncestorId(compass, toId);
      if (!peerTop || !myTop || peerTop === myTop) continue;
      const backs = (peer.links || []).filter(l => String(l.toPlaceId || '').trim() === room.id);
      if (backs.length) {
        if (!isAutoSuiteLinkNote(link.description) || !backs.every(l => isAutoSuiteLinkNote(l.description))) continue;
        peerJobs.push({
          roomId: peer.id,
          ids: backs.map(l => l.id || String(l.toPlaceId || '')),
        });
      }
      toSever.add(link.id || toId);
    }
    if (!toSever.size && !peerJobs.length) continue;
    if (toSever.size) {
      withRoomMutation(compass, room.id, `sever stray cross-building link${toSever.size > 1 ? 's' : ''}`, r => {
        for (const l of r.links || []) {
          if (!toSever.has(l.id || l.toPlaceId)) continue;
          clearLinkTarget(l);
        }
      });
    }
    for (const job of peerJobs) {
      withRoomMutation(compass, job.roomId, 'sever stray cross-building link', r => {
        const ids = new Set(job.ids);
        for (const l of r.links || []) {
          if (!ids.has(l.id || l.toPlaceId)) continue;
          clearLinkTarget(l);
        }
      });
    }
    changed = true;
  }
  return changed;
}

/**
 * Drop the far side of a wall that points into a different top-level building.
 * Same-building links are left reciprocal. Call while `link.toPlaceId` is still set.
 */
function dropCrossBuildingReciprocal(compass, room, link) {
  if (!room || !link?.toPlaceId) return;
  const myTop = topSuiteAncestorId(compass, room.id);
  const peerTop = topSuiteAncestorId(compass, link.toPlaceId);
  if (!myTop || !peerTop || myTop === peerTop) return;
  for (const op of link.openings || []) {
    unsyncOpeningFromPeer(compass, room, link, op.id);
  }
  const hit = findPeerLink(compass, room, link);
  if (!hit?.peer || !hit.peerLink) return;
  const peerLinkId = hit.peerLink.id;
  withRoomMutation(compass, hit.peer.id, 'drop cross-building wall', r => {
    const l = (r.links || []).find(x => x.id === peerLinkId);
    if (!l) return;
    clearLinkTarget(l);
    l.external = false;
    if (!l.toPlaceId && !(l.openings || []).length) {
      r.links = (r.links || []).filter(x => x.id !== peerLinkId);
    }
    syncExitsFromLinks(r);
  });
}

/**
 * An exterior wall still aimed at a building this room no longer belongs to
 * (left behind after a reparent) is pointed at this room's own exterior host.
 * Openings stay on the wall.
 * @returns {boolean}
 */
export function retargetForeignExteriorLinks(compass) {
  const ids = Object.keys(compass?.rooms || {});
  let changed = false;
  for (const id of ids) {
    const room = compass.rooms?.[id];
    if (!room || !isLoadableKind(room.kind)) continue;
    const myTop = topSuiteAncestorId(compass, room.id);
    for (const link of [...(room.links || [])]) {
      if (!link?.external || !link.toPlaceId) continue;
      const peerTop = topSuiteAncestorId(compass, link.toPlaceId);
      if (!peerTop || !myTop || peerTop === myTop) continue;
      const liveRoom = compass.rooms?.[id];
      const live = (liveRoom?.links || []).find(l => l.id === link.id) || link;
      dropCrossBuildingReciprocal(compass, liveRoom, live);
      const host = exteriorHostForPlace(compass, compass.rooms?.[id]);
      const hostTop = host ? topSuiteAncestorId(compass, host.id) : '';
      if (host && hostTop === myTop) {
        withRoomMutation(compass, id, 'clear stale exterior', r => {
          const l = (r.links || []).find(x => x.id === link.id);
          if (!l) return;
          l.toPlaceId = '';
          l.external = true;
        });
        try { linkWallToExterior(compass, id, link.id); } catch { /* host unavailable */ }
      } else {
        withRoomMutation(compass, id, 'clear stale exterior', r => {
          const l = (r.links || []).find(x => x.id === link.id);
          if (!l) return;
          clearLinkTarget(l);
          l.external = false;
          syncExitsFromLinks(r);
        });
      }
      changed = true;
    }
  }
  return changed;
}

/**
 * Undo one wall's connection into another building, on both sides.
 * Openings on this wall stay; they just no longer name the other building.
 */
export function clearForeignWallLink(compass, roomId, linkId) {
  const rid = String(roomId || '').trim();
  const lid = String(linkId || '').trim();
  const room = compass?.rooms?.[rid];
  const link = (room?.links || []).find(l => l.id === lid);
  if (!room || !link) throw new Error('Wall link not found.');
  if (link.toPlaceId) dropCrossBuildingReciprocal(compass, compass.rooms[rid], link);
  const live = (compass.rooms?.[rid]?.links || []).find(l => l.id === lid);
  if (!live) return null;
  return setWallConnection(compass, rid, live.edge, '__none__', { linkId: lid });
}

/**
 * Ensure unit has poses for all children; write back if missing.
 * Also splits a posed room that actually belongs to another building, moves
 * back a room whose own links reveal it was reparented by mistake, and
 * severs stray links into an unrelated building, and points exterior walls
 * that still name the old building at this room's own exterior.
 */
export function ensureSuiteLayout(compass, unitId) {
  const uid = String(unitId || '').trim();
  const unit = compass.rooms?.[uid];
  if (!unit || !isSuiteHostKind(unit.kind)) return { layout: {}, dirty: false };
  const forked = forkForeignSuiteRooms(compass, uid);
  const repaired = repairSuiteSharedLinks(compass);
  // Run after the fork/link repairs above so a merely-stale cross-suite link
  // (resolved by forking a local copy) isn't misread as evidence the room
  // itself was reparented into the wrong suite.
  const misparented = repairMisparentedSuiteRooms(compass);
  const severed = severForeignCrossBuildingLinks(compass);
  const exteriors = retargetForeignExteriorLinks(compass);
  const fresh = compass.rooms?.[uid];
  const children = listSuiteChildren(compass, uid);
  let nestedDirty = false;
  if (fresh?.kind === 'building') {
    for (const nu of listSuiteUnits(compass, uid)) {
      const sub = ensureSuiteLayout(compass, nu.id);
      if (sub.dirty) nestedDirty = true;
    }
  }
  const { layout, dirty } = ensureSuiteChildPoses(fresh, children, compass);
  if (dirty) {
    withRoomMutation(compass, uid, 'suite layout init', room => {
      room.suiteLayout = layout;
    });
  }
  return {
    layout: compass.rooms?.[uid]?.suiteLayout || layout,
    dirty: dirty || nestedDirty || forked.length > 0 || repaired || misparented.length > 0 || severed || exteriors,
  };
}

export function smokeForkForeignSuiteRoomPure() {
  try {
    const fp = {
      grid: 8,
      unitPerGrid: 1,
      unitLabel: 'ft',
      vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
    };
    const compass = { rooms: {} };
    compass.rooms.upper = createRoom({ id: 'upper', name: 'Upper Unit', kind: 'unit' });
    compass.rooms.shop = createRoom({ id: 'shop', name: 'Okisato Antiques', kind: 'unit' });
    compass.rooms.bathroom = createRoom({
      id: 'bathroom', name: 'Bathroom', kind: 'room', parentId: 'upper', footprint: fp,
    });
    compass.rooms.bathroom.links = [
      { id: 'ln', wall: 'W', edge: 3, toPlaceId: 'break_room', description: 'suite snap', external: false, openings: [] },
      { id: 'ld', wall: 'E', edge: 1, toPlaceId: 'bedroom_2', description: '', external: false, openings: [] },
    ];
    compass.rooms.bathroom.occupants = [{ name: 'Hawks', cell: 'C' }];
    compass.rooms.bedroom_2 = createRoom({ id: 'bedroom_2', name: 'Bedroom', kind: 'room', parentId: 'upper' });
    compass.rooms.break_room = createRoom({
      id: 'break_room', name: 'Break Room', kind: 'room', parentId: 'shop', footprint: fp,
    });
    compass.rooms.break_room.links = [
      { id: 'lb', wall: 'E', edge: 1, toPlaceId: 'bathroom', description: 'suite snap', external: false, openings: [] },
    ];
    compass.rooms.shop.suiteLayout = {
      break_room: { x: 0, y: 0, rot: 0 },
      bathroom: { x: 8, y: 0, rot: 0 },
    };
    const { dirty } = ensureSuiteLayout(compass, 'shop');
    if (!dirty) return 'fork did not mark the suite dirty';
    if (compass.rooms.bathroom.parentId !== 'upper') return 'upper bathroom was moved';
    const stillHawks = (compass.rooms.bathroom.occupants || []).some(o => o.name === 'Hawks');
    if (!stillHawks) return 'upper bathroom lost its occupant';
    const shopBaths = Object.values(compass.rooms).filter(r => r.name === 'Bathroom' && r.parentId === 'shop');
    if (shopBaths.length !== 1) return `expected one shop bathroom, got ${shopBaths.length}`;
    const shopBath = shopBaths[0];
    if (shopBath.id === 'bathroom') return 'shop bathroom reused the upper unit id';
    if (compass.rooms.shop.suiteLayout.bathroom) return 'shop layout still poses the upper bathroom';
    if (!compass.rooms.shop.suiteLayout[shopBath.id]) return 'shop layout missing its own bathroom';
    if (!(compass.rooms.break_room.links || []).some(l => l.toPlaceId === shopBath.id)) return 'break room still opens into the upper bathroom';
    if ((compass.rooms.break_room.links || []).some(l => l.toPlaceId === 'bathroom')) return 'break room kept the upper bathroom link';
    if ((compass.rooms.bathroom.links || []).some(l => l.toPlaceId === 'break_room')) return 'upper bathroom still opens into the shop';
    if (!(compass.rooms.bathroom.links || []).some(l => l.toPlaceId === 'bedroom_2')) return 'upper bathroom lost its bedroom door';
    if (!disambiguatedPlaceName(compass, shopBath).includes('Okisato')) return 'shop bathroom label missing its building';
    if (!disambiguatedPlaceName(compass, compass.rooms.bathroom).includes('Upper')) return 'upper bathroom label missing its building';
    return '';
  } catch (err) {
    return String(err && err.stack ? err.stack : err);
  }
}

/**
 * A room reparented by mistake into a different unit/building — none of its
 * own doors lead to a sibling in its *current* parent, but they all lead
 * into one other suite — should get moved back automatically so it stops
 * bleeding into (and overlapping) that other suite's floorplan canvas.
 */
export function smokeRepairMisparentedSuiteRoomsPure() {
  try {
    const compass = { rooms: {} };
    compass.rooms.upperBldg = createRoom({ id: 'upperBldg', name: 'Upper Unit', kind: 'unit' });
    compass.rooms.shopBldg = createRoom({ id: 'shopBldg', name: 'Okisato Antiques', kind: 'unit' });
    compass.rooms.bedroom = createRoom({ id: 'bedroom', name: 'Bedroom', kind: 'room', parentId: 'upperBldg' });
    compass.rooms.breakRoom = createRoom({ id: 'breakRoom', name: 'Break Room', kind: 'room', parentId: 'shopBldg' });
    compass.rooms.storage = createRoom({ id: 'storage', name: 'Storage', kind: 'room', parentId: 'shopBldg' });
    // "office" was mistakenly reparented under the Upper Unit, but every one
    // of its own doors actually leads into the shop (Break Room AND Storage)
    // — none lead to anything in the Upper Unit (not even its own "sibling"
    // Bedroom).
    compass.rooms.office = createRoom({ id: 'office', name: 'Office', kind: 'room', parentId: 'upperBldg' });
    compass.rooms.office.links = [
      { id: 'lo', wall: 'N', edge: 0, toPlaceId: 'breakRoom', description: '', external: false, openings: [] },
      { id: 'los', wall: 'E', edge: 1, toPlaceId: 'storage', description: '', external: false, openings: [] },
    ];
    compass.rooms.breakRoom.links = [
      { id: 'lb', wall: 'S', edge: 2, toPlaceId: 'office', description: '', external: false, openings: [] },
    ];
    const moved = repairMisparentedSuiteRooms(compass);
    if (!moved.some(r => r.id === 'office')) return 'office should have been flagged as misparented';
    if (compass.rooms.office.parentId !== 'shopBldg') return `office should move to the shop, got ${compass.rooms.office.parentId}`;
    if (!listSuiteChildren(compass, 'shopBldg').some(r => r.id === 'office')) return 'shop should now list office as a child';
    if (listSuiteChildren(compass, 'upperBldg').some(r => r.id === 'office')) return 'upper unit should no longer list office as a child';

    // A room with a genuine (even if lone) connection to its own suite must
    // NOT be moved just because it also has an unrelated foreign link —
    // e.g. a deliberate secret passage between two buildings.
    compass.rooms.den = createRoom({ id: 'den', name: 'Den', kind: 'room', parentId: 'upperBldg' });
    compass.rooms.den.links = [
      { id: 'ld1', wall: 'E', edge: 1, toPlaceId: 'bedroom', description: '', external: false, openings: [] },
      { id: 'ld2', wall: 'W', edge: 3, toPlaceId: 'breakRoom', description: 'secret passage', external: false, openings: [] },
    ];
    const movedAgain = repairMisparentedSuiteRooms(compass);
    if (movedAgain.some(r => r.id === 'den')) return 'den has a real sibling link and should not have been moved';
    if (compass.rooms.den.parentId !== 'upperBldg') return 'den should have stayed in the upper unit';

    // Each building keeps its OWN independent bathroom (same room name,
    // unrelated rooms, different parents) — matching by id, never by name,
    // means neither bathroom should ever be moved or merged into the other.
    compass.rooms.upperBath = createRoom({ id: 'upperBath', name: 'Bathroom', kind: 'room', parentId: 'upperBldg' });
    compass.rooms.upperBath.links = [
      { id: 'lub', wall: 'N', edge: 0, toPlaceId: 'bedroom', description: '', external: false, openings: [] },
    ];
    compass.rooms.shopBath = createRoom({ id: 'shopBath', name: 'Bathroom', kind: 'room', parentId: 'shopBldg' });
    compass.rooms.shopBath.links = [
      { id: 'lsb', wall: 'N', edge: 0, toPlaceId: 'breakRoom', description: '', external: false, openings: [] },
    ];
    const movedBathrooms = repairMisparentedSuiteRooms(compass);
    if (movedBathrooms.some(r => r.id === 'upperBath' || r.id === 'shopBath')) {
      return 'neither independently-parented bathroom should have been touched';
    }
    if (compass.rooms.upperBath.parentId !== 'upperBldg') return 'upper unit bathroom should stay in the upper unit';
    if (compass.rooms.shopBath.parentId !== 'shopBldg') return 'shop bathroom should stay in the shop';
    return '';
  } catch (err) {
    return String(err && err.stack ? err.stack : err);
  }
}

/**
 * A real, correctly-parented apartment room (e.g. the Upper Unit's own
 * Closet) can still carry a one-sided, dangling door that points at a room
 * in an entirely different building (the Antique Shop's Break Room) — stray
 * data left over from an edit, not an authored connection. That should get
 * severed so it stops surfacing as an off-canvas stub bleeding the other
 * building's rooms into this one's floorplan. A *reciprocal* link (the far
 * side links back too — an authored secret passage) must survive untouched.
 */
export function smokeSeverForeignCrossBuildingLinksPure() {
  try {
    const compass = { rooms: {} };
    compass.rooms.upperBldg = createRoom({ id: 'upperBldg', name: 'Upper Unit', kind: 'unit' });
    compass.rooms.shopBldg = createRoom({ id: 'shopBldg', name: 'Okisato Antiques', kind: 'unit' });
    compass.rooms.bedroom = createRoom({ id: 'bedroom', name: 'Bedroom', kind: 'room', parentId: 'upperBldg' });
    compass.rooms.breakRoom = createRoom({ id: 'breakRoom', name: 'Break Room', kind: 'room', parentId: 'shopBldg' });
    compass.rooms.storage = createRoom({ id: 'storage', name: 'Storage', kind: 'room', parentId: 'shopBldg' });
    // Closet legitimately belongs to the Upper Unit (real link to Bedroom),
    // but also carries a one-sided, dangling door to the shop's Break Room.
    compass.rooms.closet = createRoom({ id: 'closet', name: 'Closet', kind: 'room', parentId: 'upperBldg' });
    compass.rooms.closet.links = [
      { id: 'lcb', wall: 'N', edge: 0, toPlaceId: 'bedroom', description: '', external: false, openings: [] },
      { id: 'lcbr', wall: 'E', edge: 1, toPlaceId: 'breakRoom', description: 'suite snap', external: false, openings: [] },
    ];
    // The Upper Unit's OWN bathroom has a reciprocal cross-building link to
    // the shop's Storage — an authored secret passage — which must NOT be
    // severed, even though the two bathrooms belong to different buildings.
    compass.rooms.bathroom = createRoom({ id: 'bathroom', name: 'Bathroom', kind: 'room', parentId: 'upperBldg' });
    compass.rooms.bathroom.links = [
      { id: 'lbs', wall: 'S', edge: 2, toPlaceId: 'storage', description: '', external: false, openings: [{ id: 'op1', type: 'door', along: 0.5, width: 0.16, cell: 'C' }] },
    ];
    compass.rooms.storage.links = [
      { id: 'lsb', wall: 'N', edge: 0, toPlaceId: 'bathroom', description: '', external: false, openings: [] },
    ];
    const changed = severForeignCrossBuildingLinks(compass);
    if (!changed) return 'expected the closet → break room link to be severed';
    if ((compass.rooms.closet.links || []).some(l => l.toPlaceId === 'breakRoom')) {
      return 'closet should no longer link to the shop break room';
    }
    if (!(compass.rooms.closet.links || []).some(l => l.toPlaceId === 'bedroom')) {
      return 'closet should keep its real link to bedroom';
    }
    if (!(compass.rooms.bathroom.links || []).some(l => l.toPlaceId === 'storage')) {
      return 'bathroom\'s reciprocal passage to storage should not have been severed';
    }

    // Automatic suite-snap tags on both sides are leftover geometry, not a
    // passage the user wrote down. Both ends should let go.
    compass.rooms.office = createRoom({ id: 'office', name: 'Office', kind: 'room', parentId: 'shopBldg' });
    compass.rooms.bathroom.links.push({
      id: 'lbsnap', wall: 'W', edge: 3, toPlaceId: 'office', description: 'suite snap', external: false, openings: [],
    });
    compass.rooms.office.links = [
      { id: 'losnap', wall: 'E', edge: 1, toPlaceId: 'bathroom', description: 'suite snap', external: false, openings: [] },
    ];
    severForeignCrossBuildingLinks(compass);
    if ((compass.rooms.bathroom.links || []).some(l => l.toPlaceId === 'office')) {
      return 'suite-snap bathroom → office link should have been severed';
    }
    if ((compass.rooms.office.links || []).some(l => l.toPlaceId === 'bathroom')) {
      return 'suite-snap office → bathroom link should have been severed';
    }
    if (!(compass.rooms.bathroom.links || []).some(l => l.toPlaceId === 'storage')) {
      return 'authored passage should still be intact after the snap cleanup';
    }
    return '';
  } catch (err) {
    return String(err && err.stack ? err.stack : err);
  }
}

/** Clearing one side of a cross-building wall drops the other side too. */
export function smokeClearForeignWallPure() {
  try {
    const compass = { rooms: {} };
    compass.rooms.upper = createRoom({ id: 'upper', name: 'Upper Unit', kind: 'unit' });
    compass.rooms.shop = createRoom({ id: 'shop', name: 'Okisato Antiques', kind: 'building' });
    compass.rooms.bath = createRoom({ id: 'bath', name: 'Bathroom', kind: 'room', parentId: 'upper' });
    compass.rooms.shopBath = createRoom({ id: 'shopBath', name: 'Bathroom', kind: 'room', parentId: 'shop' });
    compass.rooms.bath.links = [
      { id: 'lb', wall: 'N', edge: 0, toPlaceId: 'shopBath', description: '', external: false, openings: [{ id: 'op1', type: 'door', along: 0.5, width: 0.16, cell: 'C' }] },
    ];
    compass.rooms.shopBath.links = [
      { id: 'lsb', wall: 'S', edge: 2, toPlaceId: 'bath', description: '', external: false, openings: [] },
    ];
    clearForeignWallLink(compass, 'bath', 'lb');
    if ((compass.rooms.bath.links || []).some(l => l.toPlaceId === 'shopBath')) {
      return 'upper bathroom should no longer name the shop bathroom';
    }
    if ((compass.rooms.shopBath.links || []).some(l => l.toPlaceId === 'bath')) {
      return 'shop bathroom should no longer point back at the upper bathroom';
    }
    const kept = (compass.rooms.bath.links || []).find(l => l.id === 'lb');
    if (!kept || !(kept.openings || []).some(o => o.id === 'op1')) {
      return 'clearing the wall should keep the door on the upper bathroom';
    }
    return '';
  } catch (err) {
    return String(err && err.stack ? err.stack : err);
  }
}

/** Exterior walls left pointing at a former building follow the room's real host. */
export function smokeRetargetForeignExteriorPure() {
  try {
    const compass = { rooms: {} };
    compass.rooms.duplex = createRoom({ id: 'duplex', name: 'Overgrown Duplex', kind: 'building' });
    compass.rooms.upper = createRoom({ id: 'upper', name: 'Upper Unit', kind: 'unit', parentId: 'duplex' });
    compass.rooms.shop = createRoom({ id: 'shop', name: 'Okisato Antiques', kind: 'building' });
    compass.rooms.bath = createRoom({ id: 'bath', name: 'Bathroom', kind: 'room', parentId: 'upper' });
    compass.rooms.bath.links = [
      { id: 'le', wall: 'E', edge: 1, toPlaceId: 'shop', description: 'exterior', external: true, openings: [{ id: 'win', type: 'window', along: 0.5, width: 0.16, cell: 'C' }] },
    ];
    compass.rooms.shop.links = [
      { id: 'lse', wall: 'E', edge: null, toPlaceId: 'bath', description: 'exterior', external: false, openings: [] },
    ];
    if (!retargetForeignExteriorLinks(compass)) return 'stale exterior was not retargeted';
    const wall = (compass.rooms.bath.links || []).find(l => l.id === 'le');
    if (!wall) return 'bathroom lost its exterior wall';
    if (wall.toPlaceId !== 'duplex') return `exterior should face the duplex, got ${wall.toPlaceId}`;
    if (!wall.external) return 'retargeted wall should stay an exterior wall';
    if (!(wall.openings || []).some(o => o.id === 'win')) return 'window should stay on the retargeted wall';
    if ((compass.rooms.shop.links || []).some(l => l.toPlaceId === 'bath')) {
      return 'Okisato should no longer list the upper bathroom on its walls';
    }
    return '';
  } catch (err) {
    return String(err && err.stack ? err.stack : err);
  }
}

function pairKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Create reciprocal wall links for contacting suite siblings;
 * drop or unbind sibling links whose specific wall/edge is no longer touching that sibling.
 */
export function reconcileSuiteSnapLinks(compass, unitId) {
  const uid = String(unitId || '').trim();
  ensureSuiteLayout(compass, uid);
  const unit = compass.rooms[uid];
  const children = listSuiteChildren(compass, uid);
  const childIds = new Set(children.map(c => c.id));
  const layout = normalizeSuiteLayout(unit.suiteLayout);
  const storyMap = suiteStoryMap(compass, children);
  const pairs = findContactingPairs(children, layout, SUITE_SNAP_TOL, storyMap);

  // First clean up stale sibling links before establishing current contacts,
  // so an edge that no longer touches a sibling releases it (or frees the edge
  // to bind to its real neighbor).
  for (const child of children) {
    const room = compass.rooms[child.id];
    if (!room?.links?.length) continue;
    const keep = [];
    let changed = false;
    for (const link of room.links) {
      const to = link.toPlaceId;
      if (!to || !childIds.has(to)) {
        keep.push(link);
        continue;
      }
      const hasEdge = link.edge != null && link.edge !== '' && Number.isFinite(Number(link.edge));
      const ei = hasEdge ? Number(link.edge) : null;
      const matchingPair = pairs.find(p => {
        if (p.aId === child.id && p.bId === to) {
          return ei != null ? p.edgeA === ei : p.wallA === link.wall;
        }
        if (p.bId === child.id && p.aId === to) {
          return ei != null ? p.edgeB === ei : p.wallB === link.wall;
        }
        return false;
      });
      if (matchingPair) {
        if (ei == null) {
          const realEdge = matchingPair.aId === child.id ? matchingPair.edgeA : matchingPair.edgeB;
          if (Number.isFinite(realEdge)) {
            link.edge = realEdge;
            changed = true;
          }
        }
        keep.push(link);
        continue;
      }
      // This link's edge/wall does NOT contact sibling `to`!
      // Strip any mirrored copies from `to` first.
      for (const op of link.openings || []) {
        unsyncOpeningFromPeer(compass, room, link, op.id);
      }
      const hasOpenings = Array.isArray(link.openings) && link.openings.length > 0;
      if (hasOpenings) {
        // Keep the user's fixture (e.g. door/window on an outer wall), but
        // unbind the stale sibling (or rebind to whoever actually touches this edge).
        const opAlong = link.openings[0]?.along;
        const altPair = ei != null
          ? sharedPairForEdge(children, layout, child.id, ei, storyMap, SUITE_SNAP_TOL, opAlong)
          : null;
        link.toPlaceId = altPair?.peerId || '';
        if (!link.toPlaceId && (link.description === 'suite snap' || link.description === 'suite shared')) {
          link.description = '';
        }
        keep.push(link);
        changed = true;
      } else if (link.sharedStyle === 'threshold' || link.sharedStyle === 'open') {
        // Only preserve deliberate threshold/open styling if the two rooms don't touch
        // on some OTHER wall (which would mean the room was rearranged).
        const touchesElsewhere = pairs.some(p =>
          (p.aId === child.id && p.bId === to) || (p.bId === child.id && p.aId === to));
        if (!touchesElsewhere) {
          keep.push(link);
        } else {
          changed = true;
        }
      } else {
        changed = true;
      }
    }
    if (changed) {
      withRoomMutation(compass, child.id, 'suite unlink detached', r => {
        r.links = keep;
        syncExitsFromLinks(r);
      });
    }
  }

  for (const pair of pairs) {
    ensureReciprocalWallLink(compass, pair.aId, pair.wallA, pair.bId, pair.edgeA);
    ensureReciprocalWallLink(compass, pair.bId, pair.wallB, pair.aId, pair.edgeB);
  }

  // Re-home openings on multi-neighbor edges to the neighbor whose contact span covers `op.along`
  for (const child of children) {
    const room = compass.rooms[child.id];
    if (!room?.links?.length) continue;
    for (const link of room.links.slice()) {
      if (!link.openings?.length || link.edge == null || link.edge === '') continue;
      const ei = Number(link.edge);
      if (!Number.isFinite(ei)) continue;
      const edgePairs = sharedPairsForEdge(children, layout, child.id, ei, storyMap, SUITE_SNAP_TOL);
      if (edgePairs.length < 2) continue;
      for (const op of link.openings.slice()) {
        const best = sharedPairForEdge(children, layout, child.id, ei, storyMap, SUITE_SNAP_TOL, op.along);
        if (!best?.peerId || best.peerId === link.toPlaceId) continue;
        const targetLink = (room.links || []).find(l => l.edge === ei && l.toPlaceId === best.peerId);
        if (!targetLink || targetLink.id === link.id) continue;
        unsyncOpeningFromPeer(compass, room, link, op.id);
        withRoomMutation(compass, child.id, 'rebind opening span', r => {
          const srcL = (r.links || []).find(x => x.id === link.id);
          const dstL = (r.links || []).find(x => x.id === targetLink.id);
          if (!srcL || !dstL) return;
          srcL.openings = (srcL.openings || []).filter(o => o.id !== op.id);
          dstL.openings = dstL.openings || [];
          if (!dstL.openings.some(o => o.id === op.id)) dstL.openings.push(op);
          syncExitsFromLinks(r);
        });
        const liveRoom = compass.rooms[child.id];
        const liveTarget = (liveRoom.links || []).find(x => x.id === targetLink.id);
        if (liveTarget) syncOpeningToPeer(compass, liveRoom, liveTarget, op);
      }
    }
  }

  return { layout: normalizeSuiteLayout(compass.rooms[uid].suiteLayout), snaps: pairs };
}

function ensureReciprocalWallLink(compass, fromId, wall, toId, explicitEdge = null) {
  const room = compass.rooms[fromId];
  if (!room) return;
  const w = normalizeWall(wall);
  const peer = compass.rooms[toId];
  const edge = Number.isFinite(Number(explicitEdge)) && explicitEdge !== null && explicitEdge !== ''
    ? Number(explicitEdge)
    : (peer ? resolveSharedEdge(compass, room, peer, w) : null);
  const existing = (room.links || []).find(l =>
    l.toPlaceId === toId && (Number.isFinite(edge) ? l.edge === edge : l.wall === w));
  if (existing) {
    if (Number.isFinite(edge) && existing.edge !== edge) {
      withRoomMutation(compass, fromId, 'suite snap edge', r => {
        const l = (r.links || []).find(x => x.id === existing.id);
        if (l) { l.edge = edge; l.wall = w; }
      });
    }
    return existing;
  }
  if (Number.isFinite(edge)) {
    const onEdge = (room.links || []).find(l => l.edge === edge && !l.toPlaceId && !l.external);
    if (onEdge) {
      // Only adopt an unlinked link with openings if its opening falls on this neighbor's contact span
      let canAdopt = true;
      if (onEdge.openings?.length && room.parentId) {
        const hit = sharedPairForSuiteEdge(compass, room.parentId, fromId, edge, onEdge.openings[0]?.along);
        if (hit?.peerId && hit.peerId !== toId) canAdopt = false;
      }
      if (canAdopt) {
        const adopted = withRoomMutation(compass, fromId, 'suite snap link', r => {
          const l = (r.links || []).find(x => x.id === onEdge.id);
          if (l) {
            l.toPlaceId = toId;
            l.wall = w;
            l.external = false;
            if (!l.description) l.description = 'suite snap';
            syncExitsFromLinks(r);
          }
          return l;
        });
        const liveRoom = compass.rooms[fromId];
        const liveLink = (liveRoom?.links || []).find(x => x.id === onEdge.id);
        for (const op of liveLink?.openings || []) {
          syncOpeningToPeer(compass, liveRoom, liveLink, op);
        }
        return adopted;
      }
    }
  }
  return addLink(compass, fromId, { wall: w, edge, toPlaceId: toId, description: 'suite snap' });
}

export {
  listSuiteChildren,
  listSuiteUnits,
  suiteUnitOuterSilhouette,
  inferStoryFromName,
} from './suiteLayout.js';


export function removeLink(compass, roomId, linkId) {
  const lid = String(linkId || '').trim();
  const room = compass?.rooms?.[roomId];
  const link = (room?.links || []).find(l => l.id === lid);
  if (room && link?.toPlaceId) {
    dropCrossBuildingReciprocal(compass, room, link);
    const liveRoom = compass.rooms?.[roomId] || room;
    const liveLink = (liveRoom.links || []).find(l => l.id === lid) || link;
    for (const op of liveLink.openings || []) {
      unsyncOpeningFromPeer(compass, liveRoom, liveLink, op.id);
    }
  }
  return withRoomMutation(compass, roomId, `unlink ${lid}`, r => {
    const i = (r.links || []).findIndex(l => l.id === lid);
    if (i < 0) throw new Error('Link not found.');
    r.links.splice(i, 1);
    syncExitsFromLinks(r);
  });
}

/** Find or create a wall-edge link for fixtures (doors/windows) — resolves the neighbor at `along` when on a multi-neighbor wall. */
export function ensureEdgeLink(compass, roomId, edgeIdx, along = null) {
  const edge = Math.max(0, Math.floor(Number(edgeIdx)));
  if (!Number.isFinite(edge)) throw new Error('Wall required.');
  const room0 = compass?.rooms?.[roomId];
  const parent = room0?.parentId ? compass?.rooms?.[room0.parentId] : null;
  let targetPeerId = '';
  let targetWall = '';
  if (room0 && parent && isSuiteHostKind(parent.kind)) {
    try {
      const pair = sharedPairForSuiteEdge(compass, parent.id, roomId, edge, along);
      if (pair?.peerId) {
        targetPeerId = pair.peerId;
        targetWall = pair.myWall || '';
      }
    } catch { /* ignore */ }
  }
  const siblingIds = parent && isSuiteHostKind(parent.kind)
    ? new Set(listSuiteChildren(compass, parent.id).map(c => c.id))
    : new Set();

  return withRoomMutation(compass, roomId, `wall link ${edge}`, room => {
    if (targetPeerId) {
      const forPeer = (room.links || []).find(l => l.edge === edge && l.toPlaceId === targetPeerId);
      if (forPeer) return forPeer;
      const unlinked = (room.links || []).find(l => l.edge === edge && !l.toPlaceId && !l.external);
      if (unlinked) return unlinked;
    } else {
      const nonSibling = (room.links || []).find(l => l.edge === edge && (!l.toPlaceId || !siblingIds.has(l.toPlaceId)));
      if (nonSibling) return nonSibling;
      const anyEdge = (room.links || []).find(l => l.edge === edge);
      if (anyEdge && !siblingIds.size) return anyEdge;
    }
    let wall = targetWall || EDGE_TO_CARDINAL[edge] || '';
    try {
      const card = edgeCardinal(room.footprint, edge);
      if (card) wall = card;
    } catch { /* keep */ }
    const link = {
      id: uid('lnk'),
      wall,
      edge,
      toPlaceId: targetPeerId || '',
      description: targetPeerId ? 'suite snap' : '',
      external: false,
      sharedStyle: 'merged',
      openings: [],
    };
    room.links = room.links || [];
    room.links.push(link);
    return link;
  });
}

/** Find or create an above/below link for ascent / descent fixtures. */
export function ensureVerticalLink(compass, roomId, wall) {
  const w = wall === 'below' ? 'below' : 'above';
  return withRoomMutation(compass, roomId, `${w} link`, room => {
    const existing = (room.links || []).find(l => l.wall === w && (l.edge == null || l.edge === ''));
    if (existing) return existing;
    const link = {
      id: uid('lnk'),
      wall: w,
      edge: null,
      toPlaceId: '',
      description: '',
      external: false,
      openings: [],
    };
    room.links = room.links || [];
    room.links.push(link);
    return link;
  });
}

/** World-space endpoints {a,b} of a suite child's footprint edge (via pose). */
function suiteChildWorldEdge(compass, room, edge) {
  const parent = compass?.rooms?.[room?.parentId || ''];
  if (!parent || !isSuiteHostKind(parent.kind)) return null;
  const pose = normalizeSuitePose(parent.suiteLayout?.[room.id] || { x: 0, y: 0, rot: 0 });
  const verts = worldPolygon(room, pose);
  const n = verts.length;
  if (!n || !Number.isFinite(Number(edge))) return null;
  const i = ((Math.floor(Number(edge)) % n) + n) % n;
  return { a: verts[i], b: verts[(i + 1) % n] };
}

/**
 * Map an opening from `room`'s wall to the reciprocal `peer` wall using true
 * world geometry, so the mirrored copy lands at the *same physical point* even
 * when the two walls differ in length or are offset (a wide Entry wall vs a
 * narrow Bedroom wall).
 * @returns {undefined} geometry unavailable (caller should fall back)
 * @returns {null} the opening does not physically sit on the peer's wall — it's
 *   on a stretch shared with a *different* neighbour, or the walls aren't
 *   really collinear, so it must NOT be mirrored.
 * @returns {{along:number,width:number}} the mapped position on the peer wall.
 */
function mapAlongToPeerWorld(compass, room, link, peer, peerLink, op) {
  if (!room || !peer || (room.parentId || '') !== (peer.parentId || '')) return undefined;
  const own = suiteChildWorldEdge(compass, room, link?.edge);
  const peerEdge = suiteChildWorldEdge(compass, peer, peerLink?.edge);
  if (!own || !peerEdge) return undefined;
  const along = Number.isFinite(op?.along) ? op.along : 0.5;
  const center = {
    x: own.a.x + (own.b.x - own.a.x) * along,
    y: own.a.y + (own.b.y - own.a.y) * along,
  };
  const dx = peerEdge.b.x - peerEdge.a.x;
  const dy = peerEdge.b.y - peerEdge.a.y;
  const len2 = dx * dx + dy * dy || 1;
  const len = Math.sqrt(len2);
  const t = ((center.x - peerEdge.a.x) * dx + (center.y - peerEdge.a.y) * dy) / len2;
  const dist = Math.abs((center.x - peerEdge.a.x) * dy - (center.y - peerEdge.a.y) * dx) / len;
  // `dist` guards against a perpendicular / far-away wall (metres off-line);
  // `t` guards against the opening sitting past the peer wall's extent (the
  // stretch shared with a *different* neighbour). Keep `dist` generous so a
  // modestly un-aligned but genuine shared wall still maps.
  if (dist > 1.5 || t < -0.02 || t > 1.02) return null;
  const ownLen = Math.hypot(own.b.x - own.a.x, own.b.y - own.a.y) || len;
  return {
    along: Math.round(Math.max(0.02, Math.min(0.98, t)) * 1000) / 1000,
    width: Math.round((Number(op.width) || 0.14) * (ownLen / len) * 1000) / 1000,
  };
}

/**
 * True when `room`'s `link` and its reciprocal `peerLink` describe a *genuine*
 * shared wall: their edges are parallel, collinear, and actually overlap. A
 * link between perpendicular / non-touching walls (a stale relationship left by
 * an earlier edge mix-up) is not, and must not sync openings across.
 */
function isGenuineSharedWall(compass, room, link, peer, peerLink) {
  if (!room || !peer || (room.parentId || '') !== (peer.parentId || '')) return true;
  const own = suiteChildWorldEdge(compass, room, link?.edge);
  const peerEdge = suiteChildWorldEdge(compass, peer, peerLink?.edge);
  if (!own || !peerEdge) return true; // can't tell (non-suite) — assume ok
  const ux = own.b.x - own.a.x;
  const uy = own.b.y - own.a.y;
  const vx = peerEdge.b.x - peerEdge.a.x;
  const vy = peerEdge.b.y - peerEdge.a.y;
  const uLen = Math.hypot(ux, uy) || 1;
  const vLen = Math.hypot(vx, vy) || 1;
  const sinA = Math.abs(ux * vy - uy * vx) / (uLen * vLen);
  if (sinA > 0.35) return false; // clearly not parallel (e.g. perpendicular)
  const distA = Math.abs((peerEdge.a.x - own.a.x) * uy - (peerEdge.a.y - own.a.y) * ux) / uLen;
  const distB = Math.abs((peerEdge.b.x - own.a.x) * uy - (peerEdge.b.y - own.a.y) * ux) / uLen;
  if (distA > 2.0 && distB > 2.0) return false; // far off the same line
  const tA = ((peerEdge.a.x - own.a.x) * ux + (peerEdge.a.y - own.a.y) * uy) / (uLen * uLen);
  const tB = ((peerEdge.b.x - own.a.x) * ux + (peerEdge.b.y - own.a.y) * uy) / (uLen * uLen);
  return Math.max(tA, tB) > 0.02 && Math.min(tA, tB) < 0.98; // intervals overlap
}

/**
 * One-time / on-load repair: drop stale links between same-suite rooms whose
 * walls don't actually form a shared wall (e.g. a Display Floor *west* outer
 * wall wrongly linked to Break Room). Preserves cross-unit / corridor links
 * (`peer.parentId !== child.parentId`) and any openings placed on the wall.
 */
function repairSuiteSharedLinks(compass) {
  const rooms = compass?.rooms || {};
  const units = Object.values(rooms).filter(r => isSuiteHostKind(r?.kind));
  let changed = false;
  for (const unit of units) {
    const children = listSuiteChildren(compass, unit.id);
    if (!children.length) continue;
    const childIds = new Set(children.map(c => c.id));
    const { layout } = ensureSuiteChildPoses(unit, children);
    const storyMap = suiteStoryMap(compass, children);
    const pairs = findContactingPairs(children, layout, SUITE_SNAP_TOL, storyMap);

    for (const child of children) {
      const keep = [];
      for (const link of child.links || []) {
        const to = link.toPlaceId;
        if (!to || !childIds.has(to)) {
          keep.push(link);
          continue;
        }
        const peer = rooms[to];
        if (!peer) {
          link.toPlaceId = '';
          keep.push(link);
          continue;
        }
        const hasEdge = link.edge != null && link.edge !== '' && Number.isFinite(Number(link.edge));
        const ei = hasEdge ? Number(link.edge) : null;
        const matchingPair = pairs.find(p => {
          if (p.aId === child.id && p.bId === to) {
            return ei != null ? p.edgeA === ei : p.wallA === link.wall;
          }
          if (p.bId === child.id && p.aId === to) {
            return ei != null ? p.edgeB === ei : p.wallB === link.wall;
          }
          return false;
        });
        const hit = findPeerLink(compass, child, link);
        const genuine = matchingPair
          && (!hit?.peerLink || isGenuineSharedWall(compass, child, link, peer, hit.peerLink));
        if (genuine) {
          if (ei == null) {
            const realEdge = matchingPair.aId === child.id ? matchingPair.edgeA : matchingPair.edgeB;
            if (Number.isFinite(realEdge)) link.edge = realEdge;
          }
          keep.push(link);
          continue;
        }
        // Bogus same-suite link on a non-contacting edge: strip mirrored copies from peer
        const ids = new Set((link.openings || []).map(o => o.id));
        if (ids.size) {
          for (const pl of peer.links || []) {
            if (pl.toPlaceId === child.id) {
              pl.openings = (pl.openings || []).filter(o => !ids.has(o.id));
            }
          }
        }
        if ((link.openings || []).length) {
          const opAlong = link.openings[0]?.along;
          const altPair = ei != null
            ? sharedPairForEdge(children, layout, child.id, ei, storyMap, SUITE_SNAP_TOL, opAlong)
            : null;
          let peerId = altPair?.peerId || '';
          // A door on a wall that does not touch its labeled room (Storage)
          // belongs on the sibling this room actually shares, when there is one.
          if (!peerId) {
            const touched = pairs.filter(p => p.aId === child.id || p.bId === child.id);
            const ids = [...new Set(touched.map(p => (p.aId === child.id ? p.bId : p.aId)))];
            if (ids.length === 1) peerId = ids[0];
          }
          if (peerId && peerId !== to) {
            const dest = (child.links || []).find(l => l !== link && l.toPlaceId === peerId)
              || keep.find(l => l.toPlaceId === peerId);
            if (dest) {
              dest.openings = dest.openings || [];
              for (const op of link.openings) {
                if (!dest.openings.some(o => o.id === op.id)) dest.openings.push(op);
              }
              link.openings = [];
              link.toPlaceId = '';
            } else {
              link.toPlaceId = peerId;
              const pair = pairs.find(p =>
                (p.aId === child.id && p.bId === peerId) || (p.bId === child.id && p.aId === peerId));
              if (pair) {
                const edge = pair.aId === child.id ? pair.edgeA : pair.edgeB;
                const wall = pair.aId === child.id ? pair.wallA : pair.wallB;
                if (Number.isFinite(edge)) link.edge = edge;
                if (wall) link.wall = wall;
              }
            }
          } else {
            link.toPlaceId = peerId;
          }
          if (!link.toPlaceId && (link.description === 'suite snap' || link.description === 'suite shared')) {
            link.description = '';
          }
          if (link.toPlaceId || (link.openings || []).length) keep.push(link);
          changed = true;
        } else if (/\b(storage|storeroom)\b/i.test(String(peer?.name || ''))) {
          const br = keep.find(l => /\bbreak\b/i.test(String(rooms[l.toPlaceId]?.name || '')) && !(l.openings || []).length);
          if (br) {
            const mate = rooms[br.toPlaceId];
            const back = (mate?.links || []).find(l => l.toPlaceId === child.id);
            const ownEdge = suiteChildWorldEdge(compass, child, br.edge);
            const mateEdge = back ? suiteChildWorldEdge(compass, mate, back.edge) : null;
            let along = 0.5;
            if (ownEdge && mateEdge) {
              const dx = ownEdge.b.x - ownEdge.a.x;
              const dy = ownEdge.b.y - ownEdge.a.y;
              const len2 = dx * dx + dy * dy || 1;
              const tOf = (p) => ((p.x - ownEdge.a.x) * dx + (p.y - ownEdge.a.y) * dy) / len2;
              const lo = Math.max(0, Math.min(tOf(mateEdge.a), tOf(mateEdge.b)));
              const hi = Math.min(1, Math.max(tOf(mateEdge.a), tOf(mateEdge.b)));
              if (hi - lo > 0.05) along = (lo + hi) / 2;
            }
            const op = {
              id: uid('opn'),
              type: 'door',
              cell: 'C',
              label: '',
              description: '',
              peer: true,
              locked: false,
              keyHint: '',
              accessCastIds: [],
              travel: true,
              along,
              width: 0.14,
            };
            br.openings = [op];
            if (back) {
              const mapped = mapAlongToPeerWorld(compass, child, br, mate, back, op);
              if (mapped && Number.isFinite(mapped.along)) {
                back.openings = back.openings || [];
                if (!back.openings.some(o => o.id === op.id)) {
                  back.openings.push({ ...op, along: mapped.along, width: mapped.width ?? op.width });
                }
              }
            }
            changed = true;
          }
          changed = true;
        } else {
          changed = true;
        }
      }
      child.links = keep;
      syncExitsFromLinks(child);
    }

    // Ensure every genuinely contacting pair has reciprocal links
    for (const pair of pairs) {
      const ensureQuiet = (fromId, wall, toId, edgeIdx) => {
        const r = rooms[fromId];
        if (!r) return;
        const w = normalizeWall(wall);
        const exists = (r.links || []).find(l =>
          l.toPlaceId === toId && (Number.isFinite(edgeIdx) ? l.edge === edgeIdx : l.wall === w));
        if (exists) {
          if (Number.isFinite(edgeIdx)) exists.edge = edgeIdx;
          exists.wall = w;
          return;
        }
        r.links = r.links || [];
        r.links.push({
          id: uid('lnk'),
          wall: w,
          edge: Number.isFinite(edgeIdx) ? edgeIdx : null,
          toPlaceId: toId,
          description: 'suite snap',
          external: false,
          sharedStyle: 'merged',
          openings: [],
        });
      };
      ensureQuiet(pair.aId, pair.wallA, pair.bId, pair.edgeA);
      ensureQuiet(pair.bId, pair.wallB, pair.aId, pair.edgeB);
    }
  }
  // Second pass: re-derive synced copies on *genuine* shared walls so the two
  // sides agree on a single physical position (older data mirrored `along`
  // naively, which drifts on offset / unequal walls). Each opening id is
  // reconciled once; the side sitting on a stretch NOT shared with this peer
  // (e.g. a door on the Bathroom portion of an Entry wall whose peer is the
  // Bedroom) is authoritative, and the stray mirror on the other side is
  // dropped rather than dragged to the wrong spot.
  const done = new Set();
  for (const unit of units) {
    const children = Object.values(rooms).filter(r => r?.parentId === unit.id);
    for (const child of children) {
      for (const link of child.links || []) {
        if (!link.toPlaceId || !Number.isFinite(Number(link.edge))) continue;
        const peer = rooms[link.toPlaceId];
        if (!peer || (peer.parentId || '') !== (child.parentId || '')) continue;
        const hit = findPeerLink(compass, child, link);
        const plink = hit?.peerLink && (peer.links || []).find(l => l.id === hit.peerLink.id);
        if (!plink) continue;
        for (const op of (link.openings || []).slice()) {
          if (!op?.id || done.has(op.id)) continue;
          done.add(op.id);
          const peerOp = (plink.openings || []).find(o => o.id === op.id);
          const ab = mapAlongToPeerWorld(compass, child, link, peer, plink, op);
          if (!peerOp) {
            if (ab && ab !== null) plink.openings.push({ ...op, along: ab.along, width: ab.width });
            continue;
          }
          const ba = mapAlongToPeerWorld(compass, peer, plink, child, link, peerOp);
          if (ab === null && ba !== null) {
            // This side is on an unshared stretch → authoritative; drop mirror.
            plink.openings = plink.openings.filter(o => o.id !== op.id);
          } else if (ba === null && ab && ab !== null) {
            // Peer side is authoritative → drop this stray copy.
            link.openings = link.openings.filter(o => o.id !== op.id);
          } else if (ab && ab !== null) {
            // Both on the shared wall → make the peer copy agree with this one.
            Object.assign(peerOp, { along: ab.along, width: ab.width });
          }
        }
      }
    }
  }
  return changed;
}

/**
 * Find the reciprocal link on a linked neighbor for a given room+link, so
 * openings (doors/windows/etc.) can be mirrored onto the shared wall from
 * both sides. Handles the common single-wall case and best-effort matches
 * multi-segment (split) shared walls by opposite-cardinal + sibling order.
 */
function findPeerLink(compass, room, link) {
  if (!link?.toPlaceId) return null;
  const peer = compass?.rooms?.[link.toPlaceId];
  if (!peer || !room) return null;
  const candidates = (peer.links || []).filter(l => l.toPlaceId === room.id);
  if (!candidates.length) return null;
  if (candidates.length === 1) return { peer, peerLink: candidates[0] };
  const opp = OPPOSITE_WALL[link.wall] || '';
  const sameWall = opp ? candidates.filter(l => l.wall === opp) : [];
  const pool = sameWall.length ? sameWall : candidates;
  if (pool.length === 1) return { peer, peerLink: pool[0] };
  const ownSiblings = (room.links || [])
    .filter(l => l.toPlaceId === link.toPlaceId && l.wall === link.wall)
    .slice()
    .sort((a, b) => Number(a.edge) - Number(b.edge));
  const ownIdx = ownSiblings.findIndex(l => l.id === link.id);
  const peerSorted = pool.slice().sort((a, b) => Number(a.edge) - Number(b.edge));
  return { peer, peerLink: peerSorted[ownIdx] ?? peerSorted[0] };
}

/** Mirror an opening onto the neighbor's reciprocal link (same id — kept in sync). */
function syncOpeningToPeer(compass, room, link, op) {
  if (!op) return;
  const hit = findPeerLink(compass, room, link);
  if (!hit?.peer || !hit?.peerLink) return;
  // Prefer true world geometry so the mirrored copy lands at the *same physical
  // point* on the shared wall regardless of the two walls' relative length or
  // offset. If the opening doesn't actually sit on the peer's wall (it's on the
  // stretch shared with a different neighbour, or the walls aren't collinear),
  // do NOT mirror it — and clear any stale copy left by earlier logic.
  const mapped = mapAlongToPeerWorld(compass, room, link, hit.peer, hit.peerLink, op);
  if (mapped === null) {
    unsyncOpeningFromPeer(compass, room, link, op.id);
    return;
  }
  let peerOp;
  if (mapped) {
    peerOp = { ...op, along: mapped.along, width: mapped.width };
  } else {
    // Geometry unavailable (non-suite rooms) — legacy opposite-cardinal mirror.
    // Directly-opposite edges are traversed in opposite directions, so copying
    // `along` as-is lands the opening at the far end; mirror (`1 - along`).
    const opposite = OPPOSITE_WALL[link.wall] || '';
    const mirrorAlong = !!opposite && hit.peerLink.wall === opposite && Number.isFinite(op.along);
    peerOp = mirrorAlong
      ? { ...op, along: Math.round((1 - op.along) * 1000) / 1000 }
      : op;
  }
  withRoomMutation(compass, hit.peer.id, 'sync opening', proom => {
    const plink = (proom.links || []).find(l => l.id === hit.peerLink.id);
    if (!plink) return;
    plink.openings = plink.openings || [];
    const existing = plink.openings.find(o => o.id === peerOp.id);
    if (existing) {
      Object.assign(existing, peerOp);
    } else {
      plink.openings.push({ ...peerOp });
    }
    syncExitsFromLinks(proom);
  });
}

/** Remove a mirrored opening (by id) from the neighbor's reciprocal link. */
function unsyncOpeningFromPeer(compass, room, link, openingId) {
  const hit = findPeerLink(compass, room, link);
  if (!hit?.peer || !hit?.peerLink) return;
  const proomLive = compass.rooms?.[hit.peer.id];
  const plink = (proomLive?.links || []).find(l => l.id === hit.peerLink.id);
  if (!plink || !(plink.openings || []).some(o => o.id === openingId)) return;
  withRoomMutation(compass, hit.peer.id, 'unsync opening', proom => {
    const l = (proom.links || []).find(l2 => l2.id === hit.peerLink.id);
    if (!l) return;
    l.openings = (l.openings || []).filter(o => o.id !== openingId);
    syncExitsFromLinks(proom);
  });
}

export function addOpening(compass, roomId, linkId, {
  type = 'door',
  cell = '',
  label = '',
  description = '',
  peer,
  travel,
  locked = false,
  keyHint = '',
  accessCastIds = [],
  along = 0.5,
  width = 0.14,
} = {}) {
  const lid = String(linkId || '').trim();
  const t = normalizeOpeningType(type);
  let cellId = '';
  if (cell) cellId = normalizeCell(cell);
  const result = withRoomMutation(compass, roomId, `opening ${t}`, room => {
    const link = (room.links || []).find(l => l.id === lid);
    if (!link) throw new Error('Link not found.');
    const defaultTravel = t !== 'window' && t !== 'hole';
    const defaultPeer = t === 'window' || t === 'hole' || t === 'arch';
    if (!cellId) {
      try { cellId = normalizeCell(cellForWallAlong(link.wall, along)); } catch { cellId = 'C'; }
    }
    const op = {
      id: uid('opn'),
      type: t,
      cell: cellId,
      label: String(label || '').trim(),
      description: String(description || '').trim(),
      peer: peer == null ? defaultPeer : !!peer,
      locked: !!locked,
      keyHint: String(keyHint || '').trim(),
      accessCastIds: normalizeTagList(accessCastIds),
      travel: travel == null ? defaultTravel : !!travel,
      along,
      width,
    };
    link.openings = link.openings || [];
    link.openings.push(op);
    syncExitsFromLinks(room);
    return op;
  });
  autoBindFixtureWall(compass, roomId, lid, along);
  const liveRoom = compass.rooms?.[roomId];
  const liveLink = (liveRoom?.links || []).find(l => l.id === lid);
  const liveOp = (liveLink?.openings || []).find(o => o.id === result?.id);
  if (liveLink?.toPlaceId && liveOp) {
    syncOpeningToPeer(compass, liveRoom, liveLink, liveOp);
  }
  return result;
}

export function updateOpening(compass, roomId, linkId, openingId, patch = {}) {
  let syncInfo = null;
  let movedAlong = null;
  let edgeIdx = null;
  const result = withRoomMutation(compass, roomId, 'update opening', room => {
    const link = (room.links || []).find(l => l.id === linkId);
    if (!link) throw new Error('Link not found.');
    const op = (link.openings || []).find(o => o.id === openingId);
    if (!op) throw new Error('Opening not found.');
    if (patch.type != null) op.type = normalizeOpeningType(patch.type);
    if (patch.cell != null) op.cell = patch.cell ? normalizeCell(patch.cell) : '';
    if (patch.label != null) op.label = String(patch.label || '').trim();
    if (patch.description != null) op.description = String(patch.description || '').trim();
    if (patch.peer != null) op.peer = !!patch.peer;
    if (patch.locked != null) op.locked = !!patch.locked;
    if (patch.keyHint != null) op.keyHint = String(patch.keyHint || '').trim();
    if (patch.accessCastIds != null) op.accessCastIds = normalizeTagList(patch.accessCastIds);
    if (patch.travel != null) op.travel = !!patch.travel;
    if (patch.along != null) {
      op.along = Number(patch.along);
      movedAlong = op.along;
      edgeIdx = link.edge;
    }
    if (patch.width != null) op.width = Number(patch.width);
    syncExitsFromLinks(room);
    if (link.toPlaceId) syncInfo = { room: { ...room }, link: { ...link }, op: { ...op } };
    return op;
  });
  // If an opening was slid along a multi-neighbor suite wall onto a different sibling's span, rebind it
  if (movedAlong != null && edgeIdx != null && edgeIdx !== '' && Number.isFinite(Number(edgeIdx))) {
    const r0 = compass.rooms?.[roomId];
    const parent = r0?.parentId ? compass.rooms?.[r0.parentId] : null;
    if (r0 && parent && isSuiteHostKind(parent.kind)) {
      const pair = sharedPairForSuiteEdge(compass, parent.id, roomId, Number(edgeIdx), movedAlong);
      const curLink = (r0.links || []).find(l => l.id === linkId);
      const curPeer = curLink?.toPlaceId ? compass.rooms?.[curLink.toPlaceId] : null;
      if (pair?.peerId && curLink && (!curPeer || curPeer.parentId === r0.parentId) && curLink.toPlaceId !== pair.peerId) {
        const dstLink = ensureEdgeLink(compass, roomId, Number(edgeIdx), movedAlong);
        if (dstLink && dstLink.id !== curLink.id) {
          unsyncOpeningFromPeer(compass, r0, curLink, openingId);
          withRoomMutation(compass, roomId, 'rebind moved opening', r => {
            const sL = (r.links || []).find(x => x.id === curLink.id);
            const dL = (r.links || []).find(x => x.id === dstLink.id);
            const movedOp = (sL?.openings || []).find(o => o.id === openingId);
            if (!sL || !dL || !movedOp) return;
            sL.openings = sL.openings.filter(o => o.id !== openingId);
            dL.openings = dL.openings || [];
            if (!dL.openings.some(o => o.id === openingId)) dL.openings.push(movedOp);
            syncExitsFromLinks(r);
          });
          const afterR = compass.rooms[roomId];
          const afterL = (afterR.links || []).find(x => x.id === dstLink.id);
          const afterOp = (afterL?.openings || []).find(o => o.id === openingId);
          if (afterL?.toPlaceId && afterOp) syncOpeningToPeer(compass, afterR, afterL, afterOp);
          return result;
        }
      }
    }
  }
  if (syncInfo) syncOpeningToPeer(compass, syncInfo.room, syncInfo.link, syncInfo.op);
  return result;
}

export function setFootprint(compass, roomId, footprint) {
  return withRoomMutation(compass, roomId, 'footprint', room => {
    room.footprint = normalizeFootprint(footprint);
  });
}

/**
 * Insert a vertex on a wall edge and remap wall links / openings so each
 * resulting segment is independently linked (split walls no longer share one link).
 */
export function insertFootprintVertex(compass, roomId, edgeIndex, t = 0.5) {
  return withRoomMutation(compass, roomId, 'split wall', room => {
    const before = normalizeFootprint(room.footprint);
    const edge = Math.max(0, Math.floor(Number(edgeIndex)));
    const splitT = Math.max(0.05, Math.min(0.95, Number(t) || 0.5));
    const oldCard = edgeCardinal(before, edge);
    const next = insertVertexOnEdge(before, edge, splitT);
    room.footprint = normalizeFootprint(next);
    remapLinksAfterEdgeSplit(room, edge, splitT, oldCard);
    return room.footprint;
  });
}

/**
 * After edge `i` is split at `t`, bump later edge indices and partition the
 * link(s) on that edge so each half can have its own neighbor / openings.
 */
function remapLinksAfterEdgeSplit(room, edgeIndex, splitT, oldCardinal = '') {
  const i = Math.max(0, Math.floor(Number(edgeIndex)));
  const t = Math.max(0.05, Math.min(0.95, Number(splitT) || 0.5));
  const links = Array.isArray(room.links) ? [...room.links] : [];
  const fp = room.footprint;

  // Pin legacy cardinal-only links that matched this wall onto the first half.
  if (oldCardinal && oldCardinal !== 'above' && oldCardinal !== 'below') {
    for (const link of links) {
      if (link.edge != null && link.edge !== '') continue;
      if (link.wall !== oldCardinal) continue;
      link.edge = i;
    }
  }

  // Shift edges after the split point.
  for (const link of links) {
    if (link.edge == null || link.edge === '') continue;
    const e = Number(link.edge);
    if (!Number.isFinite(e)) continue;
    if (e > i) link.edge = e + 1;
  }

  const onEdge = links.filter(l => l.edge != null && l.edge !== '' && Number(l.edge) === i);
  const extras = [];
  for (const link of onEdge) {
    const openings = Array.isArray(link.openings) ? link.openings : [];
    const left = [];
    const right = [];
    for (const op of openings) {
      const along = Number(op.along);
      const mid = Number.isFinite(along) ? along : 0.5;
      if (mid < t) {
        op.along = Math.max(0.05, Math.min(0.95, mid / t));
        left.push(op);
      } else {
        op.along = Math.max(0.05, Math.min(0.95, (mid - t) / (1 - t)));
        right.push(op);
      }
    }
    link.openings = left;
    // Refresh cardinal from geometry for the first half.
    try { link.wall = edgeCardinal(fp, i) || link.wall; } catch { /* keep */ }

    // Always clone a sibling link for the second half — even a blank/unlinked
    // wall — so the Wall links list shows both segments separately after a split.
    const clone = {
      id: uid('lnk'),
      wall: '',
      edge: i + 1,
      toPlaceId: link.toPlaceId || '',
      description: link.description || '',
      external: !!link.external,
      sharedStyle: link.sharedStyle === 'threshold' || link.sharedStyle === 'open'
        ? link.sharedStyle
        : 'merged',
      openings: right,
    };
    try { clone.wall = edgeCardinal(fp, i + 1) || link.wall; } catch { clone.wall = link.wall; }
    extras.push(clone);
  }

  // If the split wall had no link at all (fully unlinked), still stub a blank
  // link on the new second segment so both halves are independently selectable
  // in the Wall links panel right after the split.
  if (!onEdge.length) {
    let card2 = '';
    try { card2 = edgeCardinal(fp, i + 1); } catch { card2 = ''; }
    extras.push({
      id: uid('lnk'),
      wall: card2 || oldCardinal || '',
      edge: i + 1,
      toPlaceId: '',
      description: '',
      external: false,
      sharedStyle: 'merged',
      openings: [],
    });
  }

  room.links = links.concat(extras);
  for (const link of room.links) {
    if (link.edge == null || link.edge === '') continue;
    try {
      const card = edgeCardinal(fp, Number(link.edge));
      if (card) link.wall = card;
    } catch { /* keep */ }
  }
}

/** After dropping vertex `i`, merge the two halves of that wall back into one edge. */
function remapLinksAfterVertexRemoved(room, dropIndex, oldN) {
  const n = Math.max(3, Math.floor(Number(oldN)) || 0);
  const i = ((Math.floor(Number(dropIndex)) % n) + n) % n;
  const mapEdge = (e) => {
    if (e === i) {
      const prev = (i + n - 1) % n;
      return prev > i ? prev - 1 : prev;
    }
    if (e > i) return e - 1;
    return e;
  };
  const links = Array.isArray(room.links) ? room.links : [];
  for (const link of links) {
    if (link.edge == null || link.edge === '') continue;
    const e = Number(link.edge);
    if (!Number.isFinite(e)) continue;
    link.edge = mapEdge(e);
  }
  const kept = [];
  const byKey = new Map();
  for (const link of links) {
    if (link.edge == null || link.edge === '') {
      kept.push(link);
      continue;
    }
    const key = `${link.edge}|${link.toPlaceId || ''}|${link.external ? 'x' : ''}`;
    if (byKey.has(key)) {
      const a = byKey.get(key);
      const oa = Array.isArray(a.openings) ? a.openings : [];
      const ob = Array.isArray(link.openings) ? link.openings : [];
      a.openings = oa.concat(ob);
      if (!a.toPlaceId && link.toPlaceId) a.toPlaceId = link.toPlaceId;
      if (link.sharedStyle === 'threshold' || link.sharedStyle === 'open') a.sharedStyle = link.sharedStyle;
      if (link.description && !a.description) a.description = link.description;
    } else {
      byKey.set(key, link);
      kept.push(link);
    }
  }
  room.links = kept;
  const fp = room.footprint;
  for (const link of room.links) {
    if (link.edge == null || link.edge === '') continue;
    try {
      const card = edgeCardinal(fp, Number(link.edge));
      if (card) link.wall = card;
    } catch { /* keep */ }
  }
}

function turningArea(verts, index) {
  const n = verts.length;
  const i = ((index % n) + n) % n;
  const a = verts[(i + n - 1) % n];
  const b = verts[i];
  const c = verts[(i + 1) % n];
  return Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
}

/**
 * Inverse of Split at corners on one selected segment: drop a leftover
 * collinear T-junction vertex, or a tiny stub edge.
 */
export function joinCollinearSuiteVertex(compass, roomId, edgeIndex) {
  const pid = String(roomId || '').trim();
  const room0 = compass.rooms?.[pid];
  if (!room0) throw new Error('Pick a wall segment first.');
  const fp = normalizeFootprint(room0.footprint);
  const n = fp.vertices.length;
  if (n <= 3) throw new Error('This room already has as few corners as it can.');
  const i = ((Math.floor(Number(edgeIndex)) % n) + n) % n;
  const j = (i + 1) % n;
  let drop = -1;
  if (isCollinearVertex(fp.vertices, i)) drop = i;
  else if (isCollinearVertex(fp.vertices, j)) drop = j;
  else {
    const a = fp.vertices[i];
    const b = fp.vertices[j];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 0.03) drop = turningArea(fp.vertices, i) <= turningArea(fp.vertices, j) ? i : j;
  }
  if (drop < 0) {
    throw new Error('That segment is a real corner. Use Undo to reverse a threshold or split, or Clean vertices to drop leftover T-junctions.');
  }
  pushSuiteHistory(compass, pid, 'join segment');
  return withRoomMutation(compass, pid, 'join segment', room => {
    const before = normalizeFootprint(room.footprint);
    const oldN = before.vertices.length;
    room.footprint = normalizeFootprint(removeVertexAt(before, drop));
    remapLinksAfterVertexRemoved(room, drop, oldN);
    return room.footprint;
  });
}

/**
 * Drop every leftover collinear / stub vertex on a room (split-at-corners debris).
 */
export function simplifySuiteRoomFootprint(compass, roomId) {
  const pid = String(roomId || '').trim();
  const room0 = compass.rooms?.[pid];
  if (!room0) throw new Error('Pick a room first.');
  const verts0 = normalizeFootprint(room0.footprint).vertices;
  const removable = verts0.some((_, i) => isCollinearVertex(verts0, i));
  if (!removable) {
    throw new Error('No leftover split vertices on this room — use Undo if the shape itself is wrong.');
  }
  pushSuiteHistory(compass, pid, 'clean vertices');
  return withRoomMutation(compass, pid, 'clean vertices', room => {
    let fp = normalizeFootprint(room.footprint);
    let guard = 0;
    while (fp.vertices.length > 3 && guard++ < 48) {
      let drop = -1;
      for (let i = 0; i < fp.vertices.length; i++) {
        if (isCollinearVertex(fp.vertices, i)) { drop = i; break; }
      }
      if (drop < 0) break;
      const oldN = fp.vertices.length;
      fp = removeVertexAt(fp, drop);
      room.footprint = normalizeFootprint(fp);
      remapLinksAfterVertexRemoved(room, drop, oldN);
      fp = normalizeFootprint(room.footprint);
    }
    return room.footprint;
  });
}

/**
 * Split a room into two sibling rooms under the same parent by cutting a
 * straight new wall between two points on the (possibly different) walls.
 * The original room id/name/description/cells/occupants stay on the "A"
 * side (the half containing the footprint's original first vertex); a
 * brand-new empty room is created for the "B" side. Existing wall links on
 * either side of the cut are redistributed to whichever half kept that
 * wall; the new shared wall between A and B is linked automatically.
 * Real-world size for both halves is an approximation — use the Grid /
 * scale controls afterward to fine-tune.
 * @param {number} edgeA footprint edge index for the first cut point
 * @param {number} tA 0–1 position along edgeA
 * @param {number} edgeB footprint edge index for the second cut point
 * @param {number} tB 0–1 position along edgeB
 */
export function divideRoom(compass, roomId, edgeA, tA, edgeB, tB, { newId, newName } = {}) {
  const room0 = compass.rooms?.[roomId];
  if (!room0) throw new Error(`Place "${roomId}" not found.`);
  if (!isLoadableKind(room0.kind)) throw new Error('Only rooms / transitional spaces can be divided.');
  const eA = Math.max(0, Math.floor(Number(edgeA)));
  const eB = Math.max(0, Math.floor(Number(edgeB)));
  if (eA === eB) throw new Error('Pick two different walls to divide the room.');
  const clampT = (t) => Math.max(0.08, Math.min(0.92, Number(t) || 0.5));
  const uA = clampT(tA);
  const uB = clampT(tB);
  const n0 = normalizeFootprint(room0.footprint).vertices.length;
  if (n0 < 3) throw new Error('Room has no valid shape to divide.');
  if (room0.parentId) pushSuiteHistory(compass, room0.parentId, `divide ${room0.name || roomId}`);

  // Insert the higher edge index first so the lower one's target index is
  // untouched by the first split (same ordering `remapLinksAfterEdgeSplit`
  // relies on for a single split).
  if (eA > eB) {
    insertFootprintVertex(compass, roomId, eA, uA);
    insertFootprintVertex(compass, roomId, eB, uB);
  } else {
    insertFootprintVertex(compass, roomId, eB, uB);
    insertFootprintVertex(compass, roomId, eA, uA);
  }

  const room = compass.rooms[roomId];
  const fp = normalizeFootprint(room.footprint);
  const n = fp.vertices.length;
  const loEdge = Math.min(eA, eB);
  const hiEdge = Math.max(eA, eB);
  const loIdx = loEdge + 1;
  const hiIdx = hiEdge + 2;
  const iaIdx = eA < eB ? loIdx : hiIdx;
  const ibIdx = eA < eB ? hiIdx : loIdx;

  const chainFrom = (from, to) => {
    const out = [];
    let k = from;
    for (let guard = 0; guard <= n + 1; guard++) {
      out.push(k);
      if (k === to) break;
      k = (k + 1) % n;
    }
    return out;
  };
  const chainA = chainFrom(iaIdx, ibIdx);
  const chainB = chainFrom(ibIdx, iaIdx);
  if (chainA.length < 3 || chainB.length < 3) {
    throw new Error('Those two walls are too close together to form two rooms.');
  }
  const edgeOwnerA = new Set(chainA.slice(0, -1));
  const edgeOwnerB = new Set(chainB.slice(0, -1));

  const renormalize = (idxList) => {
    const verts = idxList.map(i => ({ ...fp.vertices[i] }));
    let minX = 1; let maxX = 0; let minY = 1; let maxY = 0;
    for (const v of verts) {
      minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
      minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
    }
    const w = Math.max(1e-6, maxX - minX);
    const h = Math.max(1e-6, maxY - minY);
    return {
      verts: verts.map(v => ({ x: (v.x - minX) / w, y: (v.y - minY) / h })),
      extent: Math.max(w, h),
    };
  };
  const rA = renormalize(chainA);
  const rB = renormalize(chainB);
  const fpA = normalizeFootprint({
    vertices: rA.verts,
    grid: fp.grid,
    unitPerGrid: Math.max(0.25, fp.unitPerGrid * rA.extent),
    unitLabel: fp.unitLabel,
  });
  const fpB = normalizeFootprint({
    vertices: rB.verts,
    grid: fp.grid,
    unitPerGrid: Math.max(0.25, fp.unitPerGrid * rB.extent),
    unitLabel: fp.unitLabel,
  });

  const origLinks = Array.isArray(room.links) ? room.links.map(l => ({ ...l, openings: (l.openings || []).map(o => ({ ...o })) })) : [];
  const linksA = [];
  const linksB = [];
  for (const link of origLinks) {
    if (link.edge == null || link.edge === '') { linksA.push(link); continue; }
    const e = Number(link.edge);
    if (edgeOwnerA.has(e)) {
      linksA.push({ ...link, edge: (e - iaIdx + n) % n });
    } else if (edgeOwnerB.has(e)) {
      linksB.push({ ...link, edge: (e - ibIdx + n) % n });
    }
  }
  for (const link of linksA) {
    if (link.edge == null) continue;
    try { link.wall = edgeCardinal(fpA, link.edge) || link.wall; } catch { /* keep */ }
  }
  for (const link of linksB) {
    if (link.edge == null) continue;
    try { link.wall = edgeCardinal(fpB, link.edge) || link.wall; } catch { /* keep */ }
  }

  let bid = String(newId || '').trim() || slugifyId(`${room.name || roomId}_2`);
  if (compass.rooms[bid] || bid === roomId) {
    let i = 2;
    const base = bid;
    while (compass.rooms[`${base}_${i}`]) i += 1;
    bid = `${base}_${i}`;
  }
  const bname = String(newName || '').trim() || `${room.name || 'Room'} (2)`;

  const cutEdgeA = chainA.length - 1;
  const cutEdgeB = chainB.length - 1;
  let cutWallA = '';
  let cutWallB = '';
  try { cutWallA = edgeCardinal(fpA, cutEdgeA) || ''; } catch { /* keep */ }
  try { cutWallB = edgeCardinal(fpB, cutEdgeB) || ''; } catch { /* keep */ }
  linksA.push({
    id: uid('lnk'), wall: cutWallA, edge: cutEdgeA, toPlaceId: bid,
    description: 'divided wall', external: false, sharedStyle: 'merged', openings: [],
  });
  linksB.push({
    id: uid('lnk'), wall: cutWallB, edge: cutEdgeB, toPlaceId: roomId,
    description: 'divided wall', external: false, sharedStyle: 'merged', openings: [],
  });

  withRoomMutation(compass, roomId, 'divide room', r => {
    r.footprint = fpA;
    r.links = linksA;
  });

  const roomB = createRoom({
    id: bid,
    name: bname,
    kind: room.kind,
    parentId: room.parentId,
    locationTags: room.locationTags,
    footprint: fpB,
  });
  roomB.links = linksB;
  compass.rooms[bid] = normalizeRoom(roomB);

  if (room.parentId && isSuiteHostKind(compass.rooms[room.parentId]?.kind)) {
    try { ensureSuiteLayout(compass, room.parentId); } catch { /* ignore */ }
  }

  return { roomA: compass.rooms[roomId], roomB: compass.rooms[bid] };
}

export function addInternalWall(compass, roomId, wall) {
  return withRoomMutation(compass, roomId, 'add internal wall', room => {
    const next = normalizeInternalWall(wall, room.footprint);
    if (!next) throw new Error('Wall is too short — drag further on the grid.');
    room.internalWalls = Array.isArray(room.internalWalls) ? room.internalWalls : [];
    room.internalWalls.push(next);
    return next;
  });
}

export function removeInternalWall(compass, roomId, wallId) {
  return withRoomMutation(compass, roomId, 'remove internal wall', room => {
    const id = String(wallId || '').trim();
    const i = (room.internalWalls || []).findIndex(w => w.id === id);
    if (i < 0) throw new Error('Internal wall not found.');
    const [gone] = room.internalWalls.splice(i, 1);
    return gone;
  });
}

export function setPlaceDescription(compass, placeId, description) {
  return withRoomMutation(compass, placeId, 'description', room => {
    room.description = String(description || '').trim();
  });
}

export function removeOpening(compass, roomId, linkId, openingId) {
  let syncInfo = null;
  const result = withRoomMutation(compass, roomId, 'remove opening', room => {
    const link = (room.links || []).find(l => l.id === linkId);
    if (!link) throw new Error('Link not found.');
    const i = (link.openings || []).findIndex(o => o.id === openingId);
    if (i < 0) throw new Error('Opening not found.');
    link.openings.splice(i, 1);
    if (link.toPlaceId) syncInfo = { room: { ...room }, link: { ...link } };
  });
  if (syncInfo) unsyncOpeningFromPeer(compass, syncInfo.room, syncInfo.link, openingId);
  return result;
}

/**
 * Gather what can be seen through peer openings into neighboring places.
 * Locked openings still peer if see-through; travel is blocked when locked.
 */
export function gatherPeerViews(compass, room) {
  if (!room || !compass) return [];
  const peeks = [];
  for (const link of room.links || []) {
    const peerOps = (link.openings || []).filter(o => o.peer);
    if (!peerOps.length) continue;
    const neighbor = compass.rooms?.[link.toPlaceId];
    if (!neighbor || !isCompassPlaceKind(neighbor.kind)) {
      peeks.push({
        wall: link.wall,
        toPlaceId: link.toPlaceId,
        toName: neighbor?.name || link.toPlaceId || '?',
        openings: peerOps,
        visible: false,
        reason: neighbor ? 'neighbor has no compass grid' : 'neighbor missing',
        items: [],
        occupants: [],
      });
      continue;
    }
    const viaExterior = !!link.external || isExteriorHostKind(neighbor.kind);
    const face = viaExterior ? (link.wall || 'N') : (OPPOSITE_WALL[link.wall] || link.wall);
    const edge = WALL_EDGE_CELLS[face] || ['C'];
    const items = [];
    const occupants = [];
    for (const cellId of edge) {
      for (const it of listCellPieces(neighbor.cells?.[cellId], { room: neighbor, cellId })) {
        items.push({
          name: it.name,
          state: it.description || it.state || '',
          layer: it.layer,
          cell: cellId,
          via: peerOps.map(o => o.type).join('/'),
        });
      }
      for (const o of (neighbor.occupants || []).filter(occ => occ.cell === cellId)) {
        occupants.push({
          name: o.name,
          cell: o.cell,
          via: peerOps.map(x => x.type).join('/'),
        });
      }
    }
    peeks.push({
      wall: link.wall,
      toPlaceId: neighbor.id,
      toName: neighbor.name,
      openings: peerOps,
      oppositeWall: face,
      visible: true,
      items,
      occupants,
      travel: peerOps.some(o => o.travel && !o.locked),
      locked: peerOps.some(o => o.locked),
    });
  }
  return peeks;
}

/** List travel openings for injection (locked / key hints). */
export function listOpeningsSummary(room) {
  const rows = [];
  for (const link of room?.links || []) {
    for (const op of link.openings || []) {
      rows.push({
        ...op,
        wall: link.wall,
        toPlaceId: link.toPlaceId || (link.external ? 'outside' : ''),
        external: !!link.external,
      });
    }
  }
  return rows;
}

function placeKeyringNames(place) {
  return new Set(
    [place?.name, ...(place?.aliases || [])]
      .map(t => String(t || '').trim().toLowerCase())
      .filter(Boolean),
  );
}

function isDescendantOf(compass, place, ancestorId) {
  const want = String(ancestorId || '').trim();
  if (!want || !place) return false;
  let cur = place;
  const seen = new Set();
  while (cur && !seen.has(cur.id)) {
    if (cur.id === want) return true;
    seen.add(cur.id);
    cur = compass?.rooms?.[cur.parentId];
  }
  return false;
}

/** Building/unit name = that place and nested rooms. Room name = that room only. */
export function keyringUnlocksPlace(keyringTags, destPlace, compass) {
  const keys = normalizeTagList(keyringTags).map(t => t.toLowerCase());
  if (!keys.length || !destPlace) return false;
  const rooms = Object.values(compass?.rooms || {});
  for (const place of rooms) {
    if (place.kind !== 'building' && place.kind !== 'unit' && place.kind !== 'room') continue;
    const names = placeKeyringNames(place);
    if (!keys.some(k => names.has(k))) continue;
    if (place.id === destPlace.id) return true;
    if ((place.kind === 'building' || place.kind === 'unit')
      && isDescendantOf(compass, destPlace, place.id)) return true;
  }
  return false;
}

export function canPassOpening(op, {
  castId = '',
  hasKey = false,
  keyringTags = [],
  destPlace = null,
  compass = null,
} = {}) {
  if (!op?.locked) return true;
  if (hasKey) return true;
  const cid = String(castId || '').trim();
  if (cid && (op.accessCastIds || []).some(id => String(id) === cid)) return true;
  if (keyringUnlocksPlace(keyringTags, destPlace, compass)) return true;
  return false;
}

export function openingLockTitle(op, { castMembers = [], keyHolders = [] } = {}) {
  if (!op?.locked) return '';
  const names = (op.accessCastIds || [])
    .map(id => (castMembers || []).find(c => String(c.id) === String(id))?.name)
    .filter(Boolean);
  const bits = [];
  if (names.length) bits.push(`access: ${names.join(', ')}`);
  if (keyHolders.length) bits.push(`keys: ${keyHolders.join(', ')}`);
  if (op.keyHint) bits.push(`usable: ${op.keyHint}`);
  return bits.join(' · ') || 'locked';
}

export function smokeAutoBindFixtureWallPure() {
  try {
    const compass = defaultCompassState();
    compass.rooms.house = normalizeRoom(createRoom({ id: 'house', name: 'House', kind: 'building' }));
    compass.rooms.hall = normalizeRoom(createRoom({ id: 'hall', name: 'Hall', kind: 'room', parentId: 'house' }));
    compass.rooms.bath = normalizeRoom(createRoom({ id: 'bath', name: 'Bath', kind: 'room', parentId: 'house' }));
    const span = 16;
    compass.rooms.house.suiteLayout = {
      hall: { x: 0, y: 0, rot: 0 },
      bath: { x: span, y: 0, rot: 0 },
    };
    const shared = ensureEdgeLink(compass, 'hall', 1);
    const door = addOpening(compass, 'hall', shared.id, { type: 'door', along: 0.5 });
    const hallShared = (compass.rooms.hall.links || []).find(l => l.id === shared.id);
    if (hallShared?.toPlaceId !== 'bath') return `shared dest ${hallShared?.toPlaceId || '(none)'}`;
    if (hallShared.external) return 'shared should not stay external';
    const bathOp = (compass.rooms.bath.links || []).flatMap(l => l.openings || []).find(o => o.id === door.id);
    if (!bathOp) return 'shared peer opening missing';
    const ext = ensureEdgeLink(compass, 'hall', 0);
    addLink(compass, 'hall', { edge: 0, external: true });
    const window = addOpening(compass, 'hall', ext.id, { type: 'window', along: 0.5 });
    const hallExt = (compass.rooms.hall.links || []).find(l => l.id === ext.id);
    if (hallExt?.toPlaceId !== 'house') return `exterior dest ${hallExt?.toPlaceId || '(none)'}`;
    if (!hallExt.external) return 'exterior flag dropped';
    const houseOp = (compass.rooms.house.links || []).flatMap(l => l.openings || []).find(o => o.id === window.id);
    if (!houseOp) return 'exterior peer opening missing';
    const houseLink = (compass.rooms.house.links || []).find(l => l.toPlaceId === 'hall' && l.wall === 'N');
    if (!houseLink) return 'exterior reciprocal missing';
    return '';
  } catch (err) {
    return err?.message || String(err);
  }
}

export function smokeOpeningAccessPure() {
  try {
    const dest = { id: 'apt', name: "Weslie's Duplex", kind: 'building', locationTags: ["Weslie's Duplex"] };
    const room = { id: 'br', name: 'Bedroom', kind: 'room', parentId: 'apt', locationTags: ['Bedroom'] };
    const bath = { id: 'ba', name: 'Bath', kind: 'room', parentId: 'apt', locationTags: ['Bath'] };
    const shop = { id: 'shop', name: 'Shop', kind: 'building', locationTags: ['Shop'] };
    const compass = { rooms: { apt: dest, br: room, ba: bath, shop } };
    const op = { locked: true, accessCastIds: ['wes'], keyHint: '' };
    if (!canPassOpening(op, { castId: 'wes' })) return 'access list miss';
    if (canPassOpening(op, { castId: 'other' })) return 'stranger passed';
    if (!keyringUnlocksPlace(["Weslie's Duplex"], room, compass)) return 'building keyring miss';
    if (keyringUnlocksPlace(["Weslie's Duplex"], shop, compass)) return 'building keyring leaked';
    if (!keyringUnlocksPlace(['Bedroom'], room, compass)) return 'room keyring miss';
    if (keyringUnlocksPlace(['Bedroom'], bath, compass)) return 'room keyring sibling';
    dest.locationTags = ["Weslie's Duplex", 'Fukuoka', 'Japan'];
    if (keyringUnlocksPlace(['Japan'], room, compass)) return 'geo tag must not unlock';
    if (keyringUnlocksPlace(['Fukuoka'], dest, compass)) return 'city tag must not unlock';
    const unit = { id: 'u1', name: 'Upper Unit', kind: 'unit', parentId: 'apt' };
    const kit = { id: 'kit', name: 'Kitchen', kind: 'room', parentId: 'u1' };
    compass.rooms.u1 = unit;
    compass.rooms.kit = kit;
    if (!keyringUnlocksPlace(['Upper Unit'], kit, compass)) return 'unit keyring miss';
    if (keyringUnlocksPlace(['Upper Unit'], room, compass)) return 'unit keyring leaked';
    if (canPassOpening({ locked: false, accessCastIds: [] }, { castId: 'other' }) !== true) return 'unlocked blocked';
    return '';
  } catch (err) {
    return err?.message || String(err);
  }
}

/** Remove an occupant (by castId or case-insensitive name) from every room except `keepRoomId`. */
export function evictOccupantFromOtherRooms(compass, keepRoomId = '', { name = '', castId = '' } = {}) {
  if (!compass?.rooms || typeof compass.rooms !== 'object') return 0;
  const nlow = String(name || '').trim().toLowerCase();
  const cid = String(castId || '').trim();
  if (!nlow && !cid) return 0;
  const keep = String(keepRoomId || '').trim();
  let removed = 0;
  for (const [rid, room] of Object.entries(compass.rooms)) {
    if (!room || rid === keep || !Array.isArray(room.occupants) || !room.occupants.length) continue;
    const before = room.occupants.length;
    room.occupants = room.occupants.filter((o) => {
      if (cid && o?.castId && String(o.castId) === cid) return false;
      if (nlow && String(o?.name || '').trim().toLowerCase() === nlow) return false;
      return true;
    });
    if (room.occupants.length !== before) {
      removed += before - room.occupants.length;
    }
  }
  return removed;
}

/** Remove an occupant from every room in `compass.rooms`. */
export function removeOccupantEverywhere(compass, { name = '', castId = '' } = {}) {
  return evictOccupantFromOtherRooms(compass, '', { name, castId });
}

export function addOccupant(compass, roomId, { name, cell = 'C', facing = 'N', castId = '', description = '' } = {}) {
  const nm = String(name || '').trim();
  if (!nm) throw new Error('Occupant name is required.');
  const cellId = normalizeCell(cell);
  const face = normalizeFacing(facing || 'N');
  const cid = String(castId || '').trim();
  const desc = String(description || '').trim();
  evictOccupantFromOtherRooms(compass, roomId, { name: nm, castId: cid });
  return withRoomMutation(compass, roomId, `occ add ${nm}`, room => {
    const existing = room.occupants.find(o =>
      (cid && o.castId && String(o.castId) === cid)
      || o.name.toLowerCase() === nm.toLowerCase());
    if (existing) {
      existing.cell = cellId;
      existing.facing = face;
      if (cid) existing.castId = cid;
      if (desc) existing.description = desc;
      return existing;
    }
    const occ = { name: nm, cell: cellId, facing: face, castId: cid, description: desc };
    room.occupants.push(occ);
    return occ;
  });
}

export function moveOccupant(compass, roomId, { name, cell } = {}) {
  const nm = String(name || '').trim();
  const cellId = normalizeCell(cell);
  return withRoomMutation(compass, roomId, `occ move ${nm}`, room => {
    const occ = room.occupants.find(o => o.name.toLowerCase() === nm.toLowerCase());
    if (!occ) throw new Error(`Occupant "${nm}" not in room.`);
    occ.cell = cellId;
    return occ;
  });
}

export function faceOccupant(compass, roomId, { name, facing } = {}) {
  const nm = String(name || '').trim();
  const face = normalizeFacing(facing);
  return withRoomMutation(compass, roomId, `occ face ${nm} ${face}`, room => {
    const occ = room.occupants.find(o => o.name.toLowerCase() === nm.toLowerCase());
    if (!occ) throw new Error(`Occupant "${nm}" not in room.`);
    occ.facing = face;
    return occ;
  });
}

export function removeOccupant(compass, roomId, { name } = {}) {
  const nm = String(name || '').trim();
  return withRoomMutation(compass, roomId, `occ remove ${nm}`, room => {
    const i = room.occupants.findIndex(o => o.name.toLowerCase() === nm.toLowerCase());
    if (i < 0) throw new Error(`Occupant "${nm}" not in room.`);
    room.occupants.splice(i, 1);
  });
}

/**
 * Undo last mutation on the active (or given) room by restoring snapshot.
 */
export function undoLastChange(compass, roomId = '') {
  const id = String(roomId || compass.activeRoomId || '').trim();
  const room = compass.rooms?.[id];
  if (!room) throw new Error('No place to undo.');
  const stack = room.recent_changes || [];
  if (!stack.length) throw new Error('Nothing to undo.');
  const last = stack.pop();
  if (!last?.snapshot) throw new Error('Undo snapshot missing.');
  const restored = normalizeRoom({ ...last.snapshot, id: room.id });
  restored.recent_changes = stack;
  compass.rooms[id] = restored;
  if (compass.activeRoomId === id && !isCompassPlaceKind(restored.kind)) {
    compass.activeRoomId = '';
  }
  return { summary: last.summary, room: restored };
}

/** Lightweight occupancy load (no DOM). Returns '' on success. */
export function smokeSyncOccupancyRoomPure() {
  try {
    const compass = defaultCompassState();
    compass.rooms.apt = normalizeRoom(createRoom({ id: 'apt', name: 'apartment', kind: 'room' }));
    compass.rooms.lobby = normalizeRoom(createRoom({ id: 'lobby', name: 'lobby', kind: 'room' }));
    loadRoom(compass, 'lobby');
    const moving = syncOccupancyRoom(compass, {
      mode: 'moving', fromKey: 'Kanzaki', destKey: 'train', placeKey: 'apartment', placeId: 'apt',
    });
    if (moving.loaded || compass.activeRoomId !== 'lobby') return 'moving should not load occupancy room';
    const here = syncOccupancyRoom(compass, { mode: 'compass', placeKey: 'apartment', placeId: 'apt' });
    if (!here.loaded || compass.activeRoomId !== 'apt') return 'compass commit should loadRoom';
    if (compass.sonar?.lastPlaceId !== 'apt' || compass.sonar?.lastKey !== 'apartment') {
      return 'compass commit should stamp sonar here';
    }
    const byName = defaultCompassState();
    byName.rooms.apt = normalizeRoom(createRoom({ id: 'apt', name: 'apartment', kind: 'room' }));
    const named = syncOccupancyRoom(byName, { mode: 'compass', placeKey: 'apartment' });
    if (!named.loaded || byName.activeRoomId !== 'apt') return 'placeKey should resolve placeId';
    return '';
  } catch (err) {
    return err?.message || String(err);
  }
}

/** Lightweight invariant checks (no DOM). Returns '' on success. */
export function smokeSuiteWallRestorePure() {
  try {
    const compass = defaultCompassState();
    compass.rooms.apt = normalizeRoom(createRoom({ id: 'apt', name: 'Apt', kind: 'unit' }));
    compass.rooms.hall = normalizeRoom(createRoom({ id: 'hall', name: 'Hall', kind: 'room', parentId: 'apt' }));
    compass.rooms.bath = normalizeRoom(createRoom({ id: 'bath', name: 'Bath', kind: 'room', parentId: 'apt' }));
    setSharedWallStyle(compass, 'hall', 'bath', 'E', 'W', 'threshold');
    const marked = (compass.rooms.hall.links || []).some(l => l.toPlaceId === 'bath' && l.sharedStyle === 'threshold');
    if (!marked) return 'threshold should mark the shared wall';
    if (suiteHistoryPeek(compass, 'apt').count < 1) return 'threshold should record suite history';
    undoSuiteLastChange(compass, 'apt');
    const undone = (compass.rooms.hall.links || []).some(l => l.toPlaceId === 'bath' && l.sharedStyle === 'threshold');
    if (undone) return 'undo should restore the wall before the threshold';
    const n0 = compass.rooms.hall.footprint.vertices.length;
    insertFootprintVertex(compass, 'hall', 0, 0.5);
    if (compass.rooms.hall.footprint.vertices.length !== n0 + 1) return 'split should add a vertex';
    joinCollinearSuiteVertex(compass, 'hall', 0);
    if (compass.rooms.hall.footprint.vertices.length !== n0) return 'join should drop the leftover vertex';
    setSharedWallStyle(compass, 'hall', 'bath', 'E', 'W', 'threshold');
    restoreSuiteWall(compass, { aId: 'hall', bId: 'bath', wallA: 'E', wallB: 'W' });
    const restored = (compass.rooms.hall.links || []).find(l => l.toPlaceId === 'bath');
    if (restored?.sharedStyle === 'threshold' || restored?.sharedStyle === 'open') {
      return 'restore wall should make the shared wall solid';
    }
    return '';
  } catch (err) {
    return err?.message || String(err);
  }
}

/**
 * Add a picked-up compass item into Showtime Inventory (mobile / on person).
 */
export function addPickupToInventory(storage, item, bus = null) {
  if (!storage || !item?.name) return null;
  const inv = storage.getChat('inventory', { static: [], mobile: [], currency: {}, openBoxes: [] });
  inv.mobile = Array.isArray(inv.mobile) ? inv.mobile : [];
  const row = {
    id: uid('inv'),
    kind: item.kind === 'container' ? 'container' : 'item',
    name: String(item.name).trim(),
    description: String(item.description || item.state || '').trim(),
    parentId: null,
    location: 'mobile',
    condition: item.condition || 'fine',
    category: item.category || 'misc',
  };
  inv.mobile.push(row);
  storage.saveChat();
  try { bus?.emit?.('inventory.updated', { item: row, source: 'compass' }); } catch { /* ignore */ }
  try { bus?.emit?.('showtime.stateChanged'); } catch { /* ignore */ }
  return row;
}

/**
 * Collect active Location facet strings from Composer scene keys + Script cards.
 */
export function collectActiveLocationTags(storage) {
  if (!storage) return [];
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
  try {
    // Composer UI writes sceneFacets to the global store; Backstage soft-sync
    // also mirrors into chat — union both like worldIndex.mergeComposerFacets.
    const fromChat = storage.getChat('composer', {})?.sceneFacets?.location;
    if (Array.isArray(fromChat)) fromChat.forEach(push);
  } catch { /* ignore */ }
  try {
    const fromGlobal = storage.getGlobal('composer', {})?.sceneFacets?.location;
    if (Array.isArray(fromGlobal)) fromGlobal.forEach(push);
  } catch { /* ignore */ }
  try {
    const script = storage.getChat('script', {});
    const cards = Array.isArray(script?.cards) ? script.cards : [];
    for (const card of cards) {
      if (card?.active === false) continue;
      const locs = card?.keywordFacets?.location;
      if (Array.isArray(locs)) locs.forEach(push);
    }
  } catch { /* ignore */ }
  try {
    const backstage = storage.getChat('backstage', {});
    const rooms = backstage?.stage?.rooms || backstage?.rooms || {};
    for (const place of Object.values(rooms)) {
      for (const tag of place?.locationTags || []) push(tag);
      for (const tag of place?.aliases || []) push(tag);
      if (GEO_PLACE_KIND_SET.has(place?.kind) && place?.name) push(place.name);
    }
    for (const bg of backstage?.visuals?.backgrounds || []) {
      for (const tag of bg?.locationTags || []) push(tag);
    }
    for (const u of backstage?.stage?.sonar?.unlisted || []) {
      if (u?.name) push(u.name);
    }
    for (const s of backstage?.stage?.sonar?.unlistedSkip || []) push(s);
  } catch { /* ignore */ }
  try {
    const cat = ensureLocationCatalog(storage);
    for (const n of Object.values(cat?.nodes || {})) {
      if (n?.name) push(n.name);
    }
  } catch { /* ignore */ }
  return out;
}
