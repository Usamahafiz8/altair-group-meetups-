import { defineConfig } from 'vitest/config';

// The API/access suites talk to the hosted project, so they run one file at a
// time against one shared database, with generous timeouts for the network.
export default defineConfig({
  test: {
    include: ['api/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
