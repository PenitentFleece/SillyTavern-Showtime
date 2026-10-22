// Suite listing codes — playbill / property-listing abbreviations for nested rooms.

import { isSuiteHostKind, PLACE_KIND_SET } from './schema.js';

export const LISTING_CODES = Object.freeze([
  { id: 'br', label: 'Bedroom' },
  { id: 'bath', label: 'Bathroom' },
  { id: 'kitchn', label: 'Kitchen' },
  { id: 'lr', label: 'Living' },
  { id: 'dr', label: 'Dining' },
  { id: 'hall', label: 'Hall / Corridor' },
  { id: 'util', label: 'Utility / Closet' },
  { id: 'off', label: 'Office / Study' },
  { id: 'shop', label: 'Shop / Store' },
  { id: 'work', label: 'Workshop / Atelier' },
  { id: 'wait', label: 'Waiting / Reception' },
  { id: 'exam', label: 'Exam / Treatment' },
  { id: 'dock', label: 'Loading / Dock' },
]);

export const LISTING_CODE_IDS = Object.freeze(LISTING_CODES.map(c => c.id));
const BUILTIN_SET = new Set(LISTING_CODE_IDS.map(id => id.toLowerCase()));
const BUILTIN_ORDER = new Map(LISTING_CODE_IDS.map((id, i) => [id, i]));

const NAME_CUES = Object.freeze([
  { id: 'br', re: /\b(bed\s*rooms?|bedrooms?|beds?|brs?|master)\b/i },
  { id: 'bath', re: /\b(bath\s*rooms?|bathrooms?|baths?|wc|lav|loo|toilet|washrooms?)\b/i },
  { id: 'kitchn', re: /\b(kitchens?|kitchn|kits?|kitchenettes?)\b/i },
  { id: 'lr', re: /\b(living|lounge|parlor|parlour|sitting|lr)\b/i },
  { id: 'dr', re: /\b(dinings?|dr)\b/i },
  { id: 'hall', re: /\b(halls?|corridors?|foyers?|entry|landing|passage)\b/i },
  { id: 'shop', re: /\b(shops?|stores?|boutique|antiques?|sales\s*floor|shop\s*floor|storefront|counter)\b/i },
  { id: 'wait', re: /\b(waiting|reception|lobby)\b/i },
  { id: 'exam', re: /\b(exam\s*rooms?|treatment\s*rooms?|exam|consulting\s*room)\b/i },
  { id: 'work', re: /\b(workshops?|ateliers?|workrooms?|studio\s*floor|warehouse\s*floor)\b/i },
  { id: 'dock', re: /\b(loading(\s*(dock|bay|door))?|docks?)\b/i },
  { id: 'off', re: /\b(offices?|stud(?:y|ies)|counting\s*room)\b/i },
  { id: 'util', re: /\b(utility|closet|pantry|laundry|storage|stock|storeroom|back\s*room)\b/i },
]);

export function canonicalizeListingCode(raw) {
  const v = String(raw || '').trim().replace(/\s+/g, '').slice(0, 12);
  if (!v) return '';
  const hit = LISTING_CODES.find(c => c.id.toLowerCase() === v.toLowerCase());
  return hit ? hit.id : v;
}

export function listingCodeLabel(id) {
  const code = canonicalizeListingCode(id);
  if (!code) return '';
  const hit = LISTING_CODES.find(c => c.id === code);
  return hit ? `${hit.id} · ${hit.label}` : code;
}

/**
 * Built-in listing codes plus any custom labels this production has used.
 * Mirrors collectMoodPalette.
 */
export function collectListingPalette(extra = []) {
  const seen = new Set(LISTING_CODE_IDS.map(id => id.toLowerCase()));
  const custom = [];
  for (const raw of extra || []) {
    const v = canonicalizeListingCode(raw);
    if (!v) continue;
    const k = v.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    custom.push(v);
  }
  custom.sort((a, b) => a.localeCompare(b));
  return { keys: [...LISTING_CODE_IDS, ...custom], custom };
}

export function inferListingCode(place) {
  if (!place) return '';
  const kind = String(place.kind || '').trim();
  if (kind === 'transitional') return 'hall';
  const name = String(place.name || '').trim();
  if (!name) return '';
  for (const cue of NAME_CUES) {
    if (cue.re.test(name)) return cue.id;
  }
  return '';
}

export function resolveListingCode(place) {
  const tagged = canonicalizeListingCode(place?.listingCode);
  if (tagged) return tagged;
  return inferListingCode(place);
}

function codeSortKey(code) {
  const k = String(code || '').toLowerCase();
  if (BUILTIN_ORDER.has(k) || BUILTIN_ORDER.has(code)) {
    return [0, BUILTIN_ORDER.get(code) ?? BUILTIN_ORDER.get(k) ?? 99, k];
  }
  return [1, 0, k];
}

/** Bedrooms always count (`1br`); other codes only prefix when duplicated. */
function formatListingToken(code, n) {
  if (n > 1 || String(code).toLowerCase() === 'br') return `${n}${code}`;
  return code;
}

/** Collapse rooms into `1br, bath, kitchn, lr` (counts on duplicates). */
export function listingCodesLine(places = []) {
  const counts = new Map();
  for (const p of places || []) {
    if (p?.kind === 'unit' || p?.kind === 'building') continue;
    if (p?.kind && !PLACE_KIND_SET.has(p.kind)) continue;
    const code = resolveListingCode(p);
    if (!code) continue;
    const key = code.toLowerCase();
    const prev = counts.get(key);
    if (prev) prev.n += 1;
    else counts.set(key, { code, n: 1 });
  }
  const rows = [...counts.values()].sort((a, b) => {
    const aa = codeSortKey(a.code);
    const bb = codeSortKey(b.code);
    if (aa[0] !== bb[0]) return aa[0] - bb[0];
    if (aa[1] !== bb[1]) return aa[1] - bb[1];
    return aa[2].localeCompare(bb[2]);
  });
  return rows.map(r => formatListingToken(r.code, r.n)).join(', ');
}

/** [{ code, label, ids }] for clickable suite legends. */
export function listingCodeHits(places = []) {
  const map = new Map();
  for (const p of places || []) {
    if (p?.kind === 'unit' || p?.kind === 'building') continue;
    const code = resolveListingCode(p);
    if (!code || !p?.id) continue;
    const key = code.toLowerCase();
    const prev = map.get(key);
    if (prev) {
      prev.n += 1;
      prev.ids.push(p.id);
    } else {
      map.set(key, { code, n: 1, ids: [p.id] });
    }
  }
  return [...map.values()]
    .sort((a, b) => {
      const aa = codeSortKey(a.code);
      const bb = codeSortKey(b.code);
      if (aa[0] !== bb[0]) return aa[0] - bb[0];
      if (aa[1] !== bb[1]) return aa[1] - bb[1];
      return aa[2].localeCompare(bb[2]);
    })
    .map(r => ({
      code: r.code,
      label: formatListingToken(r.code, r.n),
      ids: r.ids,
    }));
}

function directKids(compass, parentId) {
  const pid = String(parentId || '');
  return Object.values(compass?.rooms || {})
    .filter(p => String(p?.parentId || '') === pid)
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
}

/**
 * `Weslie's Duplex | 1br, bath, kitchn, lr`
 * Buildings with units bill each unit; loose rooms on the host still list.
 */
export function suiteListingLine(host, children = [], compass = null) {
  if (!host) return '';
  const kids = Array.isArray(children) && children.length
    ? children
    : (compass ? directKids(compass, host.id) : []);
  const units = kids.filter(k => k.kind === 'unit');
  const rooms = kids.filter(k => k.kind === 'room' || k.kind === 'transitional');
  const bits = [];
  if (isSuiteHostKind(host.kind) && host.kind === 'building' && units.length) {
    for (const u of units) {
      const nested = compass ? directKids(compass, u.id) : [];
      const line = listingCodesLine(nested);
      bits.push(line ? `${u.name} · ${line}` : u.name);
    }
  }
  if (rooms.length) {
    const line = listingCodesLine(rooms);
    if (line) bits.push(line);
  } else if (!units.length) {
    const line = listingCodesLine(kids);
    if (line) bits.push(line);
  }
  if (!bits.length) return '';
  return `${host.name} | ${bits.join(' · ')}`;
}

export function listingCodesFromPlaces(compass) {
  const extra = [];
  for (const p of Object.values(compass?.rooms || {})) {
    const v = canonicalizeListingCode(p?.listingCode);
    if (v && !BUILTIN_SET.has(v.toLowerCase())) extra.push(v);
  }
  return extra;
}

export function smokeListingPure() {
  try {
    const br = inferListingCode({ name: 'Master Bedroom', kind: 'room' });
    if (br !== 'br') return `bedroom infer → ${br}`;
    const hall = inferListingCode({ name: 'Front Hall', kind: 'transitional' });
    if (hall !== 'hall') return `hall infer → ${hall}`;
    const tagged = resolveListingCode({ name: "Weslie's room", kind: 'room', listingCode: 'br' });
    if (tagged !== 'br') return `override → ${tagged}`;
    const line = listingCodesLine([
      { name: 'Bedroom', kind: 'room' },
      { name: 'Bath', kind: 'room' },
      { name: 'Bath 2', kind: 'room' },
      { name: 'Kitchen', kind: 'room' },
      { name: 'Living Room', kind: 'room' },
    ]);
    if (line !== '1br, 2bath, kitchn, lr') return `listing line → ${line}`;
    const pal = collectListingPalette(['den', 'br', 'Den']);
    if (!pal.keys.includes('br') || pal.custom.join() !== 'den') return `palette ${JSON.stringify(pal)}`;
    const duplex = { id: 'dup', name: "Weslie's Duplex", kind: 'building' };
    const kids = [
      { id: 'br1', name: 'Bedroom', kind: 'room', parentId: 'dup' },
      { id: 'ba', name: 'Bath', kind: 'room', parentId: 'dup' },
      { id: 'k', name: 'Kitchen', kind: 'room', parentId: 'dup' },
      { id: 'l', name: 'Living Room', kind: 'room', parentId: 'dup' },
    ];
    const hostLine = suiteListingLine(duplex, kids);
    if (hostLine !== "Weslie's Duplex | 1br, bath, kitchn, lr") return `host line → ${hostLine}`;
    const pal2 = collectListingPalette(listingCodesFromPlaces({
      rooms: { a: { listingCode: 'den' } },
    }));
    if (!pal2.custom.includes('den')) return 'harvest custom listingCode';
    if (inferListingCode({ name: 'Sales floor', kind: 'room' }) !== 'shop') return 'sales floor infer';
    if (inferListingCode({ name: 'Workshop', kind: 'room' }) !== 'work') return 'workshop infer';
    if (inferListingCode({ name: 'Back room', kind: 'room' }) !== 'util') return 'back room infer';
    if (inferListingCode({ name: 'Waiting room', kind: 'room' }) !== 'wait') return 'waiting infer';
    if (inferListingCode({ name: 'Exam room', kind: 'room' }) !== 'exam') return 'exam infer';
    if (inferListingCode({ name: 'Loading dock', kind: 'room' }) !== 'dock') return 'dock infer';
    return '';
  } catch (err) {
    return err?.message || String(err);
  }
}
