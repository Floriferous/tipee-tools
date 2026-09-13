// Test kit for packages built on the core: the fake Tipee (MSW handlers that
// Enforce the real API's rules over anonymised fixtures) and its server.

export {
  API_KEY,
  BASE,
  EMPLOYEE_KIND_ID,
  FAKE_PAGE_SIZE,
  INTEGRATION_ID,
  handlers,
} from './handlers.ts';
export { readFixture } from './fixtures.ts';
export { server } from './server.ts';
