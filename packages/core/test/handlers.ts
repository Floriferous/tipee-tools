// The fake Tipee. Happy-path handlers backed by the anonymised fixtures, which
// Enforce the real API's rules (bearer key, explicit pagination, identical
// Orders on every page, …) by answering 401/422 the way Tipee does — so tests
// Assert on behaviour instead of inspecting requests.

import { Result, Schema } from 'effect';
import { HttpResponse, http } from 'msw';
import type { JsonBodyType } from 'msw';

import { readFixture } from './fixtures.ts';
import type { FixtureName } from './fixtures.ts';

export const BASE = 'https://acme.tipee.net';
export const API_KEY = 'test-key';
/** Smaller than any real page so the tests exercise pagination. */
export const FAKE_PAGE_SIZE = 2;

const HTTP_UNAUTHORIZED = 401;
const HTTP_UNPROCESSABLE = 422;

const api = (path: string): string => `${BASE}${path}`;

// Fixtures are raw Tipee JSON and are answered untouched; these schemas only
// Pick what the fake needs to filter, sort and paginate.
const Row = Schema.Struct({ id: Schema.String });
const KindRow = Schema.Struct({ ...Row.fields, machine_name: Schema.String });
const TeamRow = Schema.Struct({ ...Row.fields, parent_id: Schema.NullOr(Schema.String) });
const TemplateRow = Schema.Struct({ ...Row.fields, team_id: Schema.String });
const PersonRow = Schema.Struct({
  ...Row.fields,
  attributes: Schema.Struct({ last_name: Schema.String }),
  teams: Schema.optionalKey(Schema.Array(Schema.Struct({ id: Schema.String }))),
});
const ByResource = Schema.Struct({ ...Row.fields, resource_id: Schema.String });
const OnCallRow = Schema.Struct({ ...ByResource.fields, team_id: Schema.String });
const AnyRow = Schema.Struct({});

interface Loaded<Row> {
  readonly raw: Schema.Json;
  readonly row: Row;
}

const load = <S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  name: FixtureName,
): ReadonlyArray<Loaded<S['Type']>> => {
  const raw = Schema.decodeUnknownSync(Schema.Array(Schema.Json))(readFixture(name));
  const rows = Schema.decodeUnknownSync(Schema.Array(schema))(raw);
  return rows.map((row, index) => ({ raw: raw[index] ?? null, row }));
};

const kinds = load(KindRow, 'kinds');
const teams = load(TeamRow, 'teams');
const templates = load(TemplateRow, 'templates');
const people = load(PersonRow, 'people');
const shifts = load(ByResource, 'shifts');
const absences = load(ByResource, 'absences');
const onCalls = load(OnCallRow, 'on-calls');
const activityRates = load(AnyRow, 'activity-rates');

const employeeKind = kinds.find((kind) => kind.row.machine_name === 'employee');
if (employeeKind === undefined) {
  throw new Error('fixture kinds.json has no "employee" kind');
}
export const EMPLOYEE_KIND_ID = employeeKind.row.id;

const DateRange = Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}\/\d{4}-\d{2}-\d{2}$/u));
const Ids = Schema.Array(Schema.String);
const TeamFilter = Schema.Struct({
  key: Schema.Literal('resource.team'),
  value: Schema.Struct({ recursive: Schema.Boolean, teams: Ids }),
});
const Order = Schema.Struct({
  attribute: Schema.Literal('last_name'),
  direction: Schema.Literals(['asc', 'desc']),
  key: Schema.Literal('resource.attribute'),
});
const Pagination = Schema.Struct({
  limit: Schema.NullOr(Schema.Int.check(Schema.isGreaterThan(0))),
  next_token: Schema.NullOr(Schema.String),
});

const ListResourcesQuery = Schema.Struct({
  filters: Schema.optionalKey(Schema.Array(TeamFilter)),
  kind_id: Schema.Literal(EMPLOYEE_KIND_ID),
  orders: Schema.NonEmptyArray(Order),
  pagination: Pagination,
  with_teams: Schema.optionalKey(Schema.Boolean),
});
const ListTemplatesQuery = Schema.Struct({ team_ids: Schema.optionalKey(Ids) });
const ListByDateQuery = Schema.Struct({
  date_range: DateRange,
  resource_ids: Schema.optionalKey(Ids),
});
const ListOnCallsQuery = Schema.Struct({
  ...ListByDateQuery.fields,
  team_ids: Schema.optionalKey(Ids),
});
const ShowActivityRatesQuery = Schema.Struct({
  date_range: Schema.optionalKey(DateRange),
  resource_id: Schema.String,
});

const unauthorized = (message: string): Response =>
  HttpResponse.json({ message }, { status: HTTP_UNAUTHORIZED });

const unprocessable = (details: unknown): Response =>
  HttpResponse.json({ details, message: 'Invalid request' }, { status: HTTP_UNPROCESSABLE });

const headersLikeTipee = (request: Request): Response | undefined => {
  if (request.headers.get('authorization') !== `Bearer ${API_KEY}`) {
    return unauthorized('Le jeton fourni est invalide.');
  }
  if (
    request.headers.get('tipee-version') === null ||
    request.headers.get('accept') !== 'application/json'
  ) {
    return unprocessable('Missing Tipee-Version or Accept header');
  }
  return undefined;
};

const rawOf = <Row>(items: ReadonlyArray<Loaded<Row>>): JsonBodyType =>
  items.map((item) => item.raw);

// Validates auth headers and the body like Tipee, then answers.
const endpoint = <S extends Schema.ConstraintDecoder<unknown>>(
  path: string,
  schema: S,
  answer: (query: S['Type']) => JsonBodyType | Response,
) =>
  http.post(api(path), async ({ request }) => {
    const rejection = headersLikeTipee(request);
    if (rejection !== undefined) {
      return rejection;
    }
    const query = Schema.decodeUnknownResult(schema)(await request.json());
    if (Result.isFailure(query)) {
      return unprocessable(query.failure.message);
    }
    const answered = answer(query.success);
    return answered instanceof Response ? answered : HttpResponse.json(answered);
  });

const descendants = (teamId: string): Set<string> => {
  const found = new Set([teamId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const { row: team } of teams) {
      if (team.parent_id !== null && found.has(team.parent_id) && !found.has(team.id)) {
        found.add(team.id);
        grew = true;
      }
    }
  }
  return found;
};

const teamIdsOf = (filters: ReadonlyArray<typeof TeamFilter.Type>): Set<string> => {
  const ids = new Set<string>();
  for (const filter of filters) {
    for (const teamId of filter.value.teams) {
      const expanded = filter.value.recursive ? descendants(teamId) : [teamId];
      for (const id of expanded) {
        ids.add(id);
      }
    }
  }
  return ids;
};

type PersonFixture = Loaded<typeof PersonRow.Type>;

const byLastName =
  (direction: 'asc' | 'desc') =>
  (left: PersonFixture, right: PersonFixture): number => {
    const sign = direction === 'asc' ? 1 : -1;
    return sign * left.row.attributes.last_name.localeCompare(right.row.attributes.last_name, 'fr');
  };

// A real cursor is opaque; this one is "<offset>:<signature>" so the fake can
// Refuse a page requested with different filters or orders, like Tipee does.
const cursor = (offset: number, signature: string): string => `${offset}:${signature}`;

const readCursor = (token: string | null, signature: string): number | undefined => {
  if (token === null) {
    return 0;
  }
  const separator = token.indexOf(':');
  if (token.slice(separator + 1) !== signature) {
    return undefined;
  }
  return Number(token.slice(0, separator));
};

const listResources = (query: typeof ListResourcesQuery.Type): JsonBodyType | Response => {
  const filters = query.filters ?? [];
  const signature = JSON.stringify([filters, query.orders]);
  const offset = readCursor(query.pagination.next_token, signature);
  if (offset === undefined) {
    return unprocessable('filters or orders changed between pages');
  }
  const teamIds = teamIdsOf(filters);
  const [order] = query.orders;
  const matching = people
    .filter(
      ({ row }) => teamIds.size === 0 || (row.teams ?? []).some((team) => teamIds.has(team.id)),
    )
    .toSorted(byLastName(order.direction));
  const pageSize = Math.min(query.pagination.limit ?? matching.length, FAKE_PAGE_SIZE);
  // Tipee hands out a cursor even when the last page was exactly full.
  const nextOffset = offset + pageSize;
  return {
    data: rawOf(matching.slice(offset, nextOffset)),
    next_token: nextOffset <= matching.length ? cursor(nextOffset, signature) : null,
  };
};

const forPeople = <Row extends { readonly resource_id: string }>(
  items: ReadonlyArray<Loaded<Row>>,
  resourceIds: ReadonlyArray<string> | undefined,
): ReadonlyArray<Loaded<Row>> =>
  resourceIds === undefined
    ? items
    : items.filter((item) => resourceIds.includes(item.row.resource_id));

export const handlers = [
  endpoint('/api/directory/kinds.list', Schema.Struct({}), () => rawOf(kinds)),
  endpoint('/api/directory/teams.list', Schema.Struct({}), () => rawOf(teams)),
  endpoint('/api/schedule/schedule-templates.list', ListTemplatesQuery, ({ team_ids }) =>
    rawOf(
      team_ids === undefined
        ? templates
        : templates.filter((template) => team_ids.includes(template.row.team_id)),
    ),
  ),
  endpoint('/api/directory/resources.list', ListResourcesQuery, listResources),
  endpoint('/api/schedule/schedules.list', ListByDateQuery, ({ resource_ids }) =>
    rawOf(forPeople(shifts, resource_ids)),
  ),
  endpoint('/api/schedule/absences.list', ListByDateQuery, ({ resource_ids }) =>
    rawOf(forPeople(absences, resource_ids)),
  ),
  endpoint('/api/schedule/on-calls.list', ListOnCallsQuery, ({ resource_ids, team_ids }) =>
    rawOf(
      forPeople(onCalls, resource_ids).filter(
        (duty) => team_ids === undefined || team_ids.includes(duty.row.team_id),
      ),
    ),
  ),
  endpoint('/api/directory/resources.show-activity-rates', ShowActivityRatesQuery, (query) =>
    rawOf(people.some((person) => person.row.id === query.resource_id) ? activityRates : []),
  ),
];
