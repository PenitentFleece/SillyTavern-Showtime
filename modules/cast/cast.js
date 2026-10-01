// Cast Module — priorities (incl. Director), item descriptions + conditions, character stats.
import { getContext } from '../../../../../extensions.js';
import { power_user } from '../../../../../power-user.js';
import { user_avatar } from '../../../../../personas.js';
import { Module } from '../../lib/module.js';
import {
  PRIORITIES, PRIORITY_MAP, DIRECTION_FIELDS, ensureDirectorDirection,
  priorityMeta,
  formatDirectorPromptBlock, resolveCastPromptIdentity, directorKeywords,
  normalizeAliases, resolveChatSpeaker, castDisplayName, castNameMatches,
  PRONOUN_APPARENT_OPTIONS, PRONOUN_PREFERRED_OPTIONS,
  normalizePronouns, formatPronounsPromptLine,
  normalizePlotHook, priorityColor,
  getCastRecords,
} from '../../lib/castCatalog.js';
import {
  isAspectEvolutiaAvailable,
  pullEvolutiaDescription,
  pullEvolutiaPersona,
  resolveCardDescription,
  resolvePersonaDescription,
  listAlterEgos,
  getCardEvolutiaState,
  getPersonaEvolutiaState,
} from '../../lib/aspectBridge.js';
import {
  eventSource,
  event_types,
  getThumbnailUrl,
  updateMessageBlock,
  saveChatDebounced,
} from '../../../../../../script.js';
import { withShowtimeProfile } from '../../lib/connectionProfile.js';
import { schemaAllowed, leanQuietGenerate, smokeIsolatedGenPure, FILING_RESPONSE_LENGTH } from '../../lib/isolatedGen.js';
import { bindStarAbsentPersonaGate } from '../../lib/starAbsent.js';
import {
  EVENT_MODES,
  DIRECTOR_TAG_FACETS,
  mergeDirectorSources,
  listDirectorInjectPools,
  smokeDirectorInjectPure,
} from '../../lib/directorEvent.js';
import { applyDifficultyToStat, difficultyAuditHint } from '../../lib/trackersConfig.js';
import { registerCastCueCommand, buildCastCuePrompt, resolveCueGenerationTarget, clipCueToPov, cueOtherNames, smokeCuePovPure } from '../../lib/castCue.js';
import { inPlayMemberIds, clipText, compactStatusCueInject, recentPlayMessages, playMessagesSince } from '../../lib/chatTrack.js';
import { standingToward, standingMeterStyle, characterHouseIds } from '../../lib/motivationCatalog.js';
import { parseJsonArray, parseJsonObject } from '../../lib/jsonExtract.js';
import { buildCueTakePrompt, applyCueTake, cueTakeWorthFiling, CUE_TAKE_SCHEMA, smokeCueTakePure } from '../../lib/cueTake.js';
import {
  sceneExcerpt,
  sceneKitHay,
  kitSnapshot,
  cadenceIncludeSet,
  auditIncludeForKind,
  buildCastDeltaPrompt,
  castDeltaSchema,
  parseCastDelta,
  applyCastDelta,
  buildCastDressPrompt,
  castDressSchema,
  parseCastDress,
  resolveTrackerId,
  clampItemCondition,
  collectKnownKitEntries,
  formatKnownKitRoster,
  clipExcerptToLines,
  smokeCastDeltaPure,
  KIT_SCENE_CAP,
  KIT_LINE_CAP,
} from '../../lib/castAudit.js';
import { formatPacksForPrompt } from '../../lib/invAmount.js';
import {
  inferKitKind, kitChildren, kitDescendantIds, kitRoots, formatCarryBrief, smokeKitNestPure,
} from '../../lib/kitNest.js';
import { getSceneCards } from '../../lib/scriptCatalog.js';
import {
  ensureCompass,
  getActiveRoom,
  listLostAndFound,
  removeFromLostAndFound,
  pickupItem,
  addToLostAndFound,
} from '../../lib/compass/state.js';
import { listAllSetPieces } from '../../lib/compass/schema.js';
import {
  syncBeatFromHook,
  pullBeatAsHook,
  unlinkHook,
  listPullableBeats,
  hookSceneLabel,
  hookBoardHint,
} from '../../lib/plotHookBridge.js';
const STATS_ELIGIBLE = new Set(['star', 'lead', 'major', 'foil']);
const UNIQUE_ROLES = {
  director: { demoteTo: 'major' },
  star: { demoteTo: 'lead' },
};

const STAT_DEFS = {
  base: [
    {
      id: 'health', label: 'Health', color: '#7a1f1f', direction: 'up',
      auditHint: 'injury, blood, pain, illness lower this; treatment raises it',
      thresholds: [
        { at: 15,  label: 'Dying' },
        { at: 30,  label: 'Critical' },
        { at: 50,  label: 'Wounded' },
        { at: 70,  label: 'Injured' },
        { at: 85,  label: 'Hurt' },
        { at: 95,  label: 'Uncomfortable' },
        { at: 101, label: 'Healthy' },
      ],
    },
    {
      id: 'energy', label: 'Energy', color: '#c9a24a', direction: 'up',
      auditHint: 'exertion and sleeplessness lower this; rest raises it',
      thresholds: [
        { at: 20,  label: 'Exhausted' },
        { at: 50,  label: 'Drained' },
        { at: 80,  label: 'Tired' },
        { at: 95,  label: 'Rested' },
        { at: 101, label: 'Energized' },
      ],
    },
  ],
  hard: [
    {
      id: 'hunger', label: 'Satiety', color: '#a86b2b', direction: 'up', group: 'Satiation',
      auditHint: 'this is fullness, NOT hunger pangs — eating RAISES it; skipping meals LOWERS it',
      thresholds: [
        { at: 25,  label: 'Starving' },
        { at: 60,  label: 'Hungry' },
        { at: 80,  label: 'Peckish' },
        { at: 95,  label: 'Full' },
        { at: 101, label: 'Sated' },
      ],
    },
    {
      id: 'thirst', label: 'Hydration', color: '#4a7fa8', direction: 'up', group: 'Satiation',
      auditHint: 'this is hydration — drinking RAISES it; going thirsty LOWERS it',
      thresholds: [
        { at: 25,  label: 'Dehydrated' },
        { at: 60,  label: 'Parched' },
        { at: 80,  label: 'Thirsty' },
        { at: 95,  label: 'Content' },
        { at: 101, label: 'Slaked' },
      ],
    },
    {
      id: 'bathroom', label: 'Bladder', direction: 'down', group: 'Needs',
      auditHint: 'bladder pressure — needing to pee RAISES this; relieving LOWERS it toward 0',
      thresholds: [
        { at: 40,  label: 'Empty' },
        { at: 70,  label: 'Comfortable' },
        { at: 85,  label: 'Pressing' },
        { at: 95,  label: 'Urgent' },
        { at: 101, label: 'Bursting' },
      ],
    },
    {
      id: 'hygiene', label: 'Odor', direction: 'down', group: 'Needs',
      auditHint: 'body odor — sweat, dirt, mess RAISE this; washing or clean clothes LOWER it toward 0',
      thresholds: [
        { at: 40,  label: 'Fresh' },
        { at: 65,  label: 'Musty' },
        { at: 85,  label: 'Rank' },
        { at: 95,  label: 'Foul' },
        { at: 101, label: 'Reeking' },
      ],
    },
  ],
};

const ALL_STAT_DEFS = [...STAT_DEFS.base, ...STAT_DEFS.hard];
const THRESHOLD_NOTIFY_STATS = new Set(['bathroom', 'hygiene']);

const DEFAULT_STATS = () => ({
  enabled: false,
  hardMode: false,
  health: 100,
  energy: 100,
  hunger: 100,
  thirst: 100,
  bathroom: 0,
  hygiene: 0,
});

function stateLabel(def, val) {
  if (def.levelMode === 'none') return '';
  if (def.levelMode === 'amount') return String(val);
  const t = def.thresholds ?? [];
  for (let i = 0; i < t.length; i++) {
    if (val < t[i].at) return t[Math.max(0, i)].label;
  }
  return t[t.length - 1]?.label ?? '';
}

function customBarDefsFromTrackers(storage) {
  try {
    const bars = storage.getChat('backstage', {})?.trackers?.status?.customBars;
    if (!Array.isArray(bars)) return [];
    return bars.map(b => {
      try {
        const levels = Array.isArray(b?.levels) ? b.levels : [];
        return {
          id: String(b.id || ''),
          label: String(b.name || 'Custom'),
          color: b.color || '#6a8a4a',
          direction: b.direction === 'down' ? 'down' : 'up',
          levelMode: ['none', 'label', 'amount'].includes(b.levelMode) ? b.levelMode : 'label',
          description: String(b.description || ''),
          thresholds: levels.map(lv => ({
            at: Number(lv?.at) || 0,
            label: String(lv?.label || ''),
          })).concat([{ at: 101, label: levels.slice(-1)[0]?.label || '' }]),
          custom: true,
        };
      } catch {
        return null;
      }
    }).filter(d => d && d.id);
  } catch {
    return [];
  }
}

function statusTrackingMasterOn(storage) {
  try {
    return storage.getChat('backstage', {})?.trackers?.status?.enabled !== false;
  } catch {
    return true;
  }
}

const PRESENCE = {
  inPlay: { id: 'inPlay', label: 'In play', title: 'In play — tracked' },
  absent: { id: 'absent', label: 'Absent', title: 'Absent this scene — not tracked' },
  writtenOut: { id: 'writtenOut', label: 'Written out', title: 'Written out — hidden, not tracked' },
};
const PRESENCE_ORDER = ['inPlay', 'absent', 'writtenOut'];
const PRESENCE_FILTERS = [
  { id: 'inPlay', label: 'In play' },
  { id: 'absent', label: 'Absent' },
  { id: 'writtenOut', label: 'Written out' },
];
const DEFAULT_HIDDEN_PRESENCE = ['absent', 'writtenOut'];

function normalizePresence(char) {
  if (!char) return 'inPlay';
  const v = String(char.presence || 'inPlay');
  if (char.priority === 'star') return v === 'absent' ? 'absent' : 'inPlay';
  return PRESENCE[v] ? v : 'inPlay';
}

const CONDITIONS = [
  { id: 'pristine', label: 'Pristine', color: '#6b8f4a' },
  { id: 'fine',     label: 'Fine',     color: '#7a9e52' },
  { id: 'worn',     label: 'Worn',     color: '#8a9a4a' },
  { id: 'damaged',  label: 'Damaged',  color: '#c9a24a' },
  { id: 'broken',   label: 'Broken',   color: '#c4772b' },
  { id: 'ruined',   label: 'Ruined',   color: '#7a1f1f' },
];
const CONDITION_MAP = Object.fromEntries(CONDITIONS.map(c => [c.id, c]));


export class CastModule extends Module {
  static id = 'cast';
  static label = 'Cast';
  static scope = 'chat';

  // ─── lifecycle ───────────────────────────────────────────────────────────────

  async init() {
    const href = new URL('./cast.css', import.meta.url).href;
    if (!document.querySelector(`link[data-showtime="cast"]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.dataset.showtime = 'cast';
      document.head.appendChild(link);
    }
    this._expandedIds = new Set();
    this._openKitBoxes = new Set();
    this._pendingStatAlert = null;
    this._pendingCue = null;
    this._pendingCueText = '';
    this._cueTakeBusy = false;
    this._auditBusy = false;
    this._auditLastAt = 0;
    this._statusLastCount = 0;
    this._statusTrackPrimed = false;
    this._statAlertArmed = false;
    this._statAlertClearOnEnd = false;
    this._resetStatusTrackCursor();

    registerCastCueCommand(this);

    const auditSmoke = smokeCastDeltaPure() || smokeIsolatedGenPure() || smokeDirectorInjectPure()
      || smokeCuePovPure() || smokeCueTakePure() || smokeKitNestPure();
    if (auditSmoke) console.warn('[Showtime/CastAudit] smoke failed:', auditSmoke);

    bindStarAbsentPersonaGate(this.storage);

    this.bus?.on('cast.playDirectorEvent', ({ castId, text } = {}) => {
      const char = (this.state?.characters || []).find(c => c.id === castId)
        || getCastRecords(this.storage).find(c => c.id === castId);
      if (!char) {
        alert('Pick a cast member to play this event.');
        return;
      }
      this.cueCast(char, { directorBeat: text }).catch(err => {
        console.warn('[Cast director play]', err);
        alert(`Play failed: ${err?.message || err}`);
      });
    });

    // Drop a one-shot threshold note only after a later generation has had a
    // chance to include it. Audits now run after send, so the in-flight reply
    // never saw the note — clearing on that render would swallow it.
    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, (messageId) => {
      if (this._statAlertClearOnEnd && this._pendingStatAlert) {
        this._pendingStatAlert = null;
        this._statAlertArmed = false;
        this._statAlertClearOnEnd = false;
        this.bus.emit('showtime.stateChanged');
      }
      this._stampCueMessage(messageId);
      this._applyChatDisplayName(messageId);
    });
    eventSource.on(event_types.MESSAGE_RECEIVED, (messageId) => {
      this._applyChatDisplayName(messageId, { silent: true });
    });
    // Commit the last AI reply only when the user keeps it by sending again.
    // Swipes / regenerations fire MESSAGE_RECEIVED without growing the chat,
    // and would otherwise stack tracker movement on discarded drafts.
    eventSource.on(event_types.MESSAGE_SENT, () => {
      this._scheduleStatusTrack();
    });
    eventSource.on(event_types.MESSAGE_SWIPED, () => {
      clearTimeout(this._statusTrackTimer);
    });
    eventSource.on(event_types.GENERATION_STARTED, (type, _opts, dryRun) => {
      if (type === 'swipe' || type === 'continue' || type === 'append') {
        clearTimeout(this._statusTrackTimer);
      }
      if (dryRun || type === 'quiet' || type === 'swipe' || type === 'continue' || type === 'append') return;
      if (this._statAlertArmed && this._pendingStatAlert) this._statAlertClearOnEnd = true;
    });

    this._registerInjections();
    this.bus?.on('trackers.updated', () => {
      if (this.container) this._renderList();
    });
    this.bus?.on('motivation.updated', () => {
      if (this.container) this._renderList();
    });
  }

  /**
   * If a cast member's Showtime name (or Director → Reply as) differs from the
   * ST card name, rewrite the chat bubble so it shows as the cast identity.
   */
  _applyChatDisplayName(messageId, { silent = false } = {}) {
    try {
      const ctx = getContext();
      const chat = ctx.chat;
      const idx = Number(messageId);
      if (!Number.isFinite(idx) || !chat?.[idx]) return;
      const mes = chat[idx];
      if (mes.is_user || mes.is_system) return;

      const extraId = String(mes.extra?.showtimeCastId || '').trim();
      const avatar = String(mes.original_avatar || '').trim();
      const speaker = (extraId && this._find(extraId))
        || resolveChatSpeaker(this.storage, {
          avatar,
          spokenName: mes.name || '',
        });
      if (!speaker) return;

      const wantName = castDisplayName(speaker);
      if (!wantName || wantName === String(mes.name || '').trim()) return;

      mes.name = wantName;
      if (speaker.portrait) {
        mes.force_avatar = speaker.portrait;
      } else if (speaker.characterCardId && speaker.characterCardId !== avatar) {
        mes.force_avatar = getThumbnailUrl('avatar', speaker.characterCardId);
        mes.original_avatar = speaker.characterCardId;
      }

      mes.extra = mes.extra && typeof mes.extra === 'object' ? mes.extra : {};
      mes.extra.showtimeCastId = speaker.id;

      if (!silent) {
        try {
          updateMessageBlock(idx, mes, { rerenderMessage: false });
        } catch { /* ignore */ }
        const root = document.querySelector(`#chat .mes[mesid="${idx}"]`);
        const nameEl = root?.querySelector('.name_text');
        if (nameEl) nameEl.textContent = wantName;
        const face = root?.querySelector('.avatar img');
        if (face && mes.force_avatar) face.setAttribute('src', mes.force_avatar);
      }
      saveChatDebounced();
    } catch (err) {
      console.warn('[Showtime Cast] chat display name', err);
    }
  }

  _cueOthers(char) {
    let extra = [];
    try {
      const n1 = getContext()?.name1;
      if (n1) extra.push(n1);
    } catch { /* ignore */ }
    return cueOtherNames(this.storage, char, extra);
  }

  _stampCueMessage(messageId) {
    const cue = this._pendingCue;
    if (!cue) return;
    let scene = '';
    try {
      const ctx = getContext();
      const idx = Number(messageId);
      const mes = ctx.chat?.[idx];
      if (!mes || mes.is_user || mes.is_system) return;
      const others = this._cueOthers(this._find(cue.id) || { id: cue.id, name: cue.name });
      const clipped = clipCueToPov(String(mes.mes || ''), { speaker: cue.name, others });
      if (clipped && clipped !== mes.mes) mes.mes = clipped;
      scene = String(mes.mes || '');
      mes.name = cue.name || mes.name;
      if (cue.portrait) mes.force_avatar = cue.portrait;
      if (cue.cardId) mes.original_avatar = cue.cardId;
      mes.extra = mes.extra && typeof mes.extra === 'object' ? mes.extra : {};
      mes.extra.showtimeCastId = cue.id;
      try { updateMessageBlock(idx, mes, { rerenderMessage: false }); } catch { /* ignore */ }
      const root = document.querySelector(`#chat .mes[mesid="${idx}"]`);
      const nameEl = root?.querySelector('.name_text');
      if (nameEl && cue.name) nameEl.textContent = cue.name;
      const face = root?.querySelector('.avatar img');
      if (face && mes.force_avatar) face.setAttribute('src', mes.force_avatar);
      saveChatDebounced();
    } catch (err) {
      console.warn('[Showtime Cast] cue stamp', err);
    } finally {
      this._pendingCue = null;
      this._pendingCueText = '';
      this.bus.emit('showtime.stateChanged');
    }
    if (cue.priority !== 'director' && scene.trim().length >= 40) {
      this._fileCueTakes(cue, scene).catch(err => console.warn('[Showtime Cast] cue take file', err));
    }
  }

  async _fileCueTakes(cue, scene) {
    if (this._cueTakeBusy || !cue?.id) return;
    const char = this._find(cue.id);
    if (!char || char.priority === 'director') return;
    if (!cueTakeWorthFiling(scene, { storage: this.storage, char })) return;
    this._cueTakeBusy = true;
    const chatToken = getContext()?.chatMetadata ?? null;
    try {
      const others = this._cueOthers(char);
      const prompt = buildCueTakePrompt({
        speaker: cue.name || char.name,
        others,
        scene,
        storage: this.storage,
        char,
      });
      const raw = await withShowtimeProfile(this.storage, 'audit', () =>
        leanQuietGenerate(prompt, {
          kind: 'filing',
          jsonSchema: CUE_TAKE_SCHEMA,
          responseLength: 1600,
        }));
      if ((getContext()?.chatMetadata ?? null) !== chatToken) return;
      const parsed = parseJsonObject(raw) || raw;
      const counts = applyCueTake(this.storage, char, parsed);
      if (counts.readings || counts.rumors || counts.secrets) {
        this.bus?.emit('reputation.updated', {});
        this.bus?.emit('motivation.updated', { characterId: char.id });
        this.bus?.emit('showtime.stateChanged');
      }
    } finally {
      this._cueTakeBusy = false;
    }
  }

  /**
   * Arm a one-shot prompt and generate the next reply as this cast member.
   * Group chats force the linked ST card (Director’s card if none is linked).
   */
  async cueCast(char, { directorBeat = '' } = {}) {
    if (!char || char.priority === 'star') {
      alert('Pick a cast member (not the Star).');
      return;
    }
    if (normalizePresence(char) === 'writtenOut') {
      alert('That cast member is written out. Mark them In play or Absent first.');
      return;
    }
    const ctx = getContext();
    const characters = ctx.characters ?? [];
    const target = resolveCueGenerationTarget(this.storage, char, {
      characters,
      characterId: ctx.characterId,
    });
    const inGroup = Boolean(ctx.groupId);
    const currentChid = Number.parseInt(ctx.characterId, 10);
    const canForce = inGroup && Number.isInteger(target.chid) && target.chid >= 0;
    const generatingAsTarget = canForce
      || (Number.isInteger(currentChid) && currentChid === target.chid);
    let cardDump = 'identity';
    if (char.priority === 'director') cardDump = 'director';
    else if (generatingAsTarget && target.source === 'card') cardDump = 'none';
    else if (!char.characterCardId && !char.personaId) cardDump = 'own';

    const display = this._resolveDisplay(char);
    this._pendingCue = {
      id: char.id,
      name: display.name,
      portrait: display.portrait || '',
      cardId: char.characterCardId || '',
      priority: char.priority || '',
    };
    const others = this._cueOthers(char);
    this._pendingCueText = buildCastCuePrompt(this.storage, char, {
      characters,
      personas: this._getPersonas(),
      cardDump,
      directorBeat,
      others,
    });
    this.bus.emit('showtime.stateChanged');
    const genOpts = {};
    if (canForce) genOpts.force_chid = target.chid;
    try {
      if (typeof ctx.Generate === 'function') await ctx.Generate('normal', genOpts);
      else if (typeof ctx.generate === 'function') await ctx.generate('normal', genOpts);
      else document.getElementById('send_but')?.click();
    } catch (err) {
      this._pendingCue = null;
      this._pendingCueText = '';
      this.bus.emit('showtime.stateChanged');
      throw err;
    }
  }

  _resetStatusTrackCursor() {
    const chat = getContext()?.chat || [];
    this._statusTrackPrimed = true;
    this._statusLastCount = chat.filter(m => m && !m.is_system).length;
    clearTimeout(this._statusTrackTimer);
  }

  _scheduleStatusTrack() {
    clearTimeout(this._statusTrackTimer);
    this._statusTrackTimer = setTimeout(() => {
      this._runCadenceKit().catch(err => console.warn('[Cast status track]', err));
    }, 1100);
  }

  async _runCadenceKit() {
    if (this._auditBusy) return;
    if (!statusTrackingMasterOn(this.storage)) return;
    let status = {};
    try { status = this.storage.getChat('backstage', {})?.trackers?.status || {}; } catch { return; }
    if (status.cadence === 'manual') return;
    const chat = getContext()?.chat || [];
    const n = chat.filter(m => m && !m.is_system).length;
    const every = status.cadence === 'per_post' ? 1 : Math.max(1, Number(status.everyN) || 4);
    if (!this._statusTrackPrimed) {
      this._statusTrackPrimed = true;
      this._statusLastCount = n;
      return;
    }
    const prev = this._statusLastCount || 0;
    if (n - prev < every) return;
    const chars = this._inPlayChars().filter(c => STATS_ELIGIBLE.has(c.priority));
    if (!chars.length) {
      this._statusLastCount = n;
      return;
    }
    this._statusLastCount = n;
    const windowText = playMessagesSince(chat, prev).map(m => String(m?.mes || '')).join('\n');
    const fakeBtn = { disabled: false, textContent: 'Audit', dataset: { quiet: '1' } };
    const batch = [];
    for (const char of chars.slice(0, 4)) {
      const include = cadenceIncludeSet(char, windowText, { statsEnabled: !!char.stats?.enabled });
      if (!include.length) continue;
      try {
        const out = await this._runAudit(char, 'kit', fakeBtn, { include, sinceCount: prev });
        if (out && (out.diffs?.length || out.condition || out.kit?.length)) batch.push({ char, ...out });
      } catch { /* ignore one failure */ }
    }
    this._announceStatusBatch(batch);
  }

  _announceStatusBatch(batch) {
    const items = [];
    const alerts = [];
    for (const row of batch || []) {
      const name = this._resolveDisplay(row.char).name || row.char.name || 'Cast';
      const isStar = row.char?.priority === 'star';
      for (const d of row.diffs || []) {
        const mode = d.levelMode || 'label';
        const flipped = !!(d.fromState && d.toState && d.fromState !== d.toState);
        if (!flipped) continue;
        if (THRESHOLD_NOTIFY_STATS.has(d.id)) {
          alerts.push(`[Note: ${name}'s ${d.label} is now ${d.toState}]`);
        }
        if (!isStar) continue;
        if (mode === 'none' || mode === 'amount') continue;
        items.push({
          name,
          label: d.label,
          fromState: d.fromState,
          toState: d.toState,
        });
      }
      if (!isStar) continue;
      for (const ch of row.kit || []) {
        if (ch.kind === 'condition') {
          items.push({ name, label: 'Condition', fromState: '', toState: ch.toCondition || 'updated' });
        } else if (ch.action === 'add') {
          items.push({ name, label: ch.name, fromState: '', toState: ch.kind === 'wardrobe' ? 'wearing' : 'carried' });
        } else if (ch.action === 'remove') {
          items.push({ name, label: ch.name, fromState: '', toState: 'removed' });
        } else if (ch.action === 'update') {
          items.push({ name, label: ch.name, fromState: ch.fromCondition || '', toState: ch.toCondition || 'updated' });
        }
      }
    }
    if (items.length) this.bus.emit('showtime.notice', { kind: 'status', items });
    if (alerts.length) {
      this._pendingStatAlert = alerts.join(' ');
      this._statAlertArmed = true;
      this._statAlertClearOnEnd = false;
      this.bus.emit('showtime.stateChanged');
    }
  }

  getDefaultState() {
    return { characters: [], sortBy: 'priority', filterQuery: '', hiddenRoles: [], hiddenPresence: [...DEFAULT_HIDDEN_PRESENCE] };
  }

  _hiddenRoles() {
    const raw = Array.isArray(this.state.hiddenRoles) ? this.state.hiddenRoles : [];
    const ids = new Set(PRIORITIES.map(p => p.id));
    return raw.map(r => String(r || '').toLowerCase()).filter(r => ids.has(r));
  }

  _hiddenPresence() {
    const ids = new Set(PRESENCE_ORDER);
    if (Array.isArray(this.state.hiddenPresence)) {
      return this.state.hiddenPresence.map(r => String(r || '')).filter(r => ids.has(r));
    }
    const view = String(this.state.presenceView || 'inPlay');
    if (view === 'all') return [];
    if (view === 'absent') return PRESENCE_ORDER.filter(x => x !== 'absent');
    if (view === 'writtenOut') return PRESENCE_ORDER.filter(x => x !== 'writtenOut');
    return [...DEFAULT_HIDDEN_PRESENCE];
  }

  /** Float a <details> popover body on document.body so overflow:hidden ancestors don't clip it. */
  _pinToolbarPop(details, bodySelector) {
    if (!details) return;
    const body = details.querySelector(bodySelector);
    if (!body) return;
    this._rolesPopCleanup?.(); // drop the previous render's document listener
    const place = () => {
      if (!details.open) {
        if (body.parentElement !== details) details.appendChild(body);
        body.style.position = '';
        body.style.top = '';
        body.style.right = '';
        body.style.left = '';
        body.style.zIndex = '';
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
    // stash so re-render can drop the old outside listener if needed
    details._castPopCleanup = () => {
      document.removeEventListener('pointerdown', onDoc, true);
      if (body.parentElement !== details) details.appendChild(body);
    };
    this._rolesPopCleanup = details._castPopCleanup;
  }

  async onChatChanged() {
    this._expandedIds = new Set();
    this._resetStatusTrackCursor();
    if (this.container) await this.render(this.container);
  }

  // ─── render ──────────────────────────────────────────────────────────────────

  async render(container) {
    this.container = container;
    const s = this.state;
    s.hiddenRoles = this._hiddenRoles();
    s.hiddenPresence = this._hiddenPresence();
    const hidden = new Set(s.hiddenRoles);
    const hideN = hidden.size;
    const hideP = s.hiddenPresence.length;
    const filterOn = hideN > 0 || hideP !== DEFAULT_HIDDEN_PRESENCE.length
      || s.hiddenPresence.some(id => !DEFAULT_HIDDEN_PRESENCE.includes(id));
    // Detach any previously portaled roles body before wiping the pane
    document.querySelectorAll('.cast-roles-pop-body').forEach(n => {
      if (n.parentElement === document.body) n.remove();
    });
    container.innerHTML = `
      <div class="cast-root">
      <div class="cast-toolbar">
        <input type="search" placeholder="Search cast..." value="${esc(s.filterQuery)}" data-role="filter">
        <select data-role="sort">
          <option value="priority" ${s.sortBy === 'priority' ? 'selected' : ''}>By Priority</option>
          <option value="name"     ${s.sortBy === 'name'     ? 'selected' : ''}>By Name</option>
          <option value="recent"   ${s.sortBy === 'recent'   ? 'selected' : ''}>By Recent</option>
        </select>
        <details class="cast-roles-pop" data-role="roles-pop">
          <summary class="cast-btn${filterOn ? ' cast-btn--active' : ''}" title="Hide roles or presence from the list">Filter</summary>
          <div class="cast-roles-pop-body">
            <p class="cast-filter-sec">Roles</p>
            <p class="cast-roles-hint">Uncheck a role to hide it from the list.</p>
            ${PRIORITIES.map(p => `
              <label class="cast-roles-opt">
                <input type="checkbox" data-role-hide="${esc(p.id)}" ${hidden.has(p.id) ? '' : 'checked'}>
                <span style="color:${esc(priorityMeta(p.id).color)}">${esc(p.label)}</span>
              </label>`).join('')}
            <p class="cast-filter-sec">Presence</p>
            <p class="cast-roles-hint">Uncheck to hide. In play only is the default.</p>
            ${PRESENCE_FILTERS.map(v => `
              <label class="cast-roles-opt">
                <input type="checkbox" data-presence-hide="${esc(v.id)}" ${s.hiddenPresence.includes(v.id) ? '' : 'checked'}>
                <span>${esc(v.label)}</span>
              </label>`).join('')}
            <button type="button" class="cast-btn" data-role="roles-show-all" ${filterOn ? '' : 'disabled'}>Show all</button>
          </div>
        </details>
        <button class="cast-btn" data-role="import" title="Import characters from current chat">+ From Chat</button>
        <button class="cast-btn" data-role="import-personas" title="Import from user personas">+ From Personas</button>
        <button class="cast-btn" data-role="add">+ Cast</button>
      </div>
      <div class="cast-list" data-role="list"></div>
      </div>
    `;
    container.querySelector('[data-role="filter"]').addEventListener('input', e => {
      this.state.filterQuery = e.target.value;
      this.saveState();
      this._renderList();
    });
    container.querySelector('[data-role="sort"]').addEventListener('change', e => {
      this.state.sortBy = e.target.value;
      this.saveState();
      this._renderList();
    });
    const rolesPop = container.querySelector('[data-role="roles-pop"]');
    const rolesBody = rolesPop?.querySelector('.cast-roles-pop-body');
    this._pinToolbarPop(rolesPop, '.cast-roles-pop-body');
    const syncRolesChrome = () => {
      const nextRoles = this._hiddenRoles();
      const nextPres = this._hiddenPresence();
      const n = nextRoles.length;
      const p = nextPres.length;
      const on = n > 0 || p !== DEFAULT_HIDDEN_PRESENCE.length
        || nextPres.some(id => !DEFAULT_HIDDEN_PRESENCE.includes(id));
      const sum = rolesPop?.querySelector('summary');
      if (sum) {
        sum.textContent = 'Filter';
        sum.classList.toggle('cast-btn--active', on);
      }
      const showAll = rolesBody?.querySelector('[data-role="roles-show-all"]');
      if (showAll) showAll.disabled = !on;
    };
    rolesBody?.addEventListener('change', e => {
      const roleInp = e.target.closest('[data-role-hide]');
      const presInp = e.target.closest('[data-presence-hide]');
      if (roleInp) {
        const id = roleInp.dataset.roleHide;
        const next = new Set(this._hiddenRoles());
        if (roleInp.checked) next.delete(id);
        else next.add(id);
        this.state.hiddenRoles = [...next];
      } else if (presInp) {
        const id = presInp.dataset.presenceHide;
        const next = new Set(this._hiddenPresence());
        if (presInp.checked) next.delete(id);
        else next.add(id);
        this.state.hiddenPresence = [...next];
      } else {
        return;
      }
      this.saveState();
      syncRolesChrome();
      this._renderList();
    });
    rolesBody?.querySelector('[data-role="roles-show-all"]')?.addEventListener('click', e => {
      e.preventDefault();
      this.state.hiddenRoles = [];
      this.state.hiddenPresence = [];
      this.saveState();
      this.render(this.container);
    });
    container.querySelector('[data-role="add"]').addEventListener('click', () => this._openCastingCall());
    container.querySelector('[data-role="import"]').addEventListener('click', () => this._openImportFromChat());
    container.querySelector('[data-role="import-personas"]').addEventListener('click', () => this._openImportFromPersonas());
    this._renderList();
  }

  _renderList() {
    const listEl = this.container.querySelector('[data-role="list"]');
    const items = this._sortedFiltered();
    if (!items.length) {
      const hasAny = (this.state.characters || []).length;
      listEl.innerHTML = hasAny
        ? `<div class="cast-empty">No one matches this view. Open Filter to show a role or presence.</div>`
        : `<div class="cast-empty">No cast members yet. Click <em>+ Cast</em> to add one.</div>`;
      return;
    }
    listEl.innerHTML = items.map(c => this._renderRow(c)).join('');
    this._bindRows(listEl);
  }

  _renderRow(c) {
    const p = priorityMeta(c.priority);
    const display = this._resolveDisplay(c);
    const presence = normalizePresence(c);
    const portrait = display.portrait
      ? `<img src="${esc(display.portrait)}" alt="">`
      : esc((display.name || '?').charAt(0).toUpperCase());
    const inScene = c.characterCardId && this._getInCurrentChat().has(c.characterCardId);
    const isExp = this._expandedIds.has(c.id);
    let standMeter = '';
    if (c.priority !== 'director' && c.priority !== 'star') {
      const stand = standingToward(this.storage, `cast:${c.id}`);
      if (stand != null) {
        const meter = standingMeterStyle(stand);
        standMeter = `<span class="cast-stand-meter" style="--stand-color:${esc(meter.color)};--stand-deg:${meter.deg}deg" title="Toward Star: ${esc(meter.label)}"></span>`;
      }
    }
    const cls = [
      'cast-row', c.priority, isExp && 'expanded',
      inScene && 'in-scene',
      presence === 'absent' && 'cast-absent',
      presence === 'writtenOut' && 'cast-written-out',
    ].filter(Boolean).join(' ');
    const presenceMeta = PRESENCE[presence];
    const presenceTitle = c.priority === 'star'
      ? (presence === 'absent'
        ? 'Absent — persona, profile, and Star card stay out of generation'
        : 'In play — persona injects as usual')
      : presenceMeta.title;
    const presenceBtn = c.priority !== 'director'
      ? `<button class="cast-btn small" data-action="presence" title="${esc(presenceTitle)}">${esc(presenceMeta.label)}</button>`
      : '';
    return `
      <div class="${cls}" data-id="${c.id}" style="border-left-color:${p.color}">
        <div class="cast-row-header">
          <div class="cast-row-portrait-wrap${standMeter ? ' has-stand' : ''}">${standMeter}<div class="cast-row-portrait">${portrait}</div></div>
          <div class="cast-row-main">
            <div class="cast-row-name">
              ${esc(display.name || 'Unnamed')}
              <span class="cast-row-badge" style="border-color:${p.color};color:${p.color}">${p.label}</span>
              ${c.characterCardId || c.personaId ? `<span class="cast-row-link" title="${c.personaId ? 'Linked to persona' : 'Linked to character card'}">${c.personaId ? '☆' : '⚭'}</span>` : ''}
              ${inScene ? `<span class="cast-row-scene" title="Present in current chat">●</span>` : ''}
              ${c.replyAsId ? `<span class="cast-row-link" title="Director replies as ${esc(this._find(c.replyAsId)?.name || 'cast')}">→</span>` : ''}
            </div>
            ${normalizeAliases(c.aliases).length
              ? `<div class="cast-row-aliases">${esc(normalizeAliases(c.aliases).join(' · '))}</div>`
              : ''}
            ${this._houseLabel(c.affiliationHouseId)
              ? `<div class="cast-row-affil">${esc(this._houseLabel(c.affiliationHouseId))}</div>`
              : ''}
          </div>
          <div class="cast-row-actions">
            ${presenceBtn}
            ${c.priority !== 'director' && c.priority !== 'star' && presence !== 'writtenOut' ? `<button class="cast-btn small gold" data-action="cue" title="Cue ${esc(display.name || 'them')} to speak">Cue</button>` : ''}
            <button class="cast-btn small" data-action="view">View</button>
            <button class="cast-btn small danger" data-action="delete">×</button>
          </div>
          ${p.hasDetails ? `<button class="cast-row-toggle" data-action="toggle" title="Details">${isExp ? '▾' : '▸'}</button>` : ''}
        </div>
        ${p.hasDetails && isExp ? this._renderDetails(c) : ''}
      </div>
    `;
  }

  _renderDetails(c) {
    if (c.priority === 'director') return this._renderDirectorDetails(c);
    return `
      <div class="cast-details">
        ${STATS_ELIGIBLE.has(c.priority) ? this._renderStats(c) : ''}
        <h4>${c.priority === 'star' ? 'Wardrobe <span class="cast-sync-tag">equipped</span>' : 'Wardrobe'} <button class="cast-audit" data-action="audit-wardrobe">Audit</button></h4>
        ${this._renderItems(c, 'wardrobe')}
        <button class="cast-item-add" data-action="add-wardrobe">+ Add wardrobe item</button>
        <h4>${c.priority === 'star' ? 'Props <span class="cast-sync-tag">on person</span>' : 'Props'} <button class="cast-audit" data-action="audit-props">Audit</button></h4>
        ${this._renderItems(c, 'props')}
        <button class="cast-item-add" data-action="add-prop">+ Add prop</button>
        <h4>Condition <button class="cast-audit" data-action="audit-condition">Audit</button></h4>
        <textarea class="cast-condition" data-action="condition"
          placeholder="Current state, mood, injuries, effects...">${esc(c.condition ?? '')}</textarea>
      </div>
    `;
  }

  /**
   * Live bio from a linked character card or persona.
   * Card/persona text is never editable in Showtime — edit the source instead.
   * @param {object|null} char
   * @param {{ source?: string, cardId?: string, personaId?: string, alterEgoId?: string }} [opts]
   */
  _liveBio(char = null, opts = {}) {
    const src = opts.source
      || (opts.personaId || char?.personaId ? 'persona'
        : (opts.cardId || char?.characterCardId ? 'card' : 'manual'));
    const pid = opts.personaId ?? char?.personaId ?? '';
    const cid = opts.cardId ?? char?.characterCardId ?? '';
    const egoId = opts.alterEgoId ?? char?.alterEgoId ?? '';

    if (src === 'persona' && pid) {
      const p = this._getPersonas().find(x => x.id === pid);
      const native = String(p?.description || '').trim();
      const pull = pullEvolutiaPersona(pid, { alterEgoId: egoId, native });
      const fields = [];
      if (pull.available && pull.fields.length) {
        for (const f of pull.fields) {
          fields.push({ name: f.name || 'Field', content: f.content });
        }
        if (!pull.swapEnabled && native
          && !pull.fields.some(f => f.content === native)) {
          fields.unshift({ name: 'Description', content: native });
        }
      } else if (native) {
        fields.push({ name: 'Description', content: native });
      }
      return {
        mode: 'persona',
        fields,
        text: resolvePersonaDescription(pid, native, {
          preferEvolutia: char?.preferEvolutia !== false,
          alterEgoId: egoId,
        }),
        sourceLabel: 'Persona',
        alterEgoId: pull.alterEgoId || '',
        alterEgoName: pull.alterEgoName || '',
        alterEgos: pull.alterEgos || listAlterEgos(getPersonaEvolutiaState(pid)),
        emptyHint: pull.available
          ? 'No Evolutia fields / persona description — edit under Personas or Aspect: Evolutia.'
          : 'No persona description yet — edit it under SillyTavern Personas.',
      };
    }

    if (src === 'card' && cid) {
      const st = (getContext().characters || []).find(x => x.avatar === cid) || null;
      const native = String(st?.description || '').trim();
      const pull = pullEvolutiaDescription(st, { alterEgoId: egoId });
      const fields = [];
      if (pull.available && pull.fields.length) {
        for (const f of pull.fields) {
          fields.push({ name: f.name || 'Field', content: f.content });
        }
        if (!pull.swapEnabled && native
          && !pull.fields.some(f => f.content === native)) {
          fields.unshift({ name: 'Description', content: native });
        }
      } else if (native) {
        fields.push({ name: 'Description', content: native });
      }
      return {
        mode: 'card',
        fields,
        text: resolveCardDescription(st, {
          preferEvolutia: char?.preferEvolutia !== false,
          alterEgoId: egoId,
        }),
        sourceLabel: 'Character card',
        alterEgoId: pull.alterEgoId || '',
        alterEgoName: pull.alterEgoName || '',
        alterEgos: pull.alterEgos || listAlterEgos(getCardEvolutiaState(st)),
        emptyHint: 'No description on this card — edit the character card in SillyTavern.',
      };
    }

    return {
      mode: 'manual',
      fields: [],
      text: String(char?.description || '').trim(),
      sourceLabel: '',
      alterEgoId: '',
      alterEgoName: '',
      alterEgos: [],
      emptyHint: '',
    };
  }

  _renderInfoBoxes(bio, { taggedAlterEgos = [], showEgoTags = false } = {}) {
    if (!bio || bio.mode === 'manual') return '';
    const where = bio.mode === 'persona' ? 'persona' : 'character card';
    const head = bio.alterEgoName
      ? `From ${bio.sourceLabel} · ${bio.alterEgoName}`
      : `From ${bio.sourceLabel}`;
    const tagged = new Set((taggedAlterEgos || []).map(String));
    const egoSelect = (bio.alterEgos?.length > 1 || (bio.alterEgos?.length === 1 && isAspectEvolutiaAvailable()))
      ? `
        <div class="cast-ego-row">
          <label class="cast-ego-label">Alter Ego</label>
          <select data-field="alterEgoId">
            ${bio.alterEgos.map(e =>
              `<option value="${esc(e.id)}" ${e.id === bio.alterEgoId ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}
          </select>
        </div>`
      : '';
    const egoTags = showEgoTags && bio.alterEgos?.length
      ? `
        <div class="cast-ego-tags">
          <div class="cast-info-meta">Tag alter egos for character credits — Script / chat tags matching a tagged ego pull that ego’s fields.</div>
          ${bio.alterEgos.map(e => `
            <label class="cast-ego-tag">
              <input type="checkbox" data-ego-tag="${esc(e.id)}" ${tagged.has(e.id) ? 'checked' : ''}>
              <span>${esc(e.name)}</span>
            </label>`).join('')}
        </div>`
      : '';
    if (!bio.fields.length) {
      return `
        <div class="cast-info-panel">
          <div class="cast-info-meta">${esc(head)} · read-only — edit on the ${where}</div>
          ${egoSelect}
          ${egoTags}
          <div class="cast-info-empty">${esc(bio.emptyHint || 'No information.')}</div>
        </div>`;
    }
    const boxes = bio.fields.map((f, i) => `
      <details class="cast-info-fold"${i === 0 ? ' open' : ''}>
        <summary class="cast-info-fold-sum">${esc(f.name || 'Info')}</summary>
        <div class="cast-info-box-body">${esc(f.content)}</div>
      </details>`).join('');
    return `
      <div class="cast-info-panel">
        <div class="cast-info-meta">${esc(head)} · read-only — edit on the ${where}</div>
        ${egoSelect}
        ${egoTags}
        ${boxes}
      </div>`;
  }

  _renderDirectorDetails(c) {
    const d = ensureDirectorDirection(c);
    const others = this.state.characters.filter(x => x.id !== c.id && x.priority !== 'director');
    const select = (fieldId) => {
      const field = DIRECTION_FIELDS[fieldId];
      return `
        <label class="cast-dir-field">
          <span>${field.label}</span>
          <select data-dir="${fieldId}">
            ${field.options.map(o =>
              `<option value="${o.id}" ${d[fieldId] === o.id ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
          </select>
        </label>`;
    };
    return `
      <div class="cast-details cast-details--director">
        <p class="cast-dir-lead">Production dials — personification &amp; focus. These keywords feed Director events, audits, injections, and any prompt that asks the Director.</p>
        <div class="cast-dir-inject-row">
          <button type="button" class="cast-btn gold" data-action="inject-event">Inject event</button>
          <span class="cast-modal-hint" style="margin:0">Force a Director beat. Opens Production settings plus optional pins from Motivation, hooks, and cast.</span>
        </div>
        <label class="cast-dir-field">
          <span>Reply as</span>
          <select data-field="replyAsId">
            <option value="">— Director card name —</option>
            ${others.map(o =>
              `<option value="${esc(o.id)}" ${c.replyAsId === o.id ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}
          </select>
        </label>
        <p class="cast-modal-hint" style="margin-top:0">When the Director’s linked ST card posts in chat, show that cast member’s name (and portrait if set) instead.</p>
        <div class="cast-dir-grid">
          ${select('genre')}
          ${select('culture')}
          ${select('era')}
          ${select('narratorTone')}
          ${select('verbosity')}
          ${select('personality')}
          ${select('difficulty')}
          ${select('friction')}
          ${select('pace')}
          <label class="cast-dir-field cast-dir-toggle">
            <span>Casual obscenity</span>
            <label class="cast-dir-check">
              <input type="checkbox" data-dir="casualObscenity" ${d.casualObscenity ? 'checked' : ''}>
              Sex isn’t publicly shamed — frank talk / public intimacy is ordinary
            </label>
          </label>
        </div>
        <h4>Additional notes</h4>
        <textarea class="cast-condition" data-dir="notes"
          placeholder="House rules, taboos to keep, recurring motifs, OOC reminders…">${esc(d.notes ?? '')}</textarea>
        <div class="cast-dir-keywords">${esc(directorKeywords(this.storage, c).join(' · ') || '—')}</div>
        <h4>Plot Hooks
          <span class="cast-h4-actions">
            <button class="cast-audit" data-action="pull-hooks" title="Import beats from Motivation as plot hooks">From Motivation</button>
            <button class="cast-audit" data-action="audit-hooks">Audit</button>
          </span>
        </h4>
        ${this._renderPlotHooks(c.plotHooks ?? [])}
        <button class="cast-item-add" data-action="add-plot-hook">+ Add plot hook</button>
      </div>
    `;
  }

  _persistDirectorDirection(char) {
    const d = ensureDirectorDirection(char);
    // Keep legacy fields in sync for older readers / migrations.
    char.genreNotes = directorKeywords(this.storage, char).join('; ');
    char.condition = d.notes || '';
    char.updatedAt = Date.now();
    this.saveState();
    this.bus.emit('cast.updated', { character: char });
  }

  _hookAssigneeOptions(selectedId = '') {
    const roster = this.state.characters.filter(c => c.priority !== 'director');
    const opts = [`<option value="">— Unassigned —</option>`];
    for (const m of roster) {
      const label = PRIORITY_MAP[m.priority]?.label || m.priority;
      opts.push(`<option value="${esc(m.id)}" ${m.id === selectedId ? 'selected' : ''}>${esc(m.name)} (${esc(label)})</option>`);
    }
    return opts.join('');
  }

  _matchHookAssignee(raw) {
    const needle = String(raw || '').trim();
    if (!needle) return '';
    const roster = this.state.characters.filter(c => c.priority !== 'director');
    if (roster.some(c => c.id === needle)) return needle;
    const hit = roster.find(c => castNameMatches(c, needle));
    return hit?.id || '';
  }

  _renderPlotHooks(hooks) {
    const list = (hooks ?? []).map(h => normalizePlotHook(h)).filter(Boolean);
    if (!list.length) return `<div class="cast-tag-empty">No plot hooks yet.</div>`;
    return list.map(h => {
      const who = h.assignedTo
        ? this.state.characters.find(c => c.id === h.assignedTo)
        : null;
      const badge = who
        ? `<span class="cast-item-cond" style="background:${priorityColor(who.priority)}">${esc(who.name)}</span>`
        : `<span class="cast-item-cond cast-item-cond--open">Unassigned</span>`;
      const scene = hookSceneLabel(this.storage, h);
      const board = h.stepId
        ? `<span class="cast-item-cond cast-item-cond--board" title="Filed on their Motivation board">Board</span>`
        : '';
      return `
      <div class="cast-item${h.active === false ? ' cast-item--inactive' : ''}" style="border-left-color:${who ? priorityColor(who.priority) : 'var(--st-sepia)'}">
        <div class="cast-item-row">
          <label class="cast-item-active" title="Active hooks inject into prompts">
            <input type="checkbox" data-action="toggle-hook" data-hook-id="${esc(h.id)}"
              ${h.active !== false ? 'checked' : ''}>
          </label>
          <span class="cast-item-name">${esc(h.name)}</span>
          ${badge}
          ${board}
          <div class="cast-item-actions">
            <button class="cast-btn small" data-action="edit-hook" data-hook-id="${esc(h.id)}">Edit</button>
            <button class="cast-btn small danger" data-action="remove-hook" data-hook-id="${esc(h.id)}">×</button>
          </div>
        </div>
        ${h.description ? `<div class="cast-item-desc">${esc(h.description)}</div>` : ''}
        <div class="cast-item-scene">${scene ? esc(scene) : 'No scene linked'}</div>
      </div>`;
    }).join('');
  }

  _renderItems(char, kind) {
    const items = char[kind] ?? [];
    if (!items.length) return `<div class="cast-tag-empty">None</div>`;
    const roots = kind === 'props' ? kitRoots(items) : items.filter(x => !x.parentId);
    const show = roots.length ? roots : items;
    return show.map(x => this._renderKitItem(char, kind, x, false)).join('');
  }

  _kitOpenKey(char, item) {
    return `${char.id}:${item.id}`;
  }

  _renderKitItem(char, kind, item, nested) {
    const items = char[kind] ?? [];
    const kids = kind === 'props' ? kitChildren(items, item.id) : [];
    const isBox = inferKitKind(item) === 'container' || kids.length > 0;
    const openKey = this._kitOpenKey(char, item);
    const open = isBox && (this._openKitBoxes ??= new Set()).has(openKey);
    const cond = CONDITION_MAP[item.condition] ?? CONDITION_MAP.pristine;
    const fold = isBox
      ? `<button type="button" class="cast-fold" data-action="toggle-kit" data-item-id="${item.id}" title="${open ? 'Collapse' : 'Expand'}">${open ? '▾' : '▸'}</button>`
      : '';
    const count = isBox && kids.length && !open
      ? `<span class="cast-item-meta-inline">${kids.length} inside</span>`
      : '';
    return `
      <div class="cast-item${nested ? ' cast-item--in' : ''}${isBox ? ' cast-item--box' : ''}" style="border-left-color:${cond.color}">
        <div class="cast-item-row">
          ${fold}
          <span class="cast-item-name">${isBox ? '▣ ' : ''}${esc(item.name)}</span>
          ${count}
          <span class="cast-item-cond" style="background:${cond.color}">${cond.label}</span>
          <div class="cast-item-actions">
            <button class="cast-btn small" data-action="edit-${kind}" data-item-id="${item.id}">Edit</button>
            <button class="cast-btn small danger" data-action="remove-${kind}" data-item-id="${item.id}">×</button>
          </div>
        </div>
        ${item.description ? `<div class="cast-item-desc">${esc(item.description)}</div>` : ''}
      </div>
      ${isBox && open ? kids.map(k => this._renderKitItem(char, kind, k, true)).join('') : ''}
    `;
  }

  _statColor(def) {
    try {
      const colors = this.storage.getChat('backstage', {})?.trackers?.status?.colors;
      const c = colors?.[def.id];
      if (c && /^#[0-9a-fA-F]{3,8}$/.test(c)) return c;
    } catch { /* ignore */ }
    return def.color || '#6b5a8a';
  }

  _customStatValue(stats, id) {
    const bag = stats?.custom && typeof stats.custom === 'object' ? stats.custom : {};
    if (Object.prototype.hasOwnProperty.call(bag, id)) return clamp(bag[id]);
    return 50;
  }

  _renderStats(c) {
    const stats = c.stats ?? DEFAULT_STATS();
    const customDefs = customBarDefsFromTrackers(this.storage);
    const bar = (def) => {
      const val = def.custom
        ? this._customStatValue(stats, def.id)
        : clamp(stats[def.id] ?? (def.direction === 'down' ? 0 : 100));
      const label = stateLabel(def, val);
      const color = this._statColor(def);
      const fillHtml = def.direction === 'up'
        ? `<div class="cast-stat-fill" style="left:0;width:${val}%;background:${color}"></div>`
        : `<div class="cast-stat-fill down" style="right:0;width:${100 - val}%;background:${color}"></div>`;
      const text = def.levelMode === 'none'
        ? String(val)
        : def.levelMode === 'amount'
          ? String(val)
          : (label ? `${label} · ${val}` : String(val));
      return `
        <div class="cast-stat-row"${def.description ? ` title="${esc(def.description)}"` : ''}>
          <span class="cast-stat-label">${esc(def.label)}</span>
          <div class="cast-stat-bar ${def.direction}" data-stat="${esc(def.id)}" ${def.custom ? 'data-custom="1"' : ''}
            title="Click to set · Right-click for exact value">
            ${fillHtml}
            <span class="cast-stat-text">${esc(text)}</span>
          </div>
          <input type="number" class="cast-stat-input" data-stat-input="${esc(def.id)}" ${def.custom ? 'data-custom="1"' : ''}
            value="${val}" min="0" max="100">
        </div>
      `;
    };
    const baseBars = stats.enabled ? STAT_DEFS.base.map(bar).join('') : '';
    let hardBars = '';
    if (stats.enabled && stats.hardMode) {
      const groups = {};
      STAT_DEFS.hard.forEach(d => { (groups[d.group] ??= []).push(d); });
      hardBars = Object.entries(groups).map(([name, defs]) => `
        <div class="cast-stat-group">
          <div class="cast-stat-group-label">${name}</div>
          ${defs.map(bar).join('')}
        </div>
      `).join('');
    }
    const customBars = stats.enabled && customDefs.length
      ? `<div class="cast-stat-group">
          <div class="cast-stat-group-label">Custom</div>
          ${customDefs.map(bar).join('')}
        </div>`
      : '';
    return `
      <h4>Stats
        <div class="cast-stats-toggles">
          ${stats.enabled ? '<button class="cast-audit" data-action="audit-stats">Audit</button>' : ''}
          <label><input type="checkbox" data-action="stats-enable" ${stats.enabled ? 'checked' : ''}>Track</label>
          ${stats.enabled ? `<label><input type="checkbox" data-action="stats-hard" ${stats.hardMode ? 'checked' : ''}>Hard Mode</label>` : ''}
        </div>
      </h4>
      ${baseBars}
      ${hardBars}
      ${customBars}
    `;
  }

  // ─── event binding ───────────────────────────────────────────────────────────

  _bindRows(listEl) {
    listEl.querySelectorAll('.cast-row').forEach(rowEl => {
      const id = rowEl.dataset.id;
      const char = this._find(id);
      if (!char) return;

      // Always-visible row actions
      rowEl.querySelector('[data-action="view"]')?.addEventListener('click', () => this._openCastView(char));
      rowEl.querySelector('[data-action="cue"]')?.addEventListener('click', () => this.cueCast(char));
      rowEl.querySelector('[data-action="presence"]')?.addEventListener('click', () => this._cyclePresence(char));
      rowEl.querySelector('[data-action="delete"]')?.addEventListener('click', () => this._confirmDelete(char));
      rowEl.querySelector('[data-action="toggle"]')?.addEventListener('click', () => {
        this._expandedIds.has(id) ? this._expandedIds.delete(id) : this._expandedIds.add(id);
        this._renderList();
      });

      if (!this._expandedIds.has(id)) return;

      // ── Director detail handlers ──────────────────────────────────────────
      if (char.priority === 'director') {
        ensureDirectorDirection(char);

        rowEl.querySelectorAll('[data-dir]').forEach(el => {
          const key = el.dataset.dir;
          const handler = () => {
            const d = ensureDirectorDirection(char);
            if (key === 'casualObscenity') d.casualObscenity = !!el.checked;
            else d[key] = el.value;
            this._persistDirectorDirection(char);
            if (key !== 'notes') {
              const kw = rowEl.querySelector('.cast-dir-keywords');
              if (kw) kw.textContent = directorKeywords(this.storage, char).join(' · ') || '—';
            }
          };
          el.addEventListener('change', handler);
        });

        rowEl.querySelector('[data-field="replyAsId"]')?.addEventListener('change', e => {
          char.replyAsId = e.target.value || '';
          char.updatedAt = Date.now();
          this.saveState();
          this.bus.emit('cast.updated', { character: char });
        });

        rowEl.querySelector('[data-action="add-plot-hook"]')?.addEventListener('click', () =>
          this._openPlotHookDialog(char));

        rowEl.querySelector('[data-action="inject-event"]')?.addEventListener('click', () =>
          this._openInjectEventDialog());

        rowEl.querySelector('[data-action="audit-hooks"]')?.addEventListener('click', e =>
          this._runAudit(char, 'hooks', e.target));

        rowEl.querySelector('[data-action="pull-hooks"]')?.addEventListener('click', () =>
          this._openPullHooksDialog(char));

        rowEl.querySelectorAll('[data-action="edit-hook"]').forEach(btn => {
          const hook = (char.plotHooks ?? []).find(h => h.id === btn.dataset.hookId);
          if (hook) btn.addEventListener('click', () => this._openPlotHookDialog(char, hook));
        });

        rowEl.querySelectorAll('[data-action="remove-hook"]').forEach(btn => {
          btn.addEventListener('click', () => {
            const hook = (char.plotHooks ?? []).find(h => h.id === btn.dataset.hookId);
            if (hook) unlinkHook(this.storage, hook);
            char.plotHooks = (char.plotHooks ?? []).filter(h => h.id !== btn.dataset.hookId);
            char.updatedAt = Date.now();
            this.saveState();
            this.bus.emit('cast.updated', { character: char });
            this.bus.emit('motivation.updated', { characterId: hook?.assignedTo });
            this._renderList();
          });
        });

        rowEl.querySelectorAll('[data-action="toggle-hook"]').forEach(cb => {
          cb.addEventListener('change', () => {
            const hook = (char.plotHooks ?? []).find(h => h.id === cb.dataset.hookId);
            if (!hook) return;
            hook.active = cb.checked;
            char.updatedAt = Date.now();
            this.saveState();
            this.bus.emit('cast.updated', { character: char });
            cb.closest('.cast-item')?.classList.toggle('cast-item--inactive', !cb.checked);
          });
        });

      // ── Character detail handlers ─────────────────────────────────────────
      } else {
        rowEl.querySelector('[data-action="audit-wardrobe"]')?.addEventListener('click', e =>
          this._runAudit(char, 'wardrobe', e.target));
        rowEl.querySelector('[data-action="audit-props"]')?.addEventListener('click', e =>
          this._runAudit(char, 'props', e.target));
        rowEl.querySelector('[data-action="audit-condition"]')?.addEventListener('click', e =>
          this._runAudit(char, 'condition', e.target));
        rowEl.querySelector('[data-action="audit-stats"]')?.addEventListener('click', e =>
          this._runAudit(char, 'stats', e.target));

        rowEl.querySelector('[data-action="add-wardrobe"]')?.addEventListener('click', () =>
          this._openItemDialog(char, 'wardrobe'));
        rowEl.querySelector('[data-action="add-prop"]')?.addEventListener('click', () =>
          this._openItemDialog(char, 'props'));

        rowEl.querySelectorAll('[data-action="edit-wardrobe"]').forEach(btn => {
          const item = (char.wardrobe ?? []).find(x => x.id === btn.dataset.itemId);
          if (item) btn.addEventListener('click', () => this._openItemDialog(char, 'wardrobe', item));
        });
        rowEl.querySelectorAll('[data-action="edit-props"]').forEach(btn => {
          const item = (char.props ?? []).find(x => x.id === btn.dataset.itemId);
          if (item) btn.addEventListener('click', () => this._openItemDialog(char, 'props', item));
        });
        rowEl.querySelectorAll('[data-action="remove-wardrobe"]').forEach(btn =>
          btn.addEventListener('click', () => this._removeSubItem(char, 'wardrobe', btn.dataset.itemId)));
        rowEl.querySelectorAll('[data-action="remove-props"]').forEach(btn =>
          btn.addEventListener('click', () => this._removeSubItem(char, 'props', btn.dataset.itemId)));
        rowEl.querySelectorAll('[data-action="toggle-kit"]').forEach(btn => {
          btn.addEventListener('click', () => {
            const key = `${char.id}:${btn.dataset.itemId}`;
            const open = (this._openKitBoxes ??= new Set());
            if (open.has(key)) open.delete(key);
            else open.add(key);
            this._renderList();
          });
        });

        rowEl.querySelector('[data-action="condition"]')?.addEventListener('change', e => {
          char.condition = e.target.value;
          char.updatedAt = Date.now();
          this.saveState();
          this.bus.emit('cast.updated', { character: char });
        });

        // Stats toggles
        rowEl.querySelector('[data-action="stats-enable"]')?.addEventListener('change', e => {
          if (!char.stats) char.stats = DEFAULT_STATS();
          char.stats.enabled = e.target.checked;
          char.updatedAt = Date.now();
          this.saveState();
          this.bus.emit('cast.updated', { character: char });
          this._renderList();
        });
        rowEl.querySelector('[data-action="stats-hard"]')?.addEventListener('change', e => {
          if (!char.stats) char.stats = DEFAULT_STATS();
          char.stats.hardMode = e.target.checked;
          char.updatedAt = Date.now();
          this.saveState();
          this.bus.emit('cast.updated', { character: char });
          this._renderList();
        });

        // Stat bars — click sets value at click position, right-click prompts for exact
        rowEl.querySelectorAll('.cast-stat-bar').forEach(barEl => {
          const statId = barEl.dataset.stat;
          const isCustom = barEl.dataset.custom === '1';
          barEl.addEventListener('click', e => {
            const r = barEl.getBoundingClientRect();
            const pct = clamp(Math.round((e.clientX - r.left) / r.width * 100));
            this._setStatValue(char, statId, pct, isCustom);
            this._renderList();
          });
          barEl.addEventListener('contextmenu', e => {
            e.preventDefault();
            const cur = isCustom
              ? this._customStatValue(char.stats, statId)
              : (char.stats?.[statId] ?? 0);
            const val = prompt('Set exact value (0–100):', cur);
            if (val === null) return;
            this._setStatValue(char, statId, parseInt(val) || 0, isCustom);
            this._renderList();
          });
        });

        rowEl.querySelectorAll('.cast-stat-input').forEach(inp => {
          inp.addEventListener('change', () => {
            this._setStatValue(char, inp.dataset.statInput, parseInt(inp.value) || 0, inp.dataset.custom === '1');
            this._renderList();
          });
        });
      }
    });
  }

  // ─── state helpers ───────────────────────────────────────────────────────────

  _setStatValue(char, statId, rawVal, isCustom = false) {
    if (!char.stats) char.stats = DEFAULT_STATS();
    if (isCustom) {
      char.stats.custom ??= {};
      char.stats.custom[statId] = clamp(rawVal);
      char.updatedAt = Date.now();
      this.saveState();
      this.bus.emit('cast.updated', { character: char });
      return;
    }
    const prev = char.stats[statId];
    char.stats[statId] = clamp(rawVal);
    char.updatedAt = Date.now();

    // One-shot threshold-crossing alert for bladder and hygiene.
    if (THRESHOLD_NOTIFY_STATS.has(statId) && prev !== undefined) {
      const def = ALL_STAT_DEFS.find(d => d.id === statId);
      if (def) {
        const prevLabel = stateLabel(def, clamp(prev));
        const curLabel  = stateLabel(def, clamp(char.stats[statId]));
        if (prevLabel !== curLabel) {
          const name = this._resolveDisplay(char).name;
          this._pendingStatAlert = `[Note: ${name}'s ${def.label} is now ${curLabel}]`;
        }
      }
    }

    this.saveState();
    this.bus.emit('cast.updated', { character: char });
    if (this._pendingStatAlert) this.bus.emit('showtime.stateChanged');
  }

  _removeSubItem(char, kind, itemId) {
    const list = char[kind] ?? [];
    const item = list.find(x => x.id === itemId);
    const drop = new Set([itemId, ...kitDescendantIds(list, itemId)]);
    const gone = list.filter(x => drop.has(x.id));
    char[kind] = list.filter(x => !drop.has(x.id));
    char.updatedAt = Date.now();
    this.saveState();
    for (const it of gone) this._relinquishKitItem(char, it, kind);
    this.bus.emit('cast.updated', { character: char });
    this._renderList();
  }

  _confirmDelete(char) {
    if (!confirm(`Remove ${char.name} from the cast?`)) return;
    const idx = this.state.characters.findIndex(c => c.id === char.id);
    if (idx < 0) return;
    const [removed] = this.state.characters.splice(idx, 1);
    this._expandedIds.delete(removed.id);
    this.saveState();
    this.bus.emit('cast.removed', { id: removed.id, character: removed });
    this._renderList();
  }

  // ─── injections ──────────────────────────────────────────────────────────────

  _registerInjections() {
    if (!this.injector) return;

    // Always-on: character stat summary for in-scene characters.
    this.injector.register({
      id: 'cast.states',
      always: true,
      buildText: () => this._buildStatesInjection(),
    });

    // Always-on: pronouns for in-scene cast members.
    this.injector.register({
      id: 'cast.pronouns',
      always: true,
      buildText: () => this._buildPronounsInjection(),
    });

    // Always-on: Director's active plot hooks and genre notes.
    this.injector.register({
      id: 'cast.director',
      always: true,
      buildText: () => this._buildDirectorInjection(),
    });

    this.injector.register({
      id: 'cast.starAbsent',
      always: true,
      buildText: () => this._buildStarAbsentInjection(),
    });

    // One-shot: bladder/hygiene threshold crossing alert.
    this.injector.register({
      id: 'cast.stat_alert',
      always: true,
      buildText: () => this._pendingStatAlert ?? '',
    });

    this.injector.register({
      id: 'cast.cue',
      always: true,
      buildText: () => this._pendingCueText || '',
    });

    // Trigger-based: wardrobe.
    this.injector.register({
      id: 'cast.wardrobe',
      triggers: ['wardrobe', 'clothes', 'clothing', 'wearing', 'outfit', 'costume',
                 'gear', 'equip', 'attire', 'dressed'],
      buildText: () => this._buildWardrobeInjection(),
    });

    // Trigger-based: props.
    this.injector.register({
      id: 'cast.props',
      triggers: ['props', 'items', 'pocket', 'pockets', 'inventory',
                 'carrying', 'carry', 'holding', 'hold', 'have on'],
      buildText: () => this._buildPropsInjection(),
    });

    const bump = () => this.bus.emit('showtime.stateChanged');
    this.bus.on('cast.added',   bump);
    this.bus.on('cast.updated', bump);
    this.bus.on('cast.removed', bump);
  }

  _inSceneChars() {
    const inScene = this._getInCurrentChat();
    return this.state.characters.filter(c => {
      const presence = normalizePresence(c);
      if (presence === 'absent' || presence === 'writtenOut') return false;
      return c.priority === 'star' ||
        (c.characterCardId && inScene.has(c.characterCardId));
    });
  }

  _inPlayChars() {
    const chars = this._inSceneChars();
    try {
      const status = this.storage.getChat('backstage', {})?.trackers?.status || {};
      if (status.offScreen) return chars;
      const windowN = Number(status.inPlayWindow) || 10;
      const ids = inPlayMemberIds(this.storage, getContext()?.chat || [], windowN);
      return chars.filter(c => c.priority === 'star' || ids.has(c.id));
    } catch {
      return chars;
    }
  }

  _cyclePresence(char) {
    if (!char || char.priority === 'director') return;
    if (char.priority === 'star') {
      char.presence = normalizePresence(char) === 'absent' ? 'inPlay' : 'absent';
    } else {
      const cur = normalizePresence(char);
      const i = PRESENCE_ORDER.indexOf(cur);
      char.presence = PRESENCE_ORDER[(i + 1) % PRESENCE_ORDER.length];
    }
    char.updatedAt = Date.now();
    this.saveState();
    this.bus.emit('cast.updated', { character: char });
    this._renderList();
  }

  _buildStatesInjection() {
    if (!statusTrackingMasterOn(this.storage)) return '';
    const inPlay = this._inPlayChars();
    const chars = inPlay.filter(c => c.stats?.enabled);
    const cues = compactStatusCueInject(
      this.storage,
      getContext()?.chat || [],
      Number(this.storage.getChat('backstage', {})?.trackers?.status?.inPlayWindow) || 8,
    );
    const customDefs = customBarDefsFromTrackers(this.storage);
    const lines = chars.map(c => {
      const name = this._resolveDisplay(c).name;
      const defs = [...STAT_DEFS.base, ...(c.stats.hardMode ? STAT_DEFS.hard : [])];
      const bits = defs.map(def => {
        const val = clamp(c.stats[def.id] ?? (def.direction === 'down' ? 0 : 100));
        return `${def.label}: ${stateLabel(def, val)}`;
      });
      for (const def of customDefs) {
        const val = this._customStatValue(c.stats, def.id);
        const label = stateLabel(def, val);
        const tip = def.description ? ` (${clipText(def.description, 40)})` : '';
        bits.push(def.levelMode === 'none'
          ? `${def.label}: ${val}${tip}`
          : def.levelMode === 'amount'
            ? `${def.label}: ${val}${tip}`
            : `${def.label}: ${label || val}${tip}`);
      }
      return `- ${name} — ${bits.join(', ')}`;
    });
    const statusBlock = lines.length ? `[Status:\n${lines.join('\n')}]` : '';
    const condLines = inPlay
      .filter(c => String(c.condition || '').trim())
      .slice(0, 4)
      .map(c => `- ${this._resolveDisplay(c).name} — ${clipText(c.condition, 140)}`);
    const condBlock = condLines.length ? `[Condition:\n${condLines.join('\n')}]` : '';
    return [statusBlock, condBlock, cues].filter(Boolean).join('\n');
  }

  _buildPronounsInjection() {
    const lines = this._inPlayChars()
      .map(c => {
        const line = formatPronounsPromptLine({ ...c, name: this._resolveDisplay(c).name });
        return line ? `- ${line}` : '';
      })
      .filter(Boolean);
    if (!lines.length) return '';
    return `[Cast pronouns in scene (use preferred forms in narration):\n${lines.join('\n')}]`;
  }

  _buildDirectorInjection() {
    const director = this.state.characters.find(c => c.priority === 'director');
    if (!director) return '';
    const block = formatDirectorPromptBlock(this.storage, { char: director });
    if (!block || block.startsWith('(No Director')) return '';
    return `[Director production dials:\n${block}]`;
  }

  _buildStarAbsentInjection() {
    const star = this.state.characters.find(c => c.priority === 'star');
    if (normalizePresence(star) !== 'absent') return '';
    const name = this._resolveDisplay(star).name || '{{user}}';
    return `[Stage: ${name} (the Star / {{user}}) is off-camera this scene. Do not describe them as present, do not use their persona or profile, and do not write their inner thoughts.]`;
  }

  _buildWardrobeInjection() {
    const chars = this._inSceneChars().filter(c => (c.wardrobe ?? []).length);
    if (!chars.length) return '';
    const lines = chars.map(c => {
      const name = this._resolveDisplay(c).name;
      const modifier = this._wardrobeModifier(c);
      const items = c.wardrobe.map(w => {
        const parts = [w.name];
        if (w.condition && w.condition !== 'pristine') parts.push(`(${w.condition})`);
        return parts.join(' ');
      }).join('; ');
      return `- ${name} is wearing: ${items}${modifier ? `. ${modifier}` : ''}`;
    });
    return `[Wardrobe:\n${lines.join('\n')}]`;
  }

  _wardrobeModifier(c) {
    if (!c.stats?.enabled) return '';
    const parts = [];
    const health  = clamp(c.stats.health  ?? 100);
    const hygiene = clamp(c.stats.hygiene ?? 0);
    if (health  < 30) parts.push('clothing is visibly bloodied or damaged from injuries');
    else if (health < 60) parts.push('clothing shows signs of hardship and wear');
    if (hygiene > 70) parts.push('clothing carries a foul odor');
    else if (hygiene > 40) parts.push('clothing is somewhat soiled');
    return parts.join('; ');
  }

  _buildPropsInjection() {
    const chars = this._inSceneChars().filter(c => (c.props ?? []).length);
    if (!chars.length) return '';
    const lines = chars.map(c => {
      const name = this._resolveDisplay(c).name;
      const items = formatCarryBrief(c.props ?? []);
      return `- ${name} is carrying: ${items}`;
    });
    return `[Items carried:\n${lines.join('\n')}]`;
  }

  // ─── modals ──────────────────────────────────────────────────────────────────

  _pronounViewLine(char) {
    const pronouns = normalizePronouns(char?.pronouns);
    const apparent = PRONOUN_APPARENT_OPTIONS.find(o => o.id === pronouns.apparent)?.label || pronouns.apparent || '—';
    let preferred = PRONOUN_PREFERRED_OPTIONS.find(o => o.id === pronouns.preferred)?.label || pronouns.preferred || '—';
    if (pronouns.preferred === 'custom') {
      preferred = [pronouns.custom.possessive, pronouns.custom.personal, pronouns.custom.reflexive]
        .filter(Boolean).join(' / ') || 'custom';
    }
    return `${apparent} · ${preferred}`;
  }

  _openCastView(char) {
    if (!char) return;
    const display = this._resolveDisplay(char);
    const p = priorityMeta(char.priority);
    const presence = normalizePresence(char);
    const portrait = display.portrait
      ? `<img src="${esc(display.portrait)}" alt="">`
      : esc((display.name || '?').charAt(0).toUpperCase());
    const persona = char.personaId ? this._getPersonas().find(x => x.id === char.personaId) : null;
    const card = char.characterCardId ? this._getCharacterCards().find(x => x.id === char.characterCardId) : null;
    const link = persona
      ? `Persona · ${persona.name}`
      : card
        ? `Character card · ${card.name}`
        : 'Manual';
    const affil = this._houseLabel(char.affiliationHouseId);
    const aliases = normalizeAliases(char.aliases);
    const bio = this._liveBio(char);
    const manual = !char.personaId && !char.characterCardId;
    const summary = String(char.summary || char.description || '').trim();
    const appearance = String(char.appearance || '').trim();
    const bioHtml = !manual && bio.mode !== 'manual'
      ? this._renderInfoBoxes(bio, { taggedAlterEgos: char.taggedAlterEgos || [], showEgoTags: false })
      : `
        ${appearance ? `<div class="cast-view-block"><div class="cast-view-k">Appearance</div><div class="cast-view-v">${esc(appearance)}</div></div>` : ''}
        ${summary ? `<div class="cast-view-block"><div class="cast-view-k">Summary</div><div class="cast-view-v">${esc(summary)}</div></div>` : ''}
        ${!appearance && !summary ? `<div class="cast-info-empty">No appearance or summary yet.</div>` : ''}
      `;

    const backdrop = this._buildModal(`
      <div class="cast-modal-title">PROFILE</div>
      <div class="cast-modal-subtitle">— ${esc(display.name || 'Unnamed')} —</div>
      <div class="cast-view-head">
        <div class="cast-view-portrait">${portrait}</div>
        <div>
          <div class="cast-view-name">${esc(display.name || 'Unnamed')}
            <span class="cast-row-badge" style="border-color:${p.color};color:${p.color}">${esc(p.label)}</span>
          </div>
          ${aliases.length ? `<div class="cast-row-aliases">${esc(aliases.join(' · '))}</div>` : ''}
        </div>
      </div>
      <dl class="cast-view-dl">
        <dt>Link</dt><dd>${esc(link)}</dd>
        ${char.priority !== 'director' ? `<dt>Presence</dt><dd>${esc(PRESENCE[presence]?.label || presence)}</dd>` : ''}
        ${bio.alterEgoName ? `<dt>Alter ego</dt><dd>${esc(bio.alterEgoName)}</dd>` : ''}
        ${affil ? `<dt>Affiliation</dt><dd>${esc(affil)}</dd>` : ''}
        <dt>Pronouns</dt><dd>${esc(this._pronounViewLine(char))}</dd>
      </dl>
      <div class="cast-view-bio">${bioHtml}</div>
      <div class="cast-modal-actions">
        <button class="cast-btn" data-action="cancel">Close</button>
        <button class="cast-btn gold" data-action="edit">Edit</button>
      </div>
    `);
    backdrop.querySelector('[data-action="edit"]')?.addEventListener('click', () => {
      backdrop.remove();
      this._openCastingCall(char);
    });
  }

  _openCastingCall(existing = null) {
    const isEdit = !!existing;
    const c = existing ?? {
      name: '', priority: 'supporting', portrait: '',
      description: '', appearance: '', affiliationHouseId: '', aliases: [], characterCardId: '', syncFromCard: true,
      personaId: '', syncFromPersona: true, replyAsId: '',
      preferEvolutia: true, alterEgoId: '', taggedAlterEgos: [],
    };
    const cards = this._getCharacterCards();
    const personas = this._getPersonas();
    const inChat = this._getInCurrentChat();
    const chatCards  = cards.filter(x =>  inChat.has(x.id));
    const otherCards = cards.filter(x => !inChat.has(x.id));
    const opt = (list, sel) => list.map(x =>
      `<option value="${esc(x.id)}" ${x.id === sel ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
    const source0 = c.personaId ? 'persona' : c.characterCardId ? 'card' : 'manual';
    const others = this.state.characters.filter(x => (!existing || x.id !== existing.id) && x.priority !== 'director');
    const pronouns = normalizePronouns(c.pronouns);
    const houses = this._repHouses();
    const affilId = this._affiliationId(c);

    const backdrop = this._buildModal(`
      <div class="cast-modal-title">${isEdit ? 'RECAST' : 'CASTING CALL'}</div>
      <div class="cast-modal-subtitle">— A Showtime Production —</div>
      <div class="cast-modal-field">
        <label>Link</label>
        <div class="cast-source-row">
          <button type="button" class="cast-source-btn" data-source="manual">Manual</button>
          <button type="button" class="cast-source-btn" data-source="card">Character card</button>
          <button type="button" class="cast-source-btn" data-source="persona">Persona</button>
        </div>
        <div class="cast-modal-hint">Personas are {{user}} faces. Character cards are NPCs in the tavern. Cast Name can differ from the card — chat will show the Cast name.</div>
      </div>
      <div class="cast-modal-field" data-role="card-wrap">
        <label>Character Card</label>
        <select data-field="cardId">
          <option value="">— Choose a card —</option>
          ${chatCards.length  ? `<optgroup label="In this chat">${opt(chatCards,  c.characterCardId ?? '')}</optgroup>` : ''}
          ${otherCards.length ? `<optgroup label="All characters">${opt(otherCards, c.characterCardId ?? '')}</optgroup>` : ''}
        </select>
      </div>
      <div class="cast-modal-field" data-role="persona-wrap">
        <label>Persona</label>
        <select data-field="personaId">
          <option value="">— Choose a persona —</option>
          ${opt(personas, c.personaId ?? '')}
        </select>
      </div>
      <div class="cast-modal-field" data-role="sync-card-wrap" style="display:none">
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;text-transform:none;letter-spacing:0;font-family:var(--st-font-body);font-size:12px;color:var(--st-ink)">
          <input type="checkbox" data-field="syncFromCard" ${(c.syncFromCard ?? true) ? 'checked' : ''} style="width:auto">
          Keep portrait synced with card
        </label>
      </div>
      <div class="cast-modal-field" data-role="sync-persona-wrap" style="display:none">
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;text-transform:none;letter-spacing:0;font-family:var(--st-font-body);font-size:12px;color:var(--st-ink)">
          <input type="checkbox" data-field="syncFromPersona" ${(c.syncFromPersona ?? true) ? 'checked' : ''} style="width:auto">
          Keep name and portrait synced with persona
        </label>
      </div>
      <div class="cast-modal-field"><label>Name <span class="cast-modal-hint" style="display:inline;text-transform:none;letter-spacing:0">· shown in chat / credits</span></label>
        <input type="text" data-field="name" value="${esc(c.name)}"></div>
      <div class="cast-modal-field"><label>Aliases <span class="cast-modal-hint" style="display:inline;text-transform:none;letter-spacing:0">· comma-separated nicknames / tag names</span></label>
        <input type="text" data-field="aliases" value="${esc(normalizeAliases(c.aliases).join(', '))}" placeholder="e.g. The Captain, Cap, Marcus V."></div>
      <div class="cast-modal-field"><label>Priority</label>
        <select data-field="priority">
          ${PRIORITIES.map(p => `<option value="${p.id}" ${p.id === c.priority ? 'selected' : ''}>${p.label}${p.id === 'star' ? ' · {{user}}' : ''}</option>`).join('')}
        </select>
        <div class="cast-modal-hint" data-role="star-hint" style="display:none">Star is unique — tracked like a Lead (stats, wardrobe, props). Usually a persona.</div>
      </div>
      <div class="cast-modal-field" data-role="reply-as-wrap" style="display:none">
        <label>Reply as</label>
        <select data-field="replyAsId">
          <option value="">— Director card name —</option>
          ${others.map(o =>
            `<option value="${esc(o.id)}" ${c.replyAsId === o.id ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}
        </select>
        <div class="cast-modal-hint">When this Director card speaks in chat, show the chosen cast member instead.</div>
      </div>
      <div class="cast-modal-field"><label>Portrait URL (optional)</label>
        <input type="text" data-field="portrait" value="${esc(c.portrait ?? '')}"></div>
      <div class="cast-modal-field" data-role="info-wrap">
        <label data-role="info-label">Information</label>
        <div data-role="info-view"></div>
        <div data-role="manual-extras" style="display:none">
          <label>Appearance</label>
          <textarea data-field="appearance" placeholder="Build, face, notable marks, how they read at a glance…">${esc(c.appearance ?? '')}</textarea>
          <label>Affiliation</label>
          <select data-field="affiliationHouseId">
            <option value="">— None —</option>
            ${houses.map(h =>
              `<option value="${esc(h.id)}" ${h.id === affilId ? 'selected' : ''}>${esc(h.alias ? `${h.name} (${h.alias})` : h.name)}</option>`).join('')}
          </select>
          <div class="cast-modal-hint">${houses.length
            ? 'From Reputation organizations. Relationships still live on Connections.'
            : 'No organizations filed yet — add one on the Reputation Affiliations tab.'}</div>
          <label>Summary</label>
          <textarea data-field="description" data-role="desc-edit" placeholder="Short read — who they are in this production…">${esc(c.summary || c.description || '')}</textarea>
          <div class="cast-modal-hint" data-role="desc-manual-hint">Manual entries only — linked cards and personas are read-only here; edit them in SillyTavern.</div>
        </div>
      </div>
      <div class="cast-modal-field" data-role="pronouns-wrap">
        <label>Pronouns</label>
        <div class="cast-pronouns-grid">
          <div>
            <span class="cast-modal-hint" style="display:block;margin-bottom:2px">Apparent</span>
            <select data-field="pronouns-apparent">
              <option value="">—</option>
              ${PRONOUN_APPARENT_OPTIONS.map(o =>
                `<option value="${o.id}" ${pronouns.apparent === o.id ? 'selected' : ''}>${o.label}</option>`).join('')}
            </select>
          </div>
          <div>
            <span class="cast-modal-hint" style="display:block;margin-bottom:2px">Preferred</span>
            <select data-field="pronouns-preferred">
              <option value="">—</option>
              ${PRONOUN_PREFERRED_OPTIONS.map(o =>
                `<option value="${o.id}" ${pronouns.preferred === o.id ? 'selected' : ''}>${o.label}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="cast-pronouns-custom" data-role="pronouns-custom" style="display:none">
          <div>
            <span class="cast-modal-hint" style="display:block;margin-bottom:2px">Possessive</span>
            <input type="text" data-field="pronouns-possessive" value="${esc(pronouns.custom.possessive)}" placeholder="their">
          </div>
          <div>
            <span class="cast-modal-hint" style="display:block;margin-bottom:2px">Personal</span>
            <input type="text" data-field="pronouns-personal" value="${esc(pronouns.custom.personal)}" placeholder="they">
          </div>
          <div>
            <span class="cast-modal-hint" style="display:block;margin-bottom:2px">Reflexive</span>
            <input type="text" data-field="pronouns-reflexive" value="${esc(pronouns.custom.reflexive)}" placeholder="themselves">
          </div>
        </div>
        <div class="cast-modal-hint">Apparent is how they present; preferred forms feed narration when this cast member is in scene.</div>
      </div>
      ${isEdit ? '' : `
      <div class="cast-modal-field" data-role="kit-wrap">
        <label>Starting kit</label>
        <div class="cast-source-row">
          <button type="button" class="cast-source-btn" data-kit="empty">Empty</button>
          <button type="button" class="cast-source-btn" data-kit="manual">Fill in</button>
          <button type="button" class="cast-source-btn" data-kit="generate">Generate</button>
        </div>
        <div class="cast-modal-hint" data-role="kit-hint"></div>
        <div data-role="kit-manual" style="display:none">
          <label>Wardrobe <span class="cast-modal-hint" style="display:inline;text-transform:none;letter-spacing:0">· one garment per line</span></label>
          <textarea data-field="kit-wardrobe" placeholder="tan jacket&#10;canvas work shirt | sleeves rolled&#10;boots (worn)"></textarea>
          <label>Props <span class="cast-modal-hint" style="display:inline;text-transform:none;letter-spacing:0">· one object per line; nest with “in bag”</span></label>
          <textarea data-field="kit-props" placeholder="canvas bag&#10;headphones in canvas bag&#10;charger in canvas bag"></textarea>
        </div>
      </div>`}
      <div class="cast-modal-actions">
        <button class="cast-btn" data-action="cancel">Cancel</button>
        <button class="cast-btn" data-action="save">${isEdit ? 'Save' : 'Cast'}</button>
      </div>
    `);

    const cardSel    = backdrop.querySelector('[data-field="cardId"]');
    const personaSel = backdrop.querySelector('[data-field="personaId"]');
    const nameEl     = backdrop.querySelector('[data-field="name"]');
    const aliasEl    = backdrop.querySelector('[data-field="aliases"]');
    const portEl     = backdrop.querySelector('[data-field="portrait"]');
    const descEl     = backdrop.querySelector('[data-field="description"]');
    const appearEl   = backdrop.querySelector('[data-field="appearance"]');
    const affilEl    = backdrop.querySelector('[data-field="affiliationHouseId"]');
    const infoView   = backdrop.querySelector('[data-role="info-view"]');
    const infoLabel  = backdrop.querySelector('[data-role="info-label"]');
    const manualExtras = backdrop.querySelector('[data-role="manual-extras"]');
    const priEl      = backdrop.querySelector('[data-field="priority"]');
    const apparentEl = backdrop.querySelector('[data-field="pronouns-apparent"]');
    const preferredEl = backdrop.querySelector('[data-field="pronouns-preferred"]');
    const customWrap = backdrop.querySelector('[data-role="pronouns-custom"]');
    let source = source0;
    let kitMode = 'empty';
    let infoSnapshot = String(c.description || '').trim();
    let draftAlterEgoId = String(c.alterEgoId || '').trim();
    let draftTaggedEgos = [...(c.taggedAlterEgos || [])].map(String);

    const syncPronounCustom = () => {
      if (customWrap) customWrap.style.display = preferredEl?.value === 'custom' ? '' : 'none';
    };
    preferredEl?.addEventListener('change', syncPronounCustom);
    syncPronounCustom();

    const collectEgoDraft = () => {
      const sel = infoView.querySelector('[data-field="alterEgoId"]');
      if (sel) draftAlterEgoId = sel.value || '';
      draftTaggedEgos = [...infoView.querySelectorAll('[data-ego-tag]:checked')]
        .map(el => el.getAttribute('data-ego-tag'))
        .filter(Boolean);
    };

    const refreshInfoView = () => {
      if (source === 'manual') {
        infoView.innerHTML = '';
        infoView.style.display = 'none';
        if (infoLabel) infoLabel.style.display = 'none';
        if (manualExtras) manualExtras.style.display = '';
        infoSnapshot = descEl?.value.trim() || '';
        draftAlterEgoId = '';
        draftTaggedEgos = [];
        return;
      }
      if (manualExtras) manualExtras.style.display = 'none';
      if (infoLabel) infoLabel.style.display = '';
      infoView.style.display = '';
      if ((source === 'card' && !cardSel.value) || (source === 'persona' && !personaSel.value)) {
        infoView.innerHTML = `<div class="cast-info-empty">Choose a ${source === 'persona' ? 'persona' : 'character card'} to view information.</div>`;
        infoSnapshot = '';
        return;
      }
      const bio = this._liveBio(c, {
        source,
        cardId: cardSel.value,
        personaId: personaSel.value,
        alterEgoId: draftAlterEgoId,
      });
      if (!draftAlterEgoId && bio.alterEgoId) draftAlterEgoId = bio.alterEgoId;
      infoView.innerHTML = this._renderInfoBoxes(bio, {
        taggedAlterEgos: draftTaggedEgos,
        showEgoTags: isAspectEvolutiaAvailable() && (bio.alterEgos?.length > 0),
      });
      infoSnapshot = bio.text || '';
      infoView.querySelector('[data-field="alterEgoId"]')?.addEventListener('change', e => {
        draftAlterEgoId = e.target.value || '';
        refreshInfoView();
      });
      infoView.querySelectorAll('[data-ego-tag]').forEach(box => {
        box.addEventListener('change', () => collectEgoDraft());
      });
    };

    const applyPersona = (id, fillEmptyOnly = false) => {
      const p = personas.find(x => x.id === id);
      if (!p) return;
      if (!fillEmptyOnly || !nameEl.value.trim()) nameEl.value = p.name;
      if (!fillEmptyOnly || !portEl.value.trim()) portEl.value = p.avatarUrl;
      draftAlterEgoId = '';
      refreshInfoView();
    };
    const applyCard = (id, { fillName = true } = {}) => {
      const card = cards.find(x => x.id === id);
      if (!card) return;
      // Only seed name when empty so Cast can keep a different stage name.
      if (fillName && !nameEl.value.trim()) nameEl.value = card.name;
      else if (fillName && !isEdit) nameEl.value = card.name;
      portEl.value = card.avatarUrl;
      draftAlterEgoId = '';
      refreshInfoView();
    };
    const syncSource = () => {
      backdrop.querySelectorAll('[data-source]').forEach(b => {
        b.classList.toggle('on', b.dataset.source === source);
      });
      backdrop.querySelector('[data-role="card-wrap"]').style.display = source === 'card' ? '' : 'none';
      backdrop.querySelector('[data-role="persona-wrap"]').style.display = source === 'persona' ? '' : 'none';
      backdrop.querySelector('[data-role="sync-card-wrap"]').style.display = source === 'card' && cardSel.value ? '' : 'none';
      backdrop.querySelector('[data-role="sync-persona-wrap"]').style.display = source === 'persona' && personaSel.value ? '' : 'none';
      refreshInfoView();
    };
    const syncStarHint = () => {
      backdrop.querySelector('[data-role="star-hint"]').style.display = priEl.value === 'star' ? '' : 'none';
      backdrop.querySelector('[data-role="reply-as-wrap"]').style.display = priEl.value === 'director' ? '' : 'none';
      const kitWrap = backdrop.querySelector('[data-role="kit-wrap"]');
      if (kitWrap) kitWrap.style.display = priEl.value === 'director' ? 'none' : '';
    };
    const syncKitMode = () => {
      backdrop.querySelectorAll('[data-kit]').forEach(b => {
        b.classList.toggle('on', b.dataset.kit === kitMode);
      });
      const manual = backdrop.querySelector('[data-role="kit-manual"]');
      if (manual) manual.style.display = kitMode === 'manual' ? '' : 'none';
      const hint = backdrop.querySelector('[data-role="kit-hint"]');
      if (hint) {
        hint.textContent = kitMode === 'generate'
          ? 'On Cast, fill wardrobe and props from the character card or the summary you wrote.'
          : kitMode === 'manual'
            ? 'One item per line. Optional: name | description, or “headphones in canvas bag”.'
            : 'Add wardrobe and props later from the call sheet, or Audit after they appear in a scene.';
      }
    };
    backdrop.querySelectorAll('[data-kit]').forEach(b => {
      b.addEventListener('click', () => { kitMode = b.dataset.kit; syncKitMode(); });
    });

    backdrop.querySelectorAll('[data-source]').forEach(b => {
      b.addEventListener('click', () => { source = b.dataset.source; syncSource(); });
    });
    cardSel.addEventListener('change', () => {
      if (cardSel.value) applyCard(cardSel.value);
      else syncSource();
    });
    personaSel.addEventListener('change', () => {
      if (personaSel.value) applyPersona(personaSel.value);
      else syncSource();
    });
    priEl.addEventListener('change', () => {
      syncStarHint();
      if (priEl.value === 'star' && source === 'manual' && !isEdit) {
        source = 'persona';
        if (!personaSel.value && user_avatar) {
          personaSel.value = user_avatar;
          applyPersona(user_avatar, true);
        }
        syncSource();
      }
    });

    syncSource();
    syncStarHint();
    syncKitMode();

    backdrop.querySelector('[data-action="save"]').addEventListener('click', () => {
      collectEgoDraft();
      const name           = nameEl.value.trim();
      const priority       = priEl.value;
      const portrait       = portEl.value.trim();
      let aliases          = normalizeAliases(aliasEl.value);
      const characterCardId = source === 'card' ? (cardSel.value || '') : '';
      const personaId      = source === 'persona' ? (personaSel.value || '') : '';
      const syncFromCard   = backdrop.querySelector('[data-field="syncFromCard"]')?.checked ?? false;
      const syncFromPersona = backdrop.querySelector('[data-field="syncFromPersona"]')?.checked ?? false;
      const preferEvolutia = source === 'card' || source === 'persona';
      const alterEgoId = (source === 'card' || source === 'persona') ? draftAlterEgoId : '';
      const taggedAlterEgos = (source === 'card' || source === 'persona') ? draftTaggedEgos : [];
      const replyAsId = priority === 'director'
        ? (backdrop.querySelector('[data-field="replyAsId"]')?.value || '')
        : '';
      // Merge tagged alter-ego names into aliases so Script character tags resolve.
      const bioForTags = (source === 'card' || source === 'persona')
        ? this._liveBio(c, { source, cardId: characterCardId, personaId, alterEgoId })
        : null;
      if (bioForTags?.alterEgos?.length && taggedAlterEgos.length) {
        const tagNames = bioForTags.alterEgos
          .filter(e => taggedAlterEgos.includes(e.id))
          .map(e => e.name);
        aliases = normalizeAliases([...aliases, ...tagNames]);
      }
      const alterEgoIndex = (bioForTags?.alterEgos || []).map(e => ({ id: e.id, name: e.name }));
      // Linked bios are live/read-only — snapshot for search & offline.
      const description = source === 'manual'
        ? (descEl?.value || '')
        : (this._liveBio(c, { source, cardId: characterCardId, personaId, alterEgoId }).text || infoSnapshot || '');
      const appearance = source === 'manual' ? String(appearEl?.value || '') : (existing?.appearance || c.appearance || '');
      const affiliationHouseId = source === 'manual'
        ? String(affilEl?.value || '')
        : (existing?.affiliationHouseId || c.affiliationHouseId || '');
      const pronounsNext = normalizePronouns({
        apparent: apparentEl?.value || '',
        preferred: preferredEl?.value || '',
        custom: {
          possessive: backdrop.querySelector('[data-field="pronouns-possessive"]')?.value || '',
          personal: backdrop.querySelector('[data-field="pronouns-personal"]')?.value || '',
          reflexive: backdrop.querySelector('[data-field="pronouns-reflexive"]')?.value || '',
        },
      });

      if (!name) { alert('Name is required.'); return; }
      if (!this._claimUniqueRole(priority, existing)) return;

      if (isEdit) {
        const prev = structuredClone(existing);
        Object.assign(existing, {
          name, priority, portrait, description, appearance, affiliationHouseId,
          aliases, pronouns: pronounsNext,
          characterCardId, syncFromCard, personaId, syncFromPersona,
          preferEvolutia, alterEgoId, taggedAlterEgos, alterEgoIndex, replyAsId,
          updatedAt: Date.now(),
        });
        if (priority === 'director') ensureDirectorDirection(existing);
        else existing.replyAsId = '';
        this._syncAffiliation(existing.id, affiliationHouseId);
        this.saveState();
        this.bus.emit('cast.updated', { character: existing, previous: prev });
        backdrop.remove();
        this._renderList();
      } else {
        const newChar = {
          id: uid(), name, priority, portrait, description, appearance, affiliationHouseId,
          aliases, pronouns: pronounsNext,
          characterCardId, syncFromCard, personaId, syncFromPersona,
          preferEvolutia, alterEgoId, taggedAlterEgos, alterEgoIndex, replyAsId,
          wardrobe: [], props: [], condition: '', presence: 'inPlay',
          plotHooks: [], genreNotes: '',
          createdAt: Date.now(), updatedAt: Date.now(),
        };
        if (priority === 'director') ensureDirectorDirection(newChar);
        this.state.characters.push(newChar);
        this._syncAffiliation(newChar.id, affiliationHouseId);
        if (priority !== 'director' && kitMode === 'manual') {
          this._applyManualStartingKit(
            newChar,
            backdrop.querySelector('[data-field="kit-wardrobe"]')?.value || '',
            backdrop.querySelector('[data-field="kit-props"]')?.value || '',
          );
        }
        this.saveState();
        this.bus.emit('cast.added', { character: newChar });
        backdrop.remove();
        this._renderList();
        if (priority !== 'director' && kitMode === 'generate') {
          this._generateStartingKit(newChar).catch(err => {
            console.warn('[Cast dress]', err);
            alert(`Cast, but kit generate failed: ${err?.message || err}`);
          });
        }
        return;
      }
    });
    setTimeout(() => nameEl.focus(), 0);
  }

  _claimUniqueRole(priority, existing = null) {
    const rule = UNIQUE_ROLES[priority];
    if (!rule) return true;
    const current = this.state.characters.find(x =>
      x.priority === priority && (!existing || x.id !== existing.id));
    if (!current) return true;
    const label = PRIORITY_MAP[priority]?.label ?? priority;
    const demoteLabel = PRIORITY_MAP[rule.demoteTo]?.label ?? rule.demoteTo;
    const ok = confirm(`${current.name} is currently the ${label}. Reassigning will demote them to ${demoteLabel}. Continue?`);
    if (!ok) return false;
    current.priority = rule.demoteTo;
    current.updatedAt = Date.now();
    this.bus.emit('cast.updated', { character: current });
    return true;
  }

  _parseKitLines(text) {
    const rows = [];
    for (const line of String(text || '').split('\n')) {
      let raw = line.trim();
      if (!raw) continue;
      let description = '';
      const pipe = raw.split(/\s*[|—–]\s*/);
      if (pipe.length > 1) {
        raw = pipe[0].trim();
        description = pipe.slice(1).join(' | ').trim();
      }
      let inside = '';
      const inn = raw.match(/^(.*?)\s+\bin\b\s+(.+)$/i);
      if (inn) {
        raw = inn[1].trim();
        inside = inn[2].trim();
      }
      const cond = raw.match(/\((pristine|fine|worn|damaged|broken|ruined)\)\s*$/i);
      if (cond) raw = raw.replace(cond[0], '').trim();
      if (!raw) continue;
      rows.push({
        name: raw.slice(0, 80),
        description: description.slice(0, 200),
        condition: (cond?.[1] || 'pristine').toLowerCase(),
        inside,
        kind: inferKitKind({ name: raw }),
      });
    }
    return rows;
  }

  _kitStarHooks() {
    return {
      onStarAdd: (c, item, k) => this._mirrorStarItem(c, item, k),
      onStarUpdate: (c, item, k) => this._mirrorStarItem(c, item, k),
      onStarRemove: (c, item, k) => this._relinquishKitItem(c, item, k),
      onStarMove: (c, item, fromKind, toKind) => {
        this._unlinkStarItem(c, item, fromKind);
        this._mirrorStarItem(c, item, toKind);
      },
    };
  }

  _applyManualStartingKit(char, wardrobeText, propsText) {
    const wardrobe = this._parseKitLines(wardrobeText);
    const props = this._parseKitLines(propsText);
    const boxes = [];
    const seen = new Set();
    for (const row of props) {
      if (!row.inside) continue;
      const key = row.inside.trim().toLowerCase();
      if (seen.has(key) || props.some(p => !p.inside && String(p.name || '').trim().toLowerCase() === key)) continue;
      seen.add(key);
      boxes.push({ name: row.inside.slice(0, 80), kind: 'container', condition: 'pristine' });
    }
    const hooks = this._kitStarHooks();
    if (wardrobe.length) {
      applyCastDelta(char, { wardrobe: { add: wardrobe, update: [], remove: [] } }, { include: ['wardrobe'], ...hooks });
    }
    const propAdd = [...boxes, ...props];
    if (propAdd.length) {
      applyCastDelta(char, { props: { add: propAdd, update: [], remove: [] } }, { include: ['props'], ...hooks });
    }
  }

  async _generateStartingKit(char) {
    if (!char || char.priority === 'director') return;
    if (this._auditBusy) {
      alert('An audit is already running. Wait for it to finish, then Audit wardrobe/props.');
      return;
    }
    this._auditBusy = true;
    try {
      const ctx = getContext();
      const identity = resolveCastPromptIdentity(char, this.storage, {
        characters: ctx.characters ?? [],
        personas: this._getPersonas(),
      });
      const bio = this._liveBio(char);
      const sourceText = [
        bio.text,
        char.appearance,
        char.summary,
        char.description,
      ].filter(t => String(t || '').trim()).join('\n\n');
      if (!String(sourceText).trim()) {
        throw new Error('No character card or written description to generate from.');
      }
      const who = this._auditIdentityLine(char, identity, { full: false });
      const prompt = buildCastDressPrompt({
        who,
        sourceLabel: bio.sourceLabel || 'description',
        sourceText: clipText(sourceText, 4000),
      });
      const response = await this._quietAudit(prompt, {
        jsonSchema: castDressSchema(),
        responseLength: FILING_RESPONSE_LENGTH,
      });
      const dressed = parseCastDress(response);
      applyCastDelta(char, dressed, {
        include: ['wardrobe', 'props'],
        ...this._kitStarHooks(),
      });
      if (dressed.appearance && !String(char.appearance || '').trim()) {
        char.appearance = dressed.appearance;
      }
      char.updatedAt = Date.now();
      this.saveState();
      this.bus.emit('cast.updated', { character: char });
      this._expandedIds.add(char.id);
      this._renderList();
    } finally {
      this._auditBusy = false;
    }
  }

  _openImportFromChat() {
    const cards = this._getCharacterCards();
    const inChat = this._getInCurrentChat();
    const present = cards.filter(c => inChat.has(c.id));
    if (!present.length) { alert('No characters found in the current chat.'); return; }
    const linkedIds = new Set(this.state.characters.map(c => c.characterCardId).filter(Boolean));

    const backdrop = this._buildModal(`
      <div class="cast-modal-title">CALL SHEET</div>
      <div class="cast-modal-subtitle">— Import from current chat —</div>
      <div class="cast-modal-field"><label>Priority for imported</label>
        <select data-field="priority">
          ${PRIORITIES.filter(p => !UNIQUE_ROLES[p.id]).map(p =>
            `<option value="${p.id}" ${p.id === 'supporting' ? 'selected' : ''}>${p.label}</option>`).join('')}
        </select>
        <div class="cast-modal-hint">Director and Star are unique — assign those from Casting Call.</div>
      </div>
      <div class="cast-modal-field"><label>Characters</label>
        <div class="cast-import-list">
          ${present.map(c => `
            <label class="cast-import-item ${linkedIds.has(c.id) ? 'linked' : ''}">
              <input type="checkbox" data-card-id="${esc(c.id)}" ${linkedIds.has(c.id) ? 'disabled' : 'checked'}>
              <img src="${esc(c.avatarUrl)}" alt="">
              <span style="flex:1">${esc(c.name)}</span>
              ${linkedIds.has(c.id) ? '<span class="linked-tag">Already cast</span>' : ''}
            </label>
          `).join('')}
        </div>
      </div>
      <div class="cast-modal-actions">
        <button class="cast-btn" data-action="cancel">Cancel</button>
        <button class="cast-btn" data-action="save">Import</button>
      </div>
    `);

    backdrop.querySelector('[data-action="save"]').addEventListener('click', () => {
      const priority = backdrop.querySelector('[data-field="priority"]').value;
      const selected = Array.from(backdrop.querySelectorAll('input[type="checkbox"]:checked'))
        .map(cb => cb.dataset.cardId);
      if (!selected.length) { alert('Select at least one character.'); return; }
      selected.forEach(cardId => {
        const card = cards.find(c => c.id === cardId);
        if (!card) return;
        const st = (getContext().characters || []).find(x => x.avatar === cardId);
        const description = resolveCardDescription(st, { preferEvolutia: true });
        this.state.characters.push({
          id: uid(), name: card.name, priority,
          portrait: card.avatarUrl, characterCardId: card.id,
          syncFromCard: true, personaId: '', syncFromPersona: false,
          description, aliases: [], preferEvolutia: true,
          wardrobe: [], props: [], condition: '', presence: 'inPlay',
          plotHooks: [], genreNotes: '',
          createdAt: Date.now(), updatedAt: Date.now(),
        });
        this.bus.emit('cast.added', { character: this.state.characters.at(-1) });
      });
      this.saveState();
      backdrop.remove();
      this._renderList();
    });
  }

  _openImportFromPersonas() {
    const personas = this._getPersonas();
    if (!personas.length) { alert('No personas found.'); return; }
    const linkedIds = new Set(this.state.characters.map(c => c.personaId).filter(Boolean));
    const currentId = user_avatar || '';

    const backdrop = this._buildModal(`
      <div class="cast-modal-title">CALL SHEET</div>
      <div class="cast-modal-subtitle">— Import from personas —</div>
      <div class="cast-modal-field"><label>Priority for imported</label>
        <select data-field="priority">
          ${PRIORITIES.filter(p => p.id !== 'director').map(p =>
            `<option value="${p.id}" ${p.id === 'star' ? 'selected' : ''}>${p.label}${p.id === 'star' ? ' · {{user}}' : ''}</option>`).join('')}
        </select>
        <div class="cast-modal-hint">Star is unique. Extra picks become Leads if you import several as Star.</div>
      </div>
      <div class="cast-modal-field"><label>Personas</label>
        <div class="cast-import-list">
          ${personas.map(p => `
            <label class="cast-import-item ${linkedIds.has(p.id) ? 'linked' : ''}">
              <input type="checkbox" data-persona-id="${esc(p.id)}" ${linkedIds.has(p.id) ? 'disabled' : (p.id === currentId ? 'checked' : '')}>
              <img src="${esc(p.avatarUrl)}" alt="">
              <span style="flex:1">${esc(p.name)}${p.id === currentId ? ' <em style="opacity:.7">(current)</em>' : ''}</span>
              ${linkedIds.has(p.id) ? '<span class="linked-tag">Already cast</span>' : ''}
            </label>
          `).join('')}
        </div>
      </div>
      <div class="cast-modal-actions">
        <button class="cast-btn" data-action="cancel">Cancel</button>
        <button class="cast-btn" data-action="save">Import</button>
      </div>
    `);

    backdrop.querySelector('[data-action="save"]').addEventListener('click', () => {
      const priority = backdrop.querySelector('[data-field="priority"]').value;
      const selected = Array.from(backdrop.querySelectorAll('input[type="checkbox"]:checked'))
        .map(cb => cb.dataset.personaId);
      if (!selected.length) { alert('Select at least one persona.'); return; }
      if (priority === 'star' && !this._claimUniqueRole('star')) return;
      selected.forEach((pid, i) => {
        const p = personas.find(x => x.id === pid);
        if (!p) return;
        const role = (priority === 'star' && i > 0) ? 'lead' : priority;
        this.state.characters.push({
          id: uid(), name: p.name, priority: role,
          portrait: p.avatarUrl, personaId: p.id, syncFromPersona: true,
          characterCardId: '', syncFromCard: false,
          description: p.description || '', aliases: [],
          wardrobe: [], props: [], condition: '', presence: 'inPlay',
          plotHooks: [], genreNotes: '',
          createdAt: Date.now(), updatedAt: Date.now(),
        });
        this.bus.emit('cast.added', { character: this.state.characters.at(-1) });
      });
      this.saveState();
      backdrop.remove();
      this._renderList();
    });
  }

  _openItemDialog(char, kind, existing = null) {
    const isEdit     = !!existing;
    const item       = existing ?? { name: '', description: '', condition: 'pristine', kind: 'item', parentId: null };
    const otherKind  = kind === 'wardrobe' ? 'props' : 'wardrobe';
    const otherLabel = kind === 'wardrobe' ? 'Props' : 'Wardrobe';
    const title      = kind === 'wardrobe' ? 'WARDROBE' : 'PROPS';
    const boxes = (char.props ?? []).filter(x =>
      inferKitKind(x) === 'container' && (!isEdit || x.id !== existing.id),
    );
    const moveBtn    = isEdit
      ? `<button class="cast-btn" data-action="move" style="margin-right:auto">→ Move to ${otherLabel}</button>`
      : '';
    const nestFields = kind === 'props' ? `
      <div class="cast-modal-field">
        <label>What is this?</label>
        <select data-field="kind">
          <option value="item" ${inferKitKind(item) !== 'container' ? 'selected' : ''}>Item</option>
          <option value="container" ${inferKitKind(item) === 'container' ? 'selected' : ''}>Container</option>
        </select>
      </div>
      <div class="cast-modal-field">
        <label>Inside a container (optional)</label>
        <select data-field="parentId">
          <option value="">— Loose / carried —</option>
          ${boxes.map(c =>
            `<option value="${c.id}" ${item.parentId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`,
          ).join('')}
        </select>
      </div>` : '';

    const backdrop = this._buildModal(`
      <div class="cast-modal-title">${title}</div>
      <div class="cast-modal-subtitle">— ${isEdit ? 'Refit item' : 'New item'} for ${esc(char.name)} —</div>
      <div class="cast-modal-field"><label>Name</label>
        <input type="text" data-field="name" value="${esc(item.name)}"></div>
      <div class="cast-modal-field"><label>Description (optional)</label>
        <textarea data-field="description" style="min-height:40px">${esc(item.description ?? '')}</textarea></div>
      <div class="cast-modal-field"><label>Condition</label>
        <select data-field="condition">
          ${CONDITIONS.map(cn =>
            `<option value="${cn.id}" ${cn.id === item.condition ? 'selected' : ''}>${cn.label}</option>`
          ).join('')}
        </select></div>
      ${nestFields}
      <div class="cast-modal-actions">
        ${moveBtn}
        <button class="cast-btn" data-action="cancel">Cancel</button>
        <button class="cast-btn" data-action="save">${isEdit ? 'Save' : 'Add'}</button>
      </div>
    `);

    if (isEdit) {
      backdrop.querySelector('[data-action="move"]')?.addEventListener('click', () => {
        char[kind] = (char[kind] ?? []).filter(x => x.id !== existing.id);
        const moved = { ...existing, parentId: kind === 'props' ? existing.parentId : null };
        if (otherKind === 'wardrobe') moved.parentId = null;
        (char[otherKind] ??= []).push(moved);
        char.updatedAt = Date.now();
        this.saveState();
        this._mirrorStarItem(char, existing, otherKind);
        this.bus.emit('cast.updated', { character: char });
        backdrop.remove();
        this._renderList();
      });
    }

    backdrop.querySelector('[data-action="save"]').addEventListener('click', () => {
      const name = backdrop.querySelector('[data-field="name"]').value.trim();
      if (!name) { alert('Name is required.'); return; }
      const description = backdrop.querySelector('[data-field="description"]').value.trim();
      const condition   = backdrop.querySelector('[data-field="condition"]').value;
      const itemKind = kind === 'props'
        ? (backdrop.querySelector('[data-field="kind"]')?.value || inferKitKind({ name }))
        : 'item';
      let parentId = kind === 'props' ? (backdrop.querySelector('[data-field="parentId"]')?.value || null) : null;
      if (isEdit) {
        Object.assign(existing, { name, description, condition, kind: itemKind, parentId });
      } else {
        (char[kind] ??= []).push({ id: uid(), name, description, condition, kind: itemKind, parentId });
      }
      char.updatedAt = Date.now();
      this.saveState();
      this._mirrorStarItem(char, isEdit ? existing : char[kind].at(-1), kind);
      this.bus.emit('cast.updated', { character: char });
      backdrop.remove();
      this._renderList();
    });
    setTimeout(() => backdrop.querySelector('[data-field="name"]').focus(), 0);
  }

  _invState() {
    const inv = this.storage.getChat('inventory', { static: [], mobile: [], currency: {}, openBoxes: [] });
    if (!Array.isArray(inv.static)) inv.static = [];
    if (!Array.isArray(inv.mobile)) inv.mobile = [];
    return inv;
  }

  _findInvRow(inv, id) {
    if (!id) return null;
    return inv.mobile.find(x => x.id === id) || inv.static.find(x => x.id === id) || null;
  }

  _findInvByName(inv, name) {
    const key = String(name || '').trim().toLowerCase();
    if (!key) return null;
    return inv.mobile.find(x => String(x.name || '').trim().toLowerCase() === key)
      || inv.static.find(x => String(x.name || '').trim().toLowerCase() === key)
      || null;
  }

  _compassBag() {
    const st = this.storage.getChat('backstage', {});
    return { st, compass: ensureCompass(st) };
  }

  _ingestInvFromPiece(piece, kind) {
    const inv = this._invState();
    let row = this._findInvByName(inv, piece?.name);
    if (!row) {
      row = {
        id: uid(),
        kind: piece?.kind === 'container' ? 'container' : 'item',
        name: String(piece?.name || '').trim(),
        description: String(piece?.description || piece?.state || '').trim(),
        condition: piece?.condition || 'fine',
        category: kind === 'wardrobe' ? 'wearable' : (piece?.category || 'misc'),
        parentId: null,
        location: 'mobile',
      };
      inv.mobile.push(row);
    } else {
      if (piece?.description && !row.description) row.description = piece.description;
      if (piece?.condition) row.condition = piece.condition;
      if (kind === 'wardrobe') row.category = 'wearable';
      this._ensureMobile(inv, row);
    }
    return row;
  }

  _knownKitPools() {
    const inv = this._invState();
    const inventory = [...(inv.mobile || []), ...(inv.static || [])];
    let setPieces = [];
    let lost = [];
    try {
      const { compass } = this._compassBag();
      lost = listLostAndFound(compass);
      const here = getActiveRoom(compass);
      const all = listAllSetPieces(compass).filter(p => p.layer !== 'fixtures');
      const local = here?.id ? all.filter(p => p.placeId === here.id) : all;
      const rest = here?.id ? all.filter(p => p.placeId !== here.id) : [];
      setPieces = [...local, ...rest];
    } catch { /* compass missing */ }
    return { inventory, setPieces, lost };
  }

  _knownKitRoster(char, scene, include) {
    const pools = this._knownKitPools();
    const entries = collectKnownKitEntries({ char, ...pools, scene, include, max: 36 });
    return formatKnownKitRoster(entries);
  }

  _claimKnownKit(char, kind, spec) {
    const name = String(spec?.name || '').trim();
    if (!name) return null;
    const wantId = String(spec?.id || '').trim();
    const fold = s => String(s || '').trim().toLowerCase();
    const hitName = (list) => {
      const rows = Array.isArray(list) ? list : [];
      if (wantId) {
        const byId = rows.find(x => x.id === wantId);
        if (byId) return byId;
      }
      return rows.find(x => fold(x.name) === fold(name)) || null;
    };
    const isStar = char.priority === 'star';

    const inv = this._invState();
    const invRow = hitName([...(inv.mobile || []), ...(inv.static || [])]);
    if (invRow) {
      const row = {
        id: uid(),
        name: invRow.name,
        description: String(spec.description || invRow.description || '').slice(0, 200),
        condition: clampItemCondition(spec.condition || invRow.condition, invRow.condition || 'fine'),
      };
      if (isStar) row.inventoryId = invRow.id;
      return row;
    }

    if (!isStar) {
      try {
        const pools = this._knownKitPools();
        const world = hitName([...(pools.lost || []), ...(pools.setPieces || [])]);
        if (world) {
          return {
            id: uid(),
            name: world.name,
            description: String(spec.description || world.description || '').slice(0, 200),
            condition: clampItemCondition(spec.condition || world.condition, world.condition || 'fine'),
          };
        }
      } catch { /* ignore */ }
      return null;
    }

    try {
      const { compass } = this._compassBag();
      const lostHit = hitName(listLostAndFound(compass));
      if (lostHit) {
        const piece = removeFromLostAndFound(compass, lostHit.id) || lostHit;
        const invTaken = this._ingestInvFromPiece(piece, kind);
        this.storage.saveChat();
        this.bus.emit('inventory.updated');
        return {
          id: uid(),
          name: piece.name,
          description: String(spec.description || piece.description || '').slice(0, 200),
          condition: clampItemCondition(spec.condition || piece.condition, piece.condition || 'fine'),
          inventoryId: invTaken.id,
        };
      }
      const setHit = hitName(listAllSetPieces(compass).filter(p => p.layer !== 'fixtures'));
      if (setHit) {
        const piece = pickupItem(compass, setHit.placeId, { itemId: setHit.id });
        const invTaken = this._ingestInvFromPiece(piece, kind);
        this.storage.saveChat();
        this.bus.emit('inventory.updated');
        return {
          id: uid(),
          name: piece.name,
          description: String(spec.description || piece.description || '').slice(0, 200),
          condition: clampItemCondition(spec.condition || piece.condition, piece.condition || 'fine'),
          inventoryId: invTaken.id,
        };
      }
    } catch (err) {
      console.warn('[Cast audit claim]', err);
    }
    return null;
  }

  _ensureMobile(inv, row) {
    this._placeInvRow(inv, row, 'mobile', null);
  }

  _placeInvRow(inv, row, loc, parentId = null) {
    inv.static = inv.static.filter(x => x.id !== row.id);
    inv.mobile = inv.mobile.filter(x => x.id !== row.id);
    row.location = loc === 'static' ? 'static' : 'mobile';
    row.parentId = parentId || null;
    if (row.location === 'static') inv.static.push(row);
    else inv.mobile.push(row);
  }

  _mirrorStarItem(char, item, kind) {
    if (char.priority !== 'star' || !item) return;
    const inv = this._invState();
    let parentInvId = null;
    if (item.parentId) {
      const parent = [...(char.props || []), ...(char.wardrobe || [])].find(x => x.id === item.parentId);
      if (parent && !parent.inventoryId) this._mirrorStarItem(char, parent, 'props');
      parentInvId = parent?.inventoryId || null;
    }
    let row = this._findInvRow(inv, item.inventoryId)
      || this._findInvByName(inv, item.name);
    if (!row) {
      row = {
        id: uid(),
        kind: inferKitKind(item),
        name: item.name,
        description: item.description ?? '',
        condition: item.condition || 'pristine',
        category: kind === 'wardrobe' ? 'wearable' : 'misc',
        parentId: parentInvId,
        location: 'mobile',
      };
      const parentRow = parentInvId ? this._findInvRow(inv, parentInvId) : null;
      this._placeInvRow(inv, row, parentRow?.location || 'mobile', parentInvId);
      item.inventoryId = row.id;
    } else {
      item.inventoryId = row.id;
      row.name = item.name;
      row.description = item.description ?? '';
      row.condition = item.condition || row.condition || 'pristine';
      row.kind = inferKitKind(item);
      if (kind === 'wardrobe') row.category = 'wearable';
      if (parentInvId) {
        const parentRow = this._findInvRow(inv, parentInvId);
        this._placeInvRow(inv, row, parentRow?.location || row.location || 'mobile', parentInvId);
      } else {
        this._ensureMobile(inv, row);
      }
    }
    row.equippedTo = kind === 'wardrobe' ? { type: 'player' } : null;
    this.storage.saveChat();
    this.bus.emit('inventory.updated');
  }

  _unlinkStarItem(char, item, kind) {
    if (char.priority !== 'star' || !item?.inventoryId) return false;
    const inv = this._invState();
    const row = this._findInvRow(inv, item.inventoryId);
    if (!row) return false;
    inv.static = inv.static.filter(x => x.id !== row.id);
    inv.mobile = inv.mobile.filter(x => x.id !== row.id);
    row.parentId = null;
    row.location = 'static';
    row.equippedTo = null;
    inv.static.push(row);
    this.storage.saveChat();
    this.bus.emit('inventory.updated');
    return true;
  }

  _sendItemToLostAndFound(item, kind) {
    const name = String(item?.name || '').trim();
    if (!name) return;
    try {
      const { compass } = this._compassBag();
      const hit = listLostAndFound(compass).find(
        p => String(p.name || '').trim().toLowerCase() === name.toLowerCase(),
      );
      if (hit) return;
      addToLostAndFound(compass, {
        name,
        description: item.description || '',
        condition: item.condition || 'fine',
        category: kind === 'wardrobe' ? 'wearable' : (item.category || 'misc'),
      }, { layer: 'clutter' });
      this.storage.saveChat();
    } catch (err) {
      console.warn('[Cast relinquish]', err);
    }
  }

  _relinquishKitItem(char, item, kind) {
    if (!item) return;
    if (char.priority === 'star' && this._unlinkStarItem(char, item, kind)) return;
    this._sendItemToLostAndFound(item, kind);
  }

  _sceneOptionsHTML(sceneUid = '') {
    const scenes = getSceneCards(this.storage);
    return `
      <option value="">— Not connected —</option>
      ${scenes.map(s =>
        `<option value="${esc(s.uid)}" ${s.uid === sceneUid ? 'selected' : ''}>${esc(s.code)} — ${esc(s.title)}</option>`).join('')}`;
  }

  _persistPlotHook(char, hook) {
    const result = syncBeatFromHook(this.storage, hook);
    char.updatedAt = Date.now();
    this.saveState();
    this.bus.emit('cast.updated', { character: char });
    if (result.landed) {
      this.bus.emit('motivation.updated', { characterId: result.characterId });
    }
    return result;
  }

  _openInjectEventDialog() {
    let prod = {};
    try { prod = this.storage.getChat('backstage', {})?.production || {}; } catch { /* ignore */ }
    const src = mergeDirectorSources(prod.sources);
    const facets = src.tagFacets || {};
    const pools = listDirectorInjectPools(this.storage);
    const modeId = EVENT_MODES.some(m => m.id === prod.intrusiveness) ? prod.intrusiveness : 'advance';
    const randomOn = !!prod.intrudeRandom;

    const poolBox = (title, rows, dataKey) => {
      if (!rows.length) {
        return `<div class="cast-modal-field"><label>${esc(title)}</label>
          <div class="cast-tag-empty">None filed yet.</div></div>`;
      }
      return `<div class="cast-modal-field"><label>${esc(title)}</label>
        <div class="cast-inject-pool">
          ${rows.map(r => `<label class="cast-inject-opt">
            <input type="checkbox" data-pool="${esc(dataKey)}" value="${esc(r.key || r.id)}">
            <span>${esc(r.line || (r.who ? `${r.title} (${r.who})` : r.title))}</span>
          </label>`).join('')}
        </div></div>`;
    };

    const aliasOpts = (member) => {
      if (!member) return '<option value="">— Pick a cast member —</option>';
      const names = [member.name, ...(member.aliases || [])]
        .map(n => String(n || '').trim())
        .filter(Boolean);
      const seen = new Set();
      return names.filter(n => {
        const k = n.toLowerCase();
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      }).map((n, i) => `<option value="${esc(n)}" ${i === 0 ? 'selected' : ''}>${esc(n)}</option>`).join('');
    };

    const backdrop = this._buildModal(`
      <div class="cast-modal-title">INJECT EVENT</div>
      <div class="cast-modal-subtitle">— Director check —</div>
      <p class="cast-modal-hint">Uses Production settings for this roll. Pins below are optional — the Director must weave any you select. Works even if Director on call is off.</p>
      <div class="cast-modal-field"><label>Intrusiveness</label>
        <div class="cast-inject-modes">
          ${EVENT_MODES.map(i => `
            <label class="cast-inject-opt" title="${esc(i.tip || '')}">
              <input type="radio" name="cast-intrude" data-field="intrusiveness" value="${esc(i.id)}"
                ${modeId === i.id ? 'checked' : ''} ${randomOn ? 'disabled' : ''}>
              ${esc(i.label)}
            </label>`).join('')}
          <label class="cast-inject-opt" title="Each check rolls Derail, Twist, Advance, or Pressure at random">
            <input type="checkbox" data-field="intrudeRandom" ${randomOn ? 'checked' : ''}>
            Random
          </label>
        </div>
        <div class="cast-modal-hint" data-role="intrude-tip">${esc(randomOn
          ? 'Random — each check picks how hard the beat hits'
          : (EVENT_MODES.find(m => m.id === modeId)?.tip || ''))}</div>
      </div>
      <div class="cast-modal-field"><label>Director may pull from</label>
        <div class="cast-inject-sources">
          <label class="cast-inject-opt"><input type="checkbox" data-src="tags" ${src.tags ? 'checked' : ''}> Limit by tag</label>
          <div class="cast-inject-facets" data-role="tags-facets" ${src.tags ? '' : 'hidden'}>
            ${DIRECTOR_TAG_FACETS.map(f =>
              `<label class="cast-inject-opt"><input type="checkbox" data-facet="${esc(f.id)}" ${facets[f.id] !== false ? 'checked' : ''}> ${esc(f.label)}</label>`).join('')}
          </div>
          <label class="cast-inject-opt"><input type="checkbox" data-src="stage" ${src.stage !== false ? 'checked' : ''}> Stage / Set</label>
          <label class="cast-inject-opt"><input type="checkbox" data-src="inventory" ${src.inventory ? 'checked' : ''}> Inventory</label>
          <div class="cast-inject-facets" data-role="inv-facets" ${src.inventory ? '' : 'hidden'}>
            <label class="cast-inject-opt"><input type="checkbox" data-src="inventoryOnPerson" ${src.inventoryOnPerson !== false ? 'checked' : ''}> On Person</label>
            <label class="cast-inject-opt"><input type="checkbox" data-src="inventoryTrunk" ${src.inventoryTrunk !== false ? 'checked' : ''}> Trunk</label>
          </div>
          <label class="cast-inject-opt"><input type="checkbox" data-src="script" ${src.script ? 'checked' : ''}> Script</label>
          <div class="cast-inject-facets" data-role="script-facets" ${src.script ? '' : 'hidden'}>
            <label class="cast-inject-opt"><input type="checkbox" data-src="scriptStampedLore" ${src.scriptStampedLore ? 'checked' : ''}> Stamped lorebook entries</label>
          </div>
          <label class="cast-inject-opt"><input type="checkbox" data-src="events" ${src.events !== false ? 'checked' : ''}> Events &amp; Holidays</label>
          <label class="cast-inject-opt"><input type="checkbox" data-src="library" ${src.library ? 'checked' : ''}> Library</label>
          <label class="cast-inject-opt"><input type="checkbox" data-src="reputation" ${src.reputation ? 'checked' : ''}> Reputation</label>
          <label class="cast-inject-opt"><input type="checkbox" data-src="motivation" ${src.motivation ? 'checked' : ''}> Motivation</label>
        </div>
      </div>
      <div class="cast-modal-field"><label>Cast member (optional)</label>
        <select data-field="castId">
          <option value="">— Any / Director’s pick —</option>
          ${pools.cast.map(c =>
            `<option value="${esc(c.id)}">${esc(c.name)}${c.priority === 'director' ? ' (Director)' : ''}</option>`).join('')}
        </select>
      </div>
      <div class="cast-modal-field" data-role="alias-wrap" hidden>
        <label>Alias for generation</label>
        <select data-field="alias">${aliasOpts(null)}</select>
        <div class="cast-modal-hint">The beat will use this name instead of the card’s primary name.</div>
      </div>
      ${poolBox('Motivations (beats)', pools.beats, 'beat')}
      ${poolBox('Plot hooks', pools.hooks, 'hook')}
      ${poolBox('Secrets', pools.secrets, 'secret')}
      ${poolBox('Achievements', pools.achievements, 'achievement')}
      <div class="cast-modal-actions">
        <button class="cast-btn" data-action="cancel">Cancel</button>
        <button class="cast-btn gold" data-action="save">Generate</button>
      </div>
    `);
    backdrop.querySelector('.cast-modal')?.classList.add('cast-modal--wide');

    const randomCb = backdrop.querySelector('[data-field="intrudeRandom"]');
    const radios = () => backdrop.querySelectorAll('[data-field="intrusiveness"]');
    const tipEl = backdrop.querySelector('[data-role="intrude-tip"]');
    const syncIntrude = () => {
      const rand = !!randomCb?.checked;
      radios().forEach(r => { r.disabled = rand; });
      const id = backdrop.querySelector('[data-field="intrusiveness"]:checked')?.value || modeId;
      tipEl.textContent = rand
        ? 'Random — each check picks how hard the beat hits'
        : (EVENT_MODES.find(m => m.id === id)?.tip || '');
    };
    randomCb?.addEventListener('change', syncIntrude);
    radios().forEach(r => r.addEventListener('change', syncIntrude));

    const toggleRow = (srcName, role) => {
      const on = backdrop.querySelector(`[data-src="${srcName}"]`)?.checked;
      const row = backdrop.querySelector(`[data-role="${role}"]`);
      if (row) row.hidden = !on;
    };
    backdrop.querySelector('[data-src="tags"]')?.addEventListener('change', () => toggleRow('tags', 'tags-facets'));
    backdrop.querySelector('[data-src="inventory"]')?.addEventListener('change', () => toggleRow('inventory', 'inv-facets'));
    backdrop.querySelector('[data-src="script"]')?.addEventListener('change', () => toggleRow('script', 'script-facets'));

    const castSel = backdrop.querySelector('[data-field="castId"]');
    const aliasWrap = backdrop.querySelector('[data-role="alias-wrap"]');
    const aliasSel = backdrop.querySelector('[data-field="alias"]');
    const fillAlias = () => {
      const member = pools.cast.find(c => c.id === castSel.value);
      aliasWrap.hidden = !member;
      aliasSel.innerHTML = aliasOpts(member);
    };
    castSel?.addEventListener('change', fillAlias);

    backdrop.querySelector('[data-action="save"]').addEventListener('click', () => {
      const sources = mergeDirectorSources(src);
      backdrop.querySelectorAll('[data-src]').forEach(el => {
        sources[el.dataset.src] = !!el.checked;
      });
      sources.tagFacets = { ...sources.tagFacets };
      backdrop.querySelectorAll('[data-facet]').forEach(el => {
        sources.tagFacets[el.dataset.facet] = !!el.checked;
      });
      const checked = (key) => [...backdrop.querySelectorAll(`[data-pool="${key}"]:checked`)].map(el => el.value);
      const picks = {
        castId: castSel.value || '',
        alias: aliasWrap.hidden ? '' : (aliasSel.value || ''),
        beatIds: checked('beat'),
        hookIds: checked('hook'),
        secretIds: checked('secret'),
        achievementIds: checked('achievement'),
      };
      const settings = {
        intrusiveness: backdrop.querySelector('[data-field="intrusiveness"]:checked')?.value || modeId,
        intrudeRandom: !!randomCb?.checked,
        sources,
      };
      backdrop.remove();
      this.bus.emit('production.forceDirectorCheck', { settings, picks });
    });
  }

  _openPlotHookDialog(char, existing = null) {
    const isEdit = !!existing;
    const hook = normalizePlotHook(existing) || { name: '', description: '', assignedTo: '', sceneUid: '', active: true };
    const hint = isEdit ? hookBoardHint(this.storage, hook) : 'Assign a Star, Lead, Major, or Foil and link a Script scene to file this on their Motivation board.';

    const backdrop = this._buildModal(`
      <div class="cast-modal-title">PLOT HOOK</div>
      <div class="cast-modal-subtitle">— ${isEdit ? 'Refit hook' : 'New hook'} —</div>
      <div class="cast-modal-field"><label>Name</label>
        <input type="text" data-field="name" value="${esc(hook.name)}"></div>
      <div class="cast-modal-field"><label>Description (optional)</label>
        <textarea data-field="description" style="min-height:40px">${esc(hook.description)}</textarea></div>
      <div class="cast-modal-field"><label>Assigned to</label>
        <select data-field="assignedTo">${this._hookAssigneeOptions(hook.assignedTo)}</select>
        <div class="cast-modal-hint">Who this pressure sits on. Unassigned hooks stay in the Director’s pool.</div>
      </div>
      <div class="cast-modal-field"><label>Script scene</label>
        <select data-field="sceneUid">${this._sceneOptionsHTML(hook.sceneUid)}</select>
        <div class="cast-modal-hint">${esc(hint)}</div>
      </div>
      <div class="cast-modal-field">
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;text-transform:none;
          letter-spacing:0;font-family:var(--st-font-body);font-size:12px;color:var(--st-ink)">
          <input type="checkbox" data-field="active" ${hook.active !== false ? 'checked' : ''} style="width:auto">
          Active (inject into prompts)
        </label>
      </div>
      <div class="cast-modal-actions">
        <button class="cast-btn" data-action="cancel">Cancel</button>
        <button class="cast-btn" data-action="save">${isEdit ? 'Save' : 'Add'}</button>
      </div>
    `);

    backdrop.querySelector('[data-action="save"]').addEventListener('click', () => {
      const name = backdrop.querySelector('[data-field="name"]').value.trim();
      const description = backdrop.querySelector('[data-field="description"]').value.trim();
      const assignedTo = backdrop.querySelector('[data-field="assignedTo"]').value.trim();
      const sceneUid = backdrop.querySelector('[data-field="sceneUid"]').value.trim();
      const active = backdrop.querySelector('[data-field="active"]').checked;
      if (!name) { alert('Name is required.'); return; }
      const next = { name, description, assignedTo, sceneUid, active, text: name };
      let row = existing;
      if (isEdit) {
        Object.assign(existing, next);
      } else {
        row = { id: uid(), stepId: '', ...next };
        (char.plotHooks ??= []).push(row);
      }
      const result = this._persistPlotHook(char, row);
      backdrop.remove();
      this._renderList();
      if (result.reason === 'billing' && assignedTo && sceneUid) {
        alert('Motivation boards are for Star, Lead, Major, or Foil. The hook is saved here until you reassign it.');
      }
    });
    setTimeout(() => backdrop.querySelector('[data-field="name"]').focus(), 0);
  }

  _openPullHooksDialog(char) {
    const rows = listPullableBeats(this.storage);
    if (!rows.length) {
      alert('No unlinked Motivation beats to pull. Add beats on a Star, Lead, Major, or Foil first.');
      return;
    }
    const groups = [];
    const byChar = new Map();
    for (const row of rows) {
      if (!byChar.has(row.characterId)) {
        const g = { id: row.characterId, name: row.characterName, items: [] };
        byChar.set(row.characterId, g);
        groups.push(g);
      }
      byChar.get(row.characterId).items.push(row);
    }
    const backdrop = this._buildModal(`
      <div class="cast-modal-title">FROM MOTIVATION</div>
      <div class="cast-modal-subtitle">— pull beats onto the Director’s hook list —</div>
      <div class="cast-pull-list">
        ${groups.map(g => `
          <div class="cast-pull-group">
            <div class="cast-pull-who">${esc(g.name)}</div>
            ${g.items.map(it => `
              <label class="cast-pull-row">
                <input type="checkbox" data-char="${esc(it.characterId)}" data-step="${esc(it.step.id)}" checked>
                <span class="cast-pull-title">${esc(it.step.title || 'Untitled beat')}</span>
                <span class="cast-pull-scene">${esc(it.scene || 'No scene')}</span>
              </label>`).join('')}
          </div>`).join('')}
      </div>
      <div class="cast-modal-hint">Checked beats become plot hooks assigned to that character. Linked scenes come along.</div>
      <div class="cast-modal-actions">
        <button class="cast-btn" data-action="cancel">Cancel</button>
        <button class="cast-btn" data-action="save">Pull selected</button>
      </div>
    `);
    backdrop.querySelector('[data-action="save"]').addEventListener('click', () => {
      const picks = [...backdrop.querySelectorAll('input[type="checkbox"]:checked')];
      if (!picks.length) { alert('Select at least one beat.'); return; }
      let n = 0;
      const touched = new Set();
      for (const el of picks) {
        const hit = rows.find(r => r.characterId === el.dataset.char && r.step.id === el.dataset.step);
        if (!hit) continue;
        const out = pullBeatAsHook(this.storage, hit.characterId, hit.step);
        if (out.created) n += 1;
        if (out.hooked) touched.add(hit.characterId);
      }
      char.updatedAt = Date.now();
      this.saveState();
      this.bus.emit('cast.updated', { character: char });
      for (const id of touched) this.bus.emit('motivation.updated', { characterId: id });
      backdrop.remove();
      this._renderList();
      if (!n) alert('Those beats were already plot hooks.');
    });
  }

  _buildModal(innerHtml) {
    const backdrop = document.createElement('div');
    backdrop.className = 'cast-modal-backdrop';
    backdrop.innerHTML = `<div class="cast-modal" role="dialog" aria-modal="true">${innerHtml}</div>`;
    document.body.appendChild(backdrop);
    const close = () => backdrop.remove();
    backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });
    backdrop.addEventListener('keydown', e => {
      if (e.key === 'Escape') close();
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter')
        backdrop.querySelector('[data-action="save"]')?.click();
    });
    backdrop.querySelector('[data-action="cancel"]')?.addEventListener('click', close);
    return backdrop;
  }

  // ─── data helpers ────────────────────────────────────────────────────────────

  _sortedFiltered() {
    const q = (this.state.filterQuery ?? '').toLowerCase().trim();
    const hidden = new Set(this._hiddenRoles());
    const hiddenPresence = new Set(this._hiddenPresence());
    let list = this.state.characters.filter(c => {
      if (hidden.has(c.priority)) return false;
      const presence = normalizePresence(c);
      if (hiddenPresence.has(presence)) return false;
      if (!q) return true;
      const hay = [
        c.name, c.description, c.summary, c.appearance,
        this._houseLabel(c.affiliationHouseId),
        ...normalizeAliases(c.aliases),
      ].join(' ').toLowerCase();
      return hay.includes(q);
    });
    const by = this.state.sortBy ?? 'priority';
    if (by === 'priority') {
      list = list.slice().sort((a, b) => {
        const oa = PRIORITY_MAP[a.priority]?.order ?? 99;
        const ob = PRIORITY_MAP[b.priority]?.order ?? 99;
        return oa !== ob ? oa - ob : (a.name ?? '').localeCompare(b.name ?? '');
      });
    } else if (by === 'name') {
      list = list.slice().sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
    } else if (by === 'recent') {
      list = list.slice().sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
    }
    return list;
  }

  _find(id) {
    return this.state.characters.find(c => c.id === id);
  }

  _repHouses() {
    try {
      return (this.storage.getChat('reputation', { house: [] }).house || [])
        .filter(h => h && h.id)
        .slice()
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    } catch {
      return [];
    }
  }

  _houseLabel(houseId) {
    const id = String(houseId || '').trim();
    if (!id) return '';
    const h = this._repHouses().find(x => x.id === id);
    if (!h?.name) return '';
    return h.alias ? `${h.name} (${h.alias})` : h.name;
  }

  _affiliationId(char) {
    const explicit = String(char?.affiliationHouseId || '').trim();
    if (explicit) return explicit;
    return characterHouseIds(this.storage, char?.id)[0] || '';
  }

  _syncAffiliation(charId, houseId) {
    const cid = String(charId || '').trim();
    const hid = String(houseId || '').trim();
    if (!cid || !hid) return;
    try {
      const rep = this.storage.getChat('reputation', { house: [] });
      const h = (rep.house || []).find(x => x.id === hid);
      if (!h) return;
      if (h.headId === cid) return;
      h.connections = Array.isArray(h.connections) ? h.connections : [];
      if (h.connections.some(c => c.characterId === cid)) return;
      h.connections.push({ characterId: cid, role: '' });
      this.storage.saveChat();
      this.bus?.emit('reputation.updated', {});
    } catch { /* reputation optional */ }
  }

  _getCharacterCards() {
    return (getContext().characters ?? []).map(c => ({
      id: c.avatar,
      name: c.name ?? 'Unnamed',
      avatarUrl: `/thumbnail?type=avatar&file=${encodeURIComponent(c.avatar)}`,
    }));
  }

  _getInCurrentChat() {
    const ctx = getContext();
    const inChat = new Set();
    const groupId = ctx.groupId ?? ctx.selected_group ?? null;
    const chid    = ctx.characterId ?? ctx.this_chid ?? null;
    if (groupId != null) {
      const group = (ctx.groups ?? []).find(g => g.id === groupId);
      if (group) (group.members ?? []).forEach(m => inChat.add(m));
    } else if (chid != null) {
      const char = (ctx.characters ?? [])[chid];
      if (char?.avatar) inChat.add(char.avatar);
    }
    return inChat;
  }

  _getPersonas() {
    const names = power_user?.personas ?? {};
    const descs = power_user?.persona_descriptions ?? {};
    return Object.entries(names).map(([id, name]) => ({
      id,
      name: name || id,
      description: descs[id]?.description ?? '',
      title: descs[id]?.title ?? '',
      avatarUrl: getThumbnailUrl('persona', id),
    })).sort((a, b) => a.name.localeCompare(b.name));
  }

  _resolveDisplay(char) {
    if (char.personaId) {
      const p = this._getPersonas().find(x => x.id === char.personaId);
      if (p) {
        return {
          name: char.syncFromPersona ? p.name : (char.name?.trim() || p.name),
          portrait: char.syncFromPersona ? p.avatarUrl : (char.portrait || p.avatarUrl),
        };
      }
    }
    if (char.characterCardId) {
      const card = this._getCharacterCards().find(c => c.id === char.characterCardId);
      if (card) {
        return {
          name:    char.name?.trim() || card.name,
          portrait: char.syncFromCard ? card.avatarUrl : (char.portrait || card.avatarUrl),
        };
      }
    }
    return { name: char.name, portrait: char.portrait };
  }

  /** Strip HTML / collapse whitespace so chat excerpts stay tiny. */
  _plainMes(mes) {
    return String(mes ?? '')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, ' ')
      .trim();
  }

  _formatChatLine(m) {
    const body = this._plainMes(m?.mes).slice(0, 180);
    if (!body) return '';
    const name = String(m?.name || (m?.is_user ? 'You' : '')).trim() || '…';
    return `${name}: ${body}`;
  }

  _getPlotHookContext(ctx) {
    const rows = recentPlayMessages(ctx.chat ?? [], 16);
    return clipExcerptToLines(rows.map(m => this._formatChatLine(m)).filter(Boolean).join('\n'), 2400);
  }

  _auditIdentityLine(char, identity, { full = true } = {}) {
    const name = identity?.displayName || identity?.name || char.name || 'Unnamed';
    const role = priorityMeta(char.priority)?.label || char.priority || 'cast';
    if (!full) return `${name} (${role})`;
    const forms = formatPronounsPromptLine({ ...char, name: '' });
    const ego = identity?.alterEgoName ? ` · ego ${identity.alterEgoName}` : '';
    return `${name} (${role}${ego})${forms ? ` · ${forms}` : ''}`;
  }

  _isAuditRateLimit(text) {
    return /too many requests|\b429\b|rate.?limit|resource has been exhausted/i.test(String(text || ''));
  }

  /**
   * Isolated quiet generation — pin to this prompt; never ride ST's card/history.
   */
  async _quietAudit(prompt, { jsonSchema = null, responseLength = FILING_RESPONSE_LENGTH } = {}) {
    const text = String(prompt || '').trim();
    const isRate = (t) => this._isAuditRateLimit(t);
    const chatToken = getContext()?.chatMetadata ?? null;
    const guard = (out) => {
      if ((getContext()?.chatMetadata ?? null) !== chatToken) throw new Error('Chat changed during generation — result discarded.');
      return out;
    };
    const schema = jsonSchema && schemaAllowed() ? jsonSchema : null;
    return guard(await withShowtimeProfile(this.storage, 'audit', async () => {
      const response = await leanQuietGenerate(text, {
        jsonSchema: schema,
        responseLength,
        kind: 'filing',
      });
      if (!response) throw new Error('Empty audit reply.');
      if (isRate(response)) {
        throw new Error('Too many requests — wait a few seconds and press Audit again.');
      }
      return response;
    }));
  }

  // ─── audit ───────────────────────────────────────────────────────────────────

  async _runAudit(char, kind, btn, opts = {}) {
    if (this._auditBusy) {
      if (!btn?.dataset?.quiet) alert('An audit is already running. Wait for it to finish.');
      return;
    }
    const now = Date.now();
    const quiet = !!btn?.dataset?.quiet;
    if (!quiet && this._auditLastAt && now - this._auditLastAt < 1600) {
      alert('Too soon — wait a moment before another Audit (avoids rate limits).');
      return;
    }
    this._auditLastAt = now;
    this._auditBusy = true;
    if (btn) btn.disabled = true;
    const origText = btn?.textContent;
    if (btn) btn.textContent = '...';
    try {
      const ctx = getContext();
      const identity = resolveCastPromptIdentity(char, this.storage, {
        characters: ctx.characters ?? [],
        personas: this._getPersonas(),
      });

      if (kind === 'hooks') {
        const who = this._auditIdentityLine(char, identity, { full: true });
        const recentChat = this._getPlotHookContext(ctx) || '(no recent scene)';
        const roster = this.state.characters.filter(c => c.priority !== 'director');
        const rosterLines = roster.map(c =>
          `- ${c.name} | id=${c.id} | ${PRIORITY_MAP[c.priority]?.label || c.priority}`
        ).join('\n') || '(no cast besides Director)';
        const existing = (char.plotHooks ?? [])
          .map(h => normalizePlotHook(h))
          .filter(Boolean)
          .map(h => `- ${h.name}${h.assignedTo ? ` → ${this.state.characters.find(c => c.id === h.assignedTo)?.name || h.assignedTo}` : ''}`)
          .join('\n') || 'None';
        const prompt = `JSON array only. Potential plot hooks from the chat history below: unresolved tensions, promises, mysteries, deadlines, debts, secrets leaking, obligations, dangling questions. Ground each hook in the scene — no card lore, no invented subplots.
Director keywords: ${directorKeywords(this.storage, char).join('; ') || '—'}
Cast (assign a hook to one of these when it clearly belongs to them; otherwise assignedTo empty):
${rosterLines}
Already listed (do not repeat):
${existing}
Chat:
${recentChat}
0–8 hooks. assignedTo must be a listed id, a listed name, or "".
[{"name":"short title","description":"one sentence","assignedTo":""}]`;
        const jsonSchema = {
          name: 'cast_plot_hooks',
          description: 'Potential plot hooks from chat',
          strict: false,
          returnInvalid: true,
          value: {
            type: 'array', maxItems: 8,
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                description: { type: 'string' },
                assignedTo: { type: 'string' },
              },
              required: ['name'],
            },
          },
        };
        const response = await this._quietAudit(prompt, { jsonSchema, responseLength: FILING_RESPONSE_LENGTH });
        const items = parseJsonArray(response);
        if (!Array.isArray(items)) throw new Error('No JSON array in AI response.');
        const have = new Set((char.plotHooks ?? [])
          .map(h => String(normalizePlotHook(h)?.name || '').toLowerCase())
          .filter(Boolean));
        (char.plotHooks ??= []);
        items.forEach(it => {
          const name = String(it?.name || it?.text || it?.title || '').trim().slice(0, 80);
          if (!name || have.has(name.toLowerCase())) return;
          have.add(name.toLowerCase());
          char.plotHooks.push({
            id: uid(),
            name,
            text: name,
            description: String(it.description ?? '').trim().slice(0, 240),
            assignedTo: this._matchHookAssignee(it.assignedTo || it.character || it.who),
            active: true,
          });
        });
        char.updatedAt = Date.now();
        this.saveState();
        this.bus.emit('cast.updated', { character: char });
        this._renderList();
        return;
      }

      if (kind === 'stats') {
        if (!char.stats) char.stats = DEFAULT_STATS();
        if (!char.stats.enabled) throw new Error('Enable Track on Stats before auditing.');
      }

      const include = Array.isArray(opts.include) && opts.include.length
        ? opts.include
        : auditIncludeForKind(kind, char);
      if (!include.length) return null;
      const who = this._auditIdentityLine(char, identity, {
        full: include.includes('stats') || include.includes('condition'),
      });

      const excerptChar = {
        ...char,
        name: identity.displayName || identity.name || char.name,
      };
      const kitOn = include.includes('stats') || include.includes('wardrobe') || include.includes('props');
      const excerptOpts = {
        char: excerptChar,
        sinceCount: opts.sinceCount,
        cap: kitOn ? KIT_SCENE_CAP : undefined,
        lineCap: kitOn ? KIT_LINE_CAP : undefined,
      };
      const kitHay = opts.scene ? String(opts.scene) : sceneKitHay(ctx.chat, excerptOpts);
      const recentChat = opts.scene
        || sceneExcerpt(ctx.chat, excerptOpts)
        || '(no recent scene)';

      let difficulty = 'normal';
      try { difficulty = this.storage.getChat('backstage', {})?.trackers?.status?.difficulty || 'normal'; } catch { /* ignore */ }

      let trackerSnapshot = { trackers: [], lines: '' };
      if (include.includes('stats')) {
        if (!char.stats) char.stats = DEFAULT_STATS();
        trackerSnapshot = this._statsAuditSnapshot(char);
      }

      let consumables = '';
      if (include.includes('stats') && char.priority === 'star') {
        try {
          const inv = this.storage.getChat('inventory', { static: [], mobile: [] });
          consumables = formatPacksForPrompt(inv.mobile || []);
        } catch { /* ignore */ }
      }

      const snapshot = kitSnapshot(char, {
        trackerLines: trackerSnapshot.lines,
        trackerIds: trackerSnapshot.trackers.map(t => t.id),
        trackerRows: trackerSnapshot.trackers,
        knownKit: (include.includes('wardrobe') || include.includes('props'))
          ? this._knownKitRoster(char, kitHay || recentChat, include)
          : '',
        consumables,
      });
      const prompt = buildCastDeltaPrompt({
        who,
        scene: recentChat,
        snapshot,
        include,
        difficultyHint: include.includes('stats') ? difficultyAuditHint(difficulty) : '',
        garmentHay: kitHay,
      });
      const jsonSchema = castDeltaSchema(include, {
        trackerIds: trackerSnapshot.trackers.map(t => t.id),
      });
      const response = await this._quietAudit(prompt, {
        jsonSchema,
        responseLength: include.includes('stats') ? 4000 : FILING_RESPONSE_LENGTH,
      });
      const delta = parseCastDelta(response, {
        include,
        trackers: trackerSnapshot.trackers,
      });

      let statsOut = { diffs: [], condition: '' };
      if (include.includes('stats') && delta.stats) {
        statsOut = this._applyStatsAudit(char, { stats: delta.stats });
      } else if (kind === 'stats' && !delta.stats) {
        throw new Error('Audit returned no tracker values. Try Audit again.');
      }
      const kitOut = applyCastDelta(char, delta, {
        include,
        onStarAdd: (c, item, k) => this._mirrorStarItem(c, item, k),
        onStarUpdate: (c, item, k) => this._mirrorStarItem(c, item, k),
        onStarRemove: (c, item, k) => this._relinquishKitItem(c, item, k),
        onStarMove: (c, item, fromKind, toKind) => {
          this._unlinkStarItem(c, item, fromKind);
          this._mirrorStarItem(c, item, toKind);
        },
        claimKnown: (c, k, it) => this._claimKnownKit(c, k, it),
      });
      if (kitOut.condition) statsOut.condition = kitOut.condition;

      char.updatedAt = Date.now();
      this.saveState();
      this.bus.emit('cast.updated', { character: char });
      this._renderList();
      const out = { ...statsOut, kit: kitOut.changes || [] };
      if (!quiet) this._announceStatusBatch([{ char, ...out }]);
      return out;
    } catch (err) {
      console.error('[Cast audit]', err);
      const msg = String(err?.message || err);
      if (!quiet) {
        alert(this._isAuditRateLimit(msg)
          ? 'Too many requests — wait a few seconds and press Audit again.'
          : `Audit failed: ${msg}`);
      }
    } finally {
      this._auditBusy = false;
      if (btn) {
        btn.disabled = false;
        if (origText != null) btn.textContent = origText;
      }
    }
  }

  /** Enabled tracker defs + prompt lines for stats audit (no wardrobe/props). */
  _statsAuditSnapshot(char) {
    const stats = char.stats ?? DEFAULT_STATS();
    const customDefs = customBarDefsFromTrackers(this.storage);
    const defs = [
      ...STAT_DEFS.base,
      ...(stats.hardMode ? STAT_DEFS.hard : []),
      ...customDefs,
    ];
    const trackers = defs.map(def => {
      const val = def.custom
        ? this._customStatValue(stats, def.id)
        : clamp(stats[def.id] ?? (def.direction === 'down' ? 0 : 100));
      const label = stateLabel(def, val);
      return {
        id: def.id,
        label: def.label,
        value: val,
        state: label,
        custom: !!def.custom,
        direction: def.direction || 'up',
        auditHint: def.auditHint || def.description || '',
      };
    });
    const lines = trackers.map(t => {
      const hint = t.auditHint ? ` — ${t.auditHint}` : '';
      return `- id=${t.id} label="${t.label}" now=${t.value}${t.state ? ` (${t.state})` : ''} ${t.direction === 'down' ? 'higher=worse' : 'higher=better'}${hint}`;
    }).join('\n') || '(none)';
    return { trackers, lines };
  }

  _applyStatsAudit(char, parsed) {
    if (!char.stats) char.stats = DEFAULT_STATS();
    const bag = parsed?.stats && typeof parsed.stats === 'object' ? parsed.stats : parsed;
    if (!bag || typeof bag !== 'object') throw new Error('Missing stats object in AI response.');
    const customDefs = customBarDefsFromTrackers(this.storage);
    const customIds = new Set(customDefs.map(d => d.id));
    const baseIds = new Set(STAT_DEFS.base.map(d => d.id));
    const hardIds = new Set(STAT_DEFS.hard.map(d => d.id));
    const defs = [...STAT_DEFS.base, ...STAT_DEFS.hard, ...customDefs];
    const defById = Object.fromEntries(defs.map(d => [d.id, d]));
    const dirById = Object.fromEntries(defs.map(d => [d.id, d.direction === 'down' ? 'down' : 'up']));
    let difficulty = 'normal';
    try { difficulty = this.storage.getChat('backstage', {})?.trackers?.status?.difficulty || 'normal'; } catch { /* ignore */ }
    if (!char.stats.custom || typeof char.stats.custom !== 'object') char.stats.custom = {};
    const diffs = [];
    for (const [rawId, raw] of Object.entries(bag)) {
      if (rawId === 'condition' || rawId === 'enabled' || rawId === 'hardMode' || rawId === 'custom') continue;
      const id = resolveTrackerId(rawId, defs) || String(rawId || '').trim();
      const n = Number(raw);
      if (!id || !Number.isFinite(n)) continue;
      const proposed = clamp(Math.round(n));
      const def = defById[id];
      const current = customIds.has(id)
        ? this._customStatValue(char.stats, id)
        : clamp(char.stats[id] ?? (dirById[id] === 'down' ? 0 : 100));
      const val = applyDifficultyToStat(current, proposed, {
        difficulty,
        direction: dirById[id] || 'up',
      });
      if (customIds.has(id)) char.stats.custom[id] = val;
      else if (baseIds.has(id) || (char.stats.hardMode && hardIds.has(id))) char.stats[id] = val;
      else continue;
      if (val === current) continue;
      diffs.push({
        id,
        label: def?.label || id,
        from: current,
        to: val,
        fromState: def ? stateLabel(def, current) : '',
        toState: def ? stateLabel(def, val) : '',
        levelMode: def?.levelMode || 'label',
      });
    }
    return { diffs, condition: '' };
  }
}

// ─── module-level utilities ───────────────────────────────────────────────────

function uid() {
  return crypto?.randomUUID?.() ?? ('c_' + Math.random().toString(36).slice(2, 10));
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, ch =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}

function clamp(n, min = 0, max = 100) {
  return Math.max(min, Math.min(max, n));
}