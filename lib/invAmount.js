// Pack fill + remaining/capacity. Wear condition stays separate.

export const FILL_BANDS = Object.freeze([
  { id: 'full',  label: 'Full',  color: '#4a9e52' },
  { id: 'high',  label: 'High',  color: '#7aab4a' },
  { id: 'half',  label: 'Half',  color: '#c9a24a' },
  { id: 'low',   label: 'Low',   color: '#c4772b' },
  { id: 'empty', label: 'Empty', color: '#8a8474' },
]);

export const FILL_MAP = Object.fromEntries(FILL_BANDS.map(b => [b.id, b]));

export const AMOUNT_UNITS = Object.freeze([
  { id: 'pieces',   label: 'Pieces' },
  { id: 'servings', label: 'Servings' },
  { id: 'ml',       label: 'ml' },
  { id: 'g',        label: 'g' },
  { id: 'custom',   label: 'Custom' },
]);

const FILL_ORDER = Object.freeze(['full', 'high', 'half', 'low', 'empty']);
const DRINK_RE = /\b(water|soda|coffee|tea|juice|beer|wine|milk|cola|bottle|flask|canteen|potion|drink)\b/i;

function numOrNull(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function deriveFill(remaining, capacity, fallback = '') {
  if (remaining != null && remaining <= 0) return 'empty';
  if (remaining != null && capacity != null && capacity > 0) {
    const r = remaining / capacity;
    if (r <= 0) return 'empty';
    if (r <= 0.25) return 'low';
    if (r <= 0.5) return 'half';
    if (r <= 0.75) return 'high';
    return 'full';
  }
  return FILL_MAP[fallback] ? fallback : '';
}

export function normalizeAmount(raw = {}) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const nested = src.amount && typeof src.amount === 'object' ? src.amount : {};
  const remaining = numOrNull(nested.remaining ?? src.remaining);
  let capacity = numOrNull(nested.capacity ?? src.capacity);
  if (capacity != null && remaining != null && capacity < remaining) capacity = remaining;
  const unitRaw = String(nested.unit ?? src.unit ?? '').trim().toLowerCase();
  const unit = AMOUNT_UNITS.some(u => u.id === unitRaw) ? unitRaw : (unitRaw ? 'custom' : '');
  const unitLabel = String(nested.unitLabel ?? src.unitLabel ?? (unit === 'custom' && unitRaw && unitRaw !== 'custom' ? unitRaw : '')).trim();
  const fillIn = String(nested.fill ?? src.fill ?? '').trim().toLowerCase();
  const fill = deriveFill(remaining, capacity, fillIn);
  if (remaining == null && capacity == null && !fill && !unit) return null;
  return {
    remaining,
    capacity,
    unit: unit || '',
    unitLabel,
    fill,
  };
}

export function readAmount(item) {
  if (!item || typeof item !== 'object') return null;
  return normalizeAmount(item);
}

export function writeAmount(item, patch = {}) {
  if (!item || typeof item !== 'object') return item;
  const next = normalizeAmount({ ...(readAmount(item) || {}), ...patch });
  if (!next) {
    delete item.amount;
    delete item.fill;
    return item;
  }
  item.amount = {
    remaining: next.remaining,
    capacity: next.capacity,
    unit: next.unit,
    unitLabel: next.unitLabel,
  };
  item.fill = next.fill;
  return item;
}

export function unitLabelOf(amount) {
  if (!amount) return '';
  if (amount.unit === 'custom') return amount.unitLabel || 'units';
  return AMOUNT_UNITS.find(u => u.id === amount.unit)?.label?.toLowerCase() || '';
}

export function hasAmount(item) {
  return !!readAmount(item);
}

export function formatAmountLine(item) {
  const a = readAmount(item);
  if (!a) return '';
  const band = FILL_MAP[a.fill]?.label || '';
  const unit = unitLabelOf(a);
  let count = '';
  if (a.remaining != null && a.capacity != null) count = `${a.remaining}/${a.capacity}`;
  else if (a.remaining != null) count = String(a.remaining);
  const qty = count && unit ? `${count} ${unit}` : (count || unit);
  return [band, qty].filter(Boolean).join(' · ');
}

const BAND_FRAC = Object.freeze({ empty: 0, low: 0.2, half: 0.5, high: 0.75, full: 1 });

/** Apply audit/UI amount fields onto an existing row. Empty packs stay listed. */
export function applyAmountOp(item, op = {}) {
  if (!item || typeof item !== 'object') return false;
  const src = op && typeof op === 'object' ? op : {};
  const nested = src.amount && typeof src.amount === 'object' ? src.amount : {};
  const remIn = nested.remaining ?? src.remaining ?? src.count ?? src.left;
  const capIn = nested.capacity ?? src.capacity ?? src.max ?? src.full;
  const sentRemaining = remIn != null && remIn !== '';
  const sentCapacity = capIn != null && capIn !== '';
  const unit = nested.unit ?? src.unit;
  const unitLabel = nested.unitLabel ?? src.unitLabel;
  const fillRaw = String(nested.fill ?? src.fill ?? '').trim().toLowerCase();
  const fillId = FILL_MAP[fillRaw] ? fillRaw : '';
  const cur = readAmount(item) || {};
  const before = JSON.stringify(cur);

  if (sentRemaining || sentCapacity) {
    writeAmount(item, {
      remaining: sentRemaining ? remIn : cur.remaining,
      capacity: sentCapacity ? capIn : cur.capacity,
      unit: unit || cur.unit,
      unitLabel: unitLabel || cur.unitLabel,
      fill: fillId || cur.fill,
    });
  } else if (fillId) {
    if (cur.remaining != null && cur.capacity != null && cur.capacity > 0) {
      const frac = BAND_FRAC[fillId] ?? 0.5;
      writeAmount(item, { remaining: Math.round(cur.capacity * frac), fill: fillId });
    } else {
      writeAmount(item, { fill: fillId, remaining: null });
    }
  } else if (unit || unitLabel) {
    writeAmount(item, { unit: unit || cur.unit, unitLabel: unitLabel || cur.unitLabel });
  } else {
    return false;
  }
  return JSON.stringify(readAmount(item) || {}) !== before;
}

export function spendAmount(item, n = 1) {
  const cur = readAmount(item);
  if (!cur) return { spent: 0 };
  if (cur.remaining != null) {
    const take = Math.max(0, Number(n) || 0) || 1;
    const spent = Math.min(Math.max(0, cur.remaining), take);
    writeAmount(item, { remaining: Math.max(0, cur.remaining - spent) });
    return { spent };
  }
  const i = FILL_ORDER.indexOf(cur.fill);
  if (i < 0 || i >= FILL_ORDER.length - 1) return { spent: 0 };
  writeAmount(item, { fill: FILL_ORDER[i + 1] });
  return { spent: 1 };
}

export function careKind(item) {
  const a = readAmount(item);
  const name = String(item?.name || '');
  const unit = a?.unit || '';
  if (unit === 'ml' || DRINK_RE.test(name)) return 'drink';
  if (unit === 'g' || unit === 'pieces' || unit === 'servings') return 'food';
  if (item?.category === 'consumable') return DRINK_RE.test(name) ? 'drink' : 'food';
  if (a?.fill) return DRINK_RE.test(name) ? 'drink' : 'food';
  return '';
}

export function formatPacksForPrompt(items = []) {
  const lines = [];
  for (const it of items) {
    const line = formatAmountLine(it);
    if (!line) continue;
    const kind = careKind(it);
    const a = readAmount(it);
    const hint = a?.fill === 'empty' ? ''
      : kind === 'drink' ? ' — drinking this raises Hydration'
        : kind === 'food' ? ' — eating this raises Satiety'
          : '';
    lines.push(`- ${it.name} (${line}${hint})`);
    if (lines.length >= 12) break;
  }
  return lines.join('\n');
}

export function smokeInvAmountPure() {
  const bag = { name: 'chips', category: 'consumable' };
  writeAmount(bag, { remaining: 12, capacity: 12, unit: 'pieces' });
  if (bag.fill !== 'full' || !/12\/12/.test(formatAmountLine(bag))) return 'full pack';
  const { spent } = spendAmount(bag, 6);
  if (spent !== 6 || bag.fill !== 'half') return `half ${bag.fill} ${spent}`;
  spendAmount(bag, 99);
  if (bag.fill !== 'empty' || bag.amount.remaining !== 0) return 'empty should stay at 0';
  if (!bag.name) return 'empty pack should keep the row';
  applyAmountOp(bag, { remaining: 12, capacity: 12, unit: 'pieces' });
  applyAmountOp(bag, { fill: 'half' });
  if (bag.fill !== 'half' || bag.amount.remaining !== 6) return 'fill band should scale remaining';
  const bottle = { name: 'water bottle' };
  writeAmount(bottle, { fill: 'half' });
  if (careKind(bottle) !== 'drink') return 'drink kind';
  if (!/Hydration/.test(formatPacksForPrompt([bottle]))) return 'pack brief should ground hydration';
  return '';
}
