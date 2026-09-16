// Chat-facing tracker scan + compact inject helpers.
// Scans recent play messages for location/weather/time cues and keeps
// prompt blocks short so always-on injections stay token-light.

import { getCastMembers, getStarMember } from './castCatalog.js';
import { parseWeatherToken, formatTrackerTimeFromHour } from './trackersConfig.js';
import { standingToward } from './motivationCatalog.js';

export const CHAT_SCAN_DEPTH = 8;

export function recentPlayMessages(chat, n = CHAT_SCAN_DEPTH) {
  const list = Array.isArray(chat) ? chat : [];
  const depth = Math.max(1, Number(n) || CHAT_SCAN_DEPTH);
  return list.filter(m => m && !m.is_system).slice(-depth);
}

export function haystackText(chat, n = CHAT_SCAN_DEPTH) {
  return recentPlayMessages(chat, n).map(m => String(m?.mes || '')).join('\n');
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
  for (const c of TIME_CUES) {
    if (c.re.test(raw)) return { fuzzy: c.fuzzy, hour: c.hour };
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
 * Does not invent wall-clock time. Timeline-followed time is left alone
 * unless the sheet has no time label yet.
 */
export function applySceneCuesFromChat(scene, chat) {
  if (!scene || typeof scene !== 'object') return { changed: false };
  const text = haystackText(chat, CHAT_SCAN_DEPTH);
  if (!text.trim()) return { changed: false };
  let changed = false;

  if (scene.weather !== false) {
    const wx = scanWeatherCue(text);
    if (wx && (wx.label !== scene.weatherLabel || wx.emoji !== scene.weatherEmoji)) {
      scene.weatherEmoji = wx.emoji;
      scene.weatherLabel = wx.label;
      changed = true;
    }
  }

  if (scene.time !== false) {
    const follow = scene.followTimeline !== false;
    const t = scanTimeCue(text);
    if (t?.fuzzy && (!follow || !scene.lastTimeLabel)) {
      const label = scene.timeMode === 'fuzzy'
        ? t.fuzzy
        : (formatTrackerTimeFromHour(scene.timeMode, t.hour) || t.fuzzy);
      if (label && label !== scene.lastTimeLabel) {
        scene.lastTimeLabel = label;
        changed = true;
      }
    }
  }

  return { changed };
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

export function scanStatusCues(text) {
  const raw = String(text || '');
  const notes = [];
  for (const c of STATUS_CUES) {
    if (c.re.test(raw)) notes.push(c.note);
  }
  return [...new Set(notes)];
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
  const cues = scanStatusCues(text);
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
