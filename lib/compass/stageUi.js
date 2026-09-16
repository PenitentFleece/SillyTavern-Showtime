// Room Compass — Backstage Set / Placement HTML fragments.

import {
  CELLS,
  CELL_ROWS,
  FACINGS,
  PLACE_KINDS,
  placeKindMeta,
  isLoadableKind,
} from './schema.js';
import {
  buildPlaceTree,
  gatherPeerViews,
  getPlace,
  ensureSuiteLayout,
} from './state.js';
import { cellSummaryBits, renderFloorplan, renderFloorplanReadonly, renderSuiteFloorplan } from './dialogs.js';
import { formatWallLinkLabel } from './floorplan.js';
import { isSuiteChild } from './suiteLayout.js';
import { formatPovBlock } from './render.js';
import {
  listAreaContents,
  accessibleAreas,
  listSonarPingsInPlace,
  areaObserver,
} from './sonar.js';
import { locationTagEditorHTML } from '../locationTagPicker.js';

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
  auditReport = null,
  placesOpen = null,
  metaOpen = false,
  herePlaceId = '',
  hereCell = 'C',
  esc,
}) {
  const tree = buildPlaceTree(compass);
  const focus = getPlace(compass, focusId) || active || null;
  const focusIsLoadable = focus ? isLoadableKind(focus.kind) : false;
  const focusIsUnit = focus?.kind === 'unit';
  const editing = focusIsLoadable ? focus : active;
  const cell = selCell || 'C';
  const peeks = editing ? gatherPeerViews(compass, editing) : [];
  const suiteModeSafe = ['arrange', 'walls', 'fixtures'].includes(suiteMode) ? suiteMode : 'browse';
  const suiteFixtureActSafe = suiteFixtureAct === 'remove' ? 'remove' : (suiteFixtureAct === 'place' ? 'place' : '');

  if (focusIsUnit) {
    try { ensureSuiteLayout(compass, focus.id); } catch { /* ignore */ }
  }
  const unitFresh = focusIsUnit ? getPlace(compass, focus.id) : null;
  // Places starts open when empty (nothing to hide yet / nowhere else to go)
  // or when explicitly reopened; otherwise default collapsed so the
  // floorplan work area is reachable without scrolling past the tree.
  const placesIsOpen = placesOpen == null ? tree.length === 0 : !!placesOpen;

  const jumpLinks = [
    unitFresh ? `<a class="bst-chip" href="#bst-suite-plan">↓ Suite plan</a>` : '',
    editing ? `<a class="bst-chip" href="#bst-room-layout">↓ Room layout</a>` : '',
  ].filter(Boolean).join('');

  return `
    <h2 class="bst-pane-title">Set</h2>
    <p class="bst-pane-sub">Map the house — places, suite plans, floorplan shape, compass areas, and wall links.</p>
    ${renderSonarStrip(sonarStatus, sonarNote, esc)}
    ${jumpLinks ? `<div class="bst-row bst-set-jumpnav">${jumpLinks}</div>` : ''}

    <details class="bst-section bst-fold" data-fold="set-places" ${placesIsOpen ? 'open' : ''}>
      <summary class="bst-section-h">Places <span class="bst-k">· ${tree.length}</span></summary>
      <div class="bst-fold-body">
      ${renderCreateForm(compass, esc)}
      ${tree.length
        ? `<div class="bst-compass-tree">${tree.map(({ place, depth }) => {
          const on = place.id === compass.activeRoomId;
          const focused = place.id === (focus?.id || '');
          const meta = placeKindMeta(place.kind);
          const pad = Math.min(depth, 6) * 14;
          return `<div class="bst-compass-tree-row${focused ? ' focus' : ''}" style="padding-left:${pad}px">
            <button type="button" class="bst-chip${on ? ' on' : ''}${focused ? ' focus' : ''}" data-action="compass-focus" data-place="${esc(place.id)}" title="${esc(place.id)}">
              ${on ? '● ' : ''}${esc(place.name)}
              <span class="bst-k">${esc(meta?.label || place.kind)}${place.exposed ? ' · exposed' : ''}</span>
            </button>
            ${isLoadableKind(place.kind)
              ? `<button type="button" class="bst-btn" data-action="compass-load" data-room="${esc(place.id)}">${on ? 'Loaded' : 'Load'}</button>`
              : ''}
          </div>`;
        }).join('')}</div>`
        : '<div class="bst-empty">No places yet — create a region, building, unit, or room above.</div>'}
      </div>
    </details>

    ${focus ? renderFocusMeta(focus, compass, esc, metaOpen) : ''}

    ${unitFresh
      ? `<section class="bst-section" id="bst-suite-plan">
          <h3 class="bst-section-h">Suite plan · ${esc(unitFresh.name)}</h3>
          ${renderSuiteFloorplan(unitFresh, compass, {
            mode: suiteModeSafe,
            esc,
            focusChildId: suiteHighlightChild || '',
            selectedShared,
            selectedEdge,
            suiteSelEdges,
            fixtureAct: suiteFixtureActSafe,
            herePlaceId: herePlaceId || compass.activeRoomId || '',
            hereCell: hereCell || cell,
          })}
        </section>`
      : ''}

    ${editing
      ? `<div id="bst-room-layout">${renderSetLayout({
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
        esc,
      })}</div>`
      : (!focusIsUnit
        ? `<section class="bst-section"><div class="bst-empty">Select a Unit for the suite plan, or a Room / Hall to edit the floorplan and compass areas.</div></section>`
        : '')}

    ${renderAuditPanel(auditReport, esc)}
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
  esc,
}) {
  const tree = buildPlaceTree(compass).filter(({ place }) => isLoadableKind(place.kind));
  const focus = getPlace(compass, focusId) || active || null;
  const editing = focus && isLoadableKind(focus.kind) ? focus : active;
  const cell = selCell || 'C';
  const access = editing ? accessibleAreas(cell, editing, { reach: sonarReach }) : [cell];
  const pings = editing ? listSonarPingsInPlace(compass, editing.id) : [];
  const lost = Array.isArray(compass?.lostAndFound) ? compass.lostAndFound : [];

  const placeOpts = [
    `<option value="">— Room / hall —</option>`,
    ...tree.map(({ place }) =>
      `<option value="${esc(place.id)}"${place.id === (editing?.id || '') ? ' selected' : ''}>${esc(place.name)}</option>`),
  ].join('');

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
    ${renderSonarStrip(sonarStatus, sonarNote, esc)}

    <section class="bst-section">
      <h3 class="bst-section-h">Room</h3>
      <div class="bst-row">
        <select class="bst-input" data-role="placement-place" style="flex:1">${placeOpts}</select>
        <button type="button" class="bst-btn" data-action="placement-focus">Open</button>
        ${editing ? `<button type="button" class="bst-btn gold" data-action="compass-load" data-room="${esc(editing.id)}">Load on compass</button>` : ''}
      </div>
    </section>

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
      <h3 class="bst-section-h">Areas · ${esc(editing.name)}</h3>
      <p class="bst-hint">Select an area to list its pieces. Visible reach from here: <strong>${esc(access.join(', '))}</strong></p>
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
              return `<button type="button" class="bst-compass-cell${id === cell ? ' on' : ''}${inReach && id !== cell ? ' reach' : ''}" data-action="compass-select-area" data-cell="${id}" data-place="${esc(editing.id)}" title="Area ${id}">
                <span class="bst-compass-cell-id">${id}</span>
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
    ` : '<section class="bst-section"><div class="bst-empty">Open a room or hall to dress areas.</div></section>'}
  `;
}

function renderSonarStrip(status, sonarNote, esc) {
  if (!status && !sonarNote) return '';
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
  return `
    <div class="bst-sonar-strip">
      <div class="bst-row" style="align-items:center;justify-content:space-between;gap:8px">
        <div class="bst-hint" style="margin:0">${head}</div>
        <button type="button" class="bst-btn" data-action="set-sonar-check">Check sonar</button>
      </div>
      ${body}
    </div>`;
}

function renderAuditPanel(report, esc) {
  const findings = Array.isArray(report?.findings) ? report.findings : [];
  const counts = report?.counts || { error: 0, warn: 0, info: 0 };
  const safeN = findings.filter(f => f?.fix?.type === 'mark-external').length;
  const list = findings.length
    ? `<ul class="bst-audit-list">${findings.map(f => `
        <li class="bst-audit-item" data-sev="${esc(f.severity || 'info')}">
          <span class="bst-audit-sev">${esc((f.severity || 'info').toUpperCase())}</span>
          <div>
            <strong>${esc(f.title)}</strong>
            ${f.placeName ? `<span class="bst-k">${esc(f.placeName)}</span>` : ''}
            ${f.hint ? `<div class="bst-audit-hint">${esc(f.hint)}</div>` : ''}
          </div>
        </li>`).join('')}</ul>`
    : '<div class="bst-empty">No floorplan issues — walls, doors, and egress look coherent.</div>';
  return `
    <section class="bst-section bst-set-audit">
      <div class="bst-row" style="align-items:baseline;justify-content:space-between;gap:8px">
        <h3 class="bst-section-h" style="margin:0">Floorplan Audit</h3>
        <div class="bst-row" style="margin:0;gap:6px">
          <span class="bst-k">${counts.error || 0} error · ${counts.warn || 0} warn · ${counts.info || 0} note</span>
          ${safeN ? `<button type="button" class="bst-btn gold" data-action="set-audit-fix" title="Mark unlinked door walls as external">Fix ${safeN} safe</button>` : ''}
          <button type="button" class="bst-btn" data-action="set-audit">Re-audit</button>
        </div>
      </div>
      <p class="bst-hint">Local sensibility check — exterior doors, egress, stairs, overlapping suite rooms, and scale. Does not rewrite the map unless you press Fix safe.</p>
      ${list}
    </section>`;
}

/** @deprecated use buildSetHtml */
export function buildStageHtml(opts) {
  return buildSetHtml(opts);
}

/**
 * Compact horizontal strip of pieces in an area.
 * Description / actions appear in the detail panel when an item is selected.
 * @param {{ placeId: string, editable?: boolean, esc: Function }} opts
 */
export function renderAreaItemList(room, cellId, { placeId, editable = false, esc }) {
  const pieces = listAreaContents(room, cellId);
  const areaOpts = CELLS.map(c => `<option value="${c}">${c}</option>`).join('');
  return `
    <div class="bst-area-list" data-role="area-list" data-cell="${esc(cellId)}" data-place="${esc(placeId)}">
      <div class="bst-k">In ${esc(cellId)} · ${pieces.length} item${pieces.length === 1 ? '' : 's'}</div>
      <ul class="bst-area-list-scroll" role="listbox" aria-label="Area contents">
        ${pieces.length
          ? pieces.map(it => {
            const tags = [it.layer];
            if (it.cells?.length > 1) tags.push(it.cells.join('+'));
            if (it.occupiable) tags.push(`sit×${it.maxOccupancy || 1}`);
            if (it.contains) tags.push(it.contentsVisible === 'inside' ? 'inside' : 'display');
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
          return `<div class="bst-area-list-panel" data-for="${esc(it.id)}" hidden>
            ${it.description
              ? `<div class="bst-area-list-desc">${esc(it.description)}</div>`
              : '<div class="bst-hint">No description.</div>'}
            ${editable ? `
            <div class="bst-area-list-acts">
              <button type="button" class="bst-btn" data-action="placement-edit-piece" data-place="${esc(placeId)}" data-cell="${esc(anchor)}" data-layer="${esc(it.layer)}" data-id="${esc(it.id)}">Edit</button>
              <label class="bst-k">Move
                <select class="bst-input bst-area-move" data-role="placement-move-piece" data-place="${esc(placeId)}" data-cell="${esc(anchor)}" data-layer="${esc(it.layer)}" data-id="${esc(it.id)}">
                  <option value="">—</option>
                  ${areaOpts}
                </select>
              </label>
              <button type="button" class="bst-btn danger" data-action="placement-del-piece" data-place="${esc(placeId)}" data-cell="${esc(anchor)}" data-layer="${esc(it.layer)}" data-id="${esc(it.id)}">Lost &amp; Found</button>
            </div>` : ''}
          </div>`;
        }).join('')}
        ${pieces.length
          ? '<div class="bst-area-list-panel bst-area-list-panel--hint" data-role="area-list-hint">Select an item for details.</div>'
          : ''}
      </div>
    </div>`;
}

function renderCreateForm(compass, esc) {
  const parents = Object.values(compass.rooms || {})
    .sort((a, b) => a.name.localeCompare(b.name));
  const kindOpts = PLACE_KINDS.map(k =>
    `<option value="${esc(k.id)}"${k.id === 'room' ? ' selected' : ''}>${esc(k.label)}</option>`).join('');
  const parentOpts = [
    `<option value="">— Root —</option>`,
    ...parents.map(p => `<option value="${esc(p.id)}">${esc(p.name)} (${esc(p.kind)})</option>`),
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
      </div>
      <div class="bst-row">
        <input class="bst-input" style="width:7em" data-role="room-id" placeholder="id (auto)">
        <input class="bst-input" style="flex:1" data-role="room-name" placeholder="Display name">
        <input class="bst-input" style="flex:1" data-role="place-desc" placeholder="Description (narrative)">
        <button type="button" class="bst-btn gold" data-action="compass-create">Create</button>
      </div>
      <div class="bst-row" style="align-items:flex-start">
        <label class="bst-field" style="flex:1;margin:0"><span>Location tags</span>
          ${locationTagEditorHTML({
            selected: [],
            fieldRole: 'place-loctags',
            emptyHint: 'Country → city → area → building. Rooms stay off this list.',
          })}
        </label>
      </div>
    </div>`;
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
      </div>
      <div class="bst-row" style="align-items:flex-start">
        <label class="bst-field" style="flex:1;margin:0"><span>Location tags</span>
          ${locationTagEditorHTML({
            selected: tags,
            fieldRole: 'focus-loctags',
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
        ${isLoadableKind(focus.kind)
          ? `<button type="button" class="bst-chip${focus.exposed ? ' on' : ''}" data-action="compass-toggle-exposed" data-place="${esc(focus.id)}" data-on="${focus.exposed ? '0' : '1'}" title="Exposed to weather / outdoors">Exposed</button>
             <button type="button" class="bst-btn gold" data-action="compass-load" data-room="${esc(focus.id)}">Load on compass</button>
             <button type="button" class="bst-btn" data-action="compass-unload">Unload</button>`
          : ''}
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

  const floorplanPane = suiteChild
    ? `<div class="bst-floorplan-center">
        ${renderFloorplanReadonly(editing, { placeId: editing.id, esc, parentName: parent?.name || '' })}
      </div>`
    : `<div class="bst-floorplan-center">
        ${renderFloorplan(editing, { placeId: editing.id, selectedEdges: sel, drawWallMode, fpMode, fixtureAct, esc })}
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
        ${hereOn ? `<span class="bst-chip on">${esc(hereLabel)}</span>` : `<span class="bst-k">Pin this room + area as the current location</span>`}
      </div>
      <p class="bst-hint">${suiteChild
        ? '<strong>Floorplan</strong> (right) — this room\'s shape, compass, and fixtures as they appear in its Suite (read-only). <strong>Compass</strong> (left) — select an area to list what sits there.'
        : '<strong>Floorplan</strong> (right) — pan/zoom, reshape. <strong>Compass</strong> (left) — select an area to list what sits there.'}</p>
      <div class="bst-compass-stage bst-compass-stage--side">
        <div class="bst-compass-side">
          <div class="bst-k">Compass · areas</div>
          <div class="bst-compass-grid bst-compass-grid-sm" role="grid" aria-label="Room areas">
            ${CELL_ROWS.map(row => row.map(id => {
              const { n, nOcc, nDoor } = cellSummaryBits(editing, id);
              const bits = [
                nOcc ? `${nOcc}p` : '',
                n ? `${n}` : '',
                nDoor ? '⇢' : '',
              ].filter(Boolean).join(' ');
              return `<button type="button" class="bst-compass-cell${id === cell ? ' on' : ''}" data-action="compass-select-area" data-cell="${id}" data-place="${esc(editing.id)}" title="Area ${id}">
                <span class="bst-compass-cell-id">${id}</span>
                <span class="bst-k">${esc(bits)}</span>
              </button>`;
            }).join('')).join('')}
          </div>
          ${renderAreaItemList(editing, cell, { placeId: editing.id, editable: false, esc })}
          <div class="bst-hint" style="margin-top:4px">Edit / move / delete in <strong>Placement</strong>.</div>
          ${pings.length
            ? `<div class="bst-hint bst-sonar-pings">Sonar: ${pings.map(p => `${esc(p.name)}@${esc(p.cell)}`).join(' · ')}</div>`
            : ''}
        </div>
        ${floorplanPane}
      </div>
    </section>

    ${suiteChild
      ? renderVerticalLinksPanel({ compass, editing, places, wallLinksOpen, peeks, esc })
      : renderWallLinksPanel({ compass, editing, places, sel, wallLinksOpen, peeks, esc })}`;
}

/** Full lateral + vertical wall-links panel — standalone rooms only (no suite to defer to). */
function renderWallLinksPanel({ compass, editing, places, sel, wallLinksOpen, peeks, esc }) {
  return `
    <details class="bst-section bst-fold" data-fold="set-wall-links" ${wallLinksOpen ? 'open' : ''}>
      <summary class="bst-section-h">Wall links</summary>
      <div class="bst-fold-body">
      <p class="bst-hint">Select floorplan walls or above/below. Drag a wall along its axis to resize. Neighbor list is limited to places under the same parent.</p>
      <div class="bst-row bst-multi-chips">
        <button type="button" class="bst-chip${sel.size ? ' on' : ''}" disabled title="From floorplan">${sel.size ? `${sel.size} wall(s)` : 'No walls selected'}</button>
        <button type="button" class="bst-chip" data-action="compass-toggle-wall" data-wall="above">above</button>
        <button type="button" class="bst-chip" data-action="compass-toggle-wall" data-wall="below">below</button>
      </div>
      <div class="bst-row" style="margin-top:6px">
        <select class="bst-input" data-role="link-to" style="flex:1">
          <option value="">— Neighbor place —</option>
          ${places.length
            ? places.map(p => `<option value="${esc(p.id)}">${esc(p.name)} (${esc(p.kind)})</option>`).join('')
            : '<option value="" disabled>No siblings under the same parent</option>'}
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
function renderVerticalLinksPanel({ compass, editing, places, wallLinksOpen, peeks, esc }) {
  const verticalLinks = (editing.links || []).filter(l => l.wall === 'above' || l.wall === 'below');
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
          <option value="">— Neighbor place —</option>
          ${places.length
            ? places.map(p => `<option value="${esc(p.id)}">${esc(p.name)} (${esc(p.kind)})</option>`).join('')
            : '<option value="" disabled>No siblings under the same parent</option>'}
        </select>
      </div>
      <div class="bst-row">
        <input class="bst-input" style="flex:1" data-role="link-desc" placeholder="Link description (when the exit is noticed)">
        <button type="button" class="bst-btn gold" data-action="compass-add-link" data-place="${esc(editing.id)}">Link selected</button>
      </div>
      ${renderWallLinkRows(compass, editing, verticalLinks, esc, 'No vertical exits yet — toggle above / below, pick a neighbor, then Link selected.')}
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
        ? (neigh?.name || link.toPlaceId)
        : (link.external ? 'outside' : '—');
      const opnBits = (link.openings || []).map(op =>
        `${op.type}${op.locked ? '🔒' : ''}${op.peer ? '👁' : ''}`).join(', ') || 'no openings';
      const styleChip = link.sharedStyle === 'threshold'
        ? '<span class="bst-chip" title="Open threshold">threshold</span>'
        : '';
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
