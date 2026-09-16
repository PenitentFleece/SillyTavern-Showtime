// Room Compass — schema, enums, validation (v2: places tree + wall links).

export const COMPASS_VERSION = 2;

/** Absolute compass cells (world-fixed; N is immutable at room create). */
export const CELLS = Object.freeze(['NW', 'N', 'NE', 'W', 'C', 'E', 'SW', 'S', 'SE']);
export const CELL_SET = new Set(CELLS);

/** Grid rows for ASCII render (north → south). */
export const CELL_ROWS = Object.freeze([
  ['NW', 'N', 'NE'],
  ['W', 'C', 'E'],
  ['SW', 'S', 'SE'],
]);

/** Cardinal facing only — diagonals are rejected at the command layer. */
export const FACINGS = Object.freeze(['N', 'E', 'S', 'W']);
export const FACING_SET = new Set(FACINGS);

export const DIAGONAL_FACINGS = Object.freeze(['NE', 'SE', 'SW', 'NW']);

export const AUTO_UPDATE_MODES = Object.freeze(['off', 'propose', 'apply']);

/**
 * Place kinds — Country/Region → City → Area/Building → Unit → Room,
 * plus transitional halls/corridors/walkways.
 */
export const PLACE_KINDS = Object.freeze([
  { id: 'region', label: 'Country / Region', hasGrid: false },
  { id: 'settlement', label: 'City / Settlement', hasGrid: false },
  { id: 'district', label: 'Area / District', hasGrid: false },
  { id: 'building', label: 'Building', hasGrid: false },
  { id: 'unit', label: 'Unit / Apartment / Suite', hasGrid: false },
  { id: 'room', label: 'Room', hasGrid: true },
  { id: 'transitional', label: 'Hall / Corridor / Walkway', hasGrid: true },
]);
export const PLACE_KIND_SET = new Set(PLACE_KINDS.map(k => k.id));
export const GEO_PLACE_KINDS = Object.freeze(['region', 'settlement', 'district', 'building']);
export const GEO_PLACE_KIND_SET = new Set(GEO_PLACE_KINDS);
export const ROOMISH_PLACE_KINDS = Object.freeze(['unit', 'room', 'transitional']);
export const ROOMISH_PLACE_KIND_SET = new Set(ROOMISH_PLACE_KINDS);
export const LOADABLE_KINDS = Object.freeze(['room', 'transitional']);
export const LOADABLE_KIND_SET = new Set(LOADABLE_KINDS);

/** Shared walls / vertical adjacency between places. */
export const WALLS = Object.freeze(['N', 'E', 'S', 'W', 'above', 'below']);
export const WALL_SET = new Set(WALLS);
export const OPPOSITE_WALL = Object.freeze({
  N: 'S', S: 'N', E: 'W', W: 'E', above: 'below', below: 'above',
});

/** Edge cells visible / travel-facing on a cardinal wall. */
export const WALL_EDGE_CELLS = Object.freeze({
  N: ['NW', 'N', 'NE'],
  E: ['NE', 'E', 'SE'],
  S: ['SW', 'S', 'SE'],
  W: ['NW', 'W', 'SW'],
  above: ['C'],
  below: ['C'],
});

export const OPENING_TYPES = Object.freeze([
  'door', 'window', 'hole', 'arch', 'passage', 'ascent', 'descent',
]);
export const OPENING_TYPE_SET = new Set(OPENING_TYPES);
/** Floor/ceiling connectors (stairs, ladders, trapdoors, hatches). */
export const VERTICAL_OPENING_TYPES = Object.freeze(['ascent', 'descent']);
export const VERTICAL_OPENING_TYPE_SET = new Set(VERTICAL_OPENING_TYPES);

export function isVerticalOpeningType(type) {
  return VERTICAL_OPENING_TYPE_SET.has(String(type || '').trim().toLowerCase());
}

/** Cell contents layers (set dressing). */
export const CELL_LAYERS = Object.freeze([
  { id: 'fixtures', label: 'Fixtures', hint: 'Unmoving / architectural — walls, flooring, built-ins' },
  { id: 'furniture', label: 'Furniture', hint: 'Placed pieces — chairs, desks, beds' },
  { id: 'clutter', label: 'Clutter', hint: 'Loose objects — papers, cups, props' },
]);
export const CELL_LAYER_IDS = Object.freeze(CELL_LAYERS.map(l => l.id));
export const CELL_LAYER_SET = new Set(CELL_LAYER_IDS);

/** Inventory-matching categories for room pieces (same vocabulary as Inventory). */
export const PIECE_CATEGORIES = Object.freeze([
  { id: 'consumable', label: 'Consumable' },
  { id: 'wearable', label: 'Wearable' },
  { id: 'usable', label: 'Usable' },
  { id: 'misc', label: 'Misc' },
]);
export const PIECE_CONDITIONS = Object.freeze([
  { id: 'pristine', label: 'Pristine' },
  { id: 'fine', label: 'Fine' },
  { id: 'worn', label: 'Worn' },
  { id: 'damaged', label: 'Damaged' },
  { id: 'broken', label: 'Broken' },
  { id: 'ruined', label: 'Ruined' },
]);

/** How much of a neighbor is revealed through an opening type. */
export const OPENING_PEER_DEPTH = Object.freeze({
  window: 'edge',
  hole: 'edge',
  door: 'edge',
  arch: 'edge',
  passage: 'edge',
  ascent: 'edge',
  descent: 'edge',
});

export function emptyCell() {
  return { fixtures: [], furniture: [], clutter: [] };
}

export function emptyCells() {
  const cells = {};
  for (const id of CELLS) cells[id] = emptyCell();
  return cells;
}

/** Default unit square footprint (y-down). Edges 0=N, 1=E, 2=S, 3=W. */
export function defaultFootprint() {
  return {
    vertices: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ],
    grid: 8,
    unitPerGrid: 2,
    unitLabel: 'ft',
  };
}

export function normalizeFootprintMeta(raw = {}) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const grid = Math.max(2, Math.min(24, Math.floor(Number(src.grid) || 8)));
  const unitPerGrid = Math.max(0.25, Number(src.unitPerGrid) || 2);
  const unitLabel = String(src.unitLabel || 'ft').trim() || 'ft';
  return { grid, unitPerGrid, unitLabel };
}

export function normalizeFootprint(raw) {
  const base = defaultFootprint();
  const meta = normalizeFootprintMeta(raw);
  if (!raw || typeof raw !== 'object') return { ...base, ...meta };
  const verts = Array.isArray(raw.vertices) ? raw.vertices : [];
  if (verts.length < 3) return { ...base, ...meta };
  const grid = meta.grid;
  return {
    ...meta,
    vertices: verts.map(v => ({
      x: snap01(Number(v?.x), grid),
      y: snap01(Number(v?.y), grid),
    })),
  };
}

function clamp01(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function snap01(n, grid = 8) {
  const g = Math.max(2, grid);
  const t = clamp01(n);
  return Math.round(t * g) / g;
}

/** Snap a 0–1 point to the footprint grid. */
export function snapToFootprintGrid(x, y, footprint) {
  const meta = normalizeFootprintMeta(footprint);
  return { x: snap01(x, meta.grid), y: snap01(y, meta.grid) };
}

/**
 * Rough room scale from bounding box × grid settings.
 * @returns {{ w: number, h: number, label: string, grid: number, unitPerGrid: number, unitLabel: string }}
 */
export function estimateFootprintScale(footprint) {
  const fp = normalizeFootprint(footprint);
  let minX = 1; let maxX = 0; let minY = 1; let maxY = 0;
  for (const v of fp.vertices) {
    minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
    minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
  }
  const wGrid = Math.max(1, Math.round((maxX - minX) * fp.grid));
  const hGrid = Math.max(1, Math.round((maxY - minY) * fp.grid));
  const w = wGrid * fp.unitPerGrid;
  const h = hGrid * fp.unitPerGrid;
  const label = `~${trimNum(w)} × ${trimNum(h)} ${fp.unitLabel} (${trimNum(fp.unitPerGrid)} ${fp.unitLabel}/sq · ${fp.grid}² grid)`;
  return { w, h, label, grid: fp.grid, unitPerGrid: fp.unitPerGrid, unitLabel: fp.unitLabel };
}

function trimNum(n) {
  const x = Math.round(n * 100) / 100;
  return Number.isInteger(x) ? String(x) : String(x);
}

export const CARDINAL_TO_EDGE = Object.freeze({ N: 0, E: 1, S: 2, W: 3 });
export const EDGE_TO_CARDINAL = Object.freeze({ 0: 'N', 1: 'E', 2: 'S', 3: 'W' });

export function defaultAutoUpdate() {
  return { mode: 'off', model: 'same-as-chat' };
}

export function placeKindMeta(kind) {
  return PLACE_KINDS.find(k => k.id === kind) || PLACE_KINDS.find(k => k.id === 'room');
}

export function kindHasGrid(kind) {
  return !!placeKindMeta(kind)?.hasGrid;
}

export function isLoadableKind(kind) {
  return LOADABLE_KIND_SET.has(String(kind || '').trim());
}

/** Pose of a child room on a unit’s suite canvas (world units). */
export function normalizeSuitePose(raw = {}) {
  const rotN = Number(raw?.rot);
  const rot = [0, 90, 180, 270].includes(rotN) ? rotN : 0;
  return {
    x: Number.isFinite(Number(raw?.x)) ? Number(raw.x) : 0,
    y: Number.isFinite(Number(raw?.y)) ? Number(raw.y) : 0,
    rot,
  };
}

/** Map of childPlaceId → { x, y, rot } on a Unit. */
export function normalizeSuiteLayout(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const [id, pose] of Object.entries(raw)) {
    const key = String(id || '').trim();
    if (!key) continue;
    out[key] = normalizeSuitePose(pose);
  }
  return out;
}

/**
 * @param {object} partial
 * @returns {object}
 */
export function createRoom({
  id,
  name,
  orientation_note = '',
  description = '',
  kind = 'room',
  parentId = '',
  locationTags = [],
  footprint = null,
} = {}) {
  const rid = String(id || '').trim();
  const rname = String(name || '').trim() || rid || 'Untitled Place';
  if (!rid) throw new Error('Place id is required.');
  const k = normalizeKind(kind);
  return {
    version: COMPASS_VERSION,
    id: rid,
    name: rname,
    kind: k,
    parentId: String(parentId || '').trim(),
    locationTags: normalizeTagList(locationTags),
    description: String(description || '').trim(),
    orientation_note: String(orientation_note || '').trim(),
    exposed: false,
    footprint: kindHasGrid(k) ? normalizeFootprint(footprint) : normalizeFootprint(footprint),
    cells: kindHasGrid(k) ? emptyCells() : emptyCells(),
    exits: {},
    links: [],
    internalWalls: [],
    occupants: [],
    auto_update: defaultAutoUpdate(),
    recent_changes: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...(k === 'unit' ? { suiteLayout: {} } : {}),
  };
}

export function defaultCompassState() {
  return {
    version: COMPASS_VERSION,
    activeRoomId: '',
    rooms: {},
    lostAndFound: [],
    sonar: defaultSonar(),
  };
}

export function defaultSonar() {
  return { pings: {}, lastKey: '', lastPlaceId: '', lastAt: 0 };
}

/** Last-known narrative position tracker (soft, non-authoritative). Kept
 * separate from `normalizeRoom`'s occupants so it survives even if pings
 * reference a place/cast that's since been removed. */
export function normalizeSonar(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const pings = {};
  if (src.pings && typeof src.pings === 'object') {
    for (const [id, p] of Object.entries(src.pings)) {
      if (!p || typeof p !== 'object') continue;
      const name = String(p.name || '').trim();
      if (!name) continue;
      let cell = 'C';
      try { cell = normalizeCell(p.cell || 'C'); } catch { cell = 'C'; }
      pings[String(id || name)] = {
        name,
        castId: String(p.castId || '').trim(),
        placeId: String(p.placeId || '').trim(),
        cell,
        key: String(p.key || '').trim(),
        at: Number(p.at) || 0,
      };
    }
  }
  return {
    pings,
    lastKey: String(src.lastKey || '').trim(),
    lastPlaceId: String(src.lastPlaceId || '').trim(),
    lastAt: Number(src.lastAt) || 0,
  };
}

export function isCell(id) {
  return CELL_SET.has(String(id || '').trim().toUpperCase());
}

export function normalizeCell(id) {
  const c = String(id || '').trim().toUpperCase();
  if (!CELL_SET.has(c)) throw new Error(`Unknown cell "${id}". Use: ${CELLS.join(', ')}`);
  return c;
}

export function isFacing(id) {
  return FACING_SET.has(String(id || '').trim().toUpperCase());
}

/**
 * Normalize facing; diagonals throw a helpful error (do not silently coerce).
 * @param {string} raw
 * @returns {'N'|'E'|'S'|'W'}
 */
export function normalizeFacing(raw) {
  const f = String(raw || '').trim().toUpperCase();
  if (DIAGONAL_FACINGS.includes(f)) {
    throw new Error(`Facing "${f}" is not allowed. Use cardinal only: N, E, S, W.`);
  }
  if (!FACING_SET.has(f)) {
    throw new Error(`Facing "${raw}" is invalid. Use: N, E, S, W.`);
  }
  return f;
}

export function normalizeExitDir(raw) {
  return normalizeCell(raw);
}

export function normalizeKind(raw) {
  const k = String(raw || 'room').trim().toLowerCase();
  if (!PLACE_KIND_SET.has(k)) {
    throw new Error(`Unknown place kind "${raw}". Use: ${PLACE_KINDS.map(p => p.id).join(', ')}`);
  }
  return k;
}

export function normalizeWall(raw) {
  const w = String(raw || '').trim().toLowerCase();
  const map = {
    n: 'N', north: 'N',
    e: 'E', east: 'E',
    s: 'S', south: 'S',
    w: 'W', west: 'W',
    above: 'above', up: 'above', ceiling: 'above',
    below: 'below', down: 'below', floor: 'below',
  };
  const hit = map[w] || (WALL_SET.has(String(raw || '').trim()) ? String(raw).trim() : '');
  if (!hit || !WALL_SET.has(hit)) {
    throw new Error(`Unknown wall "${raw}". Use: ${WALLS.join(', ')}`);
  }
  return hit;
}

export function normalizeOpeningType(raw) {
  const t = String(raw || 'door').trim().toLowerCase();
  if (!OPENING_TYPE_SET.has(t)) {
    throw new Error(`Unknown opening "${raw}". Use: ${OPENING_TYPES.join(', ')}`);
  }
  return t;
}

export function normalizeTagList(raw) {
  if (!raw) return [];
  const arr = Array.isArray(raw) ? raw : String(raw).split(',');
  const out = [];
  const seen = new Set();
  for (const t of arr) {
    const s = String(t || '').trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

export function uid(prefix = 'itm') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`;
}

/** Internal barrier segment on the footprint (0–1), snapped to grid. */
export function normalizeInternalWall(raw, footprint = null) {
  const meta = footprint || { grid: 8 };
  const a = snapToFootprintGrid(Number(raw?.x0), Number(raw?.y0), meta);
  const b = snapToFootprintGrid(Number(raw?.x1), Number(raw?.y1), meta);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx * dx + dy * dy < 1e-8) return null;
  return {
    id: String(raw?.id || uid('wall')),
    x0: a.x,
    y0: a.y,
    x1: b.x,
    y1: b.y,
    label: String(raw?.label || '').trim(),
  };
}

export function normalizeInternalWalls(list, footprint = null) {
  if (!Array.isArray(list)) return [];
  return list.map(w => normalizeInternalWall(w, footprint)).filter(Boolean);
}

export function slugifyId(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48) || `place_${Date.now().toString(36)}`;
}

function normalizeOpening(raw) {
  const type = (() => {
    try { return normalizeOpeningType(raw?.type || 'door'); } catch { return 'door'; }
  })();
  let cell = '';
  if (raw?.cell) {
    try { cell = normalizeCell(raw.cell); } catch { cell = ''; }
  }
  const defaultTravel = type !== 'window' && type !== 'hole';
  let along = Number(raw?.along);
  if (!Number.isFinite(along)) along = 0.5;
  along = Math.max(0.05, Math.min(0.95, along));
  let width = Number(raw?.width);
  if (!Number.isFinite(width)) width = 0.14;
  width = Math.max(0.04, Math.min(0.5, width));
  return {
    id: String(raw?.id || uid('opn')),
    type,
    cell,
    label: String(raw?.label || raw?.name || '').trim(),
    description: String(raw?.description || '').trim(),
    peer: raw?.peer == null ? (type === 'window' || type === 'hole' || type === 'arch') : !!raw.peer,
    locked: !!raw.locked,
    keyHint: String(raw?.keyHint || '').trim(),
    travel: raw?.travel == null ? defaultTravel : !!raw.travel,
    along,
    width,
  };
}

function normalizeLink(raw) {
  let wall = '';
  const wallRaw = String(raw?.wall || '').trim();
  if (wallRaw) {
    try { wall = normalizeWall(wallRaw); } catch { wall = ''; }
  }
  let edge = raw?.edge;
  if (edge == null && CARDINAL_TO_EDGE[wall] != null) edge = CARDINAL_TO_EDGE[wall];
  if (edge != null) edge = Math.max(0, Math.floor(Number(edge)));
  else edge = null;
  if (!wall && edge != null && EDGE_TO_CARDINAL[edge]) wall = EDGE_TO_CARDINAL[edge];
  if (!wall && edge == null) wall = 'N';

  const openings = Array.isArray(raw?.openings)
    ? raw.openings.map(normalizeOpening).filter(Boolean)
    : [];
  return {
    id: String(raw?.id || uid('lnk')),
    wall,
    edge,
    toPlaceId: String(raw?.toPlaceId || '').trim(),
    description: String(raw?.description || '').trim(),
    external: !!raw?.external,
    sharedStyle: raw?.sharedStyle === 'threshold' ? 'threshold' : 'merged',
    openings,
  };
}

/**
 * Normalize one set-dressing piece (Inventory-shaped).
 */
export function normalizePiece(raw) {
  const kind = String(raw?.kind || 'item').toLowerCase() === 'container' ? 'container' : 'item';
  const cat = String(raw?.category || 'misc').toLowerCase();
  const cond = String(raw?.condition || 'fine').toLowerCase();
  const description = String(raw?.description ?? raw?.state ?? '').trim();
  const cells = normalizeCellSpan(raw?.cells);
  let maxOccupancy = Math.max(0, Math.floor(Number(raw?.maxOccupancy) || 0));
  const occupiable = raw?.occupiable == null ? maxOccupancy > 0 : !!raw.occupiable;
  if (occupiable && maxOccupancy < 1) maxOccupancy = 1;
  if (!occupiable) maxOccupancy = 0;
  const contains = !!raw?.contains;
  const vis = String(raw?.contentsVisible || 'out').toLowerCase();
  return {
    id: String(raw?.id || uid('itm')),
    kind,
    name: String(raw?.name || 'item').trim() || 'item',
    description,
    state: description,
    condition: PIECE_CONDITIONS.some(c => c.id === cond) ? cond : 'fine',
    category: kind === 'item'
      ? (PIECE_CATEGORIES.some(c => c.id === cat) ? cat : 'misc')
      : undefined,
    cells,
    occupiable,
    maxOccupancy,
    contains,
    contentsVisible: vis === 'inside' ? 'inside' : 'out',
  };
}

/** Normalize a multi-cell span list. */
export function normalizeCellSpan(raw, fallbackCell = '') {
  const list = Array.isArray(raw) ? raw : (raw ? [raw] : []);
  const out = [];
  const seen = new Set();
  for (const c of list) {
    try {
      const id = normalizeCell(c);
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    } catch { /* skip */ }
  }
  if (!out.length && fallbackCell) {
    try { out.push(normalizeCell(fallbackCell)); } catch { /* skip */ }
  }
  return out;
}

export function normalizeCellLayer(id) {
  let layer = String(id || '').trim().toLowerCase();
  if (layer === 'static') layer = 'fixtures';
  if (!CELL_LAYER_SET.has(layer)) {
    throw new Error(`Unknown cell layer "${id}". Use: ${CELL_LAYER_IDS.join(', ')}`);
  }
  return layer;
}

export function normalizeCellContents(src = {}) {
  const out = emptyCell();
  for (const layer of CELL_LAYER_IDS) {
    const list = Array.isArray(src[layer]) ? src[layer] : [];
    out[layer] = list.map(it => normalizePiece(it));
  }
  if (Array.isArray(src.static) && src.static.length) {
    for (const it of src.static) out.fixtures.push(normalizePiece(it));
  }
  if (Array.isArray(src.items) && src.items.length) {
    for (const it of src.items) out.clutter.push(normalizePiece(it));
  }
  return out;
}

/**
 * Pieces visible at a cell. Furniture may span multiple cells (anchor storage).
 * @param {object} cell local cell bag
 * @param {{ room?: object, cellId?: string }} [ctx]
 */
export function listCellPieces(cell, ctx = {}) {
  const c = cell || emptyCell();
  const out = [];
  const cellId = ctx.cellId ? String(ctx.cellId).toUpperCase() : '';
  const room = ctx.room;

  for (const layer of CELL_LAYER_IDS) {
    if (layer === 'furniture' && room && cellId) continue; // handled below
    for (const it of c[layer] || []) {
      out.push({ ...it, layer, anchor: cellId || undefined });
    }
  }

  if (room && cellId) {
    const seen = new Set();
    for (const [cid, bag] of Object.entries(room.cells || {})) {
      for (const it of bag.furniture || []) {
        const span = normalizeCellSpan(it.cells, cid);
        if (!span.includes(cellId)) continue;
        if (seen.has(it.id)) continue;
        seen.add(it.id);
        out.push({ ...it, layer: 'furniture', cells: span, anchor: cid });
      }
    }
  }

  return out;
}

/** Every unique dressing piece on the Set (fixtures, furniture, clutter). */
export function listAllSetPieces(compass) {
  const out = [];
  const seen = new Set();
  for (const room of Object.values(compass?.rooms || {})) {
    if (!room?.id) continue;
    for (const [cellId, bag] of Object.entries(room.cells || {})) {
      for (const layer of CELL_LAYER_IDS) {
        for (const it of bag?.[layer] || []) {
          if (!it?.id || seen.has(it.id)) continue;
          seen.add(it.id);
          out.push({
            ...it,
            layer,
            placeId: room.id,
            placeName: room.name,
            cell: cellId,
          });
        }
      }
    }
    for (const cellId of Object.keys(room.cells || {})) {
      for (const it of listCellPieces(room.cells?.[cellId], { room, cellId })) {
        if (!it?.id || seen.has(it.id)) continue;
        seen.add(it.id);
        out.push({
          ...it,
          placeId: room.id,
          placeName: room.name,
          cell: cellId,
        });
      }
    }
  }
  return out;
}

export function cellContentCount(cell, ctx = {}) {
  return listCellPieces(cell, ctx).length;
}

/**
 * Sync legacy `exits` labels from travel openings (cell-keyed).
 * Locked openings still register as exits but mark locked in the label.
 */
export function syncExitsFromLinks(room) {
  const exits = {};
  for (const link of room.links || []) {
    for (const op of link.openings || []) {
      if (!op.travel || !op.cell) continue;
      const bits = [op.label || op.type, link.toPlaceId ? `→ ${link.toPlaceId}` : '']
        .filter(Boolean);
      if (op.locked) bits.push('(locked)');
      exits[op.cell] = bits.join(' ').trim();
    }
  }
  room.exits = exits;
  return room;
}

/**
 * Normalize / repair a place object (returns new normalized copy).
 * @param {object} room
 */
export function normalizeRoom(room) {
  if (!room || typeof room !== 'object') throw new Error('Invalid place.');
  const id = String(room.id || '').trim();
  if (!id) throw new Error('Place id is required.');
  let kind = 'room';
  try { kind = normalizeKind(room.kind || 'room'); } catch { kind = 'room'; }

  const out = {
    version: COMPASS_VERSION,
    id,
    name: String(room.name || id).trim() || id,
    kind,
    parentId: String(room.parentId || '').trim(),
    locationTags: normalizeTagList(room.locationTags),
    description: String(room.description || '').trim(),
    orientation_note: String(room.orientation_note || '').trim(),
    exposed: !!room.exposed,
    footprint: normalizeFootprint(room.footprint),
    cells: emptyCells(),
    exits: {},
    links: [],
    internalWalls: [],
    occupants: [],
    auto_update: defaultAutoUpdate(),
    recent_changes: [],
    createdAt: Number(room.createdAt) || Date.now(),
    updatedAt: Number(room.updatedAt) || Date.now(),
  };

  const srcCells = room.cells && typeof room.cells === 'object' ? room.cells : {};
  for (const cellId of CELLS) {
    const src = srcCells[cellId] || srcCells[cellId.toLowerCase()] || {};
    out.cells[cellId] = normalizeCellContents(src);
  }

  // Do not keep free-text exits as primary — rebuilt from openings below.
  out.exits = {};

  const links = Array.isArray(room.links) ? room.links : [];
  // Keep wall/vertical anchors even before openings or neighbors are set (fixture placement).
  out.links = links.map(normalizeLink).filter(l =>
    l.toPlaceId
    || l.openings.length
    || l.external
    || l.edge != null
    || l.wall === 'above'
    || l.wall === 'below'
  );

  // Internal floorplan barriers (block area-to-area sight)
  out.internalWalls = normalizeInternalWalls(room.internalWalls, out.footprint);

  // Legacy free-text exits (no link) → soft door openings on that cell (unlocked, no neighbor).
  const srcExits = room.exits && typeof room.exits === 'object' ? room.exits : {};
  for (const [k, v] of Object.entries(srcExits)) {
    try {
      const dir = normalizeExitDir(k);
      const label = String(v || '').trim();
      if (!label) continue;
      if (out.exits[dir]) continue;
      // Keep as exit label only until a real opening exists on a link.
      out.exits[dir] = label;
    } catch { /* skip */ }
  }

  const occ = Array.isArray(room.occupants) ? room.occupants : [];
  for (const o of occ) {
    const name = String(o?.name || '').trim();
    if (!name) continue;
    let cell = 'C';
    let facing = 'N';
    try { cell = normalizeCell(o.cell || 'C'); } catch { cell = 'C'; }
    try { facing = normalizeFacing(o.facing || 'N'); } catch { facing = 'N'; }
    out.occupants.push({
      name,
      cell,
      facing,
      castId: String(o?.castId || '').trim(),
      description: String(o?.description || '').trim(),
    });
  }

  const au = room.auto_update && typeof room.auto_update === 'object' ? room.auto_update : {};
  const mode = String(au.mode || 'off').toLowerCase();
  out.auto_update = {
    mode: AUTO_UPDATE_MODES.includes(mode) ? mode : 'off',
    model: String(au.model || 'same-as-chat').trim() || 'same-as-chat',
  };

  out.recent_changes = Array.isArray(room.recent_changes)
    ? room.recent_changes.slice(-40).map(c => {
      let snap = c?.snapshot ?? null;
      if (snap && typeof snap === 'object') {
        // Drop nested history if older saves already bloated
        const { recent_changes: _nested, ...clean } = snap;
        snap = clean;
      }
      return {
        at: Number(c?.at) || Date.now(),
        summary: String(c?.summary || '').trim(),
        snapshot: snap,
      };
    })
    : [];

  syncExitsFromLinks(out);

  // Suite compose layout lives on Unit places only.
  if (out.kind === 'unit') {
    out.suiteLayout = normalizeSuiteLayout(room.suiteLayout);
    // Suite-only *visual* weld override, keyed by child room id — nudged
    // footprints used solely so the combined suite view's shared walls line
    // up with no gaps/overlaps. The child room's own `footprint` (used by
    // its individual floorplan editor) is never touched by this.
    const rawVisuals = room.suiteVisualFootprints && typeof room.suiteVisualFootprints === 'object'
      ? room.suiteVisualFootprints
      : {};
    const visuals = {};
    for (const [rid, fp] of Object.entries(rawVisuals)) {
      const cleanId = String(rid || '').trim();
      if (!cleanId) continue;
      try { visuals[cleanId] = normalizeFootprint(fp); } catch { /* skip invalid override */ }
    }
    out.suiteVisualFootprints = visuals;
  }

  return out;
}

/**
 * Top-level compass blob normalize.
 * @param {object} raw
 */
export function normalizeCompassState(raw) {
  const base = defaultCompassState();
  if (!raw || typeof raw !== 'object') return base;
  // Legacy Stage mark-grid (no version) → empty compass
  if (raw.version == null && (raw.cols != null || raw.rows != null || raw.assets)) {
    return migrateLegacyStage(raw);
  }
  const rooms = {};
  const srcRooms = raw.rooms && typeof raw.rooms === 'object' ? raw.rooms : {};
  for (const [rid, room] of Object.entries(srcRooms)) {
    try {
      const n = normalizeRoom({ ...room, id: room?.id || rid });
      rooms[n.id] = n;
    } catch (err) {
      console.warn('[Compass] skip place', rid, err);
    }
  }
  // Drop parent pointers that don't exist; break self-parent.
  for (const r of Object.values(rooms)) {
    if (r.parentId === r.id) r.parentId = '';
    if (r.parentId && !rooms[r.parentId]) r.parentId = '';
  }
  let activeRoomId = String(raw.activeRoomId || '').trim();
  if (activeRoomId && !rooms[activeRoomId]) activeRoomId = '';
  if (activeRoomId && !isLoadableKind(rooms[activeRoomId]?.kind)) activeRoomId = '';
  return {
    version: COMPASS_VERSION,
    activeRoomId,
    rooms,
    lostAndFound: Array.isArray(raw.lostAndFound)
      ? raw.lostAndFound.map(it => normalizePiece(it)).filter(Boolean)
      : [],
    sonar: normalizeSonar(raw.sonar),
  };
}

/** One-way migration from old Stage mark-grid. */
export function migrateLegacyStage(legacy) {
  const noteParts = [];
  const cols = Number(legacy?.cols) || 0;
  const rows = Number(legacy?.rows) || 0;
  if (cols || rows) noteParts.push(`Migrated from Stage mark-grid ${cols}×${rows}.`);
  const marked = Object.keys(legacy?.cells || {}).filter(k => legacy.cells[k]);
  if (marked.length) noteParts.push(`Former marked cells: ${marked.slice(0, 24).join(', ')}${marked.length > 24 ? '…' : ''}`);
  const assets = Array.isArray(legacy?.assets) ? legacy.assets : [];
  if (assets.length) {
    noteParts.push(`Former assets: ${assets.map(a => a.label || a.kind || a.id).filter(Boolean).join(', ')}`);
  }
  return {
    version: COMPASS_VERSION,
    activeRoomId: '',
    rooms: {},
    sonar: defaultSonar(),
    _migrationNote: noteParts.join(' '),
  };
}

export function snapshotRoom(room) {
  const n = normalizeRoom(room);
  // Never nest undo history inside undo history — that grows exponentially
  // and eventually throws RangeError: Invalid string length on stringify/save.
  const { recent_changes: _rc, ...rest } = n;
  return JSON.parse(JSON.stringify(rest));
}

/** Cheap stable hash for render cache keys. */
export function roomHash(room) {
  try {
    const n = normalizeRoom(room);
    const key = {
      id: n.id,
      name: n.name,
      kind: n.kind,
      exposed: n.exposed,
      cells: n.cells,
      exits: n.exits,
      links: n.links,
      occupants: n.occupants,
    };
    return simpleHash(JSON.stringify(key));
  } catch {
    return String(Date.now());
  }
}

function simpleHash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/**
 * Build a depth-first tree of places for UI.
 * @param {object} compass
 * @returns {Array<{ place: object, depth: number, path: string[] }>}
 */
export function buildPlaceTree(compass) {
  const rooms = compass?.rooms || {};
  const children = new Map();
  for (const r of Object.values(rooms)) {
    const p = r.parentId || '';
    if (!children.has(p)) children.set(p, []);
    children.get(p).push(r);
  }
  for (const list of children.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name));
  }
  const out = [];
  const walk = (parentId, depth, path) => {
    const list = children.get(parentId) || [];
    for (const place of list) {
      if (path.includes(place.id)) continue; // cycle guard
      out.push({ place, depth, path: [...path, place.id] });
      walk(place.id, depth + 1, [...path, place.id]);
    }
  };
  walk('', 0, []);
  // Orphans already covered via parentId ''; any with missing parent cleared in normalize.
  return out;
}

/** Whether place locationTags intersect active scene location tags (case-insensitive). */
export function placeMatchesLocationTags(place, activeTags = []) {
  const tags = normalizeTagList(place?.locationTags);
  if (!tags.length || !activeTags?.length) return false;
  const want = new Set(activeTags.map(t => String(t).trim().toLowerCase()).filter(Boolean));
  return tags.some(t => want.has(t.toLowerCase()));
}
