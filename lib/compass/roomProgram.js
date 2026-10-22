// Typed interior programs for empty suite hosts (unit / building).
// Code owns the room list; the LLM only names and describes.

import { listSuiteChildren, listSuiteUnits } from './suiteLayout.js';
import { canonicalizeListingCode, inferListingCode } from './listing.js';

export const RESIDENTIAL_TYPOLOGIES = Object.freeze(['studio', 'one_bed', 'two_bed', 'small_house', 'apartment_bldg']);
export const COMMERCIAL_TYPOLOGIES = Object.freeze([
  'shop', 'antique_shop', 'workshop', 'cafe', 'restaurant', 'office', 'mall', 'retail_strip', 'hotel', 'station',
]);
export const PROFESSIONAL_TYPOLOGIES = Object.freeze(['clinic', 'hospital_floor', 'agency', 'school']);
export const INDUSTRIAL_TYPOLOGIES = Object.freeze(['warehouse']);
export const SUITE_TYPOLOGIES = Object.freeze([
  ...RESIDENTIAL_TYPOLOGIES,
  ...COMMERCIAL_TYPOLOGIES,
  ...PROFESSIONAL_TYPOLOGIES,
  ...INDUSTRIAL_TYPOLOGIES,
]);
export const SUITE_TYPOLOGY_SET = new Set(SUITE_TYPOLOGIES);
const RESIDENTIAL_SET = new Set(RESIDENTIAL_TYPOLOGIES);
const COMMERCIAL_SET = new Set(COMMERCIAL_TYPOLOGIES);
const PROFESSIONAL_SET = new Set(PROFESSIONAL_TYPOLOGIES);
const INDUSTRIAL_SET = new Set(INDUSTRIAL_TYPOLOGIES);

export const PLACE_CATEGORY_GROUPS = Object.freeze([
  Object.freeze({
    id: 'commercial',
    label: 'Commercial & Retail',
    items: Object.freeze([
      Object.freeze({ id: 'mall', label: 'Shopping Mall / Complex', hostKind: 'building' }),
      Object.freeze({ id: 'retail_strip', label: 'Promenade / Arcade Floor', hostKind: 'building' }),
      Object.freeze({ id: 'shop', label: 'Shop / Boutique', hostKind: 'unit' }),
      Object.freeze({ id: 'antique_shop', label: 'Antique / Specialty Shop', hostKind: 'unit' }),
      Object.freeze({ id: 'cafe', label: 'Cafe / Bakery', hostKind: 'unit' }),
      Object.freeze({ id: 'restaurant', label: 'Restaurant / Bar', hostKind: 'unit' }),
      Object.freeze({ id: 'workshop', label: 'Workshop / Studio', hostKind: 'unit' }),
    ]),
  }),
  Object.freeze({
    id: 'public',
    label: 'Public, Civic & Hospitality',
    items: Object.freeze([
      Object.freeze({ id: 'hotel', label: 'Hotel / Inn Floor', hostKind: 'building' }),
      Object.freeze({ id: 'school', label: 'School / Academy Floor', hostKind: 'building' }),
      Object.freeze({ id: 'station', label: 'Transit Station / Concourse', hostKind: 'building' }),
      Object.freeze({ id: 'hospital_floor', label: 'Hospital Ward / Floor', hostKind: 'building' }),
    ]),
  }),
  Object.freeze({
    id: 'professional',
    label: 'Professional & Industrial',
    items: Object.freeze([
      Object.freeze({ id: 'office', label: 'Office Suite', hostKind: 'unit' }),
      Object.freeze({ id: 'agency', label: 'Agency / Headquarters', hostKind: 'building' }),
      Object.freeze({ id: 'clinic', label: 'Clinic / Medical Practice', hostKind: 'unit' }),
      Object.freeze({ id: 'warehouse', label: 'Warehouse / Depot', hostKind: 'unit' }),
    ]),
  }),
  Object.freeze({
    id: 'residential',
    label: 'Residential',
    items: Object.freeze([
      Object.freeze({ id: 'apartment_bldg', label: 'Apartment Building / Floor', hostKind: 'building' }),
      Object.freeze({ id: 'studio', label: 'Studio Unit', hostKind: 'unit' }),
      Object.freeze({ id: 'one_bed', label: '1-Bedroom Unit', hostKind: 'unit' }),
      Object.freeze({ id: 'two_bed', label: '2-Bedroom Unit', hostKind: 'unit' }),
      Object.freeze({ id: 'small_house', label: 'House / Residence', hostKind: 'building' }),
    ]),
  }),
]);

export const PLACE_CATEGORIES = Object.freeze(
  PLACE_CATEGORY_GROUPS.flatMap(g => g.items.map(it => Object.freeze({ ...it, group: g.label }))),
);

export function categoryLabel(category) {
  const id = String(category || '').trim();
  const hit = PLACE_CATEGORIES.find(c => c.id === id);
  if (hit) return hit.label;
  return id ? id.replace(/_/g, ' ') : '';
}

const ROOM = (key, listing, name, size, extra = {}) => Object.freeze({
  key,
  listing,
  name,
  kind: listing === 'hall' ? 'transitional' : 'room',
  size,
  required: extra.required !== false,
  ...(Number.isFinite(Number(extra.story)) ? { story: Math.round(Number(extra.story)) } : {}),
});

export const SUITE_PROGRAMS = Object.freeze({
  studio: Object.freeze({
    use: 'residential',
    hostKind: 'unit',
    fallbackListing: 'lr',
    rooms: Object.freeze([
      ROOM('main', 'lr', 'Main room', 'L'),
      ROOM('bath', 'bath', 'Bathroom', 'S'),
      ROOM('kitchen', 'kitchn', 'Kitchen', 'M'),
      ROOM('storage', 'util', 'Storage', 'S'),
    ]),
  }),
  one_bed: Object.freeze({
    use: 'residential',
    hostKind: 'unit',
    fallbackListing: 'lr',
    rooms: Object.freeze([
      ROOM('main', 'lr', 'Living room', 'L'),
      ROOM('br1', 'br', 'Bedroom', 'M'),
      ROOM('bath', 'bath', 'Bathroom', 'S'),
      ROOM('kitchen', 'kitchn', 'Kitchen', 'M'),
      ROOM('storage', 'util', 'Storage', 'S'),
    ]),
  }),
  two_bed: Object.freeze({
    use: 'residential',
    hostKind: 'unit',
    fallbackListing: 'lr',
    rooms: Object.freeze([
      ROOM('main', 'lr', 'Living room', 'L'),
      ROOM('hall', 'hall', 'Hall', 'M'),
      ROOM('br1', 'br', 'Bedroom', 'M'),
      ROOM('br2', 'br', 'Bedroom', 'M'),
      ROOM('bath', 'bath', 'Bathroom', 'S'),
      ROOM('kitchen', 'kitchn', 'Kitchen', 'M'),
      ROOM('storage', 'util', 'Storage', 'S'),
    ]),
  }),
  small_house: Object.freeze({
    use: 'residential',
    hostKind: 'building',
    fallbackListing: 'lr',
    rooms: Object.freeze([
      ROOM('main', 'lr', 'Living room', 'L'),
      ROOM('hall', 'hall', 'Hall', 'M'),
      ROOM('br1', 'br', 'Bedroom', 'M'),
      ROOM('br2', 'br', 'Bedroom', 'M'),
      ROOM('bath', 'bath', 'Bathroom', 'S'),
      ROOM('kitchen', 'kitchn', 'Kitchen', 'M'),
      ROOM('storage', 'util', 'Closet', 'S'),
      ROOM('dining', 'dr', 'Dining room', 'M', { required: false }),
    ]),
  }),
  shop: Object.freeze({
    use: 'commercial',
    hostKind: 'unit',
    fallbackListing: 'shop',
    rooms: Object.freeze([
      ROOM('main', 'shop', 'Sales floor', 'L'),
      ROOM('back', 'util', 'Back room', 'M'),
      ROOM('office', 'off', 'Office', 'S', { required: false }),
      ROOM('wash', 'bath', 'Washroom', 'S', { required: false }),
    ]),
  }),
  workshop: Object.freeze({
    use: 'commercial',
    hostKind: 'unit',
    fallbackListing: 'work',
    rooms: Object.freeze([
      ROOM('main', 'work', 'Workshop', 'L'),
      ROOM('back', 'util', 'Storage', 'M'),
      ROOM('office', 'off', 'Office', 'S', { required: false }),
      ROOM('wash', 'bath', 'Washroom', 'S', { required: false }),
    ]),
  }),
  cafe: Object.freeze({
    use: 'commercial',
    hostKind: 'unit',
    fallbackListing: 'shop',
    rooms: Object.freeze([
      ROOM('main', 'shop', 'Dining room', 'L'),
      ROOM('kitchen', 'kitchn', 'Kitchen', 'M'),
      ROOM('back', 'util', 'Stock', 'S'),
      ROOM('wash', 'bath', 'Washroom', 'S', { required: false }),
    ]),
  }),
  office: Object.freeze({
    use: 'commercial',
    hostKind: 'unit',
    fallbackListing: 'off',
    rooms: Object.freeze([
      ROOM('main', 'off', 'Office', 'L'),
      ROOM('back', 'util', 'File room', 'M'),
      ROOM('wash', 'bath', 'Washroom', 'S', { required: false }),
    ]),
  }),
  clinic: Object.freeze({
    use: 'professional',
    hostKind: 'unit',
    fallbackListing: 'wait',
    rooms: Object.freeze([
      ROOM('main', 'wait', 'Waiting room', 'L'),
      ROOM('exam', 'exam', 'Exam room', 'M'),
      ROOM('office', 'off', 'Office', 'S'),
      ROOM('wash', 'bath', 'Washroom', 'S', { required: false }),
    ]),
  }),
  warehouse: Object.freeze({
    use: 'industrial',
    hostKind: 'unit',
    fallbackListing: 'work',
    rooms: Object.freeze([
      ROOM('main', 'work', 'Floor', 'L'),
      ROOM('dock', 'dock', 'Loading', 'M'),
      ROOM('office', 'off', 'Office', 'S', { required: false }),
      ROOM('wash', 'bath', 'Washroom', 'S', { required: false }),
    ]),
  }),
  antique_shop: Object.freeze({
    use: 'commercial',
    hostKind: 'unit',
    fallbackListing: 'shop',
    rooms: Object.freeze([
      ROOM('main', 'shop', 'Display Floor', 'L'),
      ROOM('break_room', 'util', 'Break Room', 'M'),
      ROOM('back', 'util', 'Storage', 'M'),
      ROOM('office', 'off', 'Office', 'S'),
      ROOM('wash', 'bath', 'Bathroom', 'S'),
    ]),
  }),
  restaurant: Object.freeze({
    use: 'commercial',
    hostKind: 'unit',
    fallbackListing: 'shop',
    rooms: Object.freeze([
      ROOM('main', 'shop', 'Dining Floor', 'L'),
      ROOM('bar', 'shop', 'Bar Counter', 'M'),
      ROOM('kitchen', 'kitchn', 'Kitchen', 'M'),
      ROOM('back', 'util', 'Pantry & Cold Storage', 'S'),
      ROOM('office', 'off', 'Manager Office', 'S', { required: false }),
      ROOM('wash', 'bath', 'Restroom', 'S'),
    ]),
  }),
  mall: Object.freeze({
    use: 'commercial',
    hostKind: 'building',
    fallbackListing: 'shop',
    rooms: Object.freeze([
      ROOM('promenade1', 'hall', '1F Promenade', 'L', { story: 0 }),
      ROOM('promenade2', 'hall', '2F Promenade', 'L', { story: 1 }),
      ROOM('atrium', 'shop', 'Central Atrium', 'L', { story: 0 }),
      ROOM('food_court', 'shop', 'Food Court', 'L', { story: 0 }),
      ROOM('anchor_shop', 'shop', 'Anchor Store', 'L', { story: 0 }),
      ROOM('boutique_a', 'shop', 'North Shoppe', 'M', { story: 1 }),
      ROOM('boutique_b', 'shop', 'South Shoppe', 'M', { story: 1 }),
      ROOM('restrooms', 'bath', 'Public Restrooms', 'S', { story: 0 }),
      ROOM('service_hall', 'util', 'Service Corridor', 'M', { story: 0 }),
    ]),
  }),
  retail_strip: Object.freeze({
    use: 'commercial',
    hostKind: 'building',
    fallbackListing: 'shop',
    rooms: Object.freeze([
      ROOM('promenade', 'hall', 'Promenade', 'L'),
      ROOM('shop_w', 'shop', 'West Shoppe', 'M'),
      ROOM('shop_c', 'shop', 'Center Shoppe', 'M'),
      ROOM('shop_e', 'shop', 'East Shoppe', 'M'),
      ROOM('restroom', 'bath', 'Restroom', 'S'),
      ROOM('storage', 'util', 'Service & Stock', 'S'),
    ]),
  }),
  hotel: Object.freeze({
    use: 'commercial',
    hostKind: 'building',
    fallbackListing: 'wait',
    rooms: Object.freeze([
      ROOM('lobby', 'wait', 'Lobby & Front Desk', 'L'),
      ROOM('hall', 'hall', 'Guest Corridor', 'L'),
      ROOM('lounge', 'lr', 'Lounge', 'M'),
      ROOM('suite1', 'br', 'Guest Room 101', 'M'),
      ROOM('suite2', 'br', 'Guest Room 102', 'M'),
      ROOM('office', 'off', 'Back Office', 'S'),
      ROOM('wash', 'bath', 'Restroom', 'S'),
    ]),
  }),
  school: Object.freeze({
    use: 'professional',
    hostKind: 'building',
    fallbackListing: 'off',
    rooms: Object.freeze([
      ROOM('hall', 'hall', 'Main Hallway', 'L'),
      ROOM('class1', 'off', 'Classroom A', 'L'),
      ROOM('class2', 'off', 'Classroom B', 'L'),
      ROOM('staff', 'off', 'Faculty Room', 'M'),
      ROOM('storage', 'util', 'Supply Closet', 'S'),
      ROOM('wash', 'bath', 'Restrooms', 'S'),
    ]),
  }),
  station: Object.freeze({
    use: 'commercial',
    hostKind: 'building',
    fallbackListing: 'hall',
    rooms: Object.freeze([
      ROOM('concourse', 'hall', 'Main Concourse', 'L'),
      ROOM('gates', 'wait', 'Ticket Gates', 'M'),
      ROOM('platform', 'hall', 'Platform', 'L'),
      ROOM('kiosk', 'shop', 'Station Kiosk', 'S'),
      ROOM('office', 'off', 'Station Office', 'S'),
      ROOM('wash', 'bath', 'Restrooms', 'S'),
    ]),
  }),
  agency: Object.freeze({
    use: 'professional',
    hostKind: 'building',
    fallbackListing: 'off',
    rooms: Object.freeze([
      ROOM('lobby', 'wait', 'Reception & Lobby', 'M'),
      ROOM('hall', 'hall', 'Main Corridor', 'M'),
      ROOM('main', 'off', 'Operations Floor', 'L'),
      ROOM('briefing', 'off', 'Briefing Room', 'M'),
      ROOM('director', 'off', 'Director Office', 'M'),
      ROOM('break_room', 'util', 'Break Room', 'S'),
      ROOM('wash', 'bath', 'Restroom', 'S'),
    ]),
  }),
  hospital_floor: Object.freeze({
    use: 'professional',
    hostKind: 'building',
    fallbackListing: 'wait',
    rooms: Object.freeze([
      ROOM('main', 'wait', 'Waiting Area', 'M'),
      ROOM('hall', 'hall', 'Ward Corridor', 'L'),
      ROOM('nurses', 'off', 'Nurses Station', 'M'),
      ROOM('exam1', 'exam', 'Treatment Room 1', 'M'),
      ROOM('exam2', 'exam', 'Patient Room 2', 'M'),
      ROOM('supply', 'util', 'Supply & Pharmacy', 'S'),
      ROOM('wash', 'bath', 'Restroom', 'S'),
    ]),
  }),
  apartment_bldg: Object.freeze({
    use: 'residential',
    hostKind: 'building',
    fallbackListing: 'hall',
    rooms: Object.freeze([
      ROOM('lobby', 'wait', 'Entry Lobby', 'M'),
      ROOM('hall', 'hall', 'Floor Corridor', 'L'),
      ROOM('stair', 'hall', 'Stairwell & Elevator', 'S'),
      ROOM('mail', 'util', 'Mail & Utility Room', 'S'),
    ]),
  }),
});

const RESIDENTIAL_NAME_RE = /\b(apartments?|flats?|condos?|1br|2br|bedrooms?|duplex|cottage|house|home)\b/i;
const INDUSTRIAL_NAME_RE = /\b(warehouses?|depots?|factories?|foundr(?:y|ies)|hangars?|industrial)\b/i;
const PROFESSIONAL_NAME_RE = /\b(clinics?|dentists?|dental|doctors?|hospitals?|veterinary|\bvets?\b|medical)\b/i;
const COMMERCIAL_NAME_RE = /\b(antiques?|shops?|stores?|boutiques?|malls?|markets?|cafes?|coffees?|restaurants?|bars?|diners?|offices?|workshops?|ateliers?|salons?|garages?|storefronts?)\b/i;

function useFromHostName(hostName = '', hostKind = '') {
  const name = String(hostName || '').toLowerCase();
  if (RESIDENTIAL_NAME_RE.test(name)) return 'residential';
  if (INDUSTRIAL_NAME_RE.test(name)) return 'industrial';
  if (PROFESSIONAL_NAME_RE.test(name)) return 'professional';
  if (COMMERCIAL_NAME_RE.test(name)) return 'commercial';
  if (/\batelier\b|\bworkshop\b/.test(name)) return 'commercial';
  if (hostKind === 'building' && /house|home|cottage|duplex/.test(name)) return 'residential';
  return '';
}

export function inferSuiteUse({ hostName = '', hostKind = '', typology = '' } = {}) {
  const typ = String(typology || '').trim().toLowerCase().replace(/[- ]+/g, '_');
  if (INDUSTRIAL_SET.has(typ)) return 'industrial';
  if (PROFESSIONAL_SET.has(typ)) return 'professional';
  const named = useFromHostName(hostName, hostKind);
  if (named) return named;
  if (COMMERCIAL_SET.has(typ)) return 'commercial';
  if (RESIDENTIAL_SET.has(typ) && typ !== 'studio') return 'residential';
  return 'residential';
}

export function suiteUseOf(typology) {
  const spec = SUITE_PROGRAMS[typology];
  return spec?.use || 'residential';
}

export function typologyHeadline(typology) {
  const t = SUITE_PROGRAMS[typology] ? typology : 'studio';
  const name = t.replace(/_/g, ' ');
  const use = suiteUseOf(t);
  return use === 'residential' ? name : `${use} · ${name}`;
}

function inferWorkingTypology(hostName = '', use = 'commercial') {
  const name = String(hostName || '').toLowerCase();
  if (/cafe|coffee|restaurant|bar|diner/.test(name)) return 'cafe';
  if (use === 'industrial' || INDUSTRIAL_NAME_RE.test(name)) return 'warehouse';
  if (use === 'professional' || PROFESSIONAL_NAME_RE.test(name)) return 'clinic';
  if (/office|agency|bureau/.test(name)) return 'office';
  if (/workshop|atelier|garage/.test(name)) return 'workshop';
  if (/\bstudio\b/.test(name) && !/antique/.test(name) && !RESIDENTIAL_NAME_RE.test(name)) return 'workshop';
  if (use === 'industrial') return 'warehouse';
  if (use === 'professional') return 'clinic';
  return 'shop';
}

export function canonicalizeTypology(raw, { hostKind = '', hostName = '' } = {}) {
  const s = String(raw || '').trim().toLowerCase().replace(/[- ]+/g, '_');
  const use = inferSuiteUse({ hostName, hostKind, typology: s });
  if (SUITE_TYPOLOGY_SET.has(s)) {
    if (use === 'professional' && (s === 'studio' || s === 'office' || s === 'shop')) return 'clinic';
    if (use === 'industrial' && (s === 'studio' || s === 'shop' || s === 'workshop')) return 'warehouse';
    if (s === 'studio' && use === 'commercial') return inferWorkingTypology(hostName, use);
    return s;
  }
  if (/warehouse|depot|factory|foundry|hangar/.test(s)) return 'warehouse';
  if (/clinic|dental|hospital|veterinary|\bvet\b|medical/.test(s)) return 'clinic';
  if (/shop|store|boutique|retail|antiques?/.test(s)) return 'shop';
  if (/workshop|atelier|work.?room/.test(s)) return 'workshop';
  if (/cafe|coffee|restaurant|bar|diner/.test(s)) return 'cafe';
  if (/office|agency/.test(s)) return 'office';
  if (/two.?bed|2.?bed|2.?br/.test(s)) return 'two_bed';
  if (/one.?bed|1.?bed|1.?br/.test(s)) return 'one_bed';
  if (/house|home|cottage|duplex/.test(s)) return 'small_house';
  if (/studio/.test(s) && use === 'residential') return 'studio';
  if (use !== 'residential') return inferWorkingTypology(hostName, use);
  const name = String(hostName || '').toLowerCase();
  if (/house|cottage|duplex/.test(name) || (hostKind === 'building' && /house/.test(name))) {
    return 'small_house';
  }
  if (hostKind === 'building' && !s) return 'small_house';
  if (hostKind === 'unit' && !s) return 'studio';
  return 'studio';
}

function cloneRoom(row, fallbackListing = 'lr') {
  return {
    key: String(row.key || '').trim(),
    listing: canonicalizeListingCode(row.listing) || fallbackListing,
    name: String(row.name || '').trim() || 'Room',
    kind: row.kind === 'transitional' || row.listing === 'hall' ? 'transitional' : 'room',
    size: /^(L|M|S)$/.test(row.size) ? row.size : 'M',
    required: row.required !== false,
    blurb: String(row.blurb || '').trim(),
    ...(Number.isFinite(Number(row.story)) ? { story: Math.round(Number(row.story)) } : {}),
  };
}

const RESIDENTIAL_LISTINGS = new Set(['br', 'lr', 'dr', 'kitchn']);

function listingForExtra(raw, { use = 'residential', typology = 'studio', fallback = 'off' } = {}) {
  const name = String(raw?.name || '').trim();
  const listed = canonicalizeListingCode(raw?.listing || raw?.key || '');
  const inferred = inferListingCode({ name, listingCode: listed });
  let code = listed || inferred || '';
  if (use !== 'residential' && typology !== 'cafe') {
    const housing = RESIDENTIAL_LISTINGS.has(code) || RESIDENTIAL_LISTINGS.has(inferred);
    if (housing) code = 'util';
  }
  return code || fallback;
}

/**
 * Expand a typology into a room list. Optional program rooms stay unless omitted.
 * `extras` may add at most two narrative rooms (office, pantry, balcony…).
 */
export function expandProgram(typology, { extras = [], includeOptional = true } = {}) {
  const id = SUITE_PROGRAMS[typology] ? typology : 'studio';
  const spec = SUITE_PROGRAMS[id];
  const fallback = spec.fallbackListing || 'lr';
  const rooms = spec.rooms
    .filter(r => includeOptional || r.required)
    .map(r => cloneRoom(r, fallback));
  const seen = new Set(rooms.map(r => r.key));
  let extraN = 0;
  for (const raw of extras || []) {
    if (extraN >= 2) break;
    const name = String(raw.name || '').trim();
    const listing = listingForExtra(raw, { use: spec.use, typology: id, fallback });
    if (!name && !listing) continue;
    const key = String(raw.key || listing || name).trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '_').slice(0, 16)
      || `extra_${extraN + 1}`;
    if (seen.has(key) || rooms.some(r => r.listing === listing && listing && listing !== 'br')) {
      continue;
    }
    seen.add(key);
    extraN += 1;
    rooms.push(cloneRoom({
      key,
      listing: listing || fallback,
      name: name || listing || 'Room',
      kind: listing === 'hall' ? 'transitional' : 'room',
      size: listing === 'util' || listing === 'bath' ? 'S' : 'M',
      required: false,
      blurb: raw.blurb,
    }, fallback));
  }
  if (spec.use === 'residential') {
    const crowded = rooms.filter(r => r.listing !== 'hall').length >= 5;
    if (crowded && !rooms.some(r => r.listing === 'hall')) {
      rooms.splice(1, 0, cloneRoom(ROOM('hall', 'hall', 'Hall', 'M', { required: false }), fallback));
    }
  }
  return { typology: id, hostKind: spec.hostKind, use: spec.use, rooms };
}

/** Empty building or unit with no loadable interior (nor units that already have rooms). */
export function emptySuiteHost(compass, place) {
  if (!place?.id) return null;
  const k = String(place.kind || '').trim();
  if (k === 'unit') {
    return listSuiteChildren(compass, place.id).length ? null : place;
  }
  if (k === 'building') {
    if (listSuiteChildren(compass, place.id).length) return null;
    const units = listSuiteUnits(compass, place.id);
    if (units.some(u => listSuiteChildren(compass, u.id).length)) return null;
    return place;
  }
  return null;
}

export function defaultAdjacencies(rooms = []) {
  const keys = rooms.map(r => r.key);
  const has = (k) => keys.includes(k);
  const adj = [];
  const push = (a, b, wall) => {
    if (!has(a) || !has(b)) return;
    adj.push({ a, b, wall, openings: [{ type: 'door', label: rooms.find(r => r.key === b)?.name || b }] });
  };
  const commercial = has('back') || rooms.some(r => r.listing === 'shop' || r.listing === 'work');
  if (has('promenade1')) {
    push('promenade1', 'atrium', 'N');
    push('atrium', 'promenade2', 'N');
    push('promenade1', 'anchor_shop', 'W');
    push('promenade1', 'food_court', 'E');
    push('promenade2', 'boutique_a', 'W');
    push('promenade2', 'boutique_b', 'E');
    push('promenade1', 'restrooms', 'S');
    push('food_court', 'service_hall', 'N');
  } else if (has('promenade')) {
    push('promenade', 'shop_w', 'W');
    push('promenade', 'shop_c', 'N');
    push('promenade', 'shop_e', 'E');
    push('promenade', 'restroom', 'S');
    push('shop_c', 'storage', 'N');
  } else if (has('concourse')) {
    push('concourse', 'gates', 'N');
    push('gates', 'platform', 'N');
    push('concourse', 'kiosk', 'W');
    push('concourse', 'office', 'E');
    push('concourse', 'wash', 'S');
  } else if (has('class1')) {
    push('hall', 'class1', 'N');
    push('hall', 'class2', 'S');
    push('hall', 'staff', 'E');
    push('hall', 'wash', 'W');
    push('staff', 'storage', 'N');
  } else if (has('nurses')) {
    push('main', 'hall', 'N');
    push('hall', 'nurses', 'N');
    push('hall', 'exam1', 'E');
    push('hall', 'exam2', 'W');
    push('nurses', 'supply', 'E');
    push('main', 'wash', 'W');
  } else if (has('lobby') && has('hall')) {
    push('lobby', 'hall', 'N');
    if (has('main')) push('hall', 'main', 'N');
    if (has('briefing')) push('hall', 'briefing', 'E');
    if (has('director')) push('main', 'director', 'E');
    if (has('break_room')) push('hall', 'break_room', 'W');
    if (has('lounge')) push('lobby', 'lounge', 'E');
    if (has('suite1')) push('hall', 'suite1', 'N');
    if (has('suite2')) push('hall', 'suite2', 'E');
    if (has('office')) push('lobby', 'office', 'W');
    if (has('stair')) push('hall', 'stair', 'E');
    if (has('mail')) push('lobby', 'mail', 'E');
    if (has('wash')) push('lobby', 'wash', 'W');
  } else if (has('break_room') && has('back')) {
    push('main', 'break_room', 'E');
    push('main', 'back', 'E');
    push('break_room', 'office', 'E');
    push('break_room', 'wash', 'S');
  } else if (has('bar') && has('kitchen')) {
    push('main', 'bar', 'E');
    push('main', 'kitchen', 'N');
    push('kitchen', 'back', 'E');
    push('kitchen', 'office', 'W');
    push('main', 'wash', 'W');
  } else if (has('exam')) {
    push('main', 'exam', 'N');
    push('main', 'office', 'E');
    push('main', 'wash', 'W');
  } else if (has('dock')) {
    push('main', 'dock', 'N');
    push('main', 'office', 'E');
    push('main', 'wash', 'W');
  } else if (commercial) {
    push('main', 'back', 'N');
    push('back', 'office', 'E');
    push('back', 'storage', 'W');
    push('back', 'kitchen', 'E');
    push('main', 'wash', 'W');
    if (has('hall')) push('main', 'hall', 'E');
  } else if (has('hall')) {
    push('main', 'hall', 'N');
    push('hall', 'br1', 'E');
    push('hall', 'br2', 'W');
    push('hall', 'bath', 'N');
    push('hall', 'kitchen', 'E');
    push('kitchen', 'storage', 'N');
    if (has('dining')) push('main', 'dining', 'E');
  } else {
    push('main', 'kitchen', 'E');
    push('main', 'bath', 'W');
    push('kitchen', 'storage', 'N');
    if (has('br1')) push('main', 'br1', 'N');
  }
  const extras = rooms.filter(r => !r.required && r.key !== 'hall' && r.key !== 'dining'
    && r.key !== 'office' && r.key !== 'wash' && r.key !== 'back'
    && r.key !== 'exam' && r.key !== 'dock');
  for (const extra of extras) {
    push('main', extra.key, 'S');
  }
  const exterior = [];
  if (has('dock')) {
    exterior.push({
      room: 'dock',
      wall: 'N',
      openings: [{ type: 'door', label: 'Loading' }],
    });
    if (has('main')) {
      exterior.push({
        room: 'main',
        wall: 'S',
        openings: [{ type: 'door', label: 'Personnel' }],
      });
    }
  } else if (has('promenade1')) {
    exterior.push({
      room: 'promenade1',
      wall: 'S',
      openings: [{ type: 'door', label: 'Main Entrance' }],
    });
  } else if (has('promenade')) {
    exterior.push({
      room: 'promenade',
      wall: 'S',
      openings: [{ type: 'door', label: 'Arcade Entrance' }],
    });
  } else if (has('concourse')) {
    exterior.push({
      room: 'concourse',
      wall: 'S',
      openings: [{ type: 'door', label: 'Station Entrance' }],
    });
  } else if (has('lobby')) {
    exterior.push({
      room: 'lobby',
      wall: 'S',
      openings: [{ type: 'door', label: 'Main Entrance' }],
    });
  } else if (has('main')) {
    const door = has('exam') ? 'Clinic door' : (commercial ? 'Shop door' : 'Front door');
    exterior.push({
      room: 'main',
      wall: 'S',
      openings: [
        { type: 'door', label: door },
        { type: 'window', label: 'Street' },
      ],
    });
  }
  return { adjacencies: adj, exterior };
}

export function smokeRoomProgramPure() {
  try {
    const studio = expandProgram('studio');
    if (studio.rooms.length !== 4) return `studio count ${studio.rooms.length}`;
    if (studio.hostKind !== 'unit') return 'studio host';
    if (!studio.rooms.some(r => r.listing === 'lr') || !studio.rooms.some(r => r.listing === 'bath')) {
      return 'studio listings';
    }
    const house = expandProgram('small_house');
    if (house.hostKind !== 'building') return 'house host';
    const codes = house.rooms.map(r => r.listing).sort().join(',');
    if (!codes.includes('br') || !codes.includes('hall') || !codes.includes('dr')) {
      return `house listings ${codes}`;
    }
    const brN = house.rooms.filter(r => r.listing === 'br').length;
    if (brN !== 2) return `house bedrooms ${brN}`;
    const extras = expandProgram('studio', { extras: [{ name: 'Study', listing: 'off' }, { name: 'Pantry', listing: 'util' }, { name: 'Bonus', listing: 'off' }] });
    if (extras.rooms.filter(r => !r.required && r.key !== 'hall').length > 2) return 'extra cap';
    const compass = {
      rooms: {
        b: { id: 'b', name: 'Heights', kind: 'building' },
        u: { id: 'u', name: '515', kind: 'unit', parentId: 'b' },
        r: { id: 'r', name: 'Main', kind: 'room', parentId: 'u' },
      },
    };
    if (emptySuiteHost(compass, compass.rooms.b)) return 'building with unit rooms should skip';
    if (emptySuiteHost(compass, compass.rooms.u)) return 'unit with rooms should skip';
    const emptyB = { rooms: { b: { id: 'b', name: 'Heights', kind: 'building' } } };
    if (!emptySuiteHost(emptyB, emptyB.rooms.b)) return 'empty building should trigger';
    const emptyU = { rooms: { b: { id: 'b', kind: 'building' }, u: { id: 'u', kind: 'unit', parentId: 'b' } } };
    if (!emptySuiteHost(emptyU, emptyU.rooms.u)) return 'empty unit should trigger';
    if (emptySuiteHost(emptyB, { id: 'x', kind: 'settlement' })) return 'city should not trigger';
    if (canonicalizeTypology('1BR') !== 'one_bed') return 'typology 1br';
    if (canonicalizeTypology('cottage') !== 'small_house') return 'typology house';
    const dropped = expandProgram('small_house', { includeOptional: false });
    if (dropped.rooms.some(r => r.key === 'dining')) return 'optional dining';
    if (inferSuiteUse({ hostName: 'Okisato Antiques' }) !== 'commercial') return 'antiques should be commercial';
    if (canonicalizeTypology('studio', { hostName: 'Okisato Antiques', hostKind: 'unit' }) !== 'shop') {
      return 'shop host should not file as apartment studio';
    }
    if (canonicalizeTypology('studio', { hostName: 'Upper Unit', hostKind: 'unit' }) !== 'studio') {
      return 'apartment studio should stay residential';
    }
    const shop = expandProgram('shop');
    if (shop.use !== 'commercial' || !shop.rooms.some(r => r.listing === 'shop')) return 'shop program';
    if (shop.rooms.some(r => r.listing === 'lr' || r.listing === 'br' || r.listing === 'kitchn')) {
      return 'shop should not require living/bed/kitchen';
    }
    const shopExtra = expandProgram('shop', { extras: [{ name: 'Kitchenette', listing: 'kitchn' }] });
    if (shopExtra.rooms.some(r => r.listing === 'kitchn')) return 'shop extra kitchenette should remap';
    const cafe = expandProgram('cafe');
    if (!cafe.rooms.some(r => r.listing === 'kitchn')) return 'cafe keeps a kitchen';
    if (typologyHeadline('shop') !== 'commercial · shop') return 'shop headline';
    const shopAdj = defaultAdjacencies(shop.rooms);
    if (!shopAdj.adjacencies.some(a => a.a === 'main' && a.b === 'back')) return 'shop back adjacency';
    if (inferSuiteUse({ hostName: 'Sato Clinic' }) !== 'professional') return 'clinic host should be professional';
    if (canonicalizeTypology('studio', { hostName: 'Sato Clinic', hostKind: 'unit' }) !== 'clinic') {
      return 'clinic host should not file as apartment studio';
    }
    if (canonicalizeTypology('office', { hostName: 'Sato Clinic', hostKind: 'unit' }) !== 'clinic') {
      return 'clinic host should not stay a file-room office';
    }
    const clinic = expandProgram('clinic');
    if (clinic.use !== 'professional' || !clinic.rooms.some(r => r.listing === 'wait')) return 'clinic program';
    if (!clinic.rooms.some(r => r.listing === 'exam') || clinic.rooms.some(r => r.listing === 'lr' || r.listing === 'br')) {
      return 'clinic should be waiting + exam, not housing';
    }
    const clinicAdj = defaultAdjacencies(clinic.rooms);
    if (!clinicAdj.adjacencies.some(a => a.a === 'main' && a.b === 'exam')) return 'clinic exam adjacency';
    if (!clinicAdj.exterior.some(e => e.openings.some(o => o.label === 'Clinic door'))) return 'clinic street door';
    if (inferSuiteUse({ hostName: 'Harbor Warehouse' }) !== 'industrial') return 'warehouse host should be industrial';
    if (canonicalizeTypology('studio', { hostName: 'Harbor Warehouse', hostKind: 'unit' }) !== 'warehouse') {
      return 'warehouse host should not file as apartment studio';
    }
    const warehouse = expandProgram('warehouse');
    if (warehouse.use !== 'industrial' || !warehouse.rooms.some(r => r.listing === 'dock')) return 'warehouse program';
    if (warehouse.rooms.some(r => r.listing === 'shop' || r.listing === 'lr')) return 'warehouse should not be a shop';
    const dockAdj = defaultAdjacencies(warehouse.rooms);
    if (!dockAdj.adjacencies.some(a => a.a === 'main' && a.b === 'dock')) return 'warehouse dock adjacency';
    if (!dockAdj.exterior.some(e => e.room === 'dock')) return 'warehouse loading exterior';
    if (typologyHeadline('clinic') !== 'professional · clinic') return 'clinic headline';
    if (typologyHeadline('warehouse') !== 'industrial · warehouse') return 'warehouse headline';
    const clinicExtra = expandProgram('clinic', { extras: [{ name: 'Kitchenette', listing: 'kitchn' }] });
    if (clinicExtra.rooms.some(r => r.listing === 'kitchn')) return 'clinic extra kitchenette should remap';
    return '';
  } catch (err) {
    return err?.message || String(err);
  }
}
