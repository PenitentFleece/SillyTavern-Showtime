// Hidden Script-card tracker: timestamp credited characters' Reputation
// connection adds/drops and standing +/-. Settings live on Backstage →
// Trackers → Connection; the log lives on the scene card, collapsed.

import { getStarMember } from './castCatalog.js';
import { inPlayMemberIds } from './chatTrack.js';
import { creditedScenes, getScriptDb } from './scriptCatalog.js';
import { getTimelinePresent } from './calendarTime.js';
import { standingInfo } from './motivationCatalog.js';
import { defaultTrackers, normalizeTrackers } from './trackersConfig.js';

export const CONN_LOG_CAP = 24;

function uid() {
  return crypto?.randomUUID?.() ?? (`t_${Math.random().toString(36).slice(2, 10)}`);
}

function connectionSettings(storage) {
  try {
    const st = storage.getChat('backstage', { trackers: {} });
    return normalizeTrackers(st.trackers).connection;
  } catch {
    return defaultTrackers().connection;
  }
}

function castIdOfNode(n, starId) {
  if (!n) return '';
  if (n.kind === 'self') return starId || String(n.characterId || '');
  return String(n.characterId || '');
}

/** Compact Reputation graph for diffing. Node ids stay stable across edits. */
export function snapshotConnGraph(storage) {
  let rep = { personal: [], house: [] };
  try {
    rep = storage.getChat('reputation', { personal: [], house: [] }) || rep;
  } catch { /* ignore */ }
  const star = getStarMember(storage);
  const starId = String(star?.id || '');
  const nodes = {};
  for (const n of rep.personal || []) {
    if (!n?.id) continue;
    const readings = {};
    for (const r of n.readings || []) {
      if (!r?.targetId) continue;
      if (r.standing == null || r.standing === '') continue;
      const v = Number(r.standing);
      if (!Number.isFinite(v)) continue;
      readings[r.targetId] = Math.max(-100, Math.min(100, Math.round(v)));
    }
    const links = [...new Set((n.links || []).map(x => String(x || '').trim()).filter(Boolean))].sort();
    nodes[n.id] = {
      name: String(n.name || '').trim() || 'Notice',
      kind: n.kind || '',
      characterId: castIdOfNode(n, starId),
      houseId: String(n.houseId || ''),
      category: n.category || '',
      links,
      readings,
    };
  }
  const houses = {};
  for (const h of rep.house || []) {
    if (!h?.id) continue;
    const standing = Number(h.standing);
    houses[h.id] = {
      name: String(h.alias || h.name || '').trim() || 'Affiliation',
      standing: Number.isFinite(standing) ? Math.max(-100, Math.min(100, Math.round(standing))) : 0,
    };
  }
  return { v: 1, starId, nodes, houses };
}

function nameOf(snap, id) {
  return snap?.nodes?.[id]?.name || snap?.houses?.[id]?.name || '';
}

function selfName(snap) {
  const nodes = snap?.nodes || {};
  for (const n of Object.values(nodes)) {
    if (n?.kind === 'self') return n.name || 'Star';
  }
  return 'Star';
}

/**
 * Diff two snapshots. Events are per credited-capable node (has characterId).
 * Link add/drop is undirected in copy; standing is directed who → other.
 */
export function diffConnGraph(prev, next) {
  const events = [];
  if (!prev || !next) return events;

  const ids = new Set([
    ...Object.keys(prev.nodes || {}),
    ...Object.keys(next.nodes || {}),
  ]);
  for (const id of ids) {
    const a = prev.nodes?.[id];
    const b = next.nodes?.[id];
    const whoId = String((b || a)?.characterId || '');
    const whoName = String((b || a)?.name || '');
    if (!whoId) continue;

    const oldLinks = new Set(a?.links || []);
    const newLinks = new Set(b?.links || []);
    for (const otherId of newLinks) {
      if (oldLinks.has(otherId)) continue;
      events.push({
        kind: 'added',
        nodeId: id,
        whoId,
        whoName,
        otherId,
        otherName: nameOf(next, otherId) || nameOf(prev, otherId) || 'Unknown',
      });
    }
    for (const otherId of oldLinks) {
      if (newLinks.has(otherId)) continue;
      events.push({
        kind: 'dropped',
        nodeId: id,
        whoId,
        whoName,
        otherId,
        otherName: nameOf(prev, otherId) || nameOf(next, otherId) || 'Unknown',
      });
    }

    const oldR = a?.readings || {};
    const newR = b?.readings || {};
    const tIds = new Set([...Object.keys(oldR), ...Object.keys(newR)]);
    for (const tid of tIds) {
      const ov = oldR[tid];
      const nv = newR[tid];
      if (ov == null && nv == null) continue;
      if (ov != null && nv != null && ov === nv) continue;
      if (nv == null) continue;
      const from = ov == null ? 0 : ov;
      const delta = nv - from;
      if (!delta) continue;
      events.push({
        kind: delta > 0 ? 'up' : 'down',
        whoId,
        whoName,
        otherId: tid,
        otherName: nameOf(next, tid) || nameOf(prev, tid) || 'Unknown',
        delta,
        standing: nv,
      });
    }
  }

  const starId = String(next.starId || prev.starId || '');
  if (starId) {
    const whoName = selfName(next) !== 'Star' ? selfName(next) : selfName(prev);
    const hIds = new Set([
      ...Object.keys(prev.houses || {}),
      ...Object.keys(next.houses || {}),
    ]);
    for (const hid of hIds) {
      const oh = prev.houses?.[hid];
      const nh = next.houses?.[hid];
      if (!oh || !nh) continue;
      if (oh.standing === nh.standing) continue;
      const delta = nh.standing - oh.standing;
      if (!delta) continue;
      events.push({
        kind: delta > 0 ? 'up' : 'down',
        whoId: starId,
        whoName,
        otherId: hid,
        otherName: nh.name || oh.name || 'Affiliation',
        delta,
        standing: nh.standing,
      });
    }
  }
  return events;
}

export function normalizeConnLog(raw) {
  if (!Array.isArray(raw)) return [];
  const kinds = new Set(['added', 'dropped', 'up', 'down']);
  return raw.map(m => {
    if (!m || typeof m !== 'object') return null;
    const kind = kinds.has(m.kind) ? m.kind : '';
    if (!kind) return null;
    const deltaN = Number(m.delta);
    const standN = Number(m.standing);
    return {
      id: String(m.id || uid()),
      at: Number(m.at) || 0,
      kind,
      whoId: String(m.whoId || ''),
      whoName: String(m.whoName || ''),
      otherId: String(m.otherId || ''),
      otherName: String(m.otherName || ''),
      delta: Number.isFinite(deltaN) ? deltaN : null,
      standing: Number.isFinite(standN) ? standN : null,
    };
  }).filter(Boolean).slice(-CONN_LOG_CAP);
}

export function formatConnAt(ms) {
  const d = new Date(Number(ms) || 0);
  if (!Number.isFinite(d.getTime()) || d.getTime() <= 0) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatConnMark(m) {
  const a = String(m?.whoName || 'Someone').trim() || 'Someone';
  const b = String(m?.otherName || 'Unknown').trim() || 'Unknown';
  if (m?.kind === 'added' || m?.kind === 'dropped') {
    const [x, y] = [a, b].sort((p, q) => p.localeCompare(q));
    const verb = m.kind === 'added' ? 'Connection added' : 'Connection dropped';
    return `${verb} · ${x} ↔ ${y}`;
  }
  const delta = Number(m?.delta) || 0;
  const sign = delta > 0 ? `+${delta}` : String(delta);
  const band = standingInfo(m?.standing).label;
  return `Relationship ${sign} · ${a} → ${b}${band ? ` · ${band}` : ''}`;
}

function gatherCredited(storage, ev, next) {
  const seen = new Set();
  const out = [];
  const push = (id, name) => {
    if (!id && !name) return;
    for (const s of creditedScenes(storage, id, name)) {
      if (!s?.card || s.card.active === false || seen.has(s.uid)) continue;
      seen.add(s.uid);
      out.push(s);
    }
  };
  push(ev.whoId, ev.whoName);
  const other = next?.nodes?.[ev.otherId];
  if (other?.characterId) push(other.characterId, other.name);
  return out;
}

function pickStampCards(storage, db, ev, next) {
  const active = gatherCredited(storage, ev, next);
  if (!active.length) return [];
  let presentUid = '';
  try {
    presentUid = String(getTimelinePresent(db)?.sourceUid || '');
  } catch { /* ignore */ }
  const presentHit = presentUid && active.find(s => s.uid === presentUid);
  if (presentHit) return [presentHit.card];
  const pinned = active.filter(s => s.card.pinned).map(s => s.card);
  if (pinned.length) return pinned;
  const sorted = active.slice().sort((a, b) =>
    (Number(b.card.updatedAt) || 0) - (Number(a.card.updatedAt) || 0));
  return sorted[0] ? [sorted[0].card] : [];
}

function dedupeKey(ev) {
  if (ev.kind === 'added' || ev.kind === 'dropped') {
    return `${ev.kind}:${[ev.nodeId || ev.whoId, ev.otherId].sort().join('|')}`;
  }
  return `${ev.kind}:${ev.whoId}>${ev.otherId}:${ev.delta}`;
}

/**
 * Compare Reputation to the last snap, stamp connectionLog on credited
 * present/pinned Script cards. First run (or tracker off) only refreshes snap.
 */
export function runScriptConnTrack(storage, { chat } = {}) {
  const db = getScriptDb(storage);
  db.settings ??= {};
  const conn = connectionSettings(storage);
  const next = snapshotConnGraph(storage);
  const prev = db.settings.connSnap;
  try {
    if (prev && JSON.stringify(prev) === JSON.stringify(next)) {
      return { dirty: false, stamped: false };
    }
  } catch { /* ignore stringify issues */ }

  db.settings.connSnap = next;

  if (conn.enabled === false) return { dirty: true, stamped: false };
  if (!prev || prev.v !== 1) return { dirty: true, stamped: false };

  const prevCount = Object.keys(prev.nodes || {}).length;
  const nextCount = Object.keys(next.nodes || {}).length;
  if (prevCount === 0 && nextCount > 0) return { dirty: true, stamped: false };

  let events = diffConnGraph(prev, next);
  if (!events.length) return { dirty: true, stamped: false };
  if (events.length > 16) return { dirty: true, stamped: false };

  if (!conn.offScreen) {
    const n = Number(conn.inPlayWindow) || 10;
    const playIds = inPlayMemberIds(storage, chat, n, { includeStar: true });
    events = events.filter(e => {
      if (playIds.has(e.whoId)) return true;
      const otherId = next.nodes?.[e.otherId]?.characterId;
      return otherId && playIds.has(otherId);
    });
  }
  if (!events.length) return { dirty: true, stamped: false };

  const at = Date.now();
  let stamped = false;
  const seenOnCard = new Map();

  for (const ev of events) {
    const cards = pickStampCards(storage, db, ev, next);
    for (const card of cards) {
      if (!card || card.kind === 'folder') continue;
      const key = dedupeKey(ev);
      const bag = seenOnCard.get(card.uid) || new Set();
      if (key && bag.has(key)) continue;
      if (key) bag.add(key);
      seenOnCard.set(card.uid, bag);
      card.connectionLog = normalizeConnLog([
        ...(card.connectionLog || []),
        {
          id: uid(),
          at,
          kind: ev.kind,
          whoId: ev.whoId,
          whoName: ev.whoName,
          otherId: ev.otherId,
          otherName: ev.otherName,
          delta: ev.delta ?? null,
          standing: ev.standing ?? null,
        },
      ]);
      stamped = true;
    }
  }
  return { dirty: true, stamped };
}

export function smokeScriptConnTrackPure() {
  const prev = {
    v: 1,
    starId: 'star1',
    nodes: {
      self: { name: 'Star', kind: 'self', characterId: 'star1', houseId: '', category: 'individual', links: [], readings: {} },
      n2: { name: 'Aiko', kind: 'notice', characterId: 'c2', houseId: '', category: 'individual', links: [], readings: {} },
    },
    houses: { h1: { name: 'Guild', standing: 0 } },
  };
  const next = {
    v: 1,
    starId: 'star1',
    nodes: {
      self: { name: 'Star', kind: 'self', characterId: 'star1', houseId: '', category: 'individual', links: ['n2'], readings: {} },
      n2: {
        name: 'Aiko',
        kind: 'notice',
        characterId: 'c2',
        houseId: '',
        category: 'individual',
        links: ['self'],
        readings: { self: 14 },
      },
    },
    houses: { h1: { name: 'Guild', standing: 12 } },
  };
  const ev = diffConnGraph(prev, next);
  const kinds = ev.map(e => e.kind).sort().join(',');
  const mark = formatConnMark({ kind: 'up', whoName: 'Aiko', otherName: 'Star', delta: 14, standing: 14 });
  const ok = kinds.includes('added') && kinds.includes('up') && /Relationship \+14/.test(mark);
  return { ok, kinds, mark, n: ev.length };
}
