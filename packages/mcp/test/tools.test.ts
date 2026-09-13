// The tools against the fake Tipee, called the way the MCP server calls them
// (decode parameters, run the handler, encode the result).

import { describe, expect, it, layer } from '@effect/vitest';
import { TipeeClient, operations } from '@tipee-tools/core';
import { API_KEY, BASE, INTEGRATION_ID, server } from '@tipee-tools/core/testing';
import { Context, Effect, Layer, Option, Redacted, Stream } from 'effect';
import { Tool } from 'effect/unstable/ai';
import { FetchHttpClient } from 'effect/unstable/http';
import { HttpResponse, http } from 'msw';

import { Telemetry, TipeeToolkit, TipeeToolkitLayer } from '../src/index.ts';

const CHLOE = '1000000000000000104';
const WEEK = '2026-09-07/2026-09-13';
const HTTP_NO_CONTENT = 204;
const HTTP_FORBIDDEN = 403;

const clientFor = (apiKey: string) =>
  TipeeToolkitLayer.pipe(
    Layer.provide(TipeeClient.layer({ apiKey: Redacted.make(apiKey), instance: 'acme' })),
    Layer.provide(Telemetry.layerOff),
    Layer.provide(FetchHttpClient.layer),
  );

// Runs a tool as the server does and returns the JSON it would send back.
type Handled = Effect.Effect<Stream.Stream<{ readonly encodedResult: unknown }, unknown>, unknown>;

const call = Effect.fn('call')(function* (name: string, params: unknown) {
  const toolkit = yield* TipeeToolkit;
  const handled = toolkit.handle(name as never, params) as unknown as Handled;
  const last = yield* handled.pipe(Stream.unwrap, Stream.runLast);
  return Option.getOrThrow(last).encodedResult;
});

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
  exception: (type, message, properties) =>
    Effect.sync(() => {
      recorded.push({ event: '$exception', properties: { ...properties, message, type } });
    }),
  flush: Effect.void,
});
const recordingClient = TipeeToolkitLayer.pipe(
  Layer.provide(TipeeClient.layer({ apiKey: Redacted.make(API_KEY), instance: 'acme' })),
  Layer.provide(recording),
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
        'tool_called',
        'tool_called',
        '$exception',
      ]);
      expect(recorded[0]?.properties).toMatchObject({ outcome: 'ok', tool: 'teams_list' });
      expect(recorded[0]?.properties.duration_ms).toBeTypeOf('number');
      expect(recorded[1]?.properties).toMatchObject({
        outcome: 'failed',
        reason: 'UnexpectedShape',
        tool: 'schedules_list',
      });
      expect(recorded[2]?.properties).toMatchObject({
        tool: 'schedules_list',
        type: 'TipeeUnexpectedShape',
      });
      expect(JSON.stringify(recorded)).not.toContain(WEEK);
      expect(JSON.stringify(recorded)).not.toContain('Opérations');
    }),
  );
});

describe('toolkit', () => {
  it('has one tool per operation of the API document, plus check', () => {
    const tools = Object.values(TipeeToolkit.tools);

    expect(tools).toHaveLength(operations.length + 1);
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

  it.effect('check reports every probed endpoint ok, over the coming week by default', () =>
    Effect.gen(function* () {
      const report = (yield* call('check', {})) as {
        ok: boolean;
        date_range: string;
        endpoints: Array<{ name: string; status: string }>;
        integration?: { label: string; roles_page: string };
      };

      expect(report.ok).toBe(true);
      // The test clock starts at the epoch.
      expect(report.date_range).toBe('1970-01-01/1970-01-07');
      expect(report.endpoints.map((endpoint) => endpoint.name)).toEqual([
        'kinds_list',
        'resources_list',
        'teams_list',
        'schedule_templates_list',
        'schedules_list',
        'absences_list',
        'on_calls_list',
        'resources_show_activity_rates',
        'timechecks_list',
      ]);
      expect(report.integration).toEqual({
        label: 'Claude',
        roles_page: `https://acme.tipee.net/hr-core/profile/${INTEGRATION_ID}/roles`,
      });
    }),
  );

  it.effect('check skips an endpoint whose module is off, and stays ok', () =>
    Effect.gen(function* () {
      server.use(
        http.post(
          `${BASE}/api/timeclock/timechecks.list`,
          () =>
            HttpResponse.json(
              { message: "Module 'Saisie des heures' is required and it is not activated." },
              { status: HTTP_FORBIDDEN },
            ),
          { once: true },
        ),
      );
      const report = (yield* call('check', {})) as {
        ok: boolean;
        endpoints: Array<{ name: string; status: string; error?: string }>;
      };
      const timechecks = report.endpoints.find((endpoint) => endpoint.name === 'timechecks_list');

      expect(report.ok).toBe(true);
      expect(timechecks?.status).toBe('skipped');
      expect(timechecks?.error).toMatch(/Saisie des heures/u);
    }),
  );

  it.effect('check flags an endpoint whose response no longer matches', () =>
    Effect.gen(function* () {
      server.use(
        http.post(
          `${BASE}/api/schedule/schedule-templates.list`,
          () => HttpResponse.json([{ id: 'not-a-template' }]),
          { once: true },
        ),
      );
      const report = (yield* call('check', { from: '2026-09-07', to: '2026-09-13' })) as {
        ok: boolean;
        endpoints: Array<{ name: string; status: string; error?: string }>;
      };
      const templates = report.endpoints.find(
        (endpoint) => endpoint.name === 'schedule_templates_list',
      );

      expect(report.ok).toBe(false);
      expect(templates?.status).toBe('failed');
      expect(templates?.error).toMatch(/does not match/u);
    }),
  );
});

describe('failures', () => {
  it.effect('surface the Tipee error so the model reads the explanation', () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(call('teams_list', {}));

      expect(String(error)).toMatch(/rejected the API key/u);
    }).pipe(Effect.provide(clientFor('wrong'))),
  );
});
