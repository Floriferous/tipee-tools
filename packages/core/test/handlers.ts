// The fake Tipee. Happy-path handlers backed by the anonymised fixtures, which
// Enforce the real API's rules (bearer key, explicit pagination, identical
// Orders on every page, …) by answering 401/422 the way Tipee does — so tests
// Assert on behaviour instead of inspecting requests.

import { HttpResponse, http } from 'msw';
import type { JsonBodyType } from 'msw';
import { readFixture } from './fixtures.ts';
import { z } from 'zod';

export const BASE = 'https://acme.tipee.net';
export const API_KEY = 'test-key';
/** Smaller than any real page so the tests exercise pagination. */
export const FAKE_PAGE_SIZE = 2;

const HTTP_UNAUTHORIZED = 401;
const HTTP_UNPROCESSABLE = 422;

const api = (path: string): string => `${BASE}${path}`;

// Fixtures are raw Tipee JSON; these schemas only pick what the fake needs.
const Row = z.looseObject({ id: z.string() });
const KindRow = Row.extend({ machine_name: z.string() });
const TeamRow = Row.extend({ parent_id: z.string().nullable() });
const TemplateRow = Row.extend({ team_id: z.string() });
const TeamRef = z.looseObject({ id: z.string() });
const PersonRow = Row.extend({
  attributes: z.looseObject({ last_name: z.string() }),
  teams: z.array(TeamRef).default([]),
});
const ByResource = Row.extend({ resource_id: z.string() });
const OnCallRow = ByResource.extend({ team_id: z.string() });
const AnyRow = z.looseObject({});

type PersonFixture = z.output<typeof PersonRow>;

const load = <Output>(
  schema: z.ZodType<Output>,
  name: Parameters<typeof readFixture>[0],
): Output[] => {
  const raw = readFixture(name);
  return z.array(schema).parse(raw);
};

const kinds = load(KindRow, 'kinds');
const teams = load(TeamRow, 'teams');
const templates = load(TemplateRow, 'templates');
const people = load(PersonRow, 'people');
const shifts = load(ByResource, 'shifts');
const absences = load(ByResource, 'absences');
const onCalls = load(OnCallRow, 'on-calls');
const activityRates = load(AnyRow, 'activity-rates');

const employeeKind = kinds.find((kind) => kind.machine_name === 'employee');
if (employeeKind === undefined) {
  throw new Error('fixture kinds.json has no "employee" kind');
}
export const EMPLOYEE_KIND_ID = employeeKind.id;

const DateRange = z.string().regex(/^\d{4}-\d{2}-\d{2}\/\d{4}-\d{2}-\d{2}$/u);
const Ids = z.array(z.string());
const TeamFilterValue = z.object({ recursive: z.boolean(), teams: Ids });
const TeamFilter = z.object({ key: z.literal('resource.team'), value: TeamFilterValue });
const Order = z.object({
  attribute: z.literal('last_name'),
  direction: z.enum(['asc', 'desc']),
  key: z.literal('resource.attribute'),
});
const Pagination = z.object({
  limit: z.number().int().positive().nullable(),
  next_token: z.string().nullable(),
});

const ListResourcesQuery = z.object({
  filters: z.array(TeamFilter).default([]),
  kind_id: z.literal(EMPLOYEE_KIND_ID),
  orders: z.array(Order).min(1),
  pagination: Pagination,
  with_teams: z.boolean().default(false),
});
const ListTemplatesQuery = z.object({ team_ids: Ids.optional() });
const ListByDateQuery = z.object({ date_range: DateRange, resource_ids: Ids.optional() });
const ListOnCallsQuery = ListByDateQuery.extend({ team_ids: Ids.optional() });
const ShowActivityRatesQuery = z.object({
  date_range: DateRange.optional(),
  resource_id: z.string(),
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

// Validates auth headers and the body like Tipee, then answers.
const endpoint = <Query>(
  path: string,
  schema: z.ZodType<Query>,
  answer: (query: Query) => JsonBodyType | Response,
) =>
  http.post(api(path), async ({ request }) => {
    const rejection = headersLikeTipee(request);
    if (rejection !== undefined) {
      return rejection;
    }
    const query = schema.safeParse(await request.json());
    if (!query.success) {
      return unprocessable(z.treeifyError(query.error));
    }
    const answered = answer(query.data);
    return answered instanceof Response ? answered : HttpResponse.json(answered);
  });

const descendants = (teamId: string): Set<string> => {
  const found = new Set([teamId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const team of teams) {
      if (team.parent_id !== null && found.has(team.parent_id) && !found.has(team.id)) {
        found.add(team.id);
        grew = true;
      }
    }
  }
  return found;
};

const teamIdsOf = (filters: z.output<typeof TeamFilter>[]): Set<string> => {
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

const byLastName =
  (direction: 'asc' | 'desc') =>
  (left: PersonFixture, right: PersonFixture): number => {
    const sign = direction === 'asc' ? 1 : -1;
    return sign * left.attributes.last_name.localeCompare(right.attributes.last_name, 'fr');
  };

// A real cursor is opaque; this one is "<offset>:<signature>" so the fake can
// Refuse a page requested with different filters or orders, like Tipee does.
const cursor = (offset: number, signature: string): string => `${offset}:${signature}`;

const readCursor = (token: string | null, signature: string): number => {
  if (token === null) {
    return 0;
  }
  const separator = token.indexOf(':');
  if (token.slice(separator + 1) !== signature) {
    throw new Error('filters or orders changed between pages');
  }
  return Number(token.slice(0, separator));
};

const listResources = (query: z.output<typeof ListResourcesQuery>): JsonBodyType => {
  const signature = JSON.stringify([query.filters, query.orders]);
  const offset = readCursor(query.pagination.next_token, signature);
  const teamIds = teamIdsOf(query.filters);
  const [order] = query.orders;
  const direction = order === undefined ? 'asc' : order.direction;
  const matching = people
    .filter((person) => teamIds.size === 0 || person.teams.some((team) => teamIds.has(team.id)))
    .toSorted(byLastName(direction));
  const pageSize = Math.min(query.pagination.limit ?? matching.length, FAKE_PAGE_SIZE);
  // Tipee hands out a cursor even when the last page was exactly full.
  const nextOffset = offset + pageSize;
  return {
    data: matching.slice(offset, nextOffset),
    next_token: nextOffset <= matching.length ? cursor(nextOffset, signature) : null,
  };
};

const forPeople = <Item extends { resource_id: string }>(
  items: Item[],
  resourceIds: string[] | undefined,
): Item[] =>
  resourceIds === undefined
    ? items
    : items.filter((item) => resourceIds.includes(item.resource_id));

export const handlers = [
  endpoint('/api/directory/kinds.list', z.object({}), () => kinds),
  endpoint('/api/directory/teams.list', z.object({}), () => teams),
  endpoint('/api/schedule/schedule-templates.list', ListTemplatesQuery, ({ team_ids }) =>
    team_ids === undefined
      ? templates
      : templates.filter((template) => team_ids.includes(template.team_id)),
  ),
  endpoint('/api/directory/resources.list', ListResourcesQuery, (query) => {
    try {
      return listResources(query);
    } catch (error) {
      return unprocessable(error instanceof Error ? error.message : 'invalid cursor');
    }
  }),
  endpoint('/api/schedule/schedules.list', ListByDateQuery, ({ resource_ids }) =>
    forPeople(shifts, resource_ids),
  ),
  endpoint('/api/schedule/absences.list', ListByDateQuery, ({ resource_ids }) =>
    forPeople(absences, resource_ids),
  ),
  endpoint('/api/schedule/on-calls.list', ListOnCallsQuery, ({ resource_ids, team_ids }) =>
    forPeople(onCalls, resource_ids).filter(
      (duty) => team_ids === undefined || team_ids.includes(duty.team_id),
    ),
  ),
  endpoint('/api/directory/resources.show-activity-rates', ShowActivityRatesQuery, (query) =>
    people.some((person) => person.id === query.resource_id) ? activityRates : [],
  ),
];
