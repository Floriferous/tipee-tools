// Bundles the MCP server, dependencies included, into `server/`. Claude Code
// runs the file with plain `node`; nothing is installed on the user's side.

import { defineConfig } from 'tsdown';

export default defineConfig({
  clean: true,
  deps: { alwaysBundle: [/.*/u] },
  dts: false,
  entry: { 'tipee-mcp': 'src/main.ts' },
  format: 'esm',
  outDir: 'server',
  // Effect's JSDoc is most of its source and none of its behaviour; legal and
  // `@__PURE__` comments stay.
  outputOptions: { comments: { jsdoc: false } },
  platform: 'node',
  // The oldest Node the extension declares (see scripts/pack-mcpb.ts).
  target: 'node22.19',
});
