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
} from './schema.js';
import { getPlace, gatherPeerViews } from './state.js';
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
  suiteWorldBounds,
  worldPolygon,
  worldAabb,
  worldEdgeCardinal,
  resolveSharedWallVisual,
  worldFromNorm,
  edgesFacingCardinal,
} from './suiteLayout.js';

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Ensure Inventory punch-ticket styles are available (reuse inv-modal-*). */
export function ensureInvModalStyles() {
  if (document.querySelector('link[data-showtime="inventory"]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = new URL('../../modules/inventory/inventory.css', import.meta.url).href;
  link.dataset.showtime = 'inventory';
  document.head.appendChild(link);
}

export function buildModal(inner) {
  ensureInvModalStyles();
  const backdrop = document.createElement('div');
  backdrop.className = 'inv-modal-backdrop';
  backdrop.innerHTML = `<div class="inv-modal">${inner}</div>`;
  document.body.appendChild(backdrop);
  backdrop.addEventListener('click', e => { if (e.target === backdrop) backdrop.remove(); });
  return backdrop;
}

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
              return `
              <li>
                <span>${esc(it.name)}${it.category ? ` · ${esc(it.category)}` : ''}${it.description ? ` <em>(${esc(it.description)})</em>` : ''}${tags.length ? ` <span class="bst-k">${esc(tags.join(' · '))}</span>` : ''}</span>
                <span class="bst-row">
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
    btn.addEventListener('click', () => {
      if (!confirm('Delete this piece?')) return;
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

  backdrop.querySelector('[data-act="add-occ"]')?.addEventListener('click', () => {
    const sel = backdrop.querySelector('[data-field="cast"]');
    const opt = sel?.selectedOptions?.[0];
    const castId = sel?.value || '';
    const name = opt?.dataset?.name || opt?.textContent || '';
    const description = backdrop.querySelector('[data-field="occ-desc"]')?.value?.trim() || '';
    if (!castId && !name) { alert('Pick a cast member.'); return; }
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
        onSave: (patch) => handlers.updateOpening?.(link.id, op.id, patch),
        onDelete: () => handlers.removeOpening?.(link.id, op.id),
      });
    });
  });

  backdrop.querySelectorAll('[data-act="del-opn"]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!confirm('Delete this opening?')) return;
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
  backdrop.querySelector('[data-act="delete"]')?.addEventListener('click', () => {
    if (!confirm('Delete?')) return;
    backdrop.remove();
    onDelete?.();
  });
  backdrop.querySelector('[data-act="save"]').addEventListener('click', () => {
    const name = backdrop.querySelector('[data-field="name"]').value.trim();
    if (!name) { alert('Name is required.'); return; }
    const description = backdrop.querySelector('[data-field="description"]').value.trim();
    const condition = backdrop.querySelector('[data-field="condition"]').value;
    backdrop.remove();
    onSave?.({
      kind: layer === 'fixtures' ? 'item' : kind,
      name,
      description,
      condition,
      category: layer === 'clutter' && kind === 'item' ? category : undefined,
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
  backdrop.querySelector('[data-act="delete"]')?.addEventListener('click', () => {
    if (!confirm('Delete furniture?')) return;
    backdrop.remove();
    onDelete?.();
  });
  backdrop.querySelector('[data-act="save"]').addEventListener('click', () => {
    const name = backdrop.querySelector('[data-field="name"]').value.trim();
    if (!name) { alert('Name is required.'); return; }
    const occupiable = !!occInput.checked;
    const maxOccupancy = occupiable
      ? Math.max(1, Number(backdrop.querySelector('[data-field="maxOccupancy"]').value) || 1)
      : 0;
    backdrop.remove();
    onSave?.({
      kind: 'item',
      name,
      description: backdrop.querySelector('[data-field="description"]').value.trim(),
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
  onSave,
  onDelete,
}) {
  const isEdit = !!existing;
  const links = room.links || [];
  const op = existing || {
    type: 'door',
    cell: defaultCell,
    label: '',
    peer: false,
    locked: false,
    keyHint: '',
    travel: true,
  };

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
      <label>Access</label>
      <div class="bst-toggle-row">
        <label class="bst-check"><input type="checkbox" data-field="peer" ${op.peer ? 'checked' : ''}> See through</label>
        <label class="bst-check"><input type="checkbox" data-field="locked" ${op.locked ? 'checked' : ''}> Locked</label>
      </div>
      <div class="inv-modal-hint">See through peers the far side. Locked blocks travel (force in-scene or unlock with a Usable item).</div>
    </div>
    <div class="inv-modal-field" data-key-wrap style="${op.locked ? '' : 'display:none'}">
      <label>Key hint (usable item name)</label>
      <input type="text" data-field="keyHint" value="${esc(op.keyHint || '')}" placeholder="brass key, master card…">
      <div class="inv-modal-hint">Matches Inventory items tagged Usable.</div>
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
  const lockedInput = backdrop.querySelector('[data-field="locked"]');
  const syncKey = () => {
    keyWrap.style.display = lockedInput.checked ? '' : 'none';
  };
  lockedInput.addEventListener('change', syncKey);

  backdrop.querySelector('[data-act="cancel"]').addEventListener('click', () => backdrop.remove());
  backdrop.querySelector('[data-act="delete"]')?.addEventListener('click', () => {
    if (!confirm('Delete opening?')) return;
    backdrop.remove();
    onDelete?.();
  });
  backdrop.querySelector('[data-act="save"]').addEventListener('click', () => {
    const linkId = isEdit ? link.id : (backdrop.querySelector('[data-field="linkId"]')?.value || link?.id || '');
    if (!linkId) { alert('Choose a wall link first.'); return; }
    const locked = !!lockedInput.checked;
    const payload = {
      linkId,
      type,
      label: backdrop.querySelector('[data-field="label"]').value.trim(),
      description: backdrop.querySelector('[data-field="description"]').value.trim(),
      cell: backdrop.querySelector('[data-field="cell"]').value,
      peer: !!backdrop.querySelector('[data-field="peer"]').checked,
      locked,
      keyHint: locked ? backdrop.querySelector('[data-field="keyHint"]').value.trim() : '',
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

function drawEdgePlan(a, b, openings, {
  m,
  selected = false,
  linked = false,
  isExternal = false,
  cx = 0,
  cy = 0,
  skipRange = null,
  threshold = false,
  fixturesOn = false,
  fixturePlaceOn = false,
  ownerPlaceId = '',
  ownerEdge = null,
  renderedOpeningIds = null,
  esc = (s) => String(s ?? ''),
} = {}) {
  const cuts = openingCuts(a, b, openings, m?.minOpen);
  let solids = solidRanges(cuts);
  if (skipRange) solids = subtractRange(solids, skipRange[0], skipRange[1]);
  const parts = [];
  if (threshold && skipRange && skipRange[1] > skipRange[0] + 0.02) {
    const p0 = lerpPt(a, b, skipRange[0]);
    const p1 = lerpPt(a, b, skipRange[1]);
    parts.push(`<line class="bst-suite-threshold-gap" x1="${p0.x.toFixed(1)}" y1="${p0.y.toFixed(1)}" x2="${p1.x.toFixed(1)}" y2="${p1.y.toFixed(1)}" />`);
    parts.push(`<line class="bst-suite-threshold" x1="${p0.x.toFixed(1)}" y1="${p0.y.toFixed(1)}" x2="${p1.x.toFixed(1)}" y2="${p1.y.toFixed(1)}" />`);
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
    parts.push(...kind.drawGlyph({
      p0, p1, nrm, inward,
      gClass: `bst-fp-fixture ${kind.glyph}`,
      isExternal,
    }));
    if (fixturesOn && cut.op._ownerPlaceId && cut.op._ownerLinkId && Number.isFinite(cut.op._ownerEdge)) {
      parts.push(`<line class="bst-suite-opening-hit"
        x1="${p0.x.toFixed(1)}" y1="${p0.y.toFixed(1)}" x2="${p1.x.toFixed(1)}" y2="${p1.y.toFixed(1)}"
        data-action="suite-drag-opening" data-place="${esc(cut.op._ownerPlaceId)}" data-link="${esc(cut.op._ownerLinkId)}"
        data-opn="${esc(cut.op.id)}" data-edge="${cut.op._ownerEdge}" data-type="${esc(cut.op.type || '')}" />`);
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

/**
 * Multi-room suite canvas for a Unit — children in world space.
 * @param {'arrange'|'browse'|'walls'} mode
 */
/**
 * Wall links panel for a single selected wall in the suite Walls mode —
 * lateral link/external/opening management ported from the individual
 * room's panel, scoped to whichever wall is currently selected here.
 */
function renderSuiteWallLinksPanel({ compass, unit, children, byId, selectedEdge, esc }) {
  if (!selectedEdge) return '';
  const room = getPlace(compass, selectedEdge.placeId);
  if (!room || !byId[room.id]) return '';
  const edgeIdx = Number(selectedEdge.edge);
  if (!Number.isFinite(edgeIdx)) return '';
  const fp = room.footprint || {};
  const link = linkForEdge(room, fp, edgeIdx);
  const wallLabel = link ? formatWallLinkLabel(link, room, compass) : `Edge ${edgeIdx}`;
  const neighbors = children.filter(c => c.id !== room.id);
  const peeks = gatherPeerViews(compass, room).filter(p => !link || p.wall === link.wall);
  const renderPeers = () => {
    if (!peeks.length) return '';
    const bits = peeks.filter(p => p.visible).map(p => {
      const rows = [...(p.items || []).map(i => i.name), ...(p.occupants || []).map(o => o.name + '*')];
      return `${esc(p.toName)}${p.locked ? ' (locked)' : ''}: ${rows.length ? esc(rows.join(', ')) : '(empty wall)'}`;
    }).join(' · ');
    return `<div class="bst-hint" style="margin-top:4px"><strong>Peer preview:</strong> ${bits || 'nothing visible through openings'}</div>`;
  };

  if (!link) {
    return `<div class="bst-suite-walllinks">
      <div class="bst-row"><strong>${esc(wallLabel)}</strong> <span class="bst-k">— no link yet</span></div>
      <div class="bst-row">
        <select class="bst-input" data-role="suite-wl-link-to" style="flex:1">
          <option value="">— Neighbor room —</option>
          ${neighbors.length
            ? neighbors.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')
            : '<option value="" disabled>No other rooms in this suite</option>'}
        </select>
      </div>
      <div class="bst-row">
        <input class="bst-input" style="flex:1" data-role="suite-wl-link-desc" placeholder="Link description (when the shared wall is noticed)">
        <button type="button" class="bst-btn gold" data-action="suite-wl-add-link" data-place="${esc(room.id)}" data-edge="${edgeIdx}" data-unit="${esc(unit.id)}">Link</button>
        <button type="button" class="bst-btn" data-action="suite-wl-mark-external" data-place="${esc(room.id)}" data-edge="${edgeIdx}" data-unit="${esc(unit.id)}" title="This wall faces outside">Mark external</button>
      </div>
    </div>`;
  }

  const neigh = link.toPlaceId ? getPlace(compass, link.toPlaceId) : null;
  const dest = link.toPlaceId ? (neigh?.name || link.toPlaceId) : (link.external ? 'outside' : '—');
  const opnBits = (link.openings || []).map(op => `${op.type}${op.locked ? '🔒' : ''}${op.peer ? '👁' : ''}`).join(', ') || 'no openings';
  const styleChip = link.sharedStyle === 'threshold'
    ? '<span class="bst-chip" title="Open threshold">threshold</span>'
    : '';
  return `<div class="bst-suite-walllinks">
    <div class="bst-row">
      <strong>${esc(wallLabel)}</strong>
      ${link.toPlaceId ? '<span class="bst-chip on" title="Shared wall between two rooms">shared</span>' : ''}
      ${link.external ? '<span class="bst-chip on" title="Faces outside">external</span>' : ''}
      ${styleChip}
      <span class="bst-k">${esc(opnBits)}</span>
      <button type="button" class="bst-btn" data-action="suite-wl-toggle-external" data-link="${esc(link.id)}" data-place="${esc(room.id)}" data-on="${link.external ? '0' : '1'}">${link.external ? 'Clear external' : 'External'}</button>
      <button type="button" class="bst-btn" data-action="suite-wl-add-opening" data-link="${esc(link.id)}" data-place="${esc(room.id)}">+ Opening</button>
      <button type="button" class="bst-btn danger" data-action="suite-wl-remove-link" data-link="${esc(link.id)}" data-place="${esc(room.id)}">Unlink</button>
    </div>
    ${link.description ? `<div class="bst-hint">${esc(link.description)}</div>` : ''}
    ${renderPeers()}
  </div>`;
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
  if (!children.length) {
    return `<div class="bst-suite">
      <div class="bst-empty">No rooms under this unit yet — create Room / Hall children nested under it.</div>
    </div>`;
  }
  const { layout } = ensureSuiteChildPoses(unit, children);
  const bounds = suiteWorldBounds(children, layout, 1.2);
  const bw = Math.max(4, bounds.maxX - bounds.minX);
  const bh = Math.max(4, bounds.maxY - bounds.minY);
  const svgW = 420;
  const svgH = Math.max(240, Math.round(svgW * (bh / bw)));
  const pairs = findContactingPairs(children, layout);
  const contactEdges = new Set(pairs.flatMap(p => [
    `${p.aId}:${p.wallA}`,
    `${p.bId}:${p.wallB}`,
  ]));
  const byId = Object.fromEntries(children.map(c => [c.id, c]));
  const wallsOn = mode === 'walls';
  const arrangeOn = mode === 'arrange';
  const fixturesOn = mode === 'fixtures';
  const fixAct = fixtureAct === 'remove' ? 'remove' : (fixtureAct === 'place' ? 'place' : '');
  const fixturePlaceOn = fixturesOn && fixAct === 'place';
  const px = Math.min(svgW / bw, svgH / bh);
  const m = planMetrics(px, Math.min(svgW, svgH));

  const toSvg = (wx, wy) => ({
    x: ((wx - bounds.minX) / bw) * svgW,
    y: ((wy - bounds.minY) / bh) * svgH,
  });

  const pairByRoomCard = new Map();
  for (const pair of pairs) {
    pairByRoomCard.set(`${pair.aId}:${pair.wallA}`, pair);
    pairByRoomCard.set(`${pair.bId}:${pair.wallB}`, pair);
  }
  const pairPrimaryId = pair => (String(pair.aId) < String(pair.bId) ? pair.aId : pair.bId);

  const overlapWorld = (pair) => {
    const a = byId[pair.aId];
    const b = byId[pair.bId];
    if (!a || !b) return null;
    const boxA = worldAabb(a, layout[pair.aId] || { x: 0, y: 0, rot: 0 });
    const boxB = worldAabb(b, layout[pair.bId] || { x: 0, y: 0, rot: 0 });
    if (pair.wallA === 'E' || pair.wallA === 'W') {
      const x = pair.wallA === 'E' ? boxA.maxX : boxA.minX;
      const y0 = Math.max(boxA.minY, boxB.minY);
      const y1 = Math.min(boxA.maxY, boxB.maxY);
      return { p1: { x, y: y0 }, p2: { x, y: y1 } };
    }
    const y = pair.wallA === 'S' ? boxA.maxY : boxA.minY;
    const x0 = Math.max(boxA.minX, boxB.minX);
    const x1 = Math.min(boxA.maxX, boxB.maxX);
    return { p1: { x: x0, y }, p2: { x: x1, y } };
  };

  const tOnEdge = (a, b, p) => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy || 1;
    return Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  };

  let planInk = '';
  let edgeHits = '';
  let labels = '';
  let fills = '';
  let stairs = '';
  let sharedHits = '';
  // Openings synced across a shared/linked wall carry the *same* id on both
  // rooms' links so they stay in lockstep — but that means the suite view,
  // which draws every child's own edges, would otherwise paint the same
  // physical fixture twice (once per side). Track ids as they're drawn so
  // each opening renders exactly once, no matter which room "owns" it here.
  const renderedOpeningIds = new Set();
  const suiteSelEdgeSet = new Set((suiteSelEdges || []).map(e => `${e.placeId}:${e.edge}`));
  const divideRoomId = (suiteSelEdges && suiteSelEdges.length) ? suiteSelEdges[0].placeId : '';

  for (const child of children) {
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
    fills += `<g class="bst-suite-room${on ? ' on' : ''}${here ? ' here' : ''}${snapped ? ' snapped' : ''}" data-suite-child="${esc(child.id)}">
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
      let pair = pairByRoomCard.get(`${child.id}:${card}`);
      if (pair) {
        // The pair lookup only matches by cardinal ("living:N"), so any
        // edge sharing that rough compass direction qualifies — including
        // an unrelated notch/step wall elsewhere on an irregular room. Only
        // treat this specific edge as part of the shared wall if it's
        // actually near the pair's contact line; otherwise it's just its
        // own independent wall and should render (and hold fixtures)
        // normally.
        const ov0 = overlapWorld(pair);
        if (!ov0) {
          pair = null;
        } else {
          const lineDx = ov0.p2.x - ov0.p1.x;
          const lineDy = ov0.p2.y - ov0.p1.y;
          const lineLen = Math.hypot(lineDx, lineDy) || 1;
          const midEdge = { x: (wa.x + wb.x) / 2, y: (wa.y + wb.y) / 2 };
          const distToShared = Math.abs((midEdge.x - ov0.p1.x) * lineDy - (midEdge.y - ov0.p1.y) * lineDx) / lineLen;
          if (distToShared > 1.5) pair = null;
        }
      }
      let skipRange = null;
      let threshold = false;
      let drawOpenings = openings;
      const selected = !!(selectedEdge && selectedEdge.placeId === child.id && Number(selectedEdge.edge) === i)
        || suiteSelEdgeSet.has(`${child.id}:${i}`);
      const linked = !!(link?.toPlaceId || link?.external || pair);
      const isExternal = !pair;

      if (pair) {
        const ov = overlapWorld(pair);
        if (ov) {
          const u0 = tOnEdge(wa, wb, ov.p1);
          const u1 = tOnEdge(wa, wb, ov.p2);
          const lo = Math.min(u0, u1);
          const hi = Math.max(u0, u1);
          if (hi - lo > 0.04) {
            const visual = resolveSharedWallVisual(byId[pair.aId], byId[pair.bId], pair.wallA, pair.wallB);
            const primary = pairPrimaryId(pair) === child.id;
            // The secondary side of a shared wall doesn't redraw the wall
            // line across the contact span (the primary does), but a single
            // long wall can border *two* neighbours end-to-end (e.g. an Entry
            // north wall shared with a Bedroom on the left and a Bathroom on
            // the right). Openings that fall OUTSIDE this pair's overlap belong
            // to that other stretch, so the secondary must still cut their gaps
            // — otherwise the fixture's glyph floats over a solid, gap-less
            // wall.
            const outsideOverlap = (op) => {
              const a = Number.isFinite(op.along) ? op.along : 0.5;
              return a < lo - 0.01 || a > hi + 0.01;
            };
            if (visual.style === 'threshold') {
              skipRange = [lo, hi];
              threshold = primary;
              drawOpenings = primary ? openings.slice() : openings.filter(outsideOverlap);
            } else if (!primary) {
              skipRange = [lo, hi];
              drawOpenings = openings.filter(outsideOverlap);
            }
            if (primary) {
              const seen = new Set(drawOpenings.map(op => op.id));
              // Geometry of *this* (primary) edge, in world units. Absorbed
              // openings are stored relative to the neighbor's own edge, which
              // can be a different length/extent (a wide Entry wall vs a
              // narrow Bedroom wall, or reshaped by Align). We therefore
              // re-express every absorbed opening by its true WORLD position
              // and project it back onto this edge — so the glyph lands where
              // the physical doorway actually is, in lockstep with its gap,
              // instead of at the same raw fraction on a differently-sized
              // wall.
              const wallDx = wb.x - wa.x;
              const wallDy = wb.y - wa.y;
              const wallLen2 = wallDx * wallDx + wallDy * wallDy || 1;
              const wallLen = Math.sqrt(wallLen2);
              const distFromWallLine = (p) =>
                Math.abs((p.x - wa.x) * wallDy - (p.y - wa.y) * wallDx) / wallLen;
              const rawT = (p) => ((p.x - wa.x) * wallDx + (p.y - wa.y) * wallDy) / wallLen2;
              // Absorb an opening owned by `ownerA→ownerB` (its own edge, in
              // world units). Only accept it if its physical centre truly sits
              // on this shared wall — this alone stops a window on an external
              // wall (whose centre is metres away) from being dragged onto a
              // perpendicular shared wall by a mis-cardinal edge match.
              const absorbWorld = (op, ownerA, ownerB) => {
                if (!op?.id || seen.has(op.id) || isVerticalOpeningType(op.type)) return;
                const oAlong = Number.isFinite(op.along) ? op.along : 0.5;
                const center = {
                  x: ownerA.x + (ownerB.x - ownerA.x) * oAlong,
                  y: ownerA.y + (ownerB.y - ownerA.y) * oAlong,
                };
                if (distFromWallLine(center) > 1.0) return;
                const t = rawT(center);
                if (t < -0.02 || t > 1.02) return;
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
        }
      }

      planInk += drawEdgePlan(sa, sb, drawOpenings, {
        m,
        selected,
        linked,
        isExternal,
        cx,
        cy,
        skipRange,
        threshold,
        fixturesOn,
        fixturePlaceOn,
        ownerPlaceId: child.id,
        ownerEdge: i,
        renderedOpeningIds,
        esc,
      }).join('\n');

      if (wallsOn) {
        edgeHits += `<line class="bst-suite-edge-hit${selected ? ' sel' : ''}" x1="${sa.x.toFixed(1)}" y1="${sa.y.toFixed(1)}" x2="${sb.x.toFixed(1)}" y2="${sb.y.toFixed(1)}"
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
        stairs += stairPlanGlyph(p, up, {
          gClass,
          placeId: esc(child.id),
          linkId: esc(link.id),
          opnId: esc(op.id),
          type: esc(op.type || ''),
          title: esc(op.label || op.type || (up ? 'ascent' : 'descent')),
          m,
        });
      }
    }

    labels += `<text class="bst-suite-label" x="${cx.toFixed(1)}" y="${cy.toFixed(1)}" text-anchor="middle" dominant-baseline="middle">${here ? '● ' : ''}${esc(child.name)}</text>`;
    if (arrangeOn) {
      labels += `<circle class="bst-suite-handle" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="8"
        data-action="suite-drag-child" data-place="${esc(child.id)}" data-unit="${esc(unit.id)}" />`;
    }
    fills += `</g>`;
  }

  for (const [idx, pair] of pairs.entries()) {
    const ov = overlapWorld(pair);
    if (!ov) continue;
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
    sharedHits += `<g class="bst-suite-shared-g" data-shared-idx="${idx}">
      ${selected ? `<line class="${cls}" x1="${p1.x.toFixed(1)}" y1="${p1.y.toFixed(1)}" x2="${p2.x.toFixed(1)}" y2="${p2.y.toFixed(1)}" />` : ''}
      <line class="bst-suite-shared-hit" x1="${p1.x.toFixed(1)}" y1="${p1.y.toFixed(1)}" x2="${p2.x.toFixed(1)}" y2="${p2.y.toFixed(1)}"
        data-action="suite-select-shared"
        data-a="${esc(pair.aId)}" data-b="${esc(pair.bId)}"
        data-wall-a="${esc(pair.wallA)}" data-wall-b="${esc(pair.wallB)}"
        data-unit="${esc(unit.id)}" />
    </g>`;
  }

  const selLabel = selectedShared
    ? `${byId[selectedShared.aId]?.name || selectedShared.aId} · ${selectedShared.wallA} ↔ ${byId[selectedShared.bId]?.name || selectedShared.bId}`
    : (selectedEdge ? `${byId[selectedEdge.placeId]?.name || selectedEdge.placeId} · edge ${selectedEdge.edge}` : '');

  const modeBtn = (id, label) =>
    `<button type="button" class="bst-chip${mode === id ? ' on' : ''}" data-action="suite-mode" data-mode="${id}" data-unit="${esc(unit.id)}">${label}</button>`;

  const hints = {
    browse: 'Click a room to select it, then We’re here to pin the scene location — or Open room for its floorplan.',
    arrange: 'Drag room handles to move; edges snap and create wall links. Openings stay manual.',
    walls: 'Drag a wall to reshape that room — hold Shift for fine increments, Alt for coarse. Click (don\'t drag) a wall to select it: manage its link/external/openings below, or pick 2 walls on the same room to Divide it. Click a shared wall, then Merge / Threshold. Align welds nearest corners.',
    fixtures: fixAct === 'remove'
      ? 'Remove mode — click a door, window, arch, or passage to delete it (removed from the linked room too).'
      : fixAct === 'place'
        ? 'Place mode — click an empty stretch of wall to add a fixture, or drag an existing one to slide it. Changes sync to the linked room\'s floorplan.'
        : 'Move mode — drag any fixture along its wall to slide it, or click one to edit it. Changes sync to the linked room\'s floorplan.',
  };

  const hereChild = herePlaceId && children.some(c => c.id === herePlaceId)
    ? byId[herePlaceId]
    : null;
  const pickChild = (focusChildId && byId[focusChildId]) || hereChild || children[0];
  const hereOn = !!(hereChild && herePlaceId);
  const hereCaption = hereOn
    ? `Here · ${hereChild.name}${hereCell ? ` · ${hereCell}` : ''}`
    : (pickChild ? `Pin ${pickChild.name} as the current location` : 'Select a room, then We’re here');

  return `
    <div class="bst-suite" data-role="suite-canvas" data-unit="${esc(unit.id)}" data-mode="${esc(mode)}"
      data-bounds-min-x="${bounds.minX}" data-bounds-min-y="${bounds.minY}" data-bounds-w="${bw}" data-bounds-h="${bh}"
      data-svg-w="${svgW}" data-svg-h="${svgH}">
      <div class="bst-suite-toolbar">
        ${modeBtn('browse', 'Browse')}
        ${modeBtn('arrange', 'Arrange')}
        ${modeBtn('walls', 'Walls')}
        ${modeBtn('fixtures', 'Fixtures')}
        <button type="button" class="bst-btn" data-action="suite-align" data-unit="${esc(unit.id)}" title="Visually weld contacting walls so shared faces line up — each room's own floorplan keeps its real proportions" ${children.length < 2 ? 'disabled' : ''}>Align</button>
        ${Object.keys(visualFootprints).length
          ? `<button type="button" class="bst-btn" data-action="suite-align-reset" data-unit="${esc(unit.id)}" title="Go back to each room's real, unaligned proportions in this suite view">Reset align</button>`
          : ''}
        <button type="button" class="bst-btn gold" data-action="set-here" data-place="${esc(pickChild?.id || '')}" data-cell="${esc(hereCell || 'C')}" ${pickChild ? '' : 'disabled'} title="Pin the highlighted (or current) room as the scene location">We're here</button>
        ${pickChild
          ? `<button type="button" class="bst-btn" data-action="suite-open-child" data-place="${esc(pickChild.id)}" data-unit="${esc(unit.id)}">Open room</button>`
          : ''}
        ${hereOn ? `<span class="bst-chip on">${esc(hereCaption)}</span>` : `<span class="bst-k">${esc(hereCaption)}</span>`}
        <span class="bst-k">${children.length} room${children.length === 1 ? '' : 's'} · ${pairs.length} shared wall${pairs.length === 1 ? '' : 's'}</span>
      </div>
      ${wallsOn ? `<div class="bst-suite-toolbar bst-suite-wall-tools">
        <button type="button" class="bst-btn" data-action="suite-shared-style" data-style="merged" data-unit="${esc(unit.id)}" ${selectedShared ? '' : 'disabled'}>Merge</button>
        <button type="button" class="bst-btn" data-action="suite-shared-style" data-style="threshold" data-unit="${esc(unit.id)}" ${selectedShared ? '' : 'disabled'}>Threshold</button>
        <button type="button" class="bst-btn" data-action="suite-divide-room" data-place="${esc(divideRoomId)}" data-unit="${esc(unit.id)}" ${suiteSelEdges.length === 2 ? '' : 'disabled'} title="Click 2 walls on the same room (not drag) to cut a new dividing wall between their midpoints, forming a new sibling room">Divide room</button>
        ${selLabel ? `<span class="bst-k">Selected · ${esc(selLabel)}</span>` : '<span class="bst-k">Select a shared wall to Merge / Threshold — drag any wall to reshape</span>'}
        ${suiteSelEdges.length ? `<span class="bst-k">${suiteSelEdges.length}/2 wall(s) picked for divide</span>` : ''}
      </div>
      ${renderSuiteWallLinksPanel({ compass, unit, children, byId, selectedEdge, esc })}` : ''}
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
      </div>` : ''}
      <p class="bst-hint">${hints[mode] || hints.browse}</p>
      <div class="bst-suite-viewport">
        <svg class="bst-suite-svg" viewBox="0 0 ${svgW} ${svgH}" width="100%" height="${svgH}">
          ${fills}
          ${planInk}
          ${stairs}
          ${sharedHits}
          ${edgeHits}
          ${labels}
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
    for (const [t0, t1] of solid) {
      const p0 = lerpPt(a, b, t0);
      const p1 = lerpPt(a, b, t1);
      if (isThreshold) {
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
      edgeLines.push(`<line class="bst-fp-opening-hit ${hollowClass}"
        x1="${p0.x.toFixed(1)}" y1="${p0.y.toFixed(1)}" x2="${p1.x.toFixed(1)}" y2="${p1.y.toFixed(1)}"
        data-action="compass-drag-opening" data-place="${esc(placeId)}" data-link="${esc(cut.link.id)}" data-opn="${esc(cut.op.id)}" data-edge="${i}" data-type="${esc(opType)}" />`);

      const gClass = `bst-fp-fixture ${kind.glyph}${cut.op.locked ? ' locked' : ''}`;
      fixtureGlyphs.push(...kind.drawGlyph({
        p0, p1, mid, nrm, inward, gClass, isExternal,
      }));
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

  const hints = {
    move: 'Drag the room fill to slide the whole shape on the grid (keeps proportions). Scroll to zoom · drag empty space to pan the view.',
    walls: 'Drag borders to reshape · drag on the grid to draw an internal barrier · click a barrier to remove it. Barriers block area sight.',
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
export function renderFloorplanReadonly(room, { placeId, esc, parentName = '' } = {}) {
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
    for (const [t0, t1] of solid) {
      const p0 = lerpPt(a, b, t0);
      const p1 = lerpPt(a, b, t1);
      if (isThreshold) {
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
    }
  }

  const internalWalls = (room.internalWalls || []).map(w => {
    const a = { x: pad + w.x0 * inner, y: pad + w.y0 * inner };
    const b = { x: pad + w.x1 * inner, y: pad + w.y1 * inner };
    return `<line class="bst-fp-barrier" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" />`;
  }).join('');

  const areaDots = CELLS.map(id => {
    const c = areaCenterInFootprint(id, fp);
    const p = { x: pad + c.x * inner, y: pad + c.y * inner };
    return `<circle class="bst-fp-area-dot" cx="${p.x}" cy="${p.y}" r="3" />
      <text class="bst-fp-area-label" x="${p.x}" y="${p.y - 6}" text-anchor="middle">${id}</text>`;
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

