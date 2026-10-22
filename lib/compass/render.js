// Room Compass — ASCII (slash preview) + prompt injection blocks (cached).

import {
  CELL_ROWS,
  normalizeRoom,
  roomHash,
  placeKindMeta,
  listCellPieces,
  listAllSetPieces,
  normalizeSuiteLayout,
  isSuiteHostKind,
  isExteriorHostKind,
  isCompassPlaceKind,
  cellDisplayLabel,
} from './schema.js';
import { buildOccupantPov, findOccupant, rotateCellForPose } from './pov.js';
import { gatherPeerViews, listOpeningsSummary, getPlace, getActiveRoom, listSuiteChildren, keyringUnlocksPlace } from './state.js';
import { findContactingPairs, ensureSuiteChildPoses, suiteStoryMap, listSuiteUnits } from './suiteLayout.js';
import {
  listSonarPingsInPlace,
  listListeningPingsForPlace,
  listAwayPingsForPlace,
} from './sonar.js';
import { getCastMembers, normalizeCastPresence } from '../castCatalog.js';
import { suiteListingLine } from './listing.js';
import { formatOccupancyLabel } from '../travelState.js';

const cache = new Map();
const MAX_CACHE = 48;

/**
 * Deterministic ASCII 3×3 — kept for /compass preview slash only.
 */
export function renderAsciiGrid(room) {
  const n = normalizeRoom(room);
  const hash = roomHash(n);
  if (cache.has(hash)) return cache.get(hash);

  const colW = [12, 13, 13];
  const lines = [];
  const rule = `   +${colW.map(w => '-'.repeat(w)).join('+')}+`;

  for (let r = 0; r < 3; r++) {
    lines.push(rule);
    const ids = CELL_ROWS[r];
    const headers = ids.map((id, i) => pad(` ${id}`, colW[i]));
    lines.push(`   |${headers.join('|')}|`);

    const itemLines = ids.map(id => {
      const pieces = listCellPieces(n.cells[id], { room: n, cellId: id });
      const occHere = (n.occupants || []).filter(o => o.cell === id);
      const bits = [];
      for (const o of occHere) bits.push(`${o.name}*`);
      for (const it of pieces) {
        const desc = it.description || it.state;
        const tags = [];
        if (it.layer === 'furniture') {
          if (it.cells?.length > 1) tags.push(it.cells.join('+'));
          if (it.occupiable) tags.push(`sit×${it.maxOccupancy || 1}`);
          if (it.contains) tags.push(it.contentsVisible === 'inside' ? 'in' : 'out');
        }
        const tagBit = tags.length ? ` {${tags.join(',')}}` : '';
        bits.push(desc
          ? `${it.name} (${it.layer}: ${desc})${tagBit}`
          : `${it.name} (${it.layer})${tagBit}`);
      }
      const exit = n.exits?.[id];
      if (exit) bits.push(`→ ${exit}`);
      return bits;
    });

    const maxRows = Math.max(1, ...itemLines.map(b => b.length));
    for (let i = 0; i < maxRows; i++) {
      const cells = itemLines.map((bits, ci) => {
        const text = bits[i] ? ` ${bits[i]}` : '';
        return pad(text, colW[ci]);
      });
      lines.push(`   |${cells.join('|')}|`);
    }
  }
  lines.push(rule);

  const kindLabel = placeKindMeta(n.kind)?.label || n.kind;
  const title = `${kindLabel}: ${n.name} [${n.id}]  (N↑ world-absolute)`;
  const ascii = `${title}\n${lines.join('\n')}`;
  cache.set(hash, ascii);
  if (cache.size > MAX_CACHE) {
    const first = cache.keys().next().value;
    cache.delete(first);
  }
  return ascii;
}

export function invalidateRenderCache() {
  cache.clear();
}

function pad(s, w) {
  const t = String(s ?? '');
  if (t.length >= w) return t.slice(0, w);
  return t + ' '.repeat(w - t.length);
}

export function formatPovBlock(room, occupant, peeks = [], opts = {}) {
  const pov = buildOccupantPov(room, occupant, opts);
  if (!pov) return '';
  const lines = [
    `POV · ${pov.name} (at ${pov.cell})`,
  ];
  if (pov.access?.length) {
    lines.push(`  reach: ${pov.access.join(', ')}`);
  }
  if ((room.internalWalls || []).length) {
    lines.push('  (internal walls block sight across opposite sides)');
  }
  const order = [
    'here', 'ahead', 'forward-left', 'forward-right',
    'left', 'right', 'behind', 'back-left', 'back-right',
  ];
  for (const side of order) {
    const items = pov.bySide[side] || [];
    if (!items.length) continue;
    const bits = items.map(it => {
      const desc = it.state ? ` [${it.state}]` : '';
      const layer = it.layer ? `/${it.layer}` : '';
      return `${it.name}${layer}${desc}`;
    });
    lines.push(`  ${side}: ${bits.join('; ')}`);
  }
  const exitBits = Object.entries(pov.exits || {}).map(([, e]) => `${e.side}: ${e.label}`);
  if (exitBits.length) lines.push(`  openings: ${exitBits.join('; ')}`);
  if (pov.others.length) {
    lines.push(`  others: ${pov.others.map(o => `${o.name} @ ${o.cell} (${o.side})`).join('; ')}`);
  }

  const facing = pov.facing;
  // Neighbor-room glimpses through openings are only in scope for the
  // "adjacent rooms" reach setting — otherwise "adjacent"/"room" would leak
  // what's behind a door regardless of how tightly the user scoped reach.
  if (opts.sonarReach === 'adjacent_rooms') {
    for (const peek of peeks) {
      if (!peek?.visible) continue;
      const wall = peek.wall;
      const relevant = wall === 'above' || wall === 'below'
        || wallTowardFacing(wall, facing);
      if (!relevant) continue;
      const via = (peek.openings || []).map(o => {
        const flags = [o.locked ? 'locked' : null, o.peer ? 'see-through' : null].filter(Boolean).join('+');
        return flags ? `${o.type}(${flags})` : o.type;
      }).join('/');
      const bits = [];
      for (const it of peek.items || []) {
        bits.push(it.state ? `${it.name} [${it.state}]` : it.name);
      }
      for (const o of peek.occupants || []) {
        bits.push(`${o.name}*`);
      }
      const travel = peek.travel ? ' · entry' : (peek.locked ? ' · locked' : '');
      if (bits.length) {
        lines.push(`  through ${via} (${wall} → ${peek.toName}): ${bits.join('; ')}${travel}`);
      } else {
        lines.push(`  through ${via} (${wall} → ${peek.toName}): (nothing notable on the far side)${travel}`);
      }
    }
  }

  return lines.join('\n');
}

function wallTowardFacing(wall, facing) {
  if (wall === facing) return true;
  const leftOf = { N: 'W', E: 'N', S: 'E', W: 'S' };
  const rightOf = { N: 'E', E: 'S', S: 'W', W: 'N' };
  if (leftOf[facing] === wall || rightOf[facing] === wall) return true;
  return false;
}

/**
 * Match usable inventory items against locked opening key hints / labels.
 * @param {object} storage
 * @param {object} room
 */
export function resolveLockKeys(storage, room) {
  const usable = [];
  try {
    const inv = storage?.getChat?.('inventory', { mobile: [], static: [] }) || {};
    for (const loc of ['mobile', 'static']) {
      for (const it of inv[loc] || []) {
        if (it.kind === 'container') continue;
        if (String(it.category || '').toLowerCase() !== 'usable') continue;
        usable.push({ ...it, _from: loc === 'mobile' ? 'on person' : 'in trunk' });
      }
    }
  } catch { /* ignore */ }
  try {
    const st = storage?.getChat?.('backstage', {}) || {};
    const compass = st.stage || st;
    for (const it of listAllSetPieces(compass)) {
      if (String(it.category || '').toLowerCase() !== 'usable') continue;
      usable.push({
        ...it,
        _from: `on set · ${it.placeName || it.placeId}${it.cell ? ` @${it.cell}` : ''}`,
      });
    }
  } catch { /* ignore */ }

  const notes = [];
  let compass = null;
  try {
    const st = storage?.getChat?.('backstage', {}) || {};
    compass = st.stage || st;
  } catch { /* ignore */ }
  const cast = (() => {
    try { return getCastMembers(storage); } catch { return []; }
  })();
  for (const link of room?.links || []) {
    for (const op of link.openings || []) {
      if (!op.locked) continue;
      const dest = link.toPlaceId && compass ? getPlace(compass, link.toPlaceId) : null;
      const accessNames = (op.accessCastIds || [])
        .map(id => cast.find(c => String(c.id) === String(id))?.name)
        .filter(Boolean);
      const keyHolders = dest
        ? cast.filter(c => (c.keyring || []).length && keyringUnlocksPlace(c.keyring, dest, compass))
        : [];
      const needle = String(op.keyHint || op.label || '').trim().toLowerCase();
      const match = needle
        ? usable.find(u => String(u.name || '').toLowerCase() === needle
          || String(u.name || '').toLowerCase().includes(needle)
          || needle.includes(String(u.name || '').toLowerCase()))
        : usable[0];
      const bits = [];
      if (accessNames.length) bits.push(`passable by ${accessNames.join(', ')}`);
      for (const who of keyHolders) {
        const tags = (who.keyring || []).join(', ');
        bits.push(`${who.name} has keys${tags ? ` (${tags})` : ''}`);
      }
      if (match) {
        const where = match._from ? ` (${match._from})` : ' (usable)';
        bits.push(`unlockable with ${match.name}${where}`);
      } else if (op.keyHint) {
        bits.push(`Usable “${op.keyHint}”`);
      }
      if (bits.length) {
        notes.push(`${op.label || op.type} (${link.wall}): ${bits.join('; ')}`);
      } else {
        notes.push(`${op.label || op.type} (${link.wall}): locked — may be forced in-scene, or unlocked with a matching Usable item${op.keyHint ? ` (“${op.keyHint}”)` : ''}`);
      }
    }
  }
  return notes;
}

function buildCastLookup(storage) {
  const byId = new Map();
  const byName = new Map();
  try {
    for (const m of getCastMembers(storage)) {
      if (!m?.name) continue;
      if (m.id) byId.set(String(m.id), m);
      byName.set(String(m.name).trim().toLowerCase(), m);
      for (const a of m.aliases || []) {
        const al = String(a || '').trim().toLowerCase();
        if (al) byName.set(al, m);
      }
    }
  } catch { /* ignore */ }
  return { byId, byName };
}

function isPhysicallyInRoom({ name = '', castId = '', roomId = '', compass = null, castLookup = null } = {}) {
  const nlow = String(name || '').trim().toLowerCase();
  const cid = String(castId || '').trim();
  if (!nlow && !cid) return false;
  if (castLookup) {
    const m = (cid && castLookup.byId.get(cid)) || (nlow && castLookup.byName.get(nlow));
    if (m) {
      const pres = normalizeCastPresence(m);
      if (pres === 'writtenOut' || pres === 'privy') return false;
    }
  }
  const pings = compass?.sonar?.pings || {};
  const ping = (cid && pings[cid])
    || Object.values(pings).find(p => String(p?.name || '').trim().toLowerCase() === nlow);
  if (ping) {
    if (ping.listening || ping.away) {
      if (!ping.placeId || ping.placeId !== roomId || roomId === ping.listeningPlaceId || roomId === ping.departedFrom) {
        return false;
      }
    }
    if (ping.placeId && compass?.rooms?.[ping.placeId] && ping.placeId !== roomId) {
      return false;
    }
  }
  return true;
}

/**
 * Resolve which room the Room Compass should focus on for prompt injection.
 * Follows a cued character's room first, then the latest sonar room if standable,
 * then the active room.
 */
export function resolveCompassFocusRoom(compass, {
  storage = null,
  cuedSpeakerName = '',
  speakerName = '',
  starName = '',
} = {}) {
  if (!compass || typeof compass !== 'object') return null;
  const active = getActiveRoom(compass);
  const pings = compass?.sonar?.pings || {};
  const castLookup = buildCastLookup(storage);
  let boardHeld = false;
  try {
    const bs = storage?.getChat?.('backstage', {}) || {};
    boardHeld = Boolean(bs?.trackers?.scene?.boardHeld || bs?.now?.held);
  } catch { /* ignore */ }

  const findRoomForName = (rawName) => {
    const target = String(rawName || '').trim();
    if (!target) return null;
    const tlow = target.toLowerCase();
    const member = castLookup.byName.get(tlow);
    const cid = member?.id ? String(member.id) : '';
    const ping = (cid && pings[cid])
      || Object.values(pings).find(p => String(p?.name || '').trim().toLowerCase() === tlow);
    if (boardHeld && active && isCompassPlaceKind(active.kind) && !ping?.locked && (!member || normalizeCastPresence(member) === 'inPlay')) {
      return active;
    }
    if (ping?.placeId && !ping.away && !ping.listening) {
      const r = getPlace(compass, ping.placeId);
      if (r && isCompassPlaceKind(r.kind)) return r;
    }
    if (active && findOccupant(active, target) && isPhysicallyInRoom({ name: target, castId: cid, roomId: active.id, compass, castLookup })) {
      return active;
    }
    for (const r of Object.values(compass.rooms || {})) {
      if (!r || !isCompassPlaceKind(r.kind)) continue;
      if (findOccupant(r, target) && isPhysicallyInRoom({ name: target, castId: cid, roomId: r.id, compass, castLookup })) {
        return r;
      }
    }
    return null;
  };

  if (cuedSpeakerName) {
    const cuedRoom = findRoomForName(cuedSpeakerName);
    if (cuedRoom) return cuedRoom;
  }

  const sonarPlaceId = String(compass.sonar?.lastPlaceId || '').trim();
  if (sonarPlaceId && compass.rooms?.[sonarPlaceId] && isCompassPlaceKind(compass.rooms[sonarPlaceId].kind)) {
    const sonarRoom = compass.rooms[sonarPlaceId];
    if (!active || active.id === sonarRoom.id || active.parentId === sonarRoom.parentId) {
      return sonarRoom;
    }
  }

  if (speakerName && (!active || !findOccupant(active, starName))) {
    const spRoom = findRoomForName(speakerName);
    if (spRoom) return spRoom;
  }

  return active;
}

/**
 * Compact suite overview for LLM: rooms + shared walls / openings.
 * Author-only fields (e.g. orientation_note) are omitted.
 */
export function buildSuiteInjection(unit, compass, { loadedRoomId = '', compact = false, storage = null } = {}) {
  if (!unit || !isSuiteHostKind(unit.kind) || !compass) return '';
  const children = listSuiteChildren(compass, unit.id);
  const units = unit.kind === 'building' ? listSuiteUnits(compass, unit.id) : [];
  if (!children.length && !units.length) return '';
  const { layout } = children.length ? ensureSuiteChildPoses(unit, children) : { layout: {} };
  const pairs = children.length
    ? findContactingPairs(children, normalizeSuiteLayout(layout), undefined, suiteStoryMap(compass, children))
    : [];
  const desc = String(unit.description || '').replace(/\s+/g, ' ').trim();
  const shortDesc = desc.length > 120 ? `${desc.slice(0, 119).trim()}…` : desc;
  const hostLabel = unit.kind === 'building' ? 'Building plan' : 'Suite';
  const listing = suiteListingLine(unit, children, compass);
  const siblingIds = new Set(children.map(c => c.id));
  if (unit.id) siblingIds.add(unit.id);
  const lines = [
    `${hostLabel}: ${unit.name}${shortDesc ? ` — ${shortDesc}` : ''}`,
    listing ? `  Listing: ${listing.includes('|') ? listing.split('|').slice(1).join('|').trim() : listing}` : '',
    children.length
      ? `  Rooms: ${children.map(c => {
        const mark = c.id === loadedRoomId ? '*' : '';
        return `${c.name}${mark}`;
      }).join(', ')}`
      : '',
    units.length ? `  Units: ${units.map(u => u.name).join(', ')}` : '',
  ].filter(Boolean);
  if (pairs.length) {
    lines.push('  Shared walls:');
    for (const p of pairs) {
      const a = children.find(c => c.id === p.aId);
      const b = children.find(c => c.id === p.bId);
      const aName = a?.name || p.aId;
      const bName = b?.name || p.bId;
      const openings = summarizeSharedOpenings(a, b, p.wallA, p.wallB);
      lines.push(`    ${aName} ${p.wallA} ↔ ${bName} ${p.wallB}${openings ? ` (${openings})` : ''}`);
    }
  } else if (!compact && children.length) {
    lines.push('  Shared walls: (none snapped)');
  }
  const castLookup = buildCastLookup(storage);
  const preferredId = String(loadedRoomId || compass?.sonar?.lastPlaceId || compass?.activeRoomId || '').trim();
  const evalOrder = [...children].sort((a, b) => {
    const aPref = a.id === preferredId ? 1 : 0;
    const bPref = b.id === preferredId ? 1 : 0;
    if (aPref !== bPref) return bPref - aPref;
    return (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0);
  });
  const namesByRoomId = new Map();
  const seenAcrossSuite = new Set();
  for (const c of evalOrder) {
    const names = [];
    const seen = new Set();
    const add = (raw, castId = '') => {
      const n = String(raw || '').trim();
      if (!n) return;
      const k = n.toLowerCase();
      if (seen.has(k) || seenAcrossSuite.has(k)) return;
      if (!isPhysicallyInRoom({ name: n, castId, roomId: c.id, compass, castLookup })) return;
      seen.add(k);
      seenAcrossSuite.add(k);
      names.push(n);
    };
    for (const o of c.occupants || []) add(o.name, o.castId);
    try {
      for (const p of listSonarPingsInPlace(compass, c.id)) add(p.name, p.castId);
    } catch { /* ignore */ }
    namesByRoomId.set(c.id, names);
  }
  const occBits = [];
  for (const c of children) {
    const names = namesByRoomId.get(c.id) || [];
    if (names.length) occBits.push(`${c.name}: ${names.join(', ')}`);
  }
  if (occBits.length) lines.push(`  Occupants: ${occBits.join('; ')}`);
  const exits = [];
  for (const link of unit.links || []) {
    const to = String(link.toPlaceId || '').trim();
    if (!to && !link.external && !(link.openings || []).length) continue;
    const dest = to
      ? (getPlace(compass, to)?.name || to)
      : (link.external ? 'outside' : 'unlinked');
    const ops = (link.openings || []).map(o => o.type).filter(Boolean).join('/');
    const arrow = ops ? '→' : '↔';
    exits.push(`${unit.name} ${link.wall || ''} ${arrow} ${dest}${ops ? ` (${ops})` : ''}`.trim());
  }
  for (const c of children) {
    for (const link of c.links || []) {
      const to = String(link.toPlaceId || '').trim();
      if (to && siblingIds.has(to)) continue;
      if (!to && !link.external && !(link.openings || []).length) continue;
      const dest = to
        ? (getPlace(compass, to)?.name || to)
        : (link.external ? 'outside' : 'unlinked');
      const ops = (link.openings || []).map(o => o.type).filter(Boolean).join('/');
      const arrow = ops ? '→' : '↔';
      exits.push(`${c.name} ${link.wall || ''} ${arrow} ${dest}${ops ? ` (${ops})` : ''}`.trim());
    }
  }
  if (exits.length) lines.push(`  Off-map: ${exits.join('; ')}`);
  if (!compact && children.length) {
    const sketch = suiteAsciiSketch(children, layout);
    if (sketch) lines.push(`  Layout:\n${sketch}`);
  }
  return lines.join('\n');
}

function summarizeSharedOpenings(roomA, roomB, wallA, wallB) {
  const bits = [];
  const collect = (room, wall, peerId) => {
    for (const link of room?.links || []) {
      if (link.toPlaceId !== peerId || link.wall !== wall) continue;
      for (const op of link.openings || []) {
        const flags = [
          op.peer ? 'see' : null,
          op.locked ? 'locked' : null,
          op.travel && !op.locked ? 'travel' : null,
          (op.accessCastIds || []).length ? `access:${(op.accessCastIds || []).length}` : null,
        ].filter(Boolean).join('+');
        bits.push(`${op.type}${op.label ? ` “${op.label}”` : ''}${flags ? `:${flags}` : ''}`);
      }
    }
  };
  collect(roomA, wallA, roomB?.id);
  collect(roomB, wallB, roomA?.id);
  return [...new Set(bits)].slice(0, 6).join(', ');
}

/** Tiny relative-position sketch of suite children (token-light). */
function suiteAsciiSketch(children, layout) {
  if (children.length < 2 || children.length > 8) return '';
  const poses = children.map(c => ({
    id: c.id,
    name: (c.name || c.id).slice(0, 10),
    ...(normalizeSuiteLayout(layout)[c.id] || { x: 0, y: 0, rot: 0 }),
  }));
  const xs = poses.map(p => p.x);
  const ys = poses.map(p => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  const spanX = Math.max(1e-6, maxX - minX);
  const spanY = Math.max(1e-6, maxY - minY);
  const cols = 3;
  const rows = 3;
  const grid = Array.from({ length: rows }, () => Array.from({ length: cols }, () => []));
  for (const p of poses) {
    const col = Math.min(cols - 1, Math.max(0, Math.round(((p.x - minX) / spanX) * (cols - 1))));
    const row = Math.min(rows - 1, Math.max(0, Math.round(((p.y - minY) / spanY) * (rows - 1))));
    grid[row][col].push(p.name);
  }
  return grid.map(row => `    ${row.map(cell => (cell.join('/') || '·').padEnd(12)).join(' ')}`).join('\n');
}

/**
 * Bounded per-region (3×3 cell) dressing lists for the loaded room.
 */
export function formatRegionDressing(room, { maxPerCell = 6, maxTotal = 36, poseRot = 0 } = {}) {
  const n = normalizeRoom(room);
  const lines = [];
  let total = 0;
  for (const row of CELL_ROWS) {
    for (const cellId of row) {
      if (total >= maxTotal) break;
      const pieces = listCellPieces(n.cells[cellId], { room: n, cellId });
      if (!pieces.length) continue;
      const slice = pieces.slice(0, Math.min(maxPerCell, maxTotal - total));
      total += slice.length;
      const bits = slice.map(it => {
        const tag = it.layer ? `:${it.layer}` : '';
        return `${it.name}${tag}`;
      });
      const more = pieces.length > slice.length ? ` (+${pieces.length - slice.length})` : '';
      const labelId = poseRot ? rotateCellForPose(cellId, poseRot) : cellId;
      lines.push(`  ${cellDisplayLabel(n.kind, labelId)}: ${bits.join('; ')}${more}`);
    }
  }
  if (!lines.length) return '';
  const head = isExteriorHostKind(n.kind) ? 'Exterior (faces & yards)' : 'Areas (dressing)';
  return `${head}:\n${lines.join('\n')}`;
}

/**
 * Build injection text. Does NOT include orientation_note or recent_changes.
 */
export function buildCompassInjection(room, {
  starName = '',
  speakerName = '',
  cuedSpeakerName = '',
  compass = null,
  storage = null,
  travel = null,
  lastLocationKey = '',
} = {}) {
  if (!room) return '';
  try {
    if (storage?.getChat?.('backstage', {})?.trackers?.location?.enabled === false) return '';
  } catch { /* ignore */ }
  let moving = travel;
  let occKey = lastLocationKey;
  if (!moving) {
    try {
      const scene = storage?.getChat?.('backstage', {})?.trackers?.scene || {};
      moving = scene.travel;
      occKey = occKey || scene.lastLocationKey || '';
    } catch { /* ignore */ }
  }
  if (moving && moving.mode === 'moving') {
    const label = formatOccupancyLabel(moving, { lastLocationKey: occKey }) || 'Moving';
    return `[Room Compass]\n${label}`;
  }
  const n = normalizeRoom(room);
  const castLookup = buildCastLookup(storage);
  if (Array.isArray(n.occupants) && n.occupants.length) {
    n.occupants = n.occupants.filter(o =>
      isPhysicallyInRoom({ name: o?.name, castId: o?.castId, roomId: n.id, compass, castLookup }));
  }
  const poseRot = (() => {
    if (!compass || !n.parentId) return 0;
    const parent = getPlace(compass, n.parentId);
    if (!isSuiteHostKind(parent?.kind)) return 0;
    const layout = normalizeSuiteLayout(parent.suiteLayout);
    return Number(layout?.[n.id]?.rot) || 0;
  })();
  const blocks = [];
  const clip = (s, max) => {
    const t = String(s || '').replace(/\s+/g, ' ').trim();
    return t.length <= max ? t : `${t.slice(0, max - 1).trim()}…`;
  };

  if (compass && n.parentId) {
    const parent = getPlace(compass, n.parentId);
    if (isSuiteHostKind(parent?.kind)) {
      const suite = buildSuiteInjection(parent, compass, { loadedRoomId: n.id, compact: true, storage });
      if (suite) blocks.push(suite);
    }
  }

  if (isExteriorHostKind(n.kind) && compass) {
    const plan = buildSuiteInjection(n, compass, { compact: true, storage });
    if (plan) blocks.push(plan);
  }

  const kindLabel = placeKindMeta(n.kind)?.label || n.kind;
  const desc = clip(n.description, 160);
  const exteriorBit = isExteriorHostKind(n.kind)
    ? ' · exterior faces N/E/S/W + yards (C = at the building)'
    : '';
  blocks.push(`${kindLabel}: ${n.name}${n.exposed ? ' · exposed' : ''}${exteriorBit}${desc ? `\n${desc}` : ''}`);

  let sonarReach = 'adjacent';
  try {
    const trk = storage?.getChat?.('backstage', {})?.trackers;
    if (trk?.location?.enabled === false) sonarReach = 'adjacent';
    else if (trk?.location?.sonarReach) sonarReach = trk.location.sonarReach;
  } catch { /* ignore */ }

  const peeks = compass ? gatherPeerViews(compass, n) : [];
  // accessibleAreas() already treats 'room' and 'adjacent_rooms' as the same
  // 9-cell reach within this room — the only thing 'adjacent_rooms' adds is
  // the neighbor-room peek block below, gated in formatPovBlock.
  const povOpts = { sonarReach, compass };
  const openings = listOpeningsSummary(n);
  if (openings.length) {
    let cast = [];
    try { cast = getCastMembers(storage); } catch { /* ignore */ }
    const linkLines = openings.map(op => {
      const access = (op.accessCastIds || [])
        .map(id => cast.find(c => String(c.id) === String(id))?.name)
        .filter(Boolean);
      const flags = [
        op.peer ? 'see-through' : null,
        op.locked ? 'locked' : null,
        op.travel && !op.locked ? 'travel' : null,
        op.external ? 'external' : null,
        access.length ? `access: ${access.join(', ')}` : null,
      ].filter(Boolean).join('+');
      const destName = op.toPlaceId
        ? ((compass && getPlace(compass, op.toPlaceId)?.name) || op.toPlaceId)
        : (op.external ? 'outside' : 'outside');
      return `  ${op.wall} → ${destName}: ${op.type}${op.cell ? `@${poseRot ? rotateCellForPose(op.cell, poseRot) : op.cell}` : ''}${op.label ? ` “${op.label}”` : ''}${flags ? ` (${flags})` : ''}${op.description ? ` — ${clip(op.description, 80)}` : ''}`;
    });
    blocks.push(`Openings:\n${linkLines.join('\n')}`);
  }

  const borderingWalls = (n.links || []).filter(l => l.toPlaceId && !(l.openings || []).length);
  if (borderingWalls.length) {
    blocks.push(`Bordering walls:\n${borderingWalls.map(l => {
      const peerName = (compass && getPlace(compass, l.toPlaceId)?.name) || l.toPlaceId;
      const descBit = l.description && l.description !== 'suite snap' ? ` — ${l.description}` : '';
      return `  ${l.wall || `wall ${l.edge}`} ↔ ${peerName}${descBit}`;
    }).join('\n')}`);
  }

  const externalWalls = (n.links || []).filter(l => l.external && !(l.openings || []).length);
  if (externalWalls.length) {
    blocks.push(`External walls:\n${externalWalls.map(l => {
      const descBit = l.description && l.description !== 'suite snap' ? ` — ${l.description}` : '';
      return `  ${l.wall || `wall ${l.edge}`}${descBit}`;
    }).join('\n')}`);
  }

  const dressing = formatRegionDressing(n, { maxPerCell: 3, maxTotal: 12, poseRot });
  if (dressing) blocks.push(dressing);

  const lockNotes = resolveLockKeys(storage, n);
  if (lockNotes.length) {
    blocks.push(`Locks:\n${lockNotes.map(s => `  ${s}`).join('\n')}`);
  }

  if (compass) {
    const pings = listSonarPingsInPlace(compass, n.id).filter(p =>
      isPhysicallyInRoom({ name: p?.name, castId: p?.castId, roomId: n.id, compass, castLookup }));
    const lastKey = compass.sonar?.lastKey || '';
    const lastPlaceId = compass.sonar?.lastPlaceId || '';
    if (pings.length) {
      blocks.push(`Sonar (last-known here): ${pings.map(p => `${p.name}@${p.cell}`).join('; ')}`);
    } else if (lastKey && lastPlaceId && lastPlaceId !== n.id) {
      const other = getPlace(compass, lastPlaceId);
      blocks.push(`Sonar last key “${lastKey}” → ${other?.name || lastPlaceId} (not this room)`);
    }

    const listeningMap = new Map();
    for (const p of listListeningPingsForPlace(compass, n.id)) {
      const k = String(p.name || '').trim().toLowerCase();
      if (!k) continue;
      const via = p.listeningVia ? `via ${p.listeningVia}` : 'listening in';
      const where = p.awayLabel
        ? ` · ${p.awayLabel}`
        : (p.placeId && p.placeId !== n.id && getPlace(compass, p.placeId)?.name
          ? ` · in ${getPlace(compass, p.placeId).name}`
          : ' · outside');
      listeningMap.set(k, `${p.name} (${via}${where})`);
    }
    try {
      for (const m of getCastMembers(storage)) {
        if (!m?.name || normalizeCastPresence(m) !== 'privy') continue;
        const k = String(m.name).trim().toLowerCase();
        if (listeningMap.has(k)) continue;
        const p = compass.sonar?.pings?.[String(m.id || m.name)];
        const via = p?.listeningVia ? `via ${p.listeningVia}` : 'listening in';
        const where = p?.awayLabel ? ` · ${p.awayLabel}` : ' · outside';
        listeningMap.set(k, `${m.name} (${via}${where})`);
      }
    } catch { /* ignore */ }
    if (listeningMap.size) {
      blocks.push(`Listening in (not physically in ${n.name}): ${[...listeningMap.values()].join('; ')} — privy to what is said/done here; not physically present in the room`);
    }

    const awayList = listAwayPingsForPlace(compass, n.id);
    if (awayList.length) {
      const bits = awayList.map((p) => {
        const where = p.placeId && getPlace(compass, p.placeId)?.name
          ? getPlace(compass, p.placeId).name
          : (p.awayLabel || 'outside');
        return `${p.name} (${where})`;
      });
      blocks.push(`Outside / Stepped out (not in ${n.name}): ${bits.join('; ')}`);
    }
  }

  const effectiveSpeakerName = String(cuedSpeakerName || speakerName || '').trim();
  const star = starName ? findOccupant(n, starName) : null;
  const speaker = effectiveSpeakerName ? findOccupant(n, effectiveSpeakerName) : null;

  const seen = new Set();
  const pushPov = (occ) => {
    if (!occ) return;
    const key = occ.name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    const block = formatPovBlock(n, occ, peeks, povOpts);
    if (block) blocks.push(block);
  };

  if (cuedSpeakerName || (!star && speaker)) {
    pushPov(speaker);
    pushPov(star);
  } else {
    pushPov(star);
    pushPov(speaker);
  }

  return `[Room Compass]\n${blocks.join('\n\n')}`;
}

export function pickInjectionNames({ starName, speakerName, cuedSpeakerName = '' } = {}) {
  const star = String(starName || '').trim();
  const cued = String(cuedSpeakerName || '').trim();
  const speaker = String(cued || speakerName || '').trim();
  if (star && speaker && star.toLowerCase() === speaker.toLowerCase()) {
    return { starName: star, speakerName: '', cuedSpeakerName: cued };
  }
  return { starName: star, speakerName: speaker, cuedSpeakerName: cued };
}

export function smokeCompassMovingInjectPure() {
  try {
    const room = {
      id: 'apt',
      name: 'Fukuoka Heights',
      kind: 'building',
      cells: {},
      occupants: [{ name: 'Sakai Yukio', cell: 'C' }],
    };
    const text = buildCompassInjection(room, {
      travel: { mode: 'moving', fromKey: 'Commission Safehouse', destKey: 'flight' },
    });
    if (/Sakai|Kitchenette|Occupants/i.test(text)) return 'moving inject should skip suite occupants';
    if (!/\[Room Compass\]/.test(text) || !/Moving/.test(text)) return 'moving inject should be a transit line';
    if (/\bflight\b/i.test(text)) return 'moving inject should not print vehicle dest';

    // Verify Privy / Listening-in & Duplicate Suite Occupant filtering + Cued Speaker POV ordering
    const compass = {
      activeRoomId: 'brk',
      rooms: {
        suite: { id: 'suite', name: 'Okisato Antiques', kind: 'building', parentId: '' },
        brk: {
          id: 'brk',
          name: 'Break Room',
          kind: 'room',
          parentId: 'suite',
          cells: {},
          occupants: [
            { name: 'Weslie', cell: 'S', castId: 'w' },
            { name: 'Hawks', cell: 'S', castId: 'h' },
            { name: 'Mrs. Okisato', cell: 'S', castId: 'o' },
          ],
        },
        sto: {
          id: 'sto',
          name: 'Storage',
          kind: 'room',
          parentId: 'suite',
          cells: {},
          occupants: [
            { name: 'Weslie', cell: 'S', castId: 'w' },
            { name: 'Hawks', cell: 'S', castId: 'h' },
            { name: 'Mrs. Okisato', cell: 'S', castId: 'o' },
          ],
        },
      },
      sonar: {
        lastKey: 'Break Room',
        lastPlaceId: 'brk',
        pings: {
          w: { name: 'Weslie', castId: 'w', placeId: 'brk', cell: 'S', locked: false },
          o: { name: 'Mrs. Okisato', castId: 'o', placeId: 'brk', cell: 'S', locked: false },
          h: {
            name: 'Hawks',
            castId: 'h',
            placeId: '',
            cell: 'S',
            locked: false,
            away: true,
            awayLabel: 'crepe kiosk',
            departedFrom: 'brk',
            listening: true,
            listeningVia: 'covert feather',
            listeningPlaceId: 'brk',
          },
        },
      },
    };
    const inject = buildCompassInjection(compass.rooms.brk, {
      starName: 'Weslie',
      speakerName: 'Mrs. Okisato',
      cuedSpeakerName: 'Mrs. Okisato',
      compass,
    });
    if (/Hawks\s*@\s*S\s*\(here\)/i.test(inject)) {
      return `hawks-should-not-be-here: ${inject}`;
    }
    if (/Storage:\s*Weslie/i.test(inject)) {
      return `storage-should-not-duplicate-occupants: ${inject}`;
    }
    if (!/Listening in \(not physically in Break Room\):\s*Hawks \(via covert feather · crepe kiosk\)/i.test(inject)) {
      return `missing-listening-in-line: ${inject}`;
    }
    const okiPovIdx = inject.indexOf('POV · Mrs. Okisato');
    const wesPovIdx = inject.indexOf('POV · Weslie');
    if (okiPovIdx < 0 || (wesPovIdx >= 0 && okiPovIdx > wesPovIdx)) {
      return `cued-speaker-pov-should-come-first: oki=${okiPovIdx} wes=${wesPovIdx}`;
    }
    return '';
  } catch (err) {
    return String(err?.message || err);
  }
}
