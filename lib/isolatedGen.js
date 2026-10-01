// Token-lean quiet generation for Showtime's classifiers, audits, and voice tasks.
//
// generateQuietPrompt() builds the FULL chat prompt (card + whole history).
// Filing tasks must never use it. generateRaw still emits prompt-ready events
// that other extensions can splice into, so we pin the request back to our
// two messages after those listeners run.

import { generateRaw, generateQuietPrompt, eventSource, event_types } from '../../../../../script.js';

export const SYSTEM_FILING = 'This is a filing task. Use only the user message. Ignore character cards, narrator_context, shared_context, world info, lore, and any other system or prompt text. Reply with the requested JSON or exact format only — first character { or [. No scratch work, no Adjusting/Current/Keep-at commentary, no markdown, no roleplay.';

/** Default max tokens for quiet filing so a verbose model can still finish the JSON. */
export const FILING_RESPONSE_LENGTH = 3200;

export const SYSTEM_VOICE = 'Stay in the voice and dossier given in the user message. Ignore any other character card, narrator_context, shared_context, or world lore that is not in that message. Output only what was asked.';

const DEFAULT_SYSTEM = SYSTEM_FILING;

function isRateLimit(text) {
  return /too many requests|\b429\b|rate.?limit|resource has been exhausted/i.test(String(text || ''));
}

/* Some backends reject a request that carries a json schema. ST shows its own
   error toast for that failure, even though we recover from it — so once a
   schema call has failed, this session stops sending schemas at all. */
let schemaRejected = false;
export function schemaAllowed() { return !schemaRejected; }
export function noteSchemaRejected() { schemaRejected = true; }

function isAbort(text) {
  return /abort|cancel/i.test(String(text || ''));
}

/** Break ST {{macros}} so substituteParams cannot expand card/user fields. */
export function escapePromptMacros(text) {
  return String(text ?? '').replace(/\{\{/g, '{ {');
}

function pinnedMessages(systemPrompt, userPrompt) {
  return [
    { role: 'system', content: String(systemPrompt || '').trim() },
    { role: 'user', content: String(userPrompt || '').trim() },
  ];
}

function pinnedText(systemPrompt, userPrompt) {
  const sys = String(systemPrompt || '').trim();
  const user = String(userPrompt || '').trim();
  return sys ? `${sys}\n${user}` : user;
}

let pinTail = Promise.resolve();
let pinDepth = 0;

/** True while a Showtime quiet pin is rewriting prompt-ready events. */
export function isQuietPinActive() {
  return pinDepth > 0;
}

function pinOutputBudget(data, n) {
  if (!data || !(n > 0)) return;
  if ('max_completion_tokens' in data) data.max_completion_tokens = n;
  if ('max_tokens' in data) data.max_tokens = n;
  if ('max_length' in data) data.max_length = n;
  if ('n_predict' in data) data.n_predict = n;
  if (!('max_tokens' in data) && !('max_completion_tokens' in data)) data.max_tokens = n;
}

function pinFilingSampling(data) {
  if (!data) return;
  if (typeof data.temperature === 'number') data.temperature = Math.min(data.temperature, 0.35);
}

/**
 * Run `fn` while forcing quiet prompt-ready events back to our system+user pair.
 * Serialized so overlapping audits cannot steal each other's pin.
 */
export function withPinnedQuietPrompt(systemPrompt, userPrompt, fn, {
  responseLength = 0,
  filing = false,
} = {}) {
  const messages = pinnedMessages(systemPrompt, userPrompt);
  const text = pinnedText(systemPrompt, userPrompt);
  const budget = Math.max(0, Number(responseLength) || 0);
  const run = async () => {
    pinDepth += 1;
    const onChat = (data) => {
      if (!data || data.dryRun) return;
      if (Array.isArray(data.chat)) data.chat = messages.map(m => ({ ...m }));
    };
    const onText = (data) => {
      if (!data || data.dryRun) return;
      if (typeof data.prompt === 'string') data.prompt = text;
    };
    const onChatSettings = (data) => {
      if (!data || data.dryRun) return;
      if (Array.isArray(data.messages)) data.messages = messages.map(m => ({ ...m }));
      pinOutputBudget(data, budget);
      if (filing) pinFilingSampling(data);
    };
    const onTextSettings = (data) => {
      if (!data || data.dryRun) return;
      if (data && typeof data.prompt === 'string') data.prompt = text;
      pinOutputBudget(data, budget);
      if (filing) pinFilingSampling(data);
    };
    eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, onChat);
    eventSource.on(event_types.GENERATE_AFTER_COMBINE_PROMPTS, onText);
    eventSource.on(event_types.CHAT_COMPLETION_SETTINGS_READY, onChatSettings);
    eventSource.on(event_types.TEXT_COMPLETION_SETTINGS_READY, onTextSettings);
    try {
      return await fn();
    } finally {
      pinDepth = Math.max(0, pinDepth - 1);
      eventSource.removeListener?.(event_types.CHAT_COMPLETION_PROMPT_READY, onChat);
      eventSource.removeListener?.(event_types.GENERATE_AFTER_COMBINE_PROMPTS, onText);
      eventSource.removeListener?.(event_types.CHAT_COMPLETION_SETTINGS_READY, onChatSettings);
      eventSource.removeListener?.(event_types.TEXT_COMPLETION_SETTINGS_READY, onTextSettings);
    }
  };
  const next = pinTail.then(run, run);
  pinTail = next.then(() => {}, () => {});
  return next;
}

function coerceGenOut(out) {
  return typeof out === 'string' ? out.trim()
    : (out && typeof out === 'object' ? JSON.stringify(out) : String(out ?? '').trim());
}

export async function pinnedGenerateRaw({
  prompt,
  systemPrompt = DEFAULT_SYSTEM,
  jsonSchema = null,
  responseLength = FILING_RESPONSE_LENGTH,
} = {}) {
  const user = escapePromptMacros(String(prompt || '').trim());
  const sys = String(systemPrompt || DEFAULT_SYSTEM).trim();
  const filing = sys === SYSTEM_FILING || /filing task/i.test(sys);
  return withPinnedQuietPrompt(sys, user, async () => {
    const out = await generateRaw({
      prompt: user,
      systemPrompt: sys,
      instructOverride: true,
      quietToLoud: true,
      responseLength,
      jsonSchema,
      trimNames: false,
    });
    return coerceGenOut(out);
  }, { responseLength, filing });
}

/**
 * @param {string} prompt Task prompt (already self-contained).
 * @param {object} [opts]
 * @param {'filing'|'voice'} [opts.kind] filing never uses generateQuietPrompt.
 * @param {object} [opts.fallback] Voice-only last resort (full chat prompt).
 */
export async function leanQuietGenerate(prompt, {
  fallback = null,
  jsonSchema = null,
  systemPrompt,
  responseLength = FILING_RESPONSE_LENGTH,
  kind = 'filing',
} = {}) {
  const filing = kind !== 'voice';
  const sys = systemPrompt || (filing ? SYSTEM_FILING : SYSTEM_VOICE);
  const attempt = async (schema) => pinnedGenerateRaw({
    prompt,
    systemPrompt: sys,
    jsonSchema: schema,
    responseLength,
  });

  const useSchema = jsonSchema && schemaAllowed();
  if (useSchema) {
    try {
      const str = await attempt(jsonSchema);
      if (str) return str;
    } catch (err) {
      const msg = err?.message || err;
      if (isRateLimit(msg) || isAbort(msg)) throw err;
      noteSchemaRejected();
      console.warn('[Showtime] schema request rejected, continuing without schemas', err);
    }
  }
  try {
    const str = await attempt(null);
    if (str) return str;
  } catch (err) {
    const msg = err?.message || err;
    if (isRateLimit(msg) || isAbort(msg)) throw err;
    console.warn('[Showtime] lean generation failed', err);
    if (filing) return '';
  }
  if (filing) return '';
  if (!fallback) return '';
  const quietOpts = fallback ?? { quietPrompt: String(prompt || '').trim(), trimToSentence: false, skipWIAN: true, quietName: 'System' };
  try {
    return String(await generateQuietPrompt(quietOpts) ?? '').trim();
  } catch (err) {
    console.warn('[Showtime] voice quiet fallback failed', err);
    return '';
  }
}

/** Lightweight checks (no generation). Returns '' on success. */
export function smokeIsolatedGenPure() {
  try {
    const escaped = escapePromptMacros('Audit {{char}} and {{user}} from the scene.');
    if (escaped.includes('{{')) return 'escapePromptMacros should break mustaches';
    if (!escaped.includes('{ {char}') || !escaped.includes('{ {user}')) {
      return 'escaped prompt should keep macro names as literal text';
    }
    const filing = SYSTEM_FILING.toLowerCase();
    if (!/narrator_context/.test(filing) || !/filing/.test(filing)) {
      return 'filing system line should mention narrator_context';
    }
    if (!/\{/.test(SYSTEM_FILING) || !/adjusting/i.test(SYSTEM_FILING)) {
      return 'filing system line should demand JSON and forbid Adjusting commentary';
    }
    const voice = SYSTEM_VOICE.toLowerCase();
    if (!/dossier/.test(voice) || !/narrator_context/.test(voice)) {
      return 'voice system line should ignore other cards';
    }
    if (isQuietPinActive()) return 'quiet pin should be idle outside withPinnedQuietPrompt';
    return '';
  } catch (err) {
    return err?.message || String(err);
  }
}
