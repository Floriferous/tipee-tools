// The catalogue of Tipee operations, read off the generated HttpApi: one
// Entry per endpoint with its name, description, request and response
// Schemas, and whether it only reads. `invoke` calls any of them through the
// Client and explains failures as TipeeError. Tools are built from this.

import { Context, Effect, Schema } from 'effect';
import { constVoid } from 'effect/Function';
import { HttpApi, HttpApiSchema, OpenApi } from 'effect/unstable/httpapi';
import type { HttpApiEndpoint } from 'effect/unstable/httpapi';

import { TipeeError } from './Errors.ts';
import { Tipee } from './generated/TipeeApi.ts';
import { TipeeClient } from './TipeeClient.ts';

export interface Operation {
  /** `schedules_list` for `/api/schedule/schedules.list`. */
  readonly name: string;
  /** The API group, e.g. "Schedule". */
  readonly group: string;
  /** The endpoint identifier in the generated client. */
  readonly endpoint: string;
  readonly path: string;
  readonly description: string;
  /** The JSON request body. */
  readonly parameters: Schema.Top;
  /** The JSON response body, or undefined when Tipee answers with no content. */
  readonly success: Schema.Top | undefined;
  /** `*.list` and `*.show*` operations. */
  readonly readOnly: boolean;
  /** `*.delete*` operations. */
  readonly destructive: boolean;
}

const nameOf = (path: string): string =>
  path.replace(/^\/api\/[^/]+\//u, '').replaceAll(/[.-]/gu, '_');

const verbOf = (path: string): string => path.slice(path.lastIndexOf('.') + 1);

const isBody = (schema: Schema.Top): boolean => !HttpApiSchema.isNoContent(schema.ast);

// Without its identifier the body's JSON Schema is inlined at the root (an
// Object), which MCP tool parameters require; with it, the root is a $ref.
const bodySchema = (endpoint: HttpApiEndpoint.Top): Schema.Top => {
  for (const { schemas } of endpoint.payload.values()) {
    const body = schemas.find((schema) => isBody(schema));
    if (body !== undefined) {
      return body.annotate({ identifier: undefined });
    }
  }
  return Schema.Struct({});
};

const successSchema = (
  successes: ReadonlyMap<number, readonly [Schema.Top, ...Array<Schema.Top>]>,
): Schema.Top | undefined => {
  for (const schemas of successes.values()) {
    const body = schemas.find((schema) => isBody(schema));
    if (body !== undefined) {
      return body;
    }
  }
  return undefined;
};

const describe = (annotations: Context.Context<never>, path: string): string =>
  Context.getOrUndefined(annotations, OpenApi.Description) ??
  Context.getOrUndefined(annotations, OpenApi.Summary) ??
  path;

const collect = (): ReadonlyArray<Operation> => {
  const found: Array<Operation> = [];
  HttpApi.reflect(Tipee, {
    onEndpoint: ({ endpoint, group, mergedAnnotations, successes }) => {
      const verb = verbOf(endpoint.path);
      found.push({
        description: describe(mergedAnnotations, endpoint.path),
        destructive: verb.startsWith('delete'),
        endpoint: endpoint.identifier,
        group: group.identifier,
        name: nameOf(endpoint.path),
        parameters: bodySchema(endpoint),
        path: endpoint.path,
        readOnly: verb.startsWith('list') || verb.startsWith('show'),
        success: successSchema(successes),
      });
    },
    onGroup: constVoid,
  });
  const names = new Set(found.map((operation) => operation.name));
  if (names.size !== found.length) {
    throw new Error('two Tipee operations map to the same name');
  }
  return found;
};

/** Every operation Tipee's API document declares, in document order. */
export const operations: ReadonlyArray<Operation> = collect();

// Looks an operation up by name; throws for a name the document does not have.
export const operation = (name: string): Operation => {
  const found = operations.find((candidate) => candidate.name === name);
  if (found === undefined) {
    throw new Error(`Tipee has no operation named ${name}`);
  }
  return found;
};

type Method = (request: { readonly payload: unknown }) => Effect.Effect<unknown, unknown>;

// Calls an operation with a decoded request body and returns the decoded response.
export const invoke = (
  target: Operation,
  params: unknown,
): Effect.Effect<unknown, TipeeError, TipeeClient> =>
  Effect.gen(function* () {
    const client = yield* TipeeClient;
    const methods = client as unknown as Record<string, Record<string, Method> | undefined>;
    const method = methods[target.group]?.[target.endpoint];
    if (method === undefined) {
      return yield* Effect.die(new Error(`the client has no method for ${target.name}`));
    }
    return yield* method({ payload: params }).pipe(
      Effect.catch((error) => Effect.flatMap(TipeeError.fromCause(error), Effect.fail)),
    );
  });
