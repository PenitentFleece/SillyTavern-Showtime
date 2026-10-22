// Room Compass — sonar pings (last-known narrative position) + area access.

import { CELLS, CELL_ROWS, normalizeCell, listCellPieces, placeMatchesLocationTags, isCompassPlaceKind, GEO_PLACE_KIND_SET, normalizeRoom } from './schema.js';
import { canSeeArea } from './barriers.js';
import { addOccupant, collectActiveLocationTags, evictOccupantFromOtherRooms, getPlace, removeOccupantEverywhere } from './state.js';
import { formatSceneLocation, locationKeyRank, findLocationNodeByName, geographicAncestors } from '../locationCatalog.js';
import { listUnlistedKeys } from './unlisted.js';
import { normalizeCastPresence } from '../castCatalog.js';
import { parseMsgTimestamp } from '../chatTrack.js';

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

function keyMentionRe(needle) {
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])(${escapeRe(needle)})(?=$|[^\\p{L}\\p{N}])`, 'giu');
}

/** Start indexes of whole-token / whole-phrase hits so "Japan" does not hit "Japanese". */
export function keyMentionStarts(text, key) {
  const lower = String(text || '').toLowerCase();
  const needle = String(key || '').trim().toLowerCase();
  if (!needle || needle.length < 3) return [];
  const re = keyMentionRe(needle);
  const out = [];
  let m;
  while ((m = re.exec(lower))) {
    const full = m[0] || '';
    const captured = m[1] || needle;
    out.push(m.index + (full.length - captured.length));
  }
  return out;
}

/** Last whole-token / whole-phrase index so "Japan" does not hit "Japanese". */
export function keyMentionIndex(text, key) {
  const starts = keyMentionStarts(text, key);
  if (!starts.length) return -1;
  const last = starts[starts.length - 1];
  return last > 0 ? last - 1 : last;
}

function resolveKeyStart(text, key, idx) {
  const raw = String(text || '');
  const needle = String(key || '').trim();
  const nlow = needle.toLowerCase();
  if (!nlow) return -1;
  const lower = raw.toLowerCase();
  const nlen = nlow.length;
  if (Number.isFinite(idx) && idx >= 0) {
    if (lower.slice(idx, idx + nlen) === nlow) return idx;
    if (lower.slice(idx + 1, idx + 1 + nlen) === nlow) return idx + 1;
  }
  const starts = keyMentionStarts(raw, needle);
  if (Number.isFinite(idx) && idx >= 0) {
    const near = starts.find(s => Math.abs(s - idx) <= 1);
    if (near != null) return near;
  }
  return starts.length ? starts[starts.length - 1] : -1;
}

const SETTING_LOCATIVE = /(?:^|[\s,;:.—–\-])(?:(?:back|here|out|further|way|deep)\s+)?(?:in|at|inside(?:\s+of)?|into|within|across|around|throughout|down|along|through|onto|out\s+in|out\s+on)\s+(?:the\s+|a\s+|an\s+)?$/i;
const SETTING_ARRIVAL = /(?:arrived|entered|reached|walked|walking|stepped|stepping|returned|returning|came(?:\s+back)?|ushered(?:\s+\w+)?|led(?:\s+\w+)?|followed(?:\s+\w+)?|retreated|retreating|ducked|ducking|slipped|slipping|pushed|pushes|pushing|headed|moved(?:\s+on)?|swept|sweeping|crossed|crossing|paced|pacing|emerged|backed|backing|echoed|echoing|liked)\s+(?:(?:back|here|out|further|way)\s+)?(?:(?:in|at|into|to|inside|through|down|along|across|onto)\s+)?(?:the\s+|a\s+|an\s+)?$/i;
const SETTING_COPULA = /^\s*(?:(?:was|were|is|are)\s+(?:\w+\s+){0,2}(?:packed|quiet|empty|crowded|dark|bright|busy|loud|silent|still|warm|cold|deserted|lively|full|vacant|dim|cramped|narrow|small|tidy|messy)\b|(?:reeked|smelled|stank|stretched|echoed|hummed|buzzed|gleamed|glittered|loomed)\b)/i;
const SETTING_FIXTURE_LEFT = /(?:shut|shutting|closed|closing|locked|locking|bolted|bolting|crossed|crossing|paced|pacing|swept|sweeping|mopped|mopping|cleaned|cleaning|polished|polishing|sat\s+(?:down\s+)?at|stood\s+(?:by|at|in)|leaned\s+against)\s+(?:the\s+|a\s+|an\s+)?$/i;
const SETTING_FIXTURE_RIGHT = /^\s+(?:door|floor|table|counter|desk|chair|couch|sofa|bench|window|wall|corner|sink|kettle|fridge|lockers?|shelves|cases?|displays?|corridor|hall|hallway|passage|exit)\b/i;
const SETTING_FIXTURE_SELF_SUFFIX = /\b(?:door|floor|corridor|hall|hallway|passage|aisle|counter|shelves|displays?)$/i;
const PROXY_INTO_LEFT = /\b(?:sent|slipped|tucked|floated|drifted|guided|threaded|threw|tossed|rolled|slid|planted)\s+(?:a|an|one|the|his|her|their)?\s*(?:[\w-]+\s+){0,2}(?:feather|bug|wire|mic|microphone|drone|camera|sensor|probe|note|letter|coin|stone)\s+(?:in|into|inside|through|down|along)\s+(?:the\s+|a\s+|an\s+)?$/i;
const MENTION_VERB = /(?:talk(?:s|ed|ing)?|ask(?:s|ed|ing)?|mention(?:s|ed|ing)?|remember(?:s|ed|ing)?|hear(?:s|d|ing)?)\s+(?:about\s+)?(?:the\s+|a\s+|an\s+)?$/i;
const MENTION_THINK = /(?:think(?:s|ing)?|thought)\s+(?:of|about)\s+(?:the\s+|a\s+|an\s+)?$/i;
const MENTION_ABOUT = /\babout\s+(?:the\s+|a\s+|an\s+)?$/i;
const MENTION_OF = /\bof\s+(?:the\s+|a\s+|an\s+)?$/i;
const INSIDE_OF = /inside\s+of\s+(?:the\s+|a\s+|an\s+)?$/i;
const MENTION_FROM = /\bfrom\s+(?:the\s+|a\s+|an\s+)?$/i;
const PLAN_SHOULD = /\bshould\s+we\b/i;
const PLAN_GO = /(?:headed|heading|go(?:ing)?|goes)\s+to\s+(?:the\s+|a\s+|an\s+)?$/i;
const PLAN_LETS = /(?:let'?s|lets)\s+go\s+to\s+(?:the\s+|a\s+|an\s+)?$/i;
const LOOK_AT = /(?:look(?:s|ed|ing)?|stare(?:s|d|ing)?|gaze(?:s|d|ing)?|glance(?:s|d|ing)?|peer(?:s|ed|ing)?)\s+(?:at|toward|towards|out\s+at|across\s+at)\s+(?:the\s+|a\s+|an\s+)?$/i;
const SEE_AT = /(?:see|saw|seen|watch(?:es|ed|ing)?|notice(?:s|d|ing)?|spot(?:s|ted|ting)?|glimpse(?:s|d|ing)?)\s+(?:at|toward|towards)\s+(?:the\s+|a\s+|an\s+)?$/i;
const FRAME_WINDOW = 64;

/**
 * True when this place-name hit frames the scene as set there now.
 * Talking about, remembering, asking, originating from, or planning to go
 * to a place is not occupancy. Bare names default to skip.
 */
export function isSettingFrame(text, key, idx = -1) {
  const raw = String(text || '');
  const needle = String(key || '').trim();
  const at = resolveKeyStart(raw, needle, idx);
  if (at < 0) return false;
  const left = raw.slice(Math.max(0, at - FRAME_WINDOW), at);
  const right = raw.slice(at + needle.length, at + needle.length + FRAME_WINDOW);
  if (PROXY_INTO_LEFT.test(left)) return false;
  if (PLAN_SHOULD.test(left) || PLAN_GO.test(left) || PLAN_LETS.test(left)) return false;
  if (LOOK_AT.test(left) || SEE_AT.test(left)) return false;
  if (MENTION_VERB.test(left) || MENTION_THINK.test(left) || MENTION_FROM.test(left)) return false;
  if (MENTION_ABOUT.test(left) || (MENTION_OF.test(left) && !INSIDE_OF.test(left))) return false;
  if (SETTING_LOCATIVE.test(left) || SETTING_ARRIVAL.test(left)) return true;
  if (SETTING_FIXTURE_LEFT.test(left) && (SETTING_FIXTURE_RIGHT.test(right) || SETTING_FIXTURE_SELF_SUFFIX.test(needle))) return true;
  if (SETTING_COPULA.test(right)) return true;
  return false;
}

/** True when `here` appears in the scene window as occupancy, not a mention. */
export function confirmSettingHere(scene, here) {
  const key = String(here || '').trim();
  if (!key) return false;
  const raw = String(scene || '');
  return keyMentionStarts(raw, key).some(at => isSettingFrame(raw, key, at));
}

function walkAncestors(compass, placeId, { includeSelf = false } = {}) {
  const rooms = compass?.rooms || {};
  const start = rooms[placeId];
  const out = [];
  const guard = new Set();
  let cur = includeSelf ? start : (start ? rooms[start.parentId] : null);
  while (cur && !guard.has(cur.id)) {
    guard.add(cur.id);
    out.push(cur);
    cur = cur.parentId ? rooms[cur.parentId] : null;
  }
  return out;
}

/** True when the new ping is only an ancestor / coarser tag of the current place. */
export function isCoarserPingOf(compass, currentPlaceId, hit) {
  const cur = compass?.rooms?.[currentPlaceId];
  if (!cur || !hit) return false;
  const chain = walkAncestors(compass, currentPlaceId, { includeSelf: true });
  if (hit.placeId && hit.placeId !== currentPlaceId && chain.some(p => p.id === hit.placeId)) {
    return true;
  }
  const curRank = locationKeyRank(cur.kind);
  const hitPlace = hit.placeId ? compass?.rooms?.[hit.placeId] : null;
  const newRank = hit.rank || (hitPlace ? locationKeyRank(hitPlace.kind) : 1);
  if (newRank > curRank) return false;
  if (newRank === curRank && hit.placeId && hit.placeId !== currentPlaceId) return false;
  const names = new Set(chain.map(p => String(p.name || '').toLowerCase()).filter(Boolean));
  for (const t of cur.locationTags || []) names.add(String(t || '').toLowerCase());
  const key = String(hit.rawKey || hit.key || '').toLowerCase();
  if (key && names.has(key)) return true;
  return false;
}

/** True when the ping is inside / under the current outdoor (or other ancestor) place. */
export function isDescendantPingOf(compass, currentPlaceId, hit) {
  const ancestor = String(currentPlaceId || '').trim();
  const childId = String(hit?.placeId || '').trim();
  if (!ancestor || !childId || ancestor === childId) return false;
  const chain = walkAncestors(compass, childId, { includeSelf: true });
  return chain.some(p => p.id === ancestor);
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
  const span = Math.max(cand.key.length, current.key.length);
  const overlapping = Math.abs((cand.idx || 0) - (current.idx || 0)) < span;
  if (overlapping && cand.key.length !== current.key.length) {
    return cand.key.length > current.key.length;
  }
  if ((cand.idx || 0) !== (current.idx || 0)) return (cand.idx || 0) >= (current.idx || 0);
  return cand.key.length >= current.key.length;
}

const SHOWROOM_VIRTUAL_ALIASES = Object.freeze([
  'display floor',
  'display room',
  'display room floor',
  'shop floor',
  'sales floor',
  'showroom',
  'main showroom',
  'the displays',
]);

const SERVICE_CORRIDOR_VIRTUAL_ALIASES = Object.freeze([
  'service corridor',
  'delivery hallway',
  'service hall',
  'employee exit corridor',
  'loading bay corridor',
]);

function ensureNarrativeTransitionalRooms(compass, msgs) {
  if (!compass?.rooms || typeof compass.rooms !== 'object') return;
  const rooms = Object.values(compass.rooms);
  if (!rooms.length) return;
  const existing = rooms.find(r =>
    r && /^(service\s+corridor|delivery\s+hallway|service\s+hall)$/i.test(String(r.name || '').trim()));
  if (existing) return;

  const hasSubRooms = rooms.some(r => r && (r.kind === 'unit' || r.kind === 'room' || r.kind === 'transitional'));
  if (!hasSubRooms) return;

  let hitCorridor = false;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const raw = String(msgs[i]?.mes || '');
    if (!raw) continue;
    for (const phrase of SERVICE_CORRIDOR_VIRTUAL_ALIASES) {
      if (keyMentionStarts(raw, phrase).some(idx => isSettingFrame(raw, phrase, idx))) {
        hitCorridor = true;
        break;
      }
    }
    if (hitCorridor) break;
  }
  if (!hitCorridor) return;

  const activeId = String(compass.sonar?.lastPlaceId || compass.activeRoomId || '').trim();
  const chain = activeId ? walkAncestors(compass, activeId, { includeSelf: true }) : [];
  const building = chain.find(p => p?.kind === 'building')
    || rooms.find(p => p?.kind === 'building')
    || chain.find(p => p?.kind === 'unit');
  if (!building) return;

  try {
    const created = normalizeRoom({
      id: 'service_corridor',
      name: 'Service Corridor',
      kind: 'transitional',
      parentId: building.id,
      aliases: ['Delivery Hallway', 'Service Hall', 'Employee Exit Corridor', 'Loading Bay Corridor'],
      description: 'Long concrete service corridor connecting the back employee exits to the loading bay.',
    });
    compass.rooms[created.id] = created;
  } catch { /* ignore */ }
}

/**
 * Find the last setting-frame location in recent chat (occupancy, not a
 * mention). Prefers building/city over country so "Fukuoka" beats "Japan"
 * when both appear as setting.
 * @returns {{ key: string, placeId: string } | null}
 */
export function resolveLastLocationPing(compass, storage, chatMessages = null) {
  const msgs = Array.isArray(chatMessages) && chatMessages.length
    ? chatMessages.filter(m => m && !m.is_system).slice(-8)
    : [];
  if (!msgs.length) return null;

  ensureNarrativeTransitionalRooms(compass, msgs);

  const known = collectActiveLocationTags(storage);
  const rooms = Object.values(compass?.rooms || {});
  const placeKeys = [];
  for (const place of rooms) {
    const nm = String(place?.name || '').trim();
    const rank = locationKeyRank(place?.kind);
    if (nm) placeKeys.push({ key: nm, canonicalKey: nm, placeId: place.id, rank });
    for (const t of place.locationTags || []) {
      const s = String(t || '').trim();
      if (!s) continue;
      const tagPlace = rooms.find(p => GEO_PLACE_KIND_SET.has(p.kind)
        && String(p.name || '').toLowerCase() === s.toLowerCase());
      placeKeys.push({
        key: s,
        canonicalKey: tagPlace?.name || s,
        placeId: tagPlace?.id || place.id,
        rank: rankForKey(s, tagPlace || (GEO_PLACE_KIND_SET.has(place.kind) ? place : null), storage),
      });
    }
    for (const t of place.aliases || []) {
      const s = String(t || '').trim();
      if (!s) continue;
      placeKeys.push({
        key: s,
        canonicalKey: nm || s,
        placeId: place.id,
        rank: Math.max(rank, rankForKey(s, place, storage)),
      });
    }
    if (/^(main\s+showroom|showroom|display\s+room|display\s+floor|shop\s+floor|sales\s+floor)$/i.test(nm)) {
      for (const syn of SHOWROOM_VIRTUAL_ALIASES) {
        placeKeys.push({
          key: syn,
          canonicalKey: nm,
          placeId: place.id,
          rank,
        });
      }
    }
    if (/^(service\s+corridor|delivery\s+hallway|service\s+hall)$/i.test(nm)) {
      for (const syn of SERVICE_CORRIDOR_VIRTUAL_ALIASES) {
        placeKeys.push({
          key: syn,
          canonicalKey: nm,
          placeId: place.id,
          rank,
        });
      }
    }
  }
  const keys = [];
  const seen = new Set();
  for (const k of known) {
    const low = k.toLowerCase();
    if (seen.has(low)) continue;
    seen.add(low);
    keys.push({ key: k, canonicalKey: k, placeId: '', rank: rankForKey(k, null, storage) });
  }
  for (const pk of placeKeys) {
    const low = pk.key.toLowerCase();
    if (seen.has(low)) {
      const hit = keys.find(x => x.key.toLowerCase() === low);
      if (hit) {
        if (!hit.placeId) hit.placeId = pk.placeId;
        if (pk.canonicalKey && (!hit.canonicalKey || hit.canonicalKey.toLowerCase() === low)) {
          hit.canonicalKey = pk.canonicalKey;
        }
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
      keys.push({ key: k, canonicalKey: k, placeId: '', rank: 6 });
    }
  } catch { /* ignore */ }
  if (!keys.length) return null;

  let best = null;
  let text = '';
  for (let i = msgs.length - 1; i >= 0; i--) {
    const raw = String(msgs[i]?.mes || '');
    if (!raw) continue;
    let local = null;
    for (const k of keys) {
      for (const idx of keyMentionStarts(raw, k.key)) {
        if (!isSettingFrame(raw, k.key, idx)) continue;
        const cand = { ...k, idx };
        if (betterPing(cand, local)) local = cand;
      }
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
  const canonicalKey = best.canonicalKey || (placeId && compass?.rooms?.[placeId]?.name) || best.key;
  const label = formatSceneLocation({ compass, storage, placeId, key: canonicalKey });
  return { key: canonicalKey, rawKey: best.key, label, placeId, rank: best.rank, index: best.idx, text };
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

// Titles/abbreviations whose trailing "." must NOT be treated as a sentence
// boundary — otherwise "Mrs. Okisato" gets torn into "Mrs." + "Okisato...",
// and her full name never matches as a single mention again.
const SENTENCE_ABBREV_RE = /\b(?:Mrs?|Ms|Dr|St|Jr|Sr|Mt|Prof|Rev|Gen|Capt|Lt|Col|Sgt|No|vs|etc)\.$/i;

/** Naive sentence splitter that keeps "Mrs./Mr./Dr./etc." glued to the name that follows. */
function splitSentences(paragraph) {
  const raw = String(paragraph || '').split(/(?<=[.!?…])\s+/);
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    let piece = raw[i];
    while (i < raw.length - 1 && SENTENCE_ABBREV_RE.test(piece.trim())) {
      i++;
      piece = `${piece} ${raw[i]}`;
    }
    out.push(piece);
  }
  return out;
}

const LISTENING_CUE_RE = /\b(covert\s+feather|listening\s+feather|(?:sent|slipped|tucked|planted|guided|floated|drifted|threaded|wedged|perched|stationed)\s+(?:a|one|an|his|her|their|the)?\s*(?:[\w-]+\s+){0,2}(?:feather|bug|wire|mic|microphone|drone|camera|familiar|clone|sensor)\b|(?:feather|bug|wire|mic|microphone|earpiece|comm)\b[^.!?]{0,60}\b(?:in|into|inside|through|along|down|behind|under|near)\s+the\s+(?:service\s+corridor|corridor|hall|hallway|vent|door|crack|gap|break\s+room|storage|room|ceiling|wall)|listen(?:s|ed|ing)?\s+in\b|eavesdrop(?:s|ped|ping)?\b|overhear(?:s|d|ing)?\s+(?:from|through)\b|listening\s+from\s+(?:outside|afar|the\s+corridor|the\s+hall|the\s+hallway|the\s+other\s+room|behind\s+the\s+door|across\s+the\s+street|the\s+promenade)|ear\s+(?:pressed\s+)?to\s+the\s+(?:door|wall|vent|keyhole)|from\s+(?:outside|behind)\s+the\s+door|over\s+the\s+(?:comm|comms|earpiece|radio|open\s+line|speakerphone)|through\s+the\s+(?:earpiece|comm|comms|bug|microphone|vent|transom|audio\s+feed|security\s+feed)|on\s+the\s+phone|over\s+the\s+phone|phone\s+(?:call|line)|calls?\s+(?:her|him|them)\s+(?:on|from)|voice\s+(?:on|through)\s+the\s+(?:phone|line))\b/i;

const PASSIVE_FEATHER_CUE_RE = /\b(red\s+feather|scarlet\s+feather|vermilion\s+feather|crimson\s+feather|tiny\s+feather|small\s+feather|lone\s+feather|single\s+feather|hidden\s+feather|stray\s+feather)\b/i;

const REMOTE_POSITION_EAVESDROP_RE = /\b(listening\s+from\s+(?:outside|afar|the\s+corridor|the\s+hall|the\s+hallway|the\s+other\s+room|behind\s+the\s+door|across\s+the\s+street|the\s+promenade)|ear\s+(?:pressed\s+)?to\s+the\s+(?:door|wall|vent|keyhole)|from\s+(?:outside|behind)\s+the\s+door|overhear(?:s|d|ing)?\s+(?:from|through)\b|over\s+the\s+(?:comm|comms|earpiece|radio|open\s+line|speakerphone)|through\s+the\s+(?:earpiece|comm|comms|bug|microphone|vent|transom|audio\s+feed|security\s+feed)|on\s+the\s+phone|over\s+the\s+phone|phone\s+(?:call|line)|calls?\s+(?:her|him|them)\s+(?:on|from)|voice\s+(?:on|through)\s+the\s+(?:phone|line))\b/i;

const DEPART_CUE_RE = /\b((?:left|leaves|leaving)\s+(?:through\s+the\s+(?:[\w-]+\s+){0,2}door|the\s+(?:room|shop|store|building|office|suite|apartment|house|break\s+room|storage|back\s+room)|out\s+the\s+(?:[\w-]+\s+){0,2}door|to\s+go\s+outside|for\s+the\s+(?:promenade|street|concourse|kiosk|lobby|exit))|(?:walk(?:s|ed|ing)?|step(?:s|ped|ping)?|head(?:s|ed|ing)?|slip(?:s|ped|ping)?|wander(?:s|ed|ing)?|stroll(?:s|ed|ing)?|duck(?:s|ed|ing)?|went|goes|gone|exit(?:s|ed|ing)?|depart(?:s|ed|ing)?|backed|retreat(?:s|ed|ing)?|excused\s+(?:himself|herself|themselves|myself))\s+(?:out\b(?:\s+of\s+the\s+(?:room|shop|store|building|office|break\s+room|storage|door))?|outside\b|out\s+(?:into|onto|to|through|front|back)\b|through\s+the\s+(?:front|back|side|outer|shop|street|main|exit)\s+door|down\s+to\s+the\s+(?:promenade|street|concourse|kiosk|lobby|corridor|hall|courtyard|plaza)|toward(?:s)?\s+the\s+(?:promenade|street|kiosk|concourse|exit|front\s+door)|to\s+(?:a|the)\s+(?:[\w-]+\s+){0,2}(?:kiosk|stand|stall|promenade|street|concourse|balcony|hallway|corridor|courtyard|plaza|sidewalk|cafe))|(?:stay(?:s|ed|ing)?|wait(?:s|ed|ing)?|linger(?:s|ed|ing)?|remain(?:s|ed|ing)?|stood|standing|lean(?:s|ed|ing)?|loiter(?:s|ed|ing)?)\s+(?:outside|out\s+front|out\s+back|out\s+on\s+the\s+(?:promenade|street|balcony|sidewalk|concourse)|out\s+in\s+the\s+(?:hall|hallway|corridor|street|courtyard|concourse|lobby)|at\s+(?:a|the)\s+(?:[\w-]+\s+){0,2}(?:kiosk|stand|stall|counter\s+outside))|already\s+outside|not\s+in\s+the\s+room|out\s+on\s+the\s+promenade)\b/i;

const AWAY_DEST_RE = /\b(?:to|at|near|by|on|into|in)\s+(?:a|an|the)\s+((?:[\w-]+\s+){0,2}(?:kiosk|stand|stall|promenade|concourse|street|sidewalk|balcony|courtyard|plaza|lobby|cafe))\b/i;

const ENTER_ROOM_RE = /\b(?:enter(?:s|ed|ing)?|step(?:s|ped|ping)?\s+(?:back\s+)?(?:in|into|inside|through|out\s+of|out\s+from|out\s+through)|walk(?:s|ed|ing)?\s+(?:back\s+)?(?:in|into|inside|through|out\s+of|out\s+from|out\s+through)|came\s+(?:back\s+)?(?:in|into|inside|through|out\s+of|out\s+from|out\s+through)|come(?:s)?\s+(?:back\s+)?(?:in|into|inside|through|out\s+of|out\s+from|out\s+through)|emerge(?:s|d|ing)?(?:\s+(?:from|out\s+of|into|in|through))?|slip(?:s|ped|ping)?\s+(?:back\s+)?(?:in|into|inside|through)|push(?:es|ed|ing)?\s+(?:back\s+)?(?:in|into|inside|through|open)|return(?:s|ed|ing)?\s+(?:to|into)|rejoin(?:s|ed|ing)?|caught\s+up(?:\s+to|\s+with)?|closed\s+the\s+distance|blocked\s+the\s+(?:[\w-]+\s+){0,2}(?:passage|corridor|hall|hallway|way|exit|door)|forty\s+meters\s+ahead|opened\s+the\s+door\s+and\s+(?:stepped|walked|came|slipped)\s+(?:in|inside))\b/i;

const FACE_TO_FACE_SPEECH_RE = /(?:["“][^"”]{2,}["”]|(?:\bsaid\b|\basked\b|\breplied\b|\bcalled\s+out\b|\bmurmured\b|\bsighed\b|\bchuckled\b|\bdrawled\b|\bgrinned\b|\bsmiled\b|\bstepped\s+closer\b|\breached\s+out\b|\blanded\b|\bstood\b|\bleaned\s+against\b))/i;

const STAY_BEHIND_VERB_RE = /\b(?:stay(?:s|ed|ing)?|remain(?:s|ed|ing)?|wait(?:s|ed|ing)?|linger(?:s|ed|ing)?)\s+(?:behind|back|in\s+the\b|inside\s+the\b)/i;

const GROUP_MOVE_PRONOUN_RE = /\b(we|they|both(?:\s+of\s+(?:them|us))?|all\s+of\s+(?:them|us)|everyone|together|the\s+(?:two|three|group|party))\b/i;

function extractListeningVia(sentence) {
  const s = String(sentence || '');
  if (/\bfeather\b/i.test(s)) return 'covert feather';
  if (/\b(phone\s+call|on the phone|cell\s*phone|phone\s+line|dialed|dialled|calls?\s+(?:her|him|them)|answers?\s+(?:her|his|their)\s+phone|phone\s+(?:buzz|ring|rang)|voice\s+on\s+the\s+(?:phone|line))\b/i.test(s)) return 'phone';
  if (/\b(earpiece|comm|comms|radio|open\s+line|speakerphone)\b/i.test(s)) return 'comm link';
  if (/\b(bug|wire|mic|microphone|drone|camera|security\s+feed|audio\s+feed)\b/i.test(s)) return 'remote audio';
  if (/\b(service\s+corridor|corridor|hallway|hall)\b/i.test(s)) return 'from the corridor';
  if (/\b(door|wall|vent|transom|keyhole)\b/i.test(s)) return 'outside the door';
  return 'listening in';
}

function extractAwayLabel(sentence, compass, activePlaceId = '') {
  const s = String(sentence || '');
  const m = s.match(AWAY_DEST_RE);
  if (m && m[1]) return String(m[1]).trim().replace(/\s+/g, ' ');
  for (const place of Object.values(compass?.rooms || {})) {
    if (!place?.name || place.id === activePlaceId) continue;
    if (keyMentionStarts(s, place.name).length) return place.name;
  }
  if (/\bpromenade\b/i.test(s)) return 'promenade';
  if (/\bkiosk\b/i.test(s)) return 'kiosk';
  if (/\b(front\s+door|outside|out\s+front|street|sidewalk)\b/i.test(s)) return 'outside';
  return 'outside';
}

function memberNamesList(m) {
  return [m?.name, ...(Array.isArray(m?.aliases) ? m.aliases : [])]
    .map(x => String(x || '').trim())
    .filter(x => x.length >= 2);
}

function sentenceMentionsMember(sentence, m) {
  const names = memberNamesList(m);
  return names.some(nm => keyMentionStarts(sentence, nm).length > 0);
}

/**
 * Deterministic per-character narrative stance analysis across recent messages.
 * Tracks who departed/stepped outside, who is listening in remotely (privy),
 * who stayed behind in a previous room, and who is acting in the active room.
 */
export function analyzeCastSceneStances(chatMessages, castMembers = [], {
  compass = null,
  activePlaceId = '',
  windowSize = 4,
} = {}) {
  const out = new Map();
  const list = Array.isArray(castMembers) ? castMembers.filter(m => m && m.name) : [];
  if (!list.length) return out;

  const msgs = Array.isArray(chatMessages)
    ? chatMessages.filter(m => m && !m.is_system).slice(-Math.max(1, windowSize))
    : (typeof chatMessages === 'string' && chatMessages.trim() ? [{ mes: chatMessages }] : []);
  if (!msgs.length) return out;

  const activePlace = activePlaceId && compass?.rooms ? compass.rooms[activePlaceId] : null;
  const activeNames = activePlace
    ? [
      activePlace.name,
      ...(activePlace.aliases || []),
      ...(activePlace.locationTags || []),
      ...(/corridor|hall|passage/i.test(String(activePlace.name || ''))
        ? ['corridor', 'hallway', 'service corridor', 'delivery hallway']
        : []),
    ].map(x => String(x || '').trim()).filter(x => x.length >= 2)
    : [];
  const otherPlaces = Object.values(compass?.rooms || {}).filter(p => p && p.id !== activePlaceId && p.name);
  const prevPings = compass?.sonar?.pings && typeof compass.sonar.pings === 'object' ? compass.sonar.pings : {};

  for (const m of list) {
    const id = String(m.id || m.name);
    const prev = prevPings[id] || prevPings[String(m.name || '').trim().toLowerCase()];
    const alreadyInActiveRoom = Boolean(
      activePlaceId
      && prev?.placeId === activePlaceId
      && !prev?.away
      && !prev?.listening
      && memberPresence(m) !== 'privy',
    );
    out.set(id, {
      id,
      name: m.name,
      mentionedInLatest: false,
      inActiveRoom: alreadyInActiveRoom,
      enteredActiveRoom: false,
      departed: false,
      away: false,
      awayLabel: '',
      awayPlaceId: '',
      listening: false,
      listeningVia: '',
      stayedBehind: false,
    });
  }

  for (let mi = 0; mi < msgs.length; mi++) {
    const raw = String(msgs[mi]?.mes || '').replace(/<[^>]+>/g, ' ');
    if (!raw.trim()) continue;
    const isLatest = mi === msgs.length - 1;
    const paragraphs = raw.split(/\r?\n+/);

    for (const para of paragraphs) {
      if (!para.trim()) continue;
      const sentences = splitSentences(para);
      let activeSubjects = [];

      for (const sent of sentences) {
        const s = String(sent || '').trim();
        if (!s) continue;
        const namedHere = list.filter(m => sentenceMentionsMember(s, m));
        if (namedHere.length) {
          activeSubjects = namedHere;
          if (isLatest) {
            for (const m of namedHere) {
              const st = out.get(String(m.id || m.name));
              if (st) st.mentionedInLatest = true;
            }
          }
        }
        const subjects = namedHere.length ? namedHere : activeSubjects;
        if (!subjects.length) continue;

        const mentionsActiveRoom = activeNames.some(nm => keyMentionStarts(s, nm).length > 0);
        const hasListeningCue = LISTENING_CUE_RE.test(s);
        const hasProxySubject = /\b(feather|bug|wire|mic|microphone|drone|camera|familiar|voice|sound|phone|call)\b/i.test(s);
        const entersActiveRoom = mentionsActiveRoom && activeNames.some(nm =>
          new RegExp(`\\b(?:in|into|inside|to|toward|towards|down|along|across|within|enter(?:s|ed|ing)?|rejoin(?:s|ed|ing)?|return(?:s|ed|ing)?\\s+to)\\s+(?:the\\s+|a\\s+|an\\s+)?${escapeRe(nm)}\\b`, 'i').test(s));
        const exitsOtherRoom = otherPlaces.some(p =>
          [p.name, ...(p.aliases || []), ...(p.locationTags || [])].some(nm =>
            nm && nm.length >= 3 && new RegExp(`\\b(?:from|out\\s+of|out\\s+from|out\\s+through|through|left|leaving|exited|emerge(?:s|d|ing)?\\s+from)\\s+(?:the\\s+|a\\s+|an\\s+)?${escapeRe(nm)}(?:\\s+(?:room|door|doorway|area))?\\b`, 'i').test(s)))
          || /\b(?:from|out\s+of|out\s+from|through|emerge(?:s|d|ing)?\s+from)\s+(?:the\s+|a\s+|an\s+)?(?:storage(?:\s+room|\s+door|\s+doorway)?|break\s+room(?:\s+door|\s+doorway)?|back\s+room(?:\s+door|\s+doorway)?)\b/i.test(s);
        const entersOtherRoom = otherPlaces.some(p =>
          [p.name, ...(p.aliases || [])].some(nm =>
            nm && nm.length >= 3 && new RegExp(`\\b(?:into|inside|back\\s+into|back\\s+to)\\s+(?:the\\s+|a\\s+|an\\s+)?${escapeRe(nm)}\\b(?!\\s+(?:door|doorway))`, 'i').test(s)));
        const movingIntoActive = !hasProxySubject && (entersActiveRoom || (exitsOtherRoom && !entersOtherRoom));
        const hasDepartCue = !movingIntoActive && DEPART_CUE_RE.test(s);
        const hasEnterCue = !hasProxySubject && (movingIntoActive || (ENTER_ROOM_RE.test(s) && !hasDepartCue));

        // Check if "leaving <Name> behind/in..." applies to a specific named character
        if (/\bleaving\b/i.test(s)) {
          for (const m of namedHere) {
            for (const nm of memberNamesList(m)) {
              const leaveBehindRe = new RegExp(`\\bleaving\\s+(?:[^.!?]{0,20}\\b)?${escapeRe(nm)}\\b[^.!?]{0,30}\\b(?:in|inside|at|behind)\\b`, 'i');
              if (leaveBehindRe.test(s)) {
                const st = out.get(String(m.id || m.name));
                if (st) st.stayedBehind = true;
              }
            }
          }
        }

        // Check if only one character is the subject of a departure in a multi-character sentence
        for (const m of subjects) {
          const id = String(m.id || m.name);
          const st = out.get(id);
          if (!st) continue;
          const prev = prevPings[id] || prevPings[String(m.name || '').trim().toLowerCase()];

          if (STAY_BEHIND_VERB_RE.test(s) && namedHere.length === 1 && namedHere[0] === m) {
            st.stayedBehind = true;
          }

          if (hasDepartCue) {
            // If multiple characters are named in the sentence, verify the departure clause belongs to `m`
            let charDeparted = subjects.length === 1;
            if (!charDeparted) {
              for (const nm of memberNamesList(m)) {
                const clauseRe = new RegExp(`\\b${escapeRe(nm)}\\b[^.!?]{0,60}` + DEPART_CUE_RE.source, 'i');
                if (clauseRe.test(s)) {
                  charDeparted = true;
                  break;
                }
              }
            }
            if (charDeparted) {
              st.departed = true;
              st.away = true;
              st.inActiveRoom = false;
              st.enteredActiveRoom = false;
              st.awayLabel = extractAwayLabel(s, compass, activePlaceId);
              const matchedOther = otherPlaces.find(p =>
                keyMentionStarts(s, p.name).some(idx => isSettingFrame(s, p.name, idx))
                && !PROXY_INTO_LEFT.test(s.slice(0, keyMentionStarts(s, p.name)[0] || 0)));
              if (matchedOther && isCompassPlaceKind(matchedOther.kind)) {
                st.awayPlaceId = matchedOther.id;
              }
            }
          }

          const isPrivyOrAway = st.departed || st.away || memberPresence(m) === 'privy';
          const isOutOfRoom = isPrivyOrAway
            || st.stayedBehind
            || Boolean(activePlaceId && prev?.placeId && prev.placeId !== activePlaceId)
            || Boolean(prev?.away || prev?.listening);
          const hasPassiveFeather = PASSIVE_FEATHER_CUE_RE.test(s);
          const hasRemotePos = REMOTE_POSITION_EAVESDROP_RE.test(s);
          if (hasListeningCue || (isPrivyOrAway && hasPassiveFeather)) {
            let charListening = false;
            if (isPrivyOrAway) {
              charListening = true;
            } else if (hasListeningCue && namedHere.includes(m) && (!st.inActiveRoom || hasRemotePos)) {
              if (subjects.length === 1) {
                charListening = true;
              } else {
                for (const nm of memberNamesList(m)) {
                  const clauseRe = new RegExp(`\\b${escapeRe(nm)}\\b[^.!?]{0,80}` + LISTENING_CUE_RE.source, 'i');
                  if (clauseRe.test(s)) {
                    charListening = true;
                    break;
                  }
                }
              }
            }
            if (charListening) {
              st.listening = true;
              st.listeningVia = extractListeningVia(s);
              if (st.departed || !st.inActiveRoom || hasRemotePos) {
                st.away = true;
                st.inActiveRoom = false;
              }
            }
          }

          if (hasEnterCue && (mentionsActiveRoom || movingIntoActive || /\b(?:room|inside|back\s+in|rejoined|corridor|hall|hallway|passage|ahead|distance|through|open|door|doorway|storage|threshold|emerged)\b/i.test(s))) {
            let charEntered = subjects.length === 1;
            if (!charEntered) {
              for (const nm of memberNamesList(m)) {
                const clauseRe = new RegExp(`\\b${escapeRe(nm)}\\b[^.!?]{0,50}` + ENTER_ROOM_RE.source, 'i');
                if (clauseRe.test(s)) {
                  charEntered = true;
                  break;
                }
              }
            }
            if (charEntered) {
              st.stayedBehind = false;
              st.departed = false;
              st.away = false;
              st.awayLabel = '';
              st.awayPlaceId = '';
              st.listening = false;
              st.listeningVia = '';
              st.inActiveRoom = true;
              st.enteredActiveRoom = true;
            } else if (
              namedHere.includes(m)
              && !hasDepartCue
              && !hasListeningCue
              && !hasPassiveFeather
              && !hasRemotePos
              && (mentionsActiveRoom || movingIntoActive || FACE_TO_FACE_SPEECH_RE.test(s) || /\b(?:saw|sees|seeing|spotted|noticed|facing|beside|with|next\s+to|in\s+front\s+of)\b/i.test(s))
            ) {
              st.stayedBehind = false;
              st.departed = false;
              st.away = false;
              st.awayLabel = '';
              st.awayPlaceId = '';
              st.listening = false;
              st.listeningVia = '';
              st.inActiveRoom = true;
              st.enteredActiveRoom = true;
            }
          } else if (
            isOutOfRoom
            && namedHere.includes(m)
            && !hasDepartCue
            && !hasListeningCue
            && !hasPassiveFeather
            && !hasRemotePos
            && (mentionsActiveRoom || movingIntoActive || FACE_TO_FACE_SPEECH_RE.test(s))
          ) {
            const matchedOther = !mentionsActiveRoom && !movingIntoActive && otherPlaces.some(p =>
              keyMentionStarts(s, p.name).some(idx => isSettingFrame(s, p.name, idx)));
            if (!matchedOther) {
              st.stayedBehind = false;
              st.departed = false;
              st.away = false;
              st.awayLabel = '';
              st.awayPlaceId = '';
              st.listening = false;
              st.listeningVia = '';
              st.inActiveRoom = true;
              st.enteredActiveRoom = true;
            }
          } else if ((mentionsActiveRoom || movingIntoActive) && !hasDepartCue && !hasListeningCue && !st.departed && !st.away) {
            st.stayedBehind = false;
            st.inActiveRoom = true;
            st.enteredActiveRoom = true;
          }
        }
      }
    }
  }

  return out;
}

/**
 * Reconcile room.occupants across all rooms in `compass.rooms`:
 * 1. No character may occupy two different rooms simultaneously.
 * 2. Characters who are `privy` / `listening` or `away` (stepped outside) are
 *    removed from the physical `occupants` of the room they departed / are listening in on.
 * 3. Stale `sonar · ...` occupant records in rooms that no longer match `ping.placeId` are removed.
 */
export function reconcileRoomOccupants(compass, castMembers = []) {
  if (!compass?.rooms || typeof compass.rooms !== 'object') return compass;
  const pings = compass?.sonar?.pings || {};
  const byId = new Map();
  const byName = new Map();
  for (const m of castMembers || []) {
    if (!m?.name) continue;
    const id = String(m.id || m.name);
    byId.set(id, m);
    byName.set(String(m.name).trim().toLowerCase(), m);
  }
  for (const [id, p] of Object.entries(pings)) {
    if (!p?.name) continue;
    const nlow = String(p.name).trim().toLowerCase();
    const m = byId.get(id) || byName.get(nlow);
    const presence = m ? memberPresence(m) : 'inPlay';
    if ((presence === 'privy' || p.listening || p.away) && (!p.placeId || p.placeId === p.listeningPlaceId || p.placeId === p.departedFrom)) {
      removeOccupantEverywhere(compass, { name: p.name, castId: p.castId || id });
      continue;
    }
    if (p.placeId && compass.rooms[p.placeId]) {
      evictOccupantFromOtherRooms(compass, p.placeId, { name: p.name, castId: p.castId || id });
    }
  }
  for (const m of castMembers || []) {
    if (!m?.name) continue;
    const id = String(m.id || m.name);
    const presence = memberPresence(m);
    if (presence === 'privy') {
      const p = pings[id];
      if (!p?.placeId || p.placeId === (p.listeningPlaceId || compass.sonar?.lastPlaceId || compass.activeRoomId)) {
        removeOccupantEverywhere(compass, { name: m.name, castId: id });
      }
    }
  }

  // Deduplicate any person still appearing in multiple rooms' occupants arrays
  const seenLocations = new Map();
  const preferredRoomId = String(compass.sonar?.lastPlaceId || compass.activeRoomId || '').trim();
  const roomsList = Object.values(compass.rooms).filter(r => r && Array.isArray(r.occupants));
  roomsList.sort((a, b) => {
    const aPref = a.id === preferredRoomId ? 1 : 0;
    const bPref = b.id === preferredRoomId ? 1 : 0;
    if (aPref !== bPref) return bPref - aPref;
    return (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0);
  });
  for (const room of roomsList) {
    room.occupants = room.occupants.filter((occ) => {
      const nlow = String(occ?.name || '').trim().toLowerCase();
      const cid = String(occ?.castId || '').trim();
      const key = cid ? `id:${cid}` : `name:${nlow}`;
      if (!nlow && !cid) return false;
      const ping = (cid && pings[cid]) || Object.values(pings).find(p => String(p?.name || '').trim().toLowerCase() === nlow);
      if (ping) {
        if ((ping.listening || ping.away) && (!ping.placeId || ping.placeId === room.id) && (room.id === ping.listeningPlaceId || room.id === ping.departedFrom || !ping.placeId)) {
          return false;
        }
        if (ping.placeId && compass.rooms[ping.placeId] && ping.placeId !== room.id) {
          return false;
        }
      }
      if (seenLocations.has(key) || (nlow && seenLocations.has(`name:${nlow}`))) {
        return false;
      }
      seenLocations.set(key, room.id);
      if (nlow) seenLocations.set(`name:${nlow}`, room.id);
      return true;
    });
  }
  return compass;
}

/**
 * Lock a cast ping at last-known (existing ping, tracker place, or loaded room).
 * Occupant is a soft mirror of Set Park — skipped when there is no place.
 */
export function parkSonarAtLastKnown(compass, member) {
  if (!compass) return null;
  compass.sonar = compass.sonar && typeof compass.sonar === 'object' ? compass.sonar : { pings: {} };
  compass.sonar.pings = compass.sonar.pings && typeof compass.sonar.pings === 'object'
    ? compass.sonar.pings : {};
  const name = String(member?.name || '').trim();
  const id = String(member?.id || name);
  if (!id || !name) return null;
  const prev = compass.sonar.pings[id] || {};
  const placeId = String(prev.placeId || compass.sonar.lastPlaceId || compass.activeRoomId || '').trim();
  const cell = prev.cell || 'C';
  const ping = pinSonarPing(compass, member, { placeId, cell, locked: true });
  if (placeId) {
    try {
      addOccupant(compass, placeId, {
        name,
        cell,
        castId: id,
        description: 'parked',
      });
    } catch { /* missing / unloadable place */ }
  }
  return ping;
}

/** Park Absent / Written out; handle Privy (listening in); park In play only when they have no place ping yet. */
export function syncSonarPresence(compass, castMembers = []) {
  if (!compass) return compass;
  compass.sonar = compass.sonar && typeof compass.sonar === 'object' ? compass.sonar : { pings: {} };
  compass.sonar.pings = compass.sonar.pings && typeof compass.sonar.pings === 'object'
    ? compass.sonar.pings : {};
  const activeRoomId = String(compass.sonar.lastPlaceId || compass.activeRoomId || '').trim();
  for (const m of castMembers || []) {
    const name = String(m?.name || '').trim();
    const id = String(m?.id || name);
    if (!id || !name) continue;
    const presence = memberPresence(m);
    const prev = compass.sonar.pings[id] || {};
    if (presence === 'writtenOut' || presence === 'absent') {
      parkSonarAtLastKnown(compass, m);
      continue;
    }
    if (presence === 'privy') {
      const listenTarget = String(prev.listeningPlaceId || activeRoomId || prev.placeId || '').trim();
      compass.sonar.pings[id] = {
        ...prev,
        name,
        castId: id,
        placeId: prev.away && prev.placeId && prev.placeId !== listenTarget ? prev.placeId : '',
        cell: prev.cell || 'C',
        key: prev.key || compass.sonar.lastKey || '',
        at: prev.at || Date.now(),
        locked: false,
        away: true,
        awayLabel: prev.awayLabel || 'outside',
        departedFrom: prev.departedFrom || listenTarget,
        listening: true,
        listeningVia: prev.listeningVia || 'listening in',
        listeningPlaceId: listenTarget,
      };
      removeOccupantEverywhere(compass, { name, castId: id });
      continue;
    }
    if (presence === 'inPlay') {
      const hasPrivyPeer = (castMembers || []).some(other => other && other !== m && memberPresence(other) === 'privy');
      const manualRestore = Boolean(m?.manual && activeRoomId);
      if (manualRestore || (prev.listening && prev.listeningVia === 'covert feather' && hasPrivyPeer)) {
        const restorePlace = String(activeRoomId || prev.departedFrom || prev.placeId || '').trim();
        compass.sonar.pings[id] = {
          ...prev,
          name,
          castId: id,
          placeId: restorePlace,
          cell: prev.cell || 'S',
          at: Date.now(),
          locked: false,
          away: false,
          awayLabel: '',
          departedFrom: '',
          listening: false,
          listeningVia: '',
          listeningPlaceId: '',
        };
        if (restorePlace && compass.rooms?.[restorePlace] && isCompassPlaceKind(compass.rooms[restorePlace].kind)) {
          evictOccupantFromOtherRooms(compass, restorePlace, { name, castId: id });
          try {
            addOccupant(compass, restorePlace, { name, cell: prev.cell || 'S', castId: id, description: 'sonar' });
          } catch { /* ignore */ }
        }
        continue;
      }
      if (!String(prev.placeId || '').trim() && !prev.away && !prev.listening) {
        parkSonarAtLastKnown(compass, m);
      }
    }
  }
  reconcileRoomOccupants(compass, castMembers);
  return compass;
}

/**
 * Apply sonar pings: last location key in latest message → last-known place/area
 * for cast members, respecting per-character departures, split scenes, and
 * remote listening (`privy`).
 *
 * @param {object} compass
 * @param {object} opts
 * @param {Array<{id?:string,name:string}>} opts.castMembers
 * @param {object} opts.storage
 * @param {Array} opts.chat
 * @param {string} [opts.heldPlaceId]
 * @returns {{ key: string, placeId: string, pings: object } | null}
 */
export function applySonarPings(compass, {
  castMembers = [],
  storage = null,
  chat = null,
  heldPlaceId = '',
  afterTs = 0,
} = {}) {
  if (!compass || typeof compass !== 'object') return null;
  compass.sonar = compass.sonar && typeof compass.sonar === 'object' ? compass.sonar : { pings: {} };
  compass.sonar.pings = compass.sonar.pings && typeof compass.sonar.pings === 'object'
    ? compass.sonar.pings
    : {};

  const validHeldId = heldPlaceId && compass.rooms?.[heldPlaceId] ? String(heldPlaceId).trim() : '';

  pruneStaleSonar(compass);
  syncSonarPresence(compass, castMembers);

  const hit = resolveLastLocationPing(compass, storage, chat);
  const newestMsg = Array.isArray(chat) && chat.length ? chat[chat.length - 1] : null;
  const newestAt = parseMsgTimestamp(newestMsg);
  const staleHit = Boolean(
    validHeldId
    && hit?.placeId
    && hit.placeId !== validHeldId
    && Number(afterTs) > 0
    && newestAt > 0
    && newestAt <= Number(afterTs),
  );
  if (validHeldId && (!hit?.placeId || staleHit || hit.placeId === validHeldId)) {
    compass.sonar.lastPlaceId = validHeldId;
    compass.sonar.lastKey = compass.rooms[validHeldId]?.name || compass.sonar.lastKey || '';
  }

  const currentPlaceId = String(compass.sonar.lastPlaceId || '').trim();
  const fallbackPlaceId = String(currentPlaceId || compass.activeRoomId || '').trim();

  if (!hit?.key || staleHit) {
    if (fallbackPlaceId && Array.isArray(chat) && chat.length) {
      const stances = analyzeCastSceneStances(chat, castMembers, { compass, activePlaceId: fallbackPlaceId });
      applyStanceOverridesToPings(compass, castMembers, stances, {
        targetPlaceId: fallbackPlaceId,
        targetKey: compass.rooms?.[fallbackPlaceId]?.name || compass.sonar.lastKey || '',
        area: 'C',
        onlyDepartedOrListening: true,
        heldPlaceId: validHeldId,
      });
    }
    reconcileRoomOccupants(compass, castMembers);
    pruneStaleSonar(compass);
    return { key: compass.sonar.lastKey || '', placeId: compass.sonar.lastPlaceId || '', pings: compass.sonar.pings };
  }

  if (currentPlaceId && isCoarserPingOf(compass, currentPlaceId, hit)) {
    const stances = analyzeCastSceneStances(chat, castMembers, { compass, activePlaceId: currentPlaceId });
    applyStanceOverridesToPings(compass, castMembers, stances, {
      targetPlaceId: currentPlaceId,
      targetKey: compass.sonar.lastKey || hit.key,
      area: 'C',
      onlyDepartedOrListening: true,
      heldPlaceId: validHeldId,
    });
    reconcileRoomOccupants(compass, castMembers);
    pruneStaleSonar(compass);
    return {
      key: compass.sonar.lastKey || hit.key,
      placeId: currentPlaceId,
      pings: compass.sonar.pings,
    };
  }
  const newestMes = Array.isArray(chat) && chat.length ? String(chat[chat.length - 1]?.mes || '') : '';
  if (currentPlaceId && isDescendantPingOf(compass, currentPlaceId, hit)) {
    const finerKey = String(hit.rawKey || hit.key || '').trim();
    if (!confirmSettingHere(newestMes, finerKey)) {
      reconcileRoomOccupants(compass, castMembers);
      pruneStaleSonar(compass);
      return {
        key: compass.sonar.lastKey || hit.key,
        placeId: currentPlaceId,
        pings: compass.sonar.pings,
      };
    }
  }

  const lastMes = newestMes || hit.text || '';
  const area = inferAreaFromText(lastMes, 'C');
  const now = Date.now();
  const prevScenePlaceId = compass.sonar.lastPlaceId || '';
  compass.sonar.lastKey = hit.key;
  compass.sonar.lastPlaceId = hit.placeId || '';
  compass.sonar.lastAt = now;

  const stances = analyzeCastSceneStances(chat, castMembers, {
    compass,
    activePlaceId: hit.placeId || prevScenePlaceId,
  });

  applyStanceOverridesToPings(compass, castMembers, stances, {
    targetPlaceId: hit.placeId || '',
    prevScenePlaceId,
    targetKey: hit.key,
    area,
    now,
    lastMes,
    onlyDepartedOrListening: false,
    heldPlaceId: validHeldId,
  });

  pruneStaleSonar(compass);
  reconcileRoomOccupants(compass, castMembers);

  return { key: hit.key, placeId: hit.placeId, pings: compass.sonar.pings };
}

function applyStanceOverridesToPings(compass, castMembers, stances, {
  targetPlaceId = '',
  prevScenePlaceId = '',
  targetKey = '',
  area = 'C',
  now = Date.now(),
  lastMes = '',
  onlyDepartedOrListening = false,
  heldPlaceId = '',
} = {}) {
  const exclude = new Set((compass.sonar.excludeIds || []).map(id => String(id)));
  const anyNamedInActiveRoom = [...stances.values()].some(st => st.inActiveRoom && !st.departed && !st.stayedBehind);
  const hasGroupPronoun = GROUP_MOVE_PRONOUN_RE.test(String(lastMes || ''));

  for (const m of castMembers || []) {
    const name = String(m?.name || '').trim();
    if (!name) continue;
    const id = String(m.id || name);
    const presence = memberPresence(m);
    if (presence === 'writtenOut' || presence === 'absent') continue;
    if (exclude.has(id) || exclude.has(name)) continue;

    const prev = compass.sonar.pings[id] || compass.sonar.pings[name.toLowerCase()];
    const st = stances.get(id);
    // A locked ping (manual Set Park, or a default first-time park with no
    // known location yet) should resist passive narrative drift — but it must
    // NOT suppress a departure/listening cue the current message just gave us
    // in plain text (e.g. a brand-new character picking up a phone call).
    const freshListenOrDepart = !st?.enteredActiveRoom && (presence === 'privy' || st?.listening || st?.departed);
    if (prev?.locked && !freshListenOrDepart) continue;

    // 1. Character departed / stepped outside or is listening in remotely
    if (freshListenOrDepart) {
      const awayPlaceId = st?.awayPlaceId || (prev?.away && prev?.placeId !== targetPlaceId ? prev.placeId : '');
      const listening = presence === 'privy' || !!st?.listening;
      const awayLabel = st?.awayLabel || prev?.awayLabel || 'outside';
      const listeningVia = st?.listeningVia || prev?.listeningVia || (presence === 'privy' ? 'listening in' : '');
      compass.sonar.pings[id] = {
        name,
        castId: id,
        placeId: awayPlaceId || '',
        cell: awayPlaceId ? 'C' : (prev?.cell || area),
        key: awayPlaceId ? (compass.rooms?.[awayPlaceId]?.name || targetKey) : targetKey || (prev?.key || ''),
        at: now,
        locked: false,
        away: true,
        awayLabel,
        departedFrom: targetPlaceId || prev?.departedFrom || prevScenePlaceId || '',
        listening,
        listeningVia,
        listeningPlaceId: listening ? (targetPlaceId || prev?.listeningPlaceId || prevScenePlaceId || '') : '',
      };
      if (awayPlaceId && compass.rooms?.[awayPlaceId] && isCompassPlaceKind(compass.rooms[awayPlaceId].kind)) {
        try {
          addOccupant(compass, awayPlaceId, {
            name,
            cell: 'C',
            facing: 'N',
            castId: id,
            description: `sonar · ${compass.rooms[awayPlaceId].name || awayPlaceId}`,
          });
        } catch { /* ignore */ }
      } else {
        removeOccupantEverywhere(compass, { name, castId: id });
      }
      continue;
    }

    if (onlyDepartedOrListening) {
      const heldReconcile = Boolean(
        heldPlaceId
        && heldPlaceId === targetPlaceId
        && presence === 'inPlay'
        && !st?.stayedBehind
        && (prev?.away || prev?.listening || (prev?.placeId && prev.placeId !== targetPlaceId)),
      );
      const narrativeReentry = Boolean(
        (st?.enteredActiveRoom || st?.inActiveRoom)
        && (prev?.away || prev?.listening || presence === 'privy' || (prev?.placeId && targetPlaceId && prev.placeId !== targetPlaceId)),
      );
      if (heldReconcile || narrativeReentry) {
        if (m && m.presence === 'privy') m.presence = 'inPlay';
        const roomPlaceId = targetPlaceId || prev?.placeId || '';
        compass.sonar.pings[id] = {
          name,
          castId: id,
          placeId: roomPlaceId,
          cell: area,
          key: targetKey || prev?.key || '',
          at: now,
          locked: false,
          away: false,
          awayLabel: '',
          departedFrom: '',
          listening: false,
          listeningVia: '',
          listeningPlaceId: '',
        };
        if (roomPlaceId && compass.rooms?.[roomPlaceId] && isCompassPlaceKind(compass.rooms[roomPlaceId].kind)) {
          evictOccupantFromOtherRooms(compass, roomPlaceId, { name, castId: id });
          try {
            addOccupant(compass, roomPlaceId, {
              name,
              cell: area,
              facing: 'N',
              castId: id,
              description: `sonar · ${targetKey || compass.rooms[roomPlaceId].name || roomPlaceId}`,
            });
          } catch { /* ignore */ }
        }
      }
      continue;
    }

    // 2. Previously away or listening, and did NOT re-enter the room this turn
    if ((prev?.away || prev?.listening) && !st?.enteredActiveRoom && !(heldPlaceId && heldPlaceId === targetPlaceId && presence === 'inPlay')) {
      // If the scene itself moved out to the place where they were waiting, reunite them!
      if (targetPlaceId && prev.placeId && targetPlaceId === prev.placeId) {
        if (m && m.presence === 'privy') m.presence = 'inPlay';
        compass.sonar.pings[id] = {
          ...prev,
          placeId: targetPlaceId,
          cell: prev.cell || area,
          key: targetKey,
          at: now,
          away: false,
          awayLabel: '',
          departedFrom: '',
          listening: false,
          listeningVia: '',
          listeningPlaceId: '',
        };
      } else {
        // Keep them outside / listening on the current target room
        if (prev.listening && targetPlaceId) {
          prev.listeningPlaceId = targetPlaceId;
        }
        removeOccupantEverywhere(compass, { name, castId: id });
        continue;
      }
    }

    // 3. Character stayed behind in the previous room during a split move
    const priorRoomId = prev?.placeId || prevScenePlaceId || '';
    const roomChanged = priorRoomId && targetPlaceId && priorRoomId !== targetPlaceId;
    const sceneChangedRoom = Boolean(prevScenePlaceId && targetPlaceId && prevScenePlaceId !== targetPlaceId);
    const unmentionedSplit = roomChanged
      && (sceneChangedRoom || !heldPlaceId || heldPlaceId !== targetPlaceId)
      && anyNamedInActiveRoom
      && !hasGroupPronoun
      && st
      && !st.mentionedInLatest
      && !st.inActiveRoom;
    if (roomChanged && (st?.stayedBehind || unmentionedSplit)) {
      compass.sonar.pings[id] = {
        ...(prev || {}),
        name,
        castId: id,
        placeId: priorRoomId,
        cell: prev?.cell || 'S',
        key: compass.rooms?.[priorRoomId]?.name || prev?.key || '',
        at: prev?.at || now,
        locked: false,
        away: false,
        awayLabel: '',
        departedFrom: '',
        listening: false,
        listeningVia: '',
        listeningPlaceId: '',
      };
      evictOccupantFromOtherRooms(compass, priorRoomId, { name, castId: id });
      continue;
    }

    // 4. Normal physical presence in the target room
    if (st?.enteredActiveRoom && m && m.presence === 'privy') {
      m.presence = 'inPlay';
    }
    const samePlace = prev?.placeId && targetPlaceId && prev.placeId === targetPlaceId;
    const cell = samePlace && prev?.cell ? prev.cell : area;
    compass.sonar.pings[id] = {
      name,
      castId: id,
      placeId: targetPlaceId || prev?.placeId || '',
      cell,
      key: targetKey,
      at: now,
      locked: false,
      away: false,
      awayLabel: '',
      departedFrom: '',
      listening: false,
      listeningVia: '',
      listeningPlaceId: '',
    };

    if (targetPlaceId) {
      const room = getPlace(compass, targetPlaceId);
      if (room && isCompassPlaceKind(room.kind) && Array.isArray(room.occupants)) {
        evictOccupantFromOtherRooms(compass, targetPlaceId, { name, castId: id });
        const existing = room.occupants.find(o =>
          (id && o.castId && String(o.castId) === id)
          || o.name.toLowerCase() === name.toLowerCase());
        if (existing) {
          existing.cell = cell;
          existing.castId = existing.castId || id;
        } else {
          room.occupants.push({
            name,
            cell,
            facing: 'N',
            castId: id,
            description: `sonar · ${targetKey}`,
          });
        }
      }
    }
  }
}

/** Physical sonar pings in `placeId` (excludes away / remote-listening pings). */
export function listSonarPingsInPlace(compass, placeId) {
  const pings = compass?.sonar?.pings || {};
  const id = String(placeId || '');
  return Object.values(pings).filter(p => p?.placeId === id && !p?.away && !p?.listening);
}

/** Pings of characters who are remotely listening in (`privy`) on `placeId` without physical presence. */
export function listListeningPingsForPlace(compass, placeId = '') {
  const pings = compass?.sonar?.pings || {};
  const id = String(placeId || compass?.sonar?.lastPlaceId || compass?.activeRoomId || '').trim();
  return Object.values(pings).filter((p) => {
    if (!p?.name || !p.listening) return false;
    if (!id) return true;
    const target = String(p.listeningPlaceId || p.departedFrom || '').trim();
    return !target || target === id || p.placeId !== id;
  });
}

/** Pings of in-play characters who stepped out of `placeId` (not listening in). */
export function listAwayPingsForPlace(compass, placeId = '') {
  const pings = compass?.sonar?.pings || {};
  const id = String(placeId || compass?.sonar?.lastPlaceId || compass?.activeRoomId || '').trim();
  return Object.values(pings).filter((p) => {
    if (!p?.name || !p.away || p.listening) return false;
    if (!id) return true;
    const from = String(p.departedFrom || '').trim();
    return !from || from === id;
  });
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

export function setSonarListening(compass, member, {
  listening = true,
  listeningVia = 'listening in',
  awayLabel = 'outside',
  listeningPlaceId = '',
} = {}) {
  if (!compass?.sonar) return null;
  compass.sonar.pings = compass.sonar.pings && typeof compass.sonar.pings === 'object'
    ? compass.sonar.pings : {};
  const name = String(member?.name || '').trim();
  const id = String(member?.id || name);
  if (!id || !name) return null;
  const prev = compass.sonar.pings[id] || {};
  const targetRoomId = String(listeningPlaceId || compass.sonar.lastPlaceId || compass.activeRoomId || prev.placeId || '').trim();
  if (listening) {
    compass.sonar.pings[id] = {
      ...prev,
      name,
      castId: id,
      placeId: prev.away && prev.placeId && prev.placeId !== targetRoomId ? prev.placeId : '',
      cell: prev.cell || 'C',
      at: Date.now(),
      locked: false,
      away: true,
      awayLabel: awayLabel || prev.awayLabel || 'outside',
      departedFrom: targetRoomId,
      listening: true,
      listeningVia: listeningVia || prev.listeningVia || 'listening in',
      listeningPlaceId: targetRoomId,
    };
    removeOccupantEverywhere(compass, { name, castId: id });
  } else {
    const restorePlace = targetRoomId || prev.departedFrom || prev.placeId || '';
    compass.sonar.pings[id] = {
      ...prev,
      name,
      castId: id,
      placeId: restorePlace,
      cell: prev.cell || 'C',
      at: Date.now(),
      locked: false,
      away: false,
      awayLabel: '',
      departedFrom: '',
      listening: false,
      listeningVia: '',
      listeningPlaceId: '',
    };
    if (restorePlace && compass.rooms?.[restorePlace] && isCompassPlaceKind(compass.rooms[restorePlace].kind)) {
      try {
        addOccupant(compass, restorePlace, { name, cell: prev.cell || 'C', castId: id, description: 'sonar' });
      } catch { /* ignore */ }
    }
  }
  return compass.sonar.pings[id];
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
    away: false,
    awayLabel: '',
    departedFrom: '',
    listening: false,
    listeningVia: '',
    listeningPlaceId: '',
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
    .map(([id, p]) => `${id}:${p?.placeId || ''}:${p?.cell || ''}:${p?.key || ''}:${p?.locked ? '1' : '0'}:${p?.away ? '1' : '0'}:${p?.awayLabel || ''}:${p?.listening ? '1' : '0'}:${p?.listeningVia || ''}:${p?.listeningPlaceId || ''}`)
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
    const standable = isCompassPlaceKind(lastPlace.kind);
    notes.push({
      severity: 'info',
      text: !standable
        ? `Last key “${lastKey}” → ${lastPlace.name} (outside — area / city / country).`
        : loaded
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

/**
 * Retired. This used to force Saving Asset 515-O back to the break-room
 * eavesdrop (Mrs. Okisato in the Break Room, Hawks privy on the promenade)
 * whenever sonar ran. The "already applied" flag did not survive
 * normalizeSonar, so every reload rewrote the cast and saved that snapshot.
 * Positions now come from the compass, cast presence, and the live narrative.
 */
export function pinNarratedSplitScene() {
  return false;
}

export function smokeSonarLocationPure() {
  try {
  if (keyMentionIndex('Japanese breakfast in Fukuoka', 'Japan') >= 0) return 'japan-in-japanese';
  if (keyMentionIndex('back in Japan after the trip', 'Japan') < 0) return 'japan-token';
  if (keyMentionIndex('Canal City Mall was packed', 'Canal City Mall') < 0) return 'mall-phrase';
  const rooms = {
    jp: { id: 'jp', name: 'Japan', kind: 'region', parentId: '' },
    mall: { id: 'mall', name: 'Canal City Mall', kind: 'district', parentId: 'jp' },
    shop: { id: 'shop', name: 'Okisato Antiques', kind: 'building', parentId: 'jp', locationTags: ['Japan'] },
    other: { id: 'other', name: 'Tokyo', kind: 'settlement', parentId: 'jp' },
  };
  const compass = { rooms };
  if (!isCoarserPingOf(compass, 'shop', { key: 'Japan', placeId: 'jp', rank: 2 })) return 'keep-shop';
  if (isCoarserPingOf(compass, 'shop', { key: 'Tokyo', placeId: 'other', rank: 3 })) return 'switch-city';
  if (isSettingFrame('We talked about Japan.', 'Japan')) return 'talked-about-setting';
  if (isSettingFrame('She asked about Fukuoka.', 'Fukuoka')) return 'asked-about-setting';
  if (isSettingFrame('She mentioned Fukuoka.', 'Fukuoka')) return 'mentioned-setting';
  if (isSettingFrame("Let's go to Tokyo.", 'Tokyo')) return 'plan-setting';
  if (!isSettingFrame('They stepped into Okisato Antiques.', 'Okisato Antiques')) return 'stepped-into-miss';
  if (isSettingFrame('She looked at the Plaza.', 'Plaza')) return 'looked-at-setting';
  if (isSettingFrame('He stared toward Fukuoka.', 'Fukuoka')) return 'stared-toward-setting';
  if (!isSettingFrame('They watched the crowd in the Plaza.', 'Plaza')) return 'watched-in-miss';
  if (!isSettingFrame('Canal City Mall was packed', 'Canal City Mall')) return 'mall-copula-miss';
  if (!isSettingFrame('back in Japan after the trip', 'Japan')) return 'back-in-miss';
  if (confirmSettingHere('We talked about Japan.', 'Japan')) return 'confirm-mention';
  if (!confirmSettingHere('They stepped into Okisato Antiques.', 'Okisato Antiques')) return 'confirm-setting';
  const talk = resolveLastLocationPing(compass, null, [{ mes: 'We talked about Japan.' }]);
  if (talk) return `mention-ping ${talk.key}`;
  const asked = resolveLastLocationPing(compass, null, [{ mes: 'She asked about Fukuoka.' }]);
  if (asked) return `asked-ping ${asked.key}`;
  const arrived = resolveLastLocationPing(compass, null, [{ mes: 'They stepped into Okisato Antiques.' }]);
  if (arrived?.placeId !== 'shop') return `setting-ping ${JSON.stringify(arrived)}`;
  const packed = resolveLastLocationPing(compass, null, [{ mes: 'Canal City Mall was packed' }]);
  if (packed?.placeId !== 'mall') return `mall-ping ${JSON.stringify(packed)}`;
  const back = resolveLastLocationPing(compass, null, [{ mes: 'back in Japan after the trip' }]);
  if (back?.placeId !== 'jp') return `back-in-ping ${JSON.stringify(back)}`;
  const stay = {
    rooms,
    sonar: {
      pings: { a: { name: 'Ada', castId: 'a', placeId: 'shop', cell: 'C', locked: false } },
      lastPlaceId: 'shop',
      lastKey: 'Okisato Antiques',
    },
  };
  applySonarPings(stay, {
    castMembers: [{ id: 'a', name: 'Ada', presence: 'inPlay' }],
    storage: null,
    chat: [{ mes: 'We talked about Japan.' }],
  });
  if (stay.sonar.lastPlaceId !== 'shop' || stay.sonar.pings.a?.placeId !== 'shop') {
    return `mention-moved ${stay.sonar.lastPlaceId}`;
  }
  const move = {
    rooms,
    sonar: {
      pings: { a: { name: 'Ada', castId: 'a', placeId: 'other', cell: 'C', locked: false } },
      lastPlaceId: 'other',
      lastKey: 'Tokyo',
    },
  };
  applySonarPings(move, {
    castMembers: [{ id: 'a', name: 'Ada', presence: 'inPlay' }],
    storage: null,
    chat: [{ mes: 'They stepped into Okisato Antiques.' }],
  });
  if (move.sonar.lastPlaceId !== 'shop' || move.sonar.pings.a?.placeId !== 'shop') {
    return `setting-stayed ${move.sonar.lastPlaceId}`;
  }
  const nested = {
    jp: { id: 'jp', name: 'Japan', kind: 'region', parentId: '' },
    mall: { id: 'mall', name: 'Canal City Mall', kind: 'district', parentId: 'jp' },
    shop: { id: 'shop', name: 'Okisato Antiques', kind: 'building', parentId: 'mall' },
  };
  const outdoor = {
    rooms: nested,
    sonar: {
      pings: { a: { name: 'Ada', castId: 'a', placeId: 'mall', cell: 'C', locked: false } },
      lastPlaceId: 'mall',
      lastKey: 'Canal City Mall',
    },
  };
  applySonarPings(outdoor, {
    castMembers: [{ id: 'a', name: 'Ada', presence: 'inPlay' }],
    storage: null,
    chat: [
      { mes: 'They stepped into Okisato Antiques.' },
      { mes: 'The concourse was loud.' },
    ],
  });
  if (outdoor.sonar.lastPlaceId !== 'mall') {
    return `leave-snapped-back ${outdoor.sonar.lastPlaceId}`;
  }
  applySonarPings(outdoor, {
    castMembers: [{ id: 'a', name: 'Ada', presence: 'inPlay' }],
    storage: null,
    chat: [
      { mes: 'They stepped into Okisato Antiques.' },
    ],
  });
  if (outdoor.sonar.lastPlaceId !== 'shop') {
    return `reenter-missed ${outdoor.sonar.lastPlaceId}`;
  }

  // Eavesdropping / Covert feather + Break Room door + Multi-room occupant dedup test
  const suiteCompass = {
    activeRoomId: 'brk',
    rooms: {
      suite: { id: 'suite', name: 'Okisato Antiques', kind: 'building', parentId: '' },
      brk: {
        id: 'brk',
        name: 'Break Room',
        kind: 'room',
        parentId: 'suite',
        occupants: [
          { name: 'Weslie', cell: 'S', castId: 'w' },
          { name: 'Hawks', cell: 'S', castId: 'h' },
          { name: 'Mrs. Okisato', cell: 'S', castId: 'o' },
        ],
      },
      sto: {
        id: 'sto',
        name: 'Storage',
        kind: 'room',
        parentId: 'suite',
        occupants: [
          { name: 'Weslie', cell: 'S', castId: 'w' },
          { name: 'Hawks', cell: 'S', castId: 'h' },
          { name: 'Mrs. Okisato', cell: 'S', castId: 'o' },
        ],
      },
      cor: {
        id: 'cor',
        name: 'Service Corridor',
        kind: 'room',
        parentId: 'suite',
        occupants: [],
      },
    },
    sonar: {
      pings: {
        w: { name: 'Weslie', castId: 'w', placeId: 'brk', cell: 'S', locked: false },
        h: { name: 'Hawks', castId: 'h', placeId: 'brk', cell: 'S', locked: false },
        o: { name: 'Mrs. Okisato', castId: 'o', placeId: 'brk', cell: 'S', locked: false },
      },
      lastPlaceId: 'brk',
      lastKey: 'Break Room',
    },
  };
  const suiteCast = [
    { id: 'w', name: 'Weslie', presence: 'inPlay' },
    { id: 'h', name: 'Hawks', presence: 'inPlay' },
    { id: 'o', name: 'Mrs. Okisato', presence: 'inPlay' },
  ];
  applySonarPings(suiteCompass, {
    castMembers: suiteCast,
    storage: null,
    chat: [{
      mes: 'Hawks left through the front door and wandered to a crepe kiosk on the promenade, but he sent a covert feather into the service corridor. Mrs. Okisato shut the break room door and spoke to Weslie.',
    }],
  });
  if (suiteCompass.sonar.lastPlaceId !== 'brk') {
    return `hawks-feather-hijacked-room ${suiteCompass.sonar.lastPlaceId}`;
  }
  const hPing = suiteCompass.sonar.pings.h;
  if (!hPing?.away || !hPing?.listening || hPing?.placeId === 'brk') {
    return `hawks-not-listening-away ${JSON.stringify(hPing)}`;
  }
  if (suiteCompass.rooms.brk.occupants.some(o => o.name === 'Hawks')) {
    return `hawks-still-in-break-room ${JSON.stringify(suiteCompass.rooms.brk.occupants)}`;
  }
  if (suiteCompass.rooms.sto.occupants.length > 0) {
    return `storage-duplicate-occupants-remained ${JSON.stringify(suiteCompass.rooms.sto.occupants)}`;
  }
  applySonarPings(suiteCompass, {
    castMembers: [
      { id: 'w', name: 'Weslie', presence: 'inPlay' },
      { id: 'h', name: 'Hawks', presence: 'privy' },
      { id: 'o', name: 'Mrs. Okisato', presence: 'inPlay' },
    ],
    storage: null,
    chat: [{
      mes: 'Mrs. Okisato glanced toward the display floor. The red feather still lay on the rug\'s edge near the low case. She had left it there. In the Break Room, she asked Weslie, "Do you understand what I am saying?"',
    }],
  });
  const oPing = suiteCompass.sonar.pings.o;
  if (oPing?.away || oPing?.listening || oPing?.placeId !== 'brk') {
    return `okisato-falsely-flagged-listening ${JSON.stringify(oPing)}`;
  }
  if (!suiteCompass.rooms.brk.occupants.some(o => o.name === 'Mrs. Okisato')) {
    return `okisato-evicted-from-break-room ${JSON.stringify(suiteCompass.rooms.brk.occupants)}`;
  }

  // Room synonym + Service Corridor transition + privy re-entry (Saving Asset 515-O MSG 21, 31-32)
  suiteCompass.rooms.show = {
    id: 'show',
    name: 'Main Showroom',
    kind: 'room',
    parentId: 'suite',
    occupants: [],
  };
  const showHit = resolveLastLocationPing(suiteCompass, null, [{
    mes: 'By 2:47pm Weslie had polished and sorted all three boxes, and swept the display room floor.',
  }]);
  if (showHit?.placeId !== 'show') {
    return `display-room-floor-synonym-miss ${JSON.stringify(showHit)}`;
  }
  const cast31 = [
    { id: 'w', name: 'Weslie', presence: 'inPlay' },
    { id: 'h', name: 'Hawks', presence: 'privy' },
    { id: 'o', name: 'Mrs. Okisato', presence: 'inPlay' },
  ];
  applySonarPings(suiteCompass, {
    castMembers: cast31,
    storage: null,
    chat: [
      {
        mes: 'Weslie steps into the storage room, and pushes through the employee exit into the long concrete service corridor.',
      },
      {
        mes: 'Hawks slipped inside. The delivery hallway reeked of wet cardboard. Forty meters ahead, Weslie moved at a clipped walk. Hawks said, "Wait up, kid."',
      },
    ],
  });
  if (suiteCompass.sonar.lastPlaceId !== 'cor') {
    return `service-corridor-transition-miss ${suiteCompass.sonar.lastPlaceId}`;
  }
  const hAfter = suiteCompass.sonar.pings.h;
  if (hAfter?.away || hAfter?.listening || hAfter?.placeId !== 'cor' || cast31[1].presence !== 'inPlay') {
    return `hawks-privy-reentry-miss ping=${JSON.stringify(hAfter)} presence=${cast31[1].presence}`;
  }
  const oAfter = suiteCompass.sonar.pings.o;
  if (oAfter?.placeId !== 'brk') {
    return `okisato-dragged-to-corridor ${JSON.stringify(oAfter)}`;
  }
  if (!suiteCompass.rooms.cor.occupants.some(o => o.name === 'Hawks')
    || !suiteCompass.rooms.cor.occupants.some(o => o.name === 'Weslie')
    || suiteCompass.rooms.cor.occupants.some(o => o.name === 'Mrs. Okisato')) {
    return `corridor-occupants-mismatch ${JSON.stringify(suiteCompass.rooms.cor.occupants)}`;
  }

  // Mrs. Okisato emerges from storage into Service Corridor where Hawks & Weslie are (Saving Asset 515-O)
  applySonarPings(suiteCompass, {
    castMembers: cast31,
    storage: null,
    heldPlaceId: 'cor',
    chat: [
      {
        mes: 'Hawks left through the front door and wandered to a crepe kiosk on the 2F Promenade.',
      },
      {
        mes: 'Weslie steps into the storage room, and pushes through the employee exit into the long concrete service corridor.',
      },
      {
        mes: 'Hawks slipped inside. The delivery hallway reeked of wet cardboard. Forty meters ahead, Weslie moved at a clipped walk. Hawks said, "Wait up, kid."',
      },
      {
        mes: 'Mrs. Okisato steps into the service corridor from storage, sees Hawks and Weslie.',
      },
    ],
  });
  if (suiteCompass.sonar.pings.o?.placeId !== 'cor' || suiteCompass.sonar.pings.o?.away) {
    return `okisato-corridor-entry-miss ${JSON.stringify(suiteCompass.sonar.pings.o)}`;
  }
  if (suiteCompass.sonar.pings.h?.placeId !== 'cor' || suiteCompass.sonar.pings.h?.away) {
    return `hawks-corridor-retained-miss ${JSON.stringify(suiteCompass.sonar.pings.h)}`;
  }
  if (!suiteCompass.rooms.cor.occupants.some(o => o.name === 'Mrs. Okisato')
    || !suiteCompass.rooms.cor.occupants.some(o => o.name === 'Hawks')
    || !suiteCompass.rooms.cor.occupants.some(o => o.name === 'Weslie')
    || suiteCompass.rooms.brk.occupants.some(o => o.name === 'Mrs. Okisato')) {
    return `corridor-all-three-occupants-miss cor=${JSON.stringify(suiteCompass.rooms.cor.occupants)} brk=${JSON.stringify(suiteCompass.rooms.brk.occupants)}`;
  }

  // A character calling in on a phone is remote, same as a bug/feather —
  // should flip to listening/away, not get dragged into the room.
  const dupCompass = {
    activeRoomId: 'dup',
    rooms: {
      dup: { id: 'dup', name: "Weslie's Duplex", kind: 'unit', parentId: '', occupants: [] },
    },
    sonar: { pings: {}, lastPlaceId: 'dup', lastKey: "Weslie's Duplex" },
  };
  applySonarPings(dupCompass, {
    castMembers: [
      { id: 'w', name: 'Weslie', presence: 'inPlay' },
      { id: 'o', name: 'Mrs. Okisato', presence: 'inPlay' },
    ],
    storage: null,
    chat: [{
      mes: "Weslie's phone buzzed. Mrs. Okisato's voice came through on the phone, flat and even. Weslie answered, standing in the duplex's kitchenette.",
    }],
  });
  const okiPhonePing = dupCompass.sonar.pings.o;
  if (!okiPhonePing?.listening || okiPhonePing?.listeningVia !== 'phone' || okiPhonePing?.placeId === 'dup') {
    return `okisato-phone-not-privy ${JSON.stringify(okiPhonePing)}`;
  }
  if (dupCompass.rooms.dup.occupants.some(o => o.name === 'Mrs. Okisato')) {
    return `okisato-phone-dragged-into-room ${JSON.stringify(dupCompass.rooms.dup.occupants)}`;
  }
  return '';
  } catch (err) {
    return err?.message || String(err);
  }
}

export function smokeSonarPresencePure() {
  try {
    const compass = {
      rooms: { dup: { id: 'dup', name: "Weslie's Duplex", kind: 'building', occupants: [] } },
      activeRoomId: 'dup',
      sonar: { pings: {}, lastPlaceId: 'dup' },
    };
    syncSonarPresence(compass, [{ id: 'a', name: 'Ada', presence: 'writtenOut' }]);
    if (!compass.sonar.pings.a?.locked || compass.sonar.pings.a.placeId !== 'dup') {
      return `writtenOut park ${JSON.stringify(compass.sonar.pings.a)}`;
    }
    compass.sonar.pings.b = { name: 'Bea', castId: 'b', placeId: 'dup', cell: 'N', locked: false };
    syncSonarPresence(compass, [{ id: 'b', name: 'Bea', presence: 'absent' }]);
    if (!compass.sonar.pings.b?.locked || compass.sonar.pings.b.cell !== 'N') {
      return `absent park ${JSON.stringify(compass.sonar.pings.b)}`;
    }
    compass.sonar.pings.c = { name: 'Cee', castId: 'c', placeId: 'dup', cell: 'E', locked: false };
    syncSonarPresence(compass, [{ id: 'c', name: 'Cee', presence: 'inPlay' }]);
    if (compass.sonar.pings.c.locked || compass.sonar.pings.c.cell !== 'E') {
      return `inPlay leave ${JSON.stringify(compass.sonar.pings.c)}`;
    }
    syncSonarPresence(compass, [{ id: 'd', name: 'Dee', presence: 'inPlay' }]);
    if (!compass.sonar.pings.d?.locked || compass.sonar.pings.d.placeId !== 'dup') {
      return `inPlay empty park ${JSON.stringify(compass.sonar.pings.d)}`;
    }
    compass.rooms.dup.occupants.push({ name: 'Eve', cell: 'C', castId: 'e' });
    compass.sonar.pings.e = { name: 'Eve', castId: 'e', placeId: 'dup', cell: 'C', locked: false };
    syncSonarPresence(compass, [{ id: 'e', name: 'Eve', presence: 'privy' }]);
    if (!compass.sonar.pings.e?.listening || !compass.sonar.pings.e?.away || compass.rooms.dup.occupants.some(o => o.name === 'Eve')) {
      return `privy sync ${JSON.stringify(compass.sonar.pings.e)} occ=${JSON.stringify(compass.rooms.dup.occupants)}`;
    }
    return '';
  } catch (err) {
    return err?.message || String(err);
  }
}
