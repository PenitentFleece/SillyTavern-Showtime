// Chat-facing tracker scan + compact inject helpers.
// Scans recent play messages for location/weather/time cues and keeps
// prompt blocks short so always-on injections stay token-light.

import { getCastMembers, getStarMember } from './castCatalog.js';
import { parseWeatherToken, formatTrackerTimeFromHour } from './trackersConfig.js';
import {
  normalizeCalendar, calendarMonthMap, parseTimeKey, formatSceneDate, DEFAULT_DATE_PARTS,
} from './calendarTime.js';
import { standingToward } from './motivationCatalog.js';

export const CHAT_SCAN_DEPTH = 8;

export function recentPlayMessages(chat, n = CHAT_SCAN_DEPTH) {
  const list = Array.isArray(chat) ? chat : [];
  const depth = Math.max(1, Number(n) || CHAT_SCAN_DEPTH);
  return list.filter(m => m && !m.is_system).slice(-depth);
}

function stripMesHtml(s) {
  return String(s || '').replace(/<[^>]+>/g, ' ');
}

export function haystackText(chat, n = CHAT_SCAN_DEPTH) {
  return recentPlayMessages(chat, n).map(m => stripMesHtml(m?.mes)).join('\n');
}

export function haystackLower(chat, n = CHAT_SCAN_DEPTH) {
  return haystackText(chat, n).toLowerCase();
}

export function clipText(s, max = 240) {
  const flat = String(s || '').replace(/\s+/g, ' ').trim();
  if (!flat) return '';
  if (flat.length <= max) return flat;
  return `${flat.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

const TIME_CUES = Object.freeze([
  { re: /\b(late[\s-]night|after midnight|past midnight)\b/i, fuzzy: 'Late Night', hour: 1 },
  { re: /\bmidnight\b/i, fuzzy: 'Late Night', hour: 0 },
  { re: /\b(dawn|first light|daybreak)\b/i, fuzzy: 'Early Morning', hour: 6 },
  { re: /\bearly morning\b/i, fuzzy: 'Early Morning', hour: 7 },
  { re: /\bmorning\b/i, fuzzy: 'Mid Morning', hour: 9 },
  { re: /\b(noon|midday)\b/i, fuzzy: 'Early Afternoon', hour: 12 },
  { re: /\bafternoon\b/i, fuzzy: 'Mid Afternoon', hour: 15 },
  { re: /\b(dusk|sunset|twilight)\b/i, fuzzy: 'Early Evening', hour: 18 },
  { re: /\bevening\b/i, fuzzy: 'Mid Evening', hour: 19 },
  { re: /\b(nightfall)\b/i, fuzzy: 'Early Night', hour: 21 },
  { re: /\bnight\b/i, fuzzy: 'Mid Night', hour: 22 },
]);

/** Last clock mention in a line: 9am, 9:00 PM, 21:00, 9 a.m. */
export function parseClockMention(text) {
  const raw = String(text || '').replace(/\uFF1A/g, ':');
  if (!raw.trim()) return null;
  const re = /\b(?:at\s+)?([01]?\d|2[0-3])(?::([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)\b|\b([01]?\d|2[0-3]):([0-5]\d)\b/gi;
  let last = null;
  let m;
  while ((m = re.exec(raw))) {
    if (m[3]) {
      let h = Number(m[1]);
      const mer = String(m[3]).replace(/\./g, '').toLowerCase();
      if (mer.startsWith('p') && h < 12) h += 12;
      if (mer.startsWith('a') && h === 12) h = 0;
      last = { hour: h, minute: m[2] != null ? Number(m[2]) : 0, clock: true };
    } else if (m[4] != null) {
      last = { hour: Number(m[4]), minute: Number(m[5]) || 0, clock: true };
    }
  }
  return last;
}

const WEATHER_CUES = Object.freeze([
  { re: /\b(blizzard|whiteout)\b/i, token: '❄ Snow' },
  { re: /\b(snowing|snowfall|snow)\b/i, token: '❄ Snow' },
  { re: /\bhail\b/i, token: '🌨 Flurry' },
  { re: /\b(thunder(?:storm)?|lightning)\b/i, token: '⛈ Storm' },
  { re: /\bstormy|\bstorm\b/i, token: '⚡ Storm' },
  { re: /\b(pouring|downpour|rainstorm|raining|rain)\b/i, token: '🌧 Rain' },
  { re: /\b(drizzle|showers)\b/i, token: '🌦 Showers' },
  { re: /\b(foggy|fog|mist)\b/i, token: '🌫 Fog' },
  { re: /\b(windy|\bgale\b|\bgusts?\b)\b/i, token: '🌬 Windy' },
  { re: /\b(overcast|grey sky|gray sky)\b/i, token: '☁ Overcast' },
  { re: /\b(scorching|sweltering|heatwave)\b/i, token: '☀️ Hot' },
  { re: /\b(clear skies|cloudless|sunny|sunshine)\b/i, token: '🌤 Fair' },
  { re: /\b(hazy|\bhaze\b)\b/i, token: '⛅ Hazy' },
  { re: /\bcrisp air\b/i, token: '🍂 Crisp' },
]);

export function scanTimeCue(text) {
  const raw = String(text || '');
  const clock = parseClockMention(raw);
  if (clock && Number.isFinite(clock.hour)) {
    return {
      fuzzy: formatTrackerTimeFromHour('fuzzy', clock.hour) || 'Mid Morning',
      hour: clock.hour,
      minute: Number.isFinite(clock.minute) ? clock.minute : 0,
      clock: true,
    };
  }
  for (const c of TIME_CUES) {
    if (c.re.test(raw)) return { fuzzy: c.fuzzy, hour: c.hour, minute: 0, clock: false };
  }
  return null;
}

/** Newest play message wins so an older “night” cannot beat a later “9am”. */
export function scanTimeCueFromChat(chat, n = CHAT_SCAN_DEPTH) {
  const msgs = recentPlayMessages(chat, n);
  for (let i = msgs.length - 1; i >= 0; i--) {
    const hit = scanTimeCue(stripMesHtml(msgs[i]?.mes));
    if (hit) return hit;
  }
  return null;
}

const DATE_CUES = Object.freeze([
  { re: /\b((?:the\s+)?next morning|(?:the\s+)?following morning)\b/i, deltaDays: 1, hour: 8, fuzzy: 'Early Morning' },
  { re: /\b((?:the\s+)?next day|(?:the\s+)?following day|tomorrow)\b/i, deltaDays: 1 },
  { re: /\b(yesterday|(?:the\s+)?previous day|(?:the\s+)?night before)\b/i, deltaDays: -1 },
  { re: /\b((?:the\s+)?next week|a week later)\b/i, deltaDays: 7 },
]);

const WEEKDAYS_RE = 'monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun';

function reEscapeDate(s) {
  return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Posted calendar date in a line: "Wednesday 10 September", "10 September", "September 10". */
export function scanAbsoluteDateCue(text, calendar = null) {
  const raw = String(text || '');
  if (!raw.trim()) return null;
  const cal = normalizeCalendar(calendar || {});
  const monthMap = calendarMonthMap(cal);
  const months = Object.keys(monthMap)
    .filter(n => n.length >= 3)
    .sort((a, b) => b.length - a.length)
    .map(reEscapeDate);
  if (!months.length) return null;
  const monthAlt = months.join('|');
  const re = new RegExp(
    `\\b(?:(?:${WEEKDAYS_RE}),?\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthAlt})(?:\\s*,?\\s*(\\d{3,6}))?\\b`
    + `|\\b(${monthAlt})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:\\s*,?\\s*(\\d{3,6}))?\\b`,
    'i',
  );
  const m = raw.match(re);
  if (!m) return null;
  const snippet = String(m[0] || '').replace(new RegExp(`^(?:${WEEKDAYS_RE}),?\\s+`, 'i'), '').trim();
  const parsed = parseTimeKey(snippet, cal, { fillMissing: false });
  const parts = parsed?.parts;
  const label = (parts && parts.day != null && parts.monthIndex != null)
    ? (formatSceneDate(parts, cal, { ...DEFAULT_DATE_PARTS, year: parts.year != null }) || snippet)
    : snippet;
  if (!label) return null;
  if (!parts || parts.day == null || parts.monthIndex == null) {
    return { kind: 'absolute', parts: null, label, sig: `absolute-raw:${snippet.toLowerCase()}` };
  }
  return {
    kind: 'absolute',
    parts,
    label,
    sig: `absolute:${parts.day}:${parts.monthIndex}:${parts.year ?? ''}`,
  };
}

export function scanDateCue(text, calendar = null) {
  const raw = String(text || '');
  if (!raw.trim()) return null;
  const abs = scanAbsoluteDateCue(raw, calendar);
  if (abs) return abs;
  for (const c of DATE_CUES) {
    if (c.re.test(raw)) {
      return {
        kind: 'relative',
        deltaDays: c.deltaDays,
        hour: c.hour,
        fuzzy: c.fuzzy || '',
      };
    }
  }
  return null;
}

/** Newest play message wins; relative day-shifts must not re-fire on the same line. */
export function scanDateCueFromChat(chat, n = CHAT_SCAN_DEPTH, calendar = null) {
  const msgs = recentPlayMessages(chat, n);
  for (let i = msgs.length - 1; i >= 0; i--) {
    const mes = stripMesHtml(msgs[i]?.mes);
    const hit = scanDateCue(mes, calendar);
    if (hit) {
      const sig = hit.sig || `${hit.kind}:${hit.deltaDays}:${String(mes || '').slice(0, 160)}`;
      return { ...hit, sig };
    }
  }
  return null;
}

export function scanWeatherCue(text) {
  const raw = String(text || '');
  for (const c of WEATHER_CUES) {
    if (c.re.test(raw)) return parseWeatherToken(c.token);
  }
  return null;
}

/**
 * Soft-update scene tracker labels from recent chat.
 * Posted clocks and calendar dates win over a stale Script present.
 */
export function applySceneCuesFromChat(scene, chat, { calendar = null } = {}) {
  if (!scene || typeof scene !== 'object') return { changed: false, time: null, date: null };
  const text = haystackText(chat, CHAT_SCAN_DEPTH);
  if (!text.trim()) return { changed: false, time: null, date: null };
  let changed = false;
  let time = null;
  let date = null;

  if (scene.weather !== false) {
    const wx = scanWeatherCue(text);
    if (wx && (wx.label !== scene.weatherLabel || wx.emoji !== scene.weatherEmoji)) {
      scene.weatherEmoji = wx.emoji;
      scene.weatherLabel = wx.label;
      changed = true;
    }
  }

  if (scene.time !== false) {
    const t = scanTimeCueFromChat(chat);
    if (t && Number.isFinite(Number(t.hour))) {
      time = t;
      const label = scene.timeMode === 'fuzzy'
        ? t.fuzzy
        : (formatTrackerTimeFromHour(scene.timeMode, t.hour, 24, t.minute) || t.fuzzy);
      if (label && label !== scene.lastTimeLabel) {
        scene.lastTimeLabel = label;
        changed = true;
      }
      if (scene.lastTimeHour !== t.hour) {
        scene.lastTimeHour = t.hour;
        changed = true;
      }
      const min = t.clock ? (Number(t.minute) || 0) : 0;
      if (scene.lastTimeMinute !== min) {
        scene.lastTimeMinute = min;
        changed = true;
      }
    }
  }

  if (scene.date !== false) {
    const d = scanDateCueFromChat(chat, CHAT_SCAN_DEPTH, calendar);
    if (d?.sig && d.sig !== scene.lastDateCueSig) {
      date = d;
      scene.lastDateCueSig = d.sig;
      if (d.kind === 'absolute' && d.label) scene.lastDateLabel = d.label;
      changed = true;
    }
  }

  return { changed, time, date };
}

export function textMatchesHay(text, hayLower) {
  const t = String(text || '').toLowerCase().trim();
  const hay = String(hayLower || '');
  if (!t || !hay) return false;
  if (t.length >= 3 && hay.includes(t)) return true;
  const tokens = t.split(/[^\p{L}\p{N}]+/u).filter(w => w.length >= 4);
  return tokens.some(w => hay.includes(w));
}

const STATUS_CUES = Object.freeze([
  { re: /\b(bleeding|bloodied|wounded|injured|hurt badly)\b/i, note: 'injured' },
  { re: /\b(exhausted|spent|worn out|fatigued)\b/i, note: 'exhausted' },
  { re: /\b(starving|famished|ravenous)\b/i, note: 'hungry' },
  { re: /\b(parched|dying of thirst)\b/i, note: 'thirsty' },
  { re: /\b(filthy|unwashed|reeking)\b/i, note: 'unhygienic' },
  { re: /\b(passed out|unconscious|collapsed)\b/i, note: 'unconscious' },
  { re: /\b(ill|feverish|nauseous|sick)\b/i, note: 'unwell' },
]);

/** Care beats (eat/drink/wash/rest/relieve) — not distress. Kit excerpts keep these lines. */
const CARE_CUES = Object.freeze([
  { re: /\b(eat(?:s|ing|en)?|ate|snack(?:s|ed|ing)?|chew(?:s|ed|ing)?|devour(?:s|ed|ing)?|wolfed)\b/i, note: 'eat' },
  { re: /\b(drink(?:s|ing)?|drank|drunk|sip(?:s|ped|ping)?|gulp(?:s|ed|ing)?|quaff(?:s|ed)?)\b/i, note: 'drink' },
  { re: /\b(wash(?:es|ed|ing)?|shower(?:s|ed|ing)?|bath(?:e|es|ed|ing)?|bathe[ds]?|rinse(?:s|d)?)\b/i, note: 'wash' },
  { re: /\b(rest(?:s|ed|ing)?|sleep(?:s|ing)?|slept|nap(?:s|ped|ping)?|doze(?:s|d|ing)?|lie down|lay down|laid down)\b/i, note: 'rest' },
  { re: /\b(relieve(?:s|d)?|bathroom|toilet|pee(?:d|ing)?|piss(?:ed|ing)?|urinate[ds]?)\b/i, note: 'relieve' },
]);

function cueNotes(list, text) {
  const raw = String(text || '');
  const notes = [];
  for (const c of list) {
    if (c.re.test(raw)) notes.push(c.note);
  }
  return [...new Set(notes)];
}

export function scanStatusCues(text) {
  return cueNotes(STATUS_CUES, text);
}

export function scanCareCues(text) {
  return cueNotes(CARE_CUES, text);
}

const CLOTHING_CUE_RE = /\b(wearing|wore|wear|dressed|dressing|undressed|disrobe|stripped|outfit|costume|clothes|clothing|wardrobe|coat|jacket|windbreaker|parka|anorak|hoodie|sweater|shirt|blouse|dress|skirt|pants|trousers|jeans|shorts|overalls|boots|shoes|sneakers|socks|hat|cap|gloves|scarf|cloak|armor|helmet|bra|underwear|took off|taking off|put on|putting on|threw on|shrugged on|slipped on|pulled off|buttoned|unzipped|laced|lacing)\b/i;

const PROP_CUE_RE = /\b(carrying|carried|inventory|holding|holds|held|picks up|picked up|drops|dropped|grabbed|backpack|satchel|lantern|flashlight|knife|sword|weapon|keys|phone|in (?:his|her|their|the) pockets?|from (?:a |his |her |their )?pockets?)\b/i;

/** Longest-first so "work shirt" wins over "shirt". */
const GARMENT_NOUNS = Object.freeze([
  'windbreaker', 'work shirt', 't-shirt', 'tshirt', 'undershirt',
  'trench coat', 'trenchcoat', 'overcoat', 'raincoat',
  'overalls', 'coveralls', 'dungarees', 'button-down', 'buttondown',
  'hoodie', 'sweater', 'jumper', 'cardigan', 'blouse',
  'parka', 'anorak', 'jacket', 'coat',
  'trousers', 'slacks', 'jeans', 'shorts', 'skirt',
  'waistcoat', 'vest', 'shirt',
  'sneakers', 'trainers', 'loafers', 'boots', 'shoes',
  'stockings', 'socks', 'gloves', 'scarf', 'cloak', 'cape',
  'beanie', 'helmet', 'armor', 'armour',
  'underwear', 'briefs', 'boxers', 'bra',
  'pants', 'dress', 'hat', 'cap', 'belt',
]);

const GARMENT_MOD_STOP = new Set([
  'the', 'a', 'an', 'his', 'her', 'their', 'its', 'my', 'your',
  'this', 'that', 'with', 'and', 'then', 'into', 'onto', 'over',
  'from', 'for', 'at', 'to', 'on', 'in', 'of',
]);

export function scanClothingCues(text) {
  return CLOTHING_CUE_RE.test(String(text || ''));
}

export function scanPropCues(text) {
  return PROP_CUE_RE.test(String(text || ''));
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Short garment phrases from prose ("canvas work shirt", "windbreaker").
 * Used to ground wardrobe audits so dressing montages actually get filed.
 */
export function listGarmentMentions(text) {
  const raw = String(text || '');
  if (!raw.trim()) return [];
  const hits = [];
  for (const noun of GARMENT_NOUNS) {
    const re = new RegExp(`\\b${escapeRe(noun)}s?\\b`, 'gi');
    let m;
    while ((m = re.exec(raw))) {
      const from = m.index;
      const to = from + m[0].length;
      if (hits.some(h => !(to <= h.from || from >= h.to))) continue;
      const before = raw.slice(Math.max(0, from - 56), from);
      const tail = (before.match(/([A-Za-z][A-Za-z'-]*\s+){0,3}$/) || [''])[0];
      const mods = tail.trim().split(/\s+/).filter(w => w && !GARMENT_MOD_STOP.has(w.toLowerCase()));
      hits.push({ from, to, phrase: [...mods, m[0]].join(' ').replace(/\s+/g, ' ').trim() });
    }
  }
  hits.sort((a, b) => a.from - b.from);
  const out = [];
  const seen = new Set();
  for (const h of hits) {
    const key = h.phrase.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(h.phrase);
  }
  return out.slice(0, 12);
}

/** Character ranges for clothes, carried objects, and status beats — used so excerpts keep those sentences. */
export function listKitCueSpans(text) {
  const raw = String(text || '');
  if (!raw.trim()) return [];
  const spans = [];
  const eat = (re) => {
    const flags = re.flags.includes('g') ? re.flags : `${re.flags}g`;
    const r = new RegExp(re.source, flags);
    let m;
    while ((m = r.exec(raw))) {
      if (!m[0]) break;
      spans.push({ from: m.index, to: m.index + m[0].length });
    }
  };
  eat(CLOTHING_CUE_RE);
  eat(PROP_CUE_RE);
  for (const c of STATUS_CUES) eat(c.re);
  for (const c of CARE_CUES) eat(c.re);
  for (const noun of GARMENT_NOUNS) eat(new RegExp(`\\b${escapeRe(noun)}s?\\b`, 'gi'));
  spans.sort((a, b) => a.from - b.from || b.to - a.to);
  const merged = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && s.from <= last.to + 1) last.to = Math.max(last.to, s.to);
    else merged.push({ from: s.from, to: s.to });
  }
  return merged;
}

export function lineHasKitCue(line) {
  return scanClothingCues(line)
    || scanPropCues(line)
    || scanStatusCues(line).length > 0
    || scanCareCues(line).length > 0;
}

/** Play messages after `sinceCount` (count of prior non-system messages). */
export function playMessagesSince(chat, sinceCount) {
  const play = Array.isArray(chat) ? chat.filter(m => m && !m.is_system) : [];
  const start = Math.max(0, Number(sinceCount) || 0);
  return play.slice(start);
}

/** Cast mentioned in the last `n` play messages (plus Star when present). */
export function mentionedCast(storage, chat, n = 10) {
  const hay = haystackLower(chat, n);
  if (!hay.trim()) return [];
  return getCastMembers(storage).filter(m => {
    const names = [m.name, ...(m.aliases || [])].map(x => String(x || '').trim().toLowerCase());
    return names.some(name => name.length >= 2 && hay.includes(name));
  });
}

export function inPlayMemberIds(storage, chat, n = 10, { includeStar = true } = {}) {
  const ids = new Set(mentionedCast(storage, chat, n).map(m => m.id));
  if (includeStar) {
    const star = getStarMember(storage);
    if (star?.id) ids.add(star.id);
  }
  return ids;
}

export function compactSceneInject(scene, { location = '' } = {}) {
  if (!scene || scene.enabled === false) return '';
  const bits = [];
  if (scene.time !== false && scene.lastTimeLabel) bits.push(scene.lastTimeLabel);
  if (scene.date !== false && scene.lastDateLabel) bits.push(scene.lastDateLabel);
  if (scene.weather !== false) {
    const wx = `${scene.weatherEmoji || ''} ${scene.weatherLabel || ''}`.trim();
    if (wx) bits.push(wx);
  }
  const loc = String(location || scene.lastLocationKey || '').trim();
  if (loc) bits.push(loc);
  if (!bits.length) return '';
  return `[Scene: ${bits.join(' · ')}]`;
}

export function compactStatusCueInject(storage, chat, n = 8) {
  const text = haystackText(chat, n);
  const cues = [...scanStatusCues(text), ...scanCareCues(text)];
  if (!cues.length) return '';
  const hay = text.toLowerCase();
  const hits = [];
  for (const m of mentionedCast(storage, chat, n)) {
    const name = String(m.name || '').trim();
    if (name.length < 2) continue;
    if (!hay.includes(name.toLowerCase())) continue;
    hits.push(`${name}: ${cues.slice(0, 3).join(', ')}`);
    if (hits.length >= 4) break;
  }
  if (!hits.length) return `[Status cues: ${cues.slice(0, 3).join(', ')}]`;
  return `[Status cues: ${hits.join('; ')}]`;
}

/** Compact standings for names actually in recent chat (plus Star). */
export function compactConnectionsInject(storage, chat, { window = 10, offScreen = false } = {}) {
  const n = Math.max(1, Number(window) || 10);
  const mentioned = mentionedCast(storage, chat, n);
  const star = getStarMember(storage);
  const want = new Set(mentioned.map(m => m.id));
  if (star?.id) want.add(star.id);
  const pool = offScreen ? getCastMembers(storage) : getCastMembers(storage).filter(m => want.has(m.id));
  const lines = [];
  for (const m of pool) {
    if (m.priority === 'star' || m.is_user) continue;
    const v = standingToward(storage, `cast:${m.id}`);
    if (v == null) continue;
    lines.push(`${m.name}→Star ${v}`);
    if (lines.length >= 8) break;
  }
  if (!lines.length) return '';
  return `[Connections in play: ${lines.join('; ')}]`;
}

/** Lightweight cue checks (no DOM). Returns '' on success. */
export function smokeChatTrackCuePure() {
  const clock = parseClockMention('Wednesday 10 September, 08:56 · Cold air from the vents');
  if (!clock || clock.hour !== 8 || clock.minute !== 56) return '08:56 clock should parse hour and minute';
  const t = scanTimeCue('Canal City Mall · Wednesday 10 September, 08:56 · Cold air');
  if (!t?.clock || t.hour !== 8) return 'posted clock should win on the same line';
  const d = scanAbsoluteDateCue('Canal City Mall, second floor · Wednesday 10 September, 08:56 · Cold air');
  if (!d || d.parts?.day !== 10 || d.parts?.monthIndex !== 8) return 'Wednesday 10 September should parse as 10 / September';
  if (!/10/.test(d.label) || !/september/i.test(d.label)) return 'absolute date label should keep day and month';
  const scene = {
    enabled: true, time: true, date: true, weather: true, timeMode: 'fuzzy',
    lastTimeLabel: 'Mid Night', lastTimeHour: 22, lastDateLabel: '9 March', lastDateCueSig: '',
    weatherLabel: 'Fair', weatherEmoji: '🌤',
  };
  applySceneCuesFromChat(scene, [{
    is_system: false,
    mes: 'Canal City Mall · Wednesday 10 September, 08:56 · Cold air from the vents',
  }]);
  if (scene.lastTimeHour !== 8) return 'chat clock should stamp lastTimeHour';
  if (!/september/i.test(scene.lastDateLabel || '')) return 'chat date should stamp lastDateLabel';
  return '';
}
