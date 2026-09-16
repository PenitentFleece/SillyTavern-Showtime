// Studio Trackers — config schema + Backstage Trackers shelf HTML.

import {
  formatSceneDate,
  normalizeDateParts,
  DEFAULT_DATE_PARTS,
} from './calendarTime.js';

export const TRACKER_PANES = Object.freeze([
  { id: 'status', label: 'Status' },
  { id: 'connection', label: 'Connection' },
  { id: 'scene', label: 'Scene' },
  { id: 'location', label: 'Location' },
  { id: 'items', label: 'Items' },
  { id: 'motivation', label: 'Motivation' },
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
      lastDateLabel: '',
      clapperPinned: false,
      clapperHidden: false,
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
  scene.lastDateLabel = String(scene.lastDateLabel || '').trim();
  scene.lastClapAt = Number(scene.lastClapAt) || 0;
  scene.clapperPinned = !!scene.clapperPinned;
  scene.clapperHidden = !!scene.clapperHidden;

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

  return { pane, status, connection, scene, location, items, motivation };
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
export function formatTrackerTimeFromHour(mode, hour, hoursPerDay = 24) {
  const hpd = Math.max(1, Number(hoursPerDay) || 24);
  let h = Number(hour);
  if (!Number.isFinite(h)) return '';
  h = ((Math.floor(h) % hpd) + hpd) % hpd;
  if (mode === 'precise') {
    return `${String(h).padStart(2, '0')}:00`;
  }
  if (mode === 'simple') {
    if (hpd !== 24) return `Hour ${h}`;
    const ap = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return `${h12}:00 ${ap}`;
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
 * @param {object} trackers normalized
 * @param {{ esc: Function, clap?: object, seasonHint?: string }} opts
 */
export function buildTrackersHtml(trackers, { esc, clap = null, seasonHint = '' } = {}) {
  const t = normalizeTrackers(trackers);
  const pane = t.pane;
  const tabs = TRACKER_PANES.map(p =>
    `<button type="button" class="bst-btn${pane === p.id ? ' gold' : ''}" data-action="tracker-pane" data-pane="${p.id}">${esc(p.label)}</button>`).join('');

  let body = '';
  if (pane === 'status') body = statusPane(t, esc);
  else if (pane === 'connection') body = connectionPane(t, esc);
  else if (pane === 'scene') body = scenePane(t, esc, clap, seasonHint);
  else if (pane === 'location') body = locationPane(t, esc);
  else if (pane === 'items') body = itemsPane(t, esc);
  else if (pane === 'motivation') body = motivationPane(t, esc);

  return `
    <h2 class="bst-pane-title">Trackers</h2>
    <p class="bst-pane-sub">Central dials for Status, Connection, Scene, Location, and Items. Cast / Reputation / Inventory still own the live meters — these settings steer how they behave.</p>
    <section class="bst-section">
      <h3 class="bst-section-h">Tracker</h3>
      <div class="bst-row bst-tracker-tabs">${tabs}</div>
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
      <div class="bst-field"><span>When to track</span>
        <div class="bst-row">
          <label class="bst-radio"><input type="radio" name="bst-trk-cadence" data-trk="status.cadence" value="per_post" ${s.cadence === 'per_post' ? 'checked' : ''}> Per post</label>
          <label class="bst-radio"><input type="radio" name="bst-trk-cadence" data-trk="status.cadence" value="per_n" ${s.cadence === 'per_n' ? 'checked' : ''}> Every N posts</label>
          <label class="bst-radio"><input type="radio" name="bst-trk-cadence" data-trk="status.cadence" value="manual" ${s.cadence === 'manual' ? 'checked' : ''}> Manual only</label>
        </div>
        <label class="bst-field" style="margin-top:6px"${s.cadence === 'per_n' ? '' : ' hidden'}><span>N</span>
          <input type="number" min="1" max="40" data-trk="status.everyN" value="${esc(String(s.everyN))}"></label>
      </div>
      <div class="bst-field"><span>Difficulty (how much bars move)</span>
        <div class="bst-row">
          ${['soft', 'normal', 'hard'].map(d =>
            `<label class="bst-radio"><input type="radio" name="bst-trk-diff" data-trk="status.difficulty" value="${d}" ${s.difficulty === d ? 'checked' : ''}> ${esc(d)}</label>`).join('')}
        </div>
      </div>
      <div class="bst-row">
        <label><input type="checkbox" data-trk="status.offScreen" ${s.offScreen ? 'checked' : ''}> Off-screen changes</label>
        <label class="bst-field" style="margin:0"><span>In play = message within last</span>
          <select data-trk="status.inPlayWindow">
            ${IN_PLAY_WINDOWS.map(n =>
              `<option value="${n}" ${s.inPlayWindow === n ? 'selected' : ''}>${n} msgs</option>`).join('')}
          </select>
        </label>
      </div>
      <p class="bst-hint">Off-screen off → status only updates for cast with a message in the in-play window.</p>
    </section>`;
}

function connectionPane(t, esc) {
  const c = t.connection;
  return `
    <section class="bst-section">
      <h3 class="bst-section-h">Connection</h3>
      <p class="bst-hint">Steers future Reputation Connections automation (standing shifts). Settings are stored now; auto standing updates land in a later pass.</p>
      <div class="bst-row">
        <label><input type="checkbox" data-trk="connection.enabled" ${c.enabled ? 'checked' : ''}> Enable connection tracking</label>
        <label><input type="checkbox" data-trk="connection.autoUpdate" ${c.autoUpdate ? 'checked' : ''}> Auto-update relationships</label>
        <label><input type="checkbox" data-trk="connection.offScreen" ${c.offScreen ? 'checked' : ''}> Off-screen changes</label>
      </div>
      <div class="bst-field"><span>Relationship difficulty</span>
        <div class="bst-row">
          ${['soft', 'normal', 'hard'].map(d =>
            `<label class="bst-radio"><input type="radio" name="bst-trk-rel-diff" data-trk="connection.difficulty" value="${d}" ${c.difficulty === d ? 'checked' : ''}> ${esc(d)}</label>`).join('')}
        </div>
        <span class="bst-k">${c.difficulty === 'soft' ? 'Bonds hold easily' : c.difficulty === 'hard' ? 'Neglect frays ties quickly' : 'Balanced maintenance'}</span>
      </div>
      <label class="bst-field"><span>In play window</span>
        <select data-trk="connection.inPlayWindow">
          ${IN_PLAY_WINDOWS.map(n =>
            `<option value="${n}" ${c.inPlayWindow === n ? 'selected' : ''}>${n} msgs</option>`).join('')}
        </select>
      </label>
    </section>`;
}

function scenePane(t, esc, clap, seasonHint) {
  const s = t.scene;
  return `
    <section class="bst-section">
      <h3 class="bst-section-h">Scene</h3>
      <p class="bst-hint">When on, a floating clapper lives outside the Showtime panel (drag / pin). It follows the latest location key plus Time, Date, and Weather.</p>
      <div class="bst-row">
        <label><input type="checkbox" data-trk="scene.enabled" ${s.enabled ? 'checked' : ''}> Scene board on</label>
        <label><input type="checkbox" data-trk="scene.clapperPinned" ${s.clapperPinned ? 'checked' : ''} ${s.enabled ? '' : 'disabled'}> Pin clapper</label>
        <label><input type="checkbox" data-trk="scene.trackStar" ${s.trackStar ? 'checked' : ''} ${s.enabled ? '' : 'disabled'}> Soft-sync location into Composer on clap</label>
      </div>
      ${s.enabled ? `
      <div class="bst-row" style="margin-top:8px">
        <button type="button" class="bst-btn gold" data-action="scene-clap">Clap / refresh from last post</button>
        <button type="button" class="bst-btn" data-action="clap-show">Show floating clapper</button>
        ${s.weather ? `<button type="button" class="bst-btn" data-action="scene-weather-shift" title="Cycle weather for ${esc(seasonHint || 'current season')}">Shift weather</button>` : ''}
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
        <span class="bst-k">When on, clap date uses the selected / locked Script scene (or domain midpoint).</span>
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
      <p class="bst-hint">How far Room Compass sonar / area reach scans from a standing area — and what Directors can pull via Stage location tags.</p>
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
      <p class="bst-hint">Inventory mechanics — who may use, craft, or delete items, and what Director events may touch.</p>
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
