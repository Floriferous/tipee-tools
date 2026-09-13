// Runs before every test file: the fake Tipee from @tipee-tools/core answers
// All requests; anything it does not know about fails the test.

import { afterAll, afterEach, beforeAll } from 'vitest';
import { server } from '@tipee-tools/core/testing';

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});
