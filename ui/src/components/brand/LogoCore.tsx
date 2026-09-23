import { LOGO_ALT } from "./brand";

const MARKERS = Array.from({ length: 24 }, (_, index) => index * 15);
const ORBITERS = [0, 120, 240];

/**
 * The hero logo presented inside a slow, precise energy system. The logo
 * image itself is never recoloured, cropped, or rotated — only the
 * environment around it moves.
 */
export function LogoCore({ size = "hero" }: { size?: "hero" | "compact" }) {
  return (
    <div className={`lp-core lp-core--${size}`}>
      <div className="lp-core__aura" aria-hidden="true" />

      <svg className="lp-core__rings" viewBox="0 0 400 400" aria-hidden="true">
        <defs>
          <linearGradient id="lp-gold-ring" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#f2d48a" stopOpacity="0.85" />
            <stop offset="50%" stopColor="#b8862f" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#f2d48a" stopOpacity="0.75" />
          </linearGradient>
        </defs>

        <circle className="lp-core__ring-outer" cx="200" cy="200" r="194" />

        <g className="lp-core__markers">
          {MARKERS.map((angle) => (
            <line
              key={angle}
              x1="200"
              y1="14"
              x2="200"
              y2={angle % 90 === 0 ? 28 : 21}
              transform={`rotate(${angle} 200 200)`}
            />
          ))}
        </g>

        <circle className="lp-core__ring-dashed" cx="200" cy="200" r="172" />

        <g className="lp-core__orbit">
          {ORBITERS.map((angle) => (
            <circle
              key={angle}
              r="2.4"
              cx="200"
              cy="28"
              transform={`rotate(${angle} 200 200)`}
            />
          ))}
        </g>

        <circle className="lp-core__ring-gold" cx="200" cy="200" r="152" stroke="url(#lp-gold-ring)" />
      </svg>

      <picture className="lp-core__logo">
        <source
          type="image/webp"
          srcSet="/brand/logo-hero-480.webp 480w, /brand/logo-hero-800.webp 800w"
          sizes={size === "hero" ? "(max-width: 640px) 60vw, 310px" : "120px"}
        />
        <img
          src="/brand/logo-hero-800.png"
          srcSet="/brand/logo-hero-480.png 480w, /brand/logo-hero-800.png 800w"
          sizes={size === "hero" ? "(max-width: 640px) 60vw, 310px" : "120px"}
          // The hero carries the description; the repeated compact mark is decorative.
          alt={size === "hero" ? LOGO_ALT : ""}
          width={800}
          height={614}
          decoding="async"
          fetchPriority={size === "hero" ? "high" : "auto"}
        />
      </picture>
    </div>
  );
}

export default LogoCore;
