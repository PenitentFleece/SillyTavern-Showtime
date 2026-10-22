// Room Compass — Inventory-style modal dialogs for Stage/Set editing.

import {
  CELLS,
  CELL_LAYERS,
  FACINGS,
  OPENING_TYPES,
  PIECE_CATEGORIES,
  PIECE_CONDITIONS,
  cellContentCount,
  listCellPieces,
  isVerticalOpeningType,
  defaultFootprint,
  enclosingOutdoorPlace,
  placeKindMeta,
} from './schema.js';
import {
  getPlace,
  disambiguatedPlaceName,
  gatherPeerViews,
  openingLockTitle,
  keyringUnlocksPlace,
  listLinkableNeighbors,
} from './state.js';
import {
  projectFootprint,
  edgeCardinal,
  estimateFootprintScale,
  isVerticalWall,
  formatWallLinkLabel,
} from './floorplan.js';
import { areaCenterInFootprint } from './barriers.js';
import {
  ensureSuiteChildPoses,
  findContactingPairs,
  listSuiteChildren,
  listSuiteUnits,
  suiteWorldBounds,
  suiteStoryMap,
  suiteHasStackedStories,
  suiteUnitOuterSilhouette,
  worldPolygon,
  worldAabb,
  worldEdgeCardinal,
  resolveSharedWallVisual,
  worldFromNorm,
  edgesFacingCardinal,
  sharedContactSegment,
} from './suiteLayout.js';
import { listingCodeHits, suiteListingLine } from './listing.js';
import { listSonarPingsInPlace } from './sonar.js';
import {
  PLACE_CATEGORY_GROUPS,
  canonicalizeTypology,
  categoryLabel,
} from './roomProgram.js';
import {
  buildShowtimeModal,
  showtimeAlert,
  showtimeConfirm,
  showtimePrompt,
} from '../dialogs.js';

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderSuiteCategoryOptions(selectedId = '', escFn = esc, {
  hostKind = '',
  hostName = '',
  emptyLabel = '— Category —',
} = {}) {
  const sel = String(selectedId || '').trim();
  const inferred = !sel && (hostName || hostKind)
    ? canonicalizeTypology('', { hostKind, hostName })
    : '';
  const inferredLabel = inferred ? categoryLabel(inferred) : '';
  const head = `<option value="">${escFn(inferredLabel ? `${emptyLabel} (Auto: ${inferredLabel})` : emptyLabel)}</option>`;
  const body = PLACE_CATEGORY_GROUPS.map(group => {
    const opts = group.items.map(it =>
      `<option value="${escFn(it.id)}"${it.id === sel ? ' selected' : ''}>${escFn(it.label)}</option>`,
    ).join('');
    return `<optgroup label="${escFn(group.label)}">${opts}</optgroup>`;
  }).join('');
  return `${head}${body}`;
}

function renderNeighborSelectGroups(compass, room, {
  selectedValue = '',
  includeAuto = false,
  autoLabel = 'Auto (from floorplan contact)',
  includeExterior = true,
  emptyLabel = '— Unlinked outer wall —',
  escFn = esc,
} = {}) {
  const { siblings = [], corridors = [], units = [], others = [] } = listLinkableNeighbors(compass, room);
  const sel = String(selectedValue || '').trim();
  const fmt = (p) => {
    const parent = p.parentId ? compass?.rooms?.[p.parentId] : null;
    const kindBit = placeKindMeta(p.kind)?.label || p.kind;
    if (parent && parent.id !== room?.parentId) {
      return `${p.name} (${kindBit} · ${parent.name})`;
    }
    return `${p.name}`;
  };
  const groupHtml = (label, list) => {
    if (!list.length) return '';
    return `<optgroup label="${escFn(label)}">${list.map(p =>
      `<option value="${escFn(p.id)}"${p.id === sel ? ' selected' : ''}>${escFn(fmt(p))}</option>`,
    ).join('')}</optgroup>`;
  };
  const top = [
    `<option value="__none__"${!sel || sel === '__none__' ? ' selected' : ''}>${escFn(emptyLabel)}</option>`,
    includeAuto
      ? `<option value="__auto__"${sel === '__auto__' ? ' selected' : ''}>${escFn(autoLabel)}</option>`
      : '',
    includeExterior
      ? `<option value="__exterior__"${sel === '__exterior__' ? ' selected' : ''}>Outside / Exterior</option>`
      : '',
  ].filter(Boolean).join('');
  const body = [
    groupHtml('In this suite / unit', siblings),
    groupHtml('Corridors & shared spaces', corridors),
    groupHtml('Neighboring units & rooms', units),
    groupHtml('Other places', others),
  ].filter(Boolean).join('');
  return `${top}${body}`;
}

/** Ensure Inventory punch-ticket styles are available (reuse inv-modal-*). */
export function ensureInvModalStyles() {
  /* Global punch-ticket modal styles now live in style.css */
}

export function buildModal(inner, opts) {
  return buildShowtimeModal(inner, opts);
}

export { showtimeAlert, showtimeConfirm, showtimePrompt };

/**
 * Cell editor: layers + occupants + openings on this cell.
 * @param {object} opts
 * @param {object} opts.room
 * @param {object} opts.compass
 * @param {string} opts.cell
 * @param {Array} opts.castMembers
 * @param {object} opts.handlers — callbacks for mutations
 */
export function openCellDialog({
  room,
  compass,
  cell,
  castMembers = [],
  handlers = {},
}) {
  const cellId = cell;
  const occHere = (room.occupants || []).filter(o => o.cell === cellId);
  const openingsHere = [];
  for (const link of room.links || []) {
    for (const op of link.openings || []) {
      if (op.cell === cellId) {
        openingsHere.push({ link, op, neighbor: getPlace(compass, link.toPlaceId) });
      }
    }
  }

  const layerBlocks = CELL_LAYERS.map(layer => {
    const rows = layer.id === 'furniture'
      ? listCellPieces(room.cells?.[cellId], { room, cellId })
        .filter(p => p.layer === 'furniture' && p.anchor === cellId)
      : (room.cells?.[cellId]?.[layer.id] || []);
    return `
      <div class="inv-modal-field">
        <label>${esc(layer.label)} <span class="inv-modal-hint">${esc(layer.hint)}</span></label>
        <ul class="bst-compass-list bst-compass-dlg-list">
          ${rows.length
            ? rows.map(it => {
              const tags = [];
              if (layer.id === 'furniture') {
                if (it.cells?.length > 1) tags.push(`areas ${it.cells.join('+')}`);
                if (it.occupiable) tags.push(`sits×${it.maxOccupancy || 1}`);
                if (it.contains) tags.push(it.contentsVisible === 'inside' ? 'contains (hidden)' : 'display (visible)');
              }
              if (it.surface) tags.push(`on ${it.surface}`);
              return `
              <li>
                <span>${esc(it.name)}${it.category ? ` · ${esc(it.category)}` : ''}${it.description ? ` <em>(${esc(it.description)})</em>` : ''}${tags.length ? ` <span class="bst-k">${esc(tags.join(' · '))}</span>` : ''}</span>
                <span class="bst-row">
                  <select class="bst-input" data-role="dlg-layer-piece" data-layer="${layer.id}" data-id="${esc(it.id)}" title="Sort into layer">
                    ${CELL_LAYERS.map(l => `<option value="${l.id}"${l.id === layer.id ? ' selected' : ''}>${esc(l.label)}</option>`).join('')}
                  </select>
                  <select class="bst-input" data-role="dlg-move-piece" data-layer="${layer.id}" data-id="${esc(it.id)}" title="Move to another area">
                    <option value="">Area…</option>
                    ${CELLS.filter(c => c !== cellId).map(c => `<option value="${c}">${c}</option>`).join('')}
                  </select>
                  <button type="button" class="inv-btn" data-act="edit-piece" data-layer="${layer.id}" data-id="${esc(it.id)}">Edit</button>
                  ${layer.id !== 'fixtures' ? `<button type="button" class="inv-btn" data-act="pickup-piece" data-layer="${layer.id}" data-id="${esc(it.id)}">→ Inv</button>` : ''}
                  <button type="button" class="inv-btn" data-act="del-piece" data-layer="${layer.id}" data-id="${esc(it.id)}">Delete</button>
                </span>
              </li>`;
            }).join('')
            : '<li class="bst-empty">None</li>'}
        </ul>
        <button type="button" class="inv-btn" data-act="add-piece" data-layer="${layer.id}">+ Add ${esc(layer.label)}</button>
      </div>`;
  }).join('');

  const castOpts = [
    `<option value="">— Cast member —</option>`,
    ...castMembers.map(m => `<option value="${esc(m.id)}" data-name="${esc(m.name)}">${esc(m.name)}</option>`),
  ].join('');

  const backdrop = buildModal(`
      <div class="inv-modal-title">AREA · ${esc(cellId)}</div>
    <div class="inv-modal-subtitle">— ${esc(room.name)} · set dressing —</div>
    ${layerBlocks}
    <div class="inv-modal-field">
      <label>Occupants here</label>
      <ul class="bst-compass-list bst-compass-dlg-list">
        ${occHere.length
          ? occHere.map(o => `
            <li>
              <span>${esc(o.name)}</span>
              <label class="bst-k">Facing
                <select class="bst-input" data-role="occ-face" data-name="${esc(o.name)}" title="Which way ${esc(o.name)} is facing">
                  ${FACINGS.map(f => `<option value="${f}"${f === o.facing ? ' selected' : ''}>${f}</option>`).join('')}
                </select>
              </label>
              <label class="bst-k">Move
                <select class="bst-input" data-role="occ-move" data-name="${esc(o.name)}" title="Move ${esc(o.name)} to another area">
                  <option value="">—</option>
                  ${CELLS.filter(c => c !== cellId).map(c => `<option value="${c}">${c}</option>`).join('')}
                </select>
              </label>
              <button type="button" class="inv-btn" data-act="del-occ" data-name="${esc(o.name)}">Remove</button>
            </li>`).join('')
          : '<li class="bst-empty">None</li>'}
      </ul>
      <div class="bst-row">
        <select class="bst-input" data-field="cast" style="flex:1">${castOpts}</select>
        <button type="button" class="inv-btn" data-act="add-occ">Add from cast</button>
      </div>
      <div class="inv-modal-field" style="margin-top:6px">
        <label>Occupant note (optional)</label>
        <input type="text" data-field="occ-desc" placeholder="Description when this person is observed…">
      </div>
    </div>
    <div class="inv-modal-field">
      <label>Doors / openings on this area</label>
      <ul class="bst-compass-list bst-compass-dlg-list">
        ${openingsHere.length
          ? openingsHere.map(({ link, op, neighbor }) => `
            <li>
              <span>${esc(op.type)} · ${esc(link.wall)} → ${esc(neighbor?.name || link.toPlaceId)}
                ${op.locked ? ' · locked' : ''}${op.peer ? ' · see-through' : ''}</span>
              <span class="bst-row">
                <button type="button" class="inv-btn" data-act="edit-opn" data-link="${esc(link.id)}" data-opn="${esc(op.id)}">Edit</button>
                <button type="button" class="inv-btn" data-act="del-opn" data-link="${esc(link.id)}" data-opn="${esc(op.id)}">Delete</button>
              </span>
            </li>`).join('')
          : '<li class="bst-empty">None — link a wall first, then add an opening.</li>'}
      </ul>
      <button type="button" class="inv-btn" data-act="add-opn-here">+ Door / opening…</button>
    </div>
    <div class="inv-modal-actions">
      <button type="button" class="inv-btn" data-act="close">Done</button>
    </div>
  `);

  const close = () => backdrop.remove();
  backdrop.querySelector('[data-act="close"]').addEventListener('click', close);

  backdrop.querySelectorAll('[data-act="add-piece"]').forEach(btn => {
    btn.addEventListener('click', () => {
      close();
      const layer = btn.dataset.layer;
      const open = layer === 'furniture' ? openFurnitureDialog : openPieceDialog;
      open({
        layer,
        existing: null,
        defaultCells: [cellId],
        onSave: (piece) => {
          const cells = piece.cells?.length ? piece.cells : [cellId];
          handlers.addPiece?.(cells, layer, piece);
        },
      });
    });
  });

  backdrop.querySelectorAll('[data-act="edit-piece"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const layer = btn.dataset.layer;
      let existing = (room.cells?.[cellId]?.[layer] || [])
        .find(x => x.id === btn.dataset.id);
      if (!existing && layer === 'furniture') {
        for (const bag of Object.values(room.cells || {})) {
          existing = (bag.furniture || []).find(x => x.id === btn.dataset.id);
          if (existing) break;
        }
      }
      if (!existing) return;
      close();
      const open = layer === 'furniture' ? openFurnitureDialog : openPieceDialog;
      open({
        layer,
        existing,
        defaultCells: existing.cells?.length ? existing.cells : [cellId],
        onSave: (piece) => handlers.updatePiece?.(existing.anchor || cellId, layer, existing.id, piece),
        onDelete: () => handlers.removePiece?.(existing.anchor || cellId, layer, existing.id),
      });
    });
  });

  backdrop.querySelectorAll('[data-act="del-piece"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!await showtimeConfirm('Delete this piece?', { title: 'SET PIECE', danger: true, confirmLabel: 'Delete' })) return;
      const layer = btn.dataset.layer;
      let delCell = cellId;
      if (layer === 'furniture') {
        for (const [cid, bag] of Object.entries(room.cells || {})) {
          if ((bag.furniture || []).some(x => x.id === btn.dataset.id)) {
            delCell = cid;
            break;
          }
        }
      }
      close();
      handlers.removePiece?.(delCell, layer, btn.dataset.id);
    });
  });

  backdrop.querySelectorAll('[data-act="pickup-piece"]').forEach(btn => {
    btn.addEventListener('click', () => {
      close();
      handlers.pickupPiece?.(cellId, btn.dataset.layer, btn.dataset.id);
    });
  });

  backdrop.querySelectorAll('[data-role="dlg-layer-piece"]').forEach(sel => {
    sel.addEventListener('change', () => {
      const toLayer = sel.value;
      if (!toLayer || toLayer === sel.dataset.layer) return;
      close();
      handlers.movePiece?.(cellId, sel.dataset.layer, sel.dataset.id, { toLayer });
    });
  });

  backdrop.querySelectorAll('[data-role="dlg-move-piece"]').forEach(sel => {
    sel.addEventListener('change', () => {
      const toCell = sel.value;
      if (!toCell || toCell === cellId) return;
      close();
      handlers.movePiece?.(cellId, sel.dataset.layer, sel.dataset.id, { toCell });
    });
  });

  backdrop.querySelector('[data-act="add-occ"]')?.addEventListener('click', () => {
    const sel = backdrop.querySelector('[data-field="cast"]');
    const opt = sel?.selectedOptions?.[0];
    const castId = sel?.value || '';
    const name = opt?.dataset?.name || opt?.textContent || '';
    const description = backdrop.querySelector('[data-field="occ-desc"]')?.value?.trim() || '';
    if (!castId && !name) { void showtimeAlert('Pick a cast member.', { title: 'OCCUPANCY' }); return; }
    close();
    handlers.addOccupant?.(cellId, { name, castId, description });
  });

  backdrop.querySelectorAll('[data-act="del-occ"]').forEach(btn => {
    btn.addEventListener('click', () => {
      close();
      handlers.removeOccupant?.(btn.dataset.name);
    });
  });

  backdrop.querySelectorAll('[data-role="occ-face"]').forEach(sel => {
    sel.addEventListener('change', () => {
      close();
      handlers.faceOccupant?.(sel.dataset.name, sel.value);
    });
  });

  backdrop.querySelectorAll('[data-role="occ-move"]').forEach(sel => {
    sel.addEventListener('change', () => {
      const toCell = sel.value;
      if (!toCell) return;
      close();
      handlers.moveOccupant?.(sel.dataset.name, toCell);
    });
  });

  backdrop.querySelectorAll('[data-act="edit-opn"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const link = (room.links || []).find(l => l.id === btn.dataset.link);
      const op = link?.openings?.find(o => o.id === btn.dataset.opn);
      if (!link || !op) return;
      close();
      openOpeningDialog({
        room,
        compass,
        link,
        existing: op,
        defaultCell: cellId,
        castMembers,
        onSave: (patch) => handlers.updateOpening?.(link.id, op.id, patch),
        onDelete: () => handlers.removeOpening?.(link.id, op.id),
      });
    });
  });

  backdrop.querySelectorAll('[data-act="del-opn"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!await showtimeConfirm('Delete this opening?', { title: 'OPENING', danger: true, confirmLabel: 'Delete' })) return;
      close();
      handlers.removeOpening?.(btn.dataset.link, btn.dataset.opn);
    });
  });

  backdrop.querySelector('[data-act="add-opn-here"]')?.addEventListener('click', () => {
    close();
    openOpeningDialog({
      room,
      compass,
      link: null,
      existing: null,
      defaultCell: cellId,
      castMembers,
      onSave: (payload) => handlers.addOpening?.(payload),
    });
  });
}

/** Inventory-style piece claim dialog (fixtures + clutter). */
export function openPieceDialog({
  layer = 'clutter',
  existing = null,
  defaultCells = ['C'],
  onSave,
  onDelete,
}) {
  const isEdit = !!existing;
  const layerMeta = CELL_LAYERS.find(l => l.id === layer) || CELL_LAYERS[2];
  const multiCells = (layer === 'fixtures') && !isEdit;
  const item = existing || {
    kind: 'item',
    name: '',
    description: '',
    category: 'misc',
    condition: 'fine',
  };
  const selected = new Set(
    (Array.isArray(defaultCells) ? defaultCells : [defaultCells])
      .map(c => String(c || '').toUpperCase())
      .filter(c => CELLS.includes(c)),
  );
  if (!selected.size) selected.add('C');

  const backdrop = buildModal(`
    <div class="inv-modal-title">${isEdit ? 'REFIT' : 'CLAIM'} · ${esc(layerMeta.label).toUpperCase()}</div>
    <div class="inv-modal-subtitle">— room ${esc(layerMeta.label.toLowerCase())} —</div>
    ${multiCells ? `
      <div class="inv-modal-field">
        <label>Place on areas (multi-select)</label>
        <div class="inv-cat-row bst-multi-chips" data-role="cell-chips">
          ${CELLS.map(c =>
            `<button type="button" class="inv-cat-btn${selected.has(c) ? ' on' : ''}" data-cell="${c}">${c}</button>`).join('')}
        </div>
        <div class="inv-modal-hint">Fixtures can span several areas (e.g. a wall run).</div>
      </div>` : ''}
    ${layer === 'clutter' ? `
    <div class="inv-modal-field" data-kind-wrap>
      <label>What is this?</label>
      <div class="inv-kind-row">
        <button type="button" class="inv-kind-btn" data-kind="container">Container</button>
        <button type="button" class="inv-kind-btn" data-kind="item">Item</button>
      </div>
    </div>
    <div class="inv-modal-field" data-cat-wrap>
      <label>Item category</label>
      <div class="inv-cat-row">
        ${PIECE_CATEGORIES.map(c =>
          `<button type="button" class="inv-cat-btn" data-cat="${c.id}">${esc(c.label)}</button>`).join('')}
      </div>
      <div class="inv-modal-hint">Usable items can unlock matching doors.</div>
    </div>` : ''}
    <div class="inv-modal-field"><label>Name</label>
      <input type="text" data-field="name" value="${esc(item.name)}"></div>
    <div class="inv-modal-field"><label>Description</label>
      <textarea data-field="description" placeholder="What is noticed when this is observed…">${esc(item.description || item.state || '')}</textarea></div>
    <div class="inv-modal-field"><label>Surface / container (optional)</label>
      <input type="text" data-field="surface" value="${esc(item.surface || '')}" placeholder="e.g. small table, shelves, worktable, three boxes…"></div>
    ${isEdit ? `
    <div class="inv-modal-field">
      <label>Layer</label>
      <select data-field="layer">
        ${CELL_LAYERS.map(l => `<option value="${l.id}" ${l.id === layer ? 'selected' : ''}>${esc(l.label)}</option>`).join('')}
      </select>
    </div>` : ''}
    <div class="inv-modal-field" data-cond-wrap>
      <label>Condition</label>
      <select data-field="condition">
        ${PIECE_CONDITIONS.map(cn =>
          `<option value="${cn.id}" ${cn.id === (item.condition || 'fine') ? 'selected' : ''}>${cn.label}</option>`).join('')}
      </select>
    </div>
    <div class="inv-modal-actions">
      ${isEdit && onDelete ? '<button type="button" class="inv-btn" data-act="delete" style="margin-right:auto">Delete</button>' : ''}
      <button type="button" class="inv-btn" data-act="cancel">Cancel</button>
      <button type="button" class="inv-btn" data-act="save">${isEdit ? 'Save' : 'Add'}</button>
    </div>
  `);

  let kind = isEdit ? (item.kind === 'container' ? 'container' : 'item') : 'item';
  let category = item.category || 'misc';

  backdrop.querySelectorAll('[data-role="cell-chips"] [data-cell]').forEach(btn => {
    btn.addEventListener('click', () => {
      const c = btn.dataset.cell;
      if (selected.has(c)) {
        if (selected.size <= 1) return;
        selected.delete(c);
      } else selected.add(c);
      btn.classList.toggle('on', selected.has(c));
    });
  });

  const sync = () => {
    backdrop.querySelectorAll('.inv-kind-btn').forEach(b => b.classList.toggle('on', b.dataset.kind === kind));
    backdrop.querySelectorAll('.inv-cat-btn[data-cat]').forEach(b => b.classList.toggle('on', b.dataset.cat === category));
    const catWrap = backdrop.querySelector('[data-cat-wrap]');
    if (catWrap) catWrap.style.display = kind === 'container' ? 'none' : '';
  };
  sync();
  backdrop.querySelectorAll('.inv-kind-btn').forEach(b => {
    b.addEventListener('click', () => { kind = b.dataset.kind; sync(); });
  });
  backdrop.querySelectorAll('.inv-cat-btn[data-cat]').forEach(b => {
    b.addEventListener('click', () => { category = b.dataset.cat; sync(); });
  });
  backdrop.querySelector('[data-act="cancel"]').addEventListener('click', () => backdrop.remove());
  backdrop.querySelector('[data-act="delete"]')?.addEventListener('click', async () => {
    if (!await showtimeConfirm('Delete?', { title: 'SET PIECE', danger: true, confirmLabel: 'Delete' })) return;
    backdrop.remove();
    onDelete?.();
  });
  backdrop.querySelector('[data-act="save"]').addEventListener('click', () => {
    const name = backdrop.querySelector('[data-field="name"]').value.trim();
    if (!name) { void showtimeAlert('Name is required.', { title: 'SET PIECE' }); return; }
    const description = backdrop.querySelector('[data-field="description"]').value.trim();
    const surface = backdrop.querySelector('[data-field="surface"]')?.value?.trim() || '';
    const nextLayer = backdrop.querySelector('[data-field="layer"]')?.value || layer;
    const condition = backdrop.querySelector('[data-field="condition"]').value;
    backdrop.remove();
    onSave?.({
      kind: nextLayer === 'fixtures' ? 'item' : kind,
      name,
      description,
      surface,
      layer: nextLayer,
      condition,
      category: nextLayer === 'clutter' && kind === 'item' ? category : undefined,
      cells: [...selected],
    });
  });
  setTimeout(() => backdrop.querySelector('[data-field="name"]')?.focus(), 0);
}

/** Furniture-specific claim dialog (multi-cell, occupy, contain/display). */
export function openFurnitureDialog({
  existing = null,
  defaultCells = ['C'],
  onSave,
  onDelete,
}) {
  const isEdit = !!existing;
  const item = existing || {
    name: '',
    description: '',
    condition: 'fine',
    occupiable: false,
    maxOccupancy: 1,
    contains: false,
    contentsVisible: 'out',
    cells: defaultCells,
  };
  const selected = new Set(
    (Array.isArray(item.cells) && item.cells.length
      ? item.cells
      : (Array.isArray(defaultCells) ? defaultCells : [defaultCells]))
      .map(c => String(c || '').toUpperCase())
      .filter(c => CELLS.includes(c)),
  );
  if (!selected.size) selected.add('C');

  const backdrop = buildModal(`
    <div class="inv-modal-title">${isEdit ? 'REFIT FURNITURE' : 'FURNITURE CLAIM'}</div>
    <div class="inv-modal-subtitle">— set dressing · multi-area —</div>
    <div class="inv-modal-field">
      <label>Footprint areas (multi-select)</label>
      <div class="inv-cat-row bst-multi-chips" data-role="cell-chips">
        ${CELLS.map(c =>
          `<button type="button" class="inv-cat-btn${selected.has(c) ? ' on' : ''}" data-cell="${c}">${c}</button>`).join('')}
      </div>
      <div class="inv-modal-hint">A sofa might cover C+E; a table might cover C alone.</div>
    </div>
    <div class="inv-modal-field"><label>Name</label>
      <input type="text" data-field="name" value="${esc(item.name)}"></div>
    <div class="inv-modal-field"><label>Description</label>
      <textarea data-field="description" placeholder="What is noticed when this furniture is observed…">${esc(item.description || '')}</textarea></div>
    <div class="inv-modal-field"><label>Surface / container (optional)</label>
      <input type="text" data-field="surface" value="${esc(item.surface || '')}" placeholder="e.g. shelves, worktable…"></div>
    ${isEdit ? `
    <div class="inv-modal-field">
      <label>Layer</label>
      <select data-field="layer">
        ${CELL_LAYERS.map(l => `<option value="${l.id}" ${l.id === 'furniture' ? 'selected' : ''}>${esc(l.label)}</option>`).join('')}
      </select>
    </div>` : ''}
    <div class="inv-modal-field">
      <label>Condition</label>
      <select data-field="condition">
        ${PIECE_CONDITIONS.map(cn =>
          `<option value="${cn.id}" ${cn.id === (item.condition || 'fine') ? 'selected' : ''}>${cn.label}</option>`).join('')}
      </select>
    </div>
    <div class="inv-modal-field">
      <label class="bst-check"><input type="checkbox" data-field="occupiable" ${item.occupiable ? 'checked' : ''}> Can be occupied / sat on</label>
      <div data-occ-wrap style="${item.occupiable ? '' : 'display:none'}; margin-top:6px">
        <label>Maximum occupancy</label>
        <input type="number" min="1" max="20" data-field="maxOccupancy" value="${esc(item.maxOccupancy || 1)}">
      </div>
    </div>
    <div class="inv-modal-field">
      <label class="bst-check"><input type="checkbox" data-field="contains" ${item.contains ? 'checked' : ''}> Meant to display / contain</label>
      <div data-vis-wrap style="${item.contains ? '' : 'display:none'}; margin-top:6px">
        <label>Contents visibility</label>
        <div class="inv-kind-row">
          <button type="button" class="inv-kind-btn" data-vis="out">Out (visible display)</button>
          <button type="button" class="inv-kind-btn" data-vis="inside">Inside (hidden)</button>
        </div>
        <div class="inv-modal-hint">Out = on display / open shelves. Inside = closed cabinet, drawer, trunk.</div>
      </div>
    </div>
    <div class="inv-modal-actions">
      ${isEdit && onDelete ? '<button type="button" class="inv-btn" data-act="delete" style="margin-right:auto">Delete</button>' : ''}
      <button type="button" class="inv-btn" data-act="cancel">Cancel</button>
      <button type="button" class="inv-btn" data-act="save">${isEdit ? 'Save' : 'Add'}</button>
    </div>
  `);

  let contentsVisible = item.contentsVisible === 'inside' ? 'inside' : 'out';
  const occInput = backdrop.querySelector('[data-field="occupiable"]');
  const containsInput = backdrop.querySelector('[data-field="contains"]');
  const syncOcc = () => {
    backdrop.querySelector('[data-occ-wrap]').style.display = occInput.checked ? '' : 'none';
  };
  const syncVis = () => {
    backdrop.querySelector('[data-vis-wrap]').style.display = containsInput.checked ? '' : 'none';
    backdrop.querySelectorAll('[data-vis]').forEach(b => b.classList.toggle('on', b.dataset.vis === contentsVisible));
  };
  occInput.addEventListener('change', syncOcc);
  containsInput.addEventListener('change', syncVis);
  syncVis();
  backdrop.querySelectorAll('[data-vis]').forEach(b => {
    b.addEventListener('click', () => { contentsVisible = b.dataset.vis; syncVis(); });
  });

  backdrop.querySelectorAll('[data-role="cell-chips"] [data-cell]').forEach(btn => {
    btn.addEventListener('click', () => {
      const c = btn.dataset.cell;
      if (selected.has(c)) {
        if (selected.size <= 1) return;
        selected.delete(c);
      } else selected.add(c);
      btn.classList.toggle('on', selected.has(c));
    });
  });

  backdrop.querySelector('[data-act="cancel"]').addEventListener('click', () => backdrop.remove());
  backdrop.querySelector('[data-act="delete"]')?.addEventListener('click', async () => {
    if (!await showtimeConfirm('Delete furniture?', { title: 'FURNITURE', danger: true, confirmLabel: 'Delete' })) return;
    backdrop.remove();
    onDelete?.();
  });
  backdrop.querySelector('[data-act="save"]').addEventListener('click', () => {
    const name = backdrop.querySelector('[data-field="name"]').value.trim();
    if (!name) { void showtimeAlert('Name is required.', { title: 'FURNITURE' }); return; }
    const occupiable = !!occInput.checked;
    const maxOccupancy = occupiable
      ? Math.max(1, Number(backdrop.querySelector('[data-field="maxOccupancy"]').value) || 1)
      : 0;
    const surface = backdrop.querySelector('[data-field="surface"]')?.value?.trim() || '';
    const nextLayer = backdrop.querySelector('[data-field="layer"]')?.value || 'furniture';
    backdrop.remove();
    onSave?.({
      kind: 'item',
      name,
      description: backdrop.querySelector('[data-field="description"]').value.trim(),
      surface,
      layer: nextLayer,
      condition: backdrop.querySelector('[data-field="condition"]').value,
      cells: [...selected],
      occupiable,
      maxOccupancy,
      contains: !!containsInput.checked,
      contentsVisible,
    });
  });
  setTimeout(() => backdrop.querySelector('[data-field="name"]')?.focus(), 0);
}

/** Door / opening dialog with see-through + locked toggles. */
export function openOpeningDialog({
  room,
  compass,
  link = null,
  existing = null,
  defaultCell = 'C',
  castMembers = [],
  onSave,
  onDelete,
}) {
  const isEdit = !!existing;
  const links = room.links || [];
  const roster = (castMembers || []).filter(c => {
    if (!c || c.priority === 'director') return false;
    return String(c.presence || 'inPlay') !== 'writtenOut';
  });
  const selectedAccess = new Set((existing?.accessCastIds || []).map(id => String(id)));
  const op = existing || {
    type: 'door',
    cell: defaultCell,
    label: '',
    peer: false,
    locked: false,
    keyHint: '',
    accessCastIds: [],
    travel: true,
  };

  const accessChecks = roster.length
    ? roster.map(c => `
        <label class="bst-check">
          <input type="checkbox" data-access="${esc(c.id)}" ${selectedAccess.has(String(c.id)) ? 'checked' : ''}>
          ${esc(c.name)}
        </label>`).join('')
    : '<div class="inv-modal-hint">No cast in play to list.</div>';

  const backdrop = buildModal(`
    <div class="inv-modal-title">${isEdit ? 'REFIT OPENING' : 'OPENING CLAIM'}</div>
    <div class="inv-modal-subtitle">— door / window / ascent / descent —</div>
    ${!isEdit ? `
      <div class="inv-modal-field">
        <label>Wall link</label>
        <select data-field="linkId">
          <option value="">— Choose linked wall —</option>
          ${links.map(l => {
            const n = getPlace(compass, l.toPlaceId);
            const dest = l.toPlaceId
              ? (n?.name || l.toPlaceId)
              : (l.external ? 'outside' : (l.wall === 'above' || l.wall === 'below' ? l.wall : '—'));
            return `<option value="${esc(l.id)}" ${link?.id === l.id ? 'selected' : ''}>${esc(l.wall)} → ${esc(dest)}</option>`;
          }).join('')}
        </select>
        <div class="inv-modal-hint">Create a wall link on the Stage panel first if the list is empty. Ascent/descent use above/below.</div>
      </div>` : ''}
    <div class="inv-modal-field">
      <label>Type</label>
      <div class="inv-cat-row">
        ${OPENING_TYPES.map(t =>
          `<button type="button" class="inv-cat-btn" data-type="${t}">${esc(t)}</button>`).join('')}
      </div>
      <div class="inv-modal-hint">Ascent / descent = stairs, ladders, trapdoors, hatches between floors.</div>
    </div>
    <div class="inv-modal-field"><label>Name / label</label>
      <input type="text" data-field="label" value="${esc(op.label)}" placeholder="Front door, attic stairs, cellar hatch…"></div>
    <div class="inv-modal-field"><label>Description</label>
      <textarea data-field="description" placeholder="What is noticed when this opening is observed…">${esc(op.description || '')}</textarea>
      <div class="inv-modal-hint">Referenced in narrative when the opening is seen or used.</div>
    </div>
    <div class="inv-modal-field"><label>Area (compass)</label>
      <select data-field="cell">
        ${CELLS.map(c => `<option value="${c}" ${c === (op.cell || defaultCell) ? 'selected' : ''}>${c}</option>`).join('')}
      </select>
      <div class="inv-modal-hint">Which compass area this opening sits on.</div>
    </div>
    <div class="inv-modal-field">
      <label>Leads to</label>
      <select data-field="toPlaceId">
        ${renderNeighborSelectGroups(compass, room, {
          selectedValue: link?.toPlaceId || (link?.external ? '__exterior__' : '__none__'),
          includeAuto: false,
          includeExterior: true,
          emptyLabel: '— Not linked yet —',
          escFn: esc,
        })}
      </select>
      <div class="inv-modal-hint">Connect this opening to a room in this unit, a corridor (e.g. Promenade), a neighboring unit, or Outside.</div>
    </div>
    <div class="inv-modal-field">
      <label>Access</label>
      <div class="bst-toggle-row">
        <label class="bst-check"><input type="checkbox" data-field="peer" ${op.peer ? 'checked' : ''}> See through</label>
        <label class="bst-check"><input type="checkbox" data-field="locked" ${op.locked ? 'checked' : ''}> Locked</label>
      </div>
      <div class="inv-modal-hint">See through peers the far side. Locked blocks travel unless someone is listed, has keys, a matching Usable, or forces the door in-scene.</div>
    </div>
    <div class="inv-modal-field" data-key-wrap style="${op.locked ? '' : 'display:none'}">
      <label>Key hint (usable item name)</label>
      <input type="text" data-field="keyHint" value="${esc(op.keyHint || '')}" placeholder="brass key, master card…">
      <div class="inv-modal-hint">Matches Inventory items tagged Usable.</div>
    </div>
    <div class="inv-modal-field" data-access-wrap style="${op.locked ? '' : 'display:none'}">
      <label>Access</label>
      <div class="bst-toggle-row" style="flex-wrap:wrap">${accessChecks}</div>
      <div class="inv-modal-hint">Listed people may enter this door without a key. Character Keyrings (Cast profile) cover whole buildings/rooms. Optional Usable key hint is still a spare way in for anyone else.</div>
    </div>
    <div class="inv-modal-actions">
      ${isEdit && onDelete ? '<button type="button" class="inv-btn" data-act="delete" style="margin-right:auto">Delete</button>' : ''}
      <button type="button" class="inv-btn" data-act="cancel">Cancel</button>
      <button type="button" class="inv-btn" data-act="save">${isEdit ? 'Save' : 'Add'}</button>
    </div>
  `);

  let type = op.type || 'door';
  const syncType = () => {
    backdrop.querySelectorAll('[data-type]').forEach(b => b.classList.toggle('on', b.dataset.type === type));
  };
  syncType();
  backdrop.querySelectorAll('[data-type]').forEach(b => {
    b.addEventListener('click', () => { type = b.dataset.type; syncType(); });
  });

  const keyWrap = backdrop.querySelector('[data-key-wrap]');
  const accessWrap = backdrop.querySelector('[data-access-wrap]');
  const lockedInput = backdrop.querySelector('[data-field="locked"]');
  const syncKey = () => {
    const on = lockedInput.checked;
    keyWrap.style.display = on ? '' : 'none';
    if (accessWrap) accessWrap.style.display = on ? '' : 'none';
  };
  lockedInput.addEventListener('change', syncKey);

  backdrop.querySelector('[data-act="cancel"]').addEventListener('click', () => backdrop.remove());
  backdrop.querySelector('[data-act="delete"]')?.addEventListener('click', async () => {
    if (!await showtimeConfirm('Delete opening?', { title: 'OPENING', danger: true, confirmLabel: 'Delete' })) return;
    backdrop.remove();
    onDelete?.();
  });
  backdrop.querySelector('[data-act="save"]').addEventListener('click', () => {
    const linkId = isEdit ? link.id : (backdrop.querySelector('[data-field="linkId"]')?.value || link?.id || '');
    if (!linkId) { void showtimeAlert('Choose a wall link first.', { title: 'OPENING' }); return; }
    const locked = !!lockedInput.checked;
    const accessCastIds = locked
      ? [...backdrop.querySelectorAll('[data-access]:checked')].map(el => String(el.dataset.access || '').trim()).filter(Boolean)
      : [];
    const payload = {
      linkId,
      type,
      label: backdrop.querySelector('[data-field="label"]').value.trim(),
      description: backdrop.querySelector('[data-field="description"]').value.trim(),
      cell: backdrop.querySelector('[data-field="cell"]').value,
      toPlaceId: backdrop.querySelector('[data-field="toPlaceId"]')?.value || '',
      peer: !!backdrop.querySelector('[data-field="peer"]').checked,
      locked,
      keyHint: locked ? backdrop.querySelector('[data-field="keyHint"]').value.trim() : '',
      accessCastIds,
      travel: type !== 'window' && type !== 'hole',
    };
    backdrop.remove();
    onSave?.(payload);
  });
}

function clampNum(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

/** Scale plan ink to the current SVG (suite canvases are large; 4px marks vanish). */
function planMetrics(pxPerUnit, viewMin = 360) {
  const px = Number.isFinite(pxPerUnit) && pxPerUnit > 0 ? pxPerUnit : 16;
  const view = Number.isFinite(viewMin) && viewMin > 0 ? viewMin : 360;
  return {
    px,
    wallHalf: clampNum(px * 0.08, 1.6, 3.2),
    wallHalfExt: clampNum(px * 0.11, 2.2, 4),
    windowGlass: clampNum(px * 0.07, 1.8, 3.4),
    windowTick: clampNum(px * 0.14, 3.2, 6),
    archJamb: clampNum(px * 0.18, 4, 9),
    passageJamb: clampNum(px * 0.1, 2.4, 5),
    minOpen: clampNum(Math.max(px * 0.85, view * 0.045), 18, 34),
    stairW: clampNum(px * 0.42, 9, 14),
    stairH: clampNum(px * 0.62, 13, 20),
    doorLeaf: clampNum(px * 0.55, 11, 18),
  };
}

function lerpPt(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function unitNormal(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return { dx, dy, len, nx: -dy / len, ny: dx / len, ux: dx / len, uy: dy / len };
}

function offsetSeg(p0, p1, dist) {
  const { nx, ny } = unitNormal(p0, p1);
  return {
    a: { x: p0.x + nx * dist, y: p0.y + ny * dist },
    b: { x: p1.x + nx * dist, y: p1.y + ny * dist },
  };
}

/** Rough monospace text width estimate in px — good enough for a label backdrop / clamp, no DOM measurement needed. */
function estTextWidth(text, fontPx) {
  return String(text || '').length * (Number(fontPx) || 9) * 0.62;
}

/**
 * Keep a centered text label's full extent inside [0, maxW] x [0, maxH] —
 * the suite SVG clips any paint outside its own box by default, so a stub
 * caption near the canvas edge (e.g. a door leading to a long place name
 * off-canvas) was getting silently chopped off instead of just repositioned.
 */
function clampLabelCenter(px, py, text, fontPx, maxW, maxH, margin = 3) {
  const halfW = estTextWidth(text, fontPx) / 2;
  const halfH = (Number(fontPx) || 9) / 2;
  const loX = Math.min(halfW + margin, maxW / 2);
  const loY = Math.min(halfH + margin, maxH / 2);
  return {
    x: Math.min(Math.max(px, loX), Math.max(loX, maxW - loX)),
    y: Math.min(Math.max(py, loY), Math.max(loY, maxH - loY)),
  };
}

/**
 * Translucent paper-colored backdrop sized to the text — rendered behind a
 * label so two captions landing close together (small rooms, dense wall
 * links) stay legible as stacked tags instead of visually merging into
 * illegible overlapping glyphs.
 */
function labelBackdropRect(cx, cy, text, fontPx, cls) {
  const w = estTextWidth(text, fontPx) + 4;
  const h = (Number(fontPx) || 9) + 3;
  return `<rect class="${cls}" x="${(cx - w / 2).toFixed(1)}" y="${(cy - h / 2).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="2" />`;
}

function openingCuts(a, b, openings, minPx) {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const minHalfT = (Number(minPx) || 32) / 2 / len;
  return (openings || []).map(op => {
    const mid = Number(op.along);
    const tMid = Number.isFinite(mid) ? mid : 0.5;
    let half = (Number(op.width) || 0.14) / 2;
    half = Math.max(half, minHalfT);
    half = Math.min(half, 0.42);
    return {
      t0: Math.max(0.02, tMid - half),
      t1: Math.min(0.98, tMid + half),
      op,
    };
  }).sort((x, y) => x.t0 - y.t0);
}

function solidRanges(cuts) {
  let cursor = 0;
  const solid = [];
  for (const cut of cuts) {
    if (cut.t0 > cursor + 0.002) solid.push([cursor, cut.t0]);
    cursor = Math.max(cursor, cut.t1);
  }
  if (cursor < 0.998) solid.push([cursor, 1]);
  if (!cuts.length) solid.push([0, 1]);
  return solid;
}

function subtractRange(solids, u0, u1) {
  if (!(u1 > u0 + 0.01)) return solids;
  const out = [];
  for (const [a, b] of solids) {
    if (b <= u0 + 0.002 || a >= u1 - 0.002) {
      out.push([a, b]);
      continue;
    }
    if (a < u0 - 0.002) out.push([a, Math.max(a, u0)]);
    if (b > u1 + 0.002) out.push([Math.min(b, u1), b]);
  }
  return out.filter(([a, b]) => b - a > 0.008);
}

function inwardToward(a, b, cx, cy) {
  const nrm = unitNormal(a, b);
  const mid = lerpPt(a, b, 0.5);
  return ((cx - mid.x) * nrm.nx + (cy - mid.y) * nrm.ny) >= 0 ? 1 : -1;
}

function destPlaceForOpening(compass, op, fallbackLink = null) {
  const toId = fallbackLink?.toPlaceId
    || (() => {
      if (!compass || !op?._ownerPlaceId || !op?._ownerLinkId) return '';
      const link = (compass.rooms?.[op._ownerPlaceId]?.links || []).find(l => l.id === op._ownerLinkId);
      return link?.toPlaceId || '';
    })();
  return toId ? getPlace(compass, toId) : null;
}

function fixtureLockTitle(op, { lockCast = [], compass = null, destPlace = null } = {}) {
  if (!op?.locked) return '';
  const dest = destPlace || destPlaceForOpening(compass, op);
  const keyHolders = dest
    ? (lockCast || [])
      .filter(c => (c.keyring || []).length && keyringUnlocksPlace(c.keyring, dest, compass))
      .map(c => c.name)
      .filter(Boolean)
    : [];
  return openingLockTitle(op, { castMembers: lockCast, keyHolders });
}

function withLockTitle(parts, lockTip, esc) {
  if (!lockTip) return parts;
  return [`<g class="bst-fp-lock-tip"><title>${esc(lockTip)}</title>`, ...parts, '</g>'];
}

function drawEdgePlan(a, b, openings, {
  m,
  selected = false,
  linked = false,
  isExternal = false,
  cx = 0,
  cy = 0,
  skipRange = null,
  skipRanges = null,
  threshold = false,
  thresholdRanges = null,
  fixturesOn = false,
  fixturePlaceOn = false,
  ownerPlaceId = '',
  ownerEdge = null,
  renderedOpeningIds = null,
  lockCast = [],
  compass = null,
  esc = (s) => String(s ?? ''),
} = {}) {
  const cuts = openingCuts(a, b, openings, m?.minOpen);
  let solids = solidRanges(cuts);
  const allSkips = Array.isArray(skipRanges)
    ? skipRanges
    : (skipRange ? [skipRange] : []);
  for (const [u0, u1] of allSkips) {
    solids = subtractRange(solids, u0, u1);
  }
  const allThresholds = Array.isArray(thresholdRanges)
    ? thresholdRanges
    : (threshold && skipRange ? [skipRange] : []);
  const parts = [];
  for (const [t0, t1] of allThresholds) {
    if (t1 > t0 + 0.02) {
      const p0 = lerpPt(a, b, t0);
      const p1 = lerpPt(a, b, t1);
      parts.push(`<line class="bst-suite-threshold-gap" x1="${p0.x.toFixed(1)}" y1="${p0.y.toFixed(1)}" x2="${p1.x.toFixed(1)}" y2="${p1.y.toFixed(1)}" />`);
      parts.push(`<line class="bst-suite-threshold" x1="${p0.x.toFixed(1)}" y1="${p0.y.toFixed(1)}" x2="${p1.x.toFixed(1)}" y2="${p1.y.toFixed(1)}" />`);
    }
  }
  for (const [t0, t1] of solids) {
    parts.push(...planWallSeg(lerpPt(a, b, t0), lerpPt(a, b, t1), { selected, linked, isExternal, m }));
  }
  // Empty (non-opening) wall stretches — click to place a new fixture there.
  if (fixturePlaceOn && ownerPlaceId && Number.isFinite(ownerEdge)) {
    for (const [t0, t1] of solids) {
      if (t1 - t0 < 0.03) continue;
      const p0 = lerpPt(a, b, t0);
      const p1 = lerpPt(a, b, t1);
      parts.push(`<line class="bst-suite-place-hit"
        x1="${p0.x.toFixed(1)}" y1="${p0.y.toFixed(1)}" x2="${p1.x.toFixed(1)}" y2="${p1.y.toFixed(1)}"
        data-action="suite-place-fixture" data-place="${esc(ownerPlaceId)}" data-edge="${ownerEdge}" />`);
    }
  }
  const nrm = unitNormal(a, b);
  const inward = inwardToward(a, b, cx, cy);
  for (const cut of cuts) {
    // A shared/linked wall's opening is synced onto both rooms' links (same
    // id) so each side keeps its own gap in the wall — but the glyph and
    // click target should only be painted once, or the duplicate silently
    // shadows clicks meant for the other copy (or for placing a new one
    // nearby).
    const alreadyDrawn = !!(cut.op?.id && renderedOpeningIds && renderedOpeningIds.has(cut.op.id));
    if (cut.op?.id && renderedOpeningIds && !alreadyDrawn) renderedOpeningIds.add(cut.op.id);
    if (alreadyDrawn) continue;
    const p0 = lerpPt(a, b, cut.t0);
    const p1 = lerpPt(a, b, cut.t1);
    const kind = openingVisualKind(cut.op.type, m);
    const lockTip = cut.op.locked ? fixtureLockTitle(cut.op, { lockCast, compass }) : '';
    parts.push(...withLockTitle(kind.drawGlyph({
      p0, p1, nrm, inward,
      gClass: `bst-fp-fixture ${kind.glyph}${cut.op.locked ? ' locked' : ''}`,
      isExternal,
    }), lockTip, esc));
    if (fixturesOn && cut.op._ownerPlaceId && cut.op._ownerLinkId && Number.isFinite(cut.op._ownerEdge)) {
      parts.push(`<line class="bst-suite-opening-hit"
        x1="${p0.x.toFixed(1)}" y1="${p0.y.toFixed(1)}" x2="${p1.x.toFixed(1)}" y2="${p1.y.toFixed(1)}"
        data-action="suite-drag-opening" data-place="${esc(cut.op._ownerPlaceId)}" data-link="${esc(cut.op._ownerLinkId)}"
        data-opn="${esc(cut.op.id)}" data-edge="${cut.op._ownerEdge}" data-type="${esc(cut.op.type || '')}"${lockTip ? ` title="${esc(lockTip)}"` : ''} />`);
    }
  }
  return parts;
}

/** Single-stroke wall segment (exterior slightly heavier). */
function planWallSeg(p0, p1, { selected = false, linked = false, isExternal = false } = {}) {
  const cls = `bst-fp-edge bst-fp-wall${selected ? ' sel' : ''}${linked ? ' linked' : ''}${isExternal ? ' external' : ''}`;
  return [
    `<line class="${cls}" x1="${p0.x.toFixed(1)}" y1="${p0.y.toFixed(1)}" x2="${p1.x.toFixed(1)}" y2="${p1.y.toFixed(1)}" />`,
  ];
}

/** Quiet stair: three treads + a small direction chevron. */
function stairPlanGlyph(p, up, { gClass, placeId, linkId, opnId, type, title, m = null }) {
  const w = m?.stairW ?? 11;
  const h = m?.stairH ?? 16;
  const x0 = p.x - w / 2;
  const y0 = p.y - h / 2;
  const lines = [];
  for (let i = 1; i < 3; i++) {
    const y = y0 + (h * i) / 3;
    lines.push(`<line class="${gClass}" x1="${x0.toFixed(1)}" y1="${y.toFixed(1)}" x2="${(x0 + w).toFixed(1)}" y2="${y.toFixed(1)}" />`);
  }
  const ax = p.x;
  const ay1 = up ? y0 + 2 : y0 + h - 2;
  const head = up ? -3 : 3;
  return `<g class="bst-fp-vertical bst-fp-stair" data-action="compass-drag-opening" data-place="${placeId}" data-link="${linkId}" data-opn="${opnId}" data-edge="-1" data-type="${type}" data-vertical="1">
    <rect class="${gClass} hit stair-hit" x="${(x0 - 2).toFixed(1)}" y="${(y0 - 2).toFixed(1)}" width="${(w + 4).toFixed(1)}" height="${(h + 4).toFixed(1)}" />
    <rect class="${gClass} stair-run" x="${x0.toFixed(1)}" y="${y0.toFixed(1)}" width="${w}" height="${h}" fill="none" />
    ${lines.join('\n')}
    <path class="${gClass} stair-arrow" fill="none" d="M ${(ax - 2.4).toFixed(1)},${(ay1 - head).toFixed(1)} L ${ax.toFixed(1)},${ay1.toFixed(1)} L ${(ax + 2.4).toFixed(1)},${(ay1 - head).toFixed(1)}" />
    <title>${title}</title>
  </g>`;
}

/** Resolve the wall-link for a footprint edge without sharing across split siblings. */
function linkForEdge(room, fp, edgeIdx) {
  const links = room.links || [];
  const byEdge = links.find(l => l.edge === edgeIdx);
  if (byEdge) return byEdge;
  let card = '';
  try { card = edgeCardinal(fp, edgeIdx); } catch { return null; }
  if (!card) return null;
  const n = (fp?.vertices || []).length || 0;
  let same = 0;
  for (let e = 0; e < n; e++) {
    try {
      if (edgeCardinal(fp, e) === card) same += 1;
    } catch { /* skip */ }
  }
  if (same !== 1) return null;
  return links.find(l => (l.edge == null || l.edge === '') && l.wall === card) || null;
}

/** Every non-vertical opening that belongs on this footprint edge (shared or exterior). */
function openingsOnFootprintEdge(room, fp, edgeIdx) {
  const seen = new Set();
  const out = [];
  const add = (op, link) => {
    if (!op?.id || seen.has(op.id)) return;
    if (isVerticalOpeningType(op.type)) return;
    seen.add(op.id);
    // Tag ownership so callers (e.g. suite fixture dragging) can trace an
    // opening back to the room/link/edge that actually stores it — needed
    // when this list is built from a peer's absorbed shared-wall openings.
    out.push({ ...op, _ownerPlaceId: room?.id || '', _ownerLinkId: link?.id || '', _ownerEdge: edgeIdx });
  };
  for (const link of room?.links || []) {
    if (link.edge === edgeIdx) (link.openings || []).forEach(op => add(op, link));
  }
  // Legacy cardinal-only links (no explicit edge) only resolve when exactly one
  // edge shares that cardinal — linkForEdge enforces that uniqueness guard so a
  // split wall's two segments never both pull the same pre-split openings.
  const via = linkForEdge(room, fp, edgeIdx);
  (via?.openings || []).forEach(op => add(op, via));
  return out;
}

/** Quiet architectural plan symbols — readable types, low ink. */
function openingVisualKind(opType, m = null) {
  const t = String(opType || 'door');
  const glass = m?.windowGlass ?? 2.2;
  const archJ = m?.archJamb ?? 5;
  const passJ = m?.passageJamb ?? 3;
  const doorLeaf = m?.doorLeaf ?? 14;
  if (t === 'window' || t === 'hole') {
    return {
      className: 'peer window',
      glyph: 'window',
      drawGlyph: ({ p0, p1, gClass }) => {
        const a = offsetSeg(p0, p1, glass);
        const b = offsetSeg(p0, p1, -glass);
        return [
          `<line class="${gClass}" x1="${a.a.x.toFixed(1)}" y1="${a.a.y.toFixed(1)}" x2="${a.b.x.toFixed(1)}" y2="${a.b.y.toFixed(1)}" />`,
          `<line class="${gClass}" x1="${b.a.x.toFixed(1)}" y1="${b.a.y.toFixed(1)}" x2="${b.b.x.toFixed(1)}" y2="${b.b.y.toFixed(1)}" />`,
        ];
      },
    };
  }
  if (t === 'arch') {
    return {
      className: 'entry arch',
      glyph: 'arch',
      drawGlyph: ({ p0, p1, nrm, inward, gClass }) => {
        const j = archJ;
        const ix = nrm.nx * inward;
        const iy = nrm.ny * inward;
        return [
          `<line class="${gClass}" x1="${p0.x.toFixed(1)}" y1="${p0.y.toFixed(1)}" x2="${(p0.x + ix * j).toFixed(1)}" y2="${(p0.y + iy * j).toFixed(1)}" />`,
          `<line class="${gClass}" x1="${p1.x.toFixed(1)}" y1="${p1.y.toFixed(1)}" x2="${(p1.x + ix * j).toFixed(1)}" y2="${(p1.y + iy * j).toFixed(1)}" />`,
          `<path class="${gClass}" fill="none" d="M ${(p0.x + ix * j).toFixed(1)},${(p0.y + iy * j).toFixed(1)} Q ${((p0.x + p1.x) / 2 + ix * (j + 3)).toFixed(1)},${((p0.y + p1.y) / 2 + iy * (j + 3)).toFixed(1)} ${(p1.x + ix * j).toFixed(1)},${(p1.y + iy * j).toFixed(1)}" />`,
        ];
      },
    };
  }
  if (t === 'passage') {
    return {
      className: 'entry passage',
      glyph: 'passage',
      drawGlyph: ({ p0, p1, nrm, inward, gClass }) => {
        const j = passJ;
        const ix = nrm.nx * inward;
        const iy = nrm.ny * inward;
        return [
          `<line class="${gClass}" x1="${p0.x.toFixed(1)}" y1="${p0.y.toFixed(1)}" x2="${(p0.x + ix * j).toFixed(1)}" y2="${(p0.y + iy * j).toFixed(1)}" />`,
          `<line class="${gClass}" x1="${p1.x.toFixed(1)}" y1="${p1.y.toFixed(1)}" x2="${(p1.x + ix * j).toFixed(1)}" y2="${(p1.y + iy * j).toFixed(1)}" />`,
          `<line class="${gClass} threshold" x1="${p0.x.toFixed(1)}" y1="${p0.y.toFixed(1)}" x2="${p1.x.toFixed(1)}" y2="${p1.y.toFixed(1)}" />`,
        ];
      },
    };
  }
  return {
    className: 'entry door',
    glyph: 'door',
    drawGlyph: ({ p0, p1, nrm, inward, gClass }) => {
      const opening = Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1;
      const r = clampNum(opening * 0.55, 10, doorLeaf);
      const along = lerpPt(p0, p1, Math.min(0.95, r / opening));
      const ix = nrm.nx * inward;
      const iy = nrm.ny * inward;
      const tipx = p0.x + ix * r;
      const tipy = p0.y + iy * r;
      const sweep = inward >= 0 ? 1 : 0;
      return [
        `<circle class="${gClass} door-hinge" cx="${p0.x.toFixed(1)}" cy="${p0.y.toFixed(1)}" r="1.3" />`,
        `<line class="${gClass} door-leaf" x1="${p0.x.toFixed(1)}" y1="${p0.y.toFixed(1)}" x2="${tipx.toFixed(1)}" y2="${tipy.toFixed(1)}" />`,
        `<path class="${gClass} door-swing" fill="none" d="M ${along.x.toFixed(1)},${along.y.toFixed(1)} A ${r.toFixed(1)} ${r.toFixed(1)} 0 0 ${sweep} ${tipx.toFixed(1)},${tipy.toFixed(1)}" />`,
      ];
    },
  };
}

export function cellSummaryBits(room, cellId) {
  const n = cellContentCount(room.cells?.[cellId], { room, cellId });
  const nOcc = (room.occupants || []).filter(o => o.cell === cellId).length;
  let nDoor = 0;
  for (const link of room.links || []) {
    for (const op of link.openings || []) {
      if (op.cell === cellId) nDoor += 1;
    }
  }
  return { n, nOcc, nDoor };
}

function peopleInPlace(compass, placeId) {
  const names = [];
  const seen = new Set();
  const add = (raw) => {
    const n = String(raw || '').trim();
    if (!n) return;
    const k = n.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    names.push(n);
  };
  const room = compass?.rooms?.[placeId];
  for (const o of room?.occupants || []) add(o.name);
  try {
    for (const p of listSonarPingsInPlace(compass, placeId)) add(p.name);
  } catch { /* ignore */ }
  return names;
}

function openingDestCaption(link, compass) {
  if (!link) return '';
  const toId = String(link.toPlaceId || '').trim();
  if (toId) {
    const dest = compass ? getPlace(compass, toId) : null;
    return (dest && disambiguatedPlaceName(compass, dest)) || dest?.name || toId;
  }
  if (link.external) return 'outside';
  return 'unlinked';
}

function openingLabelSvg(mid, nrm, inward, text, locked, escFn) {
  const label = String(text || '').trim();
  if (!label) return '';
  const cap = locked ? `${label} · locked` : label;
  const ox = (nrm?.nx || 0) * (inward || 1) * 11;
  const oy = (nrm?.ny || 0) * (inward || 1) * 11;
  return `<text class="bst-fp-exit-label" x="${(mid.x + ox).toFixed(1)}" y="${(mid.y + oy).toFixed(1)}" text-anchor="middle" dominant-baseline="middle">${escFn(cap)}</text>`;
}

function occupancyDotsSvg(cx, cy, names, { className = 'bst-suite-occ', r = 2.8, dy = 11 } = {}) {
  const list = (names || []).slice(0, 6);
  if (!list.length) return '';
  const n = list.length;
  const spread = n === 1 ? 0 : 7;
  let html = '';
  for (let i = 0; i < n; i++) {
    const dx = n === 1 ? 0 : (i - (n - 1) / 2) * spread;
    html += `<circle class="${className}" cx="${(cx + dx).toFixed(1)}" cy="${(cy + dy).toFixed(1)}" r="${r}"><title>${esc(list[i])}</title></circle>`;
  }
  return html;
}

function collectUnitClusters(compass, host, roomBounds, { children = [], layout = {}, storyMap = {} } = {}) {
  if (host?.kind !== 'building') return [];
  const units = listSuiteUnits(compass, host.id);
  const startX = Number.isFinite(roomBounds?.maxX) ? roomBounds.maxX + 3 : 0;
  const baseY = Number.isFinite(roomBounds?.minY) ? roomBounds.minY : 0;
  const storyCursorX = {};
  const byChildId = Object.fromEntries((children || []).map(c => [c.id, c]));
  const rawHostLayout = host?.suiteLayout && typeof host.suiteLayout === 'object' ? host.suiteLayout : {};
  const out = [];
  for (const u of units) {
    const kids = listSuiteChildren(compass, u.id);
    const uStory = Number(storyMap[u.id]) || 0;
    const curX = Number.isFinite(storyCursorX[uStory]) ? storyCursorX[uStory] : startX;
    if (!kids.length) {
      const explicitPose = rawHostLayout[u.id];
      const ox = explicitPose && Number.isFinite(Number(explicitPose.x)) ? Number(explicitPose.x) : curX;
      const oy = explicitPose && Number.isFinite(Number(explicitPose.y)) ? Number(explicitPose.y) : baseY;
      const sil = suiteUnitOuterSilhouette(u, []);
      const local = sil.bounds || { minX: 0, maxX: 8, minY: 0, maxY: 8 };
      out.push({
        unit: u,
        kids: [],
        layout: {},
        rings: sil.rings,
        walls: sil.walls,
        story: uStory,
        ox,
        oy,
        minX: local.minX + ox,
        maxX: local.maxX + ox,
        minY: local.minY + oy,
        maxY: local.maxY + oy,
      });
      if (!explicitPose) storyCursorX[uStory] = curX + (local.maxX - local.minX) + 2.5;
      continue;
    }
    const sil = suiteUnitOuterSilhouette(u, kids);
    const local = sil.bounds || suiteWorldBounds(sil.alignedKids, sil.alignedLayout, 0);
    const explicitPose = rawHostLayout[u.id];
    let ox = null;
    let oy = null;
    if (explicitPose && Number.isFinite(Number(explicitPose.x)) && Number.isFinite(Number(explicitPose.y))) {
      ox = Number(explicitPose.x) - local.minX;
      oy = Number(explicitPose.y) - local.minY;
    } else {
      // Check if any room in this nested unit has a lateral link to a building room
      for (const kid of sil.alignedKids) {
        const kidPose = sil.alignedLayout[kid.id] || { x: 0, y: 0, rot: 0 };
        const kidBox = worldAabb(kid, kidPose);
        for (const link of kid.links || []) {
          const peer = byChildId[link?.toPlaceId];
          if (!peer) continue;
          const peerBox = worldAabb(peer, layout[peer.id] || { x: 0, y: 0, rot: 0 });
          const w = String(link.wall || '').toUpperCase();
          if (w === 'W') {
            ox = peerBox.maxX - kidBox.minX;
            oy = peerBox.minY - kidBox.minY;
            break;
          }
          if (w === 'E') {
            ox = peerBox.minX - kidBox.maxX;
            oy = peerBox.minY - kidBox.minY;
            break;
          }
          if (w === 'N') {
            ox = peerBox.minX - kidBox.minX;
            oy = peerBox.maxY - kidBox.minY;
            break;
          }
          if (w === 'S') {
            ox = peerBox.minX - kidBox.minX;
            oy = peerBox.minY - kidBox.maxY;
            break;
          }
        }
        if (ox != null) break;
      }
      if (ox == null) {
        const kidById = Object.fromEntries(sil.alignedKids.map(k => [k.id, k]));
        for (const peer of children || []) {
          const peerBox = worldAabb(peer, layout[peer.id] || { x: 0, y: 0, rot: 0 });
          for (const link of peer.links || []) {
            const kid = kidById[link?.toPlaceId];
            if (!kid) continue;
            const kidBox = worldAabb(kid, sil.alignedLayout[kid.id] || { x: 0, y: 0, rot: 0 });
            const w = String(link.wall || '').toUpperCase();
            if (w === 'E') {
              ox = peerBox.maxX - kidBox.minX;
              oy = peerBox.minY - kidBox.minY;
              break;
            }
            if (w === 'W') {
              ox = peerBox.minX - kidBox.maxX;
              oy = peerBox.minY - kidBox.minY;
              break;
            }
            if (w === 'S') {
              ox = peerBox.minX - kidBox.minX;
              oy = peerBox.maxY - kidBox.minY;
              break;
            }
            if (w === 'N') {
              ox = peerBox.minX - kidBox.minX;
              oy = peerBox.minY - kidBox.maxY;
              break;
            }
          }
          if (ox != null) break;
        }
      }
      if (ox == null || oy == null) {
        ox = curX - local.minX;
        oy = baseY - local.minY;
        storyCursorX[uStory] = curX + (local.maxX - local.minX) + 2.5;
      }
    }
    out.push({
      unit: u,
      kids: sil.alignedKids,
      layout: sil.alignedLayout,
      rings: sil.rings,
      walls: sil.walls,
      story: uStory,
      ox,
      oy,
      minX: local.minX + ox,
      maxX: local.maxX + ox,
      minY: local.minY + oy,
      maxY: local.maxY + oy,
    });
  }
  return out;
}

function expandBounds(bounds, extra) {
  const box = bounds && Number.isFinite(bounds.minX)
    ? { ...bounds }
    : { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  for (const b of extra || []) {
    if (!b || !Number.isFinite(b.minX)) continue;
    box.minX = Math.min(box.minX, b.minX);
    box.maxX = Math.max(box.maxX, b.maxX);
    box.minY = Math.min(box.minY, b.minY);
    box.maxY = Math.max(box.maxY, b.maxY);
  }
  return box;
}

function padBounds(bounds, pad = 1.2) {
  if (!Number.isFinite(bounds?.minX)) return { minX: 0, maxX: 10, minY: 0, maxY: 10 };
  return {
    minX: bounds.minX - pad,
    maxX: bounds.maxX + pad,
    minY: bounds.minY - pad,
    maxY: bounds.maxY + pad,
  };
}

/**
 * Unified Selected Wall Inspector in Suite Walls mode —
 * shows plain-language wall adjacency (floorplan contact, bordering corridor/unit,
 * outside exterior, or unlinked), a single immediate `Borders / Connects to`
 * selector, and one-click door/window chips.
 */
function renderSuiteWallLinksPanel({ compass, unit, byId, pairsByRoomEdge, selectedEdge, esc }) {
  if (!selectedEdge) return '';
  const room = getPlace(compass, selectedEdge.placeId);
  if (!room || !byId[room.id]) return '';
  const edgeIdx = Number(selectedEdge.edge);
  if (!Number.isFinite(edgeIdx)) return '';
  const fp = room.footprint || {};
  const card = edgeCardinal(fp, edgeIdx) || 'N';
  const cardWord = ({ N: 'North', E: 'East', S: 'South', W: 'West' })[card] || card;

  const edgePairs = (pairsByRoomEdge && pairsByRoomEdge.get(`${room.id}#${edgeIdx}`)) || [];
  const contactPeerIds = [...new Set(edgePairs.map(p => (p.aId === room.id ? p.bId : p.aId)).filter(Boolean))];
  const contactPeerNames = contactPeerIds.map(id => getPlace(compass, id)?.name || id);

  const edgeLinks = (room.links || []).filter(l => Number.isFinite(l.edge) && Number(l.edge) === edgeIdx);
  const primaryLink = edgeLinks.find(l => l.toPlaceId && contactPeerIds.includes(l.toPlaceId))
    || edgeLinks.find(l => l.toPlaceId)
    || edgeLinks[0]
    || linkForEdge(room, fp, edgeIdx);

  const openings = openingsOnFootprintEdge(room, fp, edgeIdx);
  const peeks = gatherPeerViews(compass, room).filter(p => !primaryLink || p.wall === primaryLink.wall || p.wall === card);
  const renderPeers = () => {
    const vis = peeks.filter(p => p.visible);
    if (!vis.length) return '';
    const bits = vis.map(p => {
      const rows = [...(p.items || []).map(i => i.name), ...(p.occupants || []).map(o => o.name + '*')];
      return `${esc(p.toName)}${p.locked ? ' (locked)' : ''}: ${rows.length ? esc(rows.join(', ')) : '(empty wall)'}`;
    }).join(' · ');
    return `<div class="bst-hint" style="margin-top:4px"><strong>Sightline:</strong> ${bits}</div>`;
  };

  let statusHtml = '';
  let selectedTarget = '__none__';
  if (contactPeerIds.length > 1) {
    statusHtml = `<span class="bst-chip on" title="Touching multiple rooms in this suite">Shared with ${esc(contactPeerNames.join(' + '))}</span>`;
    selectedTarget = (primaryLink?.toPlaceId && contactPeerIds.includes(primaryLink.toPlaceId))
      ? primaryLink.toPlaceId
      : '__auto__';
  } else if (contactPeerIds.length === 1) {
    statusHtml = `<span class="bst-chip on" title="Touching sibling room on the floorplan">Shared with ${esc(contactPeerNames[0])}</span>`;
    selectedTarget = contactPeerIds[0];
  } else if (primaryLink?.external) {
    const peer = primaryLink.toPlaceId ? getPlace(compass, primaryLink.toPlaceId) : null;
    const where = peer?.name ? ` · ${esc(peer.name)}` : '';
    statusHtml = `<span class="bst-chip on" title="Faces outdoors">Exterior wall${where}</span>`;
    selectedTarget = '__exterior__';
  } else if (primaryLink?.toPlaceId) {
    const peer = getPlace(compass, primaryLink.toPlaceId);
    statusHtml = `<span class="bst-chip on" title="Borders another corridor, unit, or room">Borders ${esc(peer?.name || primaryLink.toPlaceId)}</span>`;
    selectedTarget = primaryLink.toPlaceId;
  } else {
    statusHtml = `<span class="bst-k">Unlinked outer wall</span>`;
    selectedTarget = '__none__';
  }

  const styleChip = primaryLink?.sharedStyle === 'threshold'
    ? '<span class="bst-chip" title="Open threshold">Open threshold</span>'
    : (primaryLink?.sharedStyle === 'open'
      ? '<span class="bst-chip" title="Wall removed">Open wall</span>'
      : '');

  const autoLabel = contactPeerNames.length
    ? `Auto — Floorplan contact (${contactPeerNames.join(' + ')})`
    : 'Auto — Detect from floorplan';

  const opnChips = openings.map(op => {
    const ownerLink = (room.links || []).find(l => (l.openings || []).some(o => o.id === op.id)) || primaryLink;
    const destPlace = ownerLink?.toPlaceId ? getPlace(compass, ownerLink.toPlaceId) : null;
    const destText = destPlace
      ? ` → ${destPlace.name}`
      : (ownerLink?.external ? ' → Outside' : '');
    const lockBit = op.locked ? ' 🔒' : '';
    const title = `${op.label || op.type}${destText}${lockBit}`;
    return `<span class="bst-chip bst-wall-opn-chip">
      <span>${esc(title)}</span>
      <button type="button" class="bst-btn" data-action="suite-edit-opn" data-place="${esc(room.id)}" data-link="${esc(ownerLink?.id || '')}" data-opn="${esc(op.id)}" data-unit="${esc(unit.id)}" title="Edit opening">Edit</button>
      <button type="button" class="bst-btn danger" data-action="suite-del-opn" data-place="${esc(room.id)}" data-link="${esc(ownerLink?.id || '')}" data-opn="${esc(op.id)}" data-unit="${esc(unit.id)}" title="Remove opening">✕</button>
    </span>`;
  }).join('');

  const userDesc = primaryLink?.description && primaryLink.description !== 'suite snap'
    ? primaryLink.description
    : '';

  return `<div class="bst-suite-walllinks">
    <div class="bst-row bst-wall-line">
      <strong>${esc(room.name)} · ${esc(cardWord)} wall</strong>
      ${statusHtml}
      ${styleChip}
    </div>
    <div class="bst-row bst-wall-line">
      <span class="bst-k bst-wall-label">Borders / Connects to</span>
      <select class="bst-input bst-wall-target" data-role="suite-wall-target" data-place="${esc(room.id)}" data-edge="${edgeIdx}" data-link="${esc(primaryLink?.id || '')}" data-unit="${esc(unit.id)}">
        ${renderNeighborSelectGroups(compass, room, {
          selectedValue: selectedTarget,
          includeAuto: contactPeerIds.length > 0,
          autoLabel,
          includeExterior: true,
          emptyLabel: '— Unlinked outer wall —',
          escFn: esc,
        })}
      </select>
    </div>
    <div class="bst-row bst-wall-line">
      <span class="bst-k bst-wall-label">Fixtures on wall</span>
      ${opnChips || '<span class="bst-k bst-wall-label">Solid wall</span>'}
      <button type="button" class="bst-btn" data-action="suite-wall-quick-opn" data-type="door" data-place="${esc(room.id)}" data-edge="${edgeIdx}" data-unit="${esc(unit.id)}" title="Add a door on this wall">+ Door</button>
      <button type="button" class="bst-btn" data-action="suite-wall-quick-opn" data-type="window" data-place="${esc(room.id)}" data-edge="${edgeIdx}" data-unit="${esc(unit.id)}" title="Add a window on this wall">+ Window</button>
      <button type="button" class="bst-btn" data-action="suite-wl-add-opening" data-link="${esc(primaryLink?.id || '')}" data-place="${esc(room.id)}" data-edge="${edgeIdx}" data-unit="${esc(unit.id)}" title="Open full fixture dialog (arch, lock, key hint…)">+ More…</button>
    </div>
    ${userDesc ? `<div class="bst-hint">${esc(userDesc)}</div>` : ''}
    ${renderPeers()}
  </div>`;
}

function renderFixtureRoomLink({ compass, unit, children, lastOpening, esc }) {
  const kids = Array.isArray(children) ? children : [];
  const openings = [];
  for (const room of kids) {
    for (const link of room.links || []) {
      for (const op of link.openings || []) {
        openings.push({
          room,
          link,
          op,
          dest: link.toPlaceId
            ? (getPlace(compass, link.toPlaceId)?.name || link.toPlaceId)
            : (link.external ? 'Outside' : ''),
          exterior: !!link.external,
        });
      }
    }
  }
  if (!openings.length) {
    return '<span class="bst-k">Click any wall to place a door or window — it automatically connects to the room or corridor on the other side.</span>';
  }
  const pick = (lastOpening?.opnId && openings.find(o => o.op.id === lastOpening.opnId && o.room.id === lastOpening.placeId))
    || (lastOpening?.linkId && openings.find(o => o.link.id === lastOpening.linkId && o.room.id === lastOpening.placeId))
    || openings.find(o => !o.link.toPlaceId && !o.link.external)
    || openings[0];
  const selKey = pick ? `${pick.room.id}|${pick.link.id}|${pick.op.id}` : '';
  const selectedTarget = pick?.link?.toPlaceId
    ? pick.link.toPlaceId
    : (pick?.link?.external ? '__exterior__' : '__none__');
  return `
    <label class="bst-k">Selected fixture
      <select class="bst-input" data-role="suite-opn-pick" data-unit="${esc(unit.id)}">
        ${openings.map(o => {
          const key = `${o.room.id}|${o.link.id}|${o.op.id}`;
          const wallBit = o.link.wall ? ` (${o.link.wall})` : '';
          const label = `${o.room.name}${wallBit} · ${o.op.type}${o.op.label ? ` "${o.op.label}"` : ''}${o.dest ? ` → ${o.dest}` : ' · unlinked'}`;
          return `<option value="${esc(key)}" ${key === selKey ? 'selected' : ''}>${esc(label)}</option>`;
        }).join('')}
      </select>
    </label>
    <label class="bst-k">Leads to
      <select class="bst-input" data-role="suite-opn-target" data-unit="${esc(unit.id)}" data-place="${esc(pick?.room?.id || '')}" data-link="${esc(pick?.link?.id || '')}" data-opn="${esc(pick?.op?.id || '')}">
        ${pick ? renderNeighborSelectGroups(compass, pick.room, {
          selectedValue: selectedTarget,
          includeAuto: true,
          autoLabel: 'Auto (from floorplan contact)',
          includeExterior: true,
          emptyLabel: '— Unlinked —',
          escFn: esc,
        }) : ''}
      </select>
    </label>
    ${pick ? `
      <button type="button" class="bst-btn" data-action="suite-edit-opn" data-place="${esc(pick.room.id)}" data-link="${esc(pick.link.id)}" data-opn="${esc(pick.op.id)}" data-unit="${esc(unit.id)}">Edit…</button>
      <button type="button" class="bst-btn danger" data-action="suite-del-opn" data-place="${esc(pick.room.id)}" data-link="${esc(pick.link.id)}" data-opn="${esc(pick.op.id)}" data-unit="${esc(unit.id)}">Remove</button>
    ` : ''}
  `;
}

export function renderSuiteFloorplan(unit, compass, {
  mode = 'browse',
  esc,
  focusChildId = '',
  selectedShared = null,
  selectedEdge = null,
  suiteSelEdges = [],
  fixtureAct = 'place',
  herePlaceId = '',
  hereCell = 'C',
  lastOpening = null,
  storyFocus = 'upper',
  lockCast = [],
  hideArrange = false,
} = {}) {
  // Suite view uses each room's real footprint, *unless* Align has cached a
  // welded, gap-free "visual" shape for it on the unit — that override only
  // affects this combined rendering; the room's own floorplan editor always
  // shows its true, authored proportions.
  const visualFootprints = unit.suiteVisualFootprints || {};
  const children = listSuiteChildren(compass, unit.id).map(room => {
    const override = visualFootprints[room.id];
    return override ? { ...room, footprint: override } : room;
  });
  const nestedUnits = unit.kind === 'building' ? listSuiteUnits(compass, unit.id) : [];
  if (!children.length && !nestedUnits.length) {
    const canPopulate = unit.kind === 'building';
    const emptyHint = canPopulate
      ? 'No rooms or apartment units under this building yet — pick a Category and click Populate, or nest Room / Hall children manually.'
      : 'No rooms yet — nest Room / Hall children under this place.';
    return `<div class="bst-suite" data-role="suite-canvas" data-unit="${esc(unit.id)}">
      ${canPopulate ? `<div class="bst-suite-toolbar">
        <label class="bst-k" style="display:inline-flex;align-items:center;gap:6px">Category
          <select class="bst-input bst-set-kind-sel" data-role="suite-category-select" data-place="${esc(unit.id)}">
            ${renderSuiteCategoryOptions(unit.category || '', esc, { hostKind: 'building', hostName: unit.name })}
          </select>
        </label>
        <button type="button" class="bst-btn gold" data-action="compass-populate-category" data-place="${esc(unit.id)}" title="Fill this building with rooms for the chosen category">Populate</button>
      </div>` : ''}
      <div class="bst-empty">${emptyHint}</div>
    </div>`;
  }
  const { layout } = children.length ? ensureSuiteChildPoses(unit, children, compass) : { layout: {} };
  const storyMap = (children.length || nestedUnits.length)
    ? suiteStoryMap(compass, [...children, ...nestedUnits])
    : {};
  const hasStack = suiteHasStackedStories(storyMap);
  const storyVals = Object.values(storyMap).filter(v => Number.isFinite(Number(v))).map(Number);
  const minStory = storyVals.length ? Math.min(0, ...storyVals) : 0;
  const maxStory = storyVals.length ? Math.max(0, ...storyVals) : 0;
  const uniqueStories = [...new Set(storyVals)].sort((a, b) => a - b);
  let focusedStory = maxStory;
  if (storyFocus === 'lower') {
    focusedStory = minStory;
  } else if (storyFocus === 'upper') {
    focusedStory = maxStory;
  } else if (storyFocus != null && storyFocus !== '' && Number.isFinite(Number(storyFocus))) {
    focusedStory = Math.max(minStory, Math.min(maxStory, Math.round(Number(storyFocus))));
  }
  const focusUpper = focusedStory >= maxStory;
  const storyTier = (id) => {
    if (!hasStack) return 'focus';
    const s = Number(storyMap[id]) || 0;
    if (s < focusedStory) return 'lower';
    if (s > focusedStory) return 'upper';
    return 'focus';
  };
  const isDimmed = (id) => storyTier(id) !== 'focus';
  const tierRank = (id) => {
    const t = storyTier(id);
    return t === 'lower' ? 0 : (t === 'focus' ? 1 : 2);
  };
  const paintOrder = [...children].sort((a, b) => {
    const ra = tierRank(a.id);
    const rb = tierRank(b.id);
    if (ra !== rb) return ra - rb;
    const sa = Number(storyMap[a.id]) || 0;
    const sb = Number(storyMap[b.id]) || 0;
    if (sa !== sb) return sa - sb;
    return String(a.name || '').localeCompare(String(b.name || ''));
  });
  const roomBounds = children.length
    ? suiteWorldBounds(children, layout, 0)
    : { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  const unitClusters = collectUnitClusters(compass, unit, {
    maxX: Number.isFinite(roomBounds.maxX) ? roomBounds.maxX : 0,
    minY: Number.isFinite(roomBounds.minY) ? roomBounds.minY : 0,
  }, { children, layout, storyMap });
  const rawBounds = padBounds(expandBounds(roomBounds, unitClusters), 2.2);
  const rawW = Math.max(4, rawBounds.maxX - rawBounds.minX);
  const rawH = Math.max(4, rawBounds.maxY - rawBounds.minY);
  const svgW = 420;
  const svgH = Math.max(240, Math.round(svgW * (rawH / rawW)));
  const targetRatio = svgH / svgW;
  const bounds = { ...rawBounds };
  if (rawH / rawW < targetRatio) {
    const extraH = rawW * targetRatio - rawH;
    bounds.minY -= extraH / 2;
    bounds.maxY += extraH / 2;
  } else if (rawH / rawW > targetRatio) {
    const extraW = rawH / targetRatio - rawW;
    bounds.minX -= extraW / 2;
    bounds.maxX += extraW / 2;
  }
  const bw = Math.max(4, bounds.maxX - bounds.minX);
  const bh = Math.max(4, bounds.maxY - bounds.minY);
  const pairs = findContactingPairs(children, layout, undefined, storyMap);
  const contactEdges = new Set(pairs.flatMap(p => [
    `${p.aId}:${p.wallA}`,
    `${p.bId}:${p.wallB}`,
  ]));
  const byId = Object.fromEntries(children.map(c => [c.id, c]));
  const modeSafe = hideArrange && mode === 'arrange' ? 'browse' : mode;
  const wallsOn = modeSafe === 'walls';
  const arrangeOn = modeSafe === 'arrange';
  const fixturesOn = modeSafe === 'fixtures';
  const browseOn = modeSafe === 'browse';
  const siblingIds = new Set(children.map(c => c.id));
  for (const uc of unitClusters) {
    siblingIds.add(uc.unit.id);
    for (const k of uc.kids || []) siblingIds.add(k.id);
  }
  if (unit.id) siblingIds.add(unit.id);
  const fixAct = fixtureAct === 'remove' ? 'remove' : (fixtureAct === 'place' ? 'place' : '');
  const fixturePlaceOn = fixturesOn && fixAct === 'place';
  const px = Math.min(svgW / bw, svgH / bh);
  const m = planMetrics(px, Math.min(svgW, svgH));

  const toSvg = (wx, wy) => ({
    x: ((wx - bounds.minX) / bw) * svgW,
    y: ((wy - bounds.minY) / bh) * svgH,
  });

  const pairsByRoomEdge = new Map();
  const pushPairKey = (key, pair) => {
    const arr = pairsByRoomEdge.get(key) || [];
    if (!arr.includes(pair)) arr.push(pair);
    pairsByRoomEdge.set(key, arr);
  };
  for (const pair of pairs) {
    pushPairKey(`${pair.aId}:${pair.wallA}`, pair);
    pushPairKey(`${pair.bId}:${pair.wallB}`, pair);
    if (Number.isFinite(pair.edgeA)) pushPairKey(`${pair.aId}#${pair.edgeA}`, pair);
    if (Number.isFinite(pair.edgeB)) pushPairKey(`${pair.bId}#${pair.edgeB}`, pair);
  }
  const pairPrimaryId = pair => (String(pair.aId) < String(pair.bId) ? pair.aId : pair.bId);

  const overlapWorld = (pair) => {
    const a = byId[pair.aId];
    const b = byId[pair.bId];
    if (!a || !b) return null;
    const poseA = layout[pair.aId] || { x: 0, y: 0, rot: 0 };
    const poseB = layout[pair.bId] || { x: 0, y: 0, rot: 0 };
    if (Number.isFinite(pair.edgeA) && Number.isFinite(pair.edgeB)) {
      const seg = sharedContactSegment(a, poseA, pair.edgeA, b, poseB, pair.edgeB);
      if (seg) return seg;
    }
    const boxA = worldAabb(a, poseA);
    const boxB = worldAabb(b, poseB);
    if (pair.wallA === 'E' || pair.wallA === 'W') {
      const xSeam = pair.wallA === 'E'
        ? (boxA.maxX + boxB.minX) / 2
        : (boxA.minX + boxB.maxX) / 2;
      const y0 = Math.max(boxA.minY, boxB.minY);
      const y1 = Math.min(boxA.maxY, boxB.maxY);
      if (!(y1 > y0 + 0.05)) return null;
      return { p1: { x: xSeam, y: y0 }, p2: { x: xSeam, y: y1 } };
    }
    const ySeam = pair.wallA === 'S'
      ? (boxA.maxY + boxB.minY) / 2
      : (boxA.minY + boxB.maxY) / 2;
    const x0 = Math.max(boxA.minX, boxB.minX);
    const x1 = Math.min(boxA.maxX, boxB.maxX);
    if (!(x1 > x0 + 0.05)) return null;
    return { p1: { x: x0, y: ySeam }, p2: { x: x1, y: ySeam } };
  };

  const tOnEdge = (a, b, p) => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy || 1;
    return Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  };

  const makeLayerBucket = () => ({
    fills: '',
    unitInk: '',
    planInk: '',
    stairs: '',
    edgeHits: '',
    sharedHits: '',
    labels: '',
    occMarks: '',
    indexStubs: '',
  });
  const layerBuckets = {
    lower: makeLayerBucket(),
    focus: makeLayerBucket(),
    upper: makeLayerBucket(),
  };

  // Openings synced across a shared/linked wall carry the *same* id on both
  // rooms' links so they stay in lockstep — but that means the suite view,
  // which draws every child's own edges, would otherwise paint the same
  // physical fixture twice (once per side). Track ids as they're drawn so
  // each opening renders exactly once, no matter which room "owns" it here.
  const renderedOpeningIds = new Set();
  const suiteSelEdgeSet = new Set((suiteSelEdges || []).map(e => `${e.placeId}:${e.edge}`));
  const divideRoomId = (suiteSelEdges && suiteSelEdges.length) ? suiteSelEdges[0].placeId : '';

  for (const child of paintOrder) {
    const tier = storyTier(child.id);
    const bucket = layerBuckets[tier] || layerBuckets.focus;
    const pose = layout[child.id] || { x: 0, y: 0, rot: 0 };
    const verts = worldPolygon(child, pose);
    const n = verts.length;
    const svgVerts = verts.map(v => toSvg(v.x, v.y));
    const pts = svgVerts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const cx = svgVerts.reduce((s, v) => s + v.x, 0) / (n || 1);
    const cy = svgVerts.reduce((s, v) => s + v.y, 0) / (n || 1);
    const on = child.id === focusChildId;
    const here = child.id === herePlaceId;
    const snapped = [...contactEdges].some(k => k.startsWith(`${child.id}:`));
    const dim = tier !== 'focus';
    const tierCls = tier === 'lower' ? ' story-lower dim' : (tier === 'upper' ? ' story-upper dim' : ' story-focus');
    bucket.fills += `<g class="bst-suite-room${on ? ' on' : ''}${here ? ' here' : ''}${snapped ? ' snapped' : ''}${tierCls}" data-suite-child="${esc(child.id)}" data-story="${Number(storyMap[child.id]) || 0}" data-story-tier="${tier}">
      <polygon class="bst-suite-poly" points="${pts}"
        data-action="suite-focus-child" data-place="${esc(child.id)}" data-unit="${esc(unit.id)}" />`;

    const fp = child.footprint || {};
    for (let i = 0; i < n; i++) {
      const wa = verts[i];
      const wb = verts[(i + 1) % n];
      const sa = svgVerts[i];
      const sb = svgVerts[(i + 1) % n];
      const card = worldEdgeCardinal(child, pose, i);
      const link = linkForEdge(child, fp, i);
      const openings = openingsOnFootprintEdge(child, fp, i);
      const rawPairs = pairsByRoomEdge.get(`${child.id}#${i}`)
        || pairsByRoomEdge.get(`${child.id}:${card}`)
        || [];
      const edgePairs = rawPairs.filter(p => {
        const ov0 = overlapWorld(p);
        if (!ov0) return false;
        const lineDx = ov0.p2.x - ov0.p1.x;
        const lineDy = ov0.p2.y - ov0.p1.y;
        const lineLen = Math.hypot(lineDx, lineDy) || 1;
        const midEdge = { x: (wa.x + wb.x) / 2, y: (wa.y + wb.y) / 2 };
        const distToShared = Math.abs((midEdge.x - ov0.p1.x) * lineDy - (midEdge.y - ov0.p1.y) * lineDx) / lineLen;
        return distToShared <= 2.4;
      });
      const skipRanges = [];
      const thresholdRanges = [];
      let drawOpenings = openings.slice();
      const selected = !!(selectedEdge && selectedEdge.placeId === child.id && Number(selectedEdge.edge) === i)
        || suiteSelEdgeSet.has(`${child.id}:${i}`);
      const linked = !!(link?.toPlaceId || link?.external || edgePairs.length);
      const isExternal = !edgePairs.length;

      if (edgePairs.length) {
        const secondarySpans = [];
        const seen = new Set(drawOpenings.map(op => op.id));
        const wallDx = wb.x - wa.x;
        const wallDy = wb.y - wa.y;
        const wallLen2 = wallDx * wallDx + wallDy * wallDy || 1;
        const wallLen = Math.sqrt(wallLen2);
        const distFromWallLine = (p) =>
          Math.abs((p.x - wa.x) * wallDy - (p.y - wa.y) * wallDx) / wallLen;
        const rawT = (p) => ((p.x - wa.x) * wallDx + (p.y - wa.y) * wallDy) / wallLen2;

        for (const pair of edgePairs) {
          const ov = overlapWorld(pair);
          if (!ov) continue;
          const u0 = tOnEdge(wa, wb, ov.p1);
          const u1 = tOnEdge(wa, wb, ov.p2);
          const lo = Math.min(u0, u1);
          const hi = Math.max(u0, u1);
          if (hi - lo <= 0.04) continue;
          const visual = resolveSharedWallVisual(byId[pair.aId], byId[pair.bId], pair.wallA, pair.wallB);
          const primary = pairPrimaryId(pair) === child.id;
          if (visual.style === 'open') {
            skipRanges.push([lo, hi]);
            if (!primary) secondarySpans.push([lo, hi]);
          } else if (visual.style === 'threshold') {
            skipRanges.push([lo, hi]);
            if (primary) thresholdRanges.push([lo, hi]);
            if (!primary) secondarySpans.push([lo, hi]);
          } else if (!primary) {
            skipRanges.push([lo, hi]);
            secondarySpans.push([lo, hi]);
          }
          if (primary) {
            const absorbWorld = (op, ownerA, ownerB) => {
              if (!op?.id || seen.has(op.id) || isVerticalOpeningType(op.type)) return;
              const oAlong = Number.isFinite(op.along) ? op.along : 0.5;
              const center = {
                x: ownerA.x + (ownerB.x - ownerA.x) * oAlong,
                y: ownerA.y + (ownerB.y - ownerA.y) * oAlong,
              };
              if (distFromWallLine(center) > 1.0) return;
              const t = rawT(center);
              if (t < lo - 0.03 || t > hi + 0.03) return;
              seen.add(op.id);
              const ownerLen = Math.hypot(ownerB.x - ownerA.x, ownerB.y - ownerA.y) || wallLen;
              const width = (Number(op.width) || 0.14) * (ownerLen / wallLen);
              drawOpenings.push({
                ...op,
                along: Math.max(0.02, Math.min(0.98, t)),
                width,
              });
            };
            const peerId = child.id === pair.aId ? pair.bId : pair.aId;
            const peerWall = child.id === pair.aId ? pair.wallB : pair.wallA;
            const peer = byId[peerId];
            const peerPose = layout[peerId] || { x: 0, y: 0, rot: 0 };
            if (peer) {
              const peerVerts = worldPolygon(peer, peerPose);
              const nEdges = peerVerts.length;
              for (const ei of edgesFacingCardinal(peer, peerPose, peerWall)) {
                const pa = peerVerts[ei];
                const pb = peerVerts[(ei + 1) % nEdges];
                const mid = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };
                if (distFromWallLine(mid) > 1.5) continue;
                for (const op of openingsOnFootprintEdge(peer, peer.footprint || {}, ei)) {
                  absorbWorld(op, pa, pb);
                }
              }
            }
          }
        }
        if (secondarySpans.length) {
          drawOpenings = drawOpenings.filter(op => {
            const a = Number.isFinite(op.along) ? op.along : 0.5;
            return !secondarySpans.some(([sLo, sHi]) => a >= sLo - 0.01 && a <= sHi + 0.01);
          });
        }
      } else if (link && (link.sharedStyle === 'threshold' || link.sharedStyle === 'open')) {
        skipRanges.push([0, 1]);
        if (link.sharedStyle === 'threshold') thresholdRanges.push([0, 1]);
      }

      bucket.planInk += drawEdgePlan(sa, sb, drawOpenings, {
        m,
        selected,
        linked,
        isExternal,
        cx,
        cy,
        skipRanges,
        thresholdRanges,
        fixturesOn: fixturesOn && !dim,
        fixturePlaceOn: fixturePlaceOn && !dim,
        ownerPlaceId: child.id,
        ownerEdge: i,
        renderedOpeningIds,
        lockCast,
        compass,
        esc,
      }).join('\n');

      if (browseOn && !dim && link && !(link.toPlaceId && siblingIds.has(link.toPlaceId))) {
        const hasOffCanvasPeer = !!(link.toPlaceId && !siblingIds.has(link.toPlaceId));
        const hasGap = (link.openings || []).length || link.external || !link.toPlaceId || hasOffCanvasPeer;
        if (hasGap) {
          const hasOpns = (drawOpenings || []).length > 0;
          const alongs = hasOpns
            ? drawOpenings.map(op => Number.isFinite(op.along) ? op.along : 0.5)
            : [0.5];
          const seenAlong = new Set();
          for (const along of alongs) {
            const key = along.toFixed(2);
            if (seenAlong.has(key)) continue;
            seenAlong.add(key);
            const nrm = unitNormal(sa, sb);
            const inward = inwardToward(sa, sb, cx, cy);
            const mid = lerpPt(sa, sb, along);
            const rawPx = mid.x + nrm.nx * -inward * 16;
            const rawPy = mid.y + nrm.ny * -inward * 16;
            const dest = openingDestCaption(link, compass);
            const toId = String(link.toPlaceId || '').trim();
            const gap = !toId && !link.external;
            const arrow = hasOpns ? '→' : '↔';
            const cap = dest === 'unlinked' ? 'unlinked' : `${arrow} ${dest}`;
            const capPt = clampLabelCenter(rawPx, rawPy, cap, 9, svgW, svgH);
            if (gap) {
              const extPt = clampLabelCenter(capPt.x, capPt.y + 11, 'ext', 8, svgW, svgH);
              bucket.indexStubs += `<g class="bst-suite-stub gap">
                ${labelBackdropRect(capPt.x, capPt.y, cap, 9, 'bst-suite-stub-bg')}
                <text class="bst-suite-stub-cap" x="${capPt.x.toFixed(1)}" y="${capPt.y.toFixed(1)}" text-anchor="middle" dominant-baseline="middle"
                  data-action="suite-stub-link" data-place="${esc(child.id)}" data-link="${esc(link.id)}" data-edge="${i}" data-unit="${esc(unit.id)}">${esc(cap)}</text>
                ${labelBackdropRect(extPt.x, extPt.y, 'ext', 8, 'bst-suite-stub-bg')}
                <text class="bst-suite-stub-ext" x="${extPt.x.toFixed(1)}" y="${extPt.y.toFixed(1)}" text-anchor="middle" dominant-baseline="middle"
                  data-action="suite-mark-external" data-place="${esc(child.id)}" data-link="${esc(link.id)}" data-unit="${esc(unit.id)}">ext</text>
              </g>`;
            } else {
              const clearPt = clampLabelCenter(capPt.x, capPt.y + 11, 'clear', 8, svgW, svgH);
              bucket.indexStubs += `<g class="bst-suite-stub off">
                ${labelBackdropRect(capPt.x, capPt.y, cap, 9, 'bst-suite-stub-bg')}
                <text class="bst-suite-stub-cap" x="${capPt.x.toFixed(1)}" y="${capPt.y.toFixed(1)}" text-anchor="middle" dominant-baseline="middle"
                  data-action="suite-stub-open" data-to="${esc(toId)}" data-unit="${esc(unit.id)}">${esc(cap)}</text>
                ${labelBackdropRect(clearPt.x, clearPt.y, 'clear', 8, 'bst-suite-stub-bg')}
                <text class="bst-suite-stub-ext" x="${clearPt.x.toFixed(1)}" y="${clearPt.y.toFixed(1)}" text-anchor="middle" dominant-baseline="middle"
                  data-action="suite-stub-clear" data-place="${esc(child.id)}" data-link="${esc(link.id)}" data-unit="${esc(unit.id)}"
                  title="Drop this wall's connection. The other building lets go of it too.">clear</text>
              </g>`;
            }
          }
        }
      }

      if (wallsOn && !dim) {
        bucket.edgeHits += `<line class="bst-suite-edge-hit${selected ? ' sel' : ''}" x1="${sa.x.toFixed(1)}" y1="${sa.y.toFixed(1)}" x2="${sb.x.toFixed(1)}" y2="${sb.y.toFixed(1)}"
          data-action="suite-drag-edge" data-place="${esc(child.id)}" data-unit="${esc(unit.id)}" data-edge="${i}" data-wall="${esc(card)}" />`;
      }
    }

    for (const link of child.links || []) {
      if (!isVerticalWall(link.wall)) continue;
      for (const op of link.openings || []) {
        if (op?.id) {
          if (renderedOpeningIds.has(op.id)) continue;
          renderedOpeningIds.add(op.id);
        }
        const cellId = op.cell || 'C';
        const c = areaCenterInFootprint(cellId, fp);
        const wpt = worldFromNorm(child, pose, c.x, c.y);
        const p = toSvg(wpt.x, wpt.y);
        const up = op.type === 'ascent' || (op.type !== 'descent' && link.wall === 'above');
        const gClass = `bst-fp-fixture vertical ${esc(op.type || 'ascent')}`;
        bucket.stairs += stairPlanGlyph(p, up, {
          gClass,
          placeId: esc(child.id),
          linkId: esc(link.id),
          opnId: esc(op.id),
          type: esc(op.type || ''),
          title: esc(op.label || op.type || (up ? 'ascent' : 'descent')),
          m,
        });
        if (browseOn && !dim && !(link.toPlaceId && siblingIds.has(link.toPlaceId))) {
          const dest = openingDestCaption(link, compass);
          const toId = String(link.toPlaceId || '').trim();
          const cap = dest === 'unlinked' ? 'unlinked' : `→ ${dest}`;
          const gap = !toId && !link.external;
          const capPt = clampLabelCenter(p.x, p.y + 16, cap, 9, svgW, svgH);
          if (gap) {
            const extPt = clampLabelCenter(capPt.x, capPt.y + 10, 'ext', 8, svgW, svgH);
            bucket.indexStubs += `<g class="bst-suite-stub gap">
              ${labelBackdropRect(capPt.x, capPt.y, cap, 9, 'bst-suite-stub-bg')}
              <text class="bst-suite-stub-cap" x="${capPt.x.toFixed(1)}" y="${capPt.y.toFixed(1)}" text-anchor="middle"
                data-action="suite-stub-link" data-place="${esc(child.id)}" data-link="${esc(link.id)}" data-edge="" data-unit="${esc(unit.id)}">${esc(cap)}</text>
              ${labelBackdropRect(extPt.x, extPt.y, 'ext', 8, 'bst-suite-stub-bg')}
              <text class="bst-suite-stub-ext" x="${extPt.x.toFixed(1)}" y="${extPt.y.toFixed(1)}" text-anchor="middle"
                data-action="suite-mark-external" data-place="${esc(child.id)}" data-link="${esc(link.id)}" data-unit="${esc(unit.id)}">ext</text>
            </g>`;
          } else {
            const clearPt = clampLabelCenter(capPt.x, capPt.y + 11, 'clear', 8, svgW, svgH);
            bucket.indexStubs += `<g class="bst-suite-stub off">
              ${labelBackdropRect(capPt.x, capPt.y, cap, 9, 'bst-suite-stub-bg')}
              <text class="bst-suite-stub-cap" x="${capPt.x.toFixed(1)}" y="${capPt.y.toFixed(1)}" text-anchor="middle"
                data-action="suite-stub-open" data-to="${esc(toId)}" data-unit="${esc(unit.id)}">${esc(cap)}</text>
              ${labelBackdropRect(clearPt.x, clearPt.y, 'clear', 8, 'bst-suite-stub-bg')}
              <text class="bst-suite-stub-ext" x="${clearPt.x.toFixed(1)}" y="${clearPt.y.toFixed(1)}" text-anchor="middle"
                data-action="suite-stub-clear" data-place="${esc(child.id)}" data-link="${esc(link.id)}" data-unit="${esc(unit.id)}"
                title="Drop this wall's connection. The other building lets go of it too.">clear</text>
            </g>`;
          }
        }
      }
    }

    const roomLabelText = `${here ? '● ' : ''}${child.name}${hasStack ? ` · L${(Number(storyMap[child.id]) || 0) + 1}` : ''}`;
    bucket.labels += `${labelBackdropRect(cx, cy, roomLabelText, 11, 'bst-suite-label-bg')}<text class="bst-suite-label${tierCls}" x="${cx.toFixed(1)}" y="${cy.toFixed(1)}" text-anchor="middle" dominant-baseline="middle">${here ? '● ' : ''}${esc(child.name)}${hasStack ? ` · L${(Number(storyMap[child.id]) || 0) + 1}` : ''}</text>`;
    if (browseOn) {
      bucket.occMarks += occupancyDotsSvg(cx, cy, peopleInPlace(compass, child.id));
    }
    if (arrangeOn && !dim) {
      bucket.labels += `<circle class="bst-suite-handle" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="8"
        data-action="suite-drag-child" data-place="${esc(child.id)}" data-unit="${esc(unit.id)}" />`;
    }
    bucket.fills += `</g>`;
  }

  for (const cluster of unitClusters) {
    const tier = storyTier(cluster.unit.id);
    const bucket = layerBuckets[tier] || layerBuckets.focus;
    const dim = tier !== 'focus';
    const tierCls = tier === 'lower' ? ' story-lower dim' : (tier === 'upper' ? ' story-upper dim' : ' story-focus');
    const on = cluster.unit.id === focusChildId;
    const here = cluster.unit.id === herePlaceId || (cluster.kids || []).some(k => k.id === herePlaceId);
    const hit = toSvg(cluster.minX, cluster.minY);
    const hit2 = toSvg(cluster.maxX, cluster.maxY);
    const hx = Math.min(hit.x, hit2.x);
    const hy = Math.min(hit.y, hit2.y);
    const hw = Math.abs(hit2.x - hit.x);
    const hh = Math.abs(hit2.y - hit.y);
    const lx = hx + hw / 2;
    const ly = hy + hh / 2;

    // Render ONLY the outermost silhouette polygon & walls ("fog of war" interior — zero interior walls)
    let silFill = '';
    for (const ring of cluster.rings || []) {
      const svgVerts = ring.map(v => toSvg(v.x + cluster.ox, v.y + cluster.oy));
      const pts = svgVerts.map(v => `${v.x.toFixed(1)},${v.y.toFixed(1)}`).join(' ');
      silFill += `<polygon class="bst-suite-poly bst-suite-unit-poly" points="${pts}"
        data-action="suite-focus-child" data-place="${esc(cluster.unit.id)}" data-unit="${esc(unit.id)}" />
      <polygon class="bst-suite-unit-fog" points="${pts}" pointer-events="none" />`;
    }

    let silWalls = '';
    for (const w of cluster.walls || []) {
      const wa = { x: w.a.x + cluster.ox, y: w.a.y + cluster.oy };
      const wb = { x: w.b.x + cluster.ox, y: w.b.y + cluster.oy };
      const sa = toSvg(wa.x, wa.y);
      const sb = toSvg(wb.x, wb.y);
      const segDx = sb.x - sa.x;
      const segDy = sb.y - sa.y;
      const segLen = Math.hypot(segDx, segDy) || 1;

      // If this outer wall is flush against a same-story building room wall that has a doorway/opening, leave the gap clean
      const skips = [];
      for (const peer of children) {
        if ((Number(storyMap[peer.id]) || 0) !== (Number(storyMap[cluster.unit.id]) || 0)) continue;
        const pPose = layout[peer.id] || { x: 0, y: 0, rot: 0 };
        const pVerts = worldPolygon(peer, pPose);
        const pn = pVerts.length;
        for (let pe = 0; pe < pn; pe++) {
          const pa = toSvg(pVerts[pe].x, pVerts[pe].y);
          const pb = toSvg(pVerts[(pe + 1) % pn].x, pVerts[(pe + 1) % pn].y);
          const distA = Math.abs((pa.x - sa.x) * segDy - (pa.y - sa.y) * segDx) / segLen;
          const distB = Math.abs((pb.x - sa.x) * segDy - (pb.y - sa.y) * segDx) / segLen;
          if (distA > 4 || distB > 4) continue;
          const opns = openingsOnFootprintEdge(peer, peer.footprint || {}, pe);
          for (const op of opns) {
            const along = Number.isFinite(op.along) ? op.along : 0.5;
            const cPt = lerpPt(pa, pb, along);
            const tMid = ((cPt.x - sa.x) * segDx + (cPt.y - sa.y) * segDy) / (segLen * segLen);
            if (tMid < 0.02 || tMid > 0.98) continue;
            const half = Math.max((m?.minOpen || 22) / 2 / segLen, 0.06);
            skips.push([Math.max(0, tMid - half), Math.min(1, tMid + half)]);
          }
        }
      }
      let solids = [[0, 1]];
      for (const [u0, u1] of skips) {
        solids = subtractRange(solids, u0, u1);
      }
      for (const [t0, t1] of solids) {
        const p0 = lerpPt(sa, sb, t0);
        const p1 = lerpPt(sa, sb, t1);
        silWalls += `<line class="bst-fp-edge bst-fp-wall external bst-suite-unit-wall" x1="${p0.x.toFixed(1)}" y1="${p0.y.toFixed(1)}" x2="${p1.x.toFixed(1)}" y2="${p1.y.toFixed(1)}" />`;
      }
    }

    const people = (cluster.kids || []).flatMap(k => peopleInPlace(compass, k.id));
    const unitStoryNum = (Number(storyMap[cluster.unit.id]) || 0) + 1;
    bucket.unitInk += `<g class="bst-suite-room bst-suite-unit${on ? ' on' : ''}${here ? ' here' : ''}${tierCls}" data-suite-child="${esc(cluster.unit.id)}" data-story="${Number(storyMap[cluster.unit.id]) || 0}" data-story-tier="${tier}">
      ${silFill}
      ${silWalls}
      <text class="bst-suite-label bst-suite-unit-label${tierCls}" x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" dominant-baseline="middle">${here ? '● ' : ''}${esc(cluster.unit.name)}${hasStack ? ` · L${unitStoryNum}` : ''}</text>
      ${browseOn ? occupancyDotsSvg(lx, ly, people) : ''}
      ${arrangeOn && !dim ? `<circle class="bst-suite-handle" cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="8"
        data-action="suite-drag-child" data-place="${esc(cluster.unit.id)}" data-unit="${esc(unit.id)}" />` : ''}
    </g>`;
  }

  for (const [idx, pair] of pairs.entries()) {
    const ov = overlapWorld(pair);
    if (!ov) continue;
    const tier = storyTier(pair.aId);
    const bucket = layerBuckets[tier] || layerBuckets.focus;
    const p1 = toSvg(ov.p1.x, ov.p1.y);
    const p2 = toSvg(ov.p2.x, ov.p2.y);
    const visual = resolveSharedWallVisual(byId[pair.aId], byId[pair.bId], pair.wallA, pair.wallB);
    const selKey = `${pair.aId}|${pair.bId}|${pair.wallA}`;
    const selKeyAlt = `${pair.bId}|${pair.aId}|${pair.wallB}`;
    const selected = selectedShared
      && (`${selectedShared.aId}|${selectedShared.bId}|${selectedShared.wallA}` === selKey
        || `${selectedShared.aId}|${selectedShared.bId}|${selectedShared.wallA}` === selKeyAlt
        || (`${selectedShared.aId}|${selectedShared.bId}` === `${pair.aId}|${pair.bId}`
          && selectedShared.wallA === pair.wallA));
    const cls = `bst-suite-shared ${visual.style}${selected ? ' sel' : ''}`;
    bucket.sharedHits += `<g class="bst-suite-shared-g" data-shared-idx="${idx}">
      ${selected ? `<line class="${cls}" x1="${p1.x.toFixed(1)}" y1="${p1.y.toFixed(1)}" x2="${p2.x.toFixed(1)}" y2="${p2.y.toFixed(1)}" />` : ''}
      <line class="bst-suite-shared-hit" x1="${p1.x.toFixed(1)}" y1="${p1.y.toFixed(1)}" x2="${p2.x.toFixed(1)}" y2="${p2.y.toFixed(1)}"
        data-action="suite-select-shared"
        data-a="${esc(pair.aId)}" data-b="${esc(pair.bId)}"
        data-wall-a="${esc(pair.wallA)}" data-wall-b="${esc(pair.wallB)}"
        data-edge-a="${Number.isFinite(pair.edgeA) ? pair.edgeA : ''}"
        data-edge-b="${Number.isFinite(pair.edgeB) ? pair.edgeB : ''}"
        data-unit="${esc(unit.id)}" />
    </g>`;
  }

  const renderLayerGroup = (tier) => {
    const b = layerBuckets[tier];
    if (!b || (!b.fills && !b.unitInk)) return '';
    return `<g class="bst-suite-layer bst-suite-layer-${tier}" data-story-tier="${tier}">
      ${b.fills}
      ${b.unitInk}
      ${b.planInk}
      ${b.stairs}
      ${b.edgeHits}
      ${b.sharedHits}
      ${b.labels}
      ${browseOn ? b.occMarks : ''}
      ${browseOn ? b.indexStubs : ''}
    </g>`;
  };
  const layeredSvgContent = [
    renderLayerGroup('lower'),
    renderLayerGroup('focus'),
    renderLayerGroup('upper'),
  ].filter(Boolean).join('\n');

  const selLabel = selectedShared
    ? `${byId[selectedShared.aId]?.name || selectedShared.aId} · ${selectedShared.wallA} ↔ ${byId[selectedShared.bId]?.name || selectedShared.bId}`
    : (selectedEdge ? `${byId[selectedEdge.placeId]?.name || selectedEdge.placeId} · edge ${selectedEdge.edge}` : '');

  const sharedVisual = selectedShared
    ? resolveSharedWallVisual(byId[selectedShared.aId], byId[selectedShared.bId], selectedShared.wallA, selectedShared.wallB)
    : null;
  const edgeRoom = selectedEdge ? byId[selectedEdge.placeId] : null;
  const edgeLink = edgeRoom ? linkForEdge(edgeRoom, edgeRoom.footprint || {}, selectedEdge.edge) : null;
  const canRestoreWall = !!(sharedVisual && (sharedVisual.style === 'threshold' || sharedVisual.style === 'open'))
    || !!(edgeLink && (edgeLink.sharedStyle === 'threshold' || edgeLink.sharedStyle === 'open'));
  const joinRoomId = selectedEdge?.placeId || (suiteSelEdges[0]?.placeId) || '';
  const joinEdge = Number.isFinite(Number(selectedEdge?.edge))
    ? Number(selectedEdge.edge)
    : Number(suiteSelEdges[0]?.edge);
  const cleanRoomId = joinRoomId || focusChildId || '';
  const suiteHist = Array.isArray(unit.suiteHistory) ? unit.suiteHistory : [];
  const undoSummary = suiteHist.length ? (suiteHist[suiteHist.length - 1]?.summary || 'change') : '';

  const modeBtn = (id, label) =>
    `<button type="button" class="bst-chip${modeSafe === id ? ' on' : ''}" data-action="suite-mode" data-mode="${id}" data-unit="${esc(unit.id)}">${label}</button>`;

  const hints = {
    browse: 'Click a room to select it, then set its floor in the toolbar. Double-click or Open room for its floorplan. Off-map doors show a caption — unlinked ones can be marked external or linked. A caption that names another building has clear under it; that drops the connection on both sides.',
    arrange: 'Drag room handles to move; edges snap and create wall links. Openings stay manual.',
    walls: 'Click walls to select several on the same room, then drag one to reshape them together. Double-click (or Select face) to pick every segment on that side. Shift = fine increments, Alt = coarse. Merge fuses two rooms into one. Threshold opens a shared or exterior wall. Restore wall puts a threshold or deleted wall back. Split at corners inserts vertices where a neighbor\'s corner meets a wall; Join segment / Clean vertices drop leftover T-junctions. Delete wall removes an interior shared wall (exterior walls stay; open them with a threshold). Undo reverses the last suite wall change.',
    fixtures: fixAct === 'remove'
      ? 'Remove mode — click a door, window, arch, or passage to delete it (removed from the linked room too).'
      : fixAct === 'place'
        ? 'Place mode — click an empty stretch of wall to add a fixture, or drag an existing one to slide it. Changes sync to the linked room\'s floorplan.'
        : 'Move mode — drag any fixture along its wall to slide it, or click one to edit it. Changes sync to the linked room\'s floorplan.',
  };

  const clusterUnit = (id) => unitClusters.find(c => c.unit.id === id)?.unit || null;
  const hereChild = herePlaceId && children.some(c => c.id === herePlaceId)
    ? byId[herePlaceId]
    : (herePlaceId ? clusterUnit(herePlaceId) : null);
  const pickChild = (focusChildId && (byId[focusChildId] || clusterUnit(focusChildId))) || hereChild || children[0] || unitClusters[0]?.unit;
  const hereOn = !!(hereChild && herePlaceId);
  const hereCaption = hereOn
    ? `Here · ${hereChild.name}${hereCell ? ` · ${hereCell}` : ''}`
    : (pickChild ? `Pin ${pickChild.name} as the current location` : 'Select a room, then We’re here');
  const outdoor = enclosingOutdoorPlace(compass, unit);

  return `
    <div class="bst-suite" data-role="suite-canvas" data-unit="${esc(unit.id)}" data-mode="${esc(modeSafe)}" data-from-child="${hideArrange ? '1' : '0'}"
      data-bounds-min-x="${bounds.minX}" data-bounds-min-y="${bounds.minY}" data-bounds-w="${bw}" data-bounds-h="${bh}"
      data-svg-w="${svgW}" data-svg-h="${svgH}">
      <div class="bst-suite-toolbar">
        ${modeBtn('browse', 'Browse')}
        ${hideArrange ? '' : modeBtn('arrange', 'Arrange')}
        ${modeBtn('walls', 'Walls')}
        ${modeBtn('fixtures', 'Fixtures')}
        <button type="button" class="bst-btn" data-action="suite-align" data-unit="${esc(unit.id)}" title="Visually weld contacting walls so shared faces line up — each room's own floorplan keeps its real proportions" ${children.length < 2 ? 'disabled' : ''}>Align</button>
        ${Object.keys(visualFootprints).length
          ? `<button type="button" class="bst-btn" data-action="suite-align-reset" data-unit="${esc(unit.id)}" title="Go back to each room's real, unaligned proportions in this suite view">Reset align</button>`
          : ''}
        <span class="bst-suite-story-bar" role="group" aria-label="Floor layers">
          ${(uniqueStories.length ? uniqueStories : [0]).map(s => `<button type="button" class="bst-chip${s === focusedStory ? ' on' : ''}" data-action="suite-story-focus" data-unit="${esc(unit.id)}" data-focus="${s}" title="Show floor L${s + 1}. Rooms below it darken; rooms above it fade.">L${s + 1}</button>`).join('')}
          ${hasStack
            ? `<button type="button" class="bst-btn" data-action="suite-story-focus" data-unit="${esc(unit.id)}" data-focus="${focusUpper ? 'lower' : 'upper'}" title="Toggle between upper and lower floors">${focusUpper ? 'Focus lower floors' : 'Focus upper floors'}</button>
               <span class="bst-k">L${focusedStory + 1} in focus</span>`
            : '<span class="bst-k">One floor</span>'}
        </span>
        ${(() => {
          const floorTarget = focusChildId && (byId[focusChildId] || clusterUnit(focusChildId));
          if (!floorTarget) return '<span class="bst-k">Click a room to set its floor</span>';
          const curS = Number(storyMap[floorTarget.id]) || 0;
          const lo = Math.min(minStory, curS, 0);
          const hi = Math.max(maxStory, curS, 0);
          const choices = [];
          for (let s = lo; s <= hi + 1; s++) choices.push(s);
          const opts = choices.map(s => {
            const fresh = s > hi;
            return `<option value="${s}"${s === curS ? ' selected' : ''}>L${s + 1}${fresh ? ' · new floor' : ''}</option>`;
          }).join('');
          return `<label class="bst-suite-room-floor" title="Put ${esc(floorTarget.name)} on a floor">
            <span class="bst-k">${esc(floorTarget.name)}</span>
            <select class="bst-input bst-set-kind-sel" data-role="suite-room-story" data-place="${esc(floorTarget.id)}" data-unit="${esc(unit.id)}" title="Floor for ${esc(floorTarget.name)}">${opts}</select>
          </label>`;
        })()}
        <button type="button" class="bst-btn gold" data-action="set-here" data-place="${esc(pickChild?.id || '')}" data-cell="${esc(hereCell || 'C')}" ${pickChild ? '' : 'disabled'} title="Pin the highlighted (or current) room as the scene location">We're here</button>
        ${outdoor?.id
          ? `<button type="button" class="bst-btn" data-action="set-here" data-place="${esc(outdoor.id)}" data-cell="C" title="Pin the scene outside this building, in ${esc(outdoor.name)}">Leave to ${esc(outdoor.name)}</button>`
          : ''}
        ${pickChild
          ? `<button type="button" class="bst-btn" data-action="suite-open-child" data-place="${esc(pickChild.id)}" data-unit="${esc(unit.id)}">${pickChild.kind === 'unit' ? 'Open unit' : 'Open room'}</button>`
          : ''}
        <button type="button" class="bst-btn" data-action="suite-undo" data-unit="${esc(unit.id)}" ${suiteHist.length ? '' : 'disabled'} title="${suiteHist.length ? `Undo ${esc(undoSummary)}` : 'Nothing to undo in this suite yet'}">Undo</button>
        ${unit.kind === 'building' ? `<select class="bst-input bst-set-kind-sel" data-role="suite-category-select" data-place="${esc(unit.id)}" title="Building category">
          ${renderSuiteCategoryOptions(unit.category || '', esc, { hostKind: 'building', hostName: unit.name })}
        </select>
        <button type="button" class="bst-btn" data-action="compass-populate-category" data-place="${esc(unit.id)}" title="Fill this building with rooms for the chosen category">Populate</button>` : ''}
        ${hereOn ? `<span class="bst-chip on">${esc(hereCaption)}</span>` : `<span class="bst-k">${esc(hereCaption)}</span>`}
        <span class="bst-k">${children.length} room${children.length === 1 ? '' : 's'} · ${pairs.length} shared wall${pairs.length === 1 ? '' : 's'}</span>
      </div>
      ${wallsOn ? `<div class="bst-suite-toolbar bst-suite-wall-tools">
        <button type="button" class="bst-btn" data-action="suite-shared-style" data-style="merged" data-unit="${esc(unit.id)}" ${selectedShared ? '' : 'disabled'} title="Fuse these two rooms into one along the shared wall — one shape, one arrange handle">Merge</button>
        <button type="button" class="bst-btn" data-action="suite-shared-style" data-style="threshold" data-unit="${esc(unit.id)}" ${selectedShared || selectedEdge ? '' : 'disabled'} title="Open threshold. On an exterior wall this is the only way to leave the wall open">Threshold</button>
        <button type="button" class="bst-btn" data-action="suite-restore-wall" data-unit="${esc(unit.id)}"
          data-a="${esc(selectedShared?.aId || '')}" data-b="${esc(selectedShared?.bId || '')}"
          data-wall-a="${esc(selectedShared?.wallA || '')}" data-wall-b="${esc(selectedShared?.wallB || '')}"
          data-place="${esc(selectedEdge?.placeId || '')}" data-edge="${Number.isFinite(Number(selectedEdge?.edge)) ? selectedEdge.edge : ''}"
          ${canRestoreWall ? '' : 'disabled'} title="Put this threshold or deleted wall back to a solid wall">Restore wall</button>
        <button type="button" class="bst-btn" data-action="suite-split-corners" data-unit="${esc(unit.id)}" ${children.length < 2 ? 'disabled' : ''} title="Insert vertices where a room corner meets another room's wall">Split at corners</button>
        <button type="button" class="bst-btn" data-action="suite-join-segment" data-unit="${esc(unit.id)}" data-place="${esc(joinRoomId)}" data-edge="${Number.isFinite(joinEdge) ? joinEdge : ''}" ${joinRoomId && Number.isFinite(joinEdge) ? '' : 'disabled'} title="Remove a leftover split vertex or tiny stub on the selected segment">Join segment</button>
        <button type="button" class="bst-btn" data-action="suite-clean-vertices" data-unit="${esc(unit.id)}" data-place="${esc(cleanRoomId)}" ${cleanRoomId ? '' : 'disabled'} title="Drop every leftover T-junction vertex on the selected room">Clean vertices</button>
        <button type="button" class="bst-btn danger" data-action="suite-delete-shared" data-unit="${esc(unit.id)}" ${selectedShared ? '' : 'disabled'} title="Delete this interior shared wall. Exterior walls cannot be deleted">Delete wall</button>
        <button type="button" class="bst-btn" data-action="suite-select-face" data-unit="${esc(unit.id)}" ${suiteSelEdges.length ? '' : 'disabled'} title="Select every wall segment on this room that faces the same way as the first pick">Select face</button>
        <button type="button" class="bst-btn" data-action="suite-divide-room" data-place="${esc(divideRoomId)}" data-unit="${esc(unit.id)}" ${suiteSelEdges.length === 2 ? '' : 'disabled'} title="Click exactly 2 walls on the same room (not drag) to cut a new dividing wall between their midpoints, forming a new sibling room">Divide room</button>
        ${selLabel ? `<span class="bst-k">Selected · ${esc(selLabel)}</span>` : '<span class="bst-k">Click walls to multi-select, then drag to reshape — or pick a shared wall to Merge / Threshold</span>'}
        ${suiteSelEdges.length ? `<span class="bst-k">${suiteSelEdges.length} wall${suiteSelEdges.length === 1 ? '' : 's'} selected${suiteSelEdges.length === 2 ? ' · Divide ready' : ' — drag to reshape together'}</span>` : ''}
      </div>
      ${renderSuiteWallLinksPanel({ compass, unit, byId, pairsByRoomEdge, selectedEdge, esc })}` : ''}
      ${fixturesOn ? `<div class="bst-suite-toolbar bst-suite-fixture-tools">
        <span class="bst-fp-fixture-act">
          <button type="button" class="bst-btn${fixAct === 'place' ? ' gold' : ''}" data-action="suite-fixture-act" data-act="place" data-unit="${esc(unit.id)}" title="Click again to deselect">Place</button>
          <button type="button" class="bst-btn${fixAct === 'remove' ? ' gold' : ''}" data-action="suite-fixture-act" data-act="remove" data-unit="${esc(unit.id)}" title="Click again to deselect">Remove</button>
        </span>
        ${fixAct === 'place' ? `<label class="bst-k">Type <select class="bst-input" data-role="suite-fixture-type">
          <option value="door">Door</option>
          <option value="arch">Arch</option>
          <option value="passage">Passage</option>
          <option value="window">Window</option>
        </select></label>` : ''}
        ${renderFixtureRoomLink({ compass, unit, children, lastOpening, esc })}
      </div>` : ''}
      <p class="bst-hint">${hints[modeSafe] || hints.browse}</p>
      <div class="bst-suite-viewport">
        <svg class="bst-suite-svg" viewBox="0 0 ${svgW} ${svgH}" width="100%" height="${svgH}">
          ${layeredSvgContent}
          <circle class="bst-suite-opening-ghost" data-role="opening-ghost" cx="0" cy="0" r="4" visibility="hidden" />
        </svg>
      </div>
      <div class="bst-fp-legend" style="margin-top:6px">
        <span class="bst-fp-leg wall">Merged wall</span>
        <span class="bst-fp-leg threshold">Threshold (open)</span>
        <span class="bst-fp-leg door">Door segment</span>
        <span class="bst-fp-leg window">Window segment</span>
        <span class="bst-fp-leg arch">Arch segment</span>
      </div>
      ${(() => {
        const hits = listingCodeHits(children);
        if (!hits.length) return '';
        const line = suiteListingLine(unit, children, compass);
        return `<div class="bst-fp-legend bst-fp-listing" style="margin-top:4px">
          <span class="bst-k">Rooms${line && line.includes('|') ? ` · ${esc(line.split('|').slice(1).join('|').trim())}` : ''}</span>
          ${hits.map(h => `<button type="button" class="bst-fp-leg listing${(h.ids || []).includes(focusChildId) ? ' on' : ''}" data-action="suite-listing-code" data-code="${esc(h.code)}" data-place="${esc(h.ids[0] || '')}" data-unit="${esc(unit.id)}" title="${esc(h.label)}">${esc(h.label)}</button>`).join('')}
        </div>`;
      })()}
    </div>`;
}

/** Pure smoke: parent suite SVG uses scaled hinge+leaf+swing / glazing — not 4px beads. */
export function smokeSuiteFloorplanGlyphs() {
  try {
    const fp = defaultFootprint();
    const hall = {
      id: 'hall',
      name: 'Hall',
      kind: 'room',
      parentId: 'apt',
      footprint: fp,
      links: [
        {
          id: 'l-n',
          wall: 'N',
          edge: 0,
          openings: [{ id: 'w-ext', type: 'window', along: 0.45, width: 0.2, cell: 'C' }],
        },
        {
          id: 'l-e',
          wall: 'E',
          edge: 1,
          toPlaceId: 'parlor',
          openings: [{ id: 'd-share', type: 'door', along: 0.5, width: 0.16, cell: 'C' }],
        },
        {
          id: 'l-s',
          wall: 'S',
          edge: 2,
          openings: [{ id: 'd-ext', type: 'door', along: 0.55, width: 0.16, cell: 'C' }],
        },
      ],
    };
    const parlor = {
      id: 'parlor',
      name: 'Parlor',
      kind: 'room',
      parentId: 'apt',
      footprint: fp,
      links: [
        {
          id: 'l-w',
          wall: 'W',
          edge: 3,
          toPlaceId: 'hall',
          openings: [],
        },
      ],
    };
    const unit = {
      id: 'apt',
      name: 'Apartment',
      kind: 'unit',
      suiteLayout: {
        hall: { x: 0, y: 0, rot: 0 },
        parlor: { x: 16, y: 0, rot: 0 },
      },
    };
    const html = renderSuiteFloorplan(unit, { rooms: { apt: unit, hall, parlor } }, {
      mode: 'walls',
      esc: (s) => String(s ?? ''),
    });
    if (typeof planMetrics !== 'function') return 'planMetrics is not defined';
    if (/segmentMarks/.test(html)) return 'suite SVG still mentions segmentMarks';
    if (/\ba 4 4\b/.test(html)) return 'suite SVG still draws 4px door beads';
    const swings = [...html.matchAll(/class="[^"]*door-swing[^"]*"[^>]*\sd="[^"]*\sA\s([\d.]+)\s([\d.]+)/g)];
    if (!swings.length) {
      const alt = [...html.matchAll(/\sA\s([\d.]+)\s([\d.]+)\s0\s0\s[01]\s/g)];
      if (!alt.length) return 'no door-swing arcs in suite SVG';
      for (const m of alt) {
        const r = Number(m[1]);
        if (!(r >= 10)) return `door swing radius too small (${r})`;
      }
    } else {
      for (const m of swings) {
        const r = Number(m[1]);
        if (!(r >= 10)) return `door swing radius too small (${r})`;
      }
    }
    if (!html.includes('door-hinge')) return 'door hinge missing from suite glyphs';
    if (!html.includes('door-leaf')) return 'door leaf missing from suite glyphs';
    if (!html.includes('bst-fp-fixture window')) return 'window glazing missing from suite glyphs';
    if ((html.match(/door-swing/g) || []).length < 2) {
      return 'expected exterior + shared door swings on the suite';
    }
    if (!html.includes('data-action="suite-drag-edge"')) return 'Walls-mode edge hits missing';
    if (html.includes('bst-suite-stub') || html.includes('bst-suite-occ')) {
      return 'index overlay leaked into Walls mode';
    }

    hall.occupants = [{ name: 'Ada', cell: 'C', facing: 'N' }];
    const browse = renderSuiteFloorplan(unit, { rooms: { apt: unit, hall, parlor } }, {
      mode: 'browse',
      esc: (s) => String(s ?? ''),
    });
    if (!browse.includes('door-hinge')) return 'browse SVG dropped door hinge';
    if (!browse.includes('bst-fp-fixture window')) return 'browse SVG dropped window';
    if (!browse.includes('bst-suite-stub')) return 'browse stub overlay missing';
    if (!/unlinked/.test(browse)) return 'unlinked stub caption missing';
    if (!browse.includes('bst-suite-occ')) return 'browse occupancy dots missing';
    if (!browse.includes('Ada')) return 'occupancy title missing';
    if (browse.includes('data-action="suite-drag-edge"')) return 'browse still has Walls edge hits';
    if (!browse.includes('>Arrange<')) return 'Arrange button missing';

    const house = { id: 'house', name: 'House', kind: 'building' };
    const apt2 = {
      id: 'apt2',
      name: 'Apt 2',
      kind: 'unit',
      parentId: 'house',
      suiteLayout: { den: { x: 0, y: 0, rot: 0 } },
    };
    const den = {
      id: 'den',
      name: 'Den',
      kind: 'room',
      parentId: 'apt2',
      footprint: fp,
    };
    const houseHtml = renderSuiteFloorplan(house, { rooms: { house, apt2, den } }, {
      mode: 'browse',
      esc: (s) => String(s ?? ''),
    });
    if (!houseHtml.includes('bst-suite-unit')) return 'building unit cluster missing';
    if (!houseHtml.includes('Apt 2')) return 'unit cluster label missing';
    if (!houseHtml.includes('data-action="suite-open-child"')) return 'unit cluster not clickable';

    const roomHtml = renderFloorplanReadonly(hall, {
      placeId: 'hall',
      esc: (s) => String(s ?? ''),
      compass: { rooms: { apt: unit, hall, parlor } },
    });
    if (!roomHtml.includes('bst-fp-exit-label')) return 'room exit labels missing';
    if (!roomHtml.includes('Parlor')) return 'room dest label missing parlor';
    if (!roomHtml.includes('unlinked')) return 'room dest label missing unlinked';
    return '';
  } catch (err) {
    return String(err?.message || err);
  }
}

/**
 * Two cosmetic bugs reported together: a wall-link stub caption to a long,
 * off-canvas place name was getting silently clipped at the suite SVG's own
 * edge, and a stub landing close to a room's own centered name label made
 * both illegible where they overlapped. Both are fixed by clamping stub
 * centers inside the canvas and giving every label a sized backdrop.
 */
export function smokeSuiteFloorplanLabelOverlapPure() {
  try {
    const fp = defaultFootprint();
    // A lone, narrow room sitting right at the canvas edge, with a door to an
    // off-canvas place whose name is long enough to have overflowed past x=0
    // before the clamp (text-anchor middle around a point near the wall).
    const bath = {
      id: 'bath',
      name: 'Bathroom',
      kind: 'room',
      parentId: 'apt3',
      footprint: fp,
      links: [
        { id: 'l-w', wall: 'W', edge: 3, toPlaceId: 'break_room', description: '', openings: [] },
      ],
    };
    const unit = {
      id: 'apt3',
      name: 'Apt 3',
      kind: 'unit',
      suiteLayout: { bath: { x: 0, y: 0, rot: 0 } },
    };
    const breakRoom = {
      id: 'break_room',
      name: 'The Impossibly Overgrown Antique Shop Break Room',
      kind: 'room',
      parentId: 'other_building',
    };
    const html = renderSuiteFloorplan(unit, { rooms: { apt3: unit, bath, break_room: breakRoom } }, {
      mode: 'browse',
      esc: (s) => String(s ?? ''),
    });
    if (!html.includes('bst-suite-label-bg')) return 'room-name label is missing its legibility backdrop';
    if (!html.includes('bst-suite-stub-bg')) return 'stub caption is missing its legibility backdrop';
    if (!html.includes('data-action="suite-stub-clear"')) return 'off-canvas wall is missing its clear control';
    if (!html.includes('data-link="l-w"')) return 'clear control should target the off-canvas wall';
    const stubXs = [...html.matchAll(/class="bst-suite-stub-cap"[^>]*\sx="(-?[\d.]+)"/g)].map(m => Number(m[1]));
    if (!stubXs.length) return 'no stub caption rendered to check';
    const svgWMatch = html.match(/width="(\d+)"/);
    const svgW = svgWMatch ? Number(svgWMatch[1]) : 420;
    for (const x of stubXs) {
      if (x < 0 || x > svgW) return `stub caption center (${x}) escaped the suite canvas (width ${svgW}) — it will get clipped`;
    }
    return '';
  } catch (err) {
    return String(err?.message || err);
  }
}

/** Clicking a suite room offers every existing floor plus one new floor above. */
export function smokeSuiteFloorAssignPure() {
  try {
    const fp = defaultFootprint();
    const hall = { id: 'hall', name: 'Hall', kind: 'room', parentId: 'mall', footprint: fp, story: 0 };
    const office = { id: 'office', name: 'Office', kind: 'room', parentId: 'mall', footprint: fp, story: 1 };
    const mall = { id: 'mall', name: 'Canal City Mall', kind: 'building', suiteLayout: { hall: { x: 0, y: 0, rot: 0 }, office: { x: 4, y: 0, rot: 0 } } };
    const idle = renderSuiteFloorplan(mall, { rooms: { mall, hall, office } }, {
      mode: 'browse', esc: (s) => String(s ?? ''),
    });
    if (!idle.includes('Click a room to set its floor')) return 'suite should ask for a room before assigning a floor';
    if (idle.includes('data-role="suite-room-story"')) return 'floor menu should wait until a room is selected';
    if (!idle.includes('data-focus="0"') || !idle.includes('data-focus="1"')) return 'existing floors should be listed before any room is selected';
    const html = renderSuiteFloorplan(mall, { rooms: { mall, hall, office } }, {
      mode: 'browse', esc: (s) => String(s ?? ''), focusChildId: 'hall',
    });
    if (!html.includes('data-role="suite-room-story"')) return 'selected room is missing its floor menu';
    if (!html.includes('data-place="hall"')) return 'floor menu should target the selected room';
    if (!html.includes('value="0" selected')) return 'hall should show its current floor selected';
    if (!html.includes('value="2"')) return 'floor menu should offer a new floor above the top one';
    if (!html.includes('L3 · new floor')) return 'the new floor should be labeled one above the highest';
    return '';
  } catch (err) {
    return String(err?.message || err);
  }
}

/**
 * Floorplan = room shape / borders / entries on a measurement grid.
 */
export function renderFloorplan(room, {
  placeId,
  selectedEdges = [],
  drawWallMode = false,
  fpMode = 'move',
  fixtureAct = 'place',
  lockCast = [],
  compass = null,
  esc,
}) {
  const mode = ['move', 'walls', 'fixtures', 'verts'].includes(fpMode)
    ? fpMode
    : (fpMode === 'view' ? 'move' : (drawWallMode ? 'walls' : 'move'));
  const wallsOn = mode === 'walls';
  const fixturesOn = mode === 'fixtures';
  const vertsOn = mode === 'verts';
  const moveOn = mode === 'move';
  const fixAct = fixtureAct === 'remove' ? 'remove' : (fixtureAct === 'place' ? 'place' : '');
  const size = 360;
  const pad = 28;
  const fp = room.footprint || {};
  const { pts, inner } = projectFootprint(fp, size, pad);
  const scale = estimateFootprintScale(fp);
  const m = planMetrics(inner / 16, size);
  const sel = new Set([...selectedEdges].map(String));
  const n = pts.length;
  const g = scale.grid;

  // Background grid
  const gridLines = [];
  for (let i = 0; i <= g; i++) {
    const t = pad + (i / g) * inner;
    gridLines.push(`<line class="bst-fp-grid" x1="${pad}" y1="${t}" x2="${pad + inner}" y2="${t}" />`);
    gridLines.push(`<line class="bst-fp-grid" x1="${t}" y1="${pad}" x2="${t}" y2="${pad + inner}" />`);
  }

  const fillPath = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ') + ' Z';
  const edgeLines = [];
  const fixtureGlyphs = [];

  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const link = linkForEdge(room, fp, i);
    const openings = openingsOnFootprintEdge(room, fp, i);
    const selected = sel.has(String(i));
    const linked = !!(link?.toPlaceId || link?.external);
    const isExternal = !!link?.external;

    const cuts = openingCuts(a, b, openings, m.minOpen).map(c => ({ ...c, link }));

    let cursor = 0;
    const solid = [];
    for (const cut of cuts) {
      if (cut.t0 > cursor + 0.001) solid.push([cursor, cut.t0]);
      cursor = Math.max(cursor, cut.t1);
    }
    if (cursor < 0.999) solid.push([cursor, 1]);
    if (!cuts.length) solid.push([0, 1]);

    const isThreshold = !!(link?.toPlaceId && link?.sharedStyle === 'threshold');
    const isOpen = !!(link?.toPlaceId && link?.sharedStyle === 'open');
    for (const [t0, t1] of solid) {
      const p0 = lerpPt(a, b, t0);
      const p1 = lerpPt(a, b, t1);
      if (isOpen) {
        edgeLines.push(`<line class="bst-fp-threshold-gap" x1="${p0.x.toFixed(1)}" y1="${p0.y.toFixed(1)}" x2="${p1.x.toFixed(1)}" y2="${p1.y.toFixed(1)}" />`);
      } else if (isThreshold) {
        edgeLines.push(`<line class="bst-fp-threshold-gap" x1="${p0.x.toFixed(1)}" y1="${p0.y.toFixed(1)}" x2="${p1.x.toFixed(1)}" y2="${p1.y.toFixed(1)}" />`);
        edgeLines.push(`<line class="bst-fp-threshold${selected ? ' sel' : ''}" x1="${p0.x.toFixed(1)}" y1="${p0.y.toFixed(1)}" x2="${p1.x.toFixed(1)}" y2="${p1.y.toFixed(1)}" />`);
      } else {
        edgeLines.push(...planWallSeg(p0, p1, { selected, linked, isExternal, m }));
      }
    }

    for (const cut of cuts) {
      const p0 = lerpPt(a, b, cut.t0);
      const p1 = lerpPt(a, b, cut.t1);
      const opType = String(cut.op.type || 'door');
      if (isVerticalOpeningType(opType)) continue; // drawn at area centers
      const kind = openingVisualKind(opType, m);
      const nrm = unitNormal(a, b);
      const mid = lerpPt(a, b, (cut.t0 + cut.t1) / 2);
      const cx = size / 2;
      const cy = size / 2;
      const inward = ((cx - mid.x) * nrm.nx + (cy - mid.y) * nrm.ny) >= 0 ? 1 : -1;
      const hollowClass = [
        'bst-fp-opening',
        opType,
        kind.className,
        cut.op.locked ? 'locked' : '',
      ].filter(Boolean).join(' ');
      // Invisible hit target in the wall gap (no cream “blob” stroke).
      const dest = cut.link?.toPlaceId && compass ? getPlace(compass, cut.link.toPlaceId) : null;
      const lockTip = cut.op.locked ? fixtureLockTitle(cut.op, { lockCast, compass, destPlace: dest }) : '';
      edgeLines.push(`<line class="bst-fp-opening-hit ${hollowClass}"
        x1="${p0.x.toFixed(1)}" y1="${p0.y.toFixed(1)}" x2="${p1.x.toFixed(1)}" y2="${p1.y.toFixed(1)}"
        data-action="compass-drag-opening" data-place="${esc(placeId)}" data-link="${esc(cut.link.id)}" data-opn="${esc(cut.op.id)}" data-edge="${i}" data-type="${esc(opType)}"${lockTip ? ` title="${esc(lockTip)}"` : ''} />`);

      const gClass = `bst-fp-fixture ${kind.glyph}${cut.op.locked ? ' locked' : ''}`;
      fixtureGlyphs.push(...withLockTitle(kind.drawGlyph({
        p0, p1, mid, nrm, inward, gClass, isExternal,
      }), lockTip, esc));
      const destCap = openingDestCaption(cut.link, compass);
      if (destCap) fixtureGlyphs.push(openingLabelSvg(mid, nrm, inward, destCap, !!cut.op.locked, esc));
    }

    edgeLines.push(`<line class="bst-fp-edge-hit"
      x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"
      data-action="compass-select-edge" data-edge="${i}" data-place="${esc(placeId)}"
      data-axis="${Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? 'y' : 'x'}" />`);
  }

  // Ascent / descent fixtures sit on compass areas (above / below links), not wall edges.
  for (const link of room.links || []) {
    if (!isVerticalWall(link.wall)) continue;
    for (const op of link.openings || []) {
      const cellId = op.cell || 'C';
      const c = areaCenterInFootprint(cellId, fp);
      const p = { x: pad + c.x * inner, y: pad + c.y * inner };
      const up = op.type === 'ascent' || (op.type !== 'descent' && link.wall === 'above');
      const gClass = `bst-fp-fixture vertical ${esc(op.type || 'ascent')}${op.locked ? ' locked' : ''}`;
      const label = esc(op.label || op.type || (up ? 'ascent' : 'descent'));
      fixtureGlyphs.push(stairPlanGlyph(p, up, {
        gClass,
        placeId: esc(placeId),
        linkId: esc(link.id),
        opnId: esc(op.id),
        type: esc(op.type || ''),
        title: `${label} (${esc(link.wall)})`,
        m,
      }));
      const destCap = openingDestCaption(link, compass);
      if (destCap) fixtureGlyphs.push(`<text class="bst-fp-exit-label" x="${p.x.toFixed(1)}" y="${(p.y + 16).toFixed(1)}" text-anchor="middle">${esc(op.locked ? `${destCap} · locked` : destCap)}</text>`);
    }
  }

  const verts = pts.map((p, i) => `
    <circle class="bst-fp-vert${vertsOn ? ' live' : ' muted'}" cx="${p.x}" cy="${p.y}" r="${vertsOn ? 6 : 3}"
      data-action="compass-drag-vert" data-vert="${i}" data-place="${esc(placeId)}" />`).join('');

  const toSvg = (nx, ny) => ({
    x: pad + nx * inner,
    y: pad + ny * inner,
  });

  const internalWalls = (room.internalWalls || []).map(w => {
    const a = toSvg(w.x0, w.y0);
    const b = toSvg(w.x1, w.y1);
    return `
      <line class="bst-fp-barrier" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" />
      <line class="bst-fp-barrier-hit" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"
        data-action="compass-barrier-del" data-place="${esc(placeId)}" data-wall="${esc(w.id)}" title="Click to remove barrier" />`;
  }).join('');

  const showAreaHits = wallsOn || (fixturesOn && fixAct === 'place');
  const areaDots = showAreaHits
    ? CELLS.map(id => {
      const c = areaCenterInFootprint(id, fp);
      const p = toSvg(c.x, c.y);
      if (fixturesOn && fixAct === 'place') {
        return `<circle class="bst-fp-area-hit" cx="${p.x}" cy="${p.y}" r="16"
          data-action="compass-place-vertical" data-place="${esc(placeId)}" data-cell="${id}" />
          <text class="bst-fp-area-label" x="${p.x}" y="${p.y - 18}" text-anchor="middle">${id}</text>`;
      }
      return `<circle class="bst-fp-area-dot" cx="${p.x}" cy="${p.y}" r="3" />
        <text class="bst-fp-area-label" x="${p.x}" y="${p.y - 6}" text-anchor="middle">${id}</text>`;
    }).join('')
    : '';

  const modeBtn = (id, label) =>
    `<button type="button" class="bst-btn${mode === id ? ' gold' : ''}" data-action="fp-set-mode" data-mode="${id}">${label}</button>`;

  const snapHint = ' Walls snap to this room’s grid (Shift = free, Alt = finer). Standalone rooms do not snap to each other — nest them in a unit or building and use Arrange.';
  const hints = {
    move: `Drag the room fill to slide the whole shape on the grid (keeps proportions). Scroll to zoom · drag empty space to pan the view.${snapHint}`,
    walls: `Click walls to select several, then drag one to reshape them together. Drag borders to reshape a single face · drag on the grid to draw an internal barrier · click a barrier to remove it.${snapHint}`,
    fixtures: fixAct === 'remove'
      ? 'Remove mode — click a door, arch, passage, window, or ascent/descent to delete it. Click Remove again to deselect.'
      : fixAct === 'place'
        ? 'Place mode — doors/arches/passages/windows on walls; ascent/descent on an area. Click Place again to deselect.'
        : 'Drag fixtures along the wall · click to edit. Ascent/descent: click to edit.',
    verts: 'Drag vertices to reshape. Select a wall first, then + Vertex to split it into separately linkable segments.',
  };

  return `
    <div class="bst-floorplan mode-${mode}${wallsOn ? ' draw-wall' : ''}${fixturesOn ? ` fixture-${fixAct || 'move'}` : ''}${moveOn ? ' mode-move' : ''}" data-role="floorplan" data-place="${esc(placeId)}" data-fp-mode="${mode}">
      <div class="bst-k">Shape · ${esc(scale.label)}</div>
      <div class="bst-row bst-fp-tools">
        <button type="button" class="bst-btn" data-action="fp-center" title="Center shape in view">Center</button>
        <span class="bst-k">Tool</span>
        ${modeBtn('move', 'Move')}
        ${modeBtn('walls', 'Walls')}
        ${modeBtn('fixtures', 'Fixtures')}
        ${modeBtn('verts', 'Vertices')}
      </div>
      <div class="bst-fp-legend">
        <span class="bst-fp-leg wall">Wall</span>
        <span class="bst-fp-leg threshold">Threshold</span>
        <span class="bst-fp-leg door">Door</span>
        <span class="bst-fp-leg arch">Arch</span>
        <span class="bst-fp-leg passage">Passage</span>
        <span class="bst-fp-leg window">Window</span>
        <span class="bst-fp-leg ascent">Ascent</span>
        <span class="bst-fp-leg descent">Descent</span>
        <span class="bst-fp-leg barrier">Barrier</span>
        <span class="bst-fp-leg external">External</span>
      </div>
      <div class="bst-fp-viewport" data-role="fp-viewport">
        <div class="bst-fp-world" data-role="fp-world">
          <svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="Room floorplan"
            ${wallsOn ? `data-action="compass-draw-wall-surface" data-place="${esc(placeId)}"` : ''}>
            ${gridLines.join('\n')}
            <path class="bst-fp-fill${moveOn ? ' live' : ''}" d="${fillPath}"
              ${moveOn ? `data-action="compass-drag-room" data-place="${esc(placeId)}"` : ''} />
            ${edgeLines.join('\n')}
            ${areaDots}
            ${fixtureGlyphs.join('\n')}
            ${internalWalls}
            ${verts}
            <line class="bst-fp-barrier-ghost" data-role="barrier-ghost" x1="0" y1="0" x2="0" y2="0" visibility="hidden" />
          </svg>
        </div>
        <div class="bst-fp-zoom">
          <button type="button" class="bst-fp-zoom-btn" data-action="fp-zoom-out" title="Zoom out">−</button>
          <span class="bst-fp-zoom-label" data-role="fp-zoom-label">100%</span>
          <button type="button" class="bst-fp-zoom-btn" data-action="fp-zoom-in" title="Zoom in">+</button>
          <button type="button" class="bst-fp-zoom-btn" data-action="fp-center" title="Center shape">⌖</button>
        </div>
      </div>
      <div class="bst-row" style="margin-top:6px">
        ${vertsOn ? `<button type="button" class="bst-btn" data-action="compass-fp-add-vert" data-place="${esc(placeId)}">+ Vertex</button>` : ''}
        ${fixturesOn ? `
          <span class="bst-fp-fixture-act">
            <button type="button" class="bst-btn${fixAct === 'place' ? ' gold' : ''}" data-action="fp-fixture-act" data-act="place" title="Click again to deselect">Place</button>
            <button type="button" class="bst-btn${fixAct === 'remove' ? ' gold' : ''}" data-action="fp-fixture-act" data-act="remove" title="Click again to deselect">Remove</button>
          </span>
          ${fixAct === 'place' ? `
          <label class="bst-k">Type <select class="bst-input" data-role="fp-fixture-type">
            <option value="door">Door</option>
            <option value="arch">Arch</option>
            <option value="passage">Passage</option>
            <option value="window">Window</option>
            <option value="ascent">Ascent ↑</option>
            <option value="descent">Descent ↓</option>
          </select></label>` : ''}` : ''}
        <button type="button" class="bst-btn" data-action="compass-fp-reset" data-place="${esc(placeId)}">Reset rectangle</button>
      </div>
      <div class="bst-row" style="margin-top:4px">
        <label class="bst-k">Grid <input class="bst-input" style="width:3.5em" type="number" min="2" max="24" data-role="fp-grid" data-place="${esc(placeId)}" value="${scale.grid}"></label>
        <label class="bst-k">${esc(scale.unitLabel)}/sq <input class="bst-input" style="width:3.5em" type="number" min="0.25" step="0.25" data-role="fp-unit" data-place="${esc(placeId)}" value="${scale.unitPerGrid}"></label>
        <button type="button" class="bst-btn" data-action="compass-fp-scale" data-place="${esc(placeId)}">Apply scale</button>
      </div>
      <div class="bst-hint">${hints[mode]}</div>
    </div>`;
}

/**
 * Read-only floorplan for a suite-child room's own (browse) view: the room's
 * true shape with a compass overlay (N/S/E/W + area cells) and every fixture /
 * door drawn where it sits, but no editing tools or drag handlers — walls and
 * fixtures for suite children are authored in the Suite view. Because openings
 * on shared walls are mirrored onto this room's own links, the cardinal walls
 * automatically reflect what the Suite view shows.
 */
export function renderFloorplanReadonly(room, { placeId, esc, parentName = '', compass = null } = {}) {
  const size = 360;
  const pad = 28;
  const fp = room.footprint || {};
  const { pts, inner } = projectFootprint(fp, size, pad);
  const scale = estimateFootprintScale(fp);
  const m = planMetrics(inner / 16, size);
  const n = pts.length;
  const g = scale.grid;

  const gridLines = [];
  for (let i = 0; i <= g; i++) {
    const t = pad + (i / g) * inner;
    gridLines.push(`<line class="bst-fp-grid" x1="${pad}" y1="${t}" x2="${pad + inner}" y2="${t}" />`);
    gridLines.push(`<line class="bst-fp-grid" x1="${t}" y1="${pad}" x2="${t}" y2="${pad + inner}" />`);
  }

  const fillPath = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ') + ' Z';
  const edgeLines = [];
  const fixtureGlyphs = [];

  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const link = linkForEdge(room, fp, i);
    const openings = openingsOnFootprintEdge(room, fp, i);
    const linked = !!(link?.toPlaceId || link?.external);
    const isExternal = !!link?.external;
    const cuts = openingCuts(a, b, openings, m.minOpen).map(c => ({ ...c, link }));

    let cursor = 0;
    const solid = [];
    for (const cut of cuts) {
      if (cut.t0 > cursor + 0.001) solid.push([cursor, cut.t0]);
      cursor = Math.max(cursor, cut.t1);
    }
    if (cursor < 0.999) solid.push([cursor, 1]);
    if (!cuts.length) solid.push([0, 1]);

    const isThreshold = !!(link?.toPlaceId && link?.sharedStyle === 'threshold');
    const isOpen = !!(link?.toPlaceId && link?.sharedStyle === 'open');
    for (const [t0, t1] of solid) {
      const p0 = lerpPt(a, b, t0);
      const p1 = lerpPt(a, b, t1);
      if (isOpen) {
        edgeLines.push(`<line class="bst-fp-threshold-gap" x1="${p0.x.toFixed(1)}" y1="${p0.y.toFixed(1)}" x2="${p1.x.toFixed(1)}" y2="${p1.y.toFixed(1)}" />`);
      } else if (isThreshold) {
        edgeLines.push(`<line class="bst-fp-threshold-gap" x1="${p0.x.toFixed(1)}" y1="${p0.y.toFixed(1)}" x2="${p1.x.toFixed(1)}" y2="${p1.y.toFixed(1)}" />`);
        edgeLines.push(`<line class="bst-fp-threshold" x1="${p0.x.toFixed(1)}" y1="${p0.y.toFixed(1)}" x2="${p1.x.toFixed(1)}" y2="${p1.y.toFixed(1)}" />`);
      } else {
        edgeLines.push(...planWallSeg(p0, p1, { selected: false, linked, isExternal, m }));
      }
    }

    for (const cut of cuts) {
      const p0 = lerpPt(a, b, cut.t0);
      const p1 = lerpPt(a, b, cut.t1);
      const opType = String(cut.op.type || 'door');
      if (isVerticalOpeningType(opType)) continue;
      const kind = openingVisualKind(opType, m);
      const nrm = unitNormal(a, b);
      const mid = lerpPt(a, b, (cut.t0 + cut.t1) / 2);
      const inward = ((size / 2 - mid.x) * nrm.nx + (size / 2 - mid.y) * nrm.ny) >= 0 ? 1 : -1;
      const gClass = `bst-fp-fixture ${kind.glyph}${cut.op.locked ? ' locked' : ''}`;
      fixtureGlyphs.push(...kind.drawGlyph({ p0, p1, mid, nrm, inward, gClass, isExternal }));
      const destCap = openingDestCaption(cut.link, compass);
      if (destCap) fixtureGlyphs.push(openingLabelSvg(mid, nrm, inward, destCap, !!cut.op.locked, esc));
    }
  }

  // Vertical (ascent/descent) fixtures sit at their compass-area centers.
  for (const link of room.links || []) {
    if (!isVerticalWall(link.wall)) continue;
    for (const op of link.openings || []) {
      const c = areaCenterInFootprint(op.cell || 'C', fp);
      const p = { x: pad + c.x * inner, y: pad + c.y * inner };
      const up = op.type === 'ascent' || (op.type !== 'descent' && link.wall === 'above');
      const gClass = `bst-fp-fixture vertical ${esc(op.type || 'ascent')}${op.locked ? ' locked' : ''}`;
      fixtureGlyphs.push(stairPlanGlyph(p, up, { gClass, placeId: '', linkId: '', opnId: '', type: '', title: esc(op.label || op.type || ''), m }));
      const destCap = openingDestCaption(link, compass);
      if (destCap) fixtureGlyphs.push(`<text class="bst-fp-exit-label" x="${p.x.toFixed(1)}" y="${(p.y + 16).toFixed(1)}" text-anchor="middle">${esc(op.locked ? `${destCap} · locked` : destCap)}</text>`);
    }
  }

  const internalWalls = (room.internalWalls || []).map(w => {
    const a = { x: pad + w.x0 * inner, y: pad + w.y0 * inner };
    const b = { x: pad + w.x1 * inner, y: pad + w.y1 * inner };
    return `<line class="bst-fp-barrier" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" />`;
  }).join('');

  const occByCell = {};
  for (const o of room.occupants || []) {
    const cell = String(o.cell || 'C');
    (occByCell[cell] || (occByCell[cell] = [])).push(o.name);
  }
  try {
    for (const p of listSonarPingsInPlace(compass, placeId || room.id)) {
      const cell = String(p.cell || 'C');
      const names = occByCell[cell] || (occByCell[cell] = []);
      if (!names.some(n => String(n).toLowerCase() === String(p.name || '').toLowerCase())) names.push(p.name);
    }
  } catch { /* ignore */ }
  const areaDots = CELLS.map(id => {
    const c = areaCenterInFootprint(id, fp);
    const p = { x: pad + c.x * inner, y: pad + c.y * inner };
    const occ = occupancyDotsSvg(p.x, p.y, occByCell[id] || [], { className: 'bst-fp-occ', r: 3, dy: 8 });
    return `<circle class="bst-fp-area-dot" cx="${p.x}" cy="${p.y}" r="3" />
      <text class="bst-fp-area-label" x="${p.x}" y="${p.y - 6}" text-anchor="middle">${id}</text>
      ${occ}`;
  }).join('');

  // Compass rose overlay — the room's local orientation (top = North).
  const compassRose = `
    <text class="bst-fp-compass-label" x="${size / 2}" y="14" text-anchor="middle">N</text>
    <text class="bst-fp-compass-label" x="${size / 2}" y="${size - 4}" text-anchor="middle">S</text>
    <text class="bst-fp-compass-label" x="10" y="${size / 2 + 4}" text-anchor="middle">W</text>
    <text class="bst-fp-compass-label" x="${size - 10}" y="${size / 2 + 4}" text-anchor="middle">E</text>`;

  return `
    <div class="bst-floorplan bst-floorplan--readonly mode-browse" data-role="floorplan" data-place="${esc(placeId)}" data-fp-mode="browse">
      <div class="bst-k">Shape · ${esc(scale.label)} <span class="bst-chip">read-only</span></div>
      <div class="bst-fp-legend">
        <span class="bst-fp-leg wall">Wall</span>
        <span class="bst-fp-leg threshold">Threshold</span>
        <span class="bst-fp-leg door">Door</span>
        <span class="bst-fp-leg arch">Arch</span>
        <span class="bst-fp-leg passage">Passage</span>
        <span class="bst-fp-leg window">Window</span>
        <span class="bst-fp-leg external">External</span>
      </div>
      <div class="bst-fp-viewport" data-role="fp-viewport">
        <div class="bst-fp-world" data-role="fp-world">
          <svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="Room floorplan (read-only)">
            ${gridLines.join('\n')}
            <path class="bst-fp-fill" d="${fillPath}" />
            ${edgeLines.join('\n')}
            ${compassRose}
            ${areaDots}
            ${fixtureGlyphs.join('\n')}
            ${internalWalls}
          </svg>
        </div>
        <div class="bst-fp-zoom">
          <button type="button" class="bst-fp-zoom-btn" data-action="fp-zoom-out" title="Zoom out">−</button>
          <span class="bst-fp-zoom-label" data-role="fp-zoom-label">100%</span>
          <button type="button" class="bst-fp-zoom-btn" data-action="fp-zoom-in" title="Zoom in">+</button>
          <button type="button" class="bst-fp-zoom-btn" data-action="fp-center" title="Center shape">⌖</button>
        </div>
      </div>
      <div class="bst-row" style="margin-top:6px">
        <button type="button" class="bst-btn gold" data-action="compass-view-parent" data-place="${esc(placeId)}" data-parent="${esc(room.parentId || '')}" title="Open ${esc(parentName || 'suite')}">Edit walls &amp; fixtures in Suite →</button>
      </div>
      <div class="bst-hint">Browsing <strong>${esc(room.name)}</strong> — shape, compass, and fixtures shown as they appear in <strong>${esc(parentName || 'the suite')}</strong>. Edit them in the Suite view.</div>
    </div>`;
}

