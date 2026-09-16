// Production Reels — portable Showtime bundles (modules + optional portraits,
// character-card PNGs, assignment links, lorebooks).

import { getContext } from '../../../../extensions.js';
import { getRequestHeaders } from '../../../../../script.js';
import {
  loadWorldInfo,
  saveWorldInfo,
  selected_world_info,
  world_names,
  METADATA_KEY,
} from '../../../../world-info.js';
import { getCastMembers } from './castCatalog.js';

export const REEL_KIND = 'showtime-reel';

function dataUrlFromBlob(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = () => reject(r.error || new Error('read failed'));
    r.readAsDataURL(blob);
  });
}

async function fetchAsDataUrl(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`fetch ${res.status}`);
  const blob = await res.blob();
  return dataUrlFromBlob(blob);
}

function fileFromDataUrl(dataUrl, filename) {
  const m = String(dataUrl || '').match(/^data:([^;]+);base64,(.+)$/);
  if (!m) return null;
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], filename, { type: m[1] || 'image/png' });
}

/** Lorebooks currently bound to this chat / character / persona / global WI. */
export function listPlayLorebooks(storage) {
  const ctx = getContext();
  const names = new Set();
  const add = (n) => { const s = String(n || '').trim(); if (s) names.add(s); };
  for (const n of selected_world_info ?? []) add(n);
  add(ctx.chatMetadata?.[METADATA_KEY]);
  const chid = ctx.characterId ?? ctx.this_chid;
  const char = chid != null ? (ctx.characters ?? [])[chid] : null;
  add(char?.data?.extensions?.world);
  try {
    const lib = storage.getChat('library', {});
    for (const n of lib.adopted || []) add(n);
    for (const n of Object.keys(lib.bookFiling || {})) add(n);
  } catch { /* ignore */ }
  return [...names];
}

export async function collectReelExtras(storage, {
  portraits = false,
  characterCards = false,
  relink = false,
  lorebooks = false,
  allLorebooks = false,
} = {}) {
  const extras = { portraits: {}, cards: {}, links: {}, lorebooks: {} };
  const cast = getCastMembers(storage);

  if (portraits || characterCards || relink) {
    for (const member of cast) {
      extras.links[member.id] = {
        name: member.name,
        characterCardId: member.characterCardId || '',
        personaId: member.personaId || '',
      };
      if (portraits && member.portrait) {
        try {
          extras.portraits[member.id] = {
            name: member.name,
            dataUrl: member.portrait.startsWith('data:')
              ? member.portrait
              : await fetchAsDataUrl(member.portrait),
          };
        } catch (err) {
          console.warn('[Showtime/Reel] portrait skip', member.name, err);
        }
      }
      if (characterCards && member.characterCardId) {
        try {
          const response = await fetch('/api/characters/export', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ format: 'png', avatar_url: member.characterCardId }),
          });
          if (response.ok) {
            const blob = await response.blob();
            extras.cards[member.id] = {
              name: member.name,
              filename: String(member.characterCardId).replace(/\.png$/i, '') + '.png',
              dataUrl: await dataUrlFromBlob(blob),
            };
          }
        } catch (err) {
          console.warn('[Showtime/Reel] card export skip', member.name, err);
        }
      }
    }
  }

  if (lorebooks || allLorebooks) {
    const names = allLorebooks
      ? [...new Set([...(world_names || []), ...listPlayLorebooks(storage)])]
      : listPlayLorebooks(storage);
    for (const name of names) {
      try {
        const data = await loadWorldInfo(name);
        if (data) extras.lorebooks[name] = structuredClone(data);
      } catch (err) {
        console.warn('[Showtime/Reel] lorebook skip', name, err);
      }
    }
  }

  const empty = !Object.keys(extras.portraits).length
    && !Object.keys(extras.cards).length
    && !Object.keys(extras.links).length
    && !Object.keys(extras.lorebooks).length;
  return empty ? null : extras;
}

export function decorateReel(payload, extras) {
  return {
    ...payload,
    _showtime: true,
    _reel: true,
    _kind: REEL_KIND,
    extras: extras || null,
  };
}

export function isReelPayload(payload) {
  return !!(payload && (payload._showtime || payload._reel || payload._showtimeBackstage));
}

/**
 * Apply extras after module JSON is already imported.
 * @returns {Promise<string[]>} human-readable notes
 */
export async function importReelExtras(storage, extras = {}, { importCards = true, importLore = true } = {}) {
  const notes = [];
  if (!extras || typeof extras !== 'object') return notes;
  const ctx = getContext();
  const characters = ctx.characters || [];

  if (importLore && extras.lorebooks) {
    let n = 0;
    for (const [name, data] of Object.entries(extras.lorebooks)) {
      if (!name || !data) continue;
      try {
        await saveWorldInfo(name, data, true);
        n++;
      } catch (err) {
        console.warn('[Showtime/Reel] lorebook import', name, err);
      }
    }
    if (n) notes.push(`${n} lorebook${n === 1 ? '' : 's'}`);
  }

  const avatarByName = new Map();
  for (const ch of characters) {
    const n = String(ch?.name || '').trim().toLowerCase();
    if (n && ch.avatar) avatarByName.set(n, ch.avatar);
  }

  if (importCards && extras.cards) {
    for (const [castId, card] of Object.entries(extras.cards)) {
      if (!card?.dataUrl) continue;
      const file = fileFromDataUrl(card.dataUrl, card.filename || `${card.name || 'character'}.png`);
      if (!file) continue;
      try {
        const formData = new FormData();
        formData.append('avatar', file);
        formData.append('file_type', 'png');
        const result = await fetch('/api/characters/import', {
          method: 'POST',
          body: formData,
          headers: getRequestHeaders({ omitContentType: true }),
          cache: 'no-cache',
        });
        if (!result.ok) throw new Error(result.statusText);
        const data = await result.json();
        const avatar = data.file_name ? `${data.file_name}.png` : '';
        if (avatar && extras.links?.[castId]) extras.links[castId].characterCardId = avatar;
        if (avatar) notes.push(`imported card “${card.name || castId}”`);
      } catch (err) {
        console.warn('[Showtime/Reel] card import', card.name, err);
        notes.push(`could not import card “${card.name || castId}” — link it by hand if you already have it`);
      }
    }
  }

  try {
    const castState = storage.getChat('cast', { characters: [] });
    const members = castState.characters || [];
    let linked = 0;
    let faced = 0;
    for (const member of members) {
      const link = extras.links?.[member.id]
        || Object.values(extras.links || {}).find(l =>
          String(l.name || '').toLowerCase() === String(member.name || '').toLowerCase());
      const portrait = extras.portraits?.[member.id]
        || Object.values(extras.portraits || {}).find(p =>
          String(p.name || '').toLowerCase() === String(member.name || '').toLowerCase());
      if (portrait?.dataUrl) {
        member.portrait = portrait.dataUrl;
        faced++;
      }
      if (link) {
        let avatar = link.characterCardId || '';
        if (avatar && !characters.some(c => c.avatar === avatar)) {
          const byName = avatarByName.get(String(link.name || member.name || '').toLowerCase());
          if (byName) avatar = byName;
        } else if (!avatar) {
          avatar = avatarByName.get(String(link.name || member.name || '').toLowerCase()) || '';
        }
        if (avatar) {
          member.characterCardId = avatar;
          member.syncFromCard = member.syncFromCard !== false;
          linked++;
        }
        if (link.personaId) member.personaId = link.personaId;
      }
    }
    if (faced) notes.push(`${faced} portrait${faced === 1 ? '' : 's'}`);
    if (linked) notes.push(`linked ${linked} cast member${linked === 1 ? '' : 's'} to cards`);
    storage.setChat('cast', castState);
  } catch (err) {
    console.warn('[Showtime/Reel] cast extras', err);
  }

  return notes;
}
