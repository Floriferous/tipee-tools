// What each tool call records: one `tool_called` event with the tool, its
// duration and outcome, and for a failure its reason, the HTTP status,
// tipee's code and the names (never the values) of the fields concerned and
// of the parameters sent; a batch item also names its batch and position.

import { isAcceptedOffSpec } from '@tipee-tools/core';
import type { TipeeError } from '@tipee-tools/core';
import { Cause, Duration, Effect, Exit, Option, Result } from 'effect';
import { McpSchema } from 'effect/ai';

import type { BatchReport } from './Batch.ts';
import type { Properties, Sink } from './Telemetry.ts';
import type { UpdateFailed } from './Updates.ts';

export type Failure = TipeeError | UpdateFailed;
export type Handler = (params: unknown) => Effect.Effect<unknown, Failure>;

// The tag telemetry files a failure under.
const reasonOf = (failure: Failure): string =>
  failure._tag === 'TipeeError' ? failure.reason._tag : failure._tag;

// The parameter names a call was sent with, nested ones as paths
// (`options.allow_partial`), never their values: with the fields tipee
// names, they tell an agent's mistake from a rule tipee added.
const MAX_PARAMS = 30;
const paramsOf = (params: unknown, prefix = ''): ReadonlyArray<string> =>
  typeof params === 'object' && params !== null && !Array.isArray(params)
    ? Object.entries(params)
        .flatMap(([key, value]) => {
          const name = prefix === '' ? key : `${prefix}.${key}`;
          const nested = paramsOf(value, name);
          return nested.length === 0 ? [name] : nested;
        })
        .toSorted()
        .slice(0, MAX_PARAMS)
    : [];

// What else a refusal says about its cause: the HTTP status, tipee's own
// constant for it (such as OVERLAPPING) and the fields it names. None
// carries anything a user wrote.
const detailOf = (failure: Failure): Properties => {
  if (failure._tag !== 'TipeeError') {
    return {};
  }
  const { reason } = failure;
  if (reason._tag === 'Rejected') {
    return { error_code: reason.code, error_fields: reason.fields, http_status: reason.status };
  }
  if (reason._tag === 'UnexpectedShape') {
    return { http_status: reason.status };
  }
  return reason._tag === 'UnexpectedStatus' ? { http_status: reason.status } : {};
};

// A write tipee applied with a success status its document does not declare.
const offSpecOf = (value: unknown): Properties =>
  isAcceptedOffSpec(value) ? { off_spec_status: value.status } : {};

// Failures that may mean a bug here or a change at tipee rather than a user's
// mistake, each worth an error-tracking issue of its own.
const REPORTED = new Set(['UnexpectedShape', 'UnexpectedStatus', 'InvalidRequest', 'Internal']);
// Refused as invalid: an agent's mistake, or a rule tipee added.
const INVALID_STATUSES = new Set([400, 422]);
const reported = (failure: Failure): boolean =>
  failure._tag === 'TipeeError' &&
  (REPORTED.has(failure.reason._tag) ||
    (failure.reason._tag === 'Rejected' && INVALID_STATUSES.has(failure.reason.status)));

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

/** Reports the session on its first tool call, and nothing on later ones. */
export type Announce = (who: Properties) => Effect.Effect<void>;

export interface Watcher {
  readonly telemetry: Sink;
  readonly announce: Announce;
}

/**
 * The tool a call is recorded under. An item of a batch also names the batch
 * tool (`via`) and its position; a batch's own call carries its counts, and
 * leaves the failure's details and error report to the item that failed.
 */
type Called =
  | { readonly tool: string; readonly via?: undefined }
  | { readonly tool: string; readonly via: string; readonly index: number }
  | { readonly tool: string; readonly via?: undefined; readonly batch: true };

// How a batch ended: by a failed item (outcome known or not), at its
// deadline, or not at all.
const stoppedBy = (report: BatchReport): string | undefined => {
  if (report.failed !== undefined) {
    return `failure_${report.failed.outcome}`;
  }
  return report.not_sent === 0 ? undefined : 'deadline';
};

// A batch's counts, numbers only.
const countsOf = (report: BatchReport): Properties => ({
  applied: report.applied,
  items: report.applied + (report.failed === undefined ? 0 : 1) + report.not_sent,
  not_sent: report.not_sent,
  stopped_by: stoppedBy(report),
});

// Runs a handler and records one `tool_called` event: name, duration and
// outcome, plus the failure's reason tag. Parameters and answers stay out.
export const observed = <E extends Failure>(
  { announce, telemetry }: Watcher,
  called: Called,
  run: (params: unknown) => Effect.Effect<unknown, E>,
): ((params: unknown) => Effect.Effect<unknown, E>) =>
  Effect.fn('observed')(function* (params: unknown) {
    const { tool } = called;
    const batch = 'batch' in called;
    const who = yield* caller;
    yield* announce(who);
    const [duration, exit] = yield* Effect.timed(Effect.exit(run(params)));
    const common = {
      ...who,
      duration_ms: Math.round(Duration.toMillis(duration)),
      tool,
      ...(called.via === undefined ? {} : { index: called.index, via: called.via }),
    };
    if (Exit.isSuccess(exit)) {
      yield* telemetry.capture('tool_called', {
        ...common,
        ...(batch ? countsOf(exit.value as BatchReport) : offSpecOf(exit.value)),
        outcome: 'ok',
      });
      return exit.value;
    }
    const failure = Cause.findError(exit.cause);
    if (Result.isSuccess(failure) && batch) {
      yield* telemetry.capture('tool_called', {
        ...common,
        outcome: 'failed',
        reason: reasonOf(failure.success),
      });
    } else if (Result.isSuccess(failure)) {
      const reason = reasonOf(failure.success);
      const sent = paramsOf(params);
      yield* telemetry.capture('tool_called', {
        ...common,
        ...detailOf(failure.success),
        outcome: 'failed',
        params_sent: sent,
        reason,
      });
      if (reported(failure.success)) {
        yield* telemetry.exception(failure.success, {
          handled: true,
          properties: { params_sent: sent, tool },
        });
      }
    } else if (Cause.hasInterruptsOnly(exit.cause)) {
      // Cancelled by the client, or cut short by its batch's time: no crash.
      yield* telemetry.capture('tool_called', { ...common, outcome: 'interrupted' });
    } else {
      yield* telemetry.capture('tool_called', { ...common, outcome: 'crashed' });
      if (!batch) {
        yield* telemetry.exception(Cause.squash(exit.cause), {
          handled: false,
          properties: { tool },
        });
      }
    }
    return yield* Effect.failCause(exit.cause);
  });
