// Unlisted place names — mentioned in play or tagged on Script/Library,
// with no matching Compass place (name, alias, or kinded catalog folder).

import { uid, PLACE_KIND_SET, PLACE_NEST_PARENTS, placeKindMeta } from './schema.js';
import { findLocationNodeByName } from '../locationCatalog.js';
import { getSceneCards } from '../scriptCatalog.js';
import { listVisibleLibraryLeaves } from '../libraryCatalog.js';
import { parseJsonObject } from '../jsonExtract.js';

const SOURCES = new Set(['chat', 'script', 'library']);
const GENERIC_HERE = new Set(['here', 'there', 'inside', 'outside', 'home', 'room', 'place', 'somewhere', 'around']);

function locKey(s) {
  return String(s || '').trim().toLowerCase();
}

export function ensureUnlisted(compass) {
  if (!compass || typeof compass !== 'object') return { unlisted: [], unlistedSkip: [] };
  compass.sonar = compass.sonar && typeof compass.sonar === 'object' ? compass.sonar : {};
  if (!Array.isArray(compass.sonar.unlisted)) compass.sonar.unlisted = [];
  if (!Array.isArray(compass.sonar.unlistedSkip)) compass.sonar.unlistedSkip = [];
  return compass.sonar;
}

/**
 * Cheap match: Compass name / alias / locationTags, or any catalog folder
 * (kinded = filed; unkinded = already Unfiled).
 */
export function matchPlaceName(compass, storage, name) {
  const k = locKey(name);
  if (!k) return null;
  const rooms = Object.values(compass?.rooms || {});
  const byName = rooms.find(p => locKey(p?.name) === k);
  if (byName) return { place: byName, via: 'name' };
  const byTag = rooms.find(p =>
    (p.aliases || []).some(t => locKey(t) === k)
    || (p.locationTags || []).some(t => locKey(t) === k));
  if (byTag) return { place: byTag, via: 'alias' };
  try {
    const node = storage ? findLocationNodeByName(storage, name) : null;
    if (node) {
      const place = node.placeId ? (compass?.rooms?.[node.placeId] || null) : null;
      return { place, node, via: 'catalog' };
    }
  } catch { /* ignore */ }
  return null;
}

export function listUnlisted(compass) {
  const sonar = ensureUnlisted(compass);
  const skip = new Set((sonar.unlistedSkip || []).map(locKey).filter(Boolean));
  return (sonar.unlisted || []).filter(u => u && locKey(u.name) && !skip.has(locKey(u.name)));
}

/** Names sonar / clapper should hear, including dismissed rows. */
export function listUnlistedKeys(compass) {
  const sonar = ensureUnlisted(compass);
  const out = [];
  const seen = new Set();
  const push = (n) => {
    const s = String(n || '').trim();
    const k = locKey(s);
    if (!k || seen.has(k)) return;
    seen.add(k);
    out.push(s);
  };
  for (const u of sonar.unlisted || []) push(u?.name);
  for (const s of sonar.unlistedSkip || []) push(s);
  return out;
}

export function forgetUnlisted(compass, name) {
  const sonar = ensureUnlisted(compass);
  const k = locKey(name);
  if (!k) return false;
  const before = sonar.unlisted.length + (sonar.unlistedSkip || []).length;
  sonar.unlisted = sonar.unlisted.filter(u => locKey(u?.name) !== k);
  sonar.unlistedSkip = (sonar.unlistedSkip || []).filter(s => locKey(s) !== k);
  return (sonar.unlisted.length + sonar.unlistedSkip.length) !== before;
}

/** Drop from the Unlisted folder without stripping Script / Library tags. */
export function dismissUnlisted(compass, name) {
  const sonar = ensureUnlisted(compass);
  const n = String(name || '').trim();
  const k = locKey(n);
  if (!k) return false;
  sonar.unlisted = sonar.unlisted.filter(u => locKey(u?.name) !== k);
  if (!(sonar.unlistedSkip || []).some(s => locKey(s) === k)) sonar.unlistedSkip.push(n);
  return true;
}

export function rememberUnlisted(compass, storage, { name, source = 'chat' } = {}) {
  const n = String(name || '').trim();
  if (!n || GENERIC_HERE.has(locKey(n))) return null;
  if (matchPlaceName(compass, storage, n)) {
    forgetUnlisted(compass, n);
    return null;
  }
  const sonar = ensureUnlisted(compass);
  const k = locKey(n);
  const src = SOURCES.has(source) ? source : 'chat';
  if (src !== 'chat' && (sonar.unlistedSkip || []).some(s => locKey(s) === k)) return null;
  if (src === 'chat') {
    sonar.unlistedSkip = (sonar.unlistedSkip || []).filter(s => locKey(s) !== k);
  }
  const existing = sonar.unlisted.find(u => locKey(u?.name) === k);
  if (existing) {
    existing.at = Date.now();
    if (src === 'chat') existing.source = 'chat';
    return existing;
  }
  const row = { id: uid('ul'), name: n, source: src, at: Date.now() };
  sonar.unlisted.push(row);
  return row;
}

export function dropMatchedUnlisted(compass, storage = null) {
  const sonar = ensureUnlisted(compass);
  let changed = false;
  sonar.unlisted = (sonar.unlisted || []).filter((u) => {
    if (!u?.name || matchPlaceName(compass, storage, u.name)) {
      changed = true;
      return false;
    }
    return true;
  });
  sonar.unlistedSkip = (sonar.unlistedSkip || []).filter((s) => {
    if (matchPlaceName(compass, storage, s)) {
      changed = true;
      return false;
    }
    return true;
  });
  return changed;
}

function pushName(list, raw) {
  const s = String(raw || '').trim();
  if (s) list.push(s);
}

function locationsFromMemoryText(text) {
  const t = String(text || '');
  if (!t.trim()) return [];
  const m = t.match(/##\s+Locations\b[\s\S]*?(?=##\s+\S|$)/i);
  if (!m) return [];
  return m[0].split(/\n/).slice(1)
    .map(l => String(l || '').replace(/^\s*[-*•]\s*/, '').trim())
    .filter(Boolean);
}

export function collectScriptLibraryLocationNames(storage) {
  const script = [];
  const library = [];
  try {
    for (const row of getSceneCards(storage) || []) {
      const card = row?.card || row;
      if (card?.active === false || card?.kind === 'folder') continue;
      for (const loc of card?.keywordFacets?.location || []) pushName(script, loc);
      try {
        for (const loc of locationsFromMemoryText(card?.content || card?.summary || '')) {
          pushName(script, loc);
        }
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  try {
    for (const leaf of listVisibleLibraryLeaves(storage) || []) {
      for (const t of leaf.tags || []) {
        const type = String(t.type || '').toLowerCase();
        if (type !== 'place' && type !== 'location') continue;
        const s = String(t.value || '').trim();
        if (s) library.push(s);
      }
    }
  } catch { /* ignore */ }
  return { script, library };
}

export function syncScriptLibraryUnlisted(compass, storage) {
  const sonar = ensureUnlisted(compass);
  const snap = () => `${(sonar.unlisted || []).map(u => `${u?.name || ''}:${u?.source || ''}`).join('|')}|${(sonar.unlistedSkip || []).join('|')}`;
  const before = snap();
  dropMatchedUnlisted(compass, storage);
  const { script, library } = collectScriptLibraryLocationNames(storage);
  for (const name of script) rememberUnlisted(compass, storage, { name, source: 'script' });
  for (const name of library) rememberUnlisted(compass, storage, { name, source: 'library' });
  return before !== snap();
}

export function locCueHit(windowText, compass) {
  const hay = String(windowText || '');
  if (!hay.trim()) return false;
  if (/\b(in|at|to|from|inside|into|onto|toward|towards)\b/i.test(hay)) return true;
  const low = hay.toLowerCase();
  for (const p of Object.values(compass?.rooms || {})) {
    const names = [p?.name, ...(p?.aliases || []), ...(p?.locationTags || [])];
    for (const n of names) {
      const s = String(n || '').trim();
      if (s.length >= 3 && low.includes(s.toLowerCase())) return true;
    }
  }
  for (const n of listUnlistedKeys(compass)) {
    if (n.length >= 3 && low.includes(n.toLowerCase())) return true;
  }
  return false;
}

export function unlistedLocationChoices(compass) {
  return listUnlisted(compass).map((u) => {
    const name = String(u?.name || '').trim();
    const src = String(u?.source || 'unlisted');
    return {
      value: name,
      label: name,
      hint: src,
      group: 'Unlisted',
      keys: [name.toLowerCase()],
    };
  }).filter(r => r.value);
}

export function knownPlaceRoster(compass) {
  const rows = [];
  const seen = new Set();
  const push = (name, note) => {
    const n = String(name || '').trim();
    const k = locKey(n);
    if (!n || seen.has(k)) return;
    seen.add(k);
    rows.push(note ? `- ${n} (${note})` : `- ${n}`);
  };
  for (const p of Object.values(compass?.rooms || {})) {
    push(p.name, p.kind);
    for (const a of p.aliases || []) push(a, `alias of ${p.name}`);
  }
  for (const u of listUnlisted(compass)) push(u.name, 'unlisted');
  return rows.join('\n') || 'None filed';
}

export function buildLocationDeltaPrompt(scene, roster) {
  return `You are filing a lean location delta.

Scene (recent lines only):
${scene}

Known places:
${roster}

Return ONLY JSON: {"here":"","kind":"","parent":"","mentions":[]}
- here: where the scene is now if a location is clearly stated; else "".
- Talking, remembering, or asking about a place belongs in mentions only; here is occupancy.
- kind: one of region, settlement, district, building, unit, room, transitional if you can guess; else "".
- parent: known roster name this place would nest under, or "".
- mentions: distinct place names from these lines (include here). Prefer a known name when it matches; otherwise keep the narrative's wording.
- Skip generic words (here, there, outside, room). Do not invent places.

JSON:`;
}

export function parseLocationDelta(raw) {
  const obj = parseJsonObject(raw);
  if (!obj) return null;
  try {
    const here = String(obj.here || '').trim();
    const kindRaw = String(obj.kind || '').trim().toLowerCase();
    const kind = PLACE_KIND_SET.has(kindRaw) ? kindRaw : '';
    const parent = String(obj.parent || '').trim();
    const mentions = Array.isArray(obj.mentions)
      ? obj.mentions.map(m => String(m || '').trim()).filter(Boolean)
      : [];
    if (here && !mentions.some(m => locKey(m) === locKey(here))) mentions.unshift(here);
    return { here, kind, parent, mentions };
  } catch {
    return null;
  }
}

const KIND_CUES = [
  { id: 'district', re: /\b(mall|street|neighborhood|quarter|district|ward)\b/i },
  { id: 'settlement', re: /\b(city|town|prefecture|village)\b/i },
  { id: 'region', re: /\b(country|nation|kingdom)\b/i },
  { id: 'unit', re: /\b(apartment|unit|suite)\b/i },
  { id: 'room', re: /\b(kitchen|bathroom|bedroom|shop\s*floor|parlor|lounge|office|room)\b/i },
  { id: 'transitional', re: /\b(hall|corridor|landing|alley|foyer|walkway)\b/i },
  { id: 'building', re: /\b(shop|store|cafe|house|building|inn|temple|station|duplex)\b/i },
];

export function guessPlaceKind(name) {
  const n = String(name || '').trim();
  if (!n) return '';
  for (const cue of KIND_CUES) {
    if (cue.re.test(n)) return cue.id;
  }
  return 'building';
}

export function guessNestParent(kind, { compass, trackerPlace } = {}) {
  const allow = PLACE_NEST_PARENTS[kind] || [];
  if (!allow.length) return { parentId: '', parentName: '' };
  const walk = (place) => {
    let cur = place;
    const seen = new Set();
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      if (allow.includes(cur.kind)) return { parentId: cur.id, parentName: cur.name || '' };
      cur = compass?.rooms?.[cur.parentId];
    }
    return { parentId: '', parentName: '' };
  };
  if (trackerPlace) {
    const hit = walk(trackerPlace);
    if (hit.parentId) return hit;
  }
  return { parentId: '', parentName: '' };
}

export function resolveLocationFiling(delta, { compass, storage, trackerPlace } = {}) {
  const here = String(delta?.here || '').trim();
  if (!here) return null;
  const known = matchPlaceName(compass, storage, here);
  let kind = PLACE_KIND_SET.has(delta?.kind) ? delta.kind : '';
  if (!kind && known?.place?.kind) kind = known.place.kind;
  if (!kind) kind = guessPlaceKind(here);
  let parentId = '';
  let parentName = '';
  const parentRaw = String(delta?.parent || '').trim();
  if (parentRaw) {
    const phit = matchPlaceName(compass, storage, parentRaw);
    if (phit?.place) {
      const allow = PLACE_NEST_PARENTS[kind] || [];
      if (allow.includes(phit.place.kind)) {
        parentId = phit.place.id;
        parentName = phit.place.name || parentRaw;
      } else {
        const guess = guessNestParent(kind, { compass, trackerPlace: phit.place });
        parentId = guess.parentId;
        parentName = guess.parentName || parentRaw;
      }
    } else {
      parentName = parentRaw;
    }
  }
  if (!parentId) {
    const guess = guessNestParent(kind, { compass, trackerPlace });
    parentId = guess.parentId;
    parentName = guess.parentName || parentName;
  }
  return {
    name: here,
    kind,
    kindLabel: placeKindMeta(kind)?.label || kind,
    parentId,
    parentName,
    placeId: known?.place?.id || '',
    known: !!known?.place,
  };
}

export function applyLocationDelta(compass, storage, delta) {
  if (!delta) return { changed: false, key: '', placeId: '' };
  let changed = false;
  for (const name of delta.mentions || []) {
    if (GENERIC_HERE.has(locKey(name))) continue;
    if (matchPlaceName(compass, storage, name)) continue;
    if (rememberUnlisted(compass, storage, { name, source: 'chat' })) changed = true;
  }
  const hereRaw = String(delta.here || '').trim();
  const here = GENERIC_HERE.has(locKey(hereRaw)) ? '' : hereRaw;
  if (!here) {
    return {
      changed,
      key: compass?.sonar?.lastKey || '',
      placeId: compass?.sonar?.lastPlaceId || '',
    };
  }
  const hit = matchPlaceName(compass, storage, here);
  const sonar = ensureUnlisted(compass);
  const placeId = hit?.place?.id || '';
  if (sonar.lastKey !== here || String(sonar.lastPlaceId || '') !== placeId) {
    sonar.lastKey = here;
    sonar.lastPlaceId = placeId;
    sonar.lastAt = Date.now();
    changed = true;
  }
  return { changed, key: here, placeId };
}

export function smokeLocationDeltaPure() {
  try {
    const d = parseLocationDelta('{"here":"Canal City Mall","kind":"district","parent":"Fukuoka","mentions":["Canal City Mall"]}');
    if (!d || d.here !== 'Canal City Mall' || d.kind !== 'district' || d.parent !== 'Fukuoka') {
      return `delta parse ${JSON.stringify(d)}`;
    }
    if (guessPlaceKind('Canal City Mall') !== 'district') return `mall kind → ${guessPlaceKind('Canal City Mall')}`;
    if (guessPlaceKind('Master Bedroom') !== 'room') return `room kind → ${guessPlaceKind('Master Bedroom')}`;
    const compass = {
      rooms: {
        f: { id: 'f', name: 'Fukuoka', kind: 'settlement' },
        dpx: { id: 'dpx', name: "Weslie's Duplex", kind: 'building', parentId: 'f', locationTags: ["Weslie's Duplex"] },
      },
    };
    const filing = resolveLocationFiling(
      { here: 'Canal City Mall' },
      { compass, trackerPlace: compass.rooms.f },
    );
    if (filing.kind !== 'district' || filing.parentId !== 'f') {
      return `nest guess ${JSON.stringify(filing)}`;
    }
    const skip = resolveLocationFiling({ here: '' });
    if (skip) return 'empty here should skip';
    const known = resolveLocationFiling(
      { here: "Weslie's Duplex" },
      { compass, trackerPlace: compass.rooms.f },
    );
    if (!known?.known || known.placeId !== 'dpx') return `known place ${JSON.stringify(known)}`;
    const prompt = buildLocationDeltaPrompt('We talked about Japan.', '- Japan (region)');
    if (!/mentions only/i.test(prompt) || !/occupancy/i.test(prompt)) return 'prompt occupancy';
    const harvested = collectScriptLibraryLocationNames({
      getChat: (k) => (k === 'script' ? {
        cards: [{
          uid: 'c1',
          kind: 'card',
          keywordFacets: { location: ['Harbor'] },
          content: '## Locations\n- Kanzaki\n\n## Cast\n- Hawks',
        }],
        settings: {},
      } : {}),
    });
    if (!harvested.script.includes('Harbor') || !harvested.script.includes('Kanzaki')) {
      return `script locations harvest ${JSON.stringify(harvested.script)}`;
    }
    return '';
  } catch (err) {
    return err?.message || String(err);
  }
}
