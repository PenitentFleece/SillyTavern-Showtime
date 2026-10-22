// Named outfit folders: saved combos of existing kit pieces.
// Wearing stays per-item; inject infers the best match.

export const OUTFIT_TYPES = Object.freeze([
  { id: 'uniform', label: 'Uniform' },
  { id: 'formal', label: 'Formal' },
  { id: 'casual', label: 'Casual' },
  { id: 'athletic', label: 'Athletic' },
  { id: 'swim', label: 'Swim' },
  { id: 'underwear', label: 'Underwear' },
  { id: 'pajama', label: 'Pajama' },
  { id: 'costume', label: 'Costume' },
]);

const TYPE_IDS = new Set(OUTFIT_TYPES.map(t => t.id));
const TYPE_RANK = Object.freeze({
  uniform: 0,
  costume: 1,
  formal: 2,
  athletic: 3,
  swim: 4,
  underwear: 5,
  pajama: 6,
  casual: 7,
});

export function outfitTypeMeta(id) {
  return OUTFIT_TYPES.find(t => t.id === id) || OUTFIT_TYPES.find(t => t.id === 'casual');
}

/** Worn clothes are the wardrobe list. Nothing in it means nude. */
export function isWearingNothing(wardrobe) {
  return !(wardrobe || []).some(item => String(item?.name || item?.id || '').trim());
}

export function nudeWearLine(name) {
  const who = String(name || '').trim() || 'They';
  return `${who} is nude`;
}

export function normalizeOutfit(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || '').trim();
  const title = String(raw.title || raw.name || '').trim();
  if (!id && !title) return null;
  const type = TYPE_IDS.has(raw.type) ? raw.type : 'casual';
  const seen = new Set();
  const partIds = [];
  for (const pid of Array.isArray(raw.partIds) ? raw.partIds : []) {
    const key = String(pid || '').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    partIds.push(key);
  }
  return {
    id: id || `out_${Math.random().toString(36).slice(2, 10)}`,
    title: title || 'Outfit',
    description: String(raw.description || '').trim(),
    type,
    partIds,
  };
}

export function normalizeOutfits(list) {
  return (Array.isArray(list) ? list : []).map(normalizeOutfit).filter(Boolean);
}

const OUTFIT_PART_CAP = 8;

/** One closet look from a profile audit. Empty or untitled drafts are dropped. */
export function outfitFromProfileDraft(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const title = String(src.title || src.name || '').trim().slice(0, 80);
  if (!title) return null;
  const type = TYPE_IDS.has(src.type) ? src.type : 'casual';
  const description = String(src.description || '').trim().slice(0, 240);
  const seen = new Set();
  const partNames = [];
  const list = Array.isArray(src.parts) ? src.parts : [];
  for (const row of list) {
    const name = String(
      typeof row === 'string' ? row : (row?.name || row?.title || ''),
    ).trim().slice(0, 80);
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    partNames.push(name);
    if (partNames.length >= OUTFIT_PART_CAP) break;
  }
  if (!partNames.length) return null;
  return { title, type, description, partNames };
}

/** Worn plus owned-but-off pieces (props / carried) for part picking and name lookup. */
export function kitOwnedItems(wardrobe, props) {
  const seen = new Set();
  const out = [];
  for (const it of [...(wardrobe || []), ...(props || [])]) {
    if (!it?.id || seen.has(it.id)) continue;
    seen.add(it.id);
    out.push(it);
  }
  return out;
}

const WORN_OR_WORSE = new Set(['worn', 'damaged', 'broken', 'ruined']);

function pieceName(item) {
  return String(item?.name || '').trim().toLowerCase();
}

export function isConditionUnkempt(item) {
  return WORN_OR_WORSE.has(String(item?.condition || '').trim().toLowerCase());
}

export function matchOutfit(outfit, wornItems, ownedById) {
  const rec = normalizeOutfit(outfit);
  if (!rec) return null;
  const worn = Array.isArray(wornItems) ? wornItems : [];
  const wornIds = new Set(worn.map(x => x?.id).filter(Boolean));
  const wornByName = new Map();
  for (const item of worn) {
    const key = pieceName(item);
    if (key && !wornByName.has(key)) wornByName.set(key, item);
  }
  const lookup = ownedById instanceof Map ? ownedById : new Map();
  const nameOf = (id) => lookup.get(id)?.name || worn.find(w => w.id === id)?.name || 'Missing piece';
  const on = [];
  const missing = [];
  const partNames = new Set();
  for (const pid of rec.partIds) {
    const name = nameOf(pid);
    const key = pieceName({ name });
    if (key && key !== 'missing piece') partNames.add(key);
    const live = wornIds.has(pid) ? worn.find(w => w.id === pid) : wornByName.get(key);
    const row = { id: pid, name, item: live || lookup.get(pid) || null, live: live || null };
    if (live) on.push(row);
    else missing.push(row);
  }
  const extras = worn.filter(w => {
    if (!w?.id || rec.partIds.includes(w.id)) return false;
    const key = pieceName(w);
    return !key || !partNames.has(key);
  });
  const total = rec.partIds.length;
  const onCount = on.length;
  const ragged = on.some(row => isConditionUnkempt(row.live));
  return {
    outfit: rec,
    on,
    missing,
    extras,
    complete: total > 0 && missing.length === 0 && !ragged,
    unkempt: onCount > 0 && (missing.length > 0 || ragged),
    ragged,
    ratio: total ? onCount / total : 0,
    onCount,
  };
}

/** Pieces of this look that are not already in the wardrobe by name. */
export function outfitPartsToWear(outfit, wornItems, ownedById) {
  const rec = normalizeOutfit(outfit);
  if (!rec) return [];
  const worn = Array.isArray(wornItems) ? wornItems : [];
  const wornNames = new Set(worn.map(pieceName).filter(Boolean));
  const lookup = ownedById instanceof Map ? ownedById : new Map();
  const adds = [];
  const seen = new Set();
  for (const pid of rec.partIds) {
    const item = lookup.get(pid) || worn.find(w => w?.id === pid) || null;
    const name = String(item?.name || '').trim();
    const key = name.toLowerCase();
    if (!name || wornNames.has(key) || seen.has(key)) continue;
    seen.add(key);
    const description = String(item?.description || '').trim();
    adds.push(description ? { name, description } : { name });
  }
  return adds;
}

const WEAR_VERB = '(?:am\\s+wearing|is\\s+wearing|was\\s+wearing|\'m\\s+wearing|wearing|wore|wear|put(?:s|ting)?\\s+on|changed\\s+into|change[sd]?\\s+into|slipped\\s+into|slip(?:s|ped)?\\s+into|got\\s+dressed\\s+in|get(?:s|ting)?\\s+dressed\\s+in)';

function escapeWear(text) {
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function wearSubject(sentence, title) {
  const titleRe = new RegExp(`(?:the\\s+|my\\s+|her\\s+|his\\s+|their\\s+|a\\s+|an\\s+)?${escapeWear(title)}\\b`, 'i');
  const hit = titleRe.exec(sentence);
  if (!hit) return '';
  let before = sentence.slice(0, hit.index).replace(/\b(?:the|my|her|his|their|a|an)\s*$/i, '').trim();
  const verb = before.match(new RegExp(`(?:${WEAR_VERB})\\s*$`, 'i'));
  let left = '';
  if (verb) {
    left = before.slice(0, verb.index);
  } else {
    const put = before.match(/\b(put|puts|putting)\s*$/i);
    const after = sentence.slice(hit.index + hit[0].length);
    if (!put || !/^\s+on\b/i.test(after)) return '';
    if (/^\s+on\s+(?:the\s+|a\s+|my\s+|her\s+|his\s+)?(?:bed|chair|hook|table|floor|rack|hanger|shelf|couch|sofa)\b/i.test(after)) return '';
    left = before.slice(0, put.index);
  }
  const tokens = left.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return '';
  const last = tokens[tokens.length - 1].replace(/[^A-Za-z']/g, '');
  if (/^to$/i.test(last)) return '';
  return last;
}

function subjectIsSpeaker(subject, speaker) {
  const s = String(subject || '').toLowerCase();
  if (!s) return false;
  if (s === 'i' || s === "i'm" || s === 'im') return true;
  if (s === 'she' || s === 'he' || s === 'they') return true;
  const parts = String(speaker || '').trim().toLowerCase().split(/\s+/).filter(p => p.length >= 3);
  return parts.includes(s);
}

function wearIsNegated(sentence, title) {
  const t = `(?:the\\s+|my\\s+|her\\s+|his\\s+|their\\s+)?${escapeWear(title)}`;
  const neg = "(?:not|n't|never)";
  return new RegExp(
    `\\b${neg}\\b(?:\\s+\\w+){0,5}\\s+(?:wearing|wore|wear|put(?:ting)?\\s+on|changed\\s+into|slipped\\s+into|dressed\\s+in)\\b(?:\\s+\\w+){0,4}\\s+${t}\\b`,
    'i',
  ).test(sentence);
}

function wearIsTakeOff(sentence, title) {
  const t = `(?:the\\s+|my\\s+|her\\s+|his\\s+|their\\s+)?${escapeWear(title)}`;
  return new RegExp(`\\b(?:take|takes|took|taking|pull|pulls|pulled)\\s+off\\b(?:\\s+\\w+){0,6}\\s+${t}\\b`, 'i').test(sentence);
}

/**
 * The speaker's own closet title, when this sentence says they are wearing it.
 * Another person as the wearer, a bare mention, negation, and taking it off return ''.
 */
export function readOutfitWearSentence(text, { speaker = '', titles = [] } = {}) {
  const who = String(speaker || '').trim();
  const list = [...(titles || [])]
    .map(t => String(t || '').trim())
    .filter(t => t.length >= 2)
    .sort((a, b) => b.length - a.length);
  if (!who || !list.length) return '';
  const sentences = String(text || '').split(/(?<=[.!?])\s+|\n+/);
  for (const sentence of sentences) {
    const line = sentence.replace(/\s+/g, ' ').trim();
    if (!line) continue;
    for (const title of list) {
      if (!new RegExp(`\\b${escapeWear(title)}\\b`, 'i').test(line)) continue;
      if (wearIsNegated(line, title) || wearIsTakeOff(line, title)) continue;
      if (!subjectIsSpeaker(wearSubject(line, title), who)) continue;
      return title;
    }
  }
  return '';
}

/** Add this look's missing pieces onto that person's wardrobe bag. Names already listed stay. */
export function mergeWardrobeAdds(castRows, seed) {
  const adds = Array.isArray(seed?.adds) ? seed.adds : [];
  const name = String(seed?.name || '').trim();
  const rows = (Array.isArray(castRows) ? castRows : []).map(r => ({ ...r }));
  if (!name || !adds.length) return rows;
  let row = rows.find(r => String(r?.name || '').trim().toLowerCase() === name.toLowerCase());
  if (!row) {
    row = { name };
    rows.push(row);
  }
  const bag = row.wardrobe;
  const addList = Array.isArray(bag)
    ? bag.slice()
    : (Array.isArray(bag?.add) ? bag.add.slice() : []);
  const have = new Set(addList.map(x => String(typeof x === 'string' ? x : x?.name || '').trim().toLowerCase()).filter(Boolean));
  for (const it of adds) {
    const n = String(it?.name || it || '').trim();
    const key = n.toLowerCase();
    if (!n || have.has(key)) continue;
    have.add(key);
    const description = String(it?.description || '').trim();
    addList.push(description ? { name: n, description } : { name: n });
  }
  row.wardrobe = Array.isArray(bag)
    ? addList
    : { ...(bag && typeof bag === 'object' ? bag : {}), add: addList, update: bag?.update || [], remove: bag?.remove || [] };
  return rows;
}

/** Folded closet mark: Worn, Unkempt, or Off, plus how many pieces are on. */
export function outfitWearMark(match) {
  const total = match?.outfit?.partIds?.length || 0;
  const on = match?.onCount || 0;
  const word = on === 0 ? 'Off' : (match?.complete ? 'Worn' : 'Unkempt');
  return `${word} - (${on}/${total})`;
}

export function pickPrimaryOutfit(outfits, wornItems, ownedItems) {
  const owned = Array.isArray(ownedItems) ? ownedItems : [];
  const byId = new Map(owned.map(x => [x.id, x]));
  const matches = normalizeOutfits(outfits)
    .map(o => matchOutfit(o, wornItems, byId))
    .filter(m => m && m.onCount > 0);
  matches.sort((a, b) => {
    if (b.ratio !== a.ratio) return b.ratio - a.ratio;
    if (b.onCount !== a.onCount) return b.onCount - a.onCount;
    return (TYPE_RANK[a.outfit.type] ?? 9) - (TYPE_RANK[b.outfit.type] ?? 9);
  });
  return matches[0] || null;
}

function extraNote(extras) {
  const names = (extras || []).map(x => x.name).filter(Boolean).slice(0, 3);
  if (!names.length) return '';
  if (names.length === 1) return `mixed with ${names[0]}`;
  return `mixed with ${names.join(', ')}`;
}

/** Compact kit slate or fuller wardrobe-trigger line. */
export function formatOutfitLook(match, { compact = false } = {}) {
  if (!match?.outfit) return '';
  const title = match.outfit.title || 'Outfit';
  const type = outfitTypeMeta(match.outfit.type).label;
  const mixed = extraNote(match.extras);
  const miss = match.missing.map(x => x.name).filter(Boolean);
  const on = match.on.map(x => x.name).filter(Boolean);

  if (compact) {
    if (match.complete) {
      return mixed ? `${title}, ${mixed}` : title;
    }
    let s = `${title}, unkempt`;
    if (miss.length) s += ` — missing ${miss.slice(0, 3).join(', ')}`;
    if (mixed) s += `; ${mixed}`;
    return s;
  }

  const bits = [];
  if (match.complete) {
    bits.push(`${title} (${type})`);
    if (on.length) bits.push(on.join(', '));
  } else {
    bits.push(`${title} (${type}), unkempt`);
    if (on.length) bits.push(on.join(', '));
    if (miss.length) bits.push(`missing ${miss.join(', ')}`);
  }
  if (mixed) bits.push(mixed);
  return bits.join(' — ');
}

export function smokeWardrobeOutfitsPure() {
  const shirt = { id: 's', name: 'blouse' };
  const vest = { id: 'v', name: 'vest' };
  const tie = { id: 't', name: 'tie' };
  const coat = { id: 'c', name: 'coat' };
  const uniform = {
    id: 'o1', title: 'School Uniform', type: 'uniform',
    partIds: ['s', 'v', 't'],
  };
  const owned = [shirt, vest, tie, coat];
  const partial = pickPrimaryOutfit([uniform], [shirt, vest, coat], owned);
  if (!partial?.unkempt) return 'missing tie should be unkempt';
  const look = formatOutfitLook(partial, { compact: true });
  if (!/unkempt/.test(look) || !/tie/.test(look)) return 'compact look should name missing tie';
  if (!/mixed with coat/.test(look)) return 'extras should be a mixed note';
  const full = pickPrimaryOutfit([uniform], [shirt, vest, tie], owned);
  if (!full?.complete) return 'all parts on should be complete';
  if (/unkempt/.test(formatOutfitLook(full, { compact: true }))) return 'complete look must not say unkempt';
  const draft = outfitFromProfileDraft({
    title: 'Hero costume',
    type: 'nope',
    parts: ['leotard', { name: 'Leotard' }, 'boots', ''],
  });
  if (!draft || draft.type !== 'casual') return 'unknown outfit type should be casual';
  if (draft.partNames.join('|') !== 'leotard|boots') return 'duplicate and blank parts should drop';
  if (outfitFromProfileDraft({ title: 'Bare', parts: [] })) return 'an outfit needs parts';
  const swim = outfitFromProfileDraft({ title: 'Beach', type: 'swim', parts: ['suit'] });
  if (swim?.type !== 'swim') return 'swim should stay a clothing type';
  if (!isWearingNothing([])) return 'an empty wardrobe is nude';
  if (isWearingNothing([{ name: 'robe' }])) return 'a worn piece is not nude';
  if (nudeWearLine('Mirko') !== 'Mirko is nude') return 'nude line';
  const named = matchOutfit(
    { id: 'o2', title: 'Hero', type: 'uniform', partIds: ['shelf-boots'] },
    [{ id: 'live-boots', name: 'Tactical Boots', condition: 'fine' }],
    new Map([['shelf-boots', { id: 'shelf-boots', name: 'Tactical Boots' }]]),
  );
  if (!named?.complete || named.onCount !== 1) return 'the same name should count as worn';
  if (outfitWearMark(named) !== 'Worn - (1/1)') return 'full fine look should read worn';
  const ragged = matchOutfit(
    { id: 'o3', title: 'Hero', type: 'uniform', partIds: ['shelf-boots'] },
    [{ id: 'live-boots', name: 'Tactical Boots', condition: 'worn' }],
    new Map([['shelf-boots', { id: 'shelf-boots', name: 'Tactical Boots' }]]),
  );
  if (!ragged?.unkempt || ragged.complete) return 'worn condition should make the look unkempt';
  if (outfitWearMark(ragged) !== 'Unkempt - (1/1)') return 'ragged mark';
  const bare = matchOutfit(
    { id: 'o4', title: 'Hero', type: 'uniform', partIds: ['shelf-boots'] },
    [],
    new Map([['shelf-boots', { id: 'shelf-boots', name: 'Tactical Boots' }]]),
  );
  if (outfitWearMark(bare) !== 'Off - (0/1)') return 'nothing on should read off';
  const titles = ['Hero Gear', 'Hero'];
  const wear = (line) => readOutfitWearSentence(line, { speaker: 'Hawks', titles });
  if (wear('Hawks changed into Hero Gear') !== 'Hero Gear') return 'own name should wear the longer title';
  if (wear('She put on Hero Gear') !== 'Hero Gear') return 'pronoun in the speaker message should wear';
  if (wear('I changed into Hero Gear') !== 'Hero Gear') return 'first person should wear';
  if (wear("I'm wearing the Hero Gear") !== 'Hero Gear') return 'article before the title should still match';
  if (wear('the Hero Gear is in the closet')) return 'a bare mention is not a wear claim';
  if (wear('remember Hero Gear')) return 'remembering the look is not wearing it';
  if (wear('Mirko put on Hero Gear')) return 'another person wearing it does not dress the speaker';
  if (wear('I told her to put on Hero Gear')) return 'telling someone else does not dress the speaker';
  if (wear("I'm not wearing Hero Gear")) return 'negation is not a wear claim';
  if (wear('I took off Hero Gear')) return 'taking it off is not putting it on';
  const shelf = new Map([['chip', { id: 'chip', name: 'Visor', description: 'gold visor' }]]);
  const adds = outfitPartsToWear(
    { id: 'og', title: 'Hero Gear', partIds: ['chip', 'boots'] },
    [{ id: 'boots', name: 'Boots' }],
    new Map([...shelf, ['boots', { id: 'boots', name: 'Boots' }]]),
  );
  if (adds.length !== 1 || adds[0].name !== 'Visor' || adds[0].description !== 'gold visor') {
    return 'only the unworn shelf piece should be added';
  }
  const merged = mergeWardrobeAdds(
    [{ name: 'Hawks', wardrobe: { add: [{ name: 'Boots' }], update: [], remove: [] } }],
    { name: 'Hawks', adds },
  );
  const bag = merged[0].wardrobe.add.map(x => x.name).join('|');
  if (bag !== 'Boots|Visor') return 'wardrobe adds should keep pieces already listed';
  return '';
}
