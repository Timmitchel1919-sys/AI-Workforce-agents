/**
 * Route-level code splitting. Each loader is the single import site for its
 * chunk, so the splash can preload exactly what the router will render next
 * (Vite dedupes the promise; the later lazy render is instant).
 */
export const loadLanding = () => import("../pages/Landing/LandingPage");
export const loadAuthRoutes = () => import("./routes/authRoutes");
export const loadControlCenterRoutes = () => import("./routes/controlCenterRoutes");

export type RouteChunk = "landing" | "auth" | "controlCenter";

export const routeChunkLoaders: Record<RouteChunk, () => Promise<unknown>> = {
  landing: loadLanding,
  auth: loadAuthRoutes,
  controlCenter: loadControlCenterRoutes,
};
