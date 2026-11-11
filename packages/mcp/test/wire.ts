// What crosses the wire in the tests, through Schema: the JSON text of a
// value, to assert that nothing private reaches it; a value read back from
// text; and fake servers' handlers written as Effects that decode the body
// they receive.

import { Effect, Schema, flow } from 'effect';
import { HttpServerRequest } from 'effect/http';
import type { HttpServerError } from 'effect/http';

const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

// The JSON text of any value.
export const toJson = (value: unknown): Effect.Effect<string, Schema.SchemaError> =>
  encodeJson(value);

// Reads a value of `schema` from JSON text.
export const fromJson = <S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
): ((text: string) => Effect.Effect<S['Type'], Schema.SchemaError>) => {
  const decode = Schema.decodeUnknownEffect(Schema.fromJsonString(schema));
  return (text) => decode(text);
};

// The body a fake server received, as a value of `schema`.
export const bodyOf = <S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
): ((
  request: Request,
) => Effect.Effect<S['Type'], Schema.SchemaError | HttpServerError.HttpServerError>) => {
  const decode = Schema.decodeUnknownEffect(schema);
  return (request) => Effect.flatMap(HttpServerRequest.fromWeb(request).json, decode);
};

// An MSW resolver written as an Effect, run as the promise MSW awaits.
export const resolver = <A, E>(
  answer: (info: { readonly request: Request }) => Effect.Effect<A, E>,
): ((info: { readonly request: Request }) => Promise<A>) => flow(answer, Effect.runPromise);
