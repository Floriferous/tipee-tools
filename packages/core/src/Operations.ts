// The catalogue of Tipee operations, read off the generated HttpApi: one
// Entry per endpoint with its name, description, request and response
// Schemas, and whether it only reads. `invoke` calls any of them through the
// Client and explains failures as TipeeError, with a link into the user's
// Tipee when the fix is a missing right. Tools are built from this.

import { Context, Effect, Option, Schema } from 'effect';
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

// The call itself: decoded request in, decoded response out, TipeeError on failure.
const call = (
  target: Operation,
  params: unknown,
): Effect.Effect<unknown, TipeeError, TipeeClient> =>
  Effect.gen(function* () {
    const { api } = yield* TipeeClient;
    const methods = api as unknown as Record<string, Record<string, Method> | undefined>;
    const method = methods[target.group]?.[target.endpoint];
    if (method === undefined) {
      return yield* Effect.die(new Error(`the client has no method for ${target.name}`));
    }
    return yield* method({ payload: params }).pipe(
      Effect.catch((error) => Effect.flatMap(TipeeError.fromCause(error), Effect.fail)),
    );
  });

// The pages where rights are fixed, on the user's own instance.
const pages = (instance: string) => {
  const base = `https://${instance}.tipee.net`;
  return {
    api: `${base}/admin/instance/integrations/`,
    integrations: `${base}/hr-core/integrations`,
    roles: (integrationId: string) => `${base}/hr-core/profile/${integrationId}/roles`,
  };
};

const PAGE_SIZE = 100;

interface Kind {
  readonly id: string;
  readonly machine_name: string;
}
interface Page {
  readonly data: ReadonlyArray<{ readonly id: string }>;
}

// The integrations of the instance, when the key may list them.
const integrations: Effect.Effect<
  ReadonlyArray<{ readonly id: string }>,
  TipeeError,
  TipeeClient
> = Effect.gen(function* () {
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
});

// The Roles tab of the integration the key belongs to, when the API lets us
// List integrations and there is exactly one; the integrations page otherwise.
const rolesPage: Effect.Effect<string, never, TipeeClient> = Effect.gen(function* () {
  const { instance } = yield* TipeeClient;
  const listed = yield* Effect.option(integrations);
  const [only, second] = Option.getOrElse(listed, () => []);
  return only !== undefined && second === undefined
    ? pages(instance).roles(only.id)
    : pages(instance).integrations;
});

// The right a group's operations usually need, as named in the Roles tab.
const RIGHTS: Record<
  string,
  { readonly module: string; readonly read?: string; readonly write?: string }
> = {
  Activity: { module: 'Activités' },
  Balances: { module: 'Calcul des soldes', read: 'Voir les soldes' },
  Directory: {
    module: 'Cœur RH',
    read: 'Voir les collaborateurs',
    write: 'Gérer les collaborateurs',
  },
  Schedule: { module: 'Planning', read: 'Voir les plannings', write: 'Planifier' },
  Timeclock: { module: 'Saisie des heures', read: 'Voir les timbrages' },
};

const rightFor = (target: Operation): string => {
  const rights = RIGHTS[target.group];
  if (rights === undefined) {
    return 'the right this operation needs';
  }
  const right = target.readOnly ? rights.read : rights.write;
  return right === undefined
    ? `the ${rights.module} right this operation needs`
    : `«${rights.module} → ${right}»`;
};

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
  Effect.gen(function* () {
    return yield* call(target, params).pipe(
      Effect.catch((error) => Effect.flatMap(explain(error, target), Effect.fail)),
    );
  });
