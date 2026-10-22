// lib/injector.js — background service. Modules register injection rules; we get their
// text into the ST prompt via setExtensionPrompt when appropriate.

import { getContext, extension_settings } from '../../../../extensions.js';
import {
  eventSource,
  event_types,
  setExtensionPrompt,
  extension_prompt_types,
} from '../../../../../script.js';
import { marqueeIsHidden } from './uiPerf.js';

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
    this.lastAlwaysOn = [];
    this._enabled = true;
    this._bindEvents();
    // State changes arrive in bursts (a render can emit several); one rebuild per frame is enough.
    this.bus.on('showtime.stateChanged', () => {
      if (marqueeIsHidden()) return;
      this._scheduleRefresh();
    });
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
    // Don't build always-on text here — boot registers many rules, and
    // refreshAlwaysOn runs once after mount. Generation start still refreshes.
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

  setEnabled(on, { refresh = true } = {}) {
    this._enabled = on;
    if (!on) {
      for (const rule of this.rules.values()) {
        setExtensionPrompt(PROMPT_KEY_PREFIX + rule.id, '', rule.position, rule.depth);
      }
    } else if (refresh) {
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

  /**
   * Chat load and boot must not rebuild prompts. A postponed rebuild was still
   * walking connections, the glossary, and the set once the quiet window
   * ended — after the messages were already on screen.
   */
  quiet(ms = 8000) {
    const until = Date.now() + Math.max(0, Number(ms) || 0);
    this._quietUntil = Math.max(this._quietUntil || 0, until);
    if (this._refreshTimer) {
      clearTimeout(this._refreshTimer);
      this._refreshTimer = 0;
    }
  }

  /** Coalesce burst refreshes. Heavy rules (World Index, compass, Script) wait for generate. */
  _scheduleRefresh() {
    if ((this._quietUntil || 0) > Date.now()) return;
    if (this._refreshTimer) return;
    this._refreshTimer = setTimeout(() => {
      this._refreshTimer = 0;
      this.refreshAlwaysOn({ full: false });
    }, 400);
  }

  refreshAlwaysOn({ full = false } = {}) {
    if (this._refreshTimer) {
      clearTimeout(this._refreshTimer);
      this._refreshTimer = 0;
    }
    if (this._refreshFrame) {
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this._refreshFrame);
      else clearTimeout(this._refreshFrame);
      this._refreshFrame = 0;
    }
    const sizes = [];
    for (const rule of this.rules.values()) {
      if (!rule.always) continue;
      if (!full && rule.heavy) continue;
      if (!this.isRuleAllowed(rule.id)) {
        setExtensionPrompt(PROMPT_KEY_PREFIX + rule.id, '', rule.position, rule.depth);
        sizes.push({ id: rule.id, chars: 0 });
        continue;
      }
      sizes.push(this._apply(rule) || { id: rule.id, chars: 0 });
    }
    if (full || !this.lastAlwaysOn?.length) this.lastAlwaysOn = sizes;
    else {
      const byId = new Map(this.lastAlwaysOn.map(s => [s.id, s]));
      for (const s of sizes) byId.set(s.id, s);
      this.lastAlwaysOn = [...byId.values()];
    }
  }

  _bindEvents() {
    eventSource.on(event_types.CHAT_CHANGED, () => {
      // A chat switch is already parsing and painting the JSONL. Rebuilding
      // always-on prompts here is what makes the page go unresponsive.
      // Generation start still does a full refresh before the prompt is combined.
      this.quiet(8000);
    });
    eventSource.on(event_types.MESSAGE_SENT, () => this._handleTriggers());
    eventSource.on(event_types.GENERATION_STARTED, () => {
      this._quietUntil = 0;
      this._handleTriggers();
      // Heavy builders (World Index, compass) walk the house. Let Generate
      // continue; prompt assembly is still several awaits away.
      clearTimeout(this._fullRefreshT);
      this._fullRefreshT = setTimeout(() => this.refreshAlwaysOn({ full: true }), 0);
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
        return { id: rule.id, chars: 0 };
      }
      const text = String(rule.buildText() ?? '');
      setExtensionPrompt(PROMPT_KEY_PREFIX + rule.id, text, rule.position, rule.depth);
      return { id: rule.id, chars: text.length };
    } catch (err) {
      console.error(`[Injector] rule ${rule.id} failed:`, err);
      return { id: rule.id, chars: 0 };
    }
  }
}
