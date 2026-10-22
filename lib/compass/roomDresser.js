// Narrative room dresser — extracts room items (fixtures, furniture, clutter,
// containers, surfaces, nested items) and room/door cues from narrative prose
// and populates compass rooms so users can inspect and manually sort them.

import {
  CELLS,
  OPPOSITE_WALL,
  isSuiteHostKind,
  isLoadableKind,
  normalizeCell,
  normalizeCellLayer,
} from './schema.js';
import {
  addItem,
  updateItem,
  createAndStoreRoom,
  getPlace,
  listSuiteChildren,
  addLink,
  addOpening,
  updateOpening,
  setPlaceDescription,
} from './state.js';

const NUMBER_WORDS = Object.freeze({
  one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, a: 1, an: 1,
});

const CARDINAL_MAP = Object.freeze({
  north: 'N', northern: 'N',
  south: 'S', southern: 'S',
  east: 'E', eastern: 'E',
  west: 'W', western: 'W',
  northwest: 'NW', northeastern: 'NE', northeast: 'NE',
  southwest: 'SW', southeastern: 'SE', southeast: 'SE',
  center: 'C', middle: 'C', central: 'C',
});

const ROOM_NOUN_RE = /\b(break\s+room|storage\s+room|back\s+room|display\s+floor|sales\s+floor|shop\s+floor|main\s+floor|showroom|storefront|waiting\s+room|living\s+room|dining\s+room|sitting\s+room|laundry\s+room|locker\s+room|boiler\s+room|rec\s+room|workroom|workshop|storage|office|study|kitchen|kitchenette|bathroom|washroom|restroom|lavatory|bedroom|hallway|corridor|foyer|entryway|lobby|vestibule|parlor|cellar|basement|attic|loft|closet|pantry|vault|balcony|porch|patio|courtyard|terrace|garage|shed|ward|alcove|chamber|room)\b/i;

const FIXTURE_HEAD_RE = /\b(fluorescent\s+lights?|ceiling\s+lights?|overhead\s+lights?|light\s+fixtures?|strip\s+lights?|pendant\s+lights?|chandeliers?|sconces?|skylights?|neon\s+signs?|ceiling\s+fans?|exhaust\s+fans?|vents?|air\s+vents?|grates?|radiators?|baseboards?|wainscoting|moldings?|wall\s+paneling|hardwood(?:\s+floors?|\s+flooring)?|floorboards?|tile\s+floors?|linoleum(?:\s+floors?)?|carpet(?:ing)?|tatami(?:\s+mats?)?|concrete\s+floors?|stone\s+floors?|sinks?|washbasins?|faucets?|taps?|drains?|toilets?|urinals?|bathtubs?|tubs?|showers?|fireplaces?|hearths?|mantels?|furnaces?|boilers?|water\s+heaters?|fuse\s+box(?:es)?|breaker\s+panels?|circuit\s+breakers?|thermostats?|light\s+switch(?:es)?|outlets?|windowpanes?|window\s+sills?|windowsills?|shutters?|blinds?|counters?\s+sink)\b/i;

const FURNITURE_HEAD_RE = /\b(worktables?|workbench(?:es)?|small\s+tables?|coffee\s+tables?|dining\s+tables?|side\s+tables?|end\s+tables?|folding\s+tables?|tables?|desks?|nightstands?|counters?|countertops?|kitchen\s+islands?|islands?|bars?|floor-to-ceiling\s+shelves|shelves|shelving(?:\s+units?)?|shelf|bookshelves|bookcases?|display\s+cases?|showcases?|glass\s+cases?|curio\s+cabinets?|filing\s+cabinets?|medicine\s+cabinets?|cabinets?|cupboards?|wardrobes?|armoires?|dressers?|bureaus?|chests?\s+of\s+drawers|lockers?|racks?|coat\s+racks?|display\s+racks?|stands?|pedestals?|safes?|chairs?|armchairs?|folding\s+chairs?|swivel\s+chairs?|stools?|barstools?|benches?|sofas?|couches?|loveseats?|booths?|recliners?|beds?|bunks?|cots?|futons?|mattress(?:es)?|fridges?|refrigerators?|freezers?|stoves?|ovens?|microwaves?|hotplates?|water\s+coolers?|vending\s+machines?|washing\s+machines?|dryers?|cash\s+registers?)\b/i;

const CONTAINER_HEAD_RE = /\b(boxes|box|crates?|bins?|plastic\s+bins?|baskets?|buckets?|pails?|trays?|cartons?|totes?|bags?|sacks?|pouches?|suitcases?|trunks?|chests?|jars?|canisters?|tins?|folders?|envelopes?|cases?|caddies|caddy|drawers?)\b/i;

const CONSUMABLE_RE = /\b(tea|barley\s+tea|green\s+tea|black\s+tea|coffee|espresso|latte|cocoa|water|juice|soda|cola|milk|wine|beer|ale|whiskey|bourbon|sake|shochu|gin|rum|vodka|broth|soup|stew|ramen|udon|noodles?|rice|bread|toast|sandwich(?:es)?|pastry|pastries|buns?|cakes?|cookies?|biscuits?|fruit|apples?|oranges?|snacks?|meals?|food|candy|mints?|gum|cigarettes?|cigars?|pills?|tablets?|capsules?|medicine|tonic|mug\s+of\s+\w+|cup\s+of\s+\w+|glass\s+of\s+\w+|bottle\s+of\s+\w+|can\s+of\s+\w+|pot\s+of\s+\w+|bowl\s+of\s+\w+|plate\s+of\s+\w+)\b/i;

const USABLE_RE = /\b(keys?|keycards?|padlocks?|locks?|flashlights?|torches?|lanterns?|lighters?|matches|scissors|shears|knives|knife|daggers?|blades?|hammers?|mallets?|screwdrivers?|wrench(?:es)?|pliers|saws?|drills?|soldering\s+irons?|loupes?|magnifying\s+glass(?:es)?|scales?|calipers?|tweezers|tongs|brushes?|rags?|cloths?|sponges?|brooms?|mops?|usters?|polish|oil|mineral\s+oil|solvents?|bleach|soap|detergent|markers?|pens?|pencils?|chalk|tape|glue|twine|string|rope|wire|cords?|cables?|chargers?|phones?|telephones?|radios?|walkie-talkies?|cameras?|clocks?|watches|compass(?:es)?|umbrellas?|first-aid\s+kits?|bandages?)\b/i;

const WEARABLE_RE = /\b(coats?|jackets?|windbreakers?|hoodies?|sweaters?|cardigans?|vests?|waistcoats?|shirts?|blouses?|t-shirts?|tunics?|aprons?|robes?|kimonos?|yukatas?|suits?|blazers?|trousers|pants|jeans|slacks|shorts|skirts?|dresses?|gowns?|gloves?|mittens?|hats?|caps?|berets?|helmets?|scarves|scarf|ties?|neckties?|belts?|boots?|shoes?|sneakers?|sandals?|slippers?|socks?|stockings?|glasses|spectacles|goggles|sunglasses|earrings?|rings?|necklaces?|pendants?|bracelets?|brooches?|hairpins?)\b/i;

const PHYSICAL_CLUTTER_RE = /\b(mugs?|cups?|teacups?|saucers?|glasses|tumblers?|goblets?|bottles?|flasks?|cans?|pitchers?|jugs?|carafes?|teapots?|kettles?|pots?|pans?|skillets?|bowls?|sugar\s+bowls?|plates?|platters?|dishes|trays?|spoons?|teaspoons?|tablespoons?|forks?|knives|cutlery|silverware|utensils?|chopsticks|napkins?|coasters?|ashtrays?|newspapers?|papers?|newsprint|magazines?|journals?|ledgers?|notebooks?|notepads?|clipboards?|books?|volumes?|tomes?|manuals?|catalogs?|scrolls?|maps?|charts?|letters?|notes?|memos?|receipts?|invoices?|tickets?|labels?|tags?|cards?|postcards?|photographs?|photos?|polaroids?|pictures?|paintings?|portraits?|frames?|posters?|signs?|plaques?|calendars?|clocks?|lamps?|desk\s+lamps?|lanterns?|candles?|candlesticks?|vases?|urns?|pots?|planters?|plants?|ferns?|flowers?|statues?|figurines?|busts?|sculptures?|ornaments?|trinkets?|curios?|antiques?|coins?|medals?|tokens?|bells?|mirrors?|hand\s+mirrors?|boxes|bins?|crates?|baskets?|buckets?|bags?|sacks?|towels?|blankets?|pillows?|cushions?|rugs?|mats?|curtains?|drapes?|trash|garbage|cardboard)\b/i;

const NON_ITEM_PHRASE_RE = /^(?:a\s+beat(?:\s+of\s+\w+)?|the\s+beat|quiet|silence|stillness|darkness|shadows?|light|a\s+sliver\s+of\s+light|sliver\s+of\s+light|the\s+low\s+murmur(?:\s+of\s+voices)?|low\s+murmur(?:\s+of\s+voices)?|murmur(?:\s+of\s+voices)?|voices?|a\s+voice|[\w'’]+\s+voice|footsteps?|steps?|sound|noise|echo(?:es)?|smell|a\s+heavier\s+smell|heavier\s+smell|scent|odor|stench|aroma|air|draft|breeze|warmth|chill|cold|heat|faint\s+chemical\s+edge(?:\s+of\s+\w+)?|chemical\s+edge(?:\s+of\s+\w+)?|the\s+crack|a\s+crack|directions?|a\s+man|the\s+man|a\s+woman|the\s+woman|someone|anyone|nobody|nothing|everything|something|it|they|he|she|we|you|i)$/i;

const CHARACTER_MOTION_SUBJECT_RE = /\b(?:boots?|shoes?|heels?|footsteps?|feet|hands?|fingers?|eyes?|voice|breath|shadow|silhouette)\s+(?:shifted|stepped|walked|paced|creaked|scraped|scuffed|clicked|echoed|came|rose|fell|dropped|drifted|carried|pitched)\b/i;

function cleanPhrase(raw) {
  return String(raw || '')
    .replace(/^[\s,.;:—–-]+|[\s,.;:—–-]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripLeadingArticle(raw) {
  return cleanPhrase(raw).replace(/^(?:the|a|an|some|this|that|these|those)\s+/i, '').trim();
}

function parseLeadingQty(raw) {
  const s = cleanPhrase(raw);
  const m = s.match(/^(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d+)\s+(.+)$/i);
  if (!m) return { qty: 0, rest: s };
  const word = m[1].toLowerCase();
  const n = NUMBER_WORDS[word] ?? Number(m[1]);
  return {
    qty: Number.isFinite(n) && n > 1 ? n : 0,
    rest: m[2].trim(),
  };
}

export function inferItemCondition(text) {
  const hay = String(text || '');
  if (/\b(ruined|destroyed|charred|rotted|pulverized)\b/i.test(hay)) return 'ruined';
  if (/\b(broken|shattered|smashed|snapped|busted)\b/i.test(hay)) return 'broken';
  if (/\b(damaged|cracked|dented|stained|torn|bent|scorched|flickering|buzzing|warped)\b/i.test(hay)) return 'damaged';
  if (/\b(tarnished|worn|faded|weathered|scuffed|frayed|rusty|rusted|chipped|aged|old|stale|cold|half-empty|dusty|peeling|threadbare)\b/i.test(hay)) return 'worn';
  if (/\b(pristine|gleaming|polished|brand-new|immaculate|spotless|mint)\b/i.test(hay)) return 'pristine';
  return 'fine';
}

export function classifyNarrativePiece(name, contextText = '') {
  const n = stripLeadingArticle(name);
  const low = n.toLowerCase();
  const full = `${n} ${contextText}`.trim();

  // Check furniture first so "floor-to-ceiling shelves" or "small table" aren't misread as fixtures
  if (FURNITURE_HEAD_RE.test(low)) {
    const isSeatingOrBed = /\b(chairs?|armchairs?|stools?|barstools?|benches?|sofas?|couches?|loveseats?|booths?|recliners?|beds?|bunks?|cots?|futons?|mattress(?:es)?)\b/i.test(low);
    const isMultiSeat = /\b(benches?|sofas?|couches?|loveseats?|booths?|beds?)\b/i.test(low);
    const isOpenSurface = /\b(tables?|worktables?|workbench(?:es)?|desks?|nightstands?|counters?|countertops?|islands?|bars?|shelves|shelving|shelf|bookshelves|bookcases?|display\s+cases?|showcases?|glass\s+cases?|racks?|stands?|pedestals?)\b/i.test(low);
    const isClosedStorage = /\b(cabinets?|cupboards?|wardrobes?|armoires?|dressers?|bureaus?|chests?|lockers?|safes?|fridges?|refrigerators?|freezers?|ovens?|microwaves?)\b/i.test(low)
      && !/\b(display\s+cases?|showcases?|glass\s+cases?)\b/i.test(low);
    return {
      layer: 'furniture',
      kind: 'item',
      category: 'misc',
      condition: inferItemCondition(full),
      occupiable: isSeatingOrBed,
      maxOccupancy: isSeatingOrBed ? (isMultiSeat ? 2 : 1) : 0,
      contains: isOpenSurface || isClosedStorage,
      contentsVisible: isClosedStorage ? 'inside' : 'out',
    };
  }

  if (FIXTURE_HEAD_RE.test(low)) {
    return {
      layer: 'fixtures',
      kind: 'item',
      category: 'misc',
      condition: inferItemCondition(full),
      occupiable: false,
      maxOccupancy: 0,
      contains: false,
      contentsVisible: 'out',
    };
  }

  const isContainer = CONTAINER_HEAD_RE.test(low) && !/\b(sugar\s+bowls?|matchbox)\b/i.test(low);
  let category = 'misc';
  if (CONSUMABLE_RE.test(low)) category = 'consumable';
  else if (USABLE_RE.test(low)) category = 'usable';
  else if (WEARABLE_RE.test(low)) category = 'wearable';

  return {
    layer: 'clutter',
    kind: isContainer ? 'container' : 'item',
    category,
    condition: inferItemCondition(full),
    occupiable: false,
    maxOccupancy: 0,
    contains: isContainer,
    contentsVisible: /\b(lids?\s+off|open|uncovered|unsealed|clear|transparent)\b/i.test(full) ? 'out' : 'inside',
  };
}

function isPlausiblePhysicalPiece(name) {
  const clean = stripLeadingArticle(name);
  if (!clean || clean.length < 2 || clean.length > 65) return false;
  if (NON_ITEM_PHRASE_RE.test(clean) || NON_ITEM_PHRASE_RE.test(name)) return false;
  if (/\b(voice|murmur|quiet|silence|sliver|direction|smell|odor|scent|beat|moment|hour|minute|crack)\b/i.test(clean)) {
    return false;
  }
  return (
    FIXTURE_HEAD_RE.test(clean)
    || FURNITURE_HEAD_RE.test(clean)
    || CONTAINER_HEAD_RE.test(clean)
    || CONSUMABLE_RE.test(clean)
    || USABLE_RE.test(clean)
    || WEARABLE_RE.test(clean)
    || PHYSICAL_CLUTTER_RE.test(clean)
  );
}

function inferCellFromText(text, fallback = 'C') {
  const s = String(text || '');
  const m = s.match(/\b(northwest|northeast|southwest|southeast|north|south|east|west|northern|southern|eastern|western|center|middle|central)\b/i);
  if (m) {
    const mapped = CARDINAL_MAP[m[1].toLowerCase()];
    if (mapped && CELLS.includes(mapped)) return mapped;
  }
  try { return normalizeCell(fallback || 'C'); } catch { return 'C'; }
}

/**
 * Split a noun phrase like "a folded newspaper opened to the livestock futures page"
 * into `{ name: "folded newspaper", detail: "opened to the livestock futures page", qty }`.
 */
function splitNounPhraseAndModifier(rawPhrase) {
  let s = cleanPhrase(rawPhrase);
  if (!s) return null;

  let detail = '';
  // Parenthetical modifier: "fluorescent light (buzzing)"
  const parenMatch = s.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  if (parenMatch) {
    s = cleanPhrase(parenMatch[1]);
    detail = cleanPhrase(parenMatch[2]);
  }

  // Participial / relative trailing modifier: "opened to ...", "labeled ...", "marked ...", "filled with ...", "stacked with ...", "tucked ...", "wrapped in ..."
  const modMatch = s.match(/^(.+?)\s+\b(opened\s+to\b.+|labeled\b.+|marked\b.+|filled\s+with\b.+|stacked\s+with\b.+|loaded\s+with\b.+|packed\s+with\b.+|lined\s+with\b.+|covered\s+in\b.+|draped\s+in\b.+|wrapped\s+in\b.+|nested\s+in\b.+|tucked\s+(?:in|into|under|beneath)\b.+|leaning\s+against\b.+|hanging\s+from\b.+)$/i);
  if (modMatch) {
    s = cleanPhrase(modMatch[1]);
    const extra = cleanPhrase(modMatch[2]);
    detail = detail ? `${detail}; ${extra}` : extra;
  }

  const { qty } = parseLeadingQty(s);
  // Keep numeric prefix when it's a natural group label like "three boxes" or strip a/an/the
  const stripped = stripLeadingArticle(s);
  if (!stripped) return null;

  return {
    name: stripped,
    detail,
    qty,
  };
}

function splitCoordinatedNounPhrases(rawList) {
  const text = cleanPhrase(rawList);
  if (!text) return [];
  // Split on commas and "and" when separating distinct noun phrases
  const parts = text
    .split(/\s*(?:,\s*(?:and\s+)?|\s+and\s+)\s*/i)
    .map(cleanPhrase)
    .filter(Boolean);
  return parts.length ? parts : [text];
}

function buildPieceSpec(rawName, {
  detail = '',
  surface = '',
  parentName = '',
  cell = 'C',
  qty = 0,
  layerOverride = '',
  contextText = '',
} = {}) {
  const parsed = splitNounPhraseAndModifier(rawName);
  if (!parsed) return null;
  let name = parsed.name;
  if (/^hardwood$/i.test(name)) name = 'hardwood floor';
  if (!isPlausiblePhysicalPiece(name)) return null;

  const combinedDetail = [parsed.detail, cleanPhrase(detail)].filter(Boolean).join('; ');
  const cls = classifyNarrativePiece(name, `${combinedDetail} ${contextText}`);
  const layer = layerOverride ? normalizeCellLayer(layerOverride) : cls.layer;
  return {
    name,
    layer,
    kind: cls.kind,
    category: cls.category,
    condition: cls.condition,
    cell: inferCellFromText(`${rawName} ${combinedDetail} ${contextText}`, cell),
    description: combinedDetail,
    surface: cleanPhrase(surface),
    parentName: cleanPhrase(parentName),
    qty: qty || parsed.qty || 0,
    occupiable: cls.occupiable,
    maxOccupancy: cls.maxOccupancy,
    contains: cls.contains,
    contentsVisible: cls.contentsVisible,
  };
}

/**
 * Split narrative text into sentences while keeping abbreviations like "Mrs." or "St." intact.
 */
function splitNarrativeSentences(text) {
  const cleaned = String(text || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, ' ')
    .replace(/\[ShowtimeReceipt\][\s\S]*?\[\/ShowtimeReceipt\]/gi, ' ')
    .replace(/\r\n/g, '\n');

  const lines = cleaned.split(/\n+/).map(l => l.trim()).filter(Boolean);
  const sentences = [];
  for (const line of lines) {
    if (/^---+$/.test(line)) continue;
    const protectedLine = line.replace(/\b(Mr|Mrs|Ms|Dr|St|Jr|Sr|Lt|Sgt|Capt|Prof|No|vs|etc)\./gi, '$1\u0000');
    const parts = protectedLine
      .split(/(?<=[.!?])\s+(?=[A-Z"“'(\[])/)
      .map(s => s.replace(/\u0000/g, '.').trim())
      .filter(Boolean);
    sentences.push(...parts);
  }
  return sentences;
}

/**
 * Check if a sentence starts with a room-framing header or transitions to another room.
 */
function matchRoomTransition(sentence) {
  const s = cleanPhrase(sentence);

  // Shorthand list header: "Break room: small table, fluorescent light..."
  const colonMatch = s.match(/^([A-Za-z][A-Za-z0-9\s'-]{1,28})\s*:\s*(.+)$/);
  if (colonMatch && ROOM_NOUN_RE.test(colonMatch[1]) && !/^(?:labeled|marked|sign|note)\b/i.test(colonMatch[1])) {
    return {
      roomHint: stripLeadingArticle(colonMatch[1]),
      fromWall: '',
      fromOpeningType: '',
      remainder: colonMatch[2].trim(),
      isShorthandList: true,
    };
  }

  // Leading prepositional frame: "Inside the break room, ...", "Out on the display floor, ...", "Back in the office, ..."
  const prepMatch = s.match(/^(?:Inside|In|Within|Back\s+in|Out\s+on|Out\s+in|Up\s+in|Down\s+in|Over\s+in|Across\s+in|Through\s+in|Into|Entering)\s+(?:the\s+)?([a-z0-9][a-z0-9\s'-]{1,30}?)\s*,\s*(.+)$/i);
  if (prepMatch && ROOM_NOUN_RE.test(prepMatch[1])) {
    return {
      roomHint: stripLeadingArticle(prepMatch[1]),
      fromWall: '',
      fromOpeningType: '',
      remainder: prepMatch[2].trim(),
    };
  }

  // Subject room header with optional directional door:
  // "The storage room beyond the south door had a heavier smell—..."
  const subjMatch = s.match(/^The\s+([a-z0-9][a-z0-9\s'-]{1,30}?)(?:\s+(?:beyond|past|through|behind|across|off)\s+the\s+(?:(north|south|east|west|northern|southern|eastern|western)\s+)?(door|arch|archway|passage|hallway|curtain|threshold|gate))?\s+(had|held|was|were|smelled|reeked|carried|featured|contained)\s+(.+)$/i);
  if (subjMatch && ROOM_NOUN_RE.test(subjMatch[1])) {
    const dirWord = String(subjMatch[2] || '').toLowerCase();
    return {
      roomHint: stripLeadingArticle(subjMatch[1]),
      fromWall: CARDINAL_MAP[dirWord] || '',
      fromOpeningType: subjMatch[3] ? subjMatch[3].toLowerCase() : (dirWord ? 'door' : ''),
      verb: subjMatch[4].toLowerCase(),
      remainder: subjMatch[5].trim(),
      isRoomSubjectClause: true,
    };
  }

  // Leading directional door transition: "Beyond the south door, the storage room ..."
  const beyondMatch = s.match(/^(?:Beyond|Past|Through|Behind)\s+the\s+(?:(north|south|east|west|northern|southern|eastern|western)\s+)?(door|arch|archway|passage|threshold|curtain)\s*,\s*(?:the\s+([a-z0-9][a-z0-9\s'-]{1,30}?)\s+(?:had|held|was|were)\s+)?(.+)$/i);
  if (beyondMatch && beyondMatch[3] && ROOM_NOUN_RE.test(beyondMatch[3])) {
    const dirWord = String(beyondMatch[1] || '').toLowerCase();
    return {
      roomHint: stripLeadingArticle(beyondMatch[3]),
      fromWall: CARDINAL_MAP[dirWord] || '',
      fromOpeningType: (beyondMatch[2] || 'door').toLowerCase(),
      remainder: beyondMatch[4].trim(),
      isRoomSubjectClause: true,
    };
  }

  return null;
}

/**
 * Parse a single sentence inside a room segment and push extracted items/openings/descriptions.
 */
function parseSentenceIntoSegment(sentence, segment, { defaultCell = 'C' } = {}) {
  const s = cleanPhrase(sentence);
  if (!s) return;

  // Skip character speech / sound / motion-only sentences unless they contact a floor/fixture
  if (CHARACTER_MOTION_SUBJECT_RE.test(s)) {
    const floorMatch = s.match(/\b(?:against|across|on|over)\s+(?:the\s+)?(hardwood(?:\s+floors?)?|floorboards?|tile(?:\s+floors?)?|linoleum|carpet|tatami|concrete(?:\s+floors?)?|stone(?:\s+floors?)?)\b/i);
    if (floorMatch) {
      const spec = buildPieceSpec(floorMatch[1], {
        detail: /^hardwood$/i.test(floorMatch[1]) ? 'hardwood flooring' : '',
        cell: defaultCell,
        layerOverride: 'fixtures',
      });
      if (spec) segment.items.push(spec);
    }
    return;
  }

  // Door / opening statement:
  // "The door to the display floor didn't close all the way; a sliver of light and the low murmur of voices spilled through."
  const doorMatch = s.match(/^The\s+(?:(north|south|east|west|northern|southern|eastern|western)\s+)?(door|window|arch|archway|passage|hatch|gate|shutter)s?\s+(?:to|into|toward|towards|leading\s+to|opening\s+onto)\s+(?:the\s+)?([a-z0-9][a-z0-9\s'-]{1,28}?)\s+((?:didn't|did\s+not|wouldn't|was|were|stood|hung|stayed|remained|led|opened|creaked)\b.+)$/i);
  if (doorMatch) {
    const dirWord = String(doorMatch[1] || '').toLowerCase();
    const typeRaw = doorMatch[2].toLowerCase();
    const type = typeRaw === 'archway' ? 'arch' : (typeRaw === 'hatch' ? 'descent' : (typeRaw === 'gate' || typeRaw === 'shutter' ? 'door' : typeRaw));
    const targetHint = stripLeadingArticle(doorMatch[3]);
    const stateDesc = cleanPhrase(doorMatch[4]);
    const peer = /\b(didn't\s+close|did\s+not\s+close|ajar|cracked|open|unlatched|sliver\s+of\s+light|spilled\s+through|see\s+through|glass|window)\b/i.test(stateDesc);
    segment.openings.push({
      targetHint,
      wall: CARDINAL_MAP[dirWord] || '',
      type,
      peer,
      description: stateDesc,
    });
    return;
  }

  // Case A: "<Subject NP> <above/over/under/beneath> <Anchor NP> <intransitive verb/state>"
  // e.g. "the fluorescent light above the small table buzzed."
  const relSubjectVerb = s.match(/^((?:the|a|an|\d+|one|two|three|four|five|six)?\s*[a-z0-9][a-z0-9\s'-]{1,42}?)\s+(above|over|under|underneath|beneath| atop|on\s+top\s+of)\s+((?:the|a|an)\s+[a-z0-9][a-z0-9\s'-]{1,36}?)\s+(buzzed|hummed|flickered|glowed|hung|dangled|swung|ticked|dripped|rattled|creaked|sat|stood|rested|waited)(?:\s+([^.;]+))?[.;]?$/i);
  if (relSubjectVerb) {
    const [, subjRaw, prepRaw, anchorRaw, verbRaw, tailRaw] = relSubjectVerb;
    const anchorSpec = buildPieceSpec(anchorRaw, { cell: defaultCell });
    const verbState = verbRaw.toLowerCase() === 'buzzed' ? 'buzzing'
      : verbRaw.toLowerCase() === 'hummed' ? 'humming'
      : verbRaw.toLowerCase() === 'flickered' ? 'flickering'
      : verbRaw.toLowerCase() === 'glowed' ? 'glowing'
      : verbRaw.toLowerCase();
    const prep = prepRaw.trim().toLowerCase();
    const anchorName = anchorSpec ? anchorSpec.name : stripLeadingArticle(anchorRaw);
    const subjDetail = [`${prep} the ${anchorName}`, verbState, cleanPhrase(tailRaw)].filter(Boolean).join(', ');
    const subjSpec = buildPieceSpec(subjRaw, {
      detail: subjDetail,
      surface: anchorName,
      cell: anchorSpec?.cell || defaultCell,
      contextText: s,
    });
    if (anchorSpec) {
      segment.items.push(anchorSpec);
      if (anchorSpec.layer === 'furniture') segment._lastSurface = anchorSpec.name;
    }
    if (subjSpec) segment.items.push(subjSpec);
    return;
  }

  // Case B: "<Subject> rose/stood/ran/lined/stretched <extent>, labeled/marked <label> with <trailing NP> <underneath/beneath/on top/inside/beside>"
  // e.g. "Shelves rose floor to ceiling, labeled in thick marker: SILVER / DATELESS — SORT with a plastic bin underneath."
  const shelvesRiseMatch = s.match(/^([A-Za-z][a-z0-9\s'-]{1,36}?)\s+(?:rose|stood|ran|stretched|lined\s+the\s+walls?)\s+([^,]+?)(?:,\s*(.+))?$/i);
  if (shelvesRiseMatch) {
    const [, subjRaw, extentRaw, restClause = ''] = shelvesRiseMatch;
    let mainDetail = cleanPhrase(extentRaw);
    let trailingSpec = null;
    let bodyClause = cleanPhrase(restClause);

    const withUnderMatch = bodyClause.match(/^(.*?)\s+\bwith\s+((?:a|an|the|\d+|one|two|three|four|five)?\s*[a-z0-9][a-z0-9\s'-]{1,36}?)\s+(underneath|beneath|under\s+it|under\s+them|on\s+top|beside\s+it|beside\s+them|inside)\.?$/i);
    if (withUnderMatch) {
      bodyClause = cleanPhrase(withUnderMatch[1]);
      const trailingRaw = withUnderMatch[2];
      const posWord = withUnderMatch[3].toLowerCase();
      const mainSpecPreview = splitNounPhraseAndModifier(subjRaw);
      const mainName = (mainSpecPreview?.name || stripLeadingArticle(subjRaw)).toLowerCase();
      trailingSpec = buildPieceSpec(trailingRaw, {
        detail: `${posWord} the ${mainName}`,
        surface: mainName,
        cell: defaultCell,
        contextText: s,
      });
    }
    if (bodyClause) {
      mainDetail = mainDetail ? `${mainDetail}, ${bodyClause}` : bodyClause;
    }
    const mainSpec = buildPieceSpec(subjRaw, {
      detail: mainDetail,
      cell: defaultCell,
      contextText: s,
    });
    if (mainSpec) {
      mainSpec.name = mainSpec.name.toLowerCase();
      segment.items.push(mainSpec);
      if (mainSpec.layer === 'furniture') segment._lastSurface = mainSpec.name;
    }
    if (trailingSpec) segment.items.push(trailingSpec);
    return;
  }

  // Case C: "<Subject NP> <waited/sat/stood/lay/rested/hung/was/were> <on/beside/next to/under/beneath/against/in/inside/near/by> <Target NP>[, trailing clauses]"
  // Handles both:
  // 1) "A half-empty mug of cold barley tea sat beside a folded newspaper opened to the livestock futures page."
  // 2) "Three boxes waited on a worktable, lids off, tarnished spoons and sugar bowls nested in newsprint."
  const posSentenceMatch = s.match(/^([^,;]+?)\s+\b(sat|stood|lay|rested|waited|hung|leaned|was|were|simmered|ticked)\s+(on\s+top\s+of|on|atop|beside|next\s+to|by|near|under|underneath|beneath|against|in|inside|across\s+from|over|above)\s+(.+)$/i);
  if (posSentenceMatch) {
    const [, subjRaw, , prepRaw, rhsRaw] = posSentenceMatch;
    const prep = prepRaw.trim().toLowerCase();
    // Split rhsRaw on commas to separate the immediate object of the preposition from appositive/participial clauses
    const commaParts = rhsRaw.split(/\s*,\s*/).map(cleanPhrase).filter(Boolean);
    const objPhrase = commaParts[0] || '';
    const extraClauses = commaParts.slice(1);

    const objSpec = buildPieceSpec(objPhrase, { cell: defaultCell, contextText: s });
    const subjSpec = buildPieceSpec(subjRaw, { cell: objSpec?.cell || defaultCell, contextText: s });

    if (subjSpec && objSpec) {
      if (prep === 'beside' || prep === 'next to' || prep === 'by' || prep === 'near') {
        const sharedSurface = subjSpec.surface || objSpec.surface || segment._lastSurface || '';
        if (sharedSurface && subjSpec.layer === 'clutter' && objSpec.layer === 'clutter') {
          subjSpec.surface = sharedSurface;
          objSpec.surface = sharedSurface;
        }
        const subjNote = `beside the ${objSpec.name}`;
        subjSpec.description = [subjSpec.description, subjNote].filter(Boolean).join('; ');
        const objNote = `beside the ${subjSpec.name}`;
        objSpec.description = [objSpec.description, objNote].filter(Boolean).join('; ');
        segment.items.push(subjSpec, objSpec);
      } else if (prep === 'on' || prep === 'atop' || prep === 'on top of' || prep === 'under' || prep === 'underneath' || prep === 'beneath' || prep === 'against' || prep === 'in' || prep === 'inside') {
        // Object is the surface / furniture / container (e.g. "on a worktable")
        if (objSpec.layer === 'furniture' || objSpec.kind === 'container') {
          segment.items.push(objSpec);
          if (objSpec.layer === 'furniture') segment._lastSurface = objSpec.name;
          subjSpec.surface = objSpec.name;
          if (prep === 'in' || prep === 'inside') subjSpec.parentName = objSpec.name;
        } else {
          segment.items.push(objSpec);
          subjSpec.surface = objSpec.name;
        }

        // Check extraClauses for state notes ("lids off") and nested contents ("tarnished spoons and sugar bowls nested in newsprint")
        const stateBits = [];
        if (prep !== 'on') stateBits.push(`${prep} the ${objSpec.name}`);
        for (const clause of extraClauses) {
          const nestedMatch = clause.match(/^(.+?)\s+\b(nested|packed|wrapped|tucked|cushioned|bedded|stuffed|stored|sitting|lying|stacked)\s+(?:in|inside|into|among|between)\s+(.+)$/i);
          if (nestedMatch) {
            const [, contentsListRaw, nestVerb, packingRaw] = nestedMatch;
            stateBits.push(clause);
            const contentPhrases = splitCoordinatedNounPhrases(contentsListRaw);
            const packingSpec = buildPieceSpec(packingRaw, {
              detail: `${nestVerb.toLowerCase()} inside ${subjSpec.name}`,
              surface: subjSpec.name,
              parentName: subjSpec.name,
              cell: subjSpec.cell,
              contextText: clause,
            });
            for (const cPhrase of contentPhrases) {
              const cSpec = buildPieceSpec(cPhrase, {
                detail: `${nestVerb.toLowerCase()} in ${stripLeadingArticle(packingRaw)} inside ${subjSpec.name}`,
                surface: subjSpec.name,
                parentName: subjSpec.name,
                cell: subjSpec.cell,
                contextText: clause,
              });
              if (cSpec) segment.items.push(cSpec);
            }
            if (packingSpec) segment.items.push(packingSpec);
            subjSpec.kind = 'container';
            subjSpec.contains = true;
          } else {
            stateBits.push(clause);
          }
        }
        if (stateBits.length) {
          subjSpec.description = [subjSpec.description, ...stateBits].filter(Boolean).join('; ');
          if (/\b(lids?\s+off|open|uncovered)\b/i.test(subjSpec.description)) {
            subjSpec.contentsVisible = 'out';
          }
        }
        segment.items.push(subjSpec);
      } else {
        segment.items.push(objSpec, subjSpec);
      }
      return;
    }
  }

  // Case D: Prepositional inversion:
  // "On the worktable sat three boxes..." / "Against the north wall stood a glass display case..." / "Under the sink sat a bucket and bleach."
  const invMatch = s.match(/^(?:On\s+top\s+of|On|Atop|Under|Underneath|Beneath|Beside|Next\s+to|Against|In|Inside|Near|By|Above|Over)\s+(?:the\s+|a\s+|an\s+)?([a-z0-9][a-z0-9\s'-]{1,32}?)\s*(?:,\s*|\s+)(?:sat|stood|lay|rested|waited|hung|leaned|was|were)\s+(.+)$/i);
  if (invMatch) {
    const [, anchorRaw, itemsRaw] = invMatch;
    const cell = inferCellFromText(anchorRaw, defaultCell);
    const anchorSpec = buildPieceSpec(anchorRaw, { cell, contextText: s });
    let surfaceName = '';
    if (anchorSpec) {
      segment.items.push(anchorSpec);
      surfaceName = anchorSpec.name;
      if (anchorSpec.layer === 'furniture') segment._lastSurface = anchorSpec.name;
    }
    for (const phrase of splitCoordinatedNounPhrases(itemsRaw)) {
      const itemSpec = buildPieceSpec(phrase, {
        surface: surfaceName,
        cell,
        contextText: s,
      });
      if (itemSpec) segment.items.push(itemSpec);
    }
    return;
  }

  // Case E: Existential "There was/were <items> [on/in/under/against <anchor>]"
  const thereMatch = s.match(/^There\s+(?:was|were|is|are)\s+(.+?)(?:\s+\b(on|atop|under|underneath|beneath|beside|next\s+to|against|in|inside|near|by|above|over)\s+((?:the|a|an)\s+[a-z0-9][a-z0-9\s'-]{1,32}))?\.?$/i);
  if (thereMatch) {
    const [, listRaw, , anchorRaw = ''] = thereMatch;
    const cell = inferCellFromText(`${listRaw} ${anchorRaw}`, defaultCell);
    const anchorSpec = anchorRaw ? buildPieceSpec(anchorRaw, { cell, contextText: s }) : null;
    if (anchorSpec) segment.items.push(anchorSpec);
    for (const phrase of splitCoordinatedNounPhrases(listRaw)) {
      const spec = buildPieceSpec(phrase, {
        surface: anchorSpec?.name || '',
        cell,
        contextText: s,
      });
      if (spec) segment.items.push(spec);
    }
    return;
  }

  // Case F: "<Surface/Furniture> held / contained / displayed / was stacked with / was lined with <items>"
  const heldMatch = s.match(/^(?:The|A|An)?\s*([a-z0-9][a-z0-9\s'-]{1,32}?)\s+(?:held|contained|displayed|featured|carried|was\s+stacked\s+with|were\s+stacked\s+with|was\s+lined\s+with|were\s+lined\s+with|was\s+cluttered\s+with|was\s+filled\s+with|were\s+filled\s+with)\s+(.+)$/i);
  if (heldMatch) {
    const [, holderRaw, listRaw] = heldMatch;
    const cell = inferCellFromText(holderRaw, defaultCell);
    const holderSpec = buildPieceSpec(holderRaw, { cell, contextText: s });
    if (holderSpec) {
      holderSpec.contains = true;
      segment.items.push(holderSpec);
      if (holderSpec.layer === 'furniture') segment._lastSurface = holderSpec.name;
    }
    for (const phrase of splitCoordinatedNounPhrases(listRaw)) {
      const spec = buildPieceSpec(phrase, {
        surface: holderSpec?.name || '',
        parentName: holderSpec?.kind === 'container' ? holderSpec.name : '',
        cell,
        contextText: s,
      });
      if (spec) segment.items.push(spec);
    }
    return;
  }
}

/**
 * Parse narrative text into room segments with items, descriptions, and openings.
 */
export function extractNarrativeRoomPlan(narrativeText, { defaultCell = 'C' } = {}) {
  const sentences = splitNarrativeSentences(narrativeText);
  const segments = [];
  let current = {
    roomHint: '',
    fromWall: '',
    fromOpeningType: '',
    roomDescription: '',
    openings: [],
    items: [],
    _lastSurface: '',
  };
  segments.push(current);

  const selectSegment = (hint, { fromWall = '', fromOpeningType = '' } = {}) => {
    const cleanHint = stripLeadingArticle(hint);
    if (!cleanHint) return current;
    if (!current.roomHint && !current.items.length && !current.roomDescription && !current.openings.length) {
      current.roomHint = cleanHint;
      if (fromWall) current.fromWall = fromWall;
      if (fromOpeningType) current.fromOpeningType = fromOpeningType;
      return current;
    }
    const existing = segments.find(seg => seg.roomHint.toLowerCase() === cleanHint.toLowerCase());
    if (existing) {
      if (fromWall && !existing.fromWall) existing.fromWall = fromWall;
      if (fromOpeningType && !existing.fromOpeningType) existing.fromOpeningType = fromOpeningType;
      current = existing;
      return current;
    }
    current = {
      roomHint: cleanHint,
      fromWall,
      fromOpeningType,
      roomDescription: '',
      openings: [],
      items: [],
      _lastSurface: '',
    };
    segments.push(current);
    return current;
  };

  for (const sentence of sentences) {
    const trans = matchRoomTransition(sentence);
    if (trans) {
      selectSegment(trans.roomHint, {
        fromWall: trans.fromWall,
        fromOpeningType: trans.fromOpeningType,
      });
      if (trans.isShorthandList) {
        for (const phrase of splitCoordinatedNounPhrases(trans.remainder)) {
          const spec = buildPieceSpec(phrase, { cell: defaultCell, contextText: trans.remainder });
          if (spec) current.items.push(spec);
        }
        continue;
      }
      if (trans.isRoomSubjectClause) {
        // Check if remainder is a sensory/atmosphere description ("a heavier smell—cardboard, mineral oil...")
        if (/^(?:a\s+)?(?:heavier\s+|faint\s+|strong\s+|sharp\s+|musty\s+|stale\s+|damp\s+)?(?:smell|scent|odor|air|chill|warmth|feel|atmosphere|glow|gloom)\b/i.test(trans.remainder)) {
          const formatted = trans.remainder.charAt(0).toUpperCase() + trans.remainder.slice(1);
          current.roomDescription = current.roomDescription
            ? `${current.roomDescription} ${formatted}`
            : formatted;
          continue;
        }
        // Or if the room itself "held / had <items>"
        for (const phrase of splitCoordinatedNounPhrases(trans.remainder)) {
          const spec = buildPieceSpec(phrase, { cell: defaultCell, contextText: trans.remainder });
          if (spec) current.items.push(spec);
        }
        continue;
      }
      parseSentenceIntoSegment(trans.remainder, current, { defaultCell });
      continue;
    }

    parseSentenceIntoSegment(sentence, current, { defaultCell });
  }

  for (const seg of segments) delete seg._lastSurface;
  return {
    segments: segments.filter(seg =>
      seg.roomHint || seg.items.length || seg.roomDescription || seg.openings.length),
  };
}

function normalizeRoomMatchKey(raw) {
  return stripLeadingArticle(raw)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stemRoomKey(raw) {
  return normalizeRoomMatchKey(raw)
    .replace(/\b(room|area|space|floor|section|zone)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Find a matching room in `candidates` for a narrative room hint like
 * "break room", "storage room" (-> "Storage"), or "display floor" (-> "Display Floor").
 */
export function matchRoomByNarrativeHint(candidates, hint) {
  const key = normalizeRoomMatchKey(hint);
  const stem = stemRoomKey(hint);
  if (!key) return null;
  const list = Array.isArray(candidates) ? candidates.filter(Boolean) : [];

  // 1. Exact name or alias match
  for (const r of list) {
    const names = [r.name, ...(r.aliases || [])].map(normalizeRoomMatchKey).filter(Boolean);
    if (names.includes(key)) return r;
  }

  // 2. Stem match ("storage room" <-> "Storage", "break room" <-> "Break Room")
  if (stem) {
    for (const r of list) {
      const stems = [r.name, ...(r.aliases || [])].map(stemRoomKey).filter(Boolean);
      if (stems.includes(stem)) return r;
    }
  }

  // 3. Substring / synonym / listing code match
  for (const r of list) {
    const rKey = normalizeRoomMatchKey(r.name);
    const rStem = stemRoomKey(r.name);
    if (rKey && (rKey.includes(key) || key.includes(rKey))) return r;
    if (stem && rStem && (rStem.includes(stem) || stem.includes(rStem))) return r;
  }

  if (/\b(display|sales|shop|showroom|storefront)\b/.test(key)) {
    const shopHit = list.find(r => r.listingCode === 'shop' || /\b(display|sales|shop|showroom)\b/i.test(r.name));
    if (shopHit) return shopHit;
  }
  if (/\b(storage|stock|back|supply)\b/.test(key)) {
    const utilHit = list.find(r => /\b(storage|back|stock|supply)\b/i.test(r.name));
    if (utilHit) return utilHit;
  }

  return null;
}

function titleCaseRoomHint(hint) {
  return stripLeadingArticle(hint)
    .split(/\s+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

function foldItemKey(name) {
  return stripLeadingArticle(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function findExistingRoomPiece(room, name) {
  const want = foldItemKey(name);
  if (!want || !room?.cells) return null;
  const wantStem = want.replace(/^(?:three|two|four|five|six|folded|half empty|tarnished|small|plastic|floor to ceiling)\s+/, '').trim();
  for (const [cellId, bag] of Object.entries(room.cells || {})) {
    for (const layer of ['fixtures', 'furniture', 'clutter']) {
      for (const it of bag?.[layer] || []) {
        const k = foldItemKey(it?.name);
        if (!k) continue;
        if (k === want || (wantStem && wantStem.length >= 4 && k === wantStem)) {
          return { item: it, cell: cellId, layer };
        }
      }
    }
  }
  return null;
}

/**
 * Populate rooms in `compass` from narrative text (chat prose or user-provided text).
 *
 * @param {object} compass
 * @param {string} narrativeText
 * @param {{
 *   targetPlaceId?: string,
 *   defaultCell?: string,
 *   scope?: 'auto'|'room'|'suite',
 *   createMissingRooms?: boolean,
 * }} [opts]
 */
export function populateRoomsFromNarrative(compass, narrativeText, {
  targetPlaceId = '',
  defaultCell = 'C',
  scope = 'auto',
  createMissingRooms = true,
} = {}) {
  if (!compass || typeof compass !== 'object') {
    return { addedCount: 0, updatedCount: 0, touchedRoomIds: [], createdRoomIds: [], itemsByRoom: {} };
  }
  const text = String(narrativeText || '').trim();
  if (!text) {
    return { addedCount: 0, updatedCount: 0, touchedRoomIds: [], createdRoomIds: [], itemsByRoom: {} };
  }

  const targetPlace = getPlace(compass, targetPlaceId || compass.activeRoomId);
  let host = null;
  let defaultRoom = null;

  if (targetPlace) {
    if (isSuiteHostKind(targetPlace.kind)) {
      host = targetPlace;
      const kids = listSuiteChildren(compass, host.id);
      defaultRoom = kids[0] || null;
    } else if (isLoadableKind(targetPlace.kind)) {
      defaultRoom = targetPlace;
      if (targetPlace.parentId) {
        const parent = getPlace(compass, targetPlace.parentId);
        if (isSuiteHostKind(parent?.kind)) host = parent;
      }
    }
  }

  const plan = extractNarrativeRoomPlan(text, { defaultCell });
  let addedCount = 0;
  let updatedCount = 0;
  const touchedRoomIds = new Set();
  const createdRoomIds = [];
  const itemsByRoom = {};

  const resolveSegmentRoom = (roomHint) => {
    if (scope === 'room' && defaultRoom) return defaultRoom;
    const suiteRooms = host
      ? listSuiteChildren(compass, host.id)
      : Object.values(compass.rooms || {}).filter(r => isLoadableKind(r?.kind));

    if (!roomHint) {
      return defaultRoom || suiteRooms[0] || null;
    }

    const matched = matchRoomByNarrativeHint(suiteRooms, roomHint);
    if (matched) return matched;
    if (!host) {
      const global = matchRoomByNarrativeHint(
        Object.values(compass.rooms || {}).filter(r => isLoadableKind(r?.kind)),
        roomHint,
      );
      if (global) return global;
    }

    if (createMissingRooms && host && scope !== 'room') {
      const name = titleCaseRoomHint(roomHint);
      const kind = /\b(hall|hallway|corridor|foyer|entryway|passage)\b/i.test(name) ? 'transitional' : 'room';
      const created = createAndStoreRoom(compass, {
        name,
        kind,
        parentId: host.id,
      });
      createdRoomIds.push(created.id);
      return created;
    }

    return defaultRoom || null;
  };

  let prevRoom = defaultRoom;

  for (const seg of plan.segments) {
    const room = resolveSegmentRoom(seg.roomHint);
    if (!room) continue;

    // 1. Room sensory / narrative description
    if (seg.roomDescription) {
      const curDesc = String(room.description || '').trim();
      if (!curDesc) {
        setPlaceDescription(compass, room.id, seg.roomDescription);
        touchedRoomIds.add(room.id);
      } else if (!curDesc.toLowerCase().includes(seg.roomDescription.slice(0, 24).toLowerCase())) {
        setPlaceDescription(compass, room.id, `${curDesc} ${seg.roomDescription}`.trim());
        touchedRoomIds.add(room.id);
      }
    }

    // 2. Directional transition opening from previous room (e.g. "The storage room beyond the south door")
    if (seg.fromWall && prevRoom && prevRoom.id !== room.id) {
      try {
        const wall = seg.fromWall;
        addLink(compass, prevRoom.id, {
          wall,
          toPlaceId: room.id,
        });
        const freshPrev = getPlace(compass, prevRoom.id);
        const link = (freshPrev?.links || []).find(l => l.wall === wall && l.toPlaceId === room.id);
        if (link && !(link.openings || []).some(o => o.type === (seg.fromOpeningType || 'door'))) {
          addOpening(compass, prevRoom.id, link.id, {
            type: seg.fromOpeningType || 'door',
            cell: wall,
            travel: true,
          });
        }
        touchedRoomIds.add(prevRoom.id);
        touchedRoomIds.add(room.id);
      } catch { /* ignore link error */ }
    }

    // 3. Explicit door/opening statements inside the segment (e.g. "The door to the display floor didn't close all the way...")
    for (const opSpec of seg.openings || []) {
      const targetRoom = opSpec.targetHint ? resolveSegmentRoom(opSpec.targetHint) : null;
      if (!targetRoom || targetRoom.id === room.id) continue;
      try {
        const freshRoom = getPlace(compass, room.id);
        let existingLink = (freshRoom?.links || []).find(l => l.toPlaceId === targetRoom.id);
        const wall = opSpec.wall || existingLink?.wall || 'N';
        if (!existingLink) {
          addLink(compass, room.id, {
            wall,
            toPlaceId: targetRoom.id,
          });
          existingLink = (getPlace(compass, room.id)?.links || []).find(l => l.toPlaceId === targetRoom.id);
        }
        if (!existingLink) continue;
        const existingOp = (existingLink.openings || []).find(o => o.type === (opSpec.type || 'door'));
        if (!existingOp) {
          addOpening(compass, room.id, existingLink.id, {
            type: opSpec.type || 'door',
            cell: existingLink.wall || wall,
            description: opSpec.description || '',
            peer: !!opSpec.peer,
            travel: true,
          });
        } else if (opSpec.description || opSpec.peer) {
          updateOpening(compass, room.id, existingLink.id, existingOp.id, {
            description: opSpec.description || existingOp.description || '',
            peer: opSpec.peer ? true : existingOp.peer,
          });
        }
        touchedRoomIds.add(room.id);
        touchedRoomIds.add(targetRoom.id);
      } catch { /* ignore opening error */ }
    }

    // 4. Add/update room items (first fixtures + furniture + containers, then clutter so parentId resolves)
    const orderedItems = [
      ...(seg.items || []).filter(it => it.layer === 'fixtures' || it.layer === 'furniture' || it.kind === 'container'),
      ...(seg.items || []).filter(it => it.layer !== 'fixtures' && it.layer !== 'furniture' && it.kind !== 'container'),
    ];
    const pieceIdByName = new Map();
    const recordPieceId = (name, id) => {
      const k = foldItemKey(name);
      if (k && id) pieceIdByName.set(k, id);
    };

    // Index existing room pieces first
    const curRoomSnap = getPlace(compass, room.id);
    for (const bag of Object.values(curRoomSnap?.cells || {})) {
      for (const layer of ['fixtures', 'furniture', 'clutter']) {
        for (const p of bag?.[layer] || []) {
          recordPieceId(p.name, p.id);
        }
      }
    }

    for (const spec of orderedItems) {
      const liveRoom = getPlace(compass, room.id);
      const existing = findExistingRoomPiece(liveRoom, spec.name);
      const parentId = spec.parentName
        ? (pieceIdByName.get(foldItemKey(spec.parentName)) || '')
        : '';
      const cell = spec.cell || defaultCell || 'C';
      const locator = {
        where: parentId ? 'inside' : 'room',
        ownerId: '',
        parentId: parentId || '',
        placeId: room.id,
        cell,
        surface: spec.surface || '',
      };

      if (existing) {
        const mergedDesc = spec.description && (!existing.item.description || spec.description.length > existing.item.description.length)
          ? spec.description
          : existing.item.description;
        const updated = updateItem(compass, room.id, {
          itemId: existing.item.id,
          cell: existing.cell,
          layer: existing.layer,
          patch: {
            description: mergedDesc,
            surface: spec.surface || existing.item.surface || '',
            parentId: parentId || existing.item.parentId || '',
            qty: spec.qty || existing.item.qty || 0,
            contains: spec.contains ?? existing.item.contains,
            contentsVisible: spec.contentsVisible || existing.item.contentsVisible,
            condition: spec.condition !== 'fine' ? spec.condition : existing.item.condition,
            locator,
          },
        });
        recordPieceId(spec.name, updated.id);
        updatedCount += 1;
        touchedRoomIds.add(room.id);
        (itemsByRoom[room.id] ??= []).push(updated);
      } else {
        const added = addItem(compass, room.id, {
          cell,
          layer: spec.layer,
          name: spec.name,
          description: spec.description || '',
          kind: spec.kind,
          category: spec.category,
          condition: spec.condition,
          occupiable: spec.occupiable,
          maxOccupancy: spec.maxOccupancy,
          contains: spec.contains,
          contentsVisible: spec.contentsVisible,
          surface: spec.surface || '',
          parentId,
          qty: spec.qty || 0,
          locator,
        });
        recordPieceId(spec.name, added.id);
        addedCount += 1;
        touchedRoomIds.add(room.id);
        (itemsByRoom[room.id] ??= []).push(added);
      }
    }

    prevRoom = getPlace(compass, room.id) || room;
  }

  return {
    addedCount,
    updatedCount,
    touchedRoomIds: [...touchedRoomIds],
    createdRoomIds,
    itemsByRoom,
  };
}

/**
 * Collect recent narrative messages from a SillyTavern chat array.
 */
export function collectRecentChatNarrative(chat, { maxMessages = 10 } = {}) {
  const list = Array.isArray(chat) ? chat : [];
  if (!list.length) return '';
  const chunks = [];
  for (let i = list.length - 1; i >= 0 && chunks.length < maxMessages; i--) {
    const m = list[i];
    if (!m || m.is_system) continue;
    const raw = String(m.mes || '')
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .replace(/\[ShowtimeReceipt\][\s\S]*?\[\/ShowtimeReceipt\]/gi, '')
      .trim();
    if (!raw) continue;
    chunks.unshift(raw);
  }
  return chunks.join('\n\n');
}

export function smokeRoomDresserPure() {
  try {
    const sample = `Inside the break room, the fluorescent light above the small table buzzed. A half-empty mug of cold barley tea sat beside a folded newspaper opened to the livestock futures page. The door to the display floor didn't close all the way; a sliver of light and the low murmur of voices spilled through.
The storage room beyond the south door had a heavier smell—cardboard, mineral oil, the faint chemical edge of polish. Shelves rose floor to ceiling, labeled in thick marker: SILVER / DATELESS — SORT with a plastic bin underneath. Three boxes waited on a worktable, lids off, tarnished spoons and sugar bowls nested in newsprint.
Out on the display floor, boots shifted against hardwood. A beat of quiet. Then Hawks' voice came through the crack, pitching casual as a man asking for directions.`;

    const compass = {
      version: 2,
      activeRoomId: '',
      rooms: {},
      lostAndFound: [],
      sonar: { pings: {} },
    };
    const shop = createAndStoreRoom(compass, {
      id: 'okisato_antiques',
      name: 'Okisato Antiques',
      kind: 'building',
      category: 'antique_shop',
    });
    const display = createAndStoreRoom(compass, {
      id: 'display_floor',
      name: 'Display Floor',
      kind: 'room',
      parentId: shop.id,
      listingCode: 'shop',
    });
    const breakRoom = createAndStoreRoom(compass, {
      id: 'break_room',
      name: 'Break Room',
      kind: 'room',
      parentId: shop.id,
      listingCode: 'util',
    });
    const storage = createAndStoreRoom(compass, {
      id: 'storage',
      name: 'Storage',
      kind: 'room',
      parentId: shop.id,
      listingCode: 'util',
    });

    const res = populateRoomsFromNarrative(compass, sample, {
      targetPlaceId: shop.id,
    });
    if (res.addedCount < 10) return `expected >=10 items added, got ${res.addedCount}`;

    const br = getPlace(compass, breakRoom.id);
    const brFixtures = br.cells.C.fixtures.map(x => x.name.toLowerCase());
    const brFurniture = br.cells.C.furniture.map(x => x.name.toLowerCase());
    const brClutter = br.cells.C.clutter.map(x => x.name.toLowerCase());
    if (!brFixtures.some(n => n.includes('fluorescent light'))) return 'break room missing fluorescent light fixture';
    if (!brFurniture.some(n => n.includes('small table'))) return 'break room missing small table furniture';
    if (!brClutter.some(n => n.includes('mug of cold barley tea'))) return 'break room missing mug of cold barley tea';
    if (!brClutter.some(n => n.includes('folded newspaper'))) return 'break room missing folded newspaper';
    const paper = br.cells.C.clutter.find(x => /newspaper/i.test(x.name));
    if (!/livestock futures/i.test(paper?.description || '')) return 'newspaper missing livestock futures description';
    if (paper?.surface !== 'small table') return 'newspaper should be on small table';

    const st = getPlace(compass, storage.id);
    if (!/cardboard, mineral oil/i.test(st.description || '')) return 'storage room missing smell description';
    const stFurniture = st.cells.C.furniture.map(x => x.name.toLowerCase());
    if (!stFurniture.some(n => n.includes('shelves'))) return 'storage missing shelves furniture';
    if (!stFurniture.some(n => n.includes('worktable'))) return 'storage missing worktable furniture';
    const shelves = st.cells.C.furniture.find(x => /shelves/i.test(x.name));
    if (!/SILVER \/ DATELESS/i.test(shelves?.description || '')) return 'shelves missing marker label';
    const bin = st.cells.C.clutter.find(x => /plastic bin/i.test(x.name));
    if (!bin || bin.kind !== 'container') return 'storage missing plastic bin container';
    const boxes = st.cells.C.clutter.find(x => /boxes/i.test(x.name));
    if (!boxes || boxes.kind !== 'container' || boxes.surface !== 'worktable') return 'three boxes should be container on worktable';
    const spoons = st.cells.C.clutter.find(x => /tarnished spoons/i.test(x.name));
    const bowls = st.cells.C.clutter.find(x => /sugar bowls/i.test(x.name));
    if (!spoons || spoons.parentId !== boxes.id) return 'tarnished spoons should nest inside three boxes';
    if (!bowls || bowls.parentId !== boxes.id) return 'sugar bowls should nest inside three boxes';

    const df = getPlace(compass, display.id);
    const dfFixtures = df.cells.C.fixtures.map(x => x.name.toLowerCase());
    if (!dfFixtures.some(n => n.includes('hardwood'))) return 'display floor missing hardwood fixture';
    if (df.cells.C.clutter.some(x => /boots|voice|beat|man/i.test(x.name))) {
      return 'display floor should not include false-positive boots/voice/beat';
    }

    return '';
  } catch (err) {
    return String(err?.message || err);
  }
}
