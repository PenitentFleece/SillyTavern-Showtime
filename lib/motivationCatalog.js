// Shared Motivation catalog — Reputation (and others) read who-knows-what
// without importing the Motivation module.

import { getCastMembers, isFoilOrHigher } from './castCatalog.js';

function getRepDb(storage) {
  try {
    return storage.getChat('reputation', { personal: [], house: [] });
  } catch {
    return { personal: [], house: [] };
  }
}

function getRepHouses(storage) {
  return getRepDb(storage).house ?? [];
}

/** Cast (foil billing or higher) and houses that can carry a standing toward the Star. */
export function standingSubjects(storage) {
  const cast = getCastMembers(storage)
    .filter(m => isFoilOrHigher(m.priority) && !m.is_user)
    .map(m => ({ key: `cast:${m.id}`, label: m.name || 'Unnamed' }));
  const houses = getRepHouses(storage)
    .map(h => ({ key: `house:${h.id}`, label: h.alias ? `${h.name} (${h.alias})` : h.name || 'House' }));
  return [...cast, ...houses];
}

export function subjectLabel(storage, key) {
  return standingSubjects(storage).find(s => s.key === key)?.label || '';
}

/**
 * What this cast member or house currently thinks of the Star, on the
 * Reputation scale (-100..100). Null when nothing has been filed.
 */
export function standingToward(storage, key) {
  const [type, id] = String(key || '').split(':');
  if (!id) return null;
  const db = getRepDb(storage);
  if (type === 'house') {
    const h = (db.house ?? []).find(x => x.id === id);
    return h ? Number(h.standing) || 0 : null;
  }
  const nodes = db.personal ?? [];
  const node = nodes.find(n => n.characterId === id);
  if (!node) return null;
  const self = nodes.find(n => n.kind === 'self');
  const rec = self ? (node.readings ?? []).find(r => r.targetId === self.id) : null;
  if (rec && rec.standing != null) return Number(rec.standing) || 0;
  return Number(node.standing) || 0;
}

export function normalizeKnownBy(list) {
  const out = [];
  const seen = new Set();
  for (const raw of list || []) {
    const type = raw?.type === 'house' ? 'house' : 'cast';
    const id = String(raw?.id || '').trim();
    if (!id) continue;
    const key = `${type}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const row = { type, id };
    if (type === 'house') {
      const share = raw?.share === 'all' || raw?.share === 'members' ? raw.share : 'none';
      row.share = share;
      if (share === 'all' || share === 'members') {
        row.memberIds = [...new Set((raw.memberIds || []).map(x => String(x || '').trim()).filter(Boolean))];
      }
    }
    out.push(row);
  }
  return out;
}

export function sameKnower(a, b) {
  if (!a || !b) return false;
  return a.type === b.type && a.id === b.id;
}

/** Drop a knower from a list. Absence from both lists = no relation. */
export function withoutKnower(list, knower) {
  return normalizeKnownBy(list).filter(k => !sameKnower(k, knower));
}

/**
 * Tag a knower as knows / unaware, or clear both (untracked).
 * The two lists stay mutually exclusive.
 */
export function setKnowerStance(secret, knower, stance = '') {
  if (!secret || typeof secret !== 'object') return secret;
  const k = normalizeKnownBy([knower])[0];
  if (!k) return secret;
  secret.knownBy = withoutKnower(secret.knownBy, k);
  secret.unawareBy = withoutKnower(secret.unawareBy, k);
  if (stance === 'knows') secret.knownBy.push(k);
  else if (stance === 'unaware' || stance === 'dark') secret.unawareBy.push(k);
  secret.known = secret.knownBy.length > 0;
  return secret;
}

export function knowerKey(k) {
  return `${k.type}:${k.id}`;
}

export function knowerShareMode(k) {
  if (!k || k.type !== 'house') return '';
  return k.share === 'all' || k.share === 'members' ? k.share : 'none';
}

export function knowerMemberIds(k) {
  return [...new Set((k?.memberIds || []).map(id => String(id || '').trim()).filter(Boolean))];
}

export function knowerShareHint(k) {
  const share = knowerShareMode(k);
  if (!share) return '';
  if (share === 'all') return 'all affiliates';
  if (share === 'members') {
    const n = knowerMemberIds(k).length;
    return n ? `${n} affiliate${n === 1 ? '' : 's'}` : 'no affiliates';
  }
  return 'institution only';
}

/** Cast ids listed on an affiliation (apparent head + connections). */
export function houseAffiliateIds(storage, houseId) {
  if (!houseId) return [];
  const h = getRepHouses(storage).find(x => x.id === houseId);
  if (!h) return [];
  const ids = [];
  const seen = new Set();
  const push = id => {
    const s = String(id || '').trim();
    if (!s || seen.has(s)) return;
    seen.add(s);
    ids.push(s);
  };
  push(h.headId);
  for (const c of h.connections || []) push(c.characterId);
  return ids;
}

export function houseAffiliateRoster(storage, houseId) {
  const members = getCastMembers(storage);
  return houseAffiliateIds(storage, houseId).map(id => ({
    id,
    name: members.find(m => m.id === id)?.name || 'Unknown',
  }));
}

/**
 * A house knower tag includes this cast member only when sharing is on.
 * `share: 'all'` requires they actually belong to that house (`houseIds`).
 * `share: 'members'` uses the explicit list. Default `none` is institution-only.
 */
export function houseKnowerIncludesCast(k, characterId, houseIds = []) {
  if (!k || k.type !== 'house' || !characterId) return false;
  const share = knowerShareMode(k);
  if (share === 'none') return false;
  if (share === 'members') return knowerMemberIds(k).includes(characterId);
  return (houseIds || []).includes(k.id) || knowerMemberIds(k).includes(characterId);
}

/** Every filed secret across the cast, with owner + who currently knows it. */
export function listPlaySecrets(storage) {
  const mot = storage.getChat('motivation', { perChar: {} });
  const members = getCastMembers(storage);
  const houses = getRepHouses(storage);
  const out = [];
  for (const [ownerId, row] of Object.entries(mot.perChar || {})) {
    const owner = members.find(m => m.id === ownerId);
    for (const s of row?.secrets ?? []) {
      out.push({
        id: s.id,
        ownerId,
        ownerName: owner?.name || 'Unknown',
        title: s.title || 'Untitled',
        description: s.description || '',
        tier: s.tier || 'notable',
        knownBy: normalizeKnownBy(s.knownBy),
        unawareBy: normalizeKnownBy(s.unawareBy),
      });
    }
  }
  const live = k => (k.type === 'cast' ? members.some(m => m.id === k.id) : houses.some(h => h.id === k.id));
  return out.map(s => ({
    ...s,
    knownBy: s.knownBy.filter(live),
    unawareBy: s.unawareBy.filter(live),
  }));
}

export function knowerLabel(storage, k) {
  if (!k) return '';
  if (k.type === 'house') {
    const h = getRepHouses(storage).find(x => x.id === k.id);
    return h ? (h.alias || h.name || 'House') : 'House';
  }
  const m = getCastMembers(storage).find(x => x.id === k.id);
  return m?.name || 'Cast';
}

function nodeInList(node, list, starId = '', houseIds = []) {
  if (!node || !Array.isArray(list)) return false;
  if (node.category === 'group' && node.houseId) {
    return list.some(k => k.type === 'house' && k.id === node.houseId);
  }
  const cid = node.characterId || (node.kind === 'self' ? starId : '');
  if (!cid) return false;
  return list.some(k =>
    (k.type === 'cast' && k.id === cid)
    || houseKnowerIncludesCast(k, cid, houseIds));
}

export function nodeKnowsSecret(node, secret, starId = '', houseIds = []) {
  return nodeInList(node, secret?.knownBy, starId, houseIds);
}

/** Deliberately marked as not knowing — explicit `unawareBy` only, never implied. */
export function nodeUnawareOfSecret(node, secret, starId = '', houseIds = []) {
  return nodeInList(node, secret?.unawareBy, starId, houseIds);
}

export function nodeOwnsSecret(node, secret, starId = '') {
  if (!node || !secret?.ownerId) return false;
  if (node.category === 'group') return false;
  const cid = node.characterId || (node.kind === 'self' ? starId : '');
  return !!(cid && cid === secret.ownerId);
}

/**
 * Third-party secret connection: must be explicitly tagged.
 * Ownership is separate — owners may surface as owner without a knowledge tag.
 */
export function nodeTiedToSecret(node, secret, starId = '', houseIds = []) {
  return nodeKnowsSecret(node, secret, starId, houseIds) || nodeUnawareOfSecret(node, secret, starId, houseIds);
}

export function secretsAboutCharacter(secrets, characterId) {
  if (!characterId) return [];
  return secrets.filter(s => s.ownerId === characterId);
}

export function secretsKnownByCast(secrets, characterId) {
  if (!characterId) return [];
  return secrets.filter(s => s.knownBy.some(k => k.type === 'cast' && k.id === characterId));
}

export function secretsKnownByHouse(secrets, houseId) {
  if (!houseId) return [];
  return secrets.filter(s => s.knownBy.some(k => k.type === 'house' && k.id === houseId));
}

/** Affiliation ids this cast member heads or belongs to. */
export function characterHouseIds(storage, characterId) {
  if (!characterId) return [];
  return getRepHouses(storage)
    .filter(h => h.headId === characterId
      || (h.connections || []).some(c => c.characterId === characterId))
    .map(h => h.id);
}

/**
 * Secrets this character knows but does not own — tagged on them directly,
 * or shared with them through an affiliation knower (opt-in, not automatic).
 */
export function secretsKnownToCharacter(secrets, characterId, houseIds = []) {
  if (!characterId) return [];
  const houses = Array.isArray(houseIds) ? houseIds : [];
  return secrets.filter(s => {
    if (s.ownerId === characterId) return false;
    return (s.knownBy || []).some(k =>
      (k.type === 'cast' && k.id === characterId)
      || houseKnowerIncludesCast(k, characterId, houses));
  });
}

function starIdOf(storage) {
  return getCastMembers(storage).find(m => m.priority === 'star')?.id || '';
}

/** Every filed Backstage interview, stamped with the subject it lives under. */
export function listPlayInterviews(storage) {
  const mot = storage.getChat('motivation', { perChar: {} });
  const members = getCastMembers(storage);
  const out = [];
  for (const [subjectId, row] of Object.entries(mot.perChar || {})) {
    const subject = members.find(m => m.id === subjectId);
    for (const iv of row?.interviews ?? []) {
      out.push({
        ...iv,
        subjectId: iv.subjectId || subjectId,
        subjectName: iv.subjectName || subject?.name || 'Unknown',
      });
    }
  }
  return out;
}

/**
 * True when this session was run with `characterId` in the Interviewer slot
 * (cast pick or the Star default). {{user}} and anonymous do not count.
 */
export function sessionConductedBy(session, characterId, starId = '') {
  if (!session || !characterId) return false;
  const mode = String(session.interviewerMode || '');
  if (mode === 'anonymous' || mode === 'user') return false;
  const iid = String(session.interviewerId || '');
  if (iid) return iid === characterId;
  if (mode === 'star') return !!(starId && characterId === starId);
  return false;
}

/**
 * Interviews that belong on a Motivation / Connections sheet.
 * The Star only sees sessions they conducted. Everyone else sees dossiers
 * filed on them as subject, plus any they ran as interviewer.
 */
export function interviewsVisibleOnSheet(storage, characterId, { isStar = false } = {}) {
  if (!characterId) return [];
  const starId = starIdOf(storage);
  const starSheet = isStar || characterId === starId;
  const seen = new Set();
  const out = [];
  for (const iv of listPlayInterviews(storage)) {
    if (!iv?.id || seen.has(iv.id)) continue;
    const conducted = sessionConductedBy(iv, characterId, starId);
    const onSubject = iv.subjectId === characterId;
    if (starSheet) {
      if (!conducted) continue;
      seen.add(iv.id);
      out.push({ ...iv, asInterviewer: true });
      continue;
    }
    if (!onSubject && !conducted) continue;
    seen.add(iv.id);
    out.push({ ...iv, asInterviewer: conducted && !onSubject });
  }
  out.sort((a, b) => (b.at || b.startedAt || 0) - (a.at || a.startedAt || 0));
  return out;
}

/** Lightweight invariant checks (no storage / DOM). Returns '' on success. */
export function smokeSecretRelationPure() {
  try {
    const secret = {
      ownerId: 'alice',
      knownBy: [{ type: 'cast', id: 'bob' }],
      unawareBy: [{ type: 'cast', id: 'carol' }],
    };
    const bob = { category: 'individual', characterId: 'bob' };
    const carol = { category: 'individual', characterId: 'carol' };
    const dave = { category: 'individual', characterId: 'dave' };
    const alice = { category: 'individual', characterId: 'alice' };
    if (!nodeKnowsSecret(bob, secret)) return 'bob should know';
    if (!nodeUnawareOfSecret(carol, secret)) return 'carol should be unaware';
    if (nodeKnowsSecret(dave, secret) || nodeUnawareOfSecret(dave, secret) || nodeTiedToSecret(dave, secret)) {
      return 'untagged dave must have no secret relation';
    }
    if (nodeTiedToSecret(alice, secret)) return 'owner is not a third-party tie without a tag';
    if (!nodeOwnsSecret(alice, secret)) return 'alice should own';
    setKnowerStance(secret, { type: 'cast', id: 'dave' }, 'unaware');
    if (!nodeUnawareOfSecret(dave, secret) || nodeKnowsSecret(dave, secret)) return 'assign unaware failed';
    setKnowerStance(secret, { type: 'cast', id: 'dave' }, 'knows');
    if (!nodeKnowsSecret(dave, secret) || nodeUnawareOfSecret(dave, secret)) return 'knows must drop unaware';
    setKnowerStance(secret, { type: 'cast', id: 'dave' }, '');
    if (nodeTiedToSecret(dave, secret)) return 'clear must untrack';
    const known = secretsKnownToCharacter([secret], 'bob', []);
    if (known.length !== 1 || known[0].ownerId !== 'alice') return 'bob should see alice secret';
    if (secretsKnownToCharacter([secret], 'alice', []).length) return 'owner must not also be a knower copy';
    const guild = { ownerId: 'alice', knownBy: [{ type: 'house', id: 'guild' }] };
    if (secretsKnownToCharacter([guild], 'bob', ['guild']).length) return 'house tag must not auto-share with affiliates';
    guild.knownBy[0] = { type: 'house', id: 'guild', share: 'all' };
    if (secretsKnownToCharacter([guild], 'bob', ['guild']).length !== 1) return 'share all should include affiliates';
    if (secretsKnownToCharacter([guild], 'dave', []).length) return 'share all must not leak outside the house';
    guild.knownBy[0] = { type: 'house', id: 'guild', share: 'members', memberIds: ['carol'] };
    if (secretsKnownToCharacter([guild], 'bob', ['guild']).length) return 'members list should exclude bob';
    if (secretsKnownToCharacter([guild], 'carol', ['guild']).length !== 1) return 'members list should include carol';
    const guildNode = { category: 'group', houseId: 'guild' };
    if (!nodeKnowsSecret(guildNode, guild)) return 'affiliation node should still know the institutional secret';
    if (sessionConductedBy({ interviewerMode: 'user' }, 'star', 'star')) return 'user interviewer is not the star';
    if (sessionConductedBy({ interviewerMode: 'anonymous' }, 'star', 'star')) return 'anon interviewer is not the star';
    if (!sessionConductedBy({ interviewerMode: 'star' }, 'star', 'star')) return 'star mode should count';
    if (!sessionConductedBy({ interviewerMode: 'cast', interviewerId: 'star' }, 'star', 'star')) return 'cast pick of star should count';
    if (sessionConductedBy({ interviewerMode: 'cast', interviewerId: 'bob' }, 'star', 'star')) return 'other cast interviewer is not star';
    return '';
  } catch (err) {
    return String(err?.message || err);
  }
}
