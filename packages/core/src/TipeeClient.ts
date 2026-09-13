// The Tipee HTTP client as an Effect service: one `post` that adds the
// Headers Tipee insists on, retries transient failures, explains every
// Non-2xx status, and validates the body against a schema. The endpoint
// Methods are thin wrappers over it.

import { Config, Context, Effect, Layer, Schedule, Schema, flow } from 'effect';
import type { Redacted } from 'effect';
import { HttpClient, HttpClientRequest, HttpClientResponse } from 'effect/unstable/http';

import {
  ApiKeyRejected,
  ConfigurationMissing,
  Forbidden,
  NotFound,
  RateLimited,
  RightsMissing,
  TipeeError,
  UnexpectedShape,
  UnexpectedStatus,
  Unreachable,
} from './Errors.ts';
import type { TipeeErrorReason } from './Errors.ts';
import {
  Absence,
  ActivityRate,
  Kind,
  OnCall,
  Person,
  PersonPage,
  Shift,
  Team,
  Template,
  encodeDateRange,
} from './Schemas.ts';
import type { DateRange } from './Schemas.ts';

export const TIPEE_API_VERSION = '26.06.25';

/** Tipee requires an explicit page size; 100 keeps the directory to one page. */
export const PAGE_SIZE = 100;

// Tipee derives the pagination cursor from the sort keys, so the order must
// Be explicit and identical on every page (otherwise it answers 422).
const RESOURCE_ORDER = [{ attribute: 'last_name', direction: 'asc', key: 'resource.attribute' }];

// Tipee answers 401 (not 403) for a valid key whose integration was never
// Granted any rights, so the body is the only way to tell the cases apart.
const RIGHTS_MISSING_MARKER = 'token_rights_missing';

const HTTP_OK_MIN = 200;
const HTTP_OK_MAX = 299;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_TOO_MANY_REQUESTS = 429;
const RETRY_ATTEMPTS = 3;

export interface TipeeCredentials {
  /** The Tipee subdomain, e.g. "acme" for acme.tipee.net. */
  readonly instance: string;
  /** The API key of an integration created in the Tipee admin panel. */
  readonly apiKey: Redacted.Redacted;
}

export interface TeamFilter {
  /** Restrict to this team and its sub-teams. */
  readonly teamId?: string | undefined;
}

export interface PeopleFilter {
  /** Restrict to these person ids. */
  readonly resourceIds?: ReadonlyArray<string> | undefined;
}

export class TipeeClient extends Context.Service<
  TipeeClient,
  {
    readonly kinds: Effect.Effect<ReadonlyArray<Kind>, TipeeError>;
    readonly teams: Effect.Effect<ReadonlyArray<Team>, TipeeError>;
    templates(filter?: TeamFilter): Effect.Effect<ReadonlyArray<Template>, TipeeError>;
    /** Every employee (or one team's), following pagination to the end. */
    people(filter?: TeamFilter): Effect.Effect<ReadonlyArray<Person>, TipeeError>;
    shifts(
      range: DateRange,
      filter?: PeopleFilter,
    ): Effect.Effect<ReadonlyArray<Shift>, TipeeError>;
    absences(
      range: DateRange,
      filter?: PeopleFilter,
    ): Effect.Effect<ReadonlyArray<Absence>, TipeeError>;
    onCalls(
      range: DateRange,
      filter?: PeopleFilter & TeamFilter,
    ): Effect.Effect<ReadonlyArray<OnCall>, TipeeError>;
    activityRates(
      resourceId: string,
      range?: DateRange,
    ): Effect.Effect<ReadonlyArray<ActivityRate>, TipeeError>;
  }
>()('@tipee-tools/core/TipeeClient') {
  // A client for one instance; needs an `HttpClient`.
  public static readonly layer = (
    credentials: TipeeCredentials,
  ): Layer.Layer<TipeeClient, never, HttpClient.HttpClient> =>
    Layer.effect(TipeeClient, make(credentials));

  // A client configured from `TIPEE_INSTANCE` and `TIPEE_API_KEY`.
  public static readonly layerConfig = Layer.unwrap(
    Config.all({
      apiKey: Config.Redacted('TIPEE_API_KEY'),
      instance: Config.String('TIPEE_INSTANCE'),
    }).pipe(
      Effect.map((credentials) => TipeeClient.layer(credentials)),
      Effect.mapError((cause) => new ConfigurationMissing({ cause })),
    ),
  );
}

const statusReason = (status: number, body: string): TipeeErrorReason => {
  if (status === HTTP_UNAUTHORIZED) {
    return body.includes(RIGHTS_MISSING_MARKER)
      ? new RightsMissing()
      : new ApiKeyRejected({ body });
  }
  if (status === HTTP_FORBIDDEN) {
    return new Forbidden({ body });
  }
  if (status === HTTP_NOT_FOUND) {
    return new NotFound({ body });
  }
  if (status === HTTP_TOO_MANY_REQUESTS) {
    return new RateLimited();
  }
  return new UnexpectedStatus({ body, status });
};

const idList = (id: string | undefined): ReadonlyArray<string> | undefined =>
  id === undefined ? undefined : [id];

const teamFilters = (teamId: string | undefined): ReadonlyArray<unknown> =>
  teamId === undefined
    ? []
    : [{ key: 'resource.team', value: { recursive: true, teams: [teamId] } }];

const make = Effect.fn('TipeeClient.make')(function* make(credentials: TipeeCredentials) {
  const client = (yield* HttpClient.HttpClient).pipe(
    HttpClient.mapRequest(
      flow(
        HttpClientRequest.prependUrl(`https://${credentials.instance}.tipee.net`),
        HttpClientRequest.acceptJson,
        HttpClientRequest.bearerToken(credentials.apiKey),
        HttpClientRequest.setHeader('tipee-version', TIPEE_API_VERSION),
      ),
    ),
    // Rate limits (429), server errors and network hiccups are retried with
    // Backoff; whatever is left after that is explained to the caller.
    HttpClient.retryTransient({
      schedule: Schedule.exponential('250 millis'),
      times: RETRY_ATTEMPTS,
    }),
  );

  const unreachable = (cause: { readonly message: string }): TipeeError =>
    new TipeeError({ reason: new Unreachable({ description: cause.message }) });

  // Posts to an endpoint and validates the response against its schema.
  const post = Effect.fn('TipeeClient.post')(function* post<S extends Schema.Constraint>(
    endpoint: string,
    body: unknown,
    schema: S,
  ) {
    yield* Effect.annotateCurrentSpan({ endpoint });
    const response = yield* HttpClientRequest.post(endpoint).pipe(
      HttpClientRequest.bodyJsonUnsafe(body),
      (request) => client.execute(request),
      Effect.mapError(unreachable),
    );
    if (response.status < HTTP_OK_MIN || response.status > HTTP_OK_MAX) {
      const text = yield* response.text.pipe(Effect.mapError(unreachable));
      return yield* new TipeeError({ reason: statusReason(response.status, text) });
    }
    return yield* HttpClientResponse.schemaBodyJson(schema)(response).pipe(
      Effect.mapError(
        (cause) =>
          new TipeeError({ reason: new UnexpectedShape({ details: cause.message, endpoint }) }),
      ),
    );
  });

  const kinds = post('/api/directory/kinds.list', {}, Schema.Array(Kind));
  const teams = post('/api/directory/teams.list', {}, Schema.Array(Team));

  const employeeKindId = kinds.pipe(
    Effect.flatMap((all) => {
      const employee = all.find((kind) => kind.machine_name === 'employee');
      return employee === undefined
        ? new TipeeError({
            reason: new UnexpectedShape({
              details: 'no resource kind with machine_name "employee"',
              endpoint: '/api/directory/kinds.list',
            }),
          })
        : Effect.succeed(employee.id);
    }),
  );

  const templates = Effect.fn('TipeeClient.templates')(function* templates({
    teamId,
  }: TeamFilter = {}) {
    return yield* post(
      '/api/schedule/schedule-templates.list',
      { team_ids: idList(teamId) },
      Schema.Array(Template),
    );
  });

  // Tipee may return a non-null cursor on the last full page, so an empty
  // Page also ends the loop.
  const people = Effect.fn('TipeeClient.people')(function* people({ teamId }: TeamFilter = {}) {
    const kindId = yield* employeeKindId;
    const filters = teamFilters(teamId);
    const collected: Array<Person> = [];
    let nextToken: string | null = null;
    do {
      // Annotated to break the inference cycle between `page` and `nextToken`.
      const page: typeof PersonPage.Type = yield* post(
        '/api/directory/resources.list',
        {
          filters,
          kind_id: kindId,
          orders: RESOURCE_ORDER,
          pagination: { limit: PAGE_SIZE, next_token: nextToken },
          with_teams: true,
        },
        PersonPage,
      );
      collected.push(...page.data.map((record) => Person.fromRecord(record)));
      nextToken = page.data.length === 0 ? null : page.next_token;
    } while (nextToken !== null);
    return collected;
  });

  const shifts = Effect.fn('TipeeClient.shifts')(function* shifts(
    range: DateRange,
    { resourceIds }: PeopleFilter = {},
  ) {
    return yield* post(
      '/api/schedule/schedules.list',
      { date_range: encodeDateRange(range), resource_ids: resourceIds },
      Schema.Array(Shift),
    );
  });

  const absences = Effect.fn('TipeeClient.absences')(function* absences(
    range: DateRange,
    { resourceIds }: PeopleFilter = {},
  ) {
    return yield* post(
      '/api/schedule/absences.list',
      { date_range: encodeDateRange(range), resource_ids: resourceIds },
      Schema.Array(Absence),
    );
  });

  const onCalls = Effect.fn('TipeeClient.onCalls')(function* onCalls(
    range: DateRange,
    { resourceIds, teamId }: PeopleFilter & TeamFilter = {},
  ) {
    return yield* post(
      '/api/schedule/on-calls.list',
      { date_range: encodeDateRange(range), resource_ids: resourceIds, team_ids: idList(teamId) },
      Schema.Array(OnCall),
    );
  });

  const activityRates = Effect.fn('TipeeClient.activityRates')(function* activityRates(
    resourceId: string,
    range?: DateRange,
  ) {
    return yield* post(
      '/api/directory/resources.show-activity-rates',
      {
        date_range: range === undefined ? undefined : encodeDateRange(range),
        resource_id: resourceId,
      },
      Schema.Array(ActivityRate),
    );
  });

  return TipeeClient.of({
    absences,
    activityRates,
    kinds,
    onCalls,
    people,
    shifts,
    teams,
    templates,
  });
});
