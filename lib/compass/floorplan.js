// Room Compass — room footprint polygon (shape / dimensions) helpers.

import {
  defaultFootprint,
  normalizeFootprint,
  snapToFootprintGrid,
  estimateFootprintScale,
  CARDINAL_TO_EDGE,
  EDGE_TO_CARDINAL,
  WALLS,
} from './schema.js';

export {
  defaultFootprint,
  normalizeFootprint,
  snapToFootprintGrid,
  estimateFootprintScale,
  CARDINAL_TO_EDGE,
  EDGE_TO_CARDINAL,
};

export function edgeCount(footprint) {
  return normalizeFootprint(footprint).vertices.length;
}

export function edgeEndpoints(footprint, edgeIndex) {
  const { vertices } = normalizeFootprint(footprint);
  const n = vertices.length;
  const i = ((Number(edgeIndex) % n) + n) % n;
  return { a: vertices[i], b: vertices[(i + 1) % n], index: i };
}

/** Guess cardinal from edge direction (for peer/POV compatibility). */
export function edgeCardinal(footprint, edgeIndex) {
  const known = EDGE_TO_CARDINAL[edgeIndex];
  if (known && edgeCount(footprint) === 4) return known;
  const { a, b } = edgeEndpoints(footprint, edgeIndex);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    const midY = (a.y + b.y) / 2;
    return midY < 0.5 ? 'N' : 'S';
  }
  const midX = (a.x + b.x) / 2;
  return midX < 0.5 ? 'W' : 'E';
}

export function pointAlong(a, b, t) {
  const u = Math.max(0, Math.min(1, Number(t) || 0));
  return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
}

/** Project a 0–1 point onto an edge; returns along parameter t ∈ [0,1]. */
export function alongEdgeFromPoint(a, b, x, y) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-9) return 0.5;
  const t = ((x - a.x) * dx + (y - a.y) * dy) / len2;
  return Math.max(0, Math.min(1, t));
}

export function insertVertexOnEdge(footprint, edgeIndex, t = 0.5) {
  const fp = normalizeFootprint(footprint);
  const { a, b, index } = edgeEndpoints(fp, edgeIndex);
  const u = Math.max(0.05, Math.min(0.95, Number(t) || 0.5));
  const p = snapToFootprintGrid(
    a.x + (b.x - a.x) * u,
    a.y + (b.y - a.y) * u,
    fp,
  );
  const vertices = [...fp.vertices];
  vertices.splice(index + 1, 0, p);
  return { ...fp, vertices };
}

export function moveVertex(footprint, vertexIndex, x, y) {
  const fp = normalizeFootprint(footprint);
  const snapped = snapToFootprintGrid(x, y, fp);
  const vertices = fp.vertices.map((v, i) => (
    i === vertexIndex ? snapped : { ...v }
  ));
  return { ...fp, vertices };
}

/**
 * Drag a wall along the dominant axis (horizontal walls → Y, vertical → X).
 * Both endpoints of the edge move together so the wall stays aligned.
 * @param {number} [stepMul] Scales the snap grid resolution for this move only —
 *   >1 gives smaller/finer increments, <1 gives larger/coarser jumps (e.g. for
 *   Shift/Alt modifier keys in the suite parent view).
 */
export function moveEdge(footprint, edgeIndex, x, y, stepMul = 1) {
  const fp = normalizeFootprint(footprint);
  const n = fp.vertices.length;
  const i = ((Number(edgeIndex) % n) + n) % n;
  const j = (i + 1) % n;
  const a = fp.vertices[i];
  const b = fp.vertices[j];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const mul = Number.isFinite(stepMul) && stepMul > 0 ? stepMul : 1;
  const grid = mul === 1 ? fp.grid : Math.max(2, Math.min(96, Math.round((fp.grid || 8) * mul)));
  const snapped = snapToFootprintGrid(x, y, mul === 1 ? fp : { ...fp, grid });
  const vertices = fp.vertices.map(v => ({ ...v }));
  if (Math.abs(dx) >= Math.abs(dy)) {
    // Horizontal-ish wall — resize along Y
    vertices[i].y = snapped.y;
    vertices[j].y = snapped.y;
  } else {
    // Vertical-ish wall — resize along X
    vertices[i].x = snapped.x;
    vertices[j].x = snapped.x;
  }
  return { ...fp, vertices };
}

/** Translate every vertex by dx/dy in footprint space (grid-snapped). */
export function translateFootprint(footprint, dx, dy) {
  const fp = normalizeFootprint(footprint);
  const ox = Number(dx) || 0;
  const oy = Number(dy) || 0;
  if (!ox && !oy) return fp;
  const vertices = fp.vertices.map(v => {
    const snapped = snapToFootprintGrid(v.x + ox, v.y + oy, fp);
    return { x: snapped.x, y: snapped.y };
  });
  return { ...fp, vertices };
}

const WALL_SIDE_NAMES = Object.freeze({
  N: 'North', E: 'East', S: 'South', W: 'West',
  above: 'Above', below: 'Below',
});

/**
 * Human wall-link label: "North wall, Seg 1" / "North walls, Seg 2".
 * @param {object} link
 * @param {object} [room] room owning the link (for segment numbering among siblings)
 */
export function formatWallLinkLabel(link, room = null, compass = null) {
  const wall = String(link?.wall || '').trim();
  const side = WALL_SIDE_NAMES[wall] || wall || 'Wall';
  // Optional "shared with <neighbour>" / "external" suffix so a wall reads as an
  // established boundary between two rooms, not just an anonymous edge.
  const peerName = () => {
    const to = link?.toPlaceId;
    if (!to) return link?.external ? ' · external' : '';
    const name = compass?.rooms?.[to]?.name || to;
    return ` · shared with ${name}`;
  };
  if (wall === 'above' || wall === 'below') return `${side}${peerName()}`;
  if (link?.edge == null || link.edge === '') return `${side} wall${peerName()}`;

  const siblings = (room?.links || [])
    .filter(l => l && l.wall === wall && l.edge != null && l.edge !== '')
    .slice()
    .sort((a, b) => Number(a.edge) - Number(b.edge));
  let seg = siblings.findIndex(l => l.id === link.id);
  if (seg < 0) seg = Number(link.edge);
  const n = Math.max(1, siblings.length || 1);
  const noun = n > 1 ? 'walls' : 'wall';
  const segTxt = n > 1 ? `, Seg ${seg + 1}` : '';
  return `${side} ${noun}${segTxt}${peerName()}`;
}

export function resetFootprintRectangle() {
  return defaultFootprint();
}

export function projectFootprint(footprint, size = 200, pad = 16) {
  const fp = normalizeFootprint(footprint);
  const inner = size - pad * 2;
  const pts = fp.vertices.map(v => ({
    x: pad + v.x * inner,
    y: pad + v.y * inner,
    nx: v.x,
    ny: v.y,
  }));
  return { pts, size, pad, inner, vertices: fp.vertices };
}

export function isVerticalWall(wall) {
  return wall === 'above' || wall === 'below';
}

export function wallChipList() {
  return WALLS;
}
