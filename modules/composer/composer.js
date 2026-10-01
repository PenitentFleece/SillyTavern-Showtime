// Composer — cue library. Cards hold a source link + Script-aligned tags.
// Playback embeds YouTube / SoundCloud (and Spotify with Premium login).
// Direct .mp3/.ogg/etc. still use HTML5 audio. Nothing is downloaded.
import { Module } from '../../lib/module.js';
import { getContext } from '../../../../../extensions.js';
import { clampFixedElement } from '../../lib/shell.js';
import {
  COMPOSER_FACETS,
  MOOD_KEYS,
  canonicalizeMood,
  collectMoodPalette,
  emptyFacets,
  flattenFacets,
  normalizeFacets,
  facetTag,
} from '../../lib/keywordFacets.js';
import { sceneCode } from '../../lib/scriptCatalog.js';
import { locationTagEditorHTML, readLocationTags } from '../../lib/locationTagPicker.js';
import { bindLocationCatalogPicker } from '../../lib/locationCatalog.js';
import { getCastMembers } from '../../lib/castCatalog.js';
import { rafMove } from '../../lib/uiPerf.js';

const FACETS = COMPOSER_FACETS;
const TAG_ROLES = [
  { id: 'enable', label: 'Enabling', hint: 'Track is only eligible when these scene keys match.' },
  { id: 'activate', label: 'Activating', hint: 'Raises the track when these keys match. More matches float first.' },
  { id: 'disable', label: 'Disabling', hint: 'Blocks the track if the scene calls for this key.' },
];
const ENABLE_FACET_ORDER = ['location', 'characters', 'datetime', 'mood'];
const SP_SCOPES = 'streaming user-read-email user-read-private user-modify-playback-state user-read-playback-state playlist-read-private playlist-read-collaborative';
const SP_PLAYLIST_SCOPES = ['playlist-read-private', 'playlist-read-collaborative'];
const SP_PKCE_KEY = 'showtime_composer_spotify_pkce';

export class ComposerModule extends Module {
  static id = 'composer';
  static label = 'Composer';
  static scope = 'global';

  async init() {
    const href = new URL('./composer.css', import.meta.url).href;
    if (!document.querySelector('link[data-showtime="composer"]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.dataset.showtime = 'composer';
      document.head.appendChild(link);
    }
    this.bus?.on('composer.queueAudit', () => {
      try {
        this._ensureSceneSeed?.();
        this._sortQueueAgentic();
      } catch (err) {
        console.warn('[Composer] queue audit from Director failed', err);
      }
    });
    this._audio = new Audio();
    this._audio.preload = 'metadata';
    this._audio.addEventListener('timeupdate', () => this._paintPlayer());
    this._audio.addEventListener('loadedmetadata', () => {
      if (this._engine === 'file') {
        this._stampDurationFromSeconds(this._audio.duration);
        this._paintPlayer();
      }
    });
    this._audio.addEventListener('durationchange', () => {
      if (this._engine === 'file') {
        this._stampDurationFromSeconds(this._audio.duration);
        this._paintPlayer();
      }
    });
    this._audio.addEventListener('ended', () => this._playNext());
    this._audio.addEventListener('error', () => {
      if (this._engine === 'file') this._hint('Could not play that audio file.');
    });
    this._keywordFilter = null;
    this._nowPlayingId = null;
    this._engine = null;
    this._yt = null;
    this._ytState = -1;
    this._sc = null;
    this._scPlaying = false;
    this._sp = null;
    this._spDeviceId = '';
    this._spPlaying = false;
    this._lastT = 0;
    this._lastD = 0;
    this._tick = null;
    this._focus = { kind: 'singles', id: null };
    this._page = 'library';
    this._shelfIndex = 0;
    this._shuffleBag = [];
    this._muted = false;
    this._popped = false;
    this._buildEmbedHost();
    // Token exchange must not block Showtime (or ST chat) from mounting.
    void this._catchSpotifyRedirect();
  }

  _buildEmbedHost() {
    this._embedPark = document.createElement('div');
    this._embedPark.className = 'cmp-embed-park';
    this._embedPark.setAttribute('aria-hidden', 'true');
    this._embedHost = document.createElement('div');
    this._embedHost.className = 'cmp-embed-host';
    this._ytWrap = document.createElement('div');
    this._ytWrap.className = 'cmp-yt';
    this._ytBox = document.createElement('div');
    this._ytWrap.appendChild(this._ytBox);
    this._scFrame = document.createElement('iframe');
    this._scFrame.className = 'cmp-sc';
    this._scFrame.allow = 'autoplay';
    this._scFrame.title = 'SoundCloud';
    this._embedPark.style.cssText = 'position:fixed;left:-10000px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;z-index:0;';
    this._scFrame.style.cssText = 'width:1px;height:1px;border:0;';
    this._embedHost.append(this._ytWrap, this._scFrame);
    this._embedPark.appendChild(this._embedHost);
    document.body.appendChild(this._embedPark);
  }

  _parkEmbed() {
    if (this._embedPark && this._embedHost && this._embedHost.parentElement !== this._embedPark) {
      this._embedPark.appendChild(this._embedHost);
    }
  }

  getDefaultState() {
    return {
      library: [],
      playlists: [],
      albums: [],
      volume: 0.8,
      shuffle: false,
      repeat: 'off',
      queue: { ids: [], loop: true },
      queueHistory: [],
      sceneFacets: emptyFacets(FACETS),
      customMoods: [],
      spotify: { clientId: '', accessToken: '', refreshToken: '', expiresAt: 0, displayName: '', grantedScope: '' },
    };
  }

  _tracks() {
    return this.state.library ?? [];
  }

  _track(id) {
    return this._tracks().find(t => t.id === id) ?? null;
  }

  _spState() {
    this.state.spotify ??= { clientId: '', accessToken: '', refreshToken: '', expiresAt: 0, displayName: '', grantedScope: '' };
    return this.state.spotify;
  }

  _spotifyConnected() {
    const sp = this._spState();
    return !!(sp.accessToken && sp.expiresAt > Date.now() + 5000) || !!sp.refreshToken;
  }

  _spotifyScopeSet() {
    return new Set(String(this._spState().grantedScope || '').split(/[\s,]+/).filter(Boolean));
  }

  _spotifyHasPlaylistScope() {
    const have = this._spotifyScopeSet();
    return SP_PLAYLIST_SCOPES.some(s => have.has(s));
  }

  _normalizeTrack(t) {
    if (!t || typeof t !== 'object') return false;
    let changed = false;
    const set = (k, v) => {
      if (t[k] == null) { t[k] = v; changed = true; }
    };
    set('title', 'Untitled cue');
    set('artist', '');
    set('uploader', '');
    set('url', '');
    set('durationMs', 0);
    set('notes', '');
    set('albumId', '');
    set('backupUrl', '');
    set('committed', true);
    const facets = normalizeFacets(t.keywordFacets, FACETS);
    if (JSON.stringify(facets) !== JSON.stringify(t.keywordFacets || {})) {
      t.keywordFacets = facets;
      changed = true;
    }
    t.keywords = flattenFacets(t.keywordFacets, FACETS);
    const roles = this._normalizeTagRoles(t);
    if (JSON.stringify(roles) !== JSON.stringify(t.tagRoles || {})) {
      t.tagRoles = roles;
      changed = true;
    }
    const kind = detectSource(t.url).kind;
    if (t.source !== kind) { t.source = kind; changed = true; }
    return changed;
  }

  _migrate() {
    const s = this.state;
    let changed = false;
    if (!Array.isArray(s.library)) { s.library = []; changed = true; }
    if (!Array.isArray(s.playlists)) { s.playlists = []; changed = true; }
    if (!Array.isArray(s.albums)) { s.albums = []; changed = true; }
    if (s.playlists.length) {
      s.albums = [...s.albums, ...s.playlists];
      s.playlists = [];
      changed = true;
      if (this._focus?.kind === 'playlist') this._focus.kind = 'album';
    }
    if (s.repeat !== 'one' && s.repeat !== 'all') { s.repeat = 'off'; changed = true; }
    if (typeof s.shuffle !== 'boolean') { s.shuffle = false; changed = true; }
    if (!s.queue || typeof s.queue !== 'object') {
      s.queue = { ids: [], loop: true };
      changed = true;
    }
    if (!Array.isArray(s.queue.ids)) { s.queue.ids = []; changed = true; }
    if (typeof s.queue.loop !== 'boolean') { s.queue.loop = true; changed = true; }
    if (!Array.isArray(s.queueHistory)) { s.queueHistory = []; changed = true; }
    const scene = normalizeFacets(s.sceneFacets, FACETS);
    if (JSON.stringify(scene) !== JSON.stringify(s.sceneFacets || {})) {
      s.sceneFacets = scene;
      changed = true;
    }
    for (const p of s.playlists) {
      if (this._normalizeShelf(p, 'playlist')) changed = true;
    }
    for (const a of s.albums) {
      if (this._normalizeShelf(a, 'album')) changed = true;
    }
    const vol = Number(s.volume);
    if (!Number.isFinite(vol)) { s.volume = 0.8; changed = true; }
    if (!s.spotify || typeof s.spotify !== 'object') {
      s.spotify = { clientId: '', accessToken: '', refreshToken: '', expiresAt: 0, displayName: '', grantedScope: '' };
      changed = true;
    }
    for (const t of s.library) {
      if (this._normalizeTrack(t)) changed = true;
    }
    if (changed) this.saveState();
  }

  _playlists() { return this.state.playlists ?? []; }
  _albums() { return this.state.albums ?? []; }
  _playlist(id) { return this._playlists().find(p => p.id === id) ?? null; }
  _album(id) { return this._albums().find(a => a.id === id) ?? null; }

  _normalizeShelf(row, kind) {
    if (!row || typeof row !== 'object') return false;
    let changed = false;
    const set = (k, v) => { if (row[k] == null) { row[k] = v; changed = true; } };
    set('title', kind === 'album' ? 'Untitled album' : 'Untitled playlist');
    set('badge', '');
    set('sourceUrl', '');
    set('scriptUid', '');
    set('artist', '');
    if (!Array.isArray(row.trackIds)) { row.trackIds = []; changed = true; }
    return changed;
  }

  _scriptDb() {
    try {
      return this.storage.getChat('script', { cards: [], settings: { orgScheme: 'show', levels: [] } });
    } catch {
      return { cards: [], settings: { orgScheme: 'show', levels: [] } };
    }
  }

  _isScriptFolder(card, db) {
    if (!card) return false;
    if (card.kind === 'folder') return true;
    if (card.kind === 'card') return false;
    const levels = db.settings?.levels ?? [];
    const idx = levels.findIndex(l => l.id === card.levelId);
    return idx >= 0 && idx < levels.length - 1;
  }

  _scopeLabel(scriptUid) {
    if (!scriptUid) return '';
    const db = this._scriptDb();
    const card = (db.cards ?? []).find(c => c.uid === scriptUid);
    if (!card) return '';
    return `${sceneCode(card, db)} · ${card.title || 'Untitled'}`;
  }

  _scriptScopeOptions(selected) {
    const db = this._scriptDb();
    const cards = db.cards ?? [];
    if (!cards.length) return `<option value="">— No Script folders yet —</option>`;
    const byIndex = (a, b) => (a.sortIndex ?? 0) - (b.sortIndex ?? 0) || (a.createdAt || 0) - (b.createdAt || 0);
    const walk = (parentUid, depth) => {
      const kids = cards.filter(c => (c.parentUid || null) === parentUid).sort(byIndex);
      return kids.map(c => {
        const code = sceneCode(c, db);
        const pad = '\u00a0'.repeat(depth * 2);
        const sel = c.uid === selected ? 'selected' : '';
        return `<option value="${esc(c.uid)}" ${sel}>${pad}${esc(code)} — ${esc(c.title || 'Untitled')}</option>${walk(c.uid, depth + 1)}`;
      }).join('');
    };
    return `<option value="">— Unscoped —</option>${walk(null, 0)}`;
  }

  _committed(t) {
    return !!(t && t.committed === true && String(t.title || '').trim() && Number(t.durationMs) > 0);
  }

  async render(container) {
    this.container = container;
    this._migrate();
    this._audio.volume = clamp01(this.state.volume);
    const now = this._track(this._nowPlayingId);
    const sp = this._spState();
    const spLabel = this._spotifyConnected()
      ? (sp.displayName ? `Spotify · ${sp.displayName}` : 'Spotify · connected')
      : 'Spotify';
    if (this._page !== 'queue') await this._hydrateFocusedAlbum();
    const list = this._page === 'queue' ? this._queueTracks() : this._viewportTracks();
    this._parkEmbed();

    const playerHtml = this._playerHTML(now);
    const body = `
        <div class="cmp-body">
          ${this._page === 'queue' ? '' : this._wheelHTML()}
          ${this._page === 'queue' ? this._queueSectionHTML(list, now) : this._librarySectionHTML(list, now)}
        </div>`;

    container.innerHTML = `
      <div class="cmp-root">
        <div class="cmp-toolbar">
          <div class="cmp-kicker">Composer · ${this._page === 'queue' ? 'queue' : 'library'}</div>
          ${this._pageTabsHTML()}
          <button type="button" class="cmp-btn gold" data-action="spotify">${esc(spLabel)}</button>
        </div>
        ${body}
        ${this._popped ? `<div class="cmp-deck-stub">Tape deck is popped out. <button type="button" class="cmp-btn" data-action="dock">Dock</button></div>` : playerHtml}
      </div>
    `;

    this._mountPlayerChrome(playerHtml, container);

    container.querySelector('[data-action="back-singles"]')?.addEventListener('click', () => {
      this._focus = { kind: 'singles', id: null };
      this._shuffleBag = [];
      this.render(this.container);
    });
    container.querySelector('[data-action="dock"]')?.addEventListener('click', () => {
      this._popped = false;
      this.render(this.container);
    });
    container.querySelector('[data-action="add"]')?.addEventListener('click', () => this._openEditor());
    container.querySelector('[data-action="spotify"]')?.addEventListener('click', () => this._openSpotifyModal());
    container.querySelector('[data-action="add-shelf"]')?.addEventListener('click', () => this._openShelfEditor());
    container.querySelector('[data-action="import-shelf"]')?.addEventListener('click', () => this._openImport());
    container.querySelectorAll('[data-action="shelf-step"]').forEach(btn => {
      btn.addEventListener('click', () => {
        this._stepShelf(btn.dataset.dir === 'left' ? -1 : 1);
      });
    });
    container.querySelectorAll('[data-action="focus-shelf"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const albums = this._albums();
        const idx = albums.findIndex(a => a.id === id);
        if (idx < 0) return;
        this._shelfIndex = idx;
        this._focus = { kind: 'album', id };
        this._shuffleBag = [];
        this.render(this.container);
      });
    });
    container.querySelectorAll('[data-action="play-shelf"]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const id = btn.dataset.id;
        const idx = this._albums().findIndex(a => a.id === id);
        if (idx >= 0) this._shelfIndex = idx;
        this._focus = { kind: 'album', id };
        this._shuffleBag = [];
        this._replaceQueue(this._viewportTracks());
        const first = this._orderedPlayable()[0];
        if (first) this._playTrack(first.id);
        else this.render(this.container);
      });
    });
    container.querySelectorAll('[data-action="edit-shelf"]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const row = this._album(btn.dataset.id);
        if (row) this._openShelfEditor(row);
      });
    });
    container.querySelectorAll('[data-action="play-cue"]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        this._playTrack(btn.dataset.id);
      });
    });
    container.querySelectorAll('[data-action="edit-cue"]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const t = this._track(btn.dataset.id);
        if (t) this._openEditor(t);
      });
    });
    container.querySelectorAll('[data-action="drop-cue"]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        this._removeTrack(btn.dataset.id);
      });
    });
    container.querySelectorAll('[data-action="commit-cue"]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        this._commitTrack(btn.dataset.id);
      });
    });
    container.querySelector('[data-action="page-library"]')?.addEventListener('click', () => {
      this._page = 'library';
      this.render(this.container);
    });
    container.querySelector('[data-action="page-queue"]')?.addEventListener('click', () => {
      this._page = 'queue';
      this._ensureSceneSeed();
      this.render(this.container);
    });
    container.querySelector('[data-action="queue-loop"]')?.addEventListener('click', () => {
      this._queueState().loop = !this._queueState().loop;
      this.saveState();
      this._paintTransportModes();
    });
    container.querySelector('[data-action="queue-sort"]')?.addEventListener('click', () => {
      this._sortQueueAgentic();
    });
    container.querySelector('[data-action="queue-snapshot"]')?.addEventListener('click', () => {
      this._snapshotQueueHistory();
      this._pruneQueueHistory();
      this.saveState();
      this._hint('Queue kept in history.');
      this.render(this.container);
    });
    container.querySelectorAll('[data-action="hist-restore"]').forEach(btn => {
      btn.addEventListener('click', () => this._restoreQueueHistory(btn.dataset.id));
    });
    container.querySelectorAll('[data-action="hist-lock"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const row = this._queueHistory().find(h => h.id === btn.dataset.id);
        this._lockQueueHistory(btn.dataset.id, !row?.locked);
      });
    });
    container.querySelectorAll('[data-action="hist-album"]').forEach(btn => {
      btn.addEventListener('click', () => this._saveQueueHistoryAsAlbum(btn.dataset.id));
    });
    container.querySelectorAll('[data-action="hist-drop"]').forEach(btn => {
      btn.addEventListener('click', () => this._dropQueueHistory(btn.dataset.id));
    });
    container.querySelector('[data-action="queue-suggest"]')?.addEventListener('click', () => {
      void this._suggestSpotifyFromTags();
    });
    container.querySelector('[data-action="scene-add"]')?.addEventListener('click', () => {
      this._openSceneKeyAdd(container.querySelector('[data-role="scene-kw"]'));
    });
    container.querySelector('[data-action="scene-pull"]')?.addEventListener('click', () => {
      this._mergeInferredScene();
      this.render(this.container);
    });
    container.querySelector('[data-role="scene-kw"]')?.addEventListener('click', e => {
      const x = e.target.closest('.cmp-pill-x');
      if (x) {
        x.closest('.cmp-pill-edit')?.remove();
        this._saveSceneFromEditor(container.querySelector('[data-role="scene-kw"]'));
        return;
      }
      const cat = e.target.closest('[data-action="scene-cycle"]');
      if (!cat) return;
      this._cycleSceneChip(cat);
      this._saveSceneFromEditor(container.querySelector('[data-role="scene-kw"]'));
    });
    container.querySelector('[data-action="queue-clear"]')?.addEventListener('click', () => {
      this._snapshotQueueHistory();
      this._queueState().ids = [];
      this._shuffleBag = [];
      this.saveState();
      this.render(this.container);
    });
    container.querySelectorAll('[data-action="queue-remove"]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const q = this._queueState();
        q.ids = q.ids.filter(id => id !== btn.dataset.id);
        this.saveState();
        this.render(this.container);
      });
    });
    container.querySelectorAll('[data-action="queue-album"]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        this._openAlbumPicker(btn.dataset.id);
      });
    });
    if (this._page === 'queue') this._bindQueueDrag(container);
  }

  _viewportTitle() {
    if (this._focus.kind === 'album') {
      const a = this._album(this._focus.id);
      return a ? `Album · ${esc(a.title)}` : 'Singles';
    }
    return 'Singles / unattributed';
  }

  _viewportEmpty() {
    if (this._focus.kind === 'album') return 'No tracks on this album yet. Import again, or add cues while it is selected.';
    return 'Loose cues land here. Albums live on the shelf above.';
  }

  _viewportTracks() {
    if (this._focus.kind === 'album') {
      const a = this._album(this._focus.id);
      return (a?.trackIds ?? []).map(id => this._track(id)).filter(Boolean);
    }
    return this._tracks().filter(t => !t.albumId);
  }

  _queueState() {
    this.state.queue ??= { ids: [], loop: true };
    if (!Array.isArray(this.state.queue.ids)) this.state.queue.ids = [];
    if (typeof this.state.queue.loop !== 'boolean') this.state.queue.loop = true;
    return this.state.queue;
  }

  _pruneQueue() {
    const q = this._queueState();
    const keep = q.ids.filter(id => this._track(id));
    if (keep.length !== q.ids.length) q.ids = keep;
    return q;
  }

  _queueTracks() {
    this._pruneQueue();
    return this._queueState().ids.map(id => this._track(id)).filter(Boolean);
  }

  _replaceQueue(tracks, { remember = true } = {}) {
    const ids = (tracks || [])
      .filter(t => this._committed(t) && this._cueSource(t).playable)
      .map(t => t.id);
    if (remember) this._snapshotQueueHistory();
    this._queueState().ids = ids;
    this.saveState();
  }

  _queueHistory() {
    this.state.queueHistory ??= [];
    return this.state.queueHistory;
  }

  _pruneQueueHistory() {
    const hist = this._queueHistory();
    const locked = hist.filter(h => h.locked);
    const unlocked = hist.filter(h => !h.locked).slice(0, 2);
    this.state.queueHistory = [...locked, ...unlocked]
      .sort((a, b) => (b.at || 0) - (a.at || 0));
  }

  _snapshotQueueHistory() {
    const ids = [...(this._queueState().ids || [])].filter(id => this._track(id));
    if (ids.length < 2) return;
    const hist = this._queueHistory();
    const sig = ids.join('|');
    if (hist.some(h => (h.ids || []).join('|') === sig)) return;
    const facets = this._calledFacets?.() || this.state.sceneFacets || {};
    const labelBits = ENABLE_FACET_ORDER
      .flatMap(id => facets[id] || [])
      .concat(facets.objects || [])
      .slice(0, 4);
    const label = labelBits.length
      ? labelBits.join(' · ')
      : `${ids.length} cues · ${new Date().toLocaleString()}`;
    hist.unshift({
      id: uid(),
      label: String(label).slice(0, 80),
      ids,
      at: Date.now(),
      locked: false,
    });
    this._pruneQueueHistory();
  }

  _restoreQueueHistory(id) {
    const row = this._queueHistory().find(h => h.id === id);
    if (!row?.ids?.length) return;
    this._replaceQueue(row.ids.map(tid => this._track(tid)).filter(Boolean), { remember: false });
    this._shuffleBag = [];
    this._page = 'queue';
    this.saveState();
    this.render(this.container);
  }

  _lockQueueHistory(id, locked = true) {
    const row = this._queueHistory().find(h => h.id === id);
    if (!row) return;
    row.locked = !!locked;
    this._pruneQueueHistory();
    this.saveState();
    this.render(this.container);
  }

  _saveQueueHistoryAsAlbum(id) {
    const row = this._queueHistory().find(h => h.id === id);
    if (!row?.ids?.length) return;
    const title = prompt('Album title', row.label || 'Scene queue')?.trim();
    if (!title) return;
    const fresh = {
      id: uid(),
      title,
      badge: '',
      scriptUid: '',
      artist: '',
      sourceUrl: '',
      trackIds: [...row.ids],
    };
    this.state.albums.push(fresh);
    row.locked = true;
    row.label = title;
    this._pruneQueueHistory();
    this._shelfIndex = this.state.albums.length - 1;
    this._focus = { kind: 'album', id: fresh.id };
    this.saveState();
    this._hint(`Saved “${title}” as album — kept in history as locked.`);
    this.render(this.container);
  }

  _dropQueueHistory(id) {
    this.state.queueHistory = this._queueHistory().filter(h => h.id !== id);
    this.saveState();
    this.render(this.container);
  }

  _historyMatchForEligible(eligible) {
    const want = new Set((eligible || []).map(t => t.id));
    if (want.size < 2) return null;
    const scored = this._queueHistory()
      .map(h => {
        const ids = (h.ids || []).filter(id => want.has(id) && this._track(id));
        return { h, ids, score: ids.length };
      })
      .filter(x => x.score >= Math.min(2, want.size))
      .sort((a, b) => b.score - a.score || (b.h.locked ? 1 : 0) - (a.h.locked ? 1 : 0) || (b.h.at || 0) - (a.h.at || 0));
    return scored[0] || null;
  }

  _offerQueue(id) {
    const q = this._queueState();
    if (!id || q.ids.includes(id)) return;
    const t = this._track(id);
    if (!t || !this._committed(t)) return;
    q.ids.push(id);
    this.saveState();
  }

  _pageTabsHTML() {
    const onQ = this._page === 'queue';
    return `
      <div class="cmp-pages">
        <button type="button" class="cmp-btn${onQ ? '' : ' gold'}" data-action="page-library">Library</button>
        <button type="button" class="cmp-btn${onQ ? ' gold' : ''}" data-action="page-queue">Queue</button>
      </div>`;
  }

  _librarySectionHTML(list, now) {
    return `
      <section class="cmp-singles">
        <header class="cmp-shelf-head">
          ${this._focus.kind === 'album'
            ? `<button type="button" class="cmp-btn" data-action="back-singles">← Singles</button>`
            : ''}
          <div class="cmp-shelf-label">${this._viewportTitle()}</div>
          <button type="button" class="cmp-btn" data-action="add">+ Cue</button>
        </header>
        <div class="cmp-singles-list">
          ${list.length ? list.map(t => this._rowHTML(t, now?.id === t.id)).join('') : `<div class="cmp-empty">${this._viewportEmpty()}</div>`}
        </div>
      </section>`;
  }

  _queueSectionHTML(list, now) {
    const q = this._queueState();
    this._ensureSceneSeed();
    const scene = this._calledFacets();
    const chips = FACETS.flatMap(f =>
      (scene[f.id] || []).map(v => this._sceneChipHTML(f.id, v)),
    ).join('');
    const hist = this._queueHistory();
    const total = this._queueDurationSummary(list);
    return `
      <section class="cmp-singles cmp-queue">
        <header class="cmp-shelf-head">
          <div class="cmp-shelf-label">Now playing${total.label ? ` · <span class="cmp-queue-len" title="${esc(total.title)}">${esc(total.label)}</span>` : ''}</div>
          <button type="button" class="cmp-btn${q.loop ? ' gold' : ''}" data-action="queue-loop" title="Loop the queue">${q.loop ? 'Loop on' : 'Loop off'}</button>
          <button type="button" class="cmp-btn" data-action="queue-sort" title="Reuse a saved queue when possible, else rebuild from scene keys">Sort by scene</button>
          ${this._spotifyConnected()
            ? `<button type="button" class="cmp-btn gold" data-action="queue-suggest" title="Search Spotify from the current scene keys">Suggest</button>`
            : ''}
          <button type="button" class="cmp-btn" data-action="queue-snapshot" title="Keep this queue in history">Save queue</button>
          <button type="button" class="cmp-btn" data-action="queue-clear" title="Empty the queue">Clear</button>
        </header>
        <div class="cmp-queue-scene">
          <div class="cmp-queue-scene-label">Scene keys <span class="cmp-hint">same types as Script — click the type to change it</span></div>
          <div class="cmp-kw" data-role="scene-kw">
            <div class="cmp-pills">${chips || '<span class="cmp-hint">None yet. Add keys, or fill from Script / chat.</span>'}</div>
            <button type="button" class="cmp-btn small" data-action="scene-add">＋ Add keywords</button>
            <button type="button" class="cmp-btn small" data-action="scene-pull">Fill from Script</button>
          </div>
        </div>
        ${hist.length ? `
        <div class="cmp-queue-history">
          <div class="cmp-queue-scene-label">Queue history <span class="cmp-hint">up to 2 open slots · lock or save as album to keep</span></div>
          ${hist.map(h => {
            const tracks = (h.ids || []).map(id => this._track(id)).filter(Boolean);
            const n = tracks.length;
            const hDur = this._queueDurationSummary(tracks);
            return `
              <div class="cmp-hist-row${h.locked ? ' locked' : ''}" data-hist="${esc(h.id)}">
                <span class="cmp-hist-label" title="${esc(h.label)}">${h.locked ? '◆ ' : ''}${esc(h.label)} · ${n}${hDur.label ? ` · ${esc(hDur.label)}` : ''}</span>
                <button type="button" class="cmp-btn small" data-action="hist-restore" data-id="${esc(h.id)}">Load</button>
                <button type="button" class="cmp-btn small" data-action="hist-lock" data-id="${esc(h.id)}">${h.locked ? 'Unlock' : 'Lock'}</button>
                <button type="button" class="cmp-btn small" data-action="hist-album" data-id="${esc(h.id)}">Album</button>
                <button type="button" class="cmp-icon danger" data-action="hist-drop" data-id="${esc(h.id)}" title="Forget">✕</button>
              </div>`;
          }).join('')}
        </div>` : ''}
        <div class="cmp-singles-list cmp-queue-list">
          ${list.length ? list.map(t => this._rowHTML(t, now?.id === t.id, { queue: true })).join('') : `<div class="cmp-empty">Nothing queued. Play a cue or album from Library, Sort by scene, or Suggest — only those tracks land here.</div>`}
        </div>
      </section>`;
  }

  _queueDurationSummary(list) {
    const tracks = list || [];
    if (!tracks.length) return { ms: 0, label: '', title: '' };
    let ms = 0;
    let known = 0;
    for (const t of tracks) {
      const d = Number(t.durationMs) || 0;
      if (d > 0) { ms += d; known += 1; }
    }
    if (!known) return { ms: 0, label: '', title: 'No durations filed yet' };
    const approx = known < tracks.length;
    const label = `${approx ? '~' : ''}${formatDuration(ms)}`;
    const title = approx
      ? `${formatDuration(ms)} from ${known}/${tracks.length} cues with duration`
      : `${tracks.length} cue${tracks.length === 1 ? '' : 's'} · ${formatDuration(ms)}`;
    return { ms, label, title };
  }

  _sceneChipHTML(facet, value) {
    return `<span class="cmp-pill cmp-pill-edit facet-${esc(facet)}" data-facet="${esc(facet)}" data-value="${esc(value)}" title="${esc(facetTag(facet, FACETS))}">
      <button type="button" class="cmp-pill-cat" data-action="scene-cycle" data-facet="${esc(facet)}" data-value="${esc(value)}" title="Change type">${esc(facetTag(facet, FACETS))}</button>
      ${esc(value)}
      <button type="button" class="cmp-pill-x" title="Remove">×</button>
    </span>`;
  }

  _ensureShelfIndex() {
    const n = this._albums().length;
    if (!n) { this._shelfIndex = 0; return; }
    if (this._focus.kind === 'album' && this._focus.id) {
      const i = this._albums().findIndex(a => a.id === this._focus.id);
      if (i >= 0) this._shelfIndex = i;
    }
    this._shelfIndex = ((this._shelfIndex % n) + n) % n;
  }

  _stepShelf(dir) {
    const albums = this._albums();
    if (!albums.length) return;
    this._ensureShelfIndex();
    this._shelfIndex = (this._shelfIndex + dir + albums.length) % albums.length;
    const row = albums[this._shelfIndex];
    this._focus = { kind: 'album', id: row.id };
    this._shuffleBag = [];
    this.render(this.container);
  }

  _wheelSlots() {
    const albums = this._albums();
    const n = albums.length;
    if (!n) return [];
    this._ensureShelfIndex();
    const center = this._shelfIndex;
    const span = 3;
    if (n > span * 2) {
      const slots = [];
      for (let offset = -span; offset <= span; offset++) {
        slots.push({ row: albums[(center + offset + n) % n], offset });
      }
      return slots;
    }
    const slots = [];
    for (let offset = -span; offset <= span; offset++) {
      const i = center + offset;
      if (i >= 0 && i < n) slots.push({ row: albums[i], offset });
    }
    return slots;
  }

  _wheelHTML() {
    const slots = this._wheelSlots();
    return `
      <section class="cmp-shelf cmp-shelf--wheel">
        <header class="cmp-shelf-head">
          <div class="cmp-shelf-label">Albums</div>
          <button type="button" class="cmp-btn" data-action="import-shelf">Import link</button>
          <button type="button" class="cmp-btn" data-action="add-shelf">+ Album</button>
        </header>
        <div class="cmp-shelf-row">
          <button type="button" class="cmp-shelf-nav" data-action="shelf-step" data-dir="left" aria-label="Previous album">‹</button>
          <div class="cmp-wheel" data-rail="album">
            ${slots.length ? slots.map(s => this._badgeHTML(s.row, s.offset)).join('') : `<div class="cmp-shelf-empty">Empty shelf</div>`}
          </div>
          <button type="button" class="cmp-shelf-nav" data-action="shelf-step" data-dir="right" aria-label="Next album">›</button>
        </div>
      </section>
    `;
  }

  _badgeHTML(row, offset) {
    const abs = Math.abs(offset);
    const dim = abs >= 3 ? 'far' : abs === 2 ? 'outer' : abs === 1 ? 'mid' : 'center';
    const on = this._focus.kind === 'album' && this._focus.id === row.id;
    const attr = this._scopeLabel(row.scriptUid);
    const mono = (row.title || '?').charAt(0).toUpperCase();
    return `
      <div class="cmp-badge${on ? ' on' : ''}" data-dim="${dim}" data-action="focus-shelf" data-id="${row.id}" role="button" tabindex="0">
        <div class="cmp-badge-face">
          ${row.badge ? `<img src="${esc(row.badge)}" alt="">` : `<span class="cmp-monogram">${esc(mono)}</span>`}
          <button type="button" class="cmp-badge-edit" data-action="edit-shelf" data-id="${row.id}" title="Edit album">✎</button>
          <button type="button" class="cmp-badge-play" data-action="play-shelf" data-id="${row.id}" title="Play">▶</button>
        </div>
        <div class="cmp-badge-title">${esc(row.title || 'Untitled')}</div>
        <div class="cmp-badge-attr">${attr ? esc(attr) : (row.artist ? esc(row.artist) : 'Unscoped')}</div>
      </div>
    `;
  }

  _rowHTML(t, playing, opts = {}) {
    const src = this._cueSource(t);
    const dur = formatDuration(t.durationMs);
    const ready = this._committed(t);
    const badge = SOURCE_BADGE[src.kind] || '';
    const artist = t.artist || t.uploader || 'Unknown artist';
    const backup = t.backupUrl ? ' · backup' : '';
    const album = t.albumId ? this._album(t.albumId) : null;
    const attr = album ? `Album · ${album.title}` : 'Singles';
    const drag = opts.queue ? ' draggable="true"' : '';
    return `
      <article class="cmp-card${playing ? ' playing' : ''}${ready ? '' : ' draft'}${opts.queue ? ' cmp-card--queue' : ''}" data-id="${t.id}"${drag}>
        <div class="cmp-card-main">
          ${opts.queue ? `<span class="cmp-drag" title="Drag to reorder" aria-hidden="true">⋮⋮</span>` : ''}
          <button type="button" class="cmp-play" data-action="play-cue" data-id="${t.id}" ${ready && src.playable ? '' : 'disabled'}>${playing && !this._isPaused() ? '❚❚' : '▶'}</button>
          <div class="cmp-card-copy">
            <div class="cmp-title">${esc(t.title || 'Untitled cue')}</div>
            <div class="cmp-artist">${esc(artist)} · ${esc(attr)} · ${esc(dur)}${badge ? ` · ${badge}` : ''}${backup}${ready ? '' : ' · draft'}</div>
          </div>
          <div class="cmp-card-actions">
            ${ready ? '' : `<button type="button" class="cmp-btn small" data-action="commit-cue" data-id="${t.id}">Commit</button>`}
            <button type="button" class="cmp-icon" data-action="queue-album" data-id="${t.id}" title="Add to album">＋</button>
            <button type="button" class="cmp-icon" data-action="edit-cue" data-id="${t.id}" title="Edit">✎</button>
            ${opts.queue
              ? `<button type="button" class="cmp-icon danger" data-action="queue-remove" data-id="${t.id}" title="Remove from queue">✕</button>`
              : `<button type="button" class="cmp-icon danger" data-action="drop-cue" data-id="${t.id}" title="Remove">✕</button>`}
          </div>
        </div>
      </article>
    `;
  }

  _playerHTML(now) {
    const title = now ? `${now.title}${now.artist ? ` — ${now.artist}` : ''}` : 'No tape loaded';
    const dur = now?.durationMs ? formatDuration(now.durationMs) : '0:00';
    const rep = this.state.repeat === 'one' ? 'REP 1' : this.state.repeat === 'all' ? 'REP A' : 'REP';
    const muted = this._muted;
    const playing = now && !this._isPaused();
    return `
      <div class="cmp-deck" data-role="player">
        <div class="cmp-deck-face">
          <div class="cmp-cassette">
            <div class="cmp-cassette-window">
              <div class="cmp-tape-copy">
                <div class="cmp-now">${esc(title)}</div>
                <div class="cmp-tape-times"><span data-role="elapsed">0:00</span> / <span data-role="duration">${esc(dur)}</span></div>
              </div>
            </div>
            <div class="cmp-reels">
              <button type="button" class="cmp-reel${playing ? ' spinning' : ''}" data-player="toggle" title="Play / pause" aria-label="Play or pause"><span class="cmp-reel-mark" data-role="reel-play">${playing ? '❚❚' : '▶'}</span></button>
              <button type="button" class="cmp-reel${muted ? ' muted' : ''}" data-player="mute" title="Mute / unmute" aria-label="Mute or unmute"><span class="cmp-reel-mark">${muted ? '×' : '♪'}</span></button>
            </div>
          </div>
          <div class="cmp-deck-keys" role="group" aria-label="Tape transport">
            <button type="button" class="cmp-key" data-player="prev" title="Previous track">BCK</button>
            <button type="button" class="cmp-key" data-player="stop" title="Stop">STOP</button>
            <button type="button" class="cmp-key" data-player="next" title="Next track">NXT</button>
            <button type="button" class="cmp-key${this.state.repeat !== 'off' ? ' on' : ''}" data-player="repeat" title="${this.state.repeat === 'one' ? 'Repeat one (track)' : this.state.repeat === 'all' ? 'Repeat all (wrap queue / library)' : 'Repeat off'}">${esc(rep)}</button>
            <button type="button" class="cmp-key${this.state.shuffle ? ' on' : ''}" data-player="shuffle" title="${this.state.shuffle ? 'Shuffle on' : 'Shuffle off'}">SHUF</button>
            <button type="button" class="cmp-key${this._popped ? ' on' : ''}" data-player="eject" title="Pop out mini player">EJECT</button>
          </div>
          <div class="cmp-deck-meter" title="Tape counter">
            <span class="cmp-deck-tag">CTR</span>
            <input type="range" min="0" max="1000" value="0" data-role="seek" aria-label="Seek">
          </div>
          <div class="cmp-deck-vol" title="Volume">
            <span class="cmp-deck-tag">VOL</span>
            <input type="range" min="0" max="100" value="${Math.round(clamp01(this.state.volume) * 100)}" data-role="volume" aria-label="Volume">
          </div>
        </div>
        <div class="cmp-player-hint" data-role="play-hint"></div>
      </div>
    `;
  }

  _ensureMini() {
    if (this._miniRoot) return this._miniRoot;
    const mini = document.createElement('div');
    mini.className = 'cmp-mini';
    mini.innerHTML = `
      <div class="cmp-mini-bar" data-role="mini-drag">TAPE DECK
        <button type="button" class="cmp-btn small" data-action="dock" style="margin:0">Dock</button>
      </div>
      <div data-role="mini-mount"></div>
    `;
    mini.querySelector('[data-action="dock"]').addEventListener('click', () => {
      this._popped = false;
      this.render(this.container);
    });
    document.body.appendChild(mini);
    this._makeMiniDraggable(mini, mini.querySelector('[data-role="mini-drag"]'));
    this._miniRoot = mini;
    return mini;
  }

  _mountPlayerChrome(playerHtml, container) {
    const mini = this._ensureMini();
    mini.hidden = !this._popped;
    const mount = mini.querySelector('[data-role="mini-mount"]');
    if (this._popped) {
      mount.innerHTML = playerHtml;
      this._bindPlayer(mini);
      // Convert CSS right/bottom default to left/top once, then clamp.
      if (!mini.style.left && !mini.style.top) {
        const rect = mini.getBoundingClientRect();
        mini.style.left = `${rect.left}px`;
        mini.style.top = `${rect.top}px`;
        mini.style.right = 'auto';
        mini.style.bottom = 'auto';
      }
      clampFixedElement(mini);
    } else {
      mount.innerHTML = '';
      this._bindPlayer(container);
    }
    this._syncEmbedVisibility();
    this._paintPlayer();
    // Re-arm the clock after DOM rebuilds so elapsed/duration keep moving.
    if (this._nowPlayingId && !this._isPaused()) this._startTick();
  }

  _startTick() {
    this._stopTick();
    this._tick = setInterval(() => {
      // Poll SoundCloud / Spotify position when their progress events go quiet.
      if (this._engine === 'soundcloud' && this._sc) {
        try {
          this._sc.getPosition?.(ms => { this._lastT = (ms || 0) / 1000; });
          this._sc.getDuration?.(ms => {
            const sec = (ms || 0) / 1000;
            if (sec > 0) {
              this._lastD = sec;
              this._stampDurationFromSeconds(sec);
            }
          });
        } catch { /* widget busy */ }
      }
      if (this._engine === 'spotify' && this._sp) {
        try {
          this._sp.getCurrentState?.().then(state => {
            if (!state) return;
            this._lastT = (state.position || 0) / 1000;
            this._lastD = (state.duration || 0) / 1000;
            if (this._lastD > 0) this._stampDurationFromSeconds(this._lastD);
          }).catch(() => {});
        } catch { /* noop */ }
      }
      if (this._engine === 'youtube' && this._yt?.getDuration) {
        try {
          const d = Number(this._yt.getDuration()) || 0;
          if (d > 0) this._stampDurationFromSeconds(d);
        } catch { /* noop */ }
      }
      this._paintPlayer();
    }, 250);
  }

  _makeMiniDraggable(el, handle) {
    let sx = 0, sy = 0, ox = 0, oy = 0, dragging = false;
    const clamp = () => clampFixedElement(el);
    handle.addEventListener('mousedown', e => {
      if (e.target.closest('button')) return;
      dragging = true;
      sx = e.clientX; sy = e.clientY;
      const rect = el.getBoundingClientRect();
      ox = rect.left; oy = rect.top;
      e.preventDefault();
    });
    const paintDrag = rafMove(e => {
      if (!dragging) return;
      el.style.left = `${ox + (e.clientX - sx)}px`;
      el.style.top = `${oy + (e.clientY - sy)}px`;
      el.style.right = 'auto';
      el.style.bottom = 'auto';
      clamp();
    });
    window.addEventListener('mousemove', e => {
      if (dragging) paintDrag(e);
    });
    window.addEventListener('mouseup', () => {
      if (!dragging) return;
      paintDrag.flush();
      dragging = false;
      clamp();
    });
    window.addEventListener('resize', () => {
      if (el.isConnected && !el.hidden) clamp();
    });
  }

  _bindPlayer(root) {
    root.querySelector('[data-player="toggle"]')?.addEventListener('click', () => this._toggle());
    root.querySelector('[data-player="mute"]')?.addEventListener('click', () => this._toggleMute());
    root.querySelector('[data-player="stop"]')?.addEventListener('click', () => this._stopDeck());
    root.querySelector('[data-player="prev"]')?.addEventListener('click', () => this._playOffset(-1));
    root.querySelector('[data-player="next"]')?.addEventListener('click', () => this._playOffset(1));
    root.querySelector('[data-player="eject"]')?.addEventListener('click', () => {
      this._popped = !this._popped;
      this.render(this.container);
    });
    root.querySelector('[data-player="repeat"]')?.addEventListener('click', () => {
      this.state.repeat = this.state.repeat === 'off' ? 'all' : this.state.repeat === 'all' ? 'one' : 'off';
      this.saveState();
      this._paintTransportModes();
    });
    root.querySelector('[data-player="shuffle"]')?.addEventListener('click', () => {
      this.state.shuffle = !this.state.shuffle;
      this._shuffleBag = [];
      if (this.state.shuffle) this._ensureShuffleBag({ force: true });
      this.saveState();
      this._paintTransportModes();
    });
    root.querySelector('[data-role="seek"]')?.addEventListener('input', e => {
      this._seekRatio(Number(e.target.value) / 1000);
    });
    const volEl = root.querySelector('[data-role="volume"]');
    volEl?.addEventListener('input', e => {
      // Apply live, but persist only when the drag ends — saving on every
      // input event puts a settings write in the middle of the gesture.
      this.state.volume = clamp01(Number(e.target.value) / 100);
      if (this._muted && this.state.volume > 0) this._muted = false;
      this._applyVolume();
      this._paintPlayer();
    });
    volEl?.addEventListener('change', () => this.saveState());
  }

  _isPaused() {
    if (this._engine === 'youtube') return this._ytState !== 1;
    if (this._engine === 'soundcloud') return !this._scPlaying;
    if (this._engine === 'spotify') return !this._spPlaying;
    return this._audio.paused;
  }

  _trackDurationSec(id = this._nowPlayingId) {
    const t = this._track(id);
    const ms = Number(t?.durationMs) || 0;
    return ms > 0 ? ms / 1000 : 0;
  }

  _times() {
    const fallbackD = this._trackDurationSec();
    let t = 0;
    let d = 0;
    try {
      if (this._engine === 'youtube' && this._yt?.getCurrentTime) {
        t = Number(this._yt.getCurrentTime()) || 0;
        d = Number(this._yt.getDuration()) || 0;
      } else if (this._engine === 'file') {
        t = Number(this._audio.currentTime) || 0;
        d = Number.isFinite(this._audio.duration) && this._audio.duration > 0
          ? this._audio.duration
          : 0;
      } else if (this._engine === 'soundcloud' || this._engine === 'spotify') {
        t = Number(this._lastT) || 0;
        d = Number(this._lastD) || 0;
      }
    } catch { /* player not ready */ }
    if (!(d > 0)) d = (Number(this._lastD) > 0 ? Number(this._lastD) : fallbackD) || 0;
    if (!(t >= 0)) t = 0;
    if (d > 0 && t > d) t = d;
    this._lastT = t;
    if (d > 0) this._lastD = d;
    return { t, d };
  }

  _playerRoot() {
    if (this._popped && this._miniRoot) return this._miniRoot.querySelector('[data-role="player"]');
    return this.container?.querySelector('[data-role="player"]');
  }

  _paintPlayer() {
    const root = this._playerRoot();
    if (!root) return;
    const paused = this._isPaused();
    const playing = !paused && !!this._nowPlayingId;
    root.querySelectorAll('[data-player="toggle"]').forEach(el => {
      el.classList.toggle('spinning', playing);
      const mark = el.querySelector('[data-role="reel-play"]');
      if (mark) mark.textContent = playing ? '❚❚' : '▶';
    });
    const muteBtn = root.querySelector('[data-player="mute"]');
    if (muteBtn) {
      muteBtn.classList.toggle('muted', !!this._muted);
      const mark = muteBtn.querySelector('.cmp-reel-mark');
      if (mark) mark.textContent = this._muted ? '×' : '♪';
    }
    const { t, d } = this._times();
    const elapsed = root.querySelector('[data-role="elapsed"]');
    const durationEl = root.querySelector('[data-role="duration"]')
      || root.querySelector('[data-role="remain"]');
    const seek = root.querySelector('[data-role="seek"]');
    if (elapsed) elapsed.textContent = formatDuration(Math.max(0, t) * 1000);
    if (durationEl) durationEl.textContent = formatDuration(Math.max(0, d) * 1000);
    if (seek && d > 0 && document.activeElement !== seek) {
      seek.value = String(Math.round(Math.max(0, Math.min(1, t / d)) * 1000));
      seek.disabled = false;
    } else if (seek && !(d > 0)) {
      seek.value = '0';
    }
    const vol = root.querySelector('[data-role="volume"]');
    if (vol && document.activeElement !== vol) {
      vol.value = String(Math.round(clamp01(this.state.volume) * 100));
    }
    this.container?.querySelectorAll('.cmp-card').forEach(card => {
      const on = card.dataset.id === this._nowPlayingId;
      card.classList.toggle('playing', on);
      const play = card.querySelector('[data-action="play-cue"]');
      if (play) play.textContent = on && !paused ? '❚❚' : '▶';
    });
    const now = this._track(this._nowPlayingId);
    const label = root.querySelector('.cmp-now');
    if (label) {
      label.textContent = now
        ? `${now.title}${now.artist ? ` — ${now.artist}` : ''}`
        : 'Nothing cued';
    }
    this._syncEmbedVisibility();
  }

  _syncEmbedVisibility() {
    this._ytWrap.classList.toggle('on', this._engine === 'youtube');
    this._scFrame.classList.toggle('on', this._engine === 'soundcloud');
  }

  _hint(text) {
    const el = this._playerRoot()?.querySelector('[data-role="play-hint"]')
      || this.container?.querySelector('[data-role="play-hint"]');
    if (el) el.textContent = text || '';
  }

  _stopTick() {
    if (this._tick) {
      clearInterval(this._tick);
      this._tick = null;
    }
  }

  _applyVolume() {
    const v = this._muted ? 0 : clamp01(this.state.volume);
    this._audio.volume = v;
    try { this._yt?.setVolume?.(Math.round(v * 100)); } catch { /* noop */ }
    try {
      if (this._muted) this._yt?.mute?.();
      else this._yt?.unMute?.();
    } catch { /* noop */ }
    try { this._sc?.setVolume?.(v * 100); } catch { /* noop */ }
    try { this._sp?.setVolume?.(v); } catch { /* noop */ }
  }

  _toggleMute() {
    this._muted = !this._muted;
    this._applyVolume();
    this._paintPlayer();
  }

  _stopDeck() {
    this._pause();
    this._seekRatio(0);
    this._paintPlayer();
  }

  _stopEngines(except = null) {
    if (except !== 'file') {
      this._audio.pause();
      this._audio.removeAttribute('src');
    }
    if (except !== 'youtube') {
      try { this._yt?.stopVideo?.(); } catch { /* noop */ }
      this._ytState = -1;
    }
    if (except !== 'soundcloud') {
      try { this._sc?.pause?.(); } catch { /* noop */ }
      this._scPlaying = false;
    }
    if (except !== 'spotify') {
      try { this._sp?.pause?.(); } catch { /* noop */ }
      this._spPlaying = false;
    }
  }

  async _toggle() {
    if (!this._nowPlayingId) {
      const first = this._orderedPlayable()[0];
      if (first) await this._playTrack(first.id);
      return;
    }
    if (this._isPaused()) await this._resume();
    else this._pause();
    this._paintPlayer();
  }

  async _resume() {
    if (this._engine === 'youtube') this._yt?.playVideo?.();
    else if (this._engine === 'soundcloud') this._sc?.play?.();
    else if (this._engine === 'spotify') await this._sp?.resume?.();
    else await this._audio.play();
    this._startTick();
  }

  _pause() {
    if (this._engine === 'youtube') this._yt?.pauseVideo?.();
    else if (this._engine === 'soundcloud') this._sc?.pause?.();
    else if (this._engine === 'spotify') this._sp?.pause?.();
    else this._audio.pause();
    this._stopTick();
  }

  _seekRatio(ratio) {
    const r = Math.max(0, Math.min(1, ratio));
    const { d: liveD } = this._times();
    const d = liveD > 0 ? liveD : this._trackDurationSec();
    if (!(d > 0)) return;
    const at = r * d;
    this._lastT = at;
    this._lastD = d;
    if (this._engine === 'youtube' && this._yt?.seekTo) {
      this._yt.seekTo(at, true);
    } else if (this._engine === 'soundcloud' && this._sc) {
      this._sc.seekTo(at * 1000);
    } else if (this._engine === 'spotify' && this._sp?.seek) {
      void this._sp.seek(Math.round(at * 1000));
    } else if (this._engine === 'file') {
      try { this._audio.currentTime = at; } catch { /* not seekable yet */ }
    }
    this._paintPlayer();
  }

  _cueSource(t, preferBackup = false) {
    const primary = detectSource(t?.url);
    const backup = detectSource(t?.backupUrl);
    const spotifyBlocked = primary.kind === 'spotify' && !this._spotifyConnected();
    if ((preferBackup || spotifyBlocked) && backup.playable) {
      return { ...backup, url: t.backupUrl, via: 'backup' };
    }
    if (primary.playable) return { ...primary, url: t.url, via: 'primary' };
    if (backup.playable) return { ...backup, url: t.backupUrl, via: 'backup' };
    return { ...primary, url: t?.url || '', via: 'primary' };
  }

  async _playTrack(id, { forceRestart = false } = {}) {
    const t = this._track(id);
    if (!t) return;
    if (!this._committed(t)) {
      this._hint('Fill name and duration, then Commit before playback.');
      this._openEditor(t);
      return;
    }
    const src = this._cueSource(t);
    if (!src.playable) {
      this._hint('Unrecognized link. Use YouTube, SoundCloud, Spotify, a backup URL, or a direct audio file.');
      return;
    }
    if (!forceRestart && this._nowPlayingId === id && this._engine === src.kind) {
      await this._toggle();
      return;
    }
    this._nowPlayingId = id;
    this._hint('');
    this._lastT = 0;
    this._lastD = this._trackDurationSec(id);
    this._offerQueue(id);
    const tryPlay = async chosen => {
      this._stopEngines(chosen.kind);
      this._engine = chosen.kind;
      this._applyVolume();
      if (chosen.kind === 'youtube') await this._playYouTube(chosen.id);
      else if (chosen.kind === 'soundcloud') await this._playSoundCloud(chosen.url);
      else if (chosen.kind === 'spotify') await this._playSpotify(chosen.id);
      else await this._playFile(chosen.url);
    };
    try {
      await tryPlay(src);
      this._startTick();
      this._paintPlayer();
    } catch (err) {
      const backup = this._cueSource(t, true);
      if (backup.playable && backup.url && backup.url !== src.url) {
        this._hint('Primary failed — trying backup link.');
        try {
          await tryPlay(backup);
          this._startTick();
          this._paintPlayer();
          return;
        } catch (err2) {
          console.error('[Composer play]', err2);
          this._hint(err2.message || String(err2));
          return;
        }
      }
      console.error('[Composer play]', err);
      this._hint(err.message || String(err));
    }
  }

  async _playFile(url) {
    this._engine = 'file';
    this._audio.src = url;
    this._audio.volume = clamp01(this.state.volume);
    await this._audio.play();
  }

  async _playYouTube(videoId) {
    await loadScript('https://www.youtube.com/iframe_api', () => window.YT?.Player);
    await youtubeApiReady();
    this._engine = 'youtube';
    if (!this._yt) {
      this._yt = new window.YT.Player(this._ytBox, {
        height: '1',
        width: '1',
        videoId,
        playerVars: {
          controls: 0,
          fs: 0,
          rel: 0,
          modestbranding: 1,
          playsinline: 1,
          disablekb: 1,
          origin: location.origin,
        },
        events: {
          onReady: ev => {
            ev.target.setVolume(Math.round(clamp01(this.state.volume) * 100));
            if (this._muted) ev.target.mute?.();
            ev.target.playVideo();
            this._stampDurationFromSeconds(ev.target.getDuration?.() || 0);
          },
          onStateChange: ev => {
            this._ytState = ev.data;
            if (ev.data === 0) this._playNext();
            if (ev.data === 1) this._startTick();
            this._paintPlayer();
          },
          onError: () => this._hint('YouTube could not play this video (embed restricted).'),
        },
      });
    } else {
      this._yt.loadVideoById(videoId);
    }
  }

  async _playSoundCloud(url) {
    await loadScript('https://w.soundcloud.com/player/api.js', () => window.SC?.Widget);
    this._engine = 'soundcloud';
    const widgetUrl = `https://w.soundcloud.com/player/?url=${encodeURIComponent(url)}&auto_play=true&hide_related=true&show_comments=false&show_user=false&show_reposts=false&visual=false`;
    if (!this._sc) {
      this._scFrame.src = widgetUrl;
      this._sc = window.SC.Widget(this._scFrame);
      this._sc.bind(window.SC.Widget.Events.READY, () => {
        this._sc.setVolume(clamp01(this.state.volume) * 100);
        this._sc.getDuration(ms => this._stampDurationFromSeconds((ms || 0) / 1000));
        this._sc.play();
      });
      this._sc.bind(window.SC.Widget.Events.PLAY, () => {
        this._scPlaying = true;
        this._startTick();
        this._paintPlayer();
      });
      this._sc.bind(window.SC.Widget.Events.PAUSE, () => {
        this._scPlaying = false;
        this._paintPlayer();
      });
      this._sc.bind(window.SC.Widget.Events.FINISH, () => this._playNext());
      this._sc.bind(window.SC.Widget.Events.PLAY_PROGRESS, data => {
        this._lastT = (data?.currentPosition || 0) / 1000;
        this._sc.getDuration(ms => { this._lastD = (ms || 0) / 1000; });
      });
    } else {
      this._sc.load(url, { auto_play: true });
    }
  }

  async _playSpotify(trackId) {
    const token = await this._spotifyToken();
    if (!token) throw new Error('Connect Spotify Premium to embed Spotify tracks.');
    await this._ensureSpotifyDevice(token);
    this._engine = 'spotify';
    const res = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(this._spDeviceId)}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ uris: [`spotify:track:${trackId}`] }),
    });
    if (res.status === 403) throw new Error('Spotify needs a Premium account for in-app playback.');
    if (res.status === 404) throw new Error('Spotify player is not ready yet — connect again, then play.');
    if (!res.ok && res.status !== 204) throw new Error(`Spotify play failed (${res.status}).`);
    this._spPlaying = true;
    this._fetchSpotifyDuration(trackId, token);
  }

  async _fetchSpotifyDuration(trackId, token) {
    try {
      const res = await fetch(`https://api.spotify.com/v1/tracks/${trackId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      this._stampDurationFromSeconds((data.duration_ms || 0) / 1000);
      this._lastD = (data.duration_ms || 0) / 1000;
    } catch { /* noop */ }
  }

  _stampDurationFromSeconds(sec) {
    const n = Number(sec);
    if (!Number.isFinite(n) || n <= 0) return;
    const t = this._track(this._nowPlayingId);
    const ms = Math.round(n * 1000);
    if (t) {
      // Keep filed duration in sync with live media when missing or clearly wrong.
      if (!t.durationMs || t.durationMs < 1000 || Math.abs(t.durationMs - ms) > 1500) {
        t.durationMs = ms;
        this.saveState();
      }
    }
    this._lastD = n;
  }

  _playableList() {
    this._pruneQueue();
    const fromQueue = this._queueState().ids
      .map(id => this._track(id))
      .filter(t => t && this._committed(t) && this._cueSource(t).playable);
    if (fromQueue.length) return fromQueue;
    return this._viewportTracks().filter(t => this._committed(t) && this._cueSource(t).playable);
  }

  /** Rebuild the shuffle bag when the playable set changes; keep the current cue first. */
  _ensureShuffleBag({ force = false } = {}) {
    const ids = this._playableList().map(t => t.id);
    const stale = force
      || this._shuffleBag.length !== ids.length
      || this._shuffleBag.some(id => !ids.includes(id))
      || ids.some(id => !this._shuffleBag.includes(id));
    if (!stale) return;
    let bag = shuffleIds(ids);
    const pin = this._nowPlayingId;
    if (pin && bag.includes(pin)) {
      bag = [pin, ...bag.filter(id => id !== pin)];
    }
    this._shuffleBag = bag;
  }

  _orderedPlayable() {
    const list = this._playableList();
    if (!this.state.shuffle) return list;
    this._ensureShuffleBag();
    return this._shuffleBag.map(id => this._track(id)).filter(Boolean);
  }

  _playWraps() {
    // Deck REP A always wraps. Queue "Loop" is a separate control that also
    // wraps when a queue is loaded — either one is enough.
    if (this.state.repeat === 'all') return true;
    if (this._queueState().ids.length) return !!this._queueState().loop;
    return false;
  }

  _playOffset(dir) {
    const list = this._orderedPlayable();
    if (!list.length) return;
    const idx = list.findIndex(t => t.id === this._nowPlayingId);
    let nextIdx = idx < 0 ? 0 : idx + dir;
    if (nextIdx >= list.length) {
      if (this._playWraps()) nextIdx = 0;
      else return;
    }
    if (nextIdx < 0) {
      if (this._playWraps()) nextIdx = list.length - 1;
      else return;
    }
    const next = list[nextIdx];
    // Same cue (one-track wrap / reshuffled onto itself) must restart, not toggle pause.
    void this._playTrack(next.id, { forceRestart: next.id === this._nowPlayingId });
  }

  _playNext() {
    if (this.state.repeat === 'one' && this._nowPlayingId) {
      this._seekRatio(0);
      void this._resume();
      return;
    }
    this._playOffset(1);
  }

  _paintTransportModes() {
    const root = this._playerRoot();
    if (root) {
      const mode = this.state.repeat === 'one' || this.state.repeat === 'all' ? this.state.repeat : 'off';
      const rep = root.querySelector('[data-player="repeat"]');
      if (rep) {
        rep.classList.toggle('on', mode !== 'off');
        rep.textContent = mode === 'one' ? 'REP 1' : mode === 'all' ? 'REP A' : 'REP';
        rep.title = mode === 'one'
          ? 'Repeat one (track)'
          : mode === 'all'
            ? 'Repeat all (wrap queue / library)'
            : 'Repeat off';
      }
      const shuf = root.querySelector('[data-player="shuffle"]');
      if (shuf) {
        shuf.classList.toggle('on', !!this.state.shuffle);
        shuf.title = this.state.shuffle ? 'Shuffle on' : 'Shuffle off';
      }
    }
    const loopBtn = this.container?.querySelector('[data-action="queue-loop"]');
    if (loopBtn) {
      const on = !!this._queueState().loop;
      loopBtn.classList.toggle('gold', on);
      loopBtn.textContent = on ? 'Loop on' : 'Loop off';
      loopBtn.title = on ? 'Queue loop on (wraps with REP A)' : 'Queue loop off (REP A still wraps)';
    }
  }

  _commitTrack(id) {
    const t = this._track(id);
    if (!t) return;
    if (!String(t.title || '').trim() || !Number(t.durationMs)) {
      this._openEditor(t);
      alert('Name and duration are required to commit a cue.');
      return;
    }
    t.committed = true;
    this.saveState();
    this.render(this.container);
  }

  _removeTrack(id) {
    const t = this._track(id);
    if (!t) return;
    if (!confirm(`File away “${t.title}”?`)) return;
    if (this._nowPlayingId === id) {
      this._stopEngines();
      this._stopTick();
      this._nowPlayingId = null;
      this._engine = null;
    }
    this.state.library = this._tracks().filter(x => x.id !== id);
    for (const a of this._albums()) a.trackIds = (a.trackIds ?? []).filter(x => x !== id);
    const q = this._queueState();
    q.ids = q.ids.filter(x => x !== id);
    this.saveState();
    this.render(this.container);
  }

  // ── Spotify connect ────────────────────────────────────────────────────────

  _openSpotifyModal() {
    const sp = this._spState();
    const redirect = spotifyRedirectUri();
    const connected = this._spotifyConnected();
    const backdrop = this._modal(`
      <div class="cmp-modal-title">SPOTIFY</div>
      <div class="cmp-modal-sub">— Premium embed via the official player —</div>
      <p class="cmp-hint">YouTube and SoundCloud play from a pasted link with no login. Spotify will not stream a URL in the browser unless you connect a <strong>Premium</strong> account to an app you own. Add the redirect URI below to the Spotify app. Do not use SillyTavern’s main <code>/</code> URL — that hides chat. Reconnect must show Spotify’s permission screen (playlist access). A page refresh is not enough.</p>
      <div class="cmp-field"><label>Redirect URI (paste this in the Spotify dashboard)</label>
        <input type="text" readonly data-field="redirect" value="${esc(redirect)}"></div>
      <div class="cmp-field"><label>App client ID</label>
        <input type="text" data-field="clientId" value="${esc(sp.clientId)}" placeholder="From developer.spotify.com/dashboard"></div>
      <div class="cmp-hint">${connected ? `Connected${sp.displayName ? ` as ${esc(sp.displayName)}` : ''}. ${this._spotifyHasPlaylistScope() ? 'Playlist access is granted.' : 'Playlist access is missing — tap Reconnect and accept the new Spotify checkboxes.'}` : 'Not connected.'}</div>
      <div class="cmp-modal-actions">
        ${connected ? `<button type="button" class="cmp-btn" data-action="disconnect">Disconnect</button>` : ''}
        <button type="button" class="cmp-btn" data-action="cancel">Close</button>
        <button type="button" class="cmp-btn gold" data-action="connect">${connected ? 'Reconnect' : 'Connect Premium'}</button>
      </div>
    `);
    backdrop.querySelector('[data-action="cancel"]').addEventListener('click', () => backdrop.remove());
    backdrop.addEventListener('click', e => { if (e.target === backdrop) backdrop.remove(); });
    backdrop.querySelector('[data-action="disconnect"]')?.addEventListener('click', () => {
      Object.assign(sp, { accessToken: '', refreshToken: '', expiresAt: 0, displayName: '', grantedScope: '' });
      this.saveState();
      try { this._sp?.disconnect?.(); } catch { /* noop */ }
      this._sp = null;
      this._spDeviceId = '';
      this._spLastState = null;
      backdrop.remove();
      this.render(this.container);
    });
    backdrop.querySelector('[data-action="connect"]').addEventListener('click', () => {
      const id = backdrop.querySelector('[data-field="clientId"]').value.trim();
      if (!id) { alert('Client ID is required.'); return; }
      sp.clientId = id;
      Object.assign(sp, { accessToken: '', refreshToken: '', expiresAt: 0, displayName: '', grantedScope: '' });
      this.saveState();
      this._beginSpotifyLogin(id);
    });
  }

  async _beginSpotifyLogin(clientId) {
    const verifier = randomString(64);
    const challenge = await sha256Base64Url(verifier);
    const state = randomString(16);
    const redirect = spotifyRedirectUri();
    sessionStorage.setItem(SP_PKCE_KEY, JSON.stringify({ verifier, state, clientId, redirectUri: redirect }));
    const params = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: redirect,
      scope: SP_SCOPES,
      state,
      code_challenge_method: 'S256',
      code_challenge: challenge,
      show_dialog: 'true',
    });
    location.href = `https://accounts.spotify.com/authorize?${params}`;
  }

  async _catchSpotifyRedirect() {
    let code = '';
    let state = '';
    try {
      const stashed = sessionStorage.getItem('showtime_composer_spotify_callback');
      if (stashed) {
        sessionStorage.removeItem('showtime_composer_spotify_callback');
        const parsed = JSON.parse(stashed);
        code = parsed?.code || '';
        state = parsed?.state || '';
        if (parsed?.error) throw new Error(parsed.error);
      }
    } catch (err) {
      if (String(err.message || '').includes('JSON')) { /* ignore */ }
      else console.warn('[Composer Spotify]', err);
    }
    const params = new URLSearchParams(location.search);
    if (!code) code = params.get('code') || '';
    if (!state) state = params.get('state') || '';
    const raw = sessionStorage.getItem(SP_PKCE_KEY);
    const url = new URL(location.href);
    // Only touch the URL for a login Showtime started — other OAuth flows own their params.
    if (raw && (url.searchParams.has('code') || url.searchParams.has('state'))) {
      url.searchParams.delete('code');
      url.searchParams.delete('state');
      url.searchParams.delete('error');
      url.searchParams.delete('error_description');
      history.replaceState({}, '', url.pathname + url.search + url.hash);
    }
    if (!code || !raw) return;
    let saved;
    try { saved = JSON.parse(raw); } catch {
      alert('Spotify connect failed — could not read the saved login challenge. Try Connect again.');
      return;
    }
    if (!saved?.verifier || saved.state !== state) {
      alert('Spotify connect failed — login state mismatch (stale or interrupted). Try Connect again.');
      sessionStorage.removeItem(SP_PKCE_KEY);
      return;
    }
    sessionStorage.removeItem(SP_PKCE_KEY);
    try {
      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: saved.redirectUri || spotifyRedirectUri(),
        client_id: saved.clientId,
        code_verifier: saved.verifier,
      });
      const res = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error_description || data.error || 'Token exchange failed');
      const sp = this._spState();
      this._commitSpotifyToken(sp, data, saved.clientId);
      const me = await fetch('https://api.spotify.com/v1/me', {
        headers: { Authorization: `Bearer ${sp.accessToken}` },
      }).then(r => r.ok ? r.json() : null).catch(() => null);
      sp.displayName = me?.display_name || me?.id || '';
      this.saveState();
    } catch (err) {
      console.error('[Composer Spotify]', err);
      alert(`Spotify connect failed: ${err.message || err}`);
    }
  }

  _commitSpotifyToken(sp, data, clientId) {
    if (clientId) sp.clientId = clientId;
    sp.accessToken = data.access_token;
    if (data.refresh_token) sp.refreshToken = data.refresh_token;
    sp.expiresAt = Date.now() + (Number(data.expires_in) || 3600) * 1000;
    if (data.scope) sp.grantedScope = String(data.scope);
  }

  async _spotifyToken() {
    const sp = this._spState();
    if (sp.accessToken && sp.expiresAt > Date.now() + 15000) return sp.accessToken;
    if (!sp.refreshToken || !sp.clientId) return '';
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: sp.refreshToken,
      client_id: sp.clientId,
    });
    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const data = await res.json();
    if (!res.ok) {
      Object.assign(sp, { accessToken: '', refreshToken: '', expiresAt: 0, grantedScope: '' });
      this.saveState();
      return '';
    }
    this._commitSpotifyToken(sp, data);
    this.saveState();
    return sp.accessToken;
  }

  async _ensureSpotifyDevice(_token) {
    // Reuse a live device; if the SDK went not_ready, tear down so we don't
    // stack a second Player without disconnecting the old one.
    if (this._sp && this._spDeviceId) return;
    if (this._sp) {
      try { this._sp.disconnect(); } catch { /* noop */ }
      this._sp = null;
      this._spDeviceId = '';
    }
    await loadScript('https://sdk.scdn.co/spotify-player.js', () => window.Spotify?.Player);
    await spotifySdkReady();
    await new Promise((resolve, reject) => {
      this._sp = new window.Spotify.Player({
        name: 'Showtime Composer',
        // Always pull a fresh (possibly refreshed) token — closing over the
        // token from first connect leaves the SDK auth-dead after ~1h.
        getOAuthToken: cb => {
          this._spotifyToken()
            .then(t => cb(t || ''))
            .catch(() => cb(''));
        },
        volume: clamp01(this.state.volume),
      });
      this._sp.addListener('ready', ({ device_id }) => {
        this._spDeviceId = device_id;
        resolve();
      });
      this._sp.addListener('not_ready', () => {
        this._spDeviceId = '';
      });
      this._sp.addListener('player_state_changed', state => {
        if (!state) return;
        const prev = this._spLastState;
        const position = state.position || 0;
        this._spLastState = {
          paused: !!state.paused,
          position,
          duration: state.duration || 0,
        };
        this._spPlaying = !state.paused;
        this._lastT = position / 1000;
        this._lastD = (state.duration || 0) / 1000;
        // Auto-advance: was playing, now paused at 0 after having progressed.
        if (
          this._engine === 'spotify'
          && state.paused
          && position === 0
          && prev
          && !prev.paused
          && prev.position > 1000
        ) {
          this._playNext();
          return;
        }
        this._paintPlayer();
      });
      this._sp.addListener('authentication_error', ({ message }) => reject(new Error(message)));
      this._sp.addListener('account_error', () => reject(new Error('Spotify Premium is required for playback.')));
      this._sp.connect().then(ok => { if (!ok) reject(new Error('Spotify player could not connect.')); });
    });
  }

  _openShelfEditor(existing = null) {
    const row = existing ?? { title: '', badge: '', sourceUrl: '', scriptUid: '', artist: '', trackIds: [] };
    const backdrop = this._modal(`
      <div class="cmp-modal-title">${existing ? 'REFIT' : 'FILE'} ALBUM</div>
      <div class="cmp-modal-sub">— badge · title · Script scope —</div>
      <div class="cmp-field"><label>Title</label>
        <input type="text" data-field="title" value="${esc(row.title)}"></div>
      <div class="cmp-field"><label>Artist / uploader</label>
        <input type="text" data-field="artist" value="${esc(row.artist)}" placeholder="Defaults to uploader on import"></div>
      <div class="cmp-field"><label>Badge image</label>
        <input type="text" data-field="badge" value="${esc(row.badge)}" placeholder="Image URL">
        <input type="file" accept="image/*" data-action="badge-file"></div>
      <div class="cmp-field"><label>Script scope</label>
        <select data-field="scriptUid">${this._scriptScopeOptions(row.scriptUid)}</select>
        <div class="cmp-hint">Uses the Script tab’s show/book codes (S01E017 or B.1-Ch.17). Assign a folder, book, or chapter.</div></div>
      <div class="cmp-modal-actions">
        ${existing ? `<button type="button" class="cmp-btn" data-action="remove" style="margin-right:auto">Remove</button>` : ''}
        <button type="button" class="cmp-btn" data-action="cancel">Cancel</button>
        <button type="button" class="cmp-btn gold" data-action="save">Save</button>
      </div>
    `);
    backdrop.querySelector('[data-action="badge-file"]')?.addEventListener('change', e => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        row.badge = String(reader.result || '');
        const url = backdrop.querySelector('[data-field="badge"]');
        if (url) url.value = row.badge;
      };
      reader.readAsDataURL(file);
    });
    backdrop.querySelector('[data-action="cancel"]').addEventListener('click', () => backdrop.remove());
    backdrop.addEventListener('click', e => { if (e.target === backdrop) backdrop.remove(); });
    backdrop.querySelector('[data-action="remove"]')?.addEventListener('click', () => {
      if (!confirm('File away this album? Tracks become Singles.')) return;
      const albumId = existing.id;
      // Unlink tracks so they reappear under Singles instead of vanishing.
      for (const t of this._tracks()) {
        if (t.albumId === albumId) t.albumId = '';
      }
      this.state.albums = this._albums().filter(a => a.id !== albumId);
      if (this._focus.id === albumId) this._focus = { kind: 'singles', id: null };
      this.saveState();
      backdrop.remove();
      this.render(this.container);
    });
    backdrop.querySelector('[data-action="save"]').addEventListener('click', () => {
      const title = backdrop.querySelector('[data-field="title"]').value.trim();
      if (!title) { alert('Title is required.'); return; }
      const badge = backdrop.querySelector('[data-field="badge"]').value.trim();
      const scriptUid = backdrop.querySelector('[data-field="scriptUid"]').value;
      const artist = backdrop.querySelector('[data-field="artist"]')?.value.trim() || '';
      if (existing) Object.assign(existing, { title, badge, scriptUid, artist });
      else {
        const fresh = { id: uid(), title, badge, scriptUid, artist, sourceUrl: '', trackIds: [] };
        this.state.albums.push(fresh);
        this._shelfIndex = this.state.albums.length - 1;
        this._focus = { kind: 'album', id: fresh.id };
      }
      this.saveState();
      backdrop.remove();
      this.render(this.container);
    });
  }

  _openImport() {
    const backdrop = this._modal(`
      <div class="cmp-modal-title">IMPORT ALBUM</div>
      <div class="cmp-modal-sub">— read a link, do not commit yet —</div>
      <div class="cmp-field"><label>Playlist / album / set URL</label>
        <input type="url" data-field="url" placeholder="YouTube playlist, SoundCloud set, or Spotify playlist/album"></div>
      <div class="cmp-hint">Tracks are drafted with the uploader as artist. They will not play until you fill name + duration and press Commit. Spotify lists need Premium connect, and only playlists you own or collaborate on can be read.</div>
      <div class="cmp-modal-actions">
        <button type="button" class="cmp-btn" data-action="cancel">Cancel</button>
        <button type="button" class="cmp-btn gold" data-action="read">Read link</button>
      </div>
    `);
    backdrop.querySelector('[data-action="cancel"]').addEventListener('click', () => backdrop.remove());
    backdrop.addEventListener('click', e => { if (e.target === backdrop) backdrop.remove(); });
    backdrop.querySelector('[data-action="read"]').addEventListener('click', async () => {
      const url = backdrop.querySelector('[data-field="url"]').value.trim();
      if (!url) { alert('Paste a link.'); return; }
      const btn = backdrop.querySelector('[data-action="read"]');
      btn.disabled = true;
      btn.textContent = '...';
      try {
        await this._importCollection(url);
        backdrop.remove();
        this.render(this.container);
      } catch (err) {
        alert(err.message || String(err));
        btn.disabled = false;
        btn.textContent = 'Read link';
      }
    });
  }

  async _importCollection(url) {
    const pack = await this._readRemoteCollection(url);
    if (!pack?.tracks?.length && !pack?.title) throw new Error('Could not read that link.');
    const shelf = {
      id: uid(),
      title: pack.title || 'Imported album',
      badge: pack.badge || '',
      artist: pack.uploader || '',
      sourceUrl: url,
      scriptUid: '',
      trackIds: [],
    };
    for (const item of pack.tracks || []) {
      const row = {
        id: uid(),
        url: item.url,
        title: item.title || '',
        artist: item.artist || pack.uploader || '',
        uploader: pack.uploader || item.artist || '',
        durationMs: item.durationMs || 0,
        notes: '',
        albumId: shelf.id,
        backupUrl: item.backupUrl || '',
        committed: !!(item.title && item.durationMs),
        source: detectSource(item.url).kind,
        keywordFacets: emptyFacets(FACETS),
        keywords: [],
      };
      this.state.library.push(row);
      shelf.trackIds.push(row.id);
    }
    this.state.albums.push(shelf);
    this._shelfIndex = this.state.albums.length - 1;
    this._focus = { kind: 'album', id: shelf.id };
    this.saveState();
  }

  async _hydrateFocusedAlbum() {
    if (this._focus.kind !== 'album') return;
    const album = this._album(this._focus.id);
    if (!album) return;
    if (!Array.isArray(album.trackIds)) album.trackIds = [];
    if (album.trackIds.length || !album.sourceUrl) return;
    try {
      const pack = await this._readRemoteCollection(album.sourceUrl);
      if (!pack?.tracks?.length) return;
      for (const item of pack.tracks) {
        const row = {
          id: uid(),
          url: item.url,
          title: item.title || '',
          artist: item.artist || pack.uploader || album.artist || '',
          uploader: pack.uploader || item.artist || '',
          durationMs: item.durationMs || 0,
          notes: '',
          albumId: album.id,
          backupUrl: item.backupUrl || '',
          committed: !!(item.title && item.durationMs),
          source: detectSource(item.url).kind,
          keywordFacets: emptyFacets(FACETS),
          keywords: [],
        };
        this.state.library.push(row);
        album.trackIds.push(row.id);
      }
      if (pack.badge && !album.badge) album.badge = pack.badge;
      if (pack.title && (!album.title || album.title === 'Imported album')) album.title = pack.title;
      this.saveState();
    } catch (err) {
      console.warn('[Composer] album hydrate', err);
    }
  }

  async _readRemoteCollection(url) {
    const col = detectCollection(url);
    if (col.kind === 'spotify-playlist' || col.kind === 'spotify-album') {
      const token = await this._spotifyToken();
      if (!token) throw new Error('Connect Spotify Premium first, then import.');
      if (col.kind === 'spotify-album') return this._fetchSpotifyAlbum(col.id, token);
      return this._fetchSpotifyPlaylist(col.id, token);
    }
    if (col.kind === 'youtube-playlist') {
      const rss = await this._fetchYoutubePlaylist(col.id);
      if (rss) return rss;
      const meta = await fetchOEmbed(url);
      return { title: meta?.title || 'YouTube playlist', uploader: meta?.author || '', badge: '', tracks: [] };
    }
    if (col.kind === 'soundcloud-set') {
      throw new Error('SoundCloud sets/playlists can’t be imported track-by-track yet — paste individual track links, or use Spotify / YouTube playlists.');
    }
    const meta = await fetchOEmbed(url);
    return {
      title: meta?.title || hostTitle(url) || 'Imported collection',
      uploader: meta?.author || '',
      badge: '',
      tracks: [],
    };
  }

  async _spotifyGet(url, token) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      let detail = '';
      try {
        const body = await res.json();
        detail = body?.error?.message || body?.error_description || '';
      } catch { /* noop */ }
      const hint = res.status === 403
        ? (this._spotifyHasPlaylistScope()
          ? ' Spotify only returns playlist contents for lists you own or collaborate on (Web API change, February 2026).'
          : ' Open Composer → Spotify → Reconnect and approve playlist access (Spotify must show its permission screen).')
        : '';
      throw new Error(`Spotify request failed (${res.status})${detail ? `: ${detail}` : '.'}${hint}`);
    }
    return res.json();
  }

  // Playlist entries wrap the track under `item` (was `track` before the
  // February 2026 API change); album entries are bare track objects.
  _spotifyTracksFromEntries(entries) {
    const out = [];
    for (const raw of entries || []) {
      const t = raw?.item || raw?.track || raw;
      if (!t || raw?.is_local || t.is_local) continue;
      if (t.type && t.type !== 'track') continue;
      const id = t.id || String(t.uri || '').replace('spotify:track:', '');
      if (!id) continue;
      out.push({
        url: t.external_urls?.spotify || `https://open.spotify.com/track/${id}`,
        title: t.name || '',
        artist: (t.artists || []).map(a => a.name).filter(Boolean).join(', '),
        durationMs: t.duration_ms || 0,
      });
    }
    return out;
  }

  async _spotifyTrackPages(firstUrl, token) {
    const tracks = [];
    let next = firstUrl;
    let guard = 0;
    while (next && guard++ < 60) {
      const page = await this._spotifyGet(next, token);
      tracks.push(...this._spotifyTracksFromEntries(page.items));
      next = page.next;
    }
    return tracks;
  }

  async _fetchSpotifyPlaylist(id, token) {
    let pl = {};
    try {
      pl = await this._spotifyGet(`https://api.spotify.com/v1/playlists/${encodeURIComponent(id)}`, token);
    } catch (err) {
      if (!String(err.message || '').includes('(403)')) throw err;
    }
    // The playlist object carries its first page under `items` (was `tracks`).
    const inline = pl.items || pl.tracks || null;
    let tracks = this._spotifyTracksFromEntries(inline?.items);
    if (!tracks.length || inline?.next) {
      try {
        const paged = await this._spotifyTrackPages(
          `https://api.spotify.com/v1/playlists/${encodeURIComponent(id)}/items?limit=50`,
          token,
        );
        if (paged.length) tracks = paged;
      } catch (err) {
        if (!tracks.length) throw err;
      }
    }
    if (!tracks.length) {
      throw new Error('Spotify did not return this playlist’s contents. Since February 2026 it only hands over tracks for playlists you own or collaborate on — editorial and generated lists (Discover Weekly, Daily Mix, Release Radar) cannot be imported.');
    }
    return {
      title: pl.name || 'Spotify playlist',
      uploader: pl.owner?.display_name || '',
      badge: pl.images?.[0]?.url || '',
      tracks,
    };
  }

  async _fetchSpotifyAlbum(id, token) {
    const al = await this._spotifyGet(`https://api.spotify.com/v1/albums/${id}`, token);
    const uploader = (al.artists || []).map(a => a.name).filter(Boolean).join(', ');
    let tracks = [];
    try {
      tracks = await this._spotifyTrackPages(
        `https://api.spotify.com/v1/albums/${id}/tracks?limit=50`,
        token,
      );
    } catch {
      tracks = this._spotifyTracksFromEntries((al.items || al.tracks)?.items);
    }
    for (const t of tracks) {
      if (!t.artist) t.artist = uploader;
    }
    return { title: al.name || 'Spotify album', uploader, badge: al.images?.[0]?.url || '', tracks };
  }

  async _fetchYoutubePlaylist(listId) {
    try {
      const res = await fetch(`https://www.youtube.com/feeds/videos.xml?playlist_id=${encodeURIComponent(listId)}`);
      if (!res.ok) return null;
      const xml = await res.text();
      const doc = new DOMParser().parseFromString(xml, 'text/xml');
      const title = doc.querySelector('feed > title')?.textContent?.trim() || 'YouTube playlist';
      const author = doc.querySelector('feed > author > name')?.textContent?.trim() || '';
      const tracks = [...doc.querySelectorAll('entry')].map(el => {
        const id = el.querySelector('videoId')?.textContent?.trim()
          || el.getElementsByTagName('yt:videoId')[0]?.textContent?.trim();
        return {
          url: id ? `https://www.youtube.com/watch?v=${id}` : '',
          title: el.querySelector('title')?.textContent?.trim() || '',
          artist: el.querySelector('author > name')?.textContent?.trim() || author,
          durationMs: 0,
        };
      }).filter(t => t.url);
      return { title, uploader: author, badge: '', tracks };
    } catch {
      return null;
    }
  }

  _openEditor(existing = null) {
    const t = existing ?? {
      title: '',
      artist: '',
      url: '',
      durationMs: 0,
      notes: '',
      keywordFacets: emptyFacets(FACETS),
    };
    const facets = normalizeFacets(t.keywordFacets, FACETS);
    const backdrop = this._modal(`
      <div class="cmp-modal-title">${existing ? 'REFIT CUE' : 'CUE SLIP'}</div>
      <div class="cmp-modal-sub">— Title · Artist · embed link —</div>
      <div class="cmp-field"><label>Source link</label>
        <input type="url" data-field="url" value="${esc(t.url)}" placeholder="YouTube, SoundCloud, Spotify, or https://…/track.mp3"></div>
      <div class="cmp-field"><label>Backup link</label>
        <input type="url" data-field="backupUrl" value="${esc(t.backupUrl || '')}" placeholder="YouTube / SoundCloud / file if Spotify will not play">
        <div class="cmp-hint">Used when the source is Spotify without Premium, or the primary embed fails.</div></div>
      <div class="cmp-field-row">
        <div class="cmp-field"><label>Title</label>
          <input type="text" data-field="title" value="${esc(t.title)}"></div>
        <div class="cmp-field"><label>Artist</label>
          <input type="text" data-field="artist" value="${esc(t.artist)}"></div>
      </div>
      <div class="cmp-field"><label>Duration</label>
        <input type="text" data-field="duration" value="${esc(t.durationMs ? formatDuration(t.durationMs) : '')}" placeholder="m:ss — filled from the embed when possible">
        <div class="cmp-hint">No download. YouTube/SoundCloud play in an embed. Spotify needs the Premium connect button.</div></div>
      <div class="cmp-field cmp-tags">
        <label>Tags <span class="cmp-hint">hidden on the shelf — Enabling gates the queue, Disabling blocks a scene, Activating ranks matches</span></label>
        <div class="cmp-kw" data-role="kw">${this._tagEditorHTML(facets, this._normalizeTagRoles(t))}</div>
      </div>
      <div class="cmp-field"><label>Notes (optional)</label>
        <textarea data-field="notes">${esc(t.notes ?? '')}</textarea></div>
      <div class="cmp-modal-actions">
        <button type="button" class="cmp-btn" data-action="cancel">Cancel</button>
        <button type="button" class="cmp-btn gold" data-action="save">${existing ? 'Save' : 'File'}</button>
      </div>
    `);

    const urlInp = backdrop.querySelector('[data-field="url"]');
    const titleInp = backdrop.querySelector('[data-field="title"]');
    const artistInp = backdrop.querySelector('[data-field="artist"]');
    const durInp = backdrop.querySelector('[data-field="duration"]');

    const probe = () => this._probeUrl(urlInp.value.trim(), {
      title: titleInp,
      artist: artistInp,
      duration: durInp,
    });
    urlInp.addEventListener('change', probe);
    urlInp.addEventListener('blur', probe);

    backdrop.querySelector('[data-action="add-kw"]').addEventListener('click', () => {
      this._openKeywordAdd(backdrop.querySelector('[data-role="kw"]'));
    });
    backdrop.querySelector('[data-role="kw"]').addEventListener('click', e => {
      const x = e.target.closest('.cmp-pill-x');
      if (!x) return;
      x.closest('.cmp-pill-edit')?.remove();
    });

    backdrop.querySelector('[data-action="cancel"]').addEventListener('click', () => backdrop.remove());
    backdrop.addEventListener('click', e => { if (e.target === backdrop) backdrop.remove(); });
    backdrop.querySelector('[data-action="save"]').addEventListener('click', () => {
      const url = urlInp.value.trim();
      const backupUrl = backdrop.querySelector('[data-field="backupUrl"]')?.value.trim() || '';
      const title = titleInp.value.trim() || hostTitle(url) || 'Untitled cue';
      if (!url) { alert('A source link is required.'); return; }
      const keywordFacets = this._readFacets(backdrop);
      const durationMs = parseDuration(durInp.value) || (existing?.durationMs ?? 0);
      const source = detectSource(url).kind;
      const artist = artistInp.value.trim();
      const committed = !!(title && durationMs);
      const albumId = existing?.albumId || (this._focus.kind === 'album' ? this._focus.id : '');
      if (existing) {
        Object.assign(existing, {
          url, backupUrl, title, source, artist, durationMs, committed, albumId,
          notes: backdrop.querySelector('[data-field="notes"]').value.trim(),
          keywordFacets,
          tagRoles: this._readTagRoles(backdrop),
          keywords: flattenFacets(keywordFacets, FACETS),
        });
      } else {
        const row = {
          id: uid(),
          url, backupUrl, title, source, artist, durationMs, committed, albumId,
          uploader: artist,
          notes: backdrop.querySelector('[data-field="notes"]').value.trim(),
          keywordFacets,
          tagRoles: this._readTagRoles(backdrop),
          keywords: flattenFacets(keywordFacets, FACETS),
        };
        this.state.library.push(row);
        if (albumId) {
          const album = this._album(albumId);
          if (album && !album.trackIds.includes(row.id)) album.trackIds.push(row.id);
        }
      }
      this.saveState();
      backdrop.remove();
      this.render(this.container);
    });
    setTimeout(() => urlInp.focus(), 0);
  }

  _normalizeTagRoles(t) {
    const facets = normalizeFacets(t?.keywordFacets, FACETS);
    const raw = (t && typeof t.tagRoles === 'object' && t.tagRoles) ? t.tagRoles : {};
    const out = {};
    for (const f of FACETS) {
      out[f.id] = {};
      const src = raw[f.id] && typeof raw[f.id] === 'object' ? raw[f.id] : {};
      for (const v of facets[f.id] || []) {
        const key = String(v).trim();
        if (!key) continue;
        const prev = src[key] || src[key.toLowerCase()];
        out[f.id][key] = TAG_ROLES.some(r => r.id === prev) ? prev : 'activate';
      }
    }
    return out;
  }

  _tagRole(t, facet, value) {
    const roles = this._normalizeTagRoles(t);
    return roles[facet]?.[value] || roles[facet]?.[String(value).toLowerCase()] || 'activate';
  }

  _tagEditorHTML(facets, roles) {
    const groups = TAG_ROLES.map(role => {
      const chips = FACETS.flatMap(f =>
        (facets[f.id] || [])
          .filter(v => (roles[f.id]?.[v] || 'activate') === role.id)
          .map(v => this._tagChipHTML(f.id, v, role.id)),
      ).join('');
      return `
        <div class="cmp-tag-lane" data-role-lane="${role.id}">
          <div class="cmp-tag-lane-h">${esc(role.label)} <span class="cmp-hint">${esc(role.hint)}</span></div>
          <div class="cmp-pills">${chips || '<span class="cmp-hint">None</span>'}</div>
        </div>`;
    }).join('');
    return `${groups}<button type="button" class="cmp-btn small" data-action="add-kw">＋ Add tag</button>`;
  }

  _tagChipHTML(facet, value, role) {
    return `<span class="cmp-pill cmp-pill-edit facet-${esc(facet)} role-${esc(role)}" data-facet="${esc(facet)}" data-value="${esc(value)}" data-role="${esc(role)}">${esc(facetTag(facet, FACETS))} · ${esc(value)} <button type="button" class="cmp-pill-x">×</button></span>`;
  }

  _facetChipsHTML(facets) {
    const chips = FACETS.flatMap(f =>
      (facets[f.id] || []).map(v => this._tagChipHTML(f.id, v, 'activate')),
    ).join('');
    return chips || '<span class="cmp-hint">None yet.</span>';
  }

  _readFacets(root) {
    const facets = emptyFacets(FACETS);
    root.querySelectorAll('.cmp-pill-edit').forEach(p => {
      const id = p.dataset.facet;
      const v = p.dataset.value;
      if (id && v && facets[id] && !facets[id].some(x => x.toLowerCase() === v.toLowerCase())) {
        facets[id].push(v);
      }
    });
    return facets;
  }

  _readTagRoles(root) {
    const roles = {};
    for (const f of FACETS) roles[f.id] = {};
    root.querySelectorAll('.cmp-pill-edit').forEach(p => {
      const id = p.dataset.facet;
      const v = p.dataset.value;
      const role = TAG_ROLES.some(r => r.id === p.dataset.role) ? p.dataset.role : 'activate';
      if (id && v && roles[id]) roles[id][v] = role;
    });
    return roles;
  }

  _moodPaletteHTML() {
    const { keys, custom } = this._knownMoods();
    const builtin = new Set(MOOD_KEYS.map(k => k.toLowerCase()));
    const pills = keys.map(k => {
      const yours = !builtin.has(k.toLowerCase());
      return `<button type="button" class="cmp-pill facet-mood${yours ? ' is-custom' : ''}" data-mood="${esc(k)}">${esc(k)}</button>`;
    }).join('');
    return `<div class="cmp-mood-palette" data-role="mood-palette" hidden>
      ${pills}
      ${custom.length ? '<span class="cmp-mood-custom-hint">Yours save for reuse</span>' : ''}
    </div>`;
  }

  _knownMoods() {
    const extra = [];
    for (const v of this.state.customMoods || []) extra.push(v);
    for (const t of this._tracks()) {
      for (const v of t.keywordFacets?.mood || []) extra.push(v);
    }
    for (const v of this.state.sceneFacets?.mood || []) extra.push(v);
    return collectMoodPalette(extra);
  }

  _rememberCustomMoods(values = []) {
    const next = collectMoodPalette([...(this.state.customMoods || []), ...values]).custom;
    const prev = Array.isArray(this.state.customMoods) ? this.state.customMoods : [];
    if (next.length === prev.length
      && next.every((v, i) => v.toLowerCase() === String(prev[i] || '').toLowerCase())) {
      return;
    }
    this.state.customMoods = next;
    this.saveState();
  }

  _locationPickerHTML() {
    return `<div data-role="loc-picker" hidden>
      ${locationTagEditorHTML({
        selected: [],
        fieldRole: 'cmp-loctags',
        emptyHint: 'Country → city → area → building. Pick one or nest a new tag.',
      })}
    </div>`;
  }

  _characterChoices() {
    const out = [];
    const seen = new Set();
    const push = (name, group) => {
      const n = String(name || '').trim();
      if (!n) return;
      const k = n.toLowerCase();
      if (seen.has(k)) return;
      seen.add(k);
      out.push({ name: n, group });
    };
    try {
      for (const m of getCastMembers(this.storage).filter(c => c.priority !== 'director')) {
        push(m.name, 'Cast');
      }
    } catch { /* ignore */ }
    try {
      const rep = this.storage.getChat('reputation', {});
      for (const n of rep.personal || []) {
        if (n.kind === 'self' || n.category === 'rumor' || n.category === 'group') continue;
        push(n.name, 'Connections');
      }
    } catch { /* ignore */ }
    return out;
  }

  _characterPickerHTML() {
    const choices = this._characterChoices();
    const groups = ['Cast', 'Connections'];
    const opts = groups.map((g) => {
      const members = choices.filter(c => c.group === g);
      if (!members.length) return '';
      return `<optgroup label="${esc(g)}">${members.map(c =>
        `<option value="${esc(c.name)}">${esc(c.name)}</option>`).join('')}</optgroup>`;
    }).join('');
    return `<div class="cmp-char-pick" data-role="char-picker" hidden>
      <select data-field="char-select">
        <option value="">— Choose cast / connection —</option>
        ${opts || '<option value="" disabled>No cast or connections yet</option>'}
      </select>
      <button type="button" class="cmp-btn" data-action="char-add">Add</button>
      <div class="st-loctag-chips" data-role="char-chips"></div>
    </div>`;
  }

  _bindMoodPalette(root) {
    const facet = root.querySelector('[data-field="facet"]');
    const palette = root.querySelector('[data-role="mood-palette"]');
    const locBox = root.querySelector('[data-role="loc-picker"]');
    const charBox = root.querySelector('[data-role="char-picker"]');
    const custom = root.querySelector('[data-field="values"]');
    if (locBox && !locBox.dataset.bound) {
      locBox.dataset.bound = '1';
      bindLocationCatalogPicker(locBox.querySelector('.st-loctag-wrap'), this.storage);
    }
    const addCharChip = (name) => {
      const n = String(name || '').trim();
      if (!n || !charBox) return;
      const chips = charBox.querySelector('[data-role="char-chips"]');
      if (!chips) return;
      const taken = [...chips.querySelectorAll('[data-value]')].map(c => c.dataset.value.toLowerCase());
      if (taken.includes(n.toLowerCase())) return;
      chips.insertAdjacentHTML('beforeend',
        `<span class="st-loctag-chip" data-value="${esc(n)}"><span class="st-loctag-name">${esc(n)}</span><button type="button" class="st-loctag-x" title="Remove">×</button></span>`);
    };
    charBox?.querySelector('[data-field="char-select"]')?.addEventListener('change', (e) => {
      addCharChip(e.target.value);
      e.target.value = '';
    });
    charBox?.querySelector('[data-action="char-add"]')?.addEventListener('click', () => {
      const sel = charBox.querySelector('[data-field="char-select"]');
      addCharChip(sel?.value);
      if (sel) sel.value = '';
    });
    charBox?.addEventListener('click', (e) => {
      const x = e.target.closest('.st-loctag-x');
      if (!x) return;
      x.closest('.st-loctag-chip')?.remove();
    });
    const sync = () => {
      const isMood = facet?.value === 'mood';
      const isLoc = facet?.value === 'location';
      const isChar = facet?.value === 'characters';
      if (palette) palette.hidden = !isMood;
      if (locBox) locBox.hidden = !isLoc;
      if (charBox) charBox.hidden = !isChar;
      if (custom) {
        custom.hidden = isLoc || isChar;
        custom.style.display = (isLoc || isChar) ? 'none' : '';
        custom.placeholder = isMood ? 'or type a custom mood' : 'harbor, lantern, night market';
      }
    };
    facet?.addEventListener('change', sync);
    palette?.querySelectorAll('[data-mood]').forEach(btn => {
      btn.addEventListener('click', () => btn.classList.toggle('on'));
    });
    sync();
  }

  _readKeyValues(root) {
    const facet = root.querySelector('[data-field="facet"]')?.value;
    if (facet === 'location') {
      return readLocationTags(root.querySelector('[data-role="loc-picker"]'));
    }
    if (facet === 'characters') {
      const chips = [...(root.querySelectorAll('[data-role="char-chips"] [data-value]') || [])]
        .map(c => String(c.dataset.value || '').trim())
        .filter(Boolean);
      const out = [];
      const seen = new Set();
      for (const v of chips) {
        const key = v.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(v);
      }
      return out;
    }
    const typed = (root.querySelector('[data-field="values"]')?.value || '')
      .split(',').map(s => s.trim()).filter(Boolean);
    const picked = [...(root.querySelectorAll('[data-mood].on') || [])]
      .map(b => b.dataset.mood);
    const merged = facet === 'mood' ? [...picked, ...typed] : typed;
    const out = [];
    const seen = new Set();
    for (const raw of merged) {
      const v = facet === 'mood' ? canonicalizeMood(raw) : String(raw).trim();
      const key = v.toLowerCase();
      if (!v || seen.has(key)) continue;
      seen.add(key);
      out.push(v);
    }
    if (facet === 'mood') this._rememberCustomMoods(out);
    return out;
  }

  _openKeywordAdd(kwRoot) {
    const inner = this._modal(`
      <div class="cmp-modal-title">TAG</div>
      <div class="cmp-modal-sub">— Location · Item · Character · Time · Mood —</div>
      <div class="cmp-field"><label>Type</label>
        <select data-field="facet">${FACETS.map(f =>
          `<option value="${f.id}">${esc(f.tag)}</option>`).join('')}</select></div>
      <div class="cmp-field"><label>Duty</label>
        <select data-field="role">${TAG_ROLES.map(r =>
          `<option value="${r.id}">${esc(r.label)}</option>`).join('')}</select>
        <div class="cmp-hint">Enabling (Location, Character, Time, Mood) gates eligibility. Activating ranks. Disabling vetoes.</div></div>
      <div class="cmp-field"><label>Keys</label>
        ${this._moodPaletteHTML()}
        ${this._locationPickerHTML()}
        ${this._characterPickerHTML()}
        <input type="text" data-field="values" placeholder="rain, midnight, tense">
        <div class="cmp-hint">Location: nest city under country. Character: pick from Cast / Connections. Mood: tap the palette.</div></div>
      <div class="cmp-modal-actions">
        <button type="button" class="cmp-btn" data-action="cancel">Cancel</button>
        <button type="button" class="cmp-btn gold" data-action="ok">Add</button>
      </div>
    `);
    const commit = () => {
      const facet = inner.querySelector('[data-field="facet"]').value;
      const role = inner.querySelector('[data-field="role"]').value;
      const values = this._readKeyValues(inner);
      if (!values.length) return;
      const lane = kwRoot.querySelector(`.cmp-tag-lane[data-role-lane="${role}"] .cmp-pills`)
        || kwRoot.querySelector('.cmp-pills');
      if (!lane) return;
      lane.querySelector('.cmp-hint')?.remove();
      const existing = new Set([...kwRoot.querySelectorAll('.cmp-pill-edit')].map(p =>
        `${p.dataset.facet}\0${String(p.dataset.value || '').toLowerCase()}`,
      ));
      for (const v of values) {
        const key = `${facet}\0${v.toLowerCase()}`;
        if (existing.has(key)) continue;
        existing.add(key);
        lane.insertAdjacentHTML('beforeend', this._tagChipHTML(facet, v, role));
      }
      inner.remove();
    };
    inner.querySelector('[data-action="cancel"]').addEventListener('click', () => inner.remove());
    inner.querySelector('[data-action="ok"]').addEventListener('click', commit);
    inner.addEventListener('click', e => { if (e.target === inner) inner.remove(); });
    this._bindMoodPalette(inner);
    setTimeout(() => inner.querySelector('[data-field="values"]').focus(), 0);
  }

  _bindQueueDrag(root) {
    const list = root.querySelector('.cmp-queue-list');
    if (!list) return;
    let dragId = '';
    list.querySelectorAll('.cmp-card--queue').forEach(card => {
      card.addEventListener('dragstart', e => {
        if (e.target.closest('button')) { e.preventDefault(); return; }
        dragId = card.dataset.id || '';
        card.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', dragId);
      });
      card.addEventListener('dragend', () => card.classList.remove('dragging'));
      card.addEventListener('dragover', e => {
        e.preventDefault();
        const over = e.currentTarget;
        if (!dragId || over.dataset.id === dragId) return;
        const rect = over.getBoundingClientRect();
        const before = e.clientY < rect.top + rect.height / 2;
        over.classList.toggle('drop-before', before);
        over.classList.toggle('drop-after', !before);
      });
      card.addEventListener('dragleave', () => {
        card.classList.remove('drop-before', 'drop-after');
      });
      card.addEventListener('drop', e => {
        e.preventDefault();
        card.classList.remove('drop-before', 'drop-after');
        const from = dragId || e.dataTransfer.getData('text/plain');
        const to = card.dataset.id;
        if (!from || !to || from === to) return;
        const q = this._queueState();
        const ids = q.ids.filter(id => id !== from);
        const at = ids.indexOf(to);
        if (at < 0) return;
        const rect = card.getBoundingClientRect();
        const before = e.clientY < rect.top + rect.height / 2;
        ids.splice(before ? at : at + 1, 0, from);
        q.ids = ids;
        this._shuffleBag = [];
        this.saveState();
        this.render(this.container);
      });
    });
  }

  _chatHaystack() {
    try {
      const chat = getContext().chat ?? [];
      return chat.slice(-8).map(m => String(m?.mes || '')).join('\n').toLowerCase();
    } catch {
      return '';
    }
  }

  _calledFacets() {
    return normalizeFacets(this.state.sceneFacets, FACETS);
  }

  _sceneHasKeys(facets = this._calledFacets()) {
    return FACETS.some(f => (facets[f.id] || []).length);
  }

  _ensureSceneSeed() {
    this.state.sceneFacets = normalizeFacets(this.state.sceneFacets, FACETS);
    if (this._sceneHasKeys()) return;
    const inferred = this._inferSceneFacets();
    if (!this._sceneHasKeys(inferred)) return;
    this.state.sceneFacets = inferred;
    this.saveState();
  }

  _inferSceneFacets() {
    const out = emptyFacets(FACETS);
    const add = (facet, value) => {
      const v = String(value || '').trim();
      if (!v || !out[facet]) return;
      if (out[facet].some(x => x.toLowerCase() === v.toLowerCase())) return;
      out[facet].push(v);
    };
    const hay = this._chatHaystack();
    const db = this._scriptDb();
    for (const card of db.cards || []) {
      if (card.active === false) continue;
      const facets = normalizeFacets(card.keywordFacets, FACETS);
      for (const f of FACETS) {
        for (const v of facets[f.id] || []) {
          if (card.pinned || !hay || hay.includes(v.toLowerCase())) add(f.id, v);
        }
      }
    }
    for (const t of this._tracks()) {
      const facets = normalizeFacets(t.keywordFacets, FACETS);
      for (const f of FACETS) {
        for (const v of facets[f.id] || []) {
          if (hay && hay.includes(v.toLowerCase())) add(f.id, v);
        }
      }
    }
    return out;
  }

  _mergeInferredScene() {
    const cur = this._calledFacets();
    const inferred = this._inferSceneFacets();
    for (const f of FACETS) {
      for (const v of inferred[f.id] || []) {
        if (!cur[f.id].some(x => x.toLowerCase() === v.toLowerCase())) cur[f.id].push(v);
      }
    }
    this.state.sceneFacets = cur;
    this.saveState();
  }

  _saveSceneFromEditor(root) {
    if (!root) return;
    this.state.sceneFacets = this._readFacets(root);
    this.saveState();
  }

  _cycleSceneChip(btn) {
    const pill = btn.closest('.cmp-pill-edit');
    if (!pill) return;
    const ids = FACETS.map(f => f.id);
    const next = ids[(Math.max(0, ids.indexOf(pill.dataset.facet)) + 1) % ids.length];
    pill.dataset.facet = next;
    pill.className = `cmp-pill cmp-pill-edit facet-${next}`;
    pill.title = facetTag(next, FACETS);
    btn.dataset.facet = next;
    btn.textContent = facetTag(next, FACETS);
  }

  _openSceneKeyAdd(kwRoot) {
    if (!kwRoot) return;
    const inner = this._modal(`
      <div class="cmp-modal-title">SCENE KEYS</div>
      <div class="cmp-modal-sub">— same types as Script —</div>
      <div class="cmp-field"><label>Type</label>
        <select data-field="facet">${FACETS.map(f =>
          `<option value="${f.id}">${esc(f.tag)}</option>`).join('')}</select></div>
      <div class="cmp-field"><label>Keywords</label>
        ${this._moodPaletteHTML()}
        ${this._locationPickerHTML()}
        ${this._characterPickerHTML()}
        <input type="text" data-field="values" placeholder="harbor, lantern, night market">
        <div class="cmp-hint">Location: nest city under country. Character: pick from Cast / Connections. Mood: scoring palette.</div></div>
      <div class="cmp-modal-actions">
        <button type="button" class="cmp-btn" data-action="cancel">Cancel</button>
        <button type="button" class="cmp-btn gold" data-action="ok">Add</button>
      </div>
    `);
    const commit = () => {
      const facet = inner.querySelector('[data-field="facet"]').value;
      const values = this._readKeyValues(inner);
      if (!values.length) return;
      const wrap = kwRoot.querySelector('.cmp-pills');
      wrap.querySelector('.cmp-hint')?.remove();
      const existing = new Set([...wrap.querySelectorAll('.cmp-pill-edit')].map(p =>
        `${p.dataset.facet}\0${String(p.dataset.value || '').toLowerCase()}`,
      ));
      for (const v of values) {
        const key = `${facet}\0${v.toLowerCase()}`;
        if (existing.has(key)) continue;
        existing.add(key);
        wrap.insertAdjacentHTML('beforeend', this._sceneChipHTML(facet, v));
      }
      this._saveSceneFromEditor(kwRoot);
      inner.remove();
    };
    inner.querySelector('[data-action="cancel"]').addEventListener('click', () => inner.remove());
    inner.querySelector('[data-action="ok"]').addEventListener('click', commit);
    inner.addEventListener('click', e => { if (e.target === inner) inner.remove(); });
    this._bindMoodPalette(inner);
    setTimeout(() => inner.querySelector('[data-field="values"]').focus(), 0);
  }

  _facetHas(called, facet, value) {
    const needle = String(value || '').toLowerCase();
    return (called[facet] || []).some(v => v.toLowerCase() === needle);
  }

  _trackEligible(t, called) {
    const roles = this._normalizeTagRoles(t);
    const facets = normalizeFacets(t.keywordFacets, FACETS);
    for (const f of FACETS) {
      for (const v of facets[f.id] || []) {
        if (roles[f.id]?.[v] === 'disable' && this._facetHas(called, f.id, v)) return false;
      }
    }
    const enablingFacets = new Set();
    for (const f of FACETS) {
      if ((facets[f.id] || []).some(v => (roles[f.id]?.[v] || 'activate') === 'enable')) {
        enablingFacets.add(f.id);
      }
    }
    const order = [...ENABLE_FACET_ORDER.filter(id => enablingFacets.has(id)), ...[...enablingFacets].filter(id => !ENABLE_FACET_ORDER.includes(id))];
    for (const facet of order) {
      const calledVals = called[facet] || [];
      if (!calledVals.length) continue;
      const ok = (facets[facet] || []).some(v =>
        (roles[facet]?.[v] || 'activate') === 'enable' && this._facetHas(called, facet, v),
      );
      if (!ok) return false;
    }
    return true;
  }

  _trackActivateScore(t, called) {
    const roles = this._normalizeTagRoles(t);
    const facets = normalizeFacets(t.keywordFacets, FACETS);
    let activate = 0;
    let enable = 0;
    for (const f of FACETS) {
      for (const v of facets[f.id] || []) {
        if (!this._facetHas(called, f.id, v)) continue;
        const role = roles[f.id]?.[v] || 'activate';
        if (role === 'activate') activate += 1;
        if (role === 'enable') enable += 1;
      }
    }
    return activate * 10 + enable;
  }

  _sortQueueAgentic() {
    const called = this._calledFacets();
    const pool = this._tracks().filter(t => this._committed(t) && this._cueSource(t).playable);
    const eligible = pool.filter(t => this._trackEligible(t, called));
    eligible.sort((a, b) => {
      const ds = this._trackActivateScore(b, called) - this._trackActivateScore(a, called);
      if (ds) return ds;
      return String(a.title || '').localeCompare(String(b.title || ''));
    });
    if (!eligible.length) {
      this._hint('No cues passed Enabling / Disabling against the current scene.');
      return;
    }
    const hit = this._historyMatchForEligible(eligible);
    if (hit && hit.score >= Math.max(2, Math.ceil(eligible.length * 0.5))) {
      const order = hit.ids.map(id => this._track(id)).filter(Boolean);
      const rest = eligible.filter(t => !hit.ids.includes(t.id));
      this._replaceQueue([...order, ...rest], { remember: false });
      this._hint(`Reused ${hit.h.locked ? 'locked ' : ''}queue “${hit.h.label}”.`);
    } else {
      this._replaceQueue(eligible);
    }
    this._shuffleBag = [];
    this._page = 'queue';
    this.saveState();
    this.render(this.container);
  }

  async _suggestSpotifyFromTags() {
    const token = await this._spotifyToken();
    if (!token) {
      alert('Connect Spotify Premium first.');
      return;
    }
    const called = this._calledFacets();
    const bits = ENABLE_FACET_ORDER.flatMap(id => called[id] || []).concat(called.objects || []);
    const q = bits.join(' ').trim() || 'instrumental';
    try {
      const data = await this._spotifyGet(
        `https://api.spotify.com/v1/search?type=track&limit=8&q=${encodeURIComponent(q)}`,
        token,
      );
      const hit = (data.tracks?.items || []).find(t => t?.id && t.name);
      if (!hit) {
        this._hint(`Spotify found nothing for “${q}”.`);
        return;
      }
      const artists = (hit.artists || []).map(a => a.name).filter(Boolean).join(', ');
      const url = hit.external_urls?.spotify || `https://open.spotify.com/track/${hit.id}`;
      const existing = this._tracks().find(t => t.url === url);
      let row = existing;
      if (!row) {
        const facets = emptyFacets(FACETS);
        for (const f of FACETS) {
          for (const v of called[f.id] || []) facets[f.id].push(v);
        }
        row = {
          id: uid(),
          url,
          backupUrl: '',
          title: hit.name || 'Suggested track',
          artist: artists,
          uploader: artists,
          durationMs: hit.duration_ms || 0,
          notes: `Suggested from scene: ${q}`,
          albumId: '',
          committed: !!(hit.name && hit.duration_ms),
          source: 'spotify',
          keywordFacets: facets,
          tagRoles: {},
          keywords: flattenFacets(facets, FACETS),
        };
        row.tagRoles = this._normalizeTagRoles({ ...row, tagRoles: Object.fromEntries(FACETS.map(f => [f.id, Object.fromEntries((facets[f.id] || []).map(v => [v, 'activate']))])) });
        this.state.library.push(row);
      }
      this._offerQueue(row.id);
      this._page = 'queue';
      this.saveState();
      this.render(this.container);
      this._hint(`Suggested “${row.title}” from Spotify.`);
    } catch (err) {
      alert(err.message || String(err));
    }
  }

  _openAlbumPicker(trackId) {
    const t = this._track(trackId);
    if (!t) return;
    const albums = this._albums();
    const backdrop = this._modal(`
      <div class="cmp-modal-title">FILE TO ALBUM</div>
      <div class="cmp-modal-sub">— ${esc(t.title || 'Untitled cue')} —</div>
      <div class="cmp-field"><label>Album</label>
        <select data-field="album">
          <option value="">— Singles / unattributed —</option>
          ${albums.map(a => `<option value="${esc(a.id)}" ${a.id === t.albumId ? 'selected' : ''}>${esc(a.title || 'Untitled')}</option>`).join('')}
        </select></div>
      <div class="cmp-modal-actions">
        <button type="button" class="cmp-btn" data-action="cancel">Cancel</button>
        <button type="button" class="cmp-btn gold" data-action="save">Save</button>
      </div>
    `);
    backdrop.querySelector('[data-action="cancel"]').addEventListener('click', () => backdrop.remove());
    backdrop.addEventListener('click', e => { if (e.target === backdrop) backdrop.remove(); });
    backdrop.querySelector('[data-action="save"]').addEventListener('click', () => {
      const albumId = backdrop.querySelector('[data-field="album"]').value;
      for (const a of this._albums()) a.trackIds = (a.trackIds ?? []).filter(id => id !== t.id);
      t.albumId = albumId;
      if (albumId) {
        const album = this._album(albumId);
        if (album && !album.trackIds.includes(t.id)) album.trackIds.push(t.id);
      }
      this.saveState();
      backdrop.remove();
      this.render(this.container);
    });
  }

  async _probeUrl(url, fields) {
    if (!url) return;
    const src = detectSource(url);
    if (src.kind === 'file') {
      try {
        const probe = new Audio();
        probe.preload = 'metadata';
        await new Promise((resolve, reject) => {
          const to = setTimeout(() => reject(new Error('timeout')), 8000);
          probe.addEventListener('loadedmetadata', () => { clearTimeout(to); resolve(); }, { once: true });
          probe.addEventListener('error', () => { clearTimeout(to); reject(new Error('probe failed')); }, { once: true });
          probe.src = url;
        });
        if (Number.isFinite(probe.duration) && probe.duration > 0 && fields.duration && !fields.duration.value.trim()) {
          fields.duration.value = formatDuration(probe.duration * 1000);
        }
        if (fields.title && !fields.title.value.trim()) fields.title.value = hostTitle(url);
      } catch { /* leave fields */ }
      return;
    }
    const meta = await fetchOEmbed(url);
    if (!meta) return;
    if (fields.title && !fields.title.value.trim() && meta.title) fields.title.value = meta.title;
    if (fields.artist && !fields.artist.value.trim() && meta.author) fields.artist.value = meta.author;
  }

  _modal(inner) {
    const backdrop = document.createElement('div');
    backdrop.className = 'cmp-modal-backdrop';
    backdrop.innerHTML = `<div class="cmp-modal">${inner}</div>`;
    document.body.appendChild(backdrop);
    return backdrop;
  }
}

const SOURCE_BADGE = {
  youtube: 'YouTube',
  soundcloud: 'SoundCloud',
  spotify: 'Spotify',
  file: 'File',
};

function detectCollection(url) {
  try {
    const u = new URL(url, window.location.href);
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    if (host.includes('youtube') || host === 'youtu.be') {
      const list = u.searchParams.get('list');
      if (list) return { kind: 'youtube-playlist', id: list };
    }
    if (host === 'open.spotify.com' || host === 'play.spotify.com') {
      const parts = u.pathname.split('/').filter(Boolean).map(p => p.split('?')[0]);
      const kindAt = (name) => {
        const i = parts.indexOf(name);
        return i >= 0 && parts[i + 1] ? parts[i + 1] : '';
      };
      const playlistId = kindAt('playlist');
      if (playlistId) return { kind: 'spotify-playlist', id: playlistId };
      const albumId = kindAt('album');
      if (albumId) return { kind: 'spotify-album', id: albumId };
    }
    if (host.includes('soundcloud')) return { kind: 'soundcloud-set', id: url };
  } catch { /* noop */ }
  return { kind: 'unknown', id: '' };
}

function shuffleIds(ids) {
  const a = [...ids];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function detectSource(url) {
  const raw = String(url || '').trim();
  if (!raw) return { kind: 'unknown', playable: false };
  try {
    const u = new URL(raw, window.location.href);
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    if (host === 'youtu.be') {
      const id = u.pathname.split('/').filter(Boolean)[0];
      return { kind: 'youtube', playable: !!id, id };
    }
    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
      const parts = u.pathname.split('/').filter(Boolean);
      let id = u.searchParams.get('v');
      if (!id && (parts[0] === 'shorts' || parts[0] === 'embed' || parts[0] === 'live')) id = parts[1];
      const ok = id && id !== 'watch' && id !== 'playlist';
      return { kind: 'youtube', playable: !!ok, id: ok ? id : '' };
    }
    if (host === 'soundcloud.com' || host === 'on.soundcloud.com') {
      return { kind: 'soundcloud', playable: true, id: raw };
    }
    if (host === 'open.spotify.com' || host === 'play.spotify.com') {
      const parts = u.pathname.split('/').filter(Boolean);
      const idx = parts.indexOf('track');
      const id = idx >= 0 ? parts[idx + 1]?.split('?')[0] : '';
      return { kind: 'spotify', playable: !!id, id };
    }
    if (raw.startsWith('spotify:track:')) {
      return { kind: 'spotify', playable: true, id: raw.slice('spotify:track:'.length) };
    }
    if (isDirectAudioUrl(raw)) return { kind: 'file', playable: true, id: raw };
  } catch { /* noop */ }
  return { kind: 'unknown', playable: false };
}

async function fetchOEmbed(url) {
  const tries = [
    `https://noembed.com/embed?url=${encodeURIComponent(url)}`,
    `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`,
    `https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(url)}`,
    `https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`,
  ];
  for (const endpoint of tries) {
    try {
      const res = await fetch(endpoint);
      if (!res.ok) continue;
      const data = await res.json();
      const title = String(data.title || '').replace(/ - YouTube$/, '').trim();
      const author = String(data.author_name || data.author || '').trim();
      if (title || author) return { title, author };
    } catch { /* CORS */ }
  }
  return null;
}

const scriptLoads = new Map();

function loadScript(src, ready) {
  if (ready()) return Promise.resolve();
  // Repeat calls share one promise, so a second click can't wait for a
  // 'load' event that already fired.
  if (scriptLoads.has(src)) return scriptLoads.get(src);
  const p = new Promise((resolve, reject) => {
    const existing = [...document.scripts].find(s => s.src === src);
    if (existing) {
      // Tag added outside this loader: it may have loaded already, so poll too.
      existing.addEventListener('load', () => resolve(), { once: true });
      const started = Date.now();
      const tick = () => {
        if (ready()) return resolve();
        if (Date.now() - started > 15000) return reject(new Error(`Timed out waiting for ${src}`));
        setTimeout(tick, 100);
      };
      tick();
      return;
    }
    const el = document.createElement('script');
    el.src = src;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(el);
  });
  scriptLoads.set(src, p);
  p.catch(() => scriptLoads.delete(src));
  return p;
}

function youtubeApiReady() {
  if (window.YT?.Player) return Promise.resolve();
  return new Promise(resolve => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve();
    };
  });
}

function spotifySdkReady() {
  if (window.Spotify?.Player) return Promise.resolve();
  return new Promise(resolve => {
    const prev = window.onSpotifyWebPlaybackSDKReady;
    window.onSpotifyWebPlaybackSDKReady = () => {
      prev?.();
      resolve();
    };
  });
}

function spotifyRedirectUri() {
  // Resolve from this file's real location: ST names the install folder after
  // the repo (e.g. SillyTavern-Showtime), so a hard-coded "Showtime" path 404s.
  return new URL('../../spotify-callback.html', import.meta.url).href;
}

function randomString(len) {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return [...bytes].map(b => ('0' + b.toString(16)).slice(-2)).join('').slice(0, len);
}

async function sha256Base64Url(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  const bytes = new Uint8Array(buf);
  let bin = '';
  bytes.forEach(b => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function uid() {
  return crypto?.randomUUID?.() ?? ('m_' + Math.random().toString(36).slice(2, 10));
}

function clamp01(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0.8;
  return Math.max(0, Math.min(1, v));
}

function formatDuration(ms) {
  const total = Math.max(0, Math.round(Number(ms) / 1000) || 0);
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    return `${h}:${String(m % 60).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

function parseDuration(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return 0;
  const parts = raw.split(':').map(n => Number(n));
  if (parts.some(n => !Number.isFinite(n))) return 0;
  if (parts.length === 1) return Math.round(parts[0] * 1000);
  if (parts.length === 2) return Math.round((parts[0] * 60 + parts[1]) * 1000);
  if (parts.length === 3) return Math.round((parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000);
  return 0;
}

function isDirectAudioUrl(url) {
  try {
    const u = new URL(url, window.location.href);
    if (!/^https?:$/i.test(u.protocol) && !/^blob:$/i.test(u.protocol)) return false;
    if (/\.(mp3|ogg|oga|wav|m4a|aac|flac|opus|webm)(\?|#|$)/i.test(u.pathname)) return true;
    if (/^blob:|^data:audio\//i.test(url)) return true;
    return false;
  } catch {
    return false;
  }
}

function hostTitle(url) {
  try {
    const u = new URL(url);
    const leaf = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '');
    return leaf.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ') || u.hostname;
  } catch {
    return '';
  }
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, ch =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}
