// The plugin's entry point: the MCP server, bundled from here so the file
// Lands next to the manifest. Configuration arrives in the environment: from
// The plugin's userConfig in Claude Code (see .mcp.json), from the settings of
// The extension in Claude Desktop (see scripts/pack-mcpb.ts).

import { start } from '@tipee-tools/mcp';

start();
