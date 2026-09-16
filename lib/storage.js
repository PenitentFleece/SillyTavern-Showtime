// Storage layer — uses getContext() for chat metadata (stable across ST versions).

import { getContext, extension_settings } from '../../../../extensions.js';
import { saveSettingsDebounced } from '../../../../../script.js';

const ROOT_KEY = 'showtime';
const SCHEMA_VERSION = 1;

function debounce(fn, ms = 500) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export class Storage {
  constructor() {
    this._saveMetaDebounced = debounce(() => {
      const ctx = getContext();
      if (typeof ctx.saveMetadata === 'function') ctx.saveMetadata();
    }, 500);
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
      global: structuredClone(extension_settings[ROOT_KEY] ?? {}),
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
      global = structuredClone(globalRoot);
    } else if (globalModules.length) {
      global = { _version: SCHEMA_VERSION };
      for (const id of globalModules) {
        if (globalRoot[id] != null) global[id] = structuredClone(globalRoot[id]);
      }
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
    }
    this.saveChat();
    this.saveGlobal();
  }
}