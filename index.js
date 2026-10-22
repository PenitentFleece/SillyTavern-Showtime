// Showtime — entry point
// Boots the host, registers modules, mounts the Marquee shell.
import { Injector } from './lib/injector.js';
import { eventSource, event_types, getCurrentChatId } from '../../../../script.js';
import { extension_settings } from '../../../extensions.js';

import { Storage, smokeRenameHousePure } from './lib/storage.js';
import { Bus } from './lib/events.js';
import { Shell } from './lib/shell.js';
import { chatSurfaceReady, keepScrollAround, marqueeIsHidden, runIdle, yieldPaint } from './lib/uiPerf.js';

/** Feature tabs — loaded after ST paints. Static-importing them stalls firstLoadInit (~2MB). */
const MODULE_LOADERS = [
  ['cast', () => import('./modules/cast/cast.js').then(m => m.CastModule)],
  ['script', () => import('./modules/script/script.js').then(m => m.ScriptModule)],
  ['inventory', () => import('./modules/inventory/inventory.js').then(m => m.InventoryModule)],
  ['reputation', () => import('./modules/reputation/reputation.js').then(m => m.ReputationModule)],
  ['composer', () => import('./modules/composer/composer.js').then(m => m.ComposerModule)],
  ['motivation', () => import('./modules/motivation/motivation.js').then(m => m.MotivationModule)],
  ['library', () => import('./modules/library/library.js').then(m => m.LibraryModule)],
  ['backstage', () => import('./modules/backstage/backstage.js').then(m => m.BackstageModule)],
];

function nextTurn() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Let the painted chat take input between long main-thread tasks. */
function breathe(ms = 160) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Let SillyTavern paint the open chat before we compile tab modules.
 * Giving up and importing anyway is what freezes the blank pane: the chat
 * file is still being parsed, and the scene board paints from IndexedDB
 * while printMessages never gets the thread.
 */
async function waitForChatPaint() {
  if (chatSurfaceReady()) {
    await nextTurn();
    return;
  }
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    // Only a painted message means the transcript is in the DOM. CHAT_CHANGED
    // also fires for an empty in-memory chat, and compiling tabs then freezes
    // the blank pane.
    if (chatSurfaceReady()) {
      await nextTurn();
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

const EXTENSION_NAME = 'Showtime';
const SP_CALLBACK_KEY = 'showtime_composer_spotify_callback';
const SP_PKCE_KEY = 'showtime_composer_spotify_pkce';

/** True only while a Spotify login started by Showtime is waiting for its redirect. */
function spotifyLoginPending() {
  try { return !!sessionStorage.getItem(SP_PKCE_KEY); } catch { return false; }
}

function stripOAuthQuery() {
  try {
    const params = new URLSearchParams(location.search);
    if (!params.get('code') && !params.get('state') && !params.get('error')) return;
    if (params.get('source') === 'openrouter') return;
    if (!spotifyLoginPending()) return;
    const url = new URL(location.href);
    for (const key of ['code', 'state', 'error', 'error_description']) url.searchParams.delete(key);
    history.replaceState({}, '', url.pathname + url.search + url.hash);
  } catch (err) {
    console.warn(`[${EXTENSION_NAME}] OAuth query strip skipped`, err);
  }
}

function stashSpotifyQueryIfNeeded() {
  try {
    const params = new URLSearchParams(location.search);
    const code = params.get('code');
    const state = params.get('state');
    if (!code || !state) return;
    if (params.get('source') === 'openrouter') return;
    if (!spotifyLoginPending()) return;
    sessionStorage.setItem(SP_CALLBACK_KEY, JSON.stringify({
      code,
      state,
      error: params.get('error') || '',
    }));
  } catch { /* private mode */ }
}

function restoreHostChrome() {
  try {
    const body = document.body;
    if (body) {
      if (body.style.position === 'absolute') body.style.position = '';
      body.style.removeProperty('width');
      body.style.removeProperty('overflow');
    }
    document.querySelectorAll('.cmp-modal-backdrop').forEach(el => el.remove());
  } catch (err) {
    console.warn(`[${EXTENSION_NAME}] host chrome restore skipped`, err);
  }
}

stashSpotifyQueryIfNeeded();
stripOAuthQuery();

class Showtime {
  constructor() {
    this.storage = new Storage();
    this.bus = new Bus();
    this.shell = new Shell({ bus: this.bus });
    this.modules = new Map();
    this.injector = new Injector({ bus: this.bus });
  }

  async boot() {
    // Ensure settings namespace exists.
    if (!extension_settings.showtime) {
      extension_settings.showtime = { enabledModules: {} };
    }

    this._bootAt = Date.now();
    const renameSmoke = smokeRenameHousePure();
    if (renameSmoke) console.warn(`[${EXTENSION_NAME}] rename house smoke failed:`, renameSmoke);
    // Module init emits state changes. Those must not rebuild prompts while
    // the chat is trying to become clickable.
    this.injector.quiet(12000);
    this.storage.holdSaves();
    // Marquee chrome first — tab modules are ~2MB and must not hide the house.
    this.shell.mount(document.body);
    restoreHostChrome();
    this.shell.syncChatPresence({ animate: false });
    await waitForChatPaint();
    // Messages are on screen. Cloning the house and evaluating the tab
    // modules in this same second is what locks the tab after that point.
    await yieldPaint();
    await breathe(1600);
    try {
      await this.storage.activateChat(getCurrentChatId());
    } catch (err) {
      console.warn(`[${EXTENSION_NAME}] house load failed`, err);
    }
    await breathe(200);

    const pending = [];
    for (const [id, load] of MODULE_LOADERS) {
      await breathe(160);
      let ModCls = null;
      try {
        ModCls = await load();
      } catch (err) {
        console.error(`[${EXTENSION_NAME}] ${id} failed to import`, err);
        await breathe(80);
        continue;
      }
      if (!ModCls) {
        await yieldPaint();
        continue;
      }
      try {
        const instance = new ModCls({
          storage: this.storage,
          bus: this.bus,
          injector: this.injector,
        });
        // Full re-renders rebuild the pane; keep list scroll positions across them.
        // Backstage and Library already restore their own scroll.
        if (ModCls.id === 'script') {
          keepScrollAround(instance, '_rerender', (self) => self._panel);
        } else if (!['backstage', 'library'].includes(ModCls.id)) {
          keepScrollAround(instance, 'render', (self, args) => args[0] || self.container);
        }
        this.modules.set(ModCls.id, instance);
        this.shell.registerTab(ModCls, instance);
        pending.push({ id: ModCls.id, instance });
      } catch (err) {
        console.error(`[${EXTENSION_NAME}] ${ModCls.id} failed to construct`, err);
      }
      await yieldPaint();
    }

    restoreHostChrome();
    this.applyHousePolicy();
    this.shell.syncChatPresence({ animate: false });
    await nextTurn();

    for (const { id, instance } of pending) {
      await breathe(120);
      try {
        await Promise.race([
          instance.init(),
          new Promise(resolve => setTimeout(resolve, 1500)),
        ]);
      } catch (err) {
        console.error(`[${EXTENSION_NAME}] ${id} failed to init`, err);
      }
      await breathe(80);
    }

    // Chat-switch handler — never throw into ST's emitter (that can skip chat paint).
    eventSource.on(event_types.CHAT_CHANGED, (chatId) => {
      restoreHostChrome();
      this.storage.holdSaves();
      try {
        this.shell.syncChatPresence({ animate: true });
      } catch (err) {
        console.error(`[${EXTENSION_NAME}] syncChatPresence`, err);
      }
      const seq = (this._chatSeq = (this._chatSeq || 0) + 1);
      // Let SillyTavern finish painting messages before the house is deserialized.
      runIdle(() => {
        if (seq !== this._chatSeq) {
          this.storage.releaseSaves({ flush: false });
          return;
        }
        void this.storage.activateChat(chatId)
          .catch(err => console.error(`[${EXTENSION_NAME}] activateChat`, err))
          .finally(() => {
            if (seq !== this._chatSeq) {
              this.storage.releaseSaves({ flush: false });
              return;
            }
            void this.onChatChanged()
              .catch(err => console.error(`[${EXTENSION_NAME}] onChatChanged`, err))
              .finally(() => runIdle(() => this.storage.releaseSaves({ flush: false }), 1600));
          });
      }, 900);
    });
    if (event_types.CHAT_RENAMED) {
      eventSource.on(event_types.CHAT_RENAMED, (data) => {
        // reloadCurrentChat already switched the open id. Prefer that over the
        // event payload, which still carries the unsanitized ".jsonl" request name.
        const live = getCurrentChatId();
        void this.storage.renameHouse(data?.oldFileName, live || data?.newFileName)
          .then((moved) => { if (moved) void this.onChatChanged(); })
          .catch(err => console.error(`[${EXTENSION_NAME}] renameHouse`, err));
      });
    }
    if (event_types.CHAT_DELETED) {
      eventSource.on(event_types.CHAT_DELETED, (chatId) => {
        try { this.storage.forgetChat(chatId); } catch { /* ignore */ }
        try { this.shell.syncChatPresence({ animate: true }); } catch { /* ignore */ }
      });
    }

    console.log(`[${EXTENSION_NAME}] Booted with ${this.modules.size} modules.`);
    // Drop boot dirties — rewriting the chat file here stalls ST on "Saving…".
    runIdle(() => this.storage.releaseSaves({ flush: false }), 2000);
    // The chat already open at boot never emits CHAT_CHANGED again.
    try {
      const { maybeOfferSetup } = await import('./lib/setupSheet.js');
      maybeOfferSetup(this);
    } catch (err) {
      console.error(`[${EXTENSION_NAME}] setup sheet`, err);
    }
  }

  applyHousePolicy() {
    const root = extension_settings.showtime ?? {};
    this.shell?.applyTabPolicy?.();
    this.injector?.setEnabled?.(!root.masterOff, { refresh: false });
    // Prompts are built on Generate. Rebuilding them here walks the house
    // after the chat is already on screen.
  }

  async onChatChanged() {
    if (this._chatChangeIdle && typeof cancelIdleCallback === 'function') {
      cancelIdleCallback(this._chatChangeIdle);
    }
    clearTimeout(this._chatChangeIdle);
    this._chatChangeIdle = runIdle(() => {
      this._chatChangeIdle = 0;
      void this._onChatChangedWork();
    }, 400);
  }

  async _onChatChangedWork() {
    for (const mod of this.modules.values()) {
      try {
        await mod.onChatChanged?.();
      } catch (err) {
        console.error(`[${EXTENSION_NAME}] ${mod.constructor?.id} onChatChanged`, err);
      }
    }
    const quiet = marqueeIsHidden() || (this._bootAt && Date.now() - this._bootAt < 2500);
    if (!quiet) {
      try {
        await this.shell.refreshActiveTab();
      } catch (err) {
        console.error(`[${EXTENSION_NAME}] refreshActiveTab`, err);
      }
    }
    try {
      const { maybeOfferSetup } = await import('./lib/setupSheet.js');
      maybeOfferSetup(this);
    } catch (err) {
      console.error(`[${EXTENSION_NAME}] setup sheet`, err);
    }
  }
}

// ST evaluates this module in the middle of firstLoadInit (before chat
// paints). Wait for APP_READY so OAuth / settings races cannot stall ST.
let booted = false;
async function startShowtime() {
  if (booted) return;
  booted = true;
  restoreHostChrome();
  try {
    const app = new Showtime();
    window.Showtime = app;
    await app.boot();
  } catch (err) {
    console.error(`[${EXTENSION_NAME}] Boot failed`, err);
  } finally {
    restoreHostChrome();
    setTimeout(restoreHostChrome, 250);
    setTimeout(restoreHostChrome, 1000);
  }
}

let appReady = false;
function splashUp() {
  try {
    const el = document.querySelector('.splash-screen');
    if (!el || !el.isConnected) return false;
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden') return false;
    const op = parseFloat(st.opacity);
    if (Number.isFinite(op) && op < 0.05) return false;
    return true;
  } catch {
    return false;
  }
}
function scheduleStart(tries = 0) {
  if (booted || !appReady) return;
  if (splashUp() && tries < 80) {
    setTimeout(() => scheduleStart(tries + 1), 120);
    return;
  }
  void startShowtime();
}

eventSource.on(event_types.APP_READY, () => {
  appReady = true;
  // APP_READY still sits under the Initializing overlay until the next paint.
  // Compiling tab modules on this tick is what trips "Page Unresponsive".
  setTimeout(scheduleStart, 0);
});
if (event_types.CHAT_CHANGED) {
  eventSource.on(event_types.CHAT_CHANGED, () => { if (appReady && !booted) scheduleStart(); });
}
jQuery(() => {
  // Extension reload: APP_READY already happened on the previous boot of ST.
  if (!document.querySelector('.splash-screen') && document.getElementById('chat') && document.getElementById('showtime-marquee') == null) {
    appReady = true;
    setTimeout(scheduleStart, 0);
  }
});