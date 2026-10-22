// Cycle-safe directed walks. Edges point toward causes (predecessors).

function predFn(predOf) {
  if (typeof predOf === 'function') return predOf;
  if (predOf instanceof Map) return (id) => predOf.get(id) || [];
  const obj = predOf && typeof predOf === 'object' ? predOf : {};
  return (id) => obj[id] || [];
}

/**
 * BFS from seeds back along predecessor edges. Never revisits a node.
 * @param {((id: string) => string[]) | Map<string, string[]> | Record<string, string[]>} predOf
 * @param {string[]} seeds
 * @param {number} [depth]
 * @param {{ cap?: number }} [opts]
 * @returns {string[]}
 */
export function walkBack(predOf, seeds, depth = 2, { cap = 64 } = {}) {
  const getPred = predFn(predOf);
  const maxD = Math.max(0, Number(depth) || 0);
  const maxN = Math.max(1, Number(cap) || 64);
  const out = [];
  const seen = new Set();
  const queue = [];
  for (const raw of seeds || []) {
    const id = String(raw || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    queue.push({ id, d: 0 });
    if (out.length >= maxN) return out;
  }
  while (queue.length) {
    const { id, d } = queue.shift();
    if (d >= maxD) continue;
    for (const raw of getPred(id) || []) {
      const pid = String(raw || '').trim();
      if (!pid || seen.has(pid)) continue;
      seen.add(pid);
      out.push(pid);
      if (out.length >= maxN) return out;
      queue.push({ id: pid, d: d + 1 });
    }
  }
  return out;
}

/** True if `fromId` already lies on the ancestor chain of `toPredId` (adding fromId←toPredId would loop). */
export function wouldCycle(predOf, fromId, toPredId) {
  const from = String(fromId || '').trim();
  const to = String(toPredId || '').trim();
  if (!from || !to) return false;
  if (from === to) return true;
  return walkBack(predOf, [to], 64).includes(from);
}

export function smokeDagWalkPure() {
  const edges = new Map([
    ['c', ['b']],
    ['b', ['a']],
    ['d', ['b']],
  ]);
  const back = walkBack(edges, ['c'], 2);
  if (!back.includes('a') || !back.includes('b') || back[0] !== 'c') return 'should walk ancestors from seed';
  if (!wouldCycle(edges, 'a', 'c')) return 'a following c would cycle';
  if (wouldCycle(edges, 'e', 'c')) return 'new node following c should not cycle';
  const loop = new Map([['a', ['b']], ['b', ['a']]]);
  const once = walkBack(loop, ['a'], 8);
  if (once.filter(x => x === 'a').length !== 1) return 'cycle must not revisit';
  if (once.length !== 2) return 'two-node loop should visit each once';
  return '';
}
