// The `*_many` tools: one operation applied to a list of items, one after
// another, in one tool call. tipee has no batch endpoint and no transaction
// across requests, but each request is atomic (an error status changed
// nothing), so stopping at the first failure leaves an exact state: the
// items before it were applied, the failed one was not or may have been
// (`outcome`), and the rest were not sent. In order, never in parallel:
// writes to the same data at once make tipee interrupt one (508), and
// timelines depend on order.

import { TipeeError, Unreachable, outcomeUnknown } from '@tipee-tools/core';
import { Cause, Clock, Duration, Effect, Exit, Result, Schema } from 'effect';

/** The operations with a `*_many` tool: those agents edit in bulk. */
export const BATCHED: ReadonlyArray<string> = [
  'schedules_create',
  'schedules_update',
  'resources_update',
];

/** At most this many items per call: about 15 s of writes at today's latency. */
export const MAX_ITEMS = 50;

/** No item starts after this many seconds… */
export const START_DEADLINE_SECONDS = 30;
// …and none runs past this, retries and Retry-After waits included: an item
// still running then is cut short, its outcome unknown, so the call ends
// within the minute MCP clients wait.
const BUDGET_SECONDS = 50;
const MILLIS_PER_SECOND = 1000;

/** What a batch did, in item order; indices are 0-based positions in `items`. */
export const BatchReport = Schema.Struct({
  applied: Schema.Int.annotate({
    description: 'How many items were applied: items[0] up to items[applied - 1].',
  }),
  failed: Schema.optionalKey(
    Schema.Struct({
      error: Schema.String,
      index: Schema.Int.annotate({
        description: '0-based position in items of the item that stopped the batch.',
      }),
      outcome: Schema.Literals(['not_applied', 'unknown']).annotate({
        description:
          'not_applied: tipee changed nothing for this item. unknown: it may have been ' +
          'applied; read it back before sending it again.',
      }),
    }),
  ),
  message: Schema.String,
  not_sent: Schema.Int.annotate({ description: 'How many items after those were never sent.' }),
});
export type BatchReport = typeof BatchReport.Type;

/** Applies one item; its index is for the record. */
export type Send = (item: unknown, index: number) => Effect.Effect<unknown, TipeeError>;

const plural = (count: number): string => (count === 1 ? '1 item' : `${count} items`);

const SUFFIXES: Record<string, string> = { few: 'rd', one: 'st', two: 'nd' };
const ordinals = new Intl.PluralRules('en', { type: 'ordinal' });
// `items[3] (the 4th)`: the index Claude sends, and the position people say.
const nth = (index: number): string =>
  `items[${index}] (the ${index + 1}${SUFFIXES[ordinals.select(index + 1)] ?? 'th'})`;

const appliedPart = (count: number): string =>
  count === 1
    ? '1 item applied (items[0])'
    : `${count} items applied (items[0] to items[${count - 1}])`;

// What an item that ran out of the batch's time says: it may have been sent.
const cutShort = (): TipeeError =>
  new TipeeError({
    fix: 'This write may have been applied: read it back before sending it again.',
    reason: new Unreachable({
      description: `no answer before the batch's ${BUDGET_SECONDS} s ran out`,
    }),
  });

// Why an item failed, or undefined for an interruption from outside, which
// is not the item's doing and goes on.
const failureOf = (
  cause: Cause.Cause<TipeeError>,
): { readonly error: string; readonly outcome: 'not_applied' | 'unknown' } | undefined => {
  const found = Cause.findError(cause);
  if (Result.isSuccess(found)) {
    const error = found.success;
    return { error: error.message, outcome: outcomeUnknown(error) ? 'unknown' : 'not_applied' };
  }
  if (Cause.hasInterruptsOnly(cause)) {
    return undefined;
  }
  const crash = Cause.squash(cause);
  return {
    error: `it failed unexpectedly: ${crash instanceof Error ? crash.message : String(crash)}`,
    outcome: 'unknown',
  };
};

// The first item's error, saying the batch stopped there.
const stoppedAtFirst = (error: TipeeError, count: number): TipeeError =>
  count === 1
    ? error
    : new TipeeError({
        fix: [
          error.fix,
          `The batch stopped at its first item: the other ${plural(count - 1)} were not sent.`,
        ]
          .filter((part) => part !== undefined)
          .join(' '),
        reason: error.reason,
      });

// Sends each item in order, each within what is left of the batch's time,
// and stops at the first failure or once the start deadline has passed. When
// the very first item fails, the batch fails with its error (a crash
// propagates), so the client shows an error: nothing else was sent.
export const runBatch = (
  items: ReadonlyArray<unknown>,
  send: Send,
): Effect.Effect<BatchReport, TipeeError> =>
  Effect.gen(function* () {
    const started = yield* Clock.currentTimeMillis;
    for (const [index, item] of items.entries()) {
      const elapsed = (yield* Clock.currentTimeMillis) - started;
      if (index > 0 && elapsed >= START_DEADLINE_SECONDS * MILLIS_PER_SECOND) {
        const left = items.length - index;
        return {
          applied: index,
          message:
            `${appliedPart(index)}, then the batch stopped after ${START_DEADLINE_SECONDS} s to ` +
            `stay within the tool call's time: send the remaining ${plural(left)}, from ` +
            `${nth(index)}, in a new call.`,
          not_sent: left,
        } satisfies BatchReport;
      }
      const exit = yield* Effect.exit(
        send(item, index).pipe(
          Effect.timeoutOrElse({
            duration: Duration.millis(BUDGET_SECONDS * MILLIS_PER_SECOND - elapsed),
            orElse: () => Effect.fail(cutShort()),
          }),
        ),
      );
      if (Exit.isFailure(exit)) {
        const failure = failureOf(exit.cause);
        if (failure === undefined) {
          return yield* Effect.failCause(exit.cause);
        }
        if (index === 0) {
          const error = Cause.findError(exit.cause);
          return yield* Result.isSuccess(error)
            ? Effect.fail(stoppedAtFirst(error.success, items.length))
            : Effect.failCause(exit.cause);
        }
        const left = items.length - index - 1;
        const what =
          failure.outcome === 'unknown'
            ? `${nth(index)} may or may not have been applied: read it back before sending it again`
            : `${nth(index)} failed and changed nothing: fix it and send it again with the rest`;
        return {
          applied: index,
          failed: { error: failure.error, index, outcome: failure.outcome },
          message:
            `${appliedPart(index)}. ${what}; the ${plural(left)} after it were not sent. ` +
            'Nothing is rolled back.',
          not_sent: left,
        } satisfies BatchReport;
      }
    }
    return {
      applied: items.length,
      message: `All ${plural(items.length)} applied.`,
      not_sent: 0,
    } satisfies BatchReport;
  });
