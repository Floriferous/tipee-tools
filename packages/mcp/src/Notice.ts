// Tells Claude, once per launch, that a newer tipee for Claude exists, so
// users hear about updates without running check_setup: a note after the
// answer of the first tool call that follows the lookup. The lookup starts
// with the launch's first tool call, so a launch nobody uses asks GitHub
// nothing. check_setup and update_plugin speak of updates themselves.
//
// The note rides in a text block of its own: the answer's structured content
// stays exactly what the tool's output schema says.

import { Deferred, Effect, Layer, Option, Ref, Schema } from 'effect';
import { McpSchema, McpServer } from 'effect/ai';

import { Telemetry } from './Telemetry.ts';
import { TipeeToolkit } from './Tools.ts';
import { Updates } from './Updates.ts';
import type { Update } from './Updates.ts';

// Tools whose answers already say whether an update exists.
const SPEAKING_OF_UPDATES = new Set(['check_setup', 'update_plugin']);

// What Claude reads after a tool's answer when a newer version exists.
export const updateNote = (update: Update, current: string): string =>
  `tipee for Claude ${update.version} is available (this is ${current}). When the current ` +
  'task allows, tell the user in one sentence and offer to install it with update_plugin; ' +
  'say it once.';

type Result = McpSchema.CallToolResult | McpSchema.InputRequired;

/**
 * The toolkit registered on the McpServer, each tool's answer followed by
 * the update note once per launch.
 */
export const NotifiedToolkit = Layer.effectDiscard(
  Effect.gen(function* () {
    const server = yield* McpServer.McpServer;
    const updates = yield* Updates;
    const telemetry = yield* Telemetry;
    const scope = yield* Effect.scope;
    // This launch's lookup, started by its first tool call, and whether
    // Claude heard of it.
    const found = yield* Deferred.make<Option.Option<Update>>();
    const start = yield* Effect.cached(
      Effect.asVoid(Effect.forkIn(Deferred.into(updates.available, found), scope)),
    );
    const told = yield* Ref.make(false);

    // The answer, with the note when the lookup found a newer version and
    // nothing has told it yet; until the lookup is done, a later answer will.
    const noted = (tool: string, result: Result): Effect.Effect<Result> =>
      Effect.gen(function* () {
        if (!Schema.is(McpSchema.CallToolResult)(result)) {
          return result;
        }
        if (SPEAKING_OF_UPDATES.has(tool)) {
          yield* Ref.set(told, true);
          return result;
        }
        if (!(yield* Deferred.isDone(found))) {
          return result;
        }
        const update = yield* Deferred.await(found);
        // Atomic: of two answers finishing together, one carries the note.
        if ((yield* Ref.getAndSet(told, true)) || Option.isNone(update)) {
          return result;
        }
        yield* telemetry.capture('update_offered', { tool, version: update.value.version });
        return new McpSchema.CallToolResult({
          _meta: result._meta,
          content: [
            ...result.content,
            { text: updateNote(update.value, updates.current), type: 'text' },
          ],
          isError: result.isError,
          structuredContent: result.structuredContent,
        });
      });

    // The registry the toolkit registers on, each handler wrapped.
    const wrapping = McpServer.McpServer.of({
      ...server,
      addTool: (options) =>
        server.addTool({
          ...options,
          handle: (payload) =>
            start.pipe(
              Effect.andThen(options.handle(payload)),
              Effect.flatMap((result) => noted(options.tool.name, result)),
            ),
        }),
    });
    yield* McpServer.registerToolkit(TipeeToolkit).pipe(
      Effect.provideService(McpServer.McpServer, wrapping),
    );
  }),
).pipe(Layer.provide(McpServer.McpServer.layer));
