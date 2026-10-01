// Director plot hooks ↔ Motivation beats.
// A hook lands on the assigned character's board once it has a Script scene
// and that character is foil-or-higher. Beats can be pulled back onto Cast.

import {
  getDirectorRecord,
  getCastRecord,
  getCastMembers,
  isFoilOrHigher,
  normalizePlotHook,
} from './castCatalog.js';
import { sceneLabel } from './scriptCatalog.js';

function uid(prefix = 'h') {
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
  row.steps ??= [];
  return row;
}

function directorBag(storage) {
  const director = getDirectorRecord(storage);
  if (!director) return { director: null, hooks: [] };
  if (!Array.isArray(director.plotHooks)) director.plotHooks = [];
  return { director, hooks: director.plotHooks };
}

function findStep(storage, hook) {
  const h = normalizePlotHook(hook);
  if (!h) return null;
  const mot = motDb(storage);
  for (const [characterId, row] of Object.entries(mot.perChar || {})) {
    const steps = row?.steps ?? [];
    const step = steps.find(s =>
      (h.stepId && s.id === h.stepId)
      || (h.id && s.hookId === h.id));
    if (step) return { characterId, row, step };
  }
  return null;
}

function findHook(storage, step) {
  if (!step) return null;
  const { director, hooks } = directorBag(storage);
  if (!director) return null;
  const hook = hooks.find(h =>
    (step.hookId && h.id === step.hookId)
    || (step.id && h.stepId === step.id));
  return hook ? { director, hook } : { director, hook: null };
}

function boardEligible(storage, characterId) {
  const rec = getCastRecord(storage, characterId);
  return !!(rec && isFoilOrHigher(rec.priority));
}

function patchStepFromHook(step, hook) {
  const h = normalizePlotHook(hook);
  if (!h || !step) return;
  if (h.name) step.title = h.name;
  if (h.description) step.description = h.description;
  if (h.sceneUid) step.sceneUid = h.sceneUid;
  if (h.id) step.hookId = h.id;
}

function patchHookFromBeat(hook, step, characterId) {
  if (!hook || !step) return;
  const title = String(step.title || '').trim();
  if (title) {
    hook.name = title;
    hook.text = title;
  }
  if (step.description) hook.description = String(step.description);
  if (step.sceneUid) hook.sceneUid = String(step.sceneUid);
  if (characterId) hook.assignedTo = characterId;
  hook.stepId = step.id;
  if (step.id) step.hookId = hook.id;
}

function moveStep(storage, found, nextCharacterId) {
  if (!found || found.characterId === nextCharacterId) return found;
  if (!boardEligible(storage, nextCharacterId)) return found;
  const dest = ensureCharRow(storage, nextCharacterId);
  found.row.steps = (found.row.steps || []).filter(s => s.id !== found.step.id);
  found.step.parentId = null;
  dest.steps.push(found.step);
  return { characterId: nextCharacterId, row: dest, step: found.step };
}

/**
 * When a Director hook is assigned and linked to a scene, file (or update)
 * a beat on that character's Motivation board. Returns whether a beat landed.
 */
export function syncBeatFromHook(storage, hook) {
  const h = normalizePlotHook(hook);
  if (!h?.id) return { landed: false, reason: 'no-hook' };
  let found = findStep(storage, h);

  if (found && h.assignedTo && h.assignedTo !== found.characterId) {
    found = moveStep(storage, found, h.assignedTo) || found;
  }

  if (found) {
    patchStepFromHook(found.step, hook);
    hook.stepId = found.step.id;
    found.step.hookId = h.id;
    return { landed: true, created: false, step: found.step, characterId: found.characterId };
  }

  if (!h.assignedTo || !h.sceneUid) {
    return { landed: false, reason: h.assignedTo ? 'no-scene' : 'unassigned' };
  }
  if (!boardEligible(storage, h.assignedTo)) {
    return { landed: false, reason: 'billing' };
  }

  const row = ensureCharRow(storage, h.assignedTo);
  const step = {
    id: uid('m'),
    title: h.name,
    description: h.description || '',
    theme: '',
    branch: '',
    parentId: null,
    sceneUid: h.sceneUid,
    unlocked: false,
    unlockedAt: 0,
    rewards: [],
    hookId: h.id,
  };
  row.steps.push(step);
  hook.stepId = step.id;
  return { landed: true, created: true, step, characterId: h.assignedTo };
}

/** Keep a linked Director hook in sync with its beat. */
export function syncHookFromBeat(storage, characterId, step) {
  if (!step?.id) return { hooked: false };
  const bag = findHook(storage, step);
  if (!bag.director) return { hooked: false, reason: 'no-director' };
  if (bag.hook) {
    patchHookFromBeat(bag.hook, step, characterId);
    bag.director.updatedAt = Date.now();
    return { hooked: true, created: false, hook: bag.hook };
  }
  return { hooked: false };
}

/** File this beat as a Director plot hook (idempotent). */
export function pullBeatAsHook(storage, characterId, step) {
  if (!step?.id) return { hooked: false, reason: 'no-step' };
  const existing = syncHookFromBeat(storage, characterId, step);
  if (existing.hooked) return existing;

  const { director, hooks } = directorBag(storage);
  if (!director) return { hooked: false, reason: 'no-director' };

  const title = String(step.title || '').trim();
  if (!title) return { hooked: false, reason: 'no-title' };

  const hook = {
    id: uid('c'),
    name: title,
    text: title,
    description: String(step.description || '').trim(),
    assignedTo: characterId || '',
    sceneUid: String(step.sceneUid || ''),
    stepId: step.id,
    active: step.unlocked ? false : true,
  };
  step.hookId = hook.id;
  hooks.push(hook);
  director.updatedAt = Date.now();
  return { hooked: true, created: true, hook };
}

/** File a Director plot hook from a proposed event beat. */
export function createHookFromEvent(storage, { name = '', description = '', assignedTo = '' } = {}) {
  const { director, hooks } = directorBag(storage);
  if (!director) return { hooked: false, reason: 'no-director' };
  const title = String(name || '').trim()
    || String(description || '').trim().split(/[.!?\n]/)[0].replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!title) return { hooked: false, reason: 'no-title' };
  const hook = {
    id: uid('c'),
    name: title,
    text: title,
    description: String(description || '').trim(),
    assignedTo: String(assignedTo || '').trim(),
    sceneUid: '',
    stepId: '',
    active: true,
  };
  hooks.push(hook);
  director.updatedAt = Date.now();
  try { syncBeatFromHook(storage, hook); } catch { /* no scene yet */ }
  return { hooked: true, created: true, hook };
}

/** Unlocking a beat resolves its plot hook; re-locking puts it back in play. */
export function markHookResolved(storage, step, resolved) {
  const bag = findHook(storage, step);
  if (!bag.hook) return false;
  bag.hook.active = !resolved;
  bag.director.updatedAt = Date.now();
  return true;
}

export function unlinkHook(storage, hook) {
  const found = findStep(storage, hook);
  if (found?.step) delete found.step.hookId;
  if (hook) hook.stepId = '';
  return !!found;
}

export function unlinkBeat(storage, step) {
  const bag = findHook(storage, step);
  if (bag.hook) bag.hook.stepId = '';
  if (step) delete step.hookId;
  return !!bag.hook;
}

/** Beats that are not already a Director plot hook. */
export function listPullableBeats(storage) {
  const { hooks } = directorBag(storage);
  const hooked = new Set();
  for (const raw of hooks) {
    const h = normalizePlotHook(raw);
    if (h?.stepId) hooked.add(h.stepId);
    if (h?.id) hooked.add(`hook:${h.id}`);
  }
  const members = getCastMembers(storage).filter(m => isFoilOrHigher(m.priority));
  const mot = motDb(storage);
  const out = [];
  for (const m of members) {
    for (const step of mot.perChar?.[m.id]?.steps ?? []) {
      if (!step?.id) continue;
      if (hooked.has(step.id) || (step.hookId && hooked.has(`hook:${step.hookId}`))) continue;
      if (hooks.some(h => h.stepId === step.id || h.id === step.hookId)) continue;
      out.push({
        characterId: m.id,
        characterName: m.name || 'Unnamed',
        priority: m.priority,
        step,
        scene: step.sceneUid ? sceneLabel(storage, step.sceneUid) : '',
      });
    }
  }
  return out;
}

export function hookSceneLabel(storage, hook) {
  const h = normalizePlotHook(hook);
  return h?.sceneUid ? sceneLabel(storage, h.sceneUid) : '';
}

export function hookBoardHint(storage, hook) {
  const h = normalizePlotHook(hook);
  if (!h) return '';
  if (h.stepId) return 'On their Motivation board';
  if (!h.assignedTo) return 'Assign a Star, Lead, Major, or Foil, then link a scene.';
  if (!boardEligible(storage, h.assignedTo)) {
    return 'Motivation boards are for Star / Lead / Major / Foil.';
  }
  if (!h.sceneUid) return 'Link a Script scene to place this on their Motivation board.';
  return '';
}
