// Where the plugin thinks it runs, and the id that stands for one person.

import { describe, expect, it } from '@effect/vitest';

import { channelOf, installationId } from '../src/index.ts';

describe('install', () => {
  it('reads the channel off the path the server runs from', () => {
    const desktop =
      '/Users/someone/Library/Application Support/Claude/Claude Extensions/local.mcpb.x.tipee/server/tipee-mcp.mjs';
    const plugin =
      '/Users/someone/.claude/plugins/cache/tipee-tools/tipee/0.3.5/server/tipee-mcp.mjs';
    const repo = '/Users/someone/dev/tipee-tools/packages/mcp/src/main.ts';

    expect(channelOf(desktop)).toBe('desktop');
    expect(channelOf(plugin)).toBe('plugin');
    expect(channelOf(repo)).toBe('dev');
    expect(channelOf('')).toBe('dev');
  });

  it('gives one stable id per machine and account, shaped like a uuid', () => {
    const id = installationId();

    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u);
    expect(installationId()).toBe(id);
  });
});
