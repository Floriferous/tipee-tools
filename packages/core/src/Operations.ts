// The catalogue of Tipee operations, read off the generated HttpApi: one
// Entry per endpoint with its name, description, request and response
// Schemas, and whether it only reads. `invoke` calls any of them through the
// Client and explains failures as TipeeError, with a link into the user's
// Tipee when the fix is a missing right. Tools are built from this.

import { Context, Effect, Option, Schema } from 'effect';
import { constVoid } from 'effect/Function';
import { HttpApi, HttpApiSchema, OpenApi } from 'effect/http-api';
import type { HttpApiEndpoint } from 'effect/http-api';

import { InvalidRequest, TipeeError } from './Errors.ts';
import { Tipee } from './generated/TipeeApi.ts';
import { pages, rightFor } from './Rights.ts';
import { TipeeClient, readsOnly } from './TipeeClient.ts';

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
        readOnly: readsOnly(endpoint.path),
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

// The call itself: decoded request in, decoded response out, TipeeError on failure.
const call = (
  target: Operation,
  params: unknown,
): Effect.Effect<unknown, TipeeError, TipeeClient> =>
  Effect.gen(function* () {
    const { api } = yield* TipeeClient;
    // Checked against the document before anything is sent, so a schema
    // Error afterwards can only be Tipee's answer.
    yield* Schema.decodeUnknownEffect(target.parameters as Schema.Codec<unknown>)(params).pipe(
      Effect.mapError(
        (cause) => new TipeeError({ reason: new InvalidRequest({ details: cause.message }) }),
      ),
    );
    const methods = api as unknown as Record<string, Record<string, Method> | undefined>;
    const method = methods[target.group]?.[target.endpoint];
    if (method === undefined) {
      return yield* Effect.die(new Error(`the client has no method for ${target.name}`));
    }
    return yield* method({ payload: params }).pipe(
      Effect.catch((error) => Effect.flatMap(TipeeError.fromCause(error), Effect.fail)),
    );
  });

const PAGE_SIZE = 100;
const HTTP_SERVER_ERROR = 500;

interface Kind {
  readonly id: string;
  readonly machine_name: string;
}
interface Listed {
  readonly id: string;
  readonly label: string;
}
interface Page {
  readonly data: ReadonlyArray<Listed>;
}

// The integrations of the instance, when the key may list them.
const integrations: Effect.Effect<ReadonlyArray<Listed>, TipeeError, TipeeClient> = Effect.gen(
  function* () {
    const kinds = (yield* call(operation('kinds_list'), {})) as ReadonlyArray<Kind>;
    const kind = kinds.find((candidate) => candidate.machine_name === 'integration');
    if (kind === undefined) {
      return [];
    }
    const page = (yield* call(operation('resources_list'), {
      kind_id: kind.id,
      orders: [{ attribute: 'last_name', direction: 'asc', key: 'resource.attribute' }],
      pagination: { limit: PAGE_SIZE, next_token: null },
    })) as Page;
    return page.data;
  },
);

export interface IntegrationLink {
  /** The integration's name in Tipee. */
  readonly label: string;
  /** Its Roles tab, where rights are ticked. */
  readonly roles_page: string;
}

/**
 * The integration the key belongs to, when the API lets us list integrations
 * And there is exactly one: any failure or ambiguity is undefined, never an error.
 */
export const integrationLink: Effect.Effect<IntegrationLink | undefined, never, TipeeClient> =
  Effect.gen(function* () {
    const { instance } = yield* TipeeClient;
    const listed = yield* Effect.option(integrations);
    const [only, second] = Option.getOrElse(listed, () => []);
    return only !== undefined && second === undefined
      ? { label: only.label, roles_page: pages(instance).roles(only.id) }
      : undefined;
  });

// The Roles tab of the integration the key belongs to, or the integrations page.
const rolesPage: Effect.Effect<string, never, TipeeClient> = Effect.gen(function* () {
  const { instance } = yield* TipeeClient;
  const link = yield* integrationLink;
  return link?.roles_page ?? pages(instance).integrations;
});

// Adds the "where to fix it" line to the errors a user can act on.
const explain = (
  error: TipeeError,
  target: Operation,
): Effect.Effect<TipeeError, never, TipeeClient> =>
  Effect.gen(function* () {
    const { instance } = yield* TipeeClient;
    const { reason } = error;
    if (reason._tag === 'RightsMissing') {
      return new TipeeError({
        fix:
          `Open ${pages(instance).integrations}, pick the integration whose key you pasted, ` +
          'and tick «Configurations générales → Se connecter avec des applications externes» in its Roles tab. ' +
          'If the API itself is not turned on yet, an admin with the «Responsable API» role does that ' +
          `at ${pages(instance).api}.`,
        reason,
      });
    }
    if (reason._tag === 'ApiKeyRejected') {
      return new TipeeError({
        fix:
          `Check the instance name, then the integration and its key at ${pages(instance).integrations}, ` +
          'and re-enter them in the extension settings.',
        reason,
      });
    }
    if (reason._tag === 'Unreachable' && /ENOTFOUND/u.test(reason.description)) {
      return new TipeeError({
        fix: `${instance}.tipee.net does not exist: check the instance name (the subdomain you sign in at) in the extension settings.`,
        reason,
      });
    }
    // A write is never sent twice (see TipeeClient), but the one attempt may
    // Have been applied before the failure: only reading it back tells.
    if (
      !target.readOnly &&
      (reason._tag === 'Unreachable' ||
        (reason._tag === 'UnexpectedStatus' && reason.status >= HTTP_SERVER_ERROR))
    ) {
      return new TipeeError({
        fix: 'This write was not retried, and Tipee may have applied it before failing: read it back before trying again.',
        reason,
      });
    }
    if (reason._tag === 'Forbidden') {
      return /not activated/iu.test(reason.body)
        ? new TipeeError({ fix: 'An administrator enables modules in Tipee.', reason })
        : new TipeeError({
            fix: `Tick ${rightFor(target)} in the integration's Roles tab: ${yield* rolesPage}`,
            reason,
          });
    }
    return error;
  });

// Calls an operation with a decoded request body and returns the decoded
// Response; a failure comes back explained, with the page that fixes it.
export const invoke = (
  target: Operation,
  params: unknown,
): Effect.Effect<unknown, TipeeError, TipeeClient> =>
  call(target, params).pipe(
    Effect.catchTag('TipeeError', (failure) =>
      Effect.flatMap(explain(failure, target), Effect.fail),
    ),
  );
