// Whether a newer release exists, and installing it. The plugin has no
// channel to update itself through, so `check_setup` reports a newer release
// and the `update_plugin` tool installs it: in Claude Desktop it downloads
// the bundle from this repository's releases, verifies its checksum, and
// opens it, which makes Claude Desktop ask the user to confirm the update;
// the instance and key are kept. GitHub's latest release is looked up afresh
// each time: by a check, an update the user asked for, or a launch's first
// tool call (Notice.ts); a failed lookup is "nothing to report" for the
// check and the note, and a failure for the update. Nothing is kept on disk but the downloaded bundle, in a temporary
// directory.

import { platform } from 'node:process';

import {
  Array as Arr,
  Config,
  Context,
  Effect,
  FileSystem,
  Layer,
  Option,
  Path,
  Predicate,
  Schema,
  String as Str,
  pipe,
} from 'effect';
import { Digest } from 'effect/crypto';
import { dual } from 'effect/Function';
import { HttpClient, HttpClientResponse } from 'effect/http';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';

import { channel as detectedChannel } from './Install.ts';
import { NodePlatform } from './Platform.ts';

const RELEASES_URL = 'https://api.github.com/repos/Floriferous/tipee-tools/releases/latest';
const DOWNLOAD_BASE = 'https://github.com/Floriferous/tipee-tools/releases/download';

/** A release newer than the one running. */
export class Update extends Schema.Class<Update, { readonly brand: unique symbol }>('Update')({
  /** Where to get it. */
  url: Schema.String,
  version: Schema.String,
}) {}

/** The update could not be installed; the detail says why. */
export class UpdateFailed extends Schema.TaggedError<
  UpdateFailed,
  { readonly brand: unique symbol }
>()('UpdateFailed', {
  detail: Schema.String,
}) {
  public override get message(): string {
    return (
      `The update could not be installed: ${this.detail}. Download tipee.mcpb from ` +
      'https://github.com/Floriferous/tipee-tools/releases/latest and open it.'
    );
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

const FETCH_TIMEOUT = '3 seconds';
const DOWNLOAD_TIMEOUT = '60 seconds';
const CHECKSUMS = 'SHA256SUMS';

// Overridable so tests and forks can point elsewhere; the opener is what
// hands the downloaded bundle to Claude Desktop (macOS only for now).
const settings = Config.all({
  channel: Config.String('TIPEE_UPDATE_CHANNEL').pipe(Config.withDefault(detectedChannel)),
  downloadBase: Config.String('TIPEE_DOWNLOAD_BASE').pipe(Config.withDefault(DOWNLOAD_BASE)),
  opener: Config.String('TIPEE_OPENER').pipe(
    Config.withDefault(platform === 'darwin' ? 'open' : ''),
  ),
  releasesUrl: Config.String('TIPEE_RELEASES_URL').pipe(Config.withDefault(RELEASES_URL)),
});

const PART = /^\d+$/u;

// A version's numeric parts, or undefined when one is not a number.
const partsOf = (version: string): ReadonlyArray<number> | undefined => {
  const parts = pipe(version, Str.replace(/^v/u, ''), Str.split('.'));
  return Arr.every(parts, (part) => PART.test(part)) ? Arr.map(parts, Number) : undefined;
};

// "0.3.10" is newer than "0.3.9"; anything unparseable is not newer.
export const isNewer: {
  (current: string): (candidate: string) => boolean;
  (candidate: string, current: string): boolean;
} = dual(2, (candidate: string, current: string): boolean => {
  const left = partsOf(candidate);
  const right = partsOf(current);
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
});

// The published checksum of one asset, from "hash  name" lines.
export const checksumOf: {
  (asset: string): (sums: string) => string | undefined;
  (sums: string, asset: string): string | undefined;
} = dual(2, (sums: string, asset: string): string | undefined =>
  pipe(
    Str.split(sums, '\n'),
    Arr.map((line) => pipe(line, Str.trim, Str.split(/\s+/u))),
    Arr.findFirst(([, name]) => name === asset || name === `*${asset}`),
    Option.map(([hash]) => hash),
    Option.getOrUndefined,
  ),
);

const failed = (detail: string): UpdateFailed => UpdateFailed.make({ detail });

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

interface Service {
  /** The version running. */
  readonly current: string;
  /** The newer release, if one is known. Never fails. */
  readonly available: Effect.Effect<Option.Option<Update>>;
  /** Installs the newer release, if one is known. */
  readonly install: Effect.Effect<Installed, UpdateFailed>;
}

export class Updates extends Context.Service<Updates, Service>()('@tipee-tools/mcp/Updates') {
  // Never reports an update: for tests.
  public static readonly layerNone = (current: string): Layer.Layer<Updates> =>
    Layer.succeed(
      Updates,
      Updates.of({
        available: Effect.succeedNone,
        current,
        install: Effect.succeed({ status: 'up_to_date' as const }),
      }),
    );

  // Compares GitHub's latest release with `current`; downloads go to the
  // machine's temporary directory.
  public static readonly layer = (
    current: string,
  ): Layer.Layer<Updates, never, HttpClient.HttpClient> =>
    Layer.effect(
      Updates,
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const digest = yield* Digest.Digest;
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
        const http = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);
        // Every setting has a default, so reading them cannot fail.
        const { channel, downloadBase, opener, releasesUrl } = yield* Effect.orDie(settings);

        const latest = http.get(releasesUrl).pipe(
          Effect.flatMap(HttpClientResponse.schemaJson(Release)),
          Effect.timeout(FETCH_TIMEOUT),
          Effect.map(({ body }) => {
            const version = Str.replace(/^v/u, '')(body.tag_name);
            return isNewer(version, current)
              ? Option.some(Update.make({ url: body.html_url, version }))
              : Option.none<Update>();
          }),
        );
        const available = latest.pipe(Effect.orElseSucceed(() => Option.none<Update>()));

        // The bundle, verified against the checksums published with it.
        const download = Effect.fnUntraced(
          function* (version: string) {
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
            const content = new Uint8Array(bytes);
            const actual = yield* digest.digestHex(Digest.sha256, content);
            if (actual !== expected) {
              return yield* failed(`the checksum of ${asset} does not match the published one`);
            }
            // Not scoped: the file must outlive this call until Claude Desktop
            // has read it.
            const directory = yield* fs.makeTempDirectory({ prefix: 'tipee-update-' });
            const target = path.join(directory, asset);
            yield* fs.writeFile(target, content);
            return target;
          },
          Effect.timeout(DOWNLOAD_TIMEOUT),
          Effect.mapError((cause) =>
            Predicate.isTagged(cause, 'UpdateFailed')
              ? cause
              : UpdateFailed.make({ detail: describe(cause) }),
          ),
        );

        // Hands the file to Claude Desktop and returns once the opener has
        // started: the process may be replaced as soon as the user confirms.
        // The opener runs detached and unreferenced, so closing the scope
        // leaves it running instead of killing it. One that cannot start
        // fails with the system's own words (ENOENT, EACCES…), except when
        // Node throws instead (ENOTDIR…), which reaches here as a defect.
        const open = Effect.fnUntraced(
          function* (target: string) {
            const child = yield* spawner.spawn(
              ChildProcess.make(opener, [target], {
                detached: true,
                stderr: 'ignore',
                stdin: 'ignore',
                stdout: 'ignore',
              }),
            );
            // What would re-reference it is not needed: it stays on its own.
            yield* Effect.asVoid(child.unref);
          },
          Effect.scoped,
          (effect, target) => {
            const cannotOpen = (cause: unknown): UpdateFailed =>
              failed(`could not open ${target}: ${describe(cause)}`);
            return effect.pipe(
              Effect.mapError((failure) => cannotOpen(failure.cause ?? failure)),
              Effect.catchDefect((defect) => Effect.fail(cannotOpen(defect))),
            );
          },
        );

        const install: Effect.Effect<Installed, UpdateFailed> = Effect.gen(function* () {
          // The user asked for an update check_setup reported: a failed
          // lookup must not pass for "already the latest".
          const found = yield* latest.pipe(
            Effect.mapError((cause) =>
              failed(`could not look up the latest release on GitHub (${describe(cause)})`),
            ),
          );
          if (Option.isNone(found)) {
            return { status: 'up_to_date' as const };
          }
          const { url, version } = found.value;
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

        return Updates.of({ available, current, install });
      }),
    ).pipe(Layer.provide(NodePlatform));
}
