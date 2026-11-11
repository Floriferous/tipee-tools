// The patches that make the tools' JSON Schemas smaller without changing
// what tipee accepts or answers; generate.ts applies them with its own.

import { Array as Arr, Predicate, Record as Rec, String as Str } from 'effect';

import { pointer, toolRoutes } from './spec.ts';
import type { Document, Patch, Schema } from './spec.ts';

// The 900-odd `examples` only lengthen the tools' descriptions.
const removeExamples = (node: unknown, at: string, patch: Array<Patch>): void => {
  if (Arr.isArray(node)) {
    for (const [index, item] of node.entries()) {
      removeExamples(item, `${at}/${index}`, patch);
    }
  } else if (Predicate.isObject(node)) {
    for (const [key, value] of Rec.toEntries(node)) {
      if (key === 'examples' || key === 'example') {
        patch.push({ op: 'remove', path: `${at}/${key}` });
      } else {
        removeExamples(value, `${at}/${pointer(key)}`, patch);
      }
    }
  }
};

// Composite filters: `and` / `or` take a list of filters of the same shape.
// In JSON Schema that recursion expands several levels deep in every list
// tool; nested filters become a plain object instead, which tipee validates.
const flattenFilters = (document: Document, patch: Array<Patch>): void => {
  for (const [name, schema] of Rec.toEntries(document.components.schemas)) {
    const self = `#/components/schemas/${name}`;
    for (const [index, alternative] of (schema.oneOf ?? []).entries()) {
      if (alternative.properties?.value?.items?.$ref === self) {
        patch.push({
          op: 'replace',
          path: `/components/schemas/${name}/oneOf/${index}/properties/value/items`,
          value: {
            description: 'A filter of the same shape as the top-level ones.',
            type: 'object',
          },
        });
      }
    }
  }
};

// Closed request objects make the generated request schemas plain structs,
// whose JSON Schema is a third shorter. They do not refuse unknown keys on
// their own (decoding drops them): the MCP tools are strict, which does.
const closeRequests = (document: Document, patch: Array<Patch>): void => {
  const visited = new Set<string>();
  const closeObjects = (node: Schema | undefined, at: string): void => {
    if (node === undefined) {
      return;
    }
    if (node.$ref !== undefined) {
      const target = Str.replace('#/components/schemas/', '')(node.$ref);
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
      for (const [key, property] of Rec.toEntries(node.properties)) {
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
  for (const route of toolRoutes(document)) {
    for (const [method, operation] of Rec.toEntries(document.paths[route] ?? {})) {
      const body = (
        operation.requestBody as { content?: Record<string, { schema?: Schema }> } | undefined
      )?.content?.['application/json']?.schema;
      closeObjects(
        body,
        `/paths/${pointer(route)}/${method}/requestBody/content/application~1json/schema`,
      );
    }
  }
};

export const compact = (document: Document): ReadonlyArray<Patch> => {
  const patch: Array<Patch> = [];
  removeExamples(document.components.schemas, '/components/schemas', patch);
  removeExamples(document.paths, '/paths', patch);
  flattenFilters(document, patch);
  closeRequests(document, patch);
  return patch;
};
