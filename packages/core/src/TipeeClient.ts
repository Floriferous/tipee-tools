// The typed Tipee client, derived from the generated HttpApi: one method per
// Operation, requests encoded and responses decoded with the schemas from
// Tipee's OpenAPI document. This file only adds what the document cannot
// Say: the base URL, the headers Tipee insists on, and retries.

import { Config, Context, Effect, Layer, Schedule, flow } from 'effect';
import type { Redacted } from 'effect';
import { HttpClient, HttpClientRequest } from 'effect/unstable/http';
import { HttpApiClient } from 'effect/unstable/httpapi';
import type { HttpApi } from 'effect/unstable/httpapi';

import { ConfigurationMissing } from './Errors.ts';
import { Tipee } from './generated/TipeeApi.ts';

export const TIPEE_API_VERSION = '26.06.25';

const RETRY_ATTEMPTS = 3;

export interface TipeeCredentials {
  /** The Tipee subdomain, e.g. "acme" for acme.tipee.net. */
  readonly instance: string;
  /** The API key of an integration created in the Tipee admin panel. */
  readonly apiKey: Redacted.Redacted;
}

type Groups = typeof Tipee extends HttpApi.HttpApi<string, infer G> ? G : never;

/** The derived client: `client.<Group>.<operation>({ payload })`. */
export type TipeeApi = HttpApiClient.Client<Groups>;

export class TipeeClient extends Context.Service<TipeeClient, TipeeApi>()(
  '@tipee-tools/core/TipeeClient',
) {
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
            // Rate limits (429), server errors and network hiccups are retried
            // With backoff; whatever is left is explained by TipeeError.fromCause.
            HttpClient.retryTransient({
              schedule: Schedule.exponential('250 millis'),
              times: RETRY_ATTEMPTS,
            }),
          ),
      }),
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
