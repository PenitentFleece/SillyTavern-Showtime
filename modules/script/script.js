// =============================================================
// modules/script/script.js
// Showtime — Script Module  |  chat-lorebook replacement
// =============================================================

import { getRequestHeaders, saveMetadata, stopGeneration, eventSource, event_types }
    from '../../../../../../script.js';
import { getContext, extension_settings }
    from '../../../../../extensions.js';
import { loadWorldInfo, METADATA_KEY }
    from '../../../../../world-info.js';
import { oai_settings } from '../../../../../openai.js';
import { textgenerationwebui_settings } from '../../../../../textgen-settings.js';
import { Module } from '../../lib/module.js';
import { withConnectionProfile } from '../../lib/connectionProfile.js';
import { pinnedGenerateRaw, FILING_RESPONSE_LENGTH } from '../../lib/isolatedGen.js';
import { getCastMembers, priorityLabel, castNameMatches, PRIORITIES, getStarMember } from '../../lib/castCatalog.js';
import { rafMove } from '../../lib/uiPerf.js';
import {
    cardLevelId,
    DEFAULT_SCRIPT_LEVELS,
    folderLevelId,
    nextLevelId,
    normalizeLevels,
    normalizeShelfLevels,
    orgSchemeOf,
    rootLevelId,
    sceneCode,
} from '../../lib/scriptCatalog.js';
import { previewCustomOrgCode } from '../../lib/keywordFacets.js';
import {
    LIB_UNSORTED,
    bookSceneCodes,
    getCachedLibraryBooks,
    leafAsWiEntry,
    libraryEntryKey,
    librarySections,
    listLibraryLeaves,
    listVisibleLibraryLeaves,
    reconcileSceneStamps,
    sceneCodesFromTags,
    stampSceneCodes,
    syncSceneStamps,
    unstampSceneCodes,
} from '../../lib/libraryCatalog.js';
import {
    CAL_LABEL_DEFAULTS,
    EARTH_EPOCH,
    EARTH_MONTH_LABELS,
    TL_ZOOM,
    TIME_PICKER_SCALES,
    addCalendarSort,
    alignCalendarSort,
    calendarSort,
    earthDateSort,
    formatCalendarYear,
    formatSceneDate,
    formatTimeKey,
    formatTimelineTick,
    getTimelinePresent,
    normalizeCalendar,
    parseTimeKey,
    parseTimeRange,
    partsFromCalendarSort,
    partsFromEarthMs,
    pickParseableTimeKey,
    timelineUnitSort,
    wallClockParts,
} from '../../lib/calendarTime.js';
import { bindLocationCatalogPicker } from '../../lib/locationCatalog.js';
import { locationTagEditorHTML, readLocationTags } from '../../lib/locationTagPicker.js';
import {
    formatConnAt,
    formatConnMark,
    normalizeConnLog,
    runScriptConnTrack,
} from '../../lib/scriptConnTrack.js';

// ─────────────────────────────────────────────────────────────
//  Constants
// ─────────────────────────────────────────────────────────────
const LEGACY_META_KEY = 'showtime_script';
const LEGACY_INJECTION_ID = 'showtime_script_v1';
const DEBUG        = false;
// ~3–4k tokens of Script lore per generation at most.
const SCRIPT_INJECTION_CHAR_BUDGET = 14000;

// Continuous timeline pan/zoom (Reputation-web style) — a "semi-infinite"
// pannable ruler instead of discrete zoom-level pages with a bounded viewport.
const TL_ZOOM_MIN = 0.08;
const TL_ZOOM_MAX = 12;
/** Absolute ceiling for the *dynamic* zoom cap — keeps wide domains numerically
 *  sane while still letting you drill from years all the way down to hours. */
const TL_ZOOM_HARD_MAX = 4000;
/** Soft budgets — how many marks may appear across the visible axis. */
const TL_MAJOR_BUDGET = 7;
const TL_MINOR_BUDGET = 28;
const TL_MAJOR_MIN_PX = 90;
const TL_MINOR_MIN_PX = 22;
const TL_LABEL_MIN_PX = 86;
const TL_PAN_SLACK = 12; // viewports of empty space past content (high zoom needs more)
/** Pins within this many px on the axis share a stack column. */
const TL_CLUSTER_PX = 56;
const TL_PIN_BASE_STEM = 18;
const TL_PIN_STACK_GAP = 8;
/** Axis marks this close collapse into one cluster chip. */
const TL_TACK_MERGE_PX = 14;

// Default level hierarchy — stored in settings so users can
// add, remove, or rename levels without touching code.
const DEFAULT_LEVELS = DEFAULT_SCRIPT_LEVELS.map(l => ({ ...l }));

const KEYWORD_FACETS = [
    { id: 'location',   label: 'Location',    tag: 'Location' },
    { id: 'objects',    label: 'Objects',     tag: 'Item' },
    { id: 'characters', label: 'Characters',  tag: 'Character' }, // legacy / agent only — not in keyword UI
    { id: 'datetime',   label: 'Date / Time', tag: 'Date' },
];

/** Facets editable as Script keywords (credits cover cast; no character tags). */
const KEYWORD_EDIT_FACETS = KEYWORD_FACETS.filter(f => f.id !== 'characters');

function emptyFacets() {
    return { location: [], objects: [], characters: [], datetime: [] };
}

function normalizeFacets(raw) {
    const out = emptyFacets();
    if (!raw) return out;
    if (Array.isArray(raw)) {
        out.location = raw.map(s => String(s).trim()).filter(Boolean);
        return out;
    }
    if (typeof raw !== 'object') return out;
    for (const f of KEYWORD_FACETS) {
        const v = raw[f.id] ?? raw[f.label] ?? raw[f.label.toLowerCase()];
        if (Array.isArray(v)) out[f.id] = v.map(s => String(s).trim()).filter(Boolean);
        else if (typeof v === 'string' && v.trim()) {
            out[f.id] = v.split(',').map(s => s.trim()).filter(Boolean);
        }
    }
    return out;
}

function flattenFacets(facets) {
    const f = normalizeFacets(facets);
    return KEYWORD_FACETS.flatMap(def => f[def.id]);
}

function pickField(raw, ...names) {
    if (!raw || typeof raw !== 'object') return undefined;
    const keys = Object.keys(raw);
    for (const name of names) {
        if (raw[name] != null) return raw[name];
        const hit = keys.find(k => k.toLowerCase() === name.toLowerCase());
        if (hit != null) return raw[hit];
    }
    return undefined;
}

function keywordStrings(val) {
    return asStringList(val)
        .map(v => {
            if (typeof v === 'string') return v.trim();
            if (v && typeof v === 'object') return String(v.text || v.name || v.value || '').trim();
            return '';
        })
        .filter(Boolean);
}

/** Which timeline axis units are shown (mirrors TL_ZOOM ids). */
function normalizeTlShow(raw = {}) {
    const out = {};
    for (const z of TL_ZOOM) {
        out[z.id] = raw?.[z.id] !== false;
    }
    if (!Object.values(out).some(Boolean)) out.months = true;
    return out;
}

function isDirectorRole(role) {
    return String(role || '').toLowerCase() === 'director';
}

const CREDIT_ONLY_ROLES = Object.freeze({
    cameo: 'Cameo',
    narrator: 'Narrator',
    ensemble: 'Ensemble',
});

function creditRoleLabel(role) {
    const id = String(role || '').trim().toLowerCase();
    const billed = PRIORITIES.find(p => p.id === id);
    if (billed) return billed.label;
    if (CREDIT_ONLY_ROLES[id]) return CREDIT_ONLY_ROLES[id];
    return id ? String(role) : CREDIT_ONLY_ROLES.cameo;
}

/** Unlinked extras (not on Cast) bill as Cameo, not Supporting. */
function unlinkedCreditRole(role) {
    const r = String(role || '').trim().toLowerCase();
    if (isDirectorRole(r)) return null;
    if (!r || r === 'supporting' || r === 'minor' || r === 'extra' || r === 'npc' || r === 'background') {
        return 'cameo';
    }
    if (CREDIT_ONLY_ROLES[r] || PRIORITIES.some(p => p.id === r)) return r;
    if (r.includes('cameo')) return 'cameo';
    if (r.includes('star')) return 'star';
    if (r.includes('lead')) return 'lead';
    if (r.includes('major')) return 'major';
    if (r.includes('foil')) return 'foil';
    return 'cameo';
}

function asStringList(val) {
    if (!val) return [];
    if (Array.isArray(val)) {
        return val.map(v => (v && typeof v === 'object') ? v : String(v).trim()).filter(v => {
            if (!v) return false;
            if (typeof v === 'object') return true;
            return String(v).trim().length > 0;
        });
    }
    if (typeof val === 'string') return val.split(/[,;\n]/).map(s => s.trim()).filter(Boolean);
    if (typeof val === 'object') return [val];
    return [];
}

function parseCreditLine(line) {
    const s = String(line || '').trim();
    if (!s) return null;
    const m = s.match(/^(.*)\s+\(([^)]+)\)\s*$/);
    let name = (m ? m[1] : s).trim();
    name = name.replace(/^[^A-Za-z0-9]+/, '').trim() || (m ? m[1] : s).trim();
    const role = (m ? m[2] : '').trim().toLowerCase() || null;
    if (!name) return null;
    return { name, role };
}

function salvageJsonArray(text) {
    if (text && typeof text === 'object') {
        if (Array.isArray(text)) return text;
        if (Array.isArray(text.cards)) return text.cards;
        if (Array.isArray(text.groups)) return text.groups;
        if (text.card && typeof text.card === 'object') return [text.card];
        if (pickField(text, 'Title', 'title')) return [text];
        return [];
    }
    if (!text) return [];
    const cleaned = String(text)
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/, '')
        .replace(/```\s*$/, '')
        .trim();
    const tryParse = s => { try { return JSON.parse(s); } catch (_) { return null; } };
    const direct = tryParse(cleaned);
    if (direct) return salvageJsonArray(direct);

    const start = cleaned.search(/[\[{]/);
    const body = start >= 0 ? cleaned.slice(start) : cleaned;
    const items = [];
    let depth = 0;
    let inStr = false;
    let esc = false;
    let objStart = -1;
    for (let i = 0; i < body.length; i++) {
        const ch = body[i];
        if (inStr) {
            if (esc) { esc = false; continue; }
            if (ch === '\\') { esc = true; continue; }
            if (ch === '"') inStr = false;
            continue;
        }
        if (ch === '"') { inStr = true; continue; }
        if (ch === '{') {
            if (depth === 0) objStart = i;
            depth++;
        } else if (ch === '}') {
            depth--;
            if (depth === 0 && objStart >= 0) {
                const obj = tryParse(body.slice(objStart, i + 1));
                if (obj && typeof obj === 'object' && !Array.isArray(obj)) items.push(obj);
                objStart = -1;
            }
        }
    }
    return items;
}

const AGENT_STRING_LIST = { type: 'array', items: { type: 'string' } };

const AGENT_CARD_ITEM = {
    type: 'object',
    properties: {
        Title: { type: 'string' },
        Span: { type: 'string' },
        Summary: { type: 'string' },
        Highlights: AGENT_STRING_LIST,
        Credits: AGENT_STRING_LIST,
        Keywords: AGENT_STRING_LIST,
        Path: { type: 'string' },
        Location: AGENT_STRING_LIST,
        Objects: AGENT_STRING_LIST,
        Characters: AGENT_STRING_LIST,
        DateTime: AGENT_STRING_LIST,
    },
    required: ['Title', 'Summary', 'Keywords'],
};

const AGENT_CARDS_SCHEMA = {
    name: 'script_cards',
    description: 'ScriptCards array (or a single card object).',
    strict: false,
    returnInvalid: true,
    value: {
        type: 'object',
        properties: {
            cards: { type: 'array', items: AGENT_CARD_ITEM },
        },
        required: ['cards'],
    },
};

const AGENT_GROUP_ITEM = {
    type: 'object',
    properties: {
        TitleHint: { type: 'string' },
        Sources: { type: 'array', items: { type: 'number' } },
        Path: { type: 'string' },
        Keywords: AGENT_STRING_LIST,
    },
    required: ['Sources'],
};

const AGENT_GROUPS_SCHEMA = {
    name: 'script_groups',
    description: 'Scene groups for a lorebook audit. Each group lists 1-based Sources entry indices.',
    strict: false,
    returnInvalid: true,
    value: {
        type: 'object',
        properties: {
            groups: { type: 'array', items: AGENT_GROUP_ITEM },
        },
        required: ['groups'],
    },
};

const AGENT_CARD_FIELDS = `{
  "Title": string,
  "Span": string | null,
  "Summary": string,
  "Highlights": string[],
  "Credits": string[],
  "Keywords": string[],
  "Path": string,
  "Location": string[],
  "Objects": string[],
  "Characters": string[],
  "DateTime": string[]
}`;

const AGENT_SYSTEM_PROMPT = `You are a precise script analyst AI. Convert the source into ScriptCards.

Return ONLY valid JSON. No markdown, no explanations, no extra text.
Prefer a JSON array of card objects. A wrapper { "cards": [ ... ] } is also accepted.

Each object MUST use exactly these field names:

${AGENT_CARD_FIELDS}

Field rules:
- Title: Clear, concise card title.
- Span: Time/date range in this world's calendar (e.g. "Day 3–5", "Spring 1942", or custom season/month names). Use "" if none exists.
- Summary: One rough paragraph, narrative and atmospheric.
- Highlights: 2–5 memorable quotes or key lines, formatted like short review blurbs.
- Credits: One entry per character except the Director. Format: "Name (Role)" using star, lead, major, supporting, foil, cameo, narrator, ensemble. Never credit the Director. Credit the Star once, using the CAST primary name (Star is {{user}} — do not also list {{user}}, You, or a persona alias as a second credit). Names that appear in the scene but are not on CAST must be (cameo), never (supporting).
- Keywords: 4–8 trigger phrases for injection (places, objects, themes — not cast nicknames; cast goes in Credits).
- Path: Existing SCRIPT SHELF folder path where this card belongs (e.g. "Act I / Night of the Fire"). Use "" for the shelf root. Never invent a path that is not listed.
- Location / Objects / DateTime: short tags for sort and search. DateTime should prefer a single placeable key (Day N, Season, Month Year) that matches the world's calendar.
- Characters: optional name list; treated as Credits (not keyword tags). Prefer Credits when roles are known.`;

const AGENT_LOREBOOK_GROUP_RULES = `LOREBOOK AUDIT — PASS 1 (grouping):
- Entries are numbered [1], [2], … in this message.
- Propose narrative scene groups (like episodes / set-pieces), not one group per entry.
- Merge related clippings that can share one comprehensive scene card.
- Return ONLY JSON: { "groups": [ { "TitleHint": string, "Sources": number[], "Path": string, "Keywords": string[] } ] }
- Sources MUST be 1-based indices from this message. Every useful entry should appear in exactly one group when possible.
- Path must match an existing SCRIPT SHELF folder path, or "".
- Do not write full Summaries yet — only grouping metadata.`;

const AGENT_LOREBOOK_BUILD_RULES = `LOREBOOK AUDIT — PASS 2 (build one card):
- You are given ONE scene group’s source clippings (and optional TitleHint / Path / Keywords seeds).
- Emit exactly ONE ScriptCard using the standard field names.
- Do not invent origin/source fields — the host stamps which entries belong to this card.
- Prefer the seed TitleHint / Path / Keywords when they fit; refine Keywords from the clippings.`;

const AGENT_LORE_ENTRIES_AUDIT = `AUDIT ENTRIES (mandatory):
- You are given a fixed set of lore clippings chosen by the user.
- Emit exactly ONE ScriptCard that comprehensively covers all of them.
- Do not invent origin/source fields — the host stamps the user’s full selection.
- Do not return more than one card.`;

const AGENT_CHAT_RULES = `CHAT RULES (mandatory):
- Group consecutive messages into scene ScriptCards (same location, conflict, or beat).
- Do NOT emit one card per message.
- Merge related material into narrative ScriptCards.`;

function asIndexList(raw) {
    if (raw == null) return [];
    const arr = Array.isArray(raw) ? raw : [raw];
    return arr
        .map(n => Math.floor(Number(n)))
        .filter(n => Number.isFinite(n) && n >= 1);
}

// ─────────────────────────────────────────────────────────────
//  Utilities
// ─────────────────────────────────────────────────────────────
function log(...args) {
    if (DEBUG) console.log('[Showtime:Script]', ...args);
}

function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function now() {
    return Date.now();
}

function normalizeSourceStamp(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const entries = (Array.isArray(raw.entries) ? raw.entries : [])
        .map(e => ({
            book: String(e?.book || '').trim(),
            title: String(e?.title || '').trim(),
            key: String(e?.key || '').trim(),
            uid: e?.uid != null ? String(e.uid) : '',
        }))
        .filter(e => e.title || e.book || e.key || e.uid);
    if (!entries.length) return null;
    return {
        at: Number(raw.at) || Date.now(),
        mode: String(raw.mode || 'lore').trim() || 'lore',
        entries,
    };
}

// ─────────────────────────────────────────────────────────────
//  ScriptCard factory
//  Every card is created through this to guarantee schema shape.
// ─────────────────────────────────────────────────────────────

/*  Full ScriptCard schema (for reference):
    {
        uid         string          unique id, immutable after creation
        levelId     string          references a level id from settings.levels
        parentUid   string | null   uid of parent card (tree grouping)

        title       string
        span        string | null   e.g. "Day 1–3", "Arc 2", "Year 452"
        timestamp   number | null   unix ms — chronological sort for timeline

        summary     string          short header (optional)
        content     string          injected lore body (WI content equivalent)
        notes       string          private, never injected
        quotes      [{text, character}]
        credits     [{characterId, name, role}]

        keywords    string[]        trigger words for keyword injection
        aliases     string[]        extra keys (scanned with keywords)
        tags        string[]
        pinned      boolean         always inject when active (WI constant)
        active      boolean
        scanDepth   number | null   optional per-card scan override

        createdAt   number          unix ms
        updatedAt   number          unix ms
        sourceBook  string | null   lorebook name this came from, if any
        sourceStamp { at, mode, entries:[{book,title,key,uid}] } | null
                        provenance stamp of lore/memory clippings used to make the card
    }
*/

function esc(str) {
    return String(str ?? '')
        .replace(/&/g,'&amp;').replace(/</g,'&lt;')
        .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function facetTag(facetId) {
    return KEYWORD_FACETS.find(f => f.id === facetId)?.tag || 'Other';
}

function facetClass(facetId) {
    return KEYWORD_FACETS.some(f => f.id === facetId) ? facetId : 'other';
}

function makeCard(overrides = {}) {
    return {
        uid:        uid(),
        levelId:    'chapter',
        parentUid:  null,

        title:      '',
        span:       null,
        timestamp:  null,
        timeKey:    '',
        timeManual: false,     // true = position overridden by a drag, not its true parsed time
        timeManualSort: null,  // absolute canonical sort value while timeManual is true
        timeLane:   0,
        timeLocked: false,     // true = always renders at its true parsed time (no override)
        timelineOff: false,    // true = keep off the ruler (Undated dock) even if dated

        summary:    '',
        content:    '',
        notes:      '',
        quotes:     [],
        credits:    [],
        sponsors:   [],
        connectionLog: [],

        keywords:   [],
        keywordFacets: emptyFacets(),
        aliases:    [],
        tags:       [],
        pinned:     false,
        active:     true,
        scanDepth:  null,
        sortIndex:  now(),

        createdAt:  now(),
        updatedAt:  now(),
        sourceBook: null,
        sourceStamp: null,
        kind:       'card',
        coverImage: '',
        coverPlacement: 'above',

        sourceKind: null,
        eventScale: null,          // 'world' | 'personal' when kind === 'event'
        eventImpact: { castIds: [], houseIds: [] },
        eventRecurring: false,
        eventRecur: '',            // yearly | seasonal | monthly | weekly

        ...overrides,
    };
}

function isEventCard(card) {
    if (!card) return false;
    return card.kind === 'event'
        || card.sourceKind === 'event'
        || (Array.isArray(card.tags) && card.tags.includes('showtime-event'));
}

function normalizeEventImpact(raw) {
    const ids = (list) => [...new Set((Array.isArray(list) ? list : [])
        .map(s => String(s || '').trim()).filter(Boolean))];
    return {
        castIds: ids(raw?.castIds),
        houseIds: ids(raw?.houseIds),
    };
}

const EVENT_RECUR_OPTS = [
    { id: 'yearly', label: 'Yearly' },
    { id: 'seasonal', label: 'Each season' },
    { id: 'monthly', label: 'Monthly' },
    { id: 'weekly', label: 'Weekly' },
];

// ─────────────────────────────────────────────────────────────
//  Default DB shape (stored per-chat in chatMetadata)
// ─────────────────────────────────────────────────────────────
function defaultDb() {
    return {
        version:  1,
        cards:    [],
        settings: {
            levels:          [...DEFAULT_LEVELS], // user-configurable hierarchy
            injectPinned:         true,
            injectKeyword:        true,
            injectEvents:         true,           // nearby World/Personal events
            injectRecentN:        0,              // 0 = off
            scanDepth:            4,
            replaceChatLorebook:  false,
            previousChatBook:     '',
            aiProfile:            '',
            view:                 'tree',
            tlOrientation:        'h',
            tlZoomC:              1,     // continuous pan/zoom factor (Reputation-web style)
            timelinePresent:      null, // { sort, key, scale, parts } — explicit present marker
            lockPresentYear:      true,
            tlRange: {
                startYear: null,
                startSeason: '',
                endMode: 'present',
                endYear: null,
            },
            tlShow: {
                decades: true,
                years: true,
                seasons: true,
                months: true,
                weeks: true,
                days: true,
                hours: true,
            },
            tlHintDismissed:      false,
            calendar: {
                monthsPerYear: 12,
                hoursPerDay: 24,
                seasons: [
                    { id: 'spring', label: 'Spring', startMonth: 3, endMonth: 5 },
                    { id: 'summer', label: 'Summer', startMonth: 6, endMonth: 8 },
                    { id: 'autumn', label: 'Autumn', startMonth: 9, endMonth: 11 },
                    { id: 'winter', label: 'Winter', startMonth: 12, endMonth: 2 },
                ],
                monthNames: EARTH_MONTH_LABELS.slice(),
                labels: { ...CAL_LABEL_DEFAULTS },
                yearPrefix: '',
                yearSuffix: '',
            },
            treeWidth:            220,
            aiMaxInputTokens:     8000,
            aiMaxOutputTokens:    2048,
            aiTemperature:        0.3,
            orgScheme:            'show',
        },
    };
}

// ─────────────────────────────────────────────────────────────
//  Module
// ─────────────────────────────────────────────────────────────
export class ScriptModule extends Module {
    static id    = 'script';
    static label = 'Script';
    static scope = 'chat';

    constructor(options = {}) {
    super(options);
    this._panel          = null;
    this._wiBooks        = [];
    this._profiles       = [];
    this._selectedUid    = null;        // selected tree node uid
    this._focusedUid     = null;        // expanded page in the stack
    this._expandedUids   = new Set();   // expanded tree nodes
    this._editingCardUid = null;
    this._cardsNormalized = false;
    this._checkedUids = new Set();
    this._keywordFilter = null;
    this._agentCancelled = false;
    this._connTrackT = null;
}

getDefaultState() {
    return defaultDb();
}

show() { if (this._panel) this._panel.style.display = 'flex'; }
hide() { if (this._panel) this._panel.style.display = 'none'; }

    // ── Lifecycle ───────────────────────────────────────────────

    mount(container) {
        this._panel = container;
        log('Mounted');
        this._rerender();
    }

    async init() {
    log('Initializing…');
    this._migrateLegacyIfNeeded();
    this._clearLegacyInjection();
    await this._probeSTIntegrations();
    this._registerInjection();
    this.bus?.on('cast.added',   () => this._onCastCatalogChanged());
    this.bus?.on('cast.updated', () => this._onCastCatalogChanged());
    this.bus?.on('cast.removed', () => this._onCastCatalogChanged());
    this.bus?.on('reputation.updated', () => this._scheduleConnTrack());
    this.bus?.on('reputation.removed', () => this._scheduleConnTrack());
    this._scheduleConnTrack();
    if (this._panel) this._rerender();
}

_onCastCatalogChanged() {
    if (this._panel) this._refreshDrawer();
}

_scheduleConnTrack() {
    clearTimeout(this._connTrackT);
    this._connTrackT = setTimeout(() => this._runConnTrack(), 450);
}

_runConnTrack() {
    this._connTrackT = null;
    try {
        const chat = getContext()?.chat;
        const { dirty, stamped } = runScriptConnTrack(this.storage, { chat });
        if (!dirty) return;
        this.saveState();
        if (!stamped) return;
        this.bus?.emit('showtime.stateChanged');
        if (this._panel && !this._editingCardUid) this._rerender();
    } catch (err) {
        console.warn('[Showtime Script] connection track', err);
    }
}

async onChatChanged() {
    log('Chat changed');
    clearTimeout(this._connTrackT);
    this._cardsNormalized = false;
    this._migrateLegacyIfNeeded();
    await this._loadWIBooks();
    this._profiles = await this._findProfiles();
    this.bus?.emit('showtime.stateChanged');
    this._scheduleConnTrack();
    if (this._panel) this._rerender();
}

    // ── ST Integration Probe ────────────────────────────────────
    // Runs once on init. Logs everything so you can see exactly
    // what ST is exposing before Phase 2 touches any of it.

    // ── ST Integration Probe ────────────────────────────────────
async _probeSTIntegrations() {
    log('━━ Probing ST integrations ━━');

    // Fetch raw ST settings — this is the ground truth for both
    // world_names and connection profiles
    let rawSettings = null;
    try {
        const resp = await fetch('/api/settings/get', {
            method:  'POST',
            headers: getRequestHeaders(),
        });
        if (resp.ok) {
            rawSettings = await resp.json();
            log('ST settings API: OK');
            log('ST settings top-level keys:', Object.keys(rawSettings));
        } else {
            log('ST settings API: non-OK status', resp.status);
        }
    } catch (e) {
        log('ST settings API: fetch failed —', e.message);
    }

    // World info names
    if (rawSettings) {
        log('world_names from API:', rawSettings.world_names);

        // Scan for any key that looks profile/connection related
        const profileKeys = Object.keys(rawSettings).filter(k =>
            /profile|connect|api_list/i.test(k)
        );
        log('Profile-adjacent keys in settings:', profileKeys);
        profileKeys.forEach(k => log(`  settings.${k} =`, rawSettings[k]));
    }

    // getContext shape
    const ctx = getContext();
    const ctxShape = {};
    for (const [k, v] of Object.entries(ctx)) {
        if      (typeof v === 'function') ctxShape[k] = '[fn]';
        else if (Array.isArray(v))        ctxShape[k] = `Array(${v.length})`;
        else if (v && typeof v === 'object') ctxShape[k] = `Object{${Object.keys(v).slice(0,5).join(',')}}`;
        else ctxShape[k] = v;
    }
    log('getContext() shape:', ctxShape);

    // extension_settings shape
    log('extension_settings keys:', Object.keys(extension_settings ?? {}));
    log('extension_settings (full):', JSON.parse(JSON.stringify(extension_settings ?? {})));

    // localStorage scan
    const lsHits = Object.keys(localStorage).filter(k =>
        /world|profile|connect|lorebook/i.test(k)
    );
    log('localStorage relevant keys:', lsHits);
    lsHits.forEach(k => log(`  localStorage["${k}"] =`, localStorage.getItem(k)?.slice(0, 200)));

    // DOM scan
    const domTargets = [
        '#world_info', '#world_info_name', '.world_info_select',
        '#connection_profile', '#api_connection_profile',
    ];
    domTargets.forEach(sel => {
        const el = document.querySelector(sel);
        if (el) log(`DOM element "${sel}":`, el.tagName, el.value ?? '[no value]');
    });

    // Now do the actual loads using what we found
    await this._loadWIBooks(rawSettings, { force: true });
    log(`WI books: ${this._wiBooks.length}`,
        this._wiBooks.map(b => `${b.name} (${b.entries.length})`));

    this._profiles = await this._findProfiles(rawSettings);
    log(`Connection profiles: ${this._profiles.length}`,
        this._profiles.map(p => p.name));

    log('━━ Probe complete ━━');
}

// ── World Info Books ────────────────────────────────────────
async _loadWIBooks(rawSettings = null, { force = false } = {}) {
    // Every call re-reads EVERY lorebook. ST's cache clones each book on read
    // (structuredClone), so this is real CPU on a big install — and it used to
    // run on boot and on every chat switch. Reuse a recent load instead.
    const WI_TTL_MS = 60000;
    if (!force && this._wiBooks?.length && Date.now() - (this._wiLoadedAt || 0) < WI_TTL_MS) return;
    this._wiBooks = [];
    this._wiLoadedAt = Date.now();

    // ── Strategy 1: ST settings API ─────────────────────────
    // world_names is a module-scope var in script.js — the only
    // reliable way to read it from an extension is via the API.
    if (!rawSettings) {
        try {
            const resp = await fetch('/api/settings/get', {
                method:  'POST',
                headers: getRequestHeaders(),
            });
            if (resp.ok) rawSettings = await resp.json();
        } catch (e) {
            log('_loadWIBooks: settings API fetch failed —', e.message);
        }
    }

    const names = rawSettings?.world_names ?? [];
    if (names.length) {
        log('WI strategy 1 (settings API): names =', names);
        const results = await Promise.allSettled(
            names.map(name =>
                loadWorldInfo(name).then(wi => ({ name, wi }))
            )
        );
        this._wiBooks = results
            .filter(r => r.status === 'fulfilled' && r.value?.wi)
            .map(r => {
                const { name, wi } = r.value;
                const raw = wi.entries ?? {};
                return {
                    uid:     wi.file_name || name,
                    name,
                    entries: Array.isArray(raw) ? raw : Object.values(raw),
                };
            });
        if (this._wiBooks.length) return;
        log('WI strategy 1: world_names was empty or all loads failed');
    }

    // ── Strategy 2: window.world_names ──────────────────────
    // Some ST builds do expose this as a global.
    const winNames = window.world_names ?? [];
    if (winNames.length) {
        log('WI strategy 2 (window.world_names):', winNames);
        const results = await Promise.allSettled(
            winNames.map(name =>
                loadWorldInfo(name).then(wi => ({ name, wi }))
            )
        );
        this._wiBooks = results
            .filter(r => r.status === 'fulfilled' && r.value?.wi)
            .map(r => {
                const { name, wi } = r.value;
                const raw = wi.entries ?? {};
                return { uid: wi.file_name || name, name,
                         entries: Array.isArray(raw) ? raw : Object.values(raw) };
            });
        if (this._wiBooks.length) return;
    }

    // ── Strategy 3: getContext() properties ─────────────────
    const ctx = getContext();
    const ctxCandidates = [
        ['ctx.world_info',              ctx.world_info],
        ['ctx.worldInfo',               ctx.worldInfo],
        ['ctx.chatMetadata.world_info', ctx.chatMetadata?.world_info],
    ];
    for (const [label, val] of ctxCandidates) {
        if (!val) continue;
        if (Array.isArray(val) && val.length) {
            log(`WI strategy 3 (${label}, array)`);
            this._wiBooks = val.map((w, i) => ({
                uid:     w.uid || w.file_name || w.name || `wi-${i}`,
                name:    w.name || w.file_name || `Lorebook ${i + 1}`,
                entries: Array.isArray(w.entries)
                    ? w.entries
                    : Object.values(w.entries ?? {}),
            }));
            return;
        }
        if (val?.entries) {
            log(`WI strategy 3 (${label}, single)`);
            this._wiBooks = [{
                uid:     val.file_name || val.name || 'current',
                name:    val.name || val.file_name || 'Current Lorebook',
                entries: Array.isArray(val.entries)
                    ? val.entries
                    : Object.values(val.entries),
            }];
            return;
        }
    }

    log('WI: all strategies exhausted — no books found');
}

// ── Connection Profiles ─────────────────────────────────────
async _findProfiles(rawSettings = null) {
    // ── Strategy 1: ST settings API ─────────────────────────
    // Profiles live in settings.json, not as window globals.
    if (!rawSettings) {
        try {
            const resp = await fetch('/api/settings/get', {
                method:  'POST',
                headers: getRequestHeaders(),
            });
            if (resp.ok) rawSettings = await resp.json();
        } catch (e) {
            log('_findProfiles: settings API fetch failed —', e.message);
        }
    }

    if (rawSettings) {
        // Try every plausible key name — ST has changed this across versions
        const candidates = [
            rawSettings.connection_profiles,
            rawSettings.connectionProfiles,
            rawSettings.connectionManager?.profiles,
            rawSettings.connection_manager?.profiles,
            rawSettings.api_connection_profiles,
        ].filter(Boolean);

        for (const c of candidates) {
            if (Array.isArray(c) && c.length) {
                log('Profiles: found via settings API (array)');
                return c.map(p => ({ id: p.id || p.name, name: p.name || p.id }));
            }
            if (c && typeof c === 'object') {
                const ents = Object.entries(c);
                if (ents.length) {
                    log('Profiles: found via settings API (object)');
                    return ents.map(([id, p]) => ({
                        id,
                        name: (typeof p === 'object' ? p.name : p) || id,
                    }));
                }
            }
        }
        log('Profiles: settings API returned nothing useful under any profile key');
    }

    // ── Strategy 2: extension_settings deep scan ─────────────
    const es = extension_settings ?? {};
    const esCandidates = [
        es.connection_profiles,
        es.connectionProfiles,
        es.connectionManager?.profiles,
        es.connection_manager?.profiles,
    ].filter(Boolean);

    for (const c of esCandidates) {
        if (Array.isArray(c) && c.length) {
            log('Profiles: found via extension_settings (array)');
            return c.map(p => ({ id: p.id || p.name, name: p.name || p.id }));
        }
        if (c && typeof c === 'object') {
            const ents = Object.entries(c);
            if (ents.length) {
                log('Profiles: found via extension_settings (object)');
                return ents.map(([id, p]) => ({
                    id,
                    name: (typeof p === 'object' ? p.name : p) || id,
                }));
            }
        }
    }

    // ── Strategy 3: window globals ───────────────────────────
    const mgr = window.connection_manager ?? window.connectionManager ?? null;
    if (mgr) {
        const p = mgr.profiles ?? mgr.getProfiles?.();
        if (Array.isArray(p) && p.length) {
            log('Profiles: found via window connection_manager (array)');
            return p.map(x => ({ id: x.id || x.name, name: x.name || x.id }));
        }
        if (p && typeof p === 'object') {
            const ents = Object.entries(p);
            if (ents.length) {
                log('Profiles: found via window connection_manager (object)');
                return ents.map(([id, x]) => ({
                    id,
                    name: (typeof x === 'object' ? x.name : x) || id,
                }));
            }
        }
    }

    // ── Strategy 4: localStorage ─────────────────────────────
    const lsKeys = Object.keys(localStorage).filter(k =>
        /profile|connect/i.test(k)
    );
    for (const k of lsKeys) {
        try {
            const parsed = JSON.parse(localStorage.getItem(k));
            if (Array.isArray(parsed) && parsed.length && parsed[0]?.name) {
                log(`Profiles: found via localStorage["${k}"]`);
                return parsed.map(p => ({ id: p.id || p.name, name: p.name || p.id }));
            }
        } catch (_) { /* not JSON */ }
    }

    log('Profiles: all strategies exhausted — none found');
    return [];
}

    _clearLegacyInjection() {
        const ctx = getContext();
        ctx.setExtensionPrompt?.(LEGACY_INJECTION_ID, '', 1, 0);
    }

    _registerInjection() {
        if (!this.injector) {
            log('Injector not available — Script injection skipped');
            return;
        }
        this.injector.register({
            id: 'script.lore',
            always: true,
            buildText: () => {
                const db = this._db();
                return this._buildInjectionText(this._getInjectionCandidates(db));
            },
        });
        this.bus?.emit('showtime.stateChanged');
        log('Script injection registered via host Injector');
    }

    _scanHaystack(depth) {
        const chat = getContext().chat ?? [];
        const n = Math.max(0, Number(depth) || 0);
        if (!n) return '';
        return chat.slice(-n).map(m => m?.mes ?? '').join('\n').toLowerCase();
    }

    _cardKeys(card) {
        return [...(card.keywords || [])]
            .map(k => String(k).trim())
            .filter(Boolean);
    }

    _keysMatch(keys, haystack) {
        if (!keys.length || !haystack) return false;
        // Key must start at a word boundary ("art" ≠ "start"), but any ending is
        // allowed so inflected forms still match ("пожар" → "пожара").
        const wordChar = /[\p{L}\p{N}_]/u;
        return keys.some(k => {
            const key = k.toLowerCase();
            for (let i = haystack.indexOf(key); i !== -1; i = haystack.indexOf(key, i + 1)) {
                if (i === 0 || !wordChar.test(haystack[i - 1]) || !wordChar.test(key[0])) return true;
            }
            return false;
        });
    }

    _getInjectionCandidates(db) {
        const s      = db.settings;
        const active = db.cards.filter(c => c.active);
        const scanDepth = Math.max(0, Number(s.scanDepth) || 4);
        const defaultHay = this._scanHaystack(scanDepth);

        const pinned = s.injectPinned
            ? active.filter(c => c.pinned)
            : [];

        const keyed = s.injectKeyword
            ? active.filter(c => {
                if (c.pinned) return false;
                const keys = this._cardKeys(c);
                if (!keys.length) return false;
                const depth = c.scanDepth != null ? Number(c.scanDepth) : scanDepth;
                const hay = depth === scanDepth ? defaultHay : this._scanHaystack(depth);
                return this._keysMatch(keys, hay);
            })
            : [];

        const recent = s.injectRecentN > 0
            ? active.filter(c => !c.pinned && !isEventCard(c) && !this._cardKeys(c).length).slice(-s.injectRecentN)
            : [];

        const seen = new Set();
        const out = [...pinned, ...keyed, ...recent].filter(c => {
            if (seen.has(c.uid)) return false;
            seen.add(c.uid);
            return true;
        });
        if (s.injectEvents !== false) {
            for (const ev of this._nearbyEventCards(db, defaultHay)) {
                if (seen.has(ev.uid)) continue;
                seen.add(ev.uid);
                out.push(ev);
            }
        }
        return out;
    }

    _repHouses() {
        try {
            const rep = this.storage.getChat('reputation', { personal: [], house: [] });
            return (rep.house || []).filter(h => h && h.id);
        } catch {
            return [];
        }
    }

    /** Recurring events snap to the occurrence nearest the narrative present. */
    _eventOccurrenceSort(card, present) {
        const hit = this._parseCardTime(card);
        if (!hit || !Number.isFinite(hit.parsed.sort)) return null;
        const authored = hit.parsed.sort;
        if (!card.eventRecurring || !present || !Number.isFinite(present.sort)) return authored;
        const eventDate = hit.parsed.scale === 'date';
        const presentDate = present.scale === 'date';
        if (eventDate !== presentDate) return authored;
        const rule = String(card.eventRecur || 'yearly').toLowerCase();
        const unitId = rule.includes('week') ? 'weeks'
            : rule.includes('month') ? 'months'
            : rule.includes('season') ? 'seasons'
            : 'years';
        const cal = this._cal();
        const unit = timelineUnitSort(unitId, eventDate ? 'date' : (hit.parsed.scale || 'day'), cal);
        if (!(unit > 0)) return authored;
        return authored + Math.round((present.sort - authored) / unit) * unit;
    }

    _eventImpactLabel(card) {
        if (!isEventCard(card)) return '';
        if (card.eventScale !== 'personal') return 'World';
        const members = this._castMembers();
        const houses = this._repHouses();
        const names = [
            ...(card.eventImpact?.castIds || []).map(id => members.find(m => m.id === id)?.name).filter(Boolean),
            ...(card.eventImpact?.houseIds || []).map(id => {
                const h = houses.find(x => x.id === id);
                return h ? (h.alias ? `${h.name} (${h.alias})` : h.name) : '';
            }).filter(Boolean),
        ];
        return names.length ? `Personal · ${names.join(', ')}` : 'Personal';
    }

    _eventImpactsInPlay(card, haystack) {
        if (card.eventScale !== 'personal') return true;
        const impact = card.eventImpact || { castIds: [], houseIds: [] };
        if (!impact.castIds?.length && !impact.houseIds?.length) return true;
        const members = this._castMembers();
        const star = members.find(m => m.priority === 'star' || m.is_user);
        if (star && impact.castIds.includes(star.id)) return true;
        const hay = String(haystack || '').toLowerCase();
        if (!hay) return false;
        for (const id of impact.castIds || []) {
            const m = members.find(x => x.id === id);
            if (!m) continue;
            const names = [m.name, ...(m.aliases || [])].map(n => String(n || '').toLowerCase()).filter(Boolean);
            if (names.some(n => hay.includes(n))) return true;
        }
        for (const hid of impact.houseIds || []) {
            const h = this._repHouses().find(x => x.id === hid);
            const label = String(h?.alias || h?.name || '').toLowerCase();
            if (label && hay.includes(label)) return true;
        }
        return false;
    }

    _nearbyEventCards(db, haystack) {
        const present = this.getTimelinePresent();
        if (!present || !Number.isFinite(present.sort)) return [];
        const cal = this._cal();
        const presentDate = present.scale === 'date';
        const window = timelineUnitSort('seasons', presentDate ? 'date' : (present.scale || 'day'), cal) * 1.15;
        if (!(window > 0)) return [];
        return (db.cards || [])
            .filter(c => c.active !== false && isEventCard(c) && !c.virtual)
            .map(c => {
                const occ = this._eventOccurrenceSort(c, present);
                if (occ == null) return null;
                const hit = this._parseCardTime(c);
                const eventDate = hit?.parsed?.scale === 'date';
                if (eventDate !== presentDate) return null;
                const dist = Math.abs(occ - present.sort);
                if (dist > window) return null;
                if (!this._eventImpactsInPlay(c, haystack)) return null;
                return { card: c, dist };
            })
            .filter(Boolean)
            .sort((a, b) => a.dist - b.dist)
            .slice(0, 4)
            .map(x => x.card);
    }

    _buildInjectionText(cards) {
        if (!cards.length) return '';
        const stampedLore = this._injectStampedLoreEnabled();
        const blocks = cards.map(c => {
            const body = (c.summary || '').trim() || (c.content || '').trim();
            if (!body && !(stampedLore && normalizeSourceStamp(c.sourceStamp))) return '';
            const eventHead = isEventCard(c)
                ? `[${c.eventScale === 'personal' ? 'Personal Event' : 'World Event'} · ${c.title}${c.span || c.timeKey ? ` | ${c.span || c.timeKey}` : ''}]`
                : `[${c.title}${c.span ? ` | ${c.span}` : ''}]`;
            const lines = [eventHead];
            if (isEventCard(c) && c.eventRecurring) {
                const rule = EVENT_RECUR_OPTS.find(o => o.id === c.eventRecur)?.label || 'Recurring';
                lines.push(`Recurring: ${rule}.`);
            }
            if (isEventCard(c) && c.eventScale === 'personal') {
                const who = this._eventImpactLabel(c);
                if (who && who !== 'Personal') lines.push(`Impacts: ${who.replace(/^Personal · /, '')}.`);
            }
            if (body) lines.push(body.length > 420 ? `${body.slice(0, 419).trimEnd()}…` : body);
            if (c.quotes?.length) {
                lines.push('Quotes:');
                c.quotes.forEach(q => lines.push(`  ${q.character}: "${String(q.text || '').slice(0, 140)}${String(q.text || '').length > 140 ? '…' : ''}"`));
            }
            const creditStr = (c.credits || [])
                .map(cr => {
                    const name = cr.name || cr.character || '';
                    const role = creditRoleLabel(this._liveCreditRole(cr, this._castMembers()) || cr.role);
                    if (!name && !role) return '';
                    return name && role ? `${name} (${role})` : (name || role);
                })
                .filter(Boolean)
                .join(', ');
            if (creditStr) lines.push('Characters: ' + creditStr);
            const sponsorStr = (c.sponsors || [])
                .map(sp => this._liveSponsor(sp))
                .filter(Boolean)
                .map(sp => sp.typeLabel ? `${sp.name} (${sp.typeLabel})` : sp.name)
                .join(', ');
            if (sponsorStr) lines.push('Sponsored by: ' + sponsorStr);
            const kw = KEYWORD_EDIT_FACETS.flatMap(f => c.keywordFacets?.[f.id] || []);
            if (kw.length) lines.push('Keywords: ' + kw.join(', '));
            if (stampedLore) {
                for (const lore of this._resolveStampLore(c)) {
                    lines.push(`---`);
                    lines.push(`[Lore · ${lore.title}${lore.book ? ` · ${lore.book}` : ''}]`);
                    lines.push(lore.content.length > 280 ? `${lore.content.slice(0, 279).trimEnd()}…` : lore.content);
                }
            }
            return lines.join('\n');
        }).filter(Boolean);
        // Budget the prompt: blocks arrive in priority order (pinned, keyword,
        // recent, events), so keep whole blocks until the cap is reached.
        const SEP = '\n\n---\n\n';
        const kept = [];
        let used = 0;
        for (const block of blocks) {
            const cost = block.length + (kept.length ? SEP.length : 0);
            if (kept.length && used + cost > SCRIPT_INJECTION_CHAR_BUDGET) break;
            kept.push(block);
            used += cost;
        }
        return kept.join(SEP);
    }

    /** Production → Director sources → pull stamped lore with Script cards. */
    _injectStampedLoreEnabled() {
        try {
            const bst = this.storage.getChat('backstage', {});
            return !!bst?.production?.sources?.scriptStampedLore;
        } catch {
            return false;
        }
    }

    /** Resolve World Info / Library bodies for a card’s ⌘ sourceStamp (sync, best-effort). */
    _resolveStampLore(card) {
        const stamp = normalizeSourceStamp(card?.sourceStamp);
        if (!stamp?.entries?.length) return [];
        let leaves = [];
        try {
            const books = (this._wiBooks?.length ? this._wiBooks : null) || getCachedLibraryBooks();
            leaves = listLibraryLeaves(this.storage, books);
        } catch {
            leaves = [];
        }
        const out = [];
        const seen = new Set();
        for (const e of stamp.entries) {
            let leaf = leaves.find(l => e.key && l.key === e.key);
            if (!leaf && e.book && e.uid != null) {
                leaf = leaves.find(l => l.book === e.book && String(l.uid) === String(e.uid));
            }
            if (!leaf && e.book && e.title) {
                leaf = leaves.find(l => l.book === e.book && l.title === e.title);
            }
            if (!leaf && e.book) {
                const book = (this._wiBooks || []).find(b => b.name === e.book);
                const raw = book?.entries?.find(x =>
                    (e.uid != null && String(x.uid) === String(e.uid))
                    || (e.title && String(x.comment || '').trim() === e.title));
                if (raw) {
                    leaf = {
                        key: libraryEntryKey(e.book, raw.uid),
                        title: String(raw.comment || e.title || 'Untitled').trim(),
                        book: e.book,
                        content: String(raw.content || ''),
                    };
                }
            }
            const content = String(leaf?.content || '').trim();
            const key = leaf?.key || `${e.book}|${e.uid}|${e.title}`;
            if (!content || seen.has(key)) continue;
            seen.add(key);
            out.push({
                title: leaf?.title || e.title || 'Lore',
                book: leaf?.book || e.book || '',
                content,
            });
        }
        return out;
    }

    // ── DB Helpers ──────────────────────────────────────────────

    _migrateLegacyIfNeeded() {
        const meta = getContext().chatMetadata;
        if (!meta?.[LEGACY_META_KEY]) return;
        const legacy = meta[LEGACY_META_KEY];
        const current = this.state;
        if (!current.cards?.length && Array.isArray(legacy.cards) && legacy.cards.length) {
            current.cards = structuredClone(legacy.cards);
        }
        if (legacy.settings && typeof legacy.settings === 'object') {
            current.settings = { ...current.settings, ...structuredClone(legacy.settings) };
        }
        if (legacy.version) current.version = legacy.version;
        delete meta[LEGACY_META_KEY];
        this.saveState();
        log('Migrated legacy showtime_script → showtime.script');
    }

    _castMembers() {
        return getCastMembers(this.storage);
    }

    _actingCast() {
        return this._castMembers().filter(m => !isDirectorRole(m.priority));
    }

    _starCreditNeedles() {
        const needles = new Set();
        const add = s => {
            const t = String(s || '').trim().toLowerCase();
            if (t) needles.add(t);
        };
        add('{{user}}');
        add('you');
        try {
            const ctx = getContext();
            add(ctx?.name1);
        } catch { /* ignore */ }
        const star = getStarMember(this.storage);
        if (star) {
            add(star.name);
            for (const a of star.aliases || []) add(a);
        }
        return needles;
    }

    _memberForCreditName(name, members = this._castMembers()) {
        const n = String(name || '').trim();
        if (!n) return null;
        const hit = (members || []).find(c => castNameMatches(c, n));
        if (hit) return isDirectorRole(hit.priority) ? null : hit;
        const star = (members || []).find(c => c.priority === 'star' || c.is_user) || getStarMember(this.storage);
        if (star && this._starCreditNeedles().has(n.toLowerCase())) return star;
        return null;
    }

    _creditIdentityKeys(credit, members = this._castMembers()) {
        const keys = new Set();
        const add = s => {
            const t = String(s || '').trim().toLowerCase();
            if (t) keys.add(t);
        };
        add(credit?.name);
        let member = null;
        if (credit?.characterId) {
            add(`id:${credit.characterId}`);
            member = (members || []).find(c => c.id === credit.characterId) || null;
        }
        if (!member && credit?.name) member = this._memberForCreditName(credit.name, members);
        if (member) {
            add(`id:${member.id}`);
            add(member.name);
            for (const a of member.aliases || []) add(a);
            if (member.priority === 'star' || member.is_user) {
                for (const extra of this._starCreditNeedles()) add(extra);
            }
        }
        return keys;
    }

    _creditsOverlap(a, b, members) {
        const A = this._creditIdentityKeys(a, members);
        const B = this._creditIdentityKeys(b, members);
        for (const k of A) {
            if (k.startsWith('id:') && B.has(k)) return true;
        }
        for (const k of A) {
            if (!k.startsWith('id:') && B.has(k)) return true;
        }
        return false;
    }

    _dedupeCredits(list, members = this._castMembers()) {
        const out = [];
        for (const raw of list || []) {
            const cr = this._normalizeCredit(raw, members);
            if (!cr) continue;
            const hit = out.findIndex(x => this._creditsOverlap(x, cr, members));
            if (hit < 0) {
                out.push(cr);
                continue;
            }
            const prev = out[hit];
            const merged = this._normalizeCredit({
                characterId: prev.characterId || cr.characterId || null,
                name: prev.characterId ? prev.name : (cr.characterId ? cr.name : prev.name || cr.name),
                role: prev.characterId ? prev.role : (cr.characterId ? cr.role : prev.role || cr.role),
            }, members);
            if (merged) out[hit] = merged;
        }
        return out;
    }

    _liveCreditRole(credit, members = this._castMembers()) {
        if (credit?.characterId) {
            const m = members.find(c => c.id === credit.characterId);
            if (m) return m.priority;
        }
        if (credit?.name) {
            const m = this._memberForCreditName(credit.name, members);
            if (m) return m.priority;
        }
        return unlinkedCreditRole(credit?.role) || 'cameo';
    }

    _addNpcToCast(name, { priority = 'supporting' } = {}) {
        const n = String(name || '').trim();
        if (!n) return null;
        const cast = this.storage.getChat('cast', { characters: [] });
        cast.characters ??= [];
        const existing = this._memberForCreditName(n, cast.characters)
            || cast.characters.find(c => castNameMatches(c, n));
        if (existing) return existing;
        const character = {
            id: uid(),
            name: n,
            aliases: [],
            priority: isDirectorRole(priority) ? 'supporting' : (priority || 'supporting'),
            portrait: '',
            description: '',
            characterCardId: '',
            syncFromCard: false,
            wardrobe: [],
            props: [],
            condition: '',
            plotHooks: [],
            genreNotes: '',
            createdAt: now(),
            updatedAt: now(),
        };
        cast.characters.push(character);
        this.storage.saveChat();
        this.bus?.emit('cast.added', { character });
        log('NPC added to Cast', n);
        return character;
    }

    _normalizeCredit(raw, members) {
        if (!raw || typeof raw !== 'object') return null;
        const name = String(raw.name || raw.character || '').trim();
        let role = raw.role || null;
        let characterId = raw.characterId ?? null;
        if (characterId) {
            const m = members.find(c => c.id === characterId);
            if (!m) {
                if (!name) return null;
                const roleOut = unlinkedCreditRole(role);
                return roleOut ? { characterId: null, name, role: roleOut } : null;
            }
            if (isDirectorRole(m.priority)) return null;
            return { characterId: m.id, name: m.name, role: m.priority };
        }
        if (name) {
            const m = this._memberForCreditName(name, members);
            if (m) {
                if (isDirectorRole(m.priority)) return null;
                return { characterId: m.id, name: m.name, role: m.priority };
            }
            const roleOut = unlinkedCreditRole(role);
            if (!roleOut) return null;
            return { characterId: null, name, role: roleOut };
        }
        return null;
    }

    _normalizeSponsor(raw) {
        if (!raw || typeof raw !== 'object') return null;
        const name = String(raw.name || raw.title || '').trim();
        if (!name) return null;
        const kind = raw.kind === 'house' ? 'house' : 'dossier';
        const id = String(raw.id || raw.houseId || raw.nodeId || '').trim() || null;
        const typeLabel = String(raw.typeLabel || (kind === 'house' ? 'Affiliation' : 'Dossier')).trim()
            || (kind === 'house' ? 'Affiliation' : 'Dossier');
        return { id, name, kind, typeLabel };
    }

    _reputationLinkOptions() {
        let rep = { personal: [], house: [] };
        try { rep = this.storage.getChat('reputation', { personal: [], house: [] }) || rep; } catch { /* ignore */ }
        const houses = (rep.house || []).map(h => ({
            id: h.id,
            name: String(h.alias || h.name || '').trim() || 'Affiliation',
            kind: 'house',
            typeLabel: 'Affiliation',
        })).filter(h => h.id);
        const dossiers = (rep.personal || [])
            .filter(n => n && n.kind !== 'self' && n.id && n.id !== 'self')
            .map(n => ({
                id: n.id,
                name: String(n.name || '').trim() || 'Untitled',
                kind: 'dossier',
                typeLabel: n.category === 'group' ? 'Group'
                    : n.category === 'rumor' ? 'Rumor'
                        : 'Dossier',
            }));
        return [...houses, ...dossiers];
    }

    _liveSponsor(sp) {
        const base = this._normalizeSponsor(sp);
        if (!base) return null;
        if (!base.id) return base;
        const hit = this._reputationLinkOptions().find(o =>
            o.id === base.id || (o.name || '').toLowerCase() === base.name.toLowerCase());
        if (!hit) return base;
        return { ...base, name: hit.name, kind: hit.kind, typeLabel: hit.typeLabel };
    }

    _normalizeCard(card, members) {
        const c = { ...card };
        if ((!c.credits || !c.credits.length) && Array.isArray(c.roles) && c.roles.length) {
            c.credits = c.roles.map(role => ({ characterId: null, name: '', role }));
        }
        c.credits  = this._dedupeCredits(c.credits || [], members);
        c.sponsors = (c.sponsors || []).map(sp => this._normalizeSponsor(sp)).filter(Boolean);
        if (!c.summary && c.content) c.summary = c.content;
        if (c.keywords && typeof c.keywords === 'object' && !Array.isArray(c.keywords)) {
            c.keywordFacets = normalizeFacets({ ...normalizeFacets(c.keywordFacets), ...c.keywords });
            c.keywords = [];
        }
        c.keywords = Array.isArray(c.keywords) ? c.keywords.map(k => String(k).trim()).filter(Boolean) : [];
        if (Array.isArray(c.tags) && c.tags.length) {
            for (const t of c.tags) {
                const s = String(t).trim();
                if (s && !c.keywords.some(k => k.toLowerCase() === s.toLowerCase())) c.keywords.push(s);
            }
            c.tags = [];
        }
        c.keywordFacets = normalizeFacets(c.keywordFacets || c.keyword_facets);
        // Character keyword tags are obsolete — fold into Credits, then clear.
        const legacyChars = [...(c.keywordFacets.characters || [])].map(s => String(s).trim()).filter(Boolean);
        for (const name of legacyChars) {
            if (this._dedupeCredits([...c.credits, { name }], members).length === c.credits.length) continue;
            const n = this._normalizeCredit({ name }, members);
            if (n) c.credits.push(n);
        }
        c.credits = this._dedupeCredits(c.credits, members);
        c.keywordFacets.characters = [];
        const fromFacets = flattenFacets(c.keywordFacets);
        const seen = new Set(fromFacets.map(k => k.toLowerCase()));
        for (const k of c.keywords) {
            if (seen.has(k.toLowerCase())) continue;
            c.keywordFacets.objects.push(k);
            seen.add(k.toLowerCase());
        }
        c.keywords = flattenFacets(c.keywordFacets);
        c.quotes   = Array.isArray(c.quotes) ? c.quotes : [];
        c.connectionLog = normalizeConnLog(c.connectionLog);
        c.aliases  = Array.isArray(c.aliases)  ? c.aliases  : [];
        c.spanParts = (c.spanParts && typeof c.spanParts === 'object')
            ? {
                year: !!c.spanParts.year,
                season: !!c.spanParts.season,
                month: !!c.spanParts.month,
                week: !!c.spanParts.week,
                day: !!c.spanParts.day,
                hour: !!c.spanParts.hour,
                phase: !!c.spanParts.phase,
            }
            : null;
        c.tags     = [];
        c.pinned   = !!c.pinned;
        c.active   = c.active !== false;
        if (c.scanDepth == null) c.scanDepth = null;
        if (c.sortIndex == null) c.sortIndex = c.createdAt ?? 0;
        if (isEventCard(c)) c.kind = 'event';
        if (c.kind !== 'folder' && c.kind !== 'card' && c.kind !== 'event') {
            const levels = this.state.settings?.levels || DEFAULT_LEVELS;
            const idx = levels.findIndex(l => l.id === c.levelId);
            c.kind = (idx >= 0 && idx < levels.length - 1) ? 'folder' : 'card';
        }
        c.sourceKind = c.sourceKind ? String(c.sourceKind) : (c.kind === 'event' ? 'event' : null);
        c.eventScale = c.eventScale === 'personal' ? 'personal' : (c.kind === 'event' ? 'world' : (c.eventScale || null));
        c.eventImpact = normalizeEventImpact(c.eventImpact);
        c.eventRecurring = !!c.eventRecurring;
        const recur = String(c.eventRecur || '').toLowerCase();
        c.eventRecur = EVENT_RECUR_OPTS.some(o => o.id === recur) ? recur : (c.eventRecurring ? 'yearly' : '');
        if (c.kind === 'event') {
            c.timeLocked = true;
            c.timeManual = false;
            c.timeManualSort = null;
            if (!c.sourceKind) c.sourceKind = 'event';
            if (c.eventScale !== 'personal') c.eventScale = 'world';
        }
        c.notes    = c.notes ?? '';
        c.sourceBook = c.sourceBook ? String(c.sourceBook) : null;
        c.sourceStamp = normalizeSourceStamp(c.sourceStamp);
        c.timeKey  = String(c.span || c.timeKey || c.keywordFacets?.datetime?.[0] || '').trim();
        c.timeLane = Number(c.timeLane) || 0;
        c.timeManual = !!c.timeManual;
        c.timeManualSort = Number.isFinite(Number(c.timeManualSort)) ? Number(c.timeManualSort) : null;
        c.timeLocked = !!c.timeLocked;
        c.timelineOff = !!c.timelineOff;
        if (c.timeLocked) { c.timeManual = false; c.timeManualSort = null; }
        if (c.timelineOff) { c.timeManual = false; c.timeManualSort = null; }
        c.coverImage = String(c.coverImage || c.cover || '').trim();
        c.coverPlacement = c.coverPlacement === 'below' ? 'below' : 'above';
        return c;
    }

    _db() {
        this._migrateLegacyIfNeeded();
        const db = this.state;
        db.version  ??= 1;
        db.cards    ??= [];
        db.settings ??= defaultDb().settings;
        for (const [k, v] of Object.entries(defaultDb().settings)) {
            db.settings[k] ??= v;
        }
        if (!Array.isArray(db.settings.levels) || !db.settings.levels.length) {
            db.settings.levels = [...DEFAULT_LEVELS];
        } else {
            db.settings.levels = normalizeLevels(db.settings.levels);
        }
        if (!this._cardsNormalized) {
            const members = this._castMembers();
            let dirty = false;
            db.cards = db.cards.map(c => {
                if ((c.roles?.length && !c.credits?.length) || (!c.content && c.summary)) dirty = true;
                return this._normalizeCard(c, members);
            });
            this._cardsNormalized = true;
            if (dirty) this.saveState();
        }
        return db;
    }

    _cards() { return this._db().cards; }

    _save(_db) {
        this.saveState();
        this.bus?.emit('showtime.stateChanged');
    }

    _boundChatBook() {
        return getContext().chatMetadata?.[METADATA_KEY] || '';
    }

    _setChatLorebook(name) {
        const meta = getContext().chatMetadata ?? {};
        if (name) {
            meta[METADATA_KEY] = name;
            document.querySelector('.chat_lorebook_button')?.classList.add('world_set');
        } else {
            delete meta[METADATA_KEY];
            document.querySelector('.chat_lorebook_button')?.classList.remove('world_set');
        }
        if (typeof saveMetadata === 'function') saveMetadata();
        else getContext().saveMetadata?.();
    }

    _applyReplaceChatLorebook(enable) {
        const db = this._db();
        if (enable) {
            const bound = this._boundChatBook();
            if (bound) db.settings.previousChatBook = bound;
            this._setChatLorebook('');
            db.settings.replaceChatLorebook = true;
        } else {
            db.settings.replaceChatLorebook = false;
            if (db.settings.previousChatBook && !this._boundChatBook()) {
                this._setChatLorebook(db.settings.previousChatBook);
            }
        }
        this._save(db);
    }

    _wiKeysFromEntry(e) {
        const primary = Array.isArray(e.key) ? e.key : (e.key ? [e.key] : []);
        const secondary = Array.isArray(e.keysecondary) ? e.keysecondary : [];
        return [...primary, ...secondary].map(k => String(k).trim()).filter(Boolean);
    }

    /** Parent folder uid for new leaf cards (never nest under another card). */
    _folderParentUid(uid = this._selectedUid) {
        if (!uid) return null;
        const db = this._db();
        const card = this._getCard(uid);
        if (!card) return null;
        if (this._isFolder(card, db)) return card.uid;
        return card.parentUid || null;
    }

    _importEntriesDirect(entries, parentUid, sourceBook) {
        const db = this._db();
        const leafId = this._cardLevelId(db);
        const safeParent = this._folderParentUid(parentUid);
        const cards = [];
        for (const e of entries) {
            if (!e || e.disable) continue;
            const keys = this._wiKeysFromEntry(e);
            const title = String(e.comment || keys[0] || 'Untitled').trim();
            const stamp = this._buildSourceStamp([e], 'direct');
            cards.push(this._addCard({
                levelId:   leafId,
                kind:      'card',
                title,
                content:   String(e.content || '').trim(),
                keywords:  keys,
                pinned:    !!e.constant,
                active:    true,
                sourceBook: sourceBook || e._bookName || null,
                sourceStamp: stamp,
                parentUid: safeParent,
            }));
        }
        return { count: cards.length, cards };
    }

    _buildSourceStamp(entries, mode = 'lore') {
        const list = (entries || []).filter(Boolean);
        if (!list.length) return null;
        return normalizeSourceStamp({
            at: Date.now(),
            mode,
            entries: list.map((e, i) => ({
                book: e._bookName || '',
                title: this._entryLabel(e, i),
                key: e._libKey || '',
                uid: e.uid != null ? String(e.uid) : (e.id != null ? String(e.id) : ''),
            })),
        });
    }

    /**
     * After an Agent lore run, rebuild Library scene tags from each card's
     * sourceStamp. Never dump the union of scene codes onto the union of
     * selected leaves — that cross-labelled every entry with every card.
     */
    _stampLibraryScenes(_entries, _cards) {
        return this._refreshLibraryStamps();
    }

    _refreshLibraryAfterStamp() {
        const lib = window.Showtime?.modules?.get('library');
        lib?._invalidate?.();
        if (lib?._view && lib.container) lib._paint?.();
        this.bus?.emit('showtime.stateChanged');
    }

    /** Leaf keys claimed by this card's ⌘ provenance. Scene tags stay
     * per-entry — book-level scene tags used to inherit onto every leaf. */
    _stampTargetsForCard(card) {
        const stamp = normalizeSourceStamp(card?.sourceStamp);
        const leafKeys = [...new Set((stamp?.entries || []).map(e => e.key).filter(Boolean))];
        return { leafKeys, bookNames: [] };
    }

    /** Snapshot uid → scene code (codes shift when siblings are removed). */
    _sceneCodeSnapshot(db = this._db()) {
        const map = new Map();
        for (const c of db.cards || []) {
            if (this._isFolder(c, db)) continue;
            const code = sceneCode(c, db);
            if (code) map.set(c.uid, code);
        }
        return map;
    }

    /** Clear Library scene tags for a card about to be deleted. */
    _unstampCard(card, codeOverride = null) {
        if (!card || this._isFolder(card)) return 0;
        const db = this._db();
        const code = codeOverride || sceneCode(card, db);
        const { leafKeys, bookNames } = this._stampTargetsForCard(card);
        if (!code || (!leafKeys.length && !bookNames.length)) return 0;
        return unstampSceneCodes(this.storage, { leafKeys, bookNames, codes: [code] });
    }

    /**
     * After delete/reorder: retarget Library stamps when a card's scene code
     * changed, then drop orphan scene tags that match no live card.
     */
    _syncLibraryStampsAfterStructureChange(beforeCodes) {
        const db = this._db();
        let touched = 0;
        for (const card of db.cards || []) {
            if (this._isFolder(card, db)) continue;
            const stamp = normalizeSourceStamp(card.sourceStamp);
            if (!stamp) continue;
            const oldCode = beforeCodes?.get(card.uid) || '';
            const newCode = sceneCode(card, db);
            if (!newCode || !oldCode || oldCode === newCode) continue;
            const { leafKeys, bookNames } = this._stampTargetsForCard(card);
            if (!leafKeys.length && !bookNames.length) continue;
            touched += unstampSceneCodes(this.storage, {
                leafKeys, bookNames, codes: [oldCode],
            });
            touched += stampSceneCodes(this.storage, {
                leafKeys, bookNames, codes: [newCode],
            });
        }
        const live = [...this._sceneCodeSnapshot(db).values()];
        touched += reconcileSceneStamps(this.storage, live);
        if (touched) this._refreshLibraryAfterStamp();
        return touched;
    }

    /**
     * Rebuild Library scene tags from live Script cards’ sourceStamp.
     * Drops leftovers that no card claims (manual cleanup / catch-up).
     */
    _refreshLibraryStamps() {
        const db = this._db();
        const claims = [];
        for (const card of db.cards || []) {
            if (this._isFolder(card, db)) continue;
            const stamp = normalizeSourceStamp(card.sourceStamp);
            if (!stamp) continue;
            const code = sceneCode(card, db);
            if (!code) continue;
            const { leafKeys, bookNames } = this._stampTargetsForCard(card);
            if (!leafKeys.length && !bookNames.length) continue;
            claims.push({ leafKeys, bookNames, codes: [code] });
        }
        const n = syncSceneStamps(this.storage, claims);
        if (n) this._refreshLibraryAfterStamp();
        else this.bus?.emit('showtime.stateChanged');
        log('Library stamps refreshed:', n, 'list(s),', claims.length, 'claim(s)');
        return n;
    }

    _deleteCard(uid, { syncStamps = true, beforeCodes = null } = {}) {
        const db  = this._db();
        const idx = db.cards.findIndex(c => c.uid === uid);
        if (idx < 0) return;
        const codes = beforeCodes || (syncStamps ? this._sceneCodeSnapshot(db) : null);
        const deleted = db.cards[idx];
        const deletedCode = codes?.get(uid) || sceneCode(deleted, db);
        this._unstampCard(deleted, deletedCode);
        db.cards
            .filter(c => c.parentUid === uid)
            .forEach(c => { c.parentUid = deleted.parentUid; });
        db.cards.splice(idx, 1);
        this._save(db);
        if (syncStamps) this._syncLibraryStampsAfterStructureChange(codes);
        log('Card deleted:', uid);
    }

    /** Scene codes already on books / leaves (Library tags + card ⌘ source stamps).
     *
     * Leaf lookup must ignore *inherited* book tags. Stamping a few entries also
     * writes scene codes onto the lorebook, and `listLibraryLeaves` merges those
     * onto every row — counting them here made the Agent treat the whole book as
     * already submitted. */
    _agentStampIndex() {
        const byBook = new Map();
        const byKey = new Map();
        const add = (map, id, code) => {
            if (!id) return;
            if (!map.has(id)) map.set(id, new Set());
            const v = String(code || '').trim();
            if (v) map.get(id).add(v);
        };
        for (const book of this._wiBooks) {
            for (const code of bookSceneCodes(this.storage, book.name)) add(byBook, book.name, code);
        }
        for (const leaf of listLibraryLeaves(this.storage, this._wiBooks)) {
            const ownTags = (leaf.tags || []).filter(t => !t?.inherited);
            for (const code of sceneCodesFromTags(ownTags)) {
                add(byKey, leaf.key, code);
            }
        }
        const db = this._db();
        for (const card of db.cards || []) {
            const stamp = normalizeSourceStamp(card.sourceStamp);
            if (!stamp) continue;
            const code = sceneCode(card, db);
            for (const e of stamp.entries) {
                if (e.book) add(byBook, e.book, code);
                if (e.key) add(byKey, e.key, code);
            }
        }
        const list = map => id => [...(map.get(id) || [])];
        return { bookCodes: list(byBook), leafCodes: list(byKey) };
    }

    async _ensureBookLoaded(name) {
        if (!name || this._wiBooks.some(b => b.name === name)) return;
        try {
            const wi = await loadWorldInfo(name);
            if (!wi) return;
            const raw = wi.entries ?? {};
            this._wiBooks.push({
                uid: wi.file_name || name,
                name,
                entries: Array.isArray(raw) ? raw : Object.values(raw),
            });
        } catch (e) {
            log('_ensureBookLoaded failed:', e.message);
        }
    }

    // ── Card CRUD ───────────────────────────────────────────────

    _addCard(overrides = {}) {
        const db   = this._db();
        const card = this._normalizeCard(makeCard(overrides), this._castMembers());
        db.cards.push(card);
        this._save(db);
        log('Card added:', card.uid, card.title);
        return card;
    }

    _updateCard(uid, changes = {}) {
        const db  = this._db();
        const idx = db.cards.findIndex(c => c.uid === uid);
        if (idx < 0) { log('updateCard: uid not found:', uid); return null; }
        const members = this._castMembers();
        db.cards[idx] = this._normalizeCard(
            { ...db.cards[idx], ...changes, uid, updatedAt: now() },
            members,
        );
        this._save(db);
        return db.cards[idx];
    }

    _getCard(uid) {
        return this._db().cards.find(c => c.uid === uid) ?? null;
    }

    _togglePinned(card) {
        const db = this._db();
        const c = db.cards.find(x => x.uid === card.uid);
        if (!c || this._isFolder(c, db)) return;
        c.pinned = !c.pinned;
        c.updatedAt = now();
        this._save(db);
        this._rerender();
    }

    /** Lock only applies to cards with a real parsed time — it means "always show
     * at that true time, never draggable". Cards with no parseable time have
     * nothing to lock to and live in the Undated dock instead. */
    _toggleTimelineLock(card) {
        const db = this._db();
        const c = db.cards.find(x => x.uid === card.uid);
        if (!c || this._isFolder(c, db) || isEventCard(c)) return;
        if (!c.timeLocked && !this._parseCardTime(c)) return;
        c.timeLocked = !c.timeLocked;
        if (c.timeLocked) {
            c.timeManual = false;
            c.timeManualSort = null;
        }
        c.updatedAt = now();
        this._save(db);
        this._rerender();
    }

    _pinButtonHTML(card, { tree = false } = {}) {
        const on = !!card.pinned;
        const cls = tree
            ? `stm-ti-pin${on ? ' stm-ti-pin--on' : ''}`
            : `stm-btn stm-btn-pin${on ? ' stm-btn-pin--on' : ''}`;
        return `<button type="button" class="${cls}" title="${on ? 'Unpin from injection' : 'Pin for injection'}" aria-pressed="${on}">📌</button>`;
    }

    _timelineLockButtonHTML(card, hasTime = true) {
        if (isEventCard(card)) return '';
        const on = !!card.timeLocked;
        if (!on && !hasTime) return ''; // nothing to lock to — card has no real date yet
        return `<button type="button" class="stm-btn stm-tl-lock${on ? ' stm-tl-lock--on' : ''}" title="${on ? 'Unlock — allow dragging' : 'Lock to its true time'}" aria-pressed="${on}">🔒</button>`;
    }

    _isFolder(card, db = this._db()) {
        if (!card) return false;
        if (card.kind === 'folder') return true;
        if (card.kind === 'card' || card.kind === 'event' || isEventCard(card)) return false;
        const levels = db.settings.levels;
        const idx = levels.findIndex(l => l.id === card.levelId);
        return idx >= 0 && idx < levels.length - 1;
    }

    _treeIcon(card, db, hasChildren) {
        if (isEventCard(card)) return card.eventScale === 'personal' ? '◆' : '✦';
        const levels = db.settings.levels || [];
        const icon = levels.find(l => l.id === card.levelId)?.icon;
        if (icon) return icon;
        if (this._isFolder(card, db) || (hasChildren && card.kind !== 'card' && card.kind !== 'event')) return '📁';
        return '📄';
    }

    _folderLevelId(db = this._db()) {
        return folderLevelId(db);
    }

    _cardLevelId(db = this._db()) {
        return cardLevelId(db);
    }

    _rootLevelId(db = this._db()) {
        return rootLevelId(db);
    }

    _nextLevelId(parent, { forFolder = false } = {}) {
        return nextLevelId(parent, this._db(), { forFolder });
    }

    /**
     * Parent folder for "＋ Folder". When a deep card/folder is focused,
     * nesting under it often hits max depth and disabled the button — walk
     * up (and treat a focused folder as a sibling context) so create still works.
     */
    _resolveFolderCreateParent() {
        const sel = this._selectedUid ? this._getCard(this._selectedUid) : null;
        if (!sel) return null;
        let candidate = null;
        if (this._isFolder(sel)) {
            const focusedAsPage = this._focusedUid === sel.uid || this._editingCardUid === sel.uid;
            candidate = focusedAsPage
                ? (sel.parentUid ? this._getCard(sel.parentUid) : null)
                : sel;
        } else {
            candidate = sel.parentUid ? this._getCard(sel.parentUid) : null;
        }
        while (candidate && !this._nextLevelId(candidate, { forFolder: true })) {
            candidate = candidate.parentUid ? this._getCard(candidate.parentUid) : null;
        }
        if (candidate && this._nextLevelId(candidate, { forFolder: true })) return candidate;
        return null; // shelf root
    }

    _orgScheme() {
        return orgSchemeOf(this._db());
    }

    _orgCode(card) {
        return sceneCode(card, this._db());
    }

    /** Assign levelId/kind for a move under destParentUid. Returns false if illegal. */
    _applyLevelForParent(card, destParentUid) {
        const db = this._db();
        const parent = destParentUid ? this._getCard(destParentUid) : null;
        if (destParentUid && !parent) return false;
        const forFolder = this._isFolder(card, db) || card.kind === 'folder';
        if (forFolder) {
            if (parent && !this._isFolder(parent, db)) return false;
            const lid = this._nextLevelId(parent, { forFolder: true });
            if (!lid) return false;
            card.levelId = lid;
            card.kind = 'folder';
        } else {
            if (parent && !this._isFolder(parent, db)) return false;
            // Leaf cards nest under any folder (prefer deep); level is always leaf.
            card.levelId = this._cardLevelId(db);
            if (!isEventCard(card)) card.kind = 'card';
            else card.kind = 'event';
            if (parent) {
                const levels = db.settings.levels || [];
                const pli = levels.findIndex(l => l.id === parent.levelId);
                // Parent must be a folder level (not leaf).
                if (pli < 0 || pli >= levels.length - 1) return false;
            }
        }
        card.parentUid = destParentUid || null;
        return true;
    }

    _normalizeShelfLevels() {
        const db = this._db();
        const n = normalizeShelfLevels(db);
        if (n) this._save(db);
        return n;
    }

    _cardPath(card) {
        const parts = [];
        let cur = card;
        const seen = new Set();
        while (cur && !seen.has(cur.uid)) {
            parts.unshift(cur.title || '(untitled)');
            seen.add(cur.uid);
            cur = cur.parentUid ? this._getCard(cur.parentUid) : null;
        }
        return parts.join(' / ');
    }

    _shelfIndexText() {
        const db = this._db();
        const lines = [];
        const walk = (nodes, prefix) => {
            for (const n of nodes) {
                const path = prefix ? `${prefix} / ${n.card.title || '(untitled)'}` : (n.card.title || '(untitled)');
                const kind = this._isFolder(n.card, db) ? 'FOLDER' : 'CARD';
                const keys = flattenFacets(n.card.keywordFacets).slice(0, 6).join(', ');
                lines.push(`- [${kind}] ${path}${keys ? `  {${keys}}` : ''}`);
                if (n.children?.length) walk(n.children, this._isFolder(n.card, db) ? path : prefix);
            }
        };
        walk(this._buildTree(db.cards), '');
        return lines.join('\n') || '- (empty shelf — use "" Path for root)';
    }

    _ensureFolderPath(pathStr) {
        const raw = String(pathStr || '').trim();
        if (!raw) {
            const sel = this._selectedUid ? this._getCard(this._selectedUid) : null;
            if (sel && this._isFolder(sel)) return sel.uid;
            return sel?.parentUid || null;
        }
        const parts = raw.split(/[\\/|>]+/).map(s => s.trim()).filter(Boolean);
        let parentUid = null;
        for (const part of parts) {
            const db = this._db();
            const sibs = db.cards.filter(c => (c.parentUid || null) === parentUid);
            let folder = sibs.find(c => this._isFolder(c, db) && (c.title || '').toLowerCase() === part.toLowerCase());
            if (!folder) {
                folder = sibs.find(c => (c.title || '').toLowerCase() === part.toLowerCase());
                if (folder && !this._isFolder(folder, db)) {
                    parentUid = folder.parentUid || parentUid;
                    break;
                }
            }
            if (!folder) {
                const parent = parentUid ? this._getCard(parentUid) : null;
                const lid = this._nextLevelId(parent, { forFolder: true });
                if (!lid) break;
                folder = this._addCard({
                    kind: 'folder',
                    levelId: lid,
                    title: part,
                    parentUid,
                });
            }
            parentUid = folder.uid;
            this._expandedUids.add(folder.uid);
        }
        return parentUid;
    }

    _castPromptBlock() {
        const members = this._actingCast();
        if (!members.length) return '(no cast list)';
        const star = getStarMember(this.storage);
        const lines = members.map(m => {
            const aliases = [...(m.aliases || [])].map(a => String(a).trim()).filter(Boolean);
            const aliasBit = aliases.length ? `; also: ${aliases.join(', ')}` : '';
            return `- ${m.name} (${priorityLabel(m.priority) || m.priority || 'supporting'}${aliasBit})`;
        });
        const starNote = star
            ? `\nStar = ${star.name} only. Do not add a second credit for {{user}} / You / a persona name.`
            : '';
        return `${lines.join('\n')}${starNote}`;
    }

    _visibleTreeUids() {
        return this._db().cards.filter(c => this._cardMatchesFilter(c)).map(c => c.uid);
    }

    _toggleSelectAll() {
        const ids = this._visibleTreeUids();
        const allOn = ids.length && ids.every(id => this._checkedUids.has(id));
        if (allOn) ids.forEach(id => this._checkedUids.delete(id));
        else ids.forEach(id => this._checkedUids.add(id));
        this._rerender();
    }

    _selectAllLabel() {
        const ids = this._visibleTreeUids();
        const allOn = ids.length && ids.every(id => this._checkedUids.has(id));
        return allOn ? 'Deselect all' : 'Select all';
    }

    _truncateToTokenBudget(text, maxTokens) {
        const max = Math.max(0, Number(maxTokens) || 0);
        if (!max) return text;
        const cap = max * 4;
        const s = String(text ?? '');
        if (s.length <= cap) return s;
        return s.slice(0, cap) + '\n\n[…truncated to token budget…]';
    }

    async _withTemperature(temp, fn) {
        if (temp == null || temp === '') return fn();
        const t = Number(temp);
        if (!Number.isFinite(t)) return fn();
        const oaiPrev = oai_settings?.temp_openai;
        const tgPrev = textgenerationwebui_settings?.temp;
        const restore = () => {
            if (oai_settings && oaiPrev !== undefined) oai_settings.temp_openai = oaiPrev;
            if (textgenerationwebui_settings && tgPrev !== undefined) textgenerationwebui_settings.temp = tgPrev;
        };
        // A normal (non-quiet) generation started meanwhile — give it the user's temperature back.
        const onUserGeneration = (type, _opts, dryRun) => {
            if (!dryRun && type !== 'quiet') restore();
        };
        try {
            if (oai_settings) oai_settings.temp_openai = t;
            if (textgenerationwebui_settings) textgenerationwebui_settings.temp = t;
            eventSource.on(event_types.GENERATION_STARTED, onUserGeneration);
            return await fn();
        } finally {
            eventSource.removeListener?.(event_types.GENERATION_STARTED, onUserGeneration);
            restore();
        }
    }

    async _quietPrompt(userPrompt, { jsonSchema = AGENT_CARDS_SCHEMA, systemPrompt = AGENT_SYSTEM_PROMPT } = {}) {
        const db = this._db();
        const maxOut = Math.max(0, Number(db.settings.aiMaxOutputTokens) || 0);
        const maxIn  = Math.max(0, Number(db.settings.aiMaxInputTokens) || 0);
        const trimmed = this._truncateToTokenBudget(userPrompt, maxIn);
        const temp = db.settings.aiTemperature;
        try {
            const out = await this._withProfile(db.settings.aiProfile, () =>
                this._withTemperature(temp, () =>
                    pinnedGenerateRaw({
                        prompt: trimmed,
                        systemPrompt,
                        responseLength: maxOut > 0 ? maxOut : FILING_RESPONSE_LENGTH,
                        jsonSchema,
                    }),
                ),
            );
            // Chat-switch guard: agent passes write cards into the active chat.
            if (this._agentChatToken && (getContext()?.chatMetadata ?? null) !== this._agentChatToken) {
                this._agentCancelled = true;
                throw new Error('Cancelled.');
            }
            return out;
        } catch (err) {
            if (this._agentCancelled || String(err?.message || err).toLowerCase().includes('abort') || String(err?.message || err).toLowerCase().includes('cancel')) {
                throw new Error('Cancelled.');
            }
            throw err;
        }
    }

    _cancelAgent() {
        this._agentCancelled = true;
        try { stopGeneration(); } catch (_) { /* ST may not be generating */ }
    }

    _viewSiblings(parentUid = this._selectedUid) {
        const db = this._db();
        const key = parentUid || null;
        return db.cards.filter(c => (c.parentUid || null) === key);
    }

    _sortSiblings(parentUid, mode, { persist = true } = {}) {
        const db = this._db();
        const key = parentUid || null;
        const sibs = db.cards.filter(c => (c.parentUid || null) === key);
        if (!sibs.length) return;
        const folderRank = c => this._isFolder(c, db) ? 0 : 1;
        const byName = (a, b) => (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base' });
        const facetKey = (c, id) => {
            if (id === 'characters') {
                const name = (c.credits || []).find(cr => (cr.name || '').trim())?.name || '';
                return name.toLowerCase();
            }
            return (c.keywordFacets?.[id]?.[0] || '').toLowerCase();
        };
        sibs.sort((a, b) => {
            if (mode === 'folders') {
                const d = folderRank(a) - folderRank(b);
                return d || byName(a, b);
            }
            if (mode === 'name-asc') return byName(a, b);
            if (mode === 'name-desc') return byName(b, a);
            if (mode === 'new') return (b.createdAt || 0) - (a.createdAt || 0);
            if (mode === 'old') return (a.createdAt || 0) - (b.createdAt || 0);
            if (mode === 'location' || mode === 'datetime' || mode === 'characters' || mode === 'objects') {
                const d = folderRank(a) - folderRank(b);
                if (d) return d;
                const ka = facetKey(a, mode);
                const kb = facetKey(b, mode);
                if (ka && kb) return ka.localeCompare(kb) || byName(a, b);
                if (ka) return -1;
                if (kb) return 1;
                return byName(a, b);
            }
            return (a.sortIndex ?? 0) - (b.sortIndex ?? 0);
        });
        sibs.forEach((c, i) => { c.sortIndex = i; c.updatedAt = now(); });
        if (persist) this._save(db);
    }

    _sortVisible(mode) {
        const db = this._db();
        const selected = this._selectedUid ? this._getCard(this._selectedUid) : null;
        const parents = !this._selectedUid
            ? [...new Set(db.cards.map(c => c.parentUid || null))]
            : [this._isFolder(selected, db) ? this._selectedUid : (selected?.parentUid || null)];
        parents.forEach(p => this._sortSiblings(p, mode, { persist: false }));
        this._save(db);
    }

    _clusterByFacet(facetId) {
        const db = this._db();
        const selected = this._selectedUid ? this._getCard(this._selectedUid) : null;
        const parentUid = (!this._selectedUid || this._isFolder(selected, db))
            ? (this._selectedUid || null)
            : (selected?.parentUid || null);
        const sibs = db.cards.filter(c => (c.parentUid || null) === parentUid && !this._isFolder(c, db));
        const buckets = new Map();
        for (const c of sibs) {
            let key = '(unfiled)';
            if (facetId === 'characters') {
                key = (c.credits || []).find(cr => (cr.name || '').trim())?.name?.trim() || '(unfiled)';
            } else {
                key = (c.keywordFacets?.[facetId]?.[0] || '').trim() || '(unfiled)';
            }
            if (!buckets.has(key)) buckets.set(key, []);
            buckets.get(key).push(c);
        }
        if (buckets.size < 2) return 0;
        let n = 0;
        for (const [label, cards] of buckets) {
            if (label === '(unfiled)') continue;
            let folder = db.cards.find(c =>
                (c.parentUid || null) === parentUid
                && this._isFolder(c, db)
                && (c.title || '').toLowerCase() === label.toLowerCase(),
            );
            if (!folder) {
                const parent = parentUid ? this._getCard(parentUid) : null;
                const lid = this._nextLevelId(parent, { forFolder: true });
                if (!lid) continue;
                folder = this._addCard({
                    kind: 'folder',
                    levelId: lid,
                    title: label,
                    parentUid,
                    keywordFacets: { ...emptyFacets(), [facetId]: [label] },
                });
            }
            n += this._bulkMove(cards.map(c => c.uid), folder.uid);
            this._expandedUids.add(folder.uid);
        }
        return n;
    }

    _facetHaystack(card, facetId) {
        if (facetId === 'characters') {
            return [
                ...(card.credits || []).map(cr => cr.name).filter(Boolean),
                card.title || '',
            ];
        }
        if (facetId && card.keywordFacets?.[facetId]) {
            return [...(card.keywordFacets[facetId] || []), card.title || ''];
        }
        return [
            ...(card.keywords || []),
            ...KEYWORD_EDIT_FACETS.flatMap(f => card.keywordFacets?.[f.id] || []),
            ...(card.credits || []).map(cr => cr.name).filter(Boolean),
            card.title || '',
        ];
    }

    _cardMatchesFilter(card) {
        const f = this._keywordFilter;
        if (!f?.value) return true;
        const needle = f.value.toLowerCase();
        const hit = hay => hay.some(h => {
            const s = String(h).toLowerCase();
            return s === needle || s.includes(needle);
        });
        if (hit(this._facetHaystack(card, f.facet))) return true;
        if (this._isFolder(card)) {
            return this._db().cards.some(c =>
                !this._isFolder(c)
                && (c.parentUid === card.uid || this._isDescendant(card.uid, c.uid))
                && hit(this._facetHaystack(c, f.facet)),
            );
        }
        return false;
    }

    _bulkMove(uids, destUid) {
        const db = this._db();
        const dest = destUid ? db.cards.find(c => c.uid === destUid) : null;
        if (destUid && !dest) return 0;
        let n = 0;
        for (const uid of uids) {
            if (uid === destUid) continue;
            if (destUid && this._isDescendant(uid, destUid)) continue;
            const card = db.cards.find(c => c.uid === uid);
            if (!card) continue;
            if (!this._applyLevelForParent(card, destUid || null)) continue;
            const sibs = db.cards.filter(c => (c.parentUid || null) === (card.parentUid || null) && c.uid !== uid);
            card.sortIndex = sibs.reduce((m, c) => Math.max(m, c.sortIndex ?? 0), -1) + 1;
            card.updatedAt = now();
            n++;
        }
        this._save(db);
        return n;
    }

    _bulkDelete(uids) {
        const ordered = [...uids].sort((a, b) => {
            if (this._isDescendant(a, b)) return -1;
            if (this._isDescendant(b, a)) return 1;
            return 0;
        });
        const beforeCodes = this._sceneCodeSnapshot();
        for (const uid of ordered) {
            this._deleteCard(uid, { syncStamps: false, beforeCodes });
            this._checkedUids.delete(uid);
            if (this._selectedUid === uid) this._selectedUid = null;
            if (this._focusedUid === uid) this._focusedUid = null;
            if (this._editingCardUid === uid) this._editingCardUid = null;
        }
        this._syncLibraryStampsAfterStructureChange(beforeCodes);
    }

    // ── Sort helpers (consumed by views in Phase 3) ─────────────

    _treeSort(cards) {
        const levels   = this._db().settings.levels;
        const levelIdx = Object.fromEntries(levels.map((l, i) => [l.id, i]));
        return [...cards].sort((a, b) => {
            const si = (a.sortIndex ?? 0) - (b.sortIndex ?? 0);
            if (si) return si;
            const ai = levelIdx[a.levelId] ?? 999;
            const bi = levelIdx[b.levelId] ?? 999;
            return ai !== bi ? ai - bi : a.createdAt - b.createdAt;
        });
    }

    _timelineSort(cards) {
        const cohort = cards;
        const domain = this._timelineDomain(cohort);
        const rankOf = c => {
            const p = this._timelinePlace(c, cohort, domain);
            return p.dock ? Infinity : p.sort;
        };
        return [...cards].sort((a, b) => {
            const ra = rankOf(a) - rankOf(b);
            if (ra) return ra;
            return (a.createdAt || 0) - (b.createdAt || 0);
        });
    }

    _cardTimeKey(card) {
        return String(card.span || card.timeKey || card.keywordFacets?.datetime?.[0] || '').trim();
    }

    _cal() {
        const db = this._db();
        db.settings.calendar = normalizeCalendar(db.settings.calendar);
        if (typeof db.settings.tlHintDismissed !== 'boolean') db.settings.tlHintDismissed = false;
        return db.settings.calendar;
    }

    _calendarTimePlaceholder() {
        const cal = this._cal();
        const season = cal.seasons[0]?.label || cal.labels.season;
        const month = cal.monthNames[0] || cal.labels.month;
        return `${cal.labels.day} 3–5, ${season}, ${month}, ${formatCalendarYear(12, cal)}…`;
    }

    _calendarTimeHintsHTML(card) {
        const cal = this._cal();
        const hit = pickParseableTimeKey({
            span: card.span,
            timeKey: card.timeKey,
            keywordFacets: card.keywordFacets,
        }, cal);
        return hit
            ? `<span class="stm-cal-hint-ok">Places on timeline · ${esc(hit.key)} (${esc(hit.parsed.scale)}${hit.range ? ' range' : ''})</span>`
            : `<span class="stm-cal-hint-miss">No parseable placement yet — open Set Time or type a span.</span>`;
    }

    _setTimeDetailsHTML(card, { open = false } = {}) {
        return `<details class="stm-set-time"${open ? ' open' : ''}>
            <summary>Set Time</summary>
            <div class="stm-set-time-body">
              ${this._calendarPickerHTML({
                  inputName: 'span',
                  scaleFilter: false,
                  spanParts: card.spanParts,
              })}
            </div>
          </details>`;
    }

    _bindCalendarTimeHints(formEl) {
        this._bindCalendarPicker(formEl, {
            onPick: (key) => {
                const input = formEl.querySelector('[name="span"]');
                if (input) input.value = key;
                const wrap = formEl.querySelector('.stm-kw-editor .stm-pills');
                if (wrap) {
                    wrap.querySelector('.stm-settings-hint')?.remove();
                    const exists = [...wrap.querySelectorAll('.stm-pill-edit')].some(p =>
                        p.dataset.facet === 'datetime' && String(p.dataset.value || '').toLowerCase() === key.toLowerCase());
                    if (!exists) wrap.insertAdjacentHTML('beforeend', this._keywordEditChipHTML('datetime', key));
                }
                const hint = formEl.querySelector('.stm-cal-hint-ok, .stm-cal-hint-miss');
                if (hint) {
                    const range = parseTimeRange(key, this._cal());
                    if (range) {
                        hint.className = 'stm-cal-hint-ok';
                        hint.textContent = `Places on timeline · ${key} (${range.scale}${range.point ? '' : ' range'})`;
                    }
                }
            },
        });
    }

    /** Scale + part checkboxes (uncheck Year/Month etc. for fuzzy placement). */
    _calendarPickerHTML({ inputName = 'span', idPrefix = 'stm-tp', scaleFilter = false, spanParts = null } = {}) {
        const cal = this._cal();
        const parts = {
            year: false, season: false, month: false, week: false,
            day: true, hour: false, phase: false,
            ...(spanParts && typeof spanParts === 'object' ? spanParts : {}),
        };
        // If nothing saved yet, default to Day only.
        if (!spanParts) {
            parts.day = true;
        }
        const scaleOpts = TIME_PICKER_SCALES.map(s => {
            const label = s.id === 'free' ? 'Free text / ISO' : (cal.labels[s.labelKey] || s.id);
            return `<option value="${esc(s.id)}">${esc(label)}</option>`;
        }).join('');
        const seasonOpts = cal.seasons.map(s =>
            `<option value="${esc(s.id)}">${esc(s.label)}</option>`).join('');
        const monthOpts = cal.monthNames.map((n, i) =>
            `<option value="${i}">${esc(n)}</option>`).join('');
        const defaultYear = (() => {
            try {
                const y = Number(this._timelineAnchorParts()?.year);
                if (Number.isFinite(y) && y > 0) return y;
            } catch { /* ignore */ }
            if (this._lockPresentYear()) return '';
            return new Date().getFullYear();
        })();
        const vis = (id, label) => `
            <label class="stm-tp-vis-lab" title="Show ${esc(label)} (uncheck if vague)">
              <input type="checkbox" class="stm-tp-vis" data-part="${id}" ${parts[id] ? 'checked' : ''}>
              ${esc(label)}
            </label>`;
        return `
          <div class="stm-cal-picker" data-tp-prefix="${esc(idPrefix)}" data-tp-input="${esc(inputName)}">
            ${scaleFilter ? `
            <div class="stm-cal-picker-row">
              <label>Scale filter</label>
              <select class="stm-tp-filter">
                <option value="">All scales</option>
                ${TIME_PICKER_SCALES.filter(s => s.id !== 'free').map(s =>
                    `<option value="${esc(s.id)}">${esc(cal.labels[s.labelKey] || s.id)}</option>`).join('')}
              </select>
            </div>` : ''}
            <div class="stm-cal-picker-row">
              <label>Preset</label>
              <select class="stm-tp-scale">${scaleOpts}</select>
              <span class="stm-hint">sets which fields are on — tweak below for fuzzy (vague year/month…)</span>
            </div>
            <div class="stm-cal-picker-row stm-tp-vis-row">
              <span class="stm-tp-vis-h">Show</span>
              ${vis('phase', 'Phase')}
              ${vis('year', cal.labels.year)}
              ${vis('season', cal.labels.season)}
              ${vis('month', cal.labels.month)}
              ${vis('week', cal.labels.week)}
              ${vis('day', cal.labels.day)}
              ${vis('hour', cal.labels.hour)}
            </div>
            <div class="stm-cal-picker-cascade">
              <label class="stm-tp-field" data-for="phase" ${parts.phase ? '' : 'hidden'}>
                <span>Phase</span>
                <select class="stm-tp-phase">
                  <option value="">—</option>
                  <option value="early">Early</option>
                  <option value="mid">Mid</option>
                  <option value="late">Late</option>
                </select>
              </label>
              <label class="stm-tp-field" data-for="year" ${parts.year ? '' : 'hidden'}>
                <span>${esc(cal.labels.year)}</span>
                <input type="number" class="stm-tp-year" min="0" max="999999" value="${defaultYear}">
              </label>
              <label class="stm-tp-field" data-for="season" ${parts.season ? '' : 'hidden'}>
                <span>${esc(cal.labels.season)}</span>
                <select class="stm-tp-season">${seasonOpts}</select>
              </label>
              <label class="stm-tp-field" data-for="month" ${parts.month ? '' : 'hidden'}>
                <span>${esc(cal.labels.month)}</span>
                <select class="stm-tp-month">${monthOpts}</select>
              </label>
              <label class="stm-tp-field" data-for="week" ${parts.week ? '' : 'hidden'}>
                <span>${esc(cal.labels.week)}</span>
                <input type="number" class="stm-tp-week" min="1" max="999" value="1">
              </label>
              <label class="stm-tp-field" data-for="day" ${parts.day ? '' : 'hidden'}>
                <span>${esc(cal.labels.day)}</span>
                <input type="number" class="stm-tp-day" min="1" max="30" value="1">
              </label>
              <label class="stm-tp-field" data-for="hour" ${parts.hour ? '' : 'hidden'}>
                <span>${esc(cal.labels.hour)}</span>
                <input type="number" class="stm-tp-hour" min="0" max="${cal.hoursPerDay - 1}" value="0">
              </label>
            </div>
            <div class="stm-cal-picker-row stm-cal-picker-actions">
              <code class="stm-tp-preview"></code>
              <button type="button" class="stm-btn stm-tp-apply">Use this time</button>
            </div>
          </div>`;
    }

    _bindCalendarPicker(root, { onPick } = {}) {
        const host = root?.classList?.contains('stm-cal-picker')
            ? root
            : root?.querySelector?.('.stm-cal-picker');
        if (!host || host.dataset.tpBound) return;
        host.dataset.tpBound = '1';
        const cal = this._cal();
        const scaleEl = host.querySelector('.stm-tp-scale');
        const preview = host.querySelector('.stm-tp-preview');
        const filterEl = host.querySelector('.stm-tp-filter');
        const scope = root.closest?.('.stm-dialog, .stm-page-form, .stm-dialog-body') || root;

        const partOn = (id) => !!host.querySelector(`.stm-tp-vis[data-part="${id}"]`)?.checked;

        const applyPreset = (scale) => {
            const map = {
                free: {},
                year: { year: true },
                season: { phase: true, season: true },
                month: { phase: true, month: true },
                week: { week: true },
                day: { day: true },
                hour: { hour: true },
            };
            const want = map[scale] || { day: true };
            host.querySelectorAll('.stm-tp-vis').forEach(cb => {
                cb.checked = !!want[cb.dataset.part];
            });
        };

        const syncFields = () => {
            host.querySelectorAll('.stm-tp-field').forEach(f => {
                const need = f.dataset.for;
                f.hidden = !partOn(need);
            });
            updatePreview();
        };

        const readParts = () => {
            const scale = scaleEl?.value || 'day';
            if (scale === 'free') return null;
            const parts = { scale };
            if (partOn('year')) parts.year = Number(host.querySelector('.stm-tp-year')?.value) || null;
            if (partOn('season')) parts.seasonId = host.querySelector('.stm-tp-season')?.value || null;
            if (partOn('month')) {
                const v = host.querySelector('.stm-tp-month')?.value;
                parts.monthIndex = v !== '' && v != null ? Number(v) : null;
            }
            if (partOn('week')) parts.week = Number(host.querySelector('.stm-tp-week')?.value) || null;
            if (partOn('day')) parts.day = Number(host.querySelector('.stm-tp-day')?.value) || null;
            if (partOn('hour')) parts.hour = Number(host.querySelector('.stm-tp-hour')?.value) || 0;
            if (partOn('phase')) parts.seasonPhase = host.querySelector('.stm-tp-phase')?.value || null;
            // Infer scale from finest enabled part for formatting
            if (partOn('hour')) parts.scale = 'hour';
            else if (partOn('day') && !partOn('month') && !partOn('season') && !partOn('year')) parts.scale = 'day';
            else if (partOn('week') && !partOn('month')) parts.scale = 'week';
            else if (partOn('season')) parts.scale = 'season';
            else if (partOn('month')) parts.scale = 'month';
            else if (partOn('year')) parts.scale = 'year';
            return parts;
        };

        const updatePreview = () => {
            const parts = readParts();
            let key = '';
            if (parts) key = formatTimeKey(parts, cal);
            if (preview) preview.textContent = key || '—';
            return key;
        };

        scaleEl?.addEventListener('change', () => {
            applyPreset(scaleEl.value);
            syncFields();
        });
        host.querySelectorAll('.stm-tp-vis').forEach(cb => {
            cb.addEventListener('change', syncFields);
        });
        host.querySelectorAll('.stm-tp-field input, .stm-tp-field select').forEach(el => {
            el.addEventListener('input', updatePreview);
            el.addEventListener('change', updatePreview);
        });
        filterEl?.addEventListener('change', () => {
            const scale = filterEl.value;
            scope.querySelectorAll?.('.stm-pill-edit[data-facet="datetime"]').forEach(pill => {
                const v = pill.dataset.value || '';
                const parsed = parseTimeKey(v, cal);
                const show = !scale || (parsed && (
                    parsed.scale === scale
                    || (scale === 'month' && parsed.scale === 'date')
                    || (scale === 'season' && parsed.scale === 'date')
                ));
                pill.hidden = !show;
            });
        });
        host.querySelector('.stm-tp-apply')?.addEventListener('click', e => {
            e.preventDefault();
            e.stopPropagation();
            const key = updatePreview();
            if (!key) return;
            const inputName = host.dataset.tpInput || 'span';
            const input = scope.querySelector(`[name="${inputName}"], #${CSS.escape(inputName)}`);
            if (input) input.value = key;
            onPick?.(key);
        });
        syncFields();
    }

    _lockPresentYear(db = this._db()) {
        return db.settings.lockPresentYear !== false;
    }

    _tlRange(db = this._db()) {
        const r = db.settings.tlRange && typeof db.settings.tlRange === 'object' ? db.settings.tlRange : {};
        return {
            startYear: Number.isFinite(Number(r.startYear)) ? Number(r.startYear) : null,
            startSeason: String(r.startSeason || ''),
            endMode: r.endMode === 'beyond' ? 'beyond' : 'present',
            endYear: Number.isFinite(Number(r.endYear)) ? Number(r.endYear) : null,
        };
    }

    _parseCardTime(card, opts = {}) {
        const anchorParts = opts.anchorParts !== undefined
            ? opts.anchorParts
            : this._timelineAnchorParts();
        return pickParseableTimeKey(card, this._cal(), {
            anchorParts,
            ...(opts.fillMissing === false ? { fillMissing: false } : {}),
        });
    }

    /**
     * Year/season/month the timeline is "about": explicit present, else the
     * gold present marker, else the viewport center, else the wall clock.
     * Yearless / seasonless spans inherit this so Audit and live placement
     * group them in the present's span instead of dumping them unsorted.
     */
    _timelineAnchorParts() {
        const cal = this._cal();
        let fromPresent = null;
        try {
            const present = getTimelinePresent(this._db(), {
                selectedUid: this._selectedUid,
                focusedUid: this._focusedUid,
            });
            if (present?.parts && typeof present.parts === 'object') fromPresent = present.parts;
        } catch { /* ignore */ }
        if (this._lockPresentYear()) {
            const y = Number(fromPresent?.year);
            return {
                year: Number.isFinite(y) && y > 0 ? y : null,
                monthIndex: fromPresent?.monthIndex ?? null,
                seasonId: fromPresent?.seasonId || null,
                day: fromPresent?.day ?? null,
            };
        }
        let fromView = null;
        try {
            const wrap = this._tlWrap;
            const vp = wrap?.querySelector?.('.stm-tl');
            if (vp && this._tlAnchorSort != null && this._tlPan != null && this._tlPxPerUnit) {
                const size = this._tlMetrics(vp, wrap._tlVert).size;
                const sort = this._tlSortFromScreenPx(size / 2, this._tlZoomValue(), this._tlPan);
                if (Number.isFinite(sort)) {
                    fromView = sort > EARTH_EPOCH / 2
                        ? partsFromEarthMs(sort - EARTH_EPOCH, cal)
                        : partsFromCalendarSort(sort, cal);
                }
            }
        } catch { /* ignore */ }
        const wall = wallClockParts(cal);
        const pick = (key) => {
            const a = fromPresent?.[key];
            const b = fromView?.[key];
            const c = wall[key];
            if (a != null && a !== '') return a;
            if (b != null && b !== '') return b;
            return c;
        };
        return {
            ...wall,
            ...(fromView || {}),
            ...(fromPresent || {}),
            year: pick('year'),
            monthIndex: pick('monthIndex'),
            seasonId: pick('seasonId'),
        };
    }

    /** Present place for trackers / clapper. */
    getTimelinePresent() {
        return getTimelinePresent(this._db(), {
            selectedUid: this._selectedUid,
            focusedUid: this._focusedUid,
        });
    }

    _timelineCards(db = this._db()) {
        return db.cards.filter(c => !this._isFolder(c, db) && this._cardMatchesFilter(c));
    }

    /** Virtual Library event/era pins (not yet promoted to Script cards). */
    _libraryTimelinePins(db = this._db()) {
        const cal = this._cal();
        const claimed = new Set(
            (db.cards || [])
                .filter(c => c.sourceKind === 'library' && c.sourceId)
                .map(c => c.sourceId),
        );
        let leaves = [];
        try {
            const lib = window.Showtime?.modules?.get('library');
            const books = (this._wiBooks?.length ? this._wiBooks : null)
                || (lib?._books?.length ? lib._books : null);
            leaves = listVisibleLibraryLeaves(this.storage, books);
        } catch {
            leaves = [];
        }
        const pins = [];
        for (const leaf of leaves) {
            if (claimed.has(leaf.key)) continue;
            const tags = leaf.tags || [];
            const isEvent = tags.some(t => /^(event|era)$/i.test(String(t.type || '')))
                || /event|era/i.test(String(leaf.sectionTitle || ''));
            if (!isEvent) continue;
            const eraVal = tags.find(t => t.type === 'era')?.value
                || tags.find(t => /^(event|era|date)$/i.test(String(t.type || '')))?.value
                || '';
            const hit = pickParseableTimeKey({
                timeKey: eraVal,
                keywordFacets: { datetime: eraVal ? [eraVal] : [] },
                span: null,
            }, cal);
            if (!hit) continue;
            pins.push({
                uid: `lib:${leaf.key}`,
                virtual: true,
                sourceKind: 'library',
                sourceId: leaf.key,
                title: leaf.title || '(library)',
                summary: String(leaf.content || '').replace(/\s+/g, ' ').slice(0, 200),
                timeKey: hit.key,
                keywordFacets: { datetime: [hit.key] },
                span: null,
                timeLocked: false,
                timeManual: false,
                timeLane: 0,
                book: leaf.book || '',
                leaf,
            });
        }
        return pins.slice(0, 80);
    }

    _timelineCohort(db = this._db()) {
        return [...this._timelineCards(db), ...this._libraryTimelinePins(db)];
    }

    /**
     * Where a card sits on the timeline.
     * - Locked, or unlocked-and-never-dragged: always its TRUE parsed time
     *   (no more "compatible scale" gating — a card with a real date always
     *   renders at that date, on any zoom level, which is what fixed the old
     *   jumpy/odd-marker behavior).
     * - Manually dragged (unlocked): an absolute manual coordinate that
     *   survives pan/zoom, in the same numeraire as `timestamp`.
     * - Nothing usable (no parseable time, never placed): `dock: true` — it
     *   belongs in the Undated dock, not on the ruler.
     */
    _timelinePlace(card, cohort = null, domain = null) {
        const peers = cohort || this._timelineCohort();
        const dom = domain || this._timelineDomain(peers);
        const idx = peers.findIndex(c => c.uid === card.uid);
        let lane = Number(card.timeLane);
        if (!Number.isFinite(lane) || lane === 0) lane = (idx % 2) ? 0.38 : -0.38;

        const hit = this._parseCardTime(card);
        const key = hit?.key || this._cardTimeKey(card);
        if (card.timelineOff) {
            return { sort: null, key, lane, dock: true, undated: !hit };
        }
        const family = hit ? (hit.parsed.scale === 'date' ? 'date' : 'calendar') : null;
        const usableTrue = !!hit && Number.isFinite(hit.parsed.sort) && family === dom.family;

        if (usableTrue && (card.timeLocked || !card.timeManual)) {
            const range = hit.range && !hit.range.point ? hit.range : null;
            return {
                sort: hit.parsed.sort,
                key, lane, dock: false,
                rangeSort: range ? [range.start.sort, range.end.sort] : null,
            };
        }
        if (card.timeManual && Number.isFinite(card.timeManualSort)) {
            return { sort: card.timeManualSort, key, lane, dock: false, manual: true, rangeSort: null };
        }
        if (usableTrue) {
            return { sort: hit.parsed.sort, key, lane, dock: false, rangeSort: null };
        }
        return { sort: null, key, lane, dock: true, undated: !hit };
    }

    /** Real-time span of the cohort, independent of any zoom level. Chooses a
     * single numeraire ('date' Earth-ms epoch, or fictional calendar hours)
     * for the whole ruler — cards in the other family fall back to the dock
     * unless manually placed. */
    _timelineDomain(cards) {
        const cal = this._cal();
        const parsedOf = list => list.filter(c => !c.timelineOff).map(c => {
            const hit = this._parseCardTime(c);
            return hit ? { ...hit.parsed, uid: c.uid } : null;
        }).filter(Boolean);
        const pool = parsedOf(cards || []);
        if (!pool.length) {
            const unit = timelineUnitSort('days', 'day', cal);
            return { min: -unit * 3, max: unit * 3, family: 'calendar', calendarScale: 'day', empty: true };
        }
        const families = new Set(pool.map(p => p.scale === 'date' ? 'date' : 'calendar'));
        // Prefer the 'date' (Earth) family when a script mixes both — the rarer case.
        const family = families.has('date') ? 'date' : 'calendar';
        const usable = pool.filter(p => (p.scale === 'date') === (family === 'date'));
        const calendarScale = family === 'calendar'
            ? ([...new Set(usable.map(p => p.scale))].length === 1 ? usable[0].scale : 'day')
            : null;
        const sorts = usable.map(p => p.sort);
        let min = Math.min(...sorts);
        let max = Math.max(...sorts);
        const unit = timelineUnitSort('days', family === 'date' ? 'date' : (calendarScale || 'day'), cal);
        if (!(max > min)) {
            min -= unit * 3;
            max += unit * 3;
        } else {
            const pad = Math.max(unit, (max - min) * 0.08);
            min -= pad;
            max += pad;
        }
        const range = this._tlRange();
        if (family !== 'date' && (range.startYear != null || range.endMode === 'present' || range.endYear != null)) {
            if (range.startYear != null) {
                const start = calendarSort({
                    year: range.startYear,
                    seasonId: range.startSeason || null,
                    monthIndex: range.startSeason ? null : 0,
                    day: 1,
                }, cal);
                if (Number.isFinite(start)) min = start;
            }
            if (range.endMode === 'present') {
                try {
                    const present = this.getTimelinePresent();
                    if (present && Number.isFinite(present.sort) && present.scale !== 'date') {
                        max = present.sort;
                    }
                } catch { /* ignore */ }
            } else if (range.endYear != null) {
                const end = calendarSort({ year: range.endYear, monthIndex: Math.max(0, (cal.monthsPerYear || 12) - 1), day: 28 }, cal);
                if (Number.isFinite(end)) max = end;
            }
            if (!(max > min)) max = min + unit * 6;
        }
        return { min, max, family, calendarScale, empty: false };
    }

    _timelineUnitMs(id, scale) {
        return timelineUnitSort(id, scale, this._cal());
    }

    // ── Connection profile switcher ─────────────────────────────

    async _withProfile(profileId, fn) {
        // Delegates to the shared, serialized Connection Manager switcher.
        return withConnectionProfile(profileId, fn);
    }

   // ── Render ────────────────────────────────────────────────────

render(container) {
    this._panel = container;
    this._injectCSS();
    this._rerender();
}

_rerender() {
    if (!this._panel) return;
    document.querySelectorAll('body > .stm-tl-show-pop-body').forEach(n => n.remove());
    if (this._db().settings.view !== 'timeline') {
        this._tlRo?.disconnect();
        this._tlRo = null;
        this._tlWrap = null;
    }
    const db = this._db();
    this._panel.style.cssText = 'display:flex;flex-direction:column;height:100%;min-height:0;min-width:0;overflow:hidden;';
    this._panel.innerHTML = '';

    const root = document.createElement('div');
    root.className = 'stm-root';
    this._injectCSS();
    root.appendChild(this._buildToolbar(db));

    const body = document.createElement('div');
    body.className = 'stm-body';

    if (db.settings.view === 'timeline') {
        const tl = this._buildTimeline(db);
        body.appendChild(tl);
        // _bindTimelineViewport (called from _buildTimeline) does its own
        // requestAnimationFrame(() => this._tlRepaint()) once attached.
    } else {
        const treePanel = this._buildTreePanel(db);
        const handle    = this._buildResizeHandle(treePanel);
        const drawer    = this._buildCardDrawer();
        body.appendChild(treePanel);
        body.appendChild(handle);
        body.appendChild(drawer);
    }
    root.appendChild(body);
    this._panel.appendChild(root);
}

_buildResizeHandle(treePanel) {
    const handle = document.createElement('div');
    handle.className = 'stm-resize-handle';

    let startX, startW;
    const onMove = rafMove(e => {
        const w = Math.max(140, Math.min(420, startW + e.clientX - startX));
        treePanel.style.width = w + 'px';
        this._db().settings.treeWidth = w;
    });
    const onUp = () => {
        onMove.flush();
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup',   onUp);
        document.body.style.userSelect = '';
        this._save(this._db());
    };
    handle.addEventListener('mousedown', e => {
        startX = e.clientX;
        startW = treePanel.offsetWidth;
        document.body.style.userSelect = 'none';
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup',   onUp);
    });
    return handle;
}

// ── Toolbar ───────────────────────────────────────────────────

_buildToolbar(db) {
    const tb = document.createElement('div');
    tb.className = 'stm-toolbar';
    const view = db.settings.view === 'timeline' ? 'timeline' : 'tree';
    const ori = db.settings.tlOrientation === 'v' ? 'v' : 'h';
    tb.innerHTML = `
        <span class="stm-toolbar-title">🎬 Script</span>
        <span class="stm-tb-sep"></span>
        <button class="stm-btn ${view === 'tree' ? 'stm-btn-primary' : ''}" data-a="view-shelf">Shelf</button>
        <button class="stm-btn ${view === 'timeline' ? 'stm-btn-primary' : ''}" data-a="view-timeline">Timeline</button>
        ${view === 'timeline' ? `
        <span class="stm-tb-sep"></span>
        <button class="stm-btn ${ori === 'v' ? 'stm-btn-primary' : ''}" data-a="tl-v" title="Condensed, top → bottom">Condensed</button>
        <button class="stm-btn ${ori === 'h' ? 'stm-btn-primary' : ''}" data-a="tl-h" title="Broad, left → right">Broad</button>
        <span class="stm-tb-sep"></span>
        <button class="stm-btn" data-a="tl-out" title="Zoom out (mouse wheel zooms; drag to pan)">−</button>
        <span class="stm-tl-zoom-label" data-role="tl-zoom-label" title="Current time scale — wheel to zoom, drag to pan">${Math.round(this._tlZoomValue(db) * 100)}%</span>
        <button class="stm-btn" data-a="tl-in" title="Zoom in (mouse wheel zooms; drag to pan)">+</button>
        <button class="stm-btn" data-a="tl-home" title="Center on the narrative present">⌂</button>
        <label class="stm-tb-lock" title="New and vague dates inherit the present year, not the wall clock">
            <input type="checkbox" data-a="tl-lock-year" ${this._lockPresentYear(db) ? 'checked' : ''}> Lock year
        </label>
        <details class="stm-tl-show-pop stm-tl-goto-pop">
            <summary title="Jump the view to a year / season / month">Go to</summary>
            <div class="stm-tl-show-pop-body stm-tl-goto-body">
                ${this._tlGotoFormHTML()}
            </div>
        </details>
        <details class="stm-tl-show-pop">
            <summary title="Which time units are candidates for the axis labels">Marks</summary>
            <div class="stm-tl-show-pop-body">
                ${this._tlShowChecksHTML(this._tlShow(db), { idPrefix: 'stm-tb-tl-show' })}
            </div>
        </details>
        <button class="stm-btn" data-a="tl-audit" title="Snap unlocked pins to their true time; vague dates inherit the present year/season without rewriting the card">Audit</button>
        <span class="stm-tb-sep"></span>
        <button class="stm-btn" data-a="tl-add-event" title="Add a World or Personal event on the line">+ Event</button>
        ` : ''}
        <span class="stm-tb-sep"></span>
        <button class="stm-btn" data-a="agent">✦ Agent</button>
        <button class="stm-btn" data-a="configure" title="Script levels, calendar, agent budgets, activation">Configure</button>
    `;
    tb.addEventListener('click', ev => {
        const btn = ev.target.closest('[data-a]');
        if (!btn) return;
        const db2 = this._db();
        if (btn.dataset.a === 'view-shelf') {
            db2.settings.view = 'tree';
            this._save(db2);
            this._rerender();
        }
        if (btn.dataset.a === 'view-timeline') {
            db2.settings.view = 'timeline';
            this._save(db2);
            this._rerender();
        }
        if (btn.dataset.a === 'tl-v') {
            db2.settings.tlOrientation = 'v';
            this._save(db2);
            this._rerender();
        }
        if (btn.dataset.a === 'tl-h') {
            db2.settings.tlOrientation = 'h';
            this._save(db2);
            this._rerender();
        }
        if (btn.dataset.a === 'tl-out') this._tlNudgeZoom(1 / 1.35);
        if (btn.dataset.a === 'tl-in') this._tlNudgeZoom(1.35);
        if (btn.dataset.a === 'tl-home') this._tlGoHome();
        if (btn.dataset.a === 'tl-lock-year') {
            const on = btn.querySelector('input')?.checked;
            db2.settings.lockPresentYear = !!on;
            this._save(db2);
        }
        if (btn.dataset.a === 'tl-calendar') this._openSettings({ focus: 'calendar' });
        if (btn.dataset.a === 'tl-audit') this._auditTimelineAlign();
        if (btn.dataset.a === 'tl-add-event') this._openTimelineEventDialog();
        if (btn.dataset.a === 'configure' || btn.dataset.a === 'settings') {
            this._openSettings();
        }
        if (btn.dataset.a === 'agent') this._openAgentDialog();
    });
    const marksPop = tb.querySelector('.stm-tl-show-pop:not(.stm-tl-goto-pop)');
    const marksBody = marksPop?.querySelector('.stm-tl-show-pop-body');
    marksBody?.addEventListener('change', e => {
        const inp = e.target.closest('[data-tl-show]');
        if (!inp) return;
        const db2 = this._db();
        db2.settings.tlShow = this._readTlShowFromRoot(marksBody);
        this._save(db2);
        this._tlRepaint();
    });
    this._pinToolbarPop(marksPop, '.stm-tl-show-pop-body');

    const gotoPop = tb.querySelector('.stm-tl-goto-pop');
    const gotoBody = gotoPop?.querySelector('.stm-tl-goto-body');
    const readGotoParts = () => {
        const year = Number(gotoBody.querySelector('[data-tl-goto="year"]')?.value);
        const seasonId = gotoBody.querySelector('[data-tl-goto="season"]')?.value || '';
        const monthRaw = gotoBody.querySelector('[data-tl-goto="month"]')?.value;
        const monthIndex = monthRaw === '' || monthRaw == null ? null : Number(monthRaw);
        const day = Number(gotoBody.querySelector('[data-tl-goto="day"]')?.value);
        const hour = Number(gotoBody.querySelector('[data-tl-goto="hour"]')?.value);
        return {
            year: Number.isFinite(year) ? year : null,
            seasonId: seasonId || null,
            monthIndex: Number.isFinite(monthIndex) ? monthIndex : null,
            day: Number.isFinite(day) && day >= 1 ? day : 1,
            hour: Number.isFinite(hour) && hour >= 0 ? hour : 0,
        };
    };
    gotoBody?.querySelector('[data-a="tl-goto"]')?.addEventListener('click', () => {
        this._tlGoToParts(readGotoParts());
        if (gotoPop) gotoPop.open = false;
    });
    gotoBody?.querySelector('[data-a="tl-goto-set"]')?.addEventListener('click', () => {
        this._tlSetPresentFromParts(readGotoParts());
        if (gotoPop) gotoPop.open = false;
    });
    gotoBody?.querySelector('[data-a="tl-goto-present"]')?.addEventListener('click', () => {
        const present = this.getTimelinePresent();
        if (present?.sort == null) {
            alert('No present marker yet — use Set, or lock / date a card.');
            return;
        }
        this._tlCenterOnSort(present.sort);
        if (gotoPop) gotoPop.open = false;
    });
    this._pinToolbarPop(gotoPop, '.stm-tl-goto-body');
    return tb;
}

/** Float a <details> popover body so panel overflow:hidden does not clip it. */
_pinToolbarPop(details, bodySelector) {
    if (!details) return;
    const body = details.querySelector(bodySelector);
    if (!body) return;
    const place = () => {
        if (!details.open) {
            if (body.parentElement !== details) details.appendChild(body);
            body.style.position = '';
            body.style.top = '';
            body.style.right = '';
            body.style.left = '';
            body.style.zIndex = '';
            body.style.maxHeight = '';
            return;
        }
        const r = details.getBoundingClientRect();
        const maxH = Math.min(240, Math.max(120, window.innerHeight - r.bottom - 12));
        document.body.appendChild(body);
        body.style.position = 'fixed';
        body.style.top = `${Math.round(r.bottom + 4)}px`;
        body.style.right = `${Math.round(Math.max(8, window.innerWidth - r.right))}px`;
        body.style.left = 'auto';
        body.style.zIndex = '10050';
        body.style.maxHeight = `${maxH}px`;
    };
    details.addEventListener('toggle', place);
    const onDoc = e => {
        if (!details.open) return;
        if (details.contains(e.target) || body.contains(e.target)) return;
        details.open = false;
    };
    document.addEventListener('pointerdown', onDoc, true);
}

// ── Timeline pinboard — Reputation-web-style pan/zoom ─────────────────────────

_tlZoomValue(db = this._db()) {
    const z = Number(db.settings.tlZoomC);
    return Number.isFinite(z) ? Math.max(TL_ZOOM_MIN, Math.min(this._tlMaxZoom(), z)) : 1;
}

/**
 * Highest useful zoom for the *current* domain. A fixed cap (TL_ZOOM_MAX) is
 * fine for a short story but leaves a wide date range stuck showing only
 * year/season gaps — the pixels-per-month never grow enough for finer marks to
 * appear. So the ceiling scales with the domain: it's whatever zoom is needed
 * to blow the finest *enabled* mark (down to hours) up to a comfortably
 * readable width, so you can always drill into precise dates. Falls back to the
 * static cap until the ruler has been measured (px/unit + domain known).
 */
_tlMaxZoom() {
    // Cached each repaint (see _tlComputeMaxZoom) — this is read on hot paths
    // like pointer-move panning, so it must never touch layout here.
    return this._tlMaxZoomCached > 0 ? this._tlMaxZoomCached : TL_ZOOM_MAX;
}

_tlComputeMaxZoom(size, domain) {
    const base = TL_ZOOM_MAX;
    const pxPerUnit = this._tlPxPerUnit;
    if (!(pxPerUnit > 0) || !domain || !(size > 0)) return base;
    const cal = this._cal();
    const show = this._tlShow();
    // Finest mark the user actually left enabled (TL_ZOOM is coarse → fine).
    const finest = [...TL_ZOOM].reverse().find(z => show[z.id]) || TL_ZOOM[TL_ZOOM.length - 1];
    const unitScale = domain.family === 'date' ? 'date' : (domain.calendarScale || 'day');
    const finestUnit = timelineUnitSort(finest.id, unitScale, cal);
    if (!(finestUnit > 0)) return base;
    // Target on-axis width for one finest-mark: comfortably past the "major"
    // threshold so that scale genuinely renders (and its finer minor ticks too).
    const targetPx = Math.max(size / 4, TL_MAJOR_MIN_PX * 1.5);
    const need = targetPx / (finestUnit * pxPerUnit);
    return Math.max(base, Math.min(TL_ZOOM_HARD_MAX, need));
}

/** Zoom about whatever the viewport is currently centred on (mirrors Reputation's web). */
_tlSetZoom(next, wrap = this._tlWrap) {
    const db = this._db();
    const z0 = this._tlZoomValue(db);
    const z1 = Math.max(TL_ZOOM_MIN, Math.min(this._tlMaxZoom(), next));
    if (z1 === z0) return;
    const vp = wrap?.querySelector('.stm-tl');
    if (vp && this._tlAnchorSort != null && this._tlPan != null) {
        const size = this._tlMetrics(vp, wrap._tlVert).size;
        const centerSort = this._tlSortFromScreenPx(size / 2, z0, this._tlPan);
        this._tlFocusSort = centerSort;
        this._tlPan = size / 2 - (centerSort - this._tlAnchorSort) * this._tlPxPerUnit * z1;
    }
    db.settings.tlZoomC = z1;
    // Don't persist every wheel tick — coalesce saves.
    clearTimeout(this._tlZoomSaveTimer);
    this._tlZoomSaveTimer = setTimeout(() => {
        try { this._save(this._db()); } catch { /* ignore */ }
    }, 280);
    // Zoom changes tick density — always rebuild chrome (pan stays light).
    this._tlRepaint();
}

_tlNudgeZoom(factor) {
    this._tlSetZoom(this._tlZoomValue() * factor);
}

/** Recompute the fit-to-content anchor and reset pan/zoom (⌂ button).
 *  When a narrative present is set, home is that instant — not the span of every card. */
_tlGoHome() {
    this._tlFocusSort = null;
    this._tlAnchorSort = null;
    this._tlPan = null;
    const db = this._db();
    db.settings.tlZoomC = 1;
    this._save(db);
    this._tlRepaint({ forceAnchor: true });
}

/** Year / season / month fields for the timeline "Go to" popover. */
_tlGotoFormHTML() {
    const cal = this._cal();
    const present = this.getTimelinePresent();
    const parts = present?.parts || {};
    let year = Number(parts.year);
    if (!Number.isFinite(year)) year = 1;
    let monthIndex = parts.monthIndex;
    if (monthIndex == null && parts.seasonId) {
        const season = cal.seasons.find(s => s.id === parts.seasonId);
        monthIndex = season ? Math.max(0, (season.startMonth || 1) - 1) : 0;
    }
    if (monthIndex == null) monthIndex = 0;
    const seasonId = parts.seasonId
        || cal.seasons.find(s => {
            const a = Math.max(0, (s.startMonth || 1) - 1);
            const b = Math.max(a, (s.endMonth || s.startMonth || 1) - 1);
            return monthIndex >= a && monthIndex <= b;
        })?.id
        || cal.seasons[0]?.id
        || '';
    const seasonOpts = [
        `<option value="">— ${esc(cal.labels.season)} —</option>`,
        ...cal.seasons.map(s =>
            `<option value="${esc(s.id)}" ${s.id === seasonId ? 'selected' : ''}>${esc(s.label)}</option>`),
    ].join('');
    const monthOpts = [
        `<option value="">— ${esc(cal.labels.month)} —</option>`,
        ...cal.monthNames.map((n, i) =>
            `<option value="${i}" ${i === monthIndex ? 'selected' : ''}>${esc(n)}</option>`),
    ].join('');
    let day = Number(parts.day);
    if (!Number.isFinite(day) || day < 1) day = 1;
    const hoursPerDay = Math.max(1, Number(cal.hoursPerDay) || 24);
    let hour = Number(parts.hour);
    if (!Number.isFinite(hour) || hour < 0) hour = 0;
    hour = Math.min(hoursPerDay - 1, hour);
    const earthDays = Number(cal.monthsPerYear) === 12;
    const dayMax = earthDays ? 31 : 30;
    day = Math.min(dayMax, day);
    return `
        <div class="stm-tl-goto-hint">Center pans the board to this date. Set places the present marker on it. Drag or (at high zoom) the wheel to pan; Ctrl+wheel zooms. Shift+wheel always pans.</div>
        <div class="stm-tl-goto-row">
            <label>${esc(cal.labels.year)}
                <input type="number" data-tl-goto="year" min="0" max="999999" value="${esc(String(year))}">
            </label>
        </div>
        <div class="stm-tl-goto-row">
            <label>${esc(cal.labels.season)}
                <select data-tl-goto="season">${seasonOpts}</select>
            </label>
        </div>
        <div class="stm-tl-goto-row">
            <label>${esc(cal.labels.month)}
                <select data-tl-goto="month">${monthOpts}</select>
            </label>
        </div>
        <div class="stm-tl-goto-row">
            <label>${esc(cal.labels.day)}
                <input type="number" data-tl-goto="day" min="1" max="${dayMax}" value="${esc(String(day))}">
            </label>
            <label>${esc(cal.labels.hour)}
                <input type="number" data-tl-goto="hour" min="0" max="${hoursPerDay - 1}" value="${esc(String(hour))}">
            </label>
        </div>
        <div class="stm-tl-goto-actions">
            <button type="button" class="stm-btn stm-btn-primary" data-a="tl-goto">Center</button>
            <button type="button" class="stm-btn" data-a="tl-goto-set" title="Place the present marker at this date">Set</button>
            <button type="button" class="stm-btn" data-a="tl-goto-present" title="Jump the view to the present marker">Present</button>
        </div>
    `;
}

/** Sort value for Go-to fields — calendar hours or Earth ms depending on the active domain. */
_tlSortFromGotoParts({ year = null, seasonId = null, monthIndex = null, day = 1, hour = 0 } = {}) {
    const cal = this._cal();
    const wrap = this._tlWrap;
    const cards = wrap?._tlCards || this._timelineCards();
    const domain = this._timelineDomain(cards);
    let month = monthIndex;
    if (month == null && seasonId) {
        const season = cal.seasons.find(s => s.id === seasonId
            || s.label.toLowerCase() === String(seasonId).toLowerCase());
        month = season ? Math.max(0, (season.startMonth || 1) - 1) : 0;
    }
    if (month == null) month = 0;
    const y = Number.isFinite(Number(year)) ? Number(year) : 1;
    const dayMax = domain.family === 'date' ? 31 : 30;
    const d = Math.max(1, Math.min(dayMax, Number(day) || 1));
    const hoursPerDay = Math.max(1, Number(cal.hoursPerDay) || 24);
    const h = Math.max(0, Math.min(hoursPerDay - 1, Number(hour) || 0));
    if (domain.family === 'date') {
        const m = Math.max(0, Math.min(11, Number(month) || 0));
        return earthDateSort(Date.UTC(y, m, d, Math.min(23, h)));
    }
    return calendarSort({
        year: y,
        seasonId: seasonId || undefined,
        monthIndex: month,
        day: d,
        hour: h,
        scale: h ? 'hour' : (d > 1 ? 'day' : 'month'),
    }, cal);
}

_tlGoToParts(parts = {}) {
    const sort = this._tlSortFromGotoParts(parts);
    if (!Number.isFinite(sort)) return;
    this._tlCenterOnSort(sort);
}

/** Place the present (gold) marker at the Go-to date without changing zoom. */
_tlSetPresentFromParts(parts = {}) {
    const sort = this._tlSortFromGotoParts(parts);
    if (!Number.isFinite(sort)) return;
    const cal = this._cal();
    const wrap = this._tlWrap;
    const cards = wrap?._tlCards || this._timelineCards();
    const domain = this._timelineDomain(cards);
    const scale = domain.family === 'date' ? 'date' : 'calendar';
    let presentParts;
    if (domain.family === 'date') {
        // Derive parts from the same UTC instant as the sort so the marker,
        // Go-to fields, and ruler ticks all name the same day/hour.
        presentParts = partsFromEarthMs(sort - EARTH_EPOCH, cal);
        if (!Number.isFinite(presentParts.year)) {
            presentParts = partsFromEarthMs(Date.UTC(
                Number.isFinite(Number(parts.year)) ? Number(parts.year) : 1,
                Math.max(0, Math.min(11, Number(parts.monthIndex) || 0)),
                Math.max(1, Number(parts.day) || 1),
                Math.max(0, Math.min(23, Number(parts.hour) || 0)),
            ), cal);
        }
        // Month name on the marker matches the ruler; season is still in Go-to.
        presentParts.seasonId = null;
    } else {
        let month = parts.monthIndex;
        if (month == null && parts.seasonId) {
            const season = cal.seasons.find(s => s.id === parts.seasonId);
            month = season ? Math.max(0, (season.startMonth || 1) - 1) : 0;
        }
        if (month == null) month = 0;
        const year = Number.isFinite(Number(parts.year)) ? Number(parts.year) : 1;
        const seasonId = parts.seasonId
            || cal.seasons.find(s => {
                const a = Math.max(0, (s.startMonth || 1) - 1);
                const b = Math.max(a, (s.endMonth || s.startMonth || 1) - 1);
                return month >= a && month <= b;
            })?.id
            || null;
        presentParts = {
            year,
            monthIndex: month,
            seasonId,
            seasonPhase: null,
            day: Math.max(1, Number(parts.day) || 1),
            week: null,
            hour: Number.isFinite(Number(parts.hour)) ? Math.max(0, Number(parts.hour)) : null,
            scale: Number.isFinite(Number(parts.hour)) ? 'hour' : (Number(parts.day) > 1 ? 'day' : 'month'),
        };
    }
    let key = '';
    try {
        key = formatTimeKey(presentParts, cal) || formatSceneDate(presentParts, cal) || '';
    } catch {
        key = '';
    }
    if (!key) {
        const mi = Number.isFinite(Number(presentParts.monthIndex)) ? Number(presentParts.monthIndex) : 0;
        const yr = Number.isFinite(Number(presentParts.year)) ? Number(presentParts.year) : 1;
        const monthName = cal.monthNames[mi] || String(mi + 1);
        key = scale === 'date'
            ? `${monthName} ${yr}`
            : `${monthName} ${formatCalendarYear(yr, cal)}`;
    }
    const db = this._db();
    db.settings.timelinePresent = { sort, key, scale, parts: presentParts };
    this._tlFocusSort = sort;
    this._save(db);
    this._tlCenterOnSort(sort);
}

/** Pan so `sort` sits at the viewport center (keeps current zoom / anchor). */
_tlCenterOnSort(sort) {
    this._tlFocusSort = Number.isFinite(sort) ? sort : this._tlFocusSort;
    const wrap = this._tlWrap;
    const vp = wrap?.querySelector('.stm-tl');
    if (!vp || this._tlAnchorSort == null || !this._tlPxPerUnit) {
        // First paint may not have anchored yet — force a home fit then retry.
        this._tlRepaint({ forceAnchor: true });
        requestAnimationFrame(() => {
            if (this._tlAnchorSort == null || !this._tlPxPerUnit) return;
            this._tlCenterOnSort(sort);
        });
        return;
    }
    const vert = wrap._tlVert;
    const size = this._tlMetrics(vp, vert).size;
    const zoom = this._tlZoomValue();
    const cards = wrap._tlCards || this._timelineCards();
    const domain = this._timelineDomain(cards);
    this._tlPan = this._tlClampPan(
        size / 2 - this._tlBasePx(sort) * zoom,
        size,
        zoom,
        domain,
        [sort],
    );
    this._tlRepaint();
}

/** Snap unlocked pins to their true time. Vague keys inherit the present
 * year/season for placement only — the card's authored span / Date tags stay put. */
_auditTimelineAlign() {
    const db = this._db();
    const anchorParts = this._timelineAnchorParts();

    let snapped = 0;
    let grouped = 0;
    for (const c of db.cards || []) {
        if (this._isFolder(c, db)) continue;
        if (c.timeLocked || c.timelineOff) continue;

        const authored = this._parseCardTime(c, { anchorParts, fillMissing: false });
        const hit = this._parseCardTime(c, { anchorParts });
        if (hit && Number.isFinite(hit.parsed.sort)) {
            if (c.timeManual) {
                c.timeManual = false;
                c.timeManualSort = null;
                snapped++;
            }
            c.timestamp = hit.parsed.sort;
            const hadYear = authored?.parsed?.parts?.year != null;
            if (!hadYear) grouped++;
            c.updatedAt = now();
        }
        // Unparseable cards stay in the Undated dock — audit must not write a date onto them.
    }
    this._save(db);
    this._rerender();
    const bits = [];
    if (snapped) bits.push(`snapped ${snapped} offset pin${snapped === 1 ? '' : 's'}`);
    if (grouped) bits.push(`grouped ${grouped} vague date${grouped === 1 ? '' : 's'} on the present`);
    alert(bits.length
        ? `Timeline audit — ${bits.join('; ')}.`
        : 'Timeline audit — unlocked cards already sit on their true time.');
}

_openCalendarDialog() {
    this._openSettings({ focus: 'calendar' });
}

_tlShow(db = this._db()) {
    db.settings.tlShow = normalizeTlShow(db.settings.tlShow);
    return db.settings.tlShow;
}

_tlShowChecksHTML(show, { idPrefix = 'stm-tl-show' } = {}) {
    const cal = this._cal();
    const labelFor = (id) => {
        const map = {
            decades: cal.labels.decade,
            years: cal.labels.year,
            seasons: cal.labels.season,
            months: cal.labels.month,
            weeks: cal.labels.week,
            days: cal.labels.day,
            hours: cal.labels.hour,
        };
        return map[id] || id;
    };
    return `<div class="stm-tp-vis-row stm-tl-show-row">
        <span class="stm-tp-vis-h">Show</span>
        ${TL_ZOOM.map(z => `
            <label class="stm-tp-vis-lab">
                <input type="checkbox" data-tl-show="${esc(z.id)}" id="${esc(idPrefix)}-${esc(z.id)}" ${show[z.id] ? 'checked' : ''}>
                ${esc(labelFor(z.id))}
            </label>`).join('')}
    </div>`;
}

_readTlShowFromRoot(root) {
    const cur = this._tlShow();
    const out = { ...cur };
    let any = false;
    root.querySelectorAll('[data-tl-show]').forEach(inp => {
        const id = inp.dataset.tlShow;
        if (!id || !(id in out)) return;
        out[id] = !!inp.checked;
        if (inp.checked) any = true;
    });
    if (!any) out.months = true;
    return normalizeTlShow(out);
}

_calendarFormHTML(cal) {
    const L = cal.labels;
    const show = this._tlShow();
    return `
        <p class="stm-settings-hint">Rename the timescale for your world. Scene Date/Time tags and timeline placement both read these labels.</p>
        <div class="stm-form-row stm-form-row--2">
            <div>
                <label>Months per year</label>
                <input type="number" id="stm-cal-months" min="2" max="24" value="${cal.monthsPerYear}">
            </div>
            <div>
                <label>Hours in a ${esc(L.day).toLowerCase()}</label>
                <input type="number" id="stm-cal-hours" min="1" max="48" value="${cal.hoursPerDay}">
            </div>
        </div>
        <div class="stm-form-row">
            <label>Month names <span class="stm-hint">(one per line, top → bottom = month 1…${cal.monthsPerYear})</span></label>
            <textarea id="stm-cal-month-names" rows="6">${esc(cal.monthNames.join('\n'))}</textarea>
        </div>
        <div class="stm-form-row">
            <label>Seasons <span class="stm-hint">(Label | startMonth | endMonth)</span></label>
            <textarea id="stm-cal-seasons" rows="4">${esc(cal.seasons.map(s => `${s.label} | ${s.startMonth} | ${s.endMonth}`).join('\n'))}</textarea>
        </div>
        <div class="stm-form-row">
            <label>Unit names</label>
            <div class="stm-cal-labels">
                ${['day', 'week', 'month', 'season', 'year', 'decade', 'hour'].map(k => `
                    <label class="stm-cal-label">
                        <span>${esc(k)}</span>
                        <input type="text" data-cal-label="${k}" value="${esc(L[k])}">
                    </label>`).join('')}
            </div>
        </div>
        <div class="stm-form-row stm-form-row--2">
            <div>
                <label>Year prefix <span class="stm-hint">(optional)</span></label>
                <input type="text" id="stm-cal-year-prefix" value="${esc(cal.yearPrefix)}" placeholder="e.g. Y">
            </div>
            <div>
                <label>Year suffix <span class="stm-hint">(optional era mark)</span></label>
                <input type="text" id="stm-cal-year-suffix" value="${esc(cal.yearSuffix)}" placeholder="e.g. AE, Third Age">
            </div>
        </div>
        <details class="stm-set-time stm-tl-show-fold" open>
            <summary>Timeline marks</summary>
            <div class="stm-set-time-body">
                <p class="stm-settings-hint">Choose which time units are candidates for the timeline's axis labels — the ruler auto-picks the finest checked unit that still fits at the current zoom.</p>
                ${this._tlShowChecksHTML(show, { idPrefix: 'stm-cfg-tl-show' })}
            </div>
        </details>
        ${this._tlRangeFormHTML()}
        <p class="stm-hint">Examples: “${esc(L.day)} 3”, “${esc(cal.seasons[0]?.label || L.season)} 12”, “${esc(cal.monthNames[0] || L.month)} 12”, “${esc(formatCalendarYear(12, cal))}”.</p>`;
}

_tlRangeFormHTML() {
    const db = this._db();
    const r = this._tlRange(db);
    const cal = this._cal();
    const seasonOpts = [`<option value="">— Season —</option>`]
        .concat(cal.seasons.map(s => `<option value="${esc(s.id)}" ${r.startSeason === s.id ? 'selected' : ''}>${esc(s.label)}</option>`))
        .join('');
    return `
        <div class="stm-form-row">
            <label><input type="checkbox" id="stm-lock-year" ${this._lockPresentYear(db) ? 'checked' : ''}> Lock year to present</label>
            <p class="stm-settings-hint">New cards, Agent spans, and vague dates inherit the Script present year — not the real-world calendar.</p>
        </div>
        <div class="stm-form-row stm-form-row--2">
            <div>
                <label>Timeline starts</label>
                <div class="stm-cal-picker-row">
                    <select id="stm-tl-start-season">${seasonOpts}</select>
                    <input type="number" id="stm-tl-start-year" min="0" max="999999" placeholder="Year" value="${r.startYear ?? ''}">
                </div>
            </div>
            <div>
                <label>Timeline ends</label>
                <select id="stm-tl-end-mode">
                    <option value="present" ${r.endMode === 'present' ? 'selected' : ''}>At present</option>
                    <option value="beyond" ${r.endMode === 'beyond' ? 'selected' : ''}>Beyond present</option>
                </select>
                <input type="number" id="stm-tl-end-year" min="0" max="999999" placeholder="End year (optional)" value="${r.endYear ?? ''}" ${r.endMode === 'beyond' ? '' : 'hidden'}>
            </div>
        </div>`;
}

_readCalendarFromForm(root) {
    const monthsPerYear = Number(root.querySelector('#stm-cal-months')?.value) || 12;
    const hoursPerDay = Number(root.querySelector('#stm-cal-hours')?.value) || 24;
    const monthNames = String(root.querySelector('#stm-cal-month-names')?.value || '')
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean);
    const seasons = String(root.querySelector('#stm-cal-seasons')?.value || '')
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .map((line, i) => {
            const [label, start, end] = line.split('|').map(x => x.trim());
            return {
                id: `s${i}`,
                label: label || `Season ${i + 1}`,
                startMonth: Number(start) || 1,
                endMonth: Number(end) || Number(start) || 1,
            };
        });
    const labels = { ...CAL_LABEL_DEFAULTS };
    root.querySelectorAll('[data-cal-label]').forEach(inp => {
        const k = inp.dataset.calLabel;
        const v = String(inp.value || '').trim();
        if (k && v) labels[k] = v;
    });
    return normalizeCalendar({
        monthsPerYear,
        hoursPerDay,
        seasons,
        monthNames,
        labels,
        yearPrefix: root.querySelector('#stm-cal-year-prefix')?.value || '',
        yearSuffix: root.querySelector('#stm-cal-year-suffix')?.value || '',
    });
}

_eventScaleFieldsHTML(card = {}, { idPrefix = 'stm-ev' } = {}) {
    const scale = card.eventScale === 'personal' ? 'personal' : 'world';
    const impact = normalizeEventImpact(card.eventImpact);
    const cast = this._actingCast();
    const houses = this._repHouses();
    const castChecks = cast.length
        ? cast.map(m => `<label class="stm-ev-check"><input type="checkbox" data-ev-cast="${esc(m.id)}" ${impact.castIds.includes(m.id) ? 'checked' : ''}> ${esc(m.name)} <em>${esc(priorityLabel(m.priority))}</em></label>`).join('')
        : '<p class="stm-hint">No cast on file yet.</p>';
    const houseChecks = houses.length
        ? houses.map(h => `<label class="stm-ev-check"><input type="checkbox" data-ev-house="${esc(h.id)}" ${impact.houseIds.includes(h.id) ? 'checked' : ''}> ${esc(h.alias ? `${h.name} (${h.alias})` : h.name)}</label>`).join('')
        : '<p class="stm-hint">File an Affiliation dossier first.</p>';
    const recur = EVENT_RECUR_OPTS.some(o => o.id === card.eventRecur) ? card.eventRecur : 'yearly';
    const recurOpts = EVENT_RECUR_OPTS.map(o =>
        `<option value="${esc(o.id)}" ${o.id === recur ? 'selected' : ''}>${esc(o.label)}</option>`).join('');
    return `
        <div class="stm-form-row">
            <label>Scale</label>
            <div class="stm-scale-row" data-role="ev-scale">
                <button type="button" class="stm-scale-btn${scale === 'world' ? ' on' : ''}" data-scale="world">World</button>
                <button type="button" class="stm-scale-btn${scale === 'personal' ? ' on' : ''}" data-scale="personal">Personal</button>
            </div>
        </div>
        <div class="stm-ev-impact" data-role="ev-impact" ${scale === 'personal' ? '' : 'hidden'}>
            <div class="stm-form-row">
                <label>Who it impacts — Cast</label>
                <div class="stm-ev-checks">${castChecks}</div>
            </div>
            <div class="stm-form-row">
                <label>Who it impacts — Faction</label>
                <div class="stm-ev-checks">${houseChecks}</div>
            </div>
        </div>
        <div class="stm-form-row stm-form-row--toggles">
            <label><input type="checkbox" data-role="ev-recur" ${card.eventRecurring ? 'checked' : ''}> Recurring</label>
            <select data-role="ev-recur-rule" ${card.eventRecurring ? '' : 'disabled'}>${recurOpts}</select>
        </div>`;
}

_bindEventScaleFields(root) {
    const row = root.querySelector('[data-role="ev-scale"]');
    const impact = root.querySelector('[data-role="ev-impact"]');
    const recur = root.querySelector('[data-role="ev-recur"]');
    const rule = root.querySelector('[data-role="ev-recur-rule"]');
    row?.querySelectorAll('.stm-scale-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            row.querySelectorAll('.stm-scale-btn').forEach(b => b.classList.toggle('on', b === btn));
            if (impact) impact.hidden = btn.dataset.scale !== 'personal';
        });
    });
    recur?.addEventListener('change', () => {
        if (rule) rule.disabled = !recur.checked;
    });
}

_readEventScaleFields(root) {
    const scale = root.querySelector('[data-role="ev-scale"] .stm-scale-btn.on')?.dataset.scale === 'personal'
        ? 'personal' : 'world';
    const castIds = [...root.querySelectorAll('[data-ev-cast]:checked')].map(el => el.dataset.evCast).filter(Boolean);
    const houseIds = [...root.querySelectorAll('[data-ev-house]:checked')].map(el => el.dataset.evHouse).filter(Boolean);
    const recurring = !!root.querySelector('[data-role="ev-recur"]')?.checked;
    const recurRaw = String(root.querySelector('[data-role="ev-recur-rule"]')?.value || 'yearly');
    const eventRecur = EVENT_RECUR_OPTS.some(o => o.id === recurRaw) ? recurRaw : 'yearly';
    return {
        eventScale: scale,
        eventImpact: scale === 'personal' ? { castIds, houseIds } : { castIds: [], houseIds: [] },
        eventRecurring: recurring,
        eventRecur: recurring ? eventRecur : '',
    };
}

_openTimelineEventDialog() {
    let eventLeaves = [];
    try {
        const lib = window.Showtime?.modules?.get('library');
        const books = (this._wiBooks?.length ? this._wiBooks : null)
            || (lib?._booksLoaded ? lib._books : null)
            || [];
        const leaves = listLibraryLeaves(this.storage, books);
        eventLeaves = leaves.filter(l =>
            (l.tags || []).some(t => /^(event|era)$/i.test(String(t.type || '')))
            || /event|era/i.test(String(l.sectionTitle || ''))
        ).slice(0, 40);
    } catch { /* ignore */ }

    let achievements = [];
    try {
        const mot = this.storage.getChat('motivation', { perChar: {} });
        const cast = this._castMembers?.() || [];
        for (const [id, row] of Object.entries(mot.perChar || {})) {
            const who = cast.find(c => c.id === id)?.name || id;
            for (const a of (row.achievements || []).filter(x => x.status === 'earned' || x.status === 'established')) {
                achievements.push({
                    id: a.id,
                    title: a.title,
                    who,
                    sceneUid: a.sceneUid || '',
                    description: a.description || '',
                });
            }
        }
    } catch { /* ignore */ }

    const libOpts = eventLeaves.length
        ? eventLeaves.map(l => `<option value="lib:${esc(l.key)}">${esc(l.title)} · ${esc(l.book || 'Library')}</option>`).join('')
        : '<option value="" disabled>No Library event/era tags found</option>';
    const achOpts = achievements.length
        ? achievements.map(a => `<option value="ach:${esc(a.id)}">${esc(a.who)} — ${esc(a.title)}</option>`).join('')
        : '<option value="" disabled>No earned achievements</option>';

    const overlay = document.createElement('div');
    overlay.className = 'stm-dialog-overlay';
    overlay.innerHTML = `
        <div class="stm-dialog stm-dialog--wide">
            <div class="stm-dialog-header">Event</div>
            <div class="stm-dialog-body">
                <p class="stm-hint">World events are shared news. Personal events hit chosen cast or factions. The pin stays fixed on the line.</p>
                ${this._eventScaleFieldsHTML({})}
                <div class="stm-form-row">
                    <label>Title <span class="stm-required">*</span></label>
                    <input type="text" id="stm-ev-title" placeholder="Harvest festival, a birthday, a coup…">
                </div>
                <div class="stm-form-row stm-form-row--tall">
                    <label>Description</label>
                    <textarea id="stm-ev-desc" rows="4" placeholder="What happens, and what it changes…"></textarea>
                </div>
                <div class="stm-form-row">
                    <label>Time / date <span class="stm-required">*</span></label>
                    <input type="text" id="stm-ev-time" name="stm-ev-time" placeholder="${esc(this._calendarTimePlaceholder())}">
                    ${this._calendarPickerHTML({ inputName: 'stm-ev-time', idPrefix: 'stm-ev-tp' })}
                </div>
                <details class="stm-ev-seed">
                    <summary>Optional — seed from Library or an achievement</summary>
                    <div class="stm-form-row">
                        <label>Source</label>
                        <select id="stm-ev-src">
                            <option value="">— Write it yourself —</option>
                            <optgroup label="Library">${libOpts}</optgroup>
                            <optgroup label="Achievements">${achOpts}</optgroup>
                        </select>
                    </div>
                </details>
            </div>
            <div class="stm-dialog-footer">
                <button type="button" class="stm-btn" data-a="cancel">Cancel</button>
                <button type="button" class="stm-btn stm-btn-primary" data-a="save">Place</button>
            </div>
        </div>`;
    const close = () => overlay.remove();
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    overlay.querySelector('[data-a="cancel"]').addEventListener('click', close);
    this._bindEventScaleFields(overlay);
    this._bindCalendarPicker(overlay, {
        onPick: (key) => {
            const input = overlay.querySelector('#stm-ev-time');
            if (input) input.value = key;
        },
    });
    overlay.querySelector('#stm-ev-src')?.addEventListener('change', () => {
        const raw = overlay.querySelector('#stm-ev-src')?.value || '';
        const titleEl = overlay.querySelector('#stm-ev-title');
        const descEl = overlay.querySelector('#stm-ev-desc');
        const timeEl = overlay.querySelector('#stm-ev-time');
        if (raw.startsWith('lib:')) {
            const leaf = eventLeaves.find(l => l.key === raw.slice(4));
            if (!leaf) return;
            if (titleEl && !titleEl.value.trim()) titleEl.value = leaf.title || '';
            if (descEl && !descEl.value.trim()) descEl.value = String(leaf.content || '').replace(/\s+/g, ' ').slice(0, 400);
            const era = (leaf.tags || []).find(t => t.type === 'era')?.value || '';
            if (timeEl && !timeEl.value.trim() && era) timeEl.value = era;
        } else if (raw.startsWith('ach:')) {
            const ach = achievements.find(a => a.id === raw.slice(4));
            if (!ach) return;
            if (titleEl && !titleEl.value.trim()) titleEl.value = ach.title || '';
            if (descEl && !descEl.value.trim()) descEl.value = `${ach.who}: ${ach.description || ach.title}`.slice(0, 400);
        }
    });
    overlay.querySelector('[data-a="save"]').addEventListener('click', () => {
        const titleEl = overlay.querySelector('#stm-ev-title');
        const title = String(titleEl?.value || '').trim();
        const timeKey = String(overlay.querySelector('#stm-ev-time')?.value || '').trim();
        const summary = String(overlay.querySelector('#stm-ev-desc')?.value || '').trim();
        if (!title) { titleEl?.classList.add('stm-input-error'); titleEl?.focus(); return; }
        if (!timeKey) {
            overlay.querySelector('#stm-ev-time')?.classList.add('stm-input-error');
            overlay.querySelector('#stm-ev-time')?.focus();
            return;
        }
        const fields = this._readEventScaleFields(overlay);
        if (fields.eventScale === 'personal'
            && !fields.eventImpact.castIds.length
            && !fields.eventImpact.houseIds.length) {
            alert('Pick who this personal event impacts (cast or faction).');
            return;
        }
        const members = this._castMembers();
        const credits = fields.eventImpact.castIds.map(id => {
            const m = members.find(x => x.id === id);
            return m ? { characterId: m.id, name: m.name, role: m.priority } : null;
        }).filter(Boolean);
        const raw = overlay.querySelector('#stm-ev-src')?.value || '';
        let sourceId = `event-${Date.now()}`;
        let sourceKind = 'event';
        if (raw.startsWith('lib:')) { sourceKind = 'event'; sourceId = raw.slice(4); }
        else if (raw.startsWith('ach:')) { sourceKind = 'event'; sourceId = raw.slice(4); }
        const created = this._addCard({
            kind: 'event',
            levelId: this._cardLevelId(),
            title,
            summary,
            content: summary,
            timeKey,
            span: timeKey,
            timeLocked: true,
            timelineOff: false,
            sourceKind,
            sourceId,
            eventScale: fields.eventScale,
            eventImpact: fields.eventImpact,
            eventRecurring: fields.eventRecurring,
            eventRecur: fields.eventRecur,
            credits,
            keywordFacets: {
                location: [],
                objects: [],
                characters: [],
                datetime: [timeKey],
            },
        });
        close();
        const db2 = this._db();
        db2.settings.view = 'timeline';
        this._save(db2);
        this._rerender();
        const hit = this._parseCardTime(created);
        if (hit?.parsed && Number.isFinite(hit.parsed.sort)) this._tlCenterOnSort(hit.parsed.sort);
    });
    document.body.appendChild(overlay);
    overlay.querySelector('#stm-ev-title')?.focus();
}

_buildTimeline(db) {
    const vert = db.settings.tlOrientation === 'v';
    const cal = normalizeCalendar(db.settings.calendar);
    const cards = this._timelineCohort(db);
    this._tlMigrateLegacyRanks(db, cards);
    const domain = this._timelineDomain(cards);

    const placed = [];
    const dock = [];
    for (const card of cards) {
        const place = this._timelinePlace(card, cards, domain);
        // Virtual Library pins aren't real db.cards — if one can't be placed
        // (rare family-mismatch edge case) just leave it off the ruler rather
        // than putting an unplaceable chip in the dock.
        if (place.dock && card.virtual) continue;
        (place.dock ? dock : placed).push({ card, place });
    }

    const wrap = document.createElement('div');
    wrap.className = 'stm-tl-wrap';
    wrap.innerHTML = `
        ${db.settings.tlHintDismissed ? '' : `
        <div class="stm-tl-legend">
            <span>Drag empty space to pan. Wheel zooms until ~225%, then pans (Ctrl/Alt+wheel always zooms; Shift+wheel always pans). Drag a pin to nudge it; Ctrl/⌘-click to multi-select and drag a group together. Lock (🔒) pins a card to its true date. ⇤ takes a card off the ruler. Undated cards live in the dock →</span>
            <button type="button" class="stm-tl-legend-x" data-a="tl-hint-dismiss" title="Dismiss">✕</button>
        </div>`}
        <div class="stm-tl-main">
            <div class="stm-tl ${vert ? 'stm-tl--v' : 'stm-tl--h'}">
                <div class="stm-tl-board">
                    <div class="stm-tl-axis" aria-hidden="true"></div>
                    <div class="stm-tl-ranges" aria-hidden="true"></div>
                    <div class="stm-tl-ticks" aria-hidden="true"></div>
                    <div class="stm-tl-now" title="Present" hidden></div>
                </div>
            </div>
            <div class="stm-tl-dock" data-role="tl-dock" ${dock.length ? '' : 'hidden'}>
                <div class="stm-tl-dock-head">Off the line <span class="stm-tl-dock-count">${dock.length}</span></div>
                <p class="stm-tl-dock-hint">Undated, or taken off with ⇤. Drag ⠿ onto the line, or use ＋.</p>
                <div class="stm-tl-dock-list" data-role="tl-dock-list"></div>
            </div>
        </div>
        <input type="range" class="stm-tl-scrub" data-role="tl-scrub" min="0" max="1000" value="500" title="Pan the timeline">`;
    wrap.querySelector('[data-a="tl-hint-dismiss"]')?.addEventListener('click', () => {
        const db2 = this._db();
        db2.settings.tlHintDismissed = true;
        this._save(db2);
        this._rerender();
    });

    const board = wrap.querySelector('.stm-tl-board');
    const dockList = wrap.querySelector('[data-role="tl-dock-list"]');
    wrap._tlCards = cards;
    wrap._tlVert = vert;
    this._tlWrap = wrap;
    this._tlPinSizeCache = new WeakMap();
    wrap.querySelector('[data-role="tl-scrub"]')?.addEventListener('input', e => {
        const domain = wrap._tlDomain || this._timelineDomain(cards);
        const t = Number(e.target.value) / 1000;
        if (!Number.isFinite(t) || !Number.isFinite(domain.min) || !Number.isFinite(domain.max)) return;
        this._tlCenterOnSort(domain.min + t * (domain.max - domain.min));
    });

    if (!cards.length) {
        const empty = document.createElement('p');
        empty.className = 'stm-tl-empty';
        empty.textContent = 'No cards yet — add an Event, run the Agent, or tag Library eras.';
        board.appendChild(empty);
        this._bindTimelineViewport(wrap, vert);
        return wrap;
    }

    for (const { card, place } of placed) {
        board.appendChild(this._buildTimelinePinEl(card, place, vert));
    }
    for (const { card } of dock) {
        dockList.appendChild(this._buildTimelineDockEl(card));
    }

    this._bindTimelineViewport(wrap, vert);
    return wrap;
}

/** Best-effort one-time upgrade of pre-rework 0..1 `timeRank` drags into an
 * absolute canonical-time coordinate, so old manually-placed cards don't
 * silently teleport into the dock the first time this loads. */
_tlMigrateLegacyRanks(db, cohort) {
    const legacy = (db.cards || []).filter(c =>
        c.timeManual && c.timeManualSort == null && c.timeRank != null && !this._isFolder(c, db));
    if (!legacy.length) return;
    const domain = this._timelineDomain(cohort);
    for (const c of legacy) {
        const r = Math.min(1, Math.max(0, Number(c.timeRank) || 0.5));
        c.timeManualSort = domain.min + r * (domain.max - domain.min);
        delete c.timeRank;
    }
    this._save(db);
}

_buildTimelinePinEl(card, place, vert) {
    const item = document.createElement('div');
    const selected = this._tlIsSelected(card.uid);
    item.className = 'stm-tl-item'
        + (selected || this._selectedUid === card.uid ? ' stm-tl-item--on' : '')
        + (selected ? ' stm-tl-item--sel' : '')
        + (card.timeLocked || isEventCard(card) ? ' stm-tl-item--locked' : '')
        + (card.virtual ? ' stm-tl-item--library' : '')
        + (isEventCard(card) ? ' stm-tl-item--event' : '')
        + (isEventCard(card) && card.eventScale === 'personal' ? ' stm-tl-item--event-personal' : '')
        + (place.manual ? ' stm-tl-item--manual' : '');
    item.dataset.uid = card.uid;
    if (card.virtual) item.dataset.libKey = card.sourceId;
    const key = place.key || 'unplaced';
    item.title = `${card.title || '(untitled)'} — ${key}`;
    if (card.virtual) {
        item.innerHTML = `
            <button type="button" class="stm-tl-tack" title="Library event"></button>
            <span class="stm-tl-stem"></span>
            <div class="stm-tl-pin stm-tl-pin--library">
                <div class="stm-tl-pin-bar">
                    <span class="stm-tl-pin-org">⌘ Lib</span>
                    <button type="button" class="stm-btn stm-tl-promote" data-a="promote-lib" title="Promote to Script card">＋</button>
                </div>
                <span class="stm-tl-pin-title">${esc(card.title || '(untitled)')}</span>
                <span class="stm-tl-pin-time">${esc(key)}</span>
            </div>`;
        item.querySelector('[data-a="promote-lib"]')?.addEventListener('click', e => {
            e.stopPropagation();
            this._promoteLibraryPin(card);
        });
    } else if (isEventCard(card)) {
        const scale = card.eventScale === 'personal' ? 'Personal' : 'World';
        const recur = card.eventRecurring
            ? (EVENT_RECUR_OPTS.find(o => o.id === card.eventRecur)?.label || 'Recurring')
            : '';
        const who = this._eventImpactLabel(card);
        item.innerHTML = `
            <button type="button" class="stm-tl-tack stm-tl-tack--event" title="Fixed event"></button>
            <span class="stm-tl-stem"></span>
            <div class="stm-tl-pin stm-tl-pin--event">
                <div class="stm-tl-pin-bar">
                    <span class="stm-tl-pin-org">${esc(scale)}${recur ? ` · ${esc(recur)}` : ''}</span>
                    <button type="button" class="stm-btn stm-tl-dockret" title="Take off the timeline">⇤</button>
                </div>
                <span class="stm-tl-pin-title">${esc(card.title || '(untitled)')}</span>
                <span class="stm-tl-pin-time">${esc(key)}${who && card.eventScale === 'personal' ? ` · ${esc(who.replace(/^Personal · /, ''))}` : ''}</span>
            </div>`;
        this._bindTimelinePin(item, card, vert);
        item.querySelector('.stm-tl-dockret')?.addEventListener('click', e => {
            e.preventDefault();
            e.stopPropagation();
            this._removeCardFromTimeline(card);
        });
    } else {
        const hasTime = !!this._parseCardTime(card);
        item.innerHTML = `
            <button type="button" class="stm-tl-tack" title="${card.timeLocked ? 'Locked to its true time' : 'Drag to nudge'}"></button>
            <span class="stm-tl-stem"></span>
            <div class="stm-tl-pin">
                <div class="stm-tl-pin-bar">
                    ${this._timelineLockButtonHTML(card, hasTime)}
                    <span class="stm-tl-pin-org">${esc(this._orgCode(card))}</span>
                    <button type="button" class="stm-btn stm-tl-dockret" title="Take off the timeline">⇤</button>
                </div>
                <span class="stm-tl-pin-title">${esc(card.title || '(untitled)')}</span>
                <span class="stm-tl-pin-time">${esc(key)}</span>
            </div>`;
        this._bindTimelinePin(item, card, vert);
        item.querySelector('.stm-tl-dockret')?.addEventListener('click', e => {
            e.preventDefault();
            e.stopPropagation();
            this._removeCardFromTimeline(card);
        });
    }
    return item;
}

_buildTimelineDockEl(card) {
    const chip = document.createElement('div');
    chip.className = 'stm-tl-dock-chip' + (isEventCard(card) ? ' stm-tl-dock-chip--event' : '');
    chip.dataset.uid = card.uid;
    const dated = !card.virtual && !!this._parseCardTime(card);
    chip.innerHTML = `
        <span class="stm-tl-dock-grip" title="Drag onto the line to place">⠿</span>
        <span class="stm-tl-dock-title">${esc(card.title || '(untitled)')}</span>
        <button type="button" class="stm-btn stm-tl-dock-place" title="${dated ? 'Put back on its true time' : 'Place at the centre of the current view'}">＋</button>
    `;
    chip.querySelector('.stm-tl-dock-title')?.addEventListener('click', () => {
        this._selectedUid = card.uid;
        this.bus?.emit('showtime.stateChanged');
    });
    chip.querySelector('.stm-tl-dock-place')?.addEventListener('click', e => {
        e.stopPropagation();
        this._tlPlaceFromDock(card, null);
    });
    chip.querySelector('.stm-tl-dock-grip')?.addEventListener('pointerdown', e => this._bindTimelineDockDrag(e, card));
    return chip;
}

/** Drag a dock chip onto the ruler; dropping outside the ruler cancels. */
_bindTimelineDockDrag(e, card) {
    if (e.button !== 0) return;
    e.preventDefault();
    const grip = e.currentTarget;
    grip.setPointerCapture?.(e.pointerId);
    const wrap = this._tlWrap;
    const vp = wrap?.querySelector('.stm-tl');
    const ghost = document.createElement('div');
    ghost.className = 'stm-tl-dock-ghost';
    ghost.textContent = card.title || '(untitled)';
    document.body.appendChild(ghost);
    const place = (x, y) => { ghost.style.left = `${x}px`; ghost.style.top = `${y}px`; };
    place(e.clientX, e.clientY);
    const inRect = (x, y, r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    const onMove = rafMove(ev => {
        place(ev.clientX, ev.clientY);
        const over = !!vp && inRect(ev.clientX, ev.clientY, vp.getBoundingClientRect());
        ghost.classList.toggle('stm-tl-dock-ghost--over', over);
    });
    const onUp = ev => {
        onMove.flush();
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        ghost.remove();
        if (vp && inRect(ev.clientX, ev.clientY, vp.getBoundingClientRect())) {
            const rect = vp.getBoundingClientRect();
            const vert = wrap._tlVert;
            const screenPx = vert ? (ev.clientY - rect.top) : (ev.clientX - rect.left);
            const sort = this._tlSortFromScreenPx(screenPx, this._tlZoomValue(), this._tlPan ?? 0);
            this._tlPlaceFromDock(card, sort);
        }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
}

/** `sort == null` restores a dated card to its true time, or places an
 * undated card at the centre of the current view. */
_tlPlaceFromDock(card, sort) {
    const db = this._db();
    const c = db.cards.find(x => x.uid === card.uid);
    if (!c) return;
    c.timelineOff = false;
    const hit = this._parseCardTime(c);
    if (sort == null && hit && Number.isFinite(hit.parsed.sort)) {
        c.timeManual = false;
        c.timeManualSort = null;
        c.timestamp = hit.parsed.sort;
        c.updatedAt = now();
        this._save(db);
        this._rerender();
        return;
    }
    let target = sort;
    if (target == null) {
        const wrap = this._tlWrap;
        const vp = wrap?.querySelector('.stm-tl');
        if (vp && this._tlAnchorSort != null) {
            const size = this._tlMetrics(vp, wrap._tlVert).size;
            target = this._tlSortFromScreenPx(size / 2, this._tlZoomValue(), this._tlPan ?? 0);
        } else {
            target = 0;
        }
    }
    c.timeManual = true;
    c.timeManualSort = target;
    c.updatedAt = now();
    this._save(db);
    this._rerender();
}

_removeCardFromTimeline(card) {
    const db = this._db();
    const c = db.cards.find(x => x.uid === card.uid);
    if (!c || this._isFolder(c, db)) return;
    c.timelineOff = true;
    c.timeManual = false;
    c.timeManualSort = null;
    c.updatedAt = now();
    this._save(db);
    this._rerender();
}

_promoteLibraryPin(pin) {
    if (!pin?.sourceId) return;
    const db = this._db();
    if (db.cards.some(c => c.sourceKind === 'library' && c.sourceId === pin.sourceId)) {
        alert('Already on the timeline as a Script card.');
        return;
    }
    this._addCard({
        title: pin.title,
        summary: pin.summary || '',
        timeKey: pin.timeKey || '',
        timeLocked: !!pin.timeKey,
        tags: ['library-event'],
        sourceKind: 'library',
        sourceId: pin.sourceId,
        keywordFacets: {
            location: [], objects: [], characters: [],
            datetime: pin.timeKey ? [pin.timeKey] : [],
        },
    });
    db.settings.view = 'timeline';
    this._save(db);
    this._rerender();
}

// ── Timeline viewport — pan / zoom / paint (Reputation-web style) ────────────

_tlMetrics(vp, vert) {
    return { size: Math.max(160, vert ? vp.clientHeight : vp.clientWidth) };
}

_tlBasePx(sort) {
    return (sort - this._tlAnchorSort) * this._tlPxPerUnit;
}

_tlScreenPx(sort, zoom, pan) {
    return this._tlBasePx(sort) * zoom + pan;
}

_tlSortFromScreenPx(px, zoom, pan) {
    return this._tlAnchorSort + (px - pan) / (this._tlPxPerUnit * zoom);
}

/** Fit-to-content baseline. Only recomputed on first mount, Home, or when the
 * cohort's family/orientation changes — never on every render — so panning
 * doesn't get yanked around as cards are added/edited. Viewport resizes
 * scale pan/pxPerUnit so an early 0-size paint doesn't leave a blank board. */
_tlEnsureAnchor(domain, vp, vert) {
    const familyKey = `${domain.family}|${domain.calendarScale || ''}`;
    const size = this._tlMetrics(vp, vert).size;
    if (this._tlAnchorSort != null && this._tlAnchorFamily === familyKey && this._tlAnchorVert === vert) {
        const prev = this._tlAnchorVpSize || 0;
        if (prev > 0 && size > 0 && prev !== size && this._tlPxPerUnit) {
            const ratio = size / prev;
            this._tlPxPerUnit *= ratio;
            this._tlPan = (this._tlPan ?? 0) * ratio;
            this._tlAnchorVpSize = size;
        }
        return;
    }
    const span = Math.max(1e-6, domain.max - domain.min);
    const marginFrac = 0.18;
    this._tlPxPerUnit = (size * (1 - marginFrac * 2)) / span;
    this._tlAnchorSort = domain.min;
    this._tlAnchorFamily = familyKey;
    this._tlAnchorVert = vert;
    this._tlAnchorVpSize = size;
    const zoom = this._tlZoomValue();
    let homeSort = (domain.min + domain.max) / 2;
    try {
        const present = this.getTimelinePresent();
        if (present && Number.isFinite(present.sort)
            && (present.scale === 'date') === (domain.family === 'date')) {
            homeSort = present.sort;
        }
    } catch { /* ignore */ }
    this._tlFocusSort = homeSort;
    this._tlPan = size / 2 - this._tlBasePx(homeSort) * zoom;
}

/** Soft bound that always includes content, the present marker, and extra sorts. */
_tlClampPan(pan, size, zoom, domain, extraSorts = []) {
    const sorts = [domain.min, domain.max, this._tlFocusSort];
    for (const s of extraSorts) {
        if (Number.isFinite(s)) sorts.push(s);
    }
    try {
        const present = this.getTimelinePresent();
        if (present && Number.isFinite(present.sort)
            && (present.scale === 'date') === (domain.family === 'date')) {
            sorts.push(present.sort);
        }
    } catch { /* ignore */ }
    const lo = Math.min(...sorts.filter(Number.isFinite));
    const hi = Math.max(...sorts.filter(Number.isFinite));
    const spanPx = Math.max(size, (hi - lo) * this._tlPxPerUnit * zoom);
    // Extra viewports at high zoom so a tight date window can still be panned.
    const slack = size * (TL_PAN_SLACK + Math.max(0, zoom - 1) * 2) + spanPx * 0.35;
    const minScreen = this._tlBasePx(lo) * zoom;
    const maxScreen = this._tlBasePx(hi) * zoom;
    const panMax = size + slack - minScreen;
    const panMin = -slack - maxScreen;
    return Math.max(panMin, Math.min(panMax, pan));
}

_bindTimelineViewport(wrap, vert) {
    const vp = wrap.querySelector('.stm-tl');
    if (!vp) return;
    vp.addEventListener('wheel', e => {
        e.preventDefault();
        // The wheel always zooms now (drag the ruler to pan) — so drilling from
        // years down to precise dates never gets hijacked into a pan mid-scroll.
        const dx = e.deltaX || 0;
        const dy = e.deltaY || 0;
        const raw = Math.abs(dy) >= Math.abs(dx) ? dy : dx;
        if (!raw) return;
        this._tlNudgeZoom(raw < 0 ? 1.14 : 1 / 1.14);
    }, { passive: false });
    vp.addEventListener('pointerdown', e => {
        if (e.button !== 0) return;
        if (e.target.closest('.stm-tl-pin, .stm-tl-tack, .stm-tl-stem')) return;
        const startClient = vert ? e.clientY : e.clientX;
        const basePan = this._tlPan ?? 0;
        let moved = false;
        vp.classList.add('stm-tl--panning');
        vp.setPointerCapture?.(e.pointerId);
        const onMove = rafMove(ev => {
            const cur = vert ? ev.clientY : ev.clientX;
            if (Math.abs(cur - startClient) > 2) moved = true;
            const z = this._tlZoomValue();
            const size = this._tlMetrics(vp, vert).size;
            const domain = wrap._tlDomain || this._timelineDomain(wrap._tlCards || []);
            this._tlPan = this._tlClampPan(basePan + (cur - startClient), size, z, domain);
            this._tlRepaint({ light: true });
        });
        const onUp = () => {
            onMove.flush();
            vp.classList.remove('stm-tl--panning');
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            if (!moved) this._tlClearSelection();
            const z = this._tlZoomValue();
            const size = this._tlMetrics(vp, vert).size;
            this._tlFocusSort = this._tlSortFromScreenPx(size / 2, z, this._tlPan);
            this._tlRepaint();
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
    });
    if (typeof ResizeObserver !== 'undefined') {
        this._tlRo?.disconnect();
        this._tlRo = new ResizeObserver(() => this._tlRepaint());
        this._tlRo.observe(vp);
    }
    requestAnimationFrame(() => this._tlRepaint());
}

_tlSyncScrubber(wrap, domain, size, zoom) {
    const scrub = wrap?.querySelector('[data-role="tl-scrub"]');
    if (!scrub || !domain || !(domain.max > domain.min)) return;
    const sort = Number.isFinite(this._tlFocusSort)
        ? this._tlFocusSort
        : this._tlSortFromScreenPx(size / 2, zoom, this._tlPan);
    const t = (sort - domain.min) / (domain.max - domain.min);
    const next = String(Math.round(Math.max(0, Math.min(1, t)) * 1000));
    if (scrub.value !== next) scrub.value = next;
}

/**
 * Schedule a timeline paint. Coalesces to one rAF.
 * `light: true` skips pin packing (pan scrubbing); ticks still rebuild so
 * high zoom can keep a populated ruler while the view slides.
 */
_tlRepaint(opts = {}) {
    const prev = this._tlRepaintPending || {};
    this._tlRepaintPending = {
        forceAnchor: !!(prev.forceAnchor || opts.forceAnchor),
        // Once a full paint is queued, keep it full until it runs.
        light: prev.light !== false && opts.light === true,
    };
    if (this._tlRaf) return;
    this._tlRaf = requestAnimationFrame(() => {
        this._tlRaf = 0;
        const o = this._tlRepaintPending || {};
        this._tlRepaintPending = null;
        this._tlRepaintNow(o);
    });
}

/** Cheap re-paint: repositions ticks/ranges/pins from current pan+zoom. */
_tlRepaintNow({ forceAnchor = false, light = false } = {}) {
    const wrap = this._tlWrap;
    if (!wrap?.isConnected) return;
    const vp = wrap.querySelector('.stm-tl');
    const board = wrap.querySelector('.stm-tl-board');
    if (!vp || !board) return;
    const vert = wrap._tlVert;
    const cards = wrap._tlCards || [];
    const domain = this._timelineDomain(cards);
    wrap._tlDomain = domain;
    if (forceAnchor) this._tlAnchorSort = null;
    this._tlEnsureAnchor(domain, vp, vert);
    const size = this._tlMetrics(vp, vert).size;
    // Refresh the dynamic zoom ceiling for this domain/size before clamping the
    // current zoom against it (so a wide range can be driven down to fine dates).
    this._tlMaxZoomCached = this._tlComputeMaxZoom(size, domain);
    const zoom = this._tlZoomValue();
    this._tlPan = this._tlClampPan(this._tlPan ?? 0, size, zoom, domain);
    this._tlSyncScrubber(wrap, domain, size, zoom);

    // The scale-name label is written by _tlPaintTicksAndNow (it knows the
    // current major unit); the light path below also re-runs that painter.

    if (!light) {
        this._tlPaintTicksAndNow(board, domain, vp, vert, zoom);
        this._tlPaintRanges(board, cards, domain, vert, zoom);
        const pinItems = [];
        board.querySelectorAll('.stm-tl-item').forEach(item => {
            const card = cards.find(c => c.uid === item.dataset.uid);
            if (!card) return;
            const place = this._timelinePlace(card, cards, domain);
            if (place.dock || place.sort == null) return;
            pinItems.push({ item, card, place });
        });
        this._tlPackPinLayout(pinItems, zoom, vert);
        for (const { item, place } of pinItems) {
            this._tlPositionPin(item, place, vert, zoom);
        }
        this._tlSyncSelectionClasses(board);
        return;
    }

    // Light path: rebuild ticks for the new window (high zoom paints only
    // the visible slice, so sliding stale marks leaves a blank ruler), then
    // slide existing ranges/pins without re-packing.
    this._tlPaintTicksAndNow(board, domain, vp, vert, zoom);
    board.querySelectorAll('.stm-tl-range').forEach(el => {
        const a = Number(el.dataset.sortA);
        const b = Number(el.dataset.sortB);
        if (!Number.isFinite(a) || !Number.isFinite(b)) return;
        const pa = this._tlScreenPx(a, zoom, this._tlPan);
        const pb = this._tlScreenPx(b, zoom, this._tlPan);
        const lo = Math.min(pa, pb);
        const hi = Math.max(pa, pb);
        if (vert) { el.style.top = `${lo}px`; el.style.height = `${Math.max(2, hi - lo)}px`; el.style.left = '50%'; }
        else { el.style.left = `${lo}px`; el.style.width = `${Math.max(2, hi - lo)}px`; el.style.top = '50%'; }
        el.hidden = hi < -40 || lo > size + 40;
    });
    board.querySelectorAll('.stm-tl-item').forEach(item => {
        const sort = Number(item.dataset.sort);
        if (!Number.isFinite(sort)) return;
        const side = Number(item.dataset.side) || 1;
        const stem = Number(item.dataset.stem) || TL_PIN_BASE_STEM + 24;
        this._tlPositionPin(item, {
            sort,
            side,
            stem,
            shift: 0,
            lane: Number(item.dataset.lane) || side * 0.4,
            columnPx: Number.isFinite(Number(item.dataset.columnPx)) ? Number(item.dataset.columnPx) : null,
            tackLead: item.querySelector('.stm-tl-tack')?.hidden === false,
            tackCount: Number(item.querySelector('.stm-tl-tack')?.dataset.count) || 1,
        }, vert, zoom);
    });
}

_tlPaintTicksAndNow(board, domain, vp, vert, zoom) {
    const host = board.querySelector('.stm-tl-ticks');
    const nowEl = board.querySelector('.stm-tl-now');
    const size = this._tlMetrics(vp, vert).size;
    const cal = this._cal();
    const show = this._tlShow();
    const candidates = TL_ZOOM.filter(z => show[z.id]); // coarsest → finest
    const unitScale = domain.family === 'date' ? 'date' : (domain.calendarScale || 'day');
    const effPxPerUnit = this._tlPxPerUnit * zoom;
    const unitPx = (z) => timelineUnitSort(z.id, unitScale, cal) * effPxPerUnit;

    // Viewport-driven budget: pick a unit (and optional step multiplier) so a
    // limited number of marks span the whole visible axis — never a dense comb
    // that runs out mid-ruler.
    const pad = 12;
    const visMin = this._tlSortFromScreenPx(-pad, zoom, this._tlPan);
    const visMax = this._tlSortFromScreenPx(size + pad, zoom, this._tlPan);
    const span = Math.max(1e-9, visMax - visMin);
    const targetMajorPx = Math.max(TL_MAJOR_MIN_PX, size / TL_MAJOR_BUDGET);

    let major = candidates[0] || TL_ZOOM[0];
    for (let i = candidates.length - 1; i >= 0; i--) {
        if (unitPx(candidates[i]) >= targetMajorPx * 0.85) {
            major = candidates[i];
            break;
        }
    }
    const majorUnit = timelineUnitSort(major.id, unitScale, cal);
    let majorStep = 1;
    const majorPx0 = majorUnit * effPxPerUnit;
    if (majorPx0 > 0 && majorPx0 < TL_MAJOR_MIN_PX) {
        majorStep = Math.max(1, Math.ceil(TL_MAJOR_MIN_PX / majorPx0));
    }
    const approxMajors = span / (majorUnit * majorStep);
    if (approxMajors > TL_MAJOR_BUDGET * 1.35) {
        majorStep = Math.max(majorStep, Math.ceil(approxMajors / TL_MAJOR_BUDGET));
    }

    // Zoom readout reflects the *scale* you're at (Years/Seasons/Months/…), not
    // a bare percentage — zooming reads as "how precise are the dates" instead
    // of an opaque number. Exact % is kept in the tooltip.
    const zoomLab = this._panel?.querySelector('[data-role="tl-zoom-label"]');
    if (zoomLab) {
        zoomLab.textContent = major.label;
        zoomLab.title = `${major.label} scale · ${Math.round(zoom * 100)}%`;
    }

    const majorIdx = candidates.findIndex(z => z.id === major.id);
    let minor = null;
    let minorStep = 1;
    if (majorIdx >= 0 && majorIdx < candidates.length - 1) {
        const next = candidates[majorIdx + 1];
        const mPx = unitPx(next);
        if (mPx >= TL_MINOR_MIN_PX) {
            const approxMinors = span / timelineUnitSort(next.id, unitScale, cal);
            if (approxMinors <= TL_MINOR_BUDGET * 1.25) {
                minor = next;
            } else if (mPx * Math.ceil(approxMinors / TL_MINOR_BUDGET) >= TL_MINOR_MIN_PX) {
                minor = next;
                minorStep = Math.max(1, Math.ceil(approxMinors / TL_MINOR_BUDGET));
            }
        }
    }

    if (host) {
        host.innerHTML = '';
        if (!(majorUnit > 0) || !Number.isFinite(visMin) || !Number.isFinite(visMax)) {
            /* skip ticks */
        } else {
            const inView = (px) => px >= -24 && px <= size + 24;
            const advance = (cur, zoomId, steps) => {
                let next = cur;
                for (let s = 0; s < steps; s++) {
                    const n = addCalendarSort(next, zoomId, unitScale, cal);
                    if (!(n > next)) return next;
                    next = n;
                }
                return next;
            };
            const walk = (zoomId, steps, budget, fn) => {
                let cur = alignCalendarSort(visMin, zoomId, unitScale, cal);
                const stepN = Math.max(1, steps);
                // Linear sort-space snap is valid for fictional calendars, but
                // Earth dates sit at EARTH_EPOCH + ms — flooring that mix
                // lands ticks off the real month/day/hour.
                if (stepN > 1 && unitScale !== 'date') {
                    const u = timelineUnitSort(zoomId, unitScale, cal);
                    const k = Math.floor(cur / (u * stepN));
                    cur = k * u * stepN;
                    if (cur < visMin - u * stepN) cur = advance(cur, zoomId, stepN);
                }
                let n = 0;
                while (cur <= visMax && n < budget) {
                    fn(cur);
                    const next = advance(cur, zoomId, stepN);
                    if (!(next > cur)) break;
                    cur = next;
                    n++;
                }
            };

            if (minor) {
                const minorUnit = timelineUnitSort(minor.id, unitScale, cal);
                walk(minor.id, minorStep, TL_MINOR_BUDGET + 4, (cur) => {
                    if (Math.abs(cur - alignCalendarSort(cur, major.id, unitScale, cal)) < minorUnit * 0.25) return;
                    const px = this._tlScreenPx(cur, zoom, this._tlPan);
                    if (!inView(px)) return;
                    const mark = document.createElement('span');
                    mark.className = 'stm-tl-tick stm-tl-tick--minor';
                    mark.dataset.sort = String(cur);
                    mark.innerHTML = `<i></i>`;
                    if (vert) { mark.style.top = `${px}px`; mark.style.left = '50%'; }
                    else { mark.style.left = `${px}px`; mark.style.top = '50%'; }
                    host.appendChild(mark);
                });
            }

            let lastLabelPx = -Infinity;
            walk(major.id, majorStep, TL_MAJOR_BUDGET + 6, (cur) => {
                const px = this._tlScreenPx(cur, zoom, this._tlPan);
                if (!inView(px)) return;
                const label = formatTimelineTick(cur, major.id, unitScale, cal);
                const showLabel = (px - lastLabelPx) >= TL_LABEL_MIN_PX && !!label;
                const mark = document.createElement('span');
                mark.className = 'stm-tl-tick stm-tl-tick--major'
                    + (showLabel ? ' stm-tl-tick--label stm-tl-tick--below' : '');
                mark.dataset.sort = String(cur);
                mark.innerHTML = showLabel ? `<i></i><b>${esc(label)}</b>` : `<i></i>`;
                if (vert) { mark.style.top = `${px}px`; mark.style.left = '50%'; }
                else { mark.style.left = `${px}px`; mark.style.top = '50%'; }
                host.appendChild(mark);
                if (showLabel) lastLabelPx = px;
            });
        }
    }
    if (nowEl) {
        this._tlPlaceNowEl(nowEl, domain, vp, vert, zoom, size);
    }
}

_tlPlaceNowEl(nowEl, domain, vp, vert, zoom, size) {
    const present = this.getTimelinePresent();
    const presentFamily = present && present.scale === 'date' ? 'date' : 'calendar';
    if (present && presentFamily === domain.family && Number.isFinite(present.sort)) {
        const px = this._tlScreenPx(present.sort, zoom, this._tlPan);
        nowEl.hidden = px < -40 || px > size + 40;
        nowEl.title = present.key
            ? `Present · ${present.key}${present.source === 'set' ? ' (set)' : ''}`
            : 'Present';
        if (vert) { nowEl.style.top = `${px}px`; nowEl.style.left = '50%'; }
        else { nowEl.style.left = `${px}px`; nowEl.style.top = '50%'; }
    } else {
        nowEl.hidden = true;
    }
}

/**
 * Stack overlapping pins on orthogonal stems (vertical on Broad, horizontal on
 * Condensed). No sideways stagger / diagonals — if dates collide, cards pile
 * outward from the axis. Near-identical axis marks collapse to one chip.
 */
_tlPackPinLayout(pinItems, zoom, vert) {
    if (!pinItems?.length) return;
    const ordered = [...pinItems].sort((a, b) => (a.place.sort ?? 0) - (b.place.sort ?? 0)
        || String(a.card.uid).localeCompare(String(b.card.uid)));
    for (const row of ordered) {
        row._px = this._tlScreenPx(row.place.sort, zoom, this._tlPan ?? 0);
    }
    const clusters = [];
    for (const row of ordered) {
        const last = clusters[clusters.length - 1];
        if (last && Math.abs(row._px - last[last.length - 1]._px) < TL_CLUSTER_PX) last.push(row);
        else clusters.push([row]);
    }
    for (const cluster of clusters) {
        const xs = cluster.map(r => r._px);
        const span = Math.max(...xs) - Math.min(...xs);
        const mergeMarks = span <= TL_TACK_MERGE_PX && cluster.length > 1;
        const columnPx = mergeMarks
            ? xs.reduce((a, b) => a + b, 0) / xs.length
            : null;

        for (let i = 0; i < cluster.length; i++) {
            const row = cluster[i];
            const size = this._tlCachedPinSize(row.item);
            const pinH = size.h;
            const pinW = size.w;
            const manual = Number(row.card.timeLane);
            let side;
            if (Number.isFinite(manual) && manual !== 0) side = manual < 0 ? -1 : 1;
            else side = (i % 2 === 0) ? -1 : 1;

            let stem = TL_PIN_BASE_STEM;
            for (let j = 0; j < i; j++) {
                const other = cluster[j];
                if ((other.place.side ?? 0) !== side) continue;
                const oSize = this._tlCachedPinSize(other.item);
                const otherSize = vert ? oSize.w : oSize.h;
                stem = Math.max(stem, (other.place.stem || TL_PIN_BASE_STEM) + otherSize + TL_PIN_STACK_GAP);
            }
            const vp = row.item.closest('.stm-tl');
            const room = vert
                ? Math.max(72, ((vp?.clientWidth || 400) / 2) - pinW - 10)
                : Math.max(72, ((vp?.clientHeight || 300) / 2) - pinH - 10);
            stem = Math.min(stem, room);

            row.place.side = side;
            row.place.stem = stem;
            row.place.shift = 0;
            row.place.columnPx = columnPx;
            row.place.lane = side * Math.min(0.9, 0.2 + stem / Math.max(120, room));
            row.place.tackLead = mergeMarks ? i === 0 : true;
            row.place.tackCount = mergeMarks ? cluster.length : 1;
        }
    }
}

_tlCachedPinSize(item) {
    this._tlPinSizeCache ??= new WeakMap();
    let s = this._tlPinSizeCache.get(item);
    if (s) return s;
    const pinEl = item.querySelector('.stm-tl-pin');
    s = {
        h: pinEl?.offsetHeight || 58,
        w: pinEl?.offsetWidth || 148,
    };
    this._tlPinSizeCache.set(item, s);
    return s;
}

_tlPaintRanges(board, cards, domain, vert, zoom) {
    const host = board.querySelector('.stm-tl-ranges');
    if (!host) return;
    host.innerHTML = '';
    for (const card of cards || []) {
        const hit = this._parseCardTime(card);
        const range = hit?.range;
        if (!range || range.point) continue;
        const family = hit.parsed.scale === 'date' ? 'date' : 'calendar';
        if (family !== domain.family) continue;
        const a = this._tlScreenPx(range.start.sort, zoom, this._tlPan);
        const b = this._tlScreenPx(range.end.sort, zoom, this._tlPan);
        const lo = Math.min(a, b), hi = Math.max(a, b);
        const bar = document.createElement('span');
        bar.className = 'stm-tl-range' + (card.virtual ? ' stm-tl-range--library' : '');
        bar.title = this._cardTimeKey(card);
        bar.dataset.sortA = String(range.start.sort);
        bar.dataset.sortB = String(range.end.sort);
        if (vert) { bar.style.top = `${lo}px`; bar.style.height = `${Math.max(2, hi - lo)}px`; bar.style.left = '50%'; }
        else { bar.style.left = `${lo}px`; bar.style.width = `${Math.max(2, hi - lo)}px`; bar.style.top = '50%'; }
        host.appendChild(bar);
    }
}

_tlPositionPin(item, place, vert, zoom) {
    const pin = item.querySelector('.stm-tl-pin');
    const stem = item.querySelector('.stm-tl-stem');
    const tack = item.querySelector('.stm-tl-tack');
    const cached = this._tlCachedPinSize(item);
    const pinH = cached.h;
    const pinW = cached.w;
    const truePx = this._tlScreenPx(place.sort, zoom, this._tlPan ?? 0);
    const screenPx = Number.isFinite(place.columnPx) ? place.columnPx : truePx;

    let side = place.side;
    if (side !== -1 && side !== 1) {
        const lane = Number(place.lane);
        side = (Number.isFinite(lane) && lane < 0) ? -1 : 1;
    }
    const stemLen = Math.max(TL_PIN_BASE_STEM, Number(place.stem) || Math.abs(Number(place.lane) || 0.4) * 120);

    item.style.zIndex = String(4 + Math.min(12, Math.round(stemLen / 18)));

    if (tack) {
        const lead = place.tackLead !== false;
        const count = Math.max(1, Number(place.tackCount) || 1);
        tack.hidden = !lead;
        tack.classList.toggle('stm-tl-tack--cluster', lead && count > 1);
        if (lead && count > 1) {
            tack.dataset.count = String(count);
            tack.title = `${count} events at this mark`;
        } else {
            delete tack.dataset.count;
        }
    }

    if (vert) {
        item.style.left = '50%';
        item.style.top = `${screenPx}px`;
        item.style.transform = 'translate(-50%, -50%)';
        const leftSide = side < 0;
        const dx = leftSide ? -(stemLen + pinW) : stemLen;
        if (pin) pin.style.transform = `translate(${dx}px, -50%)`;
        if (stem) {
            stem.style.top = '0';
            stem.style.height = '2px';
            stem.style.width = `${stemLen}px`;
            stem.style.left = `${leftSide ? -stemLen : 0}px`;
            stem.style.transformOrigin = '';
            stem.style.transform = 'translateY(-50%)';
        }
    } else {
        item.style.top = '50%';
        item.style.left = `${screenPx}px`;
        item.style.transform = 'translate(-50%, -50%)';
        const above = side < 0;
        const dy = above ? -(stemLen + pinH) : stemLen;
        if (pin) pin.style.transform = `translate(-50%, ${dy}px)`;
        if (stem) {
            stem.style.left = '0';
            stem.style.width = '2px';
            stem.style.height = `${stemLen}px`;
            stem.style.top = `${above ? -stemLen : 0}px`;
            stem.style.transformOrigin = '';
            stem.style.transform = 'none';
        }
    }
    item.dataset.sort = String(place.sort);
    item.dataset.lane = String(side * Math.min(0.9, 0.25 + stemLen / 200));
    item.dataset.stem = String(stemLen);
    item.dataset.shift = '0';
    item.dataset.side = String(side);
}

_bindTimelinePin(item, card, vert) {
    const tack = item.querySelector('.stm-tl-tack');
    const pin = item.querySelector('.stm-tl-pin');

    const grab = e => {
        if (e.button !== 0) return;
        if (card.timeLocked) {
            // Still allow multi-select toggle on locked cards.
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                e.stopPropagation();
                this._tlToggleSelect(card.uid, { additive: true });
            }
            return;
        }
        e.preventDefault();
        e.stopPropagation();
        const additive = e.ctrlKey || e.metaKey;
        if (additive) {
            this._tlToggleSelect(card.uid, { additive: true });
            return;
        }
        // Clicking a non-selected pin starts a fresh selection; clicking inside
        // an existing multi-selection keeps the group for a group-drag.
        if (!this._tlIsSelected(card.uid) || (this._tlSelectedUids?.size || 0) <= 1) {
            this._tlSelectOnly(card.uid);
        }

        const handle = e.currentTarget;
        handle.setPointerCapture?.(e.pointerId);
        const startX = e.clientX, startY = e.clientY;
        let moved = false;
        const board = item.closest('.stm-tl-board');
        const groupUids = this._tlDragGroupUids(card.uid);
        const groupItems = groupUids
            .map(uid => [...(board?.querySelectorAll('.stm-tl-item') || [])].find(el => el.dataset.uid === uid))
            .filter(Boolean);
        const startSorts = new Map(groupItems.map(el => [el.dataset.uid, Number(el.dataset.sort)]));
        const primaryStart = startSorts.get(card.uid);
        item.classList.add('stm-tl-item--drag');
        groupItems.forEach(el => el.classList.add('stm-tl-item--drag'));

        const onMove = rafMove(ev => {
            if (Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) > 3) moved = true;
            const vp = item.closest('.stm-tl');
            if (!vp || !Number.isFinite(primaryStart)) return;
            const rect = vp.getBoundingClientRect();
            const screenPx = vert ? (ev.clientY - rect.top) : (ev.clientX - rect.left);
            const zoom = this._tlZoomValue();
            const newPrimary = this._tlSortFromScreenPx(screenPx, zoom, this._tlPan ?? 0);
            const delta = newPrimary - primaryStart;
            for (const el of groupItems) {
                const base = startSorts.get(el.dataset.uid);
                if (!Number.isFinite(base)) continue;
                const sort = base + delta;
                const side = Number(el.dataset.side) || (Number(el.dataset.lane) < 0 ? -1 : 1);
                const stem = Number(el.dataset.stem) || TL_PIN_BASE_STEM + 24;
                this._tlPositionPin(el, { sort, side, stem, shift: 0, lane: side * 0.4 }, vert, zoom);
            }
        });
        const onUp = () => {
            onMove.flush();
            handle.removeEventListener('pointermove', onMove);
            handle.removeEventListener('pointerup', onUp);
            groupItems.forEach(el => el.classList.remove('stm-tl-item--drag'));
            if (moved) {
                const db = this._db();
                let dirty = false;
                for (const el of groupItems) {
                    const c = db.cards.find(x => x.uid === el.dataset.uid);
                    if (!c || c.timeLocked || c.virtual) continue;
                    const sort = Number(el.dataset.sort);
                    if (!Number.isFinite(sort)) continue;
                    c.timeManual = true;
                    c.timeManualSort = sort;
                    c.updatedAt = now();
                    dirty = true;
                }
                if (dirty) this._save(db);
                this._tlPinSizeCache = new WeakMap();
                this._tlRepaint();
            } else {
                this._selectedUid = card.uid;
                this.bus?.emit('showtime.stateChanged');
            }
        };
        handle.addEventListener('pointermove', onMove);
        handle.addEventListener('pointerup', onUp);
    };

    tack?.addEventListener('pointerdown', grab);
    pin?.addEventListener('pointerdown', e => {
        if (e.target.closest('.stm-tl-lock, .stm-tl-dockret')) return;
        grab(e);
    });
    item.querySelector('.stm-tl-lock')?.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        this._toggleTimelineLock(card);
    });
    item.addEventListener('dblclick', e => {
        if (e.target.closest('.stm-tl-lock, .stm-tl-dockret')) return;
        e.preventDefault();
        const db2 = this._db();
        db2.settings.view = 'tree';
        this._selectedUid = card.uid;
        this._focusedUid = card.uid;
        this._editingCardUid = card.uid;
        this._save(db2);
        this._rerender();
    });
}

_tlEnsureSelection() {
    if (!(this._tlSelectedUids instanceof Set)) this._tlSelectedUids = new Set();
    return this._tlSelectedUids;
}

_tlIsSelected(uid) {
    return this._tlEnsureSelection().has(uid);
}

_tlSelectOnly(uid) {
    const set = this._tlEnsureSelection();
    set.clear();
    if (uid) set.add(uid);
    this._selectedUid = uid || null;
    this._tlSyncSelectionClasses(this._tlWrap?.querySelector('.stm-tl-board'));
}

_tlToggleSelect(uid, { additive = false } = {}) {
    const set = this._tlEnsureSelection();
    if (!additive) {
        this._tlSelectOnly(uid);
        return;
    }
    if (set.has(uid)) set.delete(uid);
    else set.add(uid);
    this._selectedUid = set.has(uid) ? uid : ([...set][0] || null);
    this._tlSyncSelectionClasses(this._tlWrap?.querySelector('.stm-tl-board'));
}

_tlClearSelection() {
    const set = this._tlEnsureSelection();
    if (!set.size) return;
    set.clear();
    this._tlSyncSelectionClasses(this._tlWrap?.querySelector('.stm-tl-board'));
}

_tlSyncSelectionClasses(board) {
    if (!board) return;
    const set = this._tlEnsureSelection();
    board.querySelectorAll('.stm-tl-item').forEach(el => {
        const on = set.has(el.dataset.uid) || el.dataset.uid === this._selectedUid;
        const sel = set.has(el.dataset.uid);
        el.classList.toggle('stm-tl-item--on', on);
        el.classList.toggle('stm-tl-item--sel', sel && set.size > 0);
    });
}

/** Uids moved together when dragging `uid` (unlocked Script cards only). */
_tlDragGroupUids(uid) {
    const set = this._tlEnsureSelection();
    const db = this._db();
    const candidates = set.has(uid) && set.size > 1 ? [...set] : [uid];
    return candidates.filter(id => {
        const c = db.cards.find(x => x.uid === id);
        return c && !c.timeLocked && !c.virtual;
    });
}

// ── Tree Panel ────────────────────────────────────────────────

_buildTreePanel(db) {
    const panel = document.createElement('div');
    panel.className = 'stm-tree-panel';
    const tw = Number(db.settings.treeWidth) || 220;
    panel.style.width = tw + 'px';

    // "All" row
    const allRow = document.createElement('div');
    allRow.className = 'stm-tree-item' + (!this._selectedUid ? ' active' : '');
    allRow.innerHTML = `
        <span class="stm-ti-arrow stm-ti-arrow--hidden">▶</span>
        <span class="stm-ti-icon">🗂</span>
        <span class="stm-ti-label">All Cards</span>
        <span class="stm-tree-item-count">${db.cards.length}</span>`;
    allRow.addEventListener('click', () => {
        this._selectedUid = null;
        this._focusedUid = null;
        this._editingCardUid = null;
        this._rerender();
    });
    allRow.addEventListener('dragover', e => {
        e.preventDefault();
        allRow.classList.add('stm-drop-inside');
    });
    allRow.addEventListener('dragleave', () => allRow.classList.remove('stm-drop-inside'));
    allRow.addEventListener('drop', e => {
        e.preventDefault();
        allRow.classList.remove('stm-drop-inside');
        const fromUid = e.dataTransfer.getData('text/plain');
        const db = this._db();
        const from = db.cards.find(c => c.uid === fromUid);
        if (!from) return;
        if (!this._applyLevelForParent(from, null)) return;
        const roots = db.cards.filter(c => !c.parentUid && c.uid !== fromUid);
        from.sortIndex = roots.reduce((m, c) => Math.max(m, c.sortIndex ?? 0), -1) + 1;
        from.updatedAt = now();
        this._save(db);
        this._rerender();
    });
    panel.appendChild(allRow);

    const org = document.createElement('div');
    org.className = 'stm-org-bar';
    const checkedN = this._checkedUids.size;
    const scheme = this._orgScheme();
    org.innerHTML = `
        <select class="stm-org-scheme" title="Organization code style">
            <option value="show" ${scheme === 'show' ? 'selected' : ''}>S01E017</option>
            <option value="book" ${scheme === 'book' ? 'selected' : ''}>B.1-Ch.17</option>
            <option value="custom" ${scheme === 'custom' ? 'selected' : ''}>Custom</option>
        </select>
        <select class="stm-org-sort" title="Sort or cluster">
            <option value="">Arrange…</option>
            <optgroup label="Sort">
                <option value="folders">Folders first</option>
                <option value="name-asc">Name A–Z</option>
                <option value="name-desc">Name Z–A</option>
                <option value="new">Newest</option>
                <option value="old">Oldest</option>
                <option value="location">By location</option>
                <option value="datetime">By date/time</option>
                <option value="characters">By character</option>
                <option value="objects">By object</option>
            </optgroup>
            <optgroup label="Cluster into folders">
                <option value="cluster:location">Location</option>
                <option value="cluster:datetime">Date/Time</option>
                <option value="cluster:characters">Character</option>
                <option value="cluster:objects">Object</option>
            </optgroup>
        </select>
        <button type="button" class="stm-btn stm-org-select" title="Select or deselect every visible item">${esc(this._selectAllLabel())}</button>
        <button type="button" class="stm-btn stm-org-move" ${checkedN ? '' : 'disabled'} title="Move selected">Move</button>
        <button type="button" class="stm-btn stm-org-del" ${checkedN ? '' : 'disabled'} title="Delete selected">Del</button>
        <span class="stm-org-count">${checkedN || ''}</span>`;
    org.querySelector('.stm-org-scheme').addEventListener('change', e => {
        const db2 = this._db();
        const v = e.target.value;
        db2.settings.orgScheme = (v === 'book' || v === 'custom') ? v : 'show';
        this._save(db2);
        this._rerender();
    });
    org.querySelector('.stm-org-sort').addEventListener('change', e => {
        const mode = e.target.value;
        if (!mode) return;
        if (mode.startsWith('cluster:')) this._clusterByFacet(mode.slice(8));
        else this._sortVisible(mode);
        this._rerender();
    });
    org.querySelector('.stm-org-select').addEventListener('click', () => this._toggleSelectAll());
    org.querySelector('.stm-org-move').addEventListener('click', () => this._openBulkMoveDialog());
    org.querySelector('.stm-org-del').addEventListener('click', () => {
        if (!this._checkedUids.size) return;
        if (!confirm(`Delete ${this._checkedUids.size} selected item(s)? Children of deleted folders are reparented.`)) return;
        this._bulkDelete(this._checkedUids);
        this._rerender();
    });
    panel.appendChild(org);

    if (this._keywordFilter?.value) {
        const chip = document.createElement('div');
        chip.className = 'stm-filter-chip';
        chip.innerHTML = `Filter: <strong>${esc(facetTag(this._keywordFilter.facet))} | ${esc(this._keywordFilter.value)}</strong> <button type="button" class="stm-btn" data-clear-filter>✕</button>`;
        chip.querySelector('[data-clear-filter]').addEventListener('click', () => {
            this._keywordFilter = null;
            this._rerender();
        });
        panel.appendChild(chip);
    }

    const divider = document.createElement('div');
    divider.className = 'stm-tree-divider';
    panel.appendChild(divider);

    // Actual card hierarchy
    this._buildTree(db.cards).forEach(node =>
        panel.appendChild(this._buildTreeNode(node, 0, db))
    );

    // Add folder button
    const addRow = document.createElement('div');
    addRow.className = 'stm-tree-add-row';
    const folderParent = this._resolveFolderCreateParent();
    const canAddFolder = !!this._nextLevelId(folderParent, { forFolder: true });
    addRow.innerHTML = `<button class="stm-btn stm-tree-add-btn" ${canAddFolder ? '' : 'disabled'} title="${canAddFolder ? 'New folder' : 'Max folder depth for this hierarchy — add a level in Configure'}">＋ Folder</button>`;
    addRow.querySelector('button').addEventListener('click', () => {
        if (!canAddFolder) return;
        this._openNewFolderDialog();
    });
    panel.appendChild(addRow);

    return panel;
}

_buildTree(cards) {
    const map = new Map(cards.map(c => [c.uid, { card: c, children: [] }]));
    const roots = [];
    for (const c of cards) {
        if (c.parentUid && map.has(c.parentUid)) {
            map.get(c.parentUid).children.push(map.get(c.uid));
        } else {
            roots.push(map.get(c.uid));
        }
    }
    const byIndex = (a, b) =>
        (a.card.sortIndex ?? 0) - (b.card.sortIndex ?? 0) || a.card.createdAt - b.card.createdAt;
    for (const node of map.values()) node.children.sort(byIndex);
    roots.sort(byIndex);
    return roots;
}

_buildTreeNode(node, depth, db) {
    const { card, children } = node;
    if (this._keywordFilter?.value && !this._cardMatchesFilter(card)) {
        const wrap = document.createElement('div');
        wrap.hidden = true;
        return wrap;
    }
    const isSelected  = this._selectedUid === card.uid;
    const isExpanded  = this._expandedUids.has(card.uid);
    const hasChildren = children.length > 0;

    const wrapper = document.createElement('div');
    wrapper.className = 'stm-tree-node';

    const item = document.createElement('div');
    const isFolder = this._isFolder(card, db);
    item.className = 'stm-tree-item'
        + (isSelected ? ' active' : '')
        + (isFolder ? ' stm-tree-folder' : ' stm-tree-card');
    item.style.paddingLeft = (10 + depth * 16) + 'px';
    item.innerHTML = `
        <span class="stm-ti-arrow${hasChildren ? '' : ' stm-ti-arrow--hidden'}${isExpanded ? ' stm-ti-arrow--open' : ''}">▶</span>
        <input type="checkbox" class="stm-ti-check" ${this._checkedUids.has(card.uid) ? 'checked' : ''} title="Select for bulk actions">
        <span class="stm-ti-icon">${this._treeIcon(card, db, hasChildren)}</span>
        <span class="stm-ti-org">${esc(this._orgCode(card))}</span>
        <span class="stm-ti-label" title="${esc(card.title)}">${esc(card.title || '(untitled)')}</span>
        ${hasChildren ? `<span class="stm-tree-item-count">${children.length}</span>` : ''}
        ${isFolder ? '' : this._pinButtonHTML(card, { tree: true })}
        <button class="stm-ti-rename" title="Rename">✎</button>
        <button class="stm-ti-delete" title="Delete">✕</button>`;

    item.draggable = true;
    item.dataset.uid = card.uid;
    this._bindTreeDrag(item, card);

    item.querySelector('.stm-ti-check').addEventListener('click', e => e.stopPropagation());
    item.querySelector('.stm-ti-check').addEventListener('change', e => {
        if (e.target.checked) this._checkedUids.add(card.uid);
        else this._checkedUids.delete(card.uid);
        const bar = this._panel?.querySelector('.stm-org-count');
        const n = this._checkedUids.size;
        if (bar) bar.textContent = n || '';
        this._panel?.querySelectorAll('.stm-org-move, .stm-org-del').forEach(b => { b.disabled = !n; });
        const selBtn = this._panel?.querySelector('.stm-org-select');
        if (selBtn) selBtn.textContent = this._selectAllLabel();
    });

    item.querySelector('.stm-ti-arrow').addEventListener('click', e => {
        e.stopPropagation();
        if (!hasChildren) return;
        this._expandedUids.has(card.uid)
            ? this._expandedUids.delete(card.uid)
            : this._expandedUids.add(card.uid);
        this._rerender();
    });

    item.querySelector('.stm-ti-pin')?.addEventListener('click', e => {
        e.stopPropagation();
        this._togglePinned(card);
    });

    item.querySelector('.stm-ti-rename').addEventListener('click', e => {
        e.stopPropagation();
        this._openRenameDialog(card);
    });

    item.querySelector('.stm-ti-delete').addEventListener('click', e => {
        e.stopPropagation();
        if (!confirm(`Delete "${card.title || 'this card'}" and reparent its children?`)) return;
        this._deleteCard(card.uid);
        if (this._selectedUid === card.uid) this._selectedUid = card.parentUid || null;
        if (this._focusedUid === card.uid) this._focusedUid = null;
        if (this._editingCardUid === card.uid) this._editingCardUid = null;
        this._rerender();
    });

    item.addEventListener('click', e => {
        if (e.target.closest('button')) return;
        if (e.target.classList.contains('stm-ti-arrow'))  return;
        if (isFolder) {
            const inside = this._selectedUid === card.uid
                || (this._selectedUid && this._isDescendant(card.uid, this._selectedUid));
            if (inside) {
                this._selectedUid = card.parentUid || null;
                this._focusedUid = null;
            } else {
                this._selectedUid = card.uid;
                this._focusedUid = null;
            }
        } else {
            this._selectedUid = card.uid;
            this._focusedUid = card.uid;
        }
        this._editingCardUid = null;
        this._rerender();
    });

    wrapper.appendChild(item);

    if (isExpanded && hasChildren) {
        const childWrap = document.createElement('div');
        childWrap.className = 'stm-tree-children';
        children.forEach(child =>
            childWrap.appendChild(this._buildTreeNode(child, depth + 1, db))
        );
        wrapper.appendChild(childWrap);
    }

    return wrapper;
}

_clearTreeDropMarks() {
    this._panel?.querySelectorAll('.stm-drop-before, .stm-drop-after, .stm-drop-inside')
        .forEach(el => el.classList.remove('stm-drop-before', 'stm-drop-after', 'stm-drop-inside'));
}

_dropPlaceFromEvent(item, e) {
    const rect = item.getBoundingClientRect();
    const y = rect.height ? (e.clientY - rect.top) / rect.height : 0.5;
    if (y < 0.28) return 'before';
    if (y > 0.72) return 'after';
    return 'inside';
}

_isDescendant(ancestorUid, uid) {
    let cur = this._getCard(uid);
    const seen = new Set();
    while (cur?.parentUid && !seen.has(cur.uid)) {
        if (cur.parentUid === ancestorUid) return true;
        seen.add(cur.uid);
        cur = this._getCard(cur.parentUid);
    }
    return false;
}

_bindTreeDrag(item, card) {
    item.addEventListener('dragstart', e => {
        if (e.target.closest('button')) {
            e.preventDefault();
            return;
        }
        if (e.target.closest('.stm-ti-check')) {
            e.preventDefault();
            return;
        }
        e.dataTransfer.setData('text/plain', card.uid);
        e.dataTransfer.effectAllowed = 'move';
        item.classList.add('stm-dragging');
    });
    item.addEventListener('dragend', () => {
        item.classList.remove('stm-dragging');
        this._clearTreeDropMarks();
    });
    item.addEventListener('dragover', e => {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        this._clearTreeDropMarks();
        item.classList.add('stm-drop-' + this._dropPlaceFromEvent(item, e));
    });
    item.addEventListener('dragleave', e => {
        if (!item.contains(e.relatedTarget)) {
            item.classList.remove('stm-drop-before', 'stm-drop-after', 'stm-drop-inside');
        }
    });
    item.addEventListener('drop', e => {
        e.preventDefault();
        e.stopPropagation();
        const fromUid = e.dataTransfer.getData('text/plain');
        const place = this._dropPlaceFromEvent(item, e);
        this._clearTreeDropMarks();
        this._reorderCard(fromUid, card.uid, place);
        this._rerender();
    });
}

_reorderCard(fromUid, targetUid, place) {
    if (!fromUid || fromUid === targetUid) return;
    if (place === 'inside' && this._isDescendant(fromUid, targetUid)) return;
    if (place !== 'inside' && this._isDescendant(fromUid, targetUid)) return;

    const db = this._db();
    const from = db.cards.find(c => c.uid === fromUid);
    const target = db.cards.find(c => c.uid === targetUid);
    if (!from || !target) return;

    if (place === 'inside') {
        if (!this._isFolder(target, db)) return;
        if (!this._applyLevelForParent(from, target.uid)) return;
        const kids = db.cards.filter(c => c.parentUid === target.uid && c.uid !== from.uid);
        from.sortIndex = kids.reduce((m, c) => Math.max(m, c.sortIndex ?? 0), -1) + 1;
        this._expandedUids.add(target.uid);
    } else {
        const destParent = target.parentUid || null;
        if (!this._applyLevelForParent(from, destParent)) return;
        const sibs = db.cards
            .filter(c => (c.parentUid || null) === (from.parentUid || null) && c.uid !== from.uid)
            .sort((a, b) => (a.sortIndex ?? 0) - (b.sortIndex ?? 0) || a.createdAt - b.createdAt);
        const t = sibs.findIndex(c => c.uid === targetUid);
        const arr = [...sibs];
        arr.splice(Math.max(0, place === 'before' ? t : t + 1), 0, from);
        arr.forEach((c, i) => { c.sortIndex = i; });
    }
    from.updatedAt = now();
    this._save(db);
}

_openRenameDialog(card) {
    const overlay = document.createElement('div');
    overlay.className = 'stm-dialog-overlay';
    overlay.innerHTML = `
        <div class="stm-dialog">
            <div class="stm-dialog-header">Rename</div>
            <div class="stm-dialog-body">
                <div class="stm-form-row">
                    <label>Title</label>
                    <input id="stm-rename-input" type="text" value="${esc(card.title || '')}">
                </div>
            </div>
            <div class="stm-dialog-footer">
                <button id="stm-rename-cancel" class="stm-btn">Cancel</button>
                <button id="stm-rename-ok"     class="stm-btn stm-btn-primary">Rename</button>
            </div>
        </div>`;
    document.body.appendChild(overlay);

    const input = overlay.querySelector('#stm-rename-input');
    input.focus(); input.select();
    const close = () => overlay.remove();

    overlay.querySelector('#stm-rename-cancel').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    overlay.querySelector('#stm-rename-ok').addEventListener('click', () => {
        const title = input.value.trim();
        if (!title) { input.classList.add('stm-input-error'); input.focus(); return; }
        this._updateCard(card.uid, { title });
        close();
        this._rerender();
    });
    overlay.addEventListener('keydown', e => {
        if (e.key === 'Enter')  overlay.querySelector('#stm-rename-ok').click();
        if (e.key === 'Escape') close();
    });
}

_openBulkMoveDialog() {
    if (!this._checkedUids.size) return;
    const db = this._db();
    const folders = db.cards.filter(c => this._isFolder(c, db));
    const destOpts = [
        `<option value="">— Root —</option>`,
        ...folders.map(c =>
            `<option value="${esc(c.uid)}">${esc(c.title || '(untitled)')}</option>`),
    ].join('');

    const overlay = document.createElement('div');
    overlay.className = 'stm-dialog-overlay';
    overlay.innerHTML = `
        <div class="stm-dialog">
            <div class="stm-dialog-header">Move ${this._checkedUids.size} item(s)</div>
            <div class="stm-dialog-body">
                <div class="stm-form-row">
                    <label>Destination folder</label>
                    <select id="stm-bulk-dest">${destOpts}</select>
                </div>
            </div>
            <div class="stm-dialog-footer">
                <button id="stm-bulk-cancel" class="stm-btn">Cancel</button>
                <button id="stm-bulk-ok" class="stm-btn stm-btn-primary">Move</button>
            </div>
        </div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.querySelector('#stm-bulk-cancel').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    overlay.querySelector('#stm-bulk-ok').addEventListener('click', () => {
        const dest = overlay.querySelector('#stm-bulk-dest').value || null;
        this._bulkMove([...this._checkedUids], dest);
        if (dest) this._expandedUids.add(dest);
        close();
        this._rerender();
    });
}

_openNewFolderDialog() {
    const db = this._db();
    const levels = db.settings.levels;
    const defaultParent = this._resolveFolderCreateParent();
    const defaultLevel = this._nextLevelId(defaultParent, { forFolder: true });
    if (!defaultLevel) {
        alert('No deeper folder level left in this hierarchy. Add a level in Configure, or nest under a shallower folder.');
        return;
    }

    const containerLevels = levels.length > 1 ? levels.slice(0, -1) : levels;
    const levelOpts = containerLevels.map(l =>
        `<option value="${esc(l.id)}" ${l.id === defaultLevel ? 'selected' : ''}>${esc(l.label)}</option>`
    ).join('');

    const containerCards = db.cards.filter(c => this._isFolder(c, db));
    const parentOpts = [
        `<option value="">— None (root) —</option>`,
        ...containerCards
            .filter(c => !!this._nextLevelId(c, { forFolder: true }))
            .map(c =>
                `<option value="${esc(c.uid)}" ${c.uid === defaultParent?.uid ? 'selected' : ''}>${esc(c.title || '(untitled)')} · ${esc(this._orgCode(c))}</option>`
            ),
    ].join('');

    const overlay = document.createElement('div');
    overlay.className = 'stm-dialog-overlay';
    overlay.innerHTML = `
        <div class="stm-dialog">
            <div class="stm-dialog-header">New Folder / Container</div>
            <div class="stm-dialog-body">
                <p class="stm-settings-hint">Level follows the hierarchy ladder under the chosen parent.</p>
                <div class="stm-form-row">
                    <label>Level</label>
                    <select id="stm-folder-kind">${levelOpts}</select>
                </div>
                <div class="stm-form-row">
                    <label>Title <span class="stm-required">*</span></label>
                    <input id="stm-folder-title" type="text" placeholder="e.g. Act I…">
                </div>
                <div class="stm-form-row stm-form-row--tall">
                    <label>Description</label>
                    <textarea id="stm-folder-desc" rows="3" placeholder="What this folder holds…"></textarea>
                </div>
                ${this._folderCoverFieldsHTML()}
                <div class="stm-form-row">
                    <label>Parent</label>
                    <select id="stm-folder-parent">${parentOpts}</select>
                </div>
            </div>
            <div class="stm-dialog-footer">
                <button id="stm-folder-cancel" class="stm-btn">Cancel</button>
                <button id="stm-folder-ok"     class="stm-btn stm-btn-primary">Create</button>
            </div>
        </div>`;
    document.body.appendChild(overlay);

    const titleEl = overlay.querySelector('#stm-folder-title');
    const kindEl = overlay.querySelector('#stm-folder-kind');
    const parentEl = overlay.querySelector('#stm-folder-parent');
    titleEl.focus();
    const close = () => overlay.remove();

    const syncLevelFromParent = () => {
        const parent = parentEl.value ? this._getCard(parentEl.value) : null;
        const lid = this._nextLevelId(parent, { forFolder: true });
        if (lid) kindEl.value = lid;
    };
    parentEl.addEventListener('change', syncLevelFromParent);

    overlay.querySelector('#stm-folder-cancel').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    this._bindCoverPicker(overlay);
    overlay.querySelector('#stm-folder-ok').addEventListener('click', () => {
        const title = titleEl.value.trim();
        if (!title) { titleEl.classList.add('stm-input-error'); titleEl.focus(); return; }
        const parentUid = parentEl.value || null;
        const parent = parentUid ? this._getCard(parentUid) : null;
        const lid = this._nextLevelId(parent, { forFolder: true }) || kindEl.value;
        if (!lid) { alert('Cannot nest a folder there.'); return; }
        const card = this._addCard({
            levelId  : lid,
            kind     : 'folder',
            title,
            summary  : overlay.querySelector('#stm-folder-desc').value.trim(),
            content  : overlay.querySelector('#stm-folder-desc').value.trim(),
            parentUid,
            coverImage: overlay.querySelector('#stm-folder-cover')?.value.trim() || '',
            coverPlacement: overlay.querySelector('[name="coverPlacement"]:checked')?.value === 'below' ? 'below' : 'above',
        });
        this._expandedUids.add(card.uid);
        if (parentUid) this._expandedUids.add(parentUid);
        this._selectedUid = card.uid;
        this._focusedUid = null;
        close();
        this._rerender();
    });
    overlay.addEventListener('keydown', e => {
        if (e.key === 'Enter')  overlay.querySelector('#stm-folder-ok').click();
        if (e.key === 'Escape') close();
    });
}

_drawerParentUid() {
    const sel = this._selectedUid ? this._getCard(this._selectedUid) : null;
    if (!sel) return null;
    // Focused/editing a folder keeps it in the sibling stack (edit as a page).
    // Plain selection (tree / Open) still dives into the folder's children.
    if (this._isFolder(sel)) {
        if (this._focusedUid === sel.uid || this._editingCardUid === sel.uid) {
            return sel.parentUid || null;
        }
        return sel.uid;
    }
    return sel.parentUid || null;
}

_drawerStack() {
    const db = this._db();
    const parentUid = this._drawerParentUid();
    return this._treeSort(
        db.cards.filter(c => (c.parentUid || null) === parentUid && this._cardMatchesFilter(c)),
    );
}

_buildCardDrawer() {
    const drawer = document.createElement('div');
    drawer.className = 'stm-card-drawer';
    drawer.innerHTML = `
        <div class="stm-drawer-header">
            <span class="stm-drawer-title">PAGES</span>
            <span id="stm-breadcrumb" class="stm-breadcrumb"></span>
            <button id="stm-add-card-btn" class="stm-btn stm-btn-add" title="Add card">＋</button>
        </div>
        <div id="stm-card-list" class="stm-card-list">
            <div id="stm-empty-state" class="stm-empty-state">
                <p>No pages in this stack yet.</p>
                <button id="stm-empty-add" class="stm-btn stm-btn-primary">Create a card</button>
            </div>
        </div>`;

    drawer.querySelector('#stm-add-card-btn')
        .addEventListener('click', () => this._openNewCardDialog());
    drawer.querySelector('#stm-empty-add')
        .addEventListener('click', () => this._openNewCardDialog());
    drawer.querySelector('#stm-card-list').addEventListener('click', e => {
        const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
        if (path.some(n => n?.classList?.contains?.('stm-card'))) return;
        if (e.target.closest?.('.stm-card')) return;
        if (!this._focusedUid && !this._editingCardUid) return;
        this._focusedUid = null;
        this._editingCardUid = null;
        this._rerender();
    });

    this._refreshDrawer(drawer);
    return drawer;
}

// ── Refresh stacked pages ─────────────────────────────────────────────────────
  _refreshDrawer(rootEl) {
    const root  = rootEl || this._panel;
    const list  = root?.querySelector('#stm-card-list');
    const empty = root?.querySelector('#stm-empty-state');
    const crumb = root?.querySelector('#stm-breadcrumb');
    if (!list) return;

    list.querySelectorAll('.stm-card').forEach(n => n.remove());

    const stack = this._drawerStack();
    const parentUid = this._drawerParentUid();
    const parent = parentUid ? this._getCard(parentUid) : null;
    if (crumb) crumb.textContent = parent ? `▸ ${this._cardPath(parent)}` : 'All Cards';

    if (!stack.length) {
        if (empty) empty.style.display = '';
        return;
    }
    if (empty) empty.style.display = 'none';
    const frag = document.createDocumentFragment();
    stack.forEach((card, i) => frag.appendChild(this._buildCard(card, i, stack.length)));
    list.appendChild(frag); // one insertion instead of one per card
    list.querySelector('.stm-card--focused, .stm-card--editing')
        ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

// ── Build single card element ─────────────────────────────────────────────────
  _buildCard(card, index = 0, total = 1) {
    const isEditing = this._editingCardUid === card.uid;
    const isFocused = isEditing || this._focusedUid === card.uid;
    const el = document.createElement('div');
    const isFolder = this._isFolder(card);
    const isRootFolder = isFolder && !(card.parentUid);
    el.className = 'stm-card'
        + (isEditing ? ' stm-card--editing' : '')
        + (isFocused && !isEditing ? ' stm-card--focused' : '')
        + (!isFocused && !isEditing ? ' stm-card--minimized' : '')
        + (isFolder ? ' stm-folder' : '')
        + (isRootFolder ? ' stm-folder--root' : '')
        + (isEventCard(card) ? ' stm-card--event' : '')
        + (isEventCard(card) && card.eventScale === 'personal' ? ' stm-card--event-personal' : '');
    el.dataset.uid = card.uid;
    el.style.zIndex = String(isFocused ? total + 10 : index + 1);

    const punches = document.createElement('div');
    punches.className = isFolder
      ? (isRootFolder ? 'stm-folder-spine' : 'stm-folder-margin')
      : (isEventCard(card) ? 'stm-event-stub' : 'stm-punches');
    punches.innerHTML = isFolder || isEventCard(card) ? '' : '<span></span><span></span><span></span>';

    const body = document.createElement('div');
    body.className = 'stm-card-body';

    if (isEditing) {
      body.innerHTML = this._editFormHTML(card);
      el.appendChild(punches);
      el.appendChild(body);
      this._attachEditListeners(el, card);
    } else {
      body.innerHTML = this._collapsedHTML(card, { compact: !isFocused });
      el.appendChild(punches);
      el.appendChild(body);
      this._attachCollapsedListeners(el, card, isFocused);
    }

    return el;
  }

_parseLooseJson(text) {
    return salvageJsonArray(text);
}

_unwrapAgentPayload(parsed) {
    return salvageJsonArray(parsed);
}

_normalizeAgentCard(raw) {
    const db = this._db();
    const members = this._castMembers();
    const title = String(pickField(raw, 'Title', 'title') || '').trim();
    if (!title) return null;
    const highlights = asStringList(pickField(raw, 'Highlights', 'highlights', 'quotes'));
    const quotes = highlights.map(h => {
        if (h && typeof h === 'object') {
            return { text: String(h.text || h.quote || '').trim(), character: String(h.character || h.name || '').trim() };
        }
        const s = String(h).trim();
        const qm = s.match(/^(.+?):\s*[“"'](.+)[”"']\s*$/) || s.match(/^(.+?)\s+[“"'](.+)[”"']\s*$/);
        if (qm) return { text: qm[2].trim(), character: qm[1].trim() };
        return { text: s.replace(/^["“]|["”]$/g, ''), character: '' };
    }).filter(q => q.text);
    const creditLines = asStringList(pickField(raw, 'Credits', 'credits'));
    const credits = this._dedupeCredits(creditLines.map(line => {
        if (line && typeof line === 'object') return line;
        return parseCreditLine(line);
    }).filter(Boolean), members);
    const summary = String(pickField(raw, 'Summary', 'summary') || '').trim();
    const spanRaw = pickField(raw, 'Span', 'span');
    const span = spanRaw != null && String(spanRaw).trim() && String(spanRaw).toLowerCase() !== 'null'
        ? String(spanRaw).trim() : null;
    // Character names belong in Credits, not keyword tags (aliases live on Cast).
    const charNames = asStringList(pickField(raw, 'Characters', 'characters'));
    for (const name of charNames) {
        const extra = this._normalizeCredit({ name }, members);
        if (extra) credits.push(extra);
    }
    const keywordFacets = normalizeFacets({
        location: asStringList(pickField(raw, 'Location', 'location')),
        objects: asStringList(pickField(raw, 'Objects', 'objects')),
        characters: [],
        datetime: asStringList(pickField(raw, 'DateTime', 'datetime', 'Date / Time')),
        ...normalizeFacets(pickField(raw, 'keywordFacets', 'keyword_facets')),
    });
    keywordFacets.characters = [];
    if (span && !keywordFacets.datetime.length) keywordFacets.datetime = [span];
    const extraKw = keywordStrings(pickField(raw, 'Keywords', 'keywords'));
    const seenKw = new Set(flattenFacets(keywordFacets).map(k => k.toLowerCase()));
    for (const k of extraKw) {
        if (seenKw.has(k.toLowerCase())) continue;
        const asMember = this._memberForCreditName(k, members);
        const asChar = asMember
            || credits.some(c => c.name && k.toLowerCase().includes(String(c.name).toLowerCase()));
        if (asChar) {
            const n = this._normalizeCredit({ name: k }, members);
            if (n) credits.push(n);
        } else {
            keywordFacets.objects.push(k);
        }
        seenKw.add(k.toLowerCase());
    }
    const keywords = flattenFacets(keywordFacets);
    const path = String(pickField(raw, 'Path', 'path', 'parent') || '').trim();
    const timeKey = (keywordFacets.datetime[0] || span || '').trim();
    const parsed = pickParseableTimeKey({ timeKey, keywordFacets, span }, this.state?.settings?.calendar, {
        anchorParts: this._timelineAnchorParts(),
    });
    const parentUid = this._ensureFolderPath(path);
    // Agent always creates leaf cards; Path only chooses the folder they live under.
    return {
        kind: 'card',
        levelId: this._cardLevelId(db),
        title,
        span,
        timeKey: parsed?.key || timeKey,
        timestamp: parsed?.parsed?.sort ?? null,
        timeManual: false,
        summary,
        content: summary,
        quotes,
        credits: this._dedupeCredits(credits, members),
        keywordFacets,
        keywords,
        parentUid,
    };
}

_ingestAgentCards(raw, { sourceEntries = null, mode = 'agent', maxCards = 0 } = {}) {
    const arr = salvageJsonArray(raw);
    const cards = [];
    const failed = [];
    const carried = Array.isArray(sourceEntries) ? sourceEntries.filter(Boolean) : [];
    const stamp = carried.length ? this._buildSourceStamp(carried, mode) : null;
    const books = carried.length
        ? [...new Set(carried.map(e => e._bookName).filter(Boolean))]
        : [];
    const leafId = this._cardLevelId();
    const limit = maxCards > 0 ? maxCards : Infinity;
    for (const item of arr) {
        if (cards.length >= limit) break;
        try {
            const card = this._normalizeAgentCard(item);
            if (!card) { failed.push(item); continue; }
            card.kind = 'card';
            card.levelId = leafId;
            if (stamp) card.sourceStamp = stamp;
            if (books.length) card.sourceBook = books.join(', ');
            cards.push(this._addCard(card));
        } catch (err) {
            log('Agent card ingest failed', err);
            failed.push(item);
        }
    }
    return { count: cards.length, cards, failed, rawCount: arr.length };
}

_agentUserPreamble() {
    return `CAST:\n${this._castPromptBlock()}\n\n${this._presentLockNote()}\n\nSCRIPT SHELF (Path must match a FOLDER line, or ""):\n${this._shelfIndexText()}\n`;
}

_presentLockNote() {
    const parts = this._timelineAnchorParts();
    const y = Number(parts?.year);
    const cal = this._cal();
    let when = '';
    if (Number.isFinite(y) && y > 0) {
        const season = parts?.seasonId
            ? (cal.seasons.find(s => s.id === parts.seasonId)?.label || parts.seasonId)
            : '';
        when = `${season ? `${season} ` : ''}${formatCalendarYear(y, cal)}`;
    }
    if (this._lockPresentYear()) {
        return when
            ? `PRESENT (year locked): ${when}. Span and DateTime MUST use this year unless the source explicitly names a different year. Never invent a real-world or random year.`
            : 'PRESENT year is unset. Leave Span empty rather than inventing a year.';
    }
    return when
        ? `PRESENT: ${when}. Prefer this year for undated events.`
        : '';
}

_formatEntriesBlock(entries) {
    return entries.map((e, i) => {
        const label = this._entryLabel(e, i);
        return `[${i + 1}] ${label}\n${e.content || '(no content)'}`;
    }).join('\n\n---\n\n');
}

/** Parse Pass-1 group plan; Sources are 1-based into `pool`. */
_parseLoreGroups(raw, pool) {
    const items = salvageJsonArray(raw);
    const out = [];
    for (const g of items) {
        if (!g || typeof g !== 'object') continue;
        // Skip accidental full cards in a group response.
        if (pickField(g, 'Summary', 'summary') && !pickField(g, 'Sources', 'sources', 'sourceIndices')) continue;
        const idxs = asIndexList(pickField(g, 'Sources', 'sources', 'sourceIndices'));
        const picked = [...new Set(idxs.map(n => pool[n - 1]).filter(Boolean))];
        if (!picked.length) continue;
        out.push({
            titleHint: String(pickField(g, 'TitleHint', 'titleHint', 'Title', 'title') || '').trim(),
            path: String(pickField(g, 'Path', 'path') || '').trim(),
            keywords: keywordStrings(pickField(g, 'Keywords', 'keywords')),
            entries: picked,
        });
    }
    return out;
}

_chunkByBudget(blocks, overheadChars) {
    const db = this._db();
    const cap = Math.max(2000, (Number(db.settings.aiMaxInputTokens) || 8000) * 4 - overheadChars);
    const chunks = [];
    let cur = [];
    let size = 0;
    for (const block of blocks) {
        const len = block.text.length + 8;
        if (cur.length && size + len > cap) {
            chunks.push(cur);
            cur = [];
            size = 0;
        }
        cur.push(block);
        size += len;
    }
    if (cur.length) chunks.push(cur);
    return chunks;
}

_chatMessageList() {
    const chat = getContext().chat ?? [];
    return chat.map((m, i) => ({
        index: i,
        name: m.name || (m.is_user ? 'You' : 'Character'),
        is_user: !!m.is_user,
        text: String(m.mes || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    })).filter(m => m.text);
}

_formatChatRange(msgs, from, to) {
    const slice = msgs.filter(m => m.index >= from && m.index <= to);
    return slice.map(m => `[${m.index}] ${m.name}: ${m.text}`).join('\n');
}

_entryLabel(e, i) {
    return e.comment || (Array.isArray(e.key) ? e.key.join(', ') : e.key) || `Entry ${i + 1}`;
}

async _runChatAgent(from, to, onPass) {
    const msgs = this._chatMessageList();
    const slice = msgs.filter(m => m.index >= from && m.index <= to);
    if (!slice.length) throw new Error('No messages in that range.');
    const blocks = slice.map(m => ({
        text: `[${m.index}] ${m.name}: ${m.text}`,
    }));
    const preamble = this._agentUserPreamble();
    const chunks = this._chunkByBudget(blocks, preamble.length + AGENT_SYSTEM_PROMPT.length + AGENT_CHAT_RULES.length);
    const created = [];
    let lastErr = null;
    for (let i = 0; i < chunks.length; i++) {
        if (this._agentCancelled) throw new Error('Cancelled.');
        onPass?.(i + 1, chunks.length);
        const chatBlock = chunks[i].map(b => b.text).join('\n');
        const prompt = `${preamble}\n${AGENT_CHAT_RULES}\n\nCHAT (${chunks[i].length} messages in this pass — GROUP into scene cards):\n${chatBlock}`;
        log('Agent chat pass', i + 1, '/', chunks.length);
        try {
            const raw = await this._quietPrompt(prompt, {
                systemPrompt: `${AGENT_SYSTEM_PROMPT}\n\n${AGENT_CHAT_RULES}`,
            });
            log('Agent chat raw', typeof raw === 'string' ? raw.slice(0, 400) : raw);
            const ingested = this._ingestAgentCards(raw);
            created.push(...(ingested.cards || []));
        } catch (err) {
            lastErr = err;
            log('Agent chat pass failed', err);
            if (String(err.message) === 'Cancelled.') throw err;
        }
    }
    if (!created.length) throw lastErr || new Error('Agent returned no valid cards — check console.');
    return { count: created.length, cards: created };
}

async _runLorebookAudit(entries, onPass) {
    if (!entries?.length) throw new Error('Select lorebook entries first.');
    const preamble = this._agentUserPreamble();
    const blocks = entries.map((e, i) => ({
        entry: e,
        index: i + 1,
        text: `[${i + 1}] ${this._entryLabel(e, i)}\n${e.content || '(no content)'}`,
    }));
    const chunks = this._chunkByBudget(
        blocks,
        preamble.length + AGENT_SYSTEM_PROMPT.length + AGENT_LOREBOOK_GROUP_RULES.length,
    );

    // Pass 1 — group plans (per chunk)
    const groups = [];
    let lastErr = null;
    for (let i = 0; i < chunks.length; i++) {
        if (this._agentCancelled) throw new Error('Cancelled.');
        onPass?.(i + 1, chunks.length, 'group');
        const chunkEntries = chunks[i].map(b => b.entry);
        const entryBlock = chunks[i].map(b => b.text).join('\n\n---\n\n');
        const prompt = `${preamble}\n${AGENT_LOREBOOK_GROUP_RULES}\n\nENTRIES (${chunkEntries.length} clippings — propose scene groups):\n${entryBlock}`;
        log('Lorebook audit group pass', i + 1, '/', chunks.length);
        try {
            const raw = await this._quietPrompt(prompt, {
                systemPrompt: `${AGENT_SYSTEM_PROMPT}\n\n${AGENT_LOREBOOK_GROUP_RULES}`,
                jsonSchema: AGENT_GROUPS_SCHEMA,
            });
            const parsed = this._parseLoreGroups(raw, chunkEntries);
            groups.push(...parsed);
        } catch (err) {
            lastErr = err;
            log('Lorebook group pass failed', err);
            if (String(err.message) === 'Cancelled.') throw err;
        }
    }

    // Cover leftovers as singleton groups so nothing is silently dropped.
    const used = new Set();
    for (const g of groups) {
        for (const e of g.entries) used.add(e);
    }
    for (const e of entries) {
        if (!used.has(e)) {
            groups.push({ titleHint: this._entryLabel(e, 0), path: '', keywords: [], entries: [e] });
        }
    }
    if (!groups.length) throw lastErr || new Error('Agent returned no groups — check console.');

    // Pass 2 — build one card per group
    const created = [];
    for (let i = 0; i < groups.length; i++) {
        if (this._agentCancelled) throw new Error('Cancelled.');
        onPass?.(i + 1, groups.length, 'build');
        const g = groups[i];
        const seed = [
            g.titleHint ? `TitleHint: ${g.titleHint}` : '',
            g.path ? `Path seed: ${g.path}` : '',
            g.keywords?.length ? `Keywords seed: ${g.keywords.join(', ')}` : '',
        ].filter(Boolean).join('\n');
        const entryBlock = this._formatEntriesBlock(g.entries);
        const prompt = `${preamble}\n${AGENT_LOREBOOK_BUILD_RULES}\n\n${seed ? `${seed}\n\n` : ''}CLIPPINGS FOR THIS SCENE (${g.entries.length}):\n${entryBlock}`;
        log('Lorebook audit build', i + 1, '/', groups.length, 'entries', g.entries.length);
        try {
            const raw = await this._quietPrompt(prompt, {
                systemPrompt: `${AGENT_SYSTEM_PROMPT}\n\n${AGENT_LOREBOOK_BUILD_RULES}`,
            });
            const ingested = this._ingestAgentCards(raw, {
                sourceEntries: g.entries,
                mode: 'lorebook-audit',
                maxCards: 1,
            });
            created.push(...ingested.cards);
        } catch (err) {
            lastErr = err;
            log('Lorebook build pass failed', err);
            if (String(err.message) === 'Cancelled.') throw err;
        }
    }
    if (!created.length) throw lastErr || new Error('Agent built no cards — check console.');
    return { count: created.length, cards: created, groups: groups.length };
}

async _runLoreEntriesAudit(entries, onPass) {
    if (!entries?.length) throw new Error('Select lorebook entries first.');
    onPass?.(1, 1, 'build');
    const preamble = this._agentUserPreamble();
    const entryBlock = this._formatEntriesBlock(entries);
    const prompt = `${preamble}\n${AGENT_LORE_ENTRIES_AUDIT}\n\nENTRIES (${entries.length} — cover ALL in exactly one ScriptCard):\n${entryBlock}`;
    log('Entries audit', entries.length);
    const raw = await this._quietPrompt(prompt, {
        systemPrompt: `${AGENT_SYSTEM_PROMPT}\n\n${AGENT_LORE_ENTRIES_AUDIT}`,
    });
    const ingested = this._ingestAgentCards(raw, {
        sourceEntries: entries,
        mode: 'entries-audit',
        maxCards: 1,
    });
    if (!ingested.count) throw new Error('Agent returned no valid card — check console.');
    return { count: ingested.count, cards: ingested.cards };
}

async _runLoreGroupAgent(entries, onPass) {
    // Back-compat alias → lorebook multi-pass audit
    return this._runLorebookAudit(entries, onPass);
}

_openAgentDialog(opts = {}) {
    const open = async () => {
        await this._loadWIBooks(null, { force: true }); // the Agent needs the current books
        this._openAgentDialogNow(opts);
    };
    open();
}

_openAgentDialogNow(opts = {}) {
    const db = this._db();
    const msgs = this._chatMessageList();
    const lastIdx = msgs.length ? msgs[msgs.length - 1].index : 0;
    const firstIdx = msgs.length ? msgs[0].index : 0;
    const initialMode = opts.mode === 'entries' ? 'entries'
        : (opts.mode === 'lore' || opts.mode === 'lorebook') ? 'lorebook'
            : 'chat';
    const preBook = opts.bookName || this._boundChatBook() || '';

    const profileOpts = [
        `<option value="">— Current (default) —</option>`,
        ...this._profiles.map(p =>
            `<option value="${esc(p.id)}" ${db.settings.aiProfile === p.id ? 'selected' : ''}>${esc(p.name)}</option>`),
    ].join('');

    const libLeaves = listLibraryLeaves(this.storage, this._wiBooks);
    let stampIdx = this._agentStampIndex();
    const stampBadge = (codes) => codes.length
        ? `<span class="stm-agent-stamp" title="Already submitted to Script">⌘ ${esc(codes.join(' · '))}</span>`
        : '';
    const cubbies = librarySections(this.storage);
    const cubbyCounts = new Map(cubbies.map(s => [s.id, 0]));
    let looseCount = 0;
    for (const leaf of libLeaves) {
        if (leaf.disabled) continue;
        if (leaf.sectionId && cubbyCounts.has(leaf.sectionId)) cubbyCounts.set(leaf.sectionId, cubbyCounts.get(leaf.sectionId) + 1);
        else looseCount++;
    }
    const cubbyChecks = [
        ...cubbies.map(s => `
            <label class="stm-import-row stm-agent-book">
                <input type="checkbox" class="stm-agent-cubby-check" data-cubby="${esc(s.id)}">
                <span>${esc(s.icon || '◈')} ${esc(s.title)} (${cubbyCounts.get(s.id) || 0})</span>
            </label>`),
        `<label class="stm-import-row stm-agent-book">
            <input type="checkbox" class="stm-agent-cubby-check" data-cubby="${LIB_UNSORTED}">
            <span>⁙ Unsorted (${looseCount})</span>
        </label>`,
    ].join('');
    const bookChecks = this._wiBooks.map(b => {
        const codes = stampIdx.bookCodes(b.name);
        const auto = b.name === preBook;
        return `
        <label class="stm-import-row stm-agent-book"${codes.length ? ` title="Scene labels on this book (entries are stamped individually): ${esc(codes.join(', '))}"` : ''}>
            <input type="checkbox" class="stm-agent-book-check" data-book="${esc(b.name)}" ${auto ? 'checked' : ''}>
            <span class="stm-agent-book-label">
                <span class="stm-agent-book-name">${esc(b.name)} (${b.entries.length})</span>
                ${stampBadge(codes)}
            </span>
        </label>`;
    }).join('') || '<p class="stm-settings-hint">No lorebooks found.</p>';

    const msgOpts = (selected) => msgs.map(m =>
        `<option value="${m.index}" ${m.index === selected ? 'selected' : ''}>#${m.index} ${esc(m.name)} — ${esc(m.text.slice(0, 48))}${m.text.length > 48 ? '…' : ''}</option>`
    ).join('');

    const loreHintLorebook = 'Pick Library cubbies and/or lorebooks, then trim entries. The agent groups them into scene cards (multi-pass), stamps ⌘ origins per group, and labels Library with scene codes. Grey ⌘ rows were already submitted.';
    const loreHintEntries = 'Select the exact entries for <strong>one</strong> ScriptCard. Origin stamps always match your selection — the agent cannot change them.';

    const overlay = document.createElement('div');
    overlay.className = 'stm-dialog-overlay';
    overlay.innerHTML = `
        <div class="stm-dialog stm-dialog--agent">
            <div class="stm-dialog-header">Script Agent</div>
            <div class="stm-dialog-body">
                <div id="stm-agent-select" class="stm-agent-select">
                <div class="stm-agent-tabs">
                    <button type="button" class="stm-btn stm-agent-tab ${initialMode === 'chat' ? 'stm-btn-primary' : ''}" data-mode="chat">From Chat</button>
                    <button type="button" class="stm-btn stm-agent-tab ${initialMode === 'lorebook' ? 'stm-btn-primary' : ''}" data-mode="lorebook">Audit lorebook</button>
                    <button type="button" class="stm-btn stm-agent-tab ${initialMode === 'entries' ? 'stm-btn-primary' : ''}" data-mode="entries">Audit entries</button>
                </div>
                <p id="stm-agent-mode-hint" class="stm-settings-hint">${
                    initialMode === 'chat'
                        ? 'Chat → scene cards from a message range.'
                        : initialMode === 'entries' ? loreHintEntries : loreHintLorebook
                }</p>

                <div class="stm-agent-pane" data-pane="chat" style="${initialMode === 'chat' ? '' : 'display:none'}">
                    <div class="stm-form-row">
                        <label>From message</label>
                        <select id="stm-agent-from">${msgOpts(firstIdx)}</select>
                    </div>
                    <div class="stm-form-row">
                        <label>To message</label>
                        <select id="stm-agent-to">${msgOpts(lastIdx)}</select>
                    </div>
                    <p class="stm-settings-hint">${msgs.length} message(s) in this chat.</p>
                </div>

                <div class="stm-agent-pane" data-pane="lore" style="${initialMode === 'chat' ? 'display:none' : ''}">
                    <div class="stm-agent-phase-label">1 · Library cubbies</div>
                    <div id="stm-agent-cubbies" class="stm-agent-viewport">${cubbyChecks}</div>
                    <div class="stm-agent-phase-label">1b · Lorebooks</div>
                    <div id="stm-agent-books" class="stm-agent-viewport">${bookChecks}</div>
                    <div id="stm-agent-entries-wrap" hidden>
                        <div class="stm-agent-phase-label">2 · Entries</div>
                        <div class="stm-import-toolbar">
                            <button type="button" id="stm-agent-check-all" class="stm-btn">Select all</button>
                            <span id="stm-agent-entry-count" class="stm-import-count">0 selected</span>
                        </div>
                        <div class="stm-import-list stm-agent-viewport" id="stm-agent-entries"></div>
                    </div>
                </div>

                <details class="stm-agent-ai">
                    <summary>AI profile &amp; budget</summary>
                    <div class="stm-form-row">
                        <label>AI profile</label>
                        <select id="stm-agent-profile">${profileOpts}</select>
                    </div>
                    <div class="stm-form-row">
                        <label>Max input tokens</label>
                        <input id="stm-agent-in" type="number" min="256" max="128000" value="${esc(String(db.settings.aiMaxInputTokens ?? 8000))}">
                    </div>
                    <div class="stm-form-row">
                        <label>Max output tokens</label>
                        <input id="stm-agent-out" type="number" min="128" max="32000" value="${esc(String(db.settings.aiMaxOutputTokens ?? 2048))}">
                    </div>
                    <div class="stm-form-row">
                        <label>Temperature</label>
                        <input id="stm-agent-temp" type="number" min="0" max="2" step="0.05" value="${esc(String(db.settings.aiTemperature ?? 0.3))}">
                    </div>
                </details>
                </div>
                <div id="stm-agent-stage" class="stm-agent-stage" hidden>
                    <div class="stm-film-strip" aria-hidden="true"></div>
                    <p class="stm-agent-beat">Lights up…</p>
                    <div class="stm-progress"><div class="stm-progress-fill"></div></div>
                    <button type="button" id="stm-agent-abort" class="stm-btn">■ Cut / Cancel</button>
                </div>
                <div id="stm-agent-status" class="stm-import-status stm-agent-status" hidden>
                    <p class="stm-agent-status-msg"></p>
                    <div class="stm-agent-status-actions" hidden>
                        <button type="button" id="stm-agent-dismiss" class="stm-btn">Dismiss</button>
                        <button type="button" id="stm-agent-view" class="stm-btn stm-btn-primary">View</button>
                    </div>
                </div>
            </div>
            <div class="stm-dialog-footer">
                <button type="button" id="stm-agent-cancel" class="stm-btn">Close</button>
                <button type="button" id="stm-agent-refresh-stamps" class="stm-btn" title="Rebuild Library ⌘ stamps from Script cards; drop leftovers">↻ Refresh stamps</button>
                <button type="button" id="stm-agent-run" class="stm-btn stm-btn-primary">Run agent</button>
            </div>
        </div>`;
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    const status = overlay.querySelector('#stm-agent-status');
    const statusMsg = overlay.querySelector('.stm-agent-status-msg');
    const statusActions = overlay.querySelector('.stm-agent-status-actions');
    const selectEl = overlay.querySelector('#stm-agent-select');
    const runBtn = overlay.querySelector('#stm-agent-run');
    const modeHint = overlay.querySelector('#stm-agent-mode-hint');
    let mode = initialMode;
    let lastCreatedUids = [];

    const persistBudget = () => {
        const s = this._db().settings;
        s.aiProfile = overlay.querySelector('#stm-agent-profile').value;
        s.aiMaxInputTokens = Math.max(256, parseInt(overlay.querySelector('#stm-agent-in').value, 10) || 8000);
        s.aiMaxOutputTokens = Math.max(128, parseInt(overlay.querySelector('#stm-agent-out').value, 10) || 2048);
        s.aiTemperature = Math.min(2, Math.max(0, Number(overlay.querySelector('#stm-agent-temp').value) || 0.3));
        this._save(this._db());
    };

    const selectedBookNames = () =>
        [...overlay.querySelectorAll('.stm-agent-book-check:checked')].map(cb => cb.dataset.book);
    const selectedCubbyIds = () =>
        [...overlay.querySelectorAll('.stm-agent-cubby-check:checked')].map(cb => cb.dataset.cubby);

    const cubbyTitle = (id) => {
        if (id === LIB_UNSORTED || !id) return 'Unsorted';
        return cubbies.find(s => s.id === id)?.title || 'Library';
    };

    const showStatus = (msg, { ok = false, viewable = false } = {}) => {
        status.hidden = false;
        if (statusMsg) statusMsg.textContent = msg;
        else status.textContent = msg;
        if (statusActions) statusActions.hidden = !viewable;
        status.classList.toggle('stm-agent-status--ok', !!ok);
        status.classList.toggle('stm-agent-status--err', !ok && !!msg);
    };
    const hideStatus = () => {
        status.hidden = true;
        if (statusMsg) statusMsg.textContent = '';
        if (statusActions) statusActions.hidden = true;
        lastCreatedUids = [];
    };

    const refreshEntries = () => {
        const names = selectedBookNames();
        const cubbyIds = selectedCubbyIds();
        const rows = [];
        const seen = new Set();
        const leaves = listLibraryLeaves(this.storage, this._wiBooks);
        const fromLib = leaves.filter(l => {
            if (l.disabled) return false;
            return cubbyIds.includes(l.sectionId || LIB_UNSORTED);
        });
        if (fromLib.length) {
            rows.push(`<div class="stm-agent-group">Library</div>`);
            for (const leaf of fromLib) {
                seen.add(leaf.key);
                const preview = (leaf.content || '').slice(0, 80).replace(/\n/g, ' ');
                const where = cubbyTitle(leaf.sectionId);
                const src = leaf.kind === 'native' ? 'Library' : leaf.book;
                const codes = stampIdx.leafCodes(leaf.key);
                const stamped = codes.length > 0;
                rows.push(`
                    <label class="stm-import-row${stamped ? ' stm-agent-stamped' : ''}"${stamped ? ` title="Already stamped: ${esc(codes.join(', '))}"` : ''}>
                        <input type="checkbox" class="stm-agent-entry-check" data-lib-key="${esc(leaf.key)}" ${stamped ? '' : 'checked'} data-stamped="${stamped ? '1' : '0'}">
                        <div class="stm-import-entry-info">
                            <span class="stm-import-entry-label">${esc(where)} · ${esc(src)} · ${esc(leaf.title)}${stampBadge(codes)}</span>
                            <span class="stm-import-entry-preview">${esc(preview)}${preview.length >= 80 ? '…' : ''}</span>
                        </div>
                    </label>`);
            }
        }
        const leftoverBooks = this._wiBooks.filter(b => names.includes(b.name));
        let leftoverHead = false;
        leftoverBooks.forEach(b => {
            b.entries.forEach((e, i) => {
                if (e?.disable) return;
                const key = libraryEntryKey(b.name, e.uid);
                if (seen.has(key)) return;
                if (!leftoverHead) {
                    rows.push(`<div class="stm-agent-group">Leftover lorebook rows</div>`);
                    leftoverHead = true;
                }
                const label = this._entryLabel(e, i);
                const preview = (e.content || '').slice(0, 80).replace(/\n/g, ' ');
                const codes = stampIdx.leafCodes(key);
                const stamped = codes.length > 0;
                rows.push(`
                    <label class="stm-import-row${stamped ? ' stm-agent-stamped' : ''}"${stamped ? ` title="Already stamped: ${esc(codes.join(', '))}"` : ''}>
                        <input type="checkbox" class="stm-agent-entry-check" data-book="${esc(b.name)}" data-idx="${i}" ${stamped ? '' : 'checked'} data-stamped="${stamped ? '1' : '0'}">
                        <div class="stm-import-entry-info">
                            <span class="stm-import-entry-label">${esc(b.name)} · ${esc(label)}${stampBadge(codes)}</span>
                            <span class="stm-import-entry-preview">${esc(preview)}${preview.length >= 80 ? '…' : ''}</span>
                        </div>
                    </label>`);
            });
        });
        overlay.querySelector('#stm-agent-entries').innerHTML = rows.join('')
            || '<p class="stm-settings-hint">Tick a cubby and/or a lorebook to list entries.</p>';
        const wrap = overlay.querySelector('#stm-agent-entries-wrap');
        if (wrap) wrap.hidden = !names.length && !cubbyIds.length;
        updateEntryCount();
    };

    const updateEntryCount = () => {
        const boxes = [...overlay.querySelectorAll('.stm-agent-entry-check')];
        const fresh = boxes.filter(c => c.dataset.stamped !== '1');
        const n = boxes.filter(c => c.checked).length;
        const stampedN = boxes.filter(c => c.dataset.stamped === '1').length;
        overlay.querySelector('#stm-agent-entry-count').textContent = stampedN
            ? `${n} selected · ${stampedN} already stamped`
            : `${n} selected`;
        const allBtn = overlay.querySelector('#stm-agent-check-all');
        if (allBtn) {
            const freshOn = fresh.length && fresh.every(c => c.checked);
            allBtn.textContent = freshOn ? 'Deselect all' : 'Select all';
        }
    };

    const refreshStampChrome = () => {
        stampIdx = this._agentStampIndex();
        overlay.querySelectorAll('#stm-agent-books .stm-agent-book').forEach(label => {
            const cb = label.querySelector('.stm-agent-book-check');
            if (!cb?.dataset.book) return;
            const codes = stampIdx.bookCodes(cb.dataset.book);
            // Book-level scene tags are informational — entries decide "already stamped".
            label.classList.remove('stm-agent-stamped');
            if (codes.length) label.title = `Scene labels on this book (entries are stamped individually): ${codes.join(', ')}`;
            else label.removeAttribute('title');
            const nameEl = label.querySelector('.stm-agent-book-name');
            const span = label.querySelector('.stm-agent-book-label');
            if (!span || !nameEl) return;
            span.querySelector('.stm-agent-stamp')?.remove();
            if (codes.length) span.insertAdjacentHTML('beforeend', stampBadge(codes));
        });
        refreshEntries();
    };

    const setMode = next => {
        mode = next;
        overlay.querySelectorAll('.stm-agent-tab').forEach(btn => {
            btn.classList.toggle('stm-btn-primary', btn.dataset.mode === next);
        });
        overlay.querySelectorAll('.stm-agent-pane').forEach(p => {
            const pane = p.dataset.pane;
            const show = pane === 'chat' ? next === 'chat' : next === 'lorebook' || next === 'entries';
            p.style.display = show ? '' : 'none';
        });
        if (modeHint) {
            modeHint.innerHTML = next === 'chat'
                ? 'Chat → scene cards from a message range.'
                : next === 'entries' ? loreHintEntries : loreHintLorebook;
        }
        runBtn.textContent = next === 'entries' ? 'Build one card' : next === 'lorebook' ? 'Audit lorebook' : 'Run agent';
    };

    overlay.querySelectorAll('.stm-agent-tab').forEach(btn => {
        btn.addEventListener('click', () => setMode(btn.dataset.mode));
    });
    overlay.querySelector('#stm-agent-cubbies').addEventListener('change', refreshEntries);
    overlay.querySelector('#stm-agent-books').addEventListener('change', refreshEntries);
    overlay.querySelector('#stm-agent-entries').addEventListener('change', updateEntryCount);
    overlay.querySelector('#stm-agent-check-all').addEventListener('click', () => {
        const boxes = [...overlay.querySelectorAll('.stm-agent-entry-check')];
        const fresh = boxes.filter(c => c.dataset.stamped !== '1');
        const allOn = fresh.length && fresh.every(c => c.checked);
        fresh.forEach(c => { c.checked = !allOn; });
        updateEntryCount();
    });

    const collectEntries = () => {
        const out = [];
        const leaves = listLibraryLeaves(this.storage, this._wiBooks);
        overlay.querySelectorAll('.stm-agent-entry-check:checked').forEach(cb => {
            if (cb.dataset.libKey) {
                const leaf = leaves.find(l => l.key === cb.dataset.libKey);
                if (leaf) out.push(leafAsWiEntry(leaf));
                return;
            }
            const book = this._wiBooks.find(b => b.name === cb.dataset.book);
            const e = book?.entries[parseInt(cb.dataset.idx, 10)];
            if (!e) return;
            const libKey = libraryEntryKey(book.name, e.uid);
            out.push({ ...e, _libKey: libKey, _bookName: book.name });
        });
        return out;
    };

    const stage = overlay.querySelector('#stm-agent-stage');
    const beatEl = overlay.querySelector('.stm-agent-beat');
    const fillEl = overlay.querySelector('.stm-progress-fill');
    const abortBtn = overlay.querySelector('#stm-agent-abort');
    const BEATS = ['Lights up…', 'Rolling…', 'Slating the scene…', 'Grouping pages…', 'Stamping keywords…', 'Cue credits…'];
    let beatAbort = null;
    let beatHold = '';

    const sleep = (ms, signal) => new Promise((resolve, reject) => {
        const t = setTimeout(resolve, ms);
        signal?.addEventListener('abort', () => { clearTimeout(t); reject(new Error('abort')); }, { once: true });
    });

    const typeLine = async (text, signal) => {
        beatEl.textContent = '';
        for (let i = 1; i <= text.length; i++) {
            if (signal.aborted) return;
            beatEl.textContent = text.slice(0, i);
            await sleep(32, signal).catch(() => {});
        }
        await sleep(2800, signal).catch(() => {});
        if (signal.aborted) return;
        for (let i = text.length; i >= 0; i--) {
            if (signal.aborted) return;
            beatEl.textContent = text.slice(0, i);
            await sleep(18, signal).catch(() => {});
        }
    };

    const runBeats = async (signal) => {
        let i = 0;
        while (!signal.aborted) {
            const line = beatHold || BEATS[i % BEATS.length];
            beatHold = '';
            await typeLine(line, signal);
            i++;
            await sleep(220, signal).catch(() => {});
        }
    };

    const setRunning = (on, { revealSelect = true } = {}) => {
        stage.hidden = !on;
        if (selectEl) selectEl.hidden = on ? true : !revealSelect;
        runBtn.disabled = on;
        runBtn.hidden = on;
        overlay.querySelector('#stm-agent-cancel').disabled = on;
        const refreshBtn = overlay.querySelector('#stm-agent-refresh-stamps');
        if (refreshBtn) refreshBtn.disabled = on;
        if (beatAbort) { beatAbort.abort(); beatAbort = null; }
        if (on) {
            hideStatus();
            fillEl.style.width = '8%';
            beatAbort = new AbortController();
            runBeats(beatAbort.signal);
        } else {
            fillEl.style.width = '0%';
        }
    };

    overlay.querySelector('#stm-agent-cancel').addEventListener('click', close);
    overlay.querySelector('#stm-agent-dismiss')?.addEventListener('click', () => {
        hideStatus();
        if (selectEl) selectEl.hidden = false;
        runBtn.hidden = false;
        runBtn.disabled = false;
    });
    overlay.querySelector('#stm-agent-view')?.addEventListener('click', () => {
        const uid = lastCreatedUids[0];
        close();
        if (uid) this._revealScriptCard(uid);
    });
    overlay.querySelector('#stm-agent-refresh-stamps').addEventListener('click', () => {
        const n = this._refreshLibraryStamps();
        refreshStampChrome();
        showStatus(n
            ? `Refreshed stamps — updated ${n} Library tag list${n === 1 ? '' : 's'}.`
            : 'Stamps already match Script cards.', { ok: true });
    });
    overlay.addEventListener('click', e => { if (e.target === overlay && stage.hidden) close(); });
    abortBtn.addEventListener('click', () => {
        this._cancelAgent();
        beatHold = 'Cut! Wrapping…';
        beatEl.textContent = 'Cut! Wrapping…';
    });

    runBtn.addEventListener('click', async () => {
        persistBudget();
        this._agentCancelled = false;
        this._agentChatToken = getContext()?.chatMetadata ?? null;
        setRunning(true);
        const onPass = (pass, total, phase) => {
            if (phase === 'group') beatHold = total > 1 ? `Grouping pass ${pass} of ${total}…` : 'Grouping scenes…';
            else if (phase === 'build') beatHold = total > 1 ? `Building card ${pass} of ${total}…` : 'Building card…';
            else beatHold = total > 1 ? `Pass ${pass} of ${total}…` : '';
            fillEl.style.width = Math.min(90, 8 + (pass / Math.max(1, total)) * 80) + '%';
        };
        try {
            let count = 0;
            let cards = [];
            if (mode === 'chat') {
                const from = parseInt(overlay.querySelector('#stm-agent-from').value, 10);
                const to = parseInt(overlay.querySelector('#stm-agent-to').value, 10);
                if (Number.isNaN(from) || Number.isNaN(to)) throw new Error('Select a message range.');
                const lo = Math.min(from, to);
                const hi = Math.max(from, to);
                beatHold = `Scanning messages ${lo}–${hi}…`;
                const chat = await this._runChatAgent(lo, hi, (p, t) => onPass(p, t, 'build'));
                count = chat.count;
                cards = chat.cards || [];
            } else if (mode === 'entries') {
                const selected = collectEntries();
                if (!selected.length) throw new Error('Select lorebook entries first.');
                beatHold = `Auditing ${selected.length} entr${selected.length === 1 ? 'y' : 'ies'} → one card…`;
                const lore = await this._runLoreEntriesAudit(selected, onPass);
                count = lore.count;
                cards = lore.cards || [];
                const stamped = this._stampLibraryScenes(selected, lore.cards);
                if (stamped) beatHold = `Labelled ${stamped} with ${lore.cards.map(c => sceneCode(c, this._db())).filter(Boolean).join(', ')}`;
            } else {
                const selected = collectEntries();
                if (!selected.length) throw new Error('Select lorebook entries first.');
                beatHold = `Auditing ${selected.length} entries…`;
                const lore = await this._runLorebookAudit(selected, onPass);
                count = lore.count;
                cards = lore.cards || [];
                const stamped = this._stampLibraryScenes(selected, lore.cards);
                if (stamped) beatHold = `Labelled ${stamped} with ${lore.cards.map(c => sceneCode(c, this._db())).filter(Boolean).join(', ')}`;
            }
            fillEl.style.width = '100%';
            beatHold = 'Print it!';
            beatEl.textContent = 'Print it!';
            lastCreatedUids = cards.map(c => c.uid).filter(Boolean);
            const title = cards[0]?.title ? ` “${cards[0].title}”` : '';
            showStatus(
                count === 1
                    ? `✓ Card created${title}.`
                    : `✓ ${count} card(s) created.`,
                { ok: true, viewable: lastCreatedUids.length > 0 },
            );
            this._rerender();
        } catch (err) {
            showStatus(`✗ ${err.message}`, { ok: false });
            beatEl.textContent = this._agentCancelled ? 'Cut.' : 'Flubbed take.';
            lastCreatedUids = [];
        } finally {
            const okDone = lastCreatedUids.length > 0;
            setRunning(false, { revealSelect: !okDone });
            if (okDone) runBtn.hidden = true;
        }
    });

    setMode(initialMode);
    refreshEntries();
}

/** Focus a Script card on the shelf after Agent create. */
_revealScriptCard(uid) {
    const card = this._getCard(uid);
    if (!card) return;
    const db = this._db();
    db.settings.view = 'tree';
    this._save(db);
    let p = card.parentUid;
    while (p) {
        this._expandedUids.add(p);
        p = this._getCard(p)?.parentUid || null;
    }
    this._selectedUid = card.uid;
    this._focusedUid = card.uid;
    this._editingCardUid = null;
    this._rerender();
}

_keywordPillsHTML(card, { open = false } = {}) {
    const facets = normalizeFacets(card.keywordFacets);
    const inFacets = new Set(KEYWORD_EDIT_FACETS.flatMap(f => facets[f.id] || []).map(s => String(s).toLowerCase()));
    const extra = (card.keywords || []).filter(k => k && !inFacets.has(String(k).toLowerCase()));
    const has = KEYWORD_EDIT_FACETS.some(f => facets[f.id]?.length) || extra.length;
    if (!has) {
        return `<details class="stm-kw-drop"><summary>Keywords</summary><p class="stm-settings-hint">None yet.</p></details>`;
    }
    const pill = (facet, v) => {
        const on = this._keywordFilter?.facet === facet && this._keywordFilter?.value === v;
        const kind = facetClass(facet);
        return `<button type="button" class="stm-pill stm-pill--${kind}${on ? ' stm-pill--on' : ''}" data-facet="${esc(facet)}" data-value="${esc(v)}" title="${esc(facetTag(facet))}">${esc(v)}</button>`;
    };
    const chips = [
        ...KEYWORD_EDIT_FACETS.flatMap(f => (facets[f.id] || []).map(v => pill(f.id, v))),
        ...extra.map(v => pill('', v)),
    ].join('');
    return `<details class="stm-kw-drop" ${open ? 'open' : ''}><summary>Keywords</summary><div class="stm-pills">${chips}</div></details>`;
}

_bindKeywordPills(root) {
    root.querySelectorAll('.stm-pill').forEach(btn => {
        btn.addEventListener('click', e => {
            e.preventDefault();
            e.stopPropagation();
            const value = btn.dataset.value;
            const facet = btn.dataset.facet;
            if (this._keywordFilter?.value === value && this._keywordFilter?.facet === facet) {
                this._keywordFilter = null;
            } else {
                this._keywordFilter = { facet, value };
            }
            this._rerender();
        });
    });
}

_facetEditorHTML(card) {
    const facets = normalizeFacets(card.keywordFacets);
    const pills = KEYWORD_EDIT_FACETS.flatMap(f =>
        (facets[f.id] || []).map(v => this._keywordEditChipHTML(f.id, v))
    ).join('');
    return `<div class="stm-kw-editor">
        <div class="stm-pills">${pills || '<span class="stm-settings-hint">None yet.</span>'}</div>
        <button type="button" class="stm-btn stm-kw-add-btn">＋ Add keywords</button>
    </div>`;
}

_keywordEditChipHTML(facet, value) {
    const kind = facetClass(facet);
    return `<span class="stm-pill stm-pill-edit stm-pill--${kind}" data-facet="${esc(facet)}" data-value="${esc(value)}" title="${esc(facetTag(facet))}">
      <button type="button" class="stm-pill-cat" data-action="kw-cycle" title="Change type">${esc(facetTag(facet))}</button>
      <span class="stm-pill-val">${esc(value)}</span>
      <button type="button" class="stm-pill-x" title="Remove">×</button>
    </span>`;
}

_cycleKeywordChip(btn) {
    const pill = btn.closest('.stm-pill-edit');
    if (!pill) return;
    const ids = KEYWORD_EDIT_FACETS.map(f => f.id);
    let idx = ids.indexOf(pill.dataset.facet);
    if (idx < 0) idx = -1;
    const next = ids[(idx + 1) % ids.length];
    pill.dataset.facet = next;
    pill.className = `stm-pill stm-pill-edit stm-pill--${facetClass(next)}`;
    pill.title = facetTag(next);
    btn.textContent = facetTag(next);
}

_bindFacetEditor(el) {
    el.querySelector('.stm-kw-add-btn')?.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        this._openKeywordAddDialog(el);
    });
    el.addEventListener('click', e => {
        const cycle = e.target.closest('[data-action="kw-cycle"]');
        if (cycle) {
            e.preventDefault();
            e.stopPropagation();
            this._cycleKeywordChip(cycle);
            return;
        }
        const x = e.target.closest('.stm-pill-x');
        if (!x || x.closest('.stm-credit-wrap')) return;
        e.preventDefault();
        e.stopPropagation();
        x.closest('.stm-pill-edit')?.remove();
    });
}

_openKeywordAddDialog(formEl) {
    const overlay = document.createElement('div');
    overlay.className = 'stm-dialog-overlay';
    const cal = this._cal();
    const typeOpts = KEYWORD_EDIT_FACETS.map(f =>
        `<option value="${esc(f.id)}">${esc(f.tag)}</option>`
    ).join('');
    overlay.innerHTML = `
        <div class="stm-dialog stm-dialog--kw">
            <div class="stm-dialog-header">Add keywords</div>
            <div class="stm-dialog-body">
                <div class="stm-form-row">
                    <label>Type</label>
                    <select id="stm-kw-type">${typeOpts}</select>
                </div>
                <div class="stm-form-row" id="stm-kw-text-wrap">
                    <label>Keywords <span class="stm-hint">(comma-separated)</span></label>
                    <input id="stm-kw-values" type="text" placeholder="harbor, lantern, night market">
                </div>
                <div class="stm-form-row" id="stm-kw-loc-wrap" hidden style="display:none">
                    <label>Location</label>
                    ${locationTagEditorHTML({
                        selected: [],
                        fieldRole: 'stm-kw-loctags',
                        emptyHint: 'Pick a known location or add a new one.',
                    })}
                </div>
                <div class="stm-form-row" id="stm-kw-cal-wrap" hidden style="display:none">
                    <label>Calendar time</label>
                    ${this._calendarPickerHTML({ inputName: 'stm-kw-values', idPrefix: 'stm-kw-tp', scaleFilter: true })}
                </div>
            </div>
            <div class="stm-dialog-footer">
                <button type="button" id="stm-kw-cancel" class="stm-btn">Cancel</button>
                <button type="button" id="stm-kw-ok" class="stm-btn stm-btn-primary">Add</button>
            </div>
        </div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    const input = overlay.querySelector('#stm-kw-values');
    const typeSel = overlay.querySelector('#stm-kw-type');
    const calWrap = overlay.querySelector('#stm-kw-cal-wrap');
    const textWrap = overlay.querySelector('#stm-kw-text-wrap');
    const locWrap = overlay.querySelector('#stm-kw-loc-wrap');

    bindLocationCatalogPicker(overlay.querySelector('.st-loctag-wrap[data-role="stm-kw-loctags"]'), this.storage);

    const syncMode = () => {
        const isDate = typeSel.value === 'datetime';
        const isLoc = typeSel.value === 'location';
        calWrap.hidden = !isDate;
        calWrap.style.display = isDate ? '' : 'none';
        locWrap.hidden = !isLoc;
        locWrap.style.display = isLoc ? '' : 'none';
        textWrap.hidden = isLoc;
        textWrap.style.display = isLoc ? 'none' : '';
        input.placeholder = isDate
            ? 'Day 3, Mid Spring… or build below'
            : 'harbor, lantern, night market';
        if (isLoc) {
            overlay.querySelector('.st-loctag-search')?.focus();
        } else {
            input.focus();
        }
    };
    typeSel.addEventListener('change', syncMode);
    syncMode();
    this._bindCalendarPicker(overlay, {
        onPick: (key) => {
            const cur = input.value.trim();
            input.value = cur ? `${cur}, ${key}` : key;
            input.focus();
        },
    });
    syncMode();

    const commit = () => {
        const facet = typeSel.value;
        const values = facet === 'location'
            ? readLocationTags(overlay.querySelector('.st-loctag-wrap[data-role="stm-kw-loctags"]'))
            : input.value.split(',').map(s => s.trim()).filter(Boolean);
        if (!values.length) {
            if (facet === 'location') {
                overlay.querySelector('.st-loctag-search')?.classList.add('stm-input-error');
                overlay.querySelector('.st-loctag-search')?.focus();
            } else {
                input.classList.add('stm-input-error');
                input.focus();
            }
            return;
        }
        const wrap = formEl.querySelector('.stm-kw-editor .stm-pills');
        if (!wrap) { close(); return; }
        wrap.querySelector('.stm-settings-hint')?.remove();
        const existing = new Set([...wrap.querySelectorAll('.stm-pill-edit')].map(p =>
            `${p.dataset.facet}\0${String(p.dataset.value || '').toLowerCase()}`
        ));
        for (const v of values) {
            const key = `${facet}\0${v.toLowerCase()}`;
            if (existing.has(key)) continue;
            existing.add(key);
            wrap.insertAdjacentHTML('beforeend', this._keywordEditChipHTML(facet, v));
        }
        if (facet === 'datetime') {
            const spanInput = formEl.querySelector('[name="span"]');
            if (spanInput && !spanInput.value.trim()) {
                for (const v of values) {
                    if (parseTimeKey(v, cal) || parseTimeRange(v, cal)) { spanInput.value = v; break; }
                }
            }
        }
        close();
    };
    overlay.querySelector('#stm-kw-cancel').addEventListener('click', close);
    overlay.querySelector('#stm-kw-ok').addEventListener('click', commit);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    overlay.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.target.closest('.st-loctag-wrap')) { e.preventDefault(); commit(); }
        if (e.key === 'Escape') close();
    });
}

_readFacets(el) {
    const facets = emptyFacets();
    el.querySelectorAll('.stm-pill-edit').forEach(p => {
        const id = p.dataset.facet;
        const v = p.dataset.value;
        if (id === 'characters') return; // obsolete — use Credits
        if (id && v && facets[id]) facets[id].push(v);
    });
    facets.characters = [];
    return facets;
}

// ── Collapsed card HTML ───────────────────────────────────────────────────────
  _quotesViewHTML(card) {
    const quotes = card.quotes || [];
    if (!quotes.length) return '';
    return `<div class="stm-quotes">${quotes.map(q =>
        `<blockquote class="stm-quote">${esc(q.text)}${q.character ? ` <cite>— ${esc(q.character)}</cite>` : ''}</blockquote>`
    ).join('')}</div>`;
  }

  _creditChipsHTML(card, { editable = false } = {}) {
    const members = this._castMembers();
    const credits = (card.credits || []).filter(cr => !isDirectorRole(this._liveCreditRole(cr, members)));
    if (!editable) {
      if (!credits.length) return '';
      const rows = credits.map(cr => {
        const role = this._liveCreditRole(cr, members);
        const id = cr.characterId || '';
        const name = cr.name || '(unnamed)';
        return `<button type="button" class="stm-credit-name-btn" data-id="${esc(id)}" data-name="${esc(name)}" title="${esc(creditRoleLabel(role))}">
            <span class="stm-credit-name">${esc(name)}</span>
          </button>`;
      }).join('');
      return `<div class="stm-credit-wrap">
        <div class="stm-pill-label">Credits</div>
        <div class="stm-credit-list-view">${rows}</div>
      </div>`;
    }
    const chips = credits.map(cr => {
        const role = this._liveCreditRole(cr, members);
        const npc = !cr.characterId;
        return `<span class="stm-credit-chip${npc ? ' stm-credit-chip--npc' : ''}" data-id="${esc(cr.characterId || '')}" data-name="${esc(cr.name || '')}">
            <span class="stm-credit-name">${esc(cr.name || '(unnamed)')}</span>
            <span class="stm-credit-pri">${esc(creditRoleLabel(role))}</span>
            ${npc ? `<button type="button" class="stm-credit-cast" title="Add to Cast">Cast</button>` : ''}
            <button type="button" class="stm-pill-x stm-credit-x" title="Remove">×</button>
        </span>`;
    }).join('');
    return `<div class="stm-credit-wrap">
        <div class="stm-pill-label">Credits</div>
        <div class="stm-credit-chips">${chips || '<span class="stm-settings-hint">None yet — credit cast or add a new NPC.</span>'}</div>
        <div class="stm-credit-tools">
            <input type="text" class="stm-credit-search" placeholder="Credit cast member…" autocomplete="off">
            <button type="button" class="stm-btn stm-credit-new-cast" title="Create an NPC in Cast">＋ New cast</button>
            <div class="stm-credit-suggest" hidden></div>
        </div>
    </div>`;
  }

  _sponsorsHTML(card, { editable = false } = {}) {
    const sponsors = (card.sponsors || []).map(sp => this._liveSponsor(sp)).filter(Boolean);
    if (!editable) {
      if (!sponsors.length) return '';
      const rows = sponsors.map(sp =>
        `<button type="button" class="stm-sponsor-name-btn" data-id="${esc(sp.id || '')}" data-name="${esc(sp.name)}" data-kind="${esc(sp.kind)}" title="${esc(sp.typeLabel)}">
            <span class="stm-sponsor-name">${esc(sp.name)}</span>
            <span class="stm-sponsor-kind">${esc(sp.typeLabel)}</span>
          </button>`
      ).join('');
      return `<div class="stm-sponsor-wrap">
        <div class="stm-pill-label">Sponsored by</div>
        <div class="stm-sponsor-list-view">${rows}</div>
      </div>`;
    }
    const chips = sponsors.map(sp =>
      `<span class="stm-sponsor-chip" data-id="${esc(sp.id || '')}" data-name="${esc(sp.name)}" data-kind="${esc(sp.kind)}" data-type="${esc(sp.typeLabel)}">
            <span class="stm-sponsor-name">${esc(sp.name)}</span>
            <span class="stm-sponsor-kind">${esc(sp.typeLabel)}</span>
            <button type="button" class="stm-pill-x stm-sponsor-x" title="Remove">×</button>
        </span>`
    ).join('');
    return `<div class="stm-sponsor-wrap">
        <div class="stm-pill-label">Sponsored by</div>
        <div class="stm-sponsor-chips">${chips || '<span class="stm-settings-hint">None yet — link an Affiliation or dossier.</span>'}</div>
        <div class="stm-sponsor-tools">
            <input type="text" class="stm-sponsor-search" placeholder="Affiliation, group, or dossier…" autocomplete="off">
            <div class="stm-sponsor-suggest" hidden></div>
        </div>
    </div>`;
  }

  _folderCoverHTML(card) {
    const src = String(card?.coverImage || '').trim();
    if (!src) return '';
    const below = card.coverPlacement === 'below';
    return `<div class="stm-folder-cover${below ? ' stm-folder-cover--below' : ''}" aria-hidden="true">
      <img src="${esc(src)}" alt="">
    </div>`;
  }

  _folderCoverFieldsHTML(card = {}) {
    const src = String(card.coverImage || '').trim();
    const below = card.coverPlacement === 'below';
    return `
      <div class="stm-form-row">
        <label>Folder image</label>
        <input type="text" name="coverImage" id="stm-folder-cover" value="${esc(src)}" placeholder="https://… or pick a file">
        <div class="stm-folder-cover-tools">
          <input type="file" accept="image/*" data-role="cover-file" hidden>
          <button type="button" class="stm-btn" data-role="cover-pick">Choose file…</button>
          <button type="button" class="stm-btn" data-role="cover-clear">Clear</button>
        </div>
        <div class="stm-folder-cover stm-folder-cover--preview" data-role="cover-preview" ${src ? '' : 'hidden'}>
          <img src="${esc(src)}" alt="">
        </div>
      </div>
      <div class="stm-form-row stm-form-row--toggles">
        <span class="stm-hint">Show image</span>
        <label><input type="radio" name="coverPlacement" value="above" ${below ? '' : 'checked'}> Above title</label>
        <label><input type="radio" name="coverPlacement" value="below" ${below ? 'checked' : ''}> Below title</label>
      </div>`;
  }

  _bindCoverPicker(root) {
    if (!root) return;
    const urlEl = root.querySelector('[name="coverImage"], #stm-folder-cover');
    const fileEl = root.querySelector('[data-role="cover-file"]');
    const prev = root.querySelector('[data-role="cover-preview"]');
    const img = prev?.querySelector('img');
    const syncPrev = () => {
      const url = String(urlEl?.value || '').trim();
      if (prev) prev.hidden = !url;
      if (img) img.src = url || '';
    };
    urlEl?.addEventListener('input', syncPrev);
    root.querySelector('[data-role="cover-pick"]')?.addEventListener('click', e => {
      e.preventDefault();
      fileEl?.click();
    });
    fileEl?.addEventListener('change', () => {
      const f = fileEl.files?.[0];
      if (!f || !urlEl) return;
      const r = new FileReader();
      r.onload = () => { urlEl.value = String(r.result || ''); syncPrev(); };
      r.readAsDataURL(f);
    });
    root.querySelector('[data-role="cover-clear"]')?.addEventListener('click', e => {
      e.preventDefault();
      if (urlEl) urlEl.value = '';
      if (fileEl) fileEl.value = '';
      syncPrev();
    });
    syncPrev();
  }

  _collapsedHTML(card, { compact = false } = {}) {
    const flags    = [
      card.active === false ? '<span class="stm-flag stm-flag-off">off</span>' : '',
    ].filter(Boolean).join('');
    const kids = this._db().cards.filter(c => c.parentUid === card.uid).length;
    const desc = (card.summary || card.content || '').trim();
    const peek = desc.slice(0, 90);
    const org = this._orgCode(card);
    const cover = this._folderCoverHTML(card);

    const top = ({ folder = false } = {}) => folder ? `
      ${card.coverPlacement !== 'below' ? cover : ''}
      <div class="stm-card-top stm-card-top--folder">
        <span class="stm-card-org">${esc(org)}</span>
        <span class="stm-card-title">${esc(card.title || '(untitled)')}</span>
        <div class="stm-card-actions">
          <button class="stm-btn stm-btn-open" title="Open folder">Open</button>
          <button class="stm-btn stm-btn-edit"   title="Edit">✎</button>
          <button class="stm-btn stm-btn-delete" title="Delete">✕</button>
        </div>
      </div>
      ${card.coverPlacement === 'below' ? cover : ''}`       : `
      <div class="stm-card-top">
        <span class="stm-card-org">${esc(isEventCard(card) ? this._eventImpactLabel(card) : org)}</span>
        <span class="stm-card-title">${esc(card.title || '(untitled)')}</span>
        <div class="stm-card-actions">
          ${this._pinButtonHTML(card)}
          <button class="stm-btn stm-btn-edit"   title="Edit">✎</button>
          <button class="stm-btn stm-btn-delete" title="Delete">✕</button>
        </div>
      </div>`;

    if (this._isFolder(card)) {
      if (compact) {
        return `${top({ folder: true })}
          <div class="stm-card-peek">${peek ? esc(peek) : '<span class="stm-settings-hint">No description.</span>'}</div>
          ${kids ? `<div class="stm-folder-meta">${kids} inside</div>` : ''}`;
      }
      return `${top({ folder: true })}
        <div class="stm-folder-desc">${desc ? esc(desc) : '<span class="stm-settings-hint">No description.</span>'}</div>
        ${kids ? `<div class="stm-folder-meta">${kids} inside · Open to browse</div>` : '<div class="stm-folder-meta">Empty · Open to add pages</div>'}
        ${flags}`;
    }

    const eventBanner = isEventCard(card)
      ? `<div class="stm-event-banner">${esc(this._eventImpactLabel(card))}${card.eventRecurring ? ` · ${esc(EVENT_RECUR_OPTS.find(o => o.id === card.eventRecur)?.label || 'Recurring')}` : ''}</div>`
      : '';

    if (compact) {
      return `${top()}
        ${eventBanner}
        ${card.span ? `<div class="stm-card-span">${esc(card.span)}</div>` : ''}
        <div class="stm-card-peek">${esc((card.summary || card.content || '').slice(0, 110))}</div>
        ${this._keywordPillsHTML(card, { open: false })}`;
    }

    return `${top()}
      ${eventBanner}
      ${card.span ? `<div class="stm-card-span">${esc(card.span)}</div>` : ''}
      <div class="stm-card-summary">${esc(card.summary || card.content || '')}</div>
      ${this._quotesViewHTML(card)}
      ${this._creditChipsHTML(card, { editable: false })}
      ${this._sponsorsHTML(card, { editable: false })}
      ${this._connLogHTML(card)}
      ${this._keywordPillsHTML(card, { open: false })}
      ${this._sourceStampHTML(card)}
      ${flags}`;
  }

  _connLogHTML(card) {
    const log = normalizeConnLog(card.connectionLog);
    if (!log.length) return '';
    const rows = [...log].reverse().map(m => {
      const when = formatConnAt(m.at);
      let iso = '';
      try { if (m.at) iso = new Date(m.at).toISOString(); } catch { /* ignore */ }
      return `<li>${when ? `<time datetime="${esc(iso)}">${esc(when)}</time>` : ''}${esc(formatConnMark(m))}</li>`;
    }).join('');
    return `<details class="stm-conn-log">
      <summary>Ties · ${log.length}</summary>
      <ol class="stm-conn-log-list">${rows}</ol>
    </details>`;
  }

  _sourceStampHTML(card) {
    const stamp = normalizeSourceStamp(card.sourceStamp);
    if (!stamp?.entries?.length) {
      return card.sourceBook
        ? `<div class="stm-source-stamp" title="Source book"><span class="stm-source-stamp-mark">⌘</span> ${esc(card.sourceBook)}</div>`
        : '';
    }
    const lines = stamp.entries.map(e => {
      const bit = [e.book, e.title].filter(Boolean).join(' · ');
      return `<li>${esc(bit || e.key || e.uid || 'entry')}</li>`;
    }).join('');
    return `<details class="stm-source-stamp">
      <summary><span class="stm-source-stamp-mark">⌘</span> From ${stamp.entries.length} lore entr${stamp.entries.length === 1 ? 'y' : 'ies'}${card.sourceBook ? ` · ${esc(card.sourceBook)}` : ''}</summary>
      <ul class="stm-source-stamp-list">${lines}</ul>
    </details>`;
  }

  _quotesEditorHTML(card) {
    const lines = (card.quotes || []).map(q =>
      q.character ? `${q.character}: ${q.text}` : (q.text || '')
    ).join('\n');
    return `<textarea name="highlights" rows="4" placeholder="One highlight per line. Optional: Name: quote">${esc(lines)}</textarea>`;
  }

  _parseHighlights(text) {
    return String(text || '').split('\n').map(line => line.trim()).filter(Boolean).map(s => {
      const qm = s.match(/^(.+?):\s*[“"']?(.+?)[”"']?\s*$/);
      if (qm && qm[1].length < 48) return { character: qm[1].trim(), text: qm[2].trim() };
      return { character: '', text: s.replace(/^["“]|["”]$/g, '') };
    });
  }

// ── Edit form HTML ────────────────────────────────────────────────────────────
  _editFormHTML(card) {
    const db = this._db();
    const isFolder = this._isFolder(card);
    const levelOpts = db.settings.levels.map(l =>
      `<option value="${esc(l.id)}" ${l.id === card.levelId ? 'selected' : ''}>${esc(l.label)}</option>`
    ).join('');

    if (isFolder) {
      return `
      <div class="stm-form-row">
        <label>Title <span class="stm-required">*</span></label>
        <input type="text" name="title" value="${esc(card.title || '')}" placeholder="Folder title…">
      </div>
      ${this._folderCoverFieldsHTML(card)}
      <div class="stm-form-row stm-form-row--tall">
        <label>Description</label>
        <textarea name="summary" rows="5" placeholder="What this folder holds…">${esc(card.summary || card.content || '')}</textarea>
      </div>
      <div class="stm-form-actions">
        <button class="stm-btn stm-btn-cancel" type="button">Cancel</button>
        <button class="stm-btn stm-btn-save"   type="button">Save</button>
      </div>`;
    }

    if (isEventCard(card)) {
      return `
      ${this._eventScaleFieldsHTML(card)}
      <div class="stm-form-row">
        <label>Title <span class="stm-required">*</span></label>
        <input type="text" name="title" value="${esc(card.title || '')}" placeholder="Event title…">
      </div>
      <div class="stm-form-row stm-form-row--toggles">
        <label><input type="checkbox" name="pinned" ${card.pinned ? 'checked' : ''}> Pinned (always inject)</label>
        <label><input type="checkbox" name="onTimeline" ${card.timelineOff ? '' : 'checked'}> Show on timeline</label>
        <label><input type="checkbox" name="active" ${card.active !== false ? 'checked' : ''}> Active</label>
      </div>
      <div class="stm-form-row">
        <label>Time / date <span class="stm-required">*</span></label>
        <input type="text" name="span" value="${esc(card.span || this._cardTimeKey(card) || '')}" placeholder="${esc(this._calendarTimePlaceholder())}">
        <div class="stm-cal-hints">${this._calendarTimeHintsHTML(card)}</div>
        ${this._setTimeDetailsHTML(card)}
      </div>
      <div class="stm-form-row stm-form-row--tall">
        <label>Description <span class="stm-hint">(injected when this event is near the present)</span></label>
        <textarea name="summary" rows="5" placeholder="What happens…">${esc(card.summary || card.content || '')}</textarea>
      </div>
      ${this._creditChipsHTML(card, { editable: true })}
      <div class="stm-form-actions">
        <button class="stm-btn stm-btn-cancel" type="button">Cancel</button>
        <button class="stm-btn stm-btn-save"   type="button">Save</button>
      </div>`;
    }

    return `
      <div class="stm-form-row">
        <label>Level</label>
        <select name="kind">${levelOpts}</select>
      </div>
      <div class="stm-form-row">
        <label>Title <span class="stm-required">*</span></label>
        <input type="text" name="title" value="${esc(card.title || '')}" placeholder="Title…">
      </div>
      <div class="stm-form-row stm-form-row--toggles">
        <label><input type="checkbox" name="pinned" ${card.pinned ? 'checked' : ''}> Pinned (always inject)</label>
        <label><input type="checkbox" name="timeLocked" ${card.timeLocked ? 'checked' : ''}> Lock on timeline</label>
        <label><input type="checkbox" name="onTimeline" ${card.timelineOff ? '' : 'checked'}> Show on timeline</label>
        <label><input type="checkbox" name="active" ${card.active !== false ? 'checked' : ''}> Active</label>
      </div>
      <div class="stm-form-row">
        <label>Span <span class="stm-hint">(timeline placement)</span></label>
        <input type="text" name="span" value="${esc(card.span || this._cardTimeKey(card) || '')}" placeholder="${esc(this._calendarTimePlaceholder('span'))}">
        <div class="stm-cal-hints">${this._calendarTimeHintsHTML(card)}</div>
        ${this._setTimeDetailsHTML(card)}
      </div>
      <div class="stm-form-row stm-form-row--tall">
        <label>Summary <span class="stm-hint">(injected when pinned or keyword-matched)</span></label>
        <textarea name="summary" rows="5" placeholder="One paragraph…">${esc(card.summary || card.content || '')}</textarea>
      </div>
      <div class="stm-form-row stm-form-row--tall">
        <label>Highlights / Quotes</label>
        ${this._quotesEditorHTML(card)}
      </div>
      ${this._creditChipsHTML(card, { editable: true })}
      ${this._sponsorsHTML(card, { editable: true })}
      <details class="stm-kw-drop" open>
        <summary>Keywords</summary>
        ${this._facetEditorHTML(card)}
      </details>
      <div class="stm-form-actions">
        <button class="stm-btn stm-btn-cancel" type="button">Cancel</button>
        <button class="stm-btn stm-btn-save"   type="button">Save</button>
      </div>
    `;
  }

// ── Collapsed event listeners ─────────────────────────────────────────────────
  _attachCollapsedListeners(el, card, isFocused) {
    el.querySelector('.stm-btn-pin')?.addEventListener('click', e => {
      e.stopPropagation();
      this._togglePinned(card);
    });

    el.querySelector('.stm-btn-open')?.addEventListener('click', e => {
      e.stopPropagation();
      this._selectedUid = card.uid;
      this._focusedUid = null;
      this._editingCardUid = null;
      this._expandedUids.add(card.uid);
      this._rerender();
    });

    el.querySelector('.stm-btn-edit').addEventListener('click', e => {
      e.stopPropagation();
      this._focusedUid = card.uid;
      this._selectedUid = card.uid;
      this._editingCardUid = card.uid;
      this._refreshDrawer();
    });

    el.querySelector('.stm-btn-delete').addEventListener('click', e => {
      e.stopPropagation();
      if (!confirm(`Delete "${card.title || 'this card'}"?`)) return;
      this._deleteCard(card.uid);
      if (this._editingCardUid === card.uid) this._editingCardUid = null;
      if (this._focusedUid === card.uid) this._focusedUid = null;
      if (this._selectedUid === card.uid) this._selectedUid = card.parentUid || null;
      this._rerender();
    });

    this._bindKeywordPills(el);
    this._bindCreditNameMenus(el);
    this._bindSponsorNameMenus(el);
    this._bindNpcCastButtons(el, card);

    el.addEventListener('click', e => {
      if (e.target.closest('.stm-card-actions')) return;
      if (e.target.closest('.stm-kw-drop')) return;
      if (e.target.closest('.stm-credit-wrap')) return;
      if (e.target.closest('.stm-sponsor-wrap')) return;
      if (e.target.closest('.stm-conn-log')) return;
      if (e.target.closest('.stm-credit-menu')) return;
      if (e.target.closest('.stm-sponsor-menu')) return;
      if (e.target.closest('button')) return;
      if (this._isFolder(card)) {
        // Focus as a simple page; use Open / shelf tree to browse inside.
        if (isFocused) {
          if (e.target.closest('.stm-card-top')) {
            this._focusedUid = null;
            this._editingCardUid = null;
            this._rerender();
          }
          return;
        }
        this._focusedUid = card.uid;
        this._selectedUid = card.uid;
        this._editingCardUid = null;
        this._rerender();
        return;
      }
      if (isFocused) {
        if (e.target.closest('.stm-card-top')) {
          this._focusedUid = null;
          this._editingCardUid = null;
          this._rerender();
        }
        return;
      }
      this._focusedUid = card.uid;
      this._selectedUid = card.uid;
      this._editingCardUid = null;
      this._rerender();
    });
  }

  _bindCreditNameMenus(el) {
    el.querySelectorAll('.stm-credit-name-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        this._openCreditMenu(btn, {
          id: btn.dataset.id || '',
          name: btn.dataset.name || '',
        });
      });
    });
  }

  _openCreditMenu(anchor, { id = '', name = '' } = {}) {
    document.querySelectorAll('.stm-credit-menu').forEach(n => n.remove());
    const menu = document.createElement('div');
    menu.className = 'stm-credit-menu';
    const hasCast = !!(id && this._castMembers().some(m => m.id === id));
    menu.innerHTML = `
      <button type="button" data-act="recast" ${hasCast ? '' : 'disabled'} title="${hasCast ? 'Open Cast editor' : 'Not on Cast roster yet'}">Recast</button>
      <button type="button" data-act="connections" ${hasCast ? '' : 'disabled'}>Connections</button>
      <button type="button" data-act="motivations" ${hasCast ? '' : 'disabled'}>Motivations</button>
      ${!hasCast && name ? `<button type="button" data-act="add-cast">Add to Cast</button>` : ''}`;
    const rect = anchor.getBoundingClientRect();
    menu.style.left = `${Math.min(window.innerWidth - 180, Math.max(8, rect.left))}px`;
    menu.style.top = `${Math.min(window.innerHeight - 120, rect.bottom + 4)}px`;
    document.body.appendChild(menu);
    const close = () => {
      menu.remove();
      document.removeEventListener('mousedown', onDoc);
    };
    const onDoc = (ev) => {
      if (!menu.contains(ev.target) && ev.target !== anchor) close();
    };
    setTimeout(() => document.addEventListener('mousedown', onDoc), 0);
    menu.addEventListener('click', async (ev) => {
      const act = ev.target.closest('[data-act]')?.dataset.act;
      if (!act) return;
      ev.preventDefault();
      close();
      if (act === 'add-cast') {
        const added = this._addNpcToCast(name);
        if (added) this._jumpToCastMember(added.id, 'recast');
        return;
      }
      if (!id) return;
      await this._jumpToCastMember(id, act);
    });
  }

  async _jumpToCastMember(castId, action = 'recast') {
    const app = window.Showtime;
    if (!app?.shell?.activate) return;
    if (action === 'recast') {
      await app.shell.activate('cast');
      const cast = app.modules?.get?.('cast');
      const member = cast?._find?.(castId);
      if (member) cast._openCastingCall(member);
      return;
    }
    if (action === 'connections') {
      const rep = app.modules?.get?.('reputation');
      if (rep) {
        try {
          rep._ensurePersonNode?.(castId);
          const node = rep._findPersonNode?.(castId);
          if (node) {
            rep.state.focusId = node.id;
            rep.state.inspectedId = node.id;
            rep._cardMode = 'connections';
            rep.saveState?.();
          }
        } catch { /* ignore */ }
      }
      await app.shell.activate('reputation');
      return;
    }
    if (action === 'motivations') {
      const mot = app.modules?.get?.('motivation');
      if (mot?.state) {
        mot.state.selectedId = castId;
        mot.saveState?.();
      }
      await app.shell.activate('motivation');
    }
  }

  _bindSponsorNameMenus(el) {
    el.querySelectorAll('.stm-sponsor-name-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        this._openSponsorMenu(btn, {
          id: btn.dataset.id || '',
          name: btn.dataset.name || '',
          kind: btn.dataset.kind || 'dossier',
        });
      });
    });
  }

  _openSponsorMenu(anchor, { id = '', name = '', kind = 'dossier' } = {}) {
    document.querySelectorAll('.stm-sponsor-menu, .stm-credit-menu').forEach(n => n.remove());
    const menu = document.createElement('div');
    menu.className = 'stm-sponsor-menu';
    const linked = !!id;
    menu.innerHTML = `
      <button type="button" data-act="open" ${linked ? '' : 'disabled'} title="${linked ? 'Open in Connections' : 'No linked dossier'}">Open in Connections</button>
      ${!linked && name ? `<span class="stm-settings-hint" style="padding:6px 10px;display:block">Unlinked label — edit the card to attach a dossier.</span>` : ''}`;
    const rect = anchor.getBoundingClientRect();
    menu.style.left = `${Math.min(window.innerWidth - 200, Math.max(8, rect.left))}px`;
    menu.style.top = `${Math.min(window.innerHeight - 80, rect.bottom + 4)}px`;
    document.body.appendChild(menu);
    const close = () => {
      menu.remove();
      document.removeEventListener('mousedown', onDoc);
    };
    const onDoc = (ev) => {
      if (!menu.contains(ev.target) && ev.target !== anchor) close();
    };
    setTimeout(() => document.addEventListener('mousedown', onDoc), 0);
    menu.addEventListener('click', async (ev) => {
      const act = ev.target.closest('[data-act]')?.dataset.act;
      if (!act) return;
      ev.preventDefault();
      close();
      if (act === 'open' && id) await this._jumpToSponsor({ id, kind, name });
    });
  }

  async _jumpToSponsor({ id, kind = 'dossier' } = {}) {
    const app = window.Showtime;
    if (!app?.shell?.activate || !id) return;
    const rep = app.modules?.get?.('reputation');
    if (rep) {
      try {
        if (kind === 'house') {
          rep.state.tab = 'house';
          rep._focusedHouseId = id;
          const group = rep._nodes?.()?.find?.(n => n.category === 'group' && n.houseId === id);
          if (group) {
            rep.state.focusId = group.id;
            rep.state.inspectedId = group.id;
          }
        } else {
          rep.state.tab = 'personal';
          rep.state.focusId = id;
          rep.state.inspectedId = id;
          rep._focusedHouseId = null;
        }
        rep.saveState?.();
      } catch { /* ignore */ }
    }
    await app.shell.activate('reputation');
  }

  _bindNpcCastButtons(el, card) {
    el.querySelectorAll('.stm-credit-cast').forEach(btn => {
      btn.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        const chip = btn.closest('.stm-credit-chip');
        const name = chip?.dataset.name;
        if (!name) return;
        const added = this._addNpcToCast(name);
        if (!added) return;
        const credits = (card.credits || []).map(cr =>
          (cr.name || '').toLowerCase() === name.toLowerCase()
            ? { ...cr, characterId: added.id, role: added.priority }
            : cr
        );
        this._updateCard(card.uid, { credits });
        this._refreshDrawer();
      });
    });
  }

  _bindCreditEditor(el, card) {
    const wrap = el.querySelector('.stm-credit-wrap');
    if (!wrap) return;
    const chips = wrap.querySelector('.stm-credit-chips');
    const search = wrap.querySelector('.stm-credit-search');
    const suggest = wrap.querySelector('.stm-credit-suggest');

    const credited = () => [...chips.querySelectorAll('.stm-credit-chip')].map(c => ({
      id: c.dataset.id || '',
      name: (c.dataset.name || '').toLowerCase(),
    }));

    const addChip = (name, id, role) => {
      const member = (id && this._actingCast().find(m => m.id === id))
        || this._memberForCreditName(name, this._actingCast());
      const cid = member?.id || id || '';
      const cname = member?.name || name;
      const crole = member?.priority || role || 'cameo';
      const already = credited().some(c =>
        (cid && c.id === cid)
        || this._creditsOverlap({ characterId: c.id, name: c.name }, { characterId: cid, name: cname }, this._actingCast())
      );
      if (already) return;
      chips.querySelector('.stm-settings-hint')?.remove();
      chips.insertAdjacentHTML('beforeend', `<span class="stm-credit-chip${!cid ? ' stm-credit-chip--npc' : ''}" data-id="${esc(cid)}" data-name="${esc(cname)}">
            <span class="stm-credit-name">${esc(cname)}</span>
            <span class="stm-credit-pri">${esc(creditRoleLabel(crole))}</span>
            ${!cid ? `<button type="button" class="stm-credit-cast" title="Add to Cast">Cast</button>` : ''}
            <button type="button" class="stm-pill-x stm-credit-x" title="Remove">×</button>
        </span>`);
    };

    wrap.addEventListener('click', e => {
      const x = e.target.closest('.stm-credit-x');
      if (x) {
        e.preventDefault();
        e.stopPropagation();
        x.closest('.stm-credit-chip')?.remove();
        return;
      }
      const castBtn = e.target.closest('.stm-credit-cast');
      if (castBtn) {
        e.preventDefault();
        const chip = castBtn.closest('.stm-credit-chip');
        const added = this._addNpcToCast(chip?.dataset.name);
        if (!added || !chip) return;
        chip.dataset.id = added.id;
        chip.classList.remove('stm-credit-chip--npc');
        const pri = chip.querySelector('.stm-credit-pri');
        if (pri) pri.textContent = priorityLabel(added.priority);
        castBtn.remove();
      }
    });

    const hideSuggest = () => { if (suggest) suggest.hidden = true; };
    const showSuggest = q => {
      if (!suggest) return;
      const needle = q.trim().toLowerCase();
      const taken = credited();
      const members = this._actingCast().filter(m =>
        !taken.some(t => t.id === m.id || t.name === (m.name || '').toLowerCase())
        && (!needle || (m.name || '').toLowerCase().includes(needle))
      );
      const extras = [...new Set(
        (this._db().cards || []).flatMap(c => (c.credits || []).map(cr => cr.name).filter(Boolean))
      )].filter(n =>
        needle && n.toLowerCase().includes(needle)
        && !taken.some(t => t.name === n.toLowerCase())
        && !this._memberForCreditName(n)
      );
      const rows = [
        ...members.map(m => `<button type="button" class="stm-suggest-item" data-id="${esc(m.id)}" data-name="${esc(m.name)}" data-role="${esc(m.priority)}">${esc(m.name)} <em>${esc(priorityLabel(m.priority))}</em></button>`),
        ...extras.slice(0, 8).map(n => `<button type="button" class="stm-suggest-item stm-suggest-npc" data-name="${esc(n)}">${esc(n)} <em>Cameo</em></button>`),
      ];
      if (needle && !members.some(m => (m.name || '').toLowerCase() === needle) && !taken.some(t => t.name === needle)) {
        rows.push(`<button type="button" class="stm-suggest-item stm-suggest-npc" data-name="${esc(q.trim())}">Add “${esc(q.trim())}” as cameo</button>`);
        rows.push(`<button type="button" class="stm-suggest-item stm-suggest-cast" data-name="${esc(q.trim())}">Cast “${esc(q.trim())}” now</button>`);
      }
      suggest.innerHTML = rows.join('') || `<span class="stm-settings-hint">No matches.</span>`;
      suggest.hidden = false;
    };

    search?.addEventListener('input', () => showSuggest(search.value));
    search?.addEventListener('focus', () => showSuggest(search.value));
    search?.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const name = search.value.trim();
      if (!name) return;
      const m = this._memberForCreditName(name);
      addChip(m?.name || name, m?.id || '', m?.priority || 'cameo');
      search.value = '';
      hideSuggest();
    });
    suggest?.addEventListener('click', e => {
      const item = e.target.closest('.stm-suggest-item');
      if (!item) return;
      e.preventDefault();
      const name = item.dataset.name;
      if (item.classList.contains('stm-suggest-cast')) {
        const added = this._addNpcToCast(name);
        addChip(added.name, added.id, added.priority);
      } else {
        addChip(name, item.dataset.id || '', item.dataset.role || 'cameo');
      }
      if (search) search.value = '';
      hideSuggest();
    });
    search?.addEventListener('blur', () => setTimeout(hideSuggest, 180));

    wrap.querySelector('.stm-credit-new-cast')?.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      this._openNewCastDialog({ onCreated: (added) => {
        addChip(added.name, added.id, added.priority);
      } });
    });
  }

  _bindSponsorEditor(el) {
    const wrap = el.querySelector('.stm-sponsor-wrap');
    if (!wrap) return;
    const chips = wrap.querySelector('.stm-sponsor-chips');
    const search = wrap.querySelector('.stm-sponsor-search');
    const suggest = wrap.querySelector('.stm-sponsor-suggest');

    const listed = () => [...chips.querySelectorAll('.stm-sponsor-chip')].map(c => ({
      id: c.dataset.id || '',
      name: (c.dataset.name || '').toLowerCase(),
    }));

    const addChip = ({ id = '', name, kind = 'dossier', typeLabel = 'Dossier' }) => {
      const n = String(name || '').trim();
      if (!n) return;
      const already = listed().some(c => (id && c.id === id) || c.name === n.toLowerCase());
      if (already) return;
      chips.querySelector('.stm-settings-hint')?.remove();
      chips.insertAdjacentHTML('beforeend', `<span class="stm-sponsor-chip" data-id="${esc(id || '')}" data-name="${esc(n)}" data-kind="${esc(kind)}" data-type="${esc(typeLabel)}">
            <span class="stm-sponsor-name">${esc(n)}</span>
            <span class="stm-sponsor-kind">${esc(typeLabel)}</span>
            <button type="button" class="stm-pill-x stm-sponsor-x" title="Remove">×</button>
        </span>`);
    };

    wrap.addEventListener('click', e => {
      const x = e.target.closest('.stm-sponsor-x');
      if (!x) return;
      e.preventDefault();
      e.stopPropagation();
      x.closest('.stm-sponsor-chip')?.remove();
    });

    const hideSuggest = () => { if (suggest) suggest.hidden = true; };
    const showSuggest = q => {
      if (!suggest) return;
      const needle = q.trim().toLowerCase();
      const taken = listed();
      const opts = this._reputationLinkOptions().filter(o =>
        !taken.some(t => t.id === o.id || t.name === (o.name || '').toLowerCase())
        && (!needle || (o.name || '').toLowerCase().includes(needle) || (o.typeLabel || '').toLowerCase().includes(needle))
      );
      const rows = opts.slice(0, 16).map(o =>
        `<button type="button" class="stm-suggest-item" data-id="${esc(o.id)}" data-name="${esc(o.name)}" data-kind="${esc(o.kind)}" data-type="${esc(o.typeLabel)}">${esc(o.name)} <em>${esc(o.typeLabel)}</em></button>`
      );
      if (needle && !opts.some(o => (o.name || '').toLowerCase() === needle) && !taken.some(t => t.name === needle)) {
        rows.push(`<button type="button" class="stm-suggest-item stm-suggest-loose" data-name="${esc(q.trim())}" data-kind="dossier" data-type="Label">Add “${esc(q.trim())}” as label</button>`);
      }
      suggest.innerHTML = rows.join('') || `<span class="stm-settings-hint">${needle ? 'No matches.' : 'Type to search Affiliations & dossiers.'}</span>`;
      suggest.hidden = false;
    };

    search?.addEventListener('input', () => showSuggest(search.value));
    search?.addEventListener('focus', () => showSuggest(search.value));
    search?.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const name = search.value.trim();
      if (!name) return;
      const hit = this._reputationLinkOptions().find(o => (o.name || '').toLowerCase() === name.toLowerCase());
      addChip(hit || { name, kind: 'dossier', typeLabel: 'Label' });
      search.value = '';
      hideSuggest();
    });
    suggest?.addEventListener('click', e => {
      const item = e.target.closest('.stm-suggest-item');
      if (!item) return;
      e.preventDefault();
      addChip({
        id: item.dataset.id || '',
        name: item.dataset.name,
        kind: item.dataset.kind || 'dossier',
        typeLabel: item.dataset.type || 'Dossier',
      });
      if (search) search.value = '';
      hideSuggest();
    });
    search?.addEventListener('blur', () => setTimeout(hideSuggest, 180));
  }

  _openNewCastDialog({ onCreated } = {}) {
    const overlay = document.createElement('div');
    overlay.className = 'stm-dialog-overlay';
    const roleOpts = PRIORITIES
      .filter(p => !isDirectorRole(p.id))
      .map(p => `<option value="${esc(p.id)}"${p.id === 'supporting' ? ' selected' : ''}>${esc(p.label)}</option>`)
      .join('');
    overlay.innerHTML = `
        <div class="stm-dialog stm-dialog--kw">
            <div class="stm-dialog-header">New cast</div>
            <div class="stm-dialog-body">
                <div class="stm-form-row">
                    <label>Name</label>
                    <input id="stm-cast-new-name" type="text" placeholder="NPC name…" autocomplete="off">
                </div>
                <div class="stm-form-row">
                    <label>Priority</label>
                    <select id="stm-cast-new-pri">${roleOpts}</select>
                </div>
                <p class="stm-settings-hint">Adds an NPC to the Cast roster. Credit them on cards when they appear.</p>
            </div>
            <div class="stm-dialog-footer">
                <button type="button" id="stm-cast-new-cancel" class="stm-btn">Cancel</button>
                <button type="button" id="stm-cast-new-ok" class="stm-btn stm-btn-primary">Add to Cast</button>
            </div>
        </div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    const nameEl = overlay.querySelector('#stm-cast-new-name');
    const priEl = overlay.querySelector('#stm-cast-new-pri');
    const commit = () => {
      const name = (nameEl.value || '').trim();
      if (!name) { nameEl.classList.add('stm-input-error'); nameEl.focus(); return; }
      const added = this._addNpcToCast(name, { priority: priEl.value || 'supporting' });
      if (!added) return;
      onCreated?.(added);
      close();
    };
    overlay.querySelector('#stm-cast-new-cancel').addEventListener('click', close);
    overlay.querySelector('#stm-cast-new-ok').addEventListener('click', commit);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    overlay.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      if (e.key === 'Escape') close();
    });
    nameEl.focus();
  }

// ── Edit form event listeners ─────────────────────────────────────────────────
  _attachEditListeners(el, card) {
    el.querySelector('.stm-btn-save').addEventListener('click', () => {
      const title = el.querySelector('[name="title"]').value.trim();
      if (!title) {
        el.querySelector('[name="title"]').classList.add('stm-input-error');
        el.querySelector('[name="title"]').focus();
        return;
      }
      this._updateCard(card.uid, this._readForm(el, card));
      this._editingCardUid = null;
      this._refreshDrawer();
    });

    this._bindFacetEditor(el);
    this._bindCreditEditor(el, card);
    this._bindSponsorEditor(el);
    this._bindCalendarTimeHints(el);
    if (isEventCard(card)) this._bindEventScaleFields(el);
    if (this._isFolder(card)) this._bindCoverPicker(el);

    el.querySelector('.stm-btn-cancel').addEventListener('click', () => {
      this._editingCardUid = null;
      this._refreshDrawer();
    });
  }

// ── Read inline form values ───────────────────────────────────────────────────
  _readForm(el, card) {
    const q     = name => el.querySelector(`[name="${name}"]`);
    const csv   = name => (q(name)?.value || '').split(',').map(s => s.trim()).filter(Boolean);
    const members = this._castMembers();
    const title = q('title').value.trim();
    if (card && this._isFolder(card)) {
      const summary = (q('summary')?.value || '').trim();
      return {
        title,
        summary,
        content: summary,
        coverImage: (q('coverImage')?.value || '').trim(),
        coverPlacement: el.querySelector('[name="coverPlacement"]:checked')?.value === 'below' ? 'below' : 'above',
      };
    }
    const credits = [];
    el.querySelectorAll('.stm-credit-chip').forEach(chip => {
      const name = (chip.dataset.name || '').trim();
      if (!name) return;
      const id = chip.dataset.id || null;
      const m = (id && members.find(x => x.id === id)) || this._memberForCreditName(name, members);
      if (m && isDirectorRole(m.priority)) return;
      credits.push({
        characterId: m?.id || null,
        name: m?.name || name,
        role: m?.priority || 'cameo',
      });
    });
    const sponsors = [];
    el.querySelectorAll('.stm-sponsor-chip').forEach(chip => {
      const sp = this._normalizeSponsor({
        id: chip.dataset.id || '',
        name: chip.dataset.name || '',
        kind: chip.dataset.kind || 'dossier',
        typeLabel: chip.dataset.type || '',
      });
      if (sp) sponsors.push(sp);
    });
    const facets = isEventCard(card) ? normalizeFacets(card.keywordFacets) : this._readFacets(el);
    const cal = this._cal();
    const span = (q('span')?.value || '').trim() || null;
    // Derive placement key from span (primary) or Date/Time tags.
    let timeKey = '';
    const hit = pickParseableTimeKey({ span, keywordFacets: facets, timeKey: '' }, cal);
    if (hit) timeKey = hit.key;
    else if (span) timeKey = span;
    if (timeKey) {
        facets.datetime = [timeKey, ...(facets.datetime || []).filter(d => d.toLowerCase() !== timeKey.toLowerCase())];
    }
    const timeLocked = !!q('timeLocked')?.checked;
    const onTl = q('onTimeline');
    const timelineOff = onTl ? !onTl.checked : !!card?.timelineOff;
    // Editing the date text only ever changes the true parsed time — a manual
    // drag-nudge (if any) is independent and stays put unless the card is now
    // locked, in which case it always defers to the true time.
    const timeManual = timeLocked || timelineOff ? false : !!card?.timeManual;
    const timeManualSort = timeLocked || timelineOff ? null : (card?.timeManualSort ?? null);
    const parsed = hit?.parsed || parseTimeKey(timeKey, cal) || parseTimeRange(span, cal);
    const out = {
      levelId  : q('kind')?.value || card?.levelId,
      title,
      keywordFacets: facets,
      keywords : flattenFacets(facets),
      summary  : (q('summary')?.value || '').trim(),
      span,
      spanParts: this._readSpanParts(el),
      timeKey: timeKey || span || '',
      timeLocked,
      timelineOff,
      timeManual,
      timeManualSort,
      timestamp: parsed?.sort ?? card?.timestamp ?? null,
      tags     : [],
      quotes   : isEventCard(card) ? (card.quotes || []) : this._parseHighlights(q('highlights')?.value || ''),
      content  : (q('summary')?.value || '').trim(),
      pinned   : !!q('pinned')?.checked,
      active   : !!q('active')?.checked,
      credits: this._dedupeCredits(credits, members),
      sponsors: isEventCard(card) ? (card.sponsors || []) : sponsors,
    };
    if (isEventCard(card)) {
      const ev = this._readEventScaleFields(el);
      Object.assign(out, ev, {
        kind: 'event',
        sourceKind: card.sourceKind || 'event',
        timeLocked: true,
        timeManual: false,
        timeManualSort: null,
      });
    }
    return out;
  }

  _readSpanParts(el) {
    const host = el.querySelector('.stm-cal-picker');
    if (!host) return el._spanParts || null;
    const on = (name) => !!host.querySelector(`.stm-tp-vis[data-part="${name}"]`)?.checked;
    return {
      year: on('year'),
      season: on('season'),
      month: on('month'),
      week: on('week'),
      day: on('day'),
      hour: on('hour'),
      phase: on('phase'),
    };
  }

// ── New card dialog ───────────────────────────────────────────────────────────
  _openNewCardDialog() {
    const db = this._db();
    const leafId = this._cardLevelId(db);
    const leafLabel = (db.settings.levels.find(l => l.id === leafId)?.label) || 'Card';

    const containerCards = db.cards.filter(c => this._isFolder(c, db));
    const sel = this._selectedUid ? this._getCard(this._selectedUid) : null;
    const defaultParent = sel && this._isFolder(sel) ? sel.uid : (sel?.parentUid || null);
    const parentOpts = [
        `<option value="">— None (root) —</option>`,
        ...containerCards.map(c =>
            `<option value="${esc(c.uid)}" ${c.uid === defaultParent ? 'selected' : ''}>${esc(c.title || '(untitled)')} · ${esc(this._orgCode(c))}</option>`
        ),
    ].join('');

    const overlay = document.createElement('div');
    overlay.className = 'stm-dialog-overlay';
    overlay.innerHTML = `
        <div class="stm-dialog">
            <div class="stm-dialog-header">Fill this out first</div>
            <div class="stm-dialog-body">
                <p class="stm-settings-hint">Cards always use the leaf level (<strong>${esc(leafLabel)}</strong>). Nest them under a folder from the hierarchy.</p>
                <div class="stm-form-row">
                    <label>Title <span class="stm-required">*</span></label>
                    <input id="stm-new-title" type="text" placeholder="e.g. Detective Marlowe…">
                </div>
                <div class="stm-form-row">
                    <label>Summary</label>
                    <input id="stm-new-summary" type="text" placeholder="One-line description…">
                </div>
                <div class="stm-form-row">
                    <label>Parent folder</label>
                    <select id="stm-new-parent">${parentOpts}</select>
                </div>
            </div>
            <div class="stm-dialog-footer">
                <button id="stm-new-cancel" class="stm-btn">Cancel</button>
                <button id="stm-new-ok"     class="stm-btn stm-btn-primary">Create Card</button>
            </div>
        </div>`;
    document.body.appendChild(overlay);

    const titleEl = overlay.querySelector('#stm-new-title');
    titleEl.focus();
    const close = () => overlay.remove();

    overlay.querySelector('#stm-new-cancel').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    overlay.querySelector('#stm-new-ok').addEventListener('click', () => {
        const title = titleEl.value.trim();
        if (!title) { titleEl.classList.add('stm-input-error'); titleEl.focus(); return; }
        const parentUid = overlay.querySelector('#stm-new-parent').value || null;
        const draft = { kind: 'card', levelId: leafId, parentUid: null };
        if (!this._applyLevelForParent(draft, parentUid)) {
            alert('Cannot place a card under that parent.');
            return;
        }
        const card = this._addCard({
            levelId   : draft.levelId,
            kind      : 'card',
            title,
            summary   : overlay.querySelector('#stm-new-summary').value.trim(),
            parentUid : draft.parentUid,
        });
        this._selectedUid = card.uid;
        this._focusedUid = card.uid;
        this._editingCardUid = null;
        close();
        this._rerender();
    });
    overlay.addEventListener('keydown', e => {
        if (e.key === 'Enter')  overlay.querySelector('#stm-new-ok').click();
        if (e.key === 'Escape') close();
    });
}

// ── Settings dialog ───────────────────────────────────────────────────────────
  _openSettings(opts = {}) {
    const db = this._db();
    const cal = normalizeCalendar(db.settings.calendar);

    const levelRows = db.settings.levels.map((l, i) => `
        <div class="stm-level-row" data-idx="${i}">
            <input class="stm-level-id"    type="text" value="${esc(l.id)}"       placeholder="S / E / Ch…" title="ID — also the Custom org-code token">
            <input class="stm-level-label" type="text" value="${esc(l.label)}"    placeholder="label" title="Display label">
            <input class="stm-level-icon"  type="text" value="${esc(l.icon??'')}" placeholder="🎬" style="width:38px" title="Icon">
            <button class="stm-btn stm-btn-rm-level">✕</button>
        </div>`).join('');

    const profileOpts = [
        `<option value="">— Current (default) —</option>`,
        ...this._profiles.map(p =>
            `<option value="${esc(p.id)}" ${db.settings.aiProfile === p.id ? 'selected' : ''}>${esc(p.name)}</option>`
        ),
    ].join('');

    const scheme = this._orgScheme();
    const preview = previewCustomOrgCode(db.settings.levels);

    const overlay = document.createElement('div');
    overlay.className = 'stm-dialog-overlay';
    overlay.innerHTML = `
        <div class="stm-dialog stm-dialog--wide">
            <div class="stm-dialog-header">Script — Configure</div>
            <div class="stm-dialog-body">

                <div class="stm-settings-section">Level Hierarchy</div>
                <p class="stm-settings-hint">Order = depth (first = root folders, last = cards). <strong>ID</strong> is the stable key <em>and</em> the Custom org-code token (e.g. <code>S</code>, <code>E</code>) — sibling order supplies the number. Label is what you read in menus.</p>
                <div class="stm-level-head">
                    <span>id / code</span><span>label</span><span>icon</span><span></span>
                </div>
                <div id="stm-level-list">${levelRows}</div>
                <button id="stm-add-level" class="stm-btn" style="margin-top:6px">＋ Add Level</button>

                <hr class="stm-settings-hr">

                <div class="stm-settings-section">Organization codes</div>
                <p class="stm-settings-hint">Codes come from shelf order. Show/Book are fixed presets. Custom joins each level’s <strong>ID</strong> + its place among siblings (e.g. id <code>S</code> + <code>E</code> → <code>S1E17</code>). Nothing is stored on the card.</p>
                <div class="stm-form-row stm-form-row--toggles">
                    <label><input type="radio" name="stm-org-scheme" value="show" ${scheme === 'show' ? 'checked' : ''}> Show (S01E017)</label>
                    <label><input type="radio" name="stm-org-scheme" value="book" ${scheme === 'book' ? 'checked' : ''}> Book (B.1-Ch.17)</label>
                    <label><input type="radio" name="stm-org-scheme" value="custom" ${scheme === 'custom' ? 'checked' : ''}> Custom (from level ids)</label>
                </div>
                <p class="stm-settings-hint">Custom preview: <code id="stm-org-preview">${esc(preview)}</code></p>

                <hr class="stm-settings-hr">

                <details class="stm-settings-fold" id="stm-cfg-calendar" ${opts.focus === 'calendar' ? 'open' : ''}>
                    <summary class="stm-settings-section">World calendar</summary>
                    <div class="stm-settings-fold-body">
                        ${this._calendarFormHTML(cal)}
                    </div>
                </details>

                <hr class="stm-settings-hr">

                <details class="stm-settings-fold">
                    <summary class="stm-settings-section">AI agent</summary>
                    <div class="stm-settings-fold-body">
                        <p class="stm-settings-hint">Profile and token budgets used by the Script Agent. Input budget truncates source text (~4 characters per token). Output budget is passed as max new tokens.</p>
                        <div class="stm-form-row">
                            <label>Profile</label>
                            <select id="stm-ai-profile">${profileOpts}</select>
                        </div>
                        <div class="stm-form-row">
                            <label>Max input tokens</label>
                            <input id="stm-ai-in" type="number" min="256" max="128000" value="${esc(String(db.settings.aiMaxInputTokens ?? 8000))}">
                        </div>
                        <div class="stm-form-row">
                            <label>Max output tokens</label>
                            <input id="stm-ai-out" type="number" min="128" max="32000" value="${esc(String(db.settings.aiMaxOutputTokens ?? 2048))}">
                        </div>
                        <div class="stm-form-row">
                            <label>Temperature</label>
                            <input id="stm-ai-temp" type="number" min="0" max="2" step="0.05" value="${esc(String(db.settings.aiTemperature ?? 0.3))}">
                        </div>
                    </div>
                </details>

                <hr class="stm-settings-hr">

                <div class="stm-settings-section">Activation (chat lorebook)</div>
                <p class="stm-settings-hint">Pinned cards always inject their summary. Keyword cards inject when a keyword appears in the last N messages (simple lookup, like World Info depth). Nearby events inject when they sit close to the narrative present.</p>
                <div class="stm-form-row">
                    <label>Scan depth</label>
                    <input id="stm-scan-depth" type="number" min="1" max="100" value="${esc(String(db.settings.scanDepth ?? 4))}">
                </div>
                <div class="stm-form-row stm-form-row--toggles">
                    <label><input id="stm-inject-pinned" type="checkbox" ${db.settings.injectPinned ? 'checked' : ''}> Inject pinned</label>
                    <label><input id="stm-inject-keyword" type="checkbox" ${db.settings.injectKeyword ? 'checked' : ''}> Inject on keyword match</label>
                    <label><input id="stm-inject-events" type="checkbox" ${db.settings.injectEvents !== false ? 'checked' : ''}> Inject nearby events</label>
                </div>
                <div class="stm-form-row">
                    <label>Recent-N fallback <span class="stm-hint">(0 = off)</span></label>
                    <input id="stm-inject-recent" type="number" min="0" max="50" value="${esc(String(db.settings.injectRecentN ?? 0))}">
                </div>

                <hr class="stm-settings-hr">

                <div class="stm-settings-section">Chat lorebook</div>
                <p class="stm-settings-hint">Bound book: <strong>${esc(this._boundChatBook() || '(none)')}</strong>${db.settings.previousChatBook ? ` · remembered: ${esc(db.settings.previousChatBook)}` : ''}</p>
                <div class="stm-form-row stm-form-row--toggles">
                    <label><input id="stm-replace-chat" type="checkbox" ${db.settings.replaceChatLorebook ? 'checked' : ''}> Replace chat lorebook (unbind native book so Script is the only chat-bound memory)</label>
                </div>
                <button id="stm-import-chatbook" class="stm-btn" style="margin-top:8px" type="button">
                    Open Agent on bound chat lorebook…
                </button>
                <button id="stm-refresh-stamps" class="stm-btn" style="margin-top:8px" type="button" title="Rebuild Library ⌘ stamps from Script cards; drop leftovers">
                    ↻ Refresh Library stamps
                </button>
                <button id="stm-restore-chatbook" class="stm-btn" style="margin-top:8px" type="button">
                    Restore remembered book
                </button>

            </div>
            <div class="stm-dialog-footer">
                <button id="stm-cfg-cancel" class="stm-btn">Cancel</button>
                <button id="stm-cfg-save"   class="stm-btn stm-btn-primary">Save</button>
            </div>
        </div>`;
    document.body.appendChild(overlay);

    if (opts.focus === 'calendar') {
        const calEl = overlay.querySelector('#stm-cfg-calendar');
        if (calEl) {
            calEl.open = true;
            calEl.scrollIntoView({ block: 'start' });
        }
    }

    const close = () => overlay.remove();
    overlay.querySelector('#stm-cfg-cancel').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

    overlay.querySelector('#stm-add-level').addEventListener('click', () => {
        const row = document.createElement('div');
        row.className = 'stm-level-row';
        row.innerHTML = `
            <input class="stm-level-id"    type="text" placeholder="S / E / Ch…" title="ID — also the Custom org-code token">
            <input class="stm-level-label" type="text" placeholder="label" title="Display label">
            <input class="stm-level-icon"  type="text" placeholder="🎬" style="width:38px" title="Icon">
            <button class="stm-btn stm-btn-rm-level">✕</button>`;
        overlay.querySelector('#stm-level-list').appendChild(row);
        row.querySelector('.stm-level-id').focus();
        refreshPreview();
    });

    const readLevelRows = () => [...overlay.querySelectorAll('.stm-level-row')].map(r => ({
        id    : r.querySelector('.stm-level-id').value.trim().replace(/\s+/g, '_'),
        label : r.querySelector('.stm-level-label').value.trim(),
        icon  : r.querySelector('.stm-level-icon').value.trim() || '📄',
    })).filter(l => l.id && l.label);

    const refreshPreview = () => {
        const el = overlay.querySelector('#stm-org-preview');
        if (el) el.textContent = previewCustomOrgCode(readLevelRows());
    };
    overlay.querySelector('#stm-level-list').addEventListener('input', refreshPreview);
    overlay.querySelectorAll('input[name="stm-org-scheme"]').forEach(r => {
        r.addEventListener('change', refreshPreview);
    });

    overlay.querySelector('#stm-level-list').addEventListener('click', e => {
        if (e.target.classList.contains('stm-btn-rm-level')) {
            e.target.closest('.stm-level-row').remove();
            refreshPreview();
        }
    });

    overlay.querySelector('#stm-import-chatbook').addEventListener('click', async () => {
        const name = this._boundChatBook() || this._db().settings.previousChatBook;
        if (!name) { alert('No chat lorebook is bound (or remembered).'); return; }
        await this._ensureBookLoaded(name);
        if (!this._wiBooks.some(b => b.name === name)) {
            alert('Could not load lorebook: ' + name);
            return;
        }
        close();
        this._openAgentDialog({ mode: 'lore', bookName: name });
    });

    overlay.querySelector('#stm-refresh-stamps').addEventListener('click', () => {
        const n = this._refreshLibraryStamps();
        alert(n
            ? `Refreshed Library stamps — updated ${n} tag list${n === 1 ? '' : 's'}.`
            : 'Library stamps already match Script cards.');
    });

    overlay.querySelector('#stm-restore-chatbook').addEventListener('click', () => {
        const db2 = this._db();
        if (!db2.settings.previousChatBook) { alert('No remembered chat lorebook.'); return; }
        db2.settings.replaceChatLorebook = false;
        this._setChatLorebook(db2.settings.previousChatBook);
        this._save(db2);
        close();
        this._rerender();
    });

    overlay.querySelector('#stm-tl-end-mode')?.addEventListener('change', e => {
        overlay.querySelector('#stm-tl-end-year')?.toggleAttribute('hidden', e.target.value !== 'beyond');
    });
    overlay.querySelector('#stm-cfg-save').addEventListener('click', () => {
        const newLevels = normalizeLevels(readLevelRows());
        if (!newLevels.length) { alert('At least one level is required.'); return; }

        const db2 = this._db();
        const schemeVal = overlay.querySelector('input[name="stm-org-scheme"]:checked')?.value;
        db2.settings.orgScheme = (schemeVal === 'book' || schemeVal === 'custom') ? schemeVal : 'show';
        db2.settings.levels = normalizeLevels(newLevels);
        db2.settings.calendar       = this._readCalendarFromForm(overlay);
        db2.settings.tlShow         = this._readTlShowFromRoot(overlay);
        db2.settings.lockPresentYear = overlay.querySelector('#stm-lock-year')?.checked !== false;
        const startY = overlay.querySelector('#stm-tl-start-year')?.value;
        const endY = overlay.querySelector('#stm-tl-end-year')?.value;
        db2.settings.tlRange = {
            startYear: startY === '' || startY == null ? null : Number(startY),
            startSeason: overlay.querySelector('#stm-tl-start-season')?.value || '',
            endMode: overlay.querySelector('#stm-tl-end-mode')?.value === 'beyond' ? 'beyond' : 'present',
            endYear: endY === '' || endY == null ? null : Number(endY),
        };
        db2.settings.aiProfile      = overlay.querySelector('#stm-ai-profile').value;
        db2.settings.aiMaxInputTokens  = Math.max(256, parseInt(overlay.querySelector('#stm-ai-in').value, 10) || 8000);
        db2.settings.aiMaxOutputTokens = Math.max(128, parseInt(overlay.querySelector('#stm-ai-out').value, 10) || 2048);
        db2.settings.aiTemperature     = Math.min(2, Math.max(0, Number(overlay.querySelector('#stm-ai-temp').value) || 0.3));
        db2.settings.scanDepth      = Math.max(1, parseInt(overlay.querySelector('#stm-scan-depth').value, 10) || 4);
        db2.settings.injectPinned   = overlay.querySelector('#stm-inject-pinned').checked;
        db2.settings.injectKeyword  = overlay.querySelector('#stm-inject-keyword').checked;
        db2.settings.injectEvents   = overlay.querySelector('#stm-inject-events').checked;
        db2.settings.injectRecentN  = Math.max(0, parseInt(overlay.querySelector('#stm-inject-recent').value, 10) || 0);
        const replace = overlay.querySelector('#stm-replace-chat').checked;
        const wasReplace = !!db2.settings.replaceChatLorebook;
        this._cardsNormalized = false;
        db2.cards = (db2.cards || []).map(c => this._normalizeCard(c, this._castMembers()));
        this._cardsNormalized = true;
        normalizeShelfLevels(db2);
        this._save(db2);
        if (replace !== wasReplace) {
            this._applyReplaceChatLorebook(replace);
        }
        close();
        this._rerender();
    });
}

// ── CSS ───────────────────────────────────────────────────────────────────────
  _injectCSS() {
    let s = document.getElementById('stm-phase2-css');
    if (!s) {
      s = document.createElement('style');
      s.id = 'stm-phase2-css';
      document.head.appendChild(s);
    }
    s.textContent = `

.stm-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  background: #1a0e06;
  font-family: inherit;
  color: #d4c9a8;
}

/* ── TOOLBAR ── */
.stm-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: #120d04;
  border-bottom: 2px solid #6b4f1e;
  flex-shrink: 0;
  flex-wrap: wrap;
  overflow: visible;
  position: relative;
  z-index: 20;
}
.stm-toolbar-title {
  font-size: 10px;
  letter-spacing: 4px;
  text-transform: uppercase;
  color: #9a7d3f;
  margin-right: auto;
}
.stm-tb-sep {
  width: 1px;
  height: 16px;
  background: #4a3510;
  flex-shrink: 0;
}
.stm-toolbar select,
.stm-toolbar input[type=text] {
  background: #1f1609;
  border: 1px solid #6b4f1e;
  color: #d4c9a8;
  font-family: inherit;
  font-size: 12px;
  padding: 3px 6px;
  border-radius: 2px;
}

/* ── BUTTONS ── */
.stm-btn {
  background: #2a1e0a;
  border: 1px solid #6b4f1e;
  color: #c8aa6e;
  font-family: 'Courier New', Courier, monospace;
  font-size: 12px;
  cursor: pointer;
  padding: 3px 9px;
  border-radius: 2px;
  transition: background 0.12s, color 0.12s;
}
.stm-btn:hover         { background: #3d2c10; color: #f0d89a; }
.stm-btn-primary       { background: #5c3d10; border-color: #9a6e2a; color: #f5e6c0; }
.stm-btn-primary:hover { background: #7a5218; }
.stm-btn-add           { font-size: 18px; padding: 0 7px; line-height: 1.3; }
.stm-btn-edit, .stm-btn-delete, .stm-btn-pin {
  background: transparent;
  border: none;
  color: #9a7d3f;
  padding: 2px 4px;
  font-size: 14px;
  cursor: pointer;
  opacity: 0.65;
  transition: opacity 0.1s, color 0.1s, filter 0.1s;
}
.stm-btn-edit:hover   { color: #f0d89a; opacity: 1; }
.stm-btn-delete:hover { color: #c0392b; opacity: 1; }
.stm-btn-pin {
  font-size: 12px;
  line-height: 1;
  opacity: 0.28;
  filter: grayscale(1);
}
.stm-btn-pin:hover { opacity: 0.7; filter: grayscale(0.4); }
.stm-btn-pin--on {
  opacity: 1;
  filter: none;
}
.stm-btn-pin--on:hover { opacity: 1; filter: none; }
.stm-btn-save         { background: #4a3510; border-color: #8c6d30; color: #f5e6c0; }
.stm-btn-save:hover   { background: #6b4f1e; }

/* ── BODY LAYOUT ── */
.stm-body {
  display: flex;
  flex: 1;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  position: relative;
  z-index: 0;
}

/* ── TREE PANEL (left) ── */
.stm-tree-panel {
  width: 220px;
  min-width: 140px;
  flex-shrink: 0;
  background: #110c03;
  border-right: 2px solid #4a3510;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}
.stm-tree-panel-header {
  font-size: 9px;
  letter-spacing: 3px;
  color: #6b4f1e;
  padding: 8px 10px 4px;
  border-bottom: 1px solid #2a1e0a;
  text-transform: uppercase;
  flex-shrink: 0;
}
.stm-tree-item {
  padding: 7px 10px;
  cursor: pointer;
  border-bottom: 1px solid #1a1208;
  color: #9a7d3f;
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 5px;
  transition: background 0.1s;
  user-select: none;
  min-height: 34px;
  box-sizing: border-box;
}
.stm-tree-item:hover { background: #1f1609; color: #c8aa6e; }
.stm-tree-item.active {
  background: #2a1e0a;
  color: #f0d89a;
  border-left: 3px solid #9a6e2a;
  padding-left: 7px;
}
.stm-tree-item.stm-tree-folder {
  background: linear-gradient(90deg, #6b4f1e 0 7px, #24180c 7px);
  color: #f0d89a;
  font-weight: 600;
  border-bottom: 1px solid #3a2a12;
}
.stm-tree-item.stm-tree-folder:hover { background: linear-gradient(90deg, #c9a24a 0 7px, #2a1e0a 7px); }
.stm-tree-item.stm-tree-folder.active {
  background: linear-gradient(90deg, #c9a24a 0 7px, #3a2a12 7px);
  border-left: none;
  padding-left: 10px;
}
.stm-tree-item.stm-tree-card { background: transparent; }
.stm-tree-item.stm-tree-card:hover { background: #1f1609; color: #c8aa6e; }
.stm-tree-item.stm-tree-card.active {
  background: #2a1e0a;
  color: #f0d89a;
  border-left: 3px solid #9a6e2a;
  padding-left: 7px;
}
.stm-tree-item-count {
  font-size: 10px;
  color: #6b4f1e;
  background: #1a1208;
  border-radius: 8px;
  padding: 0 5px;
  min-width: 18px;
  text-align: center;
}

/* ── CARD DRAWER (right) ── */
.stm-card-drawer {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  background: #1a1208;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 0;
}
.stm-drawer-header {
  display: flex;
  align-items: center;
  margin-bottom: 10px;
  flex-shrink: 0;
}
.stm-drawer-title {
  font-size: 9px;
  letter-spacing: 4px;
  color: #6b4f1e;
  text-transform: uppercase;
  flex: 1;
}
.stm-card-list {
  display: flex;
  flex-direction: column;
  gap: 0;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8px 6px 56px;
}

/* ── EMPTY STATE ── */
.stm-empty-state {
  text-align: center;
  padding: 40px 20px;
  color: #6b4f1e;
  font-size: 13px;
}
.stm-empty-state p { margin-bottom: 14px; }

/* ── PAPER CARD ── */
.stm-card {
  display: flex;
  background: #f5f0e0;
  color: #1a1208;
  border-radius: 2px 4px 4px 2px;
  box-shadow: 0 2px 6px rgba(0,0,0,0.6),
              inset 0 0 0 1px rgba(160,130,80,0.3);
  min-height: 72px;
  width: 100%;
  box-sizing: border-box;
  overflow: hidden;
  position: relative;
  margin-bottom: -44px;
  flex: 0 0 auto;
  transform-origin: top center;
  transition: transform 0.18s ease, box-shadow 0.18s ease, margin 0.18s ease;
  cursor: default;
}
.stm-card.stm-card--minimized {
  max-height: 88px;
  cursor: pointer;
}
.stm-card.stm-card--minimized .stm-card-body { overflow: hidden; }
.stm-card.stm-card--minimized:has(.stm-kw-drop[open]) {
  max-height: 260px;
}
.stm-card.stm-card--minimized:hover {
  transform: translateY(-16px) rotate(-0.55deg);
  z-index: 80 !important;
  box-shadow: 0 18px 32px rgba(0,0,0,0.58),
              inset 0 0 0 1px rgba(201,162,74,0.7);
}
/* Don't tuck the focused page under the card above it */
.stm-card.stm-card--minimized:has(+ .stm-card--focused),
.stm-card.stm-card--minimized:has(+ .stm-card--editing) {
  margin-bottom: 6px;
}
.stm-card.stm-card--focused,
.stm-card.stm-card--editing {
  z-index: 90 !important;
  margin: 14px 0 28px;
  max-height: min(85vh, 960px);
  min-height: min(42vh, 420px);
  flex: 0 0 auto;
  overflow: hidden;
  transform: none;
  box-shadow: 0 12px 30px rgba(0,0,0,0.6), 0 0 0 1px #c9a24a;
}
.stm-card.stm-folder.stm-card--focused,
.stm-card.stm-folder.stm-card--editing {
  min-height: min(28vh, 280px);
  max-height: min(55vh, 520px);
}
.stm-card--focused .stm-card-body,
.stm-card--editing .stm-card-body {
  overflow-y: auto;
  flex: 1 1 auto;
  min-height: 0;
  overscroll-behavior: contain;
}
.stm-card:last-child { margin-bottom: 8px; }
.stm-card.stm-card--event {
  background: #efe6cc;
  box-shadow: 0 2px 0 #7a3048, 0 2px 6px rgba(0,0,0,0.55),
              inset 0 0 0 1px rgba(122,48,72,0.25);
  margin-bottom: 10px;
  border-radius: 2px 8px 8px 2px;
}
.stm-card.stm-card--event-personal {
  box-shadow: 0 2px 0 #3d6a68, 0 2px 6px rgba(0,0,0,0.55),
              inset 0 0 0 1px rgba(61,106,104,0.28);
}
.stm-card.stm-card--event.stm-card--minimized:hover {
  transform: translateY(-6px);
  box-shadow: 0 10px 22px rgba(0,0,0,0.5), 0 0 0 1px #c9a24a;
}
.stm-event-stub {
  width: 10px;
  flex-shrink: 0;
  background: repeating-linear-gradient(
    -45deg,
    #7a3048 0 6px,
    #c9a24a 6px 12px
  );
}
.stm-card--event-personal .stm-event-stub {
  background: repeating-linear-gradient(
    -45deg,
    #3d6a68 0 6px,
    #c9a24a 6px 12px
  );
}
.stm-event-banner {
  font-size: 10px;
  letter-spacing: 1.2px;
  text-transform: uppercase;
  color: #7a3048;
  margin: 2px 0 6px;
}
.stm-card--event-personal .stm-event-banner { color: #2a4a48; }
.stm-card-peek {
  font-size: 12px;
  opacity: 0.75;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.stm-card-bodytext {
  white-space: pre-wrap;
  margin: 8px 0;
  line-height: 1.45;
}
/* Nested folders: simple section page — between shelf stack and lined scene cards */
.stm-folder {
  background: #e8dcc0;
  color: #2b1d0e;
  border-radius: 2px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.45), inset 0 0 0 1px #b89a5a;
}
.stm-card.stm-folder.stm-card--minimized:hover {
  box-shadow: 0 18px 32px rgba(0,0,0,0.58), inset 0 0 0 1px #c9a24a;
}
.stm-folder-margin {
  width: 10px;
  flex-shrink: 0;
  background:
    linear-gradient(180deg, #d4c49a, #c9a24a 40%, #d4c49a 70%, #b89a5a);
  box-shadow: inset -1px 0 0 rgba(0,0,0,0.12);
}
.stm-folder .stm-card-body {
  background-image: none;
  font-family: Georgia, 'Times New Roman', serif;
  color: #2b1d0e;
}
.stm-folder-meta {
  font-size: 11px;
  color: #8a6f2c;
  opacity: 0.9;
  margin: 8px 0 0;
  letter-spacing: 0.4px;
  text-align: center;
}
.stm-folder-cover {
  width: 100%;
  height: 56px;
  flex: 0 0 56px;
  overflow: hidden;
  border-radius: 2px;
  background: rgba(0,0,0,.18);
  margin: 0 0 8px;
  box-shadow: inset 0 0 0 1px rgba(0,0,0,.12);
}
.stm-folder-cover--below { margin: 8px 0 0; }
.stm-card--minimized .stm-folder-cover,
.stm-card--minimized .stm-folder-cover--preview {
  height: 40px;
  flex-basis: 40px;
  margin-bottom: 6px;
}
.stm-card--minimized .stm-folder-cover--below { margin: 6px 0 0; }
.stm-folder-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center;
  display: block;
  pointer-events: none;
}
.stm-folder-cover--preview {
  margin-top: 8px;
}
.stm-folder-cover-tools {
  display: flex;
  gap: 6px;
  margin-top: 6px;
  flex-wrap: wrap;
}
/* Root folders: original bookish binder */
.stm-folder.stm-folder--root {
  background: #2a1c0e;
  color: #f0d89a;
  border-radius: 0 4px 4px 0;
  box-shadow: 0 2px 8px rgba(0,0,0,0.7), inset 0 0 0 1px #6b4f1e;
}
.stm-card.stm-folder.stm-folder--root.stm-card--minimized:hover {
  box-shadow: 0 18px 32px rgba(0,0,0,0.58), inset 0 0 0 1px #c9a24a;
}
.stm-folder-spine {
  width: 16px;
  flex-shrink: 0;
  background:
    linear-gradient(90deg, #3a2410, #8b5a2b 35%, #c9a24a 50%, #8b5a2b 65%, #3a2410);
  box-shadow: inset -2px 0 4px rgba(0,0,0,0.4);
}
.stm-folder.stm-folder--root .stm-card-body {
  color: #f0d89a;
}
.stm-folder.stm-folder--root .stm-folder-meta {
  color: #c9a24a;
  opacity: 0.85;
}
.stm-folder.stm-folder--root .stm-card-top--folder .stm-card-title {
  color: #f0d89a;
}
.stm-folder.stm-folder--root .stm-card-top--folder .stm-card-org {
  color: #c8aa6e;
}
.stm-folder.stm-folder--root .stm-folder-desc {
  color: #f0d89a;
}
.stm-folder.stm-folder--root .stm-credit-name-btn { color: #f0d89a; }
.stm-folder.stm-folder--root .stm-sponsor-name-btn { color: #f0d89a; }
.stm-folder.stm-folder--root .stm-sponsor-list-view { border-color: #6b4f1e; }
.stm-folder.stm-folder--root .stm-credit-chip { background: #3a2a12; color: #f0d89a; }
.stm-folder.stm-folder--root .stm-quote { color: #f0d89a; }
.stm-card--editing {
  cursor: default;
  background: #fdf8ea;
}

/* ── HOLE PUNCHES ── */
.stm-punches {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: space-around;
  width: 28px;
  flex-shrink: 0;
  background: #e8e0c8;
  border-right: 1px dashed #c0aa80;
  padding: 10px 0;
}
.stm-punches span {
  display: block;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #1a1208;
  box-shadow: inset 0 1px 3px rgba(0,0,0,0.5);
  opacity: 0.15;
}

/* ── CARD BODY ── */
.stm-card-body {
  flex: 1;
  padding: 10px 12px;
  overflow: hidden;
  font-family: 'Courier New', Courier, monospace;
  font-size: 12px;
  line-height: 20px;
  background-image: repeating-linear-gradient(
    transparent,
    transparent 19px,
    rgba(160,130,80,0.25) 19px,
    rgba(160,130,80,0.25) 20px
  );
  background-size: 100% 20px;
  background-position: 0 8px;
}
.stm-card--editing .stm-card-body {
  background-image: none;
  padding: 12px 16px;
  line-height: 1.5;
  overflow-y: auto;
}
.stm-card-top {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin-bottom: 2px;
}
.stm-card-top--folder {
  position: relative;
  align-items: center;
  justify-content: center;
  min-height: 22px;
}
.stm-card-top--folder .stm-card-title {
  text-align: center;
  width: 100%;
  padding: 0 72px 0 56px;
  font-weight: 700;
  font-size: 15px;
  color: #2b1d0e;
  letter-spacing: 0.4px;
  white-space: normal;
  overflow: visible;
  text-overflow: unset;
}
.stm-card-top--folder .stm-card-org {
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  color: #8a6f2c;
}
.stm-card-top--folder .stm-card-actions {
  position: absolute;
  right: 0;
  top: 0;
}
.stm-card-kind,
.stm-card-org {
  font-size: 10px;
  letter-spacing: 0.6px;
  color: #8c6d30;
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
  text-transform: none;
}
.stm-card-title {
  font-weight: bold;
  font-size: 13px;
  color: #1a1208;
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.stm-card-actions { display: flex; gap: 2px; flex-shrink: 0; }
.stm-card-summary {
  color: #3a2e18;
  font-size: 11px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.stm-source-stamp {
  margin-top: 6px;
  font-size: 10px;
  color: #6a5430;
  border: 1px dashed rgba(138, 106, 61, 0.45);
  background: rgba(201, 162, 74, 0.08);
  padding: 4px 8px;
}
.stm-source-stamp summary {
  cursor: pointer;
  list-style: none;
}
.stm-source-stamp summary::-webkit-details-marker { display: none; }
.stm-conn-log {
  margin-top: 6px;
  font-size: 10px;
  color: #6b4f1e;
  opacity: 0.72;
  border-top: 1px dashed rgba(138, 106, 61, 0.35);
  padding-top: 4px;
}
.stm-conn-log[open] { opacity: 1; }
.stm-conn-log summary {
  cursor: pointer;
  list-style: none;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  font-size: 9px;
  color: #8a6a3d;
}
.stm-conn-log summary::-webkit-details-marker { display: none; }
.stm-conn-log-list {
  margin: 4px 0 0;
  padding-left: 1.15em;
  line-height: 1.4;
  color: #4a3a1e;
}
.stm-conn-log-list time {
  display: inline-block;
  min-width: 7.6em;
  margin-right: 6px;
  color: #8a6a3d;
  font-variant-numeric: tabular-nums;
}
.stm-source-stamp-mark {
  font-weight: 700;
  margin-right: 4px;
  color: #8a6a3d;
}
.stm-source-stamp-list {
  margin: 4px 0 0;
  padding-left: 1.1em;
  line-height: 1.35;
}
.stm-card--focused .stm-card-summary,
.stm-card--editing .stm-card-summary,
.stm-card--focused .stm-folder-desc,
.stm-card--editing .stm-folder-desc,
.stm-card--focused .stm-card-bodytext {
  white-space: pre-wrap;
  overflow: visible;
  text-overflow: unset;
  max-height: none;
}
.stm-card-roles {
  font-size: 10px;
  color: #7a5c20;
  letter-spacing: 1px;
  text-transform: uppercase;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.stm-card-tags  { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 2px; }
.stm-tag {
  background: #d4b87a;
  color: #1a1208;
  font-size: 9px;
  padding: 0 5px;
  border-radius: 1px;
  letter-spacing: 1px;
}

/* ── INLINE EDIT FORM ── */
.stm-form-row {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin-bottom: 10px;
}
.stm-form-row[hidden],
.stm-dialog [hidden] {
  display: none !important;
}
.stm-form-row label {
  font-size: 9px;
  letter-spacing: 2px;
  text-transform: uppercase;
  color: #8c6d30;
}
.stm-form-row input[type=text],
.stm-form-row textarea,
.stm-form-row select {
  background: #fdf8ea;
  border: none;
  border-bottom: 1px solid #a08040;
  color: #1a1208;
  font-family: 'Courier New', Courier, monospace;
  font-size: 12px;
  padding: 4px 6px;
  resize: vertical;
  outline: none;
  transition: border-color 0.15s;
}
.stm-form-row input[type=text]:focus,
.stm-form-row textarea:focus,
.stm-form-row select:focus { border-bottom-color: #9a6e2a; background: #fffef5; }
.stm-form-row select[multiple] { height: auto; border: 1px solid #c0aa80; }
.stm-form-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 6px;
  padding-top: 8px;
  border-top: 1px dashed #c0aa80;
}
.stm-required { color: #c0392b; }
.stm-hint     { font-size: 9px; color: #a08040; font-style: italic; letter-spacing: 0; text-transform: none; }
.stm-input-error { border-bottom-color: #c0392b !important; }

/* ── DIALOG ── */
.stm-dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.72);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}
.stm-dialog {
  background: #f5f0e0;
  color: #1a1208;
  font-family: 'Courier New', Courier, monospace;
  font-size: 13px;
  width: 400px;
  max-width: 90vw;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 32px rgba(0,0,0,0.8), 0 0 0 2px #9a7d3f;
  border-radius: 2px;
}
.stm-dialog--wide { width: 520px; }
.stm-dialog--agent { width: min(640px, 94vw); }
.stm-dialog-header {
  background: #1a1208;
  color: #c8aa6e;
  font-size: 11px;
  letter-spacing: 3px;
  text-transform: uppercase;
  padding: 10px 16px;
  border-bottom: 2px solid #9a7d3f;
  flex-shrink: 0;
}
.stm-dialog-body  { padding: 16px; overflow-y: auto; flex: 1; }
.stm-scale-row {
  display: flex;
  gap: 8px;
}
.stm-scale-btn {
  flex: 1;
  padding: 8px 10px;
  border: 1px solid #9a7d3f;
  background: #efe4c4;
  color: #1a1208;
  font: inherit;
  letter-spacing: 1px;
  text-transform: uppercase;
  font-size: 11px;
  cursor: pointer;
}
.stm-scale-btn.on {
  background: #1a1208;
  color: #f0d89a;
  border-color: #c9a24a;
}
.stm-ev-checks {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 120px;
  overflow-y: auto;
  border: 1px solid #c0aa80;
  background: #fdf8ea;
  padding: 6px 8px;
}
.stm-ev-check {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  text-transform: none;
  letter-spacing: 0;
  color: #1a1208;
}
.stm-ev-check em { color: #8c6d30; font-style: normal; font-size: 10px; }
.stm-ev-seed { margin-top: 10px; }
.stm-ev-seed summary {
  cursor: pointer;
  color: #6b4f1e;
  font-size: 11px;
}
.stm-form-row--2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.stm-cal-labels {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
  gap: 8px;
}
.stm-cal-label {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 11px;
  text-transform: capitalize;
  color: #6a6458;
}
.stm-cal-label input {
  width: 100%;
  font-size: 12px;
  padding: 4px 6px;
}
.stm-cal-hints {
  margin-top: 6px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.stm-cal-hint-ok { font-size: 11px; color: #3d7a68; }
.stm-cal-hint-miss { font-size: 11px; color: #8a6e2a; }
.stm-set-time {
  margin-top: 8px;
  border: 1px dashed rgba(107, 79, 30, 0.55);
  border-radius: 4px;
  background: rgba(26, 18, 8, 0.04);
  padding: 0 8px 8px;
}
.stm-set-time > summary {
  cursor: pointer;
  list-style: none;
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #6b4f1e;
  padding: 8px 0 4px;
  user-select: none;
}
.stm-set-time > summary::-webkit-details-marker { display: none; }
.stm-set-time > summary::before {
  content: '▸ ';
  display: inline-block;
  transition: transform 0.12s ease;
}
.stm-set-time[open] > summary::before { transform: rotate(90deg); }
.stm-set-time-body { margin-top: 4px; }
.stm-cal-picker {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  background: #f3efe4;
  border: 1px solid #d4c9a8;
  border-radius: 6px;
}
.stm-cal-picker-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}
.stm-cal-picker-cascade {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.stm-cal-picker-cascade label {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 11px;
  color: #5a5040;
}
.stm-cal-picker-cascade input,
.stm-cal-picker-cascade select,
.stm-cal-picker-row select {
  font: inherit;
  font-size: 12px;
  padding: 3px 6px;
  min-width: 72px;
}
.stm-cal-picker-actions {
  justify-content: space-between;
}
.stm-tp-vis-row {
  flex-wrap: wrap;
  gap: 6px 10px;
  align-items: center;
}
.stm-tp-vis-h {
  font-size: 11px;
  color: #6a5e48;
  margin-right: 4px;
}
.stm-tp-vis-lab {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: #3a3224;
  cursor: pointer;
}
.stm-tp-preview {
  font-size: 12px;
  color: #4a3f2a;
  background: #fffdf7;
  padding: 2px 8px;
  border-radius: 4px;
}
.stm-cal-hint-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.stm-cal-chip {
  font-family: inherit;
  font-size: 11px;
  padding: 2px 8px;
  border: 1px dashed #8a8474;
  background: #f7f3ea;
  color: #2a2418;
  cursor: pointer;
  border-radius: 999px;
}
.stm-cal-chip:hover {
  border-style: solid;
  border-color: #c9a24a;
  color: #6a4e12;
}
.stm-dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid #d4c9a8;
  flex-shrink: 0;
}

/* ── SETTINGS DIALOG ── */
.stm-settings-section {
  font-size: 10px;
  letter-spacing: 3px;
  text-transform: uppercase;
  color: #8c6d30;
  margin-bottom: 4px;
}
.stm-settings-fold {
  margin: 0;
  border: none;
}
.stm-settings-fold > summary.stm-settings-section {
  cursor: pointer;
  list-style: none;
  display: flex;
  align-items: center;
  gap: 8px;
  user-select: none;
  margin-bottom: 0;
}
.stm-settings-fold > summary.stm-settings-section::-webkit-details-marker { display: none; }
.stm-settings-fold > summary.stm-settings-section::before {
  content: '▸';
  font-size: 11px;
  letter-spacing: 0;
  color: #8c6d30;
  transition: transform 0.12s ease;
}
.stm-settings-fold[open] > summary.stm-settings-section::before {
  transform: rotate(90deg);
}
.stm-settings-fold-body {
  margin-top: 8px;
  padding-left: 2px;
}
.stm-settings-hint { font-size: 11px; color: #6b4f1e; margin-bottom: 10px; }
.stm-level-head {
  display: grid;
  grid-template-columns: minmax(72px, 1fr) minmax(96px, 1.4fr) 40px 28px;
  gap: 6px;
  font-size: 10px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #8c6d30;
  margin-bottom: 4px;
  padding: 0 2px;
}
.stm-level-row {
  display: grid;
  grid-template-columns: minmax(72px, 1fr) minmax(96px, 1.4fr) 40px 28px;
  gap: 6px;
  align-items: center;
  margin-bottom: 6px;
}
.stm-level-row input {
  width: 100%;
  box-sizing: border-box;
  background: #fdf8ea;
  border: none;
  border-bottom: 1px solid #c0aa80;
  color: #1a1208;
  font-family: 'Courier New', Courier, monospace;
  font-size: 12px;
  padding: 3px 6px;
  outline: none;
}
.stm-level-row input:focus { border-bottom-color: #9a6e2a; }
.stm-btn-rm-level {
  background: transparent;
  border: none;
  color: #c0392b;
  cursor: pointer;
  font-size: 14px;
  padding: 0 4px;
  opacity: 0.7;
  transition: opacity 0.1s;
}
.stm-btn-rm-level:hover { opacity: 1; }

/* ── TREE DIVIDER ── */
.stm-tree-divider {
  height: 1px;
  background: #2a1e0a;
  margin: 4px 0;
}
.stm-org-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
  padding: 4px 6px;
  border-bottom: 1px solid #2a1e0a;
  flex-shrink: 0;
}
.stm-org-bar .stm-btn { padding: 2px 6px; font-size: 11px; }
.stm-org-scheme {
  flex: 0 0 auto;
  background: #1f1609;
  border: 1px solid #6b4f1e;
  color: #d4c9a8;
  font-size: 11px;
  padding: 2px 4px;
}
.stm-org-sort {
  flex: 1;
  min-width: 0;
  background: #1f1609;
  border: 1px solid #6b4f1e;
  color: #d4c9a8;
  font-size: 11px;
  padding: 2px 4px;
}
.stm-org-count { font-size: 10px; color: #9a7d3f; margin-left: auto; }
.stm-filter-chip {
  padding: 4px 8px;
  font-size: 11px;
  color: #f0d89a;
  display: flex;
  align-items: center;
  gap: 6px;
}
.stm-kw-drop {
  margin-top: 6px;
  font-size: 11px;
}
.stm-kw-drop summary {
  cursor: pointer;
  color: #6b4f1e;
  letter-spacing: 1px;
  text-transform: uppercase;
  font-size: 10px;
}
.stm-kw-drop:not([open]) .stm-pill-row,
.stm-kw-drop:not([open]) .stm-pills,
.stm-kw-drop:not([open]) .stm-settings-hint { display: none; }
.stm-card--minimized .stm-kw-drop { margin-top: 2px; }
.stm-pill-row { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin: 4px 0; }
.stm-pill-label { font-size: 10px; color: #8c6d30; width: 72px; flex-shrink: 0; }
.stm-pills { display: flex; flex-wrap: wrap; gap: 4px; flex: 1; }
.stm-pill, .stm-pill-edit {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  background: #e4e0d4;
  border: 1px solid #8a8474;
  color: #2a2418;
  border-radius: 999px;
  padding: 1px 8px;
  font-size: 11px;
  cursor: pointer;
}
.stm-pill--location, .stm-card .stm-pill--location {
  background: #d4ebe3;
  border-color: #3d7a68;
  color: #1a3d34;
}
.stm-pill--objects, .stm-card .stm-pill--objects {
  background: #efe0c4;
  border-color: #9a6e2a;
  color: #3d2c10;
}
.stm-pill--characters, .stm-card .stm-pill--characters {
  background: #ead4d8;
  border-color: #8a4a58;
  color: #3a1820;
}
.stm-pill--datetime, .stm-card .stm-pill--datetime {
  background: #d4dce8;
  border-color: #4a5e7a;
  color: #1a2438;
}
.stm-pill--other, .stm-card .stm-pill--other {
  background: #e4e0d4;
  border-color: #8a8474;
  color: #2a2418;
}
.stm-pill--on, .stm-card .stm-pill--on {
  box-shadow: inset 0 0 0 1px #f0d89a;
  filter: saturate(1.2);
}
.stm-pill-x { border: none; background: transparent; cursor: pointer; color: inherit; }
.stm-pill-cat {
  border: none;
  background: transparent;
  cursor: pointer;
  color: inherit;
  font: inherit;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  opacity: 0.75;
  padding: 0 4px 0 0;
}
.stm-pill-cat:hover { opacity: 1; text-decoration: underline; }
.stm-pill-edit {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}
.stm-pill-val { max-width: 160px; overflow: hidden; text-overflow: ellipsis; }
.stm-kw-editor { display: flex; flex-direction: column; gap: 8px; }
.stm-kw-add-btn { align-self: flex-start; }
.stm-dialog--kw { width: 400px; }
.stm-pill-add {
  width: 90px;
  background: #1f1609;
  border: 1px dashed #6b4f1e;
  color: #d4c9a8;
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 999px;
}
.stm-agent-stage {
  margin-top: 12px;
  padding: 12px;
  background: #120d04;
  border: 1px solid #6b4f1e;
  text-align: center;
}
.stm-agent-select[hidden] { display: none !important; }
.stm-agent-status {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.stm-agent-status[hidden] { display: none !important; }
.stm-agent-status-msg { margin: 0; }
.stm-agent-status-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.stm-agent-status-actions[hidden] { display: none !important; }
.stm-agent-status--ok { color: #7dba9a; }
.stm-agent-status--err { color: #d08080; }
.stm-film-strip {
  height: 18px;
  margin-bottom: 8px;
  background: repeating-linear-gradient(90deg, #1a1208 0 10px, #c9a24a 10px 12px, #1a1208 12px 22px, #f4ead5 22px 24px);
  animation: stm-reel 0.8s linear infinite;
}
@keyframes stm-reel { to { background-position: 24px 0; } }
.stm-agent-beat {
  color: #f0d89a;
  font-size: 12px;
  letter-spacing: 2px;
  text-transform: uppercase;
  margin: 6px 0;
  min-height: 1.4em;
  font-family: 'Courier New', Courier, monospace;
}
.stm-progress {
  height: 8px;
  background: #1a1208;
  border: 1px solid #6b4f1e;
  margin: 8px 0;
  overflow: hidden;
}
.stm-progress-fill {
  height: 100%;
  width: 0;
  background: linear-gradient(90deg, #6b4f1e, #c9a24a);
  transition: width 0.6s ease;
}
.stm-ti-check {
  appearance: none !important;
  -webkit-appearance: none !important;
  width: 15px !important;
  height: 15px !important;
  margin: 0 !important;
  flex-shrink: 0;
  align-self: center;
  box-sizing: border-box !important;
  border: 1.5px solid var(--st-check-mark, #2b1d0e) !important;
  border-radius: 2px !important;
  background-color: var(--st-check-face, #f5f0e0) !important;
  background-image: none !important;
  background-repeat: no-repeat !important;
  background-position: center !important;
  background-size: 10px 10px !important;
  box-shadow: none !important;
  cursor: pointer;
  padding: 0 !important;
  vertical-align: middle;
  accent-color: transparent;
  filter: none !important;
  overflow: visible !important;
  transform: none !important;
  outline: none !important;
}
.stm-ti-check:checked {
  background-color: var(--st-check-face, #f5f0e0) !important;
  border-color: var(--st-check-mark, #2b1d0e) !important;
  background-image: var(--st-check-svg) !important;
}
.stm-ti-check::before,
.stm-ti-check::after,
.stm-ti-check:checked::before,
.stm-ti-check:checked::after {
  content: none !important;
  display: none !important;
  box-shadow: none !important;
  background: none !important;
  width: 0 !important;
  height: 0 !important;
  transform: none !important;
  clip-path: none !important;
}
.stm-agent-tabs { display: flex; gap: 6px; margin-bottom: 10px; }
.stm-agent-book { padding: 4px 8px; }
.stm-agent-group {
  padding: 5px 8px 2px;
  font-size: 10px;
  letter-spacing: 1.4px;
  text-transform: uppercase;
  color: #8c6d30;
  background: #f3ead4;
  border-bottom: 1px solid #d4c9a8;
}
.stm-agent-phase-label {
  font-size: 10px;
  letter-spacing: 2px;
  text-transform: uppercase;
  color: #8c6d30;
  margin: 8px 0 4px;
}
.stm-agent-viewport {
  max-height: 148px;
  overflow-y: auto;
  border: 1px solid #c0aa80;
  border-radius: 2px;
}
#stm-agent-entries.stm-agent-viewport { max-height: 168px; }
#stm-agent-cubbies.stm-agent-viewport { max-height: 110px; }
.stm-agent-ai {
  margin-top: 12px;
  border: 1px solid #d4c9a8;
  border-radius: 2px;
  padding: 6px 10px 8px;
  background: #faf6ea;
}
.stm-agent-ai > summary {
  cursor: pointer;
  font-size: 11px;
  letter-spacing: 1px;
  text-transform: uppercase;
  color: #8c6d30;
  padding: 4px 0;
}
.stm-agent-ai[open] > summary { margin-bottom: 8px; }
.stm-ti-org {
  font-size: 10px;
  color: #9a7d3f;
  margin-right: 6px;
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}

/* ── RESIZE HANDLE ── */
.stm-resize-handle {
  width: 5px;
  flex-shrink: 0;
  background: #2a1e0a;
  cursor: col-resize;
  transition: background 0.15s;
}
.stm-resize-handle:hover { background: #9a6e2a; }

/* ── TREE ARROWS + RENAME ── */
.stm-ti-arrow {
  font-size: 9px;
  color: #6b4f1e;
  margin-right: 0;
  width: 12px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
  transition: transform 0.15s;
  align-self: center;
  cursor: pointer;
}
.stm-ti-arrow--hidden  { opacity: 0; pointer-events: none; }
.stm-ti-arrow--open    { transform: rotate(90deg); }
.stm-ti-icon  { margin-right: 0; font-size: 13px; flex-shrink: 0; align-self: center; line-height: 1; }
.stm-ti-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.stm-ti-org { margin-right: 0; }
.stm-ti-rename,
.stm-ti-delete {
  background: transparent;
  border: none;
  color: #4a3510;
  font-size: 12px;
  cursor: pointer;
  padding: 0 3px;
  opacity: 0;
  transition: opacity 0.1s, color 0.1s;
  flex-shrink: 0;
}
.stm-ti-pin {
  background: transparent;
  border: none;
  font-size: 11px;
  line-height: 1;
  cursor: pointer;
  padding: 0 3px;
  flex-shrink: 0;
  opacity: 0.28;
  filter: grayscale(1);
  transition: opacity 0.1s, filter 0.1s;
}
.stm-ti-pin:hover { opacity: 0.7; filter: grayscale(0.4); }
.stm-ti-pin--on {
  opacity: 1;
  filter: none;
}
.stm-ti-pin--on:hover { opacity: 1; filter: none; }
.stm-tree-item:hover .stm-ti-rename,
.stm-tree-item:hover .stm-ti-delete { opacity: 1; }
.stm-ti-rename:hover { color: #f0d89a; }
.stm-ti-delete:hover { color: #c45c5c; }
.stm-dragging { opacity: 0.4; }
.stm-drop-before { box-shadow: inset 0 2px 0 #c9a24a; }
.stm-drop-after  { box-shadow: inset 0 -2px 0 #c9a24a; }
.stm-drop-inside { outline: 1px dashed #c9a24a; background: #2a1e0a; }

/* ── TREE CHILDREN ── */
.stm-tree-children { }
.stm-tree-add-row {
  padding: 8px 10px;
  border-top: 1px solid #2a1e0a;
  margin-top: auto;
}
.stm-tree-add-btn {
  width: 100%;
  font-size: 11px;
  padding: 4px 0;
  text-align: center;
}

/* ── BREADCRUMB ── */
.stm-breadcrumb {
  font-size: 11px;
  color: #9a7d3f;
  margin: 0 8px;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── SETTINGS HR ── */
.stm-settings-hr {
  border: none;
  border-top: 1px solid #c0aa80;
  margin: 16px 0;
  opacity: 0.4;
}

/* ── IMPORT DIALOG ── */
.stm-import-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}
.stm-import-count {
  font-size: 11px;
  color: #8c6d30;
  margin-left: auto;
}
.stm-import-list {
  max-height: 320px;
  overflow-y: auto;
  border: 1px solid #c0aa80;
  border-radius: 2px;
}
.stm-import-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 8px 10px;
  border-bottom: 1px solid #e8e0c8;
  cursor: pointer;
}
.stm-import-row:last-child { border-bottom: none; }
.stm-import-row:hover      { background: #fdf8ea; }
.stm-import-row input[type=checkbox],
.stm-dialog-overlay input[type=checkbox] {
  appearance: none !important;
  -webkit-appearance: none !important;
  width: 15px !important;
  height: 15px !important;
  margin: 3px 0 0 0 !important;
  flex-shrink: 0;
  box-sizing: border-box !important;
  border: 1.5px solid var(--st-check-mark, #2b1d0e) !important;
  border-radius: 2px !important;
  background-color: var(--st-check-face, #f5f0e0) !important;
  background-image: none !important;
  background-repeat: no-repeat !important;
  background-position: center !important;
  background-size: 10px 10px !important;
  box-shadow: none !important;
  cursor: pointer;
  padding: 0 !important;
  accent-color: transparent;
  filter: none !important;
  overflow: visible !important;
  transform: none !important;
  outline: none !important;
}
.stm-import-row input[type=checkbox]:checked,
.stm-dialog-overlay input[type=checkbox]:checked {
  background-color: var(--st-check-face, #f5f0e0) !important;
  border-color: var(--st-check-mark, #2b1d0e) !important;
  background-image: var(--st-check-svg) !important;
}
.stm-import-row input[type=checkbox]::before,
.stm-import-row input[type=checkbox]::after,
.stm-import-row input[type=checkbox]:checked::before,
.stm-import-row input[type=checkbox]:checked::after,
.stm-dialog-overlay input[type=checkbox]::before,
.stm-dialog-overlay input[type=checkbox]::after,
.stm-dialog-overlay input[type=checkbox]:checked::before,
.stm-dialog-overlay input[type=checkbox]:checked::after {
  content: none !important;
  display: none !important;
  box-shadow: none !important;
  background: none !important;
  width: 0 !important;
  height: 0 !important;
  transform: none !important;
  clip-path: none !important;
}
.stm-agent-stamped {
  opacity: 0.55;
  background: #ebe4d2;
}
.stm-agent-stamped:hover { background: #e4dcc6; }
.stm-agent-book-label {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.stm-agent-stamp {
  display: inline-block;
  font-size: 10px;
  letter-spacing: 0.04em;
  color: #6b4f1e;
  font-family: 'Courier New', Courier, monospace;
}
.stm-import-entry-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.stm-import-entry-label {
  font-weight: bold;
  font-size: 12px;
  color: #1a1208;
}
.stm-import-entry-preview {
  font-size: 11px;
  color: #6b4f1e;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.stm-import-status {
  margin-top: 10px;
  padding: 8px 10px;
  background: #fdf8ea;
  border: 1px solid #c0aa80;
  font-size: 12px;
  color: #1a1208;
  border-radius: 2px;
}

.stm-credit-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 180px;
  overflow-y: auto;
  width: 100%;
}
.stm-credit-wrap { width: 100%; margin: 8px 0; }
.stm-credit-list-view {
  display: flex;
  flex-direction: column;
  max-height: 140px;
  overflow-y: auto;
  border-top: 1px dotted #9a7d3f;
  border-bottom: 1px dotted #9a7d3f;
}
.stm-credit-name-btn {
  display: block;
  width: 100%;
  text-align: left;
  background: transparent;
  border: none;
  border-bottom: 1px dotted rgba(154, 125, 63, 0.45);
  color: #1a1208;
  font: inherit;
  font-size: 12px;
  padding: 6px 4px;
  cursor: pointer;
}
.stm-credit-name-btn:last-child { border-bottom: none; }
.stm-credit-name-btn:hover { background: rgba(201, 162, 74, 0.18); }
.stm-folder .stm-credit-name-btn { color: #2b1d0e; }
.stm-folder .stm-credit-list-view {
  border-color: #6b4f1e;
}
.stm-credit-menu {
  position: fixed;
  z-index: 10050;
  min-width: 150px;
  background: #1a1208;
  border: 1px solid #c9a24a;
  box-shadow: 0 8px 20px rgba(0,0,0,0.5);
  display: flex;
  flex-direction: column;
  padding: 4px;
}
.stm-credit-menu button {
  background: transparent;
  border: none;
  color: #f0d89a;
  text-align: left;
  padding: 8px 10px;
  cursor: pointer;
  font-size: 12px;
}
.stm-credit-menu button:hover:not(:disabled) { background: #2a1e0a; }
.stm-credit-menu button:disabled { opacity: 0.4; cursor: default; }
.stm-sponsor-wrap { width: 100%; margin: 8px 0; }
.stm-sponsor-list-view {
  display: flex;
  flex-direction: column;
  max-height: 140px;
  overflow-y: auto;
  border-top: 1px dotted #9a7d3f;
  border-bottom: 1px dotted #9a7d3f;
}
.stm-sponsor-name-btn {
  display: flex;
  width: 100%;
  align-items: baseline;
  gap: 8px;
  text-align: left;
  background: transparent;
  border: none;
  border-bottom: 1px dotted rgba(154, 125, 63, 0.45);
  color: #1a1208;
  font: inherit;
  font-size: 12px;
  padding: 6px 4px;
  cursor: pointer;
}
.stm-sponsor-name-btn:last-child { border-bottom: none; }
.stm-sponsor-name-btn:hover { background: rgba(201, 162, 74, 0.18); }
.stm-sponsor-kind { font-size: 10px; opacity: 0.65; margin-left: auto; }
.stm-folder .stm-sponsor-name-btn { color: #2b1d0e; }
.stm-folder .stm-sponsor-list-view { border-color: #b89a5a; }
.stm-sponsor-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.stm-sponsor-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: #e8efe8;
  border: 1px solid #6a8a6a;
  border-radius: 999px;
  padding: 2px 8px;
  font-size: 11px;
  color: #1a1208;
}
.stm-sponsor-tools {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  margin-top: 6px;
  position: relative;
}
.stm-sponsor-search {
  flex: 1;
  min-width: 140px;
  margin-top: 0;
  width: 100%;
  background: #1f1609;
  border: 1px dashed #6b4f1e;
  color: #d4c9a8;
  font-size: 11px;
  padding: 4px 8px;
}
.stm-sponsor-suggest {
  position: absolute;
  left: 0;
  right: 0;
  top: 100%;
  z-index: 5;
  margin-top: 4px;
  background: #1a1208;
  border: 1px solid #6b4f1e;
  max-height: 160px;
  overflow-y: auto;
}
.stm-sponsor-menu {
  position: fixed;
  z-index: 10050;
  min-width: 170px;
  background: #1a1208;
  border: 1px solid #c9a24a;
  box-shadow: 0 8px 20px rgba(0,0,0,0.5);
  display: flex;
  flex-direction: column;
  padding: 4px;
}
.stm-sponsor-menu button {
  background: transparent;
  border: none;
  color: #f0d89a;
  text-align: left;
  padding: 8px 10px;
  cursor: pointer;
  font-size: 12px;
}
.stm-sponsor-menu button:hover:not(:disabled) { background: #2a1e0a; }
.stm-sponsor-menu button:disabled { opacity: 0.4; cursor: default; }
.stm-credit-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.stm-credit-tools {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  margin-top: 6px;
  position: relative;
}
.stm-credit-tools .stm-credit-search {
  flex: 1;
  min-width: 140px;
  margin-top: 0;
}
.stm-credit-tools .stm-credit-suggest {
  position: absolute;
  left: 0;
  right: 0;
  top: 100%;
  z-index: 5;
}
.stm-credit-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: #efe4c4;
  border: 1px solid #9a7d3f;
  border-radius: 999px;
  padding: 2px 8px;
  font-size: 11px;
  color: #1a1208;
}
.stm-folder .stm-credit-chip { background: #d4c49a; color: #2b1d0e; }
.stm-credit-chip--npc { border-style: dashed; }
.stm-credit-cast {
  border: none;
  background: #6b4f1e;
  color: #f0d89a;
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 999px;
  cursor: pointer;
}
.stm-credit-search {
  margin-top: 6px;
  width: 100%;
  background: #1f1609;
  border: 1px dashed #6b4f1e;
  color: #d4c9a8;
  font-size: 11px;
  padding: 4px 8px;
}
.stm-credit-suggest {
  margin-top: 4px;
  background: #1a1208;
  border: 1px solid #6b4f1e;
  max-height: 160px;
  overflow-y: auto;
}
.stm-suggest-item {
  display: block;
  width: 100%;
  text-align: left;
  background: transparent;
  border: none;
  color: #f0d89a;
  padding: 6px 8px;
  cursor: pointer;
  font-size: 12px;
}
.stm-suggest-item:hover { background: #2a1e0a; }
.stm-suggest-item em { color: #9a7d3f; font-style: normal; font-size: 10px; }
.stm-quotes { margin: 8px 0; }
.stm-quote {
  margin: 6px 0;
  padding: 4px 8px;
  border-left: 3px solid #c9a24a;
  color: #3a2a12;
  font-style: italic;
}
.stm-folder .stm-quote { color: #3a2a12; }
.stm-quote cite { font-style: normal; font-size: 10px; color: #8c6d30; }
.stm-folder-desc {
  white-space: pre-wrap;
  margin: 10px 0 4px;
  line-height: 1.5;
  color: #3a2a12;
  text-align: center;
  font-size: 13px;
}
.stm-card-span { font-size: 11px; color: #8c6d30; margin-bottom: 4px; }
.stm-credit-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}
.stm-credit-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.stm-credit-pri { font-size: 10px; opacity: 0.7; }
.stm-form-row--toggles {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.stm-form-row--toggles label { display: flex; align-items: center; gap: 6px; }
.stm-card-keys { font-size: 11px; opacity: 0.7; margin-top: 4px; }
.stm-flag { font-size: 10px; letter-spacing: 1px; text-transform: uppercase; margin-right: 6px; color: #c8aa6e; }
.stm-flag-off { color: #8a5a5a; }

/* ── TREE ITEM ICON / LABEL ── */
.stm-ti-icon  { margin-right: 5px; font-size: 13px; }
.stm-ti-label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* ── TIMELINE PINBOARD ── */
/* Board children are absolute — without a sized canvas the flex chain
 * collapses to the legend alone (same failure mode the old _sizeTimeline
 * patched). Give the wrap a real min-height so the viewport always paints. */
.stm-tl-wrap {
  flex: 1;
  min-width: 0;
  min-height: min(42vh, 420px);
  display: flex;
  flex-direction: column;
  background: #140e06;
  overflow: hidden;
}
.stm-tl-legend {
  flex-shrink: 0;
  font-size: 11px;
  color: #8c6d30;
  padding: 8px 12px;
  border-bottom: 1px solid #2a1e0a;
  display: flex;
  align-items: flex-start;
  gap: 10px;
}
.stm-tl-legend > span { flex: 1; min-width: 0; }
.stm-tl-legend-x {
  appearance: none;
  border: 1px solid #5a4020;
  background: transparent;
  color: #8c6d30;
  cursor: pointer;
  font-size: 11px;
  line-height: 1;
  padding: 2px 6px;
}
.stm-tl-scrub {
  flex-shrink: 0;
  width: 100%;
  height: 14px;
  margin: 0;
  accent-color: #c9a24a;
  background: #1a1208;
  cursor: pointer;
}
.stm-tb-lock {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: #c9a24a;
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
}
.stm-tb-lock input { margin: 0; }
.stm-tl-legend-x:hover { color: #c8aa6e; border-color: #c8aa6e; }
.stm-tl-zoom-label {
  font-size: 11px;
  letter-spacing: 1px;
  text-transform: uppercase;
  color: #c8aa6e;
  min-width: 64px;
  text-align: center;
}
.stm-tl-show-pop {
  position: relative;
  color: #c8aa6e;
  font-size: 11px;
  z-index: 30;
}
.stm-tl-show-pop > summary {
  list-style: none;
  cursor: pointer;
  padding: 3px 8px;
  border: 1px solid #6b4f1e;
  background: #2a1e0a;
  border-radius: 2px;
  letter-spacing: 1px;
  text-transform: uppercase;
  user-select: none;
}
.stm-tl-show-pop > summary::-webkit-details-marker { display: none; }
.stm-tl-show-pop[open] > summary { border-color: #c9a24a; color: #f0d89a; }
.stm-tl-goto-body {
  width: min(260px, calc(100vw - 24px));
}
.stm-tl-goto-hint {
  font-size: 10px;
  color: #8c6d30;
  margin-bottom: 8px;
  line-height: 1.35;
}
.stm-tl-goto-row {
  margin-bottom: 6px;
}
.stm-tl-goto-row label {
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 10px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #c8aa6e;
}
.stm-tl-goto-row input,
.stm-tl-goto-row select {
  appearance: none;
  background: #140e06;
  border: 1px solid #5a4020;
  color: #f0d89a;
  font-family: inherit;
  font-size: 12px;
  padding: 4px 6px;
  border-radius: 2px;
}
.stm-tl-goto-actions {
  display: flex;
  gap: 6px;
  margin-top: 8px;
  flex-wrap: wrap;
}
.stm-tl-show-pop-body {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  left: auto;
  z-index: 50;
  width: min(280px, calc(100vw - 24px));
  max-height: min(240px, 42vh);
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 8px;
  background: #1a1208;
  border: 1px solid #6b4f1e;
  box-shadow: 0 8px 20px rgba(0,0,0,0.45);
}
.stm-tl-show-row {
  flex-wrap: wrap;
  gap: 6px 10px;
}
.stm-tl-main {
  flex: 1;
  min-height: 220px;
  min-width: 0;
  display: flex;
  align-items: stretch;
}
.stm-tl {
  flex: 1;
  min-height: 220px;
  min-width: 0;
  overflow: hidden;
  position: relative;
  height: 100%;
  cursor: grab;
  touch-action: none;
  overscroll-behavior: contain;
}
.stm-tl--panning { cursor: grabbing; }
.stm-tl-board {
  position: absolute;
  inset: 0;
  overflow: hidden;
  background:
    radial-gradient(circle at 20% 30%, rgba(90,60,20,0.18), transparent 42%),
    radial-gradient(circle at 80% 70%, rgba(50,40,20,0.2), transparent 46%),
    #1a1208;
}
.stm-tl-dock {
  flex-shrink: 0;
  width: 176px;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border-left: 1px solid #2a1e0a;
  background: #140e06;
  overflow-y: auto;
}
.stm-tl-dock[hidden] { display: none; }
.stm-tl-dock-head {
  font-size: 11px;
  letter-spacing: 1px;
  text-transform: uppercase;
  color: #c8aa6e;
  display: flex;
  align-items: baseline;
  gap: 6px;
}
.stm-tl-dock-count {
  font-size: 10px;
  color: #8c6d30;
}
.stm-tl-dock-hint {
  margin: 0;
  font-size: 10px;
  color: #8c6d30;
  line-height: 1.4;
}
.stm-tl-dock-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow-y: auto;
}
.stm-tl-dock-chip {
  display: flex;
  align-items: center;
  gap: 4px;
  background: #1a1208;
  border: 1px solid #4a3818;
  padding: 3px 4px;
  font-size: 11px;
}
.stm-tl-dock-grip {
  cursor: grab;
  color: #8c6d30;
  user-select: none;
  padding: 0 2px;
}
.stm-tl-dock-grip:active { cursor: grabbing; }
.stm-tl-dock-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #efe4c4;
  cursor: pointer;
}
.stm-tl-dock-place {
  padding: 0 5px !important;
  font-size: 11px !important;
  min-width: 0;
  line-height: 1.3;
}
.stm-tl-dock-ghost {
  position: fixed;
  z-index: 10100;
  transform: translate(-50%, -140%);
  background: #efe4c4;
  border: 1px solid #9a7d3f;
  color: #1a1208;
  font-size: 11px;
  padding: 3px 8px;
  pointer-events: none;
  box-shadow: 2px 3px 0 rgba(0,0,0,0.35);
  opacity: 0.9;
}
.stm-tl-dock-ghost--over {
  border-color: #c9a24a;
  box-shadow: 0 0 0 1px #c9a24a, 2px 3px 0 rgba(0,0,0,0.35);
}
.stm-tl-dockret {
  padding: 0 3px !important;
  font-size: 10px !important;
  min-width: 0;
  line-height: 1.1;
  opacity: 0.6;
}
.stm-tl-dockret:hover { opacity: 1; }
.stm-tl-item--manual .stm-tl-pin { border-style: dashed; }
.stm-tl-axis {
  position: absolute;
  background: #c9a24a;
  box-shadow: 0 0 8px rgba(201,162,74,0.35);
  z-index: 1;
  pointer-events: none;
}
.stm-tl--h .stm-tl-axis {
  left: 0;
  right: 0;
  top: 50%;
  height: 2px;
  transform: translateY(-50%);
}
.stm-tl--v .stm-tl-axis {
  top: 0;
  bottom: 0;
  left: 50%;
  width: 2px;
  transform: translateX(-50%);
}
.stm-tl-ticks { position: absolute; inset: 0; z-index: 2; pointer-events: none; }
.stm-tl-ranges { position: absolute; inset: 0; z-index: 1; pointer-events: none; }
.stm-tl-range {
  position: absolute;
  background: rgba(201, 162, 74, 0.28);
  border-radius: 4px;
}
.stm-tl--h .stm-tl-range {
  height: 8px;
  transform: translateY(-50%);
}
.stm-tl--v .stm-tl-range {
  width: 8px;
  transform: translateX(-50%);
}
.stm-tl-range--library { background: rgba(74, 106, 138, 0.32); }
.stm-tl-item--library .stm-tl-pin--library {
  border-color: #4a6a8a;
  background: #eef3f8;
}
.stm-tl-promote {
  font-size: 11px !important;
  padding: 0 4px !important;
  min-width: 0;
  line-height: 1.2;
}
.stm-tl-tick {
  position: absolute;
  display: flex;
  flex-direction: column;
  align-items: center;
  pointer-events: none;
}
.stm-tl-tick[hidden],
.stm-tl-range[hidden] { display: none !important; }
.stm-tl-tick i {
  display: block;
  background: #6b4f1e;
  flex-shrink: 0;
}
.stm-tl--h .stm-tl-tick { transform: translate(-50%, -50%); }
.stm-tl--h .stm-tl-tick--minor i { width: 1px; height: 6px; opacity: 0.55; }
.stm-tl--h .stm-tl-tick--major i { width: 1px; height: 12px; background: #c9a24a; }
.stm-tl--h .stm-tl-tick--major.stm-tl-tick--label i { height: 16px; }
.stm-tl--v .stm-tl-tick {
  flex-direction: row;
  transform: translate(-50%, -50%);
}
.stm-tl--v .stm-tl-tick--minor i { height: 1px; width: 6px; opacity: 0.55; }
.stm-tl--v .stm-tl-tick--major i { height: 1px; width: 12px; background: #c9a24a; }
.stm-tl--v .stm-tl-tick--major.stm-tl-tick--label i { width: 16px; }
.stm-tl-tick b {
  display: none;
  font-size: 9px;
  letter-spacing: 0.4px;
  color: #8c6d30;
  font-weight: normal;
  white-space: nowrap;
  line-height: 1.1;
  max-width: 7.5em;
  overflow: hidden;
  text-overflow: ellipsis;
}
.stm-tl-tick--label b { display: block; }
.stm-tl--h .stm-tl-tick--below b { margin-top: 4px; }
.stm-tl--v .stm-tl-tick--below b { margin-left: 8px; }
.stm-tl-now {
  position: absolute;
  z-index: 2;
  pointer-events: none;
  left: 50%;
  top: 50%;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #f0d89a;
  box-shadow: 0 0 10px #c9a24a;
  transform: translate(-50%, -50%);
}
.stm-tl-empty {
  position: absolute;
  left: 50%;
  top: 58%;
  transform: translate(-50%, -50%);
  color: #8c6d30;
  font-size: 13px;
  z-index: 3;
}
.stm-tl-item {
  position: absolute;
  width: 0;
  height: 0;
  z-index: 4;
}
.stm-tl-item--on, .stm-tl-item--drag { z-index: 8; }
.stm-tl-item--sel .stm-tl-pin {
  box-shadow: 0 0 0 2px #f0d89a, 0 0 12px rgba(201,162,74,.55);
}
.stm-tl-item--sel .stm-tl-tack {
  box-shadow: 0 0 0 2px #f0d89a;
}
.stm-tl-item--drag .stm-tl-pin { opacity: 0.92; }
.stm-tl-tack {
  position: absolute;
  left: 0;
  top: 0;
  width: 14px;
  height: 14px;
  border: 2px solid #1a1208;
  border-radius: 50%;
  background: #c9a24a;
  box-shadow: 0 0 0 1px #f0d89a;
  transform: translate(-50%, -50%);
  cursor: grab;
  padding: 0;
  z-index: 7;
}
.stm-tl-tack[hidden] { display: none !important; }
.stm-tl-tack--cluster {
  width: 18px;
  height: 18px;
  background: #f0d89a;
  box-shadow: 0 0 0 1px #c9a24a, 0 0 10px rgba(201,162,74,0.45);
}
.stm-tl-tack--cluster::after {
  content: attr(data-count);
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  font-size: 9px;
  font-weight: bold;
  font-family: 'Courier New', Courier, monospace;
  color: #1a1208;
  line-height: 1;
  pointer-events: none;
}
.stm-tl-tack:hover, .stm-tl-item--on .stm-tl-tack {
  background: #f0d89a;
}
.stm-tl-tack--event {
  width: 11px;
  height: 11px;
  border-radius: 1px;
  background: #7a3048;
  transform: translate(-50%, -50%) rotate(45deg);
  box-shadow: 0 0 0 1px #c9a24a;
}
.stm-tl-item--event-personal .stm-tl-tack--event { background: #3d6a68; }
.stm-tl-pin--event {
  background: #f3ead4;
  border-color: #7a3048;
  cursor: default;
  clip-path: polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 0 100%);
}
.stm-tl-item--event-personal .stm-tl-pin--event { border-color: #3d6a68; }
.stm-tl-item--event .stm-tl-pin-org { color: #7a3048; letter-spacing: 0.8px; text-transform: uppercase; }
.stm-tl-item--event-personal .stm-tl-pin-org { color: #2a4a48; }
.stm-tl-dock-chip--event {
  border-color: #7a3048;
  background: #f3ead4;
}
.stm-tl-item--drag .stm-tl-tack { cursor: grabbing; }
.stm-tl-stem {
  position: absolute;
  background: #c9a24a;
  opacity: 0.7;
  pointer-events: none;
  z-index: 3;
  border-radius: 1px;
}
.stm-tl-pin {
  position: absolute;
  left: 0;
  top: 0;
  z-index: 4;
  width: 148px;
  background: #efe4c4;
  border: 1px solid #9a7d3f;
  box-shadow: 2px 3px 0 rgba(0,0,0,0.35);
  padding: 6px 8px 7px;
  cursor: grab;
  user-select: none;
  font-family: 'Courier New', Courier, monospace;
}
.stm-tl-item--on .stm-tl-pin, .stm-tl-pin:hover {
  border-color: #f0d89a;
  box-shadow: 0 0 0 1px #c9a24a, 2px 3px 0 rgba(0,0,0,0.35);
}
.stm-tl-item--drag .stm-tl-pin { cursor: grabbing; }
.stm-tl-item--locked .stm-tl-pin,
.stm-tl-item--locked .stm-tl-tack { cursor: default; }
.stm-tl-pin-bar {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 2px;
}
.stm-tl-pin .stm-tl-lock {
  padding: 0;
  font-size: 12px;
  line-height: 1;
  background: transparent;
  border: none;
  opacity: 0.28;
  filter: grayscale(1);
  cursor: pointer;
}
.stm-tl-lock:hover { opacity: 0.7; filter: grayscale(0.4); }
.stm-tl-lock--on {
  opacity: 1;
  filter: none;
}
.stm-tl-now[hidden] { display: none; }
.stm-tl-pin-org {
  display: block;
  font-size: 9px;
  letter-spacing: 0.6px;
  color: #8c6d30;
}
.stm-tl-pin-title {
  display: block;
  font-size: 12px;
  font-weight: 700;
  color: #1a1208;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.stm-tl-pin-time {
  display: block;
  font-size: 10px;
  color: #4a5e7a;
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

    `;
  }

}  // ← closes ScriptModule class