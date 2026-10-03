import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The core's fake Tipee lifecycle: unknown requests fail the test.
    setupFiles: ['@tipee-tools/core/testing/setup'],
  },
});
