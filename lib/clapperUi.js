// Floating Scene Clapper — wood-framed chalkboard (Inventory whiteboard’s twin).

/**
 * @param {{ esc: Function, clap: object, scene: object, pinned?: boolean }} opts
 */
export function buildFloatingClapperHtml({ esc, clap, scene, pinned = false }) {
  const c = clap || {};
  const s = scene || {};
  const loc = c.location || s.lastLocationKey || '—';
  const time = c.time || s.lastTimeLabel || '—';
  const date = c.date || s.lastDateLabel || '—';
  const weather = `${c.weatherEmoji || s.weatherEmoji || ''} ${c.weatherLabel || s.weatherLabel || '—'}`.trim();

  const rows = [];
  rows.push({ k: 'location', v: loc });
  if (s.time) rows.push({ k: 'time', v: time || '—' });
  if (s.date) rows.push({ k: 'date', v: date });
  if (s.weather) rows.push({ k: 'weather', v: weather });

  return `
    <div class="st-clap-chrome">
      <div class="st-clap-rail" data-role="clap-drag" title="Drag to move">
        <span class="st-clap-logo">Scene board</span>
        <div class="st-clap-acts">
          <button type="button" class="st-clap-btn${pinned ? ' on' : ''}" data-action="clap-pin" title="${pinned ? 'Unpin' : 'Pin'}">${pinned ? '📌' : '📍'}</button>
          <button type="button" class="st-clap-btn" data-action="clap-refresh" title="Clap / refresh">▣</button>
          <button type="button" class="st-clap-btn" data-action="clap-hide" title="Hide">−</button>
        </div>
      </div>
      <div class="st-clap-slate">
        <div class="st-clap-slate-inner">
          ${rows.map(r => `
            <div class="st-clap-row">
              <span class="st-clap-k">${esc(r.k)}</span>
              <span class="st-clap-v">${esc(r.v)}</span>
            </div>`).join('')}
        </div>
        <div class="st-clap-ledge" aria-hidden="true"></div>
      </div>
    </div>`;
}

export const CLAPPER_CSS = `
.st-clapper-float {
  position: fixed;
  z-index: 45;
  left: 24px;
  bottom: 24px;
  width: min(260px, calc(100vw - 32px));
  user-select: none;
  pointer-events: auto;
  font-family: var(--st-font-body, Georgia, "Times New Roman", serif);
  filter: drop-shadow(0 8px 20px rgba(0,0,0,0.4));
}
.st-clapper-float[hidden] { display: none !important; }
.st-clapper-float.pinned {
  outline: 1px solid rgba(232, 197, 107, 0.55);
  outline-offset: 3px;
}

/* Outer wood rail — same language as Inventory’s whiteboard frame */
.st-clap-chrome {
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  padding: 8px 8px 10px;
  background: linear-gradient(#6b4226, #4a2c18);
  border: 3px solid #3a2414;
  box-shadow:
    inset 0 0 0 4px #8a5a32,
    inset 0 0 0 6px #3a2414;
}

.st-clap-rail {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 2px 4px 8px;
  cursor: grab;
  color: #e8d4b0;
}
.st-clap-rail:active { cursor: grabbing; }
.st-clap-logo {
  font-family: var(--st-font-title, "Playfair Display", Georgia, serif);
  font-size: 11px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #e8c56b;
  text-shadow: 0 1px 0 rgba(0,0,0,0.35);
  margin-right: auto;
}
.st-clap-acts { display: flex; gap: 3px; flex: 0 0 auto; }
.st-clap-btn {
  appearance: none;
  border: 1px solid #3a2414;
  background: linear-gradient(#8a5a32, #6b4226);
  color: #f4ead5;
  width: 22px;
  height: 20px;
  border-radius: 2px;
  cursor: pointer;
  font-size: 11px;
  line-height: 1;
  padding: 0;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.12);
}
.st-clap-btn:hover,
.st-clap-btn.on {
  background: #1a1208;
  color: #e8c56b;
  border-color: #e8c56b;
}

/* Chalkboard face */
.st-clap-slate {
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.st-clap-slate-inner {
  position: relative;
  padding: 12px 12px 14px;
  background-color: #1e3a2f;
  background-image:
    radial-gradient(ellipse at 30% 20%, rgba(255,255,255,0.04), transparent 50%),
    radial-gradient(ellipse at 80% 70%, rgba(0,0,0,0.18), transparent 45%),
    repeating-linear-gradient(
      0deg,
      transparent 0 27px,
      rgba(255,255,255,0.03) 27px 28px
    ),
    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.04 0'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23n)'/%3E%3C/svg%3E");
  border: 1px solid #0f1f18;
  box-shadow:
    inset 0 0 36px rgba(0,0,0,0.35),
    inset 0 0 0 1px rgba(255,255,255,0.04);
  color: #eef4ea;
}
.st-clap-row {
  display: grid;
  grid-template-columns: 4.4em 1fr;
  gap: 8px;
  align-items: baseline;
  padding: 5px 0;
  border-top: 1px dashed rgba(220, 235, 210, 0.18);
}
.st-clap-row:first-child { border-top: none; padding-top: 0; }
.st-clap-k {
  font-family: var(--st-font-mono, "Courier New", monospace);
  font-size: 9px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: rgba(180, 210, 170, 0.55);
}
.st-clap-v {
  font-family: var(--st-font-mono, "Special Elite", "Courier New", monospace);
  font-size: 14px;
  line-height: 1.3;
  word-break: break-word;
  color: #f2f7ee;
  text-shadow:
    0 0 1px rgba(255,255,255,0.25),
    0.5px 0.5px 0 rgba(0,0,0,0.35);
  font-weight: 400;
}

/* Chalk tray / ledge */
.st-clap-ledge {
  height: 10px;
  margin-top: 0;
  background:
    linear-gradient(#5a3a22, #3a2414);
  border: 1px solid #2a1810;
  border-top: none;
  box-shadow:
    inset 0 2px 0 rgba(255,255,255,0.06),
    inset 0 -2px 4px rgba(0,0,0,0.35);
  position: relative;
}
.st-clap-ledge::after {
  content: '';
  position: absolute;
  left: 12px;
  top: 2px;
  width: 28px;
  height: 5px;
  border-radius: 1px;
  background: linear-gradient(90deg, #f4ead5, #e8dcc0);
  box-shadow: 40px 0 0 #c9e0c0, 72px 0 0 #d8c4a0;
  opacity: 0.85;
}

.st-clapper-float.clapping .st-clap-slate-inner {
  animation: st-clap-dust 0.28s ease;
}
@keyframes st-clap-dust {
  0% { filter: brightness(1); }
  35% { filter: brightness(1.18); }
  100% { filter: brightness(1); }
}
`;
