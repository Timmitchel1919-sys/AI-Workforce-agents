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
