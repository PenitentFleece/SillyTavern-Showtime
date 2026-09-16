// Base class every module extends. Enforces the contract.

export class Module {
  static id = 'base';
  static label = 'Base';
  static icon = null;
  static scope = 'chat'; // 'chat' | 'global' | 'hybrid'

  constructor({ storage, bus, injector }) {
  this.storage = storage;
  this.bus = bus;
  this.injector = injector;
  this.container = null;
}

  async init() { /* subclasses override */ }

  // Return an object matching your module's schema. Called on first use.
  getDefaultState() { return {}; }

  // Convenience accessors — subclass just calls this.state / this.saveState()
  get state() {
    const cls = this.constructor;
    if (cls.scope === 'global') {
      return this.storage.getGlobal(cls.id, this.getDefaultState());
    }
    return this.storage.getChat(cls.id, this.getDefaultState());
  }

  saveState() {
    const cls = this.constructor;
    if (cls.scope === 'global') this.storage.saveGlobal();
    else this.storage.saveChat();
  }

  async render(container) {
    this.container = container;
    container.innerHTML = `<div class="st-placeholder">
      <em>${this.constructor.label}</em> module — not yet implemented.
    </div>`;
  }

  async onChatChanged() { /* subclasses override if needed */ }
  destroy() { }
}