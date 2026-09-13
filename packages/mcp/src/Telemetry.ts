// Usage data that helps improve the plugin: which tools run, how long they
// Take, how they fail, and the errors worth a look (Tipee drifting from its
// Document, crashes). Nothing about the instance, its people or the key
// Leaves the machine: the only identifier is a random id kept in the user's
// Home directory. Events are batched to PostHog in the background and never
// Delay a tool; every failure of the telemetry itself is swallowed.

import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';
import { arch, platform, version as nodeVersion } from 'node:process';

import { Config, Context, Effect, FileSystem, Layer, Option, Queue } from 'effect';
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

export interface Sink {
  /** Records an event; returns at once. */
  readonly capture: (event: string, properties?: Properties) => Effect.Effect<void>;
  /** Records an error for PostHog's error tracking; the message only, never a stack. */
  readonly exception: (
    type: string,
    message: string,
    properties?: Properties,
  ) => Effect.Effect<void>;
  /** Sends what is queued now; the background loop does this on its own. */
  readonly flush: Effect.Effect<void>;
}

interface Event {
  readonly event: string;
  readonly properties: Properties;
  readonly timestamp: string;
}

const INTERVAL = '2 seconds';
const SEND_TIMEOUT = '5 seconds';
const DRAIN_TIMEOUT = '2 seconds';
const ID_FILE = 'telemetry-id';

// Overridable so tests and forks can point elsewhere.
const settings = Config.all({
  host: Config.String('TIPEE_POSTHOG_HOST').pipe(Config.withDefault(POSTHOG_HOST)),
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

export class Telemetry extends Context.Service<Telemetry, Sink>()('@tipee-tools/mcp/Telemetry') {
  // Records nothing: for tests.
  public static readonly layerOff: Layer.Layer<Telemetry> = Layer.succeed(Telemetry, silent);

  // Sends to PostHog; `base` is added to every event.
  public static readonly layer = (
    base: Properties,
  ): Layer.Layer<Telemetry, never, HttpClient.HttpClient | FileSystem.FileSystem> =>
    Layer.effect(
      Telemetry,
      Effect.gen(function* () {
        const read = yield* Effect.option(settings);
        if (Option.isNone(read)) {
          return silent;
        }
        const config = read.value;
        if (config.key === '') {
          return silent;
        }
        const fs = yield* FileSystem.FileSystem;
        const http = yield* HttpClient.HttpClient;
        const distinctId = yield* installationId(fs, config.stateDir);
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

        const properties = (own: Properties | undefined): Properties => ({
          $lib: 'tipee-mcp',
          $process_person_profile: false,
          arch,
          node_version: nodeVersion,
          os: platform,
          ...base,
          ...own,
        });
        const capture = (event: string, own?: Properties): Effect.Effect<void> =>
          Effect.asVoid(
            Queue.offer(queue, {
              event,
              properties: properties(own),
              timestamp: new Date().toISOString(),
            }),
          );
        return {
          capture,
          exception: (type, message, own) =>
            Effect.asVoid(
              Queue.offer(queue, {
                event: '$exception',
                properties: {
                  ...properties(own),
                  $exception_list: [{ mechanism: { handled: true }, type, value: message }],
                },
                timestamp: new Date().toISOString(),
              }),
            ),
          flush: drain,
        };
      }),
    );
}
