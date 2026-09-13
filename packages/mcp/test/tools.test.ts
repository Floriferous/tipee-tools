// The tools against the fake Tipee, called the way the MCP server calls them
// (decode parameters, run the handler, encode the result).

import { describe, expect, it, layer } from '@effect/vitest';
import { TipeeClient } from '@tipee-tools/core';
import { API_KEY, BASE, server } from '@tipee-tools/core/testing';
import { Context, Effect, Layer, Option, Redacted, Stream } from 'effect';
import { Tool } from 'effect/unstable/ai';
import { FetchHttpClient } from 'effect/unstable/http';
import { HttpResponse, http } from 'msw';

import { TipeeToolkit, TipeeToolkitLayer } from '../src/index.ts';

const ALICE = '1000000000000000100';
const WEEK = { from: '2026-09-07', to: '2026-09-13' };

const clientFor = (apiKey: string) =>
  TipeeToolkitLayer.pipe(
    Layer.provide(TipeeClient.layer({ apiKey: Redacted.make(apiKey), instance: 'acme' })),
    Layer.provide(FetchHttpClient.layer),
  );

type Tools = typeof TipeeToolkit.tools;

// Runs a tool as the server does and returns the JSON it would send back.
const call = Effect.fn('call')(function* call<Name extends keyof Tools>(
  name: Name,
  params: Tool.ParametersEncoded<Tools[Name]>,
) {
  const toolkit = yield* TipeeToolkit;
  const last = yield* toolkit.handle(name, params).pipe(Stream.unwrap, Stream.runLast);
  return Option.getOrThrow(last).encodedResult as Record<string, unknown>;
});

describe('toolkit', () => {
  it('declares every tool read-only', () => {
    const tools = Object.values(TipeeToolkit.tools);

    expect(tools.map((tool) => tool.name).toSorted()).toEqual([
      'tipee_absences',
      'tipee_activity_rates',
      'tipee_check',
      'tipee_on_calls',
      'tipee_people',
      'tipee_shifts',
      'tipee_teams',
      'tipee_templates',
    ]);
    expect(tools.every((tool) => Context.get(tool.annotations, Tool.Readonly))).toBe(true);
    expect(tools.every((tool) => !Context.get(tool.annotations, Tool.Destructive))).toBe(true);
  });
});

layer(clientFor(API_KEY))('tools', (it) => {
  it.effect('tipee_people lists employees with planning fields only', () =>
    Effect.gen(function* () {
      const people = (yield* call('tipee_people', {})).people as Array<{ label: string }>;
      const labels = people.map((person) => person.label);

      expect(labels).toContain('Alice (AP1) Placeholder');
      expect(people[0]).not.toHaveProperty('attributes');
    }),
  );

  it.effect('tipee_shifts filters by people', () =>
    Effect.gen(function* () {
      const { shifts } = yield* call('tipee_shifts', { ...WEEK, resource_ids: [ALICE] });

      expect(
        (shifts as Array<{ resource_id: string }>).every((shift) => shift.resource_id === ALICE),
      ).toBe(true);
    }),
  );

  it.effect('tipee_check reports every endpoint ok, over the coming week by default', () =>
    Effect.gen(function* () {
      const report = yield* call('tipee_check', {});

      expect(report.ok).toBe(true);
      // The test clock starts at the epoch.
      expect(report.date_range).toBe('1970-01-01/1970-01-07');
      expect(
        (report.endpoints as Array<{ name: string }>).map((endpoint) => endpoint.name),
      ).toEqual([
        'people',
        'teams',
        'templates',
        'shifts',
        'absences',
        'on_calls',
        'activity_rates',
      ]);
    }),
  );

  it.effect('tipee_check flags an endpoint whose response no longer matches', () =>
    Effect.gen(function* () {
      server.use(
        http.post(
          `${BASE}/api/schedule/schedule-templates.list`,
          () => HttpResponse.json([{ id: 'not-a-snowflake' }]),
          { once: true },
        ),
      );
      const report = yield* call('tipee_check', WEEK);
      const templates = (
        report.endpoints as Array<{ name: string; status: string; error?: string }>
      ).find((endpoint) => endpoint.name === 'templates');

      expect(report.ok).toBe(false);
      expect(templates?.status).toBe('failed');
      expect(templates?.error).toMatch(/schedule-templates\.list/u);
    }),
  );
});

describe('failures', () => {
  it.effect('surface the Tipee error so the model reads the explanation', () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(call('tipee_teams', {}));

      expect(error._tag).toBe('TipeeError');
      expect(error.message).toMatch(/rejected the API key/u);
    }).pipe(Effect.provide(clientFor('wrong'))),
  );
});
