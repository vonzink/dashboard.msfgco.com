import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/integration/webinar*.integration.test.js'],
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
