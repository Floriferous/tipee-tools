// The check_setup tool against the fake Tipee: every probed endpoint reported, and
// what a skipped or failed endpoint tells the user.

import { describe, expect, it, layer } from '@effect/vitest';
import { TipeeClient } from '@tipee-tools/core';
import { API_KEY, BASE, INTEGRATION_ID, server } from '@tipee-tools/core/testing';
import { Effect, Layer, Redacted } from 'effect';
import { FetchHttpClient } from 'effect/http';
import { HttpResponse, http } from 'msw/http';

import { SERVER_VERSION, Telemetry, TipeeToolkitLayer, Update, Updates } from '../src/index.ts';
import { call, clientFor } from './toolkit.ts';

const HTTP_FORBIDDEN = 403;

layer(clientFor(API_KEY))('check_setup', (it) => {
  it.effect('reports every probed endpoint ok, over the coming week by default', () =>
    Effect.gen(function* () {
      const report = (yield* call('check_setup', {})) as {
        ok: boolean;
        date_range: string;
        endpoints: Array<{ name: string; status: string }>;
        integration?: { label: string; roles_page: string };
        version: string;
      };

      expect(report.ok).toBe(true);
      expect(report.version).toBe(SERVER_VERSION);
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

  it.effect('skips an endpoint whose module is off, and stays ok', () =>
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
      const report = (yield* call('check_setup', {})) as {
        ok: boolean;
        endpoints: Array<{ name: string; status: string; error?: string }>;
      };
      const timechecks = report.endpoints.find((endpoint) => endpoint.name === 'timechecks_list');

      expect(report.ok).toBe(true);
      expect(timechecks?.status).toBe('skipped');
      expect(timechecks?.error).toMatch(/Saisie des heures/u);
    }),
  );

  it.effect('names the right a skipped endpoint needs, and where to tick it', () =>
    Effect.gen(function* () {
      server.use(
        http.post(
          `${BASE}/api/schedule/schedules.list`,
          () => HttpResponse.json({ message: 'Access denied.' }, { status: HTTP_FORBIDDEN }),
          { once: true },
        ),
      );
      const report = (yield* call('check_setup', {})) as {
        endpoints: Array<{ name: string; status: string; error?: string }>;
      };
      const schedules = report.endpoints.find((endpoint) => endpoint.name === 'schedules_list');

      expect(schedules?.status).toBe('skipped');
      expect(schedules?.error).toContain('Access denied.');
      expect(schedules?.error).toContain('«Planning → Voir les plannings»');
      expect(schedules?.error).toContain(`/hr-core/profile/${INTEGRATION_ID}/roles`);
    }),
  );

  it.effect('flags an endpoint whose response no longer matches', () =>
    Effect.gen(function* () {
      server.use(
        http.post(
          `${BASE}/api/schedule/schedule-templates.list`,
          () => HttpResponse.json([{ id: 'not-a-template' }]),
          { once: true },
        ),
      );
      const report = (yield* call('check_setup', { from: '2026-09-07', to: '2026-09-13' })) as {
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

  it.effect('skips the probes that need a refused list, and runs the rest', () =>
    Effect.gen(function* () {
      server.use(
        http.post(`${BASE}/api/directory/kinds.list`, () =>
          HttpResponse.json({ message: 'Access denied.' }, { status: HTTP_FORBIDDEN }),
        ),
      );
      const report = (yield* call('check_setup', {})) as {
        ok: boolean;
        endpoints: Array<{ name: string; status: string; error?: string }>;
      };
      const skipped = report.endpoints.filter((endpoint) => endpoint.status === 'skipped');

      expect(report.ok).toBe(true);
      expect(skipped.map((endpoint) => endpoint.name)).toEqual([
        'kinds_list',
        'resources_list',
        'resources_show_activity_rates',
      ]);
      expect(skipped[1]?.error).toBe(
        'Not called: it needs an id from kinds_list, which needs «Cœur RH → Voir les collaborateurs».',
      );
      expect(skipped[2]?.error).toMatch(/needs an id from resources_list/u);
      expect(report.endpoints.filter((endpoint) => endpoint.status === 'ok')).toHaveLength(6);
    }),
  );

  it.effect('falls back to the coming week when only one end of the range is given', () =>
    Effect.gen(function* () {
      const report = (yield* call('check_setup', { from: '2026-09-07' })) as {
        date_range: string;
      };

      expect(report.date_range).toBe('1970-01-01/1970-01-07');
    }),
  );
});

// A newer release on offer, for a key that is right or wrong.
const offered = (apiKey: string) =>
  TipeeToolkitLayer.pipe(
    Layer.provide(TipeeClient.layer({ apiKey: Redacted.make(apiKey), instance: 'acme' })),
    Layer.provide(Telemetry.layerOff),
    Layer.provide(
      Layer.succeed(Updates, {
        available: Effect.succeedSome(
          new Update({ url: 'https://github.test/tag/v9.9.9', version: '9.9.9' }),
        ),
        current: SERVER_VERSION,
        install: Effect.succeed({ status: 'up_to_date' as const }),
      }),
    ),
    Layer.provide(FetchHttpClient.layer),
  );

describe('check_setup with a newer release', () => {
  it.effect('reports it alongside the endpoints', () =>
    Effect.gen(function* () {
      const report = (yield* call('check_setup', {})) as { update?: { version: string } };

      expect(report.update?.version).toBe('9.9.9');
    }).pipe(Effect.provide(offered(API_KEY))),
  );

  // A release may fix what makes every call fail.
  it.effect('offers it when the check aborts', () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(call('check_setup', {}));

      expect(String(error)).toMatch(/refused the API key/u);
      expect(String(error)).toMatch(
        /Version 9\.9\.9 of Tipee for Claude is available: offer to install it with update_plugin\.$/u,
      );
    }).pipe(Effect.provide(offered('wrong'))),
  );
});
