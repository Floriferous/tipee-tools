// Regenerates src/generated/TipeeApi.ts from the vendored OpenAPI document
// With @effect/openapi-generator. Everything the toolkit knows about Tipee's
// Operations and shapes comes from that file; run `pnpm generate` after
// Dropping a new spec version into spec/.

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');
const specs = readdirSync(path.join(root, 'spec')).filter((file) => file.endsWith('.json'));
const [spec] = specs;
if (spec === undefined || specs.length !== 1) {
  throw new Error(`expected exactly one spec in ${path.join(root, 'spec')}, found ${specs.length}`);
}
const output = path.join(root, 'src', 'generated', 'TipeeApi.ts');
const generator = path.join(root, 'node_modules', '.bin', 'openapigen');

// The document is patched before generation, for three reasons the tools
// Would otherwise pay for on every call: Tipee expects a JSON body even when
// Empty (bodies are marked optional), the 900-odd `examples` only inflate
// The tool definitions, and the recursive `and`/`or` filters expand several
// Levels deep in JSON Schema (one level of nesting is kept).
interface Document {
  readonly paths: Record<
    string,
    Record<string, { readonly requestBody?: unknown; readonly description?: string }>
  >;
  readonly components: { readonly schemas: Record<string, Schema> };
}
interface Schema {
  readonly oneOf?: ReadonlyArray<Schema>;
  readonly discriminator?: {
    readonly propertyName: string;
    readonly mapping?: Record<string, string>;
  };
  readonly properties?: Record<string, Schema>;
  readonly items?: Schema;
  readonly $ref?: string;
  readonly enum?: ReadonlyArray<string>;
  readonly examples?: unknown;
  readonly [key: string]: unknown;
}
interface Patch {
  readonly op: 'add' | 'remove' | 'replace';
  readonly path: string;
  readonly value?: unknown;
}

const document = JSON.parse(readFileSync(path.join(root, 'spec', spec), 'utf8')) as Document;
const pointer = (segment: string): string => segment.replaceAll('~', '~0').replaceAll('/', '~1');
const patch: Array<Patch> = [];

for (const [route, methods] of Object.entries(document.paths)) {
  for (const [method, operation] of Object.entries(methods)) {
    if (operation.requestBody !== undefined) {
      patch.push({
        op: 'add',
        path: `/paths/${pointer(route)}/${method}/requestBody/required`,
        value: true,
      });
    }
  }
}

// Claude Desktop has no skill to read the pagination contract from.
const resourcesList = document.paths['/api/directory/resources.list']?.post;
if (resourcesList !== undefined) {
  patch.push({
    op: 'replace',
    path: `/paths/${pointer('/api/directory/resources.list')}/post/description`,
    value:
      `${resourcesList.description ?? ''} Pagination: send pagination with a limit and next_token ` +
      '(null on the first page), explicit orders, and identical filters and orders on every ' +
      'page; a non-null next_token can come back on the last full page, whose next page is empty.',
  });
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

// Request bodies reject unknown keys. This also makes the generated request
// Schemas plain structs, whose JSON Schema is a third shorter.
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
for (const [route, methods] of Object.entries(document.paths)) {
  for (const [method, operation] of Object.entries(methods)) {
    const body = (
      operation.requestBody as { content?: Record<string, { schema?: Schema }> } | undefined
    )?.content?.['application/json']?.schema;
    closeObjects(
      body,
      `/paths/${pointer(route)}/${method}/requestBody/content/application~1json/schema`,
    );
  }
}

const result = spawnSync(
  generator,
  [
    '--spec',
    path.join(root, 'spec', spec),
    '--format',
    'httpapi',
    '--name',
    'Tipee',
    '--patch',
    JSON.stringify(patch),
  ],
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
