// Reel import boundary — untrusted JSON must not land script-capable HTML or
// SVG/javascript media URLs in chat metadata, portraits, cards, or lore.

import { DOMPurify } from '../../../../../lib.js';

const RASTER_MIME = /^(image\/(png|jpe?g|gif|webp|avif))$/i;
const PNG_MIME = /^image\/png$/i;
const MEDIA_KEYS = /^(portrait|dataurl|url|backupurl|filedata|force_avatar|src|avatarurl|image|avatar|charactercardid|original_avatar)$/i;
const SKIP_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** Raster data URLs only: data:image/(png|jpeg|jpg|gif|webp|avif);base64,… */
export function isAllowedRasterDataUrl(raw, { pngOnly = false } = {}) {
  const compact = String(raw || '').replace(/\s+/g, '');
  const m = compact.match(/^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/]+=*)$/i);
  if (!m) return false;
  const mime = m[1].toLowerCase().replace('image/jpg', 'image/jpeg');
  if (pngOnly) return PNG_MIME.test(mime);
  return RASTER_MIME.test(mime) || mime === 'image/jpeg';
}

export function isAllowedPngDataUrl(raw) {
  return isAllowedRasterDataUrl(raw, { pngOnly: true });
}

/**
 * Allow http(s), relative ST paths, and raster data URLs.
 * Reject javascript:, SVG, HTML data URLs, and other schemes.
 * @returns {string} the allowed URL, or ''
 */
export function sanitizeMediaUrl(raw, { pngOnly = false } = {}) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const head = s.slice(0, 32).toLowerCase();
  if (head.startsWith('javascript:') || head.startsWith('vbscript:') || head.startsWith('data:text/')) return '';
  if (/^data:image\/svg/i.test(s)) return '';
  if (/^data:/i.test(s)) {
    const compact = s.replace(/\s+/g, '');
    return isAllowedRasterDataUrl(compact, { pngOnly }) ? compact : '';
  }
  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
      return s;
    } catch {
      return '';
    }
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return '';
  if (s.startsWith('//')) return '';
  if (s.includes('..')) return '';
  try {
    if (decodeURIComponent(s).includes('..')) return '';
  } catch { /* malformed percent-encoding */ }
  if (/[\x00-\x1f<>'"`\\]/.test(s)) return '';
  return s;
}

/** Strip tags; keep prose such as `a < b` and `<3`. */
export function stripImportedHtml(raw) {
  const s = String(raw ?? '');
  if (!s) return s;
  try {
    return String(DOMPurify.sanitize(s, {
      ALLOWED_TAGS: [],
      ALLOWED_ATTR: [],
      KEEP_CONTENT: true,
    }));
  } catch {
    return s.replace(/<\/?[a-z][^>]*>/gi, '');
  }
}

function looksLikeMedia(key, value) {
  if (MEDIA_KEYS.test(String(key || ''))) return true;
  return /^(data:|https?:\/\/|javascript:|vbscript:)/i.test(String(value || ''));
}

function sanitizeImportedString(value, key, { pngOnly = false } = {}) {
  if (looksLikeMedia(key, value)) return sanitizeMediaUrl(value, { pngOnly });
  return stripImportedHtml(value);
}

function walk(value, key = '', seen = new WeakSet(), opts = {}) {
  if (typeof value === 'string') return sanitizeImportedString(value, key, opts);
  if (value == null || typeof value !== 'object') return value;
  if (seen.has(value)) return value;
  seen.add(value);
  if (Array.isArray(value)) return value.map((item, i) => walk(item, key, seen, opts));
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (SKIP_KEYS.has(k)) continue;
    const nk = stripImportedHtml(k).trim() || k;
    if (SKIP_KEYS.has(nk)) continue;
    out[nk] = walk(v, k, seen, opts);
  }
  return out;
}

function clampPortraitMap(map) {
  if (!map || typeof map !== 'object') return map;
  const next = {};
  for (const [id, portrait] of Object.entries(map)) {
    if (!portrait || typeof portrait !== 'object') continue;
    const dataUrl = sanitizeMediaUrl(portrait.dataUrl);
    if (!dataUrl) continue;
    next[id] = { ...walk(portrait), dataUrl };
  }
  return next;
}

function clampCardMap(map) {
  if (!map || typeof map !== 'object') return map;
  const next = {};
  for (const [id, card] of Object.entries(map)) {
    if (!card || typeof card !== 'object') continue;
    const dataUrl = sanitizeMediaUrl(card.dataUrl, { pngOnly: true });
    if (!dataUrl) continue;
    next[id] = { ...walk(card), dataUrl };
  }
  return next;
}

/** Scrub extras (portraits, cards, lore, links) before storage / ST APIs. */
export function sanitizeReelExtras(extras) {
  if (!extras || typeof extras !== 'object') return extras;
  const out = walk(extras);
  if (out.portraits) out.portraits = clampPortraitMap(extras.portraits);
  if (out.cards) out.cards = clampCardMap(extras.cards);
  return out;
}

/** Deep-scrub a parsed Reel (chat / global / extras / backstage slice). */
export function sanitizeReelPayload(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  const out = walk(payload);
  if (out.extras) out.extras = sanitizeReelExtras(payload.extras);
  return out;
}

/** Pure checks. Returns '' on success, else error text. */
export function smokeReelSanitizePure() {
  try {
    const htmlName = sanitizeReelPayload({
      chat: {
        cast: {
          characters: [{
            name: '<img src=x onerror=alert(1)>',
            portrait: 'data:image/svg+xml,<svg onload=alert(1)>',
          }],
        },
      },
    });
    const name = htmlName?.chat?.cast?.characters?.[0]?.name ?? '';
    if (/<[a-z]/i.test(name) || /onerror/i.test(name)) return 'html name still has tags';
    const port = htmlName?.chat?.cast?.characters?.[0]?.portrait ?? '';
    if (port) return 'svg portrait should be dropped';

    if (sanitizeMediaUrl('data:text/html,<script>alert(1)</script>')) return 'html data url should drop';
    if (sanitizeMediaUrl('javascript:alert(1)')) return 'javascript url should drop';
    if (sanitizeMediaUrl('data:image/svg+xml,<svg onload=alert(1)>')) return 'svg data url should drop';

    const good = 'data:image/png;base64,iVBORw0KGgo=';
    if (sanitizeMediaUrl(good) !== good) return 'valid png data url should keep';

    const extras = sanitizeReelExtras({
      portraits: { a: { name: 'A', dataUrl: 'data:image/svg+xml,<svg onload=alert(1)>' } },
      cards: { b: { name: 'B', dataUrl: 'data:image/jpeg;base64,aaaa' } },
    });
    if (extras.portraits?.a) return 'svg extras portrait should drop';
    if (extras.cards?.b) return 'jpeg card should drop';

    const pngCard = sanitizeReelExtras({
      cards: { c: { name: 'C', dataUrl: good } },
    });
    if (!pngCard.cards?.c?.dataUrl) return 'png card should keep';

    const lore = sanitizeReelPayload({
      extras: { lorebooks: { Book: { entries: { 1: { content: '<script>alert(1)</script>' } } } } },
    });
    const content = lore?.extras?.lorebooks?.Book?.entries?.['1']?.content ?? '';
    if (/<[a-z]/i.test(content)) return 'lore still has script tag';

    const prose = stripImportedHtml('hello a < b world <3');
    if (/<[a-z]/i.test(prose)) return 'prose grew a tag';
    if (!/a/.test(prose) || !/b/.test(prose)) return 'prose a < b stripped too hard';

    if (!sanitizeMediaUrl('https://example.com/a.png')) return 'https should keep';
    if (!sanitizeMediaUrl('/thumbnail?type=avatar&file=foo.png')) return 'thumbnail should keep';
    if (!sanitizeMediaUrl('Alice.png')) return 'avatar filename should keep';
    if (!sanitizeMediaUrl('backgrounds/foo%20bar.png')) return 'ST background path should keep';
    if (sanitizeMediaUrl('../evil.png')) return 'path traversal should drop';

    return '';
  } catch (err) {
    return String(err?.message || err);
  }
}
