// Chat-facing tracker scan + compact inject helpers.
// Scans recent play messages for location/weather/time cues and keeps
// prompt blocks short so always-on injections stay token-light.

import { getCastMembers, getCastRecords, getStarMember, inPlayCastRecords } from './castCatalog.js';
import { parseWeatherToken, formatTrackerTimeFromHour } from './trackersConfig.js';
import {
  normalizeCalendar, calendarMonthMap, parseTimeKey, formatSceneDate, DEFAULT_DATE_PARTS,
} from './calendarTime.js';
import { standingToward } from './motivationCatalog.js';
import { sceneLabel } from './scriptCatalog.js';

export const CHAT_SCAN_DEPTH = 8;

export function recentPlayMessages(chat, n = CHAT_SCAN_DEPTH) {
  const list = Array.isArray(chat) ? chat : [];
  const depth = Math.max(1, Number(n) || CHAT_SCAN_DEPTH);
  return list.filter(m => m && !m.is_system).slice(-depth);
}

function stripMesHtml(s) {
  return String(s || '')
    .replace(/<!--([\s\S]*?)--!?>/g, ' $1 ')
    .replace(/<[^>]+>/g, ' ');
}

export function parseMsgTimestamp(msg) {
  if (!msg || typeof msg !== 'object') return 0;
  for (const raw of [msg.send_date, msg.create_date, msg.timestamp, msg.time]) {
    if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
      return raw < 1e12 ? raw * 1000 : raw;
    }
    if (typeof raw === 'string' && raw.trim()) {
      const asNum = Number(raw);
      if (Number.isFinite(asNum) && asNum > 0) {
        return asNum < 1e12 ? asNum * 1000 : asNum;
      }
      const direct = Date.parse(raw);
      if (Number.isFinite(direct) && direct > 0) return direct;
      const cleaned = raw.trim()
        .replace(/(\d+)(st|nd|rd|th)\b/gi, '$1')
        .replace(/(\d)(a\.?m\.?|p\.?m\.?)\b/gi, '$1 $2')
        .replace(/@(\d{1,2})h\s*(\d{1,2})m\s*(\d{1,2})s(?:\s*\d*ms)?/i, ' $1:$2:$3');
      const parsed = Date.parse(cleaned);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
  }
  return 0;
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

const CLOCK_RE = /\b(?:at\s+)?([01]?\d|2[0-3])(?::([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)\b|\b([01]?\d|2[0-3]):([0-5]\d)\b/gi;

const WORD_CLOCK_NUMS = Object.freeze({
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
});

const WORD_CLOCK_RE = /\b(?:(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+o['’]?clock(?:\s+(in\s+the\s+(?:morning|afternoon|evening)|at\s+night|a\.?m\.?|p\.?m\.?))?|(?:at|by|around|just\s+past)\s+(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(?=\s*,\s*(?:the|a|an|he|she|it|they|[A-Z][a-z]+)\b))/gi;

const TIME_FRAME_WINDOW = 90;
/** Plans, memories, schedules, and hypotheticals — not the scene clock. */
const TIME_REJECT = /(?:\b(?:gonna|going to|will|let'?s|lets|see you|meet(?:ing)?|should(?:\s+have)?|shall|plan(?:ning)?(?:\s+to)?|after (?:this|that|we)|later(?:\s+this|\s+on)?|when we|once we|remember(?:ing|ed)?|recall(?:ed|ing)?|used to|back in|years? ago|last (?:year|month|week|time|night|morning)|that (?:day|night|morning|afternoon|evening)|the day (?:when|we|I)|once upon|if we|would have|could have|might(?:\s+have)?|mentioned|talk(?:ed|ing)? about|was on|were on|born on|happened on|supposed to|scheduled (?:to|for)|due (?:at|by|on)|from\s+(?:noon|midnight|\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?)\s+to|open(?:s|ed)?\s+(?:at|from)|close(?:s|d)?\s+at|break\s+at|shift\s+(?:starts?|ends?|from)|be\s+(?:there|back|home|ready)\s+by|finish(?:ed)?\s+by|done\s+by|arrive\s+by|leave\s+by)\b|\bhours?\s*:|(?:\buntil|\btill)\s*$)/i;
const TIME_REJECT_RIGHT = /^\s*(?:after (?:this|that)|later|tomorrow|next (?:week|month|year)|ago\b|earlier\b|before\b|prior\b|to\s+(?:noon|midnight|\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?)\b)/i;
const TIME_COMPOUND_NOUN_RIGHT = /^\s+(?:market|shift|rush|lull|coffee|tea|paper|news|train|bus|flight|class|bell|breeze|crowd|traffic|person|people|routine|chores|work|duty|patrol|watch|gala|party|meeting|appointment|break)\b/i;
const TIME_COPULA = /(?:\btoday is\b|\bit is\b|\bit'?s\b|\bit was\b|\bnow\b|\bthis\b|\btoday'?s?\b)\s+(?:\w+\s+){0,3}$|(?:\b(?:estimated\s+date|current\s+date|current\s+time|scene\s+date|scene\s+time|date|time|clock)\s*[:;=]\s*)(?:\w+,?\s+){0,2}$/i;
const TIME_NARRATIVE_LEFT = /(?:^|[,;—–\-]\s*|\b(?:and|then|when|while|as|peaking|tapering)\s+)(?:by|at|around|about|near|nearly|almost|just\s+(?:past|after|before)|shortly\s+(?:after|past|before)|approaching|into)\s+(?:the\s+time\s+|the\s+|late\s+|early\s+|mid[- ]?)?$/i;
const TIME_PROGRESSION_LEFT = /\b(?:clock|watch|phone|screen|timer|bell|chime|gate|sun|light|sky|shadow|rush|shift)\s+(?:read|reads|showed|shows|struck|said|hit|came\s+down\s+at|peaked?\s+(?:at|around)|tapered?\s+(?:into|around)|swelled?\s+with)\s*(?:the\s+|around\s+|at\s+)?$/i;
const TIME_ARRIVAL_RIGHT = /^\s*,?\s*(?:came|arrived|settled|fell|broke|dawned|crept|rolled|drifted|wore on|dragged on)\b/i;
const TIME_HEADER_DOT = /[·•].{0,48}$/;

function clockFromMatch(m) {
  if (!m) return null;
  if (m[3]) {
    let h = Number(m[1]);
    const mer = String(m[3]).replace(/\./g, '').toLowerCase();
    if (mer.startsWith('p') && h < 12) h += 12;
    if (mer.startsWith('a') && h === 12) h = 0;
    return { hour: h, minute: m[2] != null ? Number(m[2]) : 0, clock: true };
  }
  if (m[4] != null) {
    return { hour: Number(m[4]), minute: Number(m[5]) || 0, clock: true };
  }
  return null;
}

function wordClockFromMatch(m, contextText = '') {
  if (!m) return null;
  const word = String(m[1] || m[3] || '').toLowerCase();
  let h = WORD_CLOCK_NUMS[word];
  if (!Number.isFinite(h)) return null;
  const qual = String(m[2] || '').toLowerCase();
  const ctx = String(contextText || '').toLowerCase();
  if (/p\.?m\.?|afternoon|evening|night/.test(qual)) {
    if (h < 12) h += 12;
  } else if (/a\.?m\.?|morning/.test(qual)) {
    if (h === 12) h = 0;
  } else if (/\b(?:afternoon|evening|dusk|sunset|closing|security gate|shift drag)\b/.test(ctx)) {
    if (h >= 1 && h <= 11) h += 12;
  } else if (/\b(?:morning|dawn|daybreak|breakfast)\b/.test(ctx)) {
    if (h === 12) h = 0;
  } else if (h >= 1 && h <= 7) {
    h += 12;
  }
  return { hour: h, minute: 0, clock: true };
}

function sentenceLeft(raw, start, window = TIME_FRAME_WINDOW) {
  const slice = String(raw || '').slice(Math.max(0, start - window), start);
  const cut = Math.max(
    slice.lastIndexOf('.'),
    slice.lastIndexOf('!'),
    slice.lastIndexOf('?'),
    slice.lastIndexOf('\n'),
    slice.lastIndexOf('['),
  );
  return (cut >= 0 ? slice.slice(cut + 1) : slice).replace(/^[\s"'“”‘’*—–\-]+/, '');
}

/**
 * True when this date/clock/period hit frames the scene as set then *now*.
 * Plans, recalls, and hypotheticals keep last-known. Bare mentions default skip.
 */
export function isPresentTimeFrame(text, start = 0, end = -1, { isClock = false } = {}) {
  const raw = String(text || '');
  if (!raw.trim()) return false;
  const at = Math.max(0, Number(start) || 0);
  const stop = Number(end) > at ? Number(end) : at;
  const leftFull = raw.slice(Math.max(0, at - TIME_FRAME_WINDOW), at);
  const left = sentenceLeft(raw, at);
  const right = raw.slice(stop, stop + TIME_FRAME_WINDOW);
  const cue = raw.slice(at, stop);
  if (TIME_REJECT.test(left) || TIME_REJECT.test(left + cue)) return false;
  if (TIME_REJECT_RIGHT.test(right)) return false;
  if (!isClock && TIME_COMPOUND_NOUN_RIGHT.test(right)) return false;
  if (!left.replace(/[\s"'“”‘’]+/g, '')) {
    if (!isClock && TIME_COMPOUND_NOUN_RIGHT.test(right)) return false;
    return true;
  }
  if (TIME_COPULA.test(left)) return true;
  if (TIME_NARRATIVE_LEFT.test(left)) return true;
  if (TIME_PROGRESSION_LEFT.test(left)) return true;
  if (/(?:^|[\s"'“”‘’])(?:the\s+)?(?:next|following)\s+$/i.test(left)) return true;
  if (/^(?:in\s+the\s+|on\s+|this\s+)?(?:the\s+)?(?:early\s+|mid[- ]?|late\s+)?$/i.test(left) && TIME_ARRIVAL_RIGHT.test(right)) return true;
  if (TIME_HEADER_DOT.test(leftFull) || isSceneHeaderFrame(raw, at, stop)) return true;
  return false;
}

/** Clapper-style slate: `Place · Wednesday 10 September, 08:56` or `[Estimated date; ...]`. */
export function isSceneHeaderFrame(text, start = 0, end = -1) {
  const raw = String(text || '');
  if (!raw.trim()) return false;
  const at = Math.max(0, Number(start) || 0);
  const stop = Number(end) > at ? Number(end) : at;
  const leftFull = raw.slice(Math.max(0, at - TIME_FRAME_WINDOW), at);
  if (TIME_REJECT.test(sentenceLeft(raw, at) + raw.slice(at, stop))) return false;
  if (TIME_HEADER_DOT.test(leftFull)) return true;
  if (/(?:^|\[|\b)(?:estimated\s+date|current\s+date|current\s+time|scene\s+date|scene\s+time)\s*[:;=]/i.test(leftFull)) return true;
  return false;
}

/** Last non-schedule clock mention in a line: 9am, 2:47pm, 08:56, four o'clock. */
export function parseClockMention(text) {
  const raw = String(text || '').replace(/\uFF1A/g, ':');
  if (!raw.trim()) return null;
  let best = null;
  const re = new RegExp(CLOCK_RE.source, 'gi');
  let m;
  while ((m = re.exec(raw))) {
    const start = m.index;
    const end = start + m[0].length;
    const left = sentenceLeft(raw, start);
    const right = raw.slice(end, end + TIME_FRAME_WINDOW);
    if (TIME_REJECT.test(left) || TIME_REJECT.test(left + m[0]) || TIME_REJECT_RIGHT.test(right)) continue;
    const clock = clockFromMatch(m);
    if (clock) best = { ...clock, end };
  }
  const wordRe = new RegExp(WORD_CLOCK_RE.source, 'gi');
  while ((m = wordRe.exec(raw))) {
    const start = m.index;
    const end = start + m[0].length;
    const left = sentenceLeft(raw, start);
    const right = raw.slice(end, end + TIME_FRAME_WINDOW);
    if (TIME_REJECT.test(left) || TIME_REJECT.test(left + m[0]) || TIME_REJECT_RIGHT.test(right)) continue;
    const clock = wordClockFromMatch(m, raw.slice(Math.max(0, start - 160), Math.min(raw.length, end + 120)));
    if (clock && (!best || end > best.end)) best = { ...clock, end };
  }
  if (!best) return null;
  const { end: _end, ...out } = best;
  return out;
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

function betterSpan(cand, best) {
  if (!best) return true;
  if (cand.end !== best.end) return cand.end > best.end;
  return cand.start < best.start;
}

export function scanTimeCue(text) {
  const raw = String(text || '').replace(/\uFF1A/g, ':');
  if (!raw.trim()) return null;
  let best = null;
  const clockRe = new RegExp(CLOCK_RE.source, 'gi');
  let m;
  while ((m = clockRe.exec(raw))) {
    const start = m.index;
    const end = start + m[0].length;
    if (!isPresentTimeFrame(raw, start, end, { isClock: true })) continue;
    const clock = clockFromMatch(m);
    if (!clock || !Number.isFinite(clock.hour)) continue;
    const cand = {
      fuzzy: formatTrackerTimeFromHour('fuzzy', clock.hour) || 'Mid Morning',
      hour: clock.hour,
      minute: Number.isFinite(clock.minute) ? clock.minute : 0,
      clock: true,
      explicit: true,
      start,
      end,
    };
    if (betterSpan(cand, best)) best = cand;
  }
  const wordRe = new RegExp(WORD_CLOCK_RE.source, 'gi');
  while ((m = wordRe.exec(raw))) {
    const start = m.index;
    const end = start + m[0].length;
    if (!isPresentTimeFrame(raw, start, end, { isClock: true })) continue;
    const clock = wordClockFromMatch(m, raw.slice(Math.max(0, start - 160), Math.min(raw.length, end + 120)));
    if (!clock || !Number.isFinite(clock.hour)) continue;
    const cand = {
      fuzzy: formatTrackerTimeFromHour('fuzzy', clock.hour) || 'Mid Morning',
      hour: clock.hour,
      minute: Number.isFinite(clock.minute) ? clock.minute : 0,
      clock: true,
      explicit: true,
      start,
      end,
    };
    if (betterSpan(cand, best)) best = cand;
  }
  if (best?.clock) {
    const header = isSceneHeaderFrame(raw, best.start, best.end);
    const { start, end, ...hit } = best;
    return { ...hit, header };
  }
  for (const c of TIME_CUES) {
    const re = new RegExp(c.re.source, 'gi');
    while ((m = re.exec(raw))) {
      const start = m.index;
      const end = start + m[0].length;
      if (!isPresentTimeFrame(raw, start, end)) continue;
      const left = sentenceLeft(raw, start);
      const explicit = TIME_COPULA.test(left) || TIME_NARRATIVE_LEFT.test(left) || TIME_PROGRESSION_LEFT.test(left);
      const cand = { fuzzy: c.fuzzy, hour: c.hour, minute: 0, clock: false, explicit, start, end };
      if (betterSpan(cand, best)) best = cand;
    }
  }
  if (!best) return null;
  const header = isSceneHeaderFrame(raw, best.start, best.end);
  const { start, end, ...hit } = best;
  return { ...hit, header };
}

const ELAPSED_WORD_NUMS = Object.freeze({
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  fifteen: 15, twenty: 20, thirty: 30, forty: 40, 'forty-five': 45, fifty: 50,
});

const ELAPSED_TIME_PATTERNS = Object.freeze([
  {
    re: /\b(half\s+an\s+hour|an?\s+hour\s+and\s+a\s+half)\s+(?:later|pass(?:ed|es)?|went\s+by|elaps(?:ed|es)?|tick(?:ed|s)?\s+by|drag(?:ged|s)?(?:\s+by|\s+on)?)\b/gi,
    parse: (m) => (/and\s+a\s+half/i.test(m[1]) ? 90 : 30),
  },
  {
    re: /\b(?:the\s+)?remaining\s+(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d{1,2})\s+hours?(?:\s+of\s+the\s+\w+)?\s+(?:drag(?:ged|s)?(?:\s+by|\s+on)?|pass(?:ed|es)?|went\s+by|slip(?:ped|s)?\s+by)\b/gi,
    parse: (m) => {
      const k = String(m[1] || '').toLowerCase();
      const n = ELAPSED_WORD_NUMS[k] ?? Number(k);
      return Number.isFinite(n) && n > 0 ? Math.round(n * 60) : 0;
    },
  },
  {
    re: /\b(an?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d{1,2})\s+hours?(?:\s+and\s+a\s+half)?\s+(?:later|pass(?:ed|es)?|went\s+by|drag(?:ged|s)?(?:\s+by|\s+on)?|elaps(?:ed|es)?|tick(?:ed|s)?\s+by)\b/gi,
    parse: (m) => {
      const k = String(m[1] || '').toLowerCase();
      const n = ELAPSED_WORD_NUMS[k] ?? Number(k);
      if (!Number.isFinite(n) || n <= 0) return 0;
      return Math.round(n * 60) + (/and\s+a\s+half/i.test(m[0]) ? 30 : 0);
    },
  },
  {
    re: /\b(ten|fifteen|twenty|thirty|forty(?:-five)?|fifty|\d{1,3})\s+minutes?\s+(?:later|pass(?:ed|es)?|went\s+by|elaps(?:ed|es)?|tick(?:ed|s)?\s+by|drag(?:ged|s)?(?:\s+by|\s+on)?)\b/gi,
    parse: (m) => {
      const k = String(m[1] || '').toLowerCase();
      const n = ELAPSED_WORD_NUMS[k] ?? Number(k);
      return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
    },
  },
]);

/** A beat under this does not count as "time passing" for needs filing. */
export const TURN_GAP_MINUTES = 20;
/** Used when a character turn names no gap and the prose names no clock. */
export const TURN_ELAPSED_DEFAULT = 2;

/**
 * `[TIME|+8m]`, `[TIME|+2h]`, `[TIME|+1h30m]`. The last tag in the line wins.
 * @returns {{ minutes: number, raw: string } | null}
 */
export function parseTurnElapsed(text) {
  const raw = String(text || '');
  if (!raw.includes('[')) return null;
  const re = /\[\s*TIME\s*\|\s*([^\]]+)\]/gi;
  let best = null;
  let m;
  while ((m = re.exec(raw))) {
    const minutes = minutesFromTimeInner(m[1]);
    if (minutes > 0) best = { minutes, raw: m[0] };
  }
  return best;
}

function minutesFromTimeInner(inner) {
  const s = String(inner || '').trim().replace(/^\+/, '');
  const hm = s.match(/^(\d{1,3})\s*h(?:ours?|r)?(?:\s*(\d{1,4})\s*m(?:in(?:ute)?s?)?)?$/i);
  if (hm) {
    return clampTurnMinutes((Number(hm[1]) || 0) * 60 + (Number(hm[2]) || 0));
  }
  const onlyM = s.match(/^(\d{1,4})\s*m(?:in(?:ute)?s?)?$/i);
  if (onlyM) return clampTurnMinutes(Number(onlyM[1]) || 0);
  return 0;
}

function clampTurnMinutes(n) {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(7 * 24 * 60, Math.round(n));
}

/** Sum of `[TIME|+…]` tags already captured on these messages. */
export function turnGapMinutes(messages) {
  let n = 0;
  for (const m of messages || []) {
    const e = m?.extra?.showtimeElapsed;
    if (e?.source !== 'tag') continue;
    n += Number(e.minutes) || 0;
  }
  return n;
}

/**
 * Push the scene clock forward. No-ops when this sig was already applied,
 * or when the board has no hour yet (a nudge must not invent noon).
 */
export function advanceSceneByMinutes(scene, minutes, { hoursPerDay = 24, sig = '' } = {}) {
  const mins = Math.round(Number(minutes) || 0);
  const empty = { changed: false, time: null };
  if (!scene || scene.time === false || mins <= 0) return empty;
  if (sig && scene.lastTurnElapsedSig === sig) return empty;
  if (!Number.isFinite(Number(scene.lastTimeHour))) return empty;
  const hpd = Math.max(1, Number(hoursPerDay) || 24);
  const baseHour = Number(scene.lastTimeHour);
  const baseMin = Number.isFinite(Number(scene.lastTimeMinute)) ? Number(scene.lastTimeMinute) : 0;
  const dayMins = hpd * 60;
  const total = baseHour * 60 + baseMin + mins;
  const wrapped = ((total % dayMins) + dayMins) % dayMins;
  const hour = Math.floor(wrapped / 60);
  const minute = wrapped % 60;
  const deltaDays = Math.floor(total / dayMins);
  const fuzzy = formatTrackerTimeFromHour('fuzzy', hour, hpd, minute) || scene.lastTimeLabel;
  const label = scene.timeMode === 'fuzzy'
    ? fuzzy
    : (formatTrackerTimeFromHour(scene.timeMode, hour, hpd, minute) || fuzzy);
  scene.lastTimeHour = hour;
  scene.lastTimeMinute = minute;
  if (label) scene.lastTimeLabel = label;
  if (sig) scene.lastTurnElapsedSig = sig;
  return {
    changed: true,
    time: {
      hour,
      minute,
      fuzzy,
      deltaDays,
      elapsed: true,
      elapsedMinutes: mins,
      sig,
    },
  };
}

export function scanElapsedTimeCue(text) {
  const raw = String(text || '');
  if (!raw.trim()) return null;
  let best = null;
  for (const pat of ELAPSED_TIME_PATTERNS) {
    const re = new RegExp(pat.re.source, 'gi');
    let m;
    while ((m = re.exec(raw))) {
      const start = m.index;
      const end = start + m[0].length;
      const left = sentenceLeft(raw, start);
      const right = raw.slice(end, end + TIME_FRAME_WINDOW);
      if (TIME_REJECT.test(left) || TIME_REJECT_RIGHT.test(right)) continue;
      if (/\b(?:had|hadn't|had\s+not|would\s+have|could\s+have)\b/i.test(left)) continue;
      const mins = pat.parse(m);
      if (!mins || mins <= 0) continue;
      const cand = {
        elapsedMinutes: mins,
        hours: Math.floor(mins / 60),
        minutes: mins % 60,
        raw: m[0],
        sig: `elapsed:${mins}:${m[0].toLowerCase().trim()}`,
        elapsed: true,
        start,
        end,
      };
      if (betterSpan(cand, best)) best = cand;
    }
  }
  if (!best) return null;
  const { start, end, ...hit } = best;
  return hit;
}

/** Only the newest play message can move the clock. */
export function scanTimeCueFromChat(chat, n = CHAT_SCAN_DEPTH) {
  const msgs = recentPlayMessages(chat, n);
  if (!msgs.length) return null;
  return scanTimeCue(stripMesHtml(msgs[msgs.length - 1]?.mes));
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

function packAbsoluteDate(m, cal) {
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

function absoluteDateRe(calendar) {
  const cal = normalizeCalendar(calendar || {});
  const monthMap = calendarMonthMap(cal);
  const months = Object.keys(monthMap)
    .filter(n => n.length >= 3)
    .sort((a, b) => b.length - a.length)
    .map(reEscapeDate);
  if (!months.length) return { cal, re: null };
  const monthAlt = months.join('|');
  const re = new RegExp(
    `\\b(?:(?:${WEEKDAYS_RE}),?\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthAlt})(?:\\s*,?\\s*(\\d{3,6}))?\\b`
    + `|\\b(${monthAlt})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:\\s*,?\\s*(\\d{3,6}))?\\b`,
    'gi',
  );
  return { cal, re };
}

/** Posted calendar date in a line: "Wednesday 10 September", "10 September", "September 10". */
export function scanAbsoluteDateCue(text, calendar = null) {
  const raw = String(text || '');
  if (!raw.trim()) return null;
  const { cal, re } = absoluteDateRe(calendar);
  if (!re) return null;
  let best = null;
  let m;
  while ((m = re.exec(raw))) {
    const start = m.index;
    const end = start + m[0].length;
    if (!isPresentTimeFrame(raw, start, end)) continue;
    const hit = packAbsoluteDate(m, cal);
    if (!hit) continue;
    const cand = { ...hit, start, end, header: isSceneHeaderFrame(raw, start, end) };
    if (betterSpan(cand, best)) best = cand;
  }
  if (!best) return null;
  const { start, end, ...hit } = best;
  return hit;
}

function scanRelativeDateCue(raw) {
  let best = null;
  for (const c of DATE_CUES) {
    const re = new RegExp(c.re.source, 'gi');
    let m;
    while ((m = re.exec(raw))) {
      const start = m.index;
      const end = start + m[0].length;
      if (!isPresentTimeFrame(raw, start, end)) continue;
      const cand = {
        kind: 'relative',
        deltaDays: c.deltaDays,
        hour: c.hour,
        fuzzy: c.fuzzy || '',
        start,
        end,
        header: isSceneHeaderFrame(raw, start, end),
      };
      if (betterSpan(cand, best)) best = cand;
    }
  }
  if (!best) return null;
  const { start, end, ...hit } = best;
  return hit;
}

export function scanDateCue(text, calendar = null) {
  const raw = String(text || '');
  if (!raw.trim()) return null;
  const abs = scanAbsoluteDateCue(raw, calendar);
  if (abs) return abs;
  return scanRelativeDateCue(raw);
}

/** Only the newest play message can move the date. */
export function scanDateCueFromChat(chat, n = CHAT_SCAN_DEPTH, calendar = null) {
  const msgs = recentPlayMessages(chat, n);
  if (!msgs.length) return null;
  const mes = stripMesHtml(msgs[msgs.length - 1]?.mes);
  const hit = scanDateCue(mes, calendar);
  if (!hit) return null;
  const sig = hit.sig || `${hit.kind}:${hit.deltaDays}:${String(mes || '').slice(0, 160)}`;
  return { ...hit, sig };
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
 * Header lines (`Place · date, clock`) write the board. Other present-framed
 * cues return `pending` so the clapper can Accept / Ignore.
 */
export function applySceneCuesFromChat(scene, chat, { calendar = null, afterTs = 0, force = false } = {}) {
  const empty = { changed: false, time: null, date: null, pending: null };
  if (!scene || typeof scene !== 'object') return empty;
  const text = haystackText(chat, CHAT_SCAN_DEPTH);
  if (!text.trim()) return empty;
  let changed = false;
  let time = null;
  let date = null;
  const pendingBits = { time: null, date: null };

  if (scene.weather !== false) {
    const wx = scanWeatherCue(text);
    if (wx && (wx.label !== scene.weatherLabel || wx.emoji !== scene.weatherEmoji)) {
      scene.weatherEmoji = wx.emoji;
      scene.weatherLabel = wx.label;
      changed = true;
    }
  }

  const msgs = recentPlayMessages(chat, CHAT_SCAN_DEPTH);
  const newestMsg = msgs[msgs.length - 1];
  const newestAt = parseMsgTimestamp(newestMsg);
  const held = !!scene.boardHeld;
  const stale = Number(afterTs) > 0 && newestAt > 0 && newestAt <= Number(afterTs);
  const autoHeader = (hit) => {
    if (!hit?.header) return false;
    if (force) return true;
    if (stale) return false;
    if (held && newestAt <= 0) return !(Number(afterTs) > 0);
    return true;
  };
  const autoTime = (hit) => {
    if (!hit) return false;
    if (force) return true;
    if (stale) return false;
    if (hit.header || hit.clock || hit.elapsed || hit.explicit) {
      if (held && newestAt <= 0 && Number(afterTs) > 0) return false;
      return true;
    }
    return false;
  };
  const writeTime = (t) => {
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
    const min = (t.clock || t.elapsed) ? (Number(t.minute) || 0) : 0;
    if (scene.lastTimeMinute !== min) {
      scene.lastTimeMinute = min;
      changed = true;
    }
    if (t.sig) scene.lastTimeCueSig = t.sig;
  };
  const writeDate = (d) => {
    date = d;
    scene.lastDateCueSig = d.sig;
    if (d.kind === 'absolute' && d.label) scene.lastDateLabel = d.label;
    changed = true;
  };

  if (scene.time !== false) {
    const t = scanTimeCueFromChat(chat);
    const newestText = stripMesHtml(newestMsg?.mes);
    const elapsed = (!t || !t.clock) ? scanElapsedTimeCue(newestText) : null;
    if (t && Number.isFinite(Number(t.hour))) {
      const same = scene.lastTimeHour === t.hour
        && (!t.clock || scene.lastTimeMinute === (Number(t.minute) || 0));
      if (autoTime(t)) {
        writeTime(t);
      } else if (!t.header && !same) {
        pendingBits.time = t;
      }
    } else if (elapsed && elapsed.elapsedMinutes > 0 && (!stale || force)) {
      const sig = `${elapsed.sig}:${msgs.length}`;
      if (scene.lastTimeCueSig !== sig) {
        const baseHour = Number.isFinite(Number(scene.lastTimeHour)) ? Number(scene.lastTimeHour) : 12;
        const baseMin = Number.isFinite(Number(scene.lastTimeMinute)) ? Number(scene.lastTimeMinute) : 0;
        const totalMin = baseHour * 60 + baseMin + elapsed.elapsedMinutes;
        const newHour = ((Math.floor(totalMin / 60) % 24) + 24) % 24;
        const newMin = ((totalMin % 60) + 60) % 60;
        const fuzzy = formatTrackerTimeFromHour('fuzzy', newHour, 24, newMin) || 'Mid Afternoon';
        writeTime({
          fuzzy,
          hour: newHour,
          minute: newMin,
          clock: true,
          elapsed: true,
          elapsedMinutes: elapsed.elapsedMinutes,
          deltaDays: Math.floor(totalMin / (24 * 60)),
          sig,
          header: false,
        });
      }
    } else {
      const noted = newestMsg?.extra?.showtimeElapsed;
      const notedMin = Number(noted?.minutes) || 0;
      if (noted && noted.source !== 'prose' && notedMin > 0) {
        const turnSig = String(newestMsg.extra?.showtimeElapsedSig || '')
          || `turn:${String(newestMsg.send_date || msgs.length)}:${noted.source}:${notedMin}`;
        const pushed = advanceSceneByMinutes(scene, notedMin, { sig: turnSig });
        if (pushed.changed) {
          time = pushed.time;
          changed = true;
        }
        if (pushed.changed || scene.lastTurnElapsedSig === turnSig) {
          newestMsg.extra.showtimeElapsedApplied = notedMin;
          newestMsg.extra.showtimeElapsedSig = turnSig;
        }
      }
    }
  }

  if (scene.date !== false) {
    const d = scanDateCueFromChat(chat, CHAT_SCAN_DEPTH, calendar);
    if (d?.sig && d.sig !== scene.lastDateCueSig) {
      if (force || autoHeader(d)) {
        if (!stale || force) writeDate(d);
      } else if (!d.header) {
        pendingBits.date = d;
      }
    }
  }

  let pending = null;
  if (pendingBits.time || pendingBits.date) {
    pending = {
      time: pendingBits.time,
      date: pendingBits.date,
      header: false,
    };
  }
  return { changed, time, date, pending };
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

const PROP_CUE_RE = /\b(carrying|carried|inventory|holding|holds|held|picks up|picked up|drops|dropped|grabbed|backpack|satchel|lantern|flashlight|knife|sword|weapon|keys|phone|in (?:his|her|their|the) pockets?|from (?:a |his |her |their )?pockets?|stuff(?:s|ed)?|spill(?:s|ed)?|rattl(?:e|ed|es)|folded?\s+into|pack(?:s|ed|ing)?|unpack)\b/i;

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

function escapeNameRe(s) {
  return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** True when `name` appears as its own phrase, not as a substring of another word. */
export function namePhraseInHay(hay, name) {
  const needle = String(name || '').trim().toLowerCase();
  if (needle.length < 2) return false;
  const hayLow = String(hay || '').toLowerCase();
  if (!hayLow) return false;
  try {
    return new RegExp(`(?<![\\p{L}\\p{N}])${escapeNameRe(needle)}(?![\\p{L}\\p{N}])`, 'u').test(hayLow);
  } catch {
    return false;
  }
}

/** Cast mentioned in the last `n` play messages (plus Star when present). */
export function mentionedCast(storage, chat, n = 10) {
  const hay = haystackLower(chat, n);
  if (!hay.trim()) return [];
  return getCastMembers(storage).filter(m => {
    const names = [m.name, ...(m.aliases || [])];
    return names.some(name => namePhraseInHay(hay, name));
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

/** First line of [Now]: occupancy, then clock / weather. Empty when scene is off. */
export function formatNowSceneLine(scene, locationLine = '') {
  if (!scene || scene.enabled === false) return '';
  const loc = String(locationLine || scene.lastLocationKey || '').trim();
  const bits = [];
  if (loc) bits.push(loc);
  if (scene.time !== false && scene.lastTimeLabel) bits.push(scene.lastTimeLabel);
  if (scene.date !== false && scene.lastDateLabel) bits.push(scene.lastDateLabel);
  if (scene.weather !== false) {
    const wx = `${scene.weatherEmoji || ''} ${scene.weatherLabel || ''}`.trim();
    if (wx) bits.push(wx);
  }
  return bits.join(' · ');
}

function splitCueSentences(text) {
  return String(text || '')
    .split(/\n+|(?<=[.!?…])\s+/)
    .map(s => s.trim())
    .filter(Boolean);
}

function nameIndexInSentence(sentence, name) {
  const low = String(sentence || '').toLowerCase();
  const needle = String(name || '').trim().toLowerCase();
  if (needle.length < 2 || !low) return -1;
  let i = 0;
  while ((i = low.indexOf(needle, i)) >= 0) {
    const before = i === 0 || !/[\p{L}\p{N}]/u.test(low[i - 1]);
    const after = i + needle.length >= low.length || !/[\p{L}\p{N}]/u.test(low[i + needle.length]);
    if (before && after) return i;
    i += needle.length;
  }
  return -1;
}

function namedCastInSentence(sentence, members) {
  const hits = [];
  for (const m of members || []) {
    const names = [m?.name, ...(m?.aliases || [])];
    let at = -1;
    for (const n of names) {
      const idx = nameIndexInSentence(sentence, n);
      if (idx >= 0 && (at < 0 || idx < at)) at = idx;
    }
    if (at >= 0) hits.push({ m, at });
  }
  hits.sort((a, b) => a.at - b.at);
  return hits;
}

const BODY_ATTR_RE = /\b(parched|thirsty|dehydrat|tired|exhaust|fatigu|worn out|hunger|starv|ravenous|famish|bleed|blood|wound|injur|bruis|hurt|pain|winc|flinch|grimac|sore|ach(?:e|ed|ing)|throb|limp|sprain|ate\b|eaten|eating|drank|drink|sip(?:ped)?|slept|asleep|rested|shower|unwashed|reek)/i;

function firstBodyCueIndex(sentence) {
  let at = -1;
  const consider = (re) => {
    const probe = new RegExp(re.source, re.flags.replace('g', ''));
    const m = probe.exec(sentence);
    if (m && (at < 0 || m.index < at)) at = m.index;
  };
  for (const c of STATUS_CUES) consider(c.re);
  for (const c of CARE_CUES) consider(c.re);
  consider(BODY_ATTR_RE);
  return at;
}

function sameCast(a, b) {
  if (!a || !b) return false;
  if (a.id && b.id && String(a.id) === String(b.id)) return true;
  return String(a.name || '').trim().toLowerCase() === String(b.name || '').trim().toLowerCase();
}

/**
 * Sentences whose body cue belongs to `char`.
 * The closest named cast member before a thirst, pain, or rest word owns it.
 * A sentence with no body word belongs to its subject. Unnamed sentences stay
 * with the last subject, and only the Star takes a sentence before anyone is named.
 */
export function bodyTextForCharacter(char, text, cast = []) {
  if (!char) return '';
  const members = (Array.isArray(cast) && cast.length ? cast : [char]).filter(m => m && m.name);
  const keep = [];
  let lastNamed = null;
  for (const sentence of splitCueSentences(text)) {
    const named = namedCastInSentence(sentence, members);
    const cueAt = firstBodyCueIndex(sentence);
    let owner = null;
    if (cueAt >= 0) {
      const before = named.filter(n => n.at <= cueAt);
      owner = (before.length ? before[before.length - 1] : named[0])?.m || lastNamed;
    } else if (named[0]) {
      owner = named[0].m;
    } else {
      owner = lastNamed;
    }
    if (named[0]) lastNamed = named[0].m;
    if (owner && sameCast(owner, char)) keep.push(sentence);
    else if (!owner && (char.priority === 'star' || char.is_user)) keep.push(sentence);
  }
  return keep.join('\n');
}

export function compactStatusCueInject(storage, chat, n = 8) {
  const text = haystackText(chat, n);
  if (!text.trim()) return '';
  let members = [];
  try { members = getCastRecords(storage); } catch { members = []; }
  members = (members || []).filter(m => m && m.name && m.priority !== 'director');
  if (!members.some(m => m.stats?.enabled)) return '';
  const byKey = new Map();
  let lastNamed = null;
  for (const sentence of splitCueSentences(text)) {
    const named = namedCastInSentence(sentence, members);
    if (named[0]) lastNamed = named[0].m;
    const cues = [...scanStatusCues(sentence), ...scanCareCues(sentence)];
    if (!cues.length) continue;
    const cueAt = firstBodyCueIndex(sentence);
    const before = cueAt >= 0 ? named.filter(n => n.at <= cueAt) : named;
    const owner = (before.length ? before[before.length - 1] : named[0])?.m || lastNamed;
    if (!owner?.stats?.enabled) continue;
    const key = String(owner.id || owner.name);
    const bag = byKey.get(key) || { name: String(owner.name).trim(), notes: [] };
    for (const note of cues) {
      if (bag.notes.length >= 3 || bag.notes.includes(note)) continue;
      bag.notes.push(note);
    }
    byKey.set(key, bag);
    if (byKey.size >= 4) break;
  }
  const hits = [...byKey.values()].filter(b => b.notes.length);
  if (!hits.length) return '';
  return `[Status cues (only the named character):\n${hits.map(b => `- ${b.name}: ${b.notes.join(', ')}`).join('\n')}]`;
}

function readingTowardStar(storage, castId) {
  try {
    const rep = storage.getChat('reputation', { personal: [] });
    const nodes = Array.isArray(rep.personal) ? rep.personal : [];
    const star = nodes.find(n => n.kind === 'self') || null;
    const node = nodes.find(n => n.characterId === castId);
    if (!node) return null;
    const tid = star?.id || 'self';
    return (node.readings || []).find(r => r.targetId === tid || r.targetId === 'self') || null;
  } catch {
    return null;
  }
}

function compactReadingBits(rec, storage) {
  if (!rec) return [];
  const intro = rec.intro || 'none';
  const history = String(rec.history || (intro === 'pre' ? rec.description : '') || '').trim();
  const baseline = String(rec.baseline || (intro !== 'pre' ? rec.description : '') || '').trim();
  const bits = [];
  if (baseline) bits.push(clipText(baseline, 48));
  else if (history) bits.push(`met: ${clipText(history, 36)}`);
  const stamp = rec.noScript ? '' : String(rec.stampUid || '').trim();
  if (rec.noScript) bits.push('no script');
  else if (stamp) {
    try {
      const lab = sceneLabel(storage, stamp);
      if (lab) bits.push(lab);
    } catch { /* ignore */ }
  }
  return bits;
}

/** Compact standings for cast marked In play. */
export function compactConnectionsInject(storage) {
  const pool = inPlayCastRecords(storage);
  const lines = [];
  for (const m of pool) {
    if (m.priority === 'star' || m.is_user) continue;
    const v = standingToward(storage, `cast:${m.id}`);
    if (v == null) continue;
    const bits = compactReadingBits(readingTowardStar(storage, m.id), storage);
    lines.push(bits.length ? `${m.name}→Star ${v} · ${bits.join(' · ')}` : `${m.name}→Star ${v}`);
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

  if (scanDateCue("Let's meet on 3 October.")) return 'plan date should not stamp';
  if (scanDateCue('See you tomorrow.')) return 'see-you-tomorrow should not stamp';
  if (scanDateCue('Remember 15 March 2019?')) return 'recall date should not stamp';
  if (scanDateCue('Back in June we used to walk the canal.')) return 'back-in should not stamp';
  const beat = scanDateCue('The next morning, she opened the blinds.');
  if (!beat || beat.kind !== 'relative' || beat.deltaDays !== 1) return 'next-morning beat should shift a day';
  if (beat.header) return 'next-morning beat is not a header';
  const beatScene = {
    enabled: true, time: true, date: true, weather: false, timeMode: 'fuzzy',
    lastTimeLabel: 'Mid Night', lastTimeHour: 22, lastDateLabel: '10 September',
    lastDateCueSig: 'absolute:10:8:',
  };
  const beatHit = applySceneCuesFromChat(beatScene, [{
    is_system: false,
    mes: 'The next morning, she opened the blinds.',
  }]);
  if (beatScene.lastDateLabel !== '10 September') return 'next-morning must not stamp until Accept';
  if (beatScene.lastDateCueSig !== 'absolute:10:8:') return 'next-morning must not drop the absolute stamp';
  if (!beatHit.pending?.date || beatHit.pending.date.deltaDays !== 1) return 'next-morning should return pending';
  if (beatHit.date) return 'next-morning should not return an applied date';
  if (!isSceneHeaderFrame('Canal City Mall · Wednesday 10 September, 08:56', 'Canal City Mall · Wednesday 10 September, 08:56'.indexOf('Wednesday'))) {
    return 'header frame should detect a · slate line';
  }
  if (scanTimeCue('She said good night and mentioned the morning market.')) {
    return 'non-setting night/morning should not move hour';
  }
  const nowLine = formatNowSceneLine({
    enabled: true, time: true, date: false, weather: true,
    lastTimeLabel: 'afternoon', lastDateLabel: '', weatherEmoji: '', weatherLabel: 'overcast',
  }, 'apartment');
  if (nowLine !== 'apartment · afternoon · overcast') return 'now scene line should lead with occupancy';
  if (formatNowSceneLine({ enabled: false }, 'apartment') !== '') return 'now scene line should skip when scene is off';

  const stay = {
    enabled: true, time: true, date: true, weather: false, timeMode: 'fuzzy',
    lastTimeLabel: 'Mid Morning', lastTimeHour: 9, lastTimeMinute: 0,
    lastDateLabel: '10 September', lastDateCueSig: 'absolute:10:8:',
  };
  const planHit = applySceneCuesFromChat(stay, [{
    is_system: false,
    mes: "Let's meet on 3 October. See you tomorrow.",
  }]);
  if (stay.lastDateLabel !== '10 September') return 'plan must keep last-known date';
  if (stay.lastTimeHour !== 9) return 'plan must keep last-known hour';
  if (planHit.date || planHit.time) return 'plan should not return a date/time hit';

  const stay2 = {
    enabled: true, time: true, date: true, weather: false, timeMode: 'fuzzy',
    lastTimeLabel: 'Mid Night', lastTimeHour: 22, lastTimeMinute: 0,
    lastDateLabel: '9 March', lastDateCueSig: '',
  };
  applySceneCuesFromChat(stay2, [
    { is_system: false, mes: 'Canal City Mall · Wednesday 10 September, 08:56 · Cold air from the vents' },
    { is_system: false, mes: 'She nodded and kept walking.' },
  ]);
  if (/september/i.test(stay2.lastDateLabel || '')) return 'older header should not stamp when newest has no cue';
  if (stay2.lastTimeHour !== 22) return 'older clock should not stamp when newest has no cue';

  const md = scanAbsoluteDateCue('September 10 dawned cold.');
  if (!md || md.parts?.day !== 10 || md.parts?.monthIndex !== 8) return 'September 10 should parse as 10 / September';
  if (md.parts?.year != null) return 'September 10 must not invent a year';
  const may = scanAbsoluteDateCue('It is May 5 already.');
  if (!may || may.parts?.day !== 5 || may.parts?.monthIndex !== 4) return 'It is May 5 should parse as 5 / May';
  if (may.parts?.year != null) return 'May 5 must not invent a year';

  const hold = {
    enabled: true, time: true, date: true, weather: false, timeMode: 'fuzzy',
    lastTimeLabel: 'Mid Night', lastTimeHour: 22, lastTimeMinute: 0,
    lastDateLabel: '9 March', lastDateCueSig: 'absolute:9:2:',
  };
  applySceneCuesFromChat(hold, [{
    is_system: false,
    send_date: 1_700_000_000_000,
    mes: 'Canal City Mall · Wednesday 10 September, 08:56 · Cold air from the vents',
  }], { afterTs: 1_700_000_000_500 });
  if (/september/i.test(hold.lastDateLabel || '')) return 'afterTs should keep a manual date stamp';
  if (hold.lastTimeHour !== 22) return 'afterTs should keep a manual hour stamp';

  if (namePhraseInHay('the camera clicked', 'mera')) return 'alias must not match inside another word';
  if (!namePhraseInHay('mera nodded', 'mera')) return 'alias should match as its own phrase';
  if (!namePhraseInHay('Yokumiru Mera turned.', 'Yokumiru Mera')) return 'full name should match as a phrase';
  if (namePhraseInHay('Yokumiru turned.', 'Yokumiru Mera')) return 'partial first name must not match the full name';
  const cueStorage = {
    getChat(key, def = {}) {
      if (key !== 'cast') return def;
      return {
        characters: [
          { id: 'w', name: 'Weslie', priority: 'star', presence: 'inPlay', stats: { enabled: true } },
          { id: 'o', name: 'Mrs. Okisato', priority: 'lead', presence: 'inPlay' },
        ],
      };
    },
  };
  const inherited = compactStatusCueInject(cueStorage, [{
    mes: 'Weslie was parched and could barely stand. Mrs. Okisato set the mug down.',
  }]);
  if (/Okisato/.test(inherited)) return `untracked npc inherited status cues: ${inherited}`;
  if (!/Weslie: thirsty/.test(inherited)) return `star thirst cue missing: ${inherited}`;
  const watched = compactStatusCueInject(cueStorage, [{
    mes: 'Mrs. Okisato watched Weslie, who was parched.',
  }]);
  if (/Okisato/.test(watched) || !/Weslie: thirsty/.test(watched)) {
    return `cue should stay on the body that is parched: ${watched}`;
  }

  // Saving Asset 515-O: "By 2:47pm Weslie had polished..." + "supposed to take a 30 minute break at 3"
  const msg21 = 'By 2:47pm Weslie had polished and sorted all three boxes of silverware, swept the display room floor and hardly stopped or lifted its head from any task. It\'s supposed to take a 30 minute break at 3. The ram has since moved on to the displays.';
  const cue21 = scanTimeCue(msg21);
  if (!cue21?.clock || cue21.hour !== 14 || cue21.minute !== 47) {
    return `By 2:47pm should parse as 14:47 clock cue: ${JSON.stringify(cue21)}`;
  }
  const scene21 = {
    enabled: true, time: true, date: true, weather: false, timeMode: '12h',
    lastTimeLabel: '12:00 PM', lastTimeHour: 12, lastTimeMinute: 0,
    lastDateLabel: '17 September', lastDateCueSig: 'absolute:17:8:',
    boardHeld: true,
  };
  applySceneCuesFromChat(scene21, [{
    is_system: false,
    send_date: '2026-10-17T15:00:00.000Z',
    mes: msg21,
  }], { afterTs: Date.parse('2026-10-17T14:00:00.000Z') });
  if (scene21.lastTimeHour !== 14 || scene21.lastTimeMinute !== 47) {
    return `By 2:47pm should auto-apply even when boardHeld is true: ${scene21.lastTimeHour}:${scene21.lastTimeMinute}`;
  }

  // Word clocks and elapsed jumps ("peaking around four o'clock", "At six, the front security gate comes down")
  const msg19 = 'The remaining four hours of the shift drag. Out on the promenade, the mall\'s ambient roar swells with the afternoon rush, peaking around four o\'clock before slowly tapering into the evening lull. At six, the front security gate comes down.';
  const cue19 = scanTimeCue(msg19);
  if (!cue19?.clock || cue19.hour !== 18) {
    return `At six should parse as 18:00 clock cue: ${JSON.stringify(cue19)}`;
  }
  const elapsedScene = {
    enabled: true, time: true, date: false, weather: false, timeMode: 'fuzzy',
    lastTimeLabel: 'Early Afternoon', lastTimeHour: 12, lastTimeMinute: 0,
  };
  applySceneCuesFromChat(elapsedScene, [{
    is_system: false,
    mes: 'Two hours later, the corridor was quiet.',
  }]);
  if (elapsedScene.lastTimeHour !== 14) {
    return `Two hours later should advance hour from 12 to 14: ${elapsedScene.lastTimeHour}`;
  }

  // HTML comment date header: <!-- [Estimated date; Tuesday, September 17th] --!>
  const commentScene = {
    enabled: true, time: true, date: true, weather: false, timeMode: 'fuzzy',
    lastTimeLabel: 'Mid Morning', lastTimeHour: 9, lastTimeMinute: 0,
    lastDateLabel: '', lastDateCueSig: '',
  };
  applySceneCuesFromChat(commentScene, [{
    is_system: false,
    mes: '<!-- [Estimated date; Tuesday, September 17th] --!>\nHours: From Noon to 6pm.',
  }]);
  if (!/17/.test(commentScene.lastDateLabel) || !/september/i.test(commentScene.lastDateLabel)) {
    return `HTML comment estimated date should stamp lastDateLabel: ${commentScene.lastDateLabel}`;
  }
  if (commentScene.lastTimeHour !== 9) {
    return `Hours: From Noon to 6pm schedule should not advance clock: ${commentScene.lastTimeHour}`;
  }

  const tag8 = parseTurnElapsed('She nodded.\n[TIME|+8m]');
  if (tag8?.minutes !== 8) return `TIME +8m should be 8 minutes: ${tag8?.minutes}`;
  const tagH = parseTurnElapsed('[TIME|+2h]');
  if (tagH?.minutes !== 120) return `TIME +2h should be 120 minutes: ${tagH?.minutes}`;
  const tagHm = parseTurnElapsed('[TIME|+1h30m]');
  if (tagHm?.minutes !== 90) return `TIME +1h30m should be 90 minutes: ${tagHm?.minutes}`;
  if (parseTurnElapsed('no stamp here')) return 'prose without a TIME tag should not parse';
  const nudged = {
    enabled: true, time: true, timeMode: 'simple',
    lastTimeLabel: '2:10 PM', lastTimeHour: 14, lastTimeMinute: 10,
  };
  const nudge = advanceSceneByMinutes(nudged, 2, { sig: 'turn:a:default:2' });
  if (!nudge.changed || nudged.lastTimeHour !== 14 || nudged.lastTimeMinute !== 12) {
    return `a 2 minute nudge should land at 14:12: ${nudged.lastTimeHour}:${nudged.lastTimeMinute}`;
  }
  const again = advanceSceneByMinutes(nudged, 2, { sig: 'turn:a:default:2' });
  if (again.changed || nudged.lastTimeMinute !== 12) return 'the same turn sig must not nudge twice';
  const blank = { time: true, lastTimeHour: null, lastTimeMinute: 0 };
  if (advanceSceneByMinutes(blank, 8, { sig: 'turn:b' }).changed) {
    return 'a nudge must not invent a clock when none is set';
  }
  if (turnGapMinutes([{ extra: { showtimeElapsed: { source: 'tag', minutes: 45 } } }, { extra: { showtimeElapsed: { source: 'default', minutes: 2 } } }]) !== 45) {
    return 'only TIME tags count toward a needs gap';
  }

  return '';
}
