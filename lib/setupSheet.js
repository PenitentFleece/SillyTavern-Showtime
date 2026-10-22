// First-chat setup. Every step is manual. Audits and a generated opening
// run only when asked, and nothing is filed until the user accepts it.

import { getContext, extension_settings } from '../../../../extensions.js';
import { deleteMessage, saveSettingsDebounced } from '../../../../../script.js';
import { sendMessageAs, executeSlashCommandsOnChatInput, parser } from '../../../../slash-commands.js';
import { world_names } from '../../../../world-info.js';
import { mintItem, moveItem } from './itemLocator.js';
import { adoptKit, handleKitClick, namesToKit, readKit, renderKit } from './setupKit.js';
import { leanQuietGenerate } from './isolatedGen.js';
import { listReelCatalog } from './reel.js';
import { showtimeAlert } from './dialogs.js';
import {
  PRIORITIES,
  priorityMeta,
  normalizeAliases,
  normalizePronouns,
  PRONOUN_APPARENT_OPTIONS,
  PRONOUN_PREFERRED_OPTIONS,
  DIRECTION_FIELDS,
  normalizeDirectorDirection,
} from './castCatalog.js';

const DISMISS_KEY = 'setupDismissed';
const PRIORITY_IDS = new Set(PRIORITIES.map(p => p.id));

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, ch => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

function rootSettings() {
  if (!extension_settings.showtime || typeof extension_settings.showtime !== 'object') {
    extension_settings.showtime = {};
  }
  return extension_settings.showtime;
}

function chatPeople() {
  const ctx = getContext();
  const group = (ctx.groups || []).find(g => g.id === ctx.groupId);
  const list = [];
  const push = (avatar, name) => {
    const id = String(avatar || name || '').trim();
    const label = String(name || avatar || '').trim();
    if (!id || !label) return;
    if (list.some(p => p.id === id || p.name === label)) return;
    list.push({ id, name: label, cardId: avatar ? String(avatar) : '' });
  };
  if (group?.members?.length) {
    for (const member of group.members) {
      const card = (ctx.characters || []).find(c => c.avatar === member || c.name === member);
      push(card?.avatar || member, card?.name || member);
    }
    return { people: list, group: true };
  }
  const solo = (ctx.characters || [])[ctx.characterId];
  if (solo) push(solo.avatar, solo.name);
  return { people: list, group: false };
}

function greetingBatch(people) {
  const chat = getContext()?.chat;
  if (!Array.isArray(chat)) return false;
  if (!chat.length) return true;
  if (chat.some(m => m?.is_user)) return false;
  return chat.length <= Math.max(1, people.length);
}

function castIsEmpty(app) {
  const chars = app?.modules?.get?.('cast')?.state?.characters;
  return !Array.isArray(chars) || chars.length === 0;
}

export function maybeOfferSetup(app) {
  if (document.querySelector('.showtime-setup')) return;
  const id = String(getContext()?.chatId || '').trim();
  if (!id) return;
  const dismissed = rootSettings()[DISMISS_KEY];
  if (Array.isArray(dismissed) && dismissed.includes(id)) return;
  if (!castIsEmpty(app)) return;
  const { people, group } = chatPeople();
  if (!people.length) return;
  if (!greetingBatch(people)) return;
  openSetupSheet(app, { id, people, group });
}

function dismiss(chatId) {
  const root = rootSettings();
  const list = Array.isArray(root[DISMISS_KEY]) ? root[DISMISS_KEY] : [];
  if (!list.includes(chatId)) list.push(chatId);
  root[DISMISS_KEY] = list.slice(-80);
  saveSettingsDebounced();
}

function optionList(options, selected) {
  return options.map(o => (
    `<option value="${esc(o.id)}" ${o.id === selected ? 'selected' : ''}>${esc(o.label)}</option>`
  )).join('');
}

function dirSelect(id, selected) {
  const field = DIRECTION_FIELDS[id];
  if (!field) return '';
  return `<label>${esc(field.label)}
    <select data-dir="${esc(id)}">
      ${field.options.map(o => `<option value="${esc(o.id)}" ${o.id === selected ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
    </select>
  </label>`;
}

function directorBlockHTML() {
  const d = normalizeDirectorDirection();
  const dials = ['genre', 'culture', 'era', 'narratorTone', 'verbosity', 'personality', 'difficulty', 'friction', 'pace'];
  return `
    <div data-director-only hidden>
      <p class="showtime-setup-note">Production dials. These keywords feed Director events, audits, and any prompt that asks the Director.</p>
      <div class="showtime-setup-dials">
        ${dials.map(id => dirSelect(id, d[id])).join('')}
        <label class="showtime-setup-dir-wide">Casual obscenity
          <span class="showtime-setup-check"><input type="checkbox" data-dir="casualObscenity" ${d.casualObscenity ? 'checked' : ''}> Sex isn’t publicly shamed — frank talk / public intimacy is ordinary</span>
        </label>
        <label class="showtime-setup-dir-wide">Lewd and unusual punishment
          <span class="showtime-setup-check"><input type="checkbox" data-dir="lewdPunishment" ${d.lewdPunishment ? 'checked' : ''}> Sexual discipline is an ordinary penalty — commonplace, not necessarily wanted</span>
        </label>
        ${dirSelect('lupSeverity', d.lupSeverity)}
        ${dirSelect('lupConsent', d.lupConsent)}
      </div>
      <label>Additional notes
        <textarea data-dir="notes" rows="3" placeholder="House rules, taboos to keep, recurring motifs, OOC reminders…"></textarea>
      </label>
    </div>`;
}

function cardLinkOptions(selected) {
  const ctx = getContext();
  const cards = (ctx?.characters || []).filter(c => c?.avatar && String(c.name || '').trim());
  const group = (ctx?.groups || []).find(g => g.id === ctx?.groupId);
  const inChat = new Set((group?.members || []).map(m => String(m || '')));
  const opt = (c) => `<option value="${esc(c.avatar)}" ${c.avatar === selected ? 'selected' : ''}>${esc(c.name)}</option>`;
  const here = cards.filter(c => inChat.has(c.avatar) || inChat.has(c.name));
  const rest = cards.filter(c => !here.includes(c));
  return `<option value="">No character card</option>${
    here.length ? `<optgroup label="In this chat">${here.map(opt).join('')}</optgroup>` : ''
  }${
    rest.length ? `<optgroup label="All characters">${rest.map(opt).join('')}</optgroup>` : ''
  }`;
}

function personRowHTML(person) {
  const name = String(person?.name || '').trim();
  return `
    <details class="showtime-setup-person" data-person="${esc(person.id)}" data-card="${esc(person.cardId || '')}" data-seed-name="${esc(name)}">
      <summary>
        <span class="showtime-setup-swatch" data-swatch></span>
        <span data-summary-name>${esc(name)}</span>
        <span class="showtime-setup-role" data-summary-role>Unset</span>
        <span class="showtime-setup-row-actions">
          <button type="button" data-action="merge-person">Merge</button>
          <button type="button" data-action="remove-person">Remove</button>
        </span>
      </summary>
      <div class="showtime-setup-profile">
        <label>Billing
          <select data-priority>
            <option value="">Leave unset</option>
            ${PRIORITIES.map(p => `<option value="${esc(p.id)}">${esc(p.label)}</option>`).join('')}
          </select>
        </label>
        <label>Name
          <input type="text" data-name value="${esc(name)}">
        </label>
        <label data-cast-only>Aliases
          <input type="text" data-aliases placeholder="Comma-separated">
        </label>
        <label>Portrait URL
          <input type="text" data-portrait>
        </label>
        <div class="showtime-setup-pronouns" data-cast-only>
          <label>Apparent
            <select data-pronouns-apparent>
              <option value="">—</option>
              ${optionList(PRONOUN_APPARENT_OPTIONS, '')}
            </select>
          </label>
          <label>Preferred
            <select data-pronouns-preferred>
              <option value="">—</option>
              ${optionList(PRONOUN_PREFERRED_OPTIONS, '')}
            </select>
          </label>
        </div>
        <div class="showtime-setup-pronouns" data-pronouns-custom data-cast-only hidden>
          <label>Possessive
            <input type="text" data-pronouns-possessive placeholder="their">
          </label>
          <label>Personal
            <input type="text" data-pronouns-personal placeholder="they">
          </label>
          <label>Reflexive
            <input type="text" data-pronouns-reflexive placeholder="themselves">
          </label>
        </div>
        <label>Character card
          <select data-card-link>
            ${cardLinkOptions(person.cardId)}
          </select>
        </label>
        <label data-manual-only>Appearance
          <textarea data-appearance rows="2" placeholder="Build, face, how they read at a glance"></textarea>
        </label>
        <label data-manual-only>Summary
          <textarea data-summary rows="2" placeholder="Who they are in this production"></textarea>
        </label>
        <div data-reply-as-wrap data-director-only hidden>
          <label>Reply as
            <select data-reply-as>
              <option value="">Director card name</option>
            </select>
          </label>
        </div>
        ${directorBlockHTML()}
        <div data-kit>
          <p class="showtime-setup-note">Wardrobe is worn. Props are carried, and a container can hold what is inside it. Closet looks are chips in the order they are put on. Condition and type are the tags.</p>
          <div data-kit-view="wardrobe"></div>
          <div data-kit-view="props"></div>
          <div data-kit-view="closet"></div>
          <label>Guidance
            <textarea data-kit-guide rows="2" placeholder="Optional note for a suggestion."></textarea>
          </label>
          <button type="button" data-action="suggest-kit">Suggest</button>
        </div>
      </div>
    </details>`;
}

function openSetupSheet(app, { id, people, group }) {
  const host = document.createElement('div');
  host.className = 'showtime-setup';
  const books = (world_names || []).map(n => String(n || '').trim()).filter(Boolean);
  const reels = listReelCatalog(extension_settings);
  host.innerHTML = `
    <form class="showtime-setup-card">
      <h2>Set the stage</h2>
      <p class="showtime-setup-note">Nothing here is filed until you press Apply. This sheet does not create a script card.</p>
      ${group ? `<section>
        <h3>Opening greetings</h3>
        <label class="showtime-setup-check"><input type="checkbox" data-clear-greetings> Clear the automatic introductions</label>
      </section>` : ''}
      <section>
        <h3>Who is who</h3>
        <p class="showtime-setup-note">Open a name to set billing and profile. Leave unset to keep them off the cast. Merge folds a duplicate into the row you keep. Remove drops a row from this sheet.</p>
        <div class="showtime-setup-reel">
          <select data-reel ${reels.length ? '' : 'disabled'}>
            ${reels.length
              ? reels.map(r => `<option value="${esc(r.file)}">${esc(r.title || r.file)}</option>`).join('')
              : '<option value="">No reels on the shelf</option>'}
          </select>
          <button type="button" data-action="import-reel">Import cast</button>
        </div>
        <div data-cast-list>
          ${people.map(personRowHTML).join('')}
        </div>
      </section>
      <section>
        <h3>First post</h3>
        <textarea data-opening rows="5" placeholder="Write the opening in the Director's voice, or leave this and generate one after the lore step."></textarea>
        <label>Guidance for a generated opening
          <textarea data-opening-guide rows="2" placeholder="Optional. Used only if you ask for a draft."></textarea>
        </label>
        <button type="button" data-action="draft-opening">Draft from the shelved lore</button>
      </section>
      <section>
        <h3>Lore in play</h3>
        <p class="showtime-setup-note">Checked books are shelved in the Library and given to the Director's draft.</p>
        <div class="showtime-setup-books">
          ${books.length ? books.map(name => `<label><input type="checkbox" data-book="${esc(name)}"> ${esc(name)}</label>`).join('') : '<p>No lorebooks on this install.</p>'}
        </div>
      </section>
      <div class="showtime-setup-actions">
        <button type="button" data-action="dismiss">Not now</button>
        <button type="submit">Apply</button>
      </div>
    </form>`;
  document.body.appendChild(host);

  const close = () => host.remove();
  host.querySelector('[data-action="dismiss"]').addEventListener('click', () => {
    dismiss(id);
    close();
  });
  host.addEventListener('click', (e) => {
    const mergeBtn = e.target.closest?.('[data-action="merge-person"]');
    const removeBtn = e.target.closest?.('[data-action="remove-person"]');
    if ((mergeBtn || removeBtn) && host.contains(mergeBtn || removeBtn)) {
      e.preventDefault();
      e.stopPropagation();
      const row = (mergeBtn || removeBtn).closest('[data-person]');
      if (removeBtn && row) removePerson(host, row);
      else if (mergeBtn && row) {
        if (host._mergeSource && host._mergeSource !== row) mergeInto(host, host._mergeSource, row);
        else armMerge(host, row);
      }
      return;
    }
  }, true);
  host.addEventListener('click', (e) => {
    const kitBtn = e.target.closest?.('[data-kit-action]');
    if (kitBtn && host.contains(kitBtn)) {
      const row = kitBtn.closest('[data-person]');
      if (row) handleKitClick(row, kitBtn);
      return;
    }
    const suggest = e.target.closest?.('[data-action="suggest-kit"]');
    if (suggest && host.contains(suggest)) {
      const row = suggest.closest('[data-person]');
      if (row) void suggestKit(host, row);
      return;
    }
    if (e.target.closest?.('[data-action="import-reel"]')) {
      void importReelCast(host);
    }
  });
  host.querySelector('[data-action="draft-opening"]').addEventListener('click', () => draftOpening(host));
  host.addEventListener('change', (e) => {
    const row = e.target.closest?.('[data-person]');
    if (!row || !host.contains(row)) return;
    if (e.target.matches('[data-priority]')) syncPerson(row);
    if (e.target.matches('[data-card-link]')) {
      row.dataset.card = e.target.value || '';
      syncPerson(row);
    }
    if (e.target.matches('[data-pronouns-preferred]')) syncPronouns(row);
  });
  host.addEventListener('input', (e) => {
    const row = e.target.closest?.('[data-person]');
    if (!row || !host.contains(row)) return;
    if (e.target.matches('[data-name]')) {
      const label = row.querySelector('[data-summary-name]');
      if (label) label.textContent = e.target.value.trim() || row.dataset.seedName || 'Unnamed';
      refreshReplyAs(host);
    }
  });
  host.querySelector('form').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('input')) e.preventDefault();
  });
  host.querySelector('form').addEventListener('submit', (e) => {
    e.preventDefault();
    void applySetup(app, host, { id, close }).catch(err => {
      console.error('[Showtime/Setup]', err);
      void showtimeAlert('Setup could not be applied.', { title: 'SETUP' });
    });
  });
  host.querySelectorAll('[data-person]').forEach(row => {
    syncPerson(row);
    renderKit(row);
  });
  refreshReplyAs(host);
}

function syncPronouns(row) {
  const wrap = row.querySelector('[data-pronouns-custom]');
  if (!wrap) return;
  wrap.hidden = row.querySelector('[data-pronouns-preferred]')?.value !== 'custom';
}

function syncPerson(row) {
  const priority = row.querySelector('[data-priority]')?.value || '';
  const meta = priority ? priorityMeta(priority) : null;
  const swatch = row.querySelector('[data-swatch]');
  if (swatch) {
    swatch.style.background = meta?.color || 'transparent';
    swatch.style.borderColor = meta?.color || '';
  }
  row.style.borderLeftColor = meta?.color || '';
  const role = row.querySelector('[data-summary-role]');
  if (role) role.textContent = meta?.label || 'Unset';
  const director = priority === 'director';
  const kit = row.querySelector('[data-kit]');
  if (kit) kit.hidden = director;
  row.querySelectorAll('[data-cast-only]').forEach(el => {
    if (el.matches('[data-pronouns-custom]')) return;
    el.hidden = director;
  });
  row.querySelectorAll('[data-director-only]').forEach(el => { el.hidden = !director; });
  const linked = !!String(row.dataset.card || '').trim();
  row.querySelectorAll('[data-manual-only]').forEach(el => { el.hidden = director || linked; });
  const custom = row.querySelector('[data-pronouns-custom]');
  if (director) {
    if (custom) custom.hidden = true;
  } else {
    syncPronouns(row);
  }
}

function refreshReplyAs(host) {
  const rows = [...host.querySelectorAll('[data-person]')];
  const names = rows.map(r => r.querySelector('[data-name]')?.value.trim()).filter(Boolean);
  for (const row of rows) {
    const sel = row.querySelector('[data-reply-as]');
    if (!sel) continue;
    const current = sel.value;
    const mine = row.querySelector('[data-name]')?.value.trim();
    const options = names.filter(n => n !== mine);
    sel.innerHTML = `<option value="">Director card name</option>${options.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('')}`;
    if (options.includes(current)) sel.value = current;
  }
}

function selectedBooks(host) {
  return [...host.querySelectorAll('[data-book]:checked')].map(el => el.dataset.book).filter(Boolean);
}

function readPerson(el) {
  const pronouns = normalizePronouns({
    apparent: el.querySelector('[data-pronouns-apparent]')?.value || '',
    preferred: el.querySelector('[data-pronouns-preferred]')?.value || '',
    custom: {
      possessive: el.querySelector('[data-pronouns-possessive]')?.value || '',
      personal: el.querySelector('[data-pronouns-personal]')?.value || '',
      reflexive: el.querySelector('[data-pronouns-reflexive]')?.value || '',
    },
  });
  return {
    cardId: String(el.dataset.card || '').trim(),
    name: (el.querySelector('[data-name]')?.value || '').trim() || String(el.dataset.seedName || '').trim(),
    priority: el.querySelector('[data-priority]')?.value || '',
    aliases: normalizeAliases(el.querySelector('[data-aliases]')?.value || ''),
    portrait: (el.querySelector('[data-portrait]')?.value || '').trim(),
    appearance: (el.querySelector('[data-appearance]')?.value || '').trim(),
    summary: (el.querySelector('[data-summary]')?.value || '').trim(),
    replyAsName: el.querySelector('[data-reply-as]')?.value || '',
    pronouns,
    direction: readDirection(el),
    ...readKit(el),
  };
}

function readDirection(el) {
  const d = normalizeDirectorDirection();
  el.querySelectorAll('[data-dir]').forEach(node => {
    const key = node.dataset.dir;
    if (node.type === 'checkbox') d[key] = !!node.checked;
    else if (key === 'notes') d.notes = node.value || '';
    else if (node.value) d[key] = node.value;
  });
  return normalizeDirectorDirection(d);
}

function writeDirection(row, raw) {
  const d = normalizeDirectorDirection(raw);
  row.querySelectorAll('[data-dir]').forEach(node => {
    const key = node.dataset.dir;
    if (!Object.prototype.hasOwnProperty.call(d, key)) return;
    if (node.type === 'checkbox') node.checked = !!d[key];
    else node.value = d[key] ?? '';
  });
}

function selectedCast(host) {
  const picked = [...host.querySelectorAll('[data-person]')].map(readPerson).filter(r => r.priority);
  let director = false;
  let star = false;
  return picked.map(row => {
    if (row.priority === 'director') {
      if (director) return { ...row, priority: 'major' };
      director = true;
    }
    if (row.priority === 'star') {
      if (star) return { ...row, priority: 'lead' };
      star = true;
    }
    return row;
  });
}

function normName(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/^['"“”‘’]+|['"“”‘’]+$/g, '')
    .replace(/[!?.]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function nameKeys(s) {
  const full = normName(s);
  if (!full) return [];
  const head = normName(full.split(',')[0]);
  return head && head !== full ? [full, head] : [full];
}

/** 80 exact, 60 title-before-comma, 40 the shorter name sits inside the longer one. */
function samePersonName(a, b) {
  const A = nameKeys(a);
  const B = nameKeys(b);
  if (!A.length || !B.length) return 0;
  if (A[0] === B[0]) return 80;
  if (A.includes(B[0]) || B.includes(A[0])) return 60;
  const long = A[0].length >= B[0].length ? A[0] : B[0];
  const short = A[0].length >= B[0].length ? B[0] : A[0];
  if (short.length >= 4 && (
    long.startsWith(`${short} `)
    || long.startsWith(`${short},`)
    || long.endsWith(` ${short}`)
    || long.includes(`, ${short}`)
  )) return 40;
  return 0;
}

function personNames(person) {
  return [person?.name, ...normalizeAliases(person?.aliases)].map(s => String(s || '').trim()).filter(Boolean);
}

function rowNames(el) {
  return [
    el.querySelector('[data-name]')?.value,
    el.dataset.seedName,
    ...(el.querySelector('[data-aliases]')?.value || '').split(','),
  ].map(s => String(s || '').trim()).filter(Boolean);
}

function bestNameScore(left, right) {
  let score = 0;
  for (const a of left) {
    for (const b of right) score = Math.max(score, samePersonName(a, b));
  }
  return score;
}

function findCastRow(host, person, used) {
  let best = null;
  let bestScore = 0;
  let ties = 0;
  const cardId = String(person?.characterCardId || '').trim();
  for (const el of host.querySelectorAll('[data-person]')) {
    if (used?.has(el)) continue;
    let score = 0;
    if (cardId && el.dataset.card === cardId) score = 100;
    else score = bestNameScore(rowNames(el), personNames(person));
    if (!score) continue;
    if (score > bestScore) {
      best = el;
      bestScore = score;
      ties = 1;
    } else if (score === bestScore) ties += 1;
  }
  return bestScore >= 40 && ties === 1 ? best : null;
}

function setField(row, sel, value) {
  const el = row.querySelector(sel);
  if (el) el.value = value ?? '';
}

function fillPerson(row, person, { keepName = false } = {}) {
  const set = (sel, value) => setField(row, sel, value);
  const priority = PRIORITY_IDS.has(person?.priority) ? person.priority : '';
  if (priority) set('[data-priority]', priority);
  const nameEl = row.querySelector('[data-name]');
  const currentName = (nameEl?.value || '').trim();
  const incoming = String(person?.name || '').trim();
  const label = row.querySelector('[data-summary-name]');
  if (!keepName || !currentName) {
    if (incoming) set('[data-name]', incoming);
    if (label) label.textContent = incoming || row.dataset.seedName || 'Unnamed';
    set('[data-aliases]', normalizeAliases(person?.aliases).join(', '));
  } else {
    const kept = currentName;
    set('[data-aliases]', normalizeAliases([
      ...(row.querySelector('[data-aliases]')?.value || '').split(','),
      ...normalizeAliases(person?.aliases),
      normName(incoming) && normName(incoming) !== normName(kept) ? incoming : '',
    ]).join(', '));
    if (label) label.textContent = kept;
  }
  const writeText = (sel, value) => {
    const el = row.querySelector(sel);
    if (!el) return;
    if (keepName && String(el.value || '').trim()) return;
    el.value = value;
  };
  writeText('[data-portrait]', String(person?.portrait || '').trim());
  writeText('[data-appearance]', String(person?.appearance || '').trim());
  writeText('[data-summary]', String(person?.summary || person?.description || '').trim());
  const pronouns = normalizePronouns(person?.pronouns);
  const pref = row.querySelector('[data-pronouns-preferred]');
  const apparent = row.querySelector('[data-pronouns-apparent]');
  if (!keepName || (!pref?.value && !apparent?.value)) {
    set('[data-pronouns-apparent]', pronouns.apparent);
    set('[data-pronouns-preferred]', pronouns.preferred);
    set('[data-pronouns-possessive]', pronouns.custom.possessive);
    set('[data-pronouns-personal]', pronouns.custom.personal);
    set('[data-pronouns-reflexive]', pronouns.custom.reflexive);
  }
  adoptKit(row, {
    wardrobe: person?.wardrobe,
    props: person?.props,
    shelf: person?.shelf,
    outfits: person?.outfits,
  }, { merge: keepName });
  if (person?.direction) writeDirection(row, person.direction);
  syncPerson(row);
}

function clearMerge(host) {
  host._mergeSource = null;
  host.querySelectorAll('[data-person]').forEach(row => {
    row.classList.remove('is-merge-source', 'is-merge-target');
    const btn = row.querySelector('[data-action="merge-person"]');
    if (btn) btn.textContent = 'Merge';
  });
}

function armMerge(host, row) {
  if (host._mergeSource === row) {
    clearMerge(host);
    return;
  }
  host._mergeSource = row;
  host.querySelectorAll('[data-person]').forEach(other => {
    const btn = other.querySelector('[data-action="merge-person"]');
    if (other === row) {
      other.classList.add('is-merge-source');
      other.classList.remove('is-merge-target');
      if (btn) btn.textContent = 'Cancel';
    } else {
      other.classList.remove('is-merge-source');
      other.classList.add('is-merge-target');
      if (btn) btn.textContent = 'Keep';
    }
  });
}

function mergeInto(host, source, target) {
  const from = readPerson(source);
  const pri = target.querySelector('[data-priority]');
  if (pri && !pri.value && from.priority) pri.value = from.priority;
  const nameEl = target.querySelector('[data-name]');
  if (nameEl && !nameEl.value.trim() && from.name) {
    nameEl.value = from.name;
    const label = target.querySelector('[data-summary-name]');
    if (label) label.textContent = from.name;
  }
  const aliasEl = target.querySelector('[data-aliases]');
  if (aliasEl) {
    const kept = (nameEl?.value || '').trim();
    aliasEl.value = normalizeAliases([
      ...aliasEl.value.split(','),
      ...from.aliases,
      from.name && normName(from.name) !== normName(kept) ? from.name : '',
    ]).join(', ');
  }
  const writeEmpty = (sel, value) => {
    const el = target.querySelector(sel);
    if (el && !String(el.value || '').trim() && value) el.value = value;
  };
  writeEmpty('[data-portrait]', from.portrait);
  writeEmpty('[data-appearance]', from.appearance);
  writeEmpty('[data-summary]', from.summary);
  const pref = target.querySelector('[data-pronouns-preferred]');
  const apparent = target.querySelector('[data-pronouns-apparent]');
  if (pref && apparent && !pref.value && !apparent.value) {
    apparent.value = from.pronouns.apparent || '';
    pref.value = from.pronouns.preferred || '';
    setField(target, '[data-pronouns-possessive]', from.pronouns.custom.possessive);
    setField(target, '[data-pronouns-personal]', from.pronouns.custom.personal);
    setField(target, '[data-pronouns-reflexive]', from.pronouns.custom.reflexive);
  }
  adoptKit(target, from, { merge: true });
  const reply = target.querySelector('[data-reply-as]');
  if (reply && !reply.value && from.replyAsName) reply.value = from.replyAsName;
  if (!target.dataset.card && source.dataset.card) target.dataset.card = source.dataset.card;
  source.remove();
  syncPerson(target);
  refreshReplyAs(host);
  clearMerge(host);
}

function removePerson(host, row) {
  const source = host._mergeSource;
  row.remove();
  if (!source || source === row || !source.isConnected) clearMerge(host);
  else armMerge(host, source);
  refreshReplyAs(host);
}

function localCardId(person, host) {
  const cards = getContext()?.characters || [];
  const taken = new Set(
    [...(host?.querySelectorAll('[data-person]') || [])].map(el => el.dataset.card).filter(Boolean),
  );
  const id = String(person?.characterCardId || '').trim();
  if (id && cards.some(c => c.avatar === id) && !taken.has(id)) return id;
  let best = null;
  let bestScore = 0;
  let ties = 0;
  for (const card of cards) {
    if (!card?.avatar || taken.has(card.avatar)) continue;
    const score = bestNameScore([card.name], personNames(person));
    if (score > bestScore) {
      best = card;
      bestScore = score;
      ties = 1;
    } else if (score === bestScore && score > 0) ties += 1;
  }
  return best && bestScore >= 60 && ties === 1 ? best.avatar : '';
}

async function importReelCast(host) {
  const reels = listReelCatalog(extension_settings);
  if (!reels.length) {
    void showtimeAlert('No reels on the shelf.', { title: 'SETUP REEL' });
    return;
  }
  const file = host.querySelector('[data-reel]')?.value || '';
  const row = reels.find(r => r.file === file);
  if (!row?.path) {
    void showtimeAlert('Could not read that reel.', { title: 'SETUP REEL' });
    return;
  }
  let payload = null;
  try {
    const res = await fetch(row.path, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`read ${res.status}`);
    payload = await res.json();
  } catch (err) {
    console.error('[Showtime/Setup] reel', err);
    void showtimeAlert('Could not read that reel.', { title: 'SETUP REEL' });
    return;
  }
  const characters = Array.isArray(payload?.chat?.cast?.characters) ? payload.chat.cast.characters : [];
  const billed = characters.filter(c => String(c?.name || '').trim());
  if (!billed.length) {
    void showtimeAlert('That reel has no cast.', { title: 'SETUP REEL' });
    return;
  }
  const list = host.querySelector('[data-cast-list]');
  const used = new Set();
  const placed = new Map();
  billed.forEach((person, index) => {
    const name = String(person.name).trim();
    let target = findCastRow(host, person, used);
    const matched = !!target;
    if (!target && list) {
      const cardId = localCardId(person, host);
      const id = `reel-${index}-${String(person.id || name).replace(/[^\w.-]+/g, '-')}`;
      const wrap = document.createElement('div');
      wrap.innerHTML = personRowHTML({ id, name, cardId });
      target = wrap.firstElementChild;
      list.appendChild(target);
    }
    if (!target) return;
    used.add(target);
    placed.set(person, target);
    fillPerson(target, person, { keepName: matched });
  });
  refreshReplyAs(host);
  for (const person of billed) {
    if (person.priority !== 'director' || !person.replyAsId) continue;
    const directorRow = placed.get(person);
    const other = billed.find(c => c.id === person.replyAsId);
    const replyName = (placed.get(other)?.querySelector('[data-name]')?.value || other?.name || '').trim();
    const sel = directorRow?.querySelector('[data-reply-as]');
    if (sel && replyName && [...sel.options].some(o => o.value === replyName)) sel.value = replyName;
  }
}

async function draftOpening(host) {
  const guide = host.querySelector('[data-opening-guide]')?.value || '';
  const books = selectedBooks(host);
  const cast = selectedCast(host);
  const director = cast.find(c => c.priority === 'director');
  const prompt = [
    'Write one opening post for a story.',
    director ? `The narrator is ${director.name}. Write in their voice, third person, past tense.` : 'Write in third person, past tense.',
    'Do not write a character-card introduction. Do not list stats.',
    cast.length ? `People: ${cast.map(c => `${c.name} (${c.priority})`).join(', ')}.` : '',
    books.length ? `Lorebooks in play: ${books.join(', ')}.` : 'No lorebook was selected.',
    guide.trim() ? `Player guidance: ${guide.trim()}` : '',
    'Return only the post.',
  ].filter(Boolean).join('\n');
  const text = await leanQuietGenerate(prompt, { kind: 'voice', responseLength: 600 });
  const box = host.querySelector('[data-opening]');
  if (box && text) box.value = String(text).trim();
  else void showtimeAlert('No draft came back. You can still write the opening by hand.', { title: 'OPENING DRAFT' });
}

async function suggestKit(host, row) {
  if (row.querySelector('[data-priority]')?.value === 'director') {
    void showtimeAlert('The Director does not get a starting closet.', { title: 'WARDROBE & PROPS' });
    return;
  }
  const name = (row.querySelector('[data-name]')?.value || '').trim() || 'them';
  const guide = row.querySelector('[data-kit-guide]')?.value || '';
  const books = selectedBooks(host);
  const prompt = [
    `Suggest a starting closet and carried props for ${name}.`,
    'Return ONLY JSON: {"closet":["item"],"props":["item"]}.',
    'Closet entries are clothes they are already wearing. Props are things they are carrying.',
    'Use short names. Do not invent a life story.',
    books.length ? `Lorebooks: ${books.join(', ')}.` : '',
    guide.trim() ? `Guidance: ${guide.trim()}` : '',
  ].filter(Boolean).join('\n');
  const raw = await leanQuietGenerate(prompt, { kind: 'filing', responseLength: 400 });
  let parsed = null;
  try {
    const start = String(raw || '').indexOf('{');
    const end = String(raw || '').lastIndexOf('}');
    parsed = start >= 0 && end > start ? JSON.parse(raw.slice(start, end + 1)) : null;
  } catch { parsed = null; }
  if (!parsed) {
    void showtimeAlert('No suggestion came back. You can add wardrobe and props by hand.', { title: 'WARDROBE & PROPS' });
    return;
  }
  namesToKit(row, {
    closet: Array.isArray(parsed.closet) ? parsed.closet : [],
    props: Array.isArray(parsed.props) ? parsed.props : [],
  });
}

async function ensureCast(app, picked) {
  if (app.storage?.activateChat) {
    try { await app.storage.activateChat(); } catch { /* file onto the open house */ }
  }
  const cast = app.modules.get('cast');
  if (!cast?.state) return [];
  cast.state.characters ??= [];
  const made = [];
  for (const row of picked) {
    const director = row.priority === 'director';
    const linked = !!row.cardId;
    const summary = director || linked ? '' : String(row.summary || '').trim();
    const char = {
      id: (crypto.randomUUID?.() || `c-${Date.now()}-${Math.random().toString(16).slice(2)}`),
      name: row.name,
      priority: row.priority,
      portrait: row.portrait || '',
      characterCardId: row.cardId || '',
      syncFromCard: !!row.cardId,
      personaId: '',
      syncFromPersona: false,
      description: summary,
      summary,
      appearance: director || linked ? '' : (row.appearance || ''),
      aliases: director ? [] : normalizeAliases(row.aliases),
      pronouns: normalizePronouns(director ? {} : row.pronouns),
      preferEvolutia: true,
      wardrobe: [],
      props: [],
      shelf: director ? [] : (row.shelf || []),
      outfits: director ? [] : (row.outfits || []),
      direction: director ? normalizeDirectorDirection(row.direction) : undefined,
      conditions: [],
      presence: 'inPlay',
      plotHooks: [],
      genreNotes: '',
      replyAsId: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    cast.state.characters.push(char);
    made.push(char);
    cast.bus?.emit?.('cast.added', { character: char });
  }
  const byName = new Map(made.map(c => [String(c.name || '').trim().toLowerCase(), c.id]));
  made.forEach((char, i) => {
    const want = char.priority === 'director' ? String(picked[i]?.replyAsName || '').trim().toLowerCase() : '';
    const id = want ? byName.get(want) : '';
    char.replyAsId = id && id !== char.id ? id : '';
  });
  cast.saveState?.();
  try { app.storage?.flushChat?.({ immediate: true }); } catch { /* the debounced save still runs */ }
  return made;
}

function placeKit(world, char, items, where) {
  const list = (Array.isArray(items) ? items : []).filter(x => x?.id && String(x.name || '').trim());
  const byId = new Map(list.map(x => [x.id, x]));
  const placed = new Set();
  const place = (item) => {
    if (!item || placed.has(item.id)) return;
    if (item.parentId && byId.has(item.parentId)) place(byId.get(item.parentId));
    const minted = mintItem(world, {
      id: item.id,
      name: item.name,
      description: item.description,
      condition: item.condition,
      kind: where === 'worn' ? 'item' : item.kind,
      ownerId: char.id,
      category: where === 'worn' ? 'wearable' : undefined,
    });
    if (!minted?.id) return;
    if (item.parentId && byId.has(item.parentId)) {
      moveItem(world, minted.id, { where: 'inside', parentId: item.parentId, ownerId: char.id }, { reason: 'setup nest' });
    } else {
      moveItem(world, minted.id, { where, ownerId: char.id }, { reason: where === 'worn' ? 'setup wardrobe' : 'setup props' });
    }
    placed.add(item.id);
  };
  for (const item of list) place(item);
}

function fileKit(app, chars, picked) {
  const cast = app.modules.get('cast');
  const inv = app.modules.get('inventory');
  const world = {
    characters: cast?.state?.characters || [],
    inventory: inv?.state || { mobile: [], static: [] },
  };
  chars.forEach((char, i) => {
    if (char.priority === 'director') return;
    const row = picked[i];
    if (!row) return;
    placeKit(world, char, row.wardrobe, 'worn');
    placeKit(world, char, row.props, 'carried');
  });
  cast?.saveState?.();
  inv?.saveState?.();
}

function shelfBooks(app, names) {
  const lib = app.modules.get('library');
  if (!lib || !names.length) return;
  const st = typeof lib._db === 'function' ? lib._db() : lib.state;
  if (!st) return;
  st.adopted ??= [];
  for (const name of names) {
    if (!st.adopted.includes(name)) st.adopted.push(name);
  }
  if (typeof lib._save === 'function') lib._save();
  else lib.saveState?.();
}

async function clearGreetings() {
  const chat = getContext()?.chat;
  if (!Array.isArray(chat)) return;
  let guard = chat.length + 2;
  while (chat.length && guard > 0) {
    guard -= 1;
    const before = chat.length;
    try {
      await deleteMessage(chat.length - 1, undefined, false, false);
    } catch {
      break;
    }
    if (chat.length >= before) break;
  }
}

function chatCharacterNames() {
  const ctx = getContext();
  const cards = ctx?.characters || [];
  const group = (ctx?.groups || []).find(g => g.id === ctx?.groupId);
  const names = new Set();
  if (group?.members?.length) {
    for (const member of group.members) {
      const card = cards.find(c => c.avatar === member || c.name === member);
      const name = String(card?.name || '').trim();
      if (name) names.add(name);
    }
    return names;
  }
  const solo = cards[ctx?.characterId];
  const name = String(solo?.name || '').trim();
  if (name) names.add(name);
  return names;
}

function presenceName(char, known) {
  const ctx = getContext();
  const cards = ctx?.characters || [];
  const linked = cards.find(c => c?.avatar && c.avatar === char?.characterCardId);
  const linkedName = String(linked?.name || '').trim();
  if (linkedName && known.has(linkedName)) return linkedName;
  const own = String(char?.name || '').trim();
  return known.has(own) ? own : '';
}

async function rememberPresence(chars) {
  const knownCmd = parser?.commands?.presenceRemember || parser?.commands?.presenceremember;
  if (!knownCmd) return;
  const chat = getContext()?.chat || [];
  const idx = chat.length - 1;
  if (idx < 0) return;
  const known = chatCharacterNames();
  const seen = new Set();
  for (const char of chars) {
    const name = presenceName(char, known);
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    const safe = name.replace(/"/g, '');
    try {
      await executeSlashCommandsOnChatInput(`/presenceRemember name="${safe}" ${idx}`);
    } catch { /* Presence is optional */ }
  }
}

async function applySetup(app, host, { id, close }) {
  const opening = String(host.querySelector('[data-opening]')?.value || '').trim();
  const picked = selectedCast(host);
  if (picked.some(c => !c.name)) {
    void showtimeAlert('Every billed person needs a name.', { title: 'SETUP' });
    return;
  }
  if (opening && !picked.some(c => c.priority === 'director')) {
    void showtimeAlert('Pick a Director before posting the opening, or clear the opening and apply the rest.', { title: 'SETUP' });
    return;
  }
  if (host.querySelector('[data-clear-greetings]')?.checked) await clearGreetings();
  const chars = await ensureCast(app, picked);
  fileKit(app, chars, picked);
  shelfBooks(app, selectedBooks(host));
  const director = chars.find(c => c.priority === 'director');
  if (opening && director?.name) {
    await sendMessageAs({ name: director.name }, opening);
    await rememberPresence(chars.filter(c => c.presence === 'inPlay'));
  }
  dismiss(id);
  close();
  app.bus?.emit?.('showtime.stateChanged');
}

