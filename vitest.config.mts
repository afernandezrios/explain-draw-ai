import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      /**
       * Next ships no `exports` map, so `next/server` only resolves because a
       * bundler adds `.js`. Spelling it out keeps the route tests loading the
       * real module instead of depending on the resolver's defaults.
       */
      'next/server': 'next/server.js',
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Rendering is the slow part and the box has 7.6 GiB of RAM, so the suite
    // runs one file at a time and gives render-heavy tests room to breathe.
    fileParallelism: false,
    testTimeout: 600_000,
    hookTimeout: 300_000,
  },
});
