// What the fake tipee accepts as request bodies: anything else gets the 422
// tipee answers.

import { Schema } from 'effect';

import { EMPLOYEE_KIND_ID, INTEGRATION_KIND_ID } from './tables.ts';

// Either end may be open: `2026-08-01/-`, `-/2018-12-31`.
const DateRange = Schema.String.check(
  Schema.isPattern(/^(?:\d{4}-\d{2}-\d{2}|-)\/(?:\d{4}-\d{2}-\d{2}|-)$/u),
);
const Ids = Schema.Array(Schema.String);
export const TeamFilter = Schema.Struct({
  key: Schema.Literal('resource.team'),
  value: Schema.Struct({ recursive: Schema.Boolean, teams: Ids }),
});
const SortOrder = Schema.Struct({
  attribute: Schema.Literal('last_name'),
  direction: Schema.Literals(['asc', 'desc']),
  key: Schema.Literal('resource.attribute'),
});
const Pagination = Schema.Struct({
  limit: Schema.NullOr(Schema.Int.check(Schema.isGreaterThan(0))),
  next_token: Schema.NullOr(Schema.String),
});

export const ListResourcesQuery = Schema.Struct({
  filters: Schema.optionalKey(Schema.Array(TeamFilter)),
  kind_id: Schema.Literals([EMPLOYEE_KIND_ID, INTEGRATION_KIND_ID]),
  orders: Schema.NonEmptyArray(SortOrder),
  pagination: Pagination,
  with_teams: Schema.optionalKey(Schema.Boolean),
});
export const ListTemplatesQuery = Schema.Struct({ team_ids: Schema.optionalKey(Ids) });
export const ListByDateQuery = Schema.Struct({
  date_range: DateRange,
  resource_ids: Schema.optionalKey(Ids),
});
export const ListOnCallsQuery = Schema.Struct({
  ...ListByDateQuery.fields,
  team_ids: Schema.optionalKey(Ids),
});
export const ListDayTasksQuery = Schema.Struct({
  date_range: DateRange,
  is_own: Schema.Boolean,
  resource_ids: Ids,
  task_ids: Schema.optionalKey(Schema.NullOr(Ids)),
});
export const ShowActivityRatesQuery = Schema.Struct({
  date_range: Schema.optionalKey(DateRange),
  resource_id: Schema.String,
});

export const ShowQuery = Schema.Struct({ id: Schema.String });
export const DeleteQuery = Schema.Struct({
  ids: Schema.Array(Schema.String),
  options: Schema.Struct({ group_action: Schema.Literals(['single', 'future', 'all']) }),
});
const TimecheckFilter = Schema.Struct({ key: Schema.String, value: Schema.Unknown });
export const ListTimechecksQuery = Schema.Struct({
  filters: Schema.optionalKey(Schema.Array(TimecheckFilter)),
});
