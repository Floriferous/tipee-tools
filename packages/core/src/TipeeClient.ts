// The typed Tipee client, derived from the generated HttpApi: one method per
// Operation, requests encoded and responses decoded with the schemas from
// Tipee's OpenAPI document. This file only adds what the document cannot
// Say: the base URL, the headers Tipee insists on, a timeout, and retries.

import {
  Config,
  ConfigProvider,
  Context,
  Effect,
  Layer,
  Option,
  Redacted,
  Schedule,
  flow,
} from 'effect';
import type { Cause } from 'effect';
import { HttpClient, HttpClientError, HttpClientRequest } from 'effect/http';
import type { HttpClientResponse } from 'effect/http';
import { HttpApiClient } from 'effect/http-api';
import type { HttpApi } from 'effect/http-api';

import { ConfigurationMissing } from './Errors.ts';
import { Tipee } from './generated/TipeeApi.ts';

export const TIPEE_API_VERSION = '26.06.25';

const RETRY_ATTEMPTS = 3;
const RETRY_SCHEDULE = Schedule.exponential('250 millis');
const HTTP_TOO_MANY_REQUESTS = 429;
// Timeouts, rate limits and server errors that may pass on their own.
const TRANSIENT_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
// Well under the minute after which MCP clients give up on a tool call, so
// The agent hears what happened instead of a generic error.
const REQUEST_TIMEOUT = '20 seconds';

// `*.list` and `*.show*` operations, the ones that only read.
export const readsOnly = (path: string): boolean =>
  /^(?:list|show)/u.test(path.slice(path.lastIndexOf('.') + 1));

// Whether a failed request may be sent again. Every Tipee operation is a
// POST, and a write that timed out or lost its connection may already have
// Been applied: sending it again could create it twice. Only reads are
// Retried, plus a 429 for anything, since Tipee then did nothing.
const resendable = (request: HttpClientRequest.HttpClientRequest, status?: number): boolean =>
  status === HTTP_TOO_MANY_REQUESTS ||
  (readsOnly(new URL(request.url).pathname) &&
    (status === undefined || TRANSIENT_STATUSES.has(status)));

// Each attempt has its own timeout, and an attempt that timed out is not
// Sent again: three more would outlast the client's patience. Statuses are
// Handled by the repeat, on the answer itself (the client fails with a
// StatusCodeError only after this), so only a lost connection is retried.
const retried = <E, R>(
  response: Effect.Effect<HttpClientResponse.HttpClientResponse, E, R>,
): Effect.Effect<HttpClientResponse.HttpClientResponse, E | Cause.TimeoutError, R> =>
  response.pipe(
    Effect.timeout(REQUEST_TIMEOUT),
    Effect.repeat({
      schedule: RETRY_SCHEDULE,
      times: RETRY_ATTEMPTS,
      while: (answer) =>
        TRANSIENT_STATUSES.has(answer.status) && resendable(answer.request, answer.status),
    }),
    Effect.retry({
      schedule: RETRY_SCHEDULE,
      times: RETRY_ATTEMPTS,
      while: (error) =>
        HttpClientError.isHttpClientError(error) &&
        error.reason._tag === 'TransportError' &&
        resendable(error.request),
    }),
  );

const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;

// The subdomain in what the user typed: `acme`, ` ACME ` and
// `https://acme.tipee.net/` all give `acme`. None when what is left is not a
// Single DNS label, so no value can send the key to another host.
export const normalizeInstance = (raw: string): Option.Option<string> => {
  const [host = ''] = raw
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//u, '')
    .split('/');
  const subdomain = host.replace(/\.tipee\.net$/u, '');
  return DNS_LABEL.test(subdomain) ? Option.some(subdomain) : Option.none();
};

const instanceConfig = Config.String('TIPEE_INSTANCE').pipe(
  Config.mapEffect((raw) =>
    Effect.mapError(
      Effect.fromOption(normalizeInstance(raw)),
      () =>
        new Config.ConfigError(
          new ConfigProvider.SourceError({
            message: `"${raw}" is not a Tipee instance: enter the part before .tipee.net, such as acme.`,
          }),
        ),
    ),
  ),
);

export interface TipeeCredentials {
  /** The Tipee subdomain, e.g. "acme" for acme.tipee.net. */
  readonly instance: string;
  /** The API key of an integration created in the Tipee admin panel. */
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
  // Pasted: the instance is normalized, the key trimmed.
  public static readonly layerConfig = Layer.unwrap(
    Config.all({
      apiKey: Config.Redacted('TIPEE_API_KEY').pipe(
        Config.map((key) => Redacted.make(Redacted.value(key).trim())),
      ),
      instance: instanceConfig,
    }).pipe(
      Effect.map((credentials) => TipeeClient.layer(credentials)),
      Effect.mapError((cause) => new ConfigurationMissing({ cause })),
    ),
  );
}
