// Room Compass — SillyTavern slash commands.

import { SlashCommandParser } from '../../../../../slash-commands/SlashCommandParser.js';
import { SlashCommand } from '../../../../../slash-commands/SlashCommand.js';
import { ARGUMENT_TYPE, SlashCommandArgument } from '../../../../../slash-commands/SlashCommandArgument.js';
import { getStarMember } from '../castCatalog.js';
import { invalidateRenderCache, renderAsciiGrid } from './render.js';
import { PLACE_KINDS, buildPlaceTree } from './schema.js';
import {
  ensureCompass,
  createAndStoreRoom,
  loadRoom,
  unloadRoom,
  requireActive,
  addItem,
  setItemState,
  pickupItem,
  addPickupToInventory,
  setExit,
  clearExit,
  addOccupant,
  moveOccupant,
  faceOccupant,
  removeOccupant,
  undoLastChange,
  addLink,
  addOpening,
} from './state.js';

let registered = false;

/**
 * @param {{ storage: object, bus?: object, save?: () => void, refresh?: () => void }} ctx
 */
export function registerCompassCommands(ctx) {
  if (registered) return;
  registered = true;

  const save = () => {
    invalidateRenderCache();
    ctx.save?.();
    ctx.bus?.emit?.('showtime.stateChanged');
    ctx.refresh?.();
  };

  const compass = () => {
    const st = ctx.storage.getChat('backstage', {});
    return ensureCompass(st);
  };

  const activeId = () => {
    const c = compass();
    const room = requireActive(c);
    return room.id;
  };

  SlashCommandParser.addCommandObject(SlashCommand.fromProps({
    name: 'room',
    aliases: ['st-room'],
    helpString: `
            <div>Showtime Room Compass — create / load / unload / list places.</div>
            <div><strong>Examples:</strong>
            <ul>
              <li><code>/room create study The Old Study</code></li>
              <li><code>/room create hall Grand Hall kind=transitional parent=manor</code></li>
              <li><code>/room load study</code></li>
              <li><code>/room unload</code></li>
              <li><code>/room list</code></li>
              <li><code>/room note N wall = fireplace</code></li>
              <li><code>/room preview</code></li>
            </ul></div>`,
    unnamedArgumentList: [
      SlashCommandArgument.fromProps({
        description: 'subcommand + args',
        typeList: [ARGUMENT_TYPE.STRING],
        isRequired: true,
        acceptsMultiple: true,
      }),
    ],
    callback: async (_named, unnamed) => {
      try {
        const parts = splitArgs(unnamed);
        const sub = (parts[0] || '').toLowerCase();
        const c = compass();
        if (sub === 'list') {
          const tree = buildPlaceTree(c);
          if (!tree.length) return 'No places yet. Use Stage/Set buttons or /room create <id> <name>';
          return tree.map(({ place, depth }) => {
            const pad = '  '.repeat(depth);
            const mark = place.id === c.activeRoomId ? '●' : '○';
            const tags = (place.locationTags || []).length ? ` · loc:${place.locationTags.join(',')}` : '';
            return `${pad}${mark} [${place.kind}] ${place.id} — ${place.name}${tags}`;
          }).join('\n');
        }
        if (sub === 'create') {
          const flags = parseFlags(parts.slice(1));
          const id = flags.rest[0];
          const name = flags.rest.slice(1).join(' ') || id;
          if (!id && !name) return 'Usage: /room create <id> <name> [kind=room] [parent=id] [tag=Location]';
          const room = createAndStoreRoom(c, {
            id: id || undefined,
            name: name || id,
            kind: flags.kind || 'room',
            parentId: flags.parent || '',
            locationTags: flags.tag ? [flags.tag] : [],
          });
          if (room.kind === 'room' || room.kind === 'transitional') loadRoom(c, room.id);
          save();
          return `Created ${room.kind} "${room.id}" (${room.name})${room.parentId ? ` under ${room.parentId}` : ''}.`;
        }
        if (sub === 'load') {
          const id = parts[1];
          if (!id) return 'Usage: /room load <id>';
          loadRoom(c, id);
          save();
          return `Loaded room "${id}".`;
        }
        if (sub === 'unload') {
          unloadRoom(c);
          save();
          return 'Room unloaded — compass injection cleared.';
        }
        if (sub === 'note') {
          const room = requireActive(c);
          const note = parts.slice(1).join(' ');
          room.orientation_note = note;
          room.updatedAt = Date.now();
          save();
          return `orientation_note set (author-only, not injected): ${note || '(cleared)'}`;
        }
        if (sub === 'preview') {
          const room = requireActive(c);
          return renderAsciiGrid(room);
        }
        if (sub === 'kinds') {
          return PLACE_KINDS.map(k => `${k.id} — ${k.label}${k.hasGrid ? ' (grid)' : ''}`).join('\n');
        }
        return 'Unknown /room subcommand. Try: create, load, unload, list, note, preview, kinds';
      } catch (err) {
        return `Room error: ${err.message || err}`;
      }
    },
  }));

  SlashCommandParser.addCommandObject(SlashCommand.fromProps({
    name: 'occ',
    aliases: ['st-occ'],
    helpString: `
            <div>Room occupants — add / move / face / remove.</div>
            <div>Facing is cardinal only (N E S W). Diagonals are rejected.</div>`,
    unnamedArgumentList: [
      SlashCommandArgument.fromProps({
        description: 'subcommand + args',
        typeList: [ARGUMENT_TYPE.STRING],
        isRequired: true,
        acceptsMultiple: true,
      }),
    ],
    callback: async (_named, unnamed) => {
      try {
        const parts = splitArgs(unnamed);
        const sub = (parts[0] || '').toLowerCase();
        const c = compass();
        const rid = activeId();
        if (sub === 'add') {
          const name = parts[1];
          const cell = parts[2] || 'C';
          const facing = parts[3] || 'N';
          if (!name) return 'Usage: /occ add <name> [cell] [facing]';
          addOccupant(c, rid, { name, cell, facing });
          save();
          return `Occupant ${name} @ ${cell.toUpperCase()} facing ${facing.toUpperCase()}.`;
        }
        if (sub === 'move') {
          const name = parts[1];
          const cell = parts[2];
          if (!name || !cell) return 'Usage: /occ move <name> <cell>';
          moveOccupant(c, rid, { name, cell });
          save();
          return `Moved ${name} → ${cell.toUpperCase()}.`;
        }
        if (sub === 'face') {
          const name = parts[1];
          const facing = parts[2];
          if (!name || !facing) return 'Usage: /occ face <name> <N|E|S|W>';
          faceOccupant(c, rid, { name, facing });
          save();
          return `${name} now faces ${facing.toUpperCase()}.`;
        }
        if (sub === 'remove') {
          const name = parts[1];
          if (!name) return 'Usage: /occ remove <name>';
          removeOccupant(c, rid, { name });
          save();
          return `Removed occupant ${name}.`;
        }
        return 'Unknown /occ subcommand. Try: add, move, face, remove';
      } catch (err) {
        return `Occ error: ${err.message || err}`;
      }
    },
  }));

  SlashCommandParser.addCommandObject(SlashCommand.fromProps({
    name: 'item',
    aliases: ['st-item'],
    helpString: `<div>Room items — add / state / pickup (→ Inventory).</div>`,
    unnamedArgumentList: [
      SlashCommandArgument.fromProps({
        description: 'subcommand + args',
        typeList: [ARGUMENT_TYPE.STRING],
        isRequired: true,
        acceptsMultiple: true,
      }),
    ],
    callback: async (_named, unnamed) => {
      try {
        const parts = splitArgs(unnamed);
        const sub = (parts[0] || '').toLowerCase();
        const c = compass();
        const rid = activeId();
        if (sub === 'add') {
          const cell = parts[1];
          const name = parts[2];
          const state = parts.slice(3).join(' ');
          if (!cell || !name) return 'Usage: /item add <cell> <name> [state…]';
          const it = addItem(c, rid, { cell, name, state });
          save();
          return `Added ${it.name} @ ${cell.toUpperCase()}${state ? ` (${state})` : ''}.`;
        }
        if (sub === 'state') {
          const name = parts[1];
          const state = parts.slice(2).join(' ');
          if (!name) return 'Usage: /item state <name> <state…>';
          setItemState(c, rid, { name, state });
          save();
          return `Updated state on ${name}.`;
        }
        if (sub === 'pickup') {
          const name = parts[1];
          if (!name) return 'Usage: /item pickup <name>';
          const taken = pickupItem(c, rid, { name });
          addPickupToInventory(ctx.storage, taken, ctx.bus);
          save();
          const who = getStarMember(ctx.storage)?.name || 'Star';
          return `Picked up ${taken.name} → Inventory (on person / ${who}).`;
        }
        return 'Unknown /item subcommand. Try: add, state, pickup';
      } catch (err) {
        return `Item error: ${err.message || err}`;
      }
    },
  }));

  SlashCommandParser.addCommandObject(SlashCommand.fromProps({
    name: 'exit',
    aliases: ['st-exit'],
    helpString: `
            <div>Room exits / wall links.</div>
            <div><code>/exit set|clear</code> · <code>/exit link N parlor</code> · <code>/exit open &lt;linkId&gt; door W</code></div>`,
    unnamedArgumentList: [
      SlashCommandArgument.fromProps({
        description: 'subcommand + args',
        typeList: [ARGUMENT_TYPE.STRING],
        isRequired: true,
        acceptsMultiple: true,
      }),
    ],
    callback: async (_named, unnamed) => {
      try {
        const parts = splitArgs(unnamed);
        const sub = (parts[0] || '').toLowerCase();
        const c = compass();
        const rid = activeId();
        if (sub === 'set') {
          const dir = parts[1];
          const label = parts.slice(2).join(' ');
          if (!dir || !label) return 'Usage: /exit set <cell> <label…>';
          setExit(c, rid, dir, label);
          save();
          return `Exit ${dir.toUpperCase()} → ${label}`;
        }
        if (sub === 'clear') {
          const dir = parts[1];
          if (!dir) return 'Usage: /exit clear <cell>';
          clearExit(c, rid, dir);
          save();
          return `Cleared exit ${dir.toUpperCase()}.`;
        }
        if (sub === 'link') {
          const wall = parts[1];
          const to = parts[2];
          if (!wall || !to) return 'Usage: /exit link <N|E|S|W|above|below> <placeId>';
          const link = addLink(c, rid, { wall, toPlaceId: to });
          save();
          return `Linked ${link.wall} → ${link.toPlaceId} (${link.id}). Add openings in Stage/Set.`;
        }
        if (sub === 'open') {
          const linkId = parts[1];
          const type = parts[2] || 'door';
          const cell = parts[3] || '';
          const label = parts.slice(4).join(' ');
          if (!linkId) return 'Usage: /exit open <linkId> [door|window|…] [cell] [label]';
          const op = addOpening(c, rid, linkId, { type, cell, label });
          save();
          return `Opening ${op.type}${op.cell ? `@${op.cell}` : ''} on ${linkId}.`;
        }
        return 'Unknown /exit subcommand. Try: set, clear, link, open';
      } catch (err) {
        return `Exit error: ${err.message || err}`;
      }
    },
  }));

  SlashCommandParser.addCommandObject(SlashCommand.fromProps({
    name: 'compass',
    aliases: ['st-compass'],
    helpString: `<div><code>/compass undo</code> · <code>/compass preview</code></div>`,
    unnamedArgumentList: [
      SlashCommandArgument.fromProps({
        description: 'subcommand',
        typeList: [ARGUMENT_TYPE.STRING],
        isRequired: true,
        acceptsMultiple: true,
      }),
    ],
    callback: async (_named, unnamed) => {
      try {
        const parts = splitArgs(unnamed);
        const sub = (parts[0] || '').toLowerCase();
        const c = compass();
        if (sub === 'undo') {
          const r = undoLastChange(c);
          save();
          return `Undid: ${r.summary}`;
        }
        if (sub === 'preview') {
          const room = requireActive(c);
          return renderAsciiGrid(room);
        }
        return 'Unknown /compass subcommand. Try: undo, preview';
      } catch (err) {
        return `Compass error: ${err.message || err}`;
      }
    },
  }));
}

function splitArgs(unnamed) {
  if (Array.isArray(unnamed)) {
    return unnamed.map(s => String(s ?? '').trim()).filter(Boolean);
  }
  return String(unnamed || '').trim().split(/\s+/).filter(Boolean);
}

function parseFlags(parts) {
  const flags = { rest: [] };
  for (const p of parts) {
    const m = String(p).match(/^([a-zA-Z]+)=(.*)$/);
    if (m) flags[m[1].toLowerCase()] = m[2];
    else flags.rest.push(p);
  }
  return flags;
}
