// The batch loop on its own, with items that succeed, fail, crash or hang on
// the test clock: what it reports, and that a call never runs past the
// batch's time.

import { describe, expect, it } from '@effect/vitest';
import { Rejected, TipeeError, operations } from '@tipee-tools/core';
import { Clock, Effect, Exit, Fiber } from 'effect';
import { TestClock } from 'effect/testing';

import { BATCHED, runBatch } from '../src/index.ts';
import type { Send } from '../src/index.ts';

const items = (count: number): Array<number> => Array.from({ length: count }, (_, index) => index);

const refused = new TipeeError({ reason: new Rejected({ body: 'Locked.', status: 409 }) });

// Runs the batch on the test clock, past any wait it could have.
const ran = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.gen(function* () {
    const fiber = yield* Effect.forkChild(Effect.exit(effect));
    yield* TestClock.adjust('2 minutes');
    return yield* Fiber.join(fiber);
  });

describe('runBatch', () => {
  it.effect('reports a crash partway as an unknown outcome, keeping what was applied', () =>
    Effect.gen(function* () {
      const send: Send = (_item, index) =>
        index === 2 ? Effect.die(new Error('boom')) : Effect.void;
      const report = yield* runBatch(items(4), send);

      expect(report).toMatchObject({
        applied: 2,
        failed: { index: 2, outcome: 'unknown' },
        not_sent: 1,
      });
      expect(report.failed?.error).toBe('it failed unexpectedly: boom');
    }),
  );

  it.effect('lets a crash on the first item through', () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(runBatch(items(3), () => Effect.die(new Error('boom'))));

      expect(Exit.hasDies(exit)).toBe(true);
    }),
  );

  it.effect('lets an interruption through instead of reporting it as a failure', () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        runBatch(items(3), (_item, index) => (index === 1 ? Effect.interrupt : Effect.void)),
      );

      expect(Exit.hasInterrupts(exit)).toBe(true);
    }),
  );

  it.effect("cuts an item short when the batch's time runs out, as an unknown outcome", () =>
    Effect.gen(function* () {
      // The first item takes 20 s; the second would take 40 s, past the 50 s budget.
      const send: Send = (_item, index) => Effect.sleep(index === 0 ? '20 seconds' : '40 seconds');
      const exit = yield* ran(
        Effect.gen(function* () {
          const report = yield* runBatch(items(3), send);
          return { ended: yield* Clock.currentTimeMillis, report };
        }),
      );

      expect(Exit.isSuccess(exit)).toBe(true);
      const { ended, report } = Exit.isSuccess(exit) ? exit.value : { ended: 0, report: undefined };
      expect(ended).toBe(50_000);
      expect(report).toMatchObject({
        applied: 1,
        failed: { index: 1, outcome: 'unknown' },
        not_sent: 1,
      });
      expect(report?.failed?.error).toMatch(/no answer before the batch's 50 s ran out/u);
      expect(report?.failed?.error).toMatch(/read it back/u);
    }),
  );

  it.effect('names positions the way people say them', () =>
    Effect.gen(function* () {
      const failingAt =
        (at: number): Send =>
        (_item, index) =>
          index === at ? Effect.fail(refused) : Effect.void;
      const at10 = yield* runBatch(items(12), failingAt(10));
      const at21 = yield* runBatch(items(23), failingAt(21));
      const at12 = yield* runBatch(items(14), failingAt(12));

      expect(at10.message).toContain('items[10] (the 11th) failed and changed nothing');
      expect(at21.message).toContain('items[21] (the 22nd)');
      expect(at12.message).toContain('items[12] (the 13th)');
      expect(at10.message).toContain('10 items applied (items[0] to items[9])');
    }),
  );

  it('batches only operations that answer with no body, since it returns no results', () => {
    for (const name of BATCHED) {
      expect(operations.find((target) => target.name === name)?.success).toBeUndefined();
    }
  });
});
