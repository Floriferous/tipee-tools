// The tools against the fake Tipee, called the way the MCP server calls them
// (decode parameters, run the handler, encode the result).

import { describe, expect, it, layer } from '@effect/vitest';
import { TipeeClient, operations } from '@tipee-tools/core';
import { API_KEY, BASE, server } from '@tipee-tools/core/testing';
import { Context, Effect, Layer, Redacted } from 'effect';
import { Tool } from 'effect/ai';
import { FetchHttpClient } from 'effect/http';
import { HttpResponse, http } from 'msw/http';

import { Telemetry, TipeeToolkit, TipeeToolkitLayer, Updates } from '../src/index.ts';
import { call, clientFor } from './toolkit.ts';

const CHLOE = '1000000000000000104';
const WEEK = '2026-09-07/2026-09-13';
const HTTP_NO_CONTENT = 204;

const HTTP_CONFLICT = 409;

interface Recorded {
  readonly event: string;
  readonly properties: Record<string, unknown>;
}
const recorded: Array<Recorded> = [];
const recording = Layer.succeed(Telemetry, {
  capture: (event, properties) =>
    Effect.sync(() => {
      recorded.push({ event, properties: { ...properties } });
    }),
  exception: (error, { handled, properties }) =>
    Effect.sync(() => {
      recorded.push({
        event: '$exception',
        properties: { ...properties, handled, message: String(error) },
      });
    }),
  flush: Effect.void,
});
const recordingClient = TipeeToolkitLayer.pipe(
  Layer.provide(TipeeClient.layer({ apiKey: Redacted.make(API_KEY), instance: 'acme' })),
  Layer.provide(recording),
  Layer.provide(Updates.layerNone),
  Layer.provide(FetchHttpClient.layer),
);

layer(recordingClient)('telemetry of a tool call', (it) => {
  it.effect('records the outcome and reason, never the parameters or the answer', () =>
    Effect.gen(function* () {
      recorded.length = 0;
      server.use(
        http.post(`${BASE}/api/schedule/schedules.list`, () => HttpResponse.json([{}]), {
          once: true,
        }),
      );
      yield* call('teams_list', {});
      yield* Effect.flip(call('schedules_list', { date_range: WEEK }));

      expect(recorded.map((entry) => entry.event)).toEqual([
        'session_started',
        'tool_called',
        'tool_called',
        '$exception',
      ]);
      expect(recorded[1]?.properties).toMatchObject({ outcome: 'ok', tool: 'teams_list' });
      expect(recorded[1]?.properties.duration_ms).toBeTypeOf('number');
      expect(recorded[2]?.properties).toMatchObject({
        outcome: 'failed',
        reason: 'UnexpectedShape',
        tool: 'schedules_list',
      });
      expect(recorded[3]?.properties).toMatchObject({ handled: true, tool: 'schedules_list' });
      expect(recorded[3]?.properties.message).toMatch(/does not match/u);
      expect(JSON.stringify(recorded)).not.toContain(WEEK);
      expect(JSON.stringify(recorded)).not.toContain('Opérations');
    }),
  );

  it.effect('records the status and code of a refusal', () =>
    Effect.gen(function* () {
      recorded.length = 0;
      server.use(
        http.post(
          `${BASE}/api/schedule/schedules.delete`,
          () =>
            HttpResponse.json(
              { description: 'Some schedules are locked.', warning_type: 'locked_schedules' },
              { status: HTTP_CONFLICT },
            ),
          { once: true },
        ),
      );
      yield* Effect.flip(
        call('schedules_delete', { ids: ['1'], options: { group_action: 'single' } }),
      );

      expect(recorded.at(-1)?.properties).toMatchObject({
        error_code: 'locked_schedules',
        http_status: HTTP_CONFLICT,
        outcome: 'failed',
        reason: 'Rejected',
        tool: 'schedules_delete',
      });
      expect(JSON.stringify(recorded)).not.toContain('Some schedules are locked');
    }),
  );

  it.effect('check reports a response shape that changed, and still succeeds', () =>
    Effect.gen(function* () {
      recorded.length = 0;
      server.use(
        http.post(
          `${BASE}/api/schedule/schedule-templates.list`,
          () => HttpResponse.json([{ id: 'not-a-template' }]),
          { once: true },
        ),
      );
      const report = (yield* call('check', {})) as { ok: boolean };

      expect(report.ok).toBe(false);
      // No second session_started: the test above already opened this one.
      expect(recorded.map((entry) => entry.event)).toEqual(['$exception', 'tool_called']);
      expect(recorded[0]?.properties).toMatchObject({ handled: true, tool: 'check' });
      expect(recorded[1]?.properties).toMatchObject({ outcome: 'ok', tool: 'check' });
    }),
  );
});

describe('toolkit', () => {
  it('has one tool per operation of the API document, plus check', () => {
    const tools = Object.values(TipeeToolkit.tools);

    expect(tools).toHaveLength(operations.length + 2);
    expect(tools.map((tool) => tool.name)).toContain('schedules_create');
    expect(tools.map((tool) => tool.name)).toContain('day_tasks_submit_for_contributor');
    expect(tools.map((tool) => tool.name)).toContain('check');
  });

  it('marks reads read-only and deletions destructive, from the document', () => {
    for (const target of operations) {
      const tool = TipeeToolkit.tools[target.name as keyof typeof TipeeToolkit.tools];
      if (tool === undefined) {
        throw new Error(`no tool for ${target.name}`);
      }

      expect(Context.get(tool.annotations, Tool.Readonly)).toBe(target.readOnly);
      expect(Context.get(tool.annotations, Tool.Destructive)).toBe(target.destructive);
    }
    expect(Context.get(TipeeToolkit.tools.check.annotations, Tool.Readonly)).toBe(true);
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
      expect(shifts.every((shift) => shift.resource_id === CHLOE)).toBe(true);
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
  it.effect('surface the Tipee error so the model reads the explanation', () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(call('teams_list', {}));

      expect(String(error)).toMatch(
        /refused the API key \(HTTP 401\): Le jeton fourni est invalide\./u,
      );
    }).pipe(Effect.provide(clientFor('wrong'))),
  );
});
