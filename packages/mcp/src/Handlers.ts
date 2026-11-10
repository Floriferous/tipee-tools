// Tool handlers: every operation tool forwards its decoded parameters to
// `invoke`, and a batch tool each of its items, in order (Batch.ts);
// `check_setup` runs the probes in Check.ts. Each call is timed and its
// outcome recorded (Observed.ts); the telemetry never sees the parameters'
// values or the answer. Without a usable setting every tipee call fails with what
// to fix.

import {
  AcceptedOffSpec,
  NotConfigured,
  TipeeClient,
  TipeeError,
  invoke,
  operations,
} from '@tipee-tools/core';
import type { ConfigurationMissing, Operation } from '@tipee-tools/core';
import { Effect, Layer, Result } from 'effect';

import { runBatch } from './Batch.ts';
import { check, probes } from './Check.ts';
import { observed } from './Observed.ts';
import type { Announce, Handler, Watcher } from './Observed.ts';
import { Telemetry } from './Telemetry.ts';
import { TipeeToolkit, batchName, batched } from './Tools.ts';
import { Updates } from './Updates.ts';
import type { Installed } from './Updates.ts';

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
  return 'tipee for Claude is already the latest version.';
};

const update = Effect.map(
  Effect.flatMap(Updates, (updates) => updates.install),
  (outcome) => ({ message: said(outcome), outcome }),
);

type Handlers = Parameters<typeof TipeeToolkit.of>[0];
// What a tool answers: tipee's answer, or `done` for an operation without one.
const answerOf = (result: unknown): unknown =>
  result === undefined || result instanceof AcceptedOffSpec ? { done: true } : result;

// The handlers, given the tipee client or why the settings give none.
const handlersFor = (connection: Result.Result<TipeeClient['Service'], ConfigurationMissing>) =>
  TipeeToolkit.toLayer(
    Effect.gen(function* () {
      const telemetry = yield* Telemetry;
      const updates = yield* Updates;
      if (Result.isFailure(connection)) {
        yield* Effect.logError(connection.failure.message);
        yield* telemetry.capture('server_failed', { reason: connection.failure._tag });
      }
      // Claude starts the server repeatedly and uses only some of those
      // launches, so a session begins at the first tool call, not at startup.
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
      const provided = <A, E>(
        effect: Effect.Effect<A, E, Telemetry | Updates>,
      ): Effect.Effect<A, E> =>
        effect.pipe(
          Effect.provideService(Telemetry, telemetry),
          Effect.provideService(Updates, updates),
        );
      // Without a client, nothing is sent and the failure names the setting.
      const connected = <A, E, R>(
        effect: Effect.Effect<A, E, R>,
      ): Effect.Effect<A, E | TipeeError, Exclude<R, TipeeClient>> =>
        Result.isSuccess(connection)
          ? Effect.provideService(effect, TipeeClient, connection.success)
          : Effect.fail(
              new TipeeError({
                reason: new NotConfigured({ description: connection.failure.message }),
              }),
            );

      const handlers: Record<string, Handler> = {
        check_setup: observed(watcher, { tool: 'check_setup' }, (params) =>
          provided(check(connected(probes(params as { from?: string; to?: string })))),
        ),
        update_plugin: observed(watcher, { tool: 'update_plugin' }, () => provided(update)),
      };
      const send =
        (target: Operation) =>
        (params: unknown): Effect.Effect<unknown, TipeeError> =>
          provided(connected(invoke(target, params)));
      for (const target of operations) {
        const run = observed(watcher, { tool: target.name }, send(target));
        handlers[target.name] = (params) => Effect.map(run(params), answerOf);
      }
      // Each item is recorded as a call of its own operation, via the batch;
      // the report carries the items' answers when the operation has one.
      for (const target of batched) {
        const tool = batchName(target);
        handlers[tool] = observed(watcher, { batch: true, tool }, (params) =>
          runBatch(
            (params as { readonly items: ReadonlyArray<unknown> }).items,
            (item, index) =>
              Effect.map(
                observed(watcher, { index, tool: target.name, via: tool }, send(target))(item),
                (result) => (result instanceof AcceptedOffSpec ? undefined : result),
              ),
            target.success !== undefined,
          ),
        );
      }
      return TipeeToolkit.of(handlers as unknown as Handlers);
    }),
  );

/** The handlers over the TipeeClient in context. */
export const TipeeToolkitLayer = Layer.unwrap(
  Effect.map(Effect.service(TipeeClient), (client) => handlersFor(Result.succeed(client))),
);

/**
 * The handlers over a client configured from the environment. A missing or
 * invalid setting does not stop the server: every tool that calls tipee,
 * check_setup first, then answers with what to fix, where the user sees it
 * rather than in a log.
 */
export const TipeeToolkitLayerConfig = TipeeToolkitLayer.pipe(
  Layer.provide(TipeeClient.layerConfig),
  Layer.catchTag('ConfigurationMissing', (missing) => handlersFor(Result.fail(missing))),
);
