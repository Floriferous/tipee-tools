// The MCP tools: one per operation in Tipee's API document, built from the
// Core's operation catalogue, plus `check`. Names, descriptions, parameter
// And result schemas all come from the document; the annotations say whether
// A tool only reads, so clients can decide what to auto-approve.

import { TipeeError, operations } from '@tipee-tools/core';
import type { Operation } from '@tipee-tools/core';
import { Schema } from 'effect';
import { Tool, Toolkit } from 'effect/unstable/ai';

/** What a tool returns when Tipee answers with no content (201/204). */
export const Done = Schema.Struct({ done: Schema.Literal(true) });

const LocalDate = Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/u));

export const EndpointReport = Schema.Struct({
  count: Schema.optionalKey(Schema.Int),
  error: Schema.optionalKey(Schema.String),
  name: Schema.String,
  status: Schema.Literals(['ok', 'failed']),
});

export const Check = Tool.make('check', {
  description:
    'Call the main read endpoints of Tipee and validate the response shapes. Run it first ' +
    'after installing, or when another tool fails: it explains missing authorizations and ' +
    'detects the day Tipee changes a response shape. Stores nothing.',
  failure: TipeeError,
  parameters: Schema.Struct({
    from: Schema.optionalKey(
      LocalDate.annotate({ description: 'First day of the range, YYYY-MM-DD' }),
    ),
    to: Schema.optionalKey(
      LocalDate.annotate({ description: 'Last day of the range, YYYY-MM-DD' }),
    ),
  }),
  success: Schema.Struct({
    date_range: Schema.String,
    endpoints: Schema.Array(EndpointReport),
    ok: Schema.Boolean,
  }),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true);

const toolFor = (operation: Operation) =>
  Tool.dynamic(operation.name, {
    description: operation.description,
    failure: TipeeError,
    parameters: operation.parameters,
    success: operation.success ?? Done,
  })
    .annotate(Tool.Readonly, operation.readOnly)
    .annotate(Tool.Destructive, operation.destructive)
    .annotate(Tool.Idempotent, operation.readOnly);

export const TipeeToolkit = Toolkit.make(
  Check,
  ...operations.map((operation) => toolFor(operation)),
);
