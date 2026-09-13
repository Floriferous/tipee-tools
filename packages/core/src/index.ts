// Public surface of @tipee-tools/core: the HTTP client, the validated
// Read-only endpoints, and the schemas describing what Tipee really sends.

export { TIPEE_API_VERSION, TipeeError, tipeePost } from './client.ts';
export type { TipeeConfig } from './client.ts';
export {
  PAGE_SIZE,
  TipeeShapeError,
  listAbsences,
  listKinds,
  listOnCalls,
  listPeople,
  listShifts,
  listTeams,
  listTemplates,
  showActivityRates,
} from './endpoints.ts';
export type { PeopleFilter, TeamFilter } from './endpoints.ts';
export * from './schemas.ts';
