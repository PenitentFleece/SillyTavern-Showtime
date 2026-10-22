// Shared Cast catalog — other modules read priorities/members without importing Cast.

import { extension_settings } from '../../../../extensions.js';
import {
  pullEvolutiaDescription,
  pullEvolutiaPersona,
  resolveCardDescription,
  resolvePersonaDescription,
} from './aspectBridge.js';
import { formatConditionsBlock } from './conditionCatalog.js';
import { creditedScenes, sceneLabel } from './scriptCatalog.js';
import { starKitFromInventory } from './itemLocator.js';
import { kitOwnedItems, pickPrimaryOutfit, formatOutfitLook } from './wardrobeOutfits.js';

/** Concrete hex defaults (color inputs can't use CSS vars). */
export const PRIORITY_DEFAULT_COLORS = Object.freeze({
  director: '#4a2c5a',
  star: '#e8c56b',
  lead: '#c9a24a',
  major: '#8a6a3d',
  supporting: '#5a4429',
  minor: '#a89577',
  foil: '#7a1f1f',
});

export const PRIORITIES = [
  { id: 'director',   label: 'Director',   order: -1, hasDetails: true,  color: PRIORITY_DEFAULT_COLORS.director },
  { id: 'star',       label: 'Star',       order:  0, hasDetails: true,  color: PRIORITY_DEFAULT_COLORS.star },
  { id: 'lead',       label: 'Lead',       order:  1, hasDetails: true,  color: PRIORITY_DEFAULT_COLORS.lead },
  { id: 'major',      label: 'Major',      order:  2, hasDetails: true,  color: PRIORITY_DEFAULT_COLORS.major },
  { id: 'minor',      label: 'Minor',      order:  3, hasDetails: false, color: PRIORITY_DEFAULT_COLORS.minor },
  { id: 'foil',       label: 'Foil',       order:  4, hasDetails: true,  color: PRIORITY_DEFAULT_COLORS.foil },
  { id: 'supporting', label: 'Supporting', order:  5, hasDetails: false, color: PRIORITY_DEFAULT_COLORS.supporting },
];

export const PRIORITY_MAP = Object.fromEntries(PRIORITIES.map(p => [p.id, p]));

/**
 * Billing tiers considered "foil or higher" for features that should only see
 * plot-relevant cast (Motivations) — star/lead/major/foil, never director,
 * minor, or supporting. Not a numeric-order comparison: `order` reflects
 * credits-list position (director, star, lead, major, minor, foil,
 * supporting), so foil (4) sits after minor (3) despite outranking it.
 */
export const FOIL_OR_HIGHER_PRIORITIES = Object.freeze(['star', 'lead', 'major', 'foil']);

/** True if a cast priority id is foil-tier or more central to the plot (excludes director/minor/supporting). */
export function isFoilOrHigher(priority) {
  return FOIL_OR_HIGHER_PRIORITIES.includes(String(priority || ''));
}

/** Director plot-hook kinds (parser accepts id, label, or emoji). */
export const PLOT_HOOK_KINDS = Object.freeze([
  { id: 'TASK', label: 'Task', emoji: '📋', aliases: ['task', '📋', '✅', '☑'] },
  { id: 'COMMITMENT', label: 'Commitment', emoji: '🤝', aliases: ['commitment', '🤝'] },
  { id: 'DEADLINE', label: 'Deadline', emoji: '⏰', aliases: ['deadline', '⏰', '📅'] },
  { id: 'THREAT', label: 'Threat', emoji: '⚠', aliases: ['threat', '⚠', '⚠️', '⚔️', '💀'] },
  { id: 'SOCIAL', label: 'Social', emoji: '💬', aliases: ['social', '💬', '👥'] },
  { id: 'OPPORTUNITY', label: 'Opportunity', emoji: '✨', aliases: ['opportunity', '✨', '💡', '🌟'] },
]);

export const PLOT_HOOK_KIND_IDS = Object.freeze(PLOT_HOOK_KINDS.map(k => k.id));
export const PLOT_HOOK_OUTCOMES = Object.freeze(['', 'resolved', 'failed']);

export function plotHookKindMeta(id) {
  const key = String(id || '').trim().toUpperCase();
  return PLOT_HOOK_KINDS.find(k => k.id === key) || PLOT_HOOK_KINDS[0];
}

export function normalizePlotHookKind(raw) {
  const s = String(raw || '').trim();
  if (!s) return 'TASK';
  const upper = s.toUpperCase();
  const hit = PLOT_HOOK_KINDS.find(k =>
    k.id === upper
    || k.label.toUpperCase() === upper
    || k.aliases.some(a => a === s || String(a).toUpperCase() === upper));
  return hit?.id || 'TASK';
}

export function normalizePlotHookOutcome(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (s === 'resolved' || s === 'failed') return s;
  return '';
}

function houseRoleColors() {
  if (!extension_settings.showtime) extension_settings.showtime = {};
  const root = extension_settings.showtime;
  if (!root.roleColors || typeof root.roleColors !== 'object') root.roleColors = {};
  return root.roleColors;
}

/** Merged role colors: defaults + Backstage Settings overrides. */
export function getRoleColors() {
  const over = houseRoleColors();
  const out = { ...PRIORITY_DEFAULT_COLORS };
  for (const id of Object.keys(PRIORITY_DEFAULT_COLORS)) {
    const v = String(over[id] || '').trim();
    if (/^#[0-9a-fA-F]{3,8}$/.test(v)) out[id] = v;
  }
  return out;
}

export function priorityColor(id) {
  const colors = getRoleColors();
  const key = PRIORITY_MAP[id] ? id : 'supporting';
  return colors[key] || PRIORITY_DEFAULT_COLORS[key] || PRIORITY_DEFAULT_COLORS.supporting;
}

/** Priority meta with live color from Settings. */
export function priorityMeta(id) {
  const base = PRIORITY_MAP[id] ?? PRIORITY_MAP.supporting;
  return { ...base, color: priorityColor(base.id) };
}

export function setRoleColor(id, hex) {
  if (!PRIORITY_DEFAULT_COLORS[id]) return;
  const over = houseRoleColors();
  const v = String(hex || '').trim();
  if (!/^#[0-9a-fA-F]{3,8}$/.test(v) || v.toLowerCase() === PRIORITY_DEFAULT_COLORS[id].toLowerCase()) {
    delete over[id];
  } else {
    over[id] = v;
  }
}

export function resetRoleColors() {
  const root = extension_settings.showtime || {};
  root.roleColors = {};
}

/** Push role colors onto :root as --st-role-* for CSS consumers. */
export function applyRoleColorVars(rootEl = document.documentElement) {
  if (!rootEl?.style) return;
  const colors = getRoleColors();
  for (const [id, hex] of Object.entries(colors)) {
    rootEl.style.setProperty(`--st-role-${id}`, hex);
  }
}

/** Unique trimmed keyring tags. Cast filters these to Compass building / unit / room names. */
export function normalizeKeyring(raw) {
  if (!raw) return [];
  const arr = Array.isArray(raw) ? raw : String(raw).split(',');
  const out = [];
  const seen = new Set();
  for (const t of arr) {
    const s = String(t || '').trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

/** Normalize alias list from CSV string or array. */
export function normalizeAliases(raw) {
  if (Array.isArray(raw)) {
    return [...new Set(raw.map(a => String(a || '').trim()).filter(Boolean))];
  }
  return String(raw || '')
    .split(/[,;\n]/)
    .map(a => a.trim())
    .filter(Boolean)
    .filter((a, i, arr) => arr.findIndex(b => b.toLowerCase() === a.toLowerCase()) === i);
}

/** True if needle matches cast primary name, alias, or a tagged alter-ego name. */
export function castNameMatches(char, needle) {
  const n = String(needle || '').trim().toLowerCase();
  if (!n || !char) return false;
  if (String(char.name || '').trim().toLowerCase() === n) return true;
  if (normalizeAliases(char.aliases).some(a => a.toLowerCase() === n)) return true;
  const tagged = new Set((char.taggedAlterEgos || []).map(String));
  for (const ego of (char.alterEgoIndex || [])) {
    const id = String(ego.id || '');
    const name = String(ego.name || '').trim().toLowerCase();
    if (!name || name !== n) continue;
    if (tagged.size && !tagged.has(id)) continue;
    return true;
  }
  return false;
}

/**
 * If needle matches a tagged alter ego on this cast member, return that ego id.
 * @returns {string}
 */
export function resolveAlterEgoIdForTag(char, needle) {
  const n = String(needle || '').trim().toLowerCase();
  if (!n || !char) return char?.alterEgoId || '';
  const tagged = new Set((char.taggedAlterEgos || []).map(String));
  for (const ego of (char.alterEgoIndex || [])) {
    const id = String(ego.id || '');
    const name = String(ego.name || '').trim().toLowerCase();
    if (!name || name !== n) continue;
    if (tagged.size && !tagged.has(id)) continue;
    return id;
  }
  return char?.alterEgoId || '';
}

/** Find cast record by primary name or alias. */
export function findCastByNameOrAlias(storage, needle, { includeDirector = false } = {}) {
  const n = String(needle || '').trim().toLowerCase();
  if (!n) return null;
  return getCastRecords(storage).find(c => {
    if (!includeDirector && c.priority === 'director') return false;
    return castNameMatches(c, n);
  }) ?? null;
}

/**
 * Resolve which cast member a chat message should display as,
 * given the speaker avatar (ST character.avatar / original_avatar).
 */
export function resolveChatSpeaker(storage, { avatar = '', spokenName = '' } = {}) {
  const records = getCastRecords(storage);
  if (!records.length) return null;
  const av = String(avatar || '').trim();
  const spoken = String(spokenName || '').trim();
  const director = records.find(c => c.priority === 'director');
  const directorCard = String(director?.characterCardId || '').trim();
  const onDirectorCard = Boolean(av && directorCard && av === directorCard);

  // Cued / sendas name on the Director's engine card — credit the named cast, not Teller.
  // Star stays the scene lead ({{user}}); never steal an AI turn as the Star.
  if (spoken) {
    const named = records.find(c =>
      c && c.priority !== 'director' && c.priority !== 'star' && castNameMatches(c, spoken));
    if (named && (!av || onDirectorCard || named.characterCardId === av)) return named;
  }

  const linked = av
    ? records.filter(c => c.characterCardId && c.characterCardId === av)
    : [];

  // Prefer an explicit non-Director match by spoken name / alias among linked cards.
  if (linked.length) {
    const byName = spoken
      ? linked.find(c => c.priority !== 'director' && castNameMatches(c, spoken))
      : null;
    if (byName) return byName;

    const npcs = linked.filter(c => c.priority !== 'director' && c.priority !== 'star');
    if (npcs.length === 1) return npcs[0];
    if (npcs.length > 1) {
      // Ambiguous shared card — fall through to Director reply-as if any.
    }

    const dirHit = linked.find(c => c.priority === 'director');
    if (dirHit?.replyAsId) {
      const target = records.find(c => c.id === dirHit.replyAsId);
      if (target) return target;
    }
    // Single linked cast (even Director) with a custom name.
    if (linked.length === 1) return linked[0];
    if (npcs.length) return npcs[0];
  }

  // Director portraying someone without linking every NPC to the card.
  if (director && av && director.characterCardId === av && director.replyAsId) {
    return records.find(c => c.id === director.replyAsId) || null;
  }

  // Spoken name alone — only when no avatar to key off (rare / sendas without stamp).
  if (spoken && !av) {
    return findCastByNameOrAlias(storage, spoken, { includeDirector: false });
  }
  return null;
}

export function smokeResolveChatSpeakerPure() {
  const bags = {
    cast: {
      characters: [
        { id: 'dir', name: 'Teller', priority: 'director', characterCardId: 'teller.png' },
        { id: 'star', name: 'Weslie', priority: 'star' },
        { id: 'oki', name: 'Mrs. Okisato', priority: 'major' },
      ],
    },
  };
  const storage = {
    getChat(id, d = {}) {
      return bags[id] || d;
    },
  };
  const hit = resolveChatSpeaker(storage, {
    avatar: 'teller.png',
    spokenName: 'Mrs. Okisato',
  });
  if (hit?.id !== 'oki') return `cue-on-director-card: ${hit?.id || 'null'}`;
  const teller = resolveChatSpeaker(storage, {
    avatar: 'teller.png',
    spokenName: 'Teller',
  });
  if (teller?.id !== 'dir') return `teller-stays: ${teller?.id || 'null'}`;
  const star = resolveChatSpeaker(storage, {
    avatar: 'teller.png',
    spokenName: 'Weslie',
  });
  if (star?.priority === 'star') return 'star-must-not-take-ai-turn';
  return '';
}

/** Preferred on-screen / credit name for a cast member. */
export function castDisplayName(char) {
  return String(char?.name || '').trim() || 'Unnamed';
}

/** Director production dials — personification & focus for prompts / audits / injections. */
export const DIRECTION_FIELDS = {
  genre: {
    label: 'Genre',
    options: [
      { id: 'literary', label: 'Literary' },
      { id: 'romance', label: 'Romance' },
      { id: 'erotica', label: 'Erotica' },
      { id: 'drama', label: 'Drama' },
      { id: 'comedy', label: 'Comedy' },
      { id: 'slice', label: 'Slice of life' },
      { id: 'thriller', label: 'Thriller' },
      { id: 'horror', label: 'Horror' },
      { id: 'mystery', label: 'Mystery' },
      { id: 'noir', label: 'Noir' },
      { id: 'fantasy', label: 'Fantasy' },
      { id: 'scifi', label: 'Sci-fi' },
      { id: 'urban_fantasy', label: 'Urban fantasy' },
      { id: 'adventure', label: 'Adventure' },
      { id: 'action', label: 'Action' },
      { id: 'historical', label: 'Historical' },
      { id: 'western', label: 'Western' },
      { id: 'cyberpunk', label: 'Cyberpunk' },
      { id: 'surreal', label: 'Surreal' },
      { id: 'other', label: 'Other / mixed' },
    ],
  },
  culture: {
    label: 'Culture / Setting',
    options: [
      { id: 'contemporary_west', label: 'Contemporary West' },
      { id: 'contemporary_east_asia', label: 'Contemporary East Asia' },
      { id: 'contemporary_global', label: 'Contemporary global' },
      { id: 'urban', label: 'Urban' },
      { id: 'rural', label: 'Rural / small town' },
      { id: 'campus', label: 'Campus / school' },
      { id: 'courtly', label: 'Courtly / aristocratic' },
      { id: 'frontier', label: 'Frontier' },
      { id: 'maritime', label: 'Maritime' },
      { id: 'underworld', label: 'Underworld / criminal' },
      { id: 'corporate', label: 'Corporate' },
      { id: 'religious', label: 'Religious / monastic' },
      { id: 'mythic', label: 'Mythic / legendary' },
      { id: 'post_apoc', label: 'Post-apocalyptic' },
      { id: 'other', label: 'Other / custom' },
    ],
  },
  era: {
    label: 'Era',
    options: [
      { id: 'prehistoric', label: 'Prehistoric' },
      { id: 'ancient', label: 'Ancient' },
      { id: 'medieval', label: 'Medieval' },
      { id: 'early_modern', label: 'Early modern' },
      { id: 'victorian', label: 'Victorian / Edwardian' },
      { id: 'interwar', label: 'Interwar' },
      { id: 'midcentury', label: 'Mid-century' },
      { id: 'late_20th', label: 'Late 20th century' },
      { id: 'present', label: 'Present day' },
      { id: 'near_future', label: 'Near future' },
      { id: 'far_future', label: 'Far future' },
      { id: 'timeless', label: 'Timeless / anachronistic' },
      { id: 'other', label: 'Other' },
    ],
  },
  narratorTone: {
    label: 'Narrator tone',
    options: [
      { id: 'intimate', label: 'Intimate' },
      { id: 'omniscient', label: 'Omniscient' },
      { id: 'clinical', label: 'Clinical' },
      { id: 'lyrical', label: 'Lyrical' },
      { id: 'deadpan', label: 'Deadpan' },
      { id: 'wry', label: 'Wry' },
      { id: 'gothic', label: 'Gothic' },
      { id: 'pulpy', label: 'Pulpy' },
      { id: 'documentary', label: 'Documentary' },
      { id: 'fairy', label: 'Fairy-tale' },
    ],
  },
  verbosity: {
    label: 'Verbosity',
    options: [
      { id: 'sparse', label: 'Sparse' },
      { id: 'tight', label: 'Tight' },
      { id: 'balanced', label: 'Balanced' },
      { id: 'lush', label: 'Lush' },
      { id: 'maximal', label: 'Maximal' },
    ],
  },
  personality: {
    label: 'Director personality',
    options: [
      { id: 'pushy', label: 'Pushy' },
      { id: 'assertive', label: 'Assertive' },
      { id: 'balanced', label: 'Balanced' },
      { id: 'reserved', label: 'Reserved' },
      { id: 'hands_off', label: 'Hands-off' },
    ],
  },
  difficulty: {
    label: 'Difficulty',
    options: [
      { id: 'easy', label: 'Easy' },
      { id: 'standard', label: 'Standard' },
      { id: 'hard', label: 'Hard' },
      { id: 'brutal', label: 'Brutal' },
    ],
  },
  friction: {
    label: 'Friction',
    options: [
      { id: 'low', label: 'Low — things tend to work out' },
      { id: 'medium', label: 'Medium — fair resistance' },
      { id: 'high', label: 'High — plans snag' },
      { id: 'hostile', label: 'Hostile — the world pushes back' },
    ],
  },
  pace: {
    label: 'Pace',
    options: [
      { id: 'glacial', label: 'Glacial' },
      { id: 'slow', label: 'Slow burn' },
      { id: 'steady', label: 'Steady' },
      { id: 'brisk', label: 'Brisk' },
      { id: 'breakneck', label: 'Breakneck' },
    ],
  },
  lupSeverity: {
    label: 'Punishment severity',
    options: [
      { id: 'mild', label: 'Mild — exposure, teasing, service tasks' },
      { id: 'moderate', label: 'Moderate — participation, discipline, onlookers' },
      { id: 'severe', label: 'Severe — sentences, harsh discipline, institutions' },
    ],
  },
  lupConsent: {
    label: 'Punishment consent',
    options: [
      { id: 'coerced', label: 'Coerced — submits under duress' },
      { id: 'resigned', label: 'Resigned — this is just how things are' },
      { id: 'embraced', label: 'Embraced — they prefer this outcome' },
      { id: 'varies', label: 'Varies — depends on the character' },
    ],
  },
};

const DIRECTION_DEFAULTS = {
  genre: 'drama',
  culture: 'contemporary_global',
  era: 'present',
  narratorTone: 'intimate',
  verbosity: 'balanced',
  personality: 'balanced',
  difficulty: 'standard',
  friction: 'medium',
  casualObscenity: false,
  lewdPunishment: false,
  lupSeverity: 'moderate',
  lupConsent: 'varies',
  pace: 'steady',
  notes: '',
};

export function priorityLabel(id) {
  return PRIORITY_MAP[id]?.label ?? id ?? '';
}

export function listPersonas(powerUser) {
  const names = powerUser?.personas ?? {};
  const descs = powerUser?.persona_descriptions ?? {};
  return Object.entries(names).map(([id, name]) => ({
    id,
    name: name || id,
    description: descs[id]?.description ?? '',
    title: descs[id]?.title ?? '',
  }));
}

function optionLabel(fieldId, valueId) {
  const field = DIRECTION_FIELDS[fieldId];
  return field?.options?.find(o => o.id === valueId)?.label || valueId || '';
}

/**
 * Star may be In play, Privy (remote / listening in), or Absent (never written out).
 * Everyone else defaults to inPlay (or privy / absent / writtenOut).
 * Absent Star drops their persona/profile/cast card from generation.
 */
export function normalizeCastPresence(char) {
  if (!char) return 'inPlay';
  const v = String(char.presence || 'inPlay');
  if (char.priority === 'star') {
    if (v === 'absent') return 'absent';
    if (v === 'privy') return 'privy';
    return 'inPlay';
  }
  return (v === 'privy' || v === 'absent' || v === 'writtenOut') ? v : 'inPlay';
}

/**
 * @param {import('./storage.js').Storage} storage
 * @returns {{ id: string, name: string, priority: string, portrait: *, characterCardId: *, personaId: *, presence: string }[]}
 */
export function getCastMembers(storage) {
  if (!storage?.getChat) return [];
  const state = storage.getChat('cast', { characters: [] });
  return (state.characters ?? []).map(c => ({
    id: c.id,
    name: c.name,
    aliases: normalizeAliases(c.aliases),
    priority: c.priority,
    portrait: c.portrait,
    characterCardId: c.characterCardId,
    personaId: c.personaId,
    replyAsId: c.replyAsId || '',
    presence: normalizeCastPresence(c),
    keyring: normalizeKeyring(c.keyring),
  }));
}

/** Full cast character records from chat state. */
export function getCastRecords(storage) {
  if (!storage?.getChat) return [];
  return storage.getChat('cast', { characters: [] }).characters ?? [];
}

/**
 * Cast active in the scene for receipts, injects, secrets, and pronouns.
 * Includes both physically present (`inPlay`) and remote/listening (`privy`)
 * unless `physicalOnly: true` is passed. Skips Director, Absent, and Written out.
 */
export function inPlayCastRecords(storage, { physicalOnly = false } = {}) {
  return getCastRecords(storage).filter((c) => {
    if (!c || c.priority === 'director') return false;
    const p = normalizeCastPresence(c);
    if (physicalOnly) return p === 'inPlay';
    return p === 'inPlay' || p === 'privy';
  });
}

/**
 * Decides whether a "Camera Focus" choice should be offered when the Star's
 * presence changes, and which other cast members it would affect.
 * Only fires when the Star is leaving an active scene: it was `inPlay` and is
 * moving to `absent`/`privy` while other (non-director, non-star) cast are
 * still `inPlay`/`privy`. Pure — takes plain character records, not storage.
 * @param {Array} characters
 * @param {{ id: string, priority: string }} star
 * @param {string} from
 * @param {string} next
 * @returns {{ shouldPrompt: boolean, others: Array }}
 */
export function planCameraFocusChoice(characters, star, from, next) {
  const noPrompt = { shouldPrompt: false, others: [] };
  if (!star || star.priority !== 'star') return noPrompt;
  if (from !== 'inPlay' || (next !== 'absent' && next !== 'privy')) return noPrompt;
  const others = (characters || []).filter((c) => {
    if (!c || c.id === star.id || c.priority === 'director' || c.priority === 'star') return false;
    const p = normalizeCastPresence(c);
    return p === 'inPlay' || p === 'privy';
  });
  return { shouldPrompt: others.length > 0, others };
}

/** Lightweight invariant checks for planCameraFocusChoice (no DOM). Returns '' on success. */
export function smokeCameraFocusChoicePure() {
  const star = { id: 'star', priority: 'star', presence: 'inPlay' };
  const director = { id: 'dir', priority: 'director', presence: 'inPlay' };
  const rin = { id: 'rin', priority: 'foil', presence: 'inPlay' };
  const kai = { id: 'kai', priority: 'foil', presence: 'privy' };
  const gone = { id: 'gone', priority: 'supporting', presence: 'absent' };
  const chars = [star, director, rin, kai, gone];

  const empty = planCameraFocusChoice([star, director, gone], star, 'inPlay', 'absent');
  if (empty.shouldPrompt) return 'should not prompt when no other cast are active';

  const active = planCameraFocusChoice(chars, star, 'inPlay', 'absent');
  if (!active.shouldPrompt) return 'should prompt when other cast are inPlay/privy';
  if (active.others.length !== 2 || !active.others.includes(rin) || !active.others.includes(kai)) {
    return 'should list exactly the other inPlay/privy cast, excluding director and already-absent cast';
  }

  if (planCameraFocusChoice(chars, star, 'privy', 'absent').shouldPrompt) {
    return 'should only prompt when the Star is actually leaving inPlay';
  }
  if (planCameraFocusChoice(chars, star, 'inPlay', 'writtenOut').shouldPrompt) {
    return 'should only prompt for a move to absent/privy, not other presence values';
  }
  if (planCameraFocusChoice(chars, rin, 'inPlay', 'absent').shouldPrompt) {
    return 'should never prompt for a non-star character';
  }
  return '';
}

/** Cast marked Privy (not physically in the room, but listening in / observing). */
export function privyCastRecords(storage) {
  return getCastRecords(storage).filter((c) => {
    if (!c || c.priority === 'director') return false;
    return normalizeCastPresence(c) === 'privy';
  });
}

export function getCastRecord(storage, id) {
  if (!id) return null;
  return getCastRecords(storage).find(c => c.id === id) ?? null;
}

/** The unique {{user}} Star, if one has been cast. */
export function getStarMember(storage) {
  return getCastMembers(storage).find(c => c.priority === 'star') ?? null;
}

/** True when the Star is marked Absent — persona/profile stay out of generation. */
export function isStarAbsent(storage) {
  return getStarMember(storage)?.presence === 'absent';
}

/** True when the Star is marked Privy — listening in / observing from outside the room. */
export function isStarPrivy(storage) {
  return getStarMember(storage)?.presence === 'privy';
}

/** Full Director character record, if cast. */
export function getDirectorRecord(storage) {
  return getCastRecords(storage).find(c => c.priority === 'director') ?? null;
}

/** Normalize a Director plot hook (legacy `{ text }` still reads). */
export function normalizePlotHook(raw) {
  if (raw == null) return null;
  if (typeof raw !== 'object') {
    const name = String(raw).trim();
    if (!name) return null;
    return {
      id: '', name, description: '', assignedTo: '', sceneUid: '', stepId: '',
      kind: 'TASK', deadline: '', outcome: '', active: true,
    };
  }
  const name = String(raw.name || raw.text || raw.title || '').trim();
  if (!name) return null;
  return {
    id: String(raw.id || ''),
    name,
    description: String(raw.description || '').trim(),
    assignedTo: String(raw.assignedTo || raw.characterId || '').trim(),
    sceneUid: String(raw.sceneUid || '').trim(),
    stepId: String(raw.stepId || '').trim(),
    kind: normalizePlotHookKind(raw.kind),
    deadline: String(raw.deadline || '').trim(),
    outcome: normalizePlotHookOutcome(raw.outcome),
    active: raw.active !== false,
  };
}

/** One-line hook for prompts: Kind Name [Cast] · deadline — description. */
export function formatPlotHookLine(hook, storage) {
  const h = normalizePlotHook(hook);
  if (!h) return '';
  let who = '';
  if (h.assignedTo && storage) {
    const rec = getCastRecord(storage, h.assignedTo);
    who = rec?.name ? String(rec.name).trim() : '';
  }
  const kind = plotHookKindMeta(h.kind);
  const kindBit = kind ? `${kind.emoji} ${kind.label}` : '';
  const head = who ? `${h.name} [${who}]` : h.name;
  const lead = [kindBit, head].filter(Boolean).join(' ');
  const when = h.deadline ? ` · ${h.deadline}` : '';
  return h.description ? `${lead}${when} — ${h.description}` : `${lead}${when}`;
}

export function normalizeDirectorDirection(raw = {}, legacy = {}) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = { ...DIRECTION_DEFAULTS };
  for (const key of Object.keys(DIRECTION_DEFAULTS)) {
    if (key === 'casualObscenity' || key === 'lewdPunishment') {
      out[key] = !!(src[key] ?? out[key]);
      continue;
    }
    if (key === 'lupSeverity' || key === 'lupConsent') {
      const val = String(src[key] || '').trim();
      const known = DIRECTION_FIELDS[key]?.options?.some(o => o.id === val);
      if (known) out[key] = val;
      continue;
    }
    if (key === 'notes') {
      out.notes = String(src.notes ?? legacy.notes ?? out.notes ?? '');
      continue;
    }
    const val = src[key];
    if (val != null && String(val).trim()) out[key] = String(val);
  }
  // Legacy Genre & Direction textarea → genre/notes bridge
  if (!src.genre && legacy.genreNotes) {
    const gn = String(legacy.genreNotes).trim();
    if (gn) {
      const hit = DIRECTION_FIELDS.genre.options.find(o =>
        gn.toLowerCase().includes(o.label.toLowerCase()) || gn.toLowerCase() === o.id);
      out.genre = hit?.id || 'other';
      if (!out.notes) out.notes = gn;
    }
  }
  if (!src.notes && legacy.condition) {
    out.notes = String(legacy.condition);
  }
  return out;
}

/** Ensure `char.direction` exists (mutates) and return it. */
export function ensureDirectorDirection(char) {
  if (!char) return normalizeDirectorDirection();
  char.direction = normalizeDirectorDirection(char.direction, {
    genreNotes: char.genreNotes,
    condition: char.condition,
    notes: char.direction?.notes,
  });
  return char.direction;
}

/** Compact keyword line for injections / keyword bags. */
export function directorKeywords(storage, char = null) {
  const director = char || getDirectorRecord(storage);
  if (!director) return [];
  const d = ensureDirectorDirection(director);
  const bits = [
    optionLabel('genre', d.genre),
    optionLabel('culture', d.culture),
    optionLabel('era', d.era),
    `tone:${optionLabel('narratorTone', d.narratorTone)}`,
    `verbosity:${optionLabel('verbosity', d.verbosity)}`,
    `director:${optionLabel('personality', d.personality)}`,
    `difficulty:${optionLabel('difficulty', d.difficulty)}`,
    `friction:${optionLabel('friction', d.friction)}`,
    `pace:${optionLabel('pace', d.pace)}`,
  ];
  if (d.casualObscenity) bits.push('casual obscenity', 'sex-positive public', 'porn-mode');
  if (d.lewdPunishment) {
    bits.push(
      'lewd punishment',
      'sexual discipline',
      `lup:${optionLabel('lupSeverity', d.lupSeverity)}`,
      `consent:${optionLabel('lupConsent', d.lupConsent)}`,
    );
  }
  return bits.filter(Boolean);
}

/** How the two Director sex dials combine. Punishment stays non-sexual unless LUP is on. */
export function formatLupFrame(d) {
  const sex = !!d?.casualObscenity;
  const lup = !!d?.lewdPunishment;
  if (!sex && !lup) return 'Sex is taboo and shameful. Punishment is non-sexual.';
  if (sex && !lup) return 'Sex is ordinary and not publicly shamed. Punishment stays non-sexual.';
  if (!sex && lup) return 'Sex stays taboo. Punishment is sexual: degrading and humiliating.';
  return 'Sex is ordinary, and sexual punishment is an institutionalized penalty.';
}

function formatLupBlock(d) {
  const frame = formatLupFrame(d);
  if (!d?.lewdPunishment) {
    return `Lewd and unusual punishment (sexual discipline as an ordinary penalty): OFF. ${frame}`;
  }
  const severity = optionLabel('lupSeverity', d.lupSeverity);
  const consent = optionLabel('lupConsent', d.lupConsent);
  return [
    `Lewd and unusual punishment (sexual discipline as an ordinary penalty): ON. ${frame}`,
    `Severity: ${severity}.`,
    `Consent frame: ${consent}. Commonplace in the setting, not necessarily wanted — a character may still find it unpleasant, humiliating, or unfair.`,
    'Sexual discipline is an accepted administrative, judicial, or social tool. Public sexual punishment carries no more stigma than a fine or community service. Authority figures may use corrective measures without moral conflict. Witnesses may be indifferent, curious, or approving rather than shocked.',
    'It can come up for a rule break, a debt, a lost wager, workplace or academic or social hierarchy, or a judicial sentence. Fit the penalty to the offense: a warning, exposure, sexual service as restitution, physical sexual discipline, or an ongoing sentence.',
  ].join('\n');
}

/** The four obscenity × LUP combinations, and a live block that names severity. */
export function smokeLupFramePure() {
  const off = formatLupFrame({ casualObscenity: false, lewdPunishment: false });
  if (!/non-sexual/i.test(off)) return 'both off should keep punishment non-sexual';
  const sex = formatLupFrame({ casualObscenity: true, lewdPunishment: false });
  if (!/ordinary/i.test(sex) || !/non-sexual/i.test(sex)) return 'obscenity alone should not sexualize punishment';
  const lup = formatLupFrame({ casualObscenity: false, lewdPunishment: true });
  if (!/taboo/i.test(lup) || !/sexual/i.test(lup)) return 'LUP alone should keep sex taboo and punishment sexual';
  const both = formatLupFrame({ casualObscenity: true, lewdPunishment: true });
  if (!/institutional/i.test(both)) return 'both on should institutionalize sexual punishment';
  const block = formatLupBlock({
    lewdPunishment: true,
    casualObscenity: true,
    lupSeverity: 'severe',
    lupConsent: 'coerced',
  });
  if (!/ON/.test(block) || !/Severe/i.test(block) || !/Coerced/i.test(block)) {
    return 'LUP block should name severity and consent';
  }
  if (!/OFF/.test(formatLupBlock({ lewdPunishment: false, casualObscenity: false }))) {
    return 'LUP off should say OFF';
  }
  return '';
}

/**
 * Full Director prompt block — use in ANY prompt involving the director
 * (events, audits, injections, generation briefs).
 */
export function formatDirectorPromptBlock(storage, {
  includeHooks = true,
  includeNotes = true,
  char = null,
} = {}) {
  const director = char || getDirectorRecord(storage);
  if (!director) return '(No Director cast — keep a light hand.)';
  const d = ensureDirectorDirection(director);
  const lines = [
    `Director: ${director.name || 'Director'}`,
    `Genre: ${optionLabel('genre', d.genre)}`,
    `Culture / Setting: ${optionLabel('culture', d.culture)}`,
    `Era: ${optionLabel('era', d.era)}`,
    `Narrator tone: ${optionLabel('narratorTone', d.narratorTone)}`,
    `Verbosity: ${optionLabel('verbosity', d.verbosity)}`,
    `Director personality: ${optionLabel('personality', d.personality)}`,
    `Difficulty: ${optionLabel('difficulty', d.difficulty)}`,
    `Friction: ${optionLabel('friction', d.friction)}`,
    `Pace: ${optionLabel('pace', d.pace)}`,
    `Casual obscenity (sex not publicly shamed; public intimacy / frank talk is ordinary): ${d.casualObscenity ? 'ON' : 'OFF'}`,
    formatLupBlock(d),
    `Keywords: ${directorKeywords(storage, director).join('; ')}`,
  ];
  if (includeNotes && d.notes?.trim()) {
    lines.push(`Additional notes: ${String(d.notes).trim().slice(0, 800)}`);
  }
  if (includeHooks) {
    const hooks = (director.plotHooks ?? [])
      .map(h => normalizePlotHook(h))
      .filter(h => h && h.active !== false && !h.outcome);
    if (hooks.length) {
      lines.push(`Active plot hooks:\n${hooks.map(h => `- ${formatPlotHookLine(h, storage)}`).join('\n')}`);
    }
  }
  if (director.description?.trim()) {
    lines.push(`Director card description: ${String(director.description).trim().slice(0, 600)}`);
  }
  return lines.join('\n');
}

/**
 * Resolve ST character card / persona for prompts.
 * If the cast role has neither, fall back to the Director's linked card/persona.
 *
 * @param {object|null} char full cast record
 * @param {object} opts
 * @param {object[]} [opts.characters] ST character list (ctx.characters)
 * @param {{id:string,name?:string,description?:string}[]} [opts.personas]
 */
export function resolveCastPromptIdentity(char, storage, {
  characters = [],
  personas = [],
  tagNeedle = '',
  descClip = 800,
  personalityClip = 400,
  scenarioClip = 300,
} = {}) {
  const clip = (s, n = 800) => {
    const t = String(s || '').trim();
    return t.length > n ? `${t.slice(0, n)}…` : t;
  };
  const egoId = resolveAlterEgoIdForTag(char, tagNeedle || char?.name) || char?.alterEgoId || '';

  const fromCard = (avatarId, source) => {
    if (!avatarId) return null;
    const linked = (characters || []).find(x => x.avatar === avatarId);
    if (!linked) return null;
    const pull = pullEvolutiaDescription(linked, { alterEgoId: egoId });
    const description = (char?.preferEvolutia !== false && pull.text)
      ? pull.text
      : resolveCardDescription(linked, { preferEvolutia: char?.preferEvolutia !== false, alterEgoId: egoId });
    const fieldBlock = pull.fields?.length
      ? pull.fields.map(f => `${f.name || 'Field'}: ${clip(f.content, 400)}`).join('\n')
      : '';
    return {
      source,
      fallback: source.startsWith('director'),
      name: linked.name,
      description,
      personality: linked.personality ?? '',
      scenario: linked.scenario ?? '',
      avatar: linked.avatar,
      alterEgoId: pull.alterEgoId || egoId,
      alterEgoName: pull.alterEgoName || '',
      fields: pull.fields || [],
      block: `Character card${source.startsWith('director') ? ' (Director fallback)' : ''}${pull.alterEgoName ? ` · alter ego “${pull.alterEgoName}”` : ''}:\nName: ${linked.name}\n${fieldBlock || `Description: ${clip(description, descClip)}`}${!fieldBlock && linked.personality ? `\nPersonality: ${clip(linked.personality, personalityClip)}` : ''}${!fieldBlock && linked.scenario ? `\nScenario: ${clip(linked.scenario, scenarioClip)}` : ''}`,
    };
  };

  const fromPersona = (personaId, source) => {
    if (!personaId) return null;
    const p = (personas || []).find(x => x.id === personaId);
    if (!p) return null;
    const native = p.description ?? '';
    const pull = pullEvolutiaPersona(personaId, { alterEgoId: egoId, native });
    const description = (char?.preferEvolutia !== false && pull.text)
      ? pull.text
      : resolvePersonaDescription(personaId, native, {
        preferEvolutia: char?.preferEvolutia !== false,
        alterEgoId: egoId,
      });
    const fieldBlock = pull.fields?.length
      ? pull.fields.map(f => `${f.name || 'Field'}: ${clip(f.content, 400)}`).join('\n')
      : `Description: ${clip(description)}`;
    return {
      source,
      fallback: source.startsWith('director'),
      name: p.name,
      description,
      personality: '',
      scenario: '',
      avatar: null,
      alterEgoId: pull.alterEgoId || egoId,
      alterEgoName: pull.alterEgoName || '',
      fields: pull.fields || [],
      block: `Persona${source.startsWith('director') ? ' (Director fallback)' : ''} ({{user}})${pull.alterEgoName ? ` · alter ego “${pull.alterEgoName}”` : ''}:\nName: ${p.name}\n${fieldBlock}`,
    };
  };

  const withPronouns = (hit) => {
    if (!hit) return hit;
    hit.block = appendPronounsToBlock(hit.block, char);
    const extra = formatManualCastBrief(char, storage, { includeSummary: hit.source === 'cast' });
    if (extra && hit.source !== 'cast') hit.block = `${hit.block}\n${extra}`;
    return hit;
  };

  if (char?.characterCardId) {
    const hit = fromCard(char.characterCardId, 'card');
    if (hit) {
      if (char.name?.trim()) hit.displayName = char.name;
      return withPronouns(hit);
    }
  }
  if (char?.personaId) {
    const hit = fromPersona(char.personaId, 'persona');
    if (hit) {
      if (char.name?.trim()) hit.displayName = char.name;
      return withPronouns(hit);
    }
  }

  const director = getDirectorRecord(storage);
  if (director && director.id !== char?.id) {
    const viaCard = fromCard(director.characterCardId, 'director-card');
    if (viaCard) {
      viaCard.displayName = char?.name || viaCard.name;
      viaCard.block = `${viaCard.block}\n(Cast role “${char?.name || 'unnamed'}” has no linked card — using Director’s character card.)`;
      return withPronouns(viaCard);
    }
    const viaPersona = fromPersona(director.personaId, 'director-persona');
    if (viaPersona) {
      viaPersona.displayName = char?.name || viaPersona.name;
      viaPersona.block = `${viaPersona.block}\n(Cast role “${char?.name || 'unnamed'}” has no linked persona — using Director’s persona.)`;
      return withPronouns(viaPersona);
    }
  }

  const name = char?.name || 'Unknown';
  const brief = formatManualCastBrief(char, storage, { includeSummary: true });
  return withPronouns({
    source: 'cast',
    fallback: false,
    name,
    displayName: name,
    description: char?.summary || char?.description || '',
    personality: '',
    scenario: '',
    avatar: null,
    alterEgoId: '',
    alterEgoName: '',
    fields: [],
    block: `Character: ${name}${brief ? `\n${brief}` : ''}`,
  });
}

/**
 * Manual-cast extras for prompts: appearance, Reputation affiliation, short summary.
 * Linked cards already carry their own bio — pass includeSummary:false there.
 */
export function formatManualCastBrief(char, storage, { includeSummary = true } = {}) {
  const clip = (s, n = 400) => {
    const t = String(s || '').trim();
    return t.length > n ? `${t.slice(0, n)}…` : t;
  };
  const lines = [];
  const appearance = String(char?.appearance || '').trim();
  if (appearance) lines.push(`Appearance: ${clip(appearance)}`);
  const houseId = String(char?.affiliationHouseId || '').trim();
  if (houseId && storage?.getChat) {
    try {
      const house = (storage.getChat('reputation', { house: [] }).house || [])
        .find(h => h && h.id === houseId);
      if (house?.name) {
        const label = house.alias ? `${house.name} (${house.alias})` : house.name;
        lines.push(`Affiliation: ${label}`);
      }
    } catch { /* ignore */ }
  }
  if (includeSummary) {
    const summary = String(char?.summary || char?.description || '').trim();
    if (summary) lines.push(`Summary: ${clip(summary, 600)}`);
  }
  const fx = formatConditionsBlock(char?.conditions, { max: 6 });
  if (fx.length) lines.push(`Condition: ${fx.join('; ')}`);
  return lines.join('\n');
}

const DOSSIER_BUDGET = 3500;

function clipDossier(s, n) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  return t.length > n ? `${t.slice(0, Math.max(1, n - 1)).trimEnd()}…` : t;
}

function dossierReadingText(rec) {
  const intro = rec?.intro || 'none';
  const history = String(rec?.history || (intro === 'pre' ? rec?.description : '') || '').trim();
  const baseline = String(rec?.baseline || (intro !== 'pre' ? rec?.description : '') || '').trim();
  return { intro, history, baseline, take: String(rec?.take || '').trim() };
}

/**
 * Hidden Showtime dossier — compiled when a prompt is built, never stored.
 * Cast identity, Connections readings, Motivation, and credited Script scenes.
 * @param {object} storage
 * @param {object|null} char
 * @param {{ characters?: object[], personas?: object[], focusName?: string, includeIdentity?: boolean, maxChars?: number }} [opts]
 */
export function buildCharacterDossier(storage, char, {
  characters = [],
  personas = [],
  focusName = '',
  includeIdentity = true,
  maxChars = DOSSIER_BUDGET,
  omitScenes = false,
} = {}) {
  if (!char || !storage?.getChat) return '';
  const budget = Math.max(400, Number(maxChars) || DOSSIER_BUDGET);
  const identity = includeIdentity
    ? resolveCastPromptIdentity(char, storage, {
      characters,
      personas,
      descClip: 1400,
      personalityClip: 500,
      scenarioClip: 400,
    })
    : null;
  const head = [];
  if (identity?.block) head.push(identity.block);
  else if (char.name) head.push(String(char.name));

  let wardrobe = Array.isArray(char.wardrobe) ? char.wardrobe : [];
  let props = Array.isArray(char.props) ? char.props : [];
  if (char.priority === 'star') {
    try {
      const inv = storage.getChat('inventory', { static: [], mobile: [] });
      const kit = starKitFromInventory(inv, { ownerId: char.id });
      wardrobe = kit?.wardrobe || [];
      props = kit?.props || [];
    } catch { /* keep cast lists */ }
  }
  try {
    const owned = kitOwnedItems(wardrobe, props);
    const look = formatOutfitLook(pickPrimaryOutfit(char.outfits, wardrobe, owned), { compact: true });
    if (look) head.push(`Wardrobe: ${look}`);
    else if (wardrobe.length) {
      head.push(`Wardrobe: ${wardrobe.map(w => w?.name).filter(Boolean).slice(0, 8).join(', ')}`);
    }
  } catch {
    if (wardrobe.length) {
      head.push(`Wardrobe: ${wardrobe.map(w => w?.name).filter(Boolean).slice(0, 8).join(', ')}`);
    }
  }
  if (props.length) {
    head.push(`Props: ${props.map(p => p?.name).filter(Boolean).slice(0, 8).join(', ')}`);
  }
  const life = [];

  try {
    const rep = storage.getChat('reputation', { personal: [] });
    const nodes = Array.isArray(rep?.personal) ? rep.personal : [];
    const self = nodes.find(n => n?.characterId === char.id)
      || (char.priority === 'star' ? nodes.find(n => n?.kind === 'self' || n?.id === 'self') : null)
      || nodes.find(n => String(n?.name || '').trim().toLowerCase() === String(char.name || '').trim().toLowerCase());
    const focus = String(focusName || '').trim().toLowerCase();
    const linked = new Set(self?.links || []);
    const rows = [];
    for (const rec of self?.readings || []) {
      const other = nodes.find(n => n?.id === rec?.targetId);
      if (!other || other.id === self.id) continue;
      const name = String(other.name || '').trim() || 'someone';
      const fields = dossierReadingText(rec);
      const bits = [];
      if (fields.intro === 'pre') bits.push('You already knew each other before this story.');
      else if (String(fields.intro).startsWith('scene:')) {
        const lab = sceneLabel(storage, fields.intro.slice(6));
        if (lab) bits.push(`You met in ${lab}.`);
      }
      if (fields.history) bits.push(clipDossier(fields.history, 180));
      if (fields.baseline) bits.push(clipDossier(fields.baseline, 140));
      if (fields.take) bits.push(clipDossier(fields.take, 140));
      if (!bits.length) continue;
      const nm = name.toLowerCase();
      const focused = focus && (nm.includes(focus) || focus.includes(nm));
      rows.push({
        score: (focused ? 100 : 0) + (linked.has(other.id) ? 8 : 0) + (fields.take ? 2 : 0),
        line: `${name}: ${bits.join(' ')}`,
      });
    }
    rows.sort((a, b) => b.score - a.score);
    if (rows.length) {
      life.push(`People you know:\n${rows.slice(0, 12).map(r => `- ${r.line}`).join('\n')}`);
    }
  } catch { /* ignore */ }

  try {
    const row = storage.getChat('motivation', { perChar: {} })?.perChar?.[char.id];
    const itemLine = (item) => {
      const title = String(item?.title || '').trim();
      if (!title) return '';
      const body = clipDossier(item?.description || item?.text || '', 120);
      return body ? `${title}: ${body}` : title;
    };
    const achievements = (row?.achievements || []).map(itemLine).filter(Boolean).slice(0, 6);
    const secrets = (row?.secrets || []).map(itemLine).filter(Boolean).slice(0, 6);
    const steps = (row?.steps || [])
      .filter(step => step && !step.failed && !step.unlocked)
      .map(itemLine)
      .filter(Boolean)
      .slice(0, 6);
    if (achievements.length) life.push(`Things you've done:\n${achievements.map(l => `- ${l}`).join('\n')}`);
    if (secrets.length) life.push(`Things you keep quiet:\n${secrets.map(l => `- ${l}`).join('\n')}`);
    if (steps.length) life.push(`What you want:\n${steps.map(l => `- ${l}`).join('\n')}`);
  } catch { /* ignore */ }

  if (!omitScenes) {
    try {
      const scenes = creditedScenes(storage, char.id, char.name).slice(0, 8);
      const lines = [];
      for (const scene of scenes) {
        const card = scene?.card || {};
        const body = clipDossier(card.summary || card.content || '', 180);
        const title = String(scene.title || card.title || '').trim();
        if (!title && !body) continue;
        lines.push(`- ${title || 'Something that happened'}${body ? ` — ${body}` : ''}`);
      }
      if (lines.length) life.push(`What you lived through:\n${lines.join('\n')}`);
    } catch { /* ignore */ }
  }

  return packDossier(head, life, budget);
}

function packDossier(headParts, lifeParts, budget) {
  const clipBlock = (s, n) => {
    const t = String(s || '');
    if (!t || t.length <= n) return t;
    return `${t.slice(0, Math.max(1, n - 1)).trimEnd()}…`;
  };
  const headText = headParts.filter(Boolean).join('\n\n');
  const lifeText = lifeParts.filter(Boolean).join('\n\n');
  const gap = headText && lifeText ? 2 : 0;
  if (headText.length + lifeText.length + gap <= budget) {
    return [headText, lifeText].filter(Boolean).join('\n\n');
  }
  const lifeKeep = lifeText
    ? Math.min(lifeText.length, Math.max(Math.min(900, budget - 200), Math.floor(budget * 0.55)))
    : 0;
  const headKeep = Math.max(0, budget - lifeKeep - gap);
  return [clipBlock(headText, headKeep), clipBlock(lifeText, lifeKeep)].filter(Boolean).join('\n\n');
}

const INTERVIEW_CARD_CAP = 8000;
const INTERVIEW_DESK_BUDGET = 4000;

function interviewLifeDossier(storage, char, { characters = [], personas = [], focusName = '' } = {}) {
  return buildCharacterDossier(storage, char, {
    characters,
    personas,
    focusName,
    includeIdentity: false,
    omitScenes: true,
    maxChars: 20000,
  });
}

/** Keep the name, description, and personality. Drop example dialogue, then scenario. */
function fitInterviewVoice(kept, droppable, cap = INTERVIEW_CARD_CAP) {
  const body = (extra) => [...kept, ...extra].filter(Boolean).join('\n');
  let extra = droppable.filter(Boolean);
  while (extra.length && body(extra).length > cap) extra.pop();
  return body(extra);
}

/**
 * Desk ceiling. A reading or beat that does not fit is left out whole.
 * @param {string|string[]} parts
 */
export function fitInterviewDesk(parts, budget = INTERVIEW_DESK_BUDGET) {
  const text = (Array.isArray(parts) ? parts : [parts])
    .map(part => String(part || '').trim())
    .filter(Boolean)
    .join('\n\n');
  if (!text) return '';
  const chunks = [];
  for (const section of text.split(/\n\n/)) {
    const lines = section.split('\n').map(line => line.trimEnd()).filter(line => line.trim());
    if (!lines.length) continue;
    const header = lines.filter(line => !line.trim().startsWith('- '));
    const bullets = lines.filter(line => line.trim().startsWith('- '));
    if (bullets.length) {
      if (header.length) chunks.push(header.join('\n'));
      for (const bullet of bullets) chunks.push(bullet);
    } else {
      chunks.push(lines.join('\n'));
    }
  }
  const kept = [];
  let size = 0;
  for (const chunk of chunks) {
    const gap = kept.length ? 1 : 0;
    if (size + gap + chunk.length > budget) continue;
    kept.push(chunk);
    size += gap + chunk.length;
  }
  return kept.join('\n');
}

function ownInterviewCardText(char, linked) {
  const egoId = resolveAlterEgoIdForTag(char, char?.name) || char?.alterEgoId || '';
  const pull = pullEvolutiaDescription(linked, { alterEgoId: egoId });
  const description = (char?.preferEvolutia !== false && pull.text)
    ? pull.text
    : resolveCardDescription(linked, {
      preferEvolutia: char?.preferEvolutia !== false,
      alterEgoId: egoId,
    });
  const name = String(char?.name || linked?.name || '').trim() || 'Unnamed';
  const kept = [`Name: ${name}`];
  if (pull.alterEgoName) kept.push(`Alter ego: ${pull.alterEgoName}`);
  if (pull.fields?.length) {
    for (const field of pull.fields) {
      const body = String(field?.content || '').trim();
      if (body) kept.push(`${field.name || 'Field'}: ${body}`);
    }
  } else if (description) {
    kept.push(`Description: ${description}`);
  }
  const personality = String(linked?.personality || '').trim();
  if (personality) kept.push(`Personality: ${personality}`);
  const droppable = [];
  const scenario = String(linked?.scenario || '').trim();
  const examples = String(linked?.mes_example || '').trim();
  if (scenario) droppable.push(`Scenario: ${scenario}`);
  if (examples) droppable.push(`Example dialogue:\n${examples}`);
  return appendPronounsToBlock(fitInterviewVoice(kept, droppable), char);
}

function compiledInterviewCardText(char, storage) {
  const name = String(char?.name || '').trim() || 'Unnamed';
  const brief = formatManualCastBrief(char, storage, { includeSummary: true });
  const lines = [`Name: ${name}`, ...String(brief || '').split('\n').map(line => line.trim()).filter(Boolean)];
  const withPronouns = (body) => appendPronounsToBlock(body, char);
  while (lines.length > 1 && withPronouns(lines.join('\n')).length > INTERVIEW_CARD_CAP) lines.pop();
  return withPronouns(lines.join('\n'));
}

/**
 * Voice and desk for a private interview. They do not share a character budget.
 * An assigned card that is not the Director's engine card is the voice.
 * No card, a missing card, or the Director card itself becomes a compiled brief.
 * A persona link is not a character card.
 * @returns {{ kind: 'card'|'compiled', text: string, desk: string }}
 */
export function resolveInterviewCard(storage, char, {
  characters = [],
  personas = [],
  focusName = '',
} = {}) {
  if (!char) return { kind: 'compiled', text: '', desk: '' };
  const directorId = String(getDirectorRecord(storage)?.characterCardId || '').trim();
  const ownId = String(char.characterCardId || '').trim();
  const linked = ownId && ownId !== directorId
    ? (characters || []).find(row => row && row.avatar === ownId) || null
    : null;
  const life = interviewLifeDossier(storage, char, { characters, personas, focusName });
  const text = linked
    ? ownInterviewCardText(char, linked)
    : compiledInterviewCardText(char, storage);
  return { kind: linked ? 'card' : 'compiled', text, desk: fitInterviewDesk(life) };
}

/** Own card, no card, and Director-card cast each pick the interview voice. */
export function smokeInterviewCardPure() {
  const directorDesc = 'DIRECTOR-CARD-VOICE-TELLER-ONLY';
  const ownDesc = 'OWN-CARD-OKISATO-BIO';
  const summary = 'COMPILED-CAST-SUMMARY';
  const characters = [
    { avatar: 'teller.png', name: 'Teller', description: directorDesc, personality: 'narrates', scenario: 'the desk' },
    { avatar: 'oki.png', name: 'Mrs. Okisato', description: ownDesc, personality: 'polite', scenario: 'antiques', mes_example: 'Hello dear.' },
  ];
  const cast = [
    { id: 'dir', name: 'Teller', priority: 'director', characterCardId: 'teller.png', description: directorDesc },
    { id: 'own', name: 'Mrs. Okisato', priority: 'major', characterCardId: 'oki.png', summary: 'not-the-voice' },
    { id: 'none', name: 'Hawks', priority: 'minor', characterCardId: '', personaId: 'persona-1', summary },
    { id: 'played', name: 'Yokumiru', priority: 'supporting', characterCardId: 'teller.png', summary },
  ];
  const storage = {
    getChat(id, fallback = {}) {
      if (id === 'cast') return { characters: cast };
      return fallback;
    },
  };
  const own = resolveInterviewCard(storage, cast[1], { characters });
  if (own.kind !== 'card') return 'own card should use the assigned card';
  if (!own.text.includes(ownDesc)) return 'own card text missing';
  if (!own.text.includes('Hello dear.')) return 'own card dropped example dialogue that fits';
  if (own.text.includes(directorDesc)) return 'own card included the director description';
  if (typeof own.desk !== 'string') return 'own card missing a desk block';

  const savedExample = characters[1].mes_example;
  const savedScenario = characters[1].scenario;
  characters[1].mes_example = `EXAMPLE-TAIL-${'line '.repeat(2000)}`;
  characters[1].scenario = `SCENARIO-TAIL-${'y'.repeat(9000)}`;
  const trimmed = resolveInterviewCard(storage, cast[1], { characters });
  characters[1].mes_example = savedExample;
  characters[1].scenario = savedScenario;
  if (!trimmed.text.includes(ownDesc)) return 'card trim cut the description';
  if (trimmed.text.includes('EXAMPLE-TAIL-')) return 'card trim kept example dialogue';
  if (trimmed.text.includes('SCENARIO-TAIL-')) return 'card trim kept scenario ahead of the description';

  const desk = fitInterviewDesk([
    'Keep me.',
    `- ${'x'.repeat(5000)}`,
    '- small reading stays whole',
  ]);
  if (!desk.includes('Keep me.')) return 'desk dropped a short reading';
  if (desk.includes('xxxxx')) return 'desk sliced a long reading';
  if (!desk.includes('small reading stays whole')) return 'desk dropped a later whole reading';
  if (desk.length > INTERVIEW_DESK_BUDGET) return 'desk ran past its ceiling';

  const none = resolveInterviewCard(storage, cast[2], { characters });
  if (none.kind !== 'compiled') return 'missing card should compile';
  if (!none.text.includes(summary)) return 'compiled card missing summary';
  if (none.text.includes(directorDesc)) return 'compiled card included the director description';

  const played = resolveInterviewCard(storage, cast[3], { characters });
  if (played.kind !== 'compiled') return 'director-card cast should compile';
  if (!played.text.includes(summary)) return 'director-played card missing summary';
  if (played.text.includes(directorDesc)) return 'director-played card used the director description';
  return '';
}

/** Apparent / preferred presentation options for cast pronouns. */
export const PRONOUN_APPARENT_OPTIONS = Object.freeze([
  { id: 'masculine', label: 'Masculine' },
  { id: 'feminine', label: 'Feminine' },
  { id: 'androgynous', label: 'Androgynous' },
]);

export const PRONOUN_PREFERRED_OPTIONS = Object.freeze([
  ...PRONOUN_APPARENT_OPTIONS,
  { id: 'custom', label: 'Custom' },
]);

const PRONOUN_PRESETS = Object.freeze({
  masculine: { personal: 'he', possessive: 'his', reflexive: 'himself' },
  feminine: { personal: 'she', possessive: 'her', reflexive: 'herself' },
  androgynous: { personal: 'they', possessive: 'their', reflexive: 'themselves' },
});

function _cleanPronounToken(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Normalize pronouns blob on a cast record. */
export function normalizePronouns(raw = {}) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const apparentIds = new Set(PRONOUN_APPARENT_OPTIONS.map(o => o.id));
  const preferredIds = new Set(PRONOUN_PREFERRED_OPTIONS.map(o => o.id));
  const apparent = apparentIds.has(src.apparent) ? src.apparent : '';
  const preferred = preferredIds.has(src.preferred) ? src.preferred : '';
  const customSrc = src.custom && typeof src.custom === 'object' ? src.custom : {};
  return {
    apparent,
    preferred,
    custom: {
      personal: _cleanPronounToken(customSrc.personal || src.personal),
      possessive: _cleanPronounToken(customSrc.possessive || src.possessive),
      reflexive: _cleanPronounToken(customSrc.reflexive || src.reflexive),
    },
  };
}

/** Resolve personal / possessive / reflexive forms from preferred (+ custom). */
export function resolvePronounForms(raw) {
  const p = normalizePronouns(raw);
  if (p.preferred === 'custom') {
    const personal = p.custom.personal;
    const possessive = p.custom.possessive;
    const reflexive = p.custom.reflexive;
    if (!personal || !possessive || !reflexive) {
      return { ...p, personal: '', possessive: '', reflexive: '' };
    }
    return { ...p, personal, possessive, reflexive };
  }
  const preset = PRONOUN_PRESETS[p.preferred] || null;
  if (!preset) {
    return {
      ...p,
      personal: '',
      possessive: '',
      reflexive: '',
    };
  }
  return { ...p, ...preset };
}

/**
 * One-line prompt block for a cast member's pronouns, or '' if unset.
 * @param {object|null} char
 */
export function formatPronounsPromptLine(char) {
  const forms = resolvePronounForms(char?.pronouns);
  if (!forms.apparent && !forms.preferred) return '';
  const apparentLabel = PRONOUN_APPARENT_OPTIONS.find(o => o.id === forms.apparent)?.label || '';
  const preferredLabel = PRONOUN_PREFERRED_OPTIONS.find(o => o.id === forms.preferred)?.label || '';
  const bits = [];
  if (apparentLabel) bits.push(`apparent ${apparentLabel}`);
  if (forms.personal && forms.possessive && forms.reflexive) {
    bits.push(`preferred ${forms.personal}/${forms.possessive}/${forms.reflexive}${
      preferredLabel && forms.preferred !== 'custom' ? ` (${preferredLabel})` : ''
    }`);
  } else if (preferredLabel && forms.preferred !== 'custom') {
    bits.push(`preferred ${preferredLabel}`);
  }
  if (!bits.length) return '';
  const name = String(char?.name || '').trim();
  return name ? `${name}: ${bits.join('; ')}` : bits.join('; ');
}

/** Append pronouns onto an identity prompt block. */
export function appendPronounsToBlock(block, char) {
  const line = formatPronounsPromptLine(char);
  if (!line) return String(block || '');
  // formatPronounsPromptLine includes the name — strip for card blocks that already name them.
  const forms = resolvePronounForms(char?.pronouns);
  const apparentLabel = PRONOUN_APPARENT_OPTIONS.find(o => o.id === forms.apparent)?.label || '';
  const preferredLabel = PRONOUN_PREFERRED_OPTIONS.find(o => o.id === forms.preferred)?.label || '';
  const detail = [];
  if (apparentLabel) detail.push(`Apparent: ${apparentLabel}`);
  if (forms.personal && forms.possessive && forms.reflexive) {
    detail.push(`Preferred: ${forms.personal}/${forms.possessive}/${forms.reflexive}${
      preferredLabel && forms.preferred !== 'custom' ? ` (${preferredLabel})` : forms.preferred === 'custom' ? ' (Custom)' : ''
    }`);
  } else if (preferredLabel) {
    detail.push(`Preferred: ${preferredLabel}`);
  }
  if (!detail.length) return String(block || '');
  return `${String(block || '').trim()}\nPronouns: ${detail.join('. ')}.`;
}
