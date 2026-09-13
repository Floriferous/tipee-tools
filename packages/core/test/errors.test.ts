// How failures come back through `invoke`: each one explained, and the ones
// A user can fix by hand ending with the page to open on their instance.

import { expect, layer } from '@effect/vitest';
import { Effect, Fiber, Layer, Redacted } from 'effect';
import { TestClock } from 'effect/testing';
import { FetchHttpClient } from 'effect/unstable/http';
import { HttpResponse, http } from 'msw';

import type { TipeeError } from '../src/index.ts';
import { TipeeClient, invoke, operation } from '../src/index.ts';
import { API_KEY, BASE } from './handlers.ts';
import { server } from './server.ts';
import { INTEGRATION_ID } from './tables.ts';

const WEEK = '2026-09-07/2026-09-13';
const KINDS_URL = `${BASE}/api/directory/kinds.list`;
const SCHEDULES_URL = `${BASE}/api/schedule/schedules.list`;
const RESOURCES_URL = `${BASE}/api/directory/resources.list`;
const PROJECTS_URL = `${BASE}/api/activity/projects.list`;
const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_UNPROCESSABLE = 422;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_SERVER_ERROR = 500;

const credentials = { apiKey: Redacted.make(API_KEY), instance: 'acme' };
const TestClient = TipeeClient.layer(credentials).pipe(Layer.provide(FetchHttpClient.layer));

interface Answer {
  readonly url?: string;
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
  readonly once?: boolean;
}

// Makes the fake answer one request (by default) with a status and body.
const status = (code: number, { url = KINDS_URL, body, headers, once = true }: Answer = {}) =>
  http.post(
    url,
    () =>
      body === undefined
        ? new HttpResponse(undefined, { headers, status: code })
        : HttpResponse.json(body, { headers, status: code }),
    { once },
  );

const call = (name: string, params: unknown) => invoke(operation(name), params);

const failure = <A, R>(effect: Effect.Effect<A, TipeeError, R>): Effect.Effect<TipeeError, A, R> =>
  Effect.flip(effect);

layer(TestClient)('errors', (it) => {
  it.effect('explains a response that does not match the API description', () =>
    Effect.gen(function* () {
      server.use(http.post(SCHEDULES_URL, () => HttpResponse.json([{}]), { once: true }));
      const error = yield* failure(call('schedules_list', { date_range: WEEK }));

      expect(error.reason._tag).toBe('UnexpectedShape');
      expect(error.message).toMatch(/accepted the request/u);
      expect(error.message).toMatch(/at \[0\]\["id"\]/u);
    }),
  );

  it.effect('quotes what Tipee could not find', () =>
    Effect.gen(function* () {
      const error = yield* failure(
        call('schedules_delete', { ids: ['1'], options: { group_action: 'single' } }),
      );

      expect(error.reason._tag).toBe('NotFound');
      expect(error.message).toBe(
        `Tipee could not find it: L'élément avec l'id "1" n'a pas été trouvé.`,
      );
    }),
  );

  it.effect('reads a 400 as a rejection', () =>
    Effect.gen(function* () {
      server.use(
        status(HTTP_BAD_REQUEST, {
          body: { message: 'Text cannot be parsed to an interval: 01.11.2026' },
          url: SCHEDULES_URL,
        }),
      );
      const error = yield* failure(call('schedules_list', { date_range: '01.11.2026' }));

      expect(error.reason._tag).toBe('Rejected');
      expect(error.message).toBe(
        'Tipee rejected the request: Text cannot be parsed to an interval: 01.11.2026',
      );
    }),
  );

  it.effect('explains a valid key whose integration may not use the API yet', () =>
    Effect.gen(function* () {
      server.use(
        status(HTTP_UNAUTHORIZED, { body: { message: 'Tipee.api.token_rights_missing' } }),
      );
      const error = yield* failure(call('kinds_list', {}));

      expect(error.reason._tag).toBe('RightsMissing');
      expect(error.message).toMatch(/applications externes/u);
      expect(error.message).toContain('https://acme.tipee.net/hr-core/integrations');
      expect(error.message).toContain('https://acme.tipee.net/admin/instance/integrations/');
      expect(error.message).toMatch(/Responsable API/u);
    }),
  );

  it.effect('links a missing right to the Roles tab of the one integration', () =>
    Effect.gen(function* () {
      server.use(status(HTTP_FORBIDDEN, { url: SCHEDULES_URL }));
      const error = yield* failure(call('schedules_list', { date_range: WEEK }));

      expect(error.reason._tag).toBe('Forbidden');
      expect(error.message).toContain('«Planning → Voir les plannings»');
    }),
  );

  it.effect('names the special right of a write', () =>
    Effect.gen(function* () {
      server.use(status(HTTP_FORBIDDEN, { url: `${BASE}/api/timeclock/timechecks.delete` }));
      const error = yield* failure(call('timechecks_delete', { id: '1' }));

      expect(error.message).toContain('«Saisie des heures → Supprimer un timbrage»');
      expect(error.message).toContain(
        `https://acme.tipee.net/hr-core/profile/${INTEGRATION_ID}/roles`,
      );
    }),
  );

  it.effect('explains a request that does not match the API description before sending it', () =>
    Effect.gen(function* () {
      const error = yield* failure(call('timechecks_delete', { ids: ['1'] }));

      expect(error.reason._tag).toBe('InvalidRequest');
      expect(error.message).toMatch(/at \["id"\]/u);
    }),
  );

  it.effect('falls back to the integrations page when they cannot be listed', () =>
    Effect.gen(function* () {
      server.use(
        status(HTTP_FORBIDDEN, { url: SCHEDULES_URL }),
        status(HTTP_FORBIDDEN, { url: RESOURCES_URL }),
      );
      const error = yield* failure(call('schedules_list', { date_range: WEEK }));

      expect(error.message).toContain('https://acme.tipee.net/hr-core/integrations');
      expect(error.message).not.toContain('/roles');
    }),
  );

  it.effect('explains a module that is not activated', () =>
    Effect.gen(function* () {
      server.use(
        status(HTTP_FORBIDDEN, {
          body: { message: "Module 'Activités' is required and it is not activated." },
          url: PROJECTS_URL,
        }),
      );
      const error = yield* failure(call('projects_list', {}));

      expect(error.reason._tag).toBe('Forbidden');
      expect(error.message).toMatch(/Module 'Activités' is required/u);
      expect(error.message).toMatch(/administrator/u);
      expect(error.message).not.toContain('/roles');
    }),
  );

  it.effect('quotes the detail of a validation error', () =>
    Effect.gen(function* () {
      server.use(
        status(HTTP_UNPROCESSABLE, {
          body: {
            detail: 'date_range: This value is not a valid date range.',
            status: HTTP_UNPROCESSABLE,
            title: 'Validation Failed',
          },
          url: SCHEDULES_URL,
        }),
      );
      const error = yield* failure(call('schedules_list', { date_range: 'yesterday' }));

      expect(error.reason._tag).toBe('Rejected');
      expect(error.message).toBe(
        'Tipee rejected the request: date_range: This value is not a valid date range.',
      );
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
    }),
  );
});
