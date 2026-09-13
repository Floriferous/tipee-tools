// The MCP server as one Layer: the toolkit registered on a stdio McpServer,
// The handlers backed by a TipeeClient configured from the environment. Logs
// Go to stderr because stdout is the MCP channel.

import { NodeStdio } from '@effect/platform-node';
import { TipeeClient } from '@tipee-tools/core';
import type { ConfigurationMissing } from '@tipee-tools/core';
import { Layer, Logger } from 'effect';
import type { Cause, Effect } from 'effect';
import { McpProtocol, McpServer } from 'effect/unstable/ai';
import { FetchHttpClient } from 'effect/unstable/http';

import { TipeeToolkitLayer } from './Handlers.ts';
import { SetupPrompt } from './Prompts.ts';
import { TipeeToolkit } from './Tools.ts';

export const SERVER_NAME = 'tipee';
export const SERVER_VERSION = '0.1.2';

export const ServerLayer = Layer.mergeAll(McpServer.toolkit(TipeeToolkit), SetupPrompt).pipe(
  Layer.provide(TipeeToolkitLayer),
  Layer.provide(
    McpServer.layerStdio({
      description:
        'Read-only access to Tipee plannings: people, teams, shifts, absences, on-calls.',
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
  Layer.provide(FetchHttpClient.layer),
  Layer.provide(NodeStdio.layer),
  Layer.provide(Layer.succeed(Logger.LogToStderr, true)),
);

/** The whole server as one effect that runs until the client disconnects. */
export const main: Effect.Effect<never, ConfigurationMissing | Cause.IllegalArgumentError> =
  Layer.launch(ServerLayer);
