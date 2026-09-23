import { forwardRef, type CSSProperties } from "react";
import { EmblemLogo3D } from "./EmblemLogo3D";
import { EmblemOrbits } from "./EmblemScenery";
import "./emblem.css";

export interface RotatingEmblemProps {
  /** Logo width; the orbital field scales from it. Any CSS length (e.g. a clamp()). */
  logoWidth?: string;
  /** Static, front-facing emblem (reduced motion). */
  still?: boolean;
  /** Hide the logo from assistive tech when the page already names the brand nearby. */
  decorative?: boolean;
  className?: string;
}

/**
 * The AI Workforce emblem as one physical 3D object: the official logo
 * rotating on its Y-axis inside an energy sphere, a tilted equator orbit and
 * independent orbital rings. Shared by the splash, landing page and auth
 * gateway so the brand moves identically everywhere.
 *
 * The forwarded ref points at the rotating element (used by the splash to
 * settle the emblem to its front face on exit).
 */
export const RotatingEmblem = forwardRef<HTMLDivElement, RotatingEmblemProps>(function RotatingEmblem(
  { logoWidth, still = false, decorative = false, className },
  spinnerRef,
) {
  const style = logoWidth ? ({ "--emblem-logo-w": logoWidth } as CSSProperties) : undefined;

  return (
    <div className={["emblem", className ?? ""].filter(Boolean).join(" ")} style={style}>
      <EmblemOrbits />
      <div className="emblem-sphere" aria-hidden="true" />
      <div className="emblem-scene">
        <div className="emblem-equator" aria-hidden="true">
          <span />
          <span />
        </div>
        <EmblemLogo3D ref={spinnerRef} still={still} decorative={decorative} />
      </div>
    </div>
  );
});

export default RotatingEmblem;
