import { RouterProvider } from "react-router-dom";
import ErrorBoundary from "./ErrorBoundary";
import { router } from "./router";
import { AnimatedShaderBackground } from "../components/ui/AnimatedShaderBackground";

export default function App() {
  return (
    <ErrorBoundary>
      <AnimatedShaderBackground />
      <div className="app-root">
        <RouterProvider router={router} />
      </div>
    </ErrorBoundary>
  );
}
