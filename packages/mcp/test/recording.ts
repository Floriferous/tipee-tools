// Shared by the telemetry tests: a Telemetry that keeps what it is given,
// and the toolkit over the fake tipee recording into it.

import { TipeeClient } from '@tipee-tools/core';
import { API_KEY } from '@tipee-tools/core/testing';
import { Effect, Layer, Redacted } from 'effect';
import { FetchHttpClient } from 'effect/http';

import { SERVER_VERSION, Telemetry, TipeeToolkitLayer, Updates } from '../src/index.ts';

export interface Recorded {
  readonly event: string;
  readonly properties: Record<string, unknown>;
}
export const recorded: Array<Recorded> = [];
const recording = Layer.succeed(Telemetry, {
  capture: (event, properties) =>
    Effect.sync(() => {
      recorded.push({ event, properties: { ...properties } });
    }),
  exception: (error, { handled, properties }) =>
    Effect.sync(() => {
      recorded.push({
        event: '$exception',
        properties: { ...properties, handled, message: String(error) },
      });
    }),
  flush: Effect.void,
});
// What a call recorded, without the session event of whichever call came first.
export const recordedCalls = (): ReadonlyArray<Recorded> =>
  recorded.filter((entry) => entry.event !== 'session_started');
export const recordingClient = TipeeToolkitLayer.pipe(
  Layer.provide(TipeeClient.layer({ apiKey: Redacted.make(API_KEY), instance: 'acme' })),
  Layer.provide(recording),
  Layer.provide(Updates.layerNone(SERVER_VERSION)),
  Layer.provide(FetchHttpClient.layer),
);
