// Event-driven tracker deltas — shared by Cast Audit (one character) and Receipt
// filing (whole party, per turn).
//
// Both pipelines used to ask the model for a guessed FINAL absolute number per
// tracker ("thirst": 80). That makes it easy for a scene to clearly show an action
// (a bottle unscrewed and tilted back, water spilling into a mouth) without the
// bar moving, because the model has nothing concrete to anchor the final number to.
//
// Instead, the model builds an ordered "events" list — one entry per discrete
// narrative action that moves a tracker, each carrying its OWN signed delta and a
// short reason. Code sums those deltas onto the character's current value. The
// final apply (difficulty scaling, condition caps, writing the stat) still happens
// at each call site exactly as before — this module only turns "events" into
// "proposed deltas per tracker" so that step has something auditable to work from.

import { resolveTrackerId } from './castAudit.js';
import { extractJsonValue } from './jsonExtract.js';

export function coerceStatDelta(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.max(-25, Math.min(25, Math.round(v)));
  if (typeof v === 'string') {
    const cleaned = String(v).replace(/[^0-9+\-.]/g, '').trim();
    if (!cleaned || !/[0-9]/.test(cleaned)) return null;
    const n = Number(cleaned);
    if (Number.isFinite(n)) return Math.max(-25, Math.min(25, Math.round(n)));
  }
  return null;
}

/** JSON-schema fragment for an `events` array. `withActor` adds the actor field (party-wide filing). */
export function statEventsSchema(trackerIds = [], { withActor = false, withKind = false, maxItems = 24 } = {}) {
  const properties = {
    action: { type: 'string' },
    trackerId: { type: 'string' },
    delta: { type: 'number' },
    reason: { type: 'string' },
  };
  if (withActor) properties.actor = { type: 'string' };
  if (withKind) properties.kind = { type: 'string' };
  return {
    type: 'array',
    maxItems,
    items: { type: 'object', properties },
  };
}

/** Prompt rules telling the model to log discrete per-action deltas instead of a guessed final number. */
export function statEventsPromptRules(idList = [], { withActor = false } = {}) {
  const ids = (idList || []).length ? idList.join(', ') : 'the listed ids';
  const shape = withActor
    ? '{"actor":"","action":"short present-tense description","trackerId":"","delta":0,"reason":"short clause from the text"}'
    : '{"action":"short present-tense description","trackerId":"","delta":0,"reason":"short clause from the text"}';
  return [
    `Before stating any tracker number, build an ordered "events" list — one entry per discrete action that visibly moves a tracker (eating, drinking, injury, rest, exertion, toileting, washing — including already-happened/physically-described cases, and paraphrased physical actions that never use the bare verb).`,
    `Each event is ${shape}. trackerId MUST be one of: ${ids}. "delta" is the signed change THAT action causes on its own (e.g. a full glass of water might be +4 thirst; a short walk might be -1 energy) — never the character's new absolute number.`,
    `If nothing in the scene moves a tracker, leave it out of events entirely — the current value carries forward unchanged. Several small events on the same tracker are fine; they add together.`,
  ].join('\n');
}

function foldActor(s) {
  return String(s || '').trim().toLowerCase();
}

function resolveActorName(raw, actors = []) {
  const key = foldActor(raw);
  if (!key || !actors.length) return raw ? String(raw).trim() : '';
  for (const name of actors) {
    if (foldActor(name) === key) return name;
  }
  for (const name of actors) {
    const nk = foldActor(name);
    if (nk && nk.length >= 2 && (nk.includes(key) || key.includes(nk))) return name;
  }
  return String(raw || '').trim();
}

/**
 * Pulls a validated events array out of parsed JSON (object with `.events`, a bare
 * array, or raw text). Entries with no resolvable trackerId or a zero delta are dropped.
 */
export function parseStatEvents(src, { trackerIds = [], actors = [] } = {}) {
  let raw = src;
  if (typeof raw === 'string') raw = extractJsonValue(raw, { prefer: 'object' });
  const list = Array.isArray(raw?.events) ? raw.events : (Array.isArray(raw) ? raw : []);
  const trackerList = Array.isArray(trackerIds) ? trackerIds.map(id => ({ id })) : [];
  const out = [];
  for (const it of list) {
    if (!it || typeof it !== 'object') continue;
    const trackerId = resolveTrackerId(it.trackerId ?? it.tracker ?? it.id, trackerList)
      || (!trackerList.length ? String(it.trackerId ?? it.tracker ?? it.id ?? '').trim() : '');
    const delta = coerceStatDelta(it.delta ?? it.amount ?? it.change);
    if (!trackerId || delta == null || delta === 0) continue;
    const actorRaw = String(it.actor ?? it.who ?? it.character ?? '').trim();
    out.push({
      actor: resolveActorName(actorRaw, actors),
      kind: String(it.kind || 'stat').trim().toLowerCase() || 'stat',
      trackerId,
      delta,
      action: String(it.action ?? it.event ?? '').trim().slice(0, 120),
      reason: String(it.reason ?? it.why ?? '').trim().slice(0, 160),
    });
  }
  return out;
}

/**
 * Groups `kind: "stat"` events by actor (case-insensitive) then by trackerId,
 * summing deltas and collecting the action/reason lines that produced them.
 * @returns {Map<string, { actor: string, trackers: Map<string, { delta: number, lines: string[] }> }>}
 */
export function groupStatEvents(events = []) {
  const byActor = new Map();
  for (const ev of events || []) {
    if (!ev || ev.kind !== 'stat') continue;
    const key = foldActor(ev.actor) || '__self__';
    if (!byActor.has(key)) byActor.set(key, { actor: ev.actor || '', trackers: new Map() });
    const bucket = byActor.get(key);
    if (!bucket.trackers.has(ev.trackerId)) bucket.trackers.set(ev.trackerId, { delta: 0, lines: [] });
    const t = bucket.trackers.get(ev.trackerId);
    t.delta += ev.delta;
    const line = ev.action || ev.reason;
    if (line) t.lines.push(line);
  }
  return byActor;
}

/** Short "Name does X: +15 Label" style line for a single stat event, for printed receipts. */
export function formatStatEventLine(ev, { label = '' } = {}) {
  if (!ev) return '';
  const who = String(ev.actor || '').trim();
  const action = String(ev.action || ev.reason || '').trim();
  if (ev.kind === 'stat') {
    const sign = ev.delta > 0 ? '+' : '';
    const tag = label || ev.trackerId;
    const lead = [who, action].filter(Boolean).join(' ');
    return `${lead || tag}: ${sign}${ev.delta} ${tag}`.trim();
  }
  const to = String(ev.to || ev.target || '').trim();
  const bits = [who, action || ev.kind, to ? `→ ${to}` : ''].filter(Boolean);
  return bits.join(' ');
}

/** Lightweight invariant checks (no DOM). Returns '' on success. */
export function smokeStatEventsPure() {
  try {
    if (coerceStatDelta(15) !== 15) return 'positive int delta';
    if (coerceStatDelta(-8) !== -8) return 'negative int delta';
    if (coerceStatDelta('+15') !== 15) return 'signed string delta';
    if (coerceStatDelta(500) !== 25) return 'delta should clamp to +25';
    if (coerceStatDelta(-500) !== -25) return 'delta should clamp to -25';
    if (coerceStatDelta('nope') != null) return 'non-numeric delta should be null';

    const trackerIds = ['thirst', 'energy'];
    const parsed = parseStatEvents(
      '{"events":[{"actor":"Weslie","action":"drinks water","trackerId":"Hydration","delta":15,"reason":"unscrews bottle"},{"actor":"Weslie","action":"walks a distance","trackerId":"energy","delta":-2},{"actor":"Hawks","action":"nothing","trackerId":"thirst","delta":0}]}',
      { trackerIds, actors: ['Weslie', 'Hawks'] },
    );
    if (parsed.length !== 2) return 'zero-delta events should be dropped';
    if (parsed[0].trackerId !== 'thirst') return 'display-name trackerId should resolve (Hydration -> thirst)';
    if (parsed[0].actor !== 'Weslie') return 'actor should resolve to the known roster name';

    const grouped = groupStatEvents([
      { actor: 'Weslie', kind: 'stat', trackerId: 'thirst', delta: 15, action: 'sips water' },
      { actor: 'Weslie', kind: 'stat', trackerId: 'thirst', delta: 10, action: 'finishes the bottle' },
      { actor: 'Weslie', kind: 'stat', trackerId: 'energy', delta: -2, action: 'walks a distance' },
      { actor: 'Hawks', kind: 'stat', trackerId: 'energy', delta: -5, action: 'carries the pack' },
      { actor: 'Weslie', kind: 'move', to: 'Exterior', action: 'heads outside' },
    ]);
    const weslie = grouped.get('weslie');
    if (!weslie) return 'actor group should exist for weslie';
    if (weslie.trackers.get('thirst')?.delta !== 25) return 'same-tracker events for one actor should sum';
    if (weslie.trackers.get('thirst')?.lines.length !== 2) return 'summed tracker should keep both action lines';
    if (weslie.trackers.has('move')) return 'non-stat kinds should not land in the stat grouping';
    const hawks = grouped.get('hawks');
    if (hawks?.trackers.get('energy')?.delta !== -5) return 'actors should not bleed into each other\'s totals';

    const line = formatStatEventLine(
      { actor: 'Weslie', kind: 'stat', trackerId: 'thirst', delta: 15, action: 'drinks water' },
      { label: 'Hydration' },
    );
    if (!/Weslie drinks water: \+15 Hydration/.test(line)) return 'stat event line should read as Name action: +delta Label';

    const rules = statEventsPromptRules(['thirst', 'energy'], { withActor: true });
    if (!/"actor"/.test(rules) || !/signed change/i.test(rules)) return 'actor-aware prompt rules should mention actor and signed delta';
    return '';
  } catch (err) {
    return err?.message || String(err);
  }
}
