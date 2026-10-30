// The `*_many` tools: one operation applied to a list of items, one after
// another, in one tool call. tipee has no batch endpoint and no transaction
// across requests, but each request is atomic (an error status changed
// nothing), so stopping at the first failure leaves an exact state: the
// items before it were applied, the failed one says what it did, and the rest
// were not sent. In order, never in parallel: writes to the same data at
// once make tipee interrupt one (508), and timelines depend on order.

import { TipeeError } from '@tipee-tools/core';
import { Clock, Effect, Result, Schema } from 'effect';

/** The operations with a `*_many` tool: those agents edit in bulk. */
export const BATCHED: ReadonlyArray<string> = [
  'schedules_create',
  'schedules_update',
  'resources_update',
];

/** At most this many items per call: about 15 s of writes at today's latency. */
export const MAX_ITEMS = 50;

// No item starts after this, so the call ends well inside the minute MCP
// clients wait even if the last item takes its full 20 s attempt.
const DEADLINE_MILLIS = 30_000;
const MILLIS_PER_SECOND = 1000;

/** What a batch did, in item order. */
export const BatchReport = Schema.Struct({
  /** Items 0 to applied - 1 were applied. */
  applied: Schema.Int,
  /** The item that failed, which stopped the batch. */
  failed: Schema.optionalKey(Schema.Struct({ error: Schema.String, index: Schema.Int })),
  message: Schema.String,
  /** The items after it, never sent. */
  not_sent: Schema.Int,
});
export type BatchReport = typeof BatchReport.Type;

const plural = (count: number): string => (count === 1 ? '1 item' : `${count} items`);

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

// The first item's error, saying the batch stopped there.
const stoppedAtFirst = <E>(error: E, count: number): E | TipeeError =>
  count > 1 && error instanceof TipeeError
    ? new TipeeError({
        fix: [
          error.fix,
          `The batch stopped at its first item: the other ${plural(count - 1)} were not sent.`,
        ]
          .filter((part) => part !== undefined)
          .join(' '),
        reason: error.reason,
      })
    : error;

// Sends each item in order and stops at the first failure or once the
// deadline has passed. When the very first item fails, the batch fails with
// that item's error, so the client shows an error: nothing else was sent.
export const runBatch = <E>(
  items: ReadonlyArray<unknown>,
  send: (item: unknown) => Effect.Effect<unknown, E>,
): Effect.Effect<BatchReport, E | TipeeError> =>
  Effect.gen(function* () {
    const started = yield* Clock.currentTimeMillis;
    for (const [index, item] of items.entries()) {
      const now = yield* Clock.currentTimeMillis;
      if (index > 0 && now - started >= DEADLINE_MILLIS) {
        const left = items.length - index;
        return {
          applied: index,
          message:
            `Applied the first ${plural(index)}, then stopped after ` +
            `${DEADLINE_MILLIS / MILLIS_PER_SECOND} s to stay within the tool call's time: send ` +
            `the remaining ${plural(left)} (from index ${index}) in a new call.`,
          not_sent: left,
        } satisfies BatchReport;
      }
      const sent = yield* Effect.result(send(item));
      if (Result.isFailure(sent)) {
        const left = items.length - index - 1;
        if (index === 0) {
          return yield* Effect.fail(stoppedAtFirst(sent.failure, items.length));
        }
        return {
          applied: index,
          failed: { error: describe(sent.failure), index },
          message:
            `Applied the first ${plural(index)}; item ${index} failed and the batch stopped, ` +
            `so ${plural(left)} after it were not sent. Nothing is rolled back.`,
          not_sent: left,
        } satisfies BatchReport;
      }
    }
    return {
      applied: items.length,
      message: `Applied all ${plural(items.length)}.`,
      not_sent: 0,
    } satisfies BatchReport;
  });
