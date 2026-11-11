// The update note over the real MCP registrations, in memory: after a tool's
// answer, once the launch's lookup found a newer version, and once only.

import { describe, expect, it } from '@effect/vitest';
import { TipeeClient } from '@tipee-tools/core';
import { API_KEY } from '@tipee-tools/core/testing';
import { Deferred, Effect, Layer, Option, Redacted } from 'effect';
import { McpProtocol, McpTest } from 'effect/ai';
import { FetchHttpClient } from 'effect/http';

import {
  NotifiedToolkit,
  SERVER_VERSION,
  Telemetry,
  TipeeToolkitLayer,
  Update,
  Updates,
} from '../src/index.ts';

const NEWER = new Update({ url: 'https://example.test/v99', version: '99.0.0' });

// A client of the server whose release lookup ends when `released` is done.
const clientOf = (released: Deferred.Deferred<boolean>) =>
  McpTest.makeClient(
    NotifiedToolkit.pipe(
      Layer.provide(TipeeToolkitLayer),
      Layer.provide(TipeeClient.layer({ apiKey: Redacted.make(API_KEY), instance: 'acme' })),
      Layer.provide(Telemetry.layerOff),
      Layer.provide(
        Layer.succeed(
          Updates,
          Updates.of({
            available: Effect.as(Deferred.await(released), Option.some(NEWER)),
            current: SERVER_VERSION,
            install: Effect.succeed({ status: 'up_to_date' as const }),
          }),
        ),
      ),
      Layer.provide(FetchHttpClient.layer),
    ),
    { protocols: [McpProtocol.v2025_11_25] },
  );

const texts = (result: { readonly content: ReadonlyArray<unknown> }): ReadonlyArray<string> =>
  result.content.map((block) => (block as { readonly text: string }).text);

describe('the update note', () => {
  it.effect('follows the first answer after the lookup, once, after the answer itself', () =>
    Effect.gen(function* () {
      const released = yield* Deferred.make<boolean>();
      const client = yield* clientOf(released);
      const call = client.callTool({ arguments: {}, name: 'teams_list' });

      const before = yield* call;
      yield* Deferred.succeed(released, true);
      yield* Effect.yieldNow;
      const noted = yield* call;
      const after = yield* call;

      expect(texts(before)).toHaveLength(1);
      expect(texts(noted)).toHaveLength(2);
      expect(texts(noted)[1]).toMatch(/^tipee for Claude 99\.0\.0 is available/u);
      expect(noted.structuredContent).toEqual(before.structuredContent);
      expect(texts(after)).toHaveLength(1);
    }).pipe(Effect.scoped),
  );

  it.effect('is never added once check_setup has spoken of updates', () =>
    Effect.gen(function* () {
      const released = yield* Deferred.make<boolean>();
      const client = yield* clientOf(released);
      // Check_setup waits for the lookup itself, and reports the update.
      yield* Deferred.succeed(released, true);
      yield* client.callTool({ arguments: {}, name: 'check_setup' });
      const answer = yield* client.callTool({ arguments: {}, name: 'teams_list' });

      expect(texts(answer)).toHaveLength(1);
    }).pipe(Effect.scoped),
  );
});
