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
  candle: { icon: '🕯️', label: 'Candlelit', st: { precip: 'none', intensity: 'light', wind: 'calm', light: 'night' }, sheltered: true, candlelight: true },
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
    particleIntensity: 100,
    freeMode: false,
    // 'auto' follows the active room's exposed/sheltered flag; the other two
    // force it. Sheltered turns full-screen precipitation into a through-a-
    // window effect (droplets/flakes catching and sliding on the glass).
    exposure: 'auto',
    candlelight: false,
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
  const intensityPct = clampParticleIntensity(v.particleIntensity);
  return {
    enabled: v.enabled !== false,
    liteMode: !!v.liteMode,
    forceMotion: v.forceMotion !== false,
    particleIntensity: intensityPct,
    freeMode: !!v.freeMode,
    exposure: EXPOSURE.includes(v.exposure) ? v.exposure : 'auto',
    candlelight: !!v.candlelight,
    audio: normalizeAudio(v.audio),
    manual,
  };
}

export function clampParticleIntensity(n) {
  const v = Number(n);
  return Number.isFinite(v) ? Math.min(200, Math.max(0, Math.round(v))) : 100;
}

function particleDensity(opts = {}) {
  return clampParticleIntensity(opts.particleIntensity) / 100;
}

function scaleCount(base, dens, lite = false, min = 0) {
  let n = Math.round(Number(base) * dens);
  if (lite) n = Math.round(n / 3);
  return Math.max(min, n);
}

function tintAlpha(base, dens) {
  return Math.max(0, Math.min(0.82, +(Number(base) * dens).toFixed(3)));
}

function paintSnowFlakes(o, { count, dens = 1 } = {}) {
  const n = Math.max(0, Number(count) || 0);
  const xs = stratifiedPositions(n);
  for (let i = 0; i < n; i++) {
    const sz = 4.5 + Math.random() * 5.5;
    const dur = (4.2 + Math.random() * 3.6).toFixed(2);
    const jit = (1.1 + Math.random() * 1.4).toFixed(2);
    const jx = (10 + Math.random() * 22).toFixed(0);
    const alpha = (0.78 + Math.random() * 0.2).toFixed(2);
    const wrap = el(
      `position:absolute;top:-10vh;left:${xs[i]}%;width:${sz}px;height:${sz}px;`
      + `animation:st-wxsnowfall ${dur}s linear ${(-Math.random() * dur).toFixed(2)}s infinite backwards`,
    );
    wrap.appendChild(el(
      `width:100%;height:100%;border-radius:50%;`
      + `background:rgba(255,255,255,${alpha});box-shadow:0 0 ${sz * 1.4}px rgba(255,255,255,.7);`
      + `--jx:${jx}px;animation:st-wxsnowjit ${jit}s ease-in-out ${(-Math.random() * jit).toFixed(2)}s infinite`,
    ));
    o.appendChild(wrap);
  }
}

function paintFrost(o, { heavy = false, dens = 1 } = {}) {
  const a = Math.max(0.25, Math.min(1.15, dens));
  const c = (heavy ? 0.5 : 0.26) * a;
  o.appendChild(el('position:absolute;inset:0;pointer-events:none;background:'
    + `radial-gradient(55% 38% at 0% 0%,rgba(230,242,255,${c.toFixed(2)}),transparent 62%),`
    + `radial-gradient(55% 38% at 100% 0%,rgba(230,242,255,${c.toFixed(2)}),transparent 62%),`
    + `radial-gradient(62% 40% at 0% 100%,rgba(220,234,252,${(c * 0.85).toFixed(2)}),transparent 64%),`
    + `radial-gradient(62% 40% at 100% 100%,rgba(220,234,252,${(c * 0.85).toFixed(2)}),transparent 64%)`));
  if (!heavy) return;
  o.appendChild(el(
    'position:absolute;inset:0;box-shadow:inset 0 0 110px rgba(210,228,255,.28),inset 0 18px 40px rgba(235,245,255,.22);'
    + `background:linear-gradient(180deg,rgba(236,246,255,${(0.16 * a).toFixed(2)}),transparent 18%),`
    + `linear-gradient(0deg,rgba(230,240,255,${(0.12 * a).toFixed(2)}),transparent 14%)`,
  ));
  const crystals = Math.round(18 * a);
  for (let i = 0; i < crystals; i++) {
    const sz = 2 + Math.random() * 4;
    const edge = Math.random();
    const left = edge < 0.5 ? Math.random() * 18 : 82 + Math.random() * 18;
    const top = Math.random() < 0.5 ? Math.random() * 16 : 84 + Math.random() * 16;
    o.appendChild(el(
      `position:absolute;top:${top}%;left:${left}%;width:${sz}px;height:${sz}px;`
      + `background:rgba(255,255,255,${(0.45 + Math.random() * 0.4).toFixed(2)});`
      + `clip-path:polygon(50% 0,61% 35%,100% 50%,61% 65%,50% 100%,39% 65%,0 50%,39% 35%);`
      + `filter:blur(.2px);opacity:.85`,
    ));
  }
}

function paintWindWisps(o, { wind, dens = 1, lite = false } = {}) {
  if (wind !== 'strong' && wind !== 'breezy') return;
  if (dens <= 0) return;
  const isStrong = wind === 'strong';
  const n = scaleCount(isStrong ? 16 : 9, dens, lite, 3);
  for (let i = 0; i < n; i++) {
    const ltr = i % 2 === 0;
    const dur = (isStrong ? 1.9 + Math.random() * 1.3 : 3.4 + Math.random() * 2.2).toFixed(2);
    const w = (isStrong ? 52 : 38) + Math.random() * 32;
    const h = (isStrong ? 11 : 8) + Math.random() * 12;
    const top = 6 + Math.random() * 80;
    const blur = (5 + Math.random() * 7).toFixed(1);
    const alpha = (isStrong ? 0.42 : 0.32) + Math.random() * 0.2;
    o.appendChild(el(
      `position:absolute;top:${top}%;left:0;width:${w.toFixed(0)}vw;height:${h.toFixed(1)}px;border-radius:999px;`
      + `background:linear-gradient(90deg,transparent 0%,rgba(242,248,255,${alpha.toFixed(2)}) 42%,rgba(210,224,240,${(alpha * 0.55).toFixed(2)}) 70%,transparent 100%);`
      + `filter:blur(${blur}px);--lift:${(-6 - Math.random() * 16).toFixed(0)}px;--wo:${alpha.toFixed(2)};`
      + `animation:${ltr ? 'st-wxwisp-ltr' : 'st-wxwisp-rtl'} ${dur}s linear ${(-Math.random() * Number(dur)).toFixed(2)}s infinite backwards`,
    ));
  }
}

function paintFogBanks(o, { dens = 1, lite = false, light = 'day' } = {}) {
  if (dens <= 0) return;
  const a = Math.max(0.4, Math.min(1.25, dens));
  const night = light === 'night';
  const rgb = night ? '186,198,214' : '232,238,244';
  o.appendChild(el(
    `position:absolute;left:-22%;right:-22%;bottom:-14%;height:52%;`
    + `background:radial-gradient(120% 95% at 50% 100%,rgba(${rgb},${(0.78 * a).toFixed(2)}),rgba(${rgb},${(0.32 * a).toFixed(2)}) 50%,transparent 78%);`
    + 'filter:blur(10px);animation:st-wxcloud 18s ease-in-out infinite backwards',
  ));
  const n = scaleCount(8, dens, lite, 4);
  for (let i = 0; i < n; i++) {
    const w = 30 + Math.random() * 44;
    const h = 18 + Math.random() * 24;
    const left = -10 + Math.random() * 88;
    const bottom = Math.random() * 36;
    const dur = (11 + Math.random() * 12).toFixed(1);
    const op = ((0.5 + Math.random() * 0.38) * a).toFixed(2);
    o.appendChild(el(
      `position:absolute;left:${left}%;bottom:${bottom}%;width:${w}vw;height:${h}vh;border-radius:50%;`
      + `background:radial-gradient(ellipse at 50% 55%,rgba(${rgb},${op}),transparent 72%);`
      + `filter:blur(${(16 + Math.random() * 16).toFixed(0)}px);`
      + `animation:st-wxsmokedrift ${dur}s ease-in-out ${(-Math.random() * 14).toFixed(1)}s infinite alternate`,
    ));
  }
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
  const hour = Number(scene.lastTimeHour);
  if (scene.time !== false && Number.isFinite(hour)) {
    const hpd = 24;
    const frac = (((Math.floor(hour) % hpd) + hpd) % hpd) / hpd;
    if (frac < 5 / 24 || frac >= 21 / 24) light = 'night';
    else if (frac < 7 / 24) light = 'dawn';
    else if (frac < 18 / 24) light = 'day';
    else light = 'dusk';
  } else if (/night|midnight|late\s*night/.test(timeBlob)) light = 'night';
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

  const fog = /fog|mist|haze|🌫/.test(blob) && precip === 'none';

  return { precip, intensity, wind, light, fog };
}

function ensureStyle() {
  let s = document.getElementById(STYLE_ID);
  if (!s) {
    s = document.createElement('style');
    s.id = STYLE_ID;
    document.head.appendChild(s);
  }
  s.textContent = `
#${OVERLAY_ID}{position:fixed!important;top:0!important;left:0!important;width:100vw!important;height:100vh!important;height:100dvh!important;pointer-events:none!important;z-index:35!important;overflow:hidden!important}
#${OVERLAY_ID} *{pointer-events:none!important}
#${OVERLAY_ID} .st-wx-tint{position:absolute;inset:0;transition:background 1.2s ease}
@keyframes st-wxfall{0%{transform:translateY(-12vh) skewX(var(--wxskew,0deg))}100%{transform:translateY(112vh) skewX(var(--wxskew,0deg))}}
@keyframes st-wxstormfall{0%{transform:translateY(-12vh) skewX(var(--s0,-12deg))}28%{transform:translateY(24vh) skewX(var(--s1,-22deg))}62%{transform:translateY(64vh) skewX(var(--s2,-10deg))}100%{transform:translateY(112vh) skewX(var(--s3,-18deg))}}
@keyframes st-wxsnow{0%{transform:translateY(-6vh) translateX(0) rotate(0)}50%{transform:translateY(52vh) translateX(16px) rotate(180deg)}100%{transform:translateY(112vh) translateX(-8px) rotate(360deg)}}
@keyframes st-wxsnowfall{0%{transform:translateY(-10vh)}100%{transform:translateY(120vh)}}
@keyframes st-wxsnowjit{0%,100%{transform:translateX(0) rotate(0)}22%{transform:translateX(var(--jx,16px)) rotate(48deg)}48%{transform:translateX(calc(var(--jx,16px)*-.9)) rotate(-28deg)}74%{transform:translateX(calc(var(--jx,16px)*.55)) rotate(22deg)}}
@keyframes st-wxgust{0%{transform:translateX(-40vw) translateY(0);opacity:0}12%{opacity:.7}55%{transform:translateX(55vw) translateY(var(--lift,-8px));opacity:.42}100%{transform:translateX(130vw) translateY(var(--lift,-14px));opacity:0}}
@keyframes st-wxwisp-ltr{0%{transform:translateX(-110%) translateY(0);opacity:0}14%{opacity:var(--wo,.5)}52%{transform:translateX(70%) translateY(var(--lift,-10px));opacity:var(--wo,.42)}100%{transform:translateX(240%) translateY(var(--lift,-16px));opacity:0}}
@keyframes st-wxwisp-rtl{0%{transform:translateX(240%) translateY(0);opacity:0}14%{opacity:var(--wo,.5)}52%{transform:translateX(20%) translateY(var(--lift,-10px));opacity:var(--wo,.42)}100%{transform:translateX(-120%) translateY(var(--lift,-16px));opacity:0}}
@keyframes st-wxray{0%,100%{opacity:.10}50%{opacity:.24}}
@keyframes st-wxfog{0%,100%{transform:translateX(-6%)}50%{transform:translateX(6%)}}
@keyframes st-wxfogdrift{0%,100%{transform:translateX(-8%) translateY(0)}50%{transform:translateX(8%) translateY(-3%)}}
@keyframes st-wxcloud{0%,100%{transform:translateX(-10%) translateY(0)}50%{transform:translateX(12%) translateY(-3%)}}
@keyframes st-wxsmokedrift{0%{transform:translateX(-16%) translateY(0)}50%{transform:translateX(12%) translateY(-4%)}100%{transform:translateX(18%) translateY(2%)}}
@keyframes st-wxcandle{0%,100%{opacity:.7;transform:scale(1)}7%{opacity:.48;transform:scale(.96)}13%{opacity:.88;transform:scale(1.05)}21%{opacity:.58;transform:scale(.98)}33%{opacity:.92;transform:scale(1.07)}46%{opacity:.5;transform:scale(.94)}58%{opacity:.8;transform:scale(1.03)}71%{opacity:.44;transform:scale(.93)}84%{opacity:.86;transform:scale(1.04)}93%{opacity:.62;transform:scale(.99)}}
@keyframes st-wxcandleedge{0%,100%{opacity:.68}8%{opacity:.4}17%{opacity:.86}28%{opacity:.5}42%{opacity:.76}55%{opacity:.36}68%{opacity:.82}80%{opacity:.46}91%{opacity:.72}}
@keyframes st-wxdrip{0%{transform:translateY(0);opacity:0}8%{opacity:.85}18%{transform:translateY(4px)}100%{transform:translateY(var(--drip,40vh));opacity:0}}
@keyframes st-wxbead{0%,100%{opacity:.5;transform:translateY(0)}50%{opacity:.8;transform:translateY(2px)}}
@keyframes st-wxdrift{0%{transform:translate(0,-4vh);opacity:0}12%{opacity:.7}100%{transform:translate(var(--dx,10px),108vh);opacity:.15}}
#${OVERLAY_ID} .st-wx-glass{position:absolute;inset:0;box-shadow:inset 0 0 90px rgba(120,140,170,.28),inset 0 0 24px rgba(255,255,255,.06);backdrop-filter:blur(.4px)}
#${OVERLAY_ID} .st-wx-glass::before{content:"";position:absolute;inset:0;background:radial-gradient(140% 120% at 50% 0%,transparent 62%,rgba(90,110,140,.16));}
`;
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
  lastPaintSig = '';
  const o = document.getElementById(OVERLAY_ID);
  if (!o) return;
  if (Array.isArray(o._t)) o._t.forEach(clearInterval);
  o.remove();
}

/**
 * Through-a-window rendering for sheltered spaces: precipitation clings to and
 * slides down the glass instead of falling across the whole screen.
 */
function paintShelteredWindow(o, st, { lite = false, dens = 1 } = {}) {
  const { precip, intensity, light } = st;
  const fog = !!st.fog;

  const glass = el('');
  glass.className = 'st-wx-glass';
  o.appendChild(glass);

  if (precip === 'rain' || precip === 'storm') {
    // Running drips (race down the pane).
    const drips = scaleCount(intensity === 'heavy' || precip === 'storm' ? 24 : 14, dens, lite);
    const xs = stratifiedPositions(drips);
    for (let i = 0; i < drips; i++) {
      const top = Math.random() * 55;
      const run = (18 + Math.random() * 40).toFixed(0);
      const dur = (2.2 + Math.random() * 2.6).toFixed(2);
      const w = (1.5 + Math.random() * 1.5).toFixed(1);
      o.appendChild(el(
        `position:absolute;top:${top}%;left:${xs[i]}%;width:${w}px;height:${8 + Math.random() * 14}px;`
        + `border-radius:60% 60% 60% 60%/70% 70% 40% 40%;`
        + `background:linear-gradient(rgba(200,220,245,.65),rgba(170,195,225,.35));`
        + `--drip:${run}vh;animation:st-wxdrip ${dur}s ease-in ${(-Math.random() * dur).toFixed(2)}s infinite backwards`,
      ));
    }
    // Clinging beads (wobble in place — condensation on the glass).
    const beads = scaleCount(intensity === 'heavy' || precip === 'storm' ? 36 : 22, dens, lite);
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
    const n = scaleCount(intensity === 'heavy' ? 28 : 18, dens, lite);
    paintSnowFlakes(o, { count: n, dens });
  }

  if (precip === 'none' && light !== 'night' && !fog) {
    // Light condensation so a calm sheltered view still reads as "indoors".
    o.appendChild(el('position:absolute;inset:0;background:radial-gradient(120% 90% at 50% 110%,rgba(210,220,235,.16),transparent 60%);animation:st-wxfog 12s ease-in-out infinite backwards'));
  }
}

/**
 * @param {{ precip: string, intensity: string, wind: string, light: string, fog?: boolean }} st
 * @param {{ liteMode?: boolean, forceMotion?: boolean, particleIntensity?: number }} opts
 */
export function paintWeatherOverlay(st, opts = {}) {
  ensureStyle();
  clearWeatherOverlay();
  lastPaintSig = paintSignature(st, opts);
  if (!st) return;

  const lite = !!opts.liteMode;
  const forceMotion = opts.forceMotion !== false;
  const reduced = !forceMotion && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const dens = particleDensity(opts);
  const sheltered = !!opts.sheltered;
  const candlelight = !!opts.candlelight;

  const o = document.createElement('div');
  o.id = OVERLAY_ID;
  o._t = [];
  if (sheltered) o.dataset.sheltered = '1';
  (document.documentElement || document.body).appendChild(o);

  const { precip, intensity, wind, light } = st;
  const fog = !!st.fog;

  const tint = el('position:absolute;inset:0;transition:background 1.2s ease');
  tint.className = 'st-wx-tint';
  if (light === 'night') {
    const inner = tintAlpha(sheltered ? 0.34 : 0.28, dens);
    const outer = tintAlpha(sheltered ? 0.58 : 0.62, dens);
    tint.style.background = dens <= 0
      ? 'transparent'
      : sheltered
        ? `radial-gradient(125% 100% at 50% 28%, rgba(10,12,28,${inner}), rgba(4,6,16,${outer}))`
        : `radial-gradient(130% 100% at 50% 0%, rgba(6,8,20,${inner}) 18%, rgba(4,7,22,${outer}))`;
  } else if (light === 'dusk') {
    const a = tintAlpha(sheltered ? 0.08 : 0.14, dens);
    tint.style.background = a ? `linear-gradient(180deg, rgba(70,25,12,${a}), transparent 55%)` : 'transparent';
  } else if (light === 'dawn') {
    const a = tintAlpha(0.15, dens);
    tint.style.background = a ? `linear-gradient(180deg, rgba(255,208,138,${a}), transparent 58%)` : 'transparent';
  } else {
    tint.style.background = 'transparent';
  }
  o.appendChild(tint);

  if (candlelight && sheltered) {
    const edge = reduced ? '' : ';animation:st-wxcandleedge 3.1s ease-in-out infinite';
    const edgeB = reduced ? '' : ';animation:st-wxcandleedge 2.35s ease-in-out .55s infinite';
    const edgeC = reduced ? '' : ';animation:st-wxcandleedge 3.7s ease-in-out 1.05s infinite';
    o.appendChild(el(
      'position:absolute;top:-10%;bottom:-10%;left:-6%;width:20vw;'
      + 'background:linear-gradient(90deg,rgba(255,148,62,.26),rgba(255,118,40,.09) 42%,transparent 80%);'
      + `filter:blur(16px)${edge}`,
    ));
    o.appendChild(el(
      'position:absolute;top:-10%;bottom:-10%;right:-6%;width:18vw;'
      + 'background:linear-gradient(270deg,rgba(255,138,52,.2),rgba(255,108,32,.07) 42%,transparent 80%);'
      + `filter:blur(18px)${edgeB}`,
    ));
    o.appendChild(el(
      'position:absolute;bottom:-18%;left:-10%;width:26vw;height:34vh;'
      + 'background:radial-gradient(ellipse at 22% 80%,rgba(255,142,58,.16),transparent 68%);'
      + `filter:blur(22px)${edgeC}`,
    ));
    o.appendChild(el(
      'position:absolute;bottom:-20%;right:-12%;width:22vw;height:30vh;'
      + 'background:radial-gradient(ellipse at 80% 82%,rgba(255,128,48,.12),transparent 70%);'
      + `filter:blur(24px)${edge}`,
    ));
  }

  if (reduced) return;

  const stormy = precip === 'storm';
  const windSkew = wind === 'strong' ? -16 : wind === 'breezy' ? -7 : 0;

  if (sheltered) {
    paintShelteredWindow(o, st, { lite, dens });
  } else if (precip === 'rain' || precip === 'storm') {
    const far = scaleCount(stormy ? 42 : intensity === 'heavy' ? 34 : 22, dens, lite);
    const near = scaleCount(stormy ? 28 : intensity === 'heavy' ? 22 : 14, dens, lite);
    const farPos = stratifiedPositions(far);
    const nearPos = stratifiedPositions(near);
    const drop = (left, { near: isNear }) => {
      const dur = (isNear ? 0.42 + Math.random() * 0.28 : 0.85 + Math.random() * 0.4).toFixed(2);
      const w = isNear ? (3.2 + Math.random() * 1.8).toFixed(1) : (2.4 + Math.random() * 1.2).toFixed(1);
      const h = isNear ? 28 + Math.random() * 18 : 16 + Math.random() * 14;
      const alpha = isNear ? 0.78 : 0.5;
      if (stormy) {
        const s0 = (-8 - Math.random() * 8).toFixed(0);
        const s1 = (-16 - Math.random() * 8).toFixed(0);
        const s2 = (-8 - Math.random() * 6).toFixed(0);
        const s3 = (-14 - Math.random() * 10).toFixed(0);
        o.appendChild(el(
          `position:absolute;top:-12vh;left:${left}%;width:${w}px;height:${h}px;`
          + `background:linear-gradient(transparent,rgba(${isNear ? '200,218,245' : '170,190,220'},${alpha}));`
          + `--s0:${s0}deg;--s1:${s1}deg;--s2:${s2}deg;--s3:${s3}deg;`
          + `animation:st-wxstormfall ${dur}s linear ${(-Math.random() * dur).toFixed(2)}s infinite backwards`
          + (lite || !isNear ? '' : ';filter:blur(.35px)'),
        ));
        return;
      }
      o.appendChild(el(
        `position:absolute;top:-12vh;left:${left}%;width:${w}px;height:${h}px;`
        + `background:linear-gradient(transparent,rgba(${isNear ? '200,218,245' : '170,190,220'},${alpha}));`
        + `--wxskew:${windSkew}deg;`
        + `animation:st-wxfall ${dur}s linear ${(-Math.random() * dur).toFixed(2)}s infinite backwards`
        + (lite || !isNear ? '' : ';filter:blur(.3px)'),
      ));
    };
    for (let i = 0; i < far; i++) drop(farPos[i], { near: false });
    for (let i = 0; i < near; i++) drop(nearPos[i], { near: true });
    if (stormy) {
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
    const n = scaleCount(intensity === 'heavy' ? 36 : 24, dens, lite);
    paintSnowFlakes(o, { count: n, dens });
  }

  if (precip === 'snow') paintFrost(o, { heavy: intensity === 'heavy', dens });

  if (precip === 'none' && light === 'day' && !fog) {
    o.appendChild(el('position:absolute;top:-14%;right:-8%;width:70vw;height:70vw;background:radial-gradient(circle at 78% 18%, rgba(255,228,165,.18), transparent 55%);animation:st-wxray 6s ease-in-out infinite backwards'));
    o.appendChild(el('position:absolute;top:0;right:10%;width:32vw;height:3px;background:linear-gradient(90deg,transparent,rgba(255,235,180,.12),transparent);transform:rotate(24deg);transform-origin:right top;animation:st-wxray 7s ease-in-out .8s infinite backwards'));
  }
  if ((light === 'dawn' || light === 'dusk') && dens > 0) {
    const a = tintAlpha(0.10, dens);
    o.appendChild(el(
      `position:absolute;bottom:-6%;left:0;right:0;height:34%;background:linear-gradient(0deg,${
        light === 'dawn' ? `rgba(255,190,120,${a})` : `rgba(180,80,50,${a})`
      },transparent);animation:st-wxfog 9s ease-in-out infinite backwards`,
    ));
  }
  if (fog && !sheltered) paintFogBanks(o, { dens, lite, light });
  if (!sheltered) paintWindWisps(o, { wind, dens, lite });
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
/** Identity of a painted overlay: same signature → the same particles, no rebuild. */
function paintSignature(st, opts = {}) {
  if (!st) return 'none';
  return JSON.stringify([
    st.precip, st.intensity, st.wind, st.light, !!st.fog,
    !!opts.liteMode, opts.forceMotion !== false, clampParticleIntensity(opts.particleIntensity),
    !!opts.sheltered, !!opts.candlelight,
  ]);
}

let lastPaintSig = '';

export function syncWeatherOverlay({ effects, scene, roomExposed = true } = {}) {
  const fx = normalizeEffects(effects);
  const state = fx.freeMode
    ? { ...fx.manual }
    : sceneTrackerToWx(scene || {});
  const sheltered = resolveSheltered(fx, roomExposed);
  if (!fx.enabled) {
    clearWeatherOverlay();
  } else {
    // Repainting tears down and rebuilds every animated particle. Skip it when
    // nothing changed — this used to run on every message sent and received.
    const sig = paintSignature(state, { ...fx, sheltered });
    const live = document.getElementById(OVERLAY_ID);
    if (!live || sig !== lastPaintSig) paintWeatherOverlay(state, { ...fx, sheltered });
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
    <p class="bst-pane-sub">Fullscreen ambient weather over the chat — rain, snow, storms, wind, fog, and day/night tint. Indoors (sheltered) night is dimmer than open sky; optional candlelight flickers a warm glow. Auto mode reads Scene tracker weather + time (clapper). Visual FX inspired by <a href="https://github.com/xo-nara/st-weather-overlay" target="_blank" rel="noopener">xo-nara/st-weather-overlay</a>.</p>

    <section class="bst-section">
      <h3 class="bst-section-h">Overlay</h3>
      <div class="bst-row">
        <label><input type="checkbox" data-fx="enabled" ${fx.enabled ? 'checked' : ''}> Enabled</label>
        <label><input type="checkbox" data-fx="liteMode" ${fx.liteMode ? 'checked' : ''}> Lite mode</label>
        <label><input type="checkbox" data-fx="forceMotion" ${fx.forceMotion ? 'checked' : ''}> Force animations</label>
        <label><input type="checkbox" data-fx="freeMode" ${fx.freeMode ? 'checked' : ''}> Free Mode (manual)</label>
      </div>
      <label class="bst-field"><span>Particle intensity <span class="bst-k">${fx.particleIntensity}%</span></span>
        <input type="range" min="0" max="200" step="5" data-fx="particleIntensity" value="${fx.particleIntensity}">
      </label>
      <div class="bst-row bst-stack" style="margin-top:6px">
        <span class="bst-k">Exposure</span>
        <label class="bst-radio"><input type="radio" name="bst-fx-exposure" data-fx="exposure" value="auto" ${fx.exposure === 'auto' ? 'checked' : ''}> Auto <span class="bst-k">follow room</span></label>
        <label class="bst-radio"><input type="radio" name="bst-fx-exposure" data-fx="exposure" value="exposed" ${fx.exposure === 'exposed' ? 'checked' : ''}> Exposed <span class="bst-k">open sky</span></label>
        <label class="bst-radio"><input type="radio" name="bst-fx-exposure" data-fx="exposure" value="sheltered" ${fx.exposure === 'sheltered' ? 'checked' : ''}> Sheltered <span class="bst-k">through a window</span></label>
      </div>
      <p class="bst-hint">${esc(exposureNote)} Wind and fog only show outdoors (exposed).</p>
      <div class="bst-row">
        <label title="When sheltered at night, a warm flicker along the left and right edges — as if a candle is nearby."><input type="checkbox" data-fx="candlelight" ${fx.candlelight ? 'checked' : ''}> Candlelight <span class="bst-k">edge flicker</span></label>
      </div>
      <p class="bst-hint">Particle intensity also scales the day/night tint. Candlelight only shows when the overlay is sheltered, and stays on the sides of the frame.</p>
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

/** Lightweight overlay mapping checks (no DOM). Returns '' on success. */
export function smokeOverlayWxPure() {
  const overcastNight = sceneTrackerToWx({ weatherLabel: 'Overcast', weatherEmoji: '☁', lastTimeLabel: 'Mid Night', lastTimeHour: 22 });
  if (overcastNight.fog) return 'overcast is not fog';
  if (overcastNight.light !== 'night') return 'mid night hour should map to night';
  const morning = sceneTrackerToWx({ weatherLabel: 'Overcast', lastTimeLabel: 'Mid Night', lastTimeHour: 8 });
  if (morning.light !== 'day') return '08:00 clock should map to day, not leftover night label';
  if (morning.fog) return 'overcast morning is not fog';
  const fog = sceneTrackerToWx({ weatherLabel: 'Fog', weatherEmoji: '🌫', lastTimeLabel: 'Mid Morning', lastTimeHour: 9 });
  if (!fog.fog) return 'fog label should still be fog';
  const fx = normalizeEffects({ particleSpeed: 175 });
  if (fx.particleIntensity !== 100) return 'particle intensity should default, not inherit old speed';
  if (fx.particleSpeed != null) return 'particleSpeed should not persist on effects';
  if (clampParticleIntensity(-10) !== 0) return 'intensity floor is 0';
  if (clampParticleIntensity(250) !== 200) return 'intensity ceiling is 200';
  if (normalizeEffects({ particleIntensity: 40 }).particleIntensity !== 40) return 'stored intensity should round-trip';
  return '';
}
