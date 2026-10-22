// UI performance helpers shared by Showtime modules.

import { getContext } from '../../../../extensions.js';

/**
 * Coalesce a pointer/mouse move handler to one run per animation frame, using
 * the latest event. Call handler.flush() at the start of the matching up
 * handler so the final position is applied before the drop logic runs.
 * (Deferred handlers can't preventDefault — none of the wrapped ones do.)
 */
export function rafMove(fn) {
  let lastEvent = null;
  let frame = 0;
  const run = () => {
    frame = 0;
    const ev = lastEvent;
    lastEvent = null;
    if (ev) fn(ev);
  };
  const handler = (ev) => {
    lastEvent = ev;
    if (!frame) frame = requestAnimationFrame(run);
  };
  handler.flush = () => {
    if (frame) cancelAnimationFrame(frame);
    run();
  };
  return handler;
}

const SCAN_LIMIT = 2500;

/** True when the Marquee is collapsed, curtained, or not mounted. */
export function marqueeIsHidden() {
  const root = document.getElementById('showtime-marquee');
  return !root || root.classList.contains('collapsed') || root.classList.contains('showtime-marquee--curtain');
}

/** Run after the current frame; fall back to a timeout if idle callbacks are missing. */
export function runIdle(fn, timeout = 800) {
  if (typeof requestIdleCallback === 'function') {
    return requestIdleCallback(fn, { timeout });
  }
  return setTimeout(fn, 0);
}

/** True once SillyTavern has put a message or the welcome panel in the chat. */
export function chatSurfaceReady() {
  const chat = document.getElementById('chat');
  if (!chat) return false;
  return !!(chat.querySelector('.mes') || chat.querySelector('.welcomePanel'));
}

/**
 * The chat array already has rows, but they are not in the DOM yet.
 * Heavy work here sits in front of printMessages and leaves the cream pane blank.
 */
export function chatPaintPending() {
  if (chatSurfaceReady()) return false;
  try {
    const ctx = getContext();
    return Array.isArray(ctx?.chat) && ctx.chat.length > 0;
  } catch {
    return false;
  }
}

/** Let the browser paint (and drop the Initializing splash) before more JS work. */
export function yieldPaint() {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
      return;
    }
    setTimeout(resolve, 0);
  });
}

/**
 * Memoize a pure-ish builder for a few hundred ms. Injection blocks get rebuilt
 * several times per interaction (state changes, generation start); the world
 * index in particular walks cast, library leaves, lorebooks, places and cards.
 */
export function memoBrief(fn, ms = 800) {
  let at = 0;
  let value;
  const wrapped = (...args) => {
    const now = Date.now();
    if (now - at < ms) return value;
    value = fn(...args);
    at = now;
    return value;
  };
  wrapped.invalidate = () => { at = 0; };
  return wrapped;
}

function signature(el) {
  const role = el.getAttribute('data-role');
  return `${el.tagName}.${[...el.classList].sort().join('.')}${role ? `[${role}]` : ''}`;
}

/** Remember scroll offsets of every scrolled element under root (root included). */
export function captureScroll(root) {
  const out = [];
  if (!root?.querySelectorAll) return out;
  try {
    if (root.scrollTop > 0 || root.scrollLeft > 0) out.push({ self: true, top: root.scrollTop, left: root.scrollLeft });
    const seen = new Map();
    const nodes = root.querySelectorAll('*');
    const n = Math.min(nodes.length, SCAN_LIMIT);
    for (let i = 0; i < n; i++) {
      const el = nodes[i];
      const sig = signature(el);
      const idx = seen.get(sig) ?? 0;
      seen.set(sig, idx + 1);
      if (el.scrollTop > 0 || el.scrollLeft > 0) out.push({ sig, idx, top: el.scrollTop, left: el.scrollLeft });
    }
  } catch { /* never break a render */ }
  return out;
}

/** Put offsets back on matching elements that a re-render reset to 0. */
export function restoreScroll(root, saved) {
  if (!saved?.length || !root?.querySelectorAll) return;
  const apply = () => {
    try {
      const wanted = new Map();
      for (const s of saved) {
        if (s.self) {
          if (!root.scrollTop && !root.scrollLeft) { root.scrollTop = s.top; root.scrollLeft = s.left; }
          continue;
        }
        if (!wanted.has(s.sig)) wanted.set(s.sig, new Map());
        wanted.get(s.sig).set(s.idx, s);
      }
      if (!wanted.size) return;
      const seen = new Map();
      const nodes = root.querySelectorAll('*');
      const n = Math.min(nodes.length, SCAN_LIMIT);
      for (let i = 0; i < n; i++) {
        const el = nodes[i];
        const sig = signature(el);
        const idx = seen.get(sig) ?? 0;
        seen.set(sig, idx + 1);
        const s = wanted.get(sig)?.get(idx);
        if (s && !el.scrollTop && !el.scrollLeft) { el.scrollTop = s.top; el.scrollLeft = s.left; }
      }
    } catch { /* ignore */ }
  };
  apply();
  // Content that sizes itself a frame later (images, fitted panels) — try once more.
  requestAnimationFrame(apply);
}

/**
 * Wrap instance[method] so a full re-render keeps scroll positions.
 * Skipped across chat switches: a different chat should open at the top.
 */
export function keepScrollAround(instance, method, rootOf) {
  const orig = instance?.[method];
  if (typeof orig !== 'function' || orig.__keepsScroll) return;
  const wrapped = function (...args) {
    const root = rootOf(this, args);
    let token = null;
    try { token = getContext()?.chatMetadata ?? null; } catch { /* ignore */ }
    const sameChat = this.__showtimeScrollChat === token;
    this.__showtimeScrollChat = token;
    const snap = sameChat ? captureScroll(root) : [];
    const done = () => restoreScroll(rootOf(this, args) || root, snap);
    let out;
    try {
      out = orig.apply(this, args);
    } catch (err) {
      done();
      throw err;
    }
    if (out && typeof out.then === 'function') return out.finally(done);
    done();
    return out;
  };
  wrapped.__keepsScroll = true;
  instance[method] = wrapped;
}
