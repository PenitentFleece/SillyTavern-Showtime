// Live Now sidecar: occupancy + clock. Kit / here-items stay derived at render.
// Ledger holds this-scene deltas (hooks, secrets, standings, stats, conditions, presence).

import { defaultStandingChild, ensureCompass, findPlaceIdByKey, syncOccupancyRoom } from './compass/state.js';
export { defaultStandingChild };
import { normalizePendingCue, normalizeTrackers, clapperIsShowing } from './trackersConfig.js';
import {
  commitTravel,
  defaultTravel,
  formatOccupancyLabel,
  formatTravelLine,
  isTransitVehicleKey,
  normalizeTravel,
} from './travelState.js';

const NOW_KEY = 'now';
export const LEDGER_CAP = 8;
const LEDGER_KINDS = new Set(['hook', 'secret', 'achievement', 'standing', 'stat', 'condition', 'presence', 'offscreen']);

function clipLedgerText(raw) {
  return String(raw || '').replace(/\s+/g, ' ').trim().slice(0, 160);
}

export function normalizeLedgerRow(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const kind = LEDGER_KINDS.has(String(raw.kind || '').trim()) ? String(raw.kind).trim() : '';
  const text = clipLedgerText(raw.text);
  if (!kind || !text) return null;
  const clock = raw.clock && typeof raw.clock === 'object' ? raw.clock : {};
  return {
    kind,
    text,
    clock: {
      dateLabel: String(clock.dateLabel || '').trim(),
      timeLabel: String(clock.timeLabel || '').trim(),
    },
    at: Number(raw.at) || 0,
  };
}

function readLedger(raw) {
  const list = Array.isArray(raw?.ledger) ? raw.ledger : [];
  return list.map(normalizeLedgerRow).filter(Boolean).slice(-LEDGER_CAP);
}

function statLedgerPrefix(text) {
  const m = /^([^·:\n]+?\s*·\s*[^:\n]+):/.exec(String(text || '').trim());
  return m ? m[1].replace(/\s+/g, ' ').trim().toLowerCase() : '';
}

export function renderNowLedgerLines(ledger) {
  const rows = Array.isArray(ledger) ? ledger : [];
  const deduped = [];
  for (const r of rows) {
    if (r?.kind === 'offscreen') continue;
    const text = clipLedgerText(r?.text);
    if (!text) continue;
    const statKey = r?.kind === 'stat' ? statLedgerPrefix(text) : '';
    if (statKey) {
      const idx = deduped.findIndex(x => x.statKey === statKey);
      if (idx >= 0) deduped.splice(idx, 1);
    }
    deduped.push({ text, statKey });
  }
  const texts = deduped.map(x => x.text).slice(-LEDGER_CAP);
  if (!texts.length) return '';
  return texts.map(t => `Changed: ${t}`).join('\n');
}

export function namedOccupancy(travel, { lastLocationKey = '' } = {}) {
  const t = normalizeTravel(travel, { lastLocationKey });
  if (t.mode === 'compass' && t.placeKey) return true;
  if (t.mode === 'moving' && (t.fromKey || t.destKey)) return true;
  return false;
}

export function occupancyNoticeLine(loc, { lastLocationKey = '' } = {}) {
  if (!loc) return '';
  const label = formatOccupancyLabel(loc, { lastLocationKey: lastLocationKey || loc.placeKey });
  if (loc.held) return label ? `Held: ${label}` : 'Held occupancy';
  if (loc.mode === 'moving' || /^Moving\b/.test(label)) return label || 'Moving';
  if (label) return `Compass: ${label}`;
  return String(loc.line || '').replace(/^Scene\/Location\s*\|\s*/i, '').trim();
}

function emptyClock() {
  return {
    timeLabel: '',
    hour: null,
    minute: 0,
    dateLabel: '',
    weatherEmoji: '',
    weatherLabel: '',
  };
}

function readClock(raw, scene) {
  const c = raw && typeof raw === 'object' ? raw : {};
  const s = scene && typeof scene === 'object' ? scene : {};
  const hourRaw = s.lastTimeHour != null ? s.lastTimeHour : c.hour;
  const hour = Number.isFinite(Number(hourRaw)) ? Number(hourRaw) : null;
  const minuteRaw = s.lastTimeMinute != null ? s.lastTimeMinute : c.minute;
  return {
    timeLabel: String(s.lastTimeLabel || c.timeLabel || ''),
    hour,
    minute: Number.isFinite(Number(minuteRaw)) ? Number(minuteRaw) : 0,
    dateLabel: String(s.lastDateLabel || c.dateLabel || ''),
    weatherEmoji: String(s.weatherEmoji || c.weatherEmoji || ''),
    weatherLabel: String(s.weatherLabel || c.weatherLabel || ''),
  };
}

function pendingCueToProposal(cue) {
  const next = normalizePendingCue(cue);
  if (!next) return null;
  const loc = next.location;
  return {
    source: 'cue',
    occupancy: loc?.key
      ? normalizeTravel({
        mode: 'compass',
        placeKey: loc.key,
        placeId: loc.placeId || '',
      })
      : null,
    location: loc,
    date: next.date || null,
    time: next.time || null,
    sig: next.sig,
    label: next.label,
  };
}

function normalizeProposal(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const loc = raw.location && typeof raw.location === 'object' ? raw.location : null;
  const occupancy = raw.occupancy && typeof raw.occupancy === 'object'
    ? normalizeTravel(raw.occupancy)
    : (loc?.key
      ? normalizeTravel({ mode: 'compass', placeKey: loc.key, placeId: loc.placeId || '' })
      : null);
  const location = loc && (loc.key || loc.placeId)
    ? {
      key: String(loc.key || occupancy?.placeKey || '').trim(),
      placeId: String(loc.placeId || occupancy?.placeId || '').trim(),
      label: String(loc.label || loc.key || occupancy?.placeKey || '').trim(),
    }
    : (occupancy?.placeKey
      ? { key: occupancy.placeKey, placeId: occupancy.placeId || '', label: occupancy.placeKey }
      : null);
  if (!occupancy && !raw.date && !raw.time && !location) return null;
  const out = {
    source: String(raw.source || '').trim() || 'sonar',
    occupancy,
    location,
    date: raw.date && typeof raw.date === 'object' ? raw.date : null,
    time: raw.time && typeof raw.time === 'object' ? raw.time : null,
    sig: String(raw.sig || '').trim(),
    label: String(raw.label || '').trim(),
  };
  const cue = proposalToPendingCue(out);
  if (cue) {
    out.sig = out.sig || cue.sig;
    out.label = out.label || cue.label;
  }
  return out;
}

function proposalToPendingCue(p) {
  if (!p) return null;
  return normalizePendingCue({
    sig: p.sig,
    label: p.label,
    location: p.location || null,
    date: p.date || null,
    time: p.time || null,
  });
}

function mergeProposals(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return normalizeProposal({
    source: b.source || a.source,
    occupancy: b.occupancy || a.occupancy,
    location: b.location || a.location,
    date: b.date || a.date,
    time: b.time || a.time,
    sig: b.sig || a.sig,
    label: b.label || a.label,
  });
}

export function hydrateNow(raw, scene) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const sc = scene && typeof scene === 'object' ? scene : {};
  const hasNow = !!(src.occupancy && src.occupancy.mode);
  const lastKey = String(
    (hasNow ? src.lastLocationKey : '') || sc.lastLocationKey || '',
  ).trim();
  const occupancy = normalizeTravel(
    hasNow ? src.occupancy : (sc.travel || defaultTravel()),
    { lastLocationKey: lastKey },
  );
  const lastLocationKey = String(
    occupancy.placeKey || lastKey || '',
  ).trim();
  const proposal = mergeProposals(
    normalizeProposal(src.proposal),
    pendingCueToProposal(sc.pendingCue),
  );
  return {
    occupancy,
    lastLocationKey,
    clock: readClock(hasNow ? src.clock : null, sc),
    held: hasNow ? !!src.held : !!sc.boardHeld,
    proposal,
    ignoredSig: String(src.ignoredSig || sc.ignoredCueSig || ''),
    ledger: readLedger(src),
    at: Number(src.at) || 0,
  };
}

function writeNowRoot(raw, doc) {
  if (!raw || typeof raw !== 'object') return;
  raw.occupancy = { ...doc.occupancy };
  raw.lastLocationKey = doc.lastLocationKey;
  raw.clock = { ...doc.clock };
  raw.held = !!doc.held;
  raw.proposal = doc.proposal || null;
  raw.ignoredSig = doc.ignoredSig || '';
  raw.ledger = Array.isArray(doc.ledger) ? doc.ledger.map(normalizeLedgerRow).filter(Boolean).slice(-LEDGER_CAP) : [];
  raw.at = Date.now();
}

function writeSceneAliases(scene, doc, { clearCue = false, clearOccupancyCueOnly = false } = {}) {
  if (!scene || typeof scene !== 'object') return;
  scene.travel = { ...doc.occupancy };
  scene.lastLocationKey = doc.lastLocationKey;
  scene.boardHeld = !!doc.held;
  scene.proposedTravel = null;
  scene.ignoredCueSig = doc.ignoredSig || scene.ignoredCueSig || '';
  if (doc.clock.timeLabel) scene.lastTimeLabel = doc.clock.timeLabel;
  if (doc.clock.hour != null) scene.lastTimeHour = doc.clock.hour;
  scene.lastTimeMinute = doc.clock.minute;
  if (doc.clock.dateLabel) scene.lastDateLabel = doc.clock.dateLabel;
  if (doc.clock.weatherEmoji) scene.weatherEmoji = doc.clock.weatherEmoji;
  if (doc.clock.weatherLabel) scene.weatherLabel = doc.clock.weatherLabel;
  const cue = proposalToPendingCue(doc.proposal);
  if (cue) {
    scene.pendingCue = cue;
  } else if (clearCue) {
    if (clearOccupancyCueOnly && scene.pendingCue && (scene.pendingCue.date || scene.pendingCue.time)) {
      scene.pendingCue = normalizePendingCue({
        date: scene.pendingCue.date || null,
        time: scene.pendingCue.time || null,
        location: null,
      });
    } else {
      scene.pendingCue = null;
    }
  }
}

function persist(storage, raw, scene, doc, st, { clearCue = false, clearOccupancyCueOnly = false } = {}) {
  writeNowRoot(raw, doc);
  writeSceneAliases(scene, doc, { clearCue, clearOccupancyCueOnly });
  if (st?.trackers?.scene && st.trackers.scene !== scene) {
    writeSceneAliases(st.trackers.scene, doc, { clearCue, clearOccupancyCueOnly });
  }
  try { storage?.saveChat?.(); } catch { /* ignore */ }
}

export function ensureNow(storage, { scene: sceneArg } = {}) {
  let st = {};
  try { st = storage?.getChat?.('backstage', {}) || {}; } catch { st = {}; }
  try {
    if (st && typeof st === 'object') st.trackers = normalizeTrackers(st.trackers);
  } catch { /* ignore */ }
  const scene = sceneArg || st.trackers?.scene || {};
  let raw = {};
  try { raw = storage?.getChat?.(NOW_KEY, {}) || {}; } catch { raw = {}; }
  const doc = hydrateNow(raw, scene);
  writeNowRoot(raw, doc);
  writeSceneAliases(scene, doc);
  return { doc, scene, st, raw };
}

function applyClock(doc, scene, clock) {
  if (!clock || typeof clock !== 'object') return false;
  let changed = false;
  const next = { ...doc.clock };
  for (const k of Object.keys(emptyClock())) {
    if (clock[k] === undefined) continue;
    if (next[k] !== clock[k]) changed = true;
    next[k] = clock[k];
  }
  doc.clock = next;
  if (scene && typeof scene === 'object') {
    if (clock.timeLabel != null) scene.lastTimeLabel = clock.timeLabel;
    if (clock.hour !== undefined) scene.lastTimeHour = clock.hour;
    if (clock.minute !== undefined) scene.lastTimeMinute = clock.minute;
    if (clock.dateLabel != null) scene.lastDateLabel = clock.dateLabel;
    if (clock.weatherEmoji != null) scene.weatherEmoji = clock.weatherEmoji;
    if (clock.weatherLabel != null) scene.weatherLabel = clock.weatherLabel;
  }
  return changed;
}

function emitOccupancy(bus, travel, { changed, held, lastLocationKey, trackers } = {}) {
  if (!bus?.emit) return;
  if (!changed && !held) return;
  if (clapperIsShowing(trackers)) return;
  const text = occupancyNoticeLine({ ...travel, held }, { lastLocationKey });
  if (!text) return;
  bus.emit('showtime.notice', {
    kind: 'occupancy',
    items: [{ text, mark: held ? '?' : '!' }],
  });
}

function placeMatchesOrContains(compass, childId, candidateKey, candidateId = '') {
  if (!compass || !childId) return false;
  const rooms = compass.rooms || {};
  const start = rooms[childId];
  if (!start) return false;
  const wantKey = String(candidateKey || '').trim().toLowerCase();
  const wantId = String(candidateId || '').trim();
  const guard = new Set();
  let cur = start;
  while (cur && !guard.has(cur.id)) {
    guard.add(cur.id);
    if (wantId && cur.id === wantId) return true;
    if (wantKey) {
      if (String(cur.name || '').trim().toLowerCase() === wantKey) return true;
      if ((cur.aliases || []).some(a => String(a || '').trim().toLowerCase() === wantKey)) return true;
      if ((cur.locationTags || []).some(t => String(t || '').trim().toLowerCase() === wantKey)) return true;
    }
    cur = cur.parentId ? rooms[cur.parentId] : null;
  }
  return false;
}

function syncCompass(st, travel) {
  try {
    const compass = ensureCompass(st);
    if (travel?.mode === 'compass') return syncOccupancyRoom(compass, travel);
  } catch { /* ignore */ }
  return null;
}

/**
 * Commit occupancy/clock onto the sidecar. Receipt named landings pass force.
 * `held` after a commit means sonar may not auto-land, not that occupancy failed.
 */
export function commitNow(storage, patch = {}, {
  force = true, source = '', scene: sceneArg, bus = null,
} = {}) {
  const { doc, scene, st, raw } = ensureNow(storage, { scene: sceneArg });
  let changed = false;
  let held = false;
  const prev = normalizeTravel(doc.occupancy, { lastLocationKey: doc.lastLocationKey });
  if (patch.occupancy) {
    let compass = null;
    try { compass = ensureCompass(st); } catch { /* ignore */ }
    const explicitPlaceId = String(patch.occupancy?.placeId || '').trim();
    const locPatch = {
      ...normalizeTravel({
        ...prev,
        ...patch.occupancy,
        placeId: explicitPlaceId,
      }, { lastLocationKey: doc.lastLocationKey }),
    };
    if (locPatch.mode === 'compass' && compass) {
      const resolvedId = explicitPlaceId || findPlaceIdByKey(compass, locPatch.placeKey);
      const sonarId = String(compass.sonar?.lastPlaceId || '').trim();
      const prevId = String(prev.placeId || sonarId || '').trim();
      if (explicitPlaceId) {
        const expPlace = compass.rooms?.[explicitPlaceId];
        if (expPlace?.kind === 'unit' && (source === 'pin' || source === 'clap')) {
          const child = defaultStandingChild(compass, explicitPlaceId);
          locPatch.placeId = child?.id || explicitPlaceId;
        } else {
          locPatch.placeId = explicitPlaceId;
        }
      } else if (sonarId && sonarId !== prevId && resolvedId
        && placeMatchesOrContains(compass, sonarId, locPatch.placeKey, resolvedId)) {
        locPatch.placeId = sonarId;
      } else if (prev.mode === 'compass' && prevId && resolvedId
        && (compass.rooms?.[resolvedId]?.kind === 'unit' || compass.rooms?.[resolvedId]?.kind === 'building' || compass.rooms?.[resolvedId]?.kind === 'area')
        && placeMatchesOrContains(compass, prevId, locPatch.placeKey, resolvedId)) {
        locPatch.placeId = prevId;
        const prevPlace = compass.rooms?.[prevId];
        const parentPlace = prevPlace?.parentId ? compass.rooms?.[prevPlace.parentId] : null;
        if (parentPlace?.kind === 'unit'
          && String(locPatch.placeKey || '').trim().toLowerCase() !== String(prevPlace.name || '').trim().toLowerCase()) {
          locPatch.placeKey = parentPlace.name || locPatch.placeKey;
        }
      } else if (resolvedId) {
        locPatch.placeId = resolvedId;
      }
    }
    const named = namedOccupancy(locPatch, { lastLocationKey: doc.lastLocationKey });
    const mustLand = force || named;
    const result = commitTravel(scene, { ...locPatch, force: mustLand }, {
      boardHeld: mustLand ? false : !!doc.held,
    });
    held = !!result.held;
    if (result.held && !mustLand) {
      doc.proposal = mergeProposals(doc.proposal, {
        source: source || 'receipt',
        occupancy: result.travel,
        location: result.travel?.placeKey
          ? { key: result.travel.placeKey, placeId: result.travel.placeId || '', label: result.travel.placeKey }
          : null,
      });
    } else {
      doc.occupancy = normalizeTravel(result.travel || locPatch, { lastLocationKey: doc.lastLocationKey });
      if (doc.occupancy.mode === 'compass' && doc.occupancy.placeKey) {
        doc.lastLocationKey = doc.occupancy.placeKey;
      }
      changed = !!result.changed;
      doc.proposal = doc.proposal
        ? { ...doc.proposal, occupancy: null, location: null }
        : null;
      if (doc.proposal && !doc.proposal.date && !doc.proposal.time) doc.proposal = null;
      const synced = syncCompass(st, doc.occupancy);
      if (synced?.placeId && doc.occupancy.mode === 'compass' && doc.occupancy.placeId !== synced.placeId) {
        doc.occupancy.placeId = synced.placeId;
        if (scene?.travel && typeof scene.travel === 'object') {
          scene.travel.placeId = synced.placeId;
        }
      }
    }
  }
  if (patch.clock) {
    if (applyClock(doc, scene, patch.clock)) changed = true;
  }
  if (!held && (source === 'slate' || source === 'clap' || source === 'pin' || source === 'accept')) {
    doc.held = true;
  }
  const clearOccOnly = !held && !!patch.occupancy && !patch.clock && source !== 'accept' && source !== 'ignore';
  persist(storage, raw, scene, doc, st, {
    clearCue: !held && !!patch.occupancy,
    clearOccupancyCueOnly: clearOccOnly,
  });
  if (!held) emitOccupancy(bus, doc.occupancy, { changed, held: false, lastLocationKey: doc.lastLocationKey, trackers: st.trackers });
  else emitOccupancy(bus, patch.occupancy || doc.occupancy, { changed: false, held: true, lastLocationKey: doc.lastLocationKey, trackers: st.trackers });
  return {
    doc,
    scene,
    changed,
    held,
    travel: doc.occupancy,
    line: formatTravelLine(doc.occupancy, { lastLocationKey: doc.lastLocationKey }),
  };
}

/**
 * Append a this-scene catalog delta. Occupancy propose/accept is unchanged.
 * Failures are silent so hook/intel writers never throw on a missing Now bag.
 */
export function appendNowLedger(storage, { kind, text } = {}, { scene: sceneArg, persist: doPersist = true } = {}) {
  try {
    const { doc, scene, st, raw } = ensureNow(storage, { scene: sceneArg });
    const row = normalizeLedgerRow({
      kind,
      text,
      clock: {
        dateLabel: doc.clock?.dateLabel || '',
        timeLabel: doc.clock?.timeLabel || '',
      },
      at: Date.now(),
    });
    if (!row) return { appended: false, doc };
    let prior = [...(doc.ledger || [])];
    if (row.kind === 'presence') {
      const m = /^Presence:\s+(.+?)\s+(in play|absent|privy(?:\s+\(listening in\))?)$/i.exec(row.text);
      if (m) {
        const who = m[1].trim().toLowerCase();
        prior = prior.filter((r) => {
          if (r?.kind !== 'presence') return true;
          const prev = /^Presence:\s+(.+?)\s+(in play|absent|privy(?:\s+\(listening in\))?)$/i.exec(String(r.text || ''));
          return !prev || prev[1].trim().toLowerCase() !== who;
        });
      }
    } else if (row.kind === 'stat') {
      const statKey = statLedgerPrefix(row.text);
      if (statKey) {
        prior = prior.filter(r => r?.kind !== 'stat' || statLedgerPrefix(r?.text) !== statKey);
      }
    }
    doc.ledger = [...prior, row].slice(-LEDGER_CAP);
    if (doPersist !== false) persist(storage, raw, scene, doc, st);
    else {
      writeNowRoot(raw, doc);
      writeSceneAliases(scene, doc);
    }
    return { appended: true, doc };
  } catch {
    return { appended: false, doc: null };
  }
}

export function proposeNow(storage, patch = {}, { source = 'sonar', scene: sceneArg } = {}) {
  const { doc, scene, st, raw } = ensureNow(storage, { scene: sceneArg });
  const next = {
    source,
    occupancy: patch.occupancy
      ? normalizeTravel({ ...(doc.proposal?.occupancy || {}), ...patch.occupancy }, {
        lastLocationKey: doc.lastLocationKey,
      })
      : doc.proposal?.occupancy || null,
    location: patch.location || doc.proposal?.location || null,
    date: patch.date !== undefined ? patch.date : doc.proposal?.date || null,
    time: patch.time !== undefined ? patch.time : doc.proposal?.time || null,
  };
  if (patch.occupancy?.placeKey && !next.location) {
    next.location = {
      key: patch.occupancy.placeKey,
      placeId: patch.occupancy.placeId || '',
      label: patch.occupancy.placeKey,
    };
  }
  const proposal = normalizeProposal(next);
  const cue = proposalToPendingCue(proposal);
  if (cue && doc.ignoredSig && cue.sig === doc.ignoredSig) {
    return { proposed: false, doc };
  }
  doc.proposal = proposal;
  persist(storage, raw, scene, doc, st);
  return { proposed: true, doc };
}

export function acceptNow(storage, {
  scene: sceneArg, bus = null, applyOccupancy = true,
} = {}) {
  const { doc, scene, st, raw } = ensureNow(storage, { scene: sceneArg });
  const p = doc.proposal;
  if (!p) return { changed: false, accepted: false, doc };
  const patch = {};
  if (applyOccupancy && p.occupancy) patch.occupancy = p.occupancy;
  if (p.time || p.date) {
    patch.clock = {};
    if (p.time?.fuzzy) patch.clock.timeLabel = p.time.fuzzy;
    if (Number.isFinite(Number(p.time?.hour))) patch.clock.hour = Number(p.time.hour);
    if (p.date?.label) patch.clock.dateLabel = p.date.label;
  }
  if (!patch.occupancy && !patch.clock) {
    doc.proposal = null;
    persist(storage, raw, scene, doc, st, { clearCue: true });
    return { changed: false, accepted: true, doc };
  }
  return { ...commitNow(storage, patch, { force: true, source: 'accept', scene: sceneArg, bus }), accepted: true };
}

export function ignoreNow(storage, { scene: sceneArg } = {}) {
  const { doc, scene, st, raw } = ensureNow(storage, { scene: sceneArg });
  const sig = String(doc.proposal?.sig || scene.pendingCue?.sig || '').trim();
  doc.ignoredSig = sig;
  doc.proposal = null;
  persist(storage, raw, scene, doc, st, { clearCue: true });
  return { doc, ignored: true };
}

/** Copy a scene that was stamped elsewhere (slate) onto the sidecar. */
export function syncNowFromScene(storage, scene, { source = 'slate' } = {}) {
  const travel = normalizeTravel(scene?.travel, { lastLocationKey: scene?.lastLocationKey });
  return commitNow(storage, {
    occupancy: travel,
    clock: readClock(null, scene),
  }, { force: true, source, scene });
}

export function seedPlaceId(compass, travel) {
  const t = travel && typeof travel === 'object' ? travel : {};
  if (t.mode === 'moving') {
    const dest = String(t.destKey || '').trim();
    if (!dest || isTransitVehicleKey(dest)) return '';
    return findPlaceIdByKey(compass, dest);
  }
  const id = String(t.placeId || '').trim();
  if (id && compass?.rooms?.[id]) return id;
  const byKey = findPlaceIdByKey(compass, t.placeKey);
  if (byKey) return byKey;
  return '';
}

export function occupancySeedFromNow(compass, doc) {
  return seedPlaceId(compass, doc?.occupancy || defaultTravel());
}

export function renderNowSceneLine(doc, scene) {
  if (scene && scene.enabled === false) return '';
  const loc = formatOccupancyLabel(doc?.occupancy, { lastLocationKey: doc?.lastLocationKey });
  const clock = doc?.clock || emptyClock();
  const bits = [];
  if (loc) bits.push(loc);
  if (scene?.time !== false) {
    const time = clock.timeLabel || scene?.lastTimeLabel;
    if (time) bits.push(time);
  }
  if (scene?.date !== false) {
    const date = clock.dateLabel || scene?.lastDateLabel;
    if (date) bits.push(date);
  }
  if (scene?.weather !== false) {
    const wx = `${clock.weatherEmoji || scene?.weatherEmoji || ''} ${clock.weatherLabel || scene?.weatherLabel || ''}`.trim();
    if (wx) bits.push(wx);
  }
  return bits.join(' · ');
}

function memStorage(scene) {
  const bags = {
    now: {},
    backstage: {
      trackers: { scene },
      stage: {
        rooms: {
          mall: { id: 'mall', name: 'Mall', kind: 'building' },
          docks: { id: 'docks', name: 'Docks', kind: 'area' },
        },
      },
    },
  };
  return {
    getChat(id, d = {}) {
      if (!bags[id]) bags[id] = { ...d };
      return bags[id];
    },
    saveChat() {},
  };
}

export function smokeNowSidecarPure() {
  try {
    const scene = {
      lastLocationKey: 'Docks',
      boardHeld: true,
      travel: defaultTravel(),
      pendingCue: null,
      ignoredCueSig: '',
      lastTimeLabel: 'Mid Morning',
      lastTimeHour: 9,
      weatherEmoji: '☁',
      weatherLabel: 'Overcast',
      enabled: true,
      time: true,
      date: true,
      weather: true,
    };
    const storage = memStorage(scene);
    const { doc } = ensureNow(storage, { scene });
    if (doc.lastLocationKey !== 'Docks' || !doc.held) return 'hydrate should copy scene occupancy and hold';
    const landed = commitNow(storage, {
      occupancy: { mode: 'compass', placeKey: 'Okisato Antiques', placeId: '' },
    }, { force: true, source: 'receipt', scene });
    if (!landed.changed || scene.travel.mode !== 'compass') return 'receipt force should land compass while held';
    if (scene.lastLocationKey !== 'Okisato Antiques') return 'alias lastLocationKey should follow sidecar';
    if (scene.proposedTravel) return 'proposedTravel rail should stay empty';
    const line = renderNowSceneLine(landed.doc, scene);
    if (!/Okisato Antiques/.test(line)) return 'now line should show committed occupancy';
    const proposed = proposeNow(storage, {
      occupancy: { mode: 'compass', placeKey: 'Bathroom', placeId: 'bathroom' },
    }, { source: 'sonar', scene });
    if (!proposed.proposed || scene.travel.placeKey !== 'Okisato Antiques') {
      return 'sonar propose should not overwrite occupancy';
    }
    if (!/Bathroom/i.test(scene.pendingCue?.label || scene.pendingCue?.location?.key || '')) {
      return 'proposal should surface on the clapper cue';
    }
    ignoreNow(storage, { scene });
    if (scene.pendingCue) return 'ignore should clear the cue';
    const moving = commitNow(storage, {
      occupancy: { mode: 'moving', fromKey: 'Safehouse', destKey: 'Okisato Antiques', transit: 'enRoute' },
    }, { force: true, source: 'receipt', scene });
    if (moving.doc.occupancy.mode !== 'moving') return 'named moving should commit';
    const seed = seedPlaceId({
      rooms: { oki: { id: 'oki', name: 'Okisato Antiques', kind: 'unit' }, apt: { id: 'apt', name: 'Heights' } },
      activeRoomId: 'apt',
    }, moving.doc.occupancy);
    if (seed !== 'oki') return 'moving dest should seed Okisato not leftover active room';
    const hereSeed = seedPlaceId({
      rooms: { oki: { id: 'oki', name: 'Okisato Antiques' }, apt: { id: 'apt', name: 'Heights' } },
      activeRoomId: 'apt',
    }, { mode: 'compass', placeKey: 'Okisato Antiques', placeId: 'oki' });
    if (hereSeed !== 'oki') return 'compass seed should prefer occupancy placeId over activeRoom';

    const first = appendNowLedger(storage, { kind: 'hook', text: 'Hook added: The lease' }, { scene });
    if (!first.appended || first.doc.ledger.length !== 1) return 'ledger should append';
    if (first.doc.ledger[0].clock.timeLabel !== 'Mid Morning') return 'ledger should stamp sidecar clock';
    for (let i = 0; i < LEDGER_CAP + 2; i++) {
      appendNowLedger(storage, { kind: 'secret', text: `Secret established: n${i}` }, { scene });
    }
    const { doc: after } = ensureNow(storage, { scene });
    if (after.ledger.length !== LEDGER_CAP) return `ledger cap ${after.ledger.length}`;
    const changed = renderNowLedgerLines(after.ledger);
    if (!/^Changed: /.test(changed) || !/Secret established/.test(changed)) return 'ledger render should use Changed:';
    if (/Hook added: The lease/.test(changed)) return 'ledger cap should drop oldest';
    const hidden = renderNowLedgerLines([
      { kind: 'offscreen', text: 'Aizawa ate, off screen' },
      { kind: 'hook', text: 'Hook added: x' },
    ]);
    if (/off screen/.test(hidden)) return 'offscreen ledger must stay out of the prompt';
    if (!/Hook added: x/.test(hidden)) return 'offscreen filter should keep other ledger lines';
    const kinds = ['stat', 'condition', 'presence', 'offscreen'];
    for (const kind of kinds) {
      const row = normalizeLedgerRow({ kind, text: `${kind} ok` });
      if (!row || row.kind !== kind) return `ledger should accept ${kind}`;
    }

    // Regression test: ancestor trap must not revert explicit placeId or Sonar room move
    const roomScene = {
      lastLocationKey: 'Break Room',
      boardHeld: false,
      travel: { mode: 'compass', placeKey: 'Break Room', placeId: 'break_room' },
      pendingCue: null,
      ignoredCueSig: '',
      lastTimeLabel: 'Mid Afternoon',
      lastTimeHour: 14,
      enabled: true,
      time: true,
      date: true,
      weather: false,
    };
    const roomStorage = memStorage(roomScene);
    const bst = roomStorage.getChat('backstage');
    bst.stage.rooms = {
      canal_city_mall: { id: 'canal_city_mall', name: 'Canal City Mall', kind: 'building', parentId: '' },
      okisato_antiques: { id: 'okisato_antiques', name: 'Okisato Antiques', kind: 'unit', parentId: 'canal_city_mall' },
      main_showroom: { id: 'main_showroom', name: 'Main Showroom', kind: 'room', parentId: 'okisato_antiques' },
      break_room: { id: 'break_room', name: 'Break Room', kind: 'room', parentId: 'okisato_antiques' },
      service_corridor: { id: 'service_corridor', name: 'Service Corridor', kind: 'transitional', parentId: 'canal_city_mall' },
    };
    commitNow(roomStorage, {
      occupancy: { mode: 'compass', placeKey: 'Break Room', placeId: 'break_room' },
    }, { force: true, source: 'receipt', scene: roomScene });
    if (roomScene.boardHeld) return 'receipt commit should not lock boardHeld';
    // User pins Okisato Antiques (unit) -> should resolve to Main Showroom, not stay stuck in Break Room
    commitNow(roomStorage, {
      occupancy: { mode: 'compass', placeKey: 'Okisato Antiques', placeId: 'okisato_antiques' },
    }, { force: true, source: 'pin', scene: roomScene });
    if (roomScene.travel.placeId !== 'main_showroom') {
      return `pinning unit should land in defaultStandingChild main_showroom, got ${roomScene.travel.placeId}`;
    }
    // User or Sonar moves to Service Corridor -> should land in service_corridor
    commitNow(roomStorage, {
      occupancy: { mode: 'compass', placeKey: 'Service Corridor', placeId: 'service_corridor' },
    }, { force: true, source: 'sonar', scene: roomScene });
    if (roomScene.travel.placeId !== 'service_corridor') {
      return `moving to service_corridor should land in service_corridor, got ${roomScene.travel.placeId}`;
    }
    return '';
  } catch (err) {
    return String(err?.message || err);
  }
}
