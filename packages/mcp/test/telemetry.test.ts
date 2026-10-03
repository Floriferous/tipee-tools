// What leaves the machine: the instance, the channel and an installation id,
// Never the key. The fake PostHog records the batches it receives; the
// Assertions read them, never the requests.

import { homedir } from 'node:os';

import { beforeEach, describe, expect, it } from '@effect/vitest';
import {
  Rejected,
  TIPEE_API_VERSION,
  TipeeError,
  UnexpectedShape,
  UnexpectedStatus,
} from '@tipee-tools/core';
import { server } from '@tipee-tools/core/testing';
import { Cause, ConfigProvider, Effect, Layer } from 'effect';
import { FetchHttpClient } from 'effect/http';
import { HttpResponse, http } from 'msw/http';

import { Telemetry, framesOf, reportCrash } from '../src/index.ts';

const POSTHOG = 'https://posthog.test';
const KEY = 'phc_test';
const INSTANCE = 'acme';
const API_KEY = 'super-secret-key';

interface Batch {
  readonly api_key: string;
  readonly batch: Array<{
    readonly event: string;
    readonly distinct_id: string;
    readonly properties: Record<string, unknown>;
  }>;
}

const received: Array<Batch> = [];
const fakePostHog = http.post(`${POSTHOG}/batch`, async ({ request }) => {
  received.push((await request.json()) as Batch);
  return HttpResponse.json({ status: 1 });
});

const telemetryWith = (env: Record<string, string>) =>
  Telemetry.layer({ server_version: '0.0.0-test' }).pipe(
    Layer.provide(
      Layer.mergeAll(
        FetchHttpClient.layer,
        ConfigProvider.layer(
          ConfigProvider.fromUnknown({
            TIPEE_API_KEY: API_KEY,
            TIPEE_INSTANCE: INSTANCE,
            TIPEE_POSTHOG_HOST: POSTHOG,
            TIPEE_POSTHOG_KEY: KEY,
            ...env,
          }),
        ),
      ),
    ),
  );

const record = (env: Record<string, string> = {}) =>
  Effect.gen(function* () {
    const telemetry = yield* Telemetry;
    yield* telemetry.capture('session_started');
    yield* telemetry.capture('tool_called', { outcome: 'ok', tool: 'teams_list' });
    yield* telemetry.exception(new RangeError('synthetic'), {
      handled: false,
      properties: { tool: 'schedules_delete' },
    });
    yield* telemetry.flush;
  }).pipe(Effect.provide(telemetryWith(env)), Effect.scoped);

describe('telemetry', () => {
  beforeEach(() => {
    received.length = 0;
    server.use(fakePostHog);
  });

  it.effect('batches anonymous events to PostHog', () =>
    Effect.gen(function* () {
      // Grouped under the instance however it was typed.
      yield* record({ TIPEE_INSTANCE: ' https://Acme.tipee.net/ ' });

      expect(received).toHaveLength(1);
      const [batch] = received;
      expect(batch?.api_key).toBe(KEY);
      expect(batch?.batch.map((event) => event.event)).toEqual([
        'session_started',
        'tool_called',
        '$exception',
      ]);
      const [first, , exception] = batch?.batch ?? [];
      expect(first?.distinct_id).toMatch(/^[0-9a-f-]{36}$/u);
      expect(first?.properties).toMatchObject({
        $groups: { instance: INSTANCE },
        $lib: 'tipee-mcp',
        $set: { channel: 'dev', instance: INSTANCE, server_version: '0.0.0-test' },
        channel: 'dev',
        instance: INSTANCE,
        server_version: '0.0.0-test',
      });
      for (const event of batch?.batch ?? []) {
        expect(event.properties.tipee_api_version).toBe(TIPEE_API_VERSION);
      }
      expect(first?.properties.launch_id).toBe(exception?.properties.launch_id);
      const [listed] = (exception?.properties.$exception_list ?? []) as Array<{
        type: string;
        value: string;
        mechanism: { handled: boolean };
        stacktrace: { frames: Array<{ filename: string; in_app: boolean }> };
      }>;
      expect(listed).toMatchObject({
        mechanism: { handled: false },
        type: 'RangeError',
        value: 'synthetic',
      });
      expect(listed?.stacktrace.frames.length).toBeGreaterThan(0);
      expect(listed?.stacktrace.frames.some((frame) => frame.in_app)).toBe(true);
      expect(JSON.stringify(listed)).not.toContain(homedir());
      const wire = JSON.stringify(received);
      expect(wire).not.toContain(API_KEY);
    }),
  );

  it.effect('reports a Tipee failure by reason, status and paths, never by what Tipee said', () =>
    Effect.gen(function* () {
      const failures = [
        new UnexpectedStatus({ body: 'Alice Martin is on leave', status: 502 }),
        new UnexpectedShape({ details: 'Expected string, got "Alice Martin"\n  at [0]["label"]' }),
        new Rejected({ body: 'Alice Martin overlaps', code: 'OVERLAPPING', status: 409 }),
      ];
      yield* Effect.gen(function* () {
        const telemetry = yield* Telemetry;
        for (const reason of failures) {
          yield* telemetry.exception(new TipeeError({ reason }), { handled: true });
        }
        yield* telemetry.flush;
      }).pipe(Effect.provide(telemetryWith({})), Effect.scoped);

      const values = received
        .flatMap((batch) => batch.batch)
        .map((event) => (event.properties.$exception_list as Array<{ value: string }>)[0]?.value);
      expect(values).toEqual([
        'UnexpectedStatus (HTTP 502)',
        'UnexpectedShape at [0]["label"]',
        'Rejected (HTTP 409)',
      ]);
      expect(JSON.stringify(received)).not.toContain('Alice');
    }),
  );

  it.effect('keeps the same installation id from one start to the next', () =>
    Effect.gen(function* () {
      // The id comes from the machine and account, not from a file.
      yield* record();
      yield* record();

      const ids = received.map((batch) => batch.batch[0]?.distinct_id);
      expect(ids).toHaveLength(2);
      expect(ids[0]).toBe(ids[1]);
    }),
  );

  it('cuts stack frames down to the bundle or source file', () => {
    const frames = framesOf(
      [
        'Error: boom',
        '    at handle (/Users/someone/Library/Application Support/Claude/Claude Extensions/x/server/tipee-mcp.mjs:41437:16)',
        '    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)',
        '    at /Users/someone/dev/tipee-tools/node_modules/effect/dist/internal/effect.js:12:3',
      ].join('\n'),
    );

    expect(frames).toEqual([
      {
        colno: 16,
        filename: 'server/tipee-mcp.mjs',
        function: 'handle',
        in_app: true,
        lineno: 41_437,
        platform: 'node:javascript',
      },
      {
        colno: 5,
        filename: 'node:internal/process/task_queues',
        function: 'process.processTicksAndRejections',
        in_app: false,
        lineno: 105,
        platform: 'node:javascript',
      },
      {
        colno: 3,
        filename: 'effect.js',
        function: '<anonymous>',
        in_app: false,
        lineno: 12,
        platform: 'node:javascript',
      },
    ]);
  });

  it.effect('reports why the server stopped, from a telemetry of its own', () =>
    Effect.gen(function* () {
      yield* reportCrash(Cause.fail({ _tag: 'ConfigurationMissing' }));
      yield* reportCrash(Cause.die(new TypeError('transport')));

      expect(received.map((batch) => batch.batch.map((event) => event.event))).toEqual([
        ['server_failed'],
        ['$exception'],
      ]);
      expect(received[0]?.batch[0]?.properties.reason).toBe('ConfigurationMissing');
      const [listed] = (received[1]?.batch[0]?.properties.$exception_list ?? []) as Array<{
        type: string;
        mechanism: { handled: boolean };
      }>;
      expect(listed).toMatchObject({ mechanism: { handled: false }, type: 'TypeError' });
    }).pipe(
      Effect.provide(
        ConfigProvider.layer(
          ConfigProvider.fromUnknown({
            TIPEE_POSTHOG_HOST: POSTHOG,
            TIPEE_POSTHOG_KEY: KEY,
          }),
        ),
      ),
    ),
  );
});
