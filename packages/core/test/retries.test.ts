// What is sent again after a failure, and what the agent is told when
// nothing more can be done: reads and rate limits are retried, writes never.

import { expect, layer } from '@effect/vitest';
import { Effect } from 'effect';
import { delay } from 'msw';
import { HttpResponse, http } from 'msw/http';

import {
  HTTP_GATEWAY_TIMEOUT,
  HTTP_NOT_FOUND,
  HTTP_SERVER_ERROR,
  HTTP_TOO_MANY_REQUESTS,
  KINDS_URL,
  NEW_SCHEDULE,
  SCHEDULES_CREATE_URL,
  TestClient,
  call,
  failure,
  settled,
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
      const error = yield* settled(failure(call('kinds_list', {})));

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
      const error = yield* settled(failure(call('schedules_create', NEW_SCHEDULE)));

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
      const kinds = (yield* settled(call('kinds_list', {}))) as ReadonlyArray<unknown>;

      expect(kinds.length).toBeGreaterThan(0);
    }),
  );

  it.effect('gives up after repeated server errors', () =>
    Effect.gen(function* () {
      let sent = 0;
      server.use(
        http.post(KINDS_URL, () => {
          sent += 1;
          return HttpResponse.json({ message: 'Oops' }, { status: HTTP_SERVER_ERROR });
        }),
      );
      const error = yield* settled(failure(call('kinds_list', {})));

      expect(sent).toBe(4);
      expect(error.reason._tag).toBe('UnexpectedStatus');
      expect(error.message).toMatch(/HTTP 500/u);
      expect(error.message).not.toMatch(/may have applied it/u);
    }),
  );

  it.effect('retries a read that lost its connection', () =>
    Effect.gen(function* () {
      let sent = 0;
      server.use(
        // The second attempt falls through to the fake Tipee.
        http.post(KINDS_URL, () => {
          sent += 1;
          return sent === 1 ? HttpResponse.error() : undefined;
        }),
      );
      const kinds = (yield* settled(call('kinds_list', {}))) as ReadonlyArray<unknown>;

      expect(sent).toBe(2);
      expect(kinds.length).toBeGreaterThan(0);
    }),
  );

  it.effect('gives up on a read that hangs, without sending it again', () =>
    Effect.gen(function* () {
      let sent = 0;
      server.use(
        http.post(KINDS_URL, async () => {
          sent += 1;
          await delay('infinite');
        }),
      );
      const error = yield* settled(failure(call('kinds_list', {})));

      expect(sent).toBe(1);
      expect(error.message).toBe(
        'Tipee could not be reached (Tipee did not answer within 20 s). Check the internet ' +
          'connection, or ask IT to allow acme.tipee.net, and try again.',
      );
    }),
  );

  it.effect('says a write that hung may have been applied', () =>
    Effect.gen(function* () {
      server.use(
        http.post(SCHEDULES_CREATE_URL, async () => {
          await delay('infinite');
        }),
      );
      const error = yield* settled(failure(call('schedules_create', NEW_SCHEDULE)));

      expect(error.reason._tag).toBe('Unreachable');
      expect(error.message).toMatch(/did not answer within 20 s/u);
      expect(error.message).toMatch(/may have applied it/u);
    }),
  );
});
