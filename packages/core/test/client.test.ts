// The derived client against the fake Tipee, called through `invoke` the way
// the tools call it. Every test asserts on what comes back, never on the
// requests made; the fake enforces Tipee's rules and answers real (anonymised)
// responses, so this is also where the generated schemas meet reality.

import { describe, expect, layer } from '@effect/vitest';
import { Effect } from 'effect';
import { HttpResponse, http } from 'msw/http';

import { TestClient, WEEK, call, failure } from './answers.ts';
import { readFixture } from './fixtures.ts';
import { BASE, FAKE_PAGE_SIZE } from './handlers.ts';
import { server } from './server.ts';
import { EMPLOYEE_KIND_ID } from './tables.ts';

const GE = '1000000000000000102';
const FR = '1000000000000000105';
const ALICE = '1000000000000000100';
const CHLOE = '1000000000000000104';
const PAGE_SIZE = 100;

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

    // Tipee added month-day/plain inside 26.06.25; the regenerated document
    // now lists it.
    it.effect('shows a kind whose attributes include a month-day', () =>
      Effect.gen(function* () {
        const kind = (yield* call('kinds_show', { id: EMPLOYEE_KIND_ID })) as {
          attributes: ReadonlyArray<{ attribute: { content_type: string } }>;
        };

        expect(kind.attributes.map((entry) => entry.attribute.content_type)).toContain(
          'month-day/plain',
        );
      }),
    );

    // Tipee adds enum values within a version, so enums only answers carry
    // are open: a content type the document does not list must still decode.
    it.effect('shows a kind whose attributes include an unknown content type', () =>
      Effect.gen(function* () {
        const kind = readFixture('kind-employee') as {
          attributes: ReadonlyArray<{ attribute: object }>;
        };
        const attributes = kind.attributes.map((entry, index) =>
          index === 0
            ? { ...entry, attribute: { ...entry.attribute, content_type: 'week-day/plain' } }
            : entry,
        );
        server.use(
          http.post(`${BASE}/api/directory/kinds.show`, () =>
            HttpResponse.json({ ...kind, attributes }),
          ),
        );
        const shown = (yield* call('kinds_show', { id: EMPLOYEE_KIND_ID })) as {
          attributes: ReadonlyArray<{ attribute: { content_type: string } }>;
        };

        expect(shown.attributes[0]?.attribute.content_type).toBe('week-day/plain');
        expect(shown.attributes).toHaveLength(attributes.length);
      }),
    );

    // Enums a request can carry stay closed: a value Tipee would refuse is
    // caught before sending.
    it.effect('refuses a status the document does not list', () =>
      Effect.gen(function* () {
        const error = yield* failure(
          call('projects_update_status', { id: '1000000000000000200', status: 'bogus' }),
        );

        expect(error.reason._tag).toBe('InvalidRequest');
        expect(error.message).toMatch(/at \["status"\]/u);
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

    // A virtual day task has no record of its own: no actor, no timestamp.
    it.effect('lists day tasks, virtual ones included', () =>
      Effect.gen(function* () {
        const tasks = (yield* call('day_tasks_list', {
          date_range: WEEK,
          is_own: false,
          resource_ids: [ALICE],
        })) as ReadonlyArray<{ actor_id: string | null; at: string | null; virtual: boolean }>;

        expect(tasks.map((task) => task.virtual)).toEqual([false, true]);
        expect(tasks[1]).toMatchObject({ actor_id: null, at: null });
      }),
    );

    it.effect('lists shifts over an open date range', () =>
      Effect.gen(function* () {
        const shifts = (yield* call('schedules_list', {
          date_range: '2026-08-01/-',
        })) as ReadonlyArray<unknown>;

        expect(shifts.length).toBeGreaterThan(0);
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
