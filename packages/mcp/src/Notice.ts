// Tells Claude, once per launch, that a newer tipee for Claude exists, so
// users hear about updates without running check_setup: a note after the
// answer of the first tool call that follows the lookup. The lookup starts
// with the launch's first tool call, so a launch nobody uses asks GitHub
// nothing. check_setup and update_plugin speak of updates themselves.
//
// The note rides in a text block of its own: the answer's structured content
// stays exactly what the tool's output schema says.

import type { Fiber } from 'effect';
import { Effect, Exit, Layer, Option } from 'effect';
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
    // This launch's lookup, once started, and whether Claude heard of it.
    const state: { lookup?: Fiber.Fiber<Option.Option<Update>>; told: boolean } = {
      told: false,
    };

    const start = Effect.suspend(() =>
      state.lookup === undefined
        ? Effect.map(Effect.forkIn(updates.available, scope), (fiber) => {
            state.lookup = fiber;
          })
        : Effect.void,
    );

    // The answer, with the note when the lookup found a newer version and
    // nothing has told it yet.
    const noted = (tool: string, result: Result): Effect.Effect<Result> =>
      Effect.suspend(() => {
        if (state.told || !(result instanceof McpSchema.CallToolResult)) {
          return Effect.succeed(result);
        }
        if (SPEAKING_OF_UPDATES.has(tool)) {
          state.told = true;
          return Effect.succeed(result);
        }
        const exit = state.lookup?.pollUnsafe();
        if (exit === undefined) {
          return Effect.succeed(result);
        }
        state.told = true;
        if (Exit.isFailure(exit) || Option.isNone(exit.value)) {
          return Effect.succeed(result);
        }
        const update = exit.value.value;
        return Effect.as(
          telemetry.capture('update_offered', { tool, version: update.version }),
          new McpSchema.CallToolResult({
            _meta: result._meta,
            content: [
              ...result.content,
              { text: updateNote(update, updates.current), type: 'text' },
            ],
            isError: result.isError,
            structuredContent: result.structuredContent,
          }),
        );
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
