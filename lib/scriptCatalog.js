// Shared Script catalog — other modules read scene cards without importing Script.
import { formatOrgCode } from './keywordFacets.js';

const BY_INDEX = (a, b) =>
  (a.sortIndex ?? 0) - (b.sortIndex ?? 0) || (a.createdAt || 0) - (b.createdAt || 0);

export const DEFAULT_SCRIPT_LEVELS = Object.freeze([
  { id: 'base',       label: 'Base / Root', icon: '📁' },
  { id: 'collection', label: 'Collection',  icon: '📂' },
  { id: 'book',       label: 'Book',        icon: '📚' },
  { id: 'chapter',    label: 'Chapter',     icon: '📄' },
]);

export function getScriptDb(storage) {
  try {
    return storage.getChat('script', { cards: [], settings: { orgScheme: 'show', levels: [] } });
  } catch {
    return { cards: [], settings: { orgScheme: 'show', levels: [] } };
  }
}

export function orgSchemeOf(db) {
  const s = db?.settings?.orgScheme;
  if (s === 'book' || s === 'custom') return s;
  return 'show';
}

export function getLevels(db) {
  const raw = db?.settings?.levels;
  if (Array.isArray(raw) && raw.length) return raw;
  return [...DEFAULT_SCRIPT_LEVELS];
}

/** Normalize level rows. Level `id` is also the Custom org-code token. */
export function normalizeLevels(raw) {
  const src = Array.isArray(raw) && raw.length ? raw : [...DEFAULT_SCRIPT_LEVELS];
  return src.map((l, i) => {
    // Prefer id; fall back to legacy `code` if id was empty / missing.
    const rawId = String(l?.id || l?.code || `level_${i}`).trim().replace(/\s+/g, '_');
    const id = rawId || `level_${i}`;
    return {
      id,
      label: String(l?.label || id).trim() || id,
      icon: String(l?.icon || '📄').trim() || '📄',
    };
  });
}

export function levelIndex(card, db) {
  if (!card) return -1;
  const levels = getLevels(db);
  return levels.findIndex(l => l.id === card.levelId);
}

export function isScriptFolder(card, db) {
  if (!card) return false;
  if (card.kind === 'folder') return true;
  if (card.kind === 'card') return false;
  const levels = getLevels(db);
  const idx = levels.findIndex(l => l.id === card.levelId);
  return idx >= 0 && idx < levels.length - 1;
}

export function folderLevelId(db) {
  const levels = getLevels(db);
  return (levels.length > 1 ? levels[levels.length - 2] : levels[0])?.id ?? 'book';
}

export function cardLevelId(db) {
  return getLevels(db).at(-1)?.id ?? 'chapter';
}

export function rootLevelId(db) {
  return getLevels(db)[0]?.id ?? 'base';
}

/**
 * Level id for a new child under `parent` (null = shelf root).
 * Folders use the next ladder step; cards always use the leaf level.
 * Returns null when a folder cannot be created under that parent.
 */
export function nextLevelId(parent, db, { forFolder = false } = {}) {
  const levels = getLevels(db);
  if (!levels.length) return forFolder ? null : 'chapter';
  if (forFolder) {
    if (!parent) {
      return levels.length > 1 ? levels[0].id : null;
    }
    const pi = levelIndex(parent, db);
    const next = (pi >= 0 ? pi : 0) + 1;
    if (next >= levels.length - 1) return null;
    return levels[next].id;
  }
  return levels.at(-1).id;
}

/** Root → node path with sibling indices (folders among folders, cards among cards). */
export function orgPath(card, db) {
  if (!card) return [];
  const cards = db.cards ?? [];
  const levels = getLevels(db);
  const chain = [];
  let cur = card;
  const seen = new Set();
  while (cur && !seen.has(cur.uid)) {
    chain.unshift(cur);
    seen.add(cur.uid);
    cur = cur.parentUid ? cards.find(c => c.uid === cur.parentUid) : null;
  }
  return chain.map(node => {
    const folder = isScriptFolder(node, db);
    const sibs = cards
      .filter(c => (c.parentUid || null) === (node.parentUid || null) && isScriptFolder(c, db) === folder)
      .sort(BY_INDEX);
    const index = Math.max(1, sibs.findIndex(c => c.uid === node.uid) + 1);
    let li = levels.findIndex(l => l.id === node.levelId);
    if (li < 0) li = folder ? Math.max(0, levels.length - 2) : levels.length - 1;
    const level = levels[li] || null;
    return {
      uid: node.uid,
      index,
      folder,
      level,
      code: level?.id ?? '',
      pad: 0,
    };
  });
}

/** Show/Book major/minor derived from path (last folder + leaf). */
export function orgCoords(card, db) {
  const path = orgPath(card, db);
  if (!path.length) return { major: 1, minor: null, folder: true };
  if (isScriptFolder(card, db)) {
    return { major: path[path.length - 1].index, minor: null, folder: true };
  }
  const folders = path.filter(p => p.folder);
  const major = folders.length ? folders[folders.length - 1].index : 1;
  const minor = path[path.length - 1].index;
  return { major, minor, folder: false };
}

export function sceneCode(card, db) {
  if (!card) return '';
  const scheme = orgSchemeOf(db);
  if (scheme === 'custom') {
    const segments = orgPath(card, db).map(p => ({
      code: p.code,
      index: p.index,
    }));
    return formatOrgCode('custom', 1, 1, { segments });
  }
  const { major, minor, folder } = orgCoords(card, db);
  return formatOrgCode(scheme, major, minor, { folder });
}

/**
 * Fix kind / levelId / parentUid so the tree matches the level ladder.
 * Returns number of cards changed.
 */
export function normalizeShelfLevels(db) {
  if (!db || !Array.isArray(db.cards)) return 0;
  const levels = normalizeLevels(db.settings?.levels);
  db.settings ??= {};
  db.settings.levels = levels;
  const byUid = new Map(db.cards.map(c => [c.uid, c]));
  const leaf = levels.length - 1;
  const maxFolder = Math.max(0, leaf - 1);
  let n = 0;

  const treeDepth = (card) => {
    let d = 0;
    let cur = card;
    const seen = new Set();
    while (cur?.parentUid && byUid.has(cur.parentUid) && !seen.has(cur.uid)) {
      seen.add(cur.uid);
      d++;
      cur = byUid.get(cur.parentUid);
    }
    return d;
  };

  const findAncestorAt = (start, wantLi) => {
    let cur = start;
    const seen = new Set();
    while (cur && !seen.has(cur.uid)) {
      seen.add(cur.uid);
      const ci = levels.findIndex(l => l.id === cur.levelId);
      if (ci === wantLi) return cur;
      cur = cur.parentUid ? byUid.get(cur.parentUid) : null;
    }
    return null;
  };

  for (const card of db.cards) {
    let changed = false;
    let li = levels.findIndex(l => l.id === card.levelId);

    if (li < 0) {
      const depth = treeDepth(card);
      if (card.kind === 'card') li = leaf;
      else if (card.kind === 'folder') li = Math.min(maxFolder, depth);
      else li = Math.min(leaf, depth);
      card.levelId = levels[li].id;
      changed = true;
    }

    const wantKind = li < leaf ? 'folder' : 'card';
    if (card.kind !== wantKind) {
      card.kind = wantKind;
      changed = true;
    }

    if (li === 0) {
      if (card.parentUid) {
        card.parentUid = null;
        changed = true;
      }
    } else {
      const wantParentLi = li - 1;
      let parent = card.parentUid ? byUid.get(card.parentUid) : null;
      let parentOk = false;
      if (parent) {
        const pli = levels.findIndex(l => l.id === parent.levelId);
        if (pli === wantParentLi) parentOk = true;
        else {
          const hit = findAncestorAt(parent, wantParentLi);
          if (hit) {
            if (card.parentUid !== hit.uid) {
              card.parentUid = hit.uid;
              changed = true;
            }
            parentOk = true;
          }
        }
      }
      if (!parentOk) {
        if (wantKind === 'card') {
          // Allow leaf cards at shelf root (unsorted / unfiled).
          if (card.parentUid) {
            card.parentUid = null;
            changed = true;
          }
          if (card.levelId !== levels[leaf].id) {
            card.levelId = levels[leaf].id;
            changed = true;
          }
          if (card.kind !== 'card') {
            card.kind = 'card';
            changed = true;
          }
        } else {
          // Folders without a valid parent park at root on the first level.
          if (card.parentUid) {
            card.parentUid = null;
            changed = true;
          }
          if (card.levelId !== levels[0].id || card.kind !== (leaf > 0 ? 'folder' : 'card')) {
            card.levelId = levels[0].id;
            card.kind = leaf > 0 ? 'folder' : 'card';
            changed = true;
          }
        }
      }
    }

    if (changed) n++;
  }
  return n;
}

/** Scene cards only — folders are containers, not beats. */
export function getSceneCards(storage) {
  const db = getScriptDb(storage);
  return (db.cards ?? [])
    .filter(c => !isScriptFolder(c, db))
    .sort(BY_INDEX)
    .map(c => ({ uid: c.uid, title: c.title || 'Untitled', code: sceneCode(c, db), card: c }));
}

export function sceneLabel(storage, uid) {
  if (!uid) return '';
  const db = getScriptDb(storage);
  const card = (db.cards ?? []).find(c => c.uid === uid);
  if (!card) return '';
  return `${sceneCode(card, db)} · ${card.title || 'Untitled'}`;
}

/** Scenes where this cast member (or bare name / alias / tagged alter ego) is credited. */
export function creditedScenes(storage, castId, name = '') {
  const needle = String(name || '').trim().toLowerCase();
  let aliases = [];
  try {
    const rec = (storage.getChat('cast', { characters: [] }).characters || [])
      .find(c => c.id === castId);
    aliases = (rec?.aliases || []).map(a => String(a).trim().toLowerCase()).filter(Boolean);
    if (!needle && rec?.name) aliases.push(String(rec.name).trim().toLowerCase());
    const tagged = new Set((rec?.taggedAlterEgos || []).map(String));
    for (const ego of (rec?.alterEgoIndex || [])) {
      if (tagged.size && !tagged.has(String(ego.id))) continue;
      const en = String(ego.name || '').trim().toLowerCase();
      if (en) aliases.push(en);
    }
  } catch { /* ignore */ }
  const names = new Set([needle, ...aliases].filter(Boolean));
  return getSceneCards(storage).filter(s =>
    (s.card.credits || []).some(cr => {
      if (castId && cr.characterId === castId) return true;
      const cn = String(cr.name || '').trim().toLowerCase();
      return cn && names.has(cn);
    }),
  );
}
