// The check tool against the fake Tipee: every probed endpoint reported, and
// What a skipped or failed endpoint tells the user.

import { expect, layer } from '@effect/vitest';
import { API_KEY, BASE, INTEGRATION_ID, server } from '@tipee-tools/core/testing';
import { Effect } from 'effect';
import { HttpResponse, http } from 'msw/http';

import { call, clientFor } from './toolkit.ts';

const HTTP_FORBIDDEN = 403;

layer(clientFor(API_KEY))('check', (it) => {
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

  it.effect('check names the right a skipped endpoint needs, and where to tick it', () =>
    Effect.gen(function* () {
      server.use(
        http.post(
          `${BASE}/api/schedule/schedules.list`,
          () => HttpResponse.json({ message: 'Access denied.' }, { status: HTTP_FORBIDDEN }),
          { once: true },
        ),
      );
      const report = (yield* call('check', {})) as {
        endpoints: Array<{ name: string; status: string; error?: string }>;
      };
      const schedules = report.endpoints.find((endpoint) => endpoint.name === 'schedules_list');

      expect(schedules?.status).toBe('skipped');
      expect(schedules?.error).toContain('Access denied.');
      expect(schedules?.error).toContain('«Planning → Voir les plannings»');
      expect(schedules?.error).toContain(`/hr-core/profile/${INTEGRATION_ID}/roles`);
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
