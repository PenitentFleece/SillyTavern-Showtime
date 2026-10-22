// Parse model-emitted [SCENE|…] / [EVENT|…] / [ACH|…] / [SEC|…] / [REP|…] lines, strip them from chat,
// stamp the scene board, and paint a collapsible mini-clapper.

import { normalizePlotHookKind, plotHookKindMeta } from './castCatalog.js';
import { parseClockMention, scanTimeCue, scanWeatherCue } from './chatTrack.js';
import { FUZZY_HOURS, formatTrackerTimeFromHour } from './trackersConfig.js';
import { assertHere } from './travelState.js';

const SLATE_PIPE_RE = /\[(SCENE|EVENT|ACH|SECRET|SEC|REP)\|([^\]]*)\]/gi;
const SLATE_ARROW_RE = /\[(?!SCENE\||EVENT\||ACH\||SECRET\||SEC\||REP\|)([^\]|\n]+?)\s*->\s*([^\]|\n]+?)\s*\|\s*([^\]]+)\]/gi;
const SLATE_VERBS = new Set(['ADDED', 'UPDATED', 'RESOLVED', 'FAILED']);
const CONT_LABEL_RE = /^(unlocked|context|cause\/reading|cause|reading)\s*:\s*(.*)$/i;

export const INTEL_RARITIES = Object.freeze([
  { id: 'COMMON', label: 'Common', tier: 'trivial', stars: 1, hidden: false, mark: '★' },
  { id: 'UNCOMMON', label: 'Uncommon', tier: 'minor', stars: 2, hidden: false, mark: '★★' },
  { id: 'RARE', label: 'Rare', tier: 'notable', stars: 3, hidden: false, mark: '★★★' },
  { id: 'EPIC', label: 'Epic', tier: 'major', stars: 4, hidden: false, mark: '★★★★' },
  { id: 'LEGENDARY', label: 'Legendary', tier: 'pivotal', stars: 5, hidden: false, mark: '★★★★★' },
  { id: 'SECRET', label: 'Secret', tier: 'pivotal', stars: 0, hidden: true, mark: '💀' },
]);

export const INTEL_DIRECTIONS = Object.freeze([
  { id: 'RISING', label: 'Rising', emoji: '📈' },
  { id: 'FALLING', label: 'Falling', emoji: '📉' },
  { id: 'MIXED', label: 'Mixed', emoji: '🔄' },
  { id: 'NEW', label: 'New', emoji: '🆕' },
]);

const TIER_TO_RARITY = Object.freeze({
  trivial: 'COMMON', minor: 'UNCOMMON', notable: 'RARE', major: 'EPIC', pivotal: 'LEGENDARY',
});

export function intelRarityMeta(id) {
  const key = String(id || '').trim().toUpperCase();
  return INTEL_RARITIES.find(r => r.id === key) || INTEL_RARITIES[2];
}

export function intelDirectionMeta(id) {
  const key = String(id || '').trim().toUpperCase();
  return INTEL_DIRECTIONS.find(d => d.id === key) || INTEL_DIRECTIONS[0];
}

export function normalizeIntelRarity(raw) {
  const s = String(raw || '').trim();
  if (!s) return intelRarityMeta('RARE');
  const upper = s.toUpperCase();
  if (/💀/.test(s) || /\bSECRET\b/.test(upper)) return intelRarityMeta('SECRET');
  const starCount = (s.match(/★/g) || []).length;
  const named = INTEL_RARITIES.find(r =>
    upper.includes(r.id) || upper.includes(r.label.toUpperCase()));
  if (named) return named;
  if (starCount) {
    const starHit = INTEL_RARITIES.find(r => r.stars === starCount);
    if (starHit) return starHit;
  }
  const fromTier = TIER_TO_RARITY[s.toLowerCase()];
  return intelRarityMeta(fromTier || 'RARE');
}

export function normalizeIntelDirection(raw) {
  const s = String(raw || '').trim();
  const upper = s.toUpperCase();
  const hit = INTEL_DIRECTIONS.find(d =>
    upper.includes(d.id) || s.includes(d.emoji) || upper.includes(d.label.toUpperCase()));
  return hit || INTEL_DIRECTIONS[3];
}

export function clipIntelTitle(text, max = 60) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  const sentence = t.split(/[.!?]/)[0].trim() || t;
  if (sentence.length <= max) return sentence;
  return `${sentence.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

function splitKnowers(raw) {
  const s = String(raw || '').trim();
  if (!s || /^(none|—|-|only owner|owner only|n\/a)$/i.test(s)) return [];
  return s.split(/[,;/&]|\band\b/i).map(x => x.trim()).filter(Boolean);
}

function splitPipes(inner) {
  return String(inner || '').split('|').map(s => s.trim());
}

function parseSceneInner(inner) {
  const parts = splitPipes(inner);
  const location = String(parts[0] || '').trim();
  const time = String(parts[1] || '').trim();
  const weather = parts.slice(2).join('|').trim();
  if (!location && !time && !weather) return null;
  return { location, time, weather };
}

function parseEventInner(inner) {
  const parts = splitPipes(inner);
  const verb = String(parts[0] || '').trim().toUpperCase();
  if (!SLATE_VERBS.has(verb)) return null;
  const kind = normalizePlotHookKind(parts[1]);
  const summary = String(parts[2] || '').trim();
  if (!summary) return null;
  const deadline = String(parts[3] || '').trim();
  const context = parts.slice(4).join('|').trim();
  return { verb, kind, summary, deadline, context };
}

function takeContinuation(raw, afterIndex) {
  const rest = String(raw || '').slice(Math.max(0, afterIndex));
  const lines = rest.split(/\r?\n/);
  const out = { unlocked: '', context: '', cause: '', reading: '' };
  let started = false;
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    if (!i) {
      const same = line.replace(/^\s+/, '');
      if (!same) continue;
      const lab = same.match(CONT_LABEL_RE);
      if (!lab) break;
      line = same;
    }
    const trimmed = String(line || '').trim();
    if (!trimmed) {
      if (started) break;
      continue;
    }
    const m = trimmed.match(CONT_LABEL_RE);
    if (!m) break;
    started = true;
    const key = m[1].toLowerCase();
    const val = String(m[2] || '').trim();
    if (key === 'unlocked') out.unlocked = val;
    else if (key === 'context') out.context = val;
    else if (key === 'cause') out.cause = val;
    else if (key === 'reading') out.reading = val;
    else if (key === 'cause/reading') {
      const bits = val.split(/(?<=\.)\s+/);
      out.cause = String(bits[0] || '').trim();
      out.reading = bits.slice(1).join(' ').trim() || out.cause;
    }
  }
  return out;
}

function parseAchInner(inner, cont) {
  const parts = splitPipes(inner);
  const title = String(parts[0] || '').trim();
  if (!title) return null;
  const rarity = normalizeIntelRarity(parts[1]);
  const description = parts.slice(2).join('|').trim();
  const unlocked = String(cont.unlocked || '').trim();
  if (!unlocked) return null;
  return {
    title,
    rarity: rarity.id,
    tier: rarity.tier,
    hidden: rarity.hidden,
    description,
    unlocked,
  };
}

function parseSecretInner(inner, cont) {
  const parts = splitPipes(inner);
  const owner = String(parts[0] || '').trim();
  const context = String(cont.context || '').trim();
  if (!owner || !context) return null;
  const rarity = normalizeIntelRarity(parts[1]);
  return {
    owner,
    rarity: rarity.id,
    tier: rarity.tier,
    knowers: splitKnowers(parts[2] || ''),
    context,
    title: clipIntelTitle(context),
    channel: 'fact',
  };
}

function parseRepFields(from, to, dirRaw, cont) {
  const fromName = String(from || '').trim();
  const toName = String(to || '').trim();
  const cause = String(cont.cause || '').trim();
  const reading = String(cont.reading || '').trim();
  if (!fromName || !toName || !cause) return null;
  if (fromName.toLowerCase() === toName.toLowerCase()) return null;
  const direction = normalizeIntelDirection(dirRaw);
  return {
    from: fromName,
    to: toName,
    direction: direction.id,
    cause,
    reading: reading || cause,
  };
}

/** Pull SCENE/EVENT/ACH/SEC/REP tags from a message body. */
export function parseSlateTags(text) {
  const out = { scene: null, events: [], achs: [], secrets: [], reps: [], rawLines: [] };
  const raw = String(text || '');
  if (!raw || !raw.includes('[')) return out;
  const hits = [];
  const pipeRe = new RegExp(SLATE_PIPE_RE.source, 'gi');
  let m;
  while ((m = pipeRe.exec(raw))) {
    hits.push({
      index: m.index,
      end: m.index + m[0].length,
      raw: m[0],
      kind: String(m[1] || '').toUpperCase(),
      inner: m[2] || '',
    });
  }
  const arrowRe = new RegExp(SLATE_ARROW_RE.source, 'gi');
  while ((m = arrowRe.exec(raw))) {
    hits.push({
      index: m.index,
      end: m.index + m[0].length,
      raw: m[0],
      kind: 'ARROW',
      from: m[1] || '',
      to: m[2] || '',
      dir: m[3] || '',
    });
  }
  hits.sort((a, b) => a.index - b.index);
  for (const hit of hits) {
    out.rawLines.push(hit.raw);
    const cont = takeContinuation(raw, hit.end);
    if (hit.kind === 'SCENE') {
      const scene = parseSceneInner(hit.inner);
      if (scene) out.scene = scene;
    } else if (hit.kind === 'EVENT') {
      const event = parseEventInner(hit.inner);
      if (event) out.events.push(event);
    } else if (hit.kind === 'ACH') {
      const ach = parseAchInner(hit.inner, cont);
      if (ach) out.achs.push(ach);
    } else if (hit.kind === 'SEC' || hit.kind === 'SECRET') {
      const secret = parseSecretInner(hit.inner, cont);
      if (secret) out.secrets.push(secret);
    } else if (hit.kind === 'REP') {
      const parts = splitPipes(hit.inner);
      const rep = parseRepFields(parts[0], parts[1], parts[2], cont);
      if (rep) out.reps.push(rep);
    } else if (hit.kind === 'ARROW') {
      const rep = parseRepFields(hit.from, hit.to, hit.dir, cont);
      if (rep) out.reps.push(rep);
    }
  }
  return out;
}

export function slateHasTags(parsed) {
  return !!(parsed?.scene
    || (parsed?.events && parsed.events.length)
    || (parsed?.achs && parsed.achs.length)
    || (parsed?.secrets && parsed.secrets.length)
    || (parsed?.reps && parsed.reps.length));
}

export function slateFingerprint(parsed) {
  const scene = parsed?.scene;
  const events = parsed?.events || [];
  const achs = parsed?.achs || [];
  const secrets = parsed?.secrets || [];
  const reps = parsed?.reps || [];
  return JSON.stringify({
    s: scene ? [scene.location, scene.time, scene.weather] : null,
    e: events.map(e => [e.verb, e.kind, e.summary, e.deadline, e.context]),
    a: achs.map(a => [a.title, a.rarity, a.unlocked]),
    k: secrets.map(s => [s.owner, s.tier, s.knowers, s.context]),
    r: reps.map(x => [x.from, x.to, x.direction, x.cause, x.reading]),
  });
}

function stripInlineTags(line) {
  return String(line || '')
    .replace(/\[(?:SCENE|EVENT|ACH|SECRET|SEC|REP|TIME)\|[^\]]*\]/gi, '')
    .replace(/\[[^\]\n]+?\s*->\s*[^\]\n]+?\s*\|\s*[^\]]+\]/g, '');
}

/** Remove slate tag lines so later turns do not re-see them. */
export function stripSlateTags(text) {
  const src = String(text || '');
  if (!src.includes('[')) return src;
  const lines = src.split(/\r?\n/);
  if (!lines.length) return '';
  const out = [];
  let eatCont = false;
  for (const line of lines) {
    const hadTag = /\[(?:SCENE|EVENT|ACH|SECRET|SEC|REP|TIME)\|/i.test(line)
      || /\[[^\]\n]+?\s*->\s*[^\]\n]+?\s*\|\s*[^\]]+\]/.test(line);
    if (hadTag) {
      const leftover = stripInlineTags(line).trim();
      eatCont = true;
      if (leftover) out.push(leftover);
      continue;
    }
    if (eatCont && CONT_LABEL_RE.test(String(line || '').trim())) continue;
    eatCont = false;
    out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function escHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, ch =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}

function parseSlateWeather(raw) {
  const t = String(raw || '').trim();
  if (!t) return null;
  const scanned = scanWeatherCue(t);
  if (scanned) return scanned;
  if (/\s/.test(t)) {
    const m = t.match(/^(\S+)\s+(.+)$/);
    if (m && !/^[A-Za-z]/.test(m[1])) return { emoji: m[1], label: m[2] };
  }
  return { emoji: '', label: t };
}

function stampSlateTime(scene, raw, hpd) {
  const want = String(raw || '').trim();
  if (!want) return false;
  const lower = want.toLowerCase();
  const fuzzy = FUZZY_HOURS.find(f =>
    f.label.toLowerCase() === lower || lower.includes(f.label.toLowerCase()));
  let hour;
  let minute = 0;
  if (fuzzy) {
    hour = fuzzy.hour;
  } else {
    const clockHit = parseClockMention(want);
    if (clockHit && Number.isFinite(clockHit.hour)) {
      hour = clockHit.hour;
      minute = Number(clockHit.minute) || 0;
    } else {
      const cue = scanTimeCue(want);
      if (cue && Number.isFinite(cue.hour)) {
        hour = cue.hour;
        minute = Number(cue.minute) || 0;
      }
    }
  }
  if (!Number.isFinite(hour)) {
    if (want !== scene.lastTimeLabel) {
      scene.lastTimeLabel = want;
      return true;
    }
    return false;
  }
  hour = ((Math.floor(hour) % hpd) + hpd) % hpd;
  minute = Math.max(0, Math.min(59, Math.floor(minute) || 0));
  const label = formatTrackerTimeFromHour(scene.timeMode, hour, hpd, minute) || want;
  const same = scene.lastTimeHour === hour
    && Number(scene.lastTimeMinute || 0) === minute
    && scene.lastTimeLabel === label;
  scene.lastTimeHour = hour;
  scene.lastTimeMinute = minute;
  scene.lastTimeLabel = label;
  return !same;
}

/**
 * Write a parsed SCENE tag onto the scene tracker (header-style, holds the board).
 */
export function applySlateSceneStamp(scene, tag, { hoursPerDay = 24, placeId = '' } = {}) {
  if (!scene || typeof scene !== 'object' || !tag) return { changed: false };
  const hpd = Math.max(1, Number(hoursPerDay) || 24);
  let changed = false;

  const loc = String(tag.location || '').trim();
  if (loc && loc !== '—') {
    const travelHit = assertHere(scene, { placeKey: loc, placeId }, { force: true });
    if (travelHit.changed) changed = true;
  }

  const timeRaw = String(tag.time || '').trim();
  if (timeRaw && scene.time !== false) {
    if (stampSlateTime(scene, timeRaw, hpd)) changed = true;
  }

  const wxRaw = String(tag.weather || '').trim();
  if (wxRaw && scene.weather !== false) {
    const wx = parseSlateWeather(wxRaw);
    if (wx) {
      const nextEmoji = wx.emoji || scene.weatherEmoji || '🌤';
      const nextLabel = wx.label || scene.weatherLabel || '';
      if (nextLabel !== scene.weatherLabel || nextEmoji !== scene.weatherEmoji) {
        scene.weatherEmoji = nextEmoji;
        scene.weatherLabel = nextLabel;
        changed = true;
      }
    }
  }

  if (changed) {
    scene.lastClapAt = Date.now();
    scene.boardHeld = true;
    scene.pendingCue = null;
  }
  return { changed };
}

function clapRowsHtml(rows, esc) {
  return (Array.isArray(rows) ? rows : []).filter(Boolean).map(r => `
          <div class="st-clap-row">
            <span class="st-clap-k">${esc(r.k)}</span>
            <span class="st-clap-v">${esc(r.v)}</span>
          </div>`).join('');
}

function intelCardHtml(kind, summary, rows, esc) {
  return `<details class="st-chat-slate st-chat-intel st-chat-intel--${esc(kind)}" open>
  <summary class="st-chat-slate-sum">${esc(summary)}</summary>
  <div class="st-clap-chrome st-chat-slate-chrome">
    <div class="st-clap-slate">
      <div class="st-clap-slate-inner">${clapRowsHtml(rows, esc)}</div>
      <div class="st-clap-ledge" aria-hidden="true"></div>
    </div>
  </div>
</details>`;
}

export function buildChatSlateHtml(slate, { esc = escHtml } = {}) {
  const scene = slate?.scene || null;
  const events = Array.isArray(slate?.events) ? slate.events : [];
  if (!scene && !events.length) return '';

  const rows = [];
  if (scene) {
    if (scene.location) rows.push({ k: 'location', v: scene.location });
    if (scene.time) rows.push({ k: 'time', v: scene.time });
    if (scene.weather) rows.push({ k: 'weather', v: scene.weather });
  }
  const sceneBlock = clapRowsHtml(rows, esc);

  const eventBlock = events.map((ev) => {
    const kind = plotHookKindMeta(ev.kind);
    const closed = ev.verb === 'RESOLVED' || ev.verb === 'FAILED';
    const when = ev.deadline ? ` · ${ev.deadline}` : '';
    const ctx = ev.context ? ` — ${ev.context}` : '';
    const label = `${kind.emoji} ${ev.verb} ${ev.summary}${when}${ctx}`;
    return `
          <div class="st-clap-row st-chat-slate-event${closed ? ' is-closed' : ''}">
            <span class="st-clap-k">${esc(String(ev.verb || '').toLowerCase())}</span>
            <span class="st-clap-v">${esc(label)}</span>
          </div>`;
  }).join('');

  return `<details class="st-chat-slate">
  <summary class="st-chat-slate-sum">Slate</summary>
  <div class="st-clap-chrome st-chat-slate-chrome">
    <div class="st-clap-slate">
      <div class="st-clap-slate-inner">
        ${sceneBlock}${eventBlock}
      </div>
      <div class="st-clap-ledge" aria-hidden="true"></div>
    </div>
  </div>
</details>`;
}

/** Per-message feat / secret / rumor cards. Open by default, above the receipt. */
export function buildChatIntelHtml(slate, { esc = escHtml } = {}) {
  const parts = [];
  for (const a of Array.isArray(slate?.achs) ? slate.achs : []) {
    const rarity = intelRarityMeta(a.rarity);
    const title = String(a.title || 'Feat').trim() || 'Feat';
    parts.push(intelCardHtml('feat', `Feat · ${title}`, [
      { k: 'feat', v: `${rarity.mark} ${title}` },
      a.unlocked ? { k: 'unlocked', v: a.unlocked } : null,
      a.description ? { k: 'note', v: a.description } : null,
    ], esc));
  }
  for (const s of Array.isArray(slate?.secrets) ? slate.secrets : []) {
    const rarity = intelRarityMeta(s.rarity || TIER_TO_RARITY[s.tier] || 'RARE');
    const who = (s.knowers || []).length ? s.knowers.join(', ') : 'owner only';
    const owner = String(s.owner || 'Secret').trim() || 'Secret';
    parts.push(intelCardHtml('secret', `Secret · ${owner}`, [
      { k: 'secret', v: `${rarity.mark} ${rarity.label} · ${who}` },
      { k: 'stakes', v: s.context || s.title || '' },
    ], esc));
  }
  for (const r of Array.isArray(slate?.reps) ? slate.reps : []) {
    const dir = intelDirectionMeta(r.direction);
    const from = String(r.from || '').trim() || 'Someone';
    const to = String(r.to || '').trim() || 'someone';
    parts.push(intelCardHtml('rumor', `Rumor · ${from} → ${to}`, [
      { k: 'rumor', v: `${dir.emoji} ${dir.label}` },
      r.cause ? { k: 'cause', v: r.cause } : null,
      r.reading ? { k: 'reading', v: r.reading } : null,
    ], esc));
  }
  return parts.join('');
}

/** Every character turn names how long the beat took. Stripped before the next prompt. */
export function compactTurnTimeInstruct() {
  return `[TIME|+8m]
End every reply with one tag for how long this beat took. Use +Nm or +Nh. A line or a look is 1-2m. An exchange or crossing a room is 5-15m. A meal, shower, walk, wait, or ride is the real gap. If the prose already names a clock or "an hour later", the tag matches that gap and does not add a second one. Do not mention the tag or the minutes in the prose.`;
}

/** Always-on instruct: print tags only when location/time/weather, a hook, or intel changed. */
export function compactChatSlateInstruct({ motivation = false, connection = false, files = false } = {}) {
  const bits = [`${compactTurnTimeInstruct()}

Print a slate line only when something actually changed this beat — never reprint an unchanged scene or hook.

[SCENE|Location|Time|Weather]
Only if location, time, or weather/atmosphere changed. Time may be a clock (3:47 PM) or fuzzy (late afternoon). Weather is a short mood (humid, tense). This line is a scene header and is auto-applied.

[EVENT|Verb|Kind|Summary|Deadline|Context]
Verb: ADDED | UPDATED | RESOLVED | FAILED
Kind: TASK | COMMITMENT | DEADLINE | THREAT | SOCIAL | OPPORTUNITY
Only hooks added, updated, resolved, or failed this beat. Ignore cooking-step / low-stakes busywork.
Context is required on ADDED/UPDATED (stakes or origin). Deadline may be specific or vague (soon).
RESOLVED/FAILED: print once, then stop.`];

  if (motivation) {
    bits.push(`[ACH|Title|Rarity|Description]
unlocked: what triggered it (never leave empty)
Rarity: ★ COMMON | ★★ UNCOMMON | ★★★ RARE | ★★★★ EPIC | ★★★★★ LEGENDARY | 💀 SECRET
Maximum one achievement per speaking character; most beats have none. Must feel earned.

[SEC|Owner|Weight|Who Else Knows]
context: stakes (never leave empty)
Weight uses the same rarity scale. Who Else Knows is a name list, or none. Only secrets established, revealed, or spread this beat.`);
  }
  if (connection || motivation) {
    bits.push(`[From -> To | Direction]
cause/reading: what triggered the shift. short (possibly false) perception
Direction: 📈 RISING | 📉 FALLING | 🔄 MIXED | 🆕 NEW
One subject's view of another (cast or affiliation). Standing numbers are auto-applied; only print when perception changed or was established. Contradictory takes from different sources are allowed.`);
  }
  if (files) {
    bits.push(`When a physical document is shown (letter, warrant, clipping, polaroid, memo), wrap its body once in:
<aside class="st-file st-file--letter" data-title="Title" data-form="letter" data-house="Affiliation or omit">…short HTML…</aside>
Forms: letter | clipping | photo | warrant | file | note. Classed markup only — no scripts, no inline CSS. Most beats have none.`);
  }
  return bits.join('\n\n');
}

/** Strip leftover tags from a rendered .mes_text node. */
export function stripSlateFromElement(el) {
  if (!el) return false;
  const html = String(el.innerHTML || '');
  const tagged = /\[(?:SCENE|EVENT|ACH|SECRET|SEC|REP|TIME)\|/i.test(html)
    || /\[[^<]+?\s*-&gt;\s*[^<]+?\s*\|\s*[^<]+\]/.test(html)
    || /\[[^<]+?\s*->\s*[^<]+?\s*\|\s*[^<]+\]/.test(html)
    || /\b(?:unlocked|context|cause\/reading|cause|reading)\s*:/i.test(html);
  if (!tagged && !el.querySelector?.('.st-chat-slate')) return false;
  let next = html.replace(/<p>\s*\[(?:SCENE|EVENT|ACH|SECRET|SEC|REP|TIME)\|[^\]]*\]\s*<\/p>/gi, '');
  next = next.replace(/<p>\s*\[[^\]]+?\s*(?:-&gt;|->)\s*[^\]]+?\s*\|\s*[^\]]+\]\s*<\/p>/gi, '');
  next = next.replace(/\[(?:SCENE|EVENT|ACH|SECRET|SEC|REP|TIME)\|[^\]]*\]/gi, '');
  next = next.replace(/\[[^\]]+?\s*(?:-&gt;|->)\s*[^\]]+?\s*\|\s*[^\]]+\]/g, '');
  next = next.replace(/<p>\s*(?:unlocked|context|cause\/reading|cause|reading)\s*:[^<]*<\/p>/gi, '');
  if (next === html) return false;
  el.innerHTML = next;
  return true;
}

export function smokeChatSlatePure() {
  const parsed = parseSlateTags(`Hello.
[SCENE|Canal City Mall|3:47 PM|humid]
[EVENT|ADDED|THREAT|The lease|Friday|Landlord at the door]
Keep going.`);
  if (!parsed.scene || parsed.scene.location !== 'Canal City Mall') return 'SCENE location should parse';
  if (parsed.scene.time !== '3:47 PM' || parsed.scene.weather !== 'humid') return 'SCENE time/weather should parse';
  if (parsed.events.length !== 1 || parsed.events[0].verb !== 'ADDED') return 'EVENT verb should parse';
  if (parsed.events[0].kind !== 'THREAT' || parsed.events[0].summary !== 'The lease') return 'EVENT kind/summary should parse';

  const spaced = parseSlateTags('[EVENT| UPDATED | 🤝 | Pay rent | soon | Origin: lease ]');
  if (spaced.events[0]?.verb !== 'UPDATED' || spaced.events[0]?.kind !== 'COMMITMENT') {
    return 'EVENT should tolerate spaces and emoji kinds';
  }

  const stripped = stripSlateTags('Hello.\n[SCENE|A|B|C]\n[TIME|+8m]\nStay.');
  if (/\[SCENE/.test(stripped) || /\[TIME/.test(stripped) || !/Hello/.test(stripped) || !/Stay/.test(stripped)) {
    return 'stripSlateTags should drop tag lines and keep prose';
  }

  const html = buildChatSlateHtml(parsed);
  if (!html.includes('st-chat-slate') || !html.includes('Canal City Mall')) return 'html should include mini-clapper';
  if (!html.includes('The lease')) return 'html should include event rows';

  const scene = {
    enabled: true, time: true, weather: true, timeMode: 'simple',
    lastLocationKey: '', lastTimeLabel: '', lastTimeHour: null, lastTimeMinute: 0,
    weatherEmoji: '🌤', weatherLabel: 'Fair', boardHeld: false, pendingCue: { sig: 'x' },
  };
  const hit = applySlateSceneStamp(scene, parsed.scene, { hoursPerDay: 24 });
  if (!hit.changed) return 'SCENE stamp should change the board';
  if (scene.lastLocationKey !== 'Canal City Mall') return 'SCENE should write location key';
  if (scene.travel?.mode !== 'compass') return 'SCENE stamp should commit compass occupancy';
  if (scene.lastTimeHour !== 15 || scene.lastTimeMinute !== 47) return 'SCENE clock should stamp hour/minute';
  if (scene.weatherLabel !== 'humid') return 'SCENE atmosphere should write weather label';
  if (!scene.boardHeld || scene.pendingCue) return 'SCENE stamp should hold the board';

  const fuzzy = {
    enabled: true, time: true, weather: false, timeMode: 'fuzzy',
    lastLocationKey: 'Here', lastTimeLabel: '', lastTimeHour: null, lastTimeMinute: 0,
  };
  applySlateSceneStamp(fuzzy, { location: 'Here', time: 'late afternoon', weather: '' }, { hoursPerDay: 24 });
  if (fuzzy.lastTimeHour == null) return 'fuzzy time should stamp an hour';

  if (stripSlateTags('[SCENE|A|B|C]').trim()) return 'tag-only body should strip empty';

  const intel = parseSlateTags(`[ACH|First heist|★★★ RARE|Lifted the vault key]
unlocked: palmed it during the blackout
[SEC|Rin|MAJOR|Kai]
context: the key is a replica
[Mall Security -> Rin | RISING]
cause/reading: cameras caught the assist. Useful insider`);
  if (intel.achs[0]?.title !== 'First heist' || intel.achs[0]?.tier !== 'notable') return 'ACH should parse rarity onto tier';
  if (!intel.achs[0]?.unlocked) return 'ACH unlocked line is required';
  if (intel.secrets[0]?.owner !== 'Rin' || intel.secrets[0]?.tier !== 'major') return 'SEC owner/weight should parse';
  if (!intel.secrets[0]?.knowers.includes('Kai')) return 'SEC knowers should parse';
  const legacySec = parseSlateTags('[SECRET|Rin|RARE|none]\ncontext: leftover long form');
  if (legacySec.secrets[0]?.owner !== 'Rin') return 'legacy SECRET tag should still parse';
  if (intel.reps[0]?.from !== 'Mall Security' || intel.reps[0]?.direction !== 'RISING') return 'arrow REP should parse';
  if (!/Useful insider/.test(intel.reps[0]?.reading || '')) return 'cause/reading should split perception';
  const piped = parseSlateTags('[REP|Kai|Rin|FALLING]\ncause: snubbed the toast');
  if (piped.reps[0]?.from !== 'Kai' || piped.reps[0]?.direction !== 'FALLING') return 'REP pipe tag should parse';
  if (piped.reps[0]?.cause !== 'snubbed the toast') return 'REP cause line should parse';
  const dropped = parseSlateTags('[ACH|Nope|RARE|x]\nunlocked:');
  if (dropped.achs.length) return 'empty unlocked should drop ACH';
  const intelStrip = stripSlateTags('Hi.\n[ACH|A|RARE|b]\nunlocked: because\nStay.');
  if (/\[ACH/.test(intelStrip) || /unlocked:/.test(intelStrip) || !/Hi/.test(intelStrip) || !/Stay/.test(intelStrip)) {
    return 'strip should drop ACH tag and unlocked line';
  }
  const intelHtml = buildChatIntelHtml(intel);
  if (!intelHtml.includes('First heist') || !intelHtml.includes('Mall Security')) return 'html should include intel cards';
  if (!intelHtml.includes('st-chat-intel') || !/\bopen\b/.test(intelHtml)) return 'intel cards should open by default';
  const slateOnly = buildChatSlateHtml(intel);
  if (slateOnly.includes('First heist') || slateOnly.includes('st-chat-intel')) {
    return 'scene slate should not swallow feat/secret/rumor cards';
  }
  if (!compactChatSlateInstruct().includes('[TIME|+8m]')) return 'instruct should teach the turn time tag';
  if (!compactChatSlateInstruct({ motivation: true }).includes('[ACH|')) return 'instruct should grow ACH when motivation on';
  if (!compactChatSlateInstruct({ motivation: true }).includes('[SEC|')) return 'instruct should grow SEC when motivation on';
  if (compactChatSlateInstruct({ motivation: true }).includes('[SECRET|')) return 'instruct should teach SEC not SECRET';
  if (compactChatSlateInstruct().includes('[ACH|')) return 'instruct should omit ACH by default';
  if (!compactChatSlateInstruct({ connection: true }).includes('[From -> To')) return 'instruct should grow REP when connection on';
  if (!compactChatSlateInstruct({ files: true }).includes('st-file')) return 'instruct should teach file envelopes';
  if (compactChatSlateInstruct().includes('st-file')) return 'instruct should omit file envelopes by default';
  const stuck = {
    enabled: true, time: false, weather: false, timeMode: 'simple',
    lastLocationKey: 'apartment', boardHeld: true,
    travel: { mode: 'moving', fromKey: 'Kanzaki', destKey: 'train', transit: 'enRoute' },
  };
  const arrive = applySlateSceneStamp(stuck, { location: 'apartment', time: '', weather: '' });
  if (!arrive.changed || stuck.travel?.mode !== 'compass') return 'SCENE stamp should clear stuck moving';
  const secStrip = stripSlateTags('Hi.\n[SEC|Rin|RARE|none]\ncontext: leftover\nStay.');
  if (/\[SEC/.test(secStrip) || /context:/.test(secStrip) || !/Hi/.test(secStrip) || !/Stay/.test(secStrip)) {
    return 'strip should drop SEC tag and context line';
  }

  return '';
}
