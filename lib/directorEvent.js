// Director event proposals — pending beat card (not a silent prompt inject).

import {
  findCastByNameOrAlias,
  getCastMembers,
  getCastRecord,
  getDirectorRecord,
  normalizeCastPresence,
  normalizePlotHook,
  formatPlotHookLine,
} from './castCatalog.js';
import { listPlaySecrets } from './motivationCatalog.js';

export const EVENT_MODES = Object.freeze([
  { id: 'derail', label: 'Derail', tip: 'Sharp lateral beat that can redirect the scene.' },
  { id: 'twist', label: 'Twist', tip: 'Reframe what just happened with a coincidence or reveal.' },
  { id: 'advance', label: 'Advance', tip: 'Nudge the current thread forward one concrete step.' },
  { id: 'pressure', label: 'Pressure', tip: 'Raise stakes or squeeze a character without a new plotline.' },
]);

export const DIRECTOR_TAG_FACETS = Object.freeze([
  { id: 'location', label: 'Location' },
  { id: 'cast', label: 'Cast' },
  { id: 'item', label: 'Item' },
  { id: 'time', label: 'Time' },
  { id: 'mood', label: 'Mood' },
]);

export function defaultDirectorSources() {
  return {
    tags: true,
    tagFacets: { location: true, cast: true, item: true, time: true, mood: true },
    stage: true,
    inventory: true,
    inventoryOnPerson: true,
    inventoryTrunk: true,
    script: true,
    scriptStampedLore: false,
    library: true,
    reputation: true,
    motivation: true,
    events: true,
  };
}

export function mergeDirectorSources(raw) {
  const base = defaultDirectorSources();
  const s = { ...base, ...(raw && typeof raw === 'object' ? raw : {}) };
  s.tagFacets = { ...base.tagFacets, ...(raw?.tagFacets || {}) };
  return s;
}

const REWARD_KINDS = new Set(['achievement', 'item', 'secret']);

function locKey(s) {
  return String(s || '').trim().toLowerCase();
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, ch =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}

export function eventModeLabel(id) {
  return EVENT_MODES.find(m => m.id === id)?.label || '';
}

function eventCastRank(c) {
  if (c.priority === 'director') return 0;
  if (normalizeCastPresence(c) === 'inPlay') return 1;
  return 2;
}

export function eventCastOptionLabel(c) {
  const name = String(c?.name || 'Unnamed').trim() || 'Unnamed';
  const bits = [];
  if (c?.priority === 'director') bits.push('Director');
  else if (c?.priority === 'supporting') bits.push('Supporting');
  if (normalizeCastPresence(c) === 'absent') bits.push('Absent');
  return bits.length ? `${name} (${bits.join(' · ')})` : name;
}

/** Cast that can take a Director beat — Star and written-out stay out. */
export function listPlayableCast(storage) {
  return getCastMembers(storage)
    .filter(c => c.priority !== 'star' && normalizeCastPresence(c) !== 'writtenOut')
    .sort((a, b) => eventCastRank(a) - eventCastRank(b)
      || String(a.name || '').localeCompare(String(b.name || '')));
}

export function matchCast(storage, raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'object') {
    const id = String(raw.id || raw.castId || raw.characterId || '').trim();
    if (id) {
      const rec = getCastRecord(storage, id) || getCastMembers(storage).find(c => c.id === id);
      if (rec && rec.priority !== 'star' && normalizeCastPresence(rec) !== 'writtenOut') return rec;
    }
    return matchCast(storage, raw.name || raw.title || '');
  }
  const needle = String(raw).trim();
  if (!needle) return null;
  if (/^director$/i.test(needle)) {
    const director = getDirectorRecord(storage);
    if (director) return director;
  }
  const byId = getCastMembers(storage).find(c => c.id === needle);
  if (byId && byId.priority !== 'star' && normalizeCastPresence(byId) !== 'writtenOut') return byId;
  const named = findCastByNameOrAlias(storage, needle, { includeDirector: true });
  if (named && named.priority !== 'star' && normalizeCastPresence(named) !== 'writtenOut') return named;
  return null;
}

export function matchBeat(storage, raw, preferCastId = '') {
  if (raw == null || raw === '') return null;
  const obj = typeof raw === 'object' ? raw : { title: raw };
  const stepId = String(obj.id || obj.stepId || '').trim();
  const title = locKey(obj.title || obj.name || obj.beat || '');
  const who = String(obj.characterId || obj.castId || obj.character || obj.who || preferCastId || '').trim();
  let mot = {};
  try { mot = storage.getChat('motivation', { perChar: {} }); } catch { return null; }
  const rows = Object.entries(mot.perChar || {});
  const prefer = who ? rows.filter(([id]) => id === who || locKey(getCastRecord(storage, id)?.name) === locKey(who)) : rows;
  const pools = prefer.length ? [...prefer, ...rows.filter(r => !prefer.includes(r))] : rows;
  for (const [characterId, row] of pools) {
    for (const step of row?.steps || []) {
      if (stepId && step.id === stepId) {
        return { characterId, title: String(step.title || '').trim(), stepId: step.id };
      }
      if (title && locKey(step.title) === title) {
        return { characterId, title: String(step.title || '').trim(), stepId: step.id };
      }
    }
  }
  return null;
}

export function matchHook(storage, raw) {
  if (raw == null || raw === '') return null;
  const director = getDirectorRecord(storage);
  const hooks = (director?.plotHooks || []).map(h => normalizePlotHook(h)).filter(Boolean);
  if (!hooks.length) return null;
  const obj = typeof raw === 'object' ? raw : { name: raw };
  const id = String(obj.id || obj.hookId || '').trim();
  const name = locKey(obj.name || obj.title || obj.hook || '');
  if (id) {
    const hit = hooks.find(h => h.id === id);
    if (hit) return hit;
  }
  if (name) {
    const hit = hooks.find(h => locKey(h.name) === name);
    if (hit) return hit;
  }
  return null;
}

export function matchReward(storage, raw) {
  if (raw == null || raw === '') return null;
  const obj = typeof raw === 'object' ? raw : { name: raw };
  const name = String(obj.name || obj.title || obj.item || '').trim();
  if (!name) return null;
  const want = locKey(name);
  const kindHint = String(obj.kind || '').toLowerCase();

  try {
    const inv = storage.getChat('inventory', { static: [], mobile: [] });
    const items = [...(inv.mobile || []), ...(inv.static || [])];
    const item = items.find(it => locKey(it?.name) === want);
    if (item && (!kindHint || kindHint === 'item')) {
      return { kind: 'item', name: String(item.name).trim() };
    }
  } catch { /* ignore */ }

  try {
    const secrets = listPlaySecrets(storage) || [];
    const secret = secrets.find(s => locKey(s?.title) === want);
    if (secret && (!kindHint || kindHint === 'secret')) {
      return { kind: 'secret', name: String(secret.title).trim() };
    }
  } catch { /* ignore */ }

  try {
    const mot = storage.getChat('motivation', { perChar: {} });
    for (const row of Object.values(mot.perChar || {})) {
      const ach = (row?.achievements || []).find(a => locKey(a?.title) === want);
      if (ach && (!kindHint || kindHint === 'achievement')) {
        return { kind: 'achievement', name: String(ach.title).trim() };
      }
    }
  } catch { /* ignore */ }

  return null;
}

export function normalizePendingEvent(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const text = String(raw.text || raw.event || '').trim().slice(0, 600);
  if (!text) return null;
  const tags = Array.isArray(raw.tags)
    ? raw.tags.map(t => String(t).trim().slice(0, 40)).filter(Boolean).slice(0, 8)
    : [];
  const mode = EVENT_MODES.some(m => m.id === raw.mode) ? raw.mode : (raw.jumpMode ? '' : 'advance');
  const beat = raw.beat && typeof raw.beat === 'object' && (raw.beat.title || raw.beat.stepId)
    ? {
      characterId: String(raw.beat.characterId || '').trim(),
      title: String(raw.beat.title || '').trim(),
      stepId: String(raw.beat.stepId || '').trim(),
    }
    : null;
  const reward = raw.reward && typeof raw.reward === 'object' && raw.reward.name
    ? {
      kind: REWARD_KINDS.has(raw.reward.kind) ? raw.reward.kind : '',
      name: String(raw.reward.name).trim(),
    }
    : null;
  return {
    text,
    tags,
    at: Number(raw.at) || Date.now(),
    mode,
    castId: String(raw.castId || '').trim(),
    beat,
    hookId: String(raw.hookId || '').trim(),
    reward,
    eventUid: String(raw.eventUid || '').trim(),
    jumpMode: String(raw.jumpMode || '').trim(),
  };
}

/** Build a pending event from Director-check JSON + cheap catalog matches. */
export function hydrateFromDirectorJson(storage, parsed, extras = {}) {
  if (!parsed || typeof parsed !== 'object') return null;
  const text = String(parsed.event || parsed.text || '').trim().slice(0, 600);
  if (!text) return null;
  const cast = matchCast(storage, parsed.cast);
  const beat = matchBeat(storage, parsed.beat, cast?.id);
  const hook = matchHook(storage, parsed.hook);
  const reward = matchReward(storage, parsed.reward);
  return normalizePendingEvent({
    text,
    tags: parsed.tags,
    at: Date.now(),
    mode: extras.mode,
    castId: cast?.id || extras.castId || '',
    beat,
    hookId: hook?.id || extras.hookId || '',
    reward,
    eventUid: extras.eventUid,
    jumpMode: extras.jumpMode,
  });
}

export function hookLineForEvent(storage, ev) {
  if (!ev?.hookId) return '';
  const director = getDirectorRecord(storage);
  const hook = (director?.plotHooks || []).map(h => normalizePlotHook(h)).find(h => h?.id === ev.hookId);
  return hook ? formatPlotHookLine(hook, storage) : '';
}

export function beatLineForEvent(storage, ev) {
  const b = ev?.beat;
  if (!b?.title) return '';
  const who = b.characterId ? (getCastRecord(storage, b.characterId)?.name || '') : '';
  return who ? `${b.title} [${who}]` : b.title;
}

export function rewardLineForEvent(ev) {
  const r = ev?.reward;
  if (!r?.name) return '';
  const kind = r.kind ? r.kind : 'reward';
  return `${kind} · ${r.name}`;
}

export function firstHookTitle(text) {
  const line = String(text || '').trim().split(/[.!?\n]/)[0].replace(/\s+/g, ' ').trim();
  return line.slice(0, 80) || 'Director beat';
}

/** Rehydrate a Production log chip into a playable pending event. */
export function eventFromLogEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const snap = normalizePendingEvent(entry.event);
  if (snap) return snap;
  const t = String(entry.text || '').trim();
  const m = t.match(/^EVENT\s*\[([^\]]+)\]\s+[—–\-]\s+([\s\S]+)$/);
  if (m) {
    const mode = EVENT_MODES.find(x => x.label.toLowerCase() === m[1].trim().toLowerCase())?.id;
    return normalizePendingEvent({ text: m[2].trim(), mode });
  }
  const jump = t.match(/^JUMP:(\w+)\s+[—–\-]\s+([\s\S]+)$/);
  if (jump) {
    return normalizePendingEvent({ text: jump[2].trim(), jumpMode: jump[1] });
  }
  return null;
}

export function eventPaperInner(storage, ev) {
  const event = normalizePendingEvent(ev);
  if (!event) return '';
  const playable = listPlayableCast(storage);
  const inPlay = playable.filter(c => c.priority !== 'director' && normalizeCastPresence(c) === 'inPlay');
  const selected = event.castId && playable.some(c => c.id === event.castId)
    ? event.castId
    : (inPlay[0]?.id || playable.find(c => c.priority === 'director')?.id || playable[0]?.id || '');
  const mode = eventModeLabel(event.mode) || event.jumpMode || '';
  const beat = beatLineForEvent(storage, event);
  const hook = hookLineForEvent(storage, event);
  const reward = rewardLineForEvent(event);
  const opts = playable.length
    ? playable.map(c =>
      `<option value="${esc(c.id)}"${c.id === selected ? ' selected' : ''}>${esc(eventCastOptionLabel(c))}</option>`).join('')
    : '<option value="">— No cast on the board —</option>';
  const metaRow = (label, value) => value
    ? `<div class="bst-event-meta"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`
    : '';
  return `
    <div class="bst-event-punches" aria-hidden="true"><span></span><span></span><span></span></div>
    <div class="bst-event-sheet">
      <div class="bst-event-head">
        <label class="bst-event-cast">
          <span>Acting</span>
          <select data-role="event-cast">${opts}</select>
        </label>
        ${mode ? `<span class="bst-event-mode">${esc(mode)}</span>` : ''}
      </div>
      <div class="bst-event-body">${esc(event.text)}</div>
      <div class="bst-event-foot">
        ${metaRow('Beat', beat)}
        ${metaRow('Plot hook', hook)}
        ${metaRow('Potential reward', reward)}
      </div>
      <div class="bst-event-actions">
        <button type="button" class="bst-btn" data-action="event-paper-hook">Plot hook</button>
        <button type="button" class="bst-btn" data-action="event-paper-dismiss">Dismiss</button>
        <button type="button" class="bst-btn gold" data-action="event-paper-play" ${selected ? '' : 'disabled'}>Play</button>
      </div>
    </div>`;
}

function nameOfCast(storage, id) {
  return getCastRecord(storage, id)?.name || getCastMembers(storage).find(m => m.id === id)?.name || id;
}

/** Pools the Cast inject-event dialog can pin onto a forced Director check. */
export function listDirectorInjectPools(storage) {
  const beats = [];
  const achievements = [];
  try {
    const mot = storage.getChat('motivation', { perChar: {} });
    for (const [characterId, row] of Object.entries(mot.perChar || {})) {
      const who = nameOfCast(storage, characterId);
      for (const step of row?.steps || []) {
        if (!step?.id && !step?.title) continue;
        beats.push({
          key: `${characterId}:${step.id || step.title}`,
          characterId,
          stepId: String(step.id || ''),
          title: String(step.title || 'Untitled').trim(),
          who,
          unlocked: !!step.unlocked,
        });
      }
      for (const a of row?.achievements || []) {
        if (!a?.id && !a?.title) continue;
        achievements.push({
          key: `${characterId}:${a.id || a.title}`,
          characterId,
          id: String(a.id || ''),
          title: String(a.title || 'Untitled').trim(),
          who,
        });
      }
    }
  } catch { /* ignore */ }
  const hooks = (getDirectorRecord(storage)?.plotHooks || [])
    .map(h => normalizePlotHook(h))
    .filter(Boolean)
    .map(h => ({
      key: h.id,
      id: h.id,
      title: h.name,
      who: h.assignedTo ? nameOfCast(storage, h.assignedTo) : '',
      line: formatPlotHookLine(h, storage),
    }));
  const secrets = (listPlaySecrets(storage) || []).map(s => ({
    key: s.id,
    id: s.id,
    title: s.title || 'Untitled',
    who: s.ownerName || '',
    description: s.description || '',
  }));
  const cast = listPlayableCast(storage).map(c => ({
    id: c.id,
    name: c.name,
    aliases: Array.isArray(c.aliases) ? c.aliases : [],
    priority: c.priority,
  }));
  return { beats, achievements, hooks, secrets, cast };
}

/** Prompt block for user-pinned cues on a forced Director inject. */
export function formatDirectorPicksBlock(storage, picks) {
  if (!picks || typeof picks !== 'object') return '';
  const pools = listDirectorInjectPools(storage);
  const lines = [];
  const cast = picks.castId ? matchCast(storage, picks.castId) : null;
  if (cast) {
    const alias = String(picks.alias || '').trim();
    const useAlias = alias && locKey(alias) !== locKey(cast.name);
    lines.push(useAlias
      ? `- Cast: ${cast.name} (id ${cast.id}) — write the beat around them and use the alias “${alias}” in the event text. JSON "cast" must be this id or name.`
      : `- Cast: ${cast.name} (id ${cast.id}) — write the beat around them. JSON "cast" must be this id or name.`);
  }
  for (const key of picks.beatIds || []) {
    const beat = pools.beats.find(b => b.key === key);
    if (beat) {
      lines.push(`- Motivation beat: “${beat.title}” (${beat.who}) — JSON "beat" must be this title. Prefer advancing this beat.`);
    }
  }
  for (const id of picks.hookIds || []) {
    const hook = pools.hooks.find(h => h.id === id || h.key === id);
    if (hook) {
      lines.push(`- Plot hook: ${hook.line || hook.title} — JSON "hook" must be this name.`);
    }
  }
  for (const id of picks.secretIds || []) {
    const secret = pools.secrets.find(s => s.id === id || s.key === id);
    if (secret) {
      lines.push(`- Secret: “${secret.title}” (owner ${secret.who || 'unknown'}) — weave this in; JSON reward may be {"kind":"secret","name":"${secret.title}"}.`);
    }
  }
  for (const key of picks.achievementIds || []) {
    const ach = pools.achievements.find(a => a.key === key);
    if (ach) {
      lines.push(`- Achievement: “${ach.title}” (${ach.who}) — JSON reward may be {"kind":"achievement","name":"${ach.title}"}.`);
    }
  }
  return lines.join('\n');
}

export function smokeDirectorInjectPure() {
  try {
    if (normalizeCastPresence({ priority: 'star', presence: 'absent' }) !== 'absent') {
      return 'star may be marked absent';
    }
    if (normalizeCastPresence({ priority: 'star', presence: 'writtenOut' }) !== 'inPlay') {
      return 'star cannot be written out';
    }
    if (normalizeCastPresence({ priority: 'star' }) !== 'inPlay') {
      return 'star defaults to in play';
    }
    const fake = {
      getChat(mod, def) {
        if (mod === 'cast') {
          return {
            characters: [
              { id: 'star1', name: 'Weslie', priority: 'star', presence: 'absent', aliases: [] },
              { id: 'dir1', name: 'Dir', priority: 'director', plotHooks: [{ id: 'h1', name: 'The Letter' }] },
              { id: 'lead1', name: 'Hawks', priority: 'lead', aliases: ['Keigo'] },
            ],
          };
        }
        if (mod === 'motivation') {
          return {
            perChar: {
              lead1: {
                steps: [{ id: 's1', title: 'Find the letter', unlocked: true }],
                achievements: [{ id: 'a1', title: 'Wings clipped' }],
                secrets: [{ id: 'sec1', title: 'Quirk origin', knownBy: [], unawareBy: [] }],
              },
            },
          };
        }
        if (mod === 'reputation') return { personal: [], house: [] };
        return def || {};
      },
    };
    const pools = listDirectorInjectPools(fake);
    if (!pools.hooks.some(h => h.id === 'h1')) return 'hooks pool missing plot hook';
    if (!pools.beats.some(b => b.stepId === 's1')) return 'beats pool missing motivation step';
    if (!pools.secrets.some(s => s.title === 'Quirk origin')) return 'secrets pool missing filed secret';
    if (!pools.achievements.some(a => a.title === 'Wings clipped')) return 'achievements pool missing row';
    const hawks = pools.cast.find(c => c.id === 'lead1');
    if (!hawks || !hawks.aliases.includes('Keigo')) return 'cast pool missing alias';
    const block = formatDirectorPicksBlock(fake, {
      castId: 'lead1',
      alias: 'Keigo',
      hookIds: ['h1'],
      beatIds: ['lead1:s1'],
    });
    if (!/Keigo/.test(block) || !/Letter/.test(block) || !/Find the letter/.test(block)) {
      return 'picks block should name alias, hook, and beat';
    }
    return '';
  } catch (err) {
    return err?.message || String(err);
  }
}
