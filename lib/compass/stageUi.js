// Room Compass — Backstage Set / Placement HTML fragments.

import {
  CELLS,
  CELL_LAYERS,
  CELL_ROWS,
  FACINGS,
  PLACE_KINDS,
  placeKindMeta,
  isLoadableKind,
  isSuiteHostKind,
  isExteriorHostKind,
  isCompassPlaceKind,
  isScenePlaceKind,
  enclosingOutdoorPlace,
  cellDisplayLabel,
  GEO_PLACE_KIND_SET,
  ROOMISH_PLACE_KIND_SET,
  PLACE_NEST_PARENTS,
} from './schema.js';
import {
  buildPlaceTree,
  gatherPeerViews,
  getPlace,
  disambiguatedPlaceName,
  ensureSuiteLayout,
  listLinkableNeighbors,
  topSuiteAncestorId,
} from './state.js';
import { cellSummaryBits, renderFloorplan, renderFloorplanReadonly, renderSuiteFloorplan } from './dialogs.js';
import { formatWallLinkLabel } from './floorplan.js';
import { isSuiteChild, listSuiteChildren, listSuiteUnits } from './suiteLayout.js';
import { formatPovBlock } from './render.js';
import {
  listAreaContents,
  accessibleAreas,
  listSonarPingsInPlace,
  areaObserver,
} from './sonar.js';
import { locationTagEditorHTML } from '../locationTagPicker.js';
import { getSceneCards } from '../scriptCatalog.js';
import { listVisibleLibraryLeaves } from '../libraryCatalog.js';
import { getCastMembers } from '../castCatalog.js';
import {
  collectListingPalette,
  listingCodeLabel,
  listingCodesFromPlaces,
  resolveListingCode,
  suiteListingLine,
} from './listing.js';
import {
  PLACE_CATEGORY_GROUPS,
  canonicalizeTypology,
  categoryLabel,
  typologyHeadline,
} from './roomProgram.js';
import {
  LOCATION_GROUP_KINDS,
  ensureLocationCatalog,
  listLocationTree,
  geographicAncestors,
  GROUP_TO_COMPASS,
  pruneGhostLocationNodes,
} from '../locationCatalog.js';
import { syncScriptLibraryUnlisted, listUnlisted } from './unlisted.js';

function catalogKindLabel(kind) {
  return LOCATION_GROUP_KINDS.find(k => k.id === kind)?.label
    || placeKindMeta(kind)?.label
    || String(kind || '').trim();
}

const TREE_KIND_LABELS = Object.freeze({
  country: 'Country',
  region: 'Country',
  city: 'City',
  settlement: 'City',
  area: 'Area',
  district: 'Area',
  building: 'Building',
  unit: 'Unit',
  room: 'Room',
  transitional: 'Hall',
});

function treeKindLabel(kind) {
  return TREE_KIND_LABELS[kind] || catalogKindLabel(kind).split(' / ')[0] || '';
}

function addSource(map, name, source) {
  const key = String(name || '').trim().toLowerCase();
  if (!key || !source) return;
  let set = map.get(key);
  if (!set) {
    set = [];
    map.set(key, set);
  }
  if (!set.includes(source)) set.push(source);
}

function sourcesFor(map, name) {
  return map.get(String(name || '').trim().toLowerCase()) || [];
}

export function collectSetPlaceTree(compass, storage) {
  try { syncScriptLibraryUnlisted(compass, storage); } catch { /* ignore */ }
  try { ensureLocationCatalog(storage, compass); } catch { /* ignore */ }
  try { pruneGhostLocationNodes(storage, compass); } catch { /* ignore */ }

  const sourceMap = new Map();
  for (const place of Object.values(compass?.rooms || {})) {
    addSource(sourceMap, place.name, 'compass');
    for (const tag of place.locationTags || []) addSource(sourceMap, tag, 'compass');
  }
  try {
    for (const row of getSceneCards(storage) || []) {
      const card = row?.card || row;
      if (card?.active === false || card?.kind === 'folder') continue;
      for (const loc of card?.keywordFacets?.location || []) addSource(sourceMap, loc, 'script');
    }
  } catch { /* ignore */ }
  try {
    for (const leaf of listVisibleLibraryLeaves(storage) || []) {
      for (const t of leaf.tags || []) {
        const type = String(t.type || '').toLowerCase();
        if (type !== 'place' && type !== 'location') continue;
        addSource(sourceMap, t.value, 'library');
      }
    }
  } catch { /* ignore */ }

  const rooms = Object.values(compass?.rooms || {});
  const catalog = listLocationTree(storage, compass);
  const kinded = catalog.filter(n => n.kind);
  const unkinded = catalog.filter(n => !n.kind);
  const claimedNames = new Set();
  const claim = (name) => {
    const k = String(name || '').trim().toLowerCase();
    if (k) claimedNames.add(k);
  };

  const bindPlaceId = (n) => {
    const linked = n.placeId ? compass?.rooms?.[n.placeId] : null;
    const same = linked && String(linked.name || '').trim().toLowerCase() === String(n.name || '').trim().toLowerCase();
    if (same) return n.placeId;
    return findPlaceByExactName(compass, n.name)?.id || '';
  };

  const makeRoomLeaf = (place) => ({
    id: `room:${place.id}`,
    name: place.name,
    kind: place.kind,
    compassKind: place.kind,
    placeId: place.id,
    sources: sourcesFor(sourceMap, place.name),
    children: [],
  });

  const itemById = new Map();
  const byPlaceId = new Map();
  for (const n of kinded) {
    const placeId = bindPlaceId(n);
    const bound = placeId ? compass?.rooms?.[placeId] : null;
    // A hall, room, or unit already draws from its compass parent. A second
    // catalog row (often still parented to the wrong building) is what made
    // 2F Promenade show under both Canal City Mall and Okisato Antiques, and
    // made "merge" refuse because both rows were the same place.
    if (bound && ROOMISH_PLACE_KIND_SET.has(bound.kind)) continue;
    claim(n.name);
    const compassKind = bound?.kind || GROUP_TO_COMPASS[n.kind] || n.kind;
    const item = {
      id: n.id,
      name: n.name,
      kind: n.kind,
      compassKind,
      placeId,
      sources: sourcesFor(sourceMap, n.name),
      children: [],
    };
    itemById.set(n.id, item);
    if (placeId && !byPlaceId.has(placeId)) byPlaceId.set(placeId, item);
  }

  const roomishLeaves = [];
  for (const place of rooms) {
    if (!place?.id || GEO_PLACE_KIND_SET.has(place.kind)) continue;
    const leaf = makeRoomLeaf(place);
    byPlaceId.set(place.id, leaf);
    roomishLeaves.push({ place, leaf });
  }

  const nestedRooms = new Set();
  for (const { place, leaf } of roomishLeaves) {
    let parentItem = place.parentId ? byPlaceId.get(place.parentId) : null;
    if (!parentItem) {
      const geo = geographicAncestors(compass, place.id)[0];
      parentItem = geo ? byPlaceId.get(geo.id) : null;
    }
    if (parentItem && parentItem !== leaf) {
      claim(place.name);
      parentItem.children.push(leaf);
      nestedRooms.add(place.id);
    }
  }

  const roots = [];
  for (const n of kinded) {
    const item = itemById.get(n.id);
    if (!item) continue;
    const parent = n.parentId && itemById.get(n.parentId);
    if (parent) parent.children.push(item);
    else roots.push(item);
  }

  const sortTree = (list) => {
    const folder = (n) => LOCATION_GROUP_KINDS.some(k => k.id === n.kind);
    list.sort((a, b) => {
      const af = folder(a);
      const bf = folder(b);
      if (af !== bf) return af ? -1 : 1;
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
    for (const n of list) sortTree(n.children || []);
  };
  sortTree(roots);

  const unfiled = [];
  for (const n of unkinded) {
    const key = String(n.name || '').trim().toLowerCase();
    if (!key || claimedNames.has(key)) continue;
    const bound = bindPlaceId(n);
    const boundPlace = bound ? compass?.rooms?.[bound] : null;
    if (boundPlace) continue;
    claim(n.name);
    unfiled.push({
      id: n.id,
      name: n.name,
      kind: n.kind || '',
      compassKind: (bindPlaceId(n) && compass?.rooms?.[bindPlaceId(n)]?.kind) || '',
      placeId: bindPlaceId(n),
      sources: sourcesFor(sourceMap, n.name),
      children: [],
    });
  }
  for (const { place, leaf } of roomishLeaves) {
    if (nestedRooms.has(place.id)) continue;
    const key = String(place.name || '').trim().toLowerCase();
    if (key && claimedNames.has(key)) continue;
    unfiled.push(leaf);
  }
  sortTree(unfiled);

  const stamp = (nodes, depth) => {
    for (const n of nodes) {
      n.depth = depth;
      stamp(n.children || [], depth + 1);
      n.nested = (n.children || []).reduce((s, c) => s + 1 + (c.nested || 0), 0);
    }
  };
  stamp(roots, 0);
  stamp(unfiled, 1);

  const unlisted = [];
  try {
    for (const u of listUnlisted(compass)) {
      const key = String(u.name || '').trim().toLowerCase();
      if (!key || claimedNames.has(key)) continue;
      claim(u.name);
      unlisted.push({
        id: u.id,
        name: u.name,
        kind: '',
        compassKind: '',
        placeId: '',
        sources: u.source ? [u.source] : [],
        children: [],
        unlisted: true,
      });
    }
  } catch { /* ignore */ }
  sortTree(unlisted);
  stamp(unlisted, 1);

  return { roots, unfiled, unlisted };
}

function focusFoldIds(compass, focusId, roots) {
  const ids = new Set();
  if (!focusId) return ids;
  const rooms = compass?.rooms || {};
  const placeIds = new Set();
  let walk = rooms[focusId];
  const guard = new Set();
  while (walk && !guard.has(walk.id)) {
    guard.add(walk.id);
    placeIds.add(walk.id);
    ids.add(`room:${walk.id}`);
    walk = walk.parentId ? rooms[walk.parentId] : null;
  }
  const visit = (n) => {
    const childHit = (n.children || []).some(c => visit(c));
    const on = placeIds.has(n.placeId) || placeIds.has(n.id) || childHit;
    if (on) ids.add(n.id);
    return on;
  };
  for (const n of roots) visit(n);
  return ids;
}

function renderPlaceChips(sources, esc, node = null) {
  return (sources || []).map((s) => {
    const label = s === 'compass' ? 'Compass' : s === 'script' ? 'Script' : s === 'chat' ? 'Narrative' : 'Library';
    if (s === 'compass' && node?.placeId) {
      return `<button type="button" class="bst-set-src bst-set-src--compass" data-action="place-open-compass" data-place="${esc(node.placeId)}" title="Open compass / floorplan">${esc(label)}</button>`;
    }
    return `<span class="bst-set-src bst-set-src--${esc(s)}">${esc(label)}</span>`;
  }).join('');
}

function compassKindOf(node) {
  if (node.compassKind && PLACE_NEST_PARENTS[node.compassKind]) return node.compassKind;
  if (GROUP_TO_COMPASS[node.kind]) return GROUP_TO_COMPASS[node.kind];
  if (PLACE_NEST_PARENTS[node.kind]) return node.kind;
  return 'room';
}

function descendantPlaceIds(compass, rootId) {
  const out = new Set([String(rootId || '')]);
  let added = true;
  while (added) {
    added = false;
    for (const p of Object.values(compass?.rooms || {})) {
      if (p?.parentId && out.has(p.parentId) && !out.has(p.id)) {
        out.add(p.id);
        added = true;
      }
    }
  }
  return out;
}

function renderKindSelect(node, esc) {
  const current = compassKindOf(node);
  const opts = PLACE_KINDS.map(k =>
    `<option value="${esc(k.id)}"${k.id === current ? ' selected' : ''}>${esc(k.label)}</option>`).join('');
  return `<select class="bst-input bst-set-kind-sel" data-role="place-edit-kind" title="Country → city → area → building → room">${opts}</select>`;
}

function renderParentSelect(node, { compass, esc }) {
  const kind = compassKindOf(node);
  const allow = PLACE_NEST_PARENTS[kind] || [];
  const selfId = String(node.placeId || '');
  const blocked = selfId ? descendantPlaceIds(compass, selfId) : new Set();
  const currentParent = compass?.rooms?.[selfId]?.parentId || '';
  const rooms = Object.values(compass?.rooms || {})
    .filter(p => p?.id && !blocked.has(p.id))
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  const opts = [
    `<option value="">— Root —</option>`,
    ...rooms.map((p) => {
      const ok = allow.includes(p.kind);
      const sel = p.id === currentParent && ok ? ' selected' : '';
      const hide = ok ? '' : ' hidden';
      return `<option value="${esc(p.id)}" data-kind="${esc(p.kind)}"${sel}${hide}>${esc(nestPathLabel(compass, p))}</option>`;
    }),
  ].join('');
  return `<select class="bst-input bst-set-parent-sel" data-role="place-edit-parent" title="Nest under a parent in Country → City → Area → Building">${opts}</select>`;
}

function renderMergeSelect(node, { compass, storage, esc }) {
  const selfPlace = String(node.placeId || '');
  const blocked = selfPlace ? descendantPlaceIds(compass, selfPlace) : new Set();
  const rooms = Object.values(compass?.rooms || {})
    .filter(p => p?.id && !blocked.has(p.id))
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  const seen = new Set(rooms.map(p => p.id));
  const extras = [];
  try {
    for (const n of listLocationTree(storage, compass) || []) {
      if (!n || n.id === node.id) continue;
      if (n.placeId && (blocked.has(n.placeId) || seen.has(n.placeId))) continue;
      extras.push(n);
    }
  } catch { /* ignore */ }
  extras.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  const opts = [
    `<option value="">Merge into…</option>`,
    ...rooms.map((p) => {
      return `<option value="place:${esc(p.id)}">${esc(nestPathLabel(compass, p))}</option>`;
    }),
    ...extras.map((n) => {
      const meta = catalogKindLabel(n.kind) || 'Unfiled';
      const val = n.placeId ? `place:${n.placeId}` : `node:${n.id}`;
      return `<option value="${esc(val)}">${esc(n.name)} (${esc(meta)})</option>`;
    }),
  ].join('');
  return `<select class="bst-input bst-set-parent-sel" data-role="place-edit-merge" title="Fold this place into another">${opts}</select>`;
}

function renderListingSelect(place, ctx) {
  const { compass, storage, esc } = ctx;
  if (!place || (place.kind !== 'room' && place.kind !== 'transitional')) return '';
  const extra = [
    ...((storage?.getChat?.('backstage', {}) || {}).customListingCodes || []),
    ...listingCodesFromPlaces(compass),
    place.listingCode,
  ];
  const pal = collectListingPalette(extra);
  const current = String(place.listingCode || '').trim();
  const inferred = resolveListingCode({ ...place, listingCode: '' });
  const opts = [
    `<option value="">Infer${inferred ? ` (${esc(inferred)})` : ''}</option>`,
    ...pal.keys.map(id => {
      const builtin = listingCodeLabel(id).includes('·');
      const label = builtin ? listingCodeLabel(id) : `${id} · custom`;
      return `<option value="${esc(id)}"${id === current ? ' selected' : ''}>${esc(label)}</option>`;
    }),
  ].join('');
  return `
    <label class="bst-set-nest-lab">Listing
      <select class="bst-input bst-set-kind-sel" data-role="place-edit-listing">${opts}</select>
    </label>
    <span class="bst-set-listing-custom">
      <input class="bst-input" data-role="place-edit-listing-custom" placeholder="custom code" maxlength="12" style="width:7em">
      <button type="button" class="bst-btn" data-action="place-listing-add" data-place="${esc(place.id || '')}" data-node="${esc(ctx.editId || '')}">Add</button>
    </span>`;
}

export function renderCategorySelectOptions(selectedId = '', esc, {
  hostKind = '',
  hostName = '',
  emptyLabel = '— Category —',
} = {}) {
  const sel = String(selectedId || '').trim();
  const inferred = !sel && (hostName || hostKind)
    ? canonicalizeTypology('', { hostKind, hostName })
    : '';
  const inferredLabel = inferred ? categoryLabel(inferred) : '';
  const head = `<option value="">${esc(inferredLabel ? `${emptyLabel} (Auto: ${inferredLabel})` : emptyLabel)}</option>`;
  const body = PLACE_CATEGORY_GROUPS.map(group => {
    const opts = group.items.map(it =>
      `<option value="${esc(it.id)}"${it.id === sel ? ' selected' : ''}>${esc(it.label)}</option>`,
    ).join('');
    return `<optgroup label="${esc(group.label)}">${opts}</optgroup>`;
  }).join('');
  return `${head}${body}`;
}

export function renderLinkableNeighborOptions(compass, room, {
  selectedId = '',
  emptyLabel = '— Neighbor place —',
  esc,
} = {}) {
  const { siblings = [], corridors = [], units = [], others = [] } = listLinkableNeighbors(compass, room);
  const sel = String(selectedId || '').trim();
  const fmt = (p) => {
    const parent = p.parentId ? compass?.rooms?.[p.parentId] : null;
    const kindBit = placeKindMeta(p.kind)?.label || p.kind;
    if (parent && parent.id !== room?.parentId) {
      return `${p.name} (${kindBit} · ${parent.name})`;
    }
    return `${p.name} (${kindBit})`;
  };
  const groupHtml = (label, list) => {
    if (!list.length) return '';
    return `<optgroup label="${esc(label)}">${list.map(p =>
      `<option value="${esc(p.id)}"${p.id === sel ? ' selected' : ''}>${esc(fmt(p))}</option>`,
    ).join('')}</optgroup>`;
  };
  const body = [
    groupHtml('In this suite / unit', siblings),
    groupHtml('Corridors & shared spaces', corridors),
    groupHtml('Neighboring units & rooms', units),
    groupHtml('Other places', others),
  ].filter(Boolean).join('');
  return `<option value="">${esc(emptyLabel)}</option>${body || '<option value="" disabled>No linkable places yet</option>'}`;
}

function renderPlaceEdit(node, ctx) {
  const { compass, esc } = ctx;
  const place = node.placeId ? compass?.rooms?.[node.placeId] : null;
  const kind = compassKindOf(node);
  const canPopulate = kind === 'building';
  const currentCat = String(place?.category || '').trim();
  const aliases = (place?.aliases || []).join(', ');
  const ids = `data-place="${esc(node.placeId || '')}" data-node="${esc(node.id)}" data-tag="${esc(node.name)}"${node.unlisted ? ' data-unlisted="1"' : ''}`;
  const catControls = `<span data-role="place-edit-category-wrap"${canPopulate ? '' : ' hidden'}>
      <label class="bst-set-nest-lab">Category
        <select class="bst-input bst-set-kind-sel" data-role="place-edit-category">${renderCategorySelectOptions(currentCat, esc, { hostKind: 'building', hostName: node.name })}</select>
      </label>
      ${place?.id ? `<button type="button" class="bst-btn" data-action="compass-populate-category" ${ids} title="Fill this building with rooms for the chosen category">Populate</button>` : ''}
    </span>`;
  const danger = node.unlisted
    ? `<div class="bst-set-edit-danger">
      <button type="button" class="bst-btn" data-action="place-unlisted-dismiss" ${ids} title="Remove from Unlisted without deleting Script or Library tags">Dismiss</button>
    </div>`
    : `<div class="bst-set-edit-danger">
      <button type="button" class="bst-btn bst-btn-danger" data-action="place-edit-remove" ${ids} title="Delete this place and strip its tags from Script, Library, and Compass">Remove</button>
      <label class="bst-set-nest-lab">Merge ${renderMergeSelect(node, ctx)}</label>
      <button type="button" class="bst-btn" data-action="place-edit-merge" ${ids} title="Move tags, aliases, and nested places into another location">Merge</button>
    </div>`;
  return `<div class="bst-set-edit" ${ids}>
    <input class="bst-input" data-role="place-edit-name" value="${esc(node.name)}" placeholder="Name">
    ${renderKindSelect(node, esc)}
    <label class="bst-set-nest-lab">Nest under ${renderParentSelect(node, ctx)}</label>
    ${catControls}
    <input class="bst-input" data-role="place-edit-aliases" value="${esc(aliases)}" placeholder="Aliases / other names that call this place">
    ${renderListingSelect(place, { ...ctx, editId: node.id })}
    <button type="button" class="bst-btn gold" data-action="place-edit-save" ${ids}>Save</button>
    <button type="button" class="bst-btn" data-action="place-edit-cancel">Cancel</button>
    ${danger}
  </div>`;
}

function renderPlaceItem(node, ctx) {
  const { focusId, esc, editId, compass } = ctx;
  const on = node.placeId && node.placeId === focusId;
  const kind = treeKindLabel(node.compassKind || node.kind);
  const nested = Number(node.nested) || 0;
  const place = node.placeId ? compass?.rooms?.[node.placeId] : null;
  const listing = place && (place.kind === 'building' || place.kind === 'unit')
    ? suiteListingLine(place, null, compass)
    : '';
  const code = place && (place.kind === 'room' || place.kind === 'transitional')
    ? resolveListingCode(place)
    : '';
  const nestedLabel = listing
    ? listing.includes('|') ? listing.split('|').slice(1).join('|').trim() : listing
    : (code || (nested ? String(nested) : (kind ? '' : (node.unlisted ? '' : '0'))));
  const editing = String(editId || '') === String(node.id);
  const name = String(node.name || '').trim() || 'Untitled';
  const hostNote = place ? disambiguatedPlaceName(compass, place) : name;
  const hostBit = hostNote && hostNote !== name ? hostNote.slice(name.length).replace(/^\s*·\s*/, '') : '';
  const unlisted = node.unlisted ? ' data-unlisted="1"' : '';
  const dismiss = node.unlisted
    ? `<button type="button" class="bst-btn" data-action="place-unlisted-dismiss" data-node="${esc(node.id)}" data-tag="${esc(node.name || name)}" title="Remove from Unlisted without deleting Script or Library tags">Dismiss</button>`
    : '';
  return `<div class="bst-set-index-row${on ? ' on' : ''}${editing ? ' editing' : ''}">
    <button type="button" class="bst-set-index-item${on ? ' on' : ''}" data-action="set-open-place" data-place="${esc(node.placeId || '')}" data-node="${esc(node.id)}" data-tag="${esc(node.name || name)}"${unlisted} title="${esc(place && isSuiteHostKind(place.kind) ? `Open ${name}` : (listing || name))}">
      <span class="bst-set-index-name" title="${esc(hostNote || name)}">${esc(name)}</span>
      <span class="bst-k bst-set-kind">${esc([kind, nestedLabel, hostBit].filter(Boolean).join(' · '))}</span>
    </button>
    <span class="bst-set-index-chips">${renderPlaceChips(node.sources, esc, node)}</span>
    <button type="button" class="bst-btn bst-set-edit-btn${editing ? ' gold' : ''}" data-action="place-edit" data-place="${esc(node.placeId || '')}" data-node="${esc(node.id)}" title="${node.unlisted ? 'File this place' : 'Rename, nest, merge, or remove'}">Edit</button>
    ${dismiss}
  </div>`;
}

function renderPlaceTreeNodes(nodes, ctx) {
  if (!nodes?.length) return '';
  return `<ul class="bst-set-tree">${nodes.map(node => renderPlaceTreeNode(node, ctx)).join('')}</ul>`;
}

function renderPlaceTreeNode(node, ctx) {
  const kids = node.children || [];
  const item = renderPlaceItem(node, ctx);
  const editing = String(ctx.editId || '') === String(node.id);
  const edit = editing ? renderPlaceEdit(node, ctx) : '';
  if (!kids.length) return `<li class="bst-set-tree-node">${item}${edit}</li>`;
  const open = ctx.foldSet.has(node.id)
    || (ctx.auto && (node.depth === 0 || ctx.focusPath.has(node.id) || ctx.focusPath.has(node.placeId)))
    || editing;
  return `<li class="bst-set-tree-node">
    <details class="bst-set-fold" data-role="places-fold" data-fold="${ctx.esc(node.id)}"${open ? ' open' : ''}>
      <summary>${item}</summary>
      ${edit}
      ${renderPlaceTreeNodes(kids, ctx)}
    </details>
  </li>`;
}

function placesNamed(compass, tag) {
  const k = String(tag || '').trim().toLowerCase();
  if (!k) return [];
  return Object.values(compass?.rooms || {}).filter(p =>
    String(p?.name || '').trim().toLowerCase() === k);
}

function onePlace(list, parentId = '') {
  const want = String(parentId || '').trim();
  const scoped = want ? list.filter(p => String(p?.parentId || '') === want) : list;
  return scoped.length === 1 ? scoped[0] : null;
}

/** Exact name. A parent scope never borrows a same-named room from another building. */
export function findPlaceByExactName(compass, tag, { parentId = '' } = {}) {
  return onePlace(placesNamed(compass, tag), parentId);
}

export function findPlaceForTag(compass, tag, { parentId = '' } = {}) {
  const exact = findPlaceByExactName(compass, tag, { parentId });
  if (exact) return exact;
  const k = String(tag || '').trim().toLowerCase();
  if (!k) return null;
  const tagged = Object.values(compass?.rooms || {}).filter(p =>
    (p?.locationTags || []).some(t => String(t).trim().toLowerCase() === k)
    || (p?.aliases || []).some(t => String(t).trim().toLowerCase() === k));
  return onePlace(tagged, parentId);
}

function renderSetPlaceIndex(compass, {
  storage,
  focusId,
  createOpen,
  esc,
  placesFold = [],
  placesFoldAuto = true,
  placesEditId = '',
  placesOpen = true,
  createDraft = null,
}) {
  const { roots, unfiled, unlisted } = collectSetPlaceTree(compass, storage);
  const foldSet = new Set((placesFold || []).map(String));
  const focusPath = focusFoldIds(compass, focusId, [...roots, ...unfiled]);
  const ctx = { focusId, esc, foldSet, auto: !!placesFoldAuto, focusPath, editId: placesEditId, compass, storage };
  const unfiledOpen = foldSet.has('__unfiled')
    || (placesFoldAuto && (unfiled.some(n => focusPath.has(n.id) || focusPath.has(n.placeId)) || (!roots.length && unfiled.length && !unlisted.length)));
  const unlistedOpen = foldSet.has('__unlisted')
    || (placesFoldAuto && (unlisted.some(n => String(placesEditId || '') === String(n.id)) || (!roots.length && !unfiled.length && unlisted.length)));
  const unfiledBlock = unfiled.length
    ? `<li class="bst-set-tree-node">
        <details class="bst-set-fold" data-role="places-fold" data-fold="__unfiled"${unfiledOpen ? ' open' : ''}>
          <summary class="bst-set-index-item bst-set-unfiled-h">
            <span class="bst-set-index-name">Unfiled</span>
            <span class="bst-k">${unfiled.length}</span>
          </summary>
          ${renderPlaceTreeNodes(unfiled, ctx)}
        </details>
      </li>`
    : '';
  const unlistedBlock = unlisted.length
    ? `<li class="bst-set-tree-node">
        <details class="bst-set-fold" data-role="places-fold" data-fold="__unlisted"${unlistedOpen ? ' open' : ''}>
          <summary class="bst-set-index-item bst-set-unlisted-h">
            <span class="bst-set-index-name">Unlisted</span>
            <span class="bst-k">${unlisted.length}</span>
          </summary>
          ${renderPlaceTreeNodes(unlisted, ctx)}
        </details>
      </li>`
    : '';
  const body = (roots.length || unfiled.length || unlisted.length)
    ? `<ul class="bst-set-index-list bst-set-tree bst-set-tree--root">${
      roots.map(n => renderPlaceTreeNode(n, ctx)).join('')
    }${unfiledBlock}${unlistedBlock}</ul>`
    : '<div class="bst-empty">No places yet — add one, or open a Script / Library location tag.</div>';
  return `
    <details class="bst-places-fold bst-fold" data-fold="set-places"${placesOpen ? ' open' : ''}>
      <summary class="bst-places-sum">
        <span class="bst-section-h" style="margin:0">Places</span>
        <button type="button" class="bst-btn${createOpen ? ' gold' : ''}" data-action="set-toggle-create">+ Place</button>
      </summary>
      <div class="bst-places-body">
        ${createOpen ? renderCreateForm(compass, esc, createDraft) : ''}
        ${body}
      </div>
    </details>`;
}

function renderNarrativePopulateFold(compass, targetPlace, { cell = 'C', esc } = {}) {
  if (!targetPlace || (!isCompassPlaceKind(targetPlace.kind) && !isSuiteHostKind(targetPlace.kind))) return '';
  const isHost = isSuiteHostKind(targetPlace.kind);
  return `
    <details class="bst-section bst-fold bst-narrative-populate" data-fold="compass-narrative-populate">
      <summary class="bst-section-h">Populate from narrative <span class="bst-k">· establish rooms, doors, surfaces &amp; items from prose</span></summary>
      <div class="bst-fold-body">
        <p class="bst-hint">Paste narrative prose describing a room or adjacent rooms (e.g., break room, storage room beyond the south door, display floor), or pull from recent chat. Items are sorted into Fixtures, Furniture, and Clutter with surfaces &amp; containers linked.</p>
        <textarea class="bst-input" data-role="narrative-populate-text" data-place="${esc(targetPlace.id)}" rows="3" placeholder="Paste narrative text describing the room(s), surfaces, containers, and items (or leave blank to pull from recent chat)…"></textarea>
        <div class="bst-row" style="margin-top:6px">
          <label class="bst-k">Scope
            <select class="bst-input" data-role="narrative-populate-scope" data-place="${esc(targetPlace.id)}">
              <option value="auto">Auto-match / create rooms in suite</option>
              ${!isHost ? `<option value="room">This place only (${esc(targetPlace.name)})</option>` : ''}
            </select>
          </label>
          <button type="button" class="bst-btn gold" data-action="compass-populate-narrative" data-place="${esc(targetPlace.id)}" data-cell="${esc(cell)}">Populate from text</button>
          <button type="button" class="bst-btn" data-action="compass-populate-from-chat" data-place="${esc(targetPlace.id)}" data-cell="${esc(cell)}" title="Extract room items from recent chat messages">Pull from chat</button>
        </div>
      </div>
    </details>`;
}

function renderSuiteDraftStrip(draft, esc) {
  if (!draft || draft.status !== 'review') return '';
  const rooms = Array.isArray(draft.rooms) ? draft.rooms : [];
  const typeLabel = typologyHeadline(draft.typology);
  const items = rooms.map(r => {
    const code = listingCodeLabel(r.listing) || r.listing || '';
    return `<li><strong>${esc(r.name || r.key)}</strong>${code ? ` <span class="bst-k">${esc(code)}</span>` : ''}${r.blurb ? ` — ${esc(r.blurb)}` : ''}</li>`;
  }).join('');
  return `
    <section class="bst-section bst-suite-draft">
      <h3 class="bst-section-h">Interior draft${typeLabel ? ` · ${esc(typeLabel)}` : ''}</h3>
      <p class="bst-hint">${esc(draft.hostName || 'Suite')}${draft.description ? ` — ${esc(draft.description)}` : ''}</p>
      <ul class="bst-suite-draft-list">${items}</ul>
      <div class="bst-suite-draft-act">
        <button type="button" class="bst-btn gold" data-action="suite-draft-accept">Build rooms</button>
        <button type="button" class="bst-btn" data-action="suite-draft-dismiss">Not now</button>
      </div>
    </section>`;
}

/**
 * Set door — places, floorplan shape, compass areas, wall links.
 */
export function buildSetHtml({
  compass,
  active,
  focusId = '',
  selCell = 'C',
  selectedEdges = [],
  drawWallMode = false,
  fpMode = 'move',
  fixtureAct = 'place',
  suiteMode = 'browse',
  suiteFixtureAct = 'place',
  wallLinksOpen = false,
  suiteHighlightChild = '',
  selectedShared = null,
  selectedEdge = null,
  suiteSelEdges = [],
  sonarNote = '',
  sonarStatus = null,
  placesOpen = null,
  metaOpen = false,
  herePlaceId = '',
  hereCell = 'C',
  lastOpening = null,
  sonarCast = [],
  storyFocus = 'upper',
  storage = null,
  createOpen = false,
  sonarFilter = '',
  sonarView = 'all',
  sonarOpen = false,
  placesFold = [],
  placesFoldAuto = true,
  placesEditId = '',
  createDraft = null,
  suiteDraft = null,
  suiteFromChild = false,
  esc,
}) {
  const focus = getPlace(compass, focusId) || active || null;
  const focusIsLoadable = focus ? isLoadableKind(focus.kind) : false;
  const focusIsSuiteHost = isSuiteHostKind(focus?.kind);
  const focusIsExterior = isExteriorHostKind(focus?.kind);
  const nestKids = (focusIsSuiteHost && focus) ? listSuiteChildren(compass, focus.id) : [];
  const nestUnits = (focusIsSuiteHost && focus) ? listSuiteUnits(compass, focus.id) : [];
  const emptyExterior = !!focus && focusIsExterior && !nestKids.length && !nestUnits.length;
  const editing = (focusIsLoadable || emptyExterior)
    ? focus
    : (focusIsExterior ? null : (active && isLoadableKind(active.kind) ? active : null));
  const cell = selCell || 'C';
  const peeks = editing ? gatherPeerViews(compass, editing) : [];
  const suiteModeSafe = ['arrange', 'walls', 'fixtures'].includes(suiteMode) ? suiteMode : 'browse';
  const suiteFixtureActSafe = suiteFixtureAct === 'remove' ? 'remove' : (suiteFixtureAct === 'place' ? 'place' : '');
  const storyFocusSafe = (storyFocus === 'lower' || storyFocus === 'upper')
    ? storyFocus
    : (storyFocus != null && storyFocus !== '' && Number.isFinite(Number(storyFocus))
      ? String(Math.round(Number(storyFocus)))
      : 'upper');

  if (focusIsSuiteHost) {
    try { ensureSuiteLayout(compass, focus.id); } catch { /* ignore */ }
  }
  const suiteHost = focusIsSuiteHost ? getPlace(compass, focus.id) : null;
  const showNest = !!suiteHost && !emptyExterior;
  const showFloor = !showNest && (focusIsExterior || emptyExterior || !!editing);
  const showTags = !!focus && !showNest && !showFloor;
  let lockCast = [];
  try { lockCast = getCastMembers(storage); } catch { /* ignore */ }
  const listingBit = suiteHost ? suiteListingLine(suiteHost, nestKids, compass) : '';

  const canPopulateFocus = focus?.kind === 'building';
  const stageHead = focus ? `
    <div class="bst-set-stage-head">
      ${renderPlaceCrumb(compass, focus, esc)}
      <strong>${esc(focus.name)}</strong>
      <span class="bst-k">${esc(placeKindMeta(focus.kind)?.label || focus.kind)}${focus.kind === 'building' && focus.category ? ` · ${esc(categoryLabel(focus.category))}` : ''}${listingBit ? ` · ${esc(listingBit.includes('|') ? listingBit.split('|').slice(1).join('|').trim() : listingBit)}` : ''}</span>
      ${canPopulateFocus ? `
        <select class="bst-input bst-set-kind-sel" data-role="stage-head-category" data-place="${esc(focus.id)}" title="Building category">
          ${renderCategorySelectOptions(focus.category || '', esc, { hostKind: 'building', hostName: focus.name })}
        </select>
        <button type="button" class="bst-btn" data-action="compass-populate-category" data-place="${esc(focus.id)}" title="Fill this building with rooms for the chosen category">Populate</button>
      ` : ''}
      ${isCompassPlaceKind(focus.kind)
        ? `<button type="button" class="bst-btn gold" data-action="compass-load" data-room="${esc(focus.id)}">${isExteriorHostKind(focus.kind) ? 'Load exterior' : 'Load'}</button>`
        : (isScenePlaceKind(focus.kind)
          ? `<button type="button" class="bst-btn gold" data-action="set-here" data-place="${esc(focus.id)}" data-cell="C" title="Pin the scene here — outside nested buildings">We're here</button>`
          : '')}
    </div>` : '';

  const inspectChild = suiteFromChild && suiteHighlightChild
    ? getPlace(compass, suiteHighlightChild)
    : null;
  const inspectOk = !!(inspectChild && isLoadableKind(inspectChild.kind));
  const nestHtml = showNest
    ? `<section class="bst-section" id="bst-suite-plan">
        <h3 class="bst-section-h">${suiteHost.kind === 'building' ? 'Building plan' : 'Suite plan'} · ${esc(suiteHost.name)}</h3>
        ${renderSuiteFloorplan(suiteHost, compass, {
          mode: suiteModeSafe,
          esc,
          focusChildId: suiteHighlightChild || '',
          selectedShared,
          selectedEdge,
          suiteSelEdges,
          fixtureAct: suiteFixtureActSafe,
          herePlaceId: herePlaceId || compass.activeRoomId || '',
          hereCell: hereCell || cell,
          lastOpening,
          storyFocus: storyFocusSafe,
          lockCast,
        })}
      </section>`
    : '';
  const childInspectHtml = inspectOk
    ? renderSetLayout({
      compass,
      editing: inspectChild,
      cell,
      peeks: gatherPeerViews(compass, inspectChild),
      selectedEdges,
      drawWallMode,
      fpMode,
      fixtureAct,
      wallLinksOpen,
      herePlaceId: herePlaceId || compass.activeRoomId || '',
      hereCell: hereCell || cell,
      lockCast,
      inspectChild: true,
      esc,
    })
    : '';
  const rightPane = showNest
    ? `${nestHtml}${childInspectHtml}`
    : showFloor
      ? (focusIsExterior && !emptyExterior
        ? renderBuildingExterior({
          compass,
          building: focus,
          cell,
          esc,
          herePlaceId: herePlaceId || compass.activeRoomId || '',
          hereCell: hereCell || cell,
        })
        : `<div id="bst-room-layout">${renderSetLayout({
          compass,
          editing,
          cell,
          peeks,
          selectedEdges,
          drawWallMode,
          fpMode,
          fixtureAct,
          wallLinksOpen,
          herePlaceId: herePlaceId || compass.activeRoomId || '',
          hereCell: hereCell || cell,
          lockCast,
          esc,
        })}</div>`)
      : showTags
        ? renderFocusMeta(focus, compass, esc, true)
        : `<section class="bst-section"><div class="bst-empty">Pick a Compass place, or a Script / Library location tag.</div></section>`;

  return `
    <div class="bst-pane--set">
      <div class="bst-set-head">
        <h2 class="bst-pane-title">Set</h2>
        <p class="bst-pane-sub">File places as country → city → area → building. Edit a row to rename, change kind, or add aliases sonar can hear.</p>
      </div>
      ${renderSonarStrip(sonarStatus, sonarNote, esc, { compass, castMembers: sonarCast, sonarFilter, sonarView, sonarOpen })}
      ${renderSuiteDraftStrip(suiteDraft || compass?.suiteDraft, esc)}
      ${renderSetPlaceIndex(compass, { storage, focusId: focus?.id || '', createOpen, esc, placesFold, placesFoldAuto, placesEditId, placesOpen: placesOpen !== false, createDraft })}
      <div class="bst-set-stage">
        ${stageHead}
        ${focus ? renderNarrativePopulateFold(compass, focus, { cell, esc }) : ''}
        ${rightPane}
      </div>
    </div>
  `;
}

/**
 * Placement door — dress areas; list / edit / move / delete; area visibility preview.
 */
export function buildPlacementHtml({
  compass,
  active,
  focusId = '',
  selCell = 'C',
  povPreview = '',
  povFacing = 'N',
  sonarNote = '',
  sonarStatus = null,
  sonarReach = 'adjacent',
  sonarCast = [],
  sonarFilter = '',
  sonarView = 'all',
  esc,
}) {
  const focus = getPlace(compass, focusId) || active || null;
  const editing = focus && isCompassPlaceKind(focus.kind) ? focus : (active && isCompassPlaceKind(active.kind) ? active : null);
  const cell = selCell || 'C';
  const access = editing ? accessibleAreas(cell, editing, { reach: sonarReach }) : [cell];
  const pings = editing ? listSonarPingsInPlace(compass, editing.id) : [];
  const lost = Array.isArray(compass?.lostAndFound) ? compass.lostAndFound : [];

  const placeOpts = renderCompassPlaceOptions(compass, {
    esc,
    selectedId: editing?.id || '',
    emptyLabel: '— Room / hall / exterior —',
  });

  const lostRows = lost.length
    ? lost.map(it => `
        <div class="bst-lost-row">
          <span class="bst-lost-name">${esc(it.name || '(unnamed)')}</span>
          <span class="bst-k">${esc(it._lostLayer || 'clutter')}</span>
          ${editing ? `<button type="button" class="bst-btn" data-action="lost-place" data-id="${esc(it.id)}" data-place="${esc(editing.id)}" data-cell="${esc(cell)}" data-layer="${esc(it._lostLayer || 'clutter')}" title="Place in area ${esc(cell)}">Place in ${esc(cell)}</button>` : ''}
          <button type="button" class="bst-btn danger" data-action="lost-destroy" data-id="${esc(it.id)}" title="Destroy permanently">✕</button>
        </div>`).join('')
    : '<div class="bst-empty">Nothing in Lost &amp; Found.</div>';

  return `
    <h2 class="bst-pane-title">Placement</h2>
    <p class="bst-pane-sub">Dress areas, move pieces, and preview what is visible from a standing area (here + adjacent unless walled off).</p>
    ${renderSonarStrip(sonarStatus, sonarNote, esc, { compass, castMembers: sonarCast, sonarFilter, sonarView, sonarOpen: false })}

    <section class="bst-section">
      <h3 class="bst-section-h">Place</h3>
      <div class="bst-row">
        <select class="bst-input" data-role="placement-place" style="flex:1">${placeOpts}</select>
        <button type="button" class="bst-btn" data-action="placement-focus">Open</button>
        ${editing ? `<button type="button" class="bst-btn gold" data-action="compass-load" data-room="${esc(editing.id)}">Load on compass</button>` : ''}
      </div>
    </section>

    ${editing ? renderNarrativePopulateFold(compass, editing, { cell, esc }) : ''}

    <details class="bst-lost-fold"${lost.length ? ' open' : ''}>
      <summary class="bst-section-h">Lost &amp; Found <span class="bst-k">(${lost.length})</span></summary>
      <p class="bst-hint">Pieces that aren’t on the stage, in cast props, or in the player inventory. Removing a placed piece sends it here.</p>
      <div class="bst-lost-list">${lostRows}</div>
      <div class="bst-row" style="margin-top:8px">
        <button type="button" class="bst-btn" data-action="lost-add">＋ Add unplaced item…</button>
      </div>
    </details>

    ${editing ? `
    <section class="bst-section">
      <h3 class="bst-section-h">Areas · ${esc(editing.name)}${isExteriorHostKind(editing.kind) ? ' · exterior' : ''}</h3>
      <p class="bst-hint">Select an area to list its pieces. Visible reach from here: <strong>${esc(access.map(id => cellDisplayLabel(editing.kind, id)).join(', '))}</strong></p>
      <div class="bst-compass-stage bst-compass-stage--placement">
        <div class="bst-compass-side">
          <div class="bst-k">Compass areas</div>
          <div class="bst-compass-grid" role="grid" aria-label="Room areas">
            ${CELL_ROWS.map(row => row.map(id => {
              const { n, nOcc, nDoor } = cellSummaryBits(editing, id);
              const inReach = access.includes(id);
              const bits = [
                nOcc ? `${nOcc}p` : '',
                n ? `${n}` : '',
                nDoor ? '⇢' : '',
              ].filter(Boolean).join(' ');
              return `<button type="button" class="bst-compass-cell${id === cell ? ' on' : ''}${inReach && id !== cell ? ' reach' : ''}" data-action="compass-select-area" data-cell="${id}" data-place="${esc(editing.id)}" title="${esc(cellDisplayLabel(editing.kind, id))}">
                <span class="bst-compass-cell-id">${id}</span>
                ${isExteriorHostKind(editing.kind) ? `<span class="bst-compass-cell-face">${esc(cellDisplayLabel(editing.kind, id))}</span>` : ''}
                <span class="bst-k">${esc(bits || 'empty')}</span>
              </button>`;
            }).join('')).join('')}
          </div>
          ${pings.length
            ? `<div class="bst-hint bst-sonar-pings">Sonar pings: ${pings.map(p => `${esc(p.name)}@${esc(p.cell)}`).join(' · ')}</div>`
            : ''}
        </div>
        <div class="bst-placement-list">
          ${renderAreaItemList(editing, cell, {
            placeId: editing.id,
            editable: true,
            compass,
            esc,
          })}
          <div class="bst-row" style="margin-top:8px">
            <button type="button" class="bst-btn" data-action="compass-edit-cell" data-cell="${esc(cell)}" data-place="${esc(editing.id)}">+ Add in ${esc(cell)}…</button>
          </div>
        </div>
      </div>
    </section>

    <section class="bst-section">
      <h3 class="bst-section-h">Area visibility</h3>
      <p class="bst-hint">What the Room Compass injects from standing in the selected area (no character pick — sonar tracks cast separately).</p>
      <div class="bst-row">
        <label>Facing <select class="bst-input" data-role="pov-facing">
          ${FACINGS.map(f =>
            `<option value="${f}"${f === povFacing ? ' selected' : ''}>${f}</option>`).join('')}
        </select></label>
        <button type="button" class="bst-btn gold" data-action="placement-pov" data-place="${esc(editing.id)}">Preview from ${esc(cell)}</button>
      </div>
      ${povPreview
        ? `<pre class="bst-pov-preview">${esc(povPreview)}</pre>`
        : '<div class="bst-empty">Hit Preview to see visible / reachable pieces from this area.</div>'}
    </section>
    ` : '<section class="bst-section"><div class="bst-empty">Open a room, hall, or building exterior to dress areas.</div></section>'}
  `;
}

function sonarRowVisible(m, ping, filter, view) {
  const name = String(m.name || '').toLowerCase();
  const q = String(filter || '').trim().toLowerCase();
  if (q && !name.includes(q)) return false;
  const presence = (m.presence === 'privy' || ping?.listening)
    ? 'privy'
    : (m.presence === 'absent' ? 'absent' : 'inPlay');
  if (view === 'inPlay' && presence !== 'inPlay') return false;
  if (view === 'privy' && presence !== 'privy') return false;
  if (view === 'absent' && presence !== 'absent') return false;
  if (view === 'parked' && !ping.locked) return false;
  return true;
}

function renderSonarStrip(status, sonarNote, esc, {
  compass = null,
  castMembers = [],
  sonarFilter = '',
  sonarView = 'all',
  sonarOpen = false,
} = {}) {
  if (!status && !sonarNote && !castMembers.length) return '';
  const notes = Array.isArray(status?.notes) ? status.notes : [];
  const key = status?.key || sonarNote || '';
  const place = status?.placeName || '';
  const head = key
    ? `Sonar · last key: <strong>${esc(key)}</strong>${place ? ` → ${esc(place)}` : ''}`
    : 'Sonar · no location key in the latest message';
  const body = notes.length
    ? `<ul class="bst-sonar-notes">${notes.map(n =>
      `<li data-sev="${esc(n.severity || 'info')}">${esc(n.text)}</li>`).join('')}</ul>`
    : '';
  const exclude = new Set((compass?.sonar?.excludeIds || []).map(String));
  const pings = compass?.sonar?.pings || {};
  const view = ['inPlay', 'privy', 'absent', 'parked'].includes(sonarView) ? sonarView : 'all';
  const roster = (castMembers || []).map(m => {
    const id = String(m.id || m.name || '');
    const ping = pings[id] || Object.values(pings).find(p => String(p?.name).toLowerCase() === String(m.name || '').toLowerCase()) || {};
    const on = !exclude.has(id);
    const isPrivy = m.presence === 'privy' || !!ping.listening;
    const presence = isPrivy ? 'privy' : (m.presence === 'absent' ? 'absent' : 'inPlay');
    const parked = !!ping.locked;
    const hidden = sonarRowVisible(m, ping, sonarFilter, view) ? '' : ' hidden';
    const follow = (parked || ping.away || isPrivy) && presence !== 'absent'
      ? `<button type="button" class="bst-btn" data-action="sonar-follow" data-cast="${esc(id)}" title="Bring back into room / let sonar track them normally">Follow</button>`
      : '';
    const badgeHtml = presence === 'absent'
      ? '<span class="bst-sonar-badge">Absent</span>'
      : isPrivy
        ? `<span class="bst-sonar-badge" title="Listening in remotely — not physically in the room">${esc(ping.listeningVia ? `Privy · ${ping.listeningVia}` : 'Privy')}${ping.awayLabel ? ` (${esc(ping.awayLabel)})` : ''}</span>`
        : ping.away
          ? `<span class="bst-sonar-badge" title="Stepped outside / away from the active room">${esc(ping.awayLabel ? `Outside · ${ping.awayLabel}` : 'Outside')}</span>`
          : '';
    return `<div class="bst-sonar-cast" data-cast="${esc(id)}" data-name="${esc(m.name)}" data-presence="${esc(presence)}" data-parked="${parked ? '1' : '0'}"${hidden}>
      <label class="bst-check"><input type="checkbox" data-role="sonar-include" data-cast="${esc(id)}" ${on ? 'checked' : ''}> ${esc(m.name)}</label>
      ${badgeHtml}
      <select class="bst-input" data-role="sonar-place" data-cast="${esc(id)}" ${on ? '' : 'disabled'} title="Park this cast member">
        ${renderCompassPlaceOptions(compass, { esc, selectedId: ping.placeId || '', emptyLabel: '— Room —' })}
      </select>
      <select class="bst-input" data-role="sonar-cell" data-cast="${esc(id)}" ${on ? '' : 'disabled'}>
        ${CELLS.map(c => `<option value="${c}" ${(ping.cell || 'C') === c ? 'selected' : ''}>${c}</option>`).join('')}
      </select>
      <button type="button" class="bst-btn${isPrivy ? ' gold' : ''}" data-action="sonar-privy" data-cast="${esc(id)}" ${on ? '' : 'disabled'} title="Toggle Privy (listening in remotely without physical presence in the room)">${isPrivy ? 'Privy' : 'Listen in'}</button>
      <button type="button" class="bst-btn${parked ? ' gold' : ''}" data-action="sonar-pin" data-cast="${esc(id)}" ${on ? '' : 'disabled'} title="${parked ? 'Parked — sonar will not move them' : 'Park here so sonar leaves them alone'}">${parked ? 'Parked' : 'Park'}</button>
      ${follow}
    </div>`;
  }).join('');
  const chip = (id, label) =>
    `<button type="button" class="bst-btn${view === id ? ' gold' : ''}" data-action="sonar-view" data-view="${id}">${label}</button>`;
  return `
    <details class="bst-sonar-fold bst-fold" data-fold="set-sonar"${sonarOpen ? ' open' : ''}>
      <summary class="bst-sonar-sum">
        <span class="bst-hint" style="margin:0">${head}</span>
        <button type="button" class="bst-btn" data-action="set-sonar-check">Check sonar</button>
      </summary>
      <div class="bst-sonar-body">
        ${body}
        ${roster ? `<div class="bst-sonar-roster">
          <div class="bst-sonar-tools">
            <input class="bst-input" data-role="sonar-filter" type="search" placeholder="Filter cast…" value="${esc(sonarFilter || '')}">
            <div class="bst-sonar-chips">
              ${chip('all', 'All')}
              ${chip('inPlay', 'In play')}
              ${chip('privy', 'Privy')}
              ${chip('absent', 'Absent')}
              ${chip('parked', 'Parked')}
            </div>
            <div class="bst-sonar-bulk">
              <button type="button" class="bst-btn" data-action="sonar-bulk" data-bulk="include">Include</button>
              <button type="button" class="bst-btn" data-action="sonar-bulk" data-bulk="exclude">Exclude</button>
              <button type="button" class="bst-btn" data-action="sonar-bulk" data-bulk="park">Park</button>
              <button type="button" class="bst-btn" data-action="sonar-bulk" data-bulk="follow">Follow</button>
              <select class="bst-input" data-role="sonar-bulk-place" title="Room for bulk apply">
                ${renderCompassPlaceOptions(compass, { esc, emptyLabel: '— Room —' })}
              </select>
              <select class="bst-input" data-role="sonar-bulk-cell" title="Area for bulk apply">
                ${CELLS.map(c => `<option value="${c}"${c === 'C' ? ' selected' : ''}>${c}</option>`).join('')}
              </select>
              <button type="button" class="bst-btn gold" data-action="sonar-bulk" data-bulk="place">Apply to visible</button>
            </div>
          </div>
          <div class="bst-k">Cast pings — filter the list, then bulk-apply to visible rows. Uncheck to exclude.</div>
          <div class="bst-sonar-list">${roster}</div>
        </div>` : ''}
      </div>
    </details>`;
}

function renderPlaceCrumb(compass, place, esc) {
  if (!place?.id) return '';
  const chain = [];
  let cur = place;
  const seen = new Set();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    chain.unshift(cur);
    cur = compass?.rooms?.[cur.parentId];
  }
  const kinds = new Set([...GEO_PLACE_KIND_SET, 'unit', 'room', 'transitional']);
  let slice = chain.filter(p => kinds.has(p.kind));
  if (!slice.length) slice = chain.slice(-3);
  if (slice.length < 2) return '';
  return `<div class="bst-crumb-row">${slice.map((p, i) => {
    const last = i === slice.length - 1;
    if (last) return `<span class="bst-crumb on">${esc(p.name)}</span>`;
    const next = slice[i + 1];
    return `<button type="button" class="bst-crumb" data-action="compass-view-parent" data-parent="${esc(p.id)}" data-place="${esc(next?.id || place.id)}">${esc(p.name)}</button>`;
  }).join('<span class="bst-crumb-sep">›</span>')}</div>`;
}

/** @deprecated use buildSetHtml */
export function buildStageHtml(opts) {
  return buildSetHtml(opts);
}

function placesByParent(compass) {
  const map = new Map();
  for (const p of Object.values(compass?.rooms || {})) {
    const pid = p.parentId || '';
    if (!map.has(pid)) map.set(pid, []);
    map.get(pid).push(p);
  }
  for (const arr of map.values()) {
    arr.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  }
  return map;
}

function descendantIdSet(byParent, rootId) {
  const out = new Set([rootId]);
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop();
    for (const c of byParent.get(id) || []) {
      if (out.has(c.id)) continue;
      out.add(c.id);
      stack.push(c.id);
    }
  }
  return out;
}

function geoCaption(compass, place) {
  const names = [];
  let pid = place?.parentId || '';
  const seen = new Set();
  while (pid && !seen.has(pid)) {
    seen.add(pid);
    const p = compass?.rooms?.[pid];
    if (!p) break;
    if (p.kind === 'region' || p.kind === 'settlement' || p.kind === 'district') {
      names.unshift(p.name);
    }
    pid = p.parentId || '';
  }
  return names.join(' · ');
}

function suiteHostPlace(compass, place) {
  let cur = place;
  const seen = new Set();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    if (isSuiteHostKind(cur.kind)) return cur;
    cur = compass?.rooms?.[cur.parentId];
  }
  return null;
}

function placePickerGroupLabel(compass, host) {
  if (!host) return 'Ungrouped';
  if (host.kind === 'unit') {
    const bldg = compass?.rooms?.[host.parentId];
    const head = bldg?.kind === 'building' && bldg.name
      ? `${bldg.name} · ${host.name}`
      : (host.name || 'Unit');
    return head;
  }
  const geo = geoCaption(compass, host);
  const name = String(host.name || 'Building').trim() || 'Building';
  return geo ? `${name} · ${geo}` : name;
}

function placePickerLeafLabel(place, hostTitle) {
  const name = String(place?.name || '').trim() || '(unnamed)';
  if (isExteriorHostKind(place?.kind)) return `${name} (exterior)`;
  const hostName = String(hostTitle || '').trim();
  if (hostName && hostName.toLowerCase() !== name.toLowerCase()) return `${hostName} (${name})`;
  return name;
}

function geoPickerLeafLabel(place) {
  const name = String(place?.name || '').trim() || '(unnamed)';
  const meta = placeKindMeta(place?.kind)?.label || place?.kind || '';
  return meta ? `${name} (${meta})` : name;
}

function outdoorLeaveButton(compass, fromPlace, esc) {
  const outdoor = enclosingOutdoorPlace(compass, fromPlace);
  if (!outdoor?.id) return '';
  return `<button type="button" class="bst-btn" data-action="set-here" data-place="${esc(outdoor.id)}" data-cell="C" title="Pin the scene outside this building, in ${esc(outdoor.name)}">Leave to ${esc(outdoor.name)}</button>`;
}

function nestPathLabel(compass, place) {
  const meta = placeKindMeta(place?.kind)?.label || place?.kind || '';
  const chain = [];
  let cur = compass?.rooms?.[place?.parentId];
  const seen = new Set();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    if (cur.name) chain.unshift(cur.name);
    cur = compass?.rooms?.[cur.parentId];
  }
  const name = String(place?.name || '').trim() || '(unnamed)';
  const path = chain.join(' · ');
  if (meta && path) return `${name} (${meta} · ${path})`;
  if (meta) return `${name} (${meta})`;
  return path ? `${name} · ${path}` : name;
}

/** Compass rooms/halls/exteriors grouped by building or unit for native <select>s. */
export function renderCompassPlaceOptions(compass, {
  esc,
  selectedId = '',
  emptyLabel = '— Room —',
  includeGeoParents = false,
} = {}) {
  const tree = buildPlaceTree(compass).filter(({ place }) => {
    if (!place) return false;
    if (isCompassPlaceKind(place.kind)) return true;
    return includeGeoParents && isScenePlaceKind(place.kind);
  });
  const groups = [];
  const index = new Map();
  const ensureGroup = (key, label) => {
    let g = index.get(key);
    if (!g) {
      g = { label, places: [] };
      index.set(key, g);
      groups.push(g);
    }
    return g;
  };
  for (const { place } of tree) {
    if (includeGeoParents && isScenePlaceKind(place.kind) && !isCompassPlaceKind(place.kind)) {
      const parent = compass?.rooms?.[place.parentId];
      const g = ensureGroup(parent?.id ? `geo:${parent.id}` : 'geo:_root', parent?.name || 'Outdoors');
      g.places.push({ place, hostTitle: '', geo: true });
      continue;
    }
    const host = suiteHostPlace(compass, place);
    const key = host?.id || '_ungrouped';
    const hostTitle = host?.kind === 'unit' ? placePickerGroupLabel(compass, host) : String(host?.name || '').trim();
    ensureGroup(key, host ? placePickerGroupLabel(compass, host) : 'Ungrouped')
      .places.push({ place, hostTitle, geo: false });
  }
  const empty = `<option value="">${esc(emptyLabel)}</option>`;
  if (!groups.length) return empty;
  const body = groups.map((g) => {
    const opts = g.places.map(({ place, hostTitle, geo }) =>
      `<option value="${esc(place.id)}"${place.id === selectedId ? ' selected' : ''}>${esc(geo ? geoPickerLeafLabel(place) : placePickerLeafLabel(place, hostTitle))}</option>`).join('');
    return `<optgroup label="${esc(g.label)}">${opts}</optgroup>`;
  }).join('');
  return `${empty}${body}`;
}

export function smokeCompassPlaceOptionsPure() {
  try {
    const esc = (s) => String(s ?? '');
    const compass = {
      rooms: {
        jp: { id: 'jp', name: 'Japan', kind: 'region', parentId: '' },
        fk: { id: 'fk', name: 'Fukuoka', kind: 'settlement', parentId: 'jp' },
        mall: { id: 'mall', name: 'Canal City Mall', kind: 'district', parentId: 'fk' },
        shop: { id: 'shop', name: 'Okisato Antiques', kind: 'building', parentId: 'mall' },
        rm: { id: 'rm', name: 'Shop Floor', kind: 'room', parentId: 'shop' },
      },
    };
    const scene = renderCompassPlaceOptions(compass, { esc, includeGeoParents: true, emptyLabel: '—' });
    if (!scene.includes('value="mall"')) return 'scene picker should list the neighborhood';
    if (!scene.includes('value="fk"')) return 'scene picker should list the city';
    const rooms = renderCompassPlaceOptions(compass, { esc, includeGeoParents: false, emptyLabel: '—' });
    if (/\bvalue="mall"/.test(rooms)) return 'cast park picker should stay room/exterior only';
    if (!rooms.includes('value="shop"') || !rooms.includes('value="rm"')) return 'room picker should keep building exterior and rooms';
    const dup = {
      rooms: {
        upper: { id: 'upper', name: 'Upper Unit', kind: 'unit', parentId: '' },
        shop2: { id: 'shop2', name: 'Okisato Antiques', kind: 'unit', parentId: '' },
        b1: { id: 'b1', name: 'Bathroom', kind: 'room', parentId: 'upper' },
        b2: { id: 'b2', name: 'Bathroom', kind: 'room', parentId: 'shop2' },
      },
    };
    if (findPlaceByExactName(dup, 'Bathroom')) return 'ambiguous bathroom should not collapse to one place';
    if (findPlaceByExactName(dup, 'Bathroom', { parentId: 'shop2' })?.id !== 'b2') return 'shop bathroom lookup missed';
    if (findPlaceByExactName(dup, 'Bathroom', { parentId: 'upper' })?.id !== 'b1') return 'upper bathroom lookup missed';

    const split = {
      rooms: {
        mall: { id: 'mall', name: 'Canal City Mall', kind: 'building', parentId: '' },
        shop: { id: 'shop', name: 'Okisato Antiques', kind: 'unit', parentId: 'mall' },
        promMall: { id: 'promMall', name: '2F Promenade', kind: 'transitional', parentId: 'mall' },
        promShop: { id: 'promShop', name: '2F Promenade', kind: 'transitional', parentId: 'shop' },
        svc: { id: 'svc', name: 'Service Corridor', kind: 'transitional', parentId: 'mall' },
      },
    };
    const storage = {
      getChat() {
        return {
          locations: {
            nodes: {
              mall: { id: 'catMall', name: 'Canal City Mall', kind: 'building', parentId: '', placeId: 'mall' },
              shop: { id: 'catShop', name: 'Okisato Antiques', kind: 'unit', parentId: 'catMall', placeId: 'shop' },
              stale: { id: 'catProm', name: '2F Promenade', kind: 'transitional', parentId: 'catShop', placeId: 'promMall' },
            },
          },
        };
      },
    };
    const tree = collectSetPlaceTree(split, storage);
    const flat = [];
    const walk = (nodes) => {
      for (const n of nodes || []) {
        if (!n) continue;
        flat.push(n);
        walk(n.children);
      }
    };
    walk(tree.roots);
    walk(tree.unfiled);
    const proms = flat.filter(n => n.name === '2F Promenade');
    if (proms.length !== 2) return `2F Promenade should list once per building, got ${proms.length}`;
    if (new Set(proms.map(n => n.placeId)).size !== 2) return 'the two promenades collapsed to one place';
    const shopRow = flat.find(n => n.placeId === 'shop');
    if ((shopRow?.children || []).some(c => c.placeId === 'promMall' || c.placeId === 'svc')) {
      return 'mall halls should not render inside Okisato Antiques';
    }
    const mallRow = flat.find(n => n.placeId === 'mall');
    const mallKids = new Set((mallRow?.children || []).flatMap(c => [c.placeId, ...(c.children || []).map(k => k.placeId)]));
    if (!mallKids.has('promMall') || !mallKids.has('svc')) return 'mall halls should render under Canal City Mall';
    if ((shopRow?.children || []).some(c => c.placeId !== 'promShop' && c.name === '2F Promenade')) {
      return 'only the shop promenade belongs under Okisato';
    }
    return '';
  } catch (err) {
    return err?.message || String(err);
  }
}

function renderPlaceChip(place, { activeId, focusId, esc, extra = '' }) {
  const on = place.id === activeId;
  const focused = place.id === focusId;
  const meta = placeKindMeta(place.kind);
  const loadable = isCompassPlaceKind(place.kind);
  const loadLabel = isExteriorHostKind(place.kind)
    ? (on ? 'Loaded' : 'Load exterior')
    : (on ? 'Loaded' : 'Load');
  const sceneable = !loadable && isScenePlaceKind(place.kind);
  const code = (place.kind === 'room' || place.kind === 'transitional') ? resolveListingCode(place) : '';
  return `<span class="bst-compass-tree-row${focused ? ' focus' : ''}">
    <button type="button" class="bst-chip${on ? ' on' : ''}${focused ? ' focus' : ''}" data-action="compass-focus" data-place="${esc(place.id)}" title="${esc(place.id)}">
      ${on ? '● ' : ''}${esc(place.name)}
      <span class="bst-k">${esc(meta?.label || place.kind)}${code ? ` · ${esc(code)}` : ''}${place.exposed ? ' · exposed' : ''}${isExteriorHostKind(place.kind) ? ' · exterior' : ''}</span>
    </button>
    ${loadable
      ? `<button type="button" class="bst-btn" data-action="compass-load" data-room="${esc(place.id)}">${loadLabel}</button>`
      : (sceneable
        ? `<button type="button" class="bst-btn" data-action="set-here" data-place="${esc(place.id)}" data-cell="C" title="Pin the scene here">We're here</button>`
        : '')}
    ${extra}
  </span>`;
}

function renderUnitDrawer(unit, { compass, byParent, activeId, focusId, esc }) {
  const kids = byParent.get(unit.id) || [];
  const inFocus = descendantIdSet(byParent, unit.id).has(focusId);
  const listing = suiteListingLine(unit, kids, compass);
  return `<details class="bst-place-drawer bst-place-drawer--unit" data-kind="unit" data-place="${esc(unit.id)}" ${inFocus ? 'open' : ''}>
    <summary class="bst-place-drawer-sum">${renderPlaceChip(unit, {
      activeId,
      focusId,
      esc,
      extra: listing ? `<span class="bst-place-drawer-geo">${esc(listing)}</span>` : '',
    })}</summary>
    <div class="bst-place-drawer-body">
      ${kids.length
        ? kids.map(k => (k.kind === 'unit'
          ? renderUnitDrawer(k, { compass, byParent, activeId, focusId, esc })
          : renderPlaceChip(k, { activeId, focusId, esc }))).join('')
        : '<div class="bst-empty">No rooms in this unit.</div>'}
    </div>
  </details>`;
}

function renderBuildingDrawer(building, { compass, byParent, activeId, focusId, esc }) {
  const kids = byParent.get(building.id) || [];
  const units = kids.filter(k => k.kind === 'unit');
  const nestedBuildings = kids.filter(k => k.kind === 'building');
  const rest = kids.filter(k => k.kind !== 'unit' && k.kind !== 'building');
  const inFocus = descendantIdSet(byParent, building.id).has(focusId);
  const geo = geoCaption(compass, building);
  const listing = suiteListingLine(building, kids, compass);
  return `<details class="bst-place-drawer bst-place-drawer--building" data-kind="building" data-place="${esc(building.id)}" ${inFocus ? 'open' : ''}>
    <summary class="bst-place-drawer-sum">
      ${renderPlaceChip(building, {
        activeId,
        focusId,
        esc,
        extra: [geo, listing].filter(Boolean).map(s => `<span class="bst-place-drawer-geo">${esc(s)}</span>`).join(''),
      })}
    </summary>
    <div class="bst-place-drawer-body">
      ${nestedBuildings.map(b => renderBuildingDrawer(b, { compass, byParent, activeId, focusId, esc })).join('')}
      ${units.map(u => renderUnitDrawer(u, { compass, byParent, activeId, focusId, esc })).join('')}
      ${rest.map(p => renderPlaceChip(p, { activeId, focusId, esc })).join('')}
      ${!kids.length ? '<div class="bst-empty">Empty building — add rooms for a house/shed plan, or units for apartments.</div>' : ''}
    </div>
  </details>`;
}

function renderPlaceDrawers(compass, { focusId, activeId, esc }) {
  const rooms = Object.values(compass?.rooms || {});
  const byParent = placesByParent(compass);
  const topBuildings = rooms
    .filter(p => p.kind === 'building' && compass.rooms[p.parentId]?.kind !== 'building')
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  const nested = new Set();
  for (const b of topBuildings) {
    for (const id of descendantIdSet(byParent, b.id)) nested.add(id);
  }
  const loose = rooms
    .filter(p => !nested.has(p.id))
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  const looseOpen = !topBuildings.length || loose.some(p => p.id === focusId);
  const looseHtml = loose.length
    ? `<details class="bst-place-drawer bst-place-drawer--loose" data-kind="loose" ${looseOpen ? 'open' : ''}>
        <summary class="bst-place-drawer-sum">Other places <span class="bst-k">${loose.length}</span></summary>
        <div class="bst-place-drawer-body">
          ${loose.map(p => (p.kind === 'unit'
            ? renderUnitDrawer(p, { compass, byParent, activeId, focusId, esc })
            : renderPlaceChip(p, { activeId, focusId, esc }))).join('')}
        </div>
      </details>`
    : '';
  return `<div class="bst-compass-tree bst-compass-tree--drawers">
    ${topBuildings.map(b => renderBuildingDrawer(b, { compass, byParent, activeId, focusId, esc })).join('')}
    ${looseHtml}
  </div>`;
}

function renderBuildingExterior({ compass, building, cell, esc, herePlaceId, hereCell }) {
  const hereOn = herePlaceId === building.id;
  const hereLabel = hereOn
    ? `Here · ${building.name} exterior${hereCell ? ` · ${cellDisplayLabel(building.kind, hereCell)}` : ''}`
    : `We're here · ${building.name} exterior${cell ? ` · ${cellDisplayLabel(building.kind, cell)}` : ''}`;
  return `
    <section class="bst-section" id="bst-building-exterior">
      <h3 class="bst-section-h">Exterior · ${esc(building.name)}</h3>
      <div class="bst-row" style="align-items:center;gap:8px;margin:0 0 8px">
        <button type="button" class="bst-btn gold" data-action="set-here" data-place="${esc(building.id)}" data-cell="${esc(cell)}" title="Pin the scene to this building's exterior face or yard">We're here</button>
        ${outdoorLeaveButton(compass, building, esc)}
        ${hereOn ? `<span class="bst-chip on">${esc(hereLabel)}</span>` : `<span class="bst-k">Pin an exterior face or yard as the current location</span>`}
        <button type="button" class="bst-btn" data-action="compass-load" data-room="${esc(building.id)}">Load exterior</button>
      </div>
      <p class="bst-hint">North, east, south, and west faces (plus corner yards) hold fixtures and objects the same way a room's interior areas do. <strong>C</strong> is at the building itself.</p>
      <div class="bst-compass-stage bst-compass-stage--side">
        <div class="bst-compass-side">
          <div class="bst-k">Exterior compass</div>
          <div class="bst-compass-grid bst-compass-grid-sm bst-compass-grid-exterior" role="grid" aria-label="Building exterior faces">
            ${CELL_ROWS.map(row => row.map(id => {
              const { n, nOcc, nDoor } = cellSummaryBits(building, id);
              const bits = [
                nOcc ? `${nOcc}p` : '',
                n ? `${n}` : '',
                nDoor ? '⇢' : '',
              ].filter(Boolean).join(' ');
              const face = cellDisplayLabel(building.kind, id);
              return `<button type="button" class="bst-compass-cell${id === cell ? ' on' : ''}" data-action="compass-select-area" data-cell="${id}" data-place="${esc(building.id)}" title="${esc(face)}">
                <span class="bst-compass-cell-id">${id}</span>
                <span class="bst-compass-cell-face">${esc(face)}</span>
                <span class="bst-k">${esc(bits)}</span>
              </button>`;
            }).join('')).join('')}
          </div>
          ${renderAreaItemList(building, cell, { placeId: building.id, editable: true, compass, esc })}
          <div class="bst-hint" style="margin-top:4px">Select an item to sort layer, area, surface, or room.</div>
        </div>
      </div>
    </section>`;
}

function collectRoomSurfaces(room) {
  const seen = new Set();
  const out = [];
  for (const bag of Object.values(room?.cells || {})) {
    for (const f of bag?.furniture || []) {
      const name = String(f?.name || '').trim();
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      out.push({ id: f.id, name, kind: 'furniture' });
    }
    for (const c of bag?.clutter || []) {
      if (c?.kind !== 'container') continue;
      const name = String(c?.name || '').trim();
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      out.push({ id: c.id, name, kind: 'container' });
    }
  }
  return out;
}

function collectOtherCompassRooms(compass, room) {
  if (!compass?.rooms || !room) return [];
  const parentId = room.parentId || '';
  const all = Object.values(compass.rooms).filter(p =>
    p && p.id !== room.id && isCompassPlaceKind(p.kind));
  const siblings = all.filter(p => (p.parentId || '') === parentId && parentId)
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  const others = all.filter(p => !siblings.includes(p))
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  return [...siblings, ...others];
}

/**
 * Compact horizontal strip of pieces in an area.
 * Description / actions appear in the detail panel when an item is selected.
 * @param {{ placeId: string, editable?: boolean, compass?: object, esc: Function }} opts
 */
export function renderAreaItemList(room, cellId, { placeId, editable = false, compass = null, esc }) {
  const pieces = listAreaContents(room, cellId);
  const areaLabel = cellDisplayLabel(room?.kind, cellId);
  const areaOpts = CELLS.map(c => `<option value="${c}">${esc(cellDisplayLabel(room?.kind, c))}</option>`).join('');
  const surfaces = collectRoomSurfaces(room);
  const otherRooms = collectOtherCompassRooms(compass, room);
  return `
    <div class="bst-area-list" data-role="area-list" data-cell="${esc(cellId)}" data-place="${esc(placeId)}">
      <div class="bst-k">In ${esc(areaLabel)} · ${pieces.length} item${pieces.length === 1 ? '' : 's'}</div>
      <ul class="bst-area-list-scroll" role="listbox" aria-label="Area contents">
        ${pieces.length
          ? pieces.map(it => {
            const tags = [it.layer];
            if (it.cells?.length > 1) tags.push(it.cells.join('+'));
            if (it.occupiable) tags.push(`sit×${it.maxOccupancy || 1}`);
            if (it.contains) tags.push(it.contentsVisible === 'inside' ? 'inside' : 'display');
            if (it.surface) tags.push(`on ${it.surface}`);
            return `<li class="bst-area-list-item" data-id="${esc(it.id)}" role="option">
              <button type="button" class="bst-area-list-chip" data-action="area-list-select" data-id="${esc(it.id)}" title="${esc(it.name)}">
                <span class="bst-area-list-name">${esc(it.name)}</span>
                <span class="bst-k">${esc(tags.join(' · '))}</span>
              </button>
            </li>`;
          }).join('')
          : '<li class="bst-area-list-empty">Nothing in this area.</li>'}
      </ul>
      <div class="bst-area-list-panels">
        ${pieces.map(it => {
          const anchor = it.anchor || cellId;
          const curSurface = String(it.surface || '').trim();
          const surfaceChoices = [...surfaces.filter(s => s.id !== it.id)];
          if (curSurface && !surfaceChoices.some(s => s.name.toLowerCase() === curSurface.toLowerCase())) {
            surfaceChoices.unshift({ id: '', name: curSurface, kind: 'custom' });
          }
          return `<div class="bst-area-list-panel" data-for="${esc(it.id)}" hidden>
            ${it.description
              ? `<div class="bst-area-list-desc">${esc(it.description)}</div>`
              : '<div class="bst-hint">No description.</div>'}
            ${editable ? `
            <div class="bst-area-list-acts">
              <button type="button" class="bst-btn" data-action="placement-edit-piece" data-place="${esc(placeId)}" data-cell="${esc(anchor)}" data-layer="${esc(it.layer)}" data-id="${esc(it.id)}">Edit</button>
              <label class="bst-k">Layer
                <select class="bst-input bst-area-move" data-role="placement-layer-piece" data-place="${esc(placeId)}" data-cell="${esc(anchor)}" data-layer="${esc(it.layer)}" data-id="${esc(it.id)}" title="Sort into Fixtures, Furniture, or Clutter">
                  ${CELL_LAYERS.map(l => `<option value="${l.id}"${l.id === it.layer ? ' selected' : ''}>${esc(l.label)}</option>`).join('')}
                </select>
              </label>
              <label class="bst-k">Area
                <select class="bst-input bst-area-move" data-role="placement-move-piece" data-place="${esc(placeId)}" data-cell="${esc(anchor)}" data-layer="${esc(it.layer)}" data-id="${esc(it.id)}">
                  <option value="">—</option>
                  ${areaOpts}
                </select>
              </label>
              ${surfaceChoices.length || curSurface ? `
              <label class="bst-k">Surface
                <select class="bst-input bst-area-move" data-role="placement-surface-piece" data-place="${esc(placeId)}" data-cell="${esc(anchor)}" data-layer="${esc(it.layer)}" data-id="${esc(it.id)}" title="Assign surface or container in this room">
                  <option value=""${!curSurface ? ' selected' : ''}>— Floor / room —</option>
                  ${surfaceChoices.map(s => `<option value="${esc(s.name)}" data-parent-id="${esc(s.kind === 'container' ? s.id : '')}"${s.name.toLowerCase() === curSurface.toLowerCase() ? ' selected' : ''}>${esc(s.name)}</option>`).join('')}
                </select>
              </label>` : ''}
              ${otherRooms.length ? `
              <label class="bst-k">Room
                <select class="bst-input bst-area-move" data-role="placement-room-piece" data-place="${esc(placeId)}" data-cell="${esc(anchor)}" data-layer="${esc(it.layer)}" data-id="${esc(it.id)}" title="Move piece to another room">
                  <option value="">— Stay here —</option>
                  ${otherRooms.map(r => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('')}
                </select>
              </label>` : ''}
              <button type="button" class="bst-btn" data-action="placement-order-piece" data-dir="-1" data-place="${esc(placeId)}" data-cell="${esc(anchor)}" data-layer="${esc(it.layer)}" data-id="${esc(it.id)}" title="Move up in layer">↑</button>
              <button type="button" class="bst-btn" data-action="placement-order-piece" data-dir="1" data-place="${esc(placeId)}" data-cell="${esc(anchor)}" data-layer="${esc(it.layer)}" data-id="${esc(it.id)}" title="Move down in layer">↓</button>
              ${it.layer !== 'fixtures' ? `<button type="button" class="bst-btn" data-action="placement-pickup-piece" data-place="${esc(placeId)}" data-cell="${esc(anchor)}" data-layer="${esc(it.layer)}" data-id="${esc(it.id)}" title="Take into player inventory">→ Inv</button>` : ''}
              <button type="button" class="bst-btn danger" data-action="placement-del-piece" data-place="${esc(placeId)}" data-cell="${esc(anchor)}" data-layer="${esc(it.layer)}" data-id="${esc(it.id)}">Lost &amp; Found</button>
            </div>` : ''}
          </div>`;
        }).join('')}
        ${pieces.length
          ? '<div class="bst-area-list-panel bst-area-list-panel--hint" data-role="area-list-hint">Select an item for details &amp; sorting.</div>'
          : ''}
      </div>
    </div>`;
}

function renderCreateForm(compass, esc, draft = null) {
  const parents = Object.values(compass.rooms || {})
    .sort((a, b) => a.name.localeCompare(b.name));
  const kindSel = PLACE_KIND_SET_SAFE(draft?.kind) || 'room';
  const buildingKind = kindSel === 'building';
  const parentSel = String(draft?.parentId || '');
  const catSel = String(draft?.category || '');
  const nameVal = String(draft?.name || '');
  const kindOpts = PLACE_KINDS.map(k =>
    `<option value="${esc(k.id)}"${k.id === kindSel ? ' selected' : ''}>${esc(k.label)}</option>`).join('');
  const parentOpts = [
    `<option value="">— Root —</option>`,
    ...parents.map(p => `<option value="${esc(p.id)}"${p.id === parentSel ? ' selected' : ''}>${esc(p.name)} (${esc(p.kind)})</option>`),
  ].join('');
  return `
    <div class="bst-compass-create">
      <div class="bst-row">
        <label>Kind
          <select class="bst-input" data-role="place-kind">${kindOpts}</select>
        </label>
        <label>Nest under
          <select class="bst-input" data-role="place-parent">${parentOpts}</select>
        </label>
        <label data-role="create-category-field"${buildingKind ? '' : ' hidden'}>Category
          <select class="bst-input" data-role="place-category" title="Building category. Populate uses it to add rooms inside this building.">${renderCategorySelectOptions(catSel, esc, { hostKind: 'building', hostName: nameVal })}</select>
        </label>
      </div>
      <div class="bst-row">
        <input class="bst-input" style="width:7em" data-role="room-id" placeholder="id (auto)">
        <input class="bst-input" style="flex:1" data-role="room-name" placeholder="Display name" value="${esc(nameVal)}">
        <input class="bst-input" style="flex:1" data-role="place-desc" placeholder="Description (narrative)">
        <button type="button" class="bst-btn gold" data-action="compass-create">Create</button>
        <button type="button" class="bst-btn" data-action="compass-create-populate"${buildingKind ? '' : ' hidden'} title="Create this building and fill it with rooms for the chosen category">Create &amp; Populate</button>
      </div>
      <div class="bst-row" style="align-items:flex-start">
        <label class="bst-field" style="flex:1;margin:0"><span>Location tags</span>
          ${locationTagEditorHTML({
            selected: [],
            fieldRole: 'place-loctags',
            placeholder: 'Home, Workplace…',
            emptyHint: 'Narrative keywords such as Home or Workplace. Nest under already places this on the map.',
            newBtnLabel: '＋ Keyword',
            noun: 'keyword',
          })}
        </label>
      </div>
    </div>`;
}

function PLACE_KIND_SET_SAFE(kind) {
  const k = String(kind || '').trim();
  return PLACE_KINDS.some(x => x.id === k) ? k : '';
}

function renderFocusMeta(focus, compass, esc, open = false) {
  const meta = placeKindMeta(focus.kind);
  const parent = focus.parentId ? getPlace(compass, focus.parentId) : null;
  const tags = focus.locationTags || [];
  const parentOpts = [
    `<option value="">— Root —</option>`,
    ...Object.values(compass.rooms || {})
      .filter(p => p.id !== focus.id)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(p => `<option value="${esc(p.id)}"${p.id === focus.parentId ? ' selected' : ''}>${esc(p.name)}</option>`),
  ].join('');
  const kindOpts = PLACE_KINDS.map(k =>
    `<option value="${esc(k.id)}"${k.id === focus.kind ? ' selected' : ''}>${esc(k.label)}</option>`).join('');
  return `
    <details class="bst-section bst-fold" data-fold="set-focus" ${open ? 'open' : ''}>
      <summary class="bst-section-h">Details · ${esc(focus.name)}</summary>
      <div class="bst-fold-body">
      <div class="bst-compass-meta">
        <span class="bst-k">${esc(focus.id)} · ${esc(meta?.label || focus.kind)}${parent ? ` · under ${esc(parent.name)}` : ''}</span>
        ${focus.orientation_note ? `<div class="bst-hint">N note (author only): ${esc(focus.orientation_note)}</div>` : ''}
      </div>
      <div class="bst-row">
        <input class="bst-input" style="flex:1" data-role="focus-name" value="${esc(focus.name)}" placeholder="Name">
        <button type="button" class="bst-btn" data-action="compass-rename" data-place="${esc(focus.id)}">Rename</button>
      </div>
      <div class="bst-row">
        <label>Kind <select class="bst-input" data-role="focus-kind">${kindOpts}</select></label>
        <button type="button" class="bst-btn" data-action="compass-set-kind" data-place="${esc(focus.id)}">Apply kind</button>
        <label>Parent <select class="bst-input" data-role="focus-parent">${parentOpts}</select></label>
        <button type="button" class="bst-btn" data-action="compass-set-parent" data-place="${esc(focus.id)}">Nest</button>
        <label data-role="focus-category-field"${focus.kind === 'building' ? '' : ' hidden'}>Category <select class="bst-input" data-role="focus-category" data-place="${esc(focus.id)}">${renderCategorySelectOptions(focus.category || '', esc, { hostKind: 'building', hostName: focus.name })}</select></label>
        <button type="button" class="bst-btn gold" data-action="compass-populate-category" data-role="focus-populate" data-place="${esc(focus.id)}"${focus.kind === 'building' ? '' : ' hidden'} title="Fill this building with rooms for the chosen category">Populate</button>
      </div>
      <div class="bst-row" style="align-items:flex-start">
        <label class="bst-field" style="flex:1;margin:0"><span>Location tags</span>
          ${locationTagEditorHTML({
            selected: tags,
            fieldRole: 'focus-loctags',
            placeholder: 'Home, Workplace…',
            emptyHint: 'Narrative keywords such as Home or Workplace. Nest under already places this on the map.',
            newBtnLabel: '＋ Keyword',
            noun: 'keyword',
          })}
        </label>
        <button type="button" class="bst-btn danger" data-action="compass-delete" data-place="${esc(focus.id)}">Delete</button>
      </div>
      <div class="bst-row">
        <input class="bst-input" style="flex:1" data-role="focus-desc" value="${esc(focus.description || '')}" placeholder="Place description (when observed)">
        <button type="button" class="bst-btn" data-action="compass-set-desc" data-place="${esc(focus.id)}">Save description</button>
      </div>
      <div class="bst-row">
        <input class="bst-input" style="flex:1" data-role="focus-note" value="${esc(focus.orientation_note || '')}" placeholder="Orientation note (author-only)">
        <button type="button" class="bst-btn" data-action="compass-set-note" data-place="${esc(focus.id)}">Save note</button>
        ${isCompassPlaceKind(focus.kind)
          ? `${isLoadableKind(focus.kind)
              ? `<button type="button" class="bst-chip${focus.exposed ? ' on' : ''}" data-action="compass-toggle-exposed" data-place="${esc(focus.id)}" data-on="${focus.exposed ? '0' : '1'}" title="Exposed to weather / outdoors">Exposed</button>`
              : ''}
             <button type="button" class="bst-btn gold" data-action="compass-load" data-room="${esc(focus.id)}">${isExteriorHostKind(focus.kind) ? 'Load exterior' : 'Load on compass'}</button>
             <button type="button" class="bst-btn" data-action="compass-unload">Unload</button>`
          : (isScenePlaceKind(focus.kind)
            ? `<button type="button" class="bst-btn gold" data-action="set-here" data-place="${esc(focus.id)}" data-cell="C" title="Pin the scene here — outside nested buildings">We're here</button>`
            : '')}
        ${outdoorLeaveButton(compass, focus, esc)}
        ${parent
          ? `<button type="button" class="bst-btn" data-action="compass-view-parent" data-place="${esc(focus.id)}" data-parent="${esc(parent.id)}" title="Open ${esc(parent.name)}">View Parent</button>`
          : ''}
        <button type="button" class="bst-btn" data-action="compass-undo" data-place="${esc(focus.id)}">Undo</button>
      </div>
      </div>
    </details>`;
}

function renderSetLayout({
  compass,
  editing,
  cell,
  peeks,
  selectedEdges = [],
  drawWallMode = false,
  fpMode = 'move',
  fixtureAct = '',
  wallLinksOpen = false,
  herePlaceId = '',
  hereCell = 'C',
  lockCast = [],
  inspectChild = false,
  esc,
}) {
  const suiteChild = isSuiteChild(compass, editing);
  // Wall neighbors must share the same parent (siblings only — not cousins across the tree).
  const siblingParent = editing.parentId || '';
  const places = Object.values(compass.rooms || {})
    .filter(p => p.id !== editing.id && (p.parentId || '') === siblingParent)
    .sort((a, b) => a.name.localeCompare(b.name));
  const sel = new Set([...selectedEdges].map(String));
  const pings = listSonarPingsInPlace(compass, editing.id);
  const parent = suiteChild ? getPlace(compass, editing.parentId) : null;

  const floorplanPane = suiteChild && !inspectChild
    ? `<div class="bst-floorplan-center">
        ${renderFloorplanReadonly(editing, { placeId: editing.id, esc, parentName: parent?.name || '', compass })}
      </div>`
    : `<div class="bst-floorplan-center">
        ${renderFloorplan(editing, { placeId: editing.id, selectedEdges: sel, drawWallMode, fpMode, fixtureAct, lockCast, compass, esc })}
      </div>`;

  const hereOn = herePlaceId === editing.id;
  const hereLabel = hereOn
    ? `Here · ${editing.name}${hereCell ? ` · ${hereCell}` : ''}`
    : `We're here · ${editing.name}${cell ? ` · ${cell}` : ''}`;

  return `
    <section class="bst-section">
      <h3 class="bst-section-h">Layout · ${esc(editing.name)}${editing.exposed ? ' · exposed' : ''}</h3>
      <div class="bst-row" style="align-items:center;gap:8px;margin:0 0 8px">
        <button type="button" class="bst-btn gold" data-action="set-here" data-place="${esc(editing.id)}" data-cell="${esc(cell)}" title="Pin the scene location to this room and area — clapper, backgrounds, and compass follow">We're here</button>
        ${outdoorLeaveButton(compass, editing, esc)}
        ${hereOn ? `<span class="bst-chip on">${esc(hereLabel)}</span>` : `<span class="bst-k">Pin this room + area as the current location</span>`}
      </div>
      <p class="bst-hint">${suiteChild
        ? '<strong>Compass</strong> — select an area to list what sits there. <strong>Floorplan</strong> (below) — this room’s shape as it appears in its Suite (read-only).'
        : '<strong>Compass</strong> — select an area to list what sits there. <strong>Floorplan</strong> (below) — pan/zoom, reshape.'}</p>
      <div class="bst-compass-stage bst-compass-stage--side">
        <div class="bst-compass-side">
          <div class="bst-compass-pad">
            <div class="bst-k">Compass · areas</div>
            <div class="bst-compass-grid" role="grid" aria-label="Room areas">
            ${CELL_ROWS.map(row => row.map(id => {
              const { n, nOcc, nDoor } = cellSummaryBits(editing, id);
              const bits = [
                nOcc ? `${nOcc}p` : '',
                n ? `${n}` : '',
                nDoor ? '⇢' : '',
              ].filter(Boolean).join(' ');
              return `<button type="button" class="bst-compass-cell${id === cell ? ' on' : ''}" data-action="compass-select-area" data-cell="${id}" data-place="${esc(editing.id)}" title="${esc(cellDisplayLabel(editing.kind, id))}">
                <span class="bst-compass-cell-id">${id}</span>
                <span class="bst-k">${esc(bits)}</span>
              </button>`;
            }).join('')).join('')}
            </div>
          </div>
          <div class="bst-compass-side-list">
            ${renderAreaItemList(editing, cell, { placeId: editing.id, editable: true, compass, esc })}
            <div class="bst-row" style="margin-top:6px">
              <button type="button" class="bst-btn" data-action="compass-edit-cell" data-cell="${esc(cell)}" data-place="${esc(editing.id)}">+ Add in ${esc(cell)}…</button>
            </div>
            ${pings.length
              ? `<div class="bst-hint bst-sonar-pings">Sonar: ${pings.map(p => `${esc(p.name)}@${esc(p.cell)}`).join(' · ')}</div>`
              : ''}
          </div>
        </div>
        ${floorplanPane}
      </div>
    </section>

    ${suiteChild
      ? renderVerticalLinksPanel({ compass, editing, wallLinksOpen, peeks, esc })
      : renderWallLinksPanel({ compass, editing, sel, wallLinksOpen, peeks, esc })}`;
}

/** Full lateral + vertical wall-links panel — standalone rooms only (no suite to defer to). */
function renderWallLinksPanel({ compass, editing, sel, wallLinksOpen, peeks, esc }) {
  return `
    <details class="bst-section bst-fold" data-fold="set-wall-links" ${wallLinksOpen ? 'open' : ''}>
      <summary class="bst-section-h">Wall links</summary>
      <div class="bst-fold-body">
      <p class="bst-hint">Select floorplan walls or above/below. Drag a wall along its axis to resize. You can link walls to rooms in this unit, building corridors, or neighboring units.</p>
      <div class="bst-row bst-multi-chips">
        <button type="button" class="bst-chip${sel.size ? ' on' : ''}" disabled title="From floorplan">${sel.size ? `${sel.size} wall(s)` : 'No walls selected'}</button>
        <button type="button" class="bst-chip" data-action="compass-toggle-wall" data-wall="above">above</button>
        <button type="button" class="bst-chip" data-action="compass-toggle-wall" data-wall="below">below</button>
      </div>
      <div class="bst-row" style="margin-top:6px">
        <select class="bst-input" data-role="link-to" style="flex:1">
          ${renderLinkableNeighborOptions(compass, editing, { esc })}
        </select>
      </div>
      <div class="bst-row">
        <input class="bst-input" style="flex:1" data-role="link-desc" placeholder="Link description (when the shared wall is noticed)">
        <button type="button" class="bst-btn gold" data-action="compass-add-link" data-place="${esc(editing.id)}">Link selected</button>
        <button type="button" class="bst-btn" data-action="compass-mark-external" data-place="${esc(editing.id)}" title="Selected walls face outside">Mark external</button>
        <button type="button" class="bst-btn" data-action="compass-divide-room" data-place="${esc(editing.id)}" ${sel.size === 2 ? '' : 'disabled'} title="Select exactly 2 walls to cut a new dividing wall between them, forming a new room under the same parent">Divide room</button>
      </div>
      ${sel.size === 2 ? '<p class="bst-hint">Divide room cuts a straight wall between the midpoints of the two selected walls, creating a new sibling room. Fine-tune the new shapes / scale afterward.</p>' : ''}
      ${renderWallLinkRows(compass, editing, editing.links || [], esc)}
      ${renderPeerPreview(peeks, esc)}
      </div>
    </details>`;
}

/**
 * Vertical-only (above/below) wall-links panel — suite-child rooms. Lateral
 * wall linking, external marking, opening placement, and divide-room all
 * move to the Suite view; a stairway to another floor/unit isn't a shared
 * wall within this suite, so it stays here.
 */
function renderVerticalLinksPanel({ compass, editing, wallLinksOpen, peeks, esc }) {
  const verticalLinks = (editing.links || []).filter(l => l.wall === 'above' || l.wall === 'below');
  const mine = topSuiteAncestorId(compass, editing.id);
  const foreignLinks = (editing.links || []).filter(l => {
    if (!l?.toPlaceId || l.wall === 'above' || l.wall === 'below') return false;
    const peerTop = topSuiteAncestorId(compass, l.toPlaceId);
    return !!(peerTop && mine && peerTop !== mine);
  });
  return `
    <details class="bst-section bst-fold" data-fold="set-wall-links" ${wallLinksOpen ? 'open' : ''}>
      <summary class="bst-section-h">Vertical exits</summary>
      <div class="bst-fold-body">
      <p class="bst-hint">Above / below exits (stairs, ladders, hatches) to another floor. Lateral walls and fixtures for this room live in its Suite view.</p>
      <div class="bst-row bst-multi-chips">
        <button type="button" class="bst-chip" data-action="compass-toggle-wall" data-wall="above">above</button>
        <button type="button" class="bst-chip" data-action="compass-toggle-wall" data-wall="below">below</button>
      </div>
      <div class="bst-row" style="margin-top:6px">
        <select class="bst-input" data-role="link-to" style="flex:1">
          ${renderLinkableNeighborOptions(compass, editing, { esc })}
        </select>
      </div>
      <div class="bst-row">
        <input class="bst-input" style="flex:1" data-role="link-desc" placeholder="Link description (when the exit is noticed)">
        <button type="button" class="bst-btn gold" data-action="compass-add-link" data-place="${esc(editing.id)}">Link selected</button>
      </div>
      ${renderWallLinkRows(compass, editing, verticalLinks, esc, 'No vertical exits yet — toggle above / below, pick a neighbor, then Link selected.')}
      ${foreignLinks.length ? `<p class="bst-hint">These walls still open into another building. Unlink drops the connection there too.</p>${renderWallLinkRows(compass, editing, foreignLinks, esc)}` : ''}
      ${renderPeerPreview(peeks, esc)}
      </div>
    </details>`;
}

/** Shared per-link row renderer used by both the full and vertical-only panels. */
function renderWallLinkRows(compass, editing, links, esc, emptyMsg = 'No wall links yet — select walls on the floorplan.') {
  if (!links.length) return `<div class="bst-empty">${esc(emptyMsg)}</div>`;
  return [...links]
    .sort((a, b) => {
      const ae = a.edge == null ? 999 : Number(a.edge);
      const be = b.edge == null ? 999 : Number(b.edge);
      if (ae !== be) return ae - be;
      return String(a.wall || '').localeCompare(String(b.wall || ''));
    })
    .map(link => {
      const neigh = getPlace(compass, link.toPlaceId);
      const wallLabel = formatWallLinkLabel(link, editing);
      const dest = link.toPlaceId
        ? (neigh ? disambiguatedPlaceName(compass, neigh) : link.toPlaceId)
        : (link.external ? 'outside' : '—');
      const opnBits = (link.openings || []).map(op =>
        `${op.type}${op.locked ? '🔒' : ''}${op.peer ? '👁' : ''}`).join(', ') || 'no openings';
      const styleChip = link.sharedStyle === 'threshold'
        ? '<span class="bst-chip" title="Open threshold">threshold</span>'
        : (link.sharedStyle === 'open'
          ? '<span class="bst-chip" title="Interior wall removed">open</span>'
          : '');
      return `<div class="bst-compass-link">
        <div class="bst-row">
          <strong>${esc(wallLabel)}</strong> → ${esc(dest)}
          ${link.external ? '<span class="bst-chip on" title="Faces outside">external</span>' : ''}
          ${styleChip}
          <span class="bst-k">${esc(opnBits)}</span>
          <button type="button" class="bst-btn" data-action="compass-toggle-link-external" data-link="${esc(link.id)}" data-place="${esc(editing.id)}" data-on="${link.external ? '0' : '1'}">${link.external ? 'Clear external' : 'External'}</button>
          <button type="button" class="bst-btn" data-action="compass-add-opn-wall" data-link="${esc(link.id)}" data-place="${esc(editing.id)}">+ Opening</button>
          <button type="button" class="bst-btn danger" data-action="compass-remove-link" data-link="${esc(link.id)}" data-place="${esc(editing.id)}">Unlink</button>
        </div>
        ${link.description ? `<div class="bst-hint">${esc(link.description)}</div>` : ''}
      </div>`;
    }).join('');
}

/** Shared peer-preview footer used by both wall-links panels. */
function renderPeerPreview(peeks, esc) {
  if (!peeks.length) return '';
  return `<div class="bst-hint" style="margin-top:8px"><strong>Peer preview:</strong> ${peeks.filter(p => p.visible).map(p => {
    const bits = [...(p.items || []).map(i => i.name), ...(p.occupants || []).map(o => o.name + '*')];
    return `${esc(p.wall)}→${esc(p.toName)}${p.locked ? ' (locked)' : ''}: ${bits.length ? esc(bits.join(', ')) : '(empty wall)'}`;
  }).join(' · ') || 'nothing visible through openings'}</div>`;
}

/** Area-based preview (no cast picker). */
export function buildPlacementPovPreview(compass, placeId, { cell, facing, sonarReach = 'adjacent' } = {}) {
  const room = getPlace(compass, placeId);
  if (!room) return '';
  const peeks = gatherPeerViews(compass, room);
  const occupant = areaObserver(cell || 'C', facing || 'N');
  return formatPovBlock(room, occupant, peeks, { sonarReach });
}
