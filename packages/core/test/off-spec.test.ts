// Tipee answering with a success status its document does not declare: an
// operation documented without a body has nothing to misread, so any 2xx
// means it was applied; one with a body still needs the shape it declares.

import { expect, layer } from '@effect/vitest';
import { Effect } from 'effect';
import { HttpResponse, http } from 'msw/http';

import { AcceptedOffSpec } from '../src/index.ts';
import { TestClient, call, failure } from './answers.ts';
import { BASE } from './handlers.ts';
import { server } from './server.ts';

const ASSIGN_RATE_URL = `${BASE}/api/directory/resources.assign-activity-rate`;
const ASSIGN_RATE = { average_rate: 80, date_range: '2026-11-01/-', resource_id: '1' };
const HTTP_OK = 200;

layer(TestClient)('answers off the document', (it) => {
  it.effect('takes a 200 with a body for a write documented as 204 as applied', () =>
    Effect.gen(function* () {
      server.use(http.post(ASSIGN_RATE_URL, () => HttpResponse.json({ warnings: [] })));
      const answer = yield* call('resources_assign_activity_rate', ASSIGN_RATE);

      expect(answer).toBeInstanceOf(AcceptedOffSpec);
      expect((answer as AcceptedOffSpec).status).toBe(HTTP_OK);
    }),
  );

  it.effect('takes an empty 200 for a write documented as 204 as applied', () =>
    Effect.gen(function* () {
      server.use(
        http.post(ASSIGN_RATE_URL, () => new HttpResponse(undefined, { status: HTTP_OK })),
      );
      const answer = yield* call('resources_assign_activity_rate', ASSIGN_RATE);

      expect(answer).toBeInstanceOf(AcceptedOffSpec);
    }),
  );

  it.effect('still answers nothing for the documented 204', () =>
    Effect.gen(function* () {
      server.use(http.post(ASSIGN_RATE_URL, () => new HttpResponse(undefined, { status: 204 })));
      const answer = yield* call('resources_assign_activity_rate', ASSIGN_RATE);

      expect(answer).toBeUndefined();
    }),
  );

  it.effect('reports a read answered with an undeclared status, naming the status', () =>
    Effect.gen(function* () {
      server.use(
        http.post(
          `${BASE}/api/directory/kinds.list`,
          () => HttpResponse.json([], { status: 201 }),
          {
            once: true,
          },
        ),
      );
      const error = yield* failure(call('kinds_list', {}));

      expect(error.reason).toMatchObject({
        _tag: 'UnexpectedShape',
        details: 'undeclared status code',
        status: 201,
      });
    }),
  );
});
