// Anonymised real Tipee responses (names, ids and remarks replaced; shapes
// Untouched), except day-tasks.json, written from the document's schema.
// They are the fake Tipee's database and the schemas' test data.

import { readFileSync } from 'node:fs';

export type FixtureName =
  | 'absences'
  | 'activity-rates'
  | 'day-tasks'
  | 'integrations'
  | 'kind-employee'
  | 'kinds'
  | 'on-calls'
  | 'people'
  | 'shifts'
  | 'teams'
  | 'templates';

export const readFixture = (name: FixtureName): unknown =>
  JSON.parse(readFileSync(new URL(`fixtures/${name}.json`, import.meta.url), 'utf8'));
