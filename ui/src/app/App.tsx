import { RouterProvider } from "react-router-dom";
import ErrorBoundary from "./ErrorBoundary";
import { router } from "./router";
import { AppUpdatePrompt } from "../components/pwa/AppUpdatePrompt";

export default function App() {
  return (
    <ErrorBoundary>
      <div className="app-root">
        <RouterProvider router={router} />
        <AppUpdatePrompt />
      </div>
    </ErrorBoundary>
  );
}
