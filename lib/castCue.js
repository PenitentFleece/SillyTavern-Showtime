// Cue a cast member into main chat: dossier + slash command.

import {
  buildCharacterDossier,
  findCastByNameOrAlias,
  formatDirectorPromptBlock,
  getCastMembers,
  getDirectorRecord,
  getStarMember,
  normalizeCastPresence,
  resolveCastPromptIdentity,
} from './castCatalog.js';
import { clipText } from './chatTrack.js';
import { compactTurnTimeInstruct } from './chatSlate.js';
import { filesKnownToCharacter, formatFileTidbits } from './fileCabinet.js';

let registered = false;
let activeCastCue = null;

export function setActiveCastCue(cue) {
  activeCastCue = cue && typeof cue === 'object' ? { ...cue } : null;
  return activeCastCue;
}

export function getActiveCastCue() {
  return activeCastCue;
}

function chidOfAvatar(characters, avatar) {
  const id = String(avatar || '').trim();
  if (!id || !Array.isArray(characters)) return -1;
  return characters.findIndex(c => c && c.avatar === id);
}

/**
 * Which ST character card should actually generate for a Cue.
 * Linked card wins; otherwise the Director’s linked card.
 *
 * `force_chid` only works in group chats. Solo chats keep the open card and
 * rely on the cue overlay for any other identity.
 *
 * @returns {{ chid: number, avatar: string, source: 'card'|'director'|'current' }}
 */
export function resolveCueGenerationTarget(storage, char, {
  characters = [],
  characterId = undefined,
} = {}) {
  const own = char?.characterCardId ? chidOfAvatar(characters, char.characterCardId) : -1;
  if (own >= 0) {
    return { chid: own, avatar: char.characterCardId, source: 'card' };
  }

  const director = getDirectorRecord(storage);
  const dirChid = director?.characterCardId
    ? chidOfAvatar(characters, director.characterCardId)
    : -1;
  if (dirChid >= 0) {
    return { chid: dirChid, avatar: director.characterCardId, source: 'director' };
  }

  const current = Number.parseInt(characterId, 10);
  return {
    chid: Number.isInteger(current) && current >= 0 ? current : -1,
    avatar: '',
    source: 'current',
  };
}

/**
 * Character index a group Send should pass as `force_chid`.
 * Null when the cue has no card in this group, so Send keeps the normal path.
 *
 * @param {{ chid?: number } | null | undefined} target
 * @param {{ characters?: { avatar?: string }[], groupMembers?: string[] | null }} [opts]
 * @returns {number | null}
 */
export function forceChidForGroupCue(target, { characters = [], groupMembers = null } = {}) {
  const chid = target?.chid;
  if (!Number.isInteger(chid) || chid < 0) return null;
  if (!Array.isArray(groupMembers)) return null;
  const avatar = String(characters[chid]?.avatar || '');
  if (!avatar || !groupMembers.includes(avatar)) return null;
  return chid;
}

/**
 * Guided Response (and any /trigger that already named a speaker) keeps that
 * speaker. The Cue Sheet only claims a generation it armed itself.
 * A guided steer is the ephemeral `instruct` inject those buttons leave in
 * chat metadata before /trigger.
 *
 * @param {{ forceChid?: unknown, alreadyArmed?: boolean, guidedSteer?: boolean }} [opts]
 * @returns {boolean} true when this generation must not be painted as the gold-bar slot
 */
export function cueShouldYieldSpeaker({ forceChid, alreadyArmed = false, guidedSteer = false } = {}) {
  if (alreadyArmed) return false;
  if (guidedSteer) return true;
  if (forceChid === undefined || forceChid === null || forceChid === '') return false;
  const n = Number(forceChid);
  return Number.isInteger(n) && n >= 0;
}

export function buildCastCueDossier(storage, char, {
  characters = [],
  personas = [],
  cardDump = 'own',
} = {}) {
  if (!char) return '';
  const dossier = buildCharacterDossier(storage, char, {
    characters,
    personas,
    includeIdentity: cardDump !== 'none',
    maxChars: 1500,
  });
  let files = '';
  try {
    files = formatFileTidbits(filesKnownToCharacter(storage, char.id));
  } catch { /* ignore */ }
  return [dossier, files ? `Files known:\n${files}` : ''].filter(Boolean).join('\n\n');
}

function escapeRe(s) {
  return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function nameNeedles(name) {
  const full = String(name || '').trim();
  if (full.length < 2) return [];
  const out = [full];
  const first = full.split(/[\s,]+/)[0];
  if (first && first.length >= 3 && first.toLowerCase() !== full.toLowerCase()) out.push(first);
  return out;
}

/** Other stage names a cued speaker must not write as. */
export function cueOtherNames(storage, char, extra = []) {
  const skip = new Set();
  for (const n of nameNeedles(char?.name)) skip.add(n.toLowerCase());
  const out = [];
  const push = (raw) => {
    for (const n of nameNeedles(raw)) {
      const k = n.toLowerCase();
      if (skip.has(k) || out.some(x => x.toLowerCase() === k)) continue;
      out.push(n);
    }
  };
  try {
    for (const m of getCastMembers(storage)) {
      if (!m || m.id === char?.id || m.priority === 'director') continue;
      push(m.name);
      for (const a of m.aliases || []) push(a);
    }
    const star = getStarMember(storage);
    if (star && star.id !== char?.id) {
      push(star.name);
      push('Star');
    }
  } catch { /* ignore */ }
  for (const n of extra || []) push(n);
  return out.sort((a, b) => b.length - a.length);
}

function sentenceEndAfter(text, from) {
  const slice = String(text || '').slice(Math.max(0, from));
  const m = slice.match(/[.!?]["”']?(?:\s+|$)|[\n\r]{2,}/);
  if (!m) return String(text || '').length;
  return Math.max(0, from) + m.index + m[0].length;
}

/**
 * Keep the cued speaker's beat; drop the next character's answering turn.
 * Cuts after a look-for-reaction, or from another name taking over dialogue.
 */
export function clipCueToPov(text, { speaker = '', others = [] } = {}) {
  const raw = String(text || '');
  if (!raw.trim()) return raw;
  const skip = new Set(nameNeedles(speaker).map(n => n.toLowerCase()));
  const names = (others || [])
    .flatMap(nameNeedles)
    .filter(n => n.length >= 3 && !skip.has(n.toLowerCase()));
  const uniq = [];
  const seen = new Set();
  for (const n of names.sort((a, b) => b.length - a.length)) {
    const k = n.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(n);
  }
  if (!uniq.length) return raw;
  const alt = uniq.map(escapeRe).join('|');

  const lookRe = new RegExp(
    `\\b(?:turned|looked|glanced)\\s+to(?:ward|wards)?\\s+(?:the\\s+)?(?:${alt})\\b` +
    `|\\bwait(?:ed|ing)\\s+for\\s+(?:the\\s+)?(?:${alt})\\b` +
    `|\\b(?:looked|glanced)\\s+at\\s+(?:the\\s+)?(?:${alt})\\b[^\\n.]{0,48}\\b(?:react|reaction|response|answer|reply|expect)` +
    `|\\bexpectant(?:ly)?\\s+(?:at|toward|towards)\\s+(?:the\\s+)?(?:${alt})\\b` +
    `|\\bgave\\s+(?:the\\s+)?(?:${alt})\\s+a\\s+look\\b`,
    'iu',
  );
  const takeoverRe = new RegExp(
    `(?:^|[\\n\\r]|[.!?]["”']?\\s+)(?:["“][^"”\\n]{0,160}["”]\\s*,?\\s*)?(${alt})\\s*(?:[:：]|\\s+(?:said|asked|replied|answered|muttered|whispered|shouted|smirked|nodded|frowned|laughed|sighed|snorted|snapped))\\b`,
    'iu',
  );
  const thoughtRe = new RegExp(
    `(?:^|[\\n\\r]|[.!?]["”']?\\s+)(${alt})\\s+(?:thought|wondered|realized|decided)\\b`,
    'iu',
  );
  const actionRe = new RegExp(
    `(?:^|[\\n\\r]{2,}|[.!?]["”']?\\s+)(${alt})(?:['’]s)?\\s+(?:fingers|hands|hand|eyes|gaze|voice|boot|boots|wing|wings|shoulders|elbow|arm|arms)\\b` +
    `|(?:^|[\\n\\r]{2,})(${alt})\\s+(?:turned|stepped|walked|reached|caught|grabbed|stood|moved|slid|folded|swallowed|said|asked)\\b`,
    'iu',
  );

  let cut = raw.length;
  const look = lookRe.exec(raw);
  if (look) {
    const end = sentenceEndAfter(raw, look.index);
    if (end < raw.length) cut = Math.min(cut, end);
  }
  cut = cutFromTakeover(raw, takeoverRe.exec(raw), alt, cut);
  cut = cutFromNameMatch(raw, thoughtRe.exec(raw), alt, cut);
  cut = cutFromNameMatch(raw, actionRe.exec(raw), alt, cut);
  if (cut >= raw.length || cut <= 0) return raw;
  return raw.slice(0, cut).replace(/\s+$/g, '').trimEnd();
}

function cutFromNameMatch(raw, match, alt, cut) {
  if (!match) return cut;
  const rel = match[0].search(new RegExp(alt, 'iu'));
  const from = rel >= 0 ? match.index + rel : match.index;
  if (from > 0 && from < cut) return from;
  return cut;
}

/** True when the opening paragraph is the cued speaker, or names nobody else. */
export function cueOwnsOpening(text, speaker, others = []) {
  const first = String(text || '').split(/\r?\n\s*\r?\n/)[0];
  const hit = (name) => nameNeedles(name).some((n) => {
    if (n.length < 3) return false;
    const re = new RegExp(`\\b${String(n).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    return re.test(first);
  });
  if (hit(speaker)) return true;
  if ((others || []).some(hit)) return false;
  return true;
}

function cutFromTakeover(raw, match, alt, cut) {
  if (!match) return cut;
  const chunk = match[0];
  const quoteAt = chunk.search(/["“]/);
  const nameAt = chunk.search(new RegExp(alt, 'iu'));
  const rel = quoteAt >= 0 && (nameAt < 0 || quoteAt < nameAt) ? quoteAt : nameAt;
  const from = rel >= 0 ? match.index + rel : match.index;
  if (from > 0 && from < cut) return from;
  return cut;
}

function buildCuePresenceLines(storage, char, others = [], starName = 'the Star') {
  const lines = [];
  try {
    const members = getCastMembers(storage).filter(m => m && m.id !== char?.id && m.priority !== 'director');
    const bs = storage?.getChat?.('backstage', {}) || {};
    const pings = bs?.stage?.sonar?.pings || {};
    const charPing = char ? (pings[String(char.id || char.name)] || null) : null;
    const boardHeld = Boolean(bs?.trackers?.scene?.boardHeld || bs?.now?.held);
    const heldPlaceId = boardHeld
      ? String(bs?.trackers?.scene?.travel?.placeId || bs?.now?.occupancy?.placeId || bs?.stage?.activeRoomId || '').trim()
      : '';
    const activePlaceId = (heldPlaceId && !charPing?.locked)
      ? heldPlaceId
      : String(charPing?.placeId || bs?.stage?.sonar?.lastPlaceId || bs?.stage?.activeRoomId || '').trim();

    // The cued character's OWN mode/location — without this, nothing stops the
    // model from writing them walking up to / arriving at a room they're only
    // supposed to be reaching by phone, a bug, or some other remote channel.
    const ownPres = char ? normalizeCastPresence(char) : 'inPlay';
    if (ownPres === 'privy') {
      const via = charPing?.listeningVia ? `via ${charPing.listeningVia}` : 'listening in remotely';
      const where = charPing?.awayLabel ? ` — ${charPing.awayLabel}` : '';
      lines.push(`YOU are Privy right now: ${via}${where}. You are NOT physically in the room. Do not write yourself arriving, walking up, entering, or being seen in person — stay at your actual remote position and act only through that channel (the call, the bug, the radio, etc.).`);
    } else if (ownPres !== 'inPlay' && (charPing?.away || (activePlaceId && charPing?.placeId && charPing.placeId !== activePlaceId))) {
      const where = charPing?.awayLabel ? ` — ${charPing.awayLabel}` : '';
      lines.push(`YOU are elsewhere right now${where}, not physically in the scene's current room. Do not write yourself walking in or arriving unless this beat is explicitly you traveling there.`);
    }

    const physical = [];
    const listening = [];
    const outside = [];

    for (const m of members) {
      const name = String(m.name || '').trim();
      if (!name) continue;
      const pres = normalizeCastPresence(m);
      if (pres === 'writtenOut' || pres === 'absent') continue;
      const ping = pings[String(m.id || name)] || pings[name.toLowerCase()] || null;
      if (pres === 'privy' || (!heldPlaceId && ping?.listening)) {
        const via = ping?.listeningVia ? `via ${ping.listeningVia}` : 'listening in';
        const where = ping?.awayLabel ? ` · ${ping.awayLabel}` : '';
        listening.push(`${name} (${via}${where})`);
        continue;
      }
      if ((!heldPlaceId || ping?.locked) && ping?.away) {
        const where = ping?.awayLabel ? ` (${ping.awayLabel})` : '';
        outside.push(`${name}${where}`);
        continue;
      }
      if ((!heldPlaceId || ping?.locked) && activePlaceId && ping?.placeId && ping.placeId !== activePlaceId) {
        const otherRoom = bs?.stage?.rooms?.[ping.placeId]?.name || '';
        outside.push(otherRoom ? `${name} (in ${otherRoom})` : name);
        continue;
      }
      physical.push(name);
    }

    if (physical.length) {
      lines.push(`Physically in scene with ${char?.name || 'you'} (do not write as them): ${physical.join(', ')}.`);
    } else if (others.length) {
      lines.push(`Other cast (do not write as them): ${others.join(', ')}.`);
    } else {
      lines.push(`Other cast (do not write as them): ${starName}.`);
    }
    if (listening.length) {
      lines.push(`Listening in remotely (NOT physically in the room — do not treat as standing in the room or write as them): ${listening.join(', ')}.`);
    }
    if (outside.length) {
      lines.push(`Outside / elsewhere (not in the room — do not write as them): ${outside.join(', ')}.`);
    }
  } catch {
    lines.push(others.length
      ? `Other cast (do not write as them): ${others.join(', ')}.`
      : `Other cast (do not write as them): ${starName}.`);
  }
  return lines.join('\n');
}

export function buildCastCuePrompt(storage, char, ctx = {}) {
  const beat = String(ctx.directorBeat || '').trim();
  const extra = beat ? `\n[DIRECTOR BEAT] ${clipText(beat, 600)}` : '';
  const others = Array.isArray(ctx.others) ? ctx.others : cueOtherNames(storage, char, ctx.extraNames);
  let starName = 'the Star';
  try {
    const star = getStarMember(storage);
    if (star?.name) starName = star.name;
  } catch { /* ignore */ }
  const headLine = `HEAD: ${starName} is the Star / scene lead ({{user}}). Do not write as them.`;
  const otherLine = buildCuePresenceLines(storage, char, others, starName);
  if (char?.priority === 'director') {
    const block = formatDirectorPromptBlock(storage, { char, includeHooks: true, includeNotes: true });
    return `[CUE — You are the Director. Write ONE in-world stage beat in close third person from the production's eye, following your dials and notes.
${headLine}
RESTRICTED POV: This beat only. Do not write as {{user}} / ${starName}. Do not speak in a named cast member's first-person voice. Do not play a conversation.
POV LOCK: Never write another character's dialogue, inner thoughts, or answering reaction. Do not narrate omnisciently what "the room" or "everyone" does.
HAND OFF: When a named cast member would react, STOP. End the reply on that look.
${compactTurnTimeInstruct()}
${otherLine}
${clipText(block, 1800)}${extra}]`;
  }
  const identity = resolveCastPromptIdentity(char, storage, {
    characters: ctx.characters ?? [],
    personas: ctx.personas ?? [],
  });
  const name = identity.displayName || identity.name || char.name || 'Unnamed';
  const dossier = buildCastCueDossier(storage, char, ctx);
  const asDirector = ctx.cardDump === 'own' && identity.fallback;
  const voice = asDirector
    ? `Write this turn ONLY as ${name} (restricted POV), applying the cued character’s information on top of the Director’s card. Do not narrate as Director.`
    : `Write this turn ONLY as ${name} (restricted POV), in their voice, with their name on the line. Do not narrate as Director.`;
  return `[CUE — ${voice}
${headLine}
RESTRICTED POV: ${name}'s speech, body, and mind only. Credit this turn as ${name}. No other speaker.
POV LOCK: Stay inside ${name}. Never write {{user}} / ${starName}'s dialogue. Never write another character's dialogue, inner thoughts, or answering beat. Do not use omniscient narration ("the room reacts", "everyone turns"). Do not narrate as the Director.
HAND OFF: If you look to someone for a reaction, END the reply on that look. Do not write what they do or say next.
${compactTurnTimeInstruct()}
${otherLine}
In their speech this is their life. Do not have them mention a script, scene, card, file, episode, or production code.
If this beat is plot-significant, you may form a private take (opinion, reading, rumor, or secret) in ${name}'s voice. Banter does not get filed.
${clipText(dossier, 1600)}${extra}]`;
}

export function smokeCuePovPure() {
  const others = ['Bob', 'Jordan'];
  const look = clipCueToPov(
    'Alice turned toward Bob, waiting.\n\nBob smirked. "You\'re late."',
    { speaker: 'Alice', others },
  );
  if (!/turned toward Bob/.test(look) || /smirked/.test(look)) return `look-cut: ${look}`;
  const take = clipCueToPov(
    'Alice set the cup down.\nBob said, "Don\'t."',
    { speaker: 'Alice', others },
  );
  if (/Bob said/.test(take) || !/cup/.test(take)) return `takeover: ${take}`;
  const keep = clipCueToPov(
    'Alice watched Bob across the room and kept talking to the Star.',
    { speaker: 'Alice', others },
  );
  if (!/kept talking/.test(keep)) return `observe-keep: ${keep}`;
  const thought = clipCueToPov(
    'Alice set the cup down.\nBob thought she was late.',
    { speaker: 'Alice', others },
  );
  if (/Bob thought/.test(thought) || !/cup/.test(thought)) return `thought-cut: ${thought}`;
  const quoted = clipCueToPov(
    'Alice waited by the door.\n"Don\'t," Bob replied.',
    { speaker: 'Alice', others },
  );
  if (/Bob replied/.test(quoted) || /Don't/.test(quoted) || !/waited/.test(quoted)) {
    return `quote-attr: ${quoted}`;
  }
  const passage = clipCueToPov(
    'Hawks slid his hands into his jacket pockets.\n\n"Nice," he said.\n\nMrs. Okisato\'s fingers found the crease of Weslie\'s elbow. "The stairs are east," she said.',
    { speaker: 'Hawks', others: ['Mrs. Okisato', 'Weslie'] },
  );
  if (/Okisato/.test(passage) || /stairs are east/.test(passage) || !/Nice/.test(passage)) {
    return `action-takeover: ${passage}`;
  }
  if (!cueOwnsOpening(passage, 'Hawks', ['Mrs. Okisato', 'Weslie'])) return 'hawks-owns-opening';
  if (cueOwnsOpening('Mrs. Okisato turned toward the stockroom.', 'Hawks', ['Mrs. Okisato'])) {
    return 'okisato-opening-is-not-hawks';
  }
  const forced = forceChidForGroupCue(
    { chid: 2, source: 'card' },
    { characters: [{}, {}, { avatar: 'hawks.png' }], groupMembers: ['hawks.png', 'okisato.png'] },
  );
  if (forced !== 2) return `force-member: ${forced}`;
  const outsider = forceChidForGroupCue(
    { chid: 1, source: 'card' },
    { characters: [{}, { avatar: 'stranger.png' }], groupMembers: ['hawks.png'] },
  );
  if (outsider !== null) return `force-outsider: ${outsider}`;
  const solo = forceChidForGroupCue(
    { chid: 0, source: 'current' },
    { characters: [{ avatar: 'a.png' }], groupMembers: null },
  );
  if (solo !== null) return 'force-solo';
  try {
    const stub = { getChat() { return { characters: [] }; } };
    const prompt = buildCastCuePrompt(
      stub,
      { id: 'a', name: 'Alice', priority: 'lead' },
      { others: ['Bob'], cardDump: 'none' },
    );
    if (!/RESTRICTED POV/.test(prompt) || !/Stay inside Alice/.test(prompt) || !/HEAD:/.test(prompt)) {
      return `prompt-lock: ${prompt.slice(0, 180)}`;
    }
    if (!/\[TIME\|\+8m\]/.test(prompt)) return 'cue prompt should require a turn time tag';
    const dir = buildCastCuePrompt(
      stub,
      { id: 'd', name: 'Director', priority: 'director' },
      { others: ['Alice'] },
    );
    if (!/RESTRICTED POV/.test(dir) || !/HAND OFF/.test(dir)) {
      return `director-lock: ${dir.slice(0, 180)}`;
    }
    // A Privy cue (e.g. listening in on a phone call) must tell the model NOT
    // to write that character physically arriving/entering — their own
    // presence, not just everyone else's, has to be constrained.
    const privyStub = {
      getChat(key) {
        if (key === 'backstage') {
          return { stage: { sonar: { pings: { o: { listeningVia: 'phone', awayLabel: 'outside the duplex' } } } } };
        }
        return { characters: [] };
      },
    };
    const privyPrompt = buildCastCuePrompt(
      privyStub,
      { id: 'o', name: 'Mrs. Okisato', priority: 'lead', presence: 'privy' },
      { others: ['Weslie'], cardDump: 'none' },
    );
    if (!/YOU are Privy/.test(privyPrompt) || !/via phone/.test(privyPrompt) || !/NOT physically in the room/.test(privyPrompt)) {
      return `privy-self-lock: ${privyPrompt.slice(0, 260)}`;
    }
  } catch (err) {
    return `prompt-smoke: ${err?.message || err}`;
  }
  if (!cueShouldYieldSpeaker({ guidedSteer: true })) return 'yield-steer';
  if (!cueShouldYieldSpeaker({ forceChid: 2 })) return 'yield-force';
  if (cueShouldYieldSpeaker({ forceChid: 2, alreadyArmed: true })) return 'yield-armed';
  if (cueShouldYieldSpeaker({ guidedSteer: true, alreadyArmed: true })) return 'yield-armed-steer';
  if (cueShouldYieldSpeaker({})) return 'yield-plain';
  if (cueShouldYieldSpeaker({ forceChid: null })) return 'yield-null';
  return '';
}

export async function registerCastCueCommand(castMod) {
  if (registered) return;
  const [{ SlashCommandParser }, { SlashCommand }, argMod] = await Promise.all([
    import('../../../../slash-commands/SlashCommandParser.js'),
    import('../../../../slash-commands/SlashCommand.js'),
    import('../../../../slash-commands/SlashCommandArgument.js'),
  ]);
  const { ARGUMENT_TYPE, SlashCommandArgument, SlashCommandNamedArgument } = argMod;
  registered = true;
  SlashCommandParser.addCommandObject(SlashCommand.fromProps({
    name: 'cue',
    aliases: ['st-cue'],
    helpString: `
            <div>Showtime — cue a Cast member to speak in chat (icon, name, Cast/Reputation/Motivation context).</div>
            <div><strong>Example:</strong> <code>/cue Alice</code> · <code>/cue beat="look at Bob" Alice</code></div>`,
    namedArgumentList: [
      SlashCommandNamedArgument.fromProps({
        name: 'beat',
        description: 'Optional direction for this cue',
        typeList: [ARGUMENT_TYPE.STRING],
        isRequired: false,
      }),
    ],
    unnamedArgumentList: [
      SlashCommandArgument.fromProps({
        description: 'Cast name',
        typeList: [ARGUMENT_TYPE.STRING],
        isRequired: true,
        acceptsMultiple: true,
      }),
    ],
    callback: async (named, unnamed) => {
      const needle = Array.isArray(unnamed) ? unnamed.join(' ') : String(unnamed || '');
      const char = findCastByNameOrAlias(castMod.storage, needle, { includeDirector: false });
      if (!char) return `No cast member named "${needle.trim()}".`;
      if (char.priority === 'star') return 'The Star is {{user}} — cue another cast member.';
      const directorBeat = String(named?.beat || '').trim();
      try {
        await castMod.cueCast(char, { directorBeat });
        return `Cued ${char.name}.`;
      } catch (err) {
        return `Cue failed: ${err?.message || err}`;
      }
    },
  }));
  SlashCommandParser.addCommandObject(SlashCommand.fromProps({
    name: 'cue-sheet',
    aliases: ['st-cue-sheet'],
    helpString: `
            <div>Showtime — Call or Hold the Cast Cue Sheet.</div>
            <div><strong>Example:</strong> <code>/cue-sheet call</code> · <code>/cue-sheet hold</code></div>`,
    unnamedArgumentList: [
      SlashCommandArgument.fromProps({
        description: 'call or hold',
        typeList: [ARGUMENT_TYPE.STRING],
        isRequired: false,
        enumList: ['call', 'hold'],
      }),
    ],
    callback: async (_named, unnamed) => {
      const verb = String(Array.isArray(unnamed) ? unnamed[0] : unnamed || 'call').trim().toLowerCase();
      if (verb === 'hold' || verb === 'stop') {
        castMod.holdCueSheet?.();
        return 'Cue Sheet held.';
      }
      try {
        await castMod.callCueSheet?.();
        return 'Cue Sheet called.';
      } catch (err) {
        return `Cue Sheet failed: ${err?.message || err}`;
      }
    },
  }));
}
