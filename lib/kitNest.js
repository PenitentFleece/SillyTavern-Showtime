// Kit nesting: bags/packs hold distinct objects. Fill/amount stays on a pack
// of homogeneous stuff; children are separate named items.

export const CONTAINER_NAME_RE = /\b(bags?|packs?|backpacks?|satchels?|rucksacks?|pouches?|totes?|duffels?|duffles?|cases?|purses?|messenger|briefcases?|knapsacks?|holdalls?)\b/i;

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

/** Carried brief: only roots listed; contents stay in [brackets]. */
export function formatCarryBrief(list) {
  const items = Array.isArray(list) ? list : [];
  const roots = kitRoots(items);
  const show = roots.length ? roots : items;
  if (!show.length) return 'None';
  return show.map((r) => {
    const kids = kitChildren(items, r.id);
    const self = `${r.name}${condTag(r)}`;
    if (!kids.length) return self;
    return `${self} [${kids.map(k => k.name).join('; ')}]`;
  }).join('; ');
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
  const loose = { id: 'k', name: 'keys' };
  const list = [bag, phones, charger, loose];
  const roots = kitRoots(list);
  if (roots.length !== 2 || !roots.some(r => r.id === 'b') || !roots.some(r => r.id === 'k')) {
    return 'roots should be bag + loose keys';
  }
  if (kitChildren(list, 'b').length !== 2) return 'bag should hold two items';
  const brief = formatCarryBrief(list);
  if (!/canvas bag/.test(brief) || !/headphones/.test(brief) || !/charger/.test(brief)) {
    return 'carry brief should nest contents';
  }
  if ((brief.match(/headphones/g) || []).length !== 1) return 'contents should not also list as a root';
  if (inferKitKind({ name: 'satchel' }) !== 'container') return 'satchel should infer container';
  if (kitDescendantIds(list, 'b').length !== 2) return 'descendants';
  return '';
}
