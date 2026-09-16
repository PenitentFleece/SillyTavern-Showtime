// Optional bridge to Aspect: Evolutia (st-aspect-evolutia).
// Reads dynamic/alter-ego fields for character cards and personas.

import { findExtension } from '../../../../extensions.js';
import { power_user } from '../../../../power-user.js';

/** Evolutia's persisted module key (legacy id inside character.data.extensions). */
export const EVOLUTIA_EXT_KEY = 'st-description-swap-fields';
export const EVOLUTIA_EXT_NAME = 'st-aspect-evolutia';

export function isAspectEvolutiaAvailable() {
  try {
    if (findExtension(EVOLUTIA_EXT_NAME)?.enabled === true) return true;
  } catch { /* ignore */ }
  return typeof globalThis.aspectEvolutiaGenerateInterceptor === 'function';
}

/** Character-card Evolutia blob. */
export function getCardEvolutiaState(character) {
  const state = character?.data?.extensions?.[EVOLUTIA_EXT_KEY];
  return state && typeof state === 'object' ? state : null;
}

/** Persona Evolutia blob: power_user[MODULE].personaDynamicFields[avatarId]. */
export function getPersonaEvolutiaState(personaId) {
  const key = String(personaId || '').trim();
  if (!key) return null;
  try {
    const root = power_user?.[EVOLUTIA_EXT_KEY];
    const map = root?.personaDynamicFields;
    if (!map || typeof map !== 'object') return null;
    const state = map[key] ?? map[key.toLowerCase?.()] ?? null;
    return state && typeof state === 'object' ? state : null;
  } catch {
    return null;
  }
}

export function listAlterEgos(state) {
  if (!state || typeof state !== 'object') return [];
  const egos = Array.isArray(state.alterEgos) ? state.alterEgos : [];
  return egos
    .map(e => ({
      id: String(e?.id || '').trim(),
      name: String(e?.name || e?.displayName || '').trim() || 'Alter Ego',
    }))
    .filter(e => e.id);
}

/**
 * Compose fields/text from an Evolutia state blob.
 * @param {object|null} state
 * @param {{ alterEgoId?: string, native?: string }} [opts]
 */
export function pullFromEvolutiaState(state, { alterEgoId = '', native = '' } = {}) {
  const empty = {
    available: false,
    swapEnabled: false,
    text: String(native || '').trim(),
    alterEgoId: '',
    alterEgoName: '',
    fields: [],
    alterEgos: [],
  };
  if (!isAspectEvolutiaAvailable()) {
    return { ...empty, text: String(native || '').trim() };
  }
  if (!state || typeof state !== 'object') {
    return { ...empty, available: true, text: String(native || '').trim() };
  }

  const alterEgos = listAlterEgos(state);
  const wanted = String(alterEgoId || '').trim();
  const activeId = wanted || String(state.activeAlterEgoId || '').trim();
  const ego = alterEgos.find(e => e.id === activeId)
    || (Array.isArray(state.alterEgos) ? state.alterEgos.find(e => e?.id === activeId) : null)
    || (Array.isArray(state.alterEgos) ? state.alterEgos[0] : null)
    || null;

  const rawFields = Array.isArray(ego?.fields)
    ? ego.fields
    : (Array.isArray(state.fields) ? state.fields : []);

  const fields = rawFields
    .filter(f => f && f.enabled !== false && String(f.content || '').trim())
    .map(f => ({
      id: String(f.id || '').trim(),
      name: String(f.name || '').trim(),
      content: String(f.content || '').trim(),
    }));

  const swapEnabled = !!state.swapEnabled;
  const composed = fields.map(f => (f.name ? `${f.name}\n${f.content}` : f.content)).join('\n\n').trim();
  const nativeText = String(native || '').trim();

  return {
    available: true,
    swapEnabled,
    alterEgoId: String(ego?.id || activeId || '').trim(),
    alterEgoName: String(ego?.name || '').trim(),
    alterEgos,
    fields,
    text: (swapEnabled && composed) ? composed : (composed || nativeText),
  };
}

/**
 * Compose a description snapshot from Evolutia's alter-ego fields on a character card.
 * @param {object|null} character ST character object
 * @param {{ alterEgoId?: string }} [opts]
 */
export function pullEvolutiaDescription(character, { alterEgoId = '' } = {}) {
  const native = String(character?.description || '').trim();
  if (!character) {
    return {
      available: false, swapEnabled: false, text: '', alterEgoId: '', alterEgoName: '',
      fields: [], alterEgos: [],
    };
  }
  if (!isAspectEvolutiaAvailable()) {
    return {
      available: false, swapEnabled: false, text: native, alterEgoId: '', alterEgoName: '',
      fields: [], alterEgos: [],
    };
  }
  return pullFromEvolutiaState(getCardEvolutiaState(character), { alterEgoId, native });
}

/**
 * Persona Evolutia fields (power_user store).
 * @param {string} personaId
 * @param {{ alterEgoId?: string, native?: string }} [opts]
 */
export function pullEvolutiaPersona(personaId, { alterEgoId = '', native = '' } = {}) {
  const nativeText = String(native || '').trim();
  if (!personaId) {
    return {
      available: false, swapEnabled: false, text: nativeText, alterEgoId: '', alterEgoName: '',
      fields: [], alterEgos: [],
    };
  }
  if (!isAspectEvolutiaAvailable()) {
    return {
      available: false, swapEnabled: false, text: nativeText, alterEgoId: '', alterEgoName: '',
      fields: [], alterEgos: [],
    };
  }
  return pullFromEvolutiaState(getPersonaEvolutiaState(personaId), { alterEgoId, native: nativeText });
}

/** Prefer Evolutia composition when available; else native description. */
export function resolveCardDescription(character, { preferEvolutia = true, alterEgoId = '' } = {}) {
  const native = String(character?.description || '').trim();
  if (!preferEvolutia || !isAspectEvolutiaAvailable()) return native;
  const pull = pullEvolutiaDescription(character, { alterEgoId });
  return pull.text || native;
}

export function resolvePersonaDescription(personaId, nativeDescription, {
  preferEvolutia = true,
  alterEgoId = '',
} = {}) {
  const native = String(nativeDescription || '').trim();
  if (!preferEvolutia || !isAspectEvolutiaAvailable()) return native;
  const pull = pullEvolutiaPersona(personaId, { alterEgoId, native });
  return pull.text || native;
}

/**
 * Resolve which alter ego a credit/tag needle should use for a cast member.
 * Prefers explicitly tagged egos (`taggedAlterEgos`), then any ego whose name matches.
 * @returns {{ alterEgoId: string, alterEgoName: string } | null}
 */
export function matchAlterEgoTag(char, needle) {
  const n = String(needle || '').trim().toLowerCase();
  if (!n || !char) return null;
  const tagged = new Set((char.taggedAlterEgos || []).map(id => String(id)));
  let pull = null;
  if (char.characterCardId) {
    // Lazy: caller may not have ST character — match against stored ego names on cast if present
    pull = char._evolutiaCache || null;
  }
  const egos = Array.isArray(char.alterEgoIndex) ? char.alterEgoIndex : (pull?.alterEgos || []);
  for (const ego of egos) {
    const id = String(ego.id || '').trim();
    const name = String(ego.name || '').trim().toLowerCase();
    if (!id || !name) continue;
    if (name !== n) continue;
    if (tagged.size && !tagged.has(id)) continue;
    return { alterEgoId: id, alterEgoName: ego.name };
  }
  // If nothing tagged, still allow exact ego-name match when list is known
  if (!tagged.size) {
    for (const ego of egos) {
      const name = String(ego.name || '').trim().toLowerCase();
      if (name === n) return { alterEgoId: ego.id, alterEgoName: ego.name };
    }
  }
  return null;
}
