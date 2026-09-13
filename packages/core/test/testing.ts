// Test kit for packages built on the core: the fake Tipee (MSW handlers that
// Enforce the real API's rules over anonymised fixtures) and its server.

export { API_KEY, BASE, FAKE_PAGE_SIZE, handlers } from './handlers.ts';
export { readFixture } from './fixtures.ts';
export { EMPLOYEE_KIND_ID, INTEGRATION_ID } from './tables.ts';
export { server } from './server.ts';
