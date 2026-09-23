import { useEffect, useRef, useState } from "react";
import type { AccessState, AuthUser } from "../../auth/auth.types";
import type { RouteChunk } from "../../app/routeModules";
import { CONTROL_CENTER_ROUTE } from "../brand/brand";
import type { MessageKey } from "../../i18n";

/**
 * The splash observes real start-up work; it owns none of it. Each stage maps
 * to something the app genuinely does before the first screen is usable.
 */
export type StageId = "application" | "session" | "modules" | "controlPlane";
export type StageStatus = "pending" | "active" | "done" | "skipped" | "degraded" | "failed";

export interface InitStage {
  id: StageId;
  status: StageStatus;
  /** Message key; the stage label itself is `splash.stages.<id>`. */
  detail?: MessageKey;
}

export type InitPhase = "booting" | "ready" | "degraded" | "error";

export interface Destination {
  /** Where the router should be once the splash leaves (null = stay on the current URL). */
  redirectTo: string | null;
  chunk: RouteChunk;
}

interface DestinationInput {
  pathname: string;
  configured: boolean;
  user: AuthUser | null;
  access: AccessState;
}

/**
 * Mirrors the existing routing rules: `/` is the public landing page (an
 * authorized user goes straight to the Control Center), `/login` and
 * `/signup` are the gateway, and everything else is guarded by RequireAuth.
 */
export function resolveDestination({ pathname, configured, user, access }: DestinationInput): Destination {
  const authorized = Boolean(user) && access === "granted";

  if (pathname === "/") {
    return authorized
      ? { redirectTo: CONTROL_CENTER_ROUTE, chunk: "controlCenter" }
      : { redirectTo: null, chunk: "landing" };
  }
  if (pathname.startsWith("/login") || pathname.startsWith("/signup")) {
    // Authorized users are forwarded by the gateway itself.
    return { redirectTo: null, chunk: authorized ? "controlCenter" : "auth" };
  }
  if (configured && !authorized) {
    // RequireAuth will send the browser to the gateway.
    return { redirectTo: null, chunk: "auth" };
  }
  return { redirectTo: null, chunk: "controlCenter" };
}

export interface InitializationDeps {
  pathname: string;
  configured: boolean;
  authLoading: boolean;
  user: AuthUser | null;
  access: AccessState;
  accessToken: string | null;
  loadChunk: (chunk: RouteChunk) => Promise<unknown>;
  /** Resolves true when the Control Plane answers; false/throws → degraded. */
  checkControlPlane: (token: string) => Promise<boolean>;
  /** Hard ceiling so a hung dependency can never trap the user on the splash. */
  maxWaitMs?: number;
}

const INITIAL_STAGES: InitStage[] = [
  { id: "application", status: "done", detail: "splash.details.interfaceLoaded" },
  { id: "session", status: "active" },
  { id: "modules", status: "pending" },
  { id: "controlPlane", status: "pending" },
];

export interface InitializationState {
  stages: InitStage[];
  phase: InitPhase;
  progress: number;
  destination: Destination | null;
  message: MessageKey;
}

const SETTLED: StageStatus[] = ["done", "skipped", "degraded", "failed"];

export function useInitialization(deps: InitializationDeps): InitializationState {
  const [stages, setStages] = useState<InitStage[]>(INITIAL_STAGES);
  const [destination, setDestination] = useState<Destination | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const depsRef = useRef(deps);

  // Keep the latest inputs available to the async run without restarting it.
  useEffect(() => {
    depsRef.current = deps;
  });

  const update = (id: StageId, status: StageStatus, detail?: MessageKey) =>
    setStages((current) => current.map((stage) => (stage.id === id ? { ...stage, status, detail } : stage)));

  // Hard ceiling.
  useEffect(() => {
    const timer = window.setTimeout(() => setTimedOut(true), deps.maxWaitMs ?? 15_000);
    return () => window.clearTimeout(timer);
  }, [deps.maxWaitMs]);

  // Session → modules → Control Plane, once the auth state has resolved.
  useEffect(() => {
    // Runs once auth resolves. Every step is idempotent, so a cancelled run
    // (e.g. StrictMode's double effect) is simply replaced by the next one.
    if (deps.authLoading) return;
    let cancelled = false;

    const run = async () => {
      const current = depsRef.current;
      if (cancelled) return;
      update(
        "session",
        current.configured ? "done" : "skipped",
        current.configured
          ? current.user
            ? "splash.details.signedIn"
            : "splash.details.noSession"
          : "splash.details.notConfigured",
      );

      const dest = resolveDestination(current);
      setDestination(dest);

      update("modules", "active");
      try {
        await current.loadChunk(dest.chunk);
        if (cancelled) return;
        update("modules", "done", "splash.details.ready");
      } catch {
        if (cancelled) return;
        update("modules", "failed", "splash.details.loadFailed");
        return;
      }

      const authorized = current.configured && current.user && current.access === "granted" && current.accessToken;
      if (!authorized) {
        update("controlPlane", "skipped", "splash.details.afterSignIn");
        return;
      }
      update("controlPlane", "active");
      try {
        const ok = await current.checkControlPlane(current.accessToken as string);
        if (cancelled) return;
        update("controlPlane", ok ? "done" : "degraded", ok ? "splash.details.connected" : "splash.details.unavailable");
      } catch {
        if (!cancelled) update("controlPlane", "degraded", "splash.details.unreachable");
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [deps.authLoading]);

  const settled = stages.filter((stage) => SETTLED.includes(stage.status)).length;
  const failed = stages.some((stage) => stage.status === "failed");
  const degraded = stages.some((stage) => stage.status === "degraded");
  const complete = settled === stages.length;

  let phase: InitPhase = "booting";
  if (failed) phase = "error";
  else if (complete) phase = degraded ? "degraded" : "ready";
  else if (timedOut) phase = destination ? "degraded" : "error";

  const progress = phase === "ready" || phase === "degraded" ? 100 : Math.round((settled / stages.length) * 100);
  const active = stages.find((stage) => stage.status === "active");

  const ACTIVE_MESSAGES: Record<StageId, MessageKey> = {
    application: "splash.messages.initializing",
    session: "splash.messages.session",
    modules: "splash.messages.modules",
    controlPlane: "splash.messages.controlPlane",
  };
  const message: MessageKey =
    phase === "error"
      ? "splash.messages.error"
      : phase === "degraded"
        ? "splash.messages.degraded"
        : phase === "ready"
          ? "splash.messages.ready"
          : active
            ? ACTIVE_MESSAGES[active.id]
            : "splash.messages.initializing";

  return { stages, phase, progress, destination, message };
}

/** Read-only reachability probe of the Control Plane (`GET /api/status`). */
export async function checkControlPlaneStatus(token: string, timeoutMs = 5_000): Promise<boolean> {
  const base = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "") ?? "";
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${base}/api/status`, {
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    return response.ok;
  } finally {
    window.clearTimeout(timer);
  }
}
