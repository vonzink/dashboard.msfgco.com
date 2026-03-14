import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/**/*.test.js'],
    testTimeout: 10000,
    // Separate unit tests from integration tests
    // Run: npm test (unit only), npm run test:integration (needs DB)
    exclude: ['tests/integration/**'],
  },
});
