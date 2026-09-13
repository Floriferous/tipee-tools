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

// Tipee expects a JSON body on every call, even an empty one, but the document
// Marks request bodies optional; that would make the client send no body at
// All. Mark them required, as a JSON Patch the generator applies before reading.
const document = JSON.parse(readFileSync(path.join(root, 'spec', spec), 'utf8')) as {
  readonly paths: Record<string, Record<string, { readonly requestBody?: unknown }>>;
};
const pointer = (segment: string): string => segment.replaceAll('~', '~0').replaceAll('/', '~1');
const patch = Object.entries(document.paths).flatMap(([route, methods]) =>
  Object.entries(methods)
    .filter(([, operation]) => operation.requestBody !== undefined)
    .map(([method]) => ({
      op: 'add',
      path: `/paths/${pointer(route)}/${method}/requestBody/required`,
      value: true,
    })),
);

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
