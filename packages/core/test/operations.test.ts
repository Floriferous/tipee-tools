// The operation catalogue is read off the generated API: every endpoint in
// Tipee's document is there, named after its path, classified by verb.

import { readFileSync, readdirSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { toolName, toolRoutes, vendored } from '../scripts/spec.ts';
import { TIPEE_API_VERSION } from '../src/index.ts';
import { operation, operations } from '../src/Operations.ts';

const SPEC = new URL('../spec/', import.meta.url);

describe('operations', () => {
  it('lists every operation of the API document with a unique path-derived name', () => {
    const names = operations.map((candidate) => candidate.name);

    expect(new Set(names)).toEqual(
      new Set(toolRoutes(vendored().document).map((route) => toolName(route))),
    );
    expect(new Set(names).size).toBe(operations.length);
    expect(operation('schedules_list').path).toBe('/api/schedule/schedules.list');
    expect(operation('resources_show_activity_rates').group).toBe('Directory');
    expect(operation('day_tasks_submit_for_contributor').readOnly).toBe(false);
  });

  it('classifies reads, creates and the other writes from the verb', () => {
    const reads = operations.filter((candidate) => candidate.readOnly);
    const writes = operations.filter((candidate) => !candidate.readOnly);
    const creates = writes.filter((candidate) => candidate.name.endsWith('_create'));

    expect(reads.map((candidate) => candidate.name)).toContain('teams_list');
    expect(reads.map((candidate) => candidate.name)).toContain('resources_show_teams');
    expect(reads.every((candidate) => !candidate.destructive)).toBe(true);
    expect(creates.map((candidate) => candidate.name)).toContain('schedules_create');
    expect(creates.every((candidate) => !candidate.destructive)).toBe(true);
    // MCP reads destructiveHint false as "only adds": updates, cancellations
    // and unassignments all change what is there.
    expect(
      writes.filter((candidate) => !creates.includes(candidate)).every((one) => one.destructive),
    ).toBe(true);
    expect(operation('teams_disable').destructive).toBe(true);
  });

  it('knows which operations answer with a body', () => {
    expect(operation('schedules_list').success).toBeDefined();
    expect(operation('schedules_update').success).toBeUndefined();
    expect(operation('teams_list').description).toMatch(/team/iu);
  });

  // An admin changes rights in Tipee; a refresh of the document must not
  // hand Claude the power to raise anyone's, its own integration's included.
  it('never offers to grant or revoke roles', () => {
    expect(
      operations.filter((candidate) => /grant_roles|revoke_roles/u.test(candidate.name)),
    ).toEqual([]);
    expect(operation('resources_list_roles').readOnly).toBe(true);
  });

  it('is generated from the document of the API version the client sends', () => {
    const [spec, ...others] = readdirSync(SPEC).filter((file) => file.endsWith('.json'));
    const document = JSON.parse(readFileSync(new URL(spec ?? '', SPEC), 'utf8')) as {
      info: { version: string };
    };

    expect(others).toEqual([]);
    expect(document.info.version).toBe(TIPEE_API_VERSION);
    expect(spec).toBe(`tipee-${TIPEE_API_VERSION}.json`);
  });

  it('rejects unknown names', () => {
    expect(() => operation('nope')).toThrow(/no operation named nope/u);
  });
});
