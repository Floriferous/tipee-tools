// Usage data that helps improve the plugin: which tools run, how long they
// Take, how they fail, and the errors worth a look (Tipee drifting from its
// Document, crashes), as PostHog product analytics and error tracking.
// Each installation is one PostHog person, identified by a random id kept in
// The user's home directory, and belongs to the group of its Tipee instance,
// So companies can be told apart. Nothing about the people in Tipee, and
// Never the key, leaves the machine; stack frames are cut down to the bundle.
// Events are batched to PostHog in the background and never delay a tool;
// Every failure of the telemetry itself is swallowed.

import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';
import { arch, platform, version as nodeVersion } from 'node:process';

import { TipeeError } from '@tipee-tools/core';
import { Config, Context, Effect, FileSystem, Layer, Option, Queue, Schedule } from 'effect';
import { HttpClient, HttpClientRequest } from 'effect/unstable/http';

/** The PostHog project events go to: a public, write-only token. Empty means nothing is sent. */
export const POSTHOG_KEY = 'phc_wpMKkaVwaZL7P39vsKPBhJXdxvMa3rifp5HodMRfEi8Y';
export const POSTHOG_HOST = 'https://eu.i.posthog.com';

/** A property value PostHog can store: plain JSON, never a Tipee object. */
export type PropertyValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | ReadonlyArray<PropertyValue>
  | { readonly [key: string]: PropertyValue };
export type Properties = Readonly<Record<string, PropertyValue>>;

export interface ExceptionOptions {
  /** False when nothing caught it on purpose: a defect, a crash. */
  readonly handled: boolean;
  readonly properties?: Properties;
}

export interface Sink {
  /** Records an event; returns at once. */
  readonly capture: (event: string, properties?: Properties) => Effect.Effect<void>;
  /** Records an error for PostHog's error tracking: type, message and scrubbed frames. */
  readonly exception: (error: unknown, options: ExceptionOptions) => Effect.Effect<void>;
  /** Sends what is queued now; the background loop does this on its own. */
  readonly flush: Effect.Effect<void>;
}

interface Event {
  readonly event: string;
  readonly properties: Properties;
  readonly timestamp: string;
}

// An intersection, so a frame is also a plain property value on the wire.
type Frame = Readonly<Record<string, PropertyValue>> & {
  readonly colno?: number;
  readonly filename: string;
  readonly function: string;
  readonly in_app: boolean;
  readonly lineno?: number;
  readonly platform: 'node:javascript';
};

const INTERVAL = '2 seconds';
const SEND_TIMEOUT = '5 seconds';
const DRAIN_TIMEOUT = '2 seconds';
const SEND_RETRIES = 2;
const ID_FILE = 'telemetry-id';
const FRAME_LIMIT = 30;

// Overridable so tests and forks can point elsewhere. The instance is the
// Same value the Tipee client reads; absent only in tests.
const settings = Config.all({
  host: Config.String('TIPEE_POSTHOG_HOST').pipe(Config.withDefault(POSTHOG_HOST)),
  instance: Config.String('TIPEE_INSTANCE').pipe(Config.withDefault('')),
  key: Config.String('TIPEE_POSTHOG_KEY').pipe(Config.withDefault(POSTHOG_KEY)),
  stateDir: Config.String('TIPEE_STATE_DIR').pipe(
    Config.withDefault(path.join(homedir(), '.tipee-tools')),
  ),
});

const silent: Sink = {
  capture: () => Effect.void,
  exception: () => Effect.void,
  flush: Effect.void,
};

// A random id per installation, so usage can be counted without knowing who
// Uses it. A machine that cannot keep the file gets a fresh id every start.
const installationId = (fs: FileSystem.FileSystem, stateDir: string): Effect.Effect<string> =>
  Effect.gen(function* () {
    const file = path.join(stateDir, ID_FILE);
    const kept = yield* Effect.option(fs.readFileString(file));
    const found = Option.filter(
      Option.map(kept, (text) => text.trim()),
      (text) => text !== '',
    );
    if (Option.isSome(found)) {
      return found.value;
    }
    const id = randomUUID();
    yield* Effect.option(
      Effect.flatMap(fs.makeDirectory(stateDir, { recursive: true }), () =>
        fs.writeFileString(file, `${id}\n`),
      ),
    );
    return id;
  });

// "    at fn (file:line:col)" or "    at file:line:col"; the file is cut down
// To what is ours (the bundle or a source file), so no user path travels.
const FRAME = /^\s*at (?:(?<fn>.+?) \()?(?<file>.+?)(?::(?<line>\d+))?(?::(?<col>\d+))?\)?$/u;
const OURS = /(?:^|\/)(?<tail>(?:server|src|test)\/[^/]+\.(?:m?js|ts))$/u;

const scrubbed = (file: string): { readonly filename: string; readonly inApp: boolean } => {
  const ours = OURS.exec(file)?.groups?.tail;
  if (ours !== undefined) {
    return { filename: ours, inApp: true };
  }
  return { filename: file.startsWith('node:') ? file : path.basename(file), inApp: false };
};

// The frames of an error's stack, scrubbed; empty when there is no stack.
export const framesOf = (stack: string | undefined): ReadonlyArray<Frame> =>
  (stack ?? '')
    .split('\n')
    .flatMap((line) => {
      const groups = FRAME.exec(line)?.groups;
      if (groups?.file === undefined) {
        return [];
      }
      const { filename, inApp } = scrubbed(groups.file);
      return [
        {
          ...(groups.col === undefined ? {} : { colno: Number(groups.col) }),
          filename,
          function: groups.fn ?? '<anonymous>',
          in_app: inApp,
          ...(groups.line === undefined ? {} : { lineno: Number(groups.line) }),
          platform: 'node:javascript' as const,
        },
      ];
    })
    .slice(0, FRAME_LIMIT);

// What PostHog's error tracking groups on: a type and a message, plus frames
// When the error carries a stack worth reading (a TipeeError's does not).
const describe = (
  error: unknown,
): { readonly type: string; readonly value: string; readonly frames: ReadonlyArray<Frame> } => {
  if (error instanceof TipeeError) {
    return { frames: [], type: `Tipee${error.reason._tag}`, value: error.reason.message };
  }
  if (error instanceof Error) {
    return { frames: framesOf(error.stack), type: error.name, value: error.message };
  }
  return { frames: [], type: 'Unknown', value: String(error) };
};

export class Telemetry extends Context.Service<Telemetry, Sink>()('@tipee-tools/mcp/Telemetry') {
  // Records nothing: for tests.
  public static readonly layerOff: Layer.Layer<Telemetry> = Layer.succeed(Telemetry, silent);

  // Sends to PostHog; `base` is added to every event, as is a launch id that
  // Ties one process's events together.
  public static readonly layer = (
    base: Properties,
  ): Layer.Layer<Telemetry, never, HttpClient.HttpClient | FileSystem.FileSystem> =>
    Layer.effect(
      Telemetry,
      Effect.gen(function* () {
        const read = yield* Effect.option(settings);
        if (Option.isNone(read) || read.value.key === '') {
          return silent;
        }
        const config = read.value;
        const fs = yield* FileSystem.FileSystem;
        const http = (yield* HttpClient.HttpClient).pipe(
          HttpClient.retryTransient({
            schedule: Schedule.exponential('500 millis'),
            times: SEND_RETRIES,
          }),
        );
        const distinctId = yield* installationId(fs, config.stateDir);
        const launchId = randomUUID();
        const queue = yield* Queue.unbounded<Event>();

        const send = (batch: ReadonlyArray<Event>): Effect.Effect<void> =>
          batch.length === 0
            ? Effect.void
            : HttpClientRequest.post(`${config.host}/batch`).pipe(
                HttpClientRequest.bodyJson({
                  api_key: config.key,
                  batch: batch.map((event) => ({ ...event, distinct_id: distinctId })),
                }),
                Effect.flatMap((request) => http.execute(request)),
                Effect.timeout(SEND_TIMEOUT),
                Effect.ignore,
              );
        const drain = Effect.flatMap(Queue.clear(queue), (batch) => send(batch));

        // Whatever gathered in the last moments travels together.
        yield* Effect.forkScoped(Effect.forever(Effect.andThen(Effect.sleep(INTERVAL), drain)));
        yield* Effect.addFinalizer(() => drain.pipe(Effect.timeout(DRAIN_TIMEOUT), Effect.ignore));

        // What describes an installation, kept on its person profile too.
        const profile: Properties = {
          arch,
          instance: config.instance,
          node_version: nodeVersion,
          os: platform,
          ...base,
        };
        const properties = (own: Properties | undefined): Properties => ({
          $groups: { instance: config.instance },
          $lib: 'tipee-mcp',
          $set: profile,
          launch_id: launchId,
          ...profile,
          ...own,
        });
        const enqueue = (event: string, own: Properties | undefined): Effect.Effect<void> =>
          Effect.asVoid(
            Queue.offer(queue, {
              event,
              properties: properties(own),
              timestamp: new Date().toISOString(),
            }),
          );
        return {
          capture: enqueue,
          exception: (error, { handled, properties: own }) => {
            const { frames, type, value } = describe(error);
            return enqueue('$exception', {
              ...own,
              $exception_level: 'error',
              $exception_list: [
                {
                  mechanism: { handled, type: 'generic' },
                  ...(frames.length === 0 ? {} : { stacktrace: { frames, type: 'raw' } }),
                  type,
                  value,
                },
              ],
            });
          },
          flush: drain,
        };
      }),
    );
}
