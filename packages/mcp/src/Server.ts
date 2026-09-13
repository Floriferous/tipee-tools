// The MCP server as one Layer: the toolkit registered on a stdio McpServer,
// The handlers backed by a TipeeClient configured from the environment. Logs
// Go to stderr because stdout is the MCP channel.

import { NodeFileSystem, NodeStdio } from '@effect/platform-node';
import { TipeeClient } from '@tipee-tools/core';
import type { ConfigurationMissing } from '@tipee-tools/core';
import { Effect, Layer, Logger } from 'effect';
import type { Cause } from 'effect';
import { McpProtocol, McpServer } from 'effect/unstable/ai';
import { FetchHttpClient } from 'effect/unstable/http';

import { TipeeToolkitLayer } from './Handlers.ts';
import { SetupPrompt } from './Prompts.ts';
import { Telemetry } from './Telemetry.ts';
import { TipeeToolkit } from './Tools.ts';

export const SERVER_NAME = 'tipee';
export const SERVER_VERSION = '0.3.0';

// One event per start, so versions in use can be told apart.
const Started = Layer.effectDiscard(
  Effect.flatMap(Telemetry, (telemetry) => telemetry.capture('server_started')),
);

export const ServerLayer = Layer.mergeAll(
  McpServer.toolkit(TipeeToolkit),
  SetupPrompt,
  Started,
).pipe(
  Layer.provide(TipeeToolkitLayer),
  Layer.provide(
    McpServer.layerStdio({
      description:
        'Tipee for Claude: people, teams, shifts, absences, on-calls, activities and time clock.',
      name: SERVER_NAME,
      protocols: [
        McpProtocol.v2025_11_25,
        McpProtocol.v2025_06_18,
        McpProtocol.v2025_03_26,
        McpProtocol.v2024_11_05,
      ],
      version: SERVER_VERSION,
    }),
  ),
  Layer.provide(TipeeClient.layerConfig),
  Layer.provide(Telemetry.layer({ $lib_version: SERVER_VERSION, server_version: SERVER_VERSION })),
  Layer.provide(FetchHttpClient.layer),
  Layer.provide(NodeFileSystem.layer),
  Layer.provide(NodeStdio.layer),
  Layer.provide(Layer.succeed(Logger.LogToStderr, true)),
);

/** The whole server as one effect that runs until the client disconnects. */
export const main: Effect.Effect<never, ConfigurationMissing | Cause.IllegalArgumentError> =
  Layer.launch(ServerLayer);
