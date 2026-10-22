// Script plot spine: shelf order plus Follows (after a chain) and Depends (elsewhere).

import { walkBack } from './dagWalk.js';

export function normalizeUidList(raw, { selfUid = '', allowed = null } = {}) {
  const allow = allowed instanceof Set
    ? allowed
    : (Array.isArray(allowed) ? new Set(allowed) : null);
  const self = String(selfUid || '').trim();
  const out = [];
  const seen = new Set();
  for (const x of Array.isArray(raw) ? raw : []) {
    const id = String(x || '').trim();
    if (!id || id === self || seen.has(id)) continue;
    if (allow && !allow.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function isSpineFolder(card) {
  return String(card?.kind || '') === 'folder';
}

/** Folders have no spine. Scene/event cards keep followsUids / dependsUids. */
export function normalizeSpine(card, { allowed = null } = {}) {
  if (!card || typeof card !== 'object') return card;
  if (isSpineFolder(card)) {
    card.followsUids = [];
    card.dependsUids = [];
    return card;
  }
  card.followsUids = normalizeUidList(card.followsUids, { selfUid: card.uid, allowed });
  card.dependsUids = normalizeUidList(card.dependsUids, { selfUid: card.uid, allowed });
  return card;
}

function byIndex(a, b) {
  return (a.card.sortIndex ?? 0) - (b.card.sortIndex ?? 0)
    || (a.card.createdAt || 0) - (b.card.createdAt || 0);
}

/** DFS flatten of non-folder cards, same sibling order as the Script shelf tree. */
export function flattenShelfUids(cards) {
  const list = Array.isArray(cards) ? cards : [];
  const map = new Map();
  for (const c of list) {
    if (!c?.uid) continue;
    map.set(c.uid, { card: c, children: [] });
  }
  const roots = [];
  for (const c of list) {
    if (!c?.uid || !map.has(c.uid)) continue;
    const node = map.get(c.uid);
    if (c.parentUid && map.has(c.parentUid)) map.get(c.parentUid).children.push(node);
    else roots.push(node);
  }
  for (const node of map.values()) node.children.sort(byIndex);
  roots.sort(byIndex);
  const out = [];
  const walk = (nodes) => {
    for (const n of nodes) {
      if (!isSpineFolder(n.card)) out.push(n.card.uid);
      if (n.children.length) walk(n.children);
    }
  };
  walk(roots);
  return out;
}

/**
 * Depends targets are simultaneous elsewhere — not implicit shelf predecessors.
 * Follows continuations of those cards stay on the shelf (adjacent thread / merge).
 */
export function branchUidSet(cards) {
  const off = new Set();
  for (const c of Array.isArray(cards) ? cards : []) {
    for (const d of c?.dependsUids || []) {
      const id = String(d || '').trim();
      if (id) off.add(id);
    }
  }
  return off;
}

/** Main-timeline shelf order: flatten minus Depends branches. */
export function shelfOrderedUids(cards) {
  const off = branchUidSet(cards);
  return flattenShelfUids(cards).filter(id => !off.has(id));
}

export function shelfPredecessor(order, uid) {
  const i = (order || []).indexOf(uid);
  return i > 0 ? order[i - 1] : '';
}

export function shelfSuccessor(order, uid) {
  const i = (order || []).indexOf(uid);
  return i >= 0 && i < (order || []).length - 1 ? order[i + 1] : '';
}

/**
 * Dated non-folder cards in calendar order. `placeOf(card)` → `{ sort, dock }`.
 * Docked / undated cards are omitted (ruler only — not the default memory spine).
 */
export function calendarOrderedUids(cards, placeOf) {
  const dated = [];
  for (const c of cards || []) {
    if (!c?.uid || isSpineFolder(c)) continue;
    const p = typeof placeOf === 'function'
      ? placeOf(c)
      : { sort: c.timestamp, dock: !!c.timelineOff || !Number.isFinite(Number(c.timestamp)) };
    if (p?.dock || !Number.isFinite(Number(p?.sort))) continue;
    dated.push({ uid: c.uid, sort: Number(p.sort), createdAt: c.createdAt || 0 });
  }
  dated.sort((a, b) => a.sort - b.sort || a.createdAt - b.createdAt);
  return dated.map(x => x.uid);
}

export function calendarPredecessor(order, uid) {
  const i = (order || []).indexOf(uid);
  return i > 0 ? order[i - 1] : '';
}

export function calendarSuccessor(order, uid) {
  const i = (order || []).indexOf(uid);
  return i >= 0 && i < (order || []).length - 1 ? order[i + 1] : '';
}

/** Explicit Follows override the implicit previous shelf card. Depends are not preds. */
export function timelinePred(card, shelfPred) {
  const follows = (card?.followsUids || []).map(x => String(x || '').trim()).filter(Boolean);
  if (follows.length) return follows;
  return shelfPred ? [shelfPred] : [];
}

export function spinePredOf(cards) {
  const list = Array.isArray(cards) ? cards : [];
  const byUid = new Map(list.filter(c => c?.uid).map(c => [c.uid, c]));
  const order = shelfOrderedUids(list);
  return (uid) => timelinePred(byUid.get(uid), shelfPredecessor(order, uid));
}

/**
 * Follows loops are illegal. Depends-to-self is stripped by normalize.
 * Merge-back (a branch Following a later main card) is legal.
 */
export function spineWouldCycle(cards, uid, followsUids, dependsUids) {
  const id = String(uid || '').trim();
  if (!id) return false;
  const follows = normalizeUidList(followsUids, { selfUid: id });
  normalizeUidList(dependsUids, { selfUid: id });
  const byUid = new Map((cards || []).filter(c => c?.uid).map(c => [c.uid, c]));
  const predOf = (node) => {
    if (node === id) return follows;
    const c = byUid.get(node);
    return [...(c?.followsUids || [])];
  };
  return walkBack(predOf, follows, 64).includes(id);
}

function tryAdd(n, seen, extra, cap) {
  if (!n?.uid || seen.has(n.uid) || extra.length >= cap) return;
  seen.add(n.uid);
  extra.push(n.uid);
}

function namedDepends(card) {
  return (card?.dependsUids || []).map(x => String(x || '').trim()).filter(Boolean);
}

function reverseDepends(list, uid) {
  const out = [];
  for (const c of list) {
    if (!c?.uid || !namedDepends(c).includes(uid)) continue;
    out.push(c.uid);
  }
  return out;
}

function pushNamedDepends(byUid, ids, seen, extra, cap) {
  for (const id of ids) {
    if (extra.length >= cap) return;
    for (const dep of namedDepends(byUid.get(id))) {
      if (extra.length >= cap) return;
      tryAdd(byUid.get(dep), seen, extra, cap);
    }
  }
}

/**
 * Expand inject seeds along shelf ∪ Follows. Depends are concurrent extras.
 * @returns {{ seeds: string[], extra: string[], order: string[] }}
 */
export function expandScriptSeeds(cards, seedUids, {
  back = 2,
  forward = 1,
  cap = 8,
  placeOf,
  presentSort = null,
} = {}) {
  const list = Array.isArray(cards) ? cards : [];
  const byUid = new Map(list.filter(c => c?.uid).map(c => [c.uid, c]));
  const order = shelfOrderedUids(list);
  const predOf = (uid) => timelinePred(byUid.get(uid), shelfPredecessor(order, uid));
  const seeds = [...new Set((seedUids || [])
    .map(s => String(s || '').trim())
    .filter(id => byUid.has(id)))];
  const walked = walkBack(predOf, seeds, back, { cap: cap + seeds.length + 4 });
  const extra = [];
  const seen = new Set(seeds);
  for (const id of walked) {
    if (seen.has(id)) continue;
    seen.add(id);
    extra.push(id);
    if (extra.length >= cap) {
      return { seeds, extra, order: [...seeds, ...extra] };
    }
  }

  const walkedExtras = extra.slice();
  const branchAnchors = [];
  for (const s of seeds) {
    for (const mainId of reverseDepends(list, s)) {
      if (byUid.has(mainId)) branchAnchors.push(mainId);
    }
  }
  if (branchAnchors.length) {
    const more = walkBack(predOf, branchAnchors, back, { cap: cap + seeds.length + extra.length + 4 });
    for (const id of more) {
      if (seen.has(id)) continue;
      seen.add(id);
      extra.push(id);
      if (extra.length >= cap) {
        return { seeds, extra, order: [...seeds, ...extra] };
      }
    }
  }

  pushNamedDepends(byUid, seeds, seen, extra, cap);
  pushNamedDepends(byUid, walkedExtras, seen, extra, cap);
  for (const id of walkedExtras) {
    if (extra.length >= cap) break;
    for (const mainId of reverseDepends(list, id)) {
      if (extra.length >= cap) break;
      tryAdd(byUid.get(mainId), seen, extra, cap);
    }
  }

  const fwd = Math.max(0, Number(forward) || 0);
  if (fwd > 0) {
    for (const seed of seeds) {
      if (extra.length >= cap) break;
      const shelfNext = shelfSuccessor(order, seed);
      if (shelfNext) {
        const n = byUid.get(shelfNext);
        const follows = n?.followsUids || [];
        const onThisChain = !follows.length || follows.includes(seed);
        const p = typeof placeOf === 'function' ? placeOf(n) : { sort: n?.timestamp };
        const atOrAfter = presentSort == null
          || !Number.isFinite(Number(p?.sort))
          || Number(p.sort) >= presentSort;
        if (onThisChain && atOrAfter) tryAdd(n, seen, extra, cap);
      }
      for (const c of list) {
        if (extra.length >= cap) break;
        if ((c.followsUids || []).includes(seed)) tryAdd(c, seen, extra, cap);
      }
    }
  }
  return { seeds, extra, order: [...seeds, ...extra] };
}

export function smokeScriptDagPure() {
  const cards = [
    { uid: 'a', kind: 'card', parentUid: null, sortIndex: 0, createdAt: 1, followsUids: [], dependsUids: [] },
    { uid: 'b', kind: 'card', parentUid: null, sortIndex: 1, createdAt: 2, followsUids: [], dependsUids: ['x'] },
    { uid: 'x', kind: 'card', parentUid: null, sortIndex: 2, createdAt: 3, followsUids: [], dependsUids: [] },
    { uid: 'y', kind: 'card', parentUid: null, sortIndex: 3, createdAt: 4, followsUids: ['x'], dependsUids: [] },
    { uid: 'c', kind: 'card', parentUid: null, sortIndex: 4, createdAt: 5, followsUids: ['y'], dependsUids: [] },
  ];
  const main = shelfOrderedUids(cards);
  if (main.join(',') !== 'a,b,y,c') return `shelf main ${main.join(',')}`;
  if (shelfPredecessor(main, 'b') !== 'a') return 'shelf pred';
  if (shelfPredecessor(main, 'y') !== 'b') return 'depends target should not sit on main shelf pred';
  if (shelfPredecessor(main, 'c') !== 'y') return 'follows continuation stays on shelf';
  if (!branchUidSet(cards).has('x') || branchUidSet(cards).has('y')) return 'only depends targets are off-spine';
  if (!spineWouldCycle(cards, 'x', ['y'], [])) return 'follows loop should cycle';
  const looped = cards.map(c => c.uid === 'y' ? { ...c, followsUids: ['x'] } : { ...c });
  looped.find(c => c.uid === 'x').followsUids = ['y'];
  if (!spineWouldCycle(looped, 'x', ['y'], [])) return 'mutual follows should cycle';
  if (spineWouldCycle(cards, 'c', ['y'], [])) return 'merge-back follows should be acyclic';
  if (spineWouldCycle(cards, 'x', [], ['x'])) return 'depends-to-self is stripped, not a follows cycle';

  const fromC = expandScriptSeeds(cards, ['c'], { back: 2, forward: 0, cap: 8 });
  if (!fromC.extra.includes('y')) return 'merge-back should walk follows to branch tip';
  if (!fromC.extra.includes('x')) return 'merge-back should walk follows through branch';
  if (!fromC.extra.includes('b')) return 'branch depends should surface the main beat';

  const fromB = expandScriptSeeds(cards, ['b'], { back: 1, forward: 1, cap: 8 });
  if (!fromB.extra.includes('a')) return 'b should walk shelf pred a';
  if (!fromB.extra.includes('x')) return 'b should pull depends branch as elsewhere';
  if (fromB.extra.includes('c')) return 'depends must not count as next on the spine';

  const fromX = expandScriptSeeds(cards, ['x'], { back: 2, forward: 1, cap: 8 });
  if (!fromX.extra.includes('b')) return 'branch seed should include its main beat';
  if (!fromX.extra.includes('a')) return 'branch seed should walk the main beat chain';
  if (!fromX.extra.includes('y')) return 'branch seed should forward along follows';
  if (fromX.extra.includes('c')) return 'later main merge is not a pred of the branch';

  const undated = {
    uid: 'u', kind: 'card', parentUid: null, sortIndex: 5, createdAt: 6,
    timestamp: null, timelineOff: true, followsUids: ['a'], dependsUids: [],
  };
  const withU = [...cards, undated];
  const cal = calendarOrderedUids(withU, (c) => (
    c.timelineOff || c.timestamp == null ? { sort: null, dock: true } : { sort: c.createdAt, dock: false }
  ));
  if (cal.includes('u')) return 'undated must not sit on calendar ruler';
  const flash = expandScriptSeeds(withU, ['u'], { back: 2, forward: 0, cap: 8 });
  if (!flash.extra.includes('a')) return 'undated follows should still walk explicit edges';
  if (timelinePred(cards.find(c => c.uid === 'b'), 'a').join(',') !== 'a') return 'depends must not be timeline preds';
  const foldered = [
    { uid: 'fold', kind: 'folder', parentUid: null, sortIndex: 0, createdAt: 0, followsUids: ['a'], dependsUids: ['x'] },
    ...cards,
  ];
  if (shelfOrderedUids(foldered).includes('fold')) return 'folders stay off the spine';
  return '';
}
