// Storage layer — uses getContext() for chat metadata (stable across ST versions).

import { getContext, extension_settings } from '../../../../extensions.js';
import { saveSettingsDebounced } from '../../../../../script.js';

const ROOT_KEY = 'showtime';
const SCHEMA_VERSION = 1;

// Never ship OAuth tokens inside a shareable Reel.
function scrubGlobalSecrets(global) {
  const sp = global?.composer?.spotify;
  if (sp && typeof sp === 'object') {
    delete sp.accessToken;
    delete sp.refreshToken;
    delete sp.expiresAt;
    delete sp.grantedScope;
  }
  return global;
}

// Showtime's own UI: clicks here keep editing, so the save may stay debounced.
const SHOWTIME_UI_SELECTOR = [
  '#showtime-marquee', '.cmp-mini',
  '.cast-modal-backdrop', '.inv-modal-backdrop', '.lib-modal-backdrop', '.mot-modal-backdrop',
  '.rep-modal-backdrop', '.cmp-modal-backdrop', '.bst-dialog-overlay', '.bst-modal-overlay', '.bst-event-backdrop', '.stm-dialog-overlay',
].join(', ');

export class Storage {
  constructor() {
    this._metaTimer = null;
    this._saveMetaDebounced = () => {
      clearTimeout(this._metaTimer);
      // Each save writes the whole chat file; coalesce bursts (drags, slider drags).
      // The flush handlers below cover the longer window.
      this._metaTimer = setTimeout(() => this.flushChat(), 1200);
    };
    // A pending save fires against whatever chat is current *then*. Flush it
    // before the user can switch chats elsewhere in ST, or leave the page.
    try {
      document.addEventListener('pointerdown', (e) => {
        if (!this._metaTimer) return;
        if (e.target?.closest?.(SHOWTIME_UI_SELECTOR)) return;
        this.flushChat();
      }, true);
      window.addEventListener('pagehide', () => this.flushChat({ immediate: true }));
    } catch { /* non-browser */ }
  }

  /**
   * Save pending chat metadata (no-op when nothing is pending).
   * ST's save serializes and posts the whole chat file, so by default it waits
   * for an idle moment — running it inside a pointerdown handler shows up as
   * ~1s of input delay on the click that triggered it.
   * @param {{ immediate?: boolean }} [opts]
   */
  flushChat({ immediate = false } = {}) {
    if (!this._metaTimer) return;
    clearTimeout(this._metaTimer);
    this._metaTimer = null;
    const save = () => {
      const ctx = getContext();
      // No chat open → ST logs "saveChat called without chat_name". Nothing to write.
      const chatId = ctx?.chatId ?? ctx?.getCurrentChatId?.();
      if (chatId === undefined || chatId === null || String(chatId) === '') return;
      if (typeof ctx.saveMetadata === 'function') ctx.saveMetadata();
    };
    if (immediate || typeof requestIdleCallback !== 'function') {
      save();
      return;
    }
    requestIdleCallback(save, { timeout: 1500 });
  }

  // Always fetch a fresh reference — chat_metadata is swapped on chat change.
  _meta() {
    return getContext().chatMetadata;
  }

  // --- Per-chat scope ---

  getChat(moduleId, defaults = {}) {
    const meta = this._meta();
    if (!meta[ROOT_KEY]) meta[ROOT_KEY] = { _version: SCHEMA_VERSION };
    if (!meta[ROOT_KEY][moduleId]) meta[ROOT_KEY][moduleId] = structuredClone(defaults);
    return meta[ROOT_KEY][moduleId];
  }

  setChat(moduleId, data) {
    const meta = this._meta();
    if (!meta[ROOT_KEY]) meta[ROOT_KEY] = { _version: SCHEMA_VERSION };
    meta[ROOT_KEY][moduleId] = data;
    this._saveMetaDebounced();
  }

  saveChat() { this._saveMetaDebounced(); }

  // --- Global scope ---

  getGlobal(moduleId, defaults = {}) {
    if (!extension_settings[ROOT_KEY]) extension_settings[ROOT_KEY] = { _version: SCHEMA_VERSION };
    if (!extension_settings[ROOT_KEY][moduleId]) {
      extension_settings[ROOT_KEY][moduleId] = structuredClone(defaults);
    }
    return extension_settings[ROOT_KEY][moduleId];
  }

  setGlobal(moduleId, data) {
    if (!extension_settings[ROOT_KEY]) extension_settings[ROOT_KEY] = { _version: SCHEMA_VERSION };
    extension_settings[ROOT_KEY][moduleId] = data;
    saveSettingsDebounced();
  }

  saveGlobal() { saveSettingsDebounced(); }

  // --- Export / Import ("Productions") ---

  exportProduction() {
    return {
      _showtime: true,
      _version: SCHEMA_VERSION,
      chat: structuredClone(this._meta()[ROOT_KEY] ?? {}),
      global: scrubGlobalSecrets(structuredClone(extension_settings[ROOT_KEY] ?? {})),
    };
  }

  /** Export selected chat modules (+ optional global root / module globals). */
  exportSlice({ chatModules = [], includeGlobal = false, globalModules = [] } = {}) {
    const chatRoot = this._meta()[ROOT_KEY] ?? {};
    const globalRoot = extension_settings[ROOT_KEY] ?? {};
    const chat = {};
    for (const id of chatModules) {
      if (chatRoot[id] != null) chat[id] = structuredClone(chatRoot[id]);
    }
    let global = null;
    if (includeGlobal) {
      global = scrubGlobalSecrets(structuredClone(globalRoot));
    } else if (globalModules.length) {
      global = { _version: SCHEMA_VERSION };
      for (const id of globalModules) {
        if (globalRoot[id] != null) global[id] = structuredClone(globalRoot[id]);
      }
      scrubGlobalSecrets(global);
    }
    return {
      _showtime: true,
      _version: SCHEMA_VERSION,
      _slice: true,
      chat,
      global,
    };
  }

  importProduction(payload, { merge = false, chatModules = null, importGlobal = true } = {}) {
    if (!payload?._showtime) throw new Error('Not a Showtime production file.');
    const meta = this._meta();
    const incomingChat = payload.chat ?? {};
    if (!merge && !chatModules) {
      meta[ROOT_KEY] = structuredClone(incomingChat);
    } else {
      if (!meta[ROOT_KEY]) meta[ROOT_KEY] = { _version: SCHEMA_VERSION };
      const keys = chatModules?.length
        ? chatModules
        : Object.keys(incomingChat).filter(k => !k.startsWith('_'));
      for (const id of keys) {
        if (incomingChat[id] != null) meta[ROOT_KEY][id] = structuredClone(incomingChat[id]);
      }
    }
    if (importGlobal && payload.global != null) {
      // Keep this browser's own Spotify login; an imported Reel must not replace it.
      const localSpotify = extension_settings[ROOT_KEY]?.composer?.spotify;
      if (!merge && !chatModules) {
        extension_settings[ROOT_KEY] = structuredClone(payload.global);
      } else {
        if (!extension_settings[ROOT_KEY]) extension_settings[ROOT_KEY] = { _version: SCHEMA_VERSION };
        const g = payload.global;
        for (const id of Object.keys(g)) {
          if (id.startsWith('_')) continue;
          extension_settings[ROOT_KEY][id] = structuredClone(g[id]);
        }
        if (g._version != null) extension_settings[ROOT_KEY]._version = g._version;
      }
      if (localSpotify) {
        extension_settings[ROOT_KEY].composer ??= {};
        extension_settings[ROOT_KEY].composer.spotify = localSpotify;
      }
    }
    this.saveChat();
    this.saveGlobal();
  }
}