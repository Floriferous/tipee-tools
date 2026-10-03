// What is sent again after a failure, and what the agent is told when
// Nothing more can be done: reads and rate limits are retried, writes never.

import { expect, layer } from '@effect/vitest';
import { Effect, Fiber } from 'effect';
import { TestClock } from 'effect/testing';
import { HttpResponse, http } from 'msw';

import {
  HTTP_GATEWAY_TIMEOUT,
  HTTP_NOT_FOUND,
  HTTP_SERVER_ERROR,
  HTTP_TOO_MANY_REQUESTS,
  NEW_SCHEDULE,
  SCHEDULES_CREATE_URL,
  TestClient,
  call,
  failure,
  status,
} from './answers.ts';
import { server } from './server.ts';

layer(TestClient)('retries', (it) => {
  it.effect('passes on what Tipee says about its rate limit', () =>
    Effect.gen(function* () {
      server.use(
        status(HTTP_TOO_MANY_REQUESTS, {
          body: { message: 'Slow down.' },
          headers: { 'Retry-After': '30' },
          once: false,
        }),
      );
      const pending = yield* Effect.forkChild(failure(call('kinds_list', {})));
      yield* TestClock.adjust('10 seconds');
      const error = yield* Fiber.join(pending);

      expect(error.reason._tag).toBe('RateLimited');
      expect(error.message).toContain('Retry-After: 30');
      expect(error.message).toContain('Slow down.');
    }),
  );

  it.effect('never sends a failed write twice, and says it may have been applied', () =>
    Effect.gen(function* () {
      let sent = 0;
      server.use(
        http.post(SCHEDULES_CREATE_URL, () => {
          sent += 1;
          return HttpResponse.json(
            { message: 'Gateway timeout' },
            { status: HTTP_GATEWAY_TIMEOUT },
          );
        }),
      );
      const pending = yield* Effect.forkChild(failure(call('schedules_create', NEW_SCHEDULE)));
      yield* TestClock.adjust('10 seconds');
      const error = yield* Fiber.join(pending);

      expect(sent).toBe(1);
      expect(error.message).toMatch(
        /^Tipee answered with an unexpected error \(HTTP 504\): Gateway timeout /u,
      );
      expect(error.message).toMatch(/may have applied it/u);
    }),
  );

  it.effect('does not resend a write that lost its connection', () =>
    Effect.gen(function* () {
      let sent = 0;
      server.use(
        http.post(SCHEDULES_CREATE_URL, () => {
          sent += 1;
          return HttpResponse.error();
        }),
      );
      const error = yield* failure(call('schedules_create', NEW_SCHEDULE));

      expect(sent).toBe(1);
      expect(error.reason._tag).toBe('Unreachable');
      expect(error.message).toMatch(/may have applied it/u);
    }),
  );

  it.effect('does not retry client errors', () =>
    Effect.gen(function* () {
      server.use(status(HTTP_NOT_FOUND));
      const error = yield* failure(call('kinds_list', {}));

      expect(error.reason._tag).toBe('NotFound');
    }),
  );

  it.effect('retries a 429 and succeeds once the limit lifts', () =>
    Effect.gen(function* () {
      server.use(status(HTTP_TOO_MANY_REQUESTS, { headers: { 'Retry-After': '1' } }));
      const pending = yield* Effect.forkChild(call('kinds_list', {}));
      yield* TestClock.adjust('10 seconds');
      const kinds = (yield* Fiber.join(pending)) as ReadonlyArray<unknown>;

      expect(kinds.length).toBeGreaterThan(0);
    }),
  );

  it.effect('gives up after repeated server errors', () =>
    Effect.gen(function* () {
      server.use(status(HTTP_SERVER_ERROR, { once: false }));
      const pending = yield* Effect.forkChild(failure(call('kinds_list', {})));
      yield* TestClock.adjust('10 seconds');
      const error = yield* Fiber.join(pending);

      expect(error.reason._tag).toBe('UnexpectedStatus');
      expect(error.message).toMatch(/HTTP 500/u);
      expect(error.message).not.toMatch(/may have applied it/u);
    }),
  );
});
