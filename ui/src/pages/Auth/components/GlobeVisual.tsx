/**
 * A restrained "global intelligence" horizon: a partial wireframe Earth with a
 * few network arcs. Decorative SVG only.
 */
const ARCS = [
  "M 120 330 Q 260 170 420 300",
  "M 220 360 Q 380 210 560 330",
  "M 60 420 Q 200 300 330 380",
  "M 400 380 Q 520 260 640 360",
];

const POINTS: Array<{ x: number; y: number; gold?: boolean }> = [
  { x: 120, y: 330 },
  { x: 420, y: 300, gold: true },
  { x: 220, y: 360 },
  { x: 560, y: 330 },
  { x: 60, y: 420 },
  { x: 330, y: 380, gold: true },
  { x: 400, y: 380 },
  { x: 640, y: 360 },
];

export function GlobeVisual() {
  return (
    <svg className="auth-globe" viewBox="0 0 700 520" aria-hidden="true" preserveAspectRatio="xMidYMax slice">
      <defs>
        <radialGradient id="auth-globe-fill" cx="50%" cy="0%" r="70%">
          <stop offset="0%" stopColor="#1f5eff" stopOpacity="0.28" />
          <stop offset="70%" stopColor="#081a4d" stopOpacity="0.12" />
          <stop offset="100%" stopColor="#02040a" stopOpacity="0" />
        </radialGradient>
        <clipPath id="auth-globe-clip">
          <circle cx="350" cy="900" r="620" />
        </clipPath>
      </defs>

      <circle className="auth-globe__body" cx="350" cy="900" r="620" fill="url(#auth-globe-fill)" />
      <g clipPath="url(#auth-globe-clip)" className="auth-globe__grid">
        {[0, 1, 2, 3, 4, 5].map((index) => (
          <ellipse key={`lat-${index}`} cx="350" cy="900" rx="620" ry={560 - index * 90} />
        ))}
        {[-4, -3, -2, -1, 0, 1, 2, 3, 4].map((index) => (
          <ellipse key={`lon-${index}`} cx="350" cy="900" rx={Math.abs(index) * 150 + 20} ry="620" />
        ))}
      </g>
      <circle className="auth-globe__rim" cx="350" cy="900" r="620" />

      <g className="auth-globe__arcs">
        {ARCS.map((d, index) => (
          <path key={d} d={d} pathLength={100} style={{ animationDelay: `${index * 2.2}s` }} />
        ))}
      </g>
      <g className="auth-globe__points">
        {POINTS.map((point) => (
          <circle
            key={`${point.x}-${point.y}`}
            cx={point.x}
            cy={point.y}
            r={point.gold ? 3 : 2.4}
            className={point.gold ? "is-gold" : undefined}
          />
        ))}
      </g>
    </svg>
  );
}

export default GlobeVisual;
