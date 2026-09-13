// End-to-end through `run` against the fake Tipee: every test asserts on what
// The CLI outputs, never on the requests it makes.

import { API_KEY, BASE, EMPLOYEE_KIND_ID, server } from '@tipee-tools/core/testing';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { run } from '../src/cli.ts';

const ENV = { TIPEE_API_KEY: API_KEY, TIPEE_INSTANCE: 'acme' };
const GE = '1000000000000000102';
const FR = '1000000000000000105';
const ALICE = '1000000000000000100';
const CHLOE = '1000000000000000104';
const WEEK = ['2026-09-07', '2026-09-13'];

const runJson = async (argv: string[]): Promise<unknown> => JSON.parse(await run(argv, ENV));

const labels = (people: unknown): string[] =>
  (people as { label: string }[]).map((person) => person.label);

describe('people', () => {
  it('lists every employee across pages, sorted by last name', async () => {
    const people = await runJson(['people']);

    expect(labels(people)).toEqual([
      'Non attribué',
      'Bruno (BE2) Exemple',
      'Alice (AP1) Placeholder',
      'Chloé (CT3) Témoin',
    ]);
  });

  it('keeps only the planning fields', async () => {
    const [alice] = (await runJson(['people'])) as Record<string, unknown>[];

    expect(Object.keys(alice ?? {}).toSorted()).toEqual([
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
  });

  it('filters by team, including sub-teams', async () => {
    expect(labels(await runJson(['people', '--team', FR]))).toEqual(['Chloé (CT3) Témoin']);
    expect(labels(await runJson(['people', '--team', GE]))).toHaveLength(3);
  });

  it('fails clearly when Tipee has no employee kind', async () => {
    server.use(
      http.post(`${BASE}/api/directory/kinds.list`, () => HttpResponse.json([]), { once: true }),
    );

    await expect(run(['people'], ENV)).rejects.toThrow(/employee/u);
  });
});

describe('planning data', () => {
  it('lists shifts, optionally for given people', async () => {
    const all = (await runJson(['shifts', ...WEEK])) as { resource_id: string }[];
    const alice = (await runJson(['shifts', ...WEEK, '--people', ALICE])) as {
      resource_id: string;
    }[];

    expect(all.length).toBeGreaterThan(alice.length);
    expect(alice.every((shift) => shift.resource_id === ALICE)).toBe(true);
  });

  it('lists absences with their type', async () => {
    const absences = (await runJson(['absences', ...WEEK])) as {
      absence_type: { machine_name: string };
    }[];

    expect(absences.map((absence) => absence.absence_type.machine_name)).toContain('vacances');
  });

  it('lists on-call duties for a team', async () => {
    const duties = (await runJson(['on-calls', ...WEEK, '--team', FR])) as { team_id: string }[];

    expect(duties.length).toBeGreaterThan(0);
    expect(duties.every((duty) => duty.team_id === FR)).toBe(true);
  });

  it('lists templates for a team', async () => {
    const templates = (await runJson(['templates', '--team', GE])) as { team_id: string }[];

    expect(templates.length).toBeGreaterThan(0);
    expect(templates.every((template) => template.team_id === GE)).toBe(true);
  });

  it('shows activity rates and flattens nothing sensitive', async () => {
    const rates = (await runJson(['activity-rates', CHLOE])) as Record<string, unknown>[];

    expect(rates).toHaveLength(2);
    expect(rates[0]).not.toHaveProperty('indemnity_enabled');
  });

  it('lists kinds and teams', async () => {
    const kinds = (await runJson(['kinds'])) as { id: string }[];
    const teams = (await runJson(['teams'])) as { name: string }[];

    expect(kinds.map((kind) => kind.id)).toContain(EMPLOYEE_KIND_ID);
    expect(teams.map((team) => team.name)).toContain('Opérations FR');
  });
});

describe('check', () => {
  it('reports every endpoint as ok', async () => {
    const report = await run(['check'], ENV, new Date('2026-09-07T08:00:00Z'));

    expect(report).toContain('ok    people (4)');
    expect(report).toContain('ok    templates (6)');
    expect(report).toContain('Date range: 2026-09-07/2026-09-13');
    expect(report).not.toContain('FAIL');
  });

  it('flags an endpoint whose response no longer matches', async () => {
    server.use(
      http.post(
        `${BASE}/api/schedule/schedule-templates.list`,
        () => HttpResponse.json([{ id: 'not-a-snowflake' }]),
        { once: true },
      ),
    );

    await expect(run(['check', ...WEEK], ENV)).rejects.toThrow(/FAIL {2}templates/u);
  });

  it('reports a broken directory response instead of aborting', async () => {
    server.use(
      http.post(
        `${BASE}/api/directory/resources.list`,
        () => HttpResponse.json({ data: [{ id: 'not-a-person' }], next_token: null }),
        { once: true },
      ),
    );

    await expect(run(['check', ...WEEK], ENV)).rejects.toThrow(/FAIL {2}people[^]*ok {4}teams/u);
  });
});

describe('errors and usage', () => {
  it('explains an unexpected response shape', async () => {
    server.use(
      http.post(`${BASE}/api/schedule/schedules.list`, () => HttpResponse.json([{}]), {
        once: true,
      }),
    );

    await expect(run(['shifts', ...WEEK], ENV)).rejects.toThrow(
      /unexpected response for \/api\/schedule\/schedules\.list/u,
    );
  });

  it('rejects malformed dates before calling Tipee', async () => {
    await expect(run(['shifts', 'next-week', 'friday'], ENV)).rejects.toThrow(/yyyy-mm-dd/iu);
  });

  it('needs a person id for activity rates', async () => {
    await expect(run(['activity-rates'], ENV)).rejects.toThrow(/person id/u);
  });

  it('explains missing configuration without calling Tipee', async () => {
    await expect(run(['kinds'], {})).rejects.toThrow(/tipee_instance/iu);
  });

  it('prints usage when asked or when the command is unknown', async () => {
    await expect(run([], ENV)).resolves.toContain('Usage: pnpm tipee');
    await expect(run(['frobnicate'], ENV)).rejects.toThrow(/unknown command/iu);
  });
});
