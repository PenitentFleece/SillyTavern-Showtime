// Auto In play / Absent from mentions + who is in the current room.
// Written out stays sticky. Star is never auto-written.

import { appendNowLedger, ensureNow, seedPlaceId } from './nowSidecar.js';
import { ensureCompass } from './compass/state.js';
import { analyzeCastSceneStances } from './compass/sonar.js';
import { noteHouseHealth } from './houseHealth.js';
import { namePhraseInHay } from './chatTrack.js';

function presenceOf(char) {
  if (!char) return 'inPlay';
  const v = String(char.presence || 'inPlay');
  if (char.priority === 'star') return (v === 'absent' || v === 'privy') ? v : 'inPlay';
  return (v === 'absent' || v === 'privy' || v === 'writtenOut') ? v : 'inPlay';
}

function mentionedIds(storage, chat, n) {
  const depth = Math.max(1, Number(n) || 10);
  // A plain name/alias drop decays fast: someone saying "I should visit Mrs.
  // Okisato tomorrow" or a passing possessive ("Mrs. Okisato's shop") shouldn't
  // keep conjuring that character into the scene for the full inPlayWindow.
  // Actual occupancy (compass/sonar, handled by hereKeys) has no such recency
  // limit — it's live state, not a stale text echo.
  const mentionDepth = Math.max(1, Math.min(depth, 3));
  const play = (Array.isArray(chat) ? chat : []).filter(m => m && !m.is_system).slice(-mentionDepth);
  const hay = play.map(m => String(m.mes || '').replace(/<[^>]+>/g, ' ').toLowerCase()).join('\n');
  const ids = new Set();
  let chars = [];
  try { chars = storage?.getChat?.('cast', { characters: [] })?.characters || []; } catch { chars = []; }
  for (const c of chars) {
    const names = [c?.name, ...(c?.aliases || [])];
    if (names.some(name => namePhraseInHay(hay, name))) ids.add(c.id);
  }
  const speakerNames = play
    .filter(m => !m.is_user)
    .map(m => String(m.name || m.extra?.name || '').trim())
    .filter(Boolean);
  for (const sp of speakerNames) {
    for (const c of chars) {
      const names = [c?.name, ...(c?.aliases || [])];
      if (names.some(name => namePhraseInHay(sp.toLowerCase(), name))) ids.add(c.id);
    }
  }
  return ids;
}

function occupantFeedsPresence(o) {
  const desc = String(o?.description || '').trim().toLowerCase();
  if (!desc) return true;
  if (desc === 'parked' || desc.startsWith('sonar')) return false;
  return true;
}

function hereKeys(compass, placeId) {
  const keys = new Set();
  const pid = String(placeId || '').trim();
  if (!pid) return keys;
  const room = compass?.rooms?.[pid];
  for (const o of room?.occupants || []) {
    if (!occupantFeedsPresence(o)) continue;
    const id = String(o?.castId || o?.id || '').trim();
    if (id) keys.add(id);
    const name = String(o?.name || '').trim().toLowerCase();
    if (name) keys.add(`name:${name}`);
  }
  for (const ping of Object.values(compass?.sonar?.pings || {})) {
    if (String(ping?.placeId || '').trim() !== pid) continue;
    if (ping?.locked || ping?.away || ping?.listening) continue;
    const id = String(ping.castId || ping.id || '').trim();
    if (id) keys.add(id);
    const name = String(ping.name || '').trim().toLowerCase();
    if (name) keys.add(`name:${name}`);
  }
  return keys;
}

export function autoPresenceEnabled(storage) {
  try {
    return storage?.getChat?.('cast', {})?.autoPresence !== false;
  } catch {
    return true;
  }
}

export function planPresenceFlips(characters, inPlayIds, {
  privyIds = null,
  enteredIds = null,
} = {}) {
  const flips = [];
  const inSet = inPlayIds instanceof Set ? inPlayIds : new Set(inPlayIds || []);
  const privySet = privyIds instanceof Set ? privyIds : new Set(privyIds || []);
  const enteredSet = enteredIds instanceof Set ? enteredIds : new Set(enteredIds || []);
  for (const char of characters || []) {
    if (!char || char.priority === 'director' || char.priority === 'star') continue;
    if (char.presenceAuto === false) continue; // pinned — the user is driving this one by hand
    const cur = presenceOf(char);
    if (cur === 'writtenOut') continue;
    const nameKey = `name:${String(char.name || '').trim().toLowerCase()}`;
    const here = inSet.has(char.id) || inSet.has(nameKey);
    const isPrivy = privySet.has(char.id) || privySet.has(nameKey);
    const entered = enteredSet.has(char.id) || enteredSet.has(nameKey);
    let next = cur;
    if (isPrivy && !entered) {
      next = 'privy';
    } else if (cur === 'privy') {
      if (entered) next = 'inPlay';
      else if (!here && !isPrivy) next = 'absent';
    } else if (here && cur === 'absent') {
      next = 'inPlay';
    } else if (!here && cur === 'inPlay') {
      next = 'absent';
    }
    if (next === cur) continue;
    flips.push({ char, from: cur, to: next });
  }
  return flips;
}

export function syncCastPresence(storage, {
  chat = [],
  compass = null,
  occupancy = null,
  window: windowArg,
  persist = true,
} = {}) {
  if (!autoPresenceEnabled(storage)) {
    try {
      noteHouseHealth(storage, {
        presence: { status: 'skip', reason: 'off' },
      }, { save: false });
    } catch { /* ignore */ }
    return { flipped: 0, members: [], skipped: 'off' };
  }
  let n = Number(windowArg);
  if (!Number.isFinite(n) || n < 1) {
    try {
      n = Number(storage?.getChat?.('backstage', {})?.trackers?.status?.inPlayWindow) || 10;
    } catch { n = 10; }
  }
  const mentioned = mentionedIds(storage, chat, n);
  const play = (Array.isArray(chat) ? chat : []).filter(m => m && !m.is_system);
  const hasRealTurn = play.some((m) => {
    if (m.is_user) return true;
    const sp = String(m.name || m.extra?.name || '').trim().toLowerCase();
    for (const c of storage?.getChat?.('cast', { characters: [] })?.characters || []) {
      if (c?.priority !== 'director') continue;
      const names = [c?.name, ...(c?.aliases || [])].map(x => String(x || '').trim().toLowerCase()).filter(Boolean);
      if (names.includes(sp)) return false;
    }
    return true;
  });
  let stage = compass;
  if (!stage) {
    try { stage = ensureCompass(storage?.getChat?.('backstage', {}) || {}); } catch { stage = null; }
  }
  let occ = occupancy;
  if (!occ) {
    try { occ = ensureNow(storage).doc?.occupancy; } catch { occ = null; }
  }
  const placeId = stage ? seedPlaceId(stage, occ) : '';
  const here = hereKeys(stage, placeId);
  let chars = [];
  try { chars = storage?.getChat?.('cast', { characters: [] })?.characters || []; } catch { chars = []; }

  const stances = analyzeCastSceneStances(play, chars, {
    compass: stage,
    activePlaceId: placeId,
    windowSize: Math.min(4, n),
  });
  const privyIds = new Set();
  const enteredIds = new Set();
  for (const [id, st] of stances.entries()) {
    if (st?.listening && !st?.enteredActiveRoom) {
      privyIds.add(id);
      if (st.name) privyIds.add(`name:${String(st.name).trim().toLowerCase()}`);
    }
    if (st?.enteredActiveRoom || (st?.inActiveRoom && !st?.listening && !st?.away && !st?.departed)) {
      enteredIds.add(id);
      if (st.name) enteredIds.add(`name:${String(st.name).trim().toLowerCase()}`);
    }
  }
  for (const ping of Object.values(stage?.sonar?.pings || {})) {
    if (!ping?.listening) continue;
    const id = String(ping.castId || ping.id || '').trim();
    const st = id ? stances.get(id) : null;
    if (st?.enteredActiveRoom) continue;
    if (id) privyIds.add(id);
    if (ping.name) privyIds.add(`name:${String(ping.name).trim().toLowerCase()}`);
  }

  const inPlay = new Set([...mentioned, ...here]);
  const flips = planPresenceFlips(chars, inPlay, { privyIds, enteredIds })
    .filter(row => hasRealTurn || row.to === 'inPlay' || row.to === 'privy');
  const members = [];
  for (const row of flips) {
    row.char.presence = row.to;
    row.char.updatedAt = Date.now();
    members.push({
      id: row.char.id,
      name: row.char.name,
      presence: row.to,
      priority: row.char.priority,
    });
    const who = String(row.char.name || '').trim() || 'Cast';
    const label = row.to === 'inPlay'
      ? 'in play'
      : row.to === 'privy'
        ? 'privy (listening in)'
        : 'absent';
    try {
      appendNowLedger(storage, { kind: 'presence', text: `Presence: ${who} ${label}` }, { persist: false });
    } catch { /* ignore */ }
  }
  const summary = flips.length
    ? flips.map((row) => {
      const who = String(row.char?.name || '').trim() || 'Cast';
      const from = row.from === 'inPlay' ? 'in play' : String(row.from || '');
      const to = row.to === 'inPlay' ? 'in play' : String(row.to || '');
      return `${who} ${from} → ${to}`;
    }).join('; ')
    : 'none';
  try {
    noteHouseHealth(storage, {
      presence: { status: flips.length ? 'flipped' : 'none', detail: summary },
    }, { save: false });
  } catch { /* ignore */ }
  if (members.length && persist !== false) {
    try { storage?.saveChat?.(); } catch { /* ignore */ }
  }
  return { flipped: members.length, members };
}

export function smokeCastPresencePure() {
  try {
    const rin = { id: 'rin', name: 'Rin', priority: 'foil', presence: 'absent' };
    const kai = { id: 'kai', name: 'Kai', priority: 'foil', presence: 'inPlay' };
    const gone = { id: 'gone', name: 'Gone', priority: 'supporting', presence: 'writtenOut' };
    const star = { id: 'wes', name: 'Weslie', priority: 'star', presence: 'absent' };
    const mentioned = planPresenceFlips([rin, kai, gone, star], new Set(['rin']));
    if (!mentioned.some(f => f.char.id === 'rin' && f.to === 'inPlay')) return 'mentioned absent should go in play';
    if (!mentioned.some(f => f.char.id === 'kai' && f.to === 'absent')) return 'silent in-play should go absent';
    if (mentioned.some(f => f.char.id === 'gone')) return 'written out should stay';
    if (mentioned.some(f => f.char.id === 'wes')) return 'star should never auto-change';

    const pinned = { id: 'oki', name: 'Mrs. Okisato', priority: 'supporting', presence: 'absent', presenceAuto: false };
    const pinnedFlips = planPresenceFlips([pinned], new Set(['oki']));
    if (pinnedFlips.some(f => f.char.id === 'oki')) return 'presenceAuto:false should opt a character out of auto flips';

    const bags = {
      cast: {
        characters: [
          { id: 'rin', name: 'Rin', priority: 'foil', presence: 'absent' },
          { id: 'kai', name: 'Kai', priority: 'foil', presence: 'inPlay' },
          { id: 'wes', name: 'Weslie', priority: 'star', presence: 'absent' },
        ],
      },
      now: {
        occupancy: { mode: 'compass', placeKey: 'Okisato Antiques', placeId: 'oki' },
        clock: {},
        ledger: [],
      },
      backstage: {
        trackers: { status: { inPlayWindow: 10 }, scene: {} },
        stage: {
          rooms: {
            oki: {
              id: 'oki',
              name: 'Okisato Antiques',
              occupants: [{ name: 'Rin', castId: 'rin', cell: 'C' }],
            },
          },
          sonar: { pings: {} },
        },
      },
    };
    const storage = {
      getChat(id, d = {}) {
        if (!bags[id]) bags[id] = { ...d };
        return bags[id];
      },
      saveChat() {},
    };
    const out = syncCastPresence(storage, {
      chat: [{ mes: 'Quiet shop.', is_system: false }],
      compass: bags.backstage.stage,
      occupancy: bags.now.occupancy,
    });
    const live = bags.cast.characters;
    if (live.find(c => c.id === 'rin')?.presence !== 'inPlay') return 'occupant should be in play';
    if (live.find(c => c.id === 'kai')?.presence !== 'absent') return 'non-occupant silent should be absent';
    if (live.find(c => c.id === 'wes')?.presence !== 'absent') return 'star absent should stay';
    if (!out.members.some(m => m.id === 'rin')) return 'occupant flip should be returned';
    if ((bags.now.ledger || []).some(r => /Weslie/.test(r.text))) return 'star should not ledger presence';

    const aliasBags = {
      cast: {
        characters: [
          {
            id: 'mera',
            name: 'Yokumiru Mera',
            aliases: ['Mera'],
            priority: 'supporting',
            presence: 'absent',
          },
        ],
      },
      now: { occupancy: { mode: 'compass', placeKey: '', placeId: '' }, clock: {}, ledger: [] },
      backstage: { trackers: { status: { inPlayWindow: 10 }, scene: {} }, stage: { rooms: {}, sonar: { pings: {} } } },
    };
    const aliasStorage = {
      getChat(id, d = {}) {
        if (!aliasBags[id]) aliasBags[id] = { ...d };
        return aliasBags[id];
      },
      saveChat() {},
    };
    syncCastPresence(aliasStorage, {
      chat: [{ mes: 'The camera clicked.', is_system: false }],
      compass: aliasBags.backstage.stage,
      occupancy: aliasBags.now.occupancy,
    });
    if (aliasBags.cast.characters[0].presence !== 'absent') return 'substring alias must not match camera';
    syncCastPresence(aliasStorage, {
      chat: [{ mes: 'Mera nodded.', is_system: false }],
      compass: aliasBags.backstage.stage,
      occupancy: aliasBags.now.occupancy,
    });
    if (aliasBags.cast.characters[0].presence !== 'inPlay') return 'standalone alias should put in play';

    // A name dropped several turns back (but not recently) must not keep the
    // character phantom-present for the rest of the wider inPlayWindow.
    const staleBags = {
      cast: {
        characters: [
          { id: 'oki', name: 'Mrs. Okisato', aliases: ['Kazuko'], priority: 'supporting', presence: 'inPlay' },
        ],
      },
      now: { occupancy: { mode: 'compass', placeKey: '', placeId: '' }, clock: {}, ledger: [] },
      backstage: { trackers: { status: { inPlayWindow: 10 }, scene: {} }, stage: { rooms: {}, sonar: { pings: {} } } },
    };
    const staleStorage = {
      getChat(id, d = {}) {
        if (!staleBags[id]) staleBags[id] = { ...d };
        return staleBags[id];
      },
      saveChat() {},
    };
    syncCastPresence(staleStorage, {
      chat: [
        { mes: 'I should visit Mrs. Okisato tomorrow.', is_system: false, is_user: true },
        { mes: 'Hawks nodded.', is_system: false },
        { mes: 'Weslie stretched.', is_system: false, is_user: true },
        { mes: 'Hawks shrugged.', is_system: false },
        { mes: 'Weslie yawned.', is_system: false, is_user: true },
      ],
      compass: staleBags.backstage.stage,
      occupancy: staleBags.now.occupancy,
    });
    if (staleBags.cast.characters[0].presence !== 'absent') {
      return `stale out-of-scene mention should decay to absent (got ${staleBags.cast.characters[0].presence})`;
    }

    const offBags = {
      cast: {
        autoPresence: false,
        characters: [
          { id: 'rin', name: 'Rin', priority: 'foil', presence: 'absent' },
        ],
      },
      now: { occupancy: { mode: 'compass', placeKey: 'Okisato Antiques', placeId: 'oki' }, clock: {}, ledger: [] },
      backstage: {
        trackers: { status: { inPlayWindow: 10 }, scene: {} },
        stage: {
          rooms: { oki: { id: 'oki', name: 'Okisato Antiques', occupants: [{ name: 'Rin', castId: 'rin', cell: 'C' }] } },
          sonar: { pings: {} },
        },
      },
    };
    const offStorage = {
      getChat(id, d = {}) {
        if (!offBags[id]) offBags[id] = { ...d };
        return offBags[id];
      },
      saveChat() {},
    };
    const offOut = syncCastPresence(offStorage, {
      chat: [{ mes: 'Rin waved.', is_system: false }],
      compass: offBags.backstage.stage,
      occupancy: offBags.now.occupancy,
    });
    if (offBags.cast.characters[0].presence !== 'absent') return 'auto off should not flip occupant';
    if (offOut.flipped !== 0 || offOut.skipped !== 'off') return 'auto off should skip';

    const parkBags = {
      cast: {
        characters: [
          { id: 'rin', name: 'Rin', priority: 'foil', presence: 'absent' },
          { id: 'kai', name: 'Kai', priority: 'foil', presence: 'inPlay' },
        ],
      },
      now: { occupancy: { mode: 'compass', placeKey: 'Okisato Antiques', placeId: 'oki' }, clock: {}, ledger: [] },
      backstage: {
        trackers: { status: { inPlayWindow: 10 }, scene: {} },
        stage: {
          rooms: {
            oki: {
              id: 'oki',
              name: 'Okisato Antiques',
              occupants: [
                { name: 'Rin', castId: 'rin', cell: 'C', description: 'parked' },
                { name: 'Kai', castId: 'kai', cell: 'N', description: 'sonar · shop' },
              ],
            },
          },
          sonar: {
            pings: {
              rin: { name: 'Rin', castId: 'rin', placeId: 'oki', cell: 'C', locked: true },
            },
          },
        },
      },
    };
    const parkStorage = {
      getChat(id, d = {}) {
        if (!parkBags[id]) parkBags[id] = { ...d };
        return parkBags[id];
      },
      saveChat() {},
    };
    syncCastPresence(parkStorage, {
      chat: [{ mes: 'Quiet shop.', is_system: false }],
      compass: parkBags.backstage.stage,
      occupancy: parkBags.now.occupancy,
    });
    if (parkBags.cast.characters.find(c => c.id === 'rin')?.presence !== 'absent') {
      return 'parked occupant must not resurrect absent';
    }
    if (parkBags.cast.characters.find(c => c.id === 'kai')?.presence !== 'absent') {
      return 'sonar-soft occupant must not keep silent in play';
    }

    const pingBags = {
      cast: {
        characters: [
          { id: 'natsu', name: 'Natsu', priority: 'foil', presence: 'absent' },
        ],
      },
      now: { occupancy: { mode: 'compass', placeKey: 'Okisato Antiques', placeId: 'oki' }, clock: {}, ledger: [] },
      backstage: {
        trackers: { status: { inPlayWindow: 10 }, scene: {} },
        stage: {
          rooms: { oki: { id: 'oki', name: 'Okisato Antiques', occupants: [] } },
          sonar: {
            pings: {
              natsu: { name: 'Natsu', castId: 'natsu', placeId: 'oki', cell: 'C', locked: false },
            },
          },
        },
      },
    };
    const pingStorage = {
      getChat(id, d = {}) {
        if (!pingBags[id]) pingBags[id] = { ...d };
        return pingBags[id];
      },
      saveChat() {},
    };
    syncCastPresence(pingStorage, {
      chat: [{ mes: 'Quiet shop.', is_system: false }],
      compass: pingBags.backstage.stage,
      occupancy: pingBags.now.occupancy,
    });
    if (pingBags.cast.characters[0].presence !== 'inPlay') return 'unlocked sonar ping at Now should put in play';

    const privyBags = {
      cast: {
        characters: [
          { id: 'hawks', name: 'Hawks', priority: 'foil', presence: 'inPlay' },
        ],
      },
      now: { occupancy: { mode: 'compass', placeKey: 'Break Room', placeId: 'brk' }, clock: {}, ledger: [] },
      backstage: {
        trackers: { status: { inPlayWindow: 10 }, scene: {} },
        stage: {
          rooms: { brk: { id: 'brk', name: 'Break Room', occupants: [] } },
          sonar: { pings: {} },
        },
      },
    };
    const privyStorage = {
      getChat(id, d = {}) {
        if (!privyBags[id]) privyBags[id] = { ...d };
        return privyBags[id];
      },
      saveChat() {},
    };
    syncCastPresence(privyStorage, {
      chat: [{
        mes: 'Hawks left through the front door and wandered to a crepe kiosk, sending a covert feather into the service corridor.',
        is_system: false,
      }],
      compass: privyBags.backstage.stage,
      occupancy: privyBags.now.occupancy,
    });
    if (privyBags.cast.characters[0].presence !== 'privy') {
      return `covert feather should flip Hawks to privy (got ${privyBags.cast.characters[0].presence})`;
    }
    syncCastPresence(privyStorage, {
      chat: [{
        mes: 'Hawks stepped back into the Break Room.',
        is_system: false,
      }],
      compass: privyBags.backstage.stage,
      occupancy: privyBags.now.occupancy,
    });
    if (privyBags.cast.characters[0].presence !== 'inPlay') {
      return `re-entering room should flip Hawks back to inPlay (got ${privyBags.cast.characters[0].presence})`;
    }
    privyBags.cast.characters[0].presence = 'privy';
    privyBags.now.occupancy = { mode: 'compass', placeKey: 'Service Corridor', placeId: 'cor' };
    privyBags.backstage.stage.rooms.cor = { id: 'cor', name: 'Service Corridor', occupants: [] };
    syncCastPresence(privyStorage, {
      chat: [{
        mes: 'Hawks slipped inside. The delivery hallway reeked of wet cardboard. Hawks said, "Wait up, kid."',
        is_system: false,
      }],
      compass: privyBags.backstage.stage,
      occupancy: privyBags.now.occupancy,
    });
    if (privyBags.cast.characters[0].presence !== 'inPlay') {
      return `slipped inside + face-to-face speech should flip Hawks from privy to inPlay (got ${privyBags.cast.characters[0].presence})`;
    }
    return '';
  } catch (err) {
    return err?.message || String(err);
  }
}
