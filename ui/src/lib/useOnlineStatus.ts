import { useEffect, useState } from "react";

/**
 * Browser connectivity — `navigator.onLine` + the `online`/`offline` events.
 * This is NOT the same as "the Control Plane API is reachable" (see
 * `useApiStatus`); a device can be online while the API is down, and vice versa.
 */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  return online;
}
