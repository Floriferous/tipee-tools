// Anonymised real tipee responses (names, ids and remarks replaced; shapes
// untouched), except day-tasks.json, written from the document's schema.
// They are the fake tipee's database and the schemas' test data.

import { directory } from './fixtures/directory.ts';
import { schedule } from './fixtures/schedule.ts';

// The fixtures as TypeScript reads them, so the fake's tables are typed
// values the compiler checks against the shapes the fake relies on.
export const fixtures = { ...directory, ...schedule };

export type FixtureName = keyof typeof fixtures;

// A fresh copy each time, so a test may change what it reads.
export const readFixture = (name: FixtureName): unknown => structuredClone(fixtures[name]);
