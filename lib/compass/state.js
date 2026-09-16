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
  GEO_PLACE_KIND_SET,
  buildPlaceTree,
  placeMatchesLocationTags,
  slugifyId,
  OPPOSITE_WALL,
  CARDINAL_TO_EDGE,
  EDGE_TO_CARDINAL,
  WALL_EDGE_CELLS,
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
  listSuiteChildren,
  snapChildAmongSiblings,
  SUITE_SNAP_TOL,
  alignSuiteContactGeometry,
  worldPolygon,
  edgesFacingCardinal,
} from './suiteLayout.js';
import { edgeCardinal, insertVertexOnEdge } from './floorplan.js';
import {
  inheritGeographicTags,
  refreshPlaceLocationTags,
  refreshDescendantLocationTags,
  ensureLocationCatalog,
  ingestLocationNames,
} from '../locationCatalog.js';

const MAX_CHANGES = 20;

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
  const migrated = normalizeCompassState(raw);
  if (migrated._migrationNote) {
    delete migrated._migrationNote;
  }
  // Defensive: drop undo stacks that somehow stayed nested/huge
  for (const room of Object.values(migrated.rooms || {})) {
    const stack = room.recent_changes || [];
    if (stack.length > MAX_CHANGES) room.recent_changes = stack.slice(-MAX_CHANGES);
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
  };
  repairSuiteSharedLinks(backstageState.stage);
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
  if (!unit || unit.kind !== 'unit') return;
  if (!unit.suiteVisualFootprints || !(roomId in unit.suiteVisualFootprints)) return;
  const before = snapshotRoom(unit);
  const nextVisuals = { ...unit.suiteVisualFootprints };
  delete nextVisuals[roomId];
  unit.suiteVisualFootprints = nextVisuals;
  touch(unit);
  pushChange(unit, 'suite visual invalidate', before);
  compass.rooms[parentId] = normalizeRoom(unit);
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

export function createAndStoreRoom(compass, {
  id,
  name,
  orientation_note = '',
  description = '',
  kind = 'room',
  parentId = '',
  locationTags = [],
} = {}) {
  let rid = String(id || '').trim();
  if (!rid) rid = slugifyId(name);
  const room = createRoom({
    id: rid,
    name,
    orientation_note,
    description,
    kind,
    parentId,
    locationTags: inheritGeographicTags(compass, {
      name: name || rid,
      kind,
      parentId,
      locationTags,
    }),
  });
  if (parentId) {
    if (!compass.rooms[parentId]) throw new Error(`Parent "${parentId}" not found.`);
    if (parentId === room.id) throw new Error('Place cannot parent itself.');
  }
  if (compass.rooms[room.id]) throw new Error(`Place "${room.id}" already exists.`);
  compass.rooms[room.id] = room;
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
  return result;
}

export function setPlaceKind(compass, placeId, kind) {
  const result = withRoomMutation(compass, placeId, `kind ${kind}`, room => {
    room.kind = normalizeKind(kind);
    if (compass.activeRoomId === placeId && !isLoadableKind(room.kind)) {
      compass.activeRoomId = '';
    }
    refreshPlaceLocationTags(compass, placeId);
  });
  refreshDescendantLocationTags(compass, placeId);
  return result;
}

export function setParent(compass, placeId, parentId) {
  const pid = String(parentId || '').trim();
  if (pid === placeId) throw new Error('Place cannot parent itself.');
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

export function setLocationTags(compass, placeId, tags) {
  return withRoomMutation(compass, placeId, 'location tags', room => {
    room.locationTags = normalizeTagList(tags);
  });
}

/** Mark whether a place is exposed to the elements / outdoors. */
export function setPlaceExposed(compass, placeId, exposed) {
  return withRoomMutation(compass, placeId, exposed ? 'exposed' : 'sheltered', room => {
    room.exposed = !!exposed;
  });
}

export function deletePlace(compass, placeId) {
  const id = String(placeId || '').trim();
  const room = compass.rooms?.[id];
  if (!room) throw new Error(`Place "${id}" not found.`);
  const kids = Object.values(compass.rooms).filter(r => r.parentId === id);
  if (kids.length) {
    throw new Error(`Cannot delete "${id}" — move or delete ${kids.length} nested place(s) first.`);
  }
  for (const other of Object.values(compass.rooms)) {
    if (!Array.isArray(other.links)) continue;
    const before = other.links.length;
    other.links = other.links.filter(l => l.toPlaceId !== id);
    if (other.links.length !== before) {
      compass.rooms[other.id] = normalizeRoom(other);
    }
  }
  delete compass.rooms[id];
  if (compass.activeRoomId === id) compass.activeRoomId = '';
  return true;
}

export function loadRoom(compass, roomId) {
  const id = String(roomId || '').trim();
  const room = compass.rooms[id];
  if (!room) throw new Error(`Place "${id}" not found.`);
  if (!isLoadableKind(room.kind)) {
    throw new Error(`"${id}" is a ${room.kind} — only rooms and transitional spaces can be loaded on the compass.`);
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
    const next = normalizePiece({ ...hit.item, ...patch, id: hit.item.id });
    const span = next.cells || [];
    // Furniture: if footprint moves off the storage cell, re-home to first span cell
    if (hit.layer === 'furniture' && span.length && !span.includes(hit.cell)) {
      room.cells[hit.cell][hit.layer].splice(hit.index, 1);
      const anchor = span[0];
      if (!room.cells[anchor][hit.layer]) room.cells[anchor][hit.layer] = [];
      room.cells[anchor][hit.layer].push(next);
      return { ...next, layer: hit.layer, cell: anchor };
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
  });
}

/** Move a piece to another compass area (re-anchors furniture/fixtures). */
export function moveItem(compass, roomId, { itemId, cell, layer, toCell } = {}) {
  const dest = normalizeCell(toCell);
  return withRoomMutation(compass, roomId, `move item → ${dest}`, room => {
    const hit = findItem(room, { itemId, cell, layer });
    if (!hit) throw new Error('Item not found in room.');
    if (hit.cell === dest && hit.layer !== 'furniture' && hit.layer !== 'fixtures') {
      return { ...hit.item, layer: hit.layer, cell: dest };
    }
    const [piece] = room.cells[hit.cell][hit.layer].splice(hit.index, 1);
    let next = piece;
    if (hit.layer === 'furniture' || hit.layer === 'fixtures') {
      const span = Array.isArray(piece.cells) && piece.cells.length
        ? piece.cells.map(c => (c === hit.cell ? dest : c))
        : [dest];
      // Ensure dest is included and unique
      const seen = new Set();
      const cells = [];
      for (const c of [dest, ...span]) {
        try {
          const id = normalizeCell(c);
          if (seen.has(id)) continue;
          seen.add(id);
          cells.push(id);
        } catch { /* skip */ }
      }
      next = normalizePiece({ ...piece, cells, id: piece.id });
    }
    if (!room.cells[dest][hit.layer]) room.cells[dest][hit.layer] = [];
    room.cells[dest][hit.layer].push(next);
    return { ...next, layer: hit.layer, cell: dest, fromCell: hit.cell };
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
    if (src && dest && (src.parentId || '') !== (dest.parentId || '')) {
      throw new Error('Wall links can only connect rooms under the same parent.');
    }
  }
  const summary = to
    ? `link ${w || `wall${edgeIdx}`} → ${to}`
    : `link ${w || `wall${edgeIdx}`} → outside`;
  return withRoomMutation(compass, roomId, summary, room => {
    // Prefer geometric cardinal (split walls are not limited to the 0–3 map).
    if (edgeIdx != null) {
      try {
        const card = edgeCardinal(room.footprint, edgeIdx);
        if (card) w = card;
      } catch { /* keep */ }
    }
    const existing = (room.links || []).find(l => {
      if (edgeIdx != null) return l.edge === edgeIdx;
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
}

/** Toggle whether an existing wall link faces outside. */
export function setLinkExternal(compass, roomId, linkId, external) {
  const lid = String(linkId || '').trim();
  return withRoomMutation(compass, roomId, external ? 'wall external' : 'wall interior', room => {
    const link = (room.links || []).find(l => l.id === lid);
    if (!link) throw new Error('Link not found.');
    link.external = !!external;
    if (!link.external && !link.toPlaceId && !(link.openings || []).length) {
      room.links = room.links.filter(l => l.id !== lid);
    }
    return link;
  });
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
  if (!parent || parent.kind !== 'unit') return null;
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
export function setSharedWallStyle(compass, roomAId, roomBId, wallA, wallB, style = 'merged') {
  const aId = String(roomAId || '').trim();
  const bId = String(roomBId || '').trim();
  const next = style === 'threshold' ? 'threshold' : 'merged';
  const apply = (roomId, peerId, wall) => {
    const room = compass.rooms?.[roomId];
    const peer = compass.rooms?.[peerId];
    if (!room) return;
    let hit = false;
    for (const link of room.links || []) {
      if (link.toPlaceId !== peerId || link.wall !== wall) continue;
      link.sharedStyle = next;
      hit = true;
    }
    if (!hit) {
      // Ensure a link exists so the style persists — resolve the real edge
      // geometrically instead of assuming a rectangular N/E/S/W layout.
      const edge = peer ? resolveSharedEdge(compass, room, peer, wall) : null;
      addLink(compass, roomId, { wall, edge, toPlaceId: peerId, description: 'suite shared' });
      for (const link of compass.rooms[roomId].links || []) {
        if (link.toPlaceId === peerId && link.wall === wall) link.sharedStyle = next;
      }
    }
  };
  apply(aId, bId, wallA);
  apply(bId, aId, wallB);
  return next;
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
  if (!unit) throw new Error(`Unit "${uid}" not found.`);
  if (unit.kind !== 'unit') throw new Error('Suite layout only applies to Unit / Suite places.');
  const next = normalizeSuiteLayout(layout);
  withRoomMutation(compass, uid, 'suite layout', room => {
    room.suiteLayout = next;
  });
  return reconcileSuiteSnapLinks(compass, uid);
}

/** Move one child on the suite canvas; optionally snap to siblings. */
export function moveSuiteChild(compass, unitId, childId, pose, { snap = true } = {}) {
  const uid = String(unitId || '').trim();
  const cid = String(childId || '').trim();
  const unit = compass.rooms?.[uid];
  if (!unit || unit.kind !== 'unit') throw new Error('Suite layout requires a Unit.');
  const children = listSuiteChildren(compass, uid);
  if (!children.some(c => c.id === cid)) throw new Error(`"${cid}" is not a child of this unit.`);
  const { layout } = ensureSuiteChildPoses(unit, children);
  let nextPose = normalizeSuitePose(pose);
  let snapInfo = { snapped: false };
  if (snap) {
    snapInfo = snapChildAmongSiblings(cid, nextPose, children, layout, SUITE_SNAP_TOL);
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
 * Ensure unit has poses for all children; write back if missing.
 */
export function ensureSuiteLayout(compass, unitId) {
  const uid = String(unitId || '').trim();
  const unit = compass.rooms?.[uid];
  if (!unit || unit.kind !== 'unit') return { layout: {}, dirty: false };
  const children = listSuiteChildren(compass, uid);
  const { layout, dirty } = ensureSuiteChildPoses(unit, children);
  if (dirty) {
    withRoomMutation(compass, uid, 'suite layout init', room => {
      room.suiteLayout = layout;
    });
  }
  return { layout, dirty };
}

function pairKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Create reciprocal wall links for contacting suite siblings;
 * drop empty sibling links that are no longer touching.
 */
export function reconcileSuiteSnapLinks(compass, unitId) {
  const uid = String(unitId || '').trim();
  ensureSuiteLayout(compass, uid);
  const unit = compass.rooms[uid];
  const children = listSuiteChildren(compass, uid);
  const childIds = new Set(children.map(c => c.id));
  const layout = normalizeSuiteLayout(unit.suiteLayout);
  const pairs = findContactingPairs(children, layout, SUITE_SNAP_TOL);
  const contactKeys = new Set(pairs.map(p => pairKey(p.aId, p.bId)));

  for (const pair of pairs) {
    ensureReciprocalWallLink(compass, pair.aId, pair.wallA, pair.bId);
    ensureReciprocalWallLink(compass, pair.bId, pair.wallB, pair.aId);
  }

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
      const touching = contactKeys.has(pairKey(child.id, to));
      if (touching) {
        keep.push(link);
        continue;
      }
      // Detached from sibling — keep if there's explicit user intent (an
      // opening, or a merged/threshold style deliberately set on this wall),
      // else drop. Without this, a wall you just marked "threshold" gets
      // silently un-established the moment any pose in the suite shifts it
      // out of contact tolerance — then dragging the rooms back together
      // creates a brand-new, style-less link that renders solid again.
      if ((Array.isArray(link.openings) && link.openings.length) || link.sharedStyle) {
        keep.push(link);
      } else {
        changed = true;
      }
    }
    if (changed) {
      withRoomMutation(compass, child.id, 'suite unlink detached', r => {
        r.links = keep;
      });
    }
  }

  return { layout: normalizeSuiteLayout(compass.rooms[uid].suiteLayout), snaps: pairs };
}

function ensureReciprocalWallLink(compass, fromId, wall, toId) {
  const room = compass.rooms[fromId];
  if (!room) return;
  const w = normalizeWall(wall);
  const peer = compass.rooms[toId];
  // Resolve the *real* footprint edge that faces this neighbour. Rooms reshaped
  // by divide/align aren't rectangles, so the naive N/E/S/W → 0/1/2/3 mapping
  // (baked into addLink) lands the link on the wrong wall — the single biggest
  // source of "shared wall won't merge / threshold / opening on wrong wall".
  const edge = peer ? resolveSharedEdge(compass, room, peer, w) : null;
  // Already linked to this neighbour on this wall / edge?
  const existing = (room.links || []).find(l =>
    l.toPlaceId === toId && (l.wall === w || (Number.isFinite(edge) && l.edge === edge)));
  if (existing) return existing;
  // If a wall already sits on that real edge but isn't linked yet (e.g. it was
  // an external wall until this room was pushed up against a neighbour), adopt
  // it as the shared link instead of stacking a second, conflicting link on the
  // same edge.
  if (Number.isFinite(edge)) {
    const onEdge = (room.links || []).find(l => l.edge === edge && !l.toPlaceId);
    if (onEdge) {
      return withRoomMutation(compass, fromId, 'suite snap link', r => {
        const l = (r.links || []).find(x => x.id === onEdge.id);
        if (l) {
          l.toPlaceId = toId;
          l.wall = w;
          l.external = false;
          if (!l.description) l.description = 'suite snap';
        }
        return l;
      });
    }
  }
  return addLink(compass, fromId, { wall: w, edge, toPlaceId: toId, description: 'suite snap' });
}

export { listSuiteChildren } from './suiteLayout.js';


export function removeLink(compass, roomId, linkId) {
  const lid = String(linkId || '').trim();
  return withRoomMutation(compass, roomId, `unlink ${lid}`, room => {
    const i = (room.links || []).findIndex(l => l.id === lid);
    if (i < 0) throw new Error('Link not found.');
    room.links.splice(i, 1);
  });
}

/** Find or create a wall-edge link for fixtures (doors/windows) — neighbor optional. */
export function ensureEdgeLink(compass, roomId, edgeIdx) {
  const edge = Math.max(0, Math.floor(Number(edgeIdx)));
  if (!Number.isFinite(edge)) throw new Error('Wall required.');
  return withRoomMutation(compass, roomId, `wall link ${edge}`, room => {
    const existing = (room.links || []).find(l => l.edge === edge);
    if (existing) return existing;
    let wall = EDGE_TO_CARDINAL[edge] || '';
    try {
      const card = edgeCardinal(room.footprint, edge);
      if (card) wall = card;
    } catch { /* keep */ }
    const link = {
      id: uid('lnk'),
      wall,
      edge,
      toPlaceId: '',
      description: '',
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
  if (!parent || parent.kind !== 'unit') return null;
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
 * One-time / on-load repair: drop stale links between rooms whose walls don't
 * actually form a shared wall (e.g. a Living-room *south* wall wrongly linked to
 * a Kitchenette *east* wall). Such a link makes an opening's gap show on one
 * wall while its mirrored glyph appears on an unrelated perpendicular wall. We
 * demote the bogus link to an external wall and strip the phantom mirrored
 * copies off the neighbour, keeping the original opening in place.
 */
function repairSuiteSharedLinks(compass) {
  const rooms = compass?.rooms || {};
  const units = Object.values(rooms).filter(r => r?.kind === 'unit');
  for (const unit of units) {
    const children = Object.values(rooms).filter(r => r?.parentId === unit.id);
    for (const child of children) {
      for (const link of child.links || []) {
        if (!link.toPlaceId || !Number.isFinite(Number(link.edge))) continue;
        const peer = rooms[link.toPlaceId];
        if (!peer) continue;
        const hit = findPeerLink(compass, child, link);
        if (!hit?.peerLink) continue;
        if (isGenuineSharedWall(compass, child, link, peer, hit.peerLink)) continue;
        // Bogus relationship: strip mirrored copies (matched by id) from the
        // peer link, then detach this link (keep its own openings in place).
        const ids = new Set((link.openings || []).map(o => o.id));
        const plink = (peer.links || []).find(l => l.id === hit.peerLink.id);
        if (plink) plink.openings = (plink.openings || []).filter(o => !ids.has(o.id));
        link.toPlaceId = '';
        link.external = true;
      }
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
        if (!peer) continue;
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
  return compass;
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
  along = 0.5,
  width = 0.14,
} = {}) {
  const lid = String(linkId || '').trim();
  const t = normalizeOpeningType(type);
  let cellId = '';
  if (cell) cellId = normalizeCell(cell);
  let syncInfo = null;
  const result = withRoomMutation(compass, roomId, `opening ${t}`, room => {
    const link = (room.links || []).find(l => l.id === lid);
    if (!link) throw new Error('Link not found.');
    const defaultTravel = t !== 'window' && t !== 'hole';
    const defaultPeer = t === 'window' || t === 'hole' || t === 'arch';
    const op = {
      id: uid('opn'),
      type: t,
      cell: cellId,
      label: String(label || '').trim(),
      description: String(description || '').trim(),
      peer: peer == null ? defaultPeer : !!peer,
      locked: !!locked,
      keyHint: String(keyHint || '').trim(),
      travel: travel == null ? defaultTravel : !!travel,
      along,
      width,
    };
    link.openings = link.openings || [];
    link.openings.push(op);
    syncExitsFromLinks(room);
    if (link.toPlaceId) syncInfo = { room: { ...room }, link: { ...link }, op: { ...op } };
    return op;
  });
  if (syncInfo) syncOpeningToPeer(compass, syncInfo.room, syncInfo.link, syncInfo.op);
  return result;
}

export function updateOpening(compass, roomId, linkId, openingId, patch = {}) {
  let syncInfo = null;
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
    if (patch.travel != null) op.travel = !!patch.travel;
    if (patch.along != null) op.along = Number(patch.along);
    if (patch.width != null) op.width = Number(patch.width);
    syncExitsFromLinks(room);
    if (link.toPlaceId) syncInfo = { room: { ...room }, link: { ...link }, op: { ...op } };
    return op;
  });
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
      sharedStyle: link.sharedStyle === 'threshold' ? 'threshold' : 'merged',
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

  if (room.parentId && compass.rooms[room.parentId]?.kind === 'unit') {
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
    if (!neighbor || !isLoadableKind(neighbor.kind)) {
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
    const opp = OPPOSITE_WALL[link.wall] || link.wall;
    const edge = WALL_EDGE_CELLS[opp] || ['C'];
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
      oppositeWall: opp,
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

export function addOccupant(compass, roomId, { name, cell = 'C', facing = 'N', castId = '', description = '' } = {}) {
  const nm = String(name || '').trim();
  if (!nm) throw new Error('Occupant name is required.');
  const cellId = normalizeCell(cell);
  const face = normalizeFacing(facing || 'N');
  const cid = String(castId || '').trim();
  const desc = String(description || '').trim();
  return withRoomMutation(compass, roomId, `occ add ${nm}`, room => {
    const existing = room.occupants.find(o => o.name.toLowerCase() === nm.toLowerCase());
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
  if (compass.activeRoomId === id && !isLoadableKind(restored.kind)) {
    compass.activeRoomId = '';
  }
  return { summary: last.summary, room: restored };
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
      if (GEO_PLACE_KIND_SET.has(place?.kind) && place?.name) push(place.name);
    }
    for (const bg of backstage?.visuals?.backgrounds || []) {
      for (const tag of bg?.locationTags || []) push(tag);
    }
  } catch { /* ignore */ }
  try {
    ingestLocationNames(storage, out);
    const cat = ensureLocationCatalog(storage);
    for (const n of Object.values(cat?.nodes || {})) {
      if (n?.name) push(n.name);
    }
  } catch { /* ignore */ }
  return out;
}
