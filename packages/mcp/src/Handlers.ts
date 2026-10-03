// Tool handlers: every operation tool forwards its decoded parameters to
// `invoke`; `check_setup` runs the probes in Check.ts. Each call is timed
// And its outcome recorded by the telemetry, which never sees the parameters
// Or the answer.

import { TipeeClient, TipeeError, invoke, operations } from '@tipee-tools/core';
import { Cause, Duration, Effect, Exit, Option, Result } from 'effect';
import { McpSchema } from 'effect/ai';

import { check } from './Check.ts';
import { Telemetry } from './Telemetry.ts';
import type { Properties, Sink } from './Telemetry.ts';
import { TipeeToolkit } from './Tools.ts';
import { Updates } from './Updates.ts';
import type { Installed, UpdateFailed } from './Updates.ts';

// What the user hears after an update attempt.
const said = (outcome: Installed): string => {
  if (outcome.status === 'opened') {
    return `Version ${outcome.version} is downloaded and Claude Desktop is asking you to confirm the update: click Update in its dialog. Your instance and key are kept.`;
  }
  if (outcome.status === 'downloaded') {
    return `Version ${outcome.version} is downloaded to ${outcome.path}: open that file and confirm the update in Claude Desktop.`;
  }
  if (outcome.status === 'instructions') {
    return (
      `Version ${outcome.version} is available. In a terminal run \`claude plugin update tipee@tipee-tools\` ` +
      '(Claude Code can run it for you), then /reload-plugins, or use /plugin → Installed → tipee → ' +
      `Update now. Release notes: ${outcome.url}`
    );
  }
  return 'Tipee for Claude is already the latest version.';
};

const update = Effect.map(
  Effect.flatMap(Updates, (updates) => updates.install),
  (outcome) => ({ message: said(outcome), outcome }),
);

type Handlers = Parameters<typeof TipeeToolkit.of>[0];
type Failure = TipeeError | UpdateFailed;
type Handler = (params: unknown) => Effect.Effect<unknown, Failure>;

// The tag telemetry files a failure under.
const reasonOf = (failure: Failure): string =>
  failure instanceof TipeeError ? failure.reason._tag : failure._tag;

// What else a refusal says about its cause: the HTTP status and Tipee's own
// Constant for it, such as OVERLAPPING. Neither carries anything a user wrote.
const detailOf = (failure: Failure): Properties => {
  if (!(failure instanceof TipeeError)) {
    return {};
  }
  const { reason } = failure;
  if (reason._tag === 'Rejected') {
    return { error_code: reason.code, http_status: reason.status };
  }
  return reason._tag === 'UnexpectedStatus' ? { http_status: reason.status } : {};
};

// Failures that mean a bug here or a change at Tipee, not a user's mistake.
const REPORTED = new Set(['UnexpectedShape', 'UnexpectedStatus', 'InvalidRequest', 'Internal']);

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
type Announce = (who: Properties) => Effect.Effect<void>;

interface Watcher {
  readonly telemetry: Sink;
  readonly announce: Announce;
}

// Runs a handler and records one `tool_called` event: name, duration and
// Outcome, plus the failure's reason tag. Parameters and answers stay out.
const observed = ({ announce, telemetry }: Watcher, tool: string, run: Handler): Handler =>
  Effect.fn('observed')(function* (params: unknown) {
    const who = yield* caller;
    yield* announce(who);
    const [duration, exit] = yield* Effect.timed(Effect.exit(run(params)));
    const common = {
      ...who,
      duration_ms: Math.round(Duration.toMillis(duration)),
      tool,
    };
    if (Exit.isSuccess(exit)) {
      yield* telemetry.capture('tool_called', { ...common, outcome: 'ok' });
      return exit.value;
    }
    const failure = Cause.findError(exit.cause);
    if (Result.isSuccess(failure)) {
      const reason = reasonOf(failure.success);
      yield* telemetry.capture('tool_called', {
        ...common,
        ...detailOf(failure.success),
        outcome: 'failed',
        reason,
      });
      if (REPORTED.has(reason)) {
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
    const updates = yield* Updates;
    // Claude starts the server repeatedly and uses only some of those
    // Launches, so a session begins at the first tool call, not at startup.
    let announced = false;
    const announce: Announce = (who) =>
      Effect.suspend(() => {
        if (announced) {
          return Effect.void;
        }
        announced = true;
        return telemetry.capture('session_started', who);
      });
    const watcher: Watcher = { announce, telemetry };
    const withClient = <A, E>(
      effect: Effect.Effect<A, E, TipeeClient | Telemetry | Updates>,
    ): Effect.Effect<A, E> =>
      effect.pipe(
        Effect.provideService(TipeeClient, client),
        Effect.provideService(Telemetry, telemetry),
        Effect.provideService(Updates, updates),
      );

    const handlers: Record<string, Handler> = {
      check_setup: observed(watcher, 'check_setup', (params) =>
        withClient(check(params as { from?: string; to?: string })),
      ),
      update_plugin: observed(watcher, 'update_plugin', () => withClient(update)),
    };
    for (const target of operations) {
      handlers[target.name] = observed(watcher, target.name, (params) =>
        withClient(invoke(target, params)).pipe(Effect.map((result) => result ?? { done: true })),
      );
    }
    return TipeeToolkit.of(handlers as unknown as Handlers);
  }),
);
