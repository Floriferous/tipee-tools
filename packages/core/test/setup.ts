// Runs before every test file: the fake Tipee answers all requests, and any
// Request it does not know about fails the test instead of hitting the network.

import { afterAll, afterEach, beforeAll } from 'vitest';

import { server } from './server.ts';

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});
