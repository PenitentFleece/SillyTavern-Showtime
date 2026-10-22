import { extension_settings } from '../../../../extensions.js';
import { saveSettingsDebounced } from '../../../../../script.js';

// Player glossary. Opens from the closed curtain and from the minimized marquee.
// One spread at a time, like a show program. Does not touch the chat.

const SPREADS = [
  {
    kicker: 'New around here?',
    title: 'Contents',
    cols: 0,
    blocks: [{ type: 'contents' }],
  },
  {
    kicker: 'Before the lights',
    title: 'The house',
    cols: 2,
    blocks: [
      { type: 'p', text: 'Showtime is a desk for a group chat whose cast changes. One narrator card runs the scene. Everyone else steps in when they are called and steps out when they are not.' },
      { type: 'p', text: 'Pick a chat and the curtain rises. Until you do, the house stays closed and this program stays tucked under the marquee.' },
      { type: 'ul', items: [
        'The Director is that narrator card, the GM. The Star is you. The rest are cast.',
        'Quiet jobs — an interview, a filing, an audit — borrow a connection profile and do not write a chat reply. The line in the chat still uses your usual connection.',
      ] },
    ],
  },
  {
    kicker: 'What the words mean',
    title: 'Glossary',
    glossary: true,
    cols: 3,
    blocks: [
      { type: 'dl', items: [
        ['House', 'This chat’s production. Closed means no chat is open yet.'],
        ['Marquee', 'The Showtime panel. The tabs live here.'],
        ['Director', 'The narrator card. The GM, and the voice for cast who have no card of their own.'],
        ['Star', 'You. The player in the story.'],
        ['Billing', 'How central someone is: Lead, Major, Minor, Foil, or Supporting. Foil means a rival, not a smaller part.'],
        ['In play', 'Available to be called. Auto brings them in when they are named or in the current room.'],
        ['Absent', 'Out of the scene. The Star’s persona is left out of generation while Absent.'],
        ['Written out', 'Off the call. They stay quiet until you bring them back.'],
        ['Cue', 'Ask for the next line in that cast member’s voice.'],
        ['Call sheet', 'The order of those cues for a turn, with a beat of direction on each.'],
        ['Receipt', 'The latest scene ticket on the chat. Older compass lines are cleared so they do not pile up.'],
        ['Scene card', 'A filed moment in the Script. A connection or a beat can point at one.'],
        ['Cubby', 'A shelf in the Library for a lorebook entry.'],
        ['Connection', 'How two people stand with each other. A private reading, not a number to say aloud.'],
        ['Beat', 'One step on a character’s arc.'],
        ['Defy / Yield', 'The two forks of an arc. Defy costs support. Yield costs autonomy. Neither one is the right answer.'],
        ['Clapper', 'The small board for the current scene, time, and weather.'],
      ] },
    ],
  },
  {
    kicker: 'Who is in the story',
    title: 'Cast',
    cols: 2,
    blocks: [
      { type: 'p', text: 'Cast is the company. A linked persona or character card can prefer Aspect Evolutia fields, including alter egos, when that extension is present.' },
      { type: 'dl', items: [
        ['Profile', 'Name, aliases, pronouns, a billing, an appearance, and a summary.'],
        ['Keyring', 'Compass place names: a building, a unit, or a room. Not an inventory password.'],
        ['Closet', 'That person’s outfits. An outfit is a saved list of wearable pieces. The Star’s worn clothes are the equipped inventory.'],
      ] },
      { type: 'p', text: 'Outfit kinds are Uniform, Costume, Casual, Swim, Underwear, Formal, Athletic, and Pajama.' },
      { type: 'ul', items: [
        'A look reads Worn when every piece is on and in good condition, Unkempt when some of it is on but a piece is missing or in poor condition, and Off when none of that look is on.',
        'Nude means nothing is worn at all. One piece, including underwear, is not nude.',
        'Director and Star are one each. A second Star import becomes a Lead. The Director is the narrator card and speaks for people with no card of their own. Reach and plot hooks are set under Backstage, Production.',
        'Star, Lead, Major, and Foil can carry stats, wardrobe, props, and conditions. Foil is the opposing part, and it is tracked. Minor and Supporting do not get those panels. There is no Cameo billing. A passing mention does not need a roster row.',
      ] },
      { type: 'p', text: 'The cue sheet runs Once, Repeat, or Until disrupted. Until disrupted keeps the order going until someone on the sheet is absent or written out. Each slot can hold a Direction.' },
      { type: 'ul', items: [
        'In play is in the scene. Absent is out of it, and an absent Star’s persona is left out of generation.',
        'Written out is hidden and parked at the last known place. Mark them In play or Absent to bring them back. The Star cannot be written out.',
        'Stats start off. The base pair is Health and Energy. The optional set is Satiety, Hydration, Bladder, and Odor. Custom bars are added under Backstage, Production.',
      ] },
    ],
  },
  {
    kicker: 'What already happened',
    title: 'Script',
    cols: 2,
    blocks: [
      { type: 'p', text: 'One script for this production. It is the record of what has already happened. Shelf and Timeline are two ways to read that same record.' },
      { type: 'ul', items: [
        'Show numbers a card like S01E017. Book numbers it like B.1-Ch.17. Custom uses the level names you set.',
        'The default tree is Base, Collection, Book, and Chapter. Those names can be changed. There is no fixed Season, Episode, Scene ladder.',
        'A card has a title, a summary, a span, quotes, credits, and sponsors, plus the body that can be injected as lore.',
        'Write a card by hand, have the agent compile a lorebook or a message range, or bring in a memory-book clipping. The script can stand in for that chat’s lorebook.',
        'Timeline is Condensed, top to bottom, or Broad, left to right. Broad is the default. The present, the year, and the season use the calendar labels you set.',
      ] },
    ],
  },
  {
    kicker: 'Words the story knows',
    title: 'Library',
    cols: 2,
    blocks: [
      { type: 'p', text: 'Library is the shelf of lore, and the file cabinet beside it. The shelf is reference. It does not speak a line on its own.' },
      { type: 'ul', items: [
        'A file is a letter, clipping, photo, warrant, file, or note. Origin is where it was filed, not who holds the paper.',
        'Public ignores clearance. Familiarity on a public file is Dark, Vague, Aware, or Known. People from the origin house start Aware.',
        'Click a row to select it. View opens that file alone. A marked document can split into separate pieces.',
        'A redaction bar hides the word and leaves it in the page.',
      ] },
    ],
  },
  {
    kicker: 'What people carry',
    title: 'Inventory',
    cols: 2,
    blocks: [
      { type: 'p', text: 'Inventory is the prop table. One object lives in one place: worn, carried, inside something, the trunk, a room, or lost.' },
      { type: 'ul', items: [
        'Categories are consumable, wearable, usable, and misc. Condition runs from pristine to ruined.',
        'A pack of the same stuff has an amount. A bag holds separate objects.',
        'The Star’s worn clothes are the equipped inventory.',
        'An offer waits for a sentence that takes the item, uses it up, or refuses it. A passing mention of hands does not.',
      ] },
    ],
  },
  {
    kicker: 'How they stand',
    title: 'Reputation',
    cols: 2,
    blocks: [
      { type: 'p', text: 'Reputation is how two people meet: when, the baseline, and the current take. It is context for the desk. They should not quote it.' },
      { type: 'ul', items: [
        'A reading can name a script card, or No script. No script stays No script.',
        'Standing is a desk number. Knows and In the dark are for a private file.',
      ] },
    ],
  },
  {
    kicker: 'What they want',
    title: 'Motivation',
    cols: 2,
    blocks: [
      { type: 'p', text: 'Motivation is an arc for the Star, a Lead, a Major, or a Foil. Not a skill tree. They can hold secrets, achievements, and beats.' },
      { type: 'ul', items: [
        'A beat has one parent. Defy and Yield do not join back.',
        'Audit drafts an Opening, then those two paths. Steer this arc is your note.',
        'A beat has no scene stamp until you attach a card.',
      ] },
    ],
  },
  {
    kicker: 'The room tone',
    title: 'Composer',
    cols: 2,
    blocks: [
      { type: 'p', text: 'Composer sets Spotify under the scene. It does not write the story.' },
      { type: 'ul', items: [
        'Paste the redirect shown in Composer, and the client id only. Sign-in uses PKCE. There is no client secret to store.',
        'Nothing plays while the house is closed. Open a chat first.',
      ] },
    ],
  },
  {
    kicker: 'Behind the desk',
    title: 'Backstage',
    cols: 2,
    blocks: [
      { type: 'p', text: 'Backstage is the lobby. Production, Interview, the Peanut Gallery, and Stage each have a chapter after this one. Trackers, Effects, and Visuals do too.' },
      { type: 'ul', items: [
        'Settings holds this program, connection profiles, the theme, which tabs are live, and master off. Master off silences injections and trackers.',
        'Both sex dials off: sex is taboo, and punishment is not sexual. Obscenity alone: sex is ordinary, and punishment is not sexual. Punishment alone: sex stays taboo, and punishment is sexual. Both on: sex is ordinary, and sexual punishment is an institution. Severity and consent matter only while punishment is on.',
      ] },
    ],
  },
  {
    kicker: 'The floor manager',
    title: 'Production',
    cols: 2,
    blocks: [
      { type: 'p', text: 'Production is under Backstage. The Director watches the floor from here. Trackers, holidays, and reels fold out underneath.' },
      { type: 'ul', items: [
        'Director events use intrusiveness: Derail, Twist, Advance, Pressure, or Random. You choose what the Director may read.',
        'Events and Holidays compose a script card. Cue now opens it as an event. Pitch cast invites people. Jump moves the floor to that card. Pin inject keeps it in view.',
        'A reel exports the checked tabs. Leave the Star behind drops their card and kit from that copy only. Import can merge. Wipe clears one tab in this chat.',
      ] },
    ],
  },
  {
    kicker: 'Across the desk',
    title: 'Interview',
    cols: 2,
    blocks: [
      { type: 'p', text: 'Interview is a private sitting. The reply stays on the desk. It does not write a line in the chat.' },
      { type: 'ul', items: [
        'The subject is not the Star or the Director. The asker is you, another cast member, or Anonymous.',
        'Notecards are Props, Fashion, Role, and Cast. The Interview profile in Settings is the model for this sitting. Your usual connection still writes the chat.',
        'End and file stores the transcript. End without filing leaves it. Clear desk wipes only the desk.',
      ] },
    ],
  },
  {
    kicker: 'From the balcony',
    title: 'Peanut Gallery',
    cols: 2,
    blocks: [
      { type: 'p', text: 'Peanut Gallery is cast talking beside the scene. It is never a new turn in the chat. The Star and the Director stay off. The transcript never enters the main prompt.' },
      { type: 'ul', items: [
        'Listen to the last few messages, a range, or one script card. Continue keeps those voices, then people tied to them.',
        'An optional poke is what they should argue about. Written-out cast are not in the room.',
        'The model is the Director / Gallery profile under Settings.',
      ] },
    ],
  },
  {
    kicker: 'The map',
    title: 'Stage',
    cols: 2,
    blocks: [
      { type: 'p', text: 'Stage is the house as a place. Set and Placement live here. Effects and Visuals are shelves on the same door, and each has a chapter of its own.' },
      { type: 'ul', items: [
        'Places, the floorplan, compass areas, and the links between them. Sonar says where the scene is standing.',
        'A name that matches nothing waits under Unlisted. The builder drafts the inside of a place.',
        'Placement is what a person notices on the way in. How far that look reaches is set under Trackers, Location.',
      ] },
    ],
  },
  {
    kicker: 'The dials',
    title: 'Trackers',
    cols: 2,
    blocks: [
      { type: 'p', text: 'Trackers sit in a fold under Production. They steer the meters. Cast, Reputation, and Inventory still hold the live numbers.' },
      { type: 'ul', items: [
        'Status is the meters. Connection logs standing when a script card credits someone in play.',
        'Scene is the clapper: place, time, date, and weather. Location is sonar reach. Items decides who may use, make, or delete a prop.',
        'Motivation only proposes a leaked secret or a played beat. Nothing flips until you confirm it.',
        'The receipt is the latest scene slip. Per turn, per post, every N posts, or only when you press Receipt on Cast.',
      ] },
    ],
  },
  {
    kicker: 'Over the chat',
    title: 'Effects',
    cols: 2,
    blocks: [
      { type: 'p', text: 'Effects draws weather over the chat. It does not change the story.' },
      { type: 'ul', items: [
        'It follows the clapper unless Free Mode is on.',
        'Exposure, wind, fog, candlelight, and an optional sound loop. Lite mode draws less.',
      ] },
    ],
  },
  {
    kicker: 'The still behind them',
    title: 'Visuals',
    cols: 2,
    blocks: [
      { type: 'p', text: 'Visuals is the still behind a room or an area. Upload a picture, paste an address, or import one from SillyTavern’s own background library.' },
      { type: 'ul', items: [
        'Tag it by place or scene. Auto-select uses those tags.',
        'Use pins one now. Link here makes that pin the automatic choice for this place.',
        'The earlier still in the queue wins when more than one matches.',
      ] },
    ],
  },
  {
    kicker: 'Which model works',
    title: 'Profiles',
    cols: 2,
    blocks: [
      { type: 'p', text: 'Connection slots live under Backstage, Settings. An empty slot keeps the model already selected. A quiet job switches to its slot, then switches back. The chat line still uses the usual connection.' },
      { type: 'ul', items: [
        'Filing — cast, inventory, reputation, and citation receipts.',
        'World Index — a lookup after an AI post. Empty uses Filing.',
        'Motivation — the arc audit.',
        'Interview — the desk conversation.',
        'Director / Gallery — director events and the peanut gallery.',
        'Script Agent — building scenes. One chat can override this under Script, Configure.',
      ] },
    ],
  },
];

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, ch => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

function guideEntries() {
  const out = [];
  SPREADS.forEach((spread, i) => {
    if (!spread.glossary) out.push({ spread, i });
  });
  return out;
}

function blockHtml(block) {
  if (block.type === 'contents') {
    const buttons = SPREADS.map((spread, i) => (
      i === 0 || spread.glossary
        ? ''
        : `<button type="button" data-action="goto" data-index="${i}">${esc(spread.title)}</button>`
    )).join('');
    return `<p class="showtime-playbill-lead">Showtime keeps a rotating cast for a group chat. The Director is the narrator. Pick a chapter, or turn the page.</p><div class="showtime-playbill-contents">${buttons}</div>`;
  }
  if (block.type === 'p') return `<p>${esc(block.text)}</p>`;
  if (block.type === 'ul') {
    return `<ul>${block.items.map(item => `<li>${esc(item)}</li>`).join('')}</ul>`;
  }
  if (block.type === 'dl') {
    return block.items.map(([term, def]) => (
      `<div class="showtime-playbill-entry"><dt>${esc(term)}</dt><dd>${esc(def)}</dd></div>`
    )).join('');
  }
  return '';
}

let anchor = null;
let host = null;
let index = 0;
let onKey = null;
let onNeedMinimize = null;
let onBackstage = null;
let toastTimer = 0;

function programDismissed() {
  return !!extension_settings.showtime?.shell?.programDismissed;
}

function setProgramDismissed(dismissed) {
  if (!extension_settings.showtime) extension_settings.showtime = {};
  const root = extension_settings.showtime;
  root.shell ??= {};
  if (!!root.shell.programDismissed === dismissed) return;
  root.shell.programDismissed = dismissed;
  saveSettingsDebounced();
}

function marqueeMinimized() {
  if (!anchor) return false;
  if (anchor.classList.contains('showtime-marquee--curtain-lift')) return false;
  return anchor.classList.contains('collapsed')
    || anchor.classList.contains('showtime-marquee--curtain');
}

function showToast(text) {
  let toast = document.querySelector('.showtime-playbill-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'showtime-playbill-toast';
    toast.setAttribute('role', 'status');
    document.body.appendChild(toast);
  }
  toast.textContent = text;
  toast.hidden = false;
  if (anchor) {
    const rect = anchor.getBoundingClientRect();
    const width = Math.round(rect.width);
    toast.style.width = `${width}px`;
    toast.style.left = `${Math.round(rect.left)}px`;
    toast.style.top = `${Math.round(rect.bottom) + 8}px`;
  }
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 4600);
}

function paint() {
  if (!host) return;
  const spread = SPREADS[index];
  const guide = guideEntries();
  const at = guide.findIndex(g => g.i === index);
  const onGlossary = !!spread.glossary;
  host.querySelector('[data-role="kicker"]').textContent = spread.kicker;
  host.querySelector('[data-role="title"]').textContent = spread.title;
  host.querySelector('[data-role="body"]').innerHTML = spread.blocks.map(blockHtml).join('');
  host.querySelector('[data-role="body"]').dataset.cols = String(spread.cols || 0);
  host.querySelector('[data-role="count"]').textContent = onGlossary
    ? 'Glossary'
    : `${at + 1} / ${guide.length}`;
  const prev = host.querySelector('[data-action="prev"]');
  const next = host.querySelector('[data-action="next"]');
  if (prev) prev.disabled = onGlossary || at <= 0;
  if (next) next.disabled = onGlossary || at < 0 || at >= guide.length - 1;
  const gloss = host.querySelector('[data-action="glossary"]');
  if (gloss) gloss.textContent = onGlossary ? 'Contents' : 'Glossary';
}

function turn(delta) {
  const guide = guideEntries();
  const at = guide.findIndex(g => g.i === index);
  if (at < 0) return;
  const next = guide[at + delta];
  if (!next) return;
  index = next.i;
  paint();
}

function toggleGlossary() {
  if (SPREADS[index]?.glossary) {
    index = 0;
  } else {
    const g = SPREADS.findIndex(s => s.glossary);
    if (g < 0) return;
    index = g;
  }
  paint();
}

function closePlaybill() {
  if (!host) return;
  host.classList.remove('is-open');
  placePlaybill();
}

function dismissProgram() {
  if (!host) return;
  host.classList.remove('is-open');
  setProgramDismissed(true);
  placePlaybill();
  showToast('The program is in Backstage, under Settings.');
}

function ensureHost(marquee) {
  anchor = marquee;
  if (host) return host;
  host = document.createElement('div');
  host.className = 'showtime-papers';
  host.innerHTML = `
    <div class="showtime-paper-clip">
      <button type="button" class="showtime-paper-edge showtime-paper-edge--back" data-action="backstage">Backstage</button>
      <button type="button" class="showtime-paper-edge showtime-paper-edge--front" data-action="toggle">New Around Here?</button>
      <button type="button" class="showtime-paper-x" data-action="dismiss" aria-label="Dismiss the program">×</button>
    </div>
    <div class="showtime-playbill-sheet" role="dialog" aria-modal="false" aria-labelledby="showtime-playbill-title">
      <div class="showtime-playbill-mat">
      <header class="showtime-playbill-bar">
        <span class="showtime-playbill-mark">Program</span>
        <span data-role="count"></span>
        <button type="button" class="showtime-playbill-x" data-action="dismiss" aria-label="Dismiss the program">×</button>
      </header>
      <article class="showtime-playbill-spread">
        <p class="showtime-playbill-kicker" data-role="kicker"></p>
        <h2 id="showtime-playbill-title" data-role="title"></h2>
        <div class="showtime-playbill-body" data-role="body"></div>
      </article>
      <footer class="showtime-playbill-nav">
        <button type="button" data-action="prev">Previous</button>
        <button type="button" data-action="glossary">Glossary</button>
        <button type="button" data-action="next">Next</button>
      </footer>
      </div>
    </div>`;
  host.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn || !host.contains(btn)) return;
    e.stopPropagation();
    const action = btn.dataset.action;
    if (action === 'toggle') {
      if (host.classList.contains('is-open')) closePlaybill();
      else openPlaybill();
    } else if (action === 'backstage') {
      closePlaybill();
      onBackstage?.();
    } else if (action === 'close') closePlaybill();
    else if (action === 'dismiss') dismissProgram();
    else if (action === 'prev') turn(-1);
    else if (action === 'next') turn(1);
    else if (action === 'glossary') toggleGlossary();
    else if (action === 'goto') {
      const next = Number(btn.dataset.index);
      if (next > 0 && next < SPREADS.length) {
        index = next;
        paint();
      }
    }
  });
  onKey = (e) => {
    if (!host || !host.classList.contains('is-open')) return;
    const typing = e.target?.closest?.('input, textarea, select, [contenteditable="true"]');
    if (typing) return;
    if (e.key === 'Escape') closePlaybill();
    else if (e.key === 'ArrowRight') turn(1);
    else if (e.key === 'ArrowLeft') turn(-1);
  };
  document.addEventListener('keydown', onKey);
  document.body.appendChild(host);
  if (typeof ResizeObserver !== 'undefined') {
    const watch = new ResizeObserver(() => placePlaybill());
    watch.observe(marquee);
  }
  window.addEventListener('resize', placePlaybill);
  return host;
}

/** Keep the papers under the marquee, and only while it is minimized. */
export function placePlaybill() {
  if (!host || !anchor) return;
  const gone = anchor.hidden || getComputedStyle(anchor).display === 'none';
  const desk = anchor.classList.contains('showtime-marquee--desk');
  const closed = anchor.classList.contains('showtime-marquee--curtain')
    && !anchor.classList.contains('showtime-marquee--curtain-lift')
    && !desk;
  const programUp = !programDismissed() || host.classList.contains('is-open');
  const show = !gone && !desk && marqueeMinimized() && (programUp || closed);
  host.hidden = !show;
  host.classList.toggle('showtime-papers--closed', closed);
  host.classList.toggle(
    'showtime-papers--backstage-only',
    closed && programDismissed() && !host.classList.contains('is-open'),
  );
  if (!show) {
    if (!marqueeMinimized() || desk) host.classList.remove('is-open');
    return;
  }
  const rect = anchor.getBoundingClientRect();
  const width = Math.round(rect.width);
  host.style.left = `${Math.round(rect.left)}px`;
  host.style.top = `${Math.round(rect.bottom) - 1}px`;
  host.style.width = `${width}px`;
  const sheet = host.querySelector('.showtime-playbill-sheet');
  if (sheet && host.classList.contains('is-open')) {
    const space = window.innerHeight - rect.bottom - 28;
    const sheetW = Math.min(880, Math.max(320, window.innerWidth - 24));
    const ideal = rect.left + (rect.width / 2) - (sheetW / 2);
    const left = Math.max(12, Math.min(ideal, window.innerWidth - sheetW - 12));
    sheet.style.width = `${Math.round(sheetW)}px`;
    sheet.style.maxWidth = 'none';
    sheet.style.left = `${Math.round(left - rect.left)}px`;
    sheet.style.transform = 'none';
    sheet.style.maxHeight = `${Math.max(220, Math.min(space, 560))}px`;
  }
}

/** Papers under a minimized marquee. Safe while the house is closed. */
export function mountPlaybill(marquee, hooks = {}) {
  if (!marquee) return;
  onNeedMinimize = hooks.onNeedMinimize || null;
  onBackstage = hooks.onBackstage || null;
  ensureHost(marquee);
  placePlaybill();
}

/** Pull the program down. Starts on the contents. Clears a previous dismiss. */
export function openPlaybill() {
  const marquee = anchor || document.getElementById('showtime-marquee');
  if (!marquee) return;
  ensureHost(marquee);
  setProgramDismissed(false);
  if (onNeedMinimize) onNeedMinimize();
  index = 0;
  paint();
  host.classList.add('is-open');
  placePlaybill();
}
