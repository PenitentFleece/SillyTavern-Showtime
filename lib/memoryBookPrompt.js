// Showtime MemoryBooks scene prompt + parsers for Script Agent ingest.

import { applySlateRumor } from './intelBridge.js';
import { applySlateEvent } from './plotHookBridge.js';
import { normalizeIntelDirection } from './chatSlate.js';
import { getCastMembers, getStarMember } from './castCatalog.js';
import { ensureCompass } from './compass/state.js';

export const SHOWTIME_MEMORY_PRESET_KEY = 'showtime_script';

export const SHOWTIME_MEMORY_PROMPT = `You are a talented summarist skilled at capturing scenes from stories comprehensively. Analyze the following roleplay scene and return a detailed memory as JSON.

You must respond with ONLY valid JSON in this exact format:
{
  "title": "Short scene title (3-6 words)",
  "content": "Markdown scene log using the headings below",
  "keywords": ["keyword1", "keyword2", "keyword3"]
}

The content field MUST use this structure (omit a heading only if nothing applies). Every list is a "- " bullet.

# [Scene Title]

## Timeframe
One parseable line, and nothing else on that line: Day N, a season, Month Day, this year, last year, or N years ago. Optional Night/Morning may follow on the same line. Unspecified if unknown. Do not invent an Earth year. Do not use a live clapper or "now".
- Note any time mentions from this scene (next morning, two days later, a header date)
- Do not reconstruct from distant backstory (ten months after a hospital). That belongs in Essential Beats.
- Do not write relative essays ("the night after the previous safehouse")

## Locations
- Prevalent places that were occupied or clearly named in THIS scene
- Copy spelling from the scene. New places are welcome when the scene actually goes there or names them
- Do not rename, translate, or "correct" a name
- Do not invent a shop from a company or person (a Tanaka lease is not Tanaka Antiques)
- Do not split or dress a place the scene did not (no "Duplex (Upper/Lower Unit)" unless those labels were spoken)

## Cast
- Name (star|lead|major|foil|minor|supporting)
- ONLY characters who appeared and spoke or were significantly involved in THIS scene
- Use that exact role token. Never bill the Director. Never also credit the Star as the player, {{user}}, or You.

## Cameos
- Name (cameo) — one-off walk-ons who are NOT recurring cast members
- Never upgrade a cameo to supporting/major
- Houses, shops, and institutions are not people. Leave them out of Cast and Cameos.

## Essential Beats
Two narrative paragraphs (about 120–220 words) with a blank line between them, capturing:
- All important story beats/events that happened
- Key interaction highlights and character developments
- Notable details, memorable moments, and revelations
- Outcome and anything else important for future interactions

Chronological cause → intention → reaction → consequence. Skip flavor-only gestures. Do not bullet this section.

## Highlighted Quotes
- Name: "Quote"
Exactly that format. 2–5 lines that change the scene or reveal character.

## Conditions
- Major condition changes (injury, exhaustion, drunk, cursed, etc.) with who carries them

## Relationships
- From -> To | +N or -N | one-line reading
The middle field is a signed standing change (for example +12 or -8), added to the current number. Do not use Rising, Falling, Mixed, or New.

## Reading
- Name: one-line relationship dynamic for this chapter (how they stand toward the others)

## Hooks
- Name | resolved | beat or hook name
Use "failed" instead of "resolved" when it collapsed.

## Items / Documents
- Essential items or documents that moved, appeared, or will matter later (name + where/why)

## Presence
- Name: 203-240, 313-315
Optional. Message ranges where that person was present. Omit the heading when you do not have ranges.

For the keywords field, provide 8–20 specific, descriptive, relevant keywords for retrieval via word-matching in chat context. Keywords must be concrete and scene-specific (locations, objects, proper nouns, unique actions, hook names). Do not use abstract themes (e.g., "sadness", "love") or duplicate character names.

Important constraints:
- Capture ALL nuance without repeating verbatim
- Make it comprehensive yet digestible
- Ignore ALL [OOC] conversation/interaction — it is not useful for summaries
- Write in past tense, third person
- Do not include the user/player as a separate cast entry if they are the Star

Return ONLY the JSON, no other text.`;

export function buildShowtimeMemoryCanon(storage) {
  const lines = [];
  try {
    const members = getCastMembers(storage).filter(m => m.priority !== 'director');
    if (members.length) {
      lines.push('CANON CAST (roles are exact; do not rebill):');
      for (const m of members) {
        const role = String(m.priority || 'supporting').toLowerCase();
        const aliases = (m.aliases || []).map(a => String(a).trim()).filter(Boolean);
        lines.push(`- ${m.name} (${role})${aliases.length ? ` — also: ${aliases.join(', ')}` : ''}`);
      }
      const star = getStarMember(storage);
      if (star?.name) {
        lines.push(`Star = ${star.name} only. Do not also credit {{user}}, You, or a persona.`);
      }
    }
  } catch { /* ignore */ }
  try {
    const houses = storage?.getChat?.('reputation', { house: [] })?.house || [];
    const named = houses
      .map(h => {
        const name = String(h?.name || '').trim();
        const alias = String(h?.alias || '').trim();
        if (!name && !alias) return '';
        return alias && name && alias !== name ? `${name} (${alias})` : (name || alias);
      })
      .filter(Boolean);
    if (named.length) {
      lines.push('CANON HOUSES (institutions, not people — never Cast or Cameos):');
      for (const n of named) lines.push(`- ${n}`);
    }
  } catch { /* ignore */ }
  try {
    const compass = ensureCompass(storage?.getChat?.('backstage', {}) || {});
    const names = [];
    const seen = new Set();
    const push = (raw) => {
      const n = String(raw || '').trim();
      const k = n.toLowerCase();
      if (!n || seen.has(k)) return;
      seen.add(k);
      names.push(n);
    };
    for (const p of Object.values(compass?.rooms || {})) {
      push(p?.name);
      for (const a of p?.aliases || []) push(a);
    }
    for (const u of compass?.sonar?.unlisted || []) push(u?.name);
    if (names.length) {
      lines.push('KNOWN PLACES (prefer these spellings when the scene is there; new scene names are welcome):');
      for (const n of names) lines.push(`- ${n}`);
    }
  } catch { /* ignore */ }
  return lines.join('\n');
}

/** Live prompt for MemoryBooks copy/install — CAST roster, not Compass lock. */
export function buildShowtimeMemoryPrompt(storage) {
  const canon = buildShowtimeMemoryCanon(storage);
  return canon ? `${SHOWTIME_MEMORY_PROMPT}\n\n${canon}` : SHOWTIME_MEMORY_PROMPT;
}

const HEADING_ALIASES = Object.freeze({
  timeframe: 'timeframe',
  location: 'locations',
  locations: 'locations',
  cast: 'cast',
  cameo: 'cameos',
  cameos: 'cameos',
  'essential beats': 'beats',
  'scene summary': 'beats',
  'scene summary/breakdown': 'beats',
  summary: 'beats',
  quotes: 'quotes',
  quote: 'quotes',
  'highlighted quotes': 'quotes',
  condition: 'conditions',
  conditions: 'conditions',
  relationship: 'relationships',
  relationships: 'relationships',
  reading: 'readings',
  readings: 'readings',
  hook: 'hooks',
  hooks: 'hooks',
  items: 'items',
  documents: 'items',
  'items / documents': 'items',
  'items/documents': 'items',
  presence: 'presence',
});

function headingKey(raw) {
  const t = String(raw || '')
    .replace(/^#+\s*/, '')
    .replace(/^\*+|\*+$/g, '')
    .replace(/:$/, '')
    .trim()
    .toLowerCase();
  return HEADING_ALIASES[t] || '';
}

function bullets(lines) {
  return (lines || [])
    .map(l => String(l || '').replace(/^\s*[-*•]\s*/, '').trim())
    .filter(Boolean);
}

function prose(lines) {
  const paras = [];
  let cur = [];
  for (const raw of lines || []) {
    const t = String(raw || '').replace(/^\s*[-*•]\s*/, '').trim();
    if (!t) {
      if (cur.length) {
        paras.push(cur.join(' '));
        cur = [];
      }
      continue;
    }
    cur.push(t);
  }
  if (cur.length) paras.push(cur.join(' '));
  return paras.join('\n\n').trim();
}

function parseQuoteLine(line) {
  const s = String(line || '').trim();
  if (!s) return null;
  const m = s.match(/^(.+?):\s*[“"'](.+)[”"']\s*$/)
    || s.match(/^(.+?):\s*(.+)$/);
  if (m) return { character: m[1].trim(), text: m[2].replace(/^["“]|["”]$/g, '').trim() };
  return { character: '', text: s.replace(/^["“]|["”]$/g, '') };
}

export function relationshipStanding(dir, rawDelta) {
  if (rawDelta != null && rawDelta !== '' && Number.isFinite(Number(rawDelta))) {
    return { delta: Math.trunc(Number(rawDelta)), mode: 'delta' };
  }
  const word = String(dir || '').toUpperCase();
  if (word === 'RISING') return { delta: 15, mode: 'delta' };
  if (word === 'FALLING') return { delta: -15, mode: 'delta' };
  if (word === 'NEW') return { delta: 0, mode: 'establish' };
  return { delta: 0, mode: 'keep' };
}

export function parseRelationshipLine(line) {
  const s = String(line || '').replace(/^\s*[-*•]\s*/, '').trim();
  if (!s) return null;
  const m = s.match(/^(.+?)\s*->\s*(.+?)\s*\|\s*([^|]+?)(?:\s*\|\s*(.*))?$/);
  if (!m) return null;
  const from = m[1].trim();
  const to = m[2].trim();
  const mid = m[3].trim();
  const reading = String(m[4] || '').trim();
  if (!from || !to) return null;
  const signed = mid.match(/^([+-]\d+)$/);
  if (signed) {
    return { from, to, dir: '', delta: Math.trunc(Number(signed[1])), reading };
  }
  const dir = normalizeIntelDirection(mid).id;
  return { from, to, dir, delta: null, reading: reading || mid };
}

function parsePresenceLine(line) {
  const s = String(line || '').replace(/^\s*[-*•]\s*/, '').trim();
  const m = s.match(/^(.+?):\s*(.+)$/);
  if (!m) return null;
  const ranges = m[2].split(',').map(x => x.trim().replace(/\s+/g, '')).filter(x => /^\d+(?:-\d+)?$/.test(x));
  if (!m[1].trim() || !ranges.length) return null;
  return { name: m[1].trim(), ranges };
}

export function parseHookLine(line) {
  const s = String(line || '').replace(/^\s*[-*•]\s*/, '').trim();
  if (!s) return null;
  const m = s.match(/^(.+?)\s*\|\s*(resolved|failed|added|updated)\s*(?:\|\s*(.*))?$/i);
  if (m) {
    return {
      name: m[1].trim(),
      verb: m[2].trim().toUpperCase(),
      beat: String(m[3] || m[1]).trim(),
    };
  }
  const loose = s.match(/^(.+?)\s*\|\s*(.+)$/);
  if (loose) return { name: loose[1].trim(), verb: 'RESOLVED', beat: loose[2].trim() };
  return { name: s, verb: 'RESOLVED', beat: s };
}

export function parseMemoryBookContent(text) {
  const sections = {
    timeframe: [],
    locations: [],
    cast: [],
    cameos: [],
    beats: [],
    quotes: [],
    conditions: [],
    relationships: [],
    readings: [],
    hooks: [],
    items: [],
    presence: [],
  };
  let cur = 'beats';
  for (const raw of String(text || '').split(/\r?\n/)) {
    const trimmed = raw.trim();
    if (/^#\s+/.test(trimmed) && !headingKey(trimmed)) continue;
    const key = headingKey(trimmed);
    if (key) {
      cur = key;
      continue;
    }
    if (!trimmed) {
      if (cur === 'beats') (sections[cur] ||= []).push('');
      continue;
    }
    (sections[cur] ||= []).push(raw);
  }

  const quotes = bullets(sections.quotes).map(parseQuoteLine).filter(q => q?.text);
  const relationships = bullets(sections.relationships).map(parseRelationshipLine).filter(Boolean);
  const hooks = bullets(sections.hooks).map(parseHookLine).filter(Boolean);
  const presence = bullets(sections.presence).map(parsePresenceLine).filter(Boolean);
  const credits = [
    ...bullets(sections.cast),
    ...bullets(sections.cameos),
  ];
  return {
    span: bullets(sections.timeframe).join(' ').trim() || String(sections.timeframe[0] || '').trim(),
    locations: bullets(sections.locations),
    credits,
    summary: prose(sections.beats),
    quotes,
    conditions: bullets(sections.conditions),
    relationships,
    readings: bullets(sections.readings),
    hooks,
    items: bullets(sections.items),
    presence,
  };
}

export function memoryPayloadToAgentFields(parsed) {
  const p = parsed || {};
  const highlights = (p.quotes || []).map((q) => {
    if (q.character && q.text) return `${q.character}: ${q.text}`;
    return q.text || '';
  }).filter(Boolean);
  const notes = [
    ...(p.conditions || []).map(c => `Condition: ${c}`),
    ...(p.readings || []).map(r => `Reading: ${r}`),
  ].join('\n');
  const objects = [...(p.items || [])];
  return {
    Title: '',
    Span: p.span || '',
    Summary: p.summary || '',
    Highlights: highlights,
    Credits: p.credits || [],
    Keywords: objects,
    Location: p.locations || [],
    Objects: objects,
    Characters: [],
    DateTime: p.span ? [p.span] : [],
    notes,
    relationships: p.relationships || [],
    hooks: p.hooks || [],
  };
}

export function applyMemoryBookIntel(storage, parsed, { bus, silent = true } = {}) {
  const out = { rumors: [], hooks: [] };
  for (const rel of parsed?.relationships || []) {
    const standing = relationshipStanding(rel.dir, rel.delta);
    const rum = applySlateRumor(storage, {
      from: rel.from,
      to: rel.to,
      direction: rel.dir || '',
      cause: rel.reading || `${rel.from} -> ${rel.to}`,
      reading: rel.reading || rel.dir,
      skipSecret: !!silent,
    });
    if (!rum?.ok) continue;
    rum.delta = standing.delta;
    rum.standingMode = standing.mode;
    rum.silent = !!silent;
    out.rumors.push(rum);
    bus?.emit('reputation.slateApply', {
      from: rum.from,
      to: rum.to,
      fromName: rel.from,
      toName: rel.to,
      direction: rum.direction,
      delta: standing.delta,
      standingMode: standing.mode,
      silent: !!silent,
      take: rum.take,
      cause: rum.cause,
    });
  }
  for (const hk of parsed?.hooks || []) {
    const verb = ['ADDED', 'UPDATED', 'RESOLVED', 'FAILED'].includes(hk.verb) ? hk.verb : 'RESOLVED';
    const ev = applySlateEvent(storage, {
      verb,
      summary: hk.beat || hk.name,
      context: hk.name,
    });
    if (ev?.ok) out.hooks.push(ev);
  }
  return out;
}

export function smokeMemoryBookPromptPure() {
  try {
    if (!SHOWTIME_MEMORY_PROMPT.includes('## Timeframe')) return 'prompt timeframe';
    if (!SHOWTIME_MEMORY_PROMPT.includes('## Locations')) return 'prompt locations';
    if (!SHOWTIME_MEMORY_PROMPT.includes('## Cast')) return 'prompt cast';
    if (!SHOWTIME_MEMORY_PROMPT.includes('## Cameos')) return 'prompt cameos';
    if (!SHOWTIME_MEMORY_PROMPT.includes('## Essential Beats')) return 'prompt beats';
    if (!/two narrative paragraphs/i.test(SHOWTIME_MEMORY_PROMPT)) return 'prompt allows two-paragraph summary';
    if (!SHOWTIME_MEMORY_PROMPT.includes('Name: "Quote"')) return 'prompt quote format';
    if (!SHOWTIME_MEMORY_PROMPT.includes('## Conditions')) return 'prompt conditions';
    if (!SHOWTIME_MEMORY_PROMPT.includes('## Relationships')) return 'prompt relationships';
    if (!SHOWTIME_MEMORY_PROMPT.includes('## Reading')) return 'prompt reading';
    if (!SHOWTIME_MEMORY_PROMPT.includes('## Hooks')) return 'prompt hooks';
    if (!SHOWTIME_MEMORY_PROMPT.includes('## Items / Documents')) return 'prompt items';
    if (!/New places are welcome/i.test(SHOWTIME_MEMORY_PROMPT)) return 'prompt allows new locations';
    if (!/Tanaka Antiques/i.test(SHOWTIME_MEMORY_PROMPT)) return 'prompt forbids invented shop names';
    if (!/Never bill the Director/i.test(SHOWTIME_MEMORY_PROMPT)) return 'prompt locks cast billing';
    if (!/Houses, shops, and institutions/i.test(SHOWTIME_MEMORY_PROMPT)) return 'prompt houses not people';
    if (/Compass roster|knownPlaceRoster|ONLY names from Compass|lock(?:ed)? to Compass/i.test(SHOWTIME_MEMORY_PROMPT)) {
      return 'prompt must not lock locations to Compass';
    }
    if (!/this year/i.test(SHOWTIME_MEMORY_PROMPT)) return 'prompt allows a vague year';
    if (!/Note any time mentions from this scene/i.test(SHOWTIME_MEMORY_PROMPT)) return 'prompt dates from this scene cues';
    if (!/Do not write relative essays/i.test(SHOWTIME_MEMORY_PROMPT)) return 'prompt forbids relative timeframe essays';
    if (!/live clapper/i.test(SHOWTIME_MEMORY_PROMPT)) return 'prompt must not stamp present clapper';
    if (!/Unspecified if unknown/i.test(SHOWTIME_MEMORY_PROMPT)) return 'prompt unspecified when undated';

    const stub = `# Night Train
## Timeframe
Night, inbound
## Locations
- Northbound train
## Cast
- Hawks (lead)
## Cameos
- Conductor (cameo)
## Essential Beats
Hawks palmed the sandwich and stowed it in the windbreaker.

The train leaned into the curve and neither of them spoke.
## Highlighted Quotes
- Hawks: Keep it.
## Conditions
- Hawks: tense
## Relationships
- Hawks -> Weslie | RISING | covers for him
## Reading
- Hawks: protective this chapter
## Hooks
- Hawks | resolved | get off at Fukuoka
## Items / Documents
- sandwich | windbreaker pocket
## Presence
- Hawks: 203-240, 313-315`;
    const parsed = parseMemoryBookContent(stub);
    if (!/inbound/i.test(parsed.span || '')) return 'parse timeframe';
    if (!parsed.locations.some(x => /train/i.test(x))) return 'parse location';
    if (!parsed.credits.some(x => /Hawks/i.test(x))) return 'parse credits';
    if (!parsed.quotes.some(q => /Hawks/i.test(q.character) && /Keep it/i.test(q.text))) {
      return 'parse quotes';
    }
    if (!parsed.presence?.some(p => p.name === 'Hawks' && p.ranges.includes('203-240'))) {
      return 'parse presence ranges';
    }
    if (!/\n\n/.test(parsed.summary || '') || !/neither of them spoke/i.test(parsed.summary || '')) {
      return 'summary should keep two paragraphs';
    }
    const rel = parseRelationshipLine('Hawks -> Weslie | RISING | covers for him');
    if (!rel || rel.from !== 'Hawks' || rel.to !== 'Weslie' || rel.dir !== 'RISING') {
      return 'relationship line';
    }
    const rise = relationshipStanding(rel.dir, rel.delta);
    if (rise.delta !== 15 || rise.mode !== 'delta') return 'rising still means +15';
    const numbered = parseRelationshipLine('Hawks -> Weslie | +12 | covers for him');
    const drop = relationshipStanding(numbered?.dir, numbered?.delta);
    if (!numbered || numbered.delta !== 12 || drop.mode !== 'delta' || drop.delta !== 12) {
      return 'signed standing change';
    }
    const kept = relationshipStanding('MIXED', null);
    if (kept.mode !== 'keep') return 'mixed keeps the number';
    const fields = memoryPayloadToAgentFields(parsed);
    if (!fields.Highlights.some(h => /^Hawks:/.test(h))) return 'agent highlight format';
    const hawks = { id: 'hawks', name: 'Hawks', priority: 'lead' };
    const wes = { id: 'wes', name: 'Weslie', priority: 'star' };
    const director = { id: 'dir', name: 'Director', priority: 'director', plotHooks: [{ id: 'h1', name: 'get off at Fukuoka', text: 'get off at Fukuoka', active: true, outcome: '' }] };
    const storage = {
      getChat(key, fb) {
        if (key === 'cast') return { characters: [hawks, wes, director] };
        if (key === 'motivation') { this._mot ??= { perChar: {} }; return this._mot; }
        if (key === 'reputation') return { personal: [], house: [] };
        return fb || {};
      },
    };
    const applied = applyMemoryBookIntel(storage, parsed);
    if (!applied.rumors.length) return 'relationship line should produce a rumor payload';
    const canonStorage = {
      getChat(key, fb) {
        if (key === 'cast') return { characters: [hawks, wes, director] };
        if (key === 'reputation') return { personal: [], house: [{ name: 'Mall Security', alias: 'Security' }] };
        return fb || {};
      },
    };
    const built = buildShowtimeMemoryPrompt(canonStorage);
    if (!/Weslie \(star\)/.test(built)) return 'canon should bill star exactly';
    if (!/Hawks \(lead\)/.test(built)) return 'canon should bill lead exactly';
    if (/Director \(director\)/.test(built)) return 'director must not be billed in canon cast';
    if (!/CANON HOUSES/.test(built) || !/Mall Security/.test(built)) return 'canon houses should list institutions';
    if (!/New places are welcome/i.test(built)) return 'built prompt still allows new locations';
    return '';
  } catch (err) {
    return String(err?.message || err);
  }
}
