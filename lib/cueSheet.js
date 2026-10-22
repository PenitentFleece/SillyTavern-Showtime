// Cue Sheet: ordered Cue turns. Pure state machine — Cast owns generate/wait.

export const CUE_SHEET_MODES = Object.freeze(['once', 'repeat', 'untilDisrupted']);
export const CUE_SHEET_BEAT_CAP = 600;

export const CUE_SHEET_MODE_META = Object.freeze({
  once: { id: 'once', label: 'Once' },
  repeat: { id: 'repeat', label: 'Repeat' },
  untilDisrupted: { id: 'untilDisrupted', label: 'Until disrupted' },
});

function uid() {
  return crypto?.randomUUID?.() ?? (`cs_${Math.random().toString(36).slice(2, 10)}`);
}

export function clipCueSheetBeat(raw) {
  const flat = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!flat) return '';
  if (flat.length <= CUE_SHEET_BEAT_CAP) return flat;
  return `${flat.slice(0, Math.max(1, CUE_SHEET_BEAT_CAP - 1)).trimEnd()}…`;
}

export function defaultCueSheet() {
  return { slots: [], mode: 'once', cursor: 0 };
}

export function makeCueSheetSlot(characterId, beat = '') {
  const id = String(characterId || '').trim();
  if (!id) return null;
  return { id: uid(), characterId: id, beat: clipCueSheetBeat(beat) };
}

export function normalizeCueSheetSlot(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const characterId = String(raw.characterId || '').trim();
  if (!characterId) return null;
  const id = String(raw.id || '').trim() || uid();
  return { id, characterId, beat: clipCueSheetBeat(raw.beat) };
}

export function normalizeCueSheet(raw) {
  const mode = CUE_SHEET_MODES.includes(raw?.mode) ? raw.mode : 'once';
  const slots = Array.isArray(raw?.slots)
    ? raw.slots.map(normalizeCueSheetSlot).filter(Boolean)
    : [];
  let cursor = Number(raw?.cursor);
  if (!Number.isInteger(cursor) || cursor < 0) cursor = 0;
  if (slots.length && cursor > slots.length) cursor = slots.length;
  return { slots, mode, cursor };
}

function presenceOf(char) {
  if (!char) return '';
  const v = String(char.presence || 'inPlay');
  if (char.priority === 'star') return v === 'absent' ? 'absent' : 'inPlay';
  return (v === 'absent' || v === 'writtenOut') ? v : 'inPlay';
}

export function slotIsCueable(slot, members, { allowAbsent = true } = {}) {
  const char = members instanceof Map ? members.get(slot?.characterId) : null;
  if (!char || char.priority === 'star') return false;
  const p = presenceOf(char);
  if (p === 'writtenOut') return false;
  if (!allowAbsent && p === 'absent') return false;
  return true;
}

export function sheetIsDisrupted(slots, members) {
  const list = Array.isArray(slots) ? slots : [];
  const byId = members instanceof Map ? members : new Map();
  if (!list.length) return false;
  for (const slot of list) {
    const char = byId.get(slot?.characterId);
    if (!char || char.priority === 'star') return true;
    const p = presenceOf(char);
    if (p === 'absent' || p === 'writtenOut') return true;
  }
  return false;
}

/**
 * Next action before firing a Cue.
 * @returns {{ kind: 'cue', index: number, slot: object } | { kind: 'hold', reason: string }}
 */
export function planCueSheetStep({ slots, mode, index, members } = {}) {
  const list = Array.isArray(slots) ? slots : [];
  if (!list.length) return { kind: 'hold', reason: 'empty' };
  const byId = members instanceof Map ? members : new Map();
  const until = mode === 'untilDisrupted';
  if (until && sheetIsDisrupted(list, byId)) {
    return { kind: 'hold', reason: 'disrupted' };
  }

  let i = Number(index);
  if (!Number.isInteger(i) || i < 0) i = 0;
  const n = list.length;

  if (mode === 'once') {
    for (let k = i; k < n; k++) {
      if (slotIsCueable(list[k], byId, { allowAbsent: true })) {
        return { kind: 'cue', index: k, slot: list[k] };
      }
    }
    return { kind: 'hold', reason: i >= n ? 'done' : 'noneCueable' };
  }

  if (until) {
    if (i >= n) i = 0;
    const slot = list[i];
    if (!slot) return { kind: 'hold', reason: 'empty' };
    return { kind: 'cue', index: i, slot };
  }

  for (let step = 0; step < n; step++) {
    const k = (i + step) % n;
    if (slotIsCueable(list[k], byId, { allowAbsent: true })) {
      return { kind: 'cue', index: k, slot: list[k] };
    }
  }
  return { kind: 'hold', reason: 'noneCueable' };
}

export function advanceCueSheetIndex(mode, cuedIndex, slotCount) {
  const next = (Number(cuedIndex) || 0) + 1;
  if (mode === 'once') return next;
  const n = Math.max(0, Number(slotCount) || 0);
  if (!n) return 0;
  return next % n;
}

export function moveCueSheetSlot(slots, slotId, dir) {
  const list = Array.isArray(slots) ? slots.slice() : [];
  const id = String(slotId || '');
  const i = list.findIndex(s => s && s.id === id);
  const j = i + Number(dir);
  if (i < 0 || j < 0 || j >= list.length) return list;
  [list[i], list[j]] = [list[j], list[i]];
  return list;
}

function mapOf(rows) {
  const m = new Map();
  for (const r of rows) m.set(r.id, r);
  return m;
}

export function smokeCueSheetPure() {
  const a = { id: 'a', priority: 'lead', presence: 'inPlay' };
  const b = { id: 'b', priority: 'foil', presence: 'inPlay' };
  const c = { id: 'c', priority: 'major', presence: 'writtenOut' };
  const star = { id: 'star', priority: 'star', presence: 'inPlay' };
  const members = mapOf([a, b, c, star]);
  const slots = [
    { id: 's1', characterId: 'a', beat: '' },
    { id: 's2', characterId: 'b', beat: 'look at A' },
  ];

  const first = planCueSheetStep({ slots, mode: 'once', index: 0, members });
  if (first.kind !== 'cue' || first.index !== 0) return `once-0: ${first.kind} ${first.index}`;
  const second = planCueSheetStep({ slots, mode: 'once', index: 1, members });
  if (second.kind !== 'cue' || second.index !== 1) return `once-1: ${second.kind} ${second.index}`;
  const done = planCueSheetStep({ slots, mode: 'once', index: 2, members });
  if (done.kind !== 'hold' || done.reason !== 'done') return `once-done: ${done.kind} ${done.reason}`;

  const wrap = planCueSheetStep({ slots, mode: 'repeat', index: 2, members });
  if (wrap.kind !== 'cue' || wrap.index !== 0) return `repeat-wrap: ${wrap.kind} ${wrap.index}`;
  if (advanceCueSheetIndex('repeat', 1, 2) !== 0) return 'repeat-advance';

  const skipSlots = [
    { id: 'sx', characterId: 'c', beat: '' },
    { id: 'sa', characterId: 'a', beat: '' },
  ];
  const skip = planCueSheetStep({ slots: skipSlots, mode: 'once', index: 0, members });
  if (skip.kind !== 'cue' || skip.index !== 1) return `skip-writtenOut: ${skip.kind} ${skip.index}`;

  const disruptedMembers = mapOf([a, { ...b, presence: 'absent' }]);
  const halt = planCueSheetStep({
    slots, mode: 'untilDisrupted', index: 0, members: disruptedMembers,
  });
  if (halt.kind !== 'hold' || halt.reason !== 'disrupted') {
    return `until-absent: ${halt.kind} ${halt.reason}`;
  }
  const written = planCueSheetStep({
    slots: [{ id: 's1', characterId: 'c', beat: '' }],
    mode: 'untilDisrupted',
    index: 0,
    members,
  });
  if (written.kind !== 'hold' || written.reason !== 'disrupted') {
    return `until-writtenOut: ${written.kind} ${written.reason}`;
  }
  const missing = planCueSheetStep({
    slots: [{ id: 's9', characterId: 'gone', beat: '' }],
    mode: 'untilDisrupted',
    index: 0,
    members,
  });
  if (missing.kind !== 'hold' || missing.reason !== 'disrupted') {
    return `until-missing: ${missing.kind} ${missing.reason}`;
  }

  const loop = planCueSheetStep({ slots, mode: 'untilDisrupted', index: 2, members });
  if (loop.kind !== 'cue' || loop.index !== 0) return `until-wrap: ${loop.kind} ${loop.index}`;

  const empty = planCueSheetStep({ slots: [], mode: 'once', index: 0, members });
  if (empty.kind !== 'hold' || empty.reason !== 'empty') return `empty: ${empty.reason}`;

  const starSkip = planCueSheetStep({
    slots: [
      { id: 'ss', characterId: 'star', beat: '' },
      { id: 'sa', characterId: 'a', beat: '' },
    ],
    mode: 'repeat',
    index: 0,
    members,
  });
  if (starSkip.kind !== 'cue' || starSkip.index !== 1) return `skip-star: ${starSkip.index}`;

  const none = planCueSheetStep({
    slots: [{ id: 'sc', characterId: 'c', beat: '' }],
    mode: 'repeat',
    index: 0,
    members,
  });
  if (none.kind !== 'hold' || none.reason !== 'noneCueable') return `noneCueable: ${none.reason}`;

  const n = normalizeCueSheet({
    mode: 'nope',
    slots: [{ characterId: 'a', beat: `x${'y'.repeat(700)}` }, { beat: 'no-id' }],
  });
  if (n.mode !== 'once' || n.slots.length !== 1) return 'normalize-shape';
  if (n.slots[0].beat.length > CUE_SHEET_BEAT_CAP) return 'normalize-beat-cap';

  const moved = moveCueSheetSlot(slots, 's1', 1);
  if (moved[0].id !== 's2' || moved[1].id !== 's1') return 'move-slot';

  return '';
}
