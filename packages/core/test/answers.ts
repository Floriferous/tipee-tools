// Shared by the core tests: a client for the fake Tipee, and one-off answers
// To make it fail the way the real one does.

import { setImmediate } from 'node:timers/promises';

import { Effect, Fiber, Layer, Redacted } from 'effect';
import { FetchHttpClient } from 'effect/http';
import { TestClock } from 'effect/testing';
import { HttpResponse, http } from 'msw';
import type { HttpHandler } from 'msw';

import type { TipeeError } from '../src/index.ts';
import { TipeeClient, invoke, operation } from '../src/index.ts';
import { API_KEY, BASE } from './handlers.ts';

export const WEEK = '2026-09-07/2026-09-13';
export const KINDS_URL = `${BASE}/api/directory/kinds.list`;
export const SCHEDULES_URL = `${BASE}/api/schedule/schedules.list`;
export const RESOURCES_URL = `${BASE}/api/directory/resources.list`;
export const PROJECTS_URL = `${BASE}/api/activity/projects.list`;
export const SCHEDULES_CREATE_URL = `${BASE}/api/schedule/schedules.create`;
export const SCHEDULES_DELETE_URL = `${BASE}/api/schedule/schedules.delete`;
export const HTTP_BAD_REQUEST = 400;
export const HTTP_UNAUTHORIZED = 401;
export const HTTP_FORBIDDEN = 403;
export const HTTP_NOT_FOUND = 404;
export const HTTP_CONFLICT = 409;
export const HTTP_UNPROCESSABLE = 422;
export const HTTP_TOO_MANY_REQUESTS = 429;
export const HTTP_SERVER_ERROR = 500;
export const HTTP_GATEWAY_TIMEOUT = 504;

export const NEW_SCHEDULE = {
  hour_ranges: [{ auto_correct: null, hour_range: '08:00/PT8H', paid_break: null }],
  options: {
    allow_partial: false,
    employee_resident_ratio: false,
    schedule_on_bank_holidays: false,
    special_hour_range: null,
    text_color: null,
  },
  resource_id: '1',
  team_id: '2',
  when: '2026-10-05',
};

export const credentials = { apiKey: Redacted.make(API_KEY), instance: 'acme' };
export const TestClient = TipeeClient.layer(credentials).pipe(Layer.provide(FetchHttpClient.layer));

export interface Answer {
  readonly url?: string;
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
  readonly once?: boolean;
}

// Makes the fake answer one request (by default) with a status and body.
export const status = (
  code: number,
  { url = KINDS_URL, body, headers, once = true }: Answer = {},
): HttpHandler =>
  http.post(
    url,
    () =>
      body === undefined
        ? new HttpResponse(undefined, { headers, status: code })
        : HttpResponse.json(body, { headers, status: code }),
    { once },
  );

export const call = (
  name: string,
  params: unknown,
): Effect.Effect<unknown, TipeeError, TipeeClient> => invoke(operation(name), params);

export const failure = <A, R>(
  effect: Effect.Effect<A, TipeeError, R>,
): Effect.Effect<TipeeError, A, R> => Effect.flip(effect);

// Runs an effect whose retries sleep on the test clock. MSW answers `fetch`
// On the real event loop, so a single `TestClock.adjust` can pass before a
// Retry's sleep is even scheduled: let real I/O run, then step the clock,
// Until the effect is done.
export const settled = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Effect.gen(function* () {
    const fiber = yield* Effect.forkChild(effect);
    while (fiber.pollUnsafe() === undefined) {
      yield* Effect.promise(async () => setImmediate());
      yield* TestClock.adjust('1 second');
    }
    return yield* Fiber.join(fiber);
  });
