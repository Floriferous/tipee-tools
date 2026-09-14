// The update check against a fake GitHub: newer, same, unreachable, cached.

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { NodeFileSystem } from '@effect/platform-node';
import { describe, expect, it } from '@effect/vitest';
import { server } from '@tipee-tools/core/testing';
import { ConfigProvider, Effect, Layer, Option } from 'effect';
import { FetchHttpClient } from 'effect/unstable/http';
import { HttpResponse, http } from 'msw';

import { Updates, isNewer } from '../src/index.ts';

const RELEASES = 'https://github.test/releases/latest';
let asked = 0;
const github = (tag: string) =>
  http.get(RELEASES, () => {
    asked += 1;
    return HttpResponse.json({ html_url: `https://github.test/tag/${tag}`, tag_name: tag });
  });

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
});
