/**
 * Decorative brand scenery: independent orbital rings around the emblem and
 * a slow Earth horizon with a restrained global network. SVG + CSS only.
 */

const TICKS = Array.from({ length: 60 }, (_, index) => index * 6);

export function EmblemOrbits() {
  return (
    <svg className="emblem-orbits" viewBox="0 0 600 600" aria-hidden="true">
      <defs>
        <linearGradient id="emblem-gold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#f2d48a" stopOpacity="0.9" />
          <stop offset="55%" stopColor="#b8862f" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#f2d48a" stopOpacity="0.8" />
        </linearGradient>
      </defs>

      {/* Outer ring — 40s, tick marks + HUD segments. */}
      <g className="emblem-orbits__ring emblem-orbits__ring--outer">
        <circle cx="300" cy="300" r="286" className="emblem-orbits__line" />
        {TICKS.map((angle) => (
          <line
            key={angle}
            x1="300"
            y1="14"
            x2="300"
            y2={angle % 30 === 0 ? 30 : 21}
            transform={`rotate(${angle} 300 300)`}
            className="emblem-orbits__tick"
          />
        ))}
        <path d="M 300 6 A 294 294 0 0 1 507.9 92.1" className="emblem-orbits__hud" />
        <path d="M 300 594 A 294 294 0 0 1 92.1 507.9" className="emblem-orbits__hud" />
        <circle cx="586" cy="300" r="3.2" className="emblem-orbits__node" />
      </g>

      {/* Middle ring — 26s reverse, gold, with nodes. */}
      <g className="emblem-orbits__ring emblem-orbits__ring--middle">
        <circle cx="300" cy="300" r="246" stroke="url(#emblem-gold)" className="emblem-orbits__gold" />
        <circle cx="300" cy="54" r="3.6" className="emblem-orbits__node emblem-orbits__node--gold" />
        <circle cx="87" cy="423" r="2.6" className="emblem-orbits__node" />
      </g>

      {/* Inner ring — 18s, dashed. */}
      <g className="emblem-orbits__ring emblem-orbits__ring--inner">
        <circle cx="300" cy="300" r="206" className="emblem-orbits__dashed" />
        <circle cx="506" cy="300" r="2.8" className="emblem-orbits__node" />
        <circle cx="94" cy="300" r="2.2" className="emblem-orbits__node emblem-orbits__node--gold" />
      </g>
    </svg>
  );
}

const ARCS = [
  { d: "M 180 250 Q 420 60 700 210", gold: false },
  { d: "M 520 300 Q 800 80 1080 250", gold: true },
  { d: "M 860 230 Q 1080 70 1320 260", gold: false },
  { d: "M 320 330 Q 640 170 980 320", gold: false },
];

const HUBS = [
  { x: 180, y: 250 },
  { x: 700, y: 210, gold: true },
  { x: 520, y: 300 },
  { x: 1080, y: 250, gold: true },
  { x: 860, y: 230 },
  { x: 1320, y: 260 },
  { x: 320, y: 330 },
  { x: 980, y: 320 },
];

export function EarthHorizon() {
  return (
    <div className="earth-horizon" aria-hidden="true">
      <div className="earth-horizon__planet">
        <div className="earth-horizon__lights" />
        <div className="earth-horizon__shade" />
      </div>
      <svg className="earth-horizon__network" viewBox="0 0 1500 420" preserveAspectRatio="xMidYMin slice">
        {ARCS.map((arc, index) => (
          <g key={arc.d}>
            <path d={arc.d} className={`earth-horizon__arc${arc.gold ? " is-gold" : ""}`} />
            <path
              d={arc.d}
              pathLength={100}
              className="earth-horizon__pulse"
              style={{ animationDelay: `${index * 1.9}s` }}
            />
          </g>
        ))}
        {HUBS.map((hub) => (
          <circle
            key={`${hub.x}-${hub.y}`}
            cx={hub.x}
            cy={hub.y}
            r={hub.gold ? 3.4 : 2.6}
            className={`earth-horizon__hub${hub.gold ? " is-gold" : ""}`}
          />
        ))}
      </svg>
    </div>
  );
}
