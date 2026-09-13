// Anonymised real Tipee responses (names, ids and remarks replaced; shapes
// Untouched). They are the fake Tipee's database and the schemas' test data.

import absences from './fixtures/absences.json' with { type: 'json' };
import activityRates from './fixtures/activity-rates.json' with { type: 'json' };
import integrations from './fixtures/integrations.json' with { type: 'json' };
import kinds from './fixtures/kinds.json' with { type: 'json' };
import onCalls from './fixtures/on-calls.json' with { type: 'json' };
import people from './fixtures/people.json' with { type: 'json' };
import shifts from './fixtures/shifts.json' with { type: 'json' };
import teams from './fixtures/teams.json' with { type: 'json' };
import templates from './fixtures/templates.json' with { type: 'json' };

const FIXTURES: Record<string, unknown> = {
  absences,
  'activity-rates': activityRates,
  integrations,
  kinds,
  'on-calls': onCalls,
  people,
  shifts,
  teams,
  templates,
};

export type FixtureName =
  | 'absences'
  | 'activity-rates'
  | 'integrations'
  | 'kinds'
  | 'on-calls'
  | 'people'
  | 'shifts'
  | 'teams'
  | 'templates';

export const readFixture = (name: FixtureName): unknown => FIXTURES[name];
