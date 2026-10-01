// Room Compass — suite (unit) multi-room layout: world transforms + edge snap.

import {
  estimateFootprintScale,
  isLoadableKind,
  isSuiteHostKind,
  normalizeFootprint,
  normalizeSuiteLayout,
  normalizeSuitePose,
} from './schema.js';

export const SUITE_SNAP_TOL = 0.45;
/** How far overlapping / gapped facing walls still count as a shared contact. */
export const SUITE_CONTACT_TOL = 1.85;

/** Loadable children of a suite host (unit or building): rooms + transitional. */
export function listSuiteChildren(compass, unitId) {
  const uid = String(unitId || '').trim();
  if (!uid) return [];
  return Object.values(compass?.rooms || {})
    .filter(r => r.parentId === uid && isLoadableKind(r.kind))
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
}

/**
 * True when `room` is a child of a suite host (unit or building) — its walls,
 * shared-wall style, and fixtures are edited from the Suite (parent) view
 * instead of the room's own floorplan editor. Standalone rooms keep full
 * floorplan editing since they have no suite view to defer to.
 */
export function isSuiteChild(compass, room) {
  const parentId = room?.parentId || '';
  if (!parentId) return false;
  const parent = compass?.rooms?.[parentId];
  return !!parent && isSuiteHostKind(parent.kind);
}

/**
 * Infer 0-based story indices from above/below links and ascent/descent
 * openings (plus an optional numeric `story` on the room). Lowest floor is 0.
 */
export function suiteStoryMap(compass, children) {
  const list = Array.isArray(children) ? children : [];
  const ids = new Set(list.map(c => c.id));
  const story = {};
  for (const c of list) {
    const explicit = Number(c?.story);
    story[c.id] = Number.isFinite(explicit) ? Math.round(explicit) : 0;
  }
  const edges = [];
  for (const room of list) {
    for (const link of room.links || []) {
      const to = String(link.toPlaceId || '').trim();
      if (!to || !ids.has(to)) continue;
      if (link.wall === 'above') edges.push([room.id, to, 1]);
      else if (link.wall === 'below') edges.push([room.id, to, -1]);
      for (const op of link.openings || []) {
        const t = String(op.type || '').toLowerCase();
        if (t === 'ascent') edges.push([room.id, to, 1]);
        else if (t === 'descent') edges.push([room.id, to, -1]);
      }
    }
  }
  let changed = true;
  let guard = 0;
  while (changed && guard++ < 64) {
    changed = false;
    for (const [a, b, d] of edges) {
      if (story[b] < story[a] + d) {
        story[b] = story[a] + d;
        changed = true;
      }
      if (story[a] < story[b] - d) {
        story[a] = story[b] - d;
        changed = true;
      }
    }
  }
  const vals = Object.values(story);
  const min = vals.length ? Math.min(...vals) : 0;
  for (const id of Object.keys(story)) story[id] -= min;
  return story;
}

export function suiteHasStackedStories(storyMap) {
  return Object.values(storyMap || {}).some(s => Number(s) > 0);
}

function sameStory(storyMap, aId, bId) {
  if (!storyMap) return true;
  return (Number(storyMap[aId]) || 0) === (Number(storyMap[bId]) || 0);
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
  const p = normalizeSuitePose(pose);
  const cell = fp.grid * fp.unitPerGrid;
  return fp.vertices.map(v => {
    const local = rotateLocal(v.x * cell, v.y * cell, cell, cell, p.rot);
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
export function snapChildAmongSiblings(movingId, pose, children, layout, tol = SUITE_SNAP_TOL, storyMap = null) {
  let best = { pose: normalizeSuitePose(pose), snapped: false, peerId: '', wall: '', peerWall: '' };
  let bestDist = Infinity;
  const tentative = normalizeSuitePose(pose);
  const moving = children.find(c => c.id === movingId);
  if (!moving) return best;
  const movingBox = worldAabb(moving, tentative);

  for (const peer of children) {
    if (peer.id === movingId) continue;
    if (!sameStory(storyMap, movingId, peer.id)) continue;
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

function oppositeCardinal(a, b) {
  return (a === 'E' && b === 'W') || (a === 'W' && b === 'E')
    || (a === 'N' && b === 'S') || (a === 'S' && b === 'N');
}

/** True when two world-space segments are parallel, nearly collinear, and overlap. */
function collinearOverlap(a0, a1, b0, b1, tol) {
  const ux = a1.x - a0.x;
  const uy = a1.y - a0.y;
  const vx = b1.x - b0.x;
  const vy = b1.y - b0.y;
  const uLen = Math.hypot(ux, uy) || 1;
  const vLen = Math.hypot(vx, vy) || 1;
  const sinA = Math.abs(ux * vy - uy * vx) / (uLen * vLen);
  if (sinA > 0.28) return null;
  const dist = Math.abs((b0.x - a0.x) * uy - (b0.y - a0.y) * ux) / uLen;
  // Coincident / stacked walls (overlap) sit at dist ≈ 0; a visible double-wall
  // gap or overlap of ~1–2 units still counts as the same shared face.
  if (dist > Math.max(tol, 1.6) + 0.2) return null;
  const t0 = ((b0.x - a0.x) * ux + (b0.y - a0.y) * uy) / (uLen * uLen);
  const t1 = ((b1.x - a0.x) * ux + (b1.y - a0.y) * uy) / (uLen * uLen);
  const lo = Math.min(t0, t1);
  const hi = Math.max(t0, t1);
  if (hi < 0.02 || lo > 0.98) return null;
  const overlap = Math.min(hi, 1) - Math.max(lo, 0);
  if (overlap * uLen < 0.12) return null;
  return { dist, overlap };
}

/**
 * World-space segment where two footprint edges actually overlap, drawn
 * midway between stacked/gapped faces so the hit target sits on the seam.
 */
export function sharedContactSegment(roomA, poseA, edgeA, roomB, poseB, edgeB) {
  const va = worldPolygon(roomA, poseA);
  const vb = worldPolygon(roomB, poseB);
  const nA = va.length;
  const nB = vb.length;
  if (!nA || !nB) return null;
  const ia = ((Number(edgeA) % nA) + nA) % nA;
  const ib = ((Number(edgeB) % nB) + nB) % nB;
  const a0 = va[ia];
  const a1 = va[(ia + 1) % nA];
  const b0 = vb[ib];
  const b1 = vb[(ib + 1) % nB];
  const hit = collinearOverlap(a0, a1, b0, b1, SUITE_CONTACT_TOL);
  if (!hit) return null;
  const ux = a1.x - a0.x;
  const uy = a1.y - a0.y;
  const len2 = ux * ux + uy * uy || 1;
  const tOf = (p) => ((p.x - a0.x) * ux + (p.y - a0.y) * uy) / len2;
  const lo = Math.max(0, Math.min(tOf(b0), tOf(b1)));
  const hi = Math.min(1, Math.max(tOf(b0), tOf(b1)));
  if (hi - lo < 0.02) return null;
  const pA0 = { x: a0.x + ux * lo, y: a0.y + uy * lo };
  const pA1 = { x: a0.x + ux * hi, y: a0.y + uy * hi };
  const vx = b1.x - b0.x;
  const vy = b1.y - b0.y;
  const vLen2 = vx * vx + vy * vy || 1;
  const closestOnB = (p) => {
    const s = Math.max(0, Math.min(1, ((p.x - b0.x) * vx + (p.y - b0.y) * vy) / vLen2));
    return { x: b0.x + vx * s, y: b0.y + vy * s };
  };
  const q0 = closestOnB(pA0);
  const q1 = closestOnB(pA1);
  return {
    p1: { x: (pA0.x + q0.x) / 2, y: (pA0.y + q0.y) / 2 },
    p2: { x: (pA1.x + q1.x) / 2, y: (pA1.y + q1.y) / 2 },
  };
}

function nearestEdgeForWall(room, pose, wall, peerRoom, peerPose) {
  const verts = worldPolygon(room, pose);
  const edges = edgesFacingCardinal(room, pose, wall);
  if (!edges.length) return 0;
  const peerVerts = worldPolygon(peerRoom, peerPose);
  const cx = peerVerts.reduce((s, v) => s + v.x, 0) / (peerVerts.length || 1);
  const cy = peerVerts.reduce((s, v) => s + v.y, 0) / (peerVerts.length || 1);
  const n = verts.length;
  let best = edges[0];
  let bestD = Infinity;
  for (const i of edges) {
    const a = verts[i];
    const b = verts[(i + 1) % n];
    const d = Math.hypot((a.x + b.x) / 2 - cx, (a.y + b.y) / 2 - cy);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** Pairs of suite children whose walls currently share an edge (touch or overlap). */
export function findContactingPairs(children, layout, tol = SUITE_CONTACT_TOL, storyMap = null) {
  const pairs = [];
  const seen = new Set();
  const add = (p) => {
    if (!p?.aId || !p?.bId || p.aId === p.bId) return;
    const ea = Number.isFinite(p.edgeA) ? p.edgeA : '';
    const eb = Number.isFinite(p.edgeB) ? p.edgeB : '';
    const k = p.aId < p.bId
      ? `${p.aId}|${p.bId}|${p.wallA}|${p.wallB}|${ea}|${eb}`
      : `${p.bId}|${p.aId}|${p.wallB}|${p.wallA}|${eb}|${ea}`;
    if (seen.has(k)) return;
    seen.add(k);
    pairs.push(p);
  };

  for (let i = 0; i < children.length; i++) {
    for (let j = i + 1; j < children.length; j++) {
      const a = children[i];
      const b = children[j];
      if (!sameStory(storyMap, a.id, b.id)) continue;
      const poseA = layout[a.id] || { x: 0, y: 0, rot: 0 };
      const poseB = layout[b.id] || { x: 0, y: 0, rot: 0 };
      const boxA = worldAabb(a, poseA);
      const boxB = worldAabb(b, poseB);
      const hit = trySnapPose(poseA, boxA, boxB, tol);
      let wallA = '';
      let wallB = '';
      if (hit.snapped && Math.hypot(hit.pose.x - (poseA.x || 0), hit.pose.y - (poseA.y || 0)) < 1e-6) {
        wallA = hit.wall;
        wallB = hit.peerWall;
      } else {
        const overlapsY = rangesOverlap(boxA.minY, boxA.maxY, boxB.minY, boxB.maxY, tol);
        const overlapsX = rangesOverlap(boxA.minX, boxA.maxX, boxB.minX, boxB.maxX, tol);
        if (overlapsY && Math.abs(boxA.maxX - boxB.minX) <= tol) {
          wallA = 'E'; wallB = 'W';
        } else if (overlapsY && Math.abs(boxA.minX - boxB.maxX) <= tol) {
          wallA = 'W'; wallB = 'E';
        } else if (overlapsX && Math.abs(boxA.maxY - boxB.minY) <= tol) {
          wallA = 'S'; wallB = 'N';
        } else if (overlapsX && Math.abs(boxA.minY - boxB.maxY) <= tol) {
          wallA = 'N'; wallB = 'S';
        } else if (overlapsX && overlapsY) {
          const ox = Math.min(boxA.maxX, boxB.maxX) - Math.max(boxA.minX, boxB.minX);
          const oy = Math.min(boxA.maxY, boxB.maxY) - Math.max(boxA.minY, boxB.minY);
          const thin = Math.max(tol * 4, 2.6);
          if (ox > 0 && oy > 0 && ox <= oy && ox <= thin) {
            wallA = boxA.minX <= boxB.minX ? 'E' : 'W';
            wallB = wallA === 'E' ? 'W' : 'E';
          } else if (ox > 0 && oy > 0 && oy <= thin) {
            wallA = boxA.minY <= boxB.minY ? 'S' : 'N';
            wallB = wallA === 'S' ? 'N' : 'S';
          }
        }
      }
      if (wallA && wallB) {
        add({
          aId: a.id,
          bId: b.id,
          wallA,
          wallB,
          edgeA: nearestEdgeForWall(a, poseA, wallA, b, poseB),
          edgeB: nearestEdgeForWall(b, poseB, wallB, a, poseA),
        });
      }

      const vertsA = worldPolygon(a, poseA);
      const vertsB = worldPolygon(b, poseB);
      const nA = vertsA.length;
      const nB = vertsB.length;
      for (let ea = 0; ea < nA; ea++) {
        const a0 = vertsA[ea];
        const a1 = vertsA[(ea + 1) % nA];
        for (let eb = 0; eb < nB; eb++) {
          const b0 = vertsB[eb];
          const b1 = vertsB[(eb + 1) % nB];
          if (!collinearOverlap(a0, a1, b0, b1, tol)) continue;
          const wallA = worldEdgeCardinal(a, poseA, ea);
          const wallB = worldEdgeCardinal(b, poseB, eb);
          if (wallA && wallB && !oppositeCardinal(wallA, wallB)) continue;
          add({
            aId: a.id,
            bId: b.id,
            wallA,
            wallB,
            edgeA: ea,
            edgeB: eb,
          });
        }
      }
    }
  }
  return pairs;
}

/** Contact pair that this room edge belongs to, if any. */
export function sharedPairForEdge(children, layout, roomId, edgeIndex, storyMap = null, tol = SUITE_CONTACT_TOL) {
  const room = (children || []).find(c => c.id === roomId);
  if (!room) return null;
  const pose = layout[roomId] || { x: 0, y: 0, rot: 0 };
  const verts = worldPolygon(room, pose);
  const n = verts.length;
  if (!n) return null;
  const i = ((Number(edgeIndex) % n) + n) % n;
  const a0 = verts[i];
  const a1 = verts[(i + 1) % n];
  const card = worldEdgeCardinal(room, pose, i);
  for (const pair of findContactingPairs(children, layout, tol, storyMap)) {
    const mine = pair.aId === roomId;
    const peerId = mine ? pair.bId : (pair.bId === roomId ? pair.aId : '');
    if (!peerId) continue;
    const myEdge = mine ? pair.edgeA : pair.edgeB;
    const myWall = mine ? pair.wallA : pair.wallB;
    if (Number.isFinite(myEdge) && myEdge === i) return pair;
    if (myWall !== card) continue;
    const peer = children.find(c => c.id === peerId);
    if (!peer) continue;
    const peerPose = layout[peerId] || { x: 0, y: 0, rot: 0 };
    const pv = worldPolygon(peer, peerPose);
    const pn = pv.length;
    const ei = mine ? pair.edgeB : pair.edgeA;
    if (!Number.isFinite(ei) || !pn) continue;
    const b0 = pv[((ei % pn) + pn) % pn];
    const b1 = pv[((((ei % pn) + pn) % pn) + 1) % pn];
    if (collinearOverlap(a0, a1, b0, b1, tol)) return pair;
  }
  return null;
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
  const p = normalizeSuitePose(pose);
  const cell = fp.grid * fp.unitPerGrid;
  const local = unrotateLocal(wx - p.x, wy - p.y, cell, cell, p.rot);
  return {
    x: cell ? local.x / cell : 0,
    y: cell ? local.y / cell : 0,
  };
}

/** Footprint normalized point → suite world. */
export function worldFromNorm(room, pose, nx, ny) {
  const fp = normalizeFootprint(room?.footprint);
  const p = normalizeSuitePose(pose);
  const cell = fp.grid * fp.unitPerGrid;
  const local = rotateLocal((Number(nx) || 0) * cell, (Number(ny) || 0) * cell, cell, cell, p.rot);
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
  const open = links.length > 0 && links.every(l => l.sharedStyle === 'open');
  const threshold = links.some(l => l.sharedStyle === 'threshold');
  return {
    style: open ? 'open' : (threshold ? 'threshold' : 'merged'),
    openings,
    links,
  };
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
  const storyMap = suiteStoryMap(null, children);
  const pairs = findContactingPairs(children, next, tol, storyMap);

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

/** Encode a world-space polygon back into footprint 0–1 + pose, keeping unselected
 *  vertices fixed in world (one-face reshape). Rotation other than 0 falls back
 *  to a simple AABB pack of the unrotated locals. */
export function packWorldPolygon(room, pose, worldVerts) {
  const fp0 = normalizeFootprint(room?.footprint);
  const p = normalizeSuitePose(pose);
  const cell0 = fp0.grid * fp0.unitPerGrid;
  const locals = (worldVerts || []).map(v =>
    unrotateLocal(v.x - p.x, v.y - p.y, cell0, cell0, p.rot));
  if (locals.length < 3) {
    return { footprint: fp0, pose: p };
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const v of locals) {
    minX = Math.min(minX, v.x);
    maxX = Math.max(maxX, v.x);
    minY = Math.min(minY, v.y);
    maxY = Math.max(maxY, v.y);
  }
  const spanX = Math.max(0.25, maxX - minX);
  const spanY = Math.max(0.25, maxY - minY);
  const span = Math.max(spanX, spanY);
  const grid = fp0.grid || 8;
  const vertices = locals.map(v => ({
    x: (v.x - minX) / span,
    y: (v.y - minY) / span,
  }));
  const origin = rotateLocal(minX, minY, spanX, spanY, p.rot);
  return {
    footprint: {
      ...fp0,
      vertices,
      unitPerGrid: span / grid,
    },
    pose: { ...p, x: p.x + origin.x, y: p.y + origin.y },
  };
}

/**
 * Move one (or several selected) faces in world space. Parallel selected
 * segments travel with the dragged edge (one side of a split wall stays
 * flush); unselected vertices stay put. `step` snaps the travel distance.
 */
export function moveFaceVerts(verts, edgeIndex, worldPoint, { allSelectedEdges = null, step = 0 } = {}) {
  const n = (verts || []).length;
  if (!n) return [];
  const next = verts.map(v => ({ x: v.x, y: v.y }));
  const primary = ((Number(edgeIndex) % n) + n) % n;
  const extra = Array.isArray(allSelectedEdges)
    ? allSelectedEdges.map(e => ((Number(e) % n) + n) % n)
    : [];
  const edges = [...new Set([primary, ...extra])];
  const snap = Number(step) > 0 ? Number(step) : 0;

  const edgeGeom = (i) => {
    const a = verts[i];
    const b = verts[(i + 1) % n];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    return { nx: -dy / len, ny: dx / len, a, b };
  };

  const g0 = edgeGeom(primary);
  const mx = (g0.a.x + g0.b.x) / 2;
  const my = (g0.a.y + g0.b.y) / 2;
  let dist = (Number(worldPoint?.x) - mx) * g0.nx + (Number(worldPoint?.y) - my) * g0.ny;
  if (snap) dist = Math.round(dist / snap) * snap;
  const tx = g0.nx * dist;
  const ty = g0.ny * dist;

  const moved = new Set();
  const apply = (i, dx, dy) => {
    if (moved.has(i)) return;
    next[i].x = verts[i].x + dx;
    next[i].y = verts[i].y + dy;
    moved.add(i);
  };

  for (const i of edges) {
    const g = edgeGeom(i);
    const parallel = (g.nx * g0.nx + g.ny * g0.ny) >= 0.7;
    if (parallel) {
      apply(i, tx, ty);
      apply((i + 1) % n, tx, ty);
      continue;
    }
    const emx = (g.a.x + g.b.x) / 2;
    const emy = (g.a.y + g.b.y) / 2;
    let ed = (Number(worldPoint?.x) - emx) * g.nx + (Number(worldPoint?.y) - emy) * g.ny;
    if (snap) ed = Math.round(ed / snap) * snap;
    apply(i, g.nx * ed, g.ny * ed);
    apply((i + 1) % n, g.nx * ed, g.ny * ed);
  }
  return next;
}

/** Edge indices on `room` that run the same direction as `edgeIndex` (one face). */
export function facingEdges(room, pose, edgeIndex) {
  const verts = worldPolygon(room, pose);
  const n = verts.length;
  if (!n) return [];
  const i0 = ((Number(edgeIndex) % n) + n) % n;
  const a = verts[i0];
  const b = verts[(i0 + 1) % n];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const out = [];
  for (let i = 0; i < n; i++) {
    const c = verts[i];
    const d = verts[(i + 1) % n];
    const ex = d.x - c.x;
    const ey = d.y - c.y;
    const el = Math.hypot(ex, ey) || 1;
    const dot = (ex / el) * ux + (ey / el) * uy;
    if (dot >= 0.92) out.push(i);
  }
  return out.length ? out : [i0];
}

/**
 * Drag one footprint edge in suite world space. Only that edge's two vertices
 * move; the rest of the room stays put in world coordinates.
 */
export function reshapeFaceWorld(room, pose, edgeIndex, worldPoint, { allSelectedEdges = null, step = 0 } = {}) {
  const p = normalizeSuitePose(pose);
  const verts = worldPolygon(room, p);
  if (!verts.length) return { footprint: normalizeFootprint(room?.footprint), pose: p };
  const next = moveFaceVerts(verts, edgeIndex, worldPoint, { allSelectedEdges, step });
  return packWorldPolygon(room, p, next);
}

function hypot2(a, b) {
  return Math.hypot((a?.x || 0) - (b?.x || 0), (a?.y || 0) - (b?.y || 0));
}

function distToSeg(p, a, b) {
  const ux = b.x - a.x;
  const uy = b.y - a.y;
  const len2 = ux * ux + uy * uy || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * ux + (p.y - a.y) * uy) / len2));
  const q = { x: a.x + ux * t, y: a.y + uy * t };
  return { dist: Math.hypot(p.x - q.x, p.y - q.y), t, q };
}

function insertPointsOnRing(ring, points, tol) {
  let next = (ring || []).map(v => ({ x: v.x, y: v.y }));
  for (const p of points || []) {
    if (next.some(v => hypot2(v, p) <= tol)) continue;
    let bestI = -1;
    let bestD = tol;
    for (let i = 0; i < next.length; i++) {
      const hit = distToSeg(p, next[i], next[(i + 1) % next.length]);
      if (hit.dist <= bestD && hit.t > 0.02 && hit.t < 0.98) {
        bestD = hit.dist;
        bestI = i;
      }
    }
    if (bestI >= 0) next.splice(bestI + 1, 0, { x: p.x, y: p.y });
  }
  return next;
}

function coincidentEdges(a0, a1, b0, b1, tol) {
  return (hypot2(a0, b0) <= tol && hypot2(a1, b1) <= tol)
    || (hypot2(a0, b1) <= tol && hypot2(a1, b0) <= tol);
}

function simplifyRing(ring, tol) {
  const pts = [];
  for (const v of ring || []) {
    const last = pts[pts.length - 1];
    if (last && hypot2(last, v) <= tol) continue;
    pts.push({ x: v.x, y: v.y });
  }
  if (pts.length >= 2 && hypot2(pts[0], pts[pts.length - 1]) <= tol) pts.pop();
  const out = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[(i + n - 1) % n];
    const b = pts[i];
    const c = pts[(i + 1) % n];
    const area = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
    if (area <= tol * 0.08 && hypot2(a, c) > tol) continue;
    out.push(b);
  }
  return out.length >= 3 ? out : pts;
}

/**
 * Outer ring of two adjacent rooms after dropping the shared wall.
 * Inserts T-junctions first so a partial shared span still leaves leftover
 * wall on the longer room.
 * @returns {{x:number,y:number}[]|null}
 */
export function unionAdjacentPolygons(vertsA, vertsB, tol = 0.45) {
  let a = (vertsA || []).map(v => ({ x: v.x, y: v.y }));
  let b = (vertsB || []).map(v => ({ x: v.x, y: v.y }));
  if (a.length < 3 || b.length < 3) return null;
  for (let k = 0; k < 8; k++) {
    const nextA = insertPointsOnRing(a, b, tol);
    const nextB = insertPointsOnRing(b, a, tol);
    if (nextA.length === a.length && nextB.length === b.length) {
      a = nextA;
      b = nextB;
      break;
    }
    a = nextA;
    b = nextB;
  }
  const edges = [];
  const pushRing = (ring) => {
    for (let i = 0; i < ring.length; i++) {
      edges.push({ a: ring[i], b: ring[(i + 1) % ring.length], used: false });
    }
  };
  pushRing(a);
  pushRing(b);
  for (let i = 0; i < edges.length; i++) {
    if (edges[i].used) continue;
    for (let j = i + 1; j < edges.length; j++) {
      if (edges[j].used) continue;
      if (coincidentEdges(edges[i].a, edges[i].b, edges[j].a, edges[j].b, tol)) {
        edges[i].used = true;
        edges[j].used = true;
        break;
      }
      if (collinearOverlap(edges[i].a, edges[i].b, edges[j].a, edges[j].b, tol)) {
        edges[i].used = true;
        edges[j].used = true;
        break;
      }
    }
  }
  const live = edges.filter(e => !e.used);
  if (live.length < 3) return null;
  const unused = live.map(e => ({ a: e.a, b: e.b }));
  const ring = [{ x: unused[0].a.x, y: unused[0].a.y }];
  let end = unused[0].b;
  unused.shift();
  for (let guard = 0; guard < live.length + 4; guard++) {
    if (hypot2(end, ring[0]) <= tol && ring.length >= 3) break;
    let idx = unused.findIndex(e => hypot2(e.a, end) <= tol);
    let rev = false;
    if (idx < 0) {
      idx = unused.findIndex(e => hypot2(e.b, end) <= tol);
      rev = true;
    }
    if (idx < 0) break;
    const e = unused.splice(idx, 1)[0];
    ring.push({ x: end.x, y: end.y });
    end = rev ? e.a : e.b;
  }
  if (ring.length < 3) return null;
  return simplifyRing(ring, tol);
}

/**
 * T-junctions: a corner of one room sitting on another room's edge.
 * @returns {{ roomId: string, edgeIndex: number, t: number }[]}
 */
export function findCornerJunctions(children, layout, tol = SUITE_SNAP_TOL) {
  const hits = [];
  const list = Array.isArray(children) ? children : [];
  for (const host of list) {
    const poseH = layout[host.id] || { x: 0, y: 0, rot: 0 };
    const hv = worldPolygon(host, poseH);
    const nH = hv.length;
    for (let ei = 0; ei < nH; ei++) {
      const a = hv[ei];
      const b = hv[(ei + 1) % nH];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy || 1;
      const len = Math.sqrt(len2);
      for (const other of list) {
        if (other.id === host.id) continue;
        const poseO = layout[other.id] || { x: 0, y: 0, rot: 0 };
        for (const v of worldPolygon(other, poseO)) {
          const t = ((v.x - a.x) * dx + (v.y - a.y) * dy) / len2;
          if (t < 0.08 || t > 0.92) continue;
          const dist = Math.abs((v.x - a.x) * dy - (v.y - a.y) * dx) / len;
          if (dist > Math.max(tol, 1.6)) continue;
          hits.push({ roomId: host.id, edgeIndex: ei, t });
        }
      }
    }
  }
  const uniq = [];
  const seen = new Set();
  for (const h of hits) {
    const key = `${h.roomId}:${h.edgeIndex}:${h.t.toFixed(2)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push(h);
  }
  return uniq;
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

    // Overlapping / coincident walls (not merely AABB-touching) still count as shared.
    const c = { id: 'c', footprint: { ...fp, vertices: fp.vertices.map(v => ({ ...v })) } };
    const d = { id: 'd', footprint: { ...fp, vertices: fp.vertices.map(v => ({ ...v })) } };
    const stacked = {
      c: { x: 0, y: 0, rot: 0 },
      d: { x: 15.2, y: 2, rot: 0 },
    };
    const overlapPairs = findContactingPairs([c, d], stacked, 0.5);
    if (!overlapPairs.some(p => (p.aId === 'c' && p.bId === 'd') || (p.aId === 'd' && p.bId === 'c'))) {
      return 'overlapping walls should still form a shared pair';
    }

    // Visible gap (closet/storage double-wall) still counts as shared.
    const e = { id: 'e', footprint: { ...fp, vertices: fp.vertices.map(v => ({ ...v })) } };
    const f = { id: 'f', footprint: { ...fp, vertices: fp.vertices.map(v => ({ ...v })) } };
    const gapped = { e: { x: 0, y: 0, rot: 0 }, f: { x: 16.8, y: 0, rot: 0 } };
    const gapPairs = findContactingPairs([e, f], gapped);
    if (!gapPairs.length) return 'gapped facing walls should still form a shared pair';

    // One-face reshape must keep the opposite wall fixed in world space.
    const room = { id: 'r', footprint: { ...fp, vertices: fp.vertices.map(v => ({ ...v })) } };
    const pose0 = { x: 4, y: 3, rot: 0 };
    const before = worldPolygon(room, pose0);
    const westX = Math.min(...before.map(v => v.x));
    const eastEdge = 1;
    const packed = reshapeFaceWorld(room, pose0, eastEdge, { x: 28, y: 3 });
    const after = worldPolygon({ ...room, footprint: packed.footprint }, packed.pose);
    const westAfter = Math.min(...after.map(v => v.x));
    if (Math.abs(westAfter - westX) > 0.08) {
      return `one-face reshape moved the opposite wall (${westX.toFixed(3)} → ${westAfter.toFixed(3)})`;
    }
    const eastAfter = Math.max(...after.map(v => v.x));
    if (eastAfter < 27.5) return `one-face reshape did not extend the dragged wall (got ${eastAfter.toFixed(3)})`;

    // Split east wall into two segments — both should travel together.
    const splitFp = {
      ...fp,
      vertices: [
        { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 0.5 }, { x: 1, y: 1 }, { x: 0, y: 1 },
      ],
    };
    const splitRoom = { id: 's', footprint: splitFp };
    const splitPose = { x: 0, y: 0, rot: 0 };
    const splitVerts = worldPolygon(splitRoom, splitPose);
    const face = facingEdges(splitRoom, splitPose, 1);
    if (face.length < 2) return 'split east wall should yield two facing segments';
    const moved = moveFaceVerts(splitVerts, 1, { x: 24, y: 8 }, { allSelectedEdges: face });
    const westStay = Math.min(...moved.map(v => v.x));
    const eastGo = Math.max(...moved.map(v => v.x));
    if (Math.abs(westStay - Math.min(...splitVerts.map(v => v.x))) > 0.08) {
      return 'multi-segment reshape moved the west wall';
    }
    if (eastGo < 23.5) return `multi-segment reshape did not extend both east segments (got ${eastGo.toFixed(3)})`;

    const ua = [
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 8 }, { x: 0, y: 8 },
    ];
    const ub = [
      { x: 10, y: 0 }, { x: 18, y: 0 }, { x: 18, y: 8 }, { x: 10, y: 8 },
    ];
    const fused = unionAdjacentPolygons(ua, ub, 0.2);
    if (!fused || fused.length < 4) return 'adjacent rooms should fuse into one ring';
    const xs = fused.map(v => v.x);
    const ys = fused.map(v => v.y);
    if (Math.min(...xs) > 0.2 || Math.max(...xs) < 17.8) return 'fused ring should span both rooms in x';
    if (Math.min(...ys) > 0.2 || Math.max(...ys) < 7.8) return 'fused ring should keep room height';
    return '';
  } catch (err) {
    return String(err?.message || err);
  }
}
