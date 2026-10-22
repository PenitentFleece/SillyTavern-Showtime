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

function readingFields(rec) {
  const intro = rec?.intro || 'none';
  return {
    intro,
    history: String(rec?.history || (intro === 'pre' ? rec?.description : '') || '').trim(),
    baseline: String(rec?.baseline || (intro !== 'pre' ? rec?.description : '') || '').trim(),
    take: String(rec?.take || '').trim(),
    standing: rec?.standing,
  };
}

function personalNode(nodes, { id = '', characterId = '', name = '' } = {}, cast = []) {
  const cid = String(characterId || '').trim();
  const nid = String(id || '').trim();
  if (cid) {
    const byChar = nodes.find(n => n.characterId === cid);
    if (byChar) return byChar;
  }
  if (nid) {
    const byId = nodes.find(n => n.id === nid || n.characterId === nid);
    if (byId) return byId;
  }
  const nm = String(name || '').trim().toLowerCase();
  if (!nm) return null;
  const byName = nodes.find(n => String(n.name || '').trim().toLowerCase() === nm);
  if (byName) return byName;
  const member = (cast || []).find(c => String(c?.name || '').trim().toLowerCase() === nm);
  if (!member?.id) return null;
  return nodes.find(n => n.characterId === member.id) || null;
}

/**
 * How two people stand, from the Connections readings.
 * Callers write their own sentences. Null when either person is missing.
 * @param {object} storage
 * @param {{ id?: string, characterId?: string, name?: string }} subject
 * @param {{ id?: string, characterId?: string, name?: string }} other
 */
export function connectionReading(storage, subject, other) {
  const nodes = getRepDb(storage).personal || [];
  let cast = [];
  try { cast = getCastMembers(storage); } catch { cast = []; }
  const subjectNode = personalNode(nodes, subject || {}, cast);
  const otherNode = personalNode(nodes, other || {}, cast);
  if (!subjectNode || !otherNode || subjectNode.id === otherNode.id) return null;
  const toward = readingFields((subjectNode.readings || []).find(r => r.targetId === otherNode.id));
  const reverse = readingFields((otherNode.readings || []).find(r => r.targetId === subjectNode.id));
  const linked = (subjectNode.links || []).includes(otherNode.id)
    || (otherNode.links || []).includes(subjectNode.id);
  return {
    name: String(other?.name || otherNode.name || '').trim() || 'them',
    linked,
    toward,
    reverse,
  };
}

/** Reputation standing bands (exclusive upper bound). Same colors as Connections rings. */
export const STANDING_BANDS = Object.freeze([
  { at: -85, label: 'Infamous',      color: '#7a1f1f' },
  { at: -69, label: 'Hostile',       color: '#c42b2b' },
  { at: -54, label: 'Cold',          color: '#c45a32' },
  { at: -38, label: 'Unfriendly',    color: '#d4782c' },
  { at: -23, label: 'Uncomfortable', color: '#d49a3a' },
  { at: -8,  label: 'Wary',          color: '#c9a24a' },
  { at: 8,   label: 'Neutral',       color: '#e8c56b' },
  { at: 23,  label: 'Interested',    color: '#b8c45a' },
  { at: 38,  label: 'Comfortable',   color: '#7aab4a' },
  { at: 54,  label: 'Friendly',      color: '#4a9e52' },
  { at: 69,  label: 'Close',         color: '#3d8a68' },
  { at: 85,  label: 'Bonded',        color: '#2e7a5a' },
  { at: 101, label: 'Celebrated',    color: '#c9e86b' },
]);

export function standingInfo(val) {
  const n = Number(val);
  const clamped = Number.isFinite(n) ? Math.max(-100, Math.min(100, Math.round(n))) : 0;
  for (const s of STANDING_BANDS) {
    if (clamped < s.at) return s;
  }
  return STANDING_BANDS[STANDING_BANDS.length - 1];
}

/** CSS vars for a Connections-style conic ring. */
export function standingMeterStyle(val) {
  const n = Number(val);
  const clamped = Number.isFinite(n) ? Math.max(-100, Math.min(100, Math.round(n))) : 0;
  const info = standingInfo(clamped);
  return {
    color: info.color,
    label: info.label,
    deg: ((clamped + 100) / 200) * 360,
  };
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
        channel: s.channel === 'rumor' ? 'rumor' : 'fact',
        repFrom: s.repFrom || '',
        repTo: s.repTo || '',
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

// ── Cinema Lexicon Patterns (Secrets, Achievements, Plot Hooks & Beat Triggers) ──

export const CINEMA_SECRET_CUES = Object.freeze([
  /(?:classified|restricted|confidential|redacted|top\s*secret)\s+(?:script|footage|scene|ending|cut)/i,
  /(?:deleted|alternate|extended|director['’]s\s*cut|behind\s*the\s*scenes|bloopers?)\s+(?:scene|take|footage|ending)/i,
  /(?:easter\s*egg|hidden|secret|unlockable|bonus|post[-\s]credit)\s+(?:scene|track|footage|reveal)/i,
  /(?:major|huge|plot)\s+(?:spoiler|twist|reveal)/i,
  /(?:unreleased|unfinished|workprint|rough\s*cut|assembly\s*cut)/i,
  /\b(?:off\s*the\s*record|not\s*in\s*the\s*script|improvised?|unscripted)\b/i,
  /(?:classified|confidential|redacted|deleted\s*scene|director['’]s\s*cut|behind\s*the\s*scenes|easter\s*egg|post[-\s]credits|hidden|unreleased)/i,
]);

export const CINEMA_ACHIEVEMENT_CUES = Object.freeze([
  /(?:won|awarded|nominated\s*for|received)\s+(?:the\s+)?(?:oscar|emmy|golden\s*globe|bafta|palme\s*d['’]or|award)/i,
  /(?:critical\s+acclaim|standing\s*ovation|rave\s*reviews?|universal\s+praise|certified\s+fresh)/i,
  /(?:box\s*office|opening\s*weekend|domestic|worldwide)\s+(?:hit|success|record|smash|blockbuster)/i,
  /(?:grossed|earned|made)\s+(?:over\s+)?\$?\d+(?:\.\d+)?\s*(?:million|billion)?/i,
  /\b(?:cult\s+classic|sleeper\s*hit|sleeper|underground\s*hit|hidden\s*gem|fan\s*favorite)\b/i,
  /\b(?:greenlit|fast[-\s]tracked|in\s*production|wrapped|in\s*the\s*can|picture\s*locked)\b/i,
  /(?:career|defining|breakout|star[-\s]making|scene[-\s]stealing)\s+(?:role|performance|turn)/i,
  /(?:award|oscar|nomination|blockbuster|cult\s*classic|standing\s*ovation|critical\s*acclaim|box\s*office|wrapped|greenlit)/i,
]);

export const CINEMA_EVENT_CUES = Object.freeze([
  /\b(?:inciting\s+incident|call\s+to\s+adventure|point\s+of\s+no\s+return|midpoint|climax|denouement|resolution)\b/i,
  /\b(?:cliffhanger|to\s+be\s+continued|stinger|post[-\s]credits\s+scene|sequel\s+hook)\b/i,
  /\b(?:plot\s+twist|reveal|revelation|turn|reversal|betrayal|double[-\s]cross)\b/i,
  /\b(?:cold\s+open|opening\s+shot|establishing\s+shot|montage|flashback|flash[-\s]forward|cutaway|cross[-\s]cut)\b/i,
  /\b(?:premiere|screening|test\s+screening|table\s+read|rehearsal|shoot|filming)\b/i,
  /\b(?:ticking\s+clock|race\s+against\s+time|looming\s+deadline|final\s+act|third\s+act)\b/i,
  /\b(?:coming\s+(?:soon|this\s+summer|this\s+winter)|in\s+theaters?\s+(?:soon|now)|rated\s+[RPG]|trailer|teaser)\b/i,
  /(?:climax|twist|reveal|cliffhanger|premiere|inciting\s*incident|call\s+to\s+adventure|cold\s*open|flashback|sequel\s*hook)/i,
]);

export const BEAT_SECRET_UNLOCK_RE = /\b(?:secret\s+unlocked?|classified\s+revealed|deleted\s*scene\s*found|easter\s*egg\s*discovered)\b/i;
export const BEAT_ACHIEVEMENT_UNLOCK_RE = /\b(?:award\s*unlocked?|achievement\s*get|star\s*earned|critical\s*success)\b/i;

export const CINEMA_PATTERNS = Object.freeze({
  secret: /(?:classified|secret|deleted|hidden)\s+(?:scene|footage|ending)\s*:\s*(.+?)(?:\r?\n|$)/gi,
  achievement: /(?:awarded|received|earned)\s*:\s*(?:the\s+)?(.+?)(?:\s+(?:at|for|in)\s+[^\r\n]+|\r?\n|$)/gi,
  hook: /(?:plot\s+hook|story\s+beat|cliffhanger|twist)\s*:\s*(.+?)(?:\r?\n|$)/gi,
  beatSecretUnlock: BEAT_SECRET_UNLOCK_RE,
  beatAchievementUnlock: BEAT_ACHIEVEMENT_UNLOCK_RE,
  isSecret: (text) => {
    const s = String(text || '');
    return !!s && (BEAT_SECRET_UNLOCK_RE.test(s) || CINEMA_SECRET_CUES.some(re => re.test(s)));
  },
  isAchievement: (text) => {
    const s = String(text || '');
    return !!s && (BEAT_ACHIEVEMENT_UNLOCK_RE.test(s) || CINEMA_ACHIEVEMENT_CUES.some(re => re.test(s)));
  },
  isEvent: (text) => {
    const s = String(text || '');
    return !!s && CINEMA_EVENT_CUES.some(re => re.test(s));
  },
});

function matchAllCaptures(text, pattern) {
  const s = String(text || '');
  if (!s) return [];
  const re = new RegExp(pattern.source, 'gi');
  const out = [];
  const seen = new Set();
  let m;
  while ((m = re.exec(s))) {
    const val = String(m[1] || '').replace(/^["'“”‘’\s]+|["'“”‘’\s.]+$/g, '').trim();
    if (!val) continue;
    const k = val.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(val);
  }
  return out;
}

/**
 * Extract explicit Cinema Lexicon lines (`Classified scene: ...`, `Awarded: ...`,
 * `Plot hook: ...`) and compute thematic category flags for a text block.
 */
export function extractCinemaLexicon(text) {
  const s = String(text || '');
  const secrets = matchAllCaptures(s, CINEMA_PATTERNS.secret);
  const achievements = matchAllCaptures(s, CINEMA_PATTERNS.achievement);
  const hooks = matchAllCaptures(s, CINEMA_PATTERNS.hook);
  const beatSecretUnlock = BEAT_SECRET_UNLOCK_RE.test(s);
  const beatAchievementUnlock = BEAT_ACHIEVEMENT_UNLOCK_RE.test(s);
  return {
    secrets,
    achievements,
    hooks,
    flags: {
      isSecret: secrets.length > 0 || CINEMA_PATTERNS.isSecret(s),
      isAchievement: achievements.length > 0 || CINEMA_PATTERNS.isAchievement(s),
      isEvent: hooks.length > 0 || CINEMA_PATTERNS.isEvent(s),
      beatSecretUnlock,
      beatAchievementUnlock,
    },
  };
}

/** Pure smoke check for Cinema Lexicon extraction and categorization. */
export function smokeCinemaLexiconPure() {
  try {
    const sample = [
      'Classified scene: Hawks slipped the transmitter under the break room table.',
      'Awarded: The Golden Feather for covert reconnaissance at the Fukuoka tower',
      'Cliffhanger: The elevator power cuts out on the 18th floor.',
      'Note: Secret unlocked and critical success after the director’s cut scene.',
    ].join('\n');
    const res = extractCinemaLexicon(sample);
    if (res.secrets.length !== 1 || !res.secrets[0].includes('Hawks slipped')) {
      return `secret extraction failed: ${JSON.stringify(res.secrets)}`;
    }
    if (res.achievements.length !== 1 || res.achievements[0] !== 'Golden Feather') {
      return `achievement extraction failed: ${JSON.stringify(res.achievements)}`;
    }
    if (res.hooks.length !== 1 || !res.hooks[0].includes('elevator power')) {
      return `hook extraction failed: ${JSON.stringify(res.hooks)}`;
    }
    if (!res.flags.isSecret || !res.flags.isAchievement || !res.flags.isEvent) {
      return 'combined flags should all be true on sample';
    }
    if (!res.flags.beatSecretUnlock || !res.flags.beatAchievementUnlock) {
      return 'beat unlock flags failed on sample';
    }
    if (!CINEMA_PATTERNS.isSecret('That conversation was strictly off the record.')) {
      return 'off the record should match isSecret';
    }
    if (!CINEMA_PATTERNS.isAchievement('It was a scene-stealing performance with universal praise.')) {
      return 'career/reception should match isAchievement';
    }
    if (!CINEMA_PATTERNS.isEvent('A ticking clock before the third act climax.')) {
      return 'narrative pressure should match isEvent';
    }
    return '';
  } catch (err) {
    return String(err?.message || err);
  }
}

