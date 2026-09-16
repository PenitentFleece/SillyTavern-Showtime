// Tiny pub/sub bus. Modules use this to talk without direct coupling.
// Example: Inventory picks up a "sword", emits 'item.acquired',
// Script module listens and logs a timeline entry.

export class Bus {
  constructor() {
    this.handlers = new Map();
  }

  on(event, fn) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event).add(fn);
    return () => this.off(event, fn); // returns unsubscribe
  }

  off(event, fn) {
    this.handlers.get(event)?.delete(fn);
  }

  emit(event, payload) {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const fn of set) {
      try { fn(payload); } catch (e) { console.error(`[Showtime bus] ${event}`, e); }
    }
  }
}