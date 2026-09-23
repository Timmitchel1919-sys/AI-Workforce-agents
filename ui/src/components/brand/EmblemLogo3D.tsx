import { forwardRef } from "react";
import { LOGO_ALT } from "./brand";

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
export const EmblemLogo3D = forwardRef<HTMLDivElement, { still?: boolean; decorative?: boolean }>(function EmblemLogo3D(
  { still = false, decorative = false },
  spinnerRef,
) {
  return (
    <div className="emblem-logo" data-testid="emblem-logo">
      <div ref={spinnerRef} className={`emblem-logo__spinner${still ? " is-still" : ""}`}>
        {Array.from({ length: DEPTH_LAYERS }).map((_, index) => {
          // Evenly spaced from back (-0.5) to front (+0.5), excluding the faces.
          const t = (index + 1) / (DEPTH_LAYERS + 1) - 0.5;
          return (
            <span
              key={index}
              className="emblem-logo__slice"
              style={{
                transform: `translateZ(calc(var(--emblem-depth) * ${t.toFixed(4)}))`,
                filter: `brightness(${(0.72 + Math.abs(t) * 0.5).toFixed(3)})`,
              }}
              aria-hidden="true"
            />
          );
        })}
        <span className="emblem-logo__side" aria-hidden="true" />
        <span className="emblem-logo__side emblem-logo__side--far" aria-hidden="true" />

        <picture className="emblem-logo__face emblem-logo__face--front">
          <source type="image/webp" srcSet={LOGO_SRC} />
          <img src={LOGO_FALLBACK} alt={decorative ? "" : LOGO_ALT} draggable={false} />
        </picture>
        <picture className="emblem-logo__face emblem-logo__face--back" aria-hidden="true">
          <source type="image/webp" srcSet={LOGO_SRC} />
          <img src={LOGO_FALLBACK} alt="" draggable={false} />
        </picture>
        <span className="emblem-logo__sheen emblem-logo__sheen--front" aria-hidden="true" />
        <span className="emblem-logo__sheen emblem-logo__sheen--back" aria-hidden="true" />
      </div>
    </div>
  );
});

export default EmblemLogo3D;
