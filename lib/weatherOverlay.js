// Ambient weather overlay — visual FX inspired by xo-nara/st-weather-overlay,
// driven by Showtime Scene tracker (weather + time) instead of chat [wx:] tags.
// https://github.com/xo-nara/st-weather-overlay

export const OVERLAY_ID = 'st-wx-overlay';
export const STYLE_ID = 'st-wx-style';
export const AUDIO_ID = 'st-wx-audio';

export const PRECIP = Object.freeze(['none', 'rain', 'storm', 'snow']);
export const INTENSITY = Object.freeze(['light', 'heavy']);
export const WIND = Object.freeze(['calm', 'breezy', 'strong']);
export const LIGHT = Object.freeze(['dawn', 'day', 'dusk', 'night']);

export const TEST_PRESETS = Object.freeze({
  day: { icon: '☀️', label: 'Day', st: { precip: 'none', intensity: 'light', wind: 'calm', light: 'day' } },
  dawn: { icon: '🌅', label: 'Dawn', st: { precip: 'none', intensity: 'light', wind: 'calm', light: 'dawn' } },
  dusk: { icon: '🌆', label: 'Dusk', st: { precip: 'none', intensity: 'light', wind: 'calm', light: 'dusk' } },
  night: { icon: '🌙', label: 'Night', st: { precip: 'none', intensity: 'light', wind: 'calm', light: 'night' } },
  windy: { icon: '💨', label: 'Windy', st: { precip: 'none', intensity: 'light', wind: 'strong', light: 'day' } },
  rainL: { icon: '🌦️', label: 'Light Rain', st: { precip: 'rain', intensity: 'light', wind: 'calm', light: 'day' } },
  rainH: { icon: '🌧️', label: 'Heavy Rain', st: { precip: 'rain', intensity: 'heavy', wind: 'breezy', light: 'night' } },
  storm: { icon: '⛈️', label: 'Storm', st: { precip: 'storm', intensity: 'heavy', wind: 'strong', light: 'night' } },
  snowL: { icon: '🌨️', label: 'Light Snow', st: { precip: 'snow', intensity: 'light', wind: 'calm', light: 'day' } },
  snowH: { icon: '❄️', label: 'Heavy Snow', st: { precip: 'snow', intensity: 'heavy', wind: 'breezy', light: 'night' } },
  fog: { icon: '🌫', label: 'Fog', st: { precip: 'none', intensity: 'light', wind: 'calm', light: 'day', fog: true } },
});

export const EXPOSURE = Object.freeze(['auto', 'exposed', 'sheltered']);
/** Sound-effect slots — the overlay plays whichever matches the live state. */
export const SFX_KEYS = Object.freeze(['rain', 'storm', 'snow', 'wind', 'ambient']);

export function defaultAudio() {
  return {
    enabled: false,
    playWhenSheltered: true, // when sheltered, keep playing but muffled/quieter
    volume: 60,              // 0–100 master
    tracks: { rain: '', storm: '', snow: '', wind: '', ambient: '' },
  };
}

export function defaultEffects() {
  return {
    enabled: true,
    liteMode: false,
    forceMotion: true,
    particleSpeed: 100,
    freeMode: false,
    // 'auto' follows the active room's exposed/sheltered flag; the other two
    // force it. Sheltered turns full-screen precipitation into a through-a-
    // window effect (droplets/flakes catching and sliding on the glass).
    exposure: 'auto',
    audio: defaultAudio(),
    manual: { precip: 'none', intensity: 'light', wind: 'calm', light: 'day', fog: false },
  };
}

export function normalizeAudio(raw) {
  const d = defaultAudio();
  const v = raw && typeof raw === 'object' ? raw : {};
  const tracks = { ...d.tracks };
  if (v.tracks && typeof v.tracks === 'object') {
    for (const k of SFX_KEYS) {
      if (typeof v.tracks[k] === 'string') tracks[k] = v.tracks[k].trim();
    }
  }
  const vol = Number(v.volume);
  return {
    enabled: !!v.enabled,
    playWhenSheltered: v.playWhenSheltered !== false,
    volume: Number.isFinite(vol) ? Math.min(100, Math.max(0, vol)) : 60,
    tracks,
  };
}

export function normalizeEffects(raw) {
  const d = defaultEffects();
  const v = raw && typeof raw === 'object' ? raw : {};
  const manual = { ...d.manual, ...(v.manual && typeof v.manual === 'object' ? v.manual : {}) };
  if (!PRECIP.includes(manual.precip)) manual.precip = 'none';
  if (!INTENSITY.includes(manual.intensity)) manual.intensity = 'light';
  if (!WIND.includes(manual.wind)) manual.wind = 'calm';
  if (!LIGHT.includes(manual.light)) manual.light = 'day';
  manual.fog = !!manual.fog;
  const speed = Number(v.particleSpeed);
  return {
    enabled: v.enabled !== false,
    liteMode: !!v.liteMode,
    forceMotion: v.forceMotion !== false,
    particleSpeed: Number.isFinite(speed) ? Math.min(200, Math.max(25, speed)) : 100,
    freeMode: !!v.freeMode,
    exposure: EXPOSURE.includes(v.exposure) ? v.exposure : 'auto',
    audio: normalizeAudio(v.audio),
    manual,
  };
}

/**
 * Resolve the effective sheltered state.
 * @param {object} fx normalized effects
 * @param {boolean} roomExposed whether the active room is flagged "exposed"
 * @returns {boolean} true when the overlay should render as through-a-window
 */
export function resolveSheltered(fx, roomExposed) {
  if (fx.exposure === 'exposed') return false;
  if (fx.exposure === 'sheltered') return true;
  // auto: a room explicitly flagged exposed is open to the sky; otherwise it's
  // indoors/sheltered.
  return !roomExposed;
}

/**
 * Map Scene tracker weather + time labels into overlay state.
 * @param {{ weatherEmoji?: string, weatherLabel?: string, weather?: boolean, lastTimeLabel?: string, time?: boolean }} scene
 */
export function sceneTrackerToWx(scene = {}) {
  const weatherOn = scene.weather !== false;
  const blob = weatherOn
    ? `${scene.weatherEmoji || ''} ${scene.weatherLabel || ''}`.toLowerCase()
    : '';
  const timeBlob = scene.time !== false
    ? String(scene.lastTimeLabel || '').toLowerCase()
    : '';

  let precip = 'none';
  if (/storm|thunder|lightning|⚡|⛈/.test(blob)) precip = 'storm';
  else if (/snow|flurr|❄|🌨|ice|bitter|blizzard/.test(blob)) precip = 'snow';
  else if (/rain|shower|drizzle|🌧|🌦|downpour/.test(blob)) precip = 'rain';

  let intensity = 'light';
  if (precip === 'storm' || /heavy|bitter|blizzard|downpour|gusty|hot/.test(blob)) intensity = 'heavy';
  if (/flurr|mist|drizzle|shower|fair|clear|crisp/.test(blob) && precip !== 'storm') intensity = 'light';

  let wind = 'calm';
  if (/storm|gust|windy|🌬|💨|strong wind/.test(blob)) wind = 'strong';
  else if (/breez|wind|hazy|gusty/.test(blob)) wind = precip === 'storm' ? 'strong' : 'breezy';

  let light = 'day';
  if (/night|midnight|late\s*night/.test(timeBlob)) light = 'night';
  else if (/dusk|evening|sunset|twilight|golden hour/.test(timeBlob)) light = 'dusk';
  else if (/dawn|sunrise|early\s*morning/.test(timeBlob)) light = 'dawn';
  else if (/afternoon|noon|midday|day|late\s*morning|mid\s*morning|morning/.test(timeBlob)) light = 'day';
  else if (/evening/.test(timeBlob)) light = 'dusk';
  // Weather-only cues when time blank
  if (!timeBlob) {
    if (/night|🌙/.test(blob)) light = 'night';
    else if (/golden|dusk|sunset|🌆/.test(blob)) light = 'dusk';
    else if (/dawn|🌅/.test(blob)) light = 'dawn';
  }

  const fog = /fog|mist|haze|🌫|overcast|☁/.test(blob) && precip === 'none';

  return { precip, intensity, wind, light, fog };
}

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = `
#${OVERLAY_ID}{position:fixed!important;top:0!important;left:0!important;width:100vw!important;height:100vh!important;height:100dvh!important;pointer-events:none!important;z-index:35!important;overflow:hidden!important}
#${OVERLAY_ID} *{pointer-events:none!important}
#${OVERLAY_ID} .st-wx-tint{position:absolute;inset:0;transition:background 1.2s ease}
@keyframes st-wxfall{to{transform:translateY(112vh)}}
@keyframes st-wxsnow{0%{transform:translateY(-6vh) translateX(0) rotate(0)}50%{transform:translateY(52vh) translateX(16px) rotate(180deg)}100%{transform:translateY(112vh) translateX(-8px) rotate(360deg)}}
@keyframes st-wxgust{0%{transform:translateX(-30vw) skewX(-6deg);opacity:0}20%{opacity:.55}100%{transform:translateX(125vw) skewX(-6deg);opacity:0}}
@keyframes st-wxray{0%,100%{opacity:.10}50%{opacity:.24}}
@keyframes st-wxfog{0%,100%{transform:translateX(-6%);opacity:.16}50%{transform:translateX(6%);opacity:.30}}
/* Sheltered "through a window" effects — a droplet clings, then races down the
   glass leaving a faint trail; flakes drift slowly outside the pane. */
@keyframes st-wxdrip{0%{transform:translateY(0);opacity:0}8%{opacity:.85}18%{transform:translateY(4px)}100%{transform:translateY(var(--drip,40vh));opacity:0}}
@keyframes st-wxbead{0%,100%{opacity:.5;transform:translateY(0)}50%{opacity:.8;transform:translateY(2px)}}
@keyframes st-wxdrift{0%{transform:translate(0,-4vh);opacity:0}12%{opacity:.7}100%{transform:translate(var(--dx,10px),108vh);opacity:.15}}
#${OVERLAY_ID} .st-wx-glass{position:absolute;inset:0;box-shadow:inset 0 0 90px rgba(120,140,170,.28),inset 0 0 24px rgba(255,255,255,.06);backdrop-filter:blur(.4px)}
#${OVERLAY_ID} .st-wx-glass::before{content:"";position:absolute;inset:0;background:radial-gradient(140% 120% at 50% 0%,transparent 62%,rgba(90,110,140,.16));}
`;
  document.head.appendChild(s);
}

function el(css) {
  const d = document.createElement('div');
  d.style.cssText = css;
  return d;
}

function stratifiedPositions(n) {
  const out = [];
  const bw = 100 / Math.max(1, n);
  for (let i = 0; i < n; i++) out.push(Math.min(99, bw * i + Math.random() * bw));
  return out;
}

export function clearWeatherOverlay() {
  const o = document.getElementById(OVERLAY_ID);
  if (!o) return;
  if (Array.isArray(o._t)) o._t.forEach(clearInterval);
  o.remove();
}

/**
 * Through-a-window rendering for sheltered spaces: precipitation clings to and
 * slides down the glass instead of falling across the whole screen.
 */
function paintShelteredWindow(o, st, { lite = false, spd = 1 } = {}) {
  const { precip, intensity, light } = st;
  const fog = !!st.fog;

  const glass = el('');
  glass.className = 'st-wx-glass';
  o.appendChild(glass);

  if (precip === 'rain' || precip === 'storm') {
    // Running drips (race down the pane).
    let drips = intensity === 'heavy' || precip === 'storm' ? 16 : 9;
    if (lite) drips = Math.max(3, Math.round(drips / 3));
    const xs = stratifiedPositions(drips);
    for (let i = 0; i < drips; i++) {
      const top = Math.random() * 55;
      const run = (18 + Math.random() * 40).toFixed(0);
      const dur = ((2.2 + Math.random() * 2.6) * spd).toFixed(2);
      const w = (1.5 + Math.random() * 1.5).toFixed(1);
      o.appendChild(el(
        `position:absolute;top:${top}%;left:${xs[i]}%;width:${w}px;height:${8 + Math.random() * 14}px;`
        + `border-radius:60% 60% 60% 60%/70% 70% 40% 40%;`
        + `background:linear-gradient(rgba(200,220,245,.65),rgba(170,195,225,.35));`
        + `--drip:${run}vh;animation:st-wxdrip ${dur}s ease-in ${(-Math.random() * dur).toFixed(2)}s infinite backwards`,
      ));
    }
    // Clinging beads (wobble in place — condensation on the glass).
    let beads = intensity === 'heavy' ? 26 : 16;
    if (lite) beads = Math.max(5, Math.round(beads / 3));
    for (let i = 0; i < beads; i++) {
      const sz = (2 + Math.random() * 4).toFixed(1);
      const dur = (2 + Math.random() * 3).toFixed(2);
      o.appendChild(el(
        `position:absolute;top:${Math.random() * 96}%;left:${Math.random() * 98}%;width:${sz}px;height:${sz}px;border-radius:50%;`
        + `background:radial-gradient(circle at 35% 30%,rgba(255,255,255,.7),rgba(180,200,225,.3));`
        + `animation:st-wxbead ${dur}s ease-in-out ${(-Math.random() * dur).toFixed(2)}s infinite`,
      ));
    }
    if (precip === 'storm') {
      const f = el('position:absolute;inset:0;background:radial-gradient(80% 60% at 50% 0%,rgba(255,255,255,.6),transparent 70%);opacity:0;transition:opacity .12s');
      o.appendChild(f);
      o._t.push(setInterval(() => {
        f.style.opacity = '.28';
        setTimeout(() => { f.style.opacity = '0'; }, 90);
      }, 5200 + Math.random() * 5200));
    }
  } else if (precip === 'snow') {
    // Flakes drift slowly *outside* the pane (blurred, unhurried) + corner frost.
    let n = intensity === 'heavy' ? 14 : 9;
    if (lite) n = Math.max(3, Math.round(n / 3));
    const xs = stratifiedPositions(n);
    for (let i = 0; i < n; i++) {
      const sz = 3 + Math.random() * 4;
      const dur = ((7 + Math.random() * 5) * spd).toFixed(2);
      const dx = (Math.random() * 24 - 12).toFixed(0);
      o.appendChild(el(
        `position:absolute;top:-6vh;left:${xs[i]}%;width:${sz}px;height:${sz}px;border-radius:50%;`
        + `background:rgba(255,255,255,${(0.4 + Math.random() * 0.3).toFixed(2)});filter:blur(.6px);`
        + `--dx:${dx}px;animation:st-wxdrift ${dur}s linear ${(-Math.random() * dur).toFixed(2)}s infinite backwards`,
      ));
    }
    o.appendChild(el('position:absolute;inset:0;background:'
      + 'radial-gradient(60% 40% at 0% 0%,rgba(230,240,255,.28),transparent 60%),'
      + 'radial-gradient(60% 40% at 100% 0%,rgba(230,240,255,.28),transparent 60%),'
      + 'radial-gradient(70% 40% at 0% 100%,rgba(230,240,255,.22),transparent 62%),'
      + 'radial-gradient(70% 40% at 100% 100%,rgba(230,240,255,.22),transparent 62%)'));
  }

  if (fog || precip === 'none') {
    // Light condensation so a calm sheltered view still reads as "indoors".
    o.appendChild(el('position:absolute;inset:0;background:radial-gradient(120% 90% at 50% 110%,rgba(210,220,235,.16),transparent 60%);animation:st-wxfog 12s ease-in-out infinite backwards'));
  }
}

/**
 * @param {{ precip: string, intensity: string, wind: string, light: string, fog?: boolean }} st
 * @param {{ liteMode?: boolean, forceMotion?: boolean, particleSpeed?: number }} opts
 */
export function paintWeatherOverlay(st, opts = {}) {
  ensureStyle();
  clearWeatherOverlay();
  if (!st) return;

  const lite = !!opts.liteMode;
  const forceMotion = opts.forceMotion !== false;
  const reduced = !forceMotion && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const spd = 100 / (Number(opts.particleSpeed) || 100);
  const sheltered = !!opts.sheltered;

  const o = document.createElement('div');
  o.id = OVERLAY_ID;
  o._t = [];
  if (sheltered) o.dataset.sheltered = '1';
  (document.documentElement || document.body).appendChild(o);

  const { precip, intensity, wind, light } = st;
  const fog = !!st.fog;

  const tint = el('position:absolute;inset:0;transition:background 1.2s ease');
  tint.className = 'st-wx-tint';
  tint.style.background =
    light === 'night' ? 'radial-gradient(130% 100% at 50% 0%, transparent 40%, rgba(4,7,22,.55))'
      : light === 'dusk' ? 'linear-gradient(180deg, rgba(70,25,12,.14), transparent 55%)'
        : light === 'dawn' ? 'linear-gradient(180deg, rgba(255,208,138,.15), transparent 58%)'
          : 'transparent';
  o.appendChild(tint);

  if (reduced) return;

  // Sheltered → render precipitation as if seen (and caught) on a window pane,
  // then bail out of the open-air particle system below.
  if (sheltered) {
    paintShelteredWindow(o, st, { lite, spd });
    return;
  }

  const skew = wind === 'strong' ? 'skewX(-16deg)' : wind === 'breezy' ? 'skewX(-7deg)' : '';

  if (precip === 'rain' || precip === 'storm') {
    let far = intensity === 'heavy' ? 14 : 8;
    let near = intensity === 'heavy' ? 10 : 6;
    if (lite) { far = Math.max(2, Math.round(far / 3)); near = Math.max(2, Math.round(near / 3)); }
    const farPos = stratifiedPositions(far);
    const nearPos = stratifiedPositions(near);
    for (let i = 0; i < far; i++) {
      const dur = ((0.9 + Math.random() * 0.4) * spd).toFixed(2);
      o.appendChild(el(
        `position:absolute;top:-12vh;left:${farPos[i]}%;width:2px;height:${12 + Math.random() * 10}px;`
        + `background:linear-gradient(transparent,rgba(170,190,220,.5));transform:${skew};`
        + `animation:st-wxfall ${dur}s linear ${(-Math.random() * dur).toFixed(2)}s infinite backwards`,
      ));
    }
    for (let i = 0; i < near; i++) {
      const dur = ((0.45 + Math.random() * 0.25) * spd).toFixed(2);
      o.appendChild(el(
        `position:absolute;top:-12vh;left:${nearPos[i]}%;width:3px;height:${22 + Math.random() * 14}px;`
        + `background:linear-gradient(transparent,rgba(200,218,245,.75));transform:${skew};`
        + `animation:st-wxfall ${dur}s linear ${(-Math.random() * dur).toFixed(2)}s infinite backwards`
        + (lite ? '' : ';filter:blur(.3px)'),
      ));
    }
    if (precip === 'storm') {
      o.appendChild(el('position:absolute;inset:0;box-shadow:inset 0 0 120px rgba(0,0,10,.5)'));
      const f = el('position:absolute;inset:0;background:radial-gradient(80% 60% at 50% 0%,#fff,transparent 70%);opacity:0;transition:opacity .1s');
      o.appendChild(f);
      o._t.push(setInterval(() => {
        f.style.opacity = '.4';
        setTimeout(() => { f.style.opacity = '0'; }, 80);
        setTimeout(() => {
          f.style.opacity = '.22';
          setTimeout(() => { f.style.opacity = '0'; }, 60);
        }, 180);
      }, 4200 + Math.random() * 4800));
    }
  } else if (precip === 'snow') {
    let n = intensity === 'heavy' ? 18 : 12;
    if (lite) n = Math.max(3, Math.round(n / 3));
    const snowPos = stratifiedPositions(n);
    for (let i = 0; i < n; i++) {
      const dur = ((3.4 + Math.random() * 2.4) * spd).toFixed(2);
      const sz = 3 + Math.random() * 4;
      o.appendChild(el(
        `position:absolute;top:-8vh;left:${snowPos[i]}%;width:${sz}px;height:${sz}px;border-radius:50%;`
        + `background:rgba(255,255,255,${(0.55 + Math.random() * 0.3).toFixed(2)});`
        + `box-shadow:0 0 ${sz}px rgba(255,255,255,.5);`
        + `animation:st-wxsnow ${dur}s linear ${(-Math.random() * dur).toFixed(2)}s infinite backwards`,
      ));
    }
  }

  if (precip === 'none' && light === 'day' && !fog) {
    o.appendChild(el('position:absolute;top:-14%;right:-8%;width:70vw;height:70vw;background:radial-gradient(circle at 78% 18%, rgba(255,228,165,.18), transparent 55%);animation:st-wxray 6s ease-in-out infinite backwards'));
    o.appendChild(el('position:absolute;top:0;right:10%;width:32vw;height:3px;background:linear-gradient(90deg,transparent,rgba(255,235,180,.12),transparent);transform:rotate(24deg);transform-origin:right top;animation:st-wxray 7s ease-in-out .8s infinite backwards'));
  }
  if (light === 'dawn' || light === 'dusk') {
    o.appendChild(el(
      `position:absolute;bottom:-6%;left:0;right:0;height:34%;background:linear-gradient(0deg,${
        light === 'dawn' ? 'rgba(255,190,120,.10)' : 'rgba(180,80,50,.10)'
      },transparent);animation:st-wxfog 9s ease-in-out infinite backwards`,
    ));
  }
  if (fog) {
    o.appendChild(el('position:absolute;inset:0;background:linear-gradient(180deg,rgba(200,210,220,.22),rgba(180,190,200,.12) 40%,transparent 70%);animation:st-wxfog 11s ease-in-out infinite backwards'));
    o.appendChild(el('position:absolute;inset:10% 0 0;background:radial-gradient(120% 60% at 50% 100%,rgba(210,215,220,.28),transparent 65%);animation:st-wxfog 14s ease-in-out .6s infinite backwards'));
  }
  if (wind === 'strong' || wind === 'breezy') {
    const isStrong = wind === 'strong';
    let gustCount = isStrong ? 3 : 2;
    if (lite) gustCount = 1;
    for (let i = 0; i < gustCount; i++) {
      const durBase = isStrong ? (1.6 + Math.random() * 0.8) : (2.8 + Math.random() * 1.2);
      const dur = (durBase * spd).toFixed(2);
      const width = isStrong ? 28 : 18;
      const alpha = isStrong ? '.55' : '.32';
      o.appendChild(el(
        `position:absolute;top:${18 + i * 26}%;left:0;width:${width}vw;height:1.5px;border-radius:999px;`
        + `background:linear-gradient(90deg,transparent,rgba(220,228,240,${alpha}),transparent);`
        + `animation:st-wxgust ${dur}s linear ${(-Math.random() * dur).toFixed(2)}s infinite backwards`,
      ));
    }
  }
}

/** Which configured sound-effect slot matches the live weather state. */
export function sfxKeyForState(state = {}) {
  const { precip, wind } = state;
  if (precip === 'storm') return 'storm';
  if (precip === 'rain') return 'rain';
  if (precip === 'snow') return 'snow';
  if (wind === 'strong' || wind === 'breezy') return 'wind';
  return 'ambient';
}

export function stopWeatherAudio() {
  const a = document.getElementById(AUDIO_ID);
  if (a) { try { a.pause(); } catch { /* ignore */ } a.remove(); }
}

/**
 * Drive a looping ambient sound effect from the live weather state.
 * @param {object} state resolved weather ({precip,wind,...})
 * @param {object} audioCfg normalized effects.audio
 * @param {{ sheltered?: boolean }} opts
 */
export function syncWeatherAudio(state, audioCfg, { sheltered = false } = {}) {
  const cfg = normalizeAudio(audioCfg);
  // Off entirely, or muted because we're sheltered and the user chose not to
  // hear weather through the walls.
  if (!cfg.enabled || (sheltered && !cfg.playWhenSheltered)) {
    stopWeatherAudio();
    return { playing: false, key: '', src: '' };
  }
  const key = sfxKeyForState(state || {});
  const src = cfg.tracks[key] || cfg.tracks.ambient || '';
  if (!src) { stopWeatherAudio(); return { playing: false, key, src: '' }; }

  let a = document.getElementById(AUDIO_ID);
  if (!a) {
    a = document.createElement('audio');
    a.id = AUDIO_ID;
    a.loop = true;
    a.preload = 'auto';
    a.style.display = 'none';
    (document.body || document.documentElement).appendChild(a);
  }
  if (a.dataset.src !== src) {
    a.dataset.src = src;
    a.src = src;
  }
  // Sheltered muffles the level; master volume scales the rest.
  a.volume = Math.max(0, Math.min(1, (cfg.volume / 100) * (sheltered ? 0.4 : 1)));
  // play() may reject until a user gesture — swallow, the next gesture-driven
  // sync (clap / toggle / test) will start it.
  const p = a.play();
  if (p && typeof p.catch === 'function') p.catch(() => { /* awaiting gesture */ });
  return { playing: true, key, src };
}

/**
 * Resolve + paint from effects prefs + scene tracker.
 * @param {{ effects: object, scene: object, roomExposed?: boolean }} args
 * @returns {{ state: object, source: 'manual'|'scene'|'off', sheltered: boolean }}
 */
export function syncWeatherOverlay({ effects, scene, roomExposed = true } = {}) {
  const fx = normalizeEffects(effects);
  const state = fx.freeMode
    ? { ...fx.manual }
    : sceneTrackerToWx(scene || {});
  const sheltered = resolveSheltered(fx, roomExposed);
  if (!fx.enabled) {
    clearWeatherOverlay();
  } else {
    paintWeatherOverlay(state, { ...fx, sheltered });
  }
  syncWeatherAudio(state, fx.audio, { sheltered });
  return { state, source: !fx.enabled ? 'off' : (fx.freeMode ? 'manual' : 'scene'), sheltered };
}

/**
 * Effects shelf HTML for Backstage → Stage → Effects.
 */
export function buildEffectsHtml(effects, scene, { esc, roomExposed = true } = {}) {
  const fx = normalizeEffects(effects);
  const au = fx.audio;
  const auto = sceneTrackerToWx(scene || {});
  const live = fx.freeMode ? fx.manual : auto;
  const sheltered = resolveSheltered(fx, roomExposed);
  const status = fx.enabled
    ? (fx.freeMode
      ? `Manual · ${live.precip}/${live.intensity} · ${live.wind} · ${live.light}`
      : `Scene tracker · ${esc(scene?.weatherEmoji || '')} ${esc(scene?.weatherLabel || '—')} · ${esc(scene?.lastTimeLabel || 'time —')}`
        + ` → ${live.precip}/${live.intensity} · ${live.wind} · ${live.light}${live.fog ? ' · fog' : ''}`)
    : 'Overlay off';
  const exposureNote = fx.exposure === 'auto'
    ? `Auto → ${sheltered ? 'sheltered (through a window)' : 'exposed (open sky)'} · active room is ${roomExposed ? 'exposed' : 'sheltered'}`
    : (sheltered ? 'Sheltered — precipitation catches on the glass' : 'Exposed — full open-air weather');

  const opt = (list, cur) => list.map(v =>
    `<option value="${v}" ${v === cur ? 'selected' : ''}>${v}</option>`).join('');

  const sfxLabels = { rain: '🌧️ Rain', storm: '⛈️ Storm', snow: '❄️ Snow', wind: '💨 Wind', ambient: '🎵 Ambient (fallback)' };
  const trackRow = (key) => `<label class="bst-field" style="margin:4px 0 0">
      <span>${sfxLabels[key]}</span>
      <input class="bst-input" type="url" placeholder="https://… (mp3 / ogg / wav)" data-fx-audio-track="${key}" value="${esc(au.tracks[key] || '')}">
    </label>`;

  const tests = Object.entries(TEST_PRESETS).map(([id, p]) =>
    `<button type="button" class="bst-btn bst-wx-test" data-action="wx-test" data-preset="${esc(id)}" title="${esc(p.label)}"><span class="bst-wx-ic">${p.icon}</span><span>${esc(p.label)}</span></button>`).join('');

  return `
    <h2 class="bst-pane-title">Effects</h2>
    <p class="bst-pane-sub">Fullscreen ambient weather over the chat — rain, snow, storms, wind, and day/night tint. Auto mode reads Scene tracker weather + time (clapper). Visual FX inspired by <a href="https://github.com/xo-nara/st-weather-overlay" target="_blank" rel="noopener">xo-nara/st-weather-overlay</a>.</p>

    <section class="bst-section">
      <h3 class="bst-section-h">Overlay</h3>
      <div class="bst-row">
        <label><input type="checkbox" data-fx="enabled" ${fx.enabled ? 'checked' : ''}> Enabled</label>
        <label><input type="checkbox" data-fx="liteMode" ${fx.liteMode ? 'checked' : ''}> Lite mode</label>
        <label><input type="checkbox" data-fx="forceMotion" ${fx.forceMotion ? 'checked' : ''}> Force animations</label>
        <label><input type="checkbox" data-fx="freeMode" ${fx.freeMode ? 'checked' : ''}> Free Mode (manual)</label>
      </div>
      <label class="bst-field"><span>Particle speed <span class="bst-k">${fx.particleSpeed}%</span></span>
        <input type="range" min="25" max="200" step="5" data-fx="particleSpeed" value="${fx.particleSpeed}">
      </label>
      <div class="bst-row bst-stack" style="margin-top:6px">
        <span class="bst-k">Exposure</span>
        <label class="bst-radio"><input type="radio" name="bst-fx-exposure" data-fx="exposure" value="auto" ${fx.exposure === 'auto' ? 'checked' : ''}> Auto <span class="bst-k">follow room</span></label>
        <label class="bst-radio"><input type="radio" name="bst-fx-exposure" data-fx="exposure" value="exposed" ${fx.exposure === 'exposed' ? 'checked' : ''}> Exposed <span class="bst-k">open sky</span></label>
        <label class="bst-radio"><input type="radio" name="bst-fx-exposure" data-fx="exposure" value="sheltered" ${fx.exposure === 'sheltered' ? 'checked' : ''}> Sheltered <span class="bst-k">through a window</span></label>
      </div>
      <p class="bst-hint">${esc(exposureNote)}</p>
      <p class="bst-hint" data-role="wx-status">${esc(status)}</p>
      <div class="bst-row">
        <button type="button" class="bst-btn gold" data-action="wx-reload">↻ Sync from Scene</button>
        <button type="button" class="bst-btn" data-action="wx-clear">Clear overlay</button>
      </div>
    </section>

    <section class="bst-section">
      <h3 class="bst-section-h">Sound effects</h3>
      <p class="bst-hint">Loop custom ambience per weather — paste an audio URL for each. The overlay plays whichever matches the live weather (Storm → Rain → Snow → Wind), falling back to Ambient. Playback starts on your next interaction (browser autoplay rule).</p>
      <div class="bst-row">
        <label><input type="checkbox" data-fx-audio="enabled" ${au.enabled ? 'checked' : ''}> Enabled</label>
        <label title="When sheltered, keep the sound but quieter/muffled; uncheck to silence weather heard through walls."><input type="checkbox" data-fx-audio="playWhenSheltered" ${au.playWhenSheltered ? 'checked' : ''}> Play when sheltered <span class="bst-k">(muffled)</span></label>
      </div>
      <label class="bst-field"><span>Volume <span class="bst-k">${au.volume}%${sheltered && au.enabled ? au.playWhenSheltered ? ' · sheltered ≈' + Math.round(au.volume * 0.4) + '%' : ' · muted (sheltered)' : ''}</span></span>
        <input type="range" min="0" max="100" step="5" data-fx-audio="volume" value="${au.volume}"></label>
      <div class="bst-stack">
        ${trackRow('rain')}
        ${trackRow('storm')}
        ${trackRow('snow')}
        ${trackRow('wind')}
        ${trackRow('ambient')}
      </div>
    </section>

    ${fx.freeMode ? `
    <section class="bst-section">
      <h3 class="bst-section-h">Manual weather</h3>
      <p class="bst-hint">Free Mode ignores Scene auto-mapping for the overlay (clapper still follows tracker). Turn Free Mode off to resume Scene sync.</p>
      <div class="bst-row">
        <label class="bst-field" style="margin:0"><span>Precipitation</span>
          <select data-fx-manual="precip">${opt(PRECIP, fx.manual.precip)}</select></label>
        <label class="bst-field" style="margin:0"><span>Intensity</span>
          <select data-fx-manual="intensity">${opt(INTENSITY, fx.manual.intensity)}</select></label>
        <label class="bst-field" style="margin:0"><span>Wind</span>
          <select data-fx-manual="wind">${opt(WIND, fx.manual.wind)}</select></label>
        <label class="bst-field" style="margin:0"><span>Time of day</span>
          <select data-fx-manual="light">${opt(LIGHT, fx.manual.light)}</select></label>
      </div>
      <div class="bst-row">
        <label><input type="checkbox" data-fx-manual="fog" ${fx.manual.fog ? 'checked' : ''}> Fog / mist layer</label>
      </div>
    </section>` : `
    <section class="bst-section">
      <h3 class="bst-section-h">Scene link</h3>
      <p class="bst-hint">Enable Weather (and Time) under Stage → Trackers → Scene, then Clap / Shift weather. Overlay maps labels like Rain, Snow, Storm, Fog, Breezy into particles and tint.</p>
      <p class="bst-hint">Mapped now: <strong>${esc(live.precip)}</strong> / ${esc(live.intensity)} · wind <strong>${esc(live.wind)}</strong> · light <strong>${esc(live.light)}</strong>${live.fog ? ' · fog' : ''}</p>
    </section>`}

    <section class="bst-section">
      <h3 class="bst-section-h">Test presets</h3>
      <p class="bst-hint">Preview only — does not change Scene tracker. Auto mode re-syncs on the next clap/shift/reload.</p>
      <div class="bst-wx-testgrid">${tests}</div>
    </section>`;
}
