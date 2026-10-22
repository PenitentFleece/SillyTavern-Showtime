// Place neighborhood for World Index: ancestors + building/unit children + 1-hop links.

import { isSuiteHostKind } from './compass/schema.js';
import { geographicAncestors } from './locationCatalog.js';

function nearestBuildingOrUnit(rooms, seed) {
  if (!seed) return null;
  const kind = String(seed.kind || '').trim();
  if (kind === 'building' || kind === 'unit' || isSuiteHostKind(kind)) return seed;
  const guard = new Set();
  let walk = String(seed.parentId || '').trim();
  while (walk && rooms[walk] && !guard.has(walk)) {
    guard.add(walk);
    const p = rooms[walk];
    const pk = String(p.kind || '').trim();
    if (pk === 'building' || pk === 'unit' || isSuiteHostKind(pk)) return p;
    walk = String(p.parentId || '').trim();
  }
  return null;
}

/**
 * Walked place neighborhood from the active room (or sonar last-known).
 * Tree ancestors + children of the nearest building/unit + 1-hop wall links.
 * @returns {{ seedId: string, ids: Set<string>, reasons: Map<string, string>, tags: string[] }}
 */
export function placeNeighborhood(compass, seedId) {
  const rooms = compass?.rooms || {};
  const seed = rooms[String(seedId || '').trim()];
  const ids = new Set();
  const reasons = new Map();
  const tags = [];
  if (!seed?.id) return { seedId: '', ids, reasons, tags };

  const add = (id, reason) => {
    const key = String(id || '').trim();
    if (!key || !rooms[key] || ids.has(key)) return;
    ids.add(key);
    reasons.set(key, reason);
  };

  add(seed.id, 'active-room');

  const seenAnc = new Set([seed.id]);
  let walk = String(seed.parentId || '').trim();
  while (walk && rooms[walk] && !seenAnc.has(walk)) {
    seenAnc.add(walk);
    add(walk, 'ancestor');
    walk = String(rooms[walk].parentId || '').trim();
  }
  for (const g of geographicAncestors(compass, seed.id)) {
    add(g.id, 'ancestor');
  }

  const host = nearestBuildingOrUnit(rooms, seed);
  if (host) {
    for (const r of Object.values(rooms)) {
      if (r?.id && r.parentId === host.id) add(r.id, r.id === seed.id ? 'active-room' : 'child');
    }
  }

  for (const link of seed.links || []) {
    add(link?.toPlaceId, 'neighbor');
  }
  for (const r of Object.values(rooms)) {
    if (!r?.id || r.id === seed.id) continue;
    for (const link of r.links || []) {
      if (String(link?.toPlaceId || '').trim() === seed.id) add(r.id, 'neighbor');
    }
  }

  const seenTag = new Set();
  for (const id of ids) {
    const room = rooms[id];
    for (const raw of [room?.name, ...(room?.locationTags || []), ...(room?.aliases || [])]) {
      const s = String(raw || '').trim();
      const k = s.toLowerCase();
      if (!s || seenTag.has(k)) continue;
      seenTag.add(k);
      tags.push(s);
    }
  }
  return { seedId: seed.id, ids, reasons, tags };
}

export function smokePlaceNeighborhoodPure() {
  const rooms = {
    jp: { id: 'jp', name: 'Japan', kind: 'region', parentId: '' },
    fk: { id: 'fk', name: 'Fukuoka', kind: 'settlement', parentId: 'jp' },
    mall: { id: 'mall', name: 'Canal City Mall', kind: 'district', parentId: 'fk' },
    shop: { id: 'shop', name: 'Okisato Antiques', kind: 'building', parentId: 'mall' },
    rm: { id: 'rm', name: 'Shop Floor', kind: 'room', parentId: 'shop', links: [{ toPlaceId: 'hall' }] },
    hall: { id: 'hall', name: 'Stock Hall', kind: 'room', parentId: 'shop' },
    tokyo: { id: 'tokyo', name: 'Tokyo', kind: 'settlement', parentId: 'jp' },
    kr: { id: 'kr', name: 'Korea', kind: 'region', parentId: '' },
  };
  const nb = placeNeighborhood({ rooms }, 'rm');
  if (nb.reasons.get('rm') !== 'active-room') return 'active room reason';
  if (!nb.ids.has('fk') || nb.reasons.get('fk') !== 'ancestor') return 'active room should pull parent city';
  if (!nb.ids.has('shop') || !nb.ids.has('hall')) return 'building children / 1-hop should be in neighborhood';
  if (nb.ids.has('tokyo')) return 'unrelated city under the same country should stay out';
  if (nb.ids.has('kr')) return 'unrelated country should stay out';
  return '';
}
