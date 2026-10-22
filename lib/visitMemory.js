// Last visit at the current place: credited + located + dated Script cards.
// Calendar order, not the DAG walker. Credit + location tag is the visit.

import { creditedScenes, getScriptDb, sceneCode } from './scriptCatalog.js';
import {
  formatCalendarGap,
  getTimelinePresent,
  parseTimeKey,
  pickParseableTimeKey,
} from './calendarTime.js';
import { findPlaceIdByKey } from './compass/state.js';

function fold(s) {
  return String(s || '').trim().toLowerCase();
}

function tagHits(tag, needle) {
  if (!tag || !needle) return false;
  if (tag === needle) return true;
  if (needle.length >= 4 && (tag.includes(needle) || needle.includes(tag))) return true;
  return false;
}

export function occupancyNeedles(storage, occupancy) {
  const out = new Set();
  const add = (s) => {
    const v = fold(s);
    if (v) out.add(v);
  };
  add(occupancy?.placeKey);
  add(occupancy?.placeId);
  try {
    const st = storage?.getChat?.('backstage', {}) || {};
    const compass = st.stage || {};
    const id = String(occupancy?.placeId || '').trim()
      || findPlaceIdByKey(compass, occupancy?.placeKey);
    const room = id ? compass.rooms?.[id] : null;
    if (room) {
      add(room.name);
      add(room.id);
      for (const a of room.aliases || []) add(a);
      for (const t of room.locationTags || []) add(t);
    }
  } catch { /* ignore */ }
  return [...out];
}

function locationMatches(card, needles) {
  const tags = (card?.keywordFacets?.location || []).map(fold).filter(Boolean);
  if (!tags.length || !needles.length) return false;
  return tags.some(t => needles.some(n => tagHits(t, n)));
}

function presentOf(storage) {
  const db = getScriptDb(storage);
  try {
    const hit = getTimelinePresent(db);
    if (hit && Number.isFinite(Number(hit.sort))) return hit;
  } catch { /* ignore */ }
  let dateLabel = '';
  try {
    const now = storage?.getChat?.('now', {}) || {};
    dateLabel = String(now.clock?.dateLabel || '').trim();
  } catch { /* ignore */ }
  if (!dateLabel) {
    try {
      dateLabel = String(storage?.getChat?.('backstage', {})?.trackers?.scene?.lastDateLabel || '').trim();
    } catch { /* ignore */ }
  }
  if (!dateLabel) return null;
  try {
    return parseTimeKey(dateLabel, db.settings?.calendar, { fillMissing: false });
  } catch {
    return null;
  }
}

/**
 * Latest credited scene at occupancy whose dated stamp is strictly before present.
 */
export function lastVisitAt(storage, { castId, name = '', occupancy, present } = {}) {
  if (!occupancy || occupancy.mode !== 'compass') return null;
  const needles = occupancyNeedles(storage, occupancy);
  if (!needles.length) return null;
  const db = getScriptDb(storage);
  const here = present && Number.isFinite(Number(present.sort)) ? present : presentOf(storage);
  if (!here || !Number.isFinite(Number(here.sort))) return null;
  const cal = db.settings?.calendar;
  let best = null;
  for (const row of creditedScenes(storage, castId, name)) {
    const card = row?.card;
    if (!locationMatches(card, needles)) continue;
    let hit = null;
    try { hit = pickParseableTimeKey(card, cal, { fillMissing: false }); } catch { hit = null; }
    const sort = Number(hit?.parsed?.sort);
    if (!Number.isFinite(sort) || sort >= Number(here.sort)) continue;
    if (!best || sort > best.sort) {
      best = { row, card, sort, scale: hit.parsed?.scale || here.scale };
    }
  }
  if (!best) return null;
  const gap = formatCalendarGap(best.sort, here.sort, cal, { scale: here.scale || best.scale });
  if (!gap || gap === 'earlier today') return null;
  const who = String(name || '').trim() || 'They';
  const code = String(best.row.code || sceneCode(best.card, db) || '').trim();
  const title = String(best.card.title || 'Untitled').trim() || 'Untitled';
  const sceneBit = code ? `${code} · ${title}` : title;
  return {
    name: who,
    gap,
    sort: best.sort,
    uid: best.card.uid,
    line: `${who} last here ${gap} (${sceneBit})`,
  };
}

export function visitLinesForPeople(storage, people, occupancy, { cap = 3, present } = {}) {
  const lines = [];
  const n = Math.max(1, Number(cap) || 3);
  for (const p of people || []) {
    const hit = lastVisitAt(storage, {
      castId: p?.id,
      name: p?.name,
      occupancy,
      present,
    });
    if (hit?.line) lines.push(hit.line);
    if (lines.length >= n) break;
  }
  return lines;
}

export function smokeVisitMemoryPure() {
  try {
    const present = parseTimeKey('2024-06-13', null, { fillMissing: false });
    if (!present?.sort) return 'present key should parse';
    const bags = {
      cast: { characters: [{ id: 'wes', name: 'Weslie', aliases: [] }] },
      script: {
        cards: [
          {
            uid: 'tea',
            kind: 'card',
            title: 'Tea at Okisato',
            credits: [{ characterId: 'wes', name: 'Weslie' }],
            keywordFacets: { location: ['Okisato Antiques'] },
            span: '2024-06-10',
          },
          {
            uid: 'today',
            kind: 'card',
            title: 'Back again',
            credits: [{ characterId: 'wes', name: 'Weslie' }],
            keywordFacets: { location: ['Okisato Antiques'] },
            span: '2024-06-13',
          },
          {
            uid: 'undated',
            kind: 'card',
            title: 'No clock',
            credits: [{ characterId: 'wes', name: 'Weslie' }],
            keywordFacets: { location: ['Okisato Antiques'] },
          },
          {
            uid: 'mall',
            kind: 'card',
            title: 'Mall day',
            credits: [{ characterId: 'wes', name: 'Weslie' }],
            keywordFacets: { location: ['Canal City'] },
            span: '2024-06-01',
          },
          {
            uid: 'rin',
            kind: 'card',
            title: 'Rin waited',
            credits: [{ characterId: 'rin', name: 'Rin' }],
            keywordFacets: { location: ['Okisato Antiques'] },
            span: '2024-06-02',
          },
        ],
        settings: {
          orgScheme: 'show',
          levels: [],
          timelinePresent: {
            sort: present.sort,
            scale: present.scale,
            parts: present.parts,
            key: '2024-06-13',
          },
        },
      },
      now: {
        occupancy: { mode: 'compass', placeKey: 'Okisato Antiques', placeId: 'oki' },
        clock: { dateLabel: '2024-06-13' },
      },
      backstage: {
        stage: {
          rooms: {
            oki: { id: 'oki', name: 'Okisato Antiques', aliases: ['Okisato'] },
          },
        },
        trackers: { scene: {} },
      },
    };
    const storage = {
      getChat(id, d = {}) {
        if (!bags[id]) bags[id] = { ...d };
        return bags[id];
      },
      saveChat() {},
    };
    const occupancy = { mode: 'compass', placeKey: 'Okisato Antiques', placeId: 'oki' };
    const hit = lastVisitAt(storage, { castId: 'wes', name: 'Weslie', occupancy });
    if (!hit || !/Weslie last here/.test(hit.line) || !/Tea at Okisato/.test(hit.line)) {
      return `expected last-here line, got ${hit?.line || 'empty'}`;
    }
    if (!/days ago/.test(hit.gap) && hit.gap !== 'yesterday') return `gap ${hit.gap}`;
    if (hit.uid !== 'tea') return `should pick dated prior visit not today (${hit.uid})`;

    const same = lastVisitAt(storage, {
      castId: 'wes',
      name: 'Weslie',
      occupancy,
      present: parseTimeKey('2024-06-10', null, { fillMissing: false }),
    });
    if (same) return 'same-day visit should skip';

    bags.script.cards = bags.script.cards.filter(c => c.uid !== 'tea' && c.uid !== 'today');
    const undated = lastVisitAt(storage, { castId: 'wes', name: 'Weslie', occupancy });
    if (undated) return 'undated should skip';

    bags.script.cards = [{
      uid: 'mall',
      kind: 'card',
      title: 'Mall day',
      credits: [{ characterId: 'wes', name: 'Weslie' }],
      keywordFacets: { location: ['Canal City'] },
      span: '2024-06-01',
    }];
    const mismatch = lastVisitAt(storage, { castId: 'wes', name: 'Weslie', occupancy });
    if (mismatch) return 'location mismatch should skip';

    bags.script.cards = [{
      uid: 'rin',
      kind: 'card',
      title: 'Rin waited',
      credits: [{ characterId: 'rin', name: 'Rin' }],
      keywordFacets: { location: ['Okisato Antiques'] },
      span: '2024-06-02',
    }];
    const uncredited = lastVisitAt(storage, { castId: 'wes', name: 'Weslie', occupancy });
    if (uncredited) return 'uncredited should skip';

    const none = lastVisitAt(storage, {
      castId: 'wes',
      name: 'Weslie',
      occupancy: { mode: 'moving', destKey: 'Okisato Antiques' },
    });
    if (none) return 'moving occupancy should skip';
    return '';
  } catch (err) {
    return err?.message || String(err);
  }
}
