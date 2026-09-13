// The derived client against the fake Tipee, called through `invoke` the way
// The tools call it. Every test asserts on what comes back, never on the
// Requests made; the fake enforces Tipee's rules and answers real (anonymised)
// Responses, so this is also where the generated schemas meet reality.

import { describe, expect, it, layer } from '@effect/vitest';
import { ConfigProvider, Effect, Layer, Redacted } from 'effect';
import { FetchHttpClient } from 'effect/unstable/http';

import type { TipeeError } from '../src/index.ts';
import { TipeeClient, invoke, operation } from '../src/index.ts';
import { API_KEY, FAKE_PAGE_SIZE } from './handlers.ts';
import { EMPLOYEE_KIND_ID } from './tables.ts';

const GE = '1000000000000000102';
const FR = '1000000000000000105';
const ALICE = '1000000000000000100';
const CHLOE = '1000000000000000104';
const WEEK = '2026-09-07/2026-09-13';
const PAGE_SIZE = 100;

const credentials = { apiKey: Redacted.make(API_KEY), instance: 'acme' };
const TestClient = TipeeClient.layer(credentials).pipe(Layer.provide(FetchHttpClient.layer));

const call = (name: string, params: unknown) => invoke(operation(name), params);

const failure = <A, R>(effect: Effect.Effect<A, TipeeError, R>): Effect.Effect<TipeeError, A, R> =>
  Effect.flip(effect);

layer(TestClient)('TipeeClient', (it) => {
  describe('directory', () => {
    it.effect('lists kinds and teams', () =>
      Effect.gen(function* () {
        const kinds = (yield* call('kinds_list', {})) as ReadonlyArray<{ id: string }>;
        const teams = (yield* call('teams_list', {})) as ReadonlyArray<{ name: string }>;

        expect(kinds.map((kind) => kind.id)).toContain(EMPLOYEE_KIND_ID);
        expect(teams.map((team) => team.name)).toContain('Opérations FR');
      }),
    );

    // PHP serialises an empty map as []: an attribute without choices must decode.
    it.effect('shows a kind whose attributes include an empty choice map', () =>
      Effect.gen(function* () {
        const kind = (yield* call('kinds_show', { id: EMPLOYEE_KIND_ID })) as {
          attributes: ReadonlyArray<{ attribute: { id: string } }>;
        };

        expect(kind.attributes.map((entry) => entry.attribute.id)).toContain('regrouping');
      }),
    );

    it.effect('decodes a delete whose failed map is empty', () =>
      Effect.gen(function* () {
        const result = (yield* call('schedules_delete', {
          ids: ['1000000000000000126'],
          options: { group_action: 'single' },
        })) as { deleted_count: number; failed_count: number };

        expect(result.deleted_count).toBe(1);
        expect(result.failed_count).toBe(0);
      }),
    );

    it.effect('lists a page of people, sorted, with a cursor for the next page', () =>
      Effect.gen(function* () {
        const page = (yield* call('resources_list', {
          kind_id: EMPLOYEE_KIND_ID,
          orders: [{ attribute: 'last_name', direction: 'asc', key: 'resource.attribute' }],
          pagination: { limit: PAGE_SIZE, next_token: null },
          with_teams: true,
        })) as { data: ReadonlyArray<{ label: string }>; next_token: string | null };

        expect(page.data).toHaveLength(FAKE_PAGE_SIZE);
        expect(page.data.map((person) => person.label)).toEqual([
          'Non attribué',
          'Bruno (BE2) Exemple',
        ]);
        expect(page.next_token).not.toBeNull();
      }),
    );

    it.effect('filters people by team, including sub-teams', () =>
      Effect.gen(function* () {
        const page = (yield* call('resources_list', {
          filters: [{ key: 'resource.team', value: { recursive: true, teams: [FR] } }],
          kind_id: EMPLOYEE_KIND_ID,
          orders: [{ attribute: 'last_name', direction: 'asc', key: 'resource.attribute' }],
          pagination: { limit: PAGE_SIZE, next_token: null },
        })) as { data: ReadonlyArray<{ label: string }> };

        expect(page.data.map((person) => person.label)).toEqual(['Chloé (CT3) Témoin']);
      }),
    );

    it.effect('shows activity rates', () =>
      Effect.gen(function* () {
        const rates = (yield* call('resources_show_activity_rates', {
          resource_id: CHLOE,
        })) as ReadonlyArray<{ average_rate: number }>;

        expect(rates).toHaveLength(2);
        expect(typeof rates[0]?.average_rate).toBe('number');
      }),
    );
  });

  describe('schedule', () => {
    it.effect('lists shifts, optionally for given people', () =>
      Effect.gen(function* () {
        const all = (yield* call('schedules_list', { date_range: WEEK })) as ReadonlyArray<{
          resource_id: string;
        }>;
        const alice = (yield* call('schedules_list', {
          date_range: WEEK,
          resource_ids: [ALICE],
        })) as ReadonlyArray<{ resource_id: string }>;

        expect(all.length).toBeGreaterThan(alice.length);
        expect(alice.every((shift) => shift.resource_id === ALICE)).toBe(true);
      }),
    );

    it.effect('lists absences, on-calls and templates', () =>
      Effect.gen(function* () {
        const absences = (yield* call('absences_list', { date_range: WEEK })) as ReadonlyArray<{
          absence_type: { machine_name: string };
        }>;
        const duties = (yield* call('on_calls_list', {
          date_range: WEEK,
          team_ids: [FR],
        })) as ReadonlyArray<{ team_id: string }>;
        const templates = (yield* call('schedule_templates_list', {
          team_ids: [GE],
        })) as ReadonlyArray<{ team_id: string }>;

        expect(absences.map((absence) => absence.absence_type.machine_name)).toContain('vacances');
        expect(duties.length).toBeGreaterThan(0);
        expect(duties.every((duty) => duty.team_id === FR)).toBe(true);
        expect(templates.length).toBeGreaterThan(0);
        expect(templates.every((template) => template.team_id === GE)).toBe(true);
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
      const error = yield* failure(call('kinds_list', {}));

      expect(error.reason._tag).toBe('ApiKeyRejected');
      expect(error.message).toMatch(/rejected the API key/u);
      expect(error.message).toContain('https://acme.tipee.net/hr-core/integrations');
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
