// One version, written in three places: the plugin manifest, which Claude
// Code and the release job read; SERVER_VERSION, which names the release the
// update tool downloads; and the tag the marketplace installs the plugin
// from. They must agree, or a release cannot be found by its own users.

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { SERVER_VERSION } from '../src/index.ts';

describe('version', () => {
  it('plugin.json matches SERVER_VERSION', () => {
    const manifest = new URL('../../../plugins/tipee/.claude-plugin/plugin.json', import.meta.url);
    const { version } = JSON.parse(readFileSync(manifest, 'utf8')) as { version?: unknown };

    expect(version).toBe(SERVER_VERSION);
  });

  // Claude Code installs the plugin at this tag, never from main: merging
  // work ships nothing until a release bumps the version and this ref.
  it('the marketplace installs the plugin from the tag of SERVER_VERSION', () => {
    const marketplace = new URL('../../../.claude-plugin/marketplace.json', import.meta.url);
    const { plugins } = JSON.parse(readFileSync(marketplace, 'utf8')) as {
      plugins: ReadonlyArray<{ name: string; source: unknown }>;
    };

    expect(plugins.find((plugin) => plugin.name === 'tipee')?.source).toEqual({
      path: 'plugins/tipee',
      ref: `v${SERVER_VERSION}`,
      source: 'git-subdir',
      url: 'Floriferous/tipee-tools',
    });
  });
});
