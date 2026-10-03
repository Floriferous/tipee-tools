// One version, written in five places: the plugin manifest, the three
// packages, and SERVER_VERSION, which names the release the update tool
// downloads. They must agree, or a release cannot be found by its own users.

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { SERVER_VERSION } from '../src/index.ts';

const versionOf = (file: string): unknown =>
  (JSON.parse(readFileSync(new URL(file, import.meta.url), 'utf8')) as { version?: unknown })
    .version;

describe('version', () => {
  it.each([
    '../../../plugins/tipee/.claude-plugin/plugin.json',
    '../../../plugins/tipee/package.json',
    '../../core/package.json',
    '../package.json',
  ])('%s matches SERVER_VERSION', (file) => {
    expect(versionOf(file)).toBe(SERVER_VERSION);
  });
});
