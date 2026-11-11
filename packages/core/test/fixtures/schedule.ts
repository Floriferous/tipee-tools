// The schedule's fixtures: shifts, absences, on-calls, templates and day tasks.

import absences from './absences.json' with { type: 'json' };
import dayTasks from './day-tasks.json' with { type: 'json' };
import onCalls from './on-calls.json' with { type: 'json' };
import shifts from './shifts.json' with { type: 'json' };
import templates from './templates.json' with { type: 'json' };

export const schedule = {
  absences,
  'day-tasks': dayTasks,
  'on-calls': onCalls,
  shifts,
  templates,
};
