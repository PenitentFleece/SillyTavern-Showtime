// Room Compass — sonar pings (last-known narrative position) + area access.

import { CELLS, CELL_ROWS, normalizeCell, listCellPieces, placeMatchesLocationTags, isLoadableKind, GEO_PLACE_KIND_SET } from './schema.js';
import { canSeeArea } from './barriers.js';
import { collectActiveLocationTags, getPlace } from './state.js';
import { formatSceneLocation, locationKeyRank, findLocationNodeByName } from '../locationCatalog.js';

/** Offsets for the 8 neighbors around a compass area. */
const NEIGHBOR_DELTA = Object.freeze([
  [-1, -1], [0, -1], [1, -1],
  [-1, 0],           [1, 0],
  [-1, 1],  [0, 1],  [1, 1],
]);

function cellOffset(cellId) {
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      if (CELL_ROWS[row][col] === cellId) return { col, row };
    }
  }
  return { col: 1, row: 1 };
}

function offsetToCell(col, row) {
  if (row < 0 || row > 2 || col < 0 || col > 2) return null;
  return CELL_ROWS[row][col];
}

/** Orthogonal + diagonal neighbors of an area. */
export function adjacentAreas(cellId) {
  let at;
  try { at = normalizeCell(cellId); } catch { return []; }
  const { col, row } = cellOffset(at);
  const out = [];
  for (const [dc, dr] of NEIGHBOR_DELTA) {
    const id = offsetToCell(col + dc, row + dr);
    if (id) out.push(id);
  }
  return out;
}

/**
 * Areas a character can see / reasonably interact with from `cellId`.
 * @param {string} cellId
 * @param {object} room
 * @param {{ reach?: 'adjacent'|'room'|'adjacent_rooms' }} [opts]
 */
export function accessibleAreas(cellId, room, { reach = 'adjacent' } = {}) {
  let at;
  try { at = normalizeCell(cellId); } catch { return ['C']; }
  // 'adjacent_rooms' is a superset of 'room' within THIS room's own 9 cells
  // (full room, no wall gating) — what it adds on top is neighbor-room
  // peeks through openings, handled separately in formatPovBlock().
  if (reach === 'room' || reach === 'adjacent_rooms') {
    return [...CELLS];
  }
  const out = [at];
  for (const n of adjacentAreas(at)) {
    if (canSeeArea(at, n, room)) out.push(n);
  }
  return out;
}

export function isAreaAccessible(fromCell, toCell, room) {
  return accessibleAreas(fromCell, room).includes(
    (() => { try { return normalizeCell(toCell); } catch { return ''; } })(),
  );
}

/** Pieces in one area (for Set UI lists). */
export function listAreaContents(room, cellId) {
  let id;
  try { id = normalizeCell(cellId); } catch { return []; }
  return listCellPieces(room?.cells?.[id], { room, cellId: id });
}

function rankForKey(key, place, storage) {
  if (place?.kind) return locationKeyRank(place.kind);
  try {
    const node = findLocationNodeByName(storage, key);
    if (node?.kind) return locationKeyRank(node.kind);
  } catch { /* ignore */ }
  return 1;
}

function betterPing(cand, current) {
  if (!current) return true;
  if ((cand.rank || 1) !== (current.rank || 1)) return (cand.rank || 1) > (current.rank || 1);
  if (cand.key.length !== current.key.length) return cand.key.length > current.key.length;
  return cand.idx >= current.idx;
}

/**
 * Find the last location-key mention in recent chat. Prefers building/city
 * over country so "Fukuoka" beats "Japan" when both appear.
 * @returns {{ key: string, placeId: string } | null}
 */
export function resolveLastLocationPing(compass, storage, chatMessages = null) {
  const known = collectActiveLocationTags(storage);
  const rooms = Object.values(compass?.rooms || {});
  const placeKeys = [];
  for (const place of rooms) {
    const nm = String(place?.name || '').trim();
    const rank = locationKeyRank(place?.kind);
    if (nm) placeKeys.push({ key: nm, placeId: place.id, rank });
    for (const t of place.locationTags || []) {
      const s = String(t || '').trim();
      if (!s) continue;
      const tagPlace = rooms.find(p => GEO_PLACE_KIND_SET.has(p.kind)
        && String(p.name || '').toLowerCase() === s.toLowerCase());
      placeKeys.push({
        key: s,
        placeId: tagPlace?.id || place.id,
        rank: rankForKey(s, tagPlace || (GEO_PLACE_KIND_SET.has(place.kind) ? place : null), storage),
      });
    }
  }
  const keys = [];
  const seen = new Set();
  for (const k of known) {
    const low = k.toLowerCase();
    if (seen.has(low)) continue;
    seen.add(low);
    keys.push({ key: k, placeId: '', rank: rankForKey(k, null, storage) });
  }
  for (const pk of placeKeys) {
    const low = pk.key.toLowerCase();
    if (seen.has(low)) {
      const hit = keys.find(x => x.key.toLowerCase() === low);
      if (hit) {
        if (!hit.placeId) hit.placeId = pk.placeId;
        if ((pk.rank || 1) > (hit.rank || 1)) hit.rank = pk.rank;
      }
      continue;
    }
    seen.add(low);
    keys.push(pk);
  }
  if (!keys.length) return null;

  const msgs = Array.isArray(chatMessages) && chatMessages.length
    ? chatMessages.filter(m => m && !m.is_system).slice(-8)
    : [];
  if (!msgs.length) return null;

  let best = null;
  let text = '';
  for (let i = msgs.length - 1; i >= 0; i--) {
    const raw = String(msgs[i]?.mes || '');
    if (!raw) continue;
    const lower = raw.toLowerCase();
    let local = null;
    for (const k of keys) {
      const needle = k.key.toLowerCase();
      if (!needle) continue;
      const idx = lower.lastIndexOf(needle);
      if (idx < 0) continue;
      const cand = { ...k, idx };
      if (betterPing(cand, local)) local = cand;
    }
    if (local) {
      best = local;
      text = raw;
      break;
    }
  }
  if (!best) return null;

  let placeId = best.placeId;
  if (!placeId) {
    const low = best.key.toLowerCase();
    const byName = rooms.find(p => isLoadableKind(p.kind) && String(p.name || '').toLowerCase() === low)
      || rooms.find(p => GEO_PLACE_KIND_SET.has(p.kind) && String(p.name || '').toLowerCase() === low)
      || rooms.find(p => String(p.name || '').toLowerCase() === low);
    const byTag = rooms.find(p => isLoadableKind(p.kind) && placeMatchesLocationTags(p, [best.key]))
      || rooms.find(p => GEO_PLACE_KIND_SET.has(p.kind) && placeMatchesLocationTags(p, [best.key]))
      || rooms.find(p => placeMatchesLocationTags(p, [best.key]));
    placeId = byName?.id || byTag?.id || '';
  }
  const label = formatSceneLocation({ compass, storage, placeId, key: best.key });
  return { key: label || best.key, rawKey: best.key, placeId, index: best.idx, text };
}

/** Try to find a compass area id mentioned near the end of text. */
export function inferAreaFromText(text, fallback = 'C') {
  const raw = String(text || '');
  const re = /\b(NW|NE|SW|SE|N|E|S|W|C)\b/gi;
  let last = null;
  let m;
  while ((m = re.exec(raw))) last = m[1].toUpperCase();
  if (!last) return fallback;
  try { return normalizeCell(last); } catch { return fallback; }
}

/**
 * Apply sonar pings: last location key in latest message → last-known place/area
 * for every cast member. Soft tracker — not a hard lock.
 *
 * @param {object} compass
 * @param {object} opts
 * @param {Array<{id?:string,name:string}>} opts.castMembers
 * @param {object} opts.storage
 * @param {Array} opts.chat
 * @returns {{ key: string, placeId: string, pings: object } | null}
 */
export function applySonarPings(compass, {
  castMembers = [],
  storage = null,
  chat = null,
} = {}) {
  if (!compass || typeof compass !== 'object') return null;
  compass.sonar = compass.sonar && typeof compass.sonar === 'object' ? compass.sonar : { pings: {} };
  compass.sonar.pings = compass.sonar.pings && typeof compass.sonar.pings === 'object'
    ? compass.sonar.pings
    : {};

  pruneStaleSonar(compass);

  const hit = resolveLastLocationPing(compass, storage, chat);
  if (!hit?.key) {
    pruneStaleSonar(compass);
    return { key: compass.sonar.lastKey || '', placeId: compass.sonar.lastPlaceId || '', pings: compass.sonar.pings };
  }

  const lastMes = hit.text
    || (Array.isArray(chat) && chat.length ? String(chat[chat.length - 1]?.mes || '') : '');
  const area = inferAreaFromText(lastMes, 'C');
  const now = Date.now();
  compass.sonar.lastKey = hit.key;
  compass.sonar.lastPlaceId = hit.placeId || '';
  compass.sonar.lastAt = now;

  for (const m of castMembers) {
    const name = String(m?.name || '').trim();
    if (!name) continue;
    const id = String(m.id || name);
    const prev = compass.sonar.pings[id] || compass.sonar.pings[name.toLowerCase()];
    const samePlace = prev?.placeId && hit.placeId && prev.placeId === hit.placeId;
    compass.sonar.pings[id] = {
      name,
      castId: id,
      placeId: hit.placeId || prev?.placeId || '',
      cell: samePlace && prev?.cell ? prev.cell : area,
      key: hit.key,
      at: now,
    };
  }

  pruneStaleSonar(compass);

  // Soft-sync occupants in the pinged room (tracker presence, not choreography)
  if (hit.placeId) {
    const room = getPlace(compass, hit.placeId);
    if (room && isLoadableKind(room.kind) && Array.isArray(room.occupants)) {
      for (const m of castMembers) {
        const name = String(m?.name || '').trim();
        if (!name) continue;
        const ping = compass.sonar.pings[String(m.id || name)];
        if (!ping?.cell) continue;
        const existing = room.occupants.find(o => o.name.toLowerCase() === name.toLowerCase());
        if (existing) {
          existing.cell = ping.cell;
          existing.castId = existing.castId || String(m.id || '');
        } else {
          room.occupants.push({
            name,
            cell: ping.cell,
            facing: 'N',
            castId: String(m.id || ''),
            description: `sonar · ${hit.key}`,
          });
        }
      }
    }
  }

  return { key: hit.key, placeId: hit.placeId, pings: compass.sonar.pings };
}

export function listSonarPingsInPlace(compass, placeId) {
  const pings = compass?.sonar?.pings || {};
  const id = String(placeId || '');
  return Object.values(pings).filter(p => p?.placeId === id);
}

/** Drop pings / lastPlaceId that point at deleted rooms. */
export function pruneStaleSonar(compass) {
  if (!compass?.sonar) return compass;
  const rooms = compass.rooms || {};
  const pings = compass.sonar.pings && typeof compass.sonar.pings === 'object' ? compass.sonar.pings : {};
  for (const [id, p] of Object.entries(pings)) {
    if (p?.placeId && !rooms[p.placeId]) p.placeId = '';
    if (!p?.name) delete pings[id];
  }
  compass.sonar.pings = pings;
  if (compass.sonar.lastPlaceId && !rooms[compass.sonar.lastPlaceId]) compass.sonar.lastPlaceId = '';
  return compass;
}

export function sonarFingerprint(sonar) {
  const src = sonar && typeof sonar === 'object' ? sonar : {};
  const bits = Object.entries(src.pings || {})
    .map(([id, p]) => `${id}:${p?.placeId || ''}:${p?.cell || ''}:${p?.key || ''}`)
    .sort();
  return `${src.lastKey || ''}|${src.lastPlaceId || ''}|${bits.join(',')}`;
}

/**
 * Human-readable sonar check against the current floorplan (no LLM).
 * Call after applySonarPings so lastKey/pings are current.
 */
export function summarizeSonarCheck(compass, {
  storage = null,
  chat = null,
  focusId = '',
} = {}) {
  const notes = [];
  const known = (() => {
    try { return collectActiveLocationTags(storage); } catch { return []; }
  })();
  const sonar = compass?.sonar || {};
  const rooms = compass?.rooms || {};
  const lastKey = String(sonar.lastKey || '').trim();
  const lastPlaceId = String(sonar.lastPlaceId || '').trim();
  const lastPlace = lastPlaceId ? rooms[lastPlaceId] : null;
  const activeId = String(compass?.activeRoomId || '');
  const focus = focusId ? rooms[focusId] : (activeId ? rooms[activeId] : null);
  const pingList = Object.values(sonar.pings || {}).filter(p => p?.name);

  if (!Object.keys(rooms).length) {
    notes.push({
      severity: 'info',
      text: 'No places on the Set yet — sonar has nothing to ping.',
    });
  } else if (!known.length && !lastKey) {
    notes.push({
      severity: 'warn',
      text: 'No location keys yet. Create a room or tag a place; Library / Composer location tags also count.',
    });
  }

  const lastMes = Array.isArray(chat) && chat.length ? String(chat[chat.length - 1]?.mes || '') : '';
  const live = lastMes ? resolveLastLocationPing(compass, storage, chat) : null;
  if (!lastMes.trim()) {
    notes.push({ severity: 'info', text: 'No chat message to scan. Sonar reads the latest line for a location key.' });
  } else if (!live?.key) {
    notes.push({
      severity: 'info',
      text: lastKey
        ? `Latest line has no known place key (${known.slice(0, 5).join(', ') || 'none filed'}). Last-known remains “${lastKey}”${lastPlace ? ` → ${lastPlace.name}` : ''}.`
        : `Latest message did not mention a known place (${known.slice(0, 6).join(', ') || 'none filed'}).`,
    });
  } else if (!lastPlaceId) {
    notes.push({
      severity: 'warn',
      text: `Matched “${lastKey}” but no Set place is named or tagged that. Rename/tag a room to match.`,
    });
  } else if (!lastPlace) {
    notes.push({
      severity: 'warn',
      text: `Last ping “${lastKey}” pointed at a deleted place. It was cleared — load a living room.`,
    });
  } else {
    const loaded = lastPlace.id === activeId;
    notes.push({
      severity: 'info',
      text: loaded
        ? `Last key “${lastKey}” → ${lastPlace.name} (loaded).`
        : `Last key “${lastKey}” → ${lastPlace.name} (not loaded). Load it so Placement / POV match the ping.`,
    });
    if (focus && focus.id !== lastPlace.id && isLoadableKind(focus.kind)) {
      notes.push({
        severity: 'info',
        text: `Viewing ${focus.name} while sonar last saw ${lastPlace.name} — not a contradiction, just a different room.`,
      });
    }
  }

  const here = focus && isLoadableKind(focus.kind) ? listSonarPingsInPlace(compass, focus.id) : [];
  if (focus && isLoadableKind(focus.kind) && lastPlace && lastPlace.id === focus.id && !here.length && pingList.length) {
    notes.push({
      severity: 'warn',
      text: 'Sonar place matches this room but no cast pings landed — check Cast names.',
    });
  }

  return {
    key: lastKey,
    placeId: lastPlaceId,
    placeName: lastPlace?.name || '',
    pingCount: pingList.length,
    pingsHere: here,
    notes,
  };
}

/** Build a synthetic observer for area-based room preview (no cast picker). */
export function areaObserver(cell = 'C', facing = 'N') {
  return {
    name: 'Observer',
    cell: (() => { try { return normalizeCell(cell); } catch { return 'C'; } })(),
    facing,
  };
}
