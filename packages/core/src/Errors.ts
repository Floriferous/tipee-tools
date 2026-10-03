// Everything that can go wrong talking to Tipee, as one tagged error with a
// Tagged `reason`. Callers match on the reason (`Effect.catchReason`); tool
// Surfaces show `message`, which explains the cause and the fix.

import { Effect, Option, Schema } from 'effect';
import { HttpClientError } from 'effect/http';

import {
  ApiKeyRejected,
  Forbidden,
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

export * from './Reasons.ts';

// Tipee's error bodies are JSON with a `message`, or RFC 9457 problem details
// With a `detail`. That line leads, and the whole body follows whenever it
// Says more (field errors, violations, conflicting dates): the agent must see
// Everything Tipee wrote.
const JsonObject = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown));
// Keys that only restate the line or the status.
const RESTATED = new Set(['status', 'title']);

const quoted = (body: string): string =>
  Schema.decodeOption(JsonObject)(body).pipe(
    Option.flatMap((json) => {
      const key = ['detail', 'message'].find((candidate) => typeof json[candidate] === 'string');
      if (key === undefined) {
        return Option.none();
      }
      const line = String(json[key]);
      const complete = Object.keys(json).every((other) => other === key || RESTATED.has(other));
      return Option.some(complete ? line : `${line}\n${body}`);
    }),
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
      typeof code === 'string' && !current.message.includes(code)
        ? `${current.message} (${code})`
        : current.message;
    if (part !== '' && parts.at(-1) !== part) {
      parts.push(part);
    }
    current = current.cause;
  }
  return parts.join(': ');
};

// Tipee names some refusals with a constant (`error` or `warning_type`, such
// As OVERLAPPING), safe to record because it says nothing about anyone.
const ErrorCode = Schema.Struct({
  error: Schema.optionalKey(Schema.String),
  warning_type: Schema.optionalKey(Schema.String),
});

const codeOf = (found: Option.Option<typeof ErrorCode.Type>): string | undefined =>
  Option.getOrUndefined(
    Option.flatMap(found, (code) => Option.fromNullishOr(code.error ?? code.warning_type)),
  );

// Tipee answers 401 (not 403) for a valid key whose integration was never
// Granted any rights, so the body is the only way to tell the cases apart.
const RIGHTS_MISSING_MARKER = 'token_rights_missing';
const HTTP_OK_MIN = 200;
const HTTP_OK_MAX = 299;
const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;
const HTTP_UNPROCESSABLE = 422;
const HTTP_TOO_MANY_REQUESTS = 429;

const statusReason = (
  status: number,
  rawBody: string,
  retryAfter: string | undefined,
): TipeeErrorReason => {
  const body = quoted(rawBody);
  if (status === HTTP_UNAUTHORIZED) {
    return rawBody.includes(RIGHTS_MISSING_MARKER)
      ? new RightsMissing({ body })
      : new ApiKeyRejected({ body });
  }
  if (status === HTTP_FORBIDDEN) {
    return new Forbidden({ body });
  }
  if (status === HTTP_NOT_FOUND) {
    return new NotFound({ body });
  }
  if (status === HTTP_BAD_REQUEST || status === HTTP_CONFLICT || status === HTTP_UNPROCESSABLE) {
    const code = codeOf(Schema.decodeOption(Schema.fromJsonString(ErrorCode))(rawBody));
    return new Rejected({ body, status, ...(code === undefined ? {} : { code }) });
  }
  if (status === HTTP_TOO_MANY_REQUESTS) {
    return new RateLimited({ body, ...(retryAfter === undefined ? {} : { retryAfter }) });
  }
  return new UnexpectedStatus({ body, status });
};

export class TipeeError extends Schema.TaggedError<TipeeError>()('TipeeError', {
  /** Where to fix it, with a link into the user's Tipee when one is known. */
  fix: Schema.optionalKey(Schema.String),
  reason: TipeeErrorReason,
}) {
  public override get message(): string {
    return this.fix === undefined ? this.reason.message : `${this.reason.message} ${this.fix}`;
  }

  // Explains whatever the generated client failed with: an HTTP status, a
  // Transport failure, a response that does not match the API description,
  // Or an error Tipee documents for the operation (such as a 409).
  public static readonly fromCause = (cause: unknown): Effect.Effect<TipeeError> =>
    Effect.gen(function* () {
      if (cause instanceof TipeeError) {
        return cause;
      }
      if (cause instanceof HttpClientError.HttpClientError) {
        const { reason } = cause;
        // The derived client reports an undeclared status as a decode failure
        // On that response; a decode failure on a 2xx is a shape mismatch.
        if (
          reason instanceof HttpClientError.StatusCodeError ||
          reason instanceof HttpClientError.DecodeError
        ) {
          const { status } = reason.response;
          if (status >= HTTP_OK_MIN && status <= HTTP_OK_MAX) {
            const details = Schema.isSchemaError(reason.cause)
              ? reason.cause.message
              : (reason.description ?? cause.message);
            return new TipeeError({ reason: new UnexpectedShape({ details }) });
          }
          const body = yield* reason.response.text.pipe(Effect.orElseSucceed(() => ''));
          const retryAfter = reason.response.headers['retry-after'];
          return new TipeeError({ reason: statusReason(status, body, retryAfter) });
        }
        const description = [cause.message, chain(reason.cause)]
          .filter((part) => part !== '')
          .join(': ');
        return new TipeeError({ reason: new Unreachable({ description }) });
      }
      if (Schema.isSchemaError(cause)) {
        return new TipeeError({ reason: new UnexpectedShape({ details: cause.message }) });
      }
      // An error the document declares (every one is a 409) arrives decoded,
      // As the plain object Tipee answered: quote it whole, since it names
      // The conflicting dates or locked schedules.
      if (typeof cause === 'object' && cause !== null && !(cause instanceof Error)) {
        const code = codeOf(Schema.decodeUnknownOption(ErrorCode)(cause));
        return new TipeeError({
          reason: new Rejected({
            body: JSON.stringify(cause),
            status: HTTP_CONFLICT,
            ...(code === undefined ? {} : { code }),
          }),
        });
      }
      const description = cause instanceof Error ? chain(cause) : String(cause);
      return new TipeeError({ reason: new Internal({ description }) });
    });
}

/** `TIPEE_INSTANCE` or `TIPEE_API_KEY` is missing or malformed. */
export class ConfigurationMissing extends Schema.TaggedError<ConfigurationMissing>()(
  'ConfigurationMissing',
  { cause: Schema.Defect() },
) {
  public override get message(): string {
    return (
      'Missing Tipee configuration: set TIPEE_INSTANCE (the subdomain you sign in at) ' +
      `and TIPEE_API_KEY (an integration key). ${String(this.cause)}`
    );
  }
}
