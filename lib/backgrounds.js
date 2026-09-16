// Stage background library — Composer-style URL + upload fallback, tag scoring.

function uid(prefix = 'bg') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export const BG_AUTO_MODES = Object.freeze([
  { id: 'location', label: 'Location / areas', tip: 'Match Set place tags and compass cells' },
  { id: 'narrative', label: 'Narrative tags', tip: 'Match tags found in recent chat / scene keys' },
  { id: 'manual', label: 'Manual only', tip: 'Only apply when you pick a background' },
]);

export function defaultVisuals() {
  return {
    backgrounds: [],
    activeId: '',
    pinnedId: '', // explicit "Use" override — wins over auto-select in any mode
    selectMode: 'location', // location | narrative | manual
    clapperPos: null, // { left, top } for floating clapper
  };
}

export function normalizeBackground(raw = {}) {
  let url = String(raw.url || '').trim();
  let backupUrl = String(raw.backupUrl || '').trim();
  let fileData = String(raw.fileData || '').trim();
  // Legacy: url may have been a data: upload
  if (!fileData && url.startsWith('data:image')) {
    fileData = url;
    url = '';
  }
  if (backupUrl.startsWith('data:image') && !fileData) {
    fileData = backupUrl;
    backupUrl = '';
  }
  if (fileData && !fileData.startsWith('data:image')) fileData = '';
  return {
    id: String(raw.id || uid('bg')),
    title: String(raw.title || 'Untitled').trim() || 'Untitled',
    url,
    backupUrl,
    fileData,
    locationTags: uniqStrings(raw.locationTags || raw.locations),
    sceneTags: uniqStrings(raw.sceneTags || raw.scenes),
    tags: uniqStrings(raw.tags),
    placeIds: uniqStrings(raw.placeIds),
    cellIds: uniqStrings(raw.cellIds).map(c => String(c).toUpperCase()),
    notes: String(raw.notes || '').trim(),
    sort: Number.isFinite(Number(raw.sort)) ? Number(raw.sort) : Date.now(),
    createdAt: Number(raw.createdAt) || Date.now(),
    updatedAt: Number(raw.updatedAt) || Date.now(),
  };
}

export function normalizeVisuals(raw) {
  const d = defaultVisuals();
  const v = raw && typeof raw === 'object' ? raw : {};
  const backgrounds = Array.isArray(v.backgrounds)
    ? v.backgrounds.map(normalizeBackground).filter(b => b.url || b.backupUrl || b.fileData)
      .sort((a, b) => (a.sort - b.sort) || a.title.localeCompare(b.title))
    : [];
  const selectMode = BG_AUTO_MODES.some(m => m.id === v.selectMode) ? v.selectMode : 'location';
  let activeId = String(v.activeId || '');
  if (activeId && !backgrounds.some(b => b.id === activeId)) activeId = '';
  let pinnedId = String(v.pinnedId || '');
  if (pinnedId && !backgrounds.some(b => b.id === pinnedId)) pinnedId = '';
  const clapperPos = v.clapperPos && typeof v.clapperPos === 'object'
    ? { left: Number(v.clapperPos.left) || 24, top: Number(v.clapperPos.top) || 0 }
    : null;
  return { ...d, backgrounds, activeId, pinnedId, selectMode, clapperPos };
}

function uniqStrings(arr) {
  const out = [];
  const seen = new Set();
  for (const x of Array.isArray(arr) ? arr : []) {
    const s = String(x || '').trim();
    if (!s) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

/** Resolve display URL: remote URL, else upload, else backup URL. */
export function resolveBackgroundSrc(bg) {
  if (!bg) return '';
  if (bg.url) return bg.url;
  if (bg.fileData) return bg.fileData;
  if (bg.backupUrl) return bg.backupUrl;
  return '';
}

/** Other usable source if primary fails (upload ↔ URL). */
export function backgroundFallbackSrc(bg) {
  if (!bg) return '';
  const primary = resolveBackgroundSrc(bg);
  const cands = [bg.fileData, bg.url, bg.backupUrl].filter(Boolean);
  return cands.find(u => u !== primary) || '';
}

/**
 * Score a background against scene context.
 * @param {object} bg
 * @param {{ locationTags?: string[], narrativeTags?: string[], placeId?: string, cellId?: string, mode?: string }} ctx
 */
export function scoreBackground(bg, ctx = {}) {
  if (!bg) return -1;
  const mode = ctx.mode || 'location';
  const loc = lowerSet(ctx.locationTags);
  const narr = lowerSet(ctx.narrativeTags);
  const placeId = String(ctx.placeId || '').trim();
  const cellId = String(ctx.cellId || '').toUpperCase();

  let score = 0;
  let matched = false;

  if (mode !== 'narrative') {
    if (placeId && (bg.placeIds || []).includes(placeId)) {
      score += 20;
      matched = true;
    }
    if (cellId && (bg.cellIds || []).length) {
      if (bg.cellIds.map(c => c.toUpperCase()).includes(cellId)) {
        score += 12;
        matched = true;
      } else {
        return -1; // cell-restricted and not this cell
      }
    }
    for (const t of bg.locationTags || []) {
      if (loc.has(t.toLowerCase())) { score += 10; matched = true; }
    }
  }

  for (const t of bg.sceneTags || []) {
    if (narr.has(t.toLowerCase()) || (mode !== 'narrative' && loc.has(t.toLowerCase()))) {
      score += mode === 'narrative' ? 14 : 8;
      matched = true;
    }
  }
  for (const t of bg.tags || []) {
    const k = t.toLowerCase();
    if (narr.has(k) || (mode !== 'narrative' && loc.has(k))) {
      score += mode === 'narrative' ? 10 : 4;
      matched = true;
    }
  }
  if (mode === 'narrative') {
    for (const t of bg.locationTags || []) {
      if (narr.has(t.toLowerCase()) || loc.has(t.toLowerCase())) {
        score += 6;
        matched = true;
      }
    }
  }

  if (!matched && (bg.locationTags?.length || bg.sceneTags?.length || bg.tags?.length || bg.placeIds?.length)) {
    return 0; // tagged but no hit — eligible only as weak fallback
  }
  return score;
}

function lowerSet(arr) {
  return new Set((arr || []).map(x => String(x).toLowerCase()).filter(Boolean));
}

/**
 * The auto-selected ("expected") background for the current context/mode,
 * ignoring any explicit pin. This is what auto-select *would* show.
 */
export function pickExpectedBackground(visuals, ctx = {}) {
  const v = normalizeVisuals(visuals);
  if (v.selectMode === 'manual') {
    return v.backgrounds.find(b => b.id === v.activeId) || null;
  }
  const scored = v.backgrounds
    .map(b => ({ b, s: scoreBackground(b, { ...ctx, mode: v.selectMode }) }))
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s || a.b.sort - b.b.sort || a.b.title.localeCompare(b.b.title));
  if (scored.length) return scored[0].b;
  return v.backgrounds.find(b => b.id === v.activeId) || null;
}

/**
 * Pick the background to actually display: an explicit "Use" pin always wins
 * (that's what makes the Use button switch the current background in any
 * mode); otherwise fall back to the auto-selected expectation.
 */
export function pickBackground(visuals, ctx = {}) {
  const v = normalizeVisuals(visuals);
  if (v.pinnedId) {
    const pinned = v.backgrounds.find(b => b.id === v.pinnedId);
    if (pinned) return pinned;
  }
  return pickExpectedBackground(v, ctx);
}

/**
 * Build Visuals shelf HTML.
 */
export function buildVisualsHtml(visuals, { esc, places = [], cells = ['NW', 'N', 'NE', 'W', 'C', 'E', 'SW', 'S', 'SE'], ctx = null, placeName = '' } = {}) {
  const v = normalizeVisuals(visuals);
  const placeOpts = places.map(p =>
    `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
  const expected = pickExpectedBackground(v, ctx || {});
  const pinned = v.pinnedId ? v.backgrounds.find(b => b.id === v.pinnedId) : null;
  const current = pinned || expected;
  const canLink = !!(ctx && (ctx.placeId || ctx.cellId || (ctx.locationTags || []).length));
  const linkWhere = [placeName || ctx?.placeId, ctx?.cellId ? `area ${ctx.cellId}` : '']
    .filter(Boolean).join(' · ') || 'here';

  // When something is pinned (via "Use") and it isn't what auto-select would
  // otherwise show, offer to make the association permanent (link it here) or
  // drop back to auto.
  const pinBar = pinned
    ? `<div class="bst-bg-pinbar">
        <span>📌 Showing <strong>${esc(pinned.title)}</strong> <span class="bst-k">(pinned)</span>${
          expected && expected.id !== pinned.id ? ` · auto here → <strong>${esc(expected.title)}</strong>` : ''}</span>
        <span class="bst-row">
          ${canLink ? `<button type="button" class="bst-btn gold" data-action="bg-link-here" data-id="${esc(pinned.id)}" title="Tag this background to ${esc(linkWhere)} so auto-select shows it here in future">Link to ${esc(linkWhere)}</button>` : ''}
          <button type="button" class="bst-btn" data-action="bg-unpin" title="Stop forcing this background — resume auto-select">Resume auto</button>
        </span>
      </div>`
    : '';

  const rows = v.backgrounds.length
    ? v.backgrounds.map(b => {
      const src = resolveBackgroundSrc(b);
      const isCurrent = current && current.id === b.id;
      const isPinned = pinned && pinned.id === b.id;
      const bits = [
        b.locationTags?.length ? `loc:${b.locationTags.join(',')}` : '',
        b.sceneTags?.length ? `scene:${b.sceneTags.join(',')}` : '',
        b.cellIds?.length ? `cells:${b.cellIds.join('+')}` : '',
        b.placeIds?.length ? `places:${b.placeIds.length}` : '',
      ].filter(Boolean).join(' · ');
      const flags = [
        isPinned ? '<span class="bst-chip on" title="Forced via Use">📌 pinned</span>' : '',
        !isPinned && isCurrent ? '<span class="bst-chip on" title="Auto-selected here">● showing</span>' : '',
      ].filter(Boolean).join(' ');
      return `
        <div class="bst-bg-card${isCurrent ? ' on' : ''}${isPinned ? ' pinned' : ''}" data-bg-id="${esc(b.id)}">
          <div class="bst-bg-thumb" style="${src ? `background-image:url('${esc(src).replace(/'/g, '%27')}')` : ''}"></div>
          <div class="bst-bg-meta">
            <strong>${esc(b.title)}</strong> ${flags}
            <span class="bst-k">${esc(bits || 'untagged')}</span>
            <div class="bst-row" style="margin-top:4px">
              <button type="button" class="bst-btn" data-action="bg-up" data-id="${esc(b.id)}" title="Move earlier in queue">↑</button>
              <button type="button" class="bst-btn" data-action="bg-down" data-id="${esc(b.id)}" title="Move later in queue">↓</button>
              <button type="button" class="bst-btn" data-action="bg-edit" data-id="${esc(b.id)}">Edit</button>
              <button type="button" class="bst-btn${isPinned ? ' gold' : ''}" data-action="bg-activate" data-id="${esc(b.id)}" title="Switch the live background to this one now">${isPinned ? 'In use' : 'Use'}</button>
              ${canLink ? `<button type="button" class="bst-btn" data-action="bg-link-here" data-id="${esc(b.id)}" title="Tag this background to ${esc(linkWhere)} for auto-select">Link here</button>` : ''}
              <button type="button" class="bst-btn danger" data-action="bg-del" data-id="${esc(b.id)}">Delete</button>
            </div>
          </div>
        </div>`;
    }).join('')
    : '<div class="bst-empty">No backgrounds yet — add a PNG upload and/or URL.</div>';

  return `
    <h2 class="bst-pane-title">Visuals</h2>
    <p class="bst-pane-sub">Background stills for rooms and areas. Upload a PNG and/or paste a URL — either can fall back to the other. Tag by location, scene, place, and compass cell.</p>
    ${pinBar}
    <section class="bst-section">
      <h3 class="bst-section-h">Auto-select</h3>
      <div class="bst-row bst-stack">
        ${BG_AUTO_MODES.map(m => `
          <label class="bst-radio" title="${esc(m.tip)}">
            <input type="radio" name="bst-bg-mode" data-vis="selectMode" value="${m.id}" ${v.selectMode === m.id ? 'checked' : ''}>
            ${esc(m.label)} <span class="bst-k">${esc(m.tip)}</span>
          </label>`).join('')}
      </div>
    </section>
    <section class="bst-section">
      <h3 class="bst-section-h">Library</h3>
      <div class="bst-row">
        <button type="button" class="bst-btn gold" data-action="bg-add">+ Background</button>
        <button type="button" class="bst-btn" data-action="bg-import-st" title="Pull backgrounds from SillyTavern’s background library">Import from SillyTavern</button>
      </div>
      <div class="bst-bg-grid">${rows}</div>
    </section>
    <div hidden data-role="bg-place-opts">${placeOpts}</div>
    <div hidden data-role="bg-cell-opts">${cells.map(c => `<option value="${c}">${c}</option>`).join('')}</div>`;
}
