// Canonical item slots: worn / carried / inside / trunk / room / lost.
// Inventory lists + cast kit + compass pieces stay as storage; locators are
// the mutation contract (`moveItem`) and the Star Cast view.

import { amountAllowed, clearAmount } from './invAmount.js';
import {
  foldKitName, formatCarryBrief, inferKitKind, isGarmentName, kitDescendantIds, kitRoots, parseInsidePath,
} from './kitNest.js';
import { kitOwnedItems, pickPrimaryOutfit, formatOutfitLook } from './wardrobeOutfits.js';

export const WHERE = Object.freeze(['worn', 'carried', 'inside', 'trunk', 'room', 'lost']);
export const STAR_OWNER = 'star';

export function emptyLocator() {
  return { where: 'carried', ownerId: STAR_OWNER, parentId: '', placeId: '', cell: '' };
}

export function normalizeLocator(raw = {}) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const where = WHERE.includes(src.where) ? src.where : 'carried';
  const ownerId = where === 'room' || where === 'lost' ? '' : String(src.ownerId || STAR_OWNER).trim() || STAR_OWNER;
  const parentId = (where === 'inside' || where === 'room') ? String(src.parentId || '').trim() : '';
  const placeId = (where === 'room' || where === 'inside') ? String(src.placeId || '').trim() : '';
  const cell = (where === 'room' || where === 'inside') ? String(src.cell || '').trim().toUpperCase() : '';
  const surface = (where === 'room' || where === 'inside') ? String(src.surface || '').trim() : '';
  return { where, ownerId, parentId, placeId, cell, surface };
}

export function starOwnerId(characters) {
  const star = (Array.isArray(characters) ? characters : []).find(c => c?.priority === 'star');
  return star?.id || STAR_OWNER;
}

export function isStarOwner(ownerId, characters) {
  const id = String(ownerId || '').trim();
  if (!id || id === STAR_OWNER || id === 'player' || id === 'you') return true;
  const star = (Array.isArray(characters) ? characters : []).find(c => c?.priority === 'star');
  return !!(star && star.id === id);
}

export function resolveOwnerId(world, raw) {
  const s = String(raw || '').trim();
  const chars = world?.characters || [];
  if (!s || s === STAR_OWNER || s === 'player' || s === 'you' || /^\{\{user\}\}$/i.test(s)) {
    return starOwnerId(chars);
  }
  const low = s.toLowerCase();
  const hit = chars.find(c => c?.id === s || String(c?.name || '').trim().toLowerCase() === low);
  return hit?.id || s;
}

export function deriveLocator(item, hint = {}) {
  if (item?.locator && typeof item.locator === 'object') {
    const loc = normalizeLocator(item.locator);
    if (item.parentId && loc.where !== 'inside' && loc.where !== 'worn' && loc.where !== 'lost' && loc.where !== 'room') {
      loc.where = 'inside';
      loc.parentId = String(item.parentId);
    }
    return loc;
  }
  if (hint.lost) return normalizeLocator({ where: 'lost' });
  if (hint.placeId) {
    return normalizeLocator({
      where: item?.parentId ? 'inside' : 'room',
      placeId: hint.placeId,
      cell: hint.cell || '',
      surface: item?.surface || '',
      parentId: item?.parentId || '',
    });
  }
  if (hint.bucket === 'wardrobe') {
    return normalizeLocator({ where: 'worn', ownerId: hint.ownerId });
  }
  if (hint.bucket === 'props') {
    if (item?.parentId) return normalizeLocator({ where: 'inside', ownerId: hint.ownerId, parentId: item.parentId });
    return normalizeLocator({ where: 'carried', ownerId: hint.ownerId });
  }
  if (hint.list === 'static') {
    if (item?.parentId) return normalizeLocator({ where: 'inside', ownerId: hint.ownerId || STAR_OWNER, parentId: item.parentId });
    return normalizeLocator({ where: 'trunk', ownerId: hint.ownerId || STAR_OWNER });
  }
  if (item?.equippedTo?.type === 'player' || item?.equippedTo?.type === 'star') {
    return normalizeLocator({ where: 'worn', ownerId: hint.ownerId || STAR_OWNER });
  }
  if (item?.equippedTo?.characterId) {
    return normalizeLocator({ where: 'worn', ownerId: item.equippedTo.characterId });
  }
  if (item?.parentId) {
    return normalizeLocator({ where: 'inside', ownerId: hint.ownerId || STAR_OWNER, parentId: item.parentId });
  }
  return normalizeLocator({ where: 'carried', ownerId: hint.ownerId || STAR_OWNER });
}

export function stampLocator(item, loc, { characters } = {}) {
  if (!item || typeof item !== 'object') return item;
  const next = normalizeLocator(loc);
  item.locator = next;
  item.parentId = next.parentId || null;
  if (next.where === 'worn' && isStarOwner(next.ownerId, characters)) {
    item.equippedTo = { type: 'player' };
    if (item.kind !== 'container') item.category = item.category || 'wearable';
    if (!amountAllowed(item) || item.category === 'wearable') clearAmount(item);
  } else if (next.where !== 'worn') {
    if (item.equippedTo?.type === 'player' || item.equippedTo?.type === 'star') item.equippedTo = null;
  }
  if (next.where === 'trunk' || next.where === 'carried' || next.where === 'inside' || next.where === 'worn') {
    item.location = next.where === 'trunk' && !next.parentId ? 'static' : 'mobile';
  }
  return item;
}

export function formatLocator(loc, { parentName = '', ownerName = '', placeName = '' } = {}) {
  const n = normalizeLocator(loc);
  if (n.where === 'worn') return ownerName ? `worn (${ownerName})` : 'worn';
  if (n.where === 'carried') return ownerName ? `carried (${ownerName})` : 'carried';
  if (n.where === 'inside') return parentName ? `inside ${parentName}` : 'inside';
  if (n.where === 'trunk') return 'trunk';
  if (n.where === 'room') {
    const place = placeName || n.placeId || '';
    const surface = n.surface ? `on ${n.surface}` : '';
    const bits = [place, surface, n.cell ? `@ ${n.cell}` : ''].filter(Boolean);
    return bits.join(' · ') || 'room';
  }
  if (n.where === 'lost') return 'lost';
  return n.where;
}

export function formatItemPlace(item, hint = {}, world = null) {
  const loc = deriveLocator(item, hint);
  let parentName = String(hint.parentName || '').trim();
  if (!parentName && loc.parentId && world) {
    parentName = findWorldItem(world, loc.parentId)?.item?.name || '';
  }
  return formatLocator(loc, { parentName, ownerName: hint.ownerName || '', placeName: hint.placeName || '' });
}

export function locatorKey(loc) {
  const n = normalizeLocator(loc);
  return `${n.where}|${n.ownerId}|${n.parentId}|${n.placeId}|${n.cell}|${n.surface || ''}`;
}

export function sameLocator(a, b) {
  return locatorKey(a) === locatorKey(b);
}

export function worldFromStorage(storage) {
  const inventory = storage.getChat('inventory', { static: [], mobile: [] });
  const cast = storage.getChat('cast', { characters: [] });
  let compass = {};
  try {
    const bst = storage.getChat('backstage', {});
    compass = bst.stage || {};
  } catch { /* ignore */ }
  return {
    inventory,
    characters: cast.characters || [],
    compass,
  };
}

export function findWorldItem(world, id) {
  const want = String(id || '').trim();
  if (!want) return null;
  const inv = world?.inventory || {};
  for (const loc of ['mobile', 'static']) {
    const list = inv[loc] || [];
    const i = list.findIndex(x => x?.id === want);
    if (i >= 0) {
      return {
        pool: 'inventory', loc, list, index: i, item: list[i],
        hint: { list: loc, ownerId: starOwnerId(world.characters) },
      };
    }
  }
  for (const char of world?.characters || []) {
    for (const bucket of ['wardrobe', 'props']) {
      const list = char[bucket] || [];
      const i = list.findIndex(x => x?.id === want);
      if (i >= 0) {
        return {
          pool: 'cast', char, bucket, list, index: i, item: list[i],
          hint: { bucket, ownerId: char.id },
        };
      }
    }
  }
  const lf = world?.compass?.lostAndFound;
  if (Array.isArray(lf)) {
    const i = lf.findIndex(x => x?.id === want);
    if (i >= 0) return { pool: 'lost', list: lf, index: i, item: lf[i], hint: { lost: true } };
  }
  for (const [placeId, room] of Object.entries(world?.compass?.rooms || {})) {
    const cells = room?.cells || {};
    for (const [cell, layers] of Object.entries(cells)) {
      if (!layers || typeof layers !== 'object') continue;
      for (const [layer, list] of Object.entries(layers)) {
        if (!Array.isArray(list)) continue;
        const i = list.findIndex(x => x?.id === want);
        if (i >= 0) {
          return {
            pool: 'room', placeId, cell, layer, list, index: i, item: list[i],
            hint: { placeId, cell },
          };
        }
      }
    }
  }
  return null;
}

function takeInventoryBatch(world, found) {
  const loc = found.loc;
  const list = world.inventory[loc] || [];
  const ids = new Set([found.item.id, ...kitDescendantIds(list, found.item.id)]);
  const batch = list.filter(x => ids.has(x.id));
  world.inventory[loc] = list.filter(x => !ids.has(x.id));
  return batch;
}

function takeListBatch(list, item) {
  const ids = new Set([item.id, ...kitDescendantIds(list, item.id)]);
  const batch = list.filter(x => ids.has(x.id));
  list.splice(0, list.length, ...list.filter(x => !ids.has(x.id)));
  return batch;
}

function uid(prefix = 'i') {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function allWorldItems(world) {
  const out = [];
  const inv = world?.inventory || {};
  for (const loc of ['mobile', 'static']) {
    for (const item of inv[loc] || []) {
      out.push({ item, hint: { list: loc, ownerId: starOwnerId(world.characters) }, pool: 'inventory' });
    }
  }
  for (const char of world?.characters || []) {
    for (const bucket of ['wardrobe', 'props']) {
      for (const item of char[bucket] || []) {
        out.push({ item, hint: { bucket, ownerId: char.id }, pool: 'cast', char });
      }
    }
  }
  for (const item of world?.compass?.lostAndFound || []) {
    out.push({ item, hint: { lost: true }, pool: 'lost' });
  }
  for (const [placeId, room] of Object.entries(world?.compass?.rooms || {})) {
    for (const [cell, layers] of Object.entries(room?.cells || {})) {
      if (!layers || typeof layers !== 'object') continue;
      for (const list of Object.values(layers)) {
        if (!Array.isArray(list)) continue;
        for (const item of list) {
          out.push({ item, hint: { placeId, cell }, pool: 'room' });
        }
      }
    }
  }
  return out;
}

export function findItemByName(world, name) {
  const key = foldKitName(name);
  if (!key) return null;
  const all = allWorldItems(world);
  return all.find(x => foldKitName(x.item?.name) === key)
    || all.find((x) => {
      const n = foldKitName(x.item?.name);
      return n && (n.includes(key) || key.includes(n));
    })
    || null;
}

const OWNED_WHERE = new Set(['worn', 'carried', 'inside', 'trunk']);

/** Exact name on this person: worn, carried, inside their containers, or the trunk. */
export function findOwnedItem(world, ownerId, name) {
  const key = foldKitName(name);
  if (!key || !world) return null;
  const owner = resolveOwnerId(world, ownerId);
  const hits = [];
  for (const row of allWorldItems(world)) {
    if (foldKitName(row.item?.name) !== key) continue;
    const loc = deriveLocator(row.item, row.hint);
    if (!OWNED_WHERE.has(loc.where)) continue;
    if (!sameOwner(loc.ownerId, owner, world.characters)) continue;
    hits.push({ ...row, loc });
  }
  return hits.find(h => h.loc.where === 'worn') || hits[0] || null;
}

/** Exact name in the active room, then lost-and-found. No other person's kit. */
export function findPlaceItem(world, name) {
  const key = foldKitName(name);
  if (!key || !world) return null;
  const activeId = String(world?.compass?.activeRoomId || '').trim();
  const hits = [];
  for (const row of allWorldItems(world)) {
    if (foldKitName(row.item?.name) !== key) continue;
    const loc = deriveLocator(row.item, row.hint);
    const inRoom = row.pool === 'room' || loc.where === 'room';
    const lost = row.pool === 'lost' || loc.where === 'lost';
    if (!inRoom && !lost) continue;
    if (inRoom && activeId) {
      const placeId = String(loc.placeId || row.hint?.placeId || row.placeId || '').trim();
      if (placeId !== activeId) continue;
    }
    hits.push({ ...row, loc });
  }
  const roomHit = hits.find(h => h.pool === 'room' || h.loc?.where === 'room');
  return roomHit || hits.find(h => h.pool === 'lost' || h.loc?.where === 'lost') || null;
}

export function mintItem(world, spec = {}) {
  const ownerId = resolveOwnerId(world, spec.ownerId || spec.owner);
  const name = String(spec.name || '').trim();
  const asBox = spec.kind === 'container' || inferKitKind({ name }) === 'container';
  const item = {
    id: spec.id || uid(),
    name,
    kind: asBox ? 'container' : 'item',
    category: spec.category || (isGarmentName(name) ? 'wearable' : 'misc'),
    condition: spec.condition || 'pristine',
    description: String(spec.description || '').trim(),
  };
  world.inventory ??= { mobile: [], static: [] };
  if (isStarOwner(ownerId, world.characters) || spec.where === 'room') {
    (world.inventory.mobile ??= []).push(item);
  } else {
    const char = findChar(world, ownerId);
    if (char) (char.props ??= []).push(item);
    else (world.inventory.mobile ??= []).push(item);
  }
  return item;
}

function sameOwner(a, b, characters) {
  const left = String(a || '').trim();
  const right = String(b || '').trim();
  if (left && right && left === right) return true;
  return isStarOwner(left, characters) && isStarOwner(right, characters);
}

function findWornBottoms(world, ownerId) {
  const oid = resolveOwnerId(world, ownerId);
  return allWorldItems(world).find((x) => {
    const loc = deriveLocator(x.item, x.hint);
    if (loc.where !== 'worn') return false;
    if (!sameOwner(loc.ownerId, oid, world.characters)) return false;
    return /\b(trousers|pants|jeans|shorts|skirt)\b/i.test(x.item?.name || '');
  })?.item || null;
}

/** Find or mint a container; nest under parentId when given. */
export function ensureContainer(world, { name, ownerId, parentId } = {}) {
  const key = foldKitName(name);
  if (!key) return null;
  if (parentId) {
    const hit = allWorldItems(world).find(x =>
      x.item?.parentId === parentId && foldKitName(x.item?.name) === key);
    if (hit) {
      hit.item.kind = 'container';
      return hit.item;
    }
  } else {
    const hit = findItemByName(world, name);
    if (hit) {
      hit.item.kind = 'container';
      return hit.item;
    }
  }
  const item = mintItem(world, { name, ownerId, kind: 'container' });
  if (parentId) {
    moveItem(world, item.id, { where: 'inside', parentId, ownerId }, { reason: 'nested container' });
  }
  return findWorldItem(world, item.id)?.item || item;
}

/** Resolve inside= "side pocket of the messenger bag" to a parent id, minting as needed. */
export function ensureInsidePath(world, insideRaw, ownerId) {
  const path = parseInsidePath(insideRaw);
  if (!path.length) return '';
  let parentId = '';
  if (path.length === 1 && /\bpocket/.test(path[0])) {
    const bottoms = findWornBottoms(world, ownerId);
    if (bottoms) parentId = bottoms.id;
  }
  for (const name of path) {
    const box = ensureContainer(world, { name, ownerId, parentId });
    if (!box) return parentId;
    parentId = box.id;
  }
  return parentId;
}

function findParent(world, parentId) {
  return findWorldItem(world, parentId);
}

function destListForStar(world, loc) {
  world.inventory ??= { mobile: [], static: [] };
  world.inventory.mobile ??= [];
  world.inventory.static ??= [];
  const key = loc.where === 'trunk' && !loc.parentId ? 'static' : 'mobile';
  return world.inventory[key];
}

function destListForCast(char, loc) {
  char.wardrobe ??= [];
  char.props ??= [];
  if (loc.where === 'worn') return char.wardrobe;
  return char.props;
}

function findChar(world, ownerId) {
  const id = String(ownerId || '');
  return (world.characters || []).find(c => c?.id === id) || null;
}

function resolveCompassRoomId(compass, rawPlaceId = '') {
  const rooms = compass?.rooms;
  if (!rooms || typeof rooms !== 'object') return '';
  const want = String(rawPlaceId || '').trim();
  if (want) {
    if (rooms[want]) return want;
    const low = want.toLowerCase();
    for (const r of Object.values(rooms)) {
      if (!r?.id) continue;
      if (String(r.id).toLowerCase() === low || String(r.name || '').trim().toLowerCase() === low) return r.id;
      if ((r.aliases || []).some(a => String(a || '').trim().toLowerCase() === low)) return r.id;
    }
  }
  const active = String(compass?.activeRoomId || '').trim();
  if (active && rooms[active]) return active;
  const last = String(compass?.sonar?.lastPlaceId || '').trim();
  if (last && rooms[last]?.cells) return last;
  return '';
}

/**
 * Move an item (and nested children) to `dest`. Returns a receipt-shaped change
 * `{ ok, name, from, to, reason, item }` or `{ ok: false, error }`.
 */
export function moveItem(world, id, dest, { reason = '' } = {}) {
  const found = findWorldItem(world, id);
  if (!found) return { ok: false, error: 'missing' };
  const from = deriveLocator(found.item, found.hint);
  let to = normalizeLocator(dest);
  to.ownerId = resolveOwnerId(world, to.ownerId || dest.owner || dest.ownerId);

  let roomParent = false;
  if (to.where === 'inside') {
    const parentId = String(to.parentId || dest.insideId || '').trim();
    const parentFound = parentId ? findParent(world, parentId) : null;
    const parent = parentFound?.item;
    if (!parent) return { ok: false, error: 'no-container' };
    parent.kind = 'container';
    const parentLoc = deriveLocator(parent, parentFound.hint);
    const parentPlaceId = parentLoc.placeId || parentFound.placeId || '';
    const parentCell = parentLoc.cell || parentFound.cell || '';
    roomParent = !!(parentFound.pool === 'room' || parentLoc.where === 'room' || parentPlaceId);
    to = normalizeLocator({
      where: 'inside',
      ownerId: roomParent ? '' : parentLoc.ownerId,
      parentId: parent.id,
      placeId: parentPlaceId,
      cell: parentCell,
      surface: dest.surface || parent.surface || parent.name || '',
    });
  }

  if (to.where === 'worn') {
    found.item.category = found.item.category || 'wearable';
    if (found.item.kind === 'container' && !isGarmentName(found.item.name) && found.item.category !== 'wearable') {
      to.where = 'carried';
    } else {
      clearAmount(found.item);
    }
  }

  const starMove = !roomParent
    && isStarOwner(to.ownerId, world.characters)
    && (to.where === 'worn' || to.where === 'carried' || to.where === 'inside' || to.where === 'trunk');
  const castChar = !roomParent && !starMove && (to.where === 'worn' || to.where === 'carried' || to.where === 'inside')
    ? findChar(world, to.ownerId)
    : null;

  let batch;
  if (found.pool === 'inventory') batch = takeInventoryBatch(world, found);
  else if (found.pool === 'cast') batch = takeListBatch(found.list, found.item);
  else batch = takeListBatch(found.list, found.item);

  if (to.where === 'lost') {
    world.compass ??= {};
    world.compass.lostAndFound ??= [];
    for (const x of batch) {
      stampLocator(x, { where: 'lost' }, { characters: world.characters });
      x.parentId = x.id === found.item.id ? null : x.parentId;
      world.compass.lostAndFound.push(x);
    }
  } else if (to.where === 'room' || (to.where === 'inside' && roomParent)) {
    const placeId = resolveCompassRoomId(world.compass, to.placeId || dest.place || dest.room);
    const cell = to.cell || 'C';
    const room = placeId ? world.compass?.rooms?.[placeId] : null;
    const surface = String(dest.surface || to.surface || '').trim();
    to.placeId = placeId || to.placeId;
    to.surface = surface;
    if (!room?.cells) {
      const list = destListForStar(world, { where: 'trunk' });
      for (const x of batch) {
        stampLocator(x, { where: to.where, placeId: to.placeId, cell: '', surface, ownerId: '', parentId: x.id === found.item.id ? to.parentId : x.parentId }, { characters: world.characters });
        if (x.id === found.item.id && to.where !== 'inside') x.parentId = null;
        if (surface) x.surface = surface;
        x.location = 'static';
        list.push(x);
      }
    } else {
      const layer = dest.layer && ['fixtures', 'furniture', 'clutter'].includes(String(dest.layer).toLowerCase())
        ? String(dest.layer).toLowerCase()
        : 'clutter';
      room.cells[cell] ??= {};
      room.cells[cell][layer] ??= [];
      for (const x of batch) {
        const rootParentId = x.id === found.item.id ? (to.where === 'inside' ? to.parentId : '') : x.parentId;
        stampLocator(x, {
          ...to,
          placeId,
          cell,
          surface,
          parentId: rootParentId,
        }, { characters: world.characters });
        if (surface) x.surface = surface;
        room.cells[cell][layer].push(x);
      }
    }
  } else if (starMove) {
    const list = destListForStar(world, to);
    for (const x of batch) {
      const child = x.id !== found.item.id;
      const loc = child
        ? normalizeLocator({ ...to, where: 'inside', parentId: x.parentId || found.item.id })
        : to;
      stampLocator(x, loc, { characters: world.characters });
      if (!child && to.where !== 'inside') x.parentId = null;
      list.push(x);
    }
  } else if (castChar) {
    const list = destListForCast(castChar, to);
    for (const x of batch) {
      const child = x.id !== found.item.id;
      const loc = child
        ? normalizeLocator({ where: 'inside', ownerId: castChar.id, parentId: x.parentId || found.item.id })
        : to;
      stampLocator(x, loc, { characters: world.characters });
      if (!child && to.where !== 'inside') x.parentId = null;
      x.equippedTo = null;
      list.push(x);
    }
  } else {
    const list = destListForStar(world, { where: 'carried', ownerId: STAR_OWNER });
    for (const x of batch) {
      stampLocator(x, { where: 'carried', ownerId: starOwnerId(world.characters) }, { characters: world.characters });
      list.push(x);
    }
  }

  return {
    ok: true,
    name: String(found.item.name || ''),
    from,
    to,
    reason: String(reason || '').trim(),
    item: found.item,
  };
}

export function stampInventoryLocators(inventory, { ownerId = STAR_OWNER } = {}) {
  const inv = inventory || {};
  for (const loc of ['mobile', 'static']) {
    for (const item of inv[loc] || []) {
      stampLocator(item, deriveLocator(item, { list: loc, ownerId }), { characters: [{ id: ownerId, priority: 'star' }] });
    }
  }
  return inv;
}

/** Star Cast view: worn vs carried/inside from inventory locators (no dual roster). */
export function starKitFromInventory(inventory, { ownerId = STAR_OWNER } = {}) {
  const wardrobe = [];
  const props = [];
  const mobile = inventory?.mobile || [];
  const stored = inventory?.static || [];
  const all = [...mobile, ...stored];
  const locOf = (item) => deriveLocator(item, {
    list: stored.includes(item) ? 'static' : 'mobile',
    ownerId,
  });
  const rootOf = (item) => {
    let cur = item;
    const seen = new Set();
    while (cur?.parentId && !seen.has(cur.id)) {
      seen.add(cur.id);
      const parent = all.find(x => x.id === cur.parentId);
      if (!parent) break;
      cur = parent;
    }
    return cur;
  };
  for (const item of all) {
    const root = rootOf(item);
    const rootLoc = locOf(root);
    if (rootLoc.where === 'trunk' || stored.includes(root)) continue;
    const loc = locOf(item);
    if (loc.where === 'worn') wardrobe.push(item);
    else props.push(item);
  }
  return { wardrobe, props };
}

const KIT_PEOPLE_CAP = 6;
const KIT_ROOT_CAP = 8;

function briefKit(list, { maxDepth = 1, maxRoots = KIT_ROOT_CAP } = {}) {
  const items = Array.isArray(list) ? list : [];
  const roots = kitRoots(items);
  const keep = new Set(roots.slice(0, Math.max(1, Number(maxRoots) || KIT_ROOT_CAP)).map(r => r.id).filter(Boolean));
  let grew = true;
  while (grew) {
    grew = false;
    for (const x of items) {
      if (x?.id && x.parentId && keep.has(x.parentId) && !keep.has(x.id)) {
        keep.add(x.id);
        grew = true;
      }
    }
  }
  const subset = keep.size ? items.filter(x => keep.has(x.id)) : items;
  return formatCarryBrief(subset, { maxDepth });
}

function herePlaceIds(world, lastLocationKey, travel) {
  const t = travel && typeof travel === 'object' ? travel : null;
  if (t && (t.mode === 'moving' || t.mode === 'unknown')) return new Set();
  const rooms = world?.compass?.rooms || {};
  const ids = new Set();
  const travelPlaceId = String(t?.placeId || '').trim();
  if (travelPlaceId && rooms[travelPlaceId]) {
    ids.add(travelPlaceId);
    return ids;
  }
  const key = String(t?.placeKey || lastLocationKey || '').trim().toLowerCase();
  if (key) {
    for (const r of Object.values(rooms)) {
      const name = String(r?.name || '').trim().toLowerCase();
      const id = String(r?.id || '').trim();
      if (name === key || id.toLowerCase() === key) ids.add(id);
    }
  }
  const activeId = String(world?.compass?.activeRoomId || '').trim();
  if (!ids.size && activeId && rooms[activeId]) ids.add(activeId);
  return ids;
}

function hereSurfaceLines(world, lastLocationKey, travel) {
  const t = travel && typeof travel === 'object' ? travel : null;
  if (t && (t.mode === 'moving' || t.mode === 'unknown')) return [];
  const hereIds = herePlaceIds(world, lastLocationKey, travel);
  const bySurface = new Map();
  const roomChildren = [];
  for (const row of allWorldItems(world)) {
    const loc = deriveLocator(row.item, row.hint);
    const placeId = String(loc.placeId || row.hint?.placeId || '').trim();
    if (hereIds.size && placeId && !hereIds.has(placeId)) continue;
    if (row.item?.parentId && (row.pool === 'room' || loc.where === 'room' || (loc.where === 'inside' && placeId))) {
      roomChildren.push(row.item);
      continue;
    }
    if (loc.where !== 'room') continue;
    const surface = String(loc.surface || row.item?.surface || '').trim() || 'in the room';
    if (!bySurface.has(surface)) bySurface.set(surface, []);
    bySurface.get(surface).push(row.item);
  }
  const lines = [];
  for (const [surface, roots] of bySurface) {
    const rootIds = new Set(roots.map(r => r?.id).filter(Boolean));
    const items = [...roots];
    for (const child of roomChildren) {
      if (child?.parentId && rootIds.has(child.parentId)) items.push(child);
    }
    const brief = briefKit(items, { maxDepth: 1, maxRoots: KIT_ROOT_CAP });
    if (!brief || brief === 'None') continue;
    lines.push(`Here: ${surface} · ${brief}`);
  }
  return lines;
}

function kitViewForInject(char, world) {
  if (char?.priority === 'star') {
    return starKitFromInventory(world.inventory, { ownerId: char.id });
  }
  return { wardrobe: char.wardrobe || [], props: char.props || [] };
}

/** Always-on slate: who currently wears/carries what (holder, not card owner). */
export function compactKitInject(world, {
  people = [], lastLocationKey = '', travel = null, wrap = true,
} = {}) {
  if (!world) return '';
  stampInventoryLocators(world.inventory, { ownerId: starOwnerId(world.characters) });
  const pool = (Array.isArray(people) ? people : []).filter((m) => {
    if (!m || m.priority === 'director') return false;
    const presence = String(m.presence || 'inPlay');
    if (m.priority === 'star') return presence !== 'absent';
    return presence !== 'absent' && presence !== 'writtenOut';
  }).slice(0, KIT_PEOPLE_CAP);

  const lines = [];
  for (const char of pool) {
    const name = String(char.name || '').trim();
    if (!name) continue;
    const kit = kitViewForInject(char, world);
    const wear = briefKit(kit.wardrobe, { maxDepth: 1 });
    const carry = briefKit(kit.props, { maxDepth: 1 });
    const bits = [];
    const look = formatOutfitLook(
      pickPrimaryOutfit(char.outfits, kit.wardrobe, kitOwnedItems(kit.wardrobe, kit.props)),
      { compact: true },
    );
    if (look) bits.push(`wearing ${look}`);
    else if (wear && wear !== 'None') bits.push(`wearing ${wear}`);
    if (carry && carry !== 'None') bits.push(`carrying ${carry}`);
    if (!bits.length) continue;
    lines.push(`${name}: ${bits.join('; ')}`);
  }

  lines.push(...hereSurfaceLines(world, lastLocationKey, travel));
  if (!lines.length) return '';
  const body = lines.join('\n');
  return wrap ? `[Kit]\n${body}` : body;
}

/** Standing occupancy + kit in one prompt block. Ledger / last-visit are extra lines. */
export function compactNowInject({ sceneLine = '', kitText = '', visitText = '', ledgerText = '' } = {}) {
  const loc = String(sceneLine || '').trim();
  const kitBody = String(kitText || '').replace(/^\[Kit\]\s*/i, '').trim();
  const visits = String(visitText || '').trim();
  const changed = String(ledgerText || '').trim();
  const lines = [];
  if (loc) lines.push(loc);
  if (kitBody) lines.push(kitBody);
  if (visits) lines.push(visits);
  if (changed) lines.push(changed);
  if (!lines.length) return '';
  return `[Now]\n${lines.join('\n')}`;
}

/** After a cast-row kit add/move, relocate an item this holder already has. */
export function stampCastKitLocators(world, char, changes) {
  if (!world || !char) return;
  const ownerId = resolveOwnerId(world, char.id || char.name);
  for (const ch of changes || []) {
    if (ch.action !== 'add' && ch.action !== 'move') continue;
    if (ch.kind !== 'wardrobe' && ch.kind !== 'props') continue;
    const found = findOwnedItem(world, ownerId, ch.name);
    if (!found?.item) continue;
    const loc = found.loc || deriveLocator(found.item, found.hint);
    const where = ch.kind === 'wardrobe' ? 'worn' : 'carried';
    if (loc.where === where && sameOwner(loc.ownerId, ownerId, world.characters)) continue;
    const moved = moveItem(world, found.item.id, { where, ownerId }, { reason: 'cast kit' });
    if (!moved.ok) continue;
    const list = ch.kind === 'wardrobe' ? (char.wardrobe || []) : (char.props || []);
    const key = foldKitName(ch.name);
    const keepId = moved.item?.id;
    for (let i = list.length - 1; i >= 0; i--) {
      if (foldKitName(list[i]?.name) !== key) continue;
      if (list[i].id === keepId) continue;
      list.splice(i, 1);
    }
  }
}

export function smokeItemLocatorPure() {
  try {
    const bag = { id: 'bag', name: 'satchel', kind: 'container' };
    const keys = { id: 'keys', name: 'keys', category: 'misc' };
    const coat = { id: 'coat', name: 'coat', category: 'wearable', amount: { remaining: 2, capacity: 2, unit: 'pieces' }, fill: 'full' };
    const lamp = { id: 'lamp', name: 'lamp', category: 'misc' };
    const world = {
      inventory: { mobile: [bag, keys, coat], static: [] },
      characters: [{ id: 'cst_star', priority: 'star', name: 'Weslie', wardrobe: [], props: [] }],
      compass: {
        lostAndFound: [],
        rooms: { r1: { id: 'r1', name: 'Kitchen', cells: { C: { clutter: [lamp] } } } },
      },
    };
    stampInventoryLocators(world.inventory, { ownerId: 'cst_star' });

    const wear = moveItem(world, 'coat', { where: 'worn', ownerId: 'star' }, { reason: 'put on' });
    if (!wear.ok || wear.to.where !== 'worn') return 'coat should wear';
    if (coat.amount || coat.fill) return 'wearable should reject amount';

    const nest = moveItem(world, 'keys', { where: 'inside', parentId: 'bag' }, { reason: 'pocketed' });
    if (!nest.ok || nest.to.where !== 'inside' || keys.parentId !== 'bag') return 'keys should nest in bag';

    const trunk = moveItem(world, 'bag', { where: 'trunk', ownerId: 'star' }, { reason: 'left behind' });
    if (!trunk.ok || trunk.to.where !== 'trunk') return 'bag should go to trunk';
    const keysNow = findWorldItem(world, 'keys');
    if (!keysNow || keysNow.loc !== 'static') return 'bag trunk move should take children';
    if (deriveLocator(keysNow.item, keysNow.hint).where !== 'inside') return 'nested keys stay inside';

    const pick = moveItem(world, 'lamp', { where: 'carried', ownerId: 'star' }, { reason: 'picked up' });
    if (!pick.ok || pick.to.where !== 'carried') return 'room lamp should become carried';
    if (findWorldItem(world, 'lamp')?.pool !== 'inventory') return 'picked lamp lives in inventory';

    const view = starKitFromInventory(world.inventory, { ownerId: 'cst_star' });
    if (!view.wardrobe.some(x => x.id === 'coat')) return 'star kit wardrobe reads locators';
    if (view.wardrobe.some(x => x.id === 'bag')) return 'trunk bag is not wardrobe';
    if (view.props.some(x => x.id === 'keys' || x.id === 'bag')) return 'trunk nested kit should not be on-person props';

    const pack = {
      inventory: { mobile: [], static: [] },
      characters: [
        { id: 'cst_star', priority: 'star', name: 'Weslie', wardrobe: [], props: [] },
        { id: 'hawks', priority: 'lead', name: 'Hawks', wardrobe: [{ id: 'pants', name: 'trousers', kind: 'item', category: 'wearable' }], props: [] },
      ],
      compass: { lostAndFound: [], rooms: {} },
    };
    const msgBag = mintItem(pack, { name: 'messenger bag', ownerId: 'cst_star', kind: 'container' });
    const sketch = mintItem(pack, { name: 'sketchbook', ownerId: 'cst_star' });
    mintItem(pack, { name: 'red feather', ownerId: 'cst_star' });
    moveItem(pack, findItemByName(pack, 'red feather').item.id, {
      where: 'inside', parentId: sketch.id,
    }, { reason: 'already inside the sketchbook' });
    for (const n of ['shirts', 'trousers', 'socks', 'laptop', 'charger', 'headphones', 'pill bottles']) {
      mintItem(pack, { name: n, ownerId: 'cst_star', category: isGarmentName(n) ? 'wearable' : 'misc' });
      moveItem(pack, findItemByName(pack, n).item.id, {
        where: 'room', surface: 'counter',
      }, { reason: 'spilled from the sack' });
    }
    mintItem(pack, { name: 'shampoo', ownerId: 'cst_star' });
    moveItem(pack, findItemByName(pack, 'shampoo').item.id, {
      where: 'room', surface: 'bathroom tile',
    }, { reason: 'too bulky to pack' });
    for (const n of ['shirts', 'trousers', 'socks', 'laptop', 'charger', 'headphones', 'sketchbook']) {
      const id = findItemByName(pack, n).item.id;
      moveItem(pack, id, { where: 'inside', parentId: msgBag.id }, { reason: 'stuffed into her messenger bag' });
    }
    const pocketId = ensureInsidePath(pack, 'side pocket of the messenger bag', 'cst_star');
    moveItem(pack, findItemByName(pack, 'pill bottles').item.id, {
      where: 'inside', parentId: pocketId,
    }, { reason: 'side pocket' });
    mintItem(pack, { name: 'envelope', ownerId: 'hawks' });
    const backId = ensureInsidePath(pack, 'back pocket', 'hawks');
    moveItem(pack, findItemByName(pack, 'envelope').item.id, {
      where: 'inside', parentId: backId, ownerId: 'hawks',
    }, { reason: 'folded into his back pocket' });

    const shirts = findItemByName(pack, 'shirts').item;
    if (shirts.parentId !== msgBag.id) return 'shirts should be inside messenger bag, not worn';
    if (deriveLocator(shirts, {}).where === 'worn') return 'stuffed clothes are not wardrobe';
    const pills = findItemByName(pack, 'pill bottles').item;
    const side = findWorldItem(pack, pills.parentId)?.item;
    if (foldKitName(side?.name) !== 'side pocket' || side?.parentId !== msgBag.id) {
      return 'pills should nest in bag side pocket';
    }
    const shampoo = findItemByName(pack, 'shampoo').item;
    if (deriveLocator(shampoo, { list: 'static' }).surface !== 'bathroom tile') {
      return 'shampoo should stay on the bathroom tile';
    }
    if (shampoo.parentId) return 'left-behind shampoo should not be in the bag';
    const env = findItemByName(pack, 'envelope').item;
    const back = findWorldItem(pack, env.parentId)?.item;
    if (foldKitName(back?.name) !== 'back pocket') return 'envelope should be in back pocket';
    const feather = findItemByName(pack, 'red feather').item;
    if (feather.parentId !== sketch.id) return 'feather stays inside sketchbook when packed';
    const brief = formatCarryBrief(pack.inventory.mobile);
    if (!/messenger bag/.test(brief) || !/pill bottles/.test(brief) || !/red feather/.test(brief)) {
      return 'carry brief should nest bag, pocket, and feather';
    }
    if (/shampoo/.test(brief)) return 'left-behind shampoo should not be in the carry brief';
    const packedKit = starKitFromInventory(pack.inventory, { ownerId: 'cst_star' });
    if (packedKit.wardrobe.some(x => /shirts|trousers|socks/i.test(x.name))) {
      return 'stuffed clothes must not read as star wardrobe';
    }
    if (!packedKit.props.some(x => /messenger bag/i.test(x.name))) return 'packed bag should stay carried';

    const kitWorld = {
      inventory: {
        mobile: [{
          id: 'ns', name: 'nightshirt', category: 'wearable',
          locator: { where: 'worn', ownerId: 'wes' },
        }],
        static: [],
      },
      characters: [
        { id: 'wes', priority: 'star', name: 'Weslie', presence: 'inPlay', wardrobe: [], props: [] },
        {
          id: 'hawks', priority: 'lead', name: 'Hawks', presence: 'inPlay',
          wardrobe: [{ id: 'cap', name: 'cap' }],
          props: [
            { id: 'bag', name: 'messenger bag', kind: 'container' },
            { id: 'sk', name: 'sketchbook', parentId: 'bag' },
            { id: 'lp', name: 'laptop', parentId: 'bag' },
            { id: 'fe', name: 'primary feather', parentId: 'bag' },
          ],
        },
      ],
      compass: {
        activeRoomId: 'apt',
        rooms: {
          apt: {
            id: 'apt',
            name: "Hawks' apartment",
            cells: {
              C: {
                clutter: [
                  { id: 'sp', name: 'bronze sparrow', locator: { where: 'room', placeId: 'apt', surface: 'kitchen island' } },
                  { id: 'en', name: 'envelope', locator: { where: 'room', placeId: 'apt', surface: 'kitchen island' } },
                ],
              },
            },
          },
        },
      },
    };
    const kitText = compactKitInject(kitWorld, {
      people: kitWorld.characters,
      lastLocationKey: "Hawks' apartment",
    });
    if (!/\[Kit\]/.test(kitText)) return 'kit inject should wrap [Kit]';
    if (!/Hawks:/.test(kitText) || !/messenger bag/.test(kitText) || !/sketchbook/.test(kitText)) {
      return 'kit inject should list Hawks carrying the nested bag';
    }
    if (!/Weslie:/.test(kitText) || !/nightshirt/.test(kitText)) return 'kit inject should list Weslie wearing the nightshirt';
    if (/Weslie:.*messenger bag/.test(kitText)) return 'kit inject should name holder not card owner';
    if (!/kitchen island/.test(kitText) || !/bronze sparrow/.test(kitText)) {
      return 'kit inject should list island surface items';
    }
    if (compactKitInject({ inventory: { mobile: [], static: [] }, characters: [], compass: { rooms: {} } }, { people: [] }) !== '') {
      return 'empty kit inject should skip';
    }
    if (compactKitInject(null) !== '') return 'missing world should skip';

    const movingHere = compactKitInject(kitWorld, {
      people: kitWorld.characters,
      lastLocationKey: "Hawks' apartment",
      travel: { mode: 'moving', fromKey: 'Kanzaki', destKey: 'train' },
    });
    if (/kitchen island/.test(movingHere) || /bronze sparrow/.test(movingHere)) {
      return 'kit Here should omit surfaces while moving';
    }
    const arrivedHere = compactKitInject(kitWorld, {
      people: kitWorld.characters,
      lastLocationKey: "Hawks' apartment",
      travel: { mode: 'compass', placeKey: "Hawks' apartment", placeId: 'apt' },
    });
    if (!/kitchen island/.test(arrivedHere) || !/bronze sparrow/.test(arrivedHere)) {
      return 'kit Here should list surfaces after compass occupancy';
    }

    const handoff = {
      inventory: {
        mobile: [{
          id: 'bag', name: 'messenger bag', kind: 'container',
          locator: { where: 'carried', ownerId: 'wes' },
        }],
        static: [],
      },
      characters: [
        { id: 'wes', priority: 'star', name: 'Weslie', presence: 'inPlay', wardrobe: [], props: [] },
        { id: 'hawks', priority: 'lead', name: 'Hawks', presence: 'inPlay', wardrobe: [], props: [] },
      ],
      compass: { lostAndFound: [], rooms: {} },
    };
    stampInventoryLocators(handoff.inventory, { ownerId: 'wes' });
    handoff.characters[1].props.push({ id: 'bag2', name: 'messenger bag', kind: 'container' });
    stampCastKitLocators(handoff, handoff.characters[1], [
      { kind: 'props', action: 'add', name: 'messenger bag' },
    ]);
    const after = compactKitInject(handoff, { people: handoff.characters });
    if (!/Hawks:.*messenger bag/.test(after)) return 'cast-row add should keep Hawks holding his bag';
    if (!/Weslie:.*messenger bag/.test(after)) return 'cast-row add should leave Weslie holding the bag';
    const ownedCoat = findOwnedItem(world, 'cst_star', 'coat');
    if (ownedCoat?.item?.id !== 'coat') return 'owned lookup should find the star coat';
    if (findOwnedItem(world, 'cst_star', 'coa')) return 'a shorter name is not the same object';
    world.compass.rooms.r1.cells.C.clutter.push({ id: 'dish', name: 'dish' });
    if (findOwnedItem(world, 'cst_star', 'dish')) return 'a room dish is not owned';
    world.compass.activeRoomId = 'r1';
    if (findPlaceItem(world, 'dish')?.item?.id !== 'dish') return 'active room should find the dish';
    world.compass.activeRoomId = 'elsewhere';
    if (findPlaceItem(world, 'dish')) return 'another room should not yield the dish';

    const nowText = compactNowInject({
      sceneLine: "Hawks' apartment · afternoon",
      kitText: compactKitInject(kitWorld, { people: kitWorld.characters, wrap: false }),
    });
    if (!/^\[Now\]/.test(nowText) || !/Hawks' apartment/.test(nowText)) return 'now inject should wrap occupancy';
    if (!/Hawks:/.test(nowText) || /\[Kit\]/.test(nowText)) return 'now inject should include kit body without [Kit]';
    const withDelta = compactNowInject({
      sceneLine: "Hawks' apartment",
      ledgerText: 'Changed: Hook resolved: The lease',
      visitText: 'Weslie last here 3 days ago (S12 · Tea at Okisato)',
    });
    if (!/Changed: Hook resolved/.test(withDelta) || !/Weslie last here/.test(withDelta)) {
      return 'now inject should keep occupancy plus visit and Changed lines';
    }
    if (compactNowInject({}) !== '') return 'empty now inject should skip';

    return '';
  } catch (err) {
    return String(err?.message || err);
  }
}
