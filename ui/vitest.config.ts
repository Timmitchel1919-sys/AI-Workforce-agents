import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
    // First renders of the full landing/auth pages (3D emblem + scenery) are heavy in jsdom;
    // under CPU contention they can exceed 10s even though the assertions are fast.
    testTimeout: 20000,
  },
});
