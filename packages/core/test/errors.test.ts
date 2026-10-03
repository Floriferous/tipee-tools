// How failures come back through `invoke`: each one explained, and the ones
// A user can fix by hand ending with the page to open on their instance.

import { expect, layer } from '@effect/vitest';
import { Effect } from 'effect';
import { HttpResponse, http } from 'msw/http';

import {
  HTTP_BAD_REQUEST,
  HTTP_CONFLICT,
  HTTP_FORBIDDEN,
  HTTP_UNAUTHORIZED,
  HTTP_UNPROCESSABLE,
  NEW_SCHEDULE,
  PROJECTS_URL,
  RESOURCES_URL,
  SCHEDULES_CREATE_URL,
  SCHEDULES_DELETE_URL,
  SCHEDULES_URL,
  TestClient,
  WEEK,
  call,
  failure,
  status,
} from './answers.ts';
import { BASE } from './handlers.ts';
import { server } from './server.ts';
import { INTEGRATION_ID } from './tables.ts';

layer(TestClient)('errors', (it) => {
  it.effect('explains a response that does not match the API description', () =>
    Effect.gen(function* () {
      server.use(http.post(SCHEDULES_URL, () => HttpResponse.json([{}]), { once: true }));
      const error = yield* failure(call('schedules_list', { date_range: WEEK }));

      expect(error.reason._tag).toBe('UnexpectedShape');
      expect(error.message).toMatch(/accepted the request/u);
      expect(error.message).toMatch(/at \[0\]\["id"\]/u);
    }),
  );

  it.effect('quotes what Tipee could not find', () =>
    Effect.gen(function* () {
      const error = yield* failure(
        call('schedules_delete', { ids: ['1'], options: { group_action: 'single' } }),
      );

      expect(error.reason._tag).toBe('NotFound');
      expect(error.message).toBe(
        `Tipee could not find it (HTTP 404): L'élément avec l'id "1" n'a pas été trouvé. ` +
          'Re-read the list the id came from.',
      );
    }),
  );

  it.effect('reads a 400 as a rejection', () =>
    Effect.gen(function* () {
      server.use(
        status(HTTP_BAD_REQUEST, {
          body: { message: 'Text cannot be parsed to an interval: 01.11.2026' },
          url: SCHEDULES_URL,
        }),
      );
      const error = yield* failure(call('schedules_list', { date_range: '01.11.2026' }));

      expect(error.reason._tag).toBe('Rejected');
      expect(error.message).toMatch(
        /^Tipee rejected the request \(HTTP 400\): Text cannot be parsed to an interval: 01\.11\.2026 Nothing was changed\./u,
      );
    }),
  );

  it.effect('quotes the overlap Tipee declares for a schedule create', () =>
    Effect.gen(function* () {
      server.use(
        status(HTTP_CONFLICT, {
          body: {
            body: { conflicting_dates: [{ date: '2026-10-05', resource: '1' }] },
            error: 'OVERLAPPING',
          },
          url: SCHEDULES_CREATE_URL,
        }),
      );
      const error = yield* failure(call('schedules_create', NEW_SCHEDULE));

      expect(error.reason).toMatchObject({ _tag: 'Rejected', code: 'OVERLAPPING', status: 409 });
      expect(error.message).toMatch(
        /^Tipee rejected the request \(HTTP 409, OVERLAPPING\): .*2026-10-05/u,
      );
    }),
  );

  it.effect('quotes the locked schedules Tipee declares for a delete', () =>
    Effect.gen(function* () {
      server.use(
        status(HTTP_CONFLICT, {
          body: { description: 'Some schedules are locked.', warning_type: 'locked_schedules' },
          url: SCHEDULES_DELETE_URL,
        }),
      );
      const error = yield* failure(
        call('schedules_delete', { ids: ['1'], options: { group_action: 'single' } }),
      );

      expect(error.reason).toMatchObject({ _tag: 'Rejected', code: 'locked_schedules' });
      expect(error.message).toMatch(/Some schedules are locked\./u);
    }),
  );

  it.effect('explains a valid key whose integration may not use the API yet', () =>
    Effect.gen(function* () {
      server.use(
        status(HTTP_UNAUTHORIZED, { body: { message: 'Tipee.api.token_rights_missing' } }),
      );
      const error = yield* failure(call('kinds_list', {}));

      expect(error.reason._tag).toBe('RightsMissing');
      expect(error.message).toMatch(/applications externes/u);
      expect(error.message).toContain('https://acme.tipee.net/hr-core/integrations');
      expect(error.message).toContain('https://acme.tipee.net/admin/instance/integrations/');
      expect(error.message).toMatch(/Responsable API/u);
    }),
  );

  it.effect('links a missing right to the Roles tab of the one integration', () =>
    Effect.gen(function* () {
      server.use(status(HTTP_FORBIDDEN, { url: SCHEDULES_URL }));
      const error = yield* failure(call('schedules_list', { date_range: WEEK }));

      expect(error.reason._tag).toBe('Forbidden');
      expect(error.message).toContain('«Planning → Voir les plannings»');
    }),
  );

  it.effect('names the special right of a write', () =>
    Effect.gen(function* () {
      server.use(status(HTTP_FORBIDDEN, { url: `${BASE}/api/timeclock/timechecks.delete` }));
      const error = yield* failure(call('timechecks_delete', { id: '1' }));

      expect(error.message).toContain('«Saisie des heures → Supprimer un timbrage»');
      expect(error.message).toContain(
        `https://acme.tipee.net/hr-core/profile/${INTEGRATION_ID}/roles`,
      );
    }),
  );

  it.effect('explains a request that does not match the API description before sending it', () =>
    Effect.gen(function* () {
      const error = yield* failure(call('timechecks_delete', { ids: ['1'] }));

      expect(error.reason._tag).toBe('InvalidRequest');
      expect(error.message).toMatch(/at \["id"\]/u);
    }),
  );

  it.effect('falls back to the integrations page when they cannot be listed', () =>
    Effect.gen(function* () {
      server.use(
        status(HTTP_FORBIDDEN, { url: SCHEDULES_URL }),
        status(HTTP_FORBIDDEN, { url: RESOURCES_URL }),
      );
      const error = yield* failure(call('schedules_list', { date_range: WEEK }));

      expect(error.message).toContain('https://acme.tipee.net/hr-core/integrations');
      expect(error.message).not.toContain('/roles');
    }),
  );

  it.effect('explains a module that is not activated', () =>
    Effect.gen(function* () {
      server.use(
        status(HTTP_FORBIDDEN, {
          body: { message: "Module 'Activités' is required and it is not activated." },
          url: PROJECTS_URL,
        }),
      );
      const error = yield* failure(call('projects_list', {}));

      expect(error.reason._tag).toBe('Forbidden');
      expect(error.message).toMatch(/Module 'Activités' is required/u);
      expect(error.message).toMatch(/administrator/u);
      expect(error.message).not.toContain('/roles');
    }),
  );

  it.effect('quotes the detail of a validation error', () =>
    Effect.gen(function* () {
      server.use(
        status(HTTP_UNPROCESSABLE, {
          body: {
            detail: 'date_range: This value is not a valid date range.',
            status: HTTP_UNPROCESSABLE,
            title: 'Validation Failed',
          },
          url: SCHEDULES_URL,
        }),
      );
      const error = yield* failure(call('schedules_list', { date_range: 'yesterday' }));

      expect(error.reason._tag).toBe('Rejected');
      expect(error.message).toMatch(
        /^Tipee rejected the request \(HTTP 422\): date_range: This value is not a valid date range\. Nothing/u,
      );
    }),
  );

  it.effect('keeps every field of a validation error, not just its message', () =>
    Effect.gen(function* () {
      const body = {
        details: { when: 'This date is in a locked period.' },
        message: 'Invalid request',
      };
      server.use(status(HTTP_UNPROCESSABLE, { body, url: SCHEDULES_URL }));
      const error = yield* failure(call('schedules_list', { date_range: WEEK }));

      expect(error.message).toContain(
        `Tipee rejected the request (HTTP 422): Invalid request\n${JSON.stringify(body)} `,
      );
    }),
  );

  it.effect("quotes Tipee's reason for refusing a key", () =>
    Effect.gen(function* () {
      server.use(status(HTTP_UNAUTHORIZED, { body: { message: 'Token expired on 2026-09-30' } }));
      const error = yield* failure(call('kinds_list', {}));

      expect(error.reason._tag).toBe('ApiKeyRejected');
      expect(error.message).toMatch(
        /^Tipee refused the API key \(HTTP 401\): Token expired on 2026-09-30 /u,
      );
    }),
  );
});
