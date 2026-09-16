// Shared Library catalog — Script (and anyone else) can list filed leaves
// and stamp scene codes without importing the Library module.

export const LIB_SEP = '\u241f';
export const LIB_UNSORTED = '__unsorted__';
export const SCENE_TAG_TYPE = { id: 'scene', label: 'Scene', color: '#4a6a8a' };

const CHAT_DEFAULTS = {
  version: 2,
  seeded: false,
  sections: [],
  filing: {},
  bookFiling: {},
  adopted: [],
  native: [],
  dismissed: [],
  settings: {},
};

const GLOBAL_DEFAULTS = {
  tagTypes: [],
  shelves: [],
  bookShelf: {},
  bookTags: {},
};

export function getLibraryChat(storage) {
  try {
    const st = storage.getChat('library', CHAT_DEFAULTS);
    st.sections ??= [];
    st.filing ??= {};
    st.bookFiling ??= {};
    st.native ??= [];
    st.dismissed ??= [];
    return st;
  } catch {
    return structuredClone(CHAT_DEFAULTS);
  }
}

export function getLibraryGlobal(storage) {
  try {
    const g = storage.getGlobal('library', GLOBAL_DEFAULTS);
    g.tagTypes ??= [];
    g.bookTags ??= {};
    return g;
  } catch {
    return structuredClone(GLOBAL_DEFAULTS);
  }
}

export function librarySections(storage) {
  const st = getLibraryChat(storage);
  return [...st.sections].sort((a, b) =>
    (a.sortIndex ?? 0) - (b.sortIndex ?? 0) || String(a.title).localeCompare(String(b.title)));
}

export function libraryEntryKey(book, uid) {
  return `${book}${LIB_SEP}${String(uid)}`;
}

function entryTitle(e) {
  const keys = Array.isArray(e.key) ? e.key.join(', ') : e.key;
  return String(e.comment || keys || 'Untitled').trim();
}

function entryKeys(e) {
  const primary = Array.isArray(e.key) ? e.key : (e.key ? [e.key] : []);
  const secondary = Array.isArray(e.keysecondary) ? e.keysecondary : [];
  return [...primary, ...secondary].map(k => String(k).trim()).filter(Boolean);
}

/** Books already loaded into the Library tab (in-memory), if any. */
export function getCachedLibraryBooks() {
  try {
    const lib = window.Showtime?.modules?.get?.('library');
    if (lib?._booksLoaded && Array.isArray(lib._books)) return lib._books;
  } catch { /* ignore */ }
  return [];
}

function mergeLeafTags(own, bookTags) {
  const out = [];
  const seen = new Set();
  for (const raw of own || []) {
    const type = String(raw?.type || '').trim();
    const value = String(raw?.value ?? raw?.text ?? '').trim();
    if (!type || !value) continue;
    const id = `${type}\u241f${value.toLowerCase()}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ type, value });
  }
  for (const raw of bookTags || []) {
    const type = String(raw?.type || '').trim();
    const value = String(raw?.value ?? raw?.text ?? '').trim();
    if (!type || !value) continue;
    const id = `${type}\u241f${value.toLowerCase()}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ type, value, inherited: true });
  }
  return out;
}

/** Flat list of Library-visible entries, keyed the same way the Library tab keys them. */
export function listLibraryLeaves(storage, books = []) {
  const st = getLibraryChat(storage);
  const g = getLibraryGlobal(storage);
  const sections = new Map((st.sections || []).map(s => [s.id, s]));
  const out = [];
  for (const book of books) {
    const bookDefault = st.bookFiling[book.name] ?? '';
    const raw = book.entries ?? [];
    const entries = Array.isArray(raw) ? raw : Object.values(raw);
    const bookTags = g.bookTags?.[book.name] || [];
    for (const e of entries) {
      if (!e) continue;
      const uid = String(e.uid ?? '');
      const key = libraryEntryKey(book.name, uid);
      const filed = st.filing[key];
      const sectionId = filed && filed.sectionId !== undefined ? filed.sectionId : bookDefault;
      const section = sectionId ? sections.get(sectionId) : null;
      out.push({
        kind: 'linked',
        key,
        book: book.name,
        uid,
        title: entryTitle(e),
        content: String(e.content || ''),
        keys: entryKeys(e),
        constant: !!e.constant,
        disabled: !!e.disable,
        sectionId: sectionId || '',
        sectionTitle: section?.title || '',
        tags: mergeLeafTags(filed?.tags, bookTags),
        note: filed?.note || '',
        raw: e,
      });
    }
  }
  for (const n of st.native) {
    const section = n.sectionId ? sections.get(n.sectionId) : null;
    out.push({
      kind: 'native',
      key: `native${LIB_SEP}${n.id}`,
      id: n.id,
      book: '',
      uid: n.id,
      title: String(n.title || 'Untitled'),
      content: String(n.content || ''),
      keys: Array.isArray(n.keywords) ? n.keywords : [],
      constant: !!n.pinned,
      disabled: n.active === false,
      sectionId: n.sectionId || '',
      sectionTitle: section?.title || '',
      tags: mergeLeafTags(n.tags, []),
      note: String(n.note || ''),
      raw: n,
    });
  }
  return out;
}

/**
 * Prefer an explicit books list; otherwise use Library's cached WI books so
 * Backstage / World Index still see filed lorebook leaves after the Library
 * tab has loaded them. Skips chat-dismissed extras.
 */
export function listVisibleLibraryLeaves(storage, books = null) {
  const resolved = (books && books.length) ? books : getCachedLibraryBooks();
  const dismissed = new Set(getLibraryChat(storage).dismissed || []);
  return listLibraryLeaves(storage, resolved).filter(l => !dismissed.has(l.key));
}

export function leafAsWiEntry(leaf) {
  return {
    comment: leaf.title,
    content: leaf.content,
    key: leaf.keys,
    constant: leaf.constant,
    disable: leaf.disabled,
    uid: leaf.uid,
    _libKey: leaf.key,
    _bookName: leaf.book || '',
  };
}

function addSceneTags(list, codes) {
  const next = Array.isArray(list) ? [...list] : [];
  const seen = new Set(next
    .filter(t => t?.type === 'scene')
    .map(t => String(t.value).toLowerCase()));
  for (const code of codes) {
    const value = String(code || '').trim();
    if (!value) continue;
    const id = value.toLowerCase();
    if (seen.has(id)) continue;
    seen.add(id);
    next.push({ type: 'scene', value });
  }
  return next;
}

function removeSceneTags(list, codes) {
  const drop = new Set(
    (codes || []).map(c => String(c || '').trim().toLowerCase()).filter(Boolean),
  );
  if (!drop.size || !Array.isArray(list)) return Array.isArray(list) ? list : [];
  return list.filter(t => !(t?.type === 'scene' && drop.has(String(t.value || '').toLowerCase())));
}

/** Scene codes already stamped onto a tag list (Library filing / book tags). */
export function sceneCodesFromTags(tags) {
  const seen = new Set();
  const out = [];
  for (const t of tags || []) {
    if (t?.type !== 'scene') continue;
    const value = String(t.value || '').trim();
    if (!value) continue;
    const id = value.toLowerCase();
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(value);
  }
  return out;
}

/** Scene codes stamped onto a lorebook (global book tags). */
export function bookSceneCodes(storage, bookName) {
  if (!bookName) return [];
  const g = getLibraryGlobal(storage);
  return sceneCodesFromTags(g.bookTags?.[bookName]);
}

export function ensureSceneTagType(g) {
  g.tagTypes ??= [];
  if (!g.tagTypes.some(t => t.id === 'scene')) {
    g.tagTypes.push({ ...SCENE_TAG_TYPE });
  }
}

/**
 * Stamp scene codes onto the picked Library leaves and the lorebooks they
 * came from. Never writes into SillyTavern's World Info files.
 */
export function stampSceneCodes(storage, { leafKeys = [], bookNames = [], codes = [] } = {}) {
  const clean = [...new Set(codes.map(c => String(c || '').trim()).filter(Boolean))];
  if (!clean.length) return 0;
  const st = getLibraryChat(storage);
  const g = getLibraryGlobal(storage);
  ensureSceneTagType(g);
  let n = 0;
  for (const key of leafKeys) {
    if (!key) continue;
    if (key.startsWith(`native${LIB_SEP}`)) {
      const rec = st.native.find(x => x.id === key.slice(`native${LIB_SEP}`.length));
      if (!rec) continue;
      rec.tags = addSceneTags(rec.tags, clean);
      n++;
    } else {
      const rec = st.filing[key] ?? (st.filing[key] = { tags: [] });
      rec.tags = addSceneTags(rec.tags, clean);
      n++;
    }
  }
  for (const name of bookNames) {
    if (!name) continue;
    g.bookTags[name] = addSceneTags(g.bookTags[name], clean);
  }
  storage.saveChat();
  storage.saveGlobal();
  return n;
}

/**
 * Remove specific scene codes from Library leaves / books (e.g. after a
 * Script card that owned those stamps is deleted).
 */
export function unstampSceneCodes(storage, { leafKeys = [], bookNames = [], codes = [] } = {}) {
  const clean = [...new Set(codes.map(c => String(c || '').trim()).filter(Boolean))];
  if (!clean.length) return 0;
  const st = getLibraryChat(storage);
  const g = getLibraryGlobal(storage);
  let n = 0;
  for (const key of leafKeys) {
    if (!key) continue;
    if (key.startsWith(`native${LIB_SEP}`)) {
      const rec = st.native.find(x => x.id === key.slice(`native${LIB_SEP}`.length));
      if (!rec?.tags?.length) continue;
      const before = rec.tags.length;
      rec.tags = removeSceneTags(rec.tags, clean);
      if (rec.tags.length !== before) n++;
    } else {
      const rec = st.filing[key];
      if (!rec?.tags?.length) continue;
      const before = rec.tags.length;
      rec.tags = removeSceneTags(rec.tags, clean);
      if (rec.tags.length !== before) n++;
    }
  }
  for (const name of bookNames) {
    if (!name || !g.bookTags?.[name]?.length) continue;
    const before = g.bookTags[name].length;
    g.bookTags[name] = removeSceneTags(g.bookTags[name], clean);
    if (g.bookTags[name].length !== before) n++;
  }
  storage.saveChat();
  storage.saveGlobal();
  return n;
}

/**
 * Drop Library scene tags whose codes no longer match any live Script card.
 * Returns how many tag lists were changed.
 */
export function reconcileSceneStamps(storage, liveCodes = []) {
  const live = new Set(
    (liveCodes || []).map(c => String(c || '').trim().toLowerCase()).filter(Boolean),
  );
  const st = getLibraryChat(storage);
  const g = getLibraryGlobal(storage);
  let n = 0;

  const prune = (tags) => {
    if (!Array.isArray(tags) || !tags.length) return tags;
    const next = tags.filter(t => {
      if (t?.type !== 'scene') return true;
      const id = String(t.value || '').trim().toLowerCase();
      return id && live.has(id);
    });
    return next.length === tags.length ? tags : next;
  };

  for (const rec of st.native || []) {
    if (!rec?.tags?.length) continue;
    const next = prune(rec.tags);
    if (next !== rec.tags) { rec.tags = next; n++; }
  }
  for (const key of Object.keys(st.filing || {})) {
    const rec = st.filing[key];
    if (!rec?.tags?.length) continue;
    const next = prune(rec.tags);
    if (next !== rec.tags) { rec.tags = next; n++; }
  }
  for (const name of Object.keys(g.bookTags || {})) {
    const tags = g.bookTags[name];
    if (!tags?.length) continue;
    const next = prune(tags);
    if (next !== tags) { g.bookTags[name] = next; n++; }
  }

  if (n) {
    storage.saveChat();
    storage.saveGlobal();
  }
  return n;
}

/**
 * Drop tags that no longer point at a live Script card, lorebook entry, or book.
 * @returns {{ scene: number, filing: number, books: number, empty: number }}
 */
export function clearOrphanTags(storage, { liveSceneCodes = [], liveLeafKeys = null, knownBooks = null } = {}) {
  const scene = reconcileSceneStamps(storage, liveSceneCodes);
  const st = getLibraryChat(storage);
  const g = getLibraryGlobal(storage);
  let filing = 0;
  let books = 0;
  let empty = 0;

  const pruneEmpty = (tags) => {
    if (!Array.isArray(tags)) return tags;
    const next = tags.filter(t => String(t?.type || '').trim() && String(t?.value ?? t?.text ?? '').trim());
    if (next.length !== tags.length) empty += tags.length - next.length;
    return next;
  };

  for (const rec of st.native || []) {
    if (!rec?.tags) continue;
    rec.tags = pruneEmpty(rec.tags);
  }
  for (const rec of Object.values(st.filing || {})) {
    if (!rec?.tags) continue;
    rec.tags = pruneEmpty(rec.tags);
  }
  for (const name of Object.keys(g.bookTags || {})) {
    g.bookTags[name] = pruneEmpty(g.bookTags[name]);
  }

  if (liveLeafKeys instanceof Set) {
    for (const key of Object.keys(st.filing || {})) {
      if (liveLeafKeys.has(key)) continue;
      delete st.filing[key];
      filing++;
    }
    st.dismissed = (st.dismissed || []).filter(k => liveLeafKeys.has(k));
  }

  if (knownBooks instanceof Set && knownBooks.size) {
    for (const name of Object.keys(g.bookTags || {})) {
      if (knownBooks.has(name)) continue;
      delete g.bookTags[name];
      books++;
    }
    for (const name of Object.keys(g.bookShelf || {})) {
      if (knownBooks.has(name)) continue;
      delete g.bookShelf[name];
      books++;
    }
    for (const name of Object.keys(st.bookFiling || {})) {
      if (knownBooks.has(name)) continue;
      delete st.bookFiling[name];
      books++;
    }
    st.adopted = (st.adopted || []).filter(n => knownBooks.has(n));
  }

  storage.saveChat();
  storage.saveGlobal();
  return { scene, filing, books, empty };
}

/**
 * Rewrite Library scene tags from Script claims (sourceStamp + live codes).
 * Each claim: { leafKeys, bookNames, codes }. Leaves/books with no claim
 * lose all scene tags — this clears leftovers after deletes / renumbers.
 * Returns how many tag lists changed.
 */
export function syncSceneStamps(storage, claims = []) {
  const allowedLeaf = new Map(); // key → Map(lower → display)
  const allowedBook = new Map();
  const claim = (map, id, codes) => {
    if (!id) return;
    if (!map.has(id)) map.set(id, new Map());
    const bucket = map.get(id);
    for (const c of codes || []) {
      const value = String(c || '').trim();
      if (!value) continue;
      const lid = value.toLowerCase();
      if (!bucket.has(lid)) bucket.set(lid, value);
    }
  };
  for (const row of claims || []) {
    const codes = row.codes || [];
    for (const key of row.leafKeys || []) claim(allowedLeaf, key, codes);
    for (const name of row.bookNames || []) claim(allowedBook, name, codes);
  }

  const st = getLibraryChat(storage);
  const g = getLibraryGlobal(storage);
  ensureSceneTagType(g);
  let n = 0;

  const rewrite = (tags, allowed) => {
    const prev = Array.isArray(tags) ? tags : [];
    const nonScene = prev.filter(t => t?.type !== 'scene');
    const scenes = allowed?.size
      ? [...allowed.values()].map(value => ({ type: 'scene', value }))
      : [];
    const next = [...nonScene, ...scenes];
    const same = prev.length === next.length
      && prev.every((t, i) => t?.type === next[i]?.type
        && String(t?.value || '').toLowerCase() === String(next[i]?.value || '').toLowerCase());
    return same ? tags : next;
  };

  for (const rec of st.native || []) {
    if (!rec) continue;
    const key = `native${LIB_SEP}${rec.id}`;
    const next = rewrite(rec.tags, allowedLeaf.get(key));
    if (next !== rec.tags) { rec.tags = next; n++; }
  }

  const filingKeys = new Set([
    ...Object.keys(st.filing || {}),
    ...[...allowedLeaf.keys()].filter(k => !k.startsWith(`native${LIB_SEP}`)),
  ]);
  for (const key of filingKeys) {
    const rec = st.filing[key] ?? (st.filing[key] = { tags: [] });
    const next = rewrite(rec.tags, allowedLeaf.get(key));
    if (next !== rec.tags) { rec.tags = next; n++; }
  }

  const bookNames = new Set([
    ...Object.keys(g.bookTags || {}),
    ...allowedBook.keys(),
  ]);
  for (const name of bookNames) {
    const next = rewrite(g.bookTags[name], allowedBook.get(name));
    if (next !== g.bookTags[name]) { g.bookTags[name] = next; n++; }
  }

  if (n) {
    storage.saveChat();
    storage.saveGlobal();
  }
  return n;
}
