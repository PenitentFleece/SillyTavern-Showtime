// Room Compass — internal walls (floorplan barriers between areas).

import {
  CELLS,
  CELL_ROWS,
  normalizeCell,
  normalizeFootprint,
  normalizeInternalWall,
  normalizeInternalWalls,
  snapToFootprintGrid,
} from './schema.js';

export { normalizeInternalWall, normalizeInternalWalls };

/** Bounding box of footprint vertices. */
export function footprintBBox(footprint) {
  const fp = normalizeFootprint(footprint);
  let minX = 1; let maxX = 0; let minY = 1; let maxY = 0;
  for (const v of fp.vertices) {
    minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
    minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
  }
  if (maxX <= minX) { minX = 0; maxX = 1; }
  if (maxY <= minY) { minY = 0; maxY = 1; }
  return { minX, maxX, minY, maxY };
}

/**
 * Map a compass area onto the footprint rectangle (3×3 centers inside bbox).
 * Floorplan y grows downward; area N is toward the top of the drawing.
 */
export function areaCenterInFootprint(cellId, footprint) {
  const id = normalizeCell(cellId);
  let row = 1;
  let col = 1;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      if (CELL_ROWS[r][c] === id) { row = r; col = c; }
    }
  }
  const { minX, maxX, minY, maxY } = footprintBBox(footprint);
  const x = minX + ((col + 0.5) / 3) * (maxX - minX);
  const y = minY + ((row + 0.5) / 3) * (maxY - minY);
  return { x, y, cell: id };
}

function orient(ax, ay, bx, by, cx, cy) {
  const v = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  if (Math.abs(v) < 1e-9) return 0;
  return v > 0 ? 1 : -1;
}

function onSeg(ax, ay, bx, by, px, py) {
  return (
    px >= Math.min(ax, bx) - 1e-9
    && px <= Math.max(ax, bx) + 1e-9
    && py >= Math.min(ay, by) - 1e-9
    && py <= Math.max(ay, by) + 1e-9
  );
}

function distToSeg(px, py, wall) {
  const ax = wall.x0; const ay = wall.y0;
  const bx = wall.x1; const by = wall.y1;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * True when sightline AB is blocked by wall CD.
 * Areas that sit on the wall (within a small tolerance) remain visible.
 * Areas on opposite sides whose connecting line crosses the wall span are hidden.
 */
export function segmentCrossesWall(ax, ay, bx, by, wall, onEps = 0.045) {
  const cx = wall.x0; const cy = wall.y0;
  const dx = wall.x1; const dy = wall.y1;
  const o1 = distToSeg(ax, ay, wall) <= onEps ? 0 : orient(cx, cy, dx, dy, ax, ay);
  const o2 = distToSeg(bx, by, wall) <= onEps ? 0 : orient(cx, cy, dx, dy, bx, by);
  if (o1 === 0 || o2 === 0) return false;
  if (o1 === o2) return false;

  const a1 = dy - cy;
  const b1 = cx - dx;
  const c1 = a1 * cx + b1 * cy;
  const a2 = by - ay;
  const b2 = ax - bx;
  const c2 = a2 * ax + b2 * ay;
  const det = a1 * b2 - a2 * b1;
  if (Math.abs(det) < 1e-12) return false;
  const ix = (b2 * c1 - b1 * c2) / det;
  const iy = (a1 * c2 - a2 * c1) / det;
  return onSeg(cx, cy, dx, dy, ix, iy) && onSeg(ax, ay, bx, by, ix, iy);
}

/**
 * Can an occupant in `fromCell` see contents in `toCell` given internal walls?
 */
export function canSeeArea(fromCell, toCell, room) {
  let from;
  let to;
  try {
    from = normalizeCell(fromCell);
    to = normalizeCell(toCell);
  } catch {
    return true;
  }
  if (from === to) return true;
  const walls = normalizeInternalWalls(room?.internalWalls, room?.footprint);
  if (!walls.length) return true;
  const fp = room?.footprint;
  const a = areaCenterInFootprint(from, fp);
  const b = areaCenterInFootprint(to, fp);
  for (const w of walls) {
    if (segmentCrossesWall(a.x, a.y, b.x, b.y, w)) return false;
  }
  return true;
}

/** All areas visible from a standing area. */
export function visibleAreasFrom(fromCell, room) {
  return CELLS.filter(c => canSeeArea(fromCell, c, room));
}

/**
 * Snap a freehand segment onto the footprint grid (prefer axis-aligned if close).
 */
export function finalizeWallSegment(x0, y0, x1, y1, footprint) {
  const fp = normalizeFootprint(footprint);
  let a = snapToFootprintGrid(x0, y0, fp);
  let b = snapToFootprintGrid(x1, y1, fp);
  const dx = Math.abs(b.x - a.x);
  const dy = Math.abs(b.y - a.y);
  if (dx < dy * 0.35) b = { x: a.x, y: b.y };
  else if (dy < dx * 0.35) b = { x: b.x, y: a.y };
  a = snapToFootprintGrid(a.x, a.y, fp);
  b = snapToFootprintGrid(b.x, b.y, fp);
  return normalizeInternalWall({ x0: a.x, y0: a.y, x1: b.x, y1: b.y }, fp);
}
