// Production Reels — portable Showtime bundles (modules + optional portraits,
// character-card PNGs, assignment links, lorebooks).

import { getContext } from '../../../../extensions.js';
import { getRequestHeaders } from '../../../../../script.js';
import {
  loadWorldInfo,
  saveWorldInfo,
  selected_world_info,
  world_names,
  METADATA_KEY,
} from '../../../../world-info.js';
import { getCastMembers } from './castCatalog.js';
import { sanitizeMediaUrl, sanitizeReelExtras } from './reelSanitize.js';
export { sanitizeReelPayload, sanitizeReelExtras, smokeReelSanitizePure } from './reelSanitize.js';

export const REEL_KIND = 'showtime-reel';

function dataUrlFromBlob(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = () => reject(r.error || new Error('read failed'));
    r.readAsDataURL(blob);
  });
}

async function fetchAsDataUrl(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`fetch ${res.status}`);
  const blob = await res.blob();
  return dataUrlFromBlob(blob);
}

function fileFromDataUrl(dataUrl, filename) {
  const safe = sanitizeMediaUrl(dataUrl, { pngOnly: true });
  if (!safe) return null;
  const m = String(safe).match(/^data:([^;]+);base64,(.+)$/);
  if (!m) return null;
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], filename, { type: m[1] || 'image/png' });
}

/** Lorebooks currently bound to this chat / character / persona / global WI. */
export function listPlayLorebooks(storage) {
  const ctx = getContext();
  const names = new Set();
  const add = (n) => { const s = String(n || '').trim(); if (s) names.add(s); };
  for (const n of selected_world_info ?? []) add(n);
  add(ctx.chatMetadata?.[METADATA_KEY]);
  const chid = ctx.characterId ?? ctx.this_chid;
  const char = chid != null ? (ctx.characters ?? [])[chid] : null;
  add(char?.data?.extensions?.world);
  try {
    const lib = storage.getChat('library', {});
    for (const n of lib.adopted || []) add(n);
    for (const n of Object.keys(lib.bookFiling || {})) add(n);
  } catch { /* ignore */ }
  return [...names];
}

export async function collectReelExtras(storage, {
  portraits = false,
  characterCards = false,
  relink = false,
  lorebooks = false,
  allLorebooks = false,
  leaveStar = false,
} = {}) {
  const extras = { portraits: {}, cards: {}, links: {}, lorebooks: {} };
  const cast = getCastMembers(storage);

  if (portraits || characterCards || relink) {
    for (const member of cast) {
      if (leaveStar && member.priority === 'star') continue;
      extras.links[member.id] = {
        name: member.name,
        characterCardId: member.characterCardId || '',
        personaId: member.personaId || '',
      };
      if (portraits && member.portrait) {
        try {
          extras.portraits[member.id] = {
            name: member.name,
            dataUrl: member.portrait.startsWith('data:')
              ? member.portrait
              : await fetchAsDataUrl(member.portrait),
          };
        } catch (err) {
          console.warn('[Showtime/Reel] portrait skip', member.name, err);
        }
      }
      if (characterCards && member.characterCardId) {
        try {
          const response = await fetch('/api/characters/export', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ format: 'png', avatar_url: member.characterCardId }),
          });
          if (response.ok) {
            const blob = await response.blob();
            extras.cards[member.id] = {
              name: member.name,
              filename: String(member.characterCardId).replace(/\.png$/i, '') + '.png',
              dataUrl: await dataUrlFromBlob(blob),
            };
          }
        } catch (err) {
          console.warn('[Showtime/Reel] card export skip', member.name, err);
        }
      }
    }
  }

  if (lorebooks || allLorebooks) {
    const names = allLorebooks
      ? [...new Set([...(world_names || []), ...listPlayLorebooks(storage)])]
      : listPlayLorebooks(storage);
    for (const name of names) {
      try {
        const data = await loadWorldInfo(name);
        if (data) extras.lorebooks[name] = structuredClone(data);
      } catch (err) {
        console.warn('[Showtime/Reel] lorebook skip', name, err);
      }
    }
  }

  const empty = !Object.keys(extras.portraits).length
    && !Object.keys(extras.cards).length
    && !Object.keys(extras.links).length
    && !Object.keys(extras.lorebooks).length;
  return empty ? null : extras;
}

export function clipReelTitle(title) {
  return String(title || '').trim().slice(0, 80);
}

export function reelSlug(title) {
  return clipReelTitle(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

/** Named reels use the title slug. An empty title keeps the generic reel name. */
export function reelFilename(title, stamp, { backstage = false } = {}) {
  const when = String(stamp || '').trim() || 'reel';
  const slug = reelSlug(title);
  if (!slug) {
    return backstage ? `showtime-reel-backstage-${when}.json` : `showtime-reel-${when}.json`;
  }
  return `showtime-reel-${slug}-${when}.json`;
}

function utf8ToBase64(text) {
  const bytes = new TextEncoder().encode(String(text || ''));
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

/** Write a reel into the user files folder. Returns { name, path }. */
export async function saveReelToUserFiles(filename, payload) {
  const name = String(filename || '').replace(/[^a-zA-Z0-9_.-]/g, '');
  if (!/^showtime-reel-[\w.-]+\.json$/i.test(name)) throw new Error('bad reel name');
  const res = await fetch('/api/files/upload', {
    method: 'POST',
    headers: getRequestHeaders(),
    body: JSON.stringify({ name, data: utf8ToBase64(JSON.stringify(payload, null, 2)) }),
  });
  if (!res.ok) throw new Error((await res.text()) || `upload ${res.status}`);
  const body = await res.json();
  return { name, path: String(body?.path || '') };
}

export async function deleteReelUserFile(filePath) {
  const path = String(filePath || '').trim();
  if (!path) return;
  const res = await fetch('/api/files/delete', {
    method: 'POST',
    headers: getRequestHeaders(),
    body: JSON.stringify({ path }),
  });
  if (!res.ok && res.status !== 404) throw new Error((await res.text()) || `delete ${res.status}`);
}

export function listReelCatalog(settings) {
  const list = settings?.showtime?.reels;
  if (!Array.isArray(list)) return [];
  return list.filter(row => row && row.file);
}

export function rememberReel(settings, row) {
  if (!settings || !row?.file) return [];
  if (!settings.showtime || typeof settings.showtime !== 'object') settings.showtime = {};
  const next = [row, ...listReelCatalog(settings).filter(r => r.file !== row.file)];
  settings.showtime.reels = next.slice(0, 200);
  return settings.showtime.reels;
}

export function forgetReel(settings, file) {
  if (!settings?.showtime) return [];
  settings.showtime.reels = listReelCatalog(settings).filter(r => r.file !== file);
  return settings.showtime.reels;
}

export function reelHash(payload) {
  const s = JSON.stringify(payload ?? null);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  return (h >>> 0).toString(16);
}

function personKeys(name) {
  const norm = String(name || '').trim().toLowerCase().replace(/^["']+|["']+$/g, '');
  if (!norm) return [];
  const head = norm.split(',')[0].trim();
  return head && head !== norm ? [norm, head] : [norm];
}

/**
 * Houses (affiliations) plus the cast ids that belong to them.
 * A cast-only slice still needs this — membership lives on the house, not the card.
 */
export function packReelAffiliations(chat) {
  const rep = chat?.reputation || {};
  const cast = Array.isArray(chat?.cast?.characters) ? chat.cast.characters : [];
  const houses = Array.isArray(rep.house) ? rep.house.filter(h => h && h.id) : [];
  const linked = cast.some(c => String(c?.affiliationHouseId || '').trim());
  if (!houses.length && !linked) return null;
  return structuredClone({
    houses,
    groups: (Array.isArray(rep.personal) ? rep.personal : [])
      .filter(n => n?.category === 'group' && n.houseId),
    cast: cast.map(c => ({
      id: c.id,
      name: c.name || '',
      affiliationHouseId: String(c.affiliationHouseId || '').trim(),
    })),
  });
}

/** Fill a blank cast affiliation from house membership. Mutates the reel copy only. */
export function stampCastAffiliations(chat, packed = null) {
  const houses = packed?.houses || chat?.reputation?.house || [];
  const chars = chat?.cast?.characters;
  if (!Array.isArray(chars) || !houses.length) return chat;
  const byChar = new Map();
  const remember = (charId, houseId) => {
    const cid = String(charId || '').trim();
    const hid = String(houseId || '').trim();
    if (cid && hid && !byChar.has(cid)) byChar.set(cid, hid);
  };
  for (const h of houses) {
    remember(h.headId, h.id);
    for (const c of h.connections || []) remember(c?.characterId, h.id);
  }
  for (const link of packed?.cast || []) remember(link?.id, link?.affiliationHouseId);
  for (const c of chars) {
    if (!c || c.affiliationHouseId) continue;
    const houseId = byChar.get(c.id);
    if (houseId) c.affiliationHouseId = houseId;
  }
  return chat;
}

function destCharByIncoming(destCast, incomingCast) {
  const byId = new Map();
  const byName = new Map();
  for (const c of destCast) {
    if (c?.id) byId.set(c.id, c);
    for (const key of personKeys(c?.name)) {
      if (!byName.has(key)) byName.set(key, []);
      byName.get(key).push(c);
    }
  }
  const map = new Map();
  for (const c of incomingCast) {
    if (!c?.id) continue;
    if (byId.has(c.id)) {
      map.set(c.id, byId.get(c.id));
      continue;
    }
    let hit = null;
    for (const key of personKeys(c.name)) {
      const found = byName.get(key) || [];
      if (found.length === 1) { hit = found[0]; break; }
    }
    if (hit) map.set(c.id, hit);
  }
  return map;
}

/**
 * Union affiliation houses into the destination chat and retie members by name.
 * Does not replace the rest of the personal web.
 */
export function applyReelAffiliations(dest, source) {
  if (!dest || typeof dest !== 'object') return dest;
  const packed = source?.affiliations || packReelAffiliations(source?.chat || source);
  if (!packed?.houses?.length && !(packed?.cast || []).some(c => c.affiliationHouseId)) return dest;

  dest.reputation ??= { house: [], personal: [], tab: 'personal' };
  dest.reputation.house ??= [];
  dest.reputation.personal ??= [];
  dest.cast ??= { characters: [] };
  dest.cast.characters ??= [];

  const incomingCast = packed.cast || [];
  const localOf = destCharByIncoming(dest.cast.characters, incomingCast);
  const mapChar = (id) => {
    const key = String(id || '').trim();
    if (!key) return '';
    return localOf.get(key)?.id || key;
  };

  const houseIdMap = new Map();
  for (const incoming of packed.houses || []) {
    const name = String(incoming.name || '').trim().toLowerCase();
    let destH = dest.reputation.house.find(h => h?.id === incoming.id)
      || (name ? dest.reputation.house.find(h => String(h?.name || '').trim().toLowerCase() === name) : null);
    if (!destH) {
      destH = structuredClone(incoming);
      destH.connections = [];
      destH.headId = '';
      dest.reputation.house.push(destH);
    } else {
      for (const key of ['alias', 'description', 'authority', 'duty', 'notes', 'badge', 'opinion']) {
        if (!String(destH[key] || '').trim() && String(incoming[key] || '').trim()) destH[key] = incoming[key];
      }
    }
    houseIdMap.set(incoming.id, destH.id);
    if (destH.headId) destH.headId = mapChar(destH.headId);
    if (!destH.headId && incoming.headId) destH.headId = mapChar(incoming.headId);
    const seen = new Set();
    const connections = [];
    const take = (characterId, role) => {
      const cid = mapChar(characterId);
      if (!cid || seen.has(cid)) return;
      seen.add(cid);
      connections.push({ characterId: cid, role: role || '' });
    };
    for (const c of destH.connections || []) take(c?.characterId, c?.role || c?.affiliation || '');
    for (const c of incoming.connections || []) take(c?.characterId, c?.role || c?.affiliation || '');
    destH.connections = connections;
  }

  const houseOfChar = new Map();
  for (const link of incomingCast) {
    if (link.affiliationHouseId) houseOfChar.set(link.id, link.affiliationHouseId);
  }
  for (const h of packed.houses || []) {
    if (h.headId && !houseOfChar.has(h.headId)) houseOfChar.set(h.headId, h.id);
    for (const c of h.connections || []) {
      if (c?.characterId && !houseOfChar.has(c.characterId)) houseOfChar.set(c.characterId, h.id);
    }
  }
  for (const link of incomingCast) {
    const local = localOf.get(link.id);
    if (!local || local.affiliationHouseId) continue;
    const hid = houseIdMap.get(houseOfChar.get(link.id)) || houseOfChar.get(link.id) || '';
    if (hid) local.affiliationHouseId = hid;
  }

  for (const node of packed.groups || []) {
    const hid = houseIdMap.get(node.houseId) || node.houseId;
    const exists = dest.reputation.personal.some(n =>
      n?.category === 'group' && (n.houseId === hid || n.id === node.id));
    if (exists) continue;
    const copy = structuredClone(node);
    copy.houseId = hid;
    dest.reputation.personal.push(copy);
  }
  for (const node of dest.reputation.personal) {
    if (!node || node.kind === 'self' || !node.characterId) continue;
    const next = mapChar(node.characterId);
    if (next && next !== node.characterId) node.characterId = next;
  }
  foldPersonNodes(dest.reputation, dest.cast.characters);
  return dest;
}

function isWebPerson(n) {
  return !!(n && n.kind !== 'self' && n.category !== 'group' && n.category !== 'rumor');
}

function personNameKeys(n, castById) {
  const keys = new Set(personKeys(n?.name));
  const member = n?.characterId ? castById.get(n.characterId) : null;
  for (const key of personKeys(member?.name)) keys.add(key);
  return keys;
}

function sameWebPerson(a, b, castById) {
  if (!isWebPerson(a) || !isWebPerson(b)) return false;
  if (a.characterId && a.characterId === b.characterId) return true;
  const ak = personNameKeys(a, castById);
  const bk = personNameKeys(b, castById);
  for (const key of ak) if (bk.has(key)) return true;
  return false;
}

function personKeepScore(n, rep, castById) {
  let score = 0;
  if (n.characterId && castById.has(n.characterId)) score += 10;
  if (!n.auto) score += 5;
  if (n.id === rep.focusId || n.id === rep.inspectedId) score += 3;
  score += (n.readings?.length || 0) * 3;
  score += (n.links?.length || 0);
  if (String(n.description || '').trim()) score += 1;
  if (String(n.notes || '').trim()) score += 1;
  return score;
}

function absorbPerson(keeper, dropped) {
  for (const key of ['description', 'notes', 'name']) {
    if (!String(keeper[key] || '').trim() && String(dropped[key] || '').trim()) keeper[key] = dropped[key];
  }
  keeper.links = [...new Set([...(keeper.links || []), ...(dropped.links || [])])];
  keeper.supporters = [...new Set([...(keeper.supporters || []), ...(dropped.supporters || [])])];
  keeper.readings ??= [];
  for (const reading of dropped.readings || []) {
    if (!reading?.targetId) continue;
    const have = keeper.readings.find(r => r.targetId === reading.targetId);
    if (!have) keeper.readings.push({ ...reading });
    else if (!String(have.take || '').trim() && String(reading.take || '').trim()) have.take = reading.take;
  }
}

/**
 * One bubble per person. A reel merge used to leave the cast card and the
 * reel row as two Hawks stacked on the web.
 * @returns {boolean} true when a node was folded away
 */
export function foldPersonNodes(rep, castCharacters = []) {
  const personal = rep?.personal;
  if (!Array.isArray(personal) || personal.length < 2) return false;
  const castById = new Map((castCharacters || []).filter(c => c?.id).map(c => [c.id, c]));
  const people = personal.filter(isWebPerson);
  if (people.length < 2) return false;
  const parent = people.map((_, i) => i);
  const find = (i) => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  for (let i = 0; i < people.length; i++) {
    for (let j = i + 1; j < people.length; j++) {
      if (sameWebPerson(people[i], people[j], castById)) parent[find(i)] = find(j);
    }
  }
  const groups = new Map();
  people.forEach((n, i) => {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(n);
  });
  const dropNode = new Map();
  const dropChar = new Map();
  let changed = false;
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const keeper = group.slice().sort((a, b) => personKeepScore(b, rep, castById) - personKeepScore(a, rep, castById))[0];
    for (const dropped of group) {
      if (dropped === keeper) continue;
      absorbPerson(keeper, dropped);
      if (!keeper.characterId || !castById.has(keeper.characterId)) {
        if (dropped.characterId && castById.has(dropped.characterId)) keeper.characterId = dropped.characterId;
      }
      if (dropped.characterId && keeper.characterId && dropped.characterId !== keeper.characterId) {
        dropChar.set(dropped.characterId, keeper.characterId);
      }
      dropNode.set(dropped.id, keeper.id);
      changed = true;
    }
  }
  if (!changed) return false;
  const follow = (id) => {
    let next = id;
    const seen = new Set();
    while (dropNode.has(next) && !seen.has(next)) {
      seen.add(next);
      next = dropNode.get(next);
    }
    return next;
  };
  rep.personal = personal.filter(n => n && !dropNode.has(n.id));
  for (const n of rep.personal) {
    if (Array.isArray(n.links)) {
      n.links = [...new Set(n.links.map(follow))].filter(id => id && id !== n.id);
    }
    if (Array.isArray(n.supporters)) {
      n.supporters = [...new Set(n.supporters.map(follow))].filter(id => id && id !== n.id);
    }
    if (Array.isArray(n.readings)) {
      const byTarget = new Map();
      for (const reading of n.readings) {
        if (!reading) continue;
        const targetId = follow(reading.targetId);
        if (!targetId || targetId === n.id) continue;
        const prev = byTarget.get(targetId);
        if (!prev) byTarget.set(targetId, { ...reading, targetId });
        else if (!String(prev.take || '').trim() && String(reading.take || '').trim()) prev.take = reading.take;
      }
      n.readings = [...byTarget.values()];
    }
  }
  for (const key of ['focusId', 'inspectedId', 'selectedId']) {
    if (rep[key] && dropNode.has(rep[key])) rep[key] = follow(rep[key]);
  }
  for (const house of rep.house || []) {
    if (!house) continue;
    if (house.headId && dropChar.has(house.headId)) house.headId = dropChar.get(house.headId);
    if (!Array.isArray(house.connections)) continue;
    const seen = new Set();
    house.connections = house.connections.map(c => {
      if (!c) return c;
      const characterId = dropChar.get(c.characterId) || c.characterId;
      return characterId === c.characterId ? c : { ...c, characterId };
    }).filter(c => {
      if (!c?.characterId || seen.has(c.characterId)) return false;
      seen.add(c.characterId);
      return true;
    });
  }
  return true;
}

export function decorateReel(payload, extras, { title = '' } = {}) {
  return {
    ...payload,
    _showtime: true,
    _reel: true,
    _kind: REEL_KIND,
    title: clipReelTitle(title || payload?.title),
    extras: extras || null,
  };
}

function starKey(id) {
  return String(id || '').trim();
}

function starMatcher(ids, names) {
  const idSet = ids instanceof Set ? ids : new Set(ids || []);
  const nameSet = names instanceof Set ? names : new Set(names || []);
  return (raw) => {
    const key = starKey(raw);
    if (!key) return false;
    if (key === 'star' || key === 'player' || key === 'you' || key === 'self') return true;
    if (idSet.has(key)) return true;
    return nameSet.has(key.toLowerCase());
  };
}

function dropStarRows(list, isStar) {
  if (!Array.isArray(list)) return list;
  return list.filter(row => !(
    isStar(row?.assignedTo)
    || isStar(row?.characterId)
    || isStar(row?.ownerCharacterId)
    || isStar(row?.ownerId)
  ));
}

/**
 * Copy-side strip. Drops the Star card, their kit, and rows aimed at them.
 * Script and interview prose stay, so the name can still appear in a scene.
 */
export function stripStarFromReel(chat, hint = null) {
  if (!chat || typeof chat !== 'object') return chat;
  const characters = Array.isArray(chat.cast?.characters) ? chat.cast.characters : [];
  const stars = characters.filter(c => c?.priority === 'star');
  const ids = new Set(stars.map(c => c.id).filter(Boolean));
  const names = new Set(stars.map(c => String(c.name || '').trim().toLowerCase()).filter(Boolean));
  const hintId = starKey(hint?.id);
  const hintName = String(hint?.name || '').trim().toLowerCase();
  if (hintId) ids.add(hintId);
  if (hintName) names.add(hintName);
  if (!ids.size && !names.size && !stars.length) return chat;
  const isStar = starMatcher(ids, names);
  const droppedItems = new Set();

  for (const star of stars) {
    for (const piece of [...(star.wardrobe || []), ...(star.props || [])]) {
      if (piece?.id) droppedItems.add(piece.id);
    }
  }
  if (chat.cast && Array.isArray(chat.cast.characters)) {
    chat.cast.characters = characters.filter(c => c?.priority !== 'star').map(c => {
      const next = { ...c };
      if (Array.isArray(c.plotHooks)) next.plotHooks = dropStarRows(c.plotHooks, isStar);
      if (Array.isArray(c.conditions)) {
        next.conditions = c.conditions.filter(cond => !droppedItems.has(cond?.sourceId) && !isStar(cond?.sourceId));
      }
      return next;
    });
  }

  const inv = chat.inventory;
  if (inv && typeof inv === 'object') {
    for (const loc of ['mobile', 'static']) {
      if (!Array.isArray(inv[loc])) continue;
      inv[loc] = inv[loc].filter(item => {
        const where = item?.locator?.where || '';
        if (where === 'room' || where === 'lost') return true;
        const owner = item?.locator?.ownerId || item?.ownerId || '';
        const equipped = item?.equippedTo?.type === 'player' || isStar(item?.equippedTo?.characterId);
        const owned = isStar(owner) || equipped || (!owner && !item?.equippedTo?.characterId);
        if (!owned) return true;
        if (item?.id) droppedItems.add(item.id);
        return false;
      });
    }
  }
  if (chat.cast?.characters) {
    for (const c of chat.cast.characters) {
      if (!Array.isArray(c.conditions)) continue;
      c.conditions = c.conditions.filter(cond => !droppedItems.has(cond?.sourceId));
    }
  }

  const rep = chat.reputation;
  if (rep && typeof rep === 'object') {
    const removedNodes = new Set(['self']);
    if (Array.isArray(rep.personal)) {
      for (const node of rep.personal) {
        if (node?.kind === 'self' || isStar(node?.characterId) || isStar(node?.id)) {
          if (node.id) removedNodes.add(node.id);
        }
      }
      rep.personal = rep.personal.filter(node => !removedNodes.has(node.id)).map(node => ({
        ...node,
        links: (node.links || []).filter(id => !removedNodes.has(id) && !isStar(id)),
        readings: (node.readings || []).filter(r => !removedNodes.has(r?.targetId) && !isStar(r?.targetId)),
        supporters: (node.supporters || []).filter(id => !removedNodes.has(id) && !isStar(id)),
      }));
    }
    if (removedNodes.has(rep.focusId)) rep.focusId = rep.personal?.[0]?.id || '';
    if (removedNodes.has(rep.inspectedId)) rep.inspectedId = rep.focusId || '';
    if (Array.isArray(rep.house)) {
      for (const house of rep.house) {
        if (isStar(house?.headId)) house.headId = '';
        if (Array.isArray(house?.connections)) {
          house.connections = house.connections.filter(c => !isStar(c?.characterId));
        }
      }
    }
  }

  const mot = chat.motivation;
  if (mot?.perChar && typeof mot.perChar === 'object') {
    for (const id of ids) delete mot.perChar[id];
    for (const row of Object.values(mot.perChar)) {
      if (!row || typeof row !== 'object') continue;
      for (const key of ['secrets', 'achievements', 'steps']) {
        if (Array.isArray(row[key])) row[key] = dropStarRows(row[key], isStar);
      }
    }
  }
  if (mot?.sonar) {
    for (const key of ['secretPings', 'beatPings']) {
      if (Array.isArray(mot.sonar[key])) mot.sonar[key] = dropStarRows(mot.sonar[key], isStar);
    }
  }

  for (const pings of [chat.backstage?.stage?.sonar?.pings, chat.stage?.sonar?.pings]) {
    if (!pings || typeof pings !== 'object') continue;
    for (const id of ids) delete pings[id];
  }
  return chat;
}

export function smokeReelNamePure() {
  if (reelFilename('Lost & Found', '20261013-2046') !== 'showtime-reel-lost-found-20261013-2046.json') {
    return 'named reel filename';
  }
  if (reelFilename('', '20261013-2046') !== 'showtime-reel-20261013-2046.json') {
    return 'empty title keeps the generic name';
  }
  if (reelFilename('', '20261013-2046', { backstage: true }) !== 'showtime-reel-backstage-20261013-2046.json') {
    return 'untitled backstage reel name';
  }
  const a = decorateReel({ chat: { n: 1 } }, null, { title: 'Lost & Found' });
  const b = decorateReel({ chat: { n: 1 } }, null, { title: 'Other' });
  if (a.title !== 'Lost & Found') return 'reel title';
  if (reelHash(a) === reelHash(b)) return 'a new name should change the hash';
  if (reelHash(a) !== reelHash(decorateReel({ chat: { n: 1 } }, null, { title: 'Lost & Found' }))) {
    return 'the same reel should hash the same';
  }
  const stripped = stripStarFromReel({
    cast: {
      characters: [
        { id: 'star1', name: 'Weslie', priority: 'star', wardrobe: [{ id: 'coat' }], plotHooks: [] },
        {
          id: 'm', name: 'Mirko', priority: 'lead',
          plotHooks: [{ name: 'Find him', assignedTo: 'star1' }, { name: 'The city', assignedTo: '' }],
          conditions: [{ name: 'Winded', sourceId: 'coat' }, { name: 'Cast', sourceId: '' }],
        },
      ],
    },
    inventory: {
      mobile: [{ id: 'knife', name: 'knife', locator: { where: 'carried', ownerId: 'star' } }],
      static: [{ id: 'tile', name: 'tile', locator: { where: 'room', ownerId: '' } }],
    },
    reputation: {
      focusId: 'self',
      personal: [
        { id: 'self', kind: 'self', links: ['mirko'] },
        { id: 'mirko', characterId: 'm', links: ['self', 'hawks'], readings: [{ targetId: 'self' }] },
        { id: 'hawks', characterId: 'h', links: ['mirko'] },
      ],
      house: [{ headId: 'star1', connections: [{ characterId: 'star1' }, { characterId: 'm' }] }],
    },
    motivation: { perChar: { star1: { steps: [{ name: 'mine' }] }, m: { steps: [{ assignedTo: 'star1' }, { name: 'hers' }] } } },
    script: { cards: [{ summary: 'Weslie waited on the roof.' }] },
  });
  if (stripped.cast.characters.some(c => c.priority === 'star')) return 'star card should leave';
  const mirko = stripped.cast.characters.find(c => c.id === 'm');
  if (mirko.plotHooks.length !== 1 || mirko.plotHooks[0].name !== 'The city') return 'hooks aimed at the star should leave';
  if (mirko.conditions.length !== 1) return 'a condition from the star kit should leave';
  if (stripped.inventory.mobile.length) return 'star kit should leave';
  if (stripped.inventory.static[0]?.id !== 'tile') return 'a room piece should stay';
  if (stripped.reputation.personal.some(n => n.kind === 'self')) return 'the self node should leave';
  if (stripped.reputation.personal.find(n => n.id === 'mirko').links.includes('self')) return 'a link to the star should leave';
  if (!stripped.reputation.personal.find(n => n.id === 'hawks').links.includes('mirko')) return 'a link between the cast should stay';
  if (stripped.reputation.house[0].connections.length !== 1) return 'a house tie to the star should leave';
  if (stripped.motivation.perChar.star1) return 'the star sheet should leave';
  if (stripped.script.cards[0].summary !== 'Weslie waited on the roof.') return 'scene prose should keep the name';

  const dest = {
    cast: { characters: [{ id: 'local-hawks', name: 'Hawks', affiliationHouseId: '' }] },
    reputation: { house: [{ id: 'old', name: 'Other', connections: [] }], personal: [] },
  };
  applyReelAffiliations(dest, {
    chat: {
      cast: { characters: [{ id: 'reel-hawks', name: 'Hawks' }] },
      reputation: {
        house: [{
          id: 'hpsc', name: 'HPSC', alias: 'Commission', description: '', standing: -10,
          connections: [{ characterId: 'reel-hawks', role: 'Operative' }], headId: '',
        }],
        personal: [{ id: 'g1', category: 'group', name: 'HPSC', houseId: 'hpsc' }],
      },
    },
  });
  if (!dest.reputation.house.some(h => h.id === 'hpsc')) return 'a reel house should arrive';
  if (dest.reputation.house.find(h => h.id === 'old') == null) return 'an existing house should stay';
  const hpsc = dest.reputation.house.find(h => h.id === 'hpsc');
  if (hpsc.connections[0]?.characterId !== 'local-hawks') return 'affiliation should follow the local cast id';
  if (dest.cast.characters[0].affiliationHouseId !== 'hpsc') return 'cast affiliation should be set';
  if (!dest.reputation.personal.some(n => n.houseId === 'hpsc')) return 'affiliation group should arrive';
  applyReelAffiliations(dest, {
    affiliations: packReelAffiliations({
      cast: { characters: [{ id: 'reel-hawks', name: 'Hawks', affiliationHouseId: 'hpsc' }] },
      reputation: { house: [{ id: 'hpsc', name: 'HPSC', connections: [{ characterId: 'reel-hawks', role: 'Operative' }] }], personal: [] },
    }),
  });
  if (dest.reputation.house.filter(h => h.id === 'hpsc').length !== 1) return 'merging the same house twice should not duplicate it';

  const tangled = {
    focusId: 'face',
    inspectedId: 'face',
    personal: [
      { id: 'face', category: 'individual', name: 'Hawks', characterId: 'card', auto: true, x: 0.4, y: 0.4, links: ['weslie'], readings: [] },
      { id: 'placed', category: 'individual', name: 'Hawks, Bird of Prey', characterId: 'reel', auto: false, x: 0.4, y: -0.4, links: ['g'], readings: [{ targetId: 'weslie', take: 'knows him' }] },
      { id: 'weslie', category: 'individual', name: 'Weslie Becks', characterId: 'w', links: ['placed'], readings: [{ targetId: 'placed', take: 'adores him' }] },
    ],
    house: [{ id: 'h', headId: '', connections: [{ characterId: 'card', role: 'Operative' }, { characterId: 'reel', role: 'Lead' }] }],
  };
  if (!foldPersonNodes(tangled, [
    { id: 'card', name: 'Hawks, Bird of Prey' },
    { id: 'reel', name: 'Hawks' },
    { id: 'w', name: 'Weslie Becks' },
  ])) return 'duplicate hawks should fold';
  const hawks = tangled.personal.filter(n => n.id === 'face' || n.id === 'placed');
  if (hawks.length !== 1) return 'one hawks bubble should remain';
  if (!tangled.personal.some(n => n.id === 'weslie')) return 'weslie should stay her own bubble';
  if (tangled.personal.find(n => n.id === 'weslie').readings[0]?.targetId !== hawks[0].id) return 'a reading of the dropped hawks should follow the keeper';
  if (tangled.house[0].connections.length !== 1) return 'the house roster should list hawks once';
  if (tangled.focusId !== hawks[0].id) return 'focus should stay on the remaining hawks';
  return '';
}

export function isReelPayload(payload) {
  return !!(payload && (payload._showtime || payload._reel || payload._showtimeBackstage));
}

/**
 * Apply extras after module JSON is already imported.
 * @returns {Promise<string[]>} human-readable notes
 */
export async function importReelExtras(storage, extras = {}, { importCards = true, importLore = true } = {}) {
  const notes = [];
  if (!extras || typeof extras !== 'object') return notes;
  extras = sanitizeReelExtras(extras);
  const ctx = getContext();
  const characters = ctx.characters || [];

  if (importLore && extras.lorebooks) {
    let n = 0;
    for (const [name, data] of Object.entries(extras.lorebooks)) {
      if (!name || !data) continue;
      try {
        await saveWorldInfo(name, data, true);
        n++;
      } catch (err) {
        console.warn('[Showtime/Reel] lorebook import', name, err);
      }
    }
    if (n) notes.push(`${n} lorebook${n === 1 ? '' : 's'}`);
  }

  const avatarByName = new Map();
  for (const ch of characters) {
    const n = String(ch?.name || '').trim().toLowerCase();
    if (n && ch.avatar) avatarByName.set(n, ch.avatar);
  }

  if (importCards && extras.cards) {
    for (const [castId, card] of Object.entries(extras.cards)) {
      if (!card?.dataUrl) continue;
      const file = fileFromDataUrl(card.dataUrl, card.filename || `${card.name || 'character'}.png`);
      if (!file) continue;
      try {
        const formData = new FormData();
        formData.append('avatar', file);
        formData.append('file_type', 'png');
        const result = await fetch('/api/characters/import', {
          method: 'POST',
          body: formData,
          headers: getRequestHeaders({ omitContentType: true }),
          cache: 'no-cache',
        });
        if (!result.ok) throw new Error(result.statusText);
        const data = await result.json();
        const avatar = data.file_name ? `${data.file_name}.png` : '';
        if (avatar && extras.links?.[castId]) extras.links[castId].characterCardId = avatar;
        if (avatar) notes.push(`imported card “${card.name || castId}”`);
      } catch (err) {
        console.warn('[Showtime/Reel] card import', card.name, err);
        notes.push(`could not import card “${card.name || castId}” — link it by hand if you already have it`);
      }
    }
  }

  try {
    const castState = storage.getChat('cast', { characters: [] });
    const members = castState.characters || [];
    let linked = 0;
    let faced = 0;
    for (const member of members) {
      const link = extras.links?.[member.id]
        || Object.values(extras.links || {}).find(l =>
          String(l.name || '').toLowerCase() === String(member.name || '').toLowerCase());
      const portrait = extras.portraits?.[member.id]
        || Object.values(extras.portraits || {}).find(p =>
          String(p.name || '').toLowerCase() === String(member.name || '').toLowerCase());
      if (portrait?.dataUrl) {
        const safe = sanitizeMediaUrl(portrait.dataUrl);
        if (safe) {
          member.portrait = safe;
          faced++;
        }
      }
      if (link) {
        let avatar = link.characterCardId || '';
        if (avatar && !characters.some(c => c.avatar === avatar)) {
          const byName = avatarByName.get(String(link.name || member.name || '').toLowerCase());
          if (byName) avatar = byName;
        } else if (!avatar) {
          avatar = avatarByName.get(String(link.name || member.name || '').toLowerCase()) || '';
        }
        if (avatar) {
          member.characterCardId = avatar;
          member.syncFromCard = member.syncFromCard !== false;
          linked++;
        }
        if (link.personaId) member.personaId = link.personaId;
      }
    }
    if (faced) notes.push(`${faced} portrait${faced === 1 ? '' : 's'}`);
    if (linked) notes.push(`linked ${linked} cast member${linked === 1 ? '' : 's'} to cards`);
    storage.setChat('cast', castState);
  } catch (err) {
    console.warn('[Showtime/Reel] cast extras', err);
  }

  return notes;
}
