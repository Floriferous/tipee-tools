// Tool handlers: every operation tool forwards its decoded parameters to
// `invoke`; `check` probes the main read endpoints and reports shape
// Mismatches without aborting.

import { TipeeClient, integrationLink, invoke, operation, operations } from '@tipee-tools/core';
import type { TipeeError } from '@tipee-tools/core';
import { DateTime, Effect } from 'effect';

import { TipeeToolkit } from './Tools.ts';
import type { EndpointReport } from './Tools.ts';

const DAYS_PER_WEEK = 7;
const PAGE_SIZE = 100;

interface Range {
  readonly from: string;
  readonly to: string;
}

// Today through six days from now — enough to exercise every endpoint.
const defaultRange: Effect.Effect<Range> = Effect.map(DateTime.now, (now) => ({
  from: DateTime.formatIsoDate(now),
  to: DateTime.formatIsoDate(DateTime.add(now, { days: DAYS_PER_WEEK - 1 })),
}));

// How many things an answer holds: a list, a page, or one object.
const countOf = (result: unknown): number => {
  if (Array.isArray(result)) {
    return result.length;
  }
  if (typeof result === 'object' && result !== null && 'data' in result) {
    return countOf(result.data);
  }
  return 1;
};

interface Probe {
  readonly result: unknown;
  readonly report: typeof EndpointReport.Type;
}

// One report line per endpoint. Shape mismatches are reported as failures
// And a module that is off or a missing right as skipped; auth and network
// Errors abort the whole check so the user sees their explanation once.
const probe = (name: string, params: unknown): Effect.Effect<Probe, TipeeError, TipeeClient> =>
  invoke(operation(name), params).pipe(
    Effect.map((result): Probe => ({
      report: { count: countOf(result), name, status: 'ok' },
      result,
    })),
    Effect.catchReason('TipeeError', 'UnexpectedShape', (reason) =>
      Effect.succeed<Probe>({
        report: { error: reason.message, name, status: 'failed' },
        result: undefined,
      }),
    ),
    Effect.catchReason('TipeeError', 'Forbidden', (reason) =>
      Effect.succeed<Probe>({
        report: { error: reason.message, name, status: 'skipped' },
        result: undefined,
      }),
    ),
  );

const ORDER = [{ attribute: 'last_name', direction: 'asc', key: 'resource.attribute' }];

const check = Effect.fn('check')(function* ({ from, to }: { from?: string; to?: string }) {
  const range = from !== undefined && to !== undefined ? { from, to } : yield* defaultRange;
  const dateRange = `${range.from}/${range.to}`;
  const kinds = yield* probe('kinds_list', {});
  const employee = (
    kinds.result as ReadonlyArray<{ id: string; machine_name: string }> | undefined
  )?.find((kind) => kind.machine_name === 'employee');
  const people = yield* probe('resources_list', {
    kind_id: employee?.id,
    orders: ORDER,
    pagination: { limit: PAGE_SIZE, next_token: null },
    with_teams: true,
  });
  const [somebody] =
    (people.result as { data?: ReadonlyArray<{ id: string }> } | undefined)?.data ?? [];
  const reports = [kinds.report, people.report];
  const probes: ReadonlyArray<readonly [string, unknown]> = [
    ['teams_list', {}],
    ['schedule_templates_list', {}],
    ['schedules_list', { date_range: dateRange }],
    ['absences_list', { date_range: dateRange }],
    ['on_calls_list', { date_range: dateRange }],
    ['resources_show_activity_rates', { resource_id: somebody?.id ?? '0' }],
    ['timechecks_list', { filters: [{ key: 'timecheck.date_range', value: dateRange }] }],
  ];
  for (const [name, params] of probes) {
    reports.push((yield* probe(name, params)).report);
  }
  const integration = yield* integrationLink;
  return {
    date_range: dateRange,
    endpoints: reports,
    ...(integration === undefined ? {} : { integration }),
    ok: reports.every((report) => report.status !== 'failed'),
  };
});

type Handlers = Parameters<typeof TipeeToolkit.of>[0];

export const TipeeToolkitLayer = TipeeToolkit.toLayer(
  Effect.gen(function* () {
    const client = yield* TipeeClient;
    const withClient = <A, E>(effect: Effect.Effect<A, E, TipeeClient>): Effect.Effect<A, E> =>
      Effect.provideService(effect, TipeeClient, client);

    const handlers: Record<string, (params: unknown) => Effect.Effect<unknown, TipeeError>> = {
      check: (params) => withClient(check(params as { from?: string; to?: string })),
    };
    for (const target of operations) {
      handlers[target.name] = (params) =>
        withClient(invoke(target, params)).pipe(Effect.map((result) => result ?? { done: true }));
    }
    return TipeeToolkit.of(handlers as unknown as Handlers);
  }),
);
