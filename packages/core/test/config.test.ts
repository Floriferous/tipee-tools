// The configuration as users paste it: the instance in any form a browser or
// a colleague gives it, the key with stray whitespace, or nothing at all.

import { describe, expect, it } from '@effect/vitest';
import { ConfigProvider, Effect, Layer, Option } from 'effect';
import { FetchHttpClient } from 'effect/http';

import { TipeeClient, normalizeInstance } from '../src/index.ts';
import { call, failure } from './answers.ts';
import { API_KEY } from './handlers.ts';

const withProvider = (values: Record<string, string>) =>
  Layer.provide(
    TipeeClient.layerConfig,
    Layer.mergeAll(FetchHttpClient.layer, ConfigProvider.layer(ConfigProvider.fromUnknown(values))),
  );

describe('configuration', () => {
  it.each([
    ['acme', 'acme'],
    [' ACME ', 'acme'],
    ['acme.tipee.net', 'acme'],
    ['acme.tipee.net/', 'acme'],
    ['https://acme.tipee.net', 'acme'],
    ['https://acme.tipee.net/hr-core/integrations', 'acme'],
    ['http://Acme-Group.tipee.net/', 'acme-group'],
  ])('reads the instance %j as %j', (raw, instance) => {
    expect(normalizeInstance(raw)).toEqual(Option.some(instance));
  });

  it.each([
    '',
    '   ',
    'acme ch',
    'evil.example#',
    'evil.example',
    'acme.tipee.net.evil.example',
    'acme:443',
    '-acme',
    'user@acme',
    // What Claude passes when a setting was never filled in.
    '${user_config.instance}',
  ])('refuses the instance %j', (raw) => {
    expect(normalizeInstance(raw)).toEqual(Option.none());
  });

  it.effect('accepts an instance and a key as pasted', () =>
    Effect.gen(function* () {
      const kinds = (yield* call('kinds_list', {})) as ReadonlyArray<unknown>;

      expect(kinds.length).toBeGreaterThan(0);
    }).pipe(
      Effect.provide(
        withProvider({ TIPEE_API_KEY: ` ${API_KEY}\n`, TIPEE_INSTANCE: 'https://ACME.tipee.net/' }),
      ),
    ),
  );

  it.effect('rejects a wrong key with an explanation', () =>
    Effect.gen(function* () {
      const error = yield* failure(call('kinds_list', {}));

      expect(error.reason._tag).toBe('ApiKeyRejected');
      expect(error.message).toMatch(/^Tipee refused the API key \(HTTP 401\): /u);
      expect(error.message).toContain('https://acme.tipee.net/hr-core/integrations');
    }).pipe(Effect.provide(withProvider({ TIPEE_API_KEY: 'wrong', TIPEE_INSTANCE: 'acme' }))),
  );

  it.effect('explains missing configuration without calling Tipee', () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(Layer.build(withProvider({})));

      expect(error._tag).toBe('ConfigurationMissing');
      expect(error.message).toMatch(/^Tipee is not set up: .*Tipee settings in Claude \(.*\)\.\n/u);
    }).pipe(Effect.scoped),
  );

  it.effect.each<readonly [Record<string, string>, string]>([
    [{ TIPEE_INSTANCE: 'acme' }, 'The API key is empty: paste the key generated'],
    [{ TIPEE_API_KEY: '   ', TIPEE_INSTANCE: 'acme' }, 'The API key is empty'],
    [{ TIPEE_API_KEY: API_KEY }, 'The Tipee instance is empty'],
    [{ TIPEE_API_KEY: API_KEY, TIPEE_INSTANCE: ' ' }, 'The Tipee instance is empty'],
    // What Claude passes when a setting was never filled in.
    [{ TIPEE_API_KEY: API_KEY, TIPEE_INSTANCE: '${user_config.instance}' }, 'The Tipee instance'],
    [{ TIPEE_API_KEY: '${user_config.api_key}', TIPEE_INSTANCE: 'acme' }, 'The API key is empty'],
  ])('names the setting that is missing or blank in %j', ([values, detail]) =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(Layer.build(withProvider(values)));

      expect(error._tag).toBe('ConfigurationMissing');
      expect(error.message).toContain(`\n${detail}`);
    }).pipe(Effect.scoped),
  );

  it.effect('refuses an instance that is not one, quoting it', () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        Layer.build(withProvider({ TIPEE_API_KEY: API_KEY, TIPEE_INSTANCE: 'evil.example#' })),
      );

      expect(error._tag).toBe('ConfigurationMissing');
      expect(error.message).toContain('"evil.example#" is not a Tipee instance');
    }).pipe(Effect.scoped),
  );
});
