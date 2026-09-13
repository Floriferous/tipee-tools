// Bundles the MCP server, dependencies included, into `server/`. Claude Code
// Runs the file with plain `node`; nothing is installed on the user's side.

import { defineConfig } from 'tsdown';

export default defineConfig({
  clean: true,
  deps: { alwaysBundle: [/.*/u] },
  dts: false,
  entry: { 'tipee-mcp': 'src/main.ts' },
  format: 'esm',
  outDir: 'server',
  platform: 'node',
});
