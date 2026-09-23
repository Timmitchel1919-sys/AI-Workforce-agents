import { useEffect, useRef, useState } from "react";
import { Check, CircleAlert, Infinity as InfinityIcon, LineChart, Loader, Server, ShieldCheck } from "lucide-react";
import { useAuth } from "../../auth/useAuth";
import { routeChunkLoaders, type RouteChunk } from "../../app/routeModules";
import { BackgroundField } from "../brand/BackgroundField";
import { LOGO_MARK_SRC } from "../brand/brand";
import { prefersReducedMotion } from "../brand/motion";
import {
  checkControlPlaneStatus,
  useInitialization,
  type InitStage,
} from "./initialization";
import { EarthHorizon } from "../brand/EmblemScenery";
import { RotatingEmblem } from "../brand/RotatingEmblem";
import "../../styles/os-theme.css";
import "./BrandedSplash.css";

/** One full Y-axis revolution. Must match `--emblem-spin` in the CSS. */
export const SPIN_MS = 10_000;
/** Branded intro length (owner requirement). Progress is paced over it but never runs ahead of real work. */
export const MIN_DISPLAY_MS = 15_000;
export const EXIT_MS = 800;

export interface BrandedSplashProps {
  /** Called once the exit transition has finished; the app then reveals the router. */
  onFinished: () => void;
  /** Applies the post-initialization redirect (e.g. `/` → Control Center for an authorized user). */
  navigate: (to: string) => void;
  pathname?: string;
  loadChunk?: (chunk: RouteChunk) => Promise<unknown>;
  checkControlPlane?: (token: string) => Promise<boolean>;
  minDisplayMs?: number;
  maxWaitMs?: number;
}

const CAPABILITIES = [
  { icon: InfinityIcon, title: "Multi-agent", subtitle: "Orchestration" },
  { icon: ShieldCheck, title: "Enterprise", subtitle: "Security" },
  { icon: Server, title: "Environment", subtitle: "Flexibility" },
  { icon: LineChart, title: "Real business", subtitle: "Impact" },
];

function StageIcon({ stage }: { stage: InitStage }) {
  if (stage.status === "done" || stage.status === "skipped") return <Check size={13} aria-hidden="true" />;
  if (stage.status === "failed" || stage.status === "degraded") return <CircleAlert size={13} aria-hidden="true" />;
  if (stage.status === "active") return <Loader size={13} aria-hidden="true" className="splash-spin-icon" />;
  return <span className="splash-stage__dot" aria-hidden="true" />;
}

/** Rotation angle of the emblem right now, from its running CSS animation. */
function currentSpinAngle(element: HTMLElement | null, mountedAt: number): number {
  const animation = element?.getAnimations?.()[0];
  const time = typeof animation?.currentTime === "number" ? animation.currentTime : performance.now() - mountedAt;
  return ((time % SPIN_MS) / SPIN_MS) * 360;
}

export function BrandedSplash({
  onFinished,
  navigate,
  pathname = typeof window !== "undefined" ? window.location.pathname : "/",
  loadChunk = (chunk) => routeChunkLoaders[chunk](),
  checkControlPlane = checkControlPlaneStatus,
  minDisplayMs = MIN_DISPLAY_MS,
  maxWaitMs,
}: BrandedSplashProps) {
  const auth = useAuth();
  const [reducedMotion] = useState(prefersReducedMotion);
  const [minElapsed, setMinElapsed] = useState(minDisplayMs <= 0);
  const [elapsedFraction, setElapsedFraction] = useState(minDisplayMs <= 0 ? 1 : 0);
  const [skipped, setSkipped] = useState(false);
  const mountedAt = useRef(0);
  const spinnerRef = useRef<HTMLDivElement | null>(null);
  const onFinishedRef = useRef(onFinished);
  const navigateRef = useRef(navigate);

  useEffect(() => {
    mountedAt.current = performance.now();
  }, []);

  useEffect(() => {
    onFinishedRef.current = onFinished;
    navigateRef.current = navigate;
  }, [onFinished, navigate]);

  const init = useInitialization({
    pathname,
    configured: auth.configured,
    authLoading: auth.loading,
    user: auth.user,
    access: auth.access,
    accessToken: auth.accessToken,
    loadChunk,
    checkControlPlane,
    maxWaitMs,
  });

  // Display duration, ticked so the progress bar can pace itself over it.
  useEffect(() => {
    if (minDisplayMs <= 0) return;
    // Development-only design QA: `?splash-hold` keeps the splash on screen.
    if (import.meta.env.DEV && new URLSearchParams(window.location.search).has("splash-hold")) return;
    const start = performance.now();
    const interval = window.setInterval(() => {
      const fraction = Math.min(1, (performance.now() - start) / minDisplayMs);
      setElapsedFraction(fraction);
      if (fraction >= 1) {
        setMinElapsed(true);
        window.clearInterval(interval);
      }
    }, 100);
    return () => window.clearInterval(interval);
  }, [minDisplayMs]);

  const finished = init.phase === "ready" || init.phase === "degraded";
  const exiting = finished && (minElapsed || skipped);
  // Paced over the intro, but never ahead of the real initialization stages.
  const progress = Math.min(init.progress, Math.round(elapsedFraction * 100));
  const message = finished && progress < 100 ? "Starting AI Workforce OS…" : init.message;

  // Exit: settle the emblem to its front face, then fade the splash away.
  useEffect(() => {
    if (!exiting) return;

    if (init.destination?.redirectTo) {
      navigateRef.current(init.destination.redirectTo);
    }

    const spinner = spinnerRef.current;
    if (spinner && !reducedMotion) {
      const angle = currentSpinAngle(spinner, mountedAt.current);
      spinner.style.animation = "none";
      spinner.style.transform = `rotateY(${angle}deg)`;
      // Force the frozen angle to apply before transitioning forward to the front (360°).
      void spinner.getBoundingClientRect();
      spinner.style.transition = `transform ${EXIT_MS - 100}ms cubic-bezier(0.2, 0.7, 0.2, 1)`;
      spinner.style.transform = "rotateY(360deg)";
    }

    const timer = window.setTimeout(() => onFinishedRef.current(), reducedMotion ? 200 : EXIT_MS);
    return () => window.clearTimeout(timer);
    // Runs once, when the splash starts leaving.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exiting]);

  const statusLabel =
    init.phase === "error"
      ? "Initialization failed"
      : init.phase === "degraded"
        ? "Limited connectivity"
        : finished
          ? "System ready"
          : "Initializing system";

  return (
    <div
      className={[
        "splash",
        "os-theme",
        exiting ? "is-exiting" : "",
        reducedMotion ? "is-reduced" : "",
        `is-${init.phase}`,
      ]
        .filter(Boolean)
        .join(" ")}
      role="dialog"
      aria-modal="true"
      aria-label="AI Workforce is starting"
      aria-busy={!finished}
    >
      <BackgroundField />
      <EarthHorizon />

      <header className="splash-top">
        <div className="splash-brand">
          <img src={LOGO_MARK_SRC} alt="" width={30} height={30} />
          <span className="splash-brand__name">AI Workforce</span>
          <span className="splash-brand__divider" aria-hidden="true" />
          <span className="splash-brand__tagline">
            Intelligence
            <br />
            at work
          </span>
        </div>
        <div className={`splash-status lp-glass is-${init.phase}`}>
          <span className="splash-status__dot" aria-hidden="true" />
          {statusLabel}
        </div>
      </header>

      <aside className="splash-side splash-side--left" aria-hidden="true">
        {["People", "Ideas", "AI agents", "Technology", "Real impact"].map((item) => (
          <span key={item}>{item}</span>
        ))}
      </aside>
      <aside className="splash-side splash-side--right" aria-hidden="true">
        <span className="splash-side__pair">
          Global intelligence
          <br />
          Local control
        </span>
        <span className="splash-side__quote">
          Autonomous engineering
          <br />
          for a better tomorrow
        </span>
      </aside>

      <main className="splash-center">
        <RotatingEmblem ref={spinnerRef} still={reducedMotion} className="splash-emblem" />

        <p className="splash-kicker">The next generation</p>
        <h1 className="splash-title">AI Workforce</h1>
        <p className="splash-tagline">Intelligence at work</p>
        <p className="splash-verbs" aria-label="Architect, build, test, secure, deploy">
          {["Architect", "Build", "Test", "Secure", "Deploy"].map((verb) => (
            <span key={verb}>{verb}</span>
          ))}
        </p>

        {init.phase === "error" ? (
          <div className="splash-error lp-glass" role="alert">
            <CircleAlert size={18} aria-hidden="true" />
            <div>
              <p className="splash-error__title">AI Workforce could not start</p>
              <p className="splash-error__text">
                Part of the interface failed to load. Check your connection and try again.
              </p>
            </div>
            <button type="button" className="lp-button lp-button--primary" onClick={() => window.location.reload()}>
              Retry
            </button>
          </div>
        ) : (
          <div className="splash-progress">
            <div
              className="splash-progress__track"
              role="progressbar"
              aria-label="Initialization progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress}
            >
              <span className="splash-progress__fill" style={{ width: `${progress}%` }} />
            </div>
            <div className="splash-progress__meta">
              <span className="splash-progress__message" aria-live="polite">
                {message}
              </span>
              <span className="splash-progress__value">{progress}%</span>
            </div>
            {finished && !exiting ? (
              <button type="button" className="splash-skip" onClick={() => setSkipped(true)}>
                Skip intro
              </button>
            ) : null}
          </div>
        )}
      </main>

      <section className="splash-modules lp-glass" aria-label="Loading modules">
        <p className="splash-modules__title">Loading modules</p>
        <ul>
          {init.stages.map((stage) => (
            <li key={stage.id} className={`splash-stage-row is-${stage.status}`}>
              <StageIcon stage={stage} />
              <span className="splash-stage-row__label">{stage.label}</span>
              <span className="splash-stage-row__detail">{stage.detail ?? (stage.status === "pending" ? "Waiting" : "")}</span>
            </li>
          ))}
        </ul>
      </section>

      <ul className="splash-capabilities" aria-label="Capabilities">
        {CAPABILITIES.map(({ icon: Icon, title, subtitle }) => (
          <li key={title}>
            <Icon size={18} aria-hidden="true" />
            <span>
              {title}
              <br />
              {subtitle}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default BrandedSplash;
