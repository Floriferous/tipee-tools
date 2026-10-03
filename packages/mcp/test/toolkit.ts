// Shared by the tool tests: the toolkit wired to the fake Tipee, and a call
// that runs a tool the way the MCP server does (decode parameters, strictly
// for a strict tool, run the handler, encode the result).

import { TipeeClient } from '@tipee-tools/core';
import { Effect, Layer, Option, Redacted, Stream } from 'effect';
import { Tool } from 'effect/ai';
import { FetchHttpClient } from 'effect/http';

import { Telemetry, TipeeToolkit, TipeeToolkitLayer, Updates } from '../src/index.ts';

type Toolkit = Layer.Success<typeof TipeeToolkitLayer>;

export const clientFor = (apiKey: string): Layer.Layer<Toolkit> =>
  TipeeToolkitLayer.pipe(
    Layer.provide(TipeeClient.layer({ apiKey: Redacted.make(apiKey), instance: 'acme' })),
    Layer.provide(Telemetry.layerOff),
    Layer.provide(Updates.layerNone),
    Layer.provide(FetchHttpClient.layer),
  );

// Runs a tool as the server does and returns the JSON it would send back.
type Handled = Effect.Effect<Stream.Stream<{ readonly encodedResult: unknown }, unknown>, unknown>;

export const call = Effect.fn('call')(function* (name: string, params: unknown) {
  const toolkit = yield* TipeeToolkit;
  const tool = TipeeToolkit.tools[name as keyof typeof TipeeToolkit.tools];
  // The options McpServer decodes with.
  const options = {
    errors: 'all',
    onExcessProperty: tool !== undefined && Tool.getStrictMode(tool) === true ? 'error' : 'ignore',
  } as const;
  const handled = toolkit.handle(name as never, params, undefined, options) as unknown as Handled;
  const last = yield* handled.pipe(Stream.unwrap, Stream.runLast);
  return Option.getOrThrow(last).encodedResult;
});
