// What leaves the machine: the instance, the channel and an installation id,
// never the key. The fake PostHog records the batches it receives; the
// assertions read them, never the requests.

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
import { Array as Arr, Cause, ConfigProvider, Context, Effect, Layer, Schema } from 'effect';
import { FetchHttpClient } from 'effect/http';
import { HttpResponse, http } from 'msw/http';

import { Telemetry, framesOf, reportCrash } from '../src/index.ts';
import { bodyOf, resolver, toJson } from './wire.ts';

const POSTHOG = 'https://posthog.test';
const KEY = 'phc_test';
const INSTANCE = 'acme';
const API_KEY = 'super-secret-key';

const Batch = Schema.Struct({
  api_key: Schema.String,
  batch: Schema.Array(
    Schema.Struct({
      distinct_id: Schema.String,
      event: Schema.String,
      properties: Schema.Record(Schema.String, Schema.Unknown),
    }),
  ),
});
type Batch = typeof Batch.Type;

const received: Array<Batch> = [];
const batchOf = bodyOf(Batch);
const fakePostHog = http.post(
  `${POSTHOG}/batch`,
  resolver(({ request }) =>
    Effect.map(batchOf(request), (batch) => {
      received.push(batch);
      return HttpResponse.json({ status: 1 });
    }),
  ),
);
const eventsOf = (batch: Batch | undefined) => Arr.map(batch?.batch ?? [], (event) => event.event);

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

// One start of the server: a telemetry of its own, released at the end.
const started = (env: Record<string, string>) =>
  Effect.map(Layer.build(telemetryWith(env)), Context.get(Telemetry));

const record = (env: Record<string, string> = {}) =>
  Effect.gen(function* () {
    const telemetry = yield* started(env);
    yield* telemetry.capture('session_started');
    yield* telemetry.capture('tool_called', { outcome: 'ok', tool: 'teams_list' });
    yield* telemetry.exception(new RangeError('synthetic'), {
      handled: false,
      properties: { tool: 'schedules_delete' },
    });
    yield* telemetry.flush;
  }).pipe(Effect.scoped);

describe('telemetry', () => {
  beforeEach(() => {
    received.length = 0;
    server.use(fakePostHog);
  });

  it.effect('batches pseudonymous events to PostHog', () =>
    Effect.gen(function* () {
      // Grouped under the instance however it was typed.
      yield* record({ TIPEE_INSTANCE: ' https://Acme.tipee.net/ ' });

      expect(received).toHaveLength(1);
      const [batch] = received;
      expect(batch?.api_key).toBe(KEY);
      expect(eventsOf(batch)).toEqual(['session_started', 'tool_called', '$exception']);
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
      expect(Arr.some(listed?.stacktrace.frames ?? [], (frame) => frame.in_app)).toBe(true);
      const listedWire = yield* toJson(listed);
      expect(listedWire).not.toContain(homedir());
      const wire = yield* toJson(received);
      expect(wire).not.toContain(API_KEY);
    }),
  );

  it.effect('reports a tipee failure by reason, status and paths, never by what tipee said', () =>
    Effect.gen(function* () {
      const failures = [
        UnexpectedStatus.make({ body: 'Alice Martin is on leave', status: 502 }),
        UnexpectedShape.make({ details: 'Expected string, got "Alice Martin"\n  at [0]["label"]' }),
        UnexpectedShape.make({ details: 'undeclared status code', status: 201 }),
        Rejected.make({ body: 'Alice Martin overlaps', code: 'OVERLAPPING', status: 409 }),
        Rejected.make({
          body: 'when: Alice Martin is locked',
          fields: ['when', 'options.allow_partial'],
          status: 422,
        }),
      ];
      yield* Effect.gen(function* () {
        const telemetry = yield* started({});
        for (const reason of failures) {
          yield* telemetry.exception(TipeeError.make({ reason }), { handled: true });
        }
        yield* telemetry.flush;
      }).pipe(Effect.scoped);

      const values = Arr.map(
        Arr.flatMap(received, (batch) => batch.batch),
        (event) => (event.properties.$exception_list as Array<{ value: string }>)[0]?.value,
      );
      expect(values).toEqual([
        'UnexpectedStatus (HTTP 502)',
        'UnexpectedShape at [0]["label"]',
        'UnexpectedShape (HTTP 201)',
        'Rejected (HTTP 409, OVERLAPPING)',
        'Rejected (HTTP 422) at when, options.allow_partial',
      ]);
      const wire = yield* toJson(received);
      expect(wire).not.toContain('Alice');
    }),
  );

  it.effect('keeps the same installation id from one start to the next', () =>
    Effect.gen(function* () {
      // The id comes from the machine and account, not from a file.
      yield* record();
      yield* record();

      const ids = Arr.map(received, (batch) => batch.batch[0]?.distinct_id);
      expect(ids).toHaveLength(2);
      expect(ids[0]).toBe(ids[1]);
    }),
  );

  it('cuts stack frames down to the bundle or source file', () => {
    const frames = framesOf(
      Arr.join(
        [
          'Error: boom',
          '    at handle (/Users/someone/Library/Application Support/Claude/Claude Extensions/x/server/tipee-mcp.mjs:41437:16)',
          '    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)',
          '    at /Users/someone/dev/tipee-tools/node_modules/effect/dist/internal/effect.js:12:3',
        ],
        '\n',
      ),
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

      expect(Arr.map(received, eventsOf)).toEqual([['server_failed'], ['$exception']]);
      expect(received[0]?.batch[0]?.properties.reason).toBe('ConfigurationMissing');
      const [listed] = (received[1]?.batch[0]?.properties.$exception_list ?? []) as Array<{
        type: string;
        mechanism: { handled: boolean };
      }>;
      expect(listed).toMatchObject({ mechanism: { handled: false }, type: 'TypeError' });
    }).pipe(
      Effect.provideService(
        ConfigProvider.ConfigProvider,
        ConfigProvider.fromUnknown({ TIPEE_POSTHOG_HOST: POSTHOG, TIPEE_POSTHOG_KEY: KEY }),
      ),
    ),
  );
});
