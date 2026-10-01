// After a Cue turn: file the speaker's new readings, rumors, and secrets
// from a plot-significant beat. Quiet isolated gen — not scene writing.
// Banter does not hunt for a Reputation bubble.

import {
  getCastMembers,
  getStarMember,
  getDirectorRecord,
  ensureDirectorDirection,
  formatDirectorPromptBlock,
  normalizePlotHook,
  isFoilOrHigher,
} from './castCatalog.js';
import { clipText, textMatchesHay } from './chatTrack.js';
import { parseJsonObject } from './jsonExtract.js';
import { setKnowerStance } from './motivationCatalog.js';
import { normalizeTrackers } from './trackersConfig.js';

function uid() {
  return crypto?.randomUUID?.() ?? `t_${Math.random().toString(36).slice(2, 10)}`;
}

function orbit(n) {
  const a = Number(n) * 2.399;
  return { x: 0.5 + 0.32 * Math.cos(a), y: 0.5 + 0.32 * Math.sin(a) };
}

function clampStand(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(-100, Math.min(100, Math.round(n)));
}

function normName(s) {
  return String(s || '').trim().toLowerCase();
}

function matchCast(storage, needle) {
  const want = normName(needle);
  if (!want) return null;
  if (want === 'star' || want === 'you' || want === '{{user}}') return getStarMember(storage) || { id: '', name: 'Star', star: true };
  const members = getCastMembers(storage);
  return members.find(m => {
    const names = [m.name, ...(m.aliases || [])].map(normName);
    const first = String(m.name || '').split(/[\s,]+/)[0].toLowerCase();
    return names.includes(want) || (first.length >= 3 && first === want);
  }) || null;
}

function selfNode(rep) {
  return (rep.personal || []).find(n => n.kind === 'self' || n.id === 'self') || null;
}

function personNode(rep, characterId, name) {
  const nodes = Array.isArray(rep.personal) ? rep.personal : [];
  if (characterId) {
    const hit = nodes.find(n => n.characterId === characterId && n.category !== 'rumor');
    if (hit) return hit;
  }
  const nm = normName(name);
  if (!nm) return null;
  if (nm === 'star' || nm === 'you') return selfNode(rep);
  return nodes.find(n => n.category !== 'rumor' && normName(n.name) === nm) || null;
}

function ensurePersonNode(rep, characterId, name) {
  if (!characterId && !name) return null;
  const existing = personNode(rep, characterId, name);
  if (existing) return existing;
  const pos = orbit((rep.personal || []).length);
  const node = {
    id: characterId ? `c_${characterId}` : uid(),
    kind: 'notice',
    auto: true,
    category: 'individual',
    characterId: characterId || '',
    houseId: '',
    name: name || 'Cast',
    description: '',
    notes: '',
    standing: 0,
    x: pos.x,
    y: pos.y,
    links: [],
    readings: [],
  };
  rep.personal = Array.isArray(rep.personal) ? rep.personal : [];
  rep.personal.push(node);
  return node;
}

function ensureLink(a, b) {
  if (!a || !b || a.id === b.id) return;
  a.links = Array.isArray(a.links) ? a.links : [];
  b.links = Array.isArray(b.links) ? b.links : [];
  if (!a.links.includes(b.id)) a.links.push(b.id);
  if (!b.links.includes(a.id)) b.links.push(a.id);
}

function upsertReading(from, targetId, { take, standing, aware } = {}) {
  if (!from || !targetId || from.id === targetId || from.category === 'rumor') return null;
  from.readings = Array.isArray(from.readings) ? from.readings : [];
  let rec = from.readings.find(r => r.targetId === targetId);
  if (!rec) {
    rec = { targetId, aware: aware || 'knows', take: take || '' };
    from.readings.push(rec);
  } else {
    if (aware) rec.aware = aware;
    if (take) rec.take = take;
  }
  const stand = clampStand(standing);
  if (stand != null) rec.standing = stand;
  return rec;
}

/** Confession / betrayal / cover-up — always plot-weight. */
export const STRONG_TAKE_RE = /\b(confess(?:es|ed|ing)?|admitted|admits?|betrays?|betrayal|blackmail|leverage|overheard|overhears?|eavesdrops?|finds?\s+out|discovered|discovers?|lets?\s+slip|spills?|cover(?:ing|ed)?\s+up|won't tell|can't tell|cannot tell|never (?:trust|forgive)|double-?cross|it\s+turns?\s+out)\b/i;

/** Judgment that might matter if a hook or billed speaker is involved. */
export const JUDGMENT_RE = /\b(suspected|suspects?|realized|realizes?|learned|learns?|revealed|reveals?|warns?|resents?|despises?|jealous|alliance|owes?|threat(?:en(?:s|ed|ing)?)?|liar|lying|lied|stalling|hiding|concealing|can't be trusted|don't trust|won't trust)\b/i;

function trackerSlice(storage) {
  try {
    return normalizeTrackers(storage?.getChat?.('backstage', {})?.trackers);
  } catch {
    return normalizeTrackers(null);
  }
}

function activeHooks(storage) {
  const director = getDirectorRecord(storage);
  return (director?.plotHooks || []).map(normalizePlotHook).filter(h => h && h.active !== false);
}

function hayHitsHook(text, hooks) {
  const hay = String(text || '').toLowerCase();
  if (!hay.trim()) return false;
  return (hooks || []).some(h =>
    (h.name && textMatchesHay(h.name, hay))
    || (h.description && textMatchesHay(h.description, hay)));
}

function speakerAssigned(hooks, charId) {
  if (!charId) return false;
  return (hooks || []).some(h => h.assignedTo && h.assignedTo === charId);
}

/**
 * Tracker toggles + Director dials decide which take channels may fire,
 * and how picky the cheap prefilter is.
 */
export function cueTakePolicy(storage) {
  const t = trackerSlice(storage);
  const conn = t.connection || {};
  const mot = t.motivation || {};
  const director = getDirectorRecord(storage);
  const d = ensureDirectorDirection(director);
  const hooks = activeHooks(storage);
  const friction = d.friction || 'medium';
  const pace = d.pace || 'steady';
  const personality = d.personality || 'balanced';
  const connOn = conn.enabled !== false && conn.autoUpdate !== false;
  const secretsOn = mot.enabled !== false && mot.secretsSonar !== false;
  const slow = pace === 'glacial' || pace === 'slow';
  const calm = friction === 'low';
  const handsOff = personality === 'hands_off' || personality === 'reserved';
  const hardConn = conn.difficulty === 'hard';
  let minStandingAbs = 12;
  if (friction === 'hostile') minStandingAbs = 6;
  else if (friction === 'high') minStandingAbs = 8;
  else if (friction === 'low') minStandingAbs = 16;
  if (hardConn) minStandingAbs += 4;
  return {
    readings: connOn,
    rumors: connOn,
    secrets: secretsOn,
    hooks,
    friction,
    pace,
    personality,
    minStandingAbs,
    minTakeChars: slow || calm || handsOff ? 40 : 24,
    /** With active hooks, skip beats that never touch them unless the language is strong. */
    requireHookHit: hooks.length > 0,
    strict: slow || calm || handsOff,
  };
}

/**
 * Cheap gate: do not spend a filing gen hunting for a bubble on routine banter.
 */
export function cueTakeWorthFiling(scene, { storage, char } = {}) {
  const policy = cueTakePolicy(storage);
  if (!policy.readings && !policy.rumors && !policy.secrets) return false;
  const text = String(scene || '').trim();
  if (text.length < 40) return false;

  const assigned = speakerAssigned(policy.hooks, char?.id);
  const billed = isFoilOrHigher(char?.priority) || char?.priority === 'star';
  const extra = !billed && !assigned;
  const hookHit = hayHitsHook(text, policy.hooks);
  const strong = STRONG_TAKE_RE.test(text);
  const judgment = JUDGMENT_RE.test(text);

  if (extra && !strong && !hookHit) return false;

  if (policy.requireHookHit) {
    if (hookHit || strong) return true;
    if (assigned && judgment) return true;
    return false;
  }

  if (strong) return true;
  if (judgment && (billed || assigned) && !policy.strict) return true;
  if (judgment && billed && policy.strict && text.length >= 80) return true;
  return false;
}

export function buildCueTakePrompt({
  speaker,
  others = [],
  scene = '',
  storage = null,
  char = null,
} = {}) {
  const name = String(speaker || 'Cast').trim() || 'Cast';
  const stage = (others || []).length ? others.join(', ') : 'the Star';
  const policy = cueTakePolicy(storage);
  const channels = [
    policy.readings ? 'readings (private judgment of a billed person)' : null,
    policy.rumors ? 'rumors (something they would actually circulate)' : null,
    policy.secrets ? 'secrets (something they now hold that production would track)' : null,
  ].filter(Boolean).join('; ') || 'none — return file:false';

  let director = '';
  try {
    director = formatDirectorPromptBlock(storage, { includeHooks: true, includeNotes: true });
  } catch {
    director = '';
  }
  const hookLines = (policy.hooks || [])
    .map(h => `- ${h.name}${h.description ? ` — ${h.description}` : ''}${h.assignedTo && char?.id === h.assignedTo ? ' [this speaker]' : ''}`)
    .join('\n');

  return `Filing task. ${name} just played this beat. Extract NEW private takes ONLY if they are plot-significant.

Do NOT file: banter, flavor, wardrobe, small talk, mood, "I noticed their face," or a feeling that does not change standing or advance a hook.
If nothing meets that bar, return {"file":false,"readings":[],"rumors":[],"secrets":[]}.

Director brief:
${clipText(director || '(No Director — stay conservative.)', 1400)}

${hookLines ? `Active plot hooks (prefer takes that touch these):\n${hookLines}` : 'No active plot hooks — only file a confession, betrayal, cover-up, or a standing-changing judgment of billed cast.'}

Channels allowed: ${channels}

Beat:
${clipText(scene, 1800)}

Other people on stage: ${stage}

Return JSON only:
{"file":true,"readings":[{"name":"exact billed name or Star","take":"1-2 sentences of ${name}'s judgment","standing":null}],"rumors":[{"title":"short label","text":"what ${name} would circulate","about":"name or Star"}],"secrets":[{"title":"short label","description":"what ${name} now holds","about":"self or name"}]}
file is false when nothing is worth a Reputation / Motivation bubble.
standing is -100..100 or null. Empty arrays if a channel has nothing new. No markdown.`;
}

export const CUE_TAKE_SCHEMA = {
  name: 'cue_take',
  description: 'Plot-significant takes formed on a cued turn',
  strict: false,
  returnInvalid: true,
  value: {
    type: 'object',
    properties: {
      file: { type: 'boolean' },
      readings: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            take: { type: 'string' },
            standing: { type: ['number', 'null'] },
          },
        },
      },
      rumors: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            text: { type: 'string' },
            about: { type: 'string' },
          },
        },
      },
      secrets: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            description: { type: 'string' },
            about: { type: 'string' },
          },
        },
      },
    },
  },
};

function parseList(raw) {
  if (Array.isArray(raw)) return raw;
  return [];
}

function refused(parsed) {
  if (!parsed || typeof parsed !== 'object') return true;
  if (parsed.file === false || parsed.worth === false || parsed.significant === false) return true;
  return false;
}

/** Apply parsed takes. Returns counts of what was filed. */
export function applyCueTake(storage, char, raw) {
  const parsed = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : parseJsonObject(raw);
  if (!parsed || !char?.id || refused(parsed)) return { readings: 0, rumors: 0, secrets: 0 };
  const policy = cueTakePolicy(storage);
  const speakerName = String(char.name || 'Cast').trim();
  const star = getStarMember(storage);
  const billedSpeaker = isFoilOrHigher(char.priority) || char.priority === 'star'
    || speakerAssigned(policy.hooks, char.id);
  let readings = 0;
  let rumors = 0;
  let secrets = 0;

  try {
    const rep = storage.getChat('reputation', { personal: [], house: [] });
    rep.personal = Array.isArray(rep.personal) ? rep.personal : [];
    const from = billedSpeaker
      ? ensurePersonNode(rep, char.id, speakerName)
      : personNode(rep, char.id, speakerName);
    if (from && (policy.readings || policy.rumors)) {
      if (policy.readings) {
        for (const row of parseList(parsed.readings).slice(0, 6)) {
          const take = String(row?.take || row?.opinion || '').trim();
          if (!take) continue;
          const stand = clampStand(row?.standing);
          if (take.length < (policy.minTakeChars || 24)
            && (stand == null || Math.abs(stand) < (policy.minStandingAbs || 12))
            && !STRONG_TAKE_RE.test(take)
            && !JUDGMENT_RE.test(take)
            && !hayHitsHook(take, policy.hooks)) {
            continue;
          }
          const targetName = String(row?.name || row?.who || '').trim();
          const member = matchCast(storage, targetName);
          let to = null;
          const towardStar = !!(member?.star || member?.priority === 'star' || normName(targetName) === 'star'
            || (star && member?.id && member.id === star.id));
          if (towardStar) {
            to = selfNode(rep) || (star ? personNode(rep, star.id, star.name) || ensurePersonNode(rep, star.id, star.name || 'Star') : null);
          } else if (member) {
            to = personNode(rep, member.id, member.name) || ensurePersonNode(rep, member.id, member.name);
          } else {
            // Named extras do not mint a new bubble.
            to = personNode(rep, '', targetName);
          }
          if (!to || to.id === from.id) continue;
          upsertReading(from, to.id, { take: clipText(take, 400), standing: row.standing, aware: 'knows' });
          ensureLink(from, to);
          readings += 1;
        }
      }
      if (policy.rumors) {
        for (const row of parseList(parsed.rumors).slice(0, 4)) {
          const title = String(row?.title || row?.name || '').trim();
          const text = String(row?.text || row?.description || '').trim();
          if (!title && !text) continue;
          const blob = `${title} ${text}`;
          if (blob.trim().length < 24) continue;
          if (!STRONG_TAKE_RE.test(blob) && !JUDGMENT_RE.test(blob) && !hayHitsHook(blob, policy.hooks)) continue;
          const aboutName = String(row?.about || '').trim();
          const aboutMember = matchCast(storage, aboutName);
          const towardStar = !!(aboutMember?.star || aboutMember?.priority === 'star' || normName(aboutName) === 'star');
          const target = towardStar
            ? selfNode(rep)
            : (aboutMember
              ? (personNode(rep, aboutMember.id, aboutMember.name) || ensurePersonNode(rep, aboutMember.id, aboutMember.name))
              : (aboutName ? personNode(rep, '', aboutName) : null));
          const pos = orbit(rep.personal.length);
          const node = {
            id: uid(),
            kind: 'notice',
            auto: true,
            category: 'rumor',
            characterId: '',
            houseId: '',
            originId: from.id,
            targetId: target?.id || '',
            supporters: [{ characterId: char.id, role: 'Origin' }],
            name: title || clipText(text, 48) || 'Rumor',
            description: clipText(text || title, 400),
            notes: '',
            standing: 0,
            x: pos.x,
            y: pos.y,
            links: [from.id],
            readings: [],
          };
          rep.personal.push(node);
          ensureLink(from, node);
          if (target) ensureLink(node, target);
          rumors += 1;
        }
      }
      storage.saveChat();
    }
  } catch { /* reputation optional */ }

  try {
    if (policy.secrets && billedSpeaker) {
      const mot = storage.getChat('motivation', { perChar: {} });
      mot.perChar ??= {};
      mot.perChar[char.id] ??= { secrets: [], achievements: [], steps: [], interviews: [], auditAt: 0 };
      const cs = mot.perChar[char.id];
      cs.secrets = Array.isArray(cs.secrets) ? cs.secrets : [];
      for (const row of parseList(parsed.secrets).slice(0, 4)) {
        const title = String(row?.title || row?.name || '').trim();
        const description = String(row?.description || row?.text || '').trim();
        if (!title || title.length < 3) continue;
        if (description && description.length < 12 && !STRONG_TAKE_RE.test(title)) continue;
        const hit = cs.secrets.find(s => String(s.title || '').toLowerCase() === title.toLowerCase());
        if (hit) {
          if (description && !hit.description) hit.description = clipText(description, 400);
          setKnowerStance(hit, { type: 'cast', id: char.id }, 'knows');
          secrets += 1;
          continue;
        }
        const secret = {
          id: uid(),
          title,
          tier: 'notable',
          description: clipText(description, 400),
          knownBy: [],
          unawareBy: [],
          known: true,
          status: 'earned',
          sceneUid: '',
          fromCue: true,
        };
        setKnowerStance(secret, { type: 'cast', id: char.id }, 'knows');
        const about = matchCast(storage, row?.about);
        if (about?.id && about.id !== char.id) {
          setKnowerStance(secret, { type: 'cast', id: about.id }, 'unaware');
        }
        cs.secrets.push(secret);
        secrets += 1;
      }
      storage.saveChat();
    }
  } catch { /* motivation optional */ }

  return { readings, rumors, secrets };
}

function fakeTakeStorage({
  hooks = [],
  direction = {},
  trackers = null,
  extraCast = [],
} = {}) {
  return {
    getChat(id, d) {
      if (id === 'backstage') return { trackers: trackers || {} };
      if (id === 'cast') {
        return {
          characters: [
            {
              id: 'dir',
              name: 'Dir',
              priority: 'director',
              plotHooks: hooks,
              direction,
            },
            { id: 'a', name: 'Alice', priority: 'lead' },
            { id: 'b', name: 'Bob', priority: 'major' },
            ...extraCast,
          ],
        };
      }
      if (id === 'reputation') {
        return this.rep || (this.rep = {
          personal: [{ id: 'self', kind: 'self', name: 'You', category: 'individual', links: [], readings: [] }],
          house: [],
        });
      }
      if (id === 'motivation') return this.mot || (this.mot = { perChar: {} });
      return d && typeof d === 'object' ? structuredClone(d) : {};
    },
    saveChat() {},
  };
}

export function smokeCueTakePure() {
  const prompt = buildCueTakePrompt({ speaker: 'Alice', others: ['Bob'], scene: 'Alice glanced at Bob.' });
  if (!/Alice/.test(prompt) || !/"file"/.test(prompt) || !/plot-significant/.test(prompt)) return 'prompt';

  const banter = 'Alice glanced at Bob across the table and waited for him to speak.';
  if (cueTakeWorthFiling(banter, { storage: fakeTakeStorage(), char: { id: 'a', priority: 'lead' } })) {
    return 'banter-filed';
  }

  const hookStore = fakeTakeStorage({
    hooks: [{ name: 'Stolen ledger', description: 'Find who took the books', assignedTo: 'a', active: true }],
  });
  const hookBeat = 'Alice realized the stolen ledger was still in Bob\'s coat, and she would not tell him she knew.';
  if (!cueTakeWorthFiling(hookBeat, { storage: hookStore, char: { id: 'a', priority: 'lead' } })) {
    return 'hook-missed';
  }

  const confess = 'Alice admits she overheard the plan and cannot tell the Star without burning the alliance.';
  if (!cueTakeWorthFiling(confess, { storage: fakeTakeStorage(), char: { id: 'a', priority: 'lead' } })) {
    return 'strong-missed';
  }

  const off = fakeTakeStorage({
    trackers: { connection: { enabled: true, autoUpdate: false }, motivation: { enabled: true, secretsSonar: false } },
  });
  if (cueTakeWorthFiling(confess, { storage: off, char: { id: 'a', priority: 'lead' } })) {
    return 'toggles-ignored';
  }

  const fake = fakeTakeStorage();
  const refusedCounts = applyCueTake(fake, { id: 'a', name: 'Alice', priority: 'lead' }, {
    file: false,
    readings: [{ name: 'Bob', take: 'He is stalling.', standing: -10 }],
  });
  if (refusedCounts.readings) return 'file-false';

  const waiter = applyCueTake(fake, { id: 'a', name: 'Alice', priority: 'lead' }, {
    file: true,
    readings: [{ name: 'the waiter', take: 'He looks tired tonight and I noticed his shoes.', standing: 0 }],
  });
  if (waiter.readings) return 'waiter-bubble';

  const counts = applyCueTake(fake, { id: 'a', name: 'Alice', priority: 'lead' }, {
    file: true,
    readings: [{ name: 'Bob', take: 'He is stalling on the ledger, and I do not trust him.', standing: -10 }],
    rumors: [],
    secrets: [{ title: 'The stall', description: 'Bob is hiding something about the books.', about: 'Bob' }],
  });
  if (counts.readings !== 1 || counts.secrets !== 1) return `counts ${counts.readings}/${counts.secrets}`;
  return '';
}
