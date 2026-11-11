// The fake tipee. Happy-path handlers backed by the anonymised fixtures, which
// enforce the real API's rules (bearer key, explicit pagination, identical
// orders on every page, …) by answering 401/422 the way tipee does — so tests
// assert on behaviour instead of inspecting requests.

import {
  Array as Arr,
  Effect,
  Hash,
  Option,
  Order,
  Schema,
  String as Str,
  flow,
  pipe,
} from 'effect';
import { HttpServerRequest } from 'effect/http';
import type { JsonBodyType } from 'msw';
import { HttpResponse, http } from 'msw/http';

import { fixtures } from './fixtures.ts';
import {
  DeleteQuery,
  ListByDateQuery,
  ListDayTasksQuery,
  ListOnCallsQuery,
  ListResourcesQuery,
  ListTemplatesQuery,
  ListTimechecksQuery,
  ShowActivityRatesQuery,
  ShowQuery,
} from './queries.ts';
import type { TeamFilter } from './queries.ts';
import {
  EMPLOYEE_KIND_ID,
  INTEGRATION_KIND_ID,
  absences,
  activityRates,
  dayTasks,
  integrations,
  kinds,
  onCalls,
  people,
  shifts,
  teams,
  templates,
} from './tables.ts';
import type { Loaded, PersonRow } from './tables.ts';

export const BASE = 'https://acme.tipee.net';
export const API_KEY = 'test-key';
/** Smaller than any real page so the tests exercise pagination. */
export const FAKE_PAGE_SIZE = 2;

const HTTP_UNAUTHORIZED = 401;
const HTTP_NOT_FOUND = 404;
const HTTP_UNPROCESSABLE = 422;
const HTTP_INSUFFICIENT_STORAGE = 507;

const api = (path: string): string => `${BASE}${path}`;

const unauthorized = (message: string): Response =>
  HttpResponse.json({ message }, { status: HTTP_UNAUTHORIZED });

const unprocessable = (details: unknown): Response =>
  HttpResponse.json({ details, message: 'Invalid request' }, { status: HTTP_UNPROCESSABLE });

const notFound = (message: string): Response =>
  HttpResponse.json({ message }, { status: HTTP_NOT_FOUND });

// Deletes answer like tipee's PHP: a map of day to ids, and `[]` for an empty map.
const deleted = <Row extends { readonly id: string }>(
  items: ReadonlyArray<Loaded<Row>>,
  ids: ReadonlyArray<string>,
  day: string,
): JsonBodyType | Response => {
  const unknown = Arr.findFirst(ids, (id) => !Arr.some(items, (item) => item.row.id === id));
  return Option.match(unknown, {
    onNone: () => ({
      deleted: { [day]: ids },
      deleted_count: ids.length,
      failed: [],
      failed_count: 0,
    }),
    onSome: (id) => notFound(`L'élément avec l'id "${id}" n'a pas été trouvé.`),
  });
};

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
  Arr.map(items, (item) => item.raw);

// An MSW resolver written as an Effect, run as the promise MSW awaits.
export const resolver = <A>(
  answer: (info: { readonly request: Request }) => Effect.Effect<A>,
): ((info: { readonly request: Request }) => Promise<A>) => flow(answer, Effect.runPromise);

// Validates auth headers and the body like tipee, then answers.
const endpoint = <S extends Schema.ConstraintDecoder<unknown>>(
  path: string,
  schema: S,
  answer: (query: S['Type']) => JsonBodyType | Response,
) =>
  http.post(
    api(path),
    resolver(
      Effect.fnUntraced(function* ({ request }) {
        const rejection = headersLikeTipee(request);
        if (rejection !== undefined) {
          return rejection;
        }
        return yield* HttpServerRequest.fromWeb(request).json.pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(schema)),
          Effect.match({
            onFailure: (error) => unprocessable(error.message),
            onSuccess: (query) => {
              const answered = answer(query);
              return answered instanceof Response ? answered : HttpResponse.json(answered);
            },
          }),
        );
      }),
    ),
  );

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

type PersonFixture = Loaded<PersonRow>;

// Tipee sorts names the French way, accents included.
const French: Order.Order<string> = (self, that) => Str.localeCompare(that, ['fr'])(self);
const byLastName = (direction: 'asc' | 'desc') =>
  Arr.sortWith(
    (person: PersonFixture) => person.row.attributes.last_name,
    direction === 'asc' ? French : Order.flip(French),
  );

// A real cursor is opaque; this one is "<offset>:<signature>" so the fake can
// refuse a page requested with different filters or orders, like tipee does.
const cursor = (offset: number, signature: string): string => `${offset}:${signature}`;

const readCursor = (token: string | null, signature: string): Option.Option<number> => {
  if (token === null) {
    return Option.some(0);
  }
  const [offset, signed] = Str.split(token, ':');
  return signed === signature ? Option.some(Number(offset)) : Option.none();
};

const listResources = (query: typeof ListResourcesQuery.Type): JsonBodyType | Response => {
  const filters = query.filters ?? [];
  const signature = String(Hash.hash([filters, query.orders]));
  const cursorOffset = readCursor(query.pagination.next_token, signature);
  if (Option.isNone(cursorOffset)) {
    return unprocessable('filters or orders changed between pages');
  }
  const offset = cursorOffset.value;
  const teamIds = teamIdsOf(filters);
  const [order] = query.orders;
  const matching = pipe(
    query.kind_id === INTEGRATION_KIND_ID ? integrations : people,
    Arr.filter(
      ({ row }) => teamIds.size === 0 || Arr.some(row.teams ?? [], (team) => teamIds.has(team.id)),
    ),
    byLastName(order.direction),
  );
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
    : Arr.filter(items, (item) => resourceIds.includes(item.row.resource_id));

export const handlers = [
  endpoint('/api/directory/kinds.list', Schema.Struct({}), () => rawOf(kinds)),
  endpoint('/api/directory/kinds.show', ShowQuery, ({ id }) =>
    id === EMPLOYEE_KIND_ID
      ? fixtures['kind-employee']
      : notFound(`Le type avec l'id "${id}" n'a pas été trouvé.`),
  ),
  endpoint('/api/schedule/schedules.delete', DeleteQuery, ({ ids }) =>
    deleted(shifts, ids, '2026-09-07'),
  ),
  endpoint('/api/schedule/absences.delete', DeleteQuery, ({ ids }) =>
    deleted(absences, ids, '2026-09-07'),
  ),
  // Without a date filter tipee scans every timecheck and runs out of memory.
  endpoint('/api/timeclock/timechecks.list', ListTimechecksQuery, ({ filters }) =>
    Arr.some(filters ?? [], (filter) => filter.key === 'timecheck.date_range')
      ? []
      : HttpResponse.json(
          { message: 'Your request is using too much memory.' },
          { status: HTTP_INSUFFICIENT_STORAGE },
        ),
  ),
  endpoint('/api/directory/teams.list', Schema.Struct({}), () => rawOf(teams)),
  endpoint('/api/schedule/schedule-templates.list', ListTemplatesQuery, ({ team_ids }) =>
    rawOf(
      team_ids === undefined
        ? templates
        : Arr.filter(templates, (template) => team_ids.includes(template.row.team_id)),
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
      Arr.filter(
        forPeople(onCalls, resource_ids),
        (duty) => team_ids === undefined || team_ids.includes(duty.row.team_id),
      ),
    ),
  ),
  endpoint('/api/activity/day-tasks.list', ListDayTasksQuery, ({ resource_ids }) =>
    rawOf(forPeople(dayTasks, resource_ids)),
  ),
  endpoint('/api/directory/resources.show-activity-rates', ShowActivityRatesQuery, (query) =>
    rawOf(Arr.some(people, (person) => person.row.id === query.resource_id) ? activityRates : []),
  ),
];
