// Storage layer.
// Global settings stay in extension_settings.
// Per-chat house data (compass, reputation, interviews, the rest of the desk)
// is a sync in-memory cache persisted to IndexedDB. It must not ride inside
// chat_metadata: SillyTavern's saveMetadata stringifies the entire JSONL.

import { getContext, extension_settings } from '../../../../extensions.js';
import { saveSettingsDebounced } from '../../../../../script.js';

const ROOT_KEY = 'showtime';
const SCHEMA_VERSION = 1;
const IDB_NAME = 'showtime-house';
const IDB_STORE = 'chats';

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

function houseIsFat(root) {
  if (!root || typeof root !== 'object' || root._house === 'idb') return false;
  return Object.keys(root).some((k) => !String(k).startsWith('_'));
}

function slimStamp() {
  return { _version: SCHEMA_VERSION, _house: 'idb' };
}

function chatKey(name) {
  return String(name || '').replace(/\.jsonl$/i, '').trim();
}

function houseHasWork(root) {
  if (!root || typeof root !== 'object') return false;
  return Object.keys(root).some(k => k !== '_version' && k !== '_house');
}

function listCount(value) {
  return Array.isArray(value) ? value.length : 0;
}

/** A planted module shell is not a production. Cast, rooms, kit, or a web is. */
export function houseHasSubstance(root) {
  if (!root || typeof root !== 'object') return false;
  if ((root.cast?.characters || []).some(c => String(c?.name || c?.id || '').trim())) return true;
  const rooms = root.backstage?.stage?.rooms;
  if (rooms && typeof rooms === 'object' && Object.keys(rooms).length) return true;
  const inv = root.inventory || {};
  if (listCount(inv.mobile) || listCount(inv.static) || listCount(inv.items)) return true;
  const webs = root.reputation?.webs || root.reputation?.entries;
  if (Array.isArray(webs) && webs.length) return true;
  if (webs && typeof webs === 'object' && !Array.isArray(webs) && Object.keys(webs).length) return true;
  return false;
}

/**
 * The open chat's reel follows a rename. A destination that already has a
 * production is parked, not used as a reason to leave the open reel behind.
 * A module shell planted while SillyTavern reloads the new name is not a reel.
 */
export function chooseRenameRoot(source, destination, { destProvisional = false } = {}) {
  if (!source || typeof source !== 'object') return { move: false, parkDestination: false };
  const destReal = houseHasSubstance(destination) && !destProvisional && destination !== source;
  if (houseHasSubstance(source)) return { move: true, parkDestination: destReal };
  if (destReal) return { move: false, parkDestination: false };
  if (houseHasWork(source)) return { move: true, parkDestination: false };
  return { move: false, parkDestination: false };
}

function parkedChatKey(newId) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${newId} · previous reel ${stamp}`;
}

function dropStalePresenceLedger(root) {
  const list = root?.now?.ledger;
  if (!Array.isArray(list) || !list.length) return false;
  const chars = root?.cast?.characters || [];
  const inPlay = new Set(
    chars
      .filter(c => c && c.priority !== 'director' && c.priority !== 'star'
        && (!c.presence || c.presence === 'inPlay'))
      .map(c => String(c.name || '').trim().toLowerCase())
      .filter(Boolean),
  );
  const next = list.filter((r) => {
    if (r?.kind !== 'presence') return true;
    const m = /^Presence:\s+(.+?)\s+(in play|absent)$/i.exec(String(r.text || ''));
    if (!m) return true;
    const who = m[1].trim().toLowerCase();
    const state = m[2].trim().toLowerCase();
    if (state === 'absent' && inPlay.has(who)) return false;
    return true;
  });
  if (next.length === list.length) return false;
  root.now.ledger = next;
  return true;
}

function repairUnitOccupancy(root) {
  if (!root || typeof root !== 'object') return false;
  const stage = root.backstage?.stage;
  const rooms = stage?.rooms;
  if (!rooms || typeof rooms !== 'object') return false;
  let dirty = false;

  const findRoomForUnit = (unitId) => {
    const unit = rooms[unitId];
    if (!unit || unit.kind !== 'unit') return null;
    const kids = Object.values(rooms).filter(
      r => r && r.parentId === unitId && (r.kind === 'room' || r.kind === 'transitional'),
    );
    if (!kids.length) return null;
    return kids.find(r => /^(display|shop|sales|store|main|entry|foyer|lobby|front|parlor|living)/i.test(String(r.name || '').trim()))
      || kids[0];
  };

  const resolveOccupancyRoom = (occ) => {
    if (!occ || occ.mode !== 'compass') return null;
    const pid = String(occ.placeId || '').trim();
    const key = String(occ.placeKey || '').trim().toLowerCase();
    const cur = pid ? rooms[pid] : null;
    if (cur && (cur.kind === 'room' || cur.kind === 'transitional')) return cur;
    if (cur && cur.kind === 'unit') return findRoomForUnit(cur.id);
    if (key) {
      const byName = Object.values(rooms).find(
        r => r && String(r.name || '').trim().toLowerCase() === key,
      );
      if (byName?.kind === 'unit') return findRoomForUnit(byName.id);
      if (byName && (byName.kind === 'room' || byName.kind === 'transitional')) return byName;
    }
    return null;
  };

  const nowOcc = root.now?.occupancy;
  const scene = root.backstage?.trackers?.scene;
  const targetRoom = resolveOccupancyRoom(nowOcc) || resolveOccupancyRoom(scene?.travel);
  if (!targetRoom) return false;
  const parentUnit = targetRoom.parentId ? rooms[targetRoom.parentId] : null;
  const canonicalKey = parentUnit?.kind === 'unit'
    ? (parentUnit.name || targetRoom.name)
    : (nowOcc?.placeKey || scene?.lastLocationKey || targetRoom.name);

  if (nowOcc && nowOcc.mode === 'compass') {
    if (nowOcc.placeId !== targetRoom.id) { nowOcc.placeId = targetRoom.id; dirty = true; }
    if (canonicalKey && nowOcc.placeKey !== canonicalKey) { nowOcc.placeKey = canonicalKey; dirty = true; }
    if (canonicalKey && root.now.lastLocationKey !== canonicalKey) {
      root.now.lastLocationKey = canonicalKey;
      dirty = true;
    }
  }
  if (scene && typeof scene === 'object') {
    if (scene.travel && scene.travel.mode === 'compass') {
      if (scene.travel.placeId !== targetRoom.id) { scene.travel.placeId = targetRoom.id; dirty = true; }
      if (canonicalKey && scene.travel.placeKey !== canonicalKey) { scene.travel.placeKey = canonicalKey; dirty = true; }
    }
    if (canonicalKey && scene.lastLocationKey !== canonicalKey) {
      scene.lastLocationKey = canonicalKey;
      dirty = true;
    }
  }
  if (stage.sonar && typeof stage.sonar === 'object') {
    const lp = String(stage.sonar.lastPlaceId || '').trim();
    if (!lp || rooms[lp]?.kind === 'unit' || (parentUnit && lp === parentUnit.parentId)) {
      if (stage.sonar.lastPlaceId !== targetRoom.id) {
        stage.sonar.lastPlaceId = targetRoom.id;
        dirty = true;
      }
    }
    if (canonicalKey && (!stage.sonar.lastKey || stage.sonar.lastKey === rooms[parentUnit?.parentId]?.name)) {
      if (stage.sonar.lastKey !== canonicalKey) {
        stage.sonar.lastKey = canonicalKey;
        dirty = true;
      }
    }
    const pings = stage.sonar.pings;
    if (pings && typeof pings === 'object') {
      const inPlayIds = new Set(
        (root.cast?.characters || [])
          .filter(c => c && c.priority !== 'director' && (c.priority === 'star' || !c.presence || c.presence === 'inPlay'))
          .map(c => String(c.id || c.name || '')),
      );
      const outerBuildingId = parentUnit?.parentId || '';
      for (const [cid, ping] of Object.entries(pings)) {
        if (!ping || typeof ping !== 'object') continue;
        if (inPlayIds.has(cid) && (ping.placeId === parentUnit?.id || (outerBuildingId && ping.placeId === outerBuildingId))) {
          ping.placeId = targetRoom.id;
          ping.key = canonicalKey || ping.key;
          if (ping.locked && !ping.manual) ping.locked = false;
          dirty = true;
        }
      }
    }
  }
  if (stage.activeRoomId !== targetRoom.id) {
    stage.activeRoomId = targetRoom.id;
    dirty = true;
  }
  return dirty;
}

function castNameKey(name) {
  return String(name || '').trim().toLowerCase().replace(/^['"]+|['"]+$/g, '').replace(/\s+/g, ' ');
}

/** Keep people filed onto a placeholder when the saved house is the one we adopt. */
function mergeMissingCast(stored, provisional) {
  const from = provisional?.cast?.characters;
  if (!stored || !Array.isArray(from) || !from.length) return false;
  stored.cast ??= {};
  if (!Array.isArray(stored.cast.characters)) stored.cast.characters = [];
  const have = new Set(stored.cast.characters.map(c => castNameKey(c?.name)).filter(Boolean));
  let added = false;
  for (const person of from) {
    const key = castNameKey(person?.name);
    if (!key || have.has(key)) continue;
    stored.cast.characters.push(person);
    have.add(key);
    added = true;
  }
  return added;
}

let dbPromise = null;
function openHouseDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error || new Error('IndexedDB open failed'));
    };
  });
  return dbPromise;
}

function idbGet(chatId) {
  return openHouseDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(chatId);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  }));
}

function idbPut(chatId, root) {
  const payload = root && typeof root === 'object' ? { ...root } : slimStamp();
  return openHouseDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(payload, chatId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }));
}

function idbDelete(chatId) {
  return openHouseDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).delete(chatId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }));
}

export class Storage {
  constructor() {
    /** @type {Map<string, object>} */
    this._houses = new Map();
    /** @type {Set<string>} */
    this._ready = new Set();
    /** @type {Set<string>} */
    this._edited = new Set();
    /** @type {Set<string>} */
    this._loading = new Set();
    this._holdSaves = 0;
    this._heldDirty = false;
    this._heldChatId = '';
    /** Chat ids whose cached house was invented before IndexedDB answered. */
    this._provisional = new Set();
    /** Save requested against a provisional house. Dropped if IndexedDB has work. */
    this._pendingSave = new Set();
    /** @type {Map<string, Promise<void>>} */
    this._inflight = new Map();
    /** Chat ids whose house is moving. Loads must not plant an empty reel over them. */
    this._renameLock = new Set();
    this._renameSerial = 0;
    this._putTimer = null;
    this._putChatId = '';
    this._activeWant = '';
    try {
      window.addEventListener('pagehide', () => this.flushChat({ immediate: true }));
    } catch { /* non-browser */ }
  }

  _chatId() {
    try {
      const ctx = getContext();
      const id = ctx?.chatId ?? ctx?.getCurrentChatId?.();
      if (id == null || String(id) === '') return '';
      return String(id);
    } catch {
      return '';
    }
  }

  /** Block house flushes while a chat is loading / Showtime is booting. */
  holdSaves() {
    this._holdSaves += 1;
  }

  savesHeld() {
    return this._holdSaves > 0;
  }

  /**
   * @param {{ flush?: boolean }} [opts] flush=false drops boot dirties so a
   * normalize pass does not write the moment ST finishes painting.
   */
  releaseSaves({ flush = false } = {}) {
    this._holdSaves = Math.max(0, this._holdSaves - 1);
    if (this._holdSaves > 0) return;
    if (!this._heldDirty) return;
    this._heldDirty = false;
    if (flush && this._heldChatId) this._scheduleHousePut(this._heldChatId);
    this._heldChatId = '';
  }

  /**
   * Write a pending house record to IndexedDB (no-op when nothing is pending).
   * This does not call saveMetadata.
   * @param {{ immediate?: boolean }} [opts]
   */
  flushChat({ immediate = false } = {}) {
    if (this._holdSaves > 0 && !immediate) {
      this._heldDirty = true;
      return;
    }
    if (!this._putTimer && !immediate) return;
    clearTimeout(this._putTimer);
    this._putTimer = null;
    const chatId = this._putChatId || this._heldChatId || this._chatId();
    if (!chatId || chatId === '__none__') return;
    if (this._provisional.has(chatId)) return;
    const root = this._houses.get(chatId);
    if (!root) return;
    void idbPut(chatId, root).catch((err) => {
      console.warn('[Showtime] house save failed', err);
    });
  }

  _scheduleHousePut(chatId) {
    const id = String(chatId || '');
    if (!id || id === '__none__') return;
    if (this._holdSaves > 0) {
      this._heldDirty = true;
      this._heldChatId = id;
      return;
    }
    this._putChatId = id;
    clearTimeout(this._putTimer);
    this._putTimer = setTimeout(() => this.flushChat(), 800);
  }

  /**
   * The house already lives in IndexedDB. Do not rewrite the JSONL from here.
   * A save that runs while SillyTavern has cleared the in-memory chat (group
   * open, before the file has parsed) writes a header and zero messages over
   * the real file. Integrity is skipped when that header has no slug.
   */
  _scheduleStampSave() {
    return;
  }

  _adoptFatMetadata(chatId) {
    const meta = this._meta();
    const existing = meta?.[ROOT_KEY];
    if (!houseIsFat(existing) || this._chatId() !== chatId) return false;
    this._houses.set(chatId, existing);
    meta[ROOT_KEY] = slimStamp();
    this._ready.add(chatId);
    this._scheduleStampSave();
    return true;
  }

  /**
   * Load this chat's house before panes render.
   * A newer IndexedDB record wins over leftover metadata; a fat metadata blob
   * with no IndexedDB record is moved out of the chat file.
   * @param {string} [chatId]
   */
  async activateChat(chatId) {
    const id = String(chatId || this._chatId() || '');
    if (!id) return;
    if (this._renameLock.has(id)) return;
    this._activeWant = id;
    if (this._ready.has(id) && this._houses.has(id) && !this._provisional.has(id)) return;
    const pending = this._inflight.get(id);
    if (pending) return pending;
    const job = this._loadChat(id);
    this._inflight.set(id, job);
    try {
      await job;
    } finally {
      if (this._inflight.get(id) === job) this._inflight.delete(id);
    }
  }

  _renameInterrupted(id, serial) {
    return this._renameLock.has(id) || (this._renameSerial || 0) !== serial;
  }

  async _loadChat(id) {
    const serial = this._renameSerial || 0;
    if (this._renameInterrupted(id, serial)) return;
    if (this._putChatId && this._putChatId !== id) {
      const prev = this._putChatId;
      clearTimeout(this._putTimer);
      this._putTimer = null;
      const prevRoot = this._houses.get(prev);
      // A placeholder planted before the previous load finished must not be written.
      if (prevRoot && !this._provisional.has(prev)) {
        try { await idbPut(prev, prevRoot); } catch (err) {
          console.warn('[Showtime] house save failed', err);
        }
      }
    }
    if (this._ready.has(id) && this._houses.has(id) && !this._provisional.has(id)) return;
    if (this._adoptFatMetadata(id)) {
      try {
        const prior = await idbGet(id);
        if (prior && this._activeWant === id && !this._edited.has(id)) {
          // Metadata was the pre-migration copy. Prefer the browser copy once it exists,
          // but the object we just moved is the only copy if IndexedDB was empty.
          // idbGet returning data means a previous session already saved — keep that.
          this._houses.set(id, prior);
        }
      } catch (err) {
        console.warn('[Showtime] house load failed', err);
      }
      this._provisional.delete(id);
      void this._flushMoved(id);
      return;
    }
    if (this._loading.has(id)) return;
    this._loading.add(id);
    try {
      const stored = await idbGet(id);
      if (this._renameInterrupted(id, serial) || this._activeWant !== id) return;
      const storedOk = stored && typeof stored === 'object';
      const scrubbed = storedOk && (dropStalePresenceLedger(stored) || repairUnitOccupancy(stored));
      const wantSave = this._pendingSave.has(id) || scrubbed;
      // A save that landed on the empty placeholder must not replace a house that already has work.
      const keepStored = this._provisional.has(id) && storedOk && houseHasWork(stored);
      let mergedCast = false;
      if (keepStored) {
        mergedCast = mergeMissingCast(stored, this._houses.get(id));
        this._houses.set(id, stored);
        if (!mergedCast && !scrubbed) this._edited.delete(id);
      } else if (this._edited.has(id) && !this._provisional.has(id)) {
        this._ready.add(id);
        return;
      } else if (!this._houses.has(id)) {
        this._houses.set(id, storedOk ? stored : slimStamp());
      }
      this._provisional.delete(id);
      this._pendingSave.delete(id);
      if (mergedCast || scrubbed || (!keepStored && wantSave)) {
        this._edited.add(id);
        this._scheduleHousePut(id);
      }
      this._ready.add(id);
    } catch (err) {
      console.warn('[Showtime] house load failed', err);
      if (this._renameInterrupted(id, serial)) return;
      if (!this._houses.has(id)) this._houses.set(id, slimStamp());
      this._ready.add(id);
    } finally {
      this._loading.delete(id);
    }
  }

  _flushMoved(chatId) {
    const root = this._houses.get(chatId);
    if (!root) return;
    void idbPut(chatId, root).catch((err) => {
      console.warn('[Showtime] house save failed', err);
    });
  }

  /**
   * SillyTavern renames the chat file, then reloads it before this event.
   * That reload plants an empty house under the new name. Move the open reel
   * anyway. A reel already stored under the new name is kept beside it.
   * @returns {Promise<boolean>} true when a production was moved
   */
  async renameHouse(oldName, newName) {
    const oldId = chatKey(oldName);
    const newId = chatKey(newName);
    if (!oldId || !newId || oldId === newId) return false;
    this._renameSerial += 1;
    this._renameLock.add(oldId);
    this._renameLock.add(newId);
    try {
      let source = this._houses.get(oldId);
      if (!houseHasSubstance(source)) {
        try {
          const stored = await idbGet(oldId);
          if (stored && (houseHasSubstance(stored) || !houseHasSubstance(source))) source = stored;
        } catch { /* the in-memory copy stands */ }
      }
      let destination = this._houses.get(newId);
      const destProvisional = this._provisional.has(newId);
      if (!houseHasSubstance(destination)) {
        try {
          const stored = await idbGet(newId);
          if (houseHasSubstance(stored)) destination = stored;
        } catch { /* the in-memory copy stands */ }
      }
      const plan = chooseRenameRoot(source, destination, { destProvisional });
      if (!plan.move) return false;
      if (plan.parkDestination) {
        const parkId = parkedChatKey(newId);
        this._houses.set(parkId, destination);
        this._ready.add(parkId);
        try {
          await idbPut(parkId, destination);
        } catch (err) {
          console.warn('[Showtime] could not keep the reel already filed under the new name', err);
          this._houses.delete(parkId);
          this._ready.delete(parkId);
          return false;
        }
      }
      this._houses.set(newId, source);
      this._ready.add(newId);
      this._edited.add(newId);
      this._provisional.delete(newId);
      this._pendingSave.delete(newId);
      this._houses.delete(oldId);
      this._ready.delete(oldId);
      this._edited.delete(oldId);
      this._provisional.delete(oldId);
      this._pendingSave.delete(oldId);
      if (this._putChatId === oldId) this._putChatId = newId;
      if (this._heldChatId === oldId) this._heldChatId = newId;
      if (!this._activeWant || this._activeWant === oldId || this._activeWant === newId) {
        this._activeWant = newId;
      }
      try {
        await idbPut(newId, source);
      } catch (err) {
        console.warn('[Showtime] house rename failed', err);
        return false;
      }
      try { await idbDelete(oldId); } catch { /* the old key can linger */ }
      return true;
    } finally {
      this._renameLock.delete(oldId);
      this._renameLock.delete(newId);
    }
  }

  forgetChat(chatId) {
    const id = String(chatId || '');
    if (!id) return;
    this._houses.delete(id);
    this._ready.delete(id);
    this._edited.delete(id);
    void idbDelete(id).catch(() => { /* ignore */ });
  }

  // Always fetch a fresh reference — chat_metadata is swapped on chat change.
  _meta() {
    return getContext().chatMetadata;
  }

  _root() {
    const id = this._chatId() || '__none__';
    const cached = this._houses.get(id);
    if (cached) return cached;
    if (id !== '__none__' && this._adoptFatMetadata(id)) {
      this._flushMoved(id);
      return this._houses.get(id);
    }
    const root = slimStamp();
    this._houses.set(id, root);
    if (id !== '__none__') {
      this._provisional.add(id);
      if (!this._loading.has(id)) void this.activateChat(id);
    }
    return root;
  }

  // --- Per-chat scope ---

  getChat(moduleId, defaults = {}) {
    const root = this._root();
    if (root[moduleId] == null) root[moduleId] = structuredClone(defaults);
    return root[moduleId];
  }

  setChat(moduleId, data) {
    const id = this._chatId() || '__none__';
    const root = this._root();
    root[moduleId] = data;
    if (id === '__none__') return;
    if (this._provisional.has(id)) {
      this._pendingSave.add(id);
      return;
    }
    this._edited.add(id);
    this._ready.add(id);
    this._scheduleHousePut(id);
  }

  saveChat() {
    const id = this._chatId();
    if (!id) return;
    if (this._provisional.has(id)) {
      this._pendingSave.add(id);
      return;
    }
    this._edited.add(id);
    this._scheduleHousePut(id);
  }

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
      chat: structuredClone(this._root()),
      global: scrubGlobalSecrets(structuredClone(extension_settings[ROOT_KEY] ?? {})),
    };
  }

  /** Export selected chat modules (+ optional global root / module globals). */
  exportSlice({ chatModules = [], includeGlobal = false, globalModules = [] } = {}) {
    const chatRoot = this._root();
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
    const chatId = this._chatId() || '__none__';
    const incomingChat = payload.chat ?? {};
    if (!merge && !chatModules) {
      const next = structuredClone(incomingChat);
      next._version = next._version ?? SCHEMA_VERSION;
      next._house = 'idb';
      this._houses.set(chatId, next);
    } else {
      const root = this._root();
      const keys = chatModules?.length
        ? chatModules
        : Object.keys(incomingChat).filter(k => !k.startsWith('_'));
      for (const id of keys) {
        if (incomingChat[id] != null) root[id] = structuredClone(incomingChat[id]);
      }
    }
    if (chatId !== '__none__') {
      this._edited.add(chatId);
      this._ready.add(chatId);
      this._scheduleHousePut(chatId);
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
    this.saveGlobal();
  }
}

export function smokeRenameHousePure() {
  try {
    const reel = {
      cast: { characters: [{ id: 'hawks', name: 'Hawks' }] },
      backstage: { stage: { rooms: { okisato_antiques: { id: 'okisato_antiques' } } } },
    };
    const other = { cast: { characters: [{ id: 'mirko', name: 'Mirko' }] } };
    const shell = { _version: 1, _house: 'idb', cast: { characters: [] } };
    const ontoNew = chooseRenameRoot(reel, shell, { destProvisional: true });
    if (!ontoNew.move || ontoNew.parkDestination) return 'open reel should follow a rename onto an empty name';
    const ontoTaken = chooseRenameRoot(reel, other);
    if (!ontoTaken.move || !ontoTaken.parkDestination) {
      return 'renaming onto a name that already has a reel should keep that reel aside and bring the open one';
    }
    const shellOntoReel = chooseRenameRoot(shell, other);
    if (shellOntoReel.move) return 'an empty placeholder must not replace a reel';
    if (!houseHasSubstance(reel) || houseHasSubstance(shell)) return 'substance should ignore module shells';
    return '';
  } catch (err) {
    return err?.message || String(err);
  }
}
