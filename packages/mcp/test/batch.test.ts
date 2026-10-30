// The `*_many` tools against the fake tipee: items checked before anything
// is sent, sent one after another in order, the batch stopped at the first
// failure or at its deadline, and a report that says exactly what happened.

import { describe, expect, it, layer } from '@effect/vitest';
import { TipeeClient, operations } from '@tipee-tools/core';
import { API_KEY, BASE, server, settled } from '@tipee-tools/core/testing';
import { Context, Effect, Layer, Redacted } from 'effect';
import { Tool } from 'effect/ai';
import { HttpClient, HttpClientResponse } from 'effect/http';
import { HttpResponse, http } from 'msw/http';

import {
  BATCHED,
  MAX_ITEMS,
  SERVER_VERSION,
  Telemetry,
  TipeeToolkit,
  TipeeToolkitLayer,
  Updates,
} from '../src/index.ts';
import type { BatchReport } from '../src/index.ts';
import { call, clientFor } from './toolkit.ts';

const UPDATE_URL = `${BASE}/api/schedule/schedules.update`;
const HTTP_NO_CONTENT = 204;
const HTTP_CONFLICT = 409;
const HTTP_LOOP_DETECTED = 508;

const ids = (count: number): Array<{ id: string }> =>
  Array.from({ length: count }, (_, index) => ({ id: String(index + 1) }));

// Answers schedules.update with `answer(id, attempt)` and records the ids sent, in order.
const scheduleUpdates = (
  answer: (id: string, attempt: number) => Response = () =>
    new HttpResponse(undefined, { status: HTTP_NO_CONTENT }),
): Array<string> => {
  const sent: Array<string> = [];
  server.use(
    http.post(UPDATE_URL, async ({ request }) => {
      const { id } = (await request.json()) as { id: string };
      sent.push(id);
      return answer(id, sent.filter((one) => one === id).length);
    }),
  );
  return sent;
};

const conflict = (): Response =>
  HttpResponse.json(
    { description: 'Some schedules are locked.', warning_type: 'locked_schedules' },
    { status: HTTP_CONFLICT },
  );

describe('batch tools', () => {
  it('exist for the batched operations only, all of them writes', () => {
    const names = Object.values(TipeeToolkit.tools).map((tool) => tool.name);

    expect(names.filter((name) => name.endsWith('_many'))).toEqual(
      BATCHED.map((name) => `${name}_many`),
    );
    for (const name of BATCHED) {
      expect(operations.find((target) => target.name === name)?.readOnly).toBe(false);
    }
  });

  it('carry the annotations of their operation, and ask for one yes', () => {
    for (const name of BATCHED) {
      const target = operations.find((candidate) => candidate.name === name);
      const tool = TipeeToolkit.tools[`${name}_many` as keyof typeof TipeeToolkit.tools];
      if (tool === undefined) {
        throw new Error(`no batch tool for ${name}`);
      }

      expect(Tool.getStrictMode(tool)).toBe(true);
      expect(Context.get(tool.annotations, Tool.Readonly)).toBe(false);
      expect(Context.get(tool.annotations, Tool.Destructive)).toBe(target?.destructive);
      expect(Context.get(tool.annotations, Tool.Idempotent)).toBe(false);
      expect(Tool.getDescription(tool)).toContain('wait for one yes');
      expect(Tool.getDescription(tool)).toContain('nothing is rolled back');
    }
  });
});

layer(clientFor(API_KEY))('schedules_update_many', (it) => {
  it.effect('applies every item, one after another, in order', () =>
    Effect.gen(function* () {
      const sent = scheduleUpdates();
      const report = (yield* call('schedules_update_many', { items: ids(3) })) as BatchReport;

      expect(sent).toEqual(['1', '2', '3']);
      expect(report).toEqual({ applied: 3, message: 'Applied all 3 items.', not_sent: 0 });
    }),
  );

  it.effect('refuses an invalid item before sending anything', () =>
    Effect.gen(function* () {
      const sent = scheduleUpdates();
      const error = yield* Effect.flip(
        call('schedules_update_many', { items: [{ id: '1' }, { colour: 'red', id: '2' }] }),
      );

      expect(sent).toEqual([]);
      expect(String(error)).toContain('["items"][1]["colour"]');
    }),
  );

  it.effect(`refuses an empty batch and one of more than ${MAX_ITEMS} items`, () =>
    Effect.gen(function* () {
      const sent = scheduleUpdates();
      yield* Effect.flip(call('schedules_update_many', { items: [] }));
      yield* Effect.flip(call('schedules_update_many', { items: ids(MAX_ITEMS + 1) }));
      const report = (yield* call('schedules_update_many', {
        items: ids(MAX_ITEMS),
      })) as BatchReport;

      expect(report.applied).toBe(MAX_ITEMS);
      expect(sent).toHaveLength(MAX_ITEMS);
    }),
  );

  it.effect('stops at the first failure and reports what was and was not sent', () =>
    Effect.gen(function* () {
      const sent = scheduleUpdates((id) =>
        id === '2' ? conflict() : new HttpResponse(undefined, { status: HTTP_NO_CONTENT }),
      );
      const report = (yield* call('schedules_update_many', { items: ids(4) })) as BatchReport;

      expect(sent).toEqual(['1', '2']);
      expect(report).toMatchObject({ applied: 1, failed: { index: 1 }, not_sent: 2 });
      expect(report.failed?.error).toMatch(/HTTP 409, locked_schedules/u);
      expect(report.message).toBe(
        'Applied the first 1 item; item 1 failed and the batch stopped, so 2 items after it ' +
          'were not sent. Nothing is rolled back.',
      );
    }),
  );

  it.effect("fails with the first item's error when nothing was applied", () =>
    Effect.gen(function* () {
      const sent = scheduleUpdates(conflict);
      const error = yield* Effect.flip(call('schedules_update_many', { items: ids(3) }));

      expect(sent).toEqual(['1']);
      expect(String(error)).toMatch(/HTTP 409, locked_schedules/u);
      expect(String(error)).toMatch(/stopped at its first item: the other 2 items were not sent/u);
    }),
  );

  it.effect('replays an item tipee interrupted for a concurrent change, and goes on', () =>
    Effect.gen(function* () {
      const sent = scheduleUpdates((id, attempt) =>
        id === '2' && attempt === 1
          ? HttpResponse.json({ message: 'Loop detected' }, { status: HTTP_LOOP_DETECTED })
          : new HttpResponse(undefined, { status: HTTP_NO_CONTENT }),
      );
      const report = (yield* settled(
        call('schedules_update_many', { items: ids(3) }),
      )) as BatchReport;

      expect(sent).toEqual(['1', '2', '2', '3']);
      expect(report.applied).toBe(3);
    }),
  );

  it.effect('stops at a write whose outcome is unknown, and never sends it twice', () =>
    Effect.gen(function* () {
      const sent = scheduleUpdates((id) =>
        id === '2'
          ? HttpResponse.error()
          : new HttpResponse(undefined, { status: HTTP_NO_CONTENT }),
      );
      const report = (yield* call('schedules_update_many', { items: ids(3) })) as BatchReport;

      expect(sent).toEqual(['1', '2']);
      expect(report).toMatchObject({ applied: 1, failed: { index: 1 }, not_sent: 1 });
      expect(report.failed?.error).toMatch(/may have applied it/u);
    }),
  );
});

describe('the deadline', () => {
  it.effect('stops starting items after 30 s and says which to send again', () =>
    Effect.gen(function* () {
      // Every write takes 15 s on the test clock.
      const slow = HttpClient.make((request) =>
        Effect.as(
          Effect.sleep('15 seconds'),
          HttpClientResponse.fromWeb(request, new Response(undefined, { status: HTTP_NO_CONTENT })),
        ),
      );
      const toolkit = TipeeToolkitLayer.pipe(
        Layer.provide(TipeeClient.layer({ apiKey: Redacted.make(API_KEY), instance: 'acme' })),
        Layer.provide(Layer.succeed(HttpClient.HttpClient, slow)),
        Layer.provide(Telemetry.layerOff),
        Layer.provide(Updates.layerNone(SERVER_VERSION)),
      );
      const report = (yield* settled(
        call('schedules_update_many', { items: ids(5) }).pipe(Effect.provide(toolkit)),
      )) as BatchReport;

      expect(report.applied).toBe(2);
      expect(report.not_sent).toBe(3);
      expect(report.failed).toBeUndefined();
      expect(report.message).toMatch(/send the remaining 3 items \(from index 2\) in a new call/u);
    }),
  );
});
