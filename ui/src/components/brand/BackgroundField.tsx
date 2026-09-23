/**
 * Decorative full-screen environment: radial illumination, a faint technical
 * grid, and a sparse network of nodes with a few slow data pulses. Pure
 * CSS/SVG — no canvas or WebGL.
 */

// Deterministic layout in a 1600×1000 viewBox so renders are stable.
const NODES: Array<[number, number]> = [
  [120, 180], [310, 90], [460, 240], [220, 420], [90, 640], [330, 760],
  [520, 560], [700, 120], [1180, 140], [1340, 300], [1500, 160], [1440, 520],
  [1260, 640], [1520, 820], [1120, 880], [940, 760], [1360, 960], [640, 920],
];

const EDGES: Array<[number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [3, 6], [1, 7],
  [8, 9], [9, 10], [9, 11], [11, 12], [12, 13], [12, 14], [14, 15], [13, 16], [15, 17], [6, 17],
];

const PULSE_EDGES = [2, 5, 10, 13];

export function BackgroundField() {
  return (
    <div className="lp-bg" aria-hidden="true">
      <div className="lp-bg__glow" />
      <div className="lp-bg__grid" />
      <svg
        className="lp-bg__network"
        viewBox="0 0 1600 1000"
        preserveAspectRatio="xMidYMid slice"
      >
        <g className="lp-bg__edges">
          {EDGES.map(([a, b], index) => (
            <line
              key={index}
              x1={NODES[a][0]}
              y1={NODES[a][1]}
              x2={NODES[b][0]}
              y2={NODES[b][1]}
            />
          ))}
        </g>
        <g className="lp-bg__pulses">
          {PULSE_EDGES.map((edgeIndex, index) => {
            const [a, b] = EDGES[edgeIndex];
            return (
              <line
                key={edgeIndex}
                x1={NODES[a][0]}
                y1={NODES[a][1]}
                x2={NODES[b][0]}
                y2={NODES[b][1]}
                pathLength={100}
                style={{ animationDelay: `${index * 2.4}s` }}
              />
            );
          })}
        </g>
        <g className="lp-bg__nodes">
          {NODES.map(([x, y], index) => (
            <circle
              key={index}
              cx={x}
              cy={y}
              r={index % 4 === 0 ? 2.6 : 1.8}
              style={{ animationDelay: `${(index % 6) * 1.3}s` }}
            />
          ))}
        </g>
      </svg>
      <div className="lp-bg__particles">
        {Array.from({ length: 14 }).map((_, index) => (
          <span
            key={index}
            style={{
              left: `${(index * 37) % 100}%`,
              top: `${(index * 53) % 100}%`,
              animationDelay: `${index * 1.7}s`,
              animationDuration: `${18 + (index % 5) * 4}s`,
            }}
          />
        ))}
      </div>
      <div className="lp-bg__vignette" />
    </div>
  );
}

export default BackgroundField;
