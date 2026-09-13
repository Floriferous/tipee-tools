// Bundles the MCP server, dependencies included, into the Claude Code plugin
// Directory. The plugin runs it with plain `node`; nothing is installed.

import { defineConfig } from 'tsdown';

export default defineConfig({
  clean: true,
  deps: { alwaysBundle: [/.*/u] },
  dts: false,
  entry: { 'tipee-mcp': 'src/main.ts' },
  format: 'esm',
  outDir: '../../plugins/tipee/server',
  platform: 'node',
});
