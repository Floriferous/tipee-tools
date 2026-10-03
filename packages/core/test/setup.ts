// Runs before every test file (here, and in packages that import it as
// `@tipee-tools/core/testing/setup`): the fake Tipee answers all requests, and
// Any request it does not know about fails the test instead of hitting the
// Network. Overrides from `server.use` last one test.

import { afterAll, afterEach, beforeAll } from 'vitest';

import { server } from './server.ts';

beforeAll(() => {
  server.listen({ onUnhandledFrame: 'error' });
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});
