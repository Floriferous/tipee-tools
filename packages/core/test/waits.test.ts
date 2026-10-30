// How long the client waits before sending a request again: at least what
// tipee's Retry-After asks, and not at all when that is longer than a tool
// call can afford.

import { describe, expect, it } from '@effect/vitest';
import { Clock, Effect, Layer } from 'effect';
import { HttpClient, HttpClientResponse } from 'effect/http';

import { TipeeClient, retryAfterSeconds } from '../src/index.ts';
import { HTTP_TOO_MANY_REQUESTS, call, credentials, failure, settled } from './answers.ts';

// A client whose answers come from `answer`, on the test clock, recording
// when each request was sent.
const scripted = (
  answer: (attempt: number) => Response,
): { readonly client: Layer.Layer<TipeeClient>; readonly sentAt: Array<number> } => {
  const sentAt: Array<number> = [];
  const fake = HttpClient.make((request) =>
    Effect.map(Clock.currentTimeMillis, (now) => {
      sentAt.push(now);
      return HttpClientResponse.fromWeb(request, answer(sentAt.length));
    }),
  );
  return {
    client: TipeeClient.layer(credentials).pipe(
      Layer.provide(Layer.succeed(HttpClient.HttpClient, fake)),
    ),
    sentAt,
  };
};

describe('Retry-After', () => {
  it('reads seconds and HTTP dates', () => {
    const now = Date.parse('2026-10-30T12:00:00Z');

    expect(retryAfterSeconds('7', now)).toBe(7);
    expect(retryAfterSeconds('Fri, 30 Oct 2026 12:00:30 GMT', now)).toBe(30);
    expect(retryAfterSeconds('Fri, 30 Oct 2026 11:59:00 GMT', now)).toBe(0);
    expect(retryAfterSeconds('soon', now)).toBeUndefined();
    expect(retryAfterSeconds(undefined, now)).toBeUndefined();
  });
});

describe('waiting', () => {
  it.effect('waits at least as long as Retry-After asks', () =>
    Effect.gen(function* () {
      const { client, sentAt } = scripted((attempt) =>
        attempt === 1
          ? Response.json(
              { message: 'Slow down.' },
              { headers: { 'Retry-After': '5' }, status: HTTP_TOO_MANY_REQUESTS },
            )
          : Response.json([]),
      );
      yield* settled(call('kinds_list', {})).pipe(Effect.provide(client));

      expect(sentAt).toHaveLength(2);
      expect((sentAt[1] ?? 0) - (sentAt[0] ?? 0)).toBeGreaterThanOrEqual(5000);
    }),
  );

  it.effect('passes a wait longer than it can afford straight back', () =>
    Effect.gen(function* () {
      const { client, sentAt } = scripted(() =>
        Response.json(
          { message: 'Slow down.' },
          { headers: { 'Retry-After': '30' }, status: HTTP_TOO_MANY_REQUESTS },
        ),
      );
      const error = yield* settled(failure(call('kinds_list', {}))).pipe(Effect.provide(client));

      expect(sentAt).toHaveLength(1);
      expect(error.reason._tag).toBe('RateLimited');
      expect(error.message).toContain('Retry-After: 30');
    }),
  );
});
