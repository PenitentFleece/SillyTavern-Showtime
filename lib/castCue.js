// Cue a cast member into main chat: dossier + slash command.

import { SlashCommandParser } from '../../../../slash-commands/SlashCommandParser.js';
import { SlashCommand } from '../../../../slash-commands/SlashCommand.js';
import { ARGUMENT_TYPE, SlashCommandArgument } from '../../../../slash-commands/SlashCommandArgument.js';
import {
  findCastByNameOrAlias,
  formatDirectorPromptBlock,
  formatManualCastBrief,
  formatPronounsPromptLine,
  getCastMembers,
  getDirectorRecord,
  getStarMember,
  resolveCastPromptIdentity,
} from './castCatalog.js';
import { standingToward } from './motivationCatalog.js';
import { clipText } from './chatTrack.js';

let registered = false;

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

export function buildCastCueDossier(storage, char, {
  characters = [],
  personas = [],
  cardDump = 'own',
} = {}) {
  if (!char) return '';
  const identity = resolveCastPromptIdentity(char, storage, { characters, personas });
  const name = identity.displayName || identity.name || char.name || 'Unnamed';
  const bits = [];
  if (cardDump === 'identity' && identity.block) {
    bits.push(identity.block);
  } else {
    bits.push(`${name} (${char.priority || 'cast'})`);
    if (cardDump !== 'none' && (char.summary || char.description)) {
      bits.push(`Summary: ${clipText(String(char.summary || char.description), 800)}`);
    }
    if (cardDump === 'own' && identity.fallback) {
      bits.push(`(No linked character card — write as ${name} using the Director’s card.)`);
    }
    try {
      const extra = formatManualCastBrief(char, storage, { includeSummary: false });
      if (extra) bits.push(extra);
    } catch { /* ignore */ }
  }
  bits.push(
    formatPronounsPromptLine({ ...char, name: '' }),
    char.condition ? `Condition: ${String(char.condition).slice(0, 400)}` : '',
  );
  if (char.wardrobe?.length) bits.push(`Wardrobe: ${char.wardrobe.map(w => w.name).filter(Boolean).join(', ')}`);
  if (char.props?.length) bits.push(`Props: ${char.props.map(p => p.name).filter(Boolean).join(', ')}`);
  try {
    const stand = standingToward(storage, `cast:${char.id}`);
    if (stand != null) bits.push(`Standing toward Star: ${stand}`);
  } catch { /* ignore */ }
  try {
    const mot = storage.getChat('motivation', { perChar: {} });
    const row = mot.perChar?.[char.id];
    if (row?.achievements?.length) {
      bits.push(`Achievements: ${row.achievements.map(a => a.title).filter(Boolean).slice(0, 8).join('; ')}`);
    }
    if (row?.secrets?.length) {
      bits.push(`Own secrets: ${row.secrets.map(s => s.title).filter(Boolean).slice(0, 8).join('; ')}`);
    }
  } catch { /* ignore */ }
  try {
    const dir = formatDirectorPromptBlock(storage, { includeHooks: true });
    if (dir) bits.push(dir);
  } catch { /* ignore */ }
  return bits.filter(Boolean).join('\n');
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
    `(?:^|[\\n\\r]|[.!?]["”']?\\s+)(?:["“][^"”\\n]{0,120}["”]\\s*,\\s*)?(${alt})\\s*(?:[:：]|\\s+(?:said|asked|replied|answered|muttered|whispered|shouted|smirked|nodded|frowned|laughed|sighed|snorted|snapped))\\b`,
    'iu',
  );

  let cut = raw.length;
  const look = lookRe.exec(raw);
  if (look) {
    const end = sentenceEndAfter(raw, look.index);
    if (end < raw.length) cut = Math.min(cut, end);
  }
  const take = takeoverRe.exec(raw);
  if (take) {
    const rel = take[0].search(new RegExp(alt, 'iu'));
    const from = rel >= 0 ? take.index + rel : take.index;
    if (from > 0 && from < cut) cut = from;
  }
  if (cut >= raw.length || cut <= 0) return raw;
  return raw.slice(0, cut).replace(/\s+$/g, '').trimEnd();
}

export function buildCastCuePrompt(storage, char, ctx = {}) {
  const beat = String(ctx.directorBeat || '').trim();
  const extra = beat ? `\n[DIRECTOR BEAT] ${clipText(beat, 600)}` : '';
  const others = Array.isArray(ctx.others) ? ctx.others : cueOtherNames(storage, char, ctx.extraNames);
  const otherLine = others.length
    ? `On stage (do not write as them): ${others.join(', ')}.`
    : 'On stage: the Star.';
  if (char?.priority === 'director') {
    const block = formatDirectorPromptBlock(storage, { char, includeHooks: true, includeNotes: true });
    return `[CUE — You are the Director. Write ONE in-world stage beat in third person, following your production dials and notes. Do not write as {{user}} / the Star. Do not speak in a named cast member's first-person voice unless the beat requires a single line.
POV LOCK: Do not play out a full exchange. When a named cast member would react, STOP.
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
    ? `Write the next reply ONLY as ${name}, in their voice, applying the cued character’s information on top of the Director’s card. Do not write as {{user}} / the Star. Do not narrate as Director.`
    : `Write the next reply ONLY as ${name}, in their voice, with their name on the line. Do not write as {{user}} / the Star. Do not narrate as Director.`;
  return `[CUE — ${voice}
POV LOCK: Stay in ${name}'s body and mind. Never write another character's dialogue, inner thoughts, or answering beat.
HAND OFF: If you look to someone for a reaction, END the reply on that look. Do not write what they do or say next.
${otherLine}
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
  return '';
}

export function registerCastCueCommand(castMod) {
  if (registered) return;
  registered = true;
  SlashCommandParser.addCommandObject(SlashCommand.fromProps({
    name: 'cue',
    aliases: ['st-cue'],
    helpString: `
            <div>Showtime — cue a Cast member to speak in chat (icon, name, Cast/Reputation/Motivation context).</div>
            <div><strong>Example:</strong> <code>/cue Alice</code></div>`,
    unnamedArgumentList: [
      SlashCommandArgument.fromProps({
        description: 'Cast name',
        typeList: [ARGUMENT_TYPE.STRING],
        isRequired: true,
        acceptsMultiple: true,
      }),
    ],
    callback: async (_named, unnamed) => {
      const needle = Array.isArray(unnamed) ? unnamed.join(' ') : String(unnamed || '');
      const char = findCastByNameOrAlias(castMod.storage, needle, { includeDirector: false });
      if (!char) return `No cast member named "${needle.trim()}".`;
      if (char.priority === 'star') return 'The Star is {{user}} — cue another cast member.';
      try {
        await castMod.cueCast(char);
        return `Cued ${char.name}.`;
      } catch (err) {
        return `Cue failed: ${err?.message || err}`;
      }
    },
  }));
}
