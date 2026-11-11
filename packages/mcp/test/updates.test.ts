// The update check and install against a fake GitHub: newer, same,
// unreachable, a bundle that does not match, and each way to hand it over.

import { layer as nodeServices } from '@effect/platform-node/NodeServices';
import { expect, layer } from '@effect/vitest';
import { server } from '@tipee-tools/core/testing';
import { ConfigProvider, Context, Effect, FileSystem, Layer, Option, Path } from 'effect';
import { Digest } from 'effect/crypto';
import { FetchHttpClient } from 'effect/http';
import { HttpResponse, http } from 'msw/http';

import { Updates, checksumOf, isNewer } from '../src/index.ts';

const RELEASES = 'https://github.test/releases/latest';
const DOWNLOADS = 'https://github.test/download';
const BUNDLE = new TextEncoder().encode('not really a zip, but the bytes we expect');
// The bundle's release, listed with its real checksum unless told otherwise.
const bundleAt = Effect.fn('bundleAt')(function* (version: string, checksum?: string) {
  const digest = yield* Digest.Digest;
  const listed = checksum ?? (yield* digest.digestHex(Digest.sha256, BUNDLE));
  return [
    http.get(`${DOWNLOADS}/v${version}/SHA256SUMS`, () =>
      HttpResponse.text(`${listed}  tipee-${version}.mcpb\n${listed}  tipee.mcpb\n`),
    ),
    http.get(`${DOWNLOADS}/v${version}/tipee-${version}.mcpb`, () =>
      HttpResponse.arrayBuffer(BUNDLE.buffer),
    ),
  ];
});
// The bytes of a file the install left, as plain bytes rather than a Buffer.
const bytesOf = Effect.fn('bytesOf')(function* (file: string) {
  const fs = yield* FileSystem.FileSystem;
  const read = yield* fs.readFile(file);
  return new Uint8Array(read);
});
const github = (tag: string) =>
  http.get(RELEASES, () =>
    HttpResponse.json({ html_url: `https://github.test/tag/${tag}`, tag_name: tag }),
  );

interface Setup {
  readonly channel?: string;
  readonly opener?: string;
}

// The service for a running `current` version, configured like a Claude
// Desktop install that can open files unless told otherwise, and released
// once used.
const using = <A, E>(
  current: string,
  use: (updates: (typeof Updates)['Service']) => Effect.Effect<A, E>,
  { channel = 'desktop', opener = '/usr/bin/true' }: Setup = {},
) =>
  Layer.build(
    Updates.layer(current).pipe(
      Layer.provide(
        Layer.mergeAll(
          FetchHttpClient.layer,
          ConfigProvider.layer(
            // An empty opener is what a platform without one gets by default.
            ConfigProvider.fromUnknown(
              {
                TIPEE_DOWNLOAD_BASE: DOWNLOADS,
                TIPEE_OPENER: opener,
                TIPEE_RELEASES_URL: RELEASES,
                TIPEE_UPDATE_CHANNEL: channel,
              },
              { preserveEmptyStrings: true },
            ),
          ),
        ),
      ),
    ),
  ).pipe(
    Effect.flatMap((services) => use(Context.get(services, Updates))),
    Effect.scoped,
  );

const available = (current: string) => using(current, (updates) => updates.available);
const install = (current: string, setup?: Setup) =>
  using(current, (updates) => updates.install, setup);

layer(Layer.mergeAll(nodeServices, Digest.layerWebCrypto))('updates', (it) => {
  it('compares versions numerically', () => {
    expect(isNewer('0.3.10', '0.3.9')).toBe(true);
    expect(isNewer('v0.4.0', '0.3.11')).toBe(true);
    expect(isNewer('0.3.1', '0.3.1')).toBe(false);
    expect(isNewer('0.3.0', '0.3.1')).toBe(false);
    expect(isNewer('latest', '0.3.1')).toBe(false);
  });

  it.effect('reports a newer release with its link', () =>
    Effect.gen(function* () {
      server.use(github('v0.4.0'));
      const update = yield* available('0.3.1');

      expect(Option.getOrUndefined(update)).toMatchObject({
        url: 'https://github.test/tag/v0.4.0',
        version: '0.4.0',
      });
    }),
  );

  it.effect('reports nothing when up to date or when GitHub cannot be reached', () =>
    Effect.gen(function* () {
      server.use(github('v0.3.1'));
      const same = yield* available('0.3.1');
      server.use(http.get(RELEASES, () => HttpResponse.error()));
      const unreachable = yield* available('0.3.1');

      expect(Option.isNone(same)).toBe(true);
      expect(Option.isNone(unreachable)).toBe(true);
    }),
  );

  it.effect(
    'fails an install, rather than say it is up to date, when GitHub cannot be reached',
    () =>
      Effect.gen(function* () {
        server.use(http.get(RELEASES, () => HttpResponse.error()));
        const error = yield* Effect.flip(install('0.3.1'));

        expect(error._tag).toBe('UpdateFailed');
        expect(error.message).toMatch(/could not look up the latest release on GitHub/u);
        expect(error.message).toContain(
          'Download tipee.mcpb from https://github.com/Floriferous/tipee-tools/releases/latest',
        );
      }),
  );

  it('reads a checksum list the way sha256sum writes it', () => {
    const sums = 'abc  tipee-0.4.0.mcpb\ndef *tipee.mcpb\n';

    expect(checksumOf(sums, 'tipee-0.4.0.mcpb')).toBe('abc');
    expect(checksumOf(sums, 'tipee.mcpb')).toBe('def');
    expect(checksumOf(sums, 'other')).toBeUndefined();
  });

  it.effect('downloads the verified bundle and hands it to Claude Desktop', () =>
    Effect.gen(function* () {
      server.use(github('v0.4.0'), ...(yield* bundleAt('0.4.0')));
      const outcome = yield* install('0.3.1');

      expect(outcome).toMatchObject({ status: 'opened', version: '0.4.0' });
      const path = yield* Path.Path;
      const file = 'path' in outcome ? outcome.path : '';
      const bytes = yield* bytesOf(file);
      expect(path.basename(file)).toBe('tipee-0.4.0.mcpb');
      expect(bytes).toEqual(BUNDLE);
    }),
  );

  it.effect('leaves the bundle for the user to open when nothing here can', () =>
    Effect.gen(function* () {
      server.use(github('v0.4.0'), ...(yield* bundleAt('0.4.0')));
      const outcome = yield* install('0.3.1', { opener: '' });

      expect(outcome).toMatchObject({ status: 'downloaded', version: '0.4.0' });
      const bytes = yield* bytesOf('path' in outcome ? outcome.path : '');
      expect(bytes).toEqual(BUNDLE);
    }),
  );

  it.effect('fails, without crashing, when the opener cannot start', () =>
    Effect.gen(function* () {
      server.use(github('v0.4.0'), ...(yield* bundleAt('0.4.0')));
      const error = yield* Effect.flip(install('0.3.1', { opener: '/nonexistent/opener' }));

      expect(error._tag).toBe('UpdateFailed');
      expect(error.message).toMatch(/could not open .*ENOENT/u);
    }),
  );

  it.effect('fails, without crashing, when spawning the opener throws', () =>
    Effect.gen(function* () {
      server.use(github('v0.4.0'), ...(yield* bundleAt('0.4.0')));
      // A path through a file: Node throws ENOTDIR instead of emitting it.
      const opener = `${process.execPath}/opener`;
      const error = yield* Effect.flip(install('0.3.1', { opener }));

      expect(error._tag).toBe('UpdateFailed');
      expect(error.message).toMatch(/could not open .*ENOTDIR/u);
    }),
  );

  it.effect('refuses a bundle whose checksum does not match', () =>
    Effect.gen(function* () {
      server.use(github('v0.4.0'), ...(yield* bundleAt('0.4.0', 'deadbeef')));
      const error = yield* Effect.flip(install('0.3.1'));

      expect(error._tag).toBe('UpdateFailed');
      expect(error.message).toMatch(/checksum/u);
      expect(error.message).toContain(
        'Download tipee.mcpb from https://github.com/Floriferous/tipee-tools/releases/latest',
      );
    }),
  );

  it.effect('gives Claude Code users the commands, and says when nothing is newer', () =>
    Effect.gen(function* () {
      server.use(github('v0.4.0'));
      const plugin = yield* install('0.3.1', { channel: 'plugin' });
      server.use(github('v0.3.1'));
      const same = yield* install('0.3.1');

      expect(plugin).toMatchObject({ status: 'instructions', version: '0.4.0' });
      expect(same).toEqual({ status: 'up_to_date' });
    }),
  );
});
