// The operation catalogue is read off the generated API: every endpoint in
// Tipee's document is there, named after its path, classified by verb.

import { describe, expect, it } from 'vitest';

import { operation, operations } from '../src/Operations.ts';

describe('operations', () => {
  it('lists every operation of the API document with a unique path-derived name', () => {
    expect(operations.length).toBe(68);
    expect(new Set(operations.map((candidate) => candidate.name)).size).toBe(68);
    expect(operation('schedules_list').path).toBe('/api/schedule/schedules.list');
    expect(operation('resources_show_activity_rates').group).toBe('Directory');
    expect(operation('day_tasks_submit_for_contributor').readOnly).toBe(false);
  });

  it('classifies reads and deletions from the verb', () => {
    const reads = operations.filter((candidate) => candidate.readOnly);
    const deletions = operations.filter((candidate) => candidate.destructive);

    expect(reads.map((candidate) => candidate.name)).toContain('teams_list');
    expect(reads.map((candidate) => candidate.name)).toContain('resources_show_teams');
    expect(reads.every((candidate) => !candidate.destructive)).toBe(true);
    expect(deletions.map((candidate) => candidate.name)).toContain('schedules_delete');
    expect(deletions.every((candidate) => candidate.name.includes('delete'))).toBe(true);
  });

  it('knows which operations answer with a body', () => {
    expect(operation('schedules_list').success).toBeDefined();
    expect(operation('schedules_update').success).toBeUndefined();
    expect(operation('teams_list').description).toMatch(/team/iu);
  });

  it('rejects unknown names', () => {
    expect(() => operation('nope')).toThrow(/no operation named nope/u);
  });
});
