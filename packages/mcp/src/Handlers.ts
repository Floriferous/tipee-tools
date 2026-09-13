// Tool handlers: every operation tool forwards its decoded parameters to
// `invoke`; `check` probes the main read endpoints and reports shape
// Mismatches without aborting. Each call is timed and its outcome recorded
// By the telemetry, which never sees the parameters or the answer.

import { TipeeClient, integrationLink, invoke, operation, operations } from '@tipee-tools/core';
import type { TipeeError } from '@tipee-tools/core';
import { Cause, DateTime, Duration, Effect, Exit, Option, Result } from 'effect';
import { McpSchema } from 'effect/unstable/ai';

import { Telemetry } from './Telemetry.ts';
import type { Properties, Sink } from './Telemetry.ts';
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
    Effect.catchIf(
      (failure) => failure.reason._tag === 'UnexpectedShape',
      (failure) =>
        Effect.as(
          Effect.flatMap(Telemetry, (telemetry) =>
            telemetry.exception(failure, { handled: true, properties: { tool: 'check' } }),
          ),
          {
            report: { error: failure.reason.message, name, status: 'failed' },
            result: undefined,
          } satisfies Probe,
        ),
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
type Handler = (params: unknown) => Effect.Effect<unknown, TipeeError>;

// Failures that mean a bug here or a change at Tipee, not a user's mistake.
const REPORTED = new Set(['UnexpectedShape', 'UnexpectedStatus', 'InvalidRequest']);

// Which client is calling, for the record: Claude Desktop, Claude Code…
const caller: Effect.Effect<Properties> = Effect.map(
  Effect.serviceOption(McpSchema.McpServerClient),
  (client) =>
    Option.match(client, {
      onNone: () => ({}),
      onSome: ({ clientInfo, protocolVersion }) => ({
        mcp_client: clientInfo.name,
        mcp_client_version: clientInfo.version,
        mcp_protocol: protocolVersion,
      }),
    }),
);

// Runs a handler and records one `tool_called` event: name, duration and
// Outcome, plus the failure's reason tag. Parameters and answers stay out.
const observed = (telemetry: Sink, tool: string, run: Handler): Handler =>
  Effect.fn('observed')(function* (params: unknown) {
    const [duration, exit] = yield* Effect.timed(Effect.exit(run(params)));
    const common = {
      ...(yield* caller),
      duration_ms: Math.round(Duration.toMillis(duration)),
      tool,
    };
    if (Exit.isSuccess(exit)) {
      yield* telemetry.capture('tool_called', { ...common, outcome: 'ok' });
      return exit.value;
    }
    const failure = Cause.findError(exit.cause);
    if (Result.isSuccess(failure)) {
      const { reason } = failure.success;
      yield* telemetry.capture('tool_called', {
        ...common,
        outcome: 'failed',
        reason: reason._tag,
      });
      if (REPORTED.has(reason._tag)) {
        yield* telemetry.exception(failure.success, { handled: true, properties: { tool } });
      }
    } else {
      yield* telemetry.capture('tool_called', { ...common, outcome: 'crashed' });
      yield* telemetry.exception(Cause.squash(exit.cause), {
        handled: false,
        properties: { tool },
      });
    }
    return yield* Effect.failCause(exit.cause);
  });

export const TipeeToolkitLayer = TipeeToolkit.toLayer(
  Effect.gen(function* () {
    const client = yield* TipeeClient;
    const telemetry = yield* Telemetry;
    const withClient = <A, E>(
      effect: Effect.Effect<A, E, TipeeClient | Telemetry>,
    ): Effect.Effect<A, E> =>
      effect.pipe(
        Effect.provideService(TipeeClient, client),
        Effect.provideService(Telemetry, telemetry),
      );

    const handlers: Record<string, Handler> = {
      check: observed(telemetry, 'check', (params) =>
        withClient(check(params as { from?: string; to?: string })),
      ),
    };
    for (const target of operations) {
      handlers[target.name] = observed(telemetry, target.name, (params) =>
        withClient(invoke(target, params)).pipe(Effect.map((result) => result ?? { done: true })),
      );
    }
    return TipeeToolkit.of(handlers as unknown as Handlers);
  }),
);
