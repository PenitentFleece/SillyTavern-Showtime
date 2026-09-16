// Room Compass — suite (unit) multi-room layout: world transforms + edge snap.

import {
  estimateFootprintScale,
  isLoadableKind,
  normalizeFootprint,
  normalizeSuiteLayout,
  normalizeSuitePose,
} from './schema.js';

export const SUITE_SNAP_TOL = 0.45;

/** Loadable children of a unit (rooms + transitional). */
export function listSuiteChildren(compass, unitId) {
  const uid = String(unitId || '').trim();
  if (!uid) return [];
  return Object.values(compass?.rooms || {})
    .filter(r => r.parentId === uid && isLoadableKind(r.kind))
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
}

/**
 * True when `room` is a child of a Unit — its walls, shared-wall style, and
 * fixtures are edited from the Suite (parent) view instead of the room's own
 * floorplan editor. Standalone rooms (no parent, or parent isn't a unit)
 * keep full floorplan editing since they have no suite view to defer to.
 */
export function isSuiteChild(compass, room) {
  const parentId = room?.parentId || '';
  if (!parentId) return false;
  const parent = compass?.rooms?.[parentId];
  return !!parent && parent.kind === 'unit';
}

/**
 * Ensure every child has a pose; tile missing ones left→right.
 * @returns {{ layout: object, dirty: boolean }}
 */
export function ensureSuiteChildPoses(unit, children) {
  const layout = normalizeSuiteLayout(unit?.suiteLayout);
  let dirty = false;
  let cursorX = 0;
  let maxY = 0;
  for (const id of Object.keys(layout)) {
    const child = children.find(c => c.id === id);
    if (!child) continue;
    const box = worldAabb(child, layout[id]);
    cursorX = Math.max(cursorX, box.maxX + 0.5);
    maxY = Math.max(maxY, box.maxY);
  }
  for (const child of children) {
    if (layout[child.id]) continue;
    const scale = estimateFootprintScale(child.footprint);
    layout[child.id] = normalizeSuitePose({ x: cursorX, y: 0, rot: 0 });
    cursorX += scale.w + 0.5;
    dirty = true;
  }
  // Drop poses for removed children
  for (const id of Object.keys(layout)) {
    if (!children.some(c => c.id === id)) {
      delete layout[id];
      dirty = true;
    }
  }
  return { layout, dirty };
}

/** Rotate a local (0..w × 0..h) point by 0/90/180/270 (CW), returning new coords. */
function rotateLocal(x, y, w, h, rot) {
  const turns = ((Number(rot) || 0) / 90) % 4;
  let cx = x;
  let cy = y;
  let cw = w;
  let ch = h;
  for (let i = 0; i < turns; i++) {
    const nx = cy;
    const ny = cw - cx;
    cx = nx;
    cy = ny;
    const t = cw;
    cw = ch;
    ch = t;
  }
  return { x: cx, y: cy, w: cw, h: ch };
}

/** World-space polygon for a room at a suite pose. */
export function worldPolygon(room, pose) {
  const fp = normalizeFootprint(room?.footprint);
  const scale = estimateFootprintScale(fp);
  const p = normalizeSuitePose(pose);
  return fp.vertices.map(v => {
    const local = rotateLocal(v.x * scale.w, v.y * scale.h, scale.w, scale.h, p.rot);
    return { x: p.x + local.x, y: p.y + local.y };
  });
}

export function worldAabb(room, pose) {
  const verts = worldPolygon(room, pose);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const v of verts) {
    minX = Math.min(minX, v.x);
    maxX = Math.max(maxX, v.x);
    minY = Math.min(minY, v.y);
    maxY = Math.max(maxY, v.y);
  }
  if (!Number.isFinite(minX)) return { minX: 0, maxX: 1, minY: 0, maxY: 1 };
  return { minX, maxX, minY, maxY };
}

function rangesOverlap(a0, a1, b0, b1, tol) {
  return !(a1 < b0 - tol || a0 > b1 + tol);
}

/**
 * Try snapping moving room AABB against a fixed neighbor.
 * @returns {{ pose, wall, peerWall, snapped: boolean }}
 */
export function trySnapPose(movingPose, movingBox, fixedBox, tol = SUITE_SNAP_TOL) {
  const pose = normalizeSuitePose(movingPose);
  const overlapsY = rangesOverlap(movingBox.minY, movingBox.maxY, fixedBox.minY, fixedBox.maxY, tol);
  const overlapsX = rangesOverlap(movingBox.minX, movingBox.maxX, fixedBox.minX, fixedBox.maxX, tol);

  // Secondary "corner" snap: once a wall touches, also nudge the perpendicular
  // axis so a nearby pair of corners coincides — keeping shared walls flush and
  // avoiding awkward half-overlaps / slivers. Uses a slightly roomier tolerance
  // so it triggers a bit before the walls fully touch.
  const cornerTol = tol * 2;
  const alignPerp = (movLo, movHi, fixLo, fixHi) => {
    const dLo = fixLo - movLo;
    const dHi = fixHi - movHi;
    if (Math.abs(dLo) <= cornerTol && Math.abs(dLo) <= Math.abs(dHi)) return dLo;
    if (Math.abs(dHi) <= cornerTol) return dHi;
    return 0;
  };

  if (overlapsY && Math.abs(movingBox.maxX - fixedBox.minX) <= tol) {
    const dy = alignPerp(movingBox.minY, movingBox.maxY, fixedBox.minY, fixedBox.maxY);
    return {
      pose: { ...pose, x: pose.x + (fixedBox.minX - movingBox.maxX), y: pose.y + dy },
      wall: 'E',
      peerWall: 'W',
      snapped: true,
    };
  }
  if (overlapsY && Math.abs(movingBox.minX - fixedBox.maxX) <= tol) {
    const dy = alignPerp(movingBox.minY, movingBox.maxY, fixedBox.minY, fixedBox.maxY);
    return {
      pose: { ...pose, x: pose.x + (fixedBox.maxX - movingBox.minX), y: pose.y + dy },
      wall: 'W',
      peerWall: 'E',
      snapped: true,
    };
  }
  if (overlapsX && Math.abs(movingBox.maxY - fixedBox.minY) <= tol) {
    const dx = alignPerp(movingBox.minX, movingBox.maxX, fixedBox.minX, fixedBox.maxX);
    return {
      pose: { ...pose, x: pose.x + dx, y: pose.y + (fixedBox.minY - movingBox.maxY) },
      wall: 'S',
      peerWall: 'N',
      snapped: true,
    };
  }
  if (overlapsX && Math.abs(movingBox.minY - fixedBox.maxY) <= tol) {
    const dx = alignPerp(movingBox.minX, movingBox.maxX, fixedBox.minX, fixedBox.maxX);
    return {
      pose: { ...pose, x: pose.x + dx, y: pose.y + (fixedBox.maxY - movingBox.minY) },
      wall: 'N',
      peerWall: 'S',
      snapped: true,
    };
  }
  return { pose, snapped: false };
}

/**
 * Snap a moving child’s pose against all other suite children.
 * Prefers the closest successful snap.
 */
export function snapChildAmongSiblings(movingId, pose, children, layout, tol = SUITE_SNAP_TOL) {
  let best = { pose: normalizeSuitePose(pose), snapped: false, peerId: '', wall: '', peerWall: '' };
  let bestDist = Infinity;
  const tentative = normalizeSuitePose(pose);
  const moving = children.find(c => c.id === movingId);
  if (!moving) return best;
  const movingBox = worldAabb(moving, tentative);

  for (const peer of children) {
    if (peer.id === movingId) continue;
    const peerPose = layout[peer.id] || { x: 0, y: 0, rot: 0 };
    const fixedBox = worldAabb(peer, peerPose);
    const hit = trySnapPose(tentative, movingBox, fixedBox, tol);
    if (!hit.snapped) continue;
    const dx = hit.pose.x - tentative.x;
    const dy = hit.pose.y - tentative.y;
    const dist = Math.hypot(dx, dy);
    if (dist < bestDist) {
      bestDist = dist;
      best = {
        pose: hit.pose,
        snapped: true,
        peerId: peer.id,
        wall: hit.wall,
        peerWall: hit.peerWall,
      };
    }
  }
  return best;
}

/** Pairs of suite children whose AABBs currently share an edge within tol. */
export function findContactingPairs(children, layout, tol = SUITE_SNAP_TOL) {
  const pairs = [];
  for (let i = 0; i < children.length; i++) {
    for (let j = i + 1; j < children.length; j++) {
      const a = children[i];
      const b = children[j];
      const boxA = worldAabb(a, layout[a.id] || { x: 0, y: 0, rot: 0 });
      const boxB = worldAabb(b, layout[b.id] || { x: 0, y: 0, rot: 0 });
      const hit = trySnapPose(
        layout[a.id] || { x: 0, y: 0, rot: 0 },
        boxA,
        boxB,
        tol,
      );
      if (hit.snapped && Math.hypot(hit.pose.x - (layout[a.id]?.x || 0), hit.pose.y - (layout[a.id]?.y || 0)) < 1e-6) {
        pairs.push({
          aId: a.id,
          bId: b.id,
          wallA: hit.wall,
          wallB: hit.peerWall,
        });
      } else {
        // Check without requiring zero delta — re-test contact geometrically
        const overlapsY = rangesOverlap(boxA.minY, boxA.maxY, boxB.minY, boxB.maxY, tol);
        const overlapsX = rangesOverlap(boxA.minX, boxA.maxX, boxB.minX, boxB.maxX, tol);
        if (overlapsY && Math.abs(boxA.maxX - boxB.minX) <= tol) {
          pairs.push({ aId: a.id, bId: b.id, wallA: 'E', wallB: 'W' });
        } else if (overlapsY && Math.abs(boxA.minX - boxB.maxX) <= tol) {
          pairs.push({ aId: a.id, bId: b.id, wallA: 'W', wallB: 'E' });
        } else if (overlapsX && Math.abs(boxA.maxY - boxB.minY) <= tol) {
          pairs.push({ aId: a.id, bId: b.id, wallA: 'S', wallB: 'N' });
        } else if (overlapsX && Math.abs(boxA.minY - boxB.maxY) <= tol) {
          pairs.push({ aId: a.id, bId: b.id, wallA: 'N', wallB: 'S' });
        }
      }
    }
  }
  return pairs;
}

/** Bounding box of all children in the suite (for SVG viewBox). */
export function suiteWorldBounds(children, layout, pad = 1) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const child of children) {
    const box = worldAabb(child, layout[child.id] || { x: 0, y: 0, rot: 0 });
    minX = Math.min(minX, box.minX);
    maxX = Math.max(maxX, box.maxX);
    minY = Math.min(minY, box.minY);
    maxY = Math.max(maxY, box.maxY);
  }
  if (!Number.isFinite(minX)) return { minX: 0, maxX: 10, minY: 0, maxY: 10 };
  return {
    minX: minX - pad,
    maxX: maxX + pad,
    minY: minY - pad,
    maxY: maxY + pad,
  };
}

/** Point-in-polygon (ray cast) for suite click hit-testing. */
export function pointInWorldPolygon(x, y, verts) {
  let inside = false;
  for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
    const xi = verts[i].x;
    const yi = verts[i].y;
    const xj = verts[j].x;
    const yj = verts[j].y;
    const intersect = ((yi > y) !== (yj > y))
      && (x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Inverse of rotateLocal — world-relative coords back to unrotated local units. */
function unrotateLocal(x, y, w, h, rot) {
  const turns = ((Number(rot) || 0) / 90) % 4;
  let cx = x;
  let cy = y;
  let cw = w;
  let ch = h;
  for (let i = 0; i < turns; i++) {
    const t = cw; cw = ch; ch = t;
  }
  const back = (4 - turns) % 4;
  for (let i = 0; i < back; i++) {
    const nx = cy;
    const ny = cw - cx;
    cx = nx;
    cy = ny;
    const t = cw; cw = ch; ch = t;
  }
  return { x: cx, y: cy };
}

/** Convert suite world point → footprint normalized (0–1) coords for a posed room. */
export function worldToFootprintNorm(wx, wy, room, pose) {
  const fp = normalizeFootprint(room?.footprint);
  const scale = estimateFootprintScale(fp);
  const p = normalizeSuitePose(pose);
  const local = unrotateLocal(wx - p.x, wy - p.y, scale.w, scale.h, p.rot);
  return {
    x: scale.w ? local.x / scale.w : 0,
    y: scale.h ? local.y / scale.h : 0,
  };
}

/** Footprint normalized point → suite world. */
export function worldFromNorm(room, pose, nx, ny) {
  const fp = normalizeFootprint(room?.footprint);
  const scale = estimateFootprintScale(fp);
  const p = normalizeSuitePose(pose);
  const local = rotateLocal((Number(nx) || 0) * scale.w, (Number(ny) || 0) * scale.h, scale.w, scale.h, p.rot);
  return { x: p.x + local.x, y: p.y + local.y };
}

/** Closest footprint edge facing `cardinal` to a world point. */
export function nearestFacingEdge(room, pose, cardinal, wx, wy) {
  const verts = worldPolygon(room, pose);
  const edges = edgesFacingCardinal(room, pose, cardinal);
  if (!edges.length) return 0;
  const n = verts.length;
  let best = edges[0];
  let bestD = Infinity;
  for (const i of edges) {
    const a = verts[i];
    const b = verts[(i + 1) % n];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((wx - a.x) * dx + (wy - a.y) * dy) / len2));
    const px = a.x + dx * t;
    const py = a.y + dy * t;
    const d = Math.hypot(px - wx, py - wy);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/**
 * Cardinal of a world-space edge (from footprint edge midpoints).
 * @returns {'N'|'E'|'S'|'W'|''}
 */
export function worldEdgeCardinal(room, pose, edgeIndex) {
  const verts = worldPolygon(room, pose);
  const n = verts.length;
  if (!n) return '';
  const i = ((Number(edgeIndex) % n) + n) % n;
  const a = verts[i];
  const b = verts[(i + 1) % n];
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const box = worldAabb(room, pose);
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  // Classify by the edge's own direction — a roughly horizontal edge is a
  // N/S wall, a roughly vertical edge is an E/W wall — then use the
  // midpoint's side of the bounding-box center only to break the N-vs-S or
  // E-vs-W tie. Using the midpoint's offset from center to pick the *axis*
  // (as before) misclassifies an off-center wall segment (e.g. a short
  // south wall left after dividing a room) whenever its horizontal offset
  // happens to exceed its vertical one, silently reassigning it to the
  // wrong wall (and merging its openings into an unrelated shared wall).
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dx) >= Math.abs(dy)) return my >= cy ? 'S' : 'N';
  return mx >= cx ? 'E' : 'W';
}

/** Edge indices on a room that face a given cardinal in suite space. */
export function edgesFacingCardinal(room, pose, cardinal) {
  const verts = worldPolygon(room, pose);
  const out = [];
  for (let i = 0; i < verts.length; i++) {
    if (worldEdgeCardinal(room, pose, i) === cardinal) out.push(i);
  }
  return out;
}

/**
 * Shared-wall style between two rooms from their reciprocal links.
 * Segment openings take priority over merged/threshold styling.
 * @returns {{ style: 'merged'|'threshold'|'segments', openings: object[], links: object[] }}
 */
export function resolveSharedWallVisual(roomA, roomB, wallA, wallB) {
  const collect = (room, wall, peerId) => (room?.links || []).filter(link =>
    link.toPlaceId === peerId && link.wall === wall)
    .map(link => ({ link, ownerId: room?.id || '' }));
  const entries = [...collect(roomA, wallA, roomB?.id), ...collect(roomB, wallB, roomA?.id)];
  const openings = [];
  const seen = new Set();
  for (const { link, ownerId } of entries) {
    for (const op of link.openings || []) {
      if (!op?.id || seen.has(op.id)) continue;
      if (['ascent', 'descent'].includes(String(op.type || ''))) continue;
      seen.add(op.id);
      // Tag the opening with its true owning room/link/edge so the suite
      // view can still attach a click/drag hit-line to it even when it's
      // only rendered here via the shared-wall "absorb" pass (e.g. it's
      // stored on the far room's link, not the near/primary one) — without
      // this an opening drawn this way is a glyph with no interactive
      // target at all ("ghost" fixture).
      const tagged = (op._ownerPlaceId && op._ownerLinkId && Number.isFinite(op._ownerEdge))
        ? op
        : { ...op, _ownerPlaceId: ownerId, _ownerLinkId: link.id, _ownerEdge: Number.isFinite(link.edge) ? link.edge : op._ownerEdge };
      openings.push({ link, op: tagged });
    }
  }
  const links = entries.map(e => e.link);
  const threshold = links.some(l => l.sharedStyle === 'threshold');
  return { style: threshold ? 'threshold' : 'merged', openings, links };
}

function faceVertexIndices(room, pose, wall, line, tol) {
  const fp = normalizeFootprint(room.footprint);
  const n = fp.vertices.length;
  const idxs = new Set();
  for (const ei of edgesFacingCardinal(room, pose, wall)) {
    idxs.add(ei);
    idxs.add((ei + 1) % n);
  }
  const world = worldPolygon(room, pose);
  for (let i = 0; i < n; i++) {
    const v = world[i];
    const d = line.axis === 'x' ? Math.abs(v.x - line.value) : Math.abs(v.y - line.value);
    if (d <= tol) idxs.add(i);
  }
  return [...idxs];
}

function setVertexWorld(fp, room, pose, vi, wx, wy) {
  const probe = { ...room, footprint: fp };
  const norm = worldToFootprintNorm(wx, wy, probe, pose);
  const vertices = fp.vertices.map((v, i) => (
    i === vi
      ? { x: Math.max(0, Math.min(1, norm.x)), y: Math.max(0, Math.min(1, norm.y)) }
      : { ...v }
  ));
  return { ...fp, vertices };
}

/**
 * Flush contacting room poses so shared faces meet exactly, then weld nearby
 * vertices of adjacent rooms onto each other along that shared face.
 */
export function alignSuiteContactGeometry(children, layout, tol = SUITE_SNAP_TOL) {
  const next = { ...normalizeSuiteLayout(layout) };
  const byId = Object.fromEntries(children.map(c => [c.id, c]));
  const pairs = findContactingPairs(children, next, tol);

  for (const pair of pairs) {
    const a = byId[pair.aId];
    const b = byId[pair.bId];
    if (!a || !b) continue;
    const poseA = normalizeSuitePose(next[pair.aId]);
    const poseB = normalizeSuitePose(next[pair.bId]);
    const boxA = worldAabb(a, poseA);
    const boxB = worldAabb(b, poseB);
    if (pair.wallA === 'E' && pair.wallB === 'W') {
      const mid = (boxA.maxX + boxB.minX) / 2;
      next[pair.aId] = { ...poseA, x: poseA.x + (mid - boxA.maxX) };
      next[pair.bId] = { ...poseB, x: poseB.x + (mid - boxB.minX) };
    } else if (pair.wallA === 'W' && pair.wallB === 'E') {
      const mid = (boxA.minX + boxB.maxX) / 2;
      next[pair.aId] = { ...poseA, x: poseA.x + (mid - boxA.minX) };
      next[pair.bId] = { ...poseB, x: poseB.x + (mid - boxB.maxX) };
    } else if (pair.wallA === 'S' && pair.wallB === 'N') {
      const mid = (boxA.maxY + boxB.minY) / 2;
      next[pair.aId] = { ...poseA, y: poseA.y + (mid - boxA.maxY) };
      next[pair.bId] = { ...poseB, y: poseB.y + (mid - boxB.minY) };
    } else if (pair.wallA === 'N' && pair.wallB === 'S') {
      const mid = (boxA.minY + boxB.maxY) / 2;
      next[pair.aId] = { ...poseA, y: poseA.y + (mid - boxA.minY) };
      next[pair.bId] = { ...poseB, y: poseB.y + (mid - boxB.maxY) };
    }
  }

  // Slide rooms along the shared face so the nearest contacting vertices meet.
  const alongTol = Math.max(tol * 2.4, 0.85);
  for (const pair of pairs) {
    const a = byId[pair.aId];
    const b = byId[pair.bId];
    if (!a || !b) continue;
    const poseA = normalizeSuitePose(next[pair.aId]);
    const poseB = normalizeSuitePose(next[pair.bId]);
    const boxA = worldAabb(a, poseA);
    const line = (pair.wallA === 'E' || pair.wallA === 'W')
      ? { axis: 'x', value: pair.wallA === 'E' ? boxA.maxX : boxA.minX }
      : { axis: 'y', value: pair.wallA === 'S' ? boxA.maxY : boxA.minY };
    const along = line.axis === 'x' ? 'y' : 'x';
    const ia = faceVertexIndices(a, poseA, pair.wallA, line, tol);
    const ib = faceVertexIndices(b, poseB, pair.wallB, line, tol);
    const va = worldPolygon(a, poseA);
    const vb = worldPolygon(b, poseB);
    let bestD = alongTol;
    let bestA = null;
    let bestB = null;
    for (const i of ia) {
      for (const j of ib) {
        const d = Math.hypot(va[i].x - vb[j].x, va[i].y - vb[j].y);
        if (d < bestD) {
          bestD = d;
          bestA = va[i];
          bestB = vb[j];
        }
      }
    }
    if (!bestA || !bestB) continue;
    const mid = (bestA[along] + bestB[along]) / 2;
    if (along === 'y') {
      next[pair.aId] = { ...poseA, y: poseA.y + (mid - bestA.y) };
      next[pair.bId] = { ...poseB, y: poseB.y + (mid - bestB.y) };
    } else {
      next[pair.aId] = { ...poseA, x: poseA.x + (mid - bestA.x) };
      next[pair.bId] = { ...poseB, x: poseB.x + (mid - bestB.x) };
    }
  }

  const footprintPatches = {};

  const roomNow = (id) => {
    const base = byId[id];
    return { ...base, footprint: footprintPatches[id] || base.footprint };
  };

  for (const pair of pairs) {
    const a0 = byId[pair.aId];
    const b0 = byId[pair.bId];
    if (!a0 || !b0) continue;
    const poseA = normalizeSuitePose(next[pair.aId]);
    const poseB = normalizeSuitePose(next[pair.bId]);
    let a = roomNow(pair.aId);
    let b = roomNow(pair.bId);
    const boxA = worldAabb(a, poseA);
    const line = (pair.wallA === 'E' || pair.wallA === 'W')
      ? { axis: 'x', value: pair.wallA === 'E' ? boxA.maxX : boxA.minX }
      : { axis: 'y', value: pair.wallA === 'S' ? boxA.maxY : boxA.minY };

    let fpA = normalizeFootprint(a.footprint);
    let fpB = normalizeFootprint(b.footprint);
    a = { ...a, footprint: fpA };
    b = { ...b, footprint: fpB };

    const ia = faceVertexIndices(a, poseA, pair.wallA, line, tol);
    const ib = faceVertexIndices(b, poseB, pair.wallB, line, tol);
    const va0 = worldPolygon(a, poseA);
    const vb0 = worldPolygon(b, poseB);

    const usedB = new Set();
    for (const i of ia) {
      let best = -1;
      let bestD = alongTol;
      for (const j of ib) {
        if (usedB.has(j)) continue;
        const d = Math.hypot(va0[i].x - vb0[j].x, va0[i].y - vb0[j].y);
        if (d < bestD) {
          bestD = d;
          best = j;
        }
      }
      if (best < 0) continue;
      usedB.add(best);
      const mid = {
        x: (va0[i].x + vb0[best].x) / 2,
        y: (va0[i].y + vb0[best].y) / 2,
      };
      if (line.axis === 'x') mid.x = line.value;
      else mid.y = line.value;
      fpA = setVertexWorld(fpA, a0, poseA, i, mid.x, mid.y);
      fpB = setVertexWorld(fpB, b0, poseB, best, mid.x, mid.y);
      a = { ...a, footprint: fpA };
      b = { ...b, footprint: fpB };
    }

    for (const [room0, pose, wall, getFp, setFp] of [
      [a0, poseA, pair.wallA, () => fpA, (fp) => { fpA = fp; }],
      [b0, poseB, pair.wallB, () => fpB, (fp) => { fpB = fp; }],
    ]) {
      let fp = getFp();
      const room = { ...room0, footprint: fp };
      const idxs = faceVertexIndices(room, pose, wall, line, tol);
      const world = worldPolygon(room, pose);
      for (const vi of idxs) {
        const v = world[vi];
        const target = line.axis === 'x' ? { x: line.value, y: v.y } : { x: v.x, y: line.value };
        if (Math.hypot(target.x - v.x, target.y - v.y) < 1e-4) continue;
        fp = setVertexWorld(fp, room0, pose, vi, target.x, target.y);
      }
      setFp(fp);
    }

    const origA = JSON.stringify(normalizeFootprint(a0.footprint).vertices);
    const origB = JSON.stringify(normalizeFootprint(b0.footprint).vertices);
    if (JSON.stringify(fpA.vertices) !== origA) footprintPatches[a0.id] = fpA;
    if (JSON.stringify(fpB.vertices) !== origB) footprintPatches[b0.id] = fpB;
  }

  return { layout: next, footprintPatches, pairs };
}

/** Lightweight invariant checks (no DOM). Returns '' on success. */
export function smokeAlignSuiteContactPure() {
  try {
    const fp = {
      vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
      grid: 8,
      unitPerGrid: 2,
      unitLabel: 'ft',
    };
    const a = { id: 'a', footprint: { ...fp, vertices: fp.vertices.map(v => ({ ...v })) } };
    const b = { id: 'b', footprint: { ...fp, vertices: fp.vertices.map(v => ({ ...v })) } };
    const layout = {
      a: { x: 0, y: 0, rot: 0 },
      b: { x: 16.35, y: 0.4, rot: 0 },
    };
    const { layout: next, footprintPatches } = alignSuiteContactGeometry([a, b], layout, 0.5);
    const fa = { ...a, footprint: footprintPatches.a || a.footprint };
    const fb = { ...b, footprint: footprintPatches.b || b.footprint };
    const boxA = worldAabb(fa, next.a);
    const boxB = worldAabb(fb, next.b);
    if (Math.abs(boxA.maxX - boxB.minX) > 0.08) return 'shared faces should meet';
    const va = worldPolygon(fa, next.a);
    const vb = worldPolygon(fb, next.b);
    const aE = va.filter(v => Math.abs(v.x - boxA.maxX) < 0.2);
    let best = Infinity;
    for (const p of aE) {
      for (const q of vb) best = Math.min(best, Math.hypot(p.x - q.x, p.y - q.y));
    }
    if (best > 0.12) return `nearest corners should weld (got ${best.toFixed(3)})`;
    return '';
  } catch (err) {
    return String(err?.message || err);
  }
}
