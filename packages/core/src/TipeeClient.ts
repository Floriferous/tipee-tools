// The typed Tipee client, derived from the generated HttpApi: one method per
// Operation, requests encoded and responses decoded with the schemas from
// Tipee's OpenAPI document. This file only adds what the document cannot
// Say: the base URL, the headers Tipee insists on, and retries.

import { Config, Context, Effect, Layer, Schedule, flow } from 'effect';
import type { Redacted } from 'effect';
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

const retried = <E, R>(
  response: Effect.Effect<HttpClientResponse.HttpClientResponse, E, R>,
): Effect.Effect<HttpClientResponse.HttpClientResponse, E, R> =>
  response.pipe(
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
        (error.reason._tag === 'TransportError'
          ? resendable(error.request)
          : error.reason._tag === 'StatusCodeError' &&
            resendable(error.request, error.reason.response.status)),
    }),
  );

export interface TipeeCredentials {
  /** The Tipee subdomain, e.g. "acme" for acme.tipee.net. */
  readonly instance: string;
  /** The API key of an integration created in the Tipee admin panel. */
  readonly apiKey: Redacted.Redacted;
}

type Groups = typeof Tipee extends HttpApi.HttpApi<string, infer G> ? G : never;

/** The derived client: `api.<Group>.<operation>({ payload })`. */
export type TipeeApi = HttpApiClient.Client<Groups>;

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
      HttpApiClient.make(Tipee, {
        baseUrl: `https://${credentials.instance}.tipee.net`,
        transformClient: (client) =>
          client.pipe(
            HttpClient.mapRequest(
              flow(
                HttpClientRequest.acceptJson,
                HttpClientRequest.bearerToken(credentials.apiKey),
                HttpClientRequest.setHeader('tipee-version', TIPEE_API_VERSION),
              ),
            ),
            // Retried with backoff where that is safe (see `resendable`);
            // Whatever is left is explained by TipeeError.fromCause.
            HttpClient.transformResponse(retried),
          ),
      }).pipe(Effect.map((api) => ({ api, instance: credentials.instance }))),
    );

  // A client configured from `TIPEE_INSTANCE` and `TIPEE_API_KEY`.
  public static readonly layerConfig = Layer.unwrap(
    Config.all({
      apiKey: Config.Redacted('TIPEE_API_KEY'),
      instance: Config.String('TIPEE_INSTANCE'),
    }).pipe(
      Effect.map((credentials) => TipeeClient.layer(credentials)),
      Effect.mapError((cause) => new ConfigurationMissing({ cause })),
    ),
  );
}
