// The schemas must accept what Tipee really sends (the fixtures) and reject
// What the docs' examples would have led us to write.

import { Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  Absence,
  ActivityRate,
  Duration,
  Kind,
  LocalDateInterval,
  LocalDateTimeInterval,
  LocalTimeInterval,
  OnCall,
  Person,
  PersonPage,
  PersonRecord,
  Shift,
  Team,
  Template,
} from '../src/Schemas.ts';
import { readFixture } from './fixtures.ts';

const accepts = (schema: Schema.ConstraintDecoder<unknown>, value: string): boolean =>
  Result.isSuccess(Schema.decodeUnknownResult(schema)(value));

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
    ['kinds', Kind],
    ['teams', Team],
    ['templates', Template],
    ['shifts', Shift],
    ['absences', Absence],
    ['on-calls', OnCall],
    ['activity-rates', ActivityRate],
  ] as const)('%s parse', (name, schema) => {
    const result = Schema.decodeUnknownResult(Schema.Array(schema))(readFixture(name));

    expect(Result.isSuccess(result), Result.isFailure(result) ? result.failure.message : '').toBe(
      true,
    );
  });

  it('people parse as a page; the view keeps only planning fields', () => {
    const page = Schema.decodeUnknownSync(PersonPage)({
      data: readFixture('people'),
      next_token: null,
    });
    const [first] = page.data;
    if (first === undefined) {
      throw new Error('the people fixture is empty');
    }
    const view = Person.fromRecord(first);

    expect(first).not.toHaveProperty('picture');
    expect(view).not.toHaveProperty('attributes');
    expect(typeof view.activity_rate).toBe('number');
    expect(Array.isArray(view.teams)).toBe(true);
  });

  it('rejects a person without the planning attributes', () => {
    const result = Schema.decodeUnknownResult(PersonRecord)({
      id: '1',
      label: 'Alice',
      short_label: 'A',
      teams: [],
    });

    expect(Result.isFailure(result)).toBe(true);
  });
});
