// Whether a newer release exists, and installing it. The plugin has no
// Channel to update itself through, so `check` reports a newer release and
// The `update` tool installs it: in Claude Desktop it downloads the bundle
// From this repository's releases, verifies its checksum, and opens it, which
// Makes Claude Desktop ask the user to confirm the update; the instance and
// Key are kept. GitHub's latest release is asked at most once a day and the
// Answer kept next to the telemetry id; a failed lookup means "nothing to
// Report".

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';
import { argv, platform } from 'node:process';

import { Config, Context, Effect, FileSystem, Layer, Option, Schema } from 'effect';
import { HttpClient, HttpClientResponse } from 'effect/unstable/http';

export const RELEASES_URL = 'https://api.github.com/repos/Floriferous/tipee-tools/releases/latest';
export const DOWNLOAD_BASE = 'https://github.com/Floriferous/tipee-tools/releases/download';

/** A release newer than the one running. */
export class Update extends Schema.Class<Update>('Update')({
  /** Where to get it. */
  url: Schema.String,
  version: Schema.String,
}) {}

/** The update could not be installed; the detail says why. */
export class UpdateFailed extends Schema.TaggedError<UpdateFailed>()('UpdateFailed', {
  detail: Schema.String,
}) {
  public override get message(): string {
    return `The update could not be installed: ${this.detail}`;
  }
}

/** What installing did: the tool's answer builds its message from this. */
export const Installed = Schema.Union([
  Schema.Struct({ status: Schema.Literal('up_to_date') }),
  /** Claude Desktop is showing its update dialog. */
  Schema.Struct({ path: Schema.String, status: Schema.Literal('opened'), version: Schema.String }),
  /** Downloaded, but nothing here can open it: the user opens the file. */
  Schema.Struct({
    path: Schema.String,
    status: Schema.Literal('downloaded'),
    version: Schema.String,
  }),
  /** A Claude Code plugin install: it updates with commands, not a file. */
  Schema.Struct({
    status: Schema.Literal('instructions'),
    url: Schema.String,
    version: Schema.String,
  }),
]);
export type Installed = typeof Installed.Type;

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
const DOWNLOAD_TIMEOUT = '60 seconds';
const BUNDLE_LIMIT = 50 * 1024 * 1024;
const CHECKSUMS = 'SHA256SUMS';

// A Claude Desktop extension runs from Claude's extensions folder; anything
// Else is the Claude Code plugin, which has no file to open.
const detectedChannel = (argv[1] ?? '').includes('Claude Extensions') ? 'desktop' : 'plugin';

// Overridable so tests and forks can point elsewhere; the opener is what
// Hands the downloaded bundle to Claude Desktop (macOS only for now).
const settings = Config.all({
  channel: Config.String('TIPEE_UPDATE_CHANNEL').pipe(Config.withDefault(detectedChannel)),
  downloadBase: Config.String('TIPEE_DOWNLOAD_BASE').pipe(Config.withDefault(DOWNLOAD_BASE)),
  opener: Config.String('TIPEE_OPENER').pipe(
    Config.withDefault(platform === 'darwin' ? 'open' : ''),
  ),
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

// The published checksum of one asset, from "hash  name" lines.
export const checksumOf = (sums: string, asset: string): string | undefined =>
  sums
    .split('\n')
    .map((line) => line.trim().split(/\s+/u))
    .find(([, name]) => name === asset || name === `*${asset}`)?.[0];

const failed = (detail: string): UpdateFailed => new UpdateFailed({ detail });

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export class Updates extends Context.Service<
  Updates,
  {
    /** The newer release, if one is known. Never fails. */
    readonly available: Effect.Effect<Option.Option<Update>>;
    /** Installs the newer release, if one is known. */
    readonly install: Effect.Effect<Installed, UpdateFailed>;
  }
>()('@tipee-tools/mcp/Updates') {
  // Never reports an update: for tests.
  public static readonly layerNone: Layer.Layer<Updates> = Layer.succeed(Updates, {
    available: Effect.succeedNone,
    install: Effect.succeed({ status: 'up_to_date' as const }),
  });

  // Compares GitHub's latest release with `current`.
  public static readonly layer = (
    current: string,
  ): Layer.Layer<Updates, never, HttpClient.HttpClient | FileSystem.FileSystem> =>
    Layer.effect(
      Updates,
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const http = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);
        const config = yield* Effect.option(settings);
        if (Option.isNone(config)) {
          return {
            available: Effect.succeedNone,
            install: Effect.succeed({ status: 'up_to_date' as const }),
          };
        }
        const { channel, downloadBase, opener, releasesUrl, stateDir } = config.value;
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

        // The bundle, verified against the checksums published with it.
        const download = (version: string): Effect.Effect<string, UpdateFailed> =>
          Effect.gen(function* () {
            const asset = `tipee-${version}.mcpb`;
            const base = `${downloadBase}/v${version}`;
            const sums = yield* http
              .get(`${base}/${CHECKSUMS}`)
              .pipe(Effect.flatMap((response) => response.text));
            const expected = checksumOf(sums, asset);
            if (expected === undefined) {
              return yield* failed(`no checksum published for ${asset}`);
            }
            const bytes = yield* http
              .get(`${base}/${asset}`)
              .pipe(Effect.flatMap((response) => response.arrayBuffer));
            if (bytes.byteLength > BUNDLE_LIMIT) {
              return yield* failed(`${asset} is larger than expected`);
            }
            const content = new Uint8Array(bytes);
            const actual = createHash('sha256').update(content).digest('hex');
            if (actual !== expected) {
              return yield* failed(`the checksum of ${asset} does not match the published one`);
            }
            const target = path.join(stateDir, 'updates', asset);
            yield* fs.makeDirectory(path.dirname(target), { recursive: true });
            yield* fs.writeFile(target, content);
            return target;
          }).pipe(
            Effect.timeout(DOWNLOAD_TIMEOUT),
            Effect.mapError((cause) =>
              cause instanceof UpdateFailed ? cause : failed(describe(cause)),
            ),
          );

        // Hands the file to Claude Desktop and returns at once: the process
        // May be replaced as soon as the user confirms.
        const open = (target: string): Effect.Effect<void, UpdateFailed> =>
          Effect.try({
            catch: (cause) => failed(`could not open ${target}: ${describe(cause)}`),
            try: () => {
              spawn(opener, [target], { detached: true, stdio: 'ignore' }).unref();
            },
          });

        const install: Effect.Effect<Installed, UpdateFailed> = Effect.gen(function* () {
          const latest = yield* available;
          if (Option.isNone(latest)) {
            return { status: 'up_to_date' as const };
          }
          const { url, version } = latest.value;
          if (channel !== 'desktop') {
            return { status: 'instructions' as const, url, version };
          }
          const target = yield* download(version);
          if (opener === '') {
            return { path: target, status: 'downloaded' as const, version };
          }
          yield* open(target);
          return { path: target, status: 'opened' as const, version };
        });

        return { available, install };
      }),
    );
}
