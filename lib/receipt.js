// Per-turn tracker receipt: one filing pass, omit unchanged, print a chat card.

import { getContext } from '../../../../extensions.js';
import { getStarMember, getCastRecords, inPlayCastRecords, castNameMatches, normalizeCastPresence } from './castCatalog.js';
import { applyCastDelta, formatChatLine, parseCastDelta, resolveTrackerId } from './castAudit.js';
import { DEFAULT_STATS, STAT_DEFS, barDefsFor, clampStat, setStatValue, smokeStatBarsPure, stateLabel, statTitleChip, statValue } from './statBars.js';
import { playMessagesSince, scanClothingCues, scanPropCues, bodyTextForCharacter, turnGapMinutes, TURN_GAP_MINUTES } from './chatTrack.js';
import { saveChatDebounced } from '../../../../../script.js';
import { knownPlaceRoster, locCueHit, rememberUnlisted } from './compass/unlisted.js';
import { ensureCompass, syncOccupancyRoom } from './compass/state.js';
import { populateRoomsFromNarrative } from './compass/roomDresser.js';
import { withShowtimeProfile } from './connectionProfile.js';
import { leanQuietGenerate } from './isolatedGen.js';
import { parseJsonObject } from './jsonExtract.js';
import { normalizeTrackers, clapperIsShowing, applyDifficultyToStat, difficultyAuditHint } from './trackersConfig.js';
import { conditionStatCap } from './conditionCatalog.js';
import {
  deriveLocator,
  ensureInsidePath,
  findItemByName,
  findOwnedItem,
  findPlaceItem,
  findWorldItem,
  formatItemPlace,
  formatLocator,
  mintItem,
  moveItem,
  resolveOwnerId,
  starKitFromInventory,
  stampCastKitLocators,
  stampInventoryLocators,
  worldFromStorage,
} from './itemLocator.js';
import { stubDocumentFromItem, exposeLinkedItem } from './fileCabinet.js';
import { formatCarryBrief, isGarmentName } from './kitNest.js';
import { formatTravelLine, formatOccupancyLabel, travelFromFiling, commitTravel, normalizeTravel, defaultTravel, isTransitVehicleKey } from './travelState.js';
import { appendNowLedger, commitNow, namedOccupancy } from './nowSidecar.js';
import { syncCastPresence } from './castPresence.js';
import { resolveLastLocationPing, syncSonarPresence } from './compass/sonar.js';
import { noteHouseHealth } from './houseHealth.js';
import { statEventsSchema, statEventsPromptRules, parseStatEvents, groupStatEvents, formatStatEventLine } from './statEvents.js';

function escHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, ch =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}

function clipReason(s, max = 80) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

export function emptyReceipt() {
  return {
    location: null,
    cast: [],
    items: [],
    events: [],
    text: '',
    at: 0,
  };
}

function formatChangeLine(label, name, change, reason) {
  const bits = [label, name, change].filter(Boolean);
  const body = bits.join(' | ');
  const why = clipReason(reason);
  return why ? `    ${body} · ${why}` : `    ${body}`;
}

export function formatReceipt(receipt) {
  const loc = receipt?.location;
  const locLine = loc?.line || (loc ? formatTravelLine(loc) : '');
  const lines = [locLine || 'Scene/Location | Unknown', 'Cast (in play)'];
  const people = Array.isArray(receipt?.cast) ? receipt.cast : [];
  if (!people.length && !(receipt?.items || []).length) {
    return locLine || 'Scene/Location | Unknown';
  }
  for (const row of people) {
    const name = String(row.name || '').trim();
    if (!name) continue;
    const bits = [];
    for (const s of row.stats || []) bits.push(formatChangeLine('State', s.name, s.change, s.reason));
    for (const w of row.wardrobe || []) bits.push(formatChangeLine('Wardrobe', w.name, w.change, w.reason));
    for (const p of row.props || []) bits.push(formatChangeLine('Props', p.name, p.change, p.reason));
    for (const c of row.conditions || []) bits.push(formatChangeLine('Condition', c.name, c.change, c.reason));
    if (!bits.length) continue;
    lines.push(`  ${name}`);
    lines.push(...bits);
  }
  for (const it of receipt?.items || []) {
    lines.push(formatChangeLine('Item', it.name, it.change, it.reason));
  }
  return lines.filter(Boolean).join('\n');
}

export function receiptHasChanges(receipt) {
  if (!receipt) return false;
  if ((receipt.items || []).length) return true;
  for (const row of receipt.cast || []) {
    if ((row.stats || []).length || (row.wardrobe || []).length
      || (row.props || []).length || (row.conditions || []).length) return true;
  }
  const loc = receipt.location;
  if (loc && loc.changed) return true;
  return false;
}

export const RECEIPT_WRAP_OPEN = '[ShowtimeReceipt]';
export const RECEIPT_WRAP_CLOSE = '[/ShowtimeReceipt]';
const RECEIPT_WRAP_RE = /\[ShowtimeReceipt\][\s\S]*?\[\/ShowtimeReceipt\]/gi;

export function stripReceiptWrap(text) {
  RECEIPT_WRAP_RE.lastIndex = 0;
  return String(text ?? '').replace(RECEIPT_WRAP_RE, '').replace(/\n{3,}/g, '\n\n').trimEnd();
}

export function wrapReceiptText(text) {
  const body = String(text || '').trim();
  if (!body) return '';
  return `${RECEIPT_WRAP_OPEN}\n${body}\n${RECEIPT_WRAP_CLOSE}`;
}

export function lastUserHasReceiptWrap(chat) {
  const hit = lastKeptUserMessage(chat);
  return !!(hit && String(hit.mes.mes || '').includes(RECEIPT_WRAP_OPEN));
}

export function lastKeptUserMessage(chat) {
  const list = Array.isArray(chat) ? chat : [];
  for (let i = list.length - 1; i >= 0; i--) {
    const mes = list[i];
    if (mes && mes.is_user && !mes.is_system) return { mes, idx: i };
  }
  return null;
}

export function stripReceiptWrapFromElement(el) {
  if (!el) return false;
  const html = String(el.innerHTML || '');
  if (!/ShowtimeReceipt/i.test(html)) return false;
  RECEIPT_WRAP_RE.lastIndex = 0;
  const next = html.replace(RECEIPT_WRAP_RE, '').replace(/(<br\s*\/?>\s*){3,}/gi, '<br><br>');
  if (next === html) return false;
  el.innerHTML = next;
  return true;
}

function messageCarriesReceipt(mes) {
  if (!mes || mes.is_system) return false;
  if (mes.extra?.showtimeReceipt) return true;
  return String(mes.mes || '').includes(RECEIPT_WRAP_OPEN);
}

function receiptFromWrap(mes) {
  const stored = mes?.extra?.showtimeReceipt;
  if (stored && typeof stored === 'object') return stored;
  const raw = String(mes?.mes || '');
  const match = raw.match(/\[ShowtimeReceipt\]([\s\S]*?)\[\/ShowtimeReceipt\]/i);
  const body = String(match?.[1] || '').trim();
  if (!body) return null;
  const line = body.split('\n').map(part => part.trim()).filter(Boolean)[0] || body;
  return {
    text: body,
    location: { line },
    cast: [],
    items: [],
    at: 0,
  };
}

/**
 * Leave one receipt in the transcript. Older wraps come off the message text.
 * A row that was only a wrap is removed. Mutates `chat` in place.
 * @param {Array} chat
 * @param {{ preferIdx?: number }} [opts] preferIdx wins when a filing just stamped that row
 * @returns {{ keptIdx: number, changed: boolean, removed: number[] }}
 */
export function sweepStaleReceipts(chat, { preferIdx = -1 } = {}) {
  const list = Array.isArray(chat) ? chat : [];
  if (!list.length) return { keptIdx: -1, changed: false, removed: [] };

  let keep = -1;
  let bestAt = -1;
  for (let i = 0; i < list.length; i++) {
    const mes = list[i];
    if (!messageCarriesReceipt(mes)) continue;
    const at = Number(mes?.extra?.showtimeReceipt?.at);
    if (Number.isFinite(at) && at > bestAt) {
      bestAt = at;
      keep = i;
    }
  }
  if (keep < 0) {
    for (let i = list.length - 1; i >= 0; i--) {
      if (messageCarriesReceipt(list[i])) {
        keep = i;
        break;
      }
    }
  }
  const prefer = Number(preferIdx);
  if (Number.isFinite(prefer) && prefer >= 0 && prefer < list.length && messageCarriesReceipt(list[prefer])) {
    keep = prefer;
  }
  if (keep < 0) return { keptIdx: -1, changed: false, removed: [] };

  let changed = false;
  const kept = list[keep];
  if (kept && !kept.extra?.showtimeReceipt) {
    const built = receiptFromWrap(kept);
    if (built) {
      kept.extra = kept.extra && typeof kept.extra === 'object' ? kept.extra : {};
      kept.extra.showtimeReceipt = built;
      changed = true;
    }
  }

  const removed = [];
  for (let i = list.length - 1; i >= 0; i--) {
    if (i === keep) continue;
    const mes = list[i];
    if (!mes || mes.is_system || !messageCarriesReceipt(mes)) continue;
    const raw = String(mes.mes || '');
    const hadWrap = raw.includes(RECEIPT_WRAP_OPEN);
    if (mes.extra?.showtimeReceipt) {
      delete mes.extra.showtimeReceipt;
      if (mes.extra && !Object.keys(mes.extra).length) delete mes.extra;
      changed = true;
    }
    let prose = raw;
    if (hadWrap) {
      prose = stripReceiptWrap(raw).trim();
      if (prose !== raw) {
        mes.mes = prose;
        changed = true;
      }
    }
    if (hadWrap && !prose) {
      list.splice(i, 1);
      removed.push(i);
      if (i < keep) keep -= 1;
      changed = true;
    }
  }
  return { keptIdx: keep, changed, removed };
}

function clearReceiptBubble(el) {
  if (!el) return;
  el.querySelectorAll?.('.st-chat-receipt')?.forEach(node => node.remove());
  const mesText = el.querySelector?.('.mes_text');
  if (mesText) stripReceiptWrapFromElement(mesText);
}

function dropReceiptRowFromDom(idx) {
  if (typeof document === 'undefined') return;
  const el = document.querySelector(`#chat .mes[mesid="${idx}"]`);
  el?.remove();
  document.querySelectorAll('#chat .mes').forEach(node => {
    const id = Number(node.getAttribute('mesid'));
    if (Number.isFinite(id) && id > idx) node.setAttribute('mesid', String(id - 1));
  });
}

function syncStrippedReceiptDom(chat, keptIdx) {
  if (typeof document === 'undefined') return;
  document.querySelectorAll('#chat .mes').forEach(el => {
    const id = Number(el.getAttribute('mesid'));
    if (!Number.isFinite(id) || id === keptIdx) return;
    const row = chat[id];
    if (!row) return;
    if (String(row.mes || '').includes(RECEIPT_WRAP_OPEN)) return;
    clearReceiptBubble(el);
  });
}

/**
 * Strip older receipts from the open chat, save once if the transcript changed,
 * and paint the one that remains.
 * @param {{ preferIdx?: number, save?: boolean }} [opts]
 * @returns {number|null}
 */
export function restoreLatestReceipt({ preferIdx = -1, save = true } = {}) {
  try {
    const chat = getContext()?.chat;
    if (!Array.isArray(chat) || !chat.length) return null;
    const { keptIdx, changed, removed } = sweepStaleReceipts(chat, { preferIdx });
    for (const idx of removed) dropReceiptRowFromDom(idx);
    if (keptIdx >= 0) syncStrippedReceiptDom(chat, keptIdx);
    if (save && changed) {
      try { saveChatDebounced(); } catch { /* ignore */ }
    }
    if (keptIdx >= 0) {
      const extra = chat[keptIdx]?.extra?.showtimeReceipt;
      if (extra) queueReceiptPaint(keptIdx, extra);
    }
    return keptIdx;
  } catch (err) {
    console.warn('[Showtime/receipt] sweep failed', err);
    return null;
  }
}

function ticketChip(kind, name, change, reason, esc) {
  const bits = [name, change].filter(Boolean).join(' ');
  const why = clipReason(reason, 48);
  const v = why ? `${bits} · ${why}` : bits;
  if (!v) return '';
  return `<span class="st-ticket-chip" data-k="${esc(kind)}">${esc(v)}</span>`;
}

function ticketCastRow(row, esc) {
  const chips = [];
  for (const s of row.stats || []) chips.push(ticketChip('state', s.name, s.change, s.reason, esc));
  for (const w of row.wardrobe || []) chips.push(ticketChip('wardrobe', w.name, w.change, w.reason, esc));
  for (const p of row.props || []) chips.push(ticketChip('props', p.name, p.change, p.reason, esc));
  for (const c of row.conditions || []) chips.push(ticketChip('condition', c.name, c.change, c.reason, esc));
  const body = chips.filter(Boolean).join('');
  if (!body) return '';
  const name = String(row.name || '').trim();
  if (!name) return '';
  return `<div class="st-ticket-cast">
      <span class="st-ticket-who">${esc(name)}</span>
      <div class="st-ticket-chips">${body}</div>
    </div>`;
}

export function buildReceiptHtml(receipt, { esc = escHtml } = {}) {
  if (!receiptHasChanges(receipt) && !receipt?.location) return '';
  const locLine = receipt?.location?.line || formatTravelLine(receipt?.location || {});
  const scene = locLine.replace(/^Scene\/Location\s*\|\s*/i, '').trim();
  const people = (receipt?.cast || []).map(row => ticketCastRow(row, esc)).filter(Boolean);
  const itemChips = (receipt?.items || [])
    .map(it => ticketChip('item', it.name, it.change, it.reason, esc))
    .filter(Boolean);
  const eventRows = (Array.isArray(receipt?.events) ? receipt.events : [])
    .map(ev => String(ev?.line || '').trim())
    .filter(Boolean);
  const peek = scene || 'no change';
  const sceneRow = scene
    ? `<div class="st-ticket-scene"><span class="st-ticket-k">scene</span><span class="st-ticket-v">${esc(scene)}</span></div>`
    : '';
  const itemRow = itemChips.length
    ? `<div class="st-ticket-cast">
      <span class="st-ticket-who">Items</span>
      <div class="st-ticket-chips">${itemChips.join('')}</div>
    </div>`
    : '';
  const eventsRow = eventRows.length
    ? `<div class="st-ticket-cast">
      <span class="st-ticket-who">Beats</span>
      <div class="st-ticket-chips">${eventRows.map(line => `<span class="st-ticket-chip" data-k="beat">${esc(line)}</span>`).join('')}</div>
    </div>`
    : '';
  const body = `${sceneRow}${eventsRow}${people.join('')}${itemRow}`
    || `<div class="st-ticket-scene"><span class="st-ticket-k">note</span><span class="st-ticket-v">no kit / item / location change</span></div>`;
  return `<details class="st-chat-receipt" open>
  <summary class="st-ticket-sum"><span>Turn Receipt</span><span class="st-ticket-bars" aria-hidden="true"></span><span class="st-ticket-peek">${esc(peek)}</span></summary>
  <hr class="st-ticket-rule">
  <div class="st-ticket-body">${body}</div>
</details>`;
}

export function compactReceiptInject(receipt) {
  if (!receiptHasChanges(receipt) && !receipt?.location?.line) return '';
  const text = String(receipt?.text || formatReceipt(receipt)).trim();
  if (!text) return '';
  return `[Receipt]\n${text}`;
}

function kitViewFor(char, world) {
  if (char?.priority === 'star') {
    return starKitFromInventory(world.inventory, { ownerId: char.id });
  }
  return { wardrobe: char.wardrobe || [], props: char.props || [] };
}

function inPlayCast(storage) {
  return inPlayCastRecords(storage);
}

function itemCueHit(text) {
  const hay = String(text || '');
  return /\b(pick(?:ed|s)?\s+up|takes?|grab(?:s|bed)?|stow(?:s|ed)?|pocket(?:s|ed)?|wear(?:s|ing|ed)?|put(?:s)?\s+(?:away|on|in|down)|drop(?:s|ped)?|unpack|pack(?:s|ed)?|gives?|hands?|equip(?:s|ped)?|stuff(?:s|ed)?|spill(?:s|ed)?|rattl(?:e|ed|es)|folded?\s+into|counter|tile|letter|warrant|polaroid|memo|clipping)\b/i.test(hay);
}

export function receiptCueHit(windowText, { compass } = {}) {
  const hay = String(windowText || '');
  if (!hay.trim()) return false;
  if (locCueHit(hay, compass)) return true;
  if (itemCueHit(hay)) return true;
  if (scanConditionCue(hay)) return true;
  if (scanClothingCues(hay) || scanPropCues(hay)) return true;
  return false;
}

function scanConditionCue(hay) {
  return /\b(bleed(?:s|ing)?|wound|hurt|injur|bruise|sick|fever|drunk|exhaust|tired|asleep|awake|curse|bless)\b/i.test(hay);
}

function fallbackReceipt(scene) {
  const travelLine = formatTravelLine(scene?.travel || defaultTravel(), { lastLocationKey: scene?.lastLocationKey });
  const receipt = {
    location: { line: travelLine || 'Scene/Location | Unknown', mode: 'unknown', changed: false },
    cast: [],
    items: [],
  };
  receipt.text = formatReceipt(receipt);
  receipt.at = Date.now();
  return receipt;
}

const TRANSIT_VEHICLE_RE = /\b(train|subway|metro|tram|bus|ferry|taxi|cab|plane|flight)\b/i;
const ARRIVAL_CUE_RE = /\b(platform|concourse|ticket gate|fare gate|stepped (?:off|onto)|got off|disembark|(?:doors?|gates?) (?:opened|slid open|open))\b/i;
const ARRIVING_WORD_RE = /\barriv(?:e|ed|ing)\b/i;
const POCKET_HOST_RE = /\b(windbreaker|jacket|hoodie|coat|jeans|trousers|pants) pocket\b/i;
const PLACE_SKIP = new Set(['the', 'a', 'an', 'his', 'her', 'their', 'this', 'that', 'west', 'east', 'north', 'south']);

function clipPlacePhrase(raw) {
  let t = String(raw || '').replace(/['’]s\b[\s\S]*$/i, '').replace(/[.,;:!?].*$/, '').trim();
  t = t.replace(/\s+(?:west|east|north|south|platform|concourse|station|gate|train|car)$/i, '').trim();
  if (!t || t.length < 3 || PLACE_SKIP.has(t.toLowerCase()) || isTransitVehicleKey(t)) return '';
  return t;
}

function compassPlacesInHay(hay, compass) {
  const low = String(hay || '').toLowerCase();
  const hits = [];
  for (const p of Object.values(compass?.rooms || {})) {
    const names = [p?.name, ...(p?.aliases || [])];
    for (const n of names) {
      const s = String(n || '').trim();
      if (s.length < 3 || isTransitVehicleKey(s)) continue;
      if (low.includes(s.toLowerCase())) hits.push(s);
    }
  }
  hits.sort((a, b) => b.length - a.length);
  return [...new Set(hits)];
}

function titledPlacesInHay(hay) {
  const text = String(hay || '');
  const hits = [];
  const toward = /\b(?:toward|towards|to)\s+(?:the\s+)?([A-Z][\w'.-]*(?:\s+[A-Z][\w'.-]*){0,4})\b/g;
  const onAt = /\b(?:on|at)\s+(?:the\s+)?([A-Z][\w'.-]*(?:\s+[A-Z][\w'.-]*){0,4})(?:['’]s)?(?:\s+(?:west|east|north|south))?(?:\s+(?:platform|concourse|station|gate))?/g;
  let m;
  while ((m = toward.exec(text))) {
    const p = clipPlacePhrase(m[1]);
    if (p) hits.push(p);
  }
  while ((m = onAt.exec(text))) {
    const p = clipPlacePhrase(m[1]);
    if (p) hits.push(p);
  }
  hits.sort((a, b) => b.length - a.length);
  return [...new Set(hits)];
}

function namedPlaceFromClip(hay, compass) {
  const fromCompass = compassPlacesInHay(hay, compass);
  if (fromCompass.length) return fromCompass[0];
  const titled = titledPlacesInHay(hay);
  return titled[0] || '';
}

export function ensureStarStats(storage) {
  try {
    const castBag = storage?.getChat?.('cast', {});
    const chars = Array.isArray(castBag?.characters) ? castBag.characters : [];
    let changed = false;
    for (const c of chars) {
      if (!c || c.priority !== 'star' || c.stats) continue;
      c.stats = { ...DEFAULT_STATS(), enabled: true };
      changed = true;
    }
    return changed;
  } catch {
    return false;
  }
}

export function activeTrackerDefsForPeople(storage, people = []) {
  const seen = new Map();
  for (const c of people || []) {
    if (!c?.stats?.enabled) continue;
    for (const def of barDefsFor(storage, c)) {
      if (def?.id && !seen.has(def.id)) seen.set(def.id, def);
    }
  }
  if (!seen.size) {
    for (const def of STAT_DEFS.base) seen.set(def.id, def);
  }
  return [...seen.values()];
}

export function filingSchema(trackerIds = []) {
  const ids = Array.isArray(trackerIds) && trackerIds.length
    ? trackerIds.map(id => String(id || '').trim()).filter(Boolean)
    : STAT_DEFS.base.map(d => d.id);
  const statsProps = Object.fromEntries(ids.map(id => [id, { type: 'number' }]));
  return {
    name: 'turn_receipt',
    description: 'Turn receipt for location, items, and cast kit/stats',
    strict: false,
    returnInvalid: true,
    value: {
      type: 'object',
      properties: {
        events: statEventsSchema(ids, { withActor: true, withKind: true, maxItems: 32 }),
        location: {
          type: 'object',
          properties: {
            mode: { type: 'string' },
            place: { type: 'string' },
            from: { type: 'string' },
            dest: { type: 'string' },
            transit: { type: 'string' },
            reason: { type: 'string' },
          },
        },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              action: { type: 'string' },
              where: { type: 'string' },
              owner: { type: 'string' },
              inside: { type: 'string' },
              surface: { type: 'string' },
              document: { type: 'boolean' },
              form: { type: 'string' },
              house: { type: 'string' },
              reason: { type: 'string' },
            },
          },
        },
        cast: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              stats: { type: 'object', properties: statsProps },
              wardrobe: {
                type: 'object',
                properties: {
                  add: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, condition: { type: 'string' } } } },
                  update: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, condition: { type: 'string' } } } },
                  remove: { type: 'array', items: { type: 'string' } },
                },
              },
              props: {
                type: 'object',
                properties: {
                  add: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, condition: { type: 'string' }, inside: { type: 'string' } } } },
                  update: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, condition: { type: 'string' }, inside: { type: 'string' } } } },
                  remove: { type: 'array', items: { type: 'string' } },
                },
              },
              conditions: {
                type: 'object',
                properties: {
                  add: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' }, nature: { type: 'string' }, duration: { type: 'string' }, source: { type: 'string' } } } },
                  update: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' }, nature: { type: 'string' }, duration: { type: 'string' }, source: { type: 'string' } } } },
                  remove: { type: 'array', items: { type: 'string' } },
                },
              },
              reason: { type: 'string' },
            },
          },
        },
      },
    },
  };
}

export function formatTrackerBands(def) {
  if (!def || def.levelMode === 'none' || def.levelMode === 'amount') return '';
  const list = Array.isArray(def.thresholds) ? def.thresholds : [];
  if (!list.length) return '';
  const parts = [];
  let low = 0;
  for (const t of list) {
    const rawAt = Number(t?.at);
    const label = String(t?.label || '').trim();
    if (!Number.isFinite(rawAt) || !label) continue;
    const high = Math.min(100, rawAt >= 101 ? 100 : rawAt - 1);
    if (high >= low) {
      parts.push(low === high ? `${low}=${label}` : `${low}-${high}=${label}`);
    }
    low = rawAt;
  }
  return parts.join(', ');
}

function charRelevantHay(hay, char, people) {
  return bodyTextForCharacter(char, hay, people);
}

const HEALTH_BAND_FLOORS = Object.freeze([0, 15, 30, 50, 70, 85, 95]);
const SEVERE_HURT_RE = /\b(stab(?:bed|s)?|shot|gunshot|impaled|broken bone|fractur(?:e|ed)|concuss(?:ed|ion)|gash(?:ed)?|bleed(?:ing)?\s+(?:heavily|badly|out)|cough(?:ed|ing)\s+blood|crushed|burned badly|collapsed in pain)\b/i;
const MINOR_CUT_RE = /\b(?:cut|nicked|pricked|sliced)\b[^.!?\n]{0,48}\b(?:thumb|finger|fingertip|knuckle|palm)\b|\b(?:thumb|finger|fingertip|knuckle|palm)\b[^.!?\n]{0,48}\b(?:cut|nick(?:ed)?|prick(?:ed)?|slic(?:e|ed)|bleed|blood)\b/i;
const HURT_RE = /\b(bled\b|bleed(?:s|ing)?|wound(?:ed)?|injur(?:ed|y)|bruis(?:e|ed)|scrap(?:e|ed|ing)|slash(?:ed)?|sliced|stung|scratched|bitten|punch(?:ed)?|struck|slammed|hit\s+(?:hard|him|her|them|you)|limp(?:ed|ing)|sprain(?:ed)?|twisted (?:an |his |her |their |my |your )?(?:ankle|wrist|knee|shoulder|neck)|burn(?:ed|t) (?:my |his |her |their |your |the )?(?:hand|arm|skin|fingers|palm)|sharp pain)\b/i;
const DISCOMFORT_RE = /\b(winc(?:e|ed|es|ing)|grimac(?:e|ed|es|ing)|flinch(?:ed|es|ing)?|sore|aching|ached|aches|throbb(?:ed|ing|s)?|tender|stiff(?:ness)?|discomfort|in pain|pained|favor(?:s|ed|ing)? (?:the |his |her |their |a )?(?:side|hip|shoulder|arm|leg|knee|wrist)|nurs(?:e|ed|es|ing) (?:a |the |his |her |their )?(?:side|hip|shoulder|arm|bruise|sprain))\b/i;

function healthBandFloor(val) {
  const n = clampStat(val);
  let floor = 0;
  for (const at of HEALTH_BAND_FLOORS) {
    if (n >= at) floor = at;
  }
  return floor;
}

/**
 * Lowest health this scene may file. Tension, standing, and slight exertion
 * do not move health. A thumb/finger nick stays inside the current band.
 */
export function clampHealthProposal(current, proposed, sceneHay = '') {
  const cur = clampStat(current);
  const next = clampStat(proposed);
  if (next >= cur) return next;
  const hay = String(sceneHay || '');
  const severe = SEVERE_HURT_RE.test(hay);
  const minor = !severe && MINOR_CUT_RE.test(hay);
  const hurt = !severe && !minor && HURT_RE.test(hay);
  const discomfort = !severe && !minor && !hurt && DISCOMFORT_RE.test(hay);
  let cap = 0;
  let lockBand = true;
  if (severe) {
    cap = 5;
    lockBand = false;
  } else if (hurt) {
    cap = 2;
    lockBand = false;
  } else if (minor) {
    cap = 1;
  } else if (discomfort) {
    cap = cur >= 95 ? Math.min(1, cur - 95) : 1;
  }
  const dropped = Math.max(0, cur - cap);
  const floor = lockBand ? Math.max(dropped, healthBandFloor(cur)) : dropped;
  return Math.max(floor, next);
}

export function inferSceneStatsDelta(arg1, arg2 = {}) {
  const opts = (arg1 && typeof arg1 === 'object' && !Array.isArray(arg1))
    ? arg1
    : { ...(arg2 || {}), sceneText: arg1 };
  const hay = String(opts.sceneText || '');
  if (!hay.trim()) return [];
  const storage = opts.storage || null;
  const rawList = Array.isArray(opts.people) && opts.people.length
    ? opts.people
    : (Array.isArray(opts.cast) ? opts.cast : (storage ? inPlayCast(storage) : []));
  const tracked = rawList.filter(c => c && c.stats?.enabled);
  if (!tracked.length) return [];

  const overnight = Boolean(opts.nextDay)
    || /\b(next morning|the following morning|woke up the next|slept through the night|hours of sleep|fell fast asleep|dawn broke|morning light)\b/i.test(hay);
  const priorTime = String(opts.priorTime || '').trim();
  const nextTime = String(opts.nextTime || '').trim();
  const gapMin = Number(opts.elapsedMinutes);
  const hasGap = Number.isFinite(gapMin);
  // A two-minute dialogue nudge is still one turn. Only a real gap, or a
  // clock the caller named without a minute count, uses the larger step.
  const clockAdvanced = Boolean(
    (hasGap && gapMin >= TURN_GAP_MINUTES)
    || (!hasGap && priorTime && nextTime && priorTime !== nextTime)
    || /\b(hours? later|half an hour|an hour passed|by the time|later that (?:morning|afternoon|evening|night)|afternoon wore on|evening settled|dusk fell|midnight)\b/i.test(hay)
  );

  const out = [];
  for (const char of tracked) {
    const charHay = charRelevantHay(hay, char, tracked);
    if (!charHay.trim()) continue;
    const defs = barDefsFor(storage, char);
    const defMap = new Map(defs.map(d => [d.id, d]));
    const deltas = new Map();
    const reasons = [];
    const reasonsById = new Map();
    const addDelta = (id, d, why) => {
      if (!defMap.has(id) || !d) return;
      deltas.set(id, (deltas.get(id) || 0) + d);
      if (why && !reasons.includes(why)) reasons.push(why);
      if (why) {
        if (!reasonsById.has(id)) reasonsById.set(id, new Set());
        reasonsById.get(id).add(why);
      }
    };

    const severeHurt = SEVERE_HURT_RE.test(charHay);
    // A thumb or finger nick is a sting inside the current band, not a new injury tier.
    const minorCut = !severeHurt && MINOR_CUT_RE.test(charHay);
    // Injury needs a body result: blood, a wound, a blow that lands, a sprain, a burn.
    // A wince, an ache, or "in pain" without that result is discomfort, not a new Hurt.
    const hurt = !severeHurt && !minorCut && HURT_RE.test(charHay);
    const discomfort = !severeHurt && !minorCut && !hurt && DISCOMFORT_RE.test(charHay);
    const healed = /\b(bandag(?:e|ed|ing)|stitch(?:ed|ing)|antiseptic|painkiller|medicine|healed|treated the wound|dressed the wound|first aid|salve|poultice)\b/i.test(charHay);

    if (severeHurt) {
      addDelta('health', -4, 'severe injury in scene');
      addDelta('energy', -2, 'severe injury in scene');
    } else if (minorCut) {
      const healthDef = defMap.get('health');
      const healthNow = healthDef
        ? Math.min(statValue(char.stats, healthDef), conditionStatCap(char, 'health'))
        : 100;
      const room = Math.min(1, healthNow - healthBandFloor(healthNow));
      if (room > 0) addDelta('health', -room, 'minor cut');
    } else if (hurt) {
      addDelta('health', -2, 'injury in scene');
      addDelta('energy', -1, 'injury in scene');
    } else if (discomfort) {
      const healthDef = defMap.get('health');
      const healthNow = healthDef
        ? Math.min(statValue(char.stats, healthDef), conditionStatCap(char, 'health'))
        : 100;
      // Uncomfortable is 95-99. A sore spot colors posture; it does not open a wound.
      const drop = healthNow >= 95 ? Math.min(1, healthNow - 95) : 1;
      if (drop > 0) addDelta('health', -drop, 'discomfort in scene');
    }
    if (healed) {
      addDelta('health', 2, 'tended wounds');
    }

    const slept = overnight || /\b(slept|fell asleep|dozed off|napped|deep sleep|hours of rest)\b/i.test(charHay);
    const rested = !slept && /\b(rested|caught (?:my|his|her|their|your) breath|sat down to rest|leaned back and closed|relaxed|lounged|took a breather)\b/i.test(charHay);
    const heavyExert = /\b(sprinted|fought|brawl(?:ed)?|grappl(?:ed|ing)|climbed|hauled|carried the heavy|ran for|exhausting|panting hard|gasping for air|drenched in sweat|fled|chased)\b/i.test(charHay);
    const exert = !heavyExert && /\b(ran\b|running|jogged|hurried|rushed|marched|hiked|walked for|paced|strained|shoved|lifted|sweat(?:ing|y)?|tense|trembl(?:ed|ing))\b/i.test(charHay);

    if (slept) {
      addDelta('energy', overnight ? 8 : 5, overnight ? 'overnight sleep' : 'slept');
      if (!severeHurt && !hurt) addDelta('health', overnight ? 2 : 1, overnight ? 'overnight recovery' : 'rested');
    } else if (rested) {
      addDelta('energy', 3, 'rested in scene');
    } else if (heavyExert) {
      addDelta('energy', -3, 'heavy exertion');
      addDelta('thirst', -2, 'heavy exertion');
      addDelta('hygiene', 2, 'sweat and exertion');
    } else if (exert) {
      addDelta('energy', -2, 'physical effort');
      addDelta('thirst', -1, 'physical effort');
      addDelta('hygiene', 1, 'physical effort');
    } else {
      addDelta('energy', clockAdvanced ? -2 : -1, clockAdvanced ? 'time passing' : 'scene activity');
    }

    const negEat = /\b(?:didn't|did not|couldn't|refused to|never|without)\s+(?:eat|eating|touch|finish)\b/i.test(charHay);
    const meal = !negEat && /\b(ate\b|eaten|eating|devoured|wolfed down|finished the (?:meal|plate|bowl|stew|rice|ramen|dinner|lunch|breakfast|sandwich)|had (?:breakfast|lunch|dinner|a meal))\b/i.test(charHay);
    const snack = !negEat && !meal && /\b(nibbled|munched|bit into|took a bite|swallowed the|snack(?:ed)?)\b/i.test(charHay);
    const hungerCue = !meal && !snack && /\b(stomach growl(?:ed|ing)|ravenous|starving|empty stomach|skipped (?:breakfast|lunch|dinner|a meal))\b/i.test(charHay);

    if (meal) {
      addDelta('hunger', 6, 'ate in scene');
      addDelta('energy', 1, 'ate in scene');
    } else if (snack) {
      addDelta('hunger', 3, 'snacked in scene');
      addDelta('energy', 1, 'snacked in scene');
    } else if (hungerCue) {
      addDelta('hunger', -2, 'hungry in scene');
    } else {
      addDelta('hunger', overnight ? -3 : (clockAdvanced ? -2 : -1), clockAdvanced ? 'time passing' : 'turn drift');
    }

    const negDrink = /\b(?:didn't|did not|couldn't|refused to|never|without)\s+(?:drink|drinking|sip)\b/i.test(charHay);
    const drank = !negDrink && /\b(drank|chugged|gulped|downed the (?:water|tea|coffee|drink|glass|bottle|cup)|quenched|hydrated|drinking(?!\s+in\b))\b/i.test(charHay);
    const sipped = !negDrink && !drank && /\b(sipped|took a sip|took a drink|swallowed a mouthful of (?:water|tea|coffee|juice|broth|ale|wine|beer))\b/i.test(charHay);
    const thirstCue = !drank && !sipped && /\b(throat (?:was |felt )?(?:dry|parched)|parched|thirsty)\b/i.test(charHay);

    if (drank) {
      addDelta('thirst', 6, 'drank in scene');
      addDelta('bathroom', 2, 'drank fluids');
    } else if (sipped) {
      addDelta('thirst', 4, 'sipped a drink');
      addDelta('bathroom', 1, 'sipped fluids');
    } else if (thirstCue) {
      addDelta('thirst', -2, 'parched in scene');
    } else {
      addDelta('thirst', overnight ? -3 : (clockAdvanced ? -2 : -1), clockAdvanced ? 'time passing' : 'turn drift');
    }

    const bathroomRelief = /\b(used the (?:toilet|restroom|bathroom|latrine|urinal)|relieved (?:myself|himself|herself|themselves|yourself)|flush(?:ed|ing) the toilet|toilet flush(?:ed|ing)?|peed|urinated)\b/i.test(charHay);
    const bathroomNeed = !bathroomRelief && /\b(bladder|needed to pee|urgent need|held it in)\b/i.test(charHay);
    if (bathroomRelief) {
      addDelta('bathroom', -14, 'used the bathroom');
    } else if (bathroomNeed) {
      addDelta('bathroom', 3, 'bladder pressure');
    } else {
      addDelta('bathroom', overnight ? 3 : (clockAdvanced ? 2 : 1), clockAdvanced ? 'time passing' : 'turn drift');
    }

    const washed = /\b(showered|took a (?:shower|bath)|bathed|scrubbed off|washed (?:off|up|away the sweat)|changed into clean clothes|turned off the shower|shower (?:faucet|head|water)?\s*(?:turning|turned|shutting|shut) off)\b/i.test(charHay);
    const freshened = !washed && /\b(rinsed (?:my|his|her|their) face|washed (?:my|his|her|their) hands|wiped the sweat|splashed water)\b/i.test(charHay);
    const messed = !washed && /\b(mud(?:dy)?|filth(?:y)?|grime|grimy|soaked in (?:sweat|blood|rain)|splattered|drenched|dusty|soiled|reek(?:ed|ing))\b/i.test(charHay);
    if (washed) {
      addDelta('hygiene', -13, 'washed up');
    } else if (freshened) {
      addDelta('hygiene', -4, 'freshened up');
    } else if (messed) {
      addDelta('hygiene', 3, 'got dirty or sweaty');
    } else {
      addDelta('hygiene', overnight ? 2 : (clockAdvanced ? 1 : 1), clockAdvanced ? 'time passing' : 'turn drift');
    }

    const stats = {};
    const events = [];
    for (const [id, d] of deltas.entries()) {
      const def = defMap.get(id);
      if (!def || !d) continue;
      const cur = Math.min(statValue(char.stats, def), conditionStatCap(char, id));
      const next = clampStat(cur + d);
      if (next !== cur) stats[id] = next;
      const why = [...(reasonsById.get(id) || [])].join('; ') || reasons[0] || 'scene activity';
      events.push({ actor: char.name, kind: 'stat', trackerId: id, delta: d, action: why, reason: why });
    }
    if (Object.keys(stats).length) {
      out.push({
        name: char.name,
        stats,
        reason: reasons[0] || (clockAdvanced ? 'time passing' : 'scene activity'),
        events,
      });
    }
  }
  return out;
}

export function isStubFiling(payload) {
  if (!payload || typeof payload !== 'object') return true;
  const mode = String(payload.location?.mode || '');
  if (mode.includes('|')) return true;
  const items = Array.isArray(payload.items) ? payload.items : [];
  const named = items.filter(it => String(it?.name || '').trim() && !String(it.name).includes('|'));
  const cast = Array.isArray(payload.cast) ? payload.cast : [];
  const namedCast = cast.filter(c => String(c?.name || '').trim() && !String(c.name).includes('|'));
  const locUseful = mode && !mode.includes('|') && mode !== 'unknown'
    && (payload.location?.place || payload.location?.from || payload.location?.dest || payload.location?.reason);
  return !named.length && !namedCast.length && !locUseful;
}

export function inferReceiptFromScene(sceneText, {
  world,
  compass,
  people,
  cast,
  customBars,
  storage,
  scene,
  priorTime,
  nextTime,
  nextDay,
  elapsedMinutes,
} = {}) {
  const hay = String(sceneText || '');
  const location = {};
  const vehicle = (hay.match(TRANSIT_VEHICLE_RE) || [])[1];
  const riding = !!(vehicle
    || /\bunder the seat\b/i.test(hay)
    || (/\bvinyl\b/i.test(hay) && /\b(seat|salaryman|aisle)\b/i.test(hay)));
  const arrived = ARRIVAL_CUE_RE.test(hay);
  const arrivingWord = ARRIVING_WORD_RE.test(hay);
  const place = namedPlaceFromClip(hay, compass);
  if (arrived && place) {
    location.mode = 'compass';
    location.place = place;
    location.reason = `at ${place}`;
  } else if (riding || (arrived && !place)) {
    location.mode = 'moving';
    location.transit = (arrived || arrivingWord) ? 'arriving' : 'enRoute';
    if (place) location.dest = place;
    location.reason = vehicle ? `on the ${vehicle.toLowerCase()}` : 'in transit';
  } else if (compass) {
    try {
      const sonarHit = resolveLastLocationPing(compass, storage, [{ mes: hay }]);
      if (sonarHit?.key && (sonarHit.rank || 1) >= 4) {
        location.mode = 'compass';
        location.place = sonarHit.key;
        if (sonarHit.placeId) location.placeId = sonarHit.placeId;
        location.reason = `in ${sonarHit.key}`;
      }
    } catch { /* ignore */ }
  }
  const items = [];
  const pocketHost = (hay.match(POCKET_HOST_RE) || [])[1];
  const palmed = /\b(?:palmed|folded|pocketed|slipped|tucked|stuffed|stowed)\b/i.test(hay);
  if (palmed && /\bsandwich\b/i.test(hay) && /\bpocket\b/i.test(hay)) {
    const inside = pocketHost ? `pocket of the ${pocketHost}` : 'pocket';
    const owner = /\bhawks\b/i.test(hay) ? 'Hawks' : 'star';
    items.push({
      name: 'Sandwich',
      action: 'move',
      where: 'inside',
      inside,
      owner,
      reason: pocketHost ? `folded into the ${pocketHost} pocket` : 'folded into a pocket',
    });
  } else if (world && palmed && /\bpocket\b/i.test(hay)) {
    const named = (hay.match(/\b(sandwich|bag|keys|wallet|phone|letter|envelope|can)\b/i) || [])[1];
    if (named && findItemByName(world, named)) {
      const inside = pocketHost ? `pocket of the ${pocketHost}` : 'pocket';
      items.push({
        name: named,
        action: 'move',
        where: 'inside',
        inside,
        owner: /\bhawks\b/i.test(hay) ? 'Hawks' : 'star',
        reason: 'pocketed this turn',
      });
    }
  }
  const castDeltas = (people?.length || cast?.length || storage)
    ? inferSceneStatsDelta(hay, { people, cast, customBars, storage, scene, priorTime, nextTime, nextDay, elapsedMinutes })
    : [];
  const events = castDeltas.flatMap(c => (Array.isArray(c.events) ? c.events : []));
  return { location, items, cast: castDeltas, events };
}

function locDestRaw(loc) {
  return String(loc?.dest || loc?.destKey || loc?.to || '').trim();
}

export function mergeFilingPayload(payload, inferred) {
  const src = payload && typeof payload === 'object' && !isStubFiling(payload) ? { ...payload } : {};
  const inf = inferred && typeof inferred === 'object' ? inferred : {};
  const loc = src.location && typeof src.location === 'object' ? { ...src.location } : {};
  const infLoc = inf.location && typeof inf.location === 'object' ? inf.location : {};
  const locStub = !loc.mode || String(loc.mode).includes('|') || loc.mode === 'unknown';
  if (locStub && infLoc.mode) {
    src.location = { ...loc, ...infLoc };
  } else if (loc.mode) {
    src.location = { ...loc };
    const dest = locDestRaw(src.location);
    if (!dest || isTransitVehicleKey(dest)) {
      if (infLoc.dest) src.location.dest = infLoc.dest;
      else if (isTransitVehicleKey(dest)) src.location.dest = '';
      if (infLoc.place) src.location.place = infLoc.place;
    }
    if (infLoc.mode === 'compass' && (infLoc.place || infLoc.here)) {
      src.location = { ...src.location, ...infLoc, mode: 'compass' };
    }
  } else {
    src.location = infLoc;
  }
  const items = (Array.isArray(src.items) ? src.items : []).filter(it => String(it?.name || '').trim());
  src.items = items.length ? items : (inf.items || []);
  const srcCast = Array.isArray(src.cast)
    ? src.cast.filter(c => String(c?.name || '').trim() && !String(c.name).includes('|')).map(c => ({
      ...c,
      stats: c?.stats && typeof c.stats === 'object' ? { ...c.stats } : {},
    }))
    : [];
  const infCast = Array.isArray(inf.cast) ? inf.cast.filter(c => String(c?.name || '').trim()) : [];
  for (const infRow of infCast) {
    const key = String(infRow.name || '').trim().toLowerCase();
    const hit = srcCast.find(c => String(c.name || '').trim().toLowerCase() === key);
    if (!hit) {
      srcCast.push({
        ...infRow,
        stats: infRow.stats && typeof infRow.stats === 'object' ? { ...infRow.stats } : {},
      });
    } else if (infRow.stats && typeof infRow.stats === 'object') {
      for (const [k, v] of Object.entries(infRow.stats)) {
        if (hit.stats[k] == null || !Number.isFinite(Number(hit.stats[k]))) {
          hit.stats[k] = v;
        }
      }
      if (!hit.reason && infRow.reason) hit.reason = infRow.reason;
    }
  }
  src.cast = srcCast;
  src.events = [
    ...(Array.isArray(src.events) ? src.events : []),
    ...(Array.isArray(inf.events) ? inf.events : []),
  ];
  return src;
}

export function occupancyNoticeText(loc) {
  if (!loc) return '';
  const label = formatOccupancyLabel(loc, { lastLocationKey: loc.placeKey });
  if (loc.held) return label ? `Held: ${label}` : 'Held occupancy';
  if (loc.mode === 'moving' || /^Moving\b/.test(label)) return label || 'Moving';
  if (label) return `Compass: ${label}`;
  return String(loc.line || '').replace(/^Scene\/Location\s*\|\s*/i, '').trim();
}

function noteReceiptHealth(storage, bus, note) {
  try {
    noteHouseHealth(storage, { receipt: note });
    bus?.emit?.('showtime.stateChanged');
  } catch { /* ignore */ }
}

function commitReceipt(storage, receipt, bus, { stampTarget = 'user' } = {}) {
  storeLastReceipt(storage, receipt);
  try {
    noteHouseHealth(storage, {
      receipt: {
        status: 'filed',
        reason: receiptHasChanges(receipt) ? 'changes' : 'location',
        detail: occupancyNoticeText(receipt?.location) || receipt?.location?.line || '',
      },
    }, { save: false });
  } catch { /* ignore */ }
  const stampIdx = stampReceiptOnChat(receipt, { target: stampTarget });
  try { storage.saveChat(); } catch { /* ignore */ }
  bus?.emit('showtime.stateChanged');
  bus?.emit('cast.updated', {});
  bus?.emit('inventory.updated');
  const loc = receipt?.location;
  if (loc && (loc.changed || loc.held) && !clapperIsShowing(storage.getChat('backstage', {})?.trackers)) {
    const text = occupancyNoticeText(loc);
    if (text) {
      bus?.emit('showtime.notice', {
        kind: 'occupancy',
        items: [{ text, mark: loc.held ? '?' : '!' }],
      });
    }
  }
  if (Number.isFinite(stampIdx)) bus?.emit('receipt.stamped', { idx: stampIdx });
  const invNotes = (Array.isArray(receipt?.items) ? receipt.items : [])
    .map(it => ({
      name: String(it?.name || 'Item').trim(),
      toState: String(it?.change || '').trim(),
      mark: it?.change === 'removed' ? 'X' : '!',
    }))
    .filter(it => it.name);
  if (invNotes.length) {
    bus?.emit('showtime.notice', { kind: 'inventory', items: invNotes });
  }
  const fileNotes = Array.isArray(receipt?.fileNotices) ? receipt.fileNotices : [];
  if (fileNotes.length) {
    bus?.emit('showtime.notice', { kind: 'library', items: fileNotes });
  }
  const starNotes = Array.isArray(receipt?.starNotices) ? receipt.starNotices : [];
  if (starNotes.length) {
    bus?.emit('showtime.notice', { kind: 'status', items: starNotes });
  }
  bus?.emit('showtime.receiptFiled', { receipt });
  return receipt;
}

export function buildFilingPrompt({
  scene,
  travelLine,
  people,
  kitLines,
  itemLines,
  knownPlaces,
  trackerIds = [],
  difficulty = 'normal',
} = {}) {
  const ids = Array.isArray(trackerIds) && trackerIds.length
    ? trackerIds.map(id => String(id || '').trim()).filter(Boolean)
    : ['health', 'energy'];
  const diffHint = difficultyAuditHint(difficulty);
  const eventExample = `{"actor":"","kind":"stat","trackerId":"${ids[0] || 'health'}","delta":0,"reason":""}`;
  return `You are filing a lean turn receipt. Return ONLY JSON in the message content. No hidden reasoning. First character must be {.

Scene (recent lines):
${scene}

Current location:
${travelLine}

Known places (prefer these spellings when the scene is there; new scene names are welcome):
${knownPlaces || 'None filed'}

In-play cast:
${people || 'None'}

Kit now:
${kitLines || 'None'}

Star belongings:
${itemLines || 'None'}

Return:
{"events":[${eventExample}],"location":{"mode":"compass|moving|unknown","place":"","from":"","dest":"","transit":"enRoute|arriving|","reason":""},"items":[{"name":"","action":"move|add|remove|update","where":"worn|carried|inside|trunk|room|lost","owner":"star or name","inside":"","surface":"","document":false,"form":"letter|clipping|photo|warrant|file|note","house":"","reason":""}],"cast":[{"name":"","wardrobe":{"add":[],"update":[],"remove":[]},"props":{"add":[],"update":[],"remove":[]},"conditions":{"add":[],"update":[],"remove":[]},"reason":""}]}
Rules:
- events is one flat ordered list for the WHOLE turn, in narrative order, mixing every in-play character's actions. Each entry's kind is "stat" (moves a tracker), "move" (changes where someone is), or "item" (an object moved) — kind is for the printed receipt line; only "stat" entries drive a tracker number, so still also fill location/items/cast below for anything that must actually apply. actor is the character's name (or "Weslie, Hawks" for a shared action).
- ${statEventsPromptRules(ids).replace(/\n/g, '\n- ')}
- location.mode compass = here at a known/named place. moving = travelling (from → dest, transit enRoute or arriving). unknown = no reliable here. Plans to go are not occupancy.
- dest is a destination PLACE (building, station, district). Never dest=train/bus/flight/taxi — those are how you travel, not where.
- Off the vehicle / doors opened / on a platform / in a station or concourse = compass at that named place. An intermediate stop is occupancy.
- Do not copy Current location if the scene has already left it. When characters remain in the current location without leaving, keep the current location (prefer the specific shop/unit or room over the outer building).
- Prefer a known place name when it matches; otherwise keep the narrative's wording.
- Omit people and items that did not change. Empty arrays if none.
- Reason/source is required on every change (short clause from the scene).
- wardrobe = clothes currently ON a body. props = carried. items[] = any named object that moved (Star or in-play cast); set owner.
- Packing: spilled onto a counter/table/tile = where:room, surface:"counter" (not lost, not trunk). Stuffed into a bag = where:inside, inside:"messenger bag". Clothes in a bag are NOT wardrobe.
- Nested pockets: "side pocket" is a container inside that bag — inside:"side pocket of the messenger bag". "his back pocket" is a pocket on the wearer (inside:"back pocket", owner=that person).
- Already nested ("sketchbook with the red feather inside") = feather inside=sketchbook; keep that nest when the sketchbook moves.
- Explicitly left behind ("shampoo stayed on the bathroom tile") = where:room, surface:"bathroom tile" — do not pack it.
- Documents (letter, warrant, polaroid, memo, clipping, file): set document:true, form, optional house (affiliation name). That mints a File Cabinet stub. Ordinary envelopes/bags are items, not documents, unless they are the paper itself.
- stat events: only for cast members marked [stats on] (a cast member marked stats off gets no stat events — never log one onto another). Each stat event's delta is 1-5 for normal activity, walking, tension, or time passing on energy/thirst/hygiene; 4-10 for exertion, combat, a new injury, resting, sleeping, eating, drinking, bathroom relief, or washing — reserve the top of that range for something the scene spends real time on, not a passing line. Health does not move for tension, standing, waiting, talking, walking, or slight exertion. A thumb or finger nick drops health at most 1. A wound, bruise, blow, sprain, or burn may drop about 4. Severe trauma may drop about 7. Health bands: 95-100 Healthy, 85-94 Uncomfortable, 70-84 Hurt, 50-69 Injured, 30-49 Wounded, 15-29 Critical, 0-14 Dying. A wince or ache without a new wound drops at most 2 and never crosses out of Uncomfortable. Do not size a delta as if filing Hurt → Injured for mere tension or a nick. Polarity: health, energy, hunger (satiety), and thirst (hydration) are 0->100 higher=better — their delta is positive for the good direction; bathroom (bladder) and hygiene (odor) are 0->100 higher=worse — relief/washing is a NEGATIVE delta toward 0.
- ${diffHint}

JSON:`;
}

function changeFromKit(ch, reason) {
  if (!ch) return null;
  const name = String(ch.name || '').trim();
  if (!name) return null;
  let change = ch.action || 'updated';
  if (ch.action === 'add') change = ch.kind === 'wardrobe' ? 'on' : 'carried';
  if (ch.action === 'remove') change = 'removed';
  if (ch.action === 'update' && (ch.fromCondition || ch.toCondition)) {
    change = [ch.fromCondition, ch.toCondition].filter(Boolean).join(' → ');
  }
  return { name, change, reason: clipReason(reason || ch.reason || '') };
}

function escapeName(name) {
  return String(name || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Take, use, or refuse only when the object is this item or "it". */
export function readHandoffSentence(text, itemName) {
  const raw = String(text || '');
  const name = String(itemName || '').trim();
  if (!raw.trim() || name.length < 2) return '';
  const obj = `(?:the\\s+|a\\s+|an\\s+)?(?:${escapeName(name)}|it)\\b`;
  const gap = `(?:\\s+\\w+){0,4}\\s+`;
  const takeVerb = '(?:take|takes|took|taking|keep|keeps|kept|keeping|accept|accepts|accepted)';
  const useVerb = '(?:use|uses|used|using|eat|eats|ate|eating|drink|drinks|drank|drinking)';
  const neg = "(?:won't|wont|will not|don't|do not|never|not|can't|cannot)";
  const refuse = new RegExp(
    `\\b(?:refuse|refuses|refused|refusing)\\b${gap}${obj}`
    + `|\\b(?:don't|do not)\\s+want\\b${gap}${obj}`
    + `|\\bpush(?:es|ed)?\\b${gap}${obj}\\s+back\\b`
    + `|\\bpush(?:es|ed)?\\b${gap}${obj}\\s+away\\b`,
    'i',
  );
  if (refuse.test(raw)) return 'refuse';
  const negated = new RegExp(`\\b${neg}\\b(?:\\s+\\w+){0,6}\\s+${takeVerb}\\b${gap}${obj}`, 'i');
  if (negated.test(raw)) return 'refuse';
  if (new RegExp(`\\b${takeVerb}\\b${gap}${obj}`, 'i').test(raw)) return 'take';
  const use = new RegExp(
    `\\b${useVerb}\\b${gap}(?:up\\s+)?${obj}|\\b${useVerb}\\b${gap}${obj}\\s+up\\b`,
    'i',
  );
  if (use.test(raw)) return 'use';
  return '';
}

export function handoffItemOp({ itemName, wearable, owner, outcome }) {
  const name = String(itemName || '').trim();
  if (!name || outcome === 'refuse') return null;
  if (outcome === 'use') return { name, action: 'remove', reason: 'reply handoff' };
  if (outcome !== 'take') return null;
  return {
    name,
    action: 'move',
    where: wearable ? 'worn' : 'carried',
    owner: String(owner || '').trim() || 'star',
    reason: 'reply handoff',
  };
}

/** A handoff row replaces any model row of the same name. Other rows stay. */
export function mergeHandoffItem(items, op) {
  const list = Array.isArray(items) ? items.slice() : [];
  const name = String(op?.name || '').trim().toLowerCase();
  if (!name) return list;
  return [...list.filter(it => String(it?.name || '').trim().toLowerCase() !== name), op];
}

function pendingHandoffSeed(storage) {
  try {
    const seed = storage.getChat('inventory', {})?.handoffSeed;
    if (!seed?.op || seed.applied) return null;
    return seed;
  } catch {
    return null;
  }
}

function markHandoffSeedApplied(storage) {
  try {
    const inv = storage.getChat('inventory', {});
    if (!inv?.handoffSeed?.op) return;
    inv.handoffSeed.applied = true;
    storage.saveChat();
  } catch { /* ignore */ }
}

function pendingOutfitWearSeed(storage) {
  try {
    const seed = storage.getChat('cast', {})?.outfitWearSeed;
    if (!seed?.adds?.length || seed.applied) return null;
    return seed;
  } catch {
    return null;
  }
}

function markOutfitWearApplied(storage) {
  try {
    const cast = storage.getChat('cast', {});
    if (!cast?.outfitWearSeed?.adds?.length) return;
    cast.outfitWearSeed.applied = true;
    storage.saveChat();
  } catch { /* ignore */ }
}

/** Move this person's own pieces to worn, or mint a shelf piece they do not have. */
function applyNamedOutfit(world, char, adds) {
  const ownerId = char?.id || char?.name;
  const lines = [];
  if (!world || !ownerId) return lines;
  for (const add of adds || []) {
    const name = String(add?.name || '').trim();
    if (!name) continue;
    const owned = findOwnedItem(world, ownerId, name);
    if (owned?.loc?.where === 'worn') continue;
    const item = owned?.item || mintItem(world, {
      name,
      ownerId,
      description: add.description || '',
      category: 'wearable',
    });
    const moved = moveItem(world, item.id, { where: 'worn', ownerId }, { reason: 'named outfit' });
    if (!moved.ok) continue;
    lines.push({ name: moved.name || name, change: 'on', reason: 'named outfit' });
  }
  return lines;
}

function destWhere(op, parentId) {
  const whereRaw = String(op.where || op.location || '').toLowerCase();
  if (parentId || whereRaw === 'inside' || op.inside) return 'inside';
  if (whereRaw === 'worn' || whereRaw === 'wearing') return 'worn';
  if (whereRaw === 'trunk' || whereRaw === 'static') return 'trunk';
  if (whereRaw === 'room') return 'room';
  if (whereRaw === 'lost') return 'lost';
  if (whereRaw === 'person' || whereRaw === 'mobile' || whereRaw === 'carried') return 'carried';
  return 'carried';
}

export function applyItemOps(world, ops) {
  const out = [];
  for (const op of ops || []) {
    const name = String(op?.name || '').trim();
    if (!name) continue;
    const action = String(op.action || 'move').toLowerCase();
    const reason = clipReason(op.reason || op.source || '');
    const ownerId = resolveOwnerId(world, op.owner || 'star');
    const whereIntent = destWhere(op, op.inside ? 'inside' : '');
    let row = findOwnedItem(world, ownerId, name)?.item || null;
    if (!row && whereIntent !== 'worn') row = findPlaceItem(world, name)?.item || null;
    if (!row && action === 'add') {
      row = mintItem(world, {
        name,
        ownerId,
        kind: op.kind,
        category: op.category || (isGarmentName(name) ? 'wearable' : 'misc'),
        description: op.description || '',
      });
    }
    if (!row) continue;
    if (action === 'remove') {
      const found = findWorldItem(world, row.id);
      if (found) {
        if (found.pool === 'inventory') {
          world.inventory[found.loc] = (world.inventory[found.loc] || []).filter(x => x.id !== row.id);
        } else {
          found.list.splice(found.index, 1);
        }
        out.push({ name, change: 'removed', reason, id: row.id });
      }
      continue;
    }
    const parentId = op.inside ? ensureInsidePath(world, op.inside, ownerId) : '';
    let where = destWhere(op, parentId);
    if (parentId) where = 'inside';
    if (where === 'worn' && parentId) where = 'inside';
    const moved = moveItem(world, row.id, {
      where,
      ownerId,
      parentId,
      surface: op.surface || '',
      placeId: op.placeId || op.place || op.room || '',
      layer: op.layer || '',
    }, { reason });
    if (moved.ok && (action === 'add' || !sameLine(moved.from, moved.to))) {
      out.push({
        name,
        id: moved.item?.id || row.id,
        change: `${formatLocator(moved.from)} → ${formatLocator(moved.to, {
          parentName: parentId ? (findWorldItem(world, parentId)?.item?.name || '') : '',
        })}`,
        reason,
      });
    }
  }
  return out;
}

function sameLine(a, b) {
  return formatLocator(a) === formatLocator(b);
}

function handoffMessage(mesId) {
  try {
    const chat = getContext()?.chat || [];
    const idx = Number(mesId);
    if (Number.isFinite(idx) && chat[idx]) return { mes: chat[idx], idx };
    return lastKeptAiMessage(chat);
  } catch {
    return null;
  }
}

function writeReceiptCard(storage, hit, receipt) {
  receipt.text = formatReceipt(receipt);
  receipt.at = Date.now();
  storeLastReceipt(storage, receipt);
  const mes = hit?.mes;
  if (!mes || !Number.isFinite(hit.idx)) return;
  mes.extra = mes.extra && typeof mes.extra === 'object' ? mes.extra : {};
  mes.extra.showtimeReceipt = receiptExtra(receipt);
  try { saveChatDebounced(); } catch { /* ignore */ }
  queueReceiptPaint(hit.idx, mes.extra.showtimeReceipt);
}

function mergeCastWardrobeLines(cast, name, lines) {
  const who = String(name || '').trim().toLowerCase();
  const rows = (Array.isArray(cast) ? cast : []).map(r => ({
    ...r,
    wardrobe: Array.isArray(r?.wardrobe) ? r.wardrobe.slice() : [],
  }));
  if (!who || !lines?.length) return rows;
  let row = rows.find(r => String(r?.name || '').trim().toLowerCase() === who);
  if (!row) {
    row = { name, stats: [], wardrobe: [], props: [], conditions: [] };
    rows.push(row);
  }
  const have = new Set(row.wardrobe.map(l => String(l?.name || '').trim().toLowerCase()).filter(Boolean));
  for (const line of lines) {
    const key = String(line?.name || '').trim().toLowerCase();
    if (!key || have.has(key)) continue;
    have.add(key);
    row.wardrobe.push(line);
  }
  return rows;
}

/** Wardrobe adds for a named look after this message's receipt is already filed. */
export function fileOneOutfitWear(storage, seed) {
  const adds = seed?.adds || [];
  const name = String(seed?.name || '').trim();
  if (!name || !adds.length) return [];
  const people = inPlayCast(storage);
  const char = people.find(c => seed.charId && c.id === seed.charId)
    || people.find(c => castNameMatches(c, name));
  if (!char) return [];
  const world = worldFromStorage(storage);
  stampInventoryLocators(world.inventory, { ownerId: getStarMember(storage)?.id });
  const lines = applyNamedOutfit(world, char, adds);
  const hit = handoffMessage(seed.mesId);
  const base = hit?.mes?.extra?.showtimeReceipt || loadLastReceipt(storage) || emptyReceipt();
  writeReceiptCard(storage, hit, {
    ...base,
    items: base.items || [],
    cast: mergeCastWardrobeLines(base.cast, name, lines),
    location: base.location || null,
  });
  if (seed) seed.applied = true;
  markOutfitWearApplied(storage);
  try { storage.saveChat(); } catch { /* ignore */ }
  return lines;
}

/** One item op after the receipt for this message has already applied. */
export function fileOneHandoff(storage, seed) {
  const op = seed?.op;
  if (!op) return [];
  const world = worldFromStorage(storage);
  stampInventoryLocators(world.inventory, { ownerId: getStarMember(storage)?.id });
  const rows = applyItemOps(world, [op]);
  try { storage.saveChat(); } catch { /* ignore */ }
  const hit = handoffMessage(seed.mesId);
  const base = hit?.mes?.extra?.showtimeReceipt || loadLastReceipt(storage) || emptyReceipt();
  const row = rows[0] || { name: op.name, change: op.action, reason: op.reason || 'reply handoff' };
  writeReceiptCard(storage, hit, {
    ...base,
    items: mergeHandoffItem(base.items, row),
    cast: base.cast || [],
    location: base.location || null,
  });
  return rows;
}

/** Invert that one op and drop its line from the receipt card. */
export function rewindOneHandoff(storage, seed) {
  const undo = seed?.undo;
  if (!undo) return [];
  const world = worldFromStorage(storage);
  stampInventoryLocators(world.inventory, { ownerId: getStarMember(storage)?.id });
  const rows = applyItemOps(world, [undo]);
  try { storage.saveChat(); } catch { /* ignore */ }
  const hit = handoffMessage(seed.mesId);
  const base = hit?.mes?.extra?.showtimeReceipt || loadLastReceipt(storage);
  if (base) {
    const name = String(seed.op?.name || undo.name || '').trim().toLowerCase();
    writeReceiptCard(storage, hit, {
      ...base,
      items: (base.items || []).filter(it => String(it.name || '').trim().toLowerCase() !== name),
      cast: base.cast || [],
    });
  }
  return rows;
}

export function applyReceiptPayload(storage, payload, {
  scene,
  status,
  sceneText = '',
  priorTime = '',
  nextTime = '',
  elapsedMinutes,
  nextDay = false,
} = {}) {
  ensureStarStats(storage);
  const world = worldFromStorage(storage);
  stampInventoryLocators(world.inventory, { ownerId: getStarMember(storage)?.id });
  const receipt = emptyReceipt();
  const prevTravel = normalizeTravel(scene?.travel || defaultTravel(), { lastLocationKey: scene?.lastLocationKey });
  let locPatch = travelFromFiling(payload?.location || {}, { lastLocationKey: scene?.lastLocationKey });
  const locReason = clipReason(payload?.location?.reason || '');
  if (locPatch.mode === 'unknown' && prevTravel.mode !== 'unknown'
    && !/\b(lost|unlocated|unclear|no idea|can't tell)\b/i.test(locReason)) {
    locPatch = prevTravel;
  }
  if (locPatch.mode === 'moving') {
    const dest = (!locPatch.destKey || isTransitVehicleKey(locPatch.destKey))
      ? ''
      : locPatch.destKey;
    const prevDest = prevTravel.destKey && !isTransitVehicleKey(prevTravel.destKey)
      ? prevTravel.destKey
      : '';
    locPatch = {
      ...locPatch,
      fromKey: locPatch.fromKey || prevTravel.fromKey || prevTravel.placeKey || scene?.lastLocationKey || '',
      destKey: dest || prevDest,
    };
  }
  const prevLine = formatTravelLine(prevTravel, { lastLocationKey: scene?.lastLocationKey });
  const named = namedOccupancy(locPatch, { lastLocationKey: scene?.lastLocationKey });
  let locResult = { changed: false, held: false, travel: locPatch, line: prevLine };
  if (scene && (named || locPatch.mode !== 'unknown')) {
    try {
      locResult = commitNow(storage, { occupancy: locPatch }, {
        force: named,
        source: 'receipt',
        scene,
      });
    } catch {
      locResult = commitTravel(scene, locPatch, { boardHeld: named ? false : !!scene.boardHeld });
    }
  }
  const live = locResult.travel || locPatch;
  const liveKey = locResult.doc?.lastLocationKey || scene?.lastLocationKey;
  receipt.location = {
    ...normalizeTravel(live, { lastLocationKey: liveKey }),
    line: locResult.line || formatTravelLine(live, { lastLocationKey: liveKey }),
    changed: !!(locResult.changed),
    reason: locReason,
    held: false,
  };
  if (receipt.location.line === prevLine) receipt.location.changed = false;
  try {
    const compass = ensureCompass(storage.getChat('backstage', {}) || {});
    if (receipt.location.mode === 'compass') {
      syncOccupancyRoom(compass, receipt.location);
      if (sceneText) {
        const targetPlaceId = compass.activeRoomId || compass.sonar?.lastPlaceId || '';
        if (targetPlaceId) {
          populateRoomsFromNarrative(compass, sceneText, {
            targetPlaceId,
            createMissingRooms: false,
          });
        }
      }
    }
    const names = [
      locPatch.placeKey, locPatch.fromKey, locPatch.destKey,
      payload?.location?.place, payload?.location?.from, payload?.location?.dest,
    ];
    for (const name of names) {
      if (isTransitVehicleKey(name)) continue;
      rememberUnlisted(compass, storage, { name, source: 'chat' });
    }
  } catch { /* ignore */ }

  receipt.items = applyItemOps(world, payload?.items);
  const fileNotices = [];
  const stubOps = [...(payload?.items || [])];
  for (const row of receipt.items || []) {
    try {
      const idx = stubOps.findIndex(op =>
        String(op?.name || '').trim().toLowerCase() === String(row.name || '').trim().toLowerCase());
      const op = idx >= 0 ? stubOps.splice(idx, 1)[0] : null;
      const item = row.id ? findWorldItem(world, row.id)?.item : null;
      if (!item || !op) continue;
      const stubFile = stubDocumentFromItem(storage, item, op);
      if (stubFile) {
        fileNotices.push({
          text: `File · ${stubFile.title || row.name || 'Document'}`,
          mark: '+',
          fileId: stubFile.id,
        });
      }
      if (op.read || String(op.action || '').toLowerCase() === 'read'
        || String(op.action || '').toLowerCase() === 'add'
        || String(op.action || '').toLowerCase() === 'move') {
        exposeLinkedItem(storage, item.id, resolveOwnerId(world, op.owner || 'star'));
      }
    } catch (err) {
      console.warn('[Showtime/receipt] item file stub failed', row?.name, err);
    }
  }

  try {
    const st = storage.getChat('backstage', {}) || {};
    const compass = ensureCompass(st);
    const presence = syncCastPresence(storage, {
      chat: getContext()?.chat || [],
      compass,
      occupancy: receipt.location,
    });
    if (presence?.members?.length) syncSonarPresence(compass, presence.members);
  } catch { /* ignore */ }

  const people = inPlayCast(storage);
  const starId = getStarMember(storage)?.id || '';
  const starNotices = [];
  const difficulty = status?.difficulty
    || storage?.getChat?.('backstage', {})?.trackers?.status?.difficulty
    || 'normal';
  const byName = new Map(people.map(c => [String(c.name || '').trim().toLowerCase(), c]));
  // Preferred signal: an ordered events list (one signed delta per discrete action),
  // summed per actor + tracker id. `payload.events` already carries both the model's
  // own events and the heuristic's reshaped deltas when this came through
  // mergeFilingPayload; callers that bypass that merge (fallback paths) simply have none.
  const activeDefs = activeTrackerDefsForPeople(storage, people);
  const parsedEvents = parseStatEvents(payload, {
    trackerIds: activeDefs.map(d => d.id),
    actors: people.map(c => c.name),
  });
  const inferredCast = sceneText
    ? inferSceneStatsDelta(sceneText, { people, storage, scene, priorTime, nextTime, nextDay, elapsedMinutes })
    : [];
  // payload.events (above) may have been built from a differently-clipped slice of
  // the scene than this local heuristic pass gets (sceneText is the full raw
  // window), so fold this pass's own itemized events in too. Without this, a
  // tracker that only this pass caught falls through to the legacy stats-merge
  // below and prints whatever unrelated reason happened to be first for that
  // character instead of its own real reason.
  const inferredEvents = inferredCast.flatMap(row => Array.isArray(row.events) ? row.events : []);
  const groupedEvents = groupStatEvents([...parsedEvents, ...inferredEvents]);
  const mergedCastRows = (Array.isArray(payload?.cast) ? payload.cast : []).map(r => ({
    ...r,
    stats: r?.stats && typeof r.stats === 'object' ? { ...r.stats } : undefined,
  }));
  for (const [actorKey, bucket] of groupedEvents.entries()) {
    const hasRow = mergedCastRows.some(r => String(r?.name || '').trim().toLowerCase() === actorKey);
    if (!hasRow && bucket.actor) mergedCastRows.push({ name: bucket.actor, stats: {}, reason: '' });
  }
  for (const infRow of inferredCast) {
    const nm = String(infRow?.name || '').trim();
    if (!nm || !infRow.stats) continue;
    const char = byName.get(nm.toLowerCase()) || people.find(c => castNameMatches(c, nm));
    const existing = mergedCastRows.find(r => {
      const rName = String(r?.name || '').trim();
      return rName.toLowerCase() === nm.toLowerCase() || (char && castNameMatches(char, rName));
    });
    if (!existing) {
      mergedCastRows.push({
        name: nm,
        stats: { ...infRow.stats },
        reason: infRow.reason || 'scene activity',
      });
    } else {
      existing.stats = existing.stats && typeof existing.stats === 'object' ? { ...existing.stats } : {};
      const defs = char ? barDefsFor(storage, char) : [];
      for (const [statId, infVal] of Object.entries(infRow.stats)) {
        const def = defs.find(d => d.id === statId);
        const cur = (char && def)
          ? Math.min(statValue(char.stats, def), conditionStatCap(char, def.id))
          : null;
        const matchingKey = Object.keys(existing.stats).find(k =>
          (resolveTrackerId(k, defs) || String(k || '').trim()) === statId);
        const rawAi = matchingKey != null ? Number(existing.stats[matchingKey]) : NaN;
        if (!Number.isFinite(rawAi) || (cur != null && Math.round(rawAi) === cur)) {
          existing.stats[statId] = infVal;
        }
      }
      if (!existing.reason && infRow.reason) existing.reason = infRow.reason;
    }
  }

  let statsMutated = false;
  for (const row of mergedCastRows) {
    const nm = String(row?.name || '').trim();
    if (!nm) continue;
    try {
      const char = byName.get(nm.toLowerCase())
        || people.find(c => castNameMatches(c, nm));
      if (!char) continue;
      const reason = clipReason(row.reason || '');
      const eventBucket = groupedEvents.get(nm.toLowerCase());
      const include = [];
      if ((row.stats || eventBucket) && char.stats?.enabled) include.push('stats');
      if (row.wardrobe) include.push('wardrobe');
      if (row.props) include.push('props');
      if (row.conditions) include.push('condition');
      if (!include.length) continue;
      const defs = char.stats?.enabled ? barDefsFor(storage, char) : [];
      const priorStats = new Map();
      for (const def of defs) {
        priorStats.set(def.id, Math.min(statValue(char.stats, def), conditionStatCap(char, def.id)));
      }
      const healthHay = sceneText ? charRelevantHay(sceneText, char, people) : '';
      const delta = parseCastDelta(JSON.stringify({
        stats: row.stats && typeof row.stats === 'object' ? row.stats : undefined,
        wardrobe: row.wardrobe,
        props: row.props,
        conditions: row.conditions,
      }), { include, trackers: defs });
      const kit = applyCastDelta(char, delta, { include, storage });
      stampCastKitLocators(world, char, kit.changes);
      const entry = { name: nm, stats: [], wardrobe: [], props: [], conditions: [] };
      const handledIds = new Set();
      if ((row.stats || eventBucket) && char.stats?.enabled) {
        // Legacy fallback source: a guessed final absolute number, used only for
        // tracker ids the events list above didn't touch.
        const legacyStats = (delta?.stats && typeof delta.stats === 'object' && Object.keys(delta.stats).length)
          ? delta.stats
          : (row.stats || {});
        const legacyById = {};
        for (const [rawId, val] of Object.entries(legacyStats)) {
          const n = Number(val);
          if (!Number.isFinite(n)) continue;
          legacyById[resolveTrackerId(rawId, defs) || String(rawId || '').trim()] = n;
        }
        for (const def of defs) {
          if (handledIds.has(def.id)) continue;
          const cur = priorStats.has(def.id) ? priorStats.get(def.id) : statValue(char.stats, def);
          const evInfo = eventBucket?.trackers.get(def.id);
          let proposed;
          let eventReason = '';
          if (evInfo && evInfo.delta) {
            proposed = clampStat(cur + evInfo.delta);
            eventReason = evInfo.lines.join('; ');
          } else if (Object.prototype.hasOwnProperty.call(legacyById, def.id)) {
            proposed = legacyById[def.id];
          } else {
            continue;
          }
          handledIds.add(def.id);
          const before = stateLabel(def, cur);
          const scaled = applyDifficultyToStat(cur, proposed, {
            difficulty,
            direction: def.direction || 'up',
          });
          const sceneScaled = def.id === 'health' && scaled < cur
            ? clampHealthProposal(cur, scaled, healthHay)
            : scaled;
          const capped = Math.min(sceneScaled, conditionStatCap(char, def.id));
          const next = setStatValue(char.stats, def, capped);
          const after = stateLabel(def, next);
          if (cur === next) continue;
          statsMutated = true;
          if (starId && char.id === starId && def.levelMode !== 'none' && def.levelMode !== 'amount'
            && before && after && before !== after) {
            starNotices.push({ name: nm, toState: after, threshold: true, characterId: char.id });
          }
          const chip = statTitleChip(def, cur, next);
          if (chip) {
            entry.stats.push({ name: chip.name, change: chip.change, reason: eventReason || reason });
            try {
              const detail = eventReason ? ` (${eventReason})` : '';
              appendNowLedger(storage, { kind: 'stat', text: `${nm} · ${chip.name}: ${chip.change}${detail}` });
            } catch { /* ignore */ }
          }
        }
      }
      if (char.stats?.enabled) {
        for (const def of defs) {
          if (handledIds.has(def.id)) continue;
          const cur = priorStats.get(def.id);
          const capped = Math.min(statValue(char.stats, def), conditionStatCap(char, def.id));
          if (cur == null || cur === capped) continue;
          const next = setStatValue(char.stats, def, capped);
          statsMutated = true;
          const before = stateLabel(def, cur);
          const after = stateLabel(def, next);
          if (starId && char.id === starId && def.levelMode !== 'none' && def.levelMode !== 'amount'
            && before && after && before !== after) {
            starNotices.push({ name: nm, toState: after, threshold: true, characterId: char.id });
          }
          const chip = statTitleChip(def, cur, next);
          if (chip) {
            entry.stats.push({ name: chip.name, change: chip.change, reason: reason || 'condition cap' });
            try {
              appendNowLedger(storage, { kind: 'stat', text: `${nm} · ${chip.name}: ${chip.change}` });
            } catch { /* ignore */ }
          }
        }
      }
      for (const ch of kit.changes || []) {
        const line = changeFromKit(ch, reason);
        if (!line) continue;
        if (ch.kind === 'wardrobe') entry.wardrobe.push(line);
        else if (ch.kind === 'props') entry.props.push(line);
        else {
          entry.conditions.push(line);
          starNotices.push({
            text: `${nm} · ${line.name} (${line.change})`,
            mark: line.change === 'removed' ? '-' : '!',
            characterId: char.id,
          });
        }
      }
      if (entry.stats.length || entry.wardrobe.length || entry.props.length || entry.conditions.length) {
        receipt.cast.push(entry);
      }
    } catch (err) {
      console.warn('[Showtime/receipt] cast row failed', nm, err);
    }
  }
  if (statsMutated) {
    try { storage?.saveChat?.(); } catch { /* ignore */ }
  }

  receipt.fileNotices = fileNotices;
  receipt.starNotices = starNotices;
  const labelById = Object.fromEntries(activeDefs.map(d => [d.id, d.label]));
  const rawEvents = Array.isArray(payload?.events) ? payload.events : [];
  receipt.events = parseStatEvents(payload, {
    trackerIds: activeDefs.map(d => d.id),
    actors: people.map(c => c.name),
  }).map(ev => ({ ...ev, line: formatStatEventLine(ev, { label: labelById[ev.trackerId] }) }))
    .concat(
      rawEvents
        .filter(ev => ev && String(ev.kind || 'stat').toLowerCase() !== 'stat')
        .map(ev => ({
          actor: String(ev.actor || '').trim(),
          kind: String(ev.kind || '').trim().toLowerCase(),
          action: String(ev.action || '').trim(),
          to: String(ev.to || ev.dest || '').trim(),
          reason: String(ev.reason || '').trim(),
          line: formatStatEventLine(ev),
        })),
    )
    .filter(ev => ev.line);
  receipt.text = formatReceipt(receipt);
  receipt.at = Date.now();
  return receipt;
}

function receiptExtra(receipt) {
  return {
    text: receipt?.text || formatReceipt(receipt),
    location: receipt?.location || null,
    cast: receipt?.cast || [],
    items: receipt?.items || [],
    at: receipt?.at || Date.now(),
  };
}

export function lastKeptAiMessage(chat) {
  const list = Array.isArray(chat) ? chat : [];
  for (let i = list.length - 1; i >= 0; i--) {
    const mes = list[i];
    if (mes && !mes.is_user && !mes.is_system) return { mes, idx: i };
  }
  return null;
}

/** Glue a filing onto a chat row. User mes get a wrap the next generate can read; AI mes get extra + paint only. */
export function appendReceiptToMes(receipt, messageId, { wrap = true } = {}) {
  if (!receipt) return null;
  try {
    const ctx = getContext();
    const chat = ctx?.chat || [];
    const hinted = Number(messageId);
    const last = (Number.isFinite(hinted) && chat[hinted] && !chat[hinted].is_system)
      ? chat[hinted]
      : null;
    if (!last) return null;
    if (wrap && !last.is_user) return null;
    const extra = receiptExtra(receipt);
    const body = String(extra.text || '').trim();
    if (!body && !extra.location?.line) return null;
    last.extra = last.extra && typeof last.extra === 'object' ? last.extra : {};
    last.extra.showtimeReceipt = extra;
    if (wrap) {
      const ticket = wrapReceiptText(body);
      if (!ticket) return null;
      const stripped = stripReceiptWrap(String(last.mes || '')).replace(/\s+$/, '');
      const next = stripped ? `${stripped}\n\n${ticket}` : ticket;
      if (String(last.mes || '') !== next) last.mes = next;
    }
    try { saveChatDebounced(); } catch { /* ignore */ }
    const stampedIdx = (Number.isFinite(hinted) && chat[hinted] === last) ? hinted : chat.indexOf(last);
    restoreLatestReceipt({ preferIdx: stampedIdx, save: true });
    return chat.indexOf(last);
  } catch (err) {
    console.warn('[Showtime/receipt] append failed', err);
    return null;
  }
}

export function appendReceiptToUserMes(receipt, messageId) {
  return appendReceiptToMes(receipt, messageId, { wrap: true });
}

export function paintExistingReceipt(messageId) {
  try {
    const chat = getContext()?.chat || [];
    const hinted = Number(messageId);
    const mes = Number.isFinite(hinted) ? chat[hinted] : null;
    const extra = mes?.extra?.showtimeReceipt;
    if (!extra) return null;
    queueReceiptPaint(hinted, extra);
    return hinted;
  } catch {
    return null;
  }
}

export function stampReceiptOnChat(receipt, { target = 'user' } = {}) {
  if (!receiptHasChanges(receipt) && !receipt?.location?.line) {
    receipt = receipt || fallbackReceipt();
    receipt.location = receipt.location || {};
    receipt.location.line = receipt.location.line || 'Scene/Location | Unknown';
  }
  try {
    const chat = getContext()?.chat || [];
    if (target === 'ai') {
      const hit = lastKeptAiMessage(chat);
      if (!hit) return null;
      return appendReceiptToMes(receipt, hit.idx, { wrap: false });
    }
    const hit = lastKeptUserMessage(chat);
    if (!hit) return null;
    return appendReceiptToMes(receipt, hit.idx, { wrap: true });
  } catch (err) {
    console.warn('[Showtime/receipt] stamp failed', err);
    return null;
  }
}

/** Ticket sits under the bubble prose, as a sibling of `.mes_text`. */
export function receiptCardInsertSpot(mesText) {
  return { node: mesText, where: 'afterend' };
}

export function findChatMesRoot(idx) {
  if (typeof document === 'undefined') return null;
  const id = String(idx ?? '');
  const nodes = id ? [...document.querySelectorAll(`.mes[mesid="${id}"]`)] : [];
  const withText = nodes.filter(el => el.querySelector?.('.mes_text'));
  const scoped = (withText.length ? withText : nodes).filter(el => el.closest?.('#chat'));
  const pool = scoped.length ? scoped : (withText.length ? withText : nodes);
  if (pool.length) return pool[pool.length - 1];
  const chat = document.getElementById('chat') || document.querySelector('#chat');
  const bubbles = [...(chat?.querySelectorAll('.mes') || [])];
  for (let i = bubbles.length - 1; i >= 0; i--) {
    const el = bubbles[i];
    if (el.getAttribute('is_system') === 'true') continue;
    if (el.querySelector('.mes_text')) return el;
  }
  return null;
}

export function paintReceiptCard(idx, receipt, { quiet = false } = {}) {
  try {
    const root = findChatMesRoot(idx);
    const mesText = root?.querySelector('.mes_text');
    if (!root || !mesText) {
      if (!quiet) console.warn('[Showtime/receipt] paint: no mes_text', { idx, hasRoot: !!root });
      return false;
    }
    root.querySelectorAll('.st-chat-receipt').forEach(el => el.remove());
    stripReceiptWrapFromElement(mesText);
    const html = buildReceiptHtml(receipt);
    if (!html) {
      if (!quiet) console.warn('[Showtime/receipt] paint: empty html', { idx, hasLocation: !!receipt?.location });
      return false;
    }
    const spot = receiptCardInsertSpot(mesText);
    if (spot?.node?.insertAdjacentHTML) spot.node.insertAdjacentHTML(spot.where, html);
    return !!root.querySelector('.st-chat-receipt');
  } catch (err) {
    if (!quiet) console.warn('[Showtime/receipt] paint failed', err);
    return false;
  }
}

export function queueReceiptPaint(idx, receipt) {
  const run = (quiet) => paintReceiptCard(idx, receipt, { quiet });
  run(true);
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => run(true));
  setTimeout(() => run(true), 60);
  setTimeout(() => run(false), 400);
}

export function loadLastReceipt(storage) {
  try {
    const bst = storage.getChat('backstage', {});
    return bst.receipts?.last || null;
  } catch {
    return null;
  }
}

export function storeLastReceipt(storage, receipt) {
  const bst = storage.getChat('backstage', {});
  const ring = Array.isArray(bst.receipts?.ring) ? bst.receipts.ring.slice(-4) : [];
  ring.push({ text: receipt.text, at: receipt.at });
  bst.receipts = { last: receipt, ring };
}

function currentFilingTravelLine(scene, compass) {
  const travel = normalizeTravel(scene?.travel || defaultTravel(), { lastLocationKey: scene?.lastLocationKey });
  const base = formatTravelLine(travel, { lastLocationKey: scene?.lastLocationKey });
  if (travel.mode !== 'compass' || !compass?.rooms) return base;
  const place = travel.placeId ? compass.rooms[travel.placeId] : null;
  if (!place) return base;
  const parent = place.parentId ? compass.rooms[place.parentId] : null;
  const hereKey = String(travel.placeKey || scene?.lastLocationKey || '').trim();
  const roomName = String(place.name || '').trim();
  if (parent?.name && parent.kind === 'unit' && hereKey.toLowerCase() !== parent.name.toLowerCase()) {
    return `Scene/Location | Compass: ${parent.name} (${roomName})`;
  }
  if (roomName && hereKey && roomName.toLowerCase() !== hereKey.toLowerCase()) {
    return `${base} (${roomName})`;
  }
  return base;
}

export function peopleSnapshotLines(storage, people) {
  return (people || []).map((c) => {
    if (!c.stats?.enabled) return `- ${c.name} (stats off)`;
    const defs = barDefsFor(storage, c);
    const bits = defs.map((d) => {
      const now = Math.min(statValue(c.stats, d), conditionStatCap(c, d.id));
      const title = d.levelMode === 'none' || d.levelMode === 'amount' ? '' : stateLabel(d, now);
      const dir = d.direction === 'down' ? '0->100 higher=worse' : '0->100 higher=better';
      const bands = formatTrackerBands(d);
      const hint = d.auditHint || d.description || '';
      const meta = [dir, hint, bands ? `bands: ${bands}` : ''].filter(Boolean).join('; ');
      return title
        ? `${d.id}=${now} "${title}" (${d.label}: ${meta})`
        : `${d.id}=${now} (${d.label}: ${meta})`;
    });
    return `- ${c.name} [stats on]: ${bits.join(' | ') || 'stats on'}`;
  }).join('\n');
}

const OFFSCREEN_NEEDS = Object.freeze([
  { id: 'hunger', below: 60, to: 72, verb: 'ate' },
  { id: 'thirst', below: 80, to: 82, verb: 'drank' },
  { id: 'bathroom', above: 70, to: 18, verb: 'used the bathroom' },
  { id: 'hygiene', above: 65, to: 18, verb: 'washed up' },
]);

function joinNeedVerbs(verbs) {
  const list = (verbs || []).filter(Boolean);
  if (list.length <= 1) return list[0] || '';
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  return `${list.slice(0, -1).join(', ')}, and ${list[list.length - 1]}`;
}

/**
 * Absent and privy cast who are not in this scene's prose take care of a
 * need that has already gone bad. In-play, written-out, and anyone the
 * scene text is actually about are left to the filing pass.
 * @returns {{ id: string, name: string, acts: { id: string, to: number, verb: string }[] }[]}
 */
export function planOffscreenNeeds(characters, { sceneText = '' } = {}) {
  const hay = String(sceneText || '');
  const out = [];
  for (const char of characters || []) {
    if (!char?.stats?.enabled || char.priority === 'director') continue;
    const presence = normalizeCastPresence(char);
    if (presence !== 'absent' && presence !== 'privy') continue;
    if (hay && bodyTextForCharacter(char, hay, characters).trim()) continue;
    const defs = barDefsFor(null, char);
    const acts = [];
    for (const need of OFFSCREEN_NEEDS) {
      const def = defs.find(d => d.id === need.id);
      if (!def) continue;
      const cur = statValue(char.stats, def);
      const due = need.below != null ? cur < need.below : cur >= need.above;
      if (!due) continue;
      acts.push({ id: need.id, to: need.to, verb: need.verb });
    }
    if (!acts.length) continue;
    out.push({ id: char.id, name: String(char.name || 'Cast').trim() || 'Cast', acts });
  }
  return out;
}

/** Apply planOffscreenNeeds and tell the user. The line stays out of [Now]. */
export function applyOffscreenNeeds(storage, { sceneText = '', bus } = {}) {
  const cast = getCastRecords(storage);
  const plan = planOffscreenNeeds(cast, { sceneText });
  if (!plan.length) return [];
  const lines = [];
  for (const row of plan) {
    const char = cast.find(c => c && c.id === row.id);
    if (!char?.stats) continue;
    const defs = barDefsFor(storage, char);
    const did = [];
    for (const act of row.acts) {
      const def = defs.find(d => d.id === act.id);
      if (!def) continue;
      const cur = Math.min(statValue(char.stats, def), conditionStatCap(char, def.id));
      const cap = conditionStatCap(char, def.id);
      const next = def.direction === 'down' ? act.to : Math.min(act.to, cap);
      if (def.direction === 'down' ? next >= cur : next <= cur) continue;
      setStatValue(char.stats, def, next);
      did.push(act.verb);
    }
    if (did.length) lines.push(`${row.name} ${joinNeedVerbs(did)}, off screen`);
  }
  if (!lines.length) return [];
  try { storage.saveChat(); } catch { /* ignore */ }
  try { appendNowLedger(storage, { kind: 'offscreen', text: lines.join('. ') }); } catch { /* ignore */ }
  try {
    bus?.emit?.('showtime.notice', {
      kind: 'status',
      items: lines.map(text => ({ text, mark: '·' })),
    });
    bus?.emit?.('trackers.updated', {});
  } catch { /* ignore */ }
  return lines;
}

export async function runReceiptFiling(storage, { bus, cursor, force = false, stampTarget } = {}) {
  let status = {};
  let scene = {};
  let receiptCfg = {};
  let bst;
  try {
    bst = storage.getChat('backstage', {});
    bst.trackers = normalizeTrackers(bst.trackers);
    status = bst.trackers.status || {};
    scene = bst.trackers.scene || {};
    receiptCfg = bst.trackers.receipt || {};
    bst.trackers.scene = scene;
  } catch {
    return null;
  }
  if (!receiptCfg.enabled) {
    console.log('[Showtime/receipt] skip: disabled');
    noteReceiptHealth(storage, bus, { status: 'skip', reason: 'disabled' });
    return null;
  }
  const cadence = receiptCfg.cadence || 'per_turn';
  if (!force && cadence === 'manual') {
    console.log('[Showtime/receipt] skip: cadence is manual');
    noteReceiptHealth(storage, bus, { status: 'skip', reason: 'manual' });
    return null;
  }
  const chat = getContext()?.chat || [];
  const play = chat.filter(m => m && !m.is_system);
  const charN = play.filter(m => !m.is_user).length;
  const n = (cadence === 'per_n' || cadence === 'per_post') ? charN : play.length;
  const every = Math.max(1, Number(receiptCfg.everyN) || 4);
  const gate = cursor || bst;
  if (!force) {
    if (!gate._receiptPrimed) {
      gate._receiptPrimed = true;
      gate._receiptLastCount = n;
      console.log('[Showtime/receipt] skip: primed', { n, cadence });
      noteReceiptHealth(storage, bus, { status: 'skip', reason: 'primed', detail: cadence });
      return null;
    }
    const prevGate = gate._receiptLastCount || 0;
    if (cadence === 'per_n' && n - prevGate < every) {
      console.log('[Showtime/receipt] skip: every-N', { cadence, n, prev: prevGate, every });
      noteReceiptHealth(storage, bus, {
        status: 'skip',
        reason: 'every-N',
        detail: `${n - prevGate}/${every}`,
      });
      return null;
    }
  }
  const prev = gate._receiptLastCount || 0;
  const clipRow = (m) => formatChatLine({ ...m, mes: stripReceiptWrap(m?.mes) }, 480);
  let windowRows = playMessagesSince(chat, prev);
  let windowText = windowRows.map(clipRow).filter(Boolean).join('\n');
  // A failed or quiet generation leaves no new lines. Reusing the last few
  // messages would call the filing API again with nothing new to file.
  if (!windowText.trim() && force) {
    windowRows = playMessagesSince(chat, Math.max(0, play.length - 4));
    windowText = windowRows.map(clipRow).filter(Boolean).join('\n');
  }
  const sceneClip = windowText.trim().slice(0, 1800);
  if (!sceneClip) {
    console.log('[Showtime/receipt] skip: empty window', { n, prev });
    noteReceiptHealth(storage, bus, { status: 'skip', reason: 'empty window' });
    return null;
  }
  gate._receiptPrimed = true;
  gate._receiptLastCount = n;
  ensureStarStats(storage);
  const people = inPlayCast(storage);
  const activeDefs = activeTrackerDefsForPeople(storage, people);
  const trackerIds = activeDefs.map(d => d.id);
  const difficulty = status?.difficulty || 'normal';
  const target = stampTarget
    || (force || cadence === 'per_turn' || cadence === 'manual' ? 'user' : 'ai');
  console.log('[Showtime/receipt] filing lean turn receipt', { cadence, n, prev, target, windowChars: sceneClip.length });

  const world = worldFromStorage(storage);
  stampInventoryLocators(world.inventory, { ownerId: getStarMember(storage)?.id });
  const kitLines = people.slice(0, 6).map((c) => {
    const kit = kitViewFor(c, world);
    const wear = (kit.wardrobe || []).map(x => x.name).join(', ') || '—';
    const carry = formatCarryBrief(kit.props || []);
    return `- ${c.name}: wearing ${wear}; carrying ${carry}`;
  }).join('\n');
  const itemLines = [...(world.inventory.mobile || []), ...(world.inventory.static || [])]
    .slice(0, 36)
    .map((x) => {
      const hint = { list: (world.inventory.static || []).includes(x) ? 'static' : 'mobile' };
      return `- ${x.name} (${formatItemPlace(x, hint, world)})`;
    })
    .join('\n');
  const peopleLines = peopleSnapshotLines(storage, people);
  let compass = null;
  try { compass = ensureCompass(bst); } catch { /* ignore */ }
  const travelLine = currentFilingTravelLine(scene, compass);
  let knownPlaces = 'None filed';
  try {
    knownPlaces = (compass && knownPlaceRoster(compass)) || 'None filed';
  } catch { /* ignore */ }

  const prompt = buildFilingPrompt({
    scene: sceneClip,
    travelLine,
    people: peopleLines,
    kitLines,
    itemLines,
    knownPlaces,
    trackerIds,
    difficulty,
  });
  const handoff = pendingHandoffSeed(storage);
  const outfitWear = pendingOutfitWearSeed(storage);
  const rawWindowProse = windowRows
    .map(m => stripReceiptWrap(String(m?.mes || '')).trim())
    .filter(Boolean)
    .join('\n\n');
  const elapsedMinutes = turnGapMinutes(windowRows);
  let raw = '';
  try {
    raw = String(await withShowtimeProfile(storage, 'audit', () =>
      leanQuietGenerate(prompt, { kind: 'filing' })) ?? '').trim();
  } catch (err) {
    console.warn('[Showtime/receipt] generate failed; stamping location fallback', err);
    const fallback = fallbackReceipt(scene);
    try {
      const filed = applyReceiptPayload(
        storage,
        { items: handoff?.op ? [handoff.op] : [] },
        { scene, status, sceneText: rawWindowProse || sceneClip, elapsedMinutes },
      );
      fallback.items = filed.items || [];
      fallback.cast = filed.cast || [];
      fallback.starNotices = filed.starNotices || [];
      if (outfitWear) {
        const peopleNow = inPlayCast(storage);
        const char = peopleNow.find(c => outfitWear.charId && c.id === outfitWear.charId)
          || peopleNow.find(c => castNameMatches(c, outfitWear.name));
        if (char) {
          const wornWorld = worldFromStorage(storage);
          stampInventoryLocators(wornWorld.inventory, { ownerId: getStarMember(storage)?.id });
          const lines = applyNamedOutfit(wornWorld, char, outfitWear.adds);
          fallback.cast = mergeCastWardrobeLines(fallback.cast, outfitWear.name, lines);
        }
      }
      fallback.text = formatReceipt(fallback);
      if (handoff?.op) markHandoffSeedApplied(storage);
      if (outfitWear) markOutfitWearApplied(storage);
    } catch { /* the seed stays for a later button */ }
    try { applyOffscreenNeeds(storage, { sceneText: rawWindowProse || sceneClip, bus }); } catch { /* ignore */ }
    return commitReceipt(storage, fallback, bus, { stampTarget: target });
  }
  const inferred = inferReceiptFromScene(sceneClip, { world, compass, people, storage, scene, elapsedMinutes });
  let payload = parseJsonObject(raw);
  if (!payload || isStubFiling(payload)) {
    if (!payload) {
      console.warn('[Showtime/receipt] filing did not return JSON; using scene cues', raw.slice(0, 180));
    } else {
      console.warn('[Showtime/receipt] filing returned a schema stub; using scene cues');
    }
    payload = mergeFilingPayload(null, inferred);
  } else {
    payload = mergeFilingPayload(payload, inferred);
  }
  if (handoff?.op) payload.items = mergeHandoffItem(payload.items, handoff.op);
  let receipt;
  let handoffFiled = false;
  let outfitFiled = false;
  try {
    receipt = applyReceiptPayload(storage, payload, { scene, status, sceneText: rawWindowProse, elapsedMinutes });
    handoffFiled = !!handoff?.op;
    if (outfitWear) {
      const people = inPlayCast(storage);
      const char = people.find(c => outfitWear.charId && c.id === outfitWear.charId)
        || people.find(c => castNameMatches(c, outfitWear.name));
      if (char) {
        const wornWorld = worldFromStorage(storage);
        stampInventoryLocators(wornWorld.inventory, { ownerId: getStarMember(storage)?.id });
        const lines = applyNamedOutfit(wornWorld, char, outfitWear.adds);
        receipt.cast = mergeCastWardrobeLines(receipt.cast, outfitWear.name, lines);
        receipt.text = formatReceipt(receipt);
        outfitFiled = true;
      }
    }
  } catch (err) {
    console.warn('[Showtime/receipt] apply failed; stamping location fallback', err);
    receipt = fallbackReceipt(scene);
    if (handoff?.op) {
      try {
        const world = worldFromStorage(storage);
        stampInventoryLocators(world.inventory, { ownerId: getStarMember(storage)?.id });
        receipt.items = applyItemOps(world, [handoff.op]);
        receipt.text = formatReceipt(receipt);
        handoffFiled = true;
      } catch { /* seed stays until a desk button files it */ }
    }
    if (outfitWear) {
      try {
        const people = inPlayCast(storage);
        const char = people.find(c => outfitWear.charId && c.id === outfitWear.charId)
          || people.find(c => castNameMatches(c, outfitWear.name));
        if (char) {
          const world = worldFromStorage(storage);
          stampInventoryLocators(world.inventory, { ownerId: getStarMember(storage)?.id });
          const lines = applyNamedOutfit(world, char, outfitWear.adds);
          receipt.cast = mergeCastWardrobeLines(receipt.cast, outfitWear.name, lines);
          receipt.text = formatReceipt(receipt);
          outfitFiled = true;
        }
      } catch { /* the look stays seeded until a later filing */ }
    }
  }
  if (handoffFiled) markHandoffSeedApplied(storage);
  if (outfitFiled) markOutfitWearApplied(storage);
  if (!receiptHasChanges(receipt) && !receipt.location?.line) {
    receipt.location = receipt.location || {};
    receipt.location.line = receipt.location.line || 'no kit / item / location change';
  }
  try { applyOffscreenNeeds(storage, { sceneText: rawWindowProse || sceneClip, bus }); } catch { /* ignore */ }
  const out = commitReceipt(storage, receipt, bus, { stampTarget: target });
  console.log('[Showtime/receipt] filed', {
    stored: true,
    changes: receiptHasChanges(receipt),
    loc: receipt?.location?.line || '',
    target,
  });
  return out;
}

export function smokeReceiptPure() {
  try {
    const bars = smokeStatBarsPure();
    if (bars) return bars;
    const locLine = formatTravelLine({
      mode: 'moving', fromKey: 'street', destKey: 'duplex', transit: 'arriving',
    });
    if (!/street → duplex/.test(locLine) && !/street/.test(locLine)) return 'moving format';
    if (occupancyNoticeText({ mode: 'compass', placeKey: 'Fukuoka Central', changed: true }) !== 'Compass: Fukuoka Central') {
      return 'occupancy notice should read Compass: place';
    }
    if (occupancyNoticeText({
      mode: 'moving', fromKey: 'Safehouse', destKey: 'Heights', changed: true,
    }) !== 'Moving: Safehouse → Heights') {
      return 'occupancy notice should read the moving line';
    }
    if (occupancyNoticeText({ mode: 'compass', placeKey: 'Mall', held: true }) !== 'Held: Mall') {
      return 'occupancy notice should mark a held proposal';
    }
    const receipt = {
      location: { line: locLine, changed: true, mode: 'moving' },
      cast: [{
        name: 'Aiko',
        wardrobe: [{ name: 'windbreaker', change: 'on', reason: 'from the hook' }],
        props: [],
        conditions: [],
        stats: [{ name: 'Energy', change: 'Drained → Exhausted', reason: 'late night' }],
      }, {
        name: 'Quiet',
        wardrobe: [],
        props: [],
        conditions: [],
        stats: [],
      }],
      items: [],
    };
    const text = formatReceipt(receipt);
    if (!/Aiko/.test(text) || !/windbreaker/.test(text) || !/from the hook/.test(text)) {
      return 'cast change line should print';
    }
    if (/Quiet/.test(text)) return 'unchanged cast should be omitted';
    const html = buildReceiptHtml(receipt);
    if (!html.includes('st-chat-receipt') || !html.includes('windbreaker')) return 'html card';
    if (!html.includes('st-ticket-bars') || !html.includes('Turn Receipt') || html.includes('FILED THIS TURN')) {
      return 'receipt should paint as a citation ticket';
    }
    if (!html.includes('<details') || !html.includes('st-ticket-sum')) return 'receipt should fold';
    if (!html.includes('st-ticket-chip') || !html.includes('Energy')) return 'tracker changes should print as chips';
    if (!html.includes('st-ticket-cast') || !html.includes('st-ticket-who')) return 'cast should sit on a horizontal row';
    const wrappedMes = `I palmed the sandwich.\n\n${wrapReceiptText('Scene/Location | train\n    Item | sandwich | inside pocket')}`;
    if (stripReceiptWrap(wrappedMes).trim() !== 'I palmed the sandwich.') return 'wrap strip/append roundtrip';
    if (!wrappedMes.includes(RECEIPT_WRAP_OPEN) || !wrappedMes.includes(RECEIPT_WRAP_CLOSE)) {
      return 'append should wrap ticket text';
    }
    const clip = formatChatLine({ mes: wrappedMes, is_user: true, name: 'You' }, 480);
    if (/ShowtimeReceipt|FILED THIS TURN|Scene\/Location \| train/.test(clip)) {
      return 'stub user mes does not leak wrap into scene clip';
    }
    if (!/palmed the sandwich/i.test(clip)) return 'scene clip should keep user prose';
    if (!lastUserHasReceiptWrap([{ is_user: true, mes: wrappedMes }])) return 'wrap detect';
    if (lastUserHasReceiptWrap([{ is_user: true, mes: 'Hey' }])) return 'wrap detect false';
    const stub = isStubFiling({
      location: { mode: 'compass|moving|unknown', place: '', dest: '' },
      items: [{ name: '', action: 'move|add|remove|update' }],
      cast: [],
    });
    if (!stub) return 'schema stub filing should be rejected';
    const guessed = inferReceiptFromScene(
      'Hawks palmed the sandwich from the vinyl, folded it into his windbreaker pocket. The train swayed.',
    );
    if (guessed.location?.mode !== 'moving' || guessed.location?.dest) {
      return 'scene cues should mark the train as moving without vehicle dest';
    }
    if (!guessed.items?.some(it => /sandwich/i.test(it.name) && /windbreaker/i.test(it.inside || ''))) {
      return 'scene cues should pocket the sandwich';
    }
    const merged = mergeFilingPayload({
      location: { mode: 'unknown', place: '', dest: '' },
      items: [],
      cast: [],
    }, guessed);
    if (merged.location?.mode !== 'moving' || !merged.items?.length) {
      return 'stub unknown should yield to scene cues';
    }
    const landed = inferReceiptFromScene(
      "The train braked and the doors opened on Fukuoka Central's west platform.",
    );
    if (landed.location?.mode !== 'compass' || !/Fukuoka Central/i.test(landed.location?.place || '')) {
      return 'platform arrival should land compass at the station';
    }
    const restated = mergeFilingPayload({
      location: {
        mode: 'moving', from: 'Commission Safehouse', dest: 'flight', reason: 'still aboard',
      },
      items: [{ name: 'halter', action: 'move' }],
      cast: [],
    }, landed);
    if (restated.location?.mode !== 'compass' || !/Fukuoka Central/i.test(restated.location?.place || '')) {
      return 'arrival should beat restated flight dest';
    }
    const toward = inferReceiptFromScene('The train swayed toward Fukuoka Heights.', {
      compass: { rooms: { h: { id: 'h', name: 'Fukuoka Heights' } } },
    });
    if (toward.location?.mode !== 'moving' || !/Heights/i.test(toward.location?.dest || '')) {
      return 'train toward a place should dest that place';
    }
    if (isTransitVehicleKey(toward.location?.dest || '')) return 'dest should not be a vehicle';
    const sticky = mergeFilingPayload({
      location: { mode: 'moving', from: 'Commission Safehouse', dest: 'flight' },
      items: [{ name: 'bag', action: 'move' }],
      cast: [],
    }, toward);
    if (sticky.location?.mode !== 'moving') return 'still riding stays moving';
    if (!/Heights/i.test(sticky.location?.dest || '') || isTransitVehicleKey(sticky.location?.dest || '')) {
      return 'vehicle dest should yield to named dest';
    }
    const mesTextStub = { id: 'mes_text' };
    const underProse = receiptCardInsertSpot(mesTextStub);
    if (underProse.node !== mesTextStub || underProse.where !== 'afterend') {
      return 'insert spot is afterend of mes_text';
    }
    if (findChatMesRoot(-1) != null && typeof findChatMesRoot(-1) !== 'object') {
      return 'findChatMesRoot should return a node or null';
    }
    if (html.includes('<img')) return 'html-unsafe names should stay text';
    const bombed = {
      location: { line: 'Scene/Location | Compass: Okisato', changed: false },
      cast: [{
        name: '<img src=x onerror=alert(1)>',
        wardrobe: [{ name: '<script>x</script>', change: 'on', reason: 'ok' }],
        props: [], conditions: [], stats: [],
      }],
      items: [],
    };
    const bombedHtml = buildReceiptHtml(bombed);
    if (/<img |<script/i.test(bombedHtml.replace(/st-chat[^"]*/g, ''))) {
      /* escHtml should encode tags */
    }
    if (bombedHtml.includes('<img src') || bombedHtml.includes('<script>')) return 'HTML names must be escaped';
    if (!compactReceiptInject(receipt).includes('[Receipt]')) return 'inject wrapper';

    const packWorld = {
      inventory: { mobile: [], static: [] },
      characters: [
        { id: 'star', priority: 'star', name: 'Weslie', wardrobe: [], props: [] },
        { id: 'hawks', priority: 'lead', name: 'Hawks', wardrobe: [{ id: 'pants', name: 'trousers' }], props: [] },
      ],
      compass: { lostAndFound: [], rooms: {} },
    };
    applyItemOps(packWorld, [
      { action: 'add', name: 'messenger bag', owner: 'Weslie', kind: 'container', reason: 'hers' },
      { action: 'add', name: 'shirts', owner: 'Weslie', where: 'room', surface: 'counter', reason: 'spilled from the sack' },
      { action: 'add', name: 'sketchbook', owner: 'Weslie', reason: 'salvaged' },
      { action: 'add', name: 'red feather', owner: 'Weslie', inside: 'sketchbook', reason: 'already inside' },
      { action: 'move', name: 'shirts', inside: 'messenger bag', owner: 'Weslie', reason: 'stuffed clothes first' },
      { action: 'move', name: 'sketchbook', inside: 'messenger bag', owner: 'Weslie', reason: 'then the machine' },
      { action: 'add', name: 'pill bottles', owner: 'Weslie', inside: 'side pocket of the messenger bag', reason: 'side pocket' },
      { action: 'add', name: 'shampoo', owner: 'Weslie', where: 'room', surface: 'bathroom tile', reason: 'too bulky' },
      { action: 'add', name: 'envelope', owner: 'Hawks', inside: 'back pocket', reason: 'folded flat' },
    ]);
    const shirts = findItemByName(packWorld, 'shirts')?.item;
    const bag = findItemByName(packWorld, 'messenger bag')?.item;
    if (!shirts || shirts.parentId !== bag?.id) return 'receipt ops should stuff shirts in the bag';
    const shampoo = findItemByName(packWorld, 'shampoo')?.item;
    if (deriveLocator(shampoo, { list: 'static' }).surface !== 'bathroom tile') {
      return 'receipt ops should leave shampoo on the tile';
    }
    const env = findItemByName(packWorld, 'envelope')?.item;
    const pocket = env ? findWorldItem(packWorld, env.parentId)?.item : null;
    if (!/back pocket/i.test(pocket?.name || '')) return 'receipt ops should pocket the envelope';
    const sketch = findItemByName(packWorld, 'sketchbook')?.item;
    const feather = findItemByName(packWorld, 'red feather')?.item;
    if (!sketch || sketch.parentId !== bag?.id) return 'receipt ops should pack the sketchbook';
    if (!feather || feather.parentId !== sketch.id) return 'receipt ops should keep the feather in the sketchbook';

    const olderWrap = wrapReceiptText('Scene/Location | Compass: Old');
    const newerWrap = wrapReceiptText('Scene/Location | Compass: New');
    const staleChat = [
      {
        is_user: true,
        mes: olderWrap,
        extra: { showtimeReceipt: { at: 1, text: 'Scene/Location | Compass: Old', location: { line: 'Scene/Location | Compass: Old' } } },
      },
      { is_user: true, mes: 'Just talking.' },
      {
        is_user: true,
        mes: `I palmed the sandwich.\n\n${newerWrap}`,
        extra: { showtimeReceipt: { at: 5, text: 'Scene/Location | Compass: New', location: { line: 'Scene/Location | Compass: New' } } },
      },
    ];
    const swept = sweepStaleReceipts(staleChat);
    if (!swept.changed) return 'sweep should strip older receipts';
    if (staleChat.length !== 2) return 'receipt-only older row should be gone';
    if (swept.keptIdx !== 1) return 'newest receipt should stay put';
    if (!staleChat[1].mes.includes('palmed the sandwich')) return 'kept message should keep its prose';
    if (!staleChat[1].mes.includes(RECEIPT_WRAP_OPEN)) return 'kept message should keep its wrap';
    if (staleChat.some((row, i) => i !== swept.keptIdx && String(row.mes || '').includes(RECEIPT_WRAP_OPEN))) {
      return 'only the newest wrap should remain';
    }
    if (staleChat[0].mes !== 'Just talking.') return 'unwrapped message should stay';

    if (readHandoffSentence('I take the knife', 'knife') !== 'take') return 'take the knife';
    if (readHandoffSentence('I take it', 'knife') !== 'take') return 'take it';
    if (readHandoffSentence("I'll take him back", 'knife') !== '') return 'take him must not match';
    if (readHandoffSentence("I don't want it", 'knife') !== 'refuse') return 'refuse it';
    const worn = handoffItemOp({ itemName: 'knife', wearable: true, owner: 'Mirko', outcome: 'take' });
    if (worn?.action !== 'move' || worn.where !== 'worn' || worn.owner !== 'Mirko') return 'take op';
    const used = handoffItemOp({ itemName: 'knife', outcome: 'use' });
    if (used?.action !== 'remove') return 'use op';
    if (handoffItemOp({ itemName: 'knife', outcome: 'refuse' })) return 'refuse has no item row';
    const handoffMerged = mergeHandoffItem(
      [{ name: 'knife', action: 'add', reason: 'model' }, { name: 'coin', action: 'add', reason: 'model' }],
      { name: 'knife', action: 'move', where: 'carried', owner: 'Mirko', reason: 'reply handoff' },
    );
    if (handoffMerged.length !== 2) return 'handoff merge length';
    if (handoffMerged.find(it => it.name === 'knife')?.reason !== 'reply handoff') return 'handoff replaces knife';
    if (!handoffMerged.find(it => it.name === 'coin')) return 'other item stays';

    const schema = filingSchema(['health', 'energy', 'bathroom']);
    const schemaStatsProps = schema?.value?.properties?.cast?.items?.properties?.stats?.properties || {};
    if (!schemaStatsProps.health || !schemaStatsProps.energy || !schemaStatsProps.bathroom) {
      return 'filingSchema should expose explicit numeric tracker properties';
    }
    const snapPeople = [{
      id: 'star',
      priority: 'star',
      name: 'Weslie',
      stats: { enabled: true, hardMode: true, health: 92, energy: 84, hunger: 75, thirst: 70, bathroom: 45, hygiene: 30 },
    }];
    const snapText = peopleSnapshotLines(null, snapPeople);
    if (!/higher=better/i.test(snapText) || !/higher=worse/i.test(snapText) || !/bands:/i.test(snapText)) {
      return 'peopleSnapshotLines should include polarity and threshold bands';
    }
    const filingPrompt = buildFilingPrompt({
      scene: 'Weslie sprinted down the stairs and winced as the cut on her arm bled.',
      travelLine: 'Scene/Location | Compass: Duplex',
      people: snapText,
      trackerIds: ['health', 'energy', 'bathroom'],
      difficulty: 'hard',
    });
    if (!/"events":/.test(filingPrompt) || !/"trackerId":"health"/.test(filingPrompt)) {
      return 'buildFilingPrompt should ask for an events list, not a guessed final number';
    }
    if (!/1-5 for normal activity/i.test(filingPrompt) || !/Difficulty HARD/i.test(filingPrompt)) {
      return 'buildFilingPrompt should include concrete delta-sizing rules and the difficulty hint';
    }
    if (!/actor is the character's name/i.test(filingPrompt)) {
      return 'buildFilingPrompt should explain the shared top-level events list';
    }
    const driftRows = inferSceneStatsDelta(
      'Weslie sprinted up the hill, panting hard and drenched in sweat, then winced as her cut bled.',
      { people: snapPeople },
    );
    const weslieDrift = driftRows.find(r => r.name === 'Weslie');
    if (!weslieDrift || !(weslieDrift.stats.health < 92) || !(weslieDrift.stats.energy < 84) || !(weslieDrift.stats.hygiene > 30)) {
      return 'inferSceneStatsDelta should nudge health, energy, and hygiene from exertion/injury';
    }
    const tense = clampHealthProposal(
      78,
      62,
      'Hawks slid his hands into his jacket pockets and stood in the passage. Tension and standing, slight exertion.',
    );
    if (tense !== 78) return `tension and standing must not drop health (${tense})`;
    const nick = clampHealthProposal(78, 55, 'Hawks cut his thumb on the crate. A bead of blood welled.');
    if (nick < 70 || nick > 77) return `thumb nick must stay inside Hurt (${nick})`;
    const nickDrift = inferSceneStatsDelta(
      'Hawks cut his thumb on the crate. A bead of blood welled.',
      { people: [{ id: 'h', name: 'Hawks', priority: 'lead', stats: { enabled: true, health: 78, energy: 80 } }] },
    );
    const hawksNick = nickDrift.find(r => r.name === 'Hawks');
    if (hawksNick?.stats?.health != null && hawksNick.stats.health < 70) {
      return `inferred thumb nick crossed into Injured (${hawksNick.stats.health})`;
    }
    const talkPeople = [{ id: 'w', name: 'Weslie', priority: 'lead', stats: { enabled: true, energy: 80, health: 100 } }];
    const nudgeGap = inferSceneStatsDelta('Weslie said hello.', { people: talkPeople, elapsedMinutes: 2 });
    const realGap = inferSceneStatsDelta('Weslie said hello.', { people: talkPeople, elapsedMinutes: 45 });
    const nudgeEnergy = nudgeGap.find(r => r.name === 'Weslie')?.stats?.energy;
    const realEnergy = realGap.find(r => r.name === 'Weslie')?.stats?.energy;
    if (nudgeEnergy !== 79) return `a 2 minute stamp should stay on turn drift (${nudgeEnergy})`;
    if (realEnergy !== 78) return `a 45 minute stamp should use the time-passing step (${realEnergy})`;
    const offPeople = [
      { id: 'a', name: 'Aizawa', priority: 'lead', presence: 'absent', stats: { enabled: true, hardMode: true, hunger: 40, thirst: 90, bathroom: 20, hygiene: 10 } },
      { id: 'h', name: 'Hawks', priority: 'lead', presence: 'inPlay', stats: { enabled: true, hardMode: true, hunger: 20, thirst: 20, bathroom: 90, hygiene: 90 } },
      { id: 'm', name: 'Mic', priority: 'lead', presence: 'privy', stats: { enabled: true, hardMode: true, hunger: 70, thirst: 50, bathroom: 80, hygiene: 70 } },
      { id: 'd', name: 'Director', priority: 'director', presence: 'absent', stats: { enabled: true, hardMode: true, hunger: 10 } },
      { id: 'g', name: 'Gone', priority: 'lead', presence: 'writtenOut', stats: { enabled: true, hardMode: true, hunger: 10, bathroom: 99 } },
    ];
    const onCamera = planOffscreenNeeds(offPeople, { sceneText: 'Mic listened on the phone.' });
    if (onCamera.length !== 1 || onCamera[0].name !== 'Aizawa' || onCamera[0].acts.map(a => a.verb).join('|') !== 'ate') {
      return `on-camera privy and in-play cast should not be settled off screen: ${JSON.stringify(onCamera)}`;
    }
    const away = planOffscreenNeeds(offPeople, { sceneText: 'Hawks poured tea.' });
    const mic = away.find(r => r.name === 'Mic');
    const aizawa = away.find(r => r.name === 'Aizawa');
    if (!aizawa || aizawa.acts.map(a => a.id).join('|') !== 'hunger') return 'absent hunger should plan a meal';
    if (!mic || mic.acts.map(a => a.id).join('|') !== 'thirst|bathroom|hygiene') {
      return `privy needs should plan drink, bathroom, and wash: ${mic?.acts?.map(a => a.id).join('|')}`;
    }
    if (away.some(r => r.name === 'Hawks' || r.name === 'Director' || r.name === 'Gone')) {
      return 'in-play, director, and written-out cast should stay out of the off-screen plan';
    }
    const uneasy = inferSceneStatsDelta(
      'Weslie shifted, uncomfortable, and winced as it sat. The silence made both of them uneasy.',
      { people: [{ id: 'star', priority: 'star', name: 'Weslie', stats: { enabled: true, health: 100, energy: 90 } }] },
    );
    const uneasyHealth = uneasy.find(r => r.name === 'Weslie')?.stats?.health;
    if (uneasyHealth == null || uneasyHealth < 95 || uneasyHealth >= 100) {
      return `discomfort should land in Uncomfortable, got ${uneasyHealth}`;
    }
    const social = inferSceneStatsDelta(
      'Trying to hold a conversation would only make both parties uncomfortable. Weslie kept its head down.',
      { people: [{ id: 'star', priority: 'star', name: 'Weslie', stats: { enabled: true, health: 100, energy: 90 } }] },
    );
    const socialHealth = social.find(r => r.name === 'Weslie')?.stats?.health;
    if (socialHealth != null && socialHealth < 100) {
      return `social unease should not move health, got ${socialHealth}`;
    }
    const shared = inferSceneStatsDelta(
      'Weslie was parched and winced. Mrs. Okisato set a mug on the table.',
      {
        people: [
          { id: 'w', name: 'Weslie', priority: 'star', stats: { enabled: true, health: 100, energy: 90 } },
          { id: 'o', name: 'Mrs. Okisato', priority: 'lead', stats: { enabled: true, health: 100, energy: 90 } },
        ],
      },
    );
    const sharedOki = shared.find(r => r.name === 'Mrs. Okisato');
    const sharedWes = shared.find(r => r.name === 'Weslie');
    if (sharedOki?.stats?.health != null && sharedOki.stats.health < 100) {
      return `npc should not inherit the star wince, got ${sharedOki.stats.health}`;
    }
    if (!sharedWes || !(sharedWes.stats.health < 100)) return 'star should still take their own wince';
    const mockBags = {
      cast: {
        characters: [
          { id: 'star_1', priority: 'star', name: 'Weslie', presence: 'inPlay' },
        ],
      },
      backstage: {
        trackers: { status: { difficulty: 'hard' } },
      },
      inventory: { mobile: [], static: [] },
    };
    let savedMock = 0;
    const mockStorage = {
      getChat: (k, def = {}) => mockBags[k] ?? def,
      saveChat: () => { savedMock += 1; },
    };
    applyReceiptPayload(
      mockStorage,
      { location: { mode: 'unknown' }, items: [], cast: [] },
      {
        scene: {},
        status: { difficulty: 'hard' },
        sceneText: 'Weslie sprinted across the station, panting hard, and scraped her knee until it bled.',
      },
    );
    const starRec = mockBags.cast.characters[0];
    if (!starRec.stats?.enabled) return 'applyReceiptPayload should auto-init Star stats';
    if (!(starRec.stats.health < 100) || !(starRec.stats.energy < 100)) {
      return 'applyReceiptPayload should apply baseline scene stat drift when model omits stats';
    }
    if (!savedMock) return 'applyReceiptPayload should persist numeric stat updates';

    // Events-driven path: the model proposes a per-action signed delta instead of a
    // guessed final number; applyReceiptPayload should sum it onto the current value.
    const eventBags = {
      cast: {
        characters: [
          { id: 'star_1', priority: 'star', name: 'Weslie', presence: 'inPlay', stats: { enabled: true, hardMode: true, health: 100, energy: 100, hunger: 100, thirst: 70, bathroom: 0, hygiene: 0 } },
        ],
      },
      backstage: { trackers: { status: { difficulty: 'normal' } } },
      inventory: { mobile: [], static: [] },
    };
    const eventStorage = {
      getChat: (k, def = {}) => eventBags[k] ?? def,
      saveChat: () => {},
    };
    const eventReceipt = applyReceiptPayload(
      eventStorage,
      {
        events: [
          { actor: 'Weslie', kind: 'stat', trackerId: 'Hydration', delta: 15, action: 'drinks water', reason: 'unscrews the bottle and tilts it back' },
          { actor: 'Weslie', kind: 'move', to: 'Exterior', action: 'heads outside' },
        ],
        location: { mode: 'unknown' },
        items: [],
        cast: [],
      },
      { scene: {}, status: { difficulty: 'normal' }, sceneText: '' },
    );
    const weslieRec = eventBags.cast.characters[0];
    if (weslieRec.stats.thirst !== 85) return `events delta should sum onto the current value (got ${weslieRec.stats.thirst})`;
    const weslieEntry = eventReceipt.cast.find(c => c.name === 'Weslie');
    const thirstChange = weslieEntry?.stats?.find(s => s.name === 'Hydration');
    if (!thirstChange || !/drinks water/i.test(thirstChange.reason)) {
      return 'event-driven stat change should carry the action as its reason, not a generic one';
    }
    if (!eventReceipt.events?.some(ev => /drinks water: \+15 Hydration/i.test(ev.line || ''))) {
      return 'receipt should expose a printable per-event line';
    }
    if (!eventReceipt.events?.some(ev => ev.kind === 'move' && /heads outside/.test(ev.line || ''))) {
      return 'non-stat events should still surface as a display-only receipt line';
    }
    const eventHtml = buildReceiptHtml(eventReceipt);
    if (!eventHtml.includes('Beats') || !/drinks water/i.test(eventHtml)) {
      return 'receipt card should print the itemized events under a Beats row';
    }

    return '';
  } catch (err) {
    return String(err?.message || err);
  }
}
