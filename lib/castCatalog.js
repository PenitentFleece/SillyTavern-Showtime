// Shared Cast catalog — other modules read priorities/members without importing Cast.

import { extension_settings } from '../../../../extensions.js';
import {
  pullEvolutiaDescription,
  pullEvolutiaPersona,
  resolveCardDescription,
  resolvePersonaDescription,
} from './aspectBridge.js';

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

  const linked = av
    ? records.filter(c => c.characterCardId && c.characterCardId === av)
    : [];

  // Prefer an explicit non-Director match by spoken name / alias among linked cards.
  if (linked.length) {
    const byName = spoken
      ? linked.find(c => c.priority !== 'director' && castNameMatches(c, spoken))
      : null;
    if (byName) return byName;

    const npcs = linked.filter(c => c.priority !== 'director');
    if (npcs.length === 1) return npcs[0];
    if (npcs.length > 1) {
      // Ambiguous shared card — fall through to Director reply-as if any.
    }

    const director = linked.find(c => c.priority === 'director');
    if (director?.replyAsId) {
      const target = records.find(c => c.id === director.replyAsId);
      if (target) return target;
    }
    // Single linked cast (even Director) with a custom name.
    if (linked.length === 1) return linked[0];
    if (npcs.length) return npcs[0];
  }

  // Director portraying someone without linking every NPC to the card.
  const director = records.find(c => c.priority === 'director');
  if (director && av && director.characterCardId === av && director.replyAsId) {
    return records.find(c => c.id === director.replyAsId) || null;
  }

  // Spoken name alone — only when no avatar to key off (rare / sendas without stamp).
  if (spoken && !av) {
    return findCastByNameOrAlias(storage, spoken, { includeDirector: false });
  }
  return null;
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
 * @param {import('./storage.js').Storage} storage
 * @returns {{ id: string, name: string, priority: string, portrait: *, characterCardId: *, personaId: * }[]}
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
  }));
}

/** Full cast character records from chat state. */
export function getCastRecords(storage) {
  if (!storage?.getChat) return [];
  return storage.getChat('cast', { characters: [] }).characters ?? [];
}

export function getCastRecord(storage, id) {
  if (!id) return null;
  return getCastRecords(storage).find(c => c.id === id) ?? null;
}

/** The unique {{user}} Star, if one has been cast. */
export function getStarMember(storage) {
  return getCastMembers(storage).find(c => c.priority === 'star') ?? null;
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
    return { id: '', name, description: '', assignedTo: '', active: true };
  }
  const name = String(raw.name || raw.text || raw.title || '').trim();
  if (!name) return null;
  return {
    id: String(raw.id || ''),
    name,
    description: String(raw.description || '').trim(),
    assignedTo: String(raw.assignedTo || raw.characterId || '').trim(),
    active: raw.active !== false,
  };
}

/** One-line hook for prompts: Name [Cast] — description. */
export function formatPlotHookLine(hook, storage) {
  const h = normalizePlotHook(hook);
  if (!h) return '';
  let who = '';
  if (h.assignedTo && storage) {
    const rec = getCastRecord(storage, h.assignedTo);
    who = rec?.name ? String(rec.name).trim() : '';
  }
  const head = who ? `${h.name} [${who}]` : h.name;
  return h.description ? `${head} — ${h.description}` : head;
}

export function normalizeDirectorDirection(raw = {}, legacy = {}) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = { ...DIRECTION_DEFAULTS };
  for (const key of Object.keys(DIRECTION_DEFAULTS)) {
    if (key === 'casualObscenity') {
      out.casualObscenity = !!(src.casualObscenity ?? out.casualObscenity);
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
  return bits.filter(Boolean);
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
    `Keywords: ${directorKeywords(storage, director).join('; ')}`,
  ];
  if (includeNotes && d.notes?.trim()) {
    lines.push(`Additional notes: ${String(d.notes).trim().slice(0, 800)}`);
  }
  if (includeHooks) {
    const hooks = (director.plotHooks ?? [])
      .map(h => normalizePlotHook(h))
      .filter(h => h && h.active !== false);
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
      block: `Character card${source.startsWith('director') ? ' (Director fallback)' : ''}${pull.alterEgoName ? ` · alter ego “${pull.alterEgoName}”` : ''}:\nName: ${linked.name}\n${fieldBlock || `Description: ${clip(description)}`}${!fieldBlock && linked.personality ? `\nPersonality: ${clip(linked.personality, 400)}` : ''}${!fieldBlock && linked.scenario ? `\nScenario: ${clip(linked.scenario, 300)}` : ''}`,
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
  return withPronouns({
    source: 'cast',
    fallback: false,
    name,
    displayName: name,
    description: char?.description ?? '',
    personality: '',
    scenario: '',
    avatar: null,
    alterEgoId: '',
    alterEgoName: '',
    fields: [],
    block: `Character: ${name}\nDescription: ${clip(char?.description)}`,
  });
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
    return {
      ...p,
      personal: p.custom.personal || 'they',
      possessive: p.custom.possessive || 'their',
      reflexive: p.custom.reflexive || 'themselves',
    };
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
  if (forms.preferred === 'custom' || (forms.personal && forms.possessive && forms.reflexive)) {
    bits.push(`preferred ${forms.personal}/${forms.possessive}/${forms.reflexive}${
      preferredLabel && forms.preferred !== 'custom' ? ` (${preferredLabel})` : ''
    }`);
  } else if (preferredLabel) {
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
