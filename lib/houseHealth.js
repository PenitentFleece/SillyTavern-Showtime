// Last-one house loop notes for Backstage → Settings. Not a token budget.

const DETAIL_CAP = 160;
const REASON_CAP = 80;
const KEYS = ['receipt', 'presence', 'cue'];

export function emptyHouseHealth() {
  return { receipt: null, presence: null, cue: null };
}

export function normalizeHealthNote(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const status = String(raw.status || '').trim().slice(0, 40);
  const reason = String(raw.reason || '').trim().slice(0, REASON_CAP);
  const detail = String(raw.detail || '').replace(/\s+/g, ' ').trim().slice(0, DETAIL_CAP);
  const at = Number(raw.at) || 0;
  if (!status && !reason && !detail) return null;
  return { at, status, reason, detail };
}

export function normalizeHouseHealth(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    receipt: normalizeHealthNote(src.receipt),
    presence: normalizeHealthNote(src.presence),
    cue: normalizeHealthNote(src.cue),
  };
}

export function readHouseHealth(storage) {
  try {
    const bst = storage?.getChat?.('backstage', {}) || {};
    return normalizeHouseHealth(bst.health);
  } catch {
    return emptyHouseHealth();
  }
}

export function noteHouseHealth(storage, patch = {}, { save = true } = {}) {
  try {
    const bst = storage.getChat('backstage', {});
    const cur = normalizeHouseHealth(bst.health);
    const at = Date.now();
    for (const key of KEYS) {
      if (!patch[key]) continue;
      const next = normalizeHealthNote({ at, ...patch[key] });
      if (next) cur[key] = next;
    }
    bst.health = cur;
    if (save) {
      try { storage.saveChat?.(); } catch { /* ignore */ }
    }
    return cur;
  } catch {
    return emptyHouseHealth();
  }
}

export function healthAgo(at, now = Date.now()) {
  const t = Number(at) || 0;
  if (!t) return '';
  const s = Math.max(0, Math.round((Number(now) - t) / 1000));
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return `${h}h ago`;
}

export function formatInjectSizes(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const bits = list
    .filter(r => r && Number(r.chars) > 0)
    .map(r => `${String(r.id || '').replace(/^showtime\./, '')} ${Number(r.chars) || 0}`);
  const total = list.reduce((n, r) => n + (Number(r?.chars) || 0), 0);
  if (!bits.length) return total ? `total ${total}` : 'none this refresh';
  return `${bits.join(' · ')} · total ${total}`;
}

function formatNote(note, empty) {
  if (!note) return empty;
  const bits = [note.status, note.reason];
  if (note.detail && note.detail !== note.status && note.detail !== note.reason) bits.push(note.detail);
  bits.push(healthAgo(note.at));
  return bits.filter(Boolean).join(' · ');
}

export function formatHouseHealthLines({ health, injects } = {}) {
  const h = normalizeHouseHealth(health);
  return {
    receipt: formatNote(h.receipt, 'no receipt yet'),
    presence: formatNote(h.presence, 'no persist scan yet'),
    cue: formatNote(h.cue, 'no cue stamp yet'),
    injects: formatInjectSizes(injects),
  };
}

export function smokeHouseHealthPure() {
  const bags = { backstage: {} };
  const storage = {
    getChat(id, d = {}) {
      if (!bags[id]) bags[id] = { ...d };
      return bags[id];
    },
    saveChat() {},
  };
  noteHouseHealth(storage, { receipt: { status: 'skip', reason: 'primed' } });
  const h = readHouseHealth(storage);
  if (h.receipt?.status !== 'skip' || h.receipt?.reason !== 'primed') return 'note-receipt';
  noteHouseHealth(storage, { presence: { status: 'none', detail: 'none' } });
  const h2 = readHouseHealth(storage);
  if (h2.receipt?.status !== 'skip') return 'keep-receipt';
  if (h2.presence?.detail !== 'none') return 'note-presence';
  const lines = formatHouseHealthLines({
    health: h2,
    injects: [{ id: 'backstage.now', chars: 420 }, { id: 'cast.states', chars: 0 }],
  });
  if (!/skip/.test(lines.receipt) || !/primed/.test(lines.receipt)) return `fmt-receipt ${lines.receipt}`;
  if (!/now 420/.test(lines.injects) || !/total 420/.test(lines.injects)) return `fmt-injects ${lines.injects}`;
  if (/cast\.states/.test(lines.injects)) return 'zero-slots-hidden';
  const clip = normalizeHealthNote({ status: 'filed', detail: 'x'.repeat(400) });
  if (!clip || clip.detail.length > DETAIL_CAP) return 'clip-detail';
  if (healthAgo(Date.now() - 120000, Date.now()) !== '2m ago') return 'ago';
  return '';
}
