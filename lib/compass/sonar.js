// Room Compass — sonar pings (last-known narrative position) + area access.

import { CELLS, CELL_ROWS, normalizeCell, listCellPieces, placeMatchesLocationTags, isCompassPlaceKind, GEO_PLACE_KIND_SET } from './schema.js';
import { canSeeArea } from './barriers.js';
import { collectActiveLocationTags, getPlace } from './state.js';
import { formatSceneLocation, locationKeyRank, findLocationNodeByName, geographicAncestors } from '../locationCatalog.js';
import { listUnlistedKeys } from './unlisted.js';
import { normalizeCastPresence } from '../castCatalog.js';

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

function escapeRe(s) {
  return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Last whole-token / whole-phrase index so "Japan" does not hit "Japanese". */
export function keyMentionIndex(text, key) {
  const lower = String(text || '').toLowerCase();
  const needle = String(key || '').trim().toLowerCase();
  if (!needle || needle.length < 3) return -1;
  const re = new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapeRe(needle)}(?=$|[^\\p{L}\\p{N}])`, 'giu');
  let idx = -1;
  let m;
  while ((m = re.exec(lower))) idx = m.index;
  return idx;
}

/** True when the new ping is only an ancestor / coarser tag of the current place. */
export function isCoarserPingOf(compass, currentPlaceId, hit) {
  const cur = compass?.rooms?.[currentPlaceId];
  if (!cur || !hit) return false;
  const curRank = locationKeyRank(cur.kind);
  const hitPlace = hit.placeId ? compass?.rooms?.[hit.placeId] : null;
  const newRank = hit.rank || (hitPlace ? locationKeyRank(hitPlace.kind) : 1);
  if (newRank > curRank) return false;
  if (newRank === curRank && hit.placeId && hit.placeId !== currentPlaceId) return false;
  const chain = geographicAncestors(compass, currentPlaceId, { includeSelf: true });
  const names = new Set(chain.map(p => String(p.name || '').toLowerCase()).filter(Boolean));
  for (const t of cur.locationTags || []) names.add(String(t || '').toLowerCase());
  const key = String(hit.rawKey || hit.key || '').toLowerCase();
  if (key && names.has(key)) return true;
  if (hit.placeId && chain.some(p => p.id === hit.placeId)) return true;
  return false;
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
    for (const t of place.aliases || []) {
      const s = String(t || '').trim();
      if (!s) continue;
      placeKeys.push({
        key: s,
        placeId: place.id,
        rank: rankForKey(s, GEO_PLACE_KIND_SET.has(place.kind) ? place : null, storage),
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
  try {
    for (const k of listUnlistedKeys(compass)) {
      const low = k.toLowerCase();
      if (!low) continue;
      if (seen.has(low)) {
        const hit = keys.find(x => x.key.toLowerCase() === low);
        if (hit && (hit.rank || 1) < 6) hit.rank = 6;
        continue;
      }
      seen.add(low);
      keys.push({ key: k, placeId: '', rank: 6 });
    }
  } catch { /* ignore */ }
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
    let local = null;
    for (const k of keys) {
      const idx = keyMentionIndex(raw, k.key);
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
    const byName = rooms.find(p => isCompassPlaceKind(p.kind) && String(p.name || '').toLowerCase() === low)
      || rooms.find(p => GEO_PLACE_KIND_SET.has(p.kind) && String(p.name || '').toLowerCase() === low)
      || rooms.find(p => String(p.name || '').toLowerCase() === low);
    const byTag = rooms.find(p => isCompassPlaceKind(p.kind) && placeMatchesLocationTags(p, [best.key]))
      || rooms.find(p => GEO_PLACE_KIND_SET.has(p.kind) && placeMatchesLocationTags(p, [best.key]))
      || rooms.find(p => placeMatchesLocationTags(p, [best.key]));
    placeId = byName?.id || byTag?.id || '';
  }
  const label = formatSceneLocation({ compass, storage, placeId, key: best.key });
  return { key: best.key, rawKey: best.key, label, placeId, rank: best.rank, index: best.idx, text };
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

function memberPresence(m) {
  return normalizeCastPresence(m);
}

/** Drop written-out pings; lock Absent in place so a check cannot move them. */
export function syncSonarPresence(compass, castMembers = []) {
  if (!compass) return compass;
  compass.sonar = compass.sonar && typeof compass.sonar === 'object' ? compass.sonar : { pings: {} };
  compass.sonar.pings = compass.sonar.pings && typeof compass.sonar.pings === 'object'
    ? compass.sonar.pings : {};
  const parkPlace = String(compass.sonar.lastPlaceId || compass.activeRoomId || '').trim();
  for (const m of castMembers || []) {
    const name = String(m?.name || '').trim();
    const id = String(m?.id || name);
    if (!id || !name) continue;
    const presence = memberPresence(m);
    if (presence === 'writtenOut') {
      delete compass.sonar.pings[id];
      continue;
    }
    if (presence !== 'absent') continue;
    const prev = compass.sonar.pings[id] || {};
    pinSonarPing(compass, m, {
      placeId: prev.placeId || parkPlace,
      cell: prev.cell || 'C',
      locked: true,
    });
  }
  return compass;
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
  syncSonarPresence(compass, castMembers);

  const hit = resolveLastLocationPing(compass, storage, chat);
  if (!hit?.key) {
    pruneStaleSonar(compass);
    return { key: compass.sonar.lastKey || '', placeId: compass.sonar.lastPlaceId || '', pings: compass.sonar.pings };
  }

  const currentPlaceId = String(compass.sonar.lastPlaceId || '').trim();
  if (currentPlaceId && isCoarserPingOf(compass, currentPlaceId, hit)) {
    pruneStaleSonar(compass);
    return {
      key: compass.sonar.lastKey || hit.key,
      placeId: currentPlaceId,
      pings: compass.sonar.pings,
    };
  }

  const lastMes = hit.text
    || (Array.isArray(chat) && chat.length ? String(chat[chat.length - 1]?.mes || '') : '');
  const area = inferAreaFromText(lastMes, 'C');
  const now = Date.now();
  compass.sonar.lastKey = hit.key;
  compass.sonar.lastPlaceId = hit.placeId || '';
  compass.sonar.lastAt = now;
  const exclude = new Set((compass.sonar.excludeIds || []).map(id => String(id)));

  for (const m of castMembers) {
    const name = String(m?.name || '').trim();
    if (!name) continue;
    const id = String(m.id || name);
    if (memberPresence(m) === 'writtenOut') continue;
    if (exclude.has(id) || exclude.has(name)) continue;
    const prev = compass.sonar.pings[id] || compass.sonar.pings[name.toLowerCase()];
    if (prev?.locked || memberPresence(m) === 'absent') continue;
    const samePlace = prev?.placeId && hit.placeId && prev.placeId === hit.placeId;
    compass.sonar.pings[id] = {
      name,
      castId: id,
      placeId: hit.placeId || prev?.placeId || '',
      cell: samePlace && prev?.cell ? prev.cell : area,
      key: hit.key,
      at: now,
      locked: false,
    };
  }

  pruneStaleSonar(compass);

  // Soft-sync occupants in the pinged room (tracker presence, not choreography)
  if (hit.placeId) {
    const room = getPlace(compass, hit.placeId);
    if (room && isCompassPlaceKind(room.kind) && Array.isArray(room.occupants)) {
      for (const m of castMembers) {
        const name = String(m?.name || '').trim();
        if (!name) continue;
        if (memberPresence(m) === 'writtenOut') continue;
        if ((compass.sonar.excludeIds || []).includes(String(m.id || name))) continue;
        const ping = compass.sonar.pings[String(m.id || name)];
        if (!ping?.cell) continue;
        if (ping.placeId && hit.placeId && ping.placeId !== hit.placeId) continue;
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

export function setSonarExcluded(compass, castId, excluded) {
  if (!compass?.sonar) return compass;
  const id = String(castId || '').trim();
  if (!id) return compass;
  const list = Array.isArray(compass.sonar.excludeIds) ? compass.sonar.excludeIds : [];
  const next = list.filter(x => x !== id);
  if (excluded) next.push(id);
  compass.sonar.excludeIds = next;
  return compass;
}

export function pinSonarPing(compass, member, { placeId = '', cell = 'C', locked = true } = {}) {
  if (!compass?.sonar) return null;
  compass.sonar.pings = compass.sonar.pings && typeof compass.sonar.pings === 'object'
    ? compass.sonar.pings : {};
  const name = String(member?.name || '').trim();
  const id = String(member?.id || name);
  if (!id || !name) return null;
  let cellId = 'C';
  try { cellId = normalizeCell(cell || 'C'); } catch { cellId = 'C'; }
  const prev = compass.sonar.pings[id] || {};
  compass.sonar.pings[id] = {
    name,
    castId: id,
    placeId: String(placeId || prev.placeId || '').trim(),
    cell: cellId,
    key: prev.key || '',
    at: Date.now(),
    locked: !!locked,
  };
  return compass.sonar.pings[id];
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
    .map(([id, p]) => `${id}:${p?.placeId || ''}:${p?.cell || ''}:${p?.key || ''}:${p?.locked ? '1' : '0'}`)
    .sort();
  return `${src.lastKey || ''}|${src.lastPlaceId || ''}|${bits.join(',')}|${
    (src.unlisted || []).map(u => `${u?.name || ''}:${u?.source || ''}`).sort().join(';')
  }|${(src.unlistedSkip || []).map(s => String(s || '').toLowerCase()).sort().join(';')}`;
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
    if (focus && focus.id !== lastPlace.id && isCompassPlaceKind(focus.kind)) {
      notes.push({
        severity: 'info',
        text: `Viewing ${focus.name} while sonar last saw ${lastPlace.name} — not a contradiction, just a different room.`,
      });
    }
  }

  const here = focus && isCompassPlaceKind(focus.kind) ? listSonarPingsInPlace(compass, focus.id) : [];
  if (focus && isCompassPlaceKind(focus.kind) && lastPlace && lastPlace.id === focus.id && !here.length && pingList.length) {
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

export function smokeSonarLocationPure() {
  if (keyMentionIndex('Japanese breakfast in Fukuoka', 'Japan') >= 0) return 'japan-in-japanese';
  if (keyMentionIndex('back in Japan after the trip', 'Japan') < 0) return 'japan-token';
  if (keyMentionIndex('Canal City Mall was packed', 'Canal City Mall') < 0) return 'mall-phrase';
  const rooms = {
    jp: { id: 'jp', name: 'Japan', kind: 'region', parentId: '' },
    shop: { id: 'shop', name: 'Okisato Antiques', kind: 'building', parentId: 'jp', locationTags: ['Japan'] },
    other: { id: 'other', name: 'Tokyo', kind: 'settlement', parentId: 'jp' },
  };
  const compass = { rooms };
  if (!isCoarserPingOf(compass, 'shop', { key: 'Japan', placeId: 'jp', rank: 2 })) return 'keep-shop';
  if (isCoarserPingOf(compass, 'shop', { key: 'Tokyo', placeId: 'other', rank: 3 })) return 'switch-city';
  return '';
}
