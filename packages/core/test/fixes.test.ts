// Every failure ends with its next step, since the message is all an agent in
// Claude Desktop gets: what to retry, and when retrying will not help.

import { expect, it, layer } from '@effect/vitest';
import { Effect, Layer } from 'effect';
import { HttpClient, HttpClientError } from 'effect/http';
import { HttpResponse, http } from 'msw/http';

import { TipeeClient } from '../src/index.ts';
import {
  HTTP_SERVER_ERROR,
  KINDS_URL,
  NEW_SCHEDULE,
  SCHEDULES_URL,
  TestClient,
  WEEK,
  call,
  credentials,
  failure,
  settled,
  status,
} from './answers.ts';
import { server } from './server.ts';

// A network that inspects HTTPS: every connection fails on a certificate
// Node does not trust, the way undici reports it.
const untrusted = Object.assign(new Error('unable to verify the first certificate'), {
  code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
});
const InspectedNetwork = TipeeClient.layer(credentials).pipe(
  Layer.provide(
    Layer.succeed(
      HttpClient.HttpClient,
      HttpClient.make((request) =>
        Effect.fail(
          new HttpClientError.HttpClientError({
            reason: new HttpClientError.TransportError({ cause: untrusted, request }),
          }),
        ),
      ),
    ),
  ),
);

layer(TestClient)('next steps', (it) => {
  it.effect('a read that cannot reach Tipee asks to check the connection', () =>
    Effect.gen(function* () {
      server.use(http.post(KINDS_URL, () => HttpResponse.error()));
      const error = yield* settled(failure(call('kinds_list', {})));

      expect(error.reason._tag).toBe('Unreachable');
      expect(error.message).toMatch(/Check the internet connection and try again\.$/u);
    }),
  );

  it.effect('a read Tipee keeps failing on suggests check_setup', () =>
    Effect.gen(function* () {
      server.use(status(HTTP_SERVER_ERROR, { once: false }));
      const error = yield* settled(failure(call('kinds_list', {})));

      expect(error.message).toMatch(/run check_setup if it persists\.$/u);
    }),
  );

  it.effect('an answer of an unexpected shape suggests an update', () =>
    Effect.gen(function* () {
      server.use(http.post(SCHEDULES_URL, () => HttpResponse.json([{}]), { once: true }));
      const error = yield* failure(call('schedules_list', { date_range: WEEK }));

      expect(error.message).toMatch(/Run check_setup and suggest updating Tipee for Claude\.$/u);
    }),
  );
});

it.effect('an untrusted certificate says nothing was sent, even for a write', () =>
  Effect.gen(function* () {
    const error = yield* failure(call('schedules_create', NEW_SCHEDULE));

    expect(error.reason._tag).toBe('Unreachable');
    expect(error.message).toMatch(/Nothing was sent to Tipee/u);
    expect(error.message).toContain('exempt acme.tipee.net');
    expect(error.message).not.toMatch(/may have applied it/u);
  }).pipe(Effect.provide(InspectedNetwork)),
);
