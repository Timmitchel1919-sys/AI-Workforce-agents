import * as React from "react";
import "./internal-background.css";

/**
 * Internal operational background. Faint cyan/violet sonar grid with occasional
 * slow radial sweeps. Fixed-viewport canvas (never allocates full document
 * height). Pauses when the tab is hidden or `prefers-reduced-motion` is set.
 *
 * Must be placed inside an element with `.aw-bg-host` (positions behind
 * siblings via the primitives.css stacking contract).
 */
export function InternalSonarBackground({ intensity = "default" }: { intensity?: "default" | "calm" }) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);

  React.useEffect(() => {
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
    let t = 0;

    type Pulse = { x: number; y: number; r: number; max: number; hue: "cyan" | "violet"; alpha: number };
    const pulses: Pulse[] = [];
    const maxPulses = intensity === "calm" ? 2 : 3;
    let nextSpawn = 0;

    function resize() {
      const r = canvas!.getBoundingClientRect();
      width = r.width;
      height = r.height;
      canvas!.width = Math.floor(width * dpr);
      canvas!.height = Math.floor(height * dpr);
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function spawn() {
      if (pulses.length >= maxPulses) return;
      pulses.push({
        x: Math.random() * width,
        y: Math.random() * height,
        r: 0,
        max: 180 + Math.random() * 140,
        hue: Math.random() > 0.5 ? "cyan" : "violet",
        alpha: 0.14 + Math.random() * 0.08,
      });
    }

    function step() {
      if (!running) return;
      t += 1;
      if (t > nextSpawn) {
        spawn();
        nextSpawn = t + (intensity === "calm" ? 300 : 180) + Math.floor(Math.random() * 200);
      }
      ctx!.clearRect(0, 0, width, height);

      for (let i = pulses.length - 1; i >= 0; i--) {
        const p = pulses[i];
        p.r += 0.9;
        const prog = p.r / p.max;
        if (prog >= 1) { pulses.splice(i, 1); continue; }
        const a = p.alpha * (1 - prog);
        const stroke =
          p.hue === "cyan"
            ? `rgba(56, 189, 248, ${a})`
            : `rgba(167, 139, 250, ${a})`;
        ctx!.beginPath();
        ctx!.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx!.strokeStyle = stroke;
        ctx!.lineWidth = 1;
        ctx!.stroke();
      }

      raf = requestAnimationFrame(step);
    }

    const onResize = () => resize();
    const onVisibility = () => {
      running = !document.hidden;
      if (running) raf = requestAnimationFrame(step);
      else cancelAnimationFrame(raf);
    };

    resize();
    raf = requestAnimationFrame(step);
    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [intensity]);

  return (
    <div className="aw-sonar" aria-hidden>
      <div className="aw-sonar-grid" />
      <canvas className="aw-sonar-canvas" ref={canvasRef} />
      <div className="aw-sonar-vignette" />
    </div>
  );
}
export default InternalSonarBackground;
