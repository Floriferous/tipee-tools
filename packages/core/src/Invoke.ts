// Calling an operation: `invoke` sends any operation of the catalogue
// through the client and explains failures as TipeeError, each ending with
// the next step, with a link into the user's Tipee when the fix is a right
// to tick.

import { Effect, Option, Schema } from 'effect';

import { InvalidRequest, TipeeError } from './Errors.ts';
import type { TipeeErrorReason } from './Errors.ts';
import { operation } from './Operations.ts';
import type { Operation } from './Operations.ts';
import { SETTINGS, pages, rightFor } from './Rights.ts';
import { TipeeClient } from './TipeeClient.ts';

type Method = (request: { readonly payload: unknown }) => Effect.Effect<unknown, unknown>;

// The call itself: decoded request in, decoded response out, TipeeError on failure.
const call = (
  target: Operation,
  params: unknown,
): Effect.Effect<unknown, TipeeError, TipeeClient> =>
  Effect.gen(function* () {
    const { api } = yield* TipeeClient;
    // Checked against the document before anything is sent, so a schema
    // error afterwards can only be Tipee's answer.
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

// The next step for the reasons whose fix does not depend on the call.
const FIXES: Partial<Record<TipeeErrorReason['_tag'], string>> = {
  Internal: 'Please report it at https://github.com/Floriferous/tipee-tools/issues.',
  InvalidRequest: 'Fix these parameters and call again.',
  NotFound: 'Re-read the list the id came from.',
  Rejected:
    'Nothing was changed. If a parameter was malformed, fix it and call again; if Tipee ' +
    'refused the change itself, tell the user — a different change needs their yes first.',
  UnexpectedShape: 'Run check_setup and suggest updating Tipee for Claude.',
};

// Node's names for a certificate it does not trust, which is what a network
// that inspects HTTPS presents.
const UNTRUSTED_CERTIFICATE = /CERT|SELF_SIGNED|UNABLE_TO_(?:GET|VERIFY)/u;

// Adds the next step to a failure: what to retry, or where to fix it.
const explain = (
  error: TipeeError,
  target: Operation,
): Effect.Effect<TipeeError, never, TipeeClient> =>
  Effect.gen(function* () {
    const { instance } = yield* TipeeClient;
    const { reason } = error;
    const fixed = (fix: string): TipeeError => new TipeeError({ fix, reason });
    if (reason._tag === 'RightsMissing') {
      return fixed(
        `Open ${pages(instance).integrations}, pick the integration whose key you pasted, ` +
          'and tick «Configurations générales → Se connecter avec des applications externes» in its Roles tab. ' +
          'If the API itself is not turned on yet, an admin with the «Responsable API» role does that ' +
          `at ${pages(instance).api}.`,
      );
    }
    if (reason._tag === 'ApiKeyRejected') {
      return fixed(
        `Check the instance name, then the integration and its key at ${pages(instance).integrations}, ` +
          `and re-enter them in ${SETTINGS}.`,
      );
    }
    if (
      reason._tag === 'InstanceNotFound' ||
      (reason._tag === 'Unreachable' && /ENOTFOUND/u.test(reason.description))
    ) {
      return fixed(
        `${instance}.tipee.net does not exist: check the instance name (the subdomain you sign in at) in ${SETTINGS}.`,
      );
    }
    if (reason._tag === 'Unreachable' && UNTRUSTED_CERTIFICATE.test(reason.description)) {
      return fixed(
        'Nothing was sent to Tipee: this network intercepts HTTPS with a certificate this ' +
          'computer does not trust. Ask IT to install their root certificate or to exempt ' +
          `${instance}.tipee.net; retrying will not help.`,
      );
    }
    const serverError = reason._tag === 'UnexpectedStatus' && reason.status >= HTTP_SERVER_ERROR;
    // A write is never sent twice (see TipeeClient), but the one attempt may
    // have been applied before the failure: only reading it back tells.
    if (!target.readOnly && (reason._tag === 'Unreachable' || serverError)) {
      return fixed(
        'This write was not retried, and Tipee may have applied it before failing: read it back before trying again.',
      );
    }
    if (reason._tag === 'Unreachable') {
      return fixed('Check the internet connection and try again.');
    }
    if (serverError) {
      return fixed('Try again in a moment; run check_setup if it persists.');
    }
    if (reason._tag === 'Forbidden') {
      return /not activated/iu.test(reason.body)
        ? fixed('The module is off on this instance: only a Tipee administrator can turn it on.')
        : fixed(`Tick ${rightFor(target)} in the integration's Roles tab: ${yield* rolesPage}`);
    }
    const fix = FIXES[reason._tag];
    return fix === undefined ? error : fixed(fix);
  });

// Calls an operation with a decoded request body and returns the decoded
// response; a failure comes back explained, with its next step.
export const invoke = (
  target: Operation,
  params: unknown,
): Effect.Effect<unknown, TipeeError, TipeeClient> =>
  call(target, params).pipe(
    Effect.catchTag('TipeeError', (failure) =>
      Effect.flatMap(explain(failure, target), Effect.fail),
    ),
  );
