// Switch SillyTavern connection profiles for Showtime agents.
// Slots live on Backstage global settings (see PROFILE_SLOTS).
// Script Agent may override the house `script` slot per chat.
// World Index LLM uses `index`, and falls back to Filing (`audit`) if unset.
//
// SillyTavern's Connection Manager exposes no global object, so we drive its
// own profile <select> (the same path the /profile slash command uses) and
// wait for CONNECTION_PROFILE_LOADED. Swaps are serialized so overlapping
// background calls can never restore the wrong profile.

import { getContext, extension_settings } from '../../../../extensions.js';
import { eventSource, event_types, setOnlineStatus } from '../../../../../script.js';
import { oai_settings, promptManager } from '../../../../openai.js';
import { isQuietPinActive } from './isolatedGen.js';

const APPLY_TIMEOUT_MS = 20000;
const CONNECT_WAIT_MS = 2000;

export const PROFILE_SLOT_IDS = Object.freeze([
  'audit', 'index', 'motivation', 'interview', 'event', 'script',
]);

export const PROFILE_SLOTS = Object.freeze([
  { id: 'audit', label: 'Filing', hint: 'Cast, Inventory, Reputation, and citation receipts' },
  { id: 'index', label: 'World Index', hint: 'LLM retrieve after an AI post. Empty uses Filing.' },
  { id: 'motivation', label: 'Motivation', hint: 'Motivation audit and narrative sonar' },
  { id: 'interview', label: 'Interview', hint: 'Backstage interviews' },
  { id: 'event', label: 'Director / Gallery', hint: 'Director events and Peanut Gallery' },
  { id: 'script', label: 'Script Agent', hint: 'Script builder from chat or Library. A chat may override this under Script → Configure.' },
]);

export function emptyProfileMap() {
  return Object.fromEntries(PROFILE_SLOT_IDS.map(id => [id, '']));
}

export function hydrateProfileMap(raw) {
  const out = emptyProfileMap();
  const src = raw && typeof raw === 'object' ? raw : {};
  for (const id of PROFILE_SLOT_IDS) out[id] = String(src[id] || '').trim();
  return out;
}

/** House-level Connection Manager profile id for a Backstage slot. */
export function houseProfileId(storage, slot) {
  try {
    return String(storage?.getGlobal?.('backstage', {})?.profiles?.[slot] || '').trim();
  } catch {
    return '';
  }
}

let queue = Promise.resolve();
let pendingSwaps = 0;
let activeSwapName = '';
let warnedNoBase = false;
let genWarnBound = false;
/** Resolves when the call-sheet reply (or other held user generation) has finished. */
let userGateRelease = null;
/** Quiet profile swaps must not dry-run the open chat. That recount tokenizes every message. */
let profileSwapDepth = 0;
let quietGenDepth = 0;
let suppressDryRunUntil = 0;

function promptDryRunHeld() {
  return profileSwapDepth > 0 || quietGenDepth > 0 || isQuietPinActive() || Date.now() < suppressDryRunUntil;
}

function quietConnectOn() {
  globalThis.__showtimeQuietConnect = true;
}

function quietConnectOff() {
  if (profileSwapDepth > 0 || quietGenDepth > 0) return;
  globalThis.__showtimeQuietConnect = false;
}

function holdPromptDryRun() {
  const pm = promptManager;
  if (!pm || pm._showtimeDryRunHeld || typeof pm.tryGenerate !== 'function') return;
  const orig = pm.tryGenerate;
  pm.tryGenerate = () => (promptDryRunHeld() ? Promise.resolve() : orig());
  pm._showtimeDryRunHeld = true;
}

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

let lastGoodStatus = '';

function connectedStatus() {
  const status = String(getContext()?.onlineStatus || '').trim();
  if (status && status !== 'no_connection') {
    lastGoodStatus = status;
    return status;
  }
  return '';
}

/** Put a quiet-swap "no connection" back before the next Cue Sheet turn. */
export function ensureUserConnection() {
  if (connectedStatus()) {
    revealSendButtonsIfConnected();
    return true;
  }
  if (!lastGoodStatus) return false;
  try { setOnlineStatus(lastGoodStatus); } catch { return false; }
  revealSendButtonsIfConnected();
  return Boolean(connectedStatus());
}

/** A quiet swap can leave Send hidden after the reply. Put the button back when the API is still up. */
function revealSendButtonsIfConnected() {
  if (!connectedStatus()) return;
  for (const id of ['send_but', 'mes_continue', 'mes_impersonate']) {
    document.getElementById(id)?.classList.remove('displayNone');
  }
  document.getElementById('send_form')?.classList.remove('no-connection');
  const box = document.getElementById('send_textarea');
  const connected = box?.getAttribute('connected_text');
  if (box && connected) box.setAttribute('placeholder', connected);
}

function restoreConnectionStatus(saved) {
  if (!saved) return;
  if (!connectedStatus()) {
    try { setOnlineStatus(saved); } catch { /* ignore */ }
  }
  revealSendButtonsIfConnected();
  // Group unlock and the status observer both land just after the swap.
  setTimeout(revealSendButtonsIfConnected, 0);
  setTimeout(revealSendButtonsIfConnected, 400);
}

function bindGenerationWarning() {
  if (genWarnBound) return;
  genWarnBound = true;
  eventSource.on(event_types.GENERATION_STARTED, (type, _opts, dryRun) => {
    if (!dryRun && type !== 'quiet') connectedStatus();
    if (!activeSwapName || dryRun || type === 'quiet') return;
    toast('warning', `A background Showtime task is using the "${escHtml(activeSwapName)}" connection profile right now, so this reply uses it too.`);
  });
  eventSource.on(event_types.GENERATION_ENDED, () => {
    revealSendButtonsIfConnected();
    setTimeout(revealSendButtonsIfConnected, 0);
  });
}

function applyProfileId(profileId) {
  const select = document.getElementById('connection_profiles');
  if (!select) return Promise.reject(new Error('Connection Manager profile list not found'));
  const idx = Array.from(select.options).findIndex(o => o.value === profileId);
  if (idx < 0) return Promise.reject(new Error(`Profile ${profileId} is not in the Connection Manager list`));
  // Re-selecting the active option does not fire `change`, so CONNECTION_PROFILE_LOADED
  // never arrives and we used to sit on APPLY_TIMEOUT_MS after every interview reply.
  if (select.selectedIndex === idx && String(select.value) === String(profileId)) {
    return Promise.resolve();
  }
  return (async () => {
    const savedStatus = connectedStatus();
    // Let the interview desk paint before Connection Manager rewrites API controls.
    await new Promise(r => setTimeout(r, 0));
    holdPromptDryRun();
    // A bound preset empties the custom model list and reconnects, which
    // rebuilds every model option and then dry-runs the open chat. The
    // profile's own /api /api-url /model commands still apply the connection.
    // __showtimeQuietConnect tells SillyTavern to skip that status check.
    const prevBind = !!oai_settings?.bind_preset_to_connection;
    if (oai_settings) oai_settings.bind_preset_to_connection = false;
    quietConnectOn();
    profileSwapDepth += 1;
    try {
      await new Promise((resolve, reject) => {
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
      });
      const started = Date.now();
      while (Date.now() - started < CONNECT_WAIT_MS) {
        if (getContext()?.onlineStatus !== 'no_connection') return;
        await new Promise(r => setTimeout(r, 100));
      }
    } finally {
      profileSwapDepth = Math.max(0, profileSwapDepth - 1);
      quietConnectOff();
      if (oai_settings) oai_settings.bind_preset_to_connection = prevBind;
      // Preset change debounces a full-chat dry run for 1s. Keep it skipped
      // until that timer has passed and the original profile is back.
      suppressDryRunUntil = Date.now() + 1800;
      // /api marks the chat disconnected, then the quiet flag skips the
      // reconnect. Put the status (and the send button) back.
      restoreConnectionStatus(savedStatus);
    }
  })();
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
  // Hold the dry run for the whole reply, not just the swap. A debounced
  // prompt-manager render otherwise tokenizes the open chat mid-generation.
  quietGenDepth += 1;
  quietConnectOn();
  holdPromptDryRun();
  let handedOff = false;
  const releaseQuiet = () => {
    quietGenDepth = Math.max(0, quietGenDepth - 1);
    quietConnectOff();
  };
  try {
    try {
      await applyProfileId(target.id);
    } catch (e) {
      console.warn('[Showtime] profile switch failed', target.name, e);
      if (mgr.selectedProfile !== prevId) {
        try { await applyProfileId(prevId); } catch { /* reported below if it matters */ }
      }
      return await fn();
    }

    activeSwapName = target.name;
    try {
      return await fn();
    } finally {
      activeSwapName = '';
      if (mgr.selectedProfile !== prevId) {
        handedOff = true;
        const restoring = applyProfileId(prevId).catch(e => {
          console.warn('[Showtime] profile restore failed', prevId, e);
          toast('error', 'Showtime could not switch back to your connection profile. Check Connection Manager.');
        }).finally(releaseQuiet);
        // Do not block the caller (interview desk, filing) on restore. Keep it
        // on the serial queue so the next swap still waits for the original profile.
        queue = queue.then(() => restoring, () => restoring);
      }
    }
  } finally {
    if (!handedOff) releaseQuiet();
  }
}

/**
 * Hold the profile queue until `endUserGeneration()`. In-flight swaps finish
 * first, then filings wait so they cannot change the connection under a reply.
 */
export function beginUserGeneration() {
  let grant;
  const granted = new Promise((resolve) => { grant = resolve; });
  const run = queue.then(() => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    userGateRelease = release;
    grant();
    return gate;
  });
  queue = run.catch(() => { /* keep the queue alive */ });
  return granted;
}

export function endUserGeneration() {
  const release = userGateRelease;
  userGateRelease = null;
  if (release) release();
}

/** Run fn with the given Connection Manager profile (id or name) active. */
export function withConnectionProfile(profileId, fn) {
  const wanted = String(profileId || '').trim();
  // Cue send holds the gate until Generate() returns. Work that starts from
  // inside that Generate() (sonar, a receipt) is why it has not returned yet.
  // Waiting here deadlocks the unlock: the reply is on screen, the typing
  // indicator never clears. Stay on the current connection instead of swapping.
  if (userGateRelease) return fn();
  // No slot set: run now, unless another Showtime swap is active or queued.
  if (!wanted && !pendingSwaps) return fn();
  if (wanted) pendingSwaps++;
  const run = queue.then(() => (wanted ? runSwapped(wanted, fn) : fn()));
  queue = run.catch(() => { /* keep the queue alive */ }).finally(() => { if (wanted) pendingSwaps--; });
  return run;
}

bindGenerationWarning();

export async function withShowtimeProfile(storage, slot, fn, { override } = {}) {
  let profileId = String(override || '').trim() || houseProfileId(storage, slot);
  if (!profileId && slot === 'index') profileId = houseProfileId(storage, 'audit');
  return withConnectionProfile(profileId, fn);
}
