import '@testing-library/jest-dom';
import { configure } from '@testing-library/react';

// findBy*/waitFor default to 1s; heavy page renders under CPU contention need more headroom.
configure({ asyncUtilTimeout: 5000 });

// Respect reduced-motion preference in tests by default
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }),
});

class TestIntersectionObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = '0px';
  readonly thresholds = [0];
  disconnect() {}
  observe(target: Element) {
    this.callback([{ isIntersecting: true, target } as IntersectionObserverEntry], this);
  }
  unobserve() {}
  takeRecords(): IntersectionObserverEntry[] { return []; }
  constructor(private readonly callback: IntersectionObserverCallback) {}
}

Object.defineProperty(globalThis, 'IntersectionObserver', {
  writable: true,
  value: TestIntersectionObserver,
});
