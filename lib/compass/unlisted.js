// Unlisted place names — mentioned in play or tagged on Script/Library,
// with no matching Compass place (name, alias, or kinded catalog folder).

import { uid } from './schema.js';
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

export function collectScriptLibraryLocationNames(storage) {
  const script = [];
  const library = [];
  try {
    for (const card of getSceneCards(storage) || []) {
      if (card?.active === false || card?.kind === 'folder') continue;
      for (const loc of card?.keywordFacets?.location || []) {
        const s = String(loc || '').trim();
        if (s) script.push(s);
      }
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

Return ONLY JSON: {"here":"","mentions":[]}
- here: where the scene is now if a location is clearly stated; else "".
- mentions: distinct place names from these lines (include here). Prefer a known name when it matches; otherwise keep the narrative's wording.
- Skip generic words (here, there, outside, room). Do not invent places.

JSON:`;
}

export function parseLocationDelta(raw) {
  const obj = parseJsonObject(raw);
  if (!obj) return null;
  try {
    const here = String(obj.here || '').trim();
    const mentions = Array.isArray(obj.mentions)
      ? obj.mentions.map(m => String(m || '').trim()).filter(Boolean)
      : [];
    if (here && !mentions.some(m => locKey(m) === locKey(here))) mentions.unshift(here);
    return { here, mentions };
  } catch {
    return null;
  }
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
