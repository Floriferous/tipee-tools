// The check_setup tool: probes the main read endpoints with real requests,
// One report line each, so a user learns which rights are missing and the
// Day Tipee changes a response shape, without the check ever aborting on a
// Refusal it can describe.

import type { TipeeClient, TipeeError } from '@tipee-tools/core';
import { integrationLink, operation, rightFor, invoke } from '@tipee-tools/core';
import { DateTime, Effect, Option } from 'effect';

import { Telemetry } from './Telemetry.ts';
import type { EndpointReport } from './Tools.ts';
import { Updates } from './Updates.ts';

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
// And to the telemetry, since they mean Tipee changed; a module that is off
// Or a missing right is skipped; auth and network errors abort the whole
// Check so the user sees their explanation once.
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
// Reports it skipped when that answer had no id to build them from (undefined
// Parameters): a refused list never aborts the check.
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

export const check = Effect.fn('check_setup')(function* ({
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
  const probes = [
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
  for (const next of probes) {
    reports.push((yield* next).report);
  }
  const integration = yield* integrationLink;
  const update = yield* Effect.flatMap(Updates, (updates) => updates.available);
  return {
    date_range: dateRange,
    endpoints: reports,
    ...(integration === undefined ? {} : { integration }),
    ok: reports.every((report) => report.status !== 'failed'),
    ...(Option.isSome(update) ? { update: update.value } : {}),
  };
});
