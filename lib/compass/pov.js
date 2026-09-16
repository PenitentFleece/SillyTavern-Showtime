// Room Compass — POV rotation helpers (world-absolute N → relative ahead/left/right/behind).

import { CELLS, CELL_ROWS, normalizeFacing, normalizeCell, listCellPieces } from './schema.js';
import { canSeeArea } from './barriers.js';
import { accessibleAreas } from './sonar.js';

/** Clockwise order from N. */
const CARDINALS = ['N', 'E', 'S', 'W'];

/**
 * Rotate an absolute cell id into the occupant's frame.
 * Facing N → identity. Facing E → world W becomes ahead, etc.
 *
 * Mapping: treat the 3×3 as offsets from center (-1..1, -1..1) with +y = north,
 * rotate by facing, then map back to a cell label.
 *
 * @param {string} absoluteCell
 * @param {string} facing N|E|S|W
 * @returns {string} cell id in relative frame (still labeled NW/N/… as if facing were N)
 */
export function rotateCellToFacing(absoluteCell, facing) {
  const cell = normalizeCell(absoluteCell);
  const face = normalizeFacing(facing);
  if (face === 'N') return cell;

  const { x, y } = cellToOffset(cell);
  let rx = x;
  let ry = y;
  // Rotate world → local so "ahead" is +y in local coords.
  // facing E: world N is to local left → rotate 90° CW: (x,y)->(y,-x)? 
  // We want: when facing E, world E cell should read as "N" (ahead) in relative grid.
  // Absolute E = (1,0). After rotation for facing E, should become (0,1) = N.
  // Rotate by -facing (bring facing direction to +y):
  // facing E (90° CW from N): rotate points 90° CCW: (x,y) -> (-y, x)
  // (1,0) -> (0,1) ✓ N ahead
  // facing S: rotate 180: (x,y) -> (-x, -y)
  // facing W: rotate 90 CW: (x,y) -> (y, -x)
  if (face === 'E') {
    rx = -y;
    ry = x;
  } else if (face === 'S') {
    rx = -x;
    ry = -y;
  } else if (face === 'W') {
    rx = y;
    ry = -x;
  }
  return offsetToCell(rx, ry);
}

function cellToOffset(cell) {
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      if (CELL_ROWS[row][col] === cell) {
        return { x: col - 1, y: 1 - row }; // N row y=+1
      }
    }
  }
  return { x: 0, y: 0 };
}

function offsetToCell(x, y) {
  const col = Math.max(0, Math.min(2, Math.round(x) + 1));
  const row = Math.max(0, Math.min(2, 1 - Math.round(y)));
  return CELL_ROWS[row][col];
}

/**
 * Relative side label for an absolute cell from an occupant's facing.
 * @returns {'ahead'|'behind'|'left'|'right'|'here'|'forward-left'|'forward-right'|'back-left'|'back-right'}
 */
export function relativeSide(absoluteCell, facing, occupantCell = 'C') {
  const occ = normalizeCell(occupantCell || 'C');
  const abs = normalizeCell(absoluteCell);
  if (abs === occ) return 'here';

  // Vector from occupant to target in world offsets, then into local frame.
  const a = cellToOffset(abs);
  const o = cellToOffset(occ);
  let dx = a.x - o.x;
  let dy = a.y - o.y;
  const face = normalizeFacing(facing);
  let lx = dx;
  let ly = dy;
  if (face === 'E') {
    lx = -dy;
    ly = dx;
  } else if (face === 'S') {
    lx = -dx;
    ly = -dy;
  } else if (face === 'W') {
    lx = dy;
    ly = -dx;
  }

  if (lx === 0 && ly > 0) return 'ahead';
  if (lx === 0 && ly < 0) return 'behind';
  if (ly === 0 && lx < 0) return 'left';
  if (ly === 0 && lx > 0) return 'right';
  if (lx < 0 && ly > 0) return 'forward-left';
  if (lx > 0 && ly > 0) return 'forward-right';
  if (lx < 0 && ly < 0) return 'back-left';
  if (lx > 0 && ly < 0) return 'back-right';
  return 'here';
}

/**
 * Build a relative inventory of the room from one occupant's POV.
 * @param {object} room normalized room
 * @param {{name:string,cell:string,facing:string}} occupant
 * @param {{ sonarReach?: string }} [opts]
 */
export function buildOccupantPov(room, occupant, opts = {}) {
  if (!room || !occupant) return null;
  const facing = normalizeFacing(occupant.facing || 'N');
  const at = normalizeCell(occupant.cell || 'C');
  const bySide = {
    here: [],
    ahead: [],
    behind: [],
    left: [],
    right: [],
    'forward-left': [],
    'forward-right': [],
    'back-left': [],
    'back-right': [],
  };

  const reachMode = opts.sonarReach || 'adjacent';
  const reach = new Set(accessibleAreas(at, room, { reach: reachMode }));
  // When scanning the whole room, still honor internal walls between areas
  const wallGate = reachMode === 'adjacent';
  const seenFurniture = new Set();
  const sideRank = {
    here: 0, ahead: 1, left: 2, right: 3, behind: 4,
    'forward-left': 5, 'forward-right': 6, 'back-left': 7, 'back-right': 8,
  };
  for (const cellId of CELLS) {
    if (!reach.has(cellId)) continue;
    if (wallGate && !canSeeArea(at, cellId, room) && cellId !== at) continue;
    if (!wallGate && cellId !== at && !canSeeArea(at, cellId, room) && reachMode === 'adjacent') continue;
    const pieces = listCellPieces(room.cells?.[cellId], { room, cellId });
    if (!pieces.length) continue;
    for (const it of pieces) {
      if (it.layer === 'furniture') {
        if (seenFurniture.has(it.id)) continue;
        seenFurniture.add(it.id);
        const span = (it.cells?.length ? it.cells : [it.anchor || cellId]);
        const visibleSpan = span.filter(c => reach.has(c) && (c === at || canSeeArea(at, c, room)));
        if (!visibleSpan.length) continue;
        let bestSide = relativeSide(visibleSpan[0], facing, at);
        let bestRank = sideRank[bestSide] ?? 99;
        for (const c of visibleSpan) {
          const s = relativeSide(c, facing, at);
          const r = sideRank[s] ?? 99;
          if (r < bestRank) { bestSide = s; bestRank = r; }
        }
        const tags = [];
        if (it.occupiable) tags.push(`sit×${it.maxOccupancy || 1}`);
        if (it.contains) tags.push(it.contentsVisible === 'inside' ? 'inside' : 'display');
        const base = it.description || it.state || '';
        const state = [base, ...tags].filter(Boolean).join(' · ');
        bySide[bestSide].push({
          name: it.name,
          state,
          layer: it.layer,
          cell: it.anchor || cellId,
          side: bestSide,
        });
        continue;
      }
      const side = relativeSide(cellId, facing, at);
      bySide[side].push({
        name: it.name,
        state: it.description || it.state || '',
        layer: it.layer,
        cell: cellId,
        side,
      });
    }
  }

  const exits = {};
  for (const link of room.links || []) {
    for (const op of link.openings || []) {
      if (!op.cell && !op.travel && !op.peer) continue;
      const dir = op.cell || link.wall;
      let side = 'here';
      try {
        if (CELLS.includes(dir)) side = relativeSide(dir, facing, at);
        else if (['N', 'E', 'S', 'W'].includes(link.wall)) side = relativeSide(link.wall, facing, at);
      } catch { /* ignore */ }
      const label = [
        op.label || op.type,
        op.locked ? 'locked' : null,
        op.peer ? 'see-through' : null,
      ].filter(Boolean).join(', ');
      exits[`${link.wall}:${op.id}`] = { label, side, wall: link.wall, locked: !!op.locked, peer: !!op.peer };
    }
  }
  // Legacy exit labels
  for (const [dir, label] of Object.entries(room.exits || {})) {
    if (exits[dir]) continue;
    const side = relativeSide(dir, facing, at);
    exits[dir] = { label, side };
  }

  const others = (room.occupants || [])
    .filter(o => o.name.toLowerCase() !== String(occupant.name).toLowerCase())
    .filter(o => reach.has(o.cell) && (o.cell === at || canSeeArea(at, o.cell, room)))
    .map(o => ({
      name: o.name,
      cell: o.cell,
      side: relativeSide(o.cell, facing, at),
    }));

  return {
    name: occupant.name,
    cell: at,
    facing,
    bySide,
    exits,
    others,
    access: [...reach],
  };
}

export function findOccupant(room, name) {
  const n = String(name || '').trim().toLowerCase();
  if (!n || !room) return null;
  return (room.occupants || []).find(o => o.name.toLowerCase() === n) || null;
}

/** Next cardinal clockwise / counter-clockwise (utility). */
export function turnFacing(facing, dir = 'right') {
  const f = normalizeFacing(facing);
  const i = CARDINALS.indexOf(f);
  if (dir === 'left') return CARDINALS[(i + 3) % 4];
  return CARDINALS[(i + 1) % 4];
}
