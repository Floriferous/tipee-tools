// Shared by the tool tests: the toolkit wired to the fake tipee, and a call
// that runs a tool the way the MCP server does (decode parameters, strictly
// for a strict tool, run the handler, encode the result).

import { TipeeClient } from '@tipee-tools/core';
import { Effect, Layer, Option, Redacted, Schema, Stream } from 'effect';
import { Tool } from 'effect/ai';
import type { AiError } from 'effect/ai';
import { FetchHttpClient } from 'effect/http';

import {
  SERVER_VERSION,
  Telemetry,
  TipeeToolkit,
  TipeeToolkitLayer,
  Updates,
} from '../src/index.ts';

type Toolkit = Layer.Success<typeof TipeeToolkitLayer>;
type Tools = (typeof TipeeToolkit)['tools'];

// What a tool call can fail with: a tool's own failure, or the AiError the
// toolkit raises when the parameters do not decode.
export type CallError = Tool.HandlerError<Tools[keyof Tools]> | AiError.AiError;

export const clientFor = (apiKey: string): Layer.Layer<Toolkit> =>
  TipeeToolkitLayer.pipe(
    Layer.provide(TipeeClient.layer({ apiKey: Redacted.make(apiKey), instance: 'acme' })),
    Layer.provide(Telemetry.layerOff),
    Layer.provide(Updates.layerNone(SERVER_VERSION)),
    Layer.provide(FetchHttpClient.layer),
  );

// Runs a tool as the server does and returns the JSON it would send back.
export const call = Effect.fn('call')(function* (name: keyof Tools, params: Schema.Json) {
  const toolkit = yield* TipeeToolkit;
  const tool = TipeeToolkit.tools[name];
  // The options McpServer decodes with.
  const options = {
    errors: 'all',
    onExcessProperty: tool !== undefined && Tool.getStrictMode(tool) === true ? 'error' : 'ignore',
  } as const;
  const handled: Effect.Effect<
    Stream.Stream<{ readonly encodedResult: unknown }, CallError>,
    AiError.AiError
  > = toolkit.handle(name, params, undefined, options);
  const last = yield* handled.pipe(Stream.unwrap, Stream.runLast);
  // The encoded result is JSON by construction: anything else is a defect.
  return yield* Schema.decodeUnknownEffect(Schema.Json)(Option.getOrThrow(last).encodedResult).pipe(
    Effect.orDie,
  );
});
