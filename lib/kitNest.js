// Kit nesting: bags/packs hold distinct objects. Fill/amount stays on a pack
// of homogeneous stuff; children are separate named items.

export const CONTAINER_NAME_RE = /\b(bags?|packs?|backpacks?|satchels?|rucksacks?|pouches?|pockets?|totes?|duffels?|duffles?|cases?|purses?|messenger|briefcases?|knapsacks?|holdalls?|sacks?)\b/i;

const GARMENT_RE = /\b(shirts?|trousers|pants|jeans|shorts|skirt|dress|coat|jacket|hoodie|socks?|boots?|shoes?)\b/i;

export function isGarmentName(name) {
  return GARMENT_RE.test(String(name || ''));
}

export function foldKitName(s) {
  return String(s || '').trim().toLowerCase()
    .replace(/^(the|a|an|her|his|their|its)\s+/, '')
    .replace(/\s+/g, ' ');
}

/**
 * Split an inside= path: "side pocket of the messenger bag",
 * "messenger bag/side pocket", "his back pocket".
 * Host first, then nested pocket.
 */
export function parseInsidePath(raw) {
  const s = String(raw || '').trim();
  if (!s) return [];
  if (s.includes('/')) {
    return s.split('/').map(x => foldKitName(x)).filter(Boolean);
  }
  const of = s.match(/^(.+?)\s+of\s+(?:the\s+|a\s+|an\s+|her\s+|his\s+|their\s+)?(.+)$/i);
  if (of) return [foldKitName(of[2]), foldKitName(of[1])].filter(Boolean);
  return [foldKitName(s)].filter(Boolean);
}

export function inferKitKind(item) {
  if (!item || typeof item !== 'object') return 'item';
  if (item.kind === 'container') return 'container';
  if (CONTAINER_NAME_RE.test(String(item.name || ''))) return 'container';
  return 'item';
}

export function kitRoots(list) {
  const items = Array.isArray(list) ? list : [];
  const ids = new Set(items.map(x => x?.id).filter(Boolean));
  return items.filter(x => x && (!x.parentId || !ids.has(x.parentId)));
}

export function kitChildren(list, parentId) {
  const pid = String(parentId || '');
  if (!pid) return [];
  return (Array.isArray(list) ? list : []).filter(x => x && String(x.parentId || '') === pid);
}

export function kitDescendantIds(list, rootId) {
  const items = Array.isArray(list) ? list : [];
  const ids = new Set([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const x of items) {
      if (x?.parentId && ids.has(x.parentId) && !ids.has(x.id)) {
        ids.add(x.id);
        grew = true;
      }
    }
  }
  ids.delete(rootId);
  return [...ids];
}

function condTag(item) {
  const c = String(item?.condition || '').trim();
  return c && c !== 'pristine' ? ` (${c})` : '';
}

function nestBrief(item, items, depth = 0, maxDepth = 5) {
  const self = `${item.name}${condTag(item)}`;
  const kids = kitChildren(items, item.id);
  if (!kids.length || depth >= maxDepth) return self;
  return `${self} [${kids.map(k => nestBrief(k, items, depth + 1, maxDepth)).join('; ')}]`;
}

/** Carried brief: only roots listed; nested pockets/contents stay in [brackets]. */
export function formatCarryBrief(list, { maxDepth = 5 } = {}) {
  const items = Array.isArray(list) ? list : [];
  const roots = kitRoots(items);
  const show = roots.length ? roots : items;
  if (!show.length) return 'None';
  const cap = Math.max(1, Number(maxDepth) || 5);
  return show.map(r => nestBrief(r, items, 0, cap)).join('; ');
}

export function findKitByName(list, name) {
  const key = String(name || '').trim().toLowerCase().replace(/^(the|a|an)\s+/, '');
  if (!key) return null;
  const items = Array.isArray(list) ? list : [];
  const fold = s => String(s || '').trim().toLowerCase().replace(/^(the|a|an)\s+/, '');
  return items.find(x => fold(x?.name) === key)
    || items.find(x => {
      const n = fold(x?.name);
      return n && (n.includes(key) || key.includes(n));
    })
    || null;
}

export function nestUnder(list, item, parent) {
  if (!item || !parent) return item;
  parent.kind = 'container';
  item.parentId = parent.id;
  if (inferKitKind(item) !== 'container') item.kind = 'item';
  return item;
}

export function smokeKitNestPure() {
  const bag = { id: 'b', name: 'canvas bag', kind: 'container' };
  const phones = { id: 'h', name: 'headphones', parentId: 'b' };
  const charger = { id: 'c', name: 'charger', parentId: 'b' };
  const pocket = { id: 'p', name: 'side pocket', kind: 'container', parentId: 'b' };
  const pills = { id: 'i', name: 'pill bottles', parentId: 'p' };
  const loose = { id: 'k', name: 'keys' };
  const list = [bag, phones, charger, pocket, pills, loose];
  const roots = kitRoots(list);
  if (roots.length !== 2 || !roots.some(r => r.id === 'b') || !roots.some(r => r.id === 'k')) {
    return 'roots should be bag + loose keys';
  }
  if (kitChildren(list, 'b').length !== 3) return 'bag should hold phones, charger, pocket';
  const brief = formatCarryBrief(list);
  if (!/canvas bag/.test(brief) || !/headphones/.test(brief) || !/charger/.test(brief)) {
    return 'carry brief should nest contents';
  }
  if (!/side pocket/.test(brief) || !/pill bottles/.test(brief)) {
    return 'carry brief should recurse nested pockets';
  }
  if ((brief.match(/headphones/g) || []).length !== 1) return 'contents should not also list as a root';
  if ((brief.match(/pill bottles/g) || []).length !== 1) return 'nested pills should not also list as a root';
  const shallow = formatCarryBrief(list, { maxDepth: 1 });
  if (!/canvas bag/.test(shallow) || !/side pocket/.test(shallow)) return 'depth 1 should still list the pocket';
  if (/pill bottles/.test(shallow)) return 'depth 1 should not recurse into the pocket';
  if (inferKitKind({ name: 'satchel' }) !== 'container') return 'satchel should infer container';
  if (inferKitKind({ name: 'side pocket' }) !== 'container') return 'pocket should infer container';
  if (kitDescendantIds(list, 'b').length !== 4) return 'descendants';
  const path = parseInsidePath('side pocket of the messenger bag');
  if (path[0] !== 'messenger bag' || path[1] !== 'side pocket') return 'inside path host then pocket';
  if (foldKitName('her messenger bag') !== 'messenger bag') return 'fold her/the';
  return '';
}
