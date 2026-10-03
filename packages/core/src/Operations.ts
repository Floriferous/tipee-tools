// The catalogue of Tipee operations, read off the generated HttpApi: one
// entry per endpoint with its name, description, request and response
// schemas, and what it does to Tipee's data. Tools are built from this;
// `invoke` (Invoke.ts) calls any of them.

import { Context, Schema } from 'effect';
import { constVoid } from 'effect/Function';
import { HttpApi, HttpApiSchema, OpenApi } from 'effect/http-api';
import type { HttpApiEndpoint } from 'effect/http-api';

import { Tipee } from './generated/TipeeApi.ts';
import { readsOnly } from './TipeeClient.ts';

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
  /**
   * Every write but `*.create`: MCP reads a non-destructive tool as one that
   * only adds, and updates, cancellations and deletions all change what is there.
   */
  readonly destructive: boolean;
}

const nameOf = (path: string): string =>
  path.replace(/^\/api\/[^/]+\//u, '').replaceAll(/[.-]/gu, '_');

const verbOf = (path: string): string => path.slice(path.lastIndexOf('.') + 1);

const isBody = (schema: Schema.Top): boolean => !HttpApiSchema.isNoContent(schema.ast);

// Without its identifier the body's JSON Schema is inlined at the root (an
// object), which MCP tool parameters require; with it, the root is a $ref.
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
      const readOnly = readsOnly(endpoint.path);
      found.push({
        description: describe(mergedAnnotations, endpoint.path),
        destructive: !readOnly && verbOf(endpoint.path) !== 'create',
        endpoint: endpoint.identifier,
        group: group.identifier,
        name: nameOf(endpoint.path),
        parameters: bodySchema(endpoint),
        path: endpoint.path,
        readOnly,
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

/**
 * Every operation of the generated API (the document minus the routes
 * generate.ts excludes), in document order.
 */
export const operations: ReadonlyArray<Operation> = collect();

// Looks an operation up by name; throws for a name the document does not have.
export const operation = (name: string): Operation => {
  const found = operations.find((candidate) => candidate.name === name);
  if (found === undefined) {
    throw new Error(`Tipee has no operation named ${name}`);
  }
  return found;
};
