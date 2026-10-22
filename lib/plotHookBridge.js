// Director plot hooks ↔ Motivation beats.
// A hook lands on the assigned character's board once it has a Script scene
// and that character is foil-or-higher. Beats can be pulled back onto Cast.

import {
  getDirectorRecord,
  getCastRecord,
  getCastMembers,
  isFoilOrHigher,
  normalizePlotHook,
  normalizePlotHookKind,
} from './castCatalog.js';
import { sceneLabel } from './scriptCatalog.js';
import { appendNowLedger } from './nowSidecar.js';

function noteHookLedger(storage, verb, hook) {
  const name = String(hook?.name || hook?.text || '').trim();
  if (!name) return;
  const v = String(verb || '').trim().toUpperCase();
  let text = '';
  if (v === 'ADDED') text = `Hook added: ${name}`;
  else if (v === 'UPDATED') text = `Hook updated: ${name}`;
  else if (v === 'RESOLVED') text = `Hook resolved: ${name}`;
  else if (v === 'FAILED') text = `Hook failed: ${name}`;
  else if (v === 'REOPENED') text = `Hook reopened: ${name}`;
  if (!text) return;
  try { appendNowLedger(storage, { kind: 'hook', text }); } catch { /* ignore */ }
}

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
  step.sceneUid = String(h.sceneUid || '');
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
 * a beat on that character's Motivation board. Linking a scene resolves the
 * hook: it converts into that beat. Returns whether a beat landed.
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
    kind: 'TASK',
    deadline: '',
    outcome: '',
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
    kind: 'TASK',
    deadline: '',
    outcome: '',
    active: true,
  };
  hooks.push(hook);
  director.updatedAt = Date.now();
  try { syncBeatFromHook(storage, hook); } catch { /* no scene yet */ }
  noteHookLedger(storage, 'ADDED', hook);
  return { hooked: true, created: true, hook };
}

/** Unlocking a beat resolves its plot hook; re-locking puts it back in play. */
export function markHookResolved(storage, step, resolved) {
  const bag = findHook(storage, step);
  if (!bag.hook) return false;
  bag.hook.active = !resolved;
  if (resolved) {
    if (bag.hook.outcome !== 'failed') bag.hook.outcome = 'resolved';
  } else if (bag.hook.outcome === 'resolved') {
    bag.hook.outcome = '';
  }
  bag.director.updatedAt = Date.now();
  noteHookLedger(storage, resolved ? 'RESOLVED' : 'REOPENED', bag.hook);
  return true;
}

function hookNameKey(hook) {
  return String(hook?.name || hook?.text || '').trim().toLowerCase();
}

function matchHookBySummary(hooks, summary) {
  const want = String(summary || '').trim().toLowerCase();
  if (!want || !Array.isArray(hooks)) return null;
  const exact = hooks.find(h => hookNameKey(h) === want);
  if (exact) return exact;
  return hooks.find((h) => {
    const n = hookNameKey(h);
    return n && (n.includes(want) || want.includes(n));
  }) || null;
}

function applyEventFields(hook, event) {
  if (!hook || !event) return;
  const name = String(event.summary || '').trim();
  if (name) {
    hook.name = name;
    hook.text = name;
  }
  if (event.kind) hook.kind = normalizePlotHookKind(event.kind);
  if (event.deadline != null) hook.deadline = String(event.deadline || '').trim();
  if (event.context) hook.description = String(event.context || '').trim();
}

/**
 * Apply a parsed `[EVENT|…]` tag to the Director hook list.
 * ADDED/UPDATED create or patch; RESOLVED/FAILED close the hook.
 */
export function applySlateEvent(storage, event) {
  const empty = { ok: false, reason: 'bad-event', hook: null, created: false, resolveStep: null, failStep: null };
  const verb = String(event?.verb || '').trim().toUpperCase();
  const summary = String(event?.summary || '').trim();
  if (!summary || !['ADDED', 'UPDATED', 'RESOLVED', 'FAILED'].includes(verb)) return empty;

  const { director, hooks } = directorBag(storage);
  if (!director) return { ...empty, reason: 'no-director' };

  let hook = matchHookBySummary(hooks, summary);
  let created = false;
  if (!hook) {
    hook = {
      id: uid('c'),
      name: summary,
      text: summary,
      description: String(event.context || '').trim(),
      assignedTo: '',
      sceneUid: '',
      stepId: '',
      kind: normalizePlotHookKind(event.kind),
      deadline: String(event.deadline || '').trim(),
      outcome: '',
      active: verb === 'ADDED' || verb === 'UPDATED',
    };
    hooks.push(hook);
    created = true;
  }

  applyEventFields(hook, event);
  let resolveStep = null;
  let failStep = null;

  if (verb === 'ADDED' || verb === 'UPDATED') {
    hook.outcome = '';
    hook.active = true;
    try { syncBeatFromHook(storage, hook); } catch { /* no scene yet */ }
  } else if (verb === 'RESOLVED') {
    hook.outcome = 'resolved';
    hook.active = false;
    const found = findStep(storage, hook);
    if (found?.step) {
      hook.stepId = found.step.id;
      found.step.hookId = hook.id;
      resolveStep = { characterId: found.characterId, stepId: found.step.id, step: found.step };
    }
  } else if (verb === 'FAILED') {
    hook.outcome = 'failed';
    hook.active = false;
    const found = findStep(storage, hook);
    if (found?.step) {
      hook.stepId = found.step.id;
      found.step.hookId = hook.id;
      failStep = { characterId: found.characterId, stepId: found.step.id, step: found.step };
    }
  }

  director.updatedAt = Date.now();
  noteHookLedger(storage, verb, hook);
  return { ok: true, verb, hook, created, resolveStep, failStep };
}

export function smokePlotHookSlatePure() {
  const director = { id: 'dir', priority: 'director', plotHooks: [] };
  const storage = {
    getChat(key, fallback) {
      if (key === 'cast') return { characters: [director] };
      if (key === 'motivation') return { perChar: {} };
      return fallback || {};
    },
  };
  const added = applySlateEvent(storage, {
    verb: 'ADDED', kind: 'THREAT', summary: 'The lease', deadline: 'Friday', context: 'Landlord at the door',
  });
  if (!added.ok || !added.created) return 'ADDED should create a hook';
  if (added.hook.kind !== 'THREAT' || added.hook.deadline !== 'Friday') return 'ADDED should stamp kind and deadline';
  const updated = applySlateEvent(storage, {
    verb: 'UPDATED', kind: 'DEADLINE', summary: 'The lease', deadline: 'tonight', context: 'Notice served',
  });
  if (updated.created) return 'UPDATED should match the existing hook';
  if (updated.hook.kind !== 'DEADLINE' || updated.hook.deadline !== 'tonight') return 'UPDATED should patch fields';
  if (director.plotHooks.length !== 1) return 'should not duplicate on name match';
  const resolved = applySlateEvent(storage, { verb: 'RESOLVED', kind: 'DEADLINE', summary: 'The lease' });
  if (resolved.hook.outcome !== 'resolved' || resolved.hook.active !== false) return 'RESOLVED should close the hook';
  const failed = applySlateEvent(storage, {
    verb: 'FAILED', kind: 'TASK', summary: 'Steal the key', context: 'Caught in the hall',
  });
  if (!failed.created || failed.hook.outcome !== 'failed') return 'FAILED unknown hook should file closed';
  return '';
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
  if (!h.sceneUid) return 'Link a Script scene to file this as a beat on their Motivation board.';
  return '';
}
