// The operation catalogue is read off the generated API: every endpoint in
// tipee's document is there, named after its path, classified by verb.

import { layer as nodeServices } from '@effect/platform-node/NodeServices';
import { expect, layer } from '@effect/vitest';
import { Array as Arr, Effect, FileSystem, Path, String as Str } from 'effect';

import { specDirectory, toolName, toolRoutes, vendored } from '../scripts/spec.ts';
import { TIPEE_API_VERSION } from '../src/index.ts';
import { operation, operations } from '../src/Operations.ts';

const names = Arr.map(operations, (candidate) => candidate.name);

layer(nodeServices)('operations', (it) => {
  it.effect('lists every operation of the API document with a unique path-derived name', () =>
    Effect.gen(function* () {
      const { document } = yield* vendored();

      expect(new Set(names)).toEqual(new Set(Arr.map(toolRoutes(document), toolName)));
      expect(new Set(names).size).toBe(operations.length);
      expect(operation('schedules_list').path).toBe('/api/schedule/schedules.list');
      expect(operation('resources_show_activity_rates').group).toBe('Directory');
      expect(operation('day_tasks_submit_for_contributor').readOnly).toBe(false);
    }),
  );

  it('classifies reads, creates and the other writes from the verb', () => {
    const reads = Arr.filter(operations, (candidate) => candidate.readOnly);
    const writes = Arr.filter(operations, (candidate) => !candidate.readOnly);
    const creates = Arr.filter(writes, (candidate) => Str.endsWith('_create')(candidate.name));
    const readNames = Arr.map(reads, (candidate) => candidate.name);

    expect(readNames).toContain('teams_list');
    expect(readNames).toContain('resources_show_teams');
    expect(Arr.every(reads, (candidate) => !candidate.destructive)).toBe(true);
    expect(Arr.map(creates, (candidate) => candidate.name)).toContain('schedules_create');
    expect(Arr.every(creates, (candidate) => !candidate.destructive)).toBe(true);
    // MCP reads destructiveHint false as "only adds": updates, cancellations
    // and unassignments all change what is there.
    expect(Arr.every(Arr.difference(writes, creates), (one) => one.destructive)).toBe(true);
    expect(operation('teams_disable').destructive).toBe(true);
  });

  it('knows which operations answer with a body', () => {
    expect(operation('schedules_list').success).toBeDefined();
    expect(operation('schedules_update').success).toBeUndefined();
    expect(operation('teams_list').description).toMatch(/team/iu);
  });

  // An admin changes rights and passwords in tipee, and shift templates are
  // history: a refresh of the document must not hand Claude any of these.
  it('never offers to grant or revoke roles, force a password change or delete a template', () => {
    expect(
      Arr.filter(operations, (candidate) =>
        /grant_roles|revoke_roles|must_change_password|schedule_templates_delete/u.test(
          candidate.name,
        ),
      ),
    ).toEqual([]);
    expect(operation('resources_list_roles').readOnly).toBe(true);
  });

  it.effect('is generated from the document of the API version the client sends', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* specDirectory;
      const files = yield* fs.readDirectory(directory);
      const specs = Arr.filter(files, Str.endsWith('.json'));
      const { document, file } = yield* vendored();

      expect(specs).toEqual([`tipee-${TIPEE_API_VERSION}.json`]);
      expect(document.info.version).toBe(TIPEE_API_VERSION);
      expect(path.basename(file)).toBe(`tipee-${TIPEE_API_VERSION}.json`);
    }),
  );

  it('rejects unknown names', () => {
    expect(() => operation('nope')).toThrow(/no operation named nope/u);
  });
});
