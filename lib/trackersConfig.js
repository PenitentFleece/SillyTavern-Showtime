// Studio Trackers — config schema + Backstage Trackers shelf HTML.

import {
  formatSceneDate,
  normalizeDateParts,
  normalizeCalendar,
  DEFAULT_DATE_PARTS,
} from './calendarTime.js';
import { defaultTravel, normalizeTravel } from './travelState.js';

export const TRACKER_PANES = Object.freeze([
  { id: 'status', label: 'Status' },
  { id: 'connection', label: 'Connection' },
  { id: 'scene', label: 'Scene' },
  { id: 'location', label: 'Location' },
  { id: 'items', label: 'Items' },
  { id: 'motivation', label: 'Motivation' },
]);

export const RECEIPT_CADENCES = Object.freeze([
  { id: 'per_post', label: 'Per post', tip: 'Print on each character post' },
  { id: 'per_turn', label: 'Per turn', tip: 'Print on the user post after replies' },
  { id: 'per_n', label: 'Every N posts', tip: 'Print on every Nth character post' },
  { id: 'manual', label: 'Manual only', tip: 'Cast toolbar → Receipt' },
]);

export { formatSceneDate, normalizeDateParts, DEFAULT_DATE_PARTS };

export const STATUS_STAT_COLORS = Object.freeze({
  health: '#7a1f1f',
  energy: '#c9a24a',
  hunger: '#a86b2b',
  thirst: '#4a7fa8',
  bathroom: '#6b5a8a',
  hygiene: '#5a7a5a',
});

export const TIME_MODES = Object.freeze([
  { id: 'simple', label: 'Simple', tip: 'HH:MM AM/PM' },
  { id: 'precise', label: 'Precise', tip: 'HH:MM (24-hour)' },
  { id: 'fuzzy', label: 'Fuzzy', tip: 'Early/Mid/Late Morning…Night' },
]);

/** Fuzzy board slots — hour the tracker stores when the author picks a band. */
export const FUZZY_HOURS = Object.freeze([
  { hour: 1, label: 'Late Night' },
  { hour: 7, label: 'Early Morning' },
  { hour: 9, label: 'Mid Morning' },
  { hour: 11, label: 'Late Morning' },
  { hour: 13, label: 'Early Afternoon' },
  { hour: 15, label: 'Mid Afternoon' },
  { hour: 16, label: 'Late Afternoon' },
  { hour: 18, label: 'Early Evening' },
  { hour: 19, label: 'Mid Evening' },
  { hour: 20, label: 'Late Evening' },
  { hour: 21, label: 'Early Night' },
  { hour: 22, label: 'Mid Night' },
]);

export function closestFuzzyHour(hour) {
  const h = Number(hour);
  if (!Number.isFinite(h)) return 9;
  return FUZZY_HOURS.reduce((best, s) =>
    (Math.abs(s.hour - h) < Math.abs(best - h) ? s.hour : best), FUZZY_HOURS[0].hour);
}

/**
 * Shared Set date/time fields for Trackers and the clapper popover.
 * @param {{ esc: Function, scene?: object, calendar?: object, draft?: object }} opts
 */
export function buildSceneSetFormHtml({ esc, scene = {}, calendar = null, draft = {} } = {}) {
  const cal = normalizeCalendar(calendar || {});
  const s = scene || {};
  const showDate = s.date !== false;
  const showTime = s.time !== false;
  const showYear = s.dateParts?.year !== false;
  const names = cal.monthNames || [];
  const mi = Number.isFinite(Number(draft.monthIndex))
    ? Math.max(0, Math.min(Math.max(0, names.length - 1), Number(draft.monthIndex)))
    : 0;
  const day = Number.isFinite(Number(draft.day)) ? Number(draft.day) : 1;
  const year = draft.year != null && draft.year !== '' ? String(draft.year) : '';
  const hour = Number.isFinite(Number(draft.hour)) ? Number(draft.hour) : 9;
  const minute = Number.isFinite(Number(draft.minute)) ? Number(draft.minute) : 0;
  const fuzzyHour = closestFuzzyHour(hour);
  const mode = s.timeMode || 'fuzzy';
  const monthOpts = names.map((name, i) =>
    `<option value="${i}"${i === mi ? ' selected' : ''}>${esc(name)}</option>`).join('');
  const dateFields = showDate ? `
    <label class="st-scene-set-field"><span>Month</span>
      <select class="bst-input" data-role="scene-set-month">${monthOpts}</select>
    </label>
    <label class="st-scene-set-field"><span>Day</span>
      <input class="bst-input" data-role="scene-set-day" type="number" min="1" max="31" value="${esc(String(day))}">
    </label>
    ${showYear ? `<label class="st-scene-set-field"><span>Year</span>
      <input class="bst-input" data-role="scene-set-year" type="number" value="${esc(year)}">
    </label>` : ''}` : '';
  const timeFields = showTime
    ? (mode === 'fuzzy'
      ? `<label class="st-scene-set-field"><span>Time</span>
          <select class="bst-input" data-role="scene-set-fuzzy">
            ${FUZZY_HOURS.map(f =>
              `<option value="${f.hour}"${f.hour === fuzzyHour ? ' selected' : ''}>${esc(f.label)}</option>`).join('')}
          </select>
        </label>`
      : `<label class="st-scene-set-field"><span>Hour</span>
          <input class="bst-input" data-role="scene-set-hour" type="number" min="0" max="${esc(String((cal.hoursPerDay || 24) - 1))}" value="${esc(String(hour))}">
        </label>
        <label class="st-scene-set-field"><span>Min</span>
          <input class="bst-input" data-role="scene-set-minute" type="number" min="0" max="59" value="${esc(String(minute))}">
        </label>`)
    : '';
  if (!dateFields && !timeFields) return '';
  return `
    <div class="st-scene-set" data-role="scene-set-form">
      <div class="st-scene-set-row">
        ${dateFields}
        ${timeFields}
        <button type="button" class="bst-btn gold" data-action="scene-set">Set</button>
      </div>
    </div>`;
}

export const SONAR_REACH = Object.freeze([
  { id: 'adjacent', label: 'Adjacent areas', tip: 'Standing area + neighbors (unless wall-blocked)' },
  { id: 'room', label: 'Entire room', tip: 'All compass areas in the loaded room' },
  { id: 'adjacent_rooms', label: 'Adjacent rooms', tip: 'This room plus linked neighbor places' },
]);

export const IN_PLAY_WINDOWS = Object.freeze([5, 10, 20, 40]);

const WEATHER_BY_SEASON = Object.freeze({
  spring: ['🌸 Clear', '🌦 Showers', '🌫 Mist', '🌬 Breezy'],
  summer: ['☀️ Hot', '⛅ Hazy', '⛈ Storm', '🌅 Golden'],
  autumn: ['🍂 Crisp', '🌧 Rain', '🌬 Gusty', '🌫 Fog'],
  winter: ['❄ Snow', '🌨 Flurry', '☁ Overcast', '🧊 Bitter'],
  default: ['☁ Overcast', '🌤 Fair', '🌧 Rain', '🌬 Windy', '🌫 Fog', '⚡ Storm'],
});

export function pendingCueLabel(cue) {
  if (!cue || typeof cue !== 'object') return '';
  const bits = [];
  if (cue.location?.label || cue.location?.key) bits.push(cue.location.label || cue.location.key);
  if (cue.date) {
    bits.push(cue.date.label
      || cue.date.fuzzy
      || (Number.isFinite(Number(cue.date.deltaDays))
        ? `${Number(cue.date.deltaDays) > 0 ? '+' : ''}${Number(cue.date.deltaDays)}d`
        : ''));
  }
  if (cue.time?.fuzzy || cue.time?.label) bits.push(cue.time.fuzzy || cue.time.label);
  return bits.filter(Boolean).join(' · ') || String(cue.label || '').trim();
}

export function normalizePendingCue(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const date = raw.date && typeof raw.date === 'object' ? raw.date : null;
  const time = raw.time && typeof raw.time === 'object' ? raw.time : null;
  const loc = raw.location && typeof raw.location === 'object' ? raw.location : null;
  const location = loc && (String(loc.key || '').trim() || String(loc.placeId || '').trim())
    ? {
      key: String(loc.key || '').trim(),
      placeId: String(loc.placeId || '').trim(),
      label: String(loc.label || loc.key || '').trim(),
    }
    : null;
  if (!date && !time && !location) return null;
  const out = {
    sig: String(raw.sig || '').trim(),
    date,
    time,
    location,
  };
  out.label = String(raw.label || '').trim() || pendingCueLabel(out);
  if (!out.sig) {
    out.sig = [
      out.date?.sig || (out.date ? `date:${out.date.kind || ''}:${out.date.deltaDays ?? ''}` : ''),
      out.time ? `time:${out.time.hour ?? ''}:${out.time.minute ?? ''}` : '',
      out.location ? `loc:${out.location.key}` : '',
    ].filter(Boolean).join('|');
  }
  return out;
}

export function defaultTrackers() {
  return {
    pane: 'status',
    status: {
      enabled: true,
      colors: { ...STATUS_STAT_COLORS },
      customBars: [],
      cadence: 'per_n', // per_post | per_n | manual
      everyN: 4,
      difficulty: 'normal', // soft | normal | hard
      offScreen: false,
      inPlayWindow: 10,
    },
    connection: {
      enabled: true,
      autoUpdate: true,
      offScreen: false,
      inPlayWindow: 10,
      difficulty: 'normal', // soft | normal | hard — how hard relationships are to maintain
    },
    scene: {
      enabled: false,
      trackStar: true,
      time: true,
      timeMode: 'fuzzy',
      date: true,
      followTimeline: true,
      dateParts: { ...DEFAULT_DATE_PARTS },
      weather: true,
      weatherEmoji: '🌤',
      weatherLabel: 'Fair',
      lastClapAt: 0,
      lastLocationKey: '',
      lastTimeLabel: '',
      lastTimeHour: null,
      lastTimeMinute: 0,
      lastDateLabel: '',
      lastDateCueSig: '',
      clapperPinned: false,
      clapperHidden: false,
      boardHeld: false,
      pendingCue: null,
      ignoredCueSig: '',
      printChatCard: false,
      travel: defaultTravel(),
    },
    location: {
      enabled: true,
      sonarReach: 'adjacent', // adjacent | room | adjacent_rooms
    },
    items: {
      enabled: true,
      castCanUse: true,
      castCanCraft: true,
      castCanDelete: false,
      npcCanOffer: true,
      directorCanSee: true,
      directorCanMutate: false,
    },
    motivation: {
      enabled: true,
      secretsSonar: true,
      achievementsSonar: true,
      scanEveryN: 6,
    },
    receipt: {
      enabled: true,
      cadence: 'per_turn', // per_post | per_turn | per_n | manual
      everyN: 4,
    },
  };
}

export function normalizeTrackers(raw) {
  const d = defaultTrackers();
  const t = raw && typeof raw === 'object' ? raw : {};
  const pane = TRACKER_PANES.some(p => p.id === t.pane) ? t.pane : 'status';

  const status = { ...d.status, ...(t.status || {}) };
  status.colors = { ...d.status.colors, ...(t.status?.colors || {}) };
  status.cadence = ['per_post', 'per_n', 'manual'].includes(status.cadence) ? status.cadence : 'per_n';
  status.everyN = Math.max(1, Math.min(40, Number(status.everyN) || 4));
  status.difficulty = ['soft', 'normal', 'hard'].includes(status.difficulty) ? status.difficulty : 'normal';
  status.inPlayWindow = IN_PLAY_WINDOWS.includes(Number(status.inPlayWindow))
    ? Number(status.inPlayWindow) : 10;
  status.enabled = status.enabled !== false;
  status.offScreen = !!status.offScreen;
  status.customBars = normalizeCustomBars(t.status?.customBars ?? status.customBars);

  const connection = { ...d.connection, ...(t.connection || {}) };
  connection.difficulty = ['soft', 'normal', 'hard'].includes(connection.difficulty)
    ? connection.difficulty : 'normal';
  connection.inPlayWindow = IN_PLAY_WINDOWS.includes(Number(connection.inPlayWindow))
    ? Number(connection.inPlayWindow) : 10;
  connection.enabled = connection.enabled !== false;
  connection.autoUpdate = connection.autoUpdate !== false;
  connection.offScreen = !!connection.offScreen;

  const scene = { ...d.scene, ...(t.scene || {}) };
  scene.timeMode = TIME_MODES.some(m => m.id === scene.timeMode) ? scene.timeMode : 'fuzzy';
  scene.enabled = !!scene.enabled;
  scene.trackStar = scene.trackStar !== false;
  scene.time = scene.time !== false;
  scene.date = scene.date !== false;
  scene.followTimeline = scene.followTimeline !== false;
  scene.dateParts = normalizeDateParts(scene.dateParts || t.scene?.dateParts);
  scene.weather = scene.weather !== false;
  scene.weatherEmoji = String(scene.weatherEmoji || '🌤').trim() || '🌤';
  scene.weatherLabel = String(scene.weatherLabel || 'Fair').trim() || 'Fair';
  scene.lastLocationKey = String(scene.lastLocationKey || '').trim();
  scene.lastTimeLabel = String(scene.lastTimeLabel || '').trim();
  const hourRaw = scene.lastTimeHour;
  scene.lastTimeHour = hourRaw === '' || hourRaw == null ? null
    : (Number.isFinite(Number(hourRaw)) ? Number(hourRaw) : null);
  const minRaw = scene.lastTimeMinute;
  scene.lastTimeMinute = minRaw === '' || minRaw == null ? 0
    : (Number.isFinite(Number(minRaw)) ? Math.max(0, Math.min(59, Math.floor(Number(minRaw)))) : 0);
  scene.lastDateLabel = String(scene.lastDateLabel || '').trim();
  scene.lastDateCueSig = String(scene.lastDateCueSig || '').trim();
  scene.lastClapAt = Number(scene.lastClapAt) || 0;
  scene.clapperPinned = !!scene.clapperPinned;
  scene.clapperHidden = !!scene.clapperHidden;
  scene.boardHeld = !!scene.boardHeld;
  scene.pendingCue = normalizePendingCue(scene.pendingCue);
  scene.ignoredCueSig = String(scene.ignoredCueSig || '').trim();
  scene.printChatCard = !!scene.printChatCard;
  scene.travel = normalizeTravel(scene.travel, { lastLocationKey: scene.lastLocationKey });

  const location = { ...d.location, ...(t.location || {}) };
  location.sonarReach = SONAR_REACH.some(r => r.id === location.sonarReach)
    ? location.sonarReach : 'adjacent';
  location.enabled = location.enabled !== false;

  const items = { ...d.items, ...(t.items || {}) };
  items.enabled = items.enabled !== false;
  items.castCanUse = items.castCanUse !== false;
  items.castCanCraft = items.castCanCraft !== false;
  items.castCanDelete = !!items.castCanDelete;
  items.npcCanOffer = items.npcCanOffer !== false;
  items.directorCanSee = items.directorCanSee !== false;
  items.directorCanMutate = !!items.directorCanMutate;

  const motivation = { ...d.motivation, ...(t.motivation || {}) };
  motivation.enabled = motivation.enabled !== false;
  motivation.secretsSonar = motivation.secretsSonar !== false;
  motivation.achievementsSonar = motivation.achievementsSonar !== false;
  motivation.scanEveryN = Math.max(1, Math.min(40, Number(motivation.scanEveryN) || 6));

  const receipt = { ...d.receipt, ...(t.receipt || {}) };
  receipt.enabled = receipt.enabled !== false;
  receipt.cadence = RECEIPT_CADENCES.some(c => c.id === receipt.cadence) ? receipt.cadence : 'per_turn';
  receipt.everyN = Math.max(1, Math.min(40, Number(receipt.everyN) || 4));

  return { pane, status, connection, scene, location, items, motivation, receipt };
}

/** The floating clapper is up. Compass suggestions stay off the marquee while it is. */
export function clapperIsShowing(trackers) {
  const scene = normalizeTrackers(trackers).scene;
  return !!scene.enabled && !scene.clapperHidden;
}

export function normalizeCustomBar(raw = {}) {
  const id = String(raw.id || `custom_${Date.now().toString(36)}`).trim();
  const levelMode = ['none', 'label', 'amount'].includes(raw.levelMode) ? raw.levelMode : 'label';
  const levels = Array.isArray(raw.levels)
    ? raw.levels.map(lv => ({
      at: Math.max(0, Math.min(100, Number(lv?.at) || 0)),
      label: String(lv?.label || '').trim(),
    })).filter(lv => levelMode === 'none' || lv.label || lv.at)
      .sort((a, b) => a.at - b.at)
    : [];
  return {
    id,
    name: String(raw.name || 'Custom').trim() || 'Custom',
    description: String(raw.description || raw.prompt || '').trim(),
    color: /^#[0-9a-fA-F]{3,8}$/.test(String(raw.color || '')) ? String(raw.color) : '#6a8a4a',
    levelMode,
    levels: levelMode === 'none' ? [] : levels,
    direction: raw.direction === 'down' ? 'down' : 'up',
  };
}

export function normalizeCustomBars(list) {
  if (!Array.isArray(list)) return [];
  return list.map(normalizeCustomBar).filter(b => b.name);
}

/** Seasonal weather pool for audit / shift. */
export function weatherPoolForSeason(seasonLabel = '') {
  const s = String(seasonLabel || '').toLowerCase();
  if (/spring|vernal/.test(s)) return WEATHER_BY_SEASON.spring;
  if (/summer|estival/.test(s)) return WEATHER_BY_SEASON.summer;
  if (/autumn|fall|harvest/.test(s)) return WEATHER_BY_SEASON.autumn;
  if (/winter|hibernal/.test(s)) return WEATHER_BY_SEASON.winter;
  return WEATHER_BY_SEASON.default;
}

export function parseWeatherToken(token) {
  const t = String(token || '').trim();
  const m = t.match(/^(\S+)\s+(.+)$/);
  if (m) return { emoji: m[1], label: m[2] };
  return { emoji: t || '🌤', label: 'Fair' };
}

export function fuzzyTimeLabel(date = new Date()) {
  const h = date.getHours();
  const slot = h < 5 ? 'Night' : h < 12 ? 'Morning' : h < 17 ? 'Afternoon' : h < 21 ? 'Evening' : 'Night';
  let band = 'Mid';
  if (slot === 'Morning') band = h < 8 ? 'Early' : h < 10 ? 'Mid' : 'Late';
  else if (slot === 'Afternoon') band = h < 14 ? 'Early' : h < 16 ? 'Mid' : 'Late';
  else if (slot === 'Evening') band = h < 19 ? 'Early' : h < 20 ? 'Mid' : 'Late';
  else band = h < 2 || h >= 23 ? 'Late' : h < 5 ? 'Early' : 'Mid';
  return `${band} ${slot}`;
}

export function formatTrackerTime(mode, date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  const h = date.getHours();
  const m = String(date.getMinutes()).padStart(2, '0');
  if (mode === 'precise') return `${String(h).padStart(2, '0')}:${m}`;
  if (mode === 'simple') {
    const ap = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return `${h12}:${m} ${ap}`;
  }
  return fuzzyTimeLabel(date);
}

/** In-world clock from a calendar hour — never the user's wall clock. */
export function formatTrackerTimeFromHour(mode, hour, hoursPerDay = 24, minute = 0) {
  const hpd = Math.max(1, Number(hoursPerDay) || 24);
  let h = Number(hour);
  if (!Number.isFinite(h)) return '';
  h = ((Math.floor(h) % hpd) + hpd) % hpd;
  let min = Number(minute);
  if (!Number.isFinite(min)) min = 0;
  min = Math.max(0, Math.min(59, Math.floor(min)));
  if (mode === 'precise') {
    return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  }
  if (mode === 'simple') {
    if (hpd !== 24) return `Hour ${h}`;
    const ap = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return `${h12}:${String(min).padStart(2, '0')} ${ap}`;
  }
  const frac = h / hpd;
  const slot = frac < 5 / 24 ? 'Night'
    : frac < 12 / 24 ? 'Morning'
      : frac < 17 / 24 ? 'Afternoon'
        : frac < 21 / 24 ? 'Evening' : 'Night';
  let band = 'Mid';
  if (slot === 'Morning') band = frac < 8 / 24 ? 'Early' : frac < 10 / 24 ? 'Mid' : 'Late';
  else if (slot === 'Afternoon') band = frac < 14 / 24 ? 'Early' : frac < 16 / 24 ? 'Mid' : 'Late';
  else if (slot === 'Evening') band = frac < 19 / 24 ? 'Early' : frac < 20 / 24 ? 'Mid' : 'Late';
  else band = frac < 2 / 24 || frac >= 23 / 24 ? 'Late' : frac < 5 / 24 ? 'Early' : 'Mid';
  return `${band} ${slot}`;
}

/**
 * Scale an audited tracker value by desk difficulty.
 * `direction: 'up'` — higher is better (health, energy, satiety). Loss = drop.
 * `direction: 'down'` — higher is worse (bladder, odor). Detriment = rise.
 * Hard: easier to get worse, harder to improve. Soft: the reverse.
 */
export function applyDifficultyToStat(current, proposed, { difficulty = 'normal', direction = 'up' } = {}) {
  const cur = Math.max(0, Math.min(100, Number(current) || 0));
  const next = Math.max(0, Math.min(100, Number(proposed) || 0));
  const delta = next - cur;
  if (!delta) return Math.round(cur);
  const d = ['soft', 'hard'].includes(difficulty) ? difficulty : 'normal';
  if (d === 'normal') return Math.round(next);
  const detriment = direction === 'down' ? delta > 0 : delta < 0;
  const gainMul = d === 'hard' ? 0.75 : 1.4;
  const lossMul = d === 'hard' ? 1 : 0.55;
  return Math.max(0, Math.min(100, Math.round(cur + delta * (detriment ? lossMul : gainMul))));
}

export function difficultyAuditHint(difficulty = 'normal') {
  if (difficulty === 'hard') {
    return 'Difficulty HARD: deterioration follows the scene at the small sizes above, with no extra penalty stacked on top. Relief and recovery stay modest unless the scene strongly earns them.';
  }
  if (difficulty === 'soft') {
    return 'Difficulty SOFT: recovery and relief come easier; deterioration stays milder unless the scene is severe.';
  }
  return 'Difficulty NORMAL: match the scene fairly. For bladder/odor, a rise is worsening (more pressure / smellier), not a gain.';
}

/**
 * @param {object} trackers normalized
 * @param {{ esc: Function, clap?: object, seasonHint?: string }} opts
 */
export function buildTrackersHtml(trackers, { esc, clap = null, seasonHint = '', calendar = null, setDraft = null, embedded = false } = {}) {
  const t = normalizeTrackers(trackers);
  const pane = t.pane;
  const tabs = TRACKER_PANES.map(p =>
    `<button type="button" class="bst-btn${pane === p.id ? ' gold' : ''}" data-action="tracker-pane" data-pane="${p.id}">${esc(p.label)}</button>`).join('');

  let body = '';
  if (pane === 'status') body = statusPane(t, esc);
  else if (pane === 'connection') body = connectionPane(t, esc);
  else if (pane === 'scene') body = scenePane(t, esc, clap, seasonHint, { calendar, setDraft });
  else if (pane === 'location') body = locationPane(t, esc);
  else if (pane === 'items') body = itemsPane(t, esc);
  else if (pane === 'motivation') body = motivationPane(t, esc);

  const tabsRow = `<div class="bst-row bst-tracker-tabs">${tabs}</div>`;
  if (embedded) {
    return `
      <div class="bst-tracker-desk">
        <p class="bst-hint">Status, Connection, Scene, Location, Items, and Motivation dials. Live meters still live on Cast / Reputation / Inventory — these settings steer how they behave.</p>
        ${tabsRow}
        ${body}
      </div>`;
  }

  return `
    <h2 class="bst-pane-title">Trackers</h2>
    <p class="bst-pane-sub">Central dials for Status, Connection, Scene, Location, and Items. Cast / Reputation / Inventory still own the live meters — these settings steer how they behave.</p>
    <section class="bst-section">
      <h3 class="bst-section-h">Tracker</h3>
      ${tabsRow}
    </section>
    ${body}`;
}

function statusPane(t, esc) {
  const s = t.status;
  const colorRows = Object.entries(s.colors).map(([id, color]) => `
    <label class="bst-field bst-tracker-color">
      <span>${esc(id)}</span>
      <input type="color" data-trk="status.colors.${id}" value="${esc(color)}">
    </label>`).join('');
  const customRows = (s.customBars || []).map((b, i) => {
    const lvPreview = b.levelMode === 'none'
      ? 'no labels'
      : b.levelMode === 'amount'
        ? 'amount only'
        : (b.levels || []).map(lv => `${lv.at}:${lv.label || '?'}`).join(', ') || 'no levels';
    return `
      <div class="bst-custom-stat" data-custom-idx="${i}">
        <div class="bst-row">
          <strong>${esc(b.name)}</strong>
          <span class="bst-k">${esc(b.levelMode)} · ${esc(lvPreview)}</span>
          <button type="button" class="bst-btn" data-action="custom-stat-edit" data-id="${esc(b.id)}">Edit</button>
          <button type="button" class="bst-btn danger" data-action="custom-stat-del" data-id="${esc(b.id)}">Delete</button>
        </div>
        ${b.description ? `<div class="bst-hint">${esc(b.description)}</div>` : ''}
      </div>`;
  }).join('') || '<div class="bst-empty">No custom bars yet.</div>';
  return `
    <section class="bst-section">
      <h3 class="bst-section-h">Status</h3>
      <p class="bst-hint">Cast status bars (Health, Energy, Hard Mode needs) and custom bars. When Enable is off, Cast still keeps per-character Track toggles, but the condition injection is suppressed. Colors apply on Cast when Track is on.</p>
      <div class="bst-row">
        <label><input type="checkbox" data-trk="status.enabled" ${s.enabled ? 'checked' : ''}> Enable status tracking</label>
      </div>
      <div class="bst-field"><span>Built-in bar colors</span>
        <div class="bst-tracker-colors">${colorRows}</div>
      </div>
      <div class="bst-field"><span>Custom bars</span>
        <p class="bst-hint">Name, description/prompt for audits, and levels (expression label, amount only, or none).</p>
        ${customRows}
        <button type="button" class="bst-btn gold" data-action="custom-stat-add" style="margin-top:6px">+ Custom bar</button>
      </div>
      <div class="bst-field"><span>Difficulty (how much bars move)</span>
        <div class="bst-row">
          ${['soft', 'normal', 'hard'].map(d =>
            `<label class="bst-radio"><input type="radio" name="bst-trk-diff" data-trk="status.difficulty" value="${d}" ${s.difficulty === d ? 'checked' : ''}> ${esc(d)}</label>`).join('')}
        </div>
        <span class="bst-k">${s.difficulty === 'soft' ? 'Easier to recover · slower to worsen' : s.difficulty === 'hard' ? 'Easier to lose · harder to gain. Bladder/odor: worsening (fuller/smellier) hits harder than relief.' : 'Balanced. Bladder/odor count worsening, not the raw number.'}</span>
      </div>
      <label class="bst-field"><span>Auto In play looks back</span>
        <select data-trk="status.inPlayWindow">
          ${IN_PLAY_WINDOWS.map(n =>
            `<option value="${n}" ${s.inPlayWindow === n ? 'selected' : ''}>${n} msgs</option>`).join('')}
        </select>
      </label>
      <p class="bst-hint">Cast marked In play get status injects and receipts. This window is only how far Auto In play looks for a name. Manual Audit still files from Cast.</p>
    </section>`;
}

function connectionPane(t, esc) {
  const c = t.connection;
  return `
    <section class="bst-section">
      <h3 class="bst-section-h">Connection</h3>
      <p class="bst-hint">When on, Script cards that credit a character quietly log connection adds/drops and standing shifts as their Reputation web changes. Marks land for cast marked In play.</p>
      <div class="bst-row">
        <label><input type="checkbox" data-trk="connection.enabled" ${c.enabled ? 'checked' : ''}> Enable connection tracking</label>
      </div>
    </section>`;
}

function scenePane(t, esc, clap, seasonHint, { calendar = null, setDraft = null } = {}) {
  const r = t.receipt || {};
  const receiptBlock = `
    <section class="bst-section">
      <h3 class="bst-section-h">Receipt ticket</h3>
      <p class="bst-hint">Turn Receipt cards print kit, condition, and stat-title changes. Location and item quiet audits ride this same cadence. Per turn stamps the user post; per post / every N stamp the character post. Manual is the Cast toolbar Receipt button.</p>
      <div class="bst-row">
        <label><input type="checkbox" data-trk="receipt.enabled" ${r.enabled ? 'checked' : ''}> Enable receipt tracking</label>
      </div>
      <div class="bst-field"><span>When to print</span>
        <div class="bst-row">
          ${RECEIPT_CADENCES.map(c =>
            `<label class="bst-radio" title="${esc(c.tip)}"><input type="radio" name="bst-trk-receipt-cadence" data-trk="receipt.cadence" value="${c.id}" ${r.cadence === c.id ? 'checked' : ''} ${r.enabled ? '' : 'disabled'}> ${esc(c.label)}</label>`).join('')}
        </div>
        <label class="bst-field" style="margin-top:6px"${r.cadence === 'per_n' ? '' : ' hidden'}><span>N</span>
          <input type="number" min="1" max="40" data-trk="receipt.everyN" value="${esc(String(r.everyN || 4))}" ${r.enabled ? '' : 'disabled'}></label>
        <span class="bst-k">${esc(RECEIPT_CADENCES.find(c => c.id === r.cadence)?.tip || '')}</span>
      </div>
    </section>`;
  const s = t.scene;
  const setForm = s.enabled ? buildSceneSetFormHtml({
    esc,
    scene: s,
    calendar,
    draft: setDraft || {},
  }) : '';
  return `
    ${receiptBlock}
    <section class="bst-section">
      <h3 class="bst-section-h">Scene</h3>
      <p class="bst-hint">When on, a floating clapper lives outside the Showtime panel (drag / pin). Location shows the two most precise tags (shop + mall, not city + country). Headers update the board. Other cues wait on the clapper (Accept / Ignore). Set holds until the next header. Print slate in chat asks the model to emit a collapsible mini-clapper only when location, time, weather, a plot hook, an achievement, a secret, or a reputation shift changes.</p>
      <div class="bst-row">
        <label><input type="checkbox" data-trk="scene.enabled" ${s.enabled ? 'checked' : ''}> Scene board on</label>
        <label><input type="checkbox" data-trk="scene.printChatCard" ${s.printChatCard ? 'checked' : ''} ${s.enabled ? '' : 'disabled'}> Print slate in chat</label>
        <label><input type="checkbox" data-trk="scene.clapperPinned" ${s.clapperPinned ? 'checked' : ''} ${s.enabled ? '' : 'disabled'}> Pin clapper</label>
        <label><input type="checkbox" data-trk="scene.trackStar" ${s.trackStar ? 'checked' : ''} ${s.enabled ? '' : 'disabled'}> Soft-sync location into Composer on clap</label>
      </div>
      ${s.enabled ? `
      <div class="bst-row" style="margin-top:8px">
        <button type="button" class="bst-btn" data-action="scene-clap">Clap / refresh from last post</button>
        <button type="button" class="bst-btn" data-action="clap-show">Show floating clapper</button>
        ${s.weather ? `<button type="button" class="bst-btn" data-action="scene-weather-shift" title="Cycle weather for ${esc(seasonHint || 'current season')}">Shift weather</button>` : ''}
      </div>
      <div class="bst-field" style="margin-top:10px"><span>Set date / time</span>
        ${setForm}
        <span class="bst-k">Writes the clapper and Script present now, then holds. Clap re-reads the newest post. A · header line still auto-updates; next morning / occupancy wait for Accept.</span>
      </div>
      <p class="bst-hint">Last: <strong>${esc(clap?.location || s.lastLocationKey || '—')}</strong>${s.time ? ` · ${esc(clap?.time || s.lastTimeLabel || '')}` : ''}${s.date ? ` · ${esc(clap?.date || s.lastDateLabel || '')}` : ''}${s.weather ? ` · ${esc((clap?.weatherEmoji || s.weatherEmoji) + ' ' + (clap?.weatherLabel || s.weatherLabel))}` : ''}</p>` : ''}
      <div class="bst-field"><span>Track</span>
        <div class="bst-row">
          <label><input type="checkbox" data-trk="scene.time" ${s.time ? 'checked' : ''}> Time</label>
          <label><input type="checkbox" data-trk="scene.date" ${s.date ? 'checked' : ''}> Date</label>
          <label><input type="checkbox" data-trk="scene.weather" ${s.weather ? 'checked' : ''}> Weather</label>
        </div>
      </div>
      <div class="bst-field"><span>Timeline</span>
        <div class="bst-row">
          <label><input type="checkbox" data-trk="scene.followTimeline" ${s.followTimeline !== false ? 'checked' : ''} ${s.enabled ? '' : 'disabled'}> Follow Script timeline</label>
        </div>
        <span class="bst-k">When on and the board is not held, clap date can follow Script present. Held stamps stay until a header, Set, or Accept.</span>
      </div>
      <div class="bst-field"><span>Date parts</span>
        <div class="bst-row" style="flex-wrap:wrap">
          <label><input type="checkbox" data-trk="scene.dateParts.day" ${s.dateParts?.day !== false ? 'checked' : ''} ${s.date && s.enabled ? '' : 'disabled'}> Day</label>
          <label><input type="checkbox" data-trk="scene.dateParts.month" ${s.dateParts?.month !== false ? 'checked' : ''} ${s.date && s.enabled ? '' : 'disabled'}> Month</label>
          <label><input type="checkbox" data-trk="scene.dateParts.year" ${s.dateParts?.year !== false ? 'checked' : ''} ${s.date && s.enabled ? '' : 'disabled'}> Year</label>
          <label><input type="checkbox" data-trk="scene.dateParts.season" ${s.dateParts?.season ? 'checked' : ''} ${s.date && s.enabled ? '' : 'disabled'}> Season</label>
          <label><input type="checkbox" data-trk="scene.dateParts.seasonFuzzy" ${s.dateParts?.seasonFuzzy ? 'checked' : ''} ${s.date && s.enabled ? '' : 'disabled'}> Fuzzy season</label>
        </div>
        <span class="bst-k">e.g. Mid Spring · 14 Germinal · Y12 — whichever parts you enable.</span>
      </div>
      <div class="bst-field"><span>Time format</span>
        <div class="bst-row">
          ${TIME_MODES.map(m =>
            `<label class="bst-radio" title="${esc(m.tip)}"><input type="radio" name="bst-trk-time" data-trk="scene.timeMode" value="${m.id}" ${s.timeMode === m.id ? 'checked' : ''}> ${esc(m.label)}</label>`).join('')}
        </div>
        <span class="bst-k">${esc(TIME_MODES.find(m => m.id === s.timeMode)?.tip || '')}</span>
      </div>
      <p class="bst-hint">Date follows Script calendar labels${s.followTimeline !== false ? ' and timeline place' : ''}. Weather is an emoji + narrative line; Shift picks from the season pool.</p>
    </section>`;
}

function locationPane(t, esc) {
  const loc = t.location;
  return `
    <section class="bst-section">
      <h3 class="bst-section-h">Location</h3>
      <p class="bst-hint">How far Room Compass sonar / area reach scans from a standing area — and what Directors can pull via Stage location tags. Unmatched mentions collect under Places → Unlisted. Quiet place audits run on Receipt cadence when this is on.</p>
      <div class="bst-row">
        <label><input type="checkbox" data-trk="location.enabled" ${loc.enabled ? 'checked' : ''}> Enable location tracking</label>
      </div>
      <div class="bst-field"><span>Sonar reach</span>
        <div class="bst-row bst-stack">
          ${SONAR_REACH.map(r => `
            <label class="bst-radio" title="${esc(r.tip)}">
              <input type="radio" name="bst-trk-reach" data-trk="location.sonarReach" value="${r.id}" ${loc.sonarReach === r.id ? 'checked' : ''}>
              ${esc(r.label)}
              <span class="bst-k">${esc(r.tip)}</span>
            </label>`).join('')}
        </div>
      </div>
    </section>`;
}

function itemsPane(t, esc) {
  const it = t.items;
  return `
    <section class="bst-section">
      <h3 class="bst-section-h">Items</h3>
      <p class="bst-hint">Inventory mechanics — who may use, craft, or delete items, and what Director events may touch. Quiet used/added/moved audits run on Receipt cadence when this is on.</p>
      <div class="bst-row">
        <label><input type="checkbox" data-trk="items.enabled" ${it.enabled ? 'checked' : ''}> Enable item tracking</label>
      </div>
      <div class="bst-field"><span>Cast / Star</span>
        <div class="bst-row">
          <label><input type="checkbox" data-trk="items.castCanUse" ${it.castCanUse ? 'checked' : ''}> Use / offer / force / give items (self or on cast)</label>
          <label><input type="checkbox" data-trk="items.castCanCraft" ${it.castCanCraft ? 'checked' : ''}> Make / add items</label>
          <label><input type="checkbox" data-trk="items.castCanDelete" ${it.castCanDelete ? 'checked' : ''}> Delete items</label>
          <label><input type="checkbox" data-trk="items.npcCanOffer" ${it.npcCanOffer ? 'checked' : ''}> Cast may offer/use/force/give items on you (auto-detected from their messages)</label>
        </div>
      </div>
      <div class="bst-field"><span>Director events</span>
        <div class="bst-row">
          <label><input type="checkbox" data-trk="items.directorCanSee" ${it.directorCanSee ? 'checked' : ''}> See inventory in briefs</label>
          <label><input type="checkbox" data-trk="items.directorCanMutate" ${it.directorCanMutate ? 'checked' : ''}> May remove / change items not on the player</label>
        </div>
      </div>
    </section>`;
}

function motivationPane(t, esc) {
  const m = t.motivation;
  return `
    <section class="bst-section">
      <h3 class="bst-section-h">Motivation</h3>
      <p class="bst-hint">Narrative sonar for Motivation — auto-detects when a filed secret gets out or a beat's payoff plays out, and queues it for you to confirm. Nothing unlocks or flips without a click.</p>
      <div class="bst-row">
        <label><input type="checkbox" data-trk="motivation.enabled" ${m.enabled ? 'checked' : ''}> Enable Motivation tracking</label>
      </div>
      <div class="bst-field"><span>Narrative sonar</span>
        <div class="bst-row">
          <label><input type="checkbox" data-trk="motivation.secretsSonar" ${m.secretsSonar ? 'checked' : ''} ${m.enabled ? '' : 'disabled'}> Flag secrets that appear to get revealed</label>
          <label><input type="checkbox" data-trk="motivation.achievementsSonar" ${m.achievementsSonar ? 'checked' : ''} ${m.enabled ? '' : 'disabled'}> Flag beats whose payoff appears to happen</label>
        </div>
        <label class="bst-field" style="margin-top:6px"><span>Check beats every</span>
          <input type="number" min="1" max="40" data-trk="motivation.scanEveryN" value="${esc(String(m.scanEveryN))}" ${m.enabled && m.achievementsSonar ? '' : 'disabled'}> messages
        </label>
      </div>
      <p class="bst-hint">Secret reveals are checked on every message (cheap keyword gate first). Beat payoffs use a broader read of the recent scene, so they're checked every N messages instead. Both only ever propose — accept or dismiss from the Motivation panel. Secret learners can be cast members or Affiliations (houses). Quiet prompts use the Backstage → Settings → Motivation connection profile when set.</p>
    </section>`;
}
