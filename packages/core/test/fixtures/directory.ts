// The directory's fixtures: kinds, people, the integration, teams and rates.

import activityRates from './activity-rates.json' with { type: 'json' };
import integrations from './integrations.json' with { type: 'json' };
import kindEmployee from './kind-employee.json' with { type: 'json' };
import kinds from './kinds.json' with { type: 'json' };
import people from './people.json' with { type: 'json' };
import teams from './teams.json' with { type: 'json' };

export const directory = {
  'activity-rates': activityRates,
  integrations,
  'kind-employee': kindEmployee,
  kinds,
  people,
  teams,
};
