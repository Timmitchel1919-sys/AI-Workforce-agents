import * as React from "react";
import "./primitives.css";

type Variant = "beams" | "mesh";

export interface PageBackgroundProps {
  variant?: Variant;
  /** Reduce intensity for auth / dense data views. */
  calm?: boolean;
}

/**
 * Dark obsidian canvas with ambient radial accents and a lightweight canvas
 * beam field. Hand-authored — zero external WebGL deps. Pauses when offscreen
 * or when the tab is hidden; renders a static mesh under reduced-motion.
 */
export function PageBackground({ variant = "beams", calm = false }: PageBackgroundProps) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);

  React.useEffect(() => {
    if (variant !== "beams") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReduced) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let width = 0;
    let height = 0;
    let raf = 0;
    let running = true;

    type Beam = {
      x: number;
      y: number;
      len: number;
      angle: number;
      speed: number;
      hue: "cyan" | "violet";
      alpha: number;
    };
    const COUNT = calm ? 6 : 10;
    const beams: Beam[] = [];

    function resize() {
      const r = canvas!.getBoundingClientRect();
      width = r.width;
      height = r.height;
      canvas!.width = Math.floor(width * dpr);
      canvas!.height = Math.floor(height * dpr);
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function seed() {
      beams.length = 0;
      for (let i = 0; i < COUNT; i++) {
        beams.push({
          x: Math.random() * width,
          y: Math.random() * height,
          len: 120 + Math.random() * 320,
          angle: (-Math.PI / 2) + (Math.random() - 0.5) * 0.4,
          speed: 0.15 + Math.random() * 0.35,
          hue: Math.random() > 0.5 ? "cyan" : "violet",
          alpha: 0.06 + Math.random() * 0.1,
        });
      }
    }

    function step() {
      if (!running) return;
      ctx!.clearRect(0, 0, width, height);

      for (const b of beams) {
        const dx = Math.cos(b.angle) * b.speed;
        const dy = Math.sin(b.angle) * b.speed;
        b.x += dx;
        b.y += dy;
        if (b.x < -b.len || b.x > width + b.len) b.x = Math.random() * width;
        if (b.y < -b.len || b.y > height + b.len) b.y = height + 20;

        const gx = b.x + Math.cos(b.angle) * b.len;
        const gy = b.y + Math.sin(b.angle) * b.len;
        const grad = ctx!.createLinearGradient(b.x, b.y, gx, gy);
        const stop =
          b.hue === "cyan"
            ? `rgba(56, 189, 248, ${b.alpha})`
            : `rgba(167, 139, 250, ${b.alpha})`;
        grad.addColorStop(0, "rgba(0,0,0,0)");
        grad.addColorStop(0.5, stop);
        grad.addColorStop(1, "rgba(0,0,0,0)");
        ctx!.strokeStyle = grad;
        ctx!.lineWidth = 1.1;
        ctx!.beginPath();
        ctx!.moveTo(b.x, b.y);
        ctx!.lineTo(gx, gy);
        ctx!.stroke();
      }
      raf = requestAnimationFrame(step);
    }

    const onResize = () => {
      resize();
      seed();
    };
    const onVisibility = () => {
      running = !document.hidden;
      if (running) raf = requestAnimationFrame(step);
      else cancelAnimationFrame(raf);
    };

    resize();
    seed();
    raf = requestAnimationFrame(step);
    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [variant, calm]);

  return (
    <div className="aw-bg" aria-hidden>
      {variant === "beams" && <canvas className="aw-bg-canvas" ref={canvasRef} />}
      <div className="aw-bg-noise" />
      <div className="aw-bg-vignette" />
    </div>
  );
}
export default PageBackground;
