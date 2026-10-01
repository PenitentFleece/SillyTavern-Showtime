// Switch SillyTavern connection profiles for Showtime agents.
// Slots live on Backstage global settings: audit / motivation / event / interview.
//
// SillyTavern's Connection Manager exposes no global object, so we drive its
// own profile <select> (the same path the /profile slash command uses) and
// wait for CONNECTION_PROFILE_LOADED. Swaps are serialized so overlapping
// background calls can never restore the wrong profile.

import { getContext, extension_settings } from '../../../../extensions.js';
import { eventSource, event_types } from '../../../../../script.js';

const APPLY_TIMEOUT_MS = 20000;
const CONNECT_WAIT_MS = 2000;

let queue = Promise.resolve();
let pendingSwaps = 0;
let activeSwapName = '';
let warnedNoBase = false;
let genWarnBound = false;

function manager() {
  const mgr = extension_settings?.connectionManager;
  if (!mgr || !Array.isArray(mgr.profiles)) return null;
  if ((extension_settings?.disabledExtensions ?? []).includes('connection-manager')) return null;
  return mgr;
}

function findProfile(mgr, idOrName) {
  const key = String(idOrName || '').trim();
  if (!key) return null;
  return mgr.profiles.find(p => p.id === key) ?? mgr.profiles.find(p => p.name === key) ?? null;
}

function escHtml(v) {
  return String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}

function toast(kind, text) {
  try { window.toastr?.[kind]?.(text, 'Showtime'); } catch { /* ignore */ }
}

function bindGenerationWarning() {
  if (genWarnBound) return;
  genWarnBound = true;
  eventSource.on(event_types.GENERATION_STARTED, (type, _opts, dryRun) => {
    if (!activeSwapName || dryRun || type === 'quiet') return;
    toast('warning', `A background Showtime task is using the "${escHtml(activeSwapName)}" connection profile right now, so this reply uses it too.`);
  });
}

function applyProfileId(profileId) {
  const select = document.getElementById('connection_profiles');
  if (!select) return Promise.reject(new Error('Connection Manager profile list not found'));
  const idx = Array.from(select.options).findIndex(o => o.value === profileId);
  if (idx < 0) return Promise.reject(new Error(`Profile ${profileId} is not in the Connection Manager list`));
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (fn) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { eventSource.removeListener?.(event_types.CONNECTION_PROFILE_LOADED, onLoaded); } catch { /* ignore */ }
      fn();
    };
    const onLoaded = () => finish(resolve);
    const timer = setTimeout(() => finish(() => reject(new Error('Timed out applying connection profile'))), APPLY_TIMEOUT_MS);
    eventSource.on(event_types.CONNECTION_PROFILE_LOADED, onLoaded);
    select.selectedIndex = idx;
    select.dispatchEvent(new Event('change'));
  }).then(async () => {
    const started = Date.now();
    while (Date.now() - started < CONNECT_WAIT_MS) {
      if (getContext()?.onlineStatus !== 'no_connection') return;
      await new Promise(r => setTimeout(r, 100));
    }
  });
}

async function runSwapped(wanted, fn) {
  const mgr = manager();
  if (!mgr) return fn();
  const target = findProfile(mgr, wanted);
  if (!target) {
    console.warn('[Showtime] connection profile not found, using current:', wanted);
    return fn();
  }
  const prevId = String(mgr.selectedProfile || '');
  if (prevId === target.id) return fn();
  if (!prevId || !findProfile(mgr, prevId)) {
    // With "<None>" selected, Connection Manager cannot restore the previous API
    // settings afterwards — switching would silently leave the user on this profile.
    if (!warnedNoBase) {
      warnedNoBase = true;
      toast('warning', 'Showtime profile slots need an active Connection Manager profile to switch back to. Select one first; until then the current connection is used.');
    }
    return fn();
  }

  bindGenerationWarning();
  try {
    await applyProfileId(target.id);
  } catch (e) {
    console.warn('[Showtime] profile switch failed', target.name, e);
    if (mgr.selectedProfile !== prevId) {
      try { await applyProfileId(prevId); } catch { /* reported below if it matters */ }
    }
    return fn();
  }

  activeSwapName = target.name;
  try {
    return await fn();
  } finally {
    activeSwapName = '';
    if (mgr.selectedProfile !== prevId) {
      try {
        await applyProfileId(prevId);
      } catch (e) {
        console.warn('[Showtime] profile restore failed', prevId, e);
        toast('error', 'Showtime could not switch back to your connection profile. Check Connection Manager.');
      }
    }
  }
}

/** Run fn with the given Connection Manager profile (id or name) active. */
export function withConnectionProfile(profileId, fn) {
  const wanted = String(profileId || '').trim();
  // No slot set: run now, unless another Showtime swap is active or queued —
  // then wait for it so this call doesn't ride someone else's profile.
  if (!wanted && !pendingSwaps) return fn();
  if (wanted) pendingSwaps++;
  const run = queue.then(() => (wanted ? runSwapped(wanted, fn) : fn()));
  queue = run.catch(() => { /* keep the queue alive */ }).finally(() => { if (wanted) pendingSwaps--; });
  return run;
}

export async function withShowtimeProfile(storage, slot, fn) {
  let profileId = '';
  try {
    profileId = String(storage?.getGlobal?.('backstage', {})?.profiles?.[slot] || '').trim();
  } catch { /* ignore */ }
  return withConnectionProfile(profileId, fn);
}
