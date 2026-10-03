// Regenerates src/generated/TipeeApi.ts from the vendored OpenAPI document
// With @effect/openapi-generator. Everything the toolkit knows about Tipee's
// Operations and shapes comes from that file; run `pnpm generate` after
// Dropping a new spec version into spec/ (`pnpm spec:refresh` does both).

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { EXCLUDED, pointer, referenced, root, toolRoutes, vendored } from './spec.ts';
import type { Schema } from './spec.ts';

const { document, file } = vendored();
const spec = path.basename(file);
const output = path.join(root, 'src', 'generated', 'TipeeApi.ts');
const generator = path.join(root, 'node_modules', '.bin', 'openapigen');

// The document is patched before generation wherever it disagrees with what
// Tipee does or what the tools need, each patch commented where it is made:
// Request bodies required (Tipee expects one even when empty), descriptions
// Only Claude can learn from, required pagination and orders, empty maps as
// [], the 900-odd `examples` dropped, recursive filters cut to one level,
// Request objects closed, answer-only enums opened, and the operations the
// Tools leave out removed.
interface Patch {
  readonly op: 'add' | 'remove' | 'replace';
  readonly path: string;
  readonly value?: unknown;
}

const patch: Array<Patch> = [];
const routes = toolRoutes(document);

for (const route of routes) {
  for (const [method, operation] of Object.entries(document.paths[route] ?? {})) {
    if (operation.requestBody !== undefined) {
      patch.push({
        op: 'add',
        path: `/paths/${pointer(route)}/${method}/requestBody/required`,
        value: true,
      });
    }
  }
}

// Rewrites one text of the document. A rewrite that changes nothing means
// Tipee reworded the text it was written for: fail rather than ship the
// Patch as a silent no-op.
const reword = (at: ReadonlyArray<string>, rewrite: (current: string) => string): void => {
  let current: unknown = document;
  for (const key of at) {
    current = (current as Record<string, unknown> | undefined)?.[key];
  }
  const where = `/${at.map((segment) => pointer(segment)).join('/')}`;
  if (typeof current !== 'string') {
    throw new TypeError(`no text at ${where} in the document`);
  }
  const next = rewrite(current);
  if (next === current) {
    throw new Error(`the rewrite of ${where} no longer changes it: update it in generate.ts`);
  }
  patch.push({ op: 'replace', path: where, value: next });
};
// Replaces a passage that must still be there.
const swap = (text: string, passage: string, replacement: string): string => {
  if (!text.includes(passage)) {
    throw new Error(`"${passage}" is no longer in "${text}": update generate.ts`);
  }
  return text.replace(passage, replacement);
};

// What Tipee's document does not say and Claude cannot learn otherwise: the
// Description is the only place a Claude Desktop user's Claude reads. Routes
// Mentioned in a description become the tool names Claude knows.
const describe = (route: string, rewrite: (current: string) => string): void => {
  reword(['paths', route, 'post', 'description'], rewrite);
};
describe('/api/directory/resources.list', (current) =>
  `${current} Pagination: send pagination with a limit and next_token ` +
  '(null on the first page), explicit orders, and identical filters and orders on every ' +
  'page; a non-null next_token can come back on the last full page, whose next page is empty.');
// Tipee answers 422 without them, and the description alone did not stop
// Claude from leaving them out: the schema says so instead.
patch.push({
  op: 'replace',
  path: '/components/schemas/ListResourcesQuery/required',
  value: [
    ...new Set([
      ...(document.components.schemas.ListResourcesQuery?.required ?? []),
      'orders',
      'pagination',
    ]),
  ],
});
reword(
  ['components', 'schemas', 'ListResourcesQuery', 'properties', 'kind_id', 'description'],
  (current) =>
    swap(
      current,
      'Only the "employee" kind is available at the moment.',
      "The id of a kind from kinds_list: the 'employee' kind lists people, the 'integration' kind the API integrations.",
    ),
);
reword(
  ['components', 'schemas', 'ListResourcesQuery', 'properties', 'attributes', 'description'],
  (current) => swap(current, "The 'api/directory/kinds.show' endpoint", 'The kinds_show tool'),
);
describe('/api/directory/kinds.list', (current) =>
  swap(
    current,
    "Only 'employee' is available at the moment.",
    "The 'integration' kind lists the API integrations, including the one this key belongs to.",
  ));
describe('/api/directory/kinds.show', (current) =>
  swap(current, "'api/directory/resources.list'", 'resources_list'));
describe('/api/timeclock/timechecks.list', (current) =>
  `${swap(current, '<br />', ' ')} Always pass a timecheck.date_range filter of a few weeks ` +
  'at most: without one Tipee runs out of memory (HTTP 507).');
reword(
  ['components', 'schemas', 'ListDayTasksQuery', 'properties', 'task_ids', 'title'],
  (current) => swap(current, '<br />', ' '),
);
describe('/api/schedule/absences.create', (current) =>
  `${current} Pass percentage (100 for a whole day) or time_ranges (for part of a day); ` +
  'Tipee refuses an absence with neither.');
describe('/api/schedule/schedules.create', (current) =>
  `${current} Tipee answers with no body: read the day back with schedules_list to get ` +
  'the id of what was created.');

// PHP serialises an empty map as [], so every map-typed property in a response
// (deleted, failed, choices…) must also accept an empty array, or a delete
// That succeeded would be reported as a response that does not match.
const EMPTY_ARRAY = { maxItems: 0, type: 'array' };
for (const [name, schema] of Object.entries(document.components.schemas)) {
  const properties = name.endsWith('Command') ? {} : (schema.properties ?? {});
  for (const [key, property] of Object.entries(properties)) {
    if (
      property.type === 'object' &&
      property.additionalProperties !== undefined &&
      property.properties === undefined
    ) {
      patch.push({
        op: 'replace',
        path: `/components/schemas/${pointer(name)}/properties/${pointer(key)}`,
        value: { oneOf: [property, EMPTY_ARRAY] },
      });
    }
  }
}

const removeExamples = (node: unknown, at: string): void => {
  if (Array.isArray(node)) {
    for (const [index, item] of node.entries()) {
      removeExamples(item, `${at}/${index}`);
    }
  } else if (typeof node === 'object' && node !== null) {
    for (const [key, value] of Object.entries(node)) {
      if (key === 'examples' || key === 'example') {
        patch.push({ op: 'remove', path: `${at}/${key}` });
      } else {
        removeExamples(value, `${at}/${pointer(key)}`);
      }
    }
  }
};
removeExamples(document.components.schemas, '/components/schemas');
removeExamples(document.paths, '/paths');

// Composite filters: `and` / `or` take a list of filters of the same shape.
// In JSON Schema that recursion expands several levels deep in every list
// Tool; nested filters become a plain object instead, which Tipee validates.
for (const [name, schema] of Object.entries(document.components.schemas)) {
  const self = `#/components/schemas/${name}`;
  for (const [index, alternative] of (schema.oneOf ?? []).entries()) {
    if (alternative.properties?.value?.items?.$ref === self) {
      patch.push({
        op: 'replace',
        path: `/components/schemas/${name}/oneOf/${index}/properties/value/items`,
        value: { description: 'A filter of the same shape as the top-level ones.', type: 'object' },
      });
    }
  }
}

// Closed request objects make the generated request schemas plain structs,
// Whose JSON Schema is a third shorter. They do not refuse unknown keys on
// Their own (decoding drops them): the MCP tools are strict, which does.
const visited = new Set<string>();
const closeObjects = (node: Schema | undefined, at: string): void => {
  if (node === undefined) {
    return;
  }
  if (node.$ref !== undefined) {
    const target = node.$ref.replace('#/components/schemas/', '');
    if (!visited.has(target)) {
      visited.add(target);
      closeObjects(document.components.schemas[target], `/components/schemas/${pointer(target)}`);
    }
    return;
  }
  if (node.properties !== undefined) {
    if (node.additionalProperties === undefined) {
      patch.push({ op: 'add', path: `${at}/additionalProperties`, value: false });
    }
    for (const [key, property] of Object.entries(node.properties)) {
      closeObjects(property, `${at}/properties/${pointer(key)}`);
    }
  }
  closeObjects(node.items, `${at}/items`);
  for (const group of ['oneOf', 'anyOf', 'allOf'] as const) {
    for (const [index, member] of (
      (node[group] as ReadonlyArray<Schema> | undefined) ?? []
    ).entries()) {
      closeObjects(member, `${at}/${group}/${index}`);
    }
  }
};
for (const route of routes) {
  for (const [method, operation] of Object.entries(document.paths[route] ?? {})) {
    const body = (
      operation.requestBody as { content?: Record<string, { schema?: Schema }> } | undefined
    )?.content?.['application/json']?.schema;
    closeObjects(
      body,
      `/paths/${pointer(route)}/${method}/requestBody/content/application~1json/schema`,
    );
  }
}

const requests = new Set<string>();
const answers = new Set<string>();
for (const route of routes) {
  for (const operation of Object.values(document.paths[route] ?? {})) {
    referenced(document, operation.requestBody, requests);
    referenced(document, operation.responses, answers);
  }
}

// Tipee adds enum values within a version, and one value the schema does not
// Know fails the whole answer. An enum only answers carry becomes a string
// That lists the known values; enums a request can carry stay closed.
for (const [name, schema] of Object.entries(document.components.schemas)) {
  if (schema.enum !== undefined && answers.has(name) && !requests.has(name)) {
    patch.push({
      op: 'replace',
      path: `/components/schemas/${pointer(name)}`,
      value: {
        description: [schema.description, `Known values: ${schema.enum.join(', ')}.`]
          .filter((part) => part !== undefined)
          .join(' '),
        type: 'string',
      },
    });
  }
}

// The excluded operations go last, after the patches above touched them,
// Along with the schemas no tool refers to any more.
const kept = new Set([...requests, ...answers]);
const orphans = new Set<string>();
for (const route of EXCLUDED) {
  const methods = document.paths[route];
  if (methods !== undefined) {
    patch.push({ op: 'remove', path: `/paths/${pointer(route)}` });
    for (const name of referenced(document, methods)) {
      if (!kept.has(name)) {
        orphans.add(name);
      }
    }
  }
}
for (const name of orphans) {
  patch.push({ op: 'remove', path: `/components/schemas/${pointer(name)}` });
}

const result = spawnSync(
  generator,
  ['--spec', file, '--format', 'httpapi', '--name', 'Tipee', '--patch', JSON.stringify(patch)],
  { encoding: 'utf8' },
);
if (result.status !== 0) {
  throw new Error(`openapigen failed:\n${result.stderr}`);
}
mkdirSync(path.dirname(output), { recursive: true });
writeFileSync(
  output,
  `// Generated from spec/${spec} by @effect/openapi-generator. Do not edit:\n// Run \`pnpm generate\` instead.\n\n${result.stdout}`,
);
