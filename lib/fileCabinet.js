// File Cabinet — one store of narrative HTML documents, attributed to houses.

import { getLibraryChat } from './libraryCatalog.js';
import {
  characterHouseIds,
  houseKnowerIncludesCast,
  knowerKey,
  normalizeKnownBy,
  setKnowerStance,
} from './motivationCatalog.js';
import { deriveLocator, findWorldItem, isStarOwner, worldFromStorage } from './itemLocator.js';

export const FILE_FORMS = Object.freeze(['letter', 'clipping', 'photo', 'warrant', 'file', 'note']);

const FORM_LABELS = Object.freeze({
  letter: 'Letter',
  clipping: 'Clipping',
  photo: 'Photograph',
  warrant: 'Warrant',
  file: 'File',
  note: 'Note',
});

const FORM_FROM_NAME = /\b(letter|warrant|polaroid|photo|memo|clipping|dossier|writ|notice)\b/i;

export function emptyCabinet() {
  return { files: [] };
}

export function normalizeForm(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (s === 'polaroid' || s === 'photograph') return 'photo';
  if (s === 'dossier' || s === 'record' || s === 'report') return 'file';
  if (s === 'memo' || s === 'writ' || s === 'notice') return 'note';
  return FILE_FORMS.includes(s) ? s : 'file';
}

export function formLabel(form) {
  const f = normalizeForm(form);
  return FORM_LABELS[f] || 'File';
}

export function looksLikeDocumentName(name) {
  return FORM_FROM_NAME.test(String(name || ''));
}

export function formFromName(name) {
  const m = String(name || '').match(FORM_FROM_NAME);
  if (!m) return 'file';
  return normalizeForm(m[1]);
}

export function normalizeCabinetOf(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  if (src.type === 'house') {
    const id = String(src.id || '').trim();
    if (id) return { type: 'house', id };
  }
  return { type: 'library' };
}

function uid() {
  return `f_${Math.random().toString(36).slice(2, 10)}`;
}

function foldName(s) {
  return String(s || '').trim().toLowerCase().replace(/^(the|a|an)\s+/, '');
}

/** Drop vault/WI chrome that is not part of the in-world document. */
export function stripLorebookChrome(text) {
  let raw = String(text || '');
  raw = raw.replace(/<div\b[^>]*\bmeta-block\b[^>]*>[\s\S]*?<\/div>/gi, '');
  raw = raw.replace(/<(p|div)\b[^>]*>\s*\[[^\]]*(?:Category|Scope|Who Knows|Triggers|Consequences|Related)\s*:[^\]]*\]\s*<\/\1>/gi, '');
  raw = raw.replace(/^\s*\[[^\]]*(?:Category|Scope|Who Knows|Triggers|Consequences|Related)\s*:[^\]]*\]\s*$/gim, '');
  return raw.replace(/\n{3,}/g, '\n\n').trim();
}

/** Strip YAML and turn [[wiki]] links into spans. Does not flatten markdown. */
export function prepareLoreSource(content) {
  let raw = stripLorebookChrome(String(content || '').replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, ''));
  raw = raw.replace(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g, (_, page, alias) => {
    const label = String(alias || page).trim();
    return `<span class="st-file-ref">${escHtml(label)}</span>`;
  });
  return raw.trim();
}

export function looksLikeCompleteHtml(raw) {
  const s = String(raw || '').trim();
  return /^<(aside|article)\b/i.test(s) && /<\/(aside|article)>/i.test(s);
}

export function guessFileForm(text) {
  const s = String(text || '');
  if (/\b(classified|dossier|document id|eyes only|containment protocol|priority[-\s]*1)\b/i.test(s)) return 'file';
  if (/\b(warrant|hereby ordered)\b/i.test(s)) return 'warrant';
  if (/^\s*(dear |my dearest )/im.test(s) || /\b(sincerely|yours truly)\b/i.test(s)) return 'letter';
  if (/\b(newspaper|dateline|clipping)\b/i.test(s)) return 'clipping';
  if (/\b(polaroid|photograph)\b/i.test(s)) return 'photo';
  if (/\b(memo|sticky note)\b/i.test(s)) return 'note';
  return '';
}

const MARKED_DOC_RE = /^(#{1,3})\s+\**\s*((?:DOCUMENT\s+[A-Z]|SUPPLEMENTARY)\b[^\n]*)$/gim;

function cleanHeading(text) {
  return String(text || '').replace(/\*+/g, '').replace(/\s+/g, ' ').trim();
}

function formForMarkedPiece(body) {
  const head = String(body || '').slice(0, 700);
  if (/\b(witness|testimony|hearsay|heresay|oral history)\b/i.test(head)) return 'note';
  if (/\b(internal|classified|restricted|eyes only|level\s*\d)\b/i.test(head)) return 'file';
  if (/\b(public|press|newspaper|unclassified|official report)\b/i.test(head)) return 'clipping';
  return guessFileForm(body) || 'file';
}

function titleForMarkedPiece(body, marker) {
  const lines = String(body || '').split('\n');
  for (const line of lines) {
    const h = line.match(/^#{1,3}\s+\**\s*(.+?)\s*\**\s*$/);
    if (!h) continue;
    const text = cleanHeading(h[1]);
    if (/^(DOCUMENT\s+[A-Z]|SUPPLEMENTARY)\b/i.test(text)) continue;
    if (text) return text.slice(0, 120);
  }
  const fallback = cleanHeading(marker).replace(/^(?:DOCUMENT\s+[A-Z]|SUPPLEMENTARY)\b[\s\u2014\u2013:-]+/i, '');
  return (fallback || cleanHeading(marker) || 'Document').slice(0, 120);
}

/** Cut a lore body into one piece per DOCUMENT / SUPPLEMENTARY block. */
export function splitMarkedDocuments(text) {
  const raw = String(text || '').replace(/\r\n/g, '\n');
  const marks = [];
  MARKED_DOC_RE.lastIndex = 0;
  let m;
  while ((m = MARKED_DOC_RE.exec(raw))) {
    marks.push({ index: m.index, heading: cleanHeading(m[2]) });
  }
  if (marks.length < 2) return [];
  const pieces = [];
  for (let i = 0; i < marks.length; i++) {
    const end = i + 1 < marks.length ? marks[i + 1].index : raw.length;
    let body = raw.slice(marks[i].index, end).trim();
    body = body.replace(/^\**\s*\[END\b[^\]]*\]\**\s*$/gim, '').replace(/\n{3,}/g, '\n\n').trim();
    if (!body) continue;
    pieces.push({
      title: titleForMarkedPiece(body, marks[i].heading),
      form: formForMarkedPiece(body),
      body,
    });
  }
  return pieces.length >= 2 ? pieces : [];
}

/** Bracketed redactions and a line that is only the word REDACTED become bars. */
export function barRedactions(html) {
  return String(html || '').replace(/>([^<]*)</g, (full, text) => {
    if (!/redacted/i.test(text)) return full;
    const next = text.replace(/\[(?:[^\]]*\bREDACTED\b[^\]]*)\]|(^|\n)\s*REDACTED\s*(?=\n|$)/gi, (token) => {
      const word = token.replace(/^\s+|\s+$/g, '');
      if (!word) return token;
      return token.replace(word, `<span class="st-file-redact">${escHtml(word)}</span>`);
    });
    return `>${next}<`;
  });
}

export function dropRedundantHeading(html, title) {
  const want = foldName(title);
  if (!want) return String(html || '');
  return String(html || '').replace(/^\s*<h1\b[^>]*>([\s\S]*?)<\/h1>/i, (full, inner) => {
    const got = foldName(String(inner).replace(/<[^>]+>/g, ' '));
    return got && (got === want || want.includes(got) || got.includes(want)) ? '' : full;
  });
}

function attr(tag, name) {
  const re = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const m = String(tag || '').match(re);
  return m ? (m[2] ?? m[3] ?? m[4] ?? '') : '';
}

function classForm(tag) {
  const m = String(tag || '').match(/\bst-file--([a-z]+)\b/i);
  return m ? normalizeForm(m[1]) : '';
}

export function normalizeFile(raw = {}) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const knownBy = normalizeKnownBy(src.knownBy);
  return {
    id: String(src.id || uid()),
    title: String(src.title || '').trim() || 'Untitled',
    form: normalizeForm(src.form),
    html: String(src.html || ''),
    tidbit: String(src.tidbit || '').trim(),
    physical: !!src.physical,
    itemId: String(src.itemId || '').trim(),
    cabinetOf: normalizeCabinetOf(src.cabinetOf),
    canAccess: normalizeKnownBy(src.canAccess),
    knownBy,
    unawareBy: normalizeKnownBy(src.unawareBy),
    known: knownBy.length > 0,
    public: !!src.public,
    familiarity: normalizeFamiliarity(src.familiarity),
    source: src.source && typeof src.source === 'object'
      ? {
        type: String(src.source.type || 'manual'),
        book: String(src.source.book || ''),
        uid: src.source.uid ?? '',
        mesId: src.source.mesId ?? '',
        part: String(src.source.part || ''),
      }
      : { type: 'manual', book: '', uid: '', mesId: '', part: '' },
    createdAt: Number(src.createdAt) || Date.now(),
    updatedAt: Number(src.updatedAt) || Date.now(),
  };
}

export function ensureCabinet(library) {
  const lib = library && typeof library === 'object' ? library : {};
  lib.cabinet ??= emptyCabinet();
  if (!Array.isArray(lib.cabinet.files)) lib.cabinet.files = [];
  lib.cabinet.files = lib.cabinet.files.map((raw) => {
    const n = normalizeFile(raw);
    if (raw && typeof raw === 'object' && raw.id) {
      Object.assign(raw, n, { id: String(raw.id) });
      return raw;
    }
    return n;
  });
  return lib.cabinet;
}

export function getCabinet(storage) {
  const lib = getLibraryChat(storage);
  return ensureCabinet(lib);
}

export function findFile(storage, id) {
  const want = String(id || '').trim();
  if (!want) return null;
  return getCabinet(storage).files.find(f => f.id === want) || null;
}

export function findFileByItem(storage, itemId) {
  const want = String(itemId || '').trim();
  if (!want) return null;
  return getCabinet(storage).files.find(f => f.itemId === want) || null;
}

export function findFileByTitle(files, title) {
  const key = foldName(title);
  if (!key) return null;
  const list = Array.isArray(files) ? files : [];
  return list.find(f => foldName(f.title) === key)
    || list.find(f => foldName(f.title).includes(key) || key.includes(foldName(f.title)))
    || null;
}

/** Files converted from the same lore entry, in cabinet order. */
export function filesInSameEntry(files, file) {
  if (!file) return [];
  const book = String(file.source?.book || '');
  const uid = String(file.source?.uid ?? '');
  if (file.source?.type !== 'lorebook' || !book || uid === '') return [file];
  const set = (Array.isArray(files) ? files : []).filter(f =>
    f?.source?.type === 'lorebook'
    && String(f.source.book || '') === book
    && String(f.source.uid ?? '') === uid);
  return set.length ? set : [file];
}

export function findFileByLoreSource(files, source) {
  if (!source || source.type !== 'lorebook') return null;
  const book = String(source.book || '');
  const uid = String(source.uid ?? '');
  if (!book || uid === '') return null;
  return (Array.isArray(files) ? files : []).find(f =>
    f.source?.type === 'lorebook'
    && String(f.source.book || '') === book
    && String(f.source.uid ?? '') === uid
    && String(f.source.part || '') === String(source.part || '')) || null;
}

export function listHouses(storage) {
  try {
    return storage.getChat('reputation', { house: [] }).house || [];
  } catch {
    return [];
  }
}

export function matchHouse(houses, name) {
  const n = foldName(name);
  if (!n) return null;
  const list = Array.isArray(houses) ? houses : [];
  return list.find(h => foldName(h.name) === n || foldName(h.alias) === n)
    || list.find(h => {
      const hn = foldName(h.name);
      const ha = foldName(h.alias);
      return (hn && (hn.includes(n) || n.includes(hn)))
        || (ha && (ha.includes(n) || n.includes(ha)));
    })
    || null;
}

export function filesForHouse(files, houseId) {
  const id = String(houseId || '').trim();
  if (!id) return [];
  return (Array.isArray(files) ? files : []).filter(f =>
    f.cabinetOf?.type === 'house' && f.cabinetOf.id === id);
}

export function filesUnfiled(files) {
  return (Array.isArray(files) ? files : []).filter(f => f.cabinetOf?.type !== 'house');
}

export function groupFilesByHouse(files, houses) {
  const list = Array.isArray(files) ? files : [];
  const hs = Array.isArray(houses) ? houses : [];
  const groups = hs.map(h => ({
    house: h,
    files: filesForHouse(list, h.id),
  }));
  return { groups, unfiled: filesUnfiled(list) };
}

export function createFile(spec = {}, { houses } = {}) {
  const cabinetOf = spec.cabinetOf
    || (spec.house
      ? (() => {
        const h = matchHouse(houses || [], spec.house);
        return h ? { type: 'house', id: h.id } : { type: 'library' };
      })()
      : { type: 'library' });
  const file = normalizeFile({
    ...spec,
    cabinetOf,
    html: spec.html || '',
  });
  return file;
}

export function upsertFile(cabinet, spec, { houses } = {}) {
  const cab = cabinet && typeof cabinet === 'object' ? cabinet : emptyCabinet();
  cab.files = Array.isArray(cab.files) ? cab.files : [];
  const next = createFile(spec, { houses });
  const src = spec.source && typeof spec.source === 'object' ? spec.source : next.source;
  const hit = (spec.id && cab.files.find(f => f.id === spec.id))
    || findFileByLoreSource(cab.files, src)
    || (src?.type === 'lorebook'
      ? null
      : cab.files.find(f => foldName(f.title) === foldName(next.title)));
  if (hit) {
    const keepId = hit.id;
    const keepItem = hit.itemId;
    Object.assign(hit, next, {
      id: keepId,
      itemId: next.itemId || keepItem,
      createdAt: hit.createdAt,
      updatedAt: Date.now(),
      html: spec.html != null ? next.html : (hit.html || ''),
      tidbit: spec.tidbit != null ? next.tidbit : (hit.tidbit || ''),
      knownBy: next.knownBy?.length ? next.knownBy : hit.knownBy,
      unawareBy: next.unawareBy?.length ? next.unawareBy : hit.unawareBy,
      canAccess: spec.canAccess != null ? next.canAccess : hit.canAccess,
      public: spec.public != null ? !!next.public : !!hit.public,
      familiarity: spec.familiarity != null ? next.familiarity : (hit.familiarity || []),
    });
    hit.known = hit.knownBy.length > 0;
    return hit;
  }
  cab.files.push(next);
  return next;
}

export function canHolderAccess(file, knower, houseIds = []) {
  if (!file || !knower) return false;
  if (file.public) return true;
  const list = normalizeKnownBy(file.canAccess);
  if (!list.length) return true;
  if (knower.type === 'house') {
    return list.some(k => k.type === 'house' && k.id === knower.id);
  }
  const cid = String(knower.id || '');
  return list.some(k =>
    (k.type === 'cast' && k.id === cid)
    || houseKnowerIncludesCast(k, cid, houseIds));
}

export function exposeFile(file, knower, { houseIds = [] } = {}) {
  if (!file || !knower) return file;
  if (!canHolderAccess(file, knower, houseIds)) return file;
  setKnowerStance(file, knower, 'knows');
  file.known = (file.knownBy || []).length > 0;
  file.updatedAt = Date.now();
  return file;
}

export function characterKnowsFile(file, characterId, houseIds = []) {
  if (!file || !characterId) return false;
  return (file.knownBy || []).some(k =>
    (k.type === 'cast' && k.id === characterId)
    || houseKnowerIncludesCast(k, characterId, houseIds));
}

function characterInTheDark(file, characterId, houseIds = []) {
  return (file?.unawareBy || []).some(k =>
    (k.type === 'cast' && k.id === characterId)
    || houseKnowerIncludesCast(k, characterId, houseIds));
}

const FAMILIARITY_LEVELS = Object.freeze(['dark', 'vague', 'aware', 'known']);

const FAMILIARITY_LINE = Object.freeze({
  known: 'known',
  aware: 'aware, kept quiet',
  vague: 'vague, half-remembered',
});

export function normalizeFamiliarity(list) {
  const out = [];
  const seen = new Set();
  for (const raw of list || []) {
    const id = String(raw?.id || '').trim();
    const level = FAMILIARITY_LEVELS.includes(raw?.level) ? raw.level : '';
    if (!id || !level || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, level });
  }
  return out;
}

/** Dark 40, vague 30, aware 20, known 10. `rng` returns 0–1. */
export function rollFamiliarity(rng = Math.random) {
  const n = Math.floor(Number(rng()) * 100);
  const roll = Number.isFinite(n) ? Math.min(99, Math.max(0, n)) : 0;
  if (roll < 40) return 'dark';
  if (roll < 70) return 'vague';
  if (roll < 90) return 'aware';
  return 'known';
}

/** Store one level the first time a character is considered. Origin affiliates start Aware. */
export function ensureFamiliarity(file, characterId, { houseIds = [], rng = Math.random, onAssign } = {}) {
  const id = String(characterId || '').trim();
  if (!file || !id) return '';
  file.familiarity = normalizeFamiliarity(file.familiarity);
  const hit = file.familiarity.find(row => row.id === id);
  if (hit) return hit.level;
  const origin = file.cabinetOf?.type === 'house' ? String(file.cabinetOf.id || '') : '';
  const affiliated = !!origin && (houseIds || []).map(x => String(x)).includes(origin);
  const level = affiliated ? 'aware' : rollFamiliarity(rng);
  file.familiarity.push({ id, level });
  if (typeof onAssign === 'function') onAssign();
  return level;
}

export function setFamiliarity(file, characterId, level) {
  const id = String(characterId || '').trim();
  if (!file || !id || !FAMILIARITY_LEVELS.includes(level)) return file;
  file.familiarity = normalizeFamiliarity(file.familiarity).filter(row => row.id !== id);
  file.familiarity.push({ id, level });
  return file;
}

/** Personal files first, then public ones the character is not barred from. */
export function recallFilesForCharacter(files, characterId, {
  houseIds = [],
  holds = () => false,
  canRead = () => true,
  rng = Math.random,
  onAssign,
} = {}) {
  const cid = String(characterId || '');
  const known = [];
  const aware = [];
  const vague = [];
  for (const f of (Array.isArray(files) ? files : [])) {
    if (!f) continue;
    if (f.public) {
      const level = ensureFamiliarity(f, cid, { houseIds, rng, onAssign });
      const row = { ...f, recallLevel: level };
      if (level === 'known') known.push(row);
      else if (level === 'aware') aware.push(row);
      else if (level === 'vague') vague.push(row);
      continue;
    }
    if (characterInTheDark(f, cid, houseIds)) continue;
    if (characterKnowsFile(f, cid, houseIds) || (holds(f) && canRead(f))) known.push(f);
  }
  return [...known, ...aware, ...vague];
}

function starIdOf(storage) {
  try {
    return (storage.getChat('cast', { characters: [] }).characters || [])
      .find(c => c?.priority === 'star')?.id || '';
  } catch {
    return '';
  }
}

export function characterHoldsFile(storage, file, characterId) {
  if (!file?.physical || !file.itemId || !characterId) return false;
  try {
    const world = worldFromStorage(storage);
    const found = findWorldItem(world, file.itemId);
    if (!found) return false;
    const loc = deriveLocator(found.item, found.hint);
    if (String(loc.ownerId) === String(characterId)) return true;
    return characterId === starIdOf(storage) && isStarOwner(loc.ownerId, world.characters);
  } catch {
    return false;
  }
}

export function filesKnownToCharacter(storage, characterId) {
  const cid = String(characterId || '');
  if (!cid) return [];
  const houseIds = characterHouseIds(storage, cid);
  let dirty = false;
  const rows = recallFilesForCharacter(getCabinet(storage).files, cid, {
    houseIds,
    holds: (f) => characterHoldsFile(storage, f, cid),
    canRead: (f) => canHolderAccess(f, { type: 'cast', id: cid }, houseIds),
    onAssign: () => { dirty = true; },
  });
  if (dirty && typeof storage?.saveChat === 'function') {
    try { storage.saveChat(); } catch { /* the roll is still on the live file */ }
  }
  return rows;
}

export function formatFileTidbits(files, { max = 8 } = {}) {
  const rows = (Array.isArray(files) ? files : []).slice(0, max);
  if (!rows.length) return '';
  return rows.map((f) => {
    const bit = String(f.tidbit || '').replace(/\s+/g, ' ').trim();
    const tag = FAMILIARITY_LINE[f.recallLevel] ? ` (${FAMILIARITY_LINE[f.recallLevel]})` : '';
    return bit ? `- ${f.title}${tag}: ${bit}` : `- ${f.title}${tag}`;
  }).join('\n');
}

function escHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, ch =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}

export function extractFileEnvelopes(html) {
  const s = String(html || '');
  if (!s.includes('st-file')) return [];
  const out = [];
  const re = /<aside\b([^>]*\bst-file\b[^>]*)>([\s\S]*?)<\/aside>/gi;
  let m;
  while ((m = re.exec(s))) {
    const open = m[1];
    const inner = m[2];
    const title = attr(open, 'data-title') || foldName(inner.replace(/<[^>]+>/g, ' ')).slice(0, 80) || 'Untitled';
    const form = normalizeForm(attr(open, 'data-form') || classForm(open) || 'file');
    const house = attr(open, 'data-house');
    out.push({
      title: String(title).trim() || 'Untitled',
      form,
      house,
      inner,
      html: m[0],
    });
  }
  return out;
}

/** Body inside the cabinet envelope, without the mast. */
export function editableFileBody(html) {
  const raw = unwrapFileBody(html);
  const boxed = raw.match(/<div\b[^>]*\bst-file-body\b[^>]*>([\s\S]*)<\/div>\s*$/i);
  if (boxed) return boxed[1].trim();
  return raw.replace(/<header\b[^>]*\bst-file-mast\b[^>]*>[\s\S]*?<\/header>/gi, '').trim();
}

function unwrapFileBody(html) {
  const raw = String(html || '').trim();
  if (!raw) return '';
  const envs = extractFileEnvelopes(raw);
  if (envs.length === 1 && /^<aside\b/i.test(raw)) {
    return String(envs[0].inner || '').trim();
  }
  return raw;
}

function bodyHasOwnHead(html) {
  return /<h[1-3]\b/i.test(String(html || ''));
}

/** Showtime paper chrome around preserved body HTML. Sanitize after wrap. */
export function dressFileHtml({ form, title, bodyHtml, house } = {}) {
  const f = normalizeForm(form);
  const t = String(title || '').trim() || 'Untitled';
  const body = unwrapFileBody(bodyHtml);
  const hid = String(house || '').trim();
  const houseAttr = hid ? ` data-house="${escHtml(hid)}"` : '';
  const mast = bodyHasOwnHead(body)
    ? ''
    : `<header class="st-file-mast"><span class="st-file-mast-k">${escHtml(formLabel(f))}</span><span class="st-file-mast-t">${escHtml(t)}</span></header>
  `;
  return `<aside class="st-file st-file--${escHtml(f)} st-file--lore" data-title="${escHtml(t)}" data-form="${escHtml(f)}"${houseAttr}>
  ${mast}<div class="st-file-body">${body}</div>
</aside>`;
}

export function stripFileEnvelopes(html) {
  return String(html || '').replace(/<aside\b[^>]*\bst-file\b[^>]*>[\s\S]*?<\/aside>/gi, '').trim();
}

export function buildChatFileHtml(file) {
  if (!file) return '';
  const body = file.html || `<p class="st-file-stub">On file — body not yet transcribed.</p>`;
  const house = file.cabinetOf?.type === 'house' ? file.cabinetOf.id : '';
  return `<details class="st-chat-slate st-chat-file" data-file-id="${escHtml(file.id)}">
  <summary class="st-chat-slate-sum">${escHtml(file.title || 'File')}${house ? ` · ${escHtml(house)}` : ''}</summary>
  <div class="st-clap-chrome st-chat-slate-chrome">
    <div class="st-file-frame st-file st-file--${escHtml(file.form || 'file')}">${body}</div>
  </div>
</details>`;
}

export function catchChatFiles(storage, mes, { mesId, sanitize = (s) => s } = {}) {
  const text = String(mes?.mes ?? '');
  const found = extractFileEnvelopes(text);
  if (!found.length) return { dirty: false, text, files: [] };
  const cab = getCabinet(storage);
  const houses = listHouses(storage);
  const files = [];
  for (const env of found) {
    const html = sanitize(env.html);
    const file = upsertFile(cab, {
      title: env.title,
      form: env.form,
      html,
      house: env.house,
      source: { type: 'chat', mesId: mesId ?? '' },
    }, { houses });
    files.push(file);
  }
  return { dirty: true, text: stripFileEnvelopes(text), files };
}

export function exposeLinkedItem(storage, itemId, ownerId) {
  const file = findFileByItem(storage, itemId);
  if (!file || !ownerId) return null;
  const houseIds = characterHouseIds(storage, ownerId);
  exposeFile(file, { type: 'cast', id: ownerId }, { houseIds });
  return file;
}

export function stubDocumentFromItem(storage, item, op = {}) {
  if (!item) return null;
  const want = op.document === true || op.document === 'true'
    || !!(op.form || op.house)
    || looksLikeDocumentName(item.name);
  if (!want) return null;
  const cab = getCabinet(storage);
  const houses = listHouses(storage);
  const file = upsertFile(cab, {
    id: findFileByItem(storage, item.id)?.id,
    title: String(op.title || item.name || 'Untitled'),
    form: op.form || formFromName(item.name),
    physical: op.physical !== false,
    itemId: item.id,
    house: op.house || '',
    tidbit: String(op.tidbit || op.reason || '').trim(),
    source: { type: 'receipt' },
  }, { houses });
  item.fileId = file.id;
  item.kind = item.kind || 'item';
  return file;
}

export function smokeFileCabinetPure() {
  try {
    const houses = [{ id: 'agency', name: 'Endeavor Agency', alias: 'Endeavor' }];
    const cab = emptyCabinet();
    const warrant = upsertFile(cab, {
      title: 'Provisional Transfer',
      form: 'warrant',
      house: 'Endeavor Agency',
      html: '<aside class="st-file st-file--warrant"><p>Weslie Becks</p></aside>',
    }, { houses });
    if (warrant.cabinetOf.type !== 'house' || warrant.cabinetOf.id !== 'agency') {
      return 'house attribution should match affiliation';
    }
    if ((warrant.canAccess || []).length) return 'origin should not seal clearance';
    warrant.canAccess = normalizeKnownBy([{ type: 'house', id: 'agency', share: 'none' }]);
    if (filesUnfiled(cab.files).length) return 'attributed file should not be unfiled';
    if (filesForHouse(cab.files, 'agency').length !== 1) return 'house drawer should list the warrant';

    exposeFile(warrant, { type: 'cast', id: 'hawks' }, { houseIds: [] });
    if ((warrant.knownBy || []).some(k => k.id === 'hawks')) {
      return 'sealed house file should not expose outsiders';
    }
    exposeFile(warrant, { type: 'house', id: 'agency' });
    if (!warrant.knownBy.some(k => k.type === 'house' && k.id === 'agency')) {
      return 'house itself should be exposable';
    }

    const firstLore = upsertFile(cab, {
      title: 'Asset 515-O',
      form: 'file',
      html: '<p>one</p>',
      source: { type: 'lorebook', book: 'RamNap', uid: '1' },
    });
    const secondLore = upsertFile(cab, {
      title: 'Asset 515-O',
      form: 'file',
      html: '<p>two</p>',
      source: { type: 'lorebook', book: 'RamNap', uid: '2' },
    });
    if (firstLore.id === secondLore.id) return 'lore converts with different uids must not overwrite';
    if (cab.files.filter(f => f.title === 'Asset 515-O').length !== 2) return 'two lore files should both stay on file';
    const again = upsertFile(cab, {
      title: 'Asset 515-O',
      form: 'file',
      html: '<p>updated</p>',
      source: { type: 'lorebook', book: 'RamNap', uid: '1' },
    });
    if (again.id !== firstLore.id || !/updated/.test(again.html)) return 're-converting the same lore uid should update that file';

    const letter = upsertFile(cab, {
      title: 'Note',
      form: 'letter',
      canAccess: [],
      html: '<aside class="st-file"><p>hello</p></aside>',
    });
    exposeFile(letter, { type: 'cast', id: 'weslie' });
    if (!letter.knownBy.some(k => k.id === 'weslie')) return 'open clearance should expose the holder';

    const html = `<p>lead</p><aside class="st-file st-file--letter" data-title="Folded letter" data-house="Endeavor">Hi</aside>`;
    const envs = extractFileEnvelopes(html);
    if (envs.length !== 1 || envs[0].title !== 'Folded letter' || envs[0].house !== 'Endeavor') {
      return 'envelope extract should read title and house';
    }
    if (!/lead/.test(stripFileEnvelopes(html)) || /st-file/.test(stripFileEnvelopes(html))) {
      return 'strip should drop the envelope and keep prose';
    }

    const grouped = groupFilesByHouse(cab.files, houses);
    if (grouped.groups[0].files.length !== 1) return 'group by house';
    if (!grouped.unfiled.some(f => f.title === 'Note')) return 'unfiled letter';

    const card = buildChatFileHtml(warrant);
    if (!card.includes('st-chat-file') || !card.includes('Provisional Transfer')) return 'chat card';
    if (knowerKey({ type: 'house', id: 'agency' }) !== 'house:agency') return 'knower key';

    const wrapped = dressFileHtml({
      form: 'letter',
      title: 'Dear Weslie',
      bodyHtml: '<p>Meet at <em>dusk</em>.</p>',
      house: 'agency',
    });
    if (!/<p>Meet at <em>dusk<\/em>\.<\/p>/.test(wrapped)) return 'wrap must keep source formatting';
    if (!/st-file-mast/.test(wrapped) || !/st-file--letter/.test(wrapped)) return 'wrap must add mast skin';
    if (!/data-form="letter"/.test(wrapped) || !/data-house="agency"/.test(wrapped)) {
      return 'wrap should stamp form and house';
    }
    const dossier = dressFileHtml({
      form: 'file',
      title: 'Asset 515-O',
      bodyHtml: '<h1>ASSET 515-O – CLASSIFIED DOSSIER</h1><p>Somnolen‑β</p>',
    });
    if (/st-file-mast/.test(dossier)) return 'documents with their own heading should not get a second mast';
    if (!/<h1>ASSET 515-O/.test(dossier)) return 'document heading must stay';
    if (normalizeForm('dossier') !== 'file') return 'dossier should file as a record, not a memo';
    const prepared = prepareLoreSource('---\nfileClass: lore\n---\n# Asset\nSee [[Weslie]] and [[HPSC|the Commission]].');
    if (/fileClass/.test(prepared) || /---/.test(prepared)) return 'frontmatter should be stripped';
    if (!/st-file-ref/.test(prepared) || /\[\[/.test(prepared)) return 'wiki links should become refs';
    if (!/the Commission/.test(prepared)) return 'wiki alias should be the visible label';
    const noMeta = prepareLoreSource('# Dossier\n\nOverview.\n\n<div class="meta-block">\n[Category: HPSC | Scope: Personal | Related: [[Weslie]]]\n</div>\n\n## 1. Next\nBody.');
    if (/Category:|meta-block|Who Knows|Scope:/.test(noMeta)) return 'lorebook meta should be stripped';
    if (!/# Dossier/.test(noMeta) || !/## 1\. Next/.test(noMeta) || !/Overview/.test(noMeta)) {
      return 'document body should survive meta strip';
    }
    const dropped = dropRedundantHeading('<h1>Asset 515-O</h1><h1>CLASSIFIED</h1>', 'Asset 515-O');
    if (/Asset 515-O/.test(dropped) || !/CLASSIFIED/.test(dropped)) return 'matching lead h1 should drop';
    if (guessFileForm('CLASSIFIED DOSSIER Document ID: HPSC') !== 'file') return 'classified copy should guess file';
    const nabu = [
      '# Nabu Island Sleep Plague',
      '## DOCUMENT A — PUBLIC ACCESS (Civilian Database)',
      '### NABU ISLAND HEALTH CRISIS — OFFICIAL REPORT',
      'Date Range: 14 June – 28 June [REDACTED YEAR]',
      '**[END PUBLIC DOCUMENT]**',
      '## DOCUMENT B — HPSC INTERNAL FILE (Level 7 Classification)',
      '### INCIDENT REPORT: NABU ISLAND QUIRK EVENT',
      'Classification: LEVEL 7 — RESTRICTED',
      '**[END INTERNAL FILE]**',
      '## DOCUMENT C — PARTIALLY REDACTED (Journalist/Investigator Access)',
      '### HPSC INCIDENT SUMMARY — NABU ISLAND',
      'Classification: PARTIALLY REDACTED / PUBLIC RECORD',
      '**[END REDACTED DOCUMENT]**',
      '## SUPPLEMENTARY — WITNESS TESTIMONY (Unofficial)',
      'Status: UNVERIFIED / HERESAY',
      'Then the sleeping started.',
    ].join('\n');
    const pieces = splitMarkedDocuments(nabu);
    if (pieces.length !== 4) return 'nabu headings should become four pieces';
    if (pieces[0].form !== 'clipping' || !/HEALTH CRISIS/i.test(pieces[0].title)) return 'public report should be a clipping';
    if (pieces[1].form !== 'file' || !/INCIDENT REPORT/i.test(pieces[1].title)) return 'internal file should stay a file';
    if (pieces[2].form !== 'clipping') return 'public redacted release should be a clipping';
    if (pieces[3].form !== 'note') return 'testimony should be a note';
    if (pieces.some(p => /\[END\b/i.test(p.body))) return 'end lines should not stay in the piece';
    const barred = barRedactions('<p>14 June [REDACTED YEAR]</p><p>PARTIALLY REDACTED</p><p>REDACTED</p>');
    if (!/st-file-redact">\[REDACTED YEAR\]/.test(barred)) return 'bracketed redaction should be a bar';
    if (!/st-file-redact">REDACTED</.test(barred)) return 'a lone REDACTED line should be a bar';
    if (!/>PARTIALLY REDACTED</.test(barred) || /st-file-redact">PARTIALLY/.test(barred)) {
      return 'a classification label should stay readable';
    }
    const batch = [
      { id: 'a', title: 'Report', source: { type: 'lorebook', book: 'Ram', uid: '4', part: '' } },
      { id: 'b', title: 'File', source: { type: 'lorebook', book: 'Ram', uid: '4', part: 'File' } },
      { id: 'c', title: 'Note', source: { type: 'manual', book: '', uid: '' } },
    ];
    const siblings = filesInSameEntry(batch, batch[0]);
    if (siblings.length !== 2 || siblings[1].id !== 'b') return 'lore siblings should page together';
    if (filesInSameEntry(batch, batch[2]).length !== 1) return 'a manual file should stay one page';
    const recall = recallFilesForCharacter([
      { title: 'Letter', public: false, knownBy: [{ type: 'cast', id: 'wes' }], unawareBy: [], tidbit: 'Meet at dusk' },
      { title: 'Notice', public: true, familiarity: [{ id: 'wes', level: 'known' }], tidbit: 'Posted on the board' },
      { title: 'Brief', public: true, familiarity: [{ id: 'wes', level: 'aware' }], tidbit: 'Kept quiet' },
      { title: 'Rumor', public: true, familiarity: [{ id: 'wes', level: 'vague' }], tidbit: 'Half remembered' },
      { title: 'Secret', public: true, familiarity: [{ id: 'wes', level: 'dark' }], tidbit: 'Hidden' },
    ], 'wes');
    if (recall.map(f => f.title).join(',') !== 'Letter,Notice,Brief,Rumor') {
      return 'known, then aware, then vague; dark is omitted';
    }
    const cue = formatFileTidbits(recall);
    if (!/Notice \(known\): Posted/.test(cue)) return 'a known public file should say known';
    if (!/Brief \(aware, kept quiet\)/.test(cue)) return 'an aware file should stay quiet';
    if (!/Rumor \(vague, half-remembered\)/.test(cue)) return 'a vague file should be half-remembered';
    if (/Secret/.test(cue) || /Letter \(/.test(cue) || /clearance/i.test(cue)) {
      return 'dark and private rows stay plain, and the cue should not mention clearance';
    }
    const rolled = { public: true, cabinetOf: { type: 'library' }, familiarity: [] };
    ensureFamiliarity(rolled, 'mirko', { houseIds: [], rng: () => 0 });
    ensureFamiliarity(rolled, 'mirko', { houseIds: [], rng: () => 0.99 });
    if (rolled.familiarity[0]?.level !== 'dark') return 'a familiarity roll should stick';
    const insider = { public: true, cabinetOf: { type: 'house', id: 'hpsc' }, familiarity: [] };
    ensureFamiliarity(insider, 'hawks', { houseIds: ['hpsc'], rng: () => 0 });
    if (insider.familiarity[0]?.level !== 'aware') return 'an origin affiliate should start aware';
    if (rollFamiliarity(() => 0) !== 'dark' || rollFamiliarity(() => 0.4) !== 'vague') return 'roll weights';
    if (rollFamiliarity(() => 0.7) !== 'aware' || rollFamiliarity(() => 0.9) !== 'known') return 'roll weights';
    const sealed = { public: false, canAccess: [{ type: 'house', id: 'agency', share: 'none' }] };
    if (canHolderAccess(sealed, { type: 'cast', id: 'outsider' }, [])) return 'clearance should still block a private file';
    const opened = { public: true, canAccess: sealed.canAccess };
    if (!canHolderAccess(opened, { type: 'cast', id: 'outsider' }, [])) return 'public should override clearance';
    const dressed = dressFileHtml({ form: 'note', title: 'Scrap', bodyHtml: '<p>Keep this.</p>' });
    if (editableFileBody(dressed) !== '<p>Keep this.</p>') return 'the editor should unwrap the body';

    return '';
  } catch (err) {
    return String(err?.message || err);
  }
}
