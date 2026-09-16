// lib/injector.js — background service. Modules register injection rules; we get their
// text into the ST prompt via setExtensionPrompt when appropriate.

import { getContext, extension_settings } from '../../../../extensions.js';
import {
  eventSource,
  event_types,
  setExtensionPrompt,
  extension_prompt_types,
} from '../../../../../script.js';

const PROMPT_KEY_PREFIX = 'showtime.';

function houseRoot() {
  if (!extension_settings.showtime) extension_settings.showtime = {};
  const root = extension_settings.showtime;
  root.enabledModules ??= {};
  if (typeof root.masterOff !== 'boolean') root.masterOff = false;
  return root;
}

function moduleIdFromRule(ruleId) {
  const id = String(ruleId || '');
  const dot = id.indexOf('.');
  return dot >= 0 ? id.slice(0, dot) : id;
}

export class Injector {
  constructor({ bus }) {
    this.bus = bus;
    this.rules = new Map();
    this._enabled = true;
    this._bindEvents();
    this.bus.on('showtime.stateChanged', () => this.refreshAlwaysOn());
  }

  // Register an injection rule.
  // rule: {
  //   id:        unique string
  //   always?:   boolean — insert on every generation
  //   triggers?: string[] — insert only when one appears in last user message
  //   buildText: () => string — return the text to inject (empty = don't inject)
  //   position?: extension_prompt_types.* (default IN_PROMPT)
  //   depth?:    number (default 4) — how many messages up when position=IN_CHAT
  // }
  register(rule) {
    if (!rule?.id || typeof rule.buildText !== 'function') {
      console.warn('[Injector] invalid rule', rule);
      return;
    }
    this.rules.set(rule.id, {
      position: extension_prompt_types.IN_PROMPT,
      depth: 4,
      ...rule,
    });
    if (rule.always) this._apply(this.rules.get(rule.id));
  }

  unregister(id) {
    const rule = this.rules.get(id);
    this.rules.delete(id);
    // Clear with the rule's own position/depth so ST removes it from the right slot.
    setExtensionPrompt(
      PROMPT_KEY_PREFIX + id,
      '',
      rule?.position ?? extension_prompt_types.IN_PROMPT,
      rule?.depth ?? 4,
    );
  }

  setEnabled(on) {
    this._enabled = on;
    if (!on) {
      for (const rule of this.rules.values()) {
        setExtensionPrompt(PROMPT_KEY_PREFIX + rule.id, '', rule.position, rule.depth);
      }
    } else {
      this.refreshAlwaysOn();
    }
  }

  isRuleAllowed(ruleId) {
    const root = houseRoot();
    if (root.masterOff || !this._enabled) return false;
    const mod = moduleIdFromRule(ruleId);
    // Cross-cutting derived index — not a marquee tab; always allowed when house is on.
    if (mod === 'backstage' || mod === 'world') return true;
    return root.enabledModules[mod] !== false;
  }

  refreshAlwaysOn() {
    for (const rule of this.rules.values()) {
      if (!rule.always) continue;
      if (!this.isRuleAllowed(rule.id)) {
        setExtensionPrompt(PROMPT_KEY_PREFIX + rule.id, '', rule.position, rule.depth);
        continue;
      }
      this._apply(rule);
    }
  }

  _bindEvents() {
    eventSource.on(event_types.CHAT_CHANGED, () => this.refreshAlwaysOn());
    eventSource.on(event_types.MESSAGE_SENT, () => this._handleTriggers());
    eventSource.on(event_types.GENERATION_STARTED, () => {
      this._handleTriggers();
      this.refreshAlwaysOn();
    });
    if (event_types.MESSAGE_EDITED) {
      eventSource.on(event_types.MESSAGE_EDITED, () => this._handleTriggers());
    }
  }

  _handleTriggers() {
    const ctx = getContext();
    const chat = ctx.chat ?? [];
    const scanText = (chat.filter(m => m && !m.is_system).slice(-6).map(m => m.mes || '').join('\n')).toLowerCase();

    for (const rule of this.rules.values()) {
      if (!rule.triggers?.length) continue;
      if (!this.isRuleAllowed(rule.id)) {
        setExtensionPrompt(PROMPT_KEY_PREFIX + rule.id, '', rule.position, rule.depth);
        continue;
      }
      const matched = rule.triggers.some(t => scanText.includes(t.toLowerCase()));
      if (matched) {
        this._apply(rule);
      } else {
        setExtensionPrompt(PROMPT_KEY_PREFIX + rule.id, '', rule.position, rule.depth);
      }
    }
  }

  _apply(rule) {
    try {
      if (!this.isRuleAllowed(rule.id)) {
        setExtensionPrompt(PROMPT_KEY_PREFIX + rule.id, '', rule.position, rule.depth);
        return;
      }
      const text = rule.buildText() ?? '';
      setExtensionPrompt(PROMPT_KEY_PREFIX + rule.id, text, rule.position, rule.depth);
    } catch (err) {
      console.error(`[Injector] rule ${rule.id} failed:`, err);
    }
  }
}
