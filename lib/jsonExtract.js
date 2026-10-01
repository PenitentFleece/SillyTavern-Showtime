// Pull the first complete JSON value out of a model reply.
// Greedy /\{[\s\S]*\}/ matches through a trailing "}" or commentary on the
// last line, and JSON.parse then throws:
//   Unexpected non-whitespace character after JSON

function stripFences(text) {
  const s = String(text ?? '');
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fence ? fence[1] : s)
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .trim();
}

function tryParse(s) {
  const t = String(s ?? '').trim();
  if (!t) return undefined;
  try { return JSON.parse(t); } catch { /* continue */ }
  try { return JSON.parse(t.replace(/,\s*([}\]])/g, '$1')); } catch { return undefined; }
}

function matchesPrefer(value, prefer) {
  if (value == null) return false;
  if (prefer === 'object') return typeof value === 'object' && !Array.isArray(value);
  if (prefer === 'array') return Array.isArray(value);
  return typeof value === 'object';
}

/** Slice from `start` through the matching close brace/bracket, respecting strings. */
export function sliceBalancedJson(s, start) {
  const str = String(s ?? '');
  const open0 = str[start];
  if (open0 !== '{' && open0 !== '[') return '';
  const stack = [];
  let inStr = false;
  let escaped = false;
  for (let i = start; i < str.length; i++) {
    const ch = str[i];
    if (inStr) {
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '{' || ch === '[') stack.push(ch);
    else if (ch === '}' || ch === ']') {
      const open = stack[stack.length - 1];
      if ((ch === '}' && open === '{') || (ch === ']' && open === '[')) stack.pop();
      else return '';
      if (!stack.length) return str.slice(start, i + 1);
    }
  }
  return '';
}

/**
 * @param {string} text
 * @param {{ prefer?: 'object'|'array'|'any' }} [opts]
 * @returns {any}
 */
export function extractJsonValue(text, { prefer = 'any' } = {}) {
  const body = stripFences(text);
  if (!body) return undefined;
  const direct = tryParse(body);
  if (matchesPrefer(direct, prefer)) return direct;

  const want = prefer === 'array' ? '[' : prefer === 'object' ? '{' : '';
  let found;
  let i = 0;
  while (i < body.length) {
    const ch = body[i];
    if (ch !== '{' && ch !== '[') { i += 1; continue; }
    if (want && ch !== want) { i += 1; continue; }
    const slice = sliceBalancedJson(body, i);
    if (!slice) { i += 1; continue; }
    const parsed = tryParse(slice);
    if (matchesPrefer(parsed, prefer)) found = parsed;
    i += slice.length;
  }
  return found;
}

export function parseJsonObject(raw) {
  const v = extractJsonValue(raw, { prefer: 'object' });
  return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
}

export function parseJsonArray(raw) {
  const v = extractJsonValue(raw, { prefer: 'array' });
  return Array.isArray(v) ? v : null;
}

export function smokeJsonExtractPure() {
  try {
    const trailing = parseJsonObject('{"health":61}\nThat is the result}\n');
    if (trailing?.health !== 61) return 'should ignore commentary after the first object';
    const extraBrace = parseJsonObject('{"a":1}\n}\n');
    if (extraBrace?.a !== 1) return 'should ignore a leftover closing brace';
    const echoed = parseJsonObject('{"hunger":80}\n{"hunger":55}');
    if (echoed?.hunger !== 55) return 'should prefer the last complete object';
    const nested = parseJsonObject('{"stats":{"health":61},"energy":40}\n}\n');
    if (nested?.stats?.health !== 61 || nested?.energy !== 40) return 'should keep the outer object, not a nested one';
    const fenced = parseJsonObject('```json\n{"x":2}\n```\nok');
    if (fenced?.x !== 2) return 'should read fenced JSON';
    const arr = parseJsonArray('[{ "name": "hook" }]\nmore]');
    if (arr?.[0]?.name !== 'hook') return 'should ignore extra brackets after an array';
    const comma = parseJsonObject('{"health": 8,}');
    if (comma?.health !== 8) return 'should tolerate a trailing comma';
    return '';
  } catch (err) {
    return err?.message || String(err);
  }
}
