// One version, written in two places: the plugin manifest, which Claude Code
// and the release job read, and SERVER_VERSION, which names the release the
// update tool downloads. They must agree, or a release cannot be found by its
// own users.

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { SERVER_VERSION } from '../src/index.ts';

describe('version', () => {
  it('plugin.json matches SERVER_VERSION', () => {
    const manifest = new URL('../../../plugins/tipee/.claude-plugin/plugin.json', import.meta.url);
    const { version } = JSON.parse(readFileSync(manifest, 'utf8')) as { version?: unknown };

    expect(version).toBe(SERVER_VERSION);
  });
});
