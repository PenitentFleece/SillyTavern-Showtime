// Shared Cast status-bar defs + expression labels (receipts and Cast).

export const STAT_DEFS = {
  base: [
    {
      id: 'health', label: 'Health', color: '#7a1f1f', direction: 'up',
      auditHint: 'injury, blood, pain, illness lower this; treatment raises it',
      thresholds: [
        { at: 15,  label: 'Dying' },
        { at: 30,  label: 'Critical' },
        { at: 50,  label: 'Wounded' },
        { at: 70,  label: 'Injured' },
        { at: 85,  label: 'Hurt' },
        { at: 95,  label: 'Uncomfortable' },
        { at: 101, label: 'Healthy' },
      ],
    },
    {
      id: 'energy', label: 'Energy', color: '#c9a24a', direction: 'up',
      auditHint: 'exertion and sleeplessness lower this; rest raises it',
      thresholds: [
        { at: 20,  label: 'Exhausted' },
        { at: 50,  label: 'Drained' },
        { at: 80,  label: 'Tired' },
        { at: 95,  label: 'Rested' },
        { at: 101, label: 'Energized' },
      ],
    },
  ],
  hard: [
    {
      id: 'hunger', label: 'Satiety', color: '#a86b2b', direction: 'up', group: 'Satiation',
      auditHint: 'this is fullness, NOT hunger pangs — eating RAISES it; skipping meals LOWERS it',
      thresholds: [
        { at: 25,  label: 'Starving' },
        { at: 60,  label: 'Hungry' },
        { at: 80,  label: 'Peckish' },
        { at: 95,  label: 'Full' },
        { at: 101, label: 'Sated' },
      ],
    },
    {
      id: 'thirst', label: 'Hydration', color: '#4a7fa8', direction: 'up', group: 'Satiation',
      auditHint: 'this is hydration — drinking RAISES it; going thirsty LOWERS it',
      thresholds: [
        { at: 25,  label: 'Dehydrated' },
        { at: 60,  label: 'Parched' },
        { at: 80,  label: 'Thirsty' },
        { at: 95,  label: 'Content' },
        { at: 101, label: 'Slaked' },
      ],
    },
    {
      id: 'bathroom', label: 'Bladder', direction: 'down', group: 'Needs',
      auditHint: 'bladder pressure — needing to pee RAISES this; relieving LOWERS it toward 0',
      thresholds: [
        { at: 40,  label: 'Empty' },
        { at: 70,  label: 'Comfortable' },
        { at: 85,  label: 'Pressing' },
        { at: 95,  label: 'Urgent' },
        { at: 101, label: 'Bursting' },
      ],
    },
    {
      id: 'hygiene', label: 'Odor', direction: 'down', group: 'Needs',
      auditHint: 'body odor — sweat, dirt, mess RAISE this; washing or clean clothes LOWER it toward 0',
      thresholds: [
        { at: 40,  label: 'Fresh' },
        { at: 65,  label: 'Musty' },
        { at: 85,  label: 'Rank' },
        { at: 95,  label: 'Foul' },
        { at: 101, label: 'Reeking' },
      ],
    },
  ],
};

export const ALL_STAT_DEFS = [...STAT_DEFS.base, ...STAT_DEFS.hard];
export const THRESHOLD_NOTIFY_STATS = new Set(['bathroom', 'hygiene', 'health', 'energy', 'hunger', 'thirst']);

export const DEFAULT_STATS = () => ({
  enabled: false,
  hardMode: false,
  health: 100,
  energy: 100,
  hunger: 100,
  thirst: 100,
  bathroom: 0,
  hygiene: 0,
});

export function clampStat(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

export function stateLabel(def, val) {
  if (!def || def.levelMode === 'none') return '';
  if (def.levelMode === 'amount') return String(val);
  const t = def.thresholds ?? [];
  for (let i = 0; i < t.length; i++) {
    if (val < t[i].at) return t[Math.max(0, i)].label;
  }
  return t[t.length - 1]?.label ?? '';
}

export function customBarDefsFromTrackers(storage) {
  try {
    const bars = storage.getChat('backstage', {})?.trackers?.status?.customBars;
    if (!Array.isArray(bars)) return [];
    return bars.map(b => {
      try {
        const levels = Array.isArray(b?.levels) ? b.levels : [];
        return {
          id: String(b.id || ''),
          label: String(b.name || 'Custom'),
          color: b.color || '#6a8a4a',
          direction: b.direction === 'down' ? 'down' : 'up',
          levelMode: ['none', 'label', 'amount'].includes(b.levelMode) ? b.levelMode : 'label',
          description: String(b.description || ''),
          thresholds: levels.map(lv => ({
            at: Number(lv?.at) || 0,
            label: String(lv?.label || ''),
          })).concat([{ at: 101, label: levels.slice(-1)[0]?.label || '' }]),
          custom: true,
        };
      } catch {
        return null;
      }
    }).filter(d => d && d.id);
  } catch {
    return [];
  }
}

export function barDefsFor(storage, char) {
  const custom = customBarDefsFromTrackers(storage);
  return [
    ...STAT_DEFS.base,
    ...(char?.stats?.hardMode ? STAT_DEFS.hard : []),
    ...custom,
  ];
}

export function statValue(stats, def) {
  if (!def) return 0;
  if (def.custom) {
    const bag = stats?.custom && typeof stats.custom === 'object' ? stats.custom : {};
    if (Object.prototype.hasOwnProperty.call(bag, def.id)) return clampStat(bag[def.id]);
    return 50;
  }
  const fallback = def.direction === 'down' ? 0 : 100;
  return clampStat(stats?.[def.id] ?? fallback);
}

export function setStatValue(stats, def, val) {
  if (!stats || !def) return clampStat(val);
  const n = clampStat(val);
  if (def.custom) {
    if (!stats.custom || typeof stats.custom !== 'object') stats.custom = {};
    stats.custom[def.id] = n;
  } else {
    stats[def.id] = n;
  }
  return n;
}

/** Chip only when the expression title changes. Numeric-only / no-label bars skip. */
/** The two worst words on a bar. High-is-better uses the low end; high-is-worse uses the high end. */
export function severeLabels(def) {
  const labels = [];
  for (const t of def?.thresholds || []) {
    const label = String(t?.label || '').trim();
    if (!label || labels[labels.length - 1] === label) continue;
    labels.push(label);
  }
  if (labels.length < 2) return labels;
  return def.direction === 'down' ? labels.slice(-2) : labels.slice(0, 2);
}

export function isSevereStat(def, val) {
  if (!def || def.levelMode === 'none' || def.levelMode === 'amount') return false;
  const label = stateLabel(def, clampStat(val));
  if (!label) return false;
  return severeLabels(def).includes(label);
}

const STAT_BEHAVIOR_CUES = Object.freeze({
  health: {
    Uncomfortable: 'minor aches or physical discomfort show in posture and movement',
    Hurt: 'bruised or hurting; favors the sore spot and winces under strain',
    Injured: 'visibly injured; guarded movement, steady pain, and reduced physical force',
    Wounded: 'badly wounded; bleeding or acute pain slows every motion and taxes stamina',
    Critical: 'critically wounded; struggling to stay upright or focused through severe trauma',
    Dying: 'on the verge of collapse; barely conscious and unable to sustain physical action',
  },
  energy: {
    Tired: 'noticeably tired; heavier breathing, slower reflexes, and ready for a break',
    Drained: 'physically and mentally drained; sluggish pace, heavy eyelids, and labored effort',
    Exhausted: 'completely exhausted; trembling limbs, struggling to stay awake or keep moving',
  },
  hunger: {
    Peckish: 'a little hungry; thoughts occasionally drift toward food',
    Hungry: 'decidedly hungry; hollow stomach, distracted focus, and low blood sugar',
    Starving: 'starving; gnawing stomach cramps, lightheadedness, and weakness from lack of food',
  },
  thirst: {
    Thirsty: 'dry mouth and noticeable thirst',
    Parched: 'parched throat and cracked lips; strongly craves something to drink',
    Dehydrated: 'severely dehydrated; dizzy, raspy-voiced, and physically weakened',
  },
  bathroom: {
    Pressing: 'pressing bladder need; subtle shifting and looking for a restroom',
    Urgent: 'urgent bladder pressure; tense posture, distracted, and needing relief soon',
    Bursting: 'desperate bladder urgency; barely holding back and unable to focus on anything else',
  },
  hygiene: {
    Musty: 'slightly sweaty and disheveled from activity',
    Rank: 'sticky with sweat and grime; noticeable body odor',
    Foul: 'coated in dirt or sweat with a strong, unpleasant odor',
    Reeking: 'filthy and reeking; unmistakable stench that others in close range notice',
  },
});

/**
 * Physical/behavioral cue for mid-tier and severe stat states.
 * Healthy / Energized / Rested / Sated / Full / Slaked / Content / Empty / Comfortable / Fresh return ''.
 */
export function statBehaviorCue(def, val) {
  if (!def || def.levelMode === 'none' || def.levelMode === 'amount') return '';
  const v = clampStat(val);
  const label = stateLabel(def, v);
  if (!label) return '';
  const byId = STAT_BEHAVIOR_CUES[def.id];
  if (byId && Object.prototype.hasOwnProperty.call(byId, label)) {
    return byId[label];
  }
  if (def.custom) {
    const worse = def.direction === 'down' ? v >= 60 : v < 75;
    if (!worse && !isSevereStat(def, v)) return '';
    return def.description ? `${label} (${def.description})` : label;
  }
  return '';
}

export function statTitleChip(def, cur, next) {
  if (!def || def.levelMode === 'none' || def.levelMode === 'amount') return null;
  const from = stateLabel(def, cur);
  const to = stateLabel(def, next);
  if (!from || !to || from === to) return null;
  return { name: String(def.label || def.id), change: `${from} → ${to}` };
}

export function smokeStatBarsPure() {
  try {
    const energy = STAT_DEFS.base.find(d => d.id === 'energy');
    if (stateLabel(energy, 10) !== 'Exhausted') return 'energy 10 exhausted';
    if (stateLabel(energy, 45) !== 'Drained') return 'energy 45 drained';
    const chip = statTitleChip(energy, 45, 10);
    if (chip?.name !== 'Energy' || chip?.change !== 'Drained → Exhausted') return 'title chip';
    if (statTitleChip(energy, 90, 92)) return 'same title should not chip';
    const amount = { ...energy, levelMode: 'amount' };
    if (statTitleChip(amount, 10, 90)) return 'amount mode should not chip';
    const health = STAT_DEFS.base.find(d => d.id === 'health');
    const bladder = STAT_DEFS.hard.find(d => d.id === 'bathroom');
    if (!isSevereStat(health, 10) || !isSevereStat(health, 20)) return 'health severe';
    if (isSevereStat(health, 40)) return 'wounded is not the bottom band';
    if (!isSevereStat(bladder, 90) || !isSevereStat(bladder, 98)) return 'bladder severe';
    if (isSevereStat(bladder, 50)) return 'comfortable bladder is not severe';
    if (isSevereStat(amount, 10)) return 'amount mode is not severe';
    if (statBehaviorCue(energy, 98) !== '' || statBehaviorCue(energy, 85) !== '') {
      return 'energized/rested should not emit a behavior cue';
    }
    if (!/tired/i.test(statBehaviorCue(energy, 65))) return 'tired mid-tier cue';
    if (!/bruised|hurting/i.test(statBehaviorCue(health, 75))) return 'hurt mid-tier cue';
    if (!/bladder/i.test(statBehaviorCue(bladder, 78))) return 'pressing bladder mid-tier cue';
    return '';
  } catch (err) {
    return err?.message || String(err);
  }
}
