// Backstage — the house behind the house. Listing board for Production,
// Interview, Peanut Gallery, Stage/Set, and Settings (migrated from Script).

import { getContext, extension_settings } from '../../../../../extensions.js';
import { getRequestHeaders, saveSettingsDebounced, eventSource, event_types, extension_prompt_types } from '../../../../../../script.js';
import { power_user } from '../../../../../power-user.js';
import { Module } from '../../lib/module.js';
import { getCastMembers, getStarMember, formatDirectorPromptBlock, resolveCastPromptIdentity, listPersonas, PRIORITIES, PRIORITY_DEFAULT_COLORS, getRoleColors, setRoleColor, resetRoleColors, applyRoleColorVars, normalizePlotHook, formatPlotHookLine, normalizeCastPresence } from '../../lib/castCatalog.js';
import { getSceneCards, creditedScenes, sceneCode } from '../../lib/scriptCatalog.js';
import { flattenFacets } from '../../lib/keywordFacets.js';
import {
  listPlaySecrets,
  knowerLabel,
  standingSubjects,
  standingToward,
  standingInfo,
  secretsKnownToCharacter,
  secretsAboutCharacter,
  characterHouseIds,
} from '../../lib/motivationCatalog.js';
import {
  applySceneCuesFromChat,
  compactConnectionsInject,
  compactSceneInject,
  clipText,
  haystackLower,
  textMatchesHay,
  playMessagesSince,
  smokeChatTrackCuePure,
} from '../../lib/chatTrack.js';
import { withShowtimeProfile } from '../../lib/connectionProfile.js';
import { rafMove } from '../../lib/uiPerf.js';
import { formatChatLine, clipExcerptToLines } from '../../lib/castAudit.js';
import { parseJsonObject, parseJsonArray, smokeJsonExtractPure } from '../../lib/jsonExtract.js';
import { leanQuietGenerate, pinnedGenerateRaw, SYSTEM_VOICE } from '../../lib/isolatedGen.js';
import {
  locCueHit,
  knownPlaceRoster,
  buildLocationDeltaPrompt,
  parseLocationDelta,
  applyLocationDelta,
  dismissUnlisted,
  forgetUnlisted,
  dropMatchedUnlisted,
  syncScriptLibraryUnlisted,
} from '../../lib/compass/unlisted.js';
import {
  hydrateFromDirectorJson,
  normalizePendingEvent,
  eventPaperInner,
  matchCast,
  firstHookTitle,
  eventFromLogEntry,
  EVENT_MODES,
  DIRECTOR_TAG_FACETS,
  defaultDirectorSources,
  mergeDirectorSources,
  formatDirectorPicksBlock,
} from '../../lib/directorEvent.js';
import { createHookFromEvent } from '../../lib/plotHookBridge.js';
import { getCachedLibraryBooks, listLibraryLeaves, listVisibleLibraryLeaves, clearOrphanTags } from '../../lib/libraryCatalog.js';
import {
  ensureCompass,
  createAndStoreRoom,
  loadRoom,
  unloadRoom,
  getActiveRoom,
  getPlace,
  renamePlace,
  setPlaceKind,
  setParent,
  setLocationTags,
  setPlaceAliases,
  deletePlace,
  mergePlaces,
  setOrientationNote,
  setPlaceDescription,
  setPlaceExposed,
  setFootprint,
  insertFootprintVertex,
  addInternalWall,
  removeInternalWall,
  addItem,
  updateItem,
  removeItem,
  moveItem,
  pickupItem,
  addPickupToInventory,
  listLostAndFound,
  addToLostAndFound,
  removeFromLostAndFound,
  sendItemToLostAndFound,
  placeFromLostAndFound,
  addOccupant,
  removeOccupant,
  moveOccupant,
  faceOccupant,
  addLink,
  removeLink,
  setLinkExternal,
  linkWallToRoom,
  setSharedWallStyle,
  alignSuiteWalls,
  clearSuiteVisualAlign,
  deleteInteriorSharedWall,
  fuseSuiteRoomsAlongWall,
  insertSuiteCornerVertices,
  reshapeSuiteRoomFace,
  sharedPairForSuiteEdge,
  ensureEdgeLink,
  ensureVerticalLink,
  addOpening,
  updateOpening,
  removeOpening,
  undoLastChange,
  undoSuiteLastChange,
  pushSuiteHistory,
  restoreSuiteWall,
  joinCollinearSuiteVertex,
  simplifySuiteRoomFootprint,
  smokeSuiteWallRestorePure,
  collectActiveLocationTags,
  moveSuiteChild,
  ensureSuiteLayout,
  divideRoom,
  listSuiteChildren,
} from '../../lib/compass/state.js';
import { buildCompassInjection, pickInjectionNames, invalidateRenderCache } from '../../lib/compass/render.js';
import { registerCompassCommands } from '../../lib/compass/commands.js';
import { buildSetHtml, buildPlacementHtml, buildPlacementPovPreview, findPlaceForTag, findPlaceByExactName } from '../../lib/compass/stageUi.js';
import { openCellDialog, openOpeningDialog, openFurnitureDialog, openPieceDialog } from '../../lib/compass/dialogs.js';
import { applySonarPings, listSonarPingsInPlace, summarizeSonarCheck, sonarFingerprint, setSonarExcluded, pinSonarPing, smokeSonarLocationPure } from '../../lib/compass/sonar.js';
import { auditCompass, applySafeAuditFixes, smokeCompassAuditPure } from '../../lib/compass/audit.js';
import { COMPASS_VERSION, isVerticalOpeningType, normalizeSuitePose, isSuiteHostKind, isCompassPlaceKind, normalizeCell, PLACE_NEST_PARENTS, PLACE_KIND_SET } from '../../lib/compass/schema.js';
import { locationTagEditorHTML, readLocationTags } from '../../lib/locationTagPicker.js';
import { bindLocationCatalogPicker, formatSceneLocation, mostPreciseGeoName, lowestLocationNames, locationKeyFromStored, smokeSceneLocationPure, syncLocationCatalogFromCompass, upsertLocationNode, GROUP_TO_COMPASS, COMPASS_TO_GROUP, findLocationNodeByName, findLocationNodeById, findLocationNodeByPlaceId, collectLocationIdentity, rewriteLocationTagNames, removeLocationNode, mergeLocationNodes, pruneGhostLocationNodes } from '../../lib/locationCatalog.js';
import {
  defaultTrackers,
  normalizeTrackers,
  buildTrackersHtml,
  formatTrackerTimeFromHour,
  formatSceneDate,
  weatherPoolForSeason,
  parseWeatherToken,
  normalizeCustomBar,
} from '../../lib/trackersConfig.js';
import {
  getTimelinePresent,
  normalizeCalendar,
  seasonForMonth,
  formatTimeKey,
  shiftPartsByDays,
  smokeCalendarShiftPure,
} from '../../lib/calendarTime.js';
import { buildFloatingClapperHtml, CLAPPER_CSS } from '../../lib/clapperUi.js';
import { clampFixedElement } from '../../lib/shell.js';
import {
  defaultVisuals,
  normalizeVisuals,
  normalizeBackground,
  buildVisualsHtml,
  pickBackground,
  resolveBackgroundSrc,
  backgroundFallbackSrc,
  smokeBackgroundPickPure,
} from '../../lib/backgrounds.js';
import {
  buildEffectsHtml,
  clearWeatherOverlay,
  defaultEffects,
  normalizeEffects,
  paintWeatherOverlay,
  syncWeatherOverlay,
  syncWeatherAudio,
  resolveSheltered,
  TEST_PRESETS,
  smokeOverlayWxPure,
  clampParticleIntensity,
} from '../../lib/weatherOverlay.js';
import {
  registerWorldIndexInjection,
  buildWorldIndexPreviewHtml,
  smokeWorldIndexPure,
} from '../../lib/worldIndex.js';
import { collectReelExtras, decorateReel, importReelExtras, isReelPayload } from '../../lib/reel.js';
import {
  moveVertex,
  moveEdge,
  moveEdges,
  translateFootprint,
  resetFootprintRectangle,
  edgeEndpoints,
  alongEdgeFromPoint,
  pointAlong,
  normalizeFootprint,
  projectFootprint,
} from '../../lib/compass/floorplan.js';
import {
  worldPolygon,
  worldToFootprintNorm,
  worldFromNorm,
  nearestFacingEdge,
  moveFaceVerts,
  facingEdges,
  smokeAlignSuiteContactPure,
} from '../../lib/compass/suiteLayout.js';
import { smokeSuiteFloorplanGlyphs } from '../../lib/compass/dialogs.js';
import { finalizeWallSegment } from '../../lib/compass/barriers.js';

const LOBBY_DOORS = [
  {
    id: 'production',
    mark: '🎞',
    title: 'Production',
    blurb: 'Director events, holidays, databank imports & exports.',
  },
  {
    id: 'interview',
    mark: '🎙',
    title: 'Interview',
    blurb: 'Configure once, then sit with one cast member.',
  },
  {
    id: 'gallery',
    mark: '💬',
    title: 'Peanut Gallery',
    blurb: 'Stream-chat commentary from the cast. Listen in.',
  },
  {
    id: 'stage',
    mark: '🗺',
    title: 'Stage',
    blurb: 'Set, placement, and studio shelves — map, dressing, effects, trackers, visuals.',
  },
  {
    id: 'settings',
    mark: '⚙',
    title: 'Settings',
    blurb: 'Handbook, profiles, theme, tab toggles, master off.',
  },
];

/** Nested under Stage (not top-level listings). */
const STAGE_DOORS = [
  {
    id: 'set',
    mark: '📐',
    title: 'Set',
    blurb: 'Places, floorplan shape, compass areas, and wall links.',
  },
  {
    id: 'placement',
    mark: '🪑',
    title: 'Placement',
    blurb: 'Dress areas, view details, preview what a character notices on entry.',
  },
  {
    id: 'studio-effects',
    mark: '🌤',
    title: 'Effects',
    blurb: 'Ambiance, weather, and immersive overlays.',
  },
  {
    id: 'studio-trackers',
    mark: '📊',
    title: 'Trackers',
    blurb: 'Tracker visuals, what is tracked, and call frequency.',
  },
  {
    id: 'studio-visuals',
    mark: '🖼',
    title: 'Visuals',
    blurb: 'Backgrounds assigned to rooms and areas.',
  },
];

const DOORS = [...LOBBY_DOORS, ...STAGE_DOORS];
const STAGE_DOOR_IDS = new Set(STAGE_DOORS.map(d => d.id));
const FP_ZOOM_MIN = 0.4;
const FP_ZOOM_MAX = 3;

/** Flip notecards — front label + source mix; back has 1–3 questions + target pickers. */
const NOTECARDS = [
  {
    id: 'props',
    label: 'Props',
    sources: 'Item · Wardrobe / Wearable',
    questions: [
      { id: 'take', text: 'What do you make of this?' },
      { id: 'seen', text: 'Have you handled or seen this lately?' },
      { id: 'who', text: 'Who ought to be carrying this — and why?' },
    ],
  },
  {
    id: 'fashion',
    label: 'Fashion',
    sources: 'Wearable + Cast',
    questions: [
      { id: 'look', text: 'What does this look say about them?' },
      { id: 'wear', text: 'Would you wear this — or put it on someone?' },
      { id: 'room', text: 'How would the room judge this outfit?' },
    ],
  },
  {
    id: 'role',
    label: 'Role',
    sources: 'Cast · Motivation / Achievements · Script · Library cubbies',
    questions: [
      { id: 'sit', text: 'How does this sit with your role?' },
      { id: 'remember', text: 'What do you remember about this beat or entry?' },
      { id: 'shift', text: 'Does this change how you play your part?' },
    ],
  },
  {
    id: 'cast',
    label: 'Cast',
    sources: 'Reputation · Affiliations · Rumors / Secrets',
    questions: [
      { id: 'stand', text: 'Where do you stand with this?' },
      { id: 'house', text: 'What does this affiliation or notice mean to you?' },
      { id: 'whisper', text: 'Heard anything whispered about this?' },
    ],
  },
];

const SCAN_FREQ = [
  { id: 'manual', label: 'Manual only' },
  { id: 'every_turn', label: 'Every chat turn' },
  { id: 'every_n', label: 'Every N messages' },
];

const INTRUDE = EVENT_MODES;
const TAG_FACETS = DIRECTOR_TAG_FACETS;
const DEFAULT_SOURCES = defaultDirectorSources;

const MODULE_LABELS = {
  cast: 'Cast',
  script: 'Script',
  inventory: 'Inventory',
  reputation: 'Reputation',
  composer: 'Composer',
  motivation: 'Motivation',
  library: 'Library',
  backstage: 'Backstage',
};

const THEME_PRESETS = [
  { id: 'paper', label: 'Paper (default)' },
  { id: 'night', label: 'Night house' },
  { id: 'crimson', label: 'Crimson curtain' },
];

function ensureShowtimeRoot() {
  if (!extension_settings.showtime) extension_settings.showtime = {};
  const root = extension_settings.showtime;
  root.enabledModules ??= {};
  if (typeof root.masterOff !== 'boolean') root.masterOff = false;
  return root;
}

export class BackstageModule extends Module {
  static id = 'backstage';
  static label = 'Backstage';
  static scope = 'chat';

  constructor(deps) {
    super(deps);
    if (!document.querySelector('link[data-showtime="backstage"]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = new URL('./backstage.css', import.meta.url).href;
      link.dataset.showtime = 'backstage';
      document.head.appendChild(link);
    }
    this._door = '';
    this._profiles = [];
    this._profilesLoaded = false;
    this._busy = false;
    this._prodFolds = new Set(['director', 'events', 'set-places']);
    this._sonarFilter = '';
    this._sonarView = 'all';
    this._placesFold = new Set();
    this._placesFoldUser = false;
    this._placesEditId = '';
    this._locTrackPrimed = false;
    this._locLastCount = 0;
    this._locBusy = false;
  }

  async init() {
    this.bus?.on('backstage.open', ({ door } = {}) => {
      this._door = door || 'settings';
      const shell = window.Showtime?.shell;
      shell?.activate?.('backstage');
      if (this.container) this.render(this.container);
    });
    this.bus?.on('showtime.chatPresence', () => {
      try { this._syncFloatingClapper(); } catch { /* ignore */ }
    });
    this.bus?.on('showtime.stateChanged', () => {
      try {
        const scene = normalizeTrackers(this._db().trackers).scene;
        if (!scene.enabled || scene.followTimeline === false) return;
        // Soft-refresh clapper date/time from the Script present (narrative now).
        clearTimeout(this._tlFollowTimer);
        this._tlFollowTimer = setTimeout(() => {
          try {
            const st = this._db();
            const snap = this._sceneClapSnapshot(st);
            let dirty = false;
            if (st.trackers.scene.date && snap.date && snap.date !== '—') {
              if (st.trackers.scene.lastDateLabel !== snap.date) {
                st.trackers.scene.lastDateLabel = snap.date;
                dirty = true;
              }
            }
            if (st.trackers.scene.time && snap.time) {
              if (st.trackers.scene.lastTimeLabel !== snap.time) {
                st.trackers.scene.lastTimeLabel = snap.time;
                dirty = true;
              }
            }
            if (dirty) this.saveState();
            this._syncFloatingClapper();
          } catch { /* ignore */ }
        }, 200);
      } catch { /* ignore */ }
    });
    this.bus?.on('backstage.openEventPaper', () => this._renderEventPaper());
    this.bus?.on('production.forceDirectorCheck', (payload) => {
      void this._directorCheck({
        auto: false,
        force: true,
        settings: payload?.settings || null,
        picks: payload?.picks || null,
      });
    });
    this._applyTheme(this._g().theme);
    applyRoleColorVars();
    this._registerInjection();
    registerCompassCommands({
      storage: this.storage,
      bus: this.bus,
      save: () => this.saveState(),
      refresh: () => {
        if (this.container && (this._door === 'set' || this._door === 'placement' || this._door === 'stage')) this.render(this.container);
      },
    });
    // Stage chrome lives outside the marquee — sync even if Backstage tab was never opened.
    queueMicrotask(() => {
      try {
        this._syncFloatingClapper();
        this._syncStageBackground();
        this._syncWeatherOverlay();
      } catch (err) {
        console.warn('[Showtime/Backstage] stage chrome sync failed', err);
      }
    });
    if (!this._genBound) {
      this._genBound = true;
      eventSource.on(event_types.GENERATION_STARTED, () => {
        this._scanChatTrackers({ persist: true });
      });
      eventSource.on(event_types.GENERATION_ENDED, () => {
        this._maybeAutoDirector();
      });
      // Re-pick stage background / refresh clapper after chat moves.
      const resyncStage = () => {
        try {
          this._scanChatTrackers({ persist: true });
          this._syncFloatingClapper();
          this._syncStageBackground();
          this._syncWeatherOverlay();
        } catch { /* ignore */ }
      };
      eventSource.on(event_types.MESSAGE_SENT, () => {
        resyncStage();
        this._scheduleLocCadence();
      });
      eventSource.on(event_types.MESSAGE_RECEIVED, resyncStage);
      eventSource.on(event_types.CHAT_CHANGED, () => {
        this._locTrackPrimed = false;
        this._locLastCount = 0;
        clearTimeout(this._locTrackTimer);
        resyncStage();
        queueMicrotask(() => this._renderEventPaper());
      });
      eventSource.on(event_types.MESSAGE_SWIPED, () => clearTimeout(this._locTrackTimer));
    }
  }

  getDefaultState() {
    return {
      version: 2,
      production: {
        directorOn: false,
        queueComposer: false,
        scanFrequency: 'manual',
        scanEveryN: 4,
        msgSinceCheck: 0,
        intrusiveness: 'advance',
        intrudeRandom: false,
        sources: DEFAULT_SOURCES(),
        lastCheckAt: 0,
        eventLog: [],
        pendingEvent: null,
        eventGuidance: '',
      },
      interview: {
        active: false,
        subjectId: '',
        interviewer: 'star',
        interviewerId: '',
        flippedNote: '',
        notePick: {},
        noteIdx: 0,
        turns: [],
        startedAt: 0,
        retry: null,
      },
      peanut: {
        mode: 'recent',
        from: 0,
        to: 0,
        recentN: 12,
        scriptUid: '',
        focusChat: false,
        sessions: [],
        activeIdx: -1, // which topic tab is being viewed/continued — see _pgActiveIdx()
      },
      stage: {
        version: COMPASS_VERSION,
        activeRoomId: '',
        rooms: {},
      },
      trackers: defaultTrackers(),
      visuals: defaultVisuals(),
      effects: defaultEffects(),
    };
  }

  _defaultGlobal() {
    return {
      theme: 'paper',
      ink: '',
      paper: '',
      gold: '',
      profiles: {
        audit: '',
        motivation: '',
        event: '',
        interview: '',
      },
      handbookSeen: false,
    };
  }

  _g() {
    const g = this.storage.getGlobal('backstage', this._defaultGlobal());
    g.theme ??= 'paper';
    g.profiles ??= { audit: '', motivation: '', event: '', interview: '' };
    g.profiles.interview ??= '';
    return g;
  }

  _saveG() {
    this.storage.saveGlobal();
  }

  _db() {
    const st = this.state;
    const def = this.getDefaultState();
    st.production ??= def.production;
    st.production.sources ??= DEFAULT_SOURCES();
    st.production.sources.tagFacets ??= { ...DEFAULT_SOURCES().tagFacets };
    st.production.scanFrequency ??= 'manual';
    st.production.scanEveryN ??= 4;
    st.production.msgSinceCheck ??= 0;
    st.production.intrusiveness ??= 'advance';
    if (typeof st.production.intrudeRandom !== 'boolean') st.production.intrudeRandom = false;
    st.production.sources.events ??= true;
    st.production.sources.stage ??= true;
    if (typeof st.production.sources.scriptStampedLore !== 'boolean') {
      st.production.sources.scriptStampedLore = false;
    }
    st.production.eventGuidance ??= '';
    st.trackers = normalizeTrackers(st.trackers);
    st.visuals = normalizeVisuals(st.visuals);
    st.effects = normalizeEffects(st.effects);
    st.interview ??= def.interview;
    st.interview.notePick ??= {};
    st.interview.flippedNote ??= '';
    st.interview.interviewerId ??= '';
    st.interview.startedAt ??= 0;
    st.interview.noteIdx = this._ivNoteIdx(st.interview);
    st.interview.retry ??= null;
    // Recover mid-session from older saves that had no `active` flag.
    if (st.interview.active == null) {
      st.interview.active = Array.isArray(st.interview.turns) && st.interview.turns.length > 0;
    }
    st.peanut ??= def.peanut;
    if (typeof st.peanut.focusChat !== 'boolean') st.peanut.focusChat = false;
    ensureCompass(st);
    return st;
  }

  async onChatChanged() {
    this._door = '';
    if (this.container) await this.render(this.container);
    else {
      try {
        this._syncFloatingClapper();
        this._syncStageBackground();
        this._syncWeatherOverlay();
      } catch { /* ignore */ }
    }
  }

  async render(container) {
    this.container = container;
    if (!this._profilesLoaded || ((this._door === 'settings' || this._door === 'interview' || this._door === 'gallery') && !this._profiles.length)) {
      this._profiles = await this._findProfiles();
      this._profilesLoaded = true;
    }
    const snap = this._captureScroll(container);
    const st = this._db();
    container.innerHTML = `
      <div class="bst-root">
        ${this._topHTML()}
        <main class="bst-body">
          ${this._door ? this._paneHTML(this._door, st) : this._boardHTML()}
        </main>
        <footer class="bst-status">${this._statusLine()}</footer>
      </div>`;
    this._bind(container.querySelector('.bst-root'));
    this._restoreScroll(container, snap);
    this._syncFloatingClapper();
    this._syncStageBackground();
    this._syncWeatherOverlay();
  }

  _captureScroll(container) {
    const parents = [];
    let el = container;
    for (let i = 0; i < 6 && el; i++) {
      if (el.scrollHeight > el.clientHeight + 1) {
        parents.push({ el, top: el.scrollTop });
      }
      el = el.parentElement;
    }
    return {
      body: container.querySelector('.bst-body')?.scrollTop ?? 0,
      iv: container.querySelector('[data-role="iv-log"]')?.scrollTop ?? 0,
      pg: container.querySelector('[data-role="pg-log"]')?.scrollTop ?? 0,
      sonar: container.querySelector('.bst-sonar-body')?.scrollTop
        ?? container.querySelector('.bst-sonar-list')?.scrollTop ?? 0,
      places: container.querySelector('.bst-set-index-list')?.scrollTop ?? 0,
      parents,
    };
  }

  _restoreScroll(container, snap) {
    if (!snap) return;
    const pinIv = !!this._ivPinBottom;
    const pinPg = !!this._pgPinBottom;
    const apply = () => {
      const body = container.querySelector('.bst-body');
      if (body) body.scrollTop = snap.body || 0;
      const iv = container.querySelector('[data-role="iv-log"]');
      if (iv) {
        iv.scrollTop = pinIv ? iv.scrollHeight : (snap.iv || 0);
      }
      const pg = container.querySelector('[data-role="pg-log"]');
      if (pg) {
        pg.scrollTop = pinPg ? pg.scrollHeight : (snap.pg || 0);
      }
      const sonar = container.querySelector('.bst-sonar-body')
        || container.querySelector('.bst-sonar-list');
      if (sonar) sonar.scrollTop = snap.sonar || 0;
      const places = container.querySelector('.bst-set-index-list');
      if (places) places.scrollTop = snap.places || 0;
      for (const p of snap.parents || []) {
        if (p.el?.isConnected) p.el.scrollTop = p.top;
      }
    };
    apply();
    requestAnimationFrame(() => {
      apply();
      if (pinIv) this._ivPinBottom = false;
      if (pinPg) this._pgPinBottom = false;
    });
  }

  _topHTML() {
    const door = DOORS.find(d => d.id === this._door);
    const underStage = STAGE_DOOR_IDS.has(this._door);
    const back = underStage
      ? `<button type="button" class="bst-back" data-action="stage-hub">← Stage</button>`
      : (this._door
        ? `<button type="button" class="bst-back" data-action="lobby">← Listings</button>`
        : '');
    const kicker = this._door === 'stage'
      ? 'Stage — pick a shelf'
      : (door ? (underStage ? `Stage · ${door.title}` : door.title) : 'House listings — pick a door');
    return `
      <header class="bst-top">
        <span class="bst-brand">Backstage</span>
        <span class="bst-kicker">${esc(kicker)}</span>
        ${back}
      </header>`;
  }

  _boardHTML(doors = LOBBY_DOORS, { heading = '' } = {}) {
    return `
      <div class="bst-board">
        ${heading ? `<div class="bst-board-group-label">${esc(heading)}</div>` : ''}
        ${doors.map(d => `
          <button type="button" class="bst-door" data-action="open" data-door="${d.id}">
            <span class="bst-door-mark">${d.mark}</span>
            <span class="bst-door-copy">
              <span class="bst-door-title">${d.title}</span>
              <span class="bst-door-blurb">${esc(d.blurb)}</span>
            </span>
            <span class="bst-door-chev">›</span>
          </button>`).join('')}
      </div>`;
  }

  _stageHubHTML() {
    const preview = buildWorldIndexPreviewHtml(this.storage, {
      esc,
      cellId: this._compassSelCell || '',
    });
    return `
      <h2 class="bst-pane-title">Stage</h2>
      <p class="bst-pane-sub">Map the house, dress areas, then open studio shelves for effects, trackers, and visuals.</p>
      ${this._boardHTML(STAGE_DOORS)}
      ${preview}`;
  }

  _paneHTML(door, st) {
    if (door === 'production') return this._productionHTML(st);
    if (door === 'interview') return this._interviewHTML(st);
    if (door === 'gallery') return this._peanutHTML(st);
    if (door === 'stage') return this._stageHubHTML();
    if (door === 'set') return this._setHTML(st);
    if (door === 'placement') return this._placementHTML(st);
    if (door === 'studio-effects') return this._studioEffectsHTML(st);
    if (door === 'studio-trackers') return this._studioTrackersHTML(st);
    if (door === 'studio-visuals') return this._studioVisualsHTML(st);
    if (door === 'settings') return this._settingsHTML(st);
    return this._boardHTML();
  }

  _statusLine() {
    const root = ensureShowtimeRoot();
    const off = !!root.masterOff;
    const disabled = Object.entries(root.enabledModules || {})
      .filter(([, on]) => on === false)
      .map(([id]) => MODULE_LABELS[id] || id);
    const bits = [
      off ? 'EXTENSION OFF' : 'LIVE',
      disabled.length ? `muted: ${disabled.join(', ')}` : 'all tabs on',
      `door: ${this._door || 'listings'}`,
    ];
    return bits.join(' · ');
  }

  // ── Production ─────────────────────────────────────────────────────────────

  _productionHTML(st) {
    const p = st.production;
    const src = p.sources || DEFAULT_SOURCES();
    const facets = src.tagFacets || {};
    const director = this._fullCast().find(c => c.priority === 'director');
    const exportMods = Object.entries(MODULE_LABELS).map(([id, label]) =>
      `<label class="bst-check"><input type="checkbox" data-export-mod="${esc(id)}" checked> ${esc(label)}</label>`).join('');
    const fold = (id, title, body) => {
      const open = this._prodFolds?.has(id);
      return `
      <details class="bst-section bst-fold" data-fold="${esc(id)}" ${open ? 'open' : ''}>
        <summary class="bst-section-h">${esc(title)}</summary>
        <div class="bst-fold-body">${body}</div>
      </details>`;
    };

    const directorBody = `
        <p class="bst-hint">Checks the floor against the Director cast card and the sections you allow. Trackers stay owned by their tabs — this only cues the room.</p>
        <div class="bst-row">
          <label><input type="checkbox" data-field="directorOn" ${p.directorOn ? 'checked' : ''}> Director on call</label>
          <label><input type="checkbox" data-field="queueComposer" ${p.queueComposer ? 'checked' : ''}> Queue Composer audit when an event fires</label>
        </div>
        <div class="bst-row">
          <label class="bst-field" style="margin:0"><span>Scan frequency</span>
            <select data-field="scanFrequency" ${p.directorOn ? '' : 'disabled'}>
              ${SCAN_FREQ.map(f =>
                `<option value="${f.id}" ${p.scanFrequency === f.id ? 'selected' : ''}>${esc(f.label)}</option>`).join('')}
            </select>
          </label>
          <label class="bst-field" style="margin:0" ${p.scanFrequency === 'every_n' ? '' : 'hidden'}>
            <span>Every N messages</span>
            <input type="number" min="1" max="40" data-field="scanEveryN" value="${esc(String(p.scanEveryN || 4))}" ${p.directorOn ? '' : 'disabled'}>
          </label>
          <span class="bst-k">${director ? `card: ${esc(director.name)} · dials live` : 'no Director cast card — add one in Cast'}</span>
        </div>
        <div class="bst-field"><span>Intrusiveness</span>
          <div class="bst-row" style="margin:0">
            ${INTRUDE.map(i => `
              <label class="bst-radio" title="${esc(i.tip)}">
                <input type="radio" name="bst-intrude" data-field="intrusiveness" value="${i.id}"
                  ${p.intrusiveness === i.id ? 'checked' : ''} ${p.directorOn && !p.intrudeRandom ? '' : 'disabled'}>
                ${esc(i.label)}
              </label>`).join('')}
            <label class="bst-radio" title="Each check rolls Derail, Twist, Advance, or Pressure at random">
              <input type="checkbox" data-field="intrudeRandom" ${p.intrudeRandom ? 'checked' : ''} ${p.directorOn ? '' : 'disabled'}>
              Random
            </label>
          </div>
          <span class="bst-k">${p.intrudeRandom
            ? 'Random — each check picks how hard the beat hits'
            : esc(INTRUDE.find(i => i.id === p.intrusiveness)?.tip || '')}</span>
        </div>
        <div class="bst-field"><span>Director may pull from</span>
          <div class="bst-checkgrid">
            <label class="bst-check"><input type="checkbox" data-src="tags" ${src.tags ? 'checked' : ''}> Limit by tag</label>
            <div class="bst-facet-row" ${src.tags ? '' : 'hidden'}>
              ${TAG_FACETS.map(f =>
                `<label class="bst-check tight"><input type="checkbox" data-facet="${f.id}" ${facets[f.id] !== false ? 'checked' : ''}> ${esc(f.label)}</label>`).join('')}
              <span class="bst-k">Location includes Script, Library, Composer scene keys, and Set place tags.</span>
            </div>
            <label class="bst-check"><input type="checkbox" data-src="stage" ${src.stage !== false ? 'checked' : ''}> Stage / Set — rooms, areas, location tags, sonar</label>
            <label class="bst-check"><input type="checkbox" data-src="inventory" ${src.inventory ? 'checked' : ''}> Inventory</label>
            <div class="bst-facet-row" ${src.inventory ? '' : 'hidden'}>
              <label class="bst-check tight"><input type="checkbox" data-src="inventoryOnPerson" ${src.inventoryOnPerson !== false ? 'checked' : ''}> On Person</label>
              <label class="bst-check tight"><input type="checkbox" data-src="inventoryTrunk" ${src.inventoryTrunk !== false ? 'checked' : ''}> Trunk</label>
            </div>
            <label class="bst-check"><input type="checkbox" data-src="script" ${src.script ? 'checked' : ''}> Script — past events, callbacks, timeline, memories / visions</label>
            <div class="bst-facet-row" ${src.script ? '' : 'hidden'}>
              <label class="bst-check tight"><input type="checkbox" data-src="scriptStampedLore" ${src.scriptStampedLore ? 'checked' : ''}> Pull stamped lorebook entries with Script cards</label>
              <span class="bst-k">When a Script card injects (chat) or is briefed (Director), also include World Info bodies from its ⌘ stamp.</span>
            </div>
            <label class="bst-check"><input type="checkbox" data-src="events" ${src.events !== false ? 'checked' : ''}> Events &amp; Holidays — composed Script event cards</label>
            <label class="bst-check"><input type="checkbox" data-src="library" ${src.library ? 'checked' : ''}> Library — keywords / glossary</label>
            <label class="bst-check"><input type="checkbox" data-src="reputation" ${src.reputation ? 'checked' : ''}> Reputation — established connections</label>
            <label class="bst-check"><input type="checkbox" data-src="motivation" ${src.motivation ? 'checked' : ''}> Motivation — secrets &amp; beats</label>
          </div>
        </div>
        <div class="bst-row">
          <button type="button" class="bst-btn gold" data-action="director-check" ${p.directorOn && !this._busy ? '' : 'disabled'}>${this._busy && this._door === 'production' ? 'Rolling…' : 'Run director check'}</button>
          <span class="bst-k">${p.lastCheckAt ? `last check ${new Date(p.lastCheckAt).toLocaleString()}` : 'never checked'}${p.scanFrequency === 'every_n' ? ` · ${p.msgSinceCheck || 0}/${p.scanEveryN || 4} msgs` : ''}</span>
        </div>
        ${(() => {
          const pending = normalizePendingEvent(p.pendingEvent);
          if (!pending) return '';
          return `<div class="bst-event-floor">
            <span>Event on the floor</span>
            <strong>${esc(clipText(pending.text, 120))}</strong>
            <button type="button" class="bst-btn gold" data-action="event-paper-open">Open</button>
          </div>`;
        })()}
        ${(() => {
          const usable = (p.eventLog || [])
            .map((e, i) => ({ e, i }))
            .filter(({ e }) => e.kind === 'event')
            .slice(-8)
            .reverse();
          if (!usable.length) {
            return `<p class="bst-hint">No events yet — flip the switch and run a check.</p>`;
          }
          return `<div class="bst-chip-row">
            ${usable.map(({ e, i }) => {
              const playable = !!(e.event || eventFromLogEntry(e) || e.uid);
              return `<button type="button" class="bst-chip on${playable ? '' : ' is-static'}"
                data-action="${playable ? 'event-log-open' : ''}" data-idx="${i}"
                title="${playable ? 'Open this beat' : ''}">${esc(e.text || e)}</button>`;
            }).join('')}
            <button type="button" class="bst-btn" data-action="event-log-clear" title="Clear the event log">Clear log</button>
          </div>`;
        })()}`;

    const databankBody = `
        <p class="bst-hint">A <strong>Reel</strong> is a portable copy of this production — pick which tabs travel with it, then import the same file into another chat. Live data sits in this chat’s metadata (not a separate folder).</p>
        <div class="bst-field"><span>Include tabs</span>
          <div class="bst-checkgrid">${exportMods}
            <label class="bst-check"><input type="checkbox" data-export-global checked> Global settings too</label>
          </div>
        </div>
        <div class="bst-field"><span>Also pack</span>
          <div class="bst-checkgrid">
            <label class="bst-check" title="Embed each cast member’s portrait image in the Reel"><input type="checkbox" data-reel-portraits> Cast portraits (images)</label>
            <label class="bst-check" title="Export linked SillyTavern character cards as PNG so the Reel can recreate them"><input type="checkbox" data-reel-cards> Character cards as PNG</label>
            <label class="bst-check" title="Remember which ST card/persona each cast member uses, so import can re-link to cards you already have"><input type="checkbox" data-reel-relink checked> Re-link to cards already in SillyTavern</label>
            <label class="bst-check" title="World Info books currently in play for this chat"><input type="checkbox" data-reel-lore> Lorebooks in play</label>
            <label class="bst-check" title="Every World Info book on this install — large"><input type="checkbox" data-reel-lore-all> All lorebooks</label>
          </div>
        </div>
        <div class="bst-row">
          <button type="button" class="bst-btn gold" data-action="export-selected">Export Reel</button>
          <button type="button" class="bst-btn" data-action="export-all">Export full Reel</button>
          <button type="button" class="bst-btn" data-action="export-tab">Export Backstage only</button>
        </div>
        <div class="bst-field"><span>Import a Reel</span>
          <p class="bst-hint" style="margin:0">Pick a previously exported <code>.json</code> Reel — full production, slice, or Backstage chat file. Optional: merge only checked modules instead of replacing everything.</p>
          <div class="bst-checkgrid">
            <label class="bst-check"><input type="checkbox" data-import-merge> Merge (keep unchecked modules)</label>
            ${Object.entries(MODULE_LABELS).map(([id, label]) =>
              `<label class="bst-check"><input type="checkbox" data-import-mod="${esc(id)}" checked> ${esc(label)}</label>`).join('')}
            <label class="bst-check"><input type="checkbox" data-import-global checked> Global settings</label>
            <label class="bst-check"><input type="checkbox" data-import-cards checked> Import character cards / portraits</label>
            <label class="bst-check"><input type="checkbox" data-import-lore checked> Import lorebooks</label>
          </div>
        </div>
        <div class="bst-row">
          <button type="button" class="bst-btn" data-action="import-all">Import Reel…</button>
        </div>
        <div class="bst-row">
          <select class="bst-select" data-role="wipe-target">
            <option value="">— Wipe target —</option>
            ${Object.entries(MODULE_LABELS).map(([id, label]) =>
              `<option value="${esc(id)}">${esc(label)} (this chat)</option>`).join('')}
            <option value="backstage-global">Backstage global settings</option>
          </select>
          <button type="button" class="bst-btn danger" data-action="wipe">Wipe</button>
        </div>
        <input type="file" accept="application/json,.json" data-role="import-file" hidden>`;

    return `
      <h2 class="bst-pane-title">Production</h2>
      <p class="bst-pane-sub">Director watches the floor. Reels pack the paperwork. Fold a section to keep the desk clear.</p>
      ${fold('director', 'Director events', directorBody)}
      ${fold('events', 'Events & Holidays', this._eventsHolidaysInner())}
      ${fold('databank', 'Reels', databankBody)}`;
  }

  _eventsHolidaysHTML() {
    // Kept for callers; Production now embeds the inner body in a fold.
    return this._eventsHolidaysInner();
  }

  _eventsHolidaysInner() {
    const events = this._listEventCards().slice(0, 12);
    const p = this._db().production || {};
    return `
        <p class="bst-hint">Director composes a durable Script card (timeline marker) from Library culture/place/event tags, Motivation beats, and Connections — then can cue it, pitch cast, or jump the floor to it.</p>
        <label class="bst-field"><span>Guidance for Compose</span>
          <textarea data-field="eventGuidance" placeholder="Optional notes for the Director — season, tone, who should be there, what this event is about…">${esc(p.eventGuidance || '')}</textarea>
        </label>
        <div class="bst-row">
          <button type="button" class="bst-btn gold" data-action="event-compose" ${this._busy ? 'disabled' : ''}>
            ${this._busy && this._door === 'production' ? 'Composing…' : 'Compose event'}
          </button>
          <span class="bst-k">writes a Script card · pins on timeline when a time key parses</span>
        </div>
        <div class="bst-row">
          <button type="button" class="bst-btn" data-action="clear-orphan-tags" title="Remove scene stamps, filing, and location tags that no longer point at a card, lorebook, or place">Clear orphan tags</button>
          <span class="bst-k">scene stamps with no Script card · filing on missing lore entries · unused location names</span>
        </div>
        <div class="bst-event-list">
          ${events.length ? events.map(ev => {
            const credits = (ev.credits || []).map(c => c.name).filter(Boolean).slice(0, 4).join(', ');
            const when = ev.timeKey || ev.keywordFacets?.datetime?.[0] || 'unscheduled';
            return `
              <article class="bst-event-card" data-uid="${esc(ev.uid)}">
                <div class="bst-event-head">
                  <strong>${esc(ev.title || 'Untitled event')}</strong>
                  <span class="bst-k">${esc(when)}${ev.pinned ? ' · pinned' : ''}${ev.timeLocked ? ' · locked' : ''}</span>
                </div>
                <p class="bst-event-sum">${esc(String(ev.summary || ev.content || '').slice(0, 220))}</p>
                ${credits ? `<div class="bst-k">Cast · ${esc(credits)}${(ev.credits || []).length > 4 ? '…' : ''}</div>` : ''}
                <div class="bst-row bst-event-actions">
                  <button type="button" class="bst-btn" data-action="event-cue" data-uid="${esc(ev.uid)}" title="Open as a Director event card">Cue now</button>
                  <button type="button" class="bst-btn" data-action="event-pitch" data-uid="${esc(ev.uid)}" ${this._busy ? 'disabled' : ''}>Pitch cast</button>
                  <button type="button" class="bst-btn" data-action="event-jump" data-uid="${esc(ev.uid)}">Jump / skip</button>
                  <button type="button" class="bst-btn" data-action="event-pin" data-uid="${esc(ev.uid)}">${ev.pinned ? 'Unpin' : 'Pin inject'}</button>
                </div>
              </article>`;
          }).join('') : `<div class="bst-empty">No composed events yet — run Compose event.</div>`}
        </div>`;
  }

  _scriptMod() {
    return window.Showtime?.modules?.get('script') || null;
  }

  _listEventCards() {
    try {
      const db = this.storage.getChat('script', { cards: [] });
      return (db.cards || [])
        .filter(c => c.kind === 'event' || c.sourceKind === 'event' || (c.tags || []).includes('showtime-event'))
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    } catch {
      return [];
    }
  }

  _eventComposeBrief() {
    const parts = [];
    parts.push(`DIRECTOR DIALS:\n${this._directorCardBlock()}`);
    try {
      const leaves = listVisibleLibraryLeaves(this.storage);
      const scored = leaves.map(l => {
        const tags = (l.tags || []).map(t => String(t.type || '').toLowerCase());
        let score = 0;
        if (tags.some(t => /event|era/.test(t))) score += 3;
        if (tags.some(t => /culture|faction/.test(t))) score += 2;
        if (tags.some(t => /place|location/.test(t))) score += 2;
        if (tags.some(t => /person|history|term/.test(t))) score += 1;
        if (/event|era|histor|festival|holiday/i.test(String(l.sectionTitle || ''))) score += 2;
        return { l, score };
      }).filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 16);
      parts.push(`LIBRARY (culture / place / event / era):\n${scored.map(({ l }) => {
        const tag = (l.tags || []).map(t => `${t.type}:${t.value || t}`).slice(0, 4).join(', ');
        return `- ${l.title}${tag ? ` 〔${tag}〕` : ''}: ${String(l.content || l.keys?.join?.(' ') || '').replace(/\s+/g, ' ').slice(0, 160)}`;
      }).join('\n') || '(none tagged)'}`);
    } catch {
      parts.push('LIBRARY: (unavailable)');
    }
    parts.push(`MOTIVATION:\n${this._motivationBrief()}`);
    parts.push(`REPUTATION / CONNECTIONS:\n${this._reputationBrief()}`);
    try {
      const script = this.storage.getChat('script', { settings: {} });
      const cal = script.settings?.calendar;
      if (cal) {
        const seasons = (cal.seasons || []).map(s => s.label).join(', ');
        const months = (cal.monthNames || []).slice(0, 6).join(', ');
        parts.push(`WORLD CALENDAR: ${cal.monthsPerYear || 12} months · ${cal.hoursPerDay || 24}h days · seasons [${seasons || '—'}] · months [${months || '—'}]${cal.yearSuffix ? ` · suffix ${cal.yearSuffix}` : ''}`);
      }
    } catch { /* ignore */ }
    const recent = this._chatSlice().slice(-8)
      .map(m => `${m.name}: ${m.text.slice(0, 160)}`).join('\n');
    parts.push(`RECENT FLOOR:\n${recent || '(quiet)'}`);
    return parts.join('\n\n');
  }

  _clearOrphanTags() {
    if (!confirm('Clear tags that no longer link to a Script card, lorebook entry, or book? This cannot be undone.')) {
      return;
    }
    const scriptDb = this.storage.getChat('script', { cards: [] });
    const liveSceneCodes = (scriptDb.cards || [])
      .filter(c => c && c.kind !== 'folder')
      .map(c => {
        try { return sceneCode(c, scriptDb); } catch { return ''; }
      })
      .filter(Boolean);

    const libMod = window.Showtime?.modules?.get('library');
    const books = (libMod?._books?.length ? libMod._books : null) || getCachedLibraryBooks();
    const booksLoaded = !!(books && books.length);
    const leaves = listLibraryLeaves(this.storage, books);
    const liveLeafKeys = new Set(leaves.map(l => l.key));
    const knownBooks = new Set();
    for (const b of books || []) {
      if (b?.name) knownBooks.add(b.name);
    }
    for (const l of leaves) {
      if (l.book) knownBooks.add(l.book);
    }
    try {
      const detected = libMod?._detectBooks?.();
      if (detected) for (const name of detected.keys()) knownBooks.add(name);
    } catch { /* ignore */ }

    const libHits = clearOrphanTags(this.storage, {
      liveSceneCodes,
      liveLeafKeys: booksLoaded ? liveLeafKeys : null,
      knownBooks: booksLoaded && knownBooks.size ? knownBooks : null,
    });

    let locN = 0;
    try {
      const st = this._db();
      const compass = ensureCompass(st);
      for (const place of Object.values(compass.rooms || {})) {
        const before = (place.locationTags || []).length;
        place.locationTags = (place.locationTags || []).map(t => String(t || '').trim()).filter(Boolean);
        if (place.locationTags.length !== before) locN++;
      }
      for (const bg of st.visuals?.backgrounds || []) {
        const before = (bg.locationTags || []).length;
        bg.locationTags = (bg.locationTags || []).map(t => String(t || '').trim()).filter(Boolean);
        if (bg.locationTags.length !== before) locN++;
      }
      this.saveState();
    } catch { /* ignore */ }

    const bits = [];
    if (libHits.scene) bits.push(`${libHits.scene} scene stamp${libHits.scene === 1 ? '' : 's'}`);
    if (libHits.filing) bits.push(`${libHits.filing} leftover filing ${libHits.filing === 1 ? 'row' : 'rows'}`);
    if (libHits.books) bits.push(`${libHits.books} missing-book tag${libHits.books === 1 ? '' : 's'}`);
    if (libHits.empty) bits.push(`${libHits.empty} empty tag${libHits.empty === 1 ? '' : 's'}`);
    if (locN) bits.push(`${locN} blank location field${locN === 1 ? '' : 's'}`);
    this.bus?.emit('showtime.stateChanged');
    if (this._door === 'production' && this.container) this.render(this.container);
    alert(bits.length
      ? `Cleared orphan tags — ${bits.join(', ')}.`
      : 'No orphan tags found.');
  }

  async _composeHolidayEvent() {
    if (this._busy) return;
    const script = this._scriptMod();
    if (!script?._addCard) {
      alert('Script module is not loaded — open the Script tab once, then retry.');
      return;
    }
    this._busy = true;
    this.render(this.container);
    try {
      const brief = this._eventComposeBrief();
      const guidance = String(this._db().production?.eventGuidance || '').trim();
      const prompt = `You are the Director composing ONE holiday, festival, ceremony, or world event for this play.

${brief}
${guidance ? `\nDIRECTOR GUIDANCE (honor this):\n${guidance.slice(0, 1200)}\n` : ''}
GOALS:
- Ground the event in Library culture / place / era tags when possible.
- Suggest cast who "should" be there: mix plot-relevant people with side-goal people (Motivation beats, Connections, houses) so characters have aims beside the main plot.
- Give a calendar-aware "when" string the timeline can parse (Day N, Season, Month Year, or Year + suffix if the calendar uses one).

Return ONLY JSON:
{"title":"short name","when":"time key","summary":"2-4 sentences of what happens and why it matters","tags":["keyword", "..."],"cast":[{"name":"Cast or NPC name","role":"lead|major|supporting|minor|foil","why":"one line"}],"sideGoals":["optional side aims for attendees"]}

JSON:`;
      const raw = await this._quiet(prompt, { quietName: 'Director', profileSlot: 'event' });
      const parsed = parseJsonObject(raw);
      if (!parsed?.title || !parsed?.summary) {
        throw new Error('Director returned no usable event. Try again.');
      }
      const title = String(parsed.title).trim().slice(0, 120);
      const when = String(parsed.when || '').trim().slice(0, 80);
      const summary = String(parsed.summary).trim().slice(0, 1200);
      const tags = Array.isArray(parsed.tags)
        ? parsed.tags.map(t => String(t).trim().slice(0, 40)).filter(Boolean).slice(0, 10)
        : [];
      const castMembers = getCastMembers(this.storage);
      const credits = [];
      for (const row of (Array.isArray(parsed.cast) ? parsed.cast : []).slice(0, 10)) {
        const name = String(row?.name || '').trim();
        if (!name) continue;
        const m = castMembers.find(c =>
          c.priority !== 'director'
          && ((c.name || '').toLowerCase() === name.toLowerCase()
            || (c.aliases || []).some(a => String(a).toLowerCase() === name.toLowerCase())));
        if (!m && /director/i.test(name)) continue;
        if (m?.priority === 'director') continue;
        credits.push({
          characterId: m?.id || null,
          name: m?.name || name,
          role: m?.priority || String(row.role || 'supporting').toLowerCase(),
          why: String(row.why || '').slice(0, 160),
        });
      }
      const sideGoals = Array.isArray(parsed.sideGoals)
        ? parsed.sideGoals.map(s => String(s).trim()).filter(Boolean).slice(0, 6)
        : [];
      const body = sideGoals.length
        ? `${summary}\n\nSide goals:\n${sideGoals.map(s => `• ${s}`).join('\n')}`
        : summary;

      const card = script._addCard({
        title,
        summary: body,
        content: body,
        timeKey: when,
        timeLocked: !!when,
        timeManual: !!when,
        pinned: false,
        kind: 'event',
        sourceKind: 'event',
        eventScale: 'world',
        eventRecurring: false,
        sourceId: `event-${Date.now()}`,
        tags: ['showtime-event', ...tags.filter(t => t !== 'showtime-event')],
        keywordFacets: {
          location: tags.filter(t => /place|town|city|hall|temple|square/i.test(t)).slice(0, 4),
          objects: [],
          characters: credits.map(c => c.name),
          datetime: when ? [when] : [],
        },
        credits: credits.map(({ characterId, name, role }) => ({ characterId, name, role })),
        notes: credits.filter(c => c.why).map(c => `${c.name}: ${c.why}`).join('\n'),
      });

      const st = this._db();
      (st.production.eventLog ??= []).push({
        kind: 'event',
        text: `HOLIDAY — ${title}${when ? ` @ ${when}` : ''}`,
        at: Date.now(),
        uid: card.uid,
        eventUid: card.uid,
      });
      if ((st.production.eventLog || []).length > 40) st.production.eventLog = st.production.eventLog.slice(-40);
      this.saveState();
      this.bus?.emit('showtime.stateChanged');
      this.bus?.emit('script.updated', { reason: 'event-compose', uid: card.uid });
    } catch (err) {
      console.error('[Backstage event compose]', err);
      alert(`Compose failed: ${err.message || err}`);
    } finally {
      this._busy = false;
      if (this._door === 'production' && this.container) this.render(this.container);
    }
  }

  async _pitchEventCast(uid) {
    if (!uid || this._busy) return;
    const script = this._scriptMod();
    const card = script?._getCard?.(uid);
    if (!card) { alert('Event card not found.'); return; }
    this._busy = true;
    this.render(this.container);
    try {
      const brief = this._eventComposeBrief();
      const prompt = `You are casting attendees for this production event.

EVENT:
Title: ${card.title}
When: ${card.timeKey || '—'}
Summary: ${String(card.summary || card.content || '').slice(0, 800)}

${brief}

Pitch 4–8 people who should be there. Prefer existing cast names. Mix plot stakes with side goals (connections, secrets, houses, unlocked beats).

Return ONLY JSON:
{"cast":[{"name":"...","role":"lead|major|supporting|minor|foil","why":"one line side-or-plot aim"}]}

JSON:`;
      const raw = await this._quiet(prompt, { quietName: 'Director', profileSlot: 'event' });
      const parsed = parseJsonObject(raw);
      const castMembers = getCastMembers(this.storage);
      const credits = [];
      for (const row of (Array.isArray(parsed?.cast) ? parsed.cast : []).slice(0, 10)) {
        const name = String(row?.name || '').trim();
        if (!name) continue;
        const m = castMembers.find(c =>
          c.priority !== 'director'
          && ((c.name || '').toLowerCase() === name.toLowerCase()
            || (c.aliases || []).some(a => String(a).toLowerCase() === name.toLowerCase())));
        if (m?.priority === 'director') continue;
        credits.push({
          characterId: m?.id || null,
          name: m?.name || name,
          role: m?.priority || String(row.role || 'supporting').toLowerCase(),
        });
        if (row.why) {
          card.notes = [card.notes, `${m?.name || name}: ${String(row.why).slice(0, 160)}`]
            .filter(Boolean).join('\n').slice(0, 2000);
        }
      }
      if (!credits.length) throw new Error('No cast pitched.');
      script._updateCard(uid, {
        credits,
        notes: card.notes,
        keywordFacets: {
          ...(card.keywordFacets || {}),
          characters: credits.map(c => c.name),
        },
      });
      const st = this._db();
      (st.production.eventLog ??= []).push({
        kind: 'check',
        text: `Cast pitched for “${card.title}” (${credits.length})`,
        at: Date.now(),
      });
      this.saveState();
      this.bus?.emit('showtime.stateChanged');
    } catch (err) {
      console.error('[Backstage event pitch]', err);
      alert(`Pitch failed: ${err.message || err}`);
    } finally {
      this._busy = false;
      if (this._door === 'production' && this.container) this.render(this.container);
    }
  }

  _cueEventNow(uid) {
    const script = this._scriptMod();
    const card = script?._getCard?.(uid);
    if (!card) { alert('Event card not found.'); return; }
    const st = this._db();
    const credits = (card.credits || []).map(c => c.name).filter(Boolean).slice(0, 6).join(', ');
    const text = [
      `Event cue — ${card.title}${card.timeKey ? ` (${card.timeKey})` : ''}.`,
      String(card.summary || card.content || '').replace(/\s+/g, ' ').slice(0, 420),
      credits ? `Expected: ${credits}.` : '',
    ].filter(Boolean).join(' ');
    (st.production.eventLog ??= []).push({
      kind: 'event',
      text: `CUED — ${card.title}`,
      at: Date.now(),
      event: {
        text: text.slice(0, 600),
        tags: (card.tags || []).filter(t => t !== 'showtime-event').slice(0, 8),
        at: Date.now(),
        eventUid: uid,
        jumpMode: 'Cue',
        castId: this._castIdFromEventCard(card),
      },
      uid,
    });
    if (st.production.queueComposer) {
      this.bus?.emit('composer.queueAudit', { reason: 'director-event', event: text });
    }
    this._presentDirectorEvent({
      text: text.slice(0, 600),
      tags: (card.tags || []).filter(t => t !== 'showtime-event').slice(0, 8),
      at: Date.now(),
      eventUid: uid,
      jumpMode: 'Cue',
      castId: this._castIdFromEventCard(card),
    });
  }

  _toggleEventPin(uid) {
    const script = this._scriptMod();
    const card = script?._getCard?.(uid);
    if (!card) return;
    script._togglePinned(card);
    this.render(this.container);
  }

  _openEventJumpDialog(uid) {
    const script = this._scriptMod();
    const card = script?._getCard?.(uid);
    if (!card) { alert('Event card not found.'); return; }
    const overlay = document.createElement('div');
    overlay.className = 'bst-dialog-overlay';
    overlay.innerHTML = `
      <div class="bst-dialog" role="dialog" aria-label="Jump to event">
        <div class="bst-dialog-h">Jump / skip → ${esc(card.title || 'Event')}</div>
        <p class="bst-hint">Director writes a bridge, then opens it as an event card to Play, file, or dismiss. Pick how hard to cut.</p>
        <div class="bst-field"><span>Mode</span>
          <label class="bst-radio"><input type="radio" name="bst-jump-mode" value="timeskip" checked> Timeskip — generate a time jump toward this event</label>
          <label class="bst-radio"><input type="radio" name="bst-jump-mode" value="transition"> Transition — soft plot/scene handoff</label>
          <label class="bst-radio"><input type="radio" name="bst-jump-mode" value="thread"> Thread — give credited cast a through-line to follow</label>
        </div>
        <div class="bst-checkgrid">
          <label class="bst-check"><input type="checkbox" data-j="context" checked> Context-aware (use recent chat)</label>
          <label class="bst-check"><input type="checkbox" data-j="library" checked> Pull Library / event tags</label>
          <label class="bst-check"><input type="checkbox" data-j="cast" checked> Include credited cast</label>
          <label class="bst-check"><input type="checkbox" data-j="pin"> Pin event for Script injection</label>
          <label class="bst-check"><input type="checkbox" data-j="cue" checked> Present as Director event card</label>
          <label class="bst-check"><input type="checkbox" data-j="composer"> Queue Composer audit</label>
        </div>
        <div class="bst-row" style="margin-top:12px;justify-content:flex-end;gap:8px">
          <button type="button" class="bst-btn" data-a="cancel">Cancel</button>
          <button type="button" class="bst-btn gold" data-a="go">Generate jump</button>
        </div>
      </div>`;
    const close = () => overlay.remove();
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    overlay.querySelector('[data-a="cancel"]').addEventListener('click', close);
    overlay.querySelector('[data-a="go"]').addEventListener('click', () => {
      const mode = overlay.querySelector('input[name="bst-jump-mode"]:checked')?.value || 'timeskip';
      const opts = {
        context: !!overlay.querySelector('[data-j="context"]')?.checked,
        library: !!overlay.querySelector('[data-j="library"]')?.checked,
        cast: !!overlay.querySelector('[data-j="cast"]')?.checked,
        pin: !!overlay.querySelector('[data-j="pin"]')?.checked,
        cue: !!overlay.querySelector('[data-j="cue"]')?.checked,
        composer: !!overlay.querySelector('[data-j="composer"]')?.checked,
      };
      close();
      void this._runEventJump(uid, mode, opts);
    });
    document.body.appendChild(overlay);
  }

  async _runEventJump(uid, mode, opts = {}) {
    if (this._busy) return;
    const script = this._scriptMod();
    const card = script?._getCard?.(uid);
    if (!card) return;
    this._busy = true;
    this.render(this.container);
    try {
      const modeTip = {
        timeskip: 'Write a concise timeskip / elapsed-time bridge that lands the cast at or just before this event.',
        transition: 'Write a soft plot transition that steers the current scene toward this event without hard-cutting time.',
        thread: 'Write a short through-line the credited cast can follow toward this event (goals, invitations, rumors).',
      }[mode] || 'Bridge to the event.';

      const bits = [
        `EVENT: ${card.title}`,
        `WHEN: ${card.timeKey || 'unscheduled'}`,
        `SUMMARY: ${String(card.summary || card.content || '').slice(0, 700)}`,
      ];
      if (opts.cast && card.credits?.length) {
        bits.push(`CREDITED CAST: ${card.credits.map(c => `${c.name} (${c.role})`).join('; ')}`);
      }
      if (opts.library) {
        bits.push(`LIBRARY SNAPSHOT:\n${this._libraryBrief()}`);
      }
      if (opts.context) {
        const recent = this._chatSlice().slice(-10)
          .map(m => `${m.name}: ${m.text.slice(0, 200)}`).join('\n');
        bits.push(`RECENT CHAT:\n${recent || '(none)'}`);
      }
      bits.push(`DIRECTOR DIALS:\n${this._directorCardBlock()}`);

      const prompt = `You are the Director. ${modeTip}

${bits.join('\n\n')}

RULES:
- Output 2–5 sentences of in-world bridge text only (no JSON, no OOC).
${this._directorVoiceRules()}
- Keep it playable as the next beat.

BRIDGE:`;
      let bridge = await this._quiet(prompt, { quietName: 'Director', profileSlot: 'event' });
      bridge = String(bridge || '').trim().slice(0, 900);
      if (!bridge) throw new Error('Empty jump text.');

      if (opts.pin && !card.pinned) script._togglePinned(card);

      const st = this._db();
      (st.production.eventLog ??= []).push({
        kind: 'event',
        text: `JUMP:${mode} — ${card.title}`,
        at: Date.now(),
        event: opts.cue !== false ? {
          text: `[${mode}] ${bridge}`.slice(0, 600),
          tags: [mode, ...(card.tags || [])].filter(Boolean).slice(0, 8),
          at: Date.now(),
          eventUid: uid,
          jumpMode: mode,
          castId: this._castIdFromEventCard(card),
        } : null,
        uid,
      });
      if (opts.composer || st.production.queueComposer) {
        this.bus?.emit('composer.queueAudit', { reason: 'event-jump', event: bridge, mode });
      }
      if (opts.cue !== false) {
        this._presentDirectorEvent({
          text: `[${mode}] ${bridge}`.slice(0, 600),
          tags: [mode, ...(card.tags || [])].filter(Boolean).slice(0, 8),
          at: Date.now(),
          eventUid: uid,
          jumpMode: mode,
          castId: this._castIdFromEventCard(card),
        });
      } else {
        this.saveState();
        this.bus?.emit('showtime.stateChanged');
      }
    } catch (err) {
      console.error('[Backstage event jump]', err);
      alert(`Jump failed: ${err.message || err}`);
    } finally {
      this._busy = false;
      if (this._door === 'production' && this.container) this.render(this.container);
    }
  }

  _castIdFromEventCard(card) {
    for (const credit of card?.credits || []) {
      const rec = matchCast(this.storage, credit.characterId || credit.name);
      if (rec) return rec.id;
    }
    return '';
  }

  _eventPaperRoot() {
    return document.getElementById('bst-event-paper-root');
  }

  _ensureEventPaper() {
    let root = this._eventPaperRoot();
    if (root) return root;
    root = document.createElement('div');
    root.id = 'bst-event-paper-root';
    root.className = 'bst-event-backdrop';
    root.hidden = true;
    root.setAttribute('aria-hidden', 'true');
    root.innerHTML = `<div class="bst-event-paper" role="dialog" aria-label="Director event"></div>`;
    root.addEventListener('click', (e) => {
      if (e.target === root) {
        this._hideEventPaper();
        return;
      }
      const act = e.target.closest('[data-action]');
      if (!act || !root.contains(act)) return;
      const action = act.dataset.action;
      if (action === 'event-paper-dismiss') this._dismissDirectorEvent();
      else if (action === 'event-paper-hook') this._fileDirectorEventHook();
      else if (action === 'event-paper-play') this._playDirectorEvent();
    });
    root.addEventListener('change', (e) => {
      if (e.target?.dataset?.role !== 'event-cast') return;
      this._setEventCast(e.target.value);
      const play = root.querySelector('[data-action="event-paper-play"]');
      if (play) play.disabled = !e.target.value;
    });
    document.body.appendChild(root);
    return root;
  }

  _renderEventPaper() {
    const ev = normalizePendingEvent(this._db().production?.pendingEvent);
    const root = this._ensureEventPaper();
    const paper = root.querySelector('.bst-event-paper');
    if (!ev) {
      this._hideEventPaper();
      if (paper) paper.innerHTML = '';
      return;
    }
    if (paper) paper.innerHTML = eventPaperInner(this.storage, ev);
    root.hidden = false;
    root.setAttribute('aria-hidden', 'false');
  }

  _hideEventPaper() {
    const root = this._eventPaperRoot();
    if (!root) return;
    root.hidden = true;
    root.setAttribute('aria-hidden', 'true');
  }

  _presentDirectorEvent(raw, { notice = true } = {}) {
    const st = this._db();
    const next = normalizePendingEvent(raw);
    st.production.pendingEvent = next;
    this.saveState();
    this.bus?.emit('showtime.stateChanged');
    if (notice && next) {
      this.bus?.emit('showtime.notice', {
        kind: 'director',
        items: [{ text: clipText(next.text, 80), mark: '!' }],
      });
    }
    this._renderEventPaper();
    if (this._door === 'production' && this.container) this.render(this.container);
  }

  _setEventCast(castId) {
    const st = this._db();
    const ev = normalizePendingEvent(st.production?.pendingEvent);
    if (!ev) return;
    ev.castId = matchCast(this.storage, castId)?.id || '';
    st.production.pendingEvent = ev;
    this.saveState();
  }

  _dismissDirectorEvent() {
    const st = this._db();
    if (st.production) st.production.pendingEvent = null;
    this.saveState();
    this.bus?.emit('showtime.stateChanged');
    this._hideEventPaper();
    if (this._door === 'production' && this.container) this.render(this.container);
  }

  _openEventFromLog(idx) {
    const entry = (this._db().production?.eventLog || [])[idx];
    if (!entry) return;
    const ev = eventFromLogEntry(entry);
    if (ev) {
      this._presentDirectorEvent(ev, { notice: false });
      return;
    }
    const uid = String(entry.uid || entry.eventUid || '').trim();
    if (uid) return this._cueEventNow(uid);
  }

  _clearEventLog() {
    const st = this._db();
    st.production.eventLog = [];
    this.saveState();
    this.bus?.emit('showtime.stateChanged');
    if (this._door === 'production' && this.container) this.render(this.container);
  }

  _fileDirectorEventHook() {
    const st = this._db();
    const ev = normalizePendingEvent(st.production?.pendingEvent);
    if (!ev) return;
    const sel = this._eventPaperRoot()?.querySelector('[data-role="event-cast"]')?.value;
    const rec = matchCast(this.storage, sel || ev.castId);
    const result = createHookFromEvent(this.storage, {
      name: firstHookTitle(ev.text),
      description: ev.text,
      assignedTo: rec?.id || ev.castId || '',
    });
    if (!result.hooked) {
      alert(result.reason === 'no-director'
        ? 'Add a Director cast card first.'
        : 'Could not file a plot hook.');
      return;
    }
    (st.production.eventLog ??= []).push({
      kind: 'event',
      text: `HOOK — ${result.hook.name}`,
      at: Date.now(),
      event: ev,
    });
    this.bus?.emit('cast.updated');
    this.bus?.emit('motivation.updated');
    this._dismissDirectorEvent();
  }

  _playDirectorEvent() {
    const st = this._db();
    const ev = normalizePendingEvent(st.production?.pendingEvent);
    if (!ev) return;
    const sel = this._eventPaperRoot()?.querySelector('[data-role="event-cast"]')?.value;
    const rec = matchCast(this.storage, sel || ev.castId);
    if (!rec) {
      alert('Pick a cast member to play this event.');
      return;
    }
    const text = ev.text;
    this._dismissDirectorEvent();
    this.bus?.emit('cast.playDirectorEvent', { castId: rec.id, text });
  }

  // ── Interview ──────────────────────────────────────────────────────────────

  _interviewHTML(st) {
    const iv = st.interview;
    if (!iv.active) return this._interviewSetupHTML(st);
    return this._interviewDeskHTML(st);
  }

  _interviewerPickValue(iv) {
    const anon = iv.interviewer === 'anonymous';
    if (anon) return 'user';
    if (iv.interviewer === 'cast' && iv.interviewerId) return `cast:${iv.interviewerId}`;
    if (iv.interviewer === 'user') return 'user';
    const star = getStarMember(this.storage);
    return star ? `cast:${star.id}` : 'user';
  }

  _interviewSetupHTML(st) {
    const cast = getCastMembers(this.storage);
    const subjects = cast.filter(c => c.priority !== 'star' && c.priority !== 'director');
    const interviewers = cast.filter(c => c.priority !== 'director');
    const iv = st.interview;
    const subjectId = iv.subjectId || subjects[0]?.id || '';
    const anon = iv.interviewer === 'anonymous';
    const interviewerValue = this._interviewerPickValue(iv);
    const interviewerOpts = [
      `<option value="user" ${interviewerValue === 'user' ? 'selected' : ''}>{{user}}</option>`,
      ...interviewers.map(c =>
        `<option value="cast:${esc(c.id)}" ${interviewerValue === `cast:${c.id}` ? 'selected' : ''}>${esc(c.name)}${c.priority === 'star' ? ' (Star)' : ''}</option>`),
    ].join('');
    const archives = subjectId ? this._listSubjectInterviews(subjectId) : [];
    return `
      <h2 class="bst-pane-title">Interview</h2>
      <p class="bst-pane-sub">Lock in who sits across the desk. Each session focuses on one character; transcripts file under their Motivation / Connections dossier.</p>

      <section class="bst-section bst-iv-setup">
        <div class="bst-row">
          <label class="bst-field" style="flex:1;margin:0">
            <span>Subject</span>
            <select data-field="subjectId">
              ${subjects.length
                ? subjects.map(c => `<option value="${esc(c.id)}" ${c.id === subjectId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')
                : '<option value="">— No cast cards —</option>'}
            </select>
          </label>
          ${anon ? '' : `
          <label class="bst-field" style="flex:1;margin:0">
            <span>Interviewer</span>
            <select data-field="interviewerPick">
              ${interviewerOpts}
            </select>
          </label>`}
          <button type="button" class="bst-btn${anon ? ' gold' : ''}" data-action="iv-anon" title="Faceless, nondescript figure — no reputation">
            ${anon ? 'Anonymous ✓' : 'Anonymous'}
          </button>
        </div>
        <p class="bst-hint">${anon
          ? 'Interviewer is anonymous — subject hears a faceless figure with no established reputation. Answers should be spoken opinion only, never briefing text.'
          : 'Interviewer identity + Connections readings shape how the subject answers — they react as if speaking with that person.'}</p>
        <div class="bst-row" style="margin-top:10px">
          <button type="button" class="bst-btn gold" data-action="interview-begin" ${subjects.length ? '' : 'disabled'}>Begin interview</button>
        </div>
      </section>

      ${archives.length ? `
      <section class="bst-section">
        <div class="bst-section-k">Filed with this subject</div>
        <ul class="bst-iv-archive">
          ${archives.slice(0, 8).map(s => `
            <li>
              <span class="bst-iv-archive-when">${esc(this._fmtInterviewWhen(s.at || s.startedAt))}</span>
              <span class="bst-iv-archive-meta">${esc(s.interviewer || 'Interviewer')} · ${(s.turns || []).length} turn${(s.turns || []).length === 1 ? '' : 's'}</span>
            </li>`).join('')}
        </ul>
        <p class="bst-hint">Full transcripts live on Motivation → Interviews (and on their Connections card).</p>
      </section>` : ''}`;
  }

  _interviewDeskHTML(st) {
    const iv = st.interview;
    const subject = this._interviewSubject();
    const interviewer = this._interviewerInfo();
    const turns = iv.turns || [];
    const flipped = iv.flippedNote || '';
    return `
      <h2 class="bst-pane-title">Interview</h2>
      <p class="bst-pane-sub">Sitting with <strong>${esc(subject?.name || '—')}</strong>. Settings are locked for this session.</p>

      <section class="bst-section">
        <div class="bst-row bst-iv-locked">
          <div class="bst-iv-lockchip">
            <span class="bst-iv-lockk">Subject</span>
            <span class="bst-iv-lockv">${esc(subject?.name || '—')}</span>
          </div>
          <div class="bst-iv-lockchip">
            <span class="bst-iv-lockk">Interviewer</span>
            <span class="bst-iv-lockv">${esc(interviewer.name)}${interviewer.anonymous ? ' (anon)' : ''}</span>
          </div>
          <button type="button" class="bst-btn" data-action="interview-clear" title="Wipe the live desk only">Clear desk</button>
          <button type="button" class="bst-btn" data-action="interview-discard" title="Leave without filing a transcript">End without filing</button>
          <button type="button" class="bst-btn danger" data-action="interview-end" title="File transcript to the subject, then leave">End &amp; file</button>
        </div>
        <p class="bst-hint">Cast replies omit their name in the transcript — the whole desk is already theirs. Ending files the session under Motivation → Interviews.</p>
        <div class="bst-row" style="margin-top:8px">
          <label class="bst-field" style="flex:1;margin:0">
            <span>Interview model</span>
            <select data-g="profile-interview">${this._profileOpts(this._g().profiles.interview)}</select>
          </label>
        </div>
      </section>

      <div class="bst-stage bst-stage--interview">
        <div class="bst-transcript" data-role="iv-log">
          ${turns.length
            ? turns.map(t => {
              const sys = t.name === 'Connections';
              const showWho = t.who === 'user' || sys;
              const cls = sys ? 'user bst-bubble--sys' : (t.who === 'user' ? 'user' : 'cast');
              return `
              <div class="bst-bubble ${cls}">
                ${showWho ? `<div class="bst-bubble-who">${esc(t.name || t.who)}</div>` : ''}
                <div class="bst-bubble-text">${esc(t.text)}</div>
              </div>`;
            }).join('')
            : `<div class="bst-empty">Flip a notecard or type a free question.</div>`}
        </div>

        ${iv.retry?.question ? `
        <div class="bst-iv-retry">
          <span>Technical difficulties! Repeat the question?</span>
          <button type="button" class="bst-btn gold" data-action="iv-retry" ${this._busy ? 'disabled' : ''}>Repeat</button>
          <button type="button" class="bst-btn" data-action="iv-retry-dismiss">Dismiss</button>
        </div>` : ''}

        <div class="bst-ask-label">Ask about…</div>
        ${this._interviewAlbumHTML(iv, flipped, subject)}

        <div class="bst-row">
          <input class="bst-input" style="flex:1" data-role="iv-line" placeholder="Or type a free question…" ${subject && !this._busy ? '' : 'disabled'}>
          <button type="button" class="bst-btn gold" data-action="iv-send" ${subject && !this._busy ? '' : 'disabled'}>${this._busy ? '…' : 'Ask'}</button>
        </div>
        <p class="bst-hint">Live desk only — Connections may still pick up readings/rumors from Cast asks. Full transcript files when you End.</p>
      </div>`;
  }

  _ivNoteIdx(iv) {
    const n = NOTECARDS.length;
    let i = Number(iv?.noteIdx);
    if (!Number.isInteger(i) || i < 0 || i >= n) {
      const fi = NOTECARDS.findIndex(c => c.id === iv?.flippedNote);
      i = fi >= 0 ? fi : 0;
    }
    return i;
  }

  _interviewAlbumHTML(iv, flipped, subject) {
    const n = NOTECARDS.length;
    const idx = this._ivNoteIdx(iv);
    const card = NOTECARDS[idx];
    const openId = flipped === card.id || !flipped ? card.id : '';
    return `
      <div class="bst-iv-album">
        <div class="bst-iv-album-stage">
          ${this._noteCardHTML(card, openId, subject, iv)}
        </div>
        <div class="bst-iv-album-bar">
          <button type="button" class="bst-btn bst-iv-album-nav" data-action="iv-album-step" data-dir="-1" title="Previous card">‹ Prev</button>
          <span class="bst-iv-album-mark">${esc(card.label)} · ${idx + 1}/${n}</span>
          <button type="button" class="bst-btn" data-action="iv-album-shuffle" title="Cycle Props → Fashion → Role → Cast">Shuffle</button>
          <button type="button" class="bst-btn bst-iv-album-nav" data-action="iv-album-step" data-dir="1" title="Next card">Next ›</button>
        </div>
      </div>`;
  }

  _fmtInterviewWhen(ms) {
    try {
      return new Date(ms || Date.now()).toLocaleString(undefined, {
        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
      });
    } catch {
      return '—';
    }
  }

  _listSubjectInterviews(subjectId) {
    if (!subjectId) return [];
    try {
      const mot = this.storage.getChat('motivation', { perChar: {} });
      return Array.isArray(mot?.perChar?.[subjectId]?.interviews)
        ? mot.perChar[subjectId].interviews
        : [];
    } catch {
      return [];
    }
  }

  _archiveInterviewSession() {
    const st = this._db();
    const subject = this._interviewSubject();
    const turns = st.interview.turns || [];
    if (!subject || !turns.length) return null;

    const interviewer = this._interviewerInfo();
    const mode = st.interview.interviewer || '';
    let interviewerId = st.interview.interviewerId || '';
    if (!interviewerId && mode !== 'user' && mode !== 'anonymous') {
      interviewerId = getStarMember(this.storage)?.id || '';
    }
    const session = {
      id: uid(),
      at: Date.now(),
      startedAt: st.interview.startedAt || Date.now(),
      subjectId: subject.id,
      subjectName: subject.name || '',
      interviewer: interviewer.name,
      interviewerMode: mode,
      interviewerId,
      turns: turns.map(t => ({
        who: t.who,
        name: t.who === 'cast' ? '' : (t.name || ''),
        text: String(t.text || ''),
        at: t.at || Date.now(),
      })),
    };

    const motMod = window.Showtime?.modules?.get('motivation');
    if (motMod?._charState) {
      const cs = motMod._charState(subject.id);
      cs.interviews ??= [];
      cs.interviews.unshift(session);
      if (cs.interviews.length > 40) cs.interviews = cs.interviews.slice(0, 40);
      motMod.saveState();
    } else {
      const mot = this.storage.getChat('motivation', { perChar: {} });
      mot.perChar ??= {};
      const row = mot.perChar[subject.id] ??= {
        secrets: [], achievements: [], steps: [], interviews: [], auditAt: 0,
      };
      row.interviews ??= [];
      row.interviews.unshift(session);
      if (row.interviews.length > 40) row.interviews = row.interviews.slice(0, 40);
      this.storage.setChat('motivation', mot);
      this.storage.saveChat();
    }
    this.bus?.emit('motivation.updated', { characterId: subject.id });
    this.bus?.emit('showtime.stateChanged');
    return session;
  }

  _endInterview({ save = true } = {}) {
    const st = this._db();
    if (save) this._archiveInterviewSession();
    st.interview.active = false;
    st.interview.turns = [];
    st.interview.flippedNote = '';
    st.interview.startedAt = 0;
    st.interview.retry = null;
    this.saveState();
    return void this.render(this.container);
  }

  _noteCardHTML(card, flipped, subject, iv) {
    const open = flipped === card.id;
    const pick = (iv.notePick || {})[card.id] || {};
    const targets = subject ? this._noteTargets(card.id, subject.id) : [];
    const qIdx = Math.min(Number(pick.q) || 0, card.questions.length - 1);
    const disabled = !subject || this._busy;
    return `
      <div class="bst-flip${open ? ' open' : ''}" data-note="${card.id}">
        <div class="bst-flip-inner">
          <button type="button" class="bst-note-face front" data-action="note-flip" data-note="${card.id}" ${disabled ? 'disabled' : ''}>
            <span class="bst-note-t">${esc(card.label)}</span>
            <span class="bst-note-src">${esc(card.sources)}</span>
          </button>
          <div class="bst-note-face back">
            <button type="button" class="bst-note-close" data-action="note-flip" data-note="${card.id}" title="Flip back">↩</button>
            <span class="bst-note-k">${esc(card.label)}</span>
            <label class="bst-field" style="margin:4px 0">
              <span>Question</span>
              <select data-note-q="${card.id}" ${disabled ? 'disabled' : ''}>
                ${card.questions.map((q, i) =>
                  `<option value="${i}" ${i === qIdx ? 'selected' : ''}>${esc(q.text)}</option>`).join('')}
              </select>
            </label>
            <label class="bst-field" style="margin:4px 0">
              <span>About</span>
              <select data-note-target="${card.id}" ${disabled ? 'disabled' : ''}>
                <option value="">— pick a title —</option>
                ${targets.map(t =>
                  `<option value="${esc(t.id)}" ${t.id === pick.targetId ? 'selected' : ''}>${esc(t.title)}</option>`).join('')}
              </select>
            </label>
            <label class="bst-field bst-note-about-field">
              <span>About this…</span>
              <textarea class="bst-note-about" data-note-about="${card.id}" rows="3"
                placeholder="Your angle, follow-up, or extra prompt…"
                ${disabled ? 'disabled' : ''}>${esc(pick.about || '')}</textarea>
            </label>
            <div class="bst-note-askrow">
              <button type="button" class="bst-btn gold" data-action="note-ask" data-note="${card.id}"
                ${disabled || !targets.length ? 'disabled' : ''}>Ask</button>
              <button type="button" class="bst-btn" data-action="note-ask-about" data-note="${card.id}"
                title="Ask the stock question, then append your About this… line"
                ${disabled || !targets.length ? 'disabled' : ''}>About This…</button>
            </div>
          </div>
        </div>
      </div>`;
  }

  // ── Peanut Gallery ─────────────────────────────────────────────────────────

  /** Index of the topic being viewed/continued — decoupled from array order
   * so switching tabs never has to reorder `sessions` to mark one "active". */
  _pgActiveIdx(st) {
    const sessions = st.peanut.sessions || [];
    if (!sessions.length) return -1;
    let idx = Number(st.peanut.activeIdx);
    if (!Number.isFinite(idx) || idx < 0 || idx >= sessions.length) idx = sessions.length - 1;
    return idx;
  }

  _peanutHTML(st) {
    const p = st.peanut;
    const scenes = getSceneCards(this.storage);
    const sessions = p.sessions || [];
    const activeIdx = this._pgActiveIdx(st);
    const active = activeIdx >= 0 ? sessions[activeIdx] : null;
    const mode = p.mode === 'range' || p.mode === 'script' ? p.mode : 'recent';
    const focusChat = !!p.focusChat;
    const poolSize = this._fullCast().filter(c => c && c.priority !== 'director' && c.priority !== 'star').length;
    const voiceHint = poolSize
      ? `${Math.min(3, poolSize)}–${Math.min(6, poolSize)} voices available · not everyone speaks · any order`
      : 'no supporting cast yet — add cast cards that are not Star/Director';
    return `
      <h2 class="bst-pane-title">Peanut Gallery</h2>
      <p class="bst-pane-sub">Cast-only commentary — stream chat aesthetic, never the main room. Reactions pull stamped lore, tags, and filed connections. Star and Director stay off the balcony.</p>

      <div class="bst-pg-toolbar">
        <button type="button" class="bst-btn${focusChat ? ' gold' : ''}" data-action="pg-toggle-focus" title="${focusChat ? 'Show Listen settings' : 'Hide settings and focus the gallery'}">${focusChat ? 'Show settings' : 'Focus gallery'}</button>
      </div>

      <section class="bst-section bst-pg-settings"${focusChat ? ' hidden' : ''}>
        <h3 class="bst-section-h">Listen…</h3>
        <div class="bst-row">
          <label><input type="radio" name="pg-mode" value="recent" ${mode === 'recent' ? 'checked' : ''}> Last N messages</label>
          <label><input type="radio" name="pg-mode" value="range" ${mode === 'range' ? 'checked' : ''}> Message range</label>
          <label><input type="radio" name="pg-mode" value="script" ${mode === 'script' ? 'checked' : ''}> Script entry</label>
        </div>
        ${mode === 'recent' ? `
        <div class="bst-row">
          <label class="bst-field" style="margin:0"><span>Recent count</span>
            <input type="number" min="1" max="80" data-field="recentN" value="${esc(String(p.recentN || 12))}"></label>
        </div>` : ''}
        ${mode === 'range' ? `
        <div class="bst-row">
          <label class="bst-field" style="margin:0"><span>From #</span>
            <input type="number" min="0" data-field="from" value="${esc(String(p.from || 0))}"></label>
          <label class="bst-field" style="margin:0"><span>To #</span>
            <input type="number" min="0" data-field="to" value="${esc(String(p.to || 0))}"></label>
        </div>` : ''}
        ${mode === 'script' ? `
        <div class="bst-row">
          <label class="bst-field" style="flex:1;margin:0"><span>Script card</span>
            <select data-field="scriptUid">
              <option value="">— pick a scene —</option>
              ${scenes.map(s =>
                `<option value="${esc(s.uid)}" ${s.uid === p.scriptUid ? 'selected' : ''}>${esc(s.code)} · ${esc(s.title)}</option>`).join('')}
            </select>
          </label>
        </div>` : ''}
        <div class="bst-row">
          <label class="bst-field" style="flex:1;margin:0"><span>Model</span>
            <select data-g="profile-event">${this._profileOpts(this._g().profiles.event)}</select>
          </label>
        </div>
        <div class="bst-row">
          <button type="button" class="bst-btn gold" data-action="listen" ${this._busy ? 'disabled' : ''}>${this._busy && this._door === 'gallery' ? 'Listening…' : 'Listen…'}</button>
          <button type="button" class="bst-btn" data-action="pg-continue" ${this._busy || !active?.comments?.length ? 'disabled' : ''} title="Cast keep talking — roughly twice as many lines, any order">${this._busy && this._door === 'gallery' ? 'Talking…' : 'Continue'}</button>
          <span class="bst-k">${esc(voiceHint)}</span>
        </div>
      </section>

      <section class="bst-section bst-pg-chat${focusChat ? ' bst-pg-chat--focus' : ''}">
        <h3 class="bst-section-h">Timeline</h3>
        ${sessions.length ? `
          <div class="bst-row">
            ${sessions.map((s, i) =>
              `<button type="button" class="bst-btn${i === activeIdx ? ' gold' : ''}" data-action="pg-session" data-idx="${i}">#${i + 1} · ${esc(s.label || 'listen')}</button>`).join('')}
            <button type="button" class="bst-btn danger" data-action="pg-clear-topic" title="Clear the active topic’s comments">Clear topic</button>
            <button type="button" class="bst-btn danger" data-action="pg-clear-all" title="Wipe every gallery topic">Clear all</button>
          </div>` : '<p class="bst-hint">No previous commentary yet.</p>'}
        <div class="bst-chatlog-box">
          <div class="bst-chatlog" data-role="pg-log">
            ${(active?.comments || []).length
              ? active.comments.map((c, i) => `
                <div class="bst-comment" data-cidx="${i}">
                  <span class="bst-comment-who">${esc(c.name)}:</span>
                  <span class="bst-comment-text">${esc(c.text)}</span>
                  <button type="button" class="bst-btn bst-comment-x" data-action="pg-drop-comment" data-idx="${i}" title="Remove this comment">✕</button>
                </div>`).join('')
              : `<div class="bst-empty">Hit Listen… when you want the balcony talking.</div>`}
          </div>
        </div>
      </section>`;
  }

  // ── Set / Placement · Room Compass ─────────────────────────────────────────

  _sonarCast({ includeWrittenOut = false } = {}) {
    const castMembers = [
      getStarMember(this.storage),
      ...getCastMembers(this.storage).filter(c => c.priority !== 'director'),
    ].filter(Boolean);
    const seen = new Set();
    return castMembers.filter(m => {
      const key = m.id || m.name;
      if (seen.has(key)) return false;
      seen.add(key);
      const presence = normalizeCastPresence(m);
      if (!includeWrittenOut && presence === 'writtenOut') return false;
      return true;
    }).map(m => ({
      id: m.id || m.name,
      name: m.name,
      presence: normalizeCastPresence(m),
    }));
  }

  _scanChatTrackers({ persist = false } = {}) {
    try {
      const st = this._db();
      st.trackers = normalizeTrackers(st.trackers);
      const chat = getContext()?.chat || [];
      const compass = ensureCompass(st);
      let ulChanged = false;
      try { ulChanged = !!syncScriptLibraryUnlisted(compass, this.storage); } catch { /* ignore */ }
      const sonar = this._runSonar(compass, { persist });
      const locKey = locationKeyFromStored(sonar.key);
      if (locKey && st.trackers.scene && locationKeyFromStored(st.trackers.scene.lastLocationKey) !== locKey) {
        st.trackers.scene.lastLocationKey = locKey;
        if (st.trackers.scene.trackStar) {
          this._pushComposerLocation(this._sceneLocationBits(compass, compass.sonar?.lastPlaceId, locKey));
        }
        if (persist) {
          try { this.saveState(); } catch { /* ignore */ }
        }
      } else if (persist && ulChanged) {
        try { this.saveState(); } catch { /* ignore */ }
      }
      const cal = normalizeCalendar(this.storage.getChat('script', {})?.settings?.calendar);
      const sceneHit = applySceneCuesFromChat(st.trackers.scene, chat, { calendar: cal });
      if (sceneHit.changed && sceneHit.time && Number.isFinite(Number(sceneHit.time.hour))) {
        this._syncTimelinePresent({
          hour: Number(sceneHit.time.hour),
          minute: sceneHit.time.minute,
        });
      }
      if (sceneHit.changed && sceneHit.date) {
        this._syncTimelinePresent({
          deltaDays: sceneHit.date.deltaDays,
          hour: sceneHit.date.hour,
          parts: sceneHit.date.parts,
        });
      }
      if (persist && (sceneHit.changed || sceneHit.date)) {
        try {
          const snap = this._sceneClapSnapshot(st);
          if (st.trackers.scene.date && snap.date && snap.date !== '—') {
            st.trackers.scene.lastDateLabel = snap.date;
          }
          if (st.trackers.scene.time && snap.time) {
            st.trackers.scene.lastTimeLabel = snap.time;
          }
          this.saveState();
        } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
  }

  _openPlaceFloorplanIfNeeded(st, placeId, { force = false } = {}) {
    const id = String(placeId || '').trim();
    if (!id) return;
    this._compassTry(() => {
      const compass = ensureCompass(st);
      const place = getPlace(compass, id);
      if (!place || !isCompassPlaceKind(place.kind)) return;
      const emptyHost = isSuiteHostKind(place.kind) && !listSuiteChildren(compass, place.id).length;
      if (!force && !emptyHost) return;
      if (compass.activeRoomId !== id) loadRoom(compass, id);
      this._compassSave(st);
    });
  }

  _scheduleLocCadence() {
    clearTimeout(this._locTrackTimer);
    this._locTrackTimer = setTimeout(() => {
      this._runLocCadence().catch(err => console.warn('[Showtime/location cadence]', err));
    }, 1200);
  }

  async _runLocCadence() {
    if (this._locBusy) return;
    const st = this._db();
    st.trackers = normalizeTrackers(st.trackers);
    if (st.trackers.location?.enabled === false) return;
    const status = st.trackers.status || {};
    if (status.cadence === 'manual') return;
    const chat = getContext()?.chat || [];
    const n = chat.filter(m => m && !m.is_system).length;
    const every = status.cadence === 'per_post' ? 1 : Math.max(1, Number(status.everyN) || 4);
    if (!this._locTrackPrimed) {
      this._locTrackPrimed = true;
      this._locLastCount = n;
      return;
    }
    const prev = this._locLastCount || 0;
    if (n - prev < every) return;
    const windowRows = playMessagesSince(chat, prev);
    const windowText = windowRows.map(m => formatChatLine(m, 480)).filter(Boolean).join('\n');
    this._locLastCount = n;
    const compass = ensureCompass(st);
    if (!locCueHit(windowText, compass)) return;
    const scene = clipExcerptToLines(String(windowText || '').trim(), 1800);
    if (!scene) return;
    this._locBusy = true;
    const chatToken = getContext()?.chatMetadata ?? null;
    try {
      const prompt = buildLocationDeltaPrompt(scene, knownPlaceRoster(compass));
      const response = String(await withShowtimeProfile(this.storage, 'audit', () =>
        leanQuietGenerate(prompt, { kind: 'filing' })) ?? '').trim();
      if ((getContext()?.chatMetadata ?? null) !== chatToken) return;
      const delta = parseLocationDelta(response);
      if (!delta) return;
      const applied = applyLocationDelta(compass, this.storage, delta);
      if (applied.key && st.trackers.scene) {
        st.trackers.scene.lastLocationKey = locationKeyFromStored(applied.key);
      }
      if (applied.changed) {
        try { this.saveState(); } catch { /* ignore */ }
      }
      this._scanChatTrackers({ persist: true });
      try { this._syncFloatingClapper(); } catch { /* ignore */ }
      if (this.container && this._door === 'set') this.render(this.container);
    } finally {
      this._locBusy = false;
    }
  }

  _sceneLocationBits(compass, placeId, fallback = '') {
    const place = placeId ? getPlace(compass, placeId) : null;
    const names = lowestLocationNames(compass, place);
    if (names.length) return names;
    const key = locationKeyFromStored(fallback);
    return key ? [key] : [];
  }

  _syncTimelinePresent({ hour, deltaDays, parts: cueParts, minute } = {}) {
    const hasHour = Number.isFinite(Number(hour));
    const days = Math.trunc(Number(deltaDays) || 0);
    const abs = cueParts && typeof cueParts === 'object' ? cueParts : null;
    if (!hasHour && !days && !abs) return;
    try {
      const script = this.storage.getChat('script', {});
      script.settings ??= {};
      const present = script.settings.timelinePresent;
      if (!present?.parts || typeof present.parts !== 'object') return;
      const cal = normalizeCalendar(script.settings.calendar);
      let parts = { ...present.parts };
      if (days) parts = shiftPartsByDays(parts, days, cal);
      if (abs) {
        if (abs.day != null) parts.day = abs.day;
        if (abs.monthIndex != null) parts.monthIndex = abs.monthIndex;
        if (abs.year != null) parts.year = abs.year;
        if (abs.seasonId) parts.seasonId = abs.seasonId;
        if (abs.seasonPhase) parts.seasonPhase = abs.seasonPhase;
        if (abs.scale) parts.scale = abs.scale;
      }
      if (hasHour) parts.hour = Number(hour);
      if (Number.isFinite(Number(minute))) parts.minute = Math.max(0, Math.min(59, Number(minute)));
      present.parts = parts;
      const key = formatTimeKey(parts, cal);
      if (key) present.key = key;
      this.storage.saveChat();
    } catch { /* ignore */ }
  }

  _syncTimelineHour(hour) {
    this._syncTimelinePresent({ hour });
  }

  _runSonar(compass, { persist = false } = {}) {
    try {
      const before = sonarFingerprint(compass?.sonar);
      const chat = getContext()?.chat || [];
      const result = applySonarPings(compass, {
        castMembers: this._sonarCast({ includeWrittenOut: true }),
        storage: this.storage,
        chat,
      });
      const status = summarizeSonarCheck(compass, {
        storage: this.storage,
        chat,
        focusId: this._compassFocusId || compass?.activeRoomId || '',
      });
      const after = sonarFingerprint(compass?.sonar);
      if (persist && before !== after) {
        try { this.saveState(); } catch { /* ignore */ }
      }
      return {
        key: result?.key || compass?.sonar?.lastKey || '',
        status,
        changed: before !== after,
      };
    } catch {
      return {
        key: compass?.sonar?.lastKey || '',
        status: null,
        changed: false,
      };
    }
  }

  _pushComposerLocation(keys) {
    const list = [...new Set(
      (Array.isArray(keys) ? keys : [keys])
        .map(k => String(k || '').trim())
        .filter(Boolean)
        .map(k => locationKeyFromStored(k)),
    )].filter(Boolean);
    if (!list.length) return;
    const patch = (composer) => {
      if (!composer || typeof composer !== 'object') return;
      composer.sceneFacets ??= {};
      let locs = Array.isArray(composer.sceneFacets.location) ? [...composer.sceneFacets.location] : [];
      locs = locs.filter(x => !String(x || '').includes(','));
      for (const loc of [...list].reverse()) {
        locs = locs.filter(x => String(x).toLowerCase() !== loc.toLowerCase());
        locs.unshift(loc);
      }
      composer.sceneFacets.location = locs.slice(0, 8);
    };
    try {
      patch(this.storage.getChat('composer', {}));
      this.storage.saveChat();
    } catch { /* ignore */ }
    try {
      patch(this.storage.getGlobal('composer', {}));
      this.storage.saveGlobal();
    } catch { /* ignore */ }
  }

  /** Manually pin the scene location from Set (suite or room view). */
  _establishLocation({ placeId, cell } = {}) {
    const st = this._db();
    const compass = ensureCompass(st);
    const place = getPlace(compass, placeId);
    if (!place) {
      alert('Select a room on the suite plan, or open a room, then We’re here.');
      return;
    }
    if (!isCompassPlaceKind(place.kind)) {
      alert('Pick a room, hall, or building exterior — a unit isn’t a standing location.');
      return;
    }
    let cellId = 'C';
    try { cellId = normalizeCell(cell || this._compassSelCell || 'C'); } catch { cellId = 'C'; }
    this._compassTry(() => {
      loadRoom(compass, place.id);
      this._compassSelCell = cellId;
      const focus = getPlace(compass, this._compassFocusId);
      if (isSuiteHostKind(focus?.kind) && place.parentId === focus.id) {
        this._suiteHighlightChild = place.id;
      } else if (this._door === 'set' && focus?.id !== place.id && place.parentId) {
        const parent = getPlace(compass, place.parentId);
        if (isSuiteHostKind(parent?.kind) && this._compassFocusId === parent.id) {
          this._suiteHighlightChild = place.id;
        } else {
          this._compassFocusId = place.id;
        }
      } else if (!isSuiteHostKind(focus?.kind)) {
        this._compassFocusId = place.id;
      }
      const key = String((place.locationTags || []).find(t => String(t || '').trim()) || place.name || place.id).trim();
      const rawKey = mostPreciseGeoName(compass, place) || locationKeyFromStored(key) || place.name;
      st.trackers = normalizeTrackers(st.trackers);
      st.trackers.scene.lastLocationKey = rawKey;
      st.trackers.scene.lastClapAt = Date.now();
      compass.sonar = compass.sonar && typeof compass.sonar === 'object' ? compass.sonar : { pings: {} };
      compass.sonar.pings = compass.sonar.pings && typeof compass.sonar.pings === 'object'
        ? compass.sonar.pings
        : {};
      compass.sonar.lastKey = rawKey;
      compass.sonar.lastPlaceId = place.id;
      compass.sonar.lastAt = Date.now();
      const star = getStarMember(this.storage);
      if (star?.name) {
        const id = String(star.id || star.name);
        compass.sonar.pings[id] = {
          name: star.name,
          castId: id,
          placeId: place.id,
          cell: cellId,
          key: rawKey,
          at: Date.now(),
          manual: true,
        };
      }
      this._pushComposerLocation(this._sceneLocationBits(compass, place.id, rawKey));
      this._compassSave(st);
    });
    this._syncStageBackground();
    this._syncWeatherOverlay();
    this._syncFloatingClapper();
    this.bus?.emit('showtime.stateChanged');
    if (this._door === 'set' || this._door === 'placement' || this._door === 'studio-trackers') {
      this.render(this.container);
    }
  }

  _setHTML(st) {
    const compass = ensureCompass(st);
    const active = getActiveRoom(compass);
    if (!this._compassFocusId) this._compassFocusId = compass.activeRoomId || '';
    if (!this._compassSelCell) this._compassSelCell = 'C';
    const focus = getPlace(compass, this._compassFocusId);
    if (isSuiteHostKind(focus?.kind)) {
      try {
        const { dirty } = ensureSuiteLayout(compass, focus.id);
        if (dirty) this.saveState();
      } catch { /* ignore */ }
    }
    const sonar = this._runSonar(compass);
    const auditReport = auditCompass(compass, { focusId: this._compassFocusId || compass.activeRoomId || '' });
    return buildSetHtml({
      compass,
      active,
      focusId: this._compassFocusId,
      selCell: this._compassSelCell,
      selectedEdges: this._compassSelEdges || [],
      drawWallMode: (this._fpMode || 'move') === 'walls',
      fpMode: this._fpMode || 'move',
      fixtureAct: this._fpFixtureAct === 'remove' ? 'remove' : (this._fpFixtureAct === 'place' ? 'place' : ''),
      suiteMode: ['arrange', 'walls', 'fixtures'].includes(this._suiteMode) ? this._suiteMode : 'browse',
      suiteFixtureAct: this._suiteFixtureAct === 'remove' ? 'remove' : (this._suiteFixtureAct === 'place' ? 'place' : ''),
      suiteHighlightChild: this._suiteHighlightChild || '',
      herePlaceId: compass.activeRoomId || '',
      hereCell: this._compassSelCell || 'C',
      selectedShared: this._suiteSelShared || null,
      selectedEdge: this._suiteSelEdge || null,
      suiteSelEdges: this._suiteSelEdges || [],
      wallLinksOpen: !!(this._prodFolds?.has('set-wall-links')),
      placesOpen: !!(this._prodFolds?.has('set-places')),
      metaOpen: !!(this._prodFolds?.has('set-focus')),
      sonarNote: sonar.key,
      sonarStatus: sonar.status,
      sonarCast: this._sonarCast(),
      lastOpening: this._lastOpening || null,
      storyFocus: this._suiteStoryFocus === 'lower' ? 'lower' : 'upper',
      auditReport,
      storage: this.storage,
      createOpen: !!this._setCreateOpen,
      sonarFilter: this._sonarFilter || '',
      sonarView: this._sonarView || 'all',
      sonarOpen: !!(this._prodFolds?.has('set-sonar')),
      placesFold: [...(this._placesFold || [])],
      placesFoldAuto: !this._placesFoldUser,
      placesEditId: this._placesEditId || '',
      esc,
    });
  }

  _placementHTML(st) {
    const compass = ensureCompass(st);
    const active = getActiveRoom(compass);
    if (!this._compassFocusId) this._compassFocusId = compass.activeRoomId || '';
    if (!this._compassSelCell) this._compassSelCell = 'C';
    const sonar = this._runSonar(compass);
    const sonarReach = normalizeTrackers(st.trackers).location?.sonarReach || 'adjacent';
    return buildPlacementHtml({
      compass,
      active,
      focusId: this._compassFocusId,
      selCell: this._compassSelCell,
      povPreview: this._povPreviewText || '',
      povFacing: this._povFacing || 'N',
      sonarNote: sonar.key,
      sonarStatus: sonar.status,
      sonarCast: this._sonarCast(),
      sonarReach,
      sonarFilter: this._sonarFilter || '',
      sonarView: this._sonarView || 'all',
      esc,
    });
  }

  _studioEffectsHTML(st) {
    const effects = normalizeEffects(st.effects);
    const scene = normalizeTrackers(st.trackers).scene;
    return buildEffectsHtml(effects, scene, { esc, roomExposed: this._activeRoomExposed() });
  }

  _studioTrackersHTML(st) {
    const trackers = normalizeTrackers(st.trackers);
    const clap = this._sceneClapSnapshot(st);
    const seasonHint = clap.season || '';
    return buildTrackersHtml(trackers, { esc, clap, seasonHint });
  }

  _sceneClapSnapshot(st = this._db()) {
    const t = normalizeTrackers(st.trackers);
    const scene = t.scene;
    const compass = ensureCompass(st);
    // Sonar pings only exist on `compass` once _runSonar has scanned the
    // latest message into it — without this, listSonarPingsInPlace below
    // always reads an empty ping table and "star" never shows a position.
    this._runSonar(compass);
    const trackerPlace = this._trackerPlace(compass, scene);
    let location = locationKeyFromStored(scene.lastLocationKey)
      || locationKeyFromStored(compass.sonar?.lastKey)
      || '';
    let star = '—';
    try {
      const pings = trackerPlace ? listSonarPingsInPlace(compass, trackerPlace.id) : [];
      const starMember = getStarMember(this.storage) || getCastMembers(this.storage).find(c => c.priority === 'star');
      const starName = starMember?.name || '';
      const hit = pings.find(p => starName && String(p.name).toLowerCase() === starName.toLowerCase())
        || pings[0];
      if (hit) {
        star = `${hit.name} @ ${hit.cell}${trackerPlace ? ` · ${trackerPlace.name}` : ''}`;
        if (!location) location = locationKeyFromStored(trackerPlace?.locationTags?.[0] || trackerPlace?.name || location);
      } else if (starName) {
        star = starName;
      }
      location = formatSceneLocation({
        compass,
        storage: this.storage,
        placeId: trackerPlace?.id || '',
        key: location,
      });
    } catch { /* ignore */ }

    let season = '';
    let dateLabel = scene.lastDateLabel || '';
    let timeLabel = scene.lastTimeLabel || '';
    try {
      const scriptMod = window.Showtime?.modules?.get('script');
      const script = this.storage.getChat('script', {});
      const cal = normalizeCalendar(script?.settings?.calendar);
      let parts = null;
      if (scene.followTimeline !== false) {
        const present = typeof scriptMod?.getTimelinePresent === 'function'
          ? scriptMod.getTimelinePresent()
          : getTimelinePresent(script, {
            selectedUid: scriptMod?._selectedUid,
            focusedUid: scriptMod?._focusedUid,
          });
        if (present?.parts) parts = present.parts;
      }

      if (parts) {
        const seasonHit = parts.seasonId
          ? cal.seasons.find(s => s.id === parts.seasonId || s.label.toLowerCase() === String(parts.seasonId).toLowerCase())
          : (parts.monthIndex != null ? seasonForMonth(cal, Number(parts.monthIndex) + 1) : null);
        season = seasonHit?.label || '';
      }
      if (scene.date) {
        const absCue = String(scene.lastDateCueSig || '').startsWith('absolute');
        if (absCue && scene.lastDateLabel) {
          dateLabel = scene.lastDateLabel;
        } else if (parts) {
          dateLabel = formatSceneDate(parts, cal, scene.dateParts) || dateLabel;
        }
      }
      if (scene.time) {
        let hour = null;
        // Posted clock in chat wins over a stale Script present hour.
        if (scene.lastTimeHour != null && Number.isFinite(Number(scene.lastTimeHour))) {
          hour = Number(scene.lastTimeHour);
        } else if (parts && Number.isFinite(Number(parts.hour))) {
          hour = Number(parts.hour);
        }
        if (hour != null) {
          const minute = Number(scene.lastTimeMinute) || 0;
          timeLabel = formatTrackerTimeFromHour(scene.timeMode, hour, cal.hoursPerDay, minute) || timeLabel;
        }
      }
    } catch { /* ignore */ }

    if (!scene.time) timeLabel = '';
    return {
      location: location || '—',
      star,
      time: timeLabel,
      date: dateLabel || '—',
      weatherEmoji: scene.weatherEmoji,
      weatherLabel: scene.weatherLabel,
      season,
    };
  }

  _studioVisualsHTML(st) {
    const compass = ensureCompass(st);
    const places = Object.values(compass.rooms || {})
      .filter(p => p.kind === 'room' || p.kind === 'transitional' || p.kind === 'hall')
      .sort((a, b) => a.name.localeCompare(b.name));
    const ctx = this._bgContext();
    return buildVisualsHtml(normalizeVisuals(st.visuals), { esc, places, ctx, placeName: ctx.placeName });
  }

  _compassSave(st) {
    try {
      const compass = ensureCompass(st);
      syncLocationCatalogFromCompass(this.storage, compass);
      pruneGhostLocationNodes(this.storage, compass);
    } catch { /* ignore */ }
    invalidateRenderCache();
    this.saveState();
    this.bus?.emit('showtime.stateChanged');
    this.render(this.container);
  }

  _compassTry(fn) {
    try {
      fn();
      return true;
    } catch (err) {
      alert(err.message || String(err));
      return false;
    }
  }

  // ── Settings ───────────────────────────────────────────────────────────────

  _settingsHTML() {
    const g = this._g();
    const root = ensureShowtimeRoot();
    const profileOpts = (selected) => this._profileOpts(selected);

    const tabRows = Object.entries(MODULE_LABELS).map(([id, label]) => {
      const on = root.enabledModules[id] !== false;
      return `
        <label class="bst-tab-row${on ? '' : ' off'}">
          <input type="checkbox" data-role="mod-toggle" data-mod="${esc(id)}" ${on ? 'checked' : ''} ${id === 'backstage' ? 'disabled' : ''}>
          <span class="bst-tab-name">${esc(label)}</span>
          <span class="bst-k">${on ? 'live' : 'struck'}</span>
        </label>`;
    }).join('');

    return `
      <h2 class="bst-pane-title">Settings</h2>
      <p class="bst-pane-sub">House rules — handbook, profiles, theme, and kill switches. Script Configure lives under Script.</p>

      ${root.masterOff ? `<div class="bst-warn">Master off is engaged. Injections and trackers are silenced.</div>` : ''}

      <section class="bst-section">
        <h3 class="bst-section-h">Handbook</h3>
        <div class="bst-handbook">
          <p>Showtime is a production desk for SillyTavern. Tabs share a cream marquee; each owns a slice of chat or global memory.</p>
          <h4>Quick start</h4>
          <ol>
            <li>Cast — mark a Star, fill cards.</li>
            <li>Script — Agent from chat or Library cubbies; use <strong>Configure</strong> for levels, calendar, and activation.</li>
            <li>Library — file lore into cubbies; Twins / Hide extras for duplicates.</li>
            <li>Backstage — Director, interviews, gallery, set, and these house settings.</li>
          </ol>
          <h4>Spotify (Composer)</h4>
          <p>Create a Spotify Developer app, paste the <strong>Redirect URI</strong> shown in Composer → Spotify (the Showtime <code>spotify-callback.html</code> page — not SillyTavern’s main <code>/</code>), then paste only the <strong>Client ID</strong> in Composer. OAuth uses PKCE — no client secret. Returns land back in the marquee.</p>
        </div>
      </section>

      <section class="bst-section">
        <h3 class="bst-section-h">Connection profiles</h3>
        <p class="bst-hint">Pick which SillyTavern connection profile audits, Motivation, interviews, and Director events / Peanut Gallery should use. Script Agent budgets live under Script → Configure.</p>
        <div class="bst-field"><span>Audits (Cast / Inventory / Reputation)</span>
          <select data-g="profile-audit">${profileOpts(g.profiles.audit)}</select></div>
        <div class="bst-field"><span>Motivation (Audit + narrative sonar)</span>
          <select data-g="profile-motivation">${profileOpts(g.profiles.motivation)}</select></div>
        <div class="bst-field"><span>Interview</span>
          <select data-g="profile-interview">${profileOpts(g.profiles.interview)}</select></div>
        <div class="bst-field"><span>Director events / Peanut Gallery</span>
          <select data-g="profile-event">${profileOpts(g.profiles.event)}</select></div>
      </section>

      <section class="bst-section">
        <h3 class="bst-section-h">Theme</h3>
        <div class="bst-row">
          ${THEME_PRESETS.map(t =>
            `<button type="button" class="bst-btn${g.theme === t.id ? ' gold' : ''}" data-action="theme" data-theme="${t.id}">${esc(t.label)}</button>`).join('')}
        </div>
        <div class="bst-row">
          <label class="bst-field" style="margin:0"><span>Ink</span>
            <input type="color" data-g="ink" value="${esc(g.ink || '#2b1d0e')}"></label>
          <label class="bst-field" style="margin:0"><span>Paper</span>
            <input type="color" data-g="paper" value="${esc(g.paper || '#f4ead5')}"></label>
          <label class="bst-field" style="margin:0"><span>Gold</span>
            <input type="color" data-g="gold" value="${esc(g.gold || '#c9a24a')}"></label>
          <button type="button" class="bst-btn" data-action="theme-apply">Apply swatches</button>
          <button type="button" class="bst-btn" data-action="theme-reset">Reset</button>
        </div>
        <div class="bst-field" style="margin-top:12px"><span>Cast role colors</span>
          <p class="bst-hint">Director / Star / Lead / … accents on Cast (and Motivation billing). Stored with house settings.</p>
          <div class="bst-role-colors">
            ${(() => {
              const colors = getRoleColors();
              return PRIORITIES.map(p => `
                <label class="bst-field bst-role-color" title="${esc(p.label)}">
                  <span>${esc(p.label)}</span>
                  <input type="color" data-role-color="${esc(p.id)}" value="${esc(colors[p.id] || PRIORITY_DEFAULT_COLORS[p.id])}">
                </label>`).join('');
            })()}
          </div>
          <div class="bst-row" style="margin-top:8px">
            <button type="button" class="bst-btn" data-action="role-colors-apply">Apply role colors</button>
            <button type="button" class="bst-btn" data-action="role-colors-reset">Reset roles</button>
          </div>
        </div>
      </section>

      <section class="bst-section">
        <h3 class="bst-section-h">Tabs</h3>
        <p class="bst-hint">Off tabs get a crimson strikethrough on the marquee and will not open. Their injections are cleared.</p>
        <div class="bst-tab-list">${tabRows}</div>
      </section>

      <section class="bst-section">
        <h3 class="bst-section-h">Master switch</h3>
        <div class="bst-row">
          <label><input type="checkbox" data-role="master-off" ${root.masterOff ? 'checked' : ''}> Kill Showtime — silence all injections &amp; trackers</label>
        </div>
        <button type="button" class="bst-btn gold" data-action="settings-save">Save settings</button>
      </section>`;
  }

  _scriptDb() {
    try {
      return this.storage.getChat('script', {
        cards: [],
        settings: {
          orgScheme: 'show',
          aiProfile: '',
          scanDepth: 4,
          injectPinned: true,
          injectKeyword: true,
        },
      });
    } catch {
      return { settings: {} };
    }
  }

  // ── binding ────────────────────────────────────────────────────────────────

  _bind(root) {
    if (!root) return;
    root.addEventListener('click', e => this._onClick(e));
    root.addEventListener('change', e => this._onChange(e));
    root.addEventListener('input', e => {
      if (e.target?.dataset?.role === 'sonar-filter') {
        this._sonarFilter = e.target.value || '';
        this._applySonarFilter(root);
      }
      if (e.target?.dataset?.fx === 'particleIntensity' && e.target.type === 'range') {
        const k = e.target.closest('.bst-field')?.querySelector('.bst-k');
        if (k) k.textContent = `${clampParticleIntensity(e.target.value)}%`;
      }
    });
    this._bindFloorplanDrag(root);
    this._bindFloorplanViewport(root);
    this._bindSuiteCanvas(root);
    this._bindLocationTagPickers(root);
    this._applySonarFilter(root);
    root.querySelectorAll('.bst-set-fold > summary, .bst-sonar-sum, .bst-places-sum').forEach(sum => {
      sum.addEventListener('click', (e) => {
        if (e.target.closest('[data-action="set-open-place"], [data-action="place-open-compass"], [data-action="place-edit"], [data-action="place-edit-save"], [data-action="place-edit-cancel"], [data-action="place-edit-remove"], [data-action="place-edit-merge"], [data-action="place-unlisted-dismiss"], [data-action="set-sonar-check"], [data-action="set-toggle-create"], [data-role="place-edit-kind"], [data-role="place-edit-parent"], [data-role="place-edit-merge"]')) e.preventDefault();
      });
    });
    root.querySelectorAll('details[data-role="places-fold"]').forEach(el => {
      el.addEventListener('toggle', () => {
        const id = el.dataset.fold;
        if (!id) return;
        this._placesFold ??= new Set();
        if (!this._placesFoldUser) {
          this._placesFoldUser = true;
          root.querySelectorAll('details[data-role="places-fold"]').forEach(d => {
            if (d.open && d.dataset.fold) this._placesFold.add(d.dataset.fold);
          });
        }
        if (el.open) this._placesFold.add(id);
        else this._placesFold.delete(id);
      });
    });
    root.querySelectorAll('details.bst-fold[data-fold]').forEach(el => {
      el.addEventListener('toggle', () => {
        const id = el.dataset.fold;
        if (!id) return;
        this._prodFolds ??= new Set();
        if (el.open) this._prodFolds.add(id);
        else this._prodFolds.delete(id);
      });
    });
  }

  _applySonarFilter(root = this.container) {
    if (!root) return;
    const q = String(this._sonarFilter || '').trim().toLowerCase();
    const view = this._sonarView || 'all';
    root.querySelectorAll('.bst-sonar-cast').forEach(row => {
      const name = (row.dataset.name || '').toLowerCase();
      const presence = row.dataset.presence || 'inPlay';
      const parked = row.dataset.parked === '1';
      let on = !q || name.includes(q);
      if (on && view === 'inPlay') on = presence === 'inPlay';
      if (on && view === 'absent') on = presence === 'absent';
      if (on && view === 'parked') on = parked;
      row.hidden = !on;
    });
  }

  _visibleSonarRows(root = this.container) {
    return [...(root?.querySelectorAll('.bst-sonar-cast:not([hidden])') || [])];
  }

  _bindLocationTagPickers(root) {
    root.querySelectorAll('.st-loctag-wrap[data-role="place-loctags"]').forEach(wrap => {
      bindLocationCatalogPicker(wrap, this.storage);
    });
    root.querySelectorAll('.st-loctag-wrap[data-role="focus-loctags"]').forEach(wrap => {
      const place = this._compassFocusId;
      bindLocationCatalogPicker(wrap, this.storage, {
        onChange: (tags) => {
          if (!place) return;
          this._compassTry(() => {
            setLocationTags(ensureCompass(this._db()), place, tags);
            this._compassSave(this._db());
          });
        },
      });
    });
  }

  _fpZoomValue() {
    const z = Number(this._fpZoom);
    if (!Number.isFinite(z)) return 1;
    return Math.max(FP_ZOOM_MIN, Math.min(FP_ZOOM_MAX, z));
  }

  _fpHomePan(vw, vh, ww, wh, z) {
    return {
      x: (vw - ww * z) / 2,
      y: (vh - wh * z) / 2,
    };
  }

  _fpClampPan(p, vw, vh, ww, wh, z) {
    const axis = (v, size, view) =>
      size <= view ? (view - size) / 2 : Math.min(0, Math.max(view - size, v));
    return {
      x: axis(p?.x ?? 0, ww * z, vw),
      y: axis(p?.y ?? 0, wh * z, vh),
    };
  }

  _fpApplyView() {
    const root = this.container;
    const vp = root?.querySelector('[data-role="fp-viewport"]');
    const world = root?.querySelector('[data-role="fp-world"]');
    const lab = root?.querySelector('[data-role="fp-zoom-label"]');
    if (!vp || !world) return;
    const svg = world.querySelector('svg');
    const vw = vp.clientWidth;
    const vh = vp.clientHeight;
    const ww = svg?.width?.baseVal?.value || svg?.clientWidth || 360;
    const wh = svg?.height?.baseVal?.value || svg?.clientHeight || 360;
    const z = this._fpZoomValue();
    const p = this._fpClampPan(
      this._fpPan ?? this._fpHomePan(vw, vh, ww, wh, z),
      vw, vh, ww, wh, z,
    );
    this._fpPan = p;
    world.style.transform = `translate(${p.x}px, ${p.y}px) scale(${z})`;
    if (lab) lab.textContent = `${Math.round(z * 100)}%`;
  }

  _fpSetZoom(next) {
    const vp = this.container?.querySelector('[data-role="fp-viewport"]');
    const world = this.container?.querySelector('[data-role="fp-world"]');
    const svg = world?.querySelector('svg');
    if (!vp || !world) return;
    const z0 = this._fpZoomValue();
    const z1 = Math.max(FP_ZOOM_MIN, Math.min(FP_ZOOM_MAX, next));
    const vw = vp.clientWidth;
    const vh = vp.clientHeight;
    const ww = svg?.width?.baseVal?.value || 360;
    const wh = svg?.height?.baseVal?.value || 360;
    if (this._fpPan && z0 > 0) {
      const cx = (vw / 2 - this._fpPan.x) / z0;
      const cy = (vh / 2 - this._fpPan.y) / z0;
      this._fpPan = { x: vw / 2 - cx * z1, y: vh / 2 - cy * z1 };
    }
    this._fpZoom = z1;
    this._fpApplyView();
  }

  _bindFloorplanViewport(root) {
    const vp = root.querySelector('[data-role="fp-viewport"]');
    if (!vp) return;
    this._fpZoom ??= 1;
    this._fpApplyView();

    if (this._fpRo) {
      try { this._fpRo.disconnect(); } catch { /* ignore */ }
    }
    this._fpRo = new ResizeObserver(() => this._fpApplyView());
    this._fpRo.observe(vp);

    vp.addEventListener('wheel', (e) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 1 / 1.12 : 1.12;
      this._fpSetZoom(this._fpZoomValue() * factor);
    }, { passive: false });

    vp.addEventListener('pointerdown', (e) => {
      // Walls mode still pans from empty grid space; edge hits + barrier draw own that surface.
      if (e.target.closest('.bst-fp-vert, .bst-fp-opening, .bst-fp-barrier-hit, .bst-fp-edge-hit, .bst-fp-zoom, .bst-fp-tools')) return;
      if (e.target.closest('[data-action="compass-drag-room"]')) return;
      if ((this._fpMode || 'move') === 'walls' && e.target.closest('[data-action="compass-draw-wall-surface"]')) return;
      if (e.button != null && e.button !== 0) return;
      e.preventDefault();
      const start = { x: e.clientX, y: e.clientY, pan: { ...(this._fpPan || { x: 0, y: 0 }) } };
      vp.classList.add('panning');
      const onMove = rafMove((ev) => {
        this._fpPan = {
          x: start.pan.x + (ev.clientX - start.x),
          y: start.pan.y + (ev.clientY - start.y),
        };
        this._fpApplyView();
      });
      const onUp = () => {
        onMove.flush();
        vp.classList.remove('panning');
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });
  }

  _bindSuiteCanvas(root) {
    const host = root.querySelector('[data-role="suite-canvas"]');
    if (!host) return;
    const svg = host.querySelector('.bst-suite-svg');
    if (!svg) return;

    const bounds = {
      minX: Number(host.dataset.boundsMinX) || 0,
      minY: Number(host.dataset.boundsMinY) || 0,
      w: Number(host.dataset.boundsW) || 1,
      h: Number(host.dataset.boundsH) || 1,
    };
    const svgW = Number(host.dataset.svgW) || 420;
    const svgH = Number(host.dataset.svgH) || 240;

    const clientToWorld = (ev) => {
      const rect = svg.getBoundingClientRect();
      const sx = ((ev.clientX - rect.left) / Math.max(1, rect.width)) * svgW;
      const sy = ((ev.clientY - rect.top) / Math.max(1, rect.height)) * svgH;
      return {
        x: bounds.minX + (sx / svgW) * bounds.w,
        y: bounds.minY + (sy / svgH) * bounds.h,
      };
    };

    const projectVerts = (verts) => verts.map(v => {
      const sx = ((v.x - bounds.minX) / bounds.w) * svgW;
      const sy = ((v.y - bounds.minY) / bounds.h) * svgH;
      return `${sx.toFixed(1)},${sy.toFixed(1)}`;
    }).join(' ');

    const worldToSvgPt = (wx, wy) => ({
      x: ((wx - bounds.minX) / bounds.w) * svgW,
      y: ((wy - bounds.minY) / bounds.h) * svgH,
    });

    // Shift = fine increments, Alt = coarse increments, otherwise the room's
    // configured grid — lets parent-view wall drags be as precise or as
    // coarse as the user needs.
    const stepMulFor = (ev) => (ev?.shiftKey ? 4 : (ev?.altKey ? 0.25 : 1));

    let dragging = null;

    const onMove = rafMove((ev) => {
      if (!dragging) return;
      if (dragging.kind === 'child') {
        const w = clientToWorld(ev);
        dragging.pose = normalizeSuitePose({
          x: dragging.startPose.x + (w.x - dragging.startWorld.x),
          y: dragging.startPose.y + (w.y - dragging.startWorld.y),
          rot: dragging.startPose.rot,
        });
        dragging.moved = true;
        const verts = worldPolygon(dragging.room, dragging.pose);
        const poly = dragging.g?.querySelector('.bst-suite-poly');
        if (poly) poly.setAttribute('points', projectVerts(verts));
        const cx = verts.reduce((s, v) => s + v.x, 0) / (verts.length || 1);
        const cy = verts.reduce((s, v) => s + v.y, 0) / (verts.length || 1);
        const lx = ((cx - bounds.minX) / bounds.w) * svgW;
        const ly = ((cy - bounds.minY) / bounds.h) * svgH;
        const label = dragging.g?.querySelector('.bst-suite-label');
        const handle = dragging.g?.querySelector('.bst-suite-handle');
        if (label) {
          label.setAttribute('x', lx.toFixed(1));
          label.setAttribute('y', ly.toFixed(1));
        }
        if (handle) {
          handle.setAttribute('cx', lx.toFixed(1));
          handle.setAttribute('cy', ly.toFixed(1));
        }
        return;
      }
      if (dragging.kind === 'edge') {
        const distPx = Math.hypot(
          (ev.clientX || 0) - (dragging.startClientX || 0),
          (ev.clientY || 0) - (dragging.startClientY || 0),
        );
        if (!dragging.moved && distPx < 6) return;
        const w = clientToWorld(ev);
        dragging.moved = true;
        const extra = (this._suiteSelEdges || [])
          .filter(e => e.placeId === dragging.childId)
          .map(e => Number(e.edge));
        const inSel = extra.includes(dragging.edge);
        const moveEdges = (inSel && extra.length)
          ? [...new Set([...extra, dragging.edge])]
          : [dragging.edge];
        const unit = Number(dragging.room?.footprint?.unitPerGrid) || 1;
        const step = (ev.shiftKey || ev.altKey) ? (unit / stepMulFor(ev)) : 0;
        const verts0 = worldPolygon(dragging.room, dragging.pose);
        const previewVerts = moveFaceVerts(verts0, dragging.edge, w, {
          allSelectedEdges: moveEdges,
          step,
        });
        const poly = dragging.g?.querySelector('.bst-suite-poly');
        if (poly) poly.setAttribute('points', projectVerts(previewVerts));
        let outline = svg.querySelector('[data-role="reshape-outline"]');
        if (!outline) {
          outline = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
          outline.setAttribute('data-role', 'reshape-outline');
          outline.setAttribute('class', 'bst-suite-reshape-preview');
          svg.appendChild(outline);
        }
        outline.setAttribute('points', projectVerts(previewVerts));
        dragging.worldVerts = previewVerts;
        dragging.worldTarget = w;
        return;
      }
      if (dragging.kind === 'opening') {
        const w = clientToWorld(ev);
        const norm = worldToFootprintNorm(w.x, w.y, dragging.room, dragging.pose);
        const { a, b } = edgeEndpoints(dragging.room.footprint, dragging.edge);
        let along = alongEdgeFromPoint(a, b, norm.x, norm.y);
        const half = (Number(dragging.width) || 0.14) / 2;
        along = Math.max(half, Math.min(1 - half, along));
        dragging.along = along;
        dragging.moved = Math.abs(along - dragging.startAlong) > 0.01;
        const onEdgeNorm = pointAlong(a, b, along);
        const onEdgeWorld = worldFromNorm(dragging.room, dragging.pose, onEdgeNorm.x, onEdgeNorm.y);
        const p = worldToSvgPt(onEdgeWorld.x, onEdgeWorld.y);
        const ghost = svg.querySelector('[data-role="opening-ghost"]');
        if (ghost) {
          ghost.setAttribute('cx', p.x.toFixed(1));
          ghost.setAttribute('cy', p.y.toFixed(1));
          ghost.setAttribute('visibility', 'visible');
        }
      }
    });

    const onUp = () => {
      if (!dragging) return;
      onMove.flush();
      const d = dragging;
      dragging = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      host.classList.remove('dragging');
      const outline = svg.querySelector('[data-role="reshape-outline"]');
      if (outline) outline.remove();
      const ghost = svg.querySelector('[data-role="opening-ghost"]');
      if (ghost) ghost.setAttribute('visibility', 'hidden');
      if (d.moved) this._suiteSkipClick = true;
      if (!d.moved) {
        if (d.kind === 'edge') {
          this._suiteSelEdge = { placeId: d.childId, edge: d.edge };
          const now = Date.now();
          const last = this._suiteEdgeClick || {};
          const dbl = last.placeId === d.childId && last.edge === d.edge && (now - last.at) < 450;
          this._suiteEdgeClick = { placeId: d.childId, edge: d.edge, at: now };
          if (dbl) {
            const face = facingEdges(d.room, d.pose, d.edge);
            this._suiteSelEdges = face.map(e => ({ placeId: d.childId, edge: e }));
            this._suiteMode = 'walls';
            this.render(this.container);
            return;
          }
          // Multi-select on the same room (click to add / toggle). A click on
          // another room starts a fresh pick. Divide still needs exactly 2.
          const existing = this._suiteSelEdges || [];
          const sameRoom = existing.length && existing[0].placeId === d.childId;
          if (!sameRoom) {
            this._suiteSelEdges = [{ placeId: d.childId, edge: d.edge }];
          } else {
            const idx = existing.findIndex(x => x.edge === d.edge);
            if (idx >= 0) this._suiteSelEdges = existing.filter((_, i) => i !== idx);
            else this._suiteSelEdges = [...existing, { placeId: d.childId, edge: d.edge }];
          }
          this._suiteMode = 'walls';
          this.render(this.container);
        } else if (d.kind === 'opening') {
          const st = this._db();
          if (this._suiteFixtureAct === 'remove') {
            this._compassTry(() => {
              removeOpening(ensureCompass(st), d.placeId, d.linkId, d.opnId);
              this._compassSave(st);
            });
            return;
          }
          // Click without drag in Place mode → same edit dialog as the
          // individual room's Fixtures editor.
          const compass = ensureCompass(st);
          const room = getPlace(compass, d.placeId);
          const link = (room?.links || []).find(l => l.id === d.linkId);
          const op = link?.openings?.find(o => o.id === d.opnId);
          if (room && link && op) {
            openOpeningDialog({
              room,
              compass,
              link,
              existing: op,
              onSave: (patch) => {
                this._compassTry(() => {
                  updateOpening(ensureCompass(st), d.placeId, link.id, op.id, patch);
                  this._compassSave(st);
                });
              },
              onDelete: () => {
                this._compassTry(() => {
                  removeOpening(ensureCompass(st), d.placeId, link.id, op.id);
                  this._compassSave(st);
                });
              },
            });
          }
        }
        return;
      }
      const st = this._db();
      this._compassTry(() => {
        const compass = ensureCompass(st);
        if (d.kind === 'child') {
          moveSuiteChild(compass, d.unitId, d.childId, d.pose, { snap: true });
        } else if (d.kind === 'edge' && (d.worldVerts || d.worldTarget)) {
          reshapeSuiteRoomFace(
            compass,
            d.unitId,
            d.childId,
            d.edge,
            d.worldTarget,
            this._suiteSelEdges,
            d.worldVerts,
          );
        } else if (d.kind === 'opening') {
          updateOpening(compass, d.placeId, d.linkId, d.opnId, { along: d.along });
        }
        this._compassSave(st);
      });
    };

    host.addEventListener('pointerdown', (e) => {
      const mode = this._suiteMode || 'browse';
      if (mode === 'arrange') {
        const handle = e.target.closest('[data-action="suite-drag-child"]');
        if (!handle || !host.contains(handle)) return;
        e.preventDefault();
        e.stopPropagation();
        const childId = handle.dataset.place || '';
        const unitId = handle.dataset.unit || host.dataset.unit || '';
        if (!childId || !unitId) return;
        const st = this._db();
        const compass = ensureCompass(st);
        ensureSuiteLayout(compass, unitId);
        const unit = getPlace(compass, unitId);
        const room = getPlace(compass, childId);
        if (!unit || !room) return;
        const pose = normalizeSuitePose(unit.suiteLayout?.[childId] || { x: 0, y: 0, rot: 0 });
        const g = svg.querySelector(`[data-suite-child="${childId}"]`) || handle.closest('[data-suite-child]');
        dragging = {
          kind: 'child',
          unitId,
          childId,
          room,
          g,
          startPose: pose,
          pose,
          startWorld: clientToWorld(e),
          moved: false,
        };
        host.classList.add('dragging');
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        return;
      }
      if (mode === 'walls') {
        const sharedEl = e.target.closest('[data-action="suite-select-shared"]');
        const edgeEl = e.target.closest('[data-action="suite-drag-edge"]');
        const st = this._db();
        const compass = ensureCompass(st);
        const unitId = host.dataset.unit || '';
        if (!unitId) return;
        ensureSuiteLayout(compass, unitId);
        const unit = getPlace(compass, unitId);
        if (!unit) return;

        const startEdgeDrag = (childId, edge, g) => {
          const room = getPlace(compass, childId);
          if (!room || !Number.isFinite(edge)) return false;
          const pose = normalizeSuitePose(unit.suiteLayout?.[childId] || { x: 0, y: 0, rot: 0 });
          const verts = worldPolygon(room, pose);
          const n = verts.length || 1;
          const a = verts[((edge % n) + n) % n];
          const b = verts[(((edge % n) + n) % n + 1) % n];
          const horiz = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
          dragging = {
            kind: 'edge',
            unitId,
            childId,
            room,
            pose,
            edge,
            g: g || svg.querySelector(`[data-suite-child="${childId}"]`),
            startFp: room.footprint,
            startWorld: clientToWorld(e),
            startClientX: e.clientX,
            startClientY: e.clientY,
            mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
            horiz,
            preview: null,
            moved: false,
          };
          this._suiteSelEdge = { placeId: childId, edge };
          host.classList.add('dragging');
          window.addEventListener('pointermove', onMove);
          window.addEventListener('pointerup', onUp);
          return true;
        };

        if (sharedEl && host.contains(sharedEl)) {
          e.preventDefault();
          e.stopPropagation();
          const aId = sharedEl.dataset.a || '';
          const bId = sharedEl.dataset.b || '';
          const wallA = sharedEl.dataset.wallA || '';
          const wallB = sharedEl.dataset.wallB || '';
          this._suiteSelShared = { aId, bId, wallA, wallB };
          const highlight = this._suiteHighlightChild;
          const childId = highlight === bId ? bId : (highlight === aId ? aId : aId);
          const wall = childId === bId ? wallB : wallA;
          const room = getPlace(compass, childId);
          if (!room) return;
          const pose = normalizeSuitePose(unit.suiteLayout?.[childId] || { x: 0, y: 0, rot: 0 });
          const wpt = clientToWorld(e);
          const edgeAttr = childId === bId ? sharedEl.dataset.edgeB : sharedEl.dataset.edgeA;
          const fromAttr = Number(edgeAttr);
          const edge = Number.isFinite(fromAttr)
            ? fromAttr
            : nearestFacingEdge(room, pose, wall, wpt.x, wpt.y);
          startEdgeDrag(childId, edge, svg.querySelector(`[data-suite-child="${childId}"]`));
          return;
        }
        if (edgeEl && host.contains(edgeEl)) {
          e.preventDefault();
          e.stopPropagation();
          const childId = edgeEl.dataset.place || '';
          const edge = Number(edgeEl.dataset.edge);
          const pair = sharedPairForSuiteEdge(compass, unitId, childId, edge);
          if (pair) {
            this._suiteSelShared = {
              aId: pair.aId,
              bId: pair.bId,
              wallA: pair.wallA,
              wallB: pair.wallB,
            };
          } else {
            this._suiteSelShared = null;
          }
          startEdgeDrag(childId, edge, edgeEl.closest('[data-suite-child]'));
        }
        return;
      }
      if (mode === 'fixtures') {
        const opnEl = e.target.closest('[data-action="suite-drag-opening"]');
        if (!opnEl || !host.contains(opnEl)) return;
        e.preventDefault();
        e.stopPropagation();
        const st = this._db();
        const compass = ensureCompass(st);
        const placeId = opnEl.dataset.place || '';
        const linkId = opnEl.dataset.link || '';
        const opnId = opnEl.dataset.opn || '';
        const unitId = host.dataset.unit || '';
        const room = getPlace(compass, placeId);
        if (!unitId || !room) return;
        ensureSuiteLayout(compass, unitId);
        const unit = getPlace(compass, unitId);
        const link = (room.links || []).find(l => l.id === linkId);
        const op = link?.openings?.find(o => o.id === opnId);
        if (!unit || !link || !op || !Number.isFinite(Number(opnEl.dataset.edge))) return;
        const pose = normalizeSuitePose(unit.suiteLayout?.[placeId] || { x: 0, y: 0, rot: 0 });
        // Drag against the same (possibly Align-welded) geometry the canvas
        // drew, so the fixture slides along the wall the user sees.
        const geoFootprint = unit.suiteVisualFootprints?.[placeId] || room.footprint;
        dragging = {
          kind: 'opening',
          unitId,
          placeId,
          linkId,
          opnId,
          room: { ...room, footprint: geoFootprint },
          pose,
          edge: Number(opnEl.dataset.edge),
          width: Number(op.width) || 0.14,
          startAlong: Number(op.along) || 0.5,
          along: Number(op.along) || 0.5,
          moved: false,
        };
        host.classList.add('dragging');
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      }
    });
  }

  _bindFloorplanDrag(root) {
    const svg = root.querySelector('.bst-floorplan svg');
    if (!svg) return;
    const FP_SIZE = 360;
    const FP_PAD = 28;
    let dragging = null;

    const clientToNorm = (ev) => {
      const rect = svg.getBoundingClientRect();
      const inner = FP_SIZE - FP_PAD * 2;
      const x = Math.max(0, Math.min(1, ((ev.clientX - rect.left) / rect.width * FP_SIZE - FP_PAD) / inner));
      const y = Math.max(0, Math.min(1, ((ev.clientY - rect.top) / rect.height * FP_SIZE - FP_PAD) / inner));
      return { x, y };
    };

    const onMove = rafMove((ev) => {
      if (!dragging) return;
      const { x, y } = clientToNorm(ev);
      if (dragging.kind === 'room') {
        dragging.dx = x - dragging.startX;
        dragging.dy = y - dragging.startY;
        dragging.moved = Math.hypot(dragging.dx, dragging.dy) > 0.008;
        const preview = translateFootprint(dragging.fp0, dragging.dx, dragging.dy);
        const { pts } = projectFootprint(preview, FP_SIZE, FP_PAD);
        const fill = svg.querySelector('.bst-fp-fill');
        if (fill && pts.length) {
          fill.setAttribute('d', pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ') + ' Z');
        }
        return;
      }
      if (dragging.kind === 'vert') {
        dragging.x = x;
        dragging.y = y;
        dragging.moved = true;
        const circ = svg.querySelector(`[data-vert="${dragging.vert}"]`);
        if (circ) {
          const inner = FP_SIZE - FP_PAD * 2;
          circ.setAttribute('cx', String(FP_PAD + x * inner));
          circ.setAttribute('cy', String(FP_PAD + y * inner));
        }
        return;
      }
      if (dragging.kind === 'opening') {
        if (dragging.vertical || !Number.isFinite(dragging.edge) || dragging.edge < 0) return;
        const st = this._db();
        const compass = ensureCompass(st);
        const room = getPlace(compass, dragging.placeId);
        if (!room) return;
        const { a, b } = edgeEndpoints(room.footprint, dragging.edge);
        let along = alongEdgeFromPoint(a, b, x, y);
        const half = (Number(dragging.width) || 0.14) / 2;
        along = Math.max(half, Math.min(1 - half, along));
        dragging.along = along;
        dragging.moved = Math.abs(along - dragging.startAlong) > 0.01;
        const { pts } = projectFootprint(room.footprint, FP_SIZE, FP_PAD);
        const i = dragging.edge;
        const pa = pts[i];
        const pb = pts[(i + 1) % pts.length];
        const t0 = along - half;
        const t1 = along + half;
        const p0 = { x: pa.x + (pb.x - pa.x) * t0, y: pa.y + (pb.y - pa.y) * t0 };
        const p1 = { x: pa.x + (pb.x - pa.x) * t1, y: pa.y + (pb.y - pa.y) * t1 };
        const line = dragging.el;
        if (line && line.tagName === 'line') {
          line.setAttribute('x1', String(p0.x));
          line.setAttribute('y1', String(p0.y));
          line.setAttribute('x2', String(p1.x));
          line.setAttribute('y2', String(p1.y));
        }
        return;
      }
      if (dragging.kind === 'edge') {
        if ((this._fpMode || 'move') === 'fixtures') return;
        dragging.x = x;
        dragging.y = y;
        const dx = Math.abs(x - dragging.startX);
        const dy = Math.abs(y - dragging.startY);
        dragging.moved = dx > 0.01 || dy > 0.01;
        // Live preview: move both endpoints of the hit line + solid edges share verts — full refresh on up
        const st = this._db();
        const compass = ensureCompass(st);
        const room = getPlace(compass, dragging.placeId);
        if (!room) return;
        const selected = [...(this._compassSelEdges || [])].map(Number).filter(Number.isFinite);
        const inSel = selected.includes(dragging.edge);
        const idxs = (inSel && selected.length)
          ? [...new Set([...selected, dragging.edge])]
          : [dragging.edge];
        const preview = moveEdges(room.footprint, idxs, x, y);
        const { pts } = projectFootprint(preview, FP_SIZE, FP_PAD);
        const fill = svg.querySelector('.bst-fp-fill');
        if (fill && pts.length) {
          fill.setAttribute('d', pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ') + ' Z');
        }
        const n = pts.length;
        for (const i of idxs) {
          const j = (i + 1) % n;
          const c0 = svg.querySelector(`[data-vert="${i}"]`);
          const c1 = svg.querySelector(`[data-vert="${j}"]`);
          if (c0) { c0.setAttribute('cx', String(pts[i].x)); c0.setAttribute('cy', String(pts[i].y)); }
          if (c1) { c1.setAttribute('cx', String(pts[j].x)); c1.setAttribute('cy', String(pts[j].y)); }
        }
        dragging.el?.setAttribute('x1', String(pts[dragging.edge].x));
        dragging.el?.setAttribute('y1', String(pts[dragging.edge].y));
        dragging.el?.setAttribute('x2', String(pts[(dragging.edge + 1) % n].x));
        dragging.el?.setAttribute('y2', String(pts[(dragging.edge + 1) % n].y));
        dragging.idxs = idxs;
        return;
      }
      if (dragging.kind === 'draw-wall') {
        dragging.x1 = x;
        dragging.y1 = y;
        const ghost = svg.querySelector('[data-role="barrier-ghost"]');
        if (ghost) {
          const inner = FP_SIZE - FP_PAD * 2;
          ghost.setAttribute('visibility', 'visible');
          ghost.setAttribute('x1', String(FP_PAD + dragging.x0 * inner));
          ghost.setAttribute('y1', String(FP_PAD + dragging.y0 * inner));
          ghost.setAttribute('x2', String(FP_PAD + x * inner));
          ghost.setAttribute('y2', String(FP_PAD + y * inner));
        }
      }
    });

    const onUp = () => {
      if (!dragging) return;
      onMove.flush();
      const d = dragging;
      dragging = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);

      if (d.kind === 'vert') {
        const st = this._db();
        this._compassTry(() => {
          const compass = ensureCompass(st);
          const room = getPlace(compass, d.placeId);
          setFootprint(compass, d.placeId, moveVertex(room.footprint, d.vert, d.x, d.y));
          this._compassSave(st);
        });
        return;
      }

      if (d.kind === 'room') {
        if (!d.moved) return;
        const st = this._db();
        this._compassTry(() => {
          setFootprint(ensureCompass(st), d.placeId, translateFootprint(d.fp0, d.dx, d.dy));
          this._compassSave(st);
        });
        return;
      }

      if (d.kind === 'edge') {
        if (!d.moved) {
          if ((this._fpMode || 'move') === 'fixtures') {
            if (this._fpFixtureAct === 'place') {
              return void this._fpPlaceFixtureOnEdge(d.placeId, d.edge, d.x, d.y);
            }
            return;
          }
          const edge = String(d.edge);
          this._compassSelEdges = this._compassSelEdges || new Set();
          if (this._compassSelEdges.has(edge)) this._compassSelEdges.delete(edge);
          else this._compassSelEdges.add(edge);
          return void this.render(this.container);
        }
        if ((this._fpMode || 'move') !== 'walls') return;
        const st = this._db();
        this._compassTry(() => {
          const compass = ensureCompass(st);
          const room = getPlace(compass, d.placeId);
          const idxs = Array.isArray(d.idxs) && d.idxs.length ? d.idxs : [d.edge];
          setFootprint(compass, d.placeId, moveEdges(room.footprint, idxs, d.x, d.y));
          this._compassSave(st);
        });
        return;
      }

      if (d.kind === 'opening') {
        if (!d.moved) {
          if ((this._fpMode || 'move') === 'fixtures' && this._fpFixtureAct === 'remove') {
            const st = this._db();
            this._compassTry(() => {
              removeOpening(ensureCompass(st), d.placeId, d.linkId, d.opnId);
              this._compassSave(st);
            });
            return;
          }
          // Click without drag → edit dialog
          const st = this._db();
          const compass = ensureCompass(st);
          const room = getPlace(compass, d.placeId);
          const link = (room?.links || []).find(l => l.id === d.linkId);
          const op = link?.openings?.find(o => o.id === d.opnId);
          if (room && link && op) {
            openOpeningDialog({
              room,
              compass,
              link,
              existing: op,
              onSave: (patch) => {
                this._compassTry(() => {
                  updateOpening(ensureCompass(st), d.placeId, link.id, op.id, patch);
                  this._compassSave(st);
                });
              },
              onDelete: () => {
                this._compassTry(() => {
                  removeOpening(ensureCompass(st), d.placeId, link.id, op.id);
                  this._compassSave(st);
                });
              },
            });
          }
          return;
        }
        if ((this._fpMode || 'move') === 'fixtures' && this._fpFixtureAct === 'remove') return;
        if (d.vertical || !Number.isFinite(d.edge) || d.edge < 0) return;
        const st = this._db();
        this._compassTry(() => {
          updateOpening(ensureCompass(st), d.placeId, d.linkId, d.opnId, { along: d.along });
          this._compassSave(st);
        });
        return;
      }

      if (d.kind === 'draw-wall') {
        const st = this._db();
        this._compassTry(() => {
          const compass = ensureCompass(st);
          const room = getPlace(compass, d.placeId);
          const wall = finalizeWallSegment(d.x0, d.y0, d.x1, d.y1, room?.footprint);
          if (!wall) throw new Error('Wall is too short — drag further on the grid.');
          addInternalWall(compass, d.placeId, wall);
          this._compassSave(st);
        });
      }
    };

    svg.querySelectorAll('[data-action="compass-drag-vert"]').forEach(el => {
      el.addEventListener('pointerdown', (ev) => {
        if ((this._fpMode || 'move') !== 'verts') return;
        ev.preventDefault();
        ev.stopPropagation();
        dragging = {
          kind: 'vert',
          placeId: el.dataset.place,
          vert: Number(el.dataset.vert),
          x: 0,
          y: 0,
          moved: false,
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        onMove(ev);
      });
    });

    svg.querySelectorAll('[data-action="compass-select-edge"]').forEach(el => {
      el.addEventListener('pointerdown', (ev) => {
        const mode = this._fpMode || 'move';
        if (mode !== 'walls' && mode !== 'fixtures') return;
        if (mode === 'fixtures' && this._fpFixtureAct !== 'place') return;
        ev.preventDefault();
        ev.stopPropagation();
        const { x, y } = clientToNorm(ev);
        dragging = {
          kind: 'edge',
          placeId: el.dataset.place,
          edge: Number(el.dataset.edge),
          x,
          y,
          startX: x,
          startY: y,
          moved: false,
          el,
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      });
    });

    svg.querySelectorAll('[data-action="compass-drag-opening"]').forEach(el => {
      el.addEventListener('pointerdown', (ev) => {
        const mode = this._fpMode || 'move';
        if (mode !== 'fixtures') return;
        ev.preventDefault();
        ev.stopPropagation();
        const st = this._db();
        const compass = ensureCompass(st);
        const room = getPlace(compass, el.dataset.place);
        const link = (room?.links || []).find(l => l.id === el.dataset.link);
        const op = link?.openings?.find(o => o.id === el.dataset.opn);
        dragging = {
          kind: 'opening',
          placeId: el.dataset.place,
          linkId: el.dataset.link,
          opnId: el.dataset.opn,
          edge: Number(el.dataset.edge),
          width: Number(op?.width) || 0.14,
          startAlong: Number(op?.along) || 0.5,
          along: Number(op?.along) || 0.5,
          moved: false,
          el,
          remove: mode === 'fixtures' && this._fpFixtureAct === 'remove',
          vertical: el.dataset.vertical === '1' || isVerticalOpeningType(op?.type) || isVerticalOpeningType(el.dataset.type),
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      });
    });

    if ((this._fpMode || 'move') === 'move') {
      svg.querySelectorAll('[data-action="compass-drag-room"]').forEach(el => {
        el.addEventListener('pointerdown', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          const placeId = el.dataset.place
            || svg.closest('[data-place]')?.dataset?.place
            || root.querySelector('.bst-floorplan')?.dataset?.place;
          if (!placeId) return;
          const st = this._db();
          const room = getPlace(ensureCompass(st), placeId);
          if (!room) return;
          const { x, y } = clientToNorm(ev);
          dragging = {
            kind: 'room',
            placeId,
            fp0: normalizeFootprint(room.footprint),
            startX: x,
            startY: y,
            dx: 0,
            dy: 0,
            moved: false,
          };
          window.addEventListener('pointermove', onMove);
          window.addEventListener('pointerup', onUp);
        });
      });
    }

    if ((this._fpMode || 'move') === 'walls') {
      const placeId = svg.closest('[data-place]')?.dataset?.place
        || root.querySelector('.bst-floorplan')?.dataset?.place;
      const ghost = svg.querySelector('[data-role="barrier-ghost"]');
      const updateGhost = (x0, y0, x1, y1) => {
        if (!ghost) return;
        const inner = FP_SIZE - FP_PAD * 2;
        ghost.setAttribute('visibility', 'visible');
        ghost.setAttribute('x1', String(FP_PAD + x0 * inner));
        ghost.setAttribute('y1', String(FP_PAD + y0 * inner));
        ghost.setAttribute('x2', String(FP_PAD + x1 * inner));
        ghost.setAttribute('y2', String(FP_PAD + y1 * inner));
      };
      svg.addEventListener('pointerdown', (ev) => {
        if (ev.target.closest('[data-action="compass-barrier-del"]')) return;
        if (ev.target.closest('.bst-fp-edge-hit, .bst-fp-vert, .bst-fp-opening')) return;
        ev.preventDefault();
        ev.stopPropagation();
        const { x, y } = clientToNorm(ev);
        dragging = {
          kind: 'draw-wall',
          placeId,
          x0: x,
          y0: y,
          x1: x,
          y1: y,
        };
        updateGhost(x, y, x, y);
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      });
    }
  }

  _fpPlaceFixtureOnEdge(placeId, edge, x, y) {
    const st = this._db();
    const type = this.container.querySelector('[data-role="fp-fixture-type"]')?.value || 'door';
    if (isVerticalOpeningType(type)) {
      alert('Pick an area on the floorplan for ascent / descent (stairs, ladders, trapdoors).');
      return;
    }
    this._compassTry(() => {
      const compass = ensureCompass(st);
      const room = getPlace(compass, placeId);
      if (!room) return;
      const link = ensureEdgeLink(compass, placeId, edge);
      const { a, b } = edgeEndpoints(room.footprint, edge);
      let along = alongEdgeFromPoint(a, b, x, y);
      along = Math.max(0.1, Math.min(0.9, along));
      addOpening(compass, placeId, link.id, {
        type,
        along,
        width: type === 'window' ? 0.16 : (type === 'arch' || type === 'passage' ? 0.2 : 0.14),
        cell: this._compassSelCell || 'C',
      });
      this._lastOpening = { placeId, linkId: link.id };
      this._compassSave(st);
    });
  }

  _suitePlaceFixtureOnEdge(placeId, edge, e) {
    if (!placeId || !Number.isFinite(edge)) return;
    const host = this.container.querySelector('[data-role="suite-canvas"]');
    const svg = host?.querySelector('.bst-suite-svg');
    if (!host || !svg) return;
    const unitId = host.dataset.unit || '';
    const type = this.container.querySelector('[data-role="suite-fixture-type"]')?.value || 'door';
    if (isVerticalOpeningType(type)) return;
    const bounds = {
      minX: Number(host.dataset.boundsMinX) || 0,
      minY: Number(host.dataset.boundsMinY) || 0,
      w: Number(host.dataset.boundsW) || 1,
      h: Number(host.dataset.boundsH) || 1,
    };
    const svgW = Number(host.dataset.svgW) || 420;
    const svgH = Number(host.dataset.svgH) || 240;
    const rect = svg.getBoundingClientRect();
    const sx = ((e.clientX - rect.left) / Math.max(1, rect.width)) * svgW;
    const sy = ((e.clientY - rect.top) / Math.max(1, rect.height)) * svgH;
    const world = {
      x: bounds.minX + (sx / svgW) * bounds.w,
      y: bounds.minY + (sy / svgH) * bounds.h,
    };
    const st = this._db();
    this._compassTry(() => {
      const compass = ensureCompass(st);
      const room = getPlace(compass, placeId);
      const unit = getPlace(compass, unitId);
      if (!room || !unit) return;
      const pose = normalizeSuitePose(unit.suiteLayout?.[placeId] || { x: 0, y: 0, rot: 0 });
      // The suite canvas renders each child through its Align "visual"
      // footprint when one exists, so the wall the user clicked (and the edge
      // index carried on the hit-line) is indexed against that shape — resolve
      // `along` on the same geometry, otherwise a welded room drops the fixture
      // on the wrong edge / wrong spot.
      const geoFootprint = unit.suiteVisualFootprints?.[placeId] || room.footprint;
      const geoRoom = { ...room, footprint: geoFootprint };
      const norm = worldToFootprintNorm(world.x, world.y, geoRoom, pose);
      const link = ensureEdgeLink(compass, placeId, edge);
      const { a, b } = edgeEndpoints(geoFootprint, edge);
      let along = alongEdgeFromPoint(a, b, norm.x, norm.y);
      along = Math.max(0.1, Math.min(0.9, along));
      addOpening(compass, placeId, link.id, {
        type,
        along,
        width: type === 'window' ? 0.16 : (type === 'arch' || type === 'passage' ? 0.2 : 0.14),
        cell: 'C',
      });
      this._lastOpening = { placeId, linkId: link.id };
      this._compassSave(st);
    });
  }

  _fpPlaceVerticalFixture(placeId, cell) {
    const st = this._db();
    const type = this.container.querySelector('[data-role="fp-fixture-type"]')?.value || 'ascent';
    if (!isVerticalOpeningType(type)) return;
    const wall = type === 'descent' ? 'below' : 'above';
    this._compassTry(() => {
      const compass = ensureCompass(st);
      const link = ensureVerticalLink(compass, placeId, wall);
      addOpening(compass, placeId, link.id, {
        type,
        cell: cell || this._compassSelCell || 'C',
        along: 0.5,
        width: 0.2,
        travel: true,
        peer: false,
      });
      this._compassSelCell = cell || this._compassSelCell || 'C';
      this._compassSave(st);
    });
  }

  _clearAreaListSelection(list) {
    if (!list) return;
    list.querySelectorAll('.bst-area-list-item').forEach(el => el.classList.remove('on'));
    list.querySelectorAll('.bst-area-list-panel').forEach(panel => {
      if (panel.dataset.role === 'area-list-hint') {
        panel.hidden = false;
        return;
      }
      panel.hidden = true;
    });
  }

  _foldAreaListsOutside(e) {
    const lists = this.container?.querySelectorAll('[data-role="area-list"]');
    if (!lists?.length) return;
    for (const list of lists) {
      if (!list.querySelector('.bst-area-list-item.on')) continue;
      if (list.contains(e.target)) {
        const chip = e.target.closest('.bst-area-list-chip');
        const panel = e.target.closest('.bst-area-list-panel');
        if (chip || (panel && panel.dataset.role !== 'area-list-hint')) continue;
        this._clearAreaListSelection(list);
        continue;
      }
      this._clearAreaListSelection(list);
    }
  }

  _onClick(e) {
    if (this._suiteSkipClick) {
      this._suiteSkipClick = false;
      return;
    }
    this._foldAreaListsOutside(e);
    const act = e.target.closest('[data-action]');
    if (!act) return;
    if (act.closest('summary.bst-place-drawer-sum') && act.tagName === 'BUTTON') {
      e.preventDefault();
    }
    const action = act.dataset.action;
    const st = this._db();

    if (action === 'lobby') {
      this._door = '';
      return void this.render(this.container);
    }
    if (action === 'stage-hub') {
      this._door = 'stage';
      return void this.render(this.container);
    }
    if (action === 'open') {
      this._door = act.dataset.door || '';
      return void this.render(this.container);
    }
    if (action === 'director-check') return this._directorCheck();
    if (action === 'event-paper-open') return this._renderEventPaper();
    if (action === 'event-log-open') return this._openEventFromLog(Number(act.dataset.idx));
    if (action === 'event-log-clear') return this._clearEventLog();
    if (action === 'event-compose') return this._composeHolidayEvent();
    if (action === 'clear-orphan-tags') return this._clearOrphanTags();
    if (action === 'event-pitch') return this._pitchEventCast(act.dataset.uid);
    if (action === 'event-cue') return this._cueEventNow(act.dataset.uid);
    if (action === 'event-jump') return this._openEventJumpDialog(act.dataset.uid);
    if (action === 'event-pin') return this._toggleEventPin(act.dataset.uid);
    if (action === 'export-all') return this._exportProduction();
    if (action === 'export-selected') return this._exportSelected();
    if (action === 'import-all') {
      this.container.querySelector('[data-role="import-file"]')?.click();
      return;
    }
    if (action === 'export-tab') return this._exportBackstageChat();
    if (action === 'wipe') return this._wipe();
    if (action === 'note-flip') {
      if (!st.interview.active) return;
      const id = act.dataset.note || '';
      st.interview.flippedNote = st.interview.flippedNote === id ? '' : id;
      this.saveState();
      return void this.render(this.container);
    }
    if (action === 'note-ask' || action === 'note-ask-about') {
      if (!st.interview.active) return;
      return this._interviewNoteAsk(act.dataset.note, { about: action === 'note-ask-about' });
    }
    if (action === 'iv-send') {
      if (!st.interview.active) return;
      return this._interviewFree();
    }
    if (action === 'iv-retry') {
      const retry = st.interview.retry;
      if (!retry?.question) return;
      return this._interviewTurn(retry.question, retry.askKind || 'free', retry.meta || {}, { replay: true });
    }
    if (action === 'iv-retry-dismiss') {
      st.interview.retry = null;
      this.saveState();
      return void this.render(this.container);
    }
    if (action === 'iv-album-step' || action === 'iv-album-shuffle') {
      if (!st.interview.active) return;
      const dir = action === 'iv-album-shuffle' ? 1 : (Number(act.dataset.dir) || 1);
      const n = NOTECARDS.length;
      const next = (this._ivNoteIdx(st.interview) + dir + n) % n;
      st.interview.noteIdx = next;
      st.interview.flippedNote = NOTECARDS[next].id;
      this.saveState();
      return void this.render(this.container);
    }
    if (action === 'iv-anon') {
      if (st.interview.active) return;
      if (st.interview.interviewer === 'anonymous') {
        st.interview.interviewer = 'star';
        const star = getStarMember(this.storage);
        st.interview.interviewerId = star?.id || '';
      } else {
        st.interview.interviewer = 'anonymous';
        st.interview.interviewerId = '';
      }
      this.saveState();
      return void this.render(this.container);
    }
    if (action === 'interview-begin') {
      if (!st.interview.subjectId) {
        const first = getCastMembers(this.storage)
          .find(c => c.priority !== 'star' && c.priority !== 'director');
        if (!first) { alert('Add a cast card first.'); return; }
        st.interview.subjectId = first.id;
      }
      st.interview.active = true;
      st.interview.startedAt = Date.now();
      st.interview.turns = [];
      st.interview.noteIdx = 0;
      st.interview.flippedNote = NOTECARDS[0].id;
      st.interview.retry = null;
      this.saveState();
      return void this.render(this.container);
    }
    if (action === 'interview-end') {
      return this._endInterview({ save: true });
    }
    if (action === 'interview-discard') {
      if ((st.interview.turns || []).length
        && !confirm('End this interview without filing? The live desk will be wiped.')) return;
      return this._endInterview({ save: false });
    }
    if (action === 'interview-clear') {
      st.interview.turns = [];
      this.saveState();
      return void this.render(this.container);
    }
    if (action === 'listen') return this._listen();
    if (action === 'pg-toggle-focus') {
      st.peanut.focusChat = !st.peanut.focusChat;
      this.saveState();
      return void this.render(this.container);
    }
    if (action === 'pg-continue') return this._peanutContinue();
    if (action === 'pg-clear-topic') {
      const sessions = st.peanut.sessions || [];
      const active = sessions[this._pgActiveIdx(st)];
      if (!active) return;
      if (!confirm('Clear all comments on the active topic?')) return;
      active.comments = [];
      this.saveState();
      return void this.render(this.container);
    }
    if (action === 'pg-clear-all') {
      if (!(st.peanut.sessions || []).length) return;
      if (!confirm('Wipe every Peanut Gallery topic?')) return;
      st.peanut.sessions = [];
      st.peanut.activeIdx = -1;
      this.saveState();
      return void this.render(this.container);
    }
    if (action === 'pg-drop-comment') {
      const sessions = st.peanut.sessions || [];
      const active = sessions[this._pgActiveIdx(st)];
      const idx = Number(act.dataset.idx);
      if (!active?.comments?.[idx]) return;
      active.comments.splice(idx, 1);
      this.saveState();
      return void this.render(this.container);
    }
    if (action === 'pg-session') {
      const idx = Number(act.dataset.idx);
      const sessions = st.peanut.sessions || [];
      if (!sessions[idx]) return;
      // Just move the "viewing" pointer — do NOT reorder sessions, or every
      // tab click would silently scramble topic order and eviction age.
      st.peanut.activeIdx = idx;
      this.saveState();
      return void this.render(this.container);
    }
    if (action === 'set-sonar-check') {
      this._compassTry(() => {
        const compass = ensureCompass(st);
        this._runSonar(compass, { persist: true });
      });
      return void this.render(this.container);
    }
    if (action === 'sonar-pin' || action === 'sonar-follow') {
      const castId = act.dataset.cast || '';
      const member = this._sonarCast().find(m => String(m.id) === String(castId));
      if (!member) return;
      if (action === 'sonar-follow' && member.presence === 'absent') return;
      this._compassTry(() => {
        const compass = ensureCompass(st);
        if (action === 'sonar-follow') {
          pinSonarPing(compass, member, {
            placeId: compass.sonar?.pings?.[castId]?.placeId || '',
            cell: compass.sonar?.pings?.[castId]?.cell || 'C',
            locked: false,
          });
        } else {
          const row = this.container.querySelector(`.bst-sonar-cast[data-cast="${CSS.escape(castId)}"]`);
          const placeId = row?.querySelector('[data-role="sonar-place"]')?.value || '';
          const cell = row?.querySelector('[data-role="sonar-cell"]')?.value || 'C';
          pinSonarPing(compass, member, { placeId, cell, locked: true });
          if (placeId) {
            try {
              addOccupant(compass, placeId, { name: member.name, cell, castId: member.id, description: 'parked' });
            } catch { /* ignore */ }
          }
        }
        this._compassSave(st);
      });
      return void this.render(this.container);
    }
    if (action === 'sonar-view') {
      this._sonarView = act.dataset.view || 'all';
      this._applySonarFilter();
      return void this.render(this.container);
    }
    if (action === 'sonar-bulk') {
      const bulk = act.dataset.bulk || '';
      const rows = this._visibleSonarRows();
      const members = this._sonarCast();
      const bulkPlace = this.container.querySelector('[data-role="sonar-bulk-place"]')?.value || '';
      const bulkCell = this.container.querySelector('[data-role="sonar-bulk-cell"]')?.value || 'C';
      this._compassTry(() => {
        const compass = ensureCompass(st);
        const excluded = new Set((compass.sonar?.excludeIds || []).map(String));
        for (const row of rows) {
          const id = row.dataset.cast || '';
          const member = members.find(m => String(m.id) === String(id));
          if (!member) continue;
          if (bulk === 'include') setSonarExcluded(compass, id, false);
          else if (bulk === 'exclude') setSonarExcluded(compass, id, true);
          else if (bulk === 'park') {
            const placeId = row.querySelector('[data-role="sonar-place"]')?.value || '';
            const cell = row.querySelector('[data-role="sonar-cell"]')?.value || 'C';
            pinSonarPing(compass, member, { placeId, cell, locked: true });
            if (placeId) {
              try { addOccupant(compass, placeId, { name: member.name, cell, castId: member.id, description: 'parked' }); } catch { /* ignore */ }
            }
          } else if (bulk === 'follow') {
            if (member.presence === 'absent') continue;
            pinSonarPing(compass, member, {
              placeId: compass.sonar?.pings?.[id]?.placeId || '',
              cell: compass.sonar?.pings?.[id]?.cell || 'C',
              locked: false,
            });
          } else if (bulk === 'place') {
            if (excluded.has(id)) continue;
            pinSonarPing(compass, member, { placeId: bulkPlace, cell: bulkCell, locked: true });
            if (bulkPlace) {
              try { addOccupant(compass, bulkPlace, { name: member.name, cell: bulkCell, castId: member.id, description: 'parked' }); } catch { /* ignore */ }
            }
          }
        }
        this._compassSave(st);
      });
      return void this.render(this.container);
    }
    if (action === 'suite-opn-link') {
      const pick = this.container.querySelector('[data-role="suite-opn-pick"]')?.value || '';
      const toPlaceId = this.container.querySelector('[data-role="suite-opn-to"]')?.value || '';
      const [placeId, linkId] = pick.split('|');
      if (!placeId || !linkId) { alert('Pick an opening first.'); return; }
      if (!toPlaceId) { alert('Pick a room to link.'); return; }
      this._compassTry(() => {
        linkWallToRoom(ensureCompass(st), placeId, linkId, toPlaceId);
        this._lastOpening = { placeId, linkId };
        this._compassSave(st);
      });
      return;
    }
    if (action === 'set-audit') {
      return void this.render(this.container);
    }
    if (action === 'set-audit-fix') {
      this._compassTry(() => {
        const compass = ensureCompass(st);
        const { findings } = auditCompass(compass, {
          focusId: this._compassFocusId || compass.activeRoomId || '',
        });
        const n = applySafeAuditFixes(compass, findings);
        if (!n) {
          alert('No safe auto-fixes (only unlinked exterior doors/windows).');
          return;
        }
        this._compassSave(st);
      });
      return;
    }
    if (action === 'compass-create') {
      const id = this.container.querySelector('[data-role="room-id"]')?.value?.trim();
      const name = this.container.querySelector('[data-role="room-name"]')?.value?.trim() || id;
      const kind = this.container.querySelector('[data-role="place-kind"]')?.value || 'room';
      const parentId = this.container.querySelector('[data-role="place-parent"]')?.value || '';
      const locWrap = this.container.querySelector('.st-loctag-wrap[data-role="place-loctags"]');
      const locationTags = readLocationTags(locWrap);
      const description = this.container.querySelector('[data-role="place-desc"]')?.value?.trim() || '';
      if (!name && !id) { alert('Name or id is required.'); return; }
      this._compassTry(() => {
        const compass = ensureCompass(st);
        const room = createAndStoreRoom(compass, {
          id,
          name: name || id,
          kind,
          parentId,
          locationTags,
          description,
        });
        this._compassFocusId = room.id;
        if (isCompassPlaceKind(room.kind)) {
          loadRoom(compass, room.id);
        }
        this._compassSave(st);
      });
      return;
    }
    if (action === 'compass-focus') {
      this._compassFocusId = act.dataset.place || '';
      if (this._compassFocusId !== this._suiteHighlightChild) {
        // Keep highlight only while viewing that child's parent unit
        const place = getPlace(ensureCompass(st), this._compassFocusId);
        if (!isSuiteHostKind(place?.kind)) this._suiteHighlightChild = '';
      }
      return void this.render(this.container);
    }
    if (action === 'set-toggle-create') {
      this._setCreateOpen = !this._setCreateOpen;
      this._prodFolds ??= new Set();
      if (this._setCreateOpen) this._prodFolds.add('set-places');
      return void this.render(this.container);
    }
    if (action === 'set-open-place') {
      const placeId = act.dataset.place || '';
      const tag = String(act.dataset.tag || '').trim();
      if (placeId) {
        this._compassFocusId = placeId;
        this._openPlaceFloorplanIfNeeded(st, placeId);
        return void this.render(this.container);
      }
      if (act.dataset.unlisted === '1') {
        this._placesEditId = act.dataset.node || '';
        this._prodFolds ??= new Set();
        this._prodFolds.add('set-places');
        this._placesFold ??= new Set();
        this._placesFold.add('__unlisted');
        return void this.render(this.container);
      }
      let saved = false;
      this._compassTry(() => {
        const compass = ensureCompass(st);
        const existing = findPlaceForTag(compass, tag);
        if (existing) {
          this._compassFocusId = existing.id;
          return;
        }
        if (!tag) return;
        const room = createAndStoreRoom(compass, {
          name: tag,
          kind: 'room',
          locationTags: [tag],
        });
        this._compassFocusId = room.id;
        saved = true;
        this._compassSave(st);
      });
      if (!saved) return void this.render(this.container);
      return;
    }
    if (action === 'place-open-compass') {
      const placeId = act.dataset.place || '';
      if (!placeId) return;
      this._compassFocusId = placeId;
      this._openPlaceFloorplanIfNeeded(st, placeId, { force: true });
      return void this.render(this.container);
    }
    if (action === 'place-edit') {
      this._placesEditId = act.dataset.node || '';
      return void this.render(this.container);
    }
    if (action === 'place-edit-cancel') {
      this._placesEditId = '';
      return void this.render(this.container);
    }
    if (action === 'place-edit-save') {
      const wrap = act.closest('.bst-set-edit') || this.container.querySelector(`.bst-set-edit[data-node="${CSS.escape(act.dataset.node || '')}"]`);
      const placeId = act.dataset.place || wrap?.dataset.place || '';
      const oldTag = String(act.dataset.tag || wrap?.dataset.tag || '').trim();
      const name = String(wrap?.querySelector('[data-role="place-edit-name"]')?.value || '').trim() || oldTag;
      const kindRaw = String(wrap?.querySelector('[data-role="place-edit-kind"]')?.value || '').trim();
      const kind = PLACE_KIND_SET.has(kindRaw) ? kindRaw : (GROUP_TO_COMPASS[kindRaw] || '');
      const aliases = String(wrap?.querySelector('[data-role="place-edit-aliases"]')?.value || '')
        .split(/[,;\n]/).map(s => s.trim()).filter(Boolean);
      this._compassTry(() => {
        const compass = ensureCompass(st);
        const allow = PLACE_NEST_PARENTS[kind] || [];
        let parentId = String(wrap?.querySelector('[data-role="place-edit-parent"]')?.value || '').trim();
        const parent = parentId ? compass.rooms[parentId] : null;
        if (!allow.length || !parent || !allow.includes(parent.kind)) parentId = '';
        const rowName = name || oldTag;
        let id = '';
        if (placeId && compass.rooms[placeId]
          && String(compass.rooms[placeId].name || '').trim().toLowerCase() === rowName.toLowerCase()) {
          id = placeId;
        } else {
          id = findPlaceByExactName(compass, rowName)?.id
            || findPlaceByExactName(compass, oldTag)?.id
            || '';
        }
        if (id && parentId === id) parentId = '';
        if (!id && kind && name) {
          const room = createAndStoreRoom(compass, {
            name,
            kind,
            parentId,
            locationTags: [name],
            aliases,
          });
          id = room.id;
          this._compassFocusId = room.id;
        }
        if (id) {
          if (name) renamePlace(compass, id, name);
          if (kind) setPlaceKind(compass, id, kind);
          setParent(compass, id, parentId);
          setPlaceAliases(compass, id, aliases);
        } else if (oldTag) {
          const node = findLocationNodeByName(this.storage, oldTag);
          if (node) {
            node.name = name || node.name;
            node.kind = '';
            node.parentId = '';
          }
        }
        const catalogKind = COMPASS_TO_GROUP[kind] || '';
        if (kind && name && id) {
          const parentCat = parentId
            ? findLocationNodeByName(this.storage, compass.rooms[parentId]?.name)
            : null;
          upsertLocationNode(this.storage, {
            name,
            kind: catalogKind,
            parentId: parentCat?.id || '',
            placeId: id,
          });
        }
        try { pruneGhostLocationNodes(this.storage, compass); } catch { /* ignore */ }
        try {
          forgetUnlisted(compass, name);
          if (oldTag) forgetUnlisted(compass, oldTag);
          dropMatchedUnlisted(compass, this.storage);
        } catch { /* ignore */ }
        this._placesEditId = '';
        this._compassSave(st);
      });
      return;
    }
    if (action === 'place-unlisted-dismiss') {
      const tag = String(act.dataset.tag || act.closest('.bst-set-edit')?.dataset.tag || '').trim();
      if (!tag) return;
      this._compassTry(() => {
        const compass = ensureCompass(st);
        dismissUnlisted(compass, tag);
        this._placesEditId = '';
        this._compassSave(st);
      });
      return;
    }
    if (action === 'place-edit-remove') {
      const wrap = act.closest('.bst-set-edit') || this.container.querySelector(`.bst-set-edit[data-node="${CSS.escape(act.dataset.node || '')}"]`);
      const placeId = act.dataset.place || wrap?.dataset.place || '';
      const nodeId = act.dataset.node || wrap?.dataset.node || '';
      const tag = String(act.dataset.tag || wrap?.dataset.tag || '').trim();
      const label = tag || 'this location';
      if (!confirm(`Remove "${label}" and every Script / Library / Compass tag that names it?\n\nNested places stay and move up one level.`)) return;
      this._compassTry(() => {
        const compass = ensureCompass(st);
        const ident = collectLocationIdentity(this.storage, compass, { placeId, nodeId, name: tag });
        const id = placeId || ident.place?.id || '';
        if (id && compass.rooms[id]) {
          deletePlace(compass, id, { reparent: true });
          if (this._compassFocusId === id) this._compassFocusId = '';
        }
        rewriteLocationTagNames(this.storage, compass, { removeKeys: ident.keys });
        const catNode = ident.node || findLocationNodeById(this.storage, nodeId)
          || findLocationNodeByPlaceId(this.storage, id)
          || findLocationNodeByName(this.storage, tag);
        if (catNode) removeLocationNode(this.storage, catNode.id);
        this._placesEditId = '';
        this.storage.saveChat();
        this._compassSave(st);
      });
      return;
    }
    if (action === 'place-edit-merge') {
      const wrap = act.closest('.bst-set-edit') || this.container.querySelector(`.bst-set-edit[data-node="${CSS.escape(act.dataset.node || '')}"]`);
      const placeId = act.dataset.place || wrap?.dataset.place || '';
      const nodeId = act.dataset.node || wrap?.dataset.node || '';
      const tag = String(act.dataset.tag || wrap?.dataset.tag || '').trim();
      const raw = String(wrap?.querySelector('[data-role="place-edit-merge"]')?.value || '').trim();
      if (!raw) { alert('Pick a location to merge into.'); return; }
      this._compassTry(() => {
        const compass = ensureCompass(st);
        let targetPlaceId = raw.startsWith('place:') ? raw.slice(6) : '';
        let targetNodeId = raw.startsWith('node:') ? raw.slice(5) : '';
        if (targetPlaceId) {
          const byPlace = findLocationNodeByPlaceId(this.storage, targetPlaceId);
          if (byPlace) targetNodeId = byPlace.id;
        } else if (targetNodeId) {
          const tNode = findLocationNodeById(this.storage, targetNodeId);
          targetPlaceId = tNode?.placeId || findPlaceForTag(compass, tNode?.name)?.id || '';
        }
        const targetPlace = targetPlaceId ? compass.rooms[targetPlaceId] : null;
        const targetNode = targetNodeId
          ? findLocationNodeById(this.storage, targetNodeId)
          : (targetPlace ? findLocationNodeByPlaceId(this.storage, targetPlace.id) || findLocationNodeByName(this.storage, targetPlace.name) : null);
        const destName = String(targetPlace?.name || targetNode?.name || '').trim();
        if (!destName) throw new Error('Pick a location to merge into.');
        const ident = collectLocationIdentity(this.storage, compass, { placeId, nodeId, name: tag });
        const sourceId = placeId || ident.place?.id || '';
        if ((sourceId && targetPlaceId && sourceId === targetPlaceId)
          || (ident.node && targetNode && ident.node.id === targetNode.id)) {
          throw new Error('Cannot merge a place into itself.');
        }
        if (!confirm(`Merge "${tag || ident.names[0] || 'this location'}" into "${destName}"?\n\nTags, aliases, and nested places move to ${destName}.`)) return;
        let destId = targetPlaceId;
        if (!destId && targetNode) {
          const kind = GROUP_TO_COMPASS[targetNode.kind] || 'room';
          const room = createAndStoreRoom(compass, {
            name: destName,
            kind,
            locationTags: [destName],
          });
          destId = room.id;
          targetNode.placeId = destId;
        }
        if (sourceId && destId && sourceId !== destId && compass.rooms[sourceId]) {
          mergePlaces(compass, sourceId, destId);
          if (this._compassFocusId === sourceId) this._compassFocusId = destId;
        } else if (destId && ident.names.length) {
          const dest = compass.rooms[destId];
          if (dest) {
            const aliases = [...(dest.aliases || [])];
            for (const n of ident.names) {
              if (n.toLowerCase() === destName.toLowerCase()) continue;
              if (!aliases.some(a => String(a).toLowerCase() === n.toLowerCase())) aliases.push(n);
            }
            dest.aliases = aliases;
          }
        }
        rewriteLocationTagNames(this.storage, compass, {
          removeKeys: ident.keys,
          replaceWith: destName,
          skipAliasPlaceIds: destId ? [destId] : [],
        });
        const destNode = targetNode
          || findLocationNodeByPlaceId(this.storage, destId)
          || findLocationNodeByName(this.storage, destName);
        const srcNode = ident.node || findLocationNodeById(this.storage, nodeId)
          || findLocationNodeByPlaceId(this.storage, sourceId)
          || findLocationNodeByName(this.storage, tag);
        if (srcNode && destNode && srcNode.id !== destNode.id) {
          mergeLocationNodes(this.storage, srcNode.id, destNode.id);
          destNode.placeId = destId || destNode.placeId;
        } else if (srcNode && !destNode) {
          srcNode.placeId = destId || srcNode.placeId;
          if (destName) srcNode.name = destName;
        } else if (srcNode && destNode && srcNode.id === destNode.id) {
          destNode.placeId = destId || destNode.placeId;
        }
        this._placesEditId = '';
        this.storage.saveChat();
        this._compassSave(st);
      });
      return;
    }
    if (action === 'suite-mode') {
      const mode = act.dataset.mode || 'browse';
      this._suiteMode = ['arrange', 'walls', 'fixtures'].includes(mode) ? mode : 'browse';
      return void this.render(this.container);
    }
    if (action === 'suite-story-focus') {
      this._suiteStoryFocus = act.dataset.focus === 'lower' ? 'lower' : 'upper';
      if (act.dataset.unit) this._compassFocusId = act.dataset.unit;
      return void this.render(this.container);
    }
    if (action === 'suite-fixture-act') {
      const next = act.dataset.act === 'remove' ? 'remove' : 'place';
      this._suiteFixtureAct = this._suiteFixtureAct === next ? '' : next;
      this._suiteMode = 'fixtures';
      return void this.render(this.container);
    }
    if (action === 'suite-place-fixture') {
      if ((this._suiteMode || 'browse') !== 'fixtures' || this._suiteFixtureAct !== 'place') return;
      return void this._suitePlaceFixtureOnEdge(act.dataset.place, Number(act.dataset.edge), e);
    }
    if (action === 'suite-focus-child') {
      this._suiteHighlightChild = act.dataset.place || '';
      const unitId = act.dataset.unit || '';
      if (unitId) this._compassFocusId = unitId;
      return void this.render(this.container);
    }
    if (action === 'suite-open-child') {
      this._compassFocusId = act.dataset.place || '';
      this._suiteHighlightChild = '';
      return void this.render(this.container);
    }
    if (action === 'set-here') {
      return void this._establishLocation({
        placeId: act.dataset.place || '',
        cell: act.dataset.cell || this._compassSelCell || 'C',
      });
    }
    if (action === 'suite-select-shared') {
      this._suiteMode = 'walls';
      this._suiteSelShared = {
        aId: act.dataset.a || '',
        bId: act.dataset.b || '',
        wallA: act.dataset.wallA || '',
        wallB: act.dataset.wallB || '',
      };
      return void this.render(this.container);
    }
    if (action === 'suite-shared-style') {
      const sel = this._suiteSelShared;
      const style = act.dataset.style === 'threshold' ? 'threshold' : 'merged';
      const unitId = act.dataset.unit || '';
      if (sel?.aId && sel?.bId && style === 'merged') {
        const compass = ensureCompass(st);
        const keepPref = this._suiteHighlightChild;
        const keepId = keepPref === sel.bId || keepPref === sel.aId ? keepPref : sel.aId;
        const dropId = keepId === sel.aId ? sel.bId : sel.aId;
        const keepName = getPlace(compass, keepId)?.name || keepId;
        const dropName = getPlace(compass, dropId)?.name || dropId;
        if (!confirm(`Merge "${dropName}" into "${keepName}"?\n\nThey become one room with one arrange handle. "${dropName}" is kept as an alias.`)) return;
        const ident = collectLocationIdentity(this.storage, compass, { placeId: dropId, name: dropName });
        this._compassTry(() => {
          const fused = fuseSuiteRoomsAlongWall(ensureCompass(st), unitId, sel.aId, sel.bId, keepId);
          const destId = fused?.id || keepId;
          rewriteLocationTagNames(this.storage, ensureCompass(st), {
            removeKeys: ident.keys,
            replaceWith: keepName,
            skipAliasPlaceIds: destId ? [destId] : [],
          });
          const srcNode = ident.node || findLocationNodeByPlaceId(this.storage, dropId)
            || findLocationNodeByName(this.storage, dropName);
          const destNode = findLocationNodeByPlaceId(this.storage, destId)
            || findLocationNodeByName(this.storage, keepName);
          if (srcNode && destNode && srcNode.id !== destNode.id) {
            mergeLocationNodes(this.storage, srcNode.id, destNode.id);
            destNode.placeId = destId || destNode.placeId;
          } else if (srcNode && !destNode) {
            srcNode.placeId = destId || srcNode.placeId;
            if (keepName) srcNode.name = keepName;
          }
          this._suiteSelShared = null;
          this._suiteSelEdge = null;
          this._suiteSelEdges = [];
          this._suiteHighlightChild = destId;
          if (this._compassFocusId === dropId) this._compassFocusId = destId;
          this.storage.saveChat();
          this._compassSave(st);
        });
        return;
      }
      if (sel?.aId && sel?.bId) {
        this._compassTry(() => {
          const compass = ensureCompass(st);
          setSharedWallStyle(compass, sel.aId, sel.bId, sel.wallA, sel.wallB, style);
          this._compassSave(st);
        });
        return;
      }
      const edge = this._suiteSelEdge;
      if (style === 'threshold' && edge?.placeId && Number.isFinite(Number(edge.edge))) {
        this._compassTry(() => {
          const compass = ensureCompass(st);
          pushSuiteHistory(compass, unitId || edge.placeId, 'threshold');
          addLink(compass, edge.placeId, {
            edge: Number(edge.edge),
            external: true,
            description: 'exterior threshold',
          });
          this._compassSave(st);
        });
        return;
      }
      alert('Select a shared wall first.');
      return;
    }
    if (action === 'suite-delete-shared') {
      const sel = this._suiteSelShared;
      if (!sel?.aId || !sel?.bId) { alert('Select an interior shared wall first.'); return; }
      this._compassTry(() => {
        deleteInteriorSharedWall(ensureCompass(st), sel.aId, sel.bId, sel.wallA, sel.wallB);
        this._suiteSelShared = null;
        this._compassSave(st);
      });
      return;
    }
    if (action === 'suite-undo') {
      const unitId = act.dataset.unit || '';
      if (!unitId) return;
      this._compassTry(() => {
        undoSuiteLastChange(ensureCompass(st), unitId);
        this._suiteSelShared = null;
        this._suiteSelEdge = null;
        this._suiteSelEdges = [];
        this._compassSave(st);
      });
      return;
    }
    if (action === 'suite-restore-wall') {
      const sel = this._suiteSelShared;
      const edge = this._suiteSelEdge;
      this._compassTry(() => {
        restoreSuiteWall(ensureCompass(st), {
          aId: sel?.aId || act.dataset.a || '',
          bId: sel?.bId || act.dataset.b || '',
          wallA: sel?.wallA || act.dataset.wallA || '',
          wallB: sel?.wallB || act.dataset.wallB || '',
          placeId: edge?.placeId || act.dataset.place || '',
          edge: Number.isFinite(Number(edge?.edge)) ? Number(edge.edge) : act.dataset.edge,
        });
        this._compassSave(st);
      });
      return;
    }
    if (action === 'suite-join-segment') {
      const placeId = act.dataset.place || this._suiteSelEdge?.placeId || this._suiteSelEdges?.[0]?.placeId || '';
      const edge = Number.isFinite(Number(act.dataset.edge))
        ? Number(act.dataset.edge)
        : (this._suiteSelEdge?.edge ?? this._suiteSelEdges?.[0]?.edge);
      if (!placeId || !Number.isFinite(Number(edge))) {
        alert('Click a leftover split segment first.');
        return;
      }
      this._compassTry(() => {
        joinCollinearSuiteVertex(ensureCompass(st), placeId, edge);
        this._compassSave(st);
      });
      return;
    }
    if (action === 'suite-clean-vertices') {
      const placeId = act.dataset.place || this._suiteSelEdge?.placeId || this._suiteHighlightChild || '';
      if (!placeId) { alert('Click a room (or one of its walls) first.'); return; }
      this._compassTry(() => {
        simplifySuiteRoomFootprint(ensureCompass(st), placeId);
        this._compassSave(st);
      });
      return;
    }
    if (action === 'suite-split-corners') {
      const unitId = act.dataset.unit || '';
      if (!unitId) return;
      this._compassTry(() => {
        const n = insertSuiteCornerVertices(ensureCompass(st), unitId);
        this._compassSave(st);
        if (!n) alert('No corners sitting on another wall — nudge rooms so a corner meets a face, then try again.');
      });
      return;
    }
    if (action === 'suite-align') {
      const unitId = act.dataset.unit || '';
      if (!unitId) return;
      this._compassTry(() => {
        alignSuiteWalls(ensureCompass(st), unitId);
        this._compassSave(st);
      });
      return;
    }
    if (action === 'suite-align-reset') {
      const unitId = act.dataset.unit || '';
      if (!unitId) return;
      this._compassTry(() => {
        clearSuiteVisualAlign(ensureCompass(st), unitId);
        this._compassSave(st);
      });
      return;
    }
    if (action === 'suite-select-face') {
      const edges = this._suiteSelEdges || [];
      if (!edges.length) { alert('Click a wall first.'); return; }
      const unitId = act.dataset.unit || '';
      const compass = ensureCompass(st);
      const unit = getPlace(compass, unitId);
      const room = getPlace(compass, edges[0].placeId);
      if (!unit || !room) return;
      const pose = normalizeSuitePose(unit.suiteLayout?.[room.id] || { x: 0, y: 0, rot: 0 });
      const face = facingEdges(room, pose, edges[0].edge);
      this._suiteSelEdges = face.map(e => ({ placeId: room.id, edge: e }));
      this._suiteSelEdge = { placeId: room.id, edge: edges[0].edge };
      this._suiteMode = 'walls';
      return void this.render(this.container);
    }
    if (action === 'suite-divide-room') {
      const edges = this._suiteSelEdges || [];
      if (edges.length !== 2 || edges[0].placeId !== edges[1].placeId) {
        alert('Click (not drag) exactly 2 walls on the same room first.');
        return;
      }
      const placeId = edges[0].placeId;
      this._compassTry(() => {
        const compass = ensureCompass(st);
        const { roomB } = divideRoom(compass, placeId, edges[0].edge, 0.5, edges[1].edge, 0.5);
        this._suiteSelEdges = [];
        this._suiteSelEdge = null;
        this._suiteHighlightChild = roomB?.id || '';
        this._compassSave(st);
      });
      return;
    }
    if (action === 'suite-wl-add-link') {
      const placeId = act.dataset.place || '';
      const edge = Number(act.dataset.edge);
      const toPlaceId = this.container.querySelector('[data-role="suite-wl-link-to"]')?.value || '';
      const description = this.container.querySelector('[data-role="suite-wl-link-desc"]')?.value?.trim() || '';
      if (!placeId || !Number.isFinite(edge)) return;
      if (!toPlaceId) { alert('Pick a neighbor room first.'); return; }
      this._compassTry(() => {
        addLink(ensureCompass(st), placeId, { edge, toPlaceId, description });
        this._compassSave(st);
      });
      return;
    }
    if (action === 'suite-wl-mark-external') {
      const placeId = act.dataset.place || '';
      const edge = Number(act.dataset.edge);
      const description = this.container.querySelector('[data-role="suite-wl-link-desc"]')?.value?.trim() || '';
      if (!placeId || !Number.isFinite(edge)) return;
      this._compassTry(() => {
        addLink(ensureCompass(st), placeId, { edge, external: true, description });
        this._compassSave(st);
      });
      return;
    }
    if (action === 'suite-wl-toggle-external') {
      const on = act.dataset.on !== '0';
      this._compassTry(() => {
        setLinkExternal(ensureCompass(st), act.dataset.place, act.dataset.link, on);
        this._compassSave(st);
      });
      return;
    }
    if (action === 'suite-wl-add-opening') {
      const placeId = act.dataset.place || '';
      const compass = ensureCompass(st);
      const room = getPlace(compass, placeId);
      const link = (room?.links || []).find(l => l.id === act.dataset.link);
      if (!room || !link) return;
      openOpeningDialog({
        room,
        compass,
        link,
        existing: null,
        onSave: (payload) => {
          this._compassTry(() => {
            const compass = ensureCompass(st);
            const lid = payload.linkId || link.id;
            addOpening(compass, placeId, lid, payload);
            if (payload.toPlaceId) linkWallToRoom(compass, placeId, lid, payload.toPlaceId);
            this._lastOpening = { placeId, linkId: lid };
            this._compassSave(st);
          });
        },
      });
      return;
    }
    if (action === 'suite-wl-remove-link') {
      this._compassTry(() => {
        removeLink(ensureCompass(st), act.dataset.place, act.dataset.link);
        this._compassSave(st);
      });
      return;
    }
    if (action === 'compass-view-parent') {
      const parentId = act.dataset.parent || '';
      const childId = act.dataset.place || '';
      if (!parentId) return;
      this._suiteHighlightChild = childId;
      this._compassFocusId = parentId;
      this._suiteMode = ['arrange', 'walls', 'fixtures'].includes(this._suiteMode) ? this._suiteMode : 'browse';
      return void this.render(this.container);
    }
    if (action === 'compass-edit-cell') {
      const placeId = act.dataset.place;
      const cell = act.dataset.cell || 'C';
      this._compassSelCell = cell;
      this._compassFocusId = placeId;
      const compass = ensureCompass(st);
      const room = getPlace(compass, placeId);
      if (!room) return;
      const castMembers = [
        getStarMember(this.storage),
        ...getCastMembers(this.storage).filter(c => c.priority !== 'director'),
      ].filter(Boolean);
      // Dedupe by id/name
      const seen = new Set();
      const cast = castMembers.filter(m => {
        const key = m.id || m.name;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      openCellDialog({
        room,
        compass,
        cell,
        castMembers: cast.map(m => ({ id: m.id || m.name, name: m.name })),
        handlers: {
          addPiece: (cells, layer, piece) => {
            const list = Array.isArray(cells) ? cells : [cells];
            this._compassTry(() => {
              const compass = ensureCompass(st);
              if (layer === 'furniture' || layer === 'fixtures') {
                const anchor = list[0] || 'C';
                addItem(compass, placeId, {
                  cell: anchor,
                  layer,
                  ...piece,
                  cells: list,
                });
              } else {
                for (const cellId of list) {
                  addItem(compass, placeId, { cell: cellId, layer, ...piece });
                }
              }
              this._compassSave(st);
            });
          },
          updatePiece: (cellId, layer, itemId, piece) => {
            this._compassTry(() => {
              updateItem(ensureCompass(st), placeId, { itemId, cell: cellId, layer, patch: piece });
              this._compassSave(st);
            });
          },
          removePiece: (cellId, layer, itemId) => {
            this._compassTry(() => {
              sendItemToLostAndFound(ensureCompass(st), placeId, { itemId, cell: cellId, layer });
              this._compassSave(st);
            });
          },
          pickupPiece: (cellId, layer, itemId) => {
            this._compassTry(() => {
              const taken = pickupItem(ensureCompass(st), placeId, { itemId, cell: cellId, layer });
              addPickupToInventory(this.storage, taken, this.bus);
              this._compassSave(st);
            });
          },
          addOccupant: (cellId, { name, castId, description }) => {
            this._compassTry(() => {
              addOccupant(ensureCompass(st), placeId, { name, cell: cellId, castId, description });
              this._compassSave(st);
            });
          },
          removeOccupant: (name) => {
            this._compassTry(() => {
              removeOccupant(ensureCompass(st), placeId, { name });
              this._compassSave(st);
            });
          },
          faceOccupant: (name, facing) => {
            this._compassTry(() => {
              faceOccupant(ensureCompass(st), placeId, { name, facing });
              this._compassSave(st);
            });
          },
          moveOccupant: (name, cell) => {
            this._compassTry(() => {
              moveOccupant(ensureCompass(st), placeId, { name, cell });
              this._compassSave(st);
            });
          },
          addOpening: (payload) => {
            this._compassTry(() => {
              const compass = ensureCompass(st);
              addOpening(compass, placeId, payload.linkId, payload);
              if (payload.toPlaceId) linkWallToRoom(compass, placeId, payload.linkId, payload.toPlaceId);
              this._lastOpening = { placeId, linkId: payload.linkId };
              this._compassSave(st);
            });
          },
          updateOpening: (linkId, openingId, patch) => {
            this._compassTry(() => {
              const compass = ensureCompass(st);
              updateOpening(compass, placeId, linkId, openingId, patch);
              if (patch.toPlaceId) linkWallToRoom(compass, placeId, linkId, patch.toPlaceId);
              this._lastOpening = { placeId, linkId };
              this._compassSave(st);
            });
          },
          removeOpening: (linkId, openingId) => {
            this._compassTry(() => {
              removeOpening(ensureCompass(st), placeId, linkId, openingId);
              this._compassSave(st);
            });
          },
        },
      });
      return;
    }
    if (action === 'area-list-select') {
      const list = act.closest('[data-role="area-list"]');
      if (!list) return;
      const id = act.dataset.id || '';
      const item = [...list.querySelectorAll('.bst-area-list-item')].find(el => el.dataset.id === id);
      if (item?.classList.contains('on')) {
        this._clearAreaListSelection(list);
        return;
      }
      list.querySelectorAll('.bst-area-list-item').forEach(el => {
        el.classList.toggle('on', el.dataset.id === id);
      });
      list.querySelectorAll('.bst-area-list-panel').forEach(panel => {
        if (panel.dataset.role === 'area-list-hint') {
          panel.hidden = !!id;
          return;
        }
        panel.hidden = panel.dataset.for !== id;
      });
      return;
    }
    if (action === 'compass-select-area') {
      this._compassSelCell = act.dataset.cell || 'C';
      this._compassFocusId = act.dataset.place || this._compassFocusId;
      return void this.render(this.container);
    }
    if (action === 'placement-focus') {
      const placeId = this.container.querySelector('[data-role="placement-place"]')?.value || '';
      if (!placeId) { alert('Pick a room, hall, or building exterior.'); return; }
      this._compassFocusId = placeId;
      this._povPreviewText = '';
      return void this.render(this.container);
    }
    if (action === 'placement-pov') {
      const placeId = act.dataset.place || this._compassFocusId;
      const facing = this.container.querySelector('[data-role="pov-facing"]')?.value || 'N';
      const area = this._compassSelCell || 'C';
      this._povFacing = facing;
      const compass = ensureCompass(st);
      this._povPreviewText = buildPlacementPovPreview(compass, placeId, {
        cell: area,
        facing,
        sonarReach: normalizeTrackers(st.trackers).location?.sonarReach || 'adjacent',
      });
      return void this.render(this.container);
    }
    if (action === 'placement-edit-piece') {
      const placeId = act.dataset.place;
      const cellId = act.dataset.cell || 'C';
      const layer = act.dataset.layer;
      const itemId = act.dataset.id;
      const compass = ensureCompass(st);
      const room = getPlace(compass, placeId);
      if (!room) return;
      let existing = (room.cells?.[cellId]?.[layer] || []).find(x => x.id === itemId);
      if (!existing && layer === 'furniture') {
        for (const bag of Object.values(room.cells || {})) {
          existing = (bag.furniture || []).find(x => x.id === itemId);
          if (existing) break;
        }
      }
      if (!existing) return;
      const open = layer === 'furniture' ? openFurnitureDialog : openPieceDialog;
      open({
        layer,
        existing,
        defaultCells: existing.cells?.length ? existing.cells : [cellId],
        onSave: (piece) => {
          this._compassTry(() => {
            updateItem(ensureCompass(st), placeId, {
              itemId,
              cell: existing.anchor || cellId,
              layer,
              patch: piece,
            });
            this._compassSave(st);
          });
        },
        onDelete: () => {
          this._compassTry(() => {
            sendItemToLostAndFound(ensureCompass(st), placeId, {
              itemId,
              cell: existing.anchor || cellId,
              layer,
            });
            this._compassSave(st);
          });
        },
      });
      return;
    }
    if (action === 'placement-del-piece') {
      if (!confirm('Send this piece to Lost & Found?')) return;
      this._compassTry(() => {
        sendItemToLostAndFound(ensureCompass(st), act.dataset.place, {
          itemId: act.dataset.id,
          cell: act.dataset.cell,
          layer: act.dataset.layer,
        });
        this._compassSave(st);
      });
      return;
    }
    if (action === 'lost-place') {
      const placeId = act.dataset.place;
      const cell = act.dataset.cell || this._compassSelCell || 'C';
      this._compassTry(() => {
        placeFromLostAndFound(ensureCompass(st), placeId, {
          itemId: act.dataset.id,
          cell,
          layer: act.dataset.layer,
        });
        this._compassSave(st);
      });
      return;
    }
    if (action === 'lost-destroy') {
      if (!confirm('Permanently destroy this Lost & Found item?')) return;
      this._compassTry(() => {
        removeFromLostAndFound(ensureCompass(st), act.dataset.id);
        this._compassSave(st);
      });
      return;
    }
    if (action === 'lost-add') {
      const name = prompt('Lost & Found item name?');
      if (!name?.trim()) return;
      this._compassTry(() => {
        addToLostAndFound(ensureCompass(st), { name: name.trim() }, { layer: 'clutter' });
        this._compassSave(st);
      });
      return;
    }
    if (action === 'compass-toggle-wall') {
      act.classList.toggle('on');
      return;
    }
    if (action === 'compass-select-edge') {
      // Selection / wall-drag handled in _bindFloorplanDrag
      return;
    }
    if (action === 'compass-set-desc') {
      const place = act.dataset.place;
      const description = this.container.querySelector('[data-role="focus-desc"]')?.value || '';
      this._compassTry(() => {
        setPlaceDescription(ensureCompass(st), place, description);
        this._compassSave(st);
      });
      return;
    }
    if (action === 'fp-zoom-in') {
      this._fpSetZoom(this._fpZoomValue() * 1.2);
      return;
    }
    if (action === 'fp-zoom-out') {
      this._fpSetZoom(this._fpZoomValue() / 1.2);
      return;
    }
    if (action === 'fp-zoom-reset' || action === 'fp-center') {
      this._fpZoom = 1;
      this._fpPan = null;
      this._fpApplyView();
      return;
    }
    if (action === 'compass-place-vertical') {
      if ((this._fpMode || 'move') !== 'fixtures' || this._fpFixtureAct !== 'place') return;
      return void this._fpPlaceVerticalFixture(act.dataset.place, act.dataset.cell);
    }
    if (action === 'fp-set-mode') {
      const mode = act.dataset.mode || 'move';
      this._fpMode = ['move', 'walls', 'fixtures', 'verts'].includes(mode) ? mode : 'move';
      if (this._fpMode === 'fixtures' && this._fpFixtureAct !== 'place' && this._fpFixtureAct !== 'remove') {
        this._fpFixtureAct = '';
      }
      return void this.render(this.container);
    }
    if (action === 'fp-fixture-act') {
      const next = act.dataset.act === 'remove' ? 'remove' : 'place';
      this._fpFixtureAct = this._fpFixtureAct === next ? '' : next;
      this._fpMode = 'fixtures';
      return void this.render(this.container);
    }
    if (action === 'compass-barrier-del') {
      const placeId = act.dataset.place;
      const wallId = act.dataset.wall;
      if (!confirm('Remove this internal wall?')) return;
      this._compassTry(() => {
        removeInternalWall(ensureCompass(st), placeId, wallId);
        this._compassSave(st);
      });
      return;
    }
    if (action === 'compass-draw-wall-surface') {
      // Drawing handled in _bindFloorplanDrag
      return;
    }
    if (action === 'compass-fp-reset') {
      this._compassTry(() => {
        setFootprint(ensureCompass(st), act.dataset.place, resetFootprintRectangle());
        this._compassSelEdges = new Set();
        this._compassSave(st);
      });
      return;
    }
    if (action === 'compass-fp-add-vert') {
      const edges = [...(this._compassSelEdges || [])];
      if (!edges.length) { alert('Select a wall first.'); return; }
      const edge = Number(edges[0]);
      this._compassTry(() => {
        insertFootprintVertex(ensureCompass(st), act.dataset.place, edge, 0.5);
        this._compassSelEdges = new Set();
        this._compassSave(st);
      });
      return;
    }
    if (action === 'compass-fp-scale') {
      const placeId = act.dataset.place;
      const gridEl = this.container.querySelector(`[data-role="fp-grid"][data-place="${placeId}"]`);
      const unitEl = this.container.querySelector(`[data-role="fp-unit"][data-place="${placeId}"]`);
      const grid = Math.max(2, Math.min(24, Math.floor(Number(gridEl?.value) || 8)));
      const unitPerGrid = Math.max(0.25, Number(unitEl?.value) || 1);
      this._compassTry(() => {
        const compass = ensureCompass(st);
        const room = getPlace(compass, placeId);
        setFootprint(compass, placeId, normalizeFootprint({
          ...(room.footprint || {}),
          grid,
          unitPerGrid,
        }));
        this._compassSave(st);
      });
      return;
    }
    if (action === 'compass-drag-vert' || action === 'compass-drag-opening') {
      // Pointer drag handled in _bindFloorplanDrag
      return;
    }
    if (action === 'compass-edit-opening') {
      const placeId = act.dataset.place;
      const compass = ensureCompass(st);
      const room = getPlace(compass, placeId);
      const link = (room?.links || []).find(l => l.id === act.dataset.link);
      const op = link?.openings?.find(o => o.id === act.dataset.opn);
      if (!room || !link || !op) return;
      openOpeningDialog({
        room,
        compass,
        link,
        existing: op,
        onSave: (patch) => {
          this._compassTry(() => {
            updateOpening(ensureCompass(st), placeId, link.id, op.id, patch);
            this._compassSave(st);
          });
        },
        onDelete: () => {
          this._compassTry(() => {
            removeOpening(ensureCompass(st), placeId, link.id, op.id);
            this._compassSave(st);
          });
        },
      });
      return;
    }
    if (action === 'compass-add-opn-wall') {
      const placeId = act.dataset.place;
      const compass = ensureCompass(st);
      const room = getPlace(compass, placeId);
      const link = (room?.links || []).find(l => l.id === act.dataset.link);
      if (!room || !link) return;
      openOpeningDialog({
        room,
        compass,
        link,
        existing: null,
        defaultCell: this._compassSelCell || 'C',
        onSave: (payload) => {
          this._compassTry(() => {
            const compass = ensureCompass(st);
            const lid = payload.linkId || link.id;
            addOpening(compass, placeId, lid, payload);
            if (payload.toPlaceId) linkWallToRoom(compass, placeId, lid, payload.toPlaceId);
            this._lastOpening = { placeId, linkId: lid };
            this._compassSave(st);
          });
        },
      });
      return;
    }
    if (action === 'compass-load') {
      const id = act.dataset.room;
      this._compassTry(() => {
        loadRoom(ensureCompass(st), id);
        this._compassFocusId = id;
        this._compassSave(st);
      });
      return;
    }
    if (action === 'compass-unload') {
      unloadRoom(ensureCompass(st));
      this._compassSave(st);
      return;
    }
    if (action === 'compass-refresh') {
      return void this.render(this.container);
    }
    if (action === 'compass-rename') {
      const place = act.dataset.place;
      const name = this.container.querySelector('[data-role="focus-name"]')?.value?.trim();
      this._compassTry(() => {
        renamePlace(ensureCompass(st), place, name);
        this._compassSave(st);
      });
      return;
    }
    if (action === 'compass-set-kind') {
      const place = act.dataset.place;
      const kind = this.container.querySelector('[data-role="focus-kind"]')?.value;
      this._compassTry(() => {
        setPlaceKind(ensureCompass(st), place, kind);
        this._compassSave(st);
      });
      return;
    }
    if (action === 'compass-set-parent') {
      const place = act.dataset.place;
      const parentId = this.container.querySelector('[data-role="focus-parent"]')?.value || '';
      this._compassTry(() => {
        setParent(ensureCompass(st), place, parentId);
        this._compassSave(st);
      });
      return;
    }
    if (action === 'compass-set-tags') {
      const place = act.dataset.place;
      const locWrap = this.container.querySelector('.st-loctag-wrap[data-role="focus-loctags"]');
      const tags = readLocationTags(locWrap);
      this._compassTry(() => {
        setLocationTags(ensureCompass(st), place, tags);
        this._compassSave(st);
      });
      return;
    }
    if (action === 'compass-set-note') {
      const place = act.dataset.place;
      const note = this.container.querySelector('[data-role="focus-note"]')?.value || '';
      this._compassTry(() => {
        setOrientationNote(ensureCompass(st), place, note);
        this._compassSave(st);
      });
      return;
    }
    if (action === 'compass-delete') {
      const place = act.dataset.place;
      if (!confirm(`Delete place "${place}"?`)) return;
      this._compassTry(() => {
        deletePlace(ensureCompass(st), place);
        if (this._compassFocusId === place) this._compassFocusId = '';
        this._compassSave(st);
      });
      return;
    }
    if (action === 'compass-undo') {
      const place = act.dataset.place || '';
      this._compassTry(() => {
        const compass = ensureCompass(st);
        const room = getPlace(compass, place);
        if (room && isSuiteHostKind(room.kind) && (room.suiteHistory || []).length) {
          undoSuiteLastChange(compass, place);
          this._suiteSelShared = null;
          this._suiteSelEdge = null;
          this._suiteSelEdges = [];
        } else {
          undoLastChange(compass, place);
        }
        this._compassSave(st);
      });
      return;
    }
    if (action === 'compass-add-link') {
      const edges = [...(this._compassSelEdges || [])].map(Number).filter(n => Number.isFinite(n));
      const vertical = [...this.container.querySelectorAll('[data-action="compass-toggle-wall"].on')]
        .map(el => el.dataset.wall)
        .filter(w => w === 'above' || w === 'below');
      const toPlaceId = this.container.querySelector('[data-role="link-to"]')?.value;
      const description = this.container.querySelector('[data-role="link-desc"]')?.value?.trim() || '';
      if (!edges.length && !vertical.length) { alert('Select floorplan wall(s) and/or above/below.'); return; }
      if (!toPlaceId) { alert('Pick a neighbor place.'); return; }
      this._compassTry(() => {
        const compass = ensureCompass(st);
        for (const edge of edges) {
          addLink(compass, act.dataset.place, { edge, toPlaceId, description });
        }
        for (const wall of vertical) {
          addLink(compass, act.dataset.place, { wall, toPlaceId, description });
        }
        this._compassSave(st);
      });
      return;
    }
    if (action === 'compass-mark-external') {
      const edges = [...(this._compassSelEdges || [])].map(Number).filter(n => Number.isFinite(n));
      const vertical = [...this.container.querySelectorAll('[data-action="compass-toggle-wall"].on')]
        .map(el => el.dataset.wall)
        .filter(w => w === 'above' || w === 'below');
      const description = this.container.querySelector('[data-role="link-desc"]')?.value?.trim() || '';
      if (!edges.length && !vertical.length) { alert('Select floorplan wall(s) and/or above/below.'); return; }
      this._compassTry(() => {
        const compass = ensureCompass(st);
        for (const edge of edges) {
          addLink(compass, act.dataset.place, { edge, external: true, description });
        }
        for (const wall of vertical) {
          addLink(compass, act.dataset.place, { wall, external: true, description });
        }
        this._compassSave(st);
      });
      return;
    }
    if (action === 'compass-divide-room') {
      const edges = [...(this._compassSelEdges || [])].map(Number).filter(n => Number.isFinite(n));
      if (edges.length !== 2) { alert('Select exactly 2 walls on the floorplan first.'); return; }
      const placeId = act.dataset.place || '';
      this._compassTry(() => {
        const compass = ensureCompass(st);
        const { roomB } = divideRoom(compass, placeId, edges[0], 0.5, edges[1], 0.5);
        this._compassSelEdges = new Set();
        this._compassFocusId = placeId;
        this._suiteHighlightChild = roomB?.id || '';
        this._compassSave(st);
      });
      return;
    }
    if (action === 'compass-toggle-link-external') {
      const on = act.dataset.on !== '0';
      this._compassTry(() => {
        setLinkExternal(ensureCompass(st), act.dataset.place, act.dataset.link, on);
        this._compassSave(st);
      });
      return;
    }
    if (action === 'compass-toggle-exposed') {
      const place = act.dataset.place;
      const exposed = act.dataset.on !== '0';
      this._compassTry(() => {
        setPlaceExposed(ensureCompass(st), place, exposed);
        this._compassSave(st);
      });
      return;
    }
    if (action === 'compass-remove-link') {
      this._compassTry(() => {
        removeLink(ensureCompass(st), act.dataset.place, act.dataset.link);
        this._compassSave(st);
      });
      return;
    }
    if (action === 'toggle-cell' || action === 'grid-apply' || action === 'grid-clear'
      || action === 'asset-add' || action === 'asset-drop') {
      // Legacy Stage mark-grid / assets removed — Room Compass supersedes them.
      return;
    }
    if (action === 'theme') {
      const g = this._g();
      g.theme = act.dataset.theme || 'paper';
      this._saveG();
      this._applyTheme(g.theme);
      return void this.render(this.container);
    }
    if (action === 'theme-apply') {
      const g = this._g();
      g.ink = this.container.querySelector('[data-g="ink"]')?.value || '';
      g.paper = this.container.querySelector('[data-g="paper"]')?.value || '';
      g.gold = this.container.querySelector('[data-g="gold"]')?.value || '';
      g.theme = 'custom';
      this._saveG();
      this._applyTheme('custom', g);
      return void this.render(this.container);
    }
    if (action === 'theme-reset') {
      const g = this._g();
      g.theme = 'paper';
      g.ink = '';
      g.paper = '';
      g.gold = '';
      this._saveG();
      this._applyTheme('paper');
      return void this.render(this.container);
    }
    if (action === 'role-colors-apply') {
      for (const el of this.container.querySelectorAll('[data-role-color]')) {
        setRoleColor(el.dataset.roleColor, el.value);
      }
      applyRoleColorVars();
      saveSettingsDebounced();
      this.bus?.emit('showtime.stateChanged');
      return void this.render(this.container);
    }
    if (action === 'role-colors-reset') {
      resetRoleColors();
      applyRoleColorVars();
      saveSettingsDebounced();
      this.bus?.emit('showtime.stateChanged');
      return void this.render(this.container);
    }
    if (action === 'settings-save') return this._saveSettings();
    if (action === 'script-deep') {
      const script = window.Showtime?.modules?.get('script');
      if (script?._openSettings) script._openSettings();
      else alert('Script module is not loaded.');
      return;
    }
    if (action === 'tracker-pane') {
      st.trackers = normalizeTrackers(st.trackers);
      st.trackers.pane = act.dataset.pane || 'status';
      this.saveState();
      return void this.render(this.container);
    }
    if (action === 'scene-clap') return this._sceneClap();
    if (action === 'scene-weather-shift') return this._sceneWeatherShift();
    if (action === 'clap-show') {
      st.trackers = normalizeTrackers(st.trackers);
      st.trackers.scene.clapperHidden = false;
      this.saveState();
      this._syncFloatingClapper(true);
      return;
    }
    if (action === 'custom-stat-add') return this._openCustomStatDialog(null);
    if (action === 'custom-stat-edit') return this._openCustomStatDialog(act.dataset.id);
    if (action === 'custom-stat-del') {
      st.trackers = normalizeTrackers(st.trackers);
      st.trackers.status.customBars = (st.trackers.status.customBars || [])
        .filter(b => b.id !== act.dataset.id);
      this.saveState();
      this.bus?.emit('showtime.stateChanged');
      this.bus?.emit('trackers.updated');
      return void this.render(this.container);
    }
    if (action === 'bg-add') return this._openBackgroundDialog(null);
    if (action === 'bg-import-st') return this._importStBackgrounds();
    if (action === 'wx-reload') {
      this._wxTestUntil = 0;
      this._syncWeatherOverlay();
      if (this._door === 'studio-effects') return void this.render(this.container);
      return;
    }
    if (action === 'wx-clear') {
      clearWeatherOverlay();
      return;
    }
    if (action === 'wx-test') {
      const preset = TEST_PRESETS[act.dataset.preset];
      if (!preset) return;
      const fx = normalizeEffects(this._db().effects);
      const sheltered = preset.sheltered || resolveSheltered(fx, this._activeRoomExposed());
      paintWeatherOverlay(preset.st, {
        ...fx,
        sheltered,
        candlelight: preset.candlelight ?? fx.candlelight,
      });
      syncWeatherAudio(preset.st, fx.audio, { sheltered });
      this._wxTestUntil = Date.now() + 12000;
      return;
    }
    if (action === 'bg-edit') return this._openBackgroundDialog(act.dataset.id);
    if (action === 'bg-activate') {
      // "Use" pins this background so it wins over auto-select in any mode —
      // i.e. it actually switches the live background right now.
      st.visuals = normalizeVisuals(st.visuals);
      const id = act.dataset.id || '';
      st.visuals.activeId = id;
      st.visuals.pinnedId = id;
      this.saveState();
      this._syncStageBackground();
      return void this.render(this.container);
    }
    if (action === 'bg-unpin') {
      st.visuals = normalizeVisuals(st.visuals);
      st.visuals.pinnedId = '';
      this.saveState();
      this._syncStageBackground();
      return void this.render(this.container);
    }
    if (action === 'bg-link-here') {
      st.visuals = normalizeVisuals(st.visuals);
      const bg = st.visuals.backgrounds.find(b => b.id === act.dataset.id);
      if (!bg) return;
      const ctx = this._bgContext();
      const lc = s => String(s || '').toLowerCase();
      // Associate this background with the current room + area + location tags
      // so auto-select shows it here going forward.
      if (ctx.placeId && !bg.placeIds.includes(ctx.placeId)) bg.placeIds.push(ctx.placeId);
      if (ctx.cellId && !bg.cellIds.map(lc).includes(lc(ctx.cellId))) bg.cellIds.push(String(ctx.cellId).toUpperCase());
      for (const t of ctx.locationTags || []) {
        if (t && !bg.locationTags.map(lc).includes(lc(t))) bg.locationTags.push(t);
      }
      bg.updatedAt = Date.now();
      // Now that it's the expected pick here, drop the temporary pin.
      if (st.visuals.pinnedId === bg.id) st.visuals.pinnedId = '';
      this.saveState();
      this._syncStageBackground();
      const where = [ctx.placeName || ctx.placeId, ctx.cellId ? `area ${ctx.cellId}` : ''].filter(Boolean).join(' · ') || 'here';
      alert(`Linked “${bg.title}” to ${where}. Auto-select will show it here.`);
      return void this.render(this.container);
    }
    if (action === 'bg-del') {
      if (!confirm('Delete this background?')) return;
      st.visuals = normalizeVisuals(st.visuals);
      st.visuals.backgrounds = st.visuals.backgrounds.filter(b => b.id !== act.dataset.id);
      if (st.visuals.activeId === act.dataset.id) st.visuals.activeId = '';
      if (st.visuals.pinnedId === act.dataset.id) st.visuals.pinnedId = '';
      this.saveState();
      this._syncStageBackground();
      return void this.render(this.container);
    }
    if (action === 'bg-up' || action === 'bg-down') {
      st.visuals = normalizeVisuals(st.visuals);
      const list = st.visuals.backgrounds;
      const i = list.findIndex(b => b.id === act.dataset.id);
      if (i < 0) return;
      const j = action === 'bg-up' ? i - 1 : i + 1;
      if (j < 0 || j >= list.length) return;
      const a = list[i].sort;
      list[i].sort = list[j].sort;
      list[j].sort = a;
      // If sorts equal, nudge
      if (list[i].sort === list[j].sort) {
        list[i].sort = action === 'bg-up' ? list[j].sort - 1 : list[j].sort + 1;
      }
      st.visuals.backgrounds = list.slice().sort((x, y) => x.sort - y.sort || x.title.localeCompare(y.title));
      this.saveState();
      return void this.render(this.container);
    }
  }

  _injectClapperCss() {
    let style = document.getElementById('st-clapper-css');
    if (!style) {
      style = document.createElement('style');
      style.id = 'st-clapper-css';
      document.head.appendChild(style);
    }
    // Always refresh so design iterations land without a hard reload.
    if (style.textContent !== CLAPPER_CSS) style.textContent = CLAPPER_CSS;
  }

  _syncFloatingClapper(forceShow = false) {
    this._injectClapperCss();
    try { this._scanChatTrackers({ persist: false }); } catch { /* ignore */ }
    const st = this._db();
    const scene = normalizeTrackers(st.trackers).scene;
    let root = document.getElementById('st-clapper-float');
    const houseOpen = window.Showtime?.shell?.hasOpenChat?.() !== false;
    const want = houseOpen && !!scene.enabled && (!scene.clapperHidden || forceShow);
    if (!want) {
      if (root) root.hidden = true;
      return;
    }
    if (forceShow) {
      st.trackers.scene.clapperHidden = false;
      this.saveState();
    }
    if (!root) {
      root = document.createElement('div');
      root.id = 'st-clapper-float';
      root.className = 'st-clapper-float';
      document.body.appendChild(root);
      root.addEventListener('click', e => this._onClapperClick(e));
      this._bindClapperDrag(root);
    }
    const clap = this._sceneClapSnapshot(st);
    const pinned = !!scene.clapperPinned;
    root.classList.toggle('pinned', pinned);
    root.hidden = false;
    root.innerHTML = buildFloatingClapperHtml({
      esc,
      clap,
      scene,
      pinned,
    });
    const pos = normalizeVisuals(st.visuals).clapperPos;
    if (pos && Number.isFinite(pos.left) && Number.isFinite(pos.top)) {
      root.style.left = `${pos.left}px`;
      root.style.top = `${pos.top}px`;
      root.style.bottom = 'auto';
      root.style.right = 'auto';
      clampFixedElement(root);
    }
  }

  _bindClapperDrag(root) {
    if (root.dataset.dragBound) return;
    root.dataset.dragBound = '1';
    let sx = 0, sy = 0, ox = 0, oy = 0, dragging = false;
    const clamp = () => clampFixedElement(root);
    root.addEventListener('mousedown', e => {
      const handle = e.target.closest('[data-role="clap-drag"]');
      if (!handle || e.target.closest('button')) return;
      dragging = true;
      sx = e.clientX; sy = e.clientY;
      const rect = root.getBoundingClientRect();
      ox = rect.left; oy = rect.top;
      e.preventDefault();
    });
    const paintDrag = rafMove(e => {
      if (!dragging) return;
      root.style.left = `${ox + (e.clientX - sx)}px`;
      root.style.top = `${oy + (e.clientY - sy)}px`;
      root.style.right = 'auto';
      root.style.bottom = 'auto';
      clamp();
    });
    window.addEventListener('mousemove', e => {
      if (dragging) paintDrag(e);
    });
    window.addEventListener('mouseup', () => {
      if (!dragging) return;
      paintDrag.flush();
      dragging = false;
      clamp();
      const st = this._db();
      st.visuals = normalizeVisuals(st.visuals);
      st.visuals.clapperPos = {
        left: parseFloat(root.style.left) || 24,
        top: parseFloat(root.style.top) || 24,
      };
      this.saveState();
    });
    window.addEventListener('resize', () => {
      if (root.isConnected && !root.hidden) clamp();
    });
  }

  _onClapperClick(e) {
    const act = e.target.closest('[data-action]');
    if (!act) return;
    const action = act.dataset.action;
    const st = this._db();
    if (action === 'clap-pin') {
      st.trackers = normalizeTrackers(st.trackers);
      st.trackers.scene.clapperPinned = !st.trackers.scene.clapperPinned;
      this.saveState();
      this._syncFloatingClapper();
      return;
    }
    if (action === 'clap-refresh') return this._sceneClap();
    if (action === 'clap-hide') {
      st.trackers = normalizeTrackers(st.trackers);
      if (st.trackers.scene.clapperPinned) {
        act.title = 'Unpin first to hide';
        return;
      }
      st.trackers.scene.clapperHidden = true;
      this.saveState();
      this._syncFloatingClapper();
    }
  }

  _activeRoomExposed() {
    try {
      const st = this._db();
      const compass = ensureCompass(st);
      const scene = normalizeTrackers(st.trackers).scene;
      const place = this._trackerPlace(compass, scene) || getActiveRoom(compass);
      return place ? !!place.exposed : true;
    } catch {
      return true;
    }
  }

  _syncWeatherOverlay() {
    if (this._wxTestUntil && Date.now() < this._wxTestUntil) return;
    this._wxTestUntil = 0;
    try {
      const st = this._db();
      syncWeatherOverlay({
        effects: st.effects,
        scene: normalizeTrackers(st.trackers).scene,
        roomExposed: this._activeRoomExposed(),
      });
    } catch (err) {
      console.warn('[Showtime/Backstage] weather overlay sync failed', err);
    }
  }

  /** Scene tracker / clapper place — lastLocationKey wins over a stale sonar ping. */
  _trackerPlace(compass, scene) {
    const raw = String(scene?.lastLocationKey || compass?.sonar?.lastKey || '').trim();
    const lastKey = locationKeyFromStored(raw);
    const unit = (raw.match(/\(([^)]+)\)\s*$/) || [])[1] || '';
    if (unit) {
      const unitPlace = findPlaceByExactName(compass, unit);
      if (unitPlace) {
        const parent = unitPlace.parentId ? getPlace(compass, unitPlace.parentId) : null;
        const parentHit = !lastKey || !parent
          || locationKeyFromStored(parent.name).toLowerCase() === lastKey.toLowerCase()
          || (parent.locationTags || []).some(t => locationKeyFromStored(t).toLowerCase() === lastKey.toLowerCase())
          || String(parent.name || '').toLowerCase().includes(lastKey.toLowerCase());
        if (parentHit || locationKeyFromStored(unitPlace.name).toLowerCase() === lastKey.toLowerCase()) {
          return unitPlace;
        }
      }
    }
    if (lastKey) {
      const tagged = findPlaceForTag(compass, lastKey) || findPlaceByExactName(compass, lastKey);
      if (tagged) return tagged;
      const needle = lastKey.toLowerCase();
      const hit = Object.values(compass?.rooms || {}).find((p) => {
        try {
          const formatted = formatSceneLocation({ compass, placeId: p.id });
          const fk = locationKeyFromStored(formatted).toLowerCase();
          return fk === needle || formatted.toLowerCase().includes(needle);
        } catch { return false; }
      });
      if (hit) return hit;
    }
    const storyPlaceId = String(compass?.sonar?.lastPlaceId || '').trim();
    return storyPlaceId ? getPlace(compass, storyPlaceId) : null;
  }

  /** Scene context used to auto-select / link backgrounds (place, area, tags). */
  _bgContext() {
    const st = this._db();
    const compass = ensureCompass(st);
    const scene = normalizeTrackers(st.trackers).scene;
    const lastRaw = String(scene.lastLocationKey || compass.sonar?.lastKey || '').trim();
    const lastKey = locationKeyFromStored(lastRaw);
    const place = this._trackerPlace(compass, scene);
    const locationTags = [];
    const seen = new Set();
    const push = (t) => {
      const s = String(t || '').trim();
      if (!s) return;
      const k = s.toLowerCase();
      if (seen.has(k)) return;
      seen.add(k);
      locationTags.push(s);
    };
    push(lastRaw);
    push(lastKey);
    const unit = (lastRaw.match(/\(([^)]+)\)\s*$/) || [])[1] || '';
    if (unit) push(unit);
    if (place) {
      push(place.name);
      (place.locationTags || []).forEach(push);
      (place.aliases || []).forEach(push);
      try { lowestLocationNames(compass, place).forEach(push); } catch { /* ignore */ }
    }
    const narrativeTags = [];
    try {
      const chatFacets = this.storage.getChat('composer', {})?.sceneFacets || {};
      const globFacets = this.storage.getGlobal('composer', {})?.sceneFacets || {};
      const seenN = new Set();
      for (const list of [
        ...(chatFacets.mood || []),
        ...(chatFacets.datetime || []),
        ...(chatFacets.characters || []),
        ...(globFacets.mood || []),
        ...(globFacets.datetime || []),
        ...(globFacets.characters || []),
      ]) {
        const s = String(list || '').trim();
        if (!s) continue;
        const k = s.toLowerCase();
        if (seenN.has(k)) continue;
        seenN.add(k);
        narrativeTags.push(s);
      }
    } catch { /* ignore */ }
    return {
      locationTags,
      narrativeTags,
      placeId: place?.id || '',
      cellId: '',
      placeName: place?.name || lastKey,
    };
  }

  _syncStageBackground() {
    let layer = document.getElementById('st-stage-bg');
    const st = this._db();
    const visuals = normalizeVisuals(st.visuals);
    const ctx = this._bgContext();
    const bg = pickBackground(visuals, {
      locationTags: ctx.locationTags,
      narrativeTags: ctx.narrativeTags,
      placeId: ctx.placeId,
      cellId: ctx.cellId,
    });
    if (!bg) {
      if (layer) layer.remove();
      return;
    }
    if (!layer) {
      layer = document.createElement('div');
      layer.id = 'st-stage-bg';
      layer.className = 'st-stage-bg';
      // Append (not prepend) so we paint above ST's own background layers while
      // our negative z-index keeps us behind the chat UI.
      document.body.appendChild(layer);
    }
    const src = resolveBackgroundSrc(bg);
    const fallback = backgroundFallbackSrc(bg);
    layer.style.backgroundImage = src ? `url("${src.replace(/"/g, '\\"')}")` : '';
    layer.dataset.fallback = fallback || '';
    layer.onerror = null;
    // If primary fails (broken URL), swap to fallback once via Image probe
    if (src && fallback && src !== fallback) {
      const probe = new Image();
      probe.onerror = () => {
        layer.style.backgroundImage = `url("${fallback.replace(/"/g, '\\"')}")`;
      };
      probe.src = src;
    }
  }

  _openCustomStatDialog(editId) {
    const st = this._db();
    st.trackers = normalizeTrackers(st.trackers);
    const existing = (st.trackers.status.customBars || []).find(b => b.id === editId) || null;
    const bar = existing ? { ...existing } : normalizeCustomBar({ name: '', levelMode: 'label', levels: [{ at: 25, label: 'Low' }, { at: 75, label: 'High' }] });
    const levelsText = (bar.levels || []).map(lv => `${lv.at} | ${lv.label}`).join('\n');
    const overlay = document.createElement('div');
    overlay.className = 'bst-modal-overlay';
    overlay.innerHTML = `
      <div class="bst-modal" style="max-width:420px">
        <h3>${existing ? 'Edit' : 'Add'} custom status bar</h3>
        <label class="bst-field"><span>Name</span>
          <input class="bst-input" data-f="name" value="${esc(bar.name)}"></label>
        <label class="bst-field"><span>Description / prompt</span>
          <textarea class="bst-input" data-f="description" rows="3" placeholder="How audits should treat this meter…">${esc(bar.description)}</textarea></label>
        <label class="bst-field"><span>Color</span>
          <input type="color" data-f="color" value="${esc(bar.color)}"></label>
        <div class="bst-field"><span>Fill direction</span>
          <div class="bst-row">
            <label class="bst-radio"><input type="radio" name="bst-bar-dir" value="up" ${bar.direction !== 'down' ? 'checked' : ''}> Fill from empty → full</label>
            <label class="bst-radio"><input type="radio" name="bst-bar-dir" value="down" ${bar.direction === 'down' ? 'checked' : ''}> Fill as pressure rises</label>
          </div>
        </div>
        <div class="bst-field"><span>Levels</span>
          <div class="bst-row">
            <label class="bst-radio"><input type="radio" name="bst-lv-mode" value="label" ${bar.levelMode === 'label' ? 'checked' : ''}> Expression labels</label>
            <label class="bst-radio"><input type="radio" name="bst-lv-mode" value="amount" ${bar.levelMode === 'amount' ? 'checked' : ''}> Amount only</label>
            <label class="bst-radio"><input type="radio" name="bst-lv-mode" value="none" ${bar.levelMode === 'none' ? 'checked' : ''}> None</label>
          </div>
        </div>
        <label class="bst-field"><span>Level rows <span class="bst-k">(threshold | label — one per line)</span></span>
          <textarea class="bst-input" data-f="levels" rows="4">${esc(levelsText)}</textarea></label>
        <div class="bst-row" style="margin-top:10px">
          <button type="button" class="bst-btn" data-a="cancel">Cancel</button>
          <button type="button" class="bst-btn gold" data-a="save">Save</button>
        </div>
      </div>`;
    const close = () => overlay.remove();
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    overlay.querySelector('[data-a="cancel"]').addEventListener('click', close);
    overlay.querySelector('[data-a="save"]').addEventListener('click', () => {
      const name = overlay.querySelector('[data-f="name"]').value.trim();
      if (!name) { alert('Name is required.'); return; }
      const levelMode = overlay.querySelector('input[name="bst-lv-mode"]:checked')?.value || 'label';
      const direction = overlay.querySelector('input[name="bst-bar-dir"]:checked')?.value || 'up';
      const levels = String(overlay.querySelector('[data-f="levels"]').value || '')
        .split('\n').map(line => line.trim()).filter(Boolean)
        .map(line => {
          const [at, ...rest] = line.split('|').map(x => x.trim());
          return { at: Number(at) || 0, label: rest.join('|').trim() };
        });
      const next = normalizeCustomBar({
        id: bar.id,
        name,
        description: overlay.querySelector('[data-f="description"]').value,
        color: overlay.querySelector('[data-f="color"]').value,
        levelMode,
        direction,
        levels,
      });
      const st2 = this._db();
      st2.trackers = normalizeTrackers(st2.trackers);
      const list = st2.trackers.status.customBars || [];
      const idx = list.findIndex(b => b.id === next.id);
      if (idx >= 0) list[idx] = next;
      else list.push(next);
      st2.trackers.status.customBars = list;
      this.saveState();
      this.bus?.emit('showtime.stateChanged');
      this.bus?.emit('trackers.updated');
      close();
      this.render(this.container);
    });
    document.body.appendChild(overlay);
  }

  _openBackgroundDialog(editId) {
    const st = this._db();
    st.visuals = normalizeVisuals(st.visuals);
    const existing = st.visuals.backgrounds.find(b => b.id === editId) || null;
    const bg = existing ? { ...existing } : normalizeBackground({ title: '' });
    const compass = ensureCompass(st);
    const places = Object.values(compass.rooms || {});
    const placeChecks = places.map(p =>
      `<label class="bst-check tight"><input type="checkbox" data-place="${esc(p.id)}" ${(bg.placeIds || []).includes(p.id) ? 'checked' : ''}> ${esc(p.name)}</label>`).join('');
    const cells = ['NW', 'N', 'NE', 'W', 'C', 'E', 'SW', 'S', 'SE'];
    const cellChecks = cells.map(c =>
      `<label class="bst-check tight"><input type="checkbox" data-cell="${c}" ${(bg.cellIds || []).map(x => x.toUpperCase()).includes(c) ? 'checked' : ''}> ${c}</label>`).join('');
    const overlay = document.createElement('div');
    overlay.className = 'bst-modal-overlay';
    overlay.innerHTML = `
      <div class="bst-modal" style="max-width:520px">
        <h3>${existing ? 'Edit' : 'Add'} background</h3>
        <label class="bst-field"><span>Title</span>
          <input class="bst-input" data-f="title" value="${esc(bg.title)}"></label>
        <label class="bst-field"><span>Image URL</span>
          <input class="bst-input" data-f="url" value="${esc(bg.url && !bg.url.startsWith('data:') ? bg.url : '')}" placeholder="https://…/scene.png"></label>
        <label class="bst-field"><span>Backup URL</span>
          <input class="bst-input" data-f="backupUrl" value="${esc(bg.backupUrl && !String(bg.backupUrl).startsWith('data:') ? bg.backupUrl : '')}" placeholder="Fallback if primary fails"></label>
        <label class="bst-field"><span>Upload PNG</span>
          <input type="file" accept="image/png,image/jpeg,image/webp,image/*" data-f="file">
          <span class="bst-k">${bg.fileData ? 'Stored upload on file' : 'Optional — used as primary or fallback'}</span></label>
        <div class="bst-field"><span>Location tags</span>
          ${locationTagEditorHTML({
            selected: bg.locationTags || [],
            fieldRole: 'bg-loctags',
            emptyHint: 'None yet — pick a known location or add a new one.',
          })}
        </div>
        <label class="bst-field"><span>Scene tags <span class="bst-k">(comma)</span></span>
          <input class="bst-input" data-f="sceneTags" value="${esc((bg.sceneTags || []).join(', '))}"></label>
        <label class="bst-field"><span>Free tags <span class="bst-k">(comma — narrative match)</span></span>
          <input class="bst-input" data-f="tags" value="${esc((bg.tags || []).join(', '))}"></label>
        <div class="bst-field"><span>Share among places</span>
          <div class="bst-checkgrid">${placeChecks || '<span class="bst-k">No places yet</span>'}</div></div>
        <div class="bst-field"><span>Compass cells <span class="bst-k">(empty = any)</span></span>
          <div class="bst-checkgrid">${cellChecks}</div></div>
        <div class="bst-row" style="margin-top:10px">
          <button type="button" class="bst-btn" data-a="cancel">Cancel</button>
          <button type="button" class="bst-btn gold" data-a="save">Save</button>
        </div>
      </div>`;
    let fileData = bg.fileData || '';
    let fileReady = Promise.resolve();
    const fileStatus = overlay.querySelector('.bst-field [data-f="file"]')?.closest('.bst-field')?.querySelector('.bst-k');
    overlay.querySelector('[data-f="file"]').addEventListener('change', ev => {
      const file = ev.target.files?.[0];
      if (!file) return;
      if (fileStatus) fileStatus.textContent = 'Reading upload…';
      fileReady = new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => {
          fileData = String(reader.result || '');
          if (fileStatus) fileStatus.textContent = fileData ? 'Upload ready' : 'Upload failed';
          resolve();
        };
        reader.onerror = () => {
          if (fileStatus) fileStatus.textContent = 'Upload failed';
          resolve();
        };
        reader.readAsDataURL(file);
      });
    });
    const close = () => overlay.remove();
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    overlay.querySelector('[data-a="cancel"]').addEventListener('click', close);
    bindLocationCatalogPicker(overlay.querySelector('.st-loctag-wrap[data-role="bg-loctags"]'), this.storage);
    overlay.querySelector('[data-a="save"]').addEventListener('click', async () => {
      await fileReady;
      const title = overlay.querySelector('[data-f="title"]').value.trim() || 'Untitled';
      const url = overlay.querySelector('[data-f="url"]').value.trim();
      const backupUrl = overlay.querySelector('[data-f="backupUrl"]').value.trim();
      const split = (sel) => String(overlay.querySelector(sel).value || '')
        .split(',').map(x => x.trim()).filter(Boolean);
      const placeIds = [...overlay.querySelectorAll('[data-place]:checked')].map(el => el.dataset.place);
      const cellIds = [...overlay.querySelectorAll('[data-cell]:checked')].map(el => el.dataset.cell);
      const next = normalizeBackground({
        id: bg.id,
        title,
        url,
        backupUrl,
        fileData,
        locationTags: readLocationTags(overlay.querySelector('.st-loctag-wrap[data-role="bg-loctags"]')),
        sceneTags: split('[data-f="sceneTags"]'),
        tags: split('[data-f="tags"]'),
        placeIds,
        cellIds,
        sort: bg.sort,
        createdAt: bg.createdAt,
        updatedAt: Date.now(),
      });
      if (!next.url && !next.backupUrl && !next.fileData) {
        alert('Add a URL or upload an image.');
        return;
      }
      const st2 = this._db();
      st2.visuals = normalizeVisuals(st2.visuals);
      const list = st2.visuals.backgrounds;
      const idx = list.findIndex(b => b.id === next.id);
      if (idx >= 0) list[idx] = next;
      else list.push(next);
      this.saveState();
      this._syncStageBackground();
      close();
      this.render(this.container);
    });
    document.body.appendChild(overlay);
  }

  /** Pull backgrounds from SillyTavern’s `/backgrounds` library into Showtime Visuals. */
  async _importStBackgrounds() {
    let images = [];
    try {
      const response = await fetch('/api/backgrounds/all', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({}),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      images = Array.isArray(data?.images) ? data.images : [];
    } catch (err) {
      console.error('[Backstage] ST backgrounds fetch failed', err);
      alert(`Could not read SillyTavern backgrounds: ${err.message || err}`);
      return;
    }
    if (!images.length) {
      alert('SillyTavern has no backgrounds to import.');
      return;
    }

    const st = this._db();
    st.visuals = normalizeVisuals(st.visuals);
    const have = new Set(
      st.visuals.backgrounds
        .map(b => String(b.url || '').replace(/^\/+/, '').toLowerCase())
        .filter(Boolean),
    );
    const rows = images.map((img, i) => {
      const filename = String(img.filename || img || '').trim();
      if (!filename) return '';
      const url = `backgrounds/${encodeURIComponent(filename)}`;
      const already = have.has(url.toLowerCase()) || have.has(filename.toLowerCase());
      const title = filename.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || filename;
      return `
        <label class="bst-check" style="align-items:center;gap:8px">
          <input type="checkbox" data-st-bg="${esc(filename)}" ${already ? '' : 'checked'} ${already ? 'disabled' : ''}>
          <span class="bst-bg-thumb" style="width:40px;height:28px;flex-shrink:0;background-image:url('${esc(url).replace(/'/g, '%27')}')"></span>
          <span>${esc(title)}${already ? ' <span class="bst-k">(already in library)</span>' : ''}</span>
        </label>`;
    }).filter(Boolean).join('');

    const overlay = document.createElement('div');
    overlay.className = 'bst-modal-overlay';
    overlay.innerHTML = `
      <div class="bst-modal" style="max-width:520px">
        <h3>Import from SillyTavern</h3>
        <p class="bst-hint">Adds selected files from SillyTavern’s background folder into this chat’s Visuals library (as URLs — not copies).</p>
        <div class="bst-checkgrid" style="max-height:360px;overflow:auto;display:flex;flex-direction:column;gap:6px;margin:10px 0">
          ${rows || '<span class="bst-k">Nothing listed.</span>'}
        </div>
        <div class="bst-row">
          <button type="button" class="bst-btn" data-a="all">Select new</button>
          <button type="button" class="bst-btn" data-a="none">Clear</button>
          <span style="flex:1"></span>
          <button type="button" class="bst-btn" data-a="cancel">Cancel</button>
          <button type="button" class="bst-btn gold" data-a="import">Import</button>
        </div>
      </div>`;
    const close = () => overlay.remove();
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    overlay.querySelector('[data-a="cancel"]').addEventListener('click', close);
    overlay.querySelector('[data-a="all"]').addEventListener('click', () => {
      overlay.querySelectorAll('[data-st-bg]:not(:disabled)').forEach(cb => { cb.checked = true; });
    });
    overlay.querySelector('[data-a="none"]').addEventListener('click', () => {
      overlay.querySelectorAll('[data-st-bg]:not(:disabled)').forEach(cb => { cb.checked = false; });
    });
    overlay.querySelector('[data-a="import"]').addEventListener('click', () => {
      const picked = [...overlay.querySelectorAll('[data-st-bg]:checked:not(:disabled)')]
        .map(el => el.dataset.stBg)
        .filter(Boolean);
      if (!picked.length) {
        alert('Pick at least one background.');
        return;
      }
      const st2 = this._db();
      st2.visuals = normalizeVisuals(st2.visuals);
      const existingUrls = new Set(
        st2.visuals.backgrounds.map(b => String(b.url || '').toLowerCase()).filter(Boolean),
      );
      let added = 0;
      const baseSort = Date.now();
      for (let i = 0; i < picked.length; i++) {
        const filename = picked[i];
        const url = `backgrounds/${encodeURIComponent(filename)}`;
        if (existingUrls.has(url.toLowerCase())) continue;
        const title = filename.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || filename;
        st2.visuals.backgrounds.push(normalizeBackground({
          title,
          url,
          sort: baseSort + i,
          tags: ['sillytavern'],
        }));
        existingUrls.add(url.toLowerCase());
        added += 1;
      }
      this.saveState();
      this._syncStageBackground();
      close();
      this.render(this.container);
      if (!added) alert('Nothing new to import — those were already in the library.');
    });
    document.body.appendChild(overlay);
  }

  _setTrackerPath(path, value) {
    const st = this._db();
    st.trackers = normalizeTrackers(st.trackers);
    const parts = String(path || '').split('.').filter(Boolean);
    if (parts.length < 2) return;
    let cur = st.trackers;
    for (let i = 0; i < parts.length - 1; i++) {
      const k = parts[i];
      if (cur[k] == null || typeof cur[k] !== 'object') cur[k] = {};
      cur = cur[k];
    }
    cur[parts[parts.length - 1]] = value;
    st.trackers = normalizeTrackers(st.trackers);
    this.saveState();
  }

  _sceneClap() {
    try { this._scanChatTrackers({ persist: true }); } catch { /* ignore */ }
    const st = this._db();
    st.trackers = normalizeTrackers(st.trackers);
    const snap = this._sceneClapSnapshot(st);
    const locKey = locationKeyFromStored(st.trackers.scene.lastLocationKey)
      || locationKeyFromStored(ensureCompass(st).sonar?.lastKey)
      || locationKeyFromStored(snap.location);
    st.trackers.scene.lastLocationKey = locKey;
    st.trackers.scene.lastTimeLabel = st.trackers.scene.time
      ? (snap.time || '')
      : '';
    st.trackers.scene.lastDateLabel = st.trackers.scene.date && snap.date !== '—'
      ? snap.date
      : '';
    st.trackers.scene.lastClapAt = Date.now();
    // Soft-sync composer scene location when we have a key
    try {
      if (st.trackers.scene.trackStar && locKey) {
        this._pushComposerLocation(this._sceneLocationBits(
          ensureCompass(st),
          ensureCompass(st).sonar?.lastPlaceId,
          locKey,
        ));
      }
    } catch { /* ignore */ }
    this.saveState();
    this.bus?.emit('showtime.stateChanged');
    this._syncFloatingClapper();
    this._syncWeatherOverlay();
    const float = document.getElementById('st-clapper-float');
    if (float) {
      float.classList.add('clapping');
      setTimeout(() => float.classList.remove('clapping'), 220);
    }
    if (this._door === 'studio-trackers') return void this.render(this.container);
    return;
  }

  _sceneWeatherShift() {
    const st = this._db();
    st.trackers = normalizeTrackers(st.trackers);
    const snap = this._sceneClapSnapshot(st);
    const pool = weatherPoolForSeason(snap.season);
    const cur = `${st.trackers.scene.weatherEmoji} ${st.trackers.scene.weatherLabel}`.trim();
    let idx = pool.findIndex(w => w === cur);
    if (idx < 0) idx = 0;
    const next = pool[(idx + 1) % pool.length];
    const parsed = parseWeatherToken(next);
    st.trackers.scene.weatherEmoji = parsed.emoji;
    st.trackers.scene.weatherLabel = parsed.label;
    this.saveState();
    this._syncFloatingClapper();
    this._syncWeatherOverlay();
    if (this._door === 'studio-trackers' || this._door === 'studio-effects') return void this.render(this.container);
  }

  _onChange(e) {
    const el = e.target;
    const st = this._db();

    if (el.dataset.g && String(el.dataset.g).startsWith('profile-')) {
      const slot = el.dataset.g.slice('profile-'.length);
      this._saveProfileSlot(slot, el.value);
      return;
    }

    if (el.dataset.role === 'place-edit-kind') {
      const wrap = el.closest('.bst-set-edit');
      const sel = wrap?.querySelector('[data-role="place-edit-parent"]');
      const allow = PLACE_NEST_PARENTS[el.value] || [];
      if (sel) {
        for (const opt of sel.options) {
          if (!opt.value) {
            opt.hidden = false;
            continue;
          }
          opt.hidden = !allow.includes(opt.dataset.kind);
        }
        if (sel.selectedOptions[0]?.hidden) sel.value = '';
      }
      return;
    }

    if (el.dataset.role === 'set-place-kind') {
      const placeId = el.dataset.place || '';
      const tag = String(el.dataset.tag || '').trim();
      const kind = String(el.value || '').trim();
      this._compassTry(() => {
        const compass = ensureCompass(st);
        if (placeId) {
          setPlaceKind(compass, placeId, kind || 'room');
        } else if (kind) {
          upsertLocationNode(this.storage, { name: tag, kind });
          const compassKind = GROUP_TO_COMPASS[kind] || '';
          const existing = findPlaceForTag(compass, tag);
          if (existing && compassKind) {
            setPlaceKind(compass, existing.id, compassKind);
          } else if (!existing && compassKind && tag) {
            createAndStoreRoom(compass, {
              name: tag,
              kind: compassKind,
              locationTags: [tag],
            });
          }
        } else if (tag) {
          const node = findLocationNodeByName(this.storage, tag);
          if (node) {
            node.kind = '';
            node.parentId = '';
          }
        }
        try { syncLocationCatalogFromCompass(this.storage, compass); } catch { /* ignore */ }
        this._compassSave(st);
      });
      return void this.render(this.container);
    }

    if (el.dataset.role === 'sonar-include') {
      const castId = el.dataset.cast || '';
      this._compassTry(() => {
        setSonarExcluded(ensureCompass(st), castId, !el.checked);
        this._compassSave(st);
      });
      return void this.render(this.container);
    }
    if (el.dataset.role === 'sonar-place' || el.dataset.role === 'sonar-cell') {
      const castId = el.dataset.cast || '';
      const member = this._sonarCast().find(m => String(m.id) === String(castId));
      if (!member) return;
      const row = el.closest('.bst-sonar-cast');
      const placeId = row?.querySelector('[data-role="sonar-place"]')?.value || '';
      const cell = row?.querySelector('[data-role="sonar-cell"]')?.value || 'C';
      this._compassTry(() => {
        const compass = ensureCompass(st);
        pinSonarPing(compass, member, { placeId, cell, locked: true });
        if (placeId) {
          try { addOccupant(compass, placeId, { name: member.name, cell, castId: member.id, description: 'parked' }); } catch { /* ignore */ }
        }
        this._compassSave(st);
      });
      return;
    }

    if (el.dataset.role === 'placement-move-piece') {
      const toCell = el.value;
      if (!toCell) return;
      this._compassTry(() => {
        moveItem(ensureCompass(st), el.dataset.place, {
          itemId: el.dataset.id,
          cell: el.dataset.cell,
          layer: el.dataset.layer,
          toCell,
        });
        this._compassSelCell = toCell;
        this._compassSave(st);
      });
      return;
    }

    if (el.dataset.role === 'import-file' && el.files?.[0]) {
      return void this._importProduction(el.files[0]);
    }
    if (el.name === 'pg-mode') {
      st.peanut.mode = el.value;
      this.saveState();
      return void this.render(this.container);
    }
    if (el.dataset.field === 'eventGuidance') {
      st.production.eventGuidance = el.value;
      this.saveState();
      return;
    }
    if (el.dataset.field === 'directorOn' || el.dataset.field === 'queueComposer') {
      st.production[el.dataset.field] = el.checked;
      this.saveState();
      if (el.dataset.field === 'directorOn') this.render(this.container);
      return;
    }
    if (el.dataset.field === 'scanFrequency') {
      st.production.scanFrequency = el.value;
      this.saveState();
      return void this.render(this.container);
    }
    if (el.dataset.field === 'scanEveryN') {
      st.production.scanEveryN = Math.max(1, Math.min(40, Number(el.value) || 4));
      this.saveState();
      return;
    }
    if (el.dataset.field === 'intrusiveness') {
      st.production.intrusiveness = el.value;
      st.production.intrudeRandom = false;
      this.saveState();
      return void this.render(this.container);
    }
    if (el.dataset.field === 'intrudeRandom') {
      st.production.intrudeRandom = el.checked;
      this.saveState();
      return void this.render(this.container);
    }
    if (el.dataset.src) {
      const key = el.dataset.src;
      st.production.sources ??= DEFAULT_SOURCES();
      st.production.sources[key] = el.checked;
      this.saveState();
      return void this.render(this.container);
    }
    if (el.dataset.facet) {
      st.production.sources ??= DEFAULT_SOURCES();
      st.production.sources.tagFacets ??= { ...DEFAULT_SOURCES().tagFacets };
      st.production.sources.tagFacets[el.dataset.facet] = el.checked;
      this.saveState();
      return;
    }
    if (el.dataset.trk) {
      const path = el.dataset.trk;
      let value;
      if (el.type === 'checkbox') value = el.checked;
      else if (el.type === 'number') value = Number(el.value);
      else value = el.value;
      this._setTrackerPath(path, value);
      if (/^scene\./.test(path)) {
        if (/dateParts|followTimeline|date$/.test(path)) {
          try {
            const st = this._db();
            const snap = this._sceneClapSnapshot(st);
            if (st.trackers.scene.date && snap.date && snap.date !== '—') {
              st.trackers.scene.lastDateLabel = snap.date;
              this.saveState();
            }
          } catch { /* ignore */ }
        }
        this._syncFloatingClapper();
        this._syncWeatherOverlay();
      }
      const needsRender = /^(status\.cadence|status\.enabled|scene\.|location\.|connection\.enabled|items\.enabled|pane)/.test(path)
        || el.type === 'radio'
        || el.type === 'checkbox';
      if (needsRender) return void this.render(this.container);
      return;
    }
    if (el.dataset.vis) {
      st.visuals = normalizeVisuals(st.visuals);
      const key = el.dataset.vis;
      st.visuals[key] = el.type === 'checkbox' ? el.checked : el.value;
      this.saveState();
      this._syncStageBackground();
      return void this.render(this.container);
    }
    if (el.dataset.fx || el.dataset.fxManual || el.dataset.fxAudio || el.dataset.fxAudioTrack) {
      st.effects = normalizeEffects(st.effects);
      if (el.dataset.fxAudioTrack) {
        st.effects.audio.tracks[el.dataset.fxAudioTrack] = String(el.value || '').trim();
      } else if (el.dataset.fxAudio) {
        const key = el.dataset.fxAudio;
        if (el.type === 'checkbox') st.effects.audio[key] = el.checked;
        else if (el.type === 'range' || el.type === 'number') st.effects.audio[key] = Number(el.value);
        else st.effects.audio[key] = el.value;
      } else if (el.dataset.fx) {
        const key = el.dataset.fx;
        if (el.type === 'checkbox') st.effects[key] = el.checked;
        else if (el.type === 'range' || el.type === 'number') st.effects[key] = Number(el.value);
        else st.effects[key] = el.value;
        if (key === 'particleIntensity' && el.type === 'range') {
          const k = el.closest('.bst-field')?.querySelector('.bst-k');
          if (k) k.textContent = `${clampParticleIntensity(st.effects.particleIntensity)}%`;
        }
      } else {
        const key = el.dataset.fxManual;
        st.effects.manual ??= normalizeEffects().manual;
        if (el.type === 'checkbox') st.effects.manual[key] = el.checked;
        else st.effects.manual[key] = el.value;
      }
      this._wxTestUntil = 0;
      this.saveState();
      this._syncWeatherOverlay();
      const needsRender = el.dataset.fx === 'freeMode' || el.dataset.fx === 'enabled'
        || el.dataset.fx === 'exposure' || el.dataset.fxAudio === 'enabled'
        || el.type === 'checkbox' || el.type === 'radio';
      if (needsRender) return void this.render(this.container);
      return;
    }
    if (el.dataset.field === 'subjectId') {
      if (st.interview.active) return;
      st.interview.subjectId = el.value;
      this.saveState();
      return void this.render(this.container);
    }
    if (el.dataset.field === 'interviewerPick') {
      if (st.interview.active) return;
      const v = el.value || '';
      if (v === 'user') {
        st.interview.interviewer = 'user';
        st.interview.interviewerId = '';
      } else if (v.startsWith('cast:')) {
        st.interview.interviewer = 'cast';
        st.interview.interviewerId = v.slice(5);
      } else {
        st.interview.interviewer = 'star';
        st.interview.interviewerId = getStarMember(this.storage)?.id || '';
      }
      this.saveState();
      return void this.render(this.container);
    }
    if (el.dataset.noteQ != null || el.dataset.noteTarget != null || el.dataset.noteAbout != null) {
      const noteId = el.dataset.noteQ || el.dataset.noteTarget || el.dataset.noteAbout;
      st.interview.notePick ??= {};
      st.interview.notePick[noteId] ??= {};
      if (el.dataset.noteQ != null) st.interview.notePick[noteId].q = Number(el.value) || 0;
      if (el.dataset.noteTarget != null) st.interview.notePick[noteId].targetId = el.value;
      if (el.dataset.noteAbout != null) st.interview.notePick[noteId].about = el.value;
      this.saveState();
      return;
    }
    if (['recentN', 'from', 'to', 'scriptUid'].includes(el.dataset.field)) {
      const key = el.dataset.field;
      st.peanut[key] = key === 'scriptUid' ? el.value : Number(el.value) || 0;
      this.saveState();
      return;
    }
  }

  // ── actions ────────────────────────────────────────────────────────────────

  _maybeAutoDirector() {
    const st = this._db();
    const p = st.production;
    if (!p?.directorOn || this._busy || p.pendingEvent?.text) return;
    const freq = p.scanFrequency || 'manual';
    if (freq === 'manual') return;
    if (freq === 'every_turn') {
      void this._directorCheck({ auto: true });
      return;
    }
    if (freq === 'every_n') {
      p.msgSinceCheck = (p.msgSinceCheck || 0) + 1;
      const n = Math.max(1, Number(p.scanEveryN) || 4);
      if (p.msgSinceCheck >= n) {
        p.msgSinceCheck = 0;
        this.saveState();
        void this._directorCheck({ auto: true });
      } else {
        this.saveState();
      }
    }
  }

  async _directorCheck({ auto = false, force = false, settings = null, picks = null } = {}) {
    const st = this._db();
    if ((!st.production.directorOn && !force) || this._busy) {
      if (force && this._busy) alert('Director is already rolling.');
      return;
    }
    this._busy = true;
    const showProd = this._door === 'production' && this.container;
    if (showProd) this.render(this.container);
    const p = st.production;
    const snap = {
      sources: mergeDirectorSources(p.sources),
      intrusiveness: p.intrusiveness,
      intrudeRandom: !!p.intrudeRandom,
    };
    if (settings?.sources) p.sources = mergeDirectorSources({ ...snap.sources, ...settings.sources });
    if (settings?.intrusiveness) p.intrusiveness = settings.intrusiveness;
    if (typeof settings?.intrudeRandom === 'boolean') p.intrudeRandom = settings.intrudeRandom;
    const restoreRun = () => {
      p.sources = snap.sources;
      p.intrusiveness = snap.intrusiveness;
      p.intrudeRandom = snap.intrudeRandom;
    };
    try {
      const brief = this._directorBrief();
      const mode = p.intrudeRandom
        ? INTRUDE[Math.floor(Math.random() * INTRUDE.length)]
        : (INTRUDE.find(i => i.id === p.intrusiveness) || INTRUDE[2]);
      const eventsOn = p.sources?.events !== false;
      const pinned = formatDirectorPicksBlock(this.storage, picks);
      const fireRule = force
        ? '- The user requested an event NOW. You MUST set "fire": true and write the beat. Prefer PINNED CUES when present.'
        : '- Fire sparingly. Prefer "fire": false unless something clearly warrants a nudge.';
      const prompt = `You are the Director for a roleplay production. Review the floor and decide whether to inject ONE event beat now.

DIRECTOR CARD (your creative brief — obey tone, genre, and constraints here):
${this._directorCardBlock()}

INTRUSIVENESS — ${mode.label}${p.intrudeRandom ? ' (rolled this check)' : ''}: ${mode.tip}

RULES:
${fireRule}
- Prefer advancing or pressuring an ACTIVE PLOT HOOK when one fits the floor — do not ignore filed hooks.
${eventsOn ? '- When EVENTS & HOLIDAYS are listed, prefer cueing or echoing one of those composed holidays/events when the floor timing or cast fits — do not invent a new holiday if a filed one applies.\n' : ''}- Stay within the allowed source sections in the floor brief. Do not invent trackers.
- Do not rewrite the plot wholesale. One concrete beat matching the intrusiveness mode.
${this._directorVoiceRules()}
- The "event" field is a stage beat, never a line or thought from the Star / {{user}}.
- "cast" may be the Director, supporting, absent, or in-play (name or id). Never the Star or a written-out member.
- "beat" / "hook" / "reward" only if they already exist on the floor — never invent filed records.
- Return ONLY JSON: {"fire":boolean,"event":"1-3 sentences if fire","tags":["optional","keywords"],"reason":"short why","cast":"","beat":"","hook":"","reward":{"kind":"achievement|item|secret","name":""}}
${pinned ? `
PINNED CUES (must use in the beat; fill JSON cast/beat/hook/reward from these):
${pinned}
` : ''}
FLOOR BRIEF:
${brief}

JSON:`;
      restoreRun();
      const raw = await this._quiet(prompt, { quietName: 'Director', profileSlot: 'event' });
      const parsed = parseJsonObject(raw);
      st.production.lastCheckAt = Date.now();
      if (!auto) st.production.msgSinceCheck = 0;
      const extras = { mode: mode.id };
      if (picks?.castId) extras.castId = picks.castId;
      if (picks?.hookIds?.[0]) extras.hookId = picks.hookIds[0];
      const hasBeat = !!(parsed?.event);
      const shouldFire = force ? hasBeat : !!(parsed?.fire && parsed.event);
      if (shouldFire) {
        const ev = hydrateFromDirectorJson(this.storage, parsed, extras);
        const text = ev?.text || String(parsed.event).trim().slice(0, 600);
        (st.production.eventLog ??= []).push({
          kind: 'event',
          text: `EVENT [${mode.label}] — ${text}`,
          at: Date.now(),
          event: ev,
        });
        if (st.production.queueComposer) {
          this.bus?.emit('composer.queueAudit', { reason: 'director-event', event: text });
        }
        if (ev) this._presentDirectorEvent(ev);
      } else if (force) {
        alert('Director returned no beat. Try again or pin a cue from the pool.');
      }
      st.production.eventLog = (st.production.eventLog || []).filter(e => e.kind === 'event').slice(-40);
      this.saveState();
    } catch (err) {
      console.error('[Backstage director]', err);
      if (!auto) alert(`Director check failed: ${err.message || err}`);
    } finally {
      restoreRun();
      this._busy = false;
      if (showProd) this.render(this.container);
    }
  }

  async _interviewNoteAsk(noteId, { about = false } = {}) {
    const card = NOTECARDS.find(c => c.id === noteId);
    if (!card) return;
    const st = this._db();
    const qEl = this.container.querySelector(`[data-note-q="${noteId}"]`);
    const tEl = this.container.querySelector(`[data-note-target="${noteId}"]`);
    const aEl = this.container.querySelector(`[data-note-about="${noteId}"]`);
    const qIdx = Math.min(Number(qEl?.value) || 0, card.questions.length - 1);
    const targetId = tEl?.value || '';
    const aboutText = String(aEl?.value || '').trim();
    if (!targetId) { alert('Pick a title on the notecard back.'); return; }
    if (about && !aboutText) {
      alert('Add a line in About this… first.');
      aEl?.focus();
      return;
    }
    st.interview.notePick ??= {};
    st.interview.notePick[noteId] = { q: qIdx, targetId, about: aboutText };
    this.saveState();
    const subjectId = st.interview.subjectId || this._interviewSubject()?.id;
    const target = this._noteTargets(noteId, subjectId).find(t => t.id === targetId);
    let question = `${card.questions[qIdx].text}${target ? ` — ${target.title}` : ''}`;
    if (about && aboutText) question = `${question} — About this: ${aboutText}`;
    await this._interviewTurn(question, noteId, {
      questionId: card.questions[qIdx].id,
      target,
      about: about ? aboutText : '',
    });
  }

  async _interviewFree() {
    const line = this.container.querySelector('[data-role="iv-line"]')?.value?.trim();
    if (!line) return;
    const input = this.container.querySelector('[data-role="iv-line"]');
    if (input) input.value = '';
    await this._interviewTurn(line, 'free');
  }

  _interviewSubject() {
    const st = this._db();
    const full = this._fullCast().filter(c => c.priority !== 'star' && c.priority !== 'director');
    return full.find(c => c.id === st.interview.subjectId) || full[0] || null;
  }

  _interviewerInfo() {
    const st = this._db();
    const mode = st.interview.interviewer || 'star';
    if (mode === 'anonymous') {
      return {
        name: 'Anonymous',
        anonymous: true,
        block: `INTERVIEWER: a faceless, nondescript stranger — no name, no affiliation, no reputation, no prior relationship.
The subject answers as if speaking to someone they cannot place.
Do NOT invent a known identity for the interviewer.`,
      };
    }
    if (mode === 'user') {
      const name = getContext()?.name1 || 'You';
      const star = getStarMember(this.storage);
      return {
        name,
        anonymous: false,
        block: `INTERVIEWER: {{user}} / ${name}${star ? ` (Star cast: ${star.name})` : ''}.
${this._repTowardBlock(star?.id || null, name)}`,
      };
    }
    let id = st.interview.interviewerId;
    if (mode === 'star' || !id) id = getStarMember(this.storage)?.id || id;
    const full = this._fullCast().find(c => c.id === id) || getStarMember(this.storage);
    if (!full) {
      return { name: 'Interviewer', anonymous: false, block: 'INTERVIEWER: (unspecified)' };
    }
    const ctx = getContext();
    const identity = resolveCastPromptIdentity(full, this.storage, {
      characters: ctx.characters ?? [],
      personas: listPersonas(power_user),
    });
    return {
      name: full.name,
      anonymous: false,
      block: `INTERVIEWER:\n${identity.block}\n${this._repTowardBlock(full.id, full.name)}`,
    };
  }

  async _interviewTurn(question, askKind = 'free', meta = {}, { replay = false } = {}) {
    const st = this._db();
    if (this._busy) return;
    const subject = this._interviewSubject();
    if (!subject) return;
    const interviewer = this._interviewerInfo();

    if (!replay) {
      (st.interview.turns ??= []).push({ who: 'user', name: interviewer.name, text: question, at: Date.now() });
    }
    st.interview.retry = null;
    this.saveState();
    this._busy = true;
    this._ivPinBottom = true;
    this.render(this.container);

    try {
      const dossier = this._subjectDossier(subject, askKind, meta.target);
      const aboutLine = String(meta.about || '').trim();
      const targetBlock = meta.target
        ? `ABOUT (private briefing for you only — never quote or restate this block; answer in spoken opinion/feeling):\n${meta.target.prompt || meta.target.title}${aboutLine ? `\nInterviewer angle — About this: ${aboutLine}` : ''}`
        : (aboutLine ? `ABOUT:\nInterviewer angle — About this: ${aboutLine}` : '');
      const history = (st.interview.turns || []).slice(-8)
        .map(t => `${t.name || (t.who === 'cast' ? subject.name : 'Interviewer')}: ${t.text}`).join('\n');
      const relationRule = interviewer.anonymous
        ? 'You do not know the interviewer. Give your opinion carefully, as you would to a stranger. Never recite standing numbers, dossier lines, or briefing text.'
        : `You are speaking WITH ${interviewer.name}. Use the established Connections / relationship context — tone, warmth, caution, and what you would actually say to them. Do not dump tracker data; speak in character.`;
      const prompt = `[System: Private interview. Output ONLY ${subject.name}'s spoken reply as dialogue/thought. No stage directions, no OOC, no JSON, no repeating these instructions, no quoting ABOUT/CHARACTER blocks.]

You are ${subject.name}. Stay in character.
Interviewer: ${interviewer.name}${interviewer.anonymous ? ' (faceless stranger)' : ''}.
${relationRule}

${interviewer.block}

=== CHARACTER ===
${dossier}

${targetBlock}

=== INTERVIEW SO FAR ===
${history || '(just starting)'}

=== QUESTION ===
${interviewer.name}: ${question}

=== YOUR REPLY (as ${subject.name}, 2–6 sentences of dialogue/thought only — opinion, not a file dump) ===`;

      let reply = await this._quiet(prompt, { quietName: subject.name, profileSlot: 'interview' });
      reply = this._cleanInterviewReply(reply, subject.name, prompt, meta.target);
      if (!reply) {
        const retry = `You are ${subject.name}. ${interviewer.name}${interviewer.anonymous ? ' (a stranger)' : ''} asks: ${question}

Answer in character as spoken words only (2–6 sentences). Do not quote briefing text, standing numbers, or system labels.${meta.target ? ` Topic: ${meta.target.title}.` : ''}

${subject.name}:`;
        reply = await this._quiet(retry, { quietName: subject.name, profileSlot: 'interview' });
        reply = this._cleanInterviewReply(reply, subject.name, retry, meta.target);
      }
      if (!reply) {
        st.interview.retry = { question, askKind, meta };
        this.saveState();
        return;
      }

      st.interview.turns.push({ who: 'cast', name: '', text: reply, at: Date.now() });

      const note = await this._interviewConnHarvest(subject, reply, question, askKind, meta.target);
      if (note) {
        st.interview.turns.push({ who: 'user', name: 'Connections', text: note, at: Date.now() });
      }

      if (st.interview.turns.length > 80) st.interview.turns = st.interview.turns.slice(-80);
      this.saveState();
      this.bus?.emit('showtime.stateChanged');
      this.bus?.emit('reputation.updated', {});
    } catch (err) {
      console.error('[Backstage interview]', err);
      st.interview.retry = { question, askKind, meta };
      this.saveState();
    } finally {
      this._busy = false;
      this._ivPinBottom = true;
      this.render(this.container);
    }
  }

  _cleanInterviewReply(raw, name, prompt, target = null) {
    let text = String(raw || '').trim();
    if (!text) return '';
    // Drop common instruction echoes / meta asides.
    const bad = [
      /reply generation lands next/i,
      /keep the character consistent/i,
      /answers honest/i,
      /tracked stats/i,
      /subject dossier/i,
      /private interview/i,
      /do not invent mechanical/i,
      /no stage directions/i,
      /YOUR REPLY/i,
      /TARGETED FILE/i,
      /ABOUT \(private briefing/i,
      /=== /i,
      /standing\s*-?\d{1,3}/i,
      /Reputation context/i,
      /known connection nodes/i,
    ];
    if (bad.some(re => re.test(text)) && text.length < 280) return '';
    // If the model returned a large chunk of the prompt, reject.
    if (prompt && text.length > 80) {
      const head = prompt.slice(0, 120).replace(/\s+/g, ' ');
      if (text.replace(/\s+/g, ' ').includes(head.slice(0, 60))) return '';
    }
    // Echo of the notecard briefing / reputation file dump.
    if (target?.prompt) {
      const bite = String(target.prompt).replace(/\s+/g, ' ').slice(0, 80);
      if (bite.length > 24 && text.replace(/\s+/g, ' ').includes(bite.slice(0, 48))) return '';
    }
    // Strip leading Name: / Name —
    const nameRe = new RegExp(`^${String(name || '').replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\s*[:\\—\\-–]\\s*`, 'i');
    text = text.replace(nameRe, '').trim();
    // Drop wrapping quotes
    if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith('“') && text.endsWith('”'))) {
      text = text.slice(1, -1).trim();
    }
    return text.slice(0, 2000);
  }

  /**
   * After an interview reply, optionally write Connections (Reputation):
   * - autofill what the subject thinks of a target (reading.take / standing)
   * - or start a rumor node on the web
   */
  async _interviewConnHarvest(subject, reply, question, askKind, target) {
    const group = String(target?.group || '');
    const connAsk = askKind === 'cast'
      || /Reputation|Affiliation|House|Secret/i.test(group)
      || /standing|think of|heard|rumor|whisper/i.test(String(question || ''));
    if (!connAsk || !reply) return '';

    try {
      const rep = this.storage.getChat('reputation', { personal: [], house: [] });
      if (!Array.isArray(rep.personal)) rep.personal = [];
      const subjectNode = this._ensureCastConnNode(rep, subject);
      if (!subjectNode) return '';

      const roster = (rep.personal || [])
        .filter(n => n.kind !== 'self' || n.id === 'self')
        .map(n => `- id=${n.id} · ${n.name} [${n.category || n.kind}]`)
        .slice(0, 40)
        .join('\n');

      const hintTarget = target?.id?.includes(':')
        ? target.id.split(':').slice(1).join(':')
        : '';
      const extractPrompt = `[System: Return ONLY JSON. No markdown.]
From this interview, decide if Connections should update.

Subject (speaker): ${subject.name} (node ${subjectNode.id})
Question: ${question}
Reply: ${reply}
${hintTarget ? `Notecard target id hint: ${hintTarget} (${group})` : ''}

Known connection nodes:
${roster || '(none yet)'}

Rules:
- Prefer action "reading" when they opine on a known person/house/notice — fill take (1–3 sentences) and standing (-100..100).
- Prefer action "rumor" when they start or spread gossip that isn't already a solid reading — set rumorTitle + aboutId (node id) + take.
- Use action "none" if nothing clear enough to file.
- targetId / aboutId MUST be an id from the list above when possible.

JSON schema:
{"action":"reading"|"rumor"|"none","targetId":"","aboutId":"","take":"","standing":0,"rumorTitle":""}`;

      const raw = await this._quiet(extractPrompt, { quietName: 'System', profileSlot: 'audit' });
      const parsed = parseJsonObject(raw);
      if (!parsed || parsed.action === 'none') return '';

      const clampStand = (v) => {
        const n = Number(v);
        if (!Number.isFinite(n)) return null;
        return Math.max(-100, Math.min(100, Math.round(n)));
      };
      const take = String(parsed.take || reply).trim().slice(0, 600);
      const ensureLink = (a, b) => {
        const A = rep.personal.find(n => n.id === a);
        const B = rep.personal.find(n => n.id === b);
        if (!A || !B) return;
        A.links ??= [];
        B.links ??= [];
        if (!A.links.includes(b)) A.links.push(b);
        if (!B.links.includes(a)) B.links.push(a);
      };

      if (parsed.action === 'reading') {
        let targetId = String(parsed.targetId || hintTarget || '').trim();
        if (!rep.personal.some(n => n.id === targetId)) {
          // Match by name fragment from question/target title
          const needle = String(target?.title || question || '').toLowerCase();
          const hit = rep.personal.find(n => needle.includes(String(n.name || '').toLowerCase()) && n.id !== subjectNode.id);
          if (hit) targetId = hit.id;
        }
        if (!targetId || targetId === subjectNode.id) return '';
        if (!rep.personal.some(n => n.id === targetId)) return '';

        subjectNode.readings ??= [];
        let rec = subjectNode.readings.find(r => r.targetId === targetId);
        if (!rec) {
          rec = { targetId, aware: 'knows', take: '' };
          subjectNode.readings.push(rec);
        }
        rec.aware = rec.aware === 'unaware' ? 'heard' : (rec.aware || 'knows');
        rec.take = take;
        const stand = clampStand(parsed.standing);
        if (stand != null) rec.standing = stand;
        ensureLink(subjectNode.id, targetId);
        this.storage.saveChat();
        const whom = rep.personal.find(n => n.id === targetId)?.name || targetId;
        return `Filed reading — ${subject.name} on ${whom}${stand != null ? ` (${stand})` : ''}.`;
      }

      if (parsed.action === 'rumor') {
        const aboutId = String(parsed.aboutId || parsed.targetId || hintTarget || '').trim();
        const about = rep.personal.find(n => n.id === aboutId);
        const title = String(parsed.rumorTitle || '').trim().slice(0, 80)
          || `Word on ${about?.name || 'the wire'}`;
        const id = uid();
        const orbit = (() => {
          const i = rep.personal.length;
          const a = (i * 2.4) % (Math.PI * 2);
          return { x: 0.5 + Math.cos(a) * 0.28, y: 0.5 + Math.sin(a) * 0.28 };
        })();
        const rumor = {
          id,
          kind: 'notice',
          category: 'rumor',
          characterId: '',
          houseId: '',
          originId: subjectNode.id,
          targetId: about?.id || '',
          supporters: [{ characterId: subject.id, role: 'Origin' }],
          name: title,
          description: take,
          notes: `From Backstage interview · ${new Date().toLocaleString()}`,
          standing: 0,
          x: orbit.x,
          y: orbit.y,
          links: [subjectNode.id, 'self'].filter(Boolean),
          readings: [],
        };
        rep.personal.push(rumor);
        ensureLink(subjectNode.id, id);
        if (about) ensureLink(id, about.id);
        const self = rep.personal.find(n => n.kind === 'self' || n.id === 'self');
        if (self) {
          self.links ??= [];
          if (!self.links.includes(id)) self.links.push(id);
        }
        this.storage.saveChat();
        return `Started rumor — “${title}”${about ? ` about ${about.name}` : ''}.`;
      }
    } catch (err) {
      console.warn('[Backstage interview → Connections]', err);
    }
    return '';
  }

  _ensureCastConnNode(rep, subject) {
    if (!subject?.id) return null;
    let node = (rep.personal || []).find(n => n.characterId === subject.id);
    if (node) return node;
    // Star often lives as self
    const star = getStarMember(this.storage);
    if (star?.id === subject.id) {
      node = (rep.personal || []).find(n => n.kind === 'self' || n.id === 'self');
      if (node) {
        node.characterId = subject.id;
        node.name = subject.name || node.name;
        return node;
      }
    }
    const i = (rep.personal || []).length;
    const a = (i * 2.4) % (Math.PI * 2);
    node = {
      id: uid(),
      kind: 'notice',
      category: 'individual',
      characterId: subject.id,
      houseId: '',
      name: subject.name,
      description: String(subject.description || '').slice(0, 400),
      notes: 'Auto-posted from Backstage interview',
      standing: 0,
      x: 0.5 + Math.cos(a) * 0.28,
      y: 0.5 + Math.sin(a) * 0.28,
      links: ['self'],
      readings: [],
    };
    rep.personal.push(node);
    const self = rep.personal.find(n => n.kind === 'self' || n.id === 'self');
    if (self) {
      self.links ??= [];
      if (!self.links.includes(node.id)) self.links.push(node.id);
    }
    return node;
  }

  /** Supporting cast only — never Star or Director. */
  _peanutCastPool() {
    const castFull = this._fullCast().filter(c =>
      c && c.priority !== 'director' && c.priority !== 'star');
    if (!castFull.length) return [];
    const ctx = getContext();
    const scored = castFull.map(c => {
      let identity = { description: '', personality: '', source: 'cast' };
      try {
        identity = resolveCastPromptIdentity(c, this.storage, {
          characters: ctx.characters ?? [],
          personas: listPersonas(power_user),
        }) || identity;
      } catch { /* keep fallback */ }
      const blurb = [
        identity.description,
        identity.personality,
        c.description,
        ...(c.wardrobe || []).map(w => w.name),
      ].filter(Boolean).join(' ').trim();
      const score = Math.max(1, blurb.length + (identity.source !== 'cast' ? 40 : 0));
      return { c, identity, blurb: blurb || c.name || 'on the balcony', score };
    });
    // Prefer richer cards, but never drop the whole pool.
    scored.sort((a, b) => b.score - a.score);
    for (let i = scored.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [scored[i], scored[j]] = [scored[j], scored[i]];
    }
    return scored;
  }

  _peanutFindNode(rep, castMember) {
    const nodes = Array.isArray(rep?.personal) ? rep.personal : [];
    if (!castMember) return null;
    const byId = nodes.find(n => n.characterId === castMember.id);
    if (byId) return byId;
    const nm = String(castMember.name || '').toLowerCase();
    return nm ? nodes.find(n => String(n.name || '').toLowerCase() === nm) : null;
  }

  _peanutBand(val) {
    if (val == null || val === '') return '—';
    const n = Number(val);
    if (!Number.isFinite(n)) return String(val);
    return `${standingInfo(n).label} (${n})`;
  }

  _peanutLibraryLeaves() {
    try {
      return listVisibleLibraryLeaves(this.storage).filter(l => !l.disabled);
    } catch {
      return [];
    }
  }

  _peanutStampLeaf(entry, leaves) {
    if (!entry) return null;
    return leaves.find(l =>
      (entry.key && l.key === entry.key)
      || (entry.book && entry.uid != null && l.book === entry.book && String(l.uid) === String(entry.uid))
      || (entry.book && entry.title && l.book === entry.book && l.title === entry.title))
      || null;
  }

  _peanutLoreBrief(speakers, source, scene = null) {
    try {
      const leaves = this._peanutLibraryLeaves();
      const hay = `${source || ''} ${(speakers || []).map(s => s.c?.name || '').join(' ')}`.toLowerCase();
      const stampLines = [];
      const tagBits = [];
      const seenLeaf = new Set();
      const seenTag = new Set();

      const pushTag = (type, value) => {
        const v = String(value || '').trim();
        if (!v) return;
        const id = `${String(type || 'tag').toLowerCase()}\u241f${v.toLowerCase()}`;
        if (seenTag.has(id)) return;
        seenTag.add(id);
        tagBits.push(type ? `${type}:${v}` : v);
      };

      const pushStamp = (leaf, entry) => {
        const key = leaf?.key || `${entry?.book || ''}::${entry?.uid || entry?.title || ''}`;
        if (!key || seenLeaf.has(key)) return;
        const body = String(leaf?.content || '').replace(/\s+/g, ' ').trim();
        if (!body) return;
        seenLeaf.add(key);
        for (const t of (leaf.tags || [])) pushTag(t.type, t.value);
        const tags = (leaf.tags || []).map(t => t.value).filter(Boolean).slice(0, 4);
        stampLines.push(`⌘ ${leaf.title || entry?.title || 'lore'}${tags.length ? ` 〔${tags.join(', ')}〕` : ''}: ${body.slice(0, 220)}`);
      };

      const considerCard = (row, force) => {
        const card = row?.card || row;
        if (!card) return;
        const code = row.code || '';
        const title = row.title || card.title || '';
        const facets = flattenFacets(card.keywordFacets);
        const hit = force
          || textMatchesHay(title, hay)
          || textMatchesHay(code, hay)
          || facets.some(k => textMatchesHay(k, hay));
        if (!hit) return;
        for (const k of facets) pushTag('facet', k);
        const entries = Array.isArray(card.sourceStamp?.entries) ? card.sourceStamp.entries : [];
        for (const e of entries) {
          const leaf = this._peanutStampLeaf(e, leaves);
          if (leaf) pushStamp(leaf, e);
        }
      };

      if (scene) considerCard(scene, true);
      for (const row of getSceneCards(this.storage)) {
        if (scene && row.uid === scene.uid) continue;
        considerCard(row, false);
      }

      for (const leaf of leaves) {
        if (stampLines.length >= 6) break;
        if (seenLeaf.has(leaf.key)) continue;
        const keys = [...(leaf.keys || []), leaf.title, ...(leaf.tags || []).map(t => t.value)];
        if (!keys.some(k => k && textMatchesHay(k, hay))) continue;
        pushStamp(leaf, { title: leaf.title });
      }

      const lines = [];
      if (tagBits.length) lines.push(`Tags: ${tagBits.slice(0, 18).join(', ')}`);
      lines.push(...stampLines.slice(0, 6));
      return lines.join('\n') || '(none stamped or tagged in play)';
    } catch {
      return '(unavailable)';
    }
  }

  _peanutConnectionsBrief(speakers) {
    try {
      const rep = this.storage.getChat('reputation', { personal: [], house: [] });
      const secrets = listPlaySecrets(this.storage);
      const lines = [];
      for (const s of speakers) {
        const node = this._peanutFindNode(rep, s.c);
        const bits = [];
        const starStand = standingToward(this.storage, `cast:${s.c.id}`);
        if (starStand != null) bits.push(`toward Star: ${this._peanutBand(starStand)}`);
        for (const other of speakers) {
          if (other.c.id === s.c.id) continue;
          const otherNode = this._peanutFindNode(rep, other.c);
          if (!otherNode || !node) continue;
          const reading = (node.readings || []).find(r => r.targetId === otherNode.id);
          const linked = (node.links || []).includes(otherNode.id)
            || (otherNode.links || []).includes(node.id);
          if (reading) {
            const take = clipText(reading.take || '', 100);
            bits.push(`toward ${other.c.name}: ${this._peanutBand(reading.standing)}${take ? `; ${take}` : ''}`);
          } else if (linked) {
            bits.push(`linked to ${other.c.name}`);
          }
        }
        const houses = characterHouseIds(this.storage, s.c.id);
        for (const h of (rep.house || [])) {
          const hit = h.headId === s.c.id || (h.connections || []).some(c => c.characterId === s.c.id);
          if (!hit) continue;
          const hStand = standingToward(this.storage, `house:${h.id}`);
          bits.push(`affiliation ${h.alias || h.name}${hStand != null ? ` (house→Star ${this._peanutBand(hStand)})` : ''}`);
        }
        const owned = secretsAboutCharacter(secrets, s.c.id);
        const known = secretsKnownToCharacter(secrets, s.c.id, houses);
        const unaware = secrets.filter(sec => (sec.unawareBy || []).some(k =>
          (k.type === 'cast' && k.id === s.c.id)
          || (k.type === 'house' && houses.includes(k.id))));
        if (owned.length) bits.push(`owns ${owned.slice(0, 3).map(x => `“${x.title}”`).join(', ')}`);
        if (known.length) bits.push(`knows ${known.slice(0, 3).map(x => `“${x.title}”`).join(', ')}`);
        if (unaware.length) bits.push(`unaware of ${unaware.slice(0, 3).map(x => `“${x.title}”`).join(', ')}`);
        if (!bits.length) continue;
        lines.push(`- ${s.c.name}: ${bits.join(' · ')}`);
      }
      return lines.join('\n') || '(none)';
    } catch {
      return '(unavailable)';
    }
  }

  _peanutPickSpeakers(preferNames = []) {
    const pool = this._peanutCastPool();
    if (!pool.length) {
      throw new Error('No supporting cast for the gallery — add cast cards that are not Star or Director.');
    }
    const preferred = new Set((preferNames || []).map(n => String(n).toLowerCase()));
    let rep = { personal: [] };
    try { rep = this.storage.getChat('reputation', { personal: [], house: [] }); } catch { /* ignore */ }

    const connScore = (row) => {
      const node = this._peanutFindNode(rep, row.c);
      if (!node) return 0;
      let n = (node.links || []).length + (node.readings || []).length;
      if (preferred.has(String(row.c.name || '').toLowerCase())) n += 20;
      return n;
    };

    const ranked = [...pool].sort((a, b) => {
      const pa = preferred.has(String(a.c.name || '').toLowerCase()) ? 1 : 0;
      const pb = preferred.has(String(b.c.name || '').toLowerCase()) ? 1 : 0;
      if (pb !== pa) return pb - pa;
      return connScore(b) - connScore(a);
    });

    // Prefer a connected clique when possible.
    const picked = [];
    for (const row of ranked) {
      if (picked.length >= 6) break;
      if (!picked.length) { picked.push(row); continue; }
      const node = this._peanutFindNode(rep, row.c);
      const tied = picked.some(p => {
        const pn = this._peanutFindNode(rep, p.c);
        if (!node || !pn) return false;
        return (node.links || []).includes(pn.id)
          || (pn.links || []).includes(node.id)
          || (node.readings || []).some(r => r.targetId === pn.id)
          || (pn.readings || []).some(r => r.targetId === node.id);
      });
      if (tied || picked.length < 3 || ranked.length <= 4) picked.push(row);
    }
    while (picked.length < Math.min(3, ranked.length)) {
      const next = ranked.find(r => !picked.includes(r));
      if (!next) break;
      picked.push(next);
    }
    if (!picked.length) picked.push(ranked[0]);
    // Shuffle speaking order so the model isn't led by a fixed cast sequence.
    const slice = picked.slice(0, Math.min(6, Math.max(1, picked.length)));
    for (let i = slice.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [slice[i], slice[j]] = [slice[j], slice[i]];
    }
    return slice;
  }

  /** How many new balcony lines to request. Continue ≈ 2× Listen depth. */
  _peanutWantCount(speakerCount, { continueThread = false } = {}) {
    const n = Math.max(1, Number(speakerCount) || 1);
    // Listen: a partial handful — not one-per-speaker.
    const listenBase = Math.min(Math.max(2, Math.ceil(n * 0.6)), Math.min(5, n));
    const want = continueThread ? listenBase * 2 : listenBase;
    return Math.min(Math.max(want, continueThread ? 4 : 2), continueThread ? 12 : 6);
  }

  _peanutLineBad(text) {
    const t = String(text || '').trim();
    if (!t) return true;
    // Leaked instructions / meta
    if (/valid\s*json|write as the character|canonical personality|narrative depth|blending their|strictly in valid|no markdown|json array|keys name\+?text|no preamble|peanut-gallery chat lines|only these speakers|TASK:\s*Peanut|You are NOT writing/i.test(t)) {
      return true;
    }
    // Clear third-person scene openings (not casual "She's wild")
    if (/^(it was a|there was a|there were|meanwhile[, ]|later that|the next (day|morning|evening)|she found (her|him)self|he found (him|her)self)\b/i.test(t)) {
      return true;
    }
    if (/\b(found herself|found himself|her ears caught|standing at the intersection|unglamorous errands)\b/i.test(t)) {
      return true;
    }
    // Very long literary prose only
    if (t.length > 480) return true;
    return false;
  }

  _parsePeanutComments(raw, names, { maxOut = 9 } = {}) {
    const cleaned = String(raw || '')
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2018\u2019]/g, "'");
    let arr = parseJsonArray(cleaned);
    if (!arr?.length) {
      const obj = parseJsonObject(cleaned);
      if (Array.isArray(obj?.comments)) arr = obj.comments;
      else if (obj?.name && obj?.text) arr = [obj];
      else if (Array.isArray(obj?.gallery)) arr = obj.gallery;
      else if (Array.isArray(obj?.lines)) arr = obj.lines;
    }
    if (!arr?.length) {
      const lines = cleaned.split(/\n+/).map(l => l.trim()).filter(Boolean);
      const loose = [];
      for (const line of lines) {
        const m = line.match(/^[-*•\d.)\]]*\s*"?([^"\n:]{1,64}?)"?\s*[:：\-—]\s*"?(.+?)"?\s*,?\s*$/);
        if (!m) continue;
        const name = m[1].replace(/^["'{]|["'}]$/g, '').trim();
        const text = m[2].replace(/^["']|["']$/g, '').replace(/\}?\s*,?\s*$/, '').trim();
        if (name && text) loose.push({ name, text });
      }
      if (loose.length) arr = loose;
    }
    const star = getStarMember(this.storage);
    const banned = new Set([
      'director',
      'star',
      'system',
      'peanutgallery',
      'peanut gallery',
      String(star?.name || '').toLowerCase(),
      String(getContext()?.name1 || '').toLowerCase(),
    ].filter(Boolean));
    const resolveName = (rawName) => {
      const key = String(rawName || '').trim().toLowerCase().replace(/^["']|["']$/g, '');
      if (!key || banned.has(key)) return '';
      const exact = names.find(n => n.toLowerCase() === key);
      if (exact) return exact;
      // First token match: "Mirko" → "Mirko, the Killer Bunny"
      const keyFirst = key.split(/[\s,]+/)[0];
      const fuzzy = names.find(n => {
        const nl = n.toLowerCase();
        const first = nl.split(/[\s,]+/)[0];
        return nl === key
          || first === keyFirst
          || nl.startsWith(key)
          || key.startsWith(first)
          || nl.includes(key)
          || key.includes(first);
      });
      return fuzzy || '';
    };
    const out = [];
    const seen = new Set();
    const cap = Math.max(1, Math.min(14, Number(maxOut) || 9));
    for (const c of (arr || [])) {
      if (!c) continue;
      const text = String(c.text || c.comment || c.line || c.message || '').trim().slice(0, 360);
      if (!text || /watching closely/i.test(text) || this._peanutLineBad(text)) continue;
      const name = resolveName(c.name || c.speaker || c.who || c.character);
      if (!name) continue;
      const sig = `${name.toLowerCase()}::${text.toLowerCase()}`;
      if (seen.has(sig)) continue;
      seen.add(sig);
      out.push({ name, text });
      if (out.length >= cap) break;
    }
    return out;
  }

  /** Only keep explicit Name: chat lines that look like reactions — never dump narration onto speakers. */
  _peanutCommentsFromProse(raw, names) {
    const text = String(raw || '').replace(/```[\s\S]*?```/g, '').trim();
    if (!text || text.length < 8) return [];
    const out = [];
    const seen = new Set();
    for (const name of names) {
      const escName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`(?:^|[\\n\\r])\\s*(?:[-*•\\d.)\\]]\\s*)?${escName}\\s*[:：\\-—]\\s*(.+)`, 'i');
      const m = text.match(re);
      if (!m) continue;
      const line = m[1].replace(/^["']|["']$/g, '').trim().slice(0, 360);
      if (!line || seen.has(name) || this._peanutLineBad(line)) continue;
      seen.add(name);
      out.push({ name, text: line });
    }
    // First-token fallback when model shortens "Mirko, the Killer Bunny" → "Mirko:"
    if (!out.length) {
      for (const name of names) {
        const first = String(name).split(/[\s,]+/)[0];
        if (!first || first.length < 2) continue;
        const re = new RegExp(`(?:^|[\\n\\r])\\s*${first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[:：\\-—]\\s*(.+)`, 'i');
        const m = text.match(re);
        if (!m || seen.has(name)) continue;
        const line = m[1].replace(/^["']|["']$/g, '').trim().slice(0, 360);
        if (!line || this._peanutLineBad(line)) continue;
        seen.add(name);
        out.push({ name, text: line });
      }
    }
    return out;
  }

  _peanutPrompt({ names, castBlock, connBrief, loreBrief = '', label, source, want, continueThread = '' }) {
    const shuffled = [...names].sort(() => Math.random() - 0.5);
    const exA = shuffled[0] || 'CastA';
    const exB = shuffled[Math.min(1, shuffled.length - 1)] || exA;
    const banterRule = continueThread
      ? `REQUIRED: At least half the lines must answer, rib, quote, or disagree with a PRIOR balcony line (name-check who you're talking to). Do not ignore the prior chat.`
      : `REQUIRED: Speakers talk to EACH OTHER about the scene — address someone by name, pile on, contradict, or riff. Not ${want} isolated monologues.`;
    return `You write balcony / stream-chat reactions. You are NOT writing the scene. Speakers are watching, not performing.

Available speakers (use these exact name strings when they speak):
${shuffled.map(n => `- ${n}`).join('\n')}

Tone hints (do not quote):
${castBlock}

How they feel about each other and the Star (use for tone, digs, alliances, and what they would never say):
${connBrief}

Filed lore, stamps, and tags in play (in-jokes and accurate references — do not recap dump. A speaker may only allude to a secret they own or know; never leak what they are unaware of):
${loreBrief || '(none stamped or tagged in play)'}

${continueThread ? `Prior balcony chat (react to THESE lines):\n${continueThread}\n\n` : ''}Scene they are watching (${label}):
${String(source).slice(0, 2400)}

${banterRule}

IMPORTANT:
- NOT every listed speaker must talk. Some may stay quiet.
- Speakers may appear in ANY order (not roster order).
- The same speaker may speak more than once; others may speak zero times.
- Return exactly ${want} chat lines total.
- Be specific: name a beat, tag, stamped fact, or relationship when it would sting or land.

Return ONLY a JSON array of ${want} objects: {"name":"...","text":"..."}.
Each text = one spoken reaction (under 45 words), first person or banter.

Good (partial cast, mixed order):
[{"name":"${exA}","text":"${exB.split(/[\s,]/)[0]}, that stamp? You knew and you still walked in."},{"name":"${exB}","text":"Sit down. I knew enough — not that."}]

No narration. No markdown fences. No preamble.`;
  }

  async _withEventProfile(fn) {
    return withShowtimeProfile(this.storage, 'event', fn);
  }

  /** Isolated generation for Peanut Gallery — no chat history / card bleed. */
  async _peanutGenerate(prompt) {
    const text = String(prompt || '').trim();
    if (!text) return '';
    const jsonSchema = {
      name: 'peanut_gallery',
      description: 'Balcony chat reactions',
      strict: false,
      returnInvalid: true,
      value: {
        type: 'array',
        minItems: 1,
        maxItems: 14,
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            text: { type: 'string' },
          },
          required: ['name', 'text'],
        },
      },
    };
    const runRaw = async (useSchema) => {
      try {
        return await pinnedGenerateRaw({
          prompt: text,
          systemPrompt: `${SYSTEM_VOICE} Output a JSON array of balcony chat reactions only. No scene writing. No markdown.`,
          jsonSchema: useSchema ? jsonSchema : null,
          responseLength: 2000,
        });
      } catch (err) {
        console.warn('[Backstage peanut generateRaw]', err);
        return '';
      }
    };
    return this._withEventProfile(async () => {
      let raw = await runRaw(true);
      if (!raw) raw = await runRaw(false);
      return raw;
    });
  }

  /** chatMetadata is swapped (a new object) whenever the chat changes — hold
   * this and re-check it after an await so a long generation can't write its
   * result into a chat metadata object that's no longer the active one. */
  _chatToken() {
    try { return getContext()?.chatMetadata ?? null; } catch { return null; }
  }

  _chatTokenStillValid(token) {
    return this._chatToken() === token;
  }

  async _listen() {
    const st = this._db();
    if (this._busy) return;
    const chatToken = this._chatToken();
    this._busy = true;
    this.render(this.container);
    try {
      const { label, source, scene } = this._peanutSource(st);
      const speakers = this._peanutPickSpeakers();
      const castBlock = speakers.map(s => {
        const tip = String(s.blurb || s.identity?.description || s.c.priority || 'cast')
          .replace(/\s+/g, ' ').trim().slice(0, 160);
        return `- ${s.c.name}: ${tip}`;
      }).join('\n');
      const names = speakers.map(s => s.c.name);
      const connBrief = this._peanutConnectionsBrief(speakers);
      const loreBrief = this._peanutLoreBrief(speakers, source, scene);
      const want = this._peanutWantCount(names.length, { continueThread: false });

      const prompt = this._peanutPrompt({ names, castBlock, connBrief, loreBrief, label, source, want });
      let raw = await this._peanutGenerate(prompt);
      let comments = this._parsePeanutComments(raw, names, { maxOut: want + 2 });
      if (!comments.length) {
        const retry = `JSON array only. ${want} REACTION lines. Not everyone must speak. Any order.
Exact names (pool): ${names.join(' | ')}
Watching: ${String(source).slice(0, 900)}
Lore/tags: ${String(loreBrief).slice(0, 500)}
Ties: ${String(connBrief).slice(0, 400)}
[{"name":"${names[0]}","text":"${(names[1] || names[0]).split(/[\s,]/)[0]}, that stamp? You knew."}${names.length > 1 ? `,{"name":"${names[1]}","text":"Sit down — I knew enough, not that."}` : ''}]`;
        raw = await this._peanutGenerate(retry);
        comments = this._parsePeanutComments(raw, names, { maxOut: want + 2 });
      }
      if (!comments.length) comments = this._peanutCommentsFromProse(raw, names);
      if (!comments.length) {
        console.warn('[Backstage peanut] empty/bad parse', String(raw || '').slice(0, 800));
        throw new Error(raw
          ? 'Gallery returned unusable text — try Listen again.'
          : 'Model returned nothing — check API / Event connection profile in Backstage Settings.');
      }
      if (!this._chatTokenStillValid(chatToken)) {
        throw new Error('Chat changed while listening — result discarded. Switch back and try again.');
      }
      (st.peanut.sessions ??= []).push({
        id: uid(),
        label,
        at: Date.now(),
        comments,
      });
      if (st.peanut.sessions.length > 24) st.peanut.sessions.shift();
      // New topic always becomes the one being viewed/continued.
      st.peanut.activeIdx = st.peanut.sessions.length - 1;
      this._pgPinBottom = true;
      this.saveState();
    } catch (err) {
      console.error('[Backstage peanut]', err);
      alert(`Listen failed: ${err.message || err}`);
    } finally {
      this._busy = false;
      this.render(this.container);
    }
  }

  async _peanutContinue() {
    const st = this._db();
    if (this._busy) return;
    const sessions = st.peanut.sessions || [];
    const active = sessions[this._pgActiveIdx(st)];
    if (!active?.comments?.length) {
      alert('Nothing to continue — Listen… first.');
      return;
    }
    const chatToken = this._chatToken();
    this._busy = true;
    this.render(this.container);
    try {
      const priorNames = [...new Set(active.comments.map(c => c.name).filter(Boolean))];
      const speakers = this._peanutPickSpeakers(priorNames);
      const names = speakers.map(s => s.c.name);
      const castBlock = speakers.map(s => {
        const tip = String(s.blurb || s.identity?.description || s.c.priority || 'cast')
          .replace(/\s+/g, ' ').trim().slice(0, 160);
        return `- ${s.c.name}: ${tip}`;
      }).join('\n');
      const connBrief = this._peanutConnectionsBrief(speakers);
      // Keep prior thread intact for context (don't strip with reaction filter)
      const thread = active.comments
        .slice(-14)
        .map(c => `${c.name}: ${c.text}`)
        .join('\n');
      let sourceBit = '';
      let label = active.label || 'balcony';
      let scene = null;
      let loreBrief = '(none)';
      try {
        const src = this._peanutSource(st);
        label = src.label;
        scene = src.scene || null;
        sourceBit = src.source.slice(0, 2200);
        loreBrief = this._peanutLoreBrief(speakers, src.source, scene);
      } catch {
        sourceBit = active.label || 'ongoing balcony chat';
      }
      const want = this._peanutWantCount(names.length, { continueThread: true });

      const prompt = this._peanutPrompt({
        names,
        castBlock,
        connBrief,
        loreBrief,
        label,
        source: sourceBit,
        want,
        continueThread: thread || '(none yet)',
      });
      let raw = await this._peanutGenerate(prompt);
      let next = this._parsePeanutComments(raw, names, { maxOut: want + 2 });
      if (!next.length) {
        raw = await this._peanutGenerate(
          `Continue the balcony chat. JSON array of ${want} reactions (about twice a Listen pass).
Not everyone must speak; any order; someone may speak twice.
At least half must reply to someone in Prior (name them). Use filed lore/tags/ties when they sting.
Names (pool): ${names.join(' | ')}
Lore/tags: ${String(loreBrief).slice(0, 400)}
Ties: ${String(connBrief).slice(0, 300)}
Prior:
${thread.slice(-900)}
Example: [{"name":"${names[0]}","text":"${(names[1] || names[0]).split(/[\s,]/)[0]} — you're not wrong."}]`,
        );
        next = this._parsePeanutComments(raw, names, { maxOut: want + 2 });
      }
      if (!next.length) next = this._peanutCommentsFromProse(raw, names);
      if (!next.length) {
        console.warn('[Backstage peanut continue] empty/bad parse', String(raw || '').slice(0, 800));
        throw new Error(raw
          ? 'Continue returned unusable text — try again.'
          : 'Model returned nothing — check API / Event connection profile in Backstage Settings.');
      }
      if (!this._chatTokenStillValid(chatToken)) {
        throw new Error('Chat changed while listening — result discarded. Switch back and try again.');
      }
      active.comments = [...(active.comments || []), ...next].slice(-60);
      active.at = Date.now();
      this._pgPinBottom = true;
      this.saveState();
    } catch (err) {
      console.error('[Backstage peanut continue]', err);
      alert(`Continue failed: ${err.message || err}`);
    } finally {
      this._busy = false;
      this.render(this.container);
    }
  }

  // ── generation helpers ─────────────────────────────────────────────────────

  _fullCast() {
    try {
      return this.storage.getChat('cast', { characters: [] }).characters || [];
    } catch {
      return [];
    }
  }

  async _quiet(prompt, { quietName = 'System', profileSlot = '' } = {}) {
    const text = String(prompt || '');
    const filing = quietName === 'System' || profileSlot === 'audit';
    const go = () => leanQuietGenerate(text, {
      kind: filing ? 'filing' : 'voice',
      responseLength: filing ? 3200 : 1600,
      fallback: filing ? null : { quietPrompt: text, trimToSentence: false, skipWIAN: true, quietName },
    });
    if (profileSlot) return withShowtimeProfile(this.storage, profileSlot, go);
    return go();
  }

  _profileOpts(selected) {
    return [
      `<option value="">— Current (default) —</option>`,
      ...this._profiles.map(p =>
        `<option value="${esc(p.id)}" ${p.id === selected ? 'selected' : ''}>${esc(p.name)}</option>`),
    ].join('');
  }

  _saveProfileSlot(slot, value) {
    const g = this._g();
    g.profiles ??= { audit: '', motivation: '', event: '', interview: '' };
    g.profiles[slot] = String(value || '');
    this._saveG();
  }

  _chatSlice(from, to) {
    const chat = getContext()?.chat ?? [];
    const rows = chat.map((m, index) => ({
      index,
      name: m?.name || (m?.is_user ? 'You' : 'Char'),
      text: String(m?.mes || '').replace(/<[^>]+>/g, ' ').trim(),
      is_user: !!m?.is_user,
    })).filter(m => m.text);
    if (from == null && to == null) return rows;
    const lo = Math.min(Number(from) || 0, Number(to) || 0);
    const hi = Math.max(Number(from) || 0, Number(to) || 0);
    return rows.filter(m => m.index >= lo && m.index <= hi);
  }

  _directorCardBlock() {
    return formatDirectorPromptBlock(this.storage);
  }

  _directorVoiceRules() {
    const star = getStarMember(this.storage);
    const starName = star?.name || '{{user}}';
    return `- VOICE: you are the Director, not ${starName}, not {{user}}, not the Star.
- Write third-person stage direction / world beats only.
- Never first-person as ${starName} ("I walk…", "I notice…").
- Never a spoken line or inner thought belonging to the Star / player.`;
  }

  _directorBrief() {
    const st = this._db();
    const src = st.production.sources || DEFAULT_SOURCES();
    const parts = [];
    const recent = this._chatSlice().slice(-14)
      .map(m => `[${m.index}] ${m.name}: ${m.text.slice(0, 280)}`).join('\n');
    parts.push(`RECENT CHAT:\n${recent || '(empty)'}`);

    const cast = getCastMembers(this.storage)
      .map(c => `- ${c.name} (${c.priority || 'cast'})`)
      .join('\n') || '(none)';
    parts.push(`CAST:\n${cast}`);

    const hooks = this._plotHooksBrief();
    if (hooks) parts.push(`ACTIVE PLOT HOOKS (prefer cueing from these):\n${hooks}`);

    if (src.tags) {
      parts.push(`TAG LIMITS (prefer events that touch these facets):\n${this._tagBrief(src.tagFacets)}`);
    }
    if (src.stage !== false) {
      parts.push(`STAGE / SET (rooms, location tags, sonar):\n${this._stageBrief()}`);
    }
    if (src.inventory) {
      const items = normalizeTrackers(st.trackers).items;
      if (items.directorCanSee !== false) {
        parts.push(`INVENTORY:\n${this._inventoryBrief(src)}${items.directorCanMutate ? '\n(Director may cue removing/changing trunk items not on the player.)' : '\n(Director may reference items but should not invent inventory edits.)'}`);
      }
    }
    if (src.script) {
      parts.push(`SCRIPT (past events / callbacks / timeline):\n${this._scriptBrief()}`);
    }
    if (src.events !== false) {
      parts.push(`EVENTS & HOLIDAYS (composed production cards — prefer these when timing/cast fits):\n${this._eventsBrief()}`);
    }
    if (src.library) {
      parts.push(`LIBRARY (keywords / glossary):\n${this._libraryBrief()}`);
    }
    if (src.reputation) {
      parts.push(`REPUTATION (established connections):\n${this._reputationBrief()}`);
    }
    if (src.motivation) {
      parts.push(`MOTIVATION (secrets & beats):\n${this._motivationBrief()}`);
    }

    const pending = st.production?.pendingEvent?.text;
    parts.push(`PENDING EVENT (already queued, avoid duplicates):\n${pending || '(none)'}`);
    return parts.join('\n\n');
  }

  _plotHooksBrief() {
    try {
      const director = this._fullCast().find(c => c.priority === 'director');
      const hooks = (director?.plotHooks ?? [])
        .map(h => normalizePlotHook(h))
        .filter(h => h && h.active !== false);
      if (!hooks.length) return '';
      return hooks.map(h => `- ${formatPlotHookLine(h, this.storage).slice(0, 280)}`).join('\n');
    } catch {
      return '';
    }
  }

  _eventsBrief() {
    try {
      const events = this._listEventCards().slice(0, 12);
      if (!events.length) return '(none composed yet — use Events & Holidays → Compose event)';
      return events.map(ev => {
        const when = ev.timeKey || ev.keywordFacets?.datetime?.[0] || 'unscheduled';
        const credits = (ev.credits || []).map(c => c.name).filter(Boolean).slice(0, 5).join(', ');
        const sum = String(ev.summary || ev.content || '').replace(/\s+/g, ' ').trim().slice(0, 200);
        const flags = [ev.pinned ? 'pinned' : '', ev.timeLocked ? 'locked' : ''].filter(Boolean).join(', ');
        return `- ${ev.title || 'Untitled'} 〔${when}${flags ? ` · ${flags}` : ''}〕${credits ? ` · cast: ${credits}` : ''}${sum ? `\n  ${sum}` : ''}`;
      }).join('\n');
    } catch {
      return '(unavailable)';
    }
  }

  _tagBrief(facets = {}) {
    const want = {
      location: facets.location !== false,
      cast: facets.cast !== false,
      item: facets.item !== false,
      time: facets.time !== false,
      mood: facets.mood !== false,
    };
    const bags = { location: [], cast: [], item: [], time: [], mood: [] };
    try {
      for (const s of getSceneCards(this.storage).slice(0, 24)) {
        const f = s.card?.keywordFacets || {};
        if (want.location) bags.location.push(...(f.location || []));
        if (want.item) bags.item.push(...(f.objects || []));
        if (want.cast) bags.cast.push(...(f.characters || []));
        if (want.time) {
          bags.time.push(...(f.datetime || []));
          if (s.card?.timestamp) bags.time.push(s.card.timestamp);
        }
        if (want.mood && Array.isArray(f.mood)) bags.mood.push(...f.mood);
        for (const t of (s.card?.tags || [])) {
          const str = String(t);
          if (want.mood && /mood/i.test(str)) bags.mood.push(str);
        }
      }
    } catch { /* ignore */ }
    try {
      for (const leaf of listVisibleLibraryLeaves(this.storage).slice(0, 40)) {
        for (const t of leaf.tags || []) {
          const type = String(t.type || '').toLowerCase();
          const val = t.value || t;
          if (want.location && /place|location|era/.test(type)) bags.location.push(val);
          if (want.cast && /person|cast|character/.test(type)) bags.cast.push(val);
          if (want.item && /object|item/.test(type)) bags.item.push(val);
          if (want.time && /era|time|event/.test(type)) bags.time.push(val);
        }
        if (want.item && leaf.keywords?.length) bags.item.push(...leaf.keywords.slice(0, 3));
      }
    } catch { /* ignore */ }
    if (want.location) {
      try {
        collectActiveLocationTags(this.storage).forEach(t => bags.location.push(t));
      } catch { /* ignore */ }
      try {
        const compass = ensureCompass(this._db());
        for (const place of Object.values(compass.rooms || {})) {
          for (const tag of place.locationTags || []) bags.location.push(tag);
          if (place.name) bags.location.push(place.name);
        }
      } catch { /* ignore */ }
    }
    const line = (key, arr) => {
      if (!want[key]) return null;
      const uniq = [...new Set(arr.map(x => String(x).trim()).filter(Boolean))].slice(0, 14);
      return `- ${key}: ${uniq.join(', ') || '(none filed)'}`;
    };
    return ['location', 'cast', 'item', 'time', 'mood'].map(k => line(k, bags[k])).filter(Boolean).join('\n') || '(no tags)';
  }

  _stageBrief() {
    try {
      const st = this._db();
      const compass = ensureCompass(st);
      this._runSonar(compass);
      const places = Object.values(compass.rooms || {});
      if (!places.length) return '(no places on the Set yet)';
      const active = getActiveRoom(compass);
      const reach = normalizeTrackers(st.trackers).location.sonarReach || 'adjacent';
      const lines = places
        .slice()
        .sort((a, b) => String(a.name).localeCompare(String(b.name)))
        .slice(0, 10)
        .map(p => {
          const tags = (p.locationTags || []).slice(0, 4).join(', ') || '—';
          const on = active && p.id === active.id ? ' ●loaded' : '';
          return `- ${p.name} (${p.kind})${on} · tags: ${tags}`;
        });
      let sonar = '';
      const lastKey = compass.sonar?.lastKey || '';
      const lastPlace = compass.sonar?.lastPlaceId ? getPlace(compass, compass.sonar.lastPlaceId) : null;
      if (lastKey) {
        sonar = `\nSonar last key: ${lastKey}${lastPlace ? ` → ${lastPlace.name}` : ' (no matching place)'}`;
      }
      if (active) {
        const pings = listSonarPingsInPlace(compass, active.id);
        if (pings.length) {
          sonar += `\nSonar in ${active.name}: ${pings.map(p => `${p.name}@${p.cell}`).join(' · ')}`;
        }
      }
      const live = collectActiveLocationTags(this.storage);
      return `Sonar reach setting: ${reach}\nActive location keys: ${live.join(', ') || '(none)'}\nPlaces:\n${lines.join('\n')}${sonar}`;
    } catch {
      return '(unavailable)';
    }
  }

  _inventoryBrief(src) {
    try {
      const inv = this.storage.getChat('inventory', { static: [], mobile: [] });
      const rows = [];
      if (src.inventoryOnPerson !== false) {
        for (const it of (inv.mobile || []).slice(0, 12)) {
          rows.push(`- [On Person] ${it.name}${it.category ? ` (${it.category})` : ''}${it.equippedTo?.name ? ` → ${it.equippedTo.name}` : ''}`);
        }
      }
      if (src.inventoryTrunk !== false) {
        for (const it of (inv.static || []).slice(0, 12)) {
          rows.push(`- [Trunk] ${it.name}${it.category ? ` (${it.category})` : ''}`);
        }
      }
      return rows.join('\n') || '(none in allowed pockets)';
    } catch {
      return '(unavailable)';
    }
  }

  _scriptBrief() {
    const src = this._db().production?.sources || DEFAULT_SOURCES();
    const wantStamp = !!src.scriptStampedLore;
    let leaves = null;
    if (wantStamp) {
      try {
        leaves = listLibraryLeaves(this.storage, getCachedLibraryBooks());
      } catch {
        leaves = [];
      }
    }
    return getSceneCards(this.storage).slice(0, 14).map(s => {
      const card = s.card || s;
      const sum = String(card?.summary || card?.content || '').replace(/\s+/g, ' ').slice(0, 160);
      const lines = [`- ${s.code} ${s.title}${sum ? `: ${sum}` : ''}`];
      if (wantStamp && leaves) {
        const stamp = card?.sourceStamp;
        const entries = Array.isArray(stamp?.entries) ? stamp.entries : [];
        for (const e of entries) {
          const leaf = leaves.find(l =>
            (e.key && l.key === e.key)
            || (e.book && e.uid != null && l.book === e.book && String(l.uid) === String(e.uid))
            || (e.book && e.title && l.book === e.book && l.title === e.title));
          const body = String(leaf?.content || '').replace(/\s+/g, ' ').trim().slice(0, 220);
          if (!body) continue;
          lines.push(`  ⌘ ${leaf.title || e.title || 'lore'}: ${body}`);
        }
      }
      return lines.join('\n');
    }).join('\n') || '(no scenes)';
  }

  _libraryBrief() {
    try {
      const hay = haystackLower(getContext()?.chat, 12);
      const all = listVisibleLibraryLeaves(this.storage);
      const matched = hay.trim()
        ? all.filter(l => {
          const keys = [...(l.keywords || []), ...(l.keys || []), l.title];
          return keys.some(k => textMatchesHay(k, hay));
        })
        : all;
      const leaves = (matched.length ? matched : all).slice(0, 10);
      return leaves.map(l => {
        const keys = (l.keywords || l.keys || []).slice(0, 4).join(', ');
        return `- ${l.title}${keys ? ` 〔${keys}〕` : ''}`;
      }).join('\n') || '(empty glossary)';
    } catch {
      return '(unavailable)';
    }
  }

  _reputationBrief() {
    try {
      const hay = haystackLower(getContext()?.chat, 12);
      const conn = normalizeTrackers(this._db().trackers).connection;
      const rep = this.storage.getChat('reputation', { personal: [], house: [] });
      const cast = this._fullCast();
      const nameFor = (id) => cast.find(c => c.id === id)?.name || id;
      const lines = [];
      const personal = (rep.personal || []).filter(x => x.intro === 'pre' || x.kind === 'notice');
      const picked = hay.trim() && !conn.offScreen
        ? personal.filter(n => textMatchesHay(n.name, hay) || n.intro === 'pre')
        : personal;
      for (const n of picked.slice(0, 8)) {
        const resolved = n.characterId ? standingToward(this.storage, `cast:${n.characterId}`) : null;
        const standing = resolved != null ? resolved : (n.standing ?? '—');
        lines.push(`- ${n.name} [${n.intro === 'pre' ? 'pre-established' : n.category || 'notice'}] standing ${standing}`);
      }
      for (const h of (rep.house || []).slice(0, 6)) {
        if (hay.trim() && !conn.offScreen && !textMatchesHay(h.alias || h.name, hay)
          && !(h.connections || []).some(c => textMatchesHay(nameFor(c.characterId), hay))) {
          continue;
        }
        const members = [
          ...(h.headId ? [{ characterId: h.headId, role: 'Apparent head' }] : []),
          ...(h.connections || []),
        ];
        const connNames = members.map(c => nameFor(c.characterId)).filter(Boolean).slice(0, 6).join(', ');
        lines.push(`- House ${h.alias || h.name}${connNames ? ` · ${connNames}` : ''}`);
      }
      return lines.join('\n') || '(none in play)';
    } catch {
      return '(unavailable)';
    }
  }

  _motivationBrief() {
    const hay = haystackLower(getContext()?.chat, 12);
    const secrets = listPlaySecrets(this.storage).filter(s => {
      if (!hay.trim()) return true;
      return textMatchesHay(s.title, hay)
        || textMatchesHay(s.ownerName, hay)
        || (s.knownBy || []).some(k => textMatchesHay(knowerLabel(this.storage, k), hay));
    }).slice(0, 8).map(s => {
      const know = (s.knownBy || []).map(k => knowerLabel(this.storage, k)).slice(0, 4).join(', ') || 'nobody confirmed';
      return `- Secret “${s.title}” (owner ${s.ownerName}; known by ${know})`;
    });
    const beats = [];
    try {
      const mot = this.storage.getChat('motivation', { perChar: {} });
      for (const [id, row] of Object.entries(mot.perChar || {})) {
        const who = this._fullCast().find(c => c.id === id)?.name || id;
        if (hay.trim() && !textMatchesHay(who, hay)) continue;
        for (const step of (row.steps || []).filter(s => s.unlocked).slice(0, 2)) {
          beats.push(`- Beat “${step.title}” (${who})`);
        }
      }
    } catch { /* ignore */ }
    const standings = standingSubjects(this.storage).slice(0, 8).map(s => {
      if (hay.trim() && !textMatchesHay(s.label, hay)) return null;
      const v = standingToward(this.storage, s.key);
      return v == null ? null : `- Standing ${s.label}: ${v}`;
    }).filter(Boolean);
    return [...secrets, ...beats.slice(0, 6), ...standings].join('\n') || '(none filed)';
  }

  _noteTargets(noteId, subjectId) {
    const out = [];
    const push = (id, title, prompt, group) => {
      if (!id || !title) return;
      out.push({ id: `${group}:${id}`, title: `${group} · ${title}`, prompt, group });
    };
    try {
      const inv = this.storage.getChat('inventory', { static: [], mobile: [] });
      const items = [...(inv.mobile || []), ...(inv.static || [])];
      if (noteId === 'props') {
        for (const it of items) {
          const inTrunk = (inv.static || []).some(x => x.id === it.id);
          const loc = inTrunk ? 'Trunk' : 'On Person';
          push(it.id, it.name, `Item “${it.name}” [${loc}/${it.category || 'item'}]: ${clipText(it.description, 240)}`, 'Item');
        }
        const subj = this._fullCast().find(c => c.id === subjectId);
        for (const w of (subj?.wardrobe || [])) {
          push(w.id || w.name, w.name, `Wardrobe “${w.name}”: ${clipText(w.description, 240)}`, 'Wardrobe');
        }
        for (const p of (subj?.props || [])) {
          push(p.id || p.name, p.name, `Prop “${p.name}”: ${clipText(p.description, 240)}`, 'Prop');
        }
      }
      if (noteId === 'fashion') {
        for (const it of items.filter(i => i.category === 'wearable')) {
          const who = it.equippedTo?.name || (it.equippedTo?.type === 'player' ? 'Star' : 'unequipped');
          push(it.id, `${it.name} (${who})`, `Wearable “${it.name}” on ${who}: ${String(it.description || '').slice(0, 400)}`, 'Wearable');
        }
        for (const c of this._fullCast()) {
          for (const w of (c.wardrobe || [])) {
            push(`${c.id}:${w.id || w.name}`, `${c.name} · ${w.name}`, `Cast wardrobe — ${c.name} wears “${w.name}”: ${String(w.description || '').slice(0, 300)}`, 'Cast look');
          }
        }
      }
      if (noteId === 'role') {
        for (const c of this._fullCast().filter(x => x.priority !== 'director')) {
          push(c.id, c.name, `Cast “${c.name}” (${c.priority}): ${String(c.description || '').slice(0, 500)}`, 'Cast');
        }
        try {
          const mot = this.storage.getChat('motivation', { perChar: {} });
          const row = mot.perChar?.[subjectId] || {};
          for (const a of (row.achievements || [])) {
            push(a.id, a.title, `Achievement “${a.title}” [${a.status}]: ${String(a.description || '').slice(0, 400)}`, 'Achievement');
          }
          for (const s of (row.secrets || [])) {
            push(s.id, s.title, `Secret “${s.title}”: ${clipText(s.description, 280)}`, 'Secret');
          }
        } catch { /* ignore */ }
        for (const s of getSceneCards(this.storage).slice(0, 30)) {
          push(s.uid, `${s.code} ${s.title}`, `Script “${s.code} ${s.title}”: ${String(s.card?.summary || s.card?.content || '').slice(0, 500)}`, 'Script');
        }
        for (const leaf of listVisibleLibraryLeaves(this.storage).slice(0, 30)) {
          push(leaf.key || leaf.id, leaf.title, `Library “${leaf.title}”: ${String(leaf.content || '').slice(0, 500)}`, 'Library');
        }
      }
      if (noteId === 'cast') {
        const rep = this.storage.getChat('reputation', { personal: [], house: [] });
        const selfNode = (rep.personal || []).find(n => n.characterId === subjectId)
          || (rep.personal || []).find(n => String(n.name || '').toLowerCase() === String(this._fullCast().find(c => c.id === subjectId)?.name || '').toLowerCase());
        const linkedIds = new Set();
        if (selfNode) {
          linkedIds.add(selfNode.id);
          for (const id of (selfNode.links || [])) linkedIds.add(id);
          for (const r of (selfNode.readings || [])) {
            if (r.targetId) linkedIds.add(r.targetId);
          }
        }
        const personal = selfNode
          ? (rep.personal || []).filter(n => linkedIds.has(n.id) || n.characterId === subjectId)
          : (rep.personal || []).filter(n => n.characterId === subjectId);
        for (const n of personal) {
          push(n.id, n.name, `Reputation “${n.name}” (${n.category || n.kind}, intro ${n.intro || 'none'}): ${clipText(n.description || n.notes, 240)}`, 'Reputation');
        }
        const houseIds = new Set(characterHouseIds(this.storage, subjectId));
        for (const h of (rep.house || []).filter(x => houseIds.has(x.id))) {
          push(h.id, h.alias || h.name, `Affiliation “${h.alias || h.name}”: duty ${h.duty || '—'}; ${clipText(h.notes || h.opinion, 240)}`, 'Affiliation');
        }
        const play = listPlaySecrets(this.storage);
        const houses = characterHouseIds(this.storage, subjectId);
        const known = secretsKnownToCharacter(play, subjectId, houses);
        const owned = secretsAboutCharacter(play, subjectId);
        const seenSecret = new Set();
        for (const s of [...owned, ...known].slice(0, 16)) {
          if (seenSecret.has(s.id)) continue;
          seenSecret.add(s.id);
          const angle = s.ownerId === subjectId ? 'own' : 'known';
          push(s.id, s.title, `Rumor/Secret “${s.title}” (${angle}; owner ${s.ownerName}): ${clipText(s.description, 280)}`, 'Secret');
        }
      }
    } catch (err) {
      console.warn('[Backstage] note targets', err);
    }
    // de-dupe by id
    const seen = new Set();
    return out.filter(t => (seen.has(t.id) ? false : (seen.add(t.id), true))).slice(0, 80);
  }

  _subjectDossier(subject, askKind, target) {
    const ctx = getContext();
    const identity = resolveCastPromptIdentity(subject, this.storage, {
      characters: ctx.characters ?? [],
      personas: listPersonas(power_user),
    });
    const bits = [
      identity.block,
      `Cast priority: ${subject.priority || 'cast'}`,
      `Condition: ${String(subject.condition || 'none').slice(0, 300)}`,
      `DIRECTOR DIALS:\n${formatDirectorPromptBlock(this.storage, { includeHooks: true })}`,
    ];
    if (subject.wardrobe?.length) {
      bits.push(`Wardrobe: ${subject.wardrobe.map(w => w.name).join(', ')}`);
    }
    if (subject.props?.length) {
      bits.push(`Props: ${subject.props.map(p => p.name).join(', ')}`);
    }
    try {
      const credited = creditedScenes(this.storage, subject.id, subject.name).slice(0, 8);
      if (credited.length) {
        bits.push(`Credited Script: ${credited.map(s => `${s.code} · ${s.title}`).join(' · ')}`);
      }
    } catch { /* ignore */ }
    try {
      const mot = this.storage.getChat('motivation', { perChar: {} });
      const row = mot.perChar?.[subject.id];
      if (row?.achievements?.length) bits.push(`Achievements: ${row.achievements.map(a => a.title).join('; ')}`);
      if (row?.secrets?.length) bits.push(`Own secrets: ${row.secrets.map(s => s.title).join('; ')}`);
      const prior = (row?.interviews || []).slice(0, 2);
      if (prior.length) {
        const peeks = prior.map(iv => {
          const ans = (iv.turns || []).filter(t => t.who === 'cast' && t.text).slice(-2)
            .map(t => String(t.text).slice(0, 160)).join(' / ');
          return `- ${iv.interviewer || 'Interviewer'}: ${ans || '(no replies filed)'}`;
        });
        bits.push(`Prior interview notes (stay consistent):\n${peeks.join('\n')}`);
      }
    } catch { /* ignore */ }
    if (askKind && askKind !== 'free') {
      const related = this._noteTargets(askKind, subject.id).slice(0, 6);
      if (related.length) {
        bits.push(`Related ${askKind} files: ${related.map(r => r.title).join(' · ')}`);
      }
    }
    if (target?.prompt) bits.push(`Focus file already injected separately.`);
    return bits.join('\n');
  }

  _repTowardBlock(interviewerId, interviewerName) {
    try {
      const rep = this.storage.getChat('reputation', { personal: [], house: [] });
      const subject = this._interviewSubject();
      const nodes = Array.isArray(rep.personal) ? rep.personal : [];
      const findNode = (castId, name) => {
        if (castId) {
          const byId = nodes.find(n => n.characterId === castId || n.id === castId);
          if (byId) return byId;
        }
        if (name) {
          const nm = String(name).toLowerCase();
          return nodes.find(n => String(n.name || '').toLowerCase() === nm) || null;
        }
        return null;
      };
      const subjectNode = findNode(subject?.id, subject?.name);
      const interviewerNode = interviewerId
        ? findNode(interviewerId, interviewerName)
        : nodes.find(n => n.kind === 'self') || findNode(null, interviewerName);

      const lines = [
        `Treat this as a live conversation with ${interviewerName || 'the interviewer'} — answer as you would speak to them, not as a stranger (unless you truly do not know them).`,
      ];

      if (interviewerNode && subjectNode) {
        const linked = (subjectNode.links || []).includes(interviewerNode.id)
          || (interviewerNode.links || []).includes(subjectNode.id);
        if (linked) lines.push(`Connections web: you and ${interviewerName} are linked.`);

        const subjOfIv = (subjectNode.readings || []).find(r => r.targetId === interviewerNode.id);
        if (subjOfIv) {
          lines.push(`Your prior take on ${interviewerName}: aware=${subjOfIv.aware || '—'}; standing=${subjOfIv.standing ?? '—'}; ${String(subjOfIv.take || '—').slice(0, 220)}`);
        }
        const ivOfSubj = (interviewerNode.readings || []).find(r => r.targetId === subjectNode.id);
        if (ivOfSubj) {
          lines.push(`How ${interviewerName} sees you: aware=${ivOfSubj.aware || '—'}; standing=${ivOfSubj.standing ?? '—'}; ${String(ivOfSubj.take || '—').slice(0, 220)}`);
        }
        if (interviewerNode.notes) {
          lines.push(`Interviewer notice notes: ${String(interviewerNode.notes).slice(0, 180)}`);
        }
      } else if (interviewerNode) {
        lines.push(`Interviewer on the web: ${interviewerNode.name} [${interviewerNode.category || interviewerNode.kind}] standing ${interviewerNode.standing ?? '—'}`);
      }

      if (interviewerId) {
        for (const h of (rep.house || [])) {
          const hit = h.headId === interviewerId || (h.connections || []).some(c => c.characterId === interviewerId);
          if (hit) lines.push(`Shared affiliation: ${h.alias || h.name} (${h.duty || 'member'})`);
        }
      }

      return lines.length > 1
        ? `RELATIONSHIP / CONNECTIONS:\n${lines.join('\n')}`
        : `RELATIONSHIP / CONNECTIONS:\n${lines[0]}\n(no filed readings yet — still treat them as the named interviewer)`;
    } catch {
      return 'RELATIONSHIP / CONNECTIONS: (unavailable)';
    }
  }

  _peanutSource(st) {
    const mode = st.peanut.mode || 'recent';
    if (mode === 'script') {
      const scene = getSceneCards(this.storage).find(s => s.uid === st.peanut.scriptUid);
      if (!scene) throw new Error('Pick a Script card first.');
      const card = scene.card || {};
      const facets = flattenFacets(card.keywordFacets);
      const leaves = this._peanutLibraryLeaves();
      const stampBits = [];
      for (const e of (card.sourceStamp?.entries || [])) {
        const leaf = this._peanutStampLeaf(e, leaves);
        const body = String(leaf?.content || '').replace(/\s+/g, ' ').trim().slice(0, 280);
        if (!body) continue;
        const tags = (leaf?.tags || []).map(t => t.value).filter(Boolean).slice(0, 4);
        stampBits.push(`⌘ ${leaf?.title || e.title || 'lore'}${tags.length ? ` 〔${tags.join(', ')}〕` : ''}: ${body}`);
      }
      const body = [
        scene.code,
        scene.title,
        facets.length ? `Tags: ${facets.join(', ')}` : '',
        card.summary || '',
        card.content || '',
        ...stampBits,
      ].filter(Boolean).join('\n');
      return { label: `${scene.code} · ${scene.title}`, source: body, scene };
    }
    if (mode === 'range') {
      const rows = this._chatSlice(st.peanut.from, st.peanut.to);
      if (!rows.length) throw new Error('No messages in that range.');
      return {
        label: `#${st.peanut.from}–${st.peanut.to}`,
        source: rows.map(m => `[${m.index}] ${m.name}: ${m.text}`).join('\n'),
        scene: null,
      };
    }
    const n = Math.max(1, Math.min(80, Number(st.peanut.recentN) || 12));
    const rows = this._chatSlice().slice(-n);
    if (!rows.length) throw new Error('No chat messages yet.');
    return {
      label: `last ${rows.length}`,
      source: rows.map(m => `[${m.index}] ${m.name}: ${m.text}`).join('\n'),
      scene: null,
    };
  }

  _buildSceneInjection() {
    const root = extension_settings.showtime ?? {};
    if (root.masterOff) return '';
    this._scanChatTrackers({ persist: false });
    const st = this._db();
    const scene = normalizeTrackers(st.trackers).scene;
    if (!scene.enabled) return '';
    const snap = this._sceneClapSnapshot(st);
    const loc = snap.location && snap.location !== '—' ? snap.location : (scene.lastLocationKey || '');
    const time = scene.followTimeline !== false && snap.time ? snap.time : scene.lastTimeLabel;
    const date = scene.followTimeline !== false && snap.date && snap.date !== '—' ? snap.date : scene.lastDateLabel;
    return compactSceneInject({
      ...scene,
      lastTimeLabel: time,
      lastDateLabel: date,
    }, { location: loc });
  }

  _buildConnectionsInjection() {
    const root = extension_settings.showtime ?? {};
    if (root.masterOff) return '';
    const st = this._db();
    const conn = normalizeTrackers(st.trackers).connection;
    if (!conn.enabled) return '';
    const chat = getContext()?.chat || [];
    return compactConnectionsInject(this.storage, chat, {
      window: conn.inPlayWindow,
      offScreen: conn.offScreen,
    });
  }

  _registerInjection() {
    if (!this.injector) return;
    this.injector.unregister('backstage.director');
    this.injector.register({
      id: 'backstage.scene',
      always: true,
      buildText: () => this._buildSceneInjection(),
    });
    this.injector.register({
      id: 'backstage.connections',
      always: true,
      buildText: () => this._buildConnectionsInjection(),
    });
    this.injector.register({
      id: 'backstage.compass',
      always: true,
      position: extension_prompt_types.IN_CHAT,
      depth: 2,
      buildText: () => {
        const root = extension_settings.showtime ?? {};
        if (root.masterOff) return '';
        this._scanChatTrackers({ persist: false });
        const st = this._db();
        const compass = ensureCompass(st);
        const room = getActiveRoom(compass);
        if (!room) return '';
        const star = getStarMember(this.storage);
        const ctx = getContext();
        const speakerName = String(ctx?.name2 || '').trim();
        const names = pickInjectionNames({
          starName: star?.name || ctx?.name1 || '',
          speakerName,
        });
        return buildCompassInjection(room, { ...names, compass, storage: this.storage });
      },
    });
    registerWorldIndexInjection(this.injector, this.storage, {
      houseRoot: () => extension_settings.showtime ?? {},
      cellId: () => this._compassSelCell || '',
    });
    const smokeErr = smokeWorldIndexPure();
    if (smokeErr) console.warn('[Showtime/WorldIndex] smoke failed:', smokeErr);
    const auditSmoke = smokeCompassAuditPure();
    if (auditSmoke) console.warn('[Showtime/CompassAudit] smoke failed:', auditSmoke);
    const alignSmoke = smokeAlignSuiteContactPure();
    if (alignSmoke) console.warn('[Showtime/SuiteAlign] smoke failed:', alignSmoke);
    const suiteGlyphSmoke = smokeSuiteFloorplanGlyphs();
    if (suiteGlyphSmoke) console.warn('[Showtime/SuiteGlyphs] smoke failed:', suiteGlyphSmoke);
    const restoreSmoke = smokeSuiteWallRestorePure();
    if (restoreSmoke) console.warn('[Showtime/SuiteRestore] smoke failed:', restoreSmoke);
    const jsonSmoke = smokeJsonExtractPure();
    if (jsonSmoke) console.warn('[Showtime/JsonExtract] smoke failed:', jsonSmoke);
    const locSmoke = smokeSceneLocationPure();
    if (locSmoke) console.warn('[Showtime/SceneLocation] smoke failed:', locSmoke);
    const cueSmoke = smokeChatTrackCuePure();
    if (cueSmoke) console.warn('[Showtime/ChatCues] smoke failed:', cueSmoke);
    const bgSmoke = smokeBackgroundPickPure();
    if (bgSmoke) console.warn('[Showtime/BackgroundPick] smoke failed:', bgSmoke);
    const wxSmoke = smokeOverlayWxPure();
    if (wxSmoke) console.warn('[Showtime/WeatherOverlay] smoke failed:', wxSmoke);
    const sonarLocSmoke = smokeSonarLocationPure();
    if (sonarLocSmoke) console.warn('[Showtime/SonarLocation] smoke failed:', sonarLocSmoke);
    const calSmoke = smokeCalendarShiftPure();
    if (calSmoke) console.warn('[Showtime/CalendarShift] smoke failed:', calSmoke);
  }

  _reelPackOpts() {
    const root = this.container;
    return {
      portraits: !!root.querySelector('[data-reel-portraits]')?.checked,
      characterCards: !!root.querySelector('[data-reel-cards]')?.checked,
      relink: !!root.querySelector('[data-reel-relink]')?.checked,
      lorebooks: !!root.querySelector('[data-reel-lore]')?.checked,
      allLorebooks: !!root.querySelector('[data-reel-lore-all]')?.checked,
    };
  }

  async _exportProduction() {
    try {
      const extras = await collectReelExtras(this.storage, this._reelPackOpts());
      const payload = decorateReel(this.storage.exportProduction(), extras);
      downloadJson(`showtime-reel-${stamp()}.json`, payload);
    } catch (err) {
      console.error('[Backstage] reel export', err);
      alert('Reel export failed.');
    }
  }

  async _exportSelected() {
    try {
      const mods = [...this.container.querySelectorAll('[data-export-mod]:checked')]
        .map(el => el.getAttribute('data-export-mod'));
      const includeGlobal = !!this.container.querySelector('[data-export-global]')?.checked;
      if (!mods.length && !includeGlobal) {
        alert('Check at least one tab (or global settings).');
        return;
      }
      const extras = await collectReelExtras(this.storage, this._reelPackOpts());
      const payload = decorateReel(this.storage.exportSlice({
        chatModules: mods,
        includeGlobal,
      }), extras);
      downloadJson(`showtime-reel-${stamp()}.json`, payload);
    } catch (err) {
      console.error('[Backstage] reel slice', err);
      alert('Reel export failed.');
    }
  }

  _exportBackstageChat() {
    downloadJson(`showtime-reel-backstage-${stamp()}.json`, {
      _showtimeBackstage: true,
      _reel: true,
      chat: structuredClone(this._db()),
    });
  }

  async _importProduction(file) {
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      const merge = !!this.container.querySelector('[data-import-merge]')?.checked;
      const importGlobal = !!this.container.querySelector('[data-import-global]')?.checked;
      const chatModules = [...this.container.querySelectorAll('[data-import-mod]:checked')]
        .map(el => el.getAttribute('data-import-mod'));
      const importCards = !!this.container.querySelector('[data-import-cards]')?.checked;
      const importLore = !!this.container.querySelector('[data-import-lore]')?.checked;

      if (!isReelPayload(payload) && !payload._showtime && !payload._showtimeBackstage) {
        alert('Not a Showtime Reel.');
        return;
      }

      if (payload._showtimeBackstage && payload.chat) {
        const slice = payload.chat.backstage && !payload.chat.production
          ? payload.chat.backstage
          : payload.chat;
        if (merge) {
          Object.assign(this._db(), slice);
        } else {
          Object.assign(this._db(), this.getDefaultState(), slice);
        }
        this.saveState();
      } else if (payload._showtime) {
        this.storage.importProduction(payload, {
          merge: merge || !!payload._slice,
          chatModules: (merge || payload._slice) ? chatModules : null,
          importGlobal,
        });
      } else {
        alert('Not a Showtime Reel.');
        return;
      }

      const extraNotes = await importReelExtras(this.storage, payload.extras, { importCards, importLore });
      const extraBit = extraNotes.length ? `\nAlso: ${extraNotes.join(', ')}.` : '';
      alert((merge || payload._slice)
        ? `Reel imported into selected tabs.${extraBit}`
        : `Reel imported.${extraBit}\nReload the page if tabs look stale.`);
      this.render(this.container);
      this.bus?.emit('showtime.stateChanged');
    } catch (err) {
      console.error('[Backstage] reel import', err);
      alert('Reel import failed.');
    } finally {
      const input = this.container.querySelector('[data-role="import-file"]');
      if (input) input.value = '';
    }
  }

  _wipe() {
    const target = this.container.querySelector('[data-role="wipe-target"]')?.value;
    if (!target) { alert('Pick something to wipe.'); return; }
    if (!confirm(`Wipe “${target}”? This cannot be undone.`)) return;
    if (target === 'backstage-global') {
      this.storage.setGlobal('backstage', this._defaultGlobal());
      this._applyTheme('paper');
    } else if (target === 'backstage') {
      Object.assign(this._db(), this.getDefaultState());
      this.saveState();
    } else {
      const defaults = window.Showtime?.modules?.get(target)?.getDefaultState?.() ?? {};
      this.storage.setChat(target, structuredClone(defaults));
    }
    this.render(this.container);
    this.bus?.emit('showtime.stateChanged');
  }

  _saveSettings() {
    const root = ensureShowtimeRoot();
    root.masterOff = !!this.container.querySelector('[data-role="master-off"]')?.checked;
    for (const el of this.container.querySelectorAll('[data-role="mod-toggle"]')) {
      root.enabledModules[el.dataset.mod] = el.checked;
    }
    // Backstage cannot disable itself.
    root.enabledModules.backstage = true;
    for (const el of this.container.querySelectorAll('[data-role-color]')) {
      setRoleColor(el.dataset.roleColor, el.value);
    }
    applyRoleColorVars();
    saveSettingsDebounced();

    const g = this._g();
    g.profiles.audit = this.container.querySelector('[data-g="profile-audit"]')?.value || '';
    g.profiles.motivation = this.container.querySelector('[data-g="profile-motivation"]')?.value || '';
    g.profiles.event = this.container.querySelector('[data-g="profile-event"]')?.value || '';
    g.profiles.interview = this.container.querySelector('[data-g="profile-interview"]')?.value || g.profiles.interview || '';
    this._saveG();

    window.Showtime?.applyHousePolicy?.();
    this.bus?.emit('showtime.stateChanged');
    this.render(this.container);
  }

  _applyTheme(theme, custom = null) {
    const root = document.documentElement;
    const g = custom || this._g();
    root.classList.remove('st-theme-night', 'st-theme-crimson');
    if (theme === 'night') root.classList.add('st-theme-night');
    if (theme === 'crimson') root.classList.add('st-theme-crimson');
    if (theme === 'custom' || g.ink || g.paper || g.gold) {
      if (g.ink) root.style.setProperty('--st-ink', g.ink);
      if (g.paper) root.style.setProperty('--st-paper', g.paper);
      if (g.gold) root.style.setProperty('--st-gold', g.gold);
    } else {
      root.style.removeProperty('--st-ink');
      root.style.removeProperty('--st-paper');
      root.style.removeProperty('--st-gold');
    }
    applyRoleColorVars(root);
  }

  async _findProfiles(rawSettings = null) {
    let raw = rawSettings;
    if (!raw) {
      try {
        const res = await fetch('/api/settings/get', {
          method: 'POST',
          headers: getRequestHeaders(),
          body: JSON.stringify({}),
        });
        if (res.ok) raw = await res.json();
      } catch {
        raw = null;
      }
    }

    const normalize = (bag) => {
      if (!bag) return null;
      if (Array.isArray(bag) && bag.length) {
        return bag.map((p, i) => ({
          id: String(p.id ?? p.name ?? i),
          name: String(p.name ?? p.id ?? `Profile ${i + 1}`),
        }));
      }
      if (typeof bag === 'object') {
        const ents = Object.entries(bag);
        if (!ents.length) return null;
        return ents.map(([id, p]) => ({
          id: String(id),
          name: String((typeof p === 'object' ? p?.name : p) || id),
        }));
      }
      return null;
    };

    const ctx = getContext?.() || {};
    const candidates = [
      // Live Connection Manager (where ST actually keeps them)
      extension_settings?.connectionManager?.profiles,
      ctx.extensionSettings?.connectionManager?.profiles,
      // Settings API shapes (version-dependent)
      raw?.connectionManager?.profiles,
      raw?.connection_manager?.profiles,
      raw?.settings?.connectionManager?.profiles,
      raw?.extension_settings?.connectionManager?.profiles,
      raw?.connection_profiles,
      raw?.connectionProfiles,
      raw?.api_connection_profiles,
      // Fallbacks
      extension_settings?.connection_profiles,
      extension_settings?.connectionProfiles,
      window.connectionManager?.profiles,
      window.connection_manager?.profiles,
    ];

    for (const bag of candidates) {
      const list = normalize(bag);
      if (list?.length) return list;
    }

    // Last resort: reuse Script’s already-loaded list if present
    const scriptProfiles = window.Showtime?.modules?.get('script')?._profiles;
    if (Array.isArray(scriptProfiles) && scriptProfiles.length) return scriptProfiles;

    return [];
  }
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, ch =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function uid() {
  return (crypto.randomUUID?.() || `id-${Date.now()}-${Math.random().toString(16).slice(2)}`);
}

function stamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
