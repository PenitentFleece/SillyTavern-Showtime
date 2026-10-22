// Cast condition effects — Title + Description, nature × duration, source stamp.

function uid() {
  return crypto?.randomUUID?.() ?? (`fx_${Math.random().toString(36).slice(2, 10)}`);
}

export const CONDITION_NATURES = Object.freeze([
  { id: 'injury', label: 'Injury', color: '#7a1f1f' },
  { id: 'status', label: 'Status', color: '#c9a24a' },
  { id: 'trait', label: 'Trait', color: '#6b8f4a' },
  { id: 'bond', label: 'Bond', color: '#8a4a6b' },
  { id: 'curse', label: 'Curse', color: '#4a2c5a' },
]);

export const CONDITION_DURATIONS = Object.freeze([
  { id: 'fleeting', label: 'Fleeting', color: '#c9b87a' },
  { id: 'temporary', label: 'Temporary', color: '#c9a24a' },
  { id: 'passive', label: 'Passive', color: '#8a6a3d' },
  { id: 'chronic', label: 'Chronic', color: '#c4772b' },
  { id: 'permanent', label: 'Permanent', color: '#7a1f1f' },
]);

export const CONDITION_NATURE_IDS = Object.freeze(CONDITION_NATURES.map(n => n.id));
export const CONDITION_DURATION_IDS = Object.freeze(CONDITION_DURATIONS.map(d => d.id));
export const CONDITION_SOURCE_KINDS = Object.freeze(['wardrobe', 'props', 'inventory']);

const NATURE_MAP = Object.fromEntries(CONDITION_NATURES.map(n => [n.id, n]));
const DURATION_MAP = Object.fromEntries(CONDITION_DURATIONS.map(d => [d.id, d]));

export const CONDITION_PRESETS = Object.freeze([
  { id: 'hurt', name: 'Hurt', nature: 'injury', duration: 'fleeting', description: 'Fresh sting, already fading.', group: 'injury', ladder: 'injury', rank: 1 },
  { id: 'injured', name: 'Injured', nature: 'injury', duration: 'temporary', description: 'Hurt that still limits them.', group: 'injury', ladder: 'injury', rank: 2 },
  { id: 'wounded', name: 'Wounded', nature: 'injury', duration: 'temporary', description: 'Open or fresh hurt.', group: 'injury', ladder: 'injury', rank: 3 },
  { id: 'critical', name: 'Critical', nature: 'injury', duration: 'temporary', description: 'Grave damage, hanging on.', group: 'injury', ladder: 'injury', rank: 4 },
  { id: 'dying', name: 'Dying', nature: 'injury', duration: 'fleeting', description: 'At the edge; needs care now.', group: 'injury', ladder: 'injury', rank: 5 },
  { id: 'scarred', name: 'Scarred', nature: 'injury', duration: 'permanent', description: 'Lasting mark, already closed.', group: 'injury', ladder: 'injury', rank: 0 },
  { id: 'fatigued', name: 'Fatigued', nature: 'status', duration: 'temporary', description: 'Spent in the bones.', group: 'energy', ladder: 'energy', rank: 1 },
  { id: 'lethargic', name: 'Lethargic', nature: 'status', duration: 'temporary', description: 'Slow and heavy.', group: 'energy', ladder: 'energy', rank: 2 },
  { id: 'delirious', name: 'Delirious', nature: 'status', duration: 'fleeting', description: 'Fog, wrong thoughts.', group: 'energy', ladder: 'energy', rank: 3 },
  { id: 'manic', name: 'Manic', nature: 'status', duration: 'temporary', description: "Too bright, won't stop.", group: 'energy' },
  { id: 'exhausted', name: 'Exhausted', nature: 'status', duration: 'temporary', description: 'Spent; slow and heavy.', group: 'energy' },
  { id: 'depressed', name: 'Depressed', nature: 'status', duration: 'chronic', description: 'Hard to rise.', group: 'energy', capStat: 'energy', capAt: 55 },
  { id: 'adrenaline', name: 'Adrenaline', nature: 'status', duration: 'fleeting', description: 'Wired; the drop comes after.', group: 'energy', onRemoveStat: 'energy', onRemoveDelta: -40 },
  { id: 'drunk', name: 'Drunk', nature: 'status', duration: 'temporary', description: 'Impaired, flushed, unsteady.', group: 'other' },
  { id: 'feverish', name: 'Feverish', nature: 'status', duration: 'temporary', description: 'Heat, ache, fog.', group: 'other' },
  { id: 'frightened', name: 'Frightened', nature: 'status', duration: 'fleeting', description: 'Startle and dread, passing.', group: 'other' },
  { id: 'smitten', name: 'Smitten', nature: 'bond', duration: 'passive', description: 'Soft on someone.', group: 'other' },
  { id: 'oathbound', name: 'Oathbound', nature: 'bond', duration: 'permanent', description: 'A vow that still binds.', group: 'other' },
  { id: 'hexed', name: 'Hexed', nature: 'curse', duration: 'chronic', description: 'Lingering wrongness.', group: 'other' },
  { id: 'focused', name: 'Focused', nature: 'trait', duration: 'passive', description: 'Sharp attention, in character.', group: 'other' },
]);

export const CONDITION_PRESET_GROUPS = Object.freeze([
  { id: 'injury', label: 'Injury' },
  { id: 'energy', label: 'Energy' },
  { id: 'other', label: 'Other' },
]);

const TRACKER_STAT_IDS = Object.freeze(['health', 'energy', 'hunger', 'thirst', 'bathroom', 'hygiene']);

export function natureMeta(id) {
  return NATURE_MAP[id] || NATURE_MAP.status;
}

export function durationMeta(id) {
  return DURATION_MAP[id] || DURATION_MAP.temporary;
}

export function clampConditionNature(raw, fallback = 'status') {
  const id = String(raw || '').trim().toLowerCase();
  return CONDITION_NATURE_IDS.includes(id) ? id : fallback;
}

export function clampConditionDuration(raw, fallback = 'temporary') {
  const id = String(raw || '').trim().toLowerCase();
  return CONDITION_DURATION_IDS.includes(id) ? id : fallback;
}

export function clampConditionSourceKind(raw) {
  const id = String(raw || '').trim().toLowerCase();
  return CONDITION_SOURCE_KINDS.includes(id) ? id : '';
}

function clampStatId(raw) {
  const id = String(raw || '').trim().toLowerCase();
  return TRACKER_STAT_IDS.includes(id) ? id : '';
}

function clampCapAt(raw) {
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function clampDelta(raw) {
  if (raw == null || raw === '') return 0;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  return Math.max(-100, Math.min(100, Math.round(n)));
}

function modsForName(name, raw = {}) {
  const preset = findConditionPreset(name);
  const capStat = clampStatId(raw.capStat ?? preset?.capStat);
  const onRemoveStat = clampStatId(raw.onRemoveStat ?? preset?.onRemoveStat);
  return {
    capStat,
    capAt: capStat ? clampCapAt(raw.capAt ?? preset?.capAt) : null,
    onRemoveStat,
    onRemoveDelta: onRemoveStat ? clampDelta(raw.onRemoveDelta ?? preset?.onRemoveDelta) : 0,
  };
}

export function normalizeConditionItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = String(raw.name || raw.title || '').trim().slice(0, 80);
  if (!name) return null;
  const sourceKind = clampConditionSourceKind(raw.sourceKind);
  const mods = modsForName(name, raw);
  return {
    id: String(raw.id || '').trim() || uid(),
    name,
    description: String(raw.description || '').trim().slice(0, 240),
    nature: clampConditionNature(raw.nature || findConditionPreset(name)?.nature),
    duration: clampConditionDuration(raw.duration || findConditionPreset(name)?.duration),
    source: String(raw.source || '').trim().slice(0, 120),
    sourceKind,
    sourceId: sourceKind ? String(raw.sourceId || '').trim() : '',
    ...mods,
  };
}

export function normalizeConditions(raw) {
  const arr = Array.isArray(raw) ? raw : [];
  const out = [];
  const seen = new Set();
  for (const row of arr) {
    const item = normalizeConditionItem(row);
    if (!item) continue;
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

export function formatConditionStamp(item) {
  return String(item?.source || '').trim();
}

/** `Drunk (Status · Temporary) · Source: leftover wine` */
export function formatConditionLine(item) {
  const row = normalizeConditionItem(item);
  if (!row) return '';
  const nature = natureMeta(row.nature).label;
  const duration = durationMeta(row.duration).label;
  const stamp = formatConditionStamp(row);
  const bits = [`${row.name} (${nature} · ${duration})`];
  if (stamp) bits.push(`Source: ${stamp}`);
  return bits.join(' · ');
}

export function formatConditionsBlock(list, { max = 6 } = {}) {
  return normalizeConditions(list)
    .slice(0, max)
    .map(formatConditionLine)
    .filter(Boolean);
}

export function findConditionPreset(idOrName) {
  const k = String(idOrName || '').trim().toLowerCase();
  if (!k) return null;
  return CONDITION_PRESETS.find(p => p.id === k || p.name.toLowerCase() === k) || null;
}

export function formatConditionLadderPrompt() {
  return [
    'Injury leftover ladder (one step, do not stack): Hurt → Injured → Wounded → Critical → Dying. Scarred = closed aftermath.',
    'Energy leftover ladder (one step, do not stack): Fatigued → Lethargic → Delirious. Manic is the high/wired leftover. Adrenaline is fleeting — remove it when it wears off (do not rename in place); removal crashes Energy.',
    'Depressed caps Energy until removed. Do not file a condition that only restates a tracker label (Wounded, Exhausted, Tired, Healthy). Source names the cause, not Health or Energy.',
  ].join('\n');
}

function clampStat01(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

function defaultStatValue(statId) {
  return (statId === 'bathroom' || statId === 'hygiene') ? 0 : 100;
}

function readStat(char, statId) {
  if (!char?.stats) return defaultStatValue(statId);
  if (char.stats.custom && Object.prototype.hasOwnProperty.call(char.stats.custom, statId)) {
    return clampStat01(char.stats.custom[statId]);
  }
  const cur = char.stats[statId];
  if (typeof cur === 'number' && Number.isFinite(cur)) return clampStat01(cur);
  return defaultStatValue(statId);
}

function writeStat(char, statId, value) {
  if (!char.stats) char.stats = {};
  const next = clampStat01(value);
  if (char.stats.custom && Object.prototype.hasOwnProperty.call(char.stats.custom, statId)) {
    char.stats.custom[statId] = next;
    return;
  }
  char.stats[statId] = next;
}

/** Lowest live cap for a tracker, else 100. */
export function conditionStatCap(char, statId) {
  const want = clampStatId(statId);
  if (!want) return 100;
  let cap = 100;
  for (const it of normalizeConditions(char?.conditions)) {
    if (it.capStat !== want || it.capAt == null) continue;
    cap = Math.min(cap, it.capAt);
  }
  return cap;
}

export function conditionCapSource(char, statId) {
  const want = clampStatId(statId);
  if (!want) return null;
  let best = null;
  for (const it of normalizeConditions(char?.conditions)) {
    if (it.capStat !== want || it.capAt == null) continue;
    if (!best || it.capAt < best.capAt) best = it;
  }
  return best;
}

/** Clamp stored stats down to live caps. */
export function applyConditionCaps(char) {
  if (!char) return false;
  const ids = new Set();
  for (const it of normalizeConditions(char.conditions)) {
    if (it.capStat) ids.add(it.capStat);
  }
  if (!ids.size) return false;
  if (!char.stats) char.stats = {};
  let changed = false;
  for (const id of ids) {
    const cap = conditionStatCap(char, id);
    const cur = readStat(char, id);
    if (cur > cap) {
      writeStat(char, id, cap);
      changed = true;
    }
  }
  return changed;
}

/** Apply on-remove delta, then recap. */
export function applyConditionRemoveMods(char, item) {
  const row = item && typeof item === 'object' ? item : null;
  const stat = clampStatId(row?.onRemoveStat);
  const delta = clampDelta(row?.onRemoveDelta);
  if (!char || !stat || !delta) return false;
  if (!char.stats) char.stats = {};
  writeStat(char, stat, readStat(char, stat) + delta);
  applyConditionCaps(char);
  return true;
}

function foldName(s) {
  return String(s || '').trim().toLowerCase();
}

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

function matchConditionExact(list, name, id = '') {
  const wantId = String(id || '').trim();
  if (wantId && Array.isArray(list)) {
    const byId = list.findIndex(x => String(x?.id || '') === wantId);
    if (byId >= 0) return byId;
  }
  const key = foldName(name);
  if (!key || !Array.isArray(list)) return -1;
  return list.findIndex(x => foldName(x?.name) === key);
}

export function legacyBlobToEffect(text) {
  const t = String(text || '').trim().slice(0, 240);
  if (!t) return { name: '' };
  const first = t.split(/[.!\n]/)[0].trim().slice(0, 80);
  const word = first.split(/\s+/)[0] || '';
  const preset = findConditionPreset(first) || findConditionPreset(word);
  return {
    name: preset?.name || first || 'Noted',
    description: t,
    nature: preset?.nature || 'status',
    duration: preset?.duration || 'temporary',
    source: '',
  };
}

function normalizeConditionDeltaItem(it) {
  if (typeof it === 'string') {
    const preset = findConditionPreset(it);
    return preset
      ? { name: preset.name, description: preset.description, nature: preset.nature, duration: preset.duration }
      : { name: String(it).trim() };
  }
  if (!it || typeof it !== 'object') return { name: '' };
  const name = String(it.name || it.title || '').trim();
  const preset = findConditionPreset(name || it.preset);
  return {
    name: name || preset?.name || '',
    description: it.description ?? preset?.description,
    nature: it.nature || it.type || preset?.nature,
    duration: it.duration || preset?.duration,
    source: it.source != null ? it.source : it.stamp,
    sourceKind: it.sourceKind,
    sourceId: it.sourceId,
    id: String(it.id || '').trim(),
  };
}

/** File a model payload (item bag, leftover blob, or {changed,text}) as add/update/remove. */
export function conditionBagFromUnknown(raw) {
  if (raw == null) return null;
  if (Array.isArray(raw)) {
    return { add: raw.map(normalizeConditionDeltaItem).filter(x => x.name), update: [], remove: [] };
  }
  if (typeof raw === 'string') {
    const it = legacyBlobToEffect(raw);
    return it.name ? { add: [it], update: [], remove: [] } : { add: [], update: [], remove: [] };
  }
  if (typeof raw !== 'object') return null;
  if (raw.add != null || raw.update != null || raw.remove != null) {
    return {
      add: asArray(raw.add).map(normalizeConditionDeltaItem).filter(x => x.name),
      update: asArray(raw.update).map(normalizeConditionDeltaItem).filter(x => x.name),
      remove: asArray(raw.remove).map(x => (typeof x === 'string' ? x : x?.name)).filter(Boolean),
    };
  }
  const changed = raw.changed === true || raw.changed === 'true';
  const textVal = String(raw.text || raw.condition || '').trim();
  if (changed && textVal) {
    const it = legacyBlobToEffect(textVal);
    return it.name ? { add: [it], update: [], remove: [] } : { add: [], update: [], remove: [] };
  }
  return { add: [], update: [], remove: [] };
}

function conditionFingerprint(item) {
  const row = normalizeConditionItem(item);
  if (!row) return '';
  return [formatConditionLine(row), row.description].filter(Boolean).join(' · ');
}

/** Apply add/update/remove to `char.conditions`. Never writes leftover `char.condition`. */
export function applyConditionsDelta(char, bag) {
  if (!char || !bag) return [];
  const list = (char.conditions = normalizeConditions(char.conditions));
  const changes = [];

  for (const name of bag.remove || []) {
    const i = matchConditionExact(list, name);
    if (i < 0) continue;
    const [gone] = list.splice(i, 1);
    applyConditionRemoveMods(char, gone);
    changes.push({ kind: 'conditions', action: 'remove', name: gone.name });
  }

  const mergeRow = (item, spec) => normalizeConditionItem({
    ...item,
    name: spec.name || item.name,
    description: spec.description != null ? spec.description : item.description,
    nature: spec.nature || item.nature,
    duration: spec.duration || item.duration,
    source: spec.source != null ? spec.source : item.source,
    sourceKind: spec.sourceKind != null ? spec.sourceKind : item.sourceKind,
    sourceId: spec.sourceId != null ? spec.sourceId : item.sourceId,
    id: item.id,
  });

  for (const it of bag.update || []) {
    const i = matchConditionExact(list, it?.name, it?.id);
    if (i < 0) continue;
    const item = list[i];
    const from = conditionFingerprint(item);
    const next = mergeRow(item, it);
    if (!next) continue;
    next.id = item.id;
    list[i] = next;
    const to = conditionFingerprint(next);
    if (from !== to) {
      changes.push({
        kind: 'conditions', action: 'update', name: next.name,
        fromCondition: from, toCondition: to,
      });
    }
  }

  for (const it of bag.add || []) {
    const spec = typeof it === 'string' ? { name: it } : (it || {});
    const name = String(spec.name || '').trim().slice(0, 80);
    if (!name) continue;
    const have = matchConditionExact(list, name, spec.id);
    if (have >= 0) {
      const item = list[have];
      const from = conditionFingerprint(item);
      const next = mergeRow(item, spec);
      if (!next) continue;
      next.id = item.id;
      list[have] = next;
      const to = conditionFingerprint(next);
      if (from !== to) {
        changes.push({
          kind: 'conditions', action: 'update', name: next.name,
          fromCondition: from, toCondition: to,
        });
      }
      continue;
    }
    const preset = findConditionPreset(name);
    const row = normalizeConditionItem({
      ...spec,
      name,
      nature: spec.nature || preset?.nature,
      duration: spec.duration || preset?.duration,
      description: spec.description || preset?.description || '',
    });
    if (!row) continue;
    list.push(row);
    changes.push({
      kind: 'conditions', action: 'add', name: row.name,
      toCondition: conditionFingerprint(row),
    });
  }
  applyConditionCaps(char);
  return changes;
}

export function smokeConditionCatalogPure() {
  try {
    const drunk = normalizeConditionItem({
      name: 'Drunk',
      nature: 'status',
      duration: 'temporary',
      source: 'leftover wine',
    });
    if (!drunk || drunk.nature !== 'status' || drunk.duration !== 'temporary') return 'normalize drunk';
    const line = formatConditionLine(drunk);
    if (!/Drunk \(Status · Temporary\)/.test(line) || !/leftover wine/.test(line)) return `line ${line}`;
    const bad = normalizeConditionItem({ name: '', nature: 'nope' });
    if (bad) return 'empty name should drop';
    const list = normalizeConditions([
      { id: 'a', name: 'Drunk', nature: 'status', duration: 'temporary' },
      { id: 'a', name: 'Drunk', nature: 'status', duration: 'temporary' },
    ]);
    if (list.length !== 1) return 'dedupe by id';
    if (!findConditionPreset('hexed') || findConditionPreset('hexed').nature !== 'curse') return 'preset hexed';
    if (clampConditionNature('bond') !== 'bond' || clampConditionDuration('fleeting') !== 'fleeting') return 'clamp';
    const char = { conditions: [], condition: 'leftover wine made them dizzy' };
    const bag = conditionBagFromUnknown({
      add: [{ name: 'Drunk', nature: 'status', duration: 'temporary', source: 'leftover wine' }],
      update: [],
      remove: [],
    });
    const added = applyConditionsDelta(char, bag);
    if (char.condition !== 'leftover wine made them dizzy') return 'apply must not rewrite leftover prose';
    if (char.conditions[0]?.name !== 'Drunk' || char.conditions[0]?.source !== 'leftover wine') return 'apply add';
    if (!added.some(c => c.kind === 'conditions' && c.action === 'add')) return 'apply add change';
    applyConditionsDelta(char, { add: [], update: [{ name: 'Drunk', duration: 'chronic' }], remove: [] });
    if (char.conditions[0]?.duration !== 'chronic') return 'apply update duration';
    applyConditionsDelta(char, { add: [], update: [], remove: ['Drunk'] });
    if (char.conditions.length) return 'apply remove';
    const legacy = conditionBagFromUnknown({ changed: true, text: 'Drunk on leftover wine' });
    if (legacy?.add?.[0]?.name !== 'Drunk') return 'legacy blob should file as Drunk';
    if (!findConditionPreset('hurt') || !findConditionPreset('fatigued') || !findConditionPreset('adrenaline')) {
      return 'injury/energy presets';
    }
    const capChar = {
      stats: { energy: 90 },
      conditions: [],
    };
    applyConditionsDelta(capChar, {
      add: [{ name: 'Depressed' }],
      update: [],
      remove: [],
    });
    if (capChar.conditions[0]?.capStat !== 'energy' || capChar.conditions[0]?.capAt !== 55) return 'depressed mods';
    if (capChar.stats.energy !== 55) return 'depressed should cap energy';
    capChar.stats.energy = 55;
    applyConditionsDelta(capChar, {
      add: [{ name: 'Adrenaline' }],
      update: [],
      remove: [],
    });
    applyConditionsDelta(capChar, { add: [], update: [], remove: ['Adrenaline'] });
    if (capChar.stats.energy !== 15) return `adrenaline crash then recap, got ${capChar.stats.energy}`;
    const ladders = formatConditionLadderPrompt();
    if (!/Hurt → Injured → Wounded/.test(ladders) || !/Fatigued → Lethargic/.test(ladders)) return 'ladder prompt';
    return '';
  } catch (err) {
    return err?.message || String(err);
  }
}
