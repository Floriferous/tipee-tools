// What the generator and the refresh share about the vendored OpenAPI
// Document: where it lives, its shape, and which operations become tools.

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

export const root = path.join(import.meta.dirname, '..');
export const specDirectory = path.join(root, 'spec');

export interface Schema {
  readonly oneOf?: ReadonlyArray<Schema>;
  readonly discriminator?: {
    readonly propertyName: string;
    readonly mapping?: Record<string, string>;
  };
  readonly properties?: Record<string, Schema>;
  readonly required?: ReadonlyArray<string>;
  readonly items?: Schema;
  readonly $ref?: string;
  readonly enum?: ReadonlyArray<string>;
  readonly description?: string;
  readonly examples?: unknown;
  readonly [key: string]: unknown;
}
export interface Operation {
  readonly requestBody?: unknown;
  readonly responses?: unknown;
  readonly description?: string;
}
export interface Document {
  readonly info: { readonly version: string };
  readonly paths: Record<string, Record<string, Operation>>;
  readonly components: { readonly schemas: Record<string, Schema> };
}

// The one document in spec/, named tipee-<version>.json.
export const vendored = (): { readonly file: string; readonly document: Document } => {
  const specs = readdirSync(specDirectory).filter((file) => file.endsWith('.json'));
  const [spec] = specs;
  if (spec === undefined || specs.length !== 1) {
    throw new Error(`expected exactly one spec in ${specDirectory}, found ${specs.length}`);
  }
  const file = path.join(specDirectory, spec);
  return { document: JSON.parse(readFileSync(file, 'utf8')) as Document, file };
};

// Operations left out of the tools on purpose. Granting and revoking roles
// Would let Claude raise anyone's rights, its own integration's included: an
// Admin does that in Tipee. Listing roles is a read and stays.
export const EXCLUDED: ReadonlySet<string> = new Set([
  '/api/directory/resources.grant-roles',
  '/api/directory/resources.revoke-roles',
]);

// A JSON Pointer segment.
export const pointer = (segment: string): string =>
  segment.replaceAll('~', '~0').replaceAll('/', '~1');

// Adds to `found` the component schemas a node refers to, directly or
// Through other schemas.
export const referenced = (
  document: Document,
  node: unknown,
  found = new Set<string>(),
): Set<string> => {
  if (Array.isArray(node)) {
    for (const item of node) {
      referenced(document, item, found);
    }
  } else if (typeof node === 'object' && node !== null) {
    for (const [key, value] of Object.entries(node)) {
      if (key === '$ref' && typeof value === 'string') {
        const name = value.replace('#/components/schemas/', '');
        if (!found.has(name)) {
          found.add(name);
          referenced(document, document.components.schemas[name], found);
        }
      } else {
        referenced(document, value, found);
      }
    }
  }
  return found;
};

// The routes that become tools.
export const toolRoutes = (document: Document): ReadonlyArray<string> =>
  Object.keys(document.paths).filter((route) => !EXCLUDED.has(route));

// A route's tool name, the way Operations.ts derives it: `schedules_list` for
// `/api/schedule/schedules.list`.
export const toolName = (route: string): string =>
  route.replace(/^\/api\/[^/]+\//u, '').replaceAll(/[.-]/gu, '_');
