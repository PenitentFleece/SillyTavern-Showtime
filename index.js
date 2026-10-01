// Showtime — entry point
// Boots the host, registers modules, mounts the Marquee shell.
import { Injector } from './lib/injector.js';
import { eventSource, event_types } from '../../../../script.js';
import { extension_settings } from '../../../extensions.js';

import { Storage } from './lib/storage.js';
import { Bus } from './lib/events.js';
import { Shell } from './lib/shell.js';
import { keepScrollAround } from './lib/uiPerf.js';

// Module imports — stubs for now, real implementations added one at a time.
import { CastModule } from './modules/cast/cast.js';
import { ScriptModule } from './modules/script/script.js';
import { InventoryModule } from './modules/inventory/inventory.js';
import { ReputationModule } from './modules/reputation/reputation.js';
import { ComposerModule } from './modules/composer/composer.js';
import { MotivationModule } from './modules/motivation/motivation.js';
import { LibraryModule } from './modules/library/library.js';
import { BackstageModule } from './modules/backstage/backstage.js';

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
restoreHostChrome();

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

    // Register modules. Order here determines default tab order.
    const registry = [
      CastModule,
      ScriptModule,
      InventoryModule,
      ReputationModule,
      ComposerModule,
      MotivationModule,
      LibraryModule,
      BackstageModule,
    ];

    for (const ModCls of registry) {
      try {
        const instance = new ModCls({
          storage: this.storage,
          bus: this.bus,
          injector: this.injector,
        });
        await Promise.race([
          instance.init(),
          new Promise(resolve => setTimeout(resolve, 2000)),
        ]);
        // Full re-renders rebuild the pane; keep list scroll positions across them.
        // Backstage and Library already restore their own scroll.
        if (ModCls.id === 'script') {
          keepScrollAround(instance, '_rerender', (self) => self._panel);
        } else if (!['backstage', 'library'].includes(ModCls.id)) {
          keepScrollAround(instance, 'render', (self, args) => args[0] || self.container);
        }
        this.modules.set(ModCls.id, instance);
        this.shell.registerTab(ModCls, instance);
      } catch (err) {
        console.error(`[${EXTENSION_NAME}] ${ModCls.id} failed to init`, err);
      }
    }

    // Mount even if a module (e.g. Spotify login) threw — otherwise the
    // whole marquee disappears and ST can look like chat never painted.
    this.shell.mount(document.body);
    restoreHostChrome();
    this.applyHousePolicy();
    this.shell.syncChatPresence({ animate: false });

    // Chat-switch handler — never throw into ST's emitter (that can skip chat paint).
    eventSource.on(event_types.CHAT_CHANGED, () => {
      restoreHostChrome();
      try {
        this.shell.syncChatPresence({ animate: true });
      } catch (err) {
        console.error(`[${EXTENSION_NAME}] syncChatPresence`, err);
      }
      void this.onChatChanged().catch(err => console.error(`[${EXTENSION_NAME}] onChatChanged`, err));
    });
    if (event_types.CHAT_DELETED) {
      eventSource.on(event_types.CHAT_DELETED, () => {
        try { this.shell.syncChatPresence({ animate: true }); } catch { /* ignore */ }
      });
    }

    console.log(`[${EXTENSION_NAME}] Booted with ${this.modules.size} modules.`);
  }

  applyHousePolicy() {
    const root = extension_settings.showtime ?? {};
    this.shell?.applyTabPolicy?.();
    this.injector?.setEnabled?.(!root.masterOff);
    this.injector?.refreshAlwaysOn?.();
  }

  async onChatChanged() {
    for (const mod of this.modules.values()) {
      try {
        await mod.onChatChanged?.();
      } catch (err) {
        console.error(`[${EXTENSION_NAME}] ${mod.constructor?.id} onChatChanged`, err);
      }
    }
    try {
      await this.shell.refreshActiveTab();
    } catch (err) {
      console.error(`[${EXTENSION_NAME}] refreshActiveTab`, err);
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

eventSource.on(event_types.APP_READY, () => {
  // Let ST finish autoload/printMessages before we mount anything.
  requestAnimationFrame(() => { void startShowtime(); });
});
jQuery(() => {
  // Extension reload after the app is already up — APP_READY will not fire again.
  if (document.getElementById('chat') && !document.querySelector('.splash-screen')) {
    requestAnimationFrame(() => { void startShowtime(); });
  }
});