// Switch SillyTavern connection profiles for Showtime agents.
// Slots live on Backstage global settings: audit / motivation / event.

export async function withShowtimeProfile(storage, slot, fn) {
  let profileId = '';
  try {
    profileId = String(storage?.getGlobal?.('backstage', {})?.profiles?.[slot] || '').trim();
  } catch { /* ignore */ }
  if (!profileId) return fn();
  const mgr = window.connection_manager ?? window.connectionManager ?? null;
  if (!mgr) return fn();
  const prev = mgr.getCurrentProfile?.() ?? mgr.activeProfile ?? null;
  try {
    await (mgr.setProfile ?? mgr.applyProfile)?.call(mgr, profileId);
  } catch (e) {
    console.warn('[Showtime] profile switch failed', slot, e);
  }
  try {
    return await fn();
  } finally {
    if (prev && prev !== profileId) {
      try {
        await (mgr.setProfile ?? mgr.applyProfile)?.call(mgr, prev);
      } catch (e) {
        console.warn('[Showtime] profile restore failed', slot, e);
      }
    }
  }
}
