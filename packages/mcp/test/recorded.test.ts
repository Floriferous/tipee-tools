// What the telemetry records of a tool call, against the fake tipee: the
// tool, its outcome and reason, and for a failure the names (never the
// values) of the fields concerned and of the parameters sent.

import { expect, layer } from '@effect/vitest';
import { TipeeClient } from '@tipee-tools/core';
import { API_KEY, BASE, server } from '@tipee-tools/core/testing';
import { Effect, Layer, Redacted } from 'effect';
import { FetchHttpClient } from 'effect/http';
import { HttpResponse, http } from 'msw/http';

import { SERVER_VERSION, Telemetry, TipeeToolkitLayer, Updates } from '../src/index.ts';
import { call } from './toolkit.ts';

const CHLOE = '1000000000000000104';
const WEEK = '2026-09-07/2026-09-13';
const HTTP_CONFLICT = 409;
const HTTP_GONE = 410;
const HTTP_UNPROCESSABLE = 422;

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
// What a call recorded, without the session event of whichever call came first.
const recordedCalls = (): ReadonlyArray<Recorded> =>
  recorded.filter((entry) => entry.event !== 'session_started');
const recordingClient = TipeeToolkitLayer.pipe(
  Layer.provide(TipeeClient.layer({ apiKey: Redacted.make(API_KEY), instance: 'acme' })),
  Layer.provide(recording),
  Layer.provide(Updates.layerNone(SERVER_VERSION)),
  Layer.provide(FetchHttpClient.layer),
);

// A layer of its own, so its first call is the session's first.
layer(recordingClient)('telemetry of a session', (it) => {
  it.effect('reports the session on the first tool call only', () =>
    Effect.gen(function* () {
      recorded.length = 0;
      yield* call('teams_list', {});
      yield* call('teams_list', {});

      expect(recorded.map((entry) => entry.event)).toEqual([
        'session_started',
        'tool_called',
        'tool_called',
      ]);
    }),
  );
});

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
      const calls = recordedCalls();

      expect(calls.map((entry) => entry.event)).toEqual([
        'tool_called',
        'tool_called',
        '$exception',
      ]);
      expect(calls[0]?.properties).toMatchObject({ outcome: 'ok', tool: 'teams_list' });
      expect(calls[0]?.properties.duration_ms).toBeTypeOf('number');
      expect(calls[1]?.properties).toMatchObject({
        outcome: 'failed',
        reason: 'UnexpectedShape',
        tool: 'schedules_list',
      });
      expect(calls[2]?.properties).toMatchObject({ handled: true, tool: 'schedules_list' });
      expect(calls[2]?.properties.message).toMatch(/does not match/u);
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

      expect(recordedCalls().at(-1)?.properties).toMatchObject({
        error_code: 'locked_schedules',
        http_status: HTTP_CONFLICT,
        outcome: 'failed',
        reason: 'Rejected',
        tool: 'schedules_delete',
      });
      expect(JSON.stringify(recorded)).not.toContain('Some schedules are locked');
    }),
  );

  it.effect('records the fields a validation error names and the parameters sent', () =>
    Effect.gen(function* () {
      recorded.length = 0;
      server.use(
        http.post(
          `${BASE}/api/schedule/schedules.delete`,
          () =>
            HttpResponse.json(
              {
                detail: 'options.group_action: The value Chloé chose is not valid.',
                status: HTTP_UNPROCESSABLE,
                title: 'Validation Failed',
              },
              { status: HTTP_UNPROCESSABLE },
            ),
          { once: true },
        ),
      );
      yield* Effect.flip(
        call('schedules_delete', { ids: [CHLOE], options: { group_action: 'single' } }),
      );
      const calls = recordedCalls();

      expect(calls.map((entry) => entry.event)).toEqual(['tool_called', '$exception']);
      expect(calls[0]?.properties).toMatchObject({
        error_fields: ['options.group_action'],
        http_status: HTTP_UNPROCESSABLE,
        params_sent: ['ids', 'options.group_action'],
        reason: 'Rejected',
      });
      expect(calls[1]?.properties).toMatchObject({
        handled: true,
        params_sent: ['ids', 'options.group_action'],
        tool: 'schedules_delete',
      });
      // Names only: neither the values sent nor what tipee said.
      const { message: _said, ...kept } = calls[1]?.properties ?? {};
      expect(JSON.stringify([calls[0], kept])).not.toMatch(/Chloé|single|1000000000000000104/u);
    }),
  );

  it.effect('records each item of a batch as a call of its operation, via the batch', () =>
    Effect.gen(function* () {
      recorded.length = 0;
      let sent = 0;
      server.use(
        http.post(`${BASE}/api/schedule/schedules.update`, () => {
          sent += 1;
          return sent === 2
            ? HttpResponse.json(
                { description: 'Some schedules are locked.', warning_type: 'locked_schedules' },
                { status: HTTP_CONFLICT },
              )
            : new HttpResponse(undefined, { status: 204 });
        }),
      );
      yield* call('schedules_update_many', { items: [{ id: '1' }, { id: '2' }, { id: '3' }] });

      const calls = recordedCalls();

      expect(
        calls.map(({ properties }) => [
          properties.tool,
          properties.via,
          properties.index,
          properties.outcome,
          properties.error_code,
        ]),
      ).toEqual([
        ['schedules_update', 'schedules_update_many', 0, 'ok', undefined],
        ['schedules_update', 'schedules_update_many', 1, 'failed', 'locked_schedules'],
        ['schedules_update_many', undefined, undefined, 'ok', undefined],
      ]);
      // The batch's own event counts how it ended, numbers only.
      expect(calls[2]?.properties).toMatchObject({
        applied: 1,
        items: 3,
        not_sent: 1,
        stopped_by: 'failure_not_applied',
      });
      expect(JSON.stringify(recorded)).not.toContain('Some schedules are locked');
    }),
  );

  it.effect('reports a batch whose first item fails once, on the item', () =>
    Effect.gen(function* () {
      recorded.length = 0;
      server.use(
        http.post(
          `${BASE}/api/schedule/schedules.update`,
          () =>
            HttpResponse.json(
              { detail: 'id: This schedule does not exist.', status: HTTP_UNPROCESSABLE },
              { status: HTTP_UNPROCESSABLE },
            ),
          { once: true },
        ),
      );
      yield* Effect.flip(call('schedules_update_many', { items: [{ id: '1' }, { id: '2' }] }));
      const calls = recordedCalls();

      expect(calls.map((entry) => [entry.event, entry.properties.tool])).toEqual([
        ['tool_called', 'schedules_update'],
        ['$exception', 'schedules_update'],
        ['tool_called', 'schedules_update_many'],
      ]);
      expect(calls[2]?.properties).toMatchObject({ outcome: 'failed', reason: 'Rejected' });
      expect(calls[2]?.properties).not.toHaveProperty('error_fields');
      expect(calls[2]?.properties).not.toHaveProperty('params_sent');
    }),
  );

  it.effect('records an instance that does not exist, without reporting an exception', () =>
    Effect.gen(function* () {
      recorded.length = 0;
      server.use(
        http.post(
          `${BASE}/api/directory/teams.list`,
          () => HttpResponse.json({ error: 'instance_not_found' }, { status: HTTP_GONE }),
          { once: true },
        ),
      );
      yield* Effect.flip(call('teams_list', {}));
      const calls = recordedCalls();

      expect(calls.map((entry) => entry.event)).toEqual(['tool_called']);
      expect(calls[0]?.properties).toMatchObject({
        outcome: 'failed',
        reason: 'InstanceNotFound',
        tool: 'teams_list',
      });
    }),
  );

  it.effect('check_setup reports a response shape that changed, and still succeeds', () =>
    Effect.gen(function* () {
      recorded.length = 0;
      server.use(
        http.post(
          `${BASE}/api/schedule/schedule-templates.list`,
          () => HttpResponse.json([{ id: 'not-a-template' }]),
          { once: true },
        ),
      );
      const report = (yield* call('check_setup', {})) as { ok: boolean };
      const calls = recordedCalls();

      expect(report.ok).toBe(false);
      expect(calls.map((entry) => entry.event)).toEqual(['$exception', 'tool_called']);
      expect(calls[0]?.properties).toMatchObject({ handled: true, tool: 'check_setup' });
      expect(calls[1]?.properties).toMatchObject({ outcome: 'ok', tool: 'check_setup' });
    }),
  );
});
