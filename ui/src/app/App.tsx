import { useState } from "react";
import { RouterProvider } from "react-router-dom";
import ErrorBoundary from "./ErrorBoundary";
import { router } from "./router";

// Imported eagerly: it is the very first thing painted on a cold start.
import BrandedSplash from "../components/splash/BrandedSplash";

export default function App() {
  const [splashDone, setSplashDone] = useState(false);
  const splashInertProps = splashDone ? {} : { inert: "" };

  return (
    <ErrorBoundary>
      <>
        {/* The router starts rendering underneath; it stays inert until the splash leaves. */}
        <div className="app-root" {...splashInertProps}>
          <RouterProvider router={router} />
        </div>
        {splashDone ? null : (
          <BrandedSplash
            onFinished={() => setSplashDone(true)}
            navigate={(to) => void router.navigate(to, { replace: true })}
          />
        )}
      </>
    </ErrorBoundary>
  );
}
