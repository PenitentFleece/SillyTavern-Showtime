// Shared location-tag picker — chip list + grouped suggest + nested create.

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function ensureCss() {
  let s = document.getElementById('st-loctag-css');
  if (!s) {
    s = document.createElement('style');
    s.id = 'st-loctag-css';
    document.head.appendChild(s);
  }
  s.textContent = `
.st-loctag-wrap { position: relative; display: flex; flex-direction: column; gap: 6px; flex: 1; min-width: 0; }
.st-loctag-chips { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; min-height: 1.6em; }
.st-loctag-chip {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 2px 6px; border: 1px solid var(--st-gold-dim, #c9a24a);
  border-radius: 3px; background: rgba(201,162,74,.12); font-size: 12px;
}
.st-loctag-name { color: inherit; }
.st-loctag-hint { color: var(--st-sepia, #9a7d3f); font-size: 10px; }
.st-loctag-x {
  border: 0; background: transparent; cursor: pointer; padding: 0 2px;
  color: #9a7d3f; font-size: 13px; line-height: 1;
}
.st-loctag-x:hover { color: #c44; }
.st-loctag-tools { position: relative; display: flex; gap: 6px; align-items: stretch; flex-wrap: wrap; }
.st-loctag-tools .st-loctag-search { flex: 1; min-width: 10em; }
.st-loctag-suggest {
  position: absolute; left: 0; right: 0; top: calc(100% + 2px); z-index: 80;
  max-height: 220px; overflow: auto;
  border: 1px solid var(--st-gold-dim, #c9a24a);
  background: var(--st-paper, #f4ead5);
  color: var(--st-ink, #2b1d0e);
  box-shadow: 0 6px 18px rgba(0,0,0,.35);
  scrollbar-width: thin;
  scrollbar-color: var(--st-sepia, #9a7d3f) transparent;
}
.st-loctag-suggest::-webkit-scrollbar { width: 8px; height: 8px; }
.st-loctag-suggest::-webkit-scrollbar-thumb {
  background-color: var(--st-sepia, #9a7d3f);
  background-clip: border-box;
  border: none;
  border-radius: 4px;
}
.st-loctag-suggest::-webkit-scrollbar-button { display: none; width: 0; height: 0; }
.st-loctag-suggest[hidden] { display: none !important; }
.st-loctag-group {
  padding: 6px 10px 2px; font-size: 10px; letter-spacing: .06em;
  text-transform: uppercase; color: var(--st-sepia, #9a7d3f);
}
.st-loctag-item {
  display: block; width: 100%; text-align: left; border: 0;
  appearance: none; -webkit-appearance: none;
  background: transparent;
  padding: 7px 10px; cursor: pointer;
  color: var(--st-ink, #2b1d0e);
  font: inherit;
}
.st-loctag-item:hover, .st-loctag-item:focus {
  background: rgba(201,162,74,.22);
  color: var(--st-ink, #2b1d0e);
}
.st-loctag-item em { color: var(--st-sepia, #9a7d3f); font-style: normal; font-size: 11px; margin-left: 6px; }
.st-loctag-item.st-loctag-new-opt { border-top: 1px solid rgba(201,162,74,.25); }
.st-loctag-empty { color: var(--st-ink-soft, #6b5430); font-size: 12px; }
.st-loctag-create {
  display: flex; flex-wrap: wrap; gap: 6px; align-items: center;
  padding: 6px; border: 1px dashed rgba(201,162,74,.45); border-radius: 4px;
  background: rgba(201,162,74,.06);
}
.st-loctag-create[hidden] { display: none !important; }
.st-loctag-create .bst-input, .st-loctag-create .stm-input { flex: 1; min-width: 8em; }
.st-loctag-create-acts { display: flex; gap: 6px; }
`;
}

function chipHTML(name, hint = '') {
  return `
    <span class="st-loctag-chip" data-value="${esc(name)}">
      <span class="st-loctag-name">${esc(name)}</span>
      ${hint ? `<span class="st-loctag-hint">${esc(hint)}</span>` : ''}
      <button type="button" class="st-loctag-x" title="Remove">×</button>
    </span>`;
}

/**
 * Chip + search + suggest markup (mirrors Script cast credit tools).
 * @param {{ selected?: string[], fieldRole?: string, placeholder?: string, emptyHint?: string, showNewBtn?: boolean, newBtnLabel?: string, noun?: string }} opts
 */
export function locationTagEditorHTML({
  selected = [],
  fieldRole = 'loctags',
  placeholder = 'Find or add a location…',
  emptyHint = 'None yet — pick from the list or add a new location.',
  showNewBtn = true,
  newBtnLabel = '＋ New location',
  noun = 'location',
} = {}) {
  const chips = (selected || []).filter(Boolean).map(t => chipHTML(t)).join('');
  return `
    <div class="st-loctag-wrap" data-role="${esc(fieldRole)}" data-empty-hint="${esc(emptyHint)}" data-noun="${esc(noun)}">
      <div class="st-loctag-chips">${chips || `<span class="st-loctag-empty">${esc(emptyHint)}</span>`}</div>
      <div class="st-loctag-tools">
        <input type="text" class="bst-input stm-input st-loctag-search" placeholder="${esc(placeholder)}" autocomplete="off">
        ${showNewBtn
          ? `<button type="button" class="bst-btn stm-btn st-loctag-new" title="Create a new ${esc(noun)} tag">${esc(newBtnLabel)}</button>`
          : ''}
        <div class="st-loctag-suggest" hidden></div>
      </div>
      <div class="st-loctag-create" hidden>
        <input type="text" class="bst-input stm-input st-loctag-create-name" placeholder="Name (e.g. Fukuoka)" autocomplete="off">
        <select class="bst-input stm-input st-loctag-create-kind"></select>
        <select class="bst-input stm-input st-loctag-create-parent"></select>
        <div class="st-loctag-create-acts">
          <button type="button" class="bst-btn stm-btn st-loctag-create-cancel">Cancel</button>
          <button type="button" class="bst-btn stm-btn gold st-loctag-create-ok">Add</button>
        </div>
      </div>
    </div>`;
}

/** Read selected tag strings from a picker root (or a parent containing one). */
export function readLocationTags(root) {
  if (!root) return [];
  const wrap = root.classList?.contains('st-loctag-wrap')
    ? root
    : root.querySelector?.('.st-loctag-wrap');
  if (!wrap) return [];
  const out = [];
  const seen = new Set();
  for (const chip of wrap.querySelectorAll('.st-loctag-chip')) {
    const v = String(chip.dataset.value || '').trim();
    if (!v) continue;
    const k = v.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}

/**
 * Wire suggest / add / remove. Call after inserting locationTagEditorHTML.
 */
export function bindLocationTagEditor(root, {
  getKnown = () => [],
  multi = true,
  onChange = null,
  resolveValue = null,
  matchItem = null,
  noun = '',
  allowCreate = true,
  emptyHint = '',
  createKinds = null,
  getParents = null,
  onCreate = null,
} = {}) {
  ensureCss();
  const wrap = root?.classList?.contains('st-loctag-wrap')
    ? root
    : root?.querySelector?.('.st-loctag-wrap');
  if (!wrap || wrap.dataset.loctagBound === '1') return wrap;
  wrap.dataset.loctagBound = '1';

  const chips = wrap.querySelector('.st-loctag-chips');
  const search = wrap.querySelector('.st-loctag-search');
  const suggest = wrap.querySelector('.st-loctag-suggest');
  const createBox = wrap.querySelector('.st-loctag-create');
  const createName = wrap.querySelector('.st-loctag-create-name');
  const createKind = wrap.querySelector('.st-loctag-create-kind');
  const createParent = wrap.querySelector('.st-loctag-create-parent');
  if (noun) wrap.dataset.noun = noun;
  if (emptyHint) wrap.dataset.emptyHint = emptyHint;

  const kinds = Array.isArray(createKinds) ? createKinds.filter(k => k?.id) : [];
  const groupedCreate = kinds.length > 0;

  const nounLabel = () => String(wrap.dataset.noun || noun || 'tag').trim() || 'tag';
  const vacant = () => String(wrap.dataset.emptyHint
    || emptyHint
    || `None yet — pick from the list or add a new ${nounLabel()}.`);

  const listed = () => readLocationTags(wrap).map(t => t.toLowerCase());

  const notify = () => {
    try { onChange?.(readLocationTags(wrap)); } catch { /* ignore */ }
  };

  const knownList = () => {
    try {
      return (getKnown() || []).map(raw => {
        if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
          const value = String(raw.value ?? raw.name ?? '').trim();
          if (!value) return null;
          const label = String(raw.label || value).trim() || value;
          const keys = [...new Set(
            [...(raw.keys || []), value, label]
              .map(s => String(s || '').trim().toLowerCase())
              .filter(Boolean),
          )];
          return {
            value,
            label,
            keys,
            hint: String(raw.hint || '').trim(),
            group: String(raw.group || '').trim(),
            kind: String(raw.kind || '').trim(),
          };
        }
        const value = String(raw || '').trim();
        if (!value) return null;
        return { value, label: value, keys: [value.toLowerCase()], hint: '', group: '', kind: '' };
      }).filter(Boolean);
    } catch { return []; }
  };

  const hintFor = (name) => {
    const low = String(name || '').toLowerCase();
    return knownList().find(t => t.value.toLowerCase() === low)?.hint || '';
  };

  const decorateChips = () => {
    chips?.querySelectorAll('.st-loctag-chip').forEach((chip) => {
      const hint = hintFor(chip.dataset.value);
      const nameEl = chip.querySelector('.st-loctag-name');
      let hintEl = chip.querySelector('.st-loctag-hint');
      if (hint) {
        if (!hintEl && nameEl) {
          nameEl.insertAdjacentHTML('afterend', `<span class="st-loctag-hint">${esc(hint)}</span>`);
        } else if (hintEl) {
          hintEl.textContent = hint;
        }
      }
    });
  };

  const canonicalize = (raw) => {
    const name = String(raw || '').trim();
    if (!name) return '';
    if (typeof resolveValue === 'function') {
      try {
        const mapped = resolveValue(name);
        if (mapped != null && String(mapped).trim()) return String(mapped).trim();
      } catch { /* fall through */ }
    }
    const low = name.toLowerCase();
    const hit = knownList().find(t =>
      t.value.toLowerCase() === low || t.keys.includes(low));
    return hit?.value || name;
  };

  const addChip = (raw) => {
    const name = canonicalize(raw);
    if (!name) return;
    if (listed().includes(name.toLowerCase())) return;
    if (!multi) {
      chips.querySelectorAll('.st-loctag-chip').forEach(c => c.remove());
    }
    chips.querySelector('.st-loctag-empty')?.remove();
    chips.insertAdjacentHTML('beforeend', chipHTML(name, hintFor(name)));
    notify();
  };

  const hideSuggest = () => { if (suggest) suggest.hidden = true; };

  const fillParents = () => {
    if (!createParent) return;
    const kind = createKind?.value || '';
    let parents = [];
    try { parents = (typeof getParents === 'function' ? getParents(kind) : []) || []; } catch { parents = []; }
    createParent.innerHTML = [
      `<option value="">— Nest under —</option>`,
      ...parents.map(p => `<option value="${esc(p.id)}">${esc(p.label || p.name)}</option>`),
    ].join('');
  };

  const hideCreate = () => { if (createBox) createBox.hidden = true; };

  const showCreate = (seed = '') => {
    if (!groupedCreate || !createBox) {
      const name = seed || window.prompt(`New ${nounLabel()} name`);
      if (name?.trim()) addChip(name.trim());
      return;
    }
    hideSuggest();
    if (createKind && !createKind.options.length) {
      createKind.innerHTML = kinds.map(k =>
        `<option value="${esc(k.id)}">${esc(k.label)}</option>`).join('');
      createKind.value = kinds.find(k => k.id === 'city')?.id || kinds[0].id;
    }
    if (createName) createName.value = seed || (search?.value || '').trim();
    fillParents();
    createBox.hidden = false;
    createName?.focus();
  };

  const commitCreate = () => {
    const name = String(createName?.value || search?.value || '').trim();
    if (!name) return;
    const spec = {
      name,
      kind: createKind?.value || '',
      parentId: createParent?.value || '',
    };
    let canonical = name;
    if (typeof onCreate === 'function') {
      try {
        const mapped = onCreate(spec);
        if (mapped != null && String(mapped).trim()) canonical = String(mapped).trim();
      } catch { /* keep name */ }
    }
    addChip(canonical);
    if (search) search.value = '';
    hideCreate();
    hideSuggest();
  };

  const showSuggest = (q) => {
    if (!suggest) return;
    const needle = String(q || '').trim().toLowerCase();
    const taken = new Set(listed());
    const seen = new Set();
    const matches = [];
    for (const t of knownList()) {
      const rowKey = `${t.value.toLowerCase()}\0${t.label.toLowerCase()}`;
      if (seen.has(rowKey)) continue;
      if (taken.has(t.value.toLowerCase())) continue;
      seen.add(rowKey);
      if (needle) {
        const inKeys = t.keys.some(k => k.includes(needle));
        const extra = typeof matchItem === 'function' ? !!matchItem(t.value, needle, t) : false;
        if (!inKeys && !t.label.toLowerCase().includes(needle) && !extra) continue;
      }
      matches.push(t);
    }
    matches.sort((a, b) => {
      const g = String(a.group || '').localeCompare(String(b.group || ''));
      if (g) return g;
      return a.label.localeCompare(b.label) || a.value.localeCompare(b.value);
    });
    const rows = [];
    let lastGroup = null;
    for (const t of matches.slice(0, 40)) {
      if (t.group && t.group !== lastGroup) {
        rows.push(`<div class="st-loctag-group">${esc(t.group)}</div>`);
        lastGroup = t.group;
      }
      const hint = t.hint ? `<em>${esc(t.hint)}</em>` : '';
      rows.push(`<button type="button" class="st-loctag-item" data-value="${esc(t.value)}">${esc(t.label)}${hint}</button>`);
    }
    const typed = String(q || '').trim();
    const resolved = typed ? canonicalize(typed) : '';
    if (allowCreate && typed && !taken.has(typed.toLowerCase()) && !taken.has(resolved.toLowerCase())
      && !matches.some(t => t.value.toLowerCase() === typed.toLowerCase()
        || t.value.toLowerCase() === resolved.toLowerCase()
        || t.keys.includes(typed.toLowerCase()))
      && resolved.toLowerCase() === typed.toLowerCase()) {
      const createAttr = groupedCreate ? ' data-create="1"' : '';
      rows.push(`<button type="button" class="st-loctag-item st-loctag-new-opt" data-value="${esc(typed)}"${createAttr}>Add “${esc(typed)}” as ${esc(nounLabel())}</button>`);
    }
    suggest.innerHTML = rows.join('')
      || `<span class="st-loctag-empty" style="display:block;padding:8px 10px">${
        allowCreate ? 'No matches — type a name to add one.' : 'No matches in the established list.'
      }</span>`;
    suggest.hidden = false;
  };

  wrap.addEventListener('click', e => {
    const x = e.target.closest('.st-loctag-x');
    if (x) {
      e.preventDefault();
      e.stopPropagation();
      x.closest('.st-loctag-chip')?.remove();
      if (!chips.querySelector('.st-loctag-chip')) {
        chips.innerHTML = `<span class="st-loctag-empty">${esc(vacant())}</span>`;
      }
      notify();
      return;
    }
    const neu = e.target.closest('.st-loctag-new');
    if (neu) {
      e.preventDefault();
      e.stopPropagation();
      if (!allowCreate) return;
      showCreate((search?.value || '').trim());
      return;
    }
    if (e.target.closest('.st-loctag-create-cancel')) {
      e.preventDefault();
      hideCreate();
      return;
    }
    if (e.target.closest('.st-loctag-create-ok')) {
      e.preventDefault();
      commitCreate();
    }
  });

  createKind?.addEventListener('change', fillParents);

  search?.addEventListener('input', () => showSuggest(search.value));
  search?.addEventListener('focus', () => showSuggest(search.value));
  search?.addEventListener('keydown', e => {
    if (e.key === 'Escape') { hideSuggest(); hideCreate(); return; }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const name = search.value.trim();
    if (!name) return;
    const hit = knownList().find(t =>
      t.value.toLowerCase() === name.toLowerCase() || t.keys.includes(name.toLowerCase()));
    if (hit) addChip(hit.value);
    else if (allowCreate && groupedCreate) {
      showCreate(name);
      return;
    } else if (allowCreate) addChip(name);
    else {
      showSuggest(name);
      return;
    }
    search.value = '';
    hideSuggest();
  });
  suggest?.addEventListener('click', e => {
    const item = e.target.closest('.st-loctag-item');
    if (!item) return;
    e.preventDefault();
    if (item.dataset.create === '1') {
      showCreate(item.dataset.value || '');
      return;
    }
    addChip(item.dataset.value || '');
    if (search) search.value = '';
    hideSuggest();
  });
  search?.addEventListener('blur', () => setTimeout(hideSuggest, 180));

  decorateChips();
  return wrap;
}
