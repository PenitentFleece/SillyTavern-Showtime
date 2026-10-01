// Shared keyword facets — Script lore and Composer cues use the same
// location / objects / characters / datetime keys so tags can match across tabs.
export const SCRIPT_FACETS = [
  { id: 'location',   label: 'Location',    tag: 'Location' },
  { id: 'objects',    label: 'Objects',     tag: 'Item' },
  { id: 'characters', label: 'Characters',  tag: 'Character' },
  { id: 'datetime',   label: 'Date / Time', tag: 'Date' },
];

export const COMPOSER_FACETS = [
  ...SCRIPT_FACETS,
  { id: 'mood', label: 'Mood', tag: 'Mood' },
];

// Shared scoring vocabulary — pick from this list so scene keys and cue
// tags actually meet. Extra custom moods can still be typed.
export const MOOD_KEYS = [
  'Energetic',
  'Joyful',
  'Playful',
  'Romantic',
  'Triumphant',
  'Hopeful',
  'Ambient',
  'Serene',
  'Tender',
  'Bittersweet',
  'Tense',
  'Mysterious',
  'Dread',
  'Hostile',
  'Somber',
  'Lonely',
  'Epic',
  'Chaotic',
];

export function canonicalizeMood(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const hit = MOOD_KEYS.find(k => k.toLowerCase() === raw.toLowerCase());
  return hit || raw;
}

/**
 * Built-in scoring moods plus any custom labels the production has used.
 * Custom keys stay reusable on the Composer palette after they're typed once.
 */
export function collectMoodPalette(extra = []) {
  const seen = new Set(MOOD_KEYS.map(k => k.toLowerCase()));
  const custom = [];
  for (const raw of extra || []) {
    const v = canonicalizeMood(raw);
    if (!v) continue;
    const k = v.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    custom.push(v);
  }
  custom.sort((a, b) => a.localeCompare(b));
  return { keys: [...MOOD_KEYS, ...custom], custom };
}

export function emptyFacets(defs = SCRIPT_FACETS) {
  return Object.fromEntries(defs.map(f => [f.id, []]));
}

export function normalizeFacets(raw, defs = SCRIPT_FACETS) {
  const out = emptyFacets(defs);
  if (!raw) return out;
  if (Array.isArray(raw)) {
    const first = defs[0]?.id;
    if (first) out[first] = raw.map(s => String(s).trim()).filter(Boolean);
    return out;
  }
  if (typeof raw !== 'object') return out;
  for (const f of defs) {
    const v = raw[f.id] ?? raw[f.label] ?? raw[f.tag];
    if (Array.isArray(v)) out[f.id] = v.map(s => String(s).trim()).filter(Boolean);
    else if (typeof v === 'string' && v.trim()) {
      out[f.id] = v.split(',').map(s => s.trim()).filter(Boolean);
    }
  }
  return out;
}

export function flattenFacets(facets, defs = SCRIPT_FACETS) {
  const f = normalizeFacets(facets, defs);
  return defs.flatMap(def => f[def.id] ?? []);
}

export function facetTag(facetId, defs = SCRIPT_FACETS) {
  return defs.find(f => f.id === facetId)?.tag || 'Other';
}

/** One Custom segment: level id + sibling index (no zero-pad). */
export function formatOrgSegment(code, index, _pad = 0) {
  const n = Math.max(1, Number(index) || 1);
  return `${String(code || '')}${n}`;
}

/**
 * Show / Book: fixed 2-segment presets (major / minor).
 * Custom: `segments` = [{ code, index }, …] — `code` is the level id; blank skips that depth.
 */
export function formatOrgCode(scheme, major, minor, { folder = false, segments = null } = {}) {
  if (scheme === 'custom' && Array.isArray(segments)) {
    return segments
      .filter(s => s && String(s.code || '').length)
      .map(s => formatOrgSegment(s.code, s.index))
      .join('');
  }
  const maj = Math.max(1, Number(major) || 1);
  const min = Math.max(1, Number(minor) || 1);
  if (scheme === 'book') {
    if (folder || minor == null) return `B.${maj}`;
    return `B.${maj}-Ch.${min}`;
  }
  const S = String(maj).padStart(2, '0');
  if (folder || minor == null) return `S${S}`;
  return `S${S}E${String(min).padStart(3, '0')}`;
}

/** Live preview of a Custom pattern from level ids (synthetic indices 1,2,3…). */
export function previewCustomOrgCode(levels = []) {
  const list = Array.isArray(levels) ? levels : [];
  const segments = list.map((l, i) => ({
    code: String(l?.id || ''),
    index: i + 1,
  }));
  return formatOrgCode('custom', 1, 1, { segments }) || '(set level ids)';
}
