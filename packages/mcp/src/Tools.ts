// The MCP tools: one per operation in tipee's API document, built from the
// core's operation catalogue, a `*_many` tool for the few operations agents
// edit in bulk (Batch.ts), plus `check_setup` and `update_plugin`. Names,
// descriptions, parameter and result schemas all come from the document; the
// annotations say what a tool does to tipee's data, so clients can decide what
// to auto-approve. Every tool is strict: an unknown key is refused, not dropped.

import { TipeeError, operation as operationNamed, operations } from '@tipee-tools/core';
import type { Operation } from '@tipee-tools/core';
import { Schema } from 'effect';
import { Tool, Toolkit } from 'effect/ai';

import { BATCHED, BatchReport, MAX_ITEMS, START_DEADLINE_SECONDS } from './Batch.ts';
import { Installed, UpdateFailed } from './Updates.ts';

/** What a tool returns when tipee answers with no content (201/204). */
export const Done = Schema.Struct({ done: Schema.Literal(true) });

const LocalDate = Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/u));

export const EndpointReport = Schema.Struct({
  count: Schema.optionalKey(Schema.Int),
  error: Schema.optionalKey(Schema.String),
  name: Schema.String,
  status: Schema.Literals(['ok', 'failed', 'skipped']).annotate({
    description:
      'ok: the endpoint answered as expected. skipped: the module is off or a right is ' +
      'missing, and the error names the right and the page where it is ticked; or it was ' +
      'not called, for want of an id from an earlier endpoint, and the error says which. ' +
      'failed: tipee answered in a shape this version cannot read.',
  }),
});

export const IntegrationReport = Schema.Struct({
  label: Schema.String,
  roles_page: Schema.String,
});

export const UpdateReport = Schema.Struct({
  url: Schema.String,
  version: Schema.String,
});

export const Check = Tool.make('check_setup', {
  description:
    'Call the main read endpoints of tipee and validate the response shapes. Run it first ' +
    'after installing, or when a tool reports a refused key, a missing right or an ' +
    'unexpected response shape: it names the integration the key belongs to and where its ' +
    'rights are set, explains missing authorizations, detects the day tipee changes a ' +
    'response shape, and says when a newer version of tipee for Claude exists. Stores nothing.',
  failure: TipeeError,
  parameters: Schema.Struct({
    from: Schema.optionalKey(
      LocalDate.annotate({
        description:
          'First day of the range, YYYY-MM-DD; without both from and to, the coming week',
      }),
    ),
    to: Schema.optionalKey(
      LocalDate.annotate({ description: 'Last day of the range, YYYY-MM-DD' }),
    ),
  }),
  success: Schema.Struct({
    date_range: Schema.String,
    endpoints: Schema.Array(EndpointReport),
    integration: Schema.optionalKey(
      IntegrationReport.annotate({
        description: 'The integration the key belongs to and the page where its rights are ticked.',
      }),
    ),
    ok: Schema.Boolean.annotate({
      description: 'False only when an endpoint failed; skipped endpoints keep it true.',
    }),
    update: Schema.optionalKey(
      UpdateReport.annotate({
        description:
          'A newer version of tipee for Claude, when one exists, and where to download it.',
      }),
    ),
    version: Schema.String.annotate({
      description: 'The version of tipee for Claude running, to quote when reporting a problem.',
    }),
  }),
})
  .annotate(Tool.Title, 'Check tipee setup')
  .annotate(Tool.Strict, true)
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true);

export const InstallUpdate = Tool.make('update_plugin', {
  description:
    'Installs the newer version of tipee for Claude that check_setup reported. In Claude ' +
    'Desktop it downloads the release, verifies it and opens it, and Claude Desktop then asks ' +
    'the user to confirm; the instance and key are kept. In Claude Code it answers with the ' +
    'commands to run. Call it only after the user agreed to update.',
  failure: UpdateFailed,
  success: Schema.Struct({
    message: Schema.String,
    outcome: Installed,
  }),
})
  .annotate(Tool.Title, 'Update tipee for Claude')
  .annotate(Tool.Strict, true)
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, true)
  .annotate(Tool.Idempotent, true);

// Claude Desktop never loads the plugin's skill: what a write must do first
// has to travel with the tool itself.
const CONFIRM =
  'Changes tipee: first tell the user exactly what will change and for whom, and wait for ' +
  'their yes, unless they asked for this precise change.';

const describe = (operation: Operation): string => {
  if (operation.readOnly) {
    return operation.description;
  }
  // Some tipee descriptions lack a final period; CONFIRM must not run into them.
  const text = operation.description.trimEnd();
  const base = /[.!?]$/u.test(text) ? text : `${text}.`;
  const final = /\.delete/u.test(operation.path) ? ' It cannot be undone.' : '';
  return `${base} ${CONFIRM}${final}`;
};

const words = (part: string): string => part.replaceAll('-', ' ');

// `/api/schedule/day-tasks.submit-for-contributor` → "Day tasks: submit for contributor".
const titleOf = (path: string): string => {
  const [resource = '', verb = ''] = path.replace(/^\/api\/[^/]+\//u, '').split('.');
  const subject = words(resource);
  return `${subject.charAt(0).toUpperCase()}${subject.slice(1)}: ${words(verb)}`;
};

const toolFor = (operation: Operation) =>
  Tool.dynamic(operation.name, {
    description: describe(operation),
    failure: TipeeError,
    parameters: operation.parameters,
    success: operation.success ?? Done,
  })
    .annotate(Tool.Title, titleOf(operation.path))
    .annotate(Tool.Strict, true)
    .annotate(Tool.Readonly, operation.readOnly)
    .annotate(Tool.Destructive, operation.destructive)
    .annotate(Tool.Idempotent, operation.readOnly);

// The name of an operation's batch tool: `schedules_update_many`.
export const batchName = (operation: Operation): string => `${operation.name}_many`;

// The batch tool says what the single one does, then how a batch behaves.
const describeBatch = (operation: Operation): string =>
  `Applies ${operation.name} to each item in order, one after another, up to ${MAX_ITEMS} in ` +
  `one call: for changes that differ per item (use ${operation.name} for a single change). ` +
  'Changes tipee: first tell the user every change and for whom, and wait for one yes, ' +
  'unless they asked for these precise changes. It stops at the first failure: the items ' +
  'before it were applied, the failed one was not or may have been (its outcome says which; ' +
  'read it back when unknown), and the rest were not sent; nothing is rolled back. It also ' +
  `stops after ${START_DEADLINE_SECONDS} s and says which items to send again. Indices are ` +
  `0-based. Each item is one ${operation.name} call: ${operation.description}`;

const batchToolFor = (operation: Operation) =>
  Tool.dynamic(batchName(operation), {
    description: describeBatch(operation),
    failure: TipeeError,
    parameters: Schema.Struct({
      items: Schema.Array(operation.parameters).check(
        Schema.isMinLength(1),
        Schema.isMaxLength(MAX_ITEMS),
      ),
    }),
    success: BatchReport,
  })
    .annotate(Tool.Title, `${titleOf(operation.path)} many`)
    .annotate(Tool.Strict, true)
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, operation.destructive)
    .annotate(Tool.Idempotent, false);

/** The operations that have a batch tool. */
export const batched: ReadonlyArray<Operation> = BATCHED.map((name) => operationNamed(name));

export const TipeeToolkit = Toolkit.make(
  Check,
  InstallUpdate,
  ...operations.map((operation) => toolFor(operation)),
  ...batched.map((operation) => batchToolFor(operation)),
);
