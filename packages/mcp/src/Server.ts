// The MCP server as one Layer: the toolkit registered on a stdio McpServer,
// The handlers backed by a TipeeClient configured from the environment. Logs
// Go to stderr because stdout is the MCP channel.

import { NodeFileSystem, NodeRuntime, NodeStdio } from '@effect/platform-node';
import { TipeeClient } from '@tipee-tools/core';
import type { ConfigurationMissing } from '@tipee-tools/core';
import { Cause, Effect, Layer, Logger, Result } from 'effect';
import { McpProtocol, McpServer } from 'effect/ai';
import { FetchHttpClient } from 'effect/http';

import { TipeeToolkitLayer } from './Handlers.ts';
import { SetupPrompt } from './Prompts.ts';
import { Telemetry } from './Telemetry.ts';
import { TipeeToolkit } from './Tools.ts';
import { Updates } from './Updates.ts';

export const SERVER_NAME = 'tipee';
export const SERVER_VERSION = '0.3.9';

// What every client gets up front, most important first: with tool search,
// Claude Code loads only tool names and these, and Claude Desktop never loads
// The plugin's skill. Clients may cut them past 2,048 characters.
export const INSTRUCTIONS = [
  "These tools read and change the user's company Tipee, a Swiss HR software, one tool per " +
    'API operation (<resource>_<verb>). In Tipee, people are resources, shifts are schedules, ' +
    'and the time clock is timechecks and day tasks.',
  'Run check_setup on a new install, or after a tool reports a refused key or a missing ' +
    'right: it names what to tick and where.',
  'Every id in a call comes from an earlier result: kinds_list (the employee kind), then ' +
    'resources_list for people; teams_list for teams; schedule_templates_list for templates.',
  'Read the current state before writing, and describe the change against it. When Tipee ' +
    'refuses a change, never route around it with a different change without asking the user.',
  'Formats: date ranges can be open (2026-08-01/-); date-time intervals carry no seconds ' +
    '(2026-09-07T08:00/2026-09-07T12:00); durations are ISO 8601 and may be negative (PT-15M).',
  '{"redacted": …} in place of a value means Tipee withheld it from this integration: say ' +
    'so, never guess it.',
  "A failing tool's message names the cause and the fix: follow it, and give the user any " +
    'link as is.',
].join('\n\n');

// Nothing is recorded on a start: Claude launches the server many times over
// On its own. The first tool call of a launch reports the session instead.
export const ServerLayer = Layer.mergeAll(McpServer.toolkit(TipeeToolkit), SetupPrompt).pipe(
  Layer.provide(TipeeToolkitLayer),
  Layer.provide(
    McpServer.layerStdio({
      description:
        'Tipee for Claude: people, teams, shifts, absences, on-calls, activities and time clock.',
      instructions: INSTRUCTIONS,
      name: SERVER_NAME,
      protocols: [
        McpProtocol.v2025_11_25,
        McpProtocol.v2025_06_18,
        McpProtocol.v2025_03_26,
        McpProtocol.v2024_11_05,
      ],
      version: SERVER_VERSION,
    }),
  ),
  Layer.provide(TipeeClient.layerConfig),
  Layer.provide(Telemetry.layer({ $lib_version: SERVER_VERSION, server_version: SERVER_VERSION })),
  Layer.provide(Updates.layer(SERVER_VERSION)),
  Layer.provide(FetchHttpClient.layer),
  Layer.provide(NodeFileSystem.layer),
  Layer.provide(NodeStdio.layer),
  Layer.provide(Layer.succeed(Logger.LogToStderr, true)),
);

// Reports why the server stopped, from a telemetry of its own: the server's
// May never have been built. An expected failure (missing configuration) is
// A `server_failed` event with its reason; anything else is an unhandled
// Exception. Never fails, never takes more than the flush timeout.
export const reportCrash = (cause: Cause.Cause<unknown>): Effect.Effect<void> =>
  Effect.gen(function* () {
    const telemetry = yield* Telemetry;
    const failure = Cause.findError(cause);
    if (Result.isSuccess(failure)) {
      const error: unknown = failure.success;
      const reason =
        typeof error === 'object' && error !== null && '_tag' in error
          ? String(error._tag)
          : 'Unknown';
      yield* telemetry.capture('server_failed', { reason });
    } else if (Cause.hasDies(cause)) {
      yield* telemetry.exception(Cause.squash(cause), { handled: false });
    }
    yield* telemetry.flush;
  }).pipe(
    Effect.provide(
      Telemetry.layer({ $lib_version: SERVER_VERSION, server_version: SERVER_VERSION }).pipe(
        Layer.provide(FetchHttpClient.layer),
      ),
    ),
    Effect.scoped,
    Effect.ignore,
  );

/** The whole server as one effect that runs until the client disconnects. */
export const main: Effect.Effect<never, ConfigurationMissing | Cause.IllegalArgumentError> =
  Layer.launch(ServerLayer).pipe(Effect.tapCause((cause) => reportCrash(cause)));

const EXIT_CRASHED = 1;

/**
 * Runs the server until the client disconnects: the one entry point of both
 * The source (`src/main.ts`) and the plugin's bundle. A crash outside the
 * Effect runtime is reported before the process dies, the way one inside it is.
 */
export const start = (): void => {
  const leave = Effect.sync(() => {
    // oxlint-disable-next-line unicorn/no-process-exit -- the process is crashing; leave once the report is out
    process.exit(EXIT_CRASHED);
  });
  const crashed = (error: unknown): void => {
    Effect.runFork(Effect.andThen(reportCrash(Cause.die(error)), leave));
  };
  process.on('uncaughtException', crashed);
  process.on('unhandledRejection', crashed);
  NodeRuntime.runMain(main);
};
