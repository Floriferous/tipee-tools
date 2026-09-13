// The plugin's entry point: the MCP server, bundled from here so the file
// Lands next to the manifest. Configuration arrives in the environment from
// The plugin's userConfig (see .mcp.json).

import { NodeRuntime } from '@effect/platform-node';
import { main } from '@tipee-tools/mcp';

NodeRuntime.runMain(main);
