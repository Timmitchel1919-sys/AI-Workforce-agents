import { RouterProvider } from "react-router-dom";
import ErrorBoundary from "./ErrorBoundary";
import { router } from "./router";

export default function App() {
  return (
    <ErrorBoundary>
      <div className="app-root">
        <RouterProvider router={router} />
      </div>
    </ErrorBoundary>
  );
}
