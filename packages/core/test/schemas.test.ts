// The schemas must accept what Tipee really sends (the fixtures) and reject
// What the docs' examples would have led us to write.

import {
  AbsenceList,
  ActivityRateList,
  Duration,
  KindList,
  LocalDateInterval,
  LocalDateTimeInterval,
  LocalTimeInterval,
  OnCallList,
  Person,
  PersonPage,
  ShiftList,
  TeamList,
  TemplateList,
  toPersonView,
} from '../src/schemas.ts';
import { describe, expect, it } from 'vitest';
import { readFixture } from './fixtures.ts';

const accepts = (schema: { safeParse: (value: unknown) => { success: boolean } }, value: string) =>
  schema.safeParse(value).success;

describe('interval formats', () => {
  it('accepts date-time intervals with or without seconds', () => {
    expect(accepts(LocalDateTimeInterval, '2026-09-07T23:00/2026-09-08T00:00')).toBe(true);
    expect(accepts(LocalDateTimeInterval, '2019-11-11T12:34:56/2019-12-12T23:59:59')).toBe(true);
    expect(accepts(LocalDateTimeInterval, '2026-09-07/2026-09-08')).toBe(false);
  });

  it('accepts open-ended date intervals', () => {
    expect(accepts(LocalDateInterval, '2026-08-01/-')).toBe(true);
    expect(accepts(LocalDateInterval, '-/2018-12-31')).toBe(true);
    expect(accepts(LocalDateInterval, '2026-08-01')).toBe(false);
  });

  it('accepts start time plus duration, including zero and negative parts', () => {
    expect(accepts(LocalTimeInterval, '23:00/PT1H')).toBe(true);
    expect(accepts(LocalTimeInterval, '07:00/PT4H15M')).toBe(true);
    expect(accepts(LocalTimeInterval, '00:00/PT0S')).toBe(true);
    expect(accepts(LocalTimeInterval, '7:00/PT1H')).toBe(false);
    expect(accepts(Duration, 'PT-15M')).toBe(true);
  });
});

describe('fixtures (real anonymised responses)', () => {
  it.each([
    ['kinds', KindList],
    ['teams', TeamList],
    ['templates', TemplateList],
    ['shifts', ShiftList],
    ['absences', AbsenceList],
    ['on-calls', OnCallList],
    ['activity-rates', ActivityRateList],
  ] as const)('%s parse', (name, schema) => {
    const result = schema.safeParse(readFixture(name));

    expect(result.success, result.success ? '' : result.error.message).toBe(true);
  });

  it('people parse as a page; the view keeps only planning fields', () => {
    const page = PersonPage.parse({ data: readFixture('people'), next_token: null });
    const [first] = page.data;
    if (first === undefined) {
      throw new Error('the people fixture is empty');
    }
    const view = toPersonView(first);

    expect(first).not.toHaveProperty('picture');
    expect(view).not.toHaveProperty('attributes');
    expect(typeof view.activity_rate).toBe('number');
    expect(Array.isArray(view.teams)).toBe(true);
  });

  it('rejects a person without the planning attributes', () => {
    const result = Person.safeParse({ id: '1', label: 'Alice', short_label: 'A', teams: [] });

    expect(result.success).toBe(false);
  });
});
