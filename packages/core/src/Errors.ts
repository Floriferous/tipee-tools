// Everything that can go wrong talking to tipee, as one tagged error with a
// tagged `reason`. Callers match on the reason (`Effect.catchReason`); tool
// surfaces show `message`, which explains the cause and the fix.

import {
  Array as Arr,
  Cause,
  Config,
  Effect,
  Option,
  Predicate,
  Record as Rec,
  Schema,
  String as Str,
  pipe,
} from 'effect';
import { HttpClientError } from 'effect/http';

import {
  ApiKeyRejected,
  Forbidden,
  InstanceNotFound,
  Internal,
  NotFound,
  RateLimited,
  Rejected,
  RightsMissing,
  TipeeErrorReason,
  UnexpectedShape,
  UnexpectedStatus,
  Unreachable,
} from './Reasons.ts';
import { SETTINGS } from './Rights.ts';

export * from './Reasons.ts';

// Tipee's error bodies are JSON with a `message`, or RFC 9457 problem details
// with a `detail`. That line leads, and the whole body follows whenever it
// says more (field errors, violations, conflicting dates): the agent must see
// everything tipee wrote.
const JsonObject = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown));
// Any value as the JSON text tipee would have sent.
const JsonText = Schema.fromJsonString(Schema.Unknown);
// Keys that only restate the line or the status.
const RESTATED = new Set(['status', 'title']);

const quoted = (body: string): string =>
  Schema.decodeOption(JsonObject)(body).pipe(
    Option.flatMap((json) =>
      Option.map(
        Arr.findFirst(['detail', 'message'], (candidate) => Predicate.isString(json[candidate])),
        (key) => {
          const line = String(json[key]);
          const complete = Arr.every(
            Rec.keys(json),
            (other) => other === key || RESTATED.has(other),
          );
          return complete ? line : `${line}\n${body}`;
        },
      ),
    ),
    Option.getOrElse(() => body),
  );

const MAX_CAUSES = 5;

// A failure's message and every cause under it, with Node's error codes
// (ENOTFOUND, ECONNRESET…), which name what actually went wrong.
const chain = (error: unknown): string => {
  const parts: Array<string> = [];
  let current = error;
  while (current instanceof Error && parts.length < MAX_CAUSES) {
    const { code } = current as { readonly code?: unknown };
    const part =
      Predicate.isString(code) && !Str.includes(code)(current.message)
        ? `${current.message} (${code})`
        : current.message;
    if (part !== '' && parts.at(-1) !== part) {
      parts.push(part);
    }
    current = current.cause;
  }
  return Arr.join(parts, ': ');
};

// Tipee names some refusals with a constant (`error` or `warning_type`, such
// as OVERLAPPING), safe to record because it says nothing about anyone.
const ErrorCode = Schema.Struct({
  error: Schema.optionalKey(Schema.String),
  warning_type: Schema.optionalKey(Schema.String),
});

const codeOf = (found: Option.Option<typeof ErrorCode.Type>): string | undefined =>
  Option.getOrUndefined(
    Option.flatMap(found, (code) => Option.fromNullishOr(code.error ?? code.warning_type)),
  );

const MAX_FIELDS = 10;
// A property path as tipee writes it (`when`, `options.allow_partial`,
// `hour_ranges[0].hour_range`): names and indices, nothing anyone wrote.
const PROPERTY_PATH = /^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*|\[\d*\])*$/u;
// `path: message` lines, as in a validation error's `detail`.
const PATH_LINE = /^\s*(?<path>[A-Za-z_][\w.[\]]*):\s/gmu;

// The paths under an object of per-field errors (`details`, `errors`).
const keyPaths = (value: unknown, prefix: string): ReadonlyArray<string> => {
  if (Arr.isArray(value)) {
    return Arr.flatMap(value, (item) => keyPaths(item, `${prefix}[]`));
  }
  if (!Predicate.isObject(value)) {
    return [prefix];
  }
  const entries = Rec.toEntries(value);
  return Arr.isArrayNonEmpty(entries)
    ? Arr.flatMap(entries, ([key, item]) =>
        keyPaths(item, prefix === '' ? key : `${prefix}.${key}`),
      )
    : [prefix];
};

// The fields a refusal names, as property paths with their indices dropped
// (`hour_ranges[].hour_range`), from a validation error's `violations`,
// `details` or `errors`, or the `path: message` lines of its `detail`; never
// a message or a value, so they can be recorded. At most ten, each once.
export const fieldsOf = (rawBody: string): ReadonlyArray<string> => {
  const json = Option.getOrUndefined(Schema.decodeOption(JsonObject)(rawBody));
  if (json === undefined) {
    return [];
  }
  const found: Array<string> = [];
  const { details, errors, violations } = json;
  if (Arr.isArray(violations)) {
    for (const violation of violations) {
      if (
        Predicate.hasProperty(violation, 'propertyPath') &&
        Predicate.isString(violation.propertyPath)
      ) {
        found.push(violation.propertyPath);
      }
    }
  }
  for (const map of [details, errors]) {
    if (Predicate.isObject(map)) {
      found.push(...keyPaths(map, ''));
    }
  }
  const { detail } = json;
  if (Predicate.isString(detail)) {
    const matches = Arr.fromIterable(Str.matchAll(PATH_LINE)(detail));
    found.push(...Arr.map(matches, (match) => match.groups?.path ?? ''));
  }
  return pipe(
    found,
    Arr.filter((candidate) => PROPERTY_PATH.test(candidate)),
    Arr.map((candidate) => Str.replaceAll(/\[\d*\]/gu, '[]')(candidate)),
    Arr.dedupe,
    Arr.take(MAX_FIELDS),
  );
};

// Tipee answers 401 (not 403) for a valid key whose integration was never
// granted any rights, so the body is the only way to tell the cases apart.
const RIGHTS_MISSING_MARKER = 'token_rights_missing';
const INSTANCE_NOT_FOUND_MARKER = 'instance_not_found';
const HTTP_OK_MIN = 200;
const HTTP_OK_MAX = 299;
const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;
const HTTP_GONE = 410;
const HTTP_UNPROCESSABLE = 422;
const HTTP_TOO_MANY_REQUESTS = 429;

const statusReason = (
  status: number,
  rawBody: string,
  retryAfter: string | undefined,
): TipeeErrorReason => {
  const body = quoted(rawBody);
  if (status === HTTP_UNAUTHORIZED) {
    return Str.includes(RIGHTS_MISSING_MARKER)(rawBody)
      ? RightsMissing.make({ body })
      : ApiKeyRejected.make({ body });
  }
  if (status === HTTP_FORBIDDEN) {
    return Forbidden.make({ body });
  }
  if (status === HTTP_NOT_FOUND) {
    return NotFound.make({ body });
  }
  if (status === HTTP_GONE && Str.includes(INSTANCE_NOT_FOUND_MARKER)(rawBody)) {
    return InstanceNotFound.make({ body });
  }
  if (status === HTTP_BAD_REQUEST || status === HTTP_CONFLICT || status === HTTP_UNPROCESSABLE) {
    const code = codeOf(Schema.decodeOption(Schema.fromJsonString(ErrorCode))(rawBody));
    const fields = fieldsOf(rawBody);
    return Rejected.make({
      body,
      status,
      ...(code === undefined ? {} : { code }),
      ...(fields.length === 0 ? {} : { fields }),
    });
  }
  if (status === HTTP_TOO_MANY_REQUESTS) {
    return RateLimited.make({ body, ...(retryAfter === undefined ? {} : { retryAfter }) });
  }
  return UnexpectedStatus.make({ body, status });
};

export class TipeeError extends Schema.TaggedError<TipeeError, { readonly brand: unique symbol }>()(
  'TipeeError',
  {
    /** Where to fix it, with a link into the user's tipee when one is known. */
    fix: Schema.optionalKey(Schema.String),
    reason: TipeeErrorReason,
  },
) {
  public override get message(): string {
    return this.fix === undefined ? this.reason.message : `${this.reason.message} ${this.fix}`;
  }

  // Explains whatever the generated client failed with: an HTTP status, a
  // transport failure, a response that does not match the API description,
  // or an error tipee documents for the operation (such as a 409).
  public static readonly fromCause: (cause: unknown) => Effect.Effect<TipeeError> =
    Effect.fnUntraced(function* (cause: unknown) {
      if (Schema.is(TipeeError)(cause)) {
        return cause;
      }
      if (HttpClientError.isHttpClientError(cause)) {
        const { reason } = cause;
        // The derived client reports an undeclared status as a decode failure
        // on that response; a decode failure on a 2xx is a shape mismatch.
        if (reason._tag === 'StatusCodeError' || reason._tag === 'DecodeError') {
          const { status } = reason.response;
          if (status >= HTTP_OK_MIN && status <= HTTP_OK_MAX) {
            const details = Schema.isSchemaError(reason.cause)
              ? reason.cause.message
              : (reason.description ?? cause.message);
            return TipeeError.make({ reason: UnexpectedShape.make({ details, status }) });
          }
          const body = yield* reason.response.text.pipe(Effect.orElseSucceed(() => ''));
          const retryAfter = reason.response.headers['retry-after'];
          return TipeeError.make({ reason: statusReason(status, body, retryAfter) });
        }
        const description = Arr.join(
          Arr.filter([cause.message, chain(reason.cause)], Str.isNonEmpty),
          ': ',
        );
        return TipeeError.make({ reason: Unreachable.make({ description }) });
      }
      // An attempt or a call that outlasted its timeout; TipeeClient's
      // message says how long tipee was given.
      if (Cause.isTimeoutError(cause)) {
        const description = cause.message === '' ? 'tipee did not answer in time' : cause.message;
        return TipeeError.make({ reason: Unreachable.make({ description }) });
      }
      if (Schema.isSchemaError(cause)) {
        return TipeeError.make({ reason: UnexpectedShape.make({ details: cause.message }) });
      }
      // An error the document declares (every one is a 409) arrives decoded,
      // as the plain object tipee answered: quote it whole, since it names
      // the conflicting dates or locked schedules.
      if (Predicate.isObject(cause) && !(cause instanceof Error)) {
        const code = codeOf(Schema.decodeOption(ErrorCode)(cause));
        const body = yield* Schema.encodeUnknownEffect(JsonText)(cause).pipe(
          Effect.orElseSucceed(() => '(an answer that cannot be written as JSON)'),
        );
        return TipeeError.make({
          reason: Rejected.make({
            body,
            status: HTTP_CONFLICT,
            ...(code === undefined ? {} : { code }),
          }),
        });
      }
      const description = cause instanceof Error ? chain(cause) : String(cause);
      return TipeeError.make({ reason: Internal.make({ description }) });
    });
}

/** `TIPEE_INSTANCE` or `TIPEE_API_KEY` is missing or malformed. */
export class ConfigurationMissing extends Schema.TaggedError<
  ConfigurationMissing,
  { readonly brand: unique symbol }
>()('ConfigurationMissing', { cause: Schema.Defect() }) {
  public override get message(): string {
    const detail =
      this.cause instanceof Config.ConfigError ? this.cause.cause.message : String(this.cause);
    return (
      'tipee is not set up: enter your tipee instance (acme for acme.tipee.net) and an API key ' +
      `in ${SETTINGS}.\n${detail}`
    );
  }
}
