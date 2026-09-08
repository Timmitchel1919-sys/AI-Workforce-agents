/**
 * Router entry. `AppRoutes` holds the declarative `<Routes>` tree so it can be
 * mounted under `<BrowserRouter>` (app) or `<MemoryRouter>` (tests). This module
 * re-exports it plus the route configuration for convenience.
 */
export { AppRoutes } from "./AppRoutes";
export {
  NAV_ROUTES,
  DETAIL_ROUTES,
  DEFAULT_ROUTE,
  LOGIN_ROUTE,
} from "./routes";
