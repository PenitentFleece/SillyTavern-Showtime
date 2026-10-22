// Aesthetic File Cabinet HTML — allow classed markup, never scripts.

import { DOMPurify } from '../../../../../lib.js';
import { sanitizeMediaUrl } from './reelSanitize.js';

const ALLOWED_TAGS = [
  'aside', 'article', 'div', 'span', 'p', 'br', 'hr',
  'h1', 'h2', 'h3', 'h4', 'em', 'strong', 'i', 'b', 'u', 'small', 'del', 's',
  'blockquote', 'ul', 'ol', 'li', 'pre', 'code',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'figure', 'figcaption', 'img', 'header', 'footer',
];

const ALLOWED_ATTR = [
  'class', 'id', 'title', 'alt', 'src',
  'data-title', 'data-form', 'data-house', 'data-id', 'colspan', 'rowspan',
];

function fallbackStrip(raw) {
  return String(raw ?? '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe\b[\s\S]*?<\/iframe>/gi, '')
    .replace(/<object\b[\s\S]*?<\/object>/gi, '')
    .replace(/<embed\b[^>]*>/gi, '')
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript:/gi, '');
}

function scrubMedia(html) {
  return String(html || '').replace(/<img\b([^>]*?)>/gi, (full, attrs) => {
    const m = attrs.match(/\bsrc\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const src = m ? (m[2] ?? m[3] ?? m[4] ?? '') : '';
    const safe = sanitizeMediaUrl(src);
    if (!safe) return '';
    const altM = attrs.match(/\balt\s*=\s*("([^"]*)"|'([^']*)')/i);
    const alt = altM ? (altM[2] ?? altM[3] ?? '') : '';
    return `<img src="${safe.replace(/"/g, '&quot;')}" alt="${String(alt).replace(/"/g, '&quot;')}">`;
  });
}

export function sanitizeFileHtml(raw) {
  const s = String(raw ?? '');
  if (!s.trim()) return '';
  let out = '';
  try {
    out = String(DOMPurify.sanitize(s, {
      ALLOWED_TAGS,
      ALLOWED_ATTR,
      ALLOW_DATA_ATTR: true,
      FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'svg', 'link', 'style', 'form', 'input'],
      FORBID_ATTR: ['srcset', 'srcdoc'],
    }));
  } catch {
    out = fallbackStrip(s);
  }
  return scrubMedia(out);
}

export function smokeFileSanitizePure() {
  try {
    const dirty = '<aside class="st-file"><p>ok</p><script>alert(1)</script><img src="javascript:alert(1)"></aside>';
    const clean = sanitizeFileHtml(dirty);
    if (/<script/i.test(clean)) return 'script tags must be stripped';
    if (/javascript:/i.test(clean)) return 'javascript urls must be stripped';
    if (!/st-file/.test(clean) && !/<p>ok<\/p>/i.test(clean) && !/ok/.test(clean)) {
      return 'body text should survive';
    }
    const okImg = sanitizeFileHtml('<img src="https://example.com/a.png" alt="x">');
    if (!/example\.com\/a\.png/.test(okImg)) return 'https raster urls should survive';
    const dressed = sanitizeFileHtml(
      '<aside class="st-file st-file--letter st-file--lore" data-title="Hi" data-form="letter">'
      + '<header class="st-file-mast"><span class="st-file-mast-k">Letter</span><span class="st-file-mast-t">Hi</span></header>'
      + '<div class="st-file-body"><p>ok</p><script>alert(1)</script></div></aside>',
    );
    if (/<script/i.test(dressed)) return 'dressed letter must lose script';
    if (!/st-file-mast/.test(dressed)) return 'dressed letter must keep mast';
    return '';
  } catch (err) {
    return String(err?.message || err);
  }
}
