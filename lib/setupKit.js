// Draft wardrobe, props, and closet for the setup sheet.
// Same shapes Cast files: worn clothes, carried props (with containers),
// and closet looks whose parts are sortable chips. Nothing is saved here.

import { inferKitKind, kitChildren, kitRoots } from './kitNest.js';
import { OUTFIT_TYPES, outfitTypeMeta, normalizeOutfits } from './wardrobeOutfits.js';

const CONDITIONS = [
  { id: 'pristine', label: 'Pristine', color: '#6b8f4a' },
  { id: 'fine', label: 'Fine', color: '#7a9e52' },
  { id: 'worn', label: 'Worn', color: '#8a9a4a' },
  { id: 'damaged', label: 'Damaged', color: '#c9a24a' },
  { id: 'broken', label: 'Broken', color: '#c4772b' },
  { id: 'ruined', label: 'Ruined', color: '#7a1f1f' },
];
const CONDITION_IDS = new Set(CONDITIONS.map(c => c.id));

const drafts = new WeakMap();

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, ch => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

function uid() {
  return crypto.randomUUID?.() || `k-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function condMeta(id) {
  return CONDITIONS.find(c => c.id === id) || CONDITIONS[0];
}

export function emptyKit() {
  return { wardrobe: [], props: [], shelf: [], outfits: [] };
}

export function kitOf(row) {
  let kit = drafts.get(row);
  if (!kit) {
    kit = emptyKit();
    drafts.set(row, kit);
  }
  return kit;
}

export function readKit(row) {
  const kit = kitOf(row);
  return {
    wardrobe: kit.wardrobe.map(x => ({ ...x })),
    props: kit.props.map(x => ({ ...x })),
    shelf: kit.shelf.map(x => ({ ...x })),
    outfits: kit.outfits.map(x => ({ ...x, partIds: [...(x.partIds || [])] })),
  };
}

function adoptItems(list, { props = false } = {}) {
  const rows = (Array.isArray(list) ? list : []).map(raw => {
    const name = String(typeof raw === 'string' ? raw : raw?.name || '').trim();
    if (!name) return null;
    const src = raw && typeof raw === 'object' ? raw : {};
    const kind = props && (src.kind === 'container' || inferKitKind({ name, kind: src.kind }) === 'container')
      ? 'container'
      : 'item';
    return {
      id: String(src.id || uid()),
      name,
      description: String(src.description || '').trim(),
      condition: CONDITION_IDS.has(src.condition) ? src.condition : 'pristine',
      kind: props ? kind : 'item',
      parentId: props ? String(src.parentId || '') : '',
    };
  }).filter(Boolean);
  const ids = new Set(rows.map(r => r.id));
  for (const row of rows) {
    if (row.parentId && !ids.has(row.parentId)) row.parentId = '';
  }
  return rows;
}

function adoptShelf(list) {
  return (Array.isArray(list) ? list : []).map(raw => {
    const name = String(raw?.name || '').trim();
    if (!name) return null;
    return {
      id: String(raw.id || uid()),
      name,
      description: String(raw.description || '').trim(),
    };
  }).filter(Boolean);
}

function unionByName(dest, extra) {
  const seen = new Set(dest.map(x => String(x.name || '').trim().toLowerCase()));
  for (const item of extra) {
    const key = String(item.name || '').trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    dest.push(item);
  }
}

export function adoptKit(row, source, { merge = false } = {}) {
  const kit = kitOf(row);
  const wardrobe = adoptItems(source?.wardrobe, { props: false });
  const props = adoptItems(source?.props, { props: true });
  const shelf = adoptShelf(source?.shelf);
  const outfits = normalizeOutfits(source?.outfits);
  if (merge) {
    unionByName(kit.wardrobe, wardrobe);
    unionByName(kit.props, props);
    unionByName(kit.shelf, shelf);
    const seenLooks = new Set(kit.outfits.map(o => String(o.title || '').trim().toLowerCase()));
    for (const look of outfits) {
      const key = String(look.title || '').trim().toLowerCase();
      if (!key || seenLooks.has(key)) continue;
      seenLooks.add(key);
      kit.outfits.push(look);
    }
    const ids = new Set(kit.props.map(x => x.id));
    for (const item of kit.props) {
      if (item.parentId && !ids.has(item.parentId)) item.parentId = '';
    }
  } else {
    kit.wardrobe = wardrobe;
    kit.props = props;
    kit.shelf = shelf;
    kit.outfits = outfits;
  }
  renderKit(row);
}

export function namesToKit(row, { closet = [], props = [] } = {}) {
  const kit = kitOf(row);
  kit.wardrobe = adoptItems(closet, { props: false });
  kit.props = adoptItems(props, { props: true });
  row._kitEdit = null;
  renderKit(row);
}

function moveInList(list, id, dir, parentKey) {
  const item = list.find(x => x.id === id);
  if (!item) return;
  const key = parentKey(item);
  const siblings = list.filter(x => parentKey(x) === key);
  const i = siblings.findIndex(x => x.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= siblings.length) return;
  const a = list.indexOf(siblings[i]);
  const b = list.indexOf(siblings[j]);
  [list[a], list[b]] = [list[b], list[a]];
}

function itemFormHTML(kind, item, list) {
  const boxes = (list || []).filter(x => x.kind === 'container' && x.id !== item?.id);
  return `
    <div class="showtime-setup-kitform" data-item-form data-kind="${kind}">
      <label>Name <input type="text" data-field="name" value="${esc(item?.name || '')}"></label>
      <label>Description <textarea data-field="description" rows="2">${esc(item?.description || '')}</textarea></label>
      <label>Condition
        <select data-field="condition">
          ${CONDITIONS.map(c => `<option value="${c.id}" ${c.id === (item?.condition || 'pristine') ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}
        </select>
      </label>
      ${kind === 'props' ? `
        <label>What is this?
          <select data-field="kind">
            <option value="item" ${item?.kind !== 'container' ? 'selected' : ''}>Item</option>
            <option value="container" ${item?.kind === 'container' ? 'selected' : ''}>Container</option>
          </select>
        </label>
        <label>Inside
          <select data-field="parentId">
            <option value="">Loose / carried</option>
            ${boxes.map(b => `<option value="${esc(b.id)}" ${item?.parentId === b.id ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}
          </select>
        </label>` : ''}
      <div class="showtime-setup-row-actions">
        <button type="button" data-kit-action="save-item">Save</button>
        <button type="button" data-kit-action="cancel-edit">Cancel</button>
      </div>
    </div>`;
}

function itemRowHTML(item, depth, list) {
  const cond = condMeta(item.condition);
  const parent = item.parentId ? list.find(x => x.id === item.parentId) : null;
  return `
    <div class="showtime-setup-chiprow${depth ? ' is-nested' : ''}" data-item-id="${esc(item.id)}" style="margin-left:${depth * 14}px;border-left-color:${cond.color}">
      <button type="button" data-kit-action="move-item" data-dir="-1" title="Move up">↑</button>
      <button type="button" data-kit-action="move-item" data-dir="1" title="Move down">↓</button>
      <span class="showtime-setup-chipname" title="${esc(item.description || '')}">${item.kind === 'container' ? '▣ ' : ''}${esc(item.name)}</span>
      ${parent ? `<span class="showtime-setup-tag showtime-setup-tag--quiet">in ${esc(parent.name)}</span>` : ''}
      <button type="button" class="showtime-setup-tag" data-kit-action="cycle-cond" style="background:${cond.color}" title="Condition">${esc(cond.label)}</button>
      <button type="button" data-kit-action="edit-item">Edit</button>
      <button type="button" data-kit-action="drop-item">×</button>
    </div>`;
}

function branchHTML(list, parentId, depth) {
  const rows = parentId
    ? kitChildren(list, parentId)
    : kitRoots(list);
  return rows.map(item => itemRowHTML(item, depth, list) + branchHTML(list, item.id, depth + 1)).join('');
}

function listBlock(title, kind, list, edit) {
  const adding = edit?.view === kind && !edit.id;
  const body = kind === 'props' ? branchHTML(list, '', 0) : list.map(item => itemRowHTML(item, 0, list)).join('');
  const editing = edit?.view === kind && edit.id ? list.find(x => x.id === edit.id) : null;
  return `
    <div class="showtime-setup-kithead"><span>${title}</span>
      <span class="showtime-setup-kitacts">
        ${list.length ? `<button type="button" data-kit-action="clear-items" data-kind="${kind}">Clear</button>` : ''}
        <button type="button" data-kit-action="add-item" data-kind="${kind}">+ Add</button>
      </span>
    </div>
    ${body || '<div class="showtime-setup-empty">None</div>'}
    ${adding ? itemFormHTML(kind, null, list) : ''}
    ${editing ? itemFormHTML(kind, editing, list) : ''}`;
}

function pieceName(kit, id) {
  const hit = [...kit.wardrobe, ...kit.props, ...kit.shelf].find(x => x.id === id);
  return hit?.name || 'Missing piece';
}

function outfitFormHTML(kit, outfit) {
  const partIds = outfit?.partIds || [];
  const taken = new Set(partIds);
  const pool = [...kit.wardrobe, ...kit.props, ...kit.shelf].filter(x => x?.id && !taken.has(x.id));
  const parts = partIds.map((pid, i) => `
    <div class="showtime-setup-chiprow" data-part-id="${esc(pid)}">
      <button type="button" data-kit-action="move-part" data-dir="-1" ${i === 0 ? 'disabled' : ''}>↑</button>
      <button type="button" data-kit-action="move-part" data-dir="1" ${i === partIds.length - 1 ? 'disabled' : ''}>↓</button>
      <span class="showtime-setup-chipname">${esc(pieceName(kit, pid))}</span>
      <button type="button" data-kit-action="drop-part">×</button>
    </div>`).join('');
  const chips = pool.map(x =>
    `<button type="button" data-kit-action="add-part" data-id="${esc(x.id)}">${esc(x.name)}</button>`,
  ).join('');
  return `
    <div class="showtime-setup-kitform" data-outfit-form>
      <label>Title <input type="text" data-field="title" value="${esc(outfit?.title || '')}"></label>
      <label>Description <textarea data-field="description" rows="2">${esc(outfit?.description || '')}</textarea></label>
      <label>Type
        <select data-field="type">
          ${OUTFIT_TYPES.map(t => `<option value="${t.id}" ${t.id === (outfit?.type || 'casual') ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}
        </select>
      </label>
      <div class="showtime-setup-note">Parts, in the order the look is put on.</div>
      ${parts || '<div class="showtime-setup-empty">Pick chips below.</div>'}
      <div class="showtime-setup-chips">${chips}<button type="button" data-kit-action="new-chip">Add chip</button></div>
      <div class="showtime-setup-kitform" data-chip-form hidden>
        <label>Chip name <input type="text" data-field="chip-name"></label>
        <label>Description <input type="text" data-field="chip-desc"></label>
        <button type="button" data-kit-action="save-chip">Add chip</button>
      </div>
      <div class="showtime-setup-row-actions">
        <button type="button" data-kit-action="save-outfit">Save</button>
        <button type="button" data-kit-action="cancel-edit">Cancel</button>
      </div>
    </div>`;
}

function closetBlock(kit, edit) {
  const rows = kit.outfits.map(o => {
    const type = outfitTypeMeta(o.type);
    return `
      <div class="showtime-setup-chiprow" data-outfit-id="${esc(o.id)}">
        <button type="button" data-kit-action="move-outfit" data-dir="-1">↑</button>
        <button type="button" data-kit-action="move-outfit" data-dir="1">↓</button>
        <span class="showtime-setup-chipname">${esc(o.title)}</span>
        <span class="showtime-setup-tag showtime-setup-tag--quiet">${esc(type.label)}</span>
        <button type="button" data-kit-action="equip-outfit">Equip</button>
        <button type="button" data-kit-action="edit-outfit">Edit</button>
        <button type="button" data-kit-action="drop-outfit">×</button>
      </div>
      ${edit?.view === 'outfit' && edit.id === o.id ? outfitFormHTML(kit, o) : ''}`;
  }).join('');
  const adding = edit?.view === 'outfit' && !edit.id;
  return `
    <div class="showtime-setup-kithead"><span>Closet</span>
      <span class="showtime-setup-kitacts">
        ${kit.outfits.length ? `<button type="button" data-kit-action="clear-items" data-kind="closet">Clear</button>` : ''}
        <button type="button" data-kit-action="add-outfit">+ Add</button>
      </span>
    </div>
    ${rows || '<div class="showtime-setup-empty">No looks on file.</div>'}
    ${adding ? outfitFormHTML(kit, { title: '', description: '', type: 'casual', partIds: [] }) : ''}`;
}

export function renderKit(row) {
  const kit = kitOf(row);
  const edit = row._kitEdit || null;
  const wardrobe = row.querySelector('[data-kit-view="wardrobe"]');
  const props = row.querySelector('[data-kit-view="props"]');
  const closet = row.querySelector('[data-kit-view="closet"]');
  if (wardrobe) wardrobe.innerHTML = listBlock('Wardrobe', 'wardrobe', kit.wardrobe, edit);
  if (props) props.innerHTML = listBlock('Props', 'props', kit.props, edit);
  if (closet) closet.innerHTML = closetBlock(kit, edit);
}

function commitPendingChip(row, kit, outfit) {
  const form = row.querySelector('[data-chip-form]');
  if (!form || form.hidden) return;
  const name = form.querySelector('[data-field="chip-name"]')?.value.trim() || '';
  if (!name || !outfit) return;
  const chip = {
    id: uid(),
    name,
    description: form.querySelector('[data-field="chip-desc"]')?.value.trim() || '',
  };
  kit.shelf.push(chip);
  outfit.partIds ??= [];
  if (!outfit.partIds.includes(chip.id)) outfit.partIds.push(chip.id);
}

function commitOutfitFields(row, outfit) {
  const form = row.querySelector('[data-outfit-form]');
  if (!form || !outfit) return outfit;
  const title = form.querySelector('[data-field="title"]')?.value.trim() || '';
  if (title) outfit.title = title;
  outfit.description = form.querySelector('[data-field="description"]')?.value.trim() || '';
  const type = form.querySelector('[data-field="type"]')?.value || 'casual';
  outfit.type = OUTFIT_TYPES.some(t => t.id === type) ? type : 'casual';
  return outfit;
}

function editingOutfit(row) {
  const kit = kitOf(row);
  const edit = row._kitEdit;
  if (edit?.view !== 'outfit') return null;
  if (!edit.id) {
    const draft = { id: uid(), title: '', description: '', type: 'casual', partIds: [] };
    kit.outfits.push(draft);
    edit.id = draft.id;
    edit.fresh = true;
    return draft;
  }
  return kit.outfits.find(o => o.id === edit.id) || null;
}

export function handleKitClick(row, btn) {
  const action = btn.dataset.kitAction;
  const kit = kitOf(row);
  const kind = btn.closest('[data-kit-view]')?.dataset.kitView
    || btn.dataset.kind
    || row._kitEdit?.view;
  const list = kind === 'props' ? kit.props : kit.wardrobe;

  if (action === 'clear-items') {
    const which = btn.dataset.kind;
    if (which === 'wardrobe') kit.wardrobe = [];
    else if (which === 'props') kit.props = [];
    else if (which === 'closet') {
      kit.outfits = [];
      kit.shelf = [];
    }
    if (row._kitEdit?.view === which || (which === 'closet' && row._kitEdit?.view === 'outfit')) {
      row._kitEdit = null;
    }
    renderKit(row);
    return;
  }
  if (action === 'add-item') {
    row._kitEdit = { view: btn.dataset.kind, id: '' };
    renderKit(row);
    row.querySelector('[data-item-form] [data-field="name"]')?.focus();
    return;
  }
  if (action === 'edit-item') {
    const id = btn.closest('[data-item-id]')?.dataset.itemId;
    row._kitEdit = { view: kind, id };
    renderKit(row);
    return;
  }
  if (action === 'cancel-edit') {
    if (row._kitEdit?.fresh && row._kitEdit.id) {
      kit.outfits = kit.outfits.filter(o => o.id !== row._kitEdit.id);
    }
    row._kitEdit = null;
    renderKit(row);
    return;
  }
  if (action === 'save-item') {
    const form = row.querySelector('[data-item-form]');
    const name = form?.querySelector('[data-field="name"]')?.value.trim() || '';
    if (!name) return;
    const view = form.dataset.kind === 'props' ? 'props' : 'wardrobe';
    const bag = view === 'props' ? kit.props : kit.wardrobe;
    const id = row._kitEdit?.id || uid();
    const rec = {
      id,
      name,
      description: form.querySelector('[data-field="description"]')?.value.trim() || '',
      condition: condMeta(form.querySelector('[data-field="condition"]')?.value).id,
      kind: view === 'props' && form.querySelector('[data-field="kind"]')?.value === 'container' ? 'container' : 'item',
      parentId: view === 'props' ? (form.querySelector('[data-field="parentId"]')?.value || '') : '',
    };
    if (rec.parentId === rec.id) rec.parentId = '';
    if (rec.kind !== 'container') {
      for (const child of bag) if (child.parentId === rec.id) child.parentId = '';
    }
    const i = bag.findIndex(x => x.id === id);
    if (i >= 0) bag[i] = rec;
    else bag.push(rec);
    row._kitEdit = null;
    renderKit(row);
    return;
  }
  if (action === 'drop-item') {
    const id = btn.closest('[data-item-id]')?.dataset.itemId;
    const bag = kind === 'props' ? kit.props : kit.wardrobe;
    const next = bag.filter(x => x.id !== id);
    for (const item of next) if (item.parentId === id) item.parentId = '';
    if (kind === 'props') kit.props = next;
    else kit.wardrobe = next;
    renderKit(row);
    return;
  }
  if (action === 'move-item') {
    const id = btn.closest('[data-item-id]')?.dataset.itemId;
    const dir = Number(btn.dataset.dir) || 0;
    moveInList(list, id, dir, item => item.parentId || '');
    renderKit(row);
    return;
  }
  if (action === 'cycle-cond') {
    const id = btn.closest('[data-item-id]')?.dataset.itemId;
    const item = list.find(x => x.id === id);
    if (!item) return;
    const i = CONDITIONS.findIndex(c => c.id === item.condition);
    item.condition = CONDITIONS[(i + 1) % CONDITIONS.length].id;
    renderKit(row);
    return;
  }
  if (action === 'add-outfit') {
    row._kitEdit = { view: 'outfit', id: '', fresh: true };
    renderKit(row);
    row.querySelector('[data-outfit-form] [data-field="title"]')?.focus();
    return;
  }
  if (action === 'edit-outfit') {
    row._kitEdit = { view: 'outfit', id: btn.closest('[data-outfit-id]')?.dataset.outfitId || '' };
    renderKit(row);
    return;
  }
  if (action === 'drop-outfit') {
    const id = btn.closest('[data-outfit-id]')?.dataset.outfitId;
    kit.outfits = kit.outfits.filter(o => o.id !== id);
    if (row._kitEdit?.id === id) row._kitEdit = null;
    renderKit(row);
    return;
  }
  if (action === 'move-outfit') {
    const id = btn.closest('[data-outfit-id]')?.dataset.outfitId;
    moveInList(kit.outfits, id, Number(btn.dataset.dir) || 0, () => '');
    renderKit(row);
    return;
  }
  if (action === 'equip-outfit') {
    equipOutfit(kit, btn.closest('[data-outfit-id]')?.dataset.outfitId);
    renderKit(row);
    return;
  }
  if (action === 'save-outfit') {
    const outfit = editingOutfit(row);
    if (!outfit) return;
    outfit.partIds ??= [];
    commitPendingChip(row, kit, outfit);
    commitOutfitFields(row, outfit);
    if (!outfit.title) {
      const first = outfit.partIds.map(id => pieceName(kit, id)).find(name => name && name !== 'Missing piece');
      outfit.title = first || 'Look';
    }
    row._kitEdit = null;
    renderKit(row);
    return;
  }
  if (action === 'add-part' || action === 'drop-part' || action === 'move-part' || action === 'new-chip' || action === 'save-chip') {
    const outfit = editingOutfit(row);
    if (!outfit) return;
    commitOutfitFields(row, outfit);
    if (action === 'add-part') {
      const id = btn.dataset.id;
      if (id && !outfit.partIds.includes(id)) outfit.partIds.push(id);
    } else if (action === 'drop-part') {
      const id = btn.closest('[data-part-id]')?.dataset.partId;
      outfit.partIds = outfit.partIds.filter(p => p !== id);
    } else if (action === 'move-part') {
      const id = btn.closest('[data-part-id]')?.dataset.partId;
      const i = outfit.partIds.indexOf(id);
      const j = i + (Number(btn.dataset.dir) || 0);
      if (i >= 0 && j >= 0 && j < outfit.partIds.length) {
        [outfit.partIds[i], outfit.partIds[j]] = [outfit.partIds[j], outfit.partIds[i]];
      }
    } else if (action === 'new-chip') {
      const form = row.querySelector('[data-chip-form]');
      if (form) form.hidden = false;
      return;
    } else if (action === 'save-chip') {
      outfit.partIds ??= [];
      const before = outfit.partIds.length;
      commitPendingChip(row, kit, outfit);
      if (outfit.partIds.length === before) return;
    }
    renderKit(row);
  }
}

function equipOutfit(kit, outfitId) {
  const outfit = kit.outfits.find(o => o.id === outfitId);
  if (!outfit) return;
  const sources = new Map([...kit.wardrobe, ...kit.props, ...kit.shelf].filter(x => x?.id).map(x => [x.id, x]));
  const worn = [];
  const seen = new Set();
  for (const pid of outfit.partIds || []) {
    const src = sources.get(pid);
    const name = String(src?.name || '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const already = kit.wardrobe.find(x => x.id === pid);
    worn.push(already || {
      id: uid(),
      name,
      description: String(src.description || '').trim(),
      condition: src.condition || 'pristine',
      kind: 'item',
      parentId: '',
    });
  }
  if (!worn.length) return;
  kit.wardrobe = worn;
}
