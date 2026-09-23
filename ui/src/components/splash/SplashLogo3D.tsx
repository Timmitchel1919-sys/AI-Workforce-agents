import { forwardRef } from "react";
import { LOGO_ALT } from "../brand/brand";

/** Same optimized derivative of the master logo used everywhere else. */
const LOGO_SRC = "/brand/logo-hero-800.webp";
const LOGO_FALLBACK = "/brand/logo-hero-800.png";

/** Extrusion slices between the front and back faces (more = smoother side view). */
const DEPTH_LAYERS = 18;

/**
 * The official logo as a physical emblem rotating around its vertical Y-axis.
 *
 * CSS 3D rather than WebGL: the project ships no 3D stack and only a raster
 * master of the logo, so an accurate extruded mesh isn't available. Instead:
 * - front and back faces are the unmodified logo image;
 * - the extrusion is a stack of gold slices masked by the *same* image, so
 *   the gold edge follows the exact logo silhouette at every angle;
 * - a perpendicular side plane closes the edge at 90° / 270°;
 * - lighting keyframes run on the same 10s clock as the rotation.
 */
export const SplashLogo3D = forwardRef<HTMLDivElement, { still?: boolean }>(function SplashLogo3D(
  { still = false },
  spinnerRef,
) {
  return (
    <div className="splash-logo" data-testid="splash-logo">
      <div ref={spinnerRef} className={`splash-logo__spinner${still ? " is-still" : ""}`}>
        {Array.from({ length: DEPTH_LAYERS }).map((_, index) => {
          // Evenly spaced from back (-0.5) to front (+0.5), excluding the faces.
          const t = (index + 1) / (DEPTH_LAYERS + 1) - 0.5;
          return (
            <span
              key={index}
              className="splash-logo__slice"
              style={{
                transform: `translateZ(calc(var(--splash-depth) * ${t.toFixed(4)}))`,
                filter: `brightness(${(0.72 + Math.abs(t) * 0.5).toFixed(3)})`,
              }}
              aria-hidden="true"
            />
          );
        })}
        <span className="splash-logo__side" aria-hidden="true" />
        <span className="splash-logo__side splash-logo__side--far" aria-hidden="true" />

        <picture className="splash-logo__face splash-logo__face--front">
          <source type="image/webp" srcSet={LOGO_SRC} />
          <img src={LOGO_FALLBACK} alt={LOGO_ALT} draggable={false} />
        </picture>
        <picture className="splash-logo__face splash-logo__face--back" aria-hidden="true">
          <source type="image/webp" srcSet={LOGO_SRC} />
          <img src={LOGO_FALLBACK} alt="" draggable={false} />
        </picture>
        <span className="splash-logo__sheen splash-logo__sheen--front" aria-hidden="true" />
        <span className="splash-logo__sheen splash-logo__sheen--back" aria-hidden="true" />
      </div>
    </div>
  );
});

export default SplashLogo3D;
