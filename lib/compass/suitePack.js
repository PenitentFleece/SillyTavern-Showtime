// Pack suite children from an adjacency graph (no CAD). Poses are world units.

import { estimateFootprintScale, OPPOSITE_WALL, defaultFootprint } from './schema.js';
import { canonicalizeListingCode } from './listing.js';
import { worldAabb, SUITE_CONTACT_TOL } from './suiteLayout.js';

const SIZE_META = Object.freeze({
  L: { grid: 8, unitPerGrid: 2 },
  M: { grid: 6, unitPerGrid: 2 },
  S: { grid: 4, unitPerGrid: 2 },
});

const SQUARE = Object.freeze([
  { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 },
]);

/** Rectangle footprint in 0–1 space; listing `hall` is a long thin bar. */
export function footprintForListing(listing, size = 'M') {
  const code = canonicalizeListingCode(listing);
  if (code === 'hall') {
    return {
      vertices: [
        { x: 0, y: 0.35 }, { x: 1, y: 0.35 }, { x: 1, y: 0.65 }, { x: 0, y: 0.65 },
      ],
      grid: 10,
      unitPerGrid: 2,
      unitLabel: 'ft',
    };
  }
  const sz = (code === 'bath' || code === 'util') ? SIZE_META.S : (SIZE_META[size] || SIZE_META.M);
  return {
    vertices: SQUARE.map(v => ({ ...v })),
    grid: sz.grid,
    unitPerGrid: sz.unitPerGrid,
    unitLabel: 'ft',
  };
}

function dims(room) {
  const scale = estimateFootprintScale(room?.footprint || defaultFootprint());
  return { w: scale.w, h: scale.h };
}

function attachPose(anchor, wall, child) {
  const a = dims(anchor.room);
  const b = dims(child);
  const x = Number(anchor.pose.x) || 0;
  const y = Number(anchor.pose.y) || 0;
  if (wall === 'E') return { x: x + a.w, y, rot: 0 };
  if (wall === 'W') return { x: x - b.w, y, rot: 0 };
  if (wall === 'S') return { x, y: y + a.h, rot: 0 };
  if (wall === 'N') return { x, y: y - b.h, rot: 0 };
  return { x: x + a.w, y, rot: 0 };
}

function contacts(roomA, poseA, roomB, poseB, wallA) {
  const boxA = worldAabb(roomA, poseA);
  const boxB = worldAabb(roomB, poseB);
  const tol = SUITE_CONTACT_TOL;
  const overlapY = !(boxA.maxY < boxB.minY - tol || boxA.minY > boxB.maxY + tol);
  const overlapX = !(boxA.maxX < boxB.minX - tol || boxA.minX > boxB.maxX + tol);
  if (wallA === 'E') return overlapY && Math.abs(boxA.maxX - boxB.minX) <= tol;
  if (wallA === 'W') return overlapY && Math.abs(boxA.minX - boxB.maxX) <= tol;
  if (wallA === 'S') return overlapX && Math.abs(boxA.maxY - boxB.minY) <= tol;
  if (wallA === 'N') return overlapX && Math.abs(boxA.minY - boxB.maxY) <= tol;
  return false;
}

function boxesOverlapInterior(boxA, boxB, tol = SUITE_CONTACT_TOL) {
  const ox = Math.min(boxA.maxX, boxB.maxX) - Math.max(boxA.minX, boxB.minX);
  const oy = Math.min(boxA.maxY, boxB.maxY) - Math.max(boxA.minY, boxB.minY);
  return ox > tol && oy > tol;
}

function overlapsPlaced(room, pose, byKey, layout) {
  const box = worldAabb(room, pose);
  const myStory = Number(room.story) || 0;
  for (const [k, otherPose] of Object.entries(layout)) {
    if (!otherPose || k === room.key) continue;
    const other = byKey.get(k);
    if (!other) continue;
    if ((Number(other.story) || 0) !== myStory) continue;
    if (boxesOverlapInterior(box, worldAabb(other, otherPose))) return true;
  }
  return false;
}

function attachPoseNonOverlapping(anchor, wall, child, byKey, layout) {
  const base = attachPose(anchor, wall, child);
  if (!overlapsPlaced(child, base, byKey, layout)) return base;
  const offsets = [];
  for (let d = 2; d <= 36; d += 2) {
    offsets.push(d, -d);
  }
  // 1) Slide along the requested wall while maintaining contact with anchor
  for (const off of offsets) {
    const cand = (wall === 'E' || wall === 'W')
      ? { x: base.x, y: base.y + off, rot: 0 }
      : { x: base.x + off, y: base.y, rot: 0 };
    if (!overlapsPlaced(child, cand, byKey, layout) && contacts(anchor.room, anchor.pose, child, cand, wall)) {
      return cand;
    }
  }
  // 2) Try other walls of the anchor while maintaining contact
  for (const altWall of ['E', 'S', 'N', 'W']) {
    if (altWall === wall) continue;
    const altBase = attachPose(anchor, altWall, child);
    if (!overlapsPlaced(child, altBase, byKey, layout)) return altBase;
    for (const off of offsets) {
      const cand = (altWall === 'E' || altWall === 'W')
        ? { x: altBase.x, y: altBase.y + off, rot: 0 }
        : { x: altBase.x + off, y: altBase.y, rot: 0 };
      if (!overlapsPlaced(child, cand, byKey, layout) && contacts(anchor.room, anchor.pose, child, cand, altWall)) {
        return cand;
      }
    }
  }
  // 3) Fallback: slide along the wall line until non-overlapping
  for (const off of offsets) {
    const cand = (wall === 'E' || wall === 'W')
      ? { x: base.x, y: base.y + off, rot: 0 }
      : { x: base.x + off, y: base.y, rot: 0 };
    if (!overlapsPlaced(child, cand, byKey, layout)) return cand;
  }
  return base;
}

/**
 * Place rooms so named walls touch. `rooms` are { key, listing, size, footprint? }.
 * @returns {{ layout: object, ok: boolean }}
 */
export function packFromAdjacency(rooms = [], adjacencies = []) {
  const list = (rooms || []).map((r, i) => {
    const key = String(r.key || r.id || i);
    const footprint = r.footprint || footprintForListing(r.listing, r.size);
    return { ...r, key, footprint, id: r.id || key };
  });
  const byKey = new Map(list.map(r => [r.key, r]));
  const layout = {};
  let ok = true;
  const stories = [...new Set(list.map(r => Number(r.story) || 0))];
  for (const st of stories) {
    const onStory = list.filter(r => (Number(r.story) || 0) === st);
    const seed = onStory.find(r => r.listing === 'lr')
      || onStory.find(r => r.listing === 'hall')
      || onStory[0];
    if (seed) layout[seed.key] = { x: 0, y: 0, rot: 0 };
  }
  if (!Object.keys(layout).length) return { layout, ok: false };

  const edges = (adjacencies || []).map(a => ({
    a: String(a.a || '').trim(),
    b: String(a.b || '').trim(),
    wall: String(a.wall || 'E').trim().toUpperCase(),
  })).filter(e => {
    if (!byKey.has(e.a) || !byKey.has(e.b) || e.a === e.b) return false;
    return (Number(byKey.get(e.a)?.story) || 0) === (Number(byKey.get(e.b)?.story) || 0);
  });

  let changed = true;
  let guard = 0;
  while (changed && guard++ < 48) {
    changed = false;
    for (const e of edges) {
      const wall = /^(N|E|S|W)$/.test(e.wall) ? e.wall : 'E';
      if (layout[e.a] && !layout[e.b]) {
        layout[e.b] = attachPoseNonOverlapping({ room: byKey.get(e.a), pose: layout[e.a] }, wall, byKey.get(e.b), byKey, layout);
        changed = true;
      } else if (layout[e.b] && !layout[e.a]) {
        const opp = OPPOSITE_WALL[wall] || 'W';
        layout[e.a] = attachPoseNonOverlapping({ room: byKey.get(e.b), pose: layout[e.b] }, opp, byKey.get(e.a), byKey, layout);
        changed = true;
      } else if (layout[e.a] && layout[e.b]) {
        if (!contacts(byKey.get(e.a), layout[e.a], byKey.get(e.b), layout[e.b], wall)) ok = false;
      }
    }
  }

  const cursorXByStory = {};
  for (const r of list) {
    const st = Number(r.story) || 0;
    const cur = cursorXByStory[st] || 0;
    if (layout[r.key]) {
      const box = worldAabb(r, layout[r.key]);
      cursorXByStory[st] = Math.max(cur, box.maxX + 0.5);
      continue;
    }
    layout[r.key] = { x: cur, y: 0, rot: 0 };
    cursorXByStory[st] = cur + dims(r).w + 0.5;
    ok = false;
  }
  return { layout, ok };
}

export function smokeSuitePackPure() {
  try {
    const main = { key: 'main', listing: 'lr', size: 'L', footprint: footprintForListing('lr', 'L') };
    const bath = { key: 'bath', listing: 'bath', size: 'S', footprint: footprintForListing('bath', 'S') };
    const packed = packFromAdjacency([main, bath], [{ a: 'main', b: 'bath', wall: 'E' }]);
    if (!packed.layout.main || !packed.layout.bath) return 'pack missing poses';
    if (!packed.ok) return 'pack graph should succeed';
    const boxA = worldAabb(main, packed.layout.main);
    const boxB = worldAabb(bath, packed.layout.bath);
    if (Math.abs(boxA.maxX - boxB.minX) > SUITE_CONTACT_TOL) {
      return `E/W contact ${boxA.maxX} ${boxB.minX}`;
    }
    const hall = footprintForListing('hall');
    const hs = estimateFootprintScale(hall);
    if (!(hs.w > hs.h * 1.5)) return `hall should be long (${hs.w}x${hs.h})`;
    return '';
  } catch (err) {
    return err?.message || String(err);
  }
}
