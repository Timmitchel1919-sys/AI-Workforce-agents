import { useCallback, useEffect, useState, type RefObject } from "react";

/** Browser Fullscreen API, feature-detected. Never throws; `error` reports a refused request. */
export function useFullscreen(targetRef: RefObject<HTMLElement | null>) {
  const supported =
    typeof document !== "undefined" &&
    document.fullscreenEnabled === true &&
    typeof HTMLElement !== "undefined" &&
    typeof HTMLElement.prototype.requestFullscreen === "function";
  const [active, setActive] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!supported) return;
    const onChange = () => setActive(document.fullscreenElement !== null && document.fullscreenElement !== undefined);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [supported]);

  const toggle = useCallback(async () => {
    if (!supported) return;
    setError(false);
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await targetRef.current?.requestFullscreen();
    } catch {
      setError(true);
    }
  }, [supported, targetRef]);

  return { supported, active, error, toggle };
}
