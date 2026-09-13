// The client against the fake Tipee: every test asserts on what the service
// Returns, never on the requests it makes.

import { describe, expect, it, layer } from '@effect/vitest';
import { ConfigProvider, Effect, Fiber, Layer, Redacted } from 'effect';
import { TestClock } from 'effect/testing';
import { FetchHttpClient } from 'effect/unstable/http';
import { HttpResponse, http } from 'msw';

import type { TipeeError } from '../src/index.ts';
import { TipeeClient } from '../src/index.ts';
import { API_KEY, BASE, EMPLOYEE_KIND_ID } from './handlers.ts';
import { server } from './server.ts';

const GE = '1000000000000000102';
const FR = '1000000000000000105';
const ALICE = '1000000000000000100';
const CHLOE = '1000000000000000104';
const WEEK = { from: '2026-09-07', to: '2026-09-13' };
const KINDS_URL = `${BASE}/api/directory/kinds.list`;
const HTTP_UNAUTHORIZED = 401;
const HTTP_NOT_FOUND = 404;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_SERVER_ERROR = 500;

const credentials = { apiKey: Redacted.make(API_KEY), instance: 'acme' };
const TestClient = TipeeClient.layer(credentials).pipe(Layer.provide(FetchHttpClient.layer));

const status = (code: number, headers?: Record<string, string>, once = true) =>
  http.post(KINDS_URL, () => new HttpResponse(undefined, { headers, status: code }), { once });

const failure = <A, R>(effect: Effect.Effect<A, TipeeError, R>): Effect.Effect<TipeeError, A, R> =>
  Effect.flip(effect);

layer(TestClient)('TipeeClient', (it) => {
  describe('people', () => {
    it.effect('lists every employee across pages, sorted by last name', () =>
      Effect.gen(function* () {
        const client = yield* TipeeClient;
        const people = yield* client.people();

        expect(people.map((person) => person.label)).toEqual([
          'Non attribué',
          'Bruno (BE2) Exemple',
          'Alice (AP1) Placeholder',
          'Chloé (CT3) Témoin',
        ]);
      }),
    );

    it.effect('keeps only the planning fields', () =>
      Effect.gen(function* () {
        const client = yield* TipeeClient;
        const [first] = yield* client.people();

        expect(Object.keys(first ?? {}).toSorted()).toEqual([
          'activity_rate',
          'id',
          'is_apprentice',
          'is_paid_hourly',
          'is_trainee',
          'job',
          'label',
          'schedule_period',
          'short_label',
          'teams',
        ]);
      }),
    );

    it.effect('filters by team, including sub-teams', () =>
      Effect.gen(function* () {
        const client = yield* TipeeClient;
        const fr = yield* client.people({ teamId: FR });
        const ge = yield* client.people({ teamId: GE });

        expect(fr.map((person) => person.label)).toEqual(['Chloé (CT3) Témoin']);
        expect(ge).toHaveLength(3);
      }),
    );

    it.effect('fails clearly when Tipee has no employee kind', () =>
      Effect.gen(function* () {
        server.use(http.post(KINDS_URL, () => HttpResponse.json([]), { once: true }));
        const client = yield* TipeeClient;
        const error = yield* failure(client.people());

        expect(error.reason._tag).toBe('UnexpectedShape');
        expect(error.message).toMatch(/employee/u);
      }),
    );
  });

  describe('planning data', () => {
    it.effect('lists shifts, optionally for given people', () =>
      Effect.gen(function* () {
        const client = yield* TipeeClient;
        const all = yield* client.shifts(WEEK);
        const alice = yield* client.shifts(WEEK, { resourceIds: [ALICE] });

        expect(all.length).toBeGreaterThan(alice.length);
        expect(alice.every((shift) => shift.resource_id === ALICE)).toBe(true);
      }),
    );

    it.effect('lists absences with their type', () =>
      Effect.gen(function* () {
        const client = yield* TipeeClient;
        const absences = yield* client.absences(WEEK);

        expect(absences.map((absence) => absence.absence_type.machine_name)).toContain('vacances');
      }),
    );

    it.effect('lists on-call duties for a team', () =>
      Effect.gen(function* () {
        const client = yield* TipeeClient;
        const duties = yield* client.onCalls(WEEK, { teamId: FR });

        expect(duties.length).toBeGreaterThan(0);
        expect(duties.every((duty) => duty.team_id === FR)).toBe(true);
      }),
    );

    it.effect('lists templates for a team', () =>
      Effect.gen(function* () {
        const client = yield* TipeeClient;
        const templates = yield* client.templates({ teamId: GE });

        expect(templates.length).toBeGreaterThan(0);
        expect(templates.every((template) => template.team_id === GE)).toBe(true);
      }),
    );

    it.effect('shows activity rates and drops pay-related fields', () =>
      Effect.gen(function* () {
        const client = yield* TipeeClient;
        const rates = yield* client.activityRates(CHLOE);

        expect(rates).toHaveLength(2);
        expect(rates[0]).not.toHaveProperty('indemnity_enabled');
      }),
    );

    it.effect('lists kinds and teams', () =>
      Effect.gen(function* () {
        const client = yield* TipeeClient;
        const kinds = yield* client.kinds;
        const teams = yield* client.teams;

        expect(kinds.map((kind) => kind.id)).toContain(EMPLOYEE_KIND_ID);
        expect(teams.map((team) => team.name)).toContain('Opérations FR');
      }),
    );
  });

  describe('errors', () => {
    it.effect('explains an unexpected response shape', () =>
      Effect.gen(function* () {
        server.use(
          http.post(`${BASE}/api/schedule/schedules.list`, () => HttpResponse.json([{}]), {
            once: true,
          }),
        );
        const client = yield* TipeeClient;
        const error = yield* failure(client.shifts(WEEK));

        expect(error.reason._tag).toBe('UnexpectedShape');
        expect(error.message).toMatch(/unexpected response for \/api\/schedule\/schedules\.list/u);
      }),
    );

    it.effect('explains a valid key whose integration has no permissions yet', () =>
      Effect.gen(function* () {
        server.use(
          http.post(
            KINDS_URL,
            () =>
              HttpResponse.json(
                { message: 'Tipee.api.token_rights_missing' },
                { status: HTTP_UNAUTHORIZED },
              ),
            { once: true },
          ),
        );
        const client = yield* TipeeClient;
        const error = yield* failure(client.kinds);

        expect(error.reason._tag).toBe('RightsMissing');
        expect(error.message).toMatch(/applications externes/u);
      }),
    );

    it.effect('does not retry client errors', () =>
      Effect.gen(function* () {
        server.use(status(HTTP_NOT_FOUND));
        const client = yield* TipeeClient;
        const error = yield* failure(client.kinds);

        expect(error.reason._tag).toBe('NotFound');
      }),
    );

    it.effect('retries a 429 and succeeds once the limit lifts', () =>
      Effect.gen(function* () {
        server.use(status(HTTP_TOO_MANY_REQUESTS, { 'Retry-After': '1' }));
        const client = yield* TipeeClient;
        const pending = yield* Effect.forkChild(client.kinds);
        yield* TestClock.adjust('10 seconds');
        const kinds = yield* Fiber.join(pending);

        expect(kinds.length).toBeGreaterThan(0);
      }),
    );

    it.effect('gives up after repeated server errors', () =>
      Effect.gen(function* () {
        server.use(status(HTTP_SERVER_ERROR, undefined, false));
        const client = yield* TipeeClient;
        const pending = yield* Effect.forkChild(failure(client.kinds));
        yield* TestClock.adjust('10 seconds');
        const error = yield* Fiber.join(pending);

        expect(error.reason._tag).toBe('UnexpectedStatus');
        expect(error.message).toMatch(/HTTP 500/u);
      }),
    );
  });
});

describe('configuration', () => {
  const withProvider = (values: Record<string, string>) =>
    Layer.provide(
      TipeeClient.layerConfig,
      Layer.mergeAll(
        FetchHttpClient.layer,
        ConfigProvider.layer(ConfigProvider.fromUnknown(values)),
      ),
    );

  it.effect('rejects a wrong key with an explanation', () =>
    Effect.gen(function* () {
      const client = yield* TipeeClient;
      const error = yield* failure(client.kinds);

      expect(error.reason._tag).toBe('ApiKeyRejected');
      expect(error.message).toMatch(/rejected the API key/u);
    }).pipe(Effect.provide(withProvider({ TIPEE_API_KEY: 'wrong', TIPEE_INSTANCE: 'acme' }))),
  );

  it.effect('explains missing configuration without calling Tipee', () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(Layer.build(withProvider({})));

      expect(error._tag).toBe('ConfigurationMissing');
      expect(error.message).toMatch(/TIPEE_INSTANCE/u);
    }).pipe(Effect.scoped),
  );
});
