// Suite interior builder: geo chain → named program (review) → pack + openings.

import { PLACE_KIND_SET, PLACE_NEST_PARENTS, GEO_PLACE_KIND_SET, OPENING_TYPE_SET, CARDINAL_TO_EDGE } from './schema.js';
import {
  createAndStoreRoom,
  setParent,
  setPlaceCategory,
  setPlaceDescription,
  setPlaceListingCode,
  setFootprint,
  setSuiteLayout,
  pushSuiteHistory,
  addLink,
  addOpening,
  ensureEdgeLink,
  linkWallToExterior,
  findPlaceIdByKey,
  getPlace,
  listSuiteChildren,
  reconcileSuiteSnapLinks,
} from './state.js';
import { listSuiteUnits, findContactingPairs, ensureSuiteChildPoses, worldAabb, SUITE_CONTACT_TOL } from './suiteLayout.js';
import { populateRoomsFromNarrative } from './roomDresser.js';
import { matchPlaceName, knownPlaceRoster } from './unlisted.js';
import { inferListingCode } from './listing.js';
import { listVisibleLibraryLeaves } from '../libraryCatalog.js';
import { placeNeighborhood } from '../placeNeighborhood.js';
import { parseJsonObject } from '../jsonExtract.js';
import {
  canonicalizeTypology,
  categoryLabel,
  expandProgram,
  emptySuiteHost,
  defaultAdjacencies,
  suiteUseOf,
  typologyHeadline,
  SUITE_TYPOLOGY_SET,
} from './roomProgram.js';
import { footprintForListing, packFromAdjacency } from './suitePack.js';

const CHAIN_SCHEMA = {
  type: 'object',
  properties: {
    chain: {
      type: 'array',
      items: {
        type: 'object',
        properties: { name: { type: 'string' }, kind: { type: 'string' } },
      },
    },
    unit: { type: ['object', 'null'], properties: { name: { type: 'string' } } },
    typology: { type: 'string' },
  },
};

const ADJ_SCHEMA = {
  type: 'object',
  properties: {
    adjacencies: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          a: { type: 'string' },
          b: { type: 'string' },
          wall: { type: 'string' },
          openings: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string' },
                label: { type: 'string' },
              },
            },
          },
        },
      },
    },
    exterior: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          room: { type: 'string' },
          wall: { type: 'string' },
          openings: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string' },
                label: { type: 'string' },
              },
            },
          },
        },
      },
    },
  },
};

function locKey(s) {
  return String(s || '').trim().toLowerCase();
}

function clipScene(scene) {
  return String(scene || '').trim();
}

function cultureBrief(storage, compass, seedId) {
  const parts = [];
  try {
    const nb = placeNeighborhood(compass, seedId);
    const bag = new Set((nb.tags || []).map(t => locKey(t)).filter(Boolean));
    const leaves = listVisibleLibraryLeaves(storage);
    const scored = leaves.map(l => {
      const tags = l.tags || [];
      let score = 0;
      for (const t of tags) {
        const type = String(t.type || '').toLowerCase();
        const val = locKey(t.value);
        if (/culture|faction/.test(type)) score += 2;
        if (/place|location/.test(type)) score += 2;
        if (val && bag.has(val)) score += 3;
      }
      return { l, score };
    }).filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 10);
    parts.push(scored.map(({ l }) => {
      const tag = (l.tags || []).map(t => `${t.type}:${t.value || t}`).slice(0, 4).join(', ');
      return `- ${l.title}${tag ? ` 〔${tag}〕` : ''}: ${String(l.content || '').replace(/\s+/g, ' ').slice(0, 140)}`;
    }).join('\n') || '(none)');
  } catch {
    parts.push('(unavailable)');
  }
  return parts.join('\n');
}

async function filingGenerate(storage, prompt, jsonSchema) {
  const { withShowtimeProfile } = await import('../connectionProfile.js');
  const { leanQuietGenerate } = await import('../isolatedGen.js');
  return withShowtimeProfile(storage, 'audit', () =>
    leanQuietGenerate(prompt, { kind: 'filing', jsonSchema }));
}

export function occupancyNeedsSuiteBuild(compass, travel) {
  if (!compass || typeof travel !== 'object' || !travel) return null;
  if (travel.mode !== 'compass') return null;
  let place = getPlace(compass, travel.placeId);
  if (!place) {
    const id = findPlaceIdByKey(compass, travel.placeKey);
    place = getPlace(compass, id);
  }
  return emptySuiteHost(compass, place);
}

function allowedParent(compass, kind, prev) {
  const allow = PLACE_NEST_PARENTS[kind] || [];
  if (!prev) return '';
  let walk = prev;
  const seen = new Set();
  while (walk && !seen.has(walk.id)) {
    seen.add(walk.id);
    if (allow.includes(walk.kind)) return walk.id;
    walk = compass?.rooms?.[walk.parentId] || null;
  }
  return '';
}

function walkParent(compass, place, pred) {
  let cur = place;
  const seen = new Set();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    if (pred(cur)) return cur;
    cur = compass.rooms?.[cur.parentId];
  }
  return null;
}

/**
 * File geo chain + optional unit. Does not create interior rooms.
 * @returns {{ host: object, typology: string, createdIds: string[], occupancy: object }}
 */
export function applyGeoChain(compass, storage, filing, occupancyPlace) {
  const createdIds = [];
  const chain = Array.isArray(filing?.chain) ? filing.chain : [];
  let prev = null;
  const occupancy = occupancyPlace || null;
  if (occupancy && GEO_PLACE_KIND_SET.has(occupancy.kind)) {
    const ancestors = [];
    let walk = occupancy;
    const seen = new Set();
    while (walk && !seen.has(walk.id)) {
      seen.add(walk.id);
      ancestors.unshift(walk);
      walk = compass.rooms?.[walk.parentId];
    }
    prev = ancestors[ancestors.length - 1] || occupancy;
  }

  for (const step of chain) {
    const name = String(step?.name || '').trim();
    if (!name) continue;
    let kind = String(step?.kind || '').trim().toLowerCase();
    if (!PLACE_KIND_SET.has(kind) || !GEO_PLACE_KIND_SET.has(kind)) continue;
    const hit = matchPlaceName(compass, storage, name);
    let place = hit?.place || null;
    if (!place) {
      const parentId = allowedParent(compass, kind, prev);
      place = createAndStoreRoom(compass, { name, kind, parentId });
      createdIds.push(place.id);
    } else if (prev && !place.parentId) {
      const pid = allowedParent(compass, place.kind, prev);
      if (pid) {
        try { setParent(compass, place.id, pid); } catch { /* ignore */ }
      }
    }
    prev = compass.rooms[place.id] || place;
  }

  const typology = canonicalizeTypology(filing?.typology, {
    hostKind: occupancy?.kind,
    hostName: occupancy?.name,
  });
  const program = expandProgram(typology);
  let host = occupancy;

  if (occupancy?.kind === 'unit') {
    host = occupancy;
  } else if (occupancy?.kind === 'building') {
    if (program.hostKind === 'building') {
      host = occupancy;
    } else {
      const units = listSuiteUnits(compass, occupancy.id);
      const emptyUnit = units.find(u => !listSuiteChildren(compass, u.id).length);
      const unitName = String(filing?.unit?.name || '').trim();
      if (emptyUnit) host = emptyUnit;
      else if (unitName) {
        const hit = matchPlaceName(compass, storage, unitName);
        if (hit?.place?.kind === 'unit' && hit.place.parentId === occupancy.id) host = hit.place;
        else {
          host = createAndStoreRoom(compass, { name: unitName, kind: 'unit', parentId: occupancy.id });
          createdIds.push(host.id);
        }
      } else {
        host = createAndStoreRoom(compass, {
          name: occupancy.name ? `${occupancy.name} unit` : 'Unit',
          kind: 'unit',
          parentId: occupancy.id,
        });
        createdIds.push(host.id);
      }
    }
  } else {
    const building = walkParent(compass, prev, p => p.kind === 'building') || prev;
    host = building;
  }

  return { host, typology, createdIds, occupancy: occupancy || host };
}

function parseChainFiling(raw) {
  const obj = parseJsonObject(raw) || {};
  const chain = Array.isArray(obj.chain) ? obj.chain.map(s => ({
    name: String(s?.name || '').trim(),
    kind: String(s?.kind || '').trim().toLowerCase(),
  })).filter(s => s.name) : [];
  const unitName = String(obj.unit?.name || '').trim();
  return {
    chain,
    unit: unitName ? { name: unitName } : null,
    typology: String(obj.typology || '').trim(),
  };
}

function mergeNamedRooms(program, named = []) {
  const byKey = new Map();
  for (const r of named) {
    const key = String(r?.key || '').trim();
    if (key) byKey.set(key, r);
  }
  const extras = [];
  for (const r of named) {
    if (r?.extra || (r?.key && !program.rooms.some(p => p.key === r.key))) {
      extras.push(r);
    }
  }
  const expanded = expandProgram(program.typology, { extras, includeOptional: true });
  const rooms = expanded.rooms.map((row) => {
    const hit = byKey.get(row.key);
    if (!hit) return row;
    return {
      ...row,
      name: String(hit.name || row.name).trim() || row.name,
      blurb: String(hit.blurb || row.blurb || '').trim(),
    };
  });
  const required = program.rooms.filter(r => r.required).map(r => r.key);
  for (const key of required) {
    if (!rooms.some(r => r.key === key)) {
      const orig = program.rooms.find(r => r.key === key);
      if (orig) rooms.push({ ...orig, blurb: '' });
    }
  }
  return rooms;
}

function parseAdj(raw, rooms) {
  const obj = parseJsonObject(raw);
  const keys = new Set(rooms.map(r => r.key));
  const wallOk = (w) => /^(N|E|S|W)$/.test(String(w || '').toUpperCase());
  const openingsOf = (list) => (Array.isArray(list) ? list : []).map(o => ({
    type: OPENING_TYPE_SET.has(String(o?.type || '').toLowerCase()) ? String(o.type).toLowerCase() : 'door',
    label: String(o?.label || '').trim(),
  })).filter(o => o.type !== 'ascent' && o.type !== 'descent');
  const adjacencies = Array.isArray(obj?.adjacencies) ? obj.adjacencies.map(a => ({
    a: String(a?.a || '').trim(),
    b: String(a?.b || '').trim(),
    wall: String(a?.wall || 'E').trim().toUpperCase(),
    openings: openingsOf(a?.openings),
  })).filter(a => keys.has(a.a) && keys.has(a.b) && a.a !== a.b && wallOk(a.wall)) : [];
  const exterior = Array.isArray(obj?.exterior) ? obj.exterior.map(e => ({
    room: String(e?.room || '').trim(),
    wall: String(e?.wall || 'S').trim().toUpperCase(),
    openings: openingsOf(e?.openings),
  })).filter(e => keys.has(e.room) && wallOk(e.wall)) : [];
  const fallback = defaultAdjacencies(rooms);
  return {
    adjacencies: adjacencies.length ? adjacencies : fallback.adjacencies,
    exterior: exterior.length ? exterior : fallback.exterior,
  };
}

export async function runSuiteProgram(storage, compass, travel, { generate = filingGenerate, scene = '', useLlmChain = false } = {}) {
  const hostSeed = occupancyNeedsSuiteBuild(compass, travel);
  if (!hostSeed) return { skipped: 'occupied' };
  const draft = compass.suiteDraft;
  if (draft?.status === 'review') return { skipped: 'draft' };
  if (draft?.status === 'dismissed'
    && (draft.hostId === hostSeed.id || draft.occupancyPlaceId === hostSeed.id)) {
    return { skipped: 'dismissed' };
  }

  let filing = { chain: [], unit: null, typology: '' };
  if (useLlmChain && typeof generate === 'function') {
    const sceneText = clipScene(scene);
    const roster = knownPlaceRoster(compass);
    const chainPrompt = `You are filing where the scene is standing.

Scene:
${sceneText || '(quiet)'}

Known places:
${roster}

Return ONLY JSON: {"chain":[{"name":"","kind":""}],"unit":null,"typology":""}
- chain: country (region), city (settlement), optional area (district), then building. Reuse known names. Skip kinds you cannot support.
- unit: apartment/suite name if this is housing; else null for a shop / clinic / warehouse occupying the building.
- typology residential: studio | one_bed | two_bed | small_house.
- typology commercial: shop | workshop | cafe | office.
- typology professional: clinic.
- typology industrial: warehouse.
- Occupancy is "${hostSeed.name}" (${hostSeed.kind}). A shop, antiques, cafe, or office is commercial. A clinic or dental practice is professional. A warehouse or depot is industrial. None of those are a housing studio.
- Do not invent interior rooms.

JSON:`;
    let chainRaw = '';
    try { chainRaw = await generate(storage, chainPrompt, CHAIN_SCHEMA); } catch { chainRaw = ''; }
    filing = parseChainFiling(chainRaw);
  }
  filing.typology = canonicalizeTypology(filing.typology || hostSeed.category || '', {
    hostKind: hostSeed.kind,
    hostName: hostSeed.name,
  });
  const applied = applyGeoChain(compass, storage, filing, hostSeed);
  const host = applied.host || hostSeed;
  if (!host?.id) return { skipped: 'host' };
  const program = expandProgram(applied.typology);
  const rooms = mergeNamedRooms(program, []);
  compass.suiteDraft = {
    at: Date.now(),
    occupancyPlaceId: hostSeed.id,
    hostId: host.id,
    hostKind: host.kind,
    typology: applied.typology,
    hostName: host.name,
    description: '',
    rooms,
    status: 'review',
  };
  return { draft: compass.suiteDraft, createdIds: applied.createdIds };
}

function linkBetween(compass, aId, bId) {
  const a = compass.rooms[aId];
  return (a?.links || []).find(l => l.toPlaceId === bId) || null;
}

function applyOpenings(compass, fromId, linkId, openings) {
  for (const op of openings || []) {
    try {
      addOpening(compass, fromId, linkId, {
        type: op.type || 'door',
        label: op.label || '',
      });
    } catch { /* ignore */ }
  }
}

/**
 * Write rooms + poses + labelled openings from a review draft.
 * @returns {{ hostId: string, roomIds: string[], packed: boolean }}
 */
export function commitSuiteInterior(compass, draft, { adjRaw = '', narrativeText = '' } = {}) {
  const host = getPlace(compass, draft?.hostId);
  if (!host) throw new Error('Suite host is gone.');
  if (listSuiteChildren(compass, host.id).length) throw new Error('This place already has rooms.');

  const rooms = Array.isArray(draft.rooms) ? draft.rooms : [];
  const keyToId = {};
  for (const row of rooms) {
    const listing = row.listing || inferListingCode({ name: row.name, kind: row.kind });
    const footprint = footprintForListing(listing, row.size);
    const created = createAndStoreRoom(compass, {
      name: row.name || listing || 'Room',
      kind: row.kind === 'transitional' || listing === 'hall' ? 'transitional' : 'room',
      parentId: host.id,
      description: row.blurb || '',
      listingCode: listing,
      story: row.story,
      footprint,
    });
    keyToId[row.key] = created.id;
    try { setPlaceListingCode(compass, created.id, listing); } catch { /* ignore */ }
    try { setFootprint(compass, created.id, footprint); } catch { /* ignore */ }
  }
  if (draft.hostName && draft.hostName !== host.name) {
    /* keep occupancy name; description only */
  }
  if (draft.description) {
    try { setPlaceDescription(compass, host.id, draft.description); } catch { /* ignore */ }
  }

  const layoutRooms = rooms.map(r => ({
    key: r.key,
    id: keyToId[r.key],
    listing: r.listing,
    size: r.size,
    footprint: compass.rooms[keyToId[r.key]]?.footprint,
  }));
  const parsedAdj = parseAdj(adjRaw, rooms);
  const packed = packFromAdjacency(layoutRooms, parsedAdj.adjacencies);
  const layoutById = {};
  for (const r of layoutRooms) {
    const pose = packed.layout[r.key];
    if (pose && r.id) layoutById[r.id] = pose;
  }
  let usedPack = packed.ok;
  if (!usedPack) {
    const children = listSuiteChildren(compass, host.id);
    const tiled = ensureSuiteChildPoses(host, children);
    Object.assign(layoutById, tiled.layout);
  }
  try { setSuiteLayout(compass, host.id, layoutById); } catch { /* ignore */ }
  try { reconcileSuiteSnapLinks(compass, host.id); } catch { /* ignore */ }

  const liveKids = listSuiteChildren(compass, host.id);
  if (usedPack) {
    for (const edge of parsedAdj.adjacencies) {
      const aId = keyToId[edge.a];
      const bId = keyToId[edge.b];
      if (!aId || !bId) continue;
      let link = linkBetween(compass, aId, bId);
      if (!link) {
        try {
          link = addLink(compass, aId, { wall: edge.wall, toPlaceId: bId });
        } catch { continue; }
      }
      applyOpenings(compass, aId, link.id, edge.openings?.length ? edge.openings : [{ type: 'door', label: '' }]);
    }
  } else {
    const pairs = findContactingPairs(liveKids, compass.rooms[host.id]?.suiteLayout || layoutById, SUITE_CONTACT_TOL);
    for (const pair of pairs) {
      const link = linkBetween(compass, pair.aId, pair.bId);
      if (!link) continue;
      if ((link.openings || []).length) continue;
      applyOpenings(compass, pair.aId, link.id, [{ type: 'door', label: '' }]);
    }
  }

  for (const ext of parsedAdj.exterior) {
    const roomId = keyToId[ext.room];
    if (!roomId) continue;
    const wall = ext.wall || 'S';
    const edge = CARDINAL_TO_EDGE[wall];
    let link = null;
    try { link = ensureEdgeLink(compass, roomId, edge); } catch { /* ignore */ }
    if (!link) continue;
    try { linkWallToExterior(compass, roomId, link.id); } catch { /* ignore */ }
    applyOpenings(compass, roomId, link.id, ext.openings);
  }

  const prose = String(narrativeText || draft.description || '').trim();
  let dressed = { addedCount: 0, updatedCount: 0 };
  if (prose) {
    try {
      dressed = populateRoomsFromNarrative(compass, prose, {
        targetPlaceId: host.id,
        createMissingRooms: false,
      });
    } catch { /* ignore */ }
  }

  compass.suiteDraft = null;
  return {
    hostId: host.id,
    roomIds: Object.values(keyToId),
    packed: usedPack,
    dressedCount: (dressed.addedCount || 0) + (dressed.updatedCount || 0),
  };
}

export async function commitSuiteDraft(storage, compass, { generate = filingGenerate, scene = '' } = {}) {
  const draft = compass?.suiteDraft;
  if (!draft || draft.status !== 'review') throw new Error('No interior draft to build.');
  const sceneText = clipScene(scene);
  const adjPrompt = `Connect these rooms with doors/windows. No coordinates.

Host: ${draft.hostName} (${typologyHeadline(draft.typology)})
Rooms: ${draft.rooms.map(r => `${r.key}=${r.name} (${r.listing})`).join(', ')}

Scene:
${sceneText || '(quiet)'}

Return ONLY JSON: {"adjacencies":[{"a":"main","b":"hall","wall":"N","openings":[{"type":"door","label":"Hall"}]}],"exterior":[{"room":"main","wall":"S","openings":[{"type":"door","label":"Front"}]}]}
- a/b are room keys. wall is N,E,S,W on a facing b.
${suiteUseOf(draft.typology) === 'commercial'
    ? '- Sales floor / workshop faces the street. Back room and stock off the floor. Skip bedrooms.'
    : suiteUseOf(draft.typology) === 'professional'
      ? '- Waiting faces the street. Exam and office off the waiting room. Skip bedrooms.'
      : suiteUseOf(draft.typology) === 'industrial'
        ? '- Floor to office. Loading dock is the rear exterior, not a shop door. Skip bedrooms.'
        : '- Prefer a hall/entry as the spine when one exists. Closets off kitchens or bedrooms.'}
- exterior: street-facing door/windows. Skip above/below.

JSON:`;
  let adjRaw = '';
  try { adjRaw = await generate(storage, adjPrompt, ADJ_SCHEMA); } catch { adjRaw = ''; }
  return commitSuiteInterior(compass, draft, { adjRaw, narrativeText: sceneText });
}

export function dismissSuiteDraft(compass) {
  if (!compass?.suiteDraft) return false;
  compass.suiteDraft = { ...compass.suiteDraft, status: 'dismissed' };
  return true;
}

/**
 * Deterministically populate a building with rooms/corridors for a category (zero LLM calls).
 * Arranges rooms into a connected floorplan and places default doors on shared walls.
 */
export function populatePlaceFromCategory(compass, placeId, categoryKey = '', { narrativeText = '' } = {}) {
  const host = getPlace(compass, placeId);
  if (!host) throw new Error('Place not found.');
  if (host.kind !== 'building') {
    throw new Error('Populate adds rooms inside a building. Set this place’s kind to Building first.');
  }
  const rawCat = String(categoryKey || host.category || '').trim().toLowerCase().replace(/[- ]+/g, '_');
  const typology = SUITE_TYPOLOGY_SET.has(rawCat)
    ? rawCat
    : canonicalizeTypology(rawCat, { hostKind: host.kind, hostName: host.name });
  try { setPlaceCategory(compass, host.id, typology); } catch { /* ignore */ }
  try { pushSuiteHistory(compass, host.id, `populate ${categoryLabel(typology) || typology}`); } catch { /* ignore */ }

  const prog = expandProgram(typology, { includeOptional: true });
  const existingKids = listSuiteChildren(compass, host.id);
  const existingByName = new Map(
    existingKids.map(c => [String(c.name || '').trim().toLowerCase(), c]),
  );

  const keyToId = {};
  const createdIds = [];
  for (const row of prog.rooms) {
    const listing = row.listing || inferListingCode({ name: row.name, kind: row.kind });
    const footprint = footprintForListing(listing, row.size);
    const existing = existingByName.get(String(row.name || '').trim().toLowerCase());
    if (existing) {
      keyToId[row.key] = existing.id;
      continue;
    }
    const created = createAndStoreRoom(compass, {
      name: row.name || listing || 'Room',
      kind: row.kind === 'transitional' || listing === 'hall' ? 'transitional' : 'room',
      parentId: host.id,
      description: row.blurb || '',
      listingCode: listing,
      story: row.story,
      footprint,
    });
    keyToId[row.key] = created.id;
    createdIds.push(created.id);
    try { setPlaceListingCode(compass, created.id, listing); } catch { /* ignore */ }
    try { setFootprint(compass, created.id, footprint); } catch { /* ignore */ }
  }

  const layoutRooms = prog.rooms.map(r => ({
    key: r.key,
    id: keyToId[r.key],
    listing: r.listing,
    size: r.size,
    story: r.story,
    footprint: compass.rooms[keyToId[r.key]]?.footprint,
  })).filter(r => r.id);

  const parsedAdj = defaultAdjacencies(prog.rooms);
  const packed = packFromAdjacency(layoutRooms, parsedAdj.adjacencies);
  const layoutById = {};
  let maxX = 0;
  for (const r of layoutRooms) {
    const pose = packed.layout[r.key];
    if (pose && r.id) {
      layoutById[r.id] = pose;
      const box = worldAabb(compass.rooms[r.id] || r, pose);
      if (Number.isFinite(box.maxX)) maxX = Math.max(maxX, box.maxX);
    }
  }

  // Keep any pre-existing rooms that weren't part of the template positioned cleanly beside the packed cluster
  const liveKids = listSuiteChildren(compass, host.id);
  const prevLayout = host.suiteLayout || {};
  let cursorX = maxX + 4;
  for (const kid of liveKids) {
    if (layoutById[kid.id]) continue;
    if (prevLayout[kid.id]) {
      layoutById[kid.id] = prevLayout[kid.id];
    } else {
      layoutById[kid.id] = { x: cursorX, y: 0, rot: 0 };
      const box = worldAabb(kid, layoutById[kid.id]);
      cursorX = Math.max(cursorX + 12, (Number.isFinite(box.maxX) ? box.maxX : cursorX) + 4);
    }
  }

  try { setSuiteLayout(compass, host.id, layoutById); } catch { /* ignore */ }
  try { reconcileSuiteSnapLinks(compass, host.id); } catch { /* ignore */ }

  const pairs = findContactingPairs(
    listSuiteChildren(compass, host.id),
    compass.rooms[host.id]?.suiteLayout || layoutById,
    SUITE_CONTACT_TOL,
  );
  for (const pair of pairs) {
    const a = compass.rooms[pair.aId];
    const link = (a?.links || []).find(l => l.toPlaceId === pair.bId && l.edge === pair.edgeA)
      || linkBetween(compass, pair.aId, pair.bId);
    if (!link) continue;
    if ((link.openings || []).length) continue;
    const bName = compass.rooms[pair.bId]?.name || '';
    applyOpenings(compass, pair.aId, link.id, [{ type: 'door', label: bName }]);
  }

  for (const ext of parsedAdj.exterior) {
    const roomId = keyToId[ext.room];
    if (!roomId) continue;
    const wall = ext.wall || 'S';
    const edge = CARDINAL_TO_EDGE[wall];
    // Only mark exterior if that edge is not already contacting a sibling room
    const a = compass.rooms[roomId];
    const siblingOnEdge = (a?.links || []).some(l => l.edge === edge && l.toPlaceId);
    if (siblingOnEdge) continue;
    let link = null;
    try { link = ensureEdgeLink(compass, roomId, edge); } catch { /* ignore */ }
    if (!link || (link.openings || []).length) continue;
    try { linkWallToExterior(compass, roomId, link.id); } catch { /* ignore */ }
    applyOpenings(compass, roomId, link.id, ext.openings);
  }

  if (compass.suiteDraft?.hostId === host.id) {
    compass.suiteDraft = null;
  }

  const prose = String(narrativeText || host.description || '').trim();
  let dressed = { addedCount: 0, updatedCount: 0 };
  if (prose) {
    try {
      dressed = populateRoomsFromNarrative(compass, prose, {
        targetPlaceId: host.id,
        createMissingRooms: true,
      });
    } catch { /* ignore */ }
  }

  return {
    hostId: host.id,
    typology,
    createdIds,
    roomIds: Object.values(keyToId),
    dressedCount: (dressed.addedCount || 0) + (dressed.updatedCount || 0),
  };
}

export function smokeRoomBuilderPure() {
  try {
    const compass = {
      rooms: {
        jp: { id: 'jp', name: 'Japan', kind: 'region' },
        fukuoka: { id: 'fukuoka', name: 'Fukuoka', kind: 'settlement', parentId: 'jp' },
        heights: { id: 'heights', name: 'Fukuoka Heights', kind: 'building', parentId: 'fukuoka' },
      },
    };
    const before = Object.keys(compass.rooms).length;
    const applied = applyGeoChain(compass, null, {
      chain: [
        { name: 'Japan', kind: 'region' },
        { name: 'Fukuoka', kind: 'settlement' },
        { name: 'Fukuoka Heights', kind: 'building' },
      ],
      unit: { name: '515-O' },
      typology: 'studio',
    }, compass.rooms.heights);
    if (applied.host?.kind !== 'unit') return `host kind ${applied.host?.kind}`;
    if (!compass.rooms[applied.host.id]) return 'unit missing';
    if (Object.keys(compass.rooms).filter(id => compass.rooms[id].kind === 'settlement').length !== 1) {
      return 'city should be reused';
    }
    const roomsNow = Object.values(compass.rooms).filter(r => r.kind === 'room' || r.kind === 'transitional');
    if (roomsNow.length) return 'chain must not create interior rooms';
    if (Object.keys(compass.rooms).length < before) return 'places dropped';
    const travel = { mode: 'compass', placeId: 'heights', placeKey: 'Fukuoka Heights' };
    if (!occupancyNeedsSuiteBuild(compass, travel)) return 'empty building+new unit should still need interiors';
    const need = occupancyNeedsSuiteBuild(compass, { mode: 'moving', placeId: 'heights' });
    if (need) return 'moving should skip';
    compass.rooms.main = {
      id: 'main', name: 'Main', kind: 'room', parentId: applied.host.id,
    };
    if (occupancyNeedsSuiteBuild(compass, { mode: 'compass', placeId: applied.host.id })) {
      return 'unit with a room should skip';
    }

    const empty = {
      rooms: {
        jp: { id: 'jp', name: 'Japan', kind: 'region' },
        fukuoka: { id: 'fukuoka', name: 'Fukuoka', kind: 'settlement', parentId: 'jp' },
        heights: { id: 'heights', name: 'Fukuoka Heights', kind: 'building', parentId: 'fukuoka' },
      },
    };
    const filed = applyGeoChain(empty, null, {
      chain: [
        { name: 'Japan', kind: 'region' },
        { name: 'Fukuoka', kind: 'settlement' },
        { name: 'Fukuoka Heights', kind: 'building' },
      ],
      unit: { name: '515-O' },
      typology: 'studio',
    }, empty.rooms.heights);
    const prog = expandProgram('studio');
    const built = commitSuiteInterior(empty, {
      hostId: filed.host.id,
      hostName: filed.host.name,
      typology: 'studio',
      description: 'A compact apartment.',
      rooms: prog.rooms,
      status: 'review',
    }, { adjRaw: '' });
    if (built.roomIds.length !== 4) return `commit rooms ${built.roomIds.length}`;
    if (listSuiteChildren(empty, filed.host.id).length !== 4) return 'children missing';
    if (empty.suiteDraft) return 'draft should clear';

    const shopCompass = {
      rooms: {
        mall: { id: 'mall', name: 'Canal City Mall', kind: 'building' },
        oki: { id: 'oki', name: 'Okisato Antiques', kind: 'unit', parentId: 'mall' },
      },
    };
    const oki = applyGeoChain(shopCompass, null, { chain: [], typology: 'studio' }, shopCompass.rooms.oki);
    if (oki.typology !== 'shop') return `antiques typology ${oki.typology}`;
    if (oki.host?.id !== 'oki') return 'antiques host should stay the shop unit';
    const shopProg = expandProgram(oki.typology);
    if (shopProg.use !== 'commercial' || shopProg.rooms.some(r => r.listing === 'lr')) {
      return 'antiques program should be commercial shop';
    }

    const clinicCompass = {
      rooms: {
        mall: { id: 'mall', name: 'Canal City Mall', kind: 'building' },
        clinic: { id: 'clinic', name: 'Sato Clinic', kind: 'unit', parentId: 'mall' },
      },
    };
    const sat = applyGeoChain(clinicCompass, null, { chain: [], typology: 'studio' }, clinicCompass.rooms.clinic);
    if (sat.typology !== 'clinic') return `clinic typology ${sat.typology}`;
    const clinicProg = expandProgram(sat.typology);
    if (clinicProg.use !== 'professional' || !clinicProg.rooms.some(r => r.listing === 'exam')) {
      return 'clinic program should be professional';
    }

    const whCompass = {
      rooms: {
        yard: { id: 'yard', name: 'Harbor Yard', kind: 'building' },
        wh: { id: 'wh', name: 'Harbor Warehouse', kind: 'unit', parentId: 'yard' },
      },
    };
    const wh = applyGeoChain(whCompass, null, { chain: [], typology: 'shop' }, whCompass.rooms.wh);
    if (wh.typology !== 'warehouse') return `warehouse typology ${wh.typology}`;
    const whProg = expandProgram(wh.typology);
    if (whProg.use !== 'industrial' || !whProg.rooms.some(r => r.listing === 'dock')) {
      return 'warehouse program should be industrial';
    }
    return '';
  } catch (err) {
    return err?.message || String(err);
  }
}
