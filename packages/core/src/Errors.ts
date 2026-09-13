// Everything that can go wrong talking to Tipee, as one tagged error with a
// Tagged `reason`. Callers match on the reason (`Effect.catchReason`); tool
// Surfaces show `message`, which explains the cause and the fix.

import { Schema } from 'effect';

/** The key is not one Tipee knows (typo, revoked, or another instance's). */
export class ApiKeyRejected extends Schema.TaggedError<ApiKeyRejected>()('ApiKeyRejected', {
  body: Schema.String,
}) {
  public override get message(): string {
    return 'Tipee rejected the API key. Check that TIPEE_API_KEY is the key of an integration on this instance.';
  }
}

/**
 * The key works, but its integration was never granted the authorization that
 * Unlocks the API. Tipee answers 401 here (not 403), so only the body tells
 * This apart from a bad key.
 */
export class RightsMissing extends Schema.TaggedError<RightsMissing>()('RightsMissing', {}) {
  public override get message(): string {
    return (
      'The API key works, but its Tipee integration has no permissions yet. ' +
      'In the Tipee admin panel, grant it "Configurations générales → Se connecter avec des applications externes", ' +
      'then read access to the Planning and Cœur RH modules.'
    );
  }
}

export class Forbidden extends Schema.TaggedError<Forbidden>()('Forbidden', {
  body: Schema.String,
}) {
  public override get message(): string {
    return 'The API key is valid but its Tipee integration lacks the permission for this data.';
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

export class UnexpectedStatus extends Schema.TaggedError<UnexpectedStatus>()('UnexpectedStatus', {
  body: Schema.String,
  status: Schema.Int,
}) {
  public override get message(): string {
    return `Tipee returned an unexpected error (HTTP ${this.status}) ${this.body}`.trim();
  }
}

/** The response did not match the schema: Tipee changed a shape. */
export class UnexpectedShape extends Schema.TaggedError<UnexpectedShape>()('UnexpectedShape', {
  details: Schema.String,
  endpoint: Schema.String,
}) {
  public override get message(): string {
    return `Tipee sent an unexpected response for ${this.endpoint}:\n${this.details}`;
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
  UnexpectedStatus,
  UnexpectedShape,
  Unreachable,
]);
export type TipeeErrorReason = typeof TipeeErrorReason.Type;

export class TipeeError extends Schema.TaggedError<TipeeError>()('TipeeError', {
  reason: TipeeErrorReason,
}) {
  public override get message(): string {
    return this.reason.message;
  }
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
