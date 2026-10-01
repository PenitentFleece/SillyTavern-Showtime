// Room Compass — deterministic floorplan / Set audit (no LLM).

import {
  OPPOSITE_WALL,
  WALL_EDGE_CELLS,
  estimateFootprintScale,
  isLoadableKind,
  isSuiteHostKind,
  isVerticalOpeningType,
  normalizeFootprint,
  normalizeRoom,
} from './schema.js';
import { edgeCardinal, edgeCount } from './floorplan.js';
import {
  findContactingPairs,
  listSuiteChildren,
  suiteStoryMap,
  worldAabb,
} from './suiteLayout.js';
import { getPlace, setLinkExternal } from './state.js';

const EXIT_RE = /\b(exit|outside|street|outdoors?|exterior|way out)\b/i;
const TRAVEL_OPENINGS = new Set(['door', 'arch', 'passage', 'ascent', 'descent']);

function finding({
  id,
  severity = 'warn',
  placeId = '',
  placeName = '',
  title,
  hint,
  fix = null,
}) {
  return {
    id: String(id || title || 'issue'),
    severity,
    placeId,
    placeName,
    title: String(title || '').trim(),
    hint: String(hint || '').trim(),
    fix: fix && typeof fix === 'object' ? fix : null,
  };
}

function shoelaceArea01(footprint) {
  const fp = normalizeFootprint(footprint);
  const v = fp.vertices || [];
  if (v.length < 3) return 0;
  let a = 0;
  for (let i = 0; i < v.length; i++) {
    const j = (i + 1) % v.length;
    a += v[i].x * v[j].y - v[j].x * v[i].y;
  }
  return Math.abs(a) / 2;
}

function aabbInteriorOverlap(a, b, tol = 0.2) {
  const ox = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
  const oy = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
  return ox > tol && oy > tol;
}

function travelOpenings(room) {
  const rows = [];
  for (const link of room?.links || []) {
    for (const op of link.openings || []) {
      rows.push({ link, op });
    }
  }
  return rows;
}

function hasTravelEgress(room) {
  return travelOpenings(room).some(({ link, op }) => {
    if (!op.travel || op.locked) return false;
    if (!TRAVEL_OPENINGS.has(op.type) && op.type !== 'hole') return false;
    return !!(link.toPlaceId || link.external);
  });
}

function neighborOf(compass, link) {
  const id = String(link?.toPlaceId || '').trim();
  if (!id) return null;
  return compass?.rooms?.[id] || null;
}

function reciprocalLink(from, to, wall) {
  const opp = OPPOSITE_WALL[wall] || '';
  return (to?.links || []).find(l =>
    l.toPlaceId === from.id && (!opp || l.wall === opp || !l.wall));
}

function auditPlace(compass, room, ctx) {
  const out = [];
  if (!room?.id) return out;
  const placeId = room.id;
  const placeName = room.name || room.id;
  const fp = normalizeFootprint(room.footprint);
  const nEdge = edgeCount(fp);
  const area01 = shoelaceArea01(fp);
  const scale = estimateFootprintScale(fp);
  const areaUnits = Math.max(0.01, scale.w * scale.h);

  if (isLoadableKind(room.kind) || room.kind === 'unit') {
    if (area01 < 1e-6) {
      out.push(finding({
        id: `zero-area:${placeId}`,
        severity: 'error',
        placeId,
        placeName,
        title: 'Zero-area footprint',
        hint: 'Drag vertices so the plan encloses a real floor — a collapsed polygon cannot host doors or areas.',
      }));
    } else if (area01 < 0.02 || areaUnits < 4) {
      out.push(finding({
        id: `tiny:${placeId}`,
        severity: 'warn',
        placeId,
        placeName,
        title: `Tiny footprint (~${trimNum(scale.w)} × ${trimNum(scale.h)} ${scale.unitLabel})`,
        hint: 'Scale the room up, or check grid units — this is smaller than a closet next to typical siblings.',
      }));
    }
  }

  const seenLinkIds = new Set();
  for (const link of room.links || []) {
    if (!link?.id) continue;
    if (seenLinkIds.has(link.id)) {
      out.push(finding({
        id: `dup-link:${placeId}:${link.id}`,
        severity: 'warn',
        placeId,
        placeName,
        title: 'Duplicate wall link id',
        hint: 'Unlink the extra copy so openings are not attached twice.',
      }));
    }
    seenLinkIds.add(link.id);

    const wall = String(link.wall || '');
    const edge = link.edge;
    const neighbor = neighborOf(compass, link);
    const openings = link.openings || [];
    const travelDoor = openings.some(op =>
      op.travel && (op.type === 'door' || op.type === 'arch' || op.type === 'passage'));

    if (edge != null && edge !== '' && wall && wall !== 'above' && wall !== 'below') {
      try {
        const card = edgeCardinal(fp, Number(edge));
        if (card && card !== wall) {
          out.push(finding({
            id: `edge-card:${placeId}:${link.id}`,
            severity: 'warn',
            placeId,
            placeName,
            title: `Wall ${wall} vs edge ${edge} (${card})`,
            hint: 'North-label does not match this segment’s geometry. Re-link the wall or split it so the cardinal matches the edge.',
          }));
        }
        if (Number(edge) >= nEdge) {
          out.push(finding({
            id: `orphan-edge:${placeId}:${link.id}`,
            severity: 'error',
            placeId,
            placeName,
            title: `Link points at missing wall ${edge}`,
            hint: 'This opening’s edge index is past the footprint. Unlink and re-select the wall on the plan.',
          }));
        }
      } catch { /* skip */ }
    }

    if (link.toPlaceId && !neighbor) {
      out.push(finding({
        id: `missing-neighbor:${placeId}:${link.id}`,
        severity: 'error',
        placeId,
        placeName,
        title: `Opens toward missing place “${link.toPlaceId}”`,
        hint: 'The neighbor was deleted or never created. Unlink, or pick a living sibling under the same parent.',
      }));
    }

    if (neighbor && wall && wall !== 'above' && wall !== 'below') {
      const rec = reciprocalLink(room, neighbor, wall);
      if (!rec) {
        out.push(finding({
          id: `no-recip:${placeId}:${link.id}`,
          severity: 'warn',
          placeId,
          placeName,
          title: `No return link from ${neighbor.name}`,
          hint: `Link ${neighbor.name}’s ${OPPOSITE_WALL[wall] || 'opposite'} wall back to ${placeName} so travel is two-way.`,
        }));
      } else if (rec.wall && OPPOSITE_WALL[wall] && rec.wall !== OPPOSITE_WALL[wall]
        && rec.wall !== 'above' && rec.wall !== 'below') {
        out.push(finding({
          id: `wrong-shared:${placeId}:${link.id}`,
          severity: 'warn',
          placeId,
          placeName,
          title: `Shared wall mismatch with ${neighbor.name}`,
          hint: `${placeName} ${wall} should meet ${neighbor.name} ${OPPOSITE_WALL[wall]}, not ${rec.wall}.`,
        }));
      }
    }

    if (!link.toPlaceId && !link.external && !openings.length) {
      out.push(finding({
        id: `orphan-link:${placeId}:${link.id}`,
        severity: 'info',
        placeId,
        placeName,
        title: `Empty ${wall || `edge ${edge}`} link`,
        hint: 'No neighbor, no exterior flag, no openings. Mark external, pick a sibling, or unlink.',
      }));
    }

    for (const op of openings) {
      if (op.cell && wall && WALL_EDGE_CELLS[wall] && !WALL_EDGE_CELLS[wall].includes(op.cell)) {
        out.push(finding({
          id: `cell-wall:${placeId}:${op.id}`,
          severity: 'warn',
          placeId,
          placeName,
          title: `${op.type} in ${op.cell} on ${wall} wall`,
          hint: `Move the opening to an edge cell (${WALL_EDGE_CELLS[wall].join(', ')}) or change the wall.`,
        }));
      }

      const vertical = isVerticalOpeningType(op.type);
      if (vertical) {
        if (wall !== 'above' && wall !== 'below') {
          out.push(finding({
            id: `vert-wall:${placeId}:${op.id}`,
            severity: 'warn',
            placeId,
            placeName,
            title: `${op.type} is not on a floor/ceiling`,
            hint: 'Place ascent/descent on the above or below link so the stair has a vertical direction.',
          }));
        }
        if ((op.type === 'ascent' && wall === 'below') || (op.type === 'descent' && wall === 'above')) {
          out.push(finding({
            id: `vert-dir:${placeId}:${op.id}`,
            severity: 'warn',
            placeId,
            placeName,
            title: `${op.type} faces the wrong slab (${wall})`,
            hint: 'Ascent belongs on above; descent on below — or swap the opening type.',
          }));
        }
        if (!link.toPlaceId) {
          out.push(finding({
            id: `vert-target:${placeId}:${op.id}`,
            severity: 'warn',
            placeId,
            placeName,
            title: `${op.type} has no vertical target`,
            hint: 'Link above/below to the room this stair actually reaches.',
          }));
        }
      }

      if (travelDoor && !link.toPlaceId && !link.external) {
        out.push(finding({
          id: `ext-door:${placeId}:${op.id}`,
          severity: 'warn',
          placeId,
          placeName,
          title: `${op.label || op.type} sits on an unlinked wall`,
          hint: 'Treat this as a way in/out: mark the wall external, or pick the neighboring room.',
          fix: { type: 'mark-external', placeId, linkId: link.id },
        }));
      }

      if (op.travel && EXIT_RE.test(`${op.label} ${op.description}`) && link.toPlaceId && !link.external) {
        out.push(finding({
          id: `false-exit:${placeId}:${op.id}`,
          severity: 'warn',
          placeId,
          placeName,
          title: `${op.label || op.type} claims to be an exit but leads inside`,
          hint: `It opens to ${neighbor?.name || link.toPlaceId}. Rename it, or mark the wall external if this really leaves the building.`,
        }));
      }

      if (op.type === 'window' && !link.toPlaceId && !link.external) {
        out.push(finding({
          id: `ext-window:${placeId}:${op.id}`,
          severity: 'info',
          placeId,
          placeName,
          title: 'Window on an unlinked wall',
          hint: 'Mark the wall external if it faces outdoors; otherwise pick the room on the other side of the glass.',
          fix: { type: 'mark-external', placeId, linkId: link.id },
        }));
      }
    }

    if (link.sharedStyle === 'threshold') {
      const hasGap = openings.some(op =>
        op.type === 'door' || op.type === 'arch' || op.type === 'passage' || op.type === 'hole');
      if (!hasGap && !openings.length) {
        out.push(finding({
          id: `threshold-empty:${placeId}:${link.id}`,
          severity: 'warn',
          placeId,
          placeName,
          title: `Threshold on ${wall || 'wall'} has no opening`,
          hint: 'Add a door, arch, or passage — or switch the shared wall back to merged.',
        }));
      }
    }
  }

  if (isLoadableKind(room.kind)) {
    const parent = room.parentId ? getPlace(compass, room.parentId) : null;
    const inSuite = isSuiteHostKind(parent?.kind);
    if (!inSuite && !hasTravelEgress(room) && !room.exposed) {
      out.push(finding({
        id: `no-egress:${placeId}`,
        severity: 'warn',
        placeId,
        placeName,
        title: 'No way in or out',
        hint: 'Add a door on an exterior wall (Mark external) or link a sibling so the room is not a sealed box.',
      }));
    }
  }

  ctx.scales.push({ placeId, placeName, area: areaUnits, parentId: room.parentId || '' });
  return out;
}

function auditSuite(compass, unit, ctx) {
  const out = [];
  const children = listSuiteChildren(compass, unit.id);
  if (children.length < 2) return out;
  const layout = unit.suiteLayout || {};
  const storyMap = suiteStoryMap(compass, children);
  const pairs = findContactingPairs(children, layout, undefined, storyMap);
  const contact = new Map(children.map(c => [c.id, new Set()]));
  for (const p of pairs) {
    contact.get(p.aId)?.add(p.bId);
    contact.get(p.bId)?.add(p.aId);
  }

  for (let i = 0; i < children.length; i++) {
    for (let j = i + 1; j < children.length; j++) {
      const a = children[i];
      const b = children[j];
      const boxA = worldAabb(a, layout[a.id] || { x: 0, y: 0, rot: 0 });
      const boxB = worldAabb(b, layout[b.id] || { x: 0, y: 0, rot: 0 });
      if (aabbInteriorOverlap(boxA, boxB)) {
        const storyA = Number(storyMap[a.id]) || 0;
        const storyB = Number(storyMap[b.id]) || 0;
        if (storyA !== storyB) continue;
        out.push(finding({
          id: `overlap:${a.id}:${b.id}`,
          severity: 'error',
          placeId: unit.id,
          placeName: unit.name,
          title: `${a.name} overlaps ${b.name}`,
          hint: 'Nudge a room in Arrange so footprints share an edge instead of occupying the same floor.',
        }));
      }
    }
  }

  const areas = children.map(c => {
    const s = estimateFootprintScale(c.footprint);
    return { id: c.id, name: c.name, area: Math.max(0.01, s.w * s.h) };
  });
  const sorted = [...areas].sort((a, b) => a.area - b.area);
  const median = sorted[Math.floor(sorted.length / 2)]?.area || 1;
  for (const row of areas) {
    if (row.area > median * 10) {
      out.push(finding({
        id: `huge:${row.id}`,
        severity: 'info',
        placeId: row.id,
        placeName: row.name,
        title: `${row.name} is huge vs its suite`,
        hint: 'Check grid units — this room’s footprint is more than 10× the suite median.',
      }));
    } else if (row.area < median / 10 && median > 8) {
      out.push(finding({
        id: `speck:${row.id}`,
        severity: 'info',
        placeId: row.id,
        placeName: row.name,
        title: `${row.name} is tiny vs its suite`,
        hint: 'Scale it up, or confirm it is meant to be a closet / alcove.',
      }));
    }
  }

  for (const child of children) {
    const peers = contact.get(child.id) || new Set();
    const egress = hasTravelEgress(child);
    if (peers.size <= 1 && !egress) {
      out.push(finding({
        id: `deadend:${child.id}`,
        severity: 'warn',
        placeId: child.id,
        placeName: child.name,
        title: `${child.name} is a dead-end with no opening`,
        hint: peers.size
          ? 'Put a door or threshold on the shared wall, or an exterior door on a free wall.'
          : 'Snap this room to a sibling or add an exterior door — it has no egress.',
      }));
    }
  }

  ctx.suites.push(unit.id);
  return out;
}

function trimNum(n) {
  const x = Math.round(Number(n) * 100) / 100;
  return Number.isInteger(x) ? String(x) : String(x);
}

/**
 * Heuristic sensibility check for the current compass.
 * @param {object} compass
 * @param {{ focusId?: string }} [opts]
 * @returns {{ findings: object[], counts: { error: number, warn: number, info: number } }}
 */
export function auditCompass(compass, { focusId = '' } = {}) {
  const findings = [];
  const ctx = { scales: [], suites: [] };
  const rooms = Object.values(compass?.rooms || {});
  const focus = focusId ? rooms.find(r => r.id === focusId) : null;
  const ordered = focus
    ? [focus, ...rooms.filter(r => r.id !== focus.id && (r.parentId === focus.id || r.parentId === focus.parentId || r.id === focus.parentId))]
    : rooms;

  const seen = new Set();
  for (const room of ordered) {
    if (!room?.id || seen.has(room.id)) continue;
    seen.add(room.id);
    findings.push(...auditPlace(compass, room, ctx));
    if (isSuiteHostKind(room.kind)) findings.push(...auditSuite(compass, room, ctx));
  }
  for (const room of rooms) {
    if (seen.has(room.id)) continue;
    seen.add(room.id);
    findings.push(...auditPlace(compass, room, ctx));
    if (isSuiteHostKind(room.kind)) findings.push(...auditSuite(compass, room, ctx));
  }

  const rank = { error: 0, warn: 1, info: 2 };
  findings.sort((a, b) => (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9)
    || String(a.placeName).localeCompare(String(b.placeName))
    || String(a.title).localeCompare(String(b.title)));

  const counts = { error: 0, warn: 0, info: 0 };
  for (const f of findings) {
    if (counts[f.severity] != null) counts[f.severity] += 1;
  }
  return { findings, counts };
}

/** Apply only unambiguous safe fixes (currently: mark unlinked door walls external). */
export function applySafeAuditFixes(compass, findings = []) {
  let n = 0;
  const seen = new Set();
  for (const f of findings) {
    if (f?.fix?.type !== 'mark-external') continue;
    const key = `${f.fix.placeId}:${f.fix.linkId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      setLinkExternal(compass, f.fix.placeId, f.fix.linkId, true);
      n += 1;
    } catch { /* skip */ }
  }
  return n;
}

/** Lightweight pure checks (no storage / DOM). Returns '' on success. */
export function smokeCompassAuditPure() {
  try {
    const kitchen = normalizeRoom({
      id: 'kitchen',
      name: 'Kitchen',
      kind: 'room',
      links: [{
        id: 'lnk1',
        wall: 'N',
        edge: 0,
        toPlaceId: '',
        external: false,
        openings: [{ id: 'op1', type: 'door', cell: 'N', travel: true, label: 'front door' }],
      }],
    });
    const sealed = normalizeRoom({ id: 'vault', name: 'Vault', kind: 'room' });
    const compass = { rooms: { kitchen, vault: sealed }, activeRoomId: 'kitchen' };
    const { findings } = auditCompass(compass, { focusId: 'kitchen' });
    if (!findings.some(f => f.id.startsWith('ext-door:'))) return 'external door not flagged';
    if (!findings.some(f => f.fix?.type === 'mark-external')) return 'missing safe fix';
    if (!findings.some(f => f.id.startsWith('no-egress:'))) return 'sealed room not flagged';
    const n = applySafeAuditFixes(compass, findings);
    if (n < 1) return 'safe fix applied none';
    if (!compass.rooms.kitchen.links[0].external) return 'external flag not set';
    const again = auditCompass(compass, { focusId: 'kitchen' });
    if (again.findings.some(f => f.id.startsWith('ext-door:'))) return 'external door still flagged after fix';
    return '';
  } catch (err) {
    return String(err?.message || err);
  }
}
