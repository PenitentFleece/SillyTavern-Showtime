// Compact Cast scene-delta: stats + condition + wardrobe/props add/update/remove.

import { clipText, scanClothingCues, scanPropCues, playMessagesSince, listGarmentMentions, listKitCueSpans, lineHasKitCue } from './chatTrack.js';
import { castNameMatches, normalizeAliases } from './castCatalog.js';
import { extractJsonValue } from './jsonExtract.js';
import { formatAmountLine } from './invAmount.js';
import { formatCarryBrief, inferKitKind, kitDescendantIds, findKitByName, nestUnder } from './kitNest.js';

export const ITEM_CONDITION_IDS = Object.freeze([
  'pristine', 'fine', 'worn', 'damaged', 'broken', 'ruined',
]);

const SCENE_CAP = 1400;
const LINE_CAP = 360;
const COND_CAP = 2000;
export const STATS_SCENE_CAP = 1800;
export const STATS_LINE_CAP = 480;
export const KIT_SCENE_CAP = 3200;
export const KIT_LINE_CAP = 1800;

/** Display-name / synonym → stored tracker id (hunger=satiety, bathroom=bladder, …). */
const STAT_KEY_ALIASES = Object.freeze({
  health: ['health', 'hp'],
  energy: ['energy', 'stamina'],
  hunger: ['hunger', 'satiety', 'fullness', 'sated', 'food'],
  thirst: ['thirst', 'hydration', 'hydrated', 'drink'],
  bathroom: ['bathroom', 'bladder', 'pee', 'urine'],
  hygiene: ['hygiene', 'odor', 'odour', 'smell', 'stink'],
});

function foldKey(s) {
  return String(s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

export function resolveTrackerId(raw, trackers = []) {
  const key = foldKey(raw);
  if (!key) return '';
  const list = Array.isArray(trackers) ? trackers : [];
  for (const t of list) {
    const id = String(t?.id || (typeof t === 'string' ? t : '')).trim();
    if (!id) continue;
    if (foldKey(id) === key) return id;
    if (foldKey(t?.label) === key) return id;
  }
  for (const [id, aliases] of Object.entries(STAT_KEY_ALIASES)) {
    if (!aliases.includes(key)) continue;
    const hit = list.find(t => foldKey(t?.id || (typeof t === 'string' ? t : '')) === id);
    if (hit) return String(hit.id || hit);
    if (!list.length) return id;
  }
  return '';
}

export function coerceStatInt(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.max(0, Math.min(100, Math.round(v)));
  if (typeof v === 'string') {
    const n = Number(String(v).replace(/%/g, '').trim());
    if (Number.isFinite(n)) return Math.max(0, Math.min(100, Math.round(n)));
  }
  return null;
}

function uid() {
  return crypto?.randomUUID?.() ?? (`c_${Math.random().toString(36).slice(2, 10)}`);
}

export function clampItemCondition(raw, fallback = 'pristine') {
  const id = String(raw || '').trim().toLowerCase();
  return ITEM_CONDITION_IDS.includes(id) ? id : fallback;
}

export function plainMes(mes) {
  return String(mes ?? '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function atWordStart(text, i) {
  let n = Math.max(0, Math.min(text.length, i));
  while (n > 0 && !/\s/.test(text[n - 1])) n--;
  while (n < text.length && /\s/.test(text[n])) n++;
  return n;
}

function atWordEnd(text, i) {
  let n = Math.max(0, Math.min(text.length, i));
  while (n < text.length && !/\s/.test(text[n])) n++;
  return n;
}

function mergeSpans(spans) {
  const list = (spans || []).slice().sort((a, b) => a.from - b.from);
  const out = [];
  for (const s of list) {
    const last = out[out.length - 1];
    if (last && s.from <= last.to + 1) last.to = Math.max(last.to, s.to);
    else out.push({ from: s.from, to: s.to });
  }
  return out;
}

function expandCueSpan(text, span, radius = 140) {
  const leftBound = Math.max(0, span.from - radius);
  const rightBound = Math.min(text.length, span.to + radius);
  const left = text.slice(leftBound, span.from);
  const punctL = Math.max(left.lastIndexOf('.'), left.lastIndexOf('!'), left.lastIndexOf('?'));
  let from = punctL >= 0 ? leftBound + punctL + 1 : leftBound;
  const right = text.slice(span.to, rightBound);
  const punctR = right.search(/[.!?]/);
  let to = punctR >= 0 ? span.to + punctR + 1 : rightBound;
  from = atWordStart(text, from);
  to = atWordEnd(text, to);
  if (to < span.to) to = span.to;
  if (from > span.from) from = atWordStart(text, span.from);
  return { from, to };
}

function joinPieces(text, spans) {
  const merged = mergeSpans(spans);
  if (!merged.length) return '';
  let out = '';
  let prevTo = 0;
  for (const w of merged) {
    const chunk = text.slice(w.from, w.to).trim();
    if (!chunk) continue;
    if (out) out += w.from <= prevTo + 1 ? ' ' : ' … ';
    out += chunk;
    prevTo = w.to;
  }
  return out.replace(/\s+/g, ' ').trim();
}

function wordHeadTail(text, limit) {
  const gap = ' … ';
  if (text.length <= limit) return text;
  const keep = Math.max(24, Math.floor((limit - gap.length) / 2));
  let head = text.slice(0, keep).replace(/\s+\S*$/, '').trimEnd();
  let tail = text.slice(-keep).replace(/^\S*\s+/, '').trimStart();
  if (!head || !tail) {
    const one = text.slice(0, limit).replace(/\s+\S*$/, '').trimEnd();
    return one || text.slice(0, limit);
  }
  let out = `${head}${gap}${tail}`;
  if (out.length > limit) {
    const one = text.slice(0, limit).replace(/\s+\S*$/, '').trimEnd();
    return one || text.slice(0, limit);
  }
  return out;
}

function splitSentences(text) {
  const parts = [];
  const re = /[^.!?]+(?:[.!?]+|$)/g;
  let m;
  while ((m = re.exec(text))) {
    const raw = m[0];
    if (!raw.trim()) continue;
    parts.push({ from: m.index, to: m.index + raw.length, text: raw.trim() });
  }
  return parts;
}

/**
 * Shrink a chat body under `cap` without splitting words.
 * Dressing / pocket / tracker sentences in the middle stay even when the
 * rest of a long message is dropped.
 */
export function clipChatBody(full, cap) {
  const text = String(full || '').replace(/\s+/g, ' ').trim();
  const limit = Math.max(40, Number(cap) || LINE_CAP);
  if (text.length <= limit) return text;

  const sents = splitSentences(text);
  if (sents.length >= 2) {
    const n = sents.length;
    const cue = sents.map(s => lineHasKitCue(s.text));
    const order = [];
    for (let i = 0; i < n; i++) if (cue[i]) order.push(i);
    order.push(0, n - 1);
    if (n > 2) order.push(1, n - 2);
    for (let i = n - 1; i >= 0; i--) order.push(i);
    const chosen = new Set();
    const joinChosen = () => {
      const idxs = [...chosen].sort((a, b) => a - b);
      let out = '';
      let prev = -99;
      for (const i of idxs) {
        if (out) out += i === prev + 1 ? ' ' : ' … ';
        out += sents[i].text;
        prev = i;
      }
      return out;
    };
    for (const i of order) {
      if (chosen.has(i)) continue;
      chosen.add(i);
      if (joinChosen().length > limit) chosen.delete(i);
    }
    const packed = joinChosen();
    if (packed && packed.length <= limit) {
      if (!cue.some(Boolean) || lineHasKitCue(packed)) return packed;
    }
  }

  const cueSpans = mergeSpans(
    listKitCueSpans(text).map(s => expandCueSpan(text, s, 150)),
  );
  if (cueSpans.length) {
    const pieces = cueSpans.map(s => ({ from: s.from, to: s.to }));
    if (pieces[0].from > 16) {
      pieces.unshift({ from: 0, to: atWordEnd(text, Math.min(pieces[0].from, Math.floor(limit * 0.22))) });
    }
    const last = pieces[pieces.length - 1];
    if (last.to < text.length - 16) {
      pieces.push({ from: atWordStart(text, Math.max(last.to, text.length - Math.floor(limit * 0.22))), to: text.length });
    }
    let out = joinPieces(text, pieces);
    if (out.length > limit) out = joinPieces(text, cueSpans);
    if (out.length > limit) {
      const room = limit;
      let acc = '';
      for (const w of mergeSpans(cueSpans)) {
        const chunk = text.slice(w.from, w.to).trim();
        const next = acc ? `${acc} … ${chunk}` : chunk;
        if (next.length > room) {
          if (!acc) return wordHeadTail(chunk, room);
          break;
        }
        acc = next;
      }
      out = acc || out;
    }
    if (out && lineHasKitCue(out)) return out.length <= limit ? out : wordHeadTail(out, limit);
  }
  return wordHeadTail(text, limit);
}

export function formatChatLine(m, lineCap = LINE_CAP) {
  const full = plainMes(m?.mes);
  if (!full) return '';
  const cap = Math.max(40, Number(lineCap) || LINE_CAP);
  const body = clipChatBody(full, cap);
  const name = String(m?.name || (m?.is_user ? 'You' : '')).trim() || '…';
  return `${name}: ${body}`;
}

function namesOf(char) {
  const primary = String(char?.name || '').trim();
  const aliases = normalizeAliases(char?.aliases);
  return [primary, ...aliases].filter(Boolean);
}

function messagesAbout(play, char) {
  if (!char) return play.slice(-8);
  // Star tracker cues live in narration (assistant lines), not only user turns.
  if (char.priority === 'star') return play.slice(-8);
  const names = namesOf(char).map(n => n.toLowerCase());
  if (!names.length) return play.slice(-8);
  const byChar = play.filter(m => {
    const spoken = String(m?.name || '').trim();
    return names.some(n => spoken.toLowerCase() === n) || castNameMatches(char, spoken);
  });
  const mentioning = play.filter(m => {
    const body = plainMes(m?.mes).toLowerCase();
    return names.some(n => n.length >= 2 && body.includes(n));
  });
  const seen = new Set();
  const merged = [];
  for (const row of [...play.slice(-4), ...byChar.slice(-4), ...mentioning.slice(-3)]) {
    if (seen.has(row)) continue;
    seen.add(row);
    merged.push(row);
  }
  merged.sort((a, b) => play.indexOf(a) - play.indexOf(b));
  return merged.slice(-8);
}

function excerptRows(chat, { sinceCount, char } = {}) {
  const play = Array.isArray(chat) ? chat.filter(m => m && !m.is_system) : [];
  let rows;
  if (Number.isFinite(Number(sinceCount)) && Number(sinceCount) >= 0) {
    rows = playMessagesSince(chat, sinceCount);
    if (!rows.length) rows = play.slice(-4);
  } else {
    rows = messagesAbout(play, char);
    if (rows.length < 2) rows = play.slice(-8);
  }
  return rows;
}

/**
 * Cadence: only messages since last track. Manual: last ~6 lines by/about char.
 */
export function sceneExcerpt(chat, {
  sinceCount,
  char,
  cap = SCENE_CAP,
  lineCap = LINE_CAP,
} = {}) {
  const rows = excerptRows(chat, { sinceCount, char });
  return clipExcerptToLines(
    rows.map(m => formatChatLine(m, lineCap)).filter(Boolean).join('\n'),
    cap,
    { keepIf: lineHasKitCue },
  );
}

/** Unclipped bodies for the same rows sceneExcerpt would use — garment names survive even when Scene is shortened. */
export function sceneKitHay(chat, { sinceCount, char } = {}) {
  return excerptRows(chat, { sinceCount, char }).map(m => plainMes(m?.mes)).filter(Boolean).join('\n');
}

/** Keep newest whole lines under `cap`, never cut through a line.
 *  Lines that mention clothes / kit / status are kept even when older. */
export function clipExcerptToLines(text, cap, { keepIf } = {}) {
  const raw = String(text || '');
  const limit = Math.max(200, Number(cap) || SCENE_CAP);
  if (raw.length <= limit) return raw;
  const lines = raw.split('\n').filter(l => l !== '');
  if (!lines.length) return clipChatBody(raw, limit);

  const chosen = new Set();
  let size = 0;
  const tryAdd = (i) => {
    if (i < 0 || i >= lines.length || chosen.has(i)) return;
    const line = lines[i];
    const add = (chosen.size ? 1 : 0) + line.length;
    if (chosen.size && size + add > limit) return;
    if (!chosen.size && line.length > limit) {
      chosen.add(i);
      size += line.length;
      return;
    }
    chosen.add(i);
    size += add;
  };
  if (typeof keepIf === 'function') {
    for (let i = lines.length - 1; i >= 0; i--) {
      if (keepIf(lines[i])) tryAdd(i);
    }
  }
  for (let i = lines.length - 1; i >= 0; i--) tryAdd(i);
  return lines.filter((_, i) => chosen.has(i)).join('\n');
}

export function kitSnapshot(char, { trackerLines = '', trackerIds = [], trackerRows = [], knownKit = '', consumables = '' } = {}) {
  const wear = (char?.wardrobe ?? [])
    .map(x => `${x.name}${x.condition && x.condition !== 'pristine' ? ` (${x.condition})` : ''}`)
    .filter(Boolean)
    .join('; ') || 'None';
  const carry = formatCarryBrief(char?.props ?? []);
  return {
    wearing: wear,
    carrying: carry,
    condition: clipText(char?.condition || '', 240) || 'None',
    trackers: String(trackerLines || '').trim(),
    trackerIds: Array.isArray(trackerIds) ? trackerIds.map(String).filter(Boolean) : [],
    trackerRows: Array.isArray(trackerRows) ? trackerRows : [],
    knownKit: String(knownKit || '').trim(),
    consumables: String(consumables || '').trim(),
  };
}

function foldName(s) {
  return String(s || '').trim().toLowerCase();
}

function lastSignificantWord(name) {
  const parts = foldName(name).split(/\s+/).filter(w => w.length >= 4);
  return parts[parts.length - 1] || '';
}

/** True when a filed name is the same object the scene is talking about. */
export function kitNameRelevant(name, scene = '', garments = []) {
  const n = foldName(name);
  if (!n) return false;
  const hay = String(scene || '').toLowerCase();
  const named = Array.isArray(garments) ? garments : [];
  if (named.some((g) => {
    const gk = foldName(g);
    return gk && (n.includes(gk) || gk.includes(n));
  })) return true;
  if (n.length >= 3 && hay.includes(n)) return true;
  const last = lastSignificantWord(n);
  return !!(last && hay.includes(last));
}

/**
 * Compact roster of objects already filed: body kit, inventory, set clutter, lost & found.
 * Body lists for the audited kinds are always listed. Inventory / set / lost / the
 * other kit type only when the scene names them.
 */
export function collectKnownKitEntries({
  char,
  inventory = [],
  setPieces = [],
  lost = [],
  scene = '',
  max = 36,
  include,
} = {}) {
  const garments = listGarmentMentions(scene);
  const cap = Math.max(8, Number(max) || 36);
  const kinds = Array.isArray(include) && include.length
    ? new Set(include)
    : new Set(['wardrobe', 'props']);
  const bodyWardrobe = kinds.has('wardrobe');
  const bodyProps = kinds.has('props');
  const entries = [];
  const seenName = new Set();
  const seenKey = new Set();

  const push = (e, { requireRelevant = false } = {}) => {
    const name = String(e?.name || '').trim();
    if (!name) return false;
    if (requireRelevant && !kitNameRelevant(name, scene, garments)) return false;
    const nk = foldName(name);
    const key = e.id ? `${e.source}:${e.id}` : `n:${e.source}:${nk}`;
    if (seenKey.has(key) || seenName.has(nk)) return false;
    seenKey.add(key);
    seenName.add(nk);
    entries.push({
      source: e.source,
      id: String(e.id || ''),
      name,
      condition: String(e.condition || ''),
      extra: String(e.extra || ''),
    });
    return true;
  };

  for (const w of char?.wardrobe || []) {
    push({
      source: 'wardrobe',
      id: w.id,
      name: w.name,
      condition: w.condition,
      extra: 'on body',
    }, { requireRelevant: !bodyWardrobe });
  }
  for (const p of char?.props || []) {
    push({
      source: 'props',
      id: p.id,
      name: p.name,
      condition: p.condition,
      extra: 'carried',
    }, { requireRelevant: !bodyProps });
  }

  const invSorted = [...(inventory || [])].sort((a, b) => {
    const score = (x) => (kitNameRelevant(x?.name, scene, garments) ? 0 : 1);
    return score(a) - score(b);
  });
  let invN = 0;
  for (const x of invSorted) {
    if (invN >= 24 || entries.length >= cap) break;
    const loc = (x.location === 'mobile' || x.location === 'person') ? 'on person' : 'in trunk';
    const eq = x.equippedTo ? ' · equipped' : '';
    const cat = x.category ? ` · ${x.category}` : (x.kind === 'container' ? ' · container' : '');
    const parent = (inventory || []).find(p => p?.id && p.id === x.parentId);
    const nest = parent?.name ? ` · in ${parent.name}` : '';
    const amt = formatAmountLine(x);
    if (push({
      source: 'inv',
      id: x.id,
      name: x.name,
      condition: x.condition,
      extra: `${loc}${eq}${cat}${nest}${amt ? ` · ${amt}` : ''}`,
    }, { requireRelevant: true })) invN += 1;
  }

  for (const p of lost || []) {
    if (entries.length >= cap) break;
    push({
      source: 'lost',
      id: p.id,
      name: p.name,
      condition: p.condition,
      extra: 'lost & found',
    }, { requireRelevant: true });
  }

  for (const p of setPieces || []) {
    if (entries.length >= cap) break;
    if (p?.layer === 'fixtures') continue;
    const garmentish = garments.some((g) => {
      const n = foldName(p?.name);
      const gk = foldName(g);
      return n && gk && (n.includes(gk) || gk.includes(n));
    });
    if (p?.layer === 'furniture' && !garmentish) continue;
    push({
      source: 'set',
      id: p.id,
      name: p.name,
      condition: p.condition,
      extra: `${p.placeName || 'set'}${p.layer ? ` · ${p.layer}` : ''}`,
    }, { requireRelevant: true });
  }

  return entries.slice(0, cap);
}

export function formatKnownKitRoster(entries) {
  const rows = Array.isArray(entries) ? entries : [];
  if (!rows.length) return '';
  return rows.map((e) => {
    const cond = e.condition && e.condition !== 'pristine' ? ` (${e.condition})` : '';
    const extra = e.extra ? ` — ${e.extra}` : '';
    const id = e.id ? ` id=${e.id}` : '';
    return `- ${e.source} · "${e.name}"${cond}${id}${extra}`;
  }).join('\n');
}

export function cadenceIncludeSet(char, sceneText, { statsEnabled = false } = {}) {
  const include = [];
  if (statsEnabled) include.push('stats');
  include.push('condition');
  if (scanClothingCues(sceneText) || (char?.wardrobe?.length)) include.push('wardrobe');
  if (scanPropCues(sceneText) || (char?.props?.length)) include.push('props');
  return include;
}

export function auditIncludeForKind(kind, char) {
  if (kind === 'wardrobe') return ['wardrobe'];
  if (kind === 'props') return ['props'];
  if (kind === 'condition') return ['condition'];
  if (kind === 'stats') {
    const include = [];
    if (char?.stats?.enabled) include.push('stats');
    include.push('condition');
    return include;
  }
  if (kind === 'kit' || kind === 'cadence') {
    return cadenceIncludeSet(char, '', { statsEnabled: !!char?.stats?.enabled });
  }
  return [];
}

export function matchItemExact(list, name, id = '') {
  const wantId = String(id || '').trim();
  if (wantId && Array.isArray(list)) {
    const byId = list.findIndex(x =>
      String(x?.id || '') === wantId || String(x?.inventoryId || '') === wantId);
    if (byId >= 0) return byId;
  }
  const key = foldName(name);
  if (!key || !Array.isArray(list)) return -1;
  return list.findIndex(x => foldName(x?.name) === key);
}

export function matchItemName(list, name, id = '') {
  const exact = matchItemExact(list, name, id);
  if (exact >= 0) return exact;
  const key = foldName(name);
  if (!key || !Array.isArray(list)) return -1;
  return list.findIndex(x => {
    const n = foldName(x?.name);
    if (!n) return false;
    return n.includes(key) || key.includes(n);
  });
}

function itemDeltaSchema() {
  return {
    type: 'object',
    properties: {
      add: {
        type: 'array',
        maxItems: 18,
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            id: { type: 'string' },
            description: { type: 'string' },
            condition: { type: 'string' },
            kind: { type: 'string' },
            inside: { type: 'string' },
          },
        },
      },
      update: {
        type: 'array',
        maxItems: 18,
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            condition: { type: 'string' },
            description: { type: 'string' },
            kind: { type: 'string' },
            inside: { type: 'string' },
          },
        },
      },
      remove: { type: 'array', maxItems: 6, items: { type: 'string' } },
    },
  };
}

export function castDeltaSchema(include, { trackerIds = [] } = {}) {
  const keys = Array.isArray(include) ? include : [];
  const properties = {};
  if (keys.includes('stats')) {
    const statsProps = Object.fromEntries(
      (trackerIds || []).map(id => [id, { type: 'number' }]),
    );
    properties.stats = { type: 'object', properties: statsProps };
  }
  if (keys.includes('condition')) {
    properties.condition = {
      type: 'object',
      properties: {
        changed: { type: 'boolean' },
        text: { type: 'string' },
      },
    };
  }
  if (keys.includes('wardrobe')) properties.wardrobe = itemDeltaSchema();
  if (keys.includes('props')) properties.props = itemDeltaSchema();
  return {
    name: 'cast_delta',
    description: 'Scene delta for Cast kit',
    strict: false,
    returnInvalid: true,
    value: { type: 'object', properties },
  };
}

export function buildCastDeltaPrompt({
  who,
  scene,
  snapshot,
  include,
  difficultyHint = '',
  garmentHay = '',
} = {}) {
  const keys = Array.isArray(include) ? include : [];
  const want = new Set(keys);
  const trackerRows = Array.isArray(snapshot?.trackerRows) ? snapshot.trackerRows : [];
  const trackerIds = (snapshot?.trackerIds || []).map(String).filter(Boolean);
  const idList = trackerIds.length
    ? trackerIds
    : trackerRows.map(t => t.id).filter(Boolean);
  const current = [];
  if (want.has('wardrobe')) current.push(`Wearing: ${snapshot?.wearing || 'None'}`);
  if (want.has('props')) current.push(`Carrying: ${snapshot?.carrying || 'None'}`);
  if (want.has('condition')) current.push(`Condition: ${snapshot?.condition || 'None'}`);
  if (want.has('stats') && snapshot?.trackers) current.push(`Trackers (id → now):\n${snapshot.trackers}`);
  if (want.has('stats') && snapshot?.consumables) {
    current.push(`On-person packs (fill / remaining — eating or drinking from these moves Satiety or Hydration):\n${snapshot.consumables}`);
  }
  if (want.has('wardrobe')) {
    const named = listGarmentMentions(`${garmentHay || ''}\n${scene || ''}`);
    if (named.length) current.push(`Named garments in the scene:\n${named.map(g => `- ${g}`).join('\n')}`);
  }
  if ((want.has('wardrobe') || want.has('props')) && snapshot?.knownKit) {
    current.push(`Known kit (already accounted for — reuse these names and ids, do not mint a second copy):\n${snapshot.knownKit}`);
  }

  const shape = [];
  if (want.has('stats')) {
    const example = (idList.length ? idList : ['health', 'energy'])
      .map(id => `"${id}": 80`)
      .join(', ');
    shape.push(`"stats": { ${example} }`);
  }
  if (want.has('condition')) {
    shape.push('"condition": {"changed": false} OR {"changed": true, "text": "1-3 sentences"}');
  }
  const itemShape = '{"add":[{"name":"","id":"","description":"","condition":"pristine|fine|worn|damaged|broken|ruined","kind":"item|container","inside":""}],"update":[{"name":"","condition":"","inside":""}],"remove":["name"]}';
  if (want.has('wardrobe')) shape.push(`"wardrobe": ${itemShape}`);
  if (want.has('props')) shape.push(`"props": ${itemShape}`);

  const rules = [
    `JSON object only — first character must be {. Audit ${who} from the Scene below. No card lore. Only what the scene clearly shows. Do not write Adjusting/Current/Keep at, scratch work, or any text outside the JSON.`,
  ];
  if (want.has('stats')) {
    const ids = idList.join(', ') || 'the listed ids';
    rules.push(
      `stats keys MUST be these ids exactly: ${ids}. Never use display names as keys (not Satiety, Hydration, Bladder, Odor).`,
      'Polarity — hunger=satiety/fullness (eating RAISES hunger; skipping meals LOWERS it). thirst=hydration (drinking RAISES thirst). bathroom=bladder pressure (needing to pee RAISES bathroom; relieving LOWERS it toward 0). hygiene=odor (dirt/sweat RAISES hygiene; washing LOWERS it toward 0). health and energy: higher is better.',
      'Return an integer 0–100 for EVERY listed tracker id. If the scene does not clearly move one, repeat its current number. When the scene does show eating, drinking, injury, rest, toileting, or getting dirty/clean, MOVE that tracker — do not leave every bar identical.',
    );
    if (difficultyHint) rules.push(difficultyHint);
  }
  if (want.has('condition')) {
    rules.push('condition.changed must be false unless physical/mental state clearly changed; do not rewrite unchanged notes.');
  }
  if (want.has('wardrobe') || want.has('props')) {
    rules.push(
      'add only items the scene names that are not already in Current. update wear/condition of existing names. remove names taken off, dropped, or no longer held. Do not invent garments or objects that are not in the Scene.',
      'If Known kit already lists the object (inv, set/room, or lost & found), add it with that same name and include its id. Do not invent a synonym or a second copy of a shirt, boot, or prop that is already filed.',
    );
  }
  if (want.has('wardrobe')) {
    rules.push(
      'wardrobe = clothes on the body. A dressing montage that lists garments ("the canvas work shirt, the windbreaker over the top. Trousers… His boots") means those garments are PUT ON — add each one.',
      'A named garment is worn unless the text says it was left unused, taken off, or only sitting nearby without being donned. "over the top" is a layer they put on. Boots/shoes by the door that they then lace or tie ARE worn.',
      'Torn, ripped, stained, or ragged details belong on that garment\'s condition (worn/damaged), not as a separate prop. Prefer short names: "canvas work shirt", "windbreaker", "trousers", "boots".',
    );
  }
  if (want.has('props')) {
    rules.push(
      'props = objects carried, not worn. A torn pocket on trousers is wardrobe, not a carried pocket.',
      'A bag/pack/satchel/case is one container. Distinct objects slid, pocketed, or stuffed into it MUST be added with inside=that container name (kind item). They stay accounted for as contents — do not list them as extra loose props. Clothes stuffed into a bag are props (inside the bag), not wardrobe. Add the container first if it is new.',
    );
  }
  if (!want.has('stats')) {
    rules.push('Omit keys you were not asked for. Empty add/update/remove arrays if none.');
  }

  return `${rules.join('\n')}
Current:
${current.join('\n') || 'None'}
Scene:
${scene || '(no recent scene)'}
Return exactly:
{${shape.join(', ')}}`;
}

/** Starting wardrobe/props from a character card or written description (not a chat scene). */
export function buildCastDressPrompt({ who, sourceLabel = 'description', sourceText = '' } = {}) {
  return `JSON object only — first character must be {. Dress ${who} from the ${sourceLabel} below. This is their starting kit from the writeup, not a chat scene.
appearance: 1–3 sentences of how they read at a glance (build, face, notable marks). Empty string if the writeup does not support it.
wardrobe.add: clothes they are described as wearing on the body. Short names from the text. Do not invent unnamed underwear.
props.add: objects they are described as carrying. A bag/pack/satchel/case is one container; contents must set inside=that container name (kind item). Clothes stuffed in a bag are props, not wardrobe.
update and remove must be empty arrays. Do not mint garments or objects that are not in the writeup.
Return exactly:
{"appearance":"","wardrobe":{"add":[{"name":"","description":"","condition":"pristine","kind":"item","inside":""}],"update":[],"remove":[]},"props":{"add":[{"name":"","description":"","condition":"pristine","kind":"item","inside":""}],"update":[],"remove":[]}}
Writeup:
${sourceText || '(none)'}`;
}

export function castDressSchema() {
  return {
    name: 'cast_dress',
    description: 'Starting kit from a character writeup',
    strict: false,
    returnInvalid: true,
    value: {
      type: 'object',
      properties: {
        appearance: { type: 'string' },
        wardrobe: itemDeltaSchema(),
        props: itemDeltaSchema(),
      },
    },
  };
}

export function parseCastDress(text) {
  const delta = parseCastDelta(text, { include: ['wardrobe', 'props'] });
  const raw = extractJsonValue(text) || {};
  return {
    ...delta,
    appearance: String(raw.appearance || raw.look || '').trim().slice(0, 400),
  };
}

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

function normalizeDeltaItem(it) {
  if (typeof it === 'string') return { name: String(it).trim() };
  if (!it || typeof it !== 'object') return { name: '' };
  return {
    name: String(it.name || it.item || '').trim(),
    description: it.description,
    condition: it.condition,
    id: String(it.id || it.fromId || it.inventoryId || '').trim(),
    from: String(it.from || it.source || '').trim().toLowerCase(),
    kind: String(it.kind || '').trim().toLowerCase() === 'container' ? 'container' : '',
    inside: String(it.inside || it.parent || it.in || '').trim(),
  };
}

export function parseCastDelta(text, { include = [], trackers = [], trackerIds = [] } = {}) {
  const raw = String(text || '').trim();
  const trackerList = Array.isArray(trackers) && trackers.length
    ? trackers
    : (Array.isArray(trackerIds) ? trackerIds.map(id => ({ id })) : []);
  const only = Array.isArray(include) && include.length === 1 ? include[0] : '';
  let parsed = extractJsonValue(raw, { prefer: 'object' });
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    const items = extractJsonValue(raw, { prefer: 'array' });
    if (Array.isArray(items) && (only === 'wardrobe' || only === 'props')) {
      return { [only]: { add: items.map(normalizeDeltaItem).filter(x => x.name), update: [], remove: [] } };
    }
    if (only === 'condition' && raw) {
      return { condition: { changed: true, text: raw.slice(0, 2000) } };
    }
    throw new Error('No JSON object in AI response.');
  }
  const out = {};
  const collectStats = (bag) => {
    if (!bag || typeof bag !== 'object' || Array.isArray(bag)) return;
    for (const [k, v] of Object.entries(bag)) {
      if (k === 'condition' || k === 'wardrobe' || k === 'props' || k === 'stats') continue;
      const id = resolveTrackerId(k, trackerList) || (!trackerList.length ? String(k || '').trim() : '');
      const n = coerceStatInt(v);
      if (!id || n == null) continue;
      out.stats = out.stats || {};
      out.stats[id] = n;
    }
  };
  if (parsed.stats && typeof parsed.stats === 'object' && !Array.isArray(parsed.stats)) {
    collectStats(parsed.stats);
  }
  if (!out.stats && (include.includes('stats') || !include.length)) {
    collectStats(parsed);
  }
  if (parsed.condition != null) {
    if (typeof parsed.condition === 'string') {
      const textVal = parsed.condition.trim();
      out.condition = { changed: !!textVal, text: textVal };
    } else if (typeof parsed.condition === 'object') {
      const changed = parsed.condition.changed === true || parsed.condition.changed === 'true';
      const textVal = String(parsed.condition.text || parsed.condition.condition || '').trim();
      out.condition = { changed, text: textVal };
    }
  }
  for (const kind of ['wardrobe', 'props']) {
    const bag = parsed[kind];
    if (!bag || typeof bag !== 'object') continue;
    if (Array.isArray(bag)) {
      out[kind] = { add: bag.map(normalizeDeltaItem).filter(x => x.name), update: [], remove: [] };
      continue;
    }
    out[kind] = {
      add: asArray(bag.add).map(normalizeDeltaItem).filter(x => x.name),
      update: asArray(bag.update).map(normalizeDeltaItem).filter(x => x.name),
      remove: asArray(bag.remove).map(x => (typeof x === 'string' ? x : x?.name)).filter(Boolean),
    };
  }
  return out;
}

function applyKind(item, spec) {
  if (spec?.kind === 'container' || inferKitKind({ ...item, kind: spec?.kind || item?.kind }) === 'container') {
    item.kind = 'container';
  } else if (!item.kind) {
    item.kind = 'item';
  }
}

function ensurePropParent(char, insideName) {
  const name = String(insideName || '').trim();
  if (!name) return null;
  let parent = findKitByName(char.props, name);
  if (parent) {
    parent.kind = 'container';
    return parent;
  }
  const worn = findKitByName(char.wardrobe, name);
  if (!worn) return null;
  char.wardrobe = (char.wardrobe || []).filter(x => x.id !== worn.id);
  (char.props ??= []).push(worn);
  worn.kind = 'container';
  return worn;
}

function stowInside(char, item, insideName, hooks, fromKind) {
  const parent = ensurePropParent(char, insideName);
  if (!parent || !item || item.id === parent.id) return false;
  const inWardrobe = (char.wardrobe || []).some(x => x.id === item.id);
  if (inWardrobe) {
    char.wardrobe = char.wardrobe.filter(x => x.id !== item.id);
    if (!(char.props || []).some(x => x.id === item.id)) (char.props ??= []).push(item);
    if (fromKind === 'wardrobe') hooks.onStarMove?.(char, item, 'wardrobe', 'props');
  }
  nestUnder(char.props, item, parent);
  return true;
}

function applyItemDelta(char, kind, bag, hooks) {
  if (!bag) return [];
  const list = (char[kind] ??= []);
  const changes = [];
  const pendingInside = [];
  const later = [];

  for (const name of bag.remove || []) {
    const i = matchItemName(list, name);
    if (i < 0) continue;
    const item = list[i];
    const drop = new Set([item.id, ...kitDescendantIds(list, item.id)]);
    for (const id of drop) {
      const j = list.findIndex(x => x.id === id);
      if (j < 0) continue;
      const [gone] = list.splice(j, 1);
      hooks.onStarRemove?.(char, gone, kind);
      changes.push({ kind, action: 'remove', name: gone.name });
    }
  }

  for (const it of bag.update || []) {
    const i = matchItemName(list, it?.name);
    if (i < 0) continue;
    const item = list[i];
    const from = item.condition || 'pristine';
    if (it.condition) item.condition = clampItemCondition(it.condition, item.condition || 'pristine');
    if (it.description) item.description = String(it.description).slice(0, 200);
    applyKind(item, it);
    if (it.inside) pendingInside.push({ item, inside: it.inside, fromKind: kind });
    later.push(() => hooks.onStarUpdate?.(char, item, kind));
    if (from !== item.condition) {
      changes.push({
        kind, action: 'update', name: item.name,
        fromCondition: from, toCondition: item.condition,
      });
    }
  }

  for (const it of bag.add || []) {
    const spec = typeof it === 'string' ? { name: it } : (it || {});
    const name = String(spec.name || '').trim().slice(0, 80);
    if (!name) continue;
    const have = matchItemExact(list, name, spec.id);
    if (have >= 0) {
      const item = list[have];
      const from = item.condition || 'pristine';
      if (spec.condition) item.condition = clampItemCondition(spec.condition, item.condition || 'pristine');
      if (spec.description) item.description = String(spec.description).slice(0, 200);
      applyKind(item, spec);
      if (spec.inside) pendingInside.push({ item, inside: spec.inside, fromKind: kind });
      later.push(() => hooks.onStarUpdate?.(char, item, kind));
      if (from !== item.condition) {
        changes.push({
          kind, action: 'update', name: item.name,
          fromCondition: from, toCondition: item.condition,
        });
      }
      continue;
    }
    const otherKind = kind === 'wardrobe' ? 'props' : 'wardrobe';
    const other = char[otherKind] || [];
    const oj = matchItemExact(other, name, spec.id);
    if (oj >= 0) {
      const [moved] = other.splice(oj, 1);
      if (spec.condition) moved.condition = clampItemCondition(spec.condition, moved.condition || 'pristine');
      if (spec.description) moved.description = String(spec.description).slice(0, 200);
      applyKind(moved, spec);
      list.push(moved);
      if (spec.inside) pendingInside.push({ item: moved, inside: spec.inside, fromKind: otherKind });
      later.push(() => hooks.onStarMove?.(char, moved, otherKind, kind));
      changes.push({ kind, action: 'move', name: moved.name, fromKind: otherKind });
      continue;
    }
    const claimed = hooks.claimKnown?.(char, kind, { ...spec, name });
    const row = claimed && String(claimed.name || '').trim()
      ? claimed
      : {
          id: uid(),
          name,
          description: String(spec.description ?? '').slice(0, 200),
          condition: clampItemCondition(spec.condition),
        };
    if (!row.id) row.id = uid();
    if (!row.name) row.name = name;
    applyKind(row, spec);
    if (matchItemExact(list, row.name, row.id) >= 0) continue;
    list.push(row);
    if (spec.inside) pendingInside.push({ item: row, inside: spec.inside, fromKind: kind });
    later.push(() => hooks.onStarAdd?.(char, row, kind));
    changes.push({
      kind, action: 'add', name: row.name, toCondition: row.condition,
      reused: !!claimed,
    });
  }

  for (const p of pendingInside) stowInside(char, p.item, p.inside, hooks, p.fromKind);
  for (const fn of later) fn();
  return changes;
}

/**
 * Apply condition + wardrobe/props. Stats are applied by the caller.
 * @returns {{ condition: string, changes: object[] }}
 */
export function applyCastDelta(char, delta, {
  include = [],
  onStarAdd,
  onStarUpdate,
  onStarRemove,
  onStarMove,
  claimKnown,
} = {}) {
  const want = new Set(Array.isArray(include) && include.length
    ? include
    : ['condition', 'wardrobe', 'props']);
  const hooks = { onStarAdd, onStarUpdate, onStarRemove, onStarMove, claimKnown };
  const changes = [];
  let condition = '';

  if (want.has('condition') && delta?.condition?.changed && String(delta.condition.text || '').trim()) {
    const next = String(delta.condition.text).trim().slice(0, COND_CAP);
    if (next !== String(char.condition || '').trim()) {
      char.condition = next;
      condition = next;
      changes.push({ kind: 'condition', action: 'update', name: 'Condition', toCondition: clipText(next, 80) });
    }
  }

  if (want.has('wardrobe')) changes.push(...applyItemDelta(char, 'wardrobe', delta?.wardrobe, hooks));
  if (want.has('props')) changes.push(...applyItemDelta(char, 'props', delta?.props, hooks));

  return { condition, changes };
}

/** Lightweight invariant checks (no DOM). Returns '' on success. */
export function smokeCastDeltaPure() {
  try {
    const trackers = [
      { id: 'hunger', label: 'Satiety' },
      { id: 'bathroom', label: 'Bladder' },
      { id: 'hygiene', label: 'Odor' },
      { id: 'health', label: 'Health' },
      { id: 'energy', label: 'Energy' },
    ];
    const labeled = parseCastDelta(
      '{"stats":{"Satiety":55,"Bladder":80,"Odor":12,"Health":90}}',
      { include: ['stats'], trackers },
    );
    if (labeled.stats?.hunger !== 55) return 'satiety label should map to hunger';
    if (labeled.stats?.bathroom !== 80) return 'bladder label should map to bathroom';
    if (labeled.stats?.hygiene !== 12) return 'odor label should map to hygiene';
    const flat = parseCastDelta(
      '{"health":70,"energy":"40%"}',
      { include: ['stats'], trackers },
    );
    if (flat.stats?.health !== 70 || flat.stats?.energy !== 40) return 'top-level stats should coerce';
    const prompt = buildCastDeltaPrompt({
      who: 'Alex (Star)',
      scene: 'Alex ate a sandwich and used the bathroom.',
      snapshot: {
        trackers: '- id=hunger label="Satiety" now=40',
        trackerIds: ['hunger', 'bathroom'],
      },
      include: ['stats'],
    });
    if (!/hunger=satiety/i.test(prompt)) return 'prompt should explain hunger polarity';
    if (!/"hunger": 80/.test(prompt)) return 'prompt should list exact ids';
    if (!/first character must be \{/i.test(prompt) || !/Adjusting/i.test(prompt)) {
      return 'stats prompt should forbid scratch-work commentary';
    }
    const trailing = parseCastDelta(
      '{"stats":{"health":61}}\nThat is the result}\n',
      { include: ['stats'], trackers },
    );
    if (trailing.stats?.health !== 61) return 'trailing text after JSON should still parse';
    const long = { name: 'Narrator', mes: `${'setup '.repeat(80)}then they finished the stew and unbuckled their belt` };
    const line = formatChatLine(long, 80);
    if (!/stew|unbuckled/.test(line)) return 'chat excerpt should keep the tail of long lines';
    const dress = 'He dressed without turning the light on. The canvas work shirt, the windbreaker over the top. Trousers with the torn pocket. His boots by the door. When he crouched at the mat to tie them, the wound at his shoulder pulled the full length of the seam, a dry, deep pull that had become the background of every movement for a week. He sat with the second lace half-done and looked back at the nest.';
    const named = listGarmentMentions(dress).join(' ').toLowerCase();
    if (!/shirt/.test(named) || !/windbreaker/.test(named) || !/trousers/.test(named) || !/boots/.test(named)) {
      return 'dressing montage should name shirt, windbreaker, trousers, boots';
    }
    const wearPrompt = buildCastDeltaPrompt({
      who: 'He (Star)',
      scene: dress,
      snapshot: { wearing: 'None', carrying: 'None' },
      include: ['wardrobe'],
    });
    if (!/dressing montage/i.test(wearPrompt)) return 'wardrobe prompt should treat dressing lists as worn';
    if (!/canvas work shirt/i.test(wearPrompt)) return 'wardrobe prompt should list named garments';
    const dressLine = formatChatLine({ name: 'Narrator', mes: dress }, 360);
    if (!/canvas work shirt/i.test(dressLine) || !/boots/i.test(dressLine)) {
      return 'wardrobe excerpt should keep the start of a dressing paragraph';
    }
    const midDress = `${'setup '.repeat(90)}He dressed without turning the light on. The canvas work shirt, the windbreaker over the top. Trousers with the torn pocket. His boots by the door. ${'afterward '.repeat(90)}`;
    const midLine = formatChatLine({ name: 'Hawks', mes: midDress }, 420);
    if (!/canvas work shirt/i.test(midLine) || !/windbreaker/i.test(midLine) || !/trousers/i.test(midLine)) {
      return 'wardrobe excerpt should keep dressing lines in the middle of a long message';
    }
    if (/[A-Za-z]…[A-Za-z]/.test(midLine.replace(/ … /g, ' | '))) {
      return 'excerpt should not glue word fragments together';
    }
    const oldClothes = clipExcerptToLines(
      `Hawks: He shrugged on the canvas work shirt and the windbreaker.\nNarrator: ${'alpha '.repeat(80)}nothing about clothes here.`,
      220,
      { keepIf: lineHasKitCue },
    );
    if (!/windbreaker/i.test(oldClothes)) return 'excerpt should keep an older clothes line under the cap';
    const hayOnly = buildCastDeltaPrompt({
      who: 'Hawks',
      scene: 'Hawks: He sat by the window.',
      garmentHay: midDress,
      snapshot: { wearing: 'None' },
      include: ['wardrobe'],
    });
    if (!/Named garments/i.test(hayOnly) || !/windbreaker/i.test(hayOnly)) {
      return 'named garments should come from the unclipped hay';
    }
    const starScene = sceneExcerpt([
      { is_user: true, name: 'You', mes: 'I wait.' },
      { is_user: true, name: 'You', mes: 'I wait again.' },
      { is_system: false, name: 'Alex', mes: 'Alex wolfed down the stew, then slipped into the toilet stall.' },
    ], { char: { name: 'Alex', priority: 'star' }, cap: 800, lineCap: 200 });
    if (!/stew|toilet/i.test(starScene)) return 'star audit excerpt should include narration, not only user lines';
    if (!lineHasKitCue('She ate the stew and then slept.')) return 'care cues should count as kit';
    if (!lineHasKitCue('He took a shower after the nap.')) return 'wash/rest cues should count as kit';
    const eatPrompt = buildCastDeltaPrompt({
      who: 'Alex (Star)',
      scene: 'Alex ate some chips.',
      snapshot: {
        trackers: '- id=hunger label="Satiety" now=40',
        trackerIds: ['hunger'],
        consumables: '- chips (Half · 6/12 pieces — eating this raises Satiety)',
      },
      include: ['stats'],
    });
    if (!/chips/.test(eatPrompt) || !/Satiety/.test(eatPrompt)) return 'stats prompt should ground on-person pack fill';
    const clipped = clipExcerptToLines(
      `Narrator: ${'alpha '.repeat(80)}head once lay.\nHawks: He reached into the pocket of the windbreaker.`,
      220,
    );
    if (/^[^:\n]*ow where|^ow where/i.test(clipped)) return 'excerpt should not start mid-word';
    if (!/windbreaker/i.test(clipped)) return 'excerpt should keep the newest whole line';
    if (clipped.includes('alpha alpha') && clipped.startsWith('Narrator:') && clipped.length > 220) {
      return 'excerpt should drop oldest lines rather than grow past the cap';
    }
    const kitRows = collectKnownKitEntries({
      char: { wardrobe: [], props: [] },
      inventory: [
        { id: 'inv1', name: 'windbreaker', condition: 'fine', category: 'wearable', location: 'static' },
        { id: 'inv2', name: 'Thermal Blanket', condition: 'fine', category: 'wearable', location: 'static' },
        { id: 'inv3', name: 'Headphones', category: 'wearable', location: 'static' },
      ],
      setPieces: [{ id: 'set1', name: 'boots', layer: 'clutter', placeName: 'Hall' }],
      lost: [{ id: 'lost1', name: 'canvas work shirt', condition: 'worn' }],
      scene: dress,
      include: ['wardrobe'],
      max: 36,
    });
    const kitBlob = formatKnownKitRoster(kitRows);
    if (!/windbreaker/i.test(kitBlob)) return 'known kit should list scene-named inventory wearables';
    if (/Thermal Blanket|Headphones/i.test(kitBlob)) return 'known kit should omit unrelated trunk wearables';
    if (!/boots/i.test(kitBlob) || !/set/i.test(kitBlob)) return 'known kit should list scene-named set pieces';
    if (!/canvas work shirt/i.test(kitBlob) || !/lost/i.test(kitBlob)) return 'known kit should list scene-named lost & found';
    const propsOnly = formatKnownKitRoster(collectKnownKitEntries({
      char: {
        wardrobe: [{ id: 'w', name: 'Night Shirt', condition: 'fine' }],
        props: [{ id: 'p', name: 'Coin Purse' }],
      },
      inventory: [{ id: 'inv9', name: 'Pullover Hoodie', category: 'wearable', location: 'static' }],
      scene: 'Hawks paid cash from the coin purse and boarded the express.',
      include: ['props'],
    }));
    if (!/Coin Purse/i.test(propsOnly)) return 'props audit should list what they carry';
    if (/Night Shirt|Pullover Hoodie/i.test(propsOnly)) return 'props audit should not dump unrelated wearables';
    if (!/boots/i.test(kitBlob) || !/set/i.test(kitBlob)) return 'known kit should list scene-named set pieces';
    if (!/canvas work shirt/i.test(kitBlob) || !/lost/i.test(kitBlob)) return 'known kit should list scene-named lost & found';
    const reusePrompt = buildCastDeltaPrompt({
      who: 'He (Star)',
      scene: dress,
      snapshot: { wearing: 'None', carrying: 'None', knownKit: kitBlob },
      include: ['wardrobe'],
    });
    if (!/already accounted for/i.test(reusePrompt)) return 'wardrobe prompt should show known kit';
    if (!/do not mint a second copy/i.test(reusePrompt)) return 'wardrobe prompt should forbid duplicate kit';
    const parsedAdd = parseCastDelta(
      '{"wardrobe":{"add":[{"name":"windbreaker","id":"inv1","condition":"fine"}],"update":[],"remove":[]}}',
      { include: ['wardrobe'] },
    );
    if (parsedAdd.wardrobe?.add?.[0]?.id !== 'inv1') return 'parse should keep add id for known kit';
    const reuseChar = { wardrobe: [], props: [] };
    const reuseOut = applyCastDelta(reuseChar, parsedAdd, {
      include: ['wardrobe'],
      claimKnown: (_c, _k, it) => (it.id === 'inv1'
        ? { id: 'c1', name: 'windbreaker', inventoryId: 'inv1', condition: 'fine' }
        : null),
    });
    if (reuseChar.wardrobe[0]?.inventoryId !== 'inv1') return 'add should reuse claimed inventory item';
    if (!reuseOut.changes.some(c => c.reused)) return 'claimed add should mark reused';
    const moveChar = { wardrobe: [{ id: 'w1', name: 'boots', condition: 'worn' }], props: [] };
    applyCastDelta(moveChar, {
      props: { add: [{ name: 'boots' }], update: [], remove: [] },
    }, { include: ['props'] });
    if (moveChar.wardrobe.length || moveChar.props[0]?.name !== 'boots') {
      return 'add on the other list should move the existing item';
    }
    const nestChar = { wardrobe: [], props: [] };
    applyCastDelta(nestChar, {
      props: {
        add: [
          { name: 'canvas bag', kind: 'container' },
          { name: 'headphones', inside: 'bag' },
          { name: 'charger', inside: 'the bag' },
        ],
        update: [],
        remove: [],
      },
    }, { include: ['props'] });
    const bag = nestChar.props.find(p => /bag/i.test(p.name));
    const phones = nestChar.props.find(p => /headphones/i.test(p.name));
    const charger = nestChar.props.find(p => /charger/i.test(p.name));
    if (!bag || bag.kind !== 'container') return 'bag should file as a container';
    if (!phones || phones.parentId !== bag.id) return 'headphones should nest inside the bag';
    if (!charger || charger.parentId !== bag.id) return 'charger should nest inside the bag';
    if (nestChar.props.filter(p => !p.parentId).length !== 1) return 'only the bag should show as a carried root';
    const snap = kitSnapshot(nestChar);
    if (!/canvas bag/.test(snap.carrying) || !/headphones/.test(snap.carrying)) {
      return 'carrying brief should nest bag contents';
    }
    const nestPrompt = buildCastDeltaPrompt({
      who: 'Hawks',
      scene: 'He slid the headphones into the bag.',
      snapshot: { carrying: snap.carrying },
      include: ['props'],
    });
    if (!/inside=that container/i.test(nestPrompt)) return 'props prompt should nest bag contents';
    const dressPrompt = buildCastDressPrompt({
      who: 'Hawks',
      sourceLabel: 'character card',
      sourceText: 'He wears a tan jacket and carries a canvas bag.',
    });
    if (!/starting kit/i.test(dressPrompt) || !/tan jacket/i.test(dressPrompt)) {
      return 'dress prompt should use the writeup, not a chat scene';
    }
    const dressed = parseCastDress('{"appearance":"lean, blond","wardrobe":{"add":[{"name":"tan jacket"}],"update":[],"remove":[]},"props":{"add":[{"name":"canvas bag","kind":"container"}],"update":[],"remove":[]}}');
    if (dressed.appearance !== 'lean, blond') return 'dress parse should keep appearance';
    if (dressed.wardrobe?.add?.[0]?.name !== 'tan jacket') return 'dress parse should keep wardrobe add';
    return '';
  } catch (err) {
    return err?.message || String(err);
  }
}
