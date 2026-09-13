// Everything that can go wrong talking to Tipee, as one tagged error with a
// Tagged `reason`. Callers match on the reason (`Effect.catchReason`); tool
// Surfaces show `message`, which explains the cause and the fix.

import { Effect, Option, Schema } from 'effect';
import { HttpClientError } from 'effect/unstable/http';

// Tipee's error bodies are JSON with a `message`, or RFC 9457 problem details
// With a `detail`; either reads better than the raw body.
const ProblemBody = Schema.fromJsonString(
  Schema.Struct({
    detail: Schema.optionalKey(Schema.String),
    message: Schema.optionalKey(Schema.String),
  }),
);

const explained = (body: string): string =>
  Schema.decodeOption(ProblemBody)(body).pipe(
    Option.flatMap((problem) => Option.fromNullishOr(problem.detail ?? problem.message)),
    Option.getOrElse(() => body),
  );

/** The key is not one Tipee knows (typo, revoked, or another instance's). */
export class ApiKeyRejected extends Schema.TaggedError<ApiKeyRejected>()('ApiKeyRejected', {
  body: Schema.String,
}) {
  public override get message(): string {
    return 'Tipee rejected the API key: it is not the key of an integration on this instance.';
  }
}

/**
 * The key works, but its integration was never granted the authorization that
 * Unlocks the API. Tipee answers 401 here (not 403), so only the body tells
 * This apart from a bad key.
 */
export class RightsMissing extends Schema.TaggedError<RightsMissing>()('RightsMissing', {}) {
  public override get message(): string {
    return 'The API key works, but its Tipee integration is not allowed to use the API yet.';
  }
}

export class Forbidden extends Schema.TaggedError<Forbidden>()('Forbidden', {
  body: Schema.String,
}) {
  public override get message(): string {
    return this.body === ''
      ? 'The Tipee integration lacks the right for this operation.'
      : `Tipee refused the operation: ${this.body}`;
  }
}

export class NotFound extends Schema.TaggedError<NotFound>()('NotFound', {
  body: Schema.String,
}) {
  public override get message(): string {
    return 'Tipee could not find this resource.';
  }
}

export class RateLimited extends Schema.TaggedError<RateLimited>()('RateLimited', {}) {
  public override get message(): string {
    return 'Tipee rate limit reached even after retrying. Wait a moment and try again.';
  }
}

/** Tipee refused the request on its own terms (a documented 4xx such as 409). */
export class Rejected extends Schema.TaggedError<Rejected>()('Rejected', {
  body: Schema.String,
}) {
  public override get message(): string {
    return `Tipee rejected the request: ${this.body}`;
  }
}

export class UnexpectedStatus extends Schema.TaggedError<UnexpectedStatus>()('UnexpectedStatus', {
  body: Schema.String,
  status: Schema.Int,
}) {
  public override get message(): string {
    return `Tipee returned an unexpected error (HTTP ${this.status}) ${this.body}`.trim();
  }
}

/** The response did not match the schema generated from Tipee's OpenAPI document. */
export class UnexpectedShape extends Schema.TaggedError<UnexpectedShape>()('UnexpectedShape', {
  details: Schema.String,
}) {
  public override get message(): string {
    return `Tipee sent a response that does not match its API description:\n${this.details}`;
  }
}

/** The request never got an answer (DNS, TLS, connection reset…). */
export class Unreachable extends Schema.TaggedError<Unreachable>()('Unreachable', {
  description: Schema.String,
}) {
  public override get message(): string {
    return `Tipee could not be reached: ${this.description}`;
  }
}

export const TipeeErrorReason = Schema.Union([
  ApiKeyRejected,
  RightsMissing,
  Forbidden,
  NotFound,
  RateLimited,
  Rejected,
  UnexpectedStatus,
  UnexpectedShape,
  Unreachable,
]);
export type TipeeErrorReason = typeof TipeeErrorReason.Type;

// Tipee answers 401 (not 403) for a valid key whose integration was never
// Granted any rights, so the body is the only way to tell the cases apart.
const RIGHTS_MISSING_MARKER = 'token_rights_missing';
const HTTP_OK_MIN = 200;
const HTTP_OK_MAX = 299;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;
const HTTP_UNPROCESSABLE = 422;
const HTTP_TOO_MANY_REQUESTS = 429;

const statusReason = (status: number, rawBody: string): TipeeErrorReason => {
  const body = explained(rawBody);
  if (status === HTTP_UNAUTHORIZED) {
    return rawBody.includes(RIGHTS_MISSING_MARKER)
      ? new RightsMissing()
      : new ApiKeyRejected({ body });
  }
  if (status === HTTP_FORBIDDEN) {
    return new Forbidden({ body });
  }
  if (status === HTTP_NOT_FOUND) {
    return new NotFound({ body });
  }
  if (status === HTTP_CONFLICT || status === HTTP_UNPROCESSABLE) {
    return new Rejected({ body });
  }
  if (status === HTTP_TOO_MANY_REQUESTS) {
    return new RateLimited();
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
            return new TipeeError({
              reason: new UnexpectedShape({ details: reason.description ?? cause.message }),
            });
          }
          const body = yield* reason.response.text.pipe(Effect.orElseSucceed(() => ''));
          return new TipeeError({ reason: statusReason(status, body) });
        }
        return new TipeeError({ reason: new Unreachable({ description: cause.message }) });
      }
      if (Schema.isSchemaError(cause)) {
        return new TipeeError({ reason: new UnexpectedShape({ details: cause.message }) });
      }
      const body = cause instanceof Error ? cause.message : String(cause);
      return new TipeeError({ reason: new Rejected({ body }) });
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
