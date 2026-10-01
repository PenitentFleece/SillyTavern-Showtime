// When the Star is Absent, keep the user's persona/profile out of MAIN generations.
// Quiet gens are already pinned; skip those so we do not fight isolatedGen.

import { power_user } from '../../../../power-user.js';
import { persona_description_positions } from '../../../../personas.js';
import { eventSource, event_types } from '../../../../../script.js';
import { isStarAbsent } from './castCatalog.js';
import { isQuietPinActive } from './isolatedGen.js';

const PERSONA_IDS = new Set(['personaDescription', 'PERSONA_DESCRIPTION']);

let stash = null;
let pendingMain = false;
let bound = false;
let storageRef = null;

function applyStrip() {
  if (stash) return;
  stash = {
    position: power_user.persona_description_position,
    lorebook: power_user.persona_description_lorebook ?? '',
  };
  power_user.persona_description_position = persona_description_positions.NONE;
  power_user.persona_description_lorebook = '';
}

function restoreStrip() {
  if (!stash) return;
  power_user.persona_description_position = stash.position;
  power_user.persona_description_lorebook = stash.lorebook;
  stash = null;
}

function stripPersonaMessages(data) {
  if (!data || data.dryRun) return;
  if (Array.isArray(data.chat)) {
    data.chat = data.chat.filter(m => !PERSONA_IDS.has(m?.identifier));
  }
  if (Array.isArray(data.messages)) {
    data.messages = data.messages.filter(m => !PERSONA_IDS.has(m?.identifier));
  }
}

function finishMainStrip() {
  pendingMain = false;
  restoreStrip();
}

function onGenerationStarted(type, _opts, dryRun) {
  if (dryRun || type === 'quiet') return;
  if (!isStarAbsent(storageRef)) return;
  applyStrip();
  pendingMain = true;
}

function onPromptReady(data) {
  if (isQuietPinActive()) return;
  if (pendingMain) stripPersonaMessages(data);
  if (pendingMain) finishMainStrip();
}

function onGenerationDone() {
  if (isQuietPinActive()) return;
  finishMainStrip();
}

function onChatChanged() {
  pendingMain = false;
  restoreStrip();
}

/**
 * Bind once. `storage` is the live Showtime Storage instance.
 * @param {import('./storage.js').Storage} storage
 */
export function bindStarAbsentPersonaGate(storage) {
  storageRef = storage;
  if (bound) return;
  bound = true;
  eventSource.on(event_types.GENERATION_STARTED, onGenerationStarted);
  eventSource.on(event_types.GENERATION_ENDED, onGenerationDone);
  if (event_types.GENERATION_STOPPED) {
    eventSource.on(event_types.GENERATION_STOPPED, onGenerationDone);
  }
  eventSource.on(event_types.CHAT_CHANGED, onChatChanged);
  eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, onPromptReady);
  if (event_types.CHAT_COMPLETION_SETTINGS_READY) {
    eventSource.on(event_types.CHAT_COMPLETION_SETTINGS_READY, onPromptReady);
  }
  if (event_types.GENERATE_AFTER_COMBINE_PROMPTS) {
    eventSource.on(event_types.GENERATE_AFTER_COMBINE_PROMPTS, onPromptReady);
  }
}
