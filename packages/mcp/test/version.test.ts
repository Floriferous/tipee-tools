// One version, written in three places: the plugin manifest, which Claude
// Code and the release job read; SERVER_VERSION, which names the release the
// update tool downloads; and the tag the marketplace installs the plugin
// from. They must agree, or a release cannot be found by its own users.

import { layer as nodeServices } from '@effect/platform-node/NodeServices';
import { expect, layer } from '@effect/vitest';
import { Array as Arr, Effect, FileSystem, Option, Path, Schema } from 'effect';

import { SERVER_VERSION } from '../src/index.ts';
import { fromJson } from './wire.ts';

const Manifest = Schema.Struct({ version: Schema.optionalKey(Schema.Unknown) });
const Marketplace = Schema.Struct({
  plugins: Schema.Array(Schema.Struct({ name: Schema.String, source: Schema.Unknown })),
});

// Reads a JSON file of the repository, from its path relative to this one.
const readJson = Effect.fn('readJson')(function* <S extends Schema.ConstraintDecoder<unknown>>(
  relative: string,
  schema: S,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const file = yield* path.fromFileUrl(new URL(relative, import.meta.url));
  const text = yield* fs.readFileString(file);
  return yield* fromJson(schema)(text);
});

layer(nodeServices)('version', (it) => {
  it.effect('plugin.json matches SERVER_VERSION', () =>
    Effect.gen(function* () {
      const { version } = yield* readJson(
        '../../../plugins/tipee/.claude-plugin/plugin.json',
        Manifest,
      );

      expect(version).toBe(SERVER_VERSION);
    }),
  );

  // Claude Code installs the plugin at this tag, never from main: merging
  // work ships nothing until a release bumps the version and this ref.
  it.effect('the marketplace installs the plugin from the tag of SERVER_VERSION', () =>
    Effect.gen(function* () {
      const { plugins } = yield* readJson('../../../.claude-plugin/marketplace.json', Marketplace);
      const tipee = Arr.findFirst(plugins, (plugin) => plugin.name === 'tipee');

      expect(Option.getOrUndefined(tipee)?.source).toEqual({
        path: 'plugins/tipee',
        ref: `v${SERVER_VERSION}`,
        source: 'git-subdir',
        url: 'Floriferous/tipee-tools',
      });
    }),
  );
});
