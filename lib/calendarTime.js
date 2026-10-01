// Shared world-calendar time: normalize, parse, format, sort, ranges, present.

const MONTH_NAME = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
  may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8,
  oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};

export const EARTH_MONTH_LABELS = Object.freeze([
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]);

const SEASON_MONTH = { spring: 2, summer: 5, autumn: 8, fall: 8, winter: 11 };

export const TL_ZOOM = Object.freeze([
  { id: 'decades', label: 'Decades', steps: 6, span: 1.0 },
  { id: 'years', label: 'Years', steps: 8, span: 1.15 },
  { id: 'seasons', label: 'Seasons', steps: 16, span: 1.7 },
  { id: 'months', label: 'Months', steps: 24, span: 2.5 },
  { id: 'weeks', label: 'Weeks', steps: 48, span: 3.8 },
  { id: 'days', label: 'Days', steps: 96, span: 5.6 },
  { id: 'hours', label: 'Hours', steps: 192, span: 8.4 },
]);

export const CAL_LABEL_DEFAULTS = Object.freeze({
  day: 'Day',
  week: 'Week',
  month: 'Month',
  season: 'Season',
  year: 'Year',
  decade: 'Decade',
  hour: 'Hour',
});

export const DEFAULT_DATE_PARTS = Object.freeze({
  day: true,
  month: true,
  year: true,
  season: false,
  seasonFuzzy: false,
});

export const TIME_PICKER_SCALES = Object.freeze([
  { id: 'year', labelKey: 'year' },
  { id: 'season', labelKey: 'season' },
  { id: 'month', labelKey: 'month' },
  { id: 'week', labelKey: 'week' },
  { id: 'day', labelKey: 'day' },
  { id: 'hour', labelKey: 'hour' },
  { id: 'free', labelKey: null },
]);

const DAYS_PER_MONTH = 30;
/** Offset so Earth-ms sorts never collide with calendar-native hour counts. */
export const EARTH_EPOCH = 1e15;

export function earthDateSort(ms) {
  return Number(ms) + EARTH_EPOCH;
}

function reEscape(s) {
  return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function clampTlZoom(n) {
  const z = Number(n);
  if (!Number.isFinite(z)) return 3;
  return Math.min(TL_ZOOM.length - 1, Math.max(0, Math.round(z)));
}

function defaultMonthNames(monthsPerYear) {
  if (monthsPerYear === 12) return EARTH_MONTH_LABELS.slice();
  return Array.from({ length: monthsPerYear }, (_, i) => `Month ${i + 1}`);
}

export function normalizeCalendar(raw = {}) {
  const fallback = {
    monthsPerYear: 12,
    hoursPerDay: 24,
    seasons: [
      { id: 'spring', label: 'Spring', startMonth: 3, endMonth: 5 },
      { id: 'summer', label: 'Summer', startMonth: 6, endMonth: 8 },
      { id: 'autumn', label: 'Autumn', startMonth: 9, endMonth: 11 },
      { id: 'winter', label: 'Winter', startMonth: 12, endMonth: 2 },
    ],
    monthNames: EARTH_MONTH_LABELS.slice(),
    labels: { ...CAL_LABEL_DEFAULTS },
    yearPrefix: '',
    yearSuffix: '',
  };
  const monthsPerYear = Math.max(2, Math.min(24, Number(raw.monthsPerYear) || fallback.monthsPerYear));
  const hoursPerDay = Math.max(1, Math.min(48, Number(raw.hoursPerDay) || fallback.hoursPerDay));
  const seasons = Array.isArray(raw.seasons) && raw.seasons.length
    ? raw.seasons.map((s, i) => ({
      id: String(s.id || `s${i}`),
      label: String(s.label || `Season ${i + 1}`).trim() || `Season ${i + 1}`,
      startMonth: Math.max(1, Math.min(monthsPerYear, Number(s.startMonth) || 1)),
      endMonth: Math.max(1, Math.min(monthsPerYear, Number(s.endMonth) || 1)),
    }))
    : structuredClone(fallback.seasons).map(s => ({
      ...s,
      startMonth: Math.min(s.startMonth, monthsPerYear),
      endMonth: Math.min(s.endMonth, monthsPerYear) || 1,
    }));

  let monthNames;
  if (Array.isArray(raw.monthNames) && raw.monthNames.some(n => String(n || '').trim())) {
    monthNames = raw.monthNames.map((n, i) => String(n || '').trim() || `Month ${i + 1}`);
  } else {
    monthNames = defaultMonthNames(monthsPerYear);
  }
  while (monthNames.length < monthsPerYear) monthNames.push(`Month ${monthNames.length + 1}`);
  monthNames = monthNames.slice(0, monthsPerYear);

  const srcLabels = raw.labels && typeof raw.labels === 'object' ? raw.labels : {};
  const labels = { ...CAL_LABEL_DEFAULTS };
  for (const key of Object.keys(CAL_LABEL_DEFAULTS)) {
    const v = String(srcLabels[key] ?? raw[`${key}Label`] ?? '').trim();
    if (v) labels[key] = v;
  }

  return {
    monthsPerYear,
    hoursPerDay,
    seasons,
    monthNames,
    labels,
    yearPrefix: String(raw.yearPrefix ?? '').trim(),
    yearSuffix: String(raw.yearSuffix ?? '').trim(),
  };
}

export function normalizeDateParts(raw) {
  const d = { ...DEFAULT_DATE_PARTS };
  if (!raw || typeof raw !== 'object') return d;
  for (const k of Object.keys(DEFAULT_DATE_PARTS)) {
    if (typeof raw[k] === 'boolean') d[k] = raw[k];
  }
  return d;
}

/** Map of lowercase month token → 0-based index for this calendar. */
export function calendarMonthMap(cal) {
  const map = {};
  for (const [k, v] of Object.entries(MONTH_NAME)) {
    if (v < cal.monthsPerYear) map[k] = v;
  }
  (cal.monthNames || []).forEach((name, i) => {
    const full = String(name || '').trim().toLowerCase();
    if (!full) return;
    map[full] = i;
    const short = full.slice(0, 3);
    if (short.length >= 3) map[short] = i;
  });
  return map;
}

export function formatCalendarYear(n, cal) {
  const num = Number(n);
  if (!Number.isFinite(num)) return '';
  const pre = cal.yearPrefix || '';
  const suf = cal.yearSuffix ? ` ${cal.yearSuffix}` : '';
  if (pre) return `${pre}${num}${suf}`.trim();
  return `${cal.labels.year} ${num}${suf}`.trim();
}

function hourUnit(cal) {
  return Math.max(1, Number(cal.hoursPerDay) || 24);
}

function dayUnit(cal) {
  return hourUnit(cal);
}

function monthUnit(cal) {
  return DAYS_PER_MONTH * dayUnit(cal);
}

function yearUnit(cal) {
  return Math.max(1, Number(cal.monthsPerYear) || 12) * monthUnit(cal);
}

/**
 * Comparable sort value from calendar parts (calendar-native, not Earth Date).
 * Layout: year * Y + month * M + day * D + hour.
 */
export function calendarSort(parts = {}, cal = null) {
  const c = normalizeCalendar(cal || {});
  const year = Number(parts.year) || 0;
  let month = parts.monthIndex;
  if (month == null && parts.seasonId) {
    const season = c.seasons.find(s => s.id === parts.seasonId
      || s.label.toLowerCase() === String(parts.seasonId).toLowerCase());
    month = season ? Math.max(0, (season.startMonth || 1) - 1) : 0;
  }
  if (month == null && parts.week != null) {
    month = Math.floor((Number(parts.week) || 1) / 4);
  }
  month = Math.max(0, Math.min(c.monthsPerYear - 1, Number(month) || 0));
  let day = Number(parts.day);
  if (!Number.isFinite(day)) {
    if (parts.seasonPhase === 'late') day = 20;
    else if (parts.seasonPhase === 'mid') day = 10;
    else if (parts.week != null) day = ((Number(parts.week) || 1) - 1) % DAYS_PER_MONTH + 1;
    else day = 1;
  }
  day = Math.max(1, Math.min(DAYS_PER_MONTH, day));
  const hour = Math.max(0, Math.min(hourUnit(c) - 1, Number(parts.hour) || 0));
  return year * yearUnit(c) + month * monthUnit(c) + (day - 1) * dayUnit(c) + hour;
}

export function emptyParts(scale = 'day') {
  return {
    year: null,
    monthIndex: null,
    seasonId: null,
    seasonPhase: null,
    day: null,
    week: null,
    hour: null,
    scale,
  };
}

function resultFromParts(parts, cal, exact = false) {
  const c = normalizeCalendar(cal);
  const sort = calendarSort(parts, c);
  return {
    sort,
    scale: parts.scale || 'day',
    exact,
    parts: { ...parts },
    hoursPerDay: c.hoursPerDay,
  };
}

/**
 * Earth UTC ms for a civil date. Uses setUTCFullYear so years 0–99 stay 0–99
 * (Date.UTC maps them to 1900–1999, which is how "August 87" became 1987).
 */
export function earthUtcMs(year, monthIndex, day = 1, hour = 0) {
  const y = Number(year);
  if (!Number.isFinite(y)) return null;
  const m = Math.max(0, Number(monthIndex) || 0);
  const d = Math.max(1, Number(day) || 1);
  const h = Math.max(0, Number(hour) || 0);
  const dt = new Date(Date.UTC(2000, m, d, h));
  dt.setUTCFullYear(y);
  return dt.getTime();
}

/**
 * Expand a 2-digit year toward the timeline anchor (26 + 2026 → 2026).
 * Full years and missing years are left alone / filled from the anchor.
 */
export function coerceYear(year, anchorYear) {
  const ay = Number(anchorYear);
  if (year == null || year === '') return Number.isFinite(ay) ? ay : null;
  let y = Number(year);
  if (!Number.isFinite(y)) return Number.isFinite(ay) ? ay : null;
  y = Math.trunc(y);
  if (y >= 0 && y < 100) {
    const target = Number.isFinite(ay) ? ay : 2000;
    const century = Math.floor(target / 100) * 100;
    const candidates = [century + y, century + y - 100, century + y + 100];
    y = candidates.reduce((best, c) =>
      Math.abs(c - target) < Math.abs(best - target) ? c : best);
  }
  return y;
}

/** Fill missing year / season / month from the present so vague keys sit in that span. */
export function withAnchorParts(parts = {}, anchorParts = null, cal = null, { fillMissing = true } = {}) {
  const next = { ...emptyParts(parts.scale || 'day'), ...parts };
  const ay = anchorParts?.year != null ? Number(anchorParts.year) : null;
  if (next.year == null) {
    if (fillMissing && Number.isFinite(ay)) next.year = ay;
  } else {
    next.year = coerceYear(next.year, ay);
  }
  const hasMonth = next.monthIndex != null;
  const hasSeason = !!next.seasonId;
  // "Day 3" / "Week 2" named no month or season — inherit the present's.
  const needSpan = !hasMonth && !hasSeason
    && (next.scale === 'day' || next.scale === 'hour' || next.scale === 'week' || next.day != null || next.week != null);
  if (fillMissing && needSpan) {
    if (Number.isFinite(Number(anchorParts?.monthIndex))) {
      next.monthIndex = Number(anchorParts.monthIndex);
    }
    if (anchorParts?.seasonId) next.seasonId = anchorParts.seasonId;
  }
  return next;
}

function finalizeParsed(parts, cal, { exact = false } = {}) {
  const c = normalizeCalendar(cal || {});
  if (useEarthDate(c) && parts.year != null) {
    const t = earthUtcMs(parts.year, parts.monthIndex ?? 0, parts.day ?? 1, parts.hour || 0);
    if (t != null) {
      return {
        sort: t + EARTH_EPOCH,
        scale: 'date',
        exact,
        parts: { ...parts, scale: 'date' },
        earthMs: t,
      };
    }
  }
  return resultFromParts(parts, c, exact);
}

/** Re-express a parse result in the timeline's present/center year. */
export function applyAnchorToParsed(parsed, calendar, anchorParts, { fillMissing = true } = {}) {
  if (!parsed) return null;
  const cal = normalizeCalendar(calendar || {});
  const filled = withAnchorParts(parsed.parts || emptyParts(parsed.scale), anchorParts, cal, { fillMissing });
  return finalizeParsed(filled, cal, { exact: !!parsed.exact });
}

function useEarthDate(cal) {
  return normalizeCalendar(cal).monthsPerYear === 12;
}

/** Canonical Script/Library time key from parts (omit nulls for fuzzy placement). */
export function formatTimeKey(parts = {}, calendar = null) {
  const cal = normalizeCalendar(calendar || {});
  const phase = parts.seasonPhase
    ? String(parts.seasonPhase).charAt(0).toUpperCase() + String(parts.seasonPhase).slice(1)
    : '';
  const scale = parts.scale || 'day';
  const bits = [];

  if (phase && (parts.seasonId || parts.monthIndex != null || scale === 'season' || scale === 'month')) {
    // phase applied with season/month label below
  }

  if (parts.seasonId || scale === 'season') {
    const season = cal.seasons.find(s => s.id === parts.seasonId
      || s.label.toLowerCase() === String(parts.seasonId || '').toLowerCase())
      || (parts.seasonId ? null : cal.seasons[0]);
    if (season) {
      bits.push(phase ? `${phase} ${season.label}` : season.label);
    }
  } else if (parts.monthIndex != null || scale === 'month') {
    const mi = Math.max(0, Math.min(cal.monthsPerYear - 1, Number(parts.monthIndex) || 0));
    const name = cal.monthNames[mi] || `${cal.labels.month} ${mi + 1}`;
    bits.push(phase ? `${phase} ${name}` : name);
  }

  if (parts.week != null && scale === 'week') {
    bits.push(`${cal.labels.week} ${Number(parts.week)}`);
  }
  if (parts.day != null && (scale === 'day' || scale === 'hour' || parts.monthIndex != null)) {
    if (scale === 'day' && parts.monthIndex == null && !parts.seasonId && parts.year == null) {
      return `${cal.labels.day} ${Number(parts.day)}`;
    }
    if (parts.monthIndex != null || parts.seasonId) bits.push(String(parts.day));
    else if (scale !== 'hour') bits.push(`${cal.labels.day} ${Number(parts.day)}`);
  }
  if (parts.hour != null && (scale === 'hour' || parts.hour !== 0)) {
    bits.push(`${cal.labels.hour} ${Number(parts.hour)}`);
  }
  if (parts.year != null) {
    bits.push(formatCalendarYear(parts.year, cal));
  }

  if (bits.length) return bits.join(' ').replace(/\s+/g, ' ').trim();

  if (scale === 'year' && parts.year != null) return formatCalendarYear(parts.year, cal);
  if (scale === 'week' && parts.week != null) return `${cal.labels.week} ${Number(parts.week)}`;
  if (parts.day != null) return `${cal.labels.day} ${Number(parts.day)}`;
  if (parts.year != null) return formatCalendarYear(parts.year, cal);
  return '';
}

/**
 * Clapper date string from enabled dateParts.
 * @param {object} parts
 * @param {object} calendar
 * @param {object} dateParts — { day, month, year, season, seasonFuzzy }
 */
export function formatSceneDate(parts = {}, calendar = null, dateParts = null) {
  const cal = normalizeCalendar(calendar || {});
  const dp = normalizeDateParts(dateParts);
  const bits = [];

  const season = parts.seasonId
    ? cal.seasons.find(s => s.id === parts.seasonId
      || s.label.toLowerCase() === String(parts.seasonId).toLowerCase())
    : (parts.monthIndex != null
      ? seasonForMonth(cal, Number(parts.monthIndex) + 1)
      : null);

  if (dp.seasonFuzzy && season) {
    const phase = parts.seasonPhase
      ? String(parts.seasonPhase).charAt(0).toUpperCase() + String(parts.seasonPhase).slice(1)
      : 'Mid';
    bits.push(`${phase} ${season.label}`);
  } else if (dp.season && season) {
    bits.push(season.label);
  }

  if (dp.day && parts.day != null) {
    bits.push(String(parts.day));
  } else if (dp.day && parts.scale === 'day' && parts.day != null) {
    bits.push(`${cal.labels.day} ${parts.day}`);
  }

  if (dp.month && parts.monthIndex != null) {
    const mi = Math.max(0, Math.min(cal.monthsPerYear - 1, Number(parts.monthIndex) || 0));
    bits.push(cal.monthNames[mi] || `${cal.labels.month} ${mi + 1}`);
  }

  if (dp.year && parts.year != null) {
    bits.push(formatCalendarYear(parts.year, cal));
  }

  // Day-only synthetic keys
  if (!bits.length && dp.day && parts.day != null) {
    bits.push(`${cal.labels.day} ${parts.day}`);
  }
  if (!bits.length && dp.year && parts.year != null) {
    bits.push(formatCalendarYear(parts.year, cal));
  }

  return bits.join(' ').replace(/\s+/g, ' ').trim();
}

function daysInCalendarMonth(cal, year, monthIndex) {
  const c = normalizeCalendar(cal || {});
  if (useEarthDate(c) && Number.isFinite(Number(year))) {
    return new Date(Date.UTC(Number(year), Number(monthIndex) + 1, 0)).getUTCDate();
  }
  return 30;
}

/** Advance (or rewind) calendar parts by whole days. Preserves hour when set. */
export function shiftPartsByDays(parts = {}, deltaDays = 0, calendar = null) {
  const c = normalizeCalendar(calendar || {});
  const delta = Math.trunc(Number(deltaDays) || 0);
  const next = { ...emptyParts(parts.scale || 'day'), ...parts };
  if (!delta) return next;
  if (useEarthDate(c) && next.year != null && next.monthIndex != null) {
    const d = new Date(Date.UTC(
      Number(next.year),
      Number(next.monthIndex) || 0,
      Math.max(1, Number(next.day) || 1),
    ));
    d.setUTCDate(d.getUTCDate() + delta);
    next.year = d.getUTCFullYear();
    next.monthIndex = d.getUTCMonth();
    next.day = d.getUTCDate();
    const season = seasonForMonth(c, next.monthIndex + 1);
    if (season) next.seasonId = season.id;
    if (next.scale === 'hour') next.scale = 'hour';
    else if (next.scale === 'date') next.scale = 'date';
    else next.scale = 'day';
    return next;
  }
  let day = Math.max(1, Number(next.day) || 1);
  let month = Number.isFinite(Number(next.monthIndex)) ? Number(next.monthIndex) : 0;
  let year = Number.isFinite(Number(next.year)) ? Number(next.year) : 1;
  day += delta;
  while (day > daysInCalendarMonth(c, year, month)) {
    day -= daysInCalendarMonth(c, year, month);
    month += 1;
    if (month >= c.monthsPerYear) {
      month = 0;
      year += 1;
    }
  }
  while (day < 1) {
    month -= 1;
    if (month < 0) {
      month = c.monthsPerYear - 1;
      year -= 1;
    }
    day += daysInCalendarMonth(c, year, month);
  }
  next.day = day;
  next.monthIndex = month;
  next.year = year;
  const season = seasonForMonth(c, month + 1);
  if (season) next.seasonId = season.id;
  return next;
}

export function seasonForMonth(cal, month1Based) {
  const month = Number(month1Based) || 1;
  return (cal.seasons || []).find(s => {
    const a = Number(s.startMonth) || 1;
    const b = Number(s.endMonth) || a;
    return a <= b ? (month >= a && month <= b) : (month >= a || month <= b);
  }) || null;
}

export function partsFromEarthMs(ms, cal) {
  const c = normalizeCalendar(cal);
  const d = new Date(ms);
  if (!Number.isFinite(d.getTime())) return emptyParts('date');
  const monthIndex = Math.min(c.monthsPerYear - 1, d.getUTCMonth());
  const season = seasonForMonth(c, monthIndex + 1);
  return {
    year: d.getUTCFullYear(),
    monthIndex,
    seasonId: season?.id || null,
    seasonPhase: null,
    day: d.getUTCDate(),
    week: null,
    hour: d.getUTCHours(),
    scale: 'date',
  };
}

/** Inverse of calendarSort — calendar-native hour counts back to parts. */
export function partsFromCalendarSort(sort, cal) {
  const c = normalizeCalendar(cal);
  const s = Number(sort);
  if (!Number.isFinite(s)) return emptyParts('day');
  const yU = yearUnit(c);
  const mU = monthUnit(c);
  const dU = dayUnit(c);
  const year = Math.floor(s / yU);
  let rem = s - year * yU;
  const monthIndex = Math.max(0, Math.min(c.monthsPerYear - 1, Math.floor(rem / mU)));
  rem -= monthIndex * mU;
  const day = Math.max(1, Math.min(DAYS_PER_MONTH, Math.floor(rem / dU) + 1));
  const hour = Math.max(0, Math.min(hourUnit(c) - 1, Math.round(rem - (day - 1) * dU)));
  const season = seasonForMonth(c, monthIndex + 1);
  return {
    year,
    monthIndex,
    seasonId: season?.id || null,
    seasonPhase: null,
    day,
    week: null,
    hour,
    scale: hour ? 'hour' : 'day',
  };
}

export function parseTimeKey(raw, calendar = null, opts = {}) {
  const cal = normalizeCalendar(calendar || {});
  const s = String(raw || '').trim();
  if (!s) return null;
  const found = parseTimeKeyUnanchored(s, cal);
  return applyAnchorToParsed(found, cal, opts.anchorParts, { fillMissing: opts.fillMissing !== false });
}

function parseTimeKeyUnanchored(s, cal) {
  const earth = useEarthDate(cal);

  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[t\s].+)?$/i);
  if (iso) {
    const t = Date.parse(s);
    if (!Number.isNaN(t)) {
      if (earth) {
        return {
          sort: t + EARTH_EPOCH,
          scale: 'date',
          exact: true,
          parts: partsFromEarthMs(t, cal),
          earthMs: t,
        };
      }
      const parts = {
        year: +iso[1],
        monthIndex: Math.max(0, Math.min(cal.monthsPerYear - 1, +iso[2] - 1)),
        day: +iso[3],
        scale: 'month',
      };
      return resultFromParts(parts, cal, true);
    }
  }
  const ymd = s.match(/^(\d{4})[./](\d{1,2})[./](\d{1,2})$/);
  if (ymd) {
    const y = +ymd[1];
    const m = Math.max(0, Math.min(cal.monthsPerYear - 1, +ymd[2] - 1));
    const day = +ymd[3];
    if (earth && cal.monthsPerYear === 12) {
      const t = earthUtcMs(y, m, day);
      return {
        sort: t + EARTH_EPOCH,
        scale: 'date',
        exact: true,
        parts: { year: y, monthIndex: m, day, scale: 'date' },
        earthMs: t,
      };
    }
    return resultFromParts({ year: y, monthIndex: m, day, scale: 'month' }, cal, true);
  }

  const monthMap = calendarMonthMap(cal);
  const monthYear = s.match(/^(early|mid|late)?\s*([a-z][a-z.'-]*)\s+(\d{1,6})$/i);
  if (monthYear && monthMap[monthYear[2].toLowerCase()] != null) {
    const m = monthMap[monthYear[2].toLowerCase()];
    const phase = monthYear[1]?.toLowerCase() || null;
    const day = phase === 'late' ? 25 : phase === 'mid' ? 15 : 1;
    const parts = {
      year: +monthYear[3],
      monthIndex: m,
      day,
      seasonPhase: phase,
      scale: 'month',
    };
    if (earth) {
      const t = earthUtcMs(parts.year, m, day);
      return {
        sort: t + EARTH_EPOCH,
        scale: 'date',
        exact: false,
        parts: { ...parts, scale: 'date' },
        earthMs: t,
      };
    }
    return resultFromParts(parts, cal, false);
  }

  // "14 Germinal" / "14 Germinal Y12" / day + month name
  const dayMonth = s.match(new RegExp(
    `^(\\d{1,2})\\s+([a-z][a-z.'-]*)(?:\\s+(?:${reEscape(cal.labels.year)}\\s*)?(\\d{1,6})|(?:\\s+${reEscape(cal.yearPrefix || '____')})?(\\d{1,6}))?$`,
    'i',
  ));
  if (dayMonth && monthMap[dayMonth[2].toLowerCase()] != null) {
    const m = monthMap[dayMonth[2].toLowerCase()];
    const year = dayMonth[3] ? +dayMonth[3] : (dayMonth[4] ? +dayMonth[4] : null);
    const parts = {
      year,
      monthIndex: m,
      day: +dayMonth[1],
      scale: year != null ? 'month' : 'month',
    };
    return resultFromParts(parts, cal, false);
  }

  const monthOrdinal = s.match(new RegExp(
    `^(?:(\\d{1,2})(?:st|nd|rd|th)?\\s+${reEscape(cal.labels.month)}|${reEscape(cal.labels.month)}\\s*(\\d{1,2}))`
    + `(?:\\s*(?:of|,)?\\s*(?:${reEscape(cal.labels.year)}\\s*)?(\\d{1,6}))?$`,
    'i',
  ));
  if (monthOrdinal) {
    const mi = Math.max(0, Math.min(cal.monthsPerYear - 1, Number(monthOrdinal[1] || monthOrdinal[2]) - 1));
    const year = monthOrdinal[3] ? +monthOrdinal[3] : null;
    return resultFromParts({
      year,
      monthIndex: mi,
      day: 1,
      scale: year != null ? 'month' : 'month',
    }, cal, false);
  }

  const seasonNames = [
    ...cal.seasons.map(x => x.label),
    'spring', 'summer', 'autumn', 'fall', 'winter',
  ].map(n => reEscape(n)).filter(Boolean);
  const seasonRe = new RegExp(
    `^(early|mid|late)?\\s*(${[...new Set(seasonNames)].join('|')})(?:\\s+(?:of\\s+)?(\\d{1,6}))?$`,
    'i',
  );
  const season = s.match(seasonRe);
  if (season) {
    const name = season[2].toLowerCase();
    const custom = cal.seasons.find(x => x.label.toLowerCase() === name || x.id === name);
    const month = custom
      ? Math.max(0, (custom.startMonth || 1) - 1)
      : (SEASON_MONTH[name === 'fall' ? 'autumn' : name] ?? 0);
    const year = season[3] ? +season[3] : null;
    const phase = season[1]?.toLowerCase() || null;
    const day = phase === 'late' ? 20 : phase === 'mid' ? 10 : 1;
    const parts = {
      year,
      monthIndex: month,
      seasonId: custom?.id || name,
      seasonPhase: phase,
      day,
      scale: 'season',
    };
    if (earth && year != null) {
      const t = earthUtcMs(year, month, day);
      return {
        sort: t + EARTH_EPOCH,
        scale: 'date',
        exact: false,
        parts: { ...parts, scale: 'date' },
        earthMs: t,
      };
    }
    return resultFromParts(parts, cal, false);
  }

  const L = cal.labels;
  const dayN = s.match(new RegExp(`^(?:${reEscape(L.day)}|day|d\\.?)\\s*(\\d+)$`, 'i'))
    || s.match(new RegExp(`\\b(?:${reEscape(L.day)}|day|d\\.?)\\s*(\\d+)\\b`, 'i'));
  if (dayN && !/–|-| to /i.test(s)) {
    const day = Number(dayN[1]);
    return resultFromParts({ day, scale: 'day' }, cal, false);
  }
  const weekN = s.match(new RegExp(`\\b(?:${reEscape(L.week)}|week|wk\\.?)\\s*(\\d+)\\b`, 'i'));
  if (weekN) {
    const week = Number(weekN[1]);
    return resultFromParts({ week, day: ((week - 1) % DAYS_PER_MONTH) + 1, scale: 'week' }, cal, false);
  }
  const hourN = s.match(new RegExp(`\\b(?:${reEscape(L.hour)}|hour|hr\\.?)\\s*(\\d+)\\b`, 'i'));
  if (hourN) {
    return resultFromParts({ hour: Number(hourN[1]), day: 1, scale: 'hour' }, cal, false);
  }
  const yearN = s.match(new RegExp(`^(?:${reEscape(L.year)}|year|yr\\.?)\\s*(\\d+)$`, 'i'))
    || s.match(new RegExp(`\\b(?:${reEscape(L.year)}|year|yr\\.?)\\s*(\\d+)\\b`, 'i'));
  if (yearN && !monthYear) {
    return resultFromParts({ year: Number(yearN[1]), monthIndex: 0, day: 1, scale: 'year' }, cal, false);
  }
  if (cal.yearPrefix) {
    const pre = s.match(new RegExp(`^${reEscape(cal.yearPrefix)}\\s*(\\d{1,6})$`, 'i'));
    if (pre) {
      return resultFromParts({ year: Number(pre[1]), monthIndex: 0, day: 1, scale: 'year' }, cal, false);
    }
  }
  if (cal.yearSuffix) {
    const suf = s.match(new RegExp(`^(?:c\\.|circa|~)?\\s*(\\d{1,6})\\s*${reEscape(cal.yearSuffix)}$`, 'i'));
    if (suf) {
      return resultFromParts({ year: Number(suf[1]), monthIndex: 0, day: 1, scale: 'year' }, cal, false);
    }
  }

  const yearOnly = s.match(/^(?:c\.|circa|~)?\s*(\d{3,4})\s*(?:ad|ce|bc|bce)?$/i);
  if (yearOnly) {
    const y = +yearOnly[1];
    if (earth) {
      const t = /bc|bce/i.test(s) ? earthUtcMs(0, 0, 1) - y * 31557600000 : earthUtcMs(y, 0, 1);
      return {
        sort: t + EARTH_EPOCH,
        scale: 'date',
        exact: false,
        parts: partsFromEarthMs(Math.max(0, t), cal),
        earthMs: t,
      };
    }
    return resultFromParts({ year: y, monthIndex: 0, day: 1, scale: 'year' }, cal, false);
  }

  const rel = s.match(/^(before|after|during)\s+(.+)$/i);
  if (rel) {
    const inner = parseTimeKeyUnanchored(rel[2], cal);
    if (inner) {
      const dir = rel[1].toLowerCase() === 'before' ? -1 : rel[1].toLowerCase() === 'after' ? 1 : 0;
      const step = inner.scale === 'date' ? 86400000 : Math.max(1, Math.abs(inner.sort) * 0.02);
      return {
        sort: inner.sort + dir * step,
        scale: inner.scale,
        exact: false,
        parts: inner.parts ? { ...inner.parts } : emptyParts(inner.scale),
        earthMs: inner.earthMs,
      };
    }
  }

  // Bare month name ("August", "Late June") — year comes from the timeline anchor.
  const monthOnly = s.match(/^(early|mid|late)?\s*([a-z][a-z.'-]*)$/i);
  if (monthOnly && monthMap[monthOnly[2].toLowerCase()] != null) {
    const m = monthMap[monthOnly[2].toLowerCase()];
    const phase = monthOnly[1]?.toLowerCase() || null;
    const day = phase === 'late' ? 25 : phase === 'mid' ? 15 : 1;
    return resultFromParts({
      year: null,
      monthIndex: m,
      day,
      seasonPhase: phase,
      scale: 'month',
    }, cal, false);
  }

  return null;
}

/**
 * Parse a range like "Day 3–5", "Spring–Summer 12", "Month 1 to Month 3".
 */
export function parseTimeRange(raw, calendar = null, opts = {}) {
  const cal = normalizeCalendar(calendar || {});
  const s = String(raw || '').trim();
  if (!s) return null;

  const single = parseTimeKey(s, cal, opts);
  // Prefer explicit range separators
  const parts = s.split(/\s*(?:–|—|−|\buntil\b|\bto\b)\s*|\s+-\s+/i);
  if (parts.length === 2) {
    let left = parts[0].trim();
    let right = parts[1].trim();
    // "Spring–Summer 12" → share year onto left if missing
    const yearOnRight = right.match(/(\d{1,6})\s*$/);
    const start = parseTimeKey(left, cal, opts);
    let end = parseTimeKey(right, cal, opts);
    if (start && !end && yearOnRight) {
      end = parseTimeKey(`${left.replace(/\d{1,6}\s*$/, '').trim()} ${yearOnRight[1]}`.trim(), cal, opts)
        || parseTimeKey(right, cal, opts);
    }
    // "Day 3–5" → right is bare number
    if (start && !end && /^\d+$/.test(right)) {
      const L = cal.labels;
      if (start.scale === 'day') end = parseTimeKey(`${L.day} ${right}`, cal, opts);
      else if (start.scale === 'week') end = parseTimeKey(`${L.week} ${right}`, cal, opts);
      else if (start.parts?.monthIndex != null) {
        end = parseTimeKey(`${cal.monthNames[start.parts.monthIndex] || L.month} ${right}`, cal, opts);
      }
    }
    // "Spring–Summer 12"
    if (start && end) {
      if (start.parts && end.parts?.year != null && start.parts.year == null) {
        Object.assign(start, applyAnchorToParsed(start, cal, { ...opts.anchorParts, year: end.parts.year }));
      }
      const a = Math.min(start.sort, end.sort);
      const b = Math.max(start.sort, end.sort);
      return {
        start,
        end,
        sort: (a + b) / 2,
        scale: start.scale === end.scale ? start.scale : 'fuzzy',
        label: s,
        parts: start.parts,
      };
    }
  }

  // "Day 3-5" without spaces around hyphen
  const compact = s.match(new RegExp(
    `^(${reEscape(cal.labels.day)}|day|${reEscape(cal.labels.week)}|week)\\s*(\\d+)\\s*[-–—]\\s*(\\d+)$`,
    'i',
  ));
  if (compact) {
    const unit = /week/i.test(compact[1]) ? cal.labels.week : cal.labels.day;
    const start = parseTimeKey(`${unit} ${compact[2]}`, cal, opts);
    const end = parseTimeKey(`${unit} ${compact[3]}`, cal, opts);
    if (start && end) {
      return {
        start,
        end,
        sort: (start.sort + end.sort) / 2,
        scale: start.scale,
        label: s,
        parts: start.parts,
      };
    }
  }

  if (single) {
    return {
      start: single,
      end: single,
      sort: single.sort,
      scale: single.scale,
      label: s,
      parts: single.parts,
      point: true,
    };
  }
  return null;
}

/** First parseable time among span / DateTime facets / timeKey (range-aware). */
export function pickParseableTimeKey(card, calendar, opts = {}) {
  const cal = normalizeCalendar(calendar || {});
  const seen = new Set();
  const candidates = [
    card?.span,
    ...(Array.isArray(card?.keywordFacets?.datetime) ? card.keywordFacets.datetime : []),
    card?.timeKey,
  ];
  for (const raw of candidates) {
    const key = String(raw || '').trim();
    if (!key) continue;
    const low = key.toLowerCase();
    if (seen.has(low)) continue;
    seen.add(low);
    const range = parseTimeRange(key, cal, opts);
    if (range) {
      return {
        key,
        parsed: {
          sort: range.sort,
          scale: range.scale,
          exact: false,
          parts: range.parts || range.start?.parts,
          range: range.point ? null : range,
        },
        range: range.point ? null : range,
      };
    }
  }
  return null;
}

export function timelineUnitSort(id, scale, cal) {
  const c = normalizeCalendar(cal || {});
  if (scale === 'date') {
    return ({
      hours: 36e5,
      days: 864e5,
      weeks: 7 * 864e5,
      months: 30.44 * 864e5,
      seasons: 91.31 * 864e5,
      years: 365.25 * 864e5,
      decades: 3652.5 * 864e5,
    }[id] || 864e5);
  }
  // calendar-native
  if (id === 'hours') return 1;
  if (id === 'days') return dayUnit(c);
  if (id === 'weeks') return 7 * dayUnit(c);
  if (id === 'months') return monthUnit(c);
  if (id === 'seasons') return Math.max(1, Math.floor(c.monthsPerYear / Math.max(1, c.seasons.length))) * monthUnit(c);
  if (id === 'years') return yearUnit(c);
  if (id === 'decades') return 10 * yearUnit(c);
  return dayUnit(c);
}

export function alignCalendarSort(sort, zoomId, scale, cal) {
  if (scale === 'date') {
    const ms = Number(sort) - EARTH_EPOCH;
    const d = new Date(ms);
    if (!Number.isFinite(d.getTime())) return sort;
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth();
    if (zoomId === 'hours') return Date.UTC(y, m, d.getUTCDate(), d.getUTCHours()) + EARTH_EPOCH;
    if (zoomId === 'days') return Date.UTC(y, m, d.getUTCDate()) + EARTH_EPOCH;
    if (zoomId === 'weeks') {
      const day = d.getUTCDay(); // 0 = Sunday
      return Date.UTC(y, m, d.getUTCDate() - day) + EARTH_EPOCH;
    }
    if (zoomId === 'months') return Date.UTC(y, m, 1) + EARTH_EPOCH;
    if (zoomId === 'seasons') {
      const c = normalizeCalendar(cal || {});
      const season = seasonForMonth(c, m + 1);
      const start = Math.max(1, Number(season?.startMonth) || (Math.floor(m / 3) * 3 + 1)) - 1;
      // Winter-style wrap (e.g. Dec–Feb): January still belongs to last year's start.
      const yy = start > m ? y - 1 : y;
      return Date.UTC(yy, start, 1) + EARTH_EPOCH;
    }
    if (zoomId === 'decades') return Date.UTC(Math.floor(y / 10) * 10, 0, 1) + EARTH_EPOCH;
    return Date.UTC(y, 0, 1) + EARTH_EPOCH;
  }
  const unit = timelineUnitSort(zoomId, scale, cal);
  return Math.floor(sort / unit) * unit;
}

export function addCalendarSort(sort, zoomId, scale, cal) {
  if (scale === 'date') {
    const ms = Number(sort) - EARTH_EPOCH;
    const d = new Date(ms);
    if (!Number.isFinite(d.getTime())) return sort;
    if (zoomId === 'hours') d.setUTCHours(d.getUTCHours() + 1);
    else if (zoomId === 'days') d.setUTCDate(d.getUTCDate() + 1);
    else if (zoomId === 'weeks') d.setUTCDate(d.getUTCDate() + 7);
    else if (zoomId === 'months') d.setUTCMonth(d.getUTCMonth() + 1);
    else if (zoomId === 'seasons') d.setUTCMonth(d.getUTCMonth() + 3);
    else if (zoomId === 'years') d.setUTCFullYear(d.getUTCFullYear() + 1);
    else if (zoomId === 'decades') d.setUTCFullYear(d.getUTCFullYear() + 10);
    else d.setUTCDate(d.getUTCDate() + 1);
    return d.getTime() + EARTH_EPOCH;
  }
  return sort + timelineUnitSort(zoomId, scale, cal);
}

export function formatTimelineTick(sort, zoomId, scale, calendar) {
  const cal = normalizeCalendar(calendar || {});
  if (scale === 'date') {
    const ms = sort - EARTH_EPOCH;
    const d = new Date(ms);
    if (!Number.isFinite(d.getTime())) return '';
    if (zoomId === 'hours') {
      return `${String(d.getUTCHours()).padStart(2, '0')}:00`;
    }
    if (zoomId === 'days' || zoomId === 'weeks') {
      return `${cal.monthNames[d.getUTCMonth()]?.slice(0, 3) || ''} ${d.getUTCDate()}`.trim();
    }
    if (zoomId === 'months') {
      return `${cal.monthNames[d.getUTCMonth()] || ''} ${d.getUTCFullYear()}`.trim();
    }
    if (zoomId === 'seasons') {
      const season = seasonForMonth(cal, d.getUTCMonth() + 1);
      return `${season?.label || cal.labels.season} ${d.getUTCFullYear()}`;
    }
    if (zoomId === 'years' || zoomId === 'decades') {
      return formatCalendarYear(d.getUTCFullYear(), cal);
    }
    return formatCalendarYear(d.getUTCFullYear(), cal);
  }

  const yU = yearUnit(cal);
  const mU = monthUnit(cal);
  const dU = dayUnit(cal);
  const year = Math.floor(sort / yU);
  let rem = sort - year * yU;
  const month = Math.floor(rem / mU);
  rem -= month * mU;
  const day = Math.floor(rem / dU) + 1;
  const hour = rem - (day - 1) * dU;

  if (zoomId === 'hours') return `${cal.labels.hour} ${Math.round(hour)}`;
  if (zoomId === 'days' || zoomId === 'weeks') {
    if (year || month) {
      return `${cal.monthNames[month] || ''} ${day}${year ? ` ${formatCalendarYear(year, cal)}` : ''}`.trim();
    }
    return `${cal.labels.day} ${day}`;
  }
  if (zoomId === 'months') {
    const name = cal.monthNames[Math.max(0, Math.min(cal.monthsPerYear - 1, month))] || `${cal.labels.month} ${month + 1}`;
    return year ? `${name} ${formatCalendarYear(year, cal)}` : name;
  }
  if (zoomId === 'seasons') {
    const season = seasonForMonth(cal, month + 1);
    return year
      ? `${season?.label || cal.labels.season} ${formatCalendarYear(year, cal)}`
      : (season?.label || cal.labels.season);
  }
  if (zoomId === 'years' || zoomId === 'decades') {
    return formatCalendarYear(year, cal);
  }
  return formatCalendarYear(year, cal);
}

/**
 * Resolve current timeline place from Script chat DB.
 * Prefers an explicitly Set present marker, then selection / locked scene cards.
 * Does not invent "now" from the midpoint of every dated card.
 * @param {object} scriptDb — storage.getChat('script')
 * @param {{ selectedUid?: string, focusedUid?: string }} opts
 */
export function getTimelinePresent(scriptDb, opts = {}) {
  const db = scriptDb && typeof scriptDb === 'object' ? scriptDb : {};
  const cal = normalizeCalendar(db.settings?.calendar);
  const cards = Array.isArray(db.cards) ? db.cards : [];
  const isFolder = (c) => c?.kind === 'folder'
    || (c?.kind !== 'card' && c?.kind !== 'event'
      && (db.settings?.levels || []).findIndex(l => l.id === c?.levelId) < (db.settings?.levels?.length || 1) - 1);

  const stored = db.settings?.timelinePresent;
  if (stored && Number.isFinite(Number(stored.sort))) {
    const scale = stored.scale === 'date' ? 'date' : 'calendar';
    let sort = Number(stored.sort);
    // Older Set used raw Date.UTC without the Earth-date offset.
    if (scale === 'date' && sort < EARTH_EPOCH / 2) sort += EARTH_EPOCH;
    return {
      key: String(stored.key || ''),
      parts: stored.parts && typeof stored.parts === 'object'
        ? stored.parts
        : emptyParts(scale),
      range: null,
      sort,
      scale,
      sourceUid: null,
      source: 'set',
    };
  }

  const tryCard = (card) => {
    if (!card || isFolder(card)) return null;
    const hit = pickParseableTimeKey(card, cal, { fillMissing: false });
    if (!hit) return null;
    // Vague keys ("Day 3", "Spring") are not a present — they inherit one.
    if (hit.parsed?.parts?.year == null) return null;
    return {
      key: hit.key,
      parts: hit.parsed.parts || hit.range?.parts || emptyParts(hit.parsed.scale),
      range: hit.range || null,
      sort: hit.parsed.sort,
      scale: hit.parsed.scale,
      sourceUid: card.uid,
      source: 'card',
    };
  };

  if (opts.selectedUid) {
    const hit = tryCard(cards.find(c => c.uid === opts.selectedUid));
    if (hit) return hit;
  }
  if (opts.focusedUid) {
    const hit = tryCard(cards.find(c => c.uid === opts.focusedUid));
    if (hit) return hit;
  }

  const locked = cards.filter(c => !isFolder(c) && c.timeLocked && c.kind !== 'event');
  for (const c of locked.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))) {
    const hit = tryCard(c);
    if (hit) return { ...hit, source: 'locked' };
  }

  // Do not invent a present from the midpoint of every dated card — that is
  // the span of the story, not "now". Trackers / gold marker stay unset until
  // the user Sets present or focuses a dated scene.
  return null;
}

/** Wall-clock parts using calendar month names (followTimeline off). */
export function wallClockParts(calendar = null) {
  const cal = normalizeCalendar(calendar || {});
  const now = new Date();
  const monthIndex = Math.min(cal.monthsPerYear - 1, now.getMonth());
  const season = seasonForMonth(cal, monthIndex + 1);
  return {
    year: now.getFullYear(),
    monthIndex,
    seasonId: season?.id || null,
    seasonPhase: null,
    day: now.getDate(),
    week: null,
    hour: now.getHours(),
    scale: 'date',
  };
}

export function smokeCalendarShiftPure() {
  const cal = normalizeCalendar({});
  const next = shiftPartsByDays({
    year: 2024, monthIndex: 5, day: 12, hour: 22, scale: 'date',
  }, 1, cal);
  if (next.monthIndex !== 5 || next.day !== 13) return `june: ${next.monthIndex}/${next.day}`;
  const wrap = shiftPartsByDays({
    year: 2024, monthIndex: 5, day: 30, scale: 'date',
  }, 1, cal);
  if (wrap.monthIndex !== 6 || wrap.day !== 1) return `july: ${wrap.monthIndex}/${wrap.day}`;
  return '';
}
