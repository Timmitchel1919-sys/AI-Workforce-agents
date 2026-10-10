/**
 * Route-level code splitting. Each loader is the single import site for its
 * chunk, so the splash can preload exactly what the router will render next
 * (Vite dedupes the promise; the later lazy render is instant).
 */
export const loadLanding = () => import("../pages/Landing/LandingPage");
export const loadAuthRoutes = () => import("./routes/authRoutes");
export const loadControlCenterRoutes = () => import("./routes/controlCenterRoutes");

/** Project onboarding wizard (separate lazy chunk; routes are added in router.tsx). */
export const loadProjectOnboarding = () => import("../pages/ProjectOnboarding/routes");

/** Prompt Intelligence (Phase 3) page (separate lazy chunk). */
export const loadPromptIntelligence = () => import("../pages/PromptIntelligence/routes");

/** Execution Center (Layer 4) page (separate lazy chunk). */
export const loadExecutionCenter = () => import("../pages/ExecutionCenter/routes");

export type RouteChunk = "landing" | "auth" | "controlCenter";

export const routeChunkLoaders: Record<RouteChunk, () => Promise<unknown>> = {
  landing: loadLanding,
  auth: loadAuthRoutes,
  controlCenter: loadControlCenterRoutes,
};
