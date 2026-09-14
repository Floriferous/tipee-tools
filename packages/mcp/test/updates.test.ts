// The update check against a fake GitHub: newer, same, unreachable, cached.

import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { NodeFileSystem } from '@effect/platform-node';
import { describe, expect, it } from '@effect/vitest';
import { server } from '@tipee-tools/core/testing';
import { ConfigProvider, Effect, Layer, Option } from 'effect';
import { FetchHttpClient } from 'effect/unstable/http';
import { HttpResponse, http } from 'msw';

import { Updates, checksumOf, isNewer } from '../src/index.ts';

const tmpdir = (): string => process.env.TMPDIR ?? '/tmp';
const RELEASES = 'https://github.test/releases/latest';
const DOWNLOADS = 'https://github.test/download';
const BUNDLE = new TextEncoder().encode('not really a zip, but the bytes we expect');
const bundleAt = (
  version: string,
  checksum = createHash('sha256').update(BUNDLE).digest('hex'),
) => [
  http.get(`${DOWNLOADS}/v${version}/SHA256SUMS`, () =>
    HttpResponse.text(`${checksum}  tipee-${version}.mcpb\n${checksum}  tipee.mcpb\n`),
  ),
  http.get(`${DOWNLOADS}/v${version}/tipee-${version}.mcpb`, () =>
    HttpResponse.arrayBuffer(BUNDLE.buffer),
  ),
];
let asked = 0;
const github = (tag: string) =>
  http.get(RELEASES, () => {
    asked += 1;
    return HttpResponse.json({ html_url: `https://github.test/tag/${tag}`, tag_name: tag });
  });

const layerFor = (current: string, stateDir: string, channel: string) =>
  Updates.layer(current).pipe(
    Layer.provide(
      Layer.mergeAll(
        FetchHttpClient.layer,
        NodeFileSystem.layer,
        ConfigProvider.layer(
          ConfigProvider.fromUnknown({
            TIPEE_DOWNLOAD_BASE: DOWNLOADS,
            TIPEE_OPENER: '/usr/bin/true',
            TIPEE_RELEASES_URL: RELEASES,
            TIPEE_STATE_DIR: stateDir,
            TIPEE_UPDATE_CHANNEL: channel,
          }),
        ),
      ),
    ),
  );

const installFor = (
  current: string,
  channel = 'desktop',
  stateDir = mkdtempSync(path.join(tmpdir(), 'tipee-up-')),
) =>
  Effect.flatMap(Updates, (updates) => updates.install).pipe(
    Effect.provide(layerFor(current, stateDir, channel)),
    Effect.map((outcome) => ({ outcome, stateDir })),
  );

const updatesFor = (current: string, stateDir = mkdtempSync(path.join(tmpdir(), 'tipee-up-'))) =>
  Effect.flatMap(Updates, (updates) => updates.available).pipe(
    Effect.provide(
      Updates.layer(current).pipe(
        Layer.provide(
          Layer.mergeAll(
            FetchHttpClient.layer,
            NodeFileSystem.layer,
            ConfigProvider.layer(
              ConfigProvider.fromUnknown({
                TIPEE_RELEASES_URL: RELEASES,
                TIPEE_STATE_DIR: stateDir,
              }),
            ),
          ),
        ),
      ),
    ),
  );

describe('updates', () => {
  it('compares versions numerically', () => {
    expect(isNewer('0.3.10', '0.3.9')).toBe(true);
    expect(isNewer('v0.4.0', '0.3.11')).toBe(true);
    expect(isNewer('0.3.1', '0.3.1')).toBe(false);
    expect(isNewer('0.3.0', '0.3.1')).toBe(false);
    expect(isNewer('latest', '0.3.1')).toBe(false);
  });

  it.effect('reports a newer release with its link, once a day', () =>
    Effect.gen(function* () {
      asked = 0;
      server.use(github('v0.4.0'));
      const stateDir = mkdtempSync(path.join(tmpdir(), 'tipee-up-'));
      const first = yield* updatesFor('0.3.1', stateDir);
      const second = yield* updatesFor('0.3.1', stateDir);

      expect(Option.getOrUndefined(first)).toMatchObject({
        url: 'https://github.test/tag/v0.4.0',
        version: '0.4.0',
      });
      expect(Option.isSome(second)).toBe(true);
      expect(asked).toBe(1);
    }),
  );

  it.effect('reports nothing when up to date or when GitHub cannot be reached', () =>
    Effect.gen(function* () {
      server.use(github('v0.3.1'));
      const same = yield* updatesFor('0.3.1');
      server.use(http.get(RELEASES, () => HttpResponse.error()));
      const unreachable = yield* updatesFor('0.3.1');

      expect(Option.isNone(same)).toBe(true);
      expect(Option.isNone(unreachable)).toBe(true);
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
      server.use(github('v0.4.0'), ...bundleAt('0.4.0'));
      const { outcome, stateDir } = yield* installFor('0.3.1');

      expect(outcome).toMatchObject({ status: 'opened', version: '0.4.0' });
      const file = path.join(stateDir, 'updates', 'tipee-0.4.0.mcpb');
      expect(existsSync(file)).toBe(true);
      expect(new Uint8Array(readFileSync(file))).toEqual(BUNDLE);
    }),
  );

  it.effect('refuses a bundle whose checksum does not match', () =>
    Effect.gen(function* () {
      server.use(github('v0.4.0'), ...bundleAt('0.4.0', 'deadbeef'));
      const error = yield* Effect.flip(installFor('0.3.1'));

      expect(error._tag).toBe('UpdateFailed');
      expect(error.message).toMatch(/checksum/u);
    }),
  );

  it.effect('gives Claude Code users the commands, and says when nothing is newer', () =>
    Effect.gen(function* () {
      server.use(github('v0.4.0'));
      const plugin = yield* installFor('0.3.1', 'plugin');
      server.use(github('v0.3.1'));
      const same = yield* installFor('0.3.1');

      expect(plugin.outcome).toMatchObject({ status: 'instructions', version: '0.4.0' });
      expect(same.outcome).toEqual({ status: 'up_to_date' });
    }),
  );
});
