// The check_setup tool: probes the main read endpoints with real requests,
// one report line each, so a user learns which rights are missing and the
// day Tipee changes a response shape, without the check ever aborting on a
// refusal it can describe.

import type { IntegrationLink, TipeeClient } from '@tipee-tools/core';
import { TipeeError, integrationLink, operation, rightFor, invoke } from '@tipee-tools/core';
import { DateTime, Effect, Fiber, Option } from 'effect';

import { Telemetry } from './Telemetry.ts';
import type { EndpointReport } from './Tools.ts';
import { Updates } from './Updates.ts';
import type { Update } from './Updates.ts';

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

// One report line per endpoint. Shape mismatches are reported as failures,
// and to the telemetry, since they mean Tipee changed; a module that is off
// or a missing right is skipped; auth and network errors abort the whole
// check so the user sees their explanation once.
const probe = (
  name: string,
  params: unknown,
): Effect.Effect<Probe, TipeeError, TipeeClient | Telemetry> =>
  invoke(operation(name), params).pipe(
    Effect.map((result): Probe => ({
      report: { count: countOf(result), name, status: 'ok' },
      result,
    })),
    Effect.catchReason('TipeeError', 'UnexpectedShape', (reason, failure) =>
      Effect.as(
        Effect.flatMap(Telemetry, (telemetry) =>
          telemetry.exception(failure, { handled: true, properties: { tool: 'check_setup' } }),
        ),
        {
          report: { error: reason.message, name, status: 'failed' },
          result: undefined,
        } satisfies Probe,
      ),
    ),
    // The whole message, with the right to tick and where.
    Effect.catchReason('TipeeError', 'Forbidden', (_reason, failure) =>
      Effect.succeed<Probe>({
        report: { error: failure.message, name, status: 'skipped' },
        result: undefined,
      }),
    ),
  );

const ORDER = [{ attribute: 'last_name', direction: 'asc', key: 'resource.attribute' }];

// Why a probe that needs an id from an earlier one was not called.
const unavailable = ({ report }: Probe): string => {
  if (report.status === 'ok') {
    return `Not called: ${report.name} returned nothing to call it with.`;
  }
  if (report.status === 'failed') {
    return `Not called: it needs an id from ${report.name}, which failed.`;
  }
  return `Not called: it needs an id from ${report.name}, which needs ${rightFor(operation(report.name))}.`;
};

// Probes an endpoint with parameters built from an earlier probe's answer, or
// reports it skipped when that answer had no id to build them from (undefined
// parameters): a refused list never aborts the check.
const probeWith = (
  name: string,
  source: Probe,
  params: unknown,
): Effect.Effect<Probe, TipeeError, TipeeClient | Telemetry> =>
  params === undefined
    ? Effect.succeed({
        report: { error: unavailable(source), name, status: 'skipped' },
        result: undefined,
      })
    : probe(name, params);

// What the probes found: one line per endpoint, and the integration.
export interface Report {
  readonly date_range: string;
  readonly endpoints: ReadonlyArray<typeof EndpointReport.Type>;
  readonly integration?: IntegrationLink;
  readonly ok: boolean;
}

export const probes = Effect.fn('check_setup.probes')(function* ({
  from,
  to,
}: {
  from?: string;
  to?: string;
}) {
  const range = from !== undefined && to !== undefined ? { from, to } : yield* defaultRange;
  const dateRange = `${range.from}/${range.to}`;
  const kinds = yield* probe('kinds_list', {});
  const employee = (
    kinds.result as ReadonlyArray<{ id: string; machine_name: string }> | undefined
  )?.find((kind) => kind.machine_name === 'employee');
  const people = yield* probeWith(
    'resources_list',
    kinds,
    employee && {
      kind_id: employee.id,
      orders: ORDER,
      pagination: { limit: PAGE_SIZE, next_token: null },
      with_teams: true,
    },
  );
  const [somebody] =
    (people.result as { data?: ReadonlyArray<{ id: string }> } | undefined)?.data ?? [];
  const reports = [kinds.report, people.report];
  const next = [
    probe('teams_list', {}),
    probe('schedule_templates_list', {}),
    probe('schedules_list', { date_range: dateRange }),
    probe('absences_list', { date_range: dateRange }),
    probe('on_calls_list', { date_range: dateRange }),
    probeWith('resources_show_activity_rates', people, somebody && { resource_id: somebody.id }),
    probe('timechecks_list', {
      filters: [{ key: 'timecheck.date_range', value: dateRange }],
    }),
  ];
  for (const one of next) {
    reports.push((yield* one).report);
  }
  const integration = yield* integrationLink;
  return {
    date_range: dateRange,
    endpoints: reports,
    ...(integration === undefined ? {} : { integration }),
    ok: reports.every((report) => report.status !== 'failed'),
  } satisfies Report;
});

// A failed check, with the newer version offered after its own fix.
const offering = (error: TipeeError, update: Update): TipeeError =>
  new TipeeError({
    fix: [
      error.fix,
      `Version ${update.version} of Tipee for Claude is available: offer to install it with update_plugin.`,
    ]
      .filter((part) => part !== undefined)
      .join(' '),
    reason: error.reason,
  });

// The check_setup tool: the probes' report with the running version and any
// newer one. The newer one is looked up alongside the probes and offered on a
// failure too, since a release may fix what makes every call fail.
export const check = <R>(
  report: Effect.Effect<Report, TipeeError, R>,
): Effect.Effect<Report & { version: string; update?: Update }, TipeeError, R | Updates> =>
  Effect.gen(function* () {
    const updates = yield* Updates;
    const lookup = yield* Effect.forkChild(updates.available);
    const found = yield* report.pipe(
      Effect.catchTag('TipeeError', (error) =>
        Effect.flatMap(Fiber.join(lookup), (update) =>
          Effect.fail(Option.isSome(update) ? offering(error, update.value) : error),
        ),
      ),
    );
    const update = yield* Fiber.join(lookup);
    return {
      ...found,
      ...(Option.isSome(update) ? { update: update.value } : {}),
      version: updates.current,
    };
  });
