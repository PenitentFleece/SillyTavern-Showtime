// Backstage — the house behind the house. Listing board for Production,
// Interview, Peanut Gallery, Stage/Set, and Settings (migrated from Script).

import { getContext, extension_settings } from '../../../../../extensions.js';
import { getRequestHeaders, saveSettingsDebounced, eventSource, event_types, extension_prompt_types } from '../../../../../../script.js';
import { power_user } from '../../../../../power-user.js';
import { Module } from '../../lib/module.js';
import { openPlaybill } from '../../lib/playbill.js';
import { getCastMembers, getCastRecords, inPlayCastRecords, getStarMember, formatDirectorPromptBlock, resolveCastPromptIdentity, resolveInterviewCard, fitInterviewDesk, buildCharacterDossier, listPersonas, PRIORITIES, PRIORITY_DEFAULT_COLORS, getRoleColors, setRoleColor, resetRoleColors, applyRoleColorVars, normalizePlotHook, formatPlotHookLine, normalizeCastPresence } from '../../lib/castCatalog.js';
import { getSceneCards, creditedScenes, sceneCode, sceneLabel } from '../../lib/scriptCatalog.js';
import { expandScriptSeeds, shelfOrderedUids } from '../../lib/scriptDag.js';
import { flattenFacets } from '../../lib/keywordFacets.js';
import {
  listPlaySecrets,
  knowerLabel,
  standingSubjects,
  standingToward,
  connectionReading,
  standingInfo,
  secretsKnownToCharacter,
  secretsAboutCharacter,
  characterHouseIds,
} from '../../lib/motivationCatalog.js';
import {
  applySceneCuesFromChat,
  advanceSceneByMinutes,
  compactConnectionsInject,
  formatNowSceneLine,
  clipText,
  haystackLower,
  textMatchesHay,
  playMessagesSince,
  parseMsgTimestamp,
  smokeChatTrackCuePure,
} from '../../lib/chatTrack.js';
import {
  compactChatSlateInstruct,
  compactTurnTimeInstruct,
  applySlateSceneStamp,
  smokeChatSlatePure,
} from '../../lib/chatSlate.js';
import {
  withShowtimeProfile,
  PROFILE_SLOTS,
  PROFILE_SLOT_IDS,
  emptyProfileMap,
  hydrateProfileMap,
} from '../../lib/connectionProfile.js';
import { chatPaintPending, rafMove, runIdle } from '../../lib/uiPerf.js';
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
    resolveLocationFiling,
    smokeLocationDeltaPure,
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
import { getCachedLibraryBooks, ensureLibraryBooks, listLibraryLeaves, listVisibleLibraryLeaves, matchStampLeaf, clearOrphanTags } from '../../lib/libraryCatalog.js';
import {
  ensureCompass,
  createAndStoreRoom,
  loadRoom,
  unloadRoom,
  findPlaceIdByKey,
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
  reorderCellItem,
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
  clearForeignWallLink,
  setLinkExternal,
  linkWallToRoom,
  linkWallToExterior,
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
  smokeSyncOccupancyRoomPure,
  collectActiveLocationTags,
  moveSuiteChild,
  setRoomStory,
  ensureSuiteLayout,
  divideRoom,
  listSuiteChildren,
  listSuiteUnits,
  suiteUnitOuterSilhouette,
  setPlaceListingCode,
  setPlaceCategory,
  setWallConnection,
  smokeOpeningAccessPure,
  smokeAutoBindFixtureWallPure,
  smokePlaceKeyCollisionPure,
} from '../../lib/compass/state.js';
import { buildCompassInjection, pickInjectionNames, resolveCompassFocusRoom, invalidateRenderCache } from '../../lib/compass/render.js';
import { getActiveCastCue } from '../../lib/castCue.js';
import { registerCompassCommands } from '../../lib/compass/commands.js';
import { buildSetHtml, buildPlacementHtml, buildPlacementPovPreview, findPlaceForTag, findPlaceByExactName, renderCompassPlaceOptions, smokeCompassPlaceOptionsPure } from '../../lib/compass/stageUi.js';
import { openCellDialog, openOpeningDialog, openFurnitureDialog, openPieceDialog } from '../../lib/compass/dialogs.js';
import { showtimeAlert, showtimeConfirm, showtimePrompt, emitShowtimeNotice } from '../../lib/dialogs.js';
import { smokeRotateCellForPose } from '../../lib/compass/pov.js';
import { applySonarPings, listSonarPingsInPlace, summarizeSonarCheck, sonarFingerprint, setSonarExcluded, setSonarListening, pinSonarPing, pinNarratedSplitScene, reconcileRoomOccupants, smokeSonarLocationPure, smokeSonarPresencePure, confirmSettingHere, syncSonarPresence } from '../../lib/compass/sonar.js';
import { applySafeAuditFixes, smokeCompassAuditPure } from '../../lib/compass/audit.js';
import { COMPASS_VERSION, isVerticalOpeningType, normalizeSuitePose, isSuiteHostKind, isExteriorHostKind, isCompassPlaceKind, isScenePlaceKind, normalizeCell, PLACE_NEST_PARENTS, PLACE_KIND_SET, GEO_PLACE_KIND_SET, placeKindMeta } from '../../lib/compass/schema.js';
import {
  canonicalizeListingCode,
  collectListingPalette,
  listingCodesFromPlaces,
  smokeListingPure,
} from '../../lib/compass/listing.js';
import {
  runSuiteProgram,
  commitSuiteDraft,
  dismissSuiteDraft,
  populatePlaceFromCategory,
  smokeRoomBuilderPure,
} from '../../lib/compass/roomBuilder.js';
import {
  populateRoomsFromNarrative,
  collectRecentChatNarrative,
  smokeRoomDresserPure,
} from '../../lib/compass/roomDresser.js';
import { smokeRoomProgramPure } from '../../lib/compass/roomProgram.js';
import { smokeSuitePackPure } from '../../lib/compass/suitePack.js';
import { locationTagEditorHTML, readLocationTags } from '../../lib/locationTagPicker.js';
import { bindLocationCatalogPicker, bindNarrativeLocationPicker, formatSceneLocation, mostPreciseGeoName, lowestLocationNames, locationKeyFromStored, smokeSceneLocationPure, syncLocationCatalogFromCompass, upsertLocationNode, GROUP_TO_COMPASS, COMPASS_TO_GROUP, findLocationNodeByName, findLocationNodeById, findLocationNodeByPlaceId, collectLocationIdentity, rewriteLocationTagNames, removeLocationNode, mergeLocationNodes, pruneGhostLocationNodes } from '../../lib/locationCatalog.js';
import {
  defaultTrackers,
  normalizeTrackers,
  clapperIsShowing,
  buildTrackersHtml,
  formatTrackerTimeFromHour,
  formatSceneDate,
  weatherPoolForSeason,
  parseWeatherToken,
  normalizeCustomBar,
  buildSceneSetFormHtml,
  normalizePendingCue,
} from '../../lib/trackersConfig.js';
import {
  currentTimelinePresent,
  pickParseableTimeKey,
  phraseRecallGap,
  normalizeCalendar,
  seasonForMonth,
  formatTimeKey,
  shiftPartsByDays,
  smokeCalendarShiftPure,
  parseTimeKey,
  calendarSort,
  earthDateSort,
} from '../../lib/calendarTime.js';
import { parseMemoryBookContent } from '../../lib/memoryBookPrompt.js';
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
  normalizeWorldIndex,
  runWorldIndexAudit,
} from '../../lib/worldIndex.js';
import {
  collectReelExtras,
  decorateReel,
  packReelAffiliations,
  stampCastAffiliations,
  applyReelAffiliations,
  importReelExtras,
  isReelPayload,
  reelFilename,
  reelHash,
  clipReelTitle,
  stripStarFromReel,
  smokeReelNamePure,
  saveReelToUserFiles,
  deleteReelUserFile,
  listReelCatalog,
  rememberReel,
  forgetReel,
} from '../../lib/reel.js';
import { sanitizeReelPayload, smokeReelSanitizePure } from '../../lib/reelSanitize.js';
import { runReceiptFiling, compactReceiptInject, loadLastReceipt, lastUserHasReceiptWrap, paintExistingReceipt, restoreLatestReceipt, applyOffscreenNeeds, smokeReceiptPure } from '../../lib/receipt.js';
import { formatOccupancyLabel, normalizeTravel, smokeTravelStatePure } from '../../lib/travelState.js';
import {
  acceptNow,
  commitNow,
  defaultStandingChild,
  ensureNow,
  ignoreNow,
  proposeNow,
  renderNowLedgerLines,
  renderNowSceneLine,
  smokeNowSidecarPure,
  syncNowFromScene,
} from '../../lib/nowSidecar.js';
import { smokeVisitMemoryPure, visitLinesForPeople } from '../../lib/visitMemory.js';
import { smokeCastPresencePure, syncCastPresence } from '../../lib/castPresence.js';
import {
  formatHouseHealthLines,
  readHouseHealth,
  smokeHouseHealthPure,
} from '../../lib/houseHealth.js';
import { smokeItemLocatorPure, compactKitInject, compactNowInject, worldFromStorage, starKitFromInventory } from '../../lib/itemLocator.js';
import {
  formatOutfitLook,
  kitOwnedItems,
  normalizeOutfits,
  outfitTypeMeta,
  pickPrimaryOutfit,
} from '../../lib/wardrobeOutfits.js';
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
    blurb: 'Director events, trackers, holidays, databank imports & exports.',
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
    blurb: 'Set, placement, and studio shelves — map, dressing, effects, visuals.',
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
    sources: 'Cast · Closet / Current',
    questions: [
      { id: 'look', text: 'What does this look say about them?' },
      { id: 'wear', text: 'Would you wear this — or put it on someone?' },
      { id: 'room', text: 'How would the room judge this outfit?' },
    ],
  },
  {
    id: 'role',
    label: 'Role',
    sources: 'Motivation / Achievements · Script · Library cubbies',
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
    this._prodFolds = new Set(['director', 'events']);
    this._sonarFilter = '';
    this._sonarView = 'all';
    this._placesFold = new Set();
    this._placesFoldUser = false;
    this._placesEditId = '';
    this._locTrackPrimed = false;
    this._locLastCount = 0;
    this._locBusy = false;
    this._locNoticeKey = '';
    this._setCreateDraft = null;
    this._suiteBuildBusy = false;
    this._noteTargetCache = null;
  }

  async init() {
    this.bus?.on('backstage.open', ({ door } = {}) => {
      this._openDoor(door || 'settings');
      const shell = window.Showtime?.shell;
      shell?.activate?.('backstage');
      if (this.container) this.render(this.container);
    });
    this.bus?.on('showtime.locationDraft', (draft = {}) => {
      this._applyLocationDraft(draft);
    });
    this.bus?.on('showtime.suiteDraft', (draft = {}) => {
      this._openSuiteDraft(draft);
    });
    this.bus?.on('scene.slateApply', (tag) => {
      try { this._applySlateScene(tag); } catch (err) {
        console.warn('[Showtime/Backstage] slate scene', err);
      }
    });
    this.bus?.on('scene.turnElapsed', (spec) => {
      try { this._applyTurnElapsed(spec); } catch (err) {
        console.warn('[Showtime/Backstage] turn elapsed', err);
      }
    });
    this.bus?.on('showtime.chatPresence', () => {
      try { this._syncFloatingClapper(); } catch { /* ignore */ }
    });
    this.bus?.on('showtime.stateChanged', () => {
      try { this._refreshHouseHealth(); } catch { /* ignore */ }
      try {
        const scene = this.storage.getChat('backstage', {})?.trackers?.scene;
        if (!scene?.enabled || scene.followTimeline === false) return;
        // Soft-refresh clapper date/time from the Script present (narrative now).
        clearTimeout(this._tlFollowTimer);
        this._tlFollowTimer = setTimeout(() => {
          try {
            const st = this._db();
            const scene = normalizeTrackers(st.trackers).scene;
            if (scene.boardHeld) {
              this._syncFloatingClapper(false, { scan: false });
              return;
            }
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
            this._syncFloatingClapper(false, { scan: false });
          } catch { /* ignore */ }
        }, 450);
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
    this.bus?.on('showtime.receiptFiled', ({ receipt } = {}) => {
      try {
        this._handleReceiptLocationNotice(receipt);
      } catch (err) {
        console.warn('[Showtime/location receipt notice]', err);
      }
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
    // Do not scan trackers here, and do not walk the set until messages are in the DOM.
    const paintStageChrome = () => {
      try {
        if (chatPaintPending()) {
          setTimeout(paintStageChrome, 1000);
          return;
        }
        this._syncFloatingClapper(false, { scan: false, lite: true });
        runIdle(() => {
          try {
            this._syncStageBackground({ lite: true });
            this._syncWeatherOverlay();
          } catch (err) {
            console.warn('[Showtime/Backstage] stage chrome sync failed', err);
          }
        }, 1600);
      } catch (err) {
        console.warn('[Showtime/Backstage] stage chrome sync failed', err);
      }
    };
    setTimeout(paintStageChrome, 4500);
    if (!this._genBound) {
      this._genBound = true;
      this._receiptPrimed = true;
      this._receiptLastCount = this._receiptCount();
      eventSource.on(event_types.GENERATION_STARTED, (type, _opts, dryRun) => {
        this._scanChatTrackers({ persist: false });
        if (dryRun || type === 'quiet') return;
        this._userGen = true;
        this._genChatLen = (getContext()?.chat || []).length;
      });
      eventSource.on(event_types.GENERATION_ENDED, () => {
        if (!this._userGen) return;
        this._userGen = false;
        const len = (getContext()?.chat || []).length;
        const grew = len > (Number(this._genChatLen) || 0);
        this._genChatLen = len;
        try { this._refreshHouseHealth(); } catch { /* ignore */ }
        if (!grew) return;
        try { this._maybeAutoDirector(); } catch { /* ignore */ }
        try {
          if (this._receiptCadenceId() === 'per_turn') this._scheduleReceiptCadence({ stampTarget: 'user' });
        } catch { /* ignore */ }
      });
      // Re-pick stage background / refresh clapper after chat moves.
      const resyncStage = ({ scan = true, lite = false } = {}) => {
        clearTimeout(this._resyncStageT);
        this._resyncStageT = setTimeout(() => {
          try {
            if (chatPaintPending()) {
              resyncStage({ scan: false, lite: true });
              return;
            }
            if (scan) this._scanChatTrackers({ persist: true });
            try {
              const compass = ensureCompass(this._db());
              const pinned = pinNarratedSplitScene(compass, {
                chatId: String(getContext()?.chatId || ''),
                castMembers: this._sonarCast({ includeWrittenOut: true }),
                storage: this.storage,
                chat: getContext()?.chat || [],
              });
              if (pinned) {
                this.saveState();
                this._syncFloatingClapper(false, { scan: false, lite: true });
              }
            } catch { /* scene pin is optional */ }
            this._syncFloatingClapper(false, { scan: false, lite });
            this._syncStageBackground({ lite });
            this._syncWeatherOverlay();
          } catch { /* ignore */ }
        }, scan ? 800 : 400);
      };
      eventSource.on(event_types.MESSAGE_SENT, (messageId) => {
        resyncStage();
        try { paintExistingReceipt(messageId); } catch (err) {
          console.warn('[Showtime/receipt] paint on send', err);
        }
      });
      if (event_types.USER_MESSAGE_RENDERED) {
        eventSource.on(event_types.USER_MESSAGE_RENDERED, (messageId) => {
          try { paintExistingReceipt(messageId); } catch (err) {
            console.warn('[Showtime/receipt] paint on user render', err);
          }
        });
      }
      eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, (id, type) => {
        if (type === 'quiet' || type === 'first_message') return;
        const chat = getContext()?.chat || [];
        const turnKey = `${Number.isFinite(Number(id)) ? Number(id) : chat.length - 1}:${chat.length}`;
        if (this._lastPostTurnKey === turnKey) return;
        this._lastPostTurnKey = turnKey;
        const cad = this._receiptCadenceId();
        if (cad === 'per_post' || cad === 'per_n') {
          this._scheduleReceiptCadence({ stampTarget: 'ai' });
        } else if (!cad) {
          this._scheduleLocFallbackCadence();
        }
        this._scheduleWorldIndexAudit();
      });
      eventSource.on(event_types.MESSAGE_RECEIVED, () => {
        resyncStage();
      });
      eventSource.on(event_types.CHAT_CHANGED, (chatId) => {
        this._locTrackPrimed = false;
        this._locLastCount = 0;
        this._lastPostTurnKey = '';
        const id = String(chatId || getContext()?.chatId || '');
        const sameChat = id && id === this._receiptChatId;
        this._receiptChatId = id;
        if (!sameChat) {
          this._receiptPrimed = true;
          this._receiptLastCount = this._receiptCount();
          clearTimeout(this._locTrackTimer);
        }
        this._locNoticeKey = '';
        this._setCreateDraft = null;
        const firstOpen = !this._stageChatSeen;
        this._stageChatSeen = true;
        clearTimeout(this._resyncStageT);
        this._resyncStageT = setTimeout(() => resyncStage({ scan: false, lite: firstOpen }), firstOpen ? 4000 : 1200);
        clearTimeout(this._presenceLoadT);
        this._presenceLoadT = setTimeout(() => {
          if (chatPaintPending()) return;
          try { this._syncAutoPresence({ persist: false }); } catch { /* ignore */ }
        }, firstOpen ? 5500 : 1500);
        runIdle(() => { try { this._renderEventPaper(); } catch { /* ignore */ } }, firstOpen ? 5500 : 1500);
        runIdle(() => { try { restoreLatestReceipt(); } catch { /* ignore */ } }, firstOpen ? 800 : 200);
      });
      runIdle(() => { try { restoreLatestReceipt(); } catch { /* ignore */ } }, 800);
      eventSource.on(event_types.MESSAGE_SWIPED, () => clearTimeout(this._locTrackTimer));
    }
    this._profiles = this._listProfilesLocal();
    this._profilesLoaded = true;
    if (!this._profiles.length) {
      runIdle(() => {
        this._findProfiles().then((list) => {
          this._profiles = list || [];
        }).catch(() => {});
      }, 2500);
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
        title: '',
        lastReel: null,
      },
      interview: {
        active: false,
        subjectId: '',
        interviewer: 'star',
        interviewerId: '',
        flippedNote: '',
        notePick: {},
        noteIdx: 0,
        notesOpen: true,
        turns: [],
        pendingConn: [],
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
        poke: '',
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
      worldIndex: normalizeWorldIndex(),
    };
  }

  _defaultGlobal() {
    return {
      theme: 'paper',
      ink: '',
      paper: '',
      gold: '',
      profiles: emptyProfileMap(),
      handbookSeen: false,
    };
  }

  _g() {
    const g = this.storage.getGlobal('backstage', this._defaultGlobal());
    g.theme ??= 'paper';
    g.profiles = hydrateProfileMap(g.profiles);
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
    st.production.title ??= '';
    if (st.production.lastReel == null || typeof st.production.lastReel !== 'object') {
      st.production.lastReel = null;
    }
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
    if (!Array.isArray(st.interview.pendingConn)) st.interview.pendingConn = [];
    if (typeof st.interview.notesOpen !== 'boolean') st.interview.notesOpen = true;
    // Recover mid-session from older saves that had no `active` flag.
    if (st.interview.active == null) {
      st.interview.active = Array.isArray(st.interview.turns) && st.interview.turns.length > 0;
    }
    st.peanut ??= def.peanut;
    if (typeof st.peanut.focusChat !== 'boolean') st.peanut.focusChat = false;
    if (typeof st.peanut.poke !== 'string') st.peanut.poke = '';
    st.worldIndex = normalizeWorldIndex(st.worldIndex);
    if (!Array.isArray(st.customListingCodes)) st.customListingCodes = [];
    return st;
  }

  async onChatChanged() {
    this._door = '';
  }

  async render(container, { chrome = true } = {}) {
    this.container = container;
    if (!this._profiles.length) this._profiles = this._listProfilesLocal();
    this._profilesLoaded = true;
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
    if (chrome) {
      this._syncFloatingClapper();
      this._syncStageBackground();
      this._syncWeatherOverlay();
    }
  }

  _captureScroll(container) {
    const parents = [];
    let el = container;
    const marquee = container?.closest?.('#showtime-marquee') || container;
    for (let i = 0; i < 6 && el; i++) {
      if (el === document.body || el === document.documentElement) break;
      if (el.scrollHeight > el.clientHeight + 1) {
        parents.push({ el, top: el.scrollTop });
      }
      if (el === marquee) break;
      el = el.parentElement;
    }
    return {
      body: container.querySelector('.bst-body')?.scrollTop ?? 0,
      iv: container.querySelector('[data-role="iv-log"]')?.scrollTop ?? 0,
      pg: container.querySelector('[data-role="pg-log"]')?.scrollTop ?? 0,
      sonar: container.querySelector('.bst-sonar-body')?.scrollTop
        ?? container.querySelector('.bst-sonar-list')?.scrollTop ?? 0,
      places: container.querySelector('.bst-places-body')?.scrollTop
        ?? container.querySelector('.bst-set-index-list')?.scrollTop ?? 0,
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
      const places = container.querySelector('.bst-places-body')
        || container.querySelector('.bst-set-index-list');
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
    const house = this._houseClosed()
      ? `<button type="button" class="bst-back" data-action="close-desk">Close</button>`
      : '';
    return `
      <header class="bst-top">
        <span class="bst-brand">Backstage</span>
        <span class="bst-kicker">${esc(kicker)}</span>
        ${back}
        ${house}
      </header>`;
  }

  _houseClosed() {
    try { return !!window.Showtime?.shell?._curtainMode; } catch { return false; }
  }

  _doorShut(id) {
    return this._houseClosed() && (
      id === 'interview' || id === 'gallery' || id === 'set' || id === 'placement'
    );
  }

  _boardHTML(doors = LOBBY_DOORS, { heading = '' } = {}) {
    return `
      <div class="bst-board">
        ${heading ? `<div class="bst-board-group-label">${esc(heading)}</div>` : ''}
        ${doors.map(d => {
          const shut = this._doorShut(d.id);
          return `
          <button type="button" class="bst-door${shut ? ' is-shut' : ''}" data-action="${shut ? '' : 'open'}" data-door="${d.id}" ${shut ? 'disabled aria-disabled="true"' : ''}>
            <span class="bst-door-mark">${d.mark}</span>
            <span class="bst-door-copy">
              <span class="bst-door-title">${d.title}</span>
              <span class="bst-door-blurb">${esc(shut ? 'Needs an open chat.' : d.blurb)}</span>
            </span>
            <span class="bst-door-chev">›</span>
          </button>`;
        }).join('')}
      </div>`;
  }

  _stageHubHTML() {
    const closed = this._houseClosed();
    const preview = closed
      ? ''
      : buildWorldIndexPreviewHtml(this.storage, {
        esc,
        cellId: this._compassSelCell || '',
      });
    const sub = closed
      ? 'Effects and Visuals stay open. Set, Placement, and the world index wait for a chat.'
      : 'Map the house, dress areas, then open studio shelves for effects and visuals.';
    return `
      <h2 class="bst-pane-title">Stage</h2>
      <p class="bst-pane-sub">${esc(sub)}</p>
      ${this._boardHTML(STAGE_DOORS)}
      ${preview}`;
  }

  _paneHTML(door, st) {
    if (this._doorShut(door)) return this._boardHTML();
    if (door === 'production' || door === 'studio-trackers') {
      if (door === 'studio-trackers') this._openDoor('studio-trackers');
      return this._productionHTML(st);
    }
    if (door === 'interview') return this._interviewHTML(st);
    if (door === 'gallery') return this._peanutHTML(st);
    if (door === 'stage') return this._stageHubHTML();
    if (door === 'set') return this._setHTML(st);
    if (door === 'placement') return this._placementHTML(st);
    if (door === 'studio-effects') return this._studioEffectsHTML(st);
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

    const last = p.lastReel;
    const lastLine = last?.file
      ? `<p class="bst-hint">Last export: ${esc(last.title || last.file)} · ${esc(new Date(last.at).toLocaleString())}</p>`
      : '';
    const databankBody = `
        <p class="bst-hint">A <strong>Reel</strong> is a portable copy of this production — pick which tabs travel with it, then import the same file into another chat. Live data sits in this chat’s metadata (not a separate folder).</p>
        <label class="bst-field"><span>Production name</span>
          <input type="text" data-field="productionTitle" maxlength="80" value="${esc(p.title || '')}" placeholder="Lost &amp; Found">
        </label>
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
            <label class="bst-check" title="Drops the Star card, their kit, and rows aimed at them. Their name can still appear in script and interview text."><input type="checkbox" data-reel-leave-star> Leave the Star behind</label>
          </div>
        </div>
        <div class="bst-row">
          <button type="button" class="bst-btn gold" data-action="export-selected">Export Reel</button>
          <button type="button" class="bst-btn" data-action="export-all">Export full Reel</button>
          <button type="button" class="bst-btn" data-action="export-tab">Export Backstage only</button>
        </div>
        ${lastLine}
        ${this._reelShelfHtml()}
        <div class="bst-field"><span>Import a Reel</span>
          <p class="bst-hint" style="margin:0">Merge uses a reel from this list. Unchecked tabs stay as they are. Import from file is for a json that is not on the shelf.</p>
          <label class="bst-field"><span>Shelf reel</span>
            <select class="bst-select" data-role="merge-reel">
              <option value="">— Pick a reel —</option>
              ${listReelCatalog(extension_settings).map(r =>
                `<option value="${esc(r.file)}">${esc(r.title || r.file)}</option>`).join('')}
            </select>
          </label>
          <div class="bst-checkgrid">
            <label class="bst-check"><input type="checkbox" data-import-merge checked> Merge (keep unchecked modules)</label>
            ${Object.entries(MODULE_LABELS).map(([id, label]) =>
              `<label class="bst-check"><input type="checkbox" data-import-mod="${esc(id)}" checked> ${esc(label)}</label>`).join('')}
            <label class="bst-check"><input type="checkbox" data-import-global checked> Global settings</label>
            <label class="bst-check"><input type="checkbox" data-import-cards checked> Import character cards / portraits</label>
            <label class="bst-check"><input type="checkbox" data-import-lore checked> Import lorebooks</label>
          </div>
        </div>
        <div class="bst-row">
          <button type="button" class="bst-btn gold" data-action="merge-reel">Merge reel</button>
          <button type="button" class="bst-btn" data-action="import-all">Import from file…</button>
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
      <p class="bst-pane-sub">Director watches the floor. Trackers sit in a fold. Reels pack the paperwork.</p>
      ${fold('director', 'Director events', directorBody)}
      ${fold('trackers', 'Trackers', this._studioTrackersInner(st))}
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

  async _clearOrphanTags() {
    if (!await showtimeConfirm('Clear tags that no longer link to a Script card, lorebook entry, or book? This cannot be undone.', { title: 'CLEAR ORPHAN TAGS', danger: true, confirmLabel: 'Clear' })) {
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
    const msg = bits.length
      ? `Cleared orphan tags — ${bits.join(', ')}.`
      : 'No orphan tags found.';
    emitShowtimeNotice(this.bus, { kind: 'house', text: msg, mark: bits.length ? '!' : '✓' });
  }

  async _composeHolidayEvent() {
    if (this._busy) return;
    const script = this._scriptMod();
    if (!script?._addCard) {
      void showtimeAlert('Script module is not loaded — open the Script tab once, then retry.', { title: 'HOLIDAY EVENT' });
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
      void showtimeAlert(`Compose failed: ${err.message || err}`, { title: 'HOLIDAY EVENT', danger: true });
    } finally {
      this._busy = false;
      if (this._door === 'production' && this.container) this.render(this.container);
    }
  }

  async _pitchEventCast(uid) {
    if (!uid || this._busy) return;
    const script = this._scriptMod();
    const card = script?._getCard?.(uid);
    if (!card) { void showtimeAlert('Event card not found.', { title: 'PITCH CAST' }); return; }
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
      void showtimeAlert(`Pitch failed: ${err.message || err}`, { title: 'PITCH CAST', danger: true });
    } finally {
      this._busy = false;
      if (this._door === 'production' && this.container) this.render(this.container);
    }
  }

  _cueEventNow(uid) {
    const script = this._scriptMod();
    const card = script?._getCard?.(uid);
    if (!card) { void showtimeAlert('Event card not found.', { title: 'CUE EVENT' }); return; }
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
    if (!card) { void showtimeAlert('Event card not found.', { title: 'JUMP TO EVENT' }); return; }
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
      void showtimeAlert(`Jump failed: ${err.message || err}`, { title: 'JUMP TO EVENT', danger: true });
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
      void showtimeAlert(result.reason === 'no-director'
        ? 'Add a Director cast card first.'
        : 'Could not file a plot hook.', { title: 'PLOT HOOK' });
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
      void showtimeAlert('Pick a cast member to play this event.', { title: 'DIRECTOR EVENT' });
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
    const subName = subject?.name || '—';
    const withName = interviewer.anonymous ? 'Anonymous' : (interviewer.name || '—');
    const notesOpen = iv.notesOpen !== false;
    return `
      <section class="bst-iv-slate">
        <div class="bst-iv-live"><span class="bst-iv-rec" aria-hidden="true"></span>LIVE NOW</div>
        <p class="bst-iv-with">${esc(subName)} speaking with ${esc(withName)}</p>
        <div class="bst-iv-model">(${esc(this._interviewProfileLabel())})</div>
        <div class="bst-iv-slate-actions">
          <button type="button" class="bst-btn" data-action="interview-discard" title="Leave without filing a transcript">End without filing</button>
          <button type="button" class="bst-btn danger" data-action="interview-end" title="File transcript to the subject, then leave">End &amp; file</button>
          <button type="button" class="bst-btn bst-iv-clear" data-action="interview-clear" title="Wipe the live desk only">Clear desk</button>
        </div>
      </section>

      <div class="bst-stage bst-stage--interview">
        <div class="bst-transcript" data-role="iv-log">
          ${turns.length
            ? turns.map((t, i) => {
              const sys = t.name === 'Connections';
              const showWho = t.who === 'user' || sys;
              const cls = sys ? 'user bst-bubble--sys' : (t.who === 'user' ? 'user' : 'cast');
              const retryBtn = t.who === 'cast' && !sys
                ? `<button type="button" class="bst-iv-turn-retry" data-action="iv-retry-turn" data-idx="${i}" ${this._busy ? 'disabled' : ''} title="Regenerate this reply">Retry</button>`
                : '';
              return `
              <div class="bst-bubble ${cls}">
                ${showWho ? `<div class="bst-bubble-who">${esc(t.name || t.who)}</div>` : ''}
                <div class="bst-bubble-text">${esc(t.text)}</div>
                ${retryBtn}
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

        <div class="bst-row bst-iv-askbar">
          <input class="bst-input" style="flex:1" data-role="iv-line" placeholder="Type a question…" ${subject && !this._busy ? '' : 'disabled'}>
          <button type="button" class="bst-btn gold" data-action="iv-send" ${subject && !this._busy ? '' : 'disabled'}>${this._busy ? '…' : 'Ask'}</button>
        </div>

        <details class="bst-iv-notes" data-role="iv-notes" ${notesOpen ? 'open' : ''}>
          <summary>Notecards</summary>
          <div class="bst-ask-label">Ask about…</div>
          ${this._interviewAlbumHTML(iv, flipped, subject)}
        </details>
        <p class="bst-hint">Live desk only — relationship-web updates queue here and file when you End.</p>
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
    const openId = flipped === card.id ? card.id : '';
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
      turns: turns
        .filter(t => t.who !== 'cast' || !this._interviewReplyTooShort(t.text))
        .map(t => ({
          who: t.who,
          name: t.who === 'cast' ? '' : (t.name || ''),
          text: String(t.text || ''),
          at: t.at || Date.now(),
        })),
    };

    const pending = Array.isArray(st.interview.pendingConn) ? st.interview.pendingConn : [];
    if (pending.length && this._applyInterviewConnPatches(pending, subject)) {
      for (const t of session.turns) {
        if (t.name === 'Connections' && /^To file:/i.test(t.text)) {
          t.text = t.text.replace(/^To file:/i, 'Filed:');
        }
      }
    }

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

  async _endInterview({ save = true } = {}) {
    this._ivHarvestSeq = (this._ivHarvestSeq || 0) + 1;
    const st = this._db();
    if (save && (st.interview.turns || []).length) {
      this._busy = true;
      try { this._paintInterviewDesk(); } catch { /* desk may be closed */ }
      try {
        await this._fileInterviewConnections();
      } catch (err) {
        console.warn('[Backstage interview → Connections]', err);
      } finally {
        this._busy = false;
      }
      this._archiveInterviewSession();
    }
    st.interview.active = false;
    st.interview.turns = [];
    st.interview.pendingConn = [];
    st.interview.flippedNote = '';
    st.interview.startedAt = 0;
    st.interview.retry = null;
    this.saveState();
    return void this.render(this.container);
  }

  _refreshInterviewAlbum() {
    const host = this.container?.querySelector('.bst-iv-album');
    if (!host) {
      if (this.container) void this.render(this.container, { chrome: false });
      return;
    }
    const st = this._db();
    const html = this._interviewAlbumHTML(st.interview, st.interview.flippedNote || '', this._interviewSubject());
    const wrap = document.createElement('div');
    wrap.innerHTML = String(html || '').trim();
    const next = wrap.firstElementChild;
    if (next) host.replaceWith(next);
  }

  _paintInterviewDesk() {
    if (this._door !== 'interview' || !this.container) return;
    const body = this.container.querySelector('.bst-body');
    if (!body) {
      void this.render(this.container, { chrome: false });
      return;
    }
    const ivTop = this.container.querySelector('[data-role="iv-log"]')?.scrollTop ?? 0;
    const bodyTop = body.scrollTop;
    const st = this._db();
    body.innerHTML = this._interviewHTML(st);
    this._bindInterviewNotes(this.container);
    const iv = this.container.querySelector('[data-role="iv-log"]');
    if (iv) iv.scrollTop = this._ivPinBottom ? iv.scrollHeight : ivTop;
    body.scrollTop = bodyTop;
    if (this._ivPinBottom) this._ivPinBottom = false;
  }

  _noteTargetOptionsHTML(targets, selectedId) {
    const chunks = [];
    let bucket = null;
    let buf = [];
    const flush = () => {
      if (!buf.length) return;
      const opts = buf.join('');
      chunks.push(bucket ? `<optgroup label="${esc(bucket)}">${opts}</optgroup>` : opts);
      buf = [];
    };
    for (const t of targets || []) {
      const next = String(t.bucket || '');
      if (buf.length && next !== bucket) flush();
      bucket = next;
      buf.push(`<option value="${esc(t.id)}" ${t.id === selectedId ? 'selected' : ''}>${esc(t.title)}</option>`);
    }
    flush();
    return chunks.join('');
  }

  _fashionKit(char) {
    if (char?.priority === 'star') {
      try {
        const inv = this.storage.getChat('inventory', { static: [], mobile: [] });
        return starKitFromInventory(inv, { ownerId: char.id });
      } catch { /* fall through */ }
    }
    return { wardrobe: char?.wardrobe || [], props: char?.props || [] };
  }

  _noteCardHTML(card, flipped, subject, iv) {
    const open = flipped === card.id;
    const pick = (iv.notePick || {})[card.id] || {};
    const targets = (open && subject) ? this._noteTargets(card.id, subject.id) : [];
    const qIdx = Math.min(Number(pick.q) || 0, card.questions.length - 1);
    const disabled = !subject || this._busy;
    const rephraseOpen = !!pick.rephraseOpen;
    const aboutTarget = targets.find(t => t.id === pick.targetId);
    const sitName = String(subject?.name || '').trim();
    const aboutTitle = String(aboutTarget?.title || '').trim();
    const rephraseHint = [
      'Write your own question.',
      aboutTitle ? `About: ${aboutTitle}` : '',
      sitName ? `Sitting: ${sitName}` : '',
    ].filter(Boolean).join(' ');
    return `
      <div class="bst-flip${open ? ' open' : ''}${open && rephraseOpen ? ' rephrase' : ''}" data-note="${card.id}">
        <div class="bst-flip-inner">
          <button type="button" class="bst-note-face front" data-action="note-flip" data-note="${card.id}" ${disabled ? 'disabled' : ''}>
            <span class="bst-note-t">${esc(card.label)}</span>
            <span class="bst-note-src">${esc(card.sources)}</span>
          </button>
          <div class="bst-note-face back">
            <button type="button" class="bst-note-close" data-action="note-flip" data-note="${card.id}" title="Flip back">↩</button>
            <span class="bst-note-k">${esc(card.label)}</span>
            ${rephraseOpen ? '' : `
            <label class="bst-field" style="margin:4px 0">
              <span>Question</span>
              <select data-note-q="${card.id}" ${disabled ? 'disabled' : ''}>
                ${card.questions.map((q, i) =>
                  `<option value="${i}" ${i === qIdx ? 'selected' : ''}>${esc(q.text)}</option>`).join('')}
              </select>
            </label>`}
            <label class="bst-field" style="margin:4px 0">
              <span>About</span>
              <select data-note-target="${card.id}" ${disabled ? 'disabled' : ''}>
                <option value="">— pick a title —</option>
                ${this._noteTargetOptionsHTML(targets, pick.targetId)}
              </select>
            </label>
            ${rephraseOpen ? `
            <label class="bst-field bst-note-rephrase-field">
              <span>Your prompt</span>
              <textarea class="bst-note-about bst-note-rephrase" data-note-rephrased="${card.id}" rows="3"
                placeholder="${esc(rephraseHint)}"
                ${disabled ? 'disabled' : ''}>${esc(pick.rephrased || '')}</textarea>
            </label>` : ''}
            <div class="bst-note-askrow">
              <button type="button" class="bst-btn gold" data-action="note-ask" data-note="${card.id}"
                ${disabled || !targets.length ? 'disabled' : ''}>Ask</button>
              <button type="button" class="bst-btn${rephraseOpen ? ' gold' : ''}" data-action="note-rephrase" data-note="${card.id}"
                title="Write your own prompt instead of the stock question"
                ${disabled ? 'disabled' : ''}>Rephrase</button>
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
          <label class="bst-field" style="flex:1;margin:0"><span>Poke</span>
            <input type="text" data-field="poke" maxlength="160" value="${esc(p.poke || '')}" placeholder="Optional — what they should argue about"></label>
        </div>
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
      aliases: Array.isArray(m.aliases) ? m.aliases : [],
      priority: m.priority || '',
      presence: normalizeCastPresence(m),
      updatedAt: Number(m.updatedAt) || 0,
    }));
  }

  _armBoardHold(scene, { bumpClap = true } = {}) {
    if (!scene || typeof scene !== 'object') return;
    scene.boardHeld = true;
    scene.pendingCue = null;
    if (bumpClap) scene.lastClapAt = Date.now();
  }

  _queuePendingCue(scene, partial = {}) {
    if (!scene || typeof scene !== 'object') return false;
    const merged = {
      date: partial.date !== undefined ? partial.date : scene.pendingCue?.date,
      time: partial.time !== undefined ? partial.time : scene.pendingCue?.time,
      location: partial.location !== undefined ? partial.location : scene.pendingCue?.location,
    };
    const next = normalizePendingCue(merged);
    if (!next) return false;
    if (scene.ignoredCueSig && next.sig === scene.ignoredCueSig) return false;
    scene.pendingCue = next;
    return true;
  }

  _scanChatTrackers({ persist = false, force = false } = {}) {
    try {
      const st = this._db();
      st.trackers = normalizeTrackers(st.trackers);
      const chat = getContext()?.chat || [];
      const compass = ensureCompass(st);
      let ulChanged = false;
      if (persist || force) {
        try { ulChanged = !!syncScriptLibraryUnlisted(compass, this.storage); } catch { /* ignore */ }
      }
      const sonar = this._runSonar(compass, { persist });
      const scene = st.trackers.scene;
      const locKey = locationKeyFromStored(sonar.key);
      const play = (Array.isArray(chat) ? chat : []).filter(m => m && !m.is_system);
      const last = play[play.length - 1];
      const newestMes = String(last?.mes || '').replace(/<[^>]+>/g, ' ');
      const newestAt = parseMsgTimestamp(last);
      const stale = Number(scene.lastClapAt) > 0 && newestAt > 0 && newestAt <= Number(scene.lastClapAt);
      const headerLine = /[·•]/.test(newestMes);
      const autoHeaderLoc = headerLine && (force || (!stale && (newestAt > 0 || !scene.boardHeld) && (!scene.boardHeld || newestAt > Number(scene.lastClapAt))));
      const sonarPlaceId = String(compass.sonar?.lastPlaceId || '').trim();
      const curPlaceId = String(scene.travel?.placeId || '').trim();
      const placeChanged = (sonarPlaceId && sonarPlaceId !== curPlaceId)
        || (locKey && locationKeyFromStored(scene.lastLocationKey) !== locKey);
      const autoSonarRoom = !!(sonarPlaceId && compass.rooms?.[sonarPlaceId] && !stale && (newestAt > 0 || !Number(scene.lastClapAt)));
      if (locKey && placeChanged) {
        if (force || autoHeaderLoc || (persist && autoSonarRoom)) {
          commitNow(this.storage, {
            occupancy: { mode: 'compass', placeKey: locKey, placeId: sonarPlaceId },
          }, { force: true, source: force ? 'clap' : (autoHeaderLoc ? 'header' : 'sonar'), scene, bus: this.bus });
          this._scheduleSuiteBuild();
          if (scene.trackStar) {
            this._pushComposerLocation(this._sceneLocationBits(compass, compass.sonar?.lastPlaceId, locKey));
          }
        } else if (!stale) {
          proposeNow(this.storage, {
            occupancy: { mode: 'compass', placeKey: locKey, placeId: sonarPlaceId },
            location: { key: locKey, placeId: sonarPlaceId, label: locKey },
          }, { source: autoHeaderLoc ? 'header' : 'sonar', scene });
        }
        if (persist) {
          try { this.saveState(); } catch { /* ignore */ }
        }
      } else if (locKey && normalizeTravel(scene.travel, { lastLocationKey: scene.lastLocationKey }).mode === 'moving'
        && (autoHeaderLoc || force || (persist && autoSonarRoom))) {
        if (force || (persist && autoSonarRoom)) {
          commitNow(this.storage, {
            occupancy: { mode: 'compass', placeKey: locKey, placeId: sonarPlaceId },
          }, { force: true, source: force ? 'clap' : 'sonar', scene, bus: this.bus });
          this._scheduleSuiteBuild();
        } else {
          proposeNow(this.storage, {
            occupancy: { mode: 'compass', placeKey: locKey, placeId: sonarPlaceId },
            location: { key: locKey, placeId: sonarPlaceId, label: locKey },
          }, { source: 'header', scene });
        }
        if (persist) {
          try { this.saveState(); } catch { /* ignore */ }
        }
      } else if (persist && ulChanged) {
        try { this.saveState(); } catch { /* ignore */ }
      }
      const cal = normalizeCalendar(this.storage.getChat('script', {})?.settings?.calendar);
      const sceneHit = applySceneCuesFromChat(scene, chat, {
        calendar: cal,
        afterTs: force ? 0 : scene.lastClapAt,
        force,
      });
      if (sceneHit.pending) {
        this._queuePendingCue(scene, {
          date: sceneHit.pending.date || null,
          time: sceneHit.pending.time || null,
        });
        try {
          proposeNow(this.storage, {
            date: sceneHit.pending.date || undefined,
            time: sceneHit.pending.time || undefined,
          }, { source: 'cue', scene });
        } catch { /* ignore */ }
      }
      if (sceneHit.changed && sceneHit.time && Number.isFinite(Number(sceneHit.time.hour))) {
        this._syncTimelinePresent({
          deltaDays: sceneHit.time.deltaDays,
          hour: Number(sceneHit.time.hour),
          minute: sceneHit.time.minute,
        });
      }
      if (sceneHit.changed && sceneHit.date) {
        this._syncTimelinePresent({
          deltaDays: sceneHit.date.deltaDays,
          hour: sceneHit.date.hour,
          parts: sceneHit.date.parts,
          create: sceneHit.date.kind === 'absolute',
        });
      }
      if (sceneHit.changed || sceneHit.date || scene.pendingCue) {
        try {
          if (sceneHit.changed) {
            const snap = this._sceneClapSnapshot(st);
            if (scene.date && snap.date && snap.date !== '—') {
              scene.lastDateLabel = snap.date;
            }
            if (scene.time && snap.time) {
              scene.lastTimeLabel = snap.time;
            }
            commitNow(this.storage, {
              clock: {
                timeLabel: scene.lastTimeLabel,
                hour: scene.lastTimeHour,
                minute: scene.lastTimeMinute,
                dateLabel: scene.lastDateLabel,
                weatherEmoji: scene.weatherEmoji,
                weatherLabel: scene.weatherLabel,
              },
            }, { source: 'cue', scene });
          }
          if (persist) this.saveState();
        } catch { /* ignore */ }
      }
      if (persist) this._syncAutoPresence();
    } catch { /* ignore */ }
  }

  _syncAutoPresence({ persist = true } = {}) {
    try {
      const st = this._db();
      const scene = normalizeTrackers(st.trackers).scene;
      const { doc } = ensureNow(this.storage, { scene });
      const compass = ensureCompass(st);
      const out = syncCastPresence(this.storage, {
        chat: getContext()?.chat || [],
        compass,
        occupancy: doc.occupancy,
        persist,
      });
      if (out?.members?.length) syncSonarPresence(compass, out.members);
    } catch { /* ignore */ }
  }

  /** Focus a place from the Set list and drop a child inspect that belongs elsewhere. */
  _focusIndexedPlace(st, placeId) {
    const id = String(placeId || '').trim();
    if (!id) return;
    this._compassFocusId = id;
    this._suiteFromChild = false;
    const childId = this._suiteHighlightChild;
    if (childId && childId !== id) {
      const child = getPlace(ensureCompass(st), childId);
      if (child?.parentId !== id) this._suiteHighlightChild = '';
    }
    this._openPlaceFloorplanIfNeeded(st, id);
  }

  _openPlaceFloorplanIfNeeded(st, placeId, { force = false } = {}) {
    const id = String(placeId || '').trim();
    if (!id) return;
    this._compassTry(() => {
      const compass = ensureCompass(st);
      const place = getPlace(compass, id);
      if (!place || !isCompassPlaceKind(place.kind)) return;
      if (isSuiteHostKind(place.kind)) {
        const hasRooms = listSuiteChildren(compass, place.id).length > 0;
        const hasUnits = listSuiteUnits(compass, place.id).length > 0;
        if (hasRooms || hasUnits) return;
      } else if (!force) {
        return;
      }
      if (compass.activeRoomId !== id) loadRoom(compass, id);
      this._compassSave(st);
    });
  }

  _receiptCadenceId() {
    try {
      const rec = normalizeTrackers(this.storage.getChat('backstage', {})?.trackers).receipt;
      if (!rec?.enabled) return '';
      return rec.cadence || 'per_turn';
    } catch {
      return '';
    }
  }

  _receiptCount() {
    const chat = getContext()?.chat || [];
    const play = chat.filter(m => m && !m.is_system);
    const cad = this._receiptCadenceId();
    if (cad === 'per_n' || cad === 'per_post') return play.filter(m => !m.is_user).length;
    return play.length;
  }

  _scheduleReceiptCadence({ stampTarget } = {}) {
    const cad = this._receiptCadenceId();
    if (!cad || cad === 'manual') return;
    const target = stampTarget || (cad === 'per_turn' ? 'user' : 'ai');
    clearTimeout(this._locTrackTimer);
    const kick = () => {
      if (this._receiptBusy) {
        this._locTrackTimer = setTimeout(kick, 800);
        return;
      }
      this._receiptBusy = true;
      console.log('[Showtime/receipt] scheduled run', { cadence: cad, target });
      runReceiptFiling(this.storage, { bus: this.bus, cursor: this, stampTarget: target })
        .then(() => this._scheduleSuiteBuild())
        .catch(err => console.warn('[Showtime/receipt]', err))
        .finally(() => { this._receiptBusy = false; });
    };
    this._locTrackTimer = setTimeout(kick, 800);
  }

  _scheduleWorldIndexAudit() {
    clearTimeout(this._worldIndexTimer);
    const kick = () => {
      if (this._worldIndexBusy) {
        this._worldIndexTimer = setTimeout(kick, 800);
        return;
      }
      this._worldIndexBusy = true;
      runWorldIndexAudit(this.storage, { bus: this.bus })
        .catch(err => console.warn('[Showtime/WorldIndex]', err))
        .finally(() => { this._worldIndexBusy = false; });
    };
    this._worldIndexTimer = setTimeout(kick, 900);
  }

  _scheduleLocCadence() {
    this._scheduleReceiptCadence();
  }

  _scheduleLocFallbackCadence() {
    const st = this._db();
    st.trackers = normalizeTrackers(st.trackers);
    if (st.trackers.receipt?.enabled !== false) return;
    if (st.trackers.location?.enabled === false) return;
    clearTimeout(this._locTrackTimer);
    this._locTrackTimer = setTimeout(() => {
      void this._runLocCadence().catch(err => console.warn('[Showtime/location cadence]', err));
    }, 900);
  }

  _handleReceiptLocationNotice(receipt) {
    const st = this._db();
    st.trackers = normalizeTrackers(st.trackers);
    if (st.trackers.location?.enabled === false) return;
    const loc = receipt?.location;
    if (!loc || loc.mode !== 'compass') return;
    const rawPlace = String(loc.placeKey || loc.place || '').trim();
    if (!rawPlace) return;
    const compass = ensureCompass(st);
    const prevPlaceId = String(compass.sonar?.lastPlaceId || '');
    const prevPlace = prevPlaceId ? getPlace(compass, prevPlaceId) : null;
    const filing = resolveLocationFiling(
      { here: rawPlace, kind: loc.placeKind || '', parent: loc.parentName || '' },
      { compass, storage: this.storage, trackerPlace: prevPlace },
    );
    if (!filing?.name) return;
    if (!filing.known || (loc.changed && !st.trackers.scene?.pendingCue)) {
      this._emitLocationNotice(filing);
    }
  }

  async _runLocCadence({ skipIfLocationChanged = false } = {}) {
    if (this._locBusy) return;
    if (skipIfLocationChanged) return;
    const st = this._db();
    st.trackers = normalizeTrackers(st.trackers);
    if (st.trackers.location?.enabled === false) return;
    const chat = getContext()?.chat || [];
    const windowRows = (chat.filter(m => m && !m.is_system) || []).slice(-8);
    const windowText = windowRows.map(m => formatChatLine(m, 480)).filter(Boolean).join('\n');
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
      if (delta.here && !confirmSettingHere(scene, delta.here)) delta.here = '';
      const prevKey = locationKeyFromStored(st.trackers.scene?.lastLocationKey || '');
      const prevPlaceId = String(compass.sonar?.lastPlaceId || '');
      const prevPlace = prevPlaceId ? getPlace(compass, prevPlaceId) : null;
      const filing = resolveLocationFiling(delta, {
        compass,
        storage: this.storage,
        trackerPlace: prevPlace,
      });
      if (delta.here) {
        const hereKey = locationKeyFromStored(delta.here || filing?.name || '');
        if (hereKey && hereKey.toLowerCase() !== String(prevKey || '').toLowerCase()) {
          this._queuePendingCue(st.trackers.scene, {
            location: {
              key: hereKey,
              placeId: String(filing?.placeId || '').trim(),
              label: hereKey,
            },
          });
        }
        delta.here = '';
      }
      const applied = applyLocationDelta(compass, this.storage, delta);
      const hereKey = locationKeyFromStored(applied.key || filing?.name || '');
      const sameTracker = !!(filing?.placeId && prevPlaceId && filing.placeId === prevPlaceId)
        || !!(hereKey && prevKey && hereKey.toLowerCase() === String(prevKey).toLowerCase());
      if (applied.changed) {
        try { this.saveState(); } catch { /* ignore */ }
      }
      if (filing && hereKey && !sameTracker && !st.trackers.scene.pendingCue) {
        this._emitLocationNotice(filing);
      }
      this._scanChatTrackers({ persist: true });
      try { this._syncFloatingClapper(false, { scan: false }); } catch { /* ignore */ }
      if (this.container && this._door === 'set') this.render(this.container);
    } finally {
      this._locBusy = false;
    }
  }

  _rememberListingCode(code) {
    const v = canonicalizeListingCode(code);
    if (!v) return;
    const st = this._db();
    const pal = collectListingPalette([...(st.customListingCodes || []), v, ...listingCodesFromPlaces(ensureCompass(st))]);
    st.customListingCodes = pal.custom;
    this.saveState();
  }

  _emitLocationNotice(filing) {
    const st = this._db();
    if (clapperIsShowing(st.trackers)) return;
    const name = String(filing?.name || '').trim();
    if (!name) return;
    const key = name.toLowerCase();
    if (this._locNoticeKey === key) return;
    this._locNoticeKey = key;
    const kindLabel = filing.kindLabel || filing.kind || '';
    const nest = filing.parentName ? `nest under ${filing.parentName}?` : '';
    const text = filing.known
      ? `Scene moved · ${name}${kindLabel ? ` · ${kindLabel}` : ''} · update tracker?`
      : `New scene · ${name}${kindLabel ? ` · ${kindLabel}` : ''}${nest ? ` · ${nest}` : ''}`;
    this.bus?.emit('showtime.notice', {
      kind: 'location',
      items: [{
        text,
        mark: '?',
        name,
        locKey: key,
        placeKind: filing.kind || '',
        parentId: filing.parentId || '',
        placeId: filing.placeId || '',
      }],
    });
  }

  _applyLocationDraft(draft = {}) {
    const name = String(draft.name || '').trim();
    const placeId = String(draft.placeId || '').trim();
    const kind = String(draft.kind || '').trim();
    const parentId = String(draft.parentId || '').trim();
    this._door = 'set';
    this._prodFolds ??= new Set();
    this._prodFolds.add('set-places');
    if (placeId) {
      this._compassFocusId = placeId;
      this._setCreateOpen = false;
      this._setCreateDraft = null;
    } else {
      this._setCreateOpen = true;
      this._setCreateDraft = { name, kind, parentId };
    }
    const shell = window.Showtime?.shell;
    shell?.activate?.('backstage');
    if (this.container) this.render(this.container);
  }

  _sceneLocationBits(compass, placeId, fallback = '') {
    const place = placeId ? getPlace(compass, placeId) : null;
    const names = lowestLocationNames(compass, place);
    if (names.length) return names;
    const key = locationKeyFromStored(fallback);
    return key ? [key] : [];
  }

  _stampTimelinePresent(parts, cal) {
    const y = Number(parts?.year);
    const mi = Number(parts?.monthIndex);
    const d = Math.max(1, Number(parts?.day) || 1);
    const h = Number.isFinite(Number(parts?.hour)) ? Number(parts.hour) : 0;
    const earth = (Number(cal?.monthsPerYear) || 12) === 12 && Number.isFinite(y) && Number.isFinite(mi);
    const sort = earth
      ? earthDateSort(Date.UTC(y, Math.max(0, mi), d, Math.min(23, Math.max(0, h))))
      : calendarSort(parts, cal);
    return {
      parts,
      sort: Number.isFinite(sort) ? sort : 0,
      key: formatTimeKey(parts, cal) || '',
      scale: earth ? 'date' : 'calendar',
    };
  }

  _syncTimelinePresent({ hour, deltaDays, parts: cueParts, minute, create = false } = {}) {
    const hasHour = Number.isFinite(Number(hour));
    const days = Math.trunc(Number(deltaDays) || 0);
    const abs = cueParts && typeof cueParts === 'object' ? cueParts : null;
    if (!hasHour && !days && !abs) return;
    try {
      const script = this.storage.getChat('script', {});
      script.settings ??= {};
      let present = script.settings.timelinePresent;
      const cal = normalizeCalendar(script.settings.calendar);
      if ((!present?.parts || typeof present.parts !== 'object') && create) {
        const seed = { ...(abs || {}) };
        if (hasHour) seed.hour = Number(hour);
        if (Number.isFinite(Number(minute))) seed.minute = Math.max(0, Math.min(59, Number(minute)));
        script.settings.timelinePresent = this._stampTimelinePresent(seed, cal);
        this.storage.saveChat();
        return;
      }
      if (!present?.parts || typeof present.parts !== 'object') return;
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
      Object.assign(present, this._stampTimelinePresent(parts, cal));
      this.storage.saveChat();
    } catch { /* ignore */ }
  }

  _syncTimelineHour(hour) {
    this._syncTimelinePresent({ hour });
  }

  _runSonar(compass, { persist = false } = {}) {
    try {
      this._sonarAt = Date.now();
      const before = sonarFingerprint(compass?.sonar);
      const chat = getContext()?.chat || [];
      const castMembers = this._sonarCast({ includeWrittenOut: true });
      const st = this._db();
      const scene = normalizeTrackers(st.trackers).scene;
      const heldPlaceId = scene.boardHeld
        ? String(scene.travel?.placeId || compass?.activeRoomId || '').trim()
        : '';
      const afterTs = scene.boardHeld ? (Number(scene.lastClapAt) || 0) : 0;
      const result = applySonarPings(compass, {
        castMembers,
        storage: this.storage,
        chat,
        heldPlaceId,
        afterTs,
      });
      const pinned = pinNarratedSplitScene(compass, {
        chatId: String(getContext()?.chatId || ''),
        castMembers,
        storage: this.storage,
        chat,
      });
      if (pinned) {
        try { this.saveState(); } catch { /* ignore */ }
      }
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
    let place = getPlace(compass, placeId);
    if (!place) {
      void showtimeAlert('Select a room on the suite plan, or open a room, then We’re here.', { title: 'ESTABLISH LOCATION' });
      return;
    }
    if (!isScenePlaceKind(place.kind)) {
      const childId = defaultStandingChild(compass, place.id);
      const childPlace = childId ? getPlace(compass, childId) : null;
      if (childPlace) {
        place = childPlace;
      } else {
        void showtimeAlert('Pick a room, hall, building exterior, or an area / city / country — a unit isn’t a standing location.', { title: 'ESTABLISH LOCATION' });
        return;
      }
    }
    let cellId = 'C';
    try { cellId = normalizeCell(cell || this._compassSelCell || 'C'); } catch { cellId = 'C'; }
    this._compassTry(() => {
      if (isCompassPlaceKind(place.kind)) {
        loadRoom(compass, place.id);
      }
      this._compassSelCell = cellId;
      const focus = getPlace(compass, this._compassFocusId);
      if (!isCompassPlaceKind(place.kind)) {
        this._compassFocusId = place.id;
      } else if (isSuiteHostKind(focus?.kind) && place.parentId === focus.id) {
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
      st.trackers.scene.lastClapAt = Date.now();
      commitNow(this.storage, {
        occupancy: { mode: 'compass', placeKey: rawKey, placeId: place.id },
      }, { force: true, source: 'pin', scene: st.trackers.scene, bus: this.bus });
      this._armBoardHold(st.trackers.scene);
      compass.sonar = compass.sonar && typeof compass.sonar === 'object' ? compass.sonar : { pings: {} };
      compass.sonar.pings = compass.sonar.pings && typeof compass.sonar.pings === 'object'
        ? compass.sonar.pings
        : {};
      const now = Date.now();
      compass.sonar.lastKey = rawKey;
      compass.sonar.lastPlaceId = place.id;
      compass.sonar.lastAt = now;
      const star = getStarMember(this.storage);
      if (star?.name) {
        const id = String(star.id || star.name);
        compass.sonar.pings[id] = {
          name: star.name,
          castId: id,
          placeId: place.id,
          cell: cellId,
          key: rawKey,
          at: now,
          manual: true,
          away: false,
          awayLabel: '',
          departedFrom: '',
          listening: false,
          listeningVia: '',
          listeningPlaceId: '',
        };
      }
      const castMembers = this._sonarCast({ includeWrittenOut: true });
      for (const m of castMembers) {
        if (!m?.name || m.presence !== 'inPlay') continue;
        const id = String(m.id || m.name);
        const prev = compass.sonar.pings[id] || {};
        if (prev.locked) continue;
        compass.sonar.pings[id] = {
          ...prev,
          name: m.name,
          castId: id,
          placeId: place.id,
          cell: (star?.name && id === String(star.id || star.name)) ? cellId : (prev.cell || cellId),
          key: rawKey,
          at: now,
          manual: true,
          away: false,
          awayLabel: '',
          departedFrom: '',
          listening: false,
          listeningVia: '',
          listeningPlaceId: '',
        };
      }
      reconcileRoomOccupants(compass, castMembers);
      this._pushComposerLocation(this._sceneLocationBits(compass, place.id, rawKey));
      this._compassSave(st);
    });
    this._syncAutoPresence();
    this._syncStageBackground();
    this._syncWeatherOverlay();
    this._syncFloatingClapper(false, { scan: false });
    this.bus?.emit('showtime.stateChanged');
    if (this._door === 'set' || this._door === 'placement' || this._door === 'production') {
      this.render(this.container);
    }
    this._scheduleSuiteBuild();
  }

  _suiteSceneClip() {
    const chat = getContext()?.chat || [];
    return chat.slice(-12).map(m => `${m?.name || ''}: ${String(m?.mes || '').slice(0, 400)}`).join('\n');
  }

  _scheduleSuiteBuild() {
    clearTimeout(this._suiteBuildTimer);
    this._suiteBuildTimer = setTimeout(() => { void this._kickSuiteBuild(); }, 900);
  }

  async _kickSuiteBuild() {
    if (this._suiteBuildBusy) {
      this._scheduleSuiteBuild();
      return;
    }
    const st = this._db();
    st.trackers = normalizeTrackers(st.trackers);
    const travel = normalizeTravel(st.trackers.scene?.travel, {
      lastLocationKey: st.trackers.scene?.lastLocationKey,
    });
    if (travel.mode !== 'compass') return;
    const compass = ensureCompass(st);
    this._suiteBuildBusy = true;
    try {
      const hit = await runSuiteProgram(this.storage, compass, travel, {
        scene: this._suiteSceneClip(),
      });
      if (!hit?.draft) return;
      this.saveState();
      this.bus?.emit('showtime.notice', {
        kind: 'suite',
        items: [{
          text: `Compass builder · ${hit.draft.hostName || 'suite'}`,
          mark: '+',
          hostId: hit.draft.hostId,
        }],
      });
      this.bus?.emit('showtime.stateChanged');
      if (this.container && this._door === 'set') this.render(this.container);
    } catch (err) {
      console.warn('[Showtime/SuiteBuild]', err);
    } finally {
      this._suiteBuildBusy = false;
    }
  }

  _openSuiteDraft(draft = {}) {
    this._door = 'set';
    const hostId = String(draft.hostId || '').trim();
    if (hostId) this._compassFocusId = hostId;
    const shell = window.Showtime?.shell;
    shell?.activate?.('backstage');
    if (this.container) this.render(this.container);
  }

  async _acceptSuiteDraft() {
    const st = this._db();
    const compass = ensureCompass(st);
    this._busy = true;
    try {
      const result = await commitSuiteDraft(this.storage, compass, {
        scene: this._suiteSceneClip(),
      });
      if (result?.hostId) this._compassFocusId = result.hostId;
      this._compassSave(st);
    } catch (err) {
      console.warn('[Showtime/SuiteBuild]', err);
      void showtimeAlert(err?.message || 'Could not build those rooms.', { title: 'SUITE BUILDER', danger: true });
    } finally {
      this._busy = false;
    }
  }

  _dismissSuiteDraft() {
    const st = this._db();
    const compass = ensureCompass(st);
    dismissSuiteDraft(compass);
    this.saveState();
    if (this.container && this._door === 'set') this.render(this.container);
  }

  _setHTML(st) {
    const compass = ensureCompass(st);
    const active = getActiveRoom(compass);
    if (!this._compassFocusId) this._compassFocusId = compass.activeRoomId || '';
    if (!this._compassSelCell) this._compassSelCell = 'C';
    const focus = getPlace(compass, this._compassFocusId);
    if (!isSuiteHostKind(focus?.kind)) this._suiteFromChild = false;
    if (isSuiteHostKind(focus?.kind)) {
      try {
        const { dirty } = ensureSuiteLayout(compass, focus.id);
        if (dirty) this.saveState();
      } catch { /* ignore */ }
    }
    const sonar = this._runSonar(compass);
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
      suiteFromChild: !!this._suiteFromChild,
      herePlaceId: this._trackerPlace(compass, normalizeTrackers(st.trackers).scene)?.id
        || compass.sonar?.lastPlaceId
        || compass.activeRoomId
        || '',
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
      storyFocus: (this._suiteStoryFocus === 'lower' || this._suiteStoryFocus === 'upper')
        ? this._suiteStoryFocus
        : (this._suiteStoryFocus != null && this._suiteStoryFocus !== '' && Number.isFinite(Number(this._suiteStoryFocus))
          ? String(Math.round(Number(this._suiteStoryFocus)))
          : 'upper'),
      storage: this.storage,
      createOpen: !!this._setCreateOpen,
      sonarFilter: this._sonarFilter || '',
      sonarView: this._sonarView || 'all',
      sonarOpen: !!(this._prodFolds?.has('set-sonar')),
      placesFold: [...(this._placesFold || [])],
      placesFoldAuto: !this._placesFoldUser,
      placesEditId: this._placesEditId || '',
      createDraft: this._setCreateDraft || null,
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

  _studioTrackersInner(st) {
    const trackers = normalizeTrackers(st.trackers);
    const clap = this._sceneClapSnapshot(st);
    const seasonHint = clap.season || '';
    const draft = this._sceneSetDraft(st);
    return buildTrackersHtml(trackers, {
      esc,
      clap,
      seasonHint,
      calendar: draft.calendar,
      setDraft: draft,
      embedded: true,
    });
  }

  _openDoor(door) {
    const id = String(door || '').trim();
    if (this._doorShut(id)) {
      this._door = '';
      return;
    }
    if (id === 'studio-trackers') {
      this._door = 'production';
      this._prodFolds ??= new Set();
      this._prodFolds.add('trackers');
      return;
    }
    this._door = id;
  }

  _sceneClapSnapshot(st = this._db(), { lite = false } = {}) {
    const t = normalizeTrackers(st.trackers);
    const scene = t.scene;
    const compass = ensureCompass(st);
    // Use the last saved pings. A fresh scan walks every room and tag, and
    // the clapper paints on chat load — that is what locks the page after
    // the messages are up. Generate and the Set view still scan.
    const trackerPlace = this._trackerPlace(compass, scene, { scanFormatted: !lite });
    let travel = normalizeTravel(scene.travel, { lastLocationKey: scene.lastLocationKey });
    try {
      const now = ensureNow(this.storage, { scene });
      travel = now.doc.occupancy;
      if (now.doc.lastLocationKey) scene.lastLocationKey = now.doc.lastLocationKey;
    } catch { /* ignore */ }
    let location = locationKeyFromStored(travel.placeKey || scene.lastLocationKey)
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
      if (travel.mode === 'moving') {
        location = formatOccupancyLabel(travel, { lastLocationKey: scene.lastLocationKey });
      } else {
        location = formatSceneLocation({
          compass,
          storage: this.storage,
          placeId: travel.placeId || trackerPlace?.id || '',
          key: location,
        });
      }
    } catch { /* ignore */ }

    let season = '';
    let dateLabel = scene.lastDateLabel || '';
    let timeLabel = scene.lastTimeLabel || '';
    try {
      const script = this.storage.getChat('script', {});
      const cal = normalizeCalendar(script?.settings?.calendar);
      let parts = null;
      const labelsReady = !!(scene.lastDateLabel || scene.lastTimeLabel || scene.lastTimeHour != null);
      // Lite skips the script-deck walk. Stored board labels already say when it is.
      if (scene.followTimeline !== false && !(lite && labelsReady)) {
        const present = currentTimelinePresent(this.storage);
        if (present?.parts) parts = present.parts;
      }

      if (parts) {
        const seasonHit = parts.seasonId
          ? cal.seasons.find(s => s.id === parts.seasonId || s.label.toLowerCase() === String(parts.seasonId).toLowerCase())
          : (parts.monthIndex != null ? seasonForMonth(cal, Number(parts.monthIndex) + 1) : null);
        season = seasonHit?.label || '';
      }
      if (scene.date) {
        if (scene.boardHeld && scene.lastDateLabel) {
          dateLabel = scene.lastDateLabel;
        } else {
          const absCue = String(scene.lastDateCueSig || '').startsWith('absolute');
          if (absCue && scene.lastDateLabel) {
            dateLabel = scene.lastDateLabel;
          } else if (parts) {
            dateLabel = formatSceneDate(parts, cal, scene.dateParts) || dateLabel;
          }
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
    if (this._houseClosed()) return this._productionGalleryHTML();
    const compass = ensureCompass(st);
    const places = Object.values(compass.rooms || {})
      .filter(p => p.kind === 'room' || p.kind === 'transitional' || p.kind === 'hall')
      .sort((a, b) => a.name.localeCompare(b.name));
    const ctx = this._bgContext();
    return buildVisualsHtml(normalizeVisuals(st.visuals), { esc, places, ctx, placeName: ctx.placeName });
  }

  _productionGallery() {
    const g = this._g();
    if (!g.gallery || typeof g.gallery !== 'object') g.gallery = { plates: [] };
    if (!Array.isArray(g.gallery.plates)) g.gallery.plates = [];
    return g.gallery;
  }

  _productionNames() {
    const names = [];
    const seen = new Set();
    const push = (raw) => {
      const name = String(raw || '').trim();
      const key = name.toLowerCase();
      if (!name || seen.has(key)) return;
      seen.add(key);
      names.push(name);
    };
    try {
      for (const row of listReelCatalog(extension_settings)) push(row.title || row.file);
    } catch { /* reel shelf is optional */ }
    for (const plate of this._productionGallery().plates) {
      for (const name of plate.productions || []) push(name);
    }
    return names;
  }

  _productionGalleryHTML() {
    const plates = this._productionGallery().plates;
    const names = this._productionNames();
    const chips = names.length
      ? `<div class="bst-chip-row">${names.map(name =>
        `<button type="button" class="bst-chip" data-action="gallery-fill" data-prod="${esc(name)}">${esc(name)}</button>`).join('')}</div>`
      : '<p class="bst-hint">Export a reel and its title shows up here. A plate can carry more than one.</p>';
    const cards = plates.length
      ? plates.map(plate => {
        const src = String(plate.url || '').replace(/"/g, '');
        const prods = (plate.productions || []).map(name =>
          `<button type="button" class="bst-chip on" data-action="gallery-untag" data-id="${esc(plate.id)}" data-prod="${esc(name)}">${esc(name)} ×</button>`).join('');
        return `<article class="bst-gallery-plate">
          ${src ? `<img src="${esc(src)}" alt="">` : '<div class="bst-gallery-blank">No image</div>'}
          <div>
            <strong>${esc(plate.title || 'Untitled')}</strong>
            <div class="bst-chip-row">${prods || '<span class="bst-k">No production yet</span>'}</div>
            <div class="bst-row">
              <input type="text" data-gallery-prod="${esc(plate.id)}" placeholder="Add a production" maxlength="80">
              <button type="button" class="bst-btn" data-action="gallery-tag" data-id="${esc(plate.id)}">Add</button>
              <button type="button" class="bst-btn" data-action="gallery-drop" data-id="${esc(plate.id)}">Delete</button>
            </div>
          </div>
        </article>`;
      }).join('')
      : '<p class="bst-hint">No plates yet. A plate can belong to several productions at once.</p>';
    return `
      <h2 class="bst-pane-title">Visuals</h2>
      <p class="bst-pane-sub">A gallery for productions. One plate can hang on more than one reel.</p>
      <section class="bst-section">
        <label class="bst-field"><span>Title</span>
          <input type="text" data-gallery-title maxlength="80" placeholder="Night train">
        </label>
        <label class="bst-field"><span>Image address</span>
          <input type="text" data-gallery-url placeholder="https://…">
        </label>
        <label class="bst-field"><span>Productions</span>
          <input type="text" data-gallery-productions placeholder="Lost &amp; Found, Other">
        </label>
        ${chips}
        <button type="button" class="bst-btn gold" data-action="gallery-add">Add plate</button>
      </section>
      <div class="bst-gallery">${cards}</div>`;
  }

  _splitProductions(raw) {
    return [...new Set(String(raw || '').split(/[,;\n]/).map(s => s.trim()).filter(Boolean))];
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
      void showtimeAlert(err.message || String(err), { title: 'SET COMPASS', danger: true });
      return false;
    }
  }

  // ── Settings ───────────────────────────────────────────────────────────────

  _houseHealthLines({ measure = false } = {}) {
    if (measure) {
      try { this.injector?.refreshAlwaysOn?.(); } catch { /* ignore */ }
    }
    return formatHouseHealthLines({
      health: readHouseHealth(this.storage),
      injects: this.injector?.lastAlwaysOn || [],
    });
  }

  _houseHealthRows(lines) {
    const row = (k, v) => `<div class="bst-health-row"><span>${esc(k)}</span><span class="bst-k">${esc(v)}</span></div>`;
    return `<div class="bst-health-rows" data-role="house-health-rows">
        ${row('Receipt', lines.receipt)}
        ${row('Presence', lines.presence)}
        ${row('Cue', lines.cue)}
        ${row('Injects', lines.injects)}
      </div>`;
  }

  _houseHealthHTML() {
    const lines = this._houseHealthLines({ measure: true });
    return `
      <section class="bst-section bst-health" data-role="house-health">
        <h3 class="bst-section-h">House health</h3>
        <p class="bst-hint">Whether Showtime ran — not whether the model filed the right story.</p>
        ${this._houseHealthRows(lines)}
      </section>`;
  }

  _refreshHouseHealth() {
    if (this._door !== 'settings' || !this.container) return;
    const host = this.container.querySelector('[data-role="house-health-rows"]');
    if (!host) return;
    host.outerHTML = this._houseHealthRows(this._houseHealthLines());
  }

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

      ${this._houseHealthHTML()}

      <section class="bst-section">
        <h3 class="bst-section-h">Handbook</h3>
        <div class="bst-handbook">
          <p>The program is the player glossary: what each tab is for, and what the theatre words mean. The same program opens from the curtain while the house is closed.</p>
          <button type="button" class="bst-btn gold" data-action="open-program">Open program</button>
        </div>
      </section>

      <section class="bst-section">
        <h3 class="bst-section-h">Connection profiles</h3>
        <p class="bst-hint">House defaults for quiet Showtime jobs. Empty = whichever model is currently selected in Connection Manager. Script Agent may still override the Script slot per chat under Script → Configure.</p>
        ${PROFILE_SLOTS.map(s => `
        <div class="bst-field"><span>${esc(s.label)}</span>
          <select data-g="profile-${esc(s.id)}">${profileOpts(g.profiles[s.id])}</select>
          <span class="bst-k">${esc(s.hint)}</span></div>`).join('')}
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
    if (this._door !== 'interview') {
      this._bindFloorplanDrag(root);
      this._bindFloorplanViewport(root);
      this._bindSuiteCanvas(root);
      this._bindLocationTagPickers(root);
      this._applySonarFilter(root);
    }
    this._bindInterviewNotes(root);
    root.querySelectorAll('.bst-set-fold > summary, .bst-sonar-sum, .bst-places-sum').forEach(sum => {
      // A control inside a summary must not toggle the folder. preventDefault
      // cancels that toggle; the click still bubbles so Open / Edit / Compass run.
      // stopPropagation here used to eat the click, which meant a building or
      // unit row (they live in the summary) could never be focused.
      sum.addEventListener('click', (e) => {
        if (e.target.closest('button, select, input, textarea, label, [data-action], [data-role^="place-edit"]')) {
          e.preventDefault();
        }
      }, true);
      sum.addEventListener('dblclick', (e) => {
        if (e.target.closest('[data-action="place-edit"], [data-action="place-open-compass"], [data-action="place-unlisted-dismiss"], [data-action="place-edit-save"], [data-action="place-edit-cancel"]')) return;
        const row = e.target.closest('[data-action="set-open-place"]') || sum.querySelector('[data-action="set-open-place"]');
        const placeId = row?.dataset.place || '';
        if (!placeId) return;
        e.preventDefault();
        this._focusIndexedPlace(this._db(), placeId);
        this.render(this.container);
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

  _bindInterviewNotes(root) {
    root?.querySelectorAll?.('details[data-role="iv-notes"]').forEach(el => {
      el.addEventListener('toggle', () => {
        const st = this._db();
        if (!st.interview?.active) return;
        st.interview.notesOpen = !!el.open;
        this.saveState();
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
      bindNarrativeLocationPicker(wrap, this.storage);
    });
    root.querySelectorAll('.st-loctag-wrap[data-role="focus-loctags"]').forEach(wrap => {
      const place = this._compassFocusId;
      bindNarrativeLocationPicker(wrap, this.storage, {
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
        const dxW = w.x - dragging.startWorld.x;
        const dyW = w.y - dragging.startWorld.y;
        dragging.pose = normalizeSuitePose({
          x: dragging.startPose.x + dxW,
          y: dragging.startPose.y + dyW,
          rot: dragging.startPose.rot,
        });
        dragging.moved = true;
        if (dragging.isNestedUnit && dragging.g) {
          const dxPx = (dxW / bounds.w) * svgW;
          const dyPx = (dyW / bounds.h) * svgH;
          dragging.g.setAttribute('transform', `translate(${dxPx.toFixed(1)}, ${dyPx.toFixed(1)})`);
          return;
        }
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
        dragging.step = step;
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
              castMembers: getCastMembers(this.storage),
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
            d.step,
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
        const isNestedUnit = room.kind === 'unit';
        let startPoseRaw = unit.suiteLayout?.[childId];
        if (!startPoseRaw && isNestedUnit) {
          const handleCx = Number(handle.getAttribute('cx')) || 0;
          const handleCy = Number(handle.getAttribute('cy')) || 0;
          const sil = suiteUnitOuterSilhouette(room, listSuiteChildren(compass, childId));
          const b = sil.bounds || { minX: 0, maxX: 8, minY: 0, maxY: 8 };
          const wCx = bounds.minX + (handleCx / svgW) * bounds.w;
          const wCy = bounds.minY + (handleCy / svgH) * bounds.h;
          startPoseRaw = {
            x: wCx - (b.maxX - b.minX) / 2,
            y: wCy - (b.maxY - b.minY) / 2,
            rot: 0,
          };
        }
        const pose = normalizeSuitePose(startPoseRaw || { x: 0, y: 0, rot: 0 });
        const g = svg.querySelector(`[data-suite-child="${childId}"]`) || handle.closest('[data-suite-child]');
        dragging = {
          kind: 'child',
          unitId,
          childId,
          room,
          isNestedUnit,
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
          let clickAlong = null;
          try {
            const room = getPlace(compass, childId);
            const pose = normalizeSuitePose(unit.suiteLayout?.[childId] || { x: 0, y: 0, rot: 0 });
            const wpt = clientToWorld(e);
            const geoFp = unit.suiteVisualFootprints?.[childId] || room?.footprint;
            if (room && geoFp) {
              const norm = worldToFootprintNorm(wpt.x, wpt.y, { ...room, footprint: geoFp }, pose);
              const { a, b } = edgeEndpoints(geoFp, edge);
              clickAlong = alongEdgeFromPoint(a, b, norm.x, norm.y);
            }
          } catch { /* ignore */ }
          const pair = sharedPairForSuiteEdge(compass, unitId, childId, edge, clickAlong);
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

    const gridFor = (placeId) => {
      try {
        const room = getPlace(ensureCompass(this._db()), placeId);
        const grid = Math.max(2, Number(room?.footprint?.grid) || 8);
        return 1 / grid;
      } catch { return 1 / 8; }
    };
    const snapNorm = (v, step, ev) => {
      if (!step || ev?.shiftKey) return v;
      const s = ev?.altKey ? step / 2 : step;
      return Math.round(v / s) * s;
    };
    const clientToNorm = (ev, placeId) => {
      const rect = svg.getBoundingClientRect();
      const inner = FP_SIZE - FP_PAD * 2;
      let x = Math.max(0, Math.min(1, ((ev.clientX - rect.left) / rect.width * FP_SIZE - FP_PAD) / inner));
      let y = Math.max(0, Math.min(1, ((ev.clientY - rect.top) / rect.height * FP_SIZE - FP_PAD) / inner));
      if (placeId) {
        const step = gridFor(placeId);
        x = snapNorm(x, step, ev);
        y = snapNorm(y, step, ev);
      }
      return { x, y };
    };

    const onMove = rafMove((ev) => {
      if (!dragging) return;
      const { x, y } = clientToNorm(ev, dragging.placeId);
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
              castMembers: getCastMembers(this.storage),
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
        const { x, y } = clientToNorm(ev, el.dataset.place);
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
          const { x, y } = clientToNorm(ev, placeId);
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
        const { x, y } = clientToNorm(ev, placeId);
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
      void showtimeAlert('Pick an area on the floorplan for ascent / descent (stairs, ladders, trapdoors).', { title: 'FLOORPLAN FIXTURE' });
      return;
    }
    this._compassTry(() => {
      const compass = ensureCompass(st);
      const room = getPlace(compass, placeId);
      if (!room) return;
      const { a, b } = edgeEndpoints(room.footprint, edge);
      let along = alongEdgeFromPoint(a, b, x, y);
      along = Math.max(0.1, Math.min(0.9, along));
      const link = ensureEdgeLink(compass, placeId, edge, along);
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
      const { a, b } = edgeEndpoints(geoFootprint, edge);
      let along = alongEdgeFromPoint(a, b, norm.x, norm.y);
      along = Math.max(0.1, Math.min(0.9, along));
      const link = ensureEdgeLink(compass, placeId, edge, along);
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
    if (action === 'close-desk') {
      window.Showtime?.shell?.closeClosedHouseDesk?.();
      return;
    }
    if (action === 'gallery-fill') {
      const input = this.container?.querySelector('[data-gallery-productions]');
      if (!input) return;
      const next = this._splitProductions(`${input.value}, ${act.dataset.prod || ''}`);
      input.value = next.join(', ');
      return;
    }
    if (action === 'gallery-add') {
      const title = this.container?.querySelector('[data-gallery-title]')?.value || '';
      const url = this.container?.querySelector('[data-gallery-url]')?.value || '';
      const productions = this._splitProductions(this.container?.querySelector('[data-gallery-productions]')?.value);
      const plate = {
        id: (crypto.randomUUID?.() || `plate-${Date.now()}`),
        title: String(title).trim() || 'Untitled',
        url: String(url).trim(),
        productions,
      };
      if (!/^https?:\/\//i.test(plate.url) && !plate.url.startsWith('/')) {
        void showtimeAlert('Use an image address.', { title: 'GALLERY PLATE' });
        return;
      }
      this._productionGallery().plates.unshift(plate);
      this._saveG();
      return void this.render(this.container);
    }
    if (action === 'gallery-tag') {
      const id = act.dataset.id || '';
      const input = this.container?.querySelector(`[data-gallery-prod="${CSS.escape(id)}"]`);
      const extra = this._splitProductions(input?.value);
      const plate = this._productionGallery().plates.find(p => p.id === id);
      if (!plate || !extra.length) return;
      plate.productions = this._splitProductions([...(plate.productions || []), ...extra].join(', '));
      this._saveG();
      return void this.render(this.container);
    }
    if (action === 'gallery-untag') {
      const plate = this._productionGallery().plates.find(p => p.id === act.dataset.id);
      if (!plate) return;
      const drop = String(act.dataset.prod || '').toLowerCase();
      plate.productions = (plate.productions || []).filter(name => name.toLowerCase() !== drop);
      this._saveG();
      return void this.render(this.container);
    }
    if (action === 'gallery-drop') {
      const bag = this._productionGallery();
      bag.plates = bag.plates.filter(p => p.id !== act.dataset.id);
      this._saveG();
      return void this.render(this.container);
    }
    if (action === 'open') {
      if (this._doorShut(act.dataset.door || '')) return;
      this._openDoor(act.dataset.door || '');
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
    if (action === 'merge-reel') {
      const file = this.container.querySelector('[data-role="merge-reel"]')?.value;
      if (!file) {
        void showtimeAlert('Pick a reel from the shelf.', { title: 'MERGE REEL' });
        return;
      }
      const box = this.container.querySelector('[data-import-merge]');
      if (box) box.checked = true;
      return this._openShelfReel(file);
    }
    if (action === 'export-tab') return this._exportBackstageChat();
    if (action === 'reel-sort') {
      this._reelSort = act.dataset.sort === 'title' ? 'title' : 'newest';
      return void this.render(this.container);
    }
    if (action === 'reel-open') return this._openShelfReel(act.dataset.file);
    if (action === 'reel-download') return this._downloadShelfReel(act.dataset.file);
    if (action === 'reel-delete') return this._deleteShelfReel(act.dataset.file);
    if (action === 'wipe') return this._wipe();
    if (action === 'note-flip') {
      if (!st.interview.active) return;
      const id = act.dataset.note || '';
      st.interview.flippedNote = st.interview.flippedNote === id ? '' : id;
      this.saveState();
      return void this._refreshInterviewAlbum();
    }
    if (action === 'note-ask') {
      if (!st.interview.active) return;
      return this._interviewNoteAsk(act.dataset.note);
    }
    if (action === 'note-rephrase') {
      if (!st.interview.active) return;
      const noteId = act.dataset.note || '';
      if (!noteId) return;
      st.interview.notePick ??= {};
      st.interview.notePick[noteId] ??= {};
      st.interview.notePick[noteId].rephraseOpen = !st.interview.notePick[noteId].rephraseOpen;
      this.saveState();
      this._refreshInterviewAlbum();
      if (st.interview.notePick[noteId].rephraseOpen) {
        queueMicrotask(() => this.container?.querySelector(`[data-note-rephrased="${noteId}"]`)?.focus());
      }
      return;
    }
    if (action === 'iv-send') {
      if (!st.interview.active) return;
      return this._interviewFree();
    }
    if (action === 'iv-retry') {
      const retry = st.interview.retry;
      if (!retry?.question) return;
      return this._interviewTurn(retry.question, retry.askKind || 'free', retry.meta || {}, {
        replay: true,
        replaceIdx: Number.isInteger(retry.replaceIdx) ? retry.replaceIdx : null,
      });
    }
    if (action === 'iv-retry-turn') {
      if (!st.interview.active) return;
      const idx = Number(act.dataset.idx);
      const turns = st.interview.turns || [];
      const turn = turns[idx];
      if (!turn || turn.who !== 'cast' || turn.name === 'Connections') return;
      let qIdx = idx - 1;
      while (qIdx >= 0 && (turns[qIdx].who !== 'user' || turns[qIdx].name === 'Connections')) qIdx--;
      const qTurn = turns[qIdx];
      if (!qTurn?.text && !qTurn?.asked) return;
      return this._interviewTurn(qTurn.asked || qTurn.text, qTurn.askKind || 'free', {
        target: qTurn.target || null,
        display: qTurn.asked ? qTurn.text : '',
      }, { replay: true, replaceIdx: idx });
    }
    if (action === 'iv-retry-dismiss') {
      st.interview.retry = null;
      this.saveState();
      return void this._paintInterviewDesk();
    }
    if (action === 'iv-album-step' || action === 'iv-album-shuffle') {
      if (!st.interview.active) return;
      const dir = action === 'iv-album-shuffle' ? 1 : (Number(act.dataset.dir) || 1);
      const n = NOTECARDS.length;
      const next = (this._ivNoteIdx(st.interview) + dir + n) % n;
      st.interview.noteIdx = next;
      st.interview.flippedNote = '';
      this.saveState();
      return void this._refreshInterviewAlbum();
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
        if (!first) { void showtimeAlert('Add a cast card first.', { title: 'INTERVIEW' }); return; }
        st.interview.subjectId = first.id;
      }
      st.interview.active = true;
      st.interview.startedAt = Date.now();
      st.interview.turns = [];
      st.interview.pendingConn = [];
      st.interview.noteIdx = 0;
      st.interview.flippedNote = '';
      st.interview.retry = null;
      this.saveState();
      return void this.render(this.container);
    }
    if (action === 'interview-end') {
      return this._endInterview({ save: true });
    }
    if (action === 'interview-discard') {
      if ((st.interview.turns || []).length) {
        void showtimeConfirm('End this interview without filing? The live desk will be wiped.', { title: 'DISCARD INTERVIEW', danger: true, confirmLabel: 'Discard' }).then(ok => {
          if (ok) this._endInterview({ save: false });
        });
        return;
      }
      return this._endInterview({ save: false });
    }
    if (action === 'interview-clear') {
      st.interview.turns = [];
      st.interview.pendingConn = [];
      this.saveState();
      return void this._paintInterviewDesk();
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
      void showtimeConfirm('Clear all comments on the active topic?', { title: 'CLEAR TOPIC', danger: true, confirmLabel: 'Clear' }).then(ok => {
        if (!ok) return;
        active.comments = [];
        this.saveState();
        this.render(this.container);
      });
      return;
    }
    if (action === 'pg-clear-all') {
      if (!(st.peanut.sessions || []).length) return;
      void showtimeConfirm('Wipe every Peanut Gallery topic?', { title: 'CLEAR PEANUT GALLERY', danger: true, confirmLabel: 'Wipe all' }).then(ok => {
        if (!ok) return;
        st.peanut.sessions = [];
        st.peanut.activeIdx = -1;
        this.saveState();
        this.render(this.container);
      });
      return;
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
    if (action === 'sonar-privy') {
      const castId = act.dataset.cast || '';
      const member = this._sonarCast().find(m => String(m.id) === String(castId));
      if (!member) return;
      this._compassTry(() => {
        const compass = ensureCompass(st);
        const curPing = compass.sonar?.pings?.[castId];
        const nextListening = !(member.presence === 'privy' || curPing?.listening);
        setSonarListening(compass, member, { listening: nextListening });
        try {
          const castBag = this.storage.getChat('cast', { characters: [] });
          const rec = (castBag.characters || []).find(c => String(c.id || c.name) === String(castId));
          if (rec) {
            rec.presence = nextListening ? 'privy' : 'inPlay';
            rec.updatedAt = Date.now();
            this.bus?.emit('cast.updated', { character: rec });
          }
        } catch { /* ignore */ }
        this._compassSave(st);
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
          const prevPing = compass.sonar?.pings?.[castId] || {};
          const restorePlace = prevPing.placeId || prevPing.departedFrom || prevPing.listeningPlaceId || compass.sonar?.lastPlaceId || compass.activeRoomId || '';
          pinSonarPing(compass, member, {
            placeId: restorePlace,
            cell: prevPing.cell || 'C',
            locked: false,
          });
          if (member.presence === 'privy') {
            try {
              const castBag = this.storage.getChat('cast', { characters: [] });
              const rec = (castBag.characters || []).find(c => String(c.id || c.name) === String(castId));
              if (rec) {
                rec.presence = 'inPlay';
                rec.updatedAt = Date.now();
                this.bus?.emit('cast.updated', { character: rec });
              }
            } catch { /* ignore */ }
          }
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
      const [placeId, linkId, opnId] = pick.split('|');
      if (!placeId || !linkId) { void showtimeAlert('Pick an opening first.', { title: 'SUITE OPENING' }); return; }
      if (!toPlaceId) { void showtimeAlert('Pick a room to link.', { title: 'SUITE OPENING' }); return; }
      this._compassTry(() => {
        const compass = ensureCompass(st);
        const dest = getPlace(compass, toPlaceId);
        if (toPlaceId === '__exterior__' || (dest && (isSuiteHostKind(dest.kind) || isExteriorHostKind(dest.kind)) && toPlaceId === act.dataset.unit)) {
          linkWallToExterior(compass, placeId, linkId);
        } else {
          linkWallToRoom(compass, placeId, linkId, toPlaceId);
        }
        this._lastOpening = { placeId, linkId, opnId };
        this._compassSave(st);
      });
      return;
    }
    if (action === 'compass-create' || action === 'compass-create-populate') {
      const id = this.container.querySelector('[data-role="room-id"]')?.value?.trim();
      const name = this.container.querySelector('[data-role="room-name"]')?.value?.trim() || id;
      let kind = this.container.querySelector('[data-role="place-kind"]')?.value || 'room';
      const parentId = this.container.querySelector('[data-role="place-parent"]')?.value || '';
      const category = kind === 'building'
        ? (this.container.querySelector('[data-role="place-category"]')?.value || '')
        : '';
      const locWrap = this.container.querySelector('.st-loctag-wrap[data-role="place-loctags"]');
      const locationTags = readLocationTags(locWrap);
      const description = this.container.querySelector('[data-role="place-desc"]')?.value?.trim() || '';
      if (!name && !id) { void showtimeAlert('Name or id is required.', { title: 'NEW PLACE' }); return; }
      if (action === 'compass-create-populate' && kind !== 'building') {
        void showtimeAlert('Populate adds rooms inside a building. Set Kind to Building first.', { title: 'POPULATE BUILDING' });
        return;
      }
      this._compassTry(() => {
        const compass = ensureCompass(st);
        const room = createAndStoreRoom(compass, {
          id,
          name: name || id,
          kind,
          parentId,
          locationTags,
          description,
          category,
        });
        if (action === 'compass-create-populate') {
          const chatNarrative = collectRecentChatNarrative(getContext()?.chat || []);
          populatePlaceFromCategory(compass, room.id, category, { narrativeText: chatNarrative });
        }
        try { syncLocationCatalogFromCompass(this.storage, compass); } catch { /* ignore */ }
        this._compassFocusId = room.id;
        if (isCompassPlaceKind(room.kind)) {
          loadRoom(compass, room.id);
        }
        this._compassSave(st);
      });
      this._setCreateOpen = false;
      this._setCreateDraft = null;
      return;
    }
    if (action === 'compass-populate-category') {
      const placeId = act.dataset.place || this._compassFocusId || '';
      const editWrap = act.closest('.bst-set-edit');
      const catVal = editWrap?.querySelector('[data-role="place-edit-category"]')?.value
        || act.parentElement?.querySelector('[data-role="suite-category-select"], [data-role="stage-head-category"], [data-role="focus-category"]')?.value
        || this.container.querySelector(`[data-role="suite-category-select"][data-place="${CSS.escape(placeId)}"]`)?.value
        || this.container.querySelector(`[data-role="stage-head-category"][data-place="${CSS.escape(placeId)}"]`)?.value
        || this.container.querySelector(`[data-role="focus-category"][data-place="${CSS.escape(placeId)}"]`)?.value
        || '';
      if (!placeId) return;
      const host = getPlace(ensureCompass(st), placeId);
      if (host && host.kind !== 'building') {
        void showtimeAlert('Populate adds rooms inside a building. Set Kind to Building first.', { title: 'POPULATE BUILDING' });
        return;
      }
      this._compassTry(() => {
        const compass = ensureCompass(st);
        const chatNarrative = collectRecentChatNarrative(getContext()?.chat || []);
        populatePlaceFromCategory(compass, placeId, catVal, { narrativeText: chatNarrative });
        try { syncLocationCatalogFromCompass(this.storage, compass); } catch { /* ignore */ }
        this._compassFocusId = placeId;
        this._placesEditId = '';
        this._compassSave(st);
      });
      return;
    }
    if (action === 'compass-populate-narrative' || action === 'compass-populate-from-chat') {
      const placeId = act.dataset.place || this._compassFocusId || '';
      const cell = act.dataset.cell || this._compassSelCell || 'C';
      if (!placeId) return;
      const wrap = act.closest('.bst-narrative-populate') || this.container;
      const textEl = wrap?.querySelector(`[data-role="narrative-populate-text"][data-place="${CSS.escape(placeId)}"]`)
        || wrap?.querySelector('[data-role="narrative-populate-text"]');
      const scopeEl = wrap?.querySelector(`[data-role="narrative-populate-scope"][data-place="${CSS.escape(placeId)}"]`)
        || wrap?.querySelector('[data-role="narrative-populate-scope"]');
      const scope = scopeEl?.value || 'auto';
      let narrativeText = action === 'compass-populate-from-chat'
        ? collectRecentChatNarrative(getContext()?.chat || [])
        : String(textEl?.value || '').trim();
      if (!narrativeText && action === 'compass-populate-narrative') {
        narrativeText = collectRecentChatNarrative(getContext()?.chat || []);
      }
      if (!narrativeText) {
        void showtimeAlert('Paste narrative text or send a chat message describing the room first.', { title: 'POPULATE ROOM' });
        return;
      }
      this._compassTry(() => {
        const compass = ensureCompass(st);
        const res = populateRoomsFromNarrative(compass, narrativeText, {
          targetPlaceId: placeId,
          defaultCell: cell,
          scope,
          createMissingRooms: scope !== 'room',
        });
        try { syncLocationCatalogFromCompass(this.storage, compass); } catch { /* ignore */ }
        if (res.addedCount || res.updatedCount || res.touchedRoomIds?.length || res.createdRoomIds?.length) {
          this._compassSave(st);
        } else {
          void showtimeAlert('No new room items or doors detected in the narrative text.', { title: 'POPULATE ROOM' });
        }
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
      else this._setCreateDraft = null;
      return void this.render(this.container);
    }
    if (action === 'suite-listing-code') {
      const placeId = act.dataset.place || '';
      if (placeId) {
        this._suiteHighlightChild = placeId;
        this._compassFocusId = act.dataset.unit || this._compassFocusId;
      }
      return void this.render(this.container);
    }
    if (action === 'place-listing-add') {
      const wrap = act.closest('.bst-set-edit') || this.container.querySelector(`.bst-set-edit[data-node="${CSS.escape(act.dataset.node || '')}"]`);
      const custom = canonicalizeListingCode(wrap?.querySelector('[data-role="place-edit-listing-custom"]')?.value);
      const placeId = act.dataset.place || wrap?.dataset.place || '';
      if (!custom) return;
      this._rememberListingCode(custom);
      if (placeId) {
        this._compassTry(() => {
          setPlaceListingCode(ensureCompass(st), placeId, custom);
          this._compassSave(st);
        });
      }
      this._placesEditId = act.dataset.node || wrap?.dataset.node || this._placesEditId;
      return void this.render(this.container);
    }
    if (action === 'set-open-place') {
      const placeId = act.dataset.place || '';
      const tag = String(act.dataset.tag || '').trim();
      if (placeId) {
        this._focusIndexedPlace(st, placeId);
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
      this._focusIndexedPlace(st, placeId);
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
      const listingSel = String(wrap?.querySelector('[data-role="place-edit-listing"]')?.value || '').trim();
      const listingCustom = String(wrap?.querySelector('[data-role="place-edit-listing-custom"]')?.value || '').trim();
      const listingCode = canonicalizeListingCode(listingCustom || listingSel);
      const categoryEl = wrap?.querySelector('[data-role="place-edit-category"]');
      const category = String(categoryEl?.value || '').trim();
      this._compassTry(() => {
        const compass = ensureCompass(st);
        const allow = PLACE_NEST_PARENTS[kind] || [];
        let parentId = String(wrap?.querySelector('[data-role="place-edit-parent"]')?.value || '').trim();
        const parent = parentId ? compass.rooms[parentId] : null;
        if (!allow.length || !parent || !allow.includes(parent.kind)) parentId = '';
        const rowName = name || oldTag;
        // The row being edited is the place to move. Looking the name up under
        // the newly chosen parent adopted the room that already lived there
        // and then created a second copy of this one.
        let id = (placeId && compass.rooms[placeId]) ? placeId : '';
        if (!id) {
          id = findPlaceByExactName(compass, oldTag)?.id
            || findPlaceByExactName(compass, rowName)?.id
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
            category,
          });
          id = room.id;
          this._compassFocusId = room.id;
        }
        if (id) {
          if (name) renamePlace(compass, id, name);
          if (kind) setPlaceKind(compass, id, kind);
          setParent(compass, id, parentId);
          setPlaceAliases(compass, id, aliases);
          if (categoryEl) setPlaceCategory(compass, id, category);
          if (kind === 'room' || kind === 'transitional' || compass.rooms[id]?.kind === 'room' || compass.rooms[id]?.kind === 'transitional') {
            setPlaceListingCode(compass, id, listingCode);
            if (listingCode) this._rememberListingCode(listingCode);
          }
        } else if (oldTag) {
          const node = findLocationNodeByName(this.storage, oldTag);
          if (node) {
            node.name = name || node.name;
            node.kind = '';
            node.parentId = '';
          }
        }
        const catalogKind = COMPASS_TO_GROUP[kind] || '';
        const moved = id ? compass.rooms[id] : null;
        const roomish = moved && !GEO_PLACE_KIND_SET.has(moved.kind);
        const editedNode = findLocationNodeById(this.storage, act.dataset.node || wrap?.dataset.node || '')
          || (id ? findLocationNodeByPlaceId(this.storage, id) : null);
        if (editedNode && (!editedNode.placeId || editedNode.placeId === id || !compass.rooms[editedNode.placeId])) {
          if (name) editedNode.name = name;
          if (id) editedNode.placeId = id;
          const parentNode = parentId ? findLocationNodeByPlaceId(this.storage, parentId) : null;
          if (parentNode && parentNode.id !== editedNode.id) editedNode.parentId = parentNode.id;
          else if (!parentId) editedNode.parentId = '';
        } else if (!roomish && kind && name && id) {
          const parentCat = parentId
            ? findLocationNodeByPlaceId(this.storage, parentId)
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
      void showtimeConfirm(`Remove "${label}" and every Script / Library / Compass tag that names it?\n\nNested places stay and move up one level.`, { title: 'REMOVE PLACE', danger: true, confirmLabel: 'Remove' }).then(ok => {
        if (!ok) return;
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
      });
      return;
    }
    if (action === 'place-edit-merge') {
      const wrap = act.closest('.bst-set-edit') || this.container.querySelector(`.bst-set-edit[data-node="${CSS.escape(act.dataset.node || '')}"]`);
      const placeId = act.dataset.place || wrap?.dataset.place || '';
      const nodeId = act.dataset.node || wrap?.dataset.node || '';
      const tag = String(act.dataset.tag || wrap?.dataset.tag || '').trim();
      const raw = String(wrap?.querySelector('[data-role="place-edit-merge"]')?.value || '').trim();
      if (!raw) { void showtimeAlert('Pick a location to merge into.', { title: 'MERGE PLACE' }); return; }
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
      if (!destName) { void showtimeAlert('Pick a location to merge into.', { title: 'MERGE PLACE' }); return; }
      const ident = collectLocationIdentity(this.storage, compass, { placeId, nodeId, name: tag });
      const sourceId = placeId || ident.place?.id || '';
      if ((sourceId && targetPlaceId && sourceId === targetPlaceId)
        || (ident.node && targetNode && ident.node.id === targetNode.id)) {
        void showtimeAlert('Cannot merge a place into itself.', { title: 'MERGE PLACE' });
        return;
      }
      void showtimeConfirm(`Merge "${tag || ident.names[0] || 'this location'}" into "${destName}"?\n\nTags, aliases, and nested places move to ${destName}.`, { title: 'MERGE PLACE', confirmLabel: 'Merge' }).then(ok => {
        if (!ok) return;
        this._compassTry(() => {
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
      });
      return;
    }
    if (action === 'suite-mode') {
      const mode = act.dataset.mode || 'browse';
      this._suiteMode = ['arrange', 'walls', 'fixtures'].includes(mode) ? mode : 'browse';
      return void this.render(this.container);
    }
    if (action === 'suite-story-focus') {
      const f = act.dataset.focus;
      this._suiteStoryFocus = (f === 'lower' || f === 'upper')
        ? f
        : (f != null && f !== '' && Number.isFinite(Number(f)) ? String(Math.round(Number(f))) : 'upper');
      if (act.dataset.unit) this._compassFocusId = act.dataset.unit;
      return void this.render(this.container);
    }
    if (action === 'suite-room-story') {
      const placeId = act.dataset.place || '';
      const unitId = act.dataset.unit || '';
      const nextStory = act.dataset.story;
      if (!placeId) return;
      const st = this._db();
      this._compassTry(() => {
        const compass = ensureCompass(st);
        setRoomStory(compass, placeId, nextStory);
        if (nextStory != null && nextStory !== '' && Number.isFinite(Number(nextStory))) {
          this._suiteStoryFocus = String(Math.round(Number(nextStory)));
        }
        if (unitId) this._compassFocusId = unitId;
        this._compassSave(st);
      });
      return;
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
      const childId = act.dataset.place || '';
      if (e.detail === 2 && (this._suiteMode || 'browse') === 'browse') {
        this._compassFocusId = childId;
        this._suiteHighlightChild = '';
        return void this.render(this.container);
      }
      this._suiteHighlightChild = childId;
      const unitId = act.dataset.unit || '';
      if (unitId) this._compassFocusId = unitId;
      return void this.render(this.container);
    }
    if (action === 'suite-open-child') {
      this._compassFocusId = act.dataset.place || '';
      this._suiteHighlightChild = '';
      return void this.render(this.container);
    }
    if (action === 'suite-stub-clear') {
      const placeId = act.dataset.place || '';
      const linkId = act.dataset.link || '';
      if (!placeId || !linkId) return;
      this._compassTry(() => {
        clearForeignWallLink(ensureCompass(st), placeId, linkId);
        this._compassSave(st);
      });
      return;
    }
    if (action === 'suite-stub-open') {
      const dest = act.dataset.to || '';
      if (!dest) return;
      this._compassFocusId = dest;
      this._suiteHighlightChild = '';
      return void this.render(this.container);
    }
    if (action === 'suite-stub-link') {
      const placeId = act.dataset.place || '';
      const rawEdge = act.dataset.edge;
      const edge = rawEdge === '' || rawEdge == null ? NaN : Number(rawEdge);
      if (!Number.isFinite(edge)) {
        this._compassFocusId = placeId;
        this._suiteHighlightChild = '';
        return void this.render(this.container);
      }
      this._suiteMode = 'walls';
      this._suiteSelEdge = { placeId, edge };
      this._suiteSelShared = null;
      this._suiteSelEdges = [{ placeId, edge }];
      return void this.render(this.container);
    }
    if (action === 'suite-mark-external') {
      this._compassTry(() => {
        const compass = ensureCompass(st);
        const n = applySafeAuditFixes(compass, [{
          fix: {
            type: 'mark-external',
            placeId: act.dataset.place || '',
            linkId: act.dataset.link || '',
          },
        }]);
        if (!n) {
          void showtimeAlert('Could not mark that opening external.', { title: 'SUITE OPENING' });
          return;
        }
        this._compassSave(st);
      });
      return;
    }
    if (action === 'set-here') {
      return void this._establishLocation({
        placeId: act.dataset.place || '',
        cell: act.dataset.cell || this._compassSelCell || 'C',
      });
    }
    if (action === 'suite-draft-accept') {
      return void this._acceptSuiteDraft();
    }
    if (action === 'suite-draft-dismiss') {
      return void this._dismissSuiteDraft();
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
        void showtimeConfirm(`Merge "${dropName}" into "${keepName}"?\n\nThey become one room with one arrange handle. "${dropName}" is kept as an alias.`, { title: 'MERGE ROOMS', confirmLabel: 'Merge' }).then(ok => {
          if (!ok) return;
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
      void showtimeAlert('Select a shared wall first.', { title: 'SUITE WALLS' });
      return;
    }
    if (action === 'suite-delete-shared') {
      const sel = this._suiteSelShared;
      if (!sel?.aId || !sel?.bId) { void showtimeAlert('Select an interior shared wall first.', { title: 'SUITE WALLS' }); return; }
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
        void showtimeAlert('Click a leftover split segment first.', { title: 'SUITE WALLS' });
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
      if (!placeId) { void showtimeAlert('Click a room (or one of its walls) first.', { title: 'SUITE WALLS' }); return; }
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
        if (!n) void showtimeAlert('No corners sitting on another wall — nudge rooms so a corner meets a face, then try again.', { title: 'SUITE WALLS' });
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
      if (!edges.length) { void showtimeAlert('Click a wall first.', { title: 'SUITE WALLS' }); return; }
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
        void showtimeAlert('Click (not drag) exactly 2 walls on the same room first.', { title: 'DIVIDE ROOM' });
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
      if (!toPlaceId) { void showtimeAlert('Pick a neighbor room first.', { title: 'WALL LINK' }); return; }
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
    if (action === 'suite-wall-quick-opn') {
      const placeId = act.dataset.place || '';
      const edge = Number(act.dataset.edge);
      const type = act.dataset.type || 'door';
      if (!placeId || !Number.isFinite(edge)) return;
      this._compassTry(() => {
        const compass = ensureCompass(st);
        const link = ensureEdgeLink(compass, placeId, edge, 0.5);
        const op = addOpening(compass, placeId, link.id, { type, along: 0.5 });
        this._lastOpening = { placeId, linkId: link.id, opnId: op?.id || '' };
        this._compassSave(st);
      });
      return;
    }
    if (action === 'suite-edit-opn') {
      const placeId = act.dataset.place || '';
      const linkId = act.dataset.link || '';
      const opnId = act.dataset.opn || '';
      const compass = ensureCompass(st);
      const room = getPlace(compass, placeId);
      const link = (room?.links || []).find(l => l.id === linkId);
      const op = (link?.openings || []).find(o => o.id === opnId);
      if (!room || !link || !op) return;
      openOpeningDialog({
        room,
        compass,
        link,
        existing: op,
        defaultCell: op.cell || 'C',
        castMembers: getCastMembers(this.storage),
        onSave: (patch) => {
          this._compassTry(() => {
            const c = ensureCompass(st);
            updateOpening(c, placeId, link.id, op.id, patch);
            if (patch.toPlaceId === '__exterior__') {
              linkWallToExterior(c, placeId, link.id);
            } else if (patch.toPlaceId === '__none__') {
              setWallConnection(c, placeId, link.edge, '__none__', { linkId: link.id });
            } else if (patch.toPlaceId) {
              linkWallToRoom(c, placeId, link.id, patch.toPlaceId);
            }
            this._lastOpening = { placeId, linkId: link.id, opnId: op.id };
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
    if (action === 'suite-del-opn') {
      const placeId = act.dataset.place || '';
      const linkId = act.dataset.link || '';
      const opnId = act.dataset.opn || '';
      if (!placeId || !linkId || !opnId) return;
      this._compassTry(() => {
        removeOpening(ensureCompass(st), placeId, linkId, opnId);
        this._compassSave(st);
      });
      return;
    }
    if (action === 'suite-wl-add-opening') {
      const placeId = act.dataset.place || '';
      const edgeIdx = Number(act.dataset.edge);
      const compass = ensureCompass(st);
      const room = getPlace(compass, placeId);
      if (!room) return;
      let link = (room.links || []).find(l => l.id === act.dataset.link);
      if (!link && Number.isFinite(edgeIdx)) {
        try {
          link = ensureEdgeLink(compass, placeId, edgeIdx, 0.5);
          this._compassSave(st);
        } catch { /* ignore */ }
      }
      if (!link) return;
      openOpeningDialog({
        room: getPlace(compass, placeId) || room,
        compass,
        link,
        existing: null,
        castMembers: getCastMembers(this.storage),
        onSave: (payload) => {
          this._compassTry(() => {
            const compass = ensureCompass(st);
            const lid = payload.linkId || link.id;
            const op = addOpening(compass, placeId, lid, payload);
            if (payload.toPlaceId === '__exterior__') {
              linkWallToExterior(compass, placeId, lid);
            } else if (payload.toPlaceId === '__none__') {
              setWallConnection(compass, placeId, link.edge, '__none__', { linkId: lid });
            } else if (payload.toPlaceId) {
              linkWallToRoom(compass, placeId, lid, payload.toPlaceId);
            }
            this._lastOpening = { placeId, linkId: lid, opnId: op?.id || '' };
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
      this._suiteFromChild = true;
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
          movePiece: (cellId, layer, itemId, { toCell, toLayer } = {}) => {
            this._compassTry(() => {
              moveItem(ensureCompass(st), placeId, {
                itemId,
                cell: cellId,
                layer,
                toCell,
                toLayer,
              });
              if (toCell) this._compassSelCell = toCell;
              this._compassSave(st);
            });
          },
          addOccupant: (cellId, { name, castId, description }) => {
            this._compassTry(() => {
              const compass = ensureCompass(st);
              addOccupant(compass, placeId, { name, cell: cellId, castId, description });
              const member = this._sonarCast({ includeWrittenOut: true }).find(m =>
                (castId && String(m.id) === String(castId))
                || String(m.name || '').toLowerCase() === String(name || '').toLowerCase());
              if (member) {
                pinSonarPing(compass, member, { placeId, cell: cellId, locked: true });
              }
              this._compassSave(st);
            });
          },
          removeOccupant: (name) => {
            this._compassTry(() => {
              const compass = ensureCompass(st);
              removeOccupant(compass, placeId, { name });
              const member = this._sonarCast({ includeWrittenOut: true }).find(m =>
                String(m.name || '').toLowerCase() === String(name || '').toLowerCase());
              if (member && compass.sonar?.pings) {
                const prev = compass.sonar.pings[member.id];
                if (prev && prev.placeId === placeId) {
                  delete compass.sonar.pings[member.id];
                }
              }
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
              const compass = ensureCompass(st);
              moveOccupant(compass, placeId, { name, cell });
              const member = this._sonarCast({ includeWrittenOut: true }).find(m =>
                String(m.name || '').toLowerCase() === String(name || '').toLowerCase());
              if (member && compass.sonar?.pings?.[member.id]) {
                compass.sonar.pings[member.id].placeId = placeId;
                compass.sonar.pings[member.id].cell = cell;
                compass.sonar.pings[member.id].at = Date.now();
                compass.sonar.pings[member.id].away = false;
                compass.sonar.pings[member.id].listening = false;
              }
              this._compassSave(st);
            });
          },
          addOpening: (payload) => {
            this._compassTry(() => {
              const compass = ensureCompass(st);
              addOpening(compass, placeId, payload.linkId, payload);
              if (payload.toPlaceId === '__exterior__') {
                linkWallToExterior(compass, placeId, payload.linkId);
              } else if (payload.toPlaceId && payload.toPlaceId !== '__none__') {
                linkWallToRoom(compass, placeId, payload.linkId, payload.toPlaceId);
              }
              this._lastOpening = { placeId, linkId: payload.linkId };
              this._compassSave(st);
            });
          },
          updateOpening: (linkId, openingId, patch) => {
            this._compassTry(() => {
              const compass = ensureCompass(st);
              updateOpening(compass, placeId, linkId, openingId, patch);
              if (patch.toPlaceId === '__exterior__') {
                linkWallToExterior(compass, placeId, linkId);
              } else if (patch.toPlaceId && patch.toPlaceId !== '__none__') {
                linkWallToRoom(compass, placeId, linkId, patch.toPlaceId);
              }
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
      if (!placeId) { void showtimeAlert('Pick a room, hall, or building exterior.', { title: 'PLACEMENT' }); return; }
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
    if (action === 'placement-order-piece') {
      this._compassTry(() => {
        reorderCellItem(ensureCompass(st), act.dataset.place, {
          itemId: act.dataset.id,
          cell: act.dataset.cell,
          layer: act.dataset.layer,
          dir: Number(act.dataset.dir) || 0,
        });
        this._compassSave(st);
      });
      return;
    }
    if (action === 'placement-pickup-piece') {
      this._compassTry(() => {
        const taken = pickupItem(ensureCompass(st), act.dataset.place, {
          itemId: act.dataset.id,
          cell: act.dataset.cell,
          layer: act.dataset.layer,
        });
        addPickupToInventory(this.storage, taken, this.bus);
        this._compassSave(st);
      });
      return;
    }
    if (action === 'placement-del-piece') {
      void showtimeConfirm('Send this piece to Lost & Found?', { title: 'LOST & FOUND', confirmLabel: 'Send' }).then(ok => {
        if (!ok) return;
        this._compassTry(() => {
          sendItemToLostAndFound(ensureCompass(st), act.dataset.place, {
            itemId: act.dataset.id,
            cell: act.dataset.cell,
            layer: act.dataset.layer,
          });
          this._compassSave(st);
        });
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
      void showtimeConfirm('Permanently destroy this Lost & Found item?', { title: 'DESTROY ITEM', danger: true, confirmLabel: 'Destroy' }).then(ok => {
        if (!ok) return;
        this._compassTry(() => {
          removeFromLostAndFound(ensureCompass(st), act.dataset.id);
          this._compassSave(st);
        });
      });
      return;
    }
    if (action === 'lost-add') {
      void showtimePrompt('Lost & Found item name?', { title: 'LOST & FOUND', confirmLabel: 'Add' }).then(name => {
        if (!name?.trim()) return;
        this._compassTry(() => {
          addToLostAndFound(ensureCompass(st), { name: name.trim() }, { layer: 'clutter' });
          this._compassSave(st);
        });
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
      void showtimeConfirm('Remove this internal wall?', { title: 'REMOVE WALL', danger: true, confirmLabel: 'Remove' }).then(ok => {
        if (!ok) return;
        this._compassTry(() => {
          removeInternalWall(ensureCompass(st), placeId, wallId);
          this._compassSave(st);
        });
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
      if (!edges.length) { void showtimeAlert('Select a wall first.', { title: 'FLOORPLAN' }); return; }
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
        castMembers: getCastMembers(this.storage),
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
        castMembers: getCastMembers(this.storage),
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
      void showtimeConfirm(`Delete place "${place}"?`, { title: 'DELETE PLACE', danger: true, confirmLabel: 'Delete' }).then(ok => {
        if (!ok) return;
        this._compassTry(() => {
          deletePlace(ensureCompass(st), place);
          if (this._compassFocusId === place) this._compassFocusId = '';
          this._compassSave(st);
        });
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
      if (!edges.length && !vertical.length) { void showtimeAlert('Select floorplan wall(s) and/or above/below.', { title: 'WALL LINK' }); return; }
      if (!toPlaceId) { void showtimeAlert('Pick a neighbor place.', { title: 'WALL LINK' }); return; }
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
      if (!edges.length && !vertical.length) { void showtimeAlert('Select floorplan wall(s) and/or above/below.', { title: 'WALL LINK' }); return; }
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
      if (edges.length !== 2) { void showtimeAlert('Select exactly 2 walls on the floorplan first.', { title: 'DIVIDE ROOM' }); return; }
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
    if (action === 'open-program') {
      openPlaybill();
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
      else void showtimeAlert('Script module is not loaded.', { title: 'SCRIPT CONFIGURE' });
      return;
    }
    if (action === 'tracker-pane') {
      st.trackers = normalizeTrackers(st.trackers);
      st.trackers.pane = act.dataset.pane || 'status';
      this._prodFolds ??= new Set();
      this._prodFolds.add('trackers');
      this.saveState();
      return void this.render(this.container);
    }
    if (action === 'scene-clap') return this._sceneClap();
    if (action === 'scene-set') return this._sceneSetManual(act);
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
      this._prodFolds ??= new Set();
      this._prodFolds.add('trackers');
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
      emitShowtimeNotice(this.bus, {
        kind: 'house',
        text: `Linked “${bg.title}” to ${where}.`,
        mark: '+',
      });
      return void this.render(this.container);
    }
    if (action === 'bg-del') {
      void showtimeConfirm('Delete this background?', { title: 'DELETE BACKGROUND', danger: true, confirmLabel: 'Delete' }).then(ok => {
        if (!ok) return;
        st.visuals = normalizeVisuals(st.visuals);
        st.visuals.backgrounds = st.visuals.backgrounds.filter(b => b.id !== act.dataset.id);
        if (st.visuals.activeId === act.dataset.id) st.visuals.activeId = '';
        if (st.visuals.pinnedId === act.dataset.id) st.visuals.pinnedId = '';
        this.saveState();
        this._syncStageBackground();
        this.render(this.container);
      });
      return;
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

  _syncFloatingClapper(forceShow = false, { scan = true, lite = false } = {}) {
    this._closeClapperEdit();
    this._injectClapperCss();
    if (scan) {
      try { this._scanChatTrackers({ persist: false }); } catch { /* ignore */ }
    }
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
    const clap = this._sceneClapSnapshot(st, { lite });
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
    if (action === 'scene-set') return this._sceneSetManual(act);
    if (action === 'cue-accept') return this._acceptPendingCue();
    if (action === 'cue-ignore') return this._ignorePendingCue();
    if (action === 'clap-edit') {
      this._openClapperEdit(act.dataset.field || '');
      return;
    }
    if (action === 'clap-hide') {
      this._closeClapperEdit();
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

  /** Scene tracker / clapper place — travel occupancy wins over a stale sonar ping. */
  _trackerPlace(compass, scene, { scanFormatted = true } = {}) {
    const travel = normalizeTravel(scene?.travel, { lastLocationKey: scene?.lastLocationKey });
    if (travel.placeId) {
      const pinned = getPlace(compass, travel.placeId);
      if (pinned) return pinned;
    }
    const raw = String(travel.placeKey || scene?.lastLocationKey || compass?.sonar?.lastKey || '').trim();
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
      // Formatting every room's full path is what locks the page while the
      // chat is still trying to paint. Exact name and tags are enough then.
      if (scanFormatted) {
        const needle = lastKey.toLowerCase();
        const hits = [];
        for (const p of Object.values(compass?.rooms || {})) {
          try {
            const formatted = formatSceneLocation({ compass, placeId: p.id });
            const fk = locationKeyFromStored(formatted).toLowerCase();
            if (fk === needle || formatted.toLowerCase().includes(needle)) hits.push(p);
          } catch { /* ignore */ }
        }
        if (hits.length === 1) return hits[0];
        const rawL = raw.toLowerCase();
        const narrowed = hits.filter(p => {
          const parent = compass.rooms?.[p.parentId];
          return parent && rawL.includes(String(parent.name || '').toLowerCase());
        });
        if (narrowed.length === 1) return narrowed[0];
      }
    }
    const storyPlaceId = String(compass?.sonar?.lastPlaceId || '').trim();
    return storyPlaceId ? getPlace(compass, storyPlaceId) : null;
  }

  /** Scene context used to auto-select / link backgrounds (place, area, tags). */
  _bgContext({ scanFormatted = true } = {}) {
    const st = this._db();
    const compass = ensureCompass(st);
    const scene = normalizeTrackers(st.trackers).scene;
    const lastRaw = String(scene.lastLocationKey || compass.sonar?.lastKey || '').trim();
    const lastKey = locationKeyFromStored(lastRaw);
    const place = this._trackerPlace(compass, scene, { scanFormatted });
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

  _syncStageBackground({ lite = false } = {}) {
    let layer = document.getElementById('st-stage-bg');
    const st = this._db();
    const visuals = normalizeVisuals(st.visuals);
    const ctx = this._bgContext({ scanFormatted: !lite });
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
      if (!name) { void showtimeAlert('Name is required.', { title: 'CUSTOM STATUS BAR' }); return; }
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
      this._prodFolds ??= new Set();
      this._prodFolds.add('trackers');
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
        void showtimeAlert('Add a URL or upload an image.', { title: 'BACKGROUND' });
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
      void showtimeAlert(`Could not read SillyTavern backgrounds: ${err.message || err}`, { title: 'IMPORT BACKGROUNDS', danger: true });
      return;
    }
    if (!images.length) {
      void showtimeAlert('SillyTavern has no backgrounds to import.', { title: 'IMPORT BACKGROUNDS' });
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
        void showtimeAlert('Pick at least one background.', { title: 'IMPORT BACKGROUNDS' });
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
      if (!added) void showtimeAlert('Nothing new to import — those were already in the library.', { title: 'IMPORT BACKGROUNDS' });
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
    if (/^receipt\./.test(path) || /^status\./.test(path)) {
      this.bus?.emit('trackers.updated');
    }
  }

  _sceneSetDraft(st = this._db()) {
    const scene = normalizeTrackers(st.trackers).scene;
    const script = this.storage.getChat('script', {});
    const cal = normalizeCalendar(script?.settings?.calendar);
    let parts = null;
    try {
      const present = currentTimelinePresent(this.storage);
      if (present?.parts) parts = present.parts;
    } catch { /* ignore */ }
    let monthIndex = parts?.monthIndex;
    let day = parts?.day;
    let year = parts?.year;
    if (scene.lastDateLabel && (monthIndex == null || day == null)) {
      try {
        const parsed = parseTimeKey(scene.lastDateLabel, cal, { fillMissing: false });
        if (parsed?.parts) {
          if (monthIndex == null) monthIndex = parsed.parts.monthIndex;
          if (day == null) day = parsed.parts.day;
          if (year == null) year = parsed.parts.year;
        }
      } catch { /* ignore */ }
    }
    const hour = scene.lastTimeHour != null && Number.isFinite(Number(scene.lastTimeHour))
      ? Number(scene.lastTimeHour)
      : (Number.isFinite(Number(parts?.hour)) ? Number(parts.hour) : 9);
    const minute = Number.isFinite(Number(scene.lastTimeMinute)) ? Number(scene.lastTimeMinute) : 0;
    return {
      calendar: cal,
      monthIndex: Number.isFinite(Number(monthIndex)) ? Number(monthIndex) : 0,
      day: Number.isFinite(Number(day)) ? Number(day) : 1,
      year: year != null && year !== '' ? year : '',
      hour,
      minute,
    };
  }

  _sceneSetLocationFormHtml() {
    const st = this._db();
    const compass = ensureCompass(st);
    const scene = normalizeTrackers(st.trackers).scene;
    const here = this._trackerPlace(compass, scene);
    const selectedId = here?.id || compass.sonar?.lastPlaceId || '';
    const opts = renderCompassPlaceOptions(compass, {
      esc,
      selectedId,
      emptyLabel: '— Location —',
      includeGeoParents: true,
    });
    return `
      <div class="st-scene-set" data-role="scene-set-form" data-kind="location">
        <div class="st-scene-set-row">
          <label class="st-scene-set-field st-scene-set-field--place"><span>Location</span>
            <select class="bst-input" data-role="scene-set-place">${opts}</select>
          </label>
          <button type="button" class="bst-btn gold" data-action="scene-set">Set</button>
        </div>
      </div>`;
  }

  _sceneSetManual(fromEl) {
    const form = fromEl?.closest?.('[data-role="scene-set-form"]')
      || fromEl?.querySelector?.('[data-role="scene-set-form"]')
      || this.container?.querySelector('[data-role="scene-set-form"]');
    if (!form) return;
    const placeEl = form.querySelector('[data-role="scene-set-place"]');
    if (placeEl) {
      const placeId = String(placeEl.value || '').trim();
      this._closeClapperEdit();
      if (!placeId) return;
      return this._establishLocation({ placeId, cell: this._compassSelCell || 'C' });
    }
    const st = this._db();
    st.trackers = normalizeTrackers(st.trackers);
    const scene = st.trackers.scene;
    const script = this.storage.getChat('script', {});
    const cal = normalizeCalendar(script?.settings?.calendar);
    const hpd = Math.max(1, Number(cal.hoursPerDay) || 24);

    let hour;
    let minute = 0;
    const fuzzy = form.querySelector('[data-role="scene-set-fuzzy"]');
    if (fuzzy) {
      hour = Number(fuzzy.value);
      minute = 0;
    } else {
      hour = Number(form.querySelector('[data-role="scene-set-hour"]')?.value);
      minute = Number(form.querySelector('[data-role="scene-set-minute"]')?.value);
    }

    const cueParts = {};
    const monthEl = form.querySelector('[data-role="scene-set-month"]');
    const dayEl = form.querySelector('[data-role="scene-set-day"]');
    const yearEl = form.querySelector('[data-role="scene-set-year"]');
    if (monthEl && monthEl.value !== '') {
      const mi = Number(monthEl.value);
      if (Number.isFinite(mi)) cueParts.monthIndex = mi;
    }
    if (dayEl && dayEl.value !== '') {
      const d = Number(dayEl.value);
      if (Number.isFinite(d) && d >= 1) cueParts.day = Math.min(31, Math.trunc(d));
    }
    if (yearEl && String(yearEl.value).trim() !== '') {
      const y = Number(yearEl.value);
      if (Number.isFinite(y)) cueParts.year = y;
    }

    if (scene.time !== false && Number.isFinite(hour)) {
      hour = ((Math.floor(hour) % hpd) + hpd) % hpd;
      minute = Number.isFinite(minute) ? Math.max(0, Math.min(59, Math.floor(minute))) : 0;
      scene.lastTimeHour = hour;
      scene.lastTimeMinute = minute;
      scene.lastTimeLabel = formatTrackerTimeFromHour(scene.timeMode, hour, hpd, minute) || scene.lastTimeLabel;
    } else {
      hour = undefined;
      minute = undefined;
    }

    const hasDate = scene.date !== false && (cueParts.day != null || cueParts.monthIndex != null);
    if (hasDate) {
      const label = formatSceneDate(cueParts, cal, scene.dateParts);
      if (label) scene.lastDateLabel = label;
      scene.lastDateCueSig = `absolute:${cueParts.day ?? ''}:${cueParts.monthIndex ?? ''}:${cueParts.year ?? ''}`;
    }

    scene.lastClapAt = Date.now();
    this._armBoardHold(scene);
    this._syncTimelinePresent({
      hour,
      minute,
      parts: hasDate ? cueParts : null,
      create: true,
    });
    this.saveState();
    this._closeClapperEdit();
    this._syncFloatingClapper(false, { scan: false });
    this._syncWeatherOverlay();
    if (this._door === 'production') return void this.render(this.container);
  }

  _acceptPendingCue() {
    const st = this._db();
    st.trackers = normalizeTrackers(st.trackers);
    const scene = st.trackers.scene;
    const cue = normalizePendingCue(scene.pendingCue);
    this._closeClapperEdit();
    if (!cue) return;
    const script = this.storage.getChat('script', {});
    const cal = normalizeCalendar(script?.settings?.calendar);
    const hpd = Math.max(1, Number(cal.hoursPerDay) || 24);
    let hour;
    let minute;
    if (cue.time && Number.isFinite(Number(cue.time.hour))) {
      hour = ((Math.floor(Number(cue.time.hour)) % hpd) + hpd) % hpd;
      minute = cue.time.clock
        ? Math.max(0, Math.min(59, Number(cue.time.minute) || 0))
        : 0;
      scene.lastTimeHour = hour;
      scene.lastTimeMinute = minute;
      scene.lastTimeLabel = formatTrackerTimeFromHour(scene.timeMode, hour, hpd, minute)
        || cue.time.fuzzy
        || scene.lastTimeLabel;
    }
    if (cue.date) {
      if (cue.date.kind === 'absolute') {
        if (cue.date.label) scene.lastDateLabel = cue.date.label;
        if (cue.date.sig) scene.lastDateCueSig = cue.date.sig;
        this._syncTimelinePresent({
          hour,
          minute,
          parts: cue.date.parts || null,
          create: true,
        });
      } else {
        scene.lastDateCueSig = cue.date.sig
          || `relative:${cue.date.deltaDays ?? ''}:${String(cue.date.fuzzy || '')}`;
        this._syncTimelinePresent({
          deltaDays: cue.date.deltaDays,
          hour: cue.date.hour ?? hour,
          minute,
        });
        try {
          const snap = this._sceneClapSnapshot(st);
          if (snap.date && snap.date !== '—') scene.lastDateLabel = snap.date;
        } catch { /* ignore */ }
      }
    } else if (hour != null) {
      this._syncTimelinePresent({ hour, minute });
    }
    const loc = cue.location;
    this._armBoardHold(scene);
    if (loc?.placeId) {
      acceptNow(this.storage, { scene, bus: this.bus, applyOccupancy: false });
      return this._establishLocation({ placeId: loc.placeId, cell: this._compassSelCell || 'C' });
    }
    if (loc?.key) {
      acceptNow(this.storage, { scene, bus: this.bus });
      this._scheduleSuiteBuild();
    } else {
      acceptNow(this.storage, { scene, bus: this.bus, applyOccupancy: false });
    }
    this._syncAutoPresence();
    this.saveState();
    this._syncFloatingClapper(false, { scan: false });
    this._syncWeatherOverlay();
    if (this._door === 'production') return void this.render(this.container);
  }

  _ignorePendingCue() {
    const st = this._db();
    st.trackers = normalizeTrackers(st.trackers);
    const scene = st.trackers.scene;
    ignoreNow(this.storage, { scene });
    this.saveState();
    this._closeClapperEdit();
    this._syncFloatingClapper(false, { scan: false });
  }

  _closeClapperEdit() {
    document.getElementById('st-clap-edit-pop')?.remove();
    if (this._clapEditAway) {
      document.removeEventListener('mousedown', this._clapEditAway, true);
      this._clapEditAway = null;
    }
  }

  _openClapperEdit(field = '') {
    const root = document.getElementById('st-clapper-float');
    if (!root) return;
    const existing = document.getElementById('st-clap-edit-pop');
    const same = existing && existing.dataset.field === String(field || '');
    if (existing) this._closeClapperEdit();
    if (same) return;
    const st = this._db();
    const scene = normalizeTrackers(st.trackers).scene;
    const draft = this._sceneSetDraft(st);
    const pop = document.createElement('div');
    pop.id = 'st-clap-edit-pop';
    pop.className = 'st-clap-edit';
    pop.dataset.field = String(field || '');
    pop.innerHTML = field === 'location'
      ? this._sceneSetLocationFormHtml()
      : buildSceneSetFormHtml({
        esc,
        scene,
        calendar: draft.calendar,
        draft,
      });
    if (!String(pop.innerHTML || '').trim()) return;
    root.appendChild(pop);
    this._clapEditAway = (ev) => {
      if (pop.contains(ev.target)) return;
      if (ev.target.closest?.('[data-action="clap-edit"]')) return;
      if (ev.target.closest?.('select, option')) return;
      this._closeClapperEdit();
    };
    setTimeout(() => document.addEventListener('mousedown', this._clapEditAway, true), 0);
  }

  _sceneClap() {
    try { this._scanChatTrackers({ persist: true, force: true }); } catch { /* ignore */ }
    const st = this._db();
    st.trackers = normalizeTrackers(st.trackers);
    const snap = this._sceneClapSnapshot(st);
    const locKey = locationKeyFromStored(st.trackers.scene.travel?.placeKey)
      || locationKeyFromStored(st.trackers.scene.lastLocationKey)
      || locationKeyFromStored(ensureCompass(st).sonar?.lastKey)
      || locationKeyFromStored(snap.location);
    if (locKey && !/^Moving:/i.test(locKey)) {
      commitNow(this.storage, {
        occupancy: {
          mode: 'compass',
          placeKey: locKey,
          placeId: String(ensureCompass(st).sonar?.lastPlaceId || st.trackers.scene.travel?.placeId || '').trim(),
        },
      }, { force: true, source: 'clap', scene: st.trackers.scene, bus: this.bus });
      this._scheduleSuiteBuild();
    }
    this._syncAutoPresence();
    st.trackers.scene.lastTimeLabel = st.trackers.scene.time
      ? (snap.time || '')
      : '';
    st.trackers.scene.lastDateLabel = st.trackers.scene.date && snap.date !== '—'
      ? snap.date
      : '';
    st.trackers.scene.lastClapAt = Date.now();
    this._armBoardHold(st.trackers.scene);
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
    this._syncFloatingClapper(false, { scan: false });
    this._syncWeatherOverlay();
    const float = document.getElementById('st-clapper-float');
    if (float) {
      float.classList.add('clapping');
      setTimeout(() => float.classList.remove('clapping'), 220);
    }
    if (this._door === 'production') return void this.render(this.container);
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
    if (this._door === 'production' || this._door === 'studio-effects') return void this.render(this.container);
  }

  _onChange(e) {
    const el = e.target;
    const st = this._db();

    if (el.dataset.wi) {
      st.worldIndex = normalizeWorldIndex(st.worldIndex);
      const key = el.dataset.wi;
      if (key === 'retrieveMode') st.worldIndex.retrieveMode = el.value === 'llm' ? 'llm' : 'keyword';
      else if (key === 'topN') st.worldIndex.topN = Math.max(1, Math.min(24, Number(el.value) || 5));
      else if (key === 'charBudget') st.worldIndex.charBudget = Math.max(400, Math.min(12000, Number(el.value) || 2500));
      this.saveState();
      this.bus?.emit('showtime.stateChanged');
      if (this.container) this.render(this.container);
      return;
    }

    if (el.dataset.g && String(el.dataset.g).startsWith('profile-')) {
      const slot = el.dataset.g.slice('profile-'.length);
      this._saveProfileSlot(slot, el.value);
      return;
    }

    if (el.dataset.role === 'suite-wall-target') {
      const placeId = el.dataset.place || '';
      const edgeIdx = Number(el.dataset.edge);
      const linkId = el.dataset.link || '';
      const target = el.value || '__none__';
      if (!placeId) return;
      this._compassTry(() => {
        setWallConnection(ensureCompass(st), placeId, edgeIdx, target, { linkId });
        this._compassSave(st);
      });
      return;
    }

    if (el.dataset.role === 'suite-opn-pick') {
      const [placeId, linkId, opnId] = String(el.value || '').split('|');
      if (placeId && linkId) {
        this._lastOpening = { placeId, linkId, opnId };
        return void this.render(this.container);
      }
      return;
    }

    if (el.dataset.role === 'suite-opn-target') {
      const placeId = el.dataset.place || '';
      const linkId = el.dataset.link || '';
      const opnId = el.dataset.opn || '';
      const target = el.value || '__none__';
      if (!placeId) return;
      this._compassTry(() => {
        const compass = ensureCompass(st);
        const room = getPlace(compass, placeId);
        const link = (room?.links || []).find(l => l.id === linkId);
        const op = (link?.openings || []).find(o => o.id === opnId);
        const resLink = setWallConnection(compass, placeId, link?.edge, target, {
          linkId,
          along: Number.isFinite(op?.along) ? op.along : 0.5,
        });
        this._lastOpening = { placeId, linkId: resLink?.id || linkId, opnId };
        this._compassSave(st);
      });
      return;
    }

    if (el.dataset.role === 'suite-room-story') {
      const placeId = el.dataset.place || '';
      const unitId = el.dataset.unit || '';
      const nextStory = el.value;
      if (!placeId) return;
      this._compassTry(() => {
        const compass = ensureCompass(st);
        setRoomStory(compass, placeId, nextStory);
        if (Number.isFinite(Number(nextStory))) {
          this._suiteStoryFocus = String(Math.round(Number(nextStory)));
        }
        if (unitId) this._compassFocusId = unitId;
        this._suiteHighlightChild = placeId;
        this._compassSave(st);
      });
      return;
    }

    if (el.dataset.role === 'stage-head-category' || el.dataset.role === 'suite-category-select' || el.dataset.role === 'focus-category') {
      const placeId = el.dataset.place || '';
      if (!placeId) return;
      this._compassTry(() => {
        setPlaceCategory(ensureCompass(st), placeId, el.value || '');
        this._compassSave(st);
      });
      return;
    }

    if (el.dataset.role === 'place-kind' || el.dataset.role === 'focus-kind' || el.dataset.role === 'place-edit-kind') {
      const show = el.value === 'building';
      const scope = el.closest('.bst-compass-create, .bst-fold-body, .bst-set-edit') || el.parentElement;
      const fields = scope?.querySelectorAll?.('[data-role="create-category-field"], [data-action="compass-create-populate"], [data-role="focus-category-field"], [data-role="focus-populate"], [data-role="place-edit-category-wrap"]');
      fields?.forEach(node => { node.hidden = !show; });
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

    if (el.dataset.role === 'placement-layer-piece') {
      const toLayer = el.value;
      if (!toLayer || toLayer === el.dataset.layer) return;
      this._compassTry(() => {
        moveItem(ensureCompass(st), el.dataset.place, {
          itemId: el.dataset.id,
          cell: el.dataset.cell,
          layer: el.dataset.layer,
          toLayer,
        });
        this._compassSave(st);
      });
      return;
    }

    if (el.dataset.role === 'placement-surface-piece') {
      const surface = el.value || '';
      const parentId = el.selectedOptions?.[0]?.dataset?.parentId || '';
      this._compassTry(() => {
        moveItem(ensureCompass(st), el.dataset.place, {
          itemId: el.dataset.id,
          cell: el.dataset.cell,
          layer: el.dataset.layer,
          surface,
          parentId,
        });
        this._compassSave(st);
      });
      return;
    }

    if (el.dataset.role === 'placement-room-piece') {
      const toRoomId = el.value;
      if (!toRoomId || toRoomId === el.dataset.place) return;
      this._compassTry(() => {
        moveItem(ensureCompass(st), el.dataset.place, {
          itemId: el.dataset.id,
          cell: el.dataset.cell,
          layer: el.dataset.layer,
          toRoomId,
          toCell: 'C',
        });
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
    if (el.dataset.field === 'productionTitle') {
      st.production.title = clipReelTitle(el.value);
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
      const needsRender = /^(status\.cadence|status\.enabled|scene\.|receipt\.|location\.|connection\.enabled|items\.enabled|pane)/.test(path)
        || el.type === 'radio'
        || el.type === 'checkbox';
      if (needsRender) {
        this._prodFolds ??= new Set();
        this._prodFolds.add('trackers');
        return void this.render(this.container);
      }
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
    if (el.dataset.noteQ != null || el.dataset.noteTarget != null
      || el.dataset.noteAbout != null || el.dataset.noteRephrased != null) {
      const noteId = el.dataset.noteQ || el.dataset.noteTarget
        || el.dataset.noteAbout || el.dataset.noteRephrased;
      st.interview.notePick ??= {};
      st.interview.notePick[noteId] ??= {};
      if (el.dataset.noteQ != null) st.interview.notePick[noteId].q = Number(el.value) || 0;
      if (el.dataset.noteTarget != null) st.interview.notePick[noteId].targetId = el.value;
      if (el.dataset.noteAbout != null) st.interview.notePick[noteId].about = el.value;
      if (el.dataset.noteRephrased != null) st.interview.notePick[noteId].rephrased = el.value;
      this.saveState();
      return;
    }
    if (el.dataset.field === 'poke') {
      st.peanut.poke = String(el.value || '').slice(0, 160);
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
      if (force && this._busy) void showtimeAlert('Director is already rolling.', { title: 'DIRECTOR' });
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
        void showtimeAlert('Director returned no beat. Try again or pin a cue from the pool.', { title: 'DIRECTOR' });
      }
      st.production.eventLog = (st.production.eventLog || []).filter(e => e.kind === 'event').slice(-40);
      this.saveState();
    } catch (err) {
      console.error('[Backstage director]', err);
      if (!auto) void showtimeAlert(`Director check failed: ${err.message || err}`, { title: 'DIRECTOR', danger: true });
    } finally {
      restoreRun();
      this._busy = false;
      if (showProd) this.render(this.container);
    }
  }

  async _interviewNoteAsk(noteId) {
    const card = NOTECARDS.find(c => c.id === noteId);
    if (!card) return;
    const st = this._db();
    const qEl = this.container.querySelector(`[data-note-q="${noteId}"]`);
    const tEl = this.container.querySelector(`[data-note-target="${noteId}"]`);
    const rEl = this.container.querySelector(`[data-note-rephrased="${noteId}"]`);
    const prev = st.interview.notePick?.[noteId] || {};
    const qIdx = Math.min(Number(qEl?.value ?? prev.q) || 0, card.questions.length - 1);
    const targetId = tEl?.value || prev.targetId || '';
    const rephraseOpen = !!prev.rephraseOpen;
    const rephrased = String(rEl?.value ?? prev.rephrased ?? '').trim();
    if (!targetId) { void showtimeAlert('Pick a title on the notecard back.', { title: 'INTERVIEW' }); return; }
    if (rephraseOpen && !rephrased) {
      void showtimeAlert('Write your prompt first.', { title: 'INTERVIEW' });
      rEl?.focus();
      return;
    }
    st.interview.notePick ??= {};
    st.interview.notePick[noteId] = {
      ...prev,
      q: qIdx,
      targetId,
      rephrased,
      rephraseOpen,
    };
    this.saveState();
    const subjectId = st.interview.subjectId || this._interviewSubject()?.id;
    const target = this._noteTargets(noteId, subjectId).find(t => t.id === targetId);
    const heard = target?.group === 'Script'
      ? ''
      : String(target?.spoken || target?.title || '').trim();
    const custom = rephraseOpen && rephrased;
    const stock = card.questions[qIdx];
    let question = custom ? rephrased : stock.text;
    if (!custom && noteId === 'role') {
      const lived = {
        sit: 'Looking back, how did that sit with you?',
        remember: 'What do you remember about that?',
        shift: 'Did that change how you see things?',
      };
      question = lived[stock.id] || question;
    }
    if (heard) {
      const already = question.toLowerCase().includes(heard.toLowerCase());
      if (!already) question = `${question} — ${heard}`;
    }
    let display = '';
    if (target?.group === 'Script') {
      const stamp = String(target.title || '').trim();
      if (stamp && !question.toLowerCase().includes(stamp.toLowerCase())) {
        display = `${question} — ${stamp}`;
      }
    }
    await this._interviewTurn(question, noteId, {
      questionId: card.questions[qIdx].id,
      target,
      display,
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

  _interviewerInfo({ dossier = false } = {}) {
    const st = this._db();
    const mode = st.interview.interviewer || 'star';
    if (mode === 'anonymous') {
      return {
        name: 'Anonymous',
        anonymous: true,
        block: dossier ? `INTERVIEWER: a faceless, nondescript stranger — no name, no affiliation, no reputation, no prior relationship.
The subject answers as if speaking to someone they cannot place.
Do NOT invent a known identity for the interviewer.` : '',
      };
    }
    if (mode === 'user') {
      const ctx = getContext();
      const name = ctx?.name1 || 'You';
      const star = getStarMember(this.storage);
      if (!dossier) return { name, anonymous: false, block: '' };
      const brief = star
        ? buildCharacterDossier(this.storage, star, {
          characters: ctx?.characters ?? [],
          personas: listPersonas(power_user),
          maxChars: 1600,
        })
        : '';
      return {
        name,
        anonymous: false,
        block: `INTERVIEWER: {{user}} / ${name}${star ? ` (Star cast: ${star.name})` : ''}.
${brief}
${this._repTowardBlock(star?.id || null, name)}`,
      };
    }
    let id = st.interview.interviewerId;
    if (mode === 'star' || !id) id = getStarMember(this.storage)?.id || id;
    const full = this._fullCast().find(c => c.id === id) || getStarMember(this.storage);
    if (!full) {
      return { name: 'Interviewer', anonymous: false, block: dossier ? 'INTERVIEWER: (unspecified)' : '' };
    }
    if (!dossier) return { name: full.name, anonymous: false, block: '' };
    const ctx = getContext();
    const brief = buildCharacterDossier(this.storage, full, {
      characters: ctx.characters ?? [],
      personas: listPersonas(power_user),
      maxChars: 1600,
    });
    return {
      name: full.name,
      anonymous: false,
      block: `INTERVIEWER:\n${brief}\n${this._repTowardBlock(full.id, full.name)}`,
    };
  }

  async _interviewTurn(question, askKind = 'free', meta = {}, { replay = false, replaceIdx = null } = {}) {
    const st = this._db();
    if (this._busy) return;
    const subject = this._interviewSubject();
    if (!subject) return;
    const interviewer = this._interviewerInfo({ dossier: true });
    const replacing = Number.isInteger(replaceIdx) && replaceIdx >= 0
      && (st.interview.turns || [])[replaceIdx]?.who === 'cast';

    this._ivHarvestSeq = (this._ivHarvestSeq || 0) + 1;
    const shown = String(meta.display || '').trim();
    if (!replay && !replacing) {
      (st.interview.turns ??= []).push({
        who: 'user',
        name: interviewer.name,
        text: shown || question,
        asked: shown && shown !== question ? question : '',
        at: Date.now(),
        askKind,
        target: meta?.target ? {
          id: meta.target.id,
          title: meta.target.title,
          group: meta.target.group,
          cardUid: meta.target.cardUid || '',
          prompt: meta.target.group === 'Script' ? '' : meta.target.prompt,
        } : null,
      });
    }
    st.interview.retry = null;
    this._busy = true;
    this._ivPinBottom = true;
    this._paintInterviewDesk();

    let reply = '';
    this.storage.holdSaves();
    try {
      const historySrc = replacing
        ? (st.interview.turns || []).slice(0, replaceIdx)
        : (st.interview.turns || []);
      const history = historySrc.slice(-8)
        .map(t => `${t.name || (t.who === 'cast' ? subject.name : 'Interviewer')}: ${(t.who === 'user' && t.asked) ? t.asked : t.text}`).join('\n');
      const lanes = await this._subjectLanes(subject, askKind, meta);
      const relationRule = interviewer.anonymous
        ? 'The interviewer is a faceless stranger — you do not know THEM. You still know your own life, work, places, and anyone named in WHO YOU ARE or THE DESK. Be guarded about what you reveal to this stranger, but do not forget or deny those facts. Never recite standing numbers, dossier labels, or briefing text.'
        : `You are speaking WITH ${interviewer.name}. Use the established Connections / relationship context — tone, warmth, caution, and what you would actually say to them. Do not dump tracker data; speak in character.`;
      const livedRule = 'WHAT HAPPENED is the only memory of events. A title or a question is not something that happened. WHO YOU ARE is how you talk, not a list of events: do not take a sign, a shop name, a timetable, or which side was hurt from it. If those entries name a body part and what was done to it, that is the injury — when you are asked how you are healing, that part is the answer, in their words. Do not split it into left and right unless they do, do not rename a break as a scratch, and do not add weeks, a blast, or a place they do not describe. If they do not injure you, do not invent a wound. Never name the desk: no script, scene, card, file, library entry, achievement label, closet, or production code.';
      const voiceRule = `Speak out loud to the interviewer, in the first person. Use I, me, and my. The card may be written about you; you still do not narrate yourself, do not write "(${subject.name}, third-person)", and do not call yourself she or her.`;
      const prompt = `[System: Private interview. Output ONLY ${subject.name}'s spoken words in the first person. No narration, no stage directions, no POV label, no OOC, no JSON, no repeating these instructions. Use the injury WHAT HAPPENED names, on the body part it names. Do not invent which side, a timetable, a sign, or a blast.]

You are ${subject.name}. Stay in character.
Interviewer: ${interviewer.name}${interviewer.anonymous ? ' (faceless stranger)' : ''}.
${relationRule}
${voiceRule}
${livedRule}

${interviewer.block}

=== WHO YOU ARE ===
${lanes.who || '(no card)'}

=== THE DESK ===
${lanes.desk || '(nothing on the desk)'}

=== WHAT HAPPENED ===
${lanes.lore || '(nothing filed)'}

=== INTERVIEW SO FAR ===
${history || '(just starting)'}

=== QUESTION ===
${interviewer.name}: ${question}

      === YOUR REPLY (3–6 sentences, then stop. Start with I. Say each thing once. If WHAT HAPPENED names where you were hurt, name that part the way it does. Do not narrate, and do not add a side, a timetable, a sign, or a blast.) ===`;

      const echoTarget = (meta?.target?.group === 'Script' && lanes.lore)
        ? { ...meta.target, prompt: lanes.lore }
        : meta.target;
      await new Promise(resolve => setTimeout(resolve, 0));
      reply = await this._quiet(prompt, { quietName: subject.name, profileSlot: 'interview', responseLength: 480 });
      reply = this._cleanInterviewReply(reply, subject.name, prompt, echoTarget);
      if (!reply) {
        const retry = `You are ${subject.name}. ${interviewer.name}${interviewer.anonymous ? ' (a stranger)' : ''} asks: ${question}

Answer out loud in the first person (2–6 sentences), then stop. Start with "I". Say each thing once; do not repeat a vow. Do not narrate yourself as she or her. If the memory below names where you were hurt, use its words for that part. Do not split left and right, do not add how many weeks, a shop sign, or a milder injury, and do not add an explosion or a place that is not written there.

${lanes.lore || '(nothing filed)'}

${subject.name}:`;
        reply = await this._quiet(retry, { quietName: subject.name, profileSlot: 'interview', responseLength: 480 });
        reply = this._cleanInterviewReply(reply, subject.name, retry, echoTarget);
      }
      if (!reply) {
        st.interview.retry = {
          question,
          askKind,
          meta,
          replaceIdx: replacing ? replaceIdx : null,
        };
        return;
      }

      const castTurn = { who: 'cast', name: '', text: reply, at: Date.now() };
      if (replacing) {
        st.interview.turns[replaceIdx] = castTurn;
      } else {
        st.interview.turns.push(castTurn);
      }

      if (st.interview.turns.length > 80) st.interview.turns = st.interview.turns.slice(-80);
    } catch (err) {
      console.error('[Backstage interview]', err);
      st.interview.retry = {
        question,
        askKind,
        meta,
        replaceIdx: replacing ? replaceIdx : null,
      };
    } finally {
      this.storage.releaseSaves({ flush: false });
      this._busy = false;
      this._ivPinBottom = true;
      this._paintInterviewDesk();
    }

    this.saveState();
  }

  /** Connections model runs once, when the interview is filed. */
  async _fileInterviewConnections() {
    const st = this._db();
    const subject = this._interviewSubject();
    const turns = st?.interview?.turns;
    if (!subject || !st?.interview?.active || !turns?.length) return;
    st.interview.pendingConn = [];
    for (let i = 0; i < turns.length; i++) {
      const turn = turns[i];
      if (turn.who !== 'cast' || turn.name === 'Connections') continue;
      let qIdx = i - 1;
      while (qIdx >= 0 && (turns[qIdx].who !== 'user' || turns[qIdx].name === 'Connections')) qIdx--;
      const question = turns[qIdx];
      if (!question?.text || !turn.text) continue;
      let harvested = null;
      try {
        harvested = await this._interviewConnHarvest(
          subject,
          turn.text,
          question.text,
          question.askKind || 'free',
          question.target || null,
        );
      } catch (err) {
        console.warn('[Backstage interview → Connections]', err);
        continue;
      }
      const note = String(harvested?.note || '').replace(/^To file:/i, 'Filed:');
      const patch = harvested?.patch;
      if (!note || !patch) continue;
      st.interview.pendingConn.push({ ...patch, afterTurn: i, at: Date.now() });
      const next = turns[i + 1];
      if (next?.name === 'Connections') {
        turns[i + 1] = { ...next, text: note, at: Date.now() };
      } else {
        turns.splice(i + 1, 0, { who: 'user', name: 'Connections', text: note, at: Date.now() });
        i += 1;
      }
    }
  }

  /**
   * A short model that locks onto a vow repeats a phrase until the token cap.
   * Keep the first time it is said, and keep at most six sentences.
   */
  _trimSpokenCollapse(text) {
    const words = String(text || '').trim().split(/\s+/).filter(Boolean);
    if (words.length < 8) return words.join(' ');
    const norm = words.map(w => w.toLowerCase().replace(/[^a-z0-9']/g, ''));
    const seen = new Set();
    let cut = words.length;
    const width = 4;
    for (let i = 0; i + width <= norm.length; i++) {
      const gram = [];
      for (let j = 0; j < width; j++) {
        if (!norm[i + j]) break;
        gram.push(norm[i + j]);
      }
      if (gram.length < width) continue;
      const key = gram.join(' ');
      if (seen.has(key)) { cut = i; break; }
      seen.add(key);
    }
    let kept = words.slice(0, cut).join(' ').replace(/[,:;–—-]+\s*$/, '').trim();
    const sentences = kept.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
    const heard = new Set();
    const out = [];
    for (const sentence of sentences) {
      const key = sentence.toLowerCase().replace(/[^a-z0-9' ]/g, '').replace(/\s+/g, ' ').trim();
      if (key && heard.has(key)) break;
      if (key) heard.add(key);
      out.push(sentence);
      if (out.length >= 6) break;
    }
    kept = out.join(' ').trim();
    if (kept && !/[.!?]$/.test(kept)) {
      const last = Math.max(kept.lastIndexOf('.'), kept.lastIndexOf('!'), kept.lastIndexOf('?'));
      if (last >= 24) kept = kept.slice(0, last + 1).trim();
    }
    return kept;
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
    // Strip leading Name: / Name — and a POV label such as "(Mirko, third-person)".
    const nameRe = new RegExp(`^${String(name || '').replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\s*[:\\—\\-–]\\s*`, 'i');
    text = text.replace(nameRe, '').trim();
    text = text.replace(/^\([^)\n]{0,80}\)\s*/, '').trim();
    text = text.replace(/^\*{1,2}[^*\n]{0,40}\*{1,2}\s*/, '').trim();
    // Drop wrapping quotes before the collapse trim, so a quoted vow still splits on sentences.
    if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith('“') && text.endsWith('”'))) {
      text = text.slice(1, -1).trim();
    }
    text = this._trimSpokenCollapse(text);
    // A card written in the third person makes the model narrate. Spoken answers use I/me/my.
    if (!/\b(I|I'm|I’m|I am|I've|I’ve|I'd|I’d|I'll|I’ll|me|my|mine)\b/.test(text)) return '';
    if (text.length > 1600) {
      const snapped = text.slice(0, 1600);
      const last = Math.max(snapped.lastIndexOf('.'), snapped.lastIndexOf('!'), snapped.lastIndexOf('?'));
      text = (last >= 24 ? snapped.slice(0, last + 1) : snapped).trim();
    }
    if (this._interviewReplyTooShort(text)) return '';
    return text;
  }

  _interviewReplyTooShort(text) {
    const t = String(text || '').trim();
    if (!t) return true;
    if (t.length < 12) return true;
    const letters = (t.match(/[A-Za-z\u00C0-\u024F]/g) || []).length;
    return letters < 3;
  }

  /**
   * After an interview reply, queue a Connections patch. The web is not
   * written until the interview is filed (End).
   */
  async _interviewConnHarvest(subject, reply, question, askKind, target) {
    const group = String(target?.group || '');
    const connAsk = askKind === 'cast'
      || /Reputation|Affiliation|House|Secret/i.test(group)
      || /standing|think of|heard|rumor|whisper/i.test(String(question || ''));
    if (!connAsk || !reply) return null;

    try {
      const rep = this.storage.getChat('reputation', { personal: [], house: [] });
      if (!Array.isArray(rep.personal)) rep.personal = [];
      const subjectNode = this._findCastConnNode(rep, subject);

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

Subject (speaker): ${subject.name} (node ${subjectNode?.id || subject.id})
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

      const raw = await this._quiet(extractPrompt, { quietName: 'System' });
      const parsed = parseJsonObject(raw);
      if (!parsed || parsed.action === 'none') return null;

      const clampStand = (v) => {
        const n = Number(v);
        if (!Number.isFinite(n)) return null;
        return Math.max(-100, Math.min(100, Math.round(n)));
      };
      const take = String(parsed.take || reply).trim().slice(0, 600);
      const skipId = subjectNode?.id || '';

      if (parsed.action === 'reading') {
        let targetId = String(parsed.targetId || hintTarget || '').trim();
        if (!rep.personal.some(n => n.id === targetId)) {
          const needle = String(target?.title || question || '').toLowerCase();
          const hit = rep.personal.find(n => needle.includes(String(n.name || '').toLowerCase()) && n.id !== skipId);
          if (hit) targetId = hit.id;
        }
        if (!targetId || targetId === skipId) return null;
        if (!rep.personal.some(n => n.id === targetId)) return null;
        const stand = clampStand(parsed.standing);
        const whom = rep.personal.find(n => n.id === targetId)?.name || targetId;
        return {
          patch: {
            action: 'reading',
            targetId,
            take,
            standing: stand,
            question: String(question || ''),
            hintTarget,
          },
          note: `To file: reading — ${subject.name} on ${whom}${stand != null ? ` (${stand})` : ''}.`,
        };
      }

      if (parsed.action === 'rumor') {
        const aboutId = String(parsed.aboutId || parsed.targetId || hintTarget || '').trim();
        const about = rep.personal.find(n => n.id === aboutId);
        const title = String(parsed.rumorTitle || '').trim().slice(0, 80)
          || `Word on ${about?.name || 'the wire'}`;
        return {
          patch: {
            action: 'rumor',
            aboutId,
            take,
            rumorTitle: title,
            question: String(question || ''),
            hintTarget,
          },
          note: `To file: rumor — “${title}”${about ? ` about ${about.name}` : ''}.`,
        };
      }
    } catch (err) {
      console.warn('[Backstage interview → Connections]', err);
    }
    return null;
  }

  _applyInterviewConnPatches(patches, subject) {
    if (!subject || !patches?.length) return 0;
    const rep = this.storage.getChat('reputation', { personal: [], house: [] });
    if (!Array.isArray(rep.personal)) rep.personal = [];
    const subjectNode = this._ensureCastConnNode(rep, subject);
    if (!subjectNode) return 0;
    let n = 0;
    for (const patch of patches) {
      if (this._commitInterviewConnPatch(rep, subjectNode, subject, patch)) n += 1;
    }
    if (n) this.bus?.emit('reputation.updated', {});
    return n;
  }

  _commitInterviewConnPatch(rep, subjectNode, subject, patch) {
    if (!patch || !subjectNode) return false;
    const ensureLink = (a, b) => {
      const A = rep.personal.find(n => n.id === a);
      const B = rep.personal.find(n => n.id === b);
      if (!A || !B) return;
      A.links ??= [];
      B.links ??= [];
      if (!A.links.includes(b)) A.links.push(b);
      if (!B.links.includes(a)) B.links.push(a);
    };
    const take = String(patch.take || '').trim().slice(0, 600);

    if (patch.action === 'reading') {
      let targetId = String(patch.targetId || patch.hintTarget || '').trim();
      if (!rep.personal.some(n => n.id === targetId)) {
        const needle = String(patch.question || '').toLowerCase();
        const hit = rep.personal.find(n => needle.includes(String(n.name || '').toLowerCase()) && n.id !== subjectNode.id);
        if (hit) targetId = hit.id;
      }
      if (!targetId || targetId === subjectNode.id) return false;
      if (!rep.personal.some(n => n.id === targetId)) return false;
      subjectNode.readings ??= [];
      let rec = subjectNode.readings.find(r => r.targetId === targetId);
      if (!rec) {
        rec = { targetId, aware: 'knows', take: '' };
        subjectNode.readings.push(rec);
      }
      rec.aware = rec.aware === 'unaware' ? 'heard' : (rec.aware || 'knows');
      rec.take = take;
      const stand = Number(patch.standing);
      if (Number.isFinite(stand)) rec.standing = Math.max(-100, Math.min(100, Math.round(stand)));
      ensureLink(subjectNode.id, targetId);
      return true;
    }

    if (patch.action === 'rumor') {
      const aboutId = String(patch.aboutId || patch.targetId || patch.hintTarget || '').trim();
      const about = rep.personal.find(n => n.id === aboutId);
      const title = String(patch.rumorTitle || '').trim().slice(0, 80)
        || `Word on ${about?.name || 'the wire'}`;
      const id = uid();
      const i = (rep.personal || []).length;
      const a = (i * 2.4) % (Math.PI * 2);
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
        x: 0.5 + Math.cos(a) * 0.28,
        y: 0.5 + Math.sin(a) * 0.28,
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
      return true;
    }
    return false;
  }

  _findCastConnNode(rep, subject) {
    if (!subject?.id) return null;
    const node = (rep.personal || []).find(n => n.characterId === subject.id);
    if (node) return node;
    const star = getStarMember(this.storage);
    if (star?.id === subject.id) {
      return (rep.personal || []).find(n => n.kind === 'self' || n.id === 'self') || null;
    }
    return null;
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

  /** Supporting cast still in play — never Star, Director, or written out. */
  _peanutCastPool() {
    const castFull = this._fullCast().filter(c =>
      c && c.priority !== 'director' && c.priority !== 'star'
      && normalizeCastPresence(c) !== 'writtenOut');
    if (!castFull.length) return [];
    const ctx = getContext();
    return castFull.map(c => {
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
      return { c, identity, blurb: blurb || c.name || 'on the balcony' };
    });
  }

  _peanutNameInText(name, source) {
    const hay = ` ${String(source || '').toLowerCase()} `;
    const full = String(name || '').trim().toLowerCase();
    if (!full || hay.trim().length < 2) return false;
    const bound = (needle) => new RegExp(
      `(?:^|[^a-z0-9])${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[^a-z0-9])`,
      'i',
    );
    if (bound(full).test(hay)) return true;
    const first = full.split(/[\s,]+/)[0];
    if (!first || first.length < 3 || first === full) return false;
    return bound(first).test(hay);
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
    return matchStampLeaf(entry, leaves, getCachedLibraryBooks());
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
        if (owned.length) bits.push(`owns ${owned.slice(0, 3).map(x => `“${x.title}”`).join(', ')}`);
        if (known.length) bits.push(`knows ${known.slice(0, 3).map(x => `“${x.title}”`).join(', ')}`);
        if (!bits.length) continue;
        lines.push(`- ${s.c.name}: ${bits.join(' · ')}`);
      }
      return lines.join('\n') || '(none)';
    } catch {
      return '(unavailable)';
    }
  }

  _peanutPickSpeakers(preferNames = [], source = '') {
    const pool = this._peanutCastPool();
    if (!pool.length) {
      throw new Error('No supporting cast for the gallery — add cast cards that are not Star or Director.');
    }
    const preferred = new Set((preferNames || []).map(n => String(n).toLowerCase()));
    let rep = { personal: [] };
    try { rep = this.storage.getChat('reputation', { personal: [], house: [] }); } catch { /* ignore */ }

    const tied = (a, b) => {
      const node = this._peanutFindNode(rep, a.c);
      const other = this._peanutFindNode(rep, b.c);
      if (!node || !other) return false;
      return (node.links || []).includes(other.id)
        || (other.links || []).includes(node.id)
        || (node.readings || []).some(r => r.targetId === other.id)
        || (other.readings || []).some(r => r.targetId === node.id);
    };
    const connScore = (row) => {
      const node = this._peanutFindNode(rep, row.c);
      if (!node) return 0;
      return (node.links || []).length + (node.readings || []).length;
    };
    const shuffle = (list) => {
      const slice = list.slice(0, 6);
      for (let i = slice.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [slice[i], slice[j]] = [slice[j], slice[i]];
      }
      return slice;
    };

    const named = pool.filter(row =>
      preferred.has(String(row.c.name || '').toLowerCase())
      || this._peanutNameInText(row.c.name, source));
    const picked = [];
    for (const row of named) {
      if (picked.length >= 6) break;
      picked.push(row);
    }
    if (picked.length) {
      for (const row of pool) {
        if (picked.length >= 6) break;
        if (picked.includes(row)) continue;
        if (picked.some(p => tied(row, p))) picked.push(row);
      }
      return shuffle(picked);
    }

    const ranked = [...pool].sort((a, b) => connScore(b) - connScore(a));
    if (ranked[0]) picked.push(ranked[0]);
    for (const row of ranked) {
      if (picked.length >= 4) break;
      if (picked.includes(row)) continue;
      if (picked.some(p => tied(row, p))) picked.push(row);
    }
    while (picked.length < Math.min(3, ranked.length)) {
      const next = ranked.find(r => !picked.includes(r));
      if (!next) break;
      picked.push(next);
    }
    return shuffle(picked);
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

  _peanutPrompt({ names, castBlock, connBrief, loreBrief = '', label, source, want, continueThread = '', poke = '' }) {
    const shuffled = [...names].sort(() => Math.random() - 0.5);
    const exA = shuffled[0] || 'CastA';
    const exB = shuffled[Math.min(1, shuffled.length - 1)] || exA;
    const banterRule = continueThread
      ? `REQUIRED: At least half the lines must answer, rib, quote, or disagree with a PRIOR balcony line (name-check who you're talking to). Do not ignore the prior chat.`
      : `REQUIRED: Speakers talk to EACH OTHER about the scene — address someone by name, pile on, contradict, or riff. Not ${want} isolated monologues.`;
    const pokeLine = String(poke || '').trim();
    const pokeRule = pokeLine
      ? `Talk about this: ${pokeLine}\nThe scene below is what they watched. Stay on the balcony.\n\n`
      : '';
    return `You write balcony / stream-chat reactions. You are NOT writing the scene. Speakers are watching, not performing.

Available speakers (use these exact name strings when they speak):
${shuffled.map(n => `- ${n}`).join('\n')}

Tone hints (do not quote):
${castBlock}

How they feel about each other and the Star (use for tone, digs, alliances, and what they would never say):
${connBrief}

Filed lore, stamps, and tags in play (in-jokes and accurate references — do not recap dump. A speaker may only allude to a secret they own or know; never leak what they are unaware of):
${loreBrief || '(none stamped or tagged in play)'}

${continueThread ? `Prior balcony chat (react to THESE lines):\n${continueThread}\n\n` : ''}${pokeRule}Scene they are watching (${label}):
${String(source || '')}

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
      const speakers = this._peanutPickSpeakers([], source);
      const castBlock = speakers.map(s => {
        const tip = String(s.blurb || s.identity?.description || s.c.priority || 'cast')
          .replace(/\s+/g, ' ').trim().slice(0, 160);
        return `- ${s.c.name}: ${tip}`;
      }).join('\n');
      const names = speakers.map(s => s.c.name);
      const connBrief = this._peanutConnectionsBrief(speakers);
      const loreBrief = this._peanutLoreBrief(speakers, source, scene);
      const want = this._peanutWantCount(names.length, { continueThread: false });

      const prompt = this._peanutPrompt({
        names, castBlock, connBrief, loreBrief, label, source, want,
        poke: st.peanut.poke,
      });
      let raw = await this._peanutGenerate(prompt);
      let comments = this._parsePeanutComments(raw, names, { maxOut: want + 2 });
      if (!comments.length) {
        const poke = String(st.peanut.poke || '').trim();
        const retry = `JSON array only. ${want} REACTION lines. Not everyone must speak. Any order.
Exact names (pool): ${names.join(' | ')}
${poke ? `Talk about this: ${poke}\n` : ''}Watching: ${String(source).slice(0, 900)}
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
      void showtimeAlert(`Listen failed: ${err.message || err}`, { title: 'PEANUT GALLERY', danger: true });
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
      void showtimeAlert('Nothing to continue — Listen… first.', { title: 'PEANUT GALLERY' });
      return;
    }
    const chatToken = this._chatToken();
    this._busy = true;
    this.render(this.container);
    try {
      const priorNames = [...new Set(active.comments.map(c => c.name).filter(Boolean))];
      let sourceBit = '';
      let label = active.label || 'balcony';
      let scene = null;
      let loreBrief = '(none)';
      try {
        const src = this._peanutSource(st);
        label = src.label;
        scene = src.scene || null;
        sourceBit = src.source;
      } catch {
        sourceBit = active.label || 'ongoing balcony chat';
      }
      const speakers = this._peanutPickSpeakers(priorNames, sourceBit);
      const names = speakers.map(s => s.c.name);
      const castBlock = speakers.map(s => {
        const tip = String(s.blurb || s.identity?.description || s.c.priority || 'cast')
          .replace(/\s+/g, ' ').trim().slice(0, 160);
        return `- ${s.c.name}: ${tip}`;
      }).join('\n');
      const connBrief = this._peanutConnectionsBrief(speakers);
      loreBrief = this._peanutLoreBrief(speakers, sourceBit, scene);
      // Keep prior thread intact for context (don't strip with reaction filter)
      const thread = active.comments
        .slice(-14)
        .map(c => `${c.name}: ${c.text}`)
        .join('\n');
      const want = this._peanutWantCount(names.length, { continueThread: true });

      const prompt = this._peanutPrompt({
        names,
        castBlock,
        connBrief,
        loreBrief,
        label,
        source: sourceBit,
        want,
        poke: st.peanut.poke,
        continueThread: thread || '(none yet)',
      });
      let raw = await this._peanutGenerate(prompt);
      let next = this._parsePeanutComments(raw, names, { maxOut: want + 2 });
      if (!next.length) {
        const poke = String(st.peanut.poke || '').trim();
        raw = await this._peanutGenerate(
          `Continue the balcony chat. JSON array of ${want} reactions (about twice a Listen pass).
Not everyone must speak; any order; someone may speak twice.
At least half must reply to someone in Prior (name them). Use filed lore/tags/ties when they sting.
${poke ? `Talk about this: ${poke}\n` : ''}Names (pool): ${names.join(' | ')}
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
      void showtimeAlert(`Continue failed: ${err.message || err}`, { title: 'PEANUT GALLERY', danger: true });
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

  async _quiet(prompt, { quietName = 'System', profileSlot = '', responseLength = 0 } = {}) {
    const text = String(prompt || '');
    const voice = quietName !== 'System' && quietName !== 'Director';
    const budget = responseLength > 0
      ? responseLength
      : (voice || profileSlot === 'event' ? 900 : 3200);
    const go = () => leanQuietGenerate(text, {
      kind: voice ? 'voice' : 'filing',
      responseLength: budget,
      fallback: null,
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

  _interviewProfileLabel() {
    const id = String(this._g().profiles.interview || '').trim();
    if (!id) return 'Current';
    const hit = (this._profiles || []).find(p => p.id === id || p.name === id);
    return hit?.name || id;
  }

  _saveProfileSlot(slot, value) {
    const g = this._g();
    g.profiles = hydrateProfileMap(g.profiles);
    if (!PROFILE_SLOT_IDS.includes(slot)) return;
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
      const playIds = new Set(inPlayCastRecords(this.storage).map(c => c.id));
      const rep = this.storage.getChat('reputation', { personal: [], house: [] });
      const cast = this._fullCast();
      const nameFor = (id) => cast.find(c => c.id === id)?.name || id;
      const lines = [];
      const personal = (rep.personal || []).filter(x => x.intro === 'pre' || x.kind === 'notice');
      const picked = personal.filter(n => n.intro === 'pre' || playIds.has(n.characterId));
      for (const n of picked.slice(0, 8)) {
        const resolved = n.characterId ? standingToward(this.storage, `cast:${n.characterId}`) : null;
        const standing = resolved != null ? resolved : (n.standing ?? '—');
        lines.push(`- ${n.name} [${n.intro === 'pre' ? 'pre-established' : n.category || 'notice'}] standing ${standing}`);
      }
      for (const h of (rep.house || []).slice(0, 6)) {
        const memberIds = [
          h.headId,
          ...(h.connections || []).map(c => c.characterId),
        ].filter(Boolean);
        if (memberIds.length && !memberIds.some(id => playIds.has(id))) continue;
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

  _scriptPersonName(raw) {
    return String(raw || '').replace(/\s*\([^)]*\)\s*$/, '').trim();
  }

  _scriptWhenLine(card, writtenSpan) {
    try {
      const scriptDb = this.storage.getChat('script', {});
      const cal = normalizeCalendar(scriptDb?.settings?.calendar);
      const now = currentTimelinePresent(this.storage);
      const hit = pickParseableTimeKey(card, cal, { fillMissing: false });
      const family = (scale) => (scale === 'date' ? 'date' : 'calendar');
      const thenScale = family(hit?.parsed?.scale);
      const nowScale = family(now?.scale);
      if (
        hit && now && hit.parsed?.scale && now?.scale && thenScale === nowScale
        && Number.isFinite(hit.parsed.sort) && Number.isFinite(Number(now.sort))
      ) {
        const phrase = phraseRecallGap(hit.parsed.sort, now.sort, cal, { scale: nowScale });
        if (phrase) return `When: this was ${phrase}.`;
      }
      const then = String(writtenSpan || card?.span || card?.timeKey || '').trim();
      const nowKey = String(now?.key || '').trim();
      const bits = [];
      if (then) bits.push(`Then: ${then}.`);
      if (nowKey) bits.push(`Now: ${nowKey}.`);
      return bits.join(' ');
    } catch {
      return '';
    }
  }

  _scriptPeopleLines(subject, names) {
    const subjectName = String(subject?.name || '').trim().toLowerCase();
    const seen = new Set();
    const lines = [];
    for (const raw of names) {
      const name = this._scriptPersonName(raw);
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key) || (subjectName && key === subjectName)) continue;
      seen.add(key);
      const hit = connectionReading(this.storage, {
        id: subject?.id,
        characterId: subject?.id,
        name: subject?.name,
      }, { name });
      const a = hit?.toward;
      const b = hit?.reverse;
      const bits = [];
      if (a?.history) bits.push(clipText(a.history, 160));
      else if (b?.history) bits.push(clipText(b.history, 140));
      if (a?.baseline) bits.push(clipText(a.baseline, 160));
      else if (a?.take) bits.push(clipText(a.take, 140));
      const feel = bits.filter(Boolean).join(' ');
      lines.push(feel ? `- ${name} — ${feel}` : `- ${name}`);
      if (lines.length >= 8) break;
    }
    return lines;
  }

  _scriptStampEntries(card, subject, leaves) {
    const stamped = Array.isArray(card?.sourceStamp?.entries) ? card.sourceStamp.entries : [];
    const blocks = [];
    const lorePeople = [];
    let firstSpan = '';
    for (const entry of stamped) {
      const leaf = this._peanutStampLeaf(entry, leaves || []);
      const body = String(leaf?.content || '').trim();
      if (!body) continue;
      const title = String(leaf?.title || entry?.title || '').trim();
      blocks.push([title, body].filter(Boolean).join('\n'));
      try {
        const parsed = parseMemoryBookContent(body);
        for (const name of parsed.credits || []) lorePeople.push(name);
        if (!firstSpan && parsed.span) firstSpan = parsed.span;
      } catch { /* the entry text is already kept */ }
    }
    if (!blocks.length) {
      const happened = String(card?.summary || card?.content || '').replace(/\s+/g, ' ').trim();
      if (happened) blocks.push(happened);
    }
    const people = this._scriptPeopleLines(subject, [
      ...(card?.credits || []).map(cr => cr?.name || cr?.character || ''),
      ...lorePeople,
    ]);
    const when = this._scriptWhenLine(card, firstSpan);
    const tail = [];
    if (people.length) tail.push(`Who was there:\n${people.join('\n')}`);
    if (when) tail.push(when);
    return { blocks, tail };
  }

  _noteTargets(noteId, subjectId) {
    const key = `${noteId}|${subjectId || ''}`;
    const now = Date.now();
    if (this._noteTargetCache?.key === key && now - this._noteTargetCache.at < 4000) {
      return this._noteTargetCache.list;
    }
    const out = [];
    const push = (id, title, prompt, group) => {
      if (!id || !title) return;
      out.push({
        id: `${group}:${id}`,
        title: `${group} · ${title}`,
        spoken: title,
        prompt,
        group,
      });
    };
    try {
      const inv = this.storage.getChat('inventory', { static: [], mobile: [] });
      const items = [...(inv.mobile || []), ...(inv.static || [])];
      if (noteId === 'props') {
        for (const it of items) {
          const inTrunk = (inv.static || []).some(x => x.id === it.id);
          const loc = inTrunk ? 'Trunk' : 'On Person';
          push(it.id, it.name, `Something in the world — “${it.name}” (${loc}). ${clipText(it.description, 240)}`, 'Item');
        }
        const subj = this._fullCast().find(c => c.id === subjectId);
        for (const w of (subj?.wardrobe || [])) {
          push(w.id || w.name, w.name, `Clothes they keep — “${w.name}”. ${clipText(w.description, 240)}`, 'Wardrobe');
        }
        for (const p of (subj?.props || [])) {
          push(p.id || p.name, p.name, `Something they carry — “${p.name}”. ${clipText(p.description, 240)}`, 'Prop');
        }
      }
      if (noteId === 'fashion') {
        for (const c of this._fullCast()) {
          if (!c || c.priority === 'director') continue;
          const name = String(c.name || '').trim() || 'Cast';
          const kit = this._fashionKit(c);
          const worn = kit.wardrobe || [];
          const outfits = normalizeOutfits(c.outfits);
          if (!worn.length && !outfits.length) continue;
          const owned = new Map(kitOwnedItems(worn, kit.props || []).map(x => [x.id, x]));
          if (!worn.length) {
            out.push({
              id: `fashion:current:${c.id}`,
              title: `${name} · Current`,
              spoken: `what ${name} has on`,
              bucket: name,
              group: 'Fashion',
              prompt: `${name} has nothing on. They are nude. Talk about that, not a closet or a file.`,
            });
          }
          if (worn.length) {
            const look = formatOutfitLook(pickPrimaryOutfit(c.outfits, worn, [...owned.values()]), { compact: false });
            const pieces = worn.slice(0, 8).map(w => {
              const piece = String(w?.name || '').trim();
              if (!piece) return '';
              const desc = String(w?.description || '').replace(/\s+/g, ' ').trim().slice(0, 120);
              return desc ? `${piece}: ${desc}` : piece;
            }).filter(Boolean);
            out.push({
              id: `fashion:current:${c.id}`,
              title: `${name} · Current`,
              spoken: `what ${name} has on`,
              bucket: name,
              group: 'Fashion',
              prompt: [
                `${name} has this on now. Talk about the clothes, not a closet or a file.`,
                look,
                pieces.length ? `Pieces:\n${pieces.map(p => `- ${p}`).join('\n')}` : '',
              ].filter(Boolean).join('\n'),
            });
          }
          for (const o of outfits) {
            const parts = (o.partIds || []).map(pid => owned.get(pid)?.name || 'Missing piece');
            const type = outfitTypeMeta(o.type).label;
            out.push({
              id: `fashion:outfit:${c.id}:${o.id}`,
              title: `${name} · Closet · ${o.title}`,
              spoken: o.title,
              bucket: name,
              group: 'Fashion',
              prompt: [
                `Clothes ${name} keeps. They may not have them on. Talk about the clothes, not a closet or a file.`,
                `${o.title} (${type})`,
                o.description || '',
                parts.length ? `Pieces: ${parts.join(', ')}` : '',
              ].filter(Boolean).join('\n'),
            });
          }
        }
      }
      if (noteId === 'role') {
        try {
          const mot = this.storage.getChat('motivation', { perChar: {} });
          const row = mot.perChar?.[subjectId] || {};
          for (const a of (row.achievements || [])) {
            push(a.id, a.title, `Something that happened for them — “${a.title}”. ${String(a.description || '').slice(0, 400)}`, 'Achievement');
          }
          for (const s of (row.secrets || [])) {
            push(s.id, s.title, `Something they keep quiet — “${s.title}”. ${clipText(s.description, 280)}`, 'Secret');
          }
        } catch { /* ignore */ }
        const scenes = getSceneCards(this.storage).slice(0, 80);
        for (const s of scenes) {
          out.push({
            id: `Script:${s.uid}`,
            title: ['Script', [s.code, s.title].filter(Boolean).join(' ')].filter(Boolean).join(' · '),
            spoken: '',
            group: 'Script',
            cardUid: s.uid,
            prompt: '',
          });
        }
        for (const leaf of listVisibleLibraryLeaves(this.storage).slice(0, 80)) {
          const lead = `Something they know — “${leaf.title}”. `;
          const body = String(leaf.content || '').trim().slice(0, 20000);
          push(leaf.key || leaf.id, leaf.title, `${lead}${body}`, 'Library');
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
          for (const n of (rep.personal || [])) {
            if ((n.links || []).includes(selfNode.id)) linkedIds.add(n.id);
            if ((n.readings || []).some(r => r.targetId === selfNode.id)) linkedIds.add(n.id);
          }
        }
        const personal = selfNode
          ? (rep.personal || []).filter(n => linkedIds.has(n.id) || n.characterId === subjectId)
          : (rep.personal || []).filter(n => n.characterId === subjectId);
        for (const n of personal) {
          const pair = selfNode && n.id !== selfNode.id
            ? this._pairConnBrief(selfNode, n, { otherName: n.name })
            : '';
          const blob = [
            `Someone in your life — ${n.name}.`,
            pair,
            clipText(n.notes, 180),
          ].filter(Boolean).join('\n');
          push(n.id, n.name, blob, 'Reputation');
        }
        const houseIds = new Set(characterHouseIds(this.storage, subjectId));
        for (const h of (rep.house || []).filter(x => houseIds.has(x.id))) {
          push(h.id, h.alias || h.name, `A house you belong to — ${h.alias || h.name}. ${h.duty ? `Your place there: ${h.duty}. ` : ''}${clipText(h.notes || h.opinion, 240)}`, 'Affiliation');
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
          push(s.id, s.title, `${angle === 'own' ? 'Something you keep quiet' : `Something you've heard, from ${s.ownerName || 'someone'}`} — “${s.title}”. ${clipText(s.description, 280)}`, 'Secret');
        }
      }
    } catch (err) {
      console.warn('[Backstage] note targets', err);
    }
    // de-dupe by id
    const seen = new Set();
    const list = out.filter(t => (seen.has(t.id) ? false : (seen.add(t.id), true))).slice(0, 80);
    this._noteTargetCache = { key, at: now, list };
    return list;
  }

  async _ensureInterviewLeaves() {
    const cached = await ensureLibraryBooks();
    if (cached.length) return listVisibleLibraryLeaves(this.storage, cached);
    try {
      const script = globalThis.Showtime?.modules?.get?.('script');
      if (script && typeof script._loadWIBooks === 'function') {
        if (!script._wiBooks?.length) await script._loadWIBooks();
        if (script._wiBooks?.length) {
          return listLibraryLeaves(this.storage, script._wiBooks).filter(leaf => !leaf.disabled);
        }
      }
    } catch (err) {
      console.warn('[Backstage] interview lorebooks', err);
    }
    return this._peanutLibraryLeaves();
  }

  async _subjectLanes(subject, _askKind, meta = {}) {
    const ctx = getContext();
    const target = meta?.target || null;
    const raw = String(target?.title || '').trim();
    const focusName = raw
      .replace(/^(Reputation|Cast|Affiliation|Achievement|Secret|Script|Library|Item|Wardrobe|Prop|Wearable|Cast look)\s*·\s*/i, '')
      .split('·')[0]
      .trim();
    const card = resolveInterviewCard(this.storage, subject, {
      characters: ctx.characters ?? [],
      personas: listPersonas(power_user),
      focusName,
    });
    const leaves = await this._ensureInterviewLeaves();
    const aboutRel = this._aboutConnForTarget(subject, target);
    const aboutLine = String(meta?.about || '').trim();
    const notecard = target && target.group !== 'Script' && target.group !== 'Library'
      ? String(target.prompt || '').trim()
      : '';
    const desk = fitInterviewDesk([
      notecard,
      aboutRel,
      aboutLine ? `About this: ${aboutLine}` : '',
      card.desk,
    ]);
    return {
      who: card.text,
      desk,
      lore: this._interviewLore(subject, target, leaves),
    };
  }

  _interviewLore(subject, target, leaves = null) {
    const rows = getSceneCards(this.storage);
    const cards = rows.map(row => row.card).filter(card => card?.uid);
    const byUid = new Map(rows.map(row => [row.uid, row]));
    const shelf = shelfOrderedUids(cards);
    let lead = '';
    let seedUids = [];
    if (target?.group === 'Script' && target.cardUid) {
      seedUids = [target.cardUid];
    } else if (target?.group === 'Library') {
      lead = String(target.prompt || '').trim();
      seedUids = this._latestOnShelf(this._libraryStampSeeds(rows, target), shelf);
    } else {
      seedUids = this._creditedSeedUids(subject, shelf);
    }
    const expanded = seedUids.length
      ? expandScriptSeeds(cards, seedUids, { back: 2, forward: 1, cap: 8 })
      : { seeds: [], extra: [], order: [] };
    const want = new Set(expanded.order);
    const seedSet = new Set(expanded.seeds);
    const seedOrder = shelf.filter(uid => seedSet.has(uid));
    const extraOrder = shelf.filter(uid => want.has(uid) && !seedSet.has(uid));
    const offShelf = expanded.order.filter(uid => !shelf.includes(uid));
    const sequence = [
      ...seedOrder,
      ...offShelf.filter(uid => seedSet.has(uid)),
      ...extraOrder,
      ...offShelf.filter(uid => !seedSet.has(uid)),
    ];
    const loreLeaves = leaves || this._peanutLibraryLeaves();
    const blocks = [];
    let room = 6000;
    const leadBlock = this._fitLoreLead(lead, room);
    if (leadBlock) {
      blocks.push(leadBlock);
      room -= leadBlock.length + 2;
    }
    for (const uid of sequence) {
      if (room < 80) break;
      const row = byUid.get(uid);
      if (!row) continue;
      const block = this._scriptCardBlock(row, subject, loreLeaves, room);
      if (!block) continue;
      blocks.push(block);
      room -= block.length + 2;
    }
    return blocks.join('\n\n');
  }

  _creditedSeedUids(subject, shelf) {
    let credited = [];
    try {
      credited = creditedScenes(this.storage, subject?.id, subject?.name).map(scene => scene.uid);
    } catch {
      return [];
    }
    const set = new Set(credited);
    const onShelf = (shelf || []).filter(uid => set.has(uid));
    const latest = (onShelf.length ? onShelf : credited).slice(-4);
    return latest;
  }

  _libraryStampSeeds(rows, target) {
    const rawId = String(target?.id || '');
    const key = rawId.includes(':') ? rawId.slice(rawId.indexOf(':') + 1) : rawId;
    const title = String(target?.spoken || target?.title || '')
      .replace(/^Library\s*·\s*/i, '')
      .trim()
      .toLowerCase();
    const hits = [];
    for (const row of rows) {
      const entries = Array.isArray(row.card?.sourceStamp?.entries) ? row.card.sourceStamp.entries : [];
      const stamped = entries.some(entry => {
        const ek = String(entry?.key || '').trim();
        const eu = String(entry?.uid || '').trim();
        const et = String(entry?.title || '').trim().toLowerCase();
        return (key && (ek === key || eu === key)) || (title && et === title);
      });
      if (stamped) hits.push(row.uid);
    }
    return hits;
  }

  _latestOnShelf(uids, shelf, n = 4) {
    const set = new Set(uids || []);
    const onShelf = (shelf || []).filter(uid => set.has(uid));
    const list = onShelf.length ? onShelf : [...set];
    return list.slice(-n);
  }

  _fitLoreLead(text, room) {
    const body = String(text || '').trim();
    if (!body || room < 80) return '';
    if (body.length <= room) return body;
    const kept = [];
    let size = 0;
    for (const para of body.split(/\n\n/)) {
      const piece = para.trim();
      if (!piece) continue;
      const gap = kept.length ? 2 : 0;
      if (size + gap + piece.length > room) break;
      kept.push(piece);
      size += gap + piece.length;
    }
    if (kept.length) return kept.join('\n\n');
    const slice = body.slice(0, room);
    const dot = slice.lastIndexOf('. ');
    return (dot > 200 ? slice.slice(0, dot + 1) : slice).trim();
  }

  _scriptCardBlock(row, subject, leaves, room) {
    const { blocks, tail } = this._scriptStampEntries(row.card || {}, subject, leaves);
    if (!blocks.length || room < 80) return '';
    // The scene title is a label, not an event. Stamped entries already name themselves.
    const budget = room;
    const chosen = [];
    let size = 0;
    for (let i = blocks.length - 1; i >= 0; i--) {
      const entry = blocks[i];
      const gap = chosen.length ? 2 : 0;
      if (size + gap + entry.length > budget) continue;
      chosen.unshift(entry);
      size += gap + entry.length;
    }
    if (!chosen.length) return '';
    for (const extra of tail) {
      const gap = 2;
      if (size + gap + extra.length > budget) continue;
      chosen.push(extra);
      size += gap + extra.length;
    }
    return chosen.filter(Boolean).join('\n\n');
  }

  _pairConnBrief(subjectNode, otherNode, { otherName = '' } = {}) {
    const hit = connectionReading(this.storage, {
      id: subjectNode?.id,
      characterId: subjectNode?.characterId,
      name: subjectNode?.name,
    }, {
      id: otherNode?.id,
      characterId: otherNode?.characterId,
      name: otherName || otherNode?.name,
    });
    if (!hit) return '';
    const name = hit.name || otherName || 'them';
    const linked = hit.linked;
    const a = hit.toward;
    const b = hit.reverse;
    const lines = [];
    if (linked) lines.push(`You and ${name} are linked on the Connections web.`);
    if (a.intro === 'pre' || b.intro === 'pre') {
      lines.push(`Introduction: pre-established (beyond this story).`);
    } else if (String(a.intro).startsWith('scene:')) {
      const lab = sceneLabel(this.storage, a.intro.slice(6));
      if (lab) lines.push(`Introduced in ${lab}.`);
    }
    if (a.history) lines.push(`How you met: ${clipText(a.history, 320)}`);
    else if (b.history) lines.push(`How they met you: ${clipText(b.history, 280)}`);
    if (a.baseline) lines.push(`Current baseline: ${clipText(a.baseline, 320)}`);
    if (a.take || a.standing != null) {
      lines.push(`Your take on ${name}: standing ${a.standing ?? '—'}; ${clipText(a.take, 240) || '—'}`);
    }
    if (b.take || b.standing != null) {
      lines.push(`How ${name} sees you: standing ${b.standing ?? '—'}; ${clipText(b.take, 240) || '—'}`);
    }
    return lines.join('\n');
  }

  _aboutConnForTarget(subject, target) {
    if (!subject || !target) return '';
    try {
      const rep = this.storage.getChat('reputation', { personal: [] });
      const nodes = Array.isArray(rep.personal) ? rep.personal : [];
      const subjectNode = nodes.find(n => n.characterId === subject.id)
        || nodes.find(n => String(n.name || '').toLowerCase() === String(subject.name || '').toLowerCase());
      const hint = String(target.id || '').includes(':')
        ? target.id.split(':').slice(1).join(':')
        : String(target.id || '').trim();
      const titleName = String(target.title || '').replace(/^(Reputation|Cast|Affiliation)\s*·\s*/i, '').trim();
      const other = nodes.find(n => n.id === hint)
        || nodes.find(n => String(n.name || '').toLowerCase() === titleName.toLowerCase())
        || nodes.find(n => n.characterId && titleName && String(this._fullCast().find(c => c.id === n.characterId)?.name || '').toLowerCase() === titleName.toLowerCase());
      if (!subjectNode || !other || subjectNode.id === other.id) return '';
      const brief = this._pairConnBrief(subjectNode, other, { otherName: other.name || titleName });
      if (!brief) return '';
      return `YOUR RELATIONSHIP WITH ${other.name || titleName} (private — speak from this, do not recite labels):\n${brief}`;
    } catch {
      return '';
    }
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
          const intro = subjOfIv.intro || 'none';
          const history = String(subjOfIv.history || (intro === 'pre' ? subjOfIv.description : '') || '').trim();
          const baseline = String(subjOfIv.baseline || (intro !== 'pre' ? subjOfIv.description : '') || '').trim();
          if (history) lines.push(`How you met: ${history.slice(0, 180)}`);
          if (baseline) lines.push(`Current baseline: ${baseline.slice(0, 180)}`);
          if (subjOfIv.stampUid) {
            const lab = sceneLabel(this.storage, subjOfIv.stampUid);
            if (lab) lines.push(`Take formed in ${lab}`);
          }
        }
        const ivOfSubj = (interviewerNode.readings || []).find(r => r.targetId === subjectNode.id);
        if (ivOfSubj) {
          lines.push(`How ${interviewerName} sees you: aware=${ivOfSubj.aware || '—'}; standing=${ivOfSubj.standing ?? '—'}; ${String(ivOfSubj.take || '—').slice(0, 220)}`);
          const intro = ivOfSubj.intro || 'none';
          const history = String(ivOfSubj.history || (intro === 'pre' ? ivOfSubj.description : '') || '').trim();
          const baseline = String(ivOfSubj.baseline || (intro !== 'pre' ? ivOfSubj.description : '') || '').trim();
          if (history) lines.push(`How they met you: ${history.slice(0, 180)}`);
          if (baseline) lines.push(`${interviewerName} baseline: ${baseline.slice(0, 180)}`);
          if (ivOfSubj.stampUid) {
            const lab = sceneLabel(this.storage, ivOfSubj.stampUid);
            if (lab) lines.push(`${interviewerName}’s take formed in ${lab}`);
          }
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

  _peanutClipRows(rows, max = 2400) {
    const list = Array.isArray(rows) ? rows : [];
    const kept = [];
    let used = 0;
    for (let i = list.length - 1; i >= 0; i--) {
      const row = list[i];
      const line = `[${row.index}] ${row.name}: ${row.text}`;
      if (kept.length && used + line.length + 1 > max) break;
      kept.unshift(row);
      used += line.length + 1;
    }
    return kept;
  }

  _peanutClipText(text, max = 2400) {
    const s = String(text || '').trim();
    if (s.length <= max) return s;
    const cut = s.lastIndexOf('\n', max);
    return (cut > Math.floor(max * 0.5) ? s.slice(0, cut) : s.slice(0, max)).trim();
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
      return { label: `${scene.code} · ${scene.title}`, source: this._peanutClipText(body), scene };
    }
    if (mode === 'range') {
      const rows = this._peanutClipRows(this._chatSlice(st.peanut.from, st.peanut.to));
      if (!rows.length) throw new Error('No messages in that range.');
      const lo = rows[0].index;
      const hi = rows[rows.length - 1].index;
      return {
        label: `#${lo}–${hi}`,
        source: rows.map(m => `[${m.index}] ${m.name}: ${m.text}`).join('\n'),
        scene: null,
      };
    }
    const n = Math.max(1, Math.min(80, Number(st.peanut.recentN) || 12));
    const rows = this._peanutClipRows(this._chatSlice().slice(-n));
    if (!rows.length) throw new Error('No chat messages yet.');
    return {
      label: `last ${rows.length}`,
      source: rows.map(m => `[${m.index}] ${m.name}: ${m.text}`).join('\n'),
      scene: null,
    };
  }

  _buildNowInjection() {
    const root = extension_settings.showtime ?? {};
    if (root.masterOff) return '';
    this._scanChatTrackers({ persist: false });
    const st = this._db();
    const scene = normalizeTrackers(st.trackers).scene;
    const { doc } = ensureNow(this.storage, { scene });
    const snap = this._sceneClapSnapshot(st);
    const loc = formatOccupancyLabel(doc.occupancy, { lastLocationKey: doc.lastLocationKey })
      || (snap.location && snap.location !== '—' ? snap.location : '');
    const time = scene.followTimeline !== false && snap.time ? snap.time : (doc.clock.timeLabel || scene.lastTimeLabel);
    const date = scene.followTimeline !== false && snap.date && snap.date !== '—' ? snap.date : (doc.clock.dateLabel || scene.lastDateLabel);
    const sceneLine = renderNowSceneLine(doc, scene.enabled ? {
      ...scene,
      lastTimeLabel: time,
      lastDateLabel: date,
    } : { enabled: false }) || formatNowSceneLine(scene.enabled ? {
      ...scene,
      lastTimeLabel: time,
      lastDateLabel: date,
    } : { enabled: false }, loc);
    const people = inPlayCastRecords(this.storage);
    const kitText = compactKitInject(worldFromStorage(this.storage), {
      people,
      lastLocationKey: doc.lastLocationKey,
      travel: doc.occupancy,
      wrap: false,
    });
    let visitText = '';
    try {
      visitText = visitLinesForPeople(this.storage, people, doc.occupancy).join('\n');
    } catch { visitText = ''; }
    const ledgerText = renderNowLedgerLines(doc.ledger);
    return compactNowInject({ sceneLine, kitText, visitText, ledgerText });
  }

  _buildSlateInstructInjection() {
    const root = extension_settings.showtime ?? {};
    if (root.masterOff) return '';
    const st = this._db();
    const trackers = normalizeTrackers(st.trackers);
    const scene = trackers.scene;
    const clockLive = scene.time !== false && (
      scene.enabled || Number.isFinite(Number(scene.lastTimeHour))
    );
    const printOn = !!(scene.enabled && scene.printChatCard);
    if (!clockLive && !printOn) return '';
    if (!printOn) return compactTurnTimeInstruct();
    return compactChatSlateInstruct({
      motivation: trackers.motivation?.enabled !== false,
      connection: trackers.connection?.enabled !== false,
      files: true,
    });
  }

  _applyTurnElapsed(spec) {
    const minutes = Number(spec?.minutes) || 0;
    if (minutes <= 0) return;
    const st = this._db();
    st.trackers = normalizeTrackers(st.trackers);
    const scene = st.trackers.scene;
    if (!scene || scene.time === false) return;
    try {
      const chat = getContext()?.chat || [];
      const last = [...chat].reverse().find(m => m && !m.is_system);
      const sceneText = String(last?.mes || '').replace(/<[^>]+>/g, ' ');
      applyOffscreenNeeds(this.storage, { sceneText, bus: this.bus });
    } catch { /* ignore */ }
    const cal = normalizeCalendar(this.storage.getChat('script', {})?.settings?.calendar);
    const hpd = Math.max(1, Number(cal.hoursPerDay) || 24);
    const hit = advanceSceneByMinutes(scene, minutes, { hoursPerDay: hpd, sig: spec?.sig || '' });
    if (!hit.changed) return;
    try { syncNowFromScene(this.storage, scene, { source: 'turn' }); } catch { /* ignore */ }
    if (Number.isFinite(Number(scene.lastTimeHour))) {
      this._syncTimelinePresent({
        deltaDays: hit.time?.deltaDays,
        hour: Number(scene.lastTimeHour),
        minute: scene.lastTimeMinute,
      });
    }
    this.saveState();
    this._syncFloatingClapper(false, { scan: false });
  }

  _applySlateScene(tag) {
    if (!tag) return;
    const st = this._db();
    st.trackers = normalizeTrackers(st.trackers);
    const scene = st.trackers.scene;
    if (!scene.enabled || !scene.printChatCard) return;
    const cal = normalizeCalendar(this.storage.getChat('script', {})?.settings?.calendar);
    const hpd = Math.max(1, Number(cal.hoursPerDay) || 24);
    let placeId = '';
    try {
      const compass = ensureCompass(st);
      const loc = String(tag.location || '').trim();
      placeId = findPlaceIdByKey(compass, loc)
        || findPlaceByExactName(compass, loc)?.id
        || findPlaceForTag(compass, loc)?.id
        || '';
    } catch { /* ignore */ }
    const hit = applySlateSceneStamp(scene, tag, { hoursPerDay: hpd, placeId });
    if (!hit.changed) return;
    try { syncNowFromScene(this.storage, scene, { source: 'slate' }); } catch { /* ignore */ }
    this._scheduleSuiteBuild();
    this._armBoardHold(scene);
    if (scene.time !== false && Number.isFinite(Number(scene.lastTimeHour))) {
      this._syncTimelinePresent({
        hour: Number(scene.lastTimeHour),
        minute: scene.lastTimeMinute,
      });
    }
    this.saveState();
    this._syncFloatingClapper(false, { scan: false });
    this._syncWeatherOverlay();
  }

  _buildConnectionsInjection() {
    const root = extension_settings.showtime ?? {};
    if (root.masterOff) return '';
    const st = this._db();
    const conn = normalizeTrackers(st.trackers).connection;
    if (!conn.enabled) return '';
    return compactConnectionsInject(this.storage);
  }

  _registerInjection() {
    if (!this.injector) return;
    this.injector.unregister('backstage.director');
    this.injector.unregister('backstage.scene');
    this.injector.unregister('backstage.kit');
    this.injector.register({
      id: 'backstage.now',
      always: true,
      heavy: true,
      buildText: () => this._buildNowInjection(),
    });
    this.injector.register({
      id: 'backstage.slate',
      always: true,
      buildText: () => this._buildSlateInstructInjection(),
    });
    this.injector.register({
      id: 'backstage.connections',
      always: true,
      buildText: () => this._buildConnectionsInjection(),
    });
    this.injector.register({
      id: 'backstage.receipt',
      always: true,
      buildText: () => {
        const root = extension_settings.showtime ?? {};
        if (root.masterOff) return '';
        if (lastUserHasReceiptWrap(getContext()?.chat)) return '';
        return compactReceiptInject(loadLastReceipt(this.storage));
      },
    });
    this.injector.register({
      id: 'backstage.compass',
      always: true,
      heavy: true,
      position: extension_prompt_types.IN_CHAT,
      depth: 2,
      buildText: () => {
        const root = extension_settings.showtime ?? {};
        if (root.masterOff) return '';
        const st = this._db();
        const compass = ensureCompass(st);
        const { doc } = ensureNow(this.storage, { scene: normalizeTrackers(st.trackers).scene });
        const star = getStarMember(this.storage);
        const ctx = getContext();
        const activeCue = getActiveCastCue();
        const cuedSpeakerName = String(activeCue?.name || '').trim();
        const speakerName = String(cuedSpeakerName || ctx?.name2 || '').trim();
        const starName = star?.name || ctx?.name1 || '';
        const room = resolveCompassFocusRoom(compass, {
          storage: this.storage,
          cuedSpeakerName,
          speakerName,
          starName,
        });
        if (!room) return '';
        const names = pickInjectionNames({
          starName,
          speakerName,
          cuedSpeakerName,
        });
        return buildCompassInjection(room, {
          ...names,
          compass,
          storage: this.storage,
          travel: doc.occupancy,
          lastLocationKey: doc.lastLocationKey,
        });
      },
    });
    registerWorldIndexInjection(this.injector, this.storage, {
      houseRoot: () => extension_settings.showtime ?? {},
      cellId: () => this._compassSelCell || '',
    });
    setTimeout(() => { this._runHouseSmokes(); }, 0);
  }

  _runHouseSmokes() {
    const smokeErr = smokeWorldIndexPure();
    if (smokeErr) console.warn('[Showtime/WorldIndex] smoke failed:', smokeErr);
    const auditSmoke = smokeCompassAuditPure();
    if (auditSmoke) console.warn('[Showtime/CompassAudit] smoke failed:', auditSmoke);
    const alignSmoke = smokeAlignSuiteContactPure();
    if (alignSmoke) console.warn('[Showtime/SuiteAlign] smoke failed:', alignSmoke);
    const suiteGlyphSmoke = smokeSuiteFloorplanGlyphs();
    if (suiteGlyphSmoke) console.warn('[Showtime/SuiteGlyphs] smoke failed:', suiteGlyphSmoke);
    const listingSmoke = smokeListingPure();
    if (listingSmoke) console.warn('[Showtime/Listing] smoke failed:', listingSmoke);
    const programSmoke = smokeRoomProgramPure();
    if (programSmoke) console.warn('[Showtime/RoomProgram] smoke failed:', programSmoke);
    const packSmoke = smokeSuitePackPure();
    if (packSmoke) console.warn('[Showtime/SuitePack] smoke failed:', packSmoke);
    const builderSmoke = smokeRoomBuilderPure();
    if (builderSmoke) console.warn('[Showtime/RoomBuilder] smoke failed:', builderSmoke);
    const dresserSmoke = smokeRoomDresserPure();
    if (dresserSmoke) console.warn('[Showtime/RoomDresser] smoke failed:', dresserSmoke);
    const accessSmoke = smokeOpeningAccessPure();
    if (accessSmoke) console.warn('[Showtime/OpeningAccess] smoke failed:', accessSmoke);
    const fixtureBindSmoke = smokeAutoBindFixtureWallPure();
    if (fixtureBindSmoke) console.warn('[Showtime/FixtureBind] smoke failed:', fixtureBindSmoke);
    const locDeltaSmoke = smokeLocationDeltaPure();
    if (locDeltaSmoke) console.warn('[Showtime/LocationDelta] smoke failed:', locDeltaSmoke);
    const restoreSmoke = smokeSuiteWallRestorePure();
    if (restoreSmoke) console.warn('[Showtime/SuiteRestore] smoke failed:', restoreSmoke);
    const occSmoke = smokeSyncOccupancyRoomPure();
    if (occSmoke) console.warn('[Showtime/OccupancyRoom] smoke failed:', occSmoke);
    const jsonSmoke = smokeJsonExtractPure();
    if (jsonSmoke) console.warn('[Showtime/JsonExtract] smoke failed:', jsonSmoke);
    const locSmoke = smokeSceneLocationPure();
    if (locSmoke) console.warn('[Showtime/SceneLocation] smoke failed:', locSmoke);
    const placeOptsSmoke = smokeCompassPlaceOptionsPure();
    if (placeOptsSmoke) console.warn('[Showtime/PlaceOptions] smoke failed:', placeOptsSmoke);
    const cueSmoke = smokeChatTrackCuePure();
    if (cueSmoke) console.warn('[Showtime/ChatCues] smoke failed:', cueSmoke);
    const slateSmoke = smokeChatSlatePure();
    if (slateSmoke) console.warn('[Showtime/ChatSlate] smoke failed:', slateSmoke);
    const bgSmoke = smokeBackgroundPickPure();
    if (bgSmoke) console.warn('[Showtime/BackgroundPick] smoke failed:', bgSmoke);
    const wxSmoke = smokeOverlayWxPure();
    if (wxSmoke) console.warn('[Showtime/WeatherOverlay] smoke failed:', wxSmoke);
    const sonarLocSmoke = smokeSonarLocationPure();
    if (sonarLocSmoke) console.warn('[Showtime/SonarLocation] smoke failed:', sonarLocSmoke);
    const poseSmoke = smokeRotateCellForPose();
    if (poseSmoke) console.warn('[Showtime/PoseCells] smoke failed:', poseSmoke);
    const tagSmoke = smokePlaceKeyCollisionPure();
    if (tagSmoke) console.warn('[Showtime/PlaceKeyCollision] smoke failed:', tagSmoke);
    const sonarPresenceSmoke = smokeSonarPresencePure();
    if (sonarPresenceSmoke) console.warn('[Showtime/SonarPresence] smoke failed:', sonarPresenceSmoke);
    const calSmoke = smokeCalendarShiftPure();
    if (calSmoke) console.warn('[Showtime/CalendarShift] smoke failed:', calSmoke);
    const reelSmoke = smokeReelSanitizePure() || smokeReelNamePure();
    if (reelSmoke) console.warn('[Showtime/ReelSanitize] smoke failed:', reelSmoke);
    const receiptSmoke = smokeItemLocatorPure() || smokeTravelStatePure() || smokeReceiptPure();
    if (receiptSmoke) console.warn('[Showtime/Receipt] smoke failed:', receiptSmoke);
    const nowSmoke = smokeNowSidecarPure();
    if (nowSmoke) console.warn('[Showtime/NowSidecar] smoke failed:', nowSmoke);
    const visitSmoke = smokeVisitMemoryPure();
    if (visitSmoke) console.warn('[Showtime/VisitMemory] smoke failed:', visitSmoke);
    const presenceSmoke = smokeCastPresencePure();
    if (presenceSmoke) console.warn('[Showtime/CastPresence] smoke failed:', presenceSmoke);
    const healthSmoke = smokeHouseHealthPure();
    if (healthSmoke) console.warn('[Showtime/HouseHealth] smoke failed:', healthSmoke);
  }

  _reelPackOpts() {
    const root = this.container;
    return {
      portraits: !!root.querySelector('[data-reel-portraits]')?.checked,
      characterCards: !!root.querySelector('[data-reel-cards]')?.checked,
      relink: !!root.querySelector('[data-reel-relink]')?.checked,
      lorebooks: !!root.querySelector('[data-reel-lore]')?.checked,
      allLorebooks: !!root.querySelector('[data-reel-lore-all]')?.checked,
      leaveStar: !!root.querySelector('[data-reel-leave-star]')?.checked,
    };
  }

  _maybeStripStar(payload) {
    if (!this._reelPackOpts().leaveStar || !payload?.chat) return payload;
    const star = getStarMember(this.storage);
    stripStarFromReel(payload.chat, star ? { id: star.id, name: star.name } : null);
    return payload;
  }

  _productionTitle() {
    return clipReelTitle(this._db().production?.title);
  }

  _reelShelfHtml() {
    const sort = this._reelSort === 'title' ? 'title' : 'newest';
    const rows = [...listReelCatalog(extension_settings)].sort((a, b) => (
      sort === 'title'
        ? String(a.title || a.file).localeCompare(String(b.title || b.file))
        : (Number(b.at) || 0) - (Number(a.at) || 0)
    ));
    const items = rows.length
      ? rows.map(r => `<div class="bst-row">
          <span class="bst-k">${esc(r.title || r.file)} · ${esc(r.at ? new Date(r.at).toLocaleString() : r.file)}</span>
          <button type="button" class="bst-btn" data-action="reel-open" data-file="${esc(r.file)}">Open</button>
          <button type="button" class="bst-btn" data-action="reel-download" data-file="${esc(r.file)}">Copy</button>
          <button type="button" class="bst-btn" data-action="reel-delete" data-file="${esc(r.file)}">Delete</button>
        </div>`).join('')
      : '<p class="bst-hint">Exported reels land here, in your user files folder, under names starting with showtime-reel-.</p>';
    return `<div class="bst-field"><span>Reel shelf</span>
      <div class="bst-row">
        <button type="button" class="bst-btn${sort === 'newest' ? ' gold' : ''}" data-action="reel-sort" data-sort="newest">Newest</button>
        <button type="button" class="bst-btn${sort === 'title' ? ' gold' : ''}" data-action="reel-sort" data-sort="title">Title</button>
      </div>
      ${items}
    </div>`;
  }

  _shelfReel(file) {
    return listReelCatalog(extension_settings).find(r => r.file === file) || null;
  }

  async _readShelfReel(file) {
    const row = this._shelfReel(file);
    if (!row?.path) throw new Error('missing reel');
    const res = await fetch(row.path, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`read ${res.status}`);
    return { row, text: await res.text() };
  }

  async _openShelfReel(file) {
    try {
      const { text } = await this._readShelfReel(file);
      const blob = new Blob([text], { type: 'application/json' });
      await this._importProduction(new File([blob], file || 'reel.json', { type: 'application/json' }));
    } catch (err) {
      console.error('[Backstage] reel open', err);
      void showtimeAlert('Could not open that reel.', { title: 'REEL SHELF', danger: true });
    }
  }

  async _downloadShelfReel(file) {
    try {
      const { row, text } = await this._readShelfReel(file);
      downloadJson(row.file, JSON.parse(text));
    } catch (err) {
      console.error('[Backstage] reel copy', err);
      void showtimeAlert('Could not copy that reel.', { title: 'REEL SHELF', danger: true });
    }
  }

  async _deleteShelfReel(file) {
    const row = this._shelfReel(file);
    if (!row) return;
    if (!await showtimeConfirm(`Remove ${row.title || row.file} from the shelf?`, { title: 'REMOVE REEL', danger: true, confirmLabel: 'Remove' })) return;
    try {
      await deleteReelUserFile(row.path);
    } catch (err) {
      console.error('[Backstage] reel delete', err);
      void showtimeAlert('Could not delete that reel file.', { title: 'REEL SHELF', danger: true });
      return;
    }
    forgetReel(extension_settings, row.file);
    saveSettingsDebounced();
    this.render(this.container);
  }

  _attachAffiliations(payload) {
    const live = {
      cast: this.storage.getChat('cast', { characters: [] }),
      reputation: this.storage.getChat('reputation', { house: [], personal: [] }),
    };
    const packed = packReelAffiliations(live);
    if (packed) payload.affiliations = packed;
    if (payload?.chat) stampCastAffiliations(payload.chat, packed);
    return payload;
  }

  async _handOffReel(payload, { backstage = false } = {}) {
    const title = clipReelTitle(payload?.title);
    const hash = reelHash(payload);
    const last = this._db().production?.lastReel;
    if (last?.hash && last.hash === hash) {
      const file = last.file || title || 'this reel';
      if (!await showtimeConfirm(`Already exported as ${file}. Export another copy?`, { title: 'EXPORT REEL', confirmLabel: 'Export' })) return;
    }
    const filename = reelFilename(title, stamp(), { backstage });
    let saved = null;
    try {
      saved = await saveReelToUserFiles(filename, payload);
    } catch (err) {
      console.error('[Backstage] reel shelf', err);
      downloadJson(filename, payload);
      void showtimeAlert('The reel shelf could not store that file. A copy was downloaded instead.', { title: 'EXPORT REEL' });
    }
    const prod = this._db().production;
    prod.lastReel = { title, file: filename, at: Date.now(), hash };
    this.saveState();
    if (saved) {
      rememberReel(extension_settings, {
        title: title || filename,
        file: filename,
        path: saved.path,
        at: prod.lastReel.at,
        hash,
      });
      saveSettingsDebounced();
    }
    const label = title || filename;
    this.bus?.emit('showtime.notice', {
      kind: 'inventory',
      items: [{ text: saved ? `Reel filed · ${label}` : `Reel downloaded · ${label}`, mark: '!' }],
    });
    this.render(this.container);
  }

  async _exportProduction() {
    try {
      const opts = this._reelPackOpts();
      const extras = await collectReelExtras(this.storage, opts);
      const payload = this._attachAffiliations(decorateReel(this._maybeStripStar(this.storage.exportProduction()), extras, {
        title: this._productionTitle(),
      }));
      this._handOffReel(payload);
    } catch (err) {
      console.error('[Backstage] reel export', err);
      void showtimeAlert('Reel export failed.', { title: 'EXPORT REEL', danger: true });
    }
  }

  async _exportSelected() {
    try {
      const mods = [...this.container.querySelectorAll('[data-export-mod]:checked')]
        .map(el => el.getAttribute('data-export-mod'));
      const includeGlobal = !!this.container.querySelector('[data-export-global]')?.checked;
      if (!mods.length && !includeGlobal) {
        void showtimeAlert('Check at least one tab (or global settings).', { title: 'EXPORT REEL' });
        return;
      }
      const opts = this._reelPackOpts();
      const extras = await collectReelExtras(this.storage, opts);
      const payload = this._attachAffiliations(decorateReel(this._maybeStripStar(this.storage.exportSlice({
        chatModules: mods,
        includeGlobal,
      })), extras, { title: this._productionTitle() }));
      this._handOffReel(payload);
    } catch (err) {
      console.error('[Backstage] reel slice', err);
      void showtimeAlert('Reel export failed.', { title: 'EXPORT REEL', danger: true });
    }
  }

  _exportBackstageChat() {
    const payload = this._attachAffiliations(decorateReel(this._maybeStripStar({
      _showtimeBackstage: true,
      chat: structuredClone(this._db()),
    }), null, { title: this._productionTitle() }));
    this._handOffReel(payload, { backstage: true });
  }

  async _importProduction(file) {
    try {
      const keptTitle = clipReelTitle(this._db().production?.title);
      const text = await file.text();
      const payload = sanitizeReelPayload(JSON.parse(text));
      const merge = !!this.container.querySelector('[data-import-merge]')?.checked;
      const importGlobal = !!this.container.querySelector('[data-import-global]')?.checked;
      const chatModules = [...this.container.querySelectorAll('[data-import-mod]:checked')]
        .map(el => el.getAttribute('data-import-mod'));
      const importCards = !!this.container.querySelector('[data-import-cards]')?.checked;
      const importLore = !!this.container.querySelector('[data-import-lore]')?.checked;

      if (!isReelPayload(payload) && !payload._showtime && !payload._showtimeBackstage) {
        void showtimeAlert('Not a Showtime Reel.', { title: 'IMPORT REEL', danger: true });
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
        void showtimeAlert('Not a Showtime Reel.', { title: 'IMPORT REEL', danger: true });
        return;
      }

      applyReelAffiliations(this.storage._root(), payload);
      this.storage.saveChat();
      const extraNotes = await importReelExtras(this.storage, payload.extras, { importCards, importLore });
      const prod = this._db().production;
      if (prod) {
        if (keptTitle) prod.title = keptTitle;
        else if (!clipReelTitle(prod.title)) {
          const incoming = clipReelTitle(payload.title);
          if (incoming) prod.title = incoming;
        }
        this.saveState();
      }
      const extraBit = extraNotes.length ? ` · ${extraNotes.join(', ')}` : '';
      emitShowtimeNotice(this.bus, {
        kind: 'house',
        text: (merge || payload._slice)
          ? `Reel imported into selected tabs${extraBit}`
          : `Reel imported${extraBit}`,
        mark: '+',
      });
      this.render(this.container);
      this.bus?.emit('showtime.stateChanged');
    } catch (err) {
      console.error('[Backstage] reel import', err);
      void showtimeAlert('Reel import failed.', { title: 'IMPORT REEL', danger: true });
    } finally {
      const input = this.container.querySelector('[data-role="import-file"]');
      if (input) input.value = '';
    }
  }

  async _wipe() {
    const target = this.container.querySelector('[data-role="wipe-target"]')?.value;
    if (!target) { void showtimeAlert('Pick something to wipe.', { title: 'WIPE DATA' }); return; }
    if (!await showtimeConfirm(`Wipe “${target}”? This cannot be undone.`, { title: 'WIPE DATA', danger: true, confirmLabel: 'Wipe' })) return;
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
    g.profiles = hydrateProfileMap(g.profiles);
    for (const id of PROFILE_SLOT_IDS) {
      const el = this.container.querySelector(`[data-g="profile-${id}"]`);
      if (el) g.profiles[id] = String(el.value || '');
    }
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

  _normalizeProfileBag(bag) {
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
  }

  _listProfilesLocal() {
    const ctx = getContext?.() || {};
    const candidates = [
      extension_settings?.connectionManager?.profiles,
      ctx.extensionSettings?.connectionManager?.profiles,
      extension_settings?.connection_profiles,
      extension_settings?.connectionProfiles,
      window.connectionManager?.profiles,
      window.connection_manager?.profiles,
    ];
    for (const bag of candidates) {
      const list = this._normalizeProfileBag(bag);
      if (list?.length) return list;
    }
    const scriptProfiles = window.Showtime?.modules?.get('script')?._profiles;
    if (Array.isArray(scriptProfiles) && scriptProfiles.length) return scriptProfiles;
    return [];
  }

  async _findProfiles(rawSettings = null) {
    const local = this._listProfilesLocal();
    if (local.length && !rawSettings) return local;
    if (this._profilesFetching && !rawSettings) return local;
    let raw = rawSettings;
    if (!raw) {
      this._profilesFetching = true;
      try {
        const res = await fetch('/api/settings/get', {
          method: 'POST',
          headers: getRequestHeaders(),
          body: JSON.stringify({}),
        });
        if (res.ok) raw = await res.json();
      } catch {
        raw = null;
      } finally {
        this._profilesFetching = false;
      }
    }

    const candidates = [
      raw?.connectionManager?.profiles,
      raw?.connection_manager?.profiles,
      raw?.settings?.connectionManager?.profiles,
      raw?.extension_settings?.connectionManager?.profiles,
      raw?.connection_profiles,
      raw?.connectionProfiles,
      raw?.api_connection_profiles,
    ];

    for (const bag of candidates) {
      const list = this._normalizeProfileBag(bag);
      if (list?.length) return list;
    }

    return local;
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
