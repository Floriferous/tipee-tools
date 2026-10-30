// What is sent again after a failure, and what the agent is told when
// nothing more can be done: reads are retried, and writes only after an
// answer tipee says to replay (429, 503, 508), which changed nothing.

import { expect, layer } from '@effect/vitest';
import { Effect, Layer } from 'effect';
import { HttpClient, HttpClientResponse } from 'effect/http';
import { delay } from 'msw';
import { HttpResponse, http } from 'msw/http';

import { TipeeClient } from '../src/index.ts';
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
  credentials,
  failure,
  settled,
  status,
} from './answers.ts';
import { server } from './server.ts';

const HTTP_CREATED = 201;
const HTTP_LOOP_DETECTED = 508;

layer(TestClient)('retries', (it) => {
  it.effect('passes on what tipee says about its rate limit', () =>
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
        /^tipee answered with an unexpected error \(HTTP 504\): Gateway timeout /u,
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
        // The second attempt falls through to the fake tipee.
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
        'tipee could not be reached (tipee did not answer within 20 s). Check the internet ' +
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

  it.effect('stops retrying slow server errors before the client gives up', () =>
    Effect.gen(function* () {
      let sent = 0;
      // Every answer is a 504 that takes 19 s, on the test clock: four of
      // them would take 80 s, past the minute MCP clients wait.
      const slow = HttpClient.make((request) =>
        Effect.sync(() => {
          sent += 1;
        }).pipe(
          Effect.andThen(Effect.sleep('19 seconds')),
          Effect.as(
            HttpClientResponse.fromWeb(
              request,
              Response.json({ message: 'Gateway timeout' }, { status: HTTP_GATEWAY_TIMEOUT }),
            ),
          ),
        ),
      );
      const client = TipeeClient.layer(credentials).pipe(
        Layer.provide(Layer.succeed(HttpClient.HttpClient, slow)),
      );
      const error = yield* settled(failure(call('kinds_list', {}))).pipe(Effect.provide(client));

      expect(sent).toBe(3);
      expect(error.reason._tag).toBe('Unreachable');
      expect(error.message).toMatch(/no usable answer within 50 s, retries included/u);
    }),
  );

  it.effect('sends a write again after a concurrent change, which changed nothing', () =>
    Effect.gen(function* () {
      let sent = 0;
      server.use(
        http.post(SCHEDULES_CREATE_URL, () => {
          sent += 1;
          return sent === 1
            ? HttpResponse.json(
                { message: 'Loop detected' },
                { headers: { 'Retry-After': '1' }, status: HTTP_LOOP_DETECTED },
              )
            : new HttpResponse(undefined, { status: HTTP_CREATED });
        }),
      );
      yield* settled(call('schedules_create', NEW_SCHEDULE));

      expect(sent).toBe(2);
    }),
  );

  it.effect('says a write tipee refused with a server error changed nothing', () =>
    Effect.gen(function* () {
      let sent = 0;
      server.use(
        http.post(SCHEDULES_CREATE_URL, () => {
          sent += 1;
          return HttpResponse.json({ message: 'Oops' }, { status: HTTP_SERVER_ERROR });
        }),
      );
      const error = yield* settled(failure(call('schedules_create', NEW_SCHEDULE)));

      expect(sent).toBe(1);
      expect(error.message).toMatch(/Nothing was applied/u);
      expect(error.message).not.toMatch(/may have applied it/u);
    }),
  );

  it.effect('explains a concurrent change it could not get past', () =>
    Effect.gen(function* () {
      server.use(
        http.post(SCHEDULES_CREATE_URL, () =>
          HttpResponse.json({ message: 'Loop detected' }, { status: HTTP_LOOP_DETECTED }),
        ),
      );
      const error = yield* settled(failure(call('schedules_create', NEW_SCHEDULE)));

      expect(error.message).toMatch(/HTTP 508/u);
      expect(error.message).toMatch(/nothing was applied/u);
      expect(error.message).toMatch(/one call per day/u);
    }),
  );
});
