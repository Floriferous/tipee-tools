// Why a call to tipee failed, one class per reason. Each message leads with
// what happened and the HTTP status, then quotes tipee, so the agent reads
// exactly what tipee answered.

import { Schema } from 'effect';

// Tipee's own words after a summary, or the summary alone when it said nothing.
const saying = (summary: string, body: string, otherwise: string): string =>
  body === '' ? `${summary}: ${otherwise}` : `${summary}: ${body}`;

/** The key is not one tipee accepts (typo, revoked, expired, or another instance's). */
export class ApiKeyRejected extends Schema.TaggedError<ApiKeyRejected>()('ApiKeyRejected', {
  body: Schema.String,
}) {
  public override get message(): string {
    return saying(
      'tipee refused the API key (HTTP 401)',
      this.body,
      'it is mistyped, revoked, or the key of another instance.',
    );
  }
}

/**
 * The key works, but its integration was never granted the authorization that
 * unlocks the API. tipee answers 401 here (not 403), so only the body tells
 * this apart from a bad key.
 */
export class RightsMissing extends Schema.TaggedError<RightsMissing>()('RightsMissing', {
  body: Schema.String,
}) {
  public override get message(): string {
    return `The API key works, but its tipee integration is not allowed to use the API yet (HTTP 401: ${this.body}).`;
  }
}

export class Forbidden extends Schema.TaggedError<Forbidden>()('Forbidden', {
  body: Schema.String,
}) {
  public override get message(): string {
    return saying(
      'tipee refused the operation (HTTP 403)',
      this.body,
      'the integration lacks the right for it.',
    );
  }
}

export class NotFound extends Schema.TaggedError<NotFound>()('NotFound', {
  body: Schema.String,
}) {
  public override get message(): string {
    return saying('tipee could not find it (HTTP 404)', this.body, 'no such resource.');
  }
}

export class RateLimited extends Schema.TaggedError<RateLimited>()('RateLimited', {
  body: Schema.String,
  /** Tipee's Retry-After header, in seconds or as a date. */
  retryAfter: Schema.optionalKey(Schema.String),
}) {
  public override get message(): string {
    const wait =
      this.retryAfter === undefined
        ? 'Wait a moment before trying again.'
        : `tipee asks to wait before trying again (Retry-After: ${this.retryAfter}).`;
    const said = this.body === '' ? '' : ` tipee said: ${this.body}`;
    return `tipee's rate limit was still reached after retrying (HTTP 429). ${wait}${said}`;
  }
}

/** Tipee refused the request on its own terms (a documented 4xx such as 409). */
export class Rejected extends Schema.TaggedError<Rejected>()('Rejected', {
  body: Schema.String,
  /** Tipee's machine-readable reason when it gives one, such as OVERLAPPING. */
  code: Schema.optionalKey(Schema.String),
  status: Schema.Int,
}) {
  public override get message(): string {
    const code = this.code === undefined ? '' : `, ${this.code}`;
    return `tipee rejected the request (HTTP ${this.status}${code}): ${this.body}`;
  }
}

export class UnexpectedStatus extends Schema.TaggedError<UnexpectedStatus>()('UnexpectedStatus', {
  body: Schema.String,
  status: Schema.Int,
}) {
  public override get message(): string {
    return saying(
      `tipee answered with an unexpected error (HTTP ${this.status})`,
      this.body,
      'no explanation given.',
    );
  }
}

/**
 * The response did not match the schema generated from tipee's OpenAPI
 * document. tipee did accept the request, so a write may well have gone
 * through: the message says so.
 */
export class UnexpectedShape extends Schema.TaggedError<UnexpectedShape>()('UnexpectedShape', {
  details: Schema.String,
}) {
  public override get message(): string {
    return (
      'tipee accepted the request but answered with a shape that does not match its API ' +
      `description (a write may still have gone through; read it back to be sure):\n${this.details}`
    );
  }
}

/** The request body does not match tipee's API description, so it was never sent. */
export class InvalidRequest extends Schema.TaggedError<InvalidRequest>()('InvalidRequest', {
  details: Schema.String,
}) {
  public override get message(): string {
    return `The request does not match tipee's API description, so it was not sent:\n${this.details}`;
  }
}

/**
 * No tipee instance has this name. `*.tipee.net` resolves for any name, so a
 * typo is not a DNS failure: tipee answers 410 `instance_not_found`.
 */
export class InstanceNotFound extends Schema.TaggedError<InstanceNotFound>()('InstanceNotFound', {
  body: Schema.String,
}) {
  public override get message(): string {
    return saying(
      'tipee has no instance at this address (HTTP 410)',
      this.body,
      'no such instance.',
    );
  }
}

/** The request never got an answer (DNS, TLS, connection reset, timeout…). */
export class Unreachable extends Schema.TaggedError<Unreachable>()('Unreachable', {
  description: Schema.String,
}) {
  public override get message(): string {
    return `tipee could not be reached (${this.description}).`;
  }
}

/**
 * TIPEE_INSTANCE or TIPEE_API_KEY cannot be used, so nothing was sent. The
 * description is ConfigurationMissing's message, which names the setting.
 */
export class NotConfigured extends Schema.TaggedError<NotConfigured>()('NotConfigured', {
  description: Schema.String,
}) {
  public override get message(): string {
    return this.description;
  }
}

/** A failure in tipee-tools itself, not an answer from tipee: a bug to report. */
export class Internal extends Schema.TaggedError<Internal>()('Internal', {
  description: Schema.String,
}) {
  public override get message(): string {
    return `tipee-tools failed on its own, not because of anything tipee answered: ${this.description}`;
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
  InvalidRequest,
  InstanceNotFound,
  Unreachable,
  NotConfigured,
  Internal,
]);
export type TipeeErrorReason = typeof TipeeErrorReason.Type;
