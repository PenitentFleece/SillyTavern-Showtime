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
  cellDisplayLabel,
} from './schema.js';
import { buildOccupantPov, findOccupant } from './pov.js';
import { gatherPeerViews, listOpeningsSummary, getPlace, listSuiteChildren } from './state.js';
import { findContactingPairs, ensureSuiteChildPoses, suiteStoryMap } from './suiteLayout.js';
import { listSonarPingsInPlace } from './sonar.js';

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
  for (const link of room?.links || []) {
    for (const op of link.openings || []) {
      if (!op.locked) continue;
      const needle = String(op.keyHint || op.label || '').trim().toLowerCase();
      const match = needle
        ? usable.find(u => String(u.name || '').toLowerCase() === needle
          || String(u.name || '').toLowerCase().includes(needle)
          || needle.includes(String(u.name || '').toLowerCase()))
        : usable[0];
      if (match) {
        const where = match._from ? ` (${match._from})` : ' (usable)';
        notes.push(`${op.label || op.type} (${link.wall}): unlockable with ${match.name}${where}`);
      } else {
        notes.push(`${op.label || op.type} (${link.wall}): locked — may be forced in-scene, or unlocked with a matching Usable item${op.keyHint ? ` (“${op.keyHint}”)` : ''}`);
      }
    }
  }
  return notes;
}

/**
 * Compact suite overview for LLM: rooms + shared walls / openings.
 * Author-only fields (e.g. orientation_note) are omitted.
 */
export function buildSuiteInjection(unit, compass, { loadedRoomId = '', compact = false } = {}) {
  if (!unit || !isSuiteHostKind(unit.kind) || !compass) return '';
  const children = listSuiteChildren(compass, unit.id);
  if (!children.length) return '';
  const { layout } = ensureSuiteChildPoses(unit, children);
  const pairs = findContactingPairs(children, normalizeSuiteLayout(layout), undefined, suiteStoryMap(compass, children));
  const desc = String(unit.description || '').replace(/\s+/g, ' ').trim();
  const shortDesc = desc.length > 120 ? `${desc.slice(0, 119).trim()}…` : desc;
  const hostLabel = unit.kind === 'building' ? 'Building plan' : 'Suite';
  const lines = [
    `${hostLabel}: ${unit.name}${shortDesc ? ` — ${shortDesc}` : ''}`,
    `  Rooms: ${children.map(c => {
      const mark = c.id === loadedRoomId ? '*' : '';
      return `${c.name}${mark}`;
    }).join(', ')}`,
  ];
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
  } else if (!compact) {
    lines.push('  Shared walls: (none snapped)');
  }
  if (!compact) {
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
          op.travel && !op.locked ? 'travel' : null,
          op.peer ? 'see' : null,
          op.locked ? 'locked' : null,
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
export function formatRegionDressing(room, { maxPerCell = 6, maxTotal = 36 } = {}) {
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
      lines.push(`  ${cellDisplayLabel(n.kind, cellId)}: ${bits.join('; ')}${more}`);
    }
  }
  if (!lines.length) return '';
  const head = isExteriorHostKind(n.kind) ? 'Exterior (faces & yards)' : 'Areas (dressing)';
  return `${head}:\n${lines.join('\n')}`;
}

/**
 * Build injection text. Does NOT include orientation_note or recent_changes.
 */
export function buildCompassInjection(room, { starName = '', speakerName = '', compass = null, storage = null } = {}) {
  if (!room) return '';
  try {
    if (storage?.getChat?.('backstage', {})?.trackers?.location?.enabled === false) return '';
  } catch { /* ignore */ }
  const n = normalizeRoom(room);
  const blocks = [];
  const clip = (s, max) => {
    const t = String(s || '').replace(/\s+/g, ' ').trim();
    return t.length <= max ? t : `${t.slice(0, max - 1).trim()}…`;
  };

  if (compass && n.parentId) {
    const parent = getPlace(compass, n.parentId);
    if (isSuiteHostKind(parent?.kind)) {
      const suite = buildSuiteInjection(parent, compass, { loadedRoomId: n.id, compact: true });
      if (suite) blocks.push(suite);
    }
  }

  if (isExteriorHostKind(n.kind) && compass) {
    const plan = buildSuiteInjection(n, compass, { compact: true });
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
  const povOpts = { sonarReach };
  const openings = listOpeningsSummary(n);
  if (openings.length) {
    const linkLines = openings.map(op => {
      const flags = [
        op.peer ? 'see-through' : null,
        op.locked ? 'locked' : null,
        op.travel && !op.locked ? 'travel' : null,
        op.external ? 'external' : null,
      ].filter(Boolean).join('+');
      return `  ${op.wall} → ${op.toPlaceId || 'outside'}: ${op.type}${op.cell ? `@${op.cell}` : ''}${op.label ? ` “${op.label}”` : ''}${flags ? ` (${flags})` : ''}${op.description ? ` — ${clip(op.description, 80)}` : ''}`;
    });
    blocks.push(`Openings:\n${linkLines.join('\n')}`);
  }

  const externalWalls = (n.links || []).filter(l => l.external && !(l.openings || []).length);
  if (externalWalls.length) {
    blocks.push(`External walls:\n${externalWalls.map(l => `  ${l.wall || `wall ${l.edge}`}${l.description ? ` — ${l.description}` : ''}`).join('\n')}`);
  }

  const dressing = formatRegionDressing(n, { maxPerCell: 3, maxTotal: 12 });
  if (dressing) blocks.push(dressing);

  const lockNotes = resolveLockKeys(storage, n);
  if (lockNotes.length) {
    blocks.push(`Locks:\n${lockNotes.map(s => `  ${s}`).join('\n')}`);
  }

  if (compass) {
    const pings = listSonarPingsInPlace(compass, n.id);
    const lastKey = compass.sonar?.lastKey || '';
    const lastPlaceId = compass.sonar?.lastPlaceId || '';
    if (pings.length) {
      blocks.push(`Sonar (last-known here): ${pings.map(p => `${p.name}@${p.cell}`).join('; ')}`);
    } else if (lastKey && lastPlaceId && lastPlaceId !== n.id) {
      const other = getPlace(compass, lastPlaceId);
      blocks.push(`Sonar last key “${lastKey}” → ${other?.name || lastPlaceId} (not this room)`);
    }
  }

  const star = starName ? findOccupant(n, starName) : null;
  const speaker = speakerName ? findOccupant(n, speakerName) : null;

  const seen = new Set();
  const pushPov = (occ) => {
    if (!occ) return;
    const key = occ.name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    const block = formatPovBlock(n, occ, peeks, povOpts);
    if (block) blocks.push(block);
  };

  pushPov(star);
  pushPov(speaker);

  return `[Room Compass]\n${blocks.join('\n\n')}`;
}

export function pickInjectionNames({ starName, speakerName } = {}) {
  const star = String(starName || '').trim();
  const speaker = String(speakerName || '').trim();
  if (star && speaker && star.toLowerCase() === speaker.toLowerCase()) {
    return { starName: star, speakerName: '' };
  }
  return { starName: star, speakerName: speaker };
}
