// Whether a newer release exists: the plugin has no channel to update itself
// Through, so `check` and the setup prompt tell the user, with the download
// Link. GitHub's latest release is asked at most once a day and the answer
// Kept next to the telemetry id; every failure means "nothing to report".

import { homedir } from 'node:os';
import path from 'node:path';

import { Config, Context, Effect, FileSystem, Layer, Option, Schema } from 'effect';
import { HttpClient, HttpClientResponse } from 'effect/unstable/http';

export const RELEASES_URL = 'https://api.github.com/repos/Floriferous/tipee-tools/releases/latest';
export const DOWNLOAD_URL = 'https://github.com/Floriferous/tipee-tools/releases/latest';

/** A release newer than the one running. */
export class Update extends Schema.Class<Update>('Update')({
  /** Where to get it. */
  url: Schema.String,
  version: Schema.String,
}) {}

const Release = Schema.Struct({
  body: Schema.Struct({
    html_url: Schema.String,
    tag_name: Schema.String,
  }),
});

const Cached = Schema.Struct({
  checked_at: Schema.String,
  url: Schema.String,
  version: Schema.String,
});
const CachedJson = Schema.fromJsonString(Cached);

/** The cached answer is older than a day. */
class Stale extends Schema.TaggedError<Stale>()('Stale', {}) {}

const CACHE_FILE = 'latest-release.json';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT = '3 seconds';

const settings = Config.all({
  releasesUrl: Config.String('TIPEE_RELEASES_URL').pipe(Config.withDefault(RELEASES_URL)),
  stateDir: Config.String('TIPEE_STATE_DIR').pipe(
    Config.withDefault(path.join(homedir(), '.tipee-tools')),
  ),
});

const PART = /^\d+$/u;

// "0.3.10" is newer than "0.3.9"; anything unparseable is not newer.
export const isNewer = (candidate: string, current: string): boolean => {
  const parse = (version: string): ReadonlyArray<number> | undefined => {
    const parts = version.replace(/^v/u, '').split('.');
    return parts.every((part) => PART.test(part)) ? parts.map(Number) : undefined;
  };
  const left = parse(candidate);
  const right = parse(current);
  if (left === undefined || right === undefined) {
    return false;
  }
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) {
      return difference > 0;
    }
  }
  return false;
};

export class Updates extends Context.Service<
  Updates,
  {
    /** The newer release, if one is known. Never fails. */
    readonly available: Effect.Effect<Option.Option<Update>>;
  }
>()('@tipee-tools/mcp/Updates') {
  // Never reports an update: for tests.
  public static readonly layerNone: Layer.Layer<Updates> = Layer.succeed(Updates, {
    available: Effect.succeedNone,
  });

  // Compares GitHub's latest release with `current`.
  public static readonly layer = (
    current: string,
  ): Layer.Layer<Updates, never, HttpClient.HttpClient | FileSystem.FileSystem> =>
    Layer.effect(
      Updates,
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const http = yield* HttpClient.HttpClient;
        const config = yield* Effect.option(settings);
        if (Option.isNone(config)) {
          return { available: Effect.succeedNone };
        }
        const { releasesUrl, stateDir } = config.value;
        const file = path.join(stateDir, CACHE_FILE);

        const cached = fs.readFileString(file).pipe(
          Effect.flatMap(Schema.decodeEffect(CachedJson)),
          Effect.filterOrFail(
            (entry) => Date.now() - Date.parse(entry.checked_at) < CACHE_TTL_MS,
            () => new Stale(),
          ),
          Effect.map((entry) => ({ url: entry.url, version: entry.version })),
        );
        const fetched = http.get(releasesUrl).pipe(
          Effect.flatMap(HttpClientResponse.schemaJson(Release)),
          Effect.timeout(FETCH_TIMEOUT),
          Effect.map(({ body }) => ({
            url: body.html_url,
            version: body.tag_name.replace(/^v/u, ''),
          })),
          Effect.tap((latest) =>
            Effect.option(
              Effect.flatMap(fs.makeDirectory(stateDir, { recursive: true }), () =>
                fs.writeFileString(
                  file,
                  JSON.stringify({ checked_at: new Date().toISOString(), ...latest }),
                ),
              ),
            ),
          ),
        );

        const available = Effect.gen(function* () {
          const known = yield* Effect.option(cached);
          const latest = Option.isSome(known) ? known.value : yield* fetched;
          return isNewer(latest.version, current)
            ? Option.some(new Update({ url: latest.url, version: latest.version }))
            : Option.none<Update>();
        }).pipe(Effect.orElseSucceed(() => Option.none<Update>()));
        return { available };
      }),
    );
}
