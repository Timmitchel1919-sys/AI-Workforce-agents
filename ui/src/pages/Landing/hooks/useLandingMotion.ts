import { useEffect, useRef, useState, type RefObject } from "react";

import { prefersReducedMotion } from "../../../components/brand/motion";

export { prefersReducedMotion };

/**
 * Reveals an element once it enters the viewport. With reduced motion (or no
 * IntersectionObserver) the element is revealed immediately.
 */
export function useReveal<T extends HTMLElement>(): [RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null);
  const [revealed, setRevealed] = useState(
    () => prefersReducedMotion() || typeof IntersectionObserver === "undefined",
  );

  useEffect(() => {
    const element = ref.current;
    if (revealed || !element) return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setRevealed(true);
          observer.disconnect();
        }
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.12 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [revealed]);

  return [ref, revealed];
}

/**
 * Writes the hero scroll progress (0 → 1 over one viewport height) to the
 * root `--lp-hero-progress` custom property, so both the hero and the fixed
 * background can use it (upward drift, depth shift, logo-glow falloff).
 */
export function useHeroScrollProgress() {
  useEffect(() => {
    const element = document.documentElement;
    if (prefersReducedMotion()) return undefined;

    let frame = 0;
    const update = () => {
      frame = 0;
      const progress = Math.min(1, Math.max(0, window.scrollY / window.innerHeight));
      element.style.setProperty("--lp-hero-progress", progress.toFixed(3));
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
      element.style.removeProperty("--lp-hero-progress");
    };
  }, []);
}
