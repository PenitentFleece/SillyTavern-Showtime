// Scene travel FSM: Compass (here) | Moving (from → dest, enRoute/arriving) | Unknown.
// Regex/sonar propose; the receipt commits.

export const TRAVEL_MODES = Object.freeze(['compass', 'moving', 'unknown']);
export const TRANSITS = Object.freeze(['enRoute', 'arriving']);
export const TRANSIT_VEHICLE_SET = Object.freeze(new Set([
  'train', 'subway', 'metro', 'tram', 'bus', 'ferry', 'taxi', 'cab', 'plane', 'flight',
]));

/** Vehicle words are how you travel, never dest / occupancy. */
export function isTransitVehicleKey(raw) {
  const t = String(raw || '').trim().toLowerCase().replace(/^(the|a|an)\s+/, '');
  return !!t && TRANSIT_VEHICLE_SET.has(t);
}

function placeKeyNotVehicle(raw) {
  const t = String(raw || '').trim();
  if (!t || isTransitVehicleKey(t)) return '';
  return t;
}

export function defaultTravel() {
  return {
    mode: 'unknown',
    placeKey: '',
    placeId: '',
    fromKey: '',
    destKey: '',
    transit: '',
  };
}

export function normalizeTravel(raw = {}, { lastLocationKey = '' } = {}) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const mode = TRAVEL_MODES.includes(src.mode) ? src.mode
    : (String(src.placeKey || lastLocationKey || '').trim() ? 'compass' : 'unknown');
  const transit = TRANSITS.includes(src.transit) ? src.transit : '';
  const placeKeyRaw = String(src.placeKey || (mode === 'compass' ? lastLocationKey : '') || '').trim();
  const placeKey = placeKeyNotVehicle(placeKeyRaw);
  return {
    mode,
    placeKey,
    placeId: String(src.placeId || '').trim(),
    fromKey: placeKeyNotVehicle(src.fromKey),
    destKey: placeKeyNotVehicle(src.destKey),
    transit: mode === 'moving' ? (transit || 'enRoute') : '',
  };
}

/** Proposal only — does not write lastLocationKey. */
export function proposeTravel(scene, patch = {}) {
  if (!scene || typeof scene !== 'object') return null;
  scene.proposedTravel = normalizeTravel({ ...(scene.proposedTravel || {}), ...patch }, {
    lastLocationKey: scene.lastLocationKey,
  });
  return scene.proposedTravel;
}

export function commitTravel(scene, patch = {}, { boardHeld = false } = {}) {
  if (!scene || typeof scene !== 'object') return { changed: false, held: false };
  const prev = normalizeTravel(scene.travel, { lastLocationKey: scene.lastLocationKey });
  const next = normalizeTravel({ ...prev, ...patch }, { lastLocationKey: scene.lastLocationKey });
  if (next.mode === 'compass' && next.placeKey && boardHeld && !patch.force) {
    scene.proposedTravel = next;
    return { changed: false, held: true, travel: next };
  }
  scene.travel = next;
  scene.proposedTravel = null;
  if (next.mode === 'compass' && next.placeKey) {
    scene.lastLocationKey = next.placeKey;
  } else if (next.mode === 'unknown') {
    /* keep last known key for clapper history */
  } else if (next.mode === 'moving' && next.destKey) {
    /* dest is not occupancy yet */
  }
  return { changed: locatorShifted(prev, next), held: false, travel: next };
}

/**
 * Assert occupancy is here (clears moving). User/model pins pass force: true;
 * receipt auto-commits keep boardHeld.
 */
export function assertHere(scene, { placeKey = '', placeId = '' } = {}, { force = false, boardHeld } = {}) {
  if (!scene || typeof scene !== 'object') {
    return { changed: false, held: false, travel: defaultTravel() };
  }
  const key = String(placeKey || '').trim();
  if (!key) {
    return {
      changed: false,
      held: false,
      travel: normalizeTravel(scene.travel, { lastLocationKey: scene.lastLocationKey }),
    };
  }
  const held = boardHeld != null ? !!boardHeld : !!scene.boardHeld;
  return commitTravel(scene, {
    mode: 'compass',
    placeKey: key,
    placeId: String(placeId || '').trim(),
    fromKey: '',
    destKey: '',
    transit: '',
    force: !!force,
  }, { boardHeld: held });
}

function locatorShifted(a, b) {
  return a.mode !== b.mode
    || a.placeKey !== b.placeKey
    || a.placeId !== b.placeId
    || a.fromKey !== b.fromKey
    || a.destKey !== b.destKey
    || a.transit !== b.transit;
}

/** Short occupancy label for clapper / [Now] (no Scene/Location prefix). */
export function formatOccupancyLabel(travel, { lastLocationKey = '' } = {}) {
  const t = normalizeTravel(travel, { lastLocationKey });
  if (t.mode === 'moving') {
    const from = t.fromKey || lastLocationKey || '';
    const dest = t.destKey || '';
    if (from && dest) return `Moving: ${from} → ${dest}`;
    if (from) return `Moving: ${from}`;
    if (dest) return `Moving: ${dest}`;
    return 'Moving';
  }
  return t.placeKey || lastLocationKey || '';
}

export function formatTravelLine(travel, { lastLocationKey = '' } = {}) {
  const t = normalizeTravel(travel, { lastLocationKey });
  if (t.mode === 'unknown' && !t.placeKey) return 'Scene/Location | Unknown';
  if (t.mode === 'moving') {
    const from = t.fromKey || lastLocationKey || '';
    const dest = t.destKey || '';
    const how = t.transit === 'arriving' ? 'arriving' : 'en route';
    if (from && dest) return `Scene/Location | Moving: ${from} → ${dest} | ${how}`;
    if (from) return `Scene/Location | Moving: ${from} | ${how}`;
    if (dest) return `Scene/Location | Moving | ${dest} · ${how}`;
    return `Scene/Location | Moving | ${how}`;
  }
  const here = t.placeKey || lastLocationKey || 'Unknown';
  if (!t.placeKey && !lastLocationKey) return 'Scene/Location | Unknown';
  return `Scene/Location | Compass: ${here}`;
}

function filingPlaceKey(raw) {
  const t = String(raw || '').trim();
  if (!t || t.includes('|')) return '';
  if (/^(place|from|dest|here|to|unknown)$/i.test(t)) return '';
  if (isTransitVehicleKey(t)) return '';
  return t;
}

export function travelFromFiling(raw = {}, { lastLocationKey = '' } = {}) {
  const src = raw && typeof raw === 'object' ? raw : {};
  let modeRaw = String(src.mode || src.state || '').trim().toLowerCase();
  if (modeRaw.includes('|')) modeRaw = '';
  let mode = 'unknown';
  if (modeRaw === 'compass' || modeRaw === 'here' || modeRaw === 'at') mode = 'compass';
  else if (modeRaw === 'moving' || modeRaw === 'enroute' || modeRaw === 'en route' || modeRaw === 'arriving') mode = 'moving';
  else if (modeRaw === 'unknown') mode = 'unknown';
  else if (src.dest || src.destKey || src.to) mode = 'moving';
  else if (src.place || src.placeKey || src.here) mode = 'compass';

  let transit = '';
  const tr = String(src.transit || src.leg || '').trim().toLowerCase().replace(/\s+/g, '');
  if (tr.includes('|')) { /* schema stub */ }
  else if (tr === 'arriving' || modeRaw === 'arriving') transit = 'arriving';
  else if (tr === 'enroute' || tr === 'en-route' || mode === 'moving') transit = 'enRoute';

  return normalizeTravel({
    mode,
    placeKey: filingPlaceKey(src.placeKey || src.place || src.here),
    placeId: String(src.placeId || '').trim(),
    fromKey: filingPlaceKey(src.fromKey || src.from),
    destKey: filingPlaceKey(src.destKey || src.dest || src.to),
    transit,
  }, { lastLocationKey });
}

export function smokeTravelStatePure() {
  try {
    const line = formatTravelLine({
      mode: 'moving', fromKey: 'street', destKey: 'duplex', transit: 'arriving',
    });
    if (!/street/.test(line) || !/duplex/.test(line) || !/arriving/.test(line)) {
      return 'moving line should format from → dest | arriving';
    }
    const scene = { lastLocationKey: 'Docks', boardHeld: true, travel: defaultTravel() };
    const held = commitTravel(scene, { mode: 'compass', placeKey: 'Mall' }, { boardHeld: true });
    if (!held.held || scene.lastLocationKey !== 'Docks') return 'boardHeld should not commit compass';
    const open = { lastLocationKey: '', travel: defaultTravel() };
    commitTravel(open, { mode: 'compass', placeKey: 'Mall' }, { boardHeld: false });
    if (open.lastLocationKey !== 'Mall' || open.travel.mode !== 'compass') return 'open board should commit compass';
    const unk = formatTravelLine({ mode: 'unknown' });
    if (!/Unknown/.test(unk)) return 'unknown line';
    const bareMove = formatTravelLine({ mode: 'moving', transit: 'enRoute' });
    if (!/Moving/.test(bareMove) || /Unknown/.test(bareMove)) return 'bare moving should not read Unknown';
    const leak = travelFromFiling({ mode: 'compass|moving|unknown', place: '', dest: '' });
    if (leak.mode !== 'unknown') return 'schema-stub mode should not parse as compass';
    const filedFlight = travelFromFiling({ mode: 'moving', from: 'Safehouse', dest: 'flight' });
    if (filedFlight.destKey) return 'filing vehicle dest should strip';
    if (filedFlight.fromKey !== 'Safehouse' || filedFlight.mode !== 'moving') return 'filing should keep place from and moving';
    const stuck = {
      lastLocationKey: 'apartment',
      boardHeld: true,
      travel: { mode: 'moving', fromKey: 'Kanzaki', destKey: 'train', transit: 'enRoute' },
    };
    const arrived = assertHere(stuck, { placeKey: 'apartment', placeId: 'apt' }, { force: true });
    if (!arrived.changed || stuck.travel.mode !== 'compass') return 'assertHere should clear stuck moving';
    if (stuck.lastLocationKey !== 'apartment' || stuck.travel.placeId !== 'apt') {
      return 'assertHere should write occupancy key and placeId';
    }
    if (!isTransitVehicleKey('flight') || !isTransitVehicleKey('the train')) return 'vehicle keys';
    if (isTransitVehicleKey('Fukuoka Heights')) return 'place is not a vehicle key';
    const stripped = normalizeTravel({ mode: 'moving', fromKey: 'Kanzaki', destKey: 'train' });
    if (stripped.destKey) return 'vehicle destKey should strip on normalize';
    const occMove = formatOccupancyLabel({
      mode: 'moving', fromKey: 'Kanzaki', destKey: 'Fukuoka Heights',
    });
    if (occMove !== 'Moving: Kanzaki → Fukuoka Heights') return 'occupancy label should be the moving line';
    const occVehicle = formatOccupancyLabel({
      mode: 'moving', fromKey: 'Kanzaki', destKey: 'flight',
    });
    if (occVehicle !== 'Moving: Kanzaki') return 'vehicle dest should not print as occupancy dest';
    const occHere = formatOccupancyLabel(stuck.travel, { lastLocationKey: stuck.lastLocationKey });
    if (occHere !== 'apartment' || /Moving/.test(occHere)) return 'occupancy label after arrival is the place';
    const heldPin = { lastLocationKey: 'Docks', boardHeld: true, travel: defaultTravel() };
    const blocked = assertHere(heldPin, { placeKey: 'Mall' }, { force: false });
    if (!blocked.held || heldPin.lastLocationKey !== 'Docks') return 'assertHere without force should respect boardHeld';
    return '';
  } catch (err) {
    return String(err?.message || err);
  }
}
