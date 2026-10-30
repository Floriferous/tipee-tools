// The typed tipee client, derived from the generated HttpApi: one method per
// operation, requests encoded and responses decoded with the schemas from
// tipee's OpenAPI document. This file only adds what the document cannot
// say: the base URL, the headers tipee insists on, a timeout, and retries.

import {
  Cause,
  Clock,
  Config,
  ConfigProvider,
  Context,
  Duration,
  Effect,
  Layer,
  Option,
  Redacted,
  Schedule,
  flow,
} from 'effect';
import { HttpClient, HttpClientError, HttpClientRequest } from 'effect/http';
import type { HttpClientResponse } from 'effect/http';
import { HttpApiClient } from 'effect/http-api';
import type { HttpApi } from 'effect/http-api';

import { ConfigurationMissing } from './Errors.ts';
import { Tipee } from './generated/TipeeApi.ts';

export const TIPEE_API_VERSION = '26.06.25';

const RETRY_ATTEMPTS = 3;
const RETRY_SCHEDULE = Schedule.exponential('250 millis');
// Timeouts, rate limits and server errors that may pass on their own; 508 is
// tipee's "Loop Detected", a concurrent change to the same data.
const TRANSIENT_STATUSES = new Set([408, 429, 500, 502, 503, 504, 508]);
// Answers after which tipee asks for the request again and guarantees it did
// nothing, so even a write is sent again: its rate limit, maintenance (503)
// and a concurrent change (508), per
// https://api.tipee.ch/guides-and-resources/error-handling.
const REPLAYABLE_STATUSES = new Set([429, 503, 508]);
// The longest Retry-After waited for: a longer one goes back to the agent.
const MAX_RETRY_AFTER_SECONDS = 10;
const MILLIS_PER_SECOND = 1000;
// Well under the minute after which MCP clients give up on a tool call, so
// the agent hears what happened instead of a generic error: one attempt, and
// all of them with their backoff (four slow server errors would take 80 s).
const ATTEMPT_TIMEOUT_SECONDS = 20;
const CALL_TIMEOUT_SECONDS = 50;

// A timeout whose message says how long tipee was given.
const within = (
  seconds: number,
  message: string,
): (<A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E | Cause.TimeoutError, R>) =>
  Effect.timeoutOrElse({
    duration: `${seconds} seconds`,
    orElse: () => Effect.fail(new Cause.TimeoutError(message)),
  });

// `*.list` and `*.show*` operations, the ones that only read.
export const readsOnly = (path: string): boolean =>
  /^(?:list|show)/u.test(path.slice(path.lastIndexOf('.') + 1));

// Whether a failed request may be sent again. Every tipee operation is a
// POST, and a write that timed out or lost its connection may already have
// been applied: sending it again could create it twice. Reads are retried,
// and anything after an answer tipee says to replay.
const resendable = (request: HttpClientRequest.HttpClientRequest, status?: number): boolean =>
  (status !== undefined && REPLAYABLE_STATUSES.has(status)) ||
  (readsOnly(new URL(request.url).pathname) &&
    (status === undefined || TRANSIENT_STATUSES.has(status)));

// The seconds a Retry-After header asks to wait, given as seconds or as an
// HTTP date (compared with `now`, in milliseconds); undefined without one.
export const retryAfterSeconds = (header: string | undefined, now: number): number | undefined => {
  if (header === undefined) {
    return undefined;
  }
  const trimmed = header.trim();
  if (/^\d+$/u.test(trimmed)) {
    return Number(trimmed);
  }
  const date = Date.parse(trimmed);
  return Number.isNaN(date) ? undefined : Math.max(0, (date - now) / MILLIS_PER_SECOND);
};

// Waits at least as long as the answer's Retry-After asks.
const ANSWER_SCHEDULE = RETRY_SCHEDULE.pipe(
  Schedule.modifyDelay(
    ({
      duration,
      input,
      now,
    }: Schedule.Metadata<Duration.Duration, HttpClientResponse.HttpClientResponse>) => {
      const seconds = retryAfterSeconds(input.headers['retry-after'], now);
      return Effect.succeed(
        seconds === undefined ? duration : Duration.max(duration, Duration.seconds(seconds)),
      );
    },
  ),
);

// Whether an answer is worth sending the request again for: a transient
// status, a request that may be resent, and a wait short enough to stay.
const worthRetrying = (answer: HttpClientResponse.HttpClientResponse, now: number): boolean => {
  const seconds = retryAfterSeconds(answer.headers['retry-after'], now);
  return (
    TRANSIENT_STATUSES.has(answer.status) &&
    resendable(answer.request, answer.status) &&
    (seconds === undefined || seconds <= MAX_RETRY_AFTER_SECONDS)
  );
};

// Each attempt has its own timeout, and an attempt that timed out is not
// sent again: three more would outlast the client's patience; the whole call
// has a timeout too, for slow answers that are retried. Statuses are
// handled by the repeat, on the answer itself (the client fails with a
// StatusCodeError only after this), honouring Retry-After; only a lost
// connection is retried as an error.
const retried = <E, R>(
  response: Effect.Effect<HttpClientResponse.HttpClientResponse, E, R>,
): Effect.Effect<HttpClientResponse.HttpClientResponse, E | Cause.TimeoutError, R> =>
  response.pipe(
    within(ATTEMPT_TIMEOUT_SECONDS, `tipee did not answer within ${ATTEMPT_TIMEOUT_SECONDS} s`),
    Effect.repeat({
      schedule: ANSWER_SCHEDULE,
      times: RETRY_ATTEMPTS,
      while: (answer) => Effect.map(Clock.currentTimeMillis, (now) => worthRetrying(answer, now)),
    }),
    Effect.retry({
      schedule: RETRY_SCHEDULE,
      times: RETRY_ATTEMPTS,
      while: (error) =>
        HttpClientError.isHttpClientError(error) &&
        error.reason._tag === 'TransportError' &&
        resendable(error.request),
    }),
    within(
      CALL_TIMEOUT_SECONDS,
      `tipee gave no usable answer within ${CALL_TIMEOUT_SECONDS} s, retries included`,
    ),
  );

const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;

// The subdomain in what the user typed: `acme`, ` ACME ` and
// `https://acme.tipee.net/` all give `acme`. None when what is left is not a
// single DNS label, so no value can send the key to another host.
export const normalizeInstance = (raw: string): Option.Option<string> => {
  const [host = ''] = raw
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//u, '')
    .split('/');
  const subdomain = host.replace(/\.tipee\.net$/u, '');
  return DNS_LABEL.test(subdomain) ? Option.some(subdomain) : Option.none();
};

// A setting that cannot be used, in words the user can act on.
const invalid = (message: string): Config.ConfigError =>
  new Config.ConfigError(new ConfigProvider.SourceError({ message }));

// A setting never filled in: absent, blank, or the placeholder Claude passes
// as is, such as `${user_config.instance}`.
const unset = (raw: string): boolean => /^(?:\$\{user_config\.\w+\})?$/u.test(raw.trim());

const instanceConfig = Config.String('TIPEE_INSTANCE').pipe(
  Config.withDefault(''),
  Config.mapEffect((raw) =>
    unset(raw)
      ? Effect.fail(invalid('The tipee instance is empty: enter the part before .tipee.net.'))
      : Effect.mapError(Effect.fromOption(normalizeInstance(raw)), () =>
          invalid(
            `"${raw}" is not a tipee instance: enter the part before .tipee.net, such as acme.`,
          ),
        ),
  ),
);

// Trimmed, and refused when unset: an empty bearer token would only fail
// later, as a refused key.
const apiKeyConfig = Config.Redacted('TIPEE_API_KEY').pipe(
  Config.withDefault(Redacted.make('')),
  Config.mapEffect((key) => {
    const trimmed = Redacted.value(key).trim();
    return unset(trimmed)
      ? Effect.fail(invalid('The API key is empty: paste the key generated for the integration.'))
      : Effect.succeed(Redacted.make(trimmed));
  }),
);

export interface TipeeCredentials {
  /** The tipee subdomain, e.g. "acme" for acme.tipee.net. */
  readonly instance: string;
  /** The API key of an integration created in the tipee admin panel. */
  readonly apiKey: Redacted.Redacted;
}

type Groups = typeof Tipee extends HttpApi.HttpApi<string, infer G> ? G : never;

/** The derived client: `api.<Group>.<operation>({ payload })`. */
export type TipeeApi = HttpApiClient.Client<Groups, Cause.TimeoutError>;

export class TipeeClient extends Context.Service<
  TipeeClient,
  {
    readonly api: TipeeApi;
    /** The subdomain, kept so errors can link into this instance's admin pages. */
    readonly instance: string;
  }
>()('@tipee-tools/core/TipeeClient') {
  // A client for one instance; needs an `HttpClient`.
  public static readonly layer = (
    credentials: TipeeCredentials,
  ): Layer.Layer<TipeeClient, never, HttpClient.HttpClient> =>
    Layer.effect(
      TipeeClient,
      Effect.gen(function* () {
        const client = (yield* HttpClient.HttpClient).pipe(
          HttpClient.mapRequest(
            flow(
              HttpClientRequest.acceptJson,
              HttpClientRequest.bearerToken(credentials.apiKey),
              HttpClientRequest.setHeader('tipee-version', TIPEE_API_VERSION),
            ),
          ),
          // Timed out, and retried with backoff where that is safe (see
          // `retried`); whatever is left is explained by TipeeError.fromCause.
          HttpClient.transformResponse(retried),
        );
        const api = yield* HttpApiClient.makeWith(Tipee, {
          baseUrl: `https://${credentials.instance}.tipee.net`,
          httpClient: client,
        });
        return { api, instance: credentials.instance };
      }),
    );

  // A client configured from `TIPEE_INSTANCE` and `TIPEE_API_KEY`, both as
  // pasted: the instance is normalized, the key trimmed.
  public static readonly layerConfig = Layer.unwrap(
    Config.all({ apiKey: apiKeyConfig, instance: instanceConfig }).pipe(
      Effect.map((credentials) => TipeeClient.layer(credentials)),
      Effect.mapError((cause) => new ConfigurationMissing({ cause })),
    ),
  );
}
