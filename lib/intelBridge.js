// Apply ACH / SEC / rumor-intel tags onto Motivation (and standing math).
// Reputation module owns web nodes; this file files packets and computes nudges.

import {
  getCastMembers,
  getStarMember,
  isFoilOrHigher,
  findCastByNameOrAlias,
  castNameMatches,
} from './castCatalog.js';
import { setKnowerStance, standingInfo } from './motivationCatalog.js';
import { clipIntelTitle, normalizeIntelDirection } from './chatSlate.js';
import { appendNowLedger } from './nowSidecar.js';

function noteIntelLedger(storage, kind, text) {
  const line = String(text || '').trim();
  if (!line) return;
  try { appendNowLedger(storage, { kind, text: line }); } catch { /* ignore */ }
}

function uid(prefix = 'i') {
  return crypto?.randomUUID?.() ?? (`${prefix}_` + Math.random().toString(36).slice(2, 10));
}

function motDb(storage) {
  const mot = storage.getChat('motivation', { perChar: {} });
  mot.perChar ??= {};
  return mot;
}

function ensureCharRow(storage, characterId) {
  const mot = motDb(storage);
  if (!mot.perChar[characterId]) {
    mot.perChar[characterId] = { secrets: [], achievements: [], steps: [], interviews: [], auditAt: 0 };
  }
  const row = mot.perChar[characterId];
  row.secrets ??= [];
  row.achievements ??= [];
  row.steps ??= [];
  return row;
}

function housesOf(storage) {
  try {
    return storage.getChat('reputation', { house: [] }).house ?? [];
  } catch {
    return [];
  }
}

function nameKey(s) {
  return String(s || '').trim().toLowerCase();
}

/** Resolve a printed name to cast or affiliation. */
export function resolveIntelSubject(storage, needle) {
  const n = String(needle || '').trim();
  if (!n) return null;
  const lower = n.toLowerCase();
  if (/^(you|star|\{\{user\}\})$/i.test(n)) {
    const star = getStarMember(storage);
    if (star?.id) return { type: 'cast', id: star.id, label: star.name || 'Star' };
  }
  const cast = findCastByNameOrAlias(storage, n, { includeDirector: false });
  if (cast?.id) return { type: 'cast', id: cast.id, label: cast.name || n };
  const members = getCastMembers(storage);
  const fuzzy = members.find(m => {
    const nm = String(m.name || '').trim().toLowerCase();
    return nm && (lower.includes(nm) || nm.includes(lower) || castNameMatches(m, n));
  });
  if (fuzzy?.id) return { type: 'cast', id: fuzzy.id, label: fuzzy.name || n };
  const house = housesOf(storage).find(h => {
    const hn = nameKey(h.name);
    const ha = nameKey(h.alias);
    return hn === lower || ha === lower || (hn && lower.includes(hn)) || (ha && lower.includes(ha));
  });
  if (house?.id) return { type: 'house', id: house.id, label: house.alias || house.name || n };
  return null;
}

export function applyStandingDelta(current, spec = {}) {
  const cur = current == null || current === '' ? null
    : (Number.isFinite(Number(current)) ? Number(current) : null);
  const base = cur == null ? 0 : cur;
  const mode = spec.mode || 'delta';
  if (mode === 'keep') {
    return { standing: cur, takeOnly: true, bandChanged: false };
  }
  if (mode === 'establish') {
    const standing = cur == null ? 0 : cur;
    return { standing, takeOnly: false, bandChanged: cur == null };
  }
  const standing = Math.max(-100, Math.min(100, Math.round(base + Number(spec.delta || 0))));
  const bandChanged = standingInfo(base).label !== standingInfo(standing).label;
  return { standing, takeOnly: false, bandChanged };
}

export function applyStandingNudge(current, directionId) {
  const dir = normalizeIntelDirection(directionId).id;
  const cur = current == null || current === '' ? null
    : (Number.isFinite(Number(current)) ? Number(current) : null);
  if (dir === 'MIXED') {
    return { standing: cur, takeOnly: true, bandChanged: false };
  }
  if (dir === 'NEW') {
    const standing = cur == null ? 0 : cur;
    return { standing, takeOnly: false, bandChanged: cur == null };
  }
  const base = cur == null ? 0 : cur;
  const delta = dir === 'FALLING' ? -15 : 15;
  const standing = Math.max(-100, Math.min(100, Math.round(base + delta)));
  const bandChanged = standingInfo(base).label !== standingInfo(standing).label;
  return { standing, takeOnly: false, bandChanged };
}

function matchTitle(list, title) {
  const want = nameKey(title);
  if (!want || !Array.isArray(list)) return null;
  const exact = list.find(x => nameKey(x.title) === want);
  if (exact) return exact;
  return list.find((x) => {
    const t = nameKey(x.title);
    const d = nameKey(x.description);
    return (t && (t.includes(want) || want.includes(t)))
      || (d && d.includes(want));
  }) || null;
}

/**
 * File or patch an achievement on a foil-or-higher owner.
 */
export function applySlateAchievement(storage, spec = {}) {
  const ownerId = String(spec.ownerId || '').trim();
  const title = String(spec.title || '').trim();
  const unlocked = String(spec.unlocked || '').trim();
  if (!ownerId || !title || !unlocked) return { ok: false, reason: 'bad-ach' };
  const rec = getCastMembers(storage).find(m => m.id === ownerId);
  if (!rec || !isFoilOrHigher(rec.priority)) return { ok: false, reason: 'billing' };
  const row = ensureCharRow(storage, ownerId);
  row.achievements ??= [];
  let hit = matchTitle(row.achievements, title);
  let created = false;
  if (!hit) {
    hit = {
      id: uid('a'),
      title,
      description: String(spec.description || '').trim(),
      tier: spec.tier || 'notable',
      status: 'earned',
      known: true,
      sceneUid: '',
      hidden: !!spec.hidden,
      unlocked,
    };
    row.achievements.push(hit);
    created = true;
  } else {
    hit.title = title;
    if (spec.description) hit.description = String(spec.description).trim();
    if (spec.tier) hit.tier = spec.tier;
    hit.hidden = !!spec.hidden;
    hit.unlocked = unlocked;
    hit.status = 'earned';
    hit.known = true;
  }
  noteIntelLedger(storage, 'achievement', `Achievement: ${title}`);
  return { ok: true, created, achievement: hit, characterId: ownerId };
}

function knowerFromSubject(sub) {
  if (!sub?.id) return null;
  if (sub.type === 'house') return { type: 'house', id: sub.id, share: 'none' };
  return { type: 'cast', id: sub.id };
}

/**
 * File or spread a Motivation secret. Owner always knows.
 */
export function applySlateSecret(storage, spec = {}) {
  const context = String(spec.context || '').trim();
  if (!context) return { ok: false, reason: 'no-context' };
  const ownerSub = spec.ownerId
    ? { type: 'cast', id: spec.ownerId }
    : resolveIntelSubject(storage, spec.owner);
  if (!ownerSub || ownerSub.type !== 'cast') return { ok: false, reason: 'no-owner' };
  const rec = getCastMembers(storage).find(m => m.id === ownerSub.id);
  if (!rec || !isFoilOrHigher(rec.priority)) return { ok: false, reason: 'billing' };

  const title = String(spec.title || '').trim() || clipIntelTitle(context);
  const row = ensureCharRow(storage, ownerSub.id);
  row.secrets ??= [];
  let hit = matchTitle(row.secrets, title)
    || row.secrets.find(s => nameKey(s.description) && nameKey(s.description).includes(nameKey(context).slice(0, 40)));
  let created = false;
  let verb = 'REVEALED';
  if (!hit) {
    hit = {
      id: uid('s'),
      title,
      description: context,
      tier: spec.tier || 'notable',
      status: 'earned',
      known: true,
      knownBy: [],
      unawareBy: [],
      sceneUid: '',
      channel: spec.channel === 'rumor' ? 'rumor' : 'fact',
      repFrom: String(spec.repFrom || ''),
      repTo: String(spec.repTo || ''),
    };
    row.secrets.push(hit);
    created = true;
    verb = 'ESTABLISHED';
  } else {
    if (spec.tier) hit.tier = spec.tier;
    if (context) hit.description = context;
    hit.status = 'earned';
    if (spec.channel === 'rumor') hit.channel = 'rumor';
    if (spec.repFrom) hit.repFrom = spec.repFrom;
    if (spec.repTo) hit.repTo = spec.repTo;
  }

  const before = (hit.knownBy || []).length;
  setKnowerStance(hit, knowerFromSubject(ownerSub), 'knows');
  for (const name of spec.knowers || []) {
    const sub = resolveIntelSubject(storage, name);
    const k = knowerFromSubject(sub);
    if (k) setKnowerStance(hit, k, 'knows');
  }
  if (!created && (hit.knownBy || []).length > before) verb = 'SPREAD';
  hit.known = (hit.knownBy || []).length > 0;
  if (created || verb === 'SPREAD') {
    const word = verb === 'SPREAD' ? 'spread' : 'established';
    noteIntelLedger(storage, 'secret', `Secret ${word}: ${title}`);
  }
  return { ok: true, created, verb, secret: hit, characterId: ownerSub.id };
}

/**
 * Dual-write a rumor: Motivation secret (channel rumor) owned by From.
 * Standing is applied by Reputation via bus; we return the nudge payload.
 */
export function applySlateRumor(storage, spec = {}) {
  const fromSub = resolveIntelSubject(storage, spec.from);
  const toSub = resolveIntelSubject(storage, spec.to);
  if (!fromSub || !toSub || (fromSub.type === toSub.type && fromSub.id === toSub.id)) {
    return { ok: false, reason: 'bad-subjects' };
  }
  const cause = String(spec.cause || '').trim();
  const reading = String(spec.reading || cause).trim();
  if (!cause) return { ok: false, reason: 'no-cause' };

  const ownerId = fromSub.type === 'cast' ? fromSub.id : '';
  let secretOut = { ok: false };
  if (!spec.skipSecret) {
    if (ownerId) {
      secretOut = applySlateSecret(storage, {
        ownerId,
        title: clipIntelTitle(reading) || clipIntelTitle(cause),
        context: cause,
        tier: 'notable',
        channel: 'rumor',
        knowers: [],
        repFrom: `${fromSub.type}:${fromSub.id}`,
        repTo: `${toSub.type}:${toSub.id}`,
      });
    } else {
      const star = getStarMember(storage);
      const fallbackOwner = star?.id || getCastMembers(storage).find(m => isFoilOrHigher(m.priority))?.id;
      if (fallbackOwner) {
        secretOut = applySlateSecret(storage, {
          ownerId: fallbackOwner,
          title: clipIntelTitle(reading) || clipIntelTitle(cause),
          context: cause,
          tier: 'notable',
          channel: 'rumor',
          knowers: [],
          repFrom: `${fromSub.type}:${fromSub.id}`,
          repTo: `${toSub.type}:${toSub.id}`,
        });
        if (secretOut.ok && secretOut.secret) {
          secretOut.secret.knownBy = [];
          secretOut.secret.unawareBy = [];
          setKnowerStance(secretOut.secret, knowerFromSubject(fromSub), 'knows');
        }
      }
    }
  }

  const direction = spec.direction ? normalizeIntelDirection(spec.direction).id : '';
  return {
    ok: true,
    from: fromSub,
    to: toSub,
    direction,
    take: reading,
    cause,
    secret: secretOut.secret || null,
    characterId: secretOut.characterId || ownerId,
  };
}

export function smokeIntelBridgePure() {
  const rin = { id: 'rin', name: 'Rin', priority: 'lead' };
  const kai = { id: 'kai', name: 'Kai', priority: 'foil' };
  const storage = {
    getChat(key, fallback) {
      if (key === 'cast') return { characters: [rin, kai] };
      if (key === 'motivation') {
        this._mot ??= { perChar: {} };
        return this._mot;
      }
      if (key === 'reputation') return { personal: [], house: [{ id: 'mall', name: 'Mall Security', alias: 'Security' }] };
      return fallback || {};
    },
  };
  const ach = applySlateAchievement(storage, {
    ownerId: 'rin', title: 'First heist', tier: 'notable', unlocked: 'palmed the key',
  });
  if (!ach.ok || !ach.created) return 'ACH should file on Rin';
  const ach2 = applySlateAchievement(storage, {
    ownerId: 'rin', title: 'First heist', unlocked: 'again',
  });
  if (ach2.created) return 'ACH should match by title';
  const sec = applySlateSecret(storage, {
    owner: 'Rin', context: 'the key is a replica', tier: 'major', knowers: ['Kai'],
  });
  if (!sec.ok || sec.verb !== 'ESTABLISHED') return 'SECRET should establish';
  if (!(sec.secret.knownBy || []).some(k => k.id === 'kai')) return 'SECRET should add Kai as knower';
  const spread = applySlateSecret(storage, {
    owner: 'Rin', context: 'the key is a replica', knowers: ['Kai'],
  });
  if (spread.created) return 'SECRET should match existing';
  const rum = applySlateRumor(storage, {
    from: 'Mall Security', to: 'Rin', direction: 'RISING',
    cause: 'cameras caught the assist', reading: 'Useful insider',
  });
  if (!rum.ok || rum.from?.type !== 'house' || rum.to?.id !== 'rin') return 'rumor should resolve house → Rin';
  if (rum.secret?.channel !== 'rumor') return 'rumor secret should use channel rumor';
  if (!(rum.secret.knownBy || []).some(k => k.type === 'house' && k.id === 'mall')) {
    return 'house rumor should tag the house as knower';
  }
  const nudge = applyStandingNudge(0, 'RISING');
  if (nudge.standing !== 15 || !nudge.bandChanged) return 'RISING from Neutral 0 should cross into Interested';
  const mixed = applyStandingNudge(40, 'MIXED');
  if (!mixed.takeOnly || mixed.standing !== 40) return 'MIXED should keep the number';
  return '';
}
