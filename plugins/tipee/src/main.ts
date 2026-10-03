// The plugin's entry point: the MCP server, bundled from here so the file
// lands next to the manifest. Configuration arrives in the environment: from
// the plugin's userConfig in Claude Code (see .mcp.json), from the settings of
// the extension in Claude Desktop (see scripts/pack-mcpb.ts).

import { start } from '@tipee-tools/mcp';

start();
