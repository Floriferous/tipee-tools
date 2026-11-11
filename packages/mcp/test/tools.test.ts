// The tools against the fake tipee, called the way the MCP server calls them
// (decode parameters, run the handler, encode the result).

import { describe, expect, it, layer } from '@effect/vitest';
import { operations } from '@tipee-tools/core';
import { API_KEY, BASE, server } from '@tipee-tools/core/testing';
import { Array as Arr, Context, Effect, Record as Rec, String as Str } from 'effect';
import { Tool } from 'effect/ai';
import { HttpResponse, http } from 'msw/http';

import { BATCHED, TipeeToolkit } from '../src/index.ts';
import { call, clientFor } from './toolkit.ts';

const CHLOE = '1000000000000000104';
const WEEK = '2026-09-07/2026-09-13';
const HTTP_NO_CONTENT = 204;

describe('toolkit', () => {
  it('has one tool per operation, a batch tool per batched one, check_setup and update_plugin', () => {
    const tools = Rec.values(TipeeToolkit.tools);
    const names = Arr.map(tools, (tool) => tool.name);

    expect(tools).toHaveLength(operations.length + BATCHED.length + 2);
    expect(names).toContain('schedules_create');
    expect(names).toContain('day_tasks_submit_for_contributor');
    expect(names).toContain('check_setup');
    expect(names).toContain('update_plugin');
  });

  it('marks reads read-only and every write but a create destructive', () => {
    for (const target of operations) {
      const tool = TipeeToolkit.tools[target.name as keyof typeof TipeeToolkit.tools];
      if (tool === undefined) {
        throw new Error(`no tool for ${target.name}`);
      }

      expect(Context.get(tool.annotations, Tool.Readonly)).toBe(target.readOnly);
      expect(Context.get(tool.annotations, Tool.Destructive)).toBe(target.destructive);
    }
    expect(Context.get(TipeeToolkit.tools.check_setup.annotations, Tool.Readonly)).toBe(true);
    expect(Context.get(TipeeToolkit.tools.update_plugin.annotations, Tool.Destructive)).toBe(true);
  });

  it('asks for a yes before every write, and says a deletion cannot be undone', () => {
    const descriptions = new Map(
      Arr.map(Rec.values(TipeeToolkit.tools), (tool) => [tool.name, Tool.getDescription(tool)]),
    );
    const descriptionOf = (name: string): string => descriptions.get(name) ?? '';

    for (const target of operations) {
      const description = descriptionOf(target.name);
      expect(Str.includes('wait for their yes')(description)).toBe(!target.readOnly);
      expect(Str.endsWith('It cannot be undone.')(description)).toBe(/\.delete/u.test(target.path));
      expect(description).not.toMatch(/[^.!?] Changes tipee:/u);
    }
    expect(descriptionOf('resources_create')).toContain('. Changes tipee:');
  });

  it('makes every tool strict', () => {
    for (const tool of Rec.values(TipeeToolkit.tools)) {
      expect(Tool.getStrictMode(tool)).toBe(true);
    }
  });
});

layer(clientFor(API_KEY))('tools', (it) => {
  it.effect('schedules_list filters by people', () =>
    Effect.gen(function* () {
      const shifts = (yield* call('schedules_list', {
        date_range: WEEK,
        resource_ids: [CHLOE],
      })) as Array<{
        resource_id: string;
      }>;

      expect(shifts.length).toBeGreaterThan(0);
      expect(Arr.every(shifts, (shift) => shift.resource_id === CHLOE)).toBe(true);
    }),
  );

  it.effect('a write that answers with no content returns done', () =>
    Effect.gen(function* () {
      server.use(
        http.post(
          `${BASE}/api/schedule/schedules.update`,
          () => new HttpResponse(null, { status: HTTP_NO_CONTENT }),
          {
            once: true,
          },
        ),
      );
      const result = yield* call('schedules_update', {
        id: '1000000000000000126',
        remark: 'moved',
      });

      expect(result).toEqual({ done: true });
    }),
  );
});

describe('failures', () => {
  layer(clientFor(API_KEY))((it) => {
    it.effect('refuse a misspelled key before anything reaches tipee', () =>
      Effect.gen(function* () {
        let sent = 0;
        server.use(
          http.post(`${BASE}/api/schedule/absences.update`, () => {
            sent += 1;
            return HttpResponse.json({
              failed: [],
              failed_count: 0,
              updated: [],
              updated_count: 1,
            });
          }),
        );
        const error = yield* Effect.flip(
          call('absences_update', {
            id: '1',
            options: { alow_partial: true, group_action: 'single' },
            percentage: 50,
          }),
        );

        expect(sent).toBe(0);
        expect(String(error)).toContain('["options"]["alow_partial"]');
      }),
    );
  });

  layer(clientFor('wrong'))((it) => {
    it.effect('surface the tipee error so the model reads the explanation', () =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(call('teams_list', {}));

        expect(String(error)).toMatch(
          /refused the API key \(HTTP 401\): Le jeton fourni est invalide\./u,
        );
      }),
    );
  });
});
